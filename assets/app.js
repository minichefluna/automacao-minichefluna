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
     7. Tela Instagram (fica em assets/instagram.js)
     8. O editor de automação (com a prévia ao vivo)
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
  automacoes: [],
  posts: [],
  stories: [],
  midiaCarregada: false,   // posts e stories já foram buscados nesta sessão?
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
   Toda a central do Instagram (Visão geral, Automações, Leads, Interações
   e Análises) fica no arquivo assets/instagram.js.
   ============================================================= */

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
   AVISO AO FECHAR A ABA COM ALGO NÃO SALVO
   ============================================================= */
window.addEventListener("beforeunload", (e) => {
  if (state.sujo) { e.preventDefault(); e.returnValue = ""; }
});

// Liga tudo.
iniciar();
