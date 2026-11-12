/**
 * GEF | LOJA VIRTUAL PÚBLICA (loja.html?s=<endereço-da-loja>[&p=<id-do-produto>])
 * - Todos os dados vêm de funções RPC públicas do servidor (catálogo real, só produtos publicados).
 * - O servidor valida preços, promoções, cores e stock ao receber a encomenda; o carrinho aqui é só conveniência.
 * - Link de produto = id do produto (estável mesmo que o nome/preço mudem); abre directamente o produto certo.
 */
import { supabase } from './core/supabase.js';
import { publicImageUrl } from './core/image-utils.js';
import { printReceipt } from './core/order-receipt.js';
import { initInstall } from './loja-install.js';
import { initCustomer, prefill, isLoggedIn } from './loja-cliente.js';
import { downloadOrderPdf } from './core/order-pdf.js';
import { receiptOptions, loadPaymentInfo, paymentBlockHtml, storeLogoUrl } from './core/order-ui.js';
import { storeUrl, productUrl, shareLink } from './components/share-link.js';
import { normalizePublicIdentity, identityKey, headerIconUrl, headerFallbackUrl, applyIdentityToDocument } from './core/store-identity.js';

const $app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (sel, root = document) => root.querySelector(sel);

const params = new URLSearchParams(window.location.search);
const m = window.location.pathname.match(/\/loja\/([^/]+)(?:\/produto\/([^/]+))?/); // opcional: se o alojamento reescrever /loja/<slug>/produto/<id>
const SLUG = (params.get('s') || (m && decodeURIComponent(m[1])) || '').toLowerCase();
const DIRECT_PRODUCT = params.get('p') || (m && m[2] && decodeURIComponent(m[2])) || null;

const relStore = () => `loja.html?s=${encodeURIComponent(SLUG)}`;
const relProduct = (id) => `${relStore()}&p=${encodeURIComponent(id)}`;
const S = { lastPage: [], store: null, items: [], cursor: null, loading: false, filters: { q: '', category: '', subcategory: '', sort: 'recent', promo: false }, seq: 0, promos: [], featured: [], cart: [], product: null, color: null, qty: 1, img: 0, identity: null, identityKey: 'none', identityAt: 0 };
let searchTimer = null;

const money = (n) => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(S.store?.currency || 'MT')}`;

const logoUrl = () => storeLogoUrl(S.identity, headerFallbackUrl(S.store && S.store.config));
const fmtDT = (d) => new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });

function toast(msg) {
  let t = q('.lj-toast');
  if (!t) { t = document.createElement('div'); t.className = 'lj-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:999px;z-index:99;font-size:14px;max-width:90vw'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

async function rpc(name, args) {
  if (!supabase) throw new Error('Loja indisponível de momento.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error((error.message || 'Erro').replace(/^.*?:\s*/, ''));
  return data;
}

/* ---------- carrinho (conveniência local; nunca é fonte de verdade) ---------- */
const cartKey = () => `gef_cart_${SLUG}`;
const loadCart = () => { try { S.cart = JSON.parse(localStorage.getItem(cartKey()) || '[]').filter((l) => l && l.productId && l.qty > 0).slice(0, 30); } catch (e) { S.cart = []; } };
const saveCart = () => { try { localStorage.setItem(cartKey(), JSON.stringify(S.cart)); } catch (e) { /* ignora */ } };
const cartCount = () => S.cart.reduce((n, l) => n + Number(l.qty), 0);
const cartTotal = () => S.cart.reduce((n, l) => n + Number(l.qty) * Number(l.price), 0);
function idemKey() { let k = sessionStorage.getItem(`gef_idem_${SLUG}`); if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)); sessionStorage.setItem(`gef_idem_${SLUG}`, k); } return k; }

/* ---------- ícone personalizado da loja (favicon, atalhos, cabeçalho) ---------- */
let identityWarned = false;
/** undefined = não foi possível saber (mantém o que está); null = loja sem ícone configurado; objecto = ícone da loja. */
async function fetchIdentity() {
  try { return normalizePublicIdentity(await rpc('fn_public_store_identity', { p_slug: SLUG })); }
  catch (e) {
    if (!identityWarned) { identityWarned = true; console.warn('[GEF] Ícone da loja indisponível (executou migracao_icone_loja_virtual_v15.sql?):', e.message); }
    return undefined;
  }
}
function brandHtml() {
  const url = headerIconUrl(S.identity, S.store && S.store.config);
  return `${url ? `<img src="${esc(url)}" alt="" width="38" height="38" data-brand-img>` : ''}<span>${esc(S.store ? S.store.name : '')}</span>`;
}
function paintBrand() { const b = q('.lj-brand'); if (b) b.innerHTML = brandHtml(); }
/** Aplica uma identidade nova só se mudou (versão/ícone). Actualiza favicon, manifesto e cabeçalho. */
function syncIdentity(next) {
  S.identityAt = Date.now();
  if (next === undefined) return;
  const key = identityKey(next);
  if (key === S.identityKey && S.identityApplied) return;
  S.identity = next; S.identityKey = key; S.identityApplied = true;
  applyIdentityToDocument(next, SLUG);
  paintBrand();
}
async function refreshIdentity() { if (S.store) syncIdentity(await fetchIdentity()); }
// Se o ícone personalizado não carregar, usa o logótipo da loja virtual; se também falhar, esconde a imagem (sem ícone partido).
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-brand-img')) return;
  const fb = headerFallbackUrl(S.store && S.store.config);
  if (fb && img.getAttribute('src') !== fb) img.setAttribute('src', fb); else img.style.display = 'none';
}, true);
// Mantém o ícone actualizado: ao voltar ao separador e de 5 em 5 minutos (se o Administrador o alterar, a loja aberta acompanha).
{
  const tick = () => { if (document.visibilityState === 'visible' && Date.now() - S.identityAt > 60000) refreshIdentity(); };
  document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick); setInterval(tick, 5 * 60 * 1000);
}

/* ---------- tema ---------- */
/* v24 - temas extra (ex.: liquid_glass): cada tema que não seja um dos 4 originais tem o seu CSS em css/themes/<id>.css,
   carregado só quando a loja o tem activo. Novo tema = novo ficheiro CSS + uma linha em vstore_themes (sem alterar mais código). */
const BUILTIN_THEMES = ['classico', 'moderno', 'natureza', 'minimal'];
function loadThemeCss(id) {
  document.querySelectorAll('link[data-gef-theme]').forEach((l) => { if (l.getAttribute('data-gef-theme') !== id) l.remove(); });
  if (!/^[a-z0-9_-]{1,40}$/.test(id) || BUILTIN_THEMES.includes(id)) return;
  if (document.querySelector(`link[data-gef-theme="${id}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL(`../css/themes/${id}.css`, import.meta.url).href; l.setAttribute('data-gef-theme', id);
  document.head.appendChild(l);
}

