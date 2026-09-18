// =============================================================
// EDGE FUNCTION: ig-webhook-setup  (CADASTRO DO WEBHOOK NO APP)
//
// Le e corrige, pela API do Meta, o webhook cadastrado no APP
// (objeto "instagram"): para qual URL o Meta manda os eventos e
// quais campos estao assinados.
//
// Uso (protegido pelo segredo SCHED_SECRET, header x-sched-key):
//   GET  ?app_id=ID_DO_APP  -> mostra o cadastro atual
//   POST ?app_id=ID_DO_APP  -> cadastra a URL desta instalacao, com o
//                              VERIFY_TOKEN e os tres campos necessarios
//
// Precisa do App Secret do app do Meta (segredo APP_SECRET ou, se
// existir, META_APP_SECRET).
// =============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? Deno.env.get("APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") ?? "";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const CAMPOS = ["comments", "messages", "messaging_postbacks"];

Deno.serve(async (req) => {
  if (!SCHED_SECRET || req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get("app_id") ?? "";
  if (!appId) return json({ erro: "informe ?app_id=" }, 400);

  // Token de app: "id|segredo". So vive dentro desta funcao.
  const tokenApp = `${appId}|${APP_SECRET}`;
  const callback = `${SUPABASE_URL}/functions/v1/instagram-webhook`;
  const resposta: Record<string, unknown> = { callback_esperada: callback };

  resposta.antes = await lerCadastro(appId, tokenApp);

  if (req.method === "POST") {
    const corpo = new URLSearchParams({
      object: "instagram",
      callback_url: callback,
      verify_token: VERIFY_TOKEN,
      fields: CAMPOS.join(","),
      include_values: "true",
      access_token: tokenApp,
    });
    try {
      const r = await fetch(`${GRAPH}/${appId}/subscriptions`, { method: "POST", body: corpo });
      resposta.cadastro = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
    } catch (e) {
      resposta.cadastro = { erro: String(e) };
    }
    resposta.depois = await lerCadastro(appId, tokenApp);
  }

  return json(resposta);
});

async function lerCadastro(appId: string, tokenApp: string) {
  try {
    const r = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(tokenApp)}`);
    return await r.json();
  } catch (e) {
    return { erro: String(e) };
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
