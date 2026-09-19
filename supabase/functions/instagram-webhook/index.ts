// =============================================================
// EDGE FUNCTION: instagram-webhook  (O CÉREBRO DO SISTEMA)
//
// O que ela faz:
//  1. Responde o "aperto de mão" do Meta (GET com hub.challenge).
//  2. Recebe os eventos do Instagram (POST): comentários novos,
//     mensagens no direct e toques em botão (postback / quick_reply).
//  3. Acha a automação certa e manda a DM com os botões.
//
// IMPORTANTE NA HORA DE PUBLICAR: esta função precisa ser PÚBLICA.
//   supabase functions deploy instagram-webhook --no-verify-jwt
// Senão o Meta não consegue chamar e nada funciona.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Segredos (variáveis de ambiente) ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// O token do Instagram é renovado toda semana pelo ig-token-refresh, que guarda o
// token novo na tabela ig_secrets. Aqui usamos o do banco e, se não houver, o do segredo.
let IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const APP_SECRET = Deno.env.get("APP_SECRET") ?? "";
// Chave secreta do app (tela Básico). O Meta pode assinar com ela ou com a do Instagram.
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
// "false" (padrão) = modo teste, assinatura inválida só vira aviso no log.
// "true" = trava ligada, assinatura inválida é recusada. Ligue depois de testar.
const APP_SECRET_ENFORCE = (Deno.env.get("APP_SECRET_ENFORCE") ?? "false") === "true";
const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
// Segredo dos robôs internos. Eventos enviados pelo ig-scheduler (modo de busca ativa)
// chegam com esse segredo e não passam pela conferência de assinatura do Meta.
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
// Contas de teste: ids numéricos separados por vírgula. Elas ignoram a regra do 1 por dia.
const TEST_ACCOUNTS = (Deno.env.get("TEST_IG_ACCOUNTS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Chave do freio (o contador da tabela ig_send_budget).
const BUDGET_KEY = "private_reply";

// Depois de mandar uma mensagem com botão que continua a conversa, o sistema fica
// "de olho" no direct dessa pessoa por este tempo, checando a cada poucos segundos.
// É isso que faz a segunda mensagem chegar logo depois do toque no botão.
const JANELA_RAPIDA_MS = 5 * 60 * 1000;

// Lê o token mais recente (renovado) do banco.
async function carregarToken() {
  try {
    const { data } = await db.from("ig_secrets").select("value").eq("id", "ig_access_token").maybeSingle();
    if (data?.value) IG_TOKEN = String(data.value);
  } catch { /* sem a tabela, segue com o token do segredo */ }
}

// Esse passo espera uma resposta da pessoa (botão que avança ou pedido de dado)?
function esperaResposta(passo: any) {
  const avanca = (passo?.buttons ?? []).some((b: any) =>
    !b?.url && b?.next !== undefined && b?.next !== null && b?.next !== ""
  );
  return avanca || !!passo?.collect;
}
function aguardandoAte(passo: any) {
  return esperaResposta(passo) ? new Date(Date.now() + JANELA_RAPIDA_MS).toISOString() : null;
}

// =============================================================
// PONTO DE ENTRADA
// =============================================================
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---------- a) VERIFICAÇÃO (GET): o aperto de mão do Meta ----------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("verificação recusada", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  // ---------- b) RECEBIMENTO (POST) ----------
  // Lemos o corpo como TEXTO porque a assinatura é calculada sobre o texto cru.
  const raw = await req.text();
  // Evento interno do robô de busca ativa: já vem de dentro do sistema.
  const interno = !!SCHED_SECRET && req.headers.get("x-sched-key") === SCHED_SECRET;
  const assinaturaOk = interno || await conferirAssinatura(raw, req.headers.get("x-hub-signature-256"));

  if (!assinaturaOk) {
    if (APP_SECRET_ENFORCE) {
      console.error("Assinatura inválida e a trava está ligada: evento recusado.");
      return new Response("assinatura inválida", { status: 401 });
    }
    console.warn("Aviso: assinatura inválida, mas APP_SECRET_ENFORCE está desligado. Processando mesmo assim (modo teste).");
  }

  let body: any = {};
  try { body = JSON.parse(raw); } catch { body = {}; }

  await carregarToken();

  // Respondemos 200 rápido e processamos em seguida: o Meta não gosta de espera.
  try {
    for (const entry of body?.entry ?? []) {
      // Comentários chegam em "changes".
      for (const change of entry?.changes ?? []) {
        if (change?.field === "comments") {
          await handleComment(change.value);
        }
      }
      // Mensagens e toques em botão chegam em "messaging".
      for (const evento of entry?.messaging ?? []) {
        await handleMessage(evento);
      }
    }
  } catch (e) {
    console.error("Erro ao processar evento:", e);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});

// =============================================================
// ASSINATURA (HMAC SHA-256 com o APP_SECRET)
// =============================================================
async function conferirAssinatura(raw: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const esperado = header.replace("sha256=", "").trim();
  // Aceita a assinatura feita com qualquer um dos dois segredos do app.
  for (const segredo of [APP_SECRET, META_APP_SECRET].filter(Boolean)) {
    const chave = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(segredo),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(raw));
    const calculado = [...new Uint8Array(assinado)]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    if (calculado === esperado) return true;
  }
  return false;
}

