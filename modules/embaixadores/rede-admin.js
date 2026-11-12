/**
 * GEF | SUPER ADMIN: CONTROLO GLOBAL DAS REDES (Super Embaixadores, Embaixadores, lojas, finanças)
 * Dados reais via fn_admin_network_report (só SUPERADMIN, verificado no servidor).
 * Taxas/hierarquia via fn_admin_set_ambassador_rates / _hierarchy (auditadas).
 */
import { db } from '../../js/core/database.js';
import { showToast } from '../../js/components/toast.js';
import { paginate, renderPager, bindPager } from '../../js/components/pagination.js';
import { buildNetwork, seriesFor, reconcile, toCsv, storeKey } from '../../js/core/network-calc.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';

const money = (v) => Number(v || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('pt-PT'); };
const LABEL = { regular: 'Regular', a_vencer: 'A vencer', pendente: 'Pendente (1.º pagamento)', em_atraso: 'Em atraso', bloqueada: 'Bloqueada', sem_loja: 'Sem loja' };
const BADGE = { regular: 'badge-emerald', a_vencer: 'badge-amber', pendente: 'badge-blue', em_atraso: 'badge-red', bloqueada: 'badge-red', sem_loja: 'badge-amber' };
const TABS = [['dash', 'Dashboard'], ['super', 'Super Embaixadores'], ['amb', 'Embaixadores'], ['top', 'Mais activos'], ['pay', 'Pagamentos & Lojas'], ['comm', 'Comissões']];

