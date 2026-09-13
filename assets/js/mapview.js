/* mapview.js — Leaflet 지도 래퍼.
   Leaflet을 불러오지 못한 경우(오프라인 등) available()이 false가 되고,
   앱은 목록 화면만으로 계속 동작한다. */
var MapView = (function () {
  'use strict';

  var map = null;
  var markerLayer = null;
  var markers = {};      // id -> marker
  var draftMarker = null;
  var handlers = {};
  var SEOUL = [37.5665, 126.9780];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function starText(n) {
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  function pinColor(p) {
    if (p.favorite) return '#e0a03c';
    if (p.rating >= 4) return '#2f6b5f';
    if (p.rating >= 1) return '#6f9086';
    return '#9a9186';
  }

  function pinIcon(p, active) {
    var color = pinColor(p);
    var glyph = p.favorite ? '★' : (p.rating ? String(p.rating) : '·');
    var ring = active ? '<circle cx="16" cy="15" r="13.5" fill="none" stroke="#221d17" stroke-width="2"/>' : '';
    var svg =
      '<svg class="pin" width="32" height="40" viewBox="0 0 32 40" aria-hidden="true">' +
        '<path d="M16 39C16 39 30 24.4 30 15A14 14 0 1 0 2 15c0 9.4 14 24 14 24z" fill="' + color + '"/>' +
        '<circle cx="16" cy="15" r="10.5" fill="rgba(255,255,255,.22)"/>' + ring +
      '</svg>' +
      '<span class="pin-label">' + glyph + '</span>';

    return L.divIcon({
      className: 'pin-wrap',
      html: svg,
      iconSize: [32, 40],
      iconAnchor: [16, 39],
      popupAnchor: [0, -34]
    });
  }

  function popupHTML(p) {
    var memo = p.memo ? '<p class="pop-memo">' + esc(p.memo.slice(0, 140)) +
      (p.memo.length > 140 ? '…' : '') + '</p>' : '';
    var meta = [p.visitedAt.replace(/-/g, '.'), p.address.split(',')[0]]
      .filter(Boolean).join(' · ');
    return '' +
      '<div class="pop-name">' + (p.favorite ? '★ ' : '') + esc(p.name) + '</div>' +
      '<div class="pop-stars">' + starText(p.rating).replace(/☆/g, '<span class="off">☆</span>') + '</div>' +
      (meta ? '<div class="card-meta">' + esc(meta) + '</div>' : '') +
      memo +
      '<button type="button" class="pop-edit" data-edit="' + esc(p.id) + '">열어서 편집</button>';
  }

  return {
    available: function () { return !!map; },

    /** 지도를 띄운다. Leaflet이 없으면 false. */
    init: function (el, opts) {
      if (typeof L === 'undefined' || !el) return false;
      handlers = opts || {};

      map = L.map(el, { zoomControl: true, attributionControl: true })
        .setView(SEOUL, 12);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      markerLayer = L.layerGroup().addTo(map);

      map.on('click', function (e) {
        if (handlers.onMapClick) handlers.onMapClick(e.latlng.lat, e.latlng.lng);
      });

      // 말풍선 안의 '편집' 버튼은 내용이 바뀌어도 동작하도록 위임 처리한다.
      el.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-edit]');
        if (btn && handlers.onEdit) handlers.onEdit(btn.getAttribute('data-edit'));
      });

      return true;
    },

    /**
     * 목록을 지도에 반영한다. 마커를 통째로 지우면 열려 있던 말풍선까지
     * 사라지므로, 이미 있는 마커는 자리에 두고 바뀐 것만 갱신한다.
     */
    render: function (places, activeId) {
      if (!map) return;
      var alive = {};

      places.forEach(function (p) {
        if (p.lat === null || p.lng === null) return;
        alive[p.id] = true;

        var sig = [p.lat, p.lng, p.rating, p.favorite, p.id === activeId,
                   p.name, p.memo, p.visitedAt, p.address].join('\u0001');
        var m = markers[p.id];

        if (!m) {
          m = L.marker([p.lat, p.lng], {
            icon: pinIcon(p, p.id === activeId),
            title: p.name,
            riseOnHover: true
          });
          m.bindPopup(popupHTML(p));
          m.on('click', function () {
            if (handlers.onSelect) handlers.onSelect(p.id);
          });
          m.addTo(markerLayer);
          markers[p.id] = m;
        } else if (m._sig !== sig) {
          m.setLatLng([p.lat, p.lng]);
          m.setIcon(pinIcon(p, p.id === activeId));
          m.setPopupContent(popupHTML(p));
        }
        m._sig = sig;
      });

      Object.keys(markers).forEach(function (id) {
        if (alive[id]) return;
        markerLayer.removeLayer(markers[id]);
        delete markers[id];
      });
    },

    /** 특정 장소로 이동하고 말풍선을 연다. */
    focus: function (place, openPopup) {
      if (!map || !place || place.lat === null) return;
      map.setView([place.lat, place.lng], Math.max(map.getZoom(), 15), { animate: true });
      var m = markers[place.id];
      if (m && openPopup !== false) m.openPopup();
    },

    /** 기록이 있는 곳 전체가 보이도록 맞춘다. */
    fitAll: function (places) {
      if (!map) return;
      var pts = places.filter(function (p) { return p.lat !== null; })
        .map(function (p) { return [p.lat, p.lng]; });
      if (!pts.length) return;
      if (pts.length === 1) map.setView(pts[0], 15);
      else map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
    },

    /** 입력 중인 장소의 임시 핀(드래그로 미세 조정 가능) */
    setDraft: function (lat, lng, onMove) {
      if (!map) return;
      if (draftMarker) map.removeLayer(draftMarker);
      draftMarker = L.marker([lat, lng], {
        icon: pinIcon({ favorite: false, rating: 0 }, true),
        draggable: true,
        zIndexOffset: 1000
      });
      draftMarker.on('dragend', function () {
        var ll = draftMarker.getLatLng();
        if (onMove) onMove(ll.lat, ll.lng);
      });
      draftMarker.addTo(map);
      map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
    },

    clearDraft: function () {
      if (map && draftMarker) map.removeLayer(draftMarker);
      draftMarker = null;
    },

    /** 브라우저 위치 정보 요청 */
    locate: function (onOk, onFail) {
      if (!navigator.geolocation) {
        onFail && onFail('이 브라우저에서는 위치 정보를 쓸 수 없어요.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { onOk(pos.coords.latitude, pos.coords.longitude); },
        function () { onFail && onFail('위치를 가져오지 못했어요. 위치 권한을 확인해 주세요.'); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },

    panTo: function (lat, lng, zoom) {
      if (map) map.setView([lat, lng], zoom || 16, { animate: true });
    },

    /** 화면 크기/탭 전환 뒤 타일이 어긋나지 않도록 */
    refresh: function () {
      if (map) setTimeout(function () { map.invalidateSize(); }, 60);
    },

    starText: starText,
    esc: esc
  };
})();
