/* =============================================================
   PAINEL DE AUTOMAÇÃO DE DM DO INSTAGRAM
   Frontend em JavaScript puro, sem framework.

   Como o arquivo está organizado:
     1. Ajudantes gerais
     2. Modo local x produção, e o Supabase
     3. Login e sessão
     4. A estrutura do app (menu e navegação)
     5. Tela Início
     6. Tela Calendário
     7. Tela Instagram (Métricas e Automações)
     8. O editor de automação (com a prévia ao vivo)
     9. Gráficos
   ============================================================= */

/* =============================================================
   1. AJUDANTES GERAIS
   ============================================================= */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// Escapa texto do usuário antes de jogar na tela.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Um aviso flutuante rápido no canto da tela.
function toast(mensagem, tipo = "info") {
  const caixa = document.createElement("div");
  caixa.className = `aviso ${tipo}`;
  caixa.style.cssText = "position:fixed;bottom:22px;right:22px;z-index:999;max-width:330px;box-shadow:var(--sombra-g)";
  caixa.innerHTML = `<span>${esc(mensagem)}</span>`;
  document.body.appendChild(caixa);
  setTimeout(() => caixa.remove(), 4200);
}

function ehUrl(texto) {
  return /^(https?:\/\/|www\.)\S+$/i.test(String(texto ?? "").trim());
}

/* =============================================================
   2. MODO LOCAL x PRODUÇÃO, E O SUPABASE
   ============================================================= */

const CFG = window.APP_CONFIG ?? {};

// Estamos no computador da pessoa (teste) ou no ar (produção)?
const MODO_LOCAL = (() => {
  const h = location.hostname;
  return location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "";
})();

// O Supabase só é ligado quando a configuração está mesmo preenchida.
const SUPABASE_CONFIGURADO =
  !!CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("SEU_") &&
  !!CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("SUA_");

let sb = null;
if (SUPABASE_CONFIGURADO && window.supabase) {
  try {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn("Não deu pra ligar o Supabase:", e);
  }
}

// Guarda de tudo o que a tela precisa saber.
const state = {
  view: "inicio",
  abaIg: "metricas",
  automacoes: [],
  posts: [],
  stories: [],
  midiaCarregada: false,   // posts e stories já foram buscados nesta sessão?
  leads: [],               // a planilha da aba Interações
  leadsFim: false,         // não há mais páginas para carregar
  filtroLeads: { busca: "", origem: "", tag: "", automacao: "" },
  ordemLeads: { campo: "ultima_interacao", desc: true },
  metricas: null,
  ed: null,        // a automação sendo editada
  sujo: false,     // tem alteração não salva?
};

/* =============================================================
   3. LOGIN E SESSÃO
   ============================================================= */

const CHAVE_LOGIN_LOCAL = "painel_login_local";
const CHAVE_AUTOS_LOCAIS = "painel_automacoes_locais";

// Lê e escreve no navegador sem quebrar quando o armazenamento está bloqueado.
function lerLocal(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; }
  catch { return padrao; }
}
function gravarLocal(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
  catch { return false; }
}

async function iniciar() {
  $("#nome-painel").textContent = CFG.NOME_DO_PAINEL ?? "Painel";
  $("#aviso-modo-local").hidden = !MODO_LOCAL;

  $("#form-login").addEventListener("submit", aoEntrar);
  $("#btn-sair").addEventListener("click", sair);
  $$(".item-menu[data-view]").forEach((b) =>
    b.addEventListener("click", () => irPara(b.dataset.view)));

  // Já tem sessão aberta?
  if (MODO_LOCAL) {
    if (lerLocal(CHAVE_LOGIN_LOCAL, null)) return abrirApp();
  } else if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      // Se a sessão expirar depois, o Supabase avisa e voltamos pro login.
      sb.auth.onAuthStateChange((evt) => {
        if (evt === "SIGNED_OUT") mostrarLogin();
      });
      if (data?.session) return abrirApp();
    } catch (e) { console.warn(e); }
  }
  mostrarLogin();
}

async function aoEntrar(e) {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const senha = $("#login-senha").value;
  const erro = $("#erro-login");
  const botao = $("#btn-entrar");
  erro.hidden = true;

  // ---- MODO DE TESTE LOCAL: qualquer e-mail e uma senha de 5 dígitos ----
  if (MODO_LOCAL) {
    if (!/^\d{5}$/.test(senha)) {
      erro.innerHTML = "<span>No modo de teste local, a senha precisa ter 5 dígitos (só números).</span>";
      erro.hidden = false;
      return;
    }
    gravarLocal(CHAVE_LOGIN_LOCAL, { email, quando: Date.now() });
    return abrirApp();
  }

  // ---- MODO PRODUÇÃO: login de verdade pelo Supabase ----
  if (!sb) {
    erro.innerHTML = "<span>O Supabase ainda não foi configurado. Preencha o arquivo assets/config.js.</span>";
    erro.hidden = false;
    return;
  }

  botao.disabled = true;
  botao.textContent = "Entrando...";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    abrirApp();
  } catch (err) {
    erro.innerHTML = "<span>E-mail ou senha incorretos.</span>";
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
}

async function sair() {
  if (state.sujo && !confirm("Você tem uma automação com alterações não salvas. Sair mesmo assim?")) return;
  try { localStorage.removeItem(CHAVE_LOGIN_LOCAL); } catch {}
  if (sb) { try { await sb.auth.signOut(); } catch {} }
  state.sujo = false;
  mostrarLogin();
}

function mostrarLogin() {
  $("#app").hidden = true;
  $("#tela-login").hidden = false;
  $("#login-senha").value = "";
}

function abrirApp() {
  $("#tela-login").hidden = true;
  $("#app").hidden = false;
  irPara("inicio");
  carregarAutomacoes();
}

/* =============================================================
   4. A ESTRUTURA DO APP (menu e navegação)
   ============================================================= */

function irPara(view) {
  // Não deixa perder o que foi digitado por um clique errado.
  if (state.ed && state.sujo) {
    if (!confirm("Você tem alterações não salvas nessa automação. Sair sem salvar?")) return;
  }
  state.ed = null;
  state.sujo = false;
  state.view = view;
  $$(".item-menu[data-view]").forEach((b) => b.classList.toggle("ativo", b.dataset.view === view));

  if (view === "inicio") renderInicio();
  else if (view === "calendario") renderCalendario();
  else renderInstagram();
}

// O aviso de modo de teste que aparece no topo das telas.
function faixaModoLocal() {
  if (!MODO_LOCAL && SUPABASE_CONFIGURADO) return "";
  return `<div class="aviso atencao" style="margin-bottom:18px">
    <span>Você está no modo de teste local. As telas funcionam, mas nada é salvo no banco ainda.
    Pra colocar no ar de verdade (com login e dados salvos), siga o LEIA-ME.</span>
  </div>`;
}

/* =============================================================
   5. TELA INÍCIO
   ============================================================= */

async function renderInicio() {
  $("#conteudo").innerHTML = `
    ${faixaModoLocal()}
    <div class="cabecalho-pagina">
      <h1>Bem-vindo ao seu painel</h1>
      <p>Um resumo rápido do que está rodando.</p>
    </div>

    <div class="grade" style="margin-bottom:22px">
      <div class="cartao">
        <div class="rotulo">Leads captados</div>
        <div class="numero-grande" id="n-leads">0</div>
        <div class="pequeno fraco">Pessoas que entraram pelas automações.</div>
      </div>
      <div class="cartao">
        <div class="rotulo">Automações ativas</div>
        <div class="numero-grande" id="n-autos">0</div>
        <div class="pequeno fraco">Ligadas e prontas pra responder.</div>
      </div>
      <div class="cartao">
        <div class="rotulo">DMs nos últimos 7 dias</div>
        <div class="numero-grande" id="n-dms">0</div>
        <div class="pequeno fraco">Mensagens entregues com sucesso.</div>
      </div>
    </div>

    <div class="cartao">
      <h2>Atalhos</h2>
      <p class="fraco pequeno" style="margin:5px 0 16px">Vá direto pro que você usa mais.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="botao primario" data-atalho="instagram">Abrir Instagram</button>
        <button class="botao" data-atalho="calendario">Abrir Calendário</button>
      </div>
    </div>`;

  $$("[data-atalho]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.atalho)));

  // Os números vêm do banco. Sem banco, ficam em zero, sem quebrar nada.
  const autosAtivas = state.automacoes.filter((a) => a.active).length;
  $("#n-autos").textContent = autosAtivas;

  if (!sb) return;
  try {
    const { count: leads } = await sb.from("ig_leads").select("ig_user_id", { count: "exact", head: true });
    $("#n-leads").textContent = leads ?? 0;

    const desde = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count: dms } = await sb.from("ig_deliveries")
      .select("id", { count: "exact", head: true }).eq("status", "ok").gte("ts", desde);
    $("#n-dms").textContent = dms ?? 0;
  } catch (e) {
    console.warn("Não deu pra ler os números:", e);
  }
}

/* =============================================================
   6. TELA CALENDÁRIO (por enquanto, só um lugar reservado)
   ============================================================= */

