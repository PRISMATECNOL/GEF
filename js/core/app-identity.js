/**
 * GEF | IDENTIDADE DA APLICAÇÃO (PWA) POR LOJA
 *
 * - A loja é identificada SÓ no servidor (fn_app_identity_get usa auth.uid() -> profiles.store_id).
 *   Nada é lido de e-mail, localStorage ou parâmetros do URL para decidir de que loja é a identidade.
 * - A identidade só é pedida e aplicada depois de a sessão estar autenticada; antes do login (e depois do logout)
 *   vale sempre o padrão GEF e NÃO existe <link rel="manifest"> (por isso o navegador não oferece instalação antes do login).
 * - Fica apenas em memória (nunca em cache do Service Worker nem em localStorage).
 * - Sem configuração (ou migracao_identidade_pwa_v12.sql ainda não executada): usa-se o padrão GEF.
 *
 * Eventos: window 'gef:identity' -> { detail: { authenticated, identity, custom, userId } }
 */
import { db } from './database.js';
import { publicImageUrl } from './image-utils.js';

export const DEFAULT_IDENTITY = Object.freeze({
  name: 'GEF Gestão Financeira ERP', shortName: 'GEF',
  iconUrl: 'assets/icons/icon.svg', icon192Url: 'assets/icons/pwa-192x192.png', appleUrl: 'assets/icons/apple-touch-icon.png',
  themeColor: '#020617'
});

const state = { identity: null, custom: false, authenticated: false, userId: null, version: null, blobUrl: null, getUser: null, lastFetch: 0, token: 0, watching: false, warned: false };

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const absolute = (rel) => new URL(rel, location.href).href;

/** Dados normalizados e prontos a usar (URLs absolutas dos ficheiros públicos do Storage). */
function normalize(raw) {
  if (!raw || !raw.configured || !raw.store_id) return null;
  const url = (p) => (p ? publicImageUrl(p) : '');
  return {
    storeId: raw.store_id, storeName: raw.store_name || '',
    name: raw.app_name, shortName: raw.short_name || raw.app_name,
    logoUrl: url(raw.logo_path), icon192Url: url(raw.icon_192_path), icon512Url: url(raw.icon_512_path),
    maskableUrl: url(raw.icon_maskable_path), appleUrl: url(raw.apple_icon_path),
    themeColor: raw.theme_color || '#020617', backgroundColor: raw.background_color || '#020617',
    version: raw.version
  };
}

/** Dados para o cabeçalho: ícone + nome da loja autenticada, ou o padrão GEF. */
export function getBrand() {
  const i = state.identity;
  if (state.authenticated && i) {
    return { custom: true, name: i.name, shortName: i.shortName, iconUrl: i.logoUrl || i.icon192Url || DEFAULT_IDENTITY.iconUrl };
  }
  return { custom: false, name: 'GEF', shortName: 'GEF', iconUrl: DEFAULT_IDENTITY.iconUrl };
}

/** HTML interno do botão da marca (usado pelo navbar e pela actualização ao vivo). Tudo escapado. */
export function brandHtml() {
  const b = getBrand();
  const img = `<img src="${esc(b.iconUrl)}" alt="${esc(b.custom ? b.name : 'GEF Logo')}" data-brand-img style="height:36px;width:36px;border-radius:8px;object-fit:contain;" onerror="this.onerror=null;this.src='${DEFAULT_IDENTITY.iconUrl}'">`;
  if (b.custom) {
    return `${img}
      <div class="brand-info">
        <div class="brand-title"><span class="gef" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(b.name)}</span><span class="tag">GEF</span></div>
        <span class="brand-sub">Gestão completa do seu negócio</span>
      </div>`;
  }
  return `${img}
      <div class="brand-info">
        <div class="brand-title">
          <span class="gef">GEF</span>
          <span style="color: #f59e0b; font-weight: 800; font-size: 11px;">GESTÃO FINANCEIRA</span>
          <span class="tag">ERP / SAAS</span>
        </div>
        <span class="brand-sub">Gestão completa do seu negócio</span>
      </div>`;
}

// ---------------------------------------------------------------- manifesto / meta
function setLink(rel, href, extra) {
  let el = document.head.querySelector(`link[rel="${rel}"]${extra || ''}`);
  if (!href) { if (el && rel === 'manifest') el.remove(); return; }
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  if (el.getAttribute('href') !== href) el.setAttribute('href', href);
}
function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
  el.setAttribute('content', content);
}
function revokeBlob() { if (state.blobUrl) { try { URL.revokeObjectURL(state.blobUrl); } catch (e) { /* nada */ } state.blobUrl = null; } }

