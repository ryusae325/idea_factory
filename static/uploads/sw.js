const CACHE_NAME = 'idea-koubou-v1';
const urlsToCache = [
  '/',
  '/manifest.json'
];

// インストール時にキャッシュを保存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// ネットワークリクエストの処理（基本はネットワーク優先）
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});