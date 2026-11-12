/**
 * GEF | Identificador de acesso: TELEMÓVEL (ou email, nas contas antigas).
 * Tem de dar o MESMO resultado que public.fn_login_email() no SQL (migracao_cadastro_sem_email_v20.sql).
 * O «email técnico» nunca recebe mensagens: serve apenas para o Supabase Auth reconhecer a conta.
 */
import { LOGIN_DOMAIN } from '../config.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** telemóvel/email escrito pelo utilizador → email usado no Supabase Auth (ou null se inválido). */
export function toLoginEmail(identifier) {
  const v = String(identifier ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('@')) return EMAIL_RE.test(v) && v.length <= 120 ? v : null;
  const d = v.replace(/[^0-9]/g, '');
  if (d.length < 7 || d.length > 15) return null;
  return `s${d.slice(-9)}@${LOGIN_DOMAIN}`;
}

/** Email técnico (s841112222@…) → texto amigável (841112222). Emails reais ficam como estão. */
export function displayLogin(email) {
  const m = String(email ?? '').match(new RegExp(`^[sp]([0-9]{7,15})@${LOGIN_DOMAIN.replace(/\./g, '\\.')}$`, 'i'));
  return m ? m[1] : String(email ?? '');
}
