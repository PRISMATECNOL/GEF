/**
 * GEF | Loja virtual: conta de cliente (criar conta e entrar — sem email obrigatório, sem códigos de confirmação) e ÁREA DO CLIENTE.
 * Autenticação = Supabase Auth; dados e consentimentos = tabelas/RPC da migracao_clientes_campanhas_v18.sql.
 * Comprar como convidado continua disponível (nada aqui é obrigatório para encomendar).
 */
import { supabase } from './core/supabase.js';
import { printReceipt } from './core/order-receipt.js';
import { VAPID_PUBLIC_KEY, LOGIN_DOMAIN } from './config.js';
import { isStandalone, wasInstalled } from './loja-install.js';
import { publicImageUrl } from './core/image-utils.js';
import { payState, payPill, loadPaymentInfo, paymentBlockHtml, hasPaymentInfo, bindCopy, listenPushSound, playNotifySound, receiptOptions } from './core/order-ui.js';
import { downloadOrderPdf } from './core/order-pdf.js';

const MAX_PROOF = 5 * 1024 * 1024;
/** Reduz fotografias grandes (telemóvel) antes de enviar: JPEG até 1600 px. PDF segue como está. */
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82)); return blob && blob.size < file.size ? new File([blob], 'comprovativo.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { PENDENTE: 'Pendente', CONFIRMADA: 'Confirmada', EM_PREPARACAO: 'Em preparação', ENTREGUE: 'Entregue', CANCELADA: 'Cancelada' };
const stOf = (o) => (o.status !== 'CANCELADA' && o.status !== 'ENTREGUE' && o.fulfillment === 'PRONTA' ? 'Pronta para entrega' : (o.status !== 'CANCELADA' && o.status !== 'ENTREGUE' && o.fulfillment === 'LOGISTICA' ? 'A ser preparada' : (ST[o.status] || o.status)));
let C = null;            // { slug, getStore, money, toast }
let me = null;           // estado devolvido por fn_customer_me
let blocked = '';        // motivo (ex.: sessão de utilizador do sistema)
let installSynced = false;

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Erro');
  return data;
}
const fmtDate = (d) => new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
const pageUrl = () => { const u = new URL(location.href); u.hash = ''; u.search = ''; u.searchParams.set('s', C.slug); return u.href; };

export const prefill = () => (me ? { name: me.customer.name, phone: me.customer.whatsapp ? '+' + me.customer.whatsapp : (me.customer.phone || ''), email: me.customer.email || '', address: me.customer.address || '' } : {});

function paintButton() {
  const b = document.getElementById('lj-acc'); if (!b) return;
  b.textContent = me ? `👤 ${String(me.customer.name).split(' ')[0]}` : '👤 Entrar';
}

async function refreshMe() {
  blocked = '';
  if (!supabase) { me = null; return paintButton(); }
  const { data } = await supabase.auth.getSession();
  if (!data.session) { me = null; return paintButton(); }
  try { me = await rpc('fn_customer_me', { p_slug: C.slug }); if (!me) me = await rpc('fn_customer_ensure', { p_slug: C.slug, p_data: {} }); }
  catch (e) { me = null; blocked = e.message; }
  paintButton();
  if (me && !installSynced && (isStandalone() || wasInstalled(C.slug))) { installSynced = true; rpc('fn_customer_mark_installed', { p_slug: C.slug }).then((s) => { me = s; }).catch(() => {}); }
}

/* ---------- janela ---------- */
function modal(html) {
  document.querySelectorAll('.lj-ov').forEach((n) => n.remove());
  const ov = document.createElement('div'); ov.className = 'lj-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="lj-md lj-acc"><button class="lj-x" data-cx="close" aria-label="Fechar">✕</button>${html}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov); return ov;
}
const $ = (ov, s) => ov.querySelector(s);
const setMsg = (ov, text, ok) => { const m = $(ov, '#cx-msg'); if (m) { m.textContent = text || ''; m.style.color = ok ? '#15803d' : '#b91c1c'; } };
const friendlyAuth = (e) => (e && e.message) || 'Erro. Tente novamente.';

/* ---------- entrar / criar conta ----------
 * Nome, contacto (telemóvel) e endereço bastam; o email é opcional. Sem código de confirmação.
 * O pedido passa pela função «customer-auth», que aplica o limite de tentativas no servidor. */
