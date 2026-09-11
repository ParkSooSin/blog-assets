/*!
 * 카곰의 얼룩덜룩 — UML 스튜디오 (클라이언트 전용)
 * - 문서는 이 브라우저(IndexedDB)에만 저장됩니다. 서버 전송 없음.
 * - 렌더: mermaid@11 (jsDelivr CDN, 브라우저에서 직접)
 *         PlantUML (공식 서버 plantuml.com /~h hex 인코딩, CORS *)
 * - 소스 편집: CodeMirror 5 (jsDelivr CDN, 실패 시 순수 textarea 폴백)
 * - 블로그 테마 오염 방지: 모든 셀렉터·id를 #buml-app 스코프로 한정
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';
  var MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';
  var CM_BASE = 'https://cdn.jsdelivr.net/npm/codemirror@5.65.18/';
  var PU_URL = 'https://www.plantuml.com/plantuml';
  var RENDER_DEBOUNCE = 500;
  var SAVE_DEBOUNCE = 700;

  var root = document.getElementById('buml-app');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';

  /* ---------- 아주 작은 IndexedDB 래퍼 ---------- */
  var DB_NAME = 'blog-uml', STORE = 'docs';
  var dbAvailable = true;
  var dbp = new Promise(function (resolve) {
    try {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = req.onblocked = function () { dbAvailable = false; resolve(null); };
    } catch (e) { dbAvailable = false; resolve(null); }
  });

  function tx(mode, fn) {
    return dbp.then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function dbAll() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (rows) {
      return (rows || []).sort(function (a, b) { return b.updated - a.updated; });
    });
  }
  function dbPut(doc) {
    return tx('readwrite', function (s) { s.put(doc); return doc; });
  }
  function dbDel(id) {
    return tx('readwrite', function (s) { s.delete(id); });
  }

  /* ---------- 상태 ---------- */
  var current = null;      // {id,title,source,lang,updated} — lang: 'mermaid' | 'plantuml'
  var lastSvg = '';        // 마지막 성공 렌더 SVG 문자열
  var mermaidReady = null; // Promise<mermaid>
  var cm = null;           // CodeMirror 인스턴스 (로드 전/실패 시 null → textarea 폴백)
  var cmReady = null;      // Promise<CodeMirror>
  var cmQuiet = false;      // setValue 등 프로그램 변경 시 change 이벤트 무시
  var renderTimer = 0, saveTimer = 0;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function curLang() { return (current && current.lang) || 'mermaid'; }

  /* 소스값 접근 — CodeMirror 있으면 경유, 없으면 textarea 폴백 */
  function srcGet() { return cm ? cm.getValue() : srcEl.value; }
  function srcSet(v) {
    if (cm) {
      cmQuiet = true;
      try { cm.setValue(v); } finally { cmQuiet = false; }
    } else srcEl.value = v;
  }

  /* ---------- PlantUML 인코딩 ---------- */
  /* 공식 서버 ~h 헤더: UTF-8 바이트를 hex로 주면 deflate/base64 없이 그려준다 */
  function puUrl(fmt, src) {
    var b = new TextEncoder().encode(src), hex = '';
    for (var i = 0; i < b.length; i++) hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return PU_URL + '/' + fmt + '/~h' + hex;
  }

  /* ---------- 스킨 ---------- */
  var css = [
    '#buml-app{--bu-ink:#6a7a52;--bu-line:#dcdcd4;--bu-line2:#e9e9e2;--bu-text:#2b2b28;--bu-dim:#8a8a80;--bu-bg:#ffffff;--bu-bar:#f6f6f2;',
    '  box-sizing:border-box;display:block;margin:18px 0;',
    '  font-family:ui-sans-serif,"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;',
    '  color:var(--bu-text);line-height:1.5;text-align:left;}',
    '#buml-app *,#buml-app *::before,#buml-app *::after{box-sizing:border-box;}',
    '#buml-app button,#buml-app input,#buml-app textarea{font:inherit;color:inherit;margin:0;}',
    '#buml-app button{cursor:pointer;background:none;border:none;padding:0;}',
    '#buml-app .buml{border:1px solid var(--bu-line);background:var(--bu-bg);border-radius:6px;overflow:hidden;',
    '  min-height:clamp(560px,calc(100vh - 260px),1080px);height:auto;display:flex;flex-direction:column;}', /* 렌더가 길면 위젯 전체가 세로로 늘어난다(형 요청) — height 고정이 렌더 잘림의 원인 */
    '#buml-app .buml-top{display:flex;align-items:center;gap:8px;padding:8px 12px;',
    '  background:var(--bu-bar);border-bottom:1px solid var(--bu-line);flex:0 0 auto;}',
    '#buml-app .bu-brand{font-weight:700;font-size:15px;letter-spacing:.02em;white-space:nowrap;}',
    '#buml-app .bu-brand .bu-sub{font-weight:400;color:var(--bu-dim);font-size:12px;margin-left:6px;}',
    '#buml-app .bu-title{flex:1;min-width:60px;}',
    '#buml-app .bu-title input{width:100%;border:1px solid transparent;background:transparent;',
    '  padding:5px 8px;border-radius:4px;font-size:14px;}',
    '#buml-app .bu-title input:hover{border-color:var(--bu-line2);}',
    '#buml-app .bu-title input:focus{outline:none;border-color:var(--bu-ink);background:#fff;}',
    '#buml-app .bu-status{font-size:12px;color:var(--bu-dim);white-space:nowrap;}',
    '#buml-app .bu-lang{border:1px solid var(--bu-line);background:#fff;border-radius:4px;',
    '  padding:4px 6px;font-size:12px;color:var(--bu-text);flex:0 0 auto;}',
    '#buml-app .bu-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--bu-line);',
    '  background:#fff;border-radius:4px;padding:5px 10px;font-size:13px;white-space:nowrap;}',
    '#buml-app .bu-btn:hover{border-color:var(--bu-ink);color:var(--bu-ink);}',
    '#buml-app .bu-btn.bu-primary{background:var(--bu-ink);border-color:var(--bu-ink);color:#fff;}',
    '#buml-app .bu-btn.bu-primary:hover{opacity:.88;color:#fff;}',
    '#buml-app .bu-iconbtn{border:1px solid var(--bu-line);background:#fff;border-radius:4px;',
    '  width:30px;height:28px;display:none;align-items:center;justify-content:center;font-size:14px;}',
    '#buml-app .buml-body{flex:1;display:flex;min-height:0;position:relative;}',
    '#buml-app .bu-side{flex:0 0 216px;border-right:1px solid var(--bu-line);display:flex;flex-direction:column;min-height:0;background:#fbfbf9;}',
    '#buml-app .bu-side-head{padding:9px 12px 5px;font-size:11px;font-weight:700;letter-spacing:.08em;',
    '  color:var(--bu-dim);text-transform:uppercase;flex:0 0 auto;}',
    '#buml-app .bu-list{list-style:none;margin:0;padding:0 6px 6px;overflow-y:auto;flex:1;min-height:0;}',
    '#buml-app .bu-list li{position:relative;margin:2px 0;}',
    '#buml-app .bu-list button.bu-open{display:block;width:100%;text-align:left;padding:7px 26px 7px 9px;',
    '  border-radius:4px;font-size:13px;color:var(--bu-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#buml-app .bu-list li.on button.bu-open{background:var(--bu-ink);color:#fff;}',
    '#buml-app .bu-list li:not(.on) button.bu-open:hover{background:#efefea;}',
    '#buml-app .bu-list .bu-date{display:block;font-size:11px;color:var(--bu-dim);margin-top:1px;}',
    '#buml-app .bu-list li.on .bu-date{color:rgba(255,255,255,.75);}',
    '#buml-app .bu-list .bu-del{position:absolute;right:4px;top:50%;transform:translateY(-50%);',
    '  width:20px;height:20px;border-radius:4px;color:var(--bu-dim);font-size:12px;line-height:1;opacity:0;}',
    '#buml-app .bu-list li:hover .bu-del{opacity:1;}',
    '#buml-app .bu-list .bu-del:hover{color:#b4423a;background:rgba(180,66,58,.09);}',
    '#buml-app .bu-list li.on .bu-del{color:rgba(255,255,255,.8);}',
    '#buml-app .bu-side-foot{flex:0 0 auto;padding:8px 12px;border-top:1px solid var(--bu-line2);',
    '  font-size:11px;color:var(--bu-dim);line-height:1.45;}',
    '#buml-app .bu-empty{padding:20px 12px;text-align:center;color:var(--bu-dim);font-size:13px;}',
    '#buml-app .bu-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}',
    '#buml-app .bu-viewtabs{display:none;flex:0 0 auto;gap:0;padding:6px 8px;border-bottom:1px solid var(--bu-line);background:#fbfbf9;}',
    '#buml-app .bu-viewtabs button{flex:1;padding:7px 0;font-size:13px;color:var(--bu-dim);}',
    '#buml-app .bu-viewtabs button.on{color:var(--bu-ink);font-weight:700;box-shadow:inset 0 -2px 0 var(--bu-ink);}',
    '#buml-app .bu-panes{flex:1;display:flex;flex-direction:column;min-height:0;}', /* 세로 스택: 코드 위 · 렌더 아래(형 요청, 렌더를 크게) */
    '#buml-app .bu-pane-src{flex:0 0 auto;height:clamp(200px,32vh,420px);display:flex;min-width:0;min-height:0;border-bottom:1px solid var(--bu-line);}', /* 코드창은 고정 높이(내부 CodeMirror 스크롤) — 위젯이 auto 높이라 % basis는 불안정 */
    '#buml-app .bu-src,#buml-app .bu-pane-src .CodeMirror{flex:1;width:100%;border:none;outline:none;padding:12px;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;',
    '  font-size:13px;line-height:1.55;color:var(--bu-text);background:#fff;tab-size:2;}',
    '#buml-app .bu-pane-src .CodeMirror{height:100%;position:relative;overflow:hidden;}', /* overflow:hidden 없으면 내부 input textarea(1000px)가 문서를 민다 */
    '#buml-app .bu-pane-src .CodeMirror-scroll{overflow:scroll !important;margin-bottom:-50px;margin-right:-50px;padding-bottom:50px;height:100%;outline:none;position:relative;}',
    /* CodeMirror 기본 청크(프론트 기본 CSS 대신 최소 필요분 — 테마 오염 차단) */
    '#buml-app .bu-pane-src .CodeMirror-lines{padding:0;}',
    '#buml-app .bu-pane-src .CodeMirror pre.CodeMirror-line,#buml-app .bu-pane-src .CodeMirror pre.CodeMirror-line-like{padding:0;border:0;}',
    '#buml-app .bu-pane-src .CodeMirror-selected{background:#e8ebe9;}',
    '#buml-app .bu-pane-src .CodeMirror-focused .CodeMirror-selected{background:#dde3e0;}',
    '#buml-app .bu-pane-src .CodeMirror-cursor{border-left:1.5px solid var(--bu-text);}',
    /* 토큰 색 — 하우스 뮤트 팔레트(원색 금지) */
    '#buml-app .bu-pane-src .cm-meta{color:#8a8f98;font-style:italic;}',
    '#buml-app .bu-pane-src .cm-keyword{color:#4a6f64;font-weight:600;}',
    '#buml-app .bu-pane-src .cm-string{color:#8a6d3b;}',
    '#buml-app .bu-pane-src .cm-operator{color:#a5654e;}',
    '#buml-app .bu-pane-src .cm-comment{color:#a4aab0;font-style:italic;}',
    '#buml-app .bu-pane-src .cm-variable-2{color:#5d5f9c;}',
    '#buml-app .bu-pane-src .CodeMirror-empty{color:var(--bu-dim);}',
    '#buml-app .bu-pane-src .CodeMirror-empty::before{color:var(--bu-dim);}',
    '#buml-app .bu-pane-prev{flex:1;display:flex;flex-direction:column;min-width:0;min-height:340px;}', /* 렌더 최소 높이 보장, 그 이상은 콘텐츠만큼 */
    '#buml-app .bu-prevbar{flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:7px 10px;',
    '  border-bottom:1px solid var(--bu-line2);background:#fbfbf9;}',
    '#buml-app .bu-prevbar .bu-btn{padding:3px 8px;font-size:12px;}',
    '#buml-app .bu-stage{overflow-x:auto;padding:16px;display:flex;align-items:flex-start;}', /* 세로는 콘텐츠만큼(부모가 함께 늘어남), 가로만 스크롤(형 요청). justify-content:center는 넘칠 때 양쪽이 잘리고 왼쪽 끝은 스크롤로도 도달 불가 */
    /* PlantUML SVG는 preserveAspectRatio="none" + 인라인 px라 !important로 비율 보정.
       가로는 원본 크기 유지 — 넘치면 stage 가로 스크롤(형 요청, 축소하지 않는다) */
    '#buml-app .bu-stage svg{max-width:none;height:auto !important;flex:0 0 auto;margin:0 auto;}', /* flex-shrink:1 기본값이 svg를 컨테이너 폭으로 눌렀다. margin auto=남는 폭만 가운데(넘칠 땐 0) */
    '#buml-app .bu-stage::-webkit-scrollbar{height:8px;}',
    '#buml-app .bu-stage::-webkit-scrollbar-thumb{background:var(--bu-line2);border-radius:4px;}', /* 가로 스크롤 존재가 보이게(형 요청) */
    '#buml-app .bu-stage .bu-ph{color:var(--bu-dim);font-size:13px;text-align:center;margin:auto;line-height:2;}',
    '#buml-app .bu-error{margin:12px;border:1px solid #e3c3bf;background:#faf3f2;color:#9c3f36;',
    '  border-radius:4px;padding:10px 12px;font-size:12px;white-space:pre-wrap;word-break:break-word;}',
    '#buml-app .bu-backdrop{display:none;}',
    '#buml-app .bu-banner{margin:0;padding:7px 12px;background:#fdf6e3;border-bottom:1px solid #eadfc0;',
    '  color:#7a6a35;font-size:12px;flex:0 0 auto;}',
    /* 모바일 */
    '@media (max-width:820px){',
    '  #buml-app .buml{height:clamp(460px,calc(100vh - 200px),900px);min-height:0;}', /* 모바일은 기존 고정 높이 유지(탭 전환) */
    '  #buml-app .bu-menu{display:inline-flex;}',
    '  #buml-app .bu-brand .bu-sub{display:none;}',
    '  #buml-app .bu-brand{font-size:13px;}',
    '  #buml-app .bu-lang{font-size:11px;padding:3px 4px;}',
    '  #buml-app .bu-status{display:none;}',
    '  #buml-app .buml-top .bu-btn .bu-btxt{display:none;}',
    '  #buml-app .buml-top .bu-btn{padding:5px 8px;}',
    '  #buml-app .bu-side{position:absolute;top:0;left:0;bottom:0;width:min(280px,78%);z-index:6;',
    '    background:#fbfbf9;transform:translateX(-100%);transition:transform .18s ease;box-shadow:none;}',
    '  #buml-app .buml.side-open .bu-side{transform:none;box-shadow:2px 0 14px rgba(0,0,0,.18);}',
    '  #buml-app .bu-backdrop{display:block;position:absolute;inset:0;background:rgba(0,0,0,.35);z-index:5;opacity:0;pointer-events:none;transition:opacity .18s;}',
    '  #buml-app .buml.side-open .bu-backdrop{opacity:1;pointer-events:auto;}',
    '  #buml-app .bu-viewtabs{display:flex;}',
    '  #buml-app .bu-pane-src{border-bottom:none;height:auto;}', /* 모바일은 탭 전환 — 구분선·고정 높이 리셋(flex-basis:100%이 지배) */
    '  #buml-app .bu-pane-src,#buml-app .bu-pane-prev{display:none;flex-basis:100%;}',
    '  #buml-app .bu-stage{overflow-x:hidden;overflow-y:auto;}',
    '  #buml-app .bu-stage svg{max-width:100%;}', /* 폰은 가로 스크롤 대신 등비 축소 유지 */
    '  #buml-app .buml[data-view="src"] .bu-pane-src{display:flex;}',
    '  #buml-app .buml[data-view="prev"] .bu-pane-prev{display:flex;}',
    '  #buml-app .bu-src,#buml-app .bu-pane-src .CodeMirror{font-size:16px;}', /* iOS 포커스 줌 방지 */
    '  #buml-app .bu-stage{padding:10px;}',
    '}'
  ].join('\n');
  var styleEl = document.createElement('style');
  styleEl.id = 'buml-style';
  styleEl.textContent = css;
  root.appendChild(styleEl);

  /* ---------- 마크업 ---------- */
  root.insertAdjacentHTML('beforeend',
    '<div class="buml" data-view="src">' +
    '  <div class="bu-banner" id="buml-banner" hidden></div>' +
    '  <div class="buml-top">' +
    '    <button class="bu-btn bu-menu" id="buml-menu" aria-label="문서 목록">☰</button>' +
    '    <span class="bu-brand">UML 스튜디오<span class="bu-sub">mermaid · PlantUML · 브라우저에 저장</span></span>' +
    '    <span class="bu-title"><input id="buml-title" placeholder="무제 다이어그램" maxlength="80"></span>' +
    '    <select class="bu-lang" id="buml-lang" title="다이어그램 문법">' +
    '      <option value="mermaid">mermaid</option>' +
    '      <option value="plantuml">PlantUML</option>' +
    '    </select>' +
    '    <span class="bu-status" id="buml-status"></span>' +
    '    <button class="bu-btn" id="buml-import" title="파일 가져오기">⬆<span class="bu-btxt">가져오기</span></button>' +
    '    <button class="bu-btn bu-primary" id="buml-new">＋<span class="bu-btxt">새 문서</span></button>' +
    '    <input type="file" id="buml-file" accept=".mmd,.mermaid,.puml,.txt" hidden multiple>' +
    '  </div>' +
    '  <div class="buml-body">' +
    '    <div class="bu-backdrop" id="buml-backdrop"></div>' +
    '    <aside class="bu-side">' +
    '      <div class="bu-side-head">내 다이어그램</div>' +
    '      <ul class="bu-list" id="buml-list"></ul>' +
    '      <div class="bu-side-foot">⚠️ 문서는 <b>이 브라우저에만</b> 저장됩니다. 기기 초기화 전에는 내려받기로 백업하세요.<br>PlantUML은 공식 서버(plantuml.com)에서 그립니다.</div>' +
    '    </aside>' +
    '    <main class="bu-main">' +
    '      <div class="bu-viewtabs">' +
    '        <button data-v="src" class="on">소스</button>' +
    '        <button data-v="prev">미리보기</button>' +
    '      </div>' +
    '      <div class="bu-panes">' +
    '        <div class="bu-pane-src"><textarea id="buml-src" class="bu-src" spellcheck="false" ' +
    '          placeholder="flowchart TD&#10;  A[시작] --> B{분기}&#10;  B -->|예| C[끝]&#10;  B -->|아니오| A"></textarea></div>' +
    '        <div class="bu-pane-prev">' +
    '          <div class="bu-prevbar">' +
    '            <button class="bu-btn" id="buml-png">PNG</button>' +
    '            <button class="bu-btn" id="buml-svgcopy">SVG 복사</button>' +
    '            <button class="bu-btn" id="buml-mmd" title="mermaid 소스 내려받기">mmd</button>' +
    '            <button class="bu-btn" id="buml-tab" title="새 탭에 크게">↗</button>' +
    '          </div>' +
    '          <div class="bu-stage" id="buml-stage"><div class="bu-ph">미리보기가 여기에 나타납니다</div></div>' +
    '        </div>' +
    '      </div>' +
    '    </main>' +
    '  </div>' +
    '</div>');

  var $ = function (id) { return document.getElementById(id); };
  var shell = root.querySelector('.buml');
  var srcEl = $('buml-src'); // 원본 textarea (CodeMirror가 대체, 실패 시 폴백)
  var elList = $('buml-list'), elStage = $('buml-stage'),
      elTitle = $('buml-title'), elStatus = $('buml-status'), elBanner = $('buml-banner'),
      elLang = $('buml-lang'), elMmd = $('buml-mmd');

  function banner(msg) {
    if (!msg) { elBanner.hidden = true; return; }
    elBanner.hidden = false;
    elBanner.textContent = msg;
  }

  /* ---------- mermaid 로드 ---------- */
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = import(MERMAID_URL).then(function (m) {
      var mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        fontFamily: 'ui-sans-serif,"Noto Sans KR",system-ui,sans-serif'
      });
      return mermaid;
    }).catch(function (e) {
      mermaidReady = null;
      throw e;
    });
    return mermaidReady;
  }

  /* ---------- CodeMirror 로드 (실패 시 textarea 폴백) ---------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('load fail ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }
  function defineModes(CodeMirror) {
    /* mermaid — 화살표는 operator, [노드]{라벨}은 string, %% 주석 */
    CodeMirror.defineSimpleMode('bumlmermaid', {
      start: [
        { regex: /%%.*$/, token: 'comment' },
        { regex: /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|quadrantChart|subgraph|end|direction|participant|actor|activate|deactivate|note|over|loop|par|alt|else|opt|class|style|click|linkStyle|default)\b/, token: 'keyword' },
        { regex: /(-{2,}>|->>|-->|-\.->|==>|<-{2,}|-{3}|-{2}\|)/, token: 'operator' },
        { regex: /[\[{(]/, token: 'string', next: 'nodelabel' },
        { regex: /\|/, token: 'string', next: 'nodelabel' },
        { regex: /"/, token: 'string', next: 'qstring' },
        { regex: /"[^"]*"/, token: 'string' }
      ],
      nodelabel: [
        { regex: /[\]})]/, token: 'string', next: 'start' },
        { regex: /\|/, token: 'string', next: 'start' },
        { regex: /./, token: 'string' }
      ],
      qstring: [
        { regex: /"/, token: 'string', next: 'start' },
        { regex: /./, token: 'string' }
      ],
      meta: {}
    });
    /* PlantUML — @start/end meta, ' 주석, 키워드, 화살표 */
    CodeMirror.defineSimpleMode('bumlpuml', {
      start: [
        { regex: /@start\w*|@end\w*/, token: 'meta' },
        { regex: /'.*$/, token: 'comment' },
        { regex: /"/, token: 'string', next: 'qstring' },
        { regex: /\b(participant|actor|usecase|usecaseactor|boundary|control|entity|database|collections|queue|interface|enum|class|abstract|annotation|state|object|component|package|node|folder|frame|cloud|database|artifact|storage|rectangle|circle|diamond|note|title|caption|header|footer|legend|skinparam|skin|hide|show|start|stop|if|else|elseif|endif|else|switch|case|endswitch|while|endwhile|repeat|fork|forkagain|split|splitagain|endfork|endsplit|backward|kill|detach|autonumber|activate|deactivate|newpage|group|end|ref|return|label|is|goto|allowsplay|archimate|mindmap|gantt|salt|wbs|wire|monkey|yaml|json|creole|dot|math|latex|clock|chrono|timing|files|footer|mute|spin|rotation|scale|rotate|mainframe|allowsplayout|as|of|to|over|order|create|destroy|delay|duration)\b/, token: 'keyword' },
        { regex: /(-?-{2,}>|<-{2,}?|-*\*-*|-*o-*>?|-\.->|-d+->|==>|--\||:\||=>?)/, token: 'operator' },
        { regex: /:/, token: 'operator' }
      ],
      qstring: [
        { regex: /"/, token: 'string', next: 'start' },
        { regex: /./, token: 'string' }
      ],
      meta: {}
    });
  }
  function loadCm() {
    if (cmReady) return cmReady;
    /* 순차 로드 필수 — 애드온이 코어보다 먼저 실행되면 CodeMirror is not defined (병렬은 레이스) */
    cmReady = loadScript(CM_BASE + 'lib/codemirror.min.js')
      .then(function () { return loadScript(CM_BASE + 'addon/mode/simple.min.js'); })
      .then(function () { return loadScript(CM_BASE + 'addon/display/placeholder.min.js'); })
      .then(function () {
      loadCss(CM_BASE + 'lib/codemirror.min.css');
      defineModes(CodeMirror);
      cm = CodeMirror.fromTextArea(srcEl, {
        mode: curLang() === 'plantuml' ? 'bumlpuml' : 'bumlmermaid',
        lineWrapping: true,
        indentUnit: 2,
        tabSize: 2,
        placeholder: srcEl.getAttribute('placeholder') || '',
        extraKeys: { /* Tab은 기존 동작 유지: 들여쓰기 2칸 */
          'Tab': function (ed) { ed.replaceSelection('  '); }
        }
      });
      cm.on('change', function () {
        if (cmQuiet) return;
        scheduleRender(); scheduleSave();
      });
      srcEl.style.display = 'none'; /* 원본 textarea는 fromTextArea 가 숨기지 않는다 — 폴백 시엔 안 숨겨짐 */
      return cm;
    }).catch(function (e) {
      cmReady = null; /* 다음 호출에서 재시도 */
      if (window.console && console.warn) console.warn('CodeMirror 로드 실패, textarea 폴백', e);
    });
    return cmReady;
  }

  /* ---------- 렌더 ---------- */
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, RENDER_DEBOUNCE);
  }

  var renderSeq = 0;
  function renderNow() {
    var src = srcGet().trim();
    if (!current) return;
    if (!src) {
      lastSvg = '';
      elStage.innerHTML = '<div class="bu-ph">소스를 입력하세요</div>';
      return;
    }
    var seq = ++renderSeq;
    if (curLang() === 'plantuml') { renderPlantUml(seq, src); return; }
    loadMermaid().then(function (mermaid) {
      return mermaid.render('buml-svg-' + Date.now(), src);
    }).then(function (out) {
      if (seq !== renderSeq) return; // 최신 입력만 반영
      lastSvg = out.svg;
      elStage.innerHTML = lastSvg;
      /* mermaid svg는 width 속성이 없어 intrinsic 폭이 없다 → auto 가 shrink-to-fit(컨테이너 폭)이 된다.
         viewBox 폭을 명시해 원본 크기로(형 요청: 가로는 축소 대신 stage 스크롤). 모바일은 CSS max-width:100%가 다시 축소 */
      var ms = elStage.querySelector('svg');
      if (ms) {
        ms.style.width = ''; ms.removeAttribute('width');
        ms.style.maxWidth = ''; /* mermaid 인라인 max-width(=원본 폭)가 CSS max-width:100%(모바일 축소)를 이겨버린다 */
        var vb = (ms.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
        if (vb.length === 4 && parseFloat(vb[2]) > 0) ms.style.width = vb[2] + 'px';
      }
    }).catch(function (e) {
      if (seq !== renderSeq) return;
      lastSvg = '';
      var msg = (e && e.message) ? e.message : String(e);
      elStage.innerHTML = '<div class="bu-error">⚠️ ' + esc(msg) + '</div>';
    });
  }

  /* PlantUML: 공식 서버에서 SVG를 받아온다. CORS 는 * 로 열려 있음.
     문법 오류는 HTTP 200 + SVG 안 "Syntax Error" 텍스트로 온다. */
  function renderPlantUml(seq, src) {
    fetch(puUrl('svg', src)).then(function (r) {
      if (!r.ok) throw new Error('렌더 실패 (' + r.status + ') — 문법을 확인하세요');
      return r.text();
    }).then(function (text) {
      if (seq !== renderSeq) return;
      if (text.indexOf('Syntax Error') >= 0) {
        lastSvg = '';
        elStage.innerHTML = '<div class="bu-error">⚠️ PlantUML 문법 오류입니다. 소스를 확인하세요.</div>';
        return;
      }
      lastSvg = text;
      elStage.innerHTML = lastSvg;
    }).catch(function (e) {
      if (seq !== renderSeq) return;
      lastSvg = '';
      elStage.innerHTML = '<div class="bu-error">⚠️ ' + esc((e && e.message) || String(e)) + '</div>';
    });
  }

  /* ---------- 저장 ---------- */
  function scheduleSave() {
    setStatus('…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE);
  }
  function saveNow() {
    if (!current) return;
    current.source = srcGet();
    current.title = elTitle.value.trim();
    current.lang = elLang.value;
    current.updated = Date.now();
    dbPut(current).then(function () {
      if (!dbAvailable) return;
      setStatus('저장됨 ' + fmtTime(current.updated));
      refreshList();
    });
  }
  function setStatus(s) { elStatus.textContent = s; }

  /* 언어 UI를 current 에 맞춘다 (mmd 버튼 라벨 포함) */
  function syncLang() {
    var lang = curLang();
    elLang.value = lang;
    elMmd.textContent = lang === 'plantuml' ? 'puml' : 'mmd';
    elMmd.title = lang === 'plantuml' ? 'PlantUML 소스 내려받기' : 'mermaid 소스 내려받기';
    if (cm) cm.setOption('mode', lang === 'plantuml' ? 'bumlpuml' : 'bumlmermaid');
  }

  /* ---------- 문서 목록 ---------- */
  function refreshList() {
    return dbAll().then(function (docs) {
      elList.innerHTML = '';
      if (!docs.length) {
        elList.innerHTML = '<li class="bu-empty">아직 문서가 없습니다.<br>＋ 새 문서로 시작하세요.</li>';
        return;
      }
      docs.forEach(function (d) {
        var li = document.createElement('li');
        if (current && d.id === current.id) li.className = 'on';
        var date = new Date(d.updated);
        var md = (date.getMonth() + 1) + '/' + date.getDate();
        li.insertAdjacentHTML('beforeend',
          '<button class="bu-open" title="' + esc(d.title || '무제') + '">' +
          esc(d.title || '무제') + '<span class="bu-date">' + md + ' ' + fmtTime(d.updated) + '</span></button>' +
          '<button class="bu-del" title="삭제">✕</button>');
        li.querySelector('.bu-open').addEventListener('click', function () { openDoc(d.id); });
        li.querySelector('.bu-del').addEventListener('click', function () { delDoc(d.id); });
        elList.appendChild(li);
      });
    });
  }

  function openDoc(id) {
    return dbAll().then(function (docs) {
      var d = docs.filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      current = d;
      elTitle.value = d.title || '';
      srcSet(d.source || '');
      if (!d.lang) d.lang = 'mermaid'; // 옛 문서 기본값
      syncLang();
      lsSet('buml-last', d.id);
      closeSide();
      refreshList();
      renderNow();
    });
  }

  function starterFor(lang) {
    return lang === 'plantuml'
      ? '@startuml\nA -> B: 확인 요청\nactivate B\nB --> A: 응답 완료\ndeactivate B\n@enduml'
      : 'flowchart TD\n  A[시작] --> B{계속할까?}\n  B -- 예 --> C[끝]\n  B -- 아니오 --> A';
  }

  function newDoc(starter) {
    var lang = elLang.value || 'mermaid';
    current = {
      id: uid(),
      title: '',
      lang: lang,
      source: starter !== undefined ? starter : starterFor(lang),
      updated: Date.now()
    };
    elTitle.value = current.title;
    srcSet(current.source);
    syncLang();
    lsSet('buml-last', current.id);
    dbPut(current).then(refreshList);
    renderNow();
    elTitle.focus();
    return current;
  }

  function delDoc(id) {
    dbAll().then(function (docs) {
      var d = docs.filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      if (!window.confirm('「' + (d.title || '무제') + '」를 삭제할까요? 되돌릴 수 없습니다.')) return;
      dbDel(id).then(function () {
        if (current && current.id === id) {
          return dbAll().then(function (rest) {
            if (rest.length) openDoc(rest[0].id);
            else { current = null; elTitle.value = ''; srcSet(''); elStage.innerHTML = '<div class="bu-ph">좌측 ＋ 새 문서로 시작하세요</div>'; lastSvg = ''; refreshList(); }
          });
        }
        refreshList();
      });
    });
  }

  /* ---------- 내보내기 / 가져오기 ---------- */
  function download(name, mime, data) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }
  function docName(ext) {
    return (current && current.title ? current.title : 'diagram').replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
  }

  function exportPng() {
    if (!lastSvg) { setStatus('먼저 렌더하세요'); return; }
    if (curLang() === 'plantuml') {
      setStatus('PNG 생성 중…');
      fetch(puUrl('png', srcGet().trim())).then(function (r) {
        if (!r.ok) throw new Error('서버 응답 ' + r.status);
        return r.blob();
      }).then(function (blob) {
        download(docName('png'), 'image/png', blob);
        setStatus('저장됨 ' + fmtTime(Date.now()));
      }).catch(function () { setStatus('PNG 생성 실패'); });
      return;
    }
    var svg = elStage.querySelector('svg');
    if (!svg) return;
    var vb = (svg.getAttribute('viewBox') || '0 0 800 600').split(/[\s,]+/).map(Number);
    var w = parseFloat(svg.getAttribute('width')) || vb[2] || 800;
    var h = parseFloat(svg.getAttribute('height')) || vb[3] || 600;
    var xml = new XMLSerializer().serializeToString(svg);
    var img = new Image();
    img.onload = function () {
      var SCALE = 2;
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * SCALE));
      cv.height = Math.max(1, Math.round(h * SCALE));
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (blob) {
        if (blob) download(docName('png'), 'image/png', blob);
      }, 'image/png');
    };
    img.onerror = function () { setStatus('PNG 변환 실패'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  function copySvg() {
    if (!lastSvg) { setStatus('먼저 렌더하세요'); return; }
    var done = function () { setStatus('SVG 복사됨'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastSvg).then(done, function () { fallbackCopy(); });
    } else fallbackCopy();
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = lastSvg;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { setStatus('복사 실패'); }
      ta.remove();
    }
  }

  function openInTab() {
    if (!lastSvg) { setStatus('먼저 렌더하세요'); return; }
    var blob = new Blob([lastSvg], { type: 'image/svg+xml' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  function importFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    var chain = Promise.resolve();
    var lastId = null;
    arr.forEach(function (f) {
      chain = chain.then(function () {
        return f.text().then(function (text) {
          var lang = (/\.puml$/i.test(f.name) || /@start(uml|mindmap|gantt|salt)/i.test(text))
            ? 'plantuml' : 'mermaid';
          var doc = {
            id: uid(),
            title: f.name.replace(/\.(mmd|mermaid|puml|txt)$/i, ''),
            source: text,
            lang: lang,
            updated: Date.now()
          };
          lastId = doc.id;
          return dbPut(doc);
        });
      });
    });
    chain.then(function () {
      refreshList();
      if (lastId) openDoc(lastId);
      setStatus('가져오기 완료');
    });
  }

  /* ---------- 초기 샘플 ---------- */
  var SAMPLES = [
    {
      title: '예제 · 흐름도',
      source: 'flowchart TD\n' +
        '  A[주문 접수] --> B{재고 있음?}\n' +
        '  B -- 있음 --> C[결제 처리]\n' +
        '  B -- 없음 --> D[입고 알림 등록]\n' +
        '  C --> E[배송 시작]\n' +
        '  D --> E'
    },
    {
      title: '예제 · 시퀀스 다이어그램',
      source: 'sequenceDiagram\n' +
        '  autonumber\n' +
        '  actor U as 사용자\n' +
        '  participant A as 앱\n' +
        '  participant S as 서버\n' +
        '  U->>A: 버튼 탭\n' +
        '  A->>S: 요청 전송\n' +
        '  S-->>A: 응답\n' +
        '  A-->>U: 화면 갱신'
    },
    {
      title: '예제 · ERD',
      lang: 'mermaid',
      source: 'erDiagram\n' +
        '  CUSTOMER ||--o{ ORDER : 주문\n' +
        '  ORDER ||--|{ ORDER_ITEM : 포함\n' +
        '  PRODUCT ||--o{ ORDER_ITEM : "주문 상품"\n' +
        '  CUSTOMER {\n' +
        '    string name\n' +
        '    string email\n' +
        '  }\n' +
        '  ORDER {\n' +
        '    int status\n' +
        '    date created\n' +
        '  }'
    },
    {
      title: '예제 · PlantUML 클래스',
      lang: 'plantuml',
      source: '@startuml\n' +
        'skinparam shadowing false\n' +
        'class 주문 {\n' +
        '  +번호: int\n' +
        '  +상태: string\n' +
        '  +취소()\n' +
        '}\n' +
        'class 주문상품 {\n' +
        '  +수량: int\n' +
        '}\n' +
        'class 고객 {\n' +
        '  +이름: string\n' +
        '}\n' +
        '고객 "1" --> "*" 주문 : 발주\n' +
        '주문 "1" *--> "1..*" 주문상품 : 포함\n' +
        '@enduml'
    }
  ];
  function mkSampleDoc(s, i) {
    /* updated 역순 부여 — 목록에서 mermaid 예제가 먼저 오고 PlantUML 은 맨 아래 */
    return { id: uid(), title: s.title, lang: s.lang || 'mermaid', source: s.source, updated: Date.now() - i };
  }
  function seedIfEmpty() {
    return dbAll().then(function (docs) {
      if (docs.length || lsGet('buml-seeded')) return;
      var first = null;
      return Promise.all(SAMPLES.map(function (s, i) {
        var doc = mkSampleDoc(s, i);
        first = first || doc;
        return dbPut(doc);
      })).then(function () {
        lsSet('buml-seeded', '1');
        return dbAll().then(function (all) { return all[0] ? all[0].id : null; });
      });
    });
  }
  /* v1.1: PlantUML 예제를 이미 시딩된 브라우저에도 1회만 보충
     (문서를 전부 지운 브라우저는 살려두지 않는다 — 샘플 부활 방지) */
  function addPumlSampleOnce() {
    if (lsGet('buml-seeded2')) return Promise.resolve();
    return dbAll().then(function (docs) {
      var s = docs.length ? SAMPLES.filter(function (x) { return x.lang === 'plantuml'; })[0] : null;
      var p = s ? dbPut(mkSampleDoc(s, SAMPLES.length)) : Promise.resolve();
      return p.then(function () { lsSet('buml-seeded2', '1'); });
    });
  }

  /* ---------- 사이드바(모바일) ---------- */
  function closeSide() { shell.classList.remove('side-open'); }

  /* ---------- 이벤트 ---------- */
  srcEl.addEventListener('input', function () { scheduleRender(); scheduleSave(); });
  elTitle.addEventListener('input', scheduleSave);

  srcEl.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = srcEl.selectionStart, en = srcEl.selectionEnd;
      srcEl.value = srcEl.value.slice(0, s) + '  ' + srcEl.value.slice(en);
      srcEl.selectionStart = srcEl.selectionEnd = s + 2;
      scheduleRender(); scheduleSave();
    }
  });

  $('buml-new').addEventListener('click', function () { newDoc(); });
  $('buml-import').addEventListener('click', function () { $('buml-file').click(); });
  $('buml-file').addEventListener('change', function (e) {
    importFiles(e.target.files);
    e.target.value = '';
  });
  $('buml-png').addEventListener('click', exportPng);
  $('buml-svgcopy').addEventListener('click', copySvg);
  elMmd.addEventListener('click', function () {
    if (!current) return;
    download(docName(curLang() === 'plantuml' ? 'puml' : 'mmd'), 'text/plain', srcGet());
  });
  $('buml-tab').addEventListener('click', openInTab);

  elLang.addEventListener('change', function () {
    if (!current) return;
    current.lang = elLang.value;
    syncLang();
    scheduleRender();
    scheduleSave();
  });

  $('buml-menu').addEventListener('click', function () { shell.classList.toggle('side-open'); });
  $('buml-backdrop').addEventListener('click', closeSide);

  var viewTabs = root.querySelectorAll('.bu-viewtabs button');
  viewTabs.forEach(function (b) {
    b.addEventListener('click', function () {
      viewTabs.forEach(function (x) { x.classList.toggle('on', x === b); });
      shell.dataset.view = b.dataset.v;
      if (b.dataset.v === 'prev') renderNow();
    });
  });

  /* ---------- 시작 ---------- */
  function boot() {
    if (!dbAvailable) {
      banner('⚠️ 이 브라우저가 사설 모드(또는 저장 차단)라 문서가 저장되지 않습니다. 창을 닫으면 사라집니다.');
    }
    loadMermaid().catch(function () {
      banner('⚠️ 렌더 엔진(mermaid CDN)을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.');
    });
    /* 편집기는 조용히 로드 — 실패해도 textarea 폴백으로 기능 유지 */
    loadCm();

    seedIfEmpty().then(function (firstId) {
      // 방금 시딩했다면 샘플이 이미 포함돼 있으므로 보충 스킵
      var p = firstId ? Promise.resolve() : addPumlSampleOnce();
      return p.then(function () {
        var last = lsGet('buml-last');
        return dbAll().then(function (docs) {
          if (!docs.length) { newDoc(''); return; }
          var want = docs.some(function (d) { return d.id === last; }) ? last : (firstId || docs[0].id);
          openDoc(want);
        });
      });
    });
  }
  boot();
})();