function applyTheme() {
  const st = S.store; const themeId = String(st.theme || 'classico');
  loadThemeCss(themeId);
  document.documentElement.setAttribute('data-theme', themeId);
  const c = st.config || {};
  if (c.primary) document.documentElement.style.setProperty('--primary', c.primary);
  if (c.accent) document.documentElement.style.setProperty('--accent', c.accent);
  if (c.bg_path) {
    document.documentElement.style.setProperty('--bg-img', `url("${publicImageUrl(c.bg_path)}")`);
    document.body.classList.add('lj-has-bg');
  } else { document.body.classList.remove('lj-has-bg'); }
  document.title = `${st.name} | Loja virtual`;
}

/* ---------- vistas ---------- */
const card = (p) => `
  <article class="lj-card">
    <button class="lj-open" data-act="open" data-id="${esc(p.id)}"  aria-label="Ver ${esc(p.name)}">
      <div class="ph">${p.thumb || p.image ? `<img src="${esc(publicImageUrl(p.thumb || p.image))}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="400" height="400">` : ''}</div>
      <div class="bd"><div class="nm">${esc(p.name)}</div>
        <div><span class="lj-price">${money(p.effective_price)}</span>${p.on_promo ? `<span class="lj-old">${money(p.price)}</span>` : ''}</div>
        ${p.available ? '' : '<div class="lj-off">Indisponível</div>'}</div>
    </button>
    ${p.on_promo ? '<span class="lj-badge">Promoção</span>' : ''}${p.on_promo && p.promo_end ? `<div class="lj-meta">até ${esc(fmtDT(p.promo_end))}</div>` : ''}
    <button class="lj-share" data-act="share" data-id="${esc(p.id)}" data-name="${esc(p.name)}" aria-label="Partilhar ${esc(p.name)}" title="Partilhar / copiar link">🔗</button>
  </article>`;

const isFiltering = () => !!(S.filters.q || S.filters.category || S.filters.promo);

/** Conteúdo principal (secções, departamento, catálogo). Redesenhar isto NÃO recria a barra de pesquisa: o foco do teclado mantém-se. */
function mainHtml() {
  const st = S.store, c = st.config || {};
  const cats = st.categories || [];
  const sections = (c.sections && c.sections.length ? c.sections : ['promos', 'featured', 'categories', 'catalog']);
  const filtering = isFiltering();
  const f = S.filters;
  const curCat = cats.find((x) => x.name === f.category);
  const strip = (title, list) => list.length ? `<section class="lj-sec"><h2>${title}</h2><div class="lj-grid">${list.map(card).join('')}</div></section>` : '';

  // Departamento: ao escolher uma categoria a mesma página passa a mostrar só esse "departamento" (sem abrir outra página)
  const subs = curCat && Array.isArray(curCat.subs) ? curCat.subs : [];
  const dept = f.category ? `<section class="lj-dept" id="lj-dept" aria-label="Departamento ${esc(f.category)}">
      <div class="lj-dept-top"><button class="lj-back" data-act="cat" data-cat="">← Todas as categorias</button><span class="lj-dept-tag">Departamento</span></div>
      <h2>${esc(f.category)}${f.subcategory ? ` <span class="lj-dept-sub">› ${esc(f.subcategory)}</span>` : ''}</h2>
      ${curCat ? `<div class="lj-meta">${curCat.count} produto${curCat.count === 1 ? '' : 's'} neste departamento</div>` : ''}
      ${subs.length ? `<div class="lj-subs" role="group" aria-label="Subcategorias de ${esc(f.category)}">
        <button class="lj-chip" data-act="sub" data-sub="" aria-pressed="${!f.subcategory}">Tudo em ${esc(f.category)}</button>
        ${subs.map((x) => `<button class="lj-chip" data-act="sub" data-sub="${esc(x.name)}" aria-pressed="${f.subcategory === x.name}">${esc(x.name)} (${x.count})</button>`).join('')}</div>` : ''}
    </section>` : '';

  const heading = f.category ? `${esc(f.category)}${f.subcategory ? ' › ' + esc(f.subcategory) : ''}` : (f.q ? 'Resultados' : (f.promo ? 'Promoções' : 'Catálogo'));
  const parts = {
    promos: !filtering ? strip('Promoções', S.promos) : '',
    featured: !filtering ? strip('Em destaque', S.featured) : '',
    categories: `<div class="lj-chips${f.category ? ' has-sel' : ''}" role="group" aria-label="Categorias"><button class="lj-chip" data-act="cat" data-cat="" aria-pressed="${!f.category}">Todas</button>${cats.map((x) => `<button class="lj-chip" data-act="cat" data-cat="${esc(x.name)}" aria-pressed="${f.category === x.name}">${esc(x.name)} (${x.count})</button>`).join('')}</div>${dept}`,
    catalog: `<section class="lj-sec"><div class="lj-tools">
        <h2 style="margin:0;flex:1">${heading}</h2>
        ${f.q ? `<span class="lj-qtag">Pesquisa: “${esc(f.q)}” <button data-act="clear-search" aria-label="Limpar pesquisa">✕</button></span>` : ''}
        <label><input type="checkbox" id="lj-promo" ${f.promo ? 'checked' : ''}> Só promoções</label>
        <select id="lj-sort" aria-label="Ordenar"><option value="recent">Mais recentes</option><option value="name">Nome (A–Z)</option><option value="price_asc">Preço: menor</option><option value="price_desc">Preço: maior</option></select></div>
        <div class="lj-grid" id="lj-grid"></div><div id="lj-empty" class="lj-msg" hidden>Nenhum produto encontrado${f.q ? ` para “${esc(f.q)}”` : ''}.</div>
        <button class="lj-btn sec lj-more" data-act="more" hidden>Ver mais produtos</button></section>`
  };
  return sections.map((k) => parts[k] || '').join('');
}

function renderMain(scrollToDept = false) {
  const main = q('#lj-main'); if (!main) return;
  main.innerHTML = mainHtml();
  const sortEl = q('#lj-sort'); if (sortEl) sortEl.value = S.filters.sort;
  paintGrid();
  if (scrollToDept) { const d = q('#lj-dept'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function renderShell() {
  const st = S.store, c = st.config || {};
  $app.innerHTML = `
    <header class="lj-header"><div class="lj-wrap lj-top">
      <div class="lj-brand">${brandHtml()}</div>
      <div class="lj-actions"><button class="lj-btn sec lj-inst" id="lj-inst" hidden>⬇ Instalar app</button><button class="lj-btn sec" id="lj-acc" data-cx="account">👤 Entrar</button>
        <button class="lj-btn sec" data-act="share-store" aria-label="Partilhar a loja">🔗 <span class="lj-hide-sm">Partilhar</span></button></div></div></header>
    <div class="lj-hero" ${c.hero_path ? `style="background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url('${esc(publicImageUrl(c.hero_path))}')"` : ''}><div class="lj-wrap">
      <h1>${esc(st.name)}</h1><p>${esc(c.tagline || [st.address, st.city].filter(Boolean).join(', '))}</p></div></div>
    <div class="lj-searchbar"><div class="lj-wrap"><form class="lj-search" role="search" id="lj-sf"><input id="lj-q" type="search" placeholder="Pesquisar produtos, marcas, categorias…" value="${esc(S.filters.q)}" aria-label="Pesquisar produtos" autocomplete="off"></form></div></div>
    <main class="lj-wrap" id="lj-main"></main>
    <footer class="lj-foot">${c.about ? `<p>${esc(c.about)}</p>` : ''}${esc([st.address, st.city, st.phone, st.email].filter(Boolean).join(' · '))}</footer>
    <button class="lj-fab" data-act="cart" aria-label="Abrir carrinho" ${cartCount() ? '' : 'hidden'}>🛒 <span id="lj-fab-total">${money(cartTotal())}</span> <b id="lj-fab-n">${cartCount()}</b></button>`;
  renderMain();
}

/** Muda um filtro: limpa a lista, redesenha a zona principal e pede a primeira página. */
function applyFilters(scrollToDept = false) {
  S.cursor = null; S.items = []; S.lastPage = [];
  renderMain(scrollToDept);
  return loadPage(true);
}

function paintGrid(append = false) {
  const g = q('#lj-grid'); if (!g) return;
  if (!append) g.innerHTML = '';
  g.insertAdjacentHTML('beforeend', (append ? S.lastPage : S.items).map(card).join(''));
  q('#lj-empty').hidden = S.items.length > 0 || S.loading;
  q('[data-act=more]').hidden = !S.cursor;
}

function updateFab() {
  const fab = q('.lj-fab'); if (!fab) return;
  fab.hidden = cartCount() === 0; q('#lj-fab-n').textContent = cartCount(); q('#lj-fab-total').textContent = money(cartTotal());
}

async function loadPage(reset) {
  if (!reset && S.loading) return;
  const my = ++S.seq; S.loading = true;
  if (reset) { S.cursor = null; S.items = []; }
  let page = null;
  try {
    const f = S.filters;
    const r = await rpc('fn_public_products', { p_slug: SLUG, p_q: f.q || null, p_category: f.category || null, p_subcategory: f.subcategory || null, p_sort: f.sort, p_only_promo: f.promo, p_featured: false, p_cursor: reset ? null : S.cursor, p_limit: 24 });
    if (my !== S.seq) return; // chegou uma pesquisa/filtro mais recente: ignora esta resposta
    page = r;
  } catch (e) { if (my === S.seq) toast(e.message); }
  if (my !== S.seq) return;
  S.loading = false;
  if (page) { S.lastPage = page.items || []; S.items = S.items.concat(S.lastPage); S.cursor = page.next_cursor || null; }
  paintGrid(!reset);
}

/* ---------- produto (popup) ---------- */
function closeModal() { document.querySelectorAll('.lj-ov').forEach((n) => n.remove()); document.body.style.overflow = ''; }
function openOverlay(html, cls = '') {
  closeModal(); document.body.style.overflow = 'hidden';
  const ov = document.createElement('div'); ov.className = 'lj-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="lj-md ${cls}"><button class="lj-x" data-act="close" aria-label="Fechar">✕</button>${html}</div>`;
  ov.addEventListener('click', (ev) => { if (ev.target === ov) { closeProduct(); } });
  document.body.appendChild(ov); return ov;
}
function closeProduct() {
  const wasProduct = !!S.product; closeModal(); S.product = null;
  if (wasProduct) history.replaceState(null, '', relStore()); // volta ao endereço da loja (relativo: funciona em qualquer pasta/domínio)
}

