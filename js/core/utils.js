/**
 * GEF - GESTÃO FINANCEIRA | UTILITÁRIOS COMPARTILHADOS
 */

// Escapa texto vindo do banco antes de inseri-lo em innerHTML (evita XSS entre lojas/usuários).
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-MZ');
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-MZ');
}

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ---------------------------------------------------------------------------------------------
// MATEMÁTICA DE PREÇO / QUANTIDADE (metros, kg, etc. — inteiros e decimais)
// Regra: o preço é PROPORCIONAL à quantidade (total = quantidade × preço unitário) e cada linha é
// arredondada a 2 casas, exactamente como o servidor faz em fn_process_atomic_sale.
// ---------------------------------------------------------------------------------------------

// Arredonda a N casas sem erro binário (ex.: 1.005 -> 1.01; 0.1 + 0.2 -> 0.3).
export function roundTo(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, decimals);
  return Math.sign(n) * Math.round(Math.abs(n) * f * (1 + Number.EPSILON)) / f;
}

export const round2 = (v) => roundTo(v, 2);
export const round3 = (v) => roundTo(v, 3);

// Total de uma linha: quantidade (inteira ou decimal) × preço unitário, a 2 casas.
export function lineTotal(quantity, unitPrice) {
  return round2(Number(quantity || 0) * Number(unitPrice || 0));
}

// Lucro/custo das vendas CONCLUÍDAS, por venda, por item e total (só leitura, sem tocar na base).
//  - receita do item = total da linha; custo do item = total_cogs gravado na venda (custo real do lote);
//  - o desconto da venda é repartido pelos itens na proporção da sua receita (lucro por item líquido).
// Devolve { revenue, cost, profit, discount, itemsCount, items: [...] } (items agregados por produto+unidade).
export function summarizeSalesProfit(sales) {
  const byKey = new Map();
  let revenue = 0;
  let cost = 0;
  let discount = 0;
  let profit = 0;

  for (const sale of sales || []) {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const saleNet = Number(sale.total ?? sale.totalNet ?? 0);
    const saleDiscount = Number(sale.discount ?? sale.discountAmount ?? 0);
    const itemsRevenue = items.reduce((s, it) => s + Number(it.totalPrice ?? it.total ?? 0), 0);
    const itemsCost = items.reduce((s, it) => s + Number(it.totalCogs || 0), 0);

    // Custo da venda: o gravado na venda; se faltar, a soma dos itens.
    const saleCost = Number(sale.totalCogs) > 0 ? Number(sale.totalCogs) : itemsCost;

    revenue += saleNet;
    cost += saleCost;
    discount += saleDiscount;
    profit += saleNet - saleCost;

    for (const it of items) {
      const itRev = Number(it.totalPrice ?? it.total ?? 0);
      const itCost = Number(it.totalCogs || 0);
      const share = itemsRevenue > 0 ? itRev / itemsRevenue : 0;
      const itDiscount = saleDiscount * share;
      const key = `${it.productId}|${it.packagingName || it.selectedUnit || ''}`;
      const row = byKey.get(key) || {
        productId: it.productId,
        name: it.productName || '—',
        code: it.productCode || '',
        unit: it.packagingName || it.selectedUnit || '',
        quantity: 0,
        revenue: 0,
        discount: 0,
        cost: 0
      };
      row.quantity += Number(it.quantity || 0);
      row.revenue += itRev;
      row.discount += itDiscount;
      row.cost += itCost;
      byKey.set(key, row);
    }
  }

  const items = [...byKey.values()]
    .map((r) => {
      const net = r.revenue - r.discount;
      const p = net - r.cost;
      return {
        ...r,
        quantity: round3(r.quantity),
        revenue: round2(r.revenue),
        discount: round2(r.discount),
        net: round2(net),
        cost: round2(r.cost),
        profit: round2(p),
        marginPct: net > 0 ? round2((p / net) * 100) : 0
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return {
    revenue: round2(revenue),
    cost: round2(cost),
    discount: round2(discount),
    profit: round2(profit),
    marginPct: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    salesCount: (sales || []).length,
    items
  };
}

// Data local (AAAA-MM-DD) — evita o erro de fuso de toISOString() (UTC) para vendas feitas à noite/madrugada.
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameLocalDay(isoOrDate, day = localDateStr()) {
  if (!isoOrDate) return false;
  const d = new Date(isoOrDate);
  return !isNaN(d.getTime()) && localDateStr(d) === day;
}
