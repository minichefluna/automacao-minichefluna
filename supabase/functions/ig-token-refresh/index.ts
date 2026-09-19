// =============================================================
// EDGE FUNCTION: ig-token-refresh  (RENOVA O TOKEN)
//
// O token long-lived do Instagram vale cerca de 60 dias. Esta função
// estende a validade dele. Roda 1x por semana pelo pg_cron.
//
// Detalhe importante: este endpoint NÃO leva a versão no caminho
// (é graph.instagram.com/refresh_access_token, sem o /v21.0).
//
// A renovação devolve um token. Ele é guardado na tabela ig_secrets
// (que só o servidor lê), e todas as funções usam o token de lá.
// Assim o sistema nunca fica com um token vencido.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_TOKEN_SEGREDO = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  // Porteiro: só entra quem tem o segredo.
  if (!SCHED_SECRET || req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }

  // Parte do token mais recente que o sistema conhece.
  let tokenAtual = IG_TOKEN_SEGREDO;
  try {
    const { data } = await db.from("ig_secrets").select("value").eq("id", "ig_access_token").maybeSingle();
    if (data?.value) tokenAtual = String(data.value);
  } catch { /* segue com o token do segredo */ }

  try {
    const url = "https://graph.instagram.com/refresh_access_token"
      + `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokenAtual)}`;

    const resp = await fetch(url);
    const json = await resp.json().catch(() => ({}));

    if (!resp.ok || json?.error || !json?.access_token) {
      const erro = json?.error?.message ?? `HTTP ${resp.status}`;
      await db.from("ig_token_status").upsert({
        id: "main", last_ok: false, last_error: erro, updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: false, erro }), { status: 200 });
    }

    // Guarda o token renovado. É dele que todas as funções passam a ler.
    await db.from("ig_secrets").upsert({
      id: "ig_access_token", value: String(json.access_token), updated_at: new Date().toISOString(),
    });

    // expires_in vem em segundos (cerca de 60 dias).
    const expiraEm = new Date(Date.now() + Number(json.expires_in ?? 0) * 1000).toISOString();

    await db.from("ig_token_status").upsert({
      id: "main",
      expires_at: expiraEm,
      last_ok: true,
      last_error: null,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    console.log("Token renovado e guardado. Nova validade:", expiraEm);
    return new Response(JSON.stringify({ ok: true, expires_at: expiraEm }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await db.from("ig_token_status").upsert({
      id: "main", last_ok: false, last_error: String(e), updated_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 200 });
  }
});