async function openProduct(id, push = true) {
  const ov = openOverlay('<div class="lj-msg">A carregar…</div>');
  try {
    const p = await rpc('fn_public_product', { p_slug: SLUG, p_product_id: id });
    if (!p.ok) {
      const msg = { UNPUBLISHED: 'Este produto já não está disponível na loja.', NOT_FOUND: 'Produto não encontrado.', STORE_UNAVAILABLE: 'A loja virtual está indisponível.' }[p.code] || 'Produto indisponível.';
      ov.querySelector('.lj-msg').innerHTML = `${esc(msg)}${p.name ? `<br><strong>${esc(p.name)}</strong>` : ''}<br><br><button class="lj-btn" data-act="close">Ver a loja</button>`; return;
    }
    S.product = p; S.qty = 1; S.img = 0; S.color = null;
    if (push) history.pushState({ p: id }, '', relProduct(id));
    paintProduct(ov);
  } catch (e) { ov.querySelector('.lj-msg').textContent = e.message; }
}

function paintProduct(ov = q('.lj-ov')) {
  const p = S.product; if (!p || !ov) return;
  const imgs = p.images || [];
  const cur = imgs[S.img] || imgs[0];
  const colorChosen = p.colors.find((c) => c.id === S.color);
  const needColor = p.has_colors && p.color_required && !S.color;
  const canBuy = p.available && !needColor && !(colorChosen && !colorChosen.available);
  ov.querySelector('.lj-md').innerHTML = `<button class="lj-x" data-act="close" aria-label="Fechar">✕</button>
    <div class="lj-pd"><div class="lj-gal"><div class="main">${cur ? `<img src="${esc(publicImageUrl(cur.path))}" alt="${esc(p.name)}" decoding="async">` : ''}</div>
      ${imgs.length > 1 ? `<div class="lj-th">${imgs.map((im, i) => `<button data-act="img" data-i="${i}" aria-current="${i === S.img}" aria-label="Fotografia ${i + 1}"><img src="${esc(publicImageUrl(im.thumb || im.path))}" alt="" loading="lazy" width="58" height="58"></button>`).join('')}</div>` : ''}</div>
      <div class="lj-info"><h2>${esc(p.name)}</h2>
        <div class="lj-meta">${esc([p.brand, p.model, p.code && 'Ref. ' + p.code, [p.category, p.subcategory].filter(Boolean).join(' › ')].filter(Boolean).join(' · '))}</div>
        <div class="pr">${money(p.effective_price)}${p.on_promo ? `<span class="lj-old">${money(p.price)}</span>` : ''} <small class="lj-meta">/ ${esc(p.unit || 'UN')}</small></div>
        ${p.on_promo && p.promo_end ? `<div class="lj-meta">${esc(p.promo_name || 'Promoção')}: ${p.promo_start ? esc(fmtDT(p.promo_start)) + ' → ' : 'até '}${esc(fmtDT(p.promo_end))}</div>` : ''}
        <div class="lj-meta">${p.available ? '✅ Disponível' : '⛔ Indisponível de momento'}</div>
        ${p.has_colors ? `<h3>Cor${p.color_required ? ' *' : ''}${colorChosen ? ': ' + esc(colorChosen.name) : ''}</h3><div class="lj-colors">${p.colors.map((c) => `<button class="lj-color" data-act="color" data-id="${esc(c.id)}" aria-pressed="${S.color === c.id}" ${c.available ? '' : 'disabled'}><i style="background:${esc(c.hex || '#cccccc')}"></i>${esc(c.name)}</button>`).join('')}</div>` : ''}
        ${p.description ? `<h3>Descrição</h3><p>${esc(p.description)}</p>` : ''}${p.details ? `<h3>Detalhes técnicos</h3><p>${esc(p.details)}</p>` : ''}${p.notes ? `<h3>Notas</h3><p>${esc(p.notes)}</p>` : ''}
        <div class="lj-act"><div class="lj-qty"><button data-act="qminus" aria-label="Menos">−</button><input id="lj-qty" type="number" min="${p.is_fractional ? '0.01' : '1'}" step="${p.is_fractional ? '0.01' : '1'}" value="${S.qty}" aria-label="Quantidade"><button data-act="qplus" aria-label="Mais">+</button></div>
          <button class="lj-btn" data-act="add" ${canBuy ? '' : 'disabled'}>${needColor ? 'Escolha a cor' : 'Adicionar ao carrinho'}</button>
          <button class="lj-btn sec" data-act="share" data-id="${esc(p.id)}" data-name="${esc(p.name)}">🔗 Partilhar</button></div></div></div>`;
}