/* SEM Edge Function: usa directamente o Supabase Auth (Confirm email desligado). O telemóvel vira o email interno p<9 dígitos>@LOGIN_DOMAIN. */
const digitsOf = (v) => String(v ?? '').replace(/[^0-9]/g, '');
function loginEmail(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (id.includes('@')) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id)) throw new Error('Indique o seu telemóvel (ou o email da conta).'); return id; }
  const d = digitsOf(id); if (d.length < 7 || d.length > 15) throw new Error('Indique o seu telemóvel (ou o email da conta).');
  return `p${d.length > 9 ? d.slice(-9) : d}@${LOGIN_DOMAIN}`;
}
async function callAuth(body) {
  const pw = String(body.password || '');
  if (pw.length < 6 || pw.length > 128) throw new Error('Palavra-passe inválida.');
  if (body.action === 'login') {
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(body.identifier), password: pw });
    if (error) throw new Error(/rate|too many/i.test(error.message) ? 'Demasiadas tentativas. Tente novamente dentro de alguns minutos.' : 'Telemóvel/email ou palavra-passe incorretos.');
    return;
  }
  const name = String(body.name || '').replace(/\s+/g, ' ').trim(); const phoneD = digitsOf(body.phone); const address = String(body.address || '').trim().slice(0, 300);
  const email = String(body.email || '').trim().toLowerCase(); const whatsapp = digitsOf(body.whatsapp);
  if (name.length < 2) throw new Error('Indique o seu nome.');
  if (phoneD.length < 7 || phoneD.length > 15) throw new Error('Indique um contacto (telemóvel) válido.');
  if (address.length < 3) throw new Error('Indique o seu endereço.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email inválido (pode deixá-lo em branco).');
  if (pw.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres.');
  if (/^(.)\1+$/.test(pw) || digitsOf(pw) === phoneD) throw new Error('Escolha uma palavra-passe mais segura (não use o telemóvel nem caracteres repetidos).');
  const em = loginEmail(phoneD);
  const { data, error } = await supabase.auth.signUp({ email: em, password: pw, options: { data: { login_kind: 'phone', name, phone: String(body.phone || '').trim().slice(0, 30), whatsapp, address, email, wa_optin: !!body.wa_optin, email_optin: !!body.email_optin } } });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) { const r = await supabase.auth.signInWithPassword({ email: em, password: pw }); if (!r.error) return; throw new Error('Já existe uma conta com este telemóvel. Use «Entrar».'); }
    throw new Error(/rate|too many/i.test(error.message) ? 'Demasiadas tentativas. Tente novamente dentro de alguns minutos.' : 'Não foi possível criar a conta. Tente novamente.');
  }
  if (!data.session) {   // conta nova mas sem sessão (utilizador já existente devolve identities vazias)
    const r = await supabase.auth.signInWithPassword({ email: em, password: pw });
    if (r.error) throw new Error('Já existe uma conta com este telemóvel. Use «Entrar».');
  }
}

