// =============================================================
// EDGE FUNCTION: ig-insights  (AS MÉTRICAS)
//
// Puxa da API do Instagram os números do dashboard:
//   - seguidores (total)
//   - novos seguidores por dia (últimos 15 dias)
//   - alcance por dia (últimos 15 dias)
//
// Devolve já mastigado, no formato que o painel espera.
// Chamada pelo frontend com o usuário logado (JWT do Supabase).
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

  // Sem token configurado ainda: devolve vazio, sem quebrar o painel.
  if (!IG_TOKEN || !IG_ACCOUNT_ID) {
    return new Response(JSON.stringify({ conectado: false, motivo: "Instagram ainda não conectado" }), { headers: cors });
  }

  try {
    const dias = 15;
    const ate = new Date();
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const since = Math.floor(desde.getTime() / 1000);
    const until = Math.floor(ate.getTime() / 1000);

    // 1) Perfil: total de seguidores.
    const perfilResp = await fetch(
      `${GRAPH}/${IG_ACCOUNT_ID}?fields=username,followers_count,media_count&access_token=${IG_TOKEN}`,
    );
    const perfil = await perfilResp.json();
    if (perfil?.error) throw new Error(perfil.error.message);

    // 2) Série diária: novos seguidores e alcance.
    const insightsResp = await fetch(
      `${GRAPH}/${IG_ACCOUNT_ID}/insights`
      + `?metric=follower_count,reach&period=day&since=${since}&until=${until}`
      + `&access_token=${IG_TOKEN}`,
    );
    const insights = await insightsResp.json();

    const serie = (nome: string) => {
      const m = (insights?.data ?? []).find((x: any) => x.name === nome);
      return (m?.values ?? []).map((v: any) => ({
        data: String(v.end_time ?? "").slice(0, 10),
        valor: Number(v.value ?? 0),
      }));
    };

    return new Response(JSON.stringify({
      conectado: true,
      username: perfil?.username ?? "",
      seguidores: Number(perfil?.followers_count ?? 0),
      posts: Number(perfil?.media_count ?? 0),
      novos_seguidores: serie("follower_count"),
      alcance: serie("reach"),
      aviso: insights?.error?.message ?? null,
    }), { headers: cors });
  } catch (e) {
    // Qualquer erro vira um "não conectado" educado, nunca uma tela quebrada.
    return new Response(JSON.stringify({ conectado: false, motivo: String(e) }), { headers: cors });
  }
});
