/**
 * GEF - PÁGINA DE ADESÃO (adesao.html?embaixador=CODIGO)
 *
 * Duas vistas na mesma página:
 *  1) PÚBLICA (qualquer visitante): nome/código do embaixador + botão para registar uma loja.
 *     Nunca mostra ganhos, telefones nem lojas.
 *  2) DONO DO LINK (Embaixador autenticado): painel completo — resumo, estado de cada loja,
 *     comissões, link/WhatsApp e notificações — lido de fn_ambassador_portal (Supabase real).
 *
 * A autorização é do servidor: fn_ambassador_portal liga SEMPRE ao auth.uid() do pedido
 * (ambassadors.user_id) e só devolve o registo do próprio embaixador. Aqui só se traduz o
 * resultado em ecrã; se o servidor não confirmar, nenhum dado privado é desenhado.
 */

import {
    supabase as supabaseClient,
    isSupabaseConfigured
} from './core/supabase.js';
import { SITE_URL } from './config.js';
import { displayLogin } from './core/login-id.js';
import {
    panelState,
    normalizeCode,
    buildReferralLink,
    whatsappShareUrl,
    classifyStore,
    summarizeStores,
    buildNotifications,
    evaluateAccess,
    escapeHtml
} from './core/ambassador-view.js';

let supabase = null;
let ambassadorCode = null;
let publicAmbassador = null;
let lastPortal = null;      // último estado bom (mantém o painel visível se uma actualização falhar)
let ownerLoading = false;

const $ = (id) => document.getElementById(id);


/* =========================================================
   UTILITÁRIOS
========================================================= */

function getAmbassadorCode() {
    const params = new URLSearchParams(window.location.search);
    return (
        params.get('embaixador') ||
        params.get('ambassador') ||
        params.get('codigo') ||
        ''
    ).trim();
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('pt-MZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + ' MT';
}

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('pt-PT');
}

function daysText(days) {
    if (days === null || days === undefined || days === '' || !Number.isFinite(Number(days))) return '—';
    const d = Number(days);
    if (d > 1) return `${d} dias restantes`;
    if (d === 1) return '1 dia restante';
    if (d === 0) return 'Vence hoje';
    return `Expirou há ${Math.abs(d)} dia(s)`;
}

function showPublicError(message) {
    const box = $('public-message');
    if (!box) return;
    box.textContent = message;
    box.className = 'message error public-message';
    box.style.display = 'block';
}

async function copyText(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        console.warn('Clipboard API indisponível:', error);
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch (error) {
        console.error('Falha ao copiar:', error);
        return false;
    }
}


/* =========================================================
   VISTA PÚBLICA
========================================================= */

function renderAmbassador() {
    const ambassador = publicAmbassador?.ambassador || {};
    const name = ambassador.name || 'Embaixador GEF';

    const nameEl = $('ambassador-name');
    const codeEl = $('ambassador-code');
    const avatarEl = $('ambassador-avatar');
    const boxEl = $('ambassador-box');

    if (nameEl) nameEl.textContent = name;
    if (codeEl) codeEl.textContent = `Código: ${ambassador.referral_code || ambassadorCode}`;
    if (avatarEl) avatarEl.textContent = name.trim().charAt(0).toUpperCase() || 'G';
    if (boxEl) boxEl.style.display = 'block';
}

