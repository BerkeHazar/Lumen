/**
 * sw.js — service worker
 *
 * Strateji: stale-while-revalidate
 *   Önbellekteki kopya anında döner, taze kopya arka planda indirilip
 *   bir sonraki açılış için saklanır. Böylece uygulama ilk açılıştan sonra
 *   ağ olmadan da çalışır.
 *
 * İki ayrı önbellek:
 *   shell : uygulama kabuğu (html, css, js, font listesi) — kurulumda alınır
 *   data  : sözlük parçaları — kullanıldıkça eklenir, sürüm atlamaz
 *
 * Sözlük verisi bilinçli olarak ayrı tutulur: uygulama güncellendiğinde
 * kullanıcının indirdiği sözlük parçaları silinmesin.
 *
 * Yol kuralı: tüm yollar göreli. GitHub Pages'te alt klasörde yayınlandığında
 * da çalışır.
 */

/*
 * Sürüm notu: stale-while-revalidate kullanıldığı için güncelleme sonrası İLK
 * yükleme hâlâ önbellekteki eski dosyaları gösterir, yenisi arka planda iner.
 * Kabuk dosyaları (html/css/js) değiştiğinde bu numara artırılmalı — aksi
 * hâlde kullanıcı bir tur eski arayüzü görür.
 */
const VERSION = 'v12';

/*
 * Veri önbelleği AYRI numaralanır. Sözlük parçaları 34 MB; her kabuk
 * güncellemesinde silinirse kullanıcı gereksiz yere yeniden indirir. Ama veri
 * ŞEMASI değiştiğinde (yeni alan, farklı anlam yapısı) eski parçalar sessizce
 * servis edilmeye devam eder ve uygulama eski veriyle çalışır. Bu yüzden
 * yalnızca şema değişince artırılır.
 */
const DATA_VERSION = 'v3';

const SHELL = `lumen-shell-${VERSION}`;
const DATA = `lumen-data-${DATA_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/stage.css',
  './js/app.js',
  './js/icons.js',
  './js/store.js',
  './js/dict.js',
  './js/search.js',
  './js/speech.js',
  './vendor/minisearch.js',
  './vendor/idb-keyval.js',
  './vendor/wiktionary-sound/index.js',
  './vendor/wiktionary-sound/search.js',
  './vendor/wiktionary-sound/resolve.js',
  './vendor/wiktionary-sound/selector.js',
  './vendor/wiktionary-sound/cache.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* --------------------------------------------------------------- kurulum */

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(SHELL)
      // Tek bir dosya eksikse kurulum tümden düşmesin; tek tek ekle.
      .then((c) => Promise.allSettled(SHELL_ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

/* --------------------------------------------------------------- etkinleşme */

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => (k.startsWith('lumen-shell-') && k !== SHELL)
            || (k.startsWith('lumen-data-') && k !== DATA))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ------------------------------------------------------------------ getirme */

self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // Yalnızca GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Farklı kaynak: yazı tipleri ve Wikimedia ses dosyaları
  if (url.origin !== self.location.origin) {
    // Yazı tipleri: stale-while-revalidate (bir kez iner, hep kalır)
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) {
      ev.respondWith(swr(req, SHELL));
      return;
    }
    // Ses dosyaları ve Wiktionary API: önbelleğe alma, tarayıcıya bırak
    return;
  }

  // Sözlük verisi: ayrı önbellekte.
  //
  // `cache: 'no-cache'` ile gelen istek TAZELİK ister (manifest ve parçalar
  // böyle istenir). Bu istekler ağ-önce yapılır; böylece yeni derleme hemen
  // görülür. Diğerleri eskisi gibi stale-while-revalidate.
  //
  // Neden gerekli: yalnızca SWR kullanıldığında manifest de parçalar da aynı
  // eski nesilden geliyordu. İkisi tutarlı biçimde eski olduğu için uygulama
  // "veri değişmedi" sanıyor ve yeni derlemeyi hiç görmüyordu.
  if (/\/data\//.test(url.pathname)) {
    ev.respondWith(req.cache === 'no-cache' ? fresh(req, DATA) : swr(req, DATA));
    return;
  }

  // Gezinme istekleri: ağ önce, olmazsa kabuk
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Uygulama kabuğu
  ev.respondWith(swr(req, SHELL));
});

/* ------------------------------------------------------- stale-while-revalidate */

async function swr(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const network = fetch(req)
    .then((res) => {
      // Yalnızca başarılı ve tam yanıtları sakla
      if (res && res.status === 200 && res.type !== 'opaque') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  // Önbellekte varsa hemen dön, güncelleme arka planda sürsün
  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;

  return new Response('Çevrimdışı ve bu dosyanın kopyası yok.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/* ------------------------------------------------------------ ağ öncelikli */

/*
 * Tazelik isteyen veri çağrıları için: ağ önce, olmazsa önbellek.
 *
 * İstek `cache: 'no-cache'` taşıdığı için tarayıcı koşullu istek yapar
 * (ETag / Last-Modified). Dosya değişmediyse 304 döner, gövde inmez — yani
 * her açılışta megabaytlarca veri yeniden indirilmez. Yalnızca gerçekten
 * değişmiş parça baştan indirilir.
 */
async function fresh(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response('Çevrimdışı ve bu dosyanın kopyası yok.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/* ------------------------------------------------------------ mesajlaşma */

self.addEventListener('message', (ev) => {
  // Uygulamadan önbellek temizleme isteği
  if (ev.data && ev.data.type === 'clear-data-cache') {
    ev.waitUntil(caches.delete(DATA));
  }
});
