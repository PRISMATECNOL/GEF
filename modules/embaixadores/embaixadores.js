/**
 * GEF - GESTÃO FINANCEIRA | MÓDULO DE EMBAIXADORES & PARCEIROS
 * JavaScript Puro (Vanilla JS)
 * Suporta visão do Embaixador (cadastro de novas lojas, tempo de comissão e extrato)
 * e do Superadmin (gestão global e liquidação com valor da comissão zerado).
 */

import { attachTableSearch, normalizeText } from '../../js/components/table-search.js';
import { db } from '../../js/core/database.js';
import { auth } from '../../js/core/auth.js';
import { showToast } from '../../js/components/toast.js';
import { normalizeRole } from '../../js/core/permissions.js';
import { SITE_URL, ADMIN_CONTACT } from '../../js/config.js';
import { buildNotifications, whatsappShareUrl } from '../../js/core/ambassador-view.js';
import { mountNetworkAdmin } from './rede-admin.js';
import { mountProfileAdmin } from './gestao-perfis.js';
import { loadContext, applyContextPrefs, purgeLocalAmbassadorData, renderBlocked, mountAmbassadorExtras } from './perfil-embaixador.js';

// Limpeza das actualizações em tempo real do módulo anterior (evita canais duplicados)
let ambLiveCleanup = null;
import { paginate, renderPager, bindPager } from '../../js/components/pagination.js';
import { displayLogin } from '../../js/core/login-id.js';
import { businessTypeOptionsHtml } from '../../js/core/sector.js';
import { openStoreUserModal } from '../../js/components/store-user-modal.js';

