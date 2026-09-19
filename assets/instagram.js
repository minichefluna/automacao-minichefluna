/* =============================================================
   CENTRAL DO INSTAGRAM
   As cinco abas: Visão geral, Automações, Leads, Interações e Análises.

   Este arquivo é carregado ANTES do app.js e usa os ajudantes de lá
   ($, $$, esc, toast, sb, state, abrirEditor...) na hora em que as telas
   são desenhadas. Por isso aqui em cima só existem declarações.

   Regra de ouro: só mostramos o que a API do Instagram e o banco realmente
   fornecem. O que não existe aparece como "não disponível", nunca inventado.

   Como o arquivo está organizado:
     1. Estado e constantes
     2. Estrutura (cabeçalho, abas, filtro de período)
     3. Visão geral
     4. Automações (lista, métricas, detalhe)
     5. Leads (planilha e painel do lead)
     6. Interações (a central de eventos)
     7. Análises
     8. Componentes (gráficos, funil, linha do tempo, painel lateral)
     9. Ajudantes (datas, números, textos dos eventos)
   ============================================================= */

/* =============================================================
   1. ESTADO E CONSTANTES
   ============================================================= */

const IG_ABAS = [
  { id: "visao", rotulo: "📊 Visão geral" },
  { id: "automacoes", rotulo: "⚙️ Automações" },
  { id: "leads", rotulo: "👥 Leads" },
  { id: "interacoes", rotulo: "💬 Interações" },
  { id: "analises", rotulo: "📈 Análises" },
];

const IG_PERIODOS = [
  { id: "7", rotulo: "7 dias" },
  { id: "15", rotulo: "15 dias" },
  { id: "30", rotulo: "30 dias" },
  { id: "90", rotulo: "90 dias" },
  { id: "custom", rotulo: "Personalizado" },
];

const IG_ORIGENS = {
  comment: { rotulo: "Comentário", classe: "origem-comentario" },
  story_reply: { rotulo: "Story", classe: "origem-story" },
  dm: { rotulo: "Direct", classe: "origem-dm" },
};

// Os filtros de "Melhores conteúdos": rótulo e métrica usada para ordenar.
const IG_FILTROS_CONTEUDO = [
  { id: "melhores", rotulo: "Melhores", campo: "total_interactions" },
  { id: "curtidos", rotulo: "Mais curtidos", campo: "likes" },
  { id: "comentados", rotulo: "Mais comentados", campo: "comments" },
  { id: "compartilhados", rotulo: "Mais compartilhados", campo: "shares" },
  { id: "salvos", rotulo: "Mais salvos", campo: "saved" },
  { id: "vistos", rotulo: "Mais vistos", campo: "views" },
  { id: "alcance", rotulo: "Maior alcance", campo: "reach" },
  { id: "seguidores", rotulo: "Mais seguidores gerados", campo: "follows" },
];

// As séries do gráfico de engajamento (uma por vez, sempre na cor de destaque).
const IG_ENGAJAMENTO = [
  { id: "total_interactions", rotulo: "Interações" },
  { id: "likes", rotulo: "Curtidas" },
  { id: "comments", rotulo: "Comentários" },
  { id: "shares", rotulo: "Compartilhamentos" },
  { id: "saves", rotulo: "Salvamentos" },
  { id: "views", rotulo: "Visualizações" },
];

// Os grupos de eventos da aba Interações.
const IG_TIPOS_INTERACAO = [
  { id: "todos", rotulo: "Todos", tipos: null },
  { id: "comentarios", rotulo: "Comentários", tipos: ["comentario", "story_reply"] },
  { id: "dms", rotulo: "DMs", tipos: ["dm"] },
  { id: "respostas", rotulo: "Respostas", tipos: ["resposta", "botao", "dado"] },
  { id: "cliques", rotulo: "Cliques", tipos: ["link_clicado"] },
  { id: "leads", rotulo: "Leads", tipos: ["novo_lead"] },
];

const IG_PAGINA = 300;

const ig = {
  aba: "visao",
  periodo: { tipo: "30", inicio: "", fim: "" },
  conta: {},                 // métricas da conta, por período
  resumo: {},                // resumo do banco, por período
  analise: {},               // análises do banco, por período
  conteudos: null,           // posts e reels com métricas
  filtroConteudo: "melhores",
  engajamento: "total_interactions",
  metricasAuto: null,        // métricas de cada automação
  leads: [], leadsFim: false,
  filtroLeads: { busca: "", entrada: "", automacao: "", post: "", palavra: "", tag: "", status: "", clique: "", dm: "" },
  maisFiltrosLeads: false,
  ordemLeads: { campo: "ultima_interacao", desc: true },
  inter: [], interFim: false,
  filtroInter: { grupo: "todos", periodo: "30", busca: "", post: "", automacao: "", palavra: "", tag: "" },
  cabecalho: null,
};

/* =============================================================
   2. ESTRUTURA
   ============================================================= */

function renderInstagram() {
  if (!IG_ABAS.some((a) => a.id === ig.aba)) ig.aba = "visao";
  $("#conteudo").innerHTML = `
    ${faixaModoLocal()}
    <div class="ig-topo">
      <div>
        <h1>Instagram</h1>
        <p class="fraco">A central de controle da sua conta e das suas automações.</p>
      </div>
      <div class="ig-selos" id="ig-selos"></div>
    </div>
    <nav class="ig-abas" role="tablist" aria-label="Seções do Instagram">
      ${IG_ABAS.map((a) => `<button type="button" role="tab" class="ig-aba ${a.id === ig.aba ? "ativa" : ""}"
        aria-selected="${a.id === ig.aba}" data-ig-aba="${a.id}">${a.rotulo}</button>`).join("")}
    </nav>
    <div id="area-ig"></div>
    <div id="ig-painel" hidden></div>`;

  $$("[data-ig-aba]").forEach((b) => b.addEventListener("click", () => {
    ig.aba = b.dataset.igAba;
    renderInstagram();
  }));

  igSelos();
  if (ig.aba === "visao") igVisaoGeral();
  else if (ig.aba === "automacoes") renderListaAutomacoes();
  else if (ig.aba === "leads") igLeads();
  else if (ig.aba === "interacoes") igInteracoes();
  else igAnalises();
}

// Os selos do canto: validade do token e DMs entregues nas últimas 24 horas.
async function igSelos() {
  const alvo = $("#ig-selos");
  if (!alvo || !sb) return;
  try {
    if (!ig.cabecalho || Date.now() - ig.cabecalho.em > 60000) {
      const desde = new Date(Date.now() - 86400000).toISOString();
      const [tok, dms] = await Promise.all([
        sb.from("ig_token_status").select("expires_at, last_ok").eq("id", "main").maybeSingle(),
        sb.from("ig_deliveries").select("id", { count: "exact", head: true }).eq("status", "ok").gte("ts", desde),
      ]);
      ig.cabecalho = { em: Date.now(), token: tok.data, dms: dms.count ?? 0 };
    }
    const t = ig.cabecalho.token;
    const dias = t?.expires_at ? Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 86400000) : null;
    const saude = dias === null ? "neutro" : dias > 14 ? "ok" : dias > 3 ? "atencao" : "erro";
    alvo.innerHTML = `
      <span class="selo" title="O token é renovado sozinho toda semana">
        <span class="selo-ponto ${saude}"></span>${dias === null ? "Token sem data" : `Token: ${dias} dias`}
      </span>
      <span class="selo" title="DMs aceitas pelo Instagram nas últimas 24 horas">
        ${igNum(ig.cabecalho.dms)} DMs em 24h
      </span>`;
  } catch { /* os selos são só informativos */ }
}

// ---------- Filtro de período (Visão geral e Análises) ----------
function igBarraPeriodo(aoMudar) {
  const p = ig.periodo;
  const { inicio, fim } = igPeriodoDatas();
  return `
    <div class="ig-periodo">
      <div class="chips" role="radiogroup" aria-label="Período">
        ${IG_PERIODOS.map((x) => `<button type="button" role="radio" aria-checked="${p.tipo === x.id}"
          class="chip ${p.tipo === x.id ? "ativo" : ""}" data-periodo="${x.id}">${x.rotulo}</button>`).join("")}
      </div>
      <div class="ig-periodo-custom" ${p.tipo === "custom" ? "" : "hidden"}>
        <input type="date" id="ig-de" value="${esc(p.inicio || inicio)}" max="${igHoje()}" aria-label="De">
        <span class="fraco">até</span>
        <input type="date" id="ig-ate" value="${esc(p.fim || fim)}" max="${igHoje()}" aria-label="Até">
        <button type="button" class="botao pequeno" id="ig-aplicar">Aplicar</button>
      </div>
      <button type="button" class="botao pequeno fantasma" id="ig-atualizar" title="Buscar os dados mais recentes no Instagram">↻ Atualizar</button>
    </div>
    <p class="ig-periodo-legenda fraco pequeno">${igFaixaTexto(inicio, fim)}</p>`;
}

function igLigarPeriodo(aoMudar) {
  $$("[data-periodo]").forEach((b) => b.addEventListener("click", () => {
    ig.periodo.tipo = b.dataset.periodo;
    if (ig.periodo.tipo !== "custom") aoMudar(false);
    else { $(".ig-periodo-custom").hidden = false; $$("[data-periodo]").forEach((x) => x.classList.toggle("ativo", x === b)); }
  }));
  $("#ig-aplicar")?.addEventListener("click", () => {
    const de = $("#ig-de").value, ate = $("#ig-ate").value;
    if (!de || !ate || de > ate) { toast("Escolha um período válido: a data inicial vem antes da final."); return; }
    ig.periodo = { tipo: "custom", inicio: de, fim: ate };
    aoMudar(false);
  });
  $("#ig-atualizar")?.addEventListener("click", () => aoMudar(true));
}

function igPeriodoDatas() {
  const p = ig.periodo;
  if (p.tipo === "custom" && p.inicio && p.fim) return { inicio: p.inicio, fim: p.fim };
  const n = Number(p.tipo) || 30;
  const fim = igHoje();
  return { inicio: igSomaDias(fim, -(n - 1)), fim };
}
function igChavePeriodo() { const { inicio, fim } = igPeriodoDatas(); return `${inicio}|${fim}`; }
function igDiasPeriodo() { const { inicio, fim } = igPeriodoDatas(); return igListaDias(inicio, fim).length; }
// Intervalo em instantes (início do primeiro dia e início do dia seguinte ao último), no fuso do navegador.
function igIntervalo() {
  const { inicio, fim } = igPeriodoDatas();
  return { de: new Date(`${inicio}T00:00:00`).toISOString(), ate: new Date(`${igSomaDias(fim, 1)}T00:00:00`).toISOString() };
}

function igSemBanco(titulo) {
  $("#area-ig").innerHTML = `<div class="cartao"><div class="vazio">
    <h2>${esc(titulo)}</h2>
    <p>Esta área mostra dados reais do banco e do Instagram.<br>No modo de teste local não há banco conectado.</p>
  </div></div>`;
}

/* =============================================================
   3. VISÃO GERAL
   ============================================================= */

async function igVisaoGeral(forcar = false) {
  if (!sb) return igSemBanco("Visão geral");
  const area = $("#area-ig");
  const chave = igChavePeriodo();
  const rotuloAnt = igRotuloAnterior();

  area.innerHTML = `
    ${igBarraPeriodo()}
    <section class="ig-kpis" id="ig-kpis">${igEsqueleto(8, "kpi")}</section>
    <section class="ig-grade-2">
      <div class="cartao ig-grafico" id="ig-g-seguidores">${igCarregando("Crescimento do perfil")}</div>
      <div class="cartao ig-grafico" id="ig-g-alcance">${igCarregando("Alcance")}</div>
    </section>
    <section class="cartao ig-grafico" id="ig-g-engajamento">${igCarregando("Engajamento")}</section>
    <section class="cartao" id="ig-conteudos">${igCarregando("Melhores conteúdos")}</section>
    <section class="ig-grade-3">
      <div class="cartao" id="ig-funil">${igCarregando("Funil do lead")}</div>
      <div class="cartao" id="ig-saude">${igCarregando("Saúde das automações")}</div>
      <div class="cartao" id="ig-atividade">${igCarregando("Atividade recente")}</div>
    </section>`;
  igLigarPeriodo((f) => igVisaoGeral(f));

  // Tudo em paralelo; cada bloco aparece assim que o dado dele chega.
  const pConta = igCarregarConta(forcar);
  const pResumo = igCarregarResumo(forcar);
  igCarregarConteudos(forcar).then(() => { if (igChavePeriodo() === chave) igDesenharConteudos(); });
  igDesenharAtividade();

  const [conta, resumo] = await Promise.all([pConta, pResumo]);
  if (igChavePeriodo() !== chave || ig.aba !== "visao" || !$("#ig-kpis")) return;

  igDesenharKpis(conta, resumo, rotuloAnt);
  igDesenharSeguidores(conta);
  igDesenharAlcance(conta);
  igDesenharEngajamento(conta);
  igDesenharFunil($("#ig-funil"), resumo?.funil, "Funil do lead", "Pessoas únicas no período.");
  igDesenharSaude(resumo?.saude);
}

