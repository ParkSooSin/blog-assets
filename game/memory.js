/*!
 * 카곰의 얼룩덜룩 — 카드 짝 맞추기 (클라이언트 전용 + 순위 서버)
 * - 카드 그림은 블로그 사진을 쓴다(사진 퍼즐과 같은 재료, 서버가 준다).
 * - 다 맞추면 어느 글의 사진이었는지 알려준다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #bmem-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var GAME = 'memory';
  var LS_NICK = 'bmine-nick';
  var LS_BEST = 'bmem-best';
  var LS_LEVEL = 'bmem-level';
  var HIDE_MS = 750;      // 짝이 아닐 때 다시 덮기까지

  // 서버 GAMES.memory.levels 와 반드시 같아야 한다
  var LEVELS = {
    m4:  { key: 'm4',  name: '4쌍',  pairs: 4,  cols: 4, colsPhone: 4 },
    m6:  { key: 'm6',  name: '6쌍',  pairs: 6,  cols: 4, colsPhone: 4 },
    m8:  { key: 'm8',  name: '8쌍',  pairs: 8,  cols: 4, colsPhone: 4 },
    m12: { key: 'm12', name: '12쌍', pairs: 12, cols: 6, colsPhone: 4 }
  };
  var ORDER = ['m4', 'm6', 'm8', 'm12'];

  var root = document.getElementById('bmem-app');
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
    var t = Math.round(ms / 1000);
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function bests() {
    try { return JSON.parse(lsGet(LS_BEST, '{}')) || {}; } catch (e) { return {}; }
  }
  function saveBest(level, ms) {
    var b = bests();
    if (b[level] == null || ms < b[level]) { b[level] = ms; lsSet(LS_BEST, JSON.stringify(b)); return true; }
    return false;
  }

  /* ================================================================ 스타일 */

  var INK = '#5f8a6a';   // 카드 맞추기 잉크 (다른 게임과 계열 분리)
  var CSS = [
    '#bmem-app{--bm2-ink:' + INK + ';--bm2-line:#dcdcd4;--bm2-line2:#e9e9e2;--bm2-text:#2b2b28;',
    '  --bm2-dim:#8a8a80;--bm2-bg:#ffffff;--bm2-bar:#f6f6f2;--bm2-back:#e3e6df;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bm2-text);border:1px solid var(--bm2-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bm2-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#bmem-app *{box-sizing:border-box;}',
    '#bmem-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bm2-text);}',

    '#bmem-app .bm2-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bm2-bar);border-bottom:1px solid var(--bm2-line);}',
    '#bmem-app .bm2-brand{font-weight:700;font-size:14px;color:var(--bm2-ink);white-space:nowrap;}',
    '#bmem-app .bm2-levels{display:flex;border:1px solid var(--bm2-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bmem-app .bm2-levels button{border:0;background:#fff;height:30px;padding:0 11px;font-size:13px;',
    '  border-right:1px solid var(--bm2-line2);white-space:nowrap;}',
    '#bmem-app .bm2-levels button:last-child{border-right:0;}',
    '#bmem-app .bm2-levels button.on{background:var(--bm2-ink);color:#fff;font-weight:600;}',
    '#bmem-app .bm2-levels button:not(.on):hover{background:#efefea;}',
    '#bmem-app .bm2-spacer{flex:1 1 auto;}',
    '#bmem-app .bm2-btn{border:1px solid var(--bm2-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#bmem-app .bm2-btn:hover{background:#f4f4ef;}',

    '#bmem-app .bm2-hud{display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 10px 6px;}',
    '#bmem-app .bm2-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:17px;font-weight:600;color:var(--bm2-ink);background:var(--bm2-bar);',
    '  border:1px solid var(--bm2-line);border-radius:4px;padding:3px 12px;min-width:76px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#bmem-app .bm2-hudlabel{font-size:12px;color:var(--bm2-dim);text-align:center;}',

    /* 카드판 */
    '#bmem-app .bm2-boardwrap{display:flex;justify-content:center;padding:4px 10px 10px;}',
    '#bmem-app .bm2-board{display:grid;gap:8px;}',
    '#bmem-app .bm2-c{border:0;padding:0;background:transparent;border-radius:6px;',
    '  perspective:600px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
    '#bmem-app .bm2-in{position:relative;width:100%;height:100%;transition:transform .32s;',
    '  transform-style:preserve-3d;}',
    '#bmem-app .bm2-c.up .bm2-in{transform:rotateY(180deg);}',
    '#bmem-app .bm2-face{position:absolute;inset:0;backface-visibility:hidden;',
    '  -webkit-backface-visibility:hidden;border-radius:6px;overflow:hidden;}',
    '#bmem-app .bm2-back{background:var(--bm2-back);border:1px solid #cfd4c9;',
    '  display:flex;align-items:center;justify-content:center;}',
    '#bmem-app .bm2-back svg{width:46%;height:46%;opacity:.5;}',
    '#bmem-app .bm2-front{transform:rotateY(180deg);background-size:cover;background-position:center;',
    '  border:1px solid var(--bm2-line);}',
    '#bmem-app .bm2-c.done{cursor:default;}',
    '#bmem-app .bm2-c.done .bm2-front{box-shadow:inset 0 0 0 3px var(--bm2-ink);}',
    '#bmem-app .bm2-loading{padding:40px 10px;text-align:center;color:var(--bm2-dim);font-size:13px;}',

    '#bmem-app .bm2-help{font-size:12px;color:var(--bm2-dim);text-align:center;padding:0 10px 10px;}',
    '#bmem-app .bm2-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#bmem-app .bm2-msg.win{display:flex;background:#eaf1ec;border:1px solid #c9dcd0;color:#3f5a48;}',
    '#bmem-app .bm2-msg .bm2-msgt{flex:1 1 auto;min-width:150px;}',
    '#bmem-app .bm2-msg input{border:1px solid var(--bm2-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:120px;color:inherit;}',
    '#bmem-app .bm2-msg input:focus{outline:none;border-color:var(--bm2-ink);}',
    '#bmem-app .bm2-msg .bm2-btn{height:30px;}',
    '#bmem-app .bm2-from{margin:0 10px 12px;font-size:12px;color:var(--bm2-dim);text-align:center;line-height:1.9;}',
    '#bmem-app .bm2-from a{color:var(--bm2-ink);font-weight:700;text-decoration:none;}',
    '#bmem-app .bm2-from a:hover{text-decoration:underline;}',

    '#bmem-app .bm2-rank{border-top:1px solid var(--bm2-line);background:#fbfbf9;padding:10px;}',
    '#bmem-app .bm2-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#bmem-app .bm2-ranktitle{font-weight:700;font-size:13px;color:var(--bm2-ink);}',
    '#bmem-app .bm2-rtabs{display:flex;border:1px solid var(--bm2-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bmem-app .bm2-rtabs button{border:0;background:#fff;height:26px;padding:0 9px;font-size:12px;',
    '  border-right:1px solid var(--bm2-line2);white-space:nowrap;}',
    '#bmem-app .bm2-rtabs button:last-child{border-right:0;}',
    '#bmem-app .bm2-rtabs button.on{background:var(--bm2-ink);color:#fff;font-weight:600;}',
    '#bmem-app table.bm2-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bm2-line);margin:0;}',
    '#bmem-app table.bm2-table th,#bmem-app table.bm2-table td{border:0;',
    '  border-bottom:1px solid var(--bm2-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#bmem-app table.bm2-table th{background:var(--bm2-bar);font-size:12px;color:var(--bm2-dim);font-weight:600;}',
    '#bmem-app table.bm2-table tr:last-child td{border-bottom:0;}',
    '#bmem-app table.bm2-table td.bm2-r{width:44px;color:var(--bm2-dim);font-variant-numeric:tabular-nums;}',
    '#bmem-app table.bm2-table td.bm2-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}',
    '#bmem-app table.bm2-table td.bm2-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:1px;}',
    '#bmem-app table.bm2-table tr.me td{background:#eaf1ec;}',
    '#bmem-app table.bm2-table tr.me td.bm2-n{font-weight:700;color:var(--bm2-ink);}',
    '#bmem-app .bm2-note{font-size:12px;color:var(--bm2-dim);padding:8px 2px 0;}',
    '#bmem-app .bm2-mybest{font-size:12px;color:var(--bm2-dim);margin-left:auto;white-space:nowrap;}',
    '#bmem-app .bm2-mybest b{color:var(--bm2-text);font-weight:700;}',

    /* 좁은 화면 짧은 라벨 — ⚠️ 미디어쿼리 앞에 둬야 한다 */
    '#bmem-app .bm2-short{display:none;}',

    '@media (max-width:820px){',
    '#bmem-app .bm2-brand{display:none;}',
    '#bmem-app .bm2-spacer{display:none;}',
    '#bmem-app .bm2-long{display:none;}',
    '#bmem-app .bm2-short{display:inline;}',
    '#bmem-app .bm2-top{gap:6px;padding:7px 8px;}',
    '#bmem-app .bm2-levels button{padding:0 9px;font-size:12px;}',
    '#bmem-app .bm2-boardwrap{padding:4px 6px 8px;}',
    '#bmem-app .bm2-board{gap:6px;}',
    '#bmem-app .bm2-rank{padding:8px;}',
    '}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // 카드 뒷면 무늬 — 카곰 발자국 느낌의 단순한 도형
  var SVG_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="14.5" r="5.2" fill="#8a9a83"/>' +
    '<circle cx="6.4" cy="7.6" r="2.5" fill="#8a9a83"/>' +
    '<circle cx="11" cy="5.4" r="2.5" fill="#8a9a83"/>' +
    '<circle cx="16.2" cy="6.4" r="2.4" fill="#8a9a83"/>' +
    '<circle cx="20" cy="10.4" r="2.1" fill="#8a9a83"/></svg>';

  /* ================================================================ 상태 */

  var state = {
    level: lsGet(LS_LEVEL, 'm4'),
    rankLevel: 'm4',
    photos: [],
    cards: [],        // {photo, id}
    used: [],         // 이 판에 쓴 사진
    open: [],         // 지금 뒤집혀 있는 카드 인덱스
    matched: 0,
    flips: 0,
    lock: false,
    started: false, over: false,
    t0: 0, finalMs: 0, timer: null,
    sid: null, seed: null,
    loading: false, submitted: false
  };
  if (!LEVELS[state.level]) state.level = 'm4';
  state.rankLevel = state.level;

  var ui = {};

  /* ================================================================ 마크업 */

  (function build() {
    var top = el('div', 'bm2-top');
    ui.brand = el('span', 'bm2-brand', '짝 맞추기');
    top.appendChild(ui.brand);

    ui.levels = el('div', 'bm2-levels');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () { setLevel(k); });
      ui.levels.appendChild(b);
    });
    top.appendChild(ui.levels);
    top.appendChild(el('div', 'bm2-spacer'));

    ui.newBtn = el('button', 'bm2-btn');
    ui.newBtn.type = 'button';
    ui.newBtn.title = '새 카드로';
    ui.newBtn.appendChild(el('span', 'bm2-long', '새 카드'));
    ui.newBtn.appendChild(el('span', 'bm2-short', '새로'));
    ui.newBtn.addEventListener('click', function () { newGame(); });
    top.appendChild(ui.newBtn);

    var hud = el('div', 'bm2-hud');
    function cell(node, label) {
      var w = el('div'); w.style.textAlign = 'center';
      w.appendChild(node); w.appendChild(el('div', 'bm2-hudlabel', label));
      return w;
    }
    ui.pairs = el('div', 'bm2-count', '0 / 4');
    ui.flips = el('div', 'bm2-count', '0');
    ui.clock = el('div', 'bm2-count', '0:00');
    hud.appendChild(cell(ui.pairs, '맞춘 짝'));
    hud.appendChild(cell(ui.flips, '뒤집기'));
    hud.appendChild(cell(ui.clock, '시간'));

    ui.boardWrap = el('div', 'bm2-boardwrap');
    ui.loading = el('div', 'bm2-loading', '카드를 준비하는 중…');

    ui.help = el('div', 'bm2-help', '카드 두 장을 뒤집어 같은 사진을 찾으세요. 블로그 글에 실린 사진들입니다.');
    ui.msg = el('div', 'bm2-msg');
    ui.from = el('div', 'bm2-from');

    var rank = el('div', 'bm2-rank');
    var rh = el('div', 'bm2-rankhead');
    rh.appendChild(el('span', 'bm2-ranktitle', '순위표'));
    ui.rtabs = el('div', 'bm2-rtabs');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () {
        state.rankLevel = k; renderRankTabs(); loadRank();
      });
      ui.rtabs.appendChild(b);
    });
    rh.appendChild(ui.rtabs);
    ui.mybest = el('div', 'bm2-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bm2-note', '');
    rank.appendChild(ui.note);

    root.appendChild(top);
    root.appendChild(hud);
    root.appendChild(ui.loading);
    root.appendChild(ui.boardWrap);
    root.appendChild(ui.help);
    root.appendChild(ui.msg);
    root.appendChild(ui.from);
    root.appendChild(rank);
  })();

  /* ================================================================ 판 */

  function cols() {
    var L = LEVELS[state.level];
    return window.matchMedia('(max-width:820px)').matches ? L.colsPhone : L.cols;
  }

  function cardPx() {
    var avail = (ui.boardWrap.clientWidth || root.clientWidth || 520) - 20;
    var c = cols(), gap = window.matchMedia('(max-width:820px)').matches ? 6 : 8;
    var w = Math.floor((avail - gap * (c - 1)) / c);
    return Math.max(52, Math.min(110, w));
  }

  function buildBoard() {
    var c = cols(), size = cardPx();
    ui.board = el('div', 'bm2-board');
    ui.board.style.gridTemplateColumns = 'repeat(' + c + ',' + size + 'px)';

    ui.cards = [];
    var frag = document.createDocumentFragment();
    state.cards.forEach(function (card, i) {
      var b = el('button', 'bm2-c');
      b.type = 'button';
      b.dataset.i = i;
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      var inner = el('div', 'bm2-in');
      var back = el('div', 'bm2-face bm2-back');
      back.innerHTML = SVG_BACK;
      var front = el('div', 'bm2-face bm2-front');
      front.style.backgroundImage = 'url("' + card.photo.u + '")';
      inner.appendChild(back);
      inner.appendChild(front);
      b.appendChild(inner);
      ui.cards.push(b);
      frag.appendChild(b);
    });
    ui.board.appendChild(frag);
    ui.boardWrap.textContent = '';
    ui.boardWrap.appendChild(ui.board);
  }

  function updateHud() {
    ui.pairs.textContent = state.matched + ' / ' + LEVELS[state.level].pairs;
    ui.flips.textContent = String(state.flips);
  }

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

  /* ================================================================ 진행 */

  function newGame() {
    if (state.loading) return;
    stopTimer();
    state.started = false; state.over = false; state.submitted = false;
    state.matched = 0; state.flips = 0; state.open = []; state.lock = false;
    state.finalMs = 0;
    ui.clock.textContent = '0:00';
    ui.msg.className = 'bm2-msg'; ui.msg.textContent = '';
    ui.from.textContent = '';
    renderMyBest();

    if (!state.photos.length) {
      ui.loading.style.display = '';
      ui.loading.textContent = '사진을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      ui.boardWrap.textContent = '';
      return;
    }

    state.loading = true;
    ui.loading.style.display = '';
    ui.loading.textContent = '카드를 준비하는 중…';
    ui.boardWrap.textContent = '';

    requestSession().then(function () {
      var L = LEVELS[state.level];
      var rand = rng((state.seed || 'local' + Math.random()) + ':' + state.level);
      // 서로 다른 사진을 pairs 장 고른다
      var pool = state.photos.slice();
      for (var k = pool.length - 1; k > 0; k--) {
        var j = Math.floor(rand() * (k + 1));
        var t = pool[k]; pool[k] = pool[j]; pool[j] = t;
      }
      state.used = pool.slice(0, L.pairs);

      // 사진이 다 뜬 뒤에 시작해야 첫 뒤집기에서 빈 카드가 안 보인다
      Promise.all(state.used.map(function (p) {
        return new Promise(function (resolve) {
          var im = new Image();
          im.onload = im.onerror = function () { resolve(); };
          im.src = p.u;
        });
      })).then(function () {
        var cards = [];
        state.used.forEach(function (p, i) {
          cards.push({ photo: p, id: i });
          cards.push({ photo: p, id: i });
        });
        for (var k2 = cards.length - 1; k2 > 0; k2--) {
          var j2 = Math.floor(rand() * (k2 + 1));
          var t2 = cards[k2]; cards[k2] = cards[j2]; cards[j2] = t2;
        }
        state.cards = cards;
        state.loading = false;
        ui.loading.style.display = 'none';
        buildBoard();
        updateHud();
      });
    });
  }

  function requestSession() {
    state.sid = null; state.seed = null;
    return api('POST', '/api/start', { game: GAME, level: state.level })
      .then(function (j) { if (j && j.ok) { state.sid = j.sid; state.seed = j.seed; } })
      .catch(function () {});
  }

  function startTimer() {
    state.t0 = Date.now();
    state.timer = setInterval(function () {
      ui.clock.textContent = fmtMs(Date.now() - state.t0);
    }, 500);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  function flip(i) {
    if (state.over || state.lock || state.loading) return;
    var card = ui.cards[i];
    if (!card || card.classList.contains('done') || card.classList.contains('up')) return;
    if (!state.started) { state.started = true; startTimer(); }

    card.classList.add('up');
    state.open.push(i);
    state.flips++;
    updateHud();

    if (state.open.length < 2) return;

    var a = state.open[0], b = state.open[1];
    if (state.cards[a].id === state.cards[b].id) {
      ui.cards[a].classList.add('done');
      ui.cards[b].classList.add('done');
      state.open = [];
      state.matched++;
      updateHud();
      if (state.matched >= LEVELS[state.level].pairs) finish();
    } else {
      // 틀렸으면 잠깐 보여 주고 다시 덮는다
      state.lock = true;
      setTimeout(function () {
        ui.cards[a].classList.remove('up');
        ui.cards[b].classList.remove('up');
        state.open = [];
        state.lock = false;
      }, HIDE_MS);
    }
  }

  function finish() {
    state.over = true;
    stopTimer();
    state.finalMs = Date.now() - state.t0;
    ui.clock.textContent = fmtMs(state.finalMs);
    var isBest = saveBest(state.level, state.finalMs);
    renderMyBest();
    showFrom();
    showWin(isBest);
  }

  function showFrom() {
    ui.from.textContent = '';
    var seen = {}, links = [];
    state.used.forEach(function (p) {
      if (p.t && !seen[p.t]) { seen[p.t] = 1; links.push(p); }
    });
    if (!links.length) return;
    ui.from.appendChild(document.createTextNode('카드 사진은 '));
    links.slice(0, 6).forEach(function (p, i, arr) {
      var a = el('a', '', '「' + p.t + '」');
      a.href = p.l; a.target = '_top'; a.rel = 'noopener';
      ui.from.appendChild(a);
      if (i < arr.length - 1) ui.from.appendChild(document.createTextNode(', '));
    });
    ui.from.appendChild(document.createTextNode(
      links.length > 6 ? ' 등에서 나왔습니다.' : ' 에서 나왔습니다.'));
  }

  /* ================================================================ 결과 */

  function showMsg(text) {
    ui.msg.className = 'bm2-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bm2-msgt', text));
  }

  function head() {
    return LEVELS[state.level].name + ' ' + fmtMs(state.finalMs) + ' · ' + state.flips + '번 뒤집음';
  }

  function showWin(isBest) {
    ui.msg.className = 'bm2-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bm2-msgt', head() + (isBest ? ' — 내 최고기록!' : '')));

    if (!state.sid) {
      ui.msg.appendChild(el('span', 'bm2-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      return;
    }
    var input = el('input');
    input.type = 'text'; input.maxLength = 12; input.placeholder = '이름';
    input.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bm2-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input.value || '').trim();
      if (!nick) { input.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true; btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs, clicks: state.flips
      }).then(function (j) {
        if (j && j.ok) {
          showMsg(head() + ' — ' + j.rank + '등으로 올렸습니다!');
          state.rankLevel = state.level; renderRankTabs(); loadRank();
        } else {
          showMsg(head() + ' — ' + rejectText(j && j.error));
        }
      }).catch(function () {
        showMsg(head() + ' — 순위 서버에 연결하지 못했습니다. 기록은 저장됐습니다.');
      });
    }
    btn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') send();
    });
    ui.msg.appendChild(input);
    ui.msg.appendChild(btn);
  }

  function rejectText(code) {
    var m = {
      faster_than_real_time: '기록이 실제 경과 시간과 맞지 않아 등록되지 않았습니다.',
      below_world_record: '너무 빨라서 등록되지 않았습니다.',
      session_used: '이미 올린 기록입니다.',
      session_expired: '카드를 받은 지 너무 오래되어 등록되지 않았습니다.',
      no_session: '순위 등록 정보가 없어 올리지 못했습니다.',
      too_many: '잠시 후에 다시 시도해 주세요.',
      too_slow: '너무 오래 걸려서 등록되지 않았습니다.',
      bad_nick: '이름을 확인해 주세요.'
    };
    return m[code] || '순위에 올리지 못했습니다.';
  }

  /* ================================================================ 입력 */

  ui.boardWrap.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== ui.boardWrap) {
      if (t.classList && t.classList.contains('bm2-c')) { flip(+t.dataset.i); return; }
      t = t.parentNode;
    }
  });

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
    ui.mybest.innerHTML = b == null ? '내 기록 없음' : '내 최고 <b>' + fmtMs(b) + '</b>';
  }

  function loadRank() {
    var lv = state.rankLevel;
    ui.note.textContent = '';
    api('GET', '/api/top?game=' + GAME + '&level=' + lv + '&limit=20')
      .then(function (j) {
        if (state.rankLevel !== lv) return;
        if (!j || !j.ok) throw new Error('bad');
        drawRank(j);
      })
      .catch(function () {
        if (state.rankLevel !== lv) return;
        ui.rankBody.textContent = '';
        ui.note.textContent = '순위 서버에 연결하지 못했습니다.';
      });
  }

  function drawRank(j) {
    var me = lsGet(LS_NICK, '');
    ui.rankBody.textContent = '';
    if (!j.rows.length) {
      ui.note.textContent = LEVELS[j.level].name + ' 기록이 아직 없습니다. 첫 기록의 주인공이 되어 보세요.';
      return;
    }
    var t = el('table', 'bm2-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '기록'].forEach(function (h, k) {
      tr.appendChild(el('th', k === 2 ? 'bm2-t' : (k === 0 ? 'bm2-r' : 'bm2-n'), h));
    });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bm2-r', String(r.rank)));
      row.appendChild(el('td', 'bm2-n', r.nick));
      row.appendChild(el('td', 'bm2-t', fmtMs(r.ms)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length +
      '명 · 사람마다 최고기록 한 줄';
  }

  /* ================================================================ 난이도 */

  function setLevel(k) {
    if (!LEVELS[k] || state.loading) return;
    if (k === state.level) {
      if (state.over || !state.started) newGame();
      return;
    }
    state.level = k;
    lsSet(LS_LEVEL, k);
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
  renderMyBest();
  loadRank();

  api('GET', '/api/photos')
    .then(function (j) {
      state.photos = (j && j.ok && j.photos) ? j.photos : [];
      newGame();
    })
    .catch(function () { state.photos = []; newGame(); });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      if (state.loading || !state.cards.length) return;
      if (state.started && !state.over) return;
      buildBoard();
      updateHud();
    }, 200);
  });

  root.dataset.version = VERSION;
})();
