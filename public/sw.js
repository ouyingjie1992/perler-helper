// Service Worker for 拼豆图纸助手 PWA
// 版本号由构建时注入，或手动更新以触发缓存刷新
const CACHE_VERSION = 'v1';
const CACHE_NAME = `perler-helper-${CACHE_VERSION}`;

// 需要预缓存的核心资源（由构建产物决定，这里缓存 App Shell）
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── Install：预缓存核心资源 ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // 跳过等待，立即激活新版 SW
      return self.skipWaiting();
    })
  );
});

// ─── Activate：清理旧缓存 ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('perler-helper-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // 立即接管所有页面，不等待刷新
      return self.clients.claim();
    })
  );
});

// ─── Fetch：缓存优先（Cache First）策略 ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // /api/* 请求：始终走网络（不缓存后端接口）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: '离线状态，无法连接服务器。请使用离线解析模式。' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 其他请求：Cache First，缓存命中直接返回；未命中则网络请求并缓存
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        // 只缓存成功的 GET 请求
        if (
          networkResponse.ok &&
          request.method === 'GET' &&
          !url.pathname.startsWith('/api/')
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // 离线且无缓存：对导航请求返回 index.html（SPA fallback）
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 408 });
      });
    })
  );
});

// ─── Message：支持外部触发更新检查 ───────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