async function igCarregarConta(forcar) {
  const chave = igChavePeriodo();
  if (!forcar && ig.conta[chave]) return ig.conta[chave];
  const { inicio, fim } = igPeriodoDatas();
  try {
    const { data, error } = await sb.functions.invoke(
      `ig-analytics?acao=conta&inicio=${inicio}&fim=${fim}${forcar ? "&forcar=1" : ""}`, { method: "GET" });
    if (error) throw error;
    ig.conta[chave] = data;
    return data;
  } catch (e) {
    console.warn("ig-analytics indisponível:", e);
    return { conectado: false };
  }
}

async function igCarregarResumo(forcar) {
  const chave = igChavePeriodo();
  if (!forcar && ig.resumo[chave]) return ig.resumo[chave];
  const { de, ate } = igIntervalo();
  try {
    const { data, error } = await sb.rpc("ig_painel_resumo", { p_inicio: de, p_fim: ate });
    if (error) throw error;
    ig.resumo[chave] = data;
    return data;
  } catch (e) {
    console.warn("Resumo indisponível:", e);
    return null;
  }
}

async function igCarregarConteudos(forcar) {
  if (!forcar && ig.conteudos) return ig.conteudos;
  try {
    const { data, error } = await sb.functions.invoke(`ig-analytics?acao=conteudos${forcar ? "&forcar=1" : ""}`, { method: "GET" });
    if (error) throw error;
    ig.conteudos = data?.conectado ? data.conteudos ?? [] : [];
  } catch (e) {
    console.warn("Conteúdos indisponíveis:", e);
    ig.conteudos = ig.conteudos ?? [];
  }
  return ig.conteudos;
}

function igDesenharKpis(conta, resumo, rotuloAnt) {
  const t = conta?.totais ?? {};
  const a = conta?.anterior_totais ?? {};
  const ok = conta?.conectado;
  const nd = `<span class="nd" title="O Instagram não forneceu este dado">não disponível</span>`;
  const n = igDiasPeriodo();
  const segParcial = ok && conta.disponibilidade && igPeriodoDatas().inicio < conta.disponibilidade.seguidores_desde;

  const cartoes = [
    {
      rotulo: "Seguidores atuais",
      valor: ok && conta.seguidores != null ? igNum(conta.seguidores) : nd,
      rodape: ok && t.novos_seguidores != null ? `<span class="delta sobe">+${igNum(t.novos_seguidores)}</span> em ${n} dias` : "",
    },
    {
      rotulo: "Novos seguidores",
      valor: ok && t.novos_seguidores != null ? igNum(t.novos_seguidores) : nd,
      rodape: segParcial
        ? `<span class="fraco">o Instagram só informa os últimos 30 dias</span>`
        : igDelta(t.novos_seguidores, a.novos_seguidores, rotuloAnt),
    },
    { rotulo: "Leads captados", valor: resumo ? igNum(resumo.leads) : nd, rodape: resumo ? igDelta(resumo.leads, resumo.leads_anterior, rotuloAnt) : "" },
    {
      rotulo: "Alcance", valor: ok && t.reach != null ? igNum(t.reach) : nd,
      rodape: ok ? igDelta(t.reach, a.reach, rotuloAnt) : "",
      dica: conta?.disponibilidade?.unicos_aproximados ? "Contas únicas somadas por janelas de 30 dias (limite do Instagram)" : "Contas únicas alcançadas no período",
    },
    {
      rotulo: "Contas engajadas", valor: ok && t.accounts_engaged != null ? igNum(t.accounts_engaged) : nd,
      rodape: ok ? igDelta(t.accounts_engaged, a.accounts_engaged, rotuloAnt) : "",
    },
    { rotulo: "Interações", valor: ok && t.total_interactions != null ? igNum(t.total_interactions) : nd, rodape: ok ? igDelta(t.total_interactions, a.total_interactions, rotuloAnt) : "" },
    {
      rotulo: "Mensagens enviadas", valor: resumo ? igNum(resumo.mensagens) : nd,
      rodape: resumo ? igDelta(resumo.mensagens, resumo.mensagens_anterior, rotuloAnt) : "",
      dica: "DMs aceitas pelo Instagram no período",
    },
    {
      rotulo: "Cliques em links", valor: resumo ? igNum(resumo.cliques) : nd,
      rodape: resumo?.links_desde
        ? igDelta(resumo.cliques, resumo.cliques_anterior, rotuloAnt)
        : `<span class="fraco">medidos a partir dos próximos envios</span>`,
      dica: "Toques nos botões de link das DMs, contados pelo link de rastreio",
    },
  ];

  $("#ig-kpis").innerHTML = cartoes.map((c) => `
    <div class="kpi" ${c.dica ? `title="${esc(c.dica)}"` : ""}>
      <div class="rotulo">${c.rotulo}</div>
      <div class="kpi-valor">${c.valor}</div>
      <div class="kpi-rodape">${c.rodape || "&nbsp;"}</div>
    </div>`).join("");
}

function igDesenharSeguidores(conta) {
  const alvo = $("#ig-g-seguidores");
  if (!conta?.conectado) { alvo.innerHTML = igSemInstagram("Crescimento do perfil"); return; }
  const serie = conta.serie ?? [];
  const itens = serie.map((d) => ({
    rotulo: igDiaCurto(d.dia),
    valor: d.follower_count,
    dica: d.follower_count == null ? `${igDiaSemana(d.dia)}: sem dado` : `${igDiaSemana(d.dia)}: +${igNum(d.follower_count)}`,
  }));
  const total = conta.totais?.novos_seguidores;
  const semDado = itens.filter((i) => i.valor == null).length;
  alvo.innerHTML = `
    <header class="ig-grafico-topo">
      <h2>Crescimento do perfil</h2>
      <span class="fraco pequeno">novos seguidores por dia · passe o mouse</span>
    </header>
    <div class="ig-grafico-numero">${total != null ? `+${igNum(total)}` : "n/d"} <span>seguidores</span></div>
    <div class="ig-barras" id="ig-b-seg"></div>
    ${igResumoSerie(itens, "/dia")}
    ${semDado && semDado < itens.length ? `<p class="fraco pequeno ig-nota">Dias em cinza: o Instagram só informa seguidores ganhos nos últimos 30 dias.</p>` : ""}`;
  igBarras($("#ig-b-seg"), itens);
}

function igDesenharAlcance(conta) {
  const alvo = $("#ig-g-alcance");
  if (!conta?.conectado) { alvo.innerHTML = igSemInstagram("Alcance"); return; }
  const itens = (conta.serie ?? []).map((d) => ({
    rotulo: igDiaCurto(d.dia),
    valor: d.reach,
    dica: d.reach == null ? `${igDiaSemana(d.dia)}: sem dado` : `${igDiaSemana(d.dia)}: ${igNum(d.reach)} contas`,
  }));
  const tipo = conta.alcance_tipo;
  const totalTipo = tipo ? tipo.seguidores + tipo.nao_seguidores : 0;
  const pSeg = totalTipo ? Math.round((tipo.seguidores / totalTipo) * 100) : 0;
  alvo.innerHTML = `
    <header class="ig-grafico-topo">
      <h2>Alcance</h2>
      <span class="fraco pequeno">contas alcançadas por dia · passe o mouse</span>
    </header>
    <div class="ig-grafico-numero">${conta.totais?.reach != null ? igNum(conta.totais.reach) : "n/d"} <span>contas</span></div>
    <div class="ig-barras" id="ig-b-alc"></div>
    ${igResumoSerie(itens, "/dia")}
    ${tipo ? `
      <div class="ig-divisao" role="img" aria-label="${pSeg}% seguidores, ${100 - pSeg}% não seguidores">
        <span class="ig-divisao-a" style="width:${Math.max(pSeg, 1)}%"></span>
        <span class="ig-divisao-b" style="width:${Math.max(100 - pSeg, 1)}%"></span>
      </div>
      <div class="ig-divisao-legenda">
        <span><i class="marca-cor a"></i>Seguidores <strong>${igNum(tipo.seguidores)}</strong> (${pSeg}%)</span>
        <span><i class="marca-cor b"></i>Não seguidores <strong>${igNum(tipo.nao_seguidores)}</strong> (${100 - pSeg}%)</span>
      </div>` : `<p class="fraco pequeno ig-nota">Divisão entre seguidores e não seguidores não disponível.</p>`}`;
  igBarras($("#ig-b-alc"), itens);
}

function igDesenharEngajamento(conta) {
  const alvo = $("#ig-g-engajamento");
  if (!conta?.conectado) { alvo.innerHTML = igSemInstagram("Engajamento"); return; }
  const m = IG_ENGAJAMENTO.find((x) => x.id === ig.engajamento) ?? IG_ENGAJAMENTO[0];
  const total = conta.totais?.[m.id];
  const itens = (conta.serie ?? []).map((d) => ({
    rotulo: igDiaCurto(d.dia),
    valor: d[m.id],
    dica: d[m.id] == null ? `${igDiaSemana(d.dia)}: sem dado` : `${igDiaSemana(d.dia)}: ${igNum(d[m.id])} ${m.rotulo.toLowerCase()}`,
  }));
  alvo.innerHTML = `
    <header class="ig-grafico-topo ig-grafico-topo-linha">
      <div>
        <h2>Engajamento</h2>
        <span class="fraco pequeno">evolução por dia · passe o mouse</span>
      </div>
      <div class="chips chips-pequenos" role="radiogroup" aria-label="Métrica de engajamento">
        ${IG_ENGAJAMENTO.map((x) => `<button type="button" role="radio" aria-checked="${x.id === m.id}"
          class="chip ${x.id === m.id ? "ativo" : ""}" data-engaj="${x.id}">${x.rotulo}</button>`).join("")}
      </div>
    </header>
    <div class="ig-grafico-numero">${total != null ? igNum(total) : "n/d"} <span>${m.rotulo.toLowerCase()} no período</span></div>
    <div class="ig-barras ig-barras-alta" id="ig-b-eng"></div>
    ${igResumoSerie(itens, "/dia")}
    <div class="ig-mini-totais">
      ${IG_ENGAJAMENTO.filter((x) => x.id !== "total_interactions").map((x) => `
        <div><span class="fraco pequeno">${x.rotulo}</span><strong>${conta.totais?.[x.id] != null ? igNum(conta.totais[x.id]) : "n/d"}</strong></div>`).join("")}
    </div>`;
  igBarras($("#ig-b-eng"), itens);
  $$("[data-engaj]", alvo).forEach((b) => b.addEventListener("click", () => {
    ig.engajamento = b.dataset.engaj;
    igDesenharEngajamento(conta);
  }));
}

function igDesenharConteudos() {
  const alvo = $("#ig-conteudos");
  if (!alvo) return;
  const filtro = IG_FILTROS_CONTEUDO.find((f) => f.id === ig.filtroConteudo) ?? IG_FILTROS_CONTEUDO[0];
  const { inicio, fim } = igPeriodoDatas();
  const todos = ig.conteudos ?? [];
  const noPeriodo = todos.filter((c) => {
    const d = c.data ? igDataLocal(c.data) : "";
    return d >= inicio && d <= fim;
  });
  const base = ig.verTodosConteudos ? todos : noPeriodo;
  const lista = [...base]
    .filter((c) => filtro.campo !== "follows" || c.metricas?.follows != null)
    .sort((a, b) => Number(b.metricas?.[filtro.campo] ?? -1) - Number(a.metricas?.[filtro.campo] ?? -1))
    .slice(0, 12);

  alvo.innerHTML = `
    <header class="ig-secao-topo">
      <h2>🔥 Melhores conteúdos</h2>
      <span class="fraco pequeno">${ig.verTodosConteudos ? "todos os posts e reels" : "publicados no período"}</span>
    </header>
    <div class="chips chips-pequenos ig-rolagem-x" role="radiogroup" aria-label="Ordenar conteúdos">
      ${IG_FILTROS_CONTEUDO.map((f) => `<button type="button" role="radio" aria-checked="${f.id === filtro.id}"
        class="chip ${f.id === filtro.id ? "ativo" : ""}" data-filtro-conteudo="${f.id}">${f.rotulo}</button>`).join("")}
    </div>
    ${!todos.length
      ? `<div class="vazio pequeno-vazio"><p>Não foi possível carregar os conteúdos do Instagram.</p></div>`
      : !lista.length
        ? `<div class="vazio pequeno-vazio"><p>${filtro.campo === "follows"
            ? "O Instagram só informa seguidores gerados para posts do feed. Reels não têm esse dado."
            : "Nenhum post ou reel publicado neste período."}</p>
            ${!ig.verTodosConteudos ? `<button type="button" class="botao pequeno" data-ver-todos>Ver todos os conteúdos</button>` : ""}</div>`
        : `<div class="ig-conteudos">${lista.map((c, i) => igCartaoConteudo(c, i + 1, filtro.campo)).join("")}</div>
           ${!ig.verTodosConteudos && noPeriodo.length < todos.length
             ? `<button type="button" class="botao pequeno fantasma" data-ver-todos>Ver também conteúdos fora do período</button>`
             : ig.verTodosConteudos ? `<button type="button" class="botao pequeno fantasma" data-ver-periodo>Mostrar só os do período</button>` : ""}`}
    <p class="fraco pequeno ig-nota">Só aparecem conteúdos publicados pela sua conta. "Seguidores gerados" existe apenas para posts do feed.</p>`;

  $$("[data-filtro-conteudo]", alvo).forEach((b) => b.addEventListener("click", () => {
    ig.filtroConteudo = b.dataset.filtroConteudo; igDesenharConteudos();
  }));
  $$("[data-ver-todos]", alvo).forEach((b) => b.addEventListener("click", () => { ig.verTodosConteudos = true; igDesenharConteudos(); }));
  $$("[data-ver-periodo]", alvo).forEach((b) => b.addEventListener("click", () => { ig.verTodosConteudos = false; igDesenharConteudos(); }));
}