/** Manifesto da loja (URLs ABSOLUTAS: um manifesto em blob: não resolve caminhos relativos). */
export function buildManifest(i) {
  const scope = new URL('./', location.href).href;
  const icons = [
    { src: i.icon192Url, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: i.icon512Url, sizes: '512x512', type: 'image/png', purpose: 'any' }
  ];
  if (i.maskableUrl) icons.push({ src: i.maskableUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return {
    name: i.name, short_name: i.shortName,
    description: `${i.name} — gestão da loja (GEF).`,
    id: `${scope}?app=${encodeURIComponent(i.storeId)}`,
    start_url: `${scope}index.html?source=pwa`, scope,
    display: 'standalone', orientation: 'any', lang: 'pt-MZ',
    background_color: i.backgroundColor, theme_color: i.themeColor,
    categories: ['business', 'finance', 'productivity'],
    icons
  };
}

function applyToDocument() {
  const i = state.identity;
  if (state.authenticated && i) {
    document.title = i.name;
    setMeta('apple-mobile-web-app-title', i.shortName);
    setMeta('application-name', i.name);
    setMeta('theme-color', i.themeColor);
    setLink('apple-touch-icon', i.appleUrl || i.icon192Url);
    const fav = i.icon192Url; if (fav) { setLink('icon', fav); const f = document.head.querySelector('link[rel="icon"]'); if (f) f.type = 'image/png'; }
    revokeBlob();
    const blob = new Blob([JSON.stringify(buildManifest(i))], { type: 'application/manifest+json' });
    state.blobUrl = URL.createObjectURL(blob);
    setLink('manifest', state.blobUrl);
  } else if (state.authenticated) {
    // Autenticado mas a loja não tem identidade: padrão GEF (manifesto estático), só depois do login.
    revokeBlob();
    document.title = DEFAULT_IDENTITY.name;
    setMeta('apple-mobile-web-app-title', DEFAULT_IDENTITY.shortName);
    setMeta('theme-color', DEFAULT_IDENTITY.themeColor);
    setLink('apple-touch-icon', DEFAULT_IDENTITY.appleUrl);
    setLink('icon', DEFAULT_IDENTITY.iconUrl);
    const f = document.head.querySelector('link[rel="icon"]'); if (f) f.type = 'image/svg+xml';
    setLink('manifest', 'manifest.webmanifest');
  } else {
    revokeBlob();
    document.title = DEFAULT_IDENTITY.name;
    setMeta('apple-mobile-web-app-title', DEFAULT_IDENTITY.shortName);
    setMeta('application-name', DEFAULT_IDENTITY.name);
    setMeta('theme-color', DEFAULT_IDENTITY.themeColor);
    setLink('apple-touch-icon', DEFAULT_IDENTITY.appleUrl);
    setLink('icon', DEFAULT_IDENTITY.iconUrl);
    const f = document.head.querySelector('link[rel="icon"]'); if (f) f.type = 'image/svg+xml';
    setLink('manifest', null);
  }
  // Marca no cabeçalho (se já existir)
  const brand = $('#nav-brand-btn');
  if (brand) brand.innerHTML = brandHtml();
}

function emit() {
  window.dispatchEvent(new CustomEvent('gef:identity', {
    detail: { authenticated: state.authenticated, identity: state.identity, custom: !!(state.authenticated && state.identity), userId: state.userId }
  }));
}

// ---------------------------------------------------------------- API pública
/** Liga o serviço ao utilizador autenticado (função que devolve o utilizador actual). */
export function init(getUser) { state.getUser = getUser; }

/**
 * Pede ao servidor a identidade da loja do utilizador autenticado e aplica-a.
 * Nunca lança: em falha mantém a identidade anterior (se for do mesmo utilizador) ou usa o padrão.
 */
export async function refresh() {
  const user = state.getUser ? state.getUser() : null;
  if (!user || user.active === false) { clear(); return null; }
  const token = ++state.token;
  let raw = null, failed = false;
  try { raw = await db.rpcV7('fn_app_identity_get', {}); }
  catch (e) {
    failed = true;
    if (!state.warned) { state.warned = true; console.warn('[GEF] Identidade da aplicação indisponível (executou migracao_identidade_pwa_v12.sql?):', e.message); }
  }
  // O utilizador mudou ou saiu enquanto o pedido estava a decorrer: descarta a resposta (nunca mistura lojas).
  const now = state.getUser ? state.getUser() : null;
  if (token !== state.token || !now || now.id !== user.id) return null;

  state.lastFetch = Date.now();
  if (failed && state.userId === user.id && state.authenticated) return state.identity; // mantém o que já havia
  const next = failed ? null : normalize(raw);
  const changed = !state.authenticated || state.userId !== user.id || (next ? next.version : null) !== (state.identity ? state.identity.version : null) || (!!next !== !!state.identity)
    || (next && state.identity && next.storeId !== state.identity.storeId);
  state.authenticated = true; state.userId = user.id; state.identity = next;
  if (changed) { applyToDocument(); emit(); }
  startWatching();
  return next;
}

/** Logout / sessão inválida: apaga TODO o estado visual da loja anterior. */
export function clear() {
  state.token++;
  const had = state.authenticated || !!state.identity;
  state.identity = null; state.authenticated = false; state.userId = null; state.lastFetch = 0;
  applyToDocument();
  if (had) emit();
}

export function get() { return state.authenticated ? state.identity : null; }

/** Mantém a identidade actualizada durante a navegação: ao voltar ao separador e de 5 em 5 minutos. */
function startWatching() {
  if (state.watching) return;
  state.watching = true;
  const tick = () => { if (state.authenticated && document.visibilityState === 'visible' && Date.now() - state.lastFetch > 60000) refresh(); };
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  setInterval(tick, 5 * 60 * 1000);
}

export const appIdentity = { init, refresh, clear, get, getBrand, brandHtml, buildManifest };