export async function mountNetworkAdmin(container, { onBack } = {}) {
  const S = { tab: 'dash', detail: null, report: null, net: null, q: '', status: '', from: '', to: '', sort: 'net', page: {} };

  const load = async () => {
    container.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:#94a3b8;">A carregar a rede…</div>';
    try {
      const { data, error } = await db.requireClient().rpc('fn_admin_network_report', { p_from: S.from || null, p_to: S.to || null });
      if (error) throw new Error(error.message || 'Erro ao carregar o relatório.');
      S.report = data; S.net = buildNetwork(data);
      draw();
    } catch (err) {
      const missing = /could not find the function|schema cache|does not exist/i.test(err.message || '');
      container.innerHTML = `<div class="card" style="max-width:640px;margin:30px auto;padding:24px;text-align:center;border-color:#f59e0b;">
        <h3 style="color:#fde68a;margin:0 0 8px;">Não foi possível carregar o relatório de redes</h3>
        <p style="font-size:12px;color:#cbd5e1;">${missing ? 'Falta executar <b>migracao_rede_v6.sql</b> no Supabase (SQL Editor).' : esc(err.message)}</p>
        <button class="btn btn-primary" id="rn-retry">Tentar novamente</button> <button class="btn btn-secondary" id="rn-back">Voltar</button></div>`;
      container.querySelector('#rn-retry').onclick = load; container.querySelector('#rn-back').onclick = () => onBack && onBack();
    }
  };

  const nameOf = (id) => S.net.byId.get(id)?.name || '—';
  const networkOf = (a) => (a.is_super ? a.name : (a.parent_ambassador_id ? nameOf(a.parent_ambassador_id) : '— (independente)'));
  const card = (l, v, h, c = '#f8fafc') => `<div class="card"><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">${l}</div><div style="font-size:22px;font-weight:900;color:${c};font-family:var(--font-mono);margin-top:4px;">${v}</div><div style="font-size:10px;color:#64748b;margin-top:2px;">${h || ''}</div></div>`;
  const badge = (k) => `<span class="badge ${BADGE[k]}">${LABEL[k]}</span>`;
  const tbl = (head, rows, empty = 'Sem registos.') => `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" style="text-align:center;color:#64748b;padding:20px;">${empty}</td></tr>`}</tbody></table></div>`;
  const link = (id, text) => `<a href="#" data-open="${esc(id)}" style="color:#93c5fd;font-weight:800;text-decoration:none;">${esc(text)}</a>`;
  const matchQ = (...f) => !S.q || f.some((x) => String(x ?? '').toLowerCase().includes(S.q.toLowerCase()));
  const paged = (key, list, size = 15) => { const p = paginate(list, S.page[key] || 1, size); S.page[key] = p.page; return p; };

  const download = (name, rows, cols) => {
    const blob = new Blob([toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const exportBtn = (id) => `<button class="btn btn-secondary" id="${id}" style="padding:4px 10px;font-size:11px;">Exportar CSV</button>`;

  const chart = (series) => {
    if (!series.length) return '<div style="color:#64748b;font-size:12px;padding:12px;">Sem pagamentos no período.</div>';
    const last = series.slice(-12), max = Math.max(1, ...last.map((s) => Math.max(s.received, s.commDirect + s.commIndirect)));
    const bw = 28, gap = 22, h = 120;
    const bars = last.map((s, i) => { const x = 10 + i * (bw * 2 + gap), h1 = (s.received / max) * h, h2 = ((s.commDirect + s.commIndirect) / max) * h;
      return `<rect x="${x}" y="${h - h1 + 6}" width="${bw}" height="${h1}" fill="#10b981"><title>${s.month} recebido: ${money(s.received)} MT</title></rect>
              <rect x="${x + bw}" y="${h - h2 + 6}" width="${bw}" height="${h2}" fill="#f59e0b"><title>${s.month} comissões: ${money(s.commDirect + s.commIndirect)} MT</title></rect>
              <text x="${x + bw}" y="${h + 20}" font-size="9" fill="#94a3b8" text-anchor="middle">${s.month.slice(2)}</text>`; }).join('');
    return `<div style="overflow-x:auto;"><svg width="${last.length * (bw * 2 + gap) + 20}" height="${h + 30}" role="img" aria-label="Receitas e comissões por mês">${bars}</svg></div>
      <div style="font-size:10px;color:#94a3b8;"><span style="color:#10b981;">■</span> Mensalidades recebidas &nbsp; <span style="color:#f59e0b;">■</span> Comissões geradas</div>`;
  };

  // ---------------- secções ----------------
  const viewDash = () => {
    const t = S.net.totals, rc = reconcile(S.report);
    const comparison = S.net.nodes.filter((x) => x.is_super || (!x.parent_ambassador_id)).map((x) => ({ x, v: x.net.received })).sort((a, b) => b.v - a.v).slice(0, 8);
    const mx = Math.max(1, ...comparison.map((c) => c.v));
    return `<div class="metrics-grid">
      ${card('Super Embaixadores', t.supers, '')}${card('Embaixadores normais', t.normals, '')}${card('Lojas registadas', t.stores, 'vinculadas a embaixadores')}
      ${card('Activas', t.regular + t.a_vencer, 'regulares + a vencer', '#34d399')}${card('Próximas do vencimento', t.a_vencer, '≤ 7 dias', '#fbbf24')}
      ${card('Pendentes', t.pendente, '1.º pagamento por lançar', '#60a5fa')}${card('Em atraso', t.em_atraso, '', '#f87171')}${card('Bloqueadas', t.bloqueada, '', '#f87171')}</div>
      <div class="metrics-grid">
      ${card('Mensalidades previstas / mês', money(t.expected) + ' MT', 'lojas não bloqueadas')}
      ${card('Mensalidades recebidas', money(t.received) + ' MT', 'pagamentos lançados no período', '#34d399')}
      ${card('Valor em atraso (estimado)', money(t.overdue) + ' MT', 'mensalidade × meses de atraso', '#f87171')}
      ${card('Comissões geradas', money(t.commGenerated) + ' MT', `directas ${money(t.commDirect)} · indirectas ${money(t.commIndirect)}`)}
      ${card('Comissões pendentes', money(t.pending) + ' MT', 'saldo por liquidar', '#fbbf24')}${card('Comissões pagas', money(t.paid) + ' MT', 'liquidações registadas', '#60a5fa')}</div>
      <div class="card"><h3 style="font-size:14px;margin:0 0 8px;color:#f8fafc;">Evolução das receitas (por mês)</h3>${chart(S.net.months)}
        <div style="font-size:10px;margin-top:6px;color:${rc.ok ? '#34d399' : '#f87171'};">${rc.ok ? '✓ Reconciliado: soma por loja = soma mensal' : '⚠ Diferença entre soma por loja e soma mensal: verificar'} (${money(rc.fromStores)} / ${money(rc.fromMonthly)} MT)</div></div>
      <div class="card"><h3 style="font-size:14px;margin:0 0 8px;color:#f8fafc;">Comparação entre redes (receita recebida)</h3>
        ${comparison.length ? comparison.map((c) => `<div style="margin:6px 0;"><div style="font-size:11px;color:#cbd5e1;display:flex;justify-content:space-between;">${link(c.x.id, c.x.name)}<span style="font-family:var(--font-mono);">${money(c.v)} MT · ${c.x.net.stores} lojas</span></div><div style="height:8px;background:#1e293b;border-radius:4px;"><div style="height:8px;width:${(c.v / mx) * 100}%;background:#3b82f6;border-radius:4px;"></div></div></div>`).join('') : '<div style="color:#64748b;font-size:12px;">Sem dados.</div>'}</div>`;
  };

  const listRows = (rows) => rows.map((a) => `<tr><td>${link(a.id, a.name)}<div style="font-size:10px;color:#94a3b8;">${esc(a.phone || '')} · registo ${fdate(a.created_at)}</div></td>
      <td>${esc(a.status)}</td><td>${a.is_super ? a.children.length : esc(networkOf(a))}</td>
      <td>${a.own.stores}${a.is_super ? ` / rede ${a.net.stores}` : ''}</td>
      <td style="font-size:11px;">A:${a.net.regular + a.net.a_vencer} B:${a.net.bloqueada} M:${a.net.em_atraso} P:${a.net.pendente}</td>
      <td class="mono">${money(a.net.received)}</td><td class="mono" style="color:#f87171;">${money(a.net.overdue)}</td>
      <td class="mono">${money(a.own.commDirect)}${a.is_super ? ` / ${money(a.own.commIndirect)}` : ''}</td>
      <td class="mono">${money(a.pending_commissions)} / ${money(a.paid_commissions)}</td><td style="font-size:11px;">${fdate(a.own.lastActivity)}</td></tr>`);
  const HEAD_LIST = ['Nome', 'Estado', 'Rede / Embaixadores', 'Lojas', 'A=activas B=bloq. M=atraso P=pend.', 'Recebido (MT)', 'Em atraso (MT)', 'Comissão dir. / indir.', 'Pendente / Paga', 'Últ. actividade'];
  const sortFn = { net: (a, b) => b.net.received - a.net.received, stores: (a, b) => b.net.stores - a.net.stores, name: (a, b) => a.name.localeCompare(b.name), recent: (a, b) => new Date(b.own.lastActivity || 0) - new Date(a.own.lastActivity || 0) };
  const filterBar = (extra = '') => `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
    <input id="rn-q" type="search" placeholder="Pesquisar nome, código, loja…" value="${esc(S.q)}" style="flex:1 1 220px;">
    <select id="rn-sort"><option value="net" ${S.sort === 'net' ? 'selected' : ''}>Ordenar: receita</option><option value="stores" ${S.sort === 'stores' ? 'selected' : ''}>Ordenar: nº de lojas</option><option value="recent" ${S.sort === 'recent' ? 'selected' : ''}>Ordenar: actividade</option><option value="name" ${S.sort === 'name' ? 'selected' : ''}>Ordenar: nome</option></select>${extra}</div>`;
  const viewAmbList = (supers) => {
    const list = S.net.nodes.filter((a) => (supers ? a.is_super : !a.is_super) && matchQ(a.name, a.phone, a.id, ...a.stores.map((s) => s.name))).sort(sortFn[S.sort]);
    const p = paged(supers ? 'super' : 'amb', list);
    return `${filterBar(exportBtn('rn-exp'))}<div class="card" style="padding:0;overflow:hidden;">${tbl(HEAD_LIST, listRows(p.rows), supers ? 'Ainda não há Super Embaixadores. Marque um embaixador como Super em «Comissões → Hierarquia».' : 'Sem embaixadores.')}${renderPager(p, 'rn-pg')}</div>`;
  };

  const rankTable = (title, items, metricLabel, fmt = (v) => v) => `<div class="card"><h3 style="font-size:13px;margin:0 0 6px;color:#f8fafc;">${title}</h3><div style="font-size:10px;color:#94a3b8;margin-bottom:6px;">Métrica: ${metricLabel}</div>
    ${items.length ? `<ol style="margin:0;padding-left:18px;font-size:12px;color:#cbd5e1;">${items.slice(0, 5).map((i) => `<li>${link(i.a.id, i.a.name)} — <b style="font-family:var(--font-mono);">${fmt(i.v)}</b></li>`).join('')}</ol>` : '<div style="color:#64748b;font-size:12px;">Sem dados.</div>'}</div>`;
  const viewTop = () => {
    const sup = S.net.nodes.filter((a) => a.is_super), nor = S.net.nodes.filter((a) => !a.is_super);
    const rk = (arr, f) => arr.map((a) => ({ a, v: f(a) })).filter((i) => i.v > 0).sort((x, y) => y.v - x.v);
    return `<div class="metrics-grid">
      ${rankTable('Super Embaixadores mais activos', rk(sup, (a) => a.net.newStores30 + a.own.newStores30), 'lojas novas nos últimos 30 dias (rede + directas)')}
      ${rankTable('Embaixadores mais activos', rk(nor, (a) => a.own.newStores30), 'lojas novas nos últimos 30 dias')}
      ${rankTable('Redes com mais lojas activas', rk(S.net.nodes.filter((a) => a.is_super || !a.parent_ambassador_id), (a) => a.net.regular + a.net.a_vencer), 'lojas activas (regulares + a vencer)')}
      ${rankTable('Redes com maior receita recebida', rk(S.net.nodes.filter((a) => a.is_super || !a.parent_ambassador_id), (a) => a.net.received), 'mensalidades recebidas no período', (v) => money(v) + ' MT')}
      ${rankTable('Mais novas lojas (últimos 30 dias)', rk(S.net.nodes, (a) => a.own.newStores30), 'lojas criadas (não existe estado «aprovada» na base)')}</div>`;
  };

  const allStores = () => S.net.nodes.flatMap((a) => a.stores.map((s) => ({ ...s, amb: a })));
  const viewPay = () => {
    const now = Date.now(), d = (x) => (x ? (now - new Date(x).getTime()) / 864e5 : Infinity);
    let list = allStores().filter((s) => (!S.status || s.key === S.status) && matchQ(s.name, s.id, s.amb.name, s.owner_name));
    list.sort((a, b) => Number(b.overdue_amount) - Number(a.overdue_amount));
    const p = paged('pay', list, 20);
    const noNew = S.net.nodes.filter((a) => !a.is_super && d(a.last_store_at) > 90);
    const idle = S.net.nodes.filter((a) => a.is_super && d(a.own.lastPaymentAt) > 60 && S.net.byId.get(a.id).children.every((c) => d(S.net.byId.get(c).own.lastPaymentAt) > 60));
    const st = `<select id="rn-status"><option value="">Todos os estados</option>${Object.keys(LABEL).map((k) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${LABEL[k]}</option>`).join('')}</select>`;
    return `${filterBar(st + exportBtn('rn-exp'))}<div class="card" style="padding:0;overflow:hidden;">${tbl(['Loja', 'Estado', 'Embaixador / Rede', 'Vence', 'Em atraso há', 'Valor em dívida (est.)', 'Recebido (MT)', 'Último pagamento'],
      p.rows.map((s) => `<tr><td><b>${esc(s.name)}</b><div style="font-size:10px;color:#94a3b8;">${esc(s.city || '')} · ${esc(s.phone || '')}</div></td><td>${badge(s.key)}</td><td>${link(s.amb.id, s.amb.name)}<div style="font-size:10px;color:#94a3b8;">${esc(networkOf(s.amb))}</div></td>
      <td style="font-size:11px;">${fdate(s.subscription_end)}</td><td>${s.days_overdue != null ? s.days_overdue + ' dia(s)' : '—'}</td><td class="mono" style="color:#f87171;">${money(s.overdue_amount)}</td><td class="mono">${money(s.received)}</td><td style="font-size:11px;">${fdate(s.last_payment_date)}</td></tr>`), 'Nenhuma loja com este filtro.')}${renderPager(p, 'rn-pg')}</div>
      <div class="metrics-grid"><div class="card"><h3 style="font-size:13px;margin:0 0 6px;color:#f8fafc;">Embaixadores sem novas adesões (90 dias)</h3>${noNew.length ? noNew.map((a) => `<div style="font-size:12px;">${link(a.id, a.name)} <span style="color:#94a3b8;">· última adesão ${fdate(a.last_store_at)}</span></div>`).join('') : '<div style="color:#64748b;font-size:12px;">Nenhum.</div>'}</div>
      <div class="card"><h3 style="font-size:13px;margin:0 0 6px;color:#f8fafc;">Super Embaixadores com rede inactiva (60 dias sem pagamentos)</h3>${idle.length ? idle.map((a) => `<div style="font-size:12px;">${link(a.id, a.name)}</div>`).join('') : '<div style="color:#64748b;font-size:12px;">Nenhum.</div>'}</div></div>
      <div style="font-size:10px;color:#64748b;">Nota: o sistema não guarda histórico dos estados das lojas, por isso mostra o incumprimento actual (não a tendência).</div>`;
  };

  const viewComm = () => {
    const list = S.net.nodes.filter((a) => matchQ(a.name, a.id)).sort(sortFn[S.sort]); const p = paged('comm', list);
    const au = (S.report.rate_audit || []).slice(0, 50), po = (S.report.payouts || []).slice(0, 50);
    return `${filterBar(exportBtn('rn-exp'))}<div class="card" style="padding:0;overflow:hidden;">${tbl(['Embaixador', 'Tipo', 'Taxa dir. %', 'Taxa indir. %', 'Gerada dir.', 'Gerada indir.', 'Pendente', 'Paga', ''],
      p.rows.map((a) => `<tr><td>${link(a.id, a.name)}</td><td>${a.is_super ? 'Super' : esc(networkOf(a))}</td><td>${a.commission_rate}</td><td>${a.is_super ? a.indirect_commission_rate : '—'}</td><td class="mono">${money(a.own.commDirect)}</td><td class="mono">${money(a.own.commIndirect)}</td><td class="mono">${money(a.pending_commissions)}</td><td class="mono">${money(a.paid_commissions)}</td>
      <td><button class="btn btn-secondary rn-rates" data-id="${esc(a.id)}" style="padding:3px 8px;font-size:10px;">Taxas</button> <button class="btn btn-secondary rn-hier" data-id="${esc(a.id)}" style="padding:3px 8px;font-size:10px;">Hierarquia</button></td></tr>`))}${renderPager(p, 'rn-pg')}</div>
      <div style="font-size:10px;color:#64748b;margin:6px 0;">Comissões «canceladas»: o sistema não tem esse estado. Alterar uma taxa só vale para lojas criadas depois; as existentes mantêm a taxa do seu contrato.</div>
      <div class="metrics-grid"><div class="card"><h3 style="font-size:13px;margin:0 0 6px;color:#f8fafc;">Auditoria de taxas e hierarquia</h3>${tbl(['Data', 'Embaixador', 'Campo', 'Antes', 'Depois'], au.map((r) => `<tr><td style="font-size:11px;">${fdate(r.changed_at)}</td><td>${esc(nameOf(r.ambassador_id))}</td><td>${esc(r.field)}</td><td>${esc(r.old_value ?? '—')}</td><td>${esc(r.new_value ?? '—')}</td></tr>`), 'Sem alterações registadas.')}</div>
      <div class="card"><h3 style="font-size:13px;margin:0 0 6px;color:#f8fafc;">Histórico de liquidações</h3>${tbl(['Data', 'Embaixador', 'Valor', 'Método', 'Estado'], po.map((r) => `<tr><td style="font-size:11px;">${fdate(r.created_at)}</td><td>${esc(nameOf(r.ambassador_id))}</td><td class="mono">${money(r.amount)}</td><td>${esc(r.method || '')}</td><td>${esc(r.status || '')}</td></tr>`), 'Sem liquidações.')}</div></div>`;
  };

  // ---------------- detalhe ----------------
  const viewDetail = () => {
    const a = S.net.byId.get(S.detail); if (!a) { S.detail = null; return viewDash(); }
    const series = seriesFor(a, S.net.byId), kids = a.children.map((id) => S.net.byId.get(id));
    const direct = a.stores, indirect = kids.flatMap((k) => k.stores.map((s) => ({ ...s, by: k.name })));
    const storeRows = (arr, byCol) => arr.map((s) => `<tr><td><b>${esc(s.name)}</b><div style="font-size:10px;color:#94a3b8;">${esc(s.city || '')}</div></td><td>${badge(s.key)}</td>${byCol ? `<td>${esc(s.by)}</td>` : ''}<td class="mono">${money(s.monthly_fee)}</td><td class="mono">${money(s.received)}</td><td class="mono" style="color:#f87171;">${money(s.overdue_amount)}</td><td style="font-size:11px;">${fdate(s.last_payment_date)}</td></tr>`);
    const recvInd = kids.reduce((t, k) => t + k.own.received, 0);
    const back = a.parent_ambassador_id ? link(a.parent_ambassador_id, '← ' + nameOf(a.parent_ambassador_id)) : '';
    const pays = (S.report.recent_payments || []).filter((p) => p.ambassador_id === a.id || p.source_ambassador_id === a.id).slice(0, 60);
    return `<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><div style="font-size:11px;color:#94a3b8;">${a.is_super ? 'SUPER EMBAIXADOR' : 'EMBAIXADOR'} ${back}</div><h2 style="margin:2px 0;font-size:18px;color:#f8fafc;">${esc(a.name)}</h2>
      <div style="font-size:11px;color:#94a3b8;">${esc(a.phone || '')} · ${esc(a.status)} · registo ${fdate(a.created_at)} · taxa dir. ${a.commission_rate}%${a.is_super ? ` · indir. ${a.indirect_commission_rate}%` : ''}</div></div>
      <div><button class="btn btn-secondary" id="rn-close">← Voltar à lista</button> ${exportBtn('rn-exp')}</div></div></div>
      <div class="metrics-grid">${card('Lojas directas', a.own.stores, '')}${a.is_super ? card('Embaixadores na rede', kids.length, '') + card('Lojas dos embaixadores', indirect.length, '') : ''}
      ${card('Recebido — lojas directas', money(a.own.received) + ' MT', '', '#34d399')}${a.is_super ? card('Recebido — lojas indirectas', money(recvInd) + ' MT', 'não é comissão', '#34d399') : ''}
      ${card('Comissões directas', money(a.own.commDirect) + ' MT', '')}${a.is_super ? card('Comissões indirectas', money(a.own.commIndirect) + ' MT', '') : ''}
      ${card('Pendentes', money(a.pending_commissions) + ' MT', '', '#fbbf24')}${card('Pagas', money(a.paid_commissions) + ' MT', '', '#60a5fa')}${card('Em atraso (est.)', money(a.net.overdue) + ' MT', '', '#f87171')}${card('Último pagamento', fdate(a.own.lastPaymentAt), '')}</div>
      <div class="card"><h3 style="font-size:14px;margin:0 0 8px;color:#f8fafc;">Histórico financeiro por mês</h3>${chart(series)}
        ${tbl(['Mês', 'Mensalidades recebidas', 'Comissão directa', 'Comissão indirecta'], series.slice().reverse().map((m) => `<tr><td>${m.month}</td><td class="mono">${money(m.received)}</td><td class="mono">${money(m.commDirect)}</td><td class="mono">${money(m.commIndirect)}</td></tr>`), 'Sem pagamentos.')}</div>
      ${a.is_super ? `<div class="card" style="padding:0;overflow:hidden;"><div style="padding:12px 14px;font-weight:800;color:#f8fafc;">Embaixadores da rede</div>${tbl(['Nome', 'Estado', 'Lojas', 'Recebido', 'Em atraso', 'Comissões'], kids.map((k) => `<tr><td>${link(k.id, k.name)}</td><td>${esc(k.status)}</td><td>${k.own.stores}</td><td class="mono">${money(k.own.received)}</td><td class="mono">${money(k.own.overdue)}</td><td class="mono">${money(k.own.commDirect)}</td></tr>`), 'Sem embaixadores na rede.')}</div>` : ''}
      <div class="card" style="padding:0;overflow:hidden;"><div style="padding:12px 14px;font-weight:800;color:#f8fafc;">Lojas registadas directamente</div>${tbl(['Loja', 'Estado', 'Mensalidade', 'Recebido', 'Em atraso', 'Último pag.'], storeRows(direct, false), 'Sem lojas directas.')}</div>
      ${a.is_super ? `<div class="card" style="padding:0;overflow:hidden;"><div style="padding:12px 14px;font-weight:800;color:#f8fafc;">Lojas da rede (quem cadastrou)</div>${tbl(['Loja', 'Estado', 'Cadastrada por', 'Mensalidade', 'Recebido', 'Em atraso', 'Último pag.'], storeRows(indirect, true), 'Sem lojas na rede.')}</div>` : ''}
      <div class="card" style="padding:0;overflow:hidden;"><div style="padding:12px 14px;font-weight:800;color:#f8fafc;">Registos financeiros de origem (últimos 60)</div>${tbl(['Data', 'Tipo', 'Loja', 'Pagamento da loja', 'Taxa', 'Comissão', 'Origem'], pays.map((p) => `<tr><td style="font-size:11px;">${fdate(p.paid_at)}</td><td>${p.kind === 'INDIRECT' ? 'Indirecta' : 'Directa'}</td><td>${esc(p.store_name || '')}</td><td class="mono">${money(p.payment_amount)}</td><td>${p.commission_rate}%</td><td class="mono">${money(p.commission_amount)}</td><td style="font-size:10px;color:#94a3b8;">${esc(p.id)}</td></tr>`), 'Sem registos no período.')}</div>`;
  };

  // ---------------- modais ----------------
  const modal = (html) => { const m = document.createElement('div'); m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;'; m.innerHTML = `<div class="card" style="max-width:440px;width:100%;">${html}</div>`; document.body.appendChild(m); m.querySelector('[data-x]').onclick = () => m.remove(); return m; };
  const openRates = (id) => {
    const a = S.net.byId.get(id); const m = modal(`<h3 style="margin:0 0 8px;color:#f8fafc;">Taxas — ${esc(a.name)}</h3>
      <label style="font-size:11px;color:#cbd5e1;">Comissão directa (%)</label><input id="m-d" type="number" min="0" max="100" step="0.01" value="${a.commission_rate}" style="width:100%;">
      ${a.is_super ? `<label style="font-size:11px;color:#cbd5e1;">Comissão indirecta (%)</label><input id="m-i" type="number" min="0" max="100" step="0.01" value="${a.indirect_commission_rate}" style="width:100%;">` : '<div style="font-size:11px;color:#94a3b8;margin-top:6px;">Só Super Embaixadores têm comissão indirecta.</div>'}
      <div id="m-impact" style="font-size:11px;color:#fbbf24;margin:8px 0;"></div><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" data-x>Cancelar</button><button class="btn btn-primary" id="m-save">Guardar</button></div>`);
    const upd = () => { const d = parseFloat(m.querySelector('#m-d').value) || 0, i = parseFloat(m.querySelector('#m-i')?.value) || 0;
      m.querySelector('#m-impact').textContent = `Impacto mensal estimado: directa ${money(a.own.expected * d / 100)} MT (sobre ${money(a.own.expected)} MT das suas lojas)` + (a.is_super ? ` · indirecta ${money((a.net.expected - a.own.expected) * i / 100)} MT (sobre a rede)` : '') + '. Aplica-se só a lojas criadas a partir de agora.'; };
    m.querySelectorAll('input').forEach((i) => (i.oninput = upd)); upd();
    m.querySelector('#m-save').onclick = async () => { try {
      const { error } = await db.requireClient().rpc('fn_admin_set_ambassador_rates', { p_ambassador_id: id, p_direct: parseFloat(m.querySelector('#m-d').value), p_indirect: parseFloat(m.querySelector('#m-i')?.value || '0') || 0 });
      if (error) throw new Error(error.message); m.remove(); showToast('Taxas actualizadas e auditadas.', 'success'); await load(); } catch (e) { showToast(e.message, 'error'); } };
  };
  const openHier = (id) => {
    const a = S.net.byId.get(id); const supers = S.net.nodes.filter((x) => x.is_super && x.id !== id);
    const m = modal(`<h3 style="margin:0 0 8px;color:#f8fafc;">Hierarquia — ${esc(a.name)}</h3>
      <label style="font-size:12px;color:#cbd5e1;"><input type="checkbox" id="m-super" ${a.is_super ? 'checked' : ''}> É Super Embaixador</label>
      <div id="m-par-w" style="margin-top:8px;"><label style="font-size:11px;color:#cbd5e1;">Super Embaixador responsável</label><select id="m-par" style="width:100%;"><option value="">— nenhum (independente) —</option>${supers.map((s) => `<option value="${esc(s.id)}" ${a.parent_ambassador_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;"><button class="btn btn-secondary" data-x>Cancelar</button><button class="btn btn-primary" id="m-save">Guardar</button></div>`);
    const tog = () => (m.querySelector('#m-par-w').style.display = m.querySelector('#m-super').checked ? 'none' : 'block'); m.querySelector('#m-super').onchange = tog; tog();
    m.querySelector('#m-save').onclick = async () => { try { const sup = m.querySelector('#m-super').checked;
      const { error } = await db.requireClient().rpc('fn_admin_set_ambassador_hierarchy', { p_ambassador_id: id, p_is_super: sup, p_parent_id: sup ? null : (m.querySelector('#m-par').value || null) });
      if (error) throw new Error(error.message); m.remove(); showToast('Hierarquia actualizada e auditada.', 'success'); await load(); } catch (e) { showToast(e.message, 'error'); } };
  };

  // ---------------- exportações ----------------
  const exportCurrent = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (S.detail) { const a = S.net.byId.get(S.detail);
      return download(`rede_${a.id}_${stamp}.csv`, [...a.stores.map((s) => ({ ...s, by: a.name })), ...a.children.flatMap((c) => S.net.byId.get(c).stores.map((s) => ({ ...s, by: S.net.byId.get(c).name })))],
        [{ label: 'Loja', key: 'name' }, { label: 'Cadastrada por', key: 'by' }, { label: 'Estado', get: (r) => LABEL[r.key] }, { label: 'Mensalidade', key: 'monthly_fee' }, { label: 'Recebido', key: 'received' }, { label: 'Em atraso (est.)', key: 'overdue_amount' }, { label: 'Último pagamento', key: 'last_payment_date' }]); }
    if (S.tab === 'pay') return download(`lojas_${stamp}.csv`, allStores().filter((s) => (!S.status || s.key === S.status) && matchQ(s.name, s.id, s.amb.name)),
      [{ label: 'Loja', key: 'name' }, { label: 'Estado', get: (r) => LABEL[r.key] }, { label: 'Embaixador', get: (r) => r.amb.name }, { label: 'Rede', get: (r) => networkOf(r.amb) }, { label: 'Mensalidade', key: 'monthly_fee' }, { label: 'Recebido', key: 'received' }, { label: 'Em atraso (est.)', key: 'overdue_amount' }, { label: 'Dias em atraso', key: 'days_overdue' }, { label: 'Último pagamento', key: 'last_payment_date' }]);
    const sup = S.tab === 'super';
    return download(`${sup ? 'super_embaixadores' : 'embaixadores'}_${stamp}.csv`, S.net.nodes.filter((a) => (S.tab === 'comm' ? true : sup ? a.is_super : !a.is_super) && matchQ(a.name, a.id)),
      [{ label: 'Nome', key: 'name' }, { label: 'Tipo', get: (a) => (a.is_super ? 'Super' : 'Normal') }, { label: 'Rede', get: networkOf }, { label: 'Lojas', get: (a) => a.net.stores }, { label: 'Recebido', get: (a) => a.net.received }, { label: 'Em atraso (est.)', get: (a) => a.net.overdue }, { label: 'Comissão directa gerada', get: (a) => a.own.commDirect }, { label: 'Comissão indirecta gerada', get: (a) => a.own.commIndirect }, { label: 'Pendente', key: 'pending_commissions' }, { label: 'Paga', key: 'paid_commissions' }]);
  };

  // ---------------- desenho ----------------
  const draw = () => {
    const body = S.detail ? viewDetail() : ({ dash: viewDash, super: () => viewAmbList(true), amb: () => viewAmbList(false), top: viewTop, pay: viewPay, comm: viewComm }[S.tab])();
    container.innerHTML = `<div data-rede-root style="display:flex;flex-direction:column;gap:14px;">
      <div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;"><div><div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;">Controlo global das redes</div><h2 style="margin:2px 0 0;font-size:18px;color:#f8fafc;">Rede & Finanças</h2></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><label style="font-size:11px;color:#94a3b8;">De <input type="date" id="rn-from" value="${esc(S.from)}"></label><label style="font-size:11px;color:#94a3b8;">Até <input type="date" id="rn-to" value="${esc(S.to)}"></label><button class="btn btn-secondary" id="rn-apply">Aplicar período</button><button class="btn btn-secondary" id="rn-back">← Gestão de Embaixadores</button></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">${TABS.map(([k, l]) => `<button class="btn ${!S.detail && S.tab === k ? 'btn-primary' : 'btn-secondary'} rn-tab" data-tab="${k}" style="padding:5px 12px;font-size:11px;">${l}</button>`).join('')}</div></div>${body}</div>`;
    const $ = (s) => container.querySelector(s);
    $('#rn-back').onclick = () => onBack && onBack();
    $('#rn-apply').onclick = () => { S.from = $('#rn-from').value; S.to = $('#rn-to').value; load(); };
    container.querySelectorAll('.rn-tab').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; S.detail = null; S.q = ''; S.status = ''; draw(); }));
    container.querySelectorAll('[data-open]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); S.detail = l.dataset.open; draw(); window.scrollTo(0, 0); }));
    const q = $('#rn-q'); if (q) { q.oninput = () => { S.q = q.value; S.page = {}; clearTimeout(q._t); q._t = setTimeout(() => { draw(); const n = $('#rn-q'); n && (n.focus(), n.setSelectionRange(n.value.length, n.value.length)); }, 250); }; }
    const so = $('#rn-sort'); if (so) so.onchange = () => { S.sort = so.value; draw(); };
    const ss = $('#rn-status'); if (ss) ss.onchange = () => { S.status = ss.value; S.page = {}; draw(); };
    const ex = $('#rn-exp'); if (ex) ex.onclick = exportCurrent;
    const cl = $('#rn-close'); if (cl) cl.onclick = () => { S.detail = null; draw(); };
    ['super', 'amb', 'pay', 'comm'].forEach(() => bindPager(container, 'rn-pg', (pg) => { S.page[S.tab === 'super' ? 'super' : S.tab] = pg; draw(); }));
    container.querySelectorAll('.rn-rates').forEach((b) => (b.onclick = () => openRates(b.dataset.id)));
    container.querySelectorAll('.rn-hier').forEach((b) => (b.onclick = () => openHier(b.dataset.id)));
  };

  await load();
}
