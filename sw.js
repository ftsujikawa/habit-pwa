// オフライン用の Service Worker。
//
// 方針: ネットワーク優先。
// - つながるときは毎回サーバーに最新版を問い合わせて表示し、そのままキャッシュも新しくする。
// - つながらない、または NETWORK_TIMEOUT_MS 以内に返事がないときだけ、キャッシュ(最後に取れた版)を表示する。
// こうすることで、アプリのファイルを更新しても古い画面がキャッシュに残り続けない。
// CACHE_NAME の番号を上げなくても新しい版が届く。
//
// 習慣のデータは localStorage にあり、ここで扱うキャッシュとは別物。キャッシュを消してもデータは消えない。

const CACHE_NAME = 'habit-tracker-app';
const NETWORK_TIMEOUT_MS = 3000;
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

// 初回(と sw.js が変わったとき): アプリの部品を一式キャッシュしておき、すぐに有効になる。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // ブラウザの HTTP キャッシュを通さず、サーバーから取り直す
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// 有効になったら、以前の方式のキャッシュ(habit-tracker-v1〜v4 など)を消し、開いている画面も引き受ける。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const isNavigate = request.mode === 'navigate';
  const url = new URL(request.url);
  if (isNavigate) url.search = ''; // ?source=pwa などが付いても同じ画面として扱う
  const key = url.href;

  // サーバーに問い合わせる(変わっていなければ 304 で軽く済む)。取れたらキャッシュも新しくする。
  const fromNetwork = fetch(key, { cache: 'no-cache', credentials: 'same-origin' }).then(async (response) => {
    if (response.ok) await (await caches.open(CACHE_NAME)).put(key, response.clone());
    return response;
  });
  // 時間切れでキャッシュを返した後も、取得とキャッシュの更新は最後まで続ける(次に開いたときに新しい版が出る)
  event.waitUntil(fromNetwork.catch(() => {}));
  event.respondWith(networkFirst(key, isNavigate, fromNetwork));
});

async function networkFirst(key, isNavigate, fromNetwork) {
  const cache = await caches.open(CACHE_NAME);
  const timeout = new Promise((resolve) => { setTimeout(resolve, NETWORK_TIMEOUT_MS, null); });
  let response = null;
  try {
    response = await Promise.race([fromNetwork, timeout]);
    if (response?.ok) return response;
  } catch {
    // オフラインなど。下でキャッシュを探す。
  }

  // 時間切れ・オフライン・サーバーのエラー(公開作業中の 404 など)のときは、最後に取れた版を出す
  const cached = (await cache.match(key)) ?? (isNavigate ? await cache.match('./index.html') : undefined);
  if (cached) return cached;
  // キャッシュにもなければ、サーバーの返事をそのまま返す(まだなら待つ。失敗すればエラー)
  return response ?? fromNetwork;
}
