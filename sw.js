/**
 * GEF - SERVICE WORKER (PWA)
 *
 * Só guarda em cache os ficheiros ESTÁTICOS da própria aplicação (HTML/CSS/JS/ícones).
 * NUNCA intercepta o Supabase nem qualquer outro domínio: autenticação, RLS, permissões e
 * dados continuam a ir sempre diretamente à rede, sem cópias em cache.
 *
 * Segurança (identidade por loja): o manifesto e os ícones de cada loja NÃO passam por aqui (o manifesto é um blob: gerado
 * no navegador após o login; os ícones estão no domínio do Supabase Storage). Só se guardam ficheiros estáticos (HTML/JS/CSS/
 * imagens/fontes) e nunca pedidos com cabeçalho Authorization, por isso nenhuma identidade, token ou dado de loja fica em cache.
 *
 * Estratégia: rede primeiro (o utilizador recebe sempre a versão publicada mais recente) e
 * cache como reserva quando não há ligação.
 * Ao publicar uma nova versão, altere CACHE_VERSION.
 */
const CACHE_VERSION = 'gef-v26';
const CACHE_NAME = `${CACHE_VERSION}-static`;

const PRECACHE = [
  "./adesao.html",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon.svg",
  "./assets/icons/pwa-192x192.png",
  "./assets/icons/pwa-512x512.png",
  "./assets/icons/pwa-maskable-512x512.png",
  "./css/components.css",
  "./css/global.css",
  "./css/layout.css",
  "./index.html",
  "./js/adesao-publica.js",
  "./js/adesao.js",
  "./js/app.js",
  "./js/components/blind-closing-modal.js",
  "./js/components/lock-banner.js",
  "./js/components/navbar.js",
  "./js/components/pagination.js",
  "./js/components/receipt-modal.js",
  "./js/components/scale-modal.js",
  "./js/components/sidebar.js",
  "./js/components/store-user-modal.js",
  "./js/components/toast.js",
  "./js/components/transfer-modal.js",
  "./js/config.js",
  "./js/core/ambassador-view.js",
  "./js/core/auth.js",
  "./js/core/login-id.js",
  "./js/core/network-calc.js",
  "./js/core/database.js",
  "./js/core/i18n.js",
  "./js/core/permissions.js",
  "./js/core/supabase.js",
  "./js/core/utils.js",
  "./js/pwa.js",
  "./manifest.webmanifest",
  "./modules/auditoria/auditoria.js",
  "./modules/caixa/caixa.js",
  "./modules/clientes/clientes.js",
  "./modules/compras/compras.js",
  "./modules/configuracoes/configuracoes.js",
  "./modules/dashboard/dashboard.js",
  "./modules/embaixadores/embaixadores.js",
  "./modules/embaixadores/rede-admin.js",
  "./modules/embaixadores/gestao-perfis.js",
  "./modules/embaixadores/perfil-embaixador.js",
  "./modules/monitor/gestao-lojas.js",
  "./js/components/table-search.js",
  "./js/components/share-link.js",
  "./js/core/image-utils.js",
  "./js/core/store-identity.js",
  "./js/core/color-names.js",
  "./modules/produtos/loja-produto.js",
  "./modules/produtos/cadastro-loja.js",
  "./modules/configuracoes/identidade-app.js",
  "./modules/configuracoes/sector-config.js",
  "./js/core/app-identity.js",
  "./modules/logistica/logistica.js",
  "./modules/loja-virtual/loja-virtual.js",
  "./loja.html",
  "./css/loja.css",
  "./js/loja-publica.js",
  "./js/loja-install.js",
  "./js/loja-cliente.js",
  "./js/core/order-receipt.js",
  "./js/core/order-pdf.js",
  "./js/core/order-ui.js",
  "./assets/sounds/notify.wav",
  "./js/core/payment-methods.js",
  "./js/core/sector.js",
  "./modules/entregas/entregas.js",
  "./modules/estoque/estoque.js",
  "./modules/login/login.js",
  "./modules/monitor/monitor.js",
  "./modules/orcamentos/orcamentos.js",
  "./modules/perdas/perdas.js",
  "./modules/pos/pos.js",
  "./modules/produtos/produtos.js",
  "./modules/relatorios/relatorios.js",
  "./modules/transferencias/transferencias.js",
  "./modules/vendas/vendas.js",
  "./offline.html",
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll falharia por inteiro se um ficheiro faltasse; adiciona um a um e ignora falhas
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Só ficheiros estáticos da aplicação; qualquer outro tipo de pedido (fetch/XHR de dados) segue directo para a rede
  if (!['document', 'script', 'style', 'image', 'font', 'manifest'].includes(req.destination)) return;
  if (req.headers.has('authorization')) return;
  // Supabase, fontes externas, APIs: passam direto (sem cache, sem interferência)
  if (url.origin !== self.location.origin) return;

  // Pedidos de ficheiros (não de navegação) revalidam sempre com o servidor: evita servir JS antigo da cache HTTP do navegador
  const network = req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    network
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return (await caches.match('./index.html')) || (await caches.match('./offline.html')) || Response.error();
        }
        return Response.error();
      })
  );
});

/* ---- Notificações PWA (campanhas). Só mostra o que o servidor enviou a quem autorizou; «Parar» cancela este dispositivo. ---- */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Novidade', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    // App aberta: as páginas tocam um som curto (assets/sounds/notify.wav). Em segundo plano o som é o do sistema (o navegador não permite sons próprios).
    try { const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); cl.forEach((c) => { if (c.visibilityState === 'visible') c.postMessage({ type: 'gef-push', title: String(d.title || '') }); }); } catch (e) { /* ignora */ }
    await self.registration.showNotification(String(d.title || 'Novidade').slice(0, 80), {
      body: String(d.body || '').slice(0, 240), icon: d.icon || './assets/icons/pwa-192x192.png', badge: './assets/icons/pwa-192x192.png',
      tag: d.tag || undefined, renotify: !!d.tag, silent: false, vibrate: [90, 50, 90], data: { url: d.url || '', slug: d.slug || '' },
      actions: [{ action: 'open', title: 'Abrir' }, { action: 'stop', title: 'Parar notificações' }]
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  const n = event.notification; const data = n.data || {}; n.close();
  event.waitUntil((async () => {
    if (event.action === 'stop') {                       // deixa de receber já neste dispositivo; a Área do Cliente mostra o estado
      try { const sub = await self.registration.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignora */ }
      const acc = new URL('./loja.html', self.location.href); if (data.slug) acc.searchParams.set('s', data.slug); acc.searchParams.set('conta', 'comunicacoes');
      return self.clients.openWindow(acc.href);
    }
    let target = './loja.html'; try { const u = new URL(data.url, self.location.href); if (u.protocol === 'https:' || u.origin === self.location.origin) target = u.href; } catch (e) { /* link inválido: abre a loja */ }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url === target && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  })());
});