// =============================================================
// ANTI-REPETIÇÃO: o Meta reenvia eventos. Só processamos uma vez.
// =============================================================
async function jaProcessado(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const { error } = await db.from("ig_processed").insert({ event_id: eventId });
  // Se deu erro de chave duplicada, é porque já tinha processado.
  return !!error;
}

// =============================================================
// FLUXO DE COMENTÁRIO
// =============================================================
async function handleComment(v: any) {
  const commentId = String(v?.id ?? "");
  const texto = String(v?.text ?? "");
  const fromId = String(v?.from?.id ?? "");
  const username = String(v?.from?.username ?? "");
  const mediaId = String(v?.media?.id ?? "");

  if (!commentId || !fromId) return;

  // 1) Já processei esse comentário? Então nem começa.
  if (await jaProcessado(`c:${commentId}`)) return;

  // 2) Comentário da própria conta (dono do post): ignora.
  if (IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) return;

  // 3) Acha a automação: casa a palavra E o post.
  // Quando o comentário traz a data (busca ativa), uma automação só vale para
  // comentários feitos DEPOIS que ela foi criada. Assim uma automação nova
  // nunca sai mandando DM para quem comentou semanas atrás.
  const quando = v?.timestamp ? paraData(v.timestamp) : null;
  const automacao = await acharAutomacao(texto, mediaId, quando);
  if (!automacao) return;

  // 4) Regra do 1 por dia (contas de teste passam direto).
  const ehTeste = TEST_ACCOUNTS.includes(fromId);
  if (!ehTeste && await recebeuNasUltimas24h(fromId)) {
    await log(fromId, automacao.id, "private_reply", "flow", "erro", "regra do 1 por dia");
    return;
  }

  // 5) Entrega o conteúdo.
  const resultado = await deliverAutomation(automacao, fromId, commentId, username);

  // 6) Se saiu ou ficou garantido na fila, responde no comentário também.
  if (resultado === "ok" || resultado === "throttled") {
    await responderComentario(commentId, automacao);
    await salvarLead(fromId, username, automacao, texto);
  }
}