export async function initEmbaixadoresModule(container) {
  const currentUser = auth.getCurrentUser();
  const userRole = currentUser ? normalizeRole(currentUser.role, currentUser.id) : 'EMBAIXADOR';
  const isSuperadmin = userRole === 'SUPERADMIN';

  // State to toggle between superadmin view and previewing an ambassador
  let previewAmbassadorId = null;

  // Páginas dos históricos (só uma página é desenhada de cada vez -> rápido)
  let storesPage = 1;
  let storesQuery = '';
  let commPage = 1;
  let payoutsPage = 1;
  let superPage = 1;
  let superQuery = '';

  const money = (n) => Number(n || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2 });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('pt-PT');
  };
  const fmtDateTime = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleString('pt-PT');
  };

  const subscriptionBadge = (status) => {
    switch (status) {
      case 'ATIVA': return '<span class="badge badge-emerald">✓ ATIVA / EM DIA</span>';
      case 'EM_TESTE': return '<span class="badge badge-blue">EM TESTE · 1º pagamento pendente</span>';
      case 'EXPIRADA': return '<span class="badge badge-red">✕ EXPIRADA</span>';
      case 'BLOQUEADA': return '<span class="badge badge-red">⛔ BLOQUEADA</span>';
      default: return '<span class="badge badge-amber">SEM LOJA ASSOCIADA</span>';
    }
  };

  const daysText = (days) => {
    if (days === null || days === undefined) return '—';
    const d = Number(days);
    if (d > 1) return `${d} dias restantes`;
    if (d === 1) return '1 dia restante';
    if (d === 0) return 'Vence hoje';
    return `Expirou há ${Math.abs(d)} dia(s)`;
  };

  const statusBadgeAmb = (status) =>
    status === 'BLOQUEADO'
      ? '<span class="badge badge-red" style="font-size: 9px;">BLOQUEADO</span>'
      : status === 'DESATIVADO'
        ? '<span class="badge badge-amber" style="font-size: 9px;">DESATIVADO</span>'
        : '<span class="badge badge-emerald" style="font-size: 9px;">ATIVO</span>';

  /**
   * Gera o endereço correto da página pública de adesão.
   *
   * Funciona em:
   * - Cloudflare
   * - Vercel
   * - GitHub Pages
   *
   * Não fica preso ao domínio https://gef.co.mz.
   */
  const getReferralLink = (ambassadorCode) => {
    const code = encodeURIComponent(ambassadorCode || '');

    // Link FIXO: se SITE_URL estiver definido em js/config.js, é sempre este endereço,
    // venha o painel de onde vier. O código nunca muda (protegido no banco).
    const fixedBase = String(SITE_URL || '').trim().replace(/\/+$/, '').replace(/\/adesao\.html.*$/, '');
    if (fixedBase) {
      return `${fixedBase}/adesao.html?embaixador=${code}`;
    }

    let basePath = '/';

    try {
      const pathname = window.location.pathname || '/';

      // Se estiver em /repo/ ou /repo/index.html,
      // preserva /repo/ para GitHub Pages.
      if (pathname.endsWith('/')) {
        basePath = pathname;
      } else {
        const lastSlash = pathname.lastIndexOf('/');

        basePath = lastSlash >= 0
          ? pathname.substring(0, lastSlash + 1)
          : '/';
      }

      if (!basePath.startsWith('/')) {
        basePath = '/' + basePath;
      }

    } catch (error) {
      console.warn(
        'Não foi possível determinar o caminho base:',
        error
      );

      basePath = '/';
    }

    return `${window.location.origin}${basePath}adesao.html?embaixador=${code}`;
  };

  /**
   * Copia texto para o clipboard.
   * Usa Clipboard API quando disponível e fallback
   * para navegadores onde ela não estiver disponível.
   */
  const copyTextToClipboard = async (text) => {
    if (!text) {
      return false;
    }

    try {
      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn(
        'Clipboard API indisponível. Tentando método alternativo:',
        error
      );
    }

    try {
      const textarea =
        document.createElement('textarea');

      textarea.value = text;

      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.opacity = '0';

      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(
        0,
        textarea.value.length
      );

      const copied =
        document.execCommand('copy');

      textarea.remove();

      return copied;

    } catch (error) {
      console.error(
        'Falha no método alternativo de cópia:',
        error
      );

      return false;
    }
  };

  // Falha ao carregar o painel: mostra o motivo e mantém a actualização automática a tentar de novo.
  const renderLoadError = (message) => {
    container.innerHTML = `
      <div class="card" data-amb-root style="max-width: 640px; margin: 40px auto; text-align: center; padding: 32px 24px; border-color: #f59e0b;">
        <h2 style="font-size: 17px; font-weight: 800; color: #fde68a; margin: 0 0 8px 0;">Não foi possível carregar os seus dados agora</h2>
        <p style="font-size: 12px; color: #cbd5e1; line-height: 1.6; margin: 0 0 6px 0;">O painel volta a tentar sozinho. Se continuar, contacte o administrador.</p>
        <p style="font-size: 11px; color: #94a3b8; margin: 0 0 14px 0; font-family: var(--font-mono);">${esc(message)}</p>
        <button class="btn btn-primary" id="btn-amb-retry" style="padding: 8px 16px; font-size: 12px;">Tentar novamente</button>
      </div>
    `;
    const retry = container.querySelector('#btn-amb-retry');
    if (retry) retry.onclick = () => { render().catch((e) => console.warn('[GEF]', e)); };
  };

  // ---- Último estado bom do painel (só leitura): mantém a informação visível se uma actualização falhar ----
  let lastGood = null;
  let profileIsSuper = false; // v7: perfil efectivo (decidido no servidor) para o título do painel
  const snapKey = () => 'gef_amb_snapshot_v1_' + (currentUser?.id || 'anon');
  const readSnapshot = () => {
    try {
      const raw = window.localStorage.getItem(snapKey());
      const snap = raw ? JSON.parse(raw) : null;
      return snap && snap.amb && snap.tracking ? snap : null;
    } catch (e) { return null; }
  };
  const saveSnapshot = (snap) => {
    try { window.localStorage.setItem(snapKey(), JSON.stringify(snap)); } catch (e) { /* sem espaço/privado: ignora */ }
  };

  // Converte a resposta de fn_ambassador_portal para a forma que o painel já desenha.
  const fromPortal = (p) => {
    const a = p.ambassador || {};
    const stores = Array.isArray(p.stores) ? p.stores : [];
    const payoutRows = Array.isArray(p.payouts) ? p.payouts : [];
    const status = db._normalizeAmbassadorStatus(a.status, a.active);

    const payoutHistory = payoutRows.map((po) => ({
      id: po.id,
      ambassadorId: a.id,
      amount: Number(po.amount || 0),
      method: po.method || '',
      receipt: po.receipt || '',
      status: po.status || '',
      createdAt: po.created_at,
      date: po.created_at ? new Date(po.created_at).toLocaleString('pt-PT') : ''
    }));

    const amb = {
      id: a.id,
      userId: a.user_id,
      name: a.name || '',
      phone: a.phone || '',
      pixMpesa: a.pix_mpesa || '',
      paymentDetails: a.pix_mpesa || '',
      code: a.referral_code || '',
      isSuper: !!a.is_super,
      commissionRate: Number(a.commission_rate || 0),
      totalEarned: Number(a.total_earned || 0),
      pendingCommissions: Number(p.available_commission ?? a.pending_commissions ?? 0),
      paidCommissions: Number(p.paid_commission || 0),
      status,
      active: status !== 'DESATIVADO',
      createdAt: a.created_at,
      referredStores: [],
      registeredStores: [],
      payoutHistory,
      totalStores: stores.length,
      activeStores: stores.filter(s => s.subscription_status === 'ATIVA').length
    };

    const tracking = {
      ambassador_id: a.id,
      stores,
      payments: Array.isArray(p.payments) ? p.payments : [],
      total_commission_generated: Number(p.total_commission_generated || 0),
      available_commission: Number(p.available_commission ?? a.pending_commissions ?? 0),
      paid_commission: Number(p.paid_commission || 0),
      warnings: Array.isArray(p.warnings) ? p.warnings : []
    };

    return { amb, tracking, trackingError: null, partial: false };
  };

  // Carrega os dados do painel do embaixador.
  //  1) fn_ambassador_portal (caminho robusto, uma só chamada);
  //  2) se ainda não estiver instalada, o caminho antigo (tabelas + fn_ambassador_tracking).
  const loadAmbassadorData = async () => {
    let portalError = null;
    try {
      const portal = await db.getAmbassadorPortal(previewAmbassadorId || null);
      if (portal && portal.ok === false && portal.code === 'BLOCKED') return { blocked: true, reason: portal.reason || null };
      if (portal && portal.ok === false) return { notLinked: true, authoritative: true };
      if (portal && portal.ok) return fromPortal(portal);
    } catch (err) {
      portalError = err;
      console.warn('[GEF] fn_ambassador_portal falhou; a tentar o caminho antigo:', err);
    }

    let trackingError = portalError ? (portalError.message || String(portalError)) : null;
    const [ambassadors, tracking] = await Promise.all([
      db.getAmbassadors(),
      db.getAmbassadorTracking(previewAmbassadorId || null).catch((err) => {
        console.warn('[GEF] Acompanhamento do embaixador falhou:', err);
        trackingError = err?.message || String(err);
        return null;
      })
    ]);

    const myProfile = previewAmbassadorId
      ? (ambassadors.find(a => a.id === previewAmbassadorId) || ambassadors[0])
      : (ambassadors.find(a => a.userId && a.userId === currentUser?.id) || ambassadors[0]);

    if (!myProfile) return { notLinked: true };

    return {
      amb: myProfile,
      tracking,
      trackingError: tracking ? null : trackingError,
      partial: !tracking
    };
  };

  const render = async () => {
    // Role-based visibility enforcement
    if (!isSuperadmin && userRole !== 'EMBAIXADOR') {
      container.innerHTML = `
        <div class="card" style="max-width: 600px; margin: 40px auto; text-align: center; padding: 36px 24px;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; color: #f87171;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h2 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin: 0 0 8px 0;">Módulo de Acesso Restrito</h2>
          <p style="font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 0 0 20px 0;">
            O Portal de Embaixadores é reservado exclusivamente a parceiros credenciados e à administração central da plataforma. O seu perfil atual (<strong>${userRole}</strong>) visualiza apenas as rotinas pertinentes à sua função.
          </p>
          <div style="font-size: 11px; color: #64748b;">
            Utilize o menu lateral para acessar os módulos da sua loja.
          </div>
        </div>
      `;
      return;
    }

    // Super Admin (vista geral): inalterado.
    if (isSuperadmin && !previewAmbassadorId) {
      const ambassadors = await db.getAmbassadors();
      renderSuperadminView(container, ambassadors);
      return;
    }

    // Embaixador (ou Super Admin a pré-visualizar um embaixador)
    // v7: o servidor decide o perfil efectivo, o bloqueio, o idioma/moeda e o contacto do Super Embaixador.
    let ctx = null;
    if (!isSuperadmin) {
      ctx = await loadContext();
      if (ctx && ctx.blocked) {
        lastGood = null;
        try { window.localStorage.removeItem(snapKey()); } catch (e) { /* ignora */ }
        purgeLocalAmbassadorData();
        renderBlocked(container, ctx.reason);
        return;
      }
      applyContextPrefs(ctx);
      profileIsSuper = !!(ctx && ctx.is_super);
    } else if (previewAmbassadorId) {
      try {
        const all = await db.getAmbassadors();
        profileIsSuper = !!(all.find((x) => x.id === previewAmbassadorId) || {}).isSuper;
      } catch (e) { profileIsSuper = false; }
    }
    let data = null;
    let loadError = null;
    try {
      data = await loadAmbassadorData();
    } catch (err) {
      loadError = err;
      console.warn('[GEF] Não foi possível carregar o painel do embaixador:', err);
    }

    if (data && data.blocked) {
      lastGood = null;
      try { window.localStorage.removeItem(snapKey()); } catch (e) { /* ignora */ }
      purgeLocalAmbassadorData();
      renderBlocked(container, data.reason);
      return;
    }

    // "Sem perfil" vindo do caminho antigo pode ser só uma falha temporária: nunca apaga o que já se sabe.
    if (data && data.notLinked && !data.authoritative && (lastGood || (!previewAmbassadorId && readSnapshot()))) {
      data = null;
      loadError = new Error('Não foi possível confirmar o seu cadastro agora.');
    }

    if (data && data.notLinked) {
      container.innerHTML = `
        <div class="card" data-amb-root style="max-width: 600px; margin: 40px auto; text-align: center; padding: 36px 24px;">
          <h2 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin: 0 0 8px 0;">
            Perfil de Embaixador não encontrado
          </h2>
          <p style="font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 0;">
            Não foi encontrado um cadastro de embaixador associado a este login.
            Peça ao administrador para confirmar que o seu acesso está ligado ao seu cadastro de embaixador.
          </p>
        </div>
      `;
      return;
    }

    const previous = previewAmbassadorId
      ? (lastGood && lastGood.amb && lastGood.amb.id === previewAmbassadorId ? lastGood : null)
      : (lastGood || readSnapshot());

    // Dados parciais (só o caminho antigo, sem acompanhamento) nunca substituem um estado completo já conhecido.
    if (data && data.partial && previous && previous.tracking) {
      data = null;
      loadError = loadError || new Error('Detalhes de subscrição temporariamente indisponíveis.');
    }

    if (data) {
      if (!data.partial) {
        lastGood = { amb: data.amb, tracking: data.tracking, savedAt: Date.now() };
        if (!previewAmbassadorId) saveSnapshot(lastGood);
      }
      renderAmbassadorPortal(container, data.amb, isSuperadmin, data.tracking, data.trackingError, null);
      if (ctx) await mountAmbassadorExtras(container, ctx).catch((e) => console.warn('[GEF] extras:', e));
      return;
    }

    // Falhou e já há informação conhecida: mantém-na visível (nunca deixa o painel vazio).
    if (previous) {
      renderAmbassadorPortal(
        container,
        previous.amb,
        isSuperadmin,
        previous.tracking,
        null,
        { savedAt: previous.savedAt, message: loadError?.message || '' }
      );
      if (ctx) await mountAmbassadorExtras(container, ctx).catch((e) => console.warn('[GEF] extras:', e));
      return;
    }

    renderLoadError(loadError?.message || 'Erro desconhecido');
  };

  // --- 1. VISÃO DO EMBAIXADOR (PORTAL DO PARCEIRO) ---
  const renderAmbassadorPortal = (
    target,
    amb,
    isSuperadminSimulating = false,
    tracking = null,
    trackingError = null,
    stale = null
  ) => {
    const isBlocked = amb.status === 'BLOQUEADO' || amb.status === 'DESATIVADO';

    // Acompanhamento real (subscrição + comissão por pagamento). Sem a migração, cai para os dados básicos.
    const trackedStores = tracking && Array.isArray(tracking.stores) ? tracking.stores : null;
    const commissionPayments = tracking && Array.isArray(tracking.payments) ? tracking.payments : [];
    const totalCommissionGenerated = Number(tracking?.total_commission_generated || 0);

    // Plano B: se o acompanhamento falhar, as lojas vinculadas ao embaixador continuam a aparecer
    // (lidas directamente da tabela, já filtradas por RLS) com o estado deduzido do último pagamento.
    const daysUntil = (d) => {
      if (!d) return null;
      const t = new Date(String(d).slice(0, 10) + 'T00:00:00');
      if (isNaN(t.getTime())) return null;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return Math.round((t.getTime() - today.getTime()) / 86400000);
    };
    const fallbackStores = (amb.registeredStores || []).map((r) => {
      const ps = String(r.paymentStatus || '').toUpperCase();
      return {
        id: r.id,
        name: r.name,
        owner_name: r.ownerName,
        phone: r.phone,
        city: r.city,
        address: '',
        province: '',
        admin_email: '',
        created_at: r.registeredAt,
        monthly_fee: r.monthlyFee,
        commission_rate: r.commissionRate,
        contract_duration_months: r.contractDurationMonths,
        months_active: r.monthsActive,
        has_store: true,
        fallback: true,
        subscription_status: ps === 'ATRASADO' ? 'EXPIRADA' : (ps === 'PAGO' ? 'ATIVA' : 'EM_TESTE'),
        subscription_end: r.nextDueDate,
        days_remaining: daysUntil(r.nextDueDate),
        last_payment_date: r.lastPaymentDate,
        payments_count: 0,
        total_commission: r.totalCommissionEarned
      };
    });
    const tableStores = trackedStores || fallbackStores;

    const stores = tableStores;

    const storesInGoodStanding = tableStores.filter(s => s.subscription_status === 'ATIVA' || s.subscription_status === 'EM_TESTE').length;

    const storesQ = normalizeText(storesQuery);
    const storesFiltered = !storesQ ? tableStores : tableStores.filter((s) => normalizeText(
      [s.name, s.owner_name, s.phone, s.city, s.subscription_status].join(' ')).includes(storesQ));
    const storesPageInfo = paginate(storesFiltered, storesPage, 10);
    storesPage = storesPageInfo.page;
    const commPageInfo = paginate(commissionPayments, commPage, 15);
    commPage = commPageInfo.page;
    const payoutsPageInfo = paginate(amb.payoutHistory || [], payoutsPage, 15);
    payoutsPage = payoutsPageInfo.page;

    const payouts =
      amb.payoutHistory || [];

    const activeStores = storesInGoodStanding;

    const pendingCommissions =
      Number(
        amb.pendingCommissions || 0
      );

    const paidCommissions =
      Number(
        amb.paidCommissions || 0
      );

    const referralLink =
      getReferralLink(amb.code);

    // WhatsApp + notificações: só a partir de dados reais já carregados (lojas, pagamentos, liquidações)
    const whatsappUrl = whatsappShareUrl(referralLink, amb.name);
    const notifications = buildNotifications({
      stores: tableStores,
      payments: commissionPayments,
      payouts: payouts.map((p) => ({ id: p.id, amount: p.amount, method: p.method, created_at: p.createdAt }))
    });
    const notifColor = { danger: '#ef4444', warning: '#f59e0b', success: '#10b981', info: '#3b82f6' };

    // ---- Indicadores de subscrição e comissão (só dados de subscrição/comissão) ----
    const num = (v) => Number(v || 0);
    const perCycle = (s) => num(s.monthly_fee) * num(s.commission_rate) / 100;
    const inContract = (s) => num(s.contract_duration_months) >= 999 || num(s.months_active) < num(s.contract_duration_months || 12);
    const hasDays = (s) => s.days_remaining !== null && s.days_remaining !== undefined;
    const isBlockedStore = (s) => s.subscription_status === 'BLOQUEADA';
    const isOverdue = (s) => s.subscription_status === 'EXPIRADA';
    const isDueSoon = (s) => !isBlockedStore(s) && !isOverdue(s) && s.subscription_status !== 'SEM_LOJA' && hasDays(s) && num(s.days_remaining) >= 0 && num(s.days_remaining) <= 7;
    const isRegular = (s) => (s.subscription_status === 'ATIVA' || s.subscription_status === 'EM_TESTE') && !isDueSoon(s);

    const allStoresTracked = tableStores;
    const cntRegular = allStoresTracked.filter(isRegular).length;
    const cntOverdue = allStoresTracked.filter(isOverdue).length;
    const cntBlocked = allStoresTracked.filter(isBlockedStore).length;
    const cntDueSoon = allStoresTracked.filter(isDueSoon).length;

    const availableCommission = tracking && tracking.available_commission !== undefined && tracking.available_commission !== null
      ? num(tracking.available_commission) : pendingCommissions;
    const receivedCommission = tracking && tracking.paid_commission !== undefined && tracking.paid_commission !== null
      ? num(tracking.paid_commission) : paidCommissions;
    // Pendente: comissão que ainda vai ser gerada quando as lojas em teste/atrasadas pagarem.
    const awaitingCommission = allStoresTracked
      .filter(s => (s.subscription_status === 'EM_TESTE' || isOverdue(s)) && inContract(s))
      .reduce((sum, s) => sum + perCycle(s), 0);
    // Previsão (30 dias): lojas não bloqueadas, dentro da vigência, que vencem em ≤ 30 dias ou já vencidas.
    const forecastCommission = allStoresTracked
      .filter(s => s.has_store && !isBlockedStore(s) && inContract(s) && hasDays(s) && num(s.days_remaining) <= 30)
      .reduce((sum, s) => sum + perCycle(s), 0);

    const metricCard = (label, value, color, hint, unit = '') => `
      <div class="card">
        <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">${label}</div>
        <div style="font-size: 24px; font-weight: 900; color: ${color}; font-family: var(--font-mono); margin-top: 4px;">
          ${value}${unit ? ` <span style="font-size: 12px;">${unit}</span>` : ''}
        </div>
        <div style="font-size: 10px; color: #64748b; margin-top: 2px;">${hint}</div>
      </div>`;

    target.innerHTML = `
      <div data-amb-root style="display: flex; flex-direction: column; gap: 16px;">
        ${isSuperadminSimulating ? `
          <!-- Bar when Super Admin is simulating ambassador view -->
          <div class="card" style="background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; display: flex; justify-content: space-between; align-items: center; padding: 10px 16px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #fed7aa; font-weight: 700;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
              <span>Visualizando como Embaixador: <strong>${amb.name}</strong> (${amb.code})</span>
            </div>
            <button class="btn btn-secondary" id="btn-exit-preview" style="padding: 4px 10px; font-size: 11px;">
              Voltar ao Painel Super Admin
            </button>
          </div>
        ` : ''}

        <!-- Header Card -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 11px; font-weight: 800; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.5px;">
                Programa Oficial de Embaixadores & Expansão SaaS GEF
              </div>
              <h2 style="font-size: 18px; font-weight: 900; color: #f8fafc; margin: 2px 0 0 0;">
                ${(profileIsSuper || amb.isSuper) ? 'Painel do Super Embaixador' : 'Painel do Embaixador'}: ${esc(amb.name)}
              </h2>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Cadastre novas lojas e receba comissão recorrente durante toda a vigência do contrato.
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="badge badge-emerald">PARCEIRO CREDENCIADO</span>
            </div>
          </div>
        </div>

        ${isBlocked ? `
          <div class="card" style="background: rgba(239, 68, 68, 0.12); border: 1px solid #ef4444; padding: 12px 16px; font-size: 12px; color: #fecaca; font-weight: 700;">
            ⛔ A sua conta de embaixador está ${amb.status === 'BLOQUEADO' ? 'bloqueada' : 'desativada'}. Não é possível criar lojas nem utilizadores. Contacte o administrador.
          </div>
        ` : ''}

        <!-- Ambassador Credentials & Details Card -->
        <div class="card" style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border-color: #3b82f6;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
            <div>
              <div style="font-size: 11px; color: #93c5fd; font-weight: 700; text-transform: uppercase;">
                Seu Código de Embaixador Oficial:
              </div>
              <div style="font-size: 24px; font-weight: 900; color: #ffffff; font-family: var(--font-mono); letter-spacing: 1px; margin: 4px 0;">
                ${amb.code}
              </div>
              <div style="font-size: 11px; color: #cbd5e1;">
                Taxa de comissão contratada: <strong style="color: #34d399;">${amb.commissionRate}%</strong> sobre a mensalidade de cada loja cadastrada.
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Destino das liquidações: <strong style="color: #f8fafc;">${amb.paymentDetails || 'M-Pesa (+258 84 764 0849)'}</strong>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="font-size: 11px; color: #94a3b8;">
                Link de credenciamento do embaixador:
              </div>

              <div style="display: flex; gap: 8px;">
                <input
                  type="text"
                  readonly
                  value="${referralLink}"
                  id="inp-ref-link"
                  style="font-size: 11px; width: 280px; font-family: var(--font-mono); background: #020617; border-color: #334155; color: #93c5fd;"
                >

                <button
                  class="btn btn-primary"
                  id="btn-copy-ref-link"
                  style="padding: 6px 14px; font-size: 11px;"
                >
                  Copiar Link
                </button>

                <a
                  class="btn btn-secondary"
                  id="btn-share-whatsapp"
                  href="${whatsappUrl}"
                  target="_blank"
                  rel="noopener"
                  style="padding: 6px 14px; font-size: 11px; text-decoration: none;"
                >
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>

        ${!trackedStores ? `
          <div class="card" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 12px 16px; font-size: 12px; color: #fde68a;">
            Os detalhes de subscrição (dias restantes, bloqueio) estão temporariamente indisponíveis; está a ver o estado registado de cada loja e volta a tentar sozinho.
            ${trackingError ? `<div style="margin-top: 4px; font-size: 11px; color: #fcd34d; font-family: var(--font-mono);">${esc(trackingError)}</div>` : ''}
            <div style="margin-top: 4px; font-size: 11px; color: #fcd34d;">Se persistir, o administrador deve executar <strong>migracao_embaixadores_v4.sql</strong> no Supabase.</div>
          </div>
        ` : ''}

        ${stale ? `
          <div class="card" data-amb-stale style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 12px 16px; font-size: 12px; color: #fde68a;">
            Sem ligação aos dados em tempo real. Está a ver a última informação guardada (${fmtDateTime(stale.savedAt)}); o painel volta a tentar sozinho.
            ${stale.message ? `<div style="margin-top: 4px; font-size: 11px; color: #fcd34d; font-family: var(--font-mono);">${esc(stale.message)}</div>` : ''}
          </div>
        ` : ''}

        ${tracking && Array.isArray(tracking.warnings) && tracking.warnings.length ? `
          <div class="card" data-amb-warning style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 12px 16px; font-size: 12px; color: #fde68a;">
            Parte da informação não pôde ser lida agora e pode estar incompleta.
            <div style="margin-top: 4px; font-size: 11px; color: #fcd34d; font-family: var(--font-mono);">${esc(tracking.warnings.join(' | '))}</div>
          </div>
        ` : ''}

        <!-- Notificações (derivadas dos dados reais; últimos 30 dias) -->
        <div class="card" id="amb-notifications">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
            <div>
              <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">Notificações</h3>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Novas adesões, alterações de estado, comissões e liquidações.</div>
            </div>
            <span class="badge badge-blue">${notifications.length}</span>
          </div>
          ${notifications.length === 0 ? `
            <div style="font-size: 12px; color: #64748b; padding: 8px 0;">Sem novidades nos últimos 30 dias.</div>
          ` : `
            <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px;">
              ${notifications.map(n => `
                <li style="padding: 8px 12px; border: 1px solid ${notifColor[n.type] || '#334155'}55; border-left: 3px solid ${notifColor[n.type] || '#334155'}; border-radius: 6px; background: rgba(15, 23, 42, 0.6);">
                  <div style="font-size: 12px; font-weight: 800; color: #f8fafc;">${esc(n.title)}</div>
                  <div style="font-size: 11px; color: #cbd5e1;">${esc(n.detail)}${n.at ? ` · ${fmtDate(n.at)}` : ''}</div>
                </li>
              `).join('')}
            </ul>
          `}
        </div>

        <!-- Situação das lojas -->
        <div class="metrics-grid">
          ${metricCard('Lojas Cadastradas por Mim', stores.length, '#f8fafc', 'Total de lojas vinculadas a si')}
          ${metricCard('Lojas Regulares', cntRegular, '#34d399', 'Subscrição em dia')}
          ${metricCard('Próximas do Vencimento', cntDueSoon, cntDueSoon > 0 ? '#fbbf24' : '#34d399', 'Vencem em até 7 dias')}
          ${metricCard('Lojas Atrasadas', cntOverdue, cntOverdue > 0 ? '#f87171' : '#34d399', 'Subscrição expirada')}
          ${metricCard('Lojas Bloqueadas', cntBlocked, cntBlocked > 0 ? '#f87171' : '#34d399', 'Acesso suspenso pela administração')}
        </div>

        <!-- Comissões -->
        <div class="metrics-grid">
          ${metricCard('Comissão Disponível', money(availableCommission), availableCommission === 0 ? '#34d399' : '#fbbf24', availableCommission === 0 ? '✓ Nada por liquidar' : 'Gerada e a aguardar liquidação', 'MT')}
          ${metricCard('Comissão Pendente', money(awaitingCommission), '#fbbf24', 'Quando as lojas em teste/atrasadas pagarem', 'MT')}
          ${metricCard('Comissão Recebida', money(receivedCommission), '#60a5fa', 'Já liquidada via M-Pesa / Banco', 'MT')}
          ${metricCard('Previsão (30 dias)', money(forecastCommission), '#a78bfa', 'Renovações esperadas no próximo mês', 'MT')}
          ${metricCard('Comissão Total Gerada', money(totalCommissionGenerated), '#34d399', 'Soma de todos os pagamentos lançados', 'MT')}
        </div>

        <!-- Contacto da administração -->
        <div class="card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Contacto da Administração</div>
            <div style="font-size: 14px; font-weight: 800; color: #f8fafc; margin-top: 4px;">${esc(ADMIN_CONTACT.name)}</div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 2px;">
              ${ADMIN_CONTACT.phone ? `📞 ${esc(ADMIN_CONTACT.phone)}` : ''}
              ${ADMIN_CONTACT.email ? ` · ✉ ${esc(ADMIN_CONTACT.email)}` : ''}
              ${ADMIN_CONTACT.location ? ` · 📍 ${esc(ADMIN_CONTACT.location)}` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${ADMIN_CONTACT.whatsapp ? `<a class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px; text-decoration: none;" href="https://wa.me/${esc(String(ADMIN_CONTACT.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            ${ADMIN_CONTACT.phone ? `<a class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px; text-decoration: none;" href="tel:${esc(String(ADMIN_CONTACT.phone).replace(/\s+/g, ''))}">Ligar</a>` : ''}
          </div>
        </div>

        <!-- FORM: Criar loja real + administrador -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #1f2937; padding-bottom: 10px; flex-wrap: wrap; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 15px; font-weight: 800; color: #f8fafc; margin: 0;">
                Criar Nova Loja
              </h3>
            </div>
            <span style="font-size: 11px; color: #94a3b8;">A loja e o seu administrador ficam prontos a usar (30 dias de teste). Depois de criada, só o Super Admin a pode alterar.</span>
          </div>

          <form id="form-add-referred-store" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Tipo de negócio: * (acompanha o pedido e carrega a configuração do sector)</label>
                <select id="sel-ns-bt" required style="width: 100%;" ${isBlocked ? 'disabled' : ''}><option value="">A carregar…</option></select>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Nome da Loja / Negócio: *</label>
                <input type="text" id="inp-ns-name" placeholder="Ex: Progresso da Beira, Lda" required style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Nome do Proprietário / Responsável: *</label>
                <input type="text" id="inp-ns-owner" placeholder="Ex: Armando Macamo" required style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Telefone / WhatsApp: *</label>
                <input type="text" id="inp-ns-phone" placeholder="+258 84 000 0000" required style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Cidade / Província: *</label>
                <input type="text" id="inp-ns-city" placeholder="Ex: Beira, Sofala" required style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Telemóvel do Administrador da Loja (é com ele que entra): *</label>
                <input type="tel" inputmode="tel" id="inp-ns-email" required autocomplete="off" style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Palavra-passe do Administrador: * (mín. 8)</label>
                <input type="text" id="inp-ns-pass" placeholder="Defina uma palavra-passe" required minlength="8" autocomplete="off" style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Plano da Mensalidade SaaS: *</label>
                <select id="sel-ns-plan" style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
                  <option value="2500">Plano Básico – 2.500,00 MT/mês</option>
                  <option value="3500" selected>Plano Profissional – 3.500,00 MT/mês</option>
                  <option value="4500">Plano Empresarial – 4.500,00 MT/mês</option>
                  <option value="6000">Plano Rede Multi-Lojas – 6.000,00 MT/mês</option>
                  <option value="300">Pacote 300,00 MT/mês</option>
                  <option value="500">Pacote 500,00 MT/mês</option>
                  <option value="750">Pacote 750,00 MT/mês</option>
                  <option value="1000">Pacote 1000,00 MT/mês</option>
                </select>
              </div>

              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Tempo de Vigência da Comissão: *</label>
                <select id="sel-ns-duration" style="width: 100%;" ${isBlocked ? 'disabled' : ''}>
                  <option value="12" selected>12 Meses</option>
                  <option value="24">24 Meses</option>
                  <option value="36">36 Meses</option>
                  <option value="999">Vitalício (enquanto a loja pagar)</option>
                </select>
              </div>

              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Sua Comissão por Pagamento Mensal:</label>
                <div id="disp-calc-commission" style="font-size: 14px; font-weight: 800; color: #34d399; font-family: var(--font-mono); padding: 8px 12px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
                  ${money(3500 * Number(amb.commissionRate || 0) / 100)} MT / mês (${amb.commissionRate}%)
                </div>
              </div>

              <div style="display: flex; align-items: flex-end;">
                <button type="submit" class="btn btn-primary" id="btn-save-new-store" style="width: 100%; padding: 10px 16px; font-weight: 800; background: #10b981; border-color: #10b981;" ${isBlocked ? 'disabled' : ''}>
                  + Criar Loja e Administrador
                </button>
              </div>
            </div>
          </form>
        </div>

        <!-- TABLE: Acompanhamento das lojas -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 14px 16px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
                Lojas Criadas por Mim · Subscrição & Comissão
              </h3>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Estado da subscrição, dias restantes e comissão recebida por loja. Dados internos da loja (vendas, stock, clientes) não são visíveis.
              </div>
            </div>
            <span class="badge badge-blue">${stores.length} LOJAS</span>
          </div>

          <div style="padding: 10px 14px; border-bottom: 1px solid #1f2937; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <input type="search" id="inp-stores-search" value="${esc(storesQuery)}" placeholder="Pesquisar loja, responsável, telefone, cidade, estado…" style="flex: 1 1 260px; max-width: 460px;">
            <span style="font-size: 11px; color: #94a3b8;">${storesQ ? `${storesFiltered.length} de ${tableStores.length}` : ''}</span>
          </div>

          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Subscrição</th>
                  <th>Vence em</th>
                  <th>Mensalidade</th>
                  <th>Pagamentos</th>
                  <th>Comissão (taxa)</th>
                  <th>Comissão por Pagamento</th>
                  <th>Comissão Recebida</th>
                  <th style="text-align: right;">Utilizadores</th>
                </tr>
              </thead>
              <tbody>
                ${storesPageInfo.rows.length === 0 ? `
                  <tr>
                    <td colspan="9" style="text-align: center; color: #64748b; padding: 28px;">
                      ${storesQ ? 'Nenhuma loja encontrada para esta pesquisa.' : 'Nenhuma loja criada ainda. Utilize o formulário acima para criar a sua primeira loja.'}
                    </td>
                  </tr>
                ` : storesPageInfo.rows.map(s => {
                  const days = s.days_remaining;
                  const urgent = days !== null && days !== undefined && Number(days) <= 7;
                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 800; color: #f8fafc;">${esc(s.name)}</div>
                        <div style="font-size: 11px; color: #94a3b8;">
                          ${esc(s.owner_name || '')} ${s.phone ? '· ' + esc(s.phone) : ''} · ${esc(s.city || '')}
                        </div>
                        <div style="font-size: 10px; color: #64748b;">Criada em ${fmtDate(s.created_at)}</div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">📍 ${esc([s.address, s.city, s.province].filter(Boolean).join(', ') || '—')}</div>
                        ${s.admin_email ? `<div style="font-size: 10px; color: #94a3b8;">Admin da loja: ${esc(displayLogin(s.admin_email))}</div>` : ''}
                      </td>
                      <td>${subscriptionBadge(s.subscription_status)}</td>
                      <td>
                        <div style="font-weight: 700; color: ${urgent ? '#f87171' : '#cbd5e1'}; font-size: 12px;">${daysText(days)}</div>
                        <div style="font-size: 10px; color: #94a3b8;">${s.subscription_end ? 'até ' + fmtDate(s.subscription_end) : ''}</div>
                      </td>
                      <td style="font-family: var(--font-mono); font-weight: 700; color: #f8fafc;">${money(s.monthly_fee)} MT</td>
                      <td>
                        <div style="font-weight: 800; color: #f8fafc;">${Number(s.payments_count || 0)}</div>
                        <div style="font-size: 10px; color: #94a3b8;">${s.last_payment_date ? 'Último: ' + fmtDate(s.last_payment_date) : 'Sem pagamentos'}</div>
                      </td>
                      <td>
                        <div style="font-weight: 800; color: #60a5fa;">${Number(s.commission_rate || 0)}%</div>
                        <div style="font-size: 10px; color: #94a3b8;">${Number(s.contract_duration_months) >= 999 ? 'vitalício' : (s.months_active || 0) + '/' + (s.contract_duration_months || 12) + ' meses'}</div>
                      </td>
                      <td style="font-family: var(--font-mono); font-weight: 700; color: #cbd5e1;">${money(perCycle(s))} MT</td>
                      <td style="font-family: var(--font-mono); font-weight: 900; color: #34d399;">${money(s.total_commission)} MT</td>
                      <td style="text-align: right;">
                        ${s.has_store && !s.fallback && !isBlocked && !isSuperadminSimulating ? `
                          <button type="button" class="btn btn-secondary btn-add-store-user" data-id="${esc(s.id)}" data-name="${esc(s.name)}" style="padding: 4px 9px; font-size: 10px;">
                            + Utilizador
                          </button>
                        ` : '<span style="font-size: 10px; color: #64748b;">—</span>'}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${renderPager(storesPageInfo, 'amb-stores')}
        </div>

        <!-- TABLE: Comissão por pagamento -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 14px 16px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
                Pagamentos Lançados & Comissão Recebida
              </h3>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Cada vez que o Super Admin lança um pagamento de subscrição de uma loja sua, a sua comissão aparece aqui.
              </div>
            </div>
            <span class="badge badge-emerald">TOTAL ${money(totalCommissionGenerated)} MT</span>
          </div>

          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Loja</th>
                  <th>Período</th>
                  <th>Pagamento da Loja</th>
                  <th>Taxa</th>
                  <th>Sua Comissão</th>
                </tr>
              </thead>
              <tbody>
                ${commPageInfo.rows.length === 0 ? `
                  <tr>
                    <td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">
                      Ainda não há pagamentos lançados nas suas lojas.
                    </td>
                  </tr>
                ` : commPageInfo.rows.map(p => `
                  <tr>
                    <td style="font-size: 11px; color: #cbd5e1;">${fmtDateTime(p.paid_at)}</td>
                    <td style="font-weight: 700; color: #f8fafc;">${esc(p.store_name || '')}</td>
                    <td style="font-size: 11px; color: #94a3b8;">+${Number(p.days_added || 30)} dias</td>
                    <td style="font-family: var(--font-mono); color: #cbd5e1;">${money(p.payment_amount)} MT</td>
                    <td style="font-family: var(--font-mono); color: #60a5fa;">${Number(p.commission_rate || 0)}%</td>
                    <td style="font-family: var(--font-mono); font-weight: 900; color: #34d399;">+${money(p.commission_amount)} MT</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${renderPager(commPageInfo, 'amb-comm')}
        </div>

        <!-- TABLE: Extrato de Pagamentos Realizados pelo Super Admin -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 14px 16px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
                Extrato de Comissões Pagas pelo Super Administrador
              </h3>

              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Histórico de transferências liquidadas e comprovantes gerados pelo Super Admin.
              </div>
            </div>

            <span class="badge badge-emerald">
              ${payouts.length} LIQUIDAÇÕES
            </span>
          </div>

          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nº da Liquidação</th>
                  <th>Data & Hora</th>
                  <th>Valor Pago</th>
                  <th>Forma de Transferência</th>
                  <th>Recibo / Comprovante</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                ${payouts.length === 0 ? `
                  <tr>
                    <td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">
                      Nenhuma liquidação registrada ainda.
                    </td>
                  </tr>
                ` : payoutsPageInfo.rows.map(p => {

                  const amount =
                    Number(p.amount || 0);

                  return `
                    <tr>
                      <td>
                        <strong>${p.id}</strong>
                      </td>

                      <td style="font-size: 11px; color: #cbd5e1;">
                        ${p.date}
                      </td>

                      <td style="color: #34d399; font-weight: 900; font-family: var(--font-mono); font-size: 13px;">
                        ${amount.toFixed(2)} MT
                      </td>

                      <td>
                        ${p.method || ''}
                      </td>

                      <td>
                        <span style="font-family: var(--font-mono); color: #cbd5e1; background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                          ${p.receipt || ''}
                        </span>
                      </td>

                      <td>
                        <span class="badge badge-emerald">
                          ${p.status || 'LIQUIDADO'}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${renderPager(payoutsPageInfo, 'amb-payouts')}
        </div>
      </div>
    `;

    // Paginação (sem novo pedido ao servidor)
    const repaint = () => renderAmbassadorPortal(target, amb, isSuperadminSimulating, tracking, trackingError, stale);
    const storesSearch = target.querySelector('#inp-stores-search');
    if (storesSearch) {
      storesSearch.addEventListener('input', (e) => {
        storesQuery = e.target.value;
        storesPage = 1;
        const pos = e.target.selectionStart;
        repaint();
        const again = target.querySelector('#inp-stores-search');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignora */ } }
      });
    }
    bindPager(target, 'amb-stores', (pg) => { storesPage = pg; repaint(); });
    bindPager(target, 'amb-comm', (pg) => { commPage = pg; repaint(); });
    bindPager(target, 'amb-payouts', (pg) => { payoutsPage = pg; repaint(); });

    // Adicionar utilizador (Admin/Caixa) a uma loja criada por este embaixador
    target.querySelectorAll('.btn-add-store-user').forEach(btn => {
      btn.onclick = () => openAddStoreUserModal(
        amb,
        btn.getAttribute('data-id'),
        btn.getAttribute('data-name')
      );
    });

    // Events
    const btnExit =
      target.querySelector('#btn-exit-preview');

    if (btnExit) {
      btnExit.onclick = () => {
        previewAmbassadorId = null;
        render();
      };
    }

    const copyButton =
      target.querySelector('#btn-copy-ref-link');

    if (copyButton) {
      copyButton.onclick = async () => {

        const link =
          target.querySelector(
            '#inp-ref-link'
          )?.value;

        if (!link) {
          showToast(
            'Não foi possível obter o link de credenciamento.',
            'error'
          );
          return;
        }

        const copied =
          await copyTextToClipboard(link);

        if (copied) {
          showToast(
            'Link de credenciamento copiado com sucesso!',
            'success'
          );
        } else {
          showToast(
            'Não foi possível copiar o link automaticamente. Selecione e copie o link manualmente.',
            'error'
          );
        }
      };
    }

    // Calculate commission display on plan change
    const selPlan =
      target.querySelector('#sel-ns-plan');

    // v7: os pacotes passam a vir da tabela editável pelo Super Admin; sem a migração, ficam os 4 planos por omissão.
    if (selPlan) {
      db.listFeePackages().then((pk) => {
        const active = (pk || []).filter((x) => x.active);
        if (!active.length) return;
        selPlan.innerHTML = active.map((x, i) =>
          `<option value="${esc(x.monthly_fee)}" ${(Number(x.monthly_fee) === 3500 || (i === 0 && !active.some((y) => Number(y.monthly_fee) === 3500))) ? 'selected' : ''}>${esc(x.name)} – ${money(x.monthly_fee)} MT/mês</option>`).join('');
        selPlan.dispatchEvent(new Event('change'));
      }).catch(() => { /* mantém os planos por omissão */ });
    }

    const dispCalc =
      target.querySelector('#disp-calc-commission');

    if (selPlan && dispCalc) {

      selPlan.onchange = () => {

        const fee =
          parseFloat(selPlan.value) || 3500;

        const rate =
          Number(amb.commissionRate || 0);

        const comm =
          (fee * rate) / 100;

        dispCalc.textContent =
          `${comm.toFixed(2)} MT / mês (${rate}%)`;
      };
    }

    // Form submit: criar loja real + administrador
    const formNewStore =
      target.querySelector('#form-add-referred-store');

    if (formNewStore) {
      // v25: tipos de negócio (obrigatório). Se a lista não carregar, o servidor recusa o cadastro com uma mensagem clara.
      const selBt = formNewStore.querySelector('#sel-ns-bt');
      if (selBt) db.getBusinessTypes().then((t) => { selBt.innerHTML = businessTypeOptionsHtml(t, '', (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))); })
        .catch(() => { selBt.innerHTML = '<option value="">Indisponível — execute a migração v25</option>'; });
      formNewStore.onsubmit = async (e) => {
        e.preventDefault();

        const val = (id) => target.querySelector(id).value.trim();
        const name = val('#inp-ns-name');
        const ownerName = val('#inp-ns-owner');
        const phone = val('#inp-ns-phone');
        const city = val('#inp-ns-city');
        const businessType = val('#sel-ns-bt');
        const adminEmail = val('#inp-ns-email');
        const adminPassword = target.querySelector('#inp-ns-pass').value;
        const monthlyFee = parseFloat(target.querySelector('#sel-ns-plan').value) || 3500;
        const contractDurationMonths = parseInt(target.querySelector('#sel-ns-duration').value) || 12;

        if (!businessType) {
          showToast('Seleccione o tipo de negócio da loja (obrigatório).', 'error');
          return;
        }
        if (!name || !ownerName || !phone || !city || !adminEmail || !adminPassword) {
          showToast('Preencha todos os campos obrigatórios da nova loja.', 'error');
          return;
        }
        if (adminPassword.length < 8) {
          showToast('A palavra-passe do administrador deve ter pelo menos 8 caracteres.', 'error');
          return;
        }

        const saveButton = target.querySelector('#btn-save-new-store');
        if (saveButton) {
          saveButton.disabled = true;
          saveButton.textContent = 'A criar loja...';
        }

        try {
          await db.createAmbassadorStore(
            isSuperadminSimulating ? amb.id : null,
            { name, ownerName, phone, city, monthlyFee, contractDurationMonths, adminEmail, adminPassword, businessType }
          );

          showToast(
            `Loja ${name} criada! Administrador: ${adminEmail}. A comissão será registada a cada pagamento lançado.`,
            'success'
          );

          await render();
        } catch (err) {
          console.error('Erro ao criar loja:', err);
          showToast('Erro ao criar loja: ' + (err?.message || 'Erro desconhecido'), 'error');

          if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = '+ Criar Loja e Administrador';
          }
        }
      };
    }
  };

  // --- 2. VISÃO DO SUPERADMIN (GESTÃO DE EMBAIXADORES & LIQUIDAÇÃO DE COMISSÕES) ---
  const renderSuperadminView = (
    target,
    ambassadors
  ) => {

    const totalAmbassadors =
      ambassadors.length;

    const nameOfAmb = (id) => (ambassadors.find((x) => x.id === id) || {}).name || '';
    const superQ = normalizeText(superQuery);
    const superFiltered = !superQ ? ambassadors : ambassadors.filter((a) => normalizeText(
      [a.name, a.phone, a.code, a.paymentDetails, a.status, a.isSuper ? 'super embaixador' : 'embaixador', nameOfAmb(a.parentAmbassadorId)].join(' ')).includes(superQ));
    const superPageInfo = paginate(superFiltered, superPage, 15);
    superPage = superPageInfo.page;

    const totalStoresReferred =
      ambassadors.reduce(
        (sum, a) =>
          sum +
          (a.registeredStores
            ? a.registeredStores.length
            : 0),
        0
      );

    const totalCommissionsPending =
      ambassadors.reduce(
        (sum, a) =>
          sum +
          Number(
            a.pendingCommissions || 0
          ),
        0
      );

    const totalCommissionsPaid =
      ambassadors.reduce(
        (sum, a) =>
          sum +
          Number(
            a.paidCommissions || 0
          ),
        0
      );

    target.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Header Card -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 11px; font-weight: 800; color: #ea580c; text-transform: uppercase; letter-spacing: 0.5px;">
                Governança Global SaaS • Superadmin Independente
              </div>

              <h2 style="font-size: 18px; font-weight: 900; color: #f8fafc; margin: 2px 0 0 0;">
                Gestão Estratégica de Embaixadores & Liquidação de Comissões
              </h2>

              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Cadastre parceiros, acompanhe lojas angariadas e efetue liquidações de comissões via M-Pesa / e-Mola / Banco.
              </div>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-secondary" id="btn-open-network">Rede &amp; Finanças</button>
              <button class="btn btn-secondary" id="btn-open-profiles">Perfis &amp; Transferências</button>
              <button class="btn btn-secondary" id="btn-new-super">+ Novo Super Embaixador</button>
              <button class="btn btn-primary" id="btn-create-ambassador">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
                <span>+ Novo Embaixador</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Metrics Grid in Cards -->
        <div class="metrics-grid">

          <div class="card">
            <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">
              Embaixadores Cadastrados
            </div>

            <div style="font-size: 24px; font-weight: 900; color: #f8fafc; font-family: var(--font-mono); margin-top: 4px;">
              ${totalAmbassadors}
            </div>

            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
              Parceiros comerciais ativos
            </div>
          </div>

          <div class="card">
            <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">
              Total de Lojas Angariadas
            </div>

            <div style="font-size: 24px; font-weight: 900; color: #60a5fa; font-family: var(--font-mono); margin-top: 4px;">
              ${totalStoresReferred}
            </div>

            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
              Novas filiais contratadas via embaixadores
            </div>
          </div>

          <div class="card">
            <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">
              Comissões Pendentes a Pagar
            </div>

            <div style="font-size: 24px; font-weight: 900; color: #fbbf24; font-family: var(--font-mono); margin-top: 4px;">
              ${totalCommissionsPending.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} <span style="font-size: 12px; color: #f59e0b;">MT</span>
            </div>

            <div style="font-size: 10px; color: #f59e0b; margin-top: 2px;">
              Aguardando clique de "Efetuar Pagamento"
            </div>
          </div>

          <div class="card">
            <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">
              Comissões Já Liquidadas
            </div>

            <div style="font-size: 24px; font-weight: 900; color: #34d399; font-family: var(--font-mono); margin-top: 4px;">
              ${totalCommissionsPaid.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} <span style="font-size: 12px; color: #10b981;">MT</span>
            </div>

            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
              Valores já pagos e zerados
            </div>
          </div>

        </div>

        <!-- Ambassadors Management Table Card -->
        <div class="card" style="padding: 0; overflow: hidden;">

          <div style="padding: 14px 16px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center;">
            <h3 style="font-size: 14px; font-weight: 800; color: #f8fafc; margin: 0;">
              Embaixadores, Lojas Cadastradas & Liquidação de Comissões
            </h3>

            <span style="font-size: 11px; color: #94a3b8;">
              Clique em "Efetuar Pagamento" para zerar a comissão do embaixador
            </span>
          </div>

          <div style="padding: 10px 14px; border-bottom: 1px solid #1f2937; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <input type="search" id="inp-amb-search" value="${esc(superQuery)}" placeholder="Pesquisar embaixador, telefone, código, Super Embaixador…" style="flex: 1 1 260px; max-width: 460px;">
            <span style="font-size: 11px; color: #94a3b8;">${superQ ? `${superFiltered.length} de ${ambassadors.length}` : ''}</span>
          </div>

          <div style="overflow-x: auto;">
            <table class="data-table">

              <thead>
                <tr>
                  <th>Embaixador</th>
                  <th>Dados de Pagamento</th>
                  <th>Código de Indicação</th>
                  <th>Lojas Cadastradas</th>
                  <th>Taxa (%)</th>
                  <th>Comissão Pendente (Saldo)</th>
                  <th>Total Já Pago</th>
                  <th style="text-align: right;">Ações do Super Admin</th>
                </tr>
              </thead>

              <tbody>

                ${superPageInfo.rows.map(a => {

                  const storesCount =
                    a.registeredStores
                      ? a.registeredStores.length
                      : (a.totalStores || 0);

                  const pending =
                    Number(
                      a.pendingCommissions || 0
                    );

                  const paid =
                    Number(
                      a.paidCommissions || 0
                    );

                  const referralLink =
                    getReferralLink(a.code);

                  return `
                    <tr>

                      <td>
                        <div style="font-weight: 800; color: #f8fafc;">
                          ${esc(a.name)} ${statusBadgeAmb(a.status)}
                        </div>

                        <div style="font-size: 11px; color: #94a3b8;">
                          ${esc(a.phone)} ${a.userId ? '' : '• <span style="color:#fbbf24;">sem acesso (login)</span>'}
                        </div>

                        <div style="font-size: 11px; margin-top: 3px;">
                          ${a.isSuper
                            ? '<span style="color:#fb923c; font-weight:800;">Super Embaixador</span>'
                            : `<span style="color:#94a3b8;">Embaixador</span> · Super Embaixador: ${
                                a.parentAmbassadorId
                                  ? `<b style="color:#f8fafc;">${esc((ambassadors.find((x) => x.id === a.parentAmbassadorId) || {}).name || '—')}</b>`
                                  : '<span style="color:#64748b;">sem vínculo</span>'
                              }`}
                        </div>
                      </td>

                      <td>
                        <div style="font-size: 11px; color: #34d399; font-weight: 700;">
                          ${a.paymentDetails || 'M-Pesa'}
                        </div>
                      </td>

                      <!-- LINK DE INDICAÇÃO -->
                      <td>
                        <div style="display: flex; flex-direction: column; gap: 7px; min-width: 235px;">

                          <span style="width: max-content; font-family: var(--font-mono); font-weight: 800; color: #60a5fa; background: #1e293b; padding: 2px 6px; border-radius: 4px;">
                            ${a.code}
                          </span>

                          <input
                            type="text"
                            readonly
                            value="${referralLink}"
                            class="inp-super-ref-link"
                            data-id="${a.id}"
                            style="width: 100%; font-size: 10px; font-family: var(--font-mono); background: #020617; border-color: #334155; color: #93c5fd; padding: 5px 7px;"
                          >

                          <div style="display: flex; gap: 6px; flex-wrap: wrap;">

                            <button
                              class="btn btn-secondary btn-copy-super-ref-link"
                              data-link="${referralLink}"
                              type="button"
                              style="padding: 5px 8px; font-size: 10px;"
                            >
                              Copiar Link
                            </button>

                            <button
                              class="btn btn-secondary btn-open-super-ref-link"
                              data-link="${referralLink}"
                              type="button"
                              style="padding: 5px 8px; font-size: 10px;"
                              title="Abrir página pública de adesão"
                            >
                              Abrir Página
                            </button>

                          </div>

                        </div>
                      </td>

                      <td>
                        <strong style="color: #f8fafc;">
                          ${storesCount} lojas
                        </strong>

                        <div style="font-size: 10px; color: #94a3b8;">
                          ${(a.registeredStores || []).filter(
                            s => s.paymentStatus === 'PAGO'
                          ).length} ativas/em dia
                        </div>
                      </td>

                      <td style="font-family: var(--font-mono); font-weight: 700;">
                        ${a.commissionRate}%
                      </td>

                      <td>
                        <strong style="color: ${pending > 0 ? '#fbbf24' : '#34d399'}; font-family: var(--font-mono); font-size: 14px;">
                          ${pending.toFixed(2)} MT
                        </strong>

                        <div style="font-size: 10px; color: ${pending > 0 ? '#f59e0b' : '#10b981'};">
                          ${pending === 0 ? '✓ ZERADO (Em dia)' : 'Pendente de liquidação'}
                        </div>
                      </td>

                      <td style="font-family: var(--font-mono); color: #cbd5e1; font-weight: 700;">
                        ${paid.toFixed(2)} MT
                      </td>

                      <td style="text-align: right;">
                        <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">

                          ${pending > 0 ? `
                            <button
                              class="btn btn-primary btn-payout-amb"
                              data-id="${a.id}"
                              style="padding: 5px 10px; font-size: 11px; background: #10b981; border-color: #10b981; font-weight: 800;"
                            >
                              Efetuar Pagamento
                            </button>
                          ` : `
                            <span class="badge badge-emerald" style="font-size: 9px; padding: 4px 8px;">
                              COMISSÃO ZERADA
                            </span>
                          `}

                          <button
                            class="btn btn-secondary btn-edit-amb"
                            data-id="${a.id}"
                            style="padding: 5px 8px; font-size: 11px;"
                          >
                            Editar
                          </button>

                          <button
                            class="btn btn-secondary btn-stores-amb"
                            data-id="${a.id}"
                            style="padding: 5px 8px; font-size: 11px;"
                          >
                            Lojas
                          </button>

                          <button
                            class="btn ${a.status === 'ATIVO' ? 'btn-danger' : 'btn-primary'} btn-toggle-block-amb"
                            data-id="${a.id}"
                            data-status="${a.status}"
                            style="padding: 5px 8px; font-size: 11px;"
                          >
                            ${a.status === 'ATIVO' ? 'Bloquear' : 'Desbloquear'}
                          </button>

                          <button
                            class="btn btn-secondary btn-simulate-amb"
                            data-id="${a.id}"
                            style="padding: 5px 8px; font-size: 11px;"
                            title="Ver Portal do Embaixador"
                          >
                            Simular Visão
                          </button>

                        </div>
                      </td>

                    </tr>
                  `;

                }).join('')}

              </tbody>
            </table>
          </div>
          ${renderPager(superPageInfo, 'amb-super')}
        </div>
      </div>
    `;

    const ambSearch = target.querySelector('#inp-amb-search');
    if (ambSearch) {
      ambSearch.addEventListener('input', (e) => {
        superQuery = e.target.value;
        superPage = 1;
        const pos = e.target.selectionStart;
        renderSuperadminView(target, ambassadors);
        const again = target.querySelector('#inp-amb-search');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignora */ } }
      });
    }

    bindPager(target, 'amb-super', (pg) => {
      superPage = pg;
      renderSuperadminView(target, ambassadors);
    });

    // Editar embaixador (dados + comissão padrão)
    target.querySelectorAll('.btn-edit-amb').forEach(btn => {
      btn.onclick = () => {
        const amb = ambassadors.find(a => a.id === btn.getAttribute('data-id'));
        if (amb) openEditAmbassadorModal(amb, () => render());
      };
    });

    // Lojas do embaixador + comissão por loja
    target.querySelectorAll('.btn-stores-amb').forEach(btn => {
      btn.onclick = () => {
        const amb = ambassadors.find(a => a.id === btn.getAttribute('data-id'));
        if (amb) openAmbassadorStoresModal(amb, () => render());
      };
    });

    // Bloquear / desbloquear
    target.querySelectorAll('.btn-toggle-block-amb').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        const amb = ambassadors.find(a => a.id === id);
        const willBlock = btn.getAttribute('data-status') === 'ATIVO';

        if (!amb) return;
        if (willBlock && !window.confirm(`Bloquear o embaixador ${amb.name}? Deixa de poder entrar e criar lojas.`)) return;

        btn.disabled = true;
        try {
          await db.setAmbassadorStatus(id, willBlock ? 'BLOQUEADO' : 'ATIVO');
          showToast(`Embaixador ${amb.name} ${willBlock ? 'bloqueado' : 'desbloqueado'} com sucesso.`, 'success');
          await render();
        } catch (err) {
          btn.disabled = false;
          showToast('Erro ao alterar estado: ' + (err?.message || 'Erro desconhecido'), 'error');
        }
      };
    });

    // Events
    const networkButton = target.querySelector('#btn-open-network');
    if (networkButton) {
      networkButton.onclick = () => mountNetworkAdmin(container, { onBack: () => render() });
    }
    const profilesButton = target.querySelector('#btn-open-profiles');
    if (profilesButton) profilesButton.onclick = () => mountProfileAdmin(container, { onBack: () => render() });
    const newSuperButton = target.querySelector('#btn-new-super');
    if (newSuperButton) newSuperButton.onclick = () => mountProfileAdmin(container, { onBack: () => render() }).then(() => container.querySelector('#gp-new-super')?.click());

    const createButton =
      target.querySelector(
        '#btn-create-ambassador'
      );

    if (createButton) {

      // v7: o formulário antigo não pedia idioma/moeda (agora obrigatórios no servidor); usa-se o novo formulário.
      createButton.onclick = () => {
        mountProfileAdmin(container, { onBack: () => render() }).then(() => container.querySelector('#gp-new-amb')?.click());
      };
    }

    // Copiar link de indicação do Super Admin
    target.querySelectorAll(
      '.btn-copy-super-ref-link'
    ).forEach(btn => {

      btn.onclick = async () => {

        const link =
          btn.getAttribute('data-link');

        if (!link) {
          showToast(
            'Link de credenciamento não disponível.',
            'error'
          );
          return;
        }

        const copied =
          await copyTextToClipboard(link);

        if (copied) {

          showToast(
            'Link de credenciamento copiado com sucesso!',
            'success'
          );

        } else {

          showToast(
            'Não foi possível copiar o link automaticamente. Copie o endereço exibido no campo.',
            'error'
          );
        }
      };
    });

    // Abrir página pública de adesão
    target.querySelectorAll(
      '.btn-open-super-ref-link'
    ).forEach(btn => {

      btn.onclick = () => {

        const link =
          btn.getAttribute('data-link');

        if (!link) {
          showToast(
            'Link de credenciamento não disponível.',
            'error'
          );
          return;
        }

        window.open(
          link,
          '_blank',
          'noopener,noreferrer'
        );
      };
    });

    // Payout modal
    target.querySelectorAll(
      '.btn-payout-amb'
    ).forEach(btn => {

      btn.onclick = () => {

        const id =
          btn.getAttribute('data-id');

        const amb =
          ambassadors.find(
            a => a.id === id
          );

        if (amb) {
          openPayoutModal(
            amb,
            () => render()
          );
        }
      };
    });

    // Simulate view
    target.querySelectorAll(
      '.btn-simulate-amb'
    ).forEach(btn => {

      btn.onclick = () => {

        const id =
          btn.getAttribute('data-id');

        previewAmbassadorId = id;

        render();
      };
    });
  };

  // Estrutura base de modal simples (reutilizada pelos modais novos)
  const openSimpleModal = (title, bodyHtml, footerHtml, maxWidth = 460) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: ${maxWidth}px;">
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close-btn" data-close>✕</button>
        </div>
        <div class="modal-body" style="padding: 16px; display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto;">
          ${bodyHtml}
        </div>
        <div class="modal-footer">${footerHtml}</div>
      </div>
    `;
    modal.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => modal.remove(); });
    document.body.appendChild(modal);
    return modal;
  };

  const fieldLabel = 'font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;';

  // Editar embaixador (nome, telefone, dados de pagamento, comissão padrão, acesso)
  const openEditAmbassadorModal = (amb, onSuccess) => {
    const modal = openSimpleModal(
      'Editar Embaixador',
      `
        <div>
          <label style="${fieldLabel}">Código / link (fixo, não muda):</label>
          <input type="text" readonly value="${esc(amb.code)}" style="width: 100%; font-family: var(--font-mono); color: #60a5fa;">
        </div>
        <div>
          <label style="${fieldLabel}">Nome: *</label>
          <input type="text" id="inp-ea-name" value="${esc(amb.name)}" style="width: 100%;">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <label style="${fieldLabel}">Telefone: *</label>
            <input type="text" id="inp-ea-phone" value="${esc(amb.phone)}" style="width: 100%;">
          </div>
          <div>
            <label style="${fieldLabel}">Comissão padrão (%): *</label>
            <input type="number" id="inp-ea-rate" value="${Number(amb.commissionRate || 0)}" min="0" max="100" step="0.5" style="width: 100%;">
          </div>
        </div>
        <div style="font-size: 10px; color: #94a3b8; margin-top: -6px;">
          A comissão padrão vale para as lojas novas. As lojas já criadas mantêm a sua própria taxa (edite em "Lojas").
        </div>
        <div>
          <label style="${fieldLabel}">Dados para pagamento (M-Pesa / Banco):</label>
          <input type="text" id="inp-ea-pay" value="${esc(amb.paymentDetails)}" style="width: 100%;">
        </div>
        ${amb.userId ? `
          <div style="font-size: 11px; color: #34d399;">✓ Este embaixador já tem acesso ao sistema.</div>
        ` : `
          <div style="border-top: 1px solid #1f2937; padding-top: 10px;">
            <div style="font-size: 11px; color: #fbbf24; margin-bottom: 8px;">Este embaixador ainda não tem acesso. Crie o login:</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <input type="tel" inputmode="tel" id="inp-ea-email" placeholder="Telemóvel de acesso" autocomplete="off" style="width: 100%;">
              <input type="text" id="inp-ea-pass" placeholder="Palavra-passe (mín. 8)" autocomplete="off" style="width: 100%;">
            </div>
          </div>
        `}
      `,
      `
        <button class="btn btn-secondary" data-close>Cancelar</button>
        <button class="btn btn-primary" id="btn-save-ea">Guardar</button>
      `
    );

    modal.querySelector('#btn-save-ea').onclick = async (ev) => {
      const btn = ev.currentTarget;
      const name = modal.querySelector('#inp-ea-name').value.trim();
      const phone = modal.querySelector('#inp-ea-phone').value.trim();
      const rate = parseFloat(modal.querySelector('#inp-ea-rate').value);
      const pay = modal.querySelector('#inp-ea-pay').value.trim();
      const email = modal.querySelector('#inp-ea-email')?.value.trim() || '';
      const pass = modal.querySelector('#inp-ea-pass')?.value || '';

      if (!name || !phone) { showToast('Nome e telefone são obrigatórios.', 'error'); return; }
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) { showToast('Comissão inválida (0 a 100).', 'error'); return; }
      if ((email || pass) && (!email || pass.length < 8)) {
        showToast('Para criar o acesso informe o telemóvel e uma palavra-passe de pelo menos 8 caracteres.', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'A guardar...';
      try {
        await db.saveAmbassador({ id: amb.id, name, phone, pixMpesa: pay, commissionRate: rate });
        if (email && pass) await db.createAmbassadorLogin(amb.id, email, pass);
        showToast('Embaixador atualizado com sucesso.', 'success');
        modal.remove();
        if (onSuccess) onSuccess();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Guardar';
        showToast('Erro ao guardar: ' + (err?.message || 'Erro desconhecido'), 'error');
      }
    };
  };

  // Lojas do embaixador: subscrição + comissão específica de cada loja (Super Admin)
  const openAmbassadorStoresModal = async (amb, onSuccess) => {
    const modal = openSimpleModal(
      `Lojas de ${esc(amb.name)}`,
      `<div id="amb-stores-body" style="font-size: 12px; color: #94a3b8;">A carregar…</div>`,
      `<button class="btn btn-secondary" data-close>Fechar</button>`,
      880
    );

    const body = modal.querySelector('#amb-stores-body');
    let tracking = null;
    try {
      tracking = await db.getAmbassadorTracking(amb.id);
    } catch (err) {
      console.warn(err);
    }

    const byId = new Map(((tracking && tracking.stores) || []).map(t => [t.id, t]));
    const list = amb.registeredStores || [];
    let page = 1;

    const paint = () => {
      const info = paginate(list, page, 8);
      page = info.page;

      body.innerHTML = list.length === 0
        ? '<div style="padding: 18px; text-align: center;">Este embaixador ainda não criou lojas.</div>'
        : `
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Subscrição</th>
                  <th>Pagamentos</th>
                  <th>Comissão gerada</th>
                  <th>Comissão desta loja (%)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${info.rows.map(st => {
                  const t = byId.get(st.id) || {};
                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 800; color: #f8fafc;">${esc(st.name)}</div>
                        <div style="font-size: 10px; color: #94a3b8;">${esc(st.city || '')} · ${money(st.monthlyFee)} MT/mês</div>
                      </td>
                      <td>
                        ${subscriptionBadge(t.subscription_status || 'SEM_LOJA')}
                        <div style="font-size: 10px; color: #94a3b8;">${daysText(t.days_remaining)}</div>
                      </td>
                      <td style="font-family: var(--font-mono);">${Number(t.payments_count || 0)}</td>
                      <td style="font-family: var(--font-mono); color: #34d399; font-weight: 800;">${money(t.total_commission)} MT</td>
                      <td>
                        <input type="number" class="inp-store-rate" data-id="${esc(st.id)}" value="${Number(st.commissionRate || 0)}" min="0" max="100" step="0.5" style="width: 90px;">
                      </td>
                      <td>
                        <button class="btn btn-primary btn-save-store-rate" data-id="${esc(st.id)}" style="padding: 4px 10px; font-size: 10px;">Guardar</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${renderPager(info, 'amb-modal-stores')}
          <div style="font-size: 10px; color: #94a3b8; margin-top: 6px;">
            A nova taxa vale para os próximos pagamentos lançados; a comissão já registada não é alterada.
          </div>
        `;

      bindPager(body, 'amb-modal-stores', (pg) => { page = pg; paint(); });

      body.querySelectorAll('.btn-save-store-rate').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.getAttribute('data-id');
          const input = body.querySelector(`.inp-store-rate[data-id="${id}"]`);
          const rate = parseFloat(input.value);
          btn.disabled = true;
          try {
            await db.setReferredStoreCommission(id, rate);
            const st = list.find(x => x.id === id);
            if (st) st.commissionRate = rate;
            showToast('Comissão da loja atualizada.', 'success');
            btn.disabled = false;
            if (onSuccess) onSuccess();
          } catch (err) {
            btn.disabled = false;
            showToast('Erro: ' + (err?.message || 'Erro desconhecido'), 'error');
          }
        };
      });
    };

    paint();
  };

  // v25: Embaixador / Super Embaixador cria utilizadores (ADMIN, GERENTE, CASHIER, ESTOQUISTA, LOGISTA, MARKETING) nas lojas do seu âmbito.
  // Pela Edge Function create-store-user (autenticação real); o servidor valida o âmbito e o perfil.
  const openAddStoreUserModal = (amb, referredStoreId, storeName) => openStoreUserModal({ storeId: referredStoreId, storeName });

  // Payout Modal: O valor da comissão deve ser ZERADO quando o role super administrador clicar em efetuar pagamento
  const openPayoutModal = (
    amb,
    onSuccess
  ) => {

    const modal =
      document.createElement('div');

    modal.className =
      'modal-backdrop';

    const pendingAmount =
      Number(
        amb.pendingCommissions || 0
      );

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 460px; border-color: #10b981; box-shadow: 0 25px 50px -12px rgba(16, 185, 129, 0.3);">

        <div class="modal-header" style="background: rgba(16, 185, 129, 0.12); border-bottom-color: rgba(16, 185, 129, 0.3);">

          <div style="display: flex; align-items: center; gap: 8px;">

            <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(16, 185, 129, 0.2); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>

            <h3 class="modal-title" style="color: #6ee7b7; font-size: 15px;">
              Liquidar Comissão de Embaixador
            </h3>

          </div>

          <button class="modal-close-btn" id="btn-close-pomodal">
            ✕
          </button>

        </div>

        <div class="modal-body" style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">

          <div class="card" style="padding: 12px; background: #1e293b; border-color: #334155;">

            <div style="font-size: 14px; font-weight: 800; color: #fff;">
              ${amb.name}
            </div>

            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
              Código:
              <strong style="color: #60a5fa;">
                ${amb.code}
              </strong>
            </div>

            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
              Saldo Pendente a Liquidar:
              <strong style="color: #fbbf24; font-size: 14px; font-family: var(--font-mono);">
                ${pendingAmount.toFixed(2)} MT
              </strong>
            </div>

            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
              Destino Cadastrado:
              <strong style="color: #34d399;">
                ${amb.paymentDetails || 'M-Pesa (+258 84 764 0849)'}
              </strong>
            </div>

          </div>

          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px; border-radius: 6px; font-size: 11px; color: #a7f3d0; line-height: 1.4;">
            <strong>Regra de Pagamento:</strong>
            Ao confirmar esta liquidação,
            <strong>o valor da comissão deste embaixador será ZERADO (0,00 MT)</strong>
            e registrado no extrato do parceiro.
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Valor a Liquidar (MT):
            </label>

            <input
              type="number"
              min="1"
              max="${pendingAmount}"
              step="any"
              id="inp-po-val"
              value="${pendingAmount}"
              style="width: 100%; font-size: 18px; font-weight: 900; font-family: var(--font-mono); color: #34d399;"
            >
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Meio de Liquidação:
            </label>

            <select id="sel-po-method" style="width: 100%;">
              <option value="M-Pesa (Vodacom)">M-Pesa (Vodacom +258 84 764 0849)</option>
              <option value="e-Mola (Movitel)">e-Mola / Esmola (+258 87 309 1444)</option>
              <option value="Millennium bim (Conta 863896066)">Millennium bim (Conta 863896066)</option>
              <option value="Transferência Bancária (BCI/Standard)">Transferência Bancária</option>
              <option value="Dinheiro Físico">Dinheiro Físico</option>
            </select>
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Nº de Transação / Comprovante:
            </label>

            <input
              type="text"
              id="inp-po-ref"
              placeholder="Ex: MP260910.8841.B09"
              style="width: 100%; font-family: var(--font-mono);"
            >
          </div>

        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">

          <button class="btn btn-secondary" id="btn-cancel-pomodal">
            Cancelar
          </button>

          <button class="btn btn-primary" id="btn-confirm-po" style="background: #10b981; border-color: #10b981; font-weight: 800; padding: 8px 16px;">
            Confirmar Pagamento & Zerar Saldo
          </button>

        </div>

      </div>
    `;

    modal.querySelector(
      '#btn-close-pomodal'
    ).onclick = () => modal.remove();

    modal.querySelector(
      '#btn-cancel-pomodal'
    ).onclick = () => modal.remove();

    modal.querySelector(
      '#btn-confirm-po'
    ).onclick = async () => {

      const val =
        parseFloat(
          modal.querySelector(
            '#inp-po-val'
          ).value
        ) || 0;

      const method =
        modal.querySelector(
          '#sel-po-method'
        ).value;

      const ref =
        modal.querySelector(
          '#inp-po-ref'
        ).value.trim() ||
        'MP-' +
        Math.floor(
          100000 +
          Math.random() * 900000
        );

      if (
        val <= 0 ||
        val > pendingAmount
      ) {

        showToast(
          'Valor de pagamento inválido.',
          'error'
        );

        return;
      }

      const confirmButton =
        modal.querySelector(
          '#btn-confirm-po'
        );

      confirmButton.disabled = true;

      confirmButton.textContent =
        'A processar...';

      try {

        await db.payAmbassadorCommission(
          amb.id,
          val,
          method,
          ref
        );

        showToast(
          `Pagamento de ${val.toFixed(2)} MT efetuado com sucesso! A comissão de ${amb.name} foi ZERADA.`,
          'success'
        );

        modal.remove();

        if (onSuccess) {
          onSuccess();
        }

      } catch (error) {

        console.error(
          'Erro ao efetuar pagamento:',
          error
        );

        showToast(
          'Erro ao efetuar pagamento: ' +
          (error?.message ||
            'Erro desconhecido'),
          'error'
        );

        confirmButton.disabled = false;

        confirmButton.textContent =
          'Confirmar Pagamento & Zerar Saldo';
      }
    };

    document.body.appendChild(
      modal
    );
  };

  // Create Ambassador Modal
  const openCreateAmbassadorModal = (
    onSuccess
  ) => {

    const modal =
      document.createElement('div');

    modal.className =
      'modal-backdrop';

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 460px;">

        <div class="modal-header">

          <h3 class="modal-title">
            Cadastrar Novo Embaixador Parceiro
          </h3>

          <button class="modal-close-btn" id="btn-close-camodal">
            ✕
          </button>

        </div>

        <div class="modal-body" style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Nome Completo do Parceiro: *
            </label>

            <input
              type="text"
              id="inp-ca-name"
              placeholder="Ex: Eng. Bernardo Cossa"
              required
              style="width: 100%;"
            >
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">

            <div>
              <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
                Telefone / WhatsApp: *
              </label>

              <input
                type="text"
                id="inp-ca-phone"
                placeholder="+258 84 000 0000"
                style="width: 100%;"
              >
            </div>

            <div>
              <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
                Taxa Comissão (%): *
              </label>

              <input
                type="number"
                id="inp-ca-rate"
                value="15.0"
                step="1"
                min="1"
                max="50"
                style="width: 100%;"
              >
            </div>

          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Telemóvel de acesso (opcional):
            </label>

            <input
              type="tel"
              inputmode="tel"
              id="inp-ca-email"
              autocomplete="off"
              style="width: 100%;"
            >
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Palavra-passe de acesso (mín. 8) — para o embaixador entrar:
            </label>

            <input
              type="text"
              id="inp-ca-pass"
              placeholder="Opcional agora; pode criar depois em Editar"
              autocomplete="off"
              style="width: 100%;"
            >
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
              Dados para Pagamento M-Pesa / Banco:
            </label>

            <input
              type="text"
              id="inp-ca-paydetails"
              placeholder="Ex: M-Pesa +258 84 123 4567 ou Millennium bim"
              style="width: 100%;"
            >
          </div>

        </div>

        <div class="modal-footer">

          <button class="btn btn-secondary" id="btn-cancel-camodal">
            Cancelar
          </button>

          <button class="btn btn-primary" id="btn-save-amb">
            Cadastrar Embaixador
          </button>

        </div>

      </div>
    `;

    modal.querySelector(
      '#btn-close-camodal'
    ).onclick = () => modal.remove();

    modal.querySelector(
      '#btn-cancel-camodal'
    ).onclick = () => modal.remove();

    modal.querySelector(
      '#btn-save-amb'
    ).onclick = async () => {

      const name =
        modal.querySelector(
          '#inp-ca-name'
        ).value.trim();

      const phone =
        modal.querySelector(
          '#inp-ca-phone'
        ).value.trim();

      const email =
        modal.querySelector(
          '#inp-ca-email'
        ).value.trim();

      const rate =
        parseFloat(
          modal.querySelector(
            '#inp-ca-rate'
          ).value
        ) || 15.0;

      const payDetails =
        modal.querySelector(
          '#inp-ca-paydetails'
        ).value.trim();

      const loginPassword =
        modal.querySelector('#inp-ca-pass').value;

      if (!name) {

        showToast(
          'Nome do embaixador é obrigatório.',
          'error'
        );

        return;
      }

      if (loginPassword && (!email || loginPassword.length < 8)) {
        showToast(
          'Para criar o acesso informe o telemóvel e uma palavra-passe de pelo menos 8 caracteres.',
          'error'
        );
        return;
      }

      const slug =
        name
          .split(' ')[0]
          .toUpperCase();

      const newAmb = {

        id:
          'amb-' +
          Date.now(),

        name,

        email:
          (email.includes('@') ? email : '') ||
          `${slug.toLowerCase()}@gefparceiros.co.mz`,   // contacto genérico; o ACESSO é o telemóvel (ver abaixo)

        phone:
          phone ||
          '+258 84 000 0000',

        code:
          `GEF-${slug}-${new Date().getFullYear()}`,

        commissionRate:
          rate,

        status:
          'ATIVO',

        totalStores:
          0,

        activeStores:
          0,

        pendingCommissions:
          0,

        paidCommissions:
          0,

        paymentDetails:
          payDetails ||
          `M-Pesa: ${phone}`,

        registeredStores:
          [],

        payoutHistory:
          []
      };

      const saveButton =
        modal.querySelector(
          '#btn-save-amb'
        );

      saveButton.disabled = true;

      saveButton.textContent =
        'A cadastrar...';

      try {

        const saved = await db.saveAmbassador(
          newAmb
        );

        if (email && loginPassword) {
          await db.createAmbassadorLogin(newAmb.id, email, loginPassword);
        }

        showToast(
          `Embaixador ${name} cadastrado com o código ${saved?.referral_code || newAmb.code}!`,
          'success'
        );

        modal.remove();

        if (onSuccess) {
          onSuccess();
        }

      } catch (error) {

        console.error(
          'Erro ao cadastrar embaixador:',
          error
        );

        showToast(
          'Erro ao cadastrar embaixador: ' +
          (error?.message ||
            'Erro desconhecido'),
          'error'
        );

        saveButton.disabled = false;

        saveButton.textContent =
          'Cadastrar Embaixador';
      }
    };

    document.body.appendChild(
      modal
    );
  };

  // ---- Atualização automática: Realtime + verificação periódica + ao voltar ao separador ----
  const startLiveUpdates = () => {
    if (ambLiveCleanup) { ambLiveCleanup(); ambLiveCleanup = null; }
    if (isSuperadmin) return;

    let stopped = false;
    let debounce = null;
    let client = null;
    let channel = null;

    const formBusy = () => {
      const form = container.querySelector('form');
      if (!form) return false;
      if (form.contains(document.activeElement)) return true;
      return [...form.querySelectorAll('input')].some(i => !i.readOnly && !['hidden', 'checkbox', 'radio'].includes(i.type) && i.value);
    };

    const cleanup = () => {
      stopped = true;
      clearTimeout(debounce);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (client && channel) { try { client.removeChannel(channel); } catch (e) { /* ignore */ } }
    };

    const refresh = async () => {
      if (stopped) return;
      // Se o utilizador saiu do painel, deixa de atualizar
      // Só pára quando o utilizador realmente saiu do painel (o conteúdo foi substituído por outro módulo).
      // Antes parava também em estado de erro/vazio e nunca mais recuperava.
      if (!container.isConnected || !container.querySelector('[data-amb-root]')) { cleanup(); return; }
      if (document.hidden || formBusy()) return; // não apaga o que o utilizador está a escrever
      try { await render(); } catch (err) { console.warn('[GEF] Atualização do painel falhou:', err); }
    };

    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 700); };
    const onVisible = () => { if (!document.hidden) schedule(); };

    try {
      client = db.requireClient();
      channel = client.channel('gef-amb-' + (currentUser?.id || 'anon'));
      ['ambassadors', 'ambassador_referred_stores', 'ambassador_commission_payments', 'ambassador_payouts']
        .forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule));
      channel.subscribe();
    } catch (err) {
      console.warn('[GEF] Realtime indisponível; a usar verificação periódica:', err);
    }

    const timer = setInterval(refresh, 120000); // rede de segurança se o Realtime falhar (também apanha bloqueios/vencimentos)
    document.addEventListener('visibilitychange', onVisible);
    ambLiveCleanup = cleanup;
  };

  try {
    await render();
  } catch (err) {
    // A primeira carga falhou: mostra o motivo (em vez de ecrã de erro genérico) e mantém as novas tentativas.
    if (isSuperadmin) throw err;
    console.warn('[GEF] Primeira carga do painel do embaixador falhou:', err);
    renderLoadError(err?.message || String(err));
  }
  startLiveUpdates();
}
