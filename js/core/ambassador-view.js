/**
 * GEF - GESTÃO FINANCEIRA | PAINEL DO EMBAIXADOR: LÓGICA PARTILHADA
 * JavaScript Puro (Vanilla JS)
 *
 * Sem acesso ao DOM nem ao Supabase: só recebe dados já lidos (de fn_ambassador_portal) e
 * devolve decisões/estruturas. Usado por adesao-publica.js, adesao.js e modules/embaixadores.
 *
 * IMPORTANTE (segurança): nada aqui concede permissões. Quem decide o que o utilizador pode ver
 * é o Postgres (fn_ambassador_portal liga SEMPRE ao ambassadors.user_id = auth.uid() + RLS).
 * Estas funções só traduzem o resultado em mensagens e estados de ecrã.
 */

/** Estado partilhado entre adesao-publica.js (mostra o painel) e adesao.js (formulário). */
export const panelState = {
  ownerMode: false,     // true só quando o servidor confirmou que o login é o dono deste link
  ambassadorId: null,
  referralCode: null,
  refresh: null         // função registada por adesao-publica.js para recarregar o painel
};

export const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

/**
 * Link pessoal de indicação. Mesma regra do módulo do embaixador:
 * SITE_URL (se definido) tem prioridade; senão deduz-se do endereço actual.
 */
export function buildReferralLink(code, { siteUrl = '', location = null } = {}) {
  const encoded = encodeURIComponent(code || '');
  const fixedBase = String(siteUrl || '').trim().replace(/\/+$/, '').replace(/\/adesao\.html.*$/, '');
  if (fixedBase) return `${fixedBase}/adesao.html?embaixador=${encoded}`;

  const loc = location || (typeof window !== 'undefined' ? window.location : { origin: '', pathname: '/' });
  const pathname = loc.pathname || '/';
  const basePath = pathname.endsWith('/') ? pathname : pathname.substring(0, pathname.lastIndexOf('/') + 1) || '/';
  return `${loc.origin}${basePath.startsWith('/') ? basePath : '/' + basePath}adesao.html?embaixador=${encoded}`;
}

