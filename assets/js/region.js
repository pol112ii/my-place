/* region.js — 주소에서 '지역' 이름을 뽑아낸다.
   목록을 지역별로 묶는 기준이 되며, 사용자가 직접 고쳐 쓸 수 있다.
   (예: 서울특별시 송파구 방이동 → 방이동 / 송파구 / 서울 중에서 고름) */
var Region = (function () {
  'use strict';

  var NONE = '지역 없음';

  /* 시·도 이름을 짧게 */
  var SIDO = {
    '서울특별시': '서울', '서울시': '서울', '서울': '서울',
    '부산광역시': '부산', '부산시': '부산', '부산': '부산',
    '대구광역시': '대구', '대구시': '대구',
    '인천광역시': '인천', '인천시': '인천', '인천': '인천',
    '광주광역시': '광주',
    '대전광역시': '대전', '대전시': '대전', '대전': '대전',
    '울산광역시': '울산', '울산시': '울산', '울산': '울산',
    '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
    '경기도': '경기', '경기': '경기',
    '강원도': '강원', '강원특별자치도': '강원', '강원': '강원',
    '충청북도': '충북', '충북': '충북',
    '충청남도': '충남', '충남': '충남',
    '전라북도': '전북', '전북특별자치도': '전북', '전북': '전북',
    '전라남도': '전남', '전남': '전남',
    '경상북도': '경북', '경북': '경북',
    '경상남도': '경남', '경남': '경남',
    '제주특별자치도': '제주', '제주도': '제주', '제주': '제주'
  };

  var RE_SIDO = /(특별시|광역시|특별자치시|특별자치도)$/;
  var RE_SI = /[가-힣](시|군)$/;
  var RE_GU = /[가-힣]구$/;
  var RE_DONG = /[가-힣](동|읍|면|리|가)$/;
  var DROP = ['대한민국', 'South Korea', 'Republic of Korea', 'Korea'];

  function shortSido(v) {
    if (!v) return '';
    v = String(v).trim();
    return SIDO[v] || v.replace(/(특별자치도|특별자치시|특별시|광역시)$/, '') || v;
  }

  function usableParts(text) {
    return String(text || '')
      .split(',')
      .map(function (p) { return p.trim(); })
      .filter(function (p) {
        return p && !/^\d[\d-]*$/.test(p) && DROP.indexOf(p) === -1;
      });
  }

  /**
   * 주소 문자열에서 시·도 / 시·군 / 구 / 읍·면·동을 찾아낸다.
   * Nominatim 주소는 좁은 곳 → 넓은 곳 순서라 앞에서부터 훑는다.
   */
  function fromText(text) {
    var parts = usableParts(text);
    var out = { sido: '', si: '', gu: '', dong: '' };

    parts.forEach(function (p) {
      if (!out.sido && (SIDO[p] || RE_SIDO.test(p) || /^[가-힣]{2}도$/.test(p))) {
        out.sido = shortSido(p);
      } else if (!out.gu && RE_GU.test(p)) {
        out.gu = p;
      } else if (!out.si && RE_SI.test(p)) {
        out.si = p;
      } else if (!out.dong && RE_DONG.test(p)) {
        out.dong = p;
      }
    });

    // 한국 주소가 아니면 뒤쪽 두 조각(도시·나라)을 쓴다.
    if (!out.sido && !out.si && !out.gu && !out.dong && parts.length) {
      out.sido = parts[parts.length - 1] || '';
      out.si = parts.length > 1 ? parts[parts.length - 2] : '';
    }
    return out;
  }

  /** Nominatim의 addressdetails 구조에서 뽑아낸다(있으면 문자열보다 정확하다). */
  function fromDetails(a) {
    if (!a) return { sido: '', si: '', gu: '', dong: '' };

    var sido = a.province || a.state || '';
    if (!sido && a.city && RE_SIDO.test(a.city)) sido = a.city;

    var si = '';
    [a.city, a.town, a.municipality, a.county].forEach(function (v) {
      if (!si && v && v !== sido && !RE_SIDO.test(v)) si = v;
    });

    var gu = a.city_district || a.borough || '';
    if (gu && !RE_GU.test(gu) && !si) { si = gu; gu = ''; }

    return {
      sido: shortSido(sido) || (!sido && a.country ? a.country : ''),
      si: String(si || '').trim(),
      gu: String(gu || '').trim(),
      dong: String(a.suburb || a.quarter || a.neighbourhood || a.village || '').trim()
    };
  }

  /** 고를 수 있는 후보들 — 좁은 곳부터. */
  function suggest(source) {
    var r = (source && typeof source === 'object') ? fromDetails(source) : fromText(source);
    var out = [];
    [r.dong, r.gu, r.si, r.sido].forEach(function (v) {
      if (v && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  /**
   * 기본값. 시·군을 먼저 본다 — '북구'처럼 여러 도시에 있는 이름보다
   * '포항시'가 혼자서도 어디인지 알 수 있기 때문이다.
   * 특별시·광역시 안에서는 시·군이 없으므로 자연히 '구'가 쓰인다.
   */
  function guess(source) {
    var r = (source && typeof source === 'object') ? fromDetails(source) : fromText(source);
    return r.si || r.gu || r.dong || r.sido || '';
  }

  return {
    NONE: NONE,
    fromText: fromText,
    fromDetails: fromDetails,
    suggest: suggest,
    guess: guess,

    /** 기록 하나가 속한 지역 이름 */
    of: function (place) {
      if (!place) return NONE;
      return place.region || guess(place.address) || NONE;
    }
  };
})();
