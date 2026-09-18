// =============================================================
// CONFIGURAÇÃO DO PAINEL
//
// É o ÚNICO arquivo que você precisa editar pra colocar no ar.
// Pegue os dois valores no Supabase, em: Settings > API.
//
// Pode deixar a chave anônima aqui mesmo, à vista: quem tranca o
// banco é o RLS (as regras de acesso do arquivo 03_rls.sql).
// A chave de service_role NUNCA vem pra cá.
//
// Enquanto estiver com os placeholders, o sistema roda em modo de
// teste local (sem Supabase), pra você navegar e ver tudo de pé.
// =============================================================

window.APP_CONFIG = {
  SUPABASE_URL: "SEU_SUPABASE_URL_AQUI",       // ex: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: "SUA_SUPABASE_ANON_KEY_AQUI",

  // Nome que aparece no topo do menu (troque pelo que quiser).
  NOME_DO_PAINEL: "Painel",
};