// Procura a automação ativa que casa com o texto do comentário e com o post.
async function acharAutomacao(texto: string, mediaId: string, quando: Date | null = null) {
  const { data } = await db.from("ig_automations").select("*").eq("active", true);
  const lista = data ?? [];
  const t = normalizar(texto);
  const candidatas: { a: any; prioridade: number }[] = [];

  for (const a of lista) {
    // Comentário feito ANTES da última edição da automação: não dispara.
    // Assim, criar ou editar uma automação (por exemplo, adicionando um post que
    // já tem comentários) nunca manda DM para quem comentou antes.
    const referencia = a.updated_at ?? a.created_at;
    if (quando && referencia && new Date(referencia) > quando) continue;

    // O post precisa bater (array vazio = vale pra todos os posts).
    const posts: string[] = (a.media_ids ?? []).map(String);
    const postEspecifico = posts.length > 0;
    if (postEspecifico && mediaId && !posts.includes(mediaId)) continue;

    const palavras = String(a.keyword ?? "")
      .split(",").map((p: string) => normalizar(p)).filter(Boolean);
    const casa = a.match_any || palavras.some((p: string) => t.includes(p));
    if (!casa) continue;

    // Quando mais de uma automação serve, vence a mais específica:
    // post escolhido antes de "todos os posts", palavra antes de "qualquer palavra".
    candidatas.push({ a, prioridade: (postEspecifico ? 2 : 0) + (a.match_any ? 0 : 1) });
  }

  candidatas.sort((x, y) =>
    y.prioridade - x.prioridade ||
    String(y.a.updated_at ?? "").localeCompare(String(x.a.updated_at ?? ""))
  );
  return candidatas[0]?.a ?? null;
}

// Tira acento, deixa minúsculo e apara os espaços.
function normalizar(s: string) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Essa pessoa já recebeu uma DM nossa nas últimas 24 horas?
async function recebeuNasUltimas24h(igUserId: string) {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from("ig_deliveries")
    .select("id").eq("ig_user_id", igUserId).eq("status", "ok").gte("ts", desde).limit(1);
  return (data?.length ?? 0) > 0;
}

// =============================================================
// ENTREGA: sempre o PRIMEIRO passo do fluxo (a Mensagem 1).
// Não existe caminho separado de "mensagem com link": tanto o modo
// "Um link" quanto o "Continua a conversa" moram dentro do flow.
// =============================================================
async function deliverAutomation(
  automacao: any, igUserId: string, commentId: string, username: string,
): Promise<"ok" | "throttled" | "erro"> {
  const passos = automacao?.flow?.steps ?? [];
  if (passos.length === 0) return "erro";
  const primeiro = passos[0]; // sempre o primeiro do array, não procuramos id === 0

  // FREIO: pede uma ficha antes de mandar por resposta a comentário.
  const { data: temFicha, error: erroFreio } = await db.rpc("take_send_slot", { p_key: BUDGET_KEY });
  if (erroFreio) {
    console.error("Freio indisponível (a função take_send_slot existe no banco?):", erroFreio.message);
  }
  if (!temFicha) {
    // Sem ficha: guarda na fila, o robô ig-scheduler manda depois.
    await db.from("ig_send_queue").upsert({
      comment_id: commentId,
      automation_id: automacao.id,
      ig_user_id: igUserId,
      username,
      status: "pendente",
    }, { onConflict: "comment_id" });
    await log(igUserId, automacao.id, "private_reply", "flow", "na_fila", "sem ficha no freio");
    return "throttled";
  }

  // Manda o primeiro passo como RESPOSTA PRIVADA ao comentário.
  const envio = await sendStep(automacao, primeiro, { comment_id: commentId });

  await db.rpc("record_send_result", {
    p_key: BUDGET_KEY, p_ok: envio.ok, p_hard: envio.hard ?? false,
  });

  await log(
    igUserId, automacao.id, "private_reply", "flow",
    envio.ok ? "ok" : "erro", envio.motivo ?? "",
  );

  return envio.ok ? "ok" : "erro";
}

