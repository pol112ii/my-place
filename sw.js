/* sw.js — 앱 파일을 캐시해 두어 인터넷이 없을 때도 기록을 열어 볼 수 있게 한다.
   (지도 타일은 인터넷이 있어야 보인다. 기록 자체는 브라우저 안에 있으므로 그대로 보인다.) */
var CACHE = 'myplace-v2';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/js/region.js',
  './assets/js/store.js',
  './assets/js/geocode.js',
  './assets/js/mapview.js',
  './assets/js/app.js',
  './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/leaflet/leaflet.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 인터넷이 있으면 항상 최신 파일을 쓰고(업데이트가 바로 반영된다),
   없을 때만 캐시에서 꺼낸다. 지도 타일·주소 검색 같은 외부 요청은 건드리지 않는다. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