function renderCalendario() {
  $("#conteudo").innerHTML = `
    ${faixaModoLocal()}
    <div class="cabecalho-pagina"><h1>Calendário</h1></div>
    <div class="cartao">
      <div class="vazio">
        <div class="icone">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
        </div>
        <h2>Em breve</h2>
        <p>Essa área vai chegar em breve pra você planejar seus conteúdos.</p>
      </div>
    </div>`;
}

/* =============================================================
   7. TELA INSTAGRAM
   ============================================================= */

function renderInstagram() {
  $("#conteudo").innerHTML = `
    ${faixaModoLocal()}
    <div class="cabecalho-pagina">
      <h1>Instagram</h1>
      <p>Suas métricas, suas automações de direct e quem interagiu com elas.</p>
    </div>
    <div class="abas">
      <button class="aba" data-aba="metricas">Métricas</button>
      <button class="aba" data-aba="automacoes">Automações</button>
      <button class="aba" data-aba="interacoes">Interações</button>
    </div>
    <div id="area-ig"></div>`;

  $$(".aba").forEach((b) => b.addEventListener("click", () => {
    state.abaIg = b.dataset.aba;
    renderInstagram();
  }));
  $$(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === state.abaIg));

  if (state.abaIg === "metricas") renderMetricas();
  else if (state.abaIg === "interacoes") renderInteracoes();
  else renderListaAutomacoes();
}

/* ---------------------- Sub-aba: Métricas ---------------------- */

async function renderMetricas() {
  const area = $("#area-ig");
  area.innerHTML = `<div class="cartao"><p class="fraco">Carregando métricas...</p></div>`;

  let dados = null;
  if (sb) {
    try {
      const { data } = await sb.functions.invoke("ig-insights");
      dados = data;
    } catch (e) {
      console.warn("ig-insights indisponível:", e);
    }
  }

  // Sem Instagram conectado: estado vazio simpático, nunca uma tela quebrada.
  if (!dados || dados.conectado === false) {
    area.innerHTML = `
      <div class="cartao">
        <div class="vazio">
          <div class="icone">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>
          </div>
          <h2>Conecte seu Instagram pra ver as métricas</h2>
          <p>Assim que o token e o id da conta estiverem configurados nas Edge Functions,<br>
          os números de seguidores e alcance aparecem aqui.</p>
        </div>
      </div>`;
    return;
  }

  const novos = dados.novos_seguidores ?? [];
  const alcance = dados.alcance ?? [];
  const somaNovos = novos.reduce((t, d) => t + d.valor, 0);
  const somaAlcance = alcance.reduce((t, d) => t + d.valor, 0);

  area.innerHTML = `
    <div class="grade" style="margin-bottom:18px">
      <div class="cartao">
        <div class="rotulo">Seguidores</div>
        <div class="numero-grande">${Number(dados.seguidores ?? 0).toLocaleString("pt-BR")}</div>
      </div>
      <div class="cartao">
        <div class="rotulo">Novos em 15 dias</div>
        <div class="numero-grande">${somaNovos.toLocaleString("pt-BR")}</div>
      </div>
      <div class="cartao">
        <div class="rotulo">Alcance em 15 dias</div>
        <div class="numero-grande">${somaAlcance.toLocaleString("pt-BR")}</div>
      </div>
      <div class="cartao">
        <div class="rotulo">Leads captados</div>
        <div class="numero-grande" id="m-leads">0</div>
      </div>
    </div>

    <div class="cartao" style="margin-bottom:18px">
      <h2>Novos seguidores por dia</h2>
      <p class="pequeno fraco" style="margin:4px 0 14px">Últimos 15 dias. Passe o mouse pra ver o número de cada dia.</p>
      <div class="gr-area" id="graf-novos"></div>
    </div>

    <div class="cartao">
      <h2>Alcance por dia</h2>
      <p class="pequeno fraco" style="margin:4px 0 14px">Últimos 15 dias. Passe o mouse pra ver o número de cada dia.</p>
      <div class="gr-area" id="graf-alcance"></div>
    </div>`;

  graficoBarras($("#graf-novos"), novos, "novos seguidores");
  graficoBarras($("#graf-alcance"), alcance, "de alcance");

  try {
    const { count } = await sb.from("ig_leads").select("ig_user_id", { count: "exact", head: true });
    $("#m-leads").textContent = (count ?? 0).toLocaleString("pt-BR");
  } catch {}
}

/* ------------------- Sub-aba: Automações (lista) ------------------- */

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
  // Sem banco: usa o que estiver salvo no navegador (só pro teste local).
  state.automacoes = lerLocal(CHAVE_AUTOS_LOCAIS, []);
}

function renderListaAutomacoes() {
  const area = $("#area-ig");
  const lista = state.automacoes;

  area.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div>
        <h2>Suas automações</h2>
        <p class="pequeno fraco" style="margin-top:3px">Alguém comenta a palavra num post, ou responde um story, e o sistema manda a DM.</p>
      </div>
      <button class="botao primario" id="btn-nova">Nova automação</button>
    </div>
    <div id="lista-autos"></div>`;

  $("#btn-nova").addEventListener("click", () => abrirEditor(null));

  const destino = $("#lista-autos");
  if (lista.length === 0) {
    destino.innerHTML = `
      <div class="cartao">
        <div class="vazio">
          <div class="icone">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-4.5A8.4 8.4 0 1 1 21 11.5z"/></svg>
          </div>
          <h2>Nenhuma automação ainda</h2>
          <p>Crie a primeira e veja a prévia da DM na hora.</p>
          <button class="botao primario" id="btn-nova-vazio" style="margin-top:16px">Nova automação</button>
        </div>
      </div>`;
    $("#btn-nova-vazio").addEventListener("click", () => abrirEditor(null));
    return;
  }

  destino.innerHTML = lista.map((a) => {
    const palavras = a.match_any ? "Qualquer palavra ativa" : (a.keyword || "sem palavra");
    const ehStory = (a.tipo ?? "post") === "story";
    const qtd = (a.media_ids ?? []).length;
    const alcance = ehStory
      ? (qtd ? `${qtd} story${qtd > 1 ? "s" : ""} escolhido${qtd > 1 ? "s" : ""}` : "Qualquer story")
      : (qtd ? `${qtd} post${qtd > 1 ? "s" : ""}` : "Todos os posts");
    return `<div class="linha-auto">
      ${miniaturaAutomacao(a)}
      <div class="meio">
        <div class="nome">${esc(a.nome || "Sem nome")}</div>
        <div class="palavras">
          <span class="tipo-auto ${ehStory ? "story" : ""}">${ehStory ? "Story" : "Post"}</span>
          ${esc(alcance)} · ${esc(palavras)}
        </div>
      </div>
      <div class="etiqueta ${a.active ? "ligada" : "desligada"}">
        <span class="ponto"></span>${a.active ? "Ligada" : "Desligada"}
      </div>
      <button class="botao pequeno" data-editar="${esc(a.id)}">Editar</button>
      <button class="botao pequeno perigo" data-apagar="${esc(a.id)}">Apagar</button>
    </div>`;
  }).join("");

  $$("[data-editar]").forEach((b) => b.addEventListener("click", () =>
    abrirEditor(state.automacoes.find((a) => String(a.id) === b.dataset.editar))));
  $$("[data-apagar]").forEach((b) => b.addEventListener("click", () => apagarAutomacao(b.dataset.apagar)));

  // As miniaturas dependem da lista de posts e stories: busca uma vez e redesenha.
  if (!state.midiaCarregada) carregarPosts().then(() => {
    if (state.abaIg === "automacoes" && !state.ed && $("#lista-autos")) renderListaAutomacoes();
  });
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
  // Sem foto: "todos os posts", "qualquer story" ou um conteúdo que já saiu do ar.
  const icone = ehStory
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="3.5"/></svg>`
    : ids.length
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
  const rotulo = ehStory ? (ids.length ? "Story fora do ar" : "Qualquer story") : (ids.length ? "Post" : "Todos os posts");
  return `<div class="mini mini-vazia ${ehStory ? "mini-story" : ""}" title="${rotulo}">${icone}${extra}</div>`;
}

async function apagarAutomacao(id) {
  const auto = state.automacoes.find((a) => String(a.id) === String(id));
  if (!confirm(`Apagar a automação "${auto?.nome ?? ""}"? Isso não tem volta.`)) return;

  if (sb) {
    try { await sb.from("ig_automations").delete().eq("id", id); }
    catch (e) { toast("Não deu pra apagar no banco.", "erro"); }
  }
  state.automacoes = state.automacoes.filter((a) => String(a.id) !== String(id));
  if (!sb) gravarLocal(CHAVE_AUTOS_LOCAIS, state.automacoes);
  renderListaAutomacoes();
  toast("Automação apagada.");
}

/* ------------------- Sub-aba: Interações (a planilha de leads) ------------------- */

const TAMANHO_PAGINA_LEADS = 500;
const ORIGENS = {
  comment: { rotulo: "Comentário", classe: "origem-comentario" },
  story_reply: { rotulo: "Story", classe: "origem-story" },
  dm: { rotulo: "Direct", classe: "origem-dm" },
};

