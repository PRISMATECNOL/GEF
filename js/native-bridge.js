/**
 * GEF - Ponte nativa (Capacitor). FORA da app Android/iOS não faz NADA (retorna logo): web e PWA ficam como estavam.
 * Não toca em Supabase, autenticação, RLS nem permissões. Só adapta 4 coisas que o WebView não faz sozinho:
 *  1) links externos / WhatsApp / telefone  -> abrem fora da app (Browser / sistema)
 *  2) window.open('', ...) + document.write (impressões/recibos) -> janela interna sobreposta (iframe)
 *  3) descarregamentos <a download> com blob: (PDF, CSV) -> guardar em cache + folha «Partilhar»
 *  4) botão «Voltar» do Android, barra de estado e fecho do splash nativo
 * Os plugins são usados via window.Capacitor.Plugins (sem bundler). Qualquer falha cai no comportamento normal.
 */
const Cap = window.Capacitor;
const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

if (isNative) {
  document.documentElement.classList.add('gef-native', 'gef-' + (Cap.getPlatform ? Cap.getPlatform() : 'native'));
  const P = (name) => (Cap.Plugins && Cap.Plugins[name]) || null;
  const origOpen = window.open.bind(window);

  const isExternal = (u) => /^(https?:|tel:|sms:|mailto:|whatsapp:|geo:)/i.test(u) && !u.startsWith(location.origin);
  const openExternal = async (u) => {
    try {
      if (/^https?:/i.test(u) && P('Browser')) { await P('Browser').open({ url: u }); return; }
      window.location.href = u;     // tel:, sms:, mailto:, wa.me -> o sistema escolhe a aplicação
    } catch (e) { try { window.location.href = u; } catch (_) { /* nada */ } }
  };

  // ---- 2) janela interna para impressão / recibo ----
  function makeInAppWindow() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:20000;background:#0b0f19;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0)';
    wrap.innerHTML = '<div style="display:flex;gap:8px;padding:8px 10px;background:#111827;border-bottom:1px solid #1f2937">' +
      '<button data-x="close" style="border:0;border-radius:8px;padding:9px 14px;background:#334155;color:#f8fafc;font:700 13px system-ui">Fechar</button>' +
      '<button data-x="print" style="border:0;border-radius:8px;padding:9px 14px;background:#ea580c;color:#fff;font:700 13px system-ui">Imprimir / Partilhar</button></div>' +
      '<iframe style="flex:1;border:0;background:#fff;width:100%"></iframe>';
    document.body.appendChild(wrap);
    const frame = wrap.querySelector('iframe');
    const doc = frame.contentDocument;
    const close = () => { wrap.remove(); };
    wrap.querySelector('[data-x=close]').onclick = close;
    wrap.querySelector('[data-x=print]').onclick = async () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { /* o WebView pode não suportar impressão: usa «Partilhar» do texto */
        try { const t = (doc.body && doc.body.innerText || '').trim(); if (P('Share') && t) await P('Share').share({ text: t }); } catch (_) { /* nada */ }
      }
    };
    // «janela» com a API mínima que o código existente usa: document.write/open/close, print, close, focus
    return {
      document: { open() { doc.open(); }, write(h) { doc.write(h); }, writeln(h) { doc.writeln(h); }, close() { doc.close(); } },
      print() { wrap.querySelector('[data-x=print]').click(); },
      close, focus() { /* nada */ }, closed: false
    };
  }

  window.open = function (url, target, features) {
    if (url === '' || url == null || url === 'about:blank') return makeInAppWindow();
    const u = String(url);
    if (isExternal(u)) { openExternal(u); return null; }
    return origOpen(url, target, features);
  };

  // ---- 3) descarregamentos blob: (PDF/CSV) ----
  const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
  document.addEventListener('click', async (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[download]');
    if (!a || !/^blob:/i.test(a.href)) return;
    const FS = P('Filesystem'), SH = P('Share');
    if (!FS || !SH) return;                       // sem plugins: deixa o comportamento normal
    ev.preventDefault(); ev.stopPropagation();
    try {
      const blob = await (await fetch(a.href)).blob();
      const name = (a.getAttribute('download') || 'ficheiro').replace(/[^\w.\- ]+/g, '_');
      const w = await FS.writeFile({ path: name, data: await blobToB64(blob), directory: 'CACHE' });
      await SH.share({ title: name, url: w.uri, dialogTitle: 'Guardar / partilhar' });
    } catch (e) { console.warn('[GEF] Partilha de ficheiro falhou:', e); }
  }, true);

  // ---- 1) links <a href> externos ----
  document.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!a || a.hasAttribute('download')) return;
    const h = a.getAttribute('href') || '';
    if (isExternal(h)) { ev.preventDefault(); openExternal(h); }
  }, true);

  // ---- 4) botão Voltar (Android), barra de estado, splash ----
  const App = P('App');
  if (App && App.addListener) {
    App.addListener('backButton', ({ canGoBack }) => {
      const overlay = document.querySelector('body > div[style*="z-index:20000"]');
      if (overlay) { overlay.remove(); return; }
      if (canGoBack || history.length > 1) history.back(); else if (App.exitApp) App.exitApp();
    });
  }
  try { const SB = P('StatusBar'); if (SB) { SB.setStyle({ style: 'DARK' }); SB.setBackgroundColor && SB.setBackgroundColor({ color: '#020617' }); } } catch (_) { /* nada */ }
  window.addEventListener('load', () => { try { const SS = P('SplashScreen'); if (SS) SS.hide({ fadeOutDuration: 300 }); } catch (_) { /* nada */ } });
}

export const isNativeApp = isNative;
