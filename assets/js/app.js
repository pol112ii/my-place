/* app.js — 화면 구성과 사용자 조작 처리 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = MapView.esc;

  var els = {
    toolbar: $('.toolbar'),
    q: $('#q'),
    chips: document.querySelectorAll('.chip[data-scope]'),
    regionFilter: $('#region-filter'),
    tagFilter: $('#tag-filter'),
    sort: $('#sort'),
    list: $('#list'),
    empty: $('#empty'),
    count: $('#count'),
    listHint: $('#list-hint'),
    map: $('#map'),
    mapOffline: $('#map-offline'),
    mapHint: $('#map-hint'),
    tabs: document.querySelectorAll('.tab'),
    panels: { map: $('#view-map'), list: $('#view-list') },
    sheet: $('#sheet-backdrop'),
    form: $('#form'),
    sheetTitle: $('#sheet-title'),
    fName: $('#f-name'),
    fDate: $('#f-date'),
    fRegion: $('#f-region'),
    regionPicks: $('#region-picks'),
    fTags: $('#f-tags'),
    fMemo: $('#f-memo'),
    fFav: $('#f-fav'),
    rating: $('#f-rating'),
    rateText: $('#rate-text'),
    locText: $('#f-loc-text'),
    btnLocClear: $('#btn-loc-clear'),
    locOpen: $('#loc-open'),
    linkGoogle: $('#link-google'),
    linkApple: $('#link-apple'),
    linkDir: $('#link-dir'),
    btnDelete: $('#btn-delete'),
    geoResults: $('#geo-results'),
    pickbar: $('#pickbar'),
    menu: $('#menu'),
    btnMenu: $('#btn-menu'),
    toast: $('#toast'),
    fileInput: $('#file-input')
  };

  var filters = { q: '', scope: 'all', region: '', tag: '', sort: 'region' };
  var activeId = null;
  var view = 'map';           // 좁은 화면에서 보이는 패널
  var draft = null;           // 편집 중인 장소의 임시 상태
  var pickMode = false;
  var searchAbort = null;
  var searchTimer = null;
  var toastTimer = null;

  /* ---------- 작은 도우미 ---------- */

  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 2600);
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function starHTML(n) {
    return MapView.starText(n).replace(/☆/g, '<span class="off">☆</span>');
  }

  function saveFeedback(res) {
    if (res && res.result && res.result.ok === false) {
      toast('저장 공간이 가득 찼어요. 백업을 내보낸 뒤 정리해 주세요.', 5000);
    }
  }

  function measureToolbar() {
    var h = Math.round(els.toolbar.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--toolbar-h', h + 'px');
  }

  /* ---------- 목록 만들기 ---------- */

  function visible() {
    var q = filters.q.trim().toLowerCase();
    var out = Store.list().filter(function (p) {
      if (filters.scope === 'fav' && !p.favorite) return false;
      if (filters.scope === 'top' && p.rating < 4) return false;
      if (filters.region && Region.of(p) !== filters.region) return false;
      if (filters.tag && p.tags.indexOf(filters.tag) === -1) return false;
      if (!q) return true;
      var hay = [p.name, p.memo, p.address, p.tags.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    var by = {
      visited: function (a, b) {
        return (b.visitedAt || '').localeCompare(a.visitedAt || '') ||
               b.createdAt.localeCompare(a.createdAt);
      },
      rating: function (a, b) {
        return (b.rating - a.rating) || (Number(b.favorite) - Number(a.favorite)) ||
               (b.visitedAt || '').localeCompare(a.visitedAt || '');
      },
      created: function (a, b) { return b.createdAt.localeCompare(a.createdAt); },
      name: function (a, b) { return a.name.localeCompare(b.name, 'ko'); }
    };
    return out.sort(by[filters.sort] || by.visited);
  }

  function cardHTML(p, showRegion) {
    var meta = [];
    if (p.visitedAt) meta.push(p.visitedAt.replace(/-/g, '.'));
    if (showRegion && Region.of(p) !== Region.NONE) meta.push(Region.of(p));
    if (p.address) meta.push(p.address.split(',')[0].trim());
    else if (p.lat === null) meta.push('위치 없음');

    return '' +
      '<button type="button" class="card-main" data-open="' + esc(p.id) + '">' +
        '<span class="card-top">' +
          '<span class="card-name">' + esc(p.name) + '</span>' +
          '<span class="card-stars">' + starHTML(p.rating) + '</span>' +
        '</span>' +
        (meta.length ? '<span class="card-meta">' + esc(meta.join(' · ')) + '</span>' : '') +
        (p.memo ? '<p class="card-memo">' + esc(p.memo) + '</p>' : '') +
      '</button>' +
      '<button type="button" class="card-fav' + (p.favorite ? ' is-on' : '') + '" data-fav="' + esc(p.id) + '"' +
        ' aria-pressed="' + (p.favorite ? 'true' : 'false') + '" title="즐겨찾기">★</button>' +
      // 태그와 편집 버튼을 한 줄에 둔다 — 겹치지 않으면서 줄 수도 늘지 않는다.
      '<div class="card-foot">' +
        '<span class="card-tags">' + p.tags.map(function (t) {
          return '<span class="tag">#' + esc(t) + '</span>';
        }).join('') + '</span>' +
        '<button type="button" class="card-edit" data-edit="' + esc(p.id) + '">편집</button>' +
      '</div>';
  }

  function cardBox(p, showRegion, tag) {
    tag = tag || 'div';
    return '<' + tag + ' class="card' + (p.id === activeId ? ' is-active' : '') + '">' +
      cardHTML(p, showRegion) + '</' + tag + '>';
  }

  /** 지역 이름 정렬 — '지역 없음'은 늘 맨 끝으로. */
  function byRegionName(a, b) {
    if (a === Region.NONE) return 1;
    if (b === Region.NONE) return -1;
    return a.localeCompare(b, 'ko');
  }

  /** 지역별로 묶어 소제목과 함께 그린다. */
  function groupedHTML(items) {
    var groups = {};
    items.forEach(function (p) {
      var key = Region.of(p);
      (groups[key] || (groups[key] = [])).push(p);
    });

    // 묶음마다 따로 감싸야 소제목이 다음 묶음에 밀려 자연스럽게 올라간다.
    return Object.keys(groups).sort(byRegionName).map(function (key) {
      return '<li class="group">' +
          '<h3 class="group-head">' +
            '<span class="group-name">' + esc(key) + '</span>' +
            '<span class="group-count">' + groups[key].length + '곳</span>' +
          '</h3>' +
          groups[key].map(function (p) { return cardBox(p, false); }).join('') +
        '</li>';
    }).join('');
  }

  function refreshFilterOptions() {
    var tagSeen = {};
    var regionSeen = {};
    Store.list().forEach(function (p) {
      p.tags.forEach(function (t) { tagSeen[t] = true; });
      regionSeen[Region.of(p)] = true;
    });

    var tags = Object.keys(tagSeen).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    if (tags.indexOf(filters.tag) === -1) filters.tag = '';
    els.tagFilter.innerHTML = '<option value="">모든 태그</option>' +
      tags.map(function (t) {
        return '<option value="' + esc(t) + '">#' + esc(t) + '</option>';
      }).join('');
    els.tagFilter.value = filters.tag;

    var regions = Object.keys(regionSeen).sort(byRegionName);
    if (regions.indexOf(filters.region) === -1) filters.region = '';
    els.regionFilter.innerHTML = '<option value="">모든 지역</option>' +
      regions.map(function (r) {
        return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
      }).join('');
    els.regionFilter.value = filters.region;
  }

  function render() {
    var items = visible();
    var total = Store.list().length;

    els.list.innerHTML = (filters.sort === 'region')
      ? groupedHTML(items)
      : items.map(function (p) { return cardBox(p, true, 'li'); }).join('');

    // 안내문은 첫 기록을 남기기 전까지만 보여 준다.
    if (MapView.available()) els.mapHint.hidden = total > 0;

    els.count.textContent = items.length + '곳';
    els.listHint.textContent = (items.length !== total) ? '전체 ' + total + '곳 중' : '';
    els.empty.hidden = items.length > 0;
    if (total > 0 && items.length === 0) {
      els.empty.querySelector('.empty-title').textContent = '조건에 맞는 기록이 없어요';
      els.empty.querySelector('.empty-sub').innerHTML = '검색어나 필터를 바꿔 보세요.';
    }

    MapView.render(items, activeId);
  }

  /* ---------- 입력 시트 ---------- */

  function setRating(v) {
    draft.rating = v;
    Array.prototype.forEach.call(els.rating.querySelectorAll('.star'), function (btn) {
      var on = Number(btn.getAttribute('data-v')) <= v;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var words = ['아직 선택 안 함', '그냥 그랬음', '괜찮았음', '좋았음', '아주 좋았음', '최고였음'];
    els.rateText.textContent = words[v];
  }

  /** 주소에서 뽑은 지역 후보를 눌러 고를 수 있게 보여 준다. */
  function setRegionPicks(list) {
    var picks = (list || []).filter(Boolean);
    els.regionPicks.innerHTML = picks.map(function (r) {
      return '<button type="button" class="pick" data-region="' + esc(r) + '">' + esc(r) + '</button>';
    }).join('');
    els.regionPicks.hidden = picks.length === 0;
  }

  /** 좌표가 있으면 지도앱으로 바로 열 수 있는 링크를 채운다. */
  function updateMapLinks() {
    var has = draft && draft.lat !== null && draft.lng !== null;
    els.locOpen.hidden = !has;
    if (!has) return;

    var at = draft.lat + ',' + draft.lng;
    var label = encodeURIComponent(els.fName.value.trim() || draft.address || '');
    els.linkGoogle.href = 'https://www.google.com/maps/search/?api=1&query=' + at;
    els.linkApple.href = 'https://maps.apple.com/?ll=' + at + '&q=' + (label || at);
    els.linkDir.href = 'https://www.google.com/maps/dir/?api=1&destination=' + at;
  }

  function setCoords(lat, lng, address) {
    draft.lat = lat;
    draft.lng = lng;
    if (address !== undefined) draft.address = address || '';
    var has = lat !== null && lng !== null;

    els.locText.textContent = has
      ? (draft.address || (lat.toFixed(5) + ', ' + lng.toFixed(5)))
      : '위치가 아직 없어요';
    els.btnLocClear.hidden = !has;
    updateMapLinks();

    if (has) {
      MapView.setDraft(lat, lng, function (nlat, nlng) {
        setCoords(nlat, nlng, '');
        lookupAddress(nlat, nlng);
      });
    } else {
      MapView.clearDraft();
    }
  }

  /** 좌표로 주소를 채워 넣는다(실패해도 조용히 넘어간다). */
  function lookupAddress(lat, lng) {
    if (!Geocode.available) return;
    Geocode.reverse(lat, lng).then(function (found) {
      if (!draft || draft.lat !== lat || draft.lng !== lng || !found) return;
      draft.address = found.address;
      els.locText.textContent = found.address;
      if (!els.fName.value.trim()) els.fName.value = found.name;
      if (!els.fRegion.value.trim()) els.fRegion.value = found.region || '';
      setRegionPicks(found.regionPicks);
      updateMapLinks();
    });
  }

  function openSheet(place, coords) {
    draft = {
      id: place ? place.id : null,
      lat: null, lng: null, address: '',
      rating: place ? place.rating : 0
    };

    els.sheetTitle.textContent = place ? '장소 수정' : '장소 추가';
    els.btnDelete.hidden = !place;
    els.fName.value = place ? place.name : '';
    els.fDate.value = place ? (place.visitedAt || todayISO()) : todayISO();
    els.fRegion.value = place ? place.region : '';
    setRegionPicks(place && place.address ? Region.suggest(place.address) : []);
    els.fTags.value = place ? place.tags.join(', ') : '';
    els.fMemo.value = place ? place.memo : '';
    els.fFav.checked = place ? place.favorite : false;
    els.geoResults.hidden = true;
    els.geoResults.innerHTML = '';
    setRating(draft.rating);

    if (place && place.lat !== null) {
      setCoords(place.lat, place.lng, place.address);
    } else if (coords) {
      setCoords(coords[0], coords[1], '');
      lookupAddress(coords[0], coords[1]);
    } else {
      setCoords(null, null, '');
    }

    els.sheet.hidden = false;
    setTimeout(function () { els.fName.focus(); }, 30);
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.sheet.classList.remove('is-picking');
    els.pickbar.hidden = true;
    pickMode = false;
    draft = null;
    MapView.clearDraft();
    if (searchAbort) searchAbort.abort();
  }

  function startPick() {
    if (!MapView.available()) {
      toast('지도를 쓸 수 없어 위치를 고를 수 없어요.');
      return;
    }
    pickMode = true;
    els.sheet.classList.add('is-picking');
    els.pickbar.hidden = false;
    showView('map');
  }

  function stopPick() {
    pickMode = false;
    els.sheet.classList.remove('is-picking');
    els.pickbar.hidden = true;
  }

  function submit(e) {
    e.preventDefault();
    var name = els.fName.value.trim();
    if (!name) { els.fName.focus(); return; }

    var res = Store.put({
      id: draft.id || undefined,
      name: name,
      address: draft.address,
      lat: draft.lat,
      lng: draft.lng,
      region: els.fRegion.value,
      rating: draft.rating,
      favorite: els.fFav.checked,
      memo: els.fMemo.value,
      tags: els.fTags.value,
      visitedAt: els.fDate.value
    });

    var saved = res.place;
    var wasNew = !draft.id;
    activeId = saved.id;
    closeSheet();
    saveFeedback(res);
    toast(wasNew ? '‘' + saved.name + '’ 기록했어요' : '수정했어요');
    if (saved.lat !== null) MapView.focus(saved, false);
  }

  /* ---------- 이름으로 장소 찾기 ---------- */

  function renderGeoResults(items, message) {
    if (message) {
      els.geoResults.innerHTML = '<p class="geo-msg">' + esc(message) + '</p>';
      els.geoResults.hidden = false;
      return;
    }
    els.geoResults.innerHTML = items.map(function (r, i) {
      return '<button type="button" data-geo="' + i + '">' +
        '<span class="g-name">' + esc(r.name) + '</span>' +
        '<span class="g-addr">' + esc(r.address) + '</span></button>';
    }).join('');
    els.geoResults.hidden = false;
    els.geoResults._items = items;
  }

  function searchPlace() {
    var q = els.fName.value.trim();
    if (q.length < 2) { renderGeoResults([], '두 글자 이상 입력해 주세요.'); return; }
    if (!Geocode.available) { renderGeoResults([], '이 브라우저에서는 검색을 쓸 수 없어요.'); return; }

    renderGeoResults([], '‘' + q + '’ 찾는 중…');
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();

    Geocode.search(q, searchAbort.signal).then(function (items) {
      if (!items.length) renderGeoResults([], '찾지 못했어요. 지도에서 직접 골라도 됩니다.');
      else renderGeoResults(items);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      renderGeoResults([], '검색에 실패했어요. 지도에서 직접 골라 주세요.');
    });
  }

  /* ---------- 백업 ---------- */

  function exportBackup() {
    if (!Store.list().length) { toast('내보낼 기록이 없어요.'); return; }
    var blob = new Blob([Store.toJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '나만의-장소-' + todayISO().replace(/-/g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('백업 파일을 내려받았어요.');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var res = Store.fromJSON(String(reader.result), 'merge');
        saveFeedback(res);
        toast(res.count + '곳을 가져왔어요.');
        MapView.fitAll(Store.list());
      } catch (err) {
        toast('백업 파일을 읽지 못했어요.');
      }
    };
    reader.readAsText(file);
  }

  function addSamples() {
    [
      { name: '경복궁', address: '서울 종로구 사직로 161', lat: 37.5796, lng: 126.9770,
        rating: 5, favorite: true, tags: ['산책', '서울'], visitedAt: todayISO(),
        memo: '해 질 무렵 근정전 앞이 특히 좋았다. 다음엔 한복 입고 다시.' },
      { name: '광안리 해변', address: '부산 수영구 광안해변로', lat: 35.1532, lng: 129.1186,
        rating: 4, tags: ['바다', '부산'], visitedAt: todayISO(),
        memo: '밤에 다리 불빛 보면서 걷기. 파도 소리가 오래 남았다.' },
      { name: '월정리 해변', address: '제주 제주시 구좌읍 월정리', lat: 33.5563, lng: 126.7955,
        rating: 5, favorite: true, tags: ['바다', '제주'], visitedAt: todayISO(),
        memo: '물빛이 비현실적이었던 곳.' }
    ].forEach(function (p) { Store.put(p); });
    toast('예시 장소 3곳을 넣었어요. 지워도 됩니다.');
    MapView.fitAll(Store.list());
  }

  /* ---------- 화면 전환 ---------- */

  function showView(next) {
    view = next;
    Object.keys(els.panels).forEach(function (k) {
      els.panels[k].classList.toggle('is-shown', k === view);
    });
    Array.prototype.forEach.call(els.tabs, function (t) {
      t.classList.toggle('is-on', t.getAttribute('data-view') === view);
    });
    if (view === 'map') MapView.refresh();
  }

  function selectPlace(id) {
    activeId = id;
    render();
    var p = Store.get(id);
    if (p && p.lat !== null) {
      showView('map');
      MapView.focus(p);
    } else if (p) {
      toast('이 기록에는 위치가 없어요. 편집에서 추가할 수 있어요.');
    }
  }

  /* ---------- 테마 ---------- */

  var THEME_KEY = 'myplace.theme';

  function applyTheme(mode) {
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    try { mode ? localStorage.setItem(THEME_KEY, mode) : localStorage.removeItem(THEME_KEY); }
    catch (e) { /* 저장 못 해도 이번 세션에는 적용된다 */ }
  }

  function cycleTheme() {
    var order = ['', 'light', 'dark'];
    var now = document.documentElement.getAttribute('data-theme') || '';
    var next = order[(order.indexOf(now) + 1) % order.length];
    applyTheme(next);
    toast(next === '' ? '시스템 설정을 따릅니다' : next === 'light' ? '밝은 화면' : '어두운 화면', 1400);
  }

  /* ---------- 이벤트 연결 ---------- */

  function bind() {
    // 검색 / 필터
    els.q.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        filters.q = els.q.value;
        render();
      }, 160);
    });

    Array.prototype.forEach.call(els.chips, function (chip) {
      chip.addEventListener('click', function () {
        filters.scope = chip.getAttribute('data-scope');
        Array.prototype.forEach.call(els.chips, function (c) {
          c.classList.toggle('is-on', c === chip);
        });
        render();
      });
    });
    els.regionFilter.addEventListener('change', function () {
      filters.region = els.regionFilter.value;
      render();
    });
    els.tagFilter.addEventListener('change', function () {
      filters.tag = els.tagFilter.value;
      render();
    });
    els.sort.addEventListener('change', function () {
      filters.sort = els.sort.value;
      render();
    });

    // 목록 카드
    els.list.addEventListener('click', function (e) {
      var open = e.target.closest('[data-open]');
      var fav = e.target.closest('[data-fav]');
      var edit = e.target.closest('[data-edit]');
      if (fav) {
        var p = Store.get(fav.getAttribute('data-fav'));
        if (p) {
          p.favorite = !p.favorite;
          saveFeedback(Store.put(p));
        }
      } else if (edit) {
        openSheet(Store.get(edit.getAttribute('data-edit')));
      } else if (open) {
        selectPlace(open.getAttribute('data-open'));
      }
    });

    // 탭 / 추가 버튼
    Array.prototype.forEach.call(els.tabs, function (t) {
      t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
    });
    $('#btn-add').addEventListener('click', function () { openSheet(null, null); });
    $('#btn-locate').addEventListener('click', function () {
      MapView.locate(function (lat, lng) {
        MapView.panTo(lat, lng, 16);
        toast('현재 위치로 이동했어요.');
      }, toast);
    });

    // 시트
    els.form.addEventListener('submit', submit);
    $('#btn-close').addEventListener('click', closeSheet);
    $('#btn-cancel').addEventListener('click', closeSheet);
    els.sheet.addEventListener('mousedown', function (e) {
      if (e.target === els.sheet) closeSheet();
    });

    els.regionPicks.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-region]');
      if (btn) els.fRegion.value = btn.getAttribute('data-region');
    });
    els.fName.addEventListener('input', updateMapLinks);

    els.rating.addEventListener('click', function (e) {
      var star = e.target.closest('.star');
      if (!star) return;
      var v = Number(star.getAttribute('data-v'));
      setRating(draft.rating === v ? 0 : v);   // 같은 별을 다시 누르면 해제
    });

    $('#btn-search-place').addEventListener('click', searchPlace);
    els.fName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); searchPlace(); }
    });
    els.geoResults.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-geo]');
      if (!btn) return;
      var item = (els.geoResults._items || [])[Number(btn.getAttribute('data-geo'))];
      if (!item) return;
      els.fName.value = item.name;
      setCoords(item.lat, item.lng, item.address);
      if (!els.fRegion.value.trim()) els.fRegion.value = item.region || '';
      setRegionPicks(item.regionPicks);
      els.geoResults.hidden = true;
      toast('위치를 넣었어요. 지도에서 핀을 끌어 미세 조정할 수 있어요.', 3200);
    });

    $('#btn-pick').addEventListener('click', startPick);
    $('#btn-pick-cancel').addEventListener('click', stopPick);
    $('#btn-here').addEventListener('click', function () {
      MapView.locate(function (lat, lng) {
        setCoords(lat, lng, '');
        lookupAddress(lat, lng);
        toast('현재 위치를 넣었어요.');
      }, toast);
    });
    els.btnLocClear.addEventListener('click', function () { setCoords(null, null, ''); });

    els.btnDelete.addEventListener('click', function () {
      var p = draft && draft.id ? Store.get(draft.id) : null;
      if (!p) return;
      if (!confirm('‘' + p.name + '’ 기록을 지울까요? 되돌릴 수 없어요.')) return;
      Store.remove(p.id);
      if (activeId === p.id) activeId = null;
      closeSheet();
      toast('기록을 지웠어요.');
    });

    // 설정 메뉴
    els.btnMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = els.menu.hidden;
      els.menu.hidden = !open;
      els.btnMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      els.menu.hidden = true;
      els.btnMenu.setAttribute('aria-expanded', 'false');
    });
    els.menu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) { e.stopPropagation(); return; }
      var act = btn.getAttribute('data-act');
      if (act === 'export') exportBackup();
      if (act === 'import') els.fileInput.click();
      if (act === 'sample') addSamples();
      if (act === 'reset') {
        if (confirm('기록 ' + Store.list().length + '곳을 모두 지울까요? 되돌릴 수 없어요.\n먼저 백업을 내보내 두는 것을 권합니다.')) {
          Store.clear();
          activeId = null;
          toast('전체 기록을 지웠어요.');
        }
      }
    });
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files[0]) importBackup(els.fileInput.files[0]);
      els.fileInput.value = '';
    });

    $('#btn-theme').addEventListener('click', cycleTheme);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (pickMode) stopPick();
      else if (!els.sheet.hidden) closeSheet();
      else if (!els.menu.hidden) els.menu.hidden = true;
    });

    window.addEventListener('resize', measureToolbar);
    enableSheetDrag();
  }

  /** 시트 손잡이를 아래로 끌면 닫힌다 (손잡이 영역에서만 반응하므로 본문 스크롤과 겹치지 않는다). */
  function enableSheetDrag() {
    var head = els.sheet.querySelector('.sheet-head');
    var startY = null;
    var moved = 0;

    head.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      moved = 0;
      els.form.style.transition = 'none';
    }, { passive: true });

    head.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      moved = Math.max(0, e.touches[0].clientY - startY);
      els.form.style.transform = 'translateY(' + moved + 'px)';
    }, { passive: true });

    function release() {
      if (startY === null) return;
      els.form.style.transition = '';
      els.form.style.transform = '';
      if (moved > 90) closeSheet();
      startY = null;
      moved = 0;
    }
    head.addEventListener('touchend', release);
    head.addEventListener('touchcancel', release);
  }

  /* ---------- 시작 ---------- */

  function start() {
    try { applyTheme(localStorage.getItem(THEME_KEY) || ''); } catch (e) { /* 무시 */ }

    Store.init();
    Store.subscribe(function () {
      refreshFilterOptions();
      render();
    });

    var mapOk = MapView.init(els.map, {
      onMapClick: function (lat, lng) {
        if (pickMode) {
          setCoords(lat, lng, '');
          lookupAddress(lat, lng);
          stopPick();
          return;
        }
        if (!els.sheet.hidden) return;
        openSheet(null, [lat, lng]);
      },
      onSelect: function (id) { activeId = id; render(); },
      onEdit: function (id) { openSheet(Store.get(id)); }
    });

    if (!mapOk) {
      els.mapOffline.hidden = false;
      els.mapHint.hidden = true;
      $('#btn-locate').hidden = true;
    }

    bind();
    measureToolbar();
    refreshFilterOptions();
    render();
    showView(mapOk ? 'map' : 'list');
    MapView.fitAll(Store.list());

    // 홈 화면에 추가해 두면 인터넷이 없어도 기록을 열어 볼 수 있다.
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 없어도 무방 */ });
    }

    if (Store.isVolatile()) {
      toast('이 브라우저에서는 저장이 막혀 있어요. 창을 닫으면 기록이 사라집니다.', 6000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
