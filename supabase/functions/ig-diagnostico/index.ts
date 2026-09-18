// =============================================================
// EDGE FUNCTION: ig-diagnostico
//
// Ferramenta de diagnostico, protegida pelo SCHED_SECRET (x-sched-key).
//   GET  ?media_id=ID  -> identidade da conta, permissoes do token e
//                         os comentarios reais daquele post
//   POST ?comment_id=ID&media_id=ID
//                      -> reenvia um comentario REAL para o webhook,
//                         exatamente como o Meta enviaria. Serve para
//                         testar o processamento sem depender da entrega.
// =============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const IG = `https://graph.instagram.com/${GRAPH_VERSION}`;
const FB = `https://graph.facebook.com/${GRAPH_VERSION}`;
const APP_ID = "2231921544044388";

Deno.serve(async (req) => {
  if (!SCHED_SECRET || req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("não autorizado", { status: 401 });
  }
  const url = new URL(req.url);
  const mediaId = url.searchParams.get("media_id") ?? "";
  const out: Record<string, unknown> = {};

  if (req.method === "GET") {
    out.conta = await pegar(`${IG}/me?fields=user_id,username,account_type`);
    out.permissoes_do_token = await pegar(
      `${FB}/debug_token?input_token=${IG_TOKEN}&access_token=${encodeURIComponent(`${APP_ID}|${APP_SECRET}`)}`,
      false,
    );
    if (mediaId) {
      out.comentarios = await pegar(
        `${IG}/${mediaId}/comments?fields=id,text,timestamp,username,from,replies{id,text,username,timestamp}&limit=20`,
      );
    }
    if (url.searchParams.get("conversas")) {
      out.conversas = await pegar(
        `${IG}/me/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(8){id,message,from,created_time}&limit=5`,
      );
    }
    return json(out);
  }

  // POST: reenvia um comentario real ao webhook.
  const commentId = url.searchParams.get("comment_id") ?? "";
  const c = await pegar(`${IG}/${commentId}?fields=id,text,from,username,media`);
  out.comentario = c;
  const evento = {
    object: "instagram",
    entry: [{
      id: "reenvio",
      time: Math.floor(Date.now() / 1000),
      changes: [{
        field: "comments",
        value: {
          id: commentId,
          text: (c as any)?.text ?? "",
          from: (c as any)?.from ?? { id: "", username: (c as any)?.username ?? "" },
          media: { id: (c as any)?.media?.id ?? mediaId },
        },
      }],
    }],
  };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/instagram-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evento),
  });
  out.webhook_status = r.status;
  out.webhook_resposta = await r.text();
  return json(out);
});

async function pegar(u: string, comToken = true) {
  try {
    const r = await fetch(u, comToken ? { headers: { Authorization: `Bearer ${IG_TOKEN}` } } : {});
    const j = await r.json();
    // Nunca devolve o token.
    return JSON.parse(JSON.stringify(j).split(IG_TOKEN).join("OCULTO"));
  } catch (e) {
    return { erro: String(e) };
  }
}

function json(obj: unknown) {
  return new Response(JSON.stringify(obj, null, 2), { headers: { "Content-Type": "application/json" } });
}
