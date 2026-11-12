/**
 * GEF | CLIENTES CADASTRADOS (separador da Loja virtual). Só mostra clientes da loja do administrador:
 * o isolamento é feito no Supabase (fn_admin_customers usa a loja do utilizador autenticado, nunca um parâmetro).
 * Contas de cliente + compradores convidados (sem conta) agrupados por telefone. Não toca no cadastro de clientes do ERP.
 */
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';

const PAGE = 50;
const ST = { PENDENTE: 'Pendente', CONFIRMADA: 'Confirmada', EM_PREPARACAO: 'Em preparação', ENTREGUE: 'Entregue', CANCELADA: 'Cancelada' };
const PAY = { NAO_PAGO: 'Pendente', COMPROVATIVO_ENVIADO: 'Pendente (comprovativo enviado)', PAGO: 'Validado', REJEITADO: 'Recusado' };
const FILTERS = [['all', 'Todos'], ['accounts', 'Com conta'], ['guests', 'Só convidados'], ['installed', 'Instalaram a app'], ['push', 'Aceitam notificações'], ['whatsapp', 'Aceitam WhatsApp'], ['consent', 'Aceitam comunicações'], ['buyers', 'Já compraram'], ['never', 'Conta sem compras']];
const money = (n) => Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const tag = (on, t, c) => (on ? `<span class="badge ${c}" style="margin:1px;">${t}</span>` : '');

export async function drawClientes(body, { rpc, friendly }) {
  const st = { q: '', filter: 'all', offset: 0, total: 0, rows: [] }; let timer = null;
  body.innerHTML = `<div class="card" style="padding:16px;"><h3 style="margin:0 0 8px;font-size:15px;color:#f8fafc;">Clientes cadastrados</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><input id="cl-q" placeholder="Pesquisar nome, telefone, WhatsApp ou email…" style="flex:1 1 220px;"><select id="cl-f">${FILTERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div id="cl-list"></div></div>`;
  const list = body.querySelector('#cl-list');

  async function load() {
    list.innerHTML = '<div style="padding:14px;color:#94a3b8;">A carregar…</div>';
    try { const r = await rpc('fn_admin_customers', { p_q: st.q || null, p_filter: st.filter, p_limit: PAGE, p_offset: st.offset }); st.total = r.total; st.rows = r.rows; }
    catch (e) { list.innerHTML = `<div style="padding:14px;color:#fde68a;">${esc(/could not find|schema cache/i.test(e.message) ? 'Falta executar migracao_clientes_campanhas_v18.sql no Supabase.' : friendly(e))}</div>`; return; }
    const rows = st.rows.map((c, i) => `<tr data-i="${i}" style="cursor:pointer;"><td><b>${esc(c.name || '—')}</b><div>${tag(c.has_account, 'Conta', 'badge-emerald')}${tag(!c.has_account, 'Convidado', 'badge-amber')}${tag(c.installed, 'App instalada', 'badge-blue')}${tag(c.push_consent, c.push_active ? 'Notificações' : 'Notif. (sem dispositivo)', 'badge-blue')}${tag(c.wa_consent, 'WhatsApp', 'badge-emerald')}</div></td>
      <td class="mono">${esc(c.phone || '—')}</td><td class="mono">${esc(c.whatsapp ? '+' + c.whatsapp : '—')}</td><td>${esc(c.email || '—')}</td><td>${esc(fmt(c.created_at))}</td><td class="mono">${esc(c.orders)}</td><td class="mono">${money(c.spent)}</td></tr>`).join('');
    const pages = Math.max(1, Math.ceil(st.total / PAGE)), cur = Math.floor(st.offset / PAGE) + 1;
    list.innerHTML = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Cliente</th><th>Telefone</th><th>WhatsApp</th><th>Email</th><th>Registo</th><th>Compras</th><th>Total comprado</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="padding:16px;color:#94a3b8;">Nenhum cliente encontrado.</td></tr>'}</tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px;color:#94a3b8;"><span>${st.total} cliente(s) · compras = encomendas não canceladas</span>
        <span><button class="btn btn-secondary" id="cl-prev" ${cur <= 1 ? 'disabled' : ''}>←</button> ${cur}/${pages} <button class="btn btn-secondary" id="cl-next" ${cur >= pages ? 'disabled' : ''}>→</button></span></div>`;
    list.querySelectorAll('tr[data-i]').forEach((tr) => { tr.onclick = () => detail(st.rows[Number(tr.dataset.i)]); });
    list.querySelector('#cl-prev').onclick = () => { st.offset = Math.max(0, st.offset - PAGE); load(); };
    list.querySelector('#cl-next').onclick = () => { st.offset += PAGE; load(); };
  }

  async function detail(c) {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    const wa = c.whatsapp || String(c.phone || '').replace(/\D/g, '');
    m.innerHTML = `<div class="card" style="padding:16px;max-width:720px;width:100%;margin:auto;"><div style="display:flex;justify-content:space-between;"><h3 style="margin:0;color:#f8fafc;">${esc(c.name || 'Cliente')}</h3><button class="btn btn-secondary" data-x>✕</button></div>
      <div style="font-size:12px;color:#cbd5e1;margin:8px 0;line-height:1.8;">Telefone: ${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'} · WhatsApp: ${wa ? `<a target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}">+${esc(wa)}</a>` : '—'} · Email: ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}<br>
        Registo: ${esc(fmt(c.created_at))} · ${esc(c.orders)} compra(s) · ${money(c.spent)} no total<br>${tag(c.has_account, 'Conta criada', 'badge-emerald')}${tag(!c.has_account, 'Sem conta (convidado)', 'badge-amber')}${tag(c.installed, 'Instalou a app', 'badge-blue')}${tag(c.push_consent, 'Autorizou notificações', 'badge-blue')}${tag(c.wa_consent, 'Autorizou WhatsApp', 'badge-emerald')}${!c.push_consent && !c.wa_consent ? '<span class="badge badge-red">Sem autorização de marketing</span>' : ''}</div>
      <h4 style="margin:10px 0 4px;color:#f8fafc;font-size:13px;">Histórico de compras</h4><div id="cl-h" style="overflow-x:auto;color:#94a3b8;font-size:12px;">A carregar…</div></div>`;
    document.body.appendChild(m); m.querySelector('[data-x]').onclick = () => m.remove();
    try {
      const h = await rpc('fn_admin_customer_orders', { p_customer: c.id, p_phone: c.id ? null : c.phone });
      m.querySelector('#cl-h').innerHTML = h.length ? `<table class="data-table"><thead><tr><th>Código</th><th>Data</th><th>Estado</th><th>Pagamento</th><th>Desconto</th><th>Total</th></tr></thead><tbody>${h.map((o) => `<tr><td class="mono">${esc(o.code)}</td><td>${esc(fmt(o.created_at))}</td><td>${esc(ST[o.status] || o.status)}</td><td>${esc(PAY[o.payment_status] || o.payment_status)}</td><td class="mono">${money(o.discount_total)}</td><td class="mono">${money(o.total)}</td></tr>`).join('')}</tbody></table>` : 'Sem compras.';
    } catch (e) { showToast(friendly(e), 'error'); }
  }

  body.querySelector('#cl-q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); st.offset = 0; load(); }, 300); };
  body.querySelector('#cl-f').onchange = (e) => { st.filter = e.target.value; st.offset = 0; load(); };
  await load();
}
