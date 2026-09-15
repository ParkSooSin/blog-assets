/*!
 * 카곰의 얼룩덜룩 — 스도쿠 (클라이언트 전용 + 순위 서버)
 * - 퍼즐 생성·풀이 판정 전부 이 브라우저에서 한다. 홈랩은 순위만 받는다.
 * - 순위 서버가 죽어도 게임과 내 최고기록(localStorage)은 그대로 작동한다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #bsudoku-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var GAME = 'sudoku';
  var LS_NICK = 'bmine-nick';        // 지뢰찾기와 같은 이름을 쓴다(한 번만 적게)
  var LS_BEST = 'bsud-best';
  var LS_LEVEL = 'bsud-level';

  // 서버 GAMES.sudoku.levels 와 반드시 같아야 한다
  // clues = 남길 단서 수, easyLogic = 기본기(단칸 확정)만으로 끝까지 풀리는 판이어야 하는가.
  // ⚠️ 단서 수만으로 난이도를 나누면 단서가 적어도 술술 풀리는 판이 섞인다.
  //    실제로 풀어보고 등급이 맞는 판만 내보낸다.
  var LEVELS = {
    easy:   { key: 'easy',   name: '쉬움',      clues: 42, easyLogic: true },
    normal: { key: 'normal', name: '보통',      clues: 34, easyLogic: true },
    hard:   { key: 'hard',   name: '어려움',    clues: 28, easyLogic: false },
    expert: { key: 'expert', name: '전문가',    clues: 25, easyLogic: false }
  };
  var ORDER = ['easy', 'normal', 'hard', 'expert'];

  var root = document.getElementById('bsudoku-app');
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
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 시크릿 모드 등 */ }
  }
  function bests() {
    try { return JSON.parse(lsGet(LS_BEST, '{}')) || {}; } catch (e) { return {}; }
  }
  function saveBest(level, ms) {
    var b = bests();
    if (b[level] == null || ms < b[level]) {
      b[level] = ms; lsSet(LS_BEST, JSON.stringify(b)); return true;
    }
    return false;
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

  /* ================================================================ 퍼즐 생성 */

  // 같은 행·열·3x3 박스에 있는 칸 번호를 미리 계산해 둔다 (81칸 × 20개)
  var PEERS = (function () {
    var out = [];
    for (var i = 0; i < 81; i++) {
      var r = (i / 9) | 0, c = i % 9;
      var br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
      var set = {};
      for (var k = 0; k < 9; k++) {
        set[r * 9 + k] = 1;
        set[k * 9 + c] = 1;
        set[(br + ((k / 3) | 0)) * 9 + bc + (k % 3)] = 1;
      }
      delete set[i];
      out.push(Object.keys(set).map(Number));
    }
    return out;
  })();

  // 행 9 + 열 9 + 3x3 상자 9 = 27개 묶음
  var UNITS = (function () {
    var out = [];
    for (var r = 0; r < 9; r++) {
      var row = [], col = [];
      for (var k = 0; k < 9; k++) { row.push(r * 9 + k); col.push(k * 9 + r); }
      out.push(row); out.push(col);
    }
    for (var b = 0; b < 9; b++) {
      var box = [], br = ((b / 3) | 0) * 3, bc = (b % 3) * 3;
      for (var k2 = 0; k2 < 9; k2++) box.push((br + ((k2 / 3) | 0)) * 9 + bc + (k2 % 3));
      out.push(box);
    }
    return out;
  })();

  function okAt(g, i, v) {
    var p = PEERS[i];
    for (var k = 0; k < p.length; k++) if (g[p[k]] === v) return false;
    return true;
  }

  // 빈칸 중 후보가 가장 적은 곳부터 채운다 — 이게 없으면 어려운 판에서 느려진다
  function pickCell(g) {
    var best = -1, bestN = 10, bestCands = null;
    for (var i = 0; i < 81; i++) {
      if (g[i]) continue;
      var c = [];
      for (var v = 1; v <= 9; v++) if (okAt(g, i, v)) c.push(v);
      if (c.length < bestN) { bestN = c.length; best = i; bestCands = c; if (bestN <= 1) break; }
    }
    return best < 0 ? null : { i: best, cands: bestCands };
  }

  function fillFull(g, rand) {
    var pick = pickCell(g);
    if (!pick) return true;
    if (!pick.cands.length) return false;
    var c = pick.cands.slice();
    for (var n = c.length - 1; n > 0; n--) {
      var j = Math.floor(rand() * (n + 1));
      var t = c[n]; c[n] = c[j]; c[j] = t;
    }
    for (var k = 0; k < c.length; k++) {
      g[pick.i] = c[k];
      if (fillFull(g, rand)) return true;
      g[pick.i] = 0;
    }
    return false;
  }

  // 해가 몇 개인지 — 2개를 찾는 순간 멈춘다(유일해 확인에는 그걸로 충분)
  function countSolutions(g, limit) {
    var pick = pickCell(g);
    if (!pick) return 1;
    if (!pick.cands.length) return 0;
    var total = 0;
    for (var k = 0; k < pick.cands.length; k++) {
      g[pick.i] = pick.cands[k];
      total += countSolutions(g, limit);
      g[pick.i] = 0;
      if (total >= limit) return total;
    }
    return total;
  }

  // 사람이 제일 먼저 쓰는 두 가지 기본기만으로 끝까지 풀리는지 본다.
  //   ① 한 칸에 들어갈 수 있는 숫자가 하나뿐 ② 한 줄에서 그 숫자가 갈 곳이 한 칸뿐
  // 이것만으로 풀리면 "쉬움/보통", 막히면 더 깊은 추론이 필요한 "어려움 이상"이다.
  function solvableByBasics(puzzle) {
    var g = puzzle.slice();
    for (;;) {
      var moved = false;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var only = 0, cnt = 0;
        for (var v = 1; v <= 9; v++) if (okAt(g, i, v)) { only = v; cnt++; if (cnt > 1) break; }
        if (cnt === 0) return false;
        if (cnt === 1) { g[i] = only; moved = true; }
      }
      if (moved) continue;
      for (var u = 0; u < UNITS.length && !moved; u++) {
        var unit = UNITS[u];
        for (var val = 1; val <= 9 && !moved; val++) {
          var spot = -1, n = 0, has = false;
          for (var k = 0; k < 9; k++) {
            var c = unit[k];
            if (g[c] === val) { has = true; break; }
            if (!g[c] && okAt(g, c, val)) { spot = c; n++; }
          }
          if (has || n !== 1) continue;
          g[spot] = val; moved = true;
        }
      }
      if (!moved) break;
    }
    for (var m = 0; m < 81; m++) if (!g[m]) return false;
    return true;
  }

  function makePuzzle(level, seed) {
    // 등급이 맞는 판이 나올 때까지 시드를 바꿔가며 다시 만든다.
    // 시드에 회차를 붙이므로 같은 시드는 언제나 같은 결과다.
    // 실측: 단서 28개 판이 「기본기로는 안 풀리는」 판일 확률 28% → 30번이면 놓칠 확률 0.01% 미만.
    for (var attempt = 0; attempt < 30; attempt++) {
      var made = makeOne(level, seed + '#' + attempt);
      if (solvableByBasics(made.puzzle) === LEVELS[level].easyLogic) return made;
    }
    return makeOne(level, seed + '#last');   // 그래도 못 고르면 마지막 판이라도 준다(게임은 정상)
  }

  function makeOne(level, seed) {
    var rand = rng(seed + ':' + level);
    var full = new Uint8Array(81);
    fillFull(full, rand);

    var puzzle = full.slice();
    var order = [];
    for (var i = 0; i < 81; i++) order.push(i);
    for (var n = order.length - 1; n > 0; n--) {
      var j = Math.floor(rand() * (n + 1));
      var t = order[n]; order[n] = order[j]; order[j] = t;
    }

    var target = LEVELS[level].clues;
    var clues = 81;
    for (var k = 0; k < order.length && clues > target; k++) {
      var idx = order[k];
      if (!puzzle[idx]) continue;
      var keep = puzzle[idx];
      puzzle[idx] = 0;
      // 유일해가 깨지면 되돌린다 — 답이 여러 개인 스도쿠는 스도쿠가 아니다
      var work = puzzle.slice();
      if (countSolutions(work, 2) !== 1) puzzle[idx] = keep;
      else clues--;
    }
    return { puzzle: puzzle, solution: full, clues: clues };
  }

  /* ================================================================ 스타일 */

  var INK = '#4f7d74';   // 스도쿠 잉크 (지뢰찾기 슬레이트·UML 올리브와 계열 분리)
  var CSS = [
    '#bsudoku-app{--bs-ink:' + INK + ';--bs-line:#dcdcd4;--bs-line2:#e9e9e2;--bs-text:#2b2b28;',
    '  --bs-dim:#8a8a80;--bs-bg:#ffffff;--bs-bar:#f6f6f2;--bs-given:#2b2b28;',
    '  --bs-sel:#e4eeeb;--bs-peer:#f3f3ef;--bs-same:#d8e8e4;--bs-bad:#b4675c;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bs-text);border:1px solid var(--bs-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bs-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#bsudoku-app *{box-sizing:border-box;}',
    '#bsudoku-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bs-text);}',

    /* 상단바 */
    '#bsudoku-app .bs-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bs-bar);border-bottom:1px solid var(--bs-line);}',
    '#bsudoku-app .bs-brand{font-weight:700;font-size:14px;color:var(--bs-ink);letter-spacing:-.2px;',
    '  white-space:nowrap;}',
    '#bsudoku-app .bs-levels{display:flex;border:1px solid var(--bs-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bsudoku-app .bs-levels button{border:0;background:#fff;height:30px;padding:0 10px;font-size:13px;',
    '  border-right:1px solid var(--bs-line2);white-space:nowrap;}',
    '#bsudoku-app .bs-levels button:last-child{border-right:0;}',
    '#bsudoku-app .bs-levels button.on{background:var(--bs-ink);color:#fff;font-weight:600;}',
    '#bsudoku-app .bs-levels button:not(.on):hover{background:#efefea;}',
    '#bsudoku-app .bs-spacer{flex:1 1 auto;}',
    '#bsudoku-app .bs-btn{border:1px solid var(--bs-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#bsudoku-app .bs-btn:hover{background:#f4f4ef;}',
    '#bsudoku-app .bs-btn.on{border-color:var(--bs-ink);color:var(--bs-ink);font-weight:600;',
    '  background:#eaf2f0;}',
    '#bsudoku-app .bs-btn:disabled{opacity:.45;cursor:default;}',

    /* HUD */
    '#bsudoku-app .bs-hud{display:flex;align-items:center;justify-content:center;gap:14px;',
    '  padding:10px 10px 6px;}',
    '#bsudoku-app .bs-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:17px;font-weight:600;color:var(--bs-ink);background:var(--bs-bar);',
    '  border:1px solid var(--bs-line);border-radius:4px;padding:3px 12px;min-width:74px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#bsudoku-app .bs-hudlabel{font-size:12px;color:var(--bs-dim);}',

    /* 격자 */
    '#bsudoku-app .bs-boardwrap{display:flex;justify-content:center;padding:4px 10px 10px;}',
    '#bsudoku-app .bs-board{display:grid;grid-template-columns:repeat(9,var(--bs-cell));',
    '  border:2px solid #9a9a90;background:#fff;user-select:none;-webkit-user-select:none;',
    '  -webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
    '#bsudoku-app .bs-c{border:0;padding:0;background:#fff;border-radius:0;position:relative;',
    '  width:var(--bs-cell);height:var(--bs-cell);display:flex;align-items:center;',
    '  justify-content:center;font-weight:500;line-height:1;color:var(--bs-ink);',
    '  border-right:1px solid var(--bs-line2);border-bottom:1px solid var(--bs-line2);}',
    '#bsudoku-app .bs-c.cr{border-right:2px solid #9a9a90;}',
    '#bsudoku-app .bs-c.cb{border-bottom:2px solid #9a9a90;}',
    '#bsudoku-app .bs-c.given{color:var(--bs-given);font-weight:700;}',
    '#bsudoku-app .bs-c.peer{background:var(--bs-peer);}',
    '#bsudoku-app .bs-c.same{background:var(--bs-same);}',
    '#bsudoku-app .bs-c.sel{background:var(--bs-sel);box-shadow:inset 0 0 0 2px var(--bs-ink);}',
    '#bsudoku-app .bs-c.bad{color:var(--bs-bad);}',
    '#bsudoku-app .bs-c.done{background:#eef4f2;}',
    '#bsudoku-app .bs-notes{position:absolute;inset:1px;display:grid;',
    '  grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);',
    '  font-size:calc(var(--bs-cell) * .26);color:var(--bs-dim);font-weight:500;line-height:1;}',
    '#bsudoku-app .bs-notes span{display:flex;align-items:center;justify-content:center;}',

    /* 숫자 패드 */
    '#bsudoku-app .bs-pad{display:flex;justify-content:center;gap:4px;flex-wrap:wrap;',
    '  padding:0 10px 10px;}',
    '#bsudoku-app .bs-pad button{border:1px solid var(--bs-line);background:#fff;border-radius:4px;',
    '  width:var(--bs-pad);height:42px;font-size:19px;font-weight:600;color:var(--bs-ink);',
    '  display:flex;align-items:center;justify-content:center;padding:0;position:relative;}',
    '#bsudoku-app .bs-pad button:hover{background:#f4f4ef;}',
    '#bsudoku-app .bs-pad button.used{color:var(--bs-dim);background:#f8f8f5;}',
    '#bsudoku-app .bs-pad button .bs-left{position:absolute;right:3px;bottom:1px;font-size:9px;',
    '  font-weight:500;color:var(--bs-dim);}',
    '#bsudoku-app .bs-pad button.bs-erase{font-size:14px;color:var(--bs-text);}',
    '#bsudoku-app .bs-short{display:none;}',

    /* 안내·배너 */
    '#bsudoku-app .bs-help{font-size:12px;color:var(--bs-dim);text-align:center;padding:0 10px 10px;}',
    '#bsudoku-app .bs-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#bsudoku-app .bs-msg.win{display:flex;background:#eaf2f0;border:1px solid #cadbd6;color:#3a5b55;}',
    '#bsudoku-app .bs-msg .bs-msgt{flex:1 1 auto;min-width:160px;}',
    '#bsudoku-app .bs-msg input{border:1px solid var(--bs-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:130px;color:inherit;}',
    '#bsudoku-app .bs-msg input:focus{outline:none;border-color:var(--bs-ink);}',
    '#bsudoku-app .bs-msg .bs-btn{height:30px;}',
    '#bsudoku-app .bs-making{text-align:center;color:var(--bs-dim);font-size:13px;padding:30px 10px;}',

    /* 순위표 */
    '#bsudoku-app .bs-rank{border-top:1px solid var(--bs-line);background:#fbfbf9;padding:10px;}',
    '#bsudoku-app .bs-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#bsudoku-app .bs-ranktitle{font-weight:700;font-size:13px;color:var(--bs-ink);}',
    '#bsudoku-app .bs-rtabs{display:flex;border:1px solid var(--bs-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bsudoku-app .bs-rtabs button{border:0;background:#fff;height:26px;padding:0 9px;font-size:12px;',
    '  border-right:1px solid var(--bs-line2);white-space:nowrap;}',
    '#bsudoku-app .bs-rtabs button:last-child{border-right:0;}',
    '#bsudoku-app .bs-rtabs button.on{background:var(--bs-ink);color:#fff;font-weight:600;}',
    '#bsudoku-app table.bs-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bs-line);margin:0;}',
    '#bsudoku-app table.bs-table th,#bsudoku-app table.bs-table td{border:0;',
    '  border-bottom:1px solid var(--bs-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#bsudoku-app table.bs-table th{background:var(--bs-bar);font-size:12px;color:var(--bs-dim);',
    '  font-weight:600;}',
    '#bsudoku-app table.bs-table tr:last-child td{border-bottom:0;}',
    '#bsudoku-app table.bs-table td.bs-r{width:44px;color:var(--bs-dim);font-variant-numeric:tabular-nums;}',
    '#bsudoku-app table.bs-table td.bs-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-variant-numeric:tabular-nums;}',
    '#bsudoku-app table.bs-table td.bs-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    '  max-width:1px;}',
    '#bsudoku-app table.bs-table tr.me td{background:#eaf2f0;}',
    '#bsudoku-app table.bs-table tr.me td.bs-n{font-weight:700;color:var(--bs-ink);}',
    '#bsudoku-app .bs-note{font-size:12px;color:var(--bs-dim);padding:8px 2px 0;}',
    '#bsudoku-app .bs-mybest{font-size:12px;color:var(--bs-dim);margin-left:auto;white-space:nowrap;}',
    '#bsudoku-app .bs-mybest b{color:var(--bs-text);font-weight:700;}',

    '@media (max-width:820px){',
    '#bsudoku-app .bs-brand{display:none;}',
    /* 좁으면 긴 글자가 상단바를 두 줄로 밀고 「지우기」를 반으로 쪼갠다 → 짧은 라벨로 */
    '#bsudoku-app .bs-long{display:none;}',
    '#bsudoku-app .bs-short{display:inline;}',
    /* ⚠️ 오른쪽 정렬용 빈 칸이 flex-wrap 과 만나면 남은 폭을 다 먹고 버튼을 다음 줄로 민다 */
    '#bsudoku-app .bs-spacer{display:none;}',
    '#bsudoku-app .bs-pad button.bs-erase{font-size:17px;}',
    '#bsudoku-app .bs-top{gap:6px;padding:7px 8px;}',
    '#bsudoku-app .bs-levels button{padding:0 8px;font-size:12px;}',
    '#bsudoku-app .bs-boardwrap{padding:4px 6px 8px;}',
    '#bsudoku-app .bs-pad{padding:0 6px 10px;gap:3px;}',
    '#bsudoku-app .bs-rank{padding:8px;}',
    '}'
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* ================================================================ 상태 */

  var state = {
    level: lsGet(LS_LEVEL, 'easy'),
    rankLevel: 'easy',
    noteMode: false,
    sel: -1,
    puzzle: null,      // Uint8Array 원본(단서)
    grid: null,        // 현재 입력
    solution: null,
    notes: null,       // 각 칸의 메모 집합
    undo: [],
    sid: null, seed: null,
    started: false, over: false,
    t0: 0, finalMs: 0, timer: null,
    moves: 0, replay: [], submitted: false,
    making: false
  };
  if (!LEVELS[state.level]) state.level = 'easy';
  state.rankLevel = state.level;

  var ui = {};

  /* ================================================================ 마크업 */

  (function build() {
    var top = el('div', 'bs-top');
    ui.brand = el('span', 'bs-brand', '스도쿠');
    top.appendChild(ui.brand);

    ui.levels = el('div', 'bs-levels');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () { setLevel(k); });
      ui.levels.appendChild(b);
    });
    top.appendChild(ui.levels);
    top.appendChild(el('div', 'bs-spacer'));

    ui.noteBtn = el('button', 'bs-btn', '메모');
    ui.noteBtn.type = 'button';
    ui.noteBtn.title = '작게 후보 숫자 적어두기';
    ui.noteBtn.addEventListener('click', function () {
      state.noteMode = !state.noteMode;
      ui.noteBtn.classList.toggle('on', state.noteMode);
    });
    top.appendChild(ui.noteBtn);

    ui.undoBtn = el('button', 'bs-btn');
    ui.undoBtn.type = 'button';
    ui.undoBtn.title = '되돌리기';
    ui.undoBtn.appendChild(el('span', 'bs-long', '되돌리기'));
    ui.undoBtn.appendChild(el('span', 'bs-short', '↩'));
    ui.undoBtn.addEventListener('click', undo);
    top.appendChild(ui.undoBtn);

    ui.newBtn = el('button', 'bs-btn');
    ui.newBtn.type = 'button';
    ui.newBtn.title = '새 게임';
    ui.newBtn.appendChild(el('span', 'bs-long', '새 게임'));
    ui.newBtn.appendChild(el('span', 'bs-short', '새 판'));
    ui.newBtn.addEventListener('click', function () { newGame(); });
    top.appendChild(ui.newBtn);

    var hud = el('div', 'bs-hud');
    ui.left = el('div', 'bs-count', '00');
    ui.clock = el('div', 'bs-count', '0:00');
    var lw = el('div'), rw = el('div');
    lw.style.textAlign = 'center'; rw.style.textAlign = 'center';
    lw.appendChild(ui.left); lw.appendChild(el('div', 'bs-hudlabel', '남은 칸'));
    rw.appendChild(ui.clock); rw.appendChild(el('div', 'bs-hudlabel', '시간'));
    hud.appendChild(lw); hud.appendChild(rw);

    ui.boardWrap = el('div', 'bs-boardwrap');
    ui.board = el('div', 'bs-board');
    ui.boardWrap.appendChild(ui.board);
    ui.making = el('div', 'bs-making', '문제를 만드는 중…');
    ui.making.style.display = 'none';

    ui.pad = el('div', 'bs-pad');
    for (var v = 1; v <= 9; v++) {
      (function (val) {
        var b = el('button');
        b.type = 'button';
        b.appendChild(document.createTextNode(String(val)));
        var left = el('span', 'bs-left', '');
        b.appendChild(left);
        b.dataset.v = val;
        b.addEventListener('click', function () { input(val); });
        ui.pad.appendChild(b);
      })(v);
    }
    ui.eraseBtn = el('button', 'bs-erase');
    ui.eraseBtn.type = 'button';
    ui.eraseBtn.title = '지우기';
    ui.eraseBtn.appendChild(el('span', 'bs-long', '지우기'));
    ui.eraseBtn.appendChild(el('span', 'bs-short', '⌫'));
    ui.eraseBtn.addEventListener('click', function () { input(0); });
    ui.pad.appendChild(ui.eraseBtn);

    ui.help = el('div', 'bs-help',
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ? '칸을 고르고 숫자를 누르세요. 키보드 1~9 · 지우기는 Backspace · 화살표로 이동합니다.'
        : '칸을 고르고 아래 숫자를 누르세요. 「메모」를 켜면 후보 숫자를 작게 적어둘 수 있습니다.');

    ui.msg = el('div', 'bs-msg');

    var rank = el('div', 'bs-rank');
    var rh = el('div', 'bs-rankhead');
    rh.appendChild(el('span', 'bs-ranktitle', '순위표'));
    ui.rtabs = el('div', 'bs-rtabs');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () {
        state.rankLevel = k; renderRankTabs(); loadRank();
      });
      ui.rtabs.appendChild(b);
    });
    rh.appendChild(ui.rtabs);
    ui.mybest = el('div', 'bs-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bs-note', '');
    rank.appendChild(ui.note);

    root.appendChild(top);
    root.appendChild(hud);
    root.appendChild(ui.making);
    root.appendChild(ui.boardWrap);
    root.appendChild(ui.pad);
    root.appendChild(ui.help);
    root.appendChild(ui.msg);
    root.appendChild(rank);
  })();

  /* ================================================================ 보드 */

  function cellSize() {
    var avail = (ui.boardWrap.clientWidth || root.clientWidth || 520) - 20;
    var isPhone = window.matchMedia('(max-width:820px)').matches;
    var max = isPhone ? 40 : 46;
    var min = isPhone ? 32 : 30;
    return Math.max(min, Math.min(max, Math.floor(avail / 9)));
  }

  function applySize() {
    var sz = cellSize();
    root.style.setProperty('--bs-cell', sz + 'px');
    // 숫자 패드 10개가 한 줄에 들어가되 손가락으로 누를 만한 폭을 지킨다
    var padAvail = (root.clientWidth || 520) - 24;
    var pw = Math.max(30, Math.min(52, Math.floor((padAvail - 9 * 4) / 10)));
    root.style.setProperty('--bs-pad', pw + 'px');
    ui.board.style.fontSize = Math.round(sz * 0.52) + 'px';
  }

  function buildBoard() {
    ui.board.textContent = '';
    ui.cells = new Array(81);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 81; i++) {
      var c = el('button', 'bs-c');
      c.type = 'button';
      c.dataset.i = i;
      var col = i % 9, row = (i / 9) | 0;
      if (col === 2 || col === 5) c.classList.add('cr');
      if (row === 2 || row === 5) c.classList.add('cb');
      ui.cells[i] = c;
      frag.appendChild(c);
    }
    ui.board.appendChild(frag);
    applySize();
  }

  function paint(i) {
    var c = ui.cells[i];
    var v = state.grid[i];
    var given = state.puzzle[i] !== 0;
    c.className = 'bs-c';
    var col = i % 9, row = (i / 9) | 0;
    if (col === 2 || col === 5) c.classList.add('cr');
    if (row === 2 || row === 5) c.classList.add('cb');
    if (given) c.classList.add('given');
    c.textContent = '';
    if (v) {
      c.textContent = String(v);
      // 같은 줄·칸·상자에 같은 숫자가 있으면 잘못 넣은 것이다
      if (!given) {
        var p = PEERS[i];
        for (var k = 0; k < p.length; k++) {
          if (state.grid[p[k]] === v) { c.classList.add('bad'); break; }
        }
      }
    } else if (state.notes[i] && state.notes[i].size) {
      var box = el('div', 'bs-notes');
      for (var n = 1; n <= 9; n++) {
        box.appendChild(el('span', '', state.notes[i].has(n) ? String(n) : ''));
      }
      c.appendChild(box);
    }
  }

  function repaint() {
    for (var i = 0; i < 81; i++) paint(i);
    highlight();
    updateHud();
  }

  function highlight() {
    var sel = state.sel;
    for (var i = 0; i < 81; i++) {
      ui.cells[i].classList.remove('sel', 'peer', 'same');
    }
    if (sel < 0) return;
    var v = state.grid[sel];
    PEERS[sel].forEach(function (j) { ui.cells[j].classList.add('peer'); });
    if (v) {
      for (var k = 0; k < 81; k++) {
        if (state.grid[k] === v && k !== sel) ui.cells[k].classList.add('same');
      }
    }
    ui.cells[sel].classList.add('sel');
  }

  function updateHud() {
    var left = 0, counts = {};
    for (var i = 0; i < 81; i++) {
      if (!state.grid[i]) left++;
      else counts[state.grid[i]] = (counts[state.grid[i]] || 0) + 1;
    }
    ui.left.textContent = String(left).padStart(2, '0');
    // 숫자 패드에 "이 숫자를 몇 개 더 놓아야 하는지" 를 표시한다
    [].forEach.call(ui.pad.children, function (b) {
      if (!b.dataset.v) return;
      var v = +b.dataset.v, rest = 9 - (counts[v] || 0);
      b.classList.toggle('used', rest <= 0);
      var s = b.querySelector('.bs-left');
      if (s) s.textContent = rest > 0 ? String(rest) : '';
    });
    ui.undoBtn.disabled = state.undo.length === 0;
  }

  /* ================================================================ 진행 */

  function newGame() {
    if (state.making) return;
    stopTimer();
    state.started = false; state.over = false; state.submitted = false;
    state.moves = 0; state.replay = []; state.undo = []; state.sel = -1;
    state.finalMs = 0;
    ui.clock.textContent = '0:00';
    ui.msg.className = 'bs-msg';
    ui.msg.textContent = '';
    renderMyBest();

    // 생성은 무거울 수 있다 — 화면을 먼저 바꿔 "멈춘 것처럼" 보이지 않게 한다
    state.making = true;
    ui.making.style.display = '';
    ui.boardWrap.style.display = 'none';
    ui.pad.style.display = 'none';

    // ⭐ 문제는 서버가 준 시드로 만든다(나중에 기록을 되짚어볼 수 있게).
    //    다만 서버가 느리거나 죽어 있어도 게임이 멈추면 안 되니 0.7초까지만 기다린다.
    var built = false;
    function build() {
      if (built) return;
      built = true;
      var seed = state.seed || ('local' + Math.random());
      var made = makePuzzle(state.level, seed);
      state.puzzle = made.puzzle;
      state.solution = made.solution;
      state.grid = made.puzzle.slice();
      state.notes = [];
      for (var i = 0; i < 81; i++) state.notes.push(new Set());
      state.making = false;
      ui.making.style.display = 'none';
      ui.boardWrap.style.display = '';
      ui.pad.style.display = '';
      buildBoard();
      repaint();
    }
    requestSession().then(function () { setTimeout(build, 0); });
    setTimeout(build, 700);
  }

  function requestSession() {
    state.sid = null; state.seed = null;
    return api('POST', '/api/start', { game: GAME, level: state.level })
      .then(function (j) { if (j && j.ok) { state.sid = j.sid; state.seed = j.seed; } })
      .catch(function () { /* 서버 없어도 게임은 돈다 */ });
  }

  function startTimer() {
    state.t0 = Date.now();
    state.timer = setInterval(function () {
      ui.clock.textContent = fmtMs(Date.now() - state.t0);
    }, 500);
  }
  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function select(i) {
    state.sel = i;
    highlight();
  }

  function input(v) {
    if (state.over || state.making) return;
    var i = state.sel;
    if (i < 0 || state.puzzle[i] !== 0) return;   // 문제로 주어진 칸은 못 고친다
    if (!state.started) { state.started = true; startTimer(); }

    var before = { i: i, v: state.grid[i], notes: new Set(state.notes[i]) };

    if (v === 0) {
      if (!state.grid[i] && !state.notes[i].size) return;
      state.undo.push(before);
      state.grid[i] = 0;
      state.notes[i].clear();
    } else if (state.noteMode) {
      state.undo.push(before);
      state.grid[i] = 0;
      if (state.notes[i].has(v)) state.notes[i].delete(v);
      else state.notes[i].add(v);
    } else {
      if (state.grid[i] === v) return;
      state.undo.push(before);
      state.grid[i] = v;
      state.notes[i].clear();
      // 같은 줄·칸·상자의 메모에서 그 숫자를 지워준다 (손으로 지우는 수고를 덜기)
      PEERS[i].forEach(function (j) {
        if (state.notes[j].has(v)) { state.notes[j].delete(v); paint(j); }
      });
    }
    if (state.undo.length > 300) state.undo.shift();

    state.moves++;
    if (state.replay.length < 2000) {
      state.replay.push([Math.round(Date.now() - state.t0), i, v, state.noteMode ? 1 : 0]);
    }
    repaint();
    checkWin();
  }

  function undo() {
    if (state.over || !state.undo.length) return;
    var u = state.undo.pop();
    state.grid[u.i] = u.v;
    state.notes[u.i] = new Set(u.notes);
    state.sel = u.i;
    repaint();
  }

  function checkWin() {
    for (var i = 0; i < 81; i++) {
      if (state.grid[i] !== state.solution[i]) return;
    }
    state.over = true;
    stopTimer();
    state.finalMs = Date.now() - state.t0;
    ui.clock.textContent = fmtMs(state.finalMs);
    for (var k = 0; k < 81; k++) ui.cells[k].classList.add('done');
    var isBest = saveBest(state.level, state.finalMs);
    renderMyBest();
    showWin(isBest);
  }

  /* ================================================================ 결과 */

  function showMsg(text) {
    ui.msg.className = 'bs-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bs-msgt', text));
  }

  function showWin(isBest) {
    var head = LEVELS[state.level].name + ' ' + fmtMs(state.finalMs) +
      (isBest ? ' — 내 최고기록입니다!' : '');
    ui.msg.className = 'bs-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bs-msgt', head));

    if (!state.sid) {
      ui.msg.appendChild(el('span', 'bs-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      return;
    }
    var input2 = el('input');
    input2.type = 'text'; input2.maxLength = 12; input2.placeholder = '이름';
    input2.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bs-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input2.value || '').trim();
      if (!nick) { input2.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true; btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs,
        clicks: state.moves, replay: state.replay.slice(0, 1500)
      }).then(function (j) {
        if (j && j.ok) {
          showMsg(head.split(' —')[0] + ' — ' + j.rank + '등으로 올렸습니다!');
          state.rankLevel = state.level; renderRankTabs(); loadRank();
        } else {
          showMsg(head.split(' —')[0] + ' — ' + rejectText(j && j.error));
        }
      }).catch(function () {
        showMsg(head.split(' —')[0] + ' — 순위 서버에 연결하지 못했습니다. 기록은 저장됐습니다.');
      });
    }
    btn.addEventListener('click', send);
    input2.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') send();
    });
    ui.msg.appendChild(input2);
    ui.msg.appendChild(btn);
  }

  function rejectText(code) {
    var m = {
      faster_than_real_time: '기록이 실제 경과 시간과 맞지 않아 등록되지 않았습니다.',
      below_world_record: '세계기록보다 빨라서 등록되지 않았습니다.',
      session_used: '이미 올린 기록입니다.',
      session_expired: '문제를 받은 지 너무 오래되어 등록되지 않았습니다.',
      no_session: '순위 등록 정보가 없어 올리지 못했습니다.',
      too_many: '잠시 후에 다시 시도해 주세요.',
      too_slow: '너무 오래 걸려서 등록되지 않았습니다.',
      bad_nick: '이름을 확인해 주세요.'
    };
    return m[code] || '순위에 올리지 못했습니다.';
  }

  /* ================================================================ 입력 */

  ui.board.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== ui.board) {
      if (t.classList && t.classList.contains('bs-c')) { select(+t.dataset.i); return; }
      t = t.parentNode;
    }
  });

  // 키보드는 위젯 안에 마음이 가 있을 때만 가로챈다 — 안 그러면 페이지 스크롤을 뺏는다
  document.addEventListener('keydown', function (e) {
    if (!root.contains(document.activeElement) && state.sel < 0) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (state.making) return;
    var k = e.key;
    if (k >= '1' && k <= '9') { input(+k); e.preventDefault(); return; }
    if (k === 'Backspace' || k === 'Delete' || k === '0') { input(0); e.preventDefault(); return; }
    if (k === 'n' || k === 'N') {
      state.noteMode = !state.noteMode;
      ui.noteBtn.classList.toggle('on', state.noteMode);
      e.preventDefault(); return;
    }
    var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[k];
    if (d != null) {
      if (state.sel < 0) { select(0); e.preventDefault(); return; }
      var i = state.sel, col = i % 9;
      if (d === -1 && col === 0) return;
      if (d === 1 && col === 8) return;
      var n = i + d;
      if (n < 0 || n > 80) return;
      select(n);
      e.preventDefault();
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
    var t = el('table', 'bs-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '기록'].forEach(function (h, k) {
      tr.appendChild(el('th', k === 2 ? 'bs-t' : (k === 0 ? 'bs-r' : 'bs-n'), h));
    });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bs-r', String(r.rank)));
      row.appendChild(el('td', 'bs-n', r.nick));
      row.appendChild(el('td', 'bs-t', fmtMs(r.ms)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length + '명 · 사람마다 최고기록 한 줄';
  }

  /* ================================================================ 난이도 */

  function setLevel(k) {
    if (!LEVELS[k] || state.making) return;
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
  newGame();
  loadRank();

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(applySize, 200);
  });

  root.dataset.version = VERSION;
})();
