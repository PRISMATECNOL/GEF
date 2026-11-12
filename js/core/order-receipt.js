/**
 * GEF | Recibo da compra (loja virtual). Mostra SEMPRE os valores gravados na encomenda:
 * preço original, desconto, preço final por item e totais; logótipo da loja e instruções de pagamento.
 * Imprimir = impressão directa (iframe, sem pop-ups). PDF = js/core/order-pdf.js (descarrega com 1 toque).
 */
import { payState, hasPaymentInfo } from './order-ui.js';
export { downloadOrderPdf } from './order-pdf.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = (v) => Number(v || 0);

export function receiptHtml(o, { storeName = '', currency = 'MT', logoUrl = '', store = {}, payment = null, autoprint = false } = {}) {
  const money = (v) => `${n2(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(currency)}`;
  const items = (o.items || []).map((i) => {
    const lo = i.line_original ?? Math.round(n2(i.base_price) * n2(i.quantity) * 100) / 100;
    const ld = i.line_discount ?? Math.max(0, lo - n2(i.line_total));
    return { ...i, lo, ld };
  });
  const sub = o.subtotal_original ?? items.reduce((n, i) => n + n2(i.lo), 0);
  const disc = o.discount_total ?? items.reduce((n, i) => n + n2(i.ld), 0);
  const rows = items.map((i) => `<tr><td>${esc(i.name || i.product_name)}${i.color_name ? `<br><small>${esc(i.color_name)}</small>` : ''}${i.promotion_name ? `<br><small>Promoção: ${esc(i.promotion_name)}</small>` : ''}</td>
    <td class="r">${esc(i.quantity)} ${esc(i.unit || '')}</td><td class="r">${money(i.base_price)}</td><td class="r">${n2(i.unit_price) < n2(i.base_price) ? '− ' + money(n2(i.base_price) - n2(i.unit_price)) : '—'}</td>
    <td class="r"><b>${money(i.unit_price)}</b></td><td class="r">${money(i.line_total)}</td></tr>`).join('');
  const contact = [store.address, store.city, store.phone, store.email].filter(Boolean).join(' · ');
  const ps = o.payment_status ? payState(o) : null;
  const pay = hasPaymentInfo(payment) ? `<div class="pay"><h3>Como pagar</h3>${payment.text ? `<p>${esc(payment.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${(payment.accounts || []).map((a) => `<div class="acc"><span><b>${esc(a.method || 'Conta')}</b>${a.holder ? `<br><small>${esc(a.holder)}</small>` : ''}${a.extra ? `<br><small>${esc(a.extra)}</small>` : ''}</span><b class="num">${esc(a.number || '')}</b></div>`).join('')}
      <p><small>Indique o código <b>${esc(o.code)}</b> no pagamento e envie o comprovativo à loja.</small></p></div>` : '';
  return `<html><head><meta charset="utf-8"><title>${esc(o.code)}</title><style>body{font:13px system-ui,sans-serif;margin:20px;color:#111}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}.r{text-align:right}small{color:#555}.t{margin-left:auto;width:280px;margin-top:12px}.t div{display:flex;justify-content:space-between;padding:3px 0}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}.hd img{max-height:60px;max-width:170px;object-fit:contain}.hd h2{margin:0}.pay{margin-top:18px;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;break-inside:avoid}.pay h3{margin:0 0 6px}.acc{display:flex;justify-content:space-between;gap:12px;background:#f8fafc;padding:7px 10px;margin:5px 0;border-radius:6px}.num{font-size:15px;letter-spacing:.03em}</style></head><body>
    <div class="hd">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}<div><h2>${esc(storeName)}</h2>${contact ? `<small>${esc(contact)}</small>` : ''}</div></div>
    <h3 style="margin:0 0 4px">Encomenda ${esc(o.code)}</h3><p style="margin:0 0 10px">${esc(o.customer_name || '')}${o.phone ? ' · ' + esc(o.phone) : ''}${o.address ? '<br>' + esc(o.address) : ''}<br>${o.created_at ? esc(new Date(o.created_at).toLocaleString('pt-PT')) : ''}${ps ? `<br><b>Pagamento: ${esc(ps.label)}</b>` : ''}</p>
    <table><tr><th>Produto</th><th class="r">Qtd.</th><th class="r">Preço original</th><th class="r">Desconto/un.</th><th class="r">Preço final/un.</th><th class="r">Total</th></tr>${rows}</table>
    <div class="t"><div><span>Subtotal (original)</span><span>${money(sub)}</span></div><div><span>Desconto</span><span>− ${money(disc)}</span></div><div><b>Total a pagar</b><b>${money(o.total)}</b></div></div>${pay}
    ${autoprint ? '<script>window.onload=()=>window.print()<\/script>' : ''}</body></html>`;
}

/** Imprime já (sem abrir separadores): iframe invisível → caixa de impressão do dispositivo («Guardar como PDF» também serve). */
export function printReceipt(o, opts = {}) {
  try {
    const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const d = f.contentWindow.document; d.open(); d.write(receiptHtml(o, { ...opts, autoprint: false })); d.close();
    let done = false;
    const go = () => { if (done) return; done = true; try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* ignora */ } setTimeout(() => f.remove(), 120000); };
    const imgs = [...d.images].filter((i) => !i.complete); let pend = imgs.length;
    if (!pend) setTimeout(go, 60); else { imgs.forEach((i) => { i.onload = i.onerror = () => { if (--pend <= 0) go(); }; }); setTimeout(go, 2500); }
    return true;
  } catch (e) { return false; }
}