// =============================================================
// sendStep: O PULO DO GATO DOS BOTÕES.
//
// Manda um passo do fluxo com os botões ANEXADOS à mensagem
// (button template, colado no balão, estilo ManyChat).
// Se o Instagram recusar, cai pra pílula (quick_reply) e, por
// último, pra texto puro. Assim a mensagem nunca deixa de chegar.
// =============================================================
export async function sendStep(
  automacao: any,
  passo: any,
  destino: { id?: string; comment_id?: string },
): Promise<{ ok: boolean; hard?: boolean; motivo?: string }> {
  const texto = String(passo?.message ?? "").trim() || "Oi!";

  // Monta os botões. Botão sem destino (nem url nem next) é DESCARTADO:
  // pílula morta não vai pra ninguém.
  const botoes: any[] = [];
  for (const b of passo?.buttons ?? []) {
    const titulo = String(b?.title ?? "").slice(0, 20); // o Instagram corta em 20
    if (!titulo) continue;
    if (b?.url) {
      botoes.push({ type: "web_url", url: String(b.url), title: titulo });
    } else if (b?.next !== undefined && b?.next !== null && b?.next !== "") {
      // O payload carrega o id da automação, então duas automações com o
      // mesmo texto de botão nunca se misturam.
      botoes.push({ type: "postback", title: titulo, payload: `STEP:${automacao.id}:${b.next}` });
    }
  }

  // Limite de 3 botões no formato ANEXADO (o button template do Instagram).
  const anexados = botoes.slice(0, 3);

  // ---- Tentativa 1: botões anexados (button template) ----
  if (anexados.length > 0) {
    const r1 = await enviarMensagem(destino, {
      attachment: {
        type: "template",
        payload: { template_type: "button", text: texto.slice(0, 640), buttons: anexados },
      },
    });
    if (r1.ok) return { ok: true };
    console.warn("Button template recusado, tentando pílula (quick_reply):", r1.motivo);

    // ---- Tentativa 2: pílulas (quick_reply). Aqui cabem até 13. ----
    // Pílula não abre link, então o link vai junto no texto.
    const pilulas = botoes
      .filter((b) => b.type === "postback")
      .slice(0, 13)
      .map((b) => ({ content_type: "text", title: b.title, payload: b.payload }));
    const links = botoes.filter((b) => b.type === "web_url");
    const textoComLink = links.length
      ? `${texto}\n\n${links.map((l) => `${l.title}: ${l.url}`).join("\n")}`
      : texto;

    if (pilulas.length > 0) {
      const r2 = await enviarMensagem(destino, { text: textoComLink, quick_replies: pilulas });
      if (r2.ok) return { ok: true };
      console.warn("Pílula recusada, tentando texto puro:", r2.motivo);
    }

    // ---- Tentativa 3: texto puro (com o link no corpo, se houver) ----
    const r3 = await enviarMensagem(destino, { text: textoComLink });
    return r3.ok ? { ok: true } : { ok: false, hard: r3.hard, motivo: r3.motivo };
  }

  // Passo sem botão nenhum: só o texto.
  const r = await enviarMensagem(destino, { text: texto });
  return r.ok ? { ok: true } : { ok: false, hard: r.hard, motivo: r.motivo };
}

// Chamada crua da API de mensagens do Instagram.
async function enviarMensagem(
  destino: { id?: string; comment_id?: string },
  message: any,
): Promise<{ ok: boolean; hard?: boolean; motivo?: string }> {
  try {
    const resp = await fetch(`${GRAPH}/${IG_ACCOUNT_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: destino,   // { comment_id } = resposta privada, { id } = DM na conversa
        message,
        access_token: IG_TOKEN,
      }),
    });
    const json = await resp.json().catch(() => ({}));

    if (resp.ok && !json?.error) {
      // Guarda o mid pra ignorar o "echo" desse envio lá no recebimento.
      const mid = json?.message_id ?? json?.mid;
      if (mid) {
        await db.from("ig_bot_sends").upsert({ mid: String(mid), ig_user_id: destino.id ?? null });
      }
      return { ok: true };
    }

    const codigo = json?.error?.code;
    const motivo = json?.error?.message ?? `HTTP ${resp.status}`;
    // Falha "dura" = bloqueio, permissão ou limite da plataforma. Alimenta o disjuntor.
    const hard = [4, 10, 190, 200, 613, 551].includes(Number(codigo));
    return { ok: false, hard, motivo };
  } catch (e) {
    // Erro de rede é falha "mole": não pausa nada.
    return { ok: false, hard: false, motivo: String(e) };
  }
}

// Resposta pública no comentário (com variação A/B).
async function responderComentario(commentId: string, automacao: any) {
  const opcoes = [automacao.public_reply, ...(automacao.public_reply_variants ?? [])]
    .map((s: string) => String(s ?? "").trim()).filter(Boolean);
  if (opcoes.length === 0) return;
  const texto = opcoes[Math.floor(Math.random() * opcoes.length)];
  try {
    await fetch(`${GRAPH}/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: texto, access_token: IG_TOKEN }),
    });
  } catch (e) {
    console.warn("Não deu pra responder o comentário:", e);
  }
}

