/**
 * GEF | PDF real da encomenda (sem bibliotecas, sem janelas pop-up): descarrega com 1 toque.
 * Inclui o logótipo da própria loja, os dados da encomenda, os totais e as instruções de pagamento/contas.
 * Texto em Helvetica (WinAnsi): acentos portugueses OK. O logótipo é convertido para JPEG e embebido.
 */
import { payState, hasPaymentInfo } from './order-ui.js';

const PW = 595.28, PH = 841.89, M = 40, BOTTOM = 52;
const SUBS = { '−': '-', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '€': 'EUR', '\u00a0': ' ', '✓': 'v' };
const enc = (s) => { let o = ''; for (const ch of String(s ?? '')) { const c = SUBS[ch] ?? ch; for (const x of c) o += x.charCodeAt(0) < 256 ? x : '?'; } return o; };
const pdfStr = (s) => '(' + enc(s).replace(/[\\()]/g, (m) => '\\' + m).replace(/[\r\n]+/g, ' ') + ')';
const n2 = (v) => Number(v || 0);
const f2 = (v) => Number(v).toFixed(2);

let mctx = null;
function width(s, size, bold) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  return mctx.measureText(enc(s)).width;
}
function wrap(s, w, size, bold) {
  const out = [];
  for (const para of String(s ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let wd = word;
      while (width(wd, size, bold) > w && wd.length > 1) { let k = wd.length; while (k > 1 && width(wd.slice(0, k), size, bold) > w) k--; if (line) { out.push(line); line = ''; } out.push(wd.slice(0, k)); wd = wd.slice(k); }
      const t = line ? line + ' ' + wd : wd;
      if (width(t, size, bold) <= w) line = t; else { if (line) out.push(line); line = wd; }
    }
    out.push(line);
  }
  return out;
}

async function decodeImage(blob) {
  try { return await createImageBitmap(blob); } catch (e) {
    return await new Promise((res, rej) => { const u = URL.createObjectURL(blob); const im = new Image(); im.onload = () => { res(im); }; im.onerror = rej; im.src = u; });
  }
}
async function loadLogo(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return null;
    const src = await decodeImage(await r.blob());
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight; if (!sw || !sh) return null;
    const k = Math.min(1, 420 / Math.max(sw, sh));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9)); if (!blob) return null;
    return { w: cv.width, h: cv.height, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } catch (e) { return null; }
}
const bin = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

