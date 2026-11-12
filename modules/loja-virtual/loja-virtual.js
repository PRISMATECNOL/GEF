/**
 * GEF | LOJA VIRTUAL & ENCOMENDAS (ADMIN / GERENTE da loja)
 * - Endereço permanente da loja (copiar / partilhar / abrir) e estado (activada pelo Super Administrador).
 * - Personalização: tema autorizado, cores, logótipo, imagem de destaque, textos e ordem das secções.
 * - Encomendas online: lista paginada por cursor, detalhe com cor por linha, estado e pagamento (confirmação manual).
 * Encomenda criada NÃO é venda confirmada nem pagamento recebido.
 */
import { db } from '../../js/core/database.js';
import { auth } from '../../js/core/auth.js';
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { storeUrl, productUrl, bindShareButtons } from '../../js/components/share-link.js';
import { drawPromocoes } from './promocoes.js';
import { drawClientes } from './clientes-loja.js';
import { drawCampanhas } from './campanhas.js';
import { supabase } from '../../js/core/supabase.js';
import { printReceipt } from '../../js/core/order-receipt.js';
import { validateImageFile, resizeImage, publicImageUrl, BUCKET } from '../../js/core/image-utils.js';

const ST = { PENDENTE: ['badge-amber', 'Pendente'], CONFIRMADA: ['badge-blue', 'Confirmada'], EM_PREPARACAO: ['badge-blue', 'Em preparação'], ENTREGUE: ['badge-emerald', 'Entregue'], CANCELADA: ['badge-red', 'Cancelada'] };
const PAY = { NAO_PAGO: 'Pendente', COMPROVATIVO_ENVIADO: 'Pendente (comprovativo enviado)', PAGO: 'Validado', REJEITADO: 'Recusado' };
const SECTION_NAMES = { promos: 'Promoções', featured: 'Destaques', categories: 'Categorias', catalog: 'Catálogo' };
const fdt = (d) => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleString('pt-PT'); };
const money = (v) => Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const input = 'width:100%;margin-top:3px;';