function addToCart() {
  const p = S.product; const qty = Number(q('#lj-qty')?.value || S.qty);
  if (!(qty > 0)) return toast('Indique uma quantidade válida.');
  const color = p.colors.find((c) => c.id === S.color);
  if (p.has_colors && p.color_required && !color) return toast('Seleccione a cor.');
  const key = `${p.id}|${color ? color.id : ''}`;
  const line = S.cart.find((l) => l.key === key);
  if (line) line.qty = Math.round((Number(line.qty) + qty) * 100) / 100;
  else {
    if (S.cart.length >= 30) return toast('O carrinho aceita no máximo 30 linhas.');
    S.cart.push({ key, productId: p.id, name: p.name, price: p.effective_price, base: p.price, qty, colorId: color?.id || null, colorName: color?.name || null, colorHex: color?.hex || null, thumb: (p.images[0] && (p.images[0].thumb || p.images[0].path)) || null, fractional: !!p.is_fractional });
  }
  saveCart(); updateFab(); toast('Adicionado ao carrinho.'); closeProduct();
}

/* ---------- carrinho / checkout ---------- */
async function refreshCartPrices() {
  if (!S.cart.length) return false;
  try {
    const r = await rpc('fn_public_cart_prices', { p_slug: SLUG, p_items: [...new Set(S.cart.map((l) => l.productId))] });
    const m = new Map(r.map((x) => [x.product_id, x])); let changed = false;
    S.cart.forEach((l) => { const x = m.get(l.productId); if (x && (Number(l.price) !== Number(x.effective_price) || Number(l.base) !== Number(x.price))) { l.price = Number(x.effective_price); l.base = Number(x.price); changed = true; } });
    if (changed) { saveCart(); updateFab(); }
    return changed;
  } catch (e) { return false; }
}

