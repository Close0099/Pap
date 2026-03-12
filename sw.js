// Service Worker para SmashLab PWA
const CACHE_NAME = 'padel-club-v5-mar-11-2026-sw-fix';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/admin-dashboard.html',
  '/profile.html',
  '/user-management.html',
  '/css/style.css',
  '/js/firebase-config.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/admin-dashboard.js',
  '/js/profile.js',
  '/js/user-management.js',
  '/js/notifications.js',
  '/js/export-system.js',
  '/manifest.json'
];

// Instalar Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE).catch(err => {
        console.log('Erro ao cachear recursos:', err);
      });
    })
  );
  self.skipWaiting();
});

// Ativar Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Permitir ativação imediata do novo SW
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Estratégia: Network First (tenta rede primeiro, depois cache)
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Ignorar esquemas que o Cache API não suporta (ex: chrome-extension:)
  if (!['http:', 'https:'].includes(requestUrl.protocol)) {
    return;
  }

  // Não cachear requisições para APIs externas
  if (event.request.url.includes('firebasejs') || 
      event.request.url.includes('firebase') ||
      event.request.url.includes('emailjs') ||
      event.request.method !== 'GET') {
    return;
  }

  // Navegação HTML: usar rede sempre que possível para evitar versões antigas presas em cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() =>
          caches.match('/index.html').then(cached => {
            if (cached) return cached;
            return new Response('Offline', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          })
        )
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cachear responses bem-sucedidas
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone).catch(err => {
              console.log('Erro ao guardar em cache:', err);
            });
          });
        }
        return response;
      })
      .catch(() => {
        // Se falhar, tentar cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          return Response.error();
        });
      })
  );
});
