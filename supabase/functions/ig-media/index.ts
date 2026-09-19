// =============================================================
// EDGE FUNCTION: ig-media  (OS POSTS)
//
// Lista os posts da conta, com miniatura, pra alimentar o seletor
// "Em quais posts" do editor de automação.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Token renovado toda semana pelo ig-token-refresh (tabela ig_secrets).
// Sem ele no banco, usa o do segredo.
let IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function carregarToken() {
  try {
    const { data } = await db.from("ig_secrets").select("value").eq("id", "ig_access_token").maybeSingle();
    if (data?.value) IG_TOKEN = String(data.value);
  } catch { /* segue com o token do segredo */ }
}
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  await carregarToken();

  if (!IG_TOKEN || !IG_ACCOUNT_ID) {
    return new Response(JSON.stringify({ conectado: false, posts: [] }), { headers: cors });
  }

  try {
    const resp = await fetch(
      `${GRAPH}/${IG_ACCOUNT_ID}/media`
      + `?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp`
      + `&limit=50&access_token=${IG_TOKEN}`,
    );
    const json = await resp.json();
    if (json?.error) throw new Error(json.error.message);

    const posts = (json?.data ?? []).map((m: any) => ({
      id: String(m.id),
      legenda: String(m.caption ?? "").slice(0, 80),
      tipo: m.media_type,
      miniatura: m.thumbnail_url ?? m.media_url ?? "",
      link: m.permalink ?? "",
      data: String(m.timestamp ?? "").slice(0, 10),
    }));

    return new Response(JSON.stringify({ conectado: true, posts }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ conectado: false, posts: [], motivo: String(e) }), { headers: cors });
  }
});