function openCart(stage = 'cart', msg = '') {
  const lines = S.cart.map((l, i) => `<div class="lj-line"><img src="${esc(publicImageUrl(l.thumb))}" alt="" width="56" height="56" loading="lazy">
      <div><div class="t">${esc(l.name)}</div><div class="s">${l.colorName ? `<i style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${esc(l.colorHex || '#ccc')};border:1px solid #0003;vertical-align:-1px"></i> ${esc(l.colorName)} · ` : ''}${money(l.price)}${l.base > l.price ? ` <s class="lj-old">${money(l.base)}</s> <b>−${money(l.base - l.price)}</b>` : ''}</div>
      <div class="lj-qty" style="margin-top:6px"><button data-act="cminus" data-i="${i}" aria-label="Menos">−</button><input data-act="cqty" data-i="${i}" type="number" step="${l.fractional ? '0.01' : '1'}" min="0" value="${l.qty}" aria-label="Quantidade"><button data-act="cplus" data-i="${i}" aria-label="Mais">+</button></div></div>
      <div><strong>${money(l.qty * l.price)}</strong><br><button class="lj-btn sec" data-act="cdel" data-i="${i}" style="padding:4px 8px;margin-top:6px" aria-label="Remover">🗑</button></div></div>`).join('');
  const pf = prefill();
  const body = stage === 'cart'
    ? `<h2 style="padding:14px 14px 0;margin:0">Carrinho</h2>${S.cart.length ? lines : '<div class="lj-msg">O carrinho está vazio.</div>'}
       <div style="padding:14px"><div style="display:flex;justify-content:space-between;font-weight:800;font-size:18px"><span>Total estimado</span><span>${money(cartTotal())}</span></div>
       <div class="lj-meta" style="margin:4px 0 12px">O preço final (promoções e disponibilidade) é confirmado pela loja ao enviar.</div>
       <div class="lj-act"><button class="lj-btn sec" data-act="close">Continuar a comprar</button><button class="lj-btn" data-act="checkout" ${S.cart.length ? '' : 'disabled'}>Finalizar encomenda</button></div></div>`
    : `<h2 style="padding:14px 14px 0;margin:0">Os seus dados</h2><form class="lj-form" id="lj-co">
        <input name="name" placeholder="Nome *" required maxlength="120" autocomplete="name" value="${esc(pf.name || '')}"><input name="phone" type="tel" placeholder="Telefone / WhatsApp *" value="${esc(pf.phone || '')}" required maxlength="30" autocomplete="tel">
        <input name="email" type="email" placeholder="Email (opcional)" maxlength="120" autocomplete="email" value="${esc(pf.email || '')}"><input name="address" placeholder="Morada de entrega (opcional)" maxlength="300" autocomplete="street-address" value="${esc(pf.address || '')}">
        <textarea name="notes" rows="2" placeholder="Notas (opcional)" maxlength="500"></textarea>
        <div class="lj-err" id="lj-err">${esc(msg)}</div><strong>Total estimado: ${money(cartTotal())}</strong>
        <div class="lj-act"><button type="button" class="lj-btn sec" data-act="cart">Voltar</button><button class="lj-btn" data-act="submit-order" type="submit">Enviar encomenda</button><button class="lj-btn sec" type="submit" data-act="submit-quote">Pedir cotação</button></div></form>`;
  const ov = openOverlay(body, 'lj-dr');
  const form = q('#lj-co', ov); if (form) {
    let mode = 'order';
    form.querySelectorAll('button[type=submit]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.act === 'submit-quote' ? 'quote' : 'order'; }));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(form, mode); });
  }
}

async function submit(form, mode) {
  if (await refreshCartPrices()) { return openCart('form', 'Os preços foram actualizados (promoção iniciada ou terminada). Confirme o novo total.'); }
  const btns = form.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
  const err = q('#lj-err'); err.textContent = '';
  const fd = new FormData(form);
  const customer = { name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), notes: fd.get('notes') };
  const items = S.cart.map((l) => ({ product_id: l.productId, quantity: l.qty, color_id: l.colorId }));
  try {
    const r = await rpc(mode === 'quote' ? 'fn_public_request_quote' : 'fn_public_create_order', { p_slug: SLUG, p_customer: customer, p_items: items, p_idem: idemKey() });
    sessionStorage.removeItem(`gef_idem_${SLUG}`); S.cart = []; saveCart(); updateFab();
    S.lastReceipt = r.receipt ? { ...r.receipt, phone: customer.phone, address: customer.address, payment_status: 'NAO_PAGO' } : null;
    const quote = mode === 'quote'; const info = quote ? null : await loadPaymentInfo(SLUG);
    const wa = String((S.store && S.store.config && S.store.config.whatsapp) || (S.store && S.store.phone) || '').replace(/[^0-9]/g, '');
    const proofBtn = isLoggedIn()
      ? `<label class="lj-btn sec"><span class="ic">📎</span>Enviar comprovativo<input type="file" hidden data-cx-code="${esc(r.code)}" accept="image/*,application/pdf"></label>`
      : (wa.length >= 7 ? `<a class="lj-btn sec" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Segue o comprovativo de pagamento da encomenda ${r.code} (total ${r.total != null ? Number(r.total).toLocaleString('pt-PT', { minimumFractionDigits: 2 }) + ' ' + (S.store?.currency || 'MT') : ''}).`)}"><span class="ic">📎</span>Enviar comprovativo</a>`
                          : '<button class="lj-btn sec" data-cx="account"><span class="ic">📎</span>Enviar comprovativo</button>');
    const actions = !quote && r.receipt ? `<div class="lj-bigbtns"><button class="lj-btn" data-act="pdf-receipt"><span class="ic">⬇</span>Descarregar PDF</button><button class="lj-btn sec" data-act="print-receipt"><span class="ic">🖨</span>Imprimir</button>${proofBtn}</div>
      <div class="lj-meta" id="lj-proof-msg" role="status">${isLoggedIn() ? 'Já pagou? Envie a foto ou PDF do comprovativo.' : 'Já pagou? Envie o comprovativo por WhatsApp (ou entre na sua conta para o enviar aqui).'}</div>` : '';
    openOverlay(`<div class="lj-ok"><div class="lj-okmark" aria-hidden="true">✅</div><h2>${quote ? 'Pedido de cotação enviado' : 'Encomenda enviada'}</h2><p>Código: <strong>${esc(r.code)}</strong></p>
      ${r.total != null ? `<p>Total confirmado: <strong>${money(r.total)}</strong>${r.receipt && Number(r.receipt.discount_total) > 0 ? `<br><small>Desconto aplicado: ${money(r.receipt.discount_total)} (original ${money(r.receipt.subtotal_original)})</small>` : ''}</p>` : ''}
      ${actions}${quote ? '' : paymentBlockHtml(info, r.code)}<p class="lj-meta">${quote ? 'A loja irá contactá-lo com a cotação.' : 'O pagamento fica «pendente» até a loja validar o comprovativo — será avisado. Esta encomenda ainda não é uma venda nem um pagamento.'}</p>
      <button class="lj-btn" data-act="close">Fechar</button></div>`, 'lj-dr');
  } catch (e) { err.textContent = e.message; btns.forEach((b) => { b.disabled = false; }); }
}

