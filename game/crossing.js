/*!
 * 카곰의 얼룩덜룩 — 길 건너기 (클라이언트 전용 + 순위 서버)
 * - 카곰이 찻길을 건넌다. 앞으로 간 칸 수가 점수.
 * - 조작은 사실상 키 하나(전진). 좌우는 곁들이는 정도.
 * - 판은 시드로 만든다 — 같은 시드면 같은 길이라 나중에 기록을 되짚어볼 수 있다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #bcross-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.1';
  var API = 'https://game.soosin.com';
  var GAME = 'crossing';
  var LEVEL = 'solo';
  var LS_NICK = 'bmine-nick';
  var LS_BEST = 'bcro-best';

  var COLS = 9;              // 가로 칸 수
  var VIEW_ROWS = 11;        // 화면에 보이는 줄 수
  var HOME_ROW = 2;          // 카곰이 화면 아래에서 몇 번째 줄에 머무는가
  var HOP_MS = 130;          // 한 칸 이동에 걸리는 시간(= 연타 쿨다운)
  var MAX_ROAD_RUN = 3;      // 찻길이 이보다 길게 이어지지 않게 — 쉴 곳을 보장한다

  var root = document.getElementById('bcross-app');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  /* ================================================================ 유틸 */

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
  function best() { var v = parseInt(lsGet(LS_BEST, '0'), 10); return isNaN(v) ? 0 : v; }
  function saveBest(n) { if (n > best()) { lsSet(LS_BEST, String(n)); return true; } return false; }

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

  var INK = '#9a8248';   // 길 건너기 잉크 (다른 게임과 계열 분리)
  var CSS = [
    '#bcross-app{--bx-ink:' + INK + ';--bx-line:#dcdcd4;--bx-line2:#e9e9e2;--bx-text:#2b2b28;',
    '  --bx-dim:#8a8a80;--bx-bg:#ffffff;--bx-bar:#f6f6f2;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bx-text);border:1px solid var(--bx-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bx-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#bcross-app *{box-sizing:border-box;}',
    '#bcross-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bx-text);}',

    '#bcross-app .bx-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bx-bar);border-bottom:1px solid var(--bx-line);}',
    '#bcross-app .bx-brand{font-weight:700;font-size:14px;color:var(--bx-ink);white-space:nowrap;}',
    '#bcross-app .bx-spacer{flex:1 1 auto;}',
    '#bcross-app .bx-btn{border:1px solid var(--bx-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#bcross-app .bx-btn:hover{background:#f4f4ef;}',

    '#bcross-app .bx-hud{display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 10px 6px;}',
    '#bcross-app .bx-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:19px;font-weight:600;color:var(--bx-ink);background:var(--bx-bar);',
    '  border:1px solid var(--bx-line);border-radius:4px;padding:3px 14px;min-width:78px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#bcross-app .bx-hudlabel{font-size:12px;color:var(--bx-dim);text-align:center;}',

    '#bcross-app .bx-stage{display:flex;justify-content:center;padding:4px 10px 10px;position:relative;}',
    '#bcross-app canvas{border:1px solid var(--bx-line);border-radius:5px;display:block;',
    '  touch-action:manipulation;-webkit-tap-highlight-color:transparent;background:#e8eede;}',
    '#bcross-app .bx-over{position:absolute;inset:4px 10px 10px;display:none;align-items:center;',
    '  justify-content:center;pointer-events:none;}',
    '#bcross-app .bx-over.on{display:flex;}',
    '#bcross-app .bx-overbox{background:rgba(255,255,255,.94);border:1px solid var(--bx-line);',
    '  border-radius:6px;padding:14px 18px;text-align:center;pointer-events:auto;max-width:86%;}',
    '#bcross-app .bx-overbox b{display:block;font-size:16px;margin-bottom:4px;color:var(--bx-ink);}',
    '#bcross-app .bx-overbox span{display:block;font-size:13px;color:var(--bx-dim);}',
    '#bcross-app .bx-overbox .bx-btn{margin-top:10px;}',
    '#bcross-app .bx-over.idle .bx-overbox{pointer-events:none;background:rgba(255,255,255,.88);}',

    '#bcross-app .bx-pad{display:flex;justify-content:center;gap:8px;padding:0 10px 10px;}',
    '#bcross-app .bx-pad button{border:1px solid var(--bx-line);background:#fff;border-radius:5px;',
    '  height:46px;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;}',
    '#bcross-app .bx-pad .bx-go{flex:1 1 auto;max-width:210px;color:var(--bx-ink);}',
    '#bcross-app .bx-pad .bx-side{width:60px;}',
    '#bcross-app .bx-pad button:active{background:#f0f0ea;}',

    '#bcross-app .bx-help{font-size:12px;color:var(--bx-dim);text-align:center;padding:0 10px 10px;}',
    '#bcross-app .bx-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#bcross-app .bx-msg.win{display:flex;background:#f4f1e6;border:1px solid #ddd5bd;color:#6b5c33;}',
    '#bcross-app .bx-msg .bx-msgt{flex:1 1 auto;min-width:150px;}',
    '#bcross-app .bx-msg input{border:1px solid var(--bx-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:120px;color:inherit;}',
    '#bcross-app .bx-msg input:focus{outline:none;border-color:var(--bx-ink);}',
    '#bcross-app .bx-msg .bx-btn{height:30px;}',

    '#bcross-app .bx-rank{border-top:1px solid var(--bx-line);background:#fbfbf9;padding:10px;}',
    '#bcross-app .bx-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#bcross-app .bx-ranktitle{font-weight:700;font-size:13px;color:var(--bx-ink);}',
    '#bcross-app table.bx-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bx-line);margin:0;}',
    '#bcross-app table.bx-table th,#bcross-app table.bx-table td{border:0;',
    '  border-bottom:1px solid var(--bx-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#bcross-app table.bx-table th{background:var(--bx-bar);font-size:12px;color:var(--bx-dim);font-weight:600;}',
    '#bcross-app table.bx-table tr:last-child td{border-bottom:0;}',
    '#bcross-app table.bx-table td.bx-r{width:44px;color:var(--bx-dim);font-variant-numeric:tabular-nums;}',
    '#bcross-app table.bx-table td.bx-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}',
    '#bcross-app table.bx-table td.bx-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:1px;}',
    '#bcross-app table.bx-table tr.me td{background:#f4f1e6;}',
    '#bcross-app table.bx-table tr.me td.bx-n{font-weight:700;color:var(--bx-ink);}',
    '#bcross-app .bx-note{font-size:12px;color:var(--bx-dim);padding:8px 2px 0;}',
    '#bcross-app .bx-mybest{font-size:12px;color:var(--bx-dim);margin-left:auto;white-space:nowrap;}',
    '#bcross-app .bx-mybest b{color:var(--bx-text);font-weight:700;}',

    '#bcross-app .bx-short{display:none;}',
    '@media (max-width:820px){',
    '#bcross-app .bx-brand{display:none;}',
    '#bcross-app .bx-spacer{display:none;}',
    '#bcross-app .bx-long{display:none;}',
    '#bcross-app .bx-short{display:inline;}',
    '#bcross-app .bx-top{gap:6px;padding:7px 8px;}',
    '#bcross-app .bx-stage{padding:4px 6px 8px;}',
    '#bcross-app .bx-over{inset:4px 6px 8px;}',
    '#bcross-app .bx-pad{padding:0 6px 10px;gap:6px;}',
    '#bcross-app .bx-rank{padding:8px;}',
    '}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* ================================================================ 상태 */

  var state = {
    rows: {},          // 줄번호 → {type:'grass'|'road', dir, speed, cars:[x…], gap}
    px: Math.floor(COLS / 2),   // 카곰 칸 위치
    py: 0,             // 카곰 줄 위치(위로 갈수록 +)
    fx: Math.floor(COLS / 2),   // 그려지는 위치(부드럽게 따라온다)
    fy: 0,
    cam: 0,            // 카메라가 보는 맨 아래 줄
    score: 0,
    started: false, over: false, idle: true, armed: false, hop: 0,
    t0: 0, finalMs: 0,
    moves: [], raf: null, last: 0,
    sid: null, seed: null, rand: null,
    submitted: false
  };

  var ui = {};

  /* ================================================================ 마크업 */

  (function build() {
    var top = el('div', 'bx-top');
    ui.brand = el('span', 'bx-brand', '길 건너기');
    top.appendChild(ui.brand);
    top.appendChild(el('div', 'bx-spacer'));
    ui.newBtn = el('button', 'bx-btn');
    ui.newBtn.type = 'button';
    ui.newBtn.title = '새로 시작';
    ui.newBtn.appendChild(el('span', 'bx-long', '새로 시작'));
    ui.newBtn.appendChild(el('span', 'bx-short', '새로'));
    ui.newBtn.addEventListener('click', function () { newGame(); });
    top.appendChild(ui.newBtn);

    var hud = el('div', 'bx-hud');
    function cell(node, label) {
      var w = el('div'); w.style.textAlign = 'center';
      w.appendChild(node); w.appendChild(el('div', 'bx-hudlabel', label));
      return w;
    }
    ui.score = el('div', 'bx-count', '0');
    ui.bestBox = el('div', 'bx-count', '0');
    hud.appendChild(cell(ui.score, '건넌 칸'));
    hud.appendChild(cell(ui.bestBox, '내 최고'));

    ui.stage = el('div', 'bx-stage');
    ui.canvas = document.createElement('canvas');
    ui.stage.appendChild(ui.canvas);
    ui.over = el('div', 'bx-over');
    ui.overBox = el('div', 'bx-overbox');
    ui.over.appendChild(ui.overBox);
    ui.stage.appendChild(ui.over);

    ui.pad = el('div', 'bx-pad');
    ui.left = el('button', 'bx-side', '◀');
    ui.go = el('button', 'bx-go', '앞으로');
    ui.right = el('button', 'bx-side', '▶');
    ui.left.type = ui.go.type = ui.right.type = 'button';
    ui.left.addEventListener('click', function () { move(-1, 0); });
    ui.right.addEventListener('click', function () { move(1, 0); });
    ui.go.addEventListener('click', function () { move(0, 1); });
    ui.pad.appendChild(ui.left);
    ui.pad.appendChild(ui.go);
    ui.pad.appendChild(ui.right);

    ui.help = el('div', 'bx-help', helpText());
    ui.msg = el('div', 'bx-msg');

    var rank = el('div', 'bx-rank');
    var rh = el('div', 'bx-rankhead');
    rh.appendChild(el('span', 'bx-ranktitle', '순위표'));
    ui.mybest = el('div', 'bx-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bx-note', '');
    rank.appendChild(ui.note);

    root.appendChild(top);
    root.appendChild(hud);
    root.appendChild(ui.stage);
    root.appendChild(ui.pad);
    root.appendChild(ui.help);
    root.appendChild(ui.msg);
    root.appendChild(rank);
  })();

  function touch() {
    return !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }
  function helpText() {
    if (touch()) return '화면을 누르면 앞으로. 아래 버튼으로 옆걸음. 차에 닿으면 끝입니다.';
    return '화면을 한 번 누른 뒤에는 스페이스(또는 ↑)로 앞으로, ← → 로 옆걸음.';
  }

  /* ================================================================ 판 만들기 */

  function rowAt(y) {
    if (state.rows[y]) return state.rows[y];
    var r;
    // 찻길이 너무 길게 이어지면 건널 수가 없다 — 묶음 뒤엔 반드시 잔디 한 줄
    var run = 0;
    for (var k = y - 1; k >= 0 && state.rows[k] && state.rows[k].type === 'road'; k--) run++;
    if (y <= 2 || run >= MAX_ROAD_RUN) {
      r = { type: 'grass' };                 // 출발선 근처와 묶음 뒤는 안전하게
    } else {
      var rd = state.rand ? state.rand() : Math.random();
      if (rd < 0.36) {
        r = { type: 'grass' };
      } else {
        var dir = (state.rand ? state.rand() : Math.random()) < 0.5 ? -1 : 1;
        // 멀리 갈수록 조금씩 빨라지되 한계를 둔다(운으로만 죽지 않게)
        var hard = Math.min(1, y / 120);
        var speed = (1.0 + (state.rand ? state.rand() : Math.random()) * 1.3) * (1 + hard * 0.6);
        // 차 길이가 1.5칸이라 gap 이 3.0 밑이면 지나갈 틈이 사라진다
        var gap = 3.6 - hard * 0.6 + (state.rand ? state.rand() : Math.random()) * 1.8;
        var cars = [];
        var n = Math.ceil((COLS + 6) / gap);
        var off = (state.rand ? state.rand() : Math.random()) * gap;
        for (var i = 0; i < n; i++) cars.push(-3 + off + i * gap);
        r = { type: 'road', dir: dir, speed: speed, gap: gap, cars: cars,
              span: n * gap };
      }
    }
    state.rows[y] = r;
    return r;
  }

  function layout() {
    var wrapW = ui.stage.clientWidth || root.clientWidth || 360;
    var pad = window.matchMedia('(max-width:820px)').matches ? 12 : 20;
    var w = Math.max(240, Math.min(480, wrapW - pad));
    var cell = Math.floor(w / COLS);
    w = cell * COLS;
    var h = cell * VIEW_ROWS;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    ui.canvas.style.width = w + 'px';
    ui.canvas.style.height = h + 'px';
    ui.canvas.width = Math.round(w * dpr);
    ui.canvas.height = Math.round(h * dpr);
    var ctx = ui.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.cell = cell; state.w = w; state.h = h;
  }

  /* ================================================================ 그리기 */

  function drawBear(ctx, cx, cy, s, hop) {
    // 카곰 얼굴을 아주 단순하게 (작게 나오므로 이 정도면 충분하다)
    ctx.save();
    ctx.translate(cx, cy);
    // ⚠️ 가로는 건드리지 않는다 — 충돌은 가로 겹침으로 재기 때문에
    if (hop) ctx.scale(1, 1 + 0.2 * hop);
    var r = s * 0.34;
    ctx.fillStyle = '#b8794e';
    ctx.beginPath(); ctx.arc(-r * 0.78, -r * 0.8, r * 0.42, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.78, -r * 0.8, r * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = '#d29b66';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#f0d8bd';
    ctx.beginPath(); ctx.ellipse(0, r * 0.34, r * 0.5, r * 0.36, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a3527';
    ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.14, r * 0.13, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.14, r * 0.13, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 0.17, r * 0.12, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawCar(ctx, x, y, w, h, dir, hue) {
    ctx.save();
    ctx.fillStyle = hue;
    var rr = Math.min(6, h * 0.28);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    var wx = dir > 0 ? x + w * 0.52 : x + w * 0.16;
    if (ctx.roundRect) ctx.roundRect(wx, y + h * 0.2, w * 0.32, h * 0.44, rr * 0.5);
    else ctx.rect(wx, y + h * 0.2, w * 0.32, h * 0.44);
    ctx.fill();
    ctx.restore();
  }

  var CAR_HUES = ['#8d6e63', '#7a8b99', '#9c8457', '#7f9479', '#a1736b', '#6f7f8f'];

  function draw() {
    var ctx = ui.canvas.getContext('2d');
    var cell = state.cell, w = state.w, h = state.h;
    ctx.clearRect(0, 0, w, h);

    // 아래에서 위로: 화면 맨 아래가 state.cam 줄
    for (var i = -1; i <= VIEW_ROWS; i++) {
      var y = Math.floor(state.cam) + i;
      if (y < 0) continue;
      var r = rowAt(y);
      var sy = h - (i - (state.cam - Math.floor(state.cam)) + 1) * cell;
      if (r.type === 'grass') {
        ctx.fillStyle = (y % 2) ? '#e3ead6' : '#dde5cd';
        ctx.fillRect(0, sy, w, cell);
      } else {
        ctx.fillStyle = '#5c5c58';
        ctx.fillRect(0, sy, w, cell);
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([cell * 0.22, cell * 0.22]);
        ctx.beginPath();
        ctx.moveTo(0, sy + cell / 2); ctx.lineTo(w, sy + cell / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        var hue = CAR_HUES[y % CAR_HUES.length];
        for (var c = 0; c < r.cars.length; c++) {
          var cxp = r.cars[c] * cell;
          drawCar(ctx, cxp, sy + cell * 0.16, cell * 1.5, cell * 0.68, r.dir, hue);
        }
      }
    }

    // 카곰
    var bx = (state.fx + 0.5) * cell;
    var by = h - ((state.fy - state.cam) + 0.5) * cell;
    drawBear(ctx, bx, by, cell, state.hop || 0);
  }

  /* ================================================================ 진행 */

  function carHits(y, col) {
    var r = state.rows[y];
    if (!r || r.type !== 'road') return false;
    for (var i = 0; i < r.cars.length; i++) {
      var a = r.cars[i], b = a + 1.5;            // 차 길이 1.5칸
      if (col + 0.82 > a && col + 0.18 < b) return true;
    }
    return false;
  }

  function move(dx, dy) {
    if (state.over || !state.cell) return;
    // 연타로 차를 뚫고 지나가지 못하게 — 한 칸 옮기는 데 최소 HOP_MS
    var t = Date.now();
    if (t - (state.lastMove || 0) < HOP_MS) return;
    state.lastMove = t;
    if (state.idle) { state.idle = false; state.armed = true; ui.over.classList.remove('on'); }
    if (!state.started) {
      state.started = true;
      state.t0 = Date.now();
    }
    var nx = state.px + dx, ny = state.py + dy;
    if (nx < 0 || nx >= COLS) return;
    if (ny < 0) return;
    state.px = nx; state.py = ny;
    state.fx = nx; state.fy = ny;   // 그림도 같은 순간에 옮긴다
    state.hop = 1;
    rowAt(ny);
    if (state.moves.length < 3000) {
      state.moves.push([Math.round(Date.now() - state.t0), dx, dy]);
    }
    if (ny > state.score) {
      state.score = ny;
      ui.score.textContent = String(state.score);
    }
    // 바로 밟은 자리에 차가 있으면 즉사
    if (carHits(ny, nx)) gameOver();
  }

  function tick(ts) {
    state.raf = requestAnimationFrame(tick);
    if (!state.last) state.last = ts;
    var dt = Math.min(64, ts - state.last) / 1000;   // 탭이 쉬었다 와도 튀지 않게
    state.last = ts;

    // 차 이동 (보이는 범위만)
    var from = Math.floor(state.cam) - 2, to = Math.floor(state.cam) + VIEW_ROWS + 2;
    for (var y = Math.max(0, from); y <= to; y++) {
      var r = state.rows[y];
      if (!r || r.type !== 'road') continue;
      for (var i = 0; i < r.cars.length; i++) {
        r.cars[i] += r.dir * r.speed * dt;
        if (r.dir > 0 && r.cars[i] > COLS + 3) r.cars[i] -= r.span;
        else if (r.dir < 0 && r.cars[i] < -3) r.cars[i] += r.span;
      }
    }

    // 카곰이 서 있는 줄에서 차에 치였는지
    if (state.started && !state.over && carHits(state.py, state.px)) gameOver();

    // 🚨 카곰 위치는 절대 보간하지 않는다 — 그림이 판정보다 뒤처지면
    //    "차에 닿지도 않았는데 죽는다". 화면의 부드러움은 카메라가 맡는다
    //    (카곰도 줄도 같은 cam 기준이라 둘의 상대 위치는 항상 정확하다).
    state.fx = state.px;
    state.fy = state.py;
    // 점프 느낌은 위치가 아니라 '모양'으로만 준다 — 판정과 어긋날 여지가 없다
    if (state.hop > 0) state.hop = Math.max(0, state.hop - dt * 1000 / HOP_MS);
    var targetCam = Math.max(0, state.py - HOME_ROW);
    state.cam += (targetCam - state.cam) * Math.min(1, dt * 12);

    draw();
  }

  function gameOver() {
    if (state.over) return;
    state.over = true;
    state.finalMs = state.started ? (Date.now() - state.t0) : 0;
    showOver();
    showResult();
  }

  function showIdle() {
    ui.overBox.textContent = '';
    ui.overBox.appendChild(el('b', '', '카곰이 길을 건넙니다'));
    ui.overBox.appendChild(el('span', '', touch()
      ? '화면을 눌러 시작하세요.'
      : '화면을 누르거나 「앞으로」를 눌러 시작하세요.'));
    ui.over.classList.add('idle');
    ui.over.classList.add('on');
  }

  function showOver() {
    ui.over.classList.remove('idle');
    ui.overBox.textContent = '';
    ui.overBox.appendChild(el('b', '', state.score + '칸 건넜습니다'));
    ui.overBox.appendChild(el('span', '', '차에 부딪혔어요.'));
    var b = el('button', 'bx-btn', '다시 하기');
    b.type = 'button';
    b.addEventListener('click', function () { newGame(); });
    ui.overBox.appendChild(b);
    ui.over.classList.add('on');
  }

  function newGame() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
    state.rows = {};
    state.px = state.fx = Math.floor(COLS / 2);
    state.py = state.fy = 0;
    state.cam = 0;
    state.score = 0;
    state.started = false; state.over = false; state.submitted = false;
    state.idle = true;
    state.moves = []; state.last = 0; state.finalMs = 0; state.lastMove = 0; state.hop = 0;
    ui.score.textContent = '0';
    ui.bestBox.textContent = String(best());
    ui.over.classList.remove('on');
    ui.over.classList.remove('idle');
    ui.msg.className = 'bx-msg'; ui.msg.textContent = '';
    renderMyBest();

    requestSession().then(function () {
      state.rand = rng((state.seed || 'local' + Math.random()) + ':cross');
      layout();
      for (var y = 0; y <= VIEW_ROWS + 2; y++) rowAt(y);
      showIdle();
      state.raf = requestAnimationFrame(tick);
    });
  }

  function requestSession() {
    state.sid = null; state.seed = null;
    return api('POST', '/api/start', { game: GAME, level: LEVEL })
      .then(function (j) { if (j && j.ok) { state.sid = j.sid; state.seed = j.seed; } })
      .catch(function () {});
  }

  /* ================================================================ 결과 */

  function showMsg(text) {
    ui.msg.className = 'bx-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bx-msgt', text));
  }

  function showResult() {
    var isBest = saveBest(state.score);
    ui.bestBox.textContent = String(best());
    renderMyBest();
    var head = state.score + '칸' + (isBest ? ' — 내 최고기록!' : '');

    ui.msg.className = 'bx-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bx-msgt', head));

    if (!state.sid || state.score <= 0) {
      if (!state.sid) {
        ui.msg.appendChild(el('span', 'bx-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      }
      return;
    }
    var input = el('input');
    input.type = 'text'; input.maxLength = 12; input.placeholder = '이름';
    input.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bx-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input.value || '').trim();
      if (!nick) { input.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true; btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs, score: state.score,
        clicks: state.moves.length, replay: state.moves.slice(0, 1500)
      }).then(function (j) {
        if (j && j.ok) {
          showMsg(state.score + '칸 — ' + j.rank + '등으로 올렸습니다!');
          loadRank();
        } else {
          showMsg(state.score + '칸 — ' + rejectText(j && j.error));
        }
      }).catch(function () {
        showMsg(state.score + '칸 — 순위 서버에 연결하지 못했습니다.');
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
      score_too_fast: '너무 짧은 시간에 너무 멀리 가서 등록되지 않았습니다.',
      faster_than_real_time: '기록이 실제 경과 시간과 맞지 않아 등록되지 않았습니다.',
      below_world_record: '판이 너무 짧아 등록되지 않았습니다.',
      bad_score: '점수를 확인해 주세요.',
      session_used: '이미 올린 기록입니다.',
      session_expired: '시작한 지 너무 오래되어 등록되지 않았습니다.',
      no_session: '순위 등록 정보가 없어 올리지 못했습니다.',
      too_many: '잠시 후에 다시 시도해 주세요.',
      bad_nick: '이름을 확인해 주세요.'
    };
    return m[code] || '순위에 올리지 못했습니다.';
  }

  /* ================================================================ 입력 */

  ui.canvas.addEventListener('click', function () { move(0, 1); });

  document.addEventListener('keydown', function (e) {
    // 위젯이 화면에 없거나 아직 한 번도 안 만졌으면 페이지 조작(스크롤)을 뺏지 않는다
    if (!visible || !state.armed) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { move(0, 1); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { move(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { move(1, 0); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { move(0, -1); e.preventDefault(); }
  });

  // 위젯이 화면에 보이고 있으면 키를 받는다(안 보이면 페이지 스크롤을 방해하지 않게)
  var visible = false;
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      visible = es.some(function (x) { return x.isIntersecting; });
    }, { threshold: 0.35 }).observe(root);
  } else {
    visible = true;
  }

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

  function renderMyBest() {
    ui.mybest.innerHTML = best() ? '내 최고 <b>' + best() + '칸</b>' : '내 기록 없음';
  }

  function loadRank() {
    ui.note.textContent = '';
    api('GET', '/api/top?game=' + GAME + '&level=' + LEVEL + '&limit=20')
      .then(function (j) {
        if (!j || !j.ok) throw new Error('bad');
        drawRank(j);
      })
      .catch(function () {
        ui.rankBody.textContent = '';
        ui.note.textContent = '순위 서버에 연결하지 못했습니다. 게임과 내 기록은 그대로 쓸 수 있습니다.';
      });
  }

  function drawRank(j) {
    var me = lsGet(LS_NICK, '');
    ui.rankBody.textContent = '';
    if (!j.rows.length) {
      ui.note.textContent = '기록이 아직 없습니다. 첫 기록의 주인공이 되어 보세요.';
      return;
    }
    var t = el('table', 'bx-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '건넌 칸'].forEach(function (h, k) {
      tr.appendChild(el('th', k === 2 ? 'bx-t' : (k === 0 ? 'bx-r' : 'bx-n'), h));
    });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bx-r', String(r.rank)));
      row.appendChild(el('td', 'bx-n', r.nick));
      row.appendChild(el('td', 'bx-t', r.score + '칸'));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length +
      '명 · 사람마다 최고기록 한 줄';
  }

  /* ================================================================ 시작 */

  renderMyBest();
  loadRank();
  newGame();

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { layout(); draw(); }, 200);
  });

  root.dataset.version = VERSION;
})();