// =============================================================
// FLUXO DE MENSAGEM / TOQUE EM BOTÃO
// =============================================================
async function handleMessage(evento: any) {
  const remetente = String(evento?.sender?.id ?? "");
  const mid = String(evento?.message?.mid ?? "");

  if (!remetente) return;

  // Ignora "echo": mensagem que a própria conta mandou.
  if (evento?.message?.is_echo) return;
  if (IG_ACCOUNT_ID && remetente === IG_ACCOUNT_ID) return;
  if (mid) {
    const { data: meu } = await db.from("ig_bot_sends").select("mid").eq("mid", mid).maybeSingle();
    if (meu) return; // foi o próprio sistema que mandou
  }

  // Anti-repetição.
  const chave = mid || `pb:${remetente}:${evento?.postback?.payload ?? ""}:${evento?.timestamp ?? ""}`;
  if (await jaProcessado(`m:${chave}`)) return;

  // ---- Toque em botão: pode chegar como POSTBACK ou como QUICK_REPLY ----
  // Os DOIS precisam ser tratados, senão os botões podem simplesmente não funcionar.
  const payload =
    evento?.postback?.payload ??
    evento?.message?.quick_reply?.payload ??
    null;

  if (payload && String(payload).startsWith("STEP:")) {
    await avancarFluxo(String(payload), remetente);
    return;
  }

  const texto = String(evento?.message?.text ?? "").trim();
  if (texto) {
    const { data: lead } = await db.from("ig_leads")
      .select("*").eq("ig_user_id", remetente).maybeSingle();

    // ---- Coleta de dado: o passo anterior pediu um email ou telefone ----
    if (lead?.expecting?.field) {
      const campo = String(lead.expecting.field);
      const valido = campo === "email"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto)
        : texto.replace(/\D/g, "").length >= 10;

      if (!valido) {
        // Pede de novo, com jeitinho, e mantém o fluxo parado no mesmo ponto.
        await enviarMensagem({ id: remetente }, {
          text: campo === "email"
            ? "Acho que esse e-mail saiu com algum errinho. Pode mandar de novo?"
            : "Esse telefone parece incompleto. Pode mandar de novo com o DDD?",
        });
        return;
      }

      const atualizacao: any = { expecting: null };
      atualizacao[campo === "email" ? "email" : "telefone"] = texto;
      await db.from("ig_leads").update(atualizacao).eq("ig_user_id", remetente);

      // Segue pro próximo passo, se tiver.
      const proximo = lead.expecting.next;
      if (proximo !== undefined && proximo !== null && lead.automation_id) {
        await avancarFluxo(`STEP:${lead.automation_id}:${proximo}`, remetente);
      }
      return;
    }

    // ---- Toque em botão que chegou como TEXTO ----
    // Na busca ativa (e em algumas versões do Instagram), o toque no botão aparece
    // na conversa como uma mensagem com o nome do botão. Se o texto bate com um
    // botão do passo em que a pessoa está, a conversa avança.
    if (lead?.automation_id && lead?.flow_step) {
      const { data: auto } = await db.from("ig_automations")
        .select("*").eq("id", lead.automation_id).maybeSingle();
      const passos = auto?.flow?.steps ?? [];
      const alvo = normalizar(texto);
      const avancaCom = (p: any) => (p?.buttons ?? []).find((b: any) =>
        b?.next !== undefined && b?.next !== null && b?.next !== "" &&
        normalizar(String(b?.title ?? "")) === alvo
      );
      // Primeiro, os botões da mensagem em que a pessoa está. Se ela tocou num
      // botão de uma mensagem anterior, procura nas outras mensagens da conversa.
      const atual = passos.find((p: any) => String(p.id) === String(lead.flow_step));
      let botao = avancaCom(atual);
      if (!botao) {
        for (const p of passos) { botao = avancaCom(p); if (botao) break; }
      }
      if (auto?.active && botao) {
        await avancarFluxo(`STEP:${auto.id}:${botao.next}`, remetente);
        return;
      }
    }
  }

  // Mensagem de texto solta que não bate com nada: silêncio.
  // (Responder sem a pessoa ter pedido é justamente o que dá bloqueio.)
}