/* ---------- eventos (delegação) ---------- */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, i = Number(el.dataset.i);
  if (act === 'open') return openProduct(el.dataset.id);
  if (act === 'close') return closeProduct();
  if (act === 'print-receipt' && S.lastReceipt) { if (!printReceipt(S.lastReceipt, await receiptOptions(SLUG, S.store, logoUrl()))) toast('Não foi possível imprimir.'); return; }
  if (act === 'pdf-receipt' && S.lastReceipt) { el.disabled = true; try { await downloadOrderPdf(S.lastReceipt, await receiptOptions(SLUG, S.store, logoUrl())); } catch (e) { toast('Não foi possível gerar o PDF.'); } el.disabled = false; return; }
  if (act === 'share') return shareLink({ url: productUrl(SLUG, el.dataset.id), title: el.dataset.name, notify: toast });
  if (act === 'share-store') return shareLink({ url: storeUrl(SLUG), title: S.store.name, notify: toast });
  if (act === 'cat') { S.filters.category = el.dataset.cat; S.filters.subcategory = ''; return applyFilters(!!el.dataset.cat); }
  if (act === 'sub') { S.filters.subcategory = el.dataset.sub; return applyFilters(false); }
  if (act === 'clear-search') { S.filters.q = ''; const qi = q('#lj-q'); if (qi) qi.value = ''; return applyFilters(false); }
  if (act === 'more') return loadPage(false);
  if (act === 'img') { S.img = i; return paintProduct(); }
  if (act === 'color') { S.color = el.dataset.id; const c = S.product.colors.find((x) => x.id === S.color); const idx = c && c.image_id ? S.product.images.findIndex((x) => x.id === c.image_id) : -1; if (idx >= 0) S.img = idx; return paintProduct(); }
  if (act === 'qminus' || act === 'qplus') { const inp = q('#lj-qty'); const step = S.product.is_fractional ? 0.5 : 1; S.qty = Math.max(step === 1 ? 1 : 0.01, Number(inp.value || 1) + (act === 'qplus' ? step : -step)); inp.value = S.qty; return; }
  if (act === 'add') return addToCart();
  if (act === 'cart') { await refreshCartPrices(); return openCart('cart'); }
  if (act === 'checkout') return openCart('form');
  if (act === 'cminus' || act === 'cplus') { const l = S.cart[i]; l.qty = Math.max(0, Math.round((Number(l.qty) + (act === 'cplus' ? 1 : -1)) * 100) / 100); if (l.qty <= 0) S.cart.splice(i, 1); saveCart(); updateFab(); return openCart('cart'); }
  if (act === 'cdel') { S.cart.splice(i, 1); saveCart(); updateFab(); return openCart('cart'); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-act=cqty]')) { const l = S.cart[Number(t.dataset.i)]; const v = Number(t.value); if (v > 0) l.qty = v; else S.cart.splice(Number(t.dataset.i), 1); saveCart(); updateFab(); openCart('cart'); }
  if (t.id === 'lj-sort') { S.filters.sort = t.value; S.cursor = null; S.items = []; paintGrid(); loadPage(true); }
  if (t.id === 'lj-promo') { S.filters.promo = t.checked; applyFilters(false); }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'lj-q') return;
  clearTimeout(searchTimer); const v = ev.target.value.trim();
  searchTimer = setTimeout(() => { if (v === S.filters.q) return; S.filters.q = v; applyFilters(false); }, 300);
});
document.addEventListener('submit', (ev) => { if (ev.target.id === 'lj-sf') { ev.preventDefault(); clearTimeout(searchTimer); S.filters.q = q('#lj-q').value.trim(); applyFilters(false); } });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && q('.lj-ov')) closeProduct(); });
window.addEventListener('popstate', () => { const p = new URLSearchParams(window.location.search).get('p'); if (p) openProduct(p, false); else { closeModal(); S.product = null; } });

