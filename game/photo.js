/*!
 * 카곰의 얼룩덜룩 — 사진 퍼즐 (클라이언트 전용 + 순위 서버)
 * - 블로그 글에 실린 사진을 조각내서 맞춘다. 사진 목록은 서버가 준다(하루 한 번 갱신).
 * - 조각을 둘 고르면 자리가 바뀐다. 밀기(슬라이딩)가 아니라서 사진이 항상 다 보인다.
 * - 다 맞추면 어느 글의 사진인지 알려준다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #bphoto-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var GAME = 'photo';
  var LS_NICK = 'bmine-nick';      // 다른 게임과 같은 이름을 쓴다(한 번만 적게)
  var LS_BEST = 'bpho-best';
  var LS_LEVEL = 'bpho-level';

  // 서버 GAMES.photo.levels 와 반드시 같아야 한다
  var LEVELS = {
    p3: { key: 'p3', name: '3×3', n: 3 },
    p4: { key: 'p4', name: '4×4', n: 4 },
    p5: { key: 'p5', name: '5×5', n: 5 },
    p6: { key: 'p6', name: '6×6', n: 6 }
  };
  var ORDER = ['p3', 'p4', 'p5', 'p6'];

  var root = document.getElementById('bphoto-app');
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

  var INK = '#8f6a5c';   // 사진 퍼즐 잉크 (지뢰찾기 슬레이트·스도쿠 청록과 계열 분리)
  var CSS = [
    '#bphoto-app{--bp-ink:' + INK + ';--bp-line:#dcdcd4;--bp-line2:#e9e9e2;--bp-text:#2b2b28;',
    '  --bp-dim:#8a8a80;--bp-bg:#ffffff;--bp-bar:#f6f6f2;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bp-text);border:1px solid var(--bp-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bp-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#bphoto-app *{box-sizing:border-box;}',
    '#bphoto-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bp-text);}',

    /* 상단바 */
    '#bphoto-app .bp-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bp-bar);border-bottom:1px solid var(--bp-line);}',
    '#bphoto-app .bp-brand{font-weight:700;font-size:14px;color:var(--bp-ink);white-space:nowrap;}',
    '#bphoto-app .bp-levels{display:flex;border:1px solid var(--bp-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bphoto-app .bp-levels button{border:0;background:#fff;height:30px;padding:0 11px;font-size:13px;',
    '  border-right:1px solid var(--bp-line2);white-space:nowrap;}',
    '#bphoto-app .bp-levels button:last-child{border-right:0;}',
    '#bphoto-app .bp-levels button.on{background:var(--bp-ink);color:#fff;font-weight:600;}',
    '#bphoto-app .bp-levels button:not(.on):hover{background:#efefea;}',
    '#bphoto-app .bp-spacer{flex:1 1 auto;}',
    '#bphoto-app .bp-btn{border:1px solid var(--bp-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#bphoto-app .bp-btn:hover{background:#f4f4ef;}',
    '#bphoto-app .bp-btn.on{border-color:var(--bp-ink);color:var(--bp-ink);font-weight:600;background:#f4ece8;}',

    /* HUD */
    '#bphoto-app .bp-hud{display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 10px 6px;}',
    '#bphoto-app .bp-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:17px;font-weight:600;color:var(--bp-ink);background:var(--bp-bar);',
    '  border:1px solid var(--bp-line);border-radius:4px;padding:3px 12px;min-width:78px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#bphoto-app .bp-hudlabel{font-size:12px;color:var(--bp-dim);text-align:center;}',

    /* 판 */
    '#bphoto-app .bp-boardwrap{display:flex;justify-content:center;padding:4px 10px 10px;}',
    '#bphoto-app .bp-board{position:relative;display:grid;background:var(--bp-line);',
    '  border:1px solid var(--bp-line);gap:1px;user-select:none;-webkit-user-select:none;',
    '  -webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
    '#bphoto-app .bp-p{border:0;padding:0;border-radius:0;background-repeat:no-repeat;',
    '  position:relative;cursor:pointer;transition:outline-color .12s;outline:0 solid transparent;}',
    '#bphoto-app .bp-p.sel{outline:3px solid var(--bp-ink);outline-offset:-3px;z-index:2;}',
    '#bphoto-app .bp-p.hint{outline:2px solid rgba(143,106,92,.45);outline-offset:-2px;}',
    '#bphoto-app .bp-board.done{gap:0;}',
    '#bphoto-app .bp-board.done .bp-p{cursor:default;}',
    '#bphoto-app .bp-peek{position:absolute;inset:0;background-size:cover;background-position:center;',
    '  display:none;z-index:5;border:2px solid var(--bp-ink);}',
    '#bphoto-app .bp-board.peek .bp-peek{display:block;}',
    '#bphoto-app .bp-loading{padding:40px 10px;text-align:center;color:var(--bp-dim);font-size:13px;}',

    /* 안내·결과 */
    '#bphoto-app .bp-help{font-size:12px;color:var(--bp-dim);text-align:center;padding:0 10px 10px;}',
    '#bphoto-app .bp-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#bphoto-app .bp-msg.win{display:flex;background:#f6eee9;border:1px solid #e0cabf;color:#71503f;}',
    '#bphoto-app .bp-msg .bp-msgt{flex:1 1 auto;min-width:150px;}',
    '#bphoto-app .bp-msg input{border:1px solid var(--bp-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:120px;color:inherit;}',
    '#bphoto-app .bp-msg input:focus{outline:none;border-color:var(--bp-ink);}',
    '#bphoto-app .bp-msg .bp-btn{height:30px;}',
    '#bphoto-app .bp-from{margin:0 10px 12px;font-size:13px;color:var(--bp-dim);text-align:center;}',
    '#bphoto-app .bp-from a{color:var(--bp-ink);font-weight:700;text-decoration:none;}',
    '#bphoto-app .bp-from a:hover{text-decoration:underline;}',

    /* 순위표 */
    '#bphoto-app .bp-rank{border-top:1px solid var(--bp-line);background:#fbfbf9;padding:10px;}',
    '#bphoto-app .bp-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#bphoto-app .bp-ranktitle{font-weight:700;font-size:13px;color:var(--bp-ink);}',
    '#bphoto-app .bp-rtabs{display:flex;border:1px solid var(--bp-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#bphoto-app .bp-rtabs button{border:0;background:#fff;height:26px;padding:0 9px;font-size:12px;',
    '  border-right:1px solid var(--bp-line2);white-space:nowrap;}',
    '#bphoto-app .bp-rtabs button:last-child{border-right:0;}',
    '#bphoto-app .bp-rtabs button.on{background:var(--bp-ink);color:#fff;font-weight:600;}',
    '#bphoto-app table.bp-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bp-line);margin:0;}',
    '#bphoto-app table.bp-table th,#bphoto-app table.bp-table td{border:0;',
    '  border-bottom:1px solid var(--bp-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#bphoto-app table.bp-table th{background:var(--bp-bar);font-size:12px;color:var(--bp-dim);font-weight:600;}',
    '#bphoto-app table.bp-table tr:last-child td{border-bottom:0;}',
    '#bphoto-app table.bp-table td.bp-r{width:44px;color:var(--bp-dim);font-variant-numeric:tabular-nums;}',
    '#bphoto-app table.bp-table td.bp-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}',
    '#bphoto-app table.bp-table td.bp-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:1px;}',
    '#bphoto-app table.bp-table tr.me td{background:#f6eee9;}',
    '#bphoto-app table.bp-table tr.me td.bp-n{font-weight:700;color:var(--bp-ink);}',
    '#bphoto-app .bp-note{font-size:12px;color:var(--bp-dim);padding:8px 2px 0;}',
    '#bphoto-app .bp-mybest{font-size:12px;color:var(--bp-dim);margin-left:auto;white-space:nowrap;}',
    '#bphoto-app .bp-mybest b{color:var(--bp-text);font-weight:700;}',

    /* 좁은 화면용 짧은 라벨 — ⚠️ 이 기본값은 반드시 미디어쿼리 **앞**에 와야 한다.
       뒤에 두면 같은 명시도라 나중 규칙이 이겨서 긴 라벨·짧은 라벨이 둘 다 숨는다. */
    '#bphoto-app .bp-short{display:none;}',

    '@media (max-width:820px){',
    '#bphoto-app .bp-brand{display:none;}',
    '#bphoto-app .bp-spacer{display:none;}',   // flex-wrap 과 만나면 버튼을 다음 줄로 민다
    '#bphoto-app .bp-top{gap:6px;padding:7px 8px;}',
    '#bphoto-app .bp-levels button{padding:0 9px;font-size:12px;}',
    '#bphoto-app .bp-btn{padding:0 10px;}',
    '#bphoto-app .bp-boardwrap{padding:4px 6px 8px;}',
    '#bphoto-app .bp-rank{padding:8px;}',
    '#bphoto-app .bp-long{display:none;}',
    '#bphoto-app .bp-short{display:inline;}',
    '}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* ================================================================ 상태 */

  var state = {
    level: lsGet(LS_LEVEL, 'p3'),
    rankLevel: 'p3',
    photos: [],
    photo: null,
    img: null,          // 로드된 Image (크기를 알아야 정사각으로 자른다)
    perm: [],           // 자리 i 에 놓인 조각 번호
    sel: -1,
    started: false, over: false,
    t0: 0, finalMs: 0, timer: null,
    moves: 0, replay: [], submitted: false,
    sid: null, seed: null,
    loading: false
  };
  if (!LEVELS[state.level]) state.level = 'p3';
  state.rankLevel = state.level;

  var ui = {};

  /* ================================================================ 마크업 */

  (function build() {
    var top = el('div', 'bp-top');
    ui.brand = el('span', 'bp-brand', '사진 퍼즐');
    top.appendChild(ui.brand);

    ui.levels = el('div', 'bp-levels');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () { setLevel(k); });
      ui.levels.appendChild(b);
    });
    top.appendChild(ui.levels);
    top.appendChild(el('div', 'bp-spacer'));

    ui.peekBtn = el('button', 'bp-btn');
    ui.peekBtn.type = 'button';
    ui.peekBtn.title = '원본 사진 보기';
    ui.peekBtn.appendChild(el('span', 'bp-long', '원본 보기'));
    ui.peekBtn.appendChild(el('span', 'bp-short', '원본'));
    ui.peekBtn.addEventListener('click', function () {
      if (state.over || !ui.board) return;
      var on = ui.board.classList.toggle('peek');
      ui.peekBtn.classList.toggle('on', on);
    });
    top.appendChild(ui.peekBtn);

    ui.otherBtn = el('button', 'bp-btn');
    ui.otherBtn.type = 'button';
    ui.otherBtn.title = '다른 사진으로';
    ui.otherBtn.appendChild(el('span', 'bp-long', '다른 사진'));
    ui.otherBtn.appendChild(el('span', 'bp-short', '다른'));
    ui.otherBtn.addEventListener('click', function () { newGame(true); });
    top.appendChild(ui.otherBtn);

    ui.againBtn = el('button', 'bp-btn');
    ui.againBtn.type = 'button';
    ui.againBtn.title = '같은 사진 다시 섞기';
    ui.againBtn.appendChild(el('span', 'bp-long', '다시 섞기'));
    ui.againBtn.appendChild(el('span', 'bp-short', '섞기'));
    ui.againBtn.addEventListener('click', function () { newGame(false); });
    top.appendChild(ui.againBtn);

    var hud = el('div', 'bp-hud');
    ui.fit = el('div', 'bp-count', '0 / 9');
    ui.clock = el('div', 'bp-count', '0:00');
    var lw = el('div'), rw = el('div');
    lw.appendChild(ui.fit); lw.appendChild(el('div', 'bp-hudlabel', '제자리'));
    rw.appendChild(ui.clock); rw.appendChild(el('div', 'bp-hudlabel', '시간'));
    hud.appendChild(lw); hud.appendChild(rw);

    ui.boardWrap = el('div', 'bp-boardwrap');
    ui.loading = el('div', 'bp-loading', '사진을 가져오는 중…');

    ui.help = el('div', 'bp-help',
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ? '조각 두 개를 차례로 클릭하면 자리가 바뀝니다. 「원본 보기」로 완성본을 확인할 수 있습니다.'
        : '조각 두 개를 차례로 누르면 자리가 바뀝니다. 「원본」을 누르면 완성본을 볼 수 있습니다.');
    ui.msg = el('div', 'bp-msg');
    ui.from = el('div', 'bp-from');

    var rank = el('div', 'bp-rank');
    var rh = el('div', 'bp-rankhead');
    rh.appendChild(el('span', 'bp-ranktitle', '순위표'));
    ui.rtabs = el('div', 'bp-rtabs');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () {
        state.rankLevel = k; renderRankTabs(); loadRank();
      });
      ui.rtabs.appendChild(b);
    });
    rh.appendChild(ui.rtabs);
    ui.mybest = el('div', 'bp-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bp-note', '');
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

  /* ================================================================ 판 만들기 */

  function boardPx() {
    var avail = (ui.boardWrap.clientWidth || root.clientWidth || 520) - 20;
    var isPhone = window.matchMedia('(max-width:820px)').matches;
    return Math.max(240, Math.min(isPhone ? 420 : 460, avail));
  }

  function buildBoard() {
    var n = LEVELS[state.level].n;
    var size = boardPx();
    var cell = Math.floor((size - (n - 1)) / n);
    var board = cell * n + (n - 1);

    ui.board = el('div', 'bp-board');
    ui.board.style.gridTemplateColumns = 'repeat(' + n + ',' + cell + 'px)';
    ui.board.style.width = board + 'px';
    ui.board.style.height = board + 'px';

    // 사진을 정사각으로 가운데 잘라 쓴다 (cover 와 같은 계산을 직접 한다)
    var span = cell * n;          // 조각 사이 틈을 뺀 그림 전체 크기
    var iw = state.img.naturalWidth || 1, ih = state.img.naturalHeight || 1;
    var ar = iw / ih, bw, bh, ox, oy;
    if (ar >= 1) { bh = span; bw = span * ar; ox = (bw - span) / 2; oy = 0; }
    else { bw = span; bh = span / ar; ox = 0; oy = (bh - span) / 2; }
    state.geo = { n: n, cell: cell, bw: bw, bh: bh, ox: ox, oy: oy };

    ui.pieces = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n * n; i++) {
      var p = el('button', 'bp-p');
      p.type = 'button';
      p.dataset.i = i;
      p.style.width = cell + 'px';
      p.style.height = cell + 'px';
      p.style.backgroundImage = 'url("' + state.photo.u + '")';
      p.style.backgroundSize = Math.round(bw) + 'px ' + Math.round(bh) + 'px';
      ui.pieces.push(p);
      frag.appendChild(p);
    }
    ui.board.appendChild(frag);

    // 「원본 보기」용 완성 사진
    ui.peek = el('div', 'bp-peek');
    ui.peek.style.backgroundImage = 'url("' + state.photo.u + '")';
    ui.board.appendChild(ui.peek);

    ui.boardWrap.textContent = '';
    ui.boardWrap.appendChild(ui.board);
  }

  function paint() {
    var g = state.geo, n = g.n;
    for (var i = 0; i < state.perm.length; i++) {
      var piece = state.perm[i];          // 이 자리에 놓인 조각의 '원래 번호'
      var px = (piece % n) * g.cell + g.ox;
      var py = Math.floor(piece / n) * g.cell + g.oy;
      var node = ui.pieces[i];
      node.style.backgroundPosition = (-px) + 'px ' + (-py) + 'px';
      node.classList.toggle('sel', i === state.sel);
      node.classList.remove('hint');
    }
    updateHud();
  }

  function updateHud() {
    var n = LEVELS[state.level].n, fit = 0;
    for (var i = 0; i < state.perm.length; i++) if (state.perm[i] === i) fit++;
    ui.fit.textContent = fit + ' / ' + (n * n);
    return fit;
  }

  // 시드로 섞는다 — 같은 시드면 같은 배치(나중에 기록을 되짚을 수 있게)
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

  function shuffle() {
    var n = LEVELS[state.level].n, total = n * n;
    var rand = rng((state.seed || 'local' + Math.random()) + ':' + state.level);
    var perm;
    for (var tries = 0; tries < 30; tries++) {
      perm = [];
      for (var i = 0; i < total; i++) perm.push(i);
      for (var k = total - 1; k > 0; k--) {
        var j = Math.floor(rand() * (k + 1));
        var t = perm[k]; perm[k] = perm[j]; perm[j] = t;
      }
      // 이미 제자리인 조각이 너무 많으면 시시하다 (1/4 미만이면 통과)
      var fit = 0;
      for (var m = 0; m < total; m++) if (perm[m] === m) fit++;
      if (fit <= total / 4) break;
    }
    state.perm = perm;
  }

  /* ================================================================ 진행 */

  function pickPhoto() {
    if (!state.photos.length) return null;
    var next, guard = 0;
    do {
      next = state.photos[Math.floor(Math.random() * state.photos.length)];
      guard++;
    } while (state.photo && next.u === state.photo.u && state.photos.length > 1 && guard < 20);
    return next;
  }

  function loadImage(p) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('img')); };
      im.src = p.u;
    });
  }

  function newGame(changePhoto) {
    if (state.loading) return;
    stopTimer();
    state.started = false; state.over = false; state.submitted = false;
    state.moves = 0; state.replay = []; state.sel = -1; state.finalMs = 0;
    ui.clock.textContent = '0:00';
    ui.msg.className = 'bp-msg'; ui.msg.textContent = '';
    ui.from.textContent = '';
    ui.peekBtn.classList.remove('on');
    renderMyBest();

    if (!state.photos.length) {
      ui.loading.style.display = '';
      ui.loading.textContent = '사진 목록을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      ui.boardWrap.textContent = '';
      return;
    }
    if (changePhoto || !state.photo) state.photo = pickPhoto();

    state.loading = true;
    ui.loading.style.display = '';
    ui.loading.textContent = '사진을 가져오는 중…';
    ui.boardWrap.textContent = '';

    var tries = 0;
    function attempt() {
      loadImage(state.photo).then(function (im) {
        state.img = im;
        state.loading = false;
        ui.loading.style.display = 'none';
        shuffle();
        buildBoard();
        paint();
      }).catch(function () {
        // 어쩌다 안 열리는 사진이 있으면 다른 걸로 넘어간다
        if (++tries < 4 && state.photos.length > 1) {
          state.photo = pickPhoto();
          attempt();
        } else {
          state.loading = false;
          ui.loading.textContent = '사진을 불러오지 못했습니다. 「다른 사진」을 눌러 주세요.';
        }
      });
    }
    requestSession().then(function () { attempt(); });
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

  function tap(i) {
    if (state.over || state.loading || !state.perm.length) return;
    if (!state.started) { state.started = true; startTimer(); }
    if (state.sel < 0) {
      state.sel = i;
      paint();
      return;
    }
    if (state.sel === i) { state.sel = -1; paint(); return; }

    var a = state.sel, b = i;
    var t = state.perm[a]; state.perm[a] = state.perm[b]; state.perm[b] = t;
    state.sel = -1;
    state.moves++;
    if (state.replay.length < 2000) {
      state.replay.push([Math.round(Date.now() - state.t0), a, b]);
    }
    paint();
    checkWin();
  }

  function checkWin() {
    for (var i = 0; i < state.perm.length; i++) if (state.perm[i] !== i) return;
    state.over = true;
    stopTimer();
    state.finalMs = Date.now() - state.t0;
    ui.clock.textContent = fmtMs(state.finalMs);
    ui.board.classList.add('done');
    ui.board.classList.remove('peek');
    ui.peekBtn.classList.remove('on');
    var isBest = saveBest(state.level, state.finalMs);
    renderMyBest();
    showFrom();
    showWin(isBest);
  }

  function showFrom() {
    ui.from.textContent = '';
    if (!state.photo) return;
    ui.from.appendChild(document.createTextNode('이 사진은 '));
    var a = el('a', '', '「' + state.photo.t + '」');
    a.href = state.photo.l;
    a.target = '_top';
    a.rel = 'noopener';
    ui.from.appendChild(a);
    ui.from.appendChild(document.createTextNode(' 에 실린 사진입니다.'));
  }

  /* ================================================================ 결과 */

  function showMsg(text) {
    ui.msg.className = 'bp-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bp-msgt', text));
  }

  function showWin(isBest) {
    var head = LEVELS[state.level].name + ' ' + fmtMs(state.finalMs) +
      ' · ' + state.moves + '번 바꿈' + (isBest ? ' — 내 최고기록!' : '');
    ui.msg.className = 'bp-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bp-msgt', head));

    if (!state.sid) {
      ui.msg.appendChild(el('span', 'bp-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      return;
    }
    var input = el('input');
    input.type = 'text'; input.maxLength = 12; input.placeholder = '이름';
    input.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bp-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input.value || '').trim();
      if (!nick) { input.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true; btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs,
        clicks: state.moves, replay: state.replay.slice(0, 1500)
      }).then(function (j) {
        var base = LEVELS[state.level].name + ' ' + fmtMs(state.finalMs);
        if (j && j.ok) {
          showMsg(base + ' — ' + j.rank + '등으로 올렸습니다!');
          state.rankLevel = state.level; renderRankTabs(); loadRank();
        } else {
          showMsg(base + ' — ' + rejectText(j && j.error));
        }
      }).catch(function () {
        showMsg(LEVELS[state.level].name + ' ' + fmtMs(state.finalMs) +
          ' — 순위 서버에 연결하지 못했습니다. 기록은 저장됐습니다.');
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
      session_expired: '판을 받은 지 너무 오래되어 등록되지 않았습니다.',
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
      if (t.classList && t.classList.contains('bp-p')) { tap(+t.dataset.i); return; }
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
    var t = el('table', 'bp-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '기록'].forEach(function (h, k) {
      tr.appendChild(el('th', k === 2 ? 'bp-t' : (k === 0 ? 'bp-r' : 'bp-n'), h));
    });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bp-r', String(r.rank)));
      row.appendChild(el('td', 'bp-n', r.nick));
      row.appendChild(el('td', 'bp-t', fmtMs(r.ms)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length +
      '명 · 사람마다 최고기록 한 줄 · 사진마다 어려움이 조금씩 다릅니다';
  }

  /* ================================================================ 난이도 */

  function setLevel(k) {
    if (!LEVELS[k] || state.loading) return;
    if (k === state.level) {
      if (state.over || !state.started) newGame(true);
      return;
    }
    state.level = k;
    lsSet(LS_LEVEL, k);
    [].forEach.call(ui.levels.children, function (b) {
      b.classList.toggle('on', b.dataset.level === k);
    });
    state.rankLevel = k;
    renderRankTabs();
    newGame(true);
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
      newGame(true);
    })
    .catch(function () {
      state.photos = [];
      newGame(true);
    });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      if (!state.img || state.loading) return;
      if (state.started && !state.over) return;      // 하는 중엔 판을 흔들지 않는다
      var want = boardPx();
      if (ui.board && Math.abs(ui.board.getBoundingClientRect().width - want) < 8) return;
      buildBoard();
      paint();
    }, 200);
  });

  root.dataset.version = VERSION;
})();