export async function buildOrderPdf(o, opts = {}) {
  const cur = opts.currency || 'MT';
  const money = (v) => `${n2(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const logo = await loadLogo(opts.logoUrl);
  const pages = []; let ops, y;
  const newPage = () => { ops = []; pages.push(ops); y = M; };
  const color = (c) => ops.push(`${c.map((x) => f2(x / 255)).join(' ')} rg`);
  const text = (s, x, size, { bold = false, c = [17, 24, 39], right = false, top = y } = {}) => {
    const w = width(s, size, bold); const xx = right ? x - w : x;
    color(c); ops.push(`BT /F${bold ? 2 : 1} ${size} Tf ${f2(xx)} ${f2(PH - top - size * 0.85)} Td ${pdfStr(s)} Tj ET`);
  };
  const hline = (yy, x1 = M, x2 = PW - M, c = [203, 213, 225]) => ops.push(`${c.map((x) => f2(x / 255)).join(' ')} RG 0.6 w ${f2(x1)} ${f2(PH - yy)} m ${f2(x2)} ${f2(PH - yy)} l S`);
  const room = (h) => { if (y + h > PH - BOTTOM) { newPage(); return true; } return false; };
  const para = (s, x, w, size, { bold = false, c = [17, 24, 39], lead = size * 1.35 } = {}) => { for (const l of wrap(s, w, size, bold)) { room(lead); text(l, x, size, { bold, c }); y += lead; } };

  newPage();
  // ---- cabeçalho: logótipo da loja + nome ----
  let hx = M;
  if (logo) {
    const k = Math.min(150 / logo.w, 56 / logo.h); const lw = logo.w * k, lh = logo.h * k;
    ops.push(`q ${f2(lw)} 0 0 ${f2(lh)} ${f2(M)} ${f2(PH - M - lh)} cm /Im1 Do Q`); hx = M + lw + 12;
  }
  text(opts.storeName || 'Loja', hx, 17, { bold: true, top: y + 4 });
  const st = opts.store || {};
  const contact = [st.address, st.city, st.phone, st.email].filter(Boolean).join(' · ');
  if (contact) text(contact, hx, 8.5, { c: [100, 116, 139], top: y + 26 });
  text('ENCOMENDA', PW - M, 9, { bold: true, right: true, c: [100, 116, 139], top: y + 2 });
  text(o.code || '', PW - M, 16, { bold: true, right: true, top: y + 14 });
  y += Math.max(logo ? Math.min(56, 150 * logo.h / logo.w, 56) : 40, 40) + 12; hline(y); y += 14;

  // ---- cliente / data / pagamento ----
  const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-PT') : '';
  text('Cliente', M, 8, { c: [100, 116, 139] }); text('Data', M + 300, 8, { c: [100, 116, 139] }); y += 11;
  text(o.customer_name || '', M, 10.5, { bold: true }); text(dt, M + 300, 10.5); y += 14;
  const lines2 = [o.phone, o.address].filter(Boolean).join(' · '); if (lines2) { para(lines2, M, 280, 9, { c: [71, 85, 105] }); }
  if (o.payment_status) { const ps = payState(o); y += 2; text('Pagamento: ' + ps.label, M, 10, { bold: true, c: ps.cls === 'ok' ? [21, 128, 61] : ps.cls === 'bad' ? [185, 28, 28] : [180, 83, 9] }); y += 15; }
  y += 6;

  // ---- tabela ----
  const cols = [M, M + 255, M + 310, M + 410]; const right = [M + 250, M + 305, M + 405, PW - M];
  const head = () => { ops.push(`0.945 0.961 0.976 rg ${f2(M)} ${f2(PH - y - 16)} ${f2(PW - 2 * M)} 16 re f`); text('Produto', cols[0] + 4, 8.5, { bold: true, top: y + 3 }); text('Qtd.', right[1], 8.5, { bold: true, right: true, top: y + 3 }); text('Preço un.', right[2], 8.5, { bold: true, right: true, top: y + 3 }); text('Total', right[3] - 2, 8.5, { bold: true, right: true, top: y + 3 }); y += 20; };
  head();
  for (const i of o.items || []) {
    const nameL = wrap(i.name || i.product_name || '', 245, 9.5, false);
    const sub = [i.color_name, i.promotion_name ? 'Promoção: ' + i.promotion_name : ''].filter(Boolean);
    const h = nameL.length * 12 + sub.length * 10 + 7;
    if (y + h > PH - BOTTOM) { newPage(); head(); }
    nameL.forEach((l, k) => text(l, cols[0] + 4, 9.5, { top: y + k * 12 }));
    sub.forEach((l, k) => text(l, cols[0] + 4, 8, { c: [100, 116, 139], top: y + nameL.length * 12 + k * 10 }));
    text(`${i.quantity}${i.unit ? ' ' + i.unit : ''}`, right[1], 9.5, { right: true });
    const promo = n2(i.unit_price) < n2(i.base_price);
    text(money(i.unit_price), right[2], 9.5, { right: true });
    if (promo) text(money(i.base_price), right[2], 7.5, { right: true, c: [148, 163, 184], top: y + 11 });
    text(money(i.line_total), right[3] - 2, 9.5, { right: true, bold: true });
    y += h; hline(y - 3, M, PW - M, [226, 232, 240]);
  }
  y += 8;
  // ---- totais ----
  const items = o.items || [];
  const sub = o.subtotal_original ?? items.reduce((n, i) => n + n2(i.line_original ?? n2(i.base_price) * n2(i.quantity)), 0);
  const disc = o.discount_total ?? 0;
  room(60);
  const trow = (l, v, bold, size = 10) => { text(l, right[2], size, { right: true, bold, c: bold ? [17, 24, 39] : [71, 85, 105] }); text(v, right[3] - 2, size, { right: true, bold }); y += size + 6; };
  trow('Subtotal (original)', money(sub)); if (n2(disc) > 0) trow('Desconto', '- ' + money(disc));
  hline(y - 2, M + 300, PW - M, [148, 163, 184]); y += 4; trow('Total a pagar', money(o.total), true, 12.5);
  y += 10;

  // ---- instruções de pagamento ----
  const pay = opts.payment;
  if (hasPaymentInfo(pay)) {
    const accs = pay.accounts || [];
    room(60); hline(y); y += 10; text('Como pagar', M, 11.5, { bold: true }); y += 18;
    if (pay.text) para(pay.text, M, PW - 2 * M, 9.5, { c: [51, 65, 85] });
    for (const a of accs) {
      room(40); y += 4;
      ops.push(`0.973 0.980 0.988 rg ${f2(M)} ${f2(PH - y - 34)} ${f2(PW - 2 * M)} 34 re f`);
      text(a.method || 'Conta', M + 8, 9.5, { bold: true, top: y + 5 }); if (a.holder) text(a.holder, M + 8, 8.5, { c: [100, 116, 139], top: y + 18 });
      if (a.number) text(a.number, PW - M - 8, 11, { bold: true, right: true, top: y + 6 }); if (a.extra) text(a.extra, PW - M - 8, 8, { right: true, c: [100, 116, 139], top: y + 21 });
      y += 38;
    }
    y += 6; para(`Indique o código ${o.code || ''} no pagamento e envie o comprovativo à loja (na loja virtual ou por WhatsApp).`, M, PW - 2 * M, 8.5, { c: [100, 116, 139] });
  }

  // ---- rodapé em todas as páginas ----
  pages.forEach((p, idx) => {
    ops = p; color([148, 163, 184]);
    const tx = `${opts.storeName || ''}${contact ? ' - ' + contact : ''}`;
    p.push(`BT /F1 7.5 Tf ${f2(M)} ${f2(26)} Td ${pdfStr(tx.slice(0, 110))} Tj ET`);
    const pg = `Página ${idx + 1} de ${pages.length}`; p.push(`BT /F1 7.5 Tf ${f2(PW - M - width(pg, 7.5, false))} ${f2(26)} Td ${pdfStr(pg)} Tj ET`);
  });

  // ---- montagem do ficheiro ----
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('PLACEHOLDER');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  if (logo) add(`<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n${bin(logo.bytes)}\nendstream`);
  const kids = [];
  pages.forEach((p) => {
    const body = p.join('\n'); const cid = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    const pid = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${logo ? ' /XObject << /Im1 5 0 R >>' : ''} >> /Contents ${cid} 0 R >>`); kids.push(`${pid} 0 R`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%âãÏÓ\n'; const offs = [];
  objs.forEach((s, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${s}\nendobj\n`; });
  const xr = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o2) => String(o2).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
  const u8 = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u8[i] = out.charCodeAt(i) & 255;
  return new Blob([u8], { type: 'application/pdf' });
}

/** Descarrega o PDF com 1 toque (ficheiro «Encomenda-CÓDIGO.pdf»). */
export async function downloadOrderPdf(o, opts) {
  const blob = await buildOrderPdf(o, opts); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `Encomenda-${String(o.code || 'recibo').replace(/[^A-Za-z0-9_-]/g, '')}.pdf`; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); return true;
}