function igCartaoConteudo(c, pos, destaque) {
  const m = c.metricas ?? {};
  const v = (x) => (x == null ? "n/d" : igNumCurto(x));
  const linhas = [
    ["reach", "Alcance", m.reach], ["likes", "Curtidas", m.likes], ["comments", "Comentários", m.comments],
    ["shares", "Compart.", m.shares], ["saved", "Salvos", m.saved], ["views", "Visualiz.", m.views],
    ["follows", "Seguidores", m.follows], ["leads", "Leads", m.leads],
  ];
  return `
    <a class="ig-conteudo" href="${esc(c.link || "#")}" target="_blank" rel="noopener noreferrer" title="${esc(c.legenda || "Abrir no Instagram")}">
      <div class="ig-conteudo-img">
        ${c.miniatura ? `<img src="${esc(c.miniatura)}" alt="" loading="lazy">` : ""}
        <span class="ig-conteudo-pos">${pos}</span>
        <span class="ig-conteudo-tipo">${esc(c.tipo)}</span>
      </div>
      <div class="ig-conteudo-info">
        <div class="ig-conteudo-legenda">${esc(igResumoTexto(c.legenda, 60) || "Sem legenda")}</div>
        <div class="fraco pequeno">${c.data ? esc(igDataCurta(c.data)) : ""}</div>
        <dl class="ig-conteudo-metricas">
          ${linhas.map(([k, r, x]) => `<div class="${k === destaque ? "destacada" : ""}" ${x == null ? `title="O Instagram não fornece este dado para ${esc(c.tipo)}"` : ""}>
            <dt>${r}</dt><dd>${v(x)}</dd></div>`).join("")}
        </dl>
      </div>
    </a>`;
}

function igDesenharSaude(s) {
  const alvo = $("#ig-saude");
  if (!alvo) return;
  if (!s) { alvo.innerHTML = `<h2>🛡️ Saúde das automações</h2><p class="fraco">Não foi possível ler os envios.</p>`; return; }
  const total = s.entregues + s.falharam + s.cancelados + s.na_fila;
  const taxa = s.entregues + s.falharam ? Math.round((s.entregues / (s.entregues + s.falharam)) * 1000) / 10 : null;
  const pc = (x) => (total ? (x / total) * 100 : 0);
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>🛡️ Saúde das automações</h2><span class="fraco pequeno">envios no período</span></header>
    ${total ? `
      <div class="ig-saude-barra" role="img" aria-label="${s.entregues} entregues, ${s.falharam} falharam, ${s.cancelados} cancelados">
        <span class="ok" style="width:${pc(s.entregues)}%"></span>
        <span class="erro" style="width:${pc(s.falharam)}%"></span>
        <span class="fila" style="width:${pc(s.na_fila)}%"></span>
        <span class="cancel" style="width:${pc(s.cancelados)}%"></span>
      </div>
      <ul class="ig-saude-legenda">
        <li><i class="st ok">✓</i><strong>${igNum(s.entregues)}</strong> entregues</li>
        <li><i class="st erro">!</i><strong>${igNum(s.falharam)}</strong> falharam</li>
        <li><i class="st cancel">⊘</i><strong>${igNum(s.cancelados)}</strong> cancelados</li>
        ${s.na_fila ? `<li><i class="st fila">⏳</i><strong>${igNum(s.na_fila)}</strong> na fila</li>` : ""}
      </ul>
      <div class="ig-taxa">
        <span class="fraco pequeno">Taxa de entrega</span>
        <strong>${taxa == null ? "n/d" : `${String(taxa).replace(".", ",")}%`}</strong>
      </div>
      ${s.motivos?.length ? `
        <div class="rotulo" style="margin-top:14px">Motivos</div>
        <ul class="ig-lista-simples">${s.motivos.map((m) => `
          <li><span title="${esc(m.motivo)}">${esc(igMotivoLegivel(m.motivo))}</span><strong>${igNum(m.qtd)}</strong></li>`).join("")}</ul>` : ""}
      ${s.automacoes?.length ? `
        <div class="rotulo" style="margin-top:14px">Automações com falha</div>
        <ul class="ig-lista-simples">${s.automacoes.map((a) => `<li><span>${esc(a.nome)}</span><strong>${igNum(a.qtd)}</strong></li>`).join("")}</ul>` : ""}
      <p class="fraco pequeno ig-nota">Entregue = aceita pelo Instagram. Cancelado = barrado pela regra de uma mesma automação por pessoa a cada 24 horas (não é falha).</p>
    ` : `<div class="vazio pequeno-vazio"><p>Nenhum envio neste período.</p></div>`}`;
}

async function igDesenharAtividade() {
  const alvo = $("#ig-atividade");
  if (!alvo) return;
  try {
    const { data, error } = await sb.from("ig_atividade").select("*").order("ts", { ascending: false }).limit(14);
    if (error) throw error;
    alvo.innerHTML = `
      <header class="ig-secao-topo"><h2>⚡ Atividade recente</h2><span class="fraco pequeno">em tempo real</span></header>
      ${(data ?? []).length ? `<ul class="ig-feed">${data.map((e) => {
        const ev = igDescreverEvento(e);
        return `<li>
          <span class="ig-feed-icone ${ev.classe}" aria-hidden="true">${ev.icone}</span>
          <div class="ig-feed-texto">${ev.html}</div>
          <time class="fraco pequeno" datetime="${esc(e.ts)}" title="${esc(igDataHora(e.ts))}">${esc(igRelativo(e.ts))}</time>
        </li>`;
      }).join("")}</ul>` : `<div class="vazio pequeno-vazio"><p>Nada por aqui ainda.</p></div>`}`;
  } catch (e) {
    alvo.innerHTML = `<h2>⚡ Atividade recente</h2><p class="fraco">Não foi possível carregar.</p>`;
  }
}

/* =============================================================
   4. AUTOMAÇÕES
   ============================================================= */

// Lê as automações (do banco ou, no teste local, do navegador).
async function carregarAutomacoes() {
  if (sb) {
    try {
      const { data, error } = await sb.from("ig_automations")
        .select("*").order("updated_at", { ascending: false }).limit(1000);
      if (error) throw error;
      state.automacoes = data ?? [];
      return;
    } catch (e) {
      console.warn("Não deu pra ler as automações:", e);
    }
  }
  state.automacoes = lerLocal(CHAVE_AUTOS_LOCAIS, []);
}

async function igCarregarMetricasAuto(forcar = false) {
  if (!sb) return {};
  if (ig.metricasAuto && !forcar) return ig.metricasAuto;
  try {
    const { data, error } = await sb.rpc("ig_automacoes_metricas");
    if (error) throw error;
    ig.metricasAuto = Object.fromEntries((data ?? []).map((m) => [m.automation_id, m]));
  } catch (e) {
    console.warn("Métricas das automações indisponíveis:", e);
    ig.metricasAuto = {};
  }
  return ig.metricasAuto;
}

function renderListaAutomacoes() {
  const area = $("#area-ig");
  const lista = state.automacoes;
  const ativas = lista.filter((a) => a.active).length;

  area.innerHTML = `
    <div class="ig-secao-cabecalho">
      <p class="fraco">${lista.length} automaç${lista.length === 1 ? "ão" : "ões"} · ${ativas} ativa${ativas === 1 ? "" : "s"}</p>
      <button class="botao primario" id="btn-nova">+ Nova automação</button>
    </div>
    <div id="lista-autos"></div>`;
  $("#btn-nova").addEventListener("click", () => abrirEditor(null));

  const destino = $("#lista-autos");
  if (!lista.length) {
    destino.innerHTML = `
      <div class="cartao"><div class="vazio">
        <h2>Nenhuma automação ainda</h2>
        <p>Crie a primeira e veja a prévia da DM na hora.</p>
        <button class="botao primario" id="btn-nova-vazio" style="margin-top:16px">+ Nova automação</button>
      </div></div>`;
    $("#btn-nova-vazio").addEventListener("click", () => abrirEditor(null));
    return;
  }

  const m = ig.metricasAuto ?? {};
  destino.innerHTML = lista.map((a) => igCartaoAutomacao(a, m[a.id])).join("");

  $$("[data-editar]", destino).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirEditor(state.automacoes.find((a) => String(a.id) === b.dataset.editar));
  }));
  $$("[data-apagar]", destino).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation(); apagarAutomacao(b.dataset.apagar);
  }));
  $$("[data-ligar]", destino).forEach((c) => {
    c.addEventListener("click", (e) => e.stopPropagation());
    c.addEventListener("change", () => igLigarAutomacao(c.dataset.ligar, c.checked));
  });
  $$(".auto-card", destino).forEach((card) => {
    const abrir = () => igDetalheAutomacao(card.dataset.auto);
    card.addEventListener("click", abrir);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === card) abrir(); });
  });

  // As miniaturas e as métricas chegam depois: busca e redesenha.
  const falta = [];
  if (!state.midiaCarregada) falta.push(carregarPosts());
  if (!ig.metricasAuto) falta.push(igCarregarMetricasAuto());
  if (falta.length) Promise.all(falta).then(() => {
    if (ig.aba === "automacoes" && !state.ed && $("#lista-autos")) renderListaAutomacoes();
  });
}

function igCartaoAutomacao(a, met) {
  const ehStory = (a.tipo ?? "post") === "story";
  const qtd = (a.media_ids ?? []).length;
  const alcance = ehStory ? (qtd ? `${qtd} story${qtd > 1 ? "s" : ""}` : "qualquer story") : (qtd ? `${qtd} post${qtd > 1 ? "s" : ""}` : "todos os posts");
  const palavras = String(a.keyword ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const link = igPrimeiroLink(a);
  const v = (x) => (met ? igNum(x ?? 0) : "…");
  return `
    <article class="cartao auto-card" data-auto="${esc(a.id)}" tabindex="0" aria-label="Abrir detalhes de ${esc(a.nome || "automação")}">
      <div class="auto-card-topo">
        ${miniaturaAutomacao(a)}
        <div class="auto-card-meio">
          <div class="auto-card-nome">
            <strong>${esc(a.nome || "Sem nome")}</strong>
            <span class="tipo-auto ${ehStory ? "story" : ""}">${ehStory ? "Resposta ao story" : "Comentário"}</span>
          </div>
          <div class="auto-card-palavras">
            ${a.match_any ? `<span class="chip-palavra neutro">qualquer palavra</span>` : palavras.slice(0, 6).map((p) => `<span class="chip-palavra">${esc(p)}</span>`).join("")}
            ${palavras.length > 6 ? `<span class="fraco pequeno">+${palavras.length - 6}</span>` : ""}
            <span class="fraco pequeno">· ${esc(alcance)}</span>
          </div>
          <div class="auto-card-link fraco pequeno">🔗 ${link ? `<span title="${esc(link)}">${esc(igResumoTexto(link.replace(/^https?:\/\//, ""), 48))}</span>` : "sem link"}</div>
        </div>
        <div class="auto-card-acoes">
          <label class="interruptor" title="${a.active ? "Desligar" : "Ligar"}">
            <input type="checkbox" data-ligar="${esc(a.id)}" ${a.active ? "checked" : ""} aria-label="Automação ligada">
            <span class="trilho"></span>
          </label>
          <button type="button" class="botao pequeno" data-editar="${esc(a.id)}">Editar</button>
          <button type="button" class="botao pequeno perigo botao-icone-texto" data-apagar="${esc(a.id)}" aria-label="Excluir automação" title="Excluir">🗑</button>
        </div>
      </div>
      <dl class="auto-card-metricas">
        <div><dt>${ehStory ? "Respostas detectadas" : "Comentários detectados"}</dt><dd>${v(met?.entradas)}</dd></div>
        <div><dt>Pessoas</dt><dd>${v(met?.pessoas)}</dd></div>
        <div><dt>DMs enviadas</dt><dd>${v(met?.enviadas)}</dd></div>
        <div><dt>Entregues</dt><dd>${v(met?.entregues)}</dd></div>
        <div class="${met?.falhas ? "tem-falha" : ""}"><dt>Falharam</dt><dd>${v(met?.falhas)}</dd></div>
        <div><dt>Cliques</dt><dd>${link ? v(met?.cliques) : `<span class="fraco" title="Automação sem link">n/d</span>`}</dd></div>
        <div><dt>Leads gerados</dt><dd>${v(met?.leads)}</dd></div>
      </dl>
    </article>`;
}

// A foto do conteúdo vinculado, na frente do nome da automação.
function miniaturaAutomacao(a) {
  const ehStory = (a.tipo ?? "post") === "story";
  const ids = (a.media_ids ?? []).map(String);
  const fonte = ehStory ? state.stories : state.posts;
  const achado = ids.map((id) => fonte.find((m) => m.id === id)).find((m) => m?.miniatura);
  const extra = ids.length > 1 ? `<span class="mini-extra">+${ids.length - 1}</span>` : "";

  if (achado) {
    return `<div class="mini ${ehStory ? "mini-story" : ""}" title="${esc(achado.legenda || "")}">
      <img src="${esc(achado.miniatura)}" alt="" loading="lazy">${extra}
    </div>`;
  }
  const icone = ehStory
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="3.5"/></svg>`
    : ids.length
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
  const rotulo = ehStory ? (ids.length ? "Story fora do ar" : "Qualquer story") : (ids.length ? "Post" : "Todos os posts");
  return `<div class="mini mini-vazia ${ehStory ? "mini-story" : ""}" title="${rotulo}">${icone}${extra}</div>`;
}

