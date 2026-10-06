
/* ══ PRESENTER ══ presents the editor pages full screen with the same compositor as Export, and keeps them ALIVE:
   - Page transitions set in the editor (Fade, Slide, Push, Cube...) play between pages, drawn by the same
     renderer (pdfedFxRender) that the picker tiles and Export Clip use, so what you see is what you set.
   - Live clips (Showcase) keep moving while you present, also inside transitions.
   - Hyperlinks (whole-box and in-paragraph) are clickable, positioned with the same layout math as PDF export.
   - Arrow keys / PageUp / PageDown / Space / Enter / Backspace, Home / End, Esc. Wheel / double-click zoom
     anchored at the pointer (+ / - / 0 on the keyboard). Pages render at 2x for sharp zoom. */
(function(){
  var P = { open:false, idx:-1, shown:false, cache:{}, pend:{}, tok:0, iw:0, ih:0, base:1, s:1, tx:0, ty:0, mx:0, my:0,
            drag:null, moved:false, hudT:null, el:null, img:null, live:null, links:null,
            fxCv:null, liveRaf:0, liveLast:0, prevLive:null, keepUntil:0 };
  var MAXZ = 10;
  function $(id){ return document.getElementById(id); }
  function W(){ return P.el.clientWidth; } function H(){ return P.el.clientHeight; }

  function box(){
    var w = W(), h = H(), d = Math.min(2, window.devicePixelRatio || 1);
    d = Math.max(1, Math.min(d, Math.sqrt(3500000 / Math.max(1, w * h))));
    return { W:w, H:h, dpr:d };
  }

  /* ---------- view transform (image, live canvas and link layer share one transform) ---------- */
  function clampPan(){
    var w = P.iw*P.s, h = P.ih*P.s;
    P.tx = w <= W() ? (W()-w)/2 : Math.min(0, Math.max(W()-w, P.tx));
    P.ty = h <= H() ? (H()-h)/2 : Math.min(0, Math.max(H()-h, P.ty));
  }
  function apply(){
    clampPan();
    var tf = 'translate('+P.tx+'px,'+P.ty+'px) scale('+P.s+')';
    [P.img, P.live, P.links].forEach(function(e){
      if (!e) return;
      e.style.width = P.iw+'px'; e.style.height = P.ih+'px'; e.style.transform = tf;
    });
    var z = P.s/P.base;
    $('pdfedPresZoom').textContent = Math.round(z*100)+'%';
    P.el.classList.toggle('zoomed', z > 1.001);
  }
  function fit(){
    P.base = Math.min(W()/P.iw, H()/P.ih) || 1; P.s = P.base;
    P.tx = (W()-P.iw*P.s)/2; P.ty = (H()-P.ih*P.s)/2; apply();
  }
  function zoomAt(factor, px, py, absZ){
    var z = P.s/P.base, nz = absZ != null ? absZ : z*factor;
    nz = Math.max(1, Math.min(MAXZ, nz));
    var ns = P.base*nz, r = ns/P.s;
    P.tx = px - (px - P.tx)*r; P.ty = py - (py - P.ty)*r; P.s = ns; apply(); pokeHud();
  }
  function pokeHud(){
    $('pdfedPresHud').classList.remove('faded'); P.el.classList.remove('hide-cursor');
    clearTimeout(P.hudT); P.hudT = setTimeout(function(){ $('pdfedPresHud').classList.add('faded'); if(!P.drag) P.el.classList.add('hide-cursor'); }, 2200);
  }

  /* ---------- clickable links ---------- */
  function safeUrl(u){
    u = String(u || '').trim(); if (!u) return '';
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';            // javascript:, data:, file: ... never
    return /^[^\s]+\.[^\s]+$/.test(u) ? 'https://' + u : '';
  }
  // Same wrap / align / padding math as pdfedAddPlacedTextLinkAnnotations (PDF export), but returns rectangles.
  async function linkRects(pg, iw){
    var out = [], list = pg.placedTexts;
    if (!list || !list.length || !iw) return out;
    var hasLink = function(t){ return t && (t.link || (t.html && /<a[\s>]/i.test(t.html))); };
    if (!list.some(hasLink)) return out;
    try { await pdfedEnsureFontsLoaded(pg); } catch(e){}
    var m = document.createElement('canvas').getContext('2d');
    list.forEach(function(item){
      if (!hasLink(item)) return;
      var famRaw = item.fontFamily || 'Inter', fam = famRaw.indexOf(',') >= 0 ? famRaw : "'" + famRaw + "'";
      var lh = item.fontSize * 1.25, padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
      var ax = item.x + padX, fc = { fontSize:item.fontSize, fam:fam, itemBold:!!item.bold, itemItalic:!!item.italic };
      var sf = function(r){ m.font = (r.italic?'italic':'normal')+' '+(r.bold?'700':'400')+' '+item.fontSize+'px '+fam+', Inter, sans-serif'; };
      var lines = item.html ? pdfedParseRichLines(item.html)
                            : (item.text || '').split('\n').map(function(t){ return [{ text:t, color:null, link:null }]; });
      var maxW = item.w ? Math.max(10, item.w - padX*2) : Math.max(10, (iw - item.x - 12) - padX*2);
      var wrapped = []; lines.forEach(function(runs){ wrapped.push.apply(wrapped, pdfedWrapRichLine(m, runs, maxW, fc)); }); lines = wrapped;
      var cw = maxW;
      if (!item.w) { cw = 0; lines.forEach(function(runs){ var w = runs.reduce(function(a,r){ sf(r); return a + m.measureText(r.text).width; }, 0); if (w > cw) cw = w; }); }
      var runLinked = false;
      lines.forEach(function(runs, li){
        var ty = item.y + padY + li*lh;
        var ws = runs.map(function(r){ sf(r); return m.measureText(r.text).width; });
        var tot = ws.reduce(function(a,b){ return a+b; }, 0), sx = ax;
        if (item.align === 'center') sx = ax + (cw - tot)/2; else if (item.align === 'right') sx = ax + (cw - tot);
        var cx = sx;
        runs.forEach(function(r, ri){
          if (r.text && r.text.trim() && r.link) { var u = safeUrl(r.link); if (u) { runLinked = true; out.push({ x:cx, y:ty, w:ws[ri], h:lh, url:u }); } }
          cx += ws[ri];
        });
      });
      if (item.link && !runLinked) {
        var u2 = safeUrl(item.link);
        if (u2) out.push({ x:item.x, y:item.y, w:item.w || (cw + padX*2), h:lines.length*lh + padY*2, url:u2 });
      }
    });
    return out;
  }
  function buildLinks(it){
    P.links.textContent = '';
    (it.links || []).forEach(function(l){
      var a = document.createElement('a');
      a.className = 'pdfed-pres-link'; a.href = l.url; a.title = l.url;
      if (!/^mailto:/i.test(l.url)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.style.cssText = 'left:'+l.x+'px;top:'+l.y+'px;width:'+l.w+'px;height:'+l.h+'px';
      a.addEventListener('click', function(e){
        if (P.moved) { e.preventDefault(); return; }
        P.keepUntil = Date.now() + 2500;                    // opening a tab may drop fullscreen: keep presenting
      });
      P.links.appendChild(a);
    });
  }

  /* ---------- page items: a sharp image, or a live canvas ---------- */
  function loadImg(url){
    return new Promise(function(res){ var im = new Image(); im.onload = function(){ res(im); }; im.onerror = function(){ res(im); }; im.src = url; });
  }
  // Shrink ONCE to screen size so transition frames only blit a small bitmap.
  function shrink(im, iw, ih, b){
    var f = Math.min(b.W/iw, b.H/ih) * b.dpr, tw = Math.max(2, Math.round(iw*f)), th = Math.max(2, Math.round(ih*f));
    if (tw >= im.naturalWidth) { im._ow = iw; im._oh = ih; return im; }
    var c = document.createElement('canvas'); c.width = tw; c.height = th;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, tw, th);
    c._ow = iw; c._oh = ih; return c;
  }
  async function build(i){
    var pg = pdfed.pages[i], b = box(), it = null;
    if (pdfedPageHasLive(pg)) {
      try {
        var lp = await pdfedBuildLivePage(pg, Math.round(b.W*b.dpr), Math.round(b.H*b.dpr));
        it = { kind:'live', cv:lp.canvas, live:lp, iw:lp.canvas._ow, ih:lp.canvas._oh, fx:lp.canvas, t0:0 };
      } catch(e) { console.warn('[Workspace] live page failed in Presenter, showing its still picture', e); it = null; }
    }
    if (!it) {
      var r; try { r = await pdfedComposeThumbHiRes(pg, i, 2); } catch(e) { r = null; }
      if (!r || !r.url) { r = { url: await pdfedComposeThumb(pg, i), iw:0, ih:0 }; }
      var im = await loadImg(r.url), iw = r.iw || im.naturalWidth, ih = r.ih || im.naturalHeight;
      it = { kind:'img', url:r.url, iw:iw, ih:ih, fx:shrink(im, iw, ih, b) };
    }
    try { it.links = await linkRects(pg, it.iw); } catch(e) { it.links = []; }
    P.cache[i] = it; return it;
  }
  function getItem(i){ return P.cache[i] ? Promise.resolve(P.cache[i]) : (P.pend[i] || (P.pend[i] = build(i))); }

  function setContent(it){
    P.iw = it.iw; P.ih = it.ih;
    P.img.classList.remove('on'); P.live.classList.remove('on'); P.links.classList.remove('on');
    P.live.textContent = '';
    if (it.kind === 'live') { P.img.removeAttribute('src'); P.live.appendChild(it.cv); }
    else P.img.src = it.url;
    buildLinks(it); fit();
  }
  function reveal(it, instant, tk){
    var e = it.kind === 'live' ? P.live : P.img;
    var on = function(){ e.classList.add('on'); P.links.classList.add('on'); };
    if (instant) { e.style.transition = 'none'; on(); void e.offsetWidth; e.style.transition = ''; }
    else requestAnimationFrame(function(){ if (tk === P.tok && P.open) on(); });
  }

  /* ---------- page transitions ---------- */
  function killFx(){ if (P.fxCv) { P.fxCv.remove(); P.fxCv = null; } }
  function playFx(from, it, fx, fwd, tk){
    var b = box(), cv = document.createElement('canvas'); cv.className = 'pdfed-pres-fx';
    cv.width = Math.round(b.W*b.dpr); cv.height = Math.round(b.H*b.dpr);
    P.el.appendChild(cv); P.fxCv = cv;
    var ctx = cv.getContext('2d'); ctx.setTransform(b.dpr, 0, 0, b.dpr, 0, 0);
    var lay = function(img){ var d = pdfedFxDims(img), f = Math.min(b.W/d[0], b.H/d[1]), w = d[0]*f, h = d[1]*f; return { x:(b.W-w)/2, y:(b.H-h)/2, w:w, h:h }; };
    lay.sh = 0;
    var start = performance.now();
    (function frame(now){
      if (tk !== P.tok || !P.open || P.fxCv !== cv) return;
      var t = Math.min(1, (now - start) / fx.ms);
      ctx.clearRect(0, 0, b.W, b.H);
      try { pdfedFxRender(ctx, b.W, b.H, from.fx, it.fx, t, fx.type, fwd ? 1 : -1, lay, 1, 0, fx.spec); } catch(e) { t = 1; }
      if (t < 1) requestAnimationFrame(frame);
      else { reveal(it, true, tk); requestAnimationFrame(function(){ if (P.fxCv === cv) { cv.remove(); P.fxCv = null; } }); }
    })(start);
  }

  /* ---------- live clips keep moving ---------- */
  function startLive(){ if (!P.liveRaf) P.liveRaf = requestAnimationFrame(liveTick); }
  function liveTick(ts){
    P.liveRaf = 0; if (!P.open) return;
    var cur = P.cache[P.idx], now = performance.now(), pl = P.prevLive;
    if (pl && now >= pl.until) pl = P.prevLive = null;
    var curLive = cur && cur.kind === 'live';
    if (!curLive && !pl) return;
    if (!document.hidden && ts - P.liveLast >= 30) {      // ~30 fps is plenty
      P.liveLast = ts;
      try { if (curLive) cur.live.update((now - cur.t0)/1000); if (pl) pl.it.live.update((now - pl.it.t0)/1000); } catch(e) {}
    }
    P.liveRaf = requestAnimationFrame(liveTick);
  }

  /* ---------- navigation ---------- */
  async function show(i){
    var n = pdfed.pages.length; if (i < 0 || i >= n) return;
    var tk = ++P.tok, prev = P.idx, hadPrev = P.shown;
    killFx(); P.idx = i;
    $('pdfedPresCount').textContent = (i+1)+' / '+n;
    if (!P.cache[i]) $('pdfedPresSpin').classList.add('on');
    var it = await getItem(i);
    if (tk !== P.tok || !P.open) return;
    $('pdfedPresSpin').classList.remove('on');

    var from = (hadPrev && prev !== i) ? P.cache[prev] : null, fwd = i > prev, fx = null;
    if (from && Math.abs(i - prev) === 1) {               // same rule as the slideshow: transition of the page you leave (forward) / enter (back)
      fx = pdfedAnimGet(pdfed.pages[fwd ? prev : i]);
      if (fx && fx.type === 'none') fx = null;
    }
    setContent(it);
    if (it.kind === 'live') it.t0 = performance.now();
    if (from && from.kind === 'live') P.prevLive = { it:from, until:performance.now() + (fx ? fx.ms : 0) + 80 };
    if (it.kind === 'img') { try { await P.img.decode(); } catch(e) {} if (tk !== P.tok || !P.open) return; }
    if (fx && from) playFx(from, it, fx, fwd, tk); else reveal(it, false, tk);
    P.shown = true; startLive(); pokeHud();
    [i+1, i-1].forEach(function(j){ if (j >= 0 && j < n && !P.cache[j]) getItem(j).catch(function(){}); });
  }
  function step(d){ var n = pdfed.pages.length, j = P.idx + d; if (j < 0 || j >= n) return; show(j); }

  function onKey(e){
    if (!P.open) return;
    var k = e.key, handled = true;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') step(1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') step(-1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(pdfed.pages.length-1);
    else if (k === '+' || k === '=') zoomAt(1.25, P.mx||W()/2, P.my||H()/2);
    else if (k === '-' || k === '_') zoomAt(0.8, P.mx||W()/2, P.my||H()/2);
    else if (k === '0') fit();
    else if (k === 'Escape') close();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); pokeHud(); }
    else e.stopPropagation(); // keep editor shortcuts from firing behind the stage
  }

  async function open(){
    if (P.open) return;
    if (typeof pdfed === 'undefined' || !pdfed.pages || !pdfed.pages.length) { try { toast('Open or create a page first', 'error'); } catch(e){} return; }
    try { pdfedAutoStampPendingGhost(); } catch(e){}
    P.el = $('pdfedPresenter'); P.img = $('pdfedPresImg'); P.live = $('pdfedPresLive'); P.links = $('pdfedPresLinks');
    P.cache = {}; P.pend = {}; P.idx = -1; P.shown = false; P.prevLive = null; P.open = true;
    P.el.classList.add('open'); P.el.setAttribute('aria-hidden','false');
    document.addEventListener('keydown', onKey, true);
    var rq = P.el.requestFullscreen || P.el.webkitRequestFullscreen;
    if (rq) { try { var pr = rq.call(P.el); if (pr && pr.catch) pr.catch(function(){}); } catch(e){} }
    await show(Math.max(0, pdfed.active));
  }
  function close(){
    if (!P.open) return;
    P.open = false; P.tok++; killFx();
    if (P.liveRaf) { cancelAnimationFrame(P.liveRaf); P.liveRaf = 0; }
    document.removeEventListener('keydown', onKey, true);
    P.el.classList.remove('open','zoomed','dragging','hide-cursor'); P.el.setAttribute('aria-hidden','true');
    P.img.classList.remove('on'); P.img.removeAttribute('src');
    P.live.classList.remove('on'); P.live.textContent = ''; P.links.classList.remove('on'); P.links.textContent = '';
    P.cache = {}; P.pend = {}; P.prevLive = null; clearTimeout(P.hudT);
    $('pdfedPresSpin').classList.remove('on');
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) { var ex = document.exitFullscreen || document.webkitExitFullscreen; try { var p2 = ex.call(document); if (p2 && p2.catch) p2.catch(function(){}); } catch(e){} }
    // land the editor on the page that was last presented
    try { if (pdfed.active !== P.idx) pdfedGoto(P.idx); } catch(e){}
  }
  function onFs(){
    var inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (P.open && !inFs) { if (Date.now() < P.keepUntil) return; close(); }   // a clicked link may drop fullscreen: stay open
    else if (P.open) setTimeout(fit, 60);
  }
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
  window.addEventListener('resize', function(){ if (P.open && P.iw) { var z = P.s/P.base; P.base = Math.min(W()/P.iw, H()/P.ih)||1; P.s = P.base*z; apply(); } });

  document.addEventListener('DOMContentLoaded', init); if (document.readyState !== 'loading') init();
  var inited = false;
  function init(){
    if (inited) return; var el = $('pdfedPresenter'); if (!el) return; inited = true;
    el.addEventListener('wheel', function(e){
      e.preventDefault(); var r = el.getBoundingClientRect();
      P.mx = e.clientX - r.left; P.my = e.clientY - r.top;
      var dy = e.deltaMode === 1 ? e.deltaY*16 : e.deltaY;
      zoomAt(Math.exp(-dy*0.0022), P.mx, P.my);
    }, { passive:false });
    el.addEventListener('mousemove', function(e){
      var r = el.getBoundingClientRect(); P.mx = e.clientX - r.left; P.my = e.clientY - r.top;
      if (P.drag) {
        if (Math.abs(e.clientX - P.drag.x) + Math.abs(e.clientY - P.drag.y) > 4) P.moved = true;
        P.tx = P.drag.tx + (e.clientX - P.drag.x); P.ty = P.drag.ty + (e.clientY - P.drag.y); apply();
      }
      pokeHud();
    });
    el.addEventListener('mousedown', function(e){
      P.moved = false;
      if (e.button !== 0 || P.s/P.base <= 1.001) return;
      P.drag = { x:e.clientX, y:e.clientY, tx:P.tx, ty:P.ty }; el.classList.add('dragging');
    });
    window.addEventListener('mouseup', function(){ if (P.drag) { P.drag = null; el.classList.remove('dragging'); } });
    el.addEventListener('dblclick', function(e){
      var r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (P.s/P.base > 1.001) fit(); else zoomAt(1, px, py, 2.5);
      pokeHud();
    });
  }
  window.pdfedPresenterOpen = open; window.pdfedPresenterClose = close;
})();