export async function initLojaVirtualModule(container) {
  const user = auth.getCurrentUser ? auth.getCurrentUser() : null;
  const role = String(user?.role || '').toUpperCase();
  const canEdit = ['ADMIN', 'GERENTE', 'SUPERADMIN'].includes(role);
  const isMkt = role === 'MARKETING';                          // equipa de Marketing & Vendas: promoções, notificações, clientes, encomendas (leitura) e envio para a logística
  const canCamp = canEdit || isMkt;
  const canSendLog = ['ADMIN', 'GERENTE', 'MARKETING'].includes(role);
  const canPay = ['ADMIN', 'GERENTE', 'SUPERADMIN', 'MARKETING'].includes(role);   // v24: quem envia para a logística também valida/recusa o pagamento (o servidor impõe a mesma regra)
  let notif = { unread: 0, items: [] };
  let info = null, tab = 'orders';
  const O = { items: [], next: null, status: '', q: '', loading: false };

  const rpc = (n, a) => db.rpcV7(n, a);
  const friendly = (e) => (/could not find the function|schema cache/i.test(e.message) ? 'Falta executar migracao_loja_virtual_v10.sql no Supabase.' : e.message);

  async function render() {
    try { info = await rpc('fn_vstore_my_info'); }
    catch (e) { container.innerHTML = `<div class="card" style="padding:24px;max-width:560px;margin:30px auto;color:#fde68a;">${esc(friendly(e))}</div>`; return; }
    const url = info.slug ? storeUrl(info.slug) : '';
    const active = info.enabled && info.store_active;
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;">
      <div class="card" style="padding:16px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
          <div><div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;">Loja virtual</div>
          <h2 style="margin:2px 0 0;font-size:18px;color:#f8fafc;">Endereço público da sua loja</h2></div>
          <span class="badge ${active ? 'badge-emerald' : 'badge-red'}">${active ? 'ACTIVA' : 'DESACTIVADA'}</span></div>
        ${!info.enabled ? '<p style="font-size:12px;color:#fbbf24;margin:8px 0 0;">A loja virtual ainda não foi activada pelo Super Administrador. Pode preparar produtos e personalização; o endereço só aceita encomendas depois de activada.</p>' : ''}
        ${info.enabled && !info.store_active ? '<p style="font-size:12px;color:#fbbf24;margin:8px 0 0;">A loja está suspensa no sistema, por isso a loja virtual não aceita encomendas.</p>' : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center;">
          <input readonly value="${esc(url)}" onfocus="this.select()" style="flex:1 1 280px;font-size:12px;">
          <button class="btn btn-secondary" data-copy-url="${esc(url)}">Copiar</button>
          <button class="btn btn-secondary" data-share-url="${esc(url)}" data-share-title="Loja virtual">Partilhar</button>
          <a class="btn btn-secondary" href="${esc(url)}" target="_blank" rel="noopener">Abrir</a></div>
        <div style="font-size:10px;color:#94a3b8;margin-top:6px;">O endereço é permanente. O link de cada produto está no ecrã do produto («Loja virtual») — não é preciso voltar aqui.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ${tab === 'orders' ? 'btn-primary' : 'btn-secondary'}" data-tab="orders">Encomendas online</button>
        <button class="btn ${tab === 'promos' ? 'btn-primary' : 'btn-secondary'}" data-tab="promos">Promoções</button>
        <button class="btn ${tab === 'clients' ? 'btn-primary' : 'btn-secondary'}" data-tab="clients">Clientes</button>
        <button class="btn ${tab === 'camps' ? 'btn-primary' : 'btn-secondary'}" data-tab="camps">Promoções e notificações</button>
        ${isMkt ? '' : `<button class="btn ${tab === 'config' ? 'btn-primary' : 'btn-secondary'}" data-tab="config">Personalização</button>`}</div>
      <div id="lv-body"></div></div>`;
    bindShareButtons(container);
    container.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    if (tab === 'orders') { await loadOrders(true); } else if (tab === 'clients') { await drawClientes(container.querySelector('#lv-body'), { rpc, friendly }); } else if (tab === 'camps') { await drawCampanhas(container.querySelector('#lv-body'), { rpc, friendly, canEdit: canCamp, isAdmin: ['ADMIN', 'SUPERADMIN'].includes(String(user?.role || '').toUpperCase()), info, storeUrl, productUrl }); } else if (tab === 'promos') { await drawPromocoes(container.querySelector('#lv-body'), { rpc, friendly, canEdit: canCamp }); } else drawConfig();
  }

  /* ---------- encomendas ---------- */
  async function loadOrders(reset) {
    if (O.loading) return; O.loading = true;
    if (reset) { O.items = []; O.next = null; }
    try {
      if (reset) notif = await rpc('fn_order_notifications', { p_mark_seen: false }).catch(() => ({ unread: 0, items: [] }));
      const r = await rpc('fn_store_orders_list', { p_status: O.status || null, p_q: O.q || null, p_before: O.next?.before || null, p_before_id: O.next?.before_id || null, p_limit: 20 });
      O.items = O.items.concat(r.items || []); O.next = r.next || null;
    } catch (e) { showToast(friendly(e), 'error'); }
    O.loading = false; drawOrders();
  }
  function drawOrders() {
    const body = container.querySelector('#lv-body'); if (!body) return;
    const banner = notif.unread ? `<div class="card" style="padding:10px 14px;margin-bottom:10px;border:1px solid #10b981;background:rgba(16,185,129,.08);display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:13px;color:#a7f3d0;">🚚 ${notif.unread} encomenda(s) pronta(s) para entrega: ${notif.items.filter((x) => x.unread).slice(0, 3).map((x) => `<b>${esc(x.code)}</b> (${esc(x.by || '—')})`).join(', ')}${notif.unread > 3 ? '…' : ''}</span>
        <button class="btn btn-secondary" id="nt-seen" style="padding:2px 10px;font-size:11px;">Marcar como vistas</button></div>` : '';
    body.innerHTML = `${banner}<div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #1f2937;">
        <input type="search" id="lv-q" placeholder="Pesquisar código, cliente, telefone…" value="${esc(O.q)}" style="flex:1 1 220px;max-width:420px;">
        <select id="lv-st"><option value="">Todos os estados</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${O.status === k ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></div>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Código</th><th>Cliente</th><th>Linhas</th><th>Total</th><th>Estado</th><th>Pagamento</th><th>Data</th></tr></thead><tbody>
      ${O.items.length ? O.items.map((o) => `<tr data-id="${esc(o.id)}" style="cursor:pointer;"><td><b>${esc(o.code)}</b></td><td>${esc(o.customer_name)}<div style="font-size:10px;color:#94a3b8;">${esc(o.phone)}</div></td><td>${o.lines}</td>
        <td class="mono">${money(o.total)}</td><td><span class="badge ${(ST[o.status] || ST.PENDENTE)[0]}">${(ST[o.status] || ST.PENDENTE)[1]}</span>${o.fulfillment === 'PRONTA' ? ' <span class="badge badge-emerald">Pronta</span>' : (o.fulfillment === 'LOGISTICA' ? ' <span class="badge badge-blue">Na logística</span>' : '')}</td><td style="font-size:11px;">${esc(PAY[o.payment_status] || o.payment_status)}</td><td style="font-size:11px;">${fdt(o.created_at)}</td></tr>`).join('')
        : `<tr><td colspan="7" style="padding:16px;color:#94a3b8;">${O.loading ? 'A carregar…' : 'Sem encomendas.'}</td></tr>`}</tbody></table></div>
      ${O.next ? '<div style="padding:10px;text-align:center;"><button class="btn btn-secondary" id="lv-more">Carregar mais</button></div>' : ''}</div>`;
    let t; body.querySelector('#lv-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { O.q = e.target.value.trim(); loadOrders(true); }, 350); };
    body.querySelector('#lv-st').onchange = (e) => { O.status = e.target.value; loadOrders(true); };
    const more = body.querySelector('#lv-more'); if (more) more.onclick = () => loadOrders(false);
    const seen = body.querySelector('#nt-seen'); if (seen) seen.onclick = async () => { try { notif = await rpc('fn_order_notifications', { p_mark_seen: true }); drawOrders(); } catch (e) { showToast(friendly(e), 'error'); } };
    body.querySelectorAll('tbody tr[data-id]').forEach((tr) => { tr.onclick = () => openOrder(tr.dataset.id); });
  }

  async function openOrder(id) {
    let o; try { o = await rpc('fn_store_order_get', { p_order_id: id }); } catch (e) { return showToast(friendly(e), 'error'); }
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    const lines = o.items.map((i) => `<tr><td>${esc(i.name)}<div style="font-size:10px;color:#94a3b8;">${esc(i.code || '')}</div>
        ${info.slug && i.product_id ? `<button class="btn btn-secondary" data-copy-url="${esc(productUrl(info.slug, i.product_id))}" style="padding:1px 6px;font-size:9px;margin-top:2px;">Copiar link do produto</button>` : ''}</td>
      <td>${i.color_name ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(i.color_hex || '#ccc')};border:1px solid #fff4;vertical-align:-2px;"></span> <b>${esc(i.color_name)}</b>` : '—'}</td>
      <td class="mono">${esc(i.quantity)} ${esc(i.unit || '')}</td><td class="mono">${money(i.unit_price)}${i.promo_applied ? ` <small style="color:#fbbf24;">(${esc(i.promotion_name || 'promo')}; original ${money(i.base_price)}, desconto ${money(i.unit_discount ?? (i.base_price - i.unit_price))})</small>` : ''}</td><td class="mono">${money(i.line_total)}</td></tr>`).join('');
    m.innerHTML = `<div class="card" style="width:100%;max-width:820px;padding:18px;margin:auto;">
      <div style="display:flex;justify-content:space-between;gap:8px;"><h3 style="margin:0;color:#f8fafc;font-size:16px;">Encomenda ${esc(o.code)}</h3><button class="btn btn-secondary" data-x style="padding:2px 10px;">✕</button></div>
      <div style="font-size:12px;color:#cbd5e1;margin:8px 0;"><b>${esc(o.customer_name)}</b> · ${esc(o.phone)}${o.email ? ' · ' + esc(o.email) : ''}<br>${o.address ? 'Entrega: ' + esc(o.address) + '<br>' : ''}${o.notes ? 'Notas: ' + esc(o.notes) : ''}</div>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Produto</th><th>Cor</th><th>Qtd.</th><th>Preço</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table></div>
      <div style="text-align:right;font-weight:800;color:#f8fafc;margin:8px 0;">Total: ${money(o.total)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Esta encomenda não é uma venda nem um pagamento confirmado. O pagamento só passa a «Pago» quando um utilizador autorizado o confirmar.</div>
      <div id="ov-proofs" style="font-size:12px;color:#94a3b8;margin-bottom:8px;"></div>
      <div id="ov-log" style="font-size:12px;color:#cbd5e1;margin-bottom:8px;">${o.fulfillment === 'LOGISTICA' || o.fulfillment === 'PRONTA' ? `<b>Logística:</b> enviada por <b>${esc(o.sent_logistics_by_name || '—')}</b> em ${fdt(o.sent_logistics_at)}${o.fulfillment === 'PRONTA' ? `<br><b style="color:#34d399;">Pronta para entrega</b> em ${fdt(o.ready_at)} por <b>${esc(o.ready_by_name || '—')}</b>` : ' — a aguardar preparação.'}` : ''}</div>
      ${canEdit ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
        <label style="font-size:11px;color:#cbd5e1;">Estado<select id="ov-st" style="${input}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></label>
        <label style="font-size:11px;color:#cbd5e1;">Pagamento<select id="ov-pay" style="${input}">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${o.payment_status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">${canEdit ? '<button class="btn btn-primary" id="ov-save">Guardar</button>' : ''}${canPay && o.payment_status !== 'PAGO' ? '<button class="btn btn-primary" id="ov-pay-ok" style="background:#16a34a;border-color:#16a34a;">✅ Validar pagamento</button><button class="btn btn-secondary" id="ov-pay-bad" style="border-color:#ef4444;color:#fca5a5;">⛔ Recusar pagamento</button>' : ''}${canSendLog && (!o.fulfillment || o.fulfillment === 'NONE') && !['CANCELADA', 'ENTREGUE'].includes(o.status) ? '<button class="btn btn-primary" id="ov-log-send" style="background:#0ea5e9;border-color:#0ea5e9;">🚚 Enviar para logística</button>' : ''}<button class="btn btn-secondary" id="ov-print">Imprimir</button></div></div>`;
    document.body.appendChild(m); bindShareButtons(m);
    m.querySelector('[data-x]').onclick = () => m.remove();
    m.querySelector('#ov-print').onclick = () => printOrder(o);
    (async () => {                                                  // comprovativos enviados pelo cliente (bucket privado, URL assinado de 10 min)
      const box = m.querySelector('#ov-proofs');
      try {
        const ps = await rpc('fn_store_order_proofs', { p_order_id: o.id }); if (!ps.length) return;
        const links = await Promise.all(ps.map(async (p, i) => { const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(p.path, 600); return data ? `<a href="${esc(data.signedUrl)}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:2px 8px;font-size:11px;">Comprovativo ${ps.length - i} (${esc(new Date(p.created_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }))})</a>` : ''; }));
        box.innerHTML = `<b style="color:#e2e8f0;">Comprovativos do cliente:</b> ${links.join(' ')}`;
      } catch (e) { /* sem comprovativos / migração por executar */ }
    })();
    const sendLog = m.querySelector('#ov-log-send');
    if (sendLog) sendLog.onclick = async () => {
      if (!confirm(`Enviar a encomenda ${o.code} para a logística? Os logistas serão avisados para a preparar.`)) return;
      sendLog.disabled = true;
      try { await rpc('fn_order_send_logistics', { p_order_id: o.id }); showToast('Encomenda enviada para a logística.', 'success'); m.remove(); loadOrders(true); }
      catch (e) { showToast(friendly(e), 'error'); sendLog.disabled = false; }
    };
    const quick = (sel, status, okMsg) => { const b = m.querySelector(sel); if (!b) return; b.onclick = async () => { b.disabled = true; try { await applyPayment(o, status); showToast(okMsg, 'success'); m.remove(); loadOrders(true); } catch (e) { showToast(e.message, 'error'); b.disabled = false; } }; };
    quick('#ov-pay-ok', 'PAGO', 'Pagamento validado. O cliente foi avisado.'); quick('#ov-pay-bad', 'REJEITADO', 'Pagamento recusado. O cliente foi avisado.');
    const save = m.querySelector('#ov-save');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        await rpc('fn_store_order_set_status', { p_order_id: o.id, p_status: m.querySelector('#ov-st').value, p_payment_status: null });
        const np = m.querySelector('#ov-pay').value; if (np !== o.payment_status) await applyPayment(o, np);
        showToast('Encomenda actualizada.', 'success'); m.remove(); loadOrders(true);
      }
      catch (e) { showToast(e.message, 'error'); save.disabled = false; }
    };
  }

  /** Envia os avisos ao cliente (PWA / WhatsApp / Email) reutilizando send-campaign e send-email-campaign. */
  async function dispatchCampaigns(items) {
    for (const c of items || []) {
      try {
        const fn = c.channel === 'EMAIL' ? 'send-email-campaign' : 'send-campaign';
        for (let i = 0; i < 5; i++) { const { data, error } = await supabase.functions.invoke(fn, { body: { campaign_id: c.id } }); if (error || (data && data.error) || !data || !data.remaining) break; }
      } catch (e) { /* o cliente vê sempre o estado na lista de compras */ }
    }
  }

  /** Valida / recusa / repõe o pagamento. Ao validar ou recusar, o cliente é avisado e a lista de compras dele muda de estado. */
  async function applyPayment(o, status) {
    let note = null;
    if (status === 'REJEITADO') { note = prompt('Motivo da recusa (o cliente vai ver esta mensagem). Pode deixar em branco:', ''); if (note === null) throw new Error('Operação cancelada.'); }
    const r = await rpc('fn_store_order_set_payment', { p_order_id: o.id, p_payment_status: status, p_note: note });
    if (r.changed && r.message && !r.has_account && r.phone) {   // cliente sem conta: aviso manual por WhatsApp
      const n = String(r.phone).replace(/[^0-9]/g, '');
      if (n.length >= 9 && confirm('Este cliente comprou sem conta. Abrir o WhatsApp para o avisar agora?')) window.open(`https://wa.me/${n}?text=${encodeURIComponent(r.message)}`, '_blank', 'noopener');
    }
    return r;
  }

  async function printOrder(o) {
    let payment = null; try { payment = await rpc('fn_vstore_get_payment', {}); } catch (e) { /* sem instruções */ }
    const logo = info && info.config && info.config.logo_path ? publicImageUrl(info.config.logo_path) : '';
    if (!printReceipt({ ...o, payment_status: o.payment_status }, { storeName: user?.storeName || '', currency: o.currency || 'MT', logoUrl: logo, payment })) showToast('Não foi possível imprimir.', 'error');
  }

  /* ---------- instruções de pagamento e contas (editáveis pelo Administrador; aparecem na confirmação da compra e no PDF) ---------- */
  async function drawPaySettings(card) {
    let cur = { text: '', accounts: [] };
    try { cur = await rpc('fn_vstore_get_payment', {}); } catch (e) { card.innerHTML = `<div style="font-size:12px;color:#fca5a5;">Instruções de pagamento indisponíveis: ${esc(/could not find the function|schema cache/i.test(e.message) ? 'falta executar migracao_pagamentos_v21.sql no Supabase.' : e.message)}</div>`; return; }
    let text = cur.text || ''; const accs = (cur.accounts || []).map((a) => ({ method: a.method || '', holder: a.holder || '', number: a.number || '', extra: a.extra || '' }));
    const lbl = 'font-size:11px;font-weight:700;color:#cbd5e1;';
    const row = (a, i) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) auto;gap:6px;align-items:end;margin-top:8px;padding:8px;border:1px solid #1f2937;border-radius:8px;">
        <label style="${lbl}">Forma / banco<input data-pf="method" data-i="${i}" maxlength="60" value="${esc(a.method)}" placeholder="Ex.: Transferência bancária (IBAN)" style="${input}"></label>
        <label style="${lbl}">Titular<input data-pf="holder" data-i="${i}" maxlength="120" value="${esc(a.holder)}" placeholder="Nome da empresa" style="${input}"></label>
        <label style="${lbl}">Nº da conta / IBAN / referência<input data-pf="number" data-i="${i}" maxlength="80" value="${esc(a.number)}" style="${input}"></label>
        <label style="${lbl}">Nota (opcional)<input data-pf="extra" data-i="${i}" maxlength="160" value="${esc(a.extra)}" placeholder="Ex.: BAI, balcão…" style="${input}"></label>
        <button type="button" class="btn btn-secondary" data-pr="${i}" aria-label="Remover" style="padding:6px 10px;">✕</button></div>`;
    const paint = () => {
      card.innerHTML = `<div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;margin-bottom:6px;">Instruções de pagamento e contas</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Mostradas ao cliente logo após concluir a compra (abaixo de «Descarregar PDF / Imprimir / Enviar comprovativo»), na Área do Cliente e no PDF da encomenda.</div>
        <label style="${lbl}">Instruções gerais<textarea id="pay-text" rows="4" maxlength="1200" placeholder="Ex.: Pague por transferência ou Multicaixa Express e envie o comprovativo. O prazo para pagamento é de 24 h." style="${input}">${esc(text)}</textarea></label>
        <div id="pay-rows">${accs.map(row).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button type="button" class="btn btn-secondary" id="pay-add" ${accs.length >= 10 ? 'disabled' : ''}>+ Adicionar conta / forma de pagamento</button><button type="button" class="btn btn-primary" id="pay-save">Guardar instruções de pagamento</button></div>`;
      card.querySelector('#pay-text').oninput = (e) => { text = e.target.value; };
      card.querySelectorAll('[data-pf]').forEach((el) => { el.oninput = () => { accs[Number(el.dataset.i)][el.dataset.pf] = el.value; }; });
      card.querySelectorAll('[data-pr]').forEach((b) => { b.onclick = () => { accs.splice(Number(b.dataset.pr), 1); paint(); }; });
      card.querySelector('#pay-add').onclick = () => { accs.push({ method: '', holder: '', number: '', extra: '' }); paint(); };
      card.querySelector('#pay-save').onclick = async (ev) => {
        ev.target.disabled = true;
        try { await rpc('fn_vstore_save_payment', { p_text: text, p_accounts: accs }); showToast('Instruções de pagamento guardadas.', 'success'); }
        catch (e) { showToast(e.message, 'error'); }
        ev.target.disabled = false;
      };
    };
    paint();
  }

  /* ---------- personalização ---------- */
  function drawConfig() {
    const body = container.querySelector('#lv-body'); const c = info.config || {};
    let order = (c.sections && c.sections.length ? c.sections.slice() : []);
    Object.keys(SECTION_NAMES).forEach((k) => { if (!order.includes(k)) order.push(k); });
    const on = new Set(c.sections && c.sections.length ? c.sections : Object.keys(SECTION_NAMES));
    const secHtml = () => order.map((k, i) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;"><label style="flex:1;font-size:12px;color:#f8fafc;"><input type="checkbox" data-sec="${k}" ${on.has(k) ? 'checked' : ''}> ${SECTION_NAMES[k]}</label>
        <button class="btn btn-secondary" data-mv="${i}" data-d="-1" style="padding:1px 8px;" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-secondary" data-mv="${i}" data-d="1" style="padding:1px 8px;" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('');
    body.innerHTML = `<div class="card" style="padding:16px;max-width:760px;" ${canEdit ? '' : 'inert'}>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Tema<select id="cf-theme" style="${input}">${info.themes.map((t) => `<option value="${esc(t.id)}" ${t.id === info.theme ? 'selected' : ''}>${esc(t.name)}${t.premium ? ' ★ Premium' : ''}</option>`).join('')}</select>${info.theme_grant && info.theme !== info.theme_grant ? '<span style="display:block;font-weight:400;color:#fbbf24;margin-top:4px;">O Super Administrador atribuiu-lhe um tema premium. Seleccione-o e clique em «Guardar personalização» para o aplicar na loja online.</span>' : ''}</label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Cor principal<input id="cf-primary" type="color" value="${esc(c.primary || '#1d4ed8')}" style="${input}height:36px;"></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Cor de destaque<input id="cf-accent" type="color" value="${esc(c.accent || '#ea580c')}" style="${input}height:36px;"></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">WhatsApp (com indicativo)<input id="cf-wa" value="${esc(c.whatsapp || '')}" style="${input}"></label></div>
      <label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;margin-top:10px;">Frase de apresentação<input id="cf-tag" maxlength="160" value="${esc(c.tagline || '')}" style="${input}"></label>
      <label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;margin-top:10px;">Sobre a loja<textarea id="cf-about" rows="3" maxlength="600" style="${input}">${esc(c.about || '')}</textarea></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
        ${['logo', 'hero', 'bg'].map((k) => `<div><div style="font-size:11px;font-weight:700;color:#cbd5e1;">${k === 'logo' ? 'Logótipo' : k === 'hero' ? 'Imagem de destaque' : 'Imagem de fundo da loja'}</div>
          <div id="cf-${k}-prev" style="margin:4px 0;min-height:48px;">${c[k + '_path'] ? `<img src="${esc(publicImageUrl(c[k + '_path']))}" alt="" style="max-height:80px;max-width:100%;object-fit:contain;border-radius:6px;">` : '<span style="font-size:11px;color:#64748b;">Sem imagem</span>'}</div>
          <input type="file" id="cf-${k}-file" accept="image/jpeg,image/png,image/webp"><div id="cf-${k}-st" style="font-size:10px;color:#94a3b8;"></div><button type="button" class="btn btn-secondary" id="cf-${k}-rm" style="padding:2px 8px;font-size:10px;margin-top:4px;">Remover imagem</button></div>`).join('')}</div>
      <div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;margin:14px 0 6px;">Secções (ordem e visibilidade)</div><div id="cf-secs">${secHtml()}</div>
      <div style="font-size:10px;color:#94a3b8;margin:6px 0;">Os produtos em destaque e as promoções escolhem-se em cada produto (ecrã «Loja virtual» do produto).</div>
      ${canEdit ? '<button class="btn btn-primary" id="cf-save" style="margin-top:8px;">Guardar personalização</button>' : ''}</div>
      <div class="card" id="cf-pay-card" style="padding:16px;max-width:760px;margin-top:14px;" ${canEdit ? '' : 'inert'}>A carregar…</div>`;
    drawPaySettings(body.querySelector('#cf-pay-card'));
    const paths = { logo_path: c.logo_path || null, hero_path: c.hero_path || null, bg_path: c.bg_path || null };
    const repaint = () => { body.querySelector('#cf-secs').innerHTML = secHtml(); wireSecs(); };
    const wireSecs = () => {
      body.querySelectorAll('[data-sec]').forEach((cb) => { cb.onchange = () => { cb.checked ? on.add(cb.dataset.sec) : on.delete(cb.dataset.sec); }; });
      body.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.mv), d = Number(b.dataset.d); [order[i], order[i + d]] = [order[i + d], order[i]]; repaint(); }; });
    }; wireSecs();
    ['logo', 'hero', 'bg'].forEach((k) => {
      const f = body.querySelector(`#cf-${k}-file`), st = body.querySelector(`#cf-${k}-st`);
      f.onchange = async () => {
        const file = f.files[0]; if (!file) return; st.textContent = 'A processar…';
        try {
          await validateImageFile(file);
          const src = await createImageBitmap(file); const blob = await resizeImage(src, k === 'logo' ? 512 : k === 'bg' ? 1920 : 1600, k === 'bg' ? 0.78 : 0.82);
          const path = `${info.store_id}/brand/${k}-${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
          const up = await db.requireClient().storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
          if (up.error) throw new Error(up.error.message);
          paths[k + '_path'] = path; body.querySelector(`#cf-${k}-prev`).innerHTML = `<img src="${esc(publicImageUrl(path))}" alt="" style="max-height:80px;max-width:100%;object-fit:contain;border-radius:6px;">`; st.textContent = 'Carregada — clique em Guardar.';
        } catch (e) { st.textContent = e.message; st.style.color = '#fca5a5'; }
      };
    });
    ['logo', 'hero', 'bg'].forEach((k) => {
      body.querySelector(`#cf-${k}-rm`).onclick = () => { paths[k + '_path'] = null; body.querySelector(`#cf-${k}-prev`).innerHTML = '<span style="font-size:11px;color:#64748b;">Sem imagem</span>'; body.querySelector(`#cf-${k}-st`).textContent = 'Removida — clique em Guardar.'; };
    });
    const save = body.querySelector('#cf-save');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        await rpc('fn_vstore_save_config', { p_theme: body.querySelector('#cf-theme').value, p_config: { primary: body.querySelector('#cf-primary').value, accent: body.querySelector('#cf-accent').value, whatsapp: body.querySelector('#cf-wa').value,
          tagline: body.querySelector('#cf-tag').value, about: body.querySelector('#cf-about').value, logo_path: paths.logo_path, hero_path: paths.hero_path, bg_path: paths.bg_path, sections: order.filter((k) => on.has(k)), categories_hidden: c.categories_hidden || [] } });
        showToast('Personalização guardada.', 'success'); await render();
      } catch (e) { showToast(e.message, 'error'); save.disabled = false; }
    };
  }

  await render();
}