function configureCTA() {
    const button = $('register-store-btn');
    const formSection = $('form-section');
    if (!button || !formSection) return;

    const status = String(publicAmbassador?.ambassador?.status || 'ATIVO').toUpperCase();
    const blocked = ['BLOCKED', 'BLOQUEADO', 'DISABLED', 'DESATIVADO', 'INACTIVE'].includes(status);

    if (blocked) {
        button.disabled = true;
        button.textContent = 'Adesão temporariamente bloqueada';
        button.classList.remove('btn-primary');
        button.classList.add('btn-danger');
        const blockedCard = $('blocked-card');
        if (blockedCard) blockedCard.style.display = 'block';
        return;
    }

    button.addEventListener('click', () => {
        formSection.style.display = 'block';
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function setCtaForOwner(isOwner) {
    const title = document.querySelector('#cta-section .cta-title');
    const text = document.querySelector('#cta-section .cta-text');
    const button = $('register-store-btn');
    if (!title || !text || !button || button.disabled) return;

    if (isOwner) {
        title.textContent = 'Registar uma nova loja';
        text.textContent = 'A loja fica vinculada a si e aparece no painel acima.';
        button.textContent = 'Registar nova loja';
    } else {
        title.textContent = 'Quer cadastrar a sua loja?';
        text.textContent = 'Preencha o formulário para iniciar a adesão ao GEF.';
        button.textContent = 'Cadastrar minha loja';
    }
}


/* =========================================================
   AVISO DE ACESSO
========================================================= */

function showHint(message, { retry = false } = {}) {
    const hint = $('owner-hint');
    const text = $('owner-hint-text');
    const link = $('owner-hint-link');
    if (!hint || !text || !link) return;

    text.textContent = message.text;
    hint.className = `owner-hint ${message.tone === 'error' ? 'error' : 'info'}`;
    hint.style.display = 'flex';

    if (retry) {
        link.textContent = 'Tentar novamente';
        link.setAttribute('href', '#');
        link.onclick = (event) => { event.preventDefault(); loadOwnerPanel(); };
    } else {
        link.textContent = 'Entrar no painel do embaixador';
        link.setAttribute('href', './index.html?tab=EMBAIXADORES');
        link.onclick = null;
    }
}

function hideHint() {
    const hint = $('owner-hint');
    if (hint) hint.style.display = 'none';
}

function hideOwnerPanel() {
    ['financial-section', 'share-section', 'notifications-section', 'stores-section', 'owner-loading']
        .forEach((id) => { const el = $(id); if (el) el.style.display = 'none'; });
}


/* =========================================================
   VISTA DO DONO (dados reais)
========================================================= */

function metricCard(label, value, hint = '', extraClass = '') {
    return `
        <div class="financial-card ${extraClass}">
            <div class="financial-label">${escapeHtml(label)}</div>
            <div class="financial-value">${escapeHtml(value)}</div>
            ${hint ? `<div class="financial-hint">${escapeHtml(hint)}</div>` : ''}
        </div>`;
}

function renderMetrics(portal) {
    const section = $('financial-section');
    if (!section) return;

    const sum = summarizeStores(portal.stores);
    const rate = Number(portal.ambassador?.commission_rate || 0);

    section.innerHTML = [
        metricCard('Lojas indicadas', String(sum.total), 'Total vinculado a si'),
        metricCard('Lojas activas', String(sum.ativas), 'Criadas e não bloqueadas'),
        metricCard('Regulares', String(sum.regular + sum.a_vencer), 'Subscrição em dia'),
        metricCard('Pendentes', String(sum.pendente), '1.º pagamento por lançar'),
        metricCard('Em atraso', String(sum.em_atraso), 'Subscrição expirada'),
        metricCard('Bloqueadas', String(sum.bloqueada), 'Acesso suspenso'),
        metricCard('Comissão disponível', formatMoney(portal.available_commission), 'A aguardar liquidação'),
        metricCard('Comissão recebida', formatMoney(portal.paid_commission), 'Já liquidada'),
        metricCard('Total gerado', formatMoney(portal.total_commission_generated), 'Soma de todos os pagamentos'),
        metricCard('Taxa de comissão', `${rate}%`, 'Sobre cada mensalidade', 'rate')
    ].join('');
    section.style.display = '';
}

function renderShare(portal) {
    const section = $('share-section');
    if (!section) return;

    const name = portal.ambassador?.name || '';
    const code = portal.ambassador?.referral_code || ambassadorCode;
    const link = buildReferralLink(code, { siteUrl: SITE_URL });

    const input = $('ref-link-input');
    const wa = $('ref-whatsapp-btn');
    const copyBtn = $('ref-copy-btn');

    if (input) input.value = link;
    if (wa) wa.setAttribute('href', whatsappShareUrl(link, name));
    if (copyBtn) {
        copyBtn.onclick = async () => {
            const ok = await copyText(link);
            const original = 'Copiar link';
            copyBtn.textContent = ok ? 'Link copiado!' : 'Copie manualmente';
            if (!ok && input) { input.focus(); input.select(); }
            setTimeout(() => { copyBtn.textContent = original; }, 2200);
        };
    }
    section.style.display = '';
}

function renderNotifications(portal) {
    const section = $('notifications-section');
    const list = $('notifications-list');
    const count = $('notifications-count');
    if (!section || !list) return;

    const items = buildNotifications(portal);
    if (count) count.textContent = String(items.length);

    list.innerHTML = items.length
        ? items.map((n) => `
            <li class="notif-item ${escapeHtml(n.type)}">
                <strong>${escapeHtml(n.title)}</strong>
                <span>${escapeHtml(n.detail)}</span>
                ${n.at ? `<small>${escapeHtml(formatDate(n.at))}</small>` : ''}
            </li>`).join('')
        : '<li class="empty-stores">Sem novidades nos últimos 30 dias.</li>';

    section.style.display = '';
}

function renderStores(portal) {
    const section = $('stores-section');
    const list = $('stores-list');
    const count = $('stores-count');
    if (!section || !list) return;

    const stores = Array.isArray(portal.stores) ? portal.stores : [];
    if (count) count.textContent = `${stores.length} ${stores.length === 1 ? 'loja' : 'lojas'}`;

    if (!stores.length) {
        list.innerHTML = `
            <div class="empty-stores">
                Ainda não tem lojas vinculadas.<br>
                Partilhe o seu link de indicação ou use «Registar nova loja» mais abaixo —
                as lojas aparecem aqui assim que forem registadas.
            </div>`;
        section.style.display = '';
        return;
    }

    list.innerHTML = stores.map((s) => {
        const cls = classifyStore(s);
        const location = [s.address, s.city, s.province].filter(Boolean).join(', ') || 'Não informada';
        const adminLine = s.admin_email || s.admin_name
            ? `<div><strong>Administrador:</strong> ${escapeHtml([s.admin_name, displayLogin(s.admin_email)].filter(Boolean).join(' · '))}</div>`
            : '';
        const contract = Number(s.contract_duration_months) >= 999
            ? 'vitalício'
            : `${Number(s.months_active || 0)}/${Number(s.contract_duration_months || 12)} meses`;

        return `
            <article class="store-card">
                <div class="store-status-row">
                    <div class="store-name" style="margin:0;">${escapeHtml(s.name || 'Loja GEF')}</div>
                    <span class="badge ${escapeHtml(cls.badge)}">${escapeHtml(cls.label)}</span>
                </div>
                <div class="store-city">📍 ${escapeHtml(location)}</div>
                <div class="store-info">
                    <div><strong>Responsável:</strong> ${escapeHtml(s.owner_name || 'Não informado')}</div>
                    <div><strong>Contacto:</strong> ${escapeHtml(s.phone || 'Não informado')}</div>
                    ${adminLine}
                    <div><strong>Mensalidade:</strong> ${escapeHtml(formatMoney(s.monthly_fee))}</div>
                    <div><strong>Subscrição:</strong> ${escapeHtml(daysText(s.days_remaining))}${s.subscription_end ? ` (até ${escapeHtml(formatDate(s.subscription_end))})` : ''}</div>
                    <div><strong>Pagamentos:</strong> ${Number(s.payments_count || 0)}${s.last_payment_date ? ` · último ${escapeHtml(formatDate(s.last_payment_date))}` : ' · sem pagamentos'}</div>
                    <div><strong>Comissão:</strong> ${Number(s.commission_rate || 0)}% · ${escapeHtml(contract)}</div>
                </div>
                <div class="store-commission">Comissão recebida: ${escapeHtml(formatMoney(s.total_commission))}</div>
            </article>`;
    }).join('');

    section.style.display = '';
}

function renderOwnerPanel(portal) {
    renderMetrics(portal);
    renderShare(portal);
    renderNotifications(portal);
    renderStores(portal);
    const loading = $('owner-loading');
    if (loading) loading.style.display = 'none';
}


/* =========================================================
   CARREGAR PAINEL DO DONO
========================================================= */

async function readOwnerData() {
    const out = { hasSession: false, profileRole: null, profileError: null, portal: null, portalError: null };

    let session = null;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        session = data?.session || null;
    } catch (error) {
        // Sem conseguir ler a sessão: trata como sessão inválida (não mostra nada privado).
        out.hasSession = true;
        out.profileError = { message: 'jwt expired', cause: error };
        return out;
    }

    out.hasSession = Boolean(session?.user);
    if (!out.hasSession) return out;

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();
        if (error) out.profileError = error;
        else out.profileRole = data?.role ?? null;
    } catch (error) {
        out.profileError = error;
    }
    if (out.profileError || normalizeCode(out.profileRole) !== 'EMBAIXADOR') return out;

    try {
        const { data, error } = await supabase.rpc('fn_ambassador_portal', { p_ambassador_id: null });
        if (error) out.portalError = error;
        else out.portal = data;
    } catch (error) {
        out.portalError = error;
    }
    return out;
}

async function loadOwnerPanel() {
    if (ownerLoading || !supabase) return;
    ownerLoading = true;

    const firstLoad = !lastPortal;
    if (firstLoad) {
        const loading = $('owner-loading');
        // Só mostra "a carregar" a quem tem sessão (um visitante não vê nada a piscar).
        try {
            const { data } = await supabase.auth.getSession();
            if (loading && data?.session) loading.style.display = 'block';
        } catch (e) { /* ignora */ }
    }

    try {
        const input = await readOwnerData();
        const access = evaluateAccess({ ...input, urlCode: ambassadorCode });

        if (access.state === 'ready' || access.state === 'empty') {
            lastPortal = input.portal;
            panelState.ownerMode = true;
            panelState.ambassadorId = input.portal.ambassador?.id || null;
            panelState.referralCode = input.portal.ambassador?.referral_code || null;
            renderOwnerPanel(input.portal);
            setCtaForOwner(true);

            const warnings = Array.isArray(input.portal.warnings) ? input.portal.warnings : [];
            if (warnings.length) {
                showHint({ tone: 'error', text: `Parte da informação não pôde ser lida e pode estar incompleta: ${warnings.join(' | ')}` }, { retry: true });
            } else {
                hideHint();
            }
            return;
        }

        // Falha temporária (rede/erro) com painel já mostrado: mantém a última informação.
        if (lastPortal && (access.state === 'network_error' || access.state === 'error')) {
            showHint({
                tone: 'error',
                text: `${access.message.text} A mostrar a última informação carregada.`
            }, { retry: true });
            return;
        }

        // Qualquer outro estado: nenhum dado privado fica no ecrã.
        lastPortal = null;
        panelState.ownerMode = false;
        panelState.ambassadorId = null;
        panelState.referralCode = null;
        hideOwnerPanel();
        setCtaForOwner(false);
        showHint(access.message, { retry: access.state === 'network_error' || access.state === 'error' });
    } finally {
        ownerLoading = false;
        const loading = $('owner-loading');
        if (loading) loading.style.display = 'none';
    }
}

function startOwnerAutoRefresh() {
    const refresh = () => { if (!document.hidden && panelState.ownerMode) loadOwnerPanel(); };
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);

    // Sessão terminou noutro separador / expirou: retira o painel de imediato.
    try {
        supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') loadOwnerPanel();
        });
    } catch (error) {
        console.warn('Não foi possível observar a sessão:', error);
    }
}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function init() {
    ambassadorCode = getAmbassadorCode();

    if (!ambassadorCode) {
        showPublicError('Link de embaixador inválido ou incompleto.');
        return;
    }

    if (!isSupabaseConfigured() || !supabaseClient) {
        showPublicError('A ligação ao Supabase não está configurada.');
        return;
    }
    supabase = supabaseClient;

    // 1) Vista pública (só nome/código/estado do embaixador)
    try {
        const { data, error } = await supabase.rpc('fn_get_public_ambassador_dashboard', {
            p_referral_code: ambassadorCode
        });

        if (error) {
            console.error('Erro ao carregar o embaixador:', error);
            showPublicError('Não foi possível carregar os dados do link do embaixador.');
        } else if (!data || data.valid === false) {
            showPublicError(data?.message || 'Este link de embaixador não é válido.');
        } else {
            publicAmbassador = data;
            renderAmbassador();
            configureCTA();
        }
    } catch (error) {
        console.error('Erro na página pública do embaixador:', error);
        showPublicError('Ocorreu um erro ao carregar o link do embaixador.');
    }

    // 2) Vista do dono do link (precisa de sessão + confirmação do servidor)
    panelState.refresh = loadOwnerPanel;
    await loadOwnerPanel();
    startOwnerAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
