// =============================================================
// EDGE FUNCTION: ig-scheduler  (O CARTEIRO)
//
// Roda pelo pg_cron, protegida pelo segredo SCHED_SECRET (header x-sched-key).
//
// A cada 1 minuto (chamada normal):
//   0. Busca ativa: comentários novos e respostas no direct.
//   1. Esvazia a fila (ig_send_queue): os envios que o freio segurou.
//   2. Manda os passos com atraso (ig_scheduled) que já venceram.
//
// A cada 5 segundos, MAS SÓ enquanto alguém está no meio de uma conversa
// (chamada com ?so=conversas):
//   Olha o direct de quem acabou de receber uma mensagem com botão, para a
//   próxima mensagem sair poucos segundos depois do toque.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUDGET_KEY = "private_reply";

// O Instagram só aceita resposta privada a um comentário por cerca de 7 dias.
const VALIDADE_COMENTARIO_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- BUSCA ATIVA ----------
// Enquanto o app não tem acesso avançado no Meta, o Meta não entrega os eventos
// ao webhook. Então este robô busca os comentários novos e as respostas no direct
// e entrega ao webhook, que processa exatamente igual a um evento do Meta.
// Quando o Meta começar a entregar, nada se repete: cada comentário e cada
// mensagem são processados uma única vez (tabela ig_processed).
// Para desligar, crie o segredo POLLING_ENABLED com o valor "false".
const POLLING = (Deno.env.get("POLLING_ENABLED") ?? "true") !== "false";
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/instagram-webhook`;
// Quantos posts acompanhar pela contagem de comentários (os mais recentes).
const MAX_POSTS = 100;
// Só olha comentários e mensagens das últimas 48 horas.
const JANELA_BUSCA_MS = 48 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  // Porteiro: só entra quem tem o segredo.
  if (!SCHED_SECRET || req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }

  await carregarToken();
  const so = new URL(req.url).searchParams.get("so") ?? "";
  const soConversas = so === "conversas";

  const resumo = {
    modo: so || "completo",
    comentarios_novos: 0, mensagens_novas: 0, respostas_story: 0,
    fila_enviados: 0, fila_expirados: 0, atrasados_enviados: 0,
    erros_busca: [] as string[],
  };

  // ---------- MODO STORIES: respostas a stories (a cada 20 segundos) ----------
  if (so === "stories") {
    if (POLLING && IG_TOKEN && IG_ACCOUNT_ID) {
      try { await buscarRespostasStory(resumo); }
      catch (e) { resumo.erros_busca.push(`stories: ${e}`); }
    }
    return responder(resumo);
  }

  // ---------- MODO RÁPIDO: só o direct de quem está no meio de uma conversa ----------
  if (soConversas) {
    if (POLLING && IG_TOKEN && IG_ACCOUNT_ID) {
      try { await buscarConversas(resumo, true); }
      catch (e) { resumo.erros_busca.push(`conversas: ${e}`); }
    }
    return responder(resumo);
  }

  // ---------- 0) BUSCA ATIVA ----------
  if (POLLING && IG_TOKEN && IG_ACCOUNT_ID) {
    try { await buscarComentarios(resumo); }
    catch (e) { resumo.erros_busca.push(`comentarios: ${e}`); }
    try { await buscarConversas(resumo, false); }
    catch (e) { resumo.erros_busca.push(`conversas: ${e}`); }
    try { await buscarRespostasStory(resumo); }
    catch (e) { resumo.erros_busca.push(`stories: ${e}`); }
  }

  // ---------- 1) A FILA ----------
  const { data: pendentes } = await db.from("ig_send_queue")
    .select("*").eq("status", "pendente").order("created_at", { ascending: true }).limit(30);

  for (const item of pendentes ?? []) {
    // Comentário velho demais: o Instagram não aceita mais responder.
    if (Date.now() - new Date(item.created_at).getTime() > VALIDADE_COMENTARIO_MS) {
      await db.from("ig_send_queue").update({
        status: "expirado", last_error: "fora da janela de 7 dias",
      }).eq("id", item.id);
      resumo.fila_expirados++;
      continue;
    }

    // Pede uma ficha ao freio. Sem ficha, para por aqui e tenta no próximo minuto.
    const { data: temFicha } = await db.rpc("take_send_slot", { p_key: BUDGET_KEY });
    if (!temFicha) break;

    const { data: automacao } = await db.from("ig_automations")
      .select("*").eq("id", item.automation_id).maybeSingle();

    const passos = automacao?.flow?.steps ?? [];
    if (!automacao || passos.length === 0) {
      await db.from("ig_send_queue").update({
        status: "erro", last_error: "automação sem fluxo",
      }).eq("id", item.id);
      continue;
    }

    // Manda o passo 0 (a Mensagem 1) como resposta privada ao comentário.
    const envio = await sendStep(automacao, passos[0], { comment_id: item.comment_id });
    await db.rpc("record_send_result", { p_key: BUDGET_KEY, p_ok: envio.ok, p_hard: envio.hard ?? false });

    if (envio.ok) {
      await db.from("ig_send_queue").update({
        status: "enviado", sent_at: new Date().toISOString(),
      }).eq("id", item.id);
      await log(item.ig_user_id, item.automation_id, "private_reply", "flow", "ok", "enviado pela fila");
      resumo.fila_enviados++;
    } else {
      const tentativas = (item.tentativas ?? 0) + 1;
      await db.from("ig_send_queue").update({
        status: tentativas >= 5 ? "erro" : "pendente",
        tentativas,
        last_error: envio.motivo ?? "",
      }).eq("id", item.id);
      await log(item.ig_user_id, item.automation_id, "private_reply", "flow", "erro", envio.motivo ?? "");
    }
  }

  // ---------- 2) OS PASSOS COM ATRASO ----------
  const agora = new Date().toISOString();
  const { data: atrasados } = await db.from("ig_scheduled")
    .select("*").eq("sent", false).lte("send_at", agora).limit(30);

  for (const s of atrasados ?? []) {
    const { data: automacao } = await db.from("ig_automations")
      .select("*").eq("id", s.automation_id).maybeSingle();
    const passo = (automacao?.flow?.steps ?? []).find((p: any) => String(p.id) === String(s.step_id));
    if (!automacao || !passo) {
      await db.from("ig_scheduled").update({ sent: true }).eq("id", s.id);
      continue;
    }

    const envio = await sendStep(automacao, passo, { id: s.ig_user_id });
    await db.from("ig_scheduled").update({ sent: true }).eq("id", s.id);
    await log(s.ig_user_id, s.automation_id, "dm", "flow", envio.ok ? "ok" : "erro", envio.motivo ?? "");
    if (envio.ok) {
      resumo.atrasados_enviados++;
      // A pessoa passa a estar nesse passo, e o direct dela volta a ser acompanhado.
      await db.from("ig_leads").update({
        flow_step: String(passo.id),
        expecting: passo?.collect ?? null,
        aguardando_ate: aguardandoAte(passo),
        ultimo_envio: new Date().toISOString(),
      }).eq("ig_user_id", s.ig_user_id);
    }
  }

  return responder(resumo);
});

function responder(resumo: unknown) {
  return new Response(JSON.stringify(resumo), { headers: { "Content-Type": "application/json" } });
}

// =============================================================
// BUSCA ATIVA: comentários novos
//
// Uma única chamada traz os posts com a contagem de comentários de cada um.
// Só busca os comentários dos posts cuja contagem mudou desde a última vez,
// então acompanhar todos os posts custa pouquíssimo.
// =============================================================
async function buscarComentarios(resumo: any) {
  const { data: autos } = await db.from("ig_automations")
    .select("id, media_ids, created_at, updated_at").eq("active", true);
  if (!autos?.length) return;

  const especificos = new Set<string>();
  let todos = false;
  for (const a of autos) {
    const m: string[] = a.media_ids ?? [];
    if (m.length === 0) todos = true;
    else m.forEach((x) => especificos.add(String(x)));
  }

  // Posts recentes com a contagem de comentários (até MAX_POSTS, em páginas de 50).
  const contagem = new Map<string, number>();
  let caminho: string | null = `/me/media?fields=id,comments_count&limit=50`;
  while (caminho && contagem.size < MAX_POSTS) {
    const j = await igGet(caminho);
    if (j?.error) { resumo.erros_busca.push(`media: ${j.error.message}`); break; }
    for (const m of j?.data ?? []) contagem.set(String(m.id), Number(m.comments_count ?? 0));
    const proxima = j?.paging?.next ? String(j.paging.next) : "";
    caminho = proxima ? proxima.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, "") : null;
  }

  // Quais posts interessam: todos (se alguma automação vale para todos) ou os escolhidos.
  const alvo = new Set<string>(todos ? [...contagem.keys(), ...especificos] : [...especificos]);
  if (!alvo.size) return;

  // A contagem guardada da última rodada.
  const { data: estado } = await db.from("ig_media_state")
    .select("media_id, comments_count").in("media_id", [...alvo]);
  const anterior = new Map((estado ?? []).map((e: any) => [String(e.media_id), Number(e.comments_count)]));

  // Nada anterior à edição mais antiga das automações, nem fora da janela de busca.
  const corte = Math.max(
    Date.now() - JANELA_BUSCA_MS,
    Math.min(...autos.map((a: any) => new Date(a.updated_at ?? a.created_at).getTime())),
  );

  for (const mediaId of alvo) {
    const atual = contagem.get(mediaId);
    // Contagem igual à da última rodada: nenhum comentário novo, não gasta chamada.
    // (Posts escolhidos que estão fora da lista recente são sempre conferidos.)
    if (atual !== undefined && anterior.get(mediaId) === atual) continue;

    const j = await igGet(`/${mediaId}/comments?fields=id,text,timestamp,from&limit=50`);
    if (j?.error) { resumo.erros_busca.push(`post ${mediaId}: ${j.error.message}`); continue; }

    const candidatos = (j?.data ?? []).filter((c: any) =>
      c?.id && c?.from?.id &&
      String(c.from.id) !== IG_ACCOUNT_ID &&
      paraData(c.timestamp).getTime() >= corte
    );

    if (candidatos.length) {
      // Descarta o que já foi processado (pela busca ou pelo webhook do Meta).
      const { data: ja } = await db.from("ig_processed")
        .select("event_id").in("event_id", candidatos.map((c: any) => `c:${c.id}`));
      const vistos = new Set((ja ?? []).map((x: any) => x.event_id));

      for (const c of candidatos) {
        if (vistos.has(`c:${c.id}`)) continue;
        await encaminhar({
          object: "instagram",
          entry: [{
            id: IG_ACCOUNT_ID,
            time: Math.floor(Date.now() / 1000),
            changes: [{
              field: "comments",
              value: {
                id: String(c.id),
                text: c.text ?? "",
                timestamp: c.timestamp,
                from: { id: String(c.from.id), username: c.from.username ?? "" },
                media: { id: mediaId },
              },
            }],
          }],
        });
        resumo.comentarios_novos++;
      }
    }

    // Guarda a contagem para a próxima rodada.
    if (atual !== undefined) {
      await db.from("ig_media_state").upsert({
        media_id: mediaId, comments_count: atual, updated_at: new Date().toISOString(),
      });
    }
  }
}

// =============================================================
// BUSCA ATIVA: respostas no direct (toques nos botões e dados digitados)
//
// rapido = true: só quem acabou de receber uma mensagem com botão que continua
// a conversa (aguardando_ate no futuro). É o que roda a cada 5 segundos.
// =============================================================
async function buscarConversas(resumo: any, rapido: boolean) {
  let consulta = db.from("ig_leads")
    .select("ig_user_id, updated_at, ultimo_envio, flow_step, automation_id")
    .not("automation_id", "is", null);
  consulta = rapido
    ? consulta.gt("aguardando_ate", new Date().toISOString())
    : consulta.gte("updated_at", new Date(Date.now() - JANELA_BUSCA_MS).toISOString());
  const { data: leads } = await consulta;
  if (!leads?.length) return;

  // Com poucas pessoas esperando, busca a conversa de cada uma direto (mais preciso).
  // Com muitas, uma única chamada traz as conversas mais recentes.
  let conversas: any[] = [];
  if (leads.length <= 2) {
    for (const l of leads) {
      const j = await igGet(
        `/me/conversations?platform=instagram&user_id=${l.ig_user_id}` +
        `&fields=participants,messages.limit(6){id,message,from,created_time,story}`,
      );
      if (j?.error) { conversas = []; break; }
      conversas.push(...(j?.data ?? []));
    }
  }
  if (!conversas.length) {
    const j = await igGet(
      `/me/conversations?platform=instagram&fields=participants,messages.limit(6){id,message,from,created_time,story}&limit=25`,
    );
    if (j?.error) { resumo.erros_busca.push(`conversas: ${j.error.message}`); return; }
    conversas = j?.data ?? [];
  }

  const porId = new Map(leads.map((l: any) => [String(l.ig_user_id), l]));

  for (const conversa of conversas) {
    const outro = (conversa?.participants?.data ?? [])
      .find((p: any) => String(p.id) !== IG_ACCOUNT_ID);
    const lead: any = outro ? porId.get(String(outro.id)) : null;
    if (!lead) continue;

    // Mensagens da pessoa, depois do último passo que o sistema mandou pra ela.
    const corte = new Date(lead.ultimo_envio ?? lead.updated_at).getTime();
    const novas = (conversa?.messages?.data ?? [])
      .filter((m: any) =>
        String(m?.from?.id) === String(outro.id) &&
        String(m?.message ?? "").trim() !== "" &&
        paraData(m.created_time).getTime() > corte
      )
      .sort((a: any, b: any) => paraData(a.created_time).getTime() - paraData(b.created_time).getTime());
    if (!novas.length) continue;

    const { data: ja } = await db.from("ig_processed")
      .select("event_id").in("event_id", novas.map((m: any) => `m:${m.id}`));
    const vistos = new Set((ja ?? []).map((x: any) => x.event_id));

    for (const m of novas) {
      if (vistos.has(`m:${m.id}`)) continue;
      await encaminhar(eventoDeMensagem(String(outro.id), m));
      resumo.mensagens_novas++;
    }
  }
}

// =============================================================
// BUSCA ATIVA: respostas a stories
// Olha as conversas recentes atrás de mensagens que respondem um story.
// Só roda quando existe automação de story ligada.
// =============================================================
async function buscarRespostasStory(resumo: any) {
  const { data: autos } = await db.from("ig_automations")
    .select("updated_at, created_at").eq("active", true).eq("tipo", "story");
  if (!autos?.length) return;

  // Nada anterior à edição mais antiga das automações de story, nem fora da janela.
  const corte = Math.max(
    Date.now() - JANELA_BUSCA_MS,
    Math.min(...autos.map((a: any) => new Date(a.updated_at ?? a.created_at).getTime())),
  );

  const j = await igGet(
    `/me/conversations?platform=instagram&fields=participants,messages.limit(5){id,message,from,created_time,story}&limit=25`,
  );
  if (j?.error) { resumo.erros_busca.push(`stories: ${j.error.message}`); return; }

  const candidatas: { de: string; m: any }[] = [];
  for (const conversa of j?.data ?? []) {
    const outro = (conversa?.participants?.data ?? [])
      .find((p: any) => String(p.id) !== IG_ACCOUNT_ID);
    if (!outro) continue;
    for (const m of conversa?.messages?.data ?? []) {
      if (String(m?.from?.id) !== String(outro.id)) continue;
      if (!storyRespondido(m)) continue;
      if (paraData(m.created_time).getTime() < corte) continue;
      candidatas.push({ de: String(outro.id), m });
    }
  }
  if (!candidatas.length) return;

  const { data: ja } = await db.from("ig_processed")
    .select("event_id").in("event_id", candidatas.map((c) => `m:${c.m.id}`));
  const vistos = new Set((ja ?? []).map((x: any) => x.event_id));

  for (const c of candidatas) {
    if (vistos.has(`m:${c.m.id}`)) continue;
    await encaminhar(eventoDeMensagem(c.de, c.m));
    resumo.respostas_story++;
  }
}

// O story que a mensagem responde, se for uma resposta a story.
// A API pode trazer { reply_to: { id, link } } ou { id, link }; menções
// ({ mention: ... }) não são respostas e ficam de fora.
function storyRespondido(m: any): { id: string } | null {
  const s = m?.story;
  if (!s) return null;
  if (s.reply_to?.id) return { id: String(s.reply_to.id) };
  if (s.mention) return null;
  if (s.id) return { id: String(s.id) };
  return null;
}

// Monta o evento no mesmo formato em que o Meta entregaria a mensagem.
function eventoDeMensagem(de: string, m: any) {
  const story = storyRespondido(m);
  const message: Record<string, unknown> = { mid: String(m.id), text: String(m.message ?? "") };
  if (story) message.reply_to = { story: { id: story.id } };
  return {
    object: "instagram",
    entry: [{
      id: IG_ACCOUNT_ID,
      time: Math.floor(Date.now() / 1000),
      messaging: [{
        sender: { id: de },
        recipient: { id: IG_ACCOUNT_ID },
        timestamp: paraData(m.created_time).getTime(),
        message,
      }],
    }],
  };
}

// Entrega um evento ao webhook, identificado como interno pelo segredo.
async function encaminhar(evento: unknown) {
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sched-key": SCHED_SECRET },
    body: JSON.stringify(evento),
  });
}

async function igGet(caminho: string) {
  try {
    const r = await fetch(`${GRAPH}${caminho}`, { headers: { Authorization: `Bearer ${IG_TOKEN}` } });
    return await r.json();
  } catch (e) {
    return { error: { message: String(e) } };
  }
}

// Lê o token mais recente (renovado toda semana) do banco.
async function carregarToken() {
  try {
    const { data } = await db.from("ig_secrets").select("value").eq("id", "ig_access_token").maybeSingle();
    if (data?.value) IG_TOKEN = String(data.value);
  } catch { /* sem a tabela, segue com o token do segredo */ }
}

// Mesmo critério do webhook: o passo espera resposta da pessoa?
function aguardandoAte(passo: any) {
  const avanca = (passo?.buttons ?? []).some((b: any) =>
    !b?.url && b?.next !== undefined && b?.next !== null && b?.next !== ""
  );
  return (avanca || passo?.collect) ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
}

// =============================================================
// Mesma lógica de envio do webhook (botões anexados, com fallback).
// =============================================================
async function sendStep(
  automacao: any, passo: any, destino: { id?: string; comment_id?: string },
): Promise<{ ok: boolean; hard?: boolean; motivo?: string }> {
  const texto = String(passo?.message ?? "").trim() || "Oi!";

  const botoes: any[] = [];
  for (const b of passo?.buttons ?? []) {
    const titulo = String(b?.title ?? "").slice(0, 20);
    if (!titulo) continue;
    if (b?.url) botoes.push({ type: "web_url", url: String(b.url), title: titulo });
    else if (b?.next !== undefined && b?.next !== null && b?.next !== "") {
      botoes.push({ type: "postback", title: titulo, payload: `STEP:${automacao.id}:${b.next}` });
    }
  }

  const anexados = botoes.slice(0, 3); // no máximo 3 no formato anexado

  if (anexados.length > 0) {
    const r1 = await enviarMensagem(destino, {
      attachment: {
        type: "template",
        payload: { template_type: "button", text: texto.slice(0, 640), buttons: anexados },
      },
    });
    if (r1.ok) return { ok: true };

    const pilulas = botoes.filter((b) => b.type === "postback").slice(0, 13)
      .map((b) => ({ content_type: "text", title: b.title, payload: b.payload }));
    const links = botoes.filter((b) => b.type === "web_url");
    const textoComLink = links.length
      ? `${texto}\n\n${links.map((l) => `${l.title}: ${l.url}`).join("\n")}` : texto;

    if (pilulas.length > 0) {
      const r2 = await enviarMensagem(destino, { text: textoComLink, quick_replies: pilulas });
      if (r2.ok) return { ok: true };
    }
    const r3 = await enviarMensagem(destino, { text: textoComLink });
    return r3.ok ? { ok: true } : { ok: false, hard: r3.hard, motivo: r3.motivo };
  }

  const r = await enviarMensagem(destino, { text: texto });
  return r.ok ? { ok: true } : { ok: false, hard: r.hard, motivo: r.motivo };
}

async function enviarMensagem(destino: any, message: any) {
  try {
    const resp = await fetch(`${GRAPH}/${IG_ACCOUNT_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: destino, message, access_token: IG_TOKEN }),
    });
    const json = await resp.json().catch(() => ({}));
    if (resp.ok && !json?.error) {
      const mid = json?.message_id ?? json?.mid;
      if (mid) await db.from("ig_bot_sends").upsert({ mid: String(mid), ig_user_id: destino.id ?? null });
      return { ok: true } as const;
    }
    const hard = [4, 10, 190, 200, 613, 551].includes(Number(json?.error?.code));
    return { ok: false, hard, motivo: json?.error?.message ?? `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, hard: false, motivo: String(e) };
  }
}

async function log(u: string, a: string | null, canal: string, tipo: string, status: string, motivo: string) {
  await db.from("ig_deliveries").insert({
    ig_user_id: u, automation_id: a, canal, tipo, status, motivo: String(motivo).slice(0, 500),
  });
}

// O Instagram manda datas como "2026-09-18T23:33:59+0000" (sem os dois-pontos
// no fuso). Normaliza para o formato padrão antes de converter.
function paraData(s: string) {
  return new Date(String(s ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}