function openAuth(tab = 'login', note = '') {
  if (tab !== 'signup') tab = 'login';
  const tabs = [['login', 'Entrar'], ['signup', 'Criar conta']];
  const forms = {
    login: `<input name="identifier" placeholder="Telemóvel *" required autocomplete="off" maxlength="120" inputmode="tel"><input name="password" type="password" placeholder="Palavra-passe *" required autocomplete="new-password" minlength="6">
            <button class="lj-btn" type="submit">Entrar</button><div class="lj-meta">Guarde bem a sua palavra-passe: não há recuperação por email.</div>`,
    signup: `<input name="name" placeholder="Nome *" required maxlength="120" autocomplete="off"><input name="phone" type="tel" placeholder="Contacto (telemóvel) *" required maxlength="30" autocomplete="off" inputmode="tel">
             <input name="address" placeholder="Endereço *" required maxlength="300" autocomplete="off">
             <input name="email" type="email" placeholder="Email (opcional — só para promoções)" maxlength="120" autocomplete="off">
             <input name="whatsapp" type="tel" placeholder="WhatsApp com indicativo, se for diferente do contacto (opcional)" maxlength="30" autocomplete="off">
             <input name="password" type="password" placeholder="Palavra-passe (mín. 8 caracteres) *" required minlength="8" autocomplete="new-password">
             <label class="lj-chk"><input type="checkbox" name="wa_optin"> Aceito receber promoções por WhatsApp (opcional; posso cancelar a qualquer momento).</label>
             <label class="lj-chk"><input type="checkbox" name="email_optin"> Aceito receber promoções por email (só se indicou email; opcional).</label>
             <div class="lj-meta">Entra sempre com o telemóvel indicado. Usamos os seus dados para gerir a conta e as compras; só enviamos promoções ao que autorizar.</div><button class="lj-btn" type="submit">Criar conta</button>`
  };
  const ov = modal(`<h2 style="padding:14px 14px 0;margin:0">A sua conta</h2>
    <div class="lj-tabs">${tabs.map(([k, l]) => `<button data-cx="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
    <form class="lj-form" id="cx-form">${forms[tab]}<div class="lj-err" id="cx-msg" role="alert">${esc(note)}</div></form>
    <div class="lj-meta" style="padding:0 14px 14px">Pode comprar sem conta: feche esta janela e continue como convidado.</div>`);
  { const fm = $(ov, '#cx-form'); fm.setAttribute('autocomplete', 'off'); fm.reset(); setTimeout(() => fm.reset(), 50); }   // abre SEMPRE vazio (sem preenchimento automático)
  $(ov, '#cx-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = $(ov, 'button[type=submit]'); btn.disabled = true; setMsg(ov, '');
    try {
      if (tab === 'login') {
        await callAuth({ action: 'login', identifier: String(f.get('identifier') || '').trim(), password: String(f.get('password')) });
      } else {
        const phone = String(f.get('phone') || '').trim(); const email = String(f.get('email') || '').trim();
        const optinWa = !!f.get('wa_optin'); const optinMail = !!f.get('email_optin');
        let whatsapp = String(f.get('whatsapp') || '').replace(/[^0-9]/g, '');
        if (!whatsapp && optinWa) whatsapp = phone.replace(/[^0-9]/g, '');
        if (whatsapp && !/^[0-9]{9,15}$/.test(whatsapp)) throw new Error('WhatsApp inválido: indique o número com indicativo.');
        if (optinMail && !email) throw new Error('Para receber promoções por email indique o seu email.');
        await callAuth({ action: 'signup', name: String(f.get('name') || '').trim(), phone, address: String(f.get('address') || '').trim(), email, whatsapp, password: String(f.get('password')), wa_optin: optinWa, email_optin: optinMail });
      }
      await refreshMe(); if (me) { autoPush(); return openArea(); } throw new Error(blocked || 'Não foi possível abrir a conta.');
    } catch (er) { setMsg(ov, friendlyAuth(er)); } finally { btn.disabled = false; }
  });
}

/* ---------- Área do cliente ---------- */
let areaTab = 'orders'; let payFilter = 'all'; let ordersP = null; let ordersList = [];
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const thumbImg = (p) => (p ? `<img src="${esc(publicImageUrl(p))}" alt="" loading="lazy" width="42" height="42">` : '<span class="ph">📦</span>');
const isPending = (o) => o.status !== 'CANCELADA' && o.payment_status !== 'PAGO';
const filterOf = (o) => (o.payment_status === 'PAGO' ? 'ok' : (o.payment_status === 'REJEITADO' ? 'bad' : 'wait'));

/* Avisa (mesmo sem notificação do sistema) quando o pagamento de uma compra é validado ou recusado. */
function checkPayChanges(list) {
  const key = `gef_pay_seen_${C.slug}`; let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { prev = null; }
  const now = Object.fromEntries(list.map((o) => [o.id, o.payment_status]));
  try { localStorage.setItem(key, JSON.stringify(now)); } catch (e) { /* ignora */ }
  if (!prev) return;
  const ch = list.filter((o) => prev[o.id] && prev[o.id] !== o.payment_status && (o.payment_status === 'PAGO' || o.payment_status === 'REJEITADO'));
  if (!ch.length) return;
  const o = ch[0]; playNotifySound();
  C.toast(`${o.payment_status === 'PAGO' ? '✅ Pagamento validado' : '⛔ Pagamento recusado'} — encomenda ${o.code}${ch.length > 1 ? ` (+${ch.length - 1})` : ''}`);
}
async function fetchOrders() { const l = await rpc('fn_customer_orders', { p_slug: C.slug }); ordersList = Array.isArray(l) ? l : []; checkPayChanges(ordersList); return ordersList; }
const getOrders = (force) => { if (force || !ordersP) ordersP = fetchOrders().catch((e) => { ordersP = null; throw e; }); return ordersP; };

function paintKpis(ov, list) {
  const k = $(ov, '#cx-kpis'); if (!k) return;
  const paid = list.filter((o) => o.payment_status === 'PAGO' && o.status !== 'CANCELADA').reduce((n, o) => n + Number(o.total || 0), 0);
  k.innerHTML = `<div class="lj-kpi"><b>${list.length}</b><span>Compras</span></div><div class="lj-kpi"><b>${C.money(paid)}</b><span>Total pago</span></div><div class="lj-kpi"><b>${list.filter(isPending).length}</b><span>Pagamentos pendentes</span></div>`;
}

async function openArea(tab) {
  if (tab) areaTab = tab;
  if (!me) return openAuth('login');
  const c = me.customer; const inst = me.installed || isStandalone();
  const tabs = [['orders', 'Compras'], ['profile', 'Perfil'], ['pay', 'Como pagar'], ['comms', 'Notificações']];
  const ov = modal(`<div class="lj-prof-hd"><div class="lj-avatar" aria-hidden="true">${esc(initials(c.name))}</div><div style="min-width:0"><h2 style="margin:0">Olá, ${esc(c.name)}</h2><div class="lj-meta">${esc(c.phone || c.email || '')}${c.address ? ' · ' + esc(c.address) : ''}</div>
      <div class="lj-badges"><span class="lj-pill">${inst ? '📲 App instalada' : '🌐 Navegador'}</span><span class="lj-pill">${notifOn() ? '🔔 Notificações ativas' : '🔕 Notificações desligadas'}</span></div></div></div>
    <div class="lj-kpis" id="cx-kpis"></div>
    <div class="lj-tabs">${tabs.map(([k, l]) => `<button data-cx="atab" data-tab="${k}" aria-pressed="${k === areaTab}">${l}</button>`).join('')}</div>
    <div id="cx-body"></div><div style="padding:0 14px 14px"><button class="lj-btn sec" data-cx="logout">Terminar sessão</button></div>`);
  const body = $(ov, '#cx-body');
  getOrders(true).then((l) => paintKpis(ov, l)).catch(() => {});
  if (areaTab === 'orders') await drawOrders(ov, body); else if (areaTab === 'profile') drawProfile(ov, body); else if (areaTab === 'pay') await drawPay(ov, body); else drawComms(ov, body);
}

async function drawOrders(ov, body, force = false) {
  body.innerHTML = '<div class="lj-msg">A carregar…</div>';
  let list = []; try { list = await getOrders(force); } catch (e) { body.innerHTML = `<div class="lj-err" style="padding:14px">${esc(e.message)}</div>`; return; }
  paintKpis(ov, list);
  const cnt = { all: list.length, ok: 0, wait: 0, bad: 0 }; list.forEach((o) => { cnt[filterOf(o)]++; });
  const shown = list.filter((o) => payFilter === 'all' || filterOf(o) === payFilter);
  const chips = [['all', 'Todas'], ['wait', '⏳ Pendente'], ['ok', '✅ Validado'], ['bad', '⛔ Recusado']].map(([k, l]) => `<button data-cx="pfilter" data-f="${k}" aria-pressed="${payFilter === k}">${l} (${cnt[k]})</button>`).join('');
  const rows = shown.map((o) => {
    const th = (o.thumbs || []).slice(0, 3); const extra = Math.max(0, Number(o.lines) - th.length);
    return `<button class="lj-ord" data-cx="order" data-id="${esc(o.id)}"><div class="lj-ord-l"><div class="lj-thumbs">${th.length ? th.map(thumbImg).join('') : '<span class="ph">📦</span>'}${extra > 0 ? `<span class="lj-more-th">+${extra}</span>` : ''}</div>
        <div style="min-width:0"><b>${esc(o.code)}</b><div class="lj-meta">${esc(fmtDate(o.created_at))} · ${esc(o.lines)} produto(s)</div></div></div>
      <div class="lj-ord-r"><b>${C.money(o.total)}</b><div class="lj-meta">${esc(stOf(o))}</div>${payPill(o)}</div></button>`;
  }).join('<div style="height:8px"></div>');
  body.innerHTML = `${list.length ? `<div class="lj-filt" role="group" aria-label="Filtrar por pagamento">${chips}</div>` : ''}<div style="padding:4px 14px 8px">${rows || `<div class="lj-msg" style="padding:24px 0">${list.length ? 'Nenhuma compra neste estado.' : 'Ainda não tem compras associadas a esta conta.'}</div>`}
    <details style="margin-top:12px"><summary><b>Associar uma compra antiga</b></summary>
      <form class="lj-form" id="cx-claim" style="padding:10px 0"><div class="lj-meta">Por segurança, só associamos compras depois de verificar que são suas: indique o código da encomenda e o telefone usado na compra .</div>
        <input name="code" placeholder="Código da encomenda (ex.: ENC-1A2B3C4D)" maxlength="30"><input name="phone" type="tel" placeholder="Telefone usado na compra" maxlength="30">
        <button class="lj-btn" type="submit">Verificar e associar</button>${me.phone_login ? '' : '<button class="lj-btn sec" type="button" data-cx="claim-email">Associar compras feitas com o meu email</button>'}<div class="lj-err" id="cx-msg" role="alert"></div></form></details></div>`;
  $(body, '#cx-claim').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { const r = await rpc('fn_customer_claim_orders', { p_slug: C.slug, p_code: f.get('code'), p_phone: f.get('phone') }); C.toast(`${r.linked} compra(s) associada(s).`); drawOrders(ov, body, true); } catch (er) { setMsg(ov, er.message); }
  });
}

async function openOrder(ov, id) {
  const body = $(ov, '#cx-body'); body.innerHTML = '<div class="lj-msg">A carregar…</div>';
  let o; try { o = await rpc('fn_customer_order_get', { p_slug: C.slug, p_order_id: id }); } catch (e) { body.innerHTML = `<div class="lj-err" style="padding:14px">${esc(e.message)}</div>`; return; }
  ov._order = o; const st = C.getStore() || {}; const ps = payState(o); const info = await loadPaymentInfo(C.slug);
  const lines = o.items.map((i) => `<div class="lj-pl">${i.thumb ? `<img src="${esc(publicImageUrl(i.thumb))}" alt="" loading="lazy" width="52" height="52">` : '<span class="ph">📦</span>'}
      <div><div class="t">${esc(i.name)}</div><div class="lj-meta">${i.color_name ? esc(i.color_name) + ' · ' : ''}${esc(i.quantity)} × ${Number(i.unit_price) < Number(i.base_price) ? `<s>${C.money(i.base_price)}</s> ` : ''}${C.money(i.unit_price)}</div>${i.promotion_name ? `<div class="lj-meta">Promoção: ${esc(i.promotion_name)}</div>` : ''}</div>
      <b>${C.money(i.line_total)}</b></div>`).join('');
  const wa = String(st.phone || '').replace(/[^0-9]/g, '');
  const open = o.status !== 'CANCELADA' && o.payment_status !== 'PAGO';
  body.innerHTML = `<div style="padding:8px 14px"><button class="lj-link" data-cx="back">← Voltar às compras</button><h3 style="margin:8px 0 2px">${esc(o.code)}</h3><div class="lj-meta">${esc(fmtDate(o.created_at))}</div>
    <div style="margin:8px 0"><span class="lj-pill">${esc(stOf(o))}</span></div>
    <div class="lj-paybox lj-pay-${ps.cls}"><span style="font-size:20px">${ps.icon}</span><div><b>${esc(ps.label)}</b><span class="lj-meta" style="color:inherit">${esc(ps.hint)}</span></div></div>
    <div>${lines}</div>
    <div class="lj-tot" style="margin-top:8px"><span>Subtotal original</span><span>${C.money(o.subtotal_original)}</span></div><div class="lj-tot"><span>Desconto</span><span>− ${C.money(o.discount_total)}</span></div><div class="lj-tot"><b>Total</b><b>${C.money(o.total)}</b></div>
    ${open ? paymentBlockHtml(info, o.code) : ''}
    ${open ? `<div class="lj-proof"><b>${o.payment_status === 'REJEITADO' ? 'Pagamento recusado — envie novo comprovativo' : 'Já pagou?'}</b> Envie o comprovativo (foto ou PDF) — a loja valida o pagamento.
      <label class="lj-btn" style="display:block;text-align:center;margin-top:8px">${o.proofs.length ? 'Enviar outro comprovativo' : 'Enviar comprovativo'}<input type="file" hidden data-cx-file accept="image/*,application/pdf"></label>
      <div class="lj-meta" id="cx-pmsg">${o.proofs.length ? `${o.proofs.length} comprovativo(s) enviado(s).` : 'JPG, PNG, WEBP ou PDF até 5 MB.'}</div></div>` : ''}
    <div class="lj-bigbtns"><button class="lj-btn" data-cx="pdf"><span class="ic">⬇</span>Descarregar PDF</button><button class="lj-btn sec" data-cx="print"><span class="ic">🖨</span>Imprimir</button>${wa.length >= 7 ? `<a class="lj-btn sec" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Sobre a encomenda ${o.code}.`)}"><span class="ic">💬</span>WhatsApp da loja</a>` : ''}</div></div>`;
}

