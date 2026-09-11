/*!
 * 카곰의 얼룩덜룩 — UML 스튜디오 (클라이언트 전용)
 * - 문서는 이 브라우저(IndexedDB)에만 저장됩니다. 서버 전송 없음.
 * - 렌더: mermaid@11 (jsDelivr CDN, 브라우저에서 직접)
 * - 블로그 테마 오염 방지: 모든 셀렉터·id를 #buml-app 스코프로 한정
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';
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
  var current = null;      // {id,title,source,updated}
  var lastSvg = '';        // 마지막 성공 렌더 SVG 문자열
  var mermaidReady = null; // Promise<mermaid>
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
    '  height:clamp(480px,calc(100vh - 300px),880px);display:flex;flex-direction:column;}',
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
    '#buml-app .bu-panes{flex:1;display:flex;min-height:0;}',
    '#buml-app .bu-pane-src{flex:1;display:flex;min-width:0;border-right:1px solid var(--bu-line);}',
    '#buml-app .bu-src{flex:1;width:100%;border:none;resize:none;outline:none;padding:12px;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;',
    '  font-size:13px;line-height:1.55;color:var(--bu-text);background:#fff;tab-size:2;}',
    '#buml-app .bu-pane-prev{flex:1;display:flex;flex-direction:column;min-width:0;}',
    '#buml-app .bu-prevbar{flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:7px 10px;',
    '  border-bottom:1px solid var(--bu-line2);background:#fbfbf9;}',
    '#buml-app .bu-prevbar .bu-btn{padding:3px 8px;font-size:12px;}',
    '#buml-app .bu-stage{flex:1;overflow:auto;padding:16px;min-height:0;display:flex;',
    '  align-items:flex-start;justify-content:center;}',
    '#buml-app .bu-stage svg{max-width:100%;height:auto;}',
    '#buml-app .bu-stage .bu-ph{color:var(--bu-dim);font-size:13px;text-align:center;margin:auto;line-height:2;}',
    '#buml-app .bu-error{margin:12px;border:1px solid #e3c3bf;background:#faf3f2;color:#9c3f36;',
    '  border-radius:4px;padding:10px 12px;font-size:12px;white-space:pre-wrap;word-break:break-word;}',
    '#buml-app .bu-backdrop{display:none;}',
    '#buml-app .bu-banner{margin:0;padding:7px 12px;background:#fdf6e3;border-bottom:1px solid #eadfc0;',
    '  color:#7a6a35;font-size:12px;flex:0 0 auto;}',
    /* 모바일 */
    '@media (max-width:820px){',
    '  #buml-app .buml{height:clamp(460px,calc(100vh - 200px),900px);}',
    '  #buml-app .bu-menu{display:inline-flex;}',
    '  #buml-app .bu-brand .bu-sub{display:none;}',
    '  #buml-app .bu-status{display:none;}',
    '  #buml-app .buml-top .bu-btn .bu-btxt{display:none;}',
    '  #buml-app .buml-top .bu-btn{padding:5px 8px;}',
    '  #buml-app .bu-side{position:absolute;top:0;left:0;bottom:0;width:min(280px,78%);z-index:6;',
    '    background:#fbfbf9;transform:translateX(-100%);transition:transform .18s ease;box-shadow:none;}',
    '  #buml-app .buml.side-open .bu-side{transform:none;box-shadow:2px 0 14px rgba(0,0,0,.18);}',
    '  #buml-app .bu-backdrop{display:block;position:absolute;inset:0;background:rgba(0,0,0,.35);z-index:5;opacity:0;pointer-events:none;transition:opacity .18s;}',
    '  #buml-app .buml.side-open .bu-backdrop{opacity:1;pointer-events:auto;}',
    '  #buml-app .bu-viewtabs{display:flex;}',
    '  #buml-app .bu-pane-src{border-right:none;}',
    '  #buml-app .bu-pane-src,#buml-app .bu-pane-prev{display:none;flex-basis:100%;}',
    '  #buml-app .buml[data-view="src"] .bu-pane-src{display:flex;}',
    '  #buml-app .buml[data-view="prev"] .bu-pane-prev{display:flex;}',
    '  #buml-app .bu-src{font-size:16px;}', /* iOS 포커스 줌 방지 */
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
    '    <span class="bu-brand">UML 스튜디오<span class="bu-sub">mermaid · 브라우저에 저장</span></span>' +
    '    <span class="bu-title"><input id="buml-title" placeholder="무제 다이어그램" maxlength="80"></span>' +
    '    <span class="bu-status" id="buml-status"></span>' +
    '    <button class="bu-btn" id="buml-import" title="파일 가져오기">⬆<span class="bu-btxt">가져오기</span></button>' +
    '    <button class="bu-btn bu-primary" id="buml-new">＋<span class="bu-btxt">새 문서</span></button>' +
    '    <input type="file" id="buml-file" accept=".mmd,.mermaid,.txt" hidden multiple>' +
    '  </div>' +
    '  <div class="buml-body">' +
    '    <div class="bu-backdrop" id="buml-backdrop"></div>' +
    '    <aside class="bu-side">' +
    '      <div class="bu-side-head">내 다이어그램</div>' +
    '      <ul class="bu-list" id="buml-list"></ul>' +
    '      <div class="bu-side-foot">⚠️ 문서는 <b>이 브라우저에만</b> 저장됩니다.<br>기기 초기화 전에는 「mmd」 내려받기로 백업하세요.</div>' +
    '    </aside>' +
    '    <main class="bu-main">' +
    '      <div class="bu-viewtabs">' +
    '        <button data-v="src" class="on">소스</button>' +
    '        <button data-v="prev">미리보기</button>' +
    '      </div>' +
    '      <div class="bu-panes">' +
    '        <div class="bu-pane-src"><textarea id="buml-src" spellcheck="false" ' +
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
  var elList = $('buml-list'), elSrc = $('buml-src'), elStage = $('buml-stage'),
      elTitle = $('buml-title'), elStatus = $('buml-status'), elBanner = $('buml-banner');

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

  /* ---------- 렌더 ---------- */
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, RENDER_DEBOUNCE);
  }

  var renderSeq = 0;
  function renderNow() {
    var src = elSrc.value.trim();
    if (!current) return;
    if (!src) {
      lastSvg = '';
      elStage.innerHTML = '<div class="bu-ph">소스를 입력하세요</div>';
      return;
    }
    var seq = ++renderSeq;
    loadMermaid().then(function (mermaid) {
      return mermaid.render('buml-svg-' + Date.now(), src);
    }).then(function (out) {
      if (seq !== renderSeq) return; // 최신 입력만 반영
      lastSvg = out.svg;
      elStage.innerHTML = lastSvg;
    }).catch(function (e) {
      if (seq !== renderSeq) return;
      lastSvg = '';
      var msg = (e && e.message) ? e.message : String(e);
      elStage.innerHTML = '<div class="bu-error">⚠️ ' + esc(msg) + '</div>';
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
    current.source = elSrc.value;
    current.title = elTitle.value.trim();
    current.updated = Date.now();
    dbPut(current).then(function () {
      if (!dbAvailable) return;
      setStatus('저장됨 ' + fmtTime(current.updated));
      refreshList();
    });
  }
  function setStatus(s) { elStatus.textContent = s; }

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
      elSrc.value = d.source || '';
      lsSet('buml-last', d.id);
      closeSide();
      refreshList();
      renderNow();
    });
  }

  function newDoc(starter) {
    current = {
      id: uid(),
      title: '',
      source: starter !== undefined ? starter : 'flowchart TD\n  A[시작] --> B{계속할까?}\n  B -- 예 --> C[끝]\n  B -- 아니오 --> A',
      updated: Date.now()
    };
    elTitle.value = current.title;
    elSrc.value = current.source;
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
            else { current = null; elTitle.value = ''; elSrc.value = ''; elStage.innerHTML = '<div class="bu-ph">좌측 ＋ 새 문서로 시작하세요</div>'; lastSvg = ''; refreshList(); }
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
          var doc = {
            id: uid(),
            title: f.name.replace(/\.(mmd|mermaid|txt)$/i, ''),
            source: text,
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
    }
  ];
  function seedIfEmpty() {
    return dbAll().then(function (docs) {
      if (docs.length || lsGet('buml-seeded')) return;
      var first = null;
      return Promise.all(SAMPLES.map(function (s, i) {
        var doc = { id: uid(), title: s.title, source: s.source, updated: Date.now() + i };
        first = first || doc;
        return dbPut(doc);
      })).then(function () {
        lsSet('buml-seeded', '1');
        return dbAll().then(function (all) { return all[0] ? all[0].id : null; });
      });
    });
  }

  /* ---------- 사이드바(모바일) ---------- */
  function closeSide() { shell.classList.remove('side-open'); }

  /* ---------- 이벤트 ---------- */
  elSrc.addEventListener('input', function () { scheduleRender(); scheduleSave(); });
  elTitle.addEventListener('input', scheduleSave);

  elSrc.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = elSrc.selectionStart, en = elSrc.selectionEnd;
      elSrc.value = elSrc.value.slice(0, s) + '  ' + elSrc.value.slice(en);
      elSrc.selectionStart = elSrc.selectionEnd = s + 2;
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
  $('buml-mmd').addEventListener('click', function () {
    if (!current) return;
    download(docName('mmd'), 'text/plain', elSrc.value);
  });
  $('buml-tab').addEventListener('click', openInTab);

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

    seedIfEmpty().then(function (firstId) {
      var last = lsGet('buml-last');
      return dbAll().then(function (docs) {
        if (!docs.length) { newDoc(''); return; }
        var want = docs.some(function (d) { return d.id === last; }) ? last : (firstId || docs[0].id);
        openDoc(want);
      });
    });
  }
  boot();
})();
