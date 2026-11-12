/**
 * GEF | LOGÍSTICA DE ENCOMENDAS (Logista; também Admin/Gerente da loja)
 * Fila das encomendas enviadas pela equipa de Marketing & Vendas: o logista organiza os produtos pedidos e clica em
 * «Pronta para entrega». Esse clique (1) regista quem o fez, (2) avisa os cargos superiores (notificação interna) e
 * (3) avisa o cliente — no site (Área do cliente) e, se autorizou, por notificação PWA / WhatsApp / email.
 * Cada utilizador fica identificado (nome + função) em cada passo. Vários logistas podem trabalhar em simultâneo:
 * a base de dados impede marcar duas vezes a mesma encomenda.
 */
import { db } from '../../js/core/database.js';
import { auth } from '../../js/core/auth.js';
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { supabase } from '../../js/core/supabase.js';

const fdt = (d) => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); };
const PAY = { NAO_PAGO: 'Pendente', COMPROVATIVO_ENVIADO: 'Pendente (comprovativo enviado)', PAGO: 'Validado', REJEITADO: 'Recusado' };

export async function initLogisticaModule(container) {
  const user = auth.getCurrentUser ? auth.getCurrentUser() : null;
  const role = String(user?.role || '').toUpperCase();
  const canReady = ['LOGISTA', 'ADMIN', 'GERENTE'].includes(role);
  let filter = 'todo', list = [], notif = { unread: 0, items: [] }, timer = null;
  // v24 - CONFERÊNCIA DE PRODUTOS: antes de «Pronta para entrega» o logista confere cada linha (produto/cor/quantidade).
  // Os visto ficam guardados neste dispositivo (sessão) até a encomenda ser concluída; sobrevivem às actualizações automáticas da lista.
  const CONF_KEY = 'gef_lg_conf_v24';
  let conf = {}; try { conf = JSON.parse(sessionStorage.getItem(CONF_KEY) || '{}') || {}; } catch (e) { conf = {}; }
  const saveConf = () => { try { sessionStorage.setItem(CONF_KEY, JSON.stringify(conf)); } catch (e) { /* sem sessionStorage: fica em memória */ } };
  const isChecked = (oid, idx) => !!(conf[oid] && conf[oid][idx]);
  const allChecked = (o) => (o.items || []).length > 0 && (o.items || []).every((_, idx) => isChecked(o.id, idx));
  const rpc = (n, a) => db.rpcV7(n, a);
  const friendly = (e) => (/could not find the function|schema cache/i.test(e.message) ? 'Falta executar migracao_conta_roles_v19.sql no Supabase.' : e.message);

  async function load() {
    try { [list, notif] = await Promise.all([rpc('fn_logistics_queue', { p_filter: filter }), rpc('fn_order_notifications', { p_mark_seen: false }).catch(() => ({ unread: 0, items: [] }))]); }
    catch (e) { container.innerHTML = `<div class="card" style="padding:24px;max-width:560px;margin:30px auto;color:#fde68a;">${esc(friendly(e))}</div>`; return; }
    draw();
  }

  function draw() {
    const note = notif.unread ? `<div class="card" style="padding:10px 14px;border:1px solid #f59e0b;background:rgba(245,158,11,.08);display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:13px;color:#fde68a;">🔔 ${notif.unread} nova(s) encomenda(s) enviada(s) para a logística${notif.items[0] ? ` — a última: <b>${esc(notif.items[0].code)}</b> (por ${esc(notif.items[0].by || '—')})` : ''}.</span>
        <button class="btn btn-secondary" id="lg-seen" style="padding:2px 10px;font-size:11px;">Marcar como vistas</button></div>` : '';
    const cards = list.map((o) => `<div class="card" style="padding:14px;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div><b style="font-size:15px;color:#f8fafc;">${esc(o.code)}</b> <span class="badge ${o.fulfillment === 'PRONTA' ? 'badge-emerald' : 'badge-amber'}">${o.fulfillment === 'PRONTA' ? 'Pronta para entrega' : 'A preparar'}</span>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Enviada por <b>${esc(o.sent_logistics_by_name || '—')}</b> em ${esc(fdt(o.sent_logistics_at))} · Pagamento: ${esc(PAY[o.payment_status] || o.payment_status)}${o.ready_at ? `<br>Pronta em ${esc(fdt(o.ready_at))} por <b>${esc(o.ready_by_name || '—')}</b>` : ''}</div></div>
          <div style="text-align:right;font-size:12px;color:#cbd5e1;"><b>${esc(o.customer_name)}</b><br>${esc(o.phone || '')}</div></div>
        ${o.address ? `<div style="font-size:12px;color:#cbd5e1;margin-top:6px;">Entrega: ${esc(o.address)}</div>` : ''}${o.notes ? `<div style="font-size:12px;color:#94a3b8;">Notas: ${esc(o.notes)}</div>` : ''}
        <div style="overflow-x:auto;margin-top:8px;"><table class="data-table"><thead><tr>${o.fulfillment === 'LOGISTICA' && canReady ? '<th style="width:70px;">Conferido</th>' : ''}<th>Produto</th><th>Cor</th><th>Qtd.</th></tr></thead><tbody>${(o.items || []).map((i, idx) => `<tr>${o.fulfillment === 'LOGISTICA' && canReady ? `<td style="text-align:center;"><input type="checkbox" data-conf="${esc(o.id)}" data-idx="${idx}" ${isChecked(o.id, idx) ? 'checked' : ''} style="width:20px;height:20px;" aria-label="Conferido"></td>` : ''}<td>${esc(i.name)}<div style="font-size:10px;color:#94a3b8;">${esc(i.code || '')}</div></td>
          <td>${i.color_name ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(i.color_hex || '#ccc')};border:1px solid #fff4;vertical-align:-2px;"></span> ${esc(i.color_name)}` : '—'}</td><td class="mono"><b>${esc(i.quantity)}</b> ${esc(i.unit || '')}</td></tr>`).join('')}</tbody></table></div>
        ${o.fulfillment === 'LOGISTICA' && canReady ? `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><button class="btn btn-secondary" data-conf-all="${esc(o.id)}" style="padding:4px 10px;font-size:11px;">Conferir tudo</button><button class="btn btn-primary" data-ready="${esc(o.id)}" ${allChecked(o) ? '' : 'disabled'}>✔ Pronta para entrega</button><span data-conf-msg="${esc(o.id)}" style="font-size:11px;color:#fbbf24;">${allChecked(o) ? '' : 'Confira todos os produtos para concluir.'}</span></div>` : ''}</div>`).join('');
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;max-width:980px;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;"><h2 style="margin:0;font-size:18px;color:#f8fafc;">Logística de encomendas</h2>
        <span><button class="btn ${filter === 'todo' ? 'btn-primary' : 'btn-secondary'}" data-f="todo">A preparar</button> <button class="btn ${filter === 'prontas' ? 'btn-primary' : 'btn-secondary'}" data-f="prontas">Prontas (14 dias)</button> <button class="btn btn-secondary" id="lg-refresh">Actualizar</button></span></div>
      ${note}${cards || `<div class="card" style="padding:24px;color:#94a3b8;text-align:center;">${filter === 'todo' ? 'Sem encomendas por preparar.' : 'Sem encomendas prontas recentes.'}</div>`}</div>`;
    container.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filter = b.dataset.f; load(); }; });
    const r = container.querySelector('#lg-refresh'); if (r) r.onclick = load;
    const seen = container.querySelector('#lg-seen'); if (seen) seen.onclick = async () => { try { notif = await rpc('fn_order_notifications', { p_mark_seen: true }); draw(); } catch (e) { showToast(friendly(e), 'error'); } };
    container.querySelectorAll('[data-ready]').forEach((b) => { b.onclick = () => ready(b.dataset.ready, b); });
    const refreshReady = (oid) => {
      const o = list.find((x) => x.id === oid); if (!o) return;
      const ok = allChecked(o);
      container.querySelectorAll('[data-ready]').forEach((b) => { if (b.dataset.ready === oid) b.disabled = !ok; });
      container.querySelectorAll('[data-conf-msg]').forEach((s) => { if (s.dataset.confMsg === oid) s.textContent = ok ? '' : 'Confira todos os produtos para concluir.'; });
    };
    container.querySelectorAll('[data-conf]').forEach((c) => { c.onchange = () => {
      const oid = c.dataset.conf; conf[oid] = conf[oid] || {}; if (c.checked) conf[oid][c.dataset.idx] = 1; else delete conf[oid][c.dataset.idx];
      saveConf(); refreshReady(oid); }; });
    container.querySelectorAll('[data-conf-all]').forEach((b) => { b.onclick = () => {
      const oid = b.dataset.confAll; const o = list.find((x) => x.id === oid); if (!o) return;
      conf[oid] = {}; (o.items || []).forEach((_, idx) => { conf[oid][idx] = 1; }); saveConf();
      container.querySelectorAll('[data-conf]').forEach((c) => { if (c.dataset.conf === oid) c.checked = true; }); refreshReady(oid); }; });
  }

  /** Envia os avisos ao cliente reutilizando as funções de envio já existentes (send-campaign / send-email-campaign). */
  async function dispatch(items) {
    for (const c of items || []) {
      try {
        if (c.channel === 'PUSH') { await rpc('fn_campaign_deliver_inapp', { p_id: c.id }); continue; }
        const fn = c.channel === 'EMAIL' ? 'send-email-campaign' : 'send-campaign';
        for (let i = 0; i < 5; i++) { const { data, error } = await supabase.functions.invoke(fn, { body: { campaign_id: c.id } }); if (error || (data && data.error) || !data || !data.remaining) break; }
      } catch (e) { /* o cliente vê sempre o estado na Área do cliente; falha de envio fica registada na campanha */ }
    }
  }

  async function ready(id, btn) {
    const o = list.find((x) => x.id === id); if (!o) return;
    if (!allChecked(o)) return showToast('Confira todos os produtos antes de marcar como pronta.', 'error');
    if (!confirm(`Marcar ${o.code} como PRONTA PARA ENTREGA? Os cargos superiores e o cliente serão avisados.`)) return;
    btn.disabled = true;
    try {
      const r = await rpc('fn_order_mark_ready', { p_order_id: id });
      delete conf[id]; saveConf();
      showToast('Encomenda pronta para entrega. Avisos enviados.', 'success');
      await dispatch(r.campaigns);
      if (!r.has_account && r.phone) {                              // cliente sem conta: aviso manual por WhatsApp (abre a conversa já escrita)
        const n = String(r.phone).replace(/[^0-9]/g, '');
        if (n.length >= 9 && confirm('Este cliente comprou sem conta. Abrir o WhatsApp para o avisar agora?')) window.open(`https://wa.me/${n}?text=${encodeURIComponent(r.message)}`, '_blank', 'noopener');
      }
    } catch (e) { showToast(friendly(e), 'error'); }
    load();
  }

  await load();
  timer = setInterval(() => { if (!container.isConnected) { clearInterval(timer); return; } load(); }, 60000);   // actualiza sozinho (novas encomendas dos vários utilizadores)
}
