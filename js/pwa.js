/**
 * GEF - PWA: registo do service worker, convite de instalação (só após login válido) e aviso de nova versão.
 * Não toca em autenticação, Supabase nem em nenhum módulo do sistema.
 * A identidade (nome/ícone/manifesto) da loja vem de js/core/app-identity.js através do evento 'gef:identity'.
 */

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// App nativa (Capacitor): os ficheiros já vão dentro da app (sem service worker) e não faz sentido convidar a «instalar».
const isNativeApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const canUseSW = !isNativeApp && 'serviceWorker' in navigator && (location.protocol === 'https:' || isLocalhost);

function floatingBar(html) {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;max-width:480px;margin:0 auto;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:12px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;font:600 12px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';
  bar.innerHTML = html;
  document.body.appendChild(bar);
  return bar;
}

const btnCss = 'border:0;border-radius:8px;padding:7px 12px;font:700 12px system-ui,sans-serif;cursor:pointer;';

// ---- Service worker + aviso de atualização ----
if (canUseSW) {
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      const offerUpdate = (worker) => {
        const bar = floatingBar(`<span>Nova versão do GEF disponível.</span>
          <span><button id="pwa-update" style="${btnCss}background:#ea580c;color:#fff">Atualizar</button>
          <button id="pwa-later" style="${btnCss}background:transparent;color:#94a3b8">Depois</button></span>`);
        bar.querySelector('#pwa-later').onclick = () => bar.remove();
        bar.querySelector('#pwa-update').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
      };

      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });

      // Só recarrega quando uma versão NOVA assume o controlo (já havia uma anterior).
      // Na primeira instalação não recarrega: evita um refresh desnecessário que interrompia o painel.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !hadController) return;
        reloaded = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn('[GEF] Service worker não registado:', err);
    }
  });
}

// ---- Instalação (convite discreto, SÓ depois de login válido) ----
const isStandalone = () => isNativeApp || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ apresenta-se como Mac
const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|; wv\)/i.test(navigator.userAgent); // não permitem instalar

const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // «Agora não» silencia o convite durante 14 dias
const storeKey = (userId) => `gef_pwa_invite:${userId || 'anon'}`; // só preferência de UI; nunca decide de que loja é a identidade
const readFlag = (userId) => { try { return JSON.parse(localStorage.getItem(storeKey(userId)) || 'null'); } catch (e) { return null; } };
const writeFlag = (userId, v) => { try { localStorage.setItem(storeKey(userId), JSON.stringify(v)); } catch (e) { /* sem armazenamento: o convite só não fica memorizado */ } };

let deferredPrompt = null;   // evento beforeinstallprompt mais recente (o navegador pode emitir outro quando o manifesto muda)
let session = { authenticated: false, userId: null, identity: null };
let inviteEl = null;
let shownThisLoad = false;   // no máximo um convite por carregamento: navegar entre módulos nunca o repete

const DEFAULT_ICON = 'assets/icons/pwa-192x192.png';

function removeInvite() { if (inviteEl) { inviteEl.remove(); inviteEl = null; } }

function canInvite() {
  if (!session.authenticated || !session.userId) return false;       // nunca antes do login
  if (isStandalone() || isInAppBrowser) return false;                 // já instalada / contexto que não instala
  if (shownThisLoad || inviteEl) return false;
  const f = readFlag(session.userId);
  if (f && (f.installed || (f.snoozeUntil && f.snoozeUntil > Date.now()))) return false;
  return true;
}

function showInvite(mode) {
  const i = session.identity;
  const name = i ? i.name : 'GEF';
  const icon = (i && (i.icon192Url || i.logoUrl)) || DEFAULT_ICON;
  shownThisLoad = true;

  const bar = document.createElement('div');
  bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Instalar aplicação');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9998;max-width:480px;margin:0 auto;display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;font:600 12px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';

  const img = document.createElement('img');
  img.src = icon; img.alt = ''; img.width = 44; img.height = 44;
  img.style.cssText = 'width:44px;height:44px;border-radius:10px;object-fit:contain;background:#0f172a;flex:none';
  img.onerror = () => { img.onerror = null; img.src = DEFAULT_ICON; };

  const text = document.createElement('div');
  text.style.cssText = 'flex:1;min-width:0';
  const title = document.createElement('div');
  title.textContent = name; title.style.cssText = 'font-weight:800;font-size:13px;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-weight:500;color:#94a3b8;margin-top:2px;line-height:1.35';
  sub.textContent = mode === 'ios'
    ? 'Para instalar: toque em Partilhar (□↑) e depois em «Adicionar ao ecrã principal».'
    : 'Instale a aplicação para abrir mais depressa, a partir do ecrã principal.';
  text.append(title, sub);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:none';
  const later = document.createElement('button');
  later.type = 'button'; later.textContent = mode === 'ios' ? 'Entendi' : 'Agora não';
  later.style.cssText = btnCss + 'background:transparent;color:#94a3b8';
  later.onclick = () => { writeFlag(session.userId, { snoozeUntil: Date.now() + SNOOZE_MS }); removeInvite(); };

  if (mode === 'prompt') {
    const install = document.createElement('button');
    install.type = 'button'; install.textContent = 'Instalar aplicação';
    install.style.cssText = btnCss + 'background:#ea580c;color:#fff';
    install.onclick = async () => {
      const ev = deferredPrompt; deferredPrompt = null; removeInvite();
      if (!ev) return;
      try {
        ev.prompt();
        const choice = await ev.userChoice;
        if (choice && choice.outcome === 'accepted') writeFlag(session.userId, { installed: true });
        else writeFlag(session.userId, { snoozeUntil: Date.now() + SNOOZE_MS });
      } catch (e) { /* o navegador recusou: nada a fazer */ }
    };
    actions.append(install);
  }
  actions.append(later);
  bar.append(img, text, actions);
  document.body.appendChild(bar);
  inviteEl = bar;
}

function maybeInvite() {
  if (!canInvite()) return;
  if (deferredPrompt) showInvite('prompt');                 // Chrome/Edge/Android/Samsung: instalação nativa
  else if (isIOS) showInvite('ios');                        // Safari/iOS: não existe API; só instruções (sem botão que não funcione)
  // Restantes navegadores (Firefox, Safari de computador…): sem convite, para não mostrar um botão que não faz nada.
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();       // adia: só se mostra o nosso convite, e só depois de login válido
  deferredPrompt = e;
  maybeInvite();
});

window.addEventListener('appinstalled', () => {
  if (session.userId) writeFlag(session.userId, { installed: true });
  deferredPrompt = null; removeInvite();
});

window.addEventListener('gef:identity', (ev) => {
  const d = ev.detail || {};
  const prevUser = session.userId;
  session = { authenticated: !!d.authenticated, userId: d.userId || null, identity: d.custom ? d.identity : null };
  if (!session.authenticated || (prevUser && prevUser !== session.userId)) { removeInvite(); shownThisLoad = false; }
  else if (inviteEl && session.identity) { removeInvite(); shownThisLoad = false; } // a identidade mudou com o convite aberto: refaz-o com o nome/ícone novos
  // Dá tempo ao navegador de reavaliar o manifesto acabado de injectar (pode emitir um beforeinstallprompt novo).
  setTimeout(maybeInvite, session.authenticated ? 1200 : 0);
});