async function drawPay(ov, body) {
  const info = await loadPaymentInfo(C.slug); const st = C.getStore() || {}; const wa = String(st.phone || '').replace(/[^0-9]/g, '');
  body.innerHTML = `<div style="padding:0 14px 8px">${hasPaymentInfo(info) ? paymentBlockHtml(info) : `<div class="lj-msg" style="padding:24px 0">A loja ainda não indicou instruções de pagamento. Contacte-a para saber como pagar.</div>`}
    ${wa.length >= 7 ? `<a class="lj-btn sec" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${wa}">💬 Falar com a loja</a>` : ''}</div>`;
}

function drawProfile(ov, body) {
  const c = me.customer;
  body.innerHTML = `<form class="lj-form" id="cx-prof"><h3 style="margin:0">Dados pessoais</h3><label class="lj-lbl">Nome<input name="name" value="${esc(c.name)}" required maxlength="120"></label>
    <label class="lj-lbl">Contacto (telemóvel)<input name="phone" type="tel" value="${esc(c.phone || '')}" maxlength="30"></label>
    <label class="lj-lbl">Endereço de entrega<input name="address" value="${esc(c.address || '')}" maxlength="300"></label>
    <label class="lj-lbl">Email (opcional)<input name="email" type="email" value="${esc(c.email || '')}" maxlength="120"></label>
    <label class="lj-lbl">WhatsApp (com indicativo)<input name="whatsapp" type="tel" value="${c.whatsapp ? '+' + esc(c.whatsapp) : ''}" maxlength="30" placeholder="+258 84 000 0000"></label>
    <div class="lj-meta">O acesso à conta continua a ser feito com o telemóvel com que a criou.</div>
    <button class="lj-btn" type="submit">Guardar dados</button><div class="lj-err" id="cx-msg" role="alert"></div></form>
    <form class="lj-form" id="cx-pw" style="border-top:1px solid var(--line)"><h3 style="margin:0">Segurança</h3><label class="lj-lbl">Nova palavra-passe<input name="pw" type="password" minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>
      <label class="lj-lbl">Repetir palavra-passe<input name="pw2" type="password" minlength="8" autocomplete="new-password"></label>
      <button class="lj-btn sec" type="submit">Alterar palavra-passe</button><div class="lj-meta" id="cx-pwmsg" role="alert">Sem email não há recuperação: guarde bem a palavra-passe.</div></form>`;
  $(body, '#cx-prof').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { me = await rpc('fn_customer_update_v19', { p_slug: C.slug, p_name: f.get('name'), p_phone: f.get('phone'), p_whatsapp: f.get('whatsapp'), p_address: f.get('address'), p_email: f.get('email') }); paintButton(); setMsg(ov, 'Perfil guardado.', true); } catch (er) { setMsg(ov, er.message); }
  });
  $(body, '#cx-pw').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const m = $(body, '#cx-pwmsg'); const pw = String(f.get('pw') || '');
    if (pw.length < 8) { m.textContent = 'A palavra-passe precisa de pelo menos 8 caracteres.'; m.style.color = '#b91c1c'; return; }
    if (pw !== String(f.get('pw2') || '')) { m.textContent = 'As palavras-passe não coincidem.'; m.style.color = '#b91c1c'; return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    m.textContent = error ? error.message : 'Palavra-passe alterada.'; m.style.color = error ? '#b91c1c' : '#15803d'; if (!error) e.target.reset();
  });
}

