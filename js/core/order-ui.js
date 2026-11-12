/**
 * GEF | Peças partilhadas da loja virtual (v21): estado do pagamento, instruções de pagamento, logótipo, som.
 * Estado mostrado ao cliente: Pagamento validado | Pagamento pendente | Pagamento recusado.
 */
import { supabase } from './supabase.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Estado do pagamento para o cliente (cls: ok | wait | bad). */
export function payState(o) {
  const s = o && o.payment_status;
  if (s === 'PAGO') return { key: 'PAGO', cls: 'ok', icon: '✅', label: 'Pagamento validado', hint: 'A loja confirmou o seu pagamento.' };
  if (s === 'REJEITADO') return { key: 'REJEITADO', cls: 'bad', icon: '⛔', label: 'Pagamento recusado', hint: (o.payment_note ? `Motivo: ${o.payment_note}. ` : '') + 'Envie um novo comprovativo ou contacte a loja.' };
  if (s === 'COMPROVATIVO_ENVIADO') return { key: 'COMPROVATIVO_ENVIADO', cls: 'wait', icon: '⏳', label: 'Pagamento pendente', hint: 'Comprovativo enviado — a aguardar validação da loja.' };
  return { key: 'NAO_PAGO', cls: 'wait', icon: '⏳', label: 'Pagamento pendente', hint: 'Ainda sem comprovativo. Pague e envie o comprovativo.' };
}
export const payPill = (o) => { const p = payState(o); return `<span class="lj-pill lj-pay-${p.cls}">${p.icon} ${esc(p.label)}</span>`; };

/* ---------- instruções de pagamento (editáveis pelo Administrador) ---------- */
const cache = new Map();
export async function loadPaymentInfo(slug, force = false) {
  if (!force && cache.has(slug)) return cache.get(slug);
  let info = { text: '', accounts: [] };
  try {
    if (supabase) { const { data } = await supabase.rpc('fn_public_payment_info', { p_slug: slug }); if (data && data.ok) info = { text: data.text || '', accounts: Array.isArray(data.accounts) ? data.accounts : [] }; }
  } catch (e) { /* sem migração v21: mostra só o aviso genérico */ }
  cache.set(slug, info); return info;
}
export const hasPaymentInfo = (i) => !!(i && ((i.text && i.text.trim()) || (i.accounts && i.accounts.length)));

/** Bloco «Como pagar»: texto + contas (com botão «Copiar» em cada número). */
export function paymentBlockHtml(info, code = '') {
  if (!hasPaymentInfo(info)) return '';
  const acc = (info.accounts || []).map((a) => `<div class="lj-acc-row"><div><b>${esc(a.method || 'Conta')}</b>${a.holder ? `<div class="lj-meta">${esc(a.holder)}</div>` : ''}${a.extra ? `<div class="lj-meta">${esc(a.extra)}</div>` : ''}</div>
      ${a.number ? `<div class="lj-acc-num"><code>${esc(a.number)}</code><button type="button" class="lj-copy" data-copy="${esc(a.number)}" aria-label="Copiar ${esc(a.method || 'número')}">Copiar</button></div>` : ''}</div>`).join('');
  return `<section class="lj-payinfo"><h3>💳 Como pagar</h3>${info.text ? `<p>${esc(info.text)}</p>` : ''}${acc}${code ? `<p class="lj-meta">Indique o código <b>${esc(code)}</b> no pagamento e envie o comprovativo.</p>` : ''}</section>`;
}

/** Botões «Copiar» (delegação). Chamar uma vez. */
let copyBound = false;
export function bindCopy(toast) {
  if (copyBound) return; copyBound = true;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    const v = b.getAttribute('data-copy');
    try { await navigator.clipboard.writeText(v); } catch (_) { const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (__) { /* ignora */ } t.remove(); }
    const old = b.textContent; b.textContent = 'Copiado ✓'; setTimeout(() => { b.textContent = old; }, 1500); if (toast) toast('Copiado.');
  });
}

/* ---------- som curto de notificação (aplicação aberta) ---------- */
let audio = null;
export function playNotifySound() {
  try {
    if (!audio) { audio = new Audio('./assets/sounds/notify.wav'); audio.preload = 'auto'; audio.volume = 0.8; }
    audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {});
  } catch (e) { /* sem som */ }
}
/** O service worker avisa as páginas abertas quando chega uma notificação → toca o som curto. */
export function listenPushSound() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'gef-push') playNotifySound(); });
}

/** URL do logótipo da loja (identidade da app > logótipo da personalização). */
export function storeLogoUrl(identity, fallback) { return (identity && identity.logoUrl) || fallback || (identity && identity.icon192Url) || ''; }

/** Opções para o PDF / impressão: logótipo da loja, contactos e instruções de pagamento actuais. */
export async function receiptOptions(slug, store, logoUrl) {
  const st = store || {}; const payment = await loadPaymentInfo(slug);
  return { storeName: st.name, currency: st.currency, logoUrl: logoUrl || '', store: { phone: st.phone, address: st.address, city: st.city, email: st.email }, payment };
}
