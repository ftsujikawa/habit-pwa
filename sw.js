// オフライン用の Service Worker。アプリの部品を端末にキャッシュし、ネットにつながらなくても開けるようにする。
// アプリのファイルを変更したら CACHE_NAME の番号を上げること(上げないと古いファイルが出続ける)。
const CACHE_NAME = 'habit-tracker-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './habits.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// キャッシュを優先し、なければネットワークから取る。画面遷移はオフラインでも index.html を返す。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});