// Avança a conversa: acha a automação e o passo pelo payload e manda.
async function avancarFluxo(payload: string, igUserId: string) {
  // Formato: STEP:idDaAutomacao:idDoPasso
  const partes = payload.split(":");
  const automationId = partes[1];
  const stepId = partes.slice(2).join(":");
  if (!automationId || stepId === "") return;

  const { data: automacao } = await db.from("ig_automations")
    .select("*").eq("id", automationId).maybeSingle();
  if (!automacao) return;

  const passos = automacao?.flow?.steps ?? [];
  const passo = passos.find((p: any) => String(p.id) === String(stepId));
  if (!passo) return;

  // Aqui a janela de 24h já está aberta (a pessoa acabou de tocar no botão),
  // então mandamos direto pela DM da conversa.
  const envio = await sendStep(automacao, passo, { id: igUserId });

  await log(igUserId, automationId, "dm", "flow", envio.ok ? "ok" : "erro", envio.motivo ?? "");

  // Guarda em que passo a pessoa está.
  await db.from("ig_leads").upsert({
    ig_user_id: igUserId,
    automation_id: automationId,
    flow_step: String(stepId),
    last_source: "dm",
    // Se o passo pede um dado, anota o que estamos esperando.
    expecting: passo?.collect ?? null,
    // Se o passo tem botão que continua a conversa, fica de olho nas respostas.
    aguardando_ate: aguardandoAte(passo),
  }, { onConflict: "ig_user_id" });

  // Passo com atraso: agenda o próximo pro robô mandar depois.
  if (passo?.delay?.seconds && passo?.delay?.next !== undefined) {
    await db.from("ig_scheduled").insert({
      ig_user_id: igUserId,
      automation_id: automationId,
      step_id: String(passo.delay.next),
      send_at: new Date(Date.now() + Number(passo.delay.seconds) * 1000).toISOString(),
    });
  }
}

// =============================================================
// AJUDANTES
// =============================================================
async function salvarLead(igUserId: string, username: string, automacao: any, texto: string) {
  const passos = automacao?.flow?.steps ?? [];
  await db.from("ig_leads").upsert({
    ig_user_id: igUserId,
    username: username || null,
    last_source: "comment",
    last_keyword: texto.slice(0, 200),
    automation_id: automacao.id,
    flow_step: passos.length ? String(passos[0].id) : null,
    expecting: passos[0]?.collect ?? null,
    // A Mensagem 1 tem botão que continua a conversa? Então fica de olho no direct.
    aguardando_ate: passos.length ? aguardandoAte(passos[0]) : null,
  }, { onConflict: "ig_user_id" });
}

async function log(
  igUserId: string, automationId: string | null,
  canal: string, tipo: string, status: string, motivo: string,
) {
  await db.from("ig_deliveries").insert({
    ig_user_id: igUserId,
    automation_id: automationId,
    canal, tipo, status, motivo: motivo.slice(0, 500),
  });
}

// O Instagram manda datas como "2026-09-18T23:33:59+0000" (sem os dois-pontos
// no fuso). Normaliza para o formato padrão antes de converter.
function paraData(s: string) {
  return new Date(String(s ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}
