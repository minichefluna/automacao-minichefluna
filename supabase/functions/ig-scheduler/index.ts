// =============================================================
// EDGE FUNCTION: ig-scheduler  (O CARTEIRO)
//
// Roda a cada 1 minuto pelo pg_cron. Faz duas coisas:
//   1. Esvazia a fila (ig_send_queue): os envios que o freio segurou.
//   2. Manda os passos com atraso (ig_scheduled) que já venceram.
//
// Protegida pelo segredo SCHED_SECRET (header x-sched-key), pra
// ninguém de fora conseguir chamar.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUDGET_KEY = "private_reply";

// O Instagram só aceita resposta privada a um comentário por cerca de 7 dias.
const VALIDADE_COMENTARIO_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  // Porteiro: só entra quem tem o segredo.
  if (req.headers.get("x-sched-key") !== SCHED_SECRET || !SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }

  const resumo = { fila_enviados: 0, fila_expirados: 0, atrasados_enviados: 0 };

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
    if (envio.ok) resumo.atrasados_enviados++;
  }

  return new Response(JSON.stringify(resumo), {
    headers: { "Content-Type": "application/json" },
  });
});

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
