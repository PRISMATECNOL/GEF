/**
 * GEF | Loja virtual: service worker + popup «Instalar aplicação» + aviso de actualização.
 *  - 1.ª visita: popup (INSTALAR APLICAÇÃO / CONTINUAR A NAVEGAR). Depois de dispensado NÃO volta sozinho;
 *    fica só um botão discreto «Instalar app» no cabeçalho enquanto a app não estiver instalada.
 *  - Android/Chrome: instalação nativa (beforeinstallprompt). iPhone/iPad: passos de «Adicionar ao ecrã principal».
 *  - App já instalada: o popup só reaparece quando há uma ACTUALIZAÇÃO (novo service worker) para aplicar.
 * Instalar NÃO concede consentimento para notificações nem marketing (isso é feito à parte, na Área do Cliente).
 */
const ua = navigator.userAgent;
const isIOS = (/iphone|ipad|ipod/i.test(ua) && !window.MSStream) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|; wv\)/i.test(ua);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const key = (slug) => `gef_lj_install_${slug}`;
const getFlag = (slug) => { try { return JSON.parse(localStorage.getItem(key(slug)) || 'null'); } catch (e) { return null; } };
const setFlag = (slug, v) => { try { localStorage.setItem(key(slug), JSON.stringify({ ...(getFlag(slug) || {}), ...v, at: Date.now() })); } catch (e) { /* sem armazenamento */ } };
export const wasInstalled = (slug) => !!(getFlag(slug) || {}).installed || isStandalone();

let deferred = null; const onInstalledCbs = []; let S = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; syncButton(); });   // registado cedo
window.addEventListener('appinstalled', () => { deferred = null; if (S) setFlag(S.slug, { installed: true, dismissed: true }); document.querySelector('.lj-install-ov')?.remove(); syncButton(); onInstalledCbs.forEach((f) => f()); });

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FALLBACK = './assets/icons/pwa-192x192.png';
const canInstallHere = () => !inApp && !isStandalone() && (isIOS || isAndroid || !!deferred);

export async function registerSW() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return null;
  try { return await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (e) { console.warn('[GEF] Service worker não registado:', e); return null; }
}
const waitPrompt = (ms) => new Promise((res) => { if (deferred) return res(); const t = setTimeout(res, ms); window.addEventListener('beforeinstallprompt', () => { clearTimeout(t); res(); }, { once: true }); });

/** Botão discreto no cabeçalho: visível só se a app não está instalada e este dispositivo pode instalar. */
function syncButton() {
  const b = document.getElementById('lj-inst'); if (!b) return;
  b.hidden = !(S && canInstallHere() && !wasInstalled(S.slug));
}

function frame(kind) {
  const info = S.getInfo() || {};
  const logo = info.logo && info.logo !== info.icon ? `<img class="lj-in-logo" src="${esc(info.logo)}" alt="" onerror="this.remove()">` : '';
  const ov = document.createElement('div'); ov.className = 'lj-ov lj-install-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', kind === 'update' ? 'Atualização disponível' : 'Instalar aplicação');
  ov.innerHTML = `<div class="lj-md lj-install">${logo}<div class="lj-in-row"><img class="lj-in-icon" src="${esc(info.icon || info.logo || FALLBACK)}" alt="" width="64" height="64" onerror="this.onerror=null;this.src='${FALLBACK}'">
    <div><div class="lj-in-name">${esc(info.name || 'Loja')}</div><div class="lj-meta">${kind === 'update' ? 'Há uma nova versão da aplicação desta loja.' : 'Aplicação da loja · abre mais depressa e sem barra do navegador'}</div></div></div>
    <div class="lj-in-help" id="lj-in-help" hidden></div><div class="lj-in-act"><button class="lj-btn" id="lj-in-yes"></button><button class="lj-btn sec" id="lj-in-no"></button></div></div>`;
  document.body.appendChild(ov); return ov;
}

/** Popup de instalação. manual=true: aberto pelo botão discreto (não regista «dispensado» de novo). */
export function openInstall() {
  if (!S || document.querySelector('.lj-install-ov') || !canInstallHere()) return;
  const ov = frame('install'); const help = ov.querySelector('#lj-in-help'); const yes = ov.querySelector('#lj-in-yes'); const no = ov.querySelector('#lj-in-no');
  yes.textContent = 'INSTALAR APLICAÇÃO'; no.textContent = 'CONTINUAR A NAVEGAR';
  const close = (extra) => { setFlag(S.slug, { dismissed: true, ...(extra || {}) }); ov.remove(); syncButton(); };
  no.onclick = () => close(); ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  yes.onclick = async () => {
    if (deferred) { const p = deferred; deferred = null; p.prompt(); try { const r = await p.userChoice; close(r.outcome === 'accepted' ? { installed: true } : {}); } catch (e) { close(); } return; }
    help.hidden = false;
    help.innerHTML = isIOS
      ? `<b>No iPhone / iPad:</b><ol><li>Toque em <b>Partilhar</b> (quadrado com a seta ↑, na barra do Safari).</li><li>Deslize e escolha <b>«Adicionar ao ecrã principal»</b>.</li><li>Toque em <b>Adicionar</b>. A aplicação fica no ecrã principal.</li></ol>`
      : `<b>Neste navegador:</b> abra o menu <b>⋮</b> e toque em <b>«Instalar aplicação»</b> ou <b>«Adicionar ao ecrã principal»</b>.`;
    yes.hidden = true; no.textContent = 'ENTENDI';
  };
}

/** Popup de actualização (só para quem já instalou). */
let updateShown = false;
function offerUpdate(worker) {
  if (updateShown || !S) return; updateShown = true;
  const ov = frame('update'); const yes = ov.querySelector('#lj-in-yes'); const no = ov.querySelector('#lj-in-no');
  yes.textContent = 'ATUALIZAR AGORA'; no.textContent = 'DEPOIS';
  no.onclick = () => { ov.remove(); updateShown = false; };
  yes.onclick = () => { yes.disabled = true; yes.textContent = 'A atualizar…'; worker.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => location.reload(), 4000); };
}

/** getInfo() -> { name, logo, icon } (nome, logótipo e ícone personalizados da loja) */
export async function initInstall({ slug, getInfo, onInstalled }) {
  S = { slug, getInfo }; if (onInstalled) onInstalledCbs.push(onInstalled);
  const btn = document.getElementById('lj-inst'); if (btn) btn.onclick = () => openInstall();
  const reg = await registerSW();
  if (isStandalone()) setFlag(slug, { installed: true, dismissed: true });
  // actualizações: só avisa quem tem a app instalada (os restantes recebem a versão nova ao recarregar)
  if (reg && 'serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    const check = (w) => { if (w && hadController && wasInstalled(slug)) offerUpdate(w); };
    if (reg.waiting) check(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') check(reg.waiting || w); }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController) return; reloaded = true; location.reload(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }
  if (!isIOS) await waitPrompt(2500);
  syncButton();
  if (wasInstalled(slug) || (getFlag(slug) || {}).dismissed || !canInstallHere()) return;   // dispensado: não volta sozinho
  openInstall();
}