// As colunas da planilha: rótulo, campo de ordenação e como exportar.
const COLUNAS_LEADS = [
  { id: "pessoa", rotulo: "Pessoa", campo: "username" },
  { id: "origem", rotulo: "Origem", campo: "last_source" },
  { id: "palavra", rotulo: "Palavra", campo: "last_keyword" },
  { id: "contato", rotulo: "Contato", campo: "email" },
  { id: "tags", rotulo: "Etiquetas", campo: null },
  { id: "automacao", rotulo: "Automação", campo: "automacao_nome" },
  { id: "interacoes", rotulo: "Interações", campo: "interacoes", numero: true },
  { id: "enviadas", rotulo: "Mensagens enviadas", campo: "mensagens_enviadas", numero: true },
  { id: "primeira", rotulo: "Primeira vez", campo: "created_at" },
  { id: "ultima", rotulo: "Última vez", campo: "ultima_interacao" },
];

async function renderInteracoes() {
  const area = $("#area-ig");

  if (!sb) {
    area.innerHTML = `<div class="cartao"><div class="vazio">
      <h2>Interações aparecem aqui</h2>
      <p>Cada pessoa que entrar por uma automação vira uma linha desta planilha.<br>
      No modo de teste local não há banco conectado, então a lista fica vazia.</p>
    </div></div>`;
    return;
  }

  area.innerHTML = `<div class="cartao"><p class="fraco">Carregando interações...</p></div>`;
  state.leads = [];
  state.leadsFim = false;
  await carregarLeads();
  if (!state.midiaCarregada) carregarPosts().then(() => { if (state.abaIg === "interacoes") desenharTabelaLeads(); });
  desenharInteracoes();
}

// Busca uma página de leads (a view já traz a automação e o total de mensagens enviadas).
async function carregarLeads() {
  try {
    const inicio = state.leads.length;
    const { data, error } = await sb.from("ig_leads_painel")
      .select("*")
      .order("ultima_interacao", { ascending: false, nullsFirst: false })
      .range(inicio, inicio + TAMANHO_PAGINA_LEADS - 1);
    if (error) throw error;
    state.leads.push(...(data ?? []));
    state.leadsFim = (data ?? []).length < TAMANHO_PAGINA_LEADS;
  } catch (e) {
    console.warn("Não deu pra ler os leads:", e);
    toast("Não deu pra carregar as interações. Tente recarregar a página.", "erro");
    state.leadsFim = true;
  }
}

function desenharInteracoes() {
  const area = $("#area-ig");
  const leads = state.leads;
  const hoje = new Date().toDateString();
  const comContato = leads.filter((l) => l.email || l.telefone).length;
  const novosHoje = leads.filter((l) => new Date(l.created_at).toDateString() === hoje).length;
  const totalInter = leads.reduce((t, l) => t + Number(l.interacoes || 0), 0);

  const tags = [...new Set(leads.flatMap((l) => l.tags ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const autos = [...new Set(leads.map((l) => l.automacao_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const f = state.filtroLeads;

  area.innerHTML = `
    <div class="grade" style="margin-bottom:18px">
      <div class="cartao"><div class="rotulo">Leads</div><div class="numero-grande">${leads.length.toLocaleString("pt-BR")}${state.leadsFim ? "" : "+"}</div></div>
      <div class="cartao"><div class="rotulo">Com contato</div><div class="numero-grande">${comContato.toLocaleString("pt-BR")}</div></div>
      <div class="cartao"><div class="rotulo">Novos hoje</div><div class="numero-grande">${novosHoje.toLocaleString("pt-BR")}</div></div>
      <div class="cartao"><div class="rotulo">Interações</div><div class="numero-grande">${totalInter.toLocaleString("pt-BR")}</div></div>
    </div>

    <div class="barra-filtros">
      <input type="search" id="f-busca" placeholder="Buscar por nome, @, palavra ou contato" value="${esc(f.busca)}" aria-label="Buscar">
      <select id="f-origem" aria-label="Filtrar por origem">
        <option value="">Todas as origens</option>
        ${Object.entries(ORIGENS).map(([v, o]) => `<option value="${v}" ${f.origem === v ? "selected" : ""}>${o.rotulo}</option>`).join("")}
      </select>
      <select id="f-tag" aria-label="Filtrar por etiqueta">
        <option value="">Todas as etiquetas</option>
        ${tags.map((t) => `<option value="${esc(t)}" ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select>
      <select id="f-auto" aria-label="Filtrar por automação">
        <option value="">Todas as automações</option>
        ${autos.map((a) => `<option value="${esc(a)}" ${f.automacao === a ? "selected" : ""}>${esc(a)}</option>`).join("")}
      </select>
      <button class="botao" id="btn-exportar">Exportar planilha</button>
    </div>

    <div id="tabela-leads"></div>`;

  const aoFiltrar = () => {
    f.busca = $("#f-busca").value;
    f.origem = $("#f-origem").value;
    f.tag = $("#f-tag").value;
    f.automacao = $("#f-auto").value;
    desenharTabelaLeads();
  };
  $("#f-busca").addEventListener("input", aoFiltrar);
  ["#f-origem", "#f-tag", "#f-auto"].forEach((s) => $(s).addEventListener("change", aoFiltrar));
  $("#btn-exportar").addEventListener("click", exportarLeads);

  desenharTabelaLeads();
}

// Aplica busca, filtros e ordenação aos leads carregados.
function leadsFiltrados() {
  const f = state.filtroLeads;
  const busca = f.busca.trim().toLowerCase();
  let lista = state.leads.filter((l) => {
    if (f.origem && l.last_source !== f.origem) return false;
    if (f.tag && !(l.tags ?? []).includes(f.tag)) return false;
    if (f.automacao && l.automacao_nome !== f.automacao) return false;
    if (busca) {
      const alvo = [l.nome, l.username, l.last_keyword, l.email, l.telefone, ...(l.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  const { campo, desc } = state.ordemLeads;
  const col = COLUNAS_LEADS.find((c) => c.campo === campo);
  lista = [...lista].sort((a, b) => {
    let x = a[campo], y = b[campo];
    if (campo === "ultima_interacao") { x = x ?? a.updated_at; y = y ?? b.updated_at; }
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const r = col?.numero ? Number(x) - Number(y) : String(x).localeCompare(String(y), "pt-BR");
    return desc ? -r : r;
  });
  return lista;
}

function desenharTabelaLeads() {
  const alvo = $("#tabela-leads");
  if (!alvo) return;
  const lista = leadsFiltrados();

  if (!state.leads.length) {
    alvo.innerHTML = `<div class="cartao"><div class="vazio">
      <h2>Nenhuma interação ainda</h2>
      <p>Quando alguém entrar por uma automação, aparece aqui com tudo o que você precisa saber.</p>
    </div></div>`;
    return;
  }

  const { campo, desc } = state.ordemLeads;
  const seta = (c) => c.campo === campo ? (desc ? " ↓" : " ↑") : "";

  alvo.innerHTML = `
    <p class="pequeno fraco" style="margin:0 0 8px">
      Mostrando ${lista.length.toLocaleString("pt-BR")} de ${state.leads.length.toLocaleString("pt-BR")} carregados.
      Clique no título de uma coluna para ordenar.
    </p>
    <div class="tabela-rolagem">
      <table class="planilha">
        <thead><tr>
          ${COLUNAS_LEADS.map((c) => c.campo
            ? `<th scope="col"><button type="button" class="ordenar" data-ordenar="${c.campo}">${c.rotulo}${seta(c)}</button></th>`
            : `<th scope="col">${c.rotulo}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${lista.length ? lista.map(linhaLead).join("") : `<tr><td colspan="${COLUNAS_LEADS.length}" class="fraco" style="text-align:center;padding:26px">Nenhum lead com esses filtros.</td></tr>`}
        </tbody>
      </table>
    </div>
    ${state.leadsFim ? "" : `<div style="text-align:center;margin-top:14px"><button class="botao" id="btn-mais-leads">Carregar mais</button></div>`}`;

  $$("[data-ordenar]", alvo).forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.ordenar;
    state.ordemLeads = { campo: c, desc: state.ordemLeads.campo === c ? !state.ordemLeads.desc : true };
    desenharTabelaLeads();
  }));
  $$("[data-editar-tags]", alvo).forEach((b) => b.addEventListener("click", () => editarTags(b.dataset.editarTags)));
  // Foto de perfil que não carrega (os links do Instagram expiram): mostra a inicial.
  $$("img.avatar-lead", alvo).forEach((img) => img.addEventListener("error", () => {
    const s = document.createElement("span");
    s.className = "avatar-lead avatar-inicial";
    s.textContent = img.dataset.inicial || "?";
    img.replaceWith(s);
  }));
  $("#btn-mais-leads")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Carregando...";
    await carregarLeads();
    desenharInteracoes();
  });
}

function linhaLead(l) {
  const origem = ORIGENS[l.last_source] ?? { rotulo: l.last_source || "Outro", classe: "" };
  const midia = [...state.posts, ...state.stories].find((m) => m.id === String(l.last_media_id ?? ""));
  const inicial = String(l.nome || l.username || "?").trim().charAt(0).toUpperCase();
  const perfil = l.username ? `https://www.instagram.com/${encodeURIComponent(l.username)}/` : "";
  const ultima = l.ultima_interacao ?? l.updated_at;

  return `<tr>
    <td>
      <div class="pessoa">
        ${l.foto_url
          ? `<img class="avatar-lead" src="${esc(l.foto_url)}" alt="" loading="lazy" data-inicial="${esc(inicial)}">`
          : `<span class="avatar-lead avatar-inicial">${esc(inicial)}</span>`}
        <div>
          <div class="pessoa-nome">${esc(l.nome || l.username || "Sem nome")}</div>
          ${l.username
            ? `<a class="pessoa-user" href="${perfil}" target="_blank" rel="noopener noreferrer">@${esc(l.username)}</a>`
            : `<span class="pessoa-user">id ${esc(l.ig_user_id)}</span>`}
        </div>
      </div>
    </td>
    <td>
      <div class="origem-celula">
        ${midia?.miniatura ? `<img class="mini-origem" src="${esc(midia.miniatura)}" alt="" loading="lazy">` : ""}
        <span class="badge-origem ${origem.classe}">${esc(origem.rotulo)}</span>
      </div>
    </td>
    <td class="celula-texto" title="${esc(l.last_keyword || "")}">${esc(l.last_keyword || "")}</td>
    <td>
      ${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ""}
      ${l.telefone ? `<div><a href="tel:${esc(String(l.telefone).replace(/[^\d+]/g, ""))}">${esc(l.telefone)}</a></div>` : ""}
      ${!l.email && !l.telefone ? `<span class="fraco">sem contato</span>` : ""}
    </td>
    <td>
      <div class="tags-celula" id="tags-${esc(l.ig_user_id)}">
        ${(l.tags ?? []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}
        <button type="button" class="botao-icone" data-editar-tags="${esc(l.ig_user_id)}" title="Editar etiquetas" aria-label="Editar etiquetas">✎</button>
      </div>
    </td>
    <td>
      ${l.automacao_nome ? `<div>${esc(l.automacao_nome)}</div>` : `<span class="fraco">sem automação</span>`}
      ${l.flow_step ? `<div class="pequeno fraco">na mensagem ${esc(l.flow_step)}</div>` : ""}
    </td>
    <td class="numero">${Number(l.interacoes || 0).toLocaleString("pt-BR")}</td>
    <td class="numero">${Number(l.mensagens_enviadas || 0).toLocaleString("pt-BR")}</td>
    <td title="${esc(dataHora(l.created_at))}">${esc(dataCurta(l.created_at))}</td>
    <td title="${esc(dataHora(ultima))}">${esc(tempoRelativo(ultima))}</td>
  </tr>`;
}

// Troca as etiquetas da célula por um campo de texto. Enter salva, Esc cancela.
function editarTags(igUserId) {
  const lead = state.leads.find((l) => String(l.ig_user_id) === String(igUserId));
  const celula = document.getElementById(`tags-${igUserId}`);
  if (!lead || !celula) return;

  celula.innerHTML = `<input type="text" class="entrada-tags" value="${esc((lead.tags ?? []).join(", "))}"
    placeholder="Separe por vírgula" aria-label="Etiquetas">`;
  const campo = celula.querySelector("input");
  campo.focus();
  campo.select();

  let terminado = false;
  const salvar = async () => {
    if (terminado) return;
    terminado = true;
    const novas = [...new Set(campo.value.split(",").map((s) => s.trim()).filter(Boolean))];
    try {
      const { error } = await sb.from("ig_leads").update({ tags: novas }).eq("ig_user_id", igUserId);
      if (error) throw error;
      lead.tags = novas;
      toast("Etiquetas salvas.", "sucesso");
    } catch (e) {
      toast("Não deu pra salvar as etiquetas.", "erro");
    }
    desenharInteracoes();
  };
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); salvar(); }
    if (e.key === "Escape") { terminado = true; desenharTabelaLeads(); }
  });
  campo.addEventListener("blur", salvar);
}

