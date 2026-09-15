/*!
 * 카곰의 얼룩덜룩 — 타자 연습 (클라이언트 전용 + 순위 서버)
 * - 치는 문장은 **형 블로그 글에서 뽑은 것**이다(서버가 골라 준다).
 * - 문장을 서버가 고르므로 글자 수를 서버가 안다 → 순위가 공정하고 위조 하한도 정확하다.
 * - 다 치면 어느 글에서 나온 문장인지 알려준다.
 * - 블로그 테마 오염 방지: 모든 셀렉터·id 를 #btype-app 스코프로 한정한다.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = 'https://game.soosin.com';
  var GAME = 'typing';
  var LS_NICK = 'bmine-nick';
  var LS_BEST = 'btyp-best';
  var LS_LEVEL = 'btyp-level';

  // 서버 GAMES.typing.levels 와 반드시 같아야 한다
  var LEVELS = {
    t3:  { key: 't3',  name: '3문장',  n: 3 },
    t5:  { key: 't5',  name: '5문장',  n: 5 },
    t10: { key: 't10', name: '10문장', n: 10 }
  };
  var ORDER = ['t3', 't5', 't10'];

  var root = document.getElementById('btype-app');
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

  // 한글 타자는 자모 단위로 센다(한컴 타자연습과 같은 셈법).
  // 받침 있는 글자는 3타, 없으면 2타. 겹받침·복합모음은 엄밀히는 더 치지만 표시용이라 이 정도면 충분.
  function strokes(str) {
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) n += ((c - 0xAC00) % 28) ? 3 : 2;
      else if (str[i] === ' ') n += 1;
      else n += 1;
    }
    return n;
  }

  /* ================================================================ 스타일 */

  var INK = '#7b6ea8';   // 타자 연습 잉크 (다른 게임과 계열 분리)
  var CSS = [
    '#btype-app{--bt-ink:' + INK + ';--bt-line:#dcdcd4;--bt-line2:#e9e9e2;--bt-text:#2b2b28;',
    '  --bt-dim:#8a8a80;--bt-bg:#ffffff;--bt-bar:#f6f6f2;--bt-bad:#b4675c;--bt-rest:#b6b6ae;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bt-text);border:1px solid var(--bt-line);border-radius:6px;overflow:hidden;',
    '  background:var(--bt-bg);margin:18px 0;line-height:1.5;text-align:left;}',
    '#btype-app *{box-sizing:border-box;}',
    '#btype-app button{font-family:inherit;margin:0;text-transform:none;letter-spacing:normal;',
    '  box-shadow:none;text-shadow:none;cursor:pointer;color:var(--bt-text);}',

    '#btype-app .bt-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;',
    '  background:var(--bt-bar);border-bottom:1px solid var(--bt-line);}',
    '#btype-app .bt-brand{font-weight:700;font-size:14px;color:var(--bt-ink);white-space:nowrap;}',
    '#btype-app .bt-levels{display:flex;border:1px solid var(--bt-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#btype-app .bt-levels button{border:0;background:#fff;height:30px;padding:0 11px;font-size:13px;',
    '  border-right:1px solid var(--bt-line2);white-space:nowrap;}',
    '#btype-app .bt-levels button:last-child{border-right:0;}',
    '#btype-app .bt-levels button.on{background:var(--bt-ink);color:#fff;font-weight:600;}',
    '#btype-app .bt-levels button:not(.on):hover{background:#efefea;}',
    '#btype-app .bt-spacer{flex:1 1 auto;}',
    '#btype-app .bt-btn{border:1px solid var(--bt-line);background:#fff;border-radius:4px;height:32px;',
    '  padding:0 12px;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}',
    '#btype-app .bt-btn:hover{background:#f4f4ef;}',

    '#btype-app .bt-hud{display:flex;align-items:center;justify-content:center;gap:12px;',
    '  padding:10px 10px 6px;flex-wrap:wrap;}',
    '#btype-app .bt-cell{text-align:center;}',
    '#btype-app .bt-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    '  font-size:17px;font-weight:600;color:var(--bt-ink);background:var(--bt-bar);',
    '  border:1px solid var(--bt-line);border-radius:4px;padding:3px 10px;min-width:72px;',
    '  text-align:center;font-variant-numeric:tabular-nums;}',
    '#btype-app .bt-hudlabel{font-size:12px;color:var(--bt-dim);}',

    /* 문장·입력 */
    '#btype-app .bt-stage{padding:6px 12px 12px;}',
    '#btype-app .bt-line{font-size:19px;line-height:1.75;letter-spacing:.01em;word-break:keep-all;',
    '  background:#fbfbf9;border:1px solid var(--bt-line);border-radius:5px;padding:12px 14px;',
    '  min-height:64px;}',
    '#btype-app .bt-line b{font-weight:400;}',
    '#btype-app .bt-line .ok{color:var(--bt-ink);}',
    '#btype-app .bt-line .bad{color:var(--bt-bad);background:#f7eae7;border-radius:2px;}',
    '#btype-app .bt-line .cur{color:var(--bt-text);border-bottom:2px solid var(--bt-ink);}',
    '#btype-app .bt-line .rest{color:var(--bt-rest);}',
    '#btype-app .bt-input{width:100%;margin-top:10px;height:44px;font-size:17px;padding:0 12px;',
    '  border:1px solid var(--bt-line);border-radius:5px;font-family:inherit;background:#fff;',
    '  color:var(--bt-text);}',
    '#btype-app .bt-input:focus{outline:none;border-color:var(--bt-ink);box-shadow:0 0 0 2px #ece9f4;}',
    '#btype-app .bt-input:disabled{background:#f4f4f0;color:var(--bt-dim);}',
    '#btype-app .bt-loading{padding:34px 10px;text-align:center;color:var(--bt-dim);font-size:13px;}',

    '#btype-app .bt-help{font-size:12px;color:var(--bt-dim);text-align:center;padding:0 10px 10px;}',
    '#btype-app .bt-msg{margin:0 10px 12px;padding:9px 12px;border-radius:4px;font-size:13px;',
    '  display:none;align-items:center;gap:10px;flex-wrap:wrap;}',
    '#btype-app .bt-msg.win{display:flex;background:#eeecf5;border:1px solid #cdc7e0;color:#4e4670;}',
    '#btype-app .bt-msg .bt-msgt{flex:1 1 auto;min-width:150px;}',
    '#btype-app .bt-msg input{border:1px solid var(--bt-line);border-radius:4px;height:30px;',
    '  padding:0 8px;font-size:13px;font-family:inherit;background:#fff;width:120px;color:inherit;}',
    '#btype-app .bt-msg input:focus{outline:none;border-color:var(--bt-ink);}',
    '#btype-app .bt-msg .bt-btn{height:30px;}',
    '#btype-app .bt-from{margin:0 10px 12px;font-size:12px;color:var(--bt-dim);text-align:center;',
    '  line-height:1.9;}',
    '#btype-app .bt-from a{color:var(--bt-ink);font-weight:700;text-decoration:none;}',
    '#btype-app .bt-from a:hover{text-decoration:underline;}',

    '#btype-app .bt-rank{border-top:1px solid var(--bt-line);background:#fbfbf9;padding:10px;}',
    '#btype-app .bt-rankhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#btype-app .bt-ranktitle{font-weight:700;font-size:13px;color:var(--bt-ink);}',
    '#btype-app .bt-rtabs{display:flex;border:1px solid var(--bt-line);border-radius:4px;',
    '  overflow:hidden;background:#fff;}',
    '#btype-app .bt-rtabs button{border:0;background:#fff;height:26px;padding:0 9px;font-size:12px;',
    '  border-right:1px solid var(--bt-line2);white-space:nowrap;}',
    '#btype-app .bt-rtabs button:last-child{border-right:0;}',
    '#btype-app .bt-rtabs button.on{background:var(--bt-ink);color:#fff;font-weight:600;}',
    '#btype-app table.bt-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;',
    '  border:1px solid var(--bt-line);margin:0;}',
    '#btype-app table.bt-table th,#btype-app table.bt-table td{border:0;',
    '  border-bottom:1px solid var(--bt-line2);padding:5px 8px;text-align:left;background:transparent;}',
    '#btype-app table.bt-table th{background:var(--bt-bar);font-size:12px;color:var(--bt-dim);font-weight:600;}',
    '#btype-app table.bt-table tr:last-child td{border-bottom:0;}',
    '#btype-app table.bt-table td.bt-r{width:44px;color:var(--bt-dim);font-variant-numeric:tabular-nums;}',
    '#btype-app table.bt-table td.bt-t{width:88px;text-align:right;font-weight:600;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}',
    '#btype-app table.bt-table td.bt-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:1px;}',
    '#btype-app table.bt-table tr.me td{background:#eeecf5;}',
    '#btype-app table.bt-table tr.me td.bt-n{font-weight:700;color:var(--bt-ink);}',
    '#btype-app .bt-note{font-size:12px;color:var(--bt-dim);padding:8px 2px 0;}',
    '#btype-app .bt-mybest{font-size:12px;color:var(--bt-dim);margin-left:auto;white-space:nowrap;}',
    '#btype-app .bt-mybest b{color:var(--bt-text);font-weight:700;}',

    /* 좁은 화면용 짧은 라벨 — ⚠️ 미디어쿼리 **앞**에 둬야 한다(뒤면 둘 다 숨는다) */
    '#btype-app .bt-short{display:none;}',

    '@media (max-width:820px){',
    '#btype-app .bt-brand{display:none;}',
    '#btype-app .bt-spacer{display:none;}',
    '#btype-app .bt-long{display:none;}',
    '#btype-app .bt-short{display:inline;}',
    '#btype-app .bt-top{gap:6px;padding:7px 8px;}',
    '#btype-app .bt-levels button{padding:0 9px;font-size:12px;}',
    '#btype-app .bt-stage{padding:6px 8px 10px;}',
    '#btype-app .bt-line{font-size:17px;padding:10px 11px;}',
    '#btype-app .bt-hud{gap:8px;}',
    '#btype-app .bt-count{min-width:62px;font-size:15px;padding:3px 8px;}',
    '#btype-app .bt-rank{padding:8px;}',
    '}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* ================================================================ 상태 */

  var state = {
    level: lsGet(LS_LEVEL, 't3'),
    rankLevel: 't3',
    sentences: [],
    idx: 0,
    started: false, over: false,
    t0: 0, finalMs: 0, timer: null,
    typedOk: 0, typos: 0, composing: false,
    sid: null, seed: null,
    loading: false, submitted: false
  };
  if (!LEVELS[state.level]) state.level = 't3';
  state.rankLevel = state.level;

  var ui = {};

  /* ================================================================ 마크업 */

  (function build() {
    var top = el('div', 'bt-top');
    ui.brand = el('span', 'bt-brand', '타자 연습');
    top.appendChild(ui.brand);

    ui.levels = el('div', 'bt-levels');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () { setLevel(k); });
      ui.levels.appendChild(b);
    });
    top.appendChild(ui.levels);
    top.appendChild(el('div', 'bt-spacer'));

    ui.againBtn = el('button', 'bt-btn');
    ui.againBtn.type = 'button';
    ui.againBtn.title = '새 문장으로';
    ui.againBtn.appendChild(el('span', 'bt-long', '새 문장'));
    ui.againBtn.appendChild(el('span', 'bt-short', '새로'));
    ui.againBtn.addEventListener('click', function () { newGame(); });
    top.appendChild(ui.againBtn);

    var hud = el('div', 'bt-hud');
    function cell(node, label) {
      var w = el('div', 'bt-cell');
      w.appendChild(node); w.appendChild(el('div', 'bt-hudlabel', label));
      return w;
    }
    ui.prog = el('div', 'bt-count', '0 / 3');
    ui.cpm = el('div', 'bt-count', '0');
    ui.acc = el('div', 'bt-count', '100%');
    ui.clock = el('div', 'bt-count', '0:00');
    hud.appendChild(cell(ui.prog, '문장'));
    hud.appendChild(cell(ui.cpm, '타/분'));
    hud.appendChild(cell(ui.acc, '정확도'));
    hud.appendChild(cell(ui.clock, '시간'));

    ui.stage = el('div', 'bt-stage');
    ui.line = el('div', 'bt-line');
    ui.input = document.createElement('input');
    ui.input.type = 'text';
    ui.input.className = 'bt-input';
    ui.input.autocomplete = 'off';
    ui.input.autocapitalize = 'off';
    ui.input.spellcheck = false;
    ui.input.placeholder = '여기에 따라 치세요';
    ui.stage.appendChild(ui.line);
    ui.stage.appendChild(ui.input);
    ui.loading = el('div', 'bt-loading', '문장을 가져오는 중…');

    ui.help = el('div', 'bt-help',
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ? '문장을 정확히 다 치면 다음 문장으로 넘어갑니다. 틀린 글자는 빨갛게 표시됩니다.'
        : '문장을 정확히 다 치면 다음으로 넘어갑니다. 폰에서도 되지만 키보드가 있는 편이 훨씬 편합니다.');
    ui.msg = el('div', 'bt-msg');
    ui.from = el('div', 'bt-from');

    var rank = el('div', 'bt-rank');
    var rh = el('div', 'bt-rankhead');
    rh.appendChild(el('span', 'bt-ranktitle', '순위표'));
    ui.rtabs = el('div', 'bt-rtabs');
    ORDER.forEach(function (k) {
      var b = el('button', '', LEVELS[k].name);
      b.type = 'button'; b.dataset.level = k;
      b.addEventListener('click', function () {
        state.rankLevel = k; renderRankTabs(); loadRank();
      });
      ui.rtabs.appendChild(b);
    });
    rh.appendChild(ui.rtabs);
    ui.mybest = el('div', 'bt-mybest', '');
    rh.appendChild(ui.mybest);
    rank.appendChild(rh);
    ui.rankBody = el('div');
    rank.appendChild(ui.rankBody);
    ui.note = el('div', 'bt-note', '');
    rank.appendChild(ui.note);

    root.appendChild(top);
    root.appendChild(hud);
    root.appendChild(ui.loading);
    root.appendChild(ui.stage);
    root.appendChild(ui.help);
    root.appendChild(ui.msg);
    root.appendChild(ui.from);
    root.appendChild(rank);
  })();

  /* ================================================================ 화면 */

  function target() {
    var s = state.sentences[state.idx];
    return s ? s.s : '';
  }

  function paint() {
    var t = target(), typed = ui.input.value;
    ui.line.textContent = '';
    for (var i = 0; i < t.length; i++) {
      var cls;
      if (i < typed.length) {
        // ⚠️ 한글은 조합 중(ㅎ→하→한)에도 값이 들어온다.
        //    마지막 글자를 바로 '틀림'으로 칠하면 칠 때마다 빨갛게 깜빡인다 → 판정을 미룬다.
        if (state.composing && i === typed.length - 1) cls = 'cur';
        else cls = (typed[i] === t[i]) ? 'ok' : 'bad';
      } else if (i === typed.length) {
        cls = 'cur';
      } else {
        cls = 'rest';
      }
      var b = el('b', cls, t[i]);
      ui.line.appendChild(b);
    }
    updateHud();
  }

  function updateHud() {
    var n = LEVELS[state.level].n;
    ui.prog.textContent = state.idx + ' / ' + n;
    var el2 = Date.now() - state.t0;
    if (state.started && el2 > 400) {
      var done = 0;
      for (var i = 0; i < state.idx; i++) done += strokes(state.sentences[i].s);
      done += strokes(ui.input.value);
      ui.cpm.textContent = String(Math.round(done / (el2 / 60000)));
    }
    var tot = state.typedOk + state.typos;
    ui.acc.textContent = tot ? Math.round(state.typedOk / tot * 100) + '%' : '100%';
  }

  function startTimer() {
    state.t0 = Date.now();
    state.timer = setInterval(function () {
      ui.clock.textContent = fmtMs(Date.now() - state.t0);
      updateHud();
    }, 300);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  /* ================================================================ 입력 */

  ui.input.addEventListener('compositionstart', function () { state.composing = true; });
  ui.input.addEventListener('compositionend', function () {
    state.composing = false;
    handleInput();
  });
  ui.input.addEventListener('input', function () {
    if (state.composing) { paint(); return; }   // 조합 중엔 칠하기만
    handleInput();
  });

  var lastLen = 0;
  function handleInput() {
    if (state.over || state.loading || !state.sentences.length) return;
    var t = target(), v = ui.input.value;
    if (!state.started && v.length) { state.started = true; startTimer(); }

    // 새로 들어온 글자만 맞았는지 센다(지웠다 다시 치는 건 중복으로 안 센다)
    if (v.length > lastLen) {
      for (var i = lastLen; i < v.length; i++) {
        if (v[i] === t[i]) state.typedOk++;
        else state.typos++;
      }
    }
    lastLen = v.length;

    paint();

    if (v === t) {
      state.idx++;
      ui.input.value = '';
      lastLen = 0;
      if (state.idx >= state.sentences.length) { finish(); return; }
      paint();
    }
  }

  function finish() {
    state.over = true;
    stopTimer();
    state.finalMs = Date.now() - state.t0;
    ui.clock.textContent = fmtMs(state.finalMs);
    ui.input.disabled = true;
    // 빈 박스만 남으면 허전하다 — 끝났다는 걸 그 자리에 적는다
    ui.line.textContent = '';
    ui.line.appendChild(el('b', 'ok', '다 쳤습니다. '));
    ui.line.appendChild(el('b', 'rest', '「새 문장」을 누르면 다른 문장으로 다시 할 수 있습니다.'));
    ui.prog.textContent = state.sentences.length + ' / ' + state.sentences.length;
    var total = 0;
    for (var i = 0; i < state.sentences.length; i++) total += strokes(state.sentences[i].s);
    state.cpm = Math.round(total / (state.finalMs / 60000));
    ui.cpm.textContent = String(state.cpm);
    var isBest = saveBest(state.level, state.finalMs);
    renderMyBest();
    showFrom();
    showWin(isBest);
  }

  function showFrom() {
    ui.from.textContent = '';
    var seen = {}, links = [];
    state.sentences.forEach(function (s) {
      if (s.t && !seen[s.t]) { seen[s.t] = 1; links.push(s); }
    });
    if (!links.length) return;
    ui.from.appendChild(document.createTextNode('방금 친 문장은 '));
    links.forEach(function (s, i) {
      var a = el('a', '', '「' + s.t + '」');
      a.href = s.l; a.target = '_top'; a.rel = 'noopener';
      ui.from.appendChild(a);
      if (i < links.length - 1) ui.from.appendChild(document.createTextNode(', '));
    });
    ui.from.appendChild(document.createTextNode(' 에서 나왔습니다.'));
  }

  /* ================================================================ 결과 */

  function showMsg(text) {
    ui.msg.className = 'bt-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bt-msgt', text));
  }

  function head() {
    var tot = state.typedOk + state.typos;
    var acc = tot ? Math.round(state.typedOk / tot * 100) : 100;
    return LEVELS[state.level].name + ' ' + fmtMs(state.finalMs) +
      ' · ' + state.cpm + '타/분 · 정확도 ' + acc + '%';
  }

  function showWin(isBest) {
    ui.msg.className = 'bt-msg win';
    ui.msg.textContent = '';
    ui.msg.appendChild(el('span', 'bt-msgt', head() + (isBest ? ' — 내 최고기록!' : '')));

    if (!state.sid) {
      ui.msg.appendChild(el('span', 'bt-mybest', '순위 서버에 연결되지 않아 기록만 저장했습니다.'));
      return;
    }
    var input2 = el('input');
    input2.type = 'text'; input2.maxLength = 12; input2.placeholder = '이름';
    input2.value = lsGet(LS_NICK, '');
    var btn = el('button', 'bt-btn', '순위 올리기');
    btn.type = 'button';

    function send() {
      var nick = (input2.value || '').trim();
      if (!nick) { input2.focus(); return; }
      if (state.submitted) return;
      state.submitted = true;
      lsSet(LS_NICK, nick);
      btn.disabled = true; btn.textContent = '올리는 중…';
      api('POST', '/api/submit', {
        sid: state.sid, nick: nick, ms: state.finalMs, clicks: state.typedOk + state.typos
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
      below_world_record: '사람이 칠 수 없는 속도라 등록되지 않았습니다.',
      session_used: '이미 올린 기록입니다.',
      session_expired: '문장을 받은 지 너무 오래되어 등록되지 않았습니다.',
      no_session: '순위 등록 정보가 없어 올리지 못했습니다.',
      too_many: '잠시 후에 다시 시도해 주세요.',
      too_slow: '너무 오래 걸려서 등록되지 않았습니다.',
      bad_nick: '이름을 확인해 주세요.'
    };
    return m[code] || '순위에 올리지 못했습니다.';
  }

  /* ================================================================ 진행 */

  function newGame() {
    if (state.loading) return;
    stopTimer();
    state.started = false; state.over = false; state.submitted = false;
    state.idx = 0; state.typedOk = 0; state.typos = 0; state.finalMs = 0;
    state.composing = false; lastLen = 0;
    ui.input.value = ''; ui.input.disabled = false;
    ui.clock.textContent = '0:00'; ui.cpm.textContent = '0'; ui.acc.textContent = '100%';
    ui.msg.className = 'bt-msg'; ui.msg.textContent = '';
    ui.from.textContent = '';
    ui.line.textContent = '';
    renderMyBest();

    state.loading = true;
    ui.loading.style.display = '';
    ui.stage.style.display = 'none';

    api('POST', '/api/start', { game: GAME, level: state.level })
      .then(function (j) {
        state.loading = false;
        if (!j || !j.ok || !j.sentences || !j.sentences.length) {
          ui.loading.textContent = '문장을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
          return;
        }
        state.sid = j.sid; state.seed = j.seed; state.sentences = j.sentences;
        ui.loading.style.display = 'none';
        ui.stage.style.display = '';
        paint();
        // 폰에서 자동으로 포커스하면 키보드가 불쑥 올라온다 — 마우스 쓰는 화면에서만
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          try { ui.input.focus({ preventScroll: true }); } catch (e) { ui.input.focus(); }
        }
      })
      .catch(function () {
        state.loading = false;
        ui.loading.textContent = '순위 서버에 연결하지 못해 문장을 받지 못했습니다.';
      });
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
    var t = el('table', 'bt-table');
    var thead = el('thead'), tr = el('tr');
    ['#', '이름', '기록'].forEach(function (h, k) {
      tr.appendChild(el('th', k === 2 ? 'bt-t' : (k === 0 ? 'bt-r' : 'bt-n'), h));
    });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    j.rows.forEach(function (r) {
      var row = el('tr');
      if (me && r.nick === me) row.className = 'me';
      row.appendChild(el('td', 'bt-r', String(r.rank)));
      row.appendChild(el('td', 'bt-n', r.nick));
      row.appendChild(el('td', 'bt-t', fmtMs(r.ms)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    ui.rankBody.appendChild(t);
    ui.note.textContent = '전체 ' + j.total + '판 기록 중 상위 ' + j.rows.length +
      '명 · 사람마다 최고기록 한 줄 · 문장 길이는 서버가 비슷하게 맞춰 줍니다';
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
  newGame();

  root.dataset.version = VERSION;
})();
