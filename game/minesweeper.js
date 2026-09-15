/*!
 * 카곰의 얼룩덜룩 — 지뢰찾기 (클라이언트 전용 + 순위 서버)
 * - 게임은 전부 이 브라우저에서 돈다. 홈랩은 순위만 받는다.
 * - 순위 서버가 죽어도 게임과 내 최고기록(localStorage)은 그대로 작동한다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #bmine-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var GAME = 'minesweeper';
  var LS_NICK = 'bmine-nick';
  var LS_BEST = 'bmine-best';

  // 서버 LEVELS 와 반드시 같아야 한다
  var LEVELS = {
    beg: { key: 'beg', name: '초급', w: 9, h: 9, mines: 10 },
    int: { key: 'int', name: '중급', w: 16, h: 16, mines: 40 },
    exp: { key: 'exp', name: '고급', w: 30, h: 16, mines: 99 }
  };
  var ORDER = ['beg', 'int', 'exp'];

  var root = document.getElementById('bmine-app');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  /* ================================================================ 유틸 */

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function fmtMs(ms) {
    var s = ms / 1000;
    return (s < 10 ? s.toFixed(2) : s.toFixed(1)) + '초';
  }

  function fmtClock(ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.min(s, 999)).padStart(3, '0');
  }

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 사파리 시크릿 모드 등 */ }
  }

  function bests() {
    try { return JSON.parse(lsGet(LS_BEST, '{}')) || {}; } catch (e) { return {}; }
  }
  function saveBest(level, ms) {
    var b = bests();
    if (b[level] == null || ms < b[level]) {
      b[level] = ms;
      lsSet(LS_BEST, JSON.stringify(b));
      return true;
    }
    return false;
  }

  // 시드 기반 난수 — 같은 시드+첫클릭이면 같은 판이 나온다(나중에 검증에 쓸 수 있게)
  function rng(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    var a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================ 스타일 */

  var INK = '#5a7285';        // 지뢰찾기 잉크 (UML 위젯의 올리브와 계열 분리)
  var CSS = [
    '#bmine-app{--bm-ink:' + INK + ';--bm-line:#dcdcd4;--bm-line2:#e9e9e2;--bm-text:#2b2b28;',
    '  --bm-dim:#8a8a80;--bm-bg:#ffffff;--bm-bar:#f6f6f2;--bm-cell:#e6e6df;--bm-cell2:#dcdcd2;',
    '  --bm-open:#f7f7f3;--bm-warn:#a5654e;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bm-text);border:1px solid var(--bm-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bm-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#bmine-app *{box-sizing:border-box;}',
    '#bmine-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bm-text);}',

    /* ---- 상단바 ---- */
    '#bmine-app .bm-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bm-bar);border-bottom:1px solid var(--bm-line);}',
    '#bmine-app .bm-brand{font-weight:700;font-size:14px;color:var(--bm-ink);letter-spacing:-.2px;',
    '  margin-right:2px;white-space:nowrap;}',
    '#bmine-app .bm-levels{display:flex;gap:0;border:1px solid var(--bm-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bmine-app .bm-levels button{border:0;background:#fff;height:30px;padding:0 12px;font-size:13px;',
    '  border-right:1px solid var(--bm-line2);}',
    '#bmine-app .bm-levels button:last-child{border-right:0;}',
    '#bmine-app .bm-levels button.on{background:var(--bm-ink);color:#fff;font-weight:600;}',
    '#bmine-app .bm-levels button:not(.on):hover{background:#efefea;}',
    '#bmine-app .bm-spacer{flex:1 1 auto;}',
    '#bmine-app .bm-btn{border:1px solid var(--bm-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#bmine-app .bm-btn:hover{background:#f4f4ef;}',
    '#bmine-app .bm-btn.on{border-color:var(--bm-ink);color:var(--bm-ink);font-weight:600;',
    '  background:#eef2f5;}',

    /* ---- HUD ---- */
    '#bmine-app .bm-hud{display:flex;align-items:center;justify-content:center;gap:14px;',
    '  padding:10px 10px 4px;}',
    '#bmine-app .bm-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:19px;font-weight:600;color:var(--bm-ink);background:var(--bm-bar);',
    '  border:1px solid var(--bm-line);border-radius:4px;padding:3px 10px;min-width:64px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#bmine-app .bm-face{border:1px solid var(--bm-line);background:#fff;border-radius:4px;',
    '  width:40px;height:36px;font-size:19px;line-height:1;display:flex;align-items:center;',
    '  justify-content:center;padding:0;}',
    '#bmine-app .bm-face:hover{background:#f4f4ef;}',

    /* ---- 보드 ---- */
    '#bmine-app .bm-boardwrap{overflow-x:auto;overflow-y:hidden;padding:6px 10px 12px;',
    '  -webkit-overflow-scrolling:touch;}',
    '#bmine-app .bm-board{display:grid;gap:1px;background:var(--bm-line);border:1px solid var(--bm-line);',
    '  margin:0 auto;width:max-content;user-select:none;-webkit-user-select:none;',
    '  -webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
    '#bmine-app .bm-c{border:0;padding:0;background:var(--bm-cell);border-radius:0;display:flex;',
    '  align-items:center;justify-content:center;font-weight:700;line-height:1;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;position:relative;',
    '  box-shadow:inset 1px 1px 0 rgba(255,255,255,.75),inset -1px -1px 0 rgba(0,0,0,.07);}',
    '#bmine-app .bm-c:hover:not(.o){background:var(--bm-cell2);}',
    '#bmine-app .bm-c.o{background:var(--bm-open);box-shadow:none;cursor:default;}',
    '#bmine-app .bm-c.boom{background:#e8c9c3;}',
    '#bmine-app .bm-c.wrong{background:#efe2e0;}',
    '#bmine-app .bm-c svg{width:64%;height:64%;display:block;}',
    '#bmine-app .bm-c.n1{color:#5b7c99;}#bmine-app .bm-c.n2{color:#5f7f5f;}',
    '#bmine-app .bm-c.n3{color:#a5654e;}#bmine-app .bm-c.n4{color:#5d5f9c;}',
    '#bmine-app .bm-c.n5{color:#8a6d3b;}#bmine-app .bm-c.n6{color:#4a8382;}',
    '#bmine-app .bm-c.n7{color:#4a4a46;}#bmine-app .bm-c.n8{color:#8a8a80;}',

    '#bmine-app .bm-help{font-size:12px;color:var(--bm-dim);text-align:center;',
    '  padding:0 10px 10px;}',

    /* ---- 결과 배너 ---- */
    '#bmine-app .bm-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#bmine-app .bm-msg.win{display:flex;background:#eef2f5;border:1px solid #cfd9e0;color:#3f5364;}',
    '#bmine-app .bm-msg.lose{display:flex;background:#faf3f2;border:1px solid #e3c3bf;color:#8c5344;}',
    '#bmine-app .bm-msg .bm-msgt{flex:1 1 auto;min-width:160px;}',
    '#bmine-app .bm-msg input{border:1px solid var(--bm-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:130px;color:inherit;}',
    '#bmine-app .bm-msg input:focus{outline:none;border-color:var(--bm-ink);}',
    '#bmine-app .bm-msg .bm-btn{height:30px;}',

    /* ---- 순위표 ---- */
    '#bmine-app .bm-rank{border-top:1px solid var(--bm-line);background:#fbfbf9;padding:10px;}',
    '#bmine-app .bm-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#bmine-app .bm-ranktitle{font-weight:700;font-size:13px;color:var(--bm-ink);}',
    '#bmine-app .bm-rtabs{display:flex;gap:0;border:1px solid var(--bm-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bmine-app .bm-rtabs button{border:0;background:#fff;height:26px;padding:0 10px;font-size:12px;',
    '  border-right:1px solid var(--bm-line2);}',
    '#bmine-app .bm-rtabs button:last-child{border-right:0;}',
    '#bmine-app .bm-rtabs button.on{background:var(--bm-ink);color:#fff;font-weight:600;}',
    '#bmine-app table.bm-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bm-line);margin:0;}',
    '#bmine-app table.bm-table th,#bmine-app table.bm-table td{border:0;',
    '  border-bottom:1px solid var(--bm-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#bmine-app table.bm-table th{background:var(--bm-bar);font-size:12px;color:var(--bm-dim);',
    '  font-weight:600;}',
    '#bmine-app table.bm-table tr:last-child td{border-bottom:0;}',
    '#bmine-app table.bm-table td.bm-r{width:44px;color:var(--bm-dim);',
    '  font-variant-numeric:tabular-nums;}',
    '#bmine-app table.bm-table td.bm-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-variant-numeric:tabular-nums;}',
    '#bmine-app table.bm-table td.bm-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    '  max-width:1px;}',
    '#bmine-app table.bm-table tr.me td{background:#eef2f5;}',
    '#bmine-app table.bm-table tr.me td.bm-n{font-weight:700;color:var(--bm-ink);}',
    '#bmine-app .bm-note{font-size:12px;color:var(--bm-dim);padding:8px 2px 0;}',
    '#bmine-app .bm-mybest{font-size:12px;color:var(--bm-dim);margin-left:auto;white-space:nowrap;}',
    '#bmine-app .bm-mybest b{color:var(--bm-text);font-weight:700;}',

    /* ---- 모바일 ---- */
    '@media (max-width:820px){',
    '#bmine-app .bm-brand{display:none;}',
    '#bmine-app .bm-top{gap:6px;padding:7px 8px;}',
    '#bmine-app .bm-levels button{padding:0 10px;}',
    '#bmine-app .bm-boardwrap{padding:6px 8px 12px;}',
    '#bmine-app .bm-rank{padding:8px;}',
    '}'
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  var SVG_FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M4 1.6v12.8" stroke="#4a4a46" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M4.9 2.3l7 2.6-7 2.6z" fill="#a5654e"/></svg>';
  // ⚠️ 원이 작고 가시가 길면 지뢰가 아니라 별표로 보인다 — 몸통을 키우고 가시를 짧게
  var SVG_MINE = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 2.4v11.2M2.4 8h11.2M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="#4a4a46" ' +
    'stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="8" cy="8" r="4.5" fill="#4a4a46"/>' +
    '<circle cx="6.4" cy="6.4" r="1.15" fill="#eeeee8"/></svg>';

  /* ================================================================ 마크업 */

  var ui = {};

  (function build() {
    var top = el('div', 'bm-top');
    ui.brand = el('span', 'bm-brand', '지뢰찾기');
    top.appendChild(ui.brand);

    ui.levels = el('div', 'bm-levels');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button';
      b.dataset.level = k;
      b.addEventListener('click', function () { setLevel(k); });
      ui.levels.appendChild(b);
    });
    top.appendChild(ui.levels);
    top.appendChild(el('div', 'bm-spacer'));

    ui.flagBtn = el('button', 'bm-btn', '');
    ui.flagBtn.type = 'button';
    ui.flagBtn.innerHTML = '<span style="width:14px;height:14px;display:inline-flex">' +
      SVG_FLAG + '</span><span>깃발</span>';
    ui.flagBtn.title = '깃발 모드 (마우스는 오른쪽 클릭으로도 됩니다)';
    ui.flagBtn.addEventListener('click', function () {
      state.flagMode = !state.flagMode;
      ui.flagBtn.classList.toggle('on', state.flagMode);
    });
    top.appendChild(ui.flagBtn);

    ui.newBtn = el('button', 'bm-btn', '새 게임');
    ui.newBtn.type = 'button';
    ui.newBtn.addEventListener('click', function () { newGame(); });
    top.appendChild(ui.newBtn);

    var hud = el('div', 'bm-hud');
    ui.mines = el('div', 'bm-count', '010');
    ui.face = el('button', 'bm-face', '🙂');
    ui.face.type = 'button';
    ui.face.addEventListener('click', function () { newGame(); });
    ui.clock = el('div', 'bm-count', '000');
    hud.appendChild(ui.mines);
    hud.appendChild(ui.face);
    hud.appendChild(ui.clock);

    ui.boardWrap = el('div', 'bm-boardwrap');
    ui.board = el('div', 'bm-board');
    ui.boardWrap.appendChild(ui.board);

    ui.msg = el('div', 'bm-msg');

    // 조작법은 마우스냐 손가락이냐에 따라 아예 다르다 — 해당하는 쪽만 보여준다
    ui.help = el('div', 'bm-help',
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ? '왼쪽 클릭으로 열고, 오른쪽 클릭으로 깃발을 꽂습니다. 숫자를 누르면 주변이 한 번에 열립니다.'
        : '톡 치면 열리고, 꾹 누르면 깃발이 꽂힙니다. 숫자를 누르면 주변이 한 번에 열립니다.');

    /* 순위표 */
    var rank = el('div', 'bm-rank');
    var rh = el('div', 'bm-rankhead');
    rh.appendChild(el('span', 'bm-ranktitle', '순위표'));
    ui.rtabs = el('div', 'bm-rtabs');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button';
      b.dataset.level = k;
      b.addEventListener('click', function () { state.rankLevel = k; renderRankTabs(); loadRank(); });
      ui.rtabs.appendChild(b);
    });
    rh.appendChild(ui.rtabs);
    ui.mybest = el('div', 'bm-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bm-note', '');
    rank.appendChild(ui.note);

    root.appendChild(top);
    root.appendChild(hud);
    root.appendChild(ui.boardWrap);
    root.appendChild(ui.help);
    root.appendChild(ui.msg);
    root.appendChild(rank);
  })();

  /* ================================================================ 상태 */

  var state = {
    level: lsGet('bmine-level', 'beg'),
    rankLevel: 'beg',
    flagMode: false,
    sid: null,
    seed: null,
    started: false,      // 첫 클릭 여부
    over: false,
    t0: 0,
    finalMs: 0,
    clicks: 0,
    replay: [],
    grid: null,          // {mine, open, flag, n}
    cells: [],           // DOM
    timer: null,
    submitted: false
  };
  if (!LEVELS[state.level]) state.level = 'beg';
  state.rankLevel = state.level;

  /* ================================================================ 보드 */

  function spec() { return LEVELS[state.level]; }

  function idx(x, y) { return y * spec().w + x; }

  function neighbors(i) {
    var s = spec(), x = i % s.w, y = (i / s.w) | 0, out = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h) out.push(ny * s.w + nx);
      }
    }
    return out;
  }

  function cellSize() {
    var s = spec();
    // 카드 안쪽에서 쓸 수 있는 가로폭을 재서 칸 크기를 정한다.
    var avail = (ui.boardWrap.clientWidth || root.clientWidth || 600) - 20;
    var isPhone = window.matchMedia('(max-width:820px)').matches;
    var max = isPhone ? 34 : 30;
    var min = isPhone ? 27 : 20;   // 손가락으로 누를 수 있는 최소치 — 못 맞추면 가로 스크롤
    var fit = Math.floor((avail - (s.w - 1)) / s.w);
    return Math.max(min, Math.min(max, fit));
  }

  function buildBoard() {
    var s = spec(), n = s.w * s.h, sz = cellSize();
    state.grid = {
      mine: new Uint8Array(n), open: new Uint8Array(n),
      flag: new Uint8Array(n), n: new Uint8Array(n)
    };
    state.cells = new Array(n);
    ui.board.style.gridTemplateColumns = 'repeat(' + s.w + ',' + sz + 'px)';
    ui.board.textContent = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var c = el('button', 'bm-c');
      c.type = 'button';
      c.style.width = sz + 'px';
      c.style.height = sz + 'px';
      c.style.fontSize = Math.round(sz * 0.62) + 'px';
      c.dataset.i = i;
      state.cells[i] = c;
      frag.appendChild(c);
    }
    ui.board.appendChild(frag);
  }

  // 첫 클릭 칸과 그 둘레엔 지뢰를 놓지 않는다(현대 표준 규칙)
  function placeMines(firstIdx) {
    var s = spec(), n = s.w * s.h, g = state.grid;
    var safe = {};
    safe[firstIdx] = 1;
    neighbors(firstIdx).forEach(function (j) { safe[j] = 1; });
    var pool = [];
    for (var i = 0; i < n; i++) if (!safe[i]) pool.push(i);
    var rand = rng((state.seed || 'local') + ':' + firstIdx);
    var want = Math.min(s.mines, pool.length);
    for (var k = 0; k < want; k++) {
      var p = k + Math.floor(rand() * (pool.length - k));
      var t = pool[k]; pool[k] = pool[p]; pool[p] = t;
      g.mine[pool[k]] = 1;
    }
    for (var m = 0; m < n; m++) {
      if (g.mine[m]) continue;
      var cnt = 0;
      neighbors(m).forEach(function (j) { if (g.mine[j]) cnt++; });
      g.n[m] = cnt;
    }
  }

  function paint(i) {
    var g = state.grid, c = state.cells[i];
    c.className = 'bm-c';
    if (g.open[i]) {
      c.classList.add('o');
      if (g.mine[i]) { c.innerHTML = SVG_MINE; }
      else if (g.n[i]) { c.textContent = String(g.n[i]); c.classList.add('n' + g.n[i]); }
      else { c.textContent = ''; }
    } else if (g.flag[i]) {
      c.innerHTML = SVG_FLAG;
    } else {
      c.textContent = '';
    }
  }

  function repaintAll() {
    for (var i = 0; i < state.cells.length; i++) paint(i);
  }

  function updateMineCount() {
    var g = state.grid, f = 0;
    for (var i = 0; i < g.flag.length; i++) if (g.flag[i] && !g.open[i]) f++;
    var left = spec().mines - f;
    ui.mines.textContent = (left < 0 ? '-' : '') +
      String(Math.min(Math.abs(left), 99)).padStart(left < 0 ? 2 : 3, '0');
  }

  /* ================================================================ 진행 */

  function newGame() {
    stopTimer();
    state.started = false;
    state.over = false;
    state.submitted = false;
    state.clicks = 0;
    state.replay = [];
    state.finalMs = 0;
    ui.face.textContent = '🙂';
    ui.clock.textContent = '000';
    ui.msg.className = 'bm-msg';
    ui.msg.textContent = '';
    buildBoard();
    updateMineCount();
    renderMyBest();
    requestSession();
  }

  function requestSession() {
    state.sid = null;
    state.seed = null;
    api('POST', '/api/start', { game: GAME, level: state.level })
      .then(function (j) {
        if (j && j.ok) { state.sid = j.sid; state.seed = j.seed; }
      })
      .catch(function () { /* 서버 없어도 게임은 돈다 */ });
  }

  function startTimer() {
    state.t0 = Date.now();
    state.timer = setInterval(function () {
      ui.clock.textContent = fmtClock(Date.now() - state.t0);
    }, 100);
  }
  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function open(i) {
    var g = state.grid;
    if (g.open[i] || g.flag[i]) return;
    // 넓게 퍼지는 빈칸은 반복문으로 — 재귀는 고급에서 스택이 깊어진다
    var stack = [i];
    while (stack.length) {
      var j = stack.pop();
      if (g.open[j] || g.flag[j]) continue;
      g.open[j] = 1;
      paint(j);
      if (g.mine[j]) { lose(j); return; }
      if (g.n[j] === 0) {
        neighbors(j).forEach(function (k) { if (!g.open[k] && !g.flag[k]) stack.push(k); });
      }
    }
    checkWin();
  }

  function chord(i) {
    var g = state.grid;
    if (!g.open[i] || !g.n[i]) return;
    var nb = neighbors(i), f = 0;
    nb.forEach(function (j) { if (g.flag[j]) f++; });
    if (f !== g.n[i]) return;
    for (var k = 0; k < nb.length; k++) {
      if (!g.flag[nb[k]] && !g.open[nb[k]]) {
        open(nb[k]);
        if (state.over) return;
      }
    }
  }

  function toggleFlag(i) {
    var g = state.grid;
    if (g.open[i]) return;
    g.flag[i] = g.flag[i] ? 0 : 1;
    paint(i);
    updateMineCount();
  }

  function lose(boomIdx) {
    state.over = true;
    stopTimer();
    var g = state.grid;
    for (var i = 0; i < g.mine.length; i++) {
      if (g.mine[i] && !g.flag[i]) { g.open[i] = 1; paint(i); }
      if (!g.mine[i] && g.flag[i]) {
        g.open[i] = 1; paint(i);
        state.cells[i].innerHTML = SVG_FLAG;
        state.cells[i].classList.add('wrong');
      }
    }
    if (boomIdx != null) state.cells[boomIdx].classList.add('boom');
    ui.face.textContent = '😵';
    showMsg('lose', '지뢰를 밟았습니다. 다시 해볼까요?');
  }

  function checkWin() {
    var g = state.grid, s = spec(), need = s.w * s.h - s.mines, o = 0;
    for (var i = 0; i < g.open.length; i++) if (g.open[i] && !g.mine[i]) o++;
    if (o < need) return;
    state.over = true;
    stopTimer();
    state.finalMs = Date.now() - state.t0;
    ui.clock.textContent = fmtClock(state.finalMs);
    ui.face.textContent = '😎';
    // 남은 칸은 전부 지뢰이므로 깃발로 채워 마무리
    for (var j = 0; j < g.mine.length; j++) {
      if (g.mine[j] && !g.flag[j]) { g.flag[j] = 1; paint(j); }
    }
    updateMineCount();
    var isBest = saveBest(state.level, state.finalMs);
    renderMyBest();
    showWin(isBest);
  }

  /* ================================================================ 결과 배너 */

  function showMsg(kind, text) {
    ui.msg.className = 'bm-msg ' + kind;
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bm-msgt', text));
  }

  function showWin(isBest) {
    ui.msg.className = 'bm-msg win';
    ui.msg.textContent = '';
    var t = el('span', 'bm-msgt',
      spec().name + ' ' + fmtMs(state.finalMs) + (isBest ? ' — 내 최고기록입니다!' : ''));
    ui.msg.appendChild(t);

    if (!state.sid) {
      ui.msg.appendChild(el('span', 'bm-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      return;
    }
    var input = el('input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = '이름';
    input.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bm-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input.value || '').trim();
      if (!nick) { input.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true;
      btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs,
        clicks: state.clicks, replay: state.replay.slice(0, 2000)
      }).then(function (j) {
        if (j && j.ok) {
          showMsg('win', spec().name + ' ' + fmtMs(state.finalMs) + ' — ' + j.rank + '등으로 올렸습니다!');
          state.rankLevel = state.level;
          renderRankTabs();
          loadRank();
        } else {
          showMsg('win', spec().name + ' ' + fmtMs(state.finalMs) + ' — ' + rejectText(j && j.error));
        }
      }).catch(function () {
        showMsg('win', spec().name + ' ' + fmtMs(state.finalMs) +
          ' — 순위 서버에 연결하지 못했습니다. 기록은 저장됐습니다.');
      });
    }
    btn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    ui.msg.appendChild(input);
    ui.msg.appendChild(btn);
  }

  function rejectText(code) {
    var m = {
      faster_than_real_time: '기록이 실제 경과 시간과 맞지 않아 등록되지 않았습니다.',
      below_world_record: '세계기록보다 빨라서 등록되지 않았습니다.',
      session_used: '이미 올린 기록입니다.',
      session_expired: '게임을 시작한 지 너무 오래되어 등록되지 않았습니다.',
      no_session: '순위 등록 정보가 없어 올리지 못했습니다.',
      too_many: '잠시 후에 다시 시도해 주세요.',
      bad_nick: '이름을 확인해 주세요.'
    };
    return m[code] || '순위에 올리지 못했습니다.';
  }

  /* ================================================================ 입력 */

  var press = { i: -1, timer: null, moved: false, x: 0, y: 0, flagged: false };

  function cellIndexFrom(e) {
    var t = e.target;
    while (t && t !== ui.board) {
      if (t.classList && t.classList.contains('bm-c')) return +t.dataset.i;
      t = t.parentNode;
    }
    return -1;
  }

  function firstClick(i) {
    placeMines(i);
    state.started = true;
    startTimer();
    ui.face.textContent = '🙂';
  }

  function act(i, wantFlag) {
    if (state.over || i < 0) return;
    var g = state.grid;
    state.clicks++;
    if (state.replay.length < 2000) {
      state.replay.push([Math.round(state.started ? Date.now() - state.t0 : 0), i, wantFlag ? 1 : 0]);
    }
    if (wantFlag) {
      // 깃발 모드로 열린 숫자를 누르면 코드(주변 한번에 열기)로 처리한다 —
      // 폰에서 깃발 모드를 껐다 켰다 하지 않아도 되게.
      if (g.open[i]) { if (state.started) chord(i); return; }
      toggleFlag(i);
      return;
    }
    if (g.flag[i]) return;
    if (!state.started) firstClick(i);
    if (g.open[i]) chord(i);
    else open(i);
  }

  ui.board.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var i = cellIndexFrom(e);
    if (i >= 0) act(i, true);
  });

  ui.board.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;  // 우클릭은 contextmenu 가 처리
    var i = cellIndexFrom(e);
    if (i < 0) return;
    press.i = i; press.moved = false; press.flagged = false;
    press.x = e.clientX; press.y = e.clientY;
    if (e.pointerType !== 'mouse') {
      // 폰: 꾹 누르면 깃발 (깃발 버튼을 안 켜도 되도록)
      press.timer = setTimeout(function () {
        press.timer = null;
        if (press.moved || press.i !== i) return;
        press.flagged = true;
        act(i, true);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      }, 450);
    }
  });

  ui.board.addEventListener('pointermove', function (e) {
    if (press.i < 0) return;
    if (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8) {
      press.moved = true;      // 가로 스크롤 중이면 클릭으로 치지 않는다
      clearPress();
    }
  });

  function clearPress() {
    if (press.timer) { clearTimeout(press.timer); press.timer = null; }
  }

  ui.board.addEventListener('pointerup', function (e) {
    var i = cellIndexFrom(e);
    clearPress();
    if (press.i < 0 || press.moved || i !== press.i) { press.i = -1; return; }
    if (!press.flagged) act(i, state.flagMode);
    press.i = -1;
  });

  ui.board.addEventListener('pointercancel', function () { clearPress(); press.i = -1; });

  /* ================================================================ 순위 */

  function api(method, path, body) {
    var opt = { method: method, mode: 'cors', cache: 'no-store' };
    if (body) {
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(body);
    }
    return fetch(API + path, opt).then(function (r) {
      return r.json().catch(function () { return null; });
    });
  }

  function renderRankTabs() {
    [].forEach.call(ui.rtabs.children, function (b) {
      b.classList.toggle('on', b.dataset.level === state.rankLevel);
    });
  }

  function renderMyBest() {
    var b = bests()[state.level];
    ui.mybest.innerHTML = b == null
      ? '내 기록 없음'
      : '내 최고 <b>' + fmtMs(b) + '</b>';
  }

  function loadRank() {
    var lv = state.rankLevel;
    ui.note.textContent = '';
    api('GET', '/api/top?game=' + GAME + '&level=' + lv + '&limit=20')
      .then(function (j) {
        if (state.rankLevel !== lv) return;      // 늦게 온 응답 무시
        if (!j || !j.ok) throw new Error('bad');
        drawRank(j);
      })
      .catch(function () {
        if (state.rankLevel !== lv) return;
        ui.rankBody.textContent = '';
        ui.note.textContent = '순위 서버에 연결하지 못했습니다. 게임과 내 기록은 그대로 쓸 수 있습니다.';
      });
  }

  function drawRank(j) {
    var me = lsGet(LS_NICK, '');
    ui.rankBody.textContent = '';
    if (!j.rows.length) {
      ui.note.textContent = LEVELS[j.level].name + ' 기록이 아직 없습니다. 첫 기록의 주인공이 되어 보세요.';
      return;
    }
    var t = el('table', 'bm-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '기록'].forEach(function (h, k) {
      var th = el('th', k === 2 ? 'bm-t' : (k === 0 ? 'bm-r' : 'bm-n'), h);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bm-r', String(r.rank)));
      row.appendChild(el('td', 'bm-n', r.nick));   // textContent 라 태그가 들어가도 안전
      row.appendChild(el('td', 'bm-t', fmtMs(r.ms)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length + '명 · 사람마다 최고기록 한 줄';
  }

  /* ================================================================ 난이도 */

  function setLevel(k) {
    if (!LEVELS[k]) return;
    if (k === state.level) {
      // 같은 난이도를 다시 누르면 새 판으로 — 다만 진행 중인 판은 실수로 날리지 않는다
      if (state.over || !state.started) newGame();
      return;
    }
    state.level = k;
    lsSet('bmine-level', k);
    [].forEach.call(ui.levels.children, function (b) {
      b.classList.toggle('on', b.dataset.level === k);
    });
    state.rankLevel = k;
    renderRankTabs();
    newGame();
    loadRank();
  }

  /* ================================================================ 시작 */

  [].forEach.call(ui.levels.children, function (b) {
    b.classList.toggle('on', b.dataset.level === state.level);
  });
  renderRankTabs();
  newGame();
  loadRank();

  // 화면 폭이 바뀌면 칸 크기를 다시 잡는다 (진행 중이면 건드리지 않는다)
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      if (state.started && !state.over) return;
      var sz = cellSize();
      if (state.cells.length && parseInt(state.cells[0].style.width, 10) === sz) return;
      buildBoard();
      updateMineCount();
    }, 200);
  });

  root.dataset.version = VERSION;
})();
