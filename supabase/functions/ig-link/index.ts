// =============================================================
// EDGE FUNCTION: ig-link  (O RASTREIO DE CLIQUES)
//
// O Instagram não avisa quando alguém toca num botão de link. Então o
// botão aponta para esta função, que:
//   1. registra o clique (evento "link_clicado", na linha do tempo do lead);
//   2. redireciona na hora para o link de destino.
//
// Endereço: /functions/v1/ig-link?c=CODIGO
// Precisa ser PÚBLICA: supabase functions deploy ig-link --no-verify-jwt
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Robôs que abrem links para gerar pré-visualização. Não são cliques de gente.
const ROBOS = /facebookexternalhit|facebot|meta-externalagent|instagram.*bot|whatsapp|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|googlebot|bingbot|crawler|spider|preview|headless/i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const codigo = (url.searchParams.get("c") ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  if (!codigo) return new Response("Link inválido.", { status: 400 });

  const { data: link } = await db.from("ig_links")
    .select("codigo, ig_user_id, automation_id, titulo, url").eq("codigo", codigo).maybeSingle();

  // Só redireciona para endereços http(s) que o próprio sistema cadastrou.
  if (!link?.url || !/^https?:\/\//i.test(link.url)) {
    return new Response("Este link não existe mais.", { status: 404 });
  }

  const agente = req.headers.get("user-agent") ?? "";
  if (req.method === "GET" && !ROBOS.test(agente)) {
    try {
      await db.from("ig_events").insert({
        tipo: "link_clicado",
        ig_user_id: link.ig_user_id,
        automation_id: link.automation_id,
        texto: link.titulo,
        detalhe: link.url,
      });
    } catch { /* o clique nunca pode impedir o redirecionamento */ }
  }

  return new Response(null, {
    status: 302,
    headers: { Location: link.url, "Cache-Control": "no-store" },
  });
});
