/* Idea Factory Service Worker */
const CACHE_NAME = 'idea-factory-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

/* API・認証・ストレージ・決済関連は絶対にキャッシュしない */
const BYPASS = [/\/api\//, /\/auth\//, /\/rest\//, /\/storage\//, /\/realtime\//, /\/pg/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((re) => re.test(url.pathname))) return;

  /* ページ遷移: ネットワーク優先・失敗時はキャッシュされたシェル */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match('/').then((r) => r || caches.match('/index.html'))
        )
    );
    return;
  }

  /* 静的資産（ハッシュ付きビルド・画像・フォント）: キャッシュ優先 */
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const isStatic =
            url.pathname.startsWith('/assets/') ||
            url.pathname.startsWith('/icons/') ||
            /\.(png|jpe?g|svg|ico|webp|woff2?)$/.test(url.pathname);
          if (res.ok && isStatic) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
