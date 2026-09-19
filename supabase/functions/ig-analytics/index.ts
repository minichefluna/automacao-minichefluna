// =============================================================
// EDGE FUNCTION: ig-analytics  (AS MÉTRICAS DO INSTAGRAM)
//
// Chamada pelo painel, com o usuário logado.
//
//   ?acao=conta&inicio=AAAA-MM-DD&fim=AAAA-MM-DD[&forcar=1]
//     Seguidores, alcance, contas engajadas, interações e a série por dia,
//     com a comparação com o período anterior de mesmo tamanho.
//
//   ?acao=conteudos[&forcar=1]
//     Os posts e reels com as métricas de cada um, e quantos leads cada
//     conteúdo gerou nas automações.
//
// Só devolve o que a API do Instagram realmente fornece. O que não existe
// volta como null, para o painel mostrar "não disponível".
//
// Os dias ficam guardados em cache (ig_insights_diario, ig_media_insights),
// então o painel abre rápido e o Instagram não é consultado à toa.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
let IG_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const DIA_MS = 86400000;
// Métricas somáveis dia a dia (a série do gráfico de engajamento).
const METRICAS_DIA = ["total_interactions", "likes", "comments", "shares", "saves", "views", "replies", "profile_links_taps"];
// Métricas pedidas no total do período (contas únicas ficam corretas só assim).
const METRICAS_TOTAL = ["reach", "accounts_engaged", ...METRICAS_DIA];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  await carregarToken();
  if (!IG_TOKEN || !IG_ACCOUNT_ID) return json({ conectado: false, motivo: "Instagram não conectado" });

  const url = new URL(req.url);
  const acao = url.searchParams.get("acao") ?? "conta";
  const forcar = url.searchParams.get("forcar") === "1";

  try {
    if (acao === "conteudos") return json(await conteudos(forcar));
    const inicio = url.searchParams.get("inicio") ?? isoDia(Date.now() - 29 * DIA_MS);
    const fim = url.searchParams.get("fim") ?? isoDia(Date.now() - 7 * 3600000);
    return json(await conta(inicio, fim, forcar));
  } catch (e) {
    return json({ conectado: false, motivo: String(e) });
  }
});

// =============================================================
// CONTA
// =============================================================
async function conta(inicio: string, fim: string, forcar: boolean) {
  // O dia do Instagram é o do horário do Pacífico (UTC-7 no horário de verão).
  // "Hoje" é o dia de lá: pedir um dia que ainda não começou é recusado.
  const hoje = isoDia(Date.now() - 7 * 3600000);
  if (fim > hoje) fim = hoje;
  if (inicio > fim) inicio = fim;
  const dias = listaDias(inicio, fim);
  const n = dias.length;
  const antFim = somaDias(inicio, -1);
  const antInicio = somaDias(inicio, -n);
  const limiteSeguidores = somaDias(hoje, -29); // follower_count só existe nos últimos 30 dias
  const avisos: string[] = [];

  // ---- 1) Série diária, a partir do cache ----
  const { data: cache } = await db.from("ig_insights_diario")
    .select("dia, metrica, valor, atualizado_em").gte("dia", inicio).lte("dia", fim);
  const guardado = new Map<string, { valor: number; em: number }>();
  for (const c of cache ?? []) guardado.set(`${c.dia}|${c.metrica}`, { valor: Number(c.valor), em: new Date(c.atualizado_em).getTime() });

  // Dias recentes ainda mudam: os últimos 3 dias são sempre buscados de novo.
  const recente = somaDias(hoje, -2);
  const precisa = (dia: string, metrica: string) => forcar || dia >= recente || !guardado.has(`${dia}|${metrica}`);

  const novos: { dia: string; metrica: string; valor: number }[] = [];

  // 1a) alcance e seguidores ganhos: série do próprio Instagram, em janelas de até 30 dias.
  const faltaReach = dias.filter((d) => precisa(d, "reach"));
  if (faltaReach.length) {
    for (const [a, b] of janelas(faltaReach[0], faltaReach[faltaReach.length - 1], 30)) {
      const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=reach&period=day&since=${unixDia(a)}&until=${unixDia(somaDias(b, 1))}`);
      if (j?.error) { avisos.push(`alcance: ${j.error.message}`); continue; }
      for (const v of serie(j, "reach")) if (v.dia >= inicio && v.dia <= fim) novos.push({ dia: v.dia, metrica: "reach", valor: v.valor });
    }
  }
  const diasSeg = dias.filter((d) => d >= limiteSeguidores && precisa(d, "follower_count"));
  if (diasSeg.length) {
    const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=follower_count&period=day&since=${unixDia(diasSeg[0])}&until=${unixDia(somaDias(diasSeg[diasSeg.length - 1], 1))}`);
    if (j?.error) avisos.push(`seguidores: ${j.error.message}`);
    for (const v of serie(j, "follower_count")) if (v.dia >= inicio && v.dia <= fim) novos.push({ dia: v.dia, metrica: "follower_count", valor: v.valor });
  }

  // 1b) engajamento dia a dia: uma chamada por dia, com todas as métricas somáveis.
  const faltaDia = dias.filter((d) => METRICAS_DIA.some((m) => precisa(d, m)));
  await emParalelo(faltaDia, 8, async (dia) => {
    const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=${METRICAS_DIA.join(",")}&period=day&metric_type=total_value&since=${unixDia(dia)}&until=${unixDia(somaDias(dia, 1))}`);
    if (j?.error) { avisos.push(`engajamento ${dia}: ${j.error.message}`); return; }
    for (const m of j?.data ?? []) {
      const valor = Number(m?.total_value?.value ?? 0);
      novos.push({ dia, metrica: String(m.name), valor });
    }
  });

  if (novos.length) {
    const agora = new Date().toISOString();
    for (let i = 0; i < novos.length; i += 500) {
      await db.from("ig_insights_diario").upsert(novos.slice(i, i + 500).map((x) => ({ ...x, atualizado_em: agora })));
    }
    for (const x of novos) guardado.set(`${x.dia}|${x.metrica}`, { valor: x.valor, em: Date.now() });
  }

  const valorDia = (dia: string, m: string) => guardado.get(`${dia}|${m}`)?.valor ?? null;
  const serieDiaria = dias.map((dia) => ({
    dia,
    reach: valorDia(dia, "reach"),
    follower_count: dia >= limiteSeguidores ? valorDia(dia, "follower_count") : null,
    ...Object.fromEntries(METRICAS_DIA.map((m) => [m, valorDia(dia, m)])),
  }));

  // ---- 2) Totais do período e do período anterior (contas únicas corretas) ----
  const [totais, totaisAnt] = await Promise.all([totaisPeriodo(inicio, fim, avisos), totaisPeriodo(antInicio, antFim, avisos)]);

  // Plano B: se o total do período falhar, as métricas SOMÁVEIS vêm da soma dos dias
  // (exata para elas). Alcance e contas engajadas contam pessoas únicas e não podem
  // ser somados dia a dia: esses ficam sem valor, em vez de um número inflado.
  for (const m of METRICAS_DIA) {
    if (totais[m] != null) continue;
    const valores = dias.map((d) => valorDia(d, m));
    if (valores.every((v) => v != null)) totais[m] = valores.reduce((t: number, v) => t + (v as number), 0);
  }

  // Novos seguidores: soma da série (só existe nos últimos 30 dias).
  const somaSeg = (a: string, b: string) => {
    if (a < limiteSeguidores) return null;
    let s = 0;
    for (const d of listaDias(a, b)) s += valorDia(d, "follower_count") ?? 0;
    return s;
  };
  totais.novos_seguidores = inicio >= limiteSeguidores
    ? somaSeg(inicio, fim)
    : (() => { let s = 0; for (const d of dias) if (d >= limiteSeguidores) s += valorDia(d, "follower_count") ?? 0; return s; })();
  totaisAnt.novos_seguidores = antInicio >= limiteSeguidores ? await (async () => {
    // O período anterior pode não estar no cache: busca a série dele.
    const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=follower_count&period=day&since=${unixDia(antInicio)}&until=${unixDia(somaDias(antFim, 1))}`);
    if (j?.error) return null;
    return serie(j, "follower_count").filter((v) => v.dia >= antInicio && v.dia <= antFim).reduce((t, v) => t + v.valor, 0);
  })() : null;

  // ---- 3) Alcance: seguidores x não seguidores ----
  let alcanceTipo: { seguidores: number; nao_seguidores: number } | null = null;
  let sSeg = 0, sNao = 0, ok = false;
  for (const [a, b] of janelas(inicio, fim, 30)) {
    const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type&since=${unixDia(a)}&until=${unixDia(somaDias(b, 1))}`);
    const res = j?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    for (const r of res) {
      const tipo = String(r?.dimension_values?.[0] ?? "");
      if (tipo === "FOLLOWER") { sSeg += Number(r.value ?? 0); ok = true; }
      if (tipo === "NON_FOLLOWER") { sNao += Number(r.value ?? 0); ok = true; }
    }
  }
  if (ok) alcanceTipo = { seguidores: sSeg, nao_seguidores: sNao };

  const perfil = await ig(`/${IG_ACCOUNT_ID}?fields=username,followers_count,media_count`);

  return {
    conectado: true,
    username: perfil?.username ?? null,
    seguidores: perfil?.followers_count ?? null,
    periodo: { inicio, fim, dias: n },
    anterior: { inicio: antInicio, fim: antFim },
    totais,
    anterior_totais: totaisAnt,
    alcance_tipo: alcanceTipo,
    serie: serieDiaria,
    disponibilidade: {
      seguidores_desde: limiteSeguidores,
      // Acima de 30 dias o Instagram só soma janelas: contas únicas ficam aproximadas.
      unicos_aproximados: n > 30,
    },
    avisos: [...new Set(avisos)].slice(0, 5),
    atualizado_em: new Date().toISOString(),
  };
}

// Totais de um período, somando janelas de até 30 dias (limite da API).
async function totaisPeriodo(inicio: string, fim: string, avisos: string[]) {
  const t: Record<string, number | null> = Object.fromEntries(METRICAS_TOTAL.map((m) => [m, null]));
  for (const [a, b] of janelas(inicio, fim, 30)) {
    const j = await ig(`/${IG_ACCOUNT_ID}/insights?metric=${METRICAS_TOTAL.join(",")}&period=day&metric_type=total_value&since=${unixDia(a)}&until=${unixDia(somaDias(b, 1))}`);
    if (j?.error) { avisos.push(`totais: ${j.error.message}`); continue; }
    for (const m of j?.data ?? []) {
      const v = m?.total_value?.value;
      if (v === undefined || v === null) continue;
      t[m.name] = (t[m.name] ?? 0) + Number(v);
    }
  }
  return t;
}

// =============================================================
// CONTEÚDOS
// =============================================================
async function conteudos(forcar: boolean) {
  // Posts e reels (até 100).
  const lista: any[] = [];
  let caminho: string | null = `/${IG_ACCOUNT_ID}/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count&limit=50`;
  while (caminho && lista.length < 100) {
    const j = await ig(caminho);
    if (j?.error) throw new Error(j.error.message);
    lista.push(...(j?.data ?? []));
    const prox = j?.paging?.next ? String(j.paging.next) : "";
    caminho = prox ? prox.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, "") : null;
  }

  const ids = lista.map((m) => String(m.id));
  const { data: cache } = await db.from("ig_media_insights").select("media_id, dados, atualizado_em").in("media_id", ids);
  const guardado = new Map((cache ?? []).map((c: any) => [String(c.media_id), c]));

  // Conteúdos recentes mudam rápido (6 horas); os de mais de 30 dias, uma vez por dia.
  const vencido = (m: any) => {
    const c: any = guardado.get(String(m.id));
    if (!c || forcar) return true;
    const idade = Date.now() - new Date(m.timestamp).getTime();
    const limite = idade > 30 * DIA_MS ? 24 * 3600000 : 6 * 3600000;
    return Date.now() - new Date(c.atualizado_em).getTime() > limite;
  };

  const atualizar = lista.filter(vencido);
  await emParalelo(atualizar, 6, async (m) => {
    const produto = String(m.media_product_type ?? "");
    const base = ["reach", "likes", "comments", "shares", "saved", "views", "total_interactions"];
    // "Seguidores gerados" (follows) só existe para posts do feed.
    const extras = produto === "FEED" ? ["follows", "profile_visits"] : [];
    let j = await ig(`/${m.id}/insights?metric=${[...base, ...extras].join(",")}`);
    if (j?.error) j = await ig(`/${m.id}/insights?metric=reach,likes,comments,shares,saved,total_interactions`);
    const dados: Record<string, number | null> = { follows: null, profile_visits: null };
    for (const x of j?.data ?? []) dados[x.name] = Number(x?.values?.[0]?.value ?? x?.total_value?.value ?? 0);
    if (dados.views === undefined) {
      const v = await ig(`/${m.id}/insights?metric=views`);
      dados.views = v?.error ? null : Number(v?.data?.[0]?.values?.[0]?.value ?? 0);
    }
    const registro = { media_id: String(m.id), dados, atualizado_em: new Date().toISOString() };
    await db.from("ig_media_insights").upsert(registro);
    guardado.set(String(m.id), registro);
  });

  // Quantas pessoas cada conteúdo levou às automações.
  const { data: ev } = await db.from("ig_events")
    .select("media_id, ig_user_id").in("tipo", ["comentario", "story_reply"]).in("media_id", ids);
  const pessoas = new Map<string, Set<string>>();
  for (const e of ev ?? []) {
    const k = String(e.media_id);
    if (!pessoas.has(k)) pessoas.set(k, new Set());
    pessoas.get(k)!.add(String(e.ig_user_id));
  }

  const tipoLegivel = (m: any) =>
    m.media_product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Post";

  return {
    conectado: true,
    conteudos: lista.map((m) => {
      const d: any = (guardado.get(String(m.id)) as any)?.dados ?? {};
      return {
        id: String(m.id),
        legenda: String(m.caption ?? "").slice(0, 140),
        tipo: tipoLegivel(m),
        miniatura: m.thumbnail_url ?? m.media_url ?? "",
        link: m.permalink ?? "",
        data: m.timestamp ?? null,
        metricas: {
          reach: d.reach ?? null,
          likes: d.likes ?? m.like_count ?? null,
          comments: d.comments ?? m.comments_count ?? null,
          shares: d.shares ?? null,
          saved: d.saved ?? null,
          views: d.views ?? null,
          total_interactions: d.total_interactions ?? null,
          follows: d.follows ?? null,
          leads: pessoas.get(String(m.id))?.size ?? 0,
        },
      };
    }),
    atualizado_em: new Date().toISOString(),
  };
}

// =============================================================
// AJUDANTES
// =============================================================
// Chamada à API com nova tentativa quando o Instagram marca o erro como temporário
// ("unexpected error, please retry"). Erros de limite de uso NÃO são repetidos:
// insistir neles é o que penaliza a conta.
async function ig(caminho: string, tentativas = 3): Promise<any> {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`${GRAPH}${caminho}`, { headers: { Authorization: `Bearer ${IG_TOKEN}` } });
      const j = await r.json();
      const e = j?.error;
      const temporario = e && (e.is_transient === true || [1, 2].includes(Number(e.code)) || /unexpected error|retry your request/i.test(String(e.message ?? "")));
      if (temporario && i < tentativas - 1) { await new Promise((ok) => setTimeout(ok, 500 * (i + 1))); continue; }
      return j;
    } catch (err) {
      if (i === tentativas - 1) return { error: { message: String(err) } };
      await new Promise((ok) => setTimeout(ok, 500 * (i + 1)));
    }
  }
  return { error: { message: "sem resposta do Instagram" } };
}

async function carregarToken() {
  try {
    const { data } = await db.from("ig_secrets").select("value").eq("id", "ig_access_token").maybeSingle();
    if (data?.value) IG_TOKEN = String(data.value);
  } catch { /* segue com o token do segredo */ }
}

// Série diária do Instagram: o valor com end_time T é do dia que terminou em T.
function serie(j: any, nome: string): { dia: string; valor: number }[] {
  const m = (j?.data ?? []).find((x: any) => x.name === nome);
  return (m?.values ?? []).map((v: any) => ({
    dia: isoDia(new Date(String(v.end_time).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime() - DIA_MS),
    valor: Number(v.value ?? 0),
  }));
}

// O "dia" do Instagram começa à meia-noite do horário do Pacífico (07:00 UTC no horário de verão).
function unixDia(dia: string) {
  return Math.floor(new Date(`${dia}T07:00:00Z`).getTime() / 1000);
}
function isoDia(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}
function somaDias(dia: string, n: number) {
  return isoDia(new Date(`${dia}T12:00:00Z`).getTime() + n * DIA_MS);
}
function listaDias(a: string, b: string) {
  const out: string[] = [];
  for (let d = a; d <= b; d = somaDias(d, 1)) out.push(d);
  return out;
}
function janelas(a: string, b: string, tamanho: number): [string, string][] {
  const out: [string, string][] = [];
  let ini = a;
  while (ini <= b) {
    const fimJ = somaDias(ini, tamanho - 1) < b ? somaDias(ini, tamanho - 1) : b;
    out.push([ini, fimJ]);
    ini = somaDias(fimJ, 1);
  }
  return out;
}
async function emParalelo<T>(itens: T[], limite: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const x = itens[i++]; await fn(x); }
  });
  await Promise.all(trabalhadores);
}
function json(obj: unknown) {
  return new Response(JSON.stringify(obj), { headers: cors });
}
