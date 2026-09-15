/*!
 * 카곰의 얼룩덜룩 — 게임 허브
 * - 게임 하나하나는 따로 만든 위젯이고, 이 파일은 그걸 고르는 껍데기다.
 * - 어떤 게임이 있는지는 **서버(game.soosin.com/api/assets)가 알려준다** →
 *   게임을 추가·교체할 때 블로그 페이지를 다시 건드릴 필요가 없다.
 *   서버가 죽어 있으면 아래 FALLBACK 으로 돈다.
 * - 고른 게임만 그때 불러오고(lazy), 한 번 부른 게임은 감췄다 보였다 하므로
 *   탭을 옮겨도 하던 판이 그대로 남는다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var LS_LAST = 'bgame-last';

  // 서버를 못 읽을 때 쓰는 최후의 목록 (배포 시점 기준)
  var FALLBACK = [
    { key: 'minesweeper', name: '지뢰찾기', mount: 'bmine-app',
      src: 'https://cdn.jsdelivr.net/gh/ParkSooSin/blog-assets@d8e9529e9041b071d59652f40922e96181e2034e/game/minesweeper.js' },
    { key: 'sudoku', name: '스도쿠', mount: 'bsudoku-app',
      src: 'https://cdn.jsdelivr.net/gh/ParkSooSin/blog-assets@82a187fe3d0e7b5d9154af8a9f780ff78f45faa7/game/sudoku.js' }
  ];

  var root = document.getElementById('bgame-hub');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------------------------------------------------------------- 스타일 */

  var CSS = [
    '#bgame-hub{--bh-ink:#6f6f66;--bh-line:#dcdcd4;--bh-line2:#e9e9e2;--bh-text:#2b2b28;',
    '  --bh-dim:#8a8a80;--bh-bar:#f6f6f2;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bh-text);margin:18px 0;text-align:left;line-height:1.5;}',
    '#bgame-hub *{box-sizing:border-box;}',
    '#bgame-hub button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bh-text);}',

    /* 탭 줄도 카드로 감싼다 — 안 그러면 블로그 배경무늬가 비쳐 게임 카드와 따로 논다 */
    '#bgame-hub .bh-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;',
    '  background:#fff;border:1px solid var(--bh-line);border-radius:6px;',
    '  padding:8px 10px;margin:0;}',
    '#bgame-hub .bh-label{font-size:12px;color:var(--bh-dim);font-weight:700;margin-right:4px;',
    '  letter-spacing:.02em;}',
    '#bgame-hub .bh-tabs button{border:1px solid var(--bh-line);background:#fff;border-radius:5px;',
    '  height:34px;padding:0 15px;font-size:14px;white-space:nowrap;}',
    '#bgame-hub .bh-tabs button:hover{background:#f4f4ef;}',
    '#bgame-hub .bh-tabs button.on{background:var(--bh-ink);color:#fff;font-weight:700;',
    '  border-color:var(--bh-ink);}',

    '#bgame-hub .bh-slot{display:none;}',
    '#bgame-hub .bh-slot.on{display:block;}',
    // 게임 위젯이 스스로 갖는 위아래 여백은 허브 안에서 한 번만 준다
    '#bgame-hub .bh-slot > div{margin-top:14px !important;margin-bottom:0 !important;}',
    '#bgame-hub .bh-state{padding:26px 10px;text-align:center;color:var(--bh-dim);font-size:13px;}',

    '@media (max-width:820px){',
    '#bgame-hub .bh-tabs{gap:5px;padding:7px 8px;}',
    '#bgame-hub .bh-tabs button{height:32px;padding:0 12px;font-size:13px;}',
    '#bgame-hub .bh-label{display:none;}',
    '}'
  ].join('');
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  /* ---------------------------------------------------------------- 뼈대 */

  var tabs = el('div', 'bh-tabs');
  tabs.appendChild(el('span', 'bh-label', '게임'));
  var body = el('div');
  var state = el('div', 'bh-state', '게임 목록을 불러오는 중…');
  root.appendChild(tabs);
  root.appendChild(state);
  root.appendChild(body);

  var slots = {};     // key → 게임이 들어갈 칸
  var loaded = {};    // key → 스크립트를 이미 불러왔는가
  var games = [];
  var current = null;

  /* ---------------------------------------------------------------- 게임 열기 */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }

  function show(key) {
    var g = null;
    for (var i = 0; i < games.length; i++) if (games[i].key === key) g = games[i];
    if (!g) return;
    current = key;
    lsSet(LS_LAST, key);

    [].forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.key === key);
    });
    Object.keys(slots).forEach(function (k) {
      slots[k].classList.toggle('on', k === key);
    });

    if (loaded[g.key]) return;
    loaded[g.key] = true;

    // 게임 스크립트는 자기 마운트 지점을 바로 찾는다 → 칸을 먼저 만들어 두고 부른다
    var mount = el('div');
    mount.id = g.mount;
    slots[g.key].appendChild(mount);
    var busy = el('div', 'bh-state', g.name + ' 불러오는 중…');
    slots[g.key].appendChild(busy);

    loadScript(g.src).then(function () {
      busy.remove();
      if (!mount.dataset.booted) {
        slots[g.key].appendChild(
          el('div', 'bh-state', g.name + '을(를) 시작하지 못했습니다. 새로고침해 주세요.'));
      }
    }).catch(function () {
      busy.remove();
      loaded[g.key] = false;   // 다시 눌러보면 재시도할 수 있게
      mount.remove();
      slots[g.key].appendChild(
        el('div', 'bh-state', g.name + '을(를) 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.'));
    });
  }

  function build(list) {
    games = list;
    state.remove();
    tabs.querySelectorAll('button').forEach(function (b) { b.remove(); });
    body.textContent = '';
    slots = {};

    games.forEach(function (g) {
      var b = el('button', '', g.name);
      b.type = 'button';
      b.dataset.key = g.key;
      b.addEventListener('click', function () {
        show(g.key);
        // ⚠️ replaceState 의 주소는 **문서의 base URL 기준**으로 풀린다.
        //    `<base href>` 가 있는 페이지에서는 '#key' 든 '/경로#key' 든 엉뚱한 주소가 되므로
        //    (다른 도메인이면 SecurityError) origin 까지 붙인 완전한 주소를 넘긴다.
        try {
          if (history.replaceState) {
            history.replaceState(null, '',
              location.origin + location.pathname + location.search + '#' + g.key);
          }
        } catch (e) { /* 주소 표시는 곁가지다 — 실패해도 게임엔 지장 없다 */ }
      });
      tabs.appendChild(b);
      var slot = el('div', 'bh-slot');
      slot.dataset.key = g.key;
      slots[g.key] = slot;
      body.appendChild(slot);
    });

    // 주소 끝에 #스도쿠 같은 게 붙어 있으면 그걸 먼저, 없으면 지난번에 하던 것
    var want = (location.hash || '').replace('#', '');
    var known = games.some(function (g) { return g.key === want; });
    if (!known) want = lsGet(LS_LAST, '');
    if (!games.some(function (g) { return g.key === want; })) want = games[0].key;
    show(want);
  }

  function start() {
    fetch(API + '/api/assets', { mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.ok && j.games && j.games.length) ? j.games : FALLBACK;
        build(list);
      })
      .catch(function () { build(FALLBACK); });
  }

  window.addEventListener('hashchange', function () {
    var want = (location.hash || '').replace('#', '');
    if (want && want !== current && games.some(function (g) { return g.key === want; })) show(want);
  });

  start();
  root.dataset.version = VERSION;
})();
