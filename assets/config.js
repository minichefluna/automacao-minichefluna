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
  SUPABASE_URL: "https://tvhapuaewlewfuwtpjvb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2aGFwdWFld2xld2Z1d3RwanZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4NjksImV4cCI6MjEwNTMxMzg2OX0.ild2KCDnockaqo9nzD_fnB2eGTjd5ZczJaJbiSWw6VU",

  // Nome que aparece no topo do menu (troque pelo que quiser).
  NOME_DO_PAINEL: "Painel",
};
