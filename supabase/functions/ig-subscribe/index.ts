// =============================================================
// EDGE FUNCTION: ig-subscribe  (LIGA A ENTREGA DE EVENTOS)
//
// Na API com Instagram Login, cadastrar o webhook no app do Meta NAO
// basta: a conta do Instagram tambem precisa estar inscrita no app
// (endpoint subscribed_apps). Sem isso, o Meta nunca envia os
// comentarios e mensagens para o webhook, e nada acontece, sem erro.
//
// Uso (protegido pelo segredo SCHED_SECRET, header x-sched-key):
//   GET  -> mostra em quais campos a conta esta inscrita hoje
//   POST -> inscreve a conta em comments, messages e messaging_postbacks
// =============================================================

const IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

// Os campos que o sistema precisa receber.
const CAMPOS = ["comments", "messages", "messaging_postbacks"];

Deno.serve(async (req) => {
  // Porteiro: so entra quem tem o segredo.
  if (!SCHED_SECRET || req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }

  const resposta: Record<string, unknown> = {};

  // Estado atual da inscricao.
  resposta.antes = await lerInscricao();

  // POST: faz a inscricao nos campos necessarios.
  if (req.method === "POST") {
    try {
      const url = `${GRAPH}/me/subscribed_apps?subscribed_fields=${CAMPOS.join(",")}&access_token=${IG_TOKEN}`;
      const r = await fetch(url, { method: "POST" });
      resposta.inscricao = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
    } catch (e) {
      resposta.inscricao = { erro: String(e) };
    }
    resposta.depois = await lerInscricao();
  }

  return new Response(JSON.stringify(resposta, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});

async function lerInscricao() {
  try {
    const r = await fetch(`${GRAPH}/me/subscribed_apps?access_token=${IG_TOKEN}`);
    return await r.json();
  } catch (e) {
    return { erro: String(e) };
  }
}
