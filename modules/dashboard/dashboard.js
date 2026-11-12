/**
 * GEF - GESTÃO FINANCEIRA | DASHBOARD MODULE
 * JavaScript Puro (Vanilla JS)
 */

import { db } from '../../js/core/database.js';
import { auth } from '../../js/core/auth.js';
import { openReceiptModal } from '../../js/components/receipt-modal.js';
import { i18n } from '../../js/core/i18n.js';
import { escapeHtml } from '../../js/core/utils.js';
const CUR = () => i18n.getCurrencyObj().symbol;

// Limpeza da actualização em tempo real do dashboard anterior (evita temporizadores/canais duplicados)
let profitLiveCleanup = null;

export async function initDashboardModule(container, options = {}) {
  const { onNavigate } = options;
  const currentUser = auth.getCurrentUser();

  if (currentUser?.role === 'CASHIER') {
    if (onNavigate) onNavigate('PDV');
    return;
  }

  if (currentUser?.role === 'EMBAIXADOR') {
    if (onNavigate) onNavigate('EMBAIXADORES');
    return;
  }

  if (currentUser?.role === 'SUPERADMIN') {
    if (onNavigate) onNavigate('MONITOR_SAAS');
    return;
  }

  if (profitLiveCleanup) { profitLiveCleanup(); profitLiveCleanup = null; }

  const canSeeProfit = currentUser?.role === 'ADMIN';
  const storeId = db.getCurrentStoreId();
  const currentStore = await db.getCurrentStore();

  let stats = {};

  try {
    stats = await db.getDashboardStats(storeId);
  } catch (error) {
    console.error('GEF Dashboard: erro ao carregar estatísticas:', error);
    stats = {};
  }

  /*
   * Normalização dos dados do Dashboard.
   *
   * Algumas consultas podem não retornar determinadas listas
   * quando ainda não existem vendas/produtos/orçamentos.
   * Garantimos aqui que o Dashboard receba sempre valores válidos.
   */
  stats = {
    totalRealEquity: Number(stats?.totalRealEquity ?? 0),
    currentCashInDrawer: Number(stats?.currentCashInDrawer ?? 0),
    stockCostTotal: Number(stats?.stockCostTotal ?? 0),

    totalTodaySales: Number(stats?.totalTodaySales ?? 0),
    todaySalesCount: Number(stats?.todaySalesCount ?? 0),

    stockSaleValuation: Number(stats?.stockSaleValuation ?? 0),
    projectedProfitMargin: Number(stats?.projectedProfitMargin ?? 0),

    totalReceivable: Number(stats?.totalReceivable ?? 0),

    lowStockCount: Number(stats?.lowStockCount ?? 0),
    outOfStockCount: Number(stats?.outOfStockCount ?? 0),

    pendingQuotesCount: Number(stats?.pendingQuotesCount ?? 0),
    pendingDeliveriesCount: Number(stats?.pendingDeliveriesCount ?? 0),

    recentSales: Array.isArray(stats?.recentSales)
      ? stats.recentSales
      : [],

    topSellingProducts: Array.isArray(stats?.topSellingProducts)
      ? stats.topSellingProducts
      : [],

    todayProfit: stats?.todayProfit || null,
    monthProfit: stats?.monthProfit || null
  };

  const fmt = (n) => Number(n || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = (n) => Number(n || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const profitColor = (n) => (Number(n) < 0 ? '#f87171' : '#34d399');

  // Painel "Vendas, Custo e Lucro" (dia em tempo real + por item vendido)
  const renderProfitPanel = (today, month, updatedAt, errorMsg) => {
    const t = today || { revenue: 0, cost: 0, profit: 0, marginPct: 0, discount: 0, salesCount: 0, items: [] };
    const m = month || { profit: 0, revenue: 0, marginPct: 0 };
    const time = updatedAt ? new Date(updatedAt).toLocaleTimeString('pt-PT') : '—';

    const card = (label, value, color, hint) => `
      <div class="card metric-card">
        <span class="metric-title">${label}</span>
        <div class="metric-value" style="color: ${color};">${value} <span style="font-size: 14px;">${CUR()}</span></div>
        <div class="metric-sub">${hint}</div>
      </div>`;

    return `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">Vendas, Custo e Lucro de Hoje</h3>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Só vendas concluídas (estornos ficam de fora). Custo real dos lotes vendidos.</div>
          </div>
          <span class="badge badge-emerald" id="dash-profit-live" style="font-size: 10px;">● EM TEMPO REAL · ${time}</span>
        </div>

        ${errorMsg ? `<div class="card" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 10px 14px; font-size: 12px; color: #fde68a;">Não foi possível actualizar agora; a mostrar a última informação. ${escapeHtml(errorMsg)}</div>` : ''}

        <div class="metrics-grid">
          ${card('Vendido Hoje', fmt(t.revenue), '#60a5fa', `${t.salesCount} venda(s)${t.discount > 0 ? ` · desconto ${fmt(t.discount)}` : ''}`)}
          ${card('Custo Hoje', fmt(t.cost), '#fbbf24', 'Custo dos produtos vendidos')}
          ${card('Lucro Hoje', fmt(t.profit), profitColor(t.profit), `Margem ${fmt(t.marginPct)}%`)}
          ${card('Lucro do Mês', fmt(m.profit), profitColor(m.profit), `Vendido no mês ${fmt(m.revenue)} · margem ${fmt(m.marginPct)}%`)}
        </div>

        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 12px 16px; border-bottom: 1px solid #1f2937;">
            <h3 style="font-size: 13px; font-weight: 800; color: #f8fafc; margin: 0;">Lucro por item vendido hoje</h3>
          </div>
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unidade</th>
                  <th style="text-align: right;">Qtd.</th>
                  <th style="text-align: right;">Vendido</th>
                  <th style="text-align: right;">Custo</th>
                  <th style="text-align: right;">Lucro</th>
                  <th style="text-align: right;">Margem</th>
                </tr>
              </thead>
              <tbody>
                ${t.items.length === 0 ? `
                  <tr><td colspan="7" style="text-align: center; color: #64748b; padding: 22px;">Ainda não há vendas concluídas hoje.</td></tr>
                ` : t.items.map(it => `
                  <tr>
                    <td>
                      <div style="font-weight: 700; color: #f8fafc;">${escapeHtml(it.name)}</div>
                      ${it.code ? `<div style="font-size: 10px; color: #64748b; font-family: var(--font-mono);">${escapeHtml(it.code)}</div>` : ''}
                    </td>
                    <td style="font-size: 11px; color: #94a3b8;">${escapeHtml(it.unit)}</td>
                    <td style="text-align: right; font-family: var(--font-mono);">${fmtQty(it.quantity)}</td>
                    <td style="text-align: right; font-family: var(--font-mono); color: #cbd5e1;">${fmt(it.net)}</td>
                    <td style="text-align: right; font-family: var(--font-mono); color: #fbbf24;">${fmt(it.cost)}</td>
                    <td style="text-align: right; font-family: var(--font-mono); font-weight: 900; color: ${profitColor(it.profit)};">${fmt(it.profit)}</td>
                    <td style="text-align: right; font-family: var(--font-mono); color: #94a3b8;">${fmt(it.marginPct)}%</td>
                  </tr>
                `).join('')}
              </tbody>
              ${t.items.length ? `
              <tfoot>
                <tr>
                  <td colspan="3" style="font-weight: 800; color: #f8fafc;">TOTAL DO DIA</td>
                  <td style="text-align: right; font-family: var(--font-mono); font-weight: 800;">${fmt(t.revenue)}</td>
                  <td style="text-align: right; font-family: var(--font-mono); font-weight: 800; color: #fbbf24;">${fmt(t.cost)}</td>
                  <td style="text-align: right; font-family: var(--font-mono); font-weight: 900; color: ${profitColor(t.profit)};">${fmt(t.profit)}</td>
                  <td style="text-align: right; font-family: var(--font-mono);">${fmt(t.marginPct)}%</td>
                </tr>
              </tfoot>` : ''}
            </table>
          </div>
        </div>
      </div>`;
  };

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px;">

      <!-- Welcome & Location Header Card -->
      <div class="card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 20px;">
        <div>
          <div style="font-size: 11px; font-weight: 800; color: #ea580c; text-transform: uppercase; letter-spacing: 0.5px;">
            Visão Geral Operacional
          </div>

          <h2 style="font-size: 20px; font-weight: 900; color: #f8fafc; margin: 2px 0 0 0;">
            ${currentStore ? currentStore.name : 'GEF'}
          </h2>

          <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
            Operador logado:
            <strong style="color: #cbd5e1;">
              ${currentUser?.fullName || currentUser?.email || 'Utilizador'}
            </strong>
            • Moeda:
            <strong style="color: #cbd5e1;">${i18n.getCurrencyObj().country} (${CUR()})</strong>
          </div>
        </div>

        <!-- Quick Actions -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">

          <button class="btn btn-primary" id="btn-quick-pos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="8" cy="21" r="1"/>
              <circle cx="19" cy="21" r="1"/>
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>
            </svg>
            <span>Novo Pedido (PDV)</span>
          </button>

          <button class="btn btn-secondary" id="btn-quick-quote">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
              <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
            </svg>
            <span>Orçamento de Obra</span>
          </button>

          <button class="btn btn-secondary" id="btn-quick-stock">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m7.5 4.27 9 5.15"/>
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
            </svg>
            <span>Matriz FEFO</span>
          </button>

        </div>
      </div>

      <!-- 4 Core Metrics Grid -->
      <div class="metrics-grid">

        <!-- Metric 1: Patrimônio Real -->
        <div class="card metric-card">

          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <span class="metric-title">
              Patrimônio Real em Caixa & Estoque
            </span>

            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(234, 88, 12, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2">
                <rect width="20" height="12" x="2" y="6" rx="2"/>
                <circle cx="12" cy="12" r="2"/>
                <path d="M6 12h.01M18 12h.01"/>
              </svg>
            </div>
          </div>

          <div class="metric-value" style="color: #f8fafc;">
            ${stats.totalRealEquity.toLocaleString('pt-MZ', {
              minimumFractionDigits: 2
            })}
            <span style="font-size: 14px; color: #ea580c;">${CUR()}</span>
          </div>

          <div class="metric-sub">
            Caixa:
            <strong style="color: #cbd5e1;">
              ${stats.currentCashInDrawer.toLocaleString('pt-MZ')} ${CUR()}
            </strong>
            +
            Estoque Custo:
            <strong style="color: #cbd5e1;">
              ${stats.stockCostTotal.toLocaleString('pt-MZ')} ${CUR()}
            </strong>
          </div>

        </div>

        <!-- Metric 2: Vendas do Dia -->
        <div class="card metric-card">

          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <span class="metric-title">
              Faturamento Hoje
            </span>

            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(16, 185, 129, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
                <line x1="12" x2="12" y1="2" y2="22"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
          </div>

          <div class="metric-value" style="color: #34d399;">
            ${stats.totalTodaySales.toLocaleString('pt-MZ', {
              minimumFractionDigits: 2
            })}
            <span style="font-size: 14px; color: #10b981;">${CUR()}</span>
          </div>

          <div class="metric-sub">
            <strong style="color: #cbd5e1;">
              ${stats.todaySalesCount}
            </strong>
            ${
              stats.todaySalesCount === 1
                ? 'venda concluída'
                : 'vendas concluídas hoje'
            }
          </div>

        </div>

        <!-- Metric 3: Potencial de Venda Estoque -->
        <div class="card metric-card">

          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <span class="metric-title">
              Estoque Valorizado (Venda)
            </span>

            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(59, 130, 246, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
                <path d="m7.5 4.27 9 5.15"/>
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
              </svg>
            </div>
          </div>

          <div class="metric-value" style="color: #60a5fa;">
            ${stats.stockSaleValuation.toLocaleString('pt-MZ', {
              minimumFractionDigits: 2
            })}
            <span style="font-size: 14px; color: #3b82f6;">${CUR()}</span>
          </div>

          <div class="metric-sub">
            Margem Bruta Projetada:
            <strong style="color: #10b981;">
              ${stats.projectedProfitMargin}%
            </strong>
          </div>

        </div>

        <!-- Metric 4: Contas a Receber -->
        <div class="card metric-card">

          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <span class="metric-title">
              Crédito a Receber (Fiado)
            </span>

            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(245, 158, 11, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
              </svg>
            </div>
          </div>

          <div class="metric-value" style="color: #fbbf24;">
            ${stats.totalReceivable.toLocaleString('pt-MZ', {
              minimumFractionDigits: 2
            })}
            <span style="font-size: 14px; color: #f59e0b;">${CUR()}</span>
          </div>

          <div class="metric-sub">
            Total concedido a clientes com limite ativo
          </div>

        </div>

      </div>

      ${canSeeProfit ? `<div id="dash-profit">${renderProfitPanel(stats.todayProfit, stats.monthProfit, new Date().toISOString(), '')}</div>` : ''}

      <!-- Alerts row in Cards -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">

        <!-- Alert 1: Low stock -->
        <div class="card" style="padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;">

          <div style="display: flex; align-items: center; gap: 12px;">

            <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(239, 68, 68, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17"/>
              </svg>
            </div>

            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">
                ${stats.lowStockCount + stats.outOfStockCount} Itens em Atenção
              </div>

              <div style="font-size: 11px; color: #94a3b8;">
                ${stats.outOfStockCount} zerados •
                ${stats.lowStockCount} abaixo do mínimo
              </div>
            </div>

          </div>

          <button class="btn btn-secondary" id="btn-goto-stock-alert" style="padding: 4px 10px; font-size: 11px;">
            Ver Estoque
          </button>

        </div>

        <!-- Alert 2: Quotes -->
        <div class="card" style="padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;">

          <div style="display: flex; align-items: center; gap: 12px;">

            <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(59, 130, 246, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
                <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
              </svg>
            </div>

            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">
                ${stats.pendingQuotesCount} Orçamentos Abertos
              </div>

              <div style="font-size: 11px; color: #94a3b8;">
                Cotações de obras em acompanhamento
              </div>
            </div>

          </div>

          <button class="btn btn-secondary" id="btn-goto-quotes-alert" style="padding: 4px 10px; font-size: 11px;">
            Ver Orçamentos
          </button>

        </div>

        <!-- Alert 3: Deliveries -->
        <div class="card" style="padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;">

          <div style="display: flex; align-items: center; gap: 12px;">

            <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(245, 158, 11, 0.1); display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
                <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
                <circle cx="17" cy="18" r="2"/>
                <circle cx="7" cy="18" r="2"/>
              </svg>
            </div>

            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">
                ${stats.pendingDeliveriesCount} Cargas em Logística
              </div>

              <div style="font-size: 11px; color: #94a3b8;">
                Despachos e entregas
              </div>
            </div>

          </div>

          <button class="btn btn-secondary" id="btn-goto-deliveries-alert" style="padding: 4px 10px; font-size: 11px;">
            Ver Entregas
          </button>

        </div>

      </div>

      <!-- Main Tables Grid: Recent Sales & Top Products -->
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">

        <!-- Recent Sales -->
        <div class="card" style="padding: 0; overflow: hidden;">

          <div style="padding: 14px 20px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center;">

            <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
              Últimas Vendas Concluídas
            </h3>

            <button class="btn btn-secondary" id="btn-view-all-sales" style="padding: 4px 10px; font-size: 11px;">
              Histórico Completo →
            </button>

          </div>

          <div style="overflow-x: auto;">

            <table class="data-table">

              <thead>
                <tr>
                  <th>Recibo / Venda</th>
                  <th>Cliente</th>
                  <th>Pagamento</th>
                  <th>Total (${CUR()})</th>
                  <th style="text-align: right;">Ação</th>
                </tr>
              </thead>

              <tbody>

                ${
                  stats.recentSales.length === 0
                    ? `
                      <tr>
                        <td colspan="5" style="text-align: center; color: #64748b; padding: 24px;">
                          Nenhuma venda registrada ainda nesta loja.
                        </td>
                      </tr>
                    `
                    : stats.recentSales.map(sale => {

                        const saleTotal = Number(
                          sale?.total ??
                          sale?.totalNet ??
                          0
                        );

                        return `
                          <tr>

                            <td>
                              <div style="font-weight: 700; color: #f8fafc;">
                                ${sale?.saleNumber || sale?.id || 'Venda'}
                              </div>

                              <div style="font-size: 10px; color: #94a3b8;">
                                ${
                                  sale?.createdAt || sale?.timestamp
                                    ? new Date(
                                        sale.createdAt || sale.timestamp
                                      ).toLocaleTimeString('pt-MZ')
                                    : '--:--'
                                }
                              </div>
                            </td>

                            <td>
                              <div style="font-weight: 600; color: #cbd5e1;">
                                ${sale?.customerName || 'Consumidor Final'}
                              </div>
                            </td>

                            <td>
                              <span class="badge ${
                                sale?.paymentMethod === 'DINHEIRO'
                                  ? 'badge-emerald'
                                  : sale?.paymentMethod === 'M-PESA'
                                    ? 'badge-red'
                                    : sale?.paymentMethod === 'CREDITO_FIADO'
                                      ? 'badge-amber'
                                      : 'badge-blue'
                              }">
                                ${sale?.paymentMethod || 'N/D'}
                              </span>
                            </td>

                            <td>
                              <strong style="color: #34d399; font-family: var(--font-mono);">
                                ${saleTotal.toFixed(2)} ${CUR()}
                              </strong>
                            </td>

                            <td style="text-align: right;">
                              <button
                                class="btn btn-secondary btn-print-recent"
                                data-sale-id="${sale?.id || ''}"
                                style="padding: 4px 8px; font-size: 10px;"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                                  <rect x="6" y="14" width="12" height="8" rx="1"/>
                                </svg>
                                Recibo
                              </button>
                            </td>

                          </tr>
                        `;
                      }).join('')
                }

              </tbody>

            </table>

          </div>

        </div>

        <!-- Top Selling Products -->
        <div class="card" style="padding: 0; overflow: hidden;">

          <div style="padding: 14px 20px; border-bottom: 1px solid #1f2937;">
            <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
              Top Produtos Mais Vendidos
            </h3>
          </div>

          <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">

            ${
              stats.topSellingProducts.length === 0
                ? `
                  <div style="text-align: center; color: #64748b; padding: 20px; font-size: 12px;">
                    Sem movimentações ainda.
                  </div>
                `
                : stats.topSellingProducts.map((p, idx) => {

                    const productTotal = Number(p?.total ?? 0);
                    const productQty = Number(p?.qty ?? 0);

                    return `
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">

                        <div style="display: flex; align-items: center; gap: 10px;">

                          <span style="font-weight: 900; color: #ea580c; font-size: 13px; width: 16px;">
                            #${idx + 1}
                          </span>

                          <div>

                            <div style="font-weight: 700; color: #f8fafc; font-size: 12px;">
                              ${p?.name || 'Produto'}
                            </div>

                            <div style="font-size: 10px; color: #94a3b8;">
                              ${productQty} un faturadas
                            </div>

                          </div>

                        </div>

                        <div style="font-weight: 800; font-family: var(--font-mono); color: #34d399; font-size: 12px;">
                          ${productTotal.toFixed(2)} ${CUR()}
                        </div>

                      </div>
                    `;
                  }).join('')
            }

          </div>

        </div>

      </div>

    </div>
  `;

  // Bind actions

  const btnQuickPos = container.querySelector('#btn-quick-pos');
  if (btnQuickPos) {
    btnQuickPos.onclick = () => onNavigate?.('PDV');
  }

  const btnQuickQuote = container.querySelector('#btn-quick-quote');
  if (btnQuickQuote) {
    btnQuickQuote.onclick = () => onNavigate?.('ORCAMENTOS');
  }

  const btnQuickStock = container.querySelector('#btn-quick-stock');
  if (btnQuickStock) {
    btnQuickStock.onclick = () => onNavigate?.('ESTOQUE');
  }

  const btnGotoStock = container.querySelector('#btn-goto-stock-alert');
  if (btnGotoStock) {
    btnGotoStock.onclick = () => onNavigate?.('ESTOQUE');
  }

  const btnGotoQuotes = container.querySelector('#btn-goto-quotes-alert');
  if (btnGotoQuotes) {
    btnGotoQuotes.onclick = () => onNavigate?.('ORCAMENTOS');
  }

  const btnGotoDeliveries = container.querySelector('#btn-goto-deliveries-alert');
  if (btnGotoDeliveries) {
    btnGotoDeliveries.onclick = () => onNavigate?.('ENTREGAS');
  }

  const btnViewSales = container.querySelector('#btn-view-all-sales');
  if (btnViewSales) {
    btnViewSales.onclick = () => onNavigate?.('VENDAS');
  }

  // ---- Lucro do dia em tempo real: verifica a cada 15 s, ao voltar ao separador e a cada venda (Realtime) ----
  if (canSeeProfit) {
    let stopped = false;
    let debounce = null;
    let busy = false;
    let client = null;
    let channel = null;
    let last = { today: stats.todayProfit, month: stats.monthProfit, at: new Date().toISOString() };

    const paint = (errorMsg) => {
      const host = container.querySelector('#dash-profit');
      if (host) host.innerHTML = renderProfitPanel(last.today, last.month, last.at, errorMsg || '');
    };

    const cleanup = () => {
      stopped = true;
      clearTimeout(debounce);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (client && channel) { try { client.removeChannel(channel); } catch (e) { /* ignore */ } }
    };

    const refresh = async () => {
      if (stopped || busy) return;
      if (!container.isConnected || !container.querySelector('#dash-profit')) { cleanup(); return; }
      if (document.hidden) return;
      busy = true;
      try {
        const r = await db.getProfitSummary(storeId);
        last = { today: r.today, month: r.month, at: r.updatedAt };
        paint('');
      } catch (err) {
        console.warn('[GEF] Actualização do lucro falhou:', err);
        paint(err?.message || '');
      } finally {
        busy = false;
      }
    };

    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 500); };
    const onVisible = () => { if (!document.hidden) schedule(); };

    try {
      client = db.requireClient();
      channel = client.channel('gef-dash-profit-' + (storeId || 'x'));
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, schedule);
      channel.subscribe();
    } catch (err) {
      console.warn('[GEF] Realtime indisponível; a usar verificação periódica:', err);
    }

    const timer = setInterval(refresh, 120000); // o Realtime (com debounce) actualiza na hora; isto é só rede de segurança
    document.addEventListener('visibilitychange', onVisible);
    profitLiveCleanup = cleanup;
  }

  container.querySelectorAll('.btn-print-recent').forEach(btn => {

    btn.onclick = () => {

      const saleId = btn.getAttribute('data-sale-id');

      const sale = stats.recentSales.find(
        s => s?.id === saleId
      );

      if (sale) {
        openReceiptModal(sale);
      }

    };

  });
}