async function igLigarAutomacao(id, ligada) {
  const a = state.automacoes.find((x) => String(x.id) === String(id));
  if (!a) return;
  a.active = ligada;
  try {
    if (sb) {
      const { error } = await sb.from("ig_automations").update({ active: ligada }).eq("id", id);
      if (error) throw error;
    } else {
      gravarLocal(CHAVE_AUTOS_LOCAIS, state.automacoes);
    }
    toast(ligada ? "Automação ligada." : "Automação desligada.", "sucesso");
  } catch (e) {
    a.active = !ligada;
    toast("Não deu pra mudar o status. Tente de novo.", "erro");
  }
  renderListaAutomacoes();
}

async function apagarAutomacao(id) {
  const auto = state.automacoes.find((a) => String(a.id) === String(id));
  if (!confirm(`Excluir a automação "${auto?.nome ?? ""}"? Isso não tem volta.`)) return;
  if (sb) {
    try {
      const { error } = await sb.from("ig_automations").delete().eq("id", id);
      if (error) throw error;
    } catch (e) { toast("Não deu pra excluir no banco.", "erro"); return; }
  }
  state.automacoes = state.automacoes.filter((a) => String(a.id) !== String(id));
  if (!sb) gravarLocal(CHAVE_AUTOS_LOCAIS, state.automacoes);
  igFecharPainel();
  renderListaAutomacoes();
  toast("Automação excluída.");
}

// O primeiro link que a automação envia (em qualquer mensagem da conversa).
function igPrimeiroLink(a) {
  for (const p of a?.flow?.steps ?? []) for (const b of p.buttons ?? []) if (b?.url) return String(b.url);
  return "";
}