/** Endereço wa.me com a mensagem de convite já preenchida (o embaixador escolhe o contacto). */
export function whatsappShareUrl(link, ambassadorName = '') {
  const who = String(ambassadorName || '').trim();
  const text =
    `Olá! ${who ? `Sou ${who}, embaixador` : 'Sou embaixador'} do GEF – Gestão Financeira. ` +
    `Registe a sua loja através do meu link: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Estado de cada loja, usando SÓ os estados que a base de dados devolve
 * (fn_ambassador_portal -> subscription_status: SEM_LOJA | BLOQUEADA | EXPIRADA | EM_TESTE | ATIVA).
 * Não existe estado "aprovada" na base: não é inventado aqui.
 */
export function classifyStore(store) {
  const status = String(store?.subscription_status || '').toUpperCase();
  const days = store?.days_remaining;
  const hasDays = days !== null && days !== undefined && days !== '' && Number.isFinite(Number(days));

  switch (status) {
    case 'BLOQUEADA':
      return { key: 'bloqueada', label: 'Bloqueada', badge: 'badge-red' };
    case 'EXPIRADA':
      return { key: 'em_atraso', label: 'Em atraso', badge: 'badge-red' };
    case 'EM_TESTE':
      return { key: 'pendente', label: 'Pendente (1.º pagamento)', badge: 'badge-blue' };
    case 'ATIVA':
      if (hasDays && Number(days) >= 0 && Number(days) <= 7) {
        return { key: 'a_vencer', label: 'A vencer', badge: 'badge-amber' };
      }
      return { key: 'regular', label: 'Regular', badge: 'badge-emerald' };
    case 'SEM_LOJA':
      return { key: 'sem_loja', label: 'Sem loja associada', badge: 'badge-amber' };
    default:
      return { key: 'desconhecido', label: status ? status : 'Sem estado', badge: 'badge-amber' };
  }
}

/** Contagens do resumo. "Activas" = loja real criada e não bloqueada (não existe "aprovada" na base). */
export function summarizeStores(stores) {
  const list = Array.isArray(stores) ? stores : [];
  const out = { total: list.length, ativas: 0, pendente: 0, regular: 0, a_vencer: 0, em_atraso: 0, bloqueada: 0, sem_loja: 0 };
  for (const s of list) {
    const c = classifyStore(s).key;
    if (c in out) out[c] += 1;
    if (s?.has_store !== false && c !== 'bloqueada' && c !== 'sem_loja') out.ativas += 1;
  }
  return out;
}

const DAY_MS = 86400000;
const toTime = (d) => {
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const fmtMoney = (n) => Number(n || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MT';
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

/**
 * Notificações derivadas SÓ de dados reais já devolvidos pelo servidor (não há tabela de
 * notificações): novas adesões, lojas em atraso/bloqueadas/a vencer, comissões e liquidações recentes.
 */
export function buildNotifications(portal, { now = Date.now(), windowDays = 30, limit = 15 } = {}) {
  const stores = Array.isArray(portal?.stores) ? portal.stores : [];
  const payments = Array.isArray(portal?.payments) ? portal.payments : [];
  const payouts = Array.isArray(portal?.payouts) ? portal.payouts : [];
  const since = now - windowDays * DAY_MS;
  const items = [];

  for (const s of stores) {
    const name = s.name || 'Loja';
    const cls = classifyStore(s).key;
    const days = Number(s.days_remaining);

    if (cls === 'bloqueada') {
      items.push({ id: `blk-${s.id}`, type: 'danger', at: null, rank: 0, title: `Loja bloqueada: ${name}`, detail: 'O acesso desta loja foi suspenso pela administração.' });
    } else if (cls === 'em_atraso') {
      const d = Number.isFinite(days) ? Math.abs(days) : null;
      items.push({ id: `late-${s.id}`, type: 'danger', at: null, rank: 1, title: `Subscrição em atraso: ${name}`, detail: d === null ? 'A subscrição expirou.' : `Expirou há ${plural(d, 'dia', 'dias')}.` });
    } else if (cls === 'a_vencer') {
      items.push({ id: `due-${s.id}`, type: 'warning', at: null, rank: 2, title: `A vencer: ${name}`, detail: days === 0 ? 'Vence hoje.' : `Vence em ${plural(days, 'dia', 'dias')}.` });
    }

    const created = toTime(s.created_at);
    if (created !== null && created >= since) {
      items.push({ id: `new-${s.id}`, type: 'info', at: created, rank: 3, title: `Nova adesão: ${name}`, detail: [s.city, s.owner_name].filter(Boolean).join(' · ') || 'Loja registada através do seu link.' });
    }
  }

  for (const p of payments) {
    const at = toTime(p.paid_at);
    if (at !== null && at >= since) {
      items.push({ id: `pay-${p.id}`, type: 'success', at, rank: 4, title: `Comissão gerada: +${fmtMoney(p.commission_amount)}`, detail: `Pagamento de ${p.store_name || 'uma loja sua'} (${fmtMoney(p.payment_amount)}).` });
    }
  }

  for (const po of payouts) {
    const at = toTime(po.created_at);
    if (at !== null && at >= since) {
      items.push({ id: `out-${po.id}`, type: 'success', at, rank: 4, title: `Liquidação recebida: ${fmtMoney(po.amount)}`, detail: po.method ? `Via ${po.method}.` : 'Comissão liquidada pela administração.' });
    }
  }

  // Alertas de estado primeiro (por gravidade); depois eventos datados, do mais recente para o mais antigo.
  items.sort((a, b) => {
    const aAlert = a.at === null, bAlert = b.at === null;
    if (aAlert !== bAlert) return aAlert ? -1 : 1;
    if (aAlert && bAlert) return a.rank - b.rank;
    return b.at - a.at;
  });
  return items.slice(0, limit);
}

/** Texto para cada estado de acesso (nunca mostra dados privados). */
export const ACCESS_MESSAGES = {
  anonymous: { tone: 'info', text: 'Para ver as suas lojas e comissões, entre com a conta de embaixador.' },
  session_expired: { tone: 'error', text: 'A sua sessão expirou. Entre novamente para ver o seu painel.' },
  wrong_role: { tone: 'error', text: 'A sessão actual não é de um Embaixador. Entre com a sua conta de embaixador para ver o painel.' },
  not_linked: { tone: 'error', text: 'Esta conta não está ligada a nenhum cadastro de embaixador. Peça ao administrador para confirmar o seu acesso.' },
  other_link: { tone: 'info', text: 'Este link pertence a outro embaixador. O seu painel pessoal está disponível no sistema.' },
  network_error: { tone: 'error', text: 'Falha de rede ao carregar o painel. Verifique a ligação e tente novamente.' },
  error: { tone: 'error', text: 'Não foi possível carregar o painel agora. Tente novamente dentro de instantes.' }
};

const isExpiredError = (e) => {
  const text = `${e?.code || ''} ${e?.status || ''} ${e?.message || ''}`;
  return /jwt|expired|PGRST301|not authenticated|Sessão não autenticada|401/i.test(text);
};
const isNetworkError = (e) => {
  const text = `${e?.name || ''} ${e?.message || ''}`;
  return /failed to fetch|networkerror|network request failed|load failed|TypeError/i.test(text);
};

/**
 * Decide o que o ecrã pode mostrar. A autorização REAL já foi feita no servidor
 * (fn_ambassador_portal só devolve o registo ligado ao auth.uid() do pedido).
 *
 * @param {object} i
 * @param {boolean} i.hasSession      existe sessão Supabase Auth
 * @param {string|null} i.profileRole role em public.profiles do utilizador autenticado
 * @param {object|null} i.profileError erro ao ler o perfil
 * @param {object|null} i.portal      resposta de fn_ambassador_portal
 * @param {object|null} i.portalError erro do RPC
 * @param {string} i.urlCode          código do embaixador no URL
 * @returns {{state:string, message?:{tone:string,text:string}}}
 */
export function evaluateAccess({ hasSession, profileRole, profileError, portal, portalError, urlCode }) {
  const deny = (state) => ({ state, message: ACCESS_MESSAGES[state] });

  if (!hasSession) return deny('anonymous');

  if (profileError) return deny(isExpiredError(profileError) ? 'session_expired' : isNetworkError(profileError) ? 'network_error' : 'error');
  if (normalizeCode(profileRole) !== 'EMBAIXADOR') return deny('wrong_role');

  if (portalError) return deny(isExpiredError(portalError) ? 'session_expired' : isNetworkError(portalError) ? 'network_error' : 'error');
  if (!portal || portal.unavailable) return deny('error');
  if (portal.ok === false) return deny('not_linked');

  const ownCode = normalizeCode(portal?.ambassador?.referral_code);
  if (!ownCode || ownCode !== normalizeCode(urlCode)) return deny('other_link');

  const stores = Array.isArray(portal.stores) ? portal.stores : [];
  return { state: stores.length === 0 ? 'empty' : 'ready' };
}

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
