/**
 * GEF - GESTÃO FINANCEIRA | CONFIGURAÇÃO CENTRAL
 * JavaScript Puro (Vanilla JS)
 *
 * Única fonte de configuração pública do projeto (Regra 43).
 * NUNCA colocar a Service Role Key aqui — apenas a URL pública
 * e a Anon/Public Key do Supabase (Project Settings -> API).
 *
 * Edite os valores abaixo antes de publicar (GitHub / Vercel / hospedagem estática).
 */

export const SUPABASE_URL = 'https://esrkuvxxwurlvkghqmpl.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzcmt1dnh4d3VybHZrZ2hxbXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MjkwMzQsImV4cCI6MjEwNjIwNTAzNH0.KZ7AIBM-2FeVzWTT06VZur6dqd07BCnxh1tqp4noGV4';

/**
 * Endereço público do site (sem barra final e sem /adesao.html).
 * Usado para gerar o link de cada embaixador, para que seja SEMPRE o mesmo,
 * independentemente do domínio/pasta de onde o Super Admin abre o painel.
 * Exemplo: 'https://gef.co.mz'  ou  'https://meuusuario.github.io/gef'
 * Se ficar vazio, o link é deduzido do endereço atual (menos estável).
 */
export const SITE_URL = '';

/** Versão do front-end (aparece no ecrã de Produtos para confirmar que a versão nova foi publicada). */
export const APP_VERSION = 'v26';

/**
 * Domínio técnico usado para transformar o TELEMÓVEL em identificador de acesso (nunca recebe emails).
 * Tem de ser IGUAL a fn_login_domain() no SQL (migracao_cadastro_sem_email_v20.sql) e ao segredo CUSTOMER_LOGIN_DOMAIN.
 */
export const LOGIN_DOMAIN = 'cliente.invalid';

/**
 * Contacto da administração da plataforma, mostrado no painel do Embaixador.
 * Edite com os dados reais antes de publicar. O telefone abaixo é o número M-Pesa que já
 * constava no painel do embaixador; confirme se é também o contacto da administração.
 */
export const ADMIN_CONTACT = {
  name: 'Administração GEF',
  phone: '+258 84 764 0849',
  whatsapp: '+258847640849',
  email: '',
  location: 'Maputo, Moçambique'
};

/**
 * Chave PÚBLICA VAPID para notificações PWA (a chave PRIVADA fica só nos Secrets do Supabase).
 * Gerar com: npx web-push generate-vapid-keys   — colar aqui a "Public Key".
 */
export const VAPID_PUBLIC_KEY = '';
