/**
 * GEF | CÁLCULO DAS REDES (puro, sem DOM). Entrada: resposta de fn_admin_network_report.
 * Regra anti-duplicação: a RECEITA vem só de linhas DIRECT (1 por pagamento de loja).
 * Cada loja pertence a UM embaixador; a rede de um Super = ele + os embaixadores filhos.
 */
const n = (v) => Number(v || 0);
const DAY = 864e5;
const blank = () => ({ stores: 0, regular: 0, a_vencer: 0, pendente: 0, em_atraso: 0, bloqueada: 0, sem_loja: 0,
  expected: 0, received: 0, overdue: 0, commDirect: 0, commIndirect: 0, newStores30: 0, lastPaymentAt: null, lastActivity: null });

export function storeKey(s) {
  switch (String(s.status).toUpperCase()) {
    case 'BLOQUEADA': return 'bloqueada';
    case 'EXPIRADA': return 'em_atraso';
    case 'EM_TESTE': return 'pendente';
    case 'SEM_LOJA': return 'sem_loja';
    case 'ATIVA': return (s.days_remaining !== null && s.days_remaining !== undefined && n(s.days_remaining) >= 0 && n(s.days_remaining) <= 7) ? 'a_vencer' : 'regular';
    default: return 'sem_loja';
  }
}
const maxDate = (a, b) => (!a ? b : !b ? a : (new Date(a) > new Date(b) ? a : b));
function addInto(t, o) {
  for (const k of ['stores', 'regular', 'a_vencer', 'pendente', 'em_atraso', 'bloqueada', 'sem_loja', 'expected', 'received', 'overdue', 'commDirect', 'commIndirect', 'newStores30']) t[k] += o[k];
  t.lastPaymentAt = maxDate(t.lastPaymentAt, o.lastPaymentAt);
  t.lastActivity = maxDate(t.lastActivity, o.lastActivity);
}

export function buildNetwork(report, { now = Date.now() } = {}) {
  const A = report?.ambassadors || [], S = report?.stores || [], M = report?.monthly || [];
  const byId = new Map();
  for (const a of A) byId.set(a.id, { ...a, children: [], stores: [], monthly: [], own: blank(), net: null });
  for (const a of A) { const p = a.parent_ambassador_id && byId.get(a.parent_ambassador_id); if (p) p.children.push(a.id); }

  for (const s of S) {
    const x = byId.get(s.ambassador_id); if (!x) continue;
    const k = storeKey(s); x.stores.push({ ...s, key: k }); const o = x.own;
    o.stores++; o[k]++;
    if (k !== 'bloqueada' && k !== 'sem_loja') o.expected += n(s.monthly_fee);
    o.overdue += n(s.overdue_amount);
    if (s.created_at && new Date(s.created_at).getTime() >= now - 30 * DAY) o.newStores30++;
  }
  for (const m of M) {
    const x = byId.get(m.ambassador_id); if (!x) continue;
    x.monthly.push(m);
    x.own.received += n(m.received); x.own.commDirect += n(m.commission_direct); x.own.commIndirect += n(m.commission_indirect);
  }
  for (const x of byId.values()) {
    x.own.lastPaymentAt = x.last_payment_at || null;
    x.own.lastActivity = maxDate(x.last_payment_at, x.last_store_at) || null;
  }
  for (const x of byId.values()) {
    x.net = blank(); addInto(x.net, x.own);
    for (const cid of x.children) addInto(x.net, byId.get(cid).own);   // filhos não se repetem: 1 só nível
  }

  const nodes = [...byId.values()];
  const totals = blank(); totals.supers = 0; totals.normals = 0; totals.pending = 0; totals.paid = 0;
  for (const x of nodes) {
    addInto(totals, x.own);
    if (x.is_super) totals.supers++; else totals.normals++;
    totals.pending += n(x.pending_commissions); totals.paid += n(x.paid_commissions);
  }
  totals.commGenerated = totals.commDirect + totals.commIndirect;

  const months = new Map();
  for (const m of M) {
    const r = months.get(m.month) || { month: m.month, received: 0, commDirect: 0, commIndirect: 0 };
    r.received += n(m.received); r.commDirect += n(m.commission_direct); r.commIndirect += n(m.commission_indirect);
    months.set(m.month, r);
  }
  return { nodes, byId, totals, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}

/** Série mensal de uma rede (o próprio + filhos se for Super). */
export function seriesFor(node, byId) {
  const ids = [node.id, ...(node.children || [])]; const map = new Map();
  for (const id of ids) for (const m of (byId.get(id)?.monthly || [])) {
    const r = map.get(m.month) || { month: m.month, received: 0, commDirect: 0, commIndirect: 0 };
    r.received += n(m.received); r.commDirect += n(m.commission_direct); r.commIndirect += n(m.commission_indirect);
    map.set(m.month, r);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Reconciliação: soma por loja == soma mensal == soma dos pagamentos DIRECT listados (se < limite). */
export function reconcile(report) {
  const fromStores = (report?.stores || []).reduce((t, s) => t + n(s.received), 0);
  const fromMonthly = (report?.monthly || []).reduce((t, m) => t + n(m.received), 0);
  return { fromStores, fromMonthly, ok: Math.abs(fromStores - fromMonthly) < 0.005 };
}

export function toCsv(rows, columns) {
  const guard = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  const q = (v) => `"${guard(v).replace(/"/g, '""')}"`;
  return '\uFEFF' + [columns.map((c) => q(c.label)).join(';'), ...rows.map((r) => columns.map((c) => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'))].join('\r\n');
}