async function igDetalheAutomacao(id) {
  const a = state.automacoes.find((x) => String(x.id) === String(id));
  if (!a) return;
  const met = (await igCarregarMetricasAuto())[a.id] ?? null;
  const ehStory = (a.tipo ?? "post") === "story";
  const palavras = String(a.keyword ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const fonte = ehStory ? state.stories : state.posts;
  const vinculados = (a.media_ids ?? []).map((mid) => fonte.find((m) => m.id === String(mid)) ?? { id: mid });
  const link = igPrimeiroLink(a);

  igAbrirPainel(`
    <header class="painel-topo">
      ${miniaturaAutomacao(a)}
      <div>
        <h2>${esc(a.nome || "Sem nome")}</h2>
        <span class="status-auto ${a.active ? "ligada" : ""}"><span class="ponto"></span>${a.active ? "Ligada" : "Desligada"}</span>
      </div>
    </header>

    <section class="painel-secao">
      <dl class="painel-fatos">
        <div><dt>Gatilho</dt><dd>${ehStory ? "Resposta ao story" : "Comentário em post ou reels"}</dd></div>
        <div><dt>Palavras-chave</dt><dd>${a.match_any ? "qualquer palavra" : palavras.map((p) => `<span class="chip-palavra">${esc(p)}</span>`).join(" ") || "nenhuma"}</dd></div>
        <div><dt>${ehStory ? "Stories" : "Posts"} vinculados</dt><dd>${vinculados.length
          ? `<div class="painel-midias">${vinculados.map((v) => v.miniatura
              ? `<img src="${esc(v.miniatura)}" alt="" title="${esc(v.legenda || "")}">`
              : `<span class="fraco pequeno">conteúdo fora do ar</span>`).join("")}</div>`
          : ehStory ? "qualquer story" : "todos os posts"}</dd></div>
        <div><dt>Link</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(igResumoTexto(link, 60))}</a>` : "sem link"}</dd></div>
        <div><dt>Última execução</dt><dd>${met?.ultima ? `${esc(igRelativo(met.ultima))} <span class="fraco pequeno">(${esc(igDataHora(met.ultima))})</span>` : "ainda não rodou"}</dd></div>
      </dl>
    </section>

    <section class="painel-secao">
      <h3>Desempenho</h3>
      <dl class="painel-numeros">
        <div><dt>${ehStory ? "Respostas" : "Comentários"}</dt><dd>${igNum(met?.entradas ?? 0)}</dd></div>
        <div><dt>Pessoas</dt><dd>${igNum(met?.pessoas ?? 0)}</dd></div>
        <div><dt>Enviadas</dt><dd>${igNum(met?.enviadas ?? 0)}</dd></div>
        <div><dt>Entregues</dt><dd>${igNum(met?.entregues ?? 0)}</dd></div>
        <div class="${met?.falhas ? "tem-falha" : ""}"><dt>Falharam</dt><dd>${igNum(met?.falhas ?? 0)}</dd></div>
        <div><dt>Canceladas</dt><dd>${igNum(met?.cancelados ?? 0)}</dd></div>
        <div><dt>Cliques</dt><dd>${link ? igNum(met?.cliques ?? 0) : "n/d"}</dd></div>
        <div><dt>Leads gerados</dt><dd>${igNum(met?.leads ?? 0)}</dd></div>
      </dl>
    </section>

    <section class="painel-secao" id="painel-funil-auto"></section>

    <section class="painel-secao">
      <h3>Histórico de execução</h3>
      <div id="painel-historico"><p class="fraco pequeno">Carregando...</p></div>
    </section>

    <footer class="painel-rodape">
      <button type="button" class="botao primario" id="painel-editar">Editar automação</button>
      <button type="button" class="botao perigo" id="painel-apagar">Excluir</button>
    </footer>`);

  igDesenharFunil($("#painel-funil-auto"), {
    entradas: met?.pessoas ?? 0, enviadas: null, entregues: null,
    responderam: met?.responderam ?? 0, link_enviado: null, clicaram: null,
  }, "Caminho das pessoas", "", met);
  $("#painel-editar").addEventListener("click", () => { igFecharPainel(); abrirEditor(a); });
  $("#painel-apagar").addEventListener("click", () => apagarAutomacao(a.id));

  try {
    const { data } = await sb.from("ig_atividade").select("*").eq("automation_id", a.id)
      .order("ts", { ascending: false }).limit(40);
    const alvo = $("#painel-historico");
    if (!alvo) return;
    alvo.innerHTML = (data ?? []).length
      ? igLinhaDoTempo(data, true)
      : `<p class="fraco pequeno">Nenhuma execução registrada ainda.</p>`;
  } catch {
    $("#painel-historico").innerHTML = `<p class="fraco pequeno">Não foi possível carregar o histórico.</p>`;
  }
}

/* =============================================================
   5. LEADS
   ============================================================= */

async function igLeads(recarregar = true) {
  if (!sb) return igSemBanco("Leads");
  const area = $("#area-ig");
  if (recarregar || !ig.leads.length) {
    area.innerHTML = `<div class="cartao"><p class="fraco">Carregando leads...</p></div>`;
    ig.leads = [];
    ig.leadsFim = false;
    await igCarregarLeads();
    if (!state.midiaCarregada) carregarPosts().then(() => { if (ig.aba === "leads") igDesenharTabelaLeads(); });
    if (!ig.conteudos) igCarregarConteudos(false).then(() => { if (ig.aba === "leads") igDesenharTabelaLeads(); });
  }
  if (ig.aba !== "leads") return;
  igDesenharLeads();
}

async function igCarregarLeads() {
  try {
    const inicio = ig.leads.length;
    const { data, error } = await sb.from("ig_leads_painel").select("*")
      .order("ultima_interacao", { ascending: false, nullsFirst: false })
      .range(inicio, inicio + IG_PAGINA - 1);
    if (error) throw error;
    ig.leads.push(...(data ?? []));
    ig.leadsFim = (data ?? []).length < IG_PAGINA;
  } catch (e) {
    console.warn("Não deu pra ler os leads:", e);
    toast("Não deu pra carregar os leads. Tente recarregar a página.", "erro");
    ig.leadsFim = true;
  }
}

function igStatusLead(l) {
  if (l.cliques > 0) return { id: "clicou", rotulo: "Clicou", classe: "st-clicou" };
  if (l.respondeu) return { id: "respondeu", rotulo: "Respondeu", classe: "st-respondeu" };
  if (l.dms_entregues > 0) return { id: "entregue", rotulo: "DM entregue", classe: "st-entregue" };
  if (l.dms_falhas > 0) return { id: "falhou", rotulo: "Falhou", classe: "st-falhou" };
  return { id: "novo", rotulo: "Novo", classe: "st-novo" };
}

function igDesenharLeads() {
  const area = $("#area-ig");
  const L = ig.leads;
  const f = ig.filtroLeads;
  const tags = [...new Set(L.flatMap((l) => l.tags ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const autos = [...new Set(L.map((l) => l.automacao_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const palavras = [...new Set(L.map((l) => l.palavra_chave).filter(Boolean).map((p) => p.toLowerCase()))].sort();
  const posts = [...new Set(L.map((l) => l.last_media_id).filter(Boolean))];
  const hoje = new Date().toDateString();
  const comContato = L.filter((l) => l.email || l.telefone).length;
  const clicaram = L.filter((l) => l.cliques > 0).length;
  const responderam = L.filter((l) => l.respondeu).length;
  const ativos = Object.values(f).filter(Boolean).length;

  area.innerHTML = `
    <section class="ig-kpis ig-kpis-4">
      <div class="kpi"><div class="rotulo">Leads</div><div class="kpi-valor">${igNum(L.length)}${ig.leadsFim ? "" : "+"}</div>
        <div class="kpi-rodape">${igNum(L.filter((l) => new Date(l.created_at).toDateString() === hoje).length)} novos hoje</div></div>
      <div class="kpi"><div class="rotulo">Responderam</div><div class="kpi-valor">${igNum(responderam)}</div>
        <div class="kpi-rodape">${L.length ? igPct(responderam, L.length) : "0%"} dos leads</div></div>
      <div class="kpi"><div class="rotulo">Clicaram</div><div class="kpi-valor">${igNum(clicaram)}</div>
        <div class="kpi-rodape">${L.length ? igPct(clicaram, L.length) : "0%"} dos leads</div></div>
      <div class="kpi"><div class="rotulo">Com contato</div><div class="kpi-valor">${igNum(comContato)}</div>
        <div class="kpi-rodape">e-mail ou telefone</div></div>
    </section>

    <div class="cartao ig-filtros">
      <div class="ig-filtros-linha">
        <input type="search" id="lf-busca" placeholder="Buscar por nome, @, palavra ou contato" value="${esc(f.busca)}" aria-label="Buscar lead">
        <select id="lf-entrada" aria-label="Período de entrada">
          ${[["", "Entrada: qualquer data"], ["1", "Últimas 24 horas"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"]]
            .map(([v, r]) => `<option value="${v}" ${f.entrada === v ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        <select id="lf-auto" aria-label="Automação">
          <option value="">Todas as automações</option>
          ${autos.map((a) => `<option value="${esc(a)}" ${f.automacao === a ? "selected" : ""}>${esc(a)}</option>`).join("")}
        </select>
        <select id="lf-status" aria-label="Status">
          ${[["", "Todos os status"], ["novo", "Novo"], ["entregue", "DM entregue"], ["respondeu", "Respondeu"], ["clicou", "Clicou"], ["falhou", "Falhou"]]
            .map(([v, r]) => `<option value="${v}" ${f.status === v ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        <button type="button" class="botao pequeno" id="lf-mais" aria-expanded="${ig.maisFiltrosLeads}">Mais filtros${ativos > 4 ? ` (${ativos})` : ""}</button>
        <button type="button" class="botao pequeno" id="lf-exportar">Exportar planilha</button>
      </div>
      <div class="ig-filtros-linha" ${ig.maisFiltrosLeads ? "" : "hidden"} id="lf-extra">
        <select id="lf-post" aria-label="Post de origem">
          <option value="">Todos os posts e stories</option>
          ${posts.map((p) => `<option value="${esc(p)}" ${f.post === p ? "selected" : ""}>${esc(igNomeMidia(p))}</option>`).join("")}
        </select>
        <select id="lf-palavra" aria-label="Palavra-chave">
          <option value="">Todas as palavras</option>
          ${palavras.map((p) => `<option value="${esc(p)}" ${f.palavra === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
        </select>
        <select id="lf-tag" aria-label="Etiqueta">
          <option value="">Todas as etiquetas</option>
          ${tags.map((t) => `<option value="${esc(t)}" ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <select id="lf-clique" aria-label="Clique no link">
          ${[["", "Clicou ou não"], ["sim", "Clicou no link"], ["nao", "Não clicou"]].map(([v, r]) => `<option value="${v}" ${f.clique === v ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        <select id="lf-dm" aria-label="Recebeu DM">
          ${[["", "Recebeu DM ou não"], ["sim", "Recebeu DM"], ["nao", "Não recebeu DM"]].map(([v, r]) => `<option value="${v}" ${f.dm === v ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        ${ativos ? `<button type="button" class="botao pequeno fantasma" id="lf-limpar">Limpar filtros</button>` : ""}
      </div>
    </div>
    <div id="tabela-leads"></div>`;

  const ligar = (id, campo, evento = "change") => $(id)?.addEventListener(evento, (e) => { f[campo] = e.target.value; igDesenharTabelaLeads(); });
  ligar("#lf-busca", "busca", "input");
  ligar("#lf-entrada", "entrada"); ligar("#lf-auto", "automacao"); ligar("#lf-status", "status");
  ligar("#lf-post", "post"); ligar("#lf-palavra", "palavra"); ligar("#lf-tag", "tag");
  ligar("#lf-clique", "clique"); ligar("#lf-dm", "dm");
  $("#lf-mais").addEventListener("click", () => { ig.maisFiltrosLeads = !ig.maisFiltrosLeads; igDesenharLeads(); });
  $("#lf-limpar")?.addEventListener("click", () => {
    ig.filtroLeads = { busca: "", entrada: "", automacao: "", post: "", palavra: "", tag: "", status: "", clique: "", dm: "" };
    igDesenharLeads();
  });
  $("#lf-exportar").addEventListener("click", igExportarLeads);
  igDesenharTabelaLeads();
}

function igLeadsFiltrados() {
  const f = ig.filtroLeads;
  const busca = f.busca.trim().toLowerCase();
  const desde = f.entrada ? Date.now() - Number(f.entrada) * 86400000 : 0;
  let lista = ig.leads.filter((l) => {
    if (desde && new Date(l.created_at).getTime() < desde) return false;
    if (f.automacao && l.automacao_nome !== f.automacao) return false;
    if (f.status && igStatusLead(l).id !== f.status) return false;
    if (f.post && String(l.last_media_id) !== f.post) return false;
    if (f.palavra && String(l.palavra_chave ?? "").toLowerCase() !== f.palavra) return false;
    if (f.tag && !(l.tags ?? []).includes(f.tag)) return false;
    if (f.clique === "sim" && !(l.cliques > 0)) return false;
    if (f.clique === "nao" && l.cliques > 0) return false;
    if (f.dm === "sim" && !(l.dms_entregues > 0)) return false;
    if (f.dm === "nao" && l.dms_entregues > 0) return false;
    if (busca) {
      const alvo = [l.nome, l.username, l.palavra_chave, l.last_keyword, l.email, l.telefone, ...(l.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
  const { campo, desc } = ig.ordemLeads;
  lista = [...lista].sort((a, b) => {
    let x = a[campo], y = b[campo];
    if (campo === "ultima_interacao") { x = x ?? a.updated_at; y = y ?? b.updated_at; }
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
    return desc ? -r : r;
  });
  return lista;
}

function igDesenharTabelaLeads() {
  const alvo = $("#tabela-leads");
  if (!alvo) return;
  const lista = igLeadsFiltrados();
  if (!ig.leads.length) {
    alvo.innerHTML = `<div class="cartao"><div class="vazio"><h2>Nenhum lead ainda</h2>
      <p>Quando alguém entrar por uma automação, aparece aqui com o caminho completo.</p></div></div>`;
    return;
  }
  const col = (rotulo, campo) => campo
    ? `<th scope="col"><button type="button" class="ordenar" data-ordenar="${campo}">${rotulo}${ig.ordemLeads.campo === campo ? (ig.ordemLeads.desc ? " ↓" : " ↑") : ""}</button></th>`
    : `<th scope="col">${rotulo}</th>`;

  alvo.innerHTML = `
    <p class="fraco pequeno ig-contagem">Mostrando ${igNum(lista.length)} de ${igNum(ig.leads.length)} carregados. Clique numa linha para ver o caminho do lead.</p>
    <div class="tabela-rolagem">
      <table class="planilha planilha-clicavel">
        <thead><tr>
          ${col("Pessoa", "username")}${col("Origem", "last_source")}${col("Automação", "automacao_nome")}
          ${col("Palavra-chave", "palavra_chave")}${col("Entrada", "created_at")}${col("Última interação", "ultima_interacao")}
          ${col("Interações", "interacoes")}${col("Caminho", null)}${col("Cliques", "cliques")}${col("Etiquetas", null)}${col("Status", null)}
        </tr></thead>
        <tbody>${lista.length ? lista.map(igLinhaLead).join("")
          : `<tr><td colspan="11" class="fraco" style="text-align:center;padding:26px">Nenhum lead com esses filtros.</td></tr>`}</tbody>
      </table>
    </div>
    ${ig.leadsFim ? "" : `<div class="ig-mais"><button type="button" class="botao" id="lf-carregar">Carregar mais</button></div>`}`;

  $$("[data-ordenar]", alvo).forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.ordenar;
    ig.ordemLeads = { campo: c, desc: ig.ordemLeads.campo === c ? !ig.ordemLeads.desc : true };
    igDesenharTabelaLeads();
  }));
  $$("tr[data-lead]", alvo).forEach((tr) => {
    tr.addEventListener("click", () => igPainelLead(tr.dataset.lead));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") igPainelLead(tr.dataset.lead); });
  });
  igAvataresReserva(alvo);
  $("#lf-carregar")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Carregando...";
    await igCarregarLeads(); igDesenharLeads();
  });
}

function igLinhaLead(l) {
  const origem = IG_ORIGENS[l.last_source] ?? { rotulo: l.last_source || "Outro", classe: "" };
  const midia = igMidia(l.last_media_id);
  const st = igStatusLead(l);
  const ultima = l.ultima_interacao ?? l.updated_at;
  const passos = [
    ["DM enviada", l.dms_enviadas > 0], ["DM entregue", l.dms_entregues > 0], ["Respondeu", !!l.respondeu],
    ["Link enviado", l.links_enviados > 0], ["Clicou", l.cliques > 0],
  ];
  return `<tr data-lead="${esc(l.ig_user_id)}" tabindex="0">
    <td>${igPessoa(l)}</td>
    <td><div class="origem-celula">
      ${midia?.miniatura ? `<img class="mini-origem" src="${esc(midia.miniatura)}" alt="" loading="lazy" title="${esc(midia.legenda || "")}">` : ""}
      <span class="badge-origem ${origem.classe}">${esc(origem.rotulo)}</span></div></td>
    <td>${l.automacao_nome ? esc(l.automacao_nome) : `<span class="fraco">sem automação</span>`}</td>
    <td>${l.palavra_chave ? `<span class="chip-palavra">${esc(l.palavra_chave)}</span>` : `<span class="fraco">n/d</span>`}</td>
    <td title="${esc(igDataHora(l.created_at))}">${esc(igDataCurta(l.created_at))}</td>
    <td title="${esc(igDataHora(ultima))}">${esc(igRelativo(ultima))}</td>
    <td class="numero">${igNum(l.interacoes ?? 0)}</td>
    <td><div class="caminho" aria-label="Caminho do lead">${passos.map(([r, ok]) =>
      `<span class="caminho-ponto ${ok ? "ok" : ""}" title="${r}: ${ok ? "sim" : "não"}"></span>`).join("")}</div></td>
    <td class="numero">${igNum(l.cliques ?? 0)}</td>
    <td><div class="tags-celula">${(l.tags ?? []).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}${(l.tags ?? []).length > 3 ? `<span class="fraco pequeno">+${l.tags.length - 3}</span>` : ""}</div></td>
    <td><span class="status-lead ${st.classe}">${st.rotulo}</span></td>
  </tr>`;
}

async function igPainelLead(igUserId) {
  const l = ig.leads.find((x) => String(x.ig_user_id) === String(igUserId))
    ?? (await sb.from("ig_leads_painel").select("*").eq("ig_user_id", igUserId).maybeSingle()).data;
  if (!l) return;
  const origem = IG_ORIGENS[l.last_source] ?? { rotulo: l.last_source || "Outro" };
  const midia = igMidia(l.last_media_id);
  const st = igStatusLead(l);
  const perfil = l.username ? `https://www.instagram.com/${encodeURIComponent(l.username)}/` : "";

  igAbrirPainel(`
    <header class="painel-topo">
      ${l.foto_url ? `<img class="avatar-lead avatar-grande" src="${esc(l.foto_url)}" alt="" data-inicial="${esc(igInicial(l))}">`
        : `<span class="avatar-lead avatar-grande avatar-inicial">${esc(igInicial(l))}</span>`}
      <div>
        <h2>${l.username ? `@${esc(l.username)}` : esc(l.nome || "Lead")}</h2>
        ${l.nome && l.username ? `<div class="fraco">${esc(l.nome)}</div>` : ""}
        <div class="painel-selos">
          <span class="status-lead ${st.classe}">${st.rotulo}</span>
          ${perfil ? `<a class="pequeno" href="${perfil}" target="_blank" rel="noopener noreferrer">Ver perfil ↗</a>` : ""}
        </div>
      </div>
    </header>

    <section class="painel-secao">
      <dl class="painel-fatos">
        <div><dt>Origem</dt><dd>${esc(origem.rotulo)}${midia ? `: <span class="painel-midia-inline">${midia.miniatura ? `<img src="${esc(midia.miniatura)}" alt="">` : ""}${esc(igResumoTexto(midia.legenda || midia.tipo || "conteúdo", 50))}</span>` : ""}</dd></div>
        <div><dt>Palavra-chave</dt><dd>${l.palavra_chave ? `<span class="chip-palavra">${esc(String(l.palavra_chave).toUpperCase())}</span>` : "n/d"}</dd></div>
        <div><dt>Data de entrada</dt><dd>${esc(igDataHora(l.created_at))}</dd></div>
        <div><dt>Automação</dt><dd>${esc(l.automacao_nome || "sem automação")}</dd></div>
        <div><dt>Contato</dt><dd>${[l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "", l.telefone ? esc(l.telefone) : ""].filter(Boolean).join(" · ") || `<span class="fraco">não informado</span>`}</dd></div>
        <div><dt>Etiquetas</dt><dd>
          <div class="tags-celula" id="painel-tags">${(l.tags ?? []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}
            <button type="button" class="botao-icone" id="painel-editar-tags" title="Editar etiquetas" aria-label="Editar etiquetas">✎</button></div>
        </dd></div>
      </dl>
    </section>

    <section class="painel-secao" id="painel-funil-lead"></section>

    <section class="painel-secao">
      <h3>Linha do tempo</h3>
      <div id="painel-linha"><p class="fraco pequeno">Carregando...</p></div>
    </section>`);

  igAvataresReserva($("#ig-painel"));
  igCaminhoLead($("#painel-funil-lead"), l);
  $("#painel-editar-tags").addEventListener("click", () => igEditarTags(l));

  try {
    const { data } = await sb.from("ig_atividade").select("*").eq("ig_user_id", l.ig_user_id)
      .order("ts", { ascending: true }).limit(300);
    const alvo = $("#painel-linha");
    if (alvo) alvo.innerHTML = (data ?? []).length ? igLinhaDoTempo(data, false) : `<p class="fraco pequeno">Nenhum evento registrado.</p>`;
  } catch {
    $("#painel-linha").innerHTML = `<p class="fraco pequeno">Não foi possível carregar a linha do tempo.</p>`;
  }
}

// As etapas do caminho de um lead, em ordem, marcando as que ele já cumpriu.
function igCaminhoLead(alvo, l) {
  const etapas = [
    [l.last_source === "story_reply" ? "Respondeu o story" : "Comentou", true],
    ["DM enviada", l.dms_enviadas > 0], ["DM entregue", l.dms_entregues > 0], ["Respondeu", !!l.respondeu],
    ["Link enviado", l.links_enviados > 0], ["Clicou", l.cliques > 0],
  ];
  alvo.innerHTML = `
    <h3>Caminho na automação</h3>
    <ol class="ig-etapas">
      ${etapas.map(([r, ok]) => `<li class="${ok ? "ok" : ""}"><span class="ig-etapa-marca">${ok ? "✓" : ""}</span>${r}</li>`).join("")}
      <li class="nd" title="O sistema não recebe dados de venda"><span class="ig-etapa-marca"></span>Conversão <small>não disponível</small></li>
    </ol>
    ${l.cliques > 1 ? `<p class="fraco pequeno">${igNum(l.cliques)} cliques no link.</p>` : ""}`;
}

function igEditarTags(l) {
  const celula = $("#painel-tags");
  if (!celula) return;
  celula.innerHTML = `<input type="text" class="entrada-tags" value="${esc((l.tags ?? []).join(", "))}" placeholder="Separe por vírgula" aria-label="Etiquetas">`;
  const campo = celula.querySelector("input");
  campo.focus();
  let feito = false;
  const salvar = async () => {
    if (feito) return;
    feito = true;
    const novas = [...new Set(campo.value.split(",").map((s) => s.trim()).filter(Boolean))];
    try {
      const { error } = await sb.from("ig_leads").update({ tags: novas }).eq("ig_user_id", l.ig_user_id);
      if (error) throw error;
      l.tags = novas;
      toast("Etiquetas salvas.", "sucesso");
    } catch { toast("Não deu pra salvar as etiquetas.", "erro"); }
    celula.innerHTML = `${(l.tags ?? []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}
      <button type="button" class="botao-icone" id="painel-editar-tags" title="Editar etiquetas" aria-label="Editar etiquetas">✎</button>`;
    $("#painel-editar-tags").addEventListener("click", () => igEditarTags(l));
    if (ig.aba === "leads") igDesenharTabelaLeads();
  };
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); salvar(); }
    if (e.key === "Escape") { e.stopPropagation(); feito = true; igPainelLead(l.ig_user_id); }
  });
  campo.addEventListener("blur", salvar);
}

function igExportarLeads() {
  const lista = igLeadsFiltrados();
  if (!lista.length) { toast("Não há leads para exportar com esses filtros."); return; }
  const cab = ["Nome", "Usuário", "Perfil", "Origem", "Post ou story de origem", "Automação", "Palavra-chave",
    "Entrada", "Última interação", "Interações", "DMs enviadas", "DMs entregues", "Respondeu", "Links enviados",
    "Clicou", "Cliques", "E-mail", "Telefone", "Etiquetas", "Status", "ID do Instagram"];
  const cel = (v) => { const s = String(v ?? ""); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = lista.map((l) => [
    l.nome, l.username ? `@${l.username}` : "", l.username ? `https://www.instagram.com/${l.username}/` : "",
    IG_ORIGENS[l.last_source]?.rotulo ?? l.last_source ?? "", igMidia(l.last_media_id)?.link ?? l.last_media_id ?? "",
    l.automacao_nome, l.palavra_chave, igDataHora(l.created_at), igDataHora(l.ultima_interacao ?? l.updated_at),
    l.interacoes, l.dms_enviadas, l.dms_entregues, l.respondeu ? "sim" : "não", l.links_enviados,
    l.cliques > 0 ? "sim" : "não", l.cliques, l.email, l.telefone, (l.tags ?? []).join(", "), igStatusLead(l).rotulo, l.ig_user_id,
  ].map(cel).join(";"));
  igBaixarCsv(`leads-${igHoje()}.csv`, [cab.join(";"), ...linhas]);
  toast(`${lista.length} lead(s) exportado(s).`, "sucesso");
}

/* =============================================================
   6. INTERAÇÕES
   ============================================================= */

async function igInteracoes(recarregar = true) {
  if (!sb) return igSemBanco("Interações");
  const area = $("#area-ig");
  if (recarregar) {
    area.innerHTML = `<div class="cartao"><p class="fraco">Carregando interações...</p></div>`;
    ig.inter = [];
    ig.interFim = false;
    await igCarregarInteracoes();
    if (!ig.conteudos) igCarregarConteudos(false).then(() => { if (ig.aba === "interacoes") igDesenharTabelaInter(); });
    if (!state.midiaCarregada) carregarPosts().then(() => { if (ig.aba === "interacoes") igDesenharTabelaInter(); });
  }
  if (ig.aba !== "interacoes") return;
  igDesenharInteracoes();
}

async function igCarregarInteracoes() {
  const f = ig.filtroInter;
  const grupo = IG_TIPOS_INTERACAO.find((g) => g.id === f.grupo) ?? IG_TIPOS_INTERACAO[0];
  try {
    let q = sb.from("ig_atividade").select("*").order("ts", { ascending: false });
    if (grupo.tipos) q = q.in("tipo", grupo.tipos);
    if (f.periodo) q = q.gte("ts", new Date(Date.now() - Number(f.periodo) * 86400000).toISOString());
    const inicio = ig.inter.length;
    const { data, error } = await q.range(inicio, inicio + IG_PAGINA - 1);
    if (error) throw error;
    ig.inter.push(...(data ?? []));
    ig.interFim = (data ?? []).length < IG_PAGINA;
  } catch (e) {
    console.warn("Não deu pra ler as interações:", e);
    toast("Não deu pra carregar as interações.", "erro");
    ig.interFim = true;
  }
}

function igDesenharInteracoes() {
  const area = $("#area-ig");
  const f = ig.filtroInter;
  const E = ig.inter;
  const autos = [...new Set(E.map((e) => e.automacao_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const tags = [...new Set(E.flatMap((e) => e.tags ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const palavras = [...new Set(E.filter((e) => ["comentario", "story_reply"].includes(e.tipo) && e.detalhe).map((e) => e.detalhe.toLowerCase()))].sort();
  const posts = [...new Set(E.map((e) => e.media_id).filter(Boolean))];

  area.innerHTML = `
    <div class="chips ig-tipos" role="radiogroup" aria-label="Tipo de interação">
      ${IG_TIPOS_INTERACAO.map((g) => `<button type="button" role="radio" aria-checked="${g.id === f.grupo}"
        class="chip ${g.id === f.grupo ? "ativo" : ""}" data-grupo="${g.id}">${g.rotulo}</button>`).join("")}
    </div>
    <div class="cartao ig-filtros">
      <div class="ig-filtros-linha">
        <input type="search" id="if-busca" placeholder="Buscar por usuário ou texto" value="${esc(f.busca)}" aria-label="Buscar">
        <select id="if-periodo" aria-label="Período">
          ${[["1", "Últimas 24 horas"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["", "Todo o período"]]
            .map(([v, r]) => `<option value="${v}" ${f.periodo === v ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        <select id="if-post" aria-label="Post">
          <option value="">Todos os posts e stories</option>
          ${posts.map((p) => `<option value="${esc(p)}" ${f.post === p ? "selected" : ""}>${esc(igNomeMidia(p))}</option>`).join("")}
        </select>
        <select id="if-auto" aria-label="Automação">
          <option value="">Todas as automações</option>
          ${autos.map((a) => `<option value="${esc(a)}" ${f.automacao === a ? "selected" : ""}>${esc(a)}</option>`).join("")}
        </select>
        <select id="if-palavra" aria-label="Palavra-chave">
          <option value="">Todas as palavras</option>
          ${palavras.map((p) => `<option value="${esc(p)}" ${f.palavra === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
        </select>
        <select id="if-tag" aria-label="Etiqueta">
          <option value="">Todas as etiquetas</option>
          ${tags.map((t) => `<option value="${esc(t)}" ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="tabela-inter"></div>`;

  $$("[data-grupo]").forEach((b) => b.addEventListener("click", () => { f.grupo = b.dataset.grupo; igInteracoes(true); }));
  $("#if-periodo").addEventListener("change", (e) => { f.periodo = e.target.value; igInteracoes(true); });
  $("#if-busca").addEventListener("input", (e) => { f.busca = e.target.value; igDesenharTabelaInter(); });
  [["#if-post", "post"], ["#if-auto", "automacao"], ["#if-palavra", "palavra"], ["#if-tag", "tag"]].forEach(([id, c]) =>
    $(id).addEventListener("change", (e) => { f[c] = e.target.value; igDesenharTabelaInter(); }));
  igDesenharTabelaInter();
}

function igInterFiltradas() {
  const f = ig.filtroInter;
  const busca = f.busca.trim().toLowerCase();
  return ig.inter.filter((e) => {
    if (f.post && String(e.media_id) !== f.post) return false;
    if (f.automacao && e.automacao_nome !== f.automacao) return false;
    if (f.palavra && String(e.detalhe ?? "").toLowerCase() !== f.palavra) return false;
    if (f.tag && !(e.tags ?? []).includes(f.tag)) return false;
    if (busca) {
      const alvo = [e.username, e.nome, e.texto, e.detalhe].filter(Boolean).join(" ").toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function igDesenharTabelaInter() {
  const alvo = $("#tabela-inter");
  if (!alvo) return;
  const lista = igInterFiltradas();
  if (!ig.inter.length) {
    alvo.innerHTML = `<div class="cartao"><div class="vazio"><h2>Nenhuma interação neste filtro</h2>
      <p>Comentários, respostas, DMs e cliques aparecem aqui assim que acontecem.</p></div></div>`;
    return;
  }
  alvo.innerHTML = `
    <p class="fraco pequeno ig-contagem">Mostrando ${igNum(lista.length)} de ${igNum(ig.inter.length)} carregadas. Clique numa linha para ver o lead.</p>
    <div class="tabela-rolagem">
      <table class="planilha planilha-clicavel">
        <thead><tr>
          <th scope="col">Usuário</th><th scope="col">Tipo</th><th scope="col">Conteúdo</th><th scope="col">Palavra-chave</th>
          <th scope="col">Automação</th><th scope="col">Data e hora</th><th scope="col">Última interação</th><th scope="col">Status</th>
        </tr></thead>
        <tbody>${lista.length ? lista.map(igLinhaInter).join("")
          : `<tr><td colspan="8" class="fraco" style="text-align:center;padding:26px">Nenhuma interação com esses filtros.</td></tr>`}</tbody>
      </table>
    </div>
    ${ig.interFim ? "" : `<div class="ig-mais"><button type="button" class="botao" id="if-carregar">Carregar mais</button></div>`}`;
  $$("tr[data-lead]", alvo).forEach((tr) => {
    tr.addEventListener("click", () => igPainelLead(tr.dataset.lead));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") igPainelLead(tr.dataset.lead); });
  });
  igAvataresReserva(alvo);
  $("#if-carregar")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Carregando...";
    await igCarregarInteracoes(); igDesenharTabelaInter();
  });
}

function igLinhaInter(e) {
  const ev = igDescreverEvento(e);
  const midia = igMidia(e.media_id);
  const conteudo = midia
    ? `<div class="origem-celula">${midia.miniatura ? `<img class="mini-origem" src="${esc(midia.miniatura)}" alt="" loading="lazy">` : ""}
        <span class="celula-texto" title="${esc(midia.legenda || "")}">${esc(igResumoTexto(midia.legenda || midia.tipo || "", 34))}</span></div>`
    : e.texto ? `<span class="celula-texto" title="${esc(e.texto)}">"${esc(igResumoTexto(e.texto, 40))}"</span>` : `<span class="fraco">n/d</span>`;
  const palavra = ["comentario", "story_reply"].includes(e.tipo) && e.detalhe ? `<span class="chip-palavra">${esc(e.detalhe)}</span>` : `<span class="fraco">n/d</span>`;
  return `<tr ${e.ig_user_id ? `data-lead="${esc(e.ig_user_id)}" tabindex="0"` : ""}>
    <td>${igPessoa(e)}</td>
    <td><span class="tipo-evento ${ev.classe}"><span aria-hidden="true">${ev.icone}</span>${esc(ev.rotulo)}</span></td>
    <td>${conteudo}</td>
    <td>${palavra}</td>
    <td>${e.automacao_nome ? esc(e.automacao_nome) : `<span class="fraco">n/d</span>`}</td>
    <td title="${esc(igRelativo(e.ts))}">${esc(igDataHora(e.ts))}</td>
    <td>${e.ultima_interacao ? esc(igRelativo(e.ultima_interacao)) : `<span class="fraco">n/d</span>`}</td>
    <td>${ev.status ? `<span class="status-evento ${ev.statusClasse}">${esc(ev.status)}</span>` : `<span class="status-evento">Registrado</span>`}</td>
  </tr>`;
}

/* =============================================================
   7. ANÁLISES
   ============================================================= */

async function igAnalises(forcar = false) {
  if (!sb) return igSemBanco("Análises");
  const area = $("#area-ig");
  const chave = igChavePeriodo();
  area.innerHTML = `
    ${igBarraPeriodo()}
    <section class="ig-kpis ig-kpis-4" id="an-kpis">${igEsqueleto(4, "kpi")}</section>
    <section class="ig-grade-3">
      <div class="cartao ig-grafico" id="an-leads">${igCarregando("Leads por dia")}</div>
      <div class="cartao ig-grafico" id="an-dms">${igCarregando("DMs entregues por dia")}</div>
      <div class="cartao ig-grafico" id="an-cliques">${igCarregando("Cliques por dia")}</div>
    </section>
    <section class="cartao" id="an-ranking">${igCarregando("Desempenho das automações")}</section>
    <section class="ig-grade-2">
      <div class="cartao" id="an-palavras">${igCarregando("Palavras-chave mais usadas")}</div>
      <div class="cartao" id="an-horas">${igCarregando("Horários de pico")}</div>
    </section>
    <section class="ig-grade-3">
      <div class="cartao" id="an-origem">${igCarregando("Origem dos leads")}</div>
      <div class="cartao" id="an-conteudos">${igCarregando("Conteúdos que mais geraram leads")}</div>
      <div class="cartao" id="an-pessoas">${igCarregando("Quem mais interage")}</div>
    </section>`;
  igLigarPeriodo((f) => igAnalises(f));

  const [an, resumo] = await Promise.all([igCarregarAnalise(forcar), igCarregarResumo(forcar)]);
  if (igChavePeriodo() !== chave || ig.aba !== "analises" || !$("#an-kpis")) return;
  if (!an) { $("#an-kpis").innerHTML = `<div class="cartao"><p class="fraco">Não foi possível carregar as análises.</p></div>`; return; }

  const fu = resumo?.funil ?? {};
  const s = resumo?.saude ?? {};
  const taxaEntrega = s.entregues + s.falharam ? igPct(s.entregues, s.entregues + s.falharam) : "n/d";
  const taxaResposta = fu.entregues ? igPct(fu.responderam, fu.entregues) : "n/d";
  const taxaClique = fu.link_enviado ? igPct(fu.clicaram, fu.link_enviado) : "n/d";
  const n = igDiasPeriodo();
  const totalLeads = (an.leads_dia ?? []).reduce((t, d) => t + d.valor, 0);
  $("#an-kpis").innerHTML = [
    ["Taxa de entrega", taxaEntrega, "DMs aceitas pelo Instagram, sem contar as canceladas"],
    ["Taxa de resposta", taxaResposta, "Pessoas que responderam ou tocaram num botão, entre as que receberam DM"],
    ["Taxa de clique", taxaClique, "Pessoas que clicaram, entre as que receberam link"],
    ["Leads por dia", igNum(Math.round((totalLeads / n) * 10) / 10), `Média no período de ${n} dias`],
  ].map(([r, v, d]) => `<div class="kpi" title="${esc(d)}"><div class="rotulo">${r}</div><div class="kpi-valor">${v}</div><div class="kpi-rodape fraco">${esc(d)}</div></div>`).join("");

  const serieDias = (lista) => {
    const mapa = new Map((lista ?? []).map((d) => [d.data, d.valor]));
    const { inicio, fim } = igPeriodoDatas();
    return igListaDias(inicio, fim).map((d) => ({ rotulo: igDiaCurto(d), valor: mapa.get(d) ?? 0, dica: `${igDiaSemana(d)}: ${igNum(mapa.get(d) ?? 0)}` }));
  };
  const mini = (id, titulo, lista, nota) => {
    const itens = serieDias(lista);
    const total = itens.reduce((t, i) => t + i.valor, 0);
    $(id).innerHTML = `
      <header class="ig-grafico-topo"><h2>${titulo}</h2></header>
      <div class="ig-grafico-numero">${igNum(total)} <span>no período</span></div>
      <div class="ig-barras" id="${id.slice(1)}-b"></div>
      ${nota ? `<p class="fraco pequeno ig-nota">${nota}</p>` : ""}`;
    igBarras($(`${id}-b`), itens);
  };
  mini("#an-leads", "Leads por dia", an.leads_dia);
  mini("#an-dms", "DMs entregues por dia", an.dms_dia);
  mini("#an-cliques", "Cliques por dia", an.cliques_dia, resumo?.links_desde ? "" : "Os cliques passam a ser medidos nos próximos envios com link.");

  igDesenharRanking(an.automacoes ?? []);
  igListaBarras($("#an-palavras"), "Palavras-chave mais usadas", (an.palavras ?? []).map((p) => ({ rotulo: p.palavra, valor: p.qtd })), "Nenhuma palavra registrada no período.");
  igDesenharHoras(an.horas ?? []);
  igDesenharOrigem(an.origem ?? {});
  igDesenharConteudosLeads(an.conteudos ?? []);
  igDesenharPessoas(an.pessoas ?? []);
  if (!ig.conteudos) igCarregarConteudos(false).then(() => { if (ig.aba === "analises") igDesenharConteudosLeads(an.conteudos ?? []); });
}

async function igCarregarAnalise(forcar) {
  const chave = igChavePeriodo();
  if (!forcar && ig.analise[chave]) return ig.analise[chave];
  const { de, ate } = igIntervalo();
  try {
    const { data, error } = await sb.rpc("ig_analise", { p_inicio: de, p_fim: ate });
    if (error) throw error;
    ig.analise[chave] = data;
    return data;
  } catch (e) {
    console.warn("Análise indisponível:", e);
    return null;
  }
}

function igDesenharRanking(lista) {
  const alvo = $("#an-ranking");
  const linhas = lista.filter((a) => a.entradas || a.enviadas || a.cliques);
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>Desempenho das automações</h2><span class="fraco pequeno">no período, ordenado por pessoas alcançadas</span></header>
    ${linhas.length ? `<div class="tabela-rolagem tabela-leve"><table class="planilha">
      <thead><tr><th scope="col">Automação</th><th scope="col" class="numero">Pessoas</th><th scope="col" class="numero">Enviadas</th>
        <th scope="col" class="numero">Entregues</th><th scope="col" class="numero">Taxa de entrega</th><th scope="col" class="numero">Responderam</th>
        <th scope="col" class="numero">Cliques</th><th scope="col" class="numero">Leads</th><th scope="col" class="numero">Falhas</th></tr></thead>
      <tbody>${linhas.map((a) => `<tr>
        <td><strong>${esc(a.nome)}</strong> <span class="tipo-auto ${a.tipo === "story" ? "story" : ""}">${a.tipo === "story" ? "Story" : "Post"}</span></td>
        <td class="numero">${igNum(a.entradas)}</td><td class="numero">${igNum(a.enviadas)}</td><td class="numero">${igNum(a.entregues)}</td>
        <td class="numero">${a.enviadas ? igPct(a.entregues, a.enviadas) : "n/d"}</td><td class="numero">${igNum(a.responderam)}</td>
        <td class="numero">${igNum(a.cliques)}</td><td class="numero">${igNum(a.leads)}</td>
        <td class="numero ${a.falhas ? "tem-falha" : ""}">${igNum(a.falhas)}</td></tr>`).join("")}</tbody>
    </table></div>` : `<div class="vazio pequeno-vazio"><p>Nenhuma automação rodou neste período.</p></div>`}`;
}

function igDesenharHoras(horas) {
  const alvo = $("#an-horas");
  const mapa = new Map(horas.map((h) => [h.hora, h.qtd]));
  const itens = Array.from({ length: 24 }, (_, h) => ({ rotulo: `${h}h`, valor: mapa.get(h) ?? 0, dica: `${h}h às ${h + 1}h: ${igNum(mapa.get(h) ?? 0)}` }));
  const total = itens.reduce((t, i) => t + i.valor, 0);
  const pico = itens.reduce((m, i) => (i.valor > m.valor ? i : m), itens[0]);
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>Horários de pico</h2><span class="fraco pequeno">comentários e respostas por hora</span></header>
    ${total ? `<div class="ig-barras" id="an-horas-b"></div>
      <div class="ig-eixo-24"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      <p class="fraco pequeno ig-nota">Pico às ${pico.rotulo}, com ${igNum(pico.valor)} interações.</p>`
      : `<div class="vazio pequeno-vazio"><p>Sem interações no período.</p></div>`}`;
  if (total) igBarras($("#an-horas-b"), itens, { semEixo: true });
}

function igDesenharOrigem(o) {
  const alvo = $("#an-origem");
  const post = o.post ?? 0, story = o.story ?? 0, total = post + story;
  const p = total ? Math.round((post / total) * 100) : 0;
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>Origem dos leads</h2><span class="fraco pequeno">pessoas no período</span></header>
    ${total ? `
      <div class="ig-divisao"><span class="ig-divisao-a" style="width:${Math.max(p, 1)}%"></span><span class="ig-divisao-b" style="width:${Math.max(100 - p, 1)}%"></span></div>
      <div class="ig-divisao-legenda">
        <span><i class="marca-cor a"></i>Comentários <strong>${igNum(post)}</strong> (${p}%)</span>
        <span><i class="marca-cor b"></i>Stories <strong>${igNum(story)}</strong> (${100 - p}%)</span>
      </div>` : `<div class="vazio pequeno-vazio"><p>Sem entradas no período.</p></div>`}`;
}

function igDesenharConteudosLeads(lista) {
  const alvo = $("#an-conteudos");
  if (!alvo) return;
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>Conteúdos que mais geraram leads</h2></header>
    ${lista.length ? `<ul class="ig-ranking">${lista.map((c, i) => {
      const m = igMidia(c.media_id);
      return `<li><span class="ig-ranking-pos">${i + 1}</span>
        ${m?.miniatura ? `<img class="mini-origem" src="${esc(m.miniatura)}" alt="">` : `<span class="mini-origem mini-vazia"></span>`}
        <span class="ig-ranking-nome">${esc(igNomeMidia(c.media_id))}</span><strong>${igNum(c.pessoas)}</strong></li>`;
    }).join("")}</ul>` : `<div class="vazio pequeno-vazio"><p>Nenhum conteúdo gerou leads no período.</p></div>`}`;
}

function igDesenharPessoas(lista) {
  const alvo = $("#an-pessoas");
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>Quem mais interage</h2><span class="fraco pequeno">eventos no período</span></header>
    ${lista.length ? `<ul class="ig-ranking">${lista.map((p, i) => `
      <li class="clicavel" data-lead="${esc(p.ig_user_id)}" tabindex="0"><span class="ig-ranking-pos">${i + 1}</span>
        ${igAvatar(p, "pequeno")}
        <span class="ig-ranking-nome">${p.username ? `@${esc(p.username)}` : esc(p.nome || "sem nome")}</span><strong>${igNum(p.qtd)}</strong></li>`).join("")}</ul>`
      : `<div class="vazio pequeno-vazio"><p>Sem interações no período.</p></div>`}`;
  $$("[data-lead]", alvo).forEach((li) => li.addEventListener("click", () => igPainelLead(li.dataset.lead)));
  igAvataresReserva(alvo);
}

/* =============================================================
   8. COMPONENTES
   ============================================================= */

// Gráfico de barras: uma série, na cor de destaque, com dica ao passar o mouse.
// Valor null = dia sem dado (barra cinza baixa), nunca um zero inventado.
function igBarras(container, itens, opcoes = {}) {
  if (!container) return;
  if (!itens.length) { container.innerHTML = `<p class="fraco pequeno">Sem dados para o período.</p>`; return; }
  const larg = 600, alt = 140, base = alt - 4, topo = 6;
  const valores = itens.map((i) => i.valor).filter((v) => v != null);
  const maximo = Math.max(1, ...valores);
  const passo = larg / itens.length;
  const lb = Math.max(2, Math.min(28, passo - Math.max(2, passo * 0.28)));

  const barras = itens.map((it, i) => {
    const x = i * passo + (passo - lb) / 2;
    const semDado = it.valor == null;
    const h = semDado ? 4 : Math.max(it.valor > 0 ? 3 : 1, ((base - topo) * it.valor) / maximo);
    return `<rect class="${semDado ? "gr-barra-nd" : "gr-barra"}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${lb.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, lb / 2).toFixed(1)}"></rect>
      <rect class="gr-alvo" x="${(i * passo).toFixed(1)}" y="0" width="${passo.toFixed(1)}" height="${alt}" data-i="${i}"><title>${esc(it.dica ?? "")}</title></rect>`;
  }).join("");

  container.innerHTML = `
    <svg class="gr-svg" viewBox="0 0 ${larg} ${alt}" preserveAspectRatio="none" role="img" aria-label="Gráfico de barras">
      <line class="gr-grade" x1="0" y1="${base}" x2="${larg}" y2="${base}"></line>
      ${barras}
    </svg>
    ${opcoes.semEixo ? "" : `<div class="gr-eixo-x"><span>${esc(itens[0].rotulo)}</span><span>${esc(itens[itens.length - 1].rotulo)}</span></div>`}
    <div class="gr-dica" role="status"></div>`;

  const dica = container.querySelector(".gr-dica");
  container.querySelectorAll(".gr-alvo").forEach((alvo) => {
    const mostrar = (ev) => {
      const it = itens[Number(alvo.dataset.i)];
      dica.textContent = it.dica ?? "";
      dica.classList.add("visivel");
      const caixa = container.getBoundingClientRect();
      dica.style.left = `${Math.min(Math.max(ev.clientX - caixa.left, 60), caixa.width - 60)}px`;
      dica.style.top = `${ev.clientY - caixa.top}px`;
      container.querySelectorAll(".gr-barra, .gr-barra-nd").forEach((b, j) => b.classList.toggle("apagada", j !== Number(alvo.dataset.i)));
    };
    alvo.addEventListener("mouseenter", mostrar);
    alvo.addEventListener("mousemove", mostrar);
    alvo.addEventListener("mouseleave", () => {
      dica.classList.remove("visivel");
      container.querySelectorAll(".apagada").forEach((b) => b.classList.remove("apagada"));
    });
  });
}

// "média X/dia · pico Y em dd/mm", como na referência.
function igResumoSerie(itens, sufixo) {
  const com = itens.filter((i) => i.valor != null);
  if (!com.length) return "";
  const media = com.reduce((t, i) => t + i.valor, 0) / com.length;
  const pico = com.reduce((m, i) => (i.valor > m.valor ? i : m), com[0]);
  return `<p class="ig-serie-resumo fraco pequeno">média <strong>${igNum(Math.round(media * 10) / 10)}${sufixo}</strong> · pico <strong>${igNum(pico.valor)}</strong> em ${esc(pico.rotulo)}</p>`;
}

// Lista com barras horizontais (ranking simples).
function igListaBarras(alvo, titulo, itens, vazio) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  alvo.innerHTML = `
    <header class="ig-secao-topo"><h2>${titulo}</h2></header>
    ${itens.length ? `<ul class="ig-barras-h">${itens.map((i) => `
      <li><span class="ig-barras-h-rotulo" title="${esc(i.rotulo)}">${esc(i.rotulo)}</span>
        <span class="ig-barras-h-trilho"><span style="width:${(i.valor / max) * 100}%"></span></span>
        <strong>${igNum(i.valor)}</strong></li>`).join("")}</ul>`
      : `<div class="vazio pequeno-vazio"><p>${vazio}</p></div>`}`;
}

// Funil: cada etapa com a largura relativa à primeira e a conversão da etapa anterior.
function igDesenharFunil(alvo, fu, titulo, nota, met) {
  if (!alvo) return;
  if (!fu && !met) { alvo.innerHTML = `<h2>${titulo}</h2><p class="fraco">Não foi possível calcular o funil.</p>`; return; }
  const etapas = met
    ? [["Comentou ou respondeu", met.pessoas], ["DM enviada", met.enviadas], ["DM entregue", met.entregues],
       ["Respondeu", met.responderam], ["Link enviado", met.links], ["Clicou", met.cliques]]
    : [["Comentou ou respondeu", fu.entradas], ["DM enviada", fu.enviadas], ["DM entregue", fu.entregues],
       ["Respondeu", fu.responderam], ["Link enviado", fu.link_enviado], ["Clicou", fu.clicaram]];
  const topo = Math.max(1, ...etapas.map(([, v]) => v ?? 0));
  const Tag = met ? "h3" : "h2";
  alvo.innerHTML = `
    <header class="ig-secao-topo"><${Tag}>${met ? titulo : `🎯 ${titulo}`}</${Tag}>${nota ? `<span class="fraco pequeno">${nota}</span>` : ""}</header>
    <ol class="ig-funil">
      ${etapas.map(([r, v], i) => {
        const ant = i ? etapas[i - 1][1] : null;
        const conv = i && ant ? igPct(v ?? 0, ant) : "";
        return `<li>
          <div class="ig-funil-linha"><span>${r}</span><strong>${v == null ? "n/d" : igNum(v)}</strong></div>
          <div class="ig-funil-trilho"><span style="width:${v ? Math.max(2, (v / topo) * 100) : 0}%"></span></div>
          ${conv ? `<div class="fraco pequeno">${conv} da etapa anterior</div>` : ""}
        </li>`;
      }).join("")}
      <li class="nd"><div class="ig-funil-linha"><span>Conversão</span><strong title="O sistema não recebe dados de venda">não disponível</strong></div></li>
    </ol>
    ${met ? `<p class="fraco pequeno ig-nota">Enviadas, entregues, links e cliques contam envios; as demais etapas contam pessoas.</p>` : ""}`;
}

// Linha do tempo de eventos (do lead ou da automação).
function igLinhaDoTempo(eventos, comPessoa) {
  return `<ol class="ig-linha">${eventos.map((e) => {
    const ev = igDescreverEvento(e, !comPessoa);
    return `<li class="${ev.classe}">
      <span class="ig-linha-icone" aria-hidden="true">${ev.icone}</span>
      <div><div class="ig-linha-texto">${ev.html}</div>
        <time class="fraco pequeno" datetime="${esc(e.ts)}">${esc(igDataHora(e.ts))} · ${esc(igRelativo(e.ts))}</time>
        ${ev.extra ? `<div class="ig-linha-extra">${ev.extra}</div>` : ""}</div>
    </li>`;
  }).join("")}</ol>`;
}

// ---------- Painel lateral ----------
function igAbrirPainel(html) {
  const p = $("#ig-painel");
  if (!p) return;
  p.innerHTML = `
    <div class="painel-fundo" data-fechar-painel></div>
    <aside class="painel" role="dialog" aria-modal="true" aria-label="Detalhes">
      <button type="button" class="painel-fechar" data-fechar-painel aria-label="Fechar">×</button>
      <div class="painel-corpo">${html}</div>
    </aside>`;
  p.hidden = false;
  document.body.classList.add("painel-aberto");
  $$("[data-fechar-painel]", p).forEach((b) => b.addEventListener("click", igFecharPainel));
  p.querySelector(".painel-fechar")?.focus();
  document.addEventListener("keydown", igEscPainel);
}
function igFecharPainel() {
  const p = $("#ig-painel");
  if (p) { p.hidden = true; p.innerHTML = ""; }
  document.body.classList.remove("painel-aberto");
  document.removeEventListener("keydown", igEscPainel);
}
function igEscPainel(e) { if (e.key === "Escape") igFecharPainel(); }

// ---------- Pessoa, avatar e mídia ----------
function igInicial(p) { return String(p?.nome || p?.username || "?").trim().charAt(0).toUpperCase() || "?"; }
function igAvatar(p, tamanho = "") {
  return p?.foto_url
    ? `<img class="avatar-lead ${tamanho}" src="${esc(p.foto_url)}" alt="" loading="lazy" data-inicial="${esc(igInicial(p))}">`
    : `<span class="avatar-lead avatar-inicial ${tamanho}">${esc(igInicial(p))}</span>`;
}
function igPessoa(p) {
  return `<div class="pessoa">${igAvatar(p)}<div>
    <div class="pessoa-nome">${esc(p.nome || p.username || "Sem nome")}</div>
    <span class="pessoa-user">${p.username ? `@${esc(p.username)}` : p.ig_user_id ? `id ${esc(p.ig_user_id)}` : ""}</span>
  </div></div>`;
}
// Foto de perfil que não carrega (os links do Instagram expiram): mostra a inicial.
function igAvataresReserva(raiz) {
  if (!raiz) return;
  $$("img.avatar-lead", raiz).forEach((img) => img.addEventListener("error", () => {
    const s = document.createElement("span");
    s.className = `${img.className} avatar-inicial`;
    s.textContent = img.dataset.inicial || "?";
    img.replaceWith(s);
  }));
}
function igMidia(id) {
  if (!id) return null;
  const k = String(id);
  const c = (ig.conteudos ?? []).find((m) => m.id === k);
  if (c) return c;
  const p = (state.posts ?? []).find((m) => m.id === k) ?? (state.stories ?? []).find((m) => m.id === k);
  return p ? { ...p, tipo: (state.stories ?? []).some((m) => m.id === k) ? "Story" : "Post" } : null;
}
function igNomeMidia(id) {
  const m = igMidia(id);
  if (!m) return "Conteúdo fora do ar";
  const quando = m.data ? ` · ${igDataCurta(m.data)}` : "";
  return `${m.tipo || "Post"}${quando}: ${igResumoTexto(m.legenda || "sem legenda", 36)}`;
}

// ---------- Estados de carregamento ----------
function igCarregando(titulo) {
  return `<header class="ig-secao-topo"><h2>${titulo}</h2></header><div class="esqueleto esqueleto-bloco"></div>`;
}
function igEsqueleto(n, tipo) {
  return Array.from({ length: n }, () => `<div class="${tipo} esqueleto-kpi"><div class="esqueleto esqueleto-linha"></div><div class="esqueleto esqueleto-numero"></div></div>`).join("");
}
function igSemInstagram(titulo) {
  return `<header class="ig-secao-topo"><h2>${titulo}</h2></header>
    <div class="vazio pequeno-vazio"><p>Conecte seu Instagram para ver este gráfico.</p></div>`;
}

/* =============================================================
   9. AJUDANTES
   ============================================================= */

// Descreve um evento: ícone, texto e status (para o feed, a tabela e a linha do tempo).
function igDescreverEvento(e, semPessoa = false) {
  const quem = semPessoa ? "" : `<strong>${e.username ? `@${esc(e.username)}` : esc(e.nome || "Alguém")}</strong> `;
  const alvo = semPessoa ? "" : ` para <strong>${e.username ? `@${esc(e.username)}` : "a pessoa"}</strong>`;
  const texto = e.texto ? `"${esc(igResumoTexto(e.texto, 70))}"` : "";
  const auto = e.automacao_nome ? ` <span class="fraco">· ${esc(e.automacao_nome)}</span>` : "";
  switch (e.tipo) {
    case "comentario": return { icone: "💬", classe: "ev-entrada", rotulo: "Comentário",
      html: `${quem}comentou ${texto}${auto}`,
      extra: e.detalhe ? `Palavra-chave identificada: <span class="chip-palavra">${esc(e.detalhe)}</span>` : "" };
    case "story_reply": return { icone: "📷", classe: "ev-entrada", rotulo: "Resposta ao story",
      html: `${quem}respondeu seu story ${texto}${auto}`,
      extra: e.detalhe ? `Palavra-chave identificada: <span class="chip-palavra">${esc(e.detalhe)}</span>` : "" };
    case "novo_lead": return { icone: "✨", classe: "ev-lead", rotulo: "Novo lead", html: `${semPessoa ? "Virou lead" : `Novo lead: ${quem}`}${auto}` };
    case "resposta": return { icone: "↩", classe: "ev-resposta", rotulo: "Resposta", html: `${quem}respondeu ${texto}${auto}` };
    case "botao": return { icone: "👆", classe: "ev-resposta", rotulo: "Tocou no botão", html: `${quem}tocou no botão ${texto}${auto}` };
    case "dado": return { icone: "📝", classe: "ev-resposta", rotulo: "Informou dado",
      html: `${quem}informou ${e.detalhe === "email" ? "o e-mail" : "o telefone"}${auto}` };
    case "link_enviado": return { icone: "🔗", classe: "ev-link", rotulo: "Link enviado", html: `Link ${texto} enviado${alvo}${auto}` };
    case "link_clicado": return { icone: "🖱", classe: "ev-clique", rotulo: "Clique", html: `${quem}clicou no link ${texto}${auto}` };
    case "dm": {
      const s = e.status;
      if (s === "ok") return { icone: "✓", classe: "ev-ok", rotulo: "DM", status: "Entregue", statusClasse: "ok",
        html: `DM entregue${alvo}${auto}` };
      if (s === "cancelado") return { icone: "⊘", classe: "ev-cancel", rotulo: "DM", status: "Cancelada", statusClasse: "cancel",
        html: `DM não enviada${alvo}: já recebeu esta automação nas últimas 24 horas${auto}` };
      if (s === "na_fila") return { icone: "⏳", classe: "ev-fila", rotulo: "DM", status: "Na fila", statusClasse: "fila",
        html: `DM na fila${alvo}, aguardando o limite de envio${auto}` };
      return { icone: "!", classe: "ev-erro", rotulo: "DM", status: "Falhou", statusClasse: "erro",
        html: `Falha ao enviar DM${alvo}${auto}`, extra: e.detalhe ? `Motivo: ${esc(igMotivoLegivel(e.detalhe))}` : "" };
    }
    default: return { icone: "•", classe: "", rotulo: e.tipo, html: `${quem}${esc(e.tipo)}${auto}` };
  }
}

// Mensagens de erro da API em português, quando conhecidas.
function igMotivoLegivel(m) {
  const s = String(m ?? "");
  if (/regra do 1 por dia/i.test(s)) return "Mesma automação nas últimas 24 horas (cancelado)";
  if (/invalid for a private reply|private antworten|private reply/i.test(s)) return "Comentário não aceita mais resposta privada";
  if (/outside of allowed window|24.?hour/i.test(s)) return "Fora da janela de 24 horas do Instagram";
  if (/does not exist|cannot be loaded/i.test(s)) return "Conteúdo ou pessoa não encontrado";
  if (/limit|too many/i.test(s)) return "Limite de envio do Instagram";
  if (/sem ficha/i.test(s)) return "Aguardando o freio de envio";
  return s || "sem detalhe";
}

function igDelta(atual, anterior, rotuloAnt) {
  if (atual == null) return "";
  if (anterior == null) return `<span class="fraco">sem comparação disponível</span>`;
  if (anterior === 0) return atual > 0
    ? `<span class="fraco" title="O período anterior não tem dados para comparar">sem base no período anterior</span>`
    : `<span class="fraco">igual ao período anterior</span>`;
  const pct = ((atual - anterior) / anterior) * 100;
  const r = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  if (r === 0) return `<span class="delta igual">= ${rotuloAnt}</span>`;
  return `<span class="delta ${r > 0 ? "sobe" : "desce"}">${r > 0 ? "▲" : "▼"} ${String(Math.abs(r)).replace(".", ",")}%</span> <span class="fraco">vs. ${rotuloAnt}</span>`;
}
function igRotuloAnterior() {
  const p = ig.periodo;
  return p.tipo === "custom" ? "período anterior" : `${p.tipo} dias anteriores`;
}
function igFaixaTexto(inicio, fim) {
  return `${igDataLonga(inicio)} até ${igDataLonga(fim)} · comparado com ${igRotuloAnterior()}`;
}

function igNum(n) { return n == null || Number.isNaN(Number(n)) ? "n/d" : Number(n).toLocaleString("pt-BR"); }
function igNumCurto(n) {
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e4) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR");
}
function igPct(a, b) {
  if (!b) return "n/d";
  const p = (a / b) * 100;
  return `${(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10).toLocaleString("pt-BR")}%`;
}
function igResumoTexto(t, n) { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

// Datas no fuso do navegador.
function igHoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function igSomaDias(dia, n) {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function igListaDias(a, b) { const out = []; for (let d = a; d <= b; d = igSomaDias(d, 1)) out.push(d); return out; }
function igDataLocal(iso) { const d = new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function igDiaCurto(dia) { const [, m, d] = String(dia).split("-"); return `${d}/${m}`; }
function igDiaSemana(dia) {
  return new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}
function igDataLonga(dia) { return new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", ""); }
function igDataCurta(iso) {
  if (!iso) return "";
  return new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function igDataHora(iso) {
  if (!iso) return "";
  return new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
    .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function igRelativo(iso) {
  if (!iso) return "";
  const t = new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (t.toDateString() === ontem.toDateString()) return "ontem";
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return `há ${d} dias`; }
  return igDataCurta(iso);
}

function igBaixarCsv(nome, linhas) {
  // O BOM faz o Excel reconhecer os acentos; ";" é o separador do Excel em português.
  const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
