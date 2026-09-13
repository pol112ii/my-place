/* geocode.js — OpenStreetMap Nominatim으로 장소 이름 ↔ 좌표 변환.
   개인 사용 수준의 호출량만 보내도록 최소 간격(1.1초)과 캐시를 둔다.
   검색어는 이 서비스로 나가지만, 기록해 둔 메모나 목록은 전송하지 않는다. */
var Geocode = (function () {
  'use strict';

  var ENDPOINT = 'https://nominatim.openstreetmap.org';
  var MIN_GAP = 1100;
  var lastCallAt = 0;
  var cache = {};

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function request(url, signal) {
    var gap = Date.now() - lastCallAt;
    if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
    lastCallAt = Date.now();

    var res = await fetch(url, { headers: { Accept: 'application/json' }, signal: signal });
    if (!res.ok) throw new Error('검색 서버 응답 오류 (' + res.status + ')');
    return res.json();
  }

  /** 결과에서 짧은 이름과 전체 주소를 뽑아낸다. */
  function shape(item) {
    var full = String(item.display_name || '');
    var short = item.name || full.split(',')[0] || '';
    return {
      name: short.trim(),
      address: full.trim(),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    };
  }

  return {
    available: typeof fetch === 'function',

    /** 이름으로 장소 찾기 */
    search: async function (query, signal) {
      var q = String(query || '').trim();
      if (q.length < 2) return [];

      var key = 's:' + q;
      if (cache[key]) return cache[key];

      var url = ENDPOINT + '/search?format=jsonv2&addressdetails=0&limit=6' +
        '&accept-language=ko&q=' + encodeURIComponent(q);
      var data = await request(url, signal);
      var out = (data || []).map(shape).filter(function (r) {
        return isFinite(r.lat) && isFinite(r.lng);
      });
      cache[key] = out;
      return out;
    },

    /** 좌표로 주소 찾기. 실패해도 앱 흐름을 막지 않도록 null을 돌려준다. */
    reverse: async function (lat, lng, signal) {
      var key = 'r:' + lat.toFixed(4) + ',' + lng.toFixed(4);
      if (cache[key] !== undefined) return cache[key];

      var url = ENDPOINT + '/reverse?format=jsonv2&zoom=18&accept-language=ko' +
        '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
      try {
        var data = await request(url, signal);
        var out = data && data.display_name ? shape(data) : null;
        cache[key] = out;
        return out;
      } catch (e) {
        return null;
      }
    }
  };
})();