/* ---------- arranque ---------- */
/* Expiração exacta: quando termina a promoção mais próxima, volta a pedir o catálogo ao servidor (que já devolve o preço normal). */
let expiryTimer = null;
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const ends = [...S.promos, ...S.items].filter((p) => p.on_promo && p.promo_end).map((p) => new Date(p.promo_end).getTime()).filter((t) => t > Date.now());
  if (!ends.length) return;
  expiryTimer = setTimeout(async () => {
    try {
      const r = await rpc('fn_public_products', { p_slug: SLUG, p_sort: 'recent', p_only_promo: true, p_limit: 8 }); S.promos = r.items || [];
      await loadPage(true); await refreshCartPrices(); renderMain();
    } catch (e) { /* tenta no próximo ciclo */ }
    scheduleExpiry();
  }, Math.min(Math.max(Math.min(...ends) - Date.now() + 500, 1000), 2147483000));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleExpiry(); });

(async function init() {
  if (!SLUG) { $app.innerHTML = '<div class="lj-msg">Endereço de loja inválido.</div>'; return; }
  loadCart();
  try {
    const [st, ident] = await Promise.all([rpc('fn_public_store', { p_slug: SLUG }), fetchIdentity()]);
    if (!st.ok) {
      $app.innerHTML = `<div class="lj-msg"><h2>${st.code === 'DISABLED' ? esc(st.name || 'Loja') : 'Loja não encontrada'}</h2><p>${st.code === 'DISABLED' ? 'A loja virtual está temporariamente indisponível.' : 'Verifique o endereço.'}</p></div>`; return;
    }
    S.store = st; syncIdentity(ident); applyTheme(); renderShell();
    initCustomer({ slug: SLUG, getStore: () => S.store, getLogo: logoUrl, money, toast });
    initInstall({ slug: SLUG, getInfo: () => ({ name: (S.identity && S.identity.name) || S.store.name, icon: S.identity ? S.identity.icon192Url : '', logo: (S.identity && S.identity.logoUrl) || headerFallbackUrl(S.store.config) || '' }) });
    const c = st.config || {}; const sections = c.sections && c.sections.length ? c.sections : ['promos', 'featured', 'categories', 'catalog'];
    const jobs = [loadPage(true)];
    if (sections.includes('promos')) jobs.push(rpc('fn_public_products', { p_slug: SLUG, p_sort: 'recent', p_only_promo: true, p_limit: 8 }).then((r) => { S.promos = r.items || []; }).catch(() => {}));
    if (sections.includes('featured')) jobs.push(rpc('fn_public_products', { p_slug: SLUG, p_featured: true, p_limit: 8 }).then((r) => { S.featured = r.items || []; }).catch(() => {}));
    if (DIRECT_PRODUCT) jobs.push(openProduct(DIRECT_PRODUCT, false));
    await Promise.all(jobs);
    if (S.promos.length || S.featured.length) { renderMain(); }
    scheduleExpiry();
  } catch (e) { $app.innerHTML = `<div class="lj-msg">${esc(e.message)}</div>`; }
})();