// Baixa os leads filtrados como planilha (CSV que abre direto no Excel e no Google Planilhas).
function exportarLeads() {
  const lista = leadsFiltrados();
  if (!lista.length) { toast("Não há leads para exportar com esses filtros."); return; }

  const cabecalho = ["Nome", "Usuário", "Perfil", "Origem", "Palavra", "E-mail", "Telefone",
    "Etiquetas", "Automação", "Mensagem atual", "Interações", "Mensagens enviadas",
    "Primeira vez", "Última vez", "ID do Instagram"];
  const celula = (v) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = lista.map((l) => [
    l.nome, l.username ? `@${l.username}` : "",
    l.username ? `https://www.instagram.com/${l.username}/` : "",
    (ORIGENS[l.last_source]?.rotulo ?? l.last_source ?? ""),
    l.last_keyword, l.email, l.telefone, (l.tags ?? []).join(", "),
    l.automacao_nome, l.flow_step, l.interacoes, l.mensagens_enviadas,
    dataHora(l.created_at), dataHora(l.ultima_interacao ?? l.updated_at), l.ig_user_id,
  ].map(celula).join(";"));

  // O BOM no começo faz o Excel reconhecer os acentos; ";" é o separador do Excel em português.
  const csv = "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `interacoes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`${lista.length} lead(s) exportado(s).`, "sucesso");
}

function dataCurta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function dataHora(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function tempoRelativo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora há pouco";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return `há ${d} dia${d > 1 ? "s" : ""}`; }
  return dataCurta(iso);
}

/* =============================================================
   8. O EDITOR DE AUTOMAÇÃO
   ============================================================= */

const EMOJIS = ["🫶", "👀", "😍", "🥰", "😂", "😮", "🔥", "✨", "💌", "👉", "🙌", "💕"];

// Modelo em branco de uma automação nova.
function automacaoEmBranco() {
  return {
    id: null,
    nome: "",
    tipo: "post",            // "post" (comentário) ou "story" (resposta ao story)
    palavras: [],
    match_any: false,
    active: true,
    media_ids: [],           // posts ou stories escolhidos (vazio = todos)
    tags: "",                // etiquetas aplicadas a quem entrar, separadas por vírgula
    public_reply: "",
    variantes: [],
    msg1: "",
    temBotao: true,          // o botão vem LIGADO por padrão
    btnTitle: "",
    modo: "link",            // "link" ou "conversa"
    link: "",
    passos: [],              // Mensagem 2 em diante
    asset_ids: [],
    proximoId: 2,            // a Mensagem 1 é sempre o id 1
  };
}

