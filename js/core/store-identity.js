/**
 * GEF | IDENTIDADE (ÍCONE PERSONALIZADO) DA LOJA VIRTUAL PÚBLICA
 *
 * A fonte é a mesma que o ERP usa (Configurações → Identidade da Aplicação = tabela store_app_identity), lida por
 * fn_public_store_identity(p_slug) (migracao_icone_loja_virtual_v15.sql). A loja é sempre a do endereço público (slug).
 *
 * Aplica o ícone em: favicon do separador, apple-touch-icon, manifesto (atalho / «instalar»), theme-color e cabeçalho.
 * Anti-cache: cada upload gera um ficheiro com nome único e cada gravação sobe `version`; todos os URLs levam ?v=<version>.
 *
 * As funções "puras" (normalize/build/cache) não tocam no DOM e são testadas em tests/.
 */
import { publicImageUrl } from './image-utils.js';

export const DEFAULT_ICON = './assets/icons/icon.svg';
const HEX = /^#[0-9A-Fa-f]{6}$/;
const FALLBACK_COLOR = '#0f172a';

/** Só aceita caminhos relativos do Storage no formato esperado (<loja>/identity/<ficheiro>), sem '..'. */
const okPath = (p) => typeof p === 'string' && p.length > 0 && p.length <= 300 && !p.includes('..') && /^[^/]+\/identity\/[^/]+$/.test(p);

/** Acrescenta ?v=<versão> ao URL (força o navegador a ignorar uma cópia antiga). */
export function withVersion(url, version) {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version ?? 0))}`;
}

/**
 * Resposta de fn_public_store_identity -> dados prontos a usar, ou null se a loja não tem ícone configurado
 * (nesse caso a loja usa o padrão). Nunca lança.
 */
export function normalizePublicIdentity(raw) {
  if (!raw || raw.ok !== true || raw.configured !== true) return null;
  if (!okPath(raw.icon_192_path)) return null;
  const v = raw.version ?? 0;
  const url = (p) => (okPath(p) ? withVersion(publicImageUrl(p), v) : '');
  const name = String(raw.app_name || '').slice(0, 40);
  if (!name) return null;
  return {
    name, shortName: String(raw.short_name || name).slice(0, 12),
    logoUrl: url(raw.logo_path), icon192Url: url(raw.icon_192_path), icon512Url: url(raw.icon_512_path),
    maskableUrl: url(raw.icon_maskable_path), appleUrl: url(raw.apple_icon_path),
    themeColor: HEX.test(raw.theme_color || '') ? raw.theme_color : FALLBACK_COLOR,
    backgroundColor: HEX.test(raw.background_color || '') ? raw.background_color : FALLBACK_COLOR,
    version: v
  };
}

/** Chave que identifica o estado visual (muda se a versão mudar, se passar a haver/deixar de haver ícone). */
export const identityKey = (i) => (i ? `v${i.version}|${i.icon192Url}` : 'none');

/** Ícone do cabeçalho: ícone personalizado da loja > logótipo da «Personalização» da loja virtual > nada. */
export function headerIconUrl(identity, config) {
  if (identity && (identity.logoUrl || identity.icon192Url)) return identity.logoUrl || identity.icon192Url;
  return config && config.logo_path ? publicImageUrl(config.logo_path) : '';
}

/** Alternativa se o ícone personalizado não carregar (ficheiro apagado, rede): logótipo da loja virtual. */
export const headerFallbackUrl = (config) => (config && config.logo_path ? publicImageUrl(config.logo_path) : '');

/** Manifesto próprio da loja (URLs ABSOLUTOS: um manifesto em blob: não resolve caminhos relativos). */
export function buildStoreManifest(i, slug, pageUrl) {
  const page = new URL(pageUrl);
  page.search = ''; page.hash = '';
  const start = new URL(page.href); start.searchParams.set('s', slug);
  const icons = [
    { src: i.icon192Url, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: i.icon512Url || i.icon192Url, sizes: '512x512', type: 'image/png', purpose: 'any' }
  ];
  if (i.maskableUrl) icons.push({ src: i.maskableUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return {
    name: i.name, short_name: i.shortName, description: `${i.name} — loja virtual.`,
    id: start.href, start_url: start.href, scope: page.href,
    display: 'standalone', lang: 'pt', background_color: i.backgroundColor, theme_color: i.themeColor, icons
  };
}

/** Chave do pequeno registo local usado só para pintar o ícone certo logo à abertura (o servidor corrige de seguida). */
export const cacheKey = (slug) => `gef_lj_icon_${String(slug || '').toLowerCase()}`;

// ------------------------------------------------------------------ DOM
let blobUrl = null;
function revokeBlob() { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* nada */ } blobUrl = null; } }
function setLink(rel, href, type) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!href) { if (el && rel !== 'icon') el.remove(); return; }
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  if (el.getAttribute('href') !== href) el.setAttribute('href', href);
  if (type) el.setAttribute('type', type); else el.removeAttribute('type');
  el.removeAttribute('sizes');
}
function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
  el.setAttribute('content', content);
}

/** Aplica (ou, com null, repõe o padrão) o ícone da loja no documento e guarda o registo local desta loja. */
export function applyIdentityToDocument(identity, slug, pageUrl = location.href) {
  revokeBlob();
  if (identity) {
    setLink('icon', identity.icon192Url, 'image/png');
    setLink('apple-touch-icon', identity.appleUrl || identity.icon192Url);
    setMeta('theme-color', identity.themeColor);
    setMeta('apple-mobile-web-app-title', identity.shortName);
    setMeta('application-name', identity.name);
    setMeta('mobile-web-app-capable', 'yes');
    try {
      blobUrl = URL.createObjectURL(new Blob([JSON.stringify(buildStoreManifest(identity, slug, pageUrl))], { type: 'application/manifest+json' }));
      setLink('manifest', blobUrl);
    } catch (e) { /* sem manifesto: o resto continua a funcionar */ }
    try { localStorage.setItem(cacheKey(slug), JSON.stringify({ icon: identity.icon192Url, v: identity.version })); } catch (e) { /* ignora */ }
  } else {
    setLink('icon', DEFAULT_ICON, 'image/svg+xml');
    setLink('apple-touch-icon', null);
    setLink('manifest', null);
    setMeta('theme-color', FALLBACK_COLOR);
    try { localStorage.removeItem(cacheKey(slug)); } catch (e) { /* ignora */ }
  }
}