/* ---------- comunicações / consentimentos ---------- */
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
const isIOS = () => (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'Notification' in window;
const notifOn = () => !!(me && me.consents && me.consents.PUSH && pushSupported() && Notification.permission === 'granted');

function drawComms(ov, body) {
  const k = me.consents; const wa = me.customer.whatsapp;
  let pushNote = '';
  if (!pushSupported()) pushNote = isIOS() && !isStandalone() ? 'No iPhone, instale primeiro a aplicação (Partilhar → Adicionar ao ecrã principal), abra-a e volte aqui.' : 'Este navegador não suporta notificações.';
  else if (Notification.permission === 'denied') pushNote = 'As notificações estão bloqueadas no navegador. Permita-as nas definições do site para as ativar.';
  body.innerHTML = `<div style="padding:8px 14px 14px">
    <div class="lj-set"><div><b>Promoções por WhatsApp</b><div class="lj-meta">${wa ? `Número: +${esc(wa)}. Também pode cancelar respondendo PARAR a uma mensagem.` : 'Indique o seu WhatsApp em «Perfil e contactos» para poder ativar.'}</div></div>
      <button class="lj-btn ${k.WHATSAPP ? '' : 'sec'}" data-cx="consent" data-ch="WHATSAPP" data-v="${k.WHATSAPP ? 0 : 1}" ${wa || k.WHATSAPP ? '' : 'disabled'}>${k.WHATSAPP ? 'Autorizado · Cancelar' : 'Autorizar'}</button></div>
    <div class="lj-set"><div><b>Promoções por email</b><div class="lj-meta">${me.customer.email ? `Email: ${esc(me.customer.email)}.` : 'Indique o seu email em «Perfil e contactos» para poder ativar.'}</div></div>
      <button class="lj-btn ${k.EMAIL ? '' : 'sec'}" data-cx="consent" data-ch="EMAIL" data-v="${k.EMAIL ? 0 : 1}" ${me.customer.email || k.EMAIL ? '' : 'disabled'}>${k.EMAIL ? 'Autorizado · Cancelar' : 'Autorizar'}</button></div>
    <div class="lj-set"><div><b>Notificações no aparelho</b><div class="lj-meta">Promoções, estado dos pagamentos e entregas, com um som curto. Pode desativar quando quiser. ${pushNote ? esc(pushNote) : (k.PUSH && Notification.permission !== 'granted' ? 'Autorizou, mas este aparelho ainda não permitiu: toque em «Ativar».' : '')}</div></div>
      <button class="lj-btn ${notifOn() ? '' : 'sec'}" data-cx="push" data-v="${notifOn() ? 0 : 1}" ${pushNote && !notifOn() ? 'disabled' : ''}>${notifOn() ? 'Ativas · Desativar' : 'Ativar neste aparelho'}</button></div>
    <div class="lj-set" style="display:block"><b>Últimas notificações</b><div id="cx-nlist" class="lj-meta">A carregar…</div></div>
    <div class="lj-set"><div><b>Aplicação instalada</b><div class="lj-meta">Instalar a aplicação não ativa notificações nem promoções: são autorizações separadas.</div></div><span class="lj-pill">${me.installed || isStandalone() ? 'Sim' : 'Não'}</span></div>
    <div class="lj-err" id="cx-msg" role="alert"></div></div>`;
  rpc('fn_customer_notifications', { p_slug: C.slug }).then((r) => { const el = $(body, '#cx-nlist'); if (!el) return; el.innerHTML = (r.items || []).length ? r.items.slice(0, 10).map((n) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b style="color:var(--text)">${esc(n.title)}</b><div>${esc(n.body)}</div><small>${esc(fmtDate(n.created_at))}</small></div>`).join('') : 'Ainda sem notificações.'; }).catch(() => {});
}

/* Web Push (app fechada): precisa da VAPID_PUBLIC_KEY em js/config.js e da função send-push. Sem isso, continua a funcionar com a app aberta. */
async function ensureSubscription() {
  if (!VAPID_PUBLIC_KEY || !('PushManager' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await rpc('fn_customer_push_register', { p_slug: C.slug, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 180), p_installed: isStandalone() });
}
async function togglePush(ov, on, source = 'area_cliente') {
  if (on) {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Permissão de notificações não concedida.');
    try { await ensureSubscription(); } catch (e) { console.warn('[GEF] push', e.message); }
    me = await rpc('fn_customer_set_consent', { p_slug: C.slug, p_channel: 'PUSH', p_granted: true, p_source: source });
    pollNotifs();
  } else {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { const ep = sub.endpoint; await sub.unsubscribe().catch(() => {}); await rpc('fn_customer_push_unregister', { p_slug: C.slug, p_endpoint: ep }).catch(() => {}); } } catch (e) { /* ignora */ }
    me = await rpc('fn_customer_set_consent', { p_slug: C.slug, p_channel: 'PUSH', p_granted: false, p_source: 'area_cliente' });
  }
}

/* Notificações sem servidor de push: a app vai buscar as novas (SQL) e mostra a notificação do sistema com som curto. */
let polling = false;
async function pollNotifs() {
  if (polling || !me || !notifOn()) return; polling = true;
  try {
    const r = await rpc('fn_customer_notifications', { p_slug: C.slug });
    if (r && r.enabled && (r.new || []).length) {
      const reg = await navigator.serviceWorker.ready;
      for (const n of r.new) {
        try { await reg.showNotification(String(n.title).slice(0, 80), { body: String(n.body).slice(0, 240), icon: './assets/icons/pwa-192x192.png', badge: './assets/icons/pwa-192x192.png', tag: 'gef-n-' + n.id, silent: false, vibrate: [90, 50, 90], data: { url: n.url || '', slug: C.slug } }); } catch (e) { /* ignora */ }
      }
      if (document.visibilityState === 'visible') playNotifySound();
    }
  } catch (e) { /* tenta no próximo ciclo */ } finally { polling = false; }
}

/* ---------- eventos ---------- */
async function onClick(e) {
  const el = e.target.closest('[data-cx]'); if (!el) return;
  const ov = el.closest('.lj-ov'); const act = el.dataset.cx;
  try {
    if (act === 'account') return me ? openArea() : openAuth(blocked ? 'login' : 'login', blocked);
    if (act === 'close') return ov.remove();
    if (act === 'tab') return openAuth(el.dataset.tab);
    if (act === 'atab') return openArea(el.dataset.tab);
    if (act === 'order') return openOrder(ov, el.dataset.id);
    if (act === 'back') return drawOrders(ov, $(ov, '#cx-body'), true);
    if (act === 'pdf') { el.disabled = true; try { await downloadOrderPdf(ov._order, await receiptOptions(C.slug, C.getStore(), C.getLogo && C.getLogo())); } finally { el.disabled = false; } return; }
    if (act === 'print') return void (printReceipt(ov._order, await receiptOptions(C.slug, C.getStore(), C.getLogo && C.getLogo())) || C.toast('Não foi possível imprimir.'));
    if (act === 'pfilter') { payFilter = el.dataset.f; return drawOrders(ov, $(ov, '#cx-body')); }
    if (act === 'push-on') { el.disabled = true; await enablePush(); return; }
    if (act === 'claim-email') { const r = await rpc('fn_customer_claim_orders', { p_slug: C.slug }); C.toast(`${r.linked} compra(s) associada(s).`); return drawOrders(ov, $(ov, '#cx-body'), true); }
    if (act === 'consent') { el.disabled = true; me = await rpc('fn_customer_set_consent', { p_slug: C.slug, p_channel: el.dataset.ch, p_granted: el.dataset.v === '1', p_source: 'area_cliente' }); return drawComms(ov, $(ov, '#cx-body')); }
    if (act === 'push') { el.disabled = true; await togglePush(ov, el.dataset.v === '1'); return drawComms(ov, $(ov, '#cx-body')); }
    if (act === 'logout') { await supabase.auth.signOut(); me = null; blocked = ''; paintButton(); ov.remove(); C.toast('Sessão terminada.'); }
  } catch (er) { if (ov && $(ov, '#cx-msg')) setMsg(ov, er.message); else C.toast(er.message); if (el) el.disabled = false; }
}

/* envia o ficheiro (bucket privado) e regista o comprovativo; a encomenda passa a «Pagamento pendente» (a aguardar validação) */
async function doUpload(file, orderId, say) {
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type) && !file.type.startsWith('image/')) throw new Error('Formato não suportado: use foto (JPG/PNG/WEBP) ou PDF.');
  say('A preparar…'); file = await shrink(file);
  if (file.size > MAX_PROOF) throw new Error('Ficheiro demasiado grande (máx. 5 MB).');
  const mime = file.type === 'application/pdf' ? 'application/pdf' : (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg');
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[mime];
  const path = `${me.customer.id}/${orderId}/${Date.now()}.${ext}`;
  say('A enviar…');
  const up = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: mime, upsert: false }); if (up.error) throw new Error(up.error.message);
  await rpc('fn_customer_submit_proof', { p_slug: C.slug, p_order_id: orderId, p_path: path, p_mime: mime, p_size: file.size });
}

async function uploadProof(input) {
  const ov = input.closest('.lj-ov'); const o = ov._order; const msg = $(ov, '#cx-pmsg'); const file = input.files && input.files[0]; input.value = ''; if (!file) return;
  const say = (t, bad) => { msg.textContent = t; msg.style.color = bad ? '#b91c1c' : ''; };
  try { await doUpload(file, o.id, say); C.toast('Comprovativo enviado.'); getOrders(true).then((l) => paintKpis(ov, l)).catch(() => {}); await openOrder(ov, o.id); } catch (er) { say(er.message, true); }
}

/* Confirmação da compra: «Enviar comprovativo» (conta iniciada) — o ecrã de confirmação mostra o resultado em #lj-proof-msg */
async function uploadProofByInput(input) {
  const code = input.dataset.cxCode; const msg = document.getElementById('lj-proof-msg'); const file = input.files && input.files[0]; input.value = ''; if (!file || !msg) return;
  const say = (t, bad) => { msg.textContent = t; msg.style.color = bad ? '#b91c1c' : ''; };
  try {
    const list = await getOrders(true); const o = list.find((x) => x.code === code);
    if (!o) throw new Error('Não foi possível ligar esta compra à sua conta. Envie o comprovativo por WhatsApp.');
    await doUpload(file, o.id, say); say('✅ Comprovativo enviado. A loja irá validar o pagamento e avisá-lo.'); C.toast('Comprovativo enviado.'); getOrders(true).catch(() => {});
  } catch (er) { say(er.message, true); }
}
export const isLoggedIn = () => !!me;
export const openAccount = (tab) => (me ? openArea() : openAuth(tab || 'login'));

/* ---------- aplicação instalada: notificações directas ----------
 * A app instalada pede (e pede de novo, até aceitar) a permissão de notificações do dispositivo. Aceite a permissão, a subscrição
 * fica ligada à conta e as campanhas chegam directamente. O sistema operativo não permite forçar a permissão: é sempre o utilizador a aceitá-la. */
const installedApp = () => isStandalone() || wasInstalled(C.slug);
const pushActive = notifOn;
async function enablePush() {
  try { await togglePush(null, true, 'app_instalada'); C.toast('🔔 Notificações ativadas.'); }
  catch (e) { C.toast(e.message || 'Não foi possível ativar as notificações.'); }
  paintPushBar();
}
function paintPushBar() {
  const old = document.getElementById('lj-pushbar'); if (old) old.remove();
  if (!installedApp() || !pushSupported() || pushActive()) return;
  if (Notification.permission === 'denied') return;   // bloqueado no dispositivo: a Área do Cliente > Notificações explica como reativar
  const bar = document.createElement('div'); bar.id = 'lj-pushbar'; bar.className = 'lj-pushbar'; bar.setAttribute('role', 'status');
  bar.innerHTML = me ? '<span>🔔 Ative as notificações para receber promoções e o estado dos seus pagamentos.</span><button class="lj-btn" data-cx="push-on">Ativar</button>'
                     : '<span>🔔 Entre ou crie conta para receber promoções e avisos de pagamento.</span><button class="lj-btn" data-cx="account">Entrar</button>';
  document.body.appendChild(bar);
}
let firstTapBound = false;
async function autoPush() {
  paintPushBar();
  if (notifOn()) ensureSubscription().catch(() => {});   // garante a subscrição push deste aparelho
  if (!me || !installedApp() || !pushSupported()) return;
  if (Notification.permission === 'granted' && !me.consents.PUSH) { try { await togglePush(null, true, 'app_instalada'); paintPushBar(); } catch (e) { /* tenta na próxima abertura */ } return; }
  if (Notification.permission === 'default' && !firstTapBound) {            // 1.º toque na app → pedido de permissão (precisa de gesto do utilizador, sobretudo no iPhone)
    firstTapBound = true;
    const once = (ev) => { if (ev.target.closest && ev.target.closest('.lj-ov')) return; document.removeEventListener('pointerup', once); enablePush(); };
    document.addEventListener('pointerup', once);
  }
}

export async function initCustomer(ctx) {
  C = ctx; if (!supabase) return;
  bindCopy(C.toast); listenPushSound();
  document.addEventListener('click', onClick);
  document.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-cx-file]')) uploadProof(e.target);
    else if (e.target.matches && e.target.matches('[data-cx-code]')) uploadProofByInput(e.target);
  });
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { me = null; ordersP = null; paintButton(); paintPushBar(); } });
  await refreshMe(); autoPush();
  // acompanha o estado dos pagamentos: ao abrir, ao voltar à app e de minuto a minuto (só com sessão e ecrã visível)
  const poll = async () => {
    if (!me || document.visibilityState !== 'visible') return;
    try { await getOrders(true); const ov = document.querySelector('.lj-acc') && document.querySelector('.lj-acc').closest('.lj-ov'); if (ov && areaTab === 'orders' && $(ov, '#cx-body .lj-ord')) drawOrders(ov, $(ov, '#cx-body')); else if (ov) paintKpis(ov, ordersList); } catch (e) { /* tenta depois */ }
  };
  if (me) getOrders(true).catch(() => {});
  document.addEventListener('visibilitychange', () => { poll(); pollNotifs(); }); setInterval(poll, 60000); setInterval(pollNotifs, 30000); pollNotifs();
  const q = new URLSearchParams(location.search);
  if (q.get('conta') === 'comunicacoes') { me ? openArea('comms') : openAuth('login'); }
}