// Converte uma automação do banco pro modelo do editor.
function paraEditor(a) {
  const ed = automacaoEmBranco();
  if (!a) return ed;

  ed.id = a.id;
  ed.nome = a.nome ?? "";
  ed.tipo = a.tipo === "story" ? "story" : "post";
  ed.tags = (a.tags ?? []).join(", ");
  ed.palavras = String(a.keyword ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  ed.match_any = !!a.match_any;
  ed.active = a.active !== false;
  ed.media_ids = a.media_ids ?? [];
  ed.public_reply = a.public_reply ?? "";
  ed.variantes = a.public_reply_variants ?? [];
  ed.asset_ids = a.asset_ids ?? [];

  const passos = a.flow?.steps ?? [];
  if (passos.length) {
    const p1 = passos[0];
    ed.msg1 = p1.message ?? "";
    const b1 = (p1.buttons ?? [])[0];
    if (b1) {
      ed.temBotao = true;
      ed.btnTitle = b1.title ?? "";
      if (b1.url) { ed.modo = "link"; ed.link = b1.url; }
      else { ed.modo = "conversa"; }
    } else {
      ed.temBotao = false;
    }
    // Os demais passos viram a sequência (Mensagem 2 em diante).
    ed.passos = passos.slice(1).map((p) => ({
      id: Number(p.id),
      message: p.message ?? "",
      buttons: (p.buttons ?? []).map((b) => ({
        title: b.title ?? "",
        dest: b.url ? "link" : (b.next !== undefined && b.next !== null ? "msg" : "fim"),
        next: b.next ?? null,
        url: b.url ?? "",
      })),
    }));
    ed.proximoId = Math.max(1, ...passos.map((p) => Number(p.id) || 0)) + 1;
  }
  return ed;
}

// Converte o modelo do editor pro formato do banco (o "flow").
function montarFlow(ed) {
  const steps = [];

  // Mensagem 1: o texto de cima mais o botão de cima.
  const botoes1 = [];
  if (ed.temBotao && ed.btnTitle.trim()) {
    const titulo = ed.btnTitle.trim().slice(0, 20);
    if (ed.modo === "link") botoes1.push({ title: titulo, url: ed.link.trim() });
    else if (ed.passos.length) botoes1.push({ title: titulo, next: ed.passos[0].id });
  }
  steps.push({ id: 1, message: ed.msg1.trim(), buttons: botoes1 });

  // Mensagem 2 em diante (só existem no modo "Continua a conversa").
  if (ed.modo === "conversa") {
    for (const p of ed.passos) {
      steps.push({
        id: p.id,
        message: (p.message ?? "").trim(),
        buttons: (p.buttons ?? []).map((b) => {
          const titulo = (b.title ?? "").trim().slice(0, 20);
          if (b.dest === "link") return { title: titulo, url: (b.url ?? "").trim() };
          if (b.dest === "msg" && b.next) return { title: titulo, next: Number(b.next) };
          return { title: titulo }; // "encerrar": fica guardado, mas não é enviado
        }).filter((b) => b.title),
      });
    }
  }

  return { steps };
}

function abrirEditor(auto) {
  state.ed = paraEditor(auto);
  state.sujo = false;
  renderEditor();
  carregarPosts();
}

function marcarSujo() { state.sujo = true; }

function renderEditor() {
  const ed = state.ed;
  $("#conteudo").innerHTML = `
    ${faixaModoLocal()}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="botao fantasma" id="btn-voltar">&larr; Voltar</button>
        <div>
          <h1>${ed.id ? "Editar automação" : "Nova automação"}</h1>
          <p class="pequeno fraco">O que a pessoa recebe no direct depois de comentar.</p>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <label class="interruptor">
          <input type="checkbox" data-campo="active" ${ed.active ? "checked" : ""}>
          <span class="trilho"></span>
          <span class="pequeno">Ligada</span>
        </label>
        <button class="botao primario" id="btn-salvar">Salvar automação</button>
      </div>
    </div>

    <div class="editor" id="editor-raiz">
      <div>
        <div class="campo">
          <label for="ed-nome">Nome da automação</label>
          <input type="text" id="ed-nome" data-campo="nome" value="${esc(ed.nome)}" placeholder="Ex: Lista de espera do curso">
          <div class="ajuda">Só pra você se achar na lista. A pessoa não vê esse nome.</div>
        </div>

        <div class="bloco" id="bloco-gatilho"></div>
        <div class="bloco" id="bloco-resposta"></div>
      </div>

      <div class="previa">
        <div class="rotulo" style="margin-bottom:8px">Prévia ao vivo</div>
        <div class="celular">
          <div class="barra">
            <div class="avatar"></div>
            <div>
              <div style="font-weight:600;font-size:12.5px">Sua conta</div>
              <div class="pequeno fraco">Direct</div>
            </div>
          </div>
          <div class="conversa" id="previa-conversa"></div>
        </div>
        <p class="pequeno fraco" style="margin-top:10px">
          É assim que a conversa chega pra quem comentou.
        </p>
      </div>
    </div>`;

  $("#btn-voltar").addEventListener("click", voltarDaEdicao);
  $("#btn-salvar").addEventListener("click", salvarAutomacao);
  // O interruptor "Ligada" fica fora da área do editor, então tem o ouvinte dele.
  $('[data-campo="active"]').addEventListener("change", (e) => {
    state.ed.active = e.target.checked;
    marcarSujo();
  });

  renderBlocoGatilho();
  renderBlocoResposta();
  renderPrevia();

  // Um só ouvinte pra tudo dentro do editor (funciona mesmo depois de redesenhar).
  const raiz = $("#editor-raiz");
  raiz.addEventListener("input", aoDigitar);
  raiz.addEventListener("change", aoMudar);
  raiz.addEventListener("click", aoClicar);
  raiz.addEventListener("keydown", aoTeclar);
}

function voltarDaEdicao() {
  if (state.sujo && !confirm("Você tem alterações não salvas. Sair sem salvar?")) return;
  state.ed = null;
  state.sujo = false;
  renderInstagram();
}

/* ------------------- BLOCO 1: o gatilho ------------------- */

function renderBlocoGatilho() {
  const ed = state.ed;
  const ehStory = ed.tipo === "story";
  $("#bloco-gatilho").innerHTML = `
    <header>
      <h2><span class="num">1</span> O gatilho</h2>
      <p class="pequeno fraco" style="margin-top:5px">O que faz a DM disparar.</p>
    </header>

    <div class="campo">
      <label>Quando disparar</label>
      <div class="escolha-tipo" role="radiogroup" aria-label="Tipo de gatilho">
        <button type="button" role="radio" aria-checked="${!ehStory}" class="opcao-tipo ${!ehStory ? "ativa" : ""}" data-tipo="post">
          <strong>Comentário em post</strong>
          <span>A pessoa comenta a palavra num post ou reels.</span>
        </button>
        <button type="button" role="radio" aria-checked="${ehStory}" class="opcao-tipo ${ehStory ? "ativa" : ""}" data-tipo="story">
          <strong>Resposta ao story</strong>
          <span>A pessoa responde um story seu com a palavra, pelo direct.</span>
        </button>
      </div>
    </div>

    <div class="campo">
      <label>Palavras que ativam</label>
      <div class="tags" id="caixa-tags">
        ${ed.palavras.map((p, i) => `
          <span class="tag">${esc(p)}<button type="button" data-tirar-palavra="${i}" title="Tirar">&times;</button></span>
        `).join("")}
        <input type="text" id="entrada-palavra" placeholder="${ed.palavras.length ? "" : "Digite uma palavra e aperte Enter"}"
               ${ed.match_any ? "disabled" : ""}>
      </div>
      <div class="ajuda">Digite uma palavra e aperte Enter pra adicionar. Não diferencia maiúscula nem acento.</div>
    </div>

    <div class="campo">
      <label class="interruptor">
        <input type="checkbox" data-campo="match_any" ${ed.match_any ? "checked" : ""}>
        <span class="trilho"></span>
        <span>Qualquer palavra ativa</span>
      </label>
      <div class="ajuda">${ehStory
        ? "Ligado, qualquer resposta ao story dispara a automação (as palavras acima são ignoradas)."
        : "Ligado, qualquer comentário no post dispara a automação (as palavras acima são ignoradas)."}</div>
    </div>

    <div class="campo">
      <label>${ehStory ? "Em quais stories" : "Em quais posts"}</label>
      <div id="area-posts"><p class="pequeno fraco">Carregando...</p></div>
      <div class="ajuda">${ehStory
        ? "Nenhum escolhido significa que vale para qualquer story, inclusive os que você postar depois. Stories duram 24 horas, então escolher um específico só faz sentido enquanto ele estiver no ar."
        : "Nenhum escolhido significa que a automação vale pra todos os posts."}</div>
    </div>

    ${ehStory ? "" : `<div class="campo">
      <label for="ed-resposta">Resposta no comentário</label>
      <input type="text" id="ed-resposta" data-campo="public_reply" value="${esc(ed.public_reply)}"
             placeholder="Ex: te chamei no direct 💌">
      <div class="ajuda">O texto público que responde quem comentou. Deixe vazio pra não responder no post.</div>
      <div id="area-variantes" style="margin-top:10px">
        ${ed.variantes.map((v, i) => `
          <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <input type="text" data-variante="${i}" value="${esc(v)}" placeholder="Outra forma de responder">
            <button type="button" class="botao pequeno perigo" data-tirar-variante="${i}">Tirar</button>
          </div>`).join("")}
      </div>
      <button type="button" class="botao pequeno" id="btn-add-variante" style="margin-top:4px">Adicionar variação A/B</button>
      <div class="ajuda">Com mais de uma opção, o sistema alterna entre elas a cada comentário.</div>
    </div>`}

    <div class="campo">
      <label for="ed-tags">Etiquetas para quem entrar por aqui (opcional)</label>
      <input type="text" id="ed-tags" data-campo="tags" value="${esc(ed.tags)}" placeholder="Ex: lancheira, interessada">
      <div class="ajuda">Separe por vírgula. Aparecem na aba Interações. Vazio: a etiqueta é o nome da automação.</div>
    </div>`;

  renderPosts();
}

function renderPosts() {
  const area = $("#area-posts");
  if (!area) return;
  const ed = state.ed;
  const ehStory = ed.tipo === "story";
  const lista = ehStory ? state.stories : state.posts;

  if (!state.midiaCarregada) {
    area.innerHTML = `<div class="aviso"><span>${sb
      ? "Carregando..."
      : "Conecte seu Instagram pra escolher conteúdos específicos. Por enquanto, a automação vale pra todos."}</span></div>`;
    return;
  }

  // Escolhidos que já saíram do ar (story vencido, post apagado) continuam valendo até serem tirados.
  const foraDoAr = ed.media_ids.filter((id) => !lista.some((m) => m.id === id));

  if (!lista.length) {
    area.innerHTML = `<div class="aviso"><span>${ehStory
      ? "Você não tem nenhum story no ar agora. Deixe sem escolher para valer para qualquer story, inclusive os próximos."
      : "Nenhum post encontrado na sua conta."}</span></div>
      ${foraDoAr.length ? `<p class="pequeno fraco" style="margin-top:8px">${foraDoAr.length} escolhido(s) que não está(ão) mais no ar.
        <button type="button" class="botao pequeno" data-limpar-midia>Tirar</button></p>` : ""}`;
    return;
  }

  area.innerHTML = `<div class="posts ${ehStory ? "stories" : ""}">
    ${lista.map((p) => `
      <div class="post ${ed.media_ids.includes(p.id) ? "escolhido" : ""}" data-post="${esc(p.id)}" title="${esc(p.legenda || "")}">
        ${p.miniatura ? `<img src="${esc(p.miniatura)}" alt="">` : ""}
        <span class="marca-check">&check;</span>
      </div>`).join("")}
  </div>
  ${foraDoAr.length ? `<p class="pequeno fraco" style="margin-top:8px">Mais ${foraDoAr.length} escolhido(s) que não está(ão) mais no ar.
    <button type="button" class="botao pequeno" data-limpar-midia>Tirar</button></p>` : ""}`;
}

// Busca os posts e os stories no ar (para o seletor do editor e as miniaturas).
async function carregarPosts() {
  if (!sb) return;
  try {
    const { data } = await sb.functions.invoke("ig-media");
    state.posts = data?.posts ?? [];
    state.stories = data?.stories ?? [];
    state.midiaCarregada = true;
    if (state.ed) renderPosts();
  } catch (e) {
    console.warn("ig-media indisponível:", e);
  }
}

/* ------------------- BLOCO 2: a resposta ------------------- */

function renderBlocoResposta() {
  const ed = state.ed;
  const estourou = ed.btnTitle.length > 20;

  $("#bloco-resposta").innerHTML = `
    <header>
      <h2><span class="num">2</span> A resposta</h2>
      <p class="pequeno fraco" style="margin-top:5px">O que a pessoa recebe na DM.</p>
    </header>

    <div class="campo">
      <label for="ed-msg1">Sua mensagem</label>
      <textarea id="ed-msg1" data-campo="msg1" placeholder="Oi! Vi que você comentou 🫶 Toca no botão aí embaixo.">${esc(ed.msg1)}</textarea>
      <div class="emojis">
        ${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}
      </div>
      <div class="ajuda">Escreva uma vez só. Essa é a Mensagem 1, a primeira que ela recebe.</div>
    </div>

    <div class="campo">
      <label class="interruptor">
        <input type="checkbox" data-campo="temBotao" ${ed.temBotao ? "checked" : ""}>
        <span class="trilho"></span>
        <span>Botão na mensagem</span>
      </label>
    </div>

    ${!ed.temBotao ? "" : `
      <div class="campo">
        <label for="ed-btn">Texto do botão</label>
        <input type="text" id="ed-btn" data-campo="btnTitle" value="${esc(ed.btnTitle)}" placeholder="Ex: Quero o link">
        <div class="contador ${estourou ? "estourou" : ""}">${ed.btnTitle.length}/20</div>
        <div class="ajuda">O Instagram corta o nome do botão em 20 caracteres. Nunca cole o link aqui,
          o link tem um campo só dele.</div>
      </div>

      <div class="campo">
        <label for="ed-modo">O que o botão faz quando ela toca</label>
        <select id="ed-modo" data-campo="modo">
          <option value="link" ${ed.modo === "link" ? "selected" : ""}>Um link (leva pra um site)</option>
          <option value="conversa" ${ed.modo === "conversa" ? "selected" : ""}>Continua a conversa</option>
        </select>
      </div>

      ${ed.modo === "link" ? `
        <div class="campo campo-link">
          <label for="ed-link">Link completo</label>
          <textarea id="ed-link" data-campo="link" placeholder="https://seusite.com/sua-pagina">${esc(ed.link)}</textarea>
          <div class="ajuda">Cole o link inteiro aqui, por maior que seja. A pessoa vê só o nome do botão,
            o link fica invisível pra ela.</div>
        </div>
      ` : `
        <div class="campo">
          <label>A conversa</label>
          <div id="construtor"></div>
        </div>
      `}
    `}

    <div class="campo">
      <label>Anexar um arquivo (opcional)</label>
      <div class="aviso"><span>A biblioteca de arquivos (PDF, áudio, foto ou vídeo) aparece aqui
        depois que você configurar o Supabase e subir os arquivos na tabela de arquivos.</span></div>
    </div>`;

  if (ed.temBotao && ed.modo === "conversa") renderConstrutor();
}

/* ------------- O construtor de sequência (o mini-chat) ------------- */

function renderConstrutor() {
  const ed = state.ed;
  const alvo = $("#construtor");
  if (!alvo) return;

  // As opções de destino de cada botão: outras mensagens, um link, ou encerrar.
  const opcoesDestino = (botao, idDoPasso) => {
    const outras = ed.passos.filter((p) => p.id !== idDoPasso);
    return `
      <option value="fim" ${botao.dest === "fim" ? "selected" : ""}>Encerrar a conversa</option>
      <option value="link" ${botao.dest === "link" ? "selected" : ""}>Abrir um link</option>
      ${outras.map((p) => `
        <option value="msg:${p.id}" ${botao.dest === "msg" && Number(botao.next) === p.id ? "selected" : ""}>
          Ir pra Mensagem ${indiceDoPasso(p.id)}
        </option>`).join("")}`;
  };

  alvo.innerHTML = `
    <div class="passo referencia">
      <header>
        <strong>Mensagem 1</strong>
        <span class="pequeno fraco">Edita lá em cima</span>
      </header>
      <div class="texto-ref">${esc(ed.msg1 || "(sua mensagem aparece aqui)")}</div>
      ${ed.btnTitle ? `<div style="margin-top:8px"><span class="etiqueta">Botão: ${esc(ed.btnTitle.slice(0, 20))}</span></div>` : ""}
    </div>

    ${ed.passos.map((p, i) => `
      <div class="passo" data-passo="${p.id}">
        <header>
          <strong>Mensagem ${i + 2}</strong>
          <button type="button" class="botao pequeno perigo" data-tirar-passo="${p.id}">Tirar mensagem</button>
        </header>

        <textarea data-passo="${p.id}" data-campo="message"
                  placeholder="O que você responde quando ela toca no botão">${esc(p.message)}</textarea>

        <div style="margin-top:12px">
          <div class="rotulo" style="margin-bottom:7px">Botões desta mensagem</div>
          ${p.buttons.map((b, j) => `
            <div class="botao-fluxo">
              <div>
                <input type="text" data-passo="${p.id}" data-botao="${j}" data-campo="title"
                       value="${esc(b.title)}" placeholder="Nome do botão">
                <div class="contador ${b.title.length > 20 ? "estourou" : ""}">${b.title.length}/20</div>
              </div>
              <select data-passo="${p.id}" data-botao="${j}" data-campo="dest">
                ${opcoesDestino(b, p.id)}
              </select>
              <button type="button" class="botao pequeno perigo" data-tirar-botao="${p.id}:${j}">Tirar</button>

              ${b.dest === "link" ? `
                <div class="linha-toda campo-link" style="margin-top:2px">
                  <textarea data-passo="${p.id}" data-botao="${j}" data-campo="url"
                            placeholder="https://seusite.com/sua-pagina">${esc(b.url)}</textarea>
                  <div class="ajuda">Cole o link completo aqui. O nome do botão continua curto e bonito.</div>
                </div>` : ""}
            </div>`).join("")}

          <button type="button" class="botao pequeno" data-add-botao="${p.id}">Adicionar botão</button>
          <div class="ajuda">No máximo 3 botões por mensagem no formato colado no balão.
            "Encerrar a conversa" não vira botão: significa que a conversa acaba ali.</div>
        </div>
      </div>`).join("")}

    <button type="button" class="botao" id="btn-add-passo">Adicionar mensagem</button>`;
}

// Mensagem 1 é o passo de referência, então a Mensagem 2 é o primeiro da lista.
function indiceDoPasso(id) {
  const i = state.ed.passos.findIndex((p) => p.id === id);
  return i < 0 ? "?" : i + 2;
}

/* ------------------- Os ouvintes do editor ------------------- */

function aoDigitar(e) {
  const t = e.target;
  const ed = state.ed;
  if (!ed) return;
  const campo = t.dataset.campo;

  // Campos dos passos e dos botões da sequência.
  if (t.dataset.passo) {
    const passo = ed.passos.find((p) => String(p.id) === t.dataset.passo);
    if (!passo) return;
    if (t.dataset.botao !== undefined) {
      const b = passo.buttons[Number(t.dataset.botao)];
      if (!b) return;
      if (campo === "title") {
        b.title = t.value;
        const contador = t.parentElement.querySelector(".contador");
        if (contador) {
          contador.textContent = `${b.title.length}/20`;
          contador.classList.toggle("estourou", b.title.length > 20);
        }
      }
      if (campo === "url") b.url = t.value;
    } else if (campo === "message") {
      passo.message = t.value;
    }
    marcarSujo();
    renderPrevia();
    return;
  }

  // Variações A/B da resposta pública.
  if (t.dataset.variante !== undefined) {
    ed.variantes[Number(t.dataset.variante)] = t.value;
    marcarSujo();
    return;
  }

  if (!campo) return;

  if (campo === "btnTitle") {
    ed.btnTitle = t.value;
    const contador = t.parentElement.querySelector(".contador");
    if (contador) {
      contador.textContent = `${ed.btnTitle.length}/20`;
      contador.classList.toggle("estourou", ed.btnTitle.length > 20);
    }
    const ref = $(".passo.referencia .etiqueta");
    if (ref) ref.textContent = `Botão: ${ed.btnTitle.slice(0, 20)}`;
  } else if (campo === "msg1") {
    ed.msg1 = t.value;
    const ref = $(".passo.referencia .texto-ref");
    if (ref) ref.textContent = ed.msg1 || "(sua mensagem aparece aqui)";
  } else if (campo in ed) {
    ed[campo] = t.value;
  }

  marcarSujo();
  renderPrevia();
}

function aoMudar(e) {
  const t = e.target;
  const ed = state.ed;
  if (!ed) return;
  const campo = t.dataset.campo;

  // Destino de um botão da sequência.
  if (t.dataset.passo && t.dataset.botao !== undefined && campo === "dest") {
    const passo = ed.passos.find((p) => String(p.id) === t.dataset.passo);
    const b = passo?.buttons[Number(t.dataset.botao)];
    if (!b) return;
    aplicarDestino(b, t.value);
    marcarSujo();
    renderConstrutor();
    renderPrevia();
    return;
  }

  if (campo === "match_any") {
    ed.match_any = t.checked;
    marcarSujo();
    renderBlocoGatilho();
    return;
  }

  if (campo === "active") { ed.active = t.checked; marcarSujo(); return; }

  if (campo === "temBotao") {
    ed.temBotao = t.checked;
    marcarSujo();
    renderBlocoResposta();
    renderPrevia();
    return;
  }

  if (campo === "modo") {
    ed.modo = t.value;
    // Se a pessoa colou o link no NOME do botão, mudamos ele de lugar sozinhos.
    if (ed.modo === "link" && ehUrl(ed.btnTitle) && !ed.link.trim()) {
      ed.link = ed.btnTitle.trim();
      ed.btnTitle = "Acessar";
      toast("O link foi movido pro campo certo e o botão virou 'Acessar'.");
    }
    // Entrou no modo conversa sem nenhuma mensagem seguinte? Cria a Mensagem 2.
    if (ed.modo === "conversa" && ed.passos.length === 0) novoPasso();
    marcarSujo();
    renderBlocoResposta();
    renderPrevia();
    return;
  }
}

// Guarda a escolha do destino num estado próprio ("é link" não depende da URL estar preenchida).
function aplicarDestino(botao, valor) {
  if (valor === "link") {
    botao.dest = "link";
    botao.next = null;
    // Link colado no nome do botão vai pro campo certo automaticamente.
    if (ehUrl(botao.title) && !String(botao.url ?? "").trim()) {
      botao.url = botao.title.trim();
      botao.title = "Acessar";
      toast("O link foi movido pro campo certo e o botão virou 'Acessar'.");
    }
  } else if (valor.startsWith("msg:")) {
    botao.dest = "msg";
    botao.next = Number(valor.slice(4));
    botao.url = "";
  } else {
    botao.dest = "fim";
    botao.next = null;
    botao.url = "";
  }
}

function aoClicar(e) {
  const t = e.target.closest("[data-emoji],[data-tirar-palavra],[data-tirar-variante],#btn-add-variante,[data-post],[data-tirar-passo],[data-add-botao],[data-tirar-botao],#btn-add-passo,[data-tipo],[data-limpar-midia]");
  if (!t) return;
  const ed = state.ed;

  // Troca entre "Comentário em post" e "Resposta ao story".
  if (t.dataset.tipo !== undefined) {
    if (ed.tipo === t.dataset.tipo) return;
    ed.tipo = t.dataset.tipo;
    ed.media_ids = [];   // posts e stories são listas diferentes
    marcarSujo(); renderBlocoGatilho(); renderPrevia(); return;
  }

  // Tira os escolhidos que já não estão no ar.
  if (t.dataset.limparMidia !== undefined) {
    const lista = ed.tipo === "story" ? state.stories : state.posts;
    ed.media_ids = ed.media_ids.filter((id) => lista.some((m) => m.id === id));
    marcarSujo(); renderPosts(); return;
  }

  // Emoji: entra no lugar onde o cursor estava.
  if (t.dataset.emoji !== undefined) {
    const area = $("#ed-msg1");
    const pos = area.selectionStart ?? area.value.length;
    area.value = area.value.slice(0, pos) + t.dataset.emoji + area.value.slice(area.selectionEnd ?? pos);
    ed.msg1 = area.value;
    area.focus();
    area.selectionStart = area.selectionEnd = pos + t.dataset.emoji.length;
    marcarSujo();
    renderPrevia();
    return;
  }

  if (t.dataset.tirarPalavra !== undefined) {
    ed.palavras.splice(Number(t.dataset.tirarPalavra), 1);
    marcarSujo(); renderBlocoGatilho(); return;
  }

  if (t.id === "btn-add-variante") {
    ed.variantes.push("");
    marcarSujo(); renderBlocoGatilho(); return;
  }

  if (t.dataset.tirarVariante !== undefined) {
    ed.variantes.splice(Number(t.dataset.tirarVariante), 1);
    marcarSujo(); renderBlocoGatilho(); return;
  }

  if (t.dataset.post !== undefined) {
    const id = t.dataset.post;
    ed.media_ids = ed.media_ids.includes(id)
      ? ed.media_ids.filter((x) => x !== id)
      : [...ed.media_ids, id];
    marcarSujo(); renderPosts(); return;
  }

  if (t.id === "btn-add-passo") { novoPasso(); marcarSujo(); renderConstrutor(); renderPrevia(); return; }

  if (t.dataset.tirarPasso !== undefined) {
    const id = Number(t.dataset.tirarPasso);
    ed.passos = ed.passos.filter((p) => p.id !== id);
    // Qualquer botão que apontava pra essa mensagem passa a encerrar.
    ed.passos.forEach((p) => p.buttons.forEach((b) => {
      if (b.dest === "msg" && Number(b.next) === id) { b.dest = "fim"; b.next = null; }
    }));
    marcarSujo(); renderConstrutor(); renderPrevia(); return;
  }

  if (t.dataset.addBotao !== undefined) {
    const passo = ed.passos.find((p) => String(p.id) === t.dataset.addBotao);
    if (passo) passo.buttons.push({ title: "", dest: "fim", next: null, url: "" });
    marcarSujo(); renderConstrutor(); renderPrevia(); return;
  }

  if (t.dataset.tirarBotao !== undefined) {
    const [idPasso, indice] = t.dataset.tirarBotao.split(":");
    const passo = ed.passos.find((p) => String(p.id) === idPasso);
    if (passo) passo.buttons.splice(Number(indice), 1);
    marcarSujo(); renderConstrutor(); renderPrevia(); return;
  }
}

function aoTeclar(e) {
  if (e.target.id !== "entrada-palavra") return;
  if (e.key !== "Enter" && e.key !== ",") return;
  e.preventDefault();
  const valor = e.target.value.trim().replace(/,$/, "");
  if (!valor) return;
  if (!state.ed.palavras.includes(valor)) state.ed.palavras.push(valor);
  marcarSujo();
  renderBlocoGatilho();
  $("#entrada-palavra")?.focus();
}

function novoPasso() {
  const ed = state.ed;
  const id = ed.proximoId++;
  ed.passos.push({
    id,
    message: "",
    buttons: [{ title: "", dest: "fim", next: null, url: "" }],
  });
  // O botão da Mensagem 1 passa a apontar pra primeira mensagem da sequência.
  return id;
}

/* ------------------- A PRÉVIA AO VIVO ------------------- */

function renderPrevia() {
  const ed = state.ed;
  const alvo = $("#previa-conversa");
  if (!ed || !alvo) return;

  const partes = [];

  // Automação de story: a conversa começa com a pessoa respondendo o story.
  if (ed.tipo === "story") {
    const exemplo = ed.match_any ? "Amei! 😍" : (ed.palavras[0] || "palavra");
    partes.push(`<div class="resposta-story">
      <span class="pequeno fraco">Respondeu ao seu story</span>
      <div class="balao-usuario">${esc(exemplo)}</div>
    </div>`);
  }

  // Mensagem 1, com os botões colados no balão.
  const botoes1 = [];
  if (ed.temBotao && ed.btnTitle.trim()) {
    if (ed.modo === "link" && ed.link.trim()) {
      botoes1.push({ title: ed.btnTitle, link: true });
    } else if (ed.modo === "conversa" && ed.passos.length) {
      botoes1.push({ title: ed.btnTitle, link: false });
    }
  }
  partes.push(balao(ed.msg1 || "(escreva a sua mensagem aqui em cima)", botoes1));

  // Aviso quando o botão existe mas ainda não tem pra onde ir.
  if (ed.temBotao && ed.btnTitle.trim() && botoes1.length === 0) {
    partes.push(`<div class="separador-previa">O botão aparece aqui assim que tiver um destino
      (um link colado ou uma próxima mensagem).</div>`);
  }

  // Mensagem 2 em diante.
  if (ed.modo === "conversa") {
    ed.passos.forEach((p, i) => {
      // Mostra o toque da pessoa no botão que levou até aqui.
      const veioDe = botaoQueLevaAte(p.id);
      if (veioDe) partes.push(`<div class="balao-usuario">${esc(veioDe)}</div>`);

      const botoes = (p.buttons ?? [])
        .filter((b) => b.title.trim() && (
          (b.dest === "link" && b.url.trim()) || (b.dest === "msg" && b.next)
        ))
        .slice(0, 3)
        .map((b) => ({ title: b.title, link: b.dest === "link" }));

      partes.push(balao(p.message || `(escreva a Mensagem ${i + 2})`, botoes));
    });
  }

  alvo.innerHTML = partes.join("");
}

// Desenha um balão com os botões anexados (colados no balão, estilo ManyChat).
function balao(texto, botoes) {
  const iconeLink = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>`;
  return `<div class="balao">
    <div class="texto">${esc(texto)}</div>
    ${botoes.length ? `<div class="botoes-anexados">
      ${botoes.map((b) => `<button type="button">${b.link ? iconeLink : ""}${esc(b.title.slice(0, 20))}</button>`).join("")}
    </div>` : ""}
  </div>`;
}

// Qual botão leva até essa mensagem? Serve pra prévia mostrar o toque da pessoa.
function botaoQueLevaAte(idPasso) {
  const ed = state.ed;
  if (ed.temBotao && ed.modo === "conversa" && ed.passos[0]?.id === idPasso) {
    return ed.btnTitle.trim() || null;
  }
  for (const p of ed.passos) {
    const b = (p.buttons ?? []).find((x) => x.dest === "msg" && Number(x.next) === idPasso);
    if (b && b.title.trim()) return b.title;
  }
  return null;
}

/* ------------------- SALVAR ------------------- */

async function salvarAutomacao() {
  const ed = state.ed;

  // Validação amigável, em português claro.
  const problemas = [];
  if (!ed.match_any && ed.palavras.length === 0) {
    problemas.push("Adicione pelo menos uma palavra que ativa, ou ligue 'qualquer palavra ativa'.");
  }
  if (!ed.msg1.trim()) problemas.push("Escreva a sua mensagem (a Mensagem 1).");
  if (ed.temBotao && !ed.btnTitle.trim()) problemas.push("Dê um nome pro botão.");
  if (ed.temBotao && ed.btnTitle.length > 20) problemas.push("O nome do botão passa de 20 caracteres.");
  if (ed.temBotao && ed.modo === "link" && !ed.link.trim()) problemas.push("Cole o link completo no campo do link.");
  if (ed.temBotao && ed.modo === "link" && ed.link.trim() && !/^https?:\/\//i.test(ed.link.trim())) {
    problemas.push("O link precisa começar com https:// (ou http://).");
  }
  if (ed.temBotao && ed.modo === "conversa" && ed.passos.length === 0) {
    problemas.push("Adicione pelo menos a Mensagem 2 pra conversa continuar.");
  }
  // As mensagens da sequência e os botões delas também são conferidos.
  if (ed.temBotao && ed.modo === "conversa") {
    ed.passos.forEach((p, i) => {
      const n = i + 2;
      if (!String(p.message ?? "").trim()) problemas.push(`Escreva o texto da Mensagem ${n}.`);
      // Botões que aparecem de verdade (encerrar não vira botão).
      const visiveis = (p.buttons ?? []).filter((b) => b.dest !== "fim");
      if (visiveis.length > 3) {
        problemas.push(`A Mensagem ${n} tem ${visiveis.length} botões. O Instagram aceita no máximo 3 por mensagem.`);
      }
      // É pelo nome que o sistema reconhece qual botão foi tocado.
      const nomes = visiveis.map((b) => String(b.title ?? "").trim().toLowerCase()).filter(Boolean);
      if (new Set(nomes).size < nomes.length) {
        problemas.push(`A Mensagem ${n} tem dois botões com o mesmo nome. Dê nomes diferentes a eles.`);
      }
      (p.buttons ?? []).forEach((b) => {
        const nome = String(b.title ?? "");
        if (b.dest !== "fim" && !nome.trim()) problemas.push(`Dê um nome ao botão da Mensagem ${n}.`);
        if (nome.length > 20) problemas.push(`O botão "${nome.slice(0, 20)}..." da Mensagem ${n} passa de 20 caracteres.`);
        if (b.dest === "link" && !String(b.url ?? "").trim()) problemas.push(`Um botão da Mensagem ${n} abre um link, mas o link está vazio.`);
        if (b.dest === "link" && String(b.url ?? "").trim() && !/^https?:\/\//i.test(String(b.url).trim())) {
          problemas.push(`O link de um botão da Mensagem ${n} precisa começar com https://.`);
        }
      });
    });
  }
  if (problemas.length) { alert("Falta pouco:\n\n" + problemas.map((p) => "• " + p).join("\n")); return; }

  const ehStory = ed.tipo === "story";
  const linha = {
    nome: ed.nome.trim() || "Automação sem nome",
    tipo: ehStory ? "story" : "post",
    tags: String(ed.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    keyword: ed.palavras.join(","),
    match_any: ed.match_any,
    active: ed.active,
    media_ids: ed.media_ids,
    // Story não tem comentário para responder em público.
    public_reply: ehStory ? "" : ed.public_reply.trim(),
    public_reply_variants: ehStory ? [] : ed.variantes.map((v) => v.trim()).filter(Boolean),
    flow: montarFlow(ed),
    asset_ids: ed.asset_ids,
  };

  // ---- Sem Supabase: salva só no navegador, e avisa isso com todas as letras ----
  if (!sb) {
    linha.id = ed.id ?? `local-${Date.now()}`;
    linha.updated_at = new Date().toISOString();
    const lista = state.automacoes.filter((a) => String(a.id) !== String(linha.id));
    state.automacoes = [linha, ...lista];
    gravarLocal(CHAVE_AUTOS_LOCAIS, state.automacoes);
    state.sujo = false;
    toast("Modo de teste local: salvo só no seu navegador, ainda não no banco. Configure o Supabase pelo LEIA-ME.", "atencao");
    state.ed = null;
    renderInstagram();
    return;
  }

  // ---- Com Supabase: salva de verdade ----
  try {
    if (ed.id) {
      const { error } = await sb.from("ig_automations").update(linha).eq("id", ed.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("ig_automations").insert(linha);
      if (error) throw error;
    }
    state.sujo = false;
    state.ed = null;
    await carregarAutomacoes();
    renderInstagram();
    toast("Automação salva.", "sucesso");
  } catch (e) {
    console.error(e);
    toast("Não deu pra salvar. Confira se você está logado e se as regras de acesso foram aplicadas.", "erro");
  }
}

/* =============================================================
   9. GRÁFICOS
   Barras finas, uma cor só, com a dica do dia ao passar o mouse.
   ============================================================= */

function graficoBarras(container, dados, sufixo) {
  if (!container) return;
  if (!dados?.length) {
    container.innerHTML = `<p class="pequeno fraco">Sem dados pra esse período ainda.</p>`;
    return;
  }

  const larg = 640, alt = 120, base = alt - 18, topo = 6;
  const maximo = Math.max(1, ...dados.map((d) => d.valor));
  const passo = larg / dados.length;
  const largBarra = Math.max(4, passo - 6); // 2px de respiro entre as barras

  const barras = dados.map((d, i) => {
    const h = Math.max(2, ((base - topo) * d.valor) / maximo);
    const x = i * passo + (passo - largBarra) / 2;
    return `<rect class="gr-barra" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}"
              width="${largBarra.toFixed(1)}" height="${h.toFixed(1)}"></rect>
            <rect class="gr-alvo" x="${(i * passo).toFixed(1)}" y="0" width="${passo.toFixed(1)}" height="${base}"
              data-i="${i}"></rect>`;
  }).join("");

  const primeiro = formatarDia(dados[0].data);
  const ultimo = formatarDia(dados[dados.length - 1].data);

  container.innerHTML = `
    <svg class="gr-svg" viewBox="0 0 ${larg} ${alt}" preserveAspectRatio="none">
      <line class="gr-grade" x1="0" y1="${base}" x2="${larg}" y2="${base}"></line>
      ${barras}
    </svg>
    <div style="display:flex;justify-content:space-between;margin-top:4px" class="pequeno fraco">
      <span>${primeiro}</span><span>${ultimo}</span>
    </div>
    <div class="gr-dica"></div>`;

  // A dica que segue o mouse.
  const dica = container.querySelector(".gr-dica");
  container.querySelectorAll(".gr-alvo").forEach((alvo) => {
    alvo.addEventListener("mouseenter", (ev) => {
      const d = dados[Number(alvo.dataset.i)];
      dica.textContent = `${formatarDia(d.data)}: ${d.valor.toLocaleString("pt-BR")} ${sufixo}`;
      dica.classList.add("visivel");
      const caixa = container.getBoundingClientRect();
      dica.style.left = `${ev.clientX - caixa.left}px`;
      dica.style.top = `${ev.clientY - caixa.top}px`;
    });
    alvo.addEventListener("mousemove", (ev) => {
      const caixa = container.getBoundingClientRect();
      dica.style.left = `${ev.clientX - caixa.left}px`;
      dica.style.top = `${ev.clientY - caixa.top}px`;
    });
    alvo.addEventListener("mouseleave", () => dica.classList.remove("visivel"));
  });
}

function formatarDia(iso) {
  const [a, m, d] = String(iso ?? "").split("-");
  return d ? `${d}/${m}` : String(iso ?? "");
}

/* =============================================================
   AVISO AO FECHAR A ABA COM ALGO NÃO SALVO
   ============================================================= */
window.addEventListener("beforeunload", (e) => {
  if (state.sujo) { e.preventDefault(); e.returnValue = ""; }
});

// Liga tudo.
iniciar();
