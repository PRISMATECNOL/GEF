/**
 * GEF | PARTILHA / CÓPIA DE LINKS (lojas e produtos)
 * Usa a Web Share API quando existe; caso contrário (ou se falhar) copia para a área de transferência,
 * com alternativa para navegadores antigos e mensagem de confirmação ou de erro.
 */
import { SITE_URL } from '../config.js';
import { showToast } from './toast.js';

const base = () => (SITE_URL || (window.location.origin + window.location.pathname.replace(/[^/]*$/, ''))).replace(/\/+$/, '');

/** Endereço permanente da loja virtual (independente de nome/preço de qualquer produto). */
export const storeUrl = (slug) => `${base()}/loja.html?s=${encodeURIComponent(slug)}`;
/** Endereço permanente de um produto: identifica-o pelo id, não pela posição numa lista. */
export const productUrl = (slug, productId) => `${storeUrl(slug)}&p=${encodeURIComponent(productId)}`;

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } finally { ta.remove(); }
  if (!ok) throw new Error('copy-failed');
  return true;
}

export async function copyLink(url, notify = showToast) {
  try { await copyText(url); notify('Link copiado.', 'success'); return true; }
  catch (e) { window.prompt('Copie o link manualmente:', url); return false; }
}

/** Partilha (Web Share API) com alternativa de cópia. */
export async function shareLink({ url, title = '', text = '', notify = showToast }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* outro erro: cai na cópia */ }
  }
  return (await copyLink(url, notify)) ? 'copied' : 'failed';
}

/** Liga todos os botões [data-share-url] de um contentor (um clique = partilhar/copiar de verdade). */
export function bindShareButtons(root) {
  root.querySelectorAll('[data-share-url]').forEach((btn) => {
    btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); shareLink({ url: btn.getAttribute('data-share-url'), title: btn.getAttribute('data-share-title') || '' }); };
  });
  root.querySelectorAll('[data-copy-url]').forEach((btn) => {
    btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyLink(btn.getAttribute('data-copy-url')); };
  });
}
