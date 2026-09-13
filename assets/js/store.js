/* store.js — 기록 저장소
   데이터는 이 브라우저의 localStorage 안에만 머문다. 서버로 나가는 곳은 없다. */
var Store = (function () {
  'use strict';

  var KEY = 'myplace.v1';
  var SCHEMA = 1;

  var state = { version: SCHEMA, places: [] };
  var listeners = [];
  var backend = detectBackend();
  var memory = null; // localStorage를 못 쓰는 환경(사생활 보호 모드 등)에서만 사용

  function detectBackend() {
    try {
      var probe = '__myplace_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function num(v) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  function clampRating(v) {
    var n = Math.round(num(v) || 0);
    return Math.min(5, Math.max(0, n));
  }

  function cleanTags(v) {
    var raw = Array.isArray(v) ? v : String(v || '').split(',');
    var out = [];
    raw.forEach(function (t) {
      var s = String(t).trim().replace(/^#/, '').slice(0, 24);
      if (s && out.indexOf(s) === -1 && out.length < 8) out.push(s);
    });
    return out;
  }

  /** 어디서 들어온 값이든 같은 모양으로 다듬는다(가져오기 포함). */
  function normalize(raw) {
    var lat = num(raw && raw.lat);
    var lng = num(raw && raw.lng);
    var hasCoords = lat !== null && lng !== null &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    var now = new Date().toISOString();

    return {
      id: (raw && raw.id) ? String(raw.id).slice(0, 40) : uid(),
      name: String((raw && raw.name) || '이름 없는 장소').trim().slice(0, 80),
      address: String((raw && raw.address) || '').trim().slice(0, 200),
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      rating: clampRating(raw && raw.rating),
      favorite: !!(raw && raw.favorite),
      memo: String((raw && raw.memo) || '').slice(0, 2000),
      tags: cleanTags(raw && raw.tags),
      visitedAt: /^\d{4}-\d{2}-\d{2}$/.test((raw && raw.visitedAt) || '') ? raw.visitedAt : '',
      createdAt: (raw && raw.createdAt) || now,
      updatedAt: (raw && raw.updatedAt) || now
    };
  }

  function emit() {
    listeners.forEach(function (fn) { fn(state.places); });
  }

  function persist() {
    var json = JSON.stringify(state);
    if (!backend) { memory = json; return { ok: true, volatile: true }; }
    try {
      backend.setItem(KEY, json);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function load() {
    var json = backend ? backend.getItem(KEY) : memory;
    if (!json) return;
    try {
      var parsed = JSON.parse(json);
      var list = Array.isArray(parsed) ? parsed : (parsed && parsed.places) || [];
      state.places = list.map(normalize);
    } catch (e) {
      // 저장된 값이 깨졌더라도 앱은 계속 떠야 한다.
      console.warn('저장된 기록을 읽지 못했습니다.', e);
    }
  }

  return {
    /** 저장소를 읽어 들인다. 앱 시작 시 한 번만 호출. */
    init: function () {
      load();
      return this;
    },

    /** localStorage를 쓸 수 없는 환경이면 true (새로고침하면 사라짐). */
    isVolatile: function () { return backend === null; },

    list: function () { return state.places.slice(); },

    get: function (id) {
      var found = null;
      state.places.forEach(function (p) { if (p.id === id) found = p; });
      return found;
    },

    /** 새 장소면 추가, 기존 id면 수정. 저장된 객체를 돌려준다. */
    put: function (raw) {
      var place = normalize(raw);
      var idx = -1;
      state.places.forEach(function (p, i) { if (p.id === place.id) idx = i; });
      if (idx >= 0) {
        place.createdAt = state.places[idx].createdAt;
        place.updatedAt = new Date().toISOString();
        state.places[idx] = place;
      } else {
        state.places.push(place);
      }
      var res = persist();
      emit();
      return { place: place, result: res };
    },

    remove: function (id) {
      state.places = state.places.filter(function (p) { return p.id !== id; });
      var res = persist();
      emit();
      return res;
    },

    clear: function () {
      state.places = [];
      var res = persist();
      emit();
      return res;
    },

    /** 백업 파일로 내보낼 문자열 */
    toJSON: function () {
      return JSON.stringify({
        app: 'my-place',
        version: SCHEMA,
        exportedAt: new Date().toISOString(),
        places: state.places
      }, null, 2);
    },

    /**
     * 백업 가져오기.
     * mode 'merge' — 같은 id는 덮어쓰고 나머지는 추가
     * mode 'replace' — 기존 기록을 모두 지우고 교체
     */
    fromJSON: function (text, mode) {
      var parsed = JSON.parse(text);
      var list = Array.isArray(parsed) ? parsed : (parsed && parsed.places);
      if (!Array.isArray(list)) throw new Error('장소 목록을 찾지 못했습니다.');

      var incoming = list.map(normalize);
      if (mode === 'replace') {
        state.places = incoming;
      } else {
        var byId = {};
        state.places.forEach(function (p) { byId[p.id] = p; });
        incoming.forEach(function (p) { byId[p.id] = p; });
        state.places = Object.keys(byId).map(function (k) { return byId[k]; });
      }
      var res = persist();
      emit();
      return { count: incoming.length, result: res };
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    },

    uid: uid
  };
})();
