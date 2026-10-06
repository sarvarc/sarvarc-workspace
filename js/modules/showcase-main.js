
/* (c) 2026 SARVARC. ALL RIGHTS RESERVED.
   SHOWCASE (spp) is proprietary SARVARC code. Except the owner (SARVARC),
   NO ONE is permitted to copy, reuse, modify, adapt, reverse engineer,
   extract, redistribute, sell, host, or build any product or feature from
   this code, its presets, logic, structure or design, in whole or in part,
   without prior written permission from SARVARC.
   STRICT ACTIONS MAY BE TAKEN IF BREACHED. */
(function () {
  'use strict';
  var _kb7c041_a829 = 1;

  var PRESET_SWATCHES = [
    ['#ffffff', '#e8eef7'], ['#f5efe6', '#e6d8c3'], ['#0b1220', '#1f4e8c'], ['#111111', '#3a3a3a'],
    ['#ff7a59', '#ffb36b'], ['#0f766e', '#34d399'], ['#7c3aed', '#c084fc'], ['#be123c', '#fb7185']
  ];
  var FONTS = {
    clean: '"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    bold: '"Arial Black","Impact",Haettenschweiler,sans-serif',
    mono: '"SFMono-Regular",Menlo,Consolas,"Courier New",monospace'
  };
  var SPECIAL = { glint: 1, carousel: 1, slice: 1, bounce: 1, echo: 1, pulse: 1, levitate: 1, pop: 1, orbit: 1, swing: 1, roll: 1, acrobat: 1, breakdance: 1, spinin: 1, tumble: 1, hero: 1, warp: 1, snap: 1, flip: 1, ripple: 1, pixel: 1, glitch: 1, waterfall: 1, assemble: 1, shatter: 1, dust: 1, blinds: 1, scan: 1 };   // motions that draw the whole product themselves
  var PREVIEW = { 'page': [680, 960], '16:9': [960, 540], '1:1': [720, 720], '4:5': [648, 810], '9:16': [540, 960] };
  var EXPORT = { 'page': [930, 1280], '16:9': [1280, 720], '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
  var MOTION_NOTES = {
    chilldrop: 'Cold-drink ad move: the product spins and zooms, then three close-ups from three different angles, each rushing in, dropping into slow motion with frost and a light glint, and snapping back with a puff of mist. Picks up colour from your background. Set the length to about 12 seconds. Best with a sharp, high resolution photo.',
    turntable: 'Full 360 turn. Your photo is the front, and the back is a shaded plain colour (or a mirror, your choice).',
    sway: 'Swings left and right like a showroom display, so the front stays mostly visible.',
    wrap: 'Wraps the photo around a cylinder, so the label slides around. Best for cans, jars and tubes. The back repeats your label.',
    glint: 'A soft light sweeps across the product while it floats.',
    carousel: 'Copies of the product circle like a showroom carousel.',
    slice: 'The product splits into strips, drifts apart and snaps back together.',
    bounce: 'A playful drop with squash and stretch, and a shadow that reacts.',
    echo: 'The product glides side to side, leaving a fading trail.',
    pulse: 'The product beats like a heartbeat, twice per loop. Made for offers, drops and anything you want noticed in a feed.',
    levitate: 'The product rises and settles while its floor shadow shrinks and grows. Great for food, drinks, cosmetics and jewellery.',
    pop: 'Springs in with a bouncy pop, settles, and pops in again each loop. Made for sales, new arrivals and launch posts.',
    orbit: 'The product glides round a small circle, growing as it comes toward you and shrinking as it moves away. Good for gadgets and brands.',
    swing: 'Hangs and swings like a price tag or a shop-window sign. Good for offers and boutique items.',
    roll: 'Rolls in from the side like a wheel, settles, then rolls out the other side. A fast, fun intro. Direction picks the side.',
    acrobat: 'Jumps and does a full flip in the air, lands with a squash, then flips back the other way.',
    breakdance: 'Spins fast with a little hop, then hits a tilted freeze pose with a bounce before resetting.',
    spinin: 'Spins in from nothing at high speed, holds, then spins away. A quick punchy intro.',
    tumble: 'Drops in from above, tumbling and bouncing to a stop, then falls away. A funky entrance.',
    hero: 'The product rises into a spotlight with a little overshoot, a soft light flash and a slow push in, then lifts away. Made to feel like the main hero.',
    assemble: 'Raw parts fly in from every direction, spinning, and lock together into the product with a soft flash.',
    shatter: 'Sharp shards streak in from all sides and snap together into the product, then it breaks apart again.',
    dust: 'Hundreds of tiny fragments swirl in from around the frame and materialize into the product.',
    blinds: 'Strips of the product slide in from alternating sides and close together like cinema shutters.',
    scan: 'The product starts as a dark silhouette while a thin white scan line sweeps up and reveals the real thing.',
    warp: 'The product shoots out of the distance at light speed with white speed streaks, lands with a soft flash, then gets pulled back in.',
    snap: 'The product crumbles into dust that blows away on the wind, then the dust swirls back and rebuilds it.',
    flip: 'Tiles flip over in a wave that starts at the centre and reveals the product, then flip away.',
    ripple: 'The product forms out of a liquid ripple, like a reflection on water settling into focus, then melts back into the waves.',
    pixel: 'Starts as giant blocks and sharpens step by step into the real product, like a retro game loading. Pixelates away at the end.',
    glitch: 'A digital glitch: the product tears into shifting bands that snap clean, with a couple of random glitch hits in between.',
    waterfall: 'Thin columns drop in from above at different moments and bounce into place, then fall away.',
    hover: 'Floats gently with a small tilt. Good for shoes, gadgets and anything you want to keep facing forward.'
  };

  var S = {
    open: false, playing: true, raf: 0, t0: 0, tNorm: 0, busy: false, recording: false,
    srcCanvas: null, procCanvas: null, srcNat: null, srcName: '', hasAlpha: false, bgColor: { r: 240, g: 242, b: 246 }, bgBusy: false,
    cut: null, sprites: null, spriteKey: '', cutVer: 0, edgeRGB: [70, 70, 70], cutTimer: 0,
    layers: {}, gal: [],
    o: {
      cutout: true, tol: 42, trim: 1, soft: 1,
      motion: 'turntable', secs: 6, dir: 1, amp: 35, thick: 5, size: 100, back: 'plain', shadow: true, reflect: true,
      bgMode: 'matched', fillA: '#0b1220', fillB: '#1f4e8c', fillGrad: true,
      head: '', sub: '', badge: '', txtPos: 'bottom', font: 'clean', txtSize: 100, txtAuto: true, txtCol: '#ffffff',
      accent: '#00c2ff', txtAnim: 'rise', txtOut: 'auto', eng: 'none', engText: '', txtLive: 'none', fontName: '', ratio: '16:9',
      fit: 'product', fmotion: 'zoomin', scrim: 45, txtAlign: 'center', gal: 'slideshow', cutStyle: 'hype', fxCol: 'white',
      xt: []   // More texts (build 305). Replaced, never edited in place: SP_DEFAULTS and undo snapshots share this array
    }
  };

  function $(id) { return document.getElementById(id); }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hexToRgb(h) { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; var n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  function rgbStr(c, a) { return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + (a == null ? 1 : a) + ')'; }
  function mix(c, t, k) { return { r: c.r + (t.r - c.r) * k, g: c.g + (t.g - c.g) * k, b: c.b + (t.b - c.b) * k }; }
  function lum(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
  function say(msg, type) { try { if (typeof toast === 'function') toast(msg, type || 'info'); } catch (e) { console.warn('Showcase toast failed', e); } }

  /* ───────────────────────── open / close ───────────────────────── */
  window.sppOpen = function () {
    var ov = $('sppOverlay'); if (!ov) return;
    ov.classList.add('open'); S.open = true; document.documentElement.classList.add('spp-open');
    try { if (window.sppSync) window.sppSync('open'); } catch (e) {}
    if (!$('sppSwatches').children.length) buildSwatches();
    if (!$('sppGalSwatches').children.length) buildSwatches($('sppGalSwatches'));
    if (pageDims() && !S._userRatio && S.o.ratio === '16:9') {
      var pb = $('sppRatioSeg') && $('sppRatioSeg').querySelector('[data-v="page"]'); if (pb) window.sppSetSeg('ratio', 'page', pb);
    }
    sizePreview(); drawOrig();
    S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
    cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(tick);
  };
  window.sppClose = function () {
    if (S.recording) { say('Video is still recording. Wait for it to finish.', 'info'); return; }
    try { if (S._pre) { if (S.editTarget && S.editTarget.draft) boundSaveNow(); } } catch (e) {}
    $('sppOverlay').classList.remove('open'); S.open = false; document.documentElement.classList.remove('spp-open'); cancelAnimationFrame(S.raf); S.editTarget = null;
    try { boundRestore(); } catch (e) {}
    try { if (window.sppFlush) window.sppFlush(); } catch (e) {}
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open && !(e.target && e.target.closest && e.target.closest('#kadessa-panel'))) sppClose(); });

  function buildSwatches(target) {
    var box = target || $('sppSwatches');
    PRESET_SWATCHES.forEach(function (p) {
      var i = document.createElement('i');
      i.style.background = 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
      i.title = 'Use this colour pair';
      i.onclick = function () {
        S.o.fillA = p[0]; S.o.fillB = p[1]; S.o.fillGrad = true;
        $('sppFillA').value = p[0]; $('sppFillB').value = p[1]; $('sppFillGrad').checked = true;
        $('sppFillBRow').style.display = '';
        sppSetSeg('bgMode', 'filled', $('sppBgSeg').querySelector('[data-v="filled"]'));
        if (S.o.fit === 'gallery') sppSet('fillA', p[0]);
      };
      box.appendChild(i);
    });
  }

  /* ───────────────────────── settings ───────────────────────── */
  window.sppSet = function (k, v, rebuildCutout) {
    S.o[k] = v; if (k === 'head' || k === 'sub' || k === 'badge') S._autoTxt = false;
    var lab = { tol: 'sppTolV', trim: 'sppTrimV', soft: 'sppSoftV', secs: 'sppSecsV', amp: 'sppAmpV', thick: 'sppThickV', size: 'sppSizeV', txtSize: 'sppTxtSizeV', scrim: 'sppScrimV' }[k];
    if (lab && $(lab)) $(lab).textContent = v;
    if (k === 'cutout') { $('sppCutBox').style.opacity = v ? 1 : .35; scheduleCut(0); }
    else if (rebuildCutout) scheduleCut(180);
    if (k === 'fillGrad') $('sppFillBRow').style.display = v ? '' : 'none';
    if (k === 'txtAuto') $('sppTxtColRow').style.display = v ? 'none' : '';
    if (k === 'font') { S.o.fontName = ''; syncFontBtn(); }
    if (k === 'secs') S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
    if (k === 'thick' || k === 'size') S.spriteKey = '';
  };
  window.sppSetSeg = function (k, v, btn) {
    S.o[k] = v;
    if (k === 'fit' || k === 'fmotion' || k === 'ratio') { try { updateDimTags(); } catch (e) {} }
    var seg = btn && btn.parentNode;
    if (seg) [].forEach.call(seg.children, function (b) { b.classList.toggle('on', b === btn); });
    if (k === 'motion') {
      $('sppMotionNote').textContent = MOTION_NOTES[v] || '';
      $('sppAmpRow').style.display = v === 'sway' ? '' : 'none';
      $('sppThickRow').style.display = (v === 'wrap' || SPECIAL[v]) ? 'none' : '';
      $('sppBackRow').style.display = (v === 'wrap' || SPECIAL[v]) ? 'none' : '';
    }
    if (k === 'bgMode') {
      $('sppFillBox').style.display = v === 'filled' ? '' : 'none';
      $('sppBgNote').textContent = v === 'empty' ? 'Transparent. Great for placing on your page or for a PNG cut-out.' :
        v === 'matched' ? 'Matched uses the colour of your original photo background.' : 'Pick your own colour or gradient.';
    }
    if (k === 'ratio') { if (window.event && window.event.type === 'click') S._userRatio = true; sizePreview(); }
    if (k === 'fit') { var md = document.querySelector('#sppOverlay .spp-modal'); if (md) { md.classList.toggle('spp-fillmode', v === 'fill' || v === 'gallery'); md.classList.toggle('spp-galmode', v === 'gallery'); }
      if (v === 'gallery' && $('sppWrapRel').classList.contains('cmp')) window.sppToggleCompare(); scheduleCut(0); }
  };
  // 'Page' ratio = the exact shape of the editor page that is open, so the result fills it edge to edge.
  function pageDims() {
    try {
      if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) return null;
      var pcv = document.getElementById('pdfedPageCanvas');
      return (pcv && pcv.width > 0 && pcv.height > 0) ? [pcv.width, pcv.height] : null;
    } catch (e) { return null; }
  }
  function refreshPageRatio() {
    var d = pageDims() || [800, 1100], m = Math.max(d[0], d[1]);
    var ev = function (n) { return Math.max(2, 2 * Math.round(n / 2)); };
    PREVIEW.page = [Math.max(2, Math.round(d[0] * 960 / m)), Math.max(2, Math.round(d[1] * 960 / m))];
    EXPORT.page = [ev(d[0] * 1280 / m), ev(d[1] * 1280 / m)];
  }
  function updateDimTags() {
    var e = EXPORT[S.o.ratio] || EXPORT['16:9'], t = $('sppDimTag'), o = $('sppOrigTag');
    if (t) t.textContent = 'Showcase · ' + e[0] + ' × ' + e[1];
    if (o) {
      if (!S.srcCanvas) o.textContent = 'Original';
      else {
        var sc = S.srcCanvas, nat = S.srcNat || [sc.width, sc.height], txt = 'Original · ' + nat[0] + ' × ' + nat[1];
        if (nat[0] > sc.width) txt += ' (using ' + sc.width + ' × ' + sc.height + ')';
        if (S.o.fit === 'fill') {   // does the photo have enough pixels for this export size?
          var up = Math.max(e[0] / sc.width, e[1] / sc.height) * (S.o.fmotion === 'still' ? 1 : 1.12);
          txt += up > 1.02 ? ' · upscaled ×' + up.toFixed(1) : ' · sharp';
        }
        o.textContent = txt;
      }
    }
  }
  function paintRanges() {
    [].forEach.call(document.querySelectorAll('#sppOverlay input[type=range]'), function (r) {
      var mn = +r.min || 0, mx = +r.max || 100, p = mx > mn ? ((+r.value - mn) / (mx - mn)) * 100 : 0;
      r.style.setProperty('--p', p.toFixed(1) + '%');
    });
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.type === 'range' && e.target.closest && e.target.closest('#sppOverlay')) paintRanges(); }, true);
  function sizePreview() {
    paintRanges(); refreshPageRatio(); updateDimTags();
    var d = PREVIEW[S.o.ratio], c = $('sppCanvas');
    if (c.width !== d[0] || c.height !== d[1]) { c.width = d[0]; c.height = d[1]; }
  }
  function drawOrig() {
    var c = $('sppOrig'), src = S.procCanvas || S.srcCanvas; if (!c || !src) return;
    if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
    var x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
  }
  window.sppToggleCompare = function () {
    var w = $('sppWrapRel'), on = !w.classList.contains('cmp');
    w.classList.toggle('cmp', on); $('sppCmpBtn').classList.toggle('on', on);
    if (on) drawOrig();
  };
  window.sppTogglePlay = function () {
    S.playing = !S.playing;
    $('sppPlayBtn').textContent = S.playing ? 'Pause' : 'Play';
    if (S.playing) S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
  };
  window.sppScrubTo = function (v) {
    S.tNorm = clamp(+v / 1000, 0, 0.9999);
    if (S.playing) { S.playing = false; $('sppPlayBtn').textContent = 'Play'; }
  };

  /* ───────────────────────── source image ───────────────────────── */
  function dropSetup() {
    var d = $('sppDrop'); if (!d) return;
    ['dragenter', 'dragover'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove('over'); }); });
    d.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) sppPickFile(f); });
  }
  window.sppPickFile = function (file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { say('Please choose an image file', 'error'); return; }
    var r = new FileReader();
    r.onload = function (e) { loadDataUrl(e.target.result, file.name); };
    r.readAsDataURL(file);
  };
  window.sppUseFromPage = function () {
    try {
      if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) { say('Open a page first, or upload a photo here.', 'info'); return; }
      var pg = pdfed.pages[pdfed.active], list = pg.placedImages || [], pick = null;
      if (typeof pdfedSelectedImgs !== 'undefined' && pdfedSelectedImgs.size) {
        list.forEach(function (it) { if (pdfedSelectedImgs.has(it.id)) pick = it; });
      }
      if (!pick && list.length) pick = list[list.length - 1];
      if (!pick) { say('No image on this page yet. Upload a photo here instead.', 'info'); return; }
      loadDataUrl(pick.dataUrl, 'Page image');
    } catch (e) { say('Could not read the image from the page', 'error'); }
  };
  // Resolution tiers. SRC_MAX is the sharp source used for export; PROC_MAX is the light
  // copy used for background analysis and cutout sliders so they stay responsive.
  var SRC_MAX = 3200, PROC_MAX = 1200;
  // High-quality downscale in halving steps (single big jumps alias badly).
  function shrink(src, maxD) {
    var k = Math.min(1, maxD / Math.max(src.width, src.height));
    if (k >= 1) return src;
    var c = src;
    while (Math.max(c.width, c.height) * 0.5 > maxD) {
      var h = mk(c.width / 2, c.height / 2), hx = h.getContext('2d');
      hx.imageSmoothingQuality = 'high'; hx.drawImage(c, 0, 0, h.width, h.height); c = h;
    }
    var f = mk(src.width * k, src.height * k), fx = f.getContext('2d');
    fx.imageSmoothingQuality = 'high'; fx.drawImage(c, 0, 0, f.width, f.height);
    return f;
  }
  // A cached smaller copy of a big canvas, for drawing it small (live preview) without
  // resampling millions of pixels every frame. Bucketed so tiny size changes reuse it.
  function mipFor(c, needLong) {
    var long = Math.max(c.width, c.height), key = Math.ceil(needLong / 64) * 64;
    if (key >= long * 0.75) return c;
    var m = c._mips || (c._mips = {});
    if (!m[key]) {
      var ks = Object.keys(m); if (ks.length >= 4) delete m[ks[0]];
      m[key] = shrink(c, key);
    }
    return m[key];
  }
  function loadDataUrl(url, name, silent, cb) {
    var im = new Image();
    im.onload = function () {
      // Full-quality source (never upscaled). Falls back to smaller sizes if the browser can't allocate it.
      var c = null, caps = [SRC_MAX, 2048, PROC_MAX];
      for (var i = 0; i < caps.length && !c; i++) {
        try {
          var k = Math.min(1, caps[i] / Math.max(im.naturalWidth, im.naturalHeight));
          var t = mk(im.naturalWidth * k, im.naturalHeight * k), x = t.getContext('2d');
          x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, t.width, t.height); c = t;
        } catch (e) { c = null; }
      }
      if (!c) { say('That photo is too large for this browser. Try a smaller one.', 'error'); if (cb) cb(new Error('that photo is too large for this browser')); return; }
      S.live = null;   // a new picture ends any live chart source
      S.srcNat = [im.naturalWidth, im.naturalHeight];
      S.srcCanvas = c; S.procCanvas = shrink(c, PROC_MAX); S.srcName = name || 'Product';
      drawOrig(); updateDimTags();
      S._srcUrl = silent ? url : null;
      analyseBorder();
      scheduleCut(0);
      if (!silent && window.sppSaveSoon) window.sppSaveSoon();
      if (cb) cb();
    };
    im.onerror = function () { say('That image could not be opened', 'error'); if (cb) cb(new Error('that image could not be opened')); };
    im.src = url;
  }

  // Looks at the photo's outer ring: what colour is the backdrop, and is it
  // already transparent? Feeds both the cutout and the "Matched" background.
  function analyseBorder() {
    var c = S.procCanvas || S.srcCanvas, w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    var ring = Math.max(2, Math.round(Math.min(w, h) * 0.012)), n = 0, tr = 0, R = 0, G = 0, B = 0, R2 = 0, G2 = 0, B2 = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (x >= ring && x < w - ring && y >= ring && y < h - ring) { x = w - ring - 1; continue; }
        var i = (y * w + x) * 4; n++;
        if (d[i + 3] < 240) { tr++; continue; }
        R += d[i]; G += d[i + 1]; B += d[i + 2]; R2 += d[i] * d[i]; G2 += d[i + 1] * d[i + 1]; B2 += d[i + 2] * d[i + 2];
      }
    }
    S.hasAlpha = tr / Math.max(1, n) > 0.5;
    var m = Math.max(1, n - tr);
    if (S.hasAlpha) { S.bgColor = { r: 238, g: 241, b: 246 }; S.busy = false; setCutNote('This photo already has a transparent background, so no cutout is needed.', false); return; }
    S.bgColor = { r: R / m, g: G / m, b: B / m };
    var sd = Math.sqrt(Math.max(0, (R2 / m - S.bgColor.r * S.bgColor.r) + (G2 / m - S.bgColor.g * S.bgColor.g) + (B2 / m - S.bgColor.b * S.bgColor.b)));
    S.bgSpread = sd;
    setCutNote(sd > 38 ? 'The photo background looks busy, so the cutout may be rough. Try a lower tolerance, or turn Remove background off to rotate the whole photo as a card.'
      : 'Works best on a plain, single-colour photo background. If the cutout eats into your product, lower the tolerance.', sd > 38);
  }
  function setCutNote(t, warn) { var n = $('sppCutNote'); if (n) { n.textContent = t; n.className = 'spp-note' + (warn ? ' warn' : ''); } }

  /* ───────────────────────── background removal ───────────────────────── */
  function scheduleCut(ms) {
    clearTimeout(S.cutTimer);
    S.cutTimer = setTimeout(function () { try { rebuildCut(); } catch (e) { console.error('Showcase cutout failed', e); say('Cutout failed. Try turning Remove background off.', 'error'); } }, ms);
  }
  function rebuildCut() {
    var src = S.srcCanvas; if (!src || S.o.fit === 'gallery') return;
    if (S.o.fit === 'fill') {   // Fill to edges: the whole photo is used as it is, no cutout, no crop
      S.cut = src; S.cutVer++; S.spriteKey = ''; $('sppEmptyMsg').style.display = 'none'; return;
    }
    // Analysis runs on the light proxy so the sliders stay fast; the result is applied to the full-res photo.
    var pr = S.procCanvas || src, w = pr.width, h = pr.height, work = mk(w, h), wx = work.getContext('2d');
    wx.drawImage(pr, 0, 0);
    var id = wx.getImageData(0, 0, w, h), d = id.data, masked = false;
    if (S.o.cutout && !S.hasAlpha) {
      var fg = floodMask(d, w, h, S.bgColor, S.o.tol);
      keepMainParts(fg, w, h);
      for (var t = 0; t < S.o.trim; t++) erode(fg, w, h);
      var a = new Uint8Array(w * h);
      for (var i = 0; i < a.length; i++) a[i] = fg[i] ? 255 : 0;
      if (S.o.soft > 0) blurAlpha(a, w, h, S.o.soft);
      for (var j = 0; j < a.length; j++) d[j * 4 + 3] = Math.min(d[j * 4 + 3], a[j]);
      wx.putImageData(id, 0, 0); masked = true;
    }
    // crop to the product's bounding box (found on the proxy)
    var minX = w, minY = h, maxX = -1, maxY = -1, thr = S.o.cutout || S.hasAlpha ? 12 : -1;
    if (thr < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
    else {
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > thr) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; say('Nothing was left after the cutout. Try a lower tolerance.', 'error'); }
    }
    var pad = 2; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    // full-resolution pixels, with the (smoothly upscaled) mask applied
    var FW = src.width, FH = src.height, fxs = FW / w, fys = FH / h, big;
    if (FW === w && FH === h) big = masked ? work : src;
    else if (masked) {
      big = mk(FW, FH); var bx = big.getContext('2d');
      bx.drawImage(src, 0, 0); bx.globalCompositeOperation = 'destination-in'; bx.imageSmoothingQuality = 'high';
      bx.drawImage(work, 0, 0, FW, FH);
    } else big = src;
    var x0 = Math.floor(minX * fxs), y0 = Math.floor(minY * fys), x1 = Math.min(FW, Math.ceil((maxX + 1) * fxs)), y1 = Math.min(FH, Math.ceil((maxY + 1) * fys));
    var cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0), cut = mk(cw, ch);
    cut.getContext('2d').drawImage(big, x0, y0, cw, ch, 0, 0, cw, ch);
    S.cut = cut; S.cutVer++; S.spriteKey = '';
    // average product colour → used for the darker "side wall" of the slab
    var sm = mk(12, 12), sx = sm.getContext('2d'); sx.drawImage(cut, 0, 0, 12, 12);
    var sd = sx.getImageData(0, 0, 12, 12).data, rr = 0, gg = 0, bb = 0, aa = 0;
    for (var p = 0; p < sd.length; p += 4) { var al = sd[p + 3]; rr += sd[p] * al; gg += sd[p + 1] * al; bb += sd[p + 2] * al; aa += al; }
    S.edgeRGB = aa ? [rr / aa, gg / aa, bb / aa] : [70, 70, 70];
    $('sppEmptyMsg').style.display = 'none';
  }
  function floodMask(d, w, h, bg, tol) {
    var n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n), sp = 0, t2 = tol * tol;
    function near(i) {
      var k = i * 4, dr = d[k] - bg.r, dg = d[k + 1] - bg.g, db = d[k + 2] - bg.b;
      return d[k + 3] < 20 || (dr * dr + dg * dg + db * db) < t2;
    }
    function push(i) { if (!seen[i] && near(i)) { seen[i] = 1; stack[sp++] = i; } }
    var x, y;
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      var i = stack[--sp], px = i % w;
      if (px > 0) push(i - 1);
      if (px < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
    var fg = new Uint8Array(n);
    for (var q = 0; q < n; q++) fg[q] = seen[q] ? 0 : 1;
    return fg;
  }
  // drop specks and stray shadows: keep only sizeable pieces of foreground
  function keepMainParts(fg, w, h) {
    var n = w * h, lab = new Int32Array(n), sizes = [0], cur = 0, stack = new Int32Array(n);
    for (var s = 0; s < n; s++) {
      if (!fg[s] || lab[s]) continue;
      cur++; var sp = 0, cnt = 0; stack[sp++] = s; lab[s] = cur;
      while (sp) {
        var i = stack[--sp]; cnt++; var px = i % w;
        if (px > 0 && fg[i - 1] && !lab[i - 1]) { lab[i - 1] = cur; stack[sp++] = i - 1; }
        if (px < w - 1 && fg[i + 1] && !lab[i + 1]) { lab[i + 1] = cur; stack[sp++] = i + 1; }
        if (i >= w && fg[i - w] && !lab[i - w]) { lab[i - w] = cur; stack[sp++] = i - w; }
        if (i < n - w && fg[i + w] && !lab[i + w]) { lab[i + w] = cur; stack[sp++] = i + w; }
      }
      sizes[cur] = cnt;
    }
    var big = 0; for (var k = 1; k <= cur; k++) if (sizes[k] > big) big = sizes[k];
    for (var q = 0; q < n; q++) if (fg[q] && sizes[lab[q]] < big * 0.02) fg[q] = 0;
  }
  function erode(fg, w, h) {
    var out = new Uint8Array(fg.length);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      out[i] = (fg[i] && fg[i - 1] && fg[i + 1] && fg[i - w] && fg[i + w]) ? 1 : 0;
    }
    fg.set(out);
  }
  function blurAlpha(a, w, h, r) {
    var tmp = new Uint8Array(a.length), k = 2 * r + 1, x, y, j, s;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; for (j = -r; j <= r; j++) s += a[y * w + clamp(x + j, 0, w - 1)];
      tmp[y * w + x] = s / k;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; for (j = -r; j <= r; j++) s += tmp[clamp(y + j, 0, h - 1) * w + x];
      a[y * w + x] = s / k;
    }
  }

  /* ───────────────────────── sprites (pre-scaled copies for fast frames) ───────────────────────── */
  // Texture for the can/bottle spin: every column is stretched to full height using its own top and
  // bottom colours, so nothing transparent can slide into view. The fixed product outline is applied on top.
  function buildWrapTex(front, dw, dh) {
    var x = front.getContext('2d'), src = x.getImageData(0, 0, dw, dh), d = src.data;
    var top = new Int32Array(dw).fill(-1), bot = new Int32Array(dw).fill(-1), i, y;
    for (i = 0; i < dw; i++) {
      for (y = 0; y < dh; y++) if (d[(y * dw + i) * 4 + 3] > 60) { top[i] = y; break; }
      for (y = dh - 1; y >= 0; y--) if (d[(y * dw + i) * 4 + 3] > 60) { bot[i] = y; break; }
    }
    for (i = 0; i < dw; i++) if (top[i] < 0) { // empty column: borrow from nearest column that has content
      var r = 1; while (r < dw && (i - r < 0 || top[i - r] < 0) && (i + r >= dw || top[i + r] < 0)) r++;
      var j = (i - r >= 0 && top[i - r] >= 0) ? i - r : Math.min(dw - 1, i + r);
      top[i] = top[j]; bot[i] = bot[j];
    }
    var out = x.createImageData(dw, dh), o = out.data;
    for (i = 0; i < dw; i++) {
      var t = Math.max(0, top[i]), b = Math.max(t, bot[i]);
      for (y = 0; y < dh; y++) {
        var sy = y < t ? t : (y > b ? b : y), k = (sy * dw + i) * 4, m = (y * dw + i) * 4;
        o[m] = d[k]; o[m + 1] = d[k + 1]; o[m + 2] = d[k + 2]; o[m + 3] = 255;
      }
    }
    var c = mk(dw, dh); c.getContext('2d').putImageData(out, 0, 0); return c;
  }

  function getSprites(dw, dh) {
    dw = Math.max(2, Math.round(dw)); dh = Math.max(2, Math.round(dh));
    var key = dw + 'x' + dh + ':' + S.cutVer;
    if (S.sprites && S.spriteKey === key) return S.sprites;
    var front = mk(dw, dh), fx = front.getContext('2d');
    fx.imageSmoothingQuality = 'high'; fx.drawImage(mipFor(S.cut, Math.max(dw, dh)), 0, 0, dw, dh);
    function tinted(col, alpha, mode) {
      var c = mk(dw, dh), x = c.getContext('2d');
      x.drawImage(front, 0, 0);
      x.globalCompositeOperation = mode; x.fillStyle = col; x.globalAlpha = alpha; x.fillRect(0, 0, dw, dh);
      return c;
    }
    var e = S.edgeRGB, edgeCol = 'rgb(' + Math.round(e[0] * .55) + ',' + Math.round(e[1] * .55) + ',' + Math.round(e[2] * .55) + ')';
    var plain = mk(dw, dh), px = plain.getContext('2d');
    px.drawImage(front, 0, 0); px.globalCompositeOperation = 'source-in';
    var pg = px.createLinearGradient(0, 0, 0, dh);
    pg.addColorStop(0, 'rgb(' + Math.round(e[0] * .92) + ',' + Math.round(e[1] * .92) + ',' + Math.round(e[2] * .92) + ')');
    pg.addColorStop(1, 'rgb(' + Math.round(e[0] * .68) + ',' + Math.round(e[1] * .68) + ',' + Math.round(e[2] * .68) + ')');
    px.fillStyle = pg; px.fillRect(0, 0, dw, dh);
    S.sprites = {
      w: dw, h: dh, front: front, plain: plain,
      edge: tinted(edgeCol, 1, 'source-in'),
      shade: tinted('#000', 1, 'source-in'),
      back: tinted('#000', 0.38, 'source-atop'),
      wrapTex: null
    };
    S.sprites.wrapTex = buildWrapTex(front, dw, dh);
    S.spriteKey = key;
    return S.sprites;
  }

  /* ───────────────────────── frame drawing ───────────────────────── */
  function layerCanvas(name, W, H) {
    var c = S.layers[name];
    if (!c || c.width !== W || c.height !== H) { c = S.layers[name] = mk(W, H); }
    else c.getContext('2d').clearRect(0, 0, W, H);
    return c;
  }
  function motionState(tn) {
    var o = S.o, TAU = Math.PI * 2, st = { theta: 0, dy: 0, rz: 0 };
    if (o.motion === 'turntable' || o.motion === 'wrap') st.theta = o.dir * TAU * tn;
    else if (o.motion === 'sway') st.theta = o.dir * (o.amp * Math.PI / 180) * Math.sin(TAU * tn);
    else if (o.motion === 'hover') { st.theta = o.dir * 0.26 * Math.sin(TAU * tn); st.dy = -Math.sin(TAU * tn * 2) * 0.018; st.rz = Math.sin(TAU * tn + 1.1) * 0.03; }
    else if (o.motion === 'chilldrop') st.theta = o.dir * chillState(tn).th;
    return st;
  }
  /* ───────────────────────── Chill Drop: speed-ramped cold-drink ad motion ───────────────────────── */
  // One loop: a spin-and-zoom intro, then THREE close-up cycles, each from a different angle, then a slow turn home.
  //  0.00 spin + zoom / each cycle (0.22): rush in, slow motion, snap out / 0.80 slow turn / 0.94 settle
  var CHILL_CYC = [
    { a: 0.14, z0: 2.8, z1: 3.0, th: 0,    th1: 0,     fy: -0.3 },   // 1: straight on, the cap
    { a: 0.36, z0: 2.4, z1: 2.6, th: 0.5,  th1: 0.7,   fy: 0.05 },   // 2: turned one way, the label
    { a: 0.58, z0: 2.6, z1: 2.8, th: -0.5, th1: -0.75, fy: 0.3 }     // 3: turned the other way, the base
  ];
  function chillPuff(t, a) { return t < a ? 0 : clamp(1 - (t - a) / 0.12, 0, 1) * clamp((t - a) / 0.02, 0, 1); }
  function chillState(tn) {
    var t = tn - Math.floor(tn), q, u, i, c, pv;
    var s = { t: t, z: 1, th: 0, fy: 0, blur: 0, shake: 0, mist: 0, frost: 0.25, sweep: -1, sweep2: -1, ci: 0 };
    if (t < 0.14) { q = t / 0.14; s.th = 6.2832 * ease(q); s.z = 1 + 0.45 * Math.sin(Math.PI * q); s.sweep = (q - 0.15) / 0.7; }
    else if (t < 0.80) {
      i = Math.min(2, Math.floor((t - 0.14) / 0.22)); c = CHILL_CYC[i]; s.ci = i; u = t - c.a; s.fy = c.fy; pv = i ? CHILL_CYC[i - 1].th1 : 0;
      if (u < 0.05) { q = u / 0.05; s.z = 1 + (c.z0 - 1) * q * q; s.th = pv + (c.th - pv) * ease(q); s.blur = q * q; s.frost = 0.25 + 0.1 * q; }
      else if (u < 0.17) { q = (u - 0.05) / 0.12; s.z = c.z0 + (c.z1 - c.z0) * ease(q); s.th = c.th + (c.th1 - c.th) * ease(q); s.frost = 0.35 + 0.45 * ease(q); if (i === 0) s.sweep = q / 0.6; else s.sweep2 = q / 0.6; }
      else { q = (u - 0.17) / 0.05; s.z = c.z1 - (c.z1 - 1) * ease(q); s.th = c.th1; s.blur = Math.sin(Math.PI * q); s.shake = q < 0.4 ? 1 - q / 0.4 : 0; s.frost = 0.8 - 0.55 * ease(q); }
    }
    else if (t < 0.94) { q = (t - 0.80) / 0.14; s.ci = 2; s.z = 1 + 0.12 * ease(q); s.th = CHILL_CYC[2].th1 * (1 - ease(q)); s.sweep = (q - 0.2) / 0.6; }
    else { q = (t - 0.94) / 0.06; s.z = 1.12 - 0.12 * ease(q); }
    s.mist = Math.max(chillPuff(t, 0.31), chillPuff(t, 0.53), chillPuff(t, 0.75));
    return s;
  }
  // The room the product is standing in: the backdrop colour (or the photo's own background), pulled a little cold
  function chillEnv() {
    var base = backdropColor() || S.bgColor || { r: 170, g: 205, b: 235 };
    return mix(base, { r: 150, g: 210, b: 255 }, 0.5);
  }
  // Drawn onto the product layer only (source-atop), so nothing spills outside the bottle
  function chillSkin(pc, cx, cy, dw, dh, tn, W) {
    var b = chillState(tn), ec = chillEnv(), lite = mix(ec, { r: 255, g: 255, b: 255 }, 0.6), x0 = cx - dw / 2, y0 = cy - dh / 2, i, g, sh;
    pc.save(); pc.globalCompositeOperation = 'source-atop';
    // 1. the product catches its room: backdrop colour washes the edges and slides across as it turns
    sh = Math.sin(b.th) * dw * 0.4;
    g = pc.createLinearGradient(x0 + sh, 0, x0 + dw + sh, 0);
    g.addColorStop(0, rgbStr(ec, 0.34)); g.addColorStop(0.22, rgbStr(ec, 0)); g.addColorStop(0.78, rgbStr(ec, 0)); g.addColorStop(1, rgbStr(lite, 0.3));
    pc.fillStyle = g; pc.fillRect(x0 - dw * 0.3, y0, dw * 1.6, dh);
    // 2. cold: a faint blue wash that deepens in the slow beats
    pc.fillStyle = rgbStr({ r: 110, g: 175, b: 255 }, 0.05 + 0.09 * b.frost); pc.fillRect(x0 - dw * 0.3, y0, dw * 1.6, dh);
    // 3. frost haze climbing from the base
    g = pc.createLinearGradient(0, y0 + dh, 0, y0 + dh * (1 - 0.5 * b.frost));
    g.addColorStop(0, rgbStr(lite, 0.34 * b.frost)); g.addColorStop(1, rgbStr(lite, 0));
    pc.fillStyle = g; pc.fillRect(x0 - dw * 0.3, y0, dw * 1.6, dh);
    // 4. condensation: tiny beads that STAY on the glass and misted up in the slow beats (no moving orbs)
    var bead = Math.min(1, 0.25 + b.frost * 0.9);
    for (i = 0; i < 90; i++) {
      var px = x0 + dw * (0.1 + 0.8 * rnd(i, 9)), py = y0 + dh * (0.05 + 0.9 * rnd(i, 2)), r = dw * 0.0032 * (0.6 + rnd(i, 5) * 1.1), al = (0.12 + 0.22 * rnd(i, 7)) * bead;
      pc.fillStyle = rgbStr(lite, al); pc.beginPath(); pc.arc(px, py, r, 0, Math.PI * 2); pc.fill();
      pc.fillStyle = 'rgba(255,255,255,' + (al * 1.4) + ')'; pc.beginPath(); pc.arc(px - r * 0.3, py - r * 0.35, r * 0.35, 0, Math.PI * 2); pc.fill();
    }
    // 5. a few thin runs sliding down the glass during slow motion
    var run = clamp((b.frost - 0.3) / 0.5, 0, 1);
    if (run > 0.02) for (i = 0; i < 6; i++) {
      var rx = x0 + dw * (0.2 + 0.6 * rnd(i, 21)), ph = (b.t * 1.5 + rnd(i, 22)) % 1, ry = y0 + dh * (0.14 + 0.62 * ph), len = dh * (0.05 + 0.07 * rnd(i, 23)), fa = Math.sin(Math.PI * ph) * run;
      var tg = pc.createLinearGradient(0, ry - len, 0, ry);
      tg.addColorStop(0, rgbStr(lite, 0)); tg.addColorStop(1, rgbStr(lite, 0.3 * fa));
      pc.fillStyle = tg; pc.fillRect(rx - dw * 0.0018, ry - len, dw * 0.0036, len);
    }
    // 6. light glints: sweeping across the glass in each slow beat
    function beam(q, al) {
      if (q < 0 || q > 1) return;
      var bw = dw * 0.2, bg;
      pc.save(); pc.translate(x0 + dw * (-0.3 + 1.6 * q), cy); pc.rotate(0.35);
      bg = pc.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      bg.addColorStop(0, rgbStr(lite, 0)); bg.addColorStop(0.5, rgbStr(lite, al)); bg.addColorStop(1, rgbStr(lite, 0));
      pc.fillStyle = bg; pc.fillRect(-bw / 2, -dh, bw, dh * 2); pc.restore();
    }
    beam(b.sweep, 0.55); beam(b.sweep2, 0.5);
    pc.restore();
  }
  // The camera: scene is drawn into its own layer through a zoom, then placed on the frame with blur, frost and mist
  function drawChill(ctx, W, H, tn, opt) {
    var b = chillState(tn), L = layout(W, H), kz = clamp((b.z - 1) / 1.6, 0, 1);
    var fx = L.cx, fy = L.cy + b.fy * L.boxH;                      // each close-up lands on its own part of the product
    var cx = W / 2 + (fx - W / 2) * kz, cy = H / 2 + (fy - H / 2) * kz, sk = b.shake * W * 0.006, i, gs;
    var lay = layerCanvas('chcam', W, H), lx = lay.getContext('2d');
    lx.save();
    lx.translate(W / 2 + Math.sin(tn * 900) * sk, H / 2 + Math.cos(tn * 770) * sk);
    lx.scale(b.z, b.z); lx.translate(-cx, -cy);
    drawBackground(lx, W, H, opt.flatten); drawProduct(lx, W, H, tn);
    lx.restore();
    ctx.drawImage(lay, 0, 0);
    if (b.blur > 0.04) {                                            // zoom blur on the fast beats
      for (i = 1; i <= 3; i++) {
        gs = 1 + i * 0.04 * b.blur;
        ctx.save(); ctx.globalAlpha = 0.17 * b.blur; ctx.translate(W / 2, H / 2); ctx.scale(gs, gs); ctx.translate(-W / 2, -H / 2); ctx.drawImage(lay, 0, 0); ctx.restore();
      }
    }
    var ec = chillEnv(), fc = mix(ec, { r: 255, g: 255, b: 255 }, 0.55), fg, mg, mx, my, mr;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';                  // cold grade, only where there is picture
    ctx.fillStyle = 'rgba(110,175,255,0.07)'; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    fg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.78);   // frost creeping in from the edges
    fg.addColorStop(0, rgbStr(fc, 0)); fg.addColorStop(1, rgbStr(fc, 0.5 * b.frost));
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    if (b.mist > 0.01) {                                            // the puff of cold air on each snap back
      for (i = 0; i < 7; i++) {
        mx = W * (0.15 + 0.7 * rnd(i, 3)); my = H * (0.62 + 0.14 * rnd(i, 8)) - (1 - b.mist) * H * 0.1; mr = W * (0.18 + 0.2 * rnd(i, 6)) * (1.5 - 0.6 * b.mist);
        mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
        mg.addColorStop(0, rgbStr(fc, 0.22 * b.mist)); mg.addColorStop(1, rgbStr(fc, 0));
        ctx.fillStyle = mg; ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
      }
    }
  }
  /* ───────────────────────── Chill Drop in all three models ─────────────────────────
     Product cutout  - the original: the bottle spins, three close-ups, mist.
     Fill to edges   - the same speed-ramped move on a full-frame photo. The camera rushes into three different spots, slows down with frost and a light glint, and snaps back with a puff of mist.
     Multi-photo     - SMART CHILL DROP. Every photo gets its own version of the move: the close-up spots are found automatically, the number of close-ups follows the time each photo is on screen,
                       odd-shaped photos stay whole on a soft blur, frost and glints take each photo's own colours, and one photo fogs over and clears into the next. */
  var CHILL_DEF = [{ x: 0.5, y: 0.42 }, { x: 0.3, y: 0.56 }, { x: 0.7, y: 0.6 }];
  var CHILL_NOTES = {
    fill: 'Cold-drink ad move for a full-frame photo: a quick zoom and tilt, then three close-ups on the busiest, most colourful spots of your photo, each rushing in, slowing down with frost and a light glint, and snapping back with a puff of mist. The spots are found for you. Length is set to about 12 seconds. Best with a sharp, high resolution photo.',
    gal: 'Smart Chill Drop: every photo gets its own cold-drink move. The close-up spots are found automatically, the number of close-ups follows how long each photo is on screen, odd-shaped photos stay whole on a soft blur, the frost and glints take each photo\u2019s own colours, and one photo fogs over and clears into the next. Length is set for you (about 7 seconds per photo).'
  };
  // Where the close-ups land on a photo: the three busiest, most colourful places, kept well apart. Cached on the photo.
  function chillHot(c) {
    if (c._hot) return c._hot;
    var s = 40, t = mk(s, s), tx = t.getContext('2d'), d, i, j, k, n = s * s, L = [], Wt = [], Sm = [], R = 0, G = 0, B = 0, out = [], pk, bx, by, bv, sx, sy, sw, a, u, v, p, q, e, gx, gy, cd, cb, dd, acc, cnt;
    try { tx.drawImage(c, 0, 0, s, s); d = tx.getImageData(0, 0, s, s).data; } catch (er) { return (c._hot = CHILL_DEF); }
    for (i = 0; i < n; i++) { R += d[i * 4]; G += d[i * 4 + 1]; B += d[i * 4 + 2]; L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; Wt[i] = 0; }
    R /= n; G /= n; B /= n;
    for (j = 1; j < s - 1; j++) for (i = 1; i < s - 1; i++) {
      k = j * s + i; gx = L[k + 1] - L[k - 1]; gy = L[k + s] - L[k - s]; e = Math.sqrt(gx * gx + gy * gy);
      cd = (Math.abs(d[k * 4] - R) + Math.abs(d[k * 4 + 1] - G) + Math.abs(d[k * 4 + 2] - B)) / 765;
      cb = 1 - Math.min(1, Math.hypot(i / s - 0.5, j / s - 0.5) * 1.5);
      Wt[k] = (e * 2 + cd) * (0.35 + cb);
    }
    for (j = 0; j < s; j++) for (i = 0; i < s; i++) {                 // 5x5 average: a whole region wins over one noisy pixel
      acc = 0; cnt = 0;
      for (v = -2; v <= 2; v++) for (u = -2; u <= 2; u++) { q = j + v; p = i + u; if (q < 0 || p < 0 || q >= s || p >= s) continue; acc += Wt[q * s + p]; cnt++; }
      Sm[j * s + i] = acc / cnt;
    }
    for (pk = 0; pk < 3; pk++) {
      bv = -1; bx = s / 2; by = s / 2;
      for (j = 4; j < s - 4; j++) for (i = 4; i < s - 4; i++) if (Sm[j * s + i] > bv) { bv = Sm[j * s + i]; bx = i; by = j; }
      if (bv <= 0.004) break;
      sx = 0; sy = 0; sw = 0;
      for (v = -3; v <= 3; v++) for (u = -3; u <= 3; u++) { q = by + v; p = bx + u; if (q < 0 || p < 0 || q >= s || p >= s) continue; a = Sm[q * s + p]; sx += a * p; sy += a * q; sw += a; }
      out.push({ x: clamp((sx / sw + 0.5) / s, 0.16, 0.84), y: clamp((sy / sw + 0.5) / s, 0.16, 0.84) });
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) { dd = Math.hypot(i - bx, j - by) / s; if (dd < 0.3) Sm[j * s + i] *= (dd / 0.3) * (dd / 0.3); }
    }
    while (out.length < 3) out.push(CHILL_DEF[out.length]);
    return (c._hot = out);
  }
  // The photo's own cold: its strongest colour, pulled toward ice blue
  function chillEnvPhoto(c) {
    var inf = galInfo(c), v = inf.vivid, a = inf.avg;
    return mix({ r: (v[0] + a[0]) / 2, g: (v[1] + a[1]) / 2, b: (v[2] + a[2]) / 2 }, { r: 150, g: 210, b: 255 }, 0.5);
  }
  // Never enlarge a photo more than about 1.6x: sph = frame pixels per photo pixel at export size. Measured at export size so the preview and the video zoom the same amount.
  function chillZk(sph) { return clamp((1.6 / Math.max(sph, 0.01) - 1) / 2, 0.3, 1); }
  // Cold look on top of the camera: zoom ghosts on the fast beats, cold grade, frost creeping in from the edges, puffs of mist
  function chillFinish(ctx, W, H, b, lay, ec) {
    var fc = mix(ec, { r: 255, g: 255, b: 255 }, 0.55), i, gs, fg, mg, mx, my, mr;
    if (b.blur > 0.04) for (i = 1; i <= 3; i++) {
      gs = 1 + i * 0.04 * b.blur;
      ctx.save(); ctx.globalAlpha = 0.17 * b.blur; ctx.translate(W / 2, H / 2); ctx.scale(gs, gs); ctx.translate(-W / 2, -H / 2); ctx.drawImage(lay, 0, 0); ctx.restore();
    }
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(110,175,255,0.07)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    fg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.78);
    fg.addColorStop(0, rgbStr(fc, 0)); fg.addColorStop(1, rgbStr(fc, 0.5 * b.frost));
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    if (b.mist > 0.01) for (i = 0; i < 7; i++) {
      mx = W * (0.15 + 0.7 * rnd(i, 3)); my = H * (0.62 + 0.14 * rnd(i, 8)) - (1 - b.mist) * H * 0.1; mr = W * (0.18 + 0.2 * rnd(i, 6)) * (1.5 - 0.6 * b.mist);
      mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, rgbStr(fc, 0.22 * b.mist)); mg.addColorStop(1, rgbStr(fc, 0));
      ctx.fillStyle = mg; ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    }
  }
  // Water beads on the lens in the slow beats, and the light glints sweeping across
  function chillLens(ctx, W, H, b, ec, seed) {
    var lite = mix(ec, { r: 255, g: 255, b: 255 }, 0.6), u = Math.min(W, H), i, px, py, em, r, al, bead = clamp((b.frost - 0.3) / 0.5, 0, 1) * (1 - (b.fog || 0));
    if (bead > 0.02) for (i = 0; i < 80; i++) {
      px = W * rnd(i + seed, 9); py = H * rnd(i + seed, 2); em = clamp((Math.hypot(px / W - 0.5, py / H - 0.5) - 0.2) / 0.3, 0, 1);
      if (em <= 0) continue;
      r = u * 0.0042 * (0.6 + rnd(i, 5) * 1.1); al = (0.14 + 0.22 * rnd(i, 7)) * bead * em;
      ctx.fillStyle = rgbStr(lite, al); ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (al * 1.4) + ')'; ctx.beginPath(); ctx.arc(px - r * 0.3, py - r * 0.35, r * 0.35, 0, 6.2832); ctx.fill();
    }
    function beam(q, a) {
      if (q < 0 || q > 1) return;
      var bw = W * 0.22, bg;
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.translate(W * (-0.3 + 1.6 * q), H / 2); ctx.rotate(0.35);
      bg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0); bg.addColorStop(0, rgbStr(lite, 0)); bg.addColorStop(0.5, rgbStr(lite, a * 0.7)); bg.addColorStop(1, rgbStr(lite, 0));
      ctx.fillStyle = bg; ctx.fillRect(-bw / 2, -H * 1.2, bw, H * 2.4);
      bg = ctx.createLinearGradient(-bw * 0.07, 0, bw * 0.07, 0); bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(0.5, 'rgba(255,255,255,' + a * 0.8 + ')'); bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg; ctx.fillRect(-bw * 0.07, -H * 1.2, bw * 0.14, H * 2.4);
      ctx.restore();
    }
    beam(b.sweep, 0.5); beam(b.sweep2, 0.45);
  }
  // The camera for a flat photo. scene(lx, z) paints the photo through the zoom; fp is the spot the close-up lands on; fog is an optional blurred copy for the fog dissolve.
  function chillCam(ctx, W, H, tn, b, scene, fp, ec, zk, fog, seed) {
    var z = 1 + (b.z - 1) * zk, kz = clamp((b.z - 1) / 1.6, 0, 1), hw = W / (2 * z), hh = H / (2 * z);
    var cx = clamp(W / 2 + (fp.x - W / 2) * kz, hw, W - hw), cy = clamp(H / 2 + (fp.y - H / 2) * kz, hh, H - hh);     // the window never leaves the picture
    var sk = b.shake * W * 0.006, rot = Math.sin(b.th) * 0.05 * clamp((b.z - 1) / 0.5, 0, 1), dy = -(z - 1) * H * 0.3 * (b.drop || 0);
    var lay = layerCanvas('chcam', W, H), lx = lay.getContext('2d');
    lx.save();
    lx.translate(W / 2 + Math.sin(tn * 900) * sk, H / 2 + dy + Math.cos(tn * 770) * sk);
    lx.rotate(rot); lx.scale(z, z); lx.translate(-cx, -cy);
    scene(lx, z); lx.restore();
    ctx.drawImage(lay, 0, 0);
    if (fog && b.fog > 0.01) {
      ctx.save(); ctx.globalAlpha = clamp(b.fog, 0, 1); ctx.drawImage(fog, 0, 0); ctx.restore();
      ctx.fillStyle = rgbStr(mix(ec, { r: 255, g: 255, b: 255 }, 0.6), 0.42 * b.fog); ctx.fillRect(0, 0, W, H);
    }
    chillFinish(ctx, W, H, b, lay, ec);
    chillLens(ctx, W, H, b, ec, seed || 0);
  }
  // FILL TO EDGES: the product move, aimed at the photo's own busiest spots
  function drawFillChill(ctx, W, H, tn) {
    var c = S.cut, b = chillState(tn), s0 = Math.max(W / c.width, H / c.height), dw = c.width * s0, dh = c.height * s0, fx0 = (W - dw) / 2, fy0 = (H - dh) / 2;
    var E = EXPORT[S.o.ratio] || EXPORT['16:9'], live = !!S.live, hot = CHILL_DEF, ec, zk, h;
    try { ec = live ? chillEnv() : chillEnvPhoto(c); if (!live) hot = chillHot(c); } catch (er) { ec = chillEnv(); hot = CHILL_DEF; }
    zk = live ? 0.55 : chillZk(Math.max(E[0] / c.width, E[1] / c.height));
    h = hot[Math.min(2, b.ci || 0)];
    chillCam(ctx, W, H, tn, b, function (lx, z) { lx.imageSmoothingQuality = 'high'; lx.drawImage(mipFor(c, Math.max(dw, dh) * z), fx0, fy0, dw, dh); },
      { x: fx0 + h.x * dw, y: fy0 + h.y * dh }, ec, zk, null, 0);
  }
  // MULTI-PHOTO: where a photo sits in the frame (subject-centred fill, or whole on a soft blur when its shape does not match), and how it is painted through the camera
  function chillPlace(c, W, H) {
    var s, dw, dh, cr;
    if (galMism(c, W, H)) { s = Math.min(W / c.width, H / c.height) * 0.88; dw = c.width * s; dh = c.height * s; return { m: 1, dw: dw, dh: dh, ox: (W - dw) / 2, oy: (H - dh) / 2, s: s }; }
    cr = galSafeCrop(c, W, H, 1); return { m: 0, dw: cr.dw, dh: cr.dh, ox: cr.ox, oy: cr.oy, s: cr.dw / c.width };
  }
  function chillPaint(lx, c, pl, W, H, z) {
    lx.imageSmoothingQuality = 'high';
    if (pl.m) {
      lx.drawImage(galBlurBg(c, W, H), 0, 0);
      galShadow(lx, pl.ox, pl.oy, pl.dw, pl.dh, Math.min(pl.dw, pl.dh) * 0.025, Math.min(W, H) * 0.06);
      lx.save(); rr(lx, pl.ox, pl.oy, pl.dw, pl.dh, Math.min(pl.dw, pl.dh) * 0.025); lx.clip();
      lx.drawImage(mipFor(c, Math.max(pl.dw, pl.dh) * z), pl.ox, pl.oy, pl.dw, pl.dh); lx.restore();
    } else lx.drawImage(mipFor(c, Math.max(pl.dw, pl.dh) * z), pl.ox, pl.oy, pl.dw, pl.dh);
  }
  // A soft, blurred copy of the resting frame: this is the fog the photo fades into and out of
  function chillFogCv(c, W, H, paint) {
    var key = W + 'f' + H, h = c._fz || (c._fz = {}), full, t, m, cv, ks;
    if (h[key]) return h[key];
    ks = Object.keys(h); if (ks.length >= 2) delete h[ks[0]];
    full = mk(W, H); paint(full.getContext('2d'), W, H);
    t = mk(36, Math.max(2, Math.round(36 * H / W))); t.getContext('2d').drawImage(full, 0, 0, t.width, t.height);
    m = mk(144, Math.max(2, Math.round(144 * H / W))); m.getContext('2d').imageSmoothingQuality = 'high'; m.getContext('2d').drawImage(t, 0, 0, m.width, m.height);
    cv = mk(W, H); cv.getContext('2d').imageSmoothingQuality = 'high'; cv.getContext('2d').drawImage(m, 0, 0, W, H);
    return (h[key] = cv);
  }
  // One photo's turn: it drops in out of the fog, does K close-ups (each: rush in, slow motion, snap back with mist), then fogs over for the next photo.
  function chillShotState(f, K, ph) {
    var E = 0.13, X = 0.13, cl = (1 - E - X) / K, s = { t: f, z: 1, th: 0, drop: 0, blur: 0, shake: 0, mist: 0, frost: 0.25, fog: 0, sweep: -1, sweep2: -1, ci: 0 }, q, u, i, c, pv, k, a;
    if (f < E) { q = f / E; s.z = 1 + 0.14 * (1 - eo(q)); s.drop = 1 - eo(q); s.fog = 1 - ease(q * 1.15); s.frost = 0.25 + 0.5 * (1 - ease(q)); s.mist = 0.85 * (1 - ease(q)); }
    else if (f < 1 - X) {
      i = Math.min(K - 1, Math.floor((f - E) / cl)); c = CHILL_CYC[i]; u = (f - E - i * cl) / cl; s.ci = i; pv = i ? CHILL_CYC[i - 1].th1 : 0;
      if (u < 0.23) { q = u / 0.23; s.z = 1 + (c.z0 - 1) * q * q; s.th = pv + (c.th - pv) * ease(q); s.blur = q * q; s.frost = 0.25 + 0.1 * q; }
      else if (u < 0.77) { q = (u - 0.23) / 0.54; s.z = c.z0 + (c.z1 - c.z0) * ease(q); s.th = c.th + (c.th1 - c.th) * ease(q); s.frost = 0.35 + 0.45 * ease(q); if ((i + ph) % 2) s.sweep2 = q / 0.6; else s.sweep = q / 0.6; }
      else { q = (u - 0.77) / 0.23; s.z = c.z1 - (c.z1 - 1) * ease(q); s.th = c.th1; s.blur = Math.sin(Math.PI * q); s.shake = q < 0.4 ? 1 - q / 0.4 : 0; s.frost = 0.8 - 0.55 * ease(q); }
    } else {
      q = (f - (1 - X)) / X; s.ci = K - 1; s.z = 1 + 0.07 * ease(q); s.th = CHILL_CYC[K - 1].th1 * (1 - ease(q)); s.fog = ease(q); s.frost = 0.25 + 0.5 * ease(q); s.mist = 0.85 * ease(q);
    }
    for (k = 0; k < K; k++) { a = E + k * cl + 0.77 * cl; if (f >= a) s.mist = Math.max(s.mist, clamp(1 - (f - a) / (0.55 * cl), 0, 1) * clamp((f - a) / (0.09 * cl), 0, 1)); }
    return s;
  }
  function chillShot(ctx, W, H, tn, idx, f, K) {
    var c = S.gal[idx], b = chillShotState(f, K, idx), pl = chillPlace(c, W, H), E = EXPORT[S.o.ratio] || EXPORT['16:9'], plE = chillPlace(c, E[0], E[1]);
    var h = chillHot(c)[Math.min(2, b.ci)], fp = { x: pl.ox + h.x * pl.dw, y: pl.oy + h.y * pl.dh }, ec, zk = chillZk(plE.s), fog = null;
    try { ec = chillEnvPhoto(c); } catch (er) { ec = chillEnv(); }
    if (b.fog > 0.01) fog = chillFogCv(c, W, H, function (x2, w2, h2) { chillPaint(x2, c, pl, w2, h2, 1); });
    chillCam(ctx, W, H, tn, b, function (lx, z) { chillPaint(lx, c, pl, W, H, z); }, fp, ec, zk, fog, idx * 17 + 3);
  }
  function galChill(ctx, W, H, tn, n) {
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), secPer = S.o.secs / n, K = secPer >= 6.5 ? 3 : secPer >= 3.6 ? 2 : 1, XF = 0.065, nx, a;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    chillShot(ctx, W, H, tn, i, f, K);
    if (f > 1 - XF) {                                               // at full fog the next photo takes over, then clears
      nx = layerCanvas('chnx', W, H); chillShot(nx.getContext('2d'), W, H, tn, (i + 1) % n, 0, K);
      a = ease((f - (1 - XF)) / XF); ctx.save(); ctx.globalAlpha = a; ctx.drawImage(nx, 0, 0); ctx.restore();
    }
  }
  function chillSetSecs(v) { window.sppSet('secs', v); if ($('sppSecs')) $('sppSecs').value = v; paintRanges(); say('Length set to ' + v + ' seconds for Chill Drop', 'info'); }
  (function () {   // its note, and the length it needs (set only when the person taps it, never when a saved project loads)
    var f = window.sppSetSeg;
    window.sppSetSeg = function (k, v) {
      var r = f.apply(this, arguments), tap = !!(window.event && window.event.type === 'click'), mn, cn, on;
      if ((k === 'fmotion' || k === 'fit') && S.o.fit === 'fill') { mn = $('sppMotionNote'); if (mn) mn.textContent = S.o.fmotion === 'chilldrop' ? CHILL_NOTES.fill : (MOTION_NOTES[S.o.motion] || ''); }
      if (k === 'fmotion' && v === 'chilldrop' && tap) chillSetSecs(12);
      if (k === 'gal' || k === 'fit') { cn = $('sppChillNote'); on = S.o.fit === 'gallery' && S.o.gal === 'chilldrop'; if (cn) { cn.style.display = on ? '' : 'none'; if (on) cn.textContent = CHILL_NOTES.gal; } }
      if (k === 'gal' && v === 'chilldrop' && tap && S.gal.length) chillSetSecs(clamp(S.gal.length * 7, 6, 30));
      return r;
    };
  })();

  function backdropColor() {
    var o = S.o;
    if (o.bgMode === 'matched') return S.bgColor;
    if (o.bgMode === 'filled') return hexToRgb(o.fillA);
    return null;
  }
  function drawBackground(ctx, W, H, flatten) {
    var o = S.o;
    if (o.bgMode === 'empty') { if (flatten) { ctx.fillStyle = flatten; ctx.fillRect(0, 0, W, H); } return; }
    if (o.bgMode === 'matched') {
      var c = S.bgColor, g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.5, Math.max(W, H) * 0.78);
      g.addColorStop(0, rgbStr(mix(c, { r: 255, g: 255, b: 255 }, 0.14)));
      g.addColorStop(1, rgbStr(mix(c, { r: 0, g: 0, b: 0 }, 0.13)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
    }
    if (o.fillGrad) {
      var lg = ctx.createLinearGradient(0, 0, W * 0.25, H);
      lg.addColorStop(0, o.fillA); lg.addColorStop(1, o.fillB); ctx.fillStyle = lg;
    } else ctx.fillStyle = o.fillA;
    ctx.fillRect(0, 0, W, H);
  }

  // Layout: where the product sits, and where the words go
  function layout(W, H) {
    var o = S.o, e = xtLead(o), portrait = W < H * 1.05, pos = e.txtPos;
    var hasText = !!(e.head || e.sub || e.badge) && pos !== 'center';
    if (portrait && pos === 'left') pos = 'bottom';
    if (portrait && pos === 'right') pos = 'top';
    var L = { pos: pos, hasText: hasText, cx: W / 2, cy: H / 2, boxW: W * 0.7, boxH: H * 0.7 };
    var k = o.size / 100;
    if (!hasText) { L.cx = W / 2; L.cy = H * 0.44; L.boxW = W * 0.72; L.boxH = H * 0.66; }
    else if (pos === 'bottom') { L.cy = H * 0.37; L.boxW = W * 0.7; L.boxH = H * 0.54; }
    else if (pos === 'top') { L.cy = H * 0.62; L.boxW = W * 0.7; L.boxH = H * 0.54; }
    else if (pos === 'left') { L.cx = W * 0.7; L.cy = H * 0.44; L.boxW = W * 0.44; L.boxH = H * 0.62; }
    else { L.cx = W * 0.3; L.cy = H * 0.44; L.boxW = W * 0.44; L.boxH = H * 0.62; }
    L.boxW *= k; L.boxH *= k;
    return L;
  }

  function draw(ctx, W, H, tn, opt) {
    opt = opt || {};
    ctx.clearRect(0, 0, W, H);
    var o = S.o, tp = opt.textT == null ? textProgress(tn, opt.tAbs) : opt.textT;
    if (o.fit === 'gallery') { if (S.gal.length) { galDraw(ctx, W, H, tn, opt.textT === 1 ? 99 : (opt.tAbs != null ? opt.tAbs : tn * o.secs)); if (GALFULL[o.gal]) drawScrim(ctx, W, H, tp); } }
    else if (o.fit === 'fill' && S.cut) {
      if (S.live) {   // live chart / diagram: repainted every frame, then run through the chosen camera motion on top
        var keepCut = S.cut, lc = S._liveCv || (S._liveCv = document.createElement('canvas'));
        try {
          if (lc.width !== W || lc.height !== H) { lc.width = W; lc.height = H; }
          S.live(lc.getContext('2d'), W, H, opt.textT === 1 ? 0 : (opt.tAbs != null ? opt.tAbs : tn * o.secs), opt.textT === 1);
          S.cut = lc; drawFill(ctx, W, H, tn);
        } catch (e) { S.cut = keepCut; console.error('Live chart frame failed', e); drawFill(ctx, W, H, tn); }
        finally { S.cut = keepCut; }
      } else drawFill(ctx, W, H, tn);
      drawScrim(ctx, W, H, tp);
    }
    else if (o.motion === 'chilldrop' && S.cut) drawChill(ctx, W, H, tn, opt);
    else { drawBackground(ctx, W, H, opt.flatten); if (S.cut) drawProduct(ctx, W, H, tn); }
    var xa = null; try { xa = xtActive(tn, opt); xtScrim(ctx, W, H, xa); } catch (e) { console.error('Showcase texts failed', e); }
    S._tbox = null; drawText(ctx, W, H, tp, opt.textT === 1 ? 99 : (opt.tAbs != null ? opt.tAbs : tn * o.secs));
    try { xtText(ctx, W, H, xa); } catch (e) { console.error('Showcase texts failed', e); }
    try { drawEngage(ctx, W, H, tn, opt); } catch (e) { console.error('Showcase engage failed', e); }
    if (opt.watermark) stampMark(ctx, W, H);
  }

  // Fill to edges: the photo is scaled to cover the frame completely (never a gap), with a slow loop-safe move
  function drawFill(ctx, W, H, tn) {
    var o = S.o, c = S.cut, TAU = Math.PI * 2, m = o.fmotion, k = 0.5 - 0.5 * Math.cos(TAU * tn), z = 1, px = 0, py = 0;
    if (m === 'chilldrop') { try { drawFillChill(ctx, W, H, tn); return; } catch (e) { console.error('Chill Drop (fill) failed', e); ctx.clearRect(0, 0, W, H); } }
    if (m === 'zoomin') z = 1 + 0.12 * k;
    else if (m === 'zoomout') z = 1.12 - 0.12 * k;
    else if (m === 'pan') { z = 1.12; px = 2 * k - 1; }
    else if (m === 'drift') { z = 1.1; px = 0.8 * Math.sin(TAU * tn); py = 0.8 * Math.cos(TAU * tn); }
    else if (m === 'kenburns') { z = 1.04 + 0.14 * k; px = 0.7 * (2 * k - 1); py = -0.5 * (2 * k - 1); }
    else if (m === 'beat') { z = 1.02 + 0.07 * Math.pow(Math.max(0, Math.sin(TAU * tn * 4)), 4); }
    else if (m === 'shine') z = 1.05;
    else if (m === 'whip') { var wq = eo(clamp(tn / 0.2, 0, 1)); z = 1.05 + 0.45 * (1 - wq) + 0.05 * tn; px = -(1 - wq); }
    else if (FILLX[m]) z = 1.03 + 0.08 * k;
    var s = Math.max(W / c.width, H / c.height) * z, dw = c.width * s, dh = c.height * s;
    var img = mipFor(c, Math.max(c.width, c.height) * Math.max(W / c.width, H / c.height) * 1.12);
    ctx.save(); ctx.imageSmoothingQuality = 'high';
    var fx0 = (W - dw) / 2 + px * (dw - W) / 2, fy0 = (H - dh) / 2 + py * (dh - H) / 2;
    if (FILLX[m]) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); fillExtra(ctx, img, fx0, fy0, dw, dh, W, H, tn, m); }
    else ctx.drawImage(img, fx0, fy0, dw, dh);
    ctx.restore();
    if (m === 'shine') {
      var q = ease((tn - 0.15) / 0.6);
      if (q > 0 && q < 1) {
        var bw = W * 0.3, sg;
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.translate(W * (-0.3 + 1.6 * q), H / 2); ctx.rotate(0.4);
        sg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(-bw / 2, -H, bw, H * 2); ctx.restore();
      }
    }
  }
  // Soft dark fade from the edge the words sit on, so text stays readable on any photo
  function drawScrim(ctx, W, H, prog) {
    var o = S.o; if (!(o.head || o.sub || o.badge) || o.scrim <= 0) return;
    var pos = layout(W, H).pos, a = o.scrim / 100 * 0.8 * prog, g;
    if (pos === 'top') g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    else if (pos === 'bottom') g = ctx.createLinearGradient(0, H, 0, H * 0.38);
    else if (pos === 'left') g = ctx.createLinearGradient(0, 0, W * 0.68, 0);
    else g = ctx.createLinearGradient(W, 0, W * 0.32, 0);
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(0.55, 'rgba(0,0,0,' + (a * 0.45) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // Brightness of the photo where the words sit (cached on the photo canvas)
  function bandLum(pos) {
    var c = S.cut; if (!c) return 0.5;
    c._bl = c._bl || {}; if (c._bl[pos] != null) return c._bl[pos];
    var sm = mk(8, 8), sx = sm.getContext('2d'); sx.drawImage(c, 0, 0, 8, 8);
    var d = sx.getImageData(0, 0, 8, 8).data, t = 0, n = 0;
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      if (!(pos === 'top' ? y < 3 : pos === 'bottom' ? y > 4 : pos === 'left' ? x < 3 : x > 4)) continue;
      var i = (y * 8 + x) * 4; t += lum({ r: d[i], g: d[i + 1], b: d[i + 2] }); n++;
    }
    return (c._bl[pos] = n ? t / n : 0.5);
  }

  function drawProduct(ctx, W, H, tn) {
    var o = S.o, L = layout(W, H), st = motionState(tn);
    var cw = S.cut.width, ch = S.cut.height, fit = Math.min(L.boxW / cw, L.boxH / ch);
    var dw = cw * fit, dh = ch * fit, cx = L.cx, cy = L.cy;
    if (o.reflect) cy -= dh * 0.05;
    var floorY = cy + dh / 2;
    var spr = getSprites(dw, dh), pl = layerCanvas('product', W, H), pc = pl.getContext('2d');
    var thickPx = o.motion === 'wrap' ? 0 : dw * (o.thick / 100);
    pc.save();
    if (o.motion === 'hover') { pc.translate(cx, cy + st.dy * dh); pc.rotate(st.rz); pc.translate(-cx, -cy); }
    var projW, sp = null;
    if (SPECIAL[o.motion]) { sp = drawSpecial(pc, spr, cx, cy, spr.w, spr.h, tn, W); projW = sp.projW; }
    else if (o.motion === 'wrap') { drawWrap(pc, spr, cx, cy, spr.w, spr.h, st.theta); projW = spr.w; }
    else { drawSlab(pc, spr, cx, cy, spr.w, spr.h, st.theta, thickPx); projW = Math.abs(Math.cos(st.theta)) * spr.w + Math.abs(Math.sin(st.theta)) * thickPx; }
    if (o.motion === 'chilldrop') { try { chillSkin(pc, cx, cy, spr.w, spr.h, tn, W); } catch (e) { console.error('Chill Drop skin failed', e); } }
    pc.restore();

    var heroFx = LAND[o.motion] != null && o.bgMode !== 'empty';
    if (heroFx) heroBack(ctx, tn, cx, cy, dw, dh, o.motion);
    // floor shadow
    if (o.shadow) {
      var lift = sp ? sp.lift : (o.motion === 'hover' ? (-st.dy * dh) : 0), sh = clamp(1 - lift / (dh * 0.2), 0.7, 1.05);
      var rx = Math.max(dw * 0.18, projW * 0.55) * sh, ry = Math.max(6, rx * 0.16), sy = floorY + ry * 0.35;
      ctx.save(); ctx.translate(cx + (sp ? sp.sx : 0), sy); ctx.scale(1, ry / rx);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(0,0,0,' + (0.42 * sh) + ')'); g.addColorStop(0.6, 'rgba(0,0,0,' + (0.16 * sh) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // mirror-floor reflection
    if (o.reflect) {
      var rf = layerCanvas('reflect', W, H), rx2 = rf.getContext('2d');
      rx2.save(); rx2.translate(0, floorY * 2 + 2); rx2.scale(1, -1); rx2.drawImage(pl, 0, 0); rx2.restore();
      rx2.globalCompositeOperation = 'destination-in';
      var fg = rx2.createLinearGradient(0, floorY, 0, floorY + dh * 0.34);
      fg.addColorStop(0, 'rgba(0,0,0,0.30)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      rx2.fillStyle = fg; rx2.fillRect(0, floorY, W, dh * 0.4);
      rx2.globalCompositeOperation = 'destination-out'; rx2.fillStyle = '#000'; rx2.fillRect(0, 0, W, floorY);
      rx2.globalCompositeOperation = 'source-over';
      ctx.drawImage(rf, 0, 0);
    }
    ctx.drawImage(pl, 0, 0);
    if (heroFx) heroFront(ctx, o.motion, tn, cx, cy, dw, dh, sp);
  }

  /* ───────────────────────── extra motions ───────────────────────── */
  function eo(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
  function eb(x) { x = clamp(x, 0, 1); var c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function ob(x) { x = clamp(x, 0, 1); var n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; } if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; } x -= 2.625 / d; return n * x * x + 0.984375; }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  /* ───────────────────────── cinematic hero entrances ───────────────────────── */
  var PIECE = { assemble: 'tiles', shatter: 'shards', dust: 'dust', blinds: 'blinds' };
  var LAND = { warp: 0.5, assemble: 0.5, shatter: 0.5, dust: 0.5, blinds: 0.5, hero: 0.3, scan: 0.42 };   // when each hero motion "lands" (the flash)
  var FILLX = { assemble: 1, shutter: 1, iris: 1, cinema: 1 };
  function rnd(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  function partA(tn) { return tn < 0.5 ? tn / 0.5 : tn > 0.88 ? 1 - (tn - 0.88) / 0.12 : 1; }   // 0 = scattered, 1 = assembled
  // Draws img (iw x ih) into X,Y,DW,DH as many pieces, each arriving from its own direction. a: 0..1
  function pieces(ctx, img, iw, ih, X, Y, DW, DH, a, kind, W, H, dir) {
    var cols = kind === 'dust' ? 26 : kind === 'blinds' ? 1 : kind === 'shards' ? 6 : 7;
    var rows = kind === 'blinds' ? 10 : Math.max(3, Math.min(kind === 'dust' ? 34 : 12, Math.round(cols * DH / DW)));
    var tw = DW / cols, th = DH / rows, R = Math.max(W, H), n = kind === 'shards' ? 2 : 1, i, j, t;
    for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) for (t = 0; t < n; t++) {
      var r1 = rnd(i + t * 17, j), r2 = rnd(j + 9, i + 3 + t), r3 = rnd(i + 5, j + 7 + t * 11);
      var ang = r1 * 6.2832 + (kind === 'dust' ? (1 - a) * 3 : 0), dist = R * (0.45 + r2 * 0.55);
      var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist, rot = (r3 - 0.5) * (kind === 'shards' ? 8 : 4), sc = 0.3 + r2 * 1.1, dl = r3 * 0.5;
      if (kind === 'blinds') { dx = (j % 2 ? 1 : -1) * (dir || 1) * R * 1.1; dy = 0; rot = 0; sc = 1; dl = j * 0.045; }
      if (kind === 'dust') { rot = 0; sc = 0.2 + r3 * 0.5; }
      var q = clamp(a * 1.5 - dl, 0, 1); if (q <= 0) continue;
      var k = Math.pow(1 - q, 3), s2 = 1 + (sc - 1) * k;
      ctx.save(); ctx.globalAlpha *= clamp(q * 3, 0, 1);
      ctx.translate(X + i * tw + tw / 2 + dx * k, Y + j * th + th / 2 + dy * k); ctx.rotate(rot * k); ctx.scale(s2, s2);
      if (n === 2) { ctx.beginPath(); if (t) { ctx.moveTo(tw / 2, -th / 2); ctx.lineTo(tw / 2, th / 2); ctx.lineTo(-tw / 2, th / 2); } else { ctx.moveTo(-tw / 2, -th / 2); ctx.lineTo(tw / 2, -th / 2); ctx.lineTo(-tw / 2, th / 2); } ctx.closePath(); ctx.clip(); }
      ctx.drawImage(img, i * iw / cols, j * ih / rows, iw / cols, ih / rows, -tw / 2 - 0.4, -th / 2 - 0.4, tw + 0.8, th + 0.8);
      ctx.restore();
    }
  }
  // Light burst: a white bloom and a ring expanding from the hero the instant it lands. f: 0..1
  function burst(ctx, cx, cy, rad, f, col) {
    if (f <= 0 || f >= 1) return;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    g.addColorStop(0, 'rgba(255,255,255,' + (0.55 * (1 - f) * (1 - f)) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.restore();
  }
  // Stage light behind the hero (accent glow, plus a spotlight cone for Hero rise / Scan reveal)
  function heroBack(ctx, tn, cx, cy, dw, dh, m) {
    var g = ease(tn / 0.3) * (1 - ease((tn - 0.88) / 0.12)); if (g < 0.01) return;
    var c = { r: 255, g: 255, b: 255 }, R = Math.max(dw, dh) * 0.95, rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, rgbStr(c, 0.16 * g)); rg.addColorStop(1, rgbStr(c, 0)); ctx.fillStyle = rg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (m === 'hero' || m === 'scan') {
      var top = cy - dh * 0.95, bg = ctx.createLinearGradient(0, top, 0, cy + dh / 2);
      bg.addColorStop(0, 'rgba(255,255,255,' + (0.26 * g) + ')'); bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(cx - dw * 0.07, top); ctx.lineTo(cx + dw * 0.07, top); ctx.lineTo(cx + dw * 0.62, cy + dh / 2); ctx.lineTo(cx - dw * 0.62, cy + dh / 2); ctx.closePath(); ctx.fill();
    }
  }
  function heroFront(ctx, m, tn, cx, cy, dw, dh, r) {
    if (r && r.streakP != null) streaks(ctx, cx, cy, ctx.canvas.width, ctx.canvas.height, r.streakP);
    burst(ctx, cx, cy, Math.max(dw, dh) * 0.6, (tn - LAND[m]) / 0.25, hexToRgb(S.o.accent));
    if (m === 'scan' && r && r.scanY != null) {
      var g = ctx.createLinearGradient(cx - dw * 0.7, 0, cx + dw * 0.7, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(cx - dw * 0.7, r.scanY - 1, dw * 1.4, 2); ctx.restore();
    }
  }
  // Full-photo cinematic entrances (Fill to edges)
  function fillExtra(ctx, img, X, Y, DW, DH, W, H, tn, m) {
    var a = partA(tn), acc = hexToRgb(S.o.accent), i;
    if (m === 'assemble' || m === 'shutter') {
      if (a >= 1) ctx.drawImage(img, X, Y, DW, DH);
      else pieces(ctx, img, img.width, img.height, X, Y, DW, DH, a, m === 'shutter' ? 'blinds' : 'tiles', W, H, 1);
      if (m === 'assemble') burst(ctx, W / 2, H / 2, Math.max(W, H) * 0.45, (tn - 0.5) / 0.25, acc);
    } else if (m === 'iris') {
      var rr2 = Math.hypot(W, H) / 2 * eo(tn / 0.35) * (1 - ease((tn - 0.88) / 0.12));
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(rr2, 0.1), 0, 6.2832); ctx.clip(); ctx.drawImage(img, X, Y, DW, DH); ctx.restore();
    } else if (FX[m]) {
      fxDraw(ctx, img, img.width, img.height, X, Y, DW, DH, m, tn, W, H, 1, null);
      if (m === 'warp') { streaks(ctx, W / 2, H / 2, W, H, a); burst(ctx, W / 2, H / 2, Math.max(W, H) * 0.45, (tn - 0.5) / 0.25, acc); }
    } else if (m === 'cinema') {
      ctx.drawImage(img, X, Y, DW, DH);
      var bh = H * 0.075 * ease(tn / 0.16) * (1 - ease((tn - 0.9) / 0.1)), vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
      var sq = ease((tn - 0.3) / 0.45);
      if (sq > 0 && sq < 1) {
        var sx = W * (-0.2 + 1.4 * sq), sg = ctx.createLinearGradient(sx - W * 0.3, 0, sx + W * 0.3, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = sg; ctx.fillRect(sx - W * 0.3, H / 2 - H * 0.0035, W * 0.6, H * 0.007); ctx.globalAlpha = 0.25; ctx.fillRect(sx - W * 0.3, H / 2 - H * 0.03, W * 0.6, H * 0.06); ctx.restore();
      }
      var fb = Math.max(1 - ease(tn / 0.1), ease((tn - 0.92) / 0.08)); if (fb > 0) { ctx.fillStyle = 'rgba(0,0,0,' + fb + ')'; ctx.fillRect(0, 0, W, H); }
    }
  }
  /* ───────────────────────── wow effects (shared by the product and the full photo) ───────────────────────── */
  var FX = { warp: 1, snap: 1, flip: 1, ripple: 1, pixel: 1, glitch: 1, waterfall: 1 };
  for (var fk in FX) FILLX[fk] = 1;
  function pulse(t, c, w) { return clamp(1 - Math.abs(t - c) / w, 0, 1); }
  // White speed streaks that rush outward as the hero arrives (and back in as it leaves). p: 0 = far away, 1 = landed
  function streaks(ctx, cx, cy, W, H, p) {
    var a = 1 - p; if (a <= 0.02) return;
    var R = Math.hypot(W, H) * 0.5, i, an, rs, len;
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * a) + ')'; ctx.lineWidth = Math.max(1, W / 700); ctx.lineCap = 'round'; ctx.beginPath();
    for (i = 0; i < 80; i++) {
      an = rnd(i, 1) * 6.2832; rs = ((rnd(i, 2) + p * 2.2) % 1) * R; len = R * 0.45 * a * (0.3 + rnd(i, 3));
      ctx.moveTo(cx + Math.cos(an) * rs, cy + Math.sin(an) * rs); ctx.lineTo(cx + Math.cos(an) * (rs + len), cy + Math.sin(an) * (rs + len));
    }
    ctx.stroke(); ctx.restore();
  }
  // Draws img (iw x ih) into X,Y,DW,DH with one of the wow entrances. Returns the size factor (for the floor shadow).
  function fxDraw(ctx, img, iw, ih, X, Y, DW, DH, m, tn, W, H, dir, shade) {
    var p = partA(tn), i, j, q, k, cx0 = X + DW / 2, cy0 = Y + DH / 2, whole = function () { ctx.drawImage(img, X, Y, DW, DH); };
    if (m === 'ripple') {
      if (p >= 1) { whole(); return 1; }
      var rows = Math.max(24, Math.min(200, Math.round(DH / 3))), sh = ih / rows, dh2 = DH / rows, amp = Math.pow(1 - p, 1.4) * DW * 0.14;
      ctx.save(); ctx.globalAlpha *= clamp(p * 2.5, 0, 1);
      for (j = 0; j < rows; j++) ctx.drawImage(img, 0, j * sh, iw, sh, X + amp * Math.sin(j / rows * 21.9 - tn * 62.8), Y + j * dh2, DW, dh2 + 0.8);
      ctx.restore();
    } else if (m === 'pixel') {
      if (p >= 1) { whole(); return 1; }
      var pq = Math.floor(p * 9) / 9, bs = Math.max(1, Math.round(1 + Math.pow(1 - pq, 2.2) * Math.min(DW, DH) * 0.16));
      var sw = Math.max(2, Math.round(DW / bs)), shh = Math.max(2, Math.round(DH / bs)), pl = layerCanvas('pix', sw, shh), px = pl.getContext('2d');
      px.imageSmoothingQuality = 'high'; px.drawImage(img, 0, 0, sw, shh);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha *= clamp(p * 4, 0, 1); ctx.drawImage(pl, 0, 0, sw, shh, X, Y, DW, DH); ctx.restore();
    } else if (m === 'flip') {
      var fc = 9, fr = Math.max(3, Math.round(fc * DH / DW)), tw = DW / fc, th = DH / fr, d, sx;
      for (j = 0; j < fr; j++) for (i = 0; i < fc; i++) {
        d = Math.hypot((i + 0.5) / fc - 0.5, (j + 0.5) / fr - 0.5) / 0.71; q = clamp(p * 2.3 - d * 1.3, 0, 1); if (q <= 0) continue;
        ctx.save(); ctx.translate(X + (i + 0.5) * tw, Y + (j + 0.5) * th);
        if (q < 1) { sx = Math.cos(Math.PI * (1 - q)); k = 1 + 0.12 * Math.sin(Math.PI * q); ctx.scale(sx * k, k); ctx.globalAlpha *= clamp(q * 5, 0, 1); }
        ctx.drawImage(img, i * iw / fc, j * ih / fr, iw / fc, ih / fr, -tw / 2 - 0.3, -th / 2 - 0.3, tw + 0.6, th + 0.6);
        if (q < 1 && sx < 0) {
          if (shade) { ctx.globalAlpha *= 0.55; ctx.drawImage(shade, i * iw / fc, j * ih / fr, iw / fc, ih / fr, -tw / 2 - 0.3, -th / 2 - 0.3, tw + 0.6, th + 0.6); }
          else { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-tw / 2, -th / 2, tw, th); }
        }
        ctx.restore();
      }
    } else if (m === 'warp') {
      var ws = Math.max(0.001, eb(clamp(p * 1.05, 0, 1)));
      ctx.save(); ctx.globalAlpha *= clamp(p * 3, 0, 1); ctx.translate(cx0, cy0); ctx.rotate((1 - p) * 1.2 * dir); ctx.scale(ws, ws); ctx.drawImage(img, -DW / 2, -DH / 2, DW, DH); ctx.restore();
      return ws;
    } else if (m === 'snap') {
      var dd = tn < 0.3 ? 0 : tn < 0.62 ? ease((tn - 0.3) / 0.32) : tn < 0.68 ? 1 : 1 - ease((tn - 0.68) / 0.27);
      if (dd <= 0) { whole(); return 1; }
      var sc2 = 40, sr = Math.max(4, Math.min(60, Math.round(sc2 * DH / DW))), stw = DW / sc2, sth = DH / sr, dl, a1, a2, a3, kk;
      for (j = 0; j < sr; j++) for (i = 0; i < sc2; i++) {
        dl = (i / sc2) * 0.65 + rnd(i, j) * 0.35; q = clamp((dd - dl * 0.55) / 0.45, 0, 1); if (q >= 1) continue;
        a1 = rnd(i + 3, j); a2 = rnd(j + 7, i); a3 = rnd(i + 11, j + 5);
        ctx.save();
        if (q > 0) { kk = q; ctx.globalAlpha *= Math.pow(1 - kk, 0.7); ctx.translate(kk * (40 + a1 * 170) * (W / 960), -kk * (a2 * 120 - 25) * (H / 540) - kk * kk * 60 * (H / 540)); ctx.translate(X + (i + 0.5) * stw, Y + (j + 0.5) * sth); ctx.rotate((a3 - 0.5) * 6 * kk); ctx.scale(1 - 0.5 * kk, 1 - 0.5 * kk); }
        else ctx.translate(X + (i + 0.5) * stw, Y + (j + 0.5) * sth);
        ctx.drawImage(img, i * iw / sc2, j * ih / sr, iw / sc2, ih / sr, -stw / 2 - 0.3, -sth / 2 - 0.3, stw + 0.6, sth + 0.6);
        ctx.restore();
      }
    } else if (m === 'glitch') {
      var g = Math.max(1 - ease(tn / 0.16), ease((tn - 0.9) / 0.1), 0.75 * pulse(tn, 0.5, 0.045), 0.6 * pulse(tn, 0.76, 0.04));
      if (g <= 0.01) { whole(); return 1; }
      var seed = Math.floor(tn * 48), y0 = 0, b = 0, bh, hg, off;
      ctx.save(); if (tn < 0.12 && rnd(seed, 9) > 0.6) ctx.globalAlpha *= 0.25;
      while (y0 < ih - 0.5) {
        bh = ih * (0.02 + rnd(seed, b + 1) * 0.12); hg = Math.min(bh, ih - y0);
        off = rnd(b + 3, seed) > 0.35 ? (rnd(b, seed) - 0.5) * DW * 0.35 * g : 0;
        if (rnd(seed + 2, b) > 0.1 * g) ctx.drawImage(img, 0, y0, iw, hg, X + off, Y + y0 * DH / ih, DW, hg * DH / ih + 0.6);
        y0 += hg; b++;
      }
      ctx.restore();
    } else if (m === 'waterfall') {
      var wc = 22, cw = DW / wc, ex = clamp((tn - 0.86) / 0.14, 0, 1), pin = clamp(tn / 0.5, 0, 1), xo, dy;
      for (i = 0; i < wc; i++) {
        q = clamp(pin * 1.5 - rnd(i, 4) * 0.5, 0, 1); if (q <= 0) continue;
        xo = clamp(ex * 1.5 - rnd(i, 8) * 0.5, 0, 1); dy = -(1 - ob(q)) * DH * 1.25 + ease(xo) * DH * 1.3;
        ctx.save(); ctx.globalAlpha *= clamp(q * 5, 0, 1); ctx.drawImage(img, i * iw / wc, 0, iw / wc, ih, X + i * cw - 0.3, Y + dy, cw + 0.6, DH); ctx.restore();
      }
    }
    return 1;
  }
  // Draws the whole product for the special motions. Returns what the shadow needs: width, lift and sideways shift.
  function drawSpecial(pc, spr, cx, cy, dw, dh, tn, W) {
    var o = S.o, TAU = Math.PI * 2, e = o.dir, m = o.motion, floorY = cy + dh / 2, r = { projW: dw, lift: 0, sx: 0 }, i;

    if (m === 'glint') {                                   // premium light sweep over a gently floating product
      var fl = Math.sin(TAU * tn) * dh * 0.012;
      pc.save(); pc.translate(cx, cy + fl); pc.rotate(Math.sin(TAU * tn + 0.6) * 0.022 * e);
      pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh);
      var q = ease((tn - 0.18) / 0.6);
      if (q > 0 && q < 1) {
        var gl = layerCanvas('glint', spr.w, spr.h), gx = gl.getContext('2d'), bw = dw * 0.34, px = (-0.9 + 1.8 * q) * dw * e;
        gx.save(); gx.translate(spr.w / 2 + px, spr.h / 2); gx.rotate(0.38);
        var gg = gx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        gx.fillStyle = gg; gx.fillRect(-bw / 2, -spr.h, bw, spr.h * 2); gx.restore();
        gx.globalCompositeOperation = 'destination-in'; gx.drawImage(spr.front, 0, 0); gx.globalCompositeOperation = 'source-over';
        pc.drawImage(gl, -dw / 2, -dh / 2, dw, dh);
      }
      pc.restore(); r.lift = Math.max(0, -fl);

    } else if (m === 'carousel') {                         // copies circle in 3D like a showroom carousel
      var N = 5, th = e * TAU * tn, items = [], R = Math.max(dw * 0.35, Math.min(W * 0.32, W * 0.47 - dw * 0.4));
      for (i = 0; i < N; i++) { var a = th + TAU * i / N; items.push({ d: (Math.cos(a) + 1) / 2, x: Math.sin(a) }); }
      items.sort(function (p, q2) { return p.d - q2.d; });
      items.forEach(function (it) {
        var sc = 0.5 + 0.42 * it.d, w2 = dw * sc, h2 = dh * sc, bx = cx + it.x * R, by = floorY - (1 - it.d) * dh * 0.1;
        pc.save(); pc.globalAlpha = 0.5 + 0.5 * it.d; pc.drawImage(spr.front, bx - w2 / 2, by - h2, w2, h2);
        pc.globalAlpha = (1 - it.d) * 0.5; pc.drawImage(spr.shade, bx - w2 / 2, by - h2, w2, h2); pc.restore();
      });
      r.projW = R * 1.7 + dw * 0.4;

    } else if (m === 'slice') {                            // splits into strips, drifts apart, snaps back
      var n = 16, vert = e >= 0, ex = ease((tn - 0.28) / 0.22) - ease((tn - 0.62) / 0.22), sw = (vert ? dw : dh) / n;
      pc.save();
      for (i = 0; i < n; i++) {
        var sd = ease(ex * 1.5 - (i / (n - 1)) * 0.5), off = sd * (vert ? dh : dw) * 0.75 * (i % 2 ? 1 : -1);
        pc.globalAlpha = 1 - 0.6 * sd;
        if (vert) pc.drawImage(spr.front, i * sw, 0, sw, dh, cx - dw / 2 + i * sw, cy - dh / 2 + off, sw + 0.8, dh);
        else pc.drawImage(spr.front, 0, i * sw, dw, sw, cx - dw / 2 + off, cy - dh / 2 + i * sw, dw, sw + 0.8);
      }
      pc.restore(); r.lift = ex * dh * 0.15;

    } else if (m === 'bounce') {                           // squash and stretch drop, two bounces per loop
      var u = (tn * 2) % 1, jump = 4 * u * (1 - u) * dh * 0.3, air = Math.sin(Math.PI * u), sq = Math.max(0, 1 - Math.min(u, 1 - u) / 0.12);
      var kx = 1 + 0.17 * sq - 0.03 * air, ky = 1 - 0.19 * sq + 0.05 * air;
      pc.save(); pc.translate(cx, floorY - jump); pc.rotate(Math.sin(TAU * tn) * 0.05 * e); pc.scale(kx, ky);
      pc.drawImage(spr.front, -dw / 2, -dh, dw, dh); pc.restore();
      r.lift = jump; r.projW = dw * kx;

    } else if (m === 'echo') {                             // side-to-side glide with a fading trail
      var NT = 8, pos = function (t) { return { x: Math.sin(TAU * t) * dw * 0.3 * e, y: Math.sin(TAU * t * 2) * dh * 0.03, r: Math.cos(TAU * t) * 0.05 * e }; };
      for (i = NT; i >= 0; i--) {
        var p = pos(tn - i * 0.02);
        pc.save(); pc.globalAlpha = i === 0 ? 1 : Math.pow(1 - i / (NT + 1), 2) * 0.42;
        pc.translate(cx + p.x, cy + p.y); pc.rotate(p.r); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      }
      r.sx = pos(tn).x; r.projW = dw * 1.05;

    } else if (m === 'pulse') {                            // heartbeat: the photo itself beats twice per loop
      var ps = 1 + 0.09 * Math.pow(Math.max(0, Math.sin(TAU * tn * 2)), 3);
      pc.save(); pc.translate(cx, cy); pc.scale(ps, ps); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.projW = dw * ps;

    } else if (m === 'levitate') {                         // rises and settles, the floor shadow shrinks and grows with it
      var lf = (0.5 - 0.5 * Math.cos(TAU * tn)) * dh * 0.09;
      pc.save(); pc.translate(cx, cy - lf); pc.rotate(Math.sin(TAU * tn) * 0.015 * e); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.lift = lf;

    } else if (m === 'pop') {                              // springy entrance, then a soft settle; re-pops each loop
      var u2 = clamp(tn / 0.26, 0, 1), c1 = 1.70158, bk = 1 + (c1 + 1) * Math.pow(u2 - 1, 3) + c1 * Math.pow(u2 - 1, 2);
      var pz = Math.max(0.001, (u2 >= 1 ? 1 + 0.02 * Math.sin(TAU * (tn - 0.26) / 0.74 * 2) : bk) * (1 - ease((tn - 0.92) / 0.08)));
      pc.save(); pc.translate(cx, cy); pc.rotate(Math.sin(TAU * tn) * 0.02 * e); pc.scale(pz, pz); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.projW = dw * Math.max(pz, 0.1);

    } else if (m === 'orbit') {                            // glides round a small circle, larger toward you, smaller away
      var oa = e * TAU * tn, dp = Math.sin(oa), ox = Math.cos(oa) * dw * 0.24, os = 1 + 0.08 * dp;
      pc.save(); pc.translate(cx + ox, cy + dp * dh * 0.02); pc.rotate(Math.cos(oa) * 0.03); pc.scale(os, os); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh);
      pc.globalAlpha = (1 - dp) * 0.1; pc.drawImage(spr.shade, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.sx = ox; r.projW = dw * os;

    } else if (m === 'roll') {                             // rolls in like a wheel, rests, rolls out the far side
      var PW = pc.canvas.width, offd = PW * 0.6 + dw, rin = eo(clamp(tn / 0.3, 0, 1)), rout = clamp((tn - 0.78) / 0.22, 0, 1);
      var rdx = -e * (1 - rin) * offd + e * rout * rout * offd, rang = rdx / (Math.max(dw, dh) * 0.5) + (tn > 0.3 && tn < 0.78 ? 0.03 * Math.sin(TAU * (tn - 0.3) / 0.48) : 0);
      pc.save(); pc.translate(cx + rdx, cy); pc.rotate(rang); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.sx = rdx;

    } else if (m === 'acrobat') {                          // jump, full flip in the air, landing squash; second jump flips back
      var au = (tn * 2) % 1, av = clamp(au / 0.68, 0, 1), aj = 4 * av * (1 - av) * dh * 0.5, aa = (tn < 0.5 ? 1 : -1) * e * TAU * ease(av);
      var asq = au > 0.68 ? Math.sin(Math.PI * clamp((au - 0.68) / 0.32, 0, 1)) : 0, akx = 1 + 0.12 * asq, aky = 1 - 0.14 * asq;
      pc.save(); pc.translate(cx, floorY - aj - dh / 2 * aky); pc.rotate(aa); pc.scale(akx, aky); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.lift = aj; r.projW = dw * akx;

    } else if (m === 'breakdance') {                       // fast spin with a hop, then a tilted freeze pose
      var bd = 0, bh = 0, bs = 1, u1, u3;
      if (tn < 0.5) { u1 = tn / 0.5; bd = e * TAU * 3 * eo(u1); bh = Math.sin(Math.PI * u1) * dh * 0.08; }
      else if (tn < 0.88) { u3 = (tn - 0.5) / 0.38; bd = -e * 0.42 * eb(u3 / 0.3); bs = 1 - 0.07 * Math.sin(Math.PI * clamp(u3 / 0.25, 0, 1)); }
      else bd = -e * 0.42 * (1 - ease((tn - 0.88) / 0.12));
      pc.save(); pc.translate(cx, cy - bh); pc.rotate(bd); pc.scale(bs, bs); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.lift = bh; r.projW = dw * bs;

    } else if (m === 'spinin') {                           // spins in from nothing, holds, spins away
      var si = eo(clamp(tn / 0.3, 0, 1)), so = ease((tn - 0.86) / 0.14), sz = Math.max(0.001, si * (1 - so));
      pc.save(); pc.translate(cx, cy); pc.rotate(e * TAU * 3 * (1 - si) - e * TAU * 2 * so); pc.scale(sz, sz); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.projW = dw * Math.max(sz, 0.1);

    } else if (m === 'tumble') {                           // drops in tumbling and bouncing, then falls away
      var PH = pc.canvas.height, tu = clamp(tn / 0.4, 0, 1), ty = cy - (1 - ob(tu)) * (cy + dh) + ease((tn - 0.86) / 0.14) * (PH - cy + dh);
      var ta = e * TAU * (1 - eo(tu)) + Math.sin(TAU * tu * 3) * 0.12 * (1 - tu);
      pc.save(); pc.translate(cx, ty); pc.rotate(ta); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.lift = Math.max(0, cy - ty);

    } else if (FX[m]) {                                    // wow effects: warp, snap, flip, ripple, pixel, glitch, waterfall
      var fs = fxDraw(pc, spr.front, spr.w, spr.h, cx - dw / 2, cy - dh / 2, dw, dh, m, tn, pc.canvas.width, pc.canvas.height, e, spr.shade);
      r.projW = dw * Math.max(fs, 0.2); if (m === 'warp') { r.streakP = partA(tn); r.lift = Math.max(0, 1 - fs) * dh * 0.3; }

    } else if (PIECE[m]) {                                 // raw parts fly in from every direction and lock together
      var pa = partA(tn), pf = Math.sin(Math.PI * clamp((tn - 0.5) / 0.38, 0, 1)) * dh * 0.02;
      pc.save(); pc.translate(0, -pf);
      if (pa >= 1) pc.drawImage(spr.front, cx - dw / 2, cy - dh / 2, dw, dh);
      else pieces(pc, spr.front, spr.w, spr.h, cx - dw / 2, cy - dh / 2, dw, dh, pa, PIECE[m], pc.canvas.width, pc.canvas.height, e);
      pc.restore(); r.lift = pf; r.projW = dw * Math.max(pa, 0.2);

    } else if (m === 'hero') {                             // rises into the spotlight, overshoots, slow push, lifts away
      var hi = eb(clamp(tn / 0.3, 0, 1)), hx = ease((tn - 0.88) / 0.12), hp = clamp((tn - 0.3) / 0.58, 0, 1), hz = 0.82 + 0.18 * hi + 0.05 * ease(hp);
      pc.save(); pc.globalAlpha = clamp(tn / 0.1, 0, 1) * (1 - hx);
      pc.translate(cx, cy + (1 - hi) * dh * 0.8 - hx * dh * 0.25 - Math.sin(Math.PI * hp) * dh * 0.015);
      pc.rotate((1 - hi) * 0.14 * e); pc.scale(hz, hz); pc.drawImage(spr.front, -dw / 2, -dh / 2, dw, dh); pc.restore();
      r.lift = Math.max(0, 1 - hi) * dh * 0.3 + hx * dh * 0.25; r.projW = dw * hz * (1 - hx * 0.5);

    } else if (m === 'scan') {                             // dark silhouette, a glowing line sweeps up and reveals the product
      var sq2 = ease(clamp(tn / 0.42, 0, 1)), sx2 = ease((tn - 0.88) / 0.12), ln = 1 - sq2, soft = spr.h * 0.06;
      var sl = layerCanvas('glint', spr.w, spr.h), sg = sl.getContext('2d'), gr;
      pc.save(); pc.globalAlpha = 1 - sx2; pc.translate(cx - dw / 2, cy - dh / 2);
      pc.drawImage(spr.front, 0, 0, dw, dh);
      if (sq2 < 1) { pc.globalAlpha = (1 - sx2) * 0.93; pc.drawImage(spr.shade, 0, 0, dw, dh); pc.globalAlpha = 1 - sx2; }
      sg.drawImage(spr.front, 0, 0); sg.globalCompositeOperation = 'destination-in';
      gr = sg.createLinearGradient(0, ln * spr.h - soft, 0, ln * spr.h + soft); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
      sg.fillStyle = gr; sg.fillRect(0, 0, spr.w, spr.h);
      sg.globalCompositeOperation = 'source-atop';
      gr = sg.createLinearGradient(0, ln * spr.h - soft, 0, ln * spr.h + soft); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = gr; sg.fillRect(0, 0, spr.w, spr.h); sg.globalCompositeOperation = 'source-over';
      pc.drawImage(sl, 0, 0, dw, dh); pc.restore();
      if (sq2 < 1 && sx2 === 0) r.scanY = cy - dh / 2 + ln * dh;

    } else if (m === 'swing') {                            // hangs from the top edge and swings
      var sa = Math.sin(TAU * tn) * 0.22 * e;
      pc.save(); pc.translate(cx, cy - dh / 2); pc.rotate(sa); pc.drawImage(spr.front, -dw / 2, 0, dw, dh); pc.restore();
      r.sx = -Math.sin(sa) * dh; r.lift = dh * (1 - Math.cos(sa)); r.projW = dw * 0.9;
    }
    return r;
  }

  // A thick flat cut-out turning on its vertical axis: stacked layers give it real edge depth.
  function drawSlab(pc, spr, cx, cy, dw, dh, theta, T) {
    var cs = Math.cos(theta), sn = Math.sin(theta);
    var N = T < 1.5 ? 1 : clamp(Math.round(T / 1.4), 3, 22), layers = [], k, z;
    for (k = 0; k < N; k++) { z = N === 1 ? 0 : (-T / 2 + T * k / (N - 1)); layers.push({ k: k, z: z, zc: z * cs }); }
    layers.sort(function (a, b) { return a.zc - b.zc; });
    var shadeA = (1 - Math.abs(cs)) * 0.5, step = N > 1 ? T / (N - 1) : 0, minS = (step * 1.4 + 0.8) / dw;
    var backImg = S.o.back === 'mirror' ? spr.back : spr.plain;
    layers.forEach(function (L) {
      var isFront = L.k === N - 1, isBack = L.k === 0, img = spr.edge, dark = 0;
      if (N === 1) { img = cs >= 0 ? spr.front : backImg; dark = shadeA; }
      else if (isFront && cs > 0) { img = spr.front; dark = shadeA; }
      else if (isBack && cs < 0) { img = backImg; dark = shadeA; }
      pc.save();
      pc.translate(cx + L.z * sn, cy);
      pc.scale(Math.abs(cs) < minS ? (cs < 0 ? -minS : minS) : cs, 1);
      pc.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      if (dark > 0.01) { pc.globalAlpha = dark; pc.drawImage(spr.shade, -dw / 2, -dh / 2, dw, dh); }
      pc.restore();
    });
  }

  // Wraps the photo around a cylinder, one pixel column at a time
  function drawWrap(pc, spr, cx, cy, dw, dh, theta) {
    var cols = Math.max(2, Math.round(dw)), R = dw / 2, x0 = cx - R, y0 = cy - dh / 2, i, tw = spr.w;
    pc.save();
    for (i = 0; i < cols; i++) {
      var x = ((i + 0.5) / cols) * 2 - 1, a = Math.asin(clamp(x, -1, 1)) + theta;
      var sx = clamp(Math.floor((Math.sin(a) + 1) / 2 * tw), 0, tw - 1);
      pc.drawImage(spr.wrapTex, sx, 0, 1, spr.h, x0 + i * (dw / cols), y0, dw / cols + 0.7, dh);
    }
    // keep the product's real outline fixed while the print turns inside it
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(spr.front, x0, y0, dw, dh);
    // cylinder lighting: darker rim, soft highlight, only over product pixels
    pc.globalCompositeOperation = 'source-atop';
    var g = pc.createLinearGradient(x0, 0, x0 + dw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.18, 'rgba(0,0,0,0.08)'); g.addColorStop(0.36, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(0.82, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    pc.fillStyle = g; pc.fillRect(x0, y0, dw, dh); pc.restore();
  }

  /* ───────────────────────── text ───────────────────────── */
  // Exit timing. Old clips saved before exits existed have no txtOut, so they keep their text on screen exactly as before.
  function outOn(o) { var m = o.txtOut; return m === 'auto' ? o.txtAnim !== 'none' : (m === 'fade' || m === 'rise'); }
  function outQ(o, lt) { if (!outOn(o)) return 0; var d = Math.min(0.9, o.secs * 0.22); return clamp((lt - (o.secs - d)) / d, 0, 1); }
  function smoothQ(q) { return q * q * (3 - 2 * q); }
  function textProgress(tn, tAbs) {
    var o = S.o, t = tAbs != null ? tAbs : tn * o.secs;
    if (outOn(o)) t = t % o.secs;                       // with an exit, every loop plays in and out again
    var p = 1;
    if (o.txtAnim !== 'none') { var pp = clamp(t / 0.9, 0, 1); p = 1 - Math.pow(1 - pp, 3); }
    return p * (1 - smoothQ(outQ(o, t)));
  }
  function textColor(pos) {
    var o = S.o;
    if (!o.txtAuto) return o.txtCol;
    if (o.fit === 'gallery') return GALFULL[o.gal] ? (o.scrim >= 25 ? '#ffffff' : '#0f172a') : (lum(hexToRgb(o.fillA)) > 0.6 ? '#0f172a' : '#ffffff');
    if (o.fit === 'fill' && S.cut) return (o.scrim >= 25 || bandLum(pos) < 0.6) ? '#ffffff' : '#0f172a';
    var b = backdropColor();
    if (!b) return '#111827';
    return lum(b) > 0.6 ? '#0f172a' : '#ffffff';
  }
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  /* ── Text motion engine: per-letter / per-word / per-line animation. Each motion echoes a photo motion of the same name. ── */
  var FXS = null, FK = {};
  var EO = function (p) { return 1 - Math.pow(1 - p, 3); };
  var BNC = function (p) { var n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; };
  var SPR = function (p) { return p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(p * 11); };
  function rn(i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }
  var SCR = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@';
  // u: unit (l line, w word, c letter), dur: seconds per unit, st: stagger step, ord 'c': start from the middle
  var MOT = {
    mask:    { u: 'l', dur: 0.85, st: 0.14, f: function (p, e, g) { return { dy: (1 - e) * g.u * 1.2, clip: 1 }; } },
    track:   { u: 'c', dur: 1.2, st: 0.025, ord: 'c', f: function (p, e, g) { return { a: e, dx: g.cx * (1 - e) * 0.6, bl: (1 - e) * 8 }; } },
    focus:   { u: 'l', dur: 1.1, st: 0.2, f: function (p, e) { return { a: e, sx: 1.08 - 0.08 * e, sy: 1.08 - 0.08 * e, bl: (1 - e) * 14 }; } },
    cascade: { u: 'c', dur: 0.75, st: 0.045, f: function (p, e, g) { return { a: Math.min(1, p * 4), dy: -(1 - BNC(p)) * g.u * 2.2 }; } },
    flip:    { u: 'c', dur: 0.7, st: 0.05, ord: 'c', f: function (p, e) { return { a: p > 0 ? 1 : 0, sy: Math.max(0.001, Math.sin(e * Math.PI / 2)) }; } },
    assemble:{ u: 'c', dur: 1.0, st: 0.03, f: function (p, e, g) { return { a: Math.min(1, p * 3), dx: (g.r - 0.5) * g.u * 10 * (1 - e), dy: (rn(g.i, 2) - 0.5) * g.u * 8 * (1 - e), rot: (g.r - 0.5) * 4 * (1 - e) }; } },
    warp:    { u: 'c', dur: 0.9, st: 0.02, ord: 'c', f: function (p, e, g) { return { a: e, dx: g.cx * (1 - e) * 2.2, sx: 1 + (1 - e) * 3.5, sy: 1 - (1 - e) * 0.3, bl: (1 - e) * 5 }; } },
    snap:    { u: 'c', dur: 1.1, st: 0.04, f: function (p, e, g) { return { a: e, dx: (1 - e) * g.u * (2 + g.r * 5), dy: -(1 - e) * g.u * rn(g.i, 3) * 3, rot: (1 - e) * (g.r - 0.5) * 2.5, bl: (1 - e) * 9 }; } },
    glitch:  { u: 'c', dur: 0.9, st: 0.02, f: function (p, e, g) {
      if (p <= 0) return { a: 0 }; if (p >= 1) return {};
      var s = Math.floor(g.t * 26 + g.i * 3);
      return { a: rn(s, g.i + 5) > (1 - p) * 0.55 ? 1 : 0.15, dx: (rn(s, g.i) - 0.5) * g.u * 0.9 * (1 - p), dy: (rn(s, g.i + 7) - 0.5) * g.u * 0.3 * (1 - p), gh: 1 - p }; } },
    decode:  { u: 'c', dur: 0.7, st: 0.04, f: function (p, e, g) { return { a: p > 0 ? 1 : 0, txt: p > 0 && p < 1 ? SCR.charAt(Math.floor(rn(Math.floor(g.t * 30), g.i) * SCR.length)) : null }; } },
    type:    { u: 'c', dur: 0.05, st: 0.05, f: function (p) { return { a: p > 0 ? 1 : 0 }; } },
    pop:     { u: 'w', dur: 0.65, st: 0.1, f: function (p, e, g) { var k = Math.max(0.001, SPR(p)); return { a: Math.min(1, p * 5), sx: k, sy: k, dy: (1 - e) * g.u * 0.4 }; } },
    shine:   { u: 'l', dur: 0.8, st: 0.12, sweep: 1, f: function (p, e, g) { return { a: e, dy: (1 - e) * g.u * 0.3 }; } },
    iris:    { u: 'l', dur: 0.01, st: 0, f: function () { return {}; } },
    beat:    { u: 'l', dur: 1.0, st: 0.12, f: function (p, e) { var k = 1 + 0.16 * Math.max(0, Math.sin(p * Math.PI * 5)) * (1 - p); return { a: Math.min(1, p * 6), sx: k, sy: k }; } },
    _cls:    { u: 'c', dur: 0.01, st: 0, f: function () { return {}; } },
    // Engage motions: they behave like live interaction
    caret:   { u: 'c', dur: 0.05, st: 0.06, cap: 1.7, caret: 1, f: function (p) { return { a: p > 0 ? 1 : 0 }; } },
    marker:  { u: 'w', dur: 0.55, st: 0.2, cap: 1.5, f: function (p, e) { return { a: Math.min(1, p * 8) }; },
               pre: function (c, g) { c.save(); c.globalAlpha = g.al * 0.8; c.fillStyle = g.hi; c.fillRect(-g.w / 2 - g.px * 0.08, g.yl - g.px * 0.42, (g.w + g.px * 0.16) * g.e, g.px * 0.46); c.restore(); } },
    pointer: { u: 'w', dur: 0.5, st: 0.3, cap: 2.0, off: 0.45, fin: fxPointer, f: function (p, e) { var k = Math.max(0.001, SPR(p)); return { a: Math.min(1, p * 6), sx: k, sy: k }; } }
  };
  // "Match photo motion": the text borrows the personality of whatever the photo is doing
  var MFILL = { chilldrop: 'focus', still: 'mask', zoomin: 'focus', zoomout: 'track', pan: 'mask', drift: 'focus', kenburns: 'mask', beat: 'beat', shine: 'shine', whip: 'warp', assemble: 'assemble', shutter: 'mask', iris: 'iris', cinema: 'track', warp: 'warp', snap: 'snap', flip: 'flip', ripple: 'focus', pixel: 'decode', glitch: 'glitch', waterfall: 'cascade' };
  var MPROD = { chilldrop: 'focus', pop: 'pop', bounce: 'pop', glitch: 'glitch', warp: 'warp', snap: 'snap', dust: 'snap', shatter: 'snap', flip: 'flip', ripple: 'focus', levitate: 'focus', pixel: 'decode', waterfall: 'cascade', assemble: 'assemble', pulse: 'beat', glint: 'shine', hero: 'track', echo: 'track', blinds: 'mask', scan: 'mask', slice: 'mask' };
  var MGAL = { chilldrop: 'focus', cuts: 'glitch', panels: 'mask', polaroid: 'pop', bento: 'pop', focus: 'focus', aura: 'focus', slideshow: 'focus', fastcuts: 'beat', collage: 'pop', spotlight: 'track', coverflow: 'track', brand: 'mask', film: 'mask' };
  function fxMotion(o) {
    var a = o.txtAnim;
    if (a === 'match') return (o.fit === 'gallery' ? MGAL[o.gal] : o.fit === 'fill' ? MFILL[o.fmotion] : MPROD[o.motion]) || 'mask';
    return Object.prototype.hasOwnProperty.call(MOT, a) ? a : null;
  }
  function fxUnits(ln, u) {
    var r = [], m, re, i;
    if (u === 'l') { if (ln) r.push([0, ln.length]); }
    else if (u === 'w') { re = /\S+/g; while ((m = re.exec(ln))) r.push([m.index, m.index + m[0].length]); }
    else for (i = 0; i < ln.length; i++) if (ln.charAt(i) !== ' ') r.push([i, i + 1]);
    return r;
  }
  function fxPut(ctx, ln, x, y, align, px, a0) {
    var F = FXS; if (!F) { ctx.fillText(ln, x, y); return; }
    var M = F.m, col = ctx.fillStyle, lw = ctx.measureText(ln).width, sx = align === 'center' ? x - lw / 2 : (align === 'right' ? x - lw : x), lc = sx + lw / 2;
    ctx.textAlign = 'left';
    fxUnits(ln, M.u).forEach(function (r) {
      var gi = F.idx++, ord = M.ord === 'c' ? Math.abs(gi - (F.n - 1) / 2) * 2 : gi, step = Math.min(M.st, (M.cap || 0.9) / F.n);
      var p = clamp((F.t - (M.off || 0) - ord * step) / M.dur, 0, 1), e = EO(p);
      var pre = ctx.measureText(ln.slice(0, r[0])).width, w = ctx.measureText(ln.slice(r[0], r[1])).width, cx = sx + pre + w / 2, cy = y - px * 0.32;
      if (M.fin) F.pts.push({ x: cx, y: y - px * 0.28, t0: (M.off || 0) + ord * step, px: px });
      var T = M.f(p, e, { u: px, cx: cx - lc, i: gi, n: F.n, r: rn(gi, 1), t: F.t }), al = (T.a == null ? 1 : T.a) * a0 * F.fo;
      if (al <= 0.002) { if (F.amb) F.aidx += fxCount(ln.slice(r[0], r[1])); return; }
      ctx.save(); ctx.globalAlpha = al;
      if (T.clip) { ctx.beginPath(); ctx.rect(sx - px * 0.4, y - px * (F.amb ? 1.4 : 1.05), lw + px * 0.8, px * (F.amb ? 2.0 : 1.45)); ctx.clip(); }
      ctx.translate(cx + (T.dx || 0), cy + (T.dy || 0)); if (T.rot) ctx.rotate(T.rot);
      ctx.scale(T.sx || 1, T.sy == null ? 1 : T.sy);
      if (T.bl > 0.4 && F.filt) ctx.filter = 'blur(' + T.bl.toFixed(1) + 'px)';
      ctx.textAlign = 'center';
      if (M.sweep && !F.out && !F.amb) {
        var sp = EO(clamp((F.t - 0.9) / 0.9, 0, 1));
        if (sp > 0 && sp < 1) { var bc = F.x0 + (lw > 0 ? 0 : 0), bw = px * 1.6, mid = (sp * 1.6 - 0.3) * (F.n && lw ? lw : 1) + sx - (cx + (T.dx || 0)), g2 = ctx.createLinearGradient(mid - bw, 0, mid + bw, 0); g2.addColorStop(0, col); g2.addColorStop(0.5, F.hi); g2.addColorStop(1, col); ctx.fillStyle = g2; }
      }
      if (M.pre) M.pre(ctx, { w: w, e: e, p: p, yl: y - cy, px: px, hi: F.hi, al: al });
      var s = T.txt || ln.slice(r[0], r[1]);
      if (T.gh) { ctx.fillStyle = '#00e5ff'; ctx.globalAlpha = al * 0.7 * T.gh; ctx.fillText(s, -px * 0.36 * T.gh, y - cy); ctx.fillStyle = '#ff2bd6'; ctx.fillText(s, px * 0.36 * T.gh, y - cy); ctx.fillStyle = col; ctx.globalAlpha = al; }
      if (F.amb) fxLetters(ctx, F, ln, r, T, w, y, cy, px); else ctx.fillText(s, 0, y - cy);
      ctx.restore();
      if (M.caret && p > 0) {
        var np = F.idx < F.n ? clamp((F.t - (M.off || 0) - F.idx * step) / M.dur, 0, 1) : 0;
        if (np <= 0 && (F.still || F.t < F.FULL || Math.floor(F.t * 2.4) % 2 === 0)) {
          ctx.save(); ctx.globalAlpha = F.fo * F.bo; ctx.fillStyle = F.hi; ctx.fillRect(sx + pre + w + px * 0.05, y - px * 0.86, Math.max(2, px * 0.07), px * 1.0); ctx.restore();
        }
      }
    });
    ctx.textAlign = align;
  }
  /* ── Editor fonts: the same picker and Google Fonts loader the PDF editor uses ── */
  function fontFam(o) {
    if (o.fontName) { fontKick(o.fontName); return '"' + o.fontName + '",' + (FONTS[o.font] || FONTS.clean); }
    return FONTS[o.font] || FONTS.clean;
  }
  function fontKick(n) {
    if (FK[n]) return FK[n];
    try { if (typeof sarvarcLoadFont === 'function') sarvarcLoadFont(n); } catch (e) {}
    FK[n] = new Promise(function (res) {
      var key = 'family=' + encodeURIComponent(n).replace(/%20/g, '+');
      var lk = [].slice.call(document.querySelectorAll('link[rel=stylesheet]')).filter(function (l) { return (l.href || '').indexOf(key) > -1; })[0];
      var go = function () { Promise.all(['700', '400'].map(function (w) { return document.fonts.load(w + ' 40px "' + n + '"'); })).then(function () { res(); }, function () { res(); }); };
      if (!lk || lk.sheet) go(); else { lk.addEventListener('load', go); lk.addEventListener('error', function () { res(); }); }
      setTimeout(res, 5000);
    });
    return FK[n];
  }
  function syncFontBtn() {
    var b = $('sppFontBtn'); if (!b) return;
    b.textContent = S.o.fontName || 'Choose from editor fonts';
    b.style.fontFamily = S.o.fontName ? '"' + S.o.fontName + '",sans-serif' : '';
  }
  window.sppPickFont = function (btn) {
    if (typeof sarvarcOpenFontPicker !== 'function') { say('Editor fonts are not available here', 'info'); return; }
    sarvarcOpenFontPicker(btn, S.o.fontName || 'Inter', function (name) { S.o.fontName = name; syncFontBtn(); fontKick(name); });
    try { if (typeof sarvarcFontPickerEl !== 'undefined' && sarvarcFontPickerEl) sarvarcFontPickerEl.style.zIndex = 100020; } catch (e) {}
  };
  var TRI = function (x) { return 2 / Math.PI * Math.asin(Math.sin(x)); };
  // Text movement: gentle, loop-safe motion applied per letter while the words are on screen.
  // th = phase over a whole number of cycles per loop, so the clip repeats without a jump. w = how much movement is on (eases in and out).
  var TXLIVE = {
    zigzag:  { per: 1.4, f: function (g) { var z = 0.65 * TRI(g.th + g.i * 2.4) + 0.35 * Math.sin(g.th + g.i * 2.4); return { dy: -z * g.px * 0.17 * g.w, dx: z * g.px * 0.035 * g.w, rot: z * 0.07 * g.w }; } },
    wave:    { per: 2.2, f: function (g) { var z = Math.sin(g.th - g.i * 0.5); return { dy: -z * g.px * 0.13 * g.w, rot: Math.cos(g.th - g.i * 0.5) * 0.045 * g.w, sy: 1 + 0.035 * z * g.w }; } },
    float:   { per: 3.0, f: function (g) { var a = g.th + g.r * 6.2832; return { dy: -Math.sin(a) * g.px * 0.09 * g.w, dx: Math.cos(a + 1.3) * g.px * 0.04 * g.w, rot: Math.sin(a + 2) * 0.04 * g.w }; } },
    orbit:   { per: 3.2, f: function (g) { var a = g.th + g.i * 0.55; return { dx: Math.cos(a) * g.px * 0.1 * g.w, dy: Math.sin(a) * g.px * 0.1 * g.w }; } },
    swing:   { per: 2.4, f: function (g) { return { rot: Math.sin(g.th - g.i * 0.35) * 0.17 * g.w, piv: g.px * 0.55 }; } },
    jelly:   { per: 1.8, f: function (g) { var z = Math.sin(g.th - g.i * 0.5); return { sx: 1 + 0.12 * z * g.w, sy: 1 - 0.12 * z * g.w, dy: z * g.px * 0.03 * g.w }; } },
    blink:   { per: 2.6, f: function (g) { var v = Math.max(0, Math.sin(g.th + g.r * 6.2832)), a = 1 - 0.7 * Math.pow(v, 10) * g.w; return { a: a, gl: g.w * (0.55 + 0.45 * a) }; } },
    shimmer: { per: 3.4, f: function (g) { var bp = (((g.th / 6.2832) % 1 + 1) % 1) * (g.n + 6) - 3, b = Math.max(0, 1 - Math.abs(g.i - bp) / 2.6) * g.w; return { mixk: b, dy: -b * g.px * 0.05, sx: 1 + 0.05 * b, sy: 1 + 0.05 * b }; } }
  };
  function fxCount(t) { return String(t).replace(/\s/g, '').length; }
  // Draws one unit letter by letter with the unit's own entrance transform already applied, adding the movement per letter.
  function fxLetters(ctx, F, ln, r, T, w, y, cy, px) {
    var A = F.amb, seg = ln.slice(r[0], r[1]), chars = T.txt ? [T.txt] : seg.split(''), col = ctx.fillStyle, hex = typeof col === 'string' && col.charAt(0) === '#', yl = y - cy, k, ch, off, g, L, pv;
    for (k = 0; k < chars.length; k++) {
      ch = chars[k]; if (ch === ' ') continue;
      off = T.txt ? 0 : ctx.measureText(seg.slice(0, k)).width + ctx.measureText(ch).width / 2 - w / 2;
      g = { th: A.th, i: F.aidx++, n: F.an, r: rn(F.aidx, 21), px: px, w: A.w };
      L = A.f(g); pv = L.piv || 0;
      ctx.save();
      if (L.a != null) ctx.globalAlpha *= L.a;
      if (L.gl) { ctx.shadowColor = F.hi; ctx.shadowBlur = px * 0.32 * L.gl; }
      if (L.mixk > 0 && hex) ctx.fillStyle = rgbStr(mix(hexToRgb(col), hexToRgb(F.hi), L.mixk));
      ctx.translate(off + (L.dx || 0), yl - pv + (L.dy || 0));
      if (L.rot) ctx.rotate(L.rot);
      if (L.sx || L.sy) ctx.scale(L.sx || 1, L.sy || 1);
      ctx.fillText(ch, 0, pv);
      ctx.restore();
    }
  }
  function fxArrow(ctx, x, y, sc, al) {
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 1.15); ctx.lineTo(0.28, 0.9); ctx.lineTo(0.46, 1.32); ctx.lineTo(0.62, 1.25); ctx.lineTo(0.45, 0.85); ctx.lineTo(0.8, 0.85); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = sc * 0.3; ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineJoin = 'round'; ctx.lineWidth = 0.09; ctx.strokeStyle = '#0b1220'; ctx.stroke(); ctx.restore();
  }
  // Pointer clicks: a cursor hops word to word, clicking each one into place. Played backwards on the exit.
  function fxPointer(ctx, F) {
    var P = F.pts; if (!P.length) return;
    var t = F.t, px = P[0].px, k = -1, i, tx, ty, al = 1, hop = 0.22;
    for (i = 0; i < P.length; i++) if (t >= P[i].t0) k = i;
    if (k < 0) { var p0 = P[0], ee = EO(clamp(t / Math.max(0.01, p0.t0), 0, 1)); tx = p0.x + px * 3.4 * (1 - ee); ty = p0.y + px * 2.6 * (1 - ee); al = clamp(t / 0.18, 0, 1); }
    else {
      var cur = P[k], nxt = P[k + 1]; tx = cur.x; ty = cur.y;
      if (nxt) { var q = clamp((t - (nxt.t0 - hop)) / hop, 0, 1); if (q > 0) { var e2 = EO(q); tx = cur.x + (nxt.x - cur.x) * e2; ty = cur.y + (nxt.y - cur.y) * e2 - Math.sin(q * Math.PI) * px * 0.35; } }
    }
    for (i = 0; i < P.length; i++) {
      var rt = t - P[i].t0;
      if (rt >= 0 && rt < 0.5) { var rq = rt / 0.5; ctx.save(); ctx.globalAlpha = (1 - rq) * 0.75 * F.fo * F.bo; ctx.strokeStyle = F.hi; ctx.lineWidth = Math.max(1.5, px * 0.05 * (1 - rq)); ctx.beginPath(); ctx.arc(P[i].x, P[i].y, px * (0.15 + 1.1 * EO(rq)), 0, 7); ctx.stroke(); ctx.restore(); }
    }
    fxArrow(ctx, tx, ty, px * 0.8, al * F.fo * F.bo);
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.38); ctx.bezierCurveTo(x + s * 0.62, y - s * 0.02, x + s * 0.46, y - s * 0.6, x, y - s * 0.2);
    ctx.bezierCurveTo(x - s * 0.46, y - s * 0.6, x - s * 0.62, y - s * 0.02, x, y + s * 0.38); ctx.closePath();
  }
  /* ── Engage: moving cues that make the audience feel part of the clip (tap, swipe, like, reactions, live comment) ── */
  function drawEngage(ctx, W, H, tn, opt) {
    var o = S.o, m = o.eng; if (!m || m === 'none') return;
    var still = !!(opt && opt.textT === 1), secs = o.secs;
    var lt = still ? secs * 0.5 : (((opt && opt.tAbs != null) ? opt.tAbs : tn * secs) % secs);
    var s0 = Math.min(1.5, secs * 0.3), d = Math.min(0.9, secs * 0.22), s1 = secs - d;
    var vis = still ? 1 : smoothQ(clamp((lt - s0) / 0.45, 0, 1)) * (1 - smoothQ(clamp((lt - (s1 - 0.3)) / 0.3, 0, 1)));
    if (vis <= 0.003) return;
    var e = still ? { tap: 0.8, like: 1.3, hearts: 2.4, comment: 4.2, swipe: 0.6 }[m] : lt - s0;
    var u = Math.min(W, H), acc = o.accent, onAcc = lum(hexToRgb(acc)) > 0.6 ? '#0b1220' : '#ffffff', fam = fontFam(o);
    var B = S._tbox, cx = W / 2, gap = u * 0.035, label, fs, cyc;
    function anchor(hh) { if (!B) return H * 0.86; cx = B.cx; var c = B.pos === 'bottom' ? B.top - gap - hh / 2 : B.bot + gap + hh / 2; return clamp(c, hh, H - hh); }
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
    if (m === 'tap') {
      label = o.engText || 'Tap to shop'; fs = u * 0.036; ctx.font = '700 ' + fs + 'px ' + fam;
      var pw = ctx.measureText(label).width + fs * 2.8, phh = fs * 2.4; cyc = anchor(phh);
      var P = 2.2, ph = (e % P) / P, pressed = 0, tapX = cx + pw * 0.18, tapY = cyc + phh * 0.1, ax, ay, aa = clamp(ph / 0.12, 0, 1);
      if (ph < 0.38) { var q = EO(ph / 0.38); ax = tapX + (1 - q) * pw * 0.55; ay = tapY + (1 - q) * phh * 1.7; }
      else if (ph < 0.52) { ax = tapX; ay = tapY; pressed = Math.sin((ph - 0.38) / 0.14 * Math.PI); }
      else { var q2 = EO((ph - 0.52) / 0.48); ax = tapX + q2 * pw * 0.4; ay = tapY + q2 * phh * 1.4; aa = 1 - q2; }
      for (var k = 0; k < 2; k++) { var hp = (((e / 1.4 + k * 0.5) % 1) + 1) % 1, ex = hp * u * 0.05; ctx.globalAlpha = vis * (1 - hp) * 0.5; ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1.5, u * 0.004); rr(ctx, cx - pw / 2 - ex, cyc - phh / 2 - ex, pw + ex * 2, phh + ex * 2, phh / 2 + ex); ctx.stroke(); }
      ctx.save(); ctx.globalAlpha = vis; ctx.translate(cx, cyc); ctx.scale(1 - 0.06 * pressed, 1 - 0.06 * pressed);
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = u * 0.02; ctx.shadowOffsetY = u * 0.006; ctx.fillStyle = acc; rr(ctx, -pw / 2, -phh / 2, pw, phh, phh / 2); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.fillStyle = onAcc; ctx.fillText(label, 0, fs * 0.34); ctx.restore();
      var rp = (ph - 0.38) / 0.37; if (rp > 0 && rp < 1) { ctx.globalAlpha = vis * (1 - rp) * 0.7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, u * 0.004); ctx.beginPath(); ctx.arc(tapX, tapY, u * 0.055 * EO(rp), 0, 7); ctx.stroke(); }
      fxArrow(ctx, ax, ay, u * 0.03, vis * aa);
    } else if (m === 'swipe') {
      label = o.engText || 'Swipe up'; fs = u * 0.032; var cw = u * 0.052; ctx.font = '700 ' + fs + 'px ' + fam; cyc = anchor(fs * 2 + cw * 2.6);
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = u * 0.012; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, u * 0.008); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (var c = 0; c < 3; c++) {
        var cp = (((e * 1.3 - c * 0.2) % 1) + 1) % 1, cy2 = cyc - fs * 0.4 - cw * 0.3 - c * cw * 0.72;
        ctx.globalAlpha = vis * Math.sin(Math.PI * cp) * 0.95;
        ctx.beginPath(); ctx.moveTo(cx - cw / 2, cy2 + cw * 0.22); ctx.lineTo(cx, cy2 - cw * 0.22); ctx.lineTo(cx + cw / 2, cy2 + cw * 0.22); ctx.stroke();
      }
      ctx.globalAlpha = vis; ctx.fillStyle = '#ffffff'; ctx.fillText(label, cx, cyc + fs * 0.5);
    } else if (m === 'like') {
      label = o.engText || 'Double-tap to love it'; fs = u * 0.03; ctx.font = '700 ' + fs + 'px ' + fam;
      var lw = ctx.measureText(label).width + fs * 3.4, lh = fs * 2.3; cyc = anchor(lh);
      ctx.globalAlpha = vis * 0.9; ctx.fillStyle = 'rgba(8,12,24,0.55)'; rr(ctx, cx - lw / 2, cyc - lh / 2, lw, lh, lh / 2); ctx.fill();
      ctx.fillStyle = '#ff4d6d'; heartPath(ctx, cx - lw / 2 + fs * 1.15, cyc + fs * 0.05, fs * 0.95); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.fillText(label, cx - lw / 2 + fs * 2.05, cyc + fs * 0.34); ctx.textAlign = 'center';
      var LP = 2.8, lph = (e % LP) / LP, hq = (lph - 0.3) / 0.55, hx = W / 2, hy = H * 0.44;
      var rg = (lph - 0.25) / 0.2; if (rg > 0 && rg < 1) { ctx.globalAlpha = vis * (1 - rg) * 0.7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, u * 0.005); ctx.beginPath(); ctx.arc(hx, hy, u * (0.05 + 0.1 * EO(rg)), 0, 7); ctx.stroke(); }
      if (hq > 0 && hq < 1) {
        var hs = hq < 0.25 ? EO(hq / 0.25) * 1.25 : 1.25 - 0.25 * EO(clamp((hq - 0.25) / 0.2, 0, 1)), ha = hq < 0.6 ? 1 : 1 - (hq - 0.6) / 0.4;
        ctx.globalAlpha = vis * ha; ctx.shadowColor = 'rgba(255,77,109,0.6)'; ctx.shadowBlur = u * 0.05; ctx.fillStyle = '#ff4d6d'; heartPath(ctx, hx, hy, u * 0.26 * hs); ctx.fill(); ctx.shadowColor = 'transparent';
        for (var b = 0; b < 8; b++) { var an = b * Math.PI / 4 + 0.3, dd = u * 0.3 * EO(hq), bs = u * 0.034 * (1 - hq * 0.6); ctx.globalAlpha = vis * ha * 0.9; ctx.fillStyle = b % 2 ? '#ff8fab' : acc; heartPath(ctx, hx + Math.cos(an) * dd, hy + Math.sin(an) * dd, bs); ctx.fill(); }
      }
    } else if (m === 'hearts') {
      var N = 16, RP = 3.4, pal = [acc, '#ff4d6d', '#ffd166', '#ffffff', '#ff8fab'];
      for (var i = 0; i < N; i++) {
        var hp2 = (((e / RP + i / N) % 1) + 1) % 1, r1 = rn(i, 11), r2 = rn(i, 12);
        var hx2 = W * 0.88 - r1 * W * 0.1 + Math.sin(hp2 * Math.PI * 2 * (1 + r2) + i) * u * 0.03 * (0.5 + hp2), hy2 = H * 0.86 - hp2 * H * 0.58;
        var sz = u * (0.03 + 0.03 * r2) * (0.6 + 0.4 * Math.min(1, hp2 * 3));
        ctx.globalAlpha = vis * Math.min(1, hp2 * 6) * (1 - Math.pow(hp2, 3)) * 0.95; ctx.fillStyle = pal[i % pal.length];
        if (i % 4 === 3) { ctx.beginPath(); ctx.arc(hx2, hy2, sz * 0.32, 0, 7); ctx.fill(); } else { heartPath(ctx, hx2, hy2, sz); ctx.fill(); }
      }
      if (o.engText) {
        fs = u * 0.032; ctx.font = '700 ' + fs + 'px ' + fam; var cw2 = ctx.measureText(o.engText).width + fs * 2.4, ch2 = fs * 2.2; cyc = anchor(ch2);
        ctx.globalAlpha = vis * 0.9; ctx.fillStyle = 'rgba(8,12,24,0.55)'; rr(ctx, cx - cw2 / 2, cyc - ch2 / 2, cw2, ch2, ch2 / 2); ctx.fill();
        ctx.globalAlpha = vis; ctx.fillStyle = '#ffffff'; ctx.fillText(o.engText, cx, cyc + fs * 0.34);
      }
    } else if (m === 'comment') {
      var txt = o.engText || 'Need this right now!'; fs = u * 0.03; ctx.font = '600 ' + fs + 'px ' + fam;
      var bh = fs * 2.5, full = Math.min(W * 0.8, ctx.measureText(txt).width + fs * 2.4), dotsW = fs * 3.4;
      var nch = clamp(Math.floor((e - 1.5) * 22), 0, txt.length), shown = txt.slice(0, nch);
      var cwid = e < 1.5 ? dotsW : Math.max(dotsW, Math.min(full, ctx.measureText(shown).width + fs * 2.4));
      var yb = B ? (B.pos === 'bottom' ? B.top - gap - bh : B.bot + gap) : H * 0.78, x0 = W * 0.06, sIn = EO(clamp(e / 0.5, 0, 1));
      yb = clamp(yb, bh * 0.2, H - bh * 1.2) + (1 - sIn) * bh * 1.2;
      ctx.globalAlpha = vis; ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(x0 + bh / 2, yb + bh / 2, bh / 2, 0, 7); ctx.fill();
      ctx.fillStyle = onAcc; ctx.beginPath(); ctx.arc(x0 + bh / 2, yb + bh * 0.4, bh * 0.15, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x0 + bh / 2, yb + bh * 0.86, bh * 0.27, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
      var bx = x0 + bh * 1.2;
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = u * 0.015; ctx.shadowOffsetY = u * 0.004; ctx.fillStyle = 'rgba(255,255,255,0.95)'; rr(ctx, bx, yb, cwid, bh, bh * 0.5); ctx.fill(); ctx.shadowColor = 'transparent';
      if (e < 1.5) { for (var dt = 0; dt < 3; dt++) { var bob = Math.sin(e * 9 - dt * 0.9) * bh * 0.09; ctx.fillStyle = 'rgba(15,23,42,0.6)'; ctx.beginPath(); ctx.arc(bx + dotsW / 2 + (dt - 1) * fs * 0.8, yb + bh / 2 + bob, fs * 0.22, 0, 7); ctx.fill(); } }
      else { ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.fillText(shown, bx + fs * 1.2, yb + bh / 2 + fs * 0.34); }
    }
    ctx.restore();
  }
  function drawText(ctx, W, H, prog, tt) {
    var o = S.o; if (!(o.head || o.sub || o.badge)) return;
    var still = tt == null || tt >= 99, lt = still ? 99 : (outOn(o) ? tt % o.secs : tt), q = still ? 0 : outQ(o, lt), sq = smoothQ(q);
    var riseOut = o.txtOut === 'rise' || (o.txtOut === 'auto' && o.txtAnim === 'rise');
    var pin = still ? prog : (o.txtAnim === 'none' ? 1 : 1 - Math.pow(1 - clamp(lt / 0.9, 0, 1), 3));
    var L = layout(W, H), pos = L.pos, family = fontFam(o), col = textColor(pos);
    var sideways = pos === 'left' || pos === 'right';
    var unit = Math.min(W, H) * (sideways ? 0.085 : 0.1) * (o.txtSize / 100);
    var headPx = unit, subPx = unit * 0.46, badgePx = unit * 0.3, weight = o.fontName ? '700' : (o.font === 'bold' ? '400' : '800');
    var maxW = sideways ? W * 0.4 : W * 0.86, align = sideways ? 'left' : 'center';
    var x = sideways ? (pos === 'left' ? W * 0.07 : W * 0.53) : W / 2;
    if (!sideways && (o.fit === 'fill' || o.fit === 'gallery') && o.txtAlign === 'left') { align = 'left'; x = W * 0.07; maxW = W * 0.8; }
    else if (!sideways && (o.fit === 'fill' || o.fit === 'gallery') && o.txtAlign === 'right') { align = 'right'; x = W * 0.93; maxW = W * 0.8; }
    ctx.save();
    ctx.globalAlpha = prog; ctx.textBaseline = 'alphabetic'; ctx.textAlign = align;
    var slide = (o.txtAnim === 'rise' ? (1 - pin) * H * 0.03 : 0) - (riseOut ? sq * H * 0.03 : 0);

    ctx.font = weight + ' ' + headPx + 'px ' + family;
    var headLines = o.head ? wrapLines(ctx, o.head, maxW, 2) : [];
    ctx.font = '500 ' + subPx + 'px ' + family;
    var subLines = o.sub ? wrapLines(ctx, o.sub, maxW, 2) : [];
    var badgeH = o.badge ? badgePx * 2 : 0, gap = unit * 0.22;
    var blockH = (badgeH ? badgeH + gap : 0) + headLines.length * headPx * 1.05 + (subLines.length ? gap + subLines.length * subPx * 1.25 : 0);
    var top;
    if (pos === 'bottom') top = H - blockH - H * 0.06;
    else if (pos === 'top') top = H * 0.06;
    else top = (H - blockH) / 2;
    S._tbox = { top: top, bot: top + blockH, cx: align === 'center' ? x : (align === 'right' ? x - maxW / 2 : x + maxW / 2), pos: pos };
    var amb = null, lv = o.txtLive;
    if (lv && lv !== 'none' && TXLIVE[lv]) {
      var LX = TXLIVE[lv], cyc = Math.max(1, Math.round(o.secs / LX.per)), alt = still ? o.secs * 0.3 : lt;
      amb = { f: LX.f, th: 6.2832 * cyc * (alt / o.secs), w: still ? ((lv === 'blink' || lv === 'shimmer') ? 0 : 0.8) : smoothQ(clamp((lt - 0.5) / 0.9, 0, 1)) * (1 - sq) };
    }
    var fm = fxMotion(o) || (amb ? '_cls' : null); FXS = null;
    if (fm) {
      var fu = 0; headLines.concat(subLines).forEach(function (l) { fu += fxUnits(l, MOT[fm].u).length; });
      var Mx = MOT[fm], nn = Math.max(1, fu), isCls = fm === '_cls', mirror = q > 0 && o.txtOut === 'auto' && !isCls, lc = 0;
      headLines.concat(subLines).forEach(function (l) { lc += fxCount(l); });
      var FULL = (nn - 1) * Math.min(Mx.st, (Mx.cap || 0.9) / nn) + Mx.dur + (Mx.off || 0);
      FXS = { m: Mx, t: mirror ? FULL * (1 - q) : lt, n: nn, idx: 0, x0: align === 'center' ? x - maxW / 2 : (align === 'right' ? x - maxW : x), hi: o.accent, filt: 'filter' in ctx,
              fo: isCls ? prog : ((q > 0 && !mirror) ? 1 - sq : 1), bo: 1 - sq, amb: amb, aidx: 0, an: Math.max(1, lc), cls: isCls, out: q > 0, pts: [], still: still, FULL: FULL };
      if (!isCls) slide = riseOut ? -sq * H * 0.03 : 0; ctx.globalAlpha = 1;
      if (fm === 'iris') { var ip = mirror ? 1 - q : clamp(lt, 0, 1); if (mirror) FXS.t = 99; ctx.beginPath(); ctx.arc(FXS.x0 + maxW / 2, top + blockH / 2, EO(ip) * (Math.hypot(maxW, blockH) * 0.6 + headPx), 0, 7); ctx.clip(); }
    }
    var y = top + slide;

    if (o.badge) {
      ctx.globalAlpha = FXS && !FXS.cls ? clamp(FXS.t / 0.5, 0, 1) * FXS.bo : prog; ctx.font = '800 ' + badgePx + 'px ' + FONTS.clean;
      var txt = String(o.badge).toUpperCase(), tw = ctx.measureText(txt).width + badgePx * 1.6, bh = badgePx * 1.9;
      var bx = align === 'center' ? x - tw / 2 : (align === 'right' ? x - tw : x);
      ctx.fillStyle = o.accent; rr(ctx, bx, y, tw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = lum(hexToRgb(o.accent)) > 0.6 ? '#0b1220' : '#ffffff';
      ctx.textAlign = 'center'; ctx.fillText(txt, bx + tw / 2, y + bh * 0.68);
      ctx.textAlign = align; y += badgeH + gap;
    }
    ctx.fillStyle = col;
    if (o.bgMode !== 'empty' || o.fit === 'fill') { ctx.shadowColor = o.fit === 'fill' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.18)'; ctx.shadowBlur = unit * 0.12; ctx.shadowOffsetY = unit * 0.03; }
    ctx.font = weight + ' ' + headPx + 'px ' + family;
    headLines.forEach(function (ln) { y += headPx * 0.92; fxPut(ctx, ln, x, y, align, headPx, 1); y += headPx * 0.13; });
    ctx.shadowColor = 'transparent';
    if (subLines.length) {
      y += gap * 0.6; ctx.globalAlpha = prog * 0.82; ctx.font = '500 ' + subPx + 'px ' + family;
      subLines.forEach(function (ln) { y += subPx * 1.05; fxPut(ctx, ln, x, y, align, subPx, 0.82); y += subPx * 0.2; });
    }
    if (FXS && FXS.m.fin) FXS.m.fin(ctx, FXS);
    ctx.restore();
  }

  /* ───────────────────────── MORE TEXTS (build 305) ─────────────────────────
     Extra texts on top of the main one. Every text has its own words, place, timing and style, so a showcase can present
     many products (one text per photo) or run a timed explainer (one text per scene).
     Each text is drawn by the SAME engine as the main text (drawText) with its own copy of the settings, so every text
     motion, font, position and shade works for them too, in the preview, PNG, MP4 and live clips alike.
     Stored in S.o.xt, so it travels with autosave, Drive, the image's own Showcase and live clips.
     Timing is kept as fractions of the loop, so changing "Seconds per loop" keeps every text in step. */
  var XT_MAX = 24;
  var xtActId = 'main', xtFlash = false;   // 'main' = the first text (the Text section's own fields)   // which text is open in the editor (screen only, never saved)
  var XT_WIDE_KEY = 'sarvarcShowcaseXtWide';
  function xtWidePref() { try { return localStorage.getItem(XT_WIDE_KEY) !== '0'; } catch (e) { return true; } }
  // The right panel glides wider while "More texts" is open and has texts; it glides back when another section opens.
  function xtLayout() {
    var ov = $('sppOverlay'), g = $('sppXtGrp'); if (!ov) return;
    ov.classList.toggle('sp-xt-wide', !!(g && g.open && (S.o.xt || []).length && xtWidePref()));
    // Photos: wide while the Photo section is open in multi-photo mode (same preference as the Texts toggle)
    var pg = $('sppPhotoGrp'), md = ov.querySelector('.spp-modal');
    ov.classList.toggle('sp-ph-wide', !!(pg && pg.open && md && md.classList.contains('spp-galmode') && xtWidePref()));
    var mg = $('sppMotionGrp');
    ov.classList.toggle('sp-mo-wide', !!(mg && mg.open && md && !md.classList.contains('spp-galmode') && xtWidePref()));
    [].forEach.call(ov.querySelectorAll('[data-wide-btn]'), function (pw) {
      var on = xtWidePref(); pw.setAttribute('aria-pressed', on ? 'true' : 'false');
      pw.title = on ? 'Back to the normal panel width' : 'Give the panel more room so everything is in view';
      pw.innerHTML = (on ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>Narrower'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>Wider');
    });
  }
  function xtPick(id, quiet) {
    if (id === 'main') { xtActId = 'main'; xtFlash = false; xtRender(); return; }
    if (!xtFind(id)) return;
    xtActId = id; xtFlash = !quiet; xtRender();
    var c = xtFind(id); if (c) xtSeekIfHidden(c);   // show it in the preview if it is not on screen right now
  }
  function xtHas(t) { return !!(t && (t.head || t.sub || t.badge)); }
  // New texts start on the opposite side to the main text, so they never land on top of it
  function xtDefPos() {
    var o = S.o; if (!(o.head || o.sub || o.badge)) return o.txtPos || 'bottom';
    return { bottom: 'top', top: 'bottom', left: 'right', right: 'left' }[o.txtPos] || 'top';
  }
  function xtNew(p) {
    return Object.assign({ id: 'xt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), head: '', sub: '', badge: '', when: 'all', photo: 0, a: 0, b: 1,
      pos: xtDefPos(), size: 100, anim: 'same', col: '', font: '', al: '' }, p || {});
  }
  // The text that decides how much room the layouts leave for words: the main one, or the first extra when the main one is empty.
  function xtLead(o) {
    if (o.head || o.sub || o.badge || !o.xt || !o.xt.length) return o;
    for (var i = 0; i < o.xt.length; i++) {
      var t = o.xt[i]; if (!xtHas(t) || (t.when === 'photo' && o.fit !== 'gallery')) continue;
      return { head: t.head || '', sub: t.sub || '', badge: t.badge || '', txtPos: t.pos || o.txtPos, txtSize: o.txtSize * ((+t.size || 100) / 100) };
    }
    return o;
  }
  // When a text is on screen, as [start, end] fractions of the loop. null = not shown right now.
  function xtWindow(t, n) {
    if (t.when === 'photo') {
      if (S.o.fit !== 'gallery' || n < 1) return null;
      var p = clamp(Math.round(+t.photo || 0), 0, n - 1); return [p / n, (p + 1) / n];
    }
    if (t.when === 'time') {
      var a = clamp(+t.a || 0, 0, 0.98), b = clamp(t.b == null ? 1 : +t.b, 0, 1); if (b < a + 0.02) b = Math.min(1, a + 0.02); return [a, b];
    }
    return [0, 1];
  }
  function xtActive(tn, opt) {
    var o = S.o, xt = o.xt; if (!xt || !xt.length) return null;
    var still = !!(opt && opt.textT === 1), secs = Math.max(0.5, o.secs), n = S.gal.length, out = null;
    var lt = ((((opt && opt.tAbs != null && !still) ? opt.tAbs : tn * secs) % secs) + secs) % secs;
    xt.forEach(function (t) {
      if (!xtHas(t)) return;
      var w = xtWindow(t, n); if (!w) return;
      var a = w[0] * secs, b = w[1] * secs;
      if (lt < a - 1e-6 || lt >= b - 1e-6) return;
      var u = lt - a, d = Math.max(0.3, b - a);
      var ov = Object.assign({}, o, { head: t.head || '', sub: t.sub || '', badge: t.badge || '', txtPos: t.pos || o.txtPos, txtSize: o.txtSize * ((+t.size || 100) / 100), secs: d, xt: null });
      if (t.anim && t.anim !== 'same') ov.txtAnim = t.anim;
      if (t.when !== 'all' && o.txtOut === 'stay') ov.txtOut = 'fade';   // a text that owns a time slot always leaves at the end of it
      if (t.col) { ov.txtAuto = false; ov.txtCol = t.col; }
      if (t.font) { ov.font = t.font; ov.fontName = ''; }
      if (t.al) ov.txtAlign = t.al;
      var prog = 1;
      if (!still) { var keep = S.o; S.o = ov; try { prog = textProgress(null, u); } finally { S.o = keep; } }
      (out = out || []).push({ ov: ov, u: u, prog: prog, still: still });
    });
    return out;
  }
  // The soft dark fade behind the words, for layouts where the photo fills the frame
  function xtScrim(ctx, W, H, acts) {
    var o = S.o; if (!acts || o.scrim <= 0 || !(o.fit === 'fill' || (o.fit === 'gallery' && GALFULL[o.gal]))) return;
    acts.forEach(function (a) {
      if (a.prog <= 0.001) return;
      if (a.ov.txtPos === 'center') {
        var al = o.scrim / 100 * 0.64 * a.prog, g = ctx.createLinearGradient(0, H * 0.26, 0, H * 0.74);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,' + al + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
      }
      var keep = S.o; S.o = a.ov; try { drawScrim(ctx, W, H, a.prog); } finally { S.o = keep; }
    });
  }
  function xtText(ctx, W, H, acts) {
    if (!acts) return;
    var keepO = S.o, keepBox = S._tbox;
    acts.forEach(function (a) {
      S.o = a.ov;
      try { drawText(ctx, W, H, a.prog, a.still ? 99 : a.u); }
      catch (e) { console.error('Showcase extra text failed', e); }
      finally { S.o = keepO; }
    });
    S._tbox = keepBox; FXS = null;   // the main text box belongs to the Engage prompt, so it must be put back
  }

  /* ── editing ── */
  var XT_POS = [['bottom', 'Bottom'], ['top', 'Top'], ['center', 'Centre'], ['left', 'Left'], ['right', 'Right']];
  var XT_FONT = [['', 'Same as text 1'], ['clean', 'Clean sans'], ['serif', 'Elegant serif'], ['bold', 'Bold impact'], ['mono', 'Mono']];
  var XT_AL = [['', 'Same as text 1'], ['center', 'Center'], ['left', 'Left'], ['right', 'Right']];
  function xtSave() { try { if (window.sppSaveSoon) window.sppSaveSoon(); } catch (e) {} }
  function xtSet(id, patch) {
    S.o.xt = (S.o.xt || []).map(function (t) { return t.id === id ? Object.assign({}, t, patch) : t; });
    xtSave();
  }
  function xtList(next) { S.o.xt = next; xtSave(); xtRender(); }
  function xtFind(id) { return (S.o.xt || []).filter(function (t) { return t.id === id; })[0]; }
  function xtSeek(t) {   // park the preview where this text is fully on screen
    var w = xtWindow(t, S.gal.length); if (!w) { say('Switch to Multi-photo to preview a text that is linked to a photo.', 'info'); return; }
    var secs = S.o.secs, tt = w[0] * secs + Math.min(1.2, (w[1] - w[0]) * secs * 0.6);
    S.tNorm = clamp(tt / secs, 0, 0.9999); S.playing = false;
    var pb = $('sppPlayBtn'); if (pb) pb.textContent = 'Play';
    var sc = $('sppScrub'); if (sc) sc.value = Math.round(S.tNorm * 1000);
  }
  function xtSeekIfHidden(t) {
    var w = xtWindow(t, S.gal.length); if (!w) return;
    var lt = S.tNorm * S.o.secs; if (lt >= w[0] * S.o.secs && lt < w[1] * S.o.secs) return;
    xtSeek(t);
  }
  window.sppXtAdd = function () {
    var xt = S.o.xt || [];
    if (xt.length >= XT_MAX) { say('Showcase holds up to ' + XT_MAX + ' extra texts.', 'info'); return; }
    var p = {};
    if (S.o.fit === 'gallery' && S.gal.length) {   // the next photo that has no text yet
      var used = {}; xt.forEach(function (t) { if (t.when === 'photo') used[t.photo] = 1; });
      var k = 0; while (k < S.gal.length - 1 && used[k]) k++;
      p = { when: 'photo', photo: k };
    }
    var t = xtNew(p); xtActId = t.id; xtFlash = true; xtList(xt.concat([t]));
    setTimeout(function () { var el = document.querySelector('#sppXtList [data-xid="' + t.id + '"] input[type=text]'); if (el) { try { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { el.focus(); } } }, 60);
  };
  window.sppXtPerPhoto = function () {
    var n = S.gal.length; if (!n) { say('Add a few photos first.', 'info'); return; }
    var xt = S.o.xt || [], have = {}, add = [], i;
    xt.forEach(function (t) { if (t.when === 'photo') have[t.photo] = 1; });
    for (i = 0; i < n && xt.length + add.length < XT_MAX; i++) if (!have[i]) add.push(xtNew({ when: 'photo', photo: i }));
    if (!add.length) { say(xt.length >= XT_MAX ? 'Showcase holds up to ' + XT_MAX + ' extra texts.' : 'Every photo already has its own text.', 'info'); return; }
    xtActId = add[0].id; xtFlash = true;
    xtList(xt.concat(add));
    say('Added ' + add.length + ' text' + (add.length === 1 ? '' : 's') + '. Type the words for each photo.', 'success');
  };
  window.sppXtSplit = function () {
    var k = +($('sppXtSplitN') || {}).value || 3, xt = S.o.xt || [], add = [], i;
    if (xt.length + k > XT_MAX) { say('Showcase holds up to ' + XT_MAX + ' extra texts.', 'info'); return; }
    for (i = 0; i < k; i++) add.push(xtNew({ when: 'time', a: i / k, b: (i + 1) / k }));
    xtActId = add[0].id; xtFlash = true;
    xtList(xt.concat(add));
    say(k + ' timed texts added. Each one has an equal share of the video.', 'success');
  };
  function xtForPhoto(i) {   // the T button on a photo thumbnail
    var xt = S.o.xt || [], ex = xt.filter(function (t) { return t.when === 'photo' && t.photo === i; })[0];
    if (!ex) {
      if (xt.length >= XT_MAX) { say('Showcase holds up to ' + XT_MAX + ' extra texts.', 'info'); return; }
      ex = xtNew({ when: 'photo', photo: i }); xtActId = ex.id; xtFlash = true; xtList(xt.concat([ex]));
    } else { xtActId = ex.id; xtFlash = true; xtRender(); }
    var g = $('sppXtGrp'); if (g) { g.open = true; xtLayout(); }
    setTimeout(function () {
      var el = document.querySelector('#sppXtList [data-xid="' + ex.id + '"]'); if (!el) return;
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
      var inp = el.querySelector('input[type=text]'); if (inp) inp.focus();
    }, 70);
  }
  // Keeps each photo's text with its photo when photos are moved, removed or re-ordered.
  function xtRemap(fn) {
    var xt = S.o.xt; if (!xt || !xt.length) return;
    var next = [];
    xt.forEach(function (t) {
      if (t.when !== 'photo') { next.push(t); return; }
      var p = fn(+t.photo || 0); if (p == null) return;
      next.push(p === t.photo ? t : Object.assign({}, t, { photo: p }));
    });
    S.o.xt = next; xtSave();
  }
  function xtMarkThumbs() {
    var th = document.querySelectorAll('#sppGalThumbs .spp-th'), xt = S.o.xt || [];
    [].forEach.call(th, function (d, i) {
      var b = d.querySelector('.t'); if (!b) return;
      var has = xt.some(function (t) { return t.when === 'photo' && t.photo === i && xtHas(t); });
      b.classList.toggle('has', has); b.title = has ? 'Edit the text on this photo' : 'Add a text to this photo';
    });
  }

  /* ── the panel ── */
  function xtEl(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function xtSel(opts, val, on) {
    var s2 = document.createElement('select'); s2.style.cssText = 'width:auto;flex:1';
    opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s2.appendChild(op); });
    s2.value = val; s2.onchange = function () { on(s2.value); }; return s2;
  }
  function xtRow(label, ctl, extra) { var r = xtEl('div', 'spp-row'); r.appendChild(xtEl('label', '', label)); r.appendChild(ctl); if (extra) r.appendChild(extra); return r; }
  function xtRange(min, max, step, val, fmt, on) {
    var r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
    var v = xtEl('span', 'spp-val w', fmt(val));
    r.oninput = function () { v.textContent = fmt(+r.value); on(+r.value); };
    return [r, v];
  }
  function xtLabel(t, i) {
    var w = t.when === 'photo' ? 'Photo ' + ((+t.photo || 0) + 1) : t.when === 'time' ? (((+t.a || 0) * S.o.secs).toFixed(1) + 's to ' + ((t.b == null ? 1 : +t.b) * S.o.secs).toFixed(1) + 's') : 'Whole video';
    var h = String(t.head || t.sub || t.badge || '').slice(0, 22);
    return (i + 2) + '. ' + w + (h ? ' · ' + h : '');
  }
  function xtCard(t, i, n) {
    var card = xtEl('div', 'spp-xt spp-xt-ed' + (xtFlash ? ' spp-xt-in' : '')), id = t.id; xtFlash = false; card.setAttribute('data-xid', id);
    var h = xtEl('div', 'spp-xt-h'), title = xtEl('b', '', xtLabel(t, i));
    function upTitle() { var cur = xtFind(id); if (cur) { title.textContent = xtLabel(cur, (S.o.xt || []).indexOf(cur)); xtChips(); } }
    function hb(txt, tip, fn) { var b = xtEl('button', '', txt); b.type = 'button'; b.title = tip; b.onclick = fn; return b; }
    h.appendChild(title);
    h.appendChild(hb('▶', 'Show this text in the preview', function () { var c = xtFind(id); if (c) xtSeek(c); }));
    h.appendChild(hb('⧉', 'Duplicate this text', function () {
      var xt = S.o.xt || [], c = xtFind(id); if (!c) return;
      if (xt.length >= XT_MAX) { say('Showcase holds up to ' + XT_MAX + ' extra texts.', 'info'); return; }
      var cp = Object.assign({}, c, { id: xtNew().id }), at = xt.indexOf(c) + 1;
      xtActId = cp.id; xtFlash = true;
      xtList(xt.slice(0, at).concat([cp], xt.slice(at)));
    }));
    h.appendChild(hb('×', 'Delete this text', function () {
      var all = S.o.xt || [], at = all.indexOf(xtFind(id)), rest = all.filter(function (x) { return x.id !== id; });
      xtActId = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)].id : null; xtFlash = true;
      xtList(rest);
    }));
    card.appendChild(h);
    var grid = xtEl('div', 'spp-xt-grid'), words = xtEl('div', 'spp-xt-words'), whenBox = xtEl('div', 'spp-xt-when');
    [['head', 'Headline'], ['sub', 'Subline'], ['badge', 'Badge, e.g. NEW']].forEach(function (f) {
      var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = (t.when === 'photo' && f[0] === 'head') ? 'Headline for photo ' + ((+t.photo || 0) + 1) : f[1];
      inp.value = t[f[0]] || ''; inp.autocomplete = 'off';
      inp.oninput = function () { var p = {}; p[f[0]] = inp.value; xtSet(id, p); upTitle(); xtMarkThumbs(); };
      inp.onfocus = function () { var c = xtFind(id); if (c) xtSeekIfHidden(c); };
      words.appendChild(inp);
    });
    // when it appears
    var whenOpts = [['all', 'Whole video']];
    if (S.o.fit === 'gallery' || t.when === 'photo') whenOpts.push(['photo', 'With a photo']);
    whenOpts.push(['time', 'Custom time']);
    whenBox.appendChild(xtRow('Appears', xtSel(whenOpts, t.when, function (v) {
      var c = xtFind(id); if (!c) return;
      var p = { when: v };
      if (v === 'photo') p.photo = clamp(+c.photo || 0, 0, Math.max(0, n - 1));
      if (v === 'time' && c.when !== 'time') { var w0 = xtWindow(c, n) || [0, 1]; p.a = w0[0]; p.b = w0[1]; }
      xtSet(id, p); xtRender();
    })));
    if (t.when === 'photo') {
      var po = [], k, cur = clamp(+t.photo || 0, 0, Math.max(0, n - 1));
      for (k = 0; k < Math.max(1, n); k++) po.push([String(k), 'Photo ' + (k + 1)]);
      whenBox.appendChild(xtRow('Photo', xtSel(po, String(cur), function (v) { xtSet(id, { photo: +v }); xtRender(); })));
      if (S.o.fit !== 'gallery') whenBox.appendChild(xtEl('div', 'spp-note', 'This text shows once Multi-photo is on.'));
    }
    if (t.when === 'time') {
      var secs = S.o.secs, fmt = function (v) { return (v / 1000 * secs).toFixed(1) + 's'; }, rt;
      var rf = xtRange(0, 980, 5, Math.round((+t.a || 0) * 1000), fmt, function (v) {
        if (v > +rt[0].value - 20) { rt[0].value = Math.min(1000, v + 20); rt[1].textContent = fmt(+rt[0].value); }
        xtSet(id, { a: v / 1000, b: +rt[0].value / 1000 }); upTitle();
      });
      rt = xtRange(20, 1000, 5, Math.round((t.b == null ? 1 : +t.b) * 1000), fmt, function (v) {
        if (v < +rf[0].value + 20) { rf[0].value = Math.max(0, v - 20); rf[1].textContent = fmt(+rf[0].value); }
        xtSet(id, { a: +rf[0].value / 1000, b: v / 1000 }); upTitle();
      });
      whenBox.appendChild(xtRow('From', rf[0], rf[1])); whenBox.appendChild(xtRow('To', rt[0], rt[1]));
    }
    // style and motion
    var sg = document.createElement('details'); sg.className = 'spp-grp'; sg.style.border = 'none';
    var sm = xtEl('summary', '', 'Style and motion'); sm.style.cssText = 'padding:8px 0 4px;opacity:.7'; sg.appendChild(sm);
    var si = xtEl('div', 'spp-in'); sg.appendChild(si);
    si.appendChild(xtRow('Position', xtSel(XT_POS, t.pos || 'bottom', function (v) { xtSet(id, { pos: v }); })));
    var an = document.createElement('select'); an.style.cssText = 'width:auto;flex:1';
    var base = $('sppTxtAnim'); an.innerHTML = '<option value="same">Same as text 1</option>' + (base ? base.innerHTML : '');
    an.value = t.anim || 'same'; an.onchange = function () { xtSet(id, { anim: an.value }); };
    si.appendChild(xtRow('Motion', an));
    var sz = xtRange(40, 200, 1, +t.size || 100, function (v) { return String(v); }, function (v) { xtSet(id, { size: v }); });
    si.appendChild(xtRow('Size', sz[0], sz[1]));
    si.appendChild(xtRow('Font', xtSel(XT_FONT, t.font || '', function (v) { xtSet(id, { font: v }); })));
    si.appendChild(xtRow('Align', xtSel(XT_AL, t.al || '', function (v) { xtSet(id, { al: v }); })));
    var au = document.createElement('input'); au.type = 'checkbox'; au.checked = !t.col;
    var cl = document.createElement('input'); cl.type = 'color'; cl.value = t.col || '#ffffff';
    var cr = xtRow('Text colour', cl); cr.style.display = t.col ? '' : 'none';
    au.onchange = function () { cr.style.display = au.checked ? 'none' : ''; xtSet(id, { col: au.checked ? '' : cl.value }); };
    cl.oninput = function () { xtSet(id, { col: cl.value }); };
    si.appendChild(xtRow('Auto text colour', au)); si.appendChild(cr);
    grid.appendChild(words); grid.appendChild(whenBox); card.appendChild(grid);
    card.appendChild(sg);
    return card;
  }
  // A thin timeline: when each text is on screen. Click one to preview it.
  function xtTrack() {
    var tr = $('sppXtTrack'); if (!tr) return;
    var xt = S.o.xt || [], n = S.gal.length, lanes = [], items = [];
    xt.forEach(function (t, i) {
      var w = xtWindow(t, n); if (!w) return;
      var L = 0; while (lanes[L] != null && lanes[L] > w[0] + 1e-6) L++;
      lanes[L] = w[1]; items.push([t, i, w, L]);
    });
    tr.innerHTML = '';
    if (!items.length) { tr.style.display = 'none'; return; }
    tr.style.display = ''; tr.style.height = (Math.min(lanes.length, 6) * 14 + 4) + 'px';
    items.forEach(function (it) {
      if (it[3] >= 6) return;
      var b = xtEl('i', '', String(it[1] + 1));
      b.style.left = (it[2][0] * 100) + '%'; b.style.width = Math.max(2, (it[2][1] - it[2][0]) * 100) + '%'; b.style.top = (2 + it[3] * 14) + 'px';
      b.title = xtLabel(it[0], it[1]); if (it[0].id === xtActId) b.className = 'on'; b.onclick = function () { xtActId = it[0].id; xtFlash = true; xtRender(); xtSeek(it[0]); }; tr.appendChild(b);
    });
  }
  // Numbered chips: one tap picks the text to edit. The same numbers sit on the timeline above.
  function xtChips() {
    var nav = $('sppXtNav'); if (!nav) return;
    var xt = S.o.xt || [];
    nav.innerHTML = '';
    if (!xt.length) { nav.style.display = 'none'; return; }
    nav.style.display = '';
    var top = xtEl('div', 'spp-xt-navtop');
    top.appendChild(xtEl('span', 'spp-xt-cap', (xt.length + 1) + ' texts'));
    var on = xtWidePref(), wb = xtEl('button', 'spp-xt-wbtn' + (on ? ' is-wide' : '')); wb.type = 'button';
    wb.title = on ? 'Back to the normal panel width' : 'Give the panel more room while you work on texts';
    wb.setAttribute('aria-pressed', on ? 'true' : 'false');
    wb.innerHTML = on
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    wb.appendChild(document.createTextNode(on ? 'Narrower' : 'Wider'));
    wb.onclick = function () { try { localStorage.setItem(XT_WIDE_KEY, xtWidePref() ? '0' : '1'); } catch (e) {} xtChips(); xtLayout(); };
    top.appendChild(wb); nav.appendChild(top);
    var row = xtEl('div', 'spp-xt-chips'), mo = S.o, mhas = !!(mo.head || mo.sub || mo.badge);
    var m1 = xtEl('button', 'spp-xt-chip' + (xtActId === 'main' ? ' on' : '') + (mhas ? '' : ' empty'), '1'); m1.type = 'button';
    m1.title = 'Main text' + (mhas ? ': ' + String(mo.head || mo.sub || mo.badge).slice(0, 22) : ''); m1.setAttribute('aria-pressed', xtActId === 'main' ? 'true' : 'false');
    m1.onclick = function () { xtPick('main'); }; row.appendChild(m1);
    xt.forEach(function (t, i) {
      var b = xtEl('button', 'spp-xt-chip' + (t.id === xtActId ? ' on' : '') + (xtHas(t) ? '' : ' empty'), String(i + 2)); b.type = 'button';
      b.title = xtLabel(t, i); b.setAttribute('aria-pressed', t.id === xtActId ? 'true' : 'false');
      b.onclick = function () { xtPick(t.id); };
      row.appendChild(b);
    });
    if (xt.length < XT_MAX) { var ad = xtEl('button', 'spp-xt-chip add', '+'); ad.type = 'button'; ad.title = 'Add another text'; ad.setAttribute('aria-label', 'Add another text'); ad.onclick = function () { window.sppXtAdd(); }; row.appendChild(ad); }
    nav.appendChild(row);
  }
  window.sppStaySet = function (on) {
    var v = on ? 'stay' : 'auto', sel = $('sppTxtOut'); if (sel) sel.value = v;
    window.sppSet('txtOut', v);
  };
  function xtStay() { var c = $('sppStay'); if (c) c.checked = S.o.txtOut === 'stay'; }
  function xtStart() {
    var st = $('sppXtStart'), cap = $('sppXtStartCap'), intro = $('sppXtIntro'), has = (S.o.xt || []).length > 0;
    if (st) st.classList.add('has-texts');
    if (cap) cap.textContent = has ? 'Add more' : 'Need more than one text?';
    if (intro) intro.style.display = 'none';
  }
  (function () {
    var g = $('sppXtGrp'); if (g) g.addEventListener('toggle', function () { xtStart(); xtLayout(); }); xtStart();
    var pg = $('sppPhotoGrp'); if (pg) pg.addEventListener('toggle', function () { xtLayout(); });
    var mgp = $('sppMotionGrp'); if (mgp) mgp.addEventListener('toggle', function () { xtLayout(); });
    [].forEach.call(document.querySelectorAll('#sppOverlay [data-wide-btn]'), function (pw) { pw.onclick = function () { try { localStorage.setItem(XT_WIDE_KEY, xtWidePref() ? '0' : '1'); } catch (e) {} xtLayout(); if ((S.o.xt || []).length) xtChips(); }; });
    var prevSeg = window.sppSetSeg;
    if (typeof prevSeg === 'function') window.sppSetSeg = function () { var r = prevSeg.apply(this, arguments); try { xtLayout(); } catch (e) {} return r; };
    xtLayout();
    ['sppHead', 'sppSubl', 'sppBadge'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('input', function () { if ((S.o.xt || []).length) xtChips(); }); });
  })();
  function xtRender() {
    var box = $('sppXtList'); if (!box) return;
    var xt = S.o.xt || [], n = S.gal.length;
    if (xtActId !== 'main' && !xtFind(xtActId)) xtActId = 'main';
    box.innerHTML = '';
    var at = xtActId === 'main' ? -1 : xt.indexOf(xtFind(xtActId));
    if (at > -1) box.appendChild(xtCard(xt[at], at, n));
    var mt = $('sppMainText'); if (mt) mt.style.display = xtActId === 'main' ? '' : 'none';
    var mh = $('sppMainHint'); if (mh) mh.style.display = xt.length ? '' : 'none';
    var c = $('sppXtCount'); if (c) c.textContent = xt.length ? ' · ' + (xt.length + 1) : '';
    var nt = $('sppXtNote');
    if (nt) {
      if (S.o.fit === 'gallery') {
        nt.textContent = 'A text set to "With a photo" appears together with that photo. The loop is shared evenly between your photos.' +
          ((S.o.gal === 'collage' || S.o.gal === 'fastcuts') ? ' In this layout the photos are not shown one at a time, so use "Custom time" to place words exactly.' : '');
      } else nt.textContent = 'Tip: "Seconds per loop" (Motion) is the length of your video. Use "Split the video into" for steps or scenes, or give each text its own start and end.';
    }
    xtChips(); xtStart(); xtStay(); xtLayout(); paintRanges(); xtMarkThumbs();
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function stampMark(ctx, W, H) {
    var t = 'Made Using SARVARC Workspace', fs = Math.max(11, Math.round(Math.min(W, H) * 0.022)), m = Math.max(8, Math.round(Math.min(W, H) * 0.018));
    ctx.save(); ctx.font = '600 ' + fs + 'px ' + FONTS.clean; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    var tw = ctx.measureText(t).width, px = fs * 0.5, py = fs * 0.35;
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; rr(ctx, W - m - tw - px * 2, H - m - fs - py * 2, tw + px * 2, fs + py * 2, 6); ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.85)'; ctx.fillText(t, W - m - px, H - m - py); ctx.restore();
  }

  /* ───────────────────────── presets + multi-photo gallery ───────────────────────── */
  var GAL_MAX = 12;
  function hasArt() { return S.o.fit === 'gallery' ? S.gal.length > 0 : !!S.cut; }
  window.sppPickMany = function (files) {
    files = [].slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) { say('Please choose image files', 'error'); return; }
    var room = Math.max(0, GAL_MAX - S.gal.length);
    if (files.length > room) { say('Showcase holds up to ' + GAL_MAX + ' photos. Using the first ' + room + '.', 'info'); files = files.slice(0, room); }
    if (!files.length) return;
    var out = [], left = files.length;
    function done() {
      if (--left) return;
      out.forEach(function (c) { if (c) S.gal.push(c); });
      galThumbs();
      if (S.o.gal !== 'collage' && S.o.gal !== 'polaroid' && S.o.gal !== 'bento' && S.o.gal !== 'fastcuts') { var v = clamp(Math.round(S.gal.length * (S.o.gal === 'chilldrop' ? 7 : 2.5) * 2) / 2, 6, 30); window.sppSet('secs', v); if ($('sppSecs')) { $('sppSecs').value = v; paintRanges(); } }
    }
    files.forEach(function (f, i) {
      var r = new FileReader();
      r.onerror = function () { say(f.name + ' could not be read', 'error'); done(); };
      r.onload = function (e) {
        var im = new Image();
        im.onload = function () {
          try {
            var k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), c = mk(im.naturalWidth * k, im.naturalHeight * k), x = c.getContext('2d');
            x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height); out[i] = c;
          } catch (er) { say(f.name + ' is too large for this browser', 'error'); }
          done();
        };
        im.onerror = function () { say(f.name + ' could not be opened', 'error'); done(); };
        im.src = e.target.result;
      };
      r.readAsDataURL(f);
    });
    if (S.o.fit !== 'gallery') window.sppSetSeg('fit', 'gallery', $('sppFitSeg').querySelector('[data-v="gallery"]'));
  };
  window.sppGalClear = function () { S.gal = []; galThumbs(); };
  function galThumbs() {
    var box = $('sppGalThumbs'); if (!box) return; box.innerHTML = '';
    S.gal.forEach(function (c, i) {
      if (!c._th) {
        var t = mk(96, 96), x = t.getContext('2d'), k = Math.max(96 / c.width, 96 / c.height);
        x.drawImage(c, (96 - c.width * k) / 2, (96 - c.height * k) / 2, c.width * k, c.height * k); c._th = t.toDataURL('image/jpeg', 0.7);
      }
      var d = document.createElement('div'), im = new Image(); d.className = 'spp-th'; im.src = c._th; im.alt = ''; d.appendChild(im);
      [['x', '×', 'Remove', function () { S.gal.splice(i, 1); xtRemap(function (p) { return p === i ? null : (p > i ? p - 1 : p); }); }],
       ['l', '‹', 'Move earlier', function () { if (i > 0) { S.gal.splice(i - 1, 0, S.gal.splice(i, 1)[0]); xtRemap(function (p) { return p === i ? i - 1 : (p === i - 1 ? i : p); }); } }],
       ['r', '›', 'Move later', function () { if (i < S.gal.length - 1) { S.gal.splice(i + 1, 0, S.gal.splice(i, 1)[0]); xtRemap(function (p) { return p === i ? i + 1 : (p === i + 1 ? i : p); }); } }],
       ['t', 'T', 'Add a text to this photo', function () { xtForPhoto(i); }]].forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button'; b.className = a[0]; b.textContent = a[1]; b.title = a[2];
        b.onclick = function () { a[3](); galThumbs(); }; d.appendChild(b);
      });
      box.appendChild(d);
    });
    try { xtRender(); } catch (e) { console.error('Showcase texts panel failed', e); }
  }
  (function () {
    var d = $('sppGalDrop'); if (!d) return;
    ['dragenter', 'dragover'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove('over'); }); });
    d.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) window.sppPickMany(e.dataTransfer.files); });
  })();

  function galCover(ctx, c, x, y, w, h, z, px, py, rad) {
    var s = Math.max(w / c.width, h / c.height) * (z || 1), dw = c.width * s, dh = c.height * s;
    ctx.save(); if (rad) rr(ctx, x, y, w, h, rad); else { ctx.beginPath(); ctx.rect(x, y, w, h); }
    ctx.clip(); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mipFor(c, Math.max(dw, dh)), x + (w - dw) / 2 + (px || 0) * (dw - w) / 2, y + (h - dh) / 2 + (py || 0) * (dh - h) / 2, dw, dh);
    ctx.restore();
  }
  function galShadow(ctx, x, y, w, h, rad, blur) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = blur; ctx.shadowOffsetY = blur * 0.35; ctx.fillStyle = '#000'; rr(ctx, x, y, w, h, rad); ctx.fill(); ctx.restore();
  }
  function galBg(ctx, W, H) {
    var o = S.o, g = ctx.createLinearGradient(0, 0, W * 0.25, H);
    g.addColorStop(0, o.fillA); g.addColorStop(1, o.fillGrad ? o.fillB : o.fillA); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // Area left for photos once the words have their space
  function galRect(W, H) {
    var o = xtLead(S.o), L = layout(W, H), m = Math.min(W, H) * 0.06, R = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    if (!L.hasText) return R;
    if (L.pos === 'left' || L.pos === 'right') { R.w -= W * 0.42; if (L.pos === 'left') R.x += W * 0.42; return R; }
    var u = Math.min(W, H) * 0.1 * o.txtSize / 100, cpl = 0.86 * W / (0.56 * u), hl = o.head ? Math.min(2, Math.ceil(o.head.length / cpl)) : 0, rp = u * (0.75 + (o.badge ? 0.75 : 0) + hl * 1.1 + (o.sub ? 0.75 : 0));
    rp = Math.min(rp, H * 0.42); R.h -= rp; if (L.pos === 'top') R.y += rp;
    return R;
  }
  function galDraw(ctx, W, H, tn, ent) {
    var n = S.gal.length, m = S.o.gal;
    if (m === 'slideshow') { galSlide(ctx, 0, 0, W, H, tn, n, 0); return; }
    if (m === 'cuts') { galCuts(ctx, W, H, tn, n); return; }
    if (m === 'panels') { galPanels(ctx, W, H, tn, n); return; }
    if (m === 'focus') { galFocus(ctx, W, H, tn, n); return; }
    if (m === 'brand') { galBrand(ctx, W, H, tn, n); return; }
    if (m === 'aura') { galAura(ctx, W, H, tn, n, galRect(W, H)); return; }
    if (m === 'fastcuts') { galFast(ctx, W, H, tn, n); return; }
    if (m === 'chilldrop') { try { galChill(ctx, W, H, tn, n); } catch (e) { console.error('Chill Drop (multi-photo) failed', e); ctx.clearRect(0, 0, W, H); galSlide(ctx, 0, 0, W, H, tn, n, 0); } return; }
    galBg(ctx, W, H);
    var R = galRect(W, H);
    if (m === 'collage') galCollage(ctx, R, tn, n, ent);
    else if (m === 'spotlight') galSpot(ctx, R, tn, n);
    else if (m === 'polaroid') galPolaroid(ctx, R, tn, n);
    else if (m === 'bento') galBento(ctx, R, tn, n, ent);
    else if (m === 'film') galFilm(ctx, R, tn, n);
    else galFlow(ctx, R, tn, n);
  }
  // One photo at a time: slow push, then a soft fade into the next. Loops cleanly.
  function galSlide(ctx, x, y, w, h, tn, n, rad) {
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), X = 0.22;
    function one(idx, ff, a) { ctx.globalAlpha = a; galCover(ctx, S.gal[idx], x, y, w, h, 1 + 0.09 * ff, (idx % 2 ? 1 : -1) * (ff - 0.5) * 0.8, 0, rad); }
    one(i, f, 1);
    if (n > 1 && f > 1 - X) one((i + 1) % n, 0, ease((f - (1 - X)) / X));
    ctx.globalAlpha = 1;
  }
  function galCollage(ctx, R, tn, n, ent) {
    var TAU = Math.PI * 2, g = Math.min(R.w, R.h) * 0.025, cols = clamp(Math.ceil(Math.sqrt(n * R.w / R.h)), 1, n), rows = Math.ceil(n / cols);
    var tw = (R.w - g * (cols - 1)) / cols, th = (R.h - g * (rows - 1)) / rows, rad = Math.min(tw, th) * 0.07;
    for (var i = 0; i < n; i++) {
      var r = Math.floor(i / cols), c = i % cols, cnt = r === rows - 1 ? n - cols * (rows - 1) : cols;
      var x0 = R.x + (cols - cnt) * (tw + g) / 2 + c * (tw + g), y0 = R.y + r * (th + g), pe = ease((ent - i * 0.12) / 0.6);
      if (pe <= 0) continue;
      ctx.save(); ctx.globalAlpha = pe; ctx.translate(x0 + tw / 2, y0 + th / 2 + (1 - pe) * th * 0.12); ctx.scale(0.9 + 0.1 * pe, 0.9 + 0.1 * pe);
      galShadow(ctx, -tw / 2, -th / 2, tw, th, rad, g * 2);
      galCover(ctx, S.gal[i], -tw / 2, -th / 2, tw, th, 1.12, Math.sin(TAU * (tn + i / n)), Math.cos(TAU * (tn + i / n)) * 0.6, rad);
      ctx.restore();
    }
  }
  function galSpot(ctx, R, tn, n) {
    var g = Math.min(R.w, R.h) * 0.03, hh = n > 1 ? R.h * 0.76 : R.h, th = R.h - hh - g, rad = Math.min(R.w, hh) * 0.035;
    galShadow(ctx, R.x, R.y, R.w, hh, rad, g * 2.5); galSlide(ctx, R.x, R.y, R.w, hh, tn, n, rad);
    if (n < 2) return;
    var tw = Math.min((R.w - g * (n - 1)) / n, th * 1.5), x0 = R.x + (R.w - (n * tw + (n - 1) * g)) / 2, act = Math.floor(tn * n) % n, ty = R.y + hh + g, tr = rad * 0.6;
    for (var i = 0; i < n; i++) {
      var tx = x0 + i * (tw + g); ctx.globalAlpha = i === act ? 1 : 0.5; galCover(ctx, S.gal[i], tx, ty, tw, th, 1, 0, 0, tr);
      if (i === act) { ctx.globalAlpha = 1; ctx.strokeStyle = S.o.accent; ctx.lineWidth = Math.max(2, g * 0.35); rr(ctx, tx, ty, tw, th, tr); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  // Photos glide past a centre stage: each one rests, then the row slides on.
  function galFlow(ctx, R, tn, n) {
    var fr = tn * n, k0 = Math.floor(fr), f = fr - k0, p = k0 + ease((f - 0.35) / 0.65), items = [];
    var ch = R.h * 0.94, cw = Math.min(ch * 0.78, R.w * 0.46), cx0 = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (var k = 0; k < n; k++) { var d = (((k - p) % n) + n) % n; if (d > n / 2) d -= n; items.push({ k: k, d: d }); }
    items.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    items.forEach(function (it) {
      var ad = Math.abs(it.d); if (ad >= 2.6) return;
      var s = 1 - Math.min(ad, 2) * 0.17, w = cw * s * (1 - Math.min(ad, 1) * 0.1), h = ch * s, sg = it.d < 0 ? -1 : 1;
      var x = cx0 + sg * (Math.min(ad, 1) * cw * 0.72 + Math.max(0, Math.min(ad, 2) - 1) * cw * 0.34);
      ctx.save(); ctx.globalAlpha = clamp((2.6 - ad) / 1.6, 0, 1) * (1 - Math.min(ad, 1) * 0.25);
      var rad = w * 0.05; galShadow(ctx, x - w / 2, cy - h / 2, w, h, rad, cw * 0.06);
      galCover(ctx, S.gal[it.k], x - w / 2, cy - h / 2, w, h, 1, 0, 0, rad); ctx.restore();
    });
  }

  /* ───────────────────────── premium multi-photo layouts ───────────────────────── */
  var GALFULL = { slideshow: 1, cuts: 1, panels: 1, focus: 1, brand: 1, aura: 1, fastcuts: 1, chilldrop: 1 };               // layouts that fill the whole frame (no backdrop)
  var CUT_FX = ['flip', 'warp', 'pixel', 'ripple', 'glitch', 'waterfall', 'assemble', 'shutter', 'iris'];
  // The photo scaled to cover a W x H frame, cached so the cinematic layouts stay smooth
  function galCv(c, W, H) {
    var k = W + 'x' + H, h = c._cv || (c._cv = {});
    if (h[k]) return h[k];
    var ks = Object.keys(h); if (ks.length >= 2) delete h[ks[0]];
    var cv = mk(W, H), x = cv.getContext('2d'), s = Math.max(W / c.width, H / c.height), dw = c.width * s, dh = c.height * s;
    x.imageSmoothingQuality = 'high'; x.drawImage(mipFor(c, Math.max(dw, dh)), (W - dw) / 2, (H - dh) / 2, dw, dh);
    return (h[k] = cv);
  }
  // DIRECTOR'S CUT: every photo cuts in over the last one with a different cinematic effect, then pushes in slowly
  function galCuts(ctx, W, H, tn, n) {
    if (n < 2) { galSlide(ctx, 0, 0, W, H, tn, n, 0); return; }
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), prev = (i + n - 1) % n, ent = clamp(f / 0.55, 0, 1);
    var z = 1 + 0.08 * f, w = W * z, h = H * z, X = (W - w) / 2, Y = (H - h) / 2, cv = galCv(S.gal[i], W, H), fx = CUT_FX[i % CUT_FX.length], dir = i % 2 ? -1 : 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (ent >= 1) { ctx.drawImage(cv, X, Y, w, h); return; }
    ctx.drawImage(galCv(S.gal[prev], W, H), -W * 0.04, -H * 0.04, W * 1.08, H * 1.08);
    if (FX[fx]) { fxDraw(ctx, cv, W, H, X, Y, w, h, fx, fx === 'glitch' ? ent * 0.3 : ent * 0.5, W, H, dir, null); if (fx === 'warp') streaks(ctx, W / 2, H / 2, W, H, ent); }
    else if (fx === 'assemble') pieces(ctx, cv, W, H, X, Y, w, h, ent, 'tiles', W, H, dir);
    else if (fx === 'shutter') pieces(ctx, cv, W, H, X, Y, w, h, ent, 'blinds', W, H, dir);
    else { ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(0.1, Math.hypot(W, H) / 2 * eo(ent)), 0, 6.2832); ctx.clip(); ctx.drawImage(cv, X, Y, w, h); ctx.restore(); }
  }
  // PANEL WIPE: the photo is cut into vertical panels that slide up and down in turn, handing over to the next photo
  function galPanels(ctx, W, H, tn, n) {
    if (n < 2) { galSlide(ctx, 0, 0, W, H, tn, n, 0); return; }
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), nx = (i + 1) % n, NP = W > H * 1.05 ? 7 : 5, t = clamp((f - 0.7) / 0.3, 0, 1);
    var pw = W / NP, a = galCv(S.gal[i], W, H), b = galCv(S.gal[nx], W, H), za = 1 + 0.07 * f, j, q, sg;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (j = 0; j < NP; j++) {
      q = ease(clamp(t * 1.7 - j / (NP - 1) * 0.7, 0, 1)); sg = j % 2 ? -1 : 1;
      ctx.save(); ctx.beginPath(); ctx.rect(j * pw, 0, pw + 0.6, H); ctx.clip();
      if (q < 1) ctx.drawImage(a, (W - W * za) / 2, (H - H * za) / 2 + sg * q * H, W * za, H * za);
      if (q > 0) ctx.drawImage(b, 0, -sg * (1 - q) * H, W, H);
      if (q > 0 && q < 1) { ctx.fillStyle = 'rgba(0,0,0,' + (0.4 * Math.sin(Math.PI * q)) + ')'; ctx.fillRect(j * pw, 0, pw, H); }
      ctx.restore();
    }
  }
  // POLAROID TOSS: instant photos are thrown onto the table, each landing with a bounce, then everything is swept away
  function galPolaroid(ctx, R, tn, n) {
    var base = Math.min(R.w, R.h), pw = base * (n <= 2 ? 0.6 : n <= 4 ? 0.52 : n <= 8 ? 0.44 : 0.38), ph = pw * 1.2, cx = R.x + R.w / 2, cy = R.y + R.h / 2, sr = Math.min(R.w * 0.3, base * 0.34), i;
    if (ph > R.h * 0.92) { ph = R.h * 0.92; pw = ph / 1.2; }
    for (i = 0; i < n; i++) {
      var q = clamp((tn - (0.04 + (i / n) * 0.62)) / 0.13, 0, 1); if (q <= 0) continue;
      var e = ease(clamp((tn - 0.9) / 0.1 * 1.5 - (i / n) * 0.5, 0, 1)); if (e >= 1) continue;
      var ang = i * 2.39996, rad = n > 1 ? Math.sqrt((i + 0.5) / n) * sr : 0;
      var tx = cx + Math.cos(ang) * rad * (R.w >= R.h ? 1.25 : 0.9), ty = cy + Math.sin(ang) * rad * 0.75, rot = (rnd(i, 3) - 0.5) * 0.3;
      var sx = tx + (rnd(i, 5) - 0.5) * R.w * 0.8, sy = R.y - ph * 0.9, xq = eo(q), yq = eb(q), air = 1 - xq;
      var x = sx + (tx - sx) * xq + e * (rnd(i, 8) - 0.5) * R.w * 0.4, y = sy + (ty - sy) * yq + e * (R.h + ph);
      var mg = pw * 0.055, g;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot + (rnd(i, 6) - 0.5) * 1.4 * air + e * (rnd(i, 9) - 0.5) * 0.8); ctx.scale(1 + 0.3 * air, 1 + 0.3 * air);
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = pw * (0.05 + 0.1 * air); ctx.shadowOffsetY = pw * (0.02 + 0.05 * air);
      ctx.fillStyle = '#f6f3ec'; rr(ctx, -pw / 2, -ph / 2, pw, ph, pw * 0.02); ctx.fill();
      ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      galCover(ctx, S.gal[i], -pw / 2 + mg, -ph / 2 + mg, pw - 2 * mg, ph - mg - pw * 0.2, 1.05, 0, 0, 0);
      g = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2); g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; rr(ctx, -pw / 2, -ph / 2, pw, ph, pw * 0.02); ctx.fill();
      ctx.restore();
    }
  }
  // BENTO: a modern asymmetric grid. The first photo gets the big tile, and each photo takes its turn in focus.
  function bentoRects(R, n) {
    var rs = [{ x: R.x, y: R.y, w: R.w, h: R.h }], bi, k, r, ratio, w1, h1;
    while (rs.length < n) {
      bi = 0; for (k = 1; k < rs.length; k++) if (rs[k].w * rs[k].h > rs[bi].w * rs[bi].h) bi = k;
      r = rs[bi]; ratio = rs.length === 1 ? 0.6 : 0.5 + (rnd(rs.length, 7) - 0.5) * 0.22;
      if (r.w >= r.h) { w1 = r.w * ratio; rs.splice(bi, 1, { x: r.x, y: r.y, w: w1, h: r.h }, { x: r.x + w1, y: r.y, w: r.w - w1, h: r.h }); }
      else { h1 = r.h * ratio; rs.splice(bi, 1, { x: r.x, y: r.y, w: r.w, h: h1 }, { x: r.x, y: r.y + h1, w: r.w, h: r.h - h1 }); }
    }
    rs.sort(function (a, b) { return (b.w * b.h - a.w * a.h) || (a.y - b.y) || (a.x - b.x); });
    return rs;
  }
  function galBento(ctx, R, tn, n, ent) {
    var TAU = 6.2832, g = Math.min(R.w, R.h) * 0.022, rs = bentoRects(R, n), pos = tn * n, act = [], order = [], i, d;
    for (i = 0; i < n; i++) { d = Math.abs(pos - i); d = Math.min(d, n - d); act[i] = ease(1 - d / 0.85); order.push(i); }
    order.sort(function (a, b) { return act[a] - act[b]; });
    order.forEach(function (i) {
      var r = rs[i], pe = ease((ent - i * 0.1) / 0.55); if (pe <= 0) return;
      var w = r.w - g, h = r.h - g, rad = Math.min(w, h) * 0.06, k = (1 + 0.045 * act[i]) * (0.92 + 0.08 * pe);
      ctx.save(); ctx.globalAlpha = pe; ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + (1 - pe) * h * 0.15); ctx.scale(k, k);
      galShadow(ctx, -w / 2, -h / 2, w, h, rad, g * (2 + 3 * act[i]));
      galCover(ctx, S.gal[i], -w / 2, -h / 2, w, h, 1.12, Math.sin(TAU * (tn + i / n)), Math.cos(TAU * (tn + i / n)) * 0.6, rad);
      ctx.globalAlpha = pe * 0.32 * (1 - act[i]); ctx.fillStyle = '#000'; rr(ctx, -w / 2, -h / 2, w, h, rad); ctx.fill();
      ctx.restore();
    });
  }
  // FILM ROLL: photos roll past on a tilted film strip with sprocket holes; the frame in the gate is lit, the rest are dimmed
  function galFilm(ctx, R, tn, n) {
    var cvW = ctx.canvas.width, fr = tn * n, k0 = Math.floor(fr), f = fr - k0, p = k0 + ease((f - 0.3) / 0.7);
    var fh = Math.min(R.h * 0.64, R.w * 0.65), fw = fh * 0.8, pitch = fw * 1.14, sh = fh * 1.34, hole = sh * 0.045, band = (sh - fh) / 4, sp = pitch / 4, off = -((p * pitch) % sp), h, m, x, idx, focus, sg;
    ctx.save(); ctx.translate(R.x + R.w / 2, R.y + R.h / 2); ctx.rotate(R.w >= R.h ? -0.06 : -0.09);
    sg = ctx.createLinearGradient(0, -sh / 2, 0, sh / 2); sg.addColorStop(0, '#17171b'); sg.addColorStop(0.5, '#0b0b0d'); sg.addColorStop(1, '#17171b');
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = sh * 0.12; ctx.shadowOffsetY = sh * 0.05; ctx.fillStyle = sg; ctx.fillRect(-cvW, -sh / 2, cvW * 2, sh); ctx.restore();
    ctx.fillStyle = 'rgba(236,233,226,0.9)';
    for (h = -Math.ceil(cvW / sp); h <= Math.ceil(cvW / sp); h++) {
      x = h * sp + off; rr(ctx, x - hole * 0.6, -sh / 2 + band - hole / 2, hole * 1.2, hole, hole * 0.25); ctx.fill(); rr(ctx, x - hole * 0.6, sh / 2 - band - hole / 2, hole * 1.2, hole, hole * 0.25); ctx.fill();
    }
    for (m = Math.floor(p) - 4; m <= Math.floor(p) + 4; m++) {
      x = (m - p) * pitch; idx = ((m % n) + n) % n; focus = ease(1 - Math.abs(m - p));
      ctx.save(); ctx.translate(x, 0); ctx.scale(1 + 0.06 * focus, 1 + 0.06 * focus);
      galCover(ctx, S.gal[idx], -fw / 2, -fh / 2, fw, fh, 1.04, 0, 0, fw * 0.02);
      ctx.globalAlpha = 0.5 * (1 - focus); ctx.fillStyle = '#000'; rr(ctx, -fw / 2, -fh / 2, fw, fh, fw * 0.02); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }


  /* ───────────────────────── build 282: SMART multi-photo layouts (zero manual work) ─────────────────────────
     Smart focus  - finds the subject of every photo and pushes the camera into IT (no manual crop), fills odd-shaped photos with a soft self-blur (no black bars), locks on with a brand-colour reticle.
     Brand sweep  - your brand/accent colour wipes between photos, unifies every photo with a subtle brand grade, and shows chapter ticks + counter (feels like a finished product reel).
     Aura         - the backdrop is generated from the photos' own colours and melts from one photo to the next. No backdrop picking.
     Smart order  - one click re-orders photos so colours and brightness flow naturally. */
  function galInfo(c) {
    if (c._in) return c._in;
    var s = 32, t = mk(s, s), x = t.getContext('2d'), d, L = [], i, j, k, R = 0, G = 0, B = 0, n = s * s, vr = 0, vg = 0, vb = 0, vw = 0;
    x.drawImage(c, 0, 0, s, s); d = x.getImageData(0, 0, s, s).data;
    for (i = 0; i < n; i++) { R += d[i * 4]; G += d[i * 4 + 1]; B += d[i * 4 + 2]; L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; }
    R /= n; G /= n; B /= n;
    var sx = 0, sy = 0, sw = 0;
    for (j = 1; j < s - 1; j++) for (i = 1; i < s - 1; i++) {
      k = j * s + i;
      var gx = L[k + 1] - L[k - 1], gy = L[k + s] - L[k - s], e = Math.sqrt(gx * gx + gy * gy);
      var cd = (Math.abs(d[k * 4] - R) + Math.abs(d[k * 4 + 1] - G) + Math.abs(d[k * 4 + 2] - B)) / 765;
      var cb = 1 - Math.min(1, Math.hypot(i / s - 0.5, j / s - 0.5) * 1.6), w = (e * 2 + cd) * (0.3 + cb); w *= w;
      sx += w * i; sy += w * j; sw += w;
      var mx = Math.max(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]), mn = Math.min(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]), sat = (mx - mn) + 6;
      vr += d[k * 4] * sat; vg += d[k * 4 + 1] * sat; vb += d[k * 4 + 2] * sat; vw += sat;
    }
    return (c._in = { fx: sw ? clamp(sx / sw / s, 0.18, 0.82) : 0.5, fy: sw ? clamp(sy / sw / s, 0.18, 0.82) : 0.5, avg: [R, G, B], vivid: [vr / vw, vg / vw, vb / vw], lum: (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255 });
  }
  function galMix(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; }
  function galRgb(c, m, a) { return 'rgba(' + Math.round(c[0] * m) + ',' + Math.round(c[1] * m) + ',' + Math.round(c[2] * m) + ',' + (a == null ? 1 : a) + ')'; }
  // Soft self-fill: a tiny copy stretched up is a cheap, smooth blur
  function galBlurBg(c, W, H) {
    var key = W + 'b' + H, h = c._bl2 || (c._bl2 = {}); if (h[key]) return h[key];
    var t = mk(32, Math.max(2, Math.round(32 * H / W))), x = t.getContext('2d'), s = Math.max(t.width / c.width, t.height / c.height);
    x.drawImage(c, (t.width - c.width * s) / 2, (t.height - c.height * s) / 2, c.width * s, c.height * s);
    var cv = mk(W, H), y = cv.getContext('2d'); y.imageSmoothingQuality = 'high'; y.drawImage(t, 0, 0, W, H);
    y.fillStyle = 'rgba(0,0,0,0.3)'; y.fillRect(0, 0, W, H);
    var ks = Object.keys(h); if (ks.length >= 2) delete h[ks[0]];
    return (h[key] = cv);
  }
  // Effect colour for lines, flashes and ticks. Default is white (neutral). 'auto' takes the photo's own strongest colour, 'brand' uses the accent colour, 'off' removes the lines.
  function galFx(idx) {
    var m = S.o.fxCol || 'white', n = S.gal.length; if (m === 'off') return null;
    if (m === 'brand') return S.o.accent;
    if (m === 'auto' && n) {
      var v = galInfo(S.gal[((idx % n) + n) % n]).vivid, mx = Math.max(v[0], v[1], v[2]) || 1, k = Math.min(1.7, 235 / mx);
      return 'rgb(' + Math.min(255, Math.round(v[0] * k)) + ',' + Math.min(255, Math.round(v[1] * k)) + ',' + Math.min(255, Math.round(v[2] * k)) + ')';
    }
    return '#ffffff';
  }
  // Crop that never cuts the subject: zoom is held back so the area around the subject always stays inside the frame
  function galSafeCrop(c, W, H, z) {
    var inf = galInfo(c), s0 = Math.max(W / c.width, H / c.height), bx = 0.3 * c.width, by = 0.3 * c.height, maxS = Math.min(W / (2 * bx), H / (2 * by)), s = s0 * z, dw, dh;
    if (s > maxS) s = Math.max(s0, maxS);
    dw = c.width * s; dh = c.height * s;
    return { dw: dw, dh: dh, ox: clamp(W / 2 - inf.fx * dw, W - dw, 0), oy: clamp(H / 2 - inf.fy * dh, H - dh, 0) };
  }
  function galMism(c, W, H) { return Math.abs(Math.log((c.width / c.height) / (W / H))) > 0.42; }
  // One photo, framed automatically. Odd-shaped photos are shown whole on a soft self-blur (never cropped). Returns where the subject is on screen.
  function galShot(ctx, c, W, H, ff) {
    var inf = galInfo(c), e = ease(ff), s, dw, dh, ox, oy, cr;
    if (galMism(c, W, H)) {
      ctx.drawImage(galBlurBg(c, W, H), 0, 0);
      s = Math.min(W / c.width, H / c.height) * 0.88 * (1 + 0.07 * e); dw = c.width * s; dh = c.height * s; ox = (W - dw) / 2; oy = (H - dh) / 2;
      galShadow(ctx, ox, oy, dw, dh, Math.min(dw, dh) * 0.025, Math.min(W, H) * 0.06);
      ctx.save(); rr(ctx, ox, oy, dw, dh, Math.min(dw, dh) * 0.025); ctx.clip(); ctx.drawImage(mipFor(c, Math.max(dw, dh)), ox, oy, dw, dh); ctx.restore();
      return { x: ox + inf.fx * dw, y: oy + inf.fy * dh };
    }
    cr = galSafeCrop(c, W, H, 1 + 0.12 * e);
    ctx.drawImage(mipFor(c, Math.max(cr.dw, cr.dh)), cr.ox, cr.oy, cr.dw, cr.dh);
    return { x: cr.ox + inf.fx * cr.dw, y: cr.oy + inf.fy * cr.dh };
  }
  function galReticle(ctx, p, W, H, f, col) {
    if (!col) return;
    var a = clamp(f / 0.1, 0, 1) * (1 - clamp((f - 0.5) / 0.25, 0, 1)); if (a <= 0) return;
    var u = Math.min(W, H), q = eo(clamp(f / 0.32, 0, 1)), r = u * 0.085 * (2 - q), l = r * 0.42, sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = Math.max(2, u * 0.005); ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = u * 0.01;
    sg.forEach(function (v) { ctx.beginPath(); ctx.moveTo(p.x + v[0] * r, p.y + v[1] * r - v[1] * l); ctx.lineTo(p.x + v[0] * r, p.y + v[1] * r); ctx.lineTo(p.x + v[0] * r - v[0] * l, p.y + v[1] * r); ctx.stroke(); });
    ctx.beginPath(); ctx.arc(p.x, p.y, u * 0.006 * q, 0, 6.2832); ctx.fill(); ctx.restore();
  }
  function galFocus(ctx, W, H, tn, n) {
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), X = 0.2, p;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    p = galShot(ctx, S.gal[i], W, H, f);
    if (n > 1 && f > 1 - X) { ctx.globalAlpha = ease((f - (1 - X)) / X); galShot(ctx, S.gal[(i + 1) % n], W, H, 0); ctx.globalAlpha = 1; }
    else galReticle(ctx, p, W, H, f, galFx(i));
  }
  // BRAND SWEEP: a wipe between photos with chapter ticks and a counter. Colour follows the Effect colour setting.
  function galBrand(ctx, W, H, tn, n) {
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), nx = (i + 1) % n, o = S.o, u = Math.min(W, H), t = n > 1 ? ease(clamp((f - 0.76) / 0.24, 0, 1)) : 0, sk = H * 0.3, bw = W * 0.07, ex, k, colA = galFx(i), colB = galFx(nx);
    function grade(col) { if (!col || o.fxCol === 'white') return; ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    galShot(ctx, S.gal[i], W, H, f); grade(colA);
    if (t > 0) {
      ex = t * (W + sk + bw);
      ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, 0); ctx.lineTo(ex - sk, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip();
      galShot(ctx, S.gal[nx], W, H, 0); grade(colB); ctx.restore();
      if (colB) {
        ctx.save(); ctx.fillStyle = colB; ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex + bw, 0); ctx.lineTo(ex + bw - sk, H); ctx.lineTo(ex - sk, H); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(ex + bw, 0); ctx.lineTo(ex + bw * 1.25, 0); ctx.lineTo(ex + bw * 1.25 - sk, H); ctx.lineTo(ex + bw - sk, H); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    var cur = t > 0.5 ? nx : i, cc = t > 0.5 ? colB : colA; if (!cc) return;
    var bot = layout(W, H).pos === 'top', m = u * 0.045, th = Math.max(3, u * 0.007), gp = u * 0.012, y = bot ? H - m - th : m, tw = (W - 2 * m - gp * (n - 1)) / n;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = u * 0.01;
    for (k = 0; k < n; k++) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; rr(ctx, m + k * (tw + gp), y, tw, th, th / 2); ctx.fill();
      var fill = k < cur ? 1 : (k === cur ? (t > 0.5 ? t - 0.5 : f * 0.9 + 0.1) : 0); if (k === cur && t > 0.5) fill = 0.1;
      if (fill > 0) { ctx.globalAlpha = 1; ctx.fillStyle = cc; rr(ctx, m + k * (tw + gp), y, tw * clamp(fill, 0, 1), th, th / 2); ctx.fill(); }
    }
    var fs = Math.round(u * 0.026); ctx.globalAlpha = 0.95; ctx.fillStyle = '#fff'; ctx.font = '700 ' + fs + 'px ' + FONTS.clean; ctx.textAlign = 'left'; ctx.textBaseline = bot ? 'bottom' : 'top';
    ctx.fillText((cur + 1 < 10 ? '0' : '') + (cur + 1) + ' / ' + (n < 10 ? '0' : '') + n, m, bot ? y - th : y + th * 2.2);
    ctx.restore();
  }
  // AURA
  function galAura(ctx, W, H, tn, n, R) {
    var seg = tn * n, i = Math.floor(seg) % n, f = seg - Math.floor(seg), nx = (i + 1) % n, t = n > 1 ? ease(clamp((f - 0.75) / 0.25, 0, 1)) : 0, TAU = 6.2832;
    var A = galInfo(S.gal[i]), B = galInfo(S.gal[nx]), vv = galMix(A.vivid, B.vivid, t), av = galMix(A.avg, B.avg, t), g, u = Math.min(W, H);
    g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, galRgb(vv, 0.5)); g.addColorStop(1, galRgb(av, 0.16)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    [[0.25, 0.25, 0.75, vv, 0.55, 0], [0.8, 0.85, 0.6, galMix(vv, av, 0.5), 0.4, 2]].forEach(function (b) {
      var bx = W * (b[0] + 0.07 * Math.sin(TAU * tn * 2 + b[5])), by = H * (b[1] + 0.07 * Math.cos(TAU * tn * 2 + b[5])), r = Math.max(W, H) * b[2], rg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      rg.addColorStop(0, galRgb(b[3], 1, b[4])); rg.addColorStop(1, galRgb(b[3], 1, 0)); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    });
    function card(idx, slide, a) {
      var c = S.gal[idx], inf = galInfo(c), s = Math.min(R.w * 0.94 / c.width, R.h * 0.94 / c.height), w = c.width * s, h = c.height * s, bob = Math.sin(TAU * (tn * 2 + idx / n)) * u * 0.008;
      var x = R.x + R.w / 2 + slide * R.w * 0.55, y = R.y + R.h / 2 + bob, rad = Math.min(w, h) * 0.05, k = 1 + 0.03 * (f - 0.5);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(k, k);
      ctx.shadowColor = galRgb(inf.vivid, 1, 0.6); ctx.shadowBlur = u * 0.14; ctx.shadowOffsetY = u * 0.03; ctx.fillStyle = '#000'; rr(ctx, -w / 2, -h / 2, w, h, rad); ctx.fill();
      ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, rad); ctx.clip(); ctx.drawImage(mipFor(c, Math.max(w, h)), -w / 2, -h / 2, w, h);
      var sh = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); sh.addColorStop(0, 'rgba(255,255,255,0.16)'); sh.addColorStop(0.4, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, u * 0.002); rr(ctx, -w / 2, -h / 2, w, h, rad); ctx.stroke(); ctx.restore();
    }
    card(i, -t, 1 - t);
    if (t > 0) card(nx, 1 - t, t);
  }
  // SMART ORDER: keep the first photo, then always go to the most similar colour/brightness next
  window.sppGalSmartOrder = function () {
    var n = S.gal.length; if (n < 3) { say('Add at least 3 photos to re-order', 'info'); return []; }
    var before = S.gal.slice(), left = S.gal.slice(1), out = [S.gal[0]], cur = galInfo(S.gal[0]);
    function dist(a, b) { return Math.hypot(a.avg[0] - b.avg[0], a.avg[1] - b.avg[1], a.avg[2] - b.avg[2]) + Math.abs(a.lum - b.lum) * 120; }
    while (left.length) {
      var bi = 0, bd = 1e9; left.forEach(function (c, k) { var d = dist(cur, galInfo(c)); if (d < bd) { bd = d; bi = k; } });
      cur = galInfo(left[bi]); out.push(left.splice(bi, 1)[0]);
    }
    S.gal = out; xtRemap(function (p) { var k = out.indexOf(before[p]); return k < 0 ? p : k; }); galThumbs(); say('Photos re-ordered so colours flow smoothly', 'success'); return out.length;
  };


  /* ───────────────────────── build 284: FAST CUTS (ad pace) ─────────────────────────
     Quick-fire editing for ads and reels. The pace comes from the style, not from the photo count: with few photos the same
     photo returns from a new camera distance. Zoom is held back so the subject is never cut, and photos whose shape does
     not match the frame are shown whole on a soft blur instead of being cropped. Lines and flashes are white unless you pick another Effect colour. */
  var FAST_STYLES = { hype: 0.5, accel: 0.6, flash: 0.5, whip: 0.6, beat: 0.45, crash: 0.6, slam: 0.55, glitch: 0.5, pop: 0.7, zthru: 0.6, spin: 0.55 };
  var FAST_NOTES = {
    hype: 'Hard cuts every half second. Each shot punches in with a tiny camera shake and a white flash.',
    accel: 'Starts slow and keeps getting faster, then lands on a long hero shot with a lock-on and a tension bar.',
    flash: 'Strobe look: a flash on every cut with a double pulse and shake. Loud and attention-grabbing.',
    whip: 'Fast whip pans. Each photo slides away with motion smear while the next one whips in.',
    beat: 'Cuts on a long-short-short music rhythm. Long beats slam a frame around the picture.',
    crash: 'Crash zoom: each shot snaps in fast toward the subject, lands with a hit, and every other shot pulls back instead.',
    slam: 'Slam stack: photos slam down onto a pile, one on top of the other, each landing with a thud.',
    glitch: 'Digital glitch: the picture tears into shifting bands on every cut, then snaps clean.',
    pop: 'Pop grid: four photos pop into a grid one after another, then it hard-cuts to the hero shot.',
    zthru: 'Zoom-through: each shot punches into the lens and dissolves while the next one settles in from behind. A smooth, expensive-looking cut.',
    spin: 'Spin cut: the frame rotates and scales out with motion ghosts while the next shot spins in. Dynamic without strobing.'
  };
  var FAST_FLASHY = { hype: 1, flash: 1, beat: 1, glitch: 1 };   // styles with rapid flashes or tears: they carry a visible notice
  var FAST_VAR = [1, 1.15, 1.3, 1.08];
  var fastPlans = {}, fastTmpC = null;
  function galFastPlan(n, secs, st) {
    var per = FAST_STYLES[st], T = clamp(Math.round(secs / per), Math.max(4, Math.min(n, 48)), 48), key = n + '|' + T + '|' + st;
    if (fastPlans[key]) return fastPlans[key];
    var w = [], sum = 0, i, a = 0, plan = [], BEAT = [2, 1, 1, 2, 1, 1, 1, 1];
    for (i = 0; i < T; i++) {
      w[i] = st === 'accel' ? (i === T - 1 ? 2.8 : 1.7 - 1.25 * (i / Math.max(1, T - 2))) : (st === 'beat' ? BEAT[i % 8] : 1);
      sum += w[i];
    }
    for (i = 0; i < T; i++) { plan.push({ k: i % n, v: Math.floor(i / n) % 4, a: a, d: w[i] / sum, long: st === 'beat' && w[i] === 2 }); a += w[i] / sum; }
    var ks = Object.keys(fastPlans); if (ks.length > 12) delete fastPlans[ks[0]];
    return (fastPlans[key] = plan);
  }
  // One picture at camera distance z. Safe: the subject area stays in frame; odd shapes stay whole on a soft blur.
  function galFastPic(ctx, W, H, c, z, dx, dy) {
    var inf = galInfo(c), s, dw, dh, ox, oy, cr, lv;
    dx = dx || 0; dy = dy || 0;
    if (galMism(c, W, H)) {
      lv = clamp((z - 1) / 0.5, 0, 1); s = Math.min(W / c.width, H / c.height) * (0.82 + 0.14 * lv); dw = c.width * s; dh = c.height * s; ox = (W - dw) / 2 + dx; oy = (H - dh) / 2 + dy;
      ctx.drawImage(galBlurBg(c, W, H), 0, 0, W, H);
      galShadow(ctx, ox, oy, dw, dh, Math.min(dw, dh) * 0.025, Math.min(W, H) * 0.06);
      ctx.save(); rr(ctx, ox, oy, dw, dh, Math.min(dw, dh) * 0.025); ctx.clip(); ctx.drawImage(mipFor(c, Math.max(dw, dh)), ox, oy, dw, dh); ctx.restore();
      return { x: ox + inf.fx * dw, y: oy + inf.fy * dh };
    }
    cr = galSafeCrop(c, W, H, z * 1.03);
    ox = clamp(cr.ox + dx, W - cr.dw, 0); oy = clamp(cr.oy + dy, H - cr.dh, 0);
    ctx.drawImage(mipFor(c, Math.max(cr.dw, cr.dh)), ox, oy, cr.dw, cr.dh);
    return { x: ox + inf.fx * cr.dw, y: oy + inf.fy * cr.dh };
  }
  function galFastDraw(ctx, W, H, sh, f, i, st) {
    var c = S.gal[sh.k], odd = i % 2, z = FAST_VAR[sh.v], sk = Math.pow(clamp(1 - f / 0.22, 0, 1), 2), dx = 0, dy = 0, cq;
    if (st === 'crash') {
      cq = eo(clamp(f / 0.28, 0, 1)); z = odd ? 1.3 - 0.3 * cq + 0.03 * f : 1 + 0.3 * cq + 0.03 * f;
      sk = f >= 0.28 ? Math.pow(clamp(1 - (f - 0.28) / 0.15, 0, 1), 2) : 0; dx = (rnd(i, 1) - 0.5) * W * 0.02 * sk; dy = (rnd(i, 2) - 0.5) * H * 0.014 * sk;
    } else {
      z *= odd ? 1 + 0.07 * eo(f) : 1 + 0.05 * (1 - eo(clamp(f / 0.4, 0, 1))) + 0.02 * f;
      if (st === 'beat' && sh.long) z *= 1 + 0.04 * (1 - eo(clamp(f / 0.3, 0, 1)));
      if (st === 'hype' || st === 'flash' || st === 'beat') { dx = (rnd(i, 1) - 0.5) * W * 0.03 * sk; dy = (rnd(i, 2) - 0.5) * H * 0.02 * sk; }
    }
    return galFastPic(ctx, W, H, c, z, dx, dy);
  }
  function galFastCard(ctx, W, H, c, sc, ang, ox, oy, dim) {
    var s = Math.min(W * 0.86 / c.width, H * 0.86 / c.height) * sc, w = c.width * s, h = c.height * s, rad = Math.min(w, h) * 0.03;
    ctx.save(); ctx.translate(W / 2 + ox, H / 2 + oy); ctx.rotate(ang);
    galShadow(ctx, -w / 2, -h / 2, w, h, rad, Math.min(W, H) * 0.07);
    ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, rad); ctx.clip(); ctx.drawImage(mipFor(c, Math.max(w, h)), -w / 2, -h / 2, w, h);
    if (dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dim + ')'; ctx.fillRect(-w / 2, -h / 2, w, h); } ctx.restore(); ctx.restore();
  }
  function galFastSlam(ctx, W, H, plan, i, f) {
    var d, idx, q = eo(clamp(f / 0.2, 0, 1)), sh = 0, a;
    ctx.drawImage(galBlurBg(S.gal[plan[i].k], W, H), 0, 0, W, H);
    for (d = 2; d >= 0; d--) {
      idx = (i - d + plan.length * 2) % plan.length;
      if (d === 0) {
        sh = f > 0.2 ? Math.pow(clamp(1 - (f - 0.2) / 0.15, 0, 1), 2) : 0;
        ctx.save(); ctx.globalAlpha = clamp(f / 0.05, 0, 1);
        galFastCard(ctx, W, H, S.gal[plan[idx].k], 1 + 0.22 * (1 - q), (rnd(idx, 4) - 0.5) * 0.09 * (1 - 0.5 * q), (rnd(idx, 5) - 0.5) * W * 0.012 * sh, (rnd(idx, 6) - 0.5) * H * 0.012 * sh, 0);
        ctx.restore();
      } else galFastCard(ctx, W, H, S.gal[plan[idx].k], 1 - 0.015 * d, (rnd(idx, 4) - 0.5) * 0.09, 0, 0, 0.22 * d);
    }
    a = 0.22 * clamp(1 - Math.abs(f - 0.2) / 0.05, 0, 1);
    if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
  }
  function galFastPop(ctx, W, H, plan, i, f, n) {
    var g = Math.min(W, H) * 0.012, tw = (W - g * 3) / 2, th = (H - g * 3) / 2, t, q, x, y, sc, c, a;
    ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, W, H);
    if (f >= 0.7) {
      galFastPic(ctx, W, H, S.gal[plan[i].k], 1.05 + 0.05 * clamp((f - 0.7) / 0.3, 0, 1), 0, 0);
      a = 0.45 * Math.pow(clamp(1 - (f - 0.7) / 0.08, 0, 1), 2); if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
      return;
    }
    for (t = 0; t < 4; t++) {
      q = eb(clamp((f - t * 0.1) / 0.16, 0, 1)); if (q <= 0) continue;
      c = S.gal[(plan[i].k + t) % n]; x = g + (t % 2) * (tw + g); y = g + Math.floor(t / 2) * (th + g); sc = 0.6 + 0.4 * q;
      ctx.save(); ctx.globalAlpha = clamp(q * 1.5, 0, 1); ctx.translate(x + tw / 2, y + th / 2); ctx.scale(sc, sc); ctx.translate(-tw / 2, -th / 2);
      ctx.beginPath(); ctx.rect(0, 0, tw, th); ctx.clip(); galFastPic(ctx, tw, th, c, 1, 0, 0); ctx.restore();
    }
  }
  function galFast(ctx, W, H, tn, n) {
    var o = S.o, st = FAST_STYLES[o.cutStyle] ? o.cutStyle : 'hype', plan = galFastPlan(n, o.secs, st), u = Math.min(W, H), i, sh, f, p, a, m, q, sm, ni, col;
    for (i = 0; i < plan.length - 1 && tn >= plan[i].a + plan[i].d; i++);
    sh = plan[i]; f = clamp((tn - sh.a) / sh.d, 0, 1); col = galFx(sh.k);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (st === 'slam') { galFastSlam(ctx, W, H, plan, i, f); return; }
    if (st === 'pop') { galFastPop(ctx, W, H, plan, i, f, n); return; }
    if (st === 'whip' && f > 0.78) {
      q = ease((f - 0.78) / 0.22); sm = Math.sin(Math.PI * q) * W * 0.06; ni = (i + 1) % plan.length;
      var at = function (idx, sf, xo, al) { ctx.save(); ctx.globalAlpha = al; ctx.translate(xo, 0); galFastDraw(ctx, W, H, plan[idx], sf, idx, st); ctx.restore(); };
      for (m = 3; m >= 1; m--) at(i, f, -W * q + m * sm / 3, 0.22);
      at(i, f, -W * q, 1);
      for (m = 3; m >= 1; m--) at(ni, 0, (1 - q) * W + m * sm / 3, 0.22);
      at(ni, 0, (1 - q) * W, 1);
      return;
    }
    if ((st === 'zthru' || st === 'spin') && f > (st === 'zthru' ? 0.7 : 0.76)) {
      q = ease((f - (st === 'zthru' ? 0.7 : 0.76)) / (st === 'zthru' ? 0.3 : 0.24)); ni = (i + 1) % plan.length;
      var tf = function (idx, sf, sc, ang, al) { ctx.save(); ctx.globalAlpha = al; ctx.translate(W / 2, H / 2); ctx.rotate(ang); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2); galFastDraw(ctx, W, H, plan[idx], sf, idx, st); ctx.restore(); };
      if (st === 'zthru') { tf(ni, 0, 0.72 + 0.28 * q, 0, 1); tf(i, f, 1 + 1.5 * q, 0, 1 - q); }
      else { tf(ni, 0, 1.75 - 0.75 * q, (1 - q) * 0.4, 1); for (m = 3; m >= 1; m--) tf(i, f, 1 + 0.75 * q, -q * 0.4 - m * 0.05 * Math.sin(Math.PI * q), 0.18); tf(i, f, 1 + 0.75 * q, -q * 0.4, 1 - q); }
      return;
    }
    if (st === 'glitch') {
      if (!fastTmpC || fastTmpC.width !== W || fastTmpC.height !== H) fastTmpC = mk(W, H);
      var tx = fastTmpC.getContext('2d'), N = 12, j, y0, hh, g = Math.pow(clamp(1 - f / 0.3, 0, 1), 2) + 0.6 * clamp(1 - Math.abs(f - 0.63) / 0.04, 0, 1);
      tx.clearRect(0, 0, W, H); galFastDraw(tx, W, H, sh, f, i, st); ctx.drawImage(fastTmpC, 0, 0);
      if (g > 0.02) {
        for (j = 0; j < N; j++) {
          if (rnd(i * 13 + j, 3) < 0.3) continue;
          y0 = Math.floor(j * H / N); hh = Math.ceil(H / N) + 1;
          ctx.drawImage(fastTmpC, 0, y0, W, hh, (rnd(i * 7 + j, 8) - 0.5) * W * 0.28 * g, y0, W, hh);
        }
        if (g > 0.3) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; for (j = 0; j < 3; j++) ctx.fillRect(0, rnd(i * 5 + j, 9) * H, W, Math.max(2, u * 0.004)); }
      }
      return;
    }
    p = galFastDraw(ctx, W, H, sh, f, i, st);
    if (st === 'hype' || st === 'accel' || st === 'crash') {
      a = (st === 'hype' ? 0.55 : 0.35) * Math.pow(clamp(1 - f / 0.12, 0, 1), 2);
      if (st === 'crash') a = 0.3 * clamp(1 - Math.abs(f - 0.28) / 0.05, 0, 1);
      if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
    } else if (st === 'flash') {
      a = 0.9 * Math.pow(clamp(1 - f / 0.2, 0, 1), 2);
      if (a > 0) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = a; ctx.fillStyle = col || '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      a = 0.3 * clamp(1 - Math.abs(f - 0.56) / 0.07, 0, 1);
      if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
    } else if (st === 'beat') {
      a = (sh.long ? 0.35 : 0.2) * Math.pow(clamp(1 - f / 0.1, 0, 1), 2);
      if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
      if (col && sh.long && f < 0.3) { var lw = u * 0.016 * (1 - f / 0.3); ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw); ctx.restore(); }
    }
    if (st === 'accel' && col) {
      var bh = Math.max(3, u * 0.012), top = layout(W, H).pos === 'bottom';
      ctx.fillStyle = col; ctx.fillRect(0, top ? 0 : H - bh, W * tn, bh);
      if (i === plan.length - 1) galReticle(ctx, p, W, H, f, col);
    }
  }
  (function () {   // show the pickers only where they apply, and describe the chosen style
    var f = window.sppSetSeg;
    window.sppSetSeg = function (k) {
      var r = f.apply(this, arguments);
      if (k === 'gal' || k === 'cutStyle' || k === 'fit') {
        var g = S.o.fit === 'gallery', row = $('sppCutStyleRow'), fx = $('sppFxColRow');
        if (row) row.style.display = (g && S.o.gal === 'fastcuts') ? '' : 'none';
        if (fx) fx.style.display = (g && (S.o.gal === 'fastcuts' || S.o.gal === 'focus' || S.o.gal === 'brand')) ? '' : 'none';
        var nt = $('sppCutStyleNote'); if (nt) nt.textContent = FAST_NOTES[S.o.cutStyle] || '';
        var wn = $('sppCutWarn'); if (wn) wn.style.display = (g && S.o.gal === 'fastcuts' && FAST_FLASHY[S.o.cutStyle]) ? '' : 'none';
      }
      return r;
    };
  })();

  /* ───────────────────────── build 285: REEL PRESETS + 30 s CAP ─────────────────────────
     One tap sets layout, cut style, pace, format, fonts, text motion and audience prompt for a finished reel. Your own text is never overwritten.
     Total length is capped at 30 seconds (seconds per loop x loops in video). */
  var REEL_MAX = 30;
  var REELS = [
    { id: 'launch', n: 'Product launch', d: 'Crash zooms, brand colour, shop prompt · 15s', o: { gal: 'fastcuts', cutStyle: 'crash', fxCol: 'brand', secs: 15, ratio: '9:16', fillA: '#0b1220', fillB: '#1f4e8c', accent: '#00c2ff', font: 'bold', txtPos: 'bottom', txtSize: 105, txtAnim: 'mask', txtLive: 'none', txtOut: 'auto', scrim: 55, eng: 'tap' }, t: ['NEW DROP', 'Now live', 'NEW', 'Shop now'] },
    { id: 'beat', n: 'Beat drop', d: 'Long-short-short rhythm cuts · 15s', o: { gal: 'fastcuts', cutStyle: 'beat', fxCol: 'auto', secs: 15, ratio: '9:16', fillA: '#111111', fillB: '#3a3a3a', accent: '#ff7a59', font: 'bold', txtPos: 'bottom', txtSize: 110, txtAnim: 'beat', txtLive: 'none', txtOut: 'auto', scrim: 55, eng: 'like' }, t: ['DROP', 'Only this week', 'HOT', ''] },
    { id: 'whip', n: 'Whip story', d: 'Fast whip pans with motion smear · 12s', o: { gal: 'fastcuts', cutStyle: 'whip', fxCol: 'white', secs: 12, ratio: '9:16', fillA: '#0b1220', fillB: '#1f4e8c', accent: '#34d399', font: 'clean', txtPos: 'bottom', txtSize: 100, txtAnim: 'track', txtLive: 'none', txtOut: 'auto', scrim: 50, eng: 'swipe' }, t: ['Swipe the story', '', '', 'Swipe up'] },
    { id: 'zthru', n: 'Zoom-through', d: 'Smooth punch-through transitions · 18s', o: { gal: 'fastcuts', cutStyle: 'zthru', fxCol: 'white', secs: 18, ratio: '9:16', fillA: '#0b1220', fillB: '#1f4e8c', accent: '#00c2ff', font: 'clean', txtPos: 'bottom', txtSize: 100, txtAnim: 'focus', txtLive: 'none', txtOut: 'auto', scrim: 50, eng: 'none' }, t: ['Made to be noticed', '', '', ''] },
    { id: 'spin', n: 'Spin cut', d: 'Rotating whip with ghosts, 1:1 · 15s', o: { gal: 'fastcuts', cutStyle: 'spin', fxCol: 'brand', secs: 15, ratio: '1:1', fillA: '#7c3aed', fillB: '#c084fc', accent: '#c084fc', font: 'bold', txtPos: 'bottom', txtSize: 100, txtAnim: 'pop', txtLive: 'none', txtOut: 'auto', scrim: 50, eng: 'none' }, t: ['Fresh arrivals', '', 'NEW', ''] },
    { id: 'luxury', n: 'Luxury edit', d: 'Brand sweep, serif type, gold accent', o: { gal: 'brand', fxCol: 'brand', ratio: '4:5', fillA: '#111111', fillB: '#3a3a3a', accent: '#d4af37', font: 'serif', txtPos: 'bottom', txtSize: 100, txtAnim: 'focus', txtLive: 'none', txtOut: 'auto', scrim: 55, eng: 'none' }, auto: [12, 24], t: ['The Collection', 'Crafted with care', '', ''] },
    { id: 'corp', n: 'Corporate recap', d: 'Colour-matched aura, clean type, 16:9', o: { gal: 'aura', fxCol: 'brand', ratio: '16:9', fillA: '#0b1220', fillB: '#1f4e8c', accent: '#0073E6', font: 'clean', txtPos: 'bottom', txtSize: 95, txtAnim: 'mask', txtLive: 'none', txtOut: 'auto', scrim: 45, eng: 'none' }, auto: [15, 30], t: ['Quarterly highlights', '', '', ''] },
    { id: 'chill', n: 'Cold drink ad', d: 'Smart Chill Drop on every photo: frost, glints, mist', per: 7, o: { gal: 'chilldrop', fxCol: 'white', ratio: '9:16', fillA: '#071a2c', fillB: '#1b5a86', accent: '#7fd6ff', font: 'bold', txtPos: 'bottom', txtSize: 105, txtAnim: 'focus', txtLive: 'none', txtOut: 'auto', scrim: 50, eng: 'none' }, auto: [12, 30], t: ['Stay chill', 'Ice cold. Always fresh.', '', ''] },
    { id: 'show', n: 'Showreel 30s', d: "Director's cut, mixed cinematic effects", o: { gal: 'cuts', fxCol: 'white', secs: 30, ratio: '16:9', fillA: '#0b0b0d', fillB: '#1f1f23', accent: '#00c2ff', font: 'clean', txtPos: 'bottom', txtSize: 100, txtAnim: 'mask', txtLive: 'none', txtOut: 'auto', scrim: 50, eng: 'none' }, t: ['Showreel', '', '', ''] }
  ];
  function capLoops() {
    var lp = $('sppLoops'); if (!lp) return;
    var mx = Math.max(1, Math.floor(REEL_MAX / Math.max(0.5, S.o.secs) + 1e-6));
    [].forEach.call(lp.options, function (op) { op.disabled = +op.value > mx; });
    if (+lp.value > mx) lp.value = String(mx);
    var el = $('sppReelLen'); if (el) { var tot = Math.round(S.o.secs * (+lp.value || 1) * 10) / 10; el.textContent = 'Reel length: ' + tot + 's of ' + REEL_MAX + 's max'; }
  }
  window.sppReel = function (id) {
    var r = REELS.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var o = S.o, n = S.gal.length;
    Object.keys(r.o).forEach(function (k) { o[k] = r.o[k]; });
    if (r.auto) o.secs = clamp(Math.round(Math.max(n, 3) * (r.per || 3)), r.auto[0], r.auto[1]);
    o.secs = clamp(o.secs, 2, REEL_MAX); o.fit = 'gallery';
    if (!o.head && r.t[0]) o.head = r.t[0]; if (!o.sub && r.t[1]) o.sub = r.t[1]; if (!o.badge && r.t[2]) o.badge = r.t[2]; if (!o.engText && r.t[3]) o.engText = r.t[3];
    S._userRatio = true; var lp = $('sppLoops'); if (lp) lp.value = '1';
    syncUi(); capLoops();
    [].forEach.call($('sppReelGrid').children, function (b) { b.classList.toggle('on', b.getAttribute('data-id') === id); });
    if (n < 2) say('Preset applied. Add 2 or more photos to see the full reel.', 'info');
    if (typeof sppSaveSoon === 'function') sppSaveSoon();
  };
  (function () {
    var g = $('sppReelGrid'); if (!g) return;
    REELS.forEach(function (r) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'spp-reel'; b.setAttribute('data-id', r.id);
      b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = r.n; b.lastChild.textContent = r.d; b.onclick = function () { window.sppReel(r.id); }; g.appendChild(b);
    });
    var lp = $('sppLoops'); if (lp) lp.addEventListener('change', capLoops);
    var f = window.sppSet; window.sppSet = function (k) { var r = f.apply(this, arguments); if (k === 'secs') { capLoops(); var gg = $('sppReelGrid'); if (gg) [].forEach.call(gg.children, function (b) { b.classList.remove('on'); }); } return r; };
    capLoops();
  })();

  /* ───────────────────────── preview loop ───────────────────────── */
  function tick(ts) {
    if (!S.open) return;
    // While a video records, the recorder owns the drawing runtime. Drawing the small preview in between made
    // it rebuild the 3D sprites at two sizes every frame, which starved the recording.
    if (S.recording) { S.raf = requestAnimationFrame(tick); return; }
    var c = $('sppCanvas'), ctx = c.getContext('2d');
    if (S.playing) {
      S.tNorm = (((ts - S.t0) / 1000) / S.o.secs) % 1; if (S.tNorm < 0) S.tNorm += 1;
      $('sppScrub').value = Math.round(S.tNorm * 1000);
    }
    try { draw(ctx, c.width, c.height, S.tNorm, { tAbs: S.tNorm * S.o.secs }); } catch (e) { console.error(e); }
    $('sppEmptyMsg').style.display = hasArt() ? 'none' : ''; $('sppEmptyMsg').textContent = S.o.fit === 'gallery' ? 'Add a few photos to begin' : 'Add a photo to begin';
    S.raf = requestAnimationFrame(tick);
  }

  /* ───────────────────────── output ───────────────────────── */
  function renderStill(withMark) {
    var d = EXPORT[S.o.ratio], c = mk(d[0], d[1]);
    draw(c.getContext('2d'), c.width, c.height, S.tNorm, { textT: 1, watermark: withMark });
    return c;
  }
  window.sppGate = function (fn) {
    if (!hasArt()) { say('Add a photo first', 'info'); return Promise.resolve(); }
    var gate = window.sarvarcGateExport;
    var run = typeof gate === 'function' ? gate : function (f) { return f(); };
    return Promise.resolve().then(function () { return run(fn); }).catch(function (e) {
      console.error('Showcase export failed', e);
      say('Export could not start. Check your connection and try again.', 'error');
    });
  };
  window.sppDownloadPng = async function () {
    try {
      var c = renderStill(!!window.sarvarcApplyFreeWatermark);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
      if (!blob) blob = await (await fetch(c.toDataURL('image/png'))).blob();   // toBlob can return null on big canvases
      save(blob, 'showcase.png');
      say('PNG saved', 'success');
    } catch (e) { console.error('Showcase PNG failed', e); say('PNG export failed. Please try again.', 'error'); }
  };
  function save(blob, name) {
    if (typeof pdfedDownloadBlob === 'function') { pdfedDownloadBlob(blob, name); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.sppPlaceOnPage = async function () {
    if (!hasArt()) { say('Add a photo first', 'info'); return; }
    var c = renderStill(false), url = c.toDataURL('image/png');
    try { if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('image', url, 'Showcase.png'); } catch (e) {}
    if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) {
      sppClose();
      if (typeof pdfedOpenImageAsPage === 'function') { await pdfedOpenImageAsPage(url, { name: 'Showcase', type: 'image/png' }); say('Placed as a new page', 'success'); }
      return;
    }
    var idx = pdfed.active, pg = pdfed.pages[idx], pcv = document.getElementById('pdfedPageCanvas');
    var pw = (pcv && pcv.width) || 800, ph = (pcv && pcv.height) || 1100;
    var k = Math.min(pw / c.width, ph / c.height), w = Math.round(c.width * k), h = Math.round(c.height * k);
    if (S.o.ratio === 'page') { w = pw; h = ph; }   // same shape as the page: fill it exactly
    pdfedAnnotState.placedImgSeq++;
    (pg.placedImages = pg.placedImages || []).push({
      id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: url,
      x: Math.round((pw - w) / 2), y: Math.round((ph - h) / 2), w: w, h: h, locked: false, zIndex: pdfedNextZ(pg), kind: 'image'
    });
    if (typeof pdfedMarkModified === 'function') pdfedMarkModified(idx);
    if (typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(idx);
    sppClose();
    say('Placed on your page. Drag it, resize it, or add more text.', 'success');
  };

  /* ───────────────────────── build 287: SMOOTH, EXACT VIDEO EXPORT ─────────────────────────
     The old exporter recorded the canvas LIVE: every frame was drawn the moment the clock said so, so any frame
     that took longer than ~33 ms (big 1080 x 1920 frames, 3D motions, cut effects) was simply skipped. That was
     the lag, and it also meant quick motions (whips, flashes, shatter, glitch) vanished between the frames.
     Now every frame is rendered OFFLINE at an exact time and encoded straight into an MP4 (WebCodecs + the
     bundled mp4 muxer), the same way the slideshow clip export already works. Speed of the computer only
     changes how long the export takes, never how it looks. Every loop replays exactly like the preview does.
     The old live recorder stays as the fallback for browsers without WebCodecs. */
  var __sppYield = function () { return new Promise(function (r) { var mc = new MessageChannel(); mc.port1.onmessage = function () { r(); }; mc.port2.postMessage(0); }); };
  var __sppPaint = function () { return new Promise(function (r) { var d = false, f = function () { if (!d) { d = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 50); }); };
  async function exportVideoOffline() {
    var btns = ['sppPlaceBtn', 'sppPlaceLiveBtn', 'sppPngBtn', 'sppVidBtn'];
    var wasPlaying = S.playing, enc = null, saved = false;
    S.recording = true;
    btns.forEach(function (id) { var el = $(id); if (el) el.disabled = true; });
    $('sppProg').classList.add('on'); $('sppProgBar').style.width = '0';
    $('sppProgTxt').textContent = 'Preparing your video…';
    try {
      try { if (S.o.fontName) await fontKick(S.o.fontName); } catch (e) {}
      var d = EXPORT[S.o.ratio], cw = d[0] - d[0] % 2, ch = d[1] - d[1] % 2, cv = mk(cw, ch), ctx = cv.getContext('2d');
      capLoops();
      var secs = S.o.secs, loops = Math.max(1, Math.min(+$('sppLoops').value || 1, Math.floor(REEL_MAX / secs + 1e-6)));
      // Prefer 60 fps (matches how smooth the preview is), fall back to 30 fps if this computer cannot encode it at this size.
      var chosen = null, fpsTry = [60, 30], codecs = ['avc1.64002A', 'avc1.640033', 'avc1.4D002A', 'avc1.42002A'];
      for (var a = 0; a < fpsTry.length && !chosen; a++) {
        var f0 = fpsTry[a], br = Math.round(Math.max(5e6, Math.min(20e6, cw * ch * f0 * 0.1)));
        for (var b = 0; b < codecs.length; b++) {
          var sup = null;
          try { sup = await VideoEncoder.isConfigSupported({ codec: codecs[b], width: cw, height: ch, bitrate: br, framerate: f0 }); } catch (e) { sup = null; }
          if (sup && sup.supported) { chosen = { fps: f0, codec: codecs[b], bitrate: br }; break; }
        }
      }
      if (!chosen) throw new Error('no H.264 encoder here');
      var fps = chosen.fps, perLoop = Math.max(2, Math.round(secs * fps)), total = perLoop * loops;
      var mark = !!window.sarvarcApplyFreeWatermark, encErr = null;
      var muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: cw, height: ch, frameRate: fps }, fastStart: 'in-memory' });
      enc = new VideoEncoder({ output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); }, error: function (e) { encErr = e; } });
      enc.configure({ codec: chosen.codec, width: cw, height: ch, bitrate: chosen.bitrate, framerate: fps });
      var lastUi = 0, i, tn, vf, guard, nowMs;
      for (i = 0; i < total; i++) {
        if (encErr) throw encErr;
        tn = (i % perLoop) / perLoop;                       // every loop is identical to the preview: same time, same text intro, same cuts
        draw(ctx, cw, ch, tn, { tAbs: tn * secs, flatten: '#ffffff', watermark: mark });
        vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        guard = 0;
        while (enc.encodeQueueSize > 6 && guard++ < 600) { await new Promise(function (r) { enc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 30); }); }
        nowMs = performance.now();
        if (nowMs - lastUi > 150) {
          lastUi = nowMs;
          $('sppProgBar').style.width = (i / total * 100).toFixed(0) + '%';
          $('sppProgTxt').textContent = 'Rendering ' + (i / fps).toFixed(1) + 's of ' + (total / fps).toFixed(1) + 's, frame by frame at ' + fps + ' fps. Keep this tab open.';
          if (document.hidden) await __sppYield(); else await __sppPaint();
        } else if (i % 3 === 0) { await __sppYield(); }
      }
      $('sppProgBar').style.width = '100%'; $('sppProgTxt').textContent = 'Finishing your MP4…';
      await enc.flush();
      if (encErr) throw encErr;
      try { enc.close(); } catch (e) {}
      enc = null;
      muxer.finalize();
      var blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      if (!blob.size) throw new Error('The encoder produced an empty file');
      save(blob, 'showcase.mp4');
      say('Video saved as .mp4 (' + fps + ' fps)', 'success');
      saved = true;
    } catch (err) {
      console.warn('[Showcase] offline MP4 render failed, using the live recorder instead', err);
      say('The smooth renderer could not finish here, so the video is being recorded live. Keep this tab in front.', 'info');
      try { if (enc && enc.state !== 'closed') enc.close(); } catch (e2) {}
    } finally {
      S.recording = false; S.playing = wasPlaying;
      if (S.playing) S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
      btns.forEach(function (id) { var el = $(id); if (el) el.disabled = false; });
      $('sppProg').classList.remove('on'); $('sppProgBar').style.width = '0';
    }
    return saved;
  }
  window.sppExportVideo = async function () {
    if (S.recording) return;
    if (!hasArt()) { say('Add a photo first', 'info'); return; }
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined') {
      if (await exportVideoOffline()) return;
    }
    return exportVideoRealtime();
  };

  // Fallback for browsers without WebCodecs. Now runs on a virtual clock: every frame advances time by exactly 1/fps, so a
  // slow moment makes the video play a little slower instead of skipping the motion that happened in between.
  async function exportVideoRealtime() {
    if (S.recording) return;
    if (!hasArt()) { say('Add a photo first', 'info'); return; }
    if (!window.MediaRecorder) { say('Video export is not supported in this browser', 'error'); return; }
    var btns = ['sppPlaceBtn', 'sppPlaceLiveBtn', 'sppPngBtn', 'sppVidBtn'];
    var wasPlaying = S.playing, rec = null;
    S.recording = true;
    btns.forEach(function (id) { var el = $(id); if (el) el.disabled = true; });
    $('sppProg').classList.add('on');
    try {
      try { if (S.o.fontName) await fontKick(S.o.fontName); } catch (e) {}
      var d = EXPORT[S.o.ratio], cv = mk(d[0], d[1]), ctx = cv.getContext('2d'), fps = 30;
      var mime = typeof pdfedClipPickMime === 'function' ? pdfedClipPickMime() : ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
      capLoops(); var loops = Math.max(1, Math.min(+$('sppLoops').value || 1, Math.floor(REEL_MAX / S.o.secs + 1e-6))), totalMs = S.o.secs * loops * 1000;
      var stream = cv.captureStream(0), track = stream.getVideoTracks()[0], manual = !!(track && typeof track.requestFrame === 'function');
      if (!manual) stream = cv.captureStream(fps);
      try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined); }
      catch (e1) { rec = new MediaRecorder(stream); }                 // let the browser pick its own format
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var done = new Promise(function (res) { rec.onstop = res; rec.onerror = res; });
      var mark = !!window.sarvarcApplyFreeWatermark;
      // First frame is drawn BEFORE recording starts, so the video never opens on an empty frame.
      draw(ctx, cv.width, cv.height, 0, { tAbs: 0, flatten: '#ffffff', watermark: mark });
      if (manual) track.requestFrame();
      rec.start(500);
      var start = performance.now(), nF = 0, perLoopF = Math.max(2, Math.round(S.o.secs * fps)), nTotal = perLoopF * loops;
      await new Promise(function (resolve, reject) {
        (function step() {
          try {
            var tn = (nF % perLoopF) / perLoopF;
            draw(ctx, cv.width, cv.height, tn, { tAbs: tn * S.o.secs, flatten: '#ffffff', watermark: mark });
            if (manual) track.requestFrame();
            nF++;
            $('sppProgBar').style.width = (clamp(nF / nTotal, 0, 1) * 100).toFixed(0) + '%';
            $('sppProgTxt').textContent = 'Recording ' + (nF / fps).toFixed(1) + 's of ' + (nTotal / fps).toFixed(1) + 's. Keep this tab open.';
            if (nF >= nTotal) { resolve(); return; }
            setTimeout(step, Math.max(0, start + nF * 1000 / fps - performance.now()));
          } catch (err) { reject(err); }
        })();
      });
      await new Promise(function (r) { setTimeout(r, 150); });
      if (rec.state !== 'inactive') rec.stop();
      await done;
      var type = (rec.mimeType || mime || 'video/webm'), ext = /mp4/.test(type) ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: type });
      if (!blob.size) throw new Error('The recorder produced an empty file');
      save(blob, 'showcase.' + ext);
      say('Video saved as .' + ext, 'success');
    } catch (err) {
      console.error('Showcase video failed', err);
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e2) {}
      say('Video export failed. Keep this tab in front while it records, then try again.', 'error');
    } finally {
      // Always runs, so the buttons and the close button can never stay stuck after a failed export.
      S.recording = false; S.playing = wasPlaying;
      if (S.playing) S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
      btns.forEach(function (id) { var el = $(id); if (el) el.disabled = false; });
      $('sppProg').classList.remove('on'); $('sppProgBar').style.width = '0';
    }
  };


  /* ───────────────────────── LIVE CLIPS ─────────────────────────
     A live clip is a placed image item that carries a `clip` spec (the cut-out
     product + every motion/background/text option). On the page it is drawn as a
     running <canvas>; for exports it is re-rendered frame by frame from the same spec.
     Each clip renders through its own private runtime (own sprites/layers), swapped
     into S for the duration of one draw, so it never disturbs the open Presenter. */
  var RT = new WeakMap();
  function clipRt(clip) {
    var rt = RT.get(clip);
    if (rt) return rt;
    rt = { ready: false, cut: null, gal: null, sprites: null, spriteKey: '', layers: {}, cutVer: 1,
           edgeRGB: (clip.edge || [70, 70, 70]).slice(), bgColor: clip.bg || { r: 240, g: 242, b: 246 },
           o: Object.assign({}, clip.o), promise: null };
    if (clip.vid && clip.vid.id) {   // uploaded video clip: the ORIGINAL file plays, nothing is re-sampled
      rt.clip = clip;
      rt.promise = vidGetBlob(clip.vid.id).then(function (blob) {
        if (!blob) return rt;   // file not found on this device: the poster picture shows instead of a hole
        rt.url = vidUrl(clip.vid.id, blob);
        return makeVideo(rt.url).then(function (v) { if (v) { v.loop = true; rt.video = v; rt.ready = true; } return rt; });
      });
    } else if (clip.gal && clip.gal.length) {   // multi-photo clip: decode every photo once, then play exactly like the preview
      rt.promise = Promise.all(clip.gal.map(getCut)).then(function (list) {
        list = list.filter(Boolean); if (list.length) { rt.gal = list; rt.ready = true; } return rt;
      });
    } else rt.promise = getCut(clip.cut).then(function (c) { if (c) { rt.cut = c; rt.ready = true; } return rt; });
    // Exports wait on this promise: the clip's text font must be loaded too, otherwise the first frames use a fallback font and differ from the preview.
    var fontName = clip.o && clip.o.fontName;
    if (fontName) rt.promise = rt.promise.then(function (r) { return fontKick(fontName).then(function () { return r; }, function () { return r; }); });
    RT.set(clip, rt);
    return rt;
  }
  // Decoded cut-outs are cached by data URL (small LRU): a clip that gets cloned by undo/redo, duplicate or
  // page copy is ready instantly instead of decoding its PNG again and flashing blank.
  var CUTS = new Map();
  function getCut(url) {
    var p = CUTS.get(url);
    if (p) { CUTS.delete(url); CUTS.set(url, p); return p; }
    p = new Promise(function (res) {
      var im = new Image();
      im.onload = function () { var c = mk(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); res(c); };
      im.onerror = function () { res(null); };
      im.src = url;
    });
    p.then(function (c) { if (!c) CUTS.delete(url); });
    CUTS.set(url, p);
    if (CUTS.size > 26) CUTS.delete(CUTS.keys().next().value);
    return p;
  }
  function withRt(rt, fn) {
    var keep = { live: S.live, cut: S.cut, gal: S.gal, sprites: S.sprites, spriteKey: S.spriteKey, layers: S.layers, cutVer: S.cutVer, edgeRGB: S.edgeRGB, bgColor: S.bgColor, o: S.o };
    S.live = null; S.cut = rt.cut; S.gal = rt.gal || S.gal; S.sprites = rt.sprites; S.spriteKey = rt.spriteKey; S.layers = rt.layers; S.cutVer = rt.cutVer;
    S.edgeRGB = rt.edgeRGB; S.bgColor = rt.bgColor; S.o = rt.o;
    try { return fn(); }
    finally {
      rt.sprites = S.sprites; rt.spriteKey = S.spriteKey; rt.layers = S.layers;
      Object.keys(keep).forEach(function (k) { S[k] = keep[k]; });
    }
  }
  window.sppLiveReady = function (clip) { return clipRt(clip).promise; };
  window.sppLiveIsReady = function (clip) { var rt = clipRt(clip); return !!(rt.ready && (rt.cut || rt.video || (rt.gal && rt.gal.length))); };
  window.sppLiveAspect = function (clip) { var d = (clip.dims && clip.dims.e) || EXPORT[(clip.o && clip.o.ratio)] || EXPORT['16:9']; return d[0] / d[1]; };
  // Draws the clip at time tSec (seconds since it first appeared) onto ctx. Returns false until its cut-out has decoded.
  /* LIVE LOOK: a live clip can carry clip.look = { shape, fx } (an Image Reshaper outline and/or a Design filter).
     It is applied on EVERY frame here, so the page canvas, thumbnails, slideshow preview and MP4 export all show the same thing.
     The clip is drawn on a private layer first, the filter runs on that layer, then the layer is cut into the shape. */
  var LOOKC = new WeakMap();
  function lookLayer(clip, key, W, H) {
    var m = LOOKC.get(clip); if (!m) { m = {}; LOOKC.set(clip, m); }
    var c = m[key]; if (!c) c = m[key] = document.createElement('canvas');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }
  function lookReset(x) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.shadowColor = 'rgba(0,0,0,0)'; x.shadowBlur = 0; x.shadowOffsetX = 0; x.shadowOffsetY = 0; }
  function lookClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lookCompose(clip, ctx, A, W, H, look) {
    var fx = look.fx, sh = look.shape;
    if (fx && fx.preset && typeof pdfedDesignApplyPresetToCtx === 'function') {
      // grain and star specks use Math.random: a fixed seed per frame keeps them steady instead of flickering
      var rnd = Math.random, seed = 1234567;
      Math.random = function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      try { pdfedDesignApplyPresetToCtx(A.getContext('2d'), W, H, fx.preset, fx.strength == null ? 50 : fx.strength); }
      finally { Math.random = rnd; lookReset(A.getContext('2d')); }
    }
    lookReset(ctx); ctx.clearRect(0, 0, W, H);
    if (!sh || !sh.d) { ctx.drawImage(A, 0, 0); return; }
    var B = lookLayer(clip, 'b', W, H), bx = B.getContext('2d');
    lookReset(bx); bx.clearRect(0, 0, W, H);
    var inset = lookClamp(sh.inset == null ? 100 : sh.inset, 30, 100) / 100;
    var shapeM = new DOMMatrix().translate(500, 500).rotate(sh.rot || 0).scale((sh.flipH ? -1 : 1) * inset, (sh.flipV ? -1 : 1) * inset).translate(-500, -500);
    var pad = (sh.bevel || sh.shadow) ? Math.round(Math.min(W, H) * 0.05) : 0;
    var iw = W - 2 * pad, ih = H - 2 * pad, bb = sh.bb, ux = bb ? bb[2] : 1000, uy = bb ? bb[3] : 1000;
    var base = new DOMMatrix().translate(pad, pad).scale(iw / ux, ih / uy);
    if (bb) base = base.translate(-bb[0], -bb[1]);
    var path = new Path2D(); path.addPath(new Path2D(sh.d), base.multiply(shapeM));
    var zoom = lookClamp(sh.zoom || 100, 100, 400) / 100, rw = W / zoom, rh = H / zoom;
    var cx = (sh.fx == null ? 50 : sh.fx) / 100 * W, cy = (sh.fy == null ? 50 : sh.fy) / 100 * H;
    var x0 = lookClamp(cx - rw / 2, 0, W - rw), y0 = lookClamp(cy - rh / 2, 0, H - rh);
    bx.save(); bx.clip(path); bx.drawImage(A, x0, y0, rw, rh, pad, pad, iw, ih);
    if (sh.border && sh.borderW > 0) { bx.lineJoin = 'round'; bx.strokeStyle = sh.border; bx.lineWidth = sh.borderW / 1000 * Math.min(iw, ih) * 2; bx.stroke(path); }
    bx.restore();
    if (sh.bevel && typeof rshBuildBevelGradient === 'function') {
      var avg = (iw / ux + ih / uy) / 2, proxy = { createLinearGradient: function () { return bx.createLinearGradient(0, 0, W, H); } };
      bx.save(); bx.lineJoin = 'round';
      bx.strokeStyle = rshBuildBevelGradient(proxy, sh.bevelStyle || 'gold'); bx.lineWidth = 20 * avg; bx.stroke(path);
      bx.strokeStyle = 'rgba(255,255,255,0.65)'; bx.lineWidth = 5 * avg; bx.stroke(path);
      bx.restore();
    }
    if (sh.shadow) { var md = Math.min(W, H); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = md * 0.045; ctx.shadowOffsetY = md * 0.02; }
    ctx.drawImage(B, 0, 0);
    lookReset(ctx);
  }
  /* ───── UPLOADED VIDEO CLIPS: original file, played natively ─────
     Page, preview and thumbnails draw the playing <video> (full smoothness, full sharpness). Export uses a second,
     paused copy that is SEEKED to the exact time of every output frame, so the MP4 is frame-exact and never depends
     on how fast this computer is. */
  var VIDX = { blobs: new Map(), loading: new Map(), urls: new Map(), active: new Set() };
  // Clip files live in their OWN small database as real Blobs (never as giant text), so autosave, undo, sessions and
  // Drive sync never have to copy them around.
  var VIDDB = null;
  function vidDb() {
    if (VIDDB) return VIDDB;
    VIDDB = new Promise(function (res, rej) {
      var r = indexedDB.open('sarvarcClipVideos', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('v'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { VIDDB = null; rej(r.error); };
    });
    return VIDDB;
  }
  async function vidPut(id, blob) {
    var db = await vidDb();
    return new Promise(function (res, rej) { var tx = db.transaction('v', 'readwrite'); tx.objectStore('v').put(blob, id); tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error); }; });
  }
  async function vidGet(id) {
    var db = await vidDb();
    return new Promise(function (res, rej) { var q = db.transaction('v', 'readonly').objectStore('v').get(id); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; });
  }
  function vidGetBlob(id) {
    if (VIDX.blobs.has(id)) return Promise.resolve(VIDX.blobs.get(id));
    if (VIDX.loading.has(id)) return VIDX.loading.get(id);
    var p = (async function () {
      try { var b = await vidGet(id); if (!(b instanceof Blob)) return null; VIDX.blobs.set(id, b); return b; }
      catch (e) { console.warn('[Workspace] could not load a stored clip', e); return null; }
    })();
    VIDX.loading.set(id, p); p.then(function () { VIDX.loading.delete(id); });
    return p;
  }
  function vidUrl(id, blob) { var u = VIDX.urls.get(id); if (!u) { u = URL.createObjectURL(blob); VIDX.urls.set(id, u); } return u; }
  function makeVideo(url) {
    return new Promise(function (res) {
      var v = document.createElement('video'), done = false;
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      function fin(ok) { if (done) return; done = true; res(ok ? v : null); }
      v.onloadeddata = function () { fin(true); }; v.onerror = function () { fin(false); };
      setTimeout(function () { fin(v.readyState >= 2); }, 15000);
      v.src = url; v.load();
    });
  }
  // Exports wait on this: puts the paused export copy of the clip at exactly tSec (seconds into the clip).
  window.sppLiveSeek = async function (clip, tSec) {
    var rt = clipRt(clip); await rt.promise; if (!rt.video || !rt.url) return;
    var xv = rt.xvideo; if (!xv) { xv = await makeVideo(rt.url); if (!xv) return; rt.xvideo = xv; }
    rt.xAt = performance.now(); rt.lastDraw = rt.xAt; VIDX.active.add(rt);
    try { rt.video.pause(); xv.pause(); } catch (e) {}
    var dur = xv.duration || rt.o.secs || 1, loopLen = Math.min(rt.o.secs || dur, dur);
    var t = loopLen > 0 ? ((tSec % loopLen) + loopLen) % loopLen : 0; t = Math.min(t, Math.max(0, dur - 0.04));
    if (xv.readyState >= 2 && Math.abs(xv.currentTime - t) < 0.002) return;
    await new Promise(function (res) {
      var done = false; function fin() { if (!done) { done = true; xv.removeEventListener('seeked', fin); res(); } }
      xv.addEventListener('seeked', fin); setTimeout(fin, 3000); xv.currentTime = t;
    });
  };
  // Housekeeping: a clip nobody is drawing any more stops playing; the export copy is released once the export is over.
  setInterval(function () {
    var now = performance.now();
    VIDX.active.forEach(function (rt) {
      if (now - (rt.lastDraw || 0) > 700) { try { rt.video && rt.video.pause(); } catch (e) {} }
      if (rt.xvideo && now - (rt.xAt || 0) > 6000) { try { rt.xvideo.removeAttribute('src'); rt.xvideo.load(); } catch (e) {} rt.xvideo = null; }
      if (now - (rt.lastDraw || 0) > 1500 && !rt.xvideo) VIDX.active.delete(rt);
    });
  }, 500);
  // Returns false when a frame is not available yet, so the poster picture shows instead of a blank.
  function paintClip(rt, ctx, W, H, tSec) {
    if (!rt.video) { withRt(rt, function () { draw(ctx, W, H, (tSec / rt.o.secs) % 1, { tAbs: tSec }); }); return true; }
    var now = performance.now(), xv = (rt.xvideo && rt.xAt && now - rt.xAt < 1500) ? rt.xvideo : null, v = xv || rt.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return false;
    if (xv) { try { rt.video.pause(); } catch (e) {} }
    else {
      if (!VIDX.active.has(rt)) {
        var playing = 0; VIDX.active.forEach(function (o) { if (o !== rt && now - (o.lastDraw || 0) < 1200) playing++; });
        if (playing >= 3) return false;   // browser safety: at most 3 clips decode at the same time, the others show their still picture
      }
      rt.lastDraw = now; VIDX.active.add(rt);
      var ent = ENT.get(rt.clip), held = allPaused || (ent && ent.paused);
      if (!held && v.paused) { var pp = v.play(); if (pp && pp.catch) pp.catch(function () {}); }
      var cap = rt.o.secs;   // plays only the first part when the file is longer than the 30 s limit
      if (cap && v.duration && cap < v.duration - 0.05 && v.currentTime >= cap) v.currentTime = 0;
    }
    var vw = v.videoWidth, vh = v.videoHeight, sc = Math.max(W / vw, H / vh), sw = W / sc, sh = H / sc;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, W, H); ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
    return true;
  }
  window.sppLiveFrame = function (clip, ctx, W, H, tSec, noLook) {
    var rt = clipRt(clip); if (!rt.ready || !(rt.cut || rt.video || (rt.gal && rt.gal.length))) return false;
    var look = noLook ? null : clip.look;
    if (!look || (!look.shape && !look.fx)) {
      return paintClip(rt, ctx, W, H, tSec) !== false;
    }
    var A = lookLayer(clip, 'a', W, H), ax = A.getContext('2d');
    lookReset(ax); ax.clearRect(0, 0, W, H);
    if (paintClip(rt, ax, W, H, tSec) === false) return false;
    try { lookCompose(clip, ctx, A, W, H, look); }
    catch (err) { console.warn('[Workspace] live look failed, showing the plain clip', err); lookReset(ctx); ctx.clearRect(0, 0, W, H); ctx.drawImage(A, 0, 0); }
    return true;
  };

  /* Live clips on the page.
     ONE persistent canvas per clip: when the editor re-renders (select, lock, drag, zoom, reorder) the
     same running canvas is moved into the new DOM instead of being rebuilt, so the picture never
     blanks and the clock (rotation phase, text intro) never restarts. Resolution follows the size the
     clip is really shown at, the frame rate adapts to how heavy the clip is, and clips that are
     scrolled off screen or on another page stop drawing. */
  var LIVE = new Set(), liveRaf = 0, ENT = new WeakMap(), liveIO = null;
  /* ═══════════════════ LIVE CLIP REST CONTROLS ═══════════════════
     Keeps the browser calm while editing. Three tools, all in this block:
       1. Auto-rest  clips hold their frame while the person drags, resizes or types.
       2. Pause clip one clip frozen from the LIVE tag on the canvas.
       3. Pause all  one switch for every clip, the thumbnail strip and clips added later.
     A paused clip draws nothing and its clock stands still, so it resumes exactly where it stopped.
     Small hooks elsewhere: liveTick / liveDraw / sppLiveTime / sppLiveMount (paused flag) and the
     thumbnail strip (pdfedThumbLiveResting). */
  var allPaused = false;

  function pauseIcon(playing, px) {
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" style="display:block">' +
      (playing ? '<path d="M7 4l13 8-13 8z"/>' : '<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>') + '</svg>';
  }
  // Presses on our buttons must never start a drag or select something underneath.
  function stopPress(el, extra) {
    ['pointerdown', 'mousedown', 'touchstart'].concat(extra || []).forEach(function (n) { el.addEventListener(n, function (ev) { ev.stopPropagation(); }); });
  }

  /* 1 · Auto-rest */
  var restDown = false, restDownAt = 0, restUntil = 0;
  window.sppLiveIsBusy = function () {
    var n = performance.now();
    return (restDown && n - restDownAt < 10000) || n < restUntil;   // 10s safety net if a pointerup is ever missed
  };
  (function () {
    function hold(ms) { restUntil = performance.now() + ms; }
    function release() { restDown = false; hold(350); }
    document.addEventListener('pointerdown', function () { restDown = true; restDownAt = performance.now(); }, true);
    ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'].forEach(function (n) { document.addEventListener(n, release, true); });
    window.addEventListener('blur', function () { restDown = false; });
    document.addEventListener('keydown', function () { hold(700); }, true);
    document.addEventListener('wheel', function () { hold(300); }, { capture: true, passive: true });
  })();

  /* 2 · Pause one clip (the single place that freezes / unfreezes a clock) */
  function setEntPaused(e, on, now) {
    try { var vr = RT.get(e.clip); if (vr && vr.video) { if (on) vr.video.pause(); else { var pr = vr.video.play(); if (pr && pr.catch) pr.catch(function () {}); } } } catch (x) {}
    if (on && !e.paused) { e.paused = true; e.pausedAt = now; }
    else if (!on && e.paused) { e.t0 += now - e.pausedAt; e.paused = false; e.pausedAt = 0; e.last = 0; }
  }
  window.sppLiveIsPaused = function (clip) { var e = ENT.get(clip); return !!(e && e.paused); };
  window.sppLiveSetPaused = function (clip, on) {
    var e = ENT.get(clip); if (!e) return false;
    on = !!on; setEntPaused(e, on, performance.now());
    if (!on) liveKick();
    return on;
  };

  /* 3 · Pause all */
  window.sppLiveAllPaused = function () { return allPaused; };
  window.sppLivePauseAll = function (on) {
    on = !!on; if (on === allPaused) return allPaused;
    allPaused = on;
    var now = performance.now();
    LIVE.forEach(function (e) { setEntPaused(e, on, now); });
    if (!on) liveKick();
    document.dispatchEvent(new CustomEvent('sppLivePauseChange'));
    return allPaused;
  };

  /* Buttons: the LIVE/PAUSED tag on each clip, and the floating Pause all button */
  window.sppLivePausePill = function (clip) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'spp-pause-pill';
    b.style.cssText = 'position:absolute;left:6px;top:6px;z-index:5;display:flex;align-items:center;gap:4px;padding:1px 7px;border:0;border-radius:8px;font:800 9px/14px system-ui,sans-serif;letter-spacing:.6px;color:#fff;cursor:pointer;pointer-events:auto;';
    b._repaint = function () {
      var on = window.sppLiveIsPaused(clip);
      b.innerHTML = pauseIcon(on, 9) + '<span>' + (on ? 'PAUSED' : 'LIVE') + '</span>';
      b.title = on ? 'Clip is paused so editing stays smooth. Click to play it again.' : 'Live clip. Click to pause it (smoother editing). Double-click the clip to edit it in Showcase.';
      b.style.background = on ? '#f59e0b' : '#e11d48';
    };
    stopPress(b, ['dblclick']);
    b.addEventListener('click', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      window.sppLiveSetPaused(clip, !window.sppLiveIsPaused(clip));
      b._repaint();
    });
    b._repaint();
    return b;
  };
  document.addEventListener('sppLivePauseChange', function () {   // one listener repaints every tag, nothing to leak
    [].forEach.call(document.querySelectorAll('.spp-pause-pill'), function (el) { el._repaint(); });
  });

  (function () {
    var btn = null;
    function paint() {
      if (!btn) return;
      btn.innerHTML = pauseIcon(allPaused, 12) + '<span>' + (allPaused ? 'Play all clips' : 'Pause all clips') + '</span>';
      btn.title = allPaused ? 'All live clips are paused so editing stays smooth. Click to play them again.' : 'Pause every live clip so the browser can rest and editing stays smooth.';
      btn.style.background = allPaused ? '#f59e0b' : 'rgba(17,24,39,.92)';
    }
    function build() {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'sppPauseAllBtn';
      btn.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:800;display:none;align-items:center;gap:7px;padding:8px 15px;border:0;border-radius:999px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.2px;color:#fff;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.35);';
      stopPress(btn);
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); window.sppLivePauseAll(!allPaused); });
      document.body.appendChild(btn);
    }
    // Shown while a live clip is on screen (or while paused, so it can always be switched back on).
    function sync() {
      var any = allPaused;
      LIVE.forEach(function (e) { if (e.c.isConnected && e.c.offsetParent) any = true; });
      if (!any) { if (btn) btn.style.display = 'none'; return; }
      if (!btn) build();
      paint(); btn.style.display = 'flex';
    }
    document.addEventListener('sppLivePauseChange', paint);
    setInterval(function () { if (!document.hidden) sync(); }, 800);
  })();

  // Main-page canvas of a clip once it has drawn real frames (the thumbnail strip copies it instead of re-rendering the clip).
  window.sppLiveMountedCanvas = function (clip) {
    var e = ENT.get(clip); return (e && e.c.isConnected && e.c.width > 1 && e.drew) ? e.c : null;
  };
  /* ═══════════════ end LIVE CLIP REST CONTROLS ═══════════════ */
  function liveSize(clip, longEdge, boxAspect) {
    var p = (clip.dims && clip.dims.p) || PREVIEW[(clip.o && clip.o.ratio)] || PREVIEW['16:9'];
    // The picture is laid out for the shape of the box it is shown in (so Fill page / any resize re-composes
    // the clip instead of stretching it). Falls back to the clip's own shape until the box has a size.
    var a = (boxAspect && isFinite(boxAspect) && boxAspect > 0) ? boxAspect : p[0] / p[1];
    var w = a >= 1 ? longEdge : longEdge * a, h = a >= 1 ? longEdge / a : longEdge;
    return [Math.max(2, Math.round(w)), Math.max(2, Math.round(h))];
  }
  // Layout size of the canvas in its box (ignores rotation and editor zoom, unlike getBoundingClientRect).
  function boxAspectOf(c) { return (c.offsetWidth > 0 && c.offsetHeight > 0) ? c.offsetWidth / c.offsetHeight : 0; }
  function liveKick() { if (!liveRaf) liveRaf = requestAnimationFrame(liveTick); }
  function liveWatch(e) {
    if (!('IntersectionObserver' in window)) return;
    if (!liveIO) liveIO = new IntersectionObserver(function (list) {
      list.forEach(function (r) { var en = r.target._sppLive; if (en) en.vis = r.isIntersecting; });
    }, { rootMargin: '80px' });
    e.c._sppLive = e; liveIO.observe(e.c);
  }
  // Draws one frame. Until the cut-out has decoded, the still poster is shown so the clip is never blank.
  function liveDraw(e, now) {
    var ctx = e.c.getContext('2d'), ok = false, t0 = performance.now();
    try { ok = window.sppLiveFrame(e.clip, ctx, e.c.width, e.c.height, ((e.paused ? e.pausedAt : now) - e.t0) / 1000); }
    catch (err) { console.error('Live clip frame failed', err); }
    if (ok) e.drew = true;
    if (!ok && e.posterUrl) {
      if (!e.poster) { e.poster = new Image(); e.poster.onload = function () { e.posterReady = true; }; e.poster.src = e.posterUrl; }
      if (e.posterReady) { ctx.clearRect(0, 0, e.c.width, e.c.height); ctx.drawImage(e.poster, 0, 0, e.c.width, e.c.height); }
    }
    return performance.now() - t0;
  }
  // Keeps the canvas about as sharp as it is shown (zoom / resize / retina), with hysteresis so it never thrashes.
  function liveFit(e, now) {
    if (now - e.fitAt < 400) return; e.fitAt = now;
    var r = e.c.getBoundingClientRect(); if (!r.width || !r.height) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), ba = boxAspectOf(e.c);
    var want = Math.max(400, Math.min(1280, Math.round(Math.max(r.width, r.height) * dpr / 80) * 80));
    var curA = e.c.width / e.c.height, aspectOff = ba && Math.abs(curA / ba - 1) > 0.01;
    if (!aspectOff && Math.abs(want - e.res) < 160) return;
    var d = liveSize(e.clip, want, ba); e.c.width = d[0]; e.c.height = d[1]; e.res = want;   // redrawn in this same tick, so no blank frame
  }
  function liveTick() {
    liveRaf = 0;
    var now = performance.now(), awake = false;
    LIVE.forEach(function (e) {
      if (e.paused) return;                                        // paused: draws nothing, and does not keep the loop alive
      awake = true;
      if (!e.c.isConnected) {
        // Detached for a moment while the editor re-renders is normal. Gone for good (page changed, item deleted): forget it.
        if (!e.gone) e.gone = now;
        else if (now - e.gone > 1500) { LIVE.delete(e); if (ENT.get(e.clip) === e) ENT.delete(e.clip); if (liveIO) liveIO.unobserve(e.c); }
        return;
      }
      e.gone = 0;
      if (document.hidden || !e.vis || !e.c.offsetParent) return;   // tab hidden, scrolled away, or editor not on screen
      if (window.sppLiveIsBusy()) return;                          // person is editing: keep the last frame, stay off the main thread
      if (now - e.last < e.gap) return; e.last = now;
      liveFit(e, now);
      var cost = liveDraw(e, now);
      e.cost = e.cost * 0.8 + cost * 0.2;
      e.gap = e.cost > 22 ? 66 : (e.cost > 11 ? 40 : (e.cost < 7 ? 15 : e.gap));
      if (e.clip && e.clip.vid && e.gap < 30) e.gap = 30;   // a video only has ~30 new pictures a second: drawing more is wasted work   // full speed when light, ~25 fps medium, ~15 fps heavy
    });
    if (awake) liveKick();   // every clip paused: the loop stops until something resumes
  }
  // Seconds the clip has been running on the page canvas (null if it is not mounted there). The thumbnail strip uses it to play in step.
  window.sppLiveTime = function (clip) {
    var e = ENT.get(clip);
    return (e && e.c && e.c.isConnected) ? ((e.paused ? e.pausedAt : performance.now()) - e.t0) / 1000 : null;
  };
  window.sppLiveCanvas = function (clip) {
    var e = ENT.get(clip);
    return (e && e.c) ? e.c : document.createElement('canvas');
  };
  // Repaint a clip right now (used after its look changes, also while it is paused).
  window.sppLiveRedraw = function (clip) {
    var e = ENT.get(clip); if (!e) return;
    e.last = 0;
    if (e.paused) { try { liveDraw(e, performance.now()); } catch (x) {} }
    liveKick();
  };
  window.sppLiveMount = function (canvas, clip, posterUrl) {
    var e = ENT.get(clip), keepT0 = 0;
    if (e && e.c === canvas) { e.gone = 0; if (posterUrl) e.posterUrl = posterUrl; liveKick(); return; }
    var keepPaused = false, keepPausedAt = 0;
    if (e) { keepT0 = e.t0; keepPaused = !!e.paused; keepPausedAt = e.pausedAt || 0; LIVE.delete(e); }
    var now = performance.now(), d = liveSize(clip, 640, boxAspectOf(canvas));
    canvas.width = d[0]; canvas.height = d[1];
    e = { c: canvas, clip: clip, t0: keepT0 || now, last: 0, gap: 15, cost: 0, res: 640, fitAt: now, vis: true, gone: 0,
          posterUrl: posterUrl || '', poster: null, posterReady: false };
    if (keepPaused) { e.paused = true; e.pausedAt = keepPausedAt; }
    else if (allPaused) { e.paused = true; e.pausedAt = now; }
    ENT.set(clip, e); LIVE.add(e); liveWatch(e);
    liveDraw(e, now);
    liveKick();
  };

  // A multi-photo clip carries every photo (compressed) so it can replay the same reel on the page, in previews and in MP4 export.
  function snapshotGalleryClip() {
    var urls = S.gal.map(function (g) {
      var k = Math.min(1, 1100 / Math.max(g.width, g.height)), c = mk(g.width * k, g.height * k), x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(g, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.86);
    });
    return { v: 1, cut: '', gal: urls, edge: [70, 70, 70], bg: { r: 240, g: 242, b: 246 }, o: JSON.parse(JSON.stringify(S.o)),
      dims: { p: PREVIEW[S.o.ratio].slice(), e: EXPORT[S.o.ratio].slice() } };
  }
  function snapshotClip() {
    if (S.o.fit === 'gallery') return snapshotGalleryClip();
    var cut = S.cut, fill = S.o.fit === 'fill', k = Math.min(1, (fill ? 1400 : 900) / Math.max(cut.width, cut.height)), c = cut;
    if (k < 1) { c = mk(cut.width * k, cut.height * k); var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cut, 0, 0, c.width, c.height); }
    return {
      v: 1, cut: (fill && !S.hasAlpha) ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png'), edge: S.edgeRGB.slice(),
      bg: { r: S.bgColor.r, g: S.bgColor.g, b: S.bgColor.b }, o: JSON.parse(JSON.stringify(S.o)),
      dims: { p: PREVIEW[S.o.ratio].slice(), e: EXPORT[S.o.ratio].slice() }
    };
  }

  // Re-opens a live clip that is already on the page inside Showcase, exactly as it was made (photos + every setting).
  window.sppEditLive = async function (idx, item) {
    var clip = item && item.clip; if (!clip) return;
    if (clip.vid) { toast('This is an uploaded clip. Use the sparkle button to add a shape or filter.', 'info'); return; }
    try {
      window.sppOpen(); S.editTarget = { idx: idx, id: item.id };
      Object.keys(clip.o || {}).forEach(function (k) { if (k in S.o) S.o[k] = clip.o[k]; });
      S.o.xt = (clip.o && clip.o.xt) ? clip.o.xt : [];
      if (clip.gal && clip.gal.length) {
        var list = []; for (var i = 0; i < clip.gal.length; i++) list.push(await spDecode(clip.gal[i]));
        S.gal = list; S.o.fit = 'gallery'; syncUi(); galThumbs();
      } else {
        loadDataUrl(clip.cut, 'Live clip', true, function () { syncUi(); });
        syncUi();
      }
      say('Editing this live clip. Change anything, then press Live clip to update it on the page.', 'info');
    } catch (e) { console.error('Edit live clip failed', e); S.editTarget = null; say('Could not open this live clip for editing.', 'error'); }
  };

  /* ───── Per-image Showcase ─────
     Every image on a page has its own Showcase. Opening it loads THAT image with ITS saved settings; every change
     is saved back onto the image (so it travels with the document and reopens exactly as left). The main Showcase
     session is put aside while this runs and put back on close, so images never mix with each other or with it. */
  var BOUND_KEYS = ['srcNat', 'srcCanvas', 'procCanvas', 'srcName', '_srcUrl', 'cut', 'cutVer', 'spriteKey', 'edgeRGB', 'bgColor', 'hasAlpha', 'gal', 'live', '_userRatio'];
  function boundItem() {
    var t = S.editTarget; if (!t || !t.draft || typeof pdfed === 'undefined' || !pdfed.pages[t.idx]) return null;
    return (pdfed.pages[t.idx].placedImages || []).filter(function (it) { return it.id === t.id; })[0] || null;
  }
  function boundSaveNow() {
    clearTimeout(S._bTimer); S._bTimer = 0;
    var it = boundItem(); if (!it || it.clip) return;
    var lp = $('sppLoops');
    it.showcase = { v: 1, savedAt: Date.now(), o: JSON.parse(JSON.stringify(S.o)), loops: lp ? lp.value : '1' };   // a fresh object each time
    if (typeof pdfedPersist === 'function') pdfedPersist();
  }
  function boundRestore() {
    var pre = S._pre; if (!pre) return; S._pre = null;
    clearTimeout(S.cutTimer); clearTimeout(S._bTimer); S._bTimer = 0;
    Object.keys(pre.o).forEach(function (k) { S.o[k] = pre.o[k]; });
    BOUND_KEYS.forEach(function (k) { S[k] = pre[k]; });
    var lp = $('sppLoops'); if (lp) lp.value = pre.loops;
    S.spriteKey = '';
    try { syncUi(); sizePreview(); updateDimTags(); drawOrig(); galThumbs(); } catch (e) {}
  }
  window.sppEditImage = async function (idx, item) {
    if (!item || !item.dataUrl) return;
    if (item.clip) return window.sppEditLive(idx, item);
    if (S.open || S.recording) return;
    try {
      try { await window.sppFlush(); } catch (e) {}   // keep any unsaved main session safe first
      var pre = { o: JSON.parse(JSON.stringify(S.o)), loops: ($('sppLoops') || {}).value || '1' };
      BOUND_KEYS.forEach(function (k) { pre[k] = S[k]; }); S._pre = pre;
      S.editTarget = { idx: idx, id: item.id, draft: true };
      var d = item.showcase;
      Object.keys(SP_DEFAULTS).forEach(function (k) { S.o[k] = SP_DEFAULTS[k]; });
      if (d && d.o) Object.keys(d.o).forEach(function (k) { if (k in S.o) S.o[k] = d.o[k]; });
      S._userRatio = !!d; S.gal = []; S.live = null;
      var lp = $('sppLoops'); if (lp) lp.value = (d && d.loops) || '1';
      window.sppOpen();
      syncUi();
      loadDataUrl(item.dataUrl, 'Image', true, function () { syncUi(); capLoops(); });
      say(d ? 'Opened this image\'s Showcase with your saved work.' : 'This image has its own Showcase. Changes save with it automatically.', 'info');
    } catch (e) {
      console.error('Image Showcase failed', e); S.editTarget = null; boundRestore(); say('Could not open this image in Showcase.', 'error');
    }
  };

  window.sppPlaceLiveOnPage = async function () {
    if (!hasArt()) { say('Add a photo first', 'info'); return; }
    if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) {
      say('Open or create a page first, then place the live clip on it.', 'info'); return;
    }
    var clip = snapshotClip(), multi = !!clip.gal;
    // Still poster: used anywhere a page is flattened to a picture (thumbnails, previews).
    refreshPageRatio();
    var d = EXPORT[S.o.ratio], k = 800 / Math.max(d[0], d[1]), poster = mk(d[0] * k, d[1] * k);
    draw(poster.getContext('2d'), poster.width, poster.height, S.tNorm, { textT: 1 });
    var url = poster.toDataURL('image/png');
    var tgt = S.editTarget, tItem = null; S.editTarget = null; clearTimeout(S._bTimer); S._bTimer = 0;
    if (tgt && pdfed.pages[tgt.idx]) tItem = (pdfed.pages[tgt.idx].placedImages || []).filter(function (it) { return it.id === tgt.id; })[0] || null;
    var idx = tItem ? tgt.idx : pdfed.active, pg = pdfed.pages[idx], pcv = document.getElementById('pdfedPageCanvas');
    var pw = (pcv && pcv.width) || 800, ph = (pcv && pcv.height) || 1100;
    var f = Math.min(pw / poster.width, ph / poster.height), w = Math.round(poster.width * f), h = Math.round(poster.height * f);
    if (S.o.ratio === 'page') { w = pw; h = ph; }
    if (tItem) {   // update the clip that is already on the page: same spot, same width, same rotation and layer
      var cx = tItem.x + tItem.w / 2, cy = tItem.y + tItem.h / 2, nw = tItem.w, nh = Math.round(nw * poster.height / poster.width);
      if (S.o.ratio === 'page') { nw = pw; nh = ph; cx = pw / 2; cy = ph / 2; }
      delete tItem.showcase; if (tItem.clip && tItem.clip.look) clip.look = JSON.parse(JSON.stringify(tItem.clip.look)); tItem.clip = clip; tItem.dataUrl = url; tItem.w = nw; tItem.h = nh; tItem.x = Math.round(cx - nw / 2); tItem.y = Math.round(cy - nh / 2);
      if (typeof pdfedMarkModified === 'function') pdfedMarkModified(idx);
      if (typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(idx);
      if (clip.look && typeof pdfedLiveRepaintPoster === 'function') pdfedLiveRepaintPoster(tItem);
      sppClose();
      say('Live clip updated on your page.', 'success');
      return;
    }
    pdfedAnnotState.placedImgSeq++;
    (pg.placedImages = pg.placedImages || []).push({
      id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: url, clip: clip,
      x: Math.round((pw - w) / 2), y: Math.round((ph - h) / 2), w: w, h: h, locked: false, zIndex: pdfedNextZ(pg), kind: 'image'
    });
    if (typeof pdfedMarkModified === 'function') pdfedMarkModified(idx);
    if (typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(idx);
    sppClose();
    say((multi ? 'Live reel placed (' + clip.gal.length + ' photos). ' : 'Live clip placed. ') + 'It keeps playing on the page and in the slideshow preview. Download this document as an MP4 presentation (Export, Slideshow Clip).', 'success');
  };

  /* ───── UPLOAD A VIDEO CLIP ─────
     The ORIGINAL video is kept (nothing is re-sampled), so the page, the slideshow preview and the MP4 export all
     show it at full quality and full smoothness. Size control: file up to 30 MB, and only the first 30 seconds play
     (same as the export limit). The file is stored on this device next to the document, and the clip on the page
     only carries a small reference to it, so autosave, undo and duplicate stay fast. */
  var CLIP_UP = { maxBytes: 30 * 1024 * 1024, maxSecs: 30, maxPerPage: 3, maxTotalBytes: 90 * 1024 * 1024 };
  // Browser safety: how many uploaded clips this document already holds (all pages) and how heavy they are together.
  function clipUsage(pageIdx) {
    var n = 0, bytes = 0, seen = {};
    (pdfed.pages || []).forEach(function (pg, i) { ((pg && pg.placedImages) || []).forEach(function (it) { if (it && it.clip && it.clip.vid) { if (i === pageIdx) n++; if (!seen[it.clip.vid.id]) { seen[it.clip.vid.id] = 1; bytes += it.clip.vid.bytes || 0; } } }); });
    return { onPage: n, bytes: bytes };
  }
  window.pdfedTriggerClipInsert = function () { var i = document.getElementById('pdfedClipInsertInput'); if (i) i.click(); };
  window.pdfedLoadInsertClip = async function (e) {
    var file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
    if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) { toast('Open or create a page first, then add the clip to it', 'info'); return; }
    if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) { toast('Please pick a video file (MP4, WebM or MOV)', 'error'); return; }
    if (file.size > CLIP_UP.maxBytes) { toast('That clip is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is 30 MB, so please trim or compress it first', 'error'); return; }
    var use = clipUsage(pdfed.active);
    if (use.onPage >= CLIP_UP.maxPerPage) { toast('This page already has ' + CLIP_UP.maxPerPage + ' video clips. Please remove one or use another page, so the browser stays smooth', 'error'); return; }
    if (use.bytes + file.size > CLIP_UP.maxTotalBytes) { toast('This document already holds ' + (use.bytes / 1048576).toFixed(0) + ' MB of clips. The total limit is 90 MB, so please remove one first', 'error'); return; }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var q = await navigator.storage.estimate();
        if (q && q.quota && (q.quota - (q.usage || 0)) < file.size * 2.5) { toast('This browser is almost out of storage space for this clip. Free some space and try again', 'error'); return; }
      }
    } catch (qe) {}
    var url = URL.createObjectURL(file);
    try {
      toast('Reading your clip, one moment', 'info');
      var v = await makeVideo(url); if (!v) throw new Error('decode');
      var dur = v.duration, vw = v.videoWidth, vh = v.videoHeight;
      if (!isFinite(dur) || dur <= 0 || !vw || !vh) throw new Error('decode');
      // Poster: a still picture of the clip, used for thumbnails and anywhere a page is flattened.
      await new Promise(function (res) { var d = false, f = function () { if (!d) { d = true; res(); } }; v.addEventListener('seeked', f); setTimeout(f, 3000); v.currentTime = Math.min(0.3, dur / 3); });
      var pk = Math.min(1, 800 / Math.max(vw, vh)), pc = document.createElement('canvas'); pc.width = Math.max(2, Math.round(vw * pk)); pc.height = Math.max(2, Math.round(vh * pk));
      pc.getContext('2d').drawImage(v, 0, 0, pc.width, pc.height);
      var poster = pc.toDataURL('image/jpeg', 0.86);
      var id = 'vid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), stored = true;
      VIDX.blobs.set(id, file);
      try { await vidPut(id, file); } catch (se) { stored = false; console.warn('[Workspace] could not store the clip file', se); }
      var clip = { v: 1, cut: '', vid: { id: id, name: file.name, w: vw, h: vh, dur: dur, bytes: file.size }, edge: [70, 70, 70], bg: { r: 240, g: 242, b: 246 },
        o: { secs: Math.min(dur, CLIP_UP.maxSecs), ratio: '16:9' }, dims: { p: [vw, vh], e: [vw, vh] } };
      var idx = pdfed.active, pg = pdfed.pages[idx], pcv = document.getElementById('pdfedPageCanvas');
      var pw = (pcv && pcv.width) || 800, ph = (pcv && pcv.height) || 1100, ar = vw / vh;
      var w = Math.round(Math.min(pw * 0.8, ph * 0.8 * ar)), h = Math.round(w / ar);
      pdfedAnnotState.placedImgSeq++;
      (pg.placedImages = pg.placedImages || []).push({ id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: poster, clip: clip,
        x: Math.round((pw - w) / 2), y: Math.round((ph - h) / 2), w: w, h: h, locked: false, zIndex: pdfedNextZ(pg), kind: 'image' });
      if (typeof pdfedMarkModified === 'function') pdfedMarkModified(idx);
      if (typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(idx);
      toast((dur > CLIP_UP.maxSecs ? 'Clip added. Only the first 30 seconds are used (limit). ' : 'Clip added. ') + (stored ? 'It plays at full quality and exports in the MP4 slideshow.' : 'It plays now, but this browser could not keep the file, so it may not survive a reload.'), stored ? 'success' : 'info');
    } catch (err) {
      console.error('Clip upload failed', err);
      toast('Could not read that video. Try an MP4 (H.264) or WebM file.', 'error');
    } finally { URL.revokeObjectURL(url); }
  };

  ['sppPlaceOnPage', 'sppPlaceLiveOnPage'].forEach(function (name) {
    var f = window[name];
    window[name] = async function () {
      try { return await f.apply(this, arguments); }
      catch (e) { console.error('Showcase ' + name + ' failed', e); say('Could not place it on the page. Please try again.', 'error'); }
    };
  });


  /* ---------------------------------------------------------------------
     AUTOSAVE + RESUME (local IndexedDB, mirrored to the user's own Drive)
     Whatever is set in Showcase (photo + every setting) is saved a moment
     after each change, restored the next time Showcase opens, and mirrored
     to one small file in Drive ("SARVARC Showcase" folder) so it follows the
     signed-in account to other devices. Newest copy wins, in both directions.
     Account-only, like the rest of saving. Any failure is swallowed so it
     can never get in the way of using Showcase.
     --------------------------------------------------------------------- */
  var PKEY = 'sarvarcShowcaseState_v1';
  var DRIVE_FILE = 'showcase-state.json';
  var DRIVE_SUBFOLDER = 'SARVARC Showcase';
  var P = { timer: 0, upTimer: 0, dirty: false, restoring: false, hydrated: false, syncing: false, upBusy: false, fileId: null, folderId: null };

  async function isSignedIn() {
    try { return typeof sarvarcIsSignedIn === 'function' ? !!(await sarvarcIsSignedIn()) : false; } catch (e) { return false; }
  }
  async function driveOn() {
    try { return (await isSignedIn()) && typeof sarvarcDriveAvailable === 'function' && !!(await sarvarcDriveAvailable()); } catch (e) { return false; }
  }
  function srcUrl() {
    if (S._srcUrl) return S._srcUrl;
    if (!S.srcCanvas) return null;
    // Opaque photos save as high-quality JPEG (a lossless PNG at full size can run to many MB);
    // photos with transparency stay PNG, falling back to the light copy if that is still enormous.
    if (S.hasAlpha) {
      S._srcUrl = S.srcCanvas.toDataURL('image/png');
      if (S._srcUrl.length > 8e6 && S.procCanvas) S._srcUrl = S.procCanvas.toDataURL('image/png');
    } else S._srcUrl = S.srcCanvas.toDataURL('image/jpeg', 0.95);
    return S._srcUrl;
  }
  function buildState() {
    var lp = $('sppLoops');
    return { v: 1, savedAt: Date.now(), o: JSON.parse(JSON.stringify(S.o)), srcName: S.srcName || '', src: S.srcCanvas ? srcUrl() : null, loops: lp ? lp.value : '1' };
  }

  async function persistLocal() {
    P.timer = 0;
    if (!(await isSignedIn())) return null;
    var st = buildState();
    await idbKvSet(PKEY, st);
    P.dirty = false;
    return st;
  }
  window.sppSaveSoon = function () {
    if (P.restoring) return;
    if (S.editTarget && S.editTarget.draft) { clearTimeout(S._bTimer); S._bTimer = setTimeout(boundSaveNow, 600); return; }
    P.dirty = true;
    clearTimeout(P.timer);
    P.timer = setTimeout(function () {
      persistLocal().then(function (st) { if (st) queueUp(); }).catch(function (e) { console.warn('[Showcase] autosave failed', e); });
    }, 1000);
  };
  function queueUp() { clearTimeout(P.upTimer); P.upTimer = setTimeout(function () { pushToDrive(); }, 4000); }
  window.sppFlush = async function () {
    clearTimeout(P.timer);
    if (!P.dirty) return;
    try { var st = await persistLocal(); if (st) { clearTimeout(P.upTimer); await pushToDrive(st); } } catch (e) {}
  };

  async function ensureSubfolder() {
    if (P.folderId) return P.folderId;
    var parentId = await sarvarcDriveEnsureFolder();
    var q = encodeURIComponent("name='" + DRIVE_SUBFOLDER + "' and mimeType='application/vnd.google-apps.folder' and '" + parentId + "' in parents and trashed=false");
    var r = await sarvarcDriveFetch('files?q=' + q + '&fields=files(id,name)&spaces=drive');
    var d = await r.json();
    if (d.files && d.files.length) { P.folderId = d.files[0].id; return P.folderId; }
    var token = await sarvarcDriveGetToken();
    var c = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_SUBFOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!c.ok) throw new Error('SPP_FOLDER_' + c.status);
    P.folderId = (await c.json()).id;
    return P.folderId;
  }
  async function findRemote() {
    var folder = await ensureSubfolder();
    var q = encodeURIComponent("name='" + DRIVE_FILE + "' and '" + folder + "' in parents and trashed=false");
    var r = await sarvarcDriveFetch('files?q=' + q + '&fields=files(id,appProperties,modifiedTime)&orderBy=modifiedTime%20desc&spaces=drive');
    var d = await r.json();
    return (d.files && d.files[0]) || null;
  }
  async function uploadState(st, retried) {
    var token = await sarvarcDriveGetToken(); if (!token) throw new Error('NO_DRIVE_TOKEN');
    var folder = await ensureSubfolder();
    if (!P.fileId) { var f = await findRemote(); if (f) P.fileId = f.id; }
    var isUpdate = !!P.fileId, props = { sppSavedAt: String(st.savedAt) };
    var meta = isUpdate ? { appProperties: props } : { name: DRIVE_FILE, parents: [folder], appProperties: props };
    var start = await fetch('https://www.googleapis.com/upload/drive/v3/files' + (isUpdate ? '/' + P.fileId : '') + '?uploadType=resumable', {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    });
    if (start.status === 404 && isUpdate && !retried) { P.fileId = null; return uploadState(st, true); }   // file deleted in Drive: recreate
    if (!start.ok) throw new Error('SPP_UP_START_' + start.status);
    var loc = start.headers.get('Location'); if (!loc) throw new Error('SPP_UP_NO_URL');
    var put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) });
    if (!put.ok) throw new Error('SPP_UP_' + put.status);
    P.fileId = (await put.json()).id;
  }
  async function pushToDrive(st) {
    if (P.upBusy) { queueUp(); return; }
    P.upBusy = true;
    try {
      if (!(await driveOn())) return;
      st = st || await idbKvGet(PKEY);
      if (st) await uploadState(st);
    } catch (e) { console.warn('[Showcase] Drive upload skipped (will retry on next sync)', e); }
    finally { P.upBusy = false; }
  }

  // Push every saved setting back into the panel controls, then reload the photo.
  function syncUi() {
    var o = S.o;
    function val(id, v) { var e = $(id); if (e && v != null) e.value = v; }
    function chk(id, v) { var e = $(id); if (e) e.checked = !!v; }
    function lab(id, v) { var e = $(id); if (e) e.textContent = v; }
    chk('sppCutout', o.cutout); chk('sppShadow', o.shadow); chk('sppReflect', o.reflect); chk('sppFillGrad', o.fillGrad); chk('sppTxtAuto', o.txtAuto);
    [['sppTol', 'tol', 'sppTolV'], ['sppTrim', 'trim', 'sppTrimV'], ['sppSoft', 'soft', 'sppSoftV'], ['sppSecs', 'secs', 'sppSecsV'],
     ['sppAmp', 'amp', 'sppAmpV'], ['sppThick', 'thick', 'sppThickV'], ['sppSize', 'size', 'sppSizeV'], ['sppTxtSize', 'txtSize', 'sppTxtSizeV']]
      .forEach(function (r) { val(r[0], o[r[1]]); lab(r[2], o[r[1]]); });
    val('sppBack', o.back); val('sppFillA', o.fillA); val('sppFillB', o.fillB); val('sppHead', o.head); val('sppSubl', o.sub); val('sppBadge', o.badge);
    val('sppTxtPos', o.txtPos); val('sppFont', o.font); val('sppTxtCol', o.txtCol); val('sppAccent', o.accent); val('sppTxtAnim', o.txtAnim); val('sppTxtOut', o.txtOut); val('sppEng', o.eng); val('sppTxtLive', o.txtLive); val('sppEngText', o.engText); syncFontBtn(); if (o.fontName) fontKick(o.fontName); val('sppScrim', o.scrim); lab('sppScrimV', o.scrim);
    if ($('sppCutBox')) $('sppCutBox').style.opacity = o.cutout ? 1 : .35;
    if ($('sppFillBRow')) $('sppFillBRow').style.display = o.fillGrad ? '' : 'none';
    if ($('sppTxtColRow')) $('sppTxtColRow').style.display = o.txtAuto ? 'none' : '';
    [['motion', 'sppMotionSeg'], ['dir', 'sppDirSeg'], ['bgMode', 'sppBgSeg'], ['ratio', 'sppRatioSeg'], ['fit', 'sppFitSeg'], ['fmotion', 'sppFMotionSeg'], ['txtAlign', 'sppAlignSeg'], ['gal', 'sppGalSeg'], ['cutStyle', 'sppCutStyleSeg'], ['fxCol', 'sppFxColSeg']].forEach(function (p) {
      var seg = $(p[1]); if (!seg) return;
      var btn = seg.querySelector('[data-v="' + o[p[0]] + '"]');
      if (btn) window.sppSetSeg(p[0], o[p[0]], btn);
    });
    S.t0 = performance.now() - S.tNorm * S.o.secs * 1000;
    paintRanges();
    try { xtRender(); } catch (e) { console.error('Showcase texts panel failed', e); }
  }
  function applyState(st) {
    if (!st || !st.o) return;
    P.restoring = true;
    try {
      Object.keys(st.o).forEach(function (k) { if (k in S.o) S.o[k] = st.o[k]; });
      syncUi();
      if (st.loops && $('sppLoops')) $('sppLoops').value = st.loops;
      if (st.src) loadDataUrl(st.src, st.srcName, true);
      P.dirty = false;
    } finally { P.restoring = false; }
  }

  // Resume + sync. mode 'boot' only reconciles storage (no UI work) so a device
  // catches up in the background without paying for the cutout until Showcase opens.
  window.sppSync = async function (mode) {
    if (P.syncing) return;
    P.syncing = true;
    try {
      if (!(await isSignedIn())) return;
      var ui = mode !== 'boot';
      var local = await idbKvGet(PKEY);
      var bound = !!(S.editTarget && S.editTarget.draft);
      if (ui && !P.hydrated && local && !bound) applyState(local);
      if (ui && !bound) P.hydrated = true;
      if (!(await driveOn())) return;
      var meta = await findRemote();
      if (meta) P.fileId = meta.id;
      var rT = meta ? (Number(meta.appProperties && meta.appProperties.sppSavedAt) || Date.parse(meta.modifiedTime) || 0) : 0;
      var lT = (local && local.savedAt) || 0;
      if (meta && rT > lT + 500 && !P.dirty) {
        var res = await sarvarcDriveFetch('files/' + meta.id + '?alt=media');
        var st = await res.json();
        if (st && st.v === 1 && st.o) {
          await idbKvSet(PKEY, st);
          if (ui && !(S.editTarget && S.editTarget.draft)) { applyState(st); say('Showcase restored from your account', 'success'); }
        }
      } else if (local && lT > rT + 500) {
        await pushToDrive(local);       // local is newer (e.g. an earlier upload never landed): catch Drive up
      }
    } catch (e) { console.warn('[Showcase] sync skipped', e); }
    finally { P.syncing = false; }
  };

  // Every change funnels through these two, so wrapping them covers all controls.
  ['sppSet', 'sppSetSeg'].forEach(function (n) {
    var f = window[n];
    window[n] = function () { var r = f.apply(this, arguments); try { window.sppSaveSoon(); } catch (e) {} return r; };
  });
  // More texts: the panel follows the layout, the photos and the loop length (its time labels are in seconds)
  ['sppSet', 'sppSetSeg'].forEach(function (n) {
    var f = window[n];
    window[n] = function (k) { var r = f.apply(this, arguments); if (k === 'secs' || k === 'fit' || k === 'gal' || k === 'txtOut') { try { xtRender(); } catch (e) {} } return r; };
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (window.sppFlush) window.sppFlush(); }
    else if (S.open && window.sppSync) window.sppSync('visible');
  });
  window.addEventListener('online', function () { if (window.sppSync) window.sppSync(S.open ? 'online' : 'boot'); });
  setTimeout(function () { if (window.sppSync) window.sppSync('boot'); }, 7000);
  (function () { var lp = $('sppLoops'); if (lp) lp.addEventListener('change', function () { window.sppSaveSoon(); }); })();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dropSetup); else dropSetup();

  /* ───────────────────────── KADESSA: hands-on control ─────────────────────────
     A small, validated API so Kadessa can drive every Showcase control the way a person does.
     Everything goes through the same state (S.o) and the same panel sync as a manual edit, so
     the panel always shows what she did, and autosave and undo behave normally. */
  var SP_ALIAS = {
    ratio: { story: '9:16', reel: '9:16', vertical: '9:16', square: '1:1', portrait: '4:5', wide: '16:9', widescreen: '16:9', landscape: '16:9' },
    fit: { cutout: 'product', photo: 'fill', full: 'fill', edge: 'fill' },
    dir: { clockwise: 1, cw: 1, counter: -1, counterclockwise: -1, ccw: -1, anticlockwise: -1 }
  };
  var SP_SPEC = {
    fit: { t: 'enum', v: ['product', 'fill', 'gallery'], alias: SP_ALIAS.fit }, gal: { t: 'enum', v: ['slideshow', 'collage', 'spotlight', 'coverflow', 'cuts', 'panels', 'polaroid', 'bento', 'film', 'focus', 'brand', 'aura', 'chilldrop', 'fastcuts'] }, cutStyle: { t: 'enum', v: ['hype', 'accel', 'flash', 'whip', 'beat', 'crash', 'slam', 'glitch', 'pop', 'zthru', 'spin'] }, fxCol: { t: 'enum', v: ['white', 'auto', 'brand', 'off'], alias: { none: 'off', clean: 'off', neutral: 'white', photo: 'auto', accent: 'brand' } },
    cutout: { t: 'bool' }, tol: { t: 'num', min: 6, max: 120 }, trim: { t: 'num', min: 0, max: 4 }, soft: { t: 'num', min: 0, max: 4 },
    motion: { t: 'enum', v: ['turntable', 'sway', 'wrap', 'hover', 'chilldrop', 'glint', 'carousel', 'slice', 'bounce', 'echo', 'pulse', 'levitate', 'pop', 'orbit', 'swing', 'roll', 'acrobat', 'breakdance', 'spinin', 'tumble', 'hero', 'assemble', 'shatter', 'dust', 'blinds', 'scan', 'warp', 'snap', 'flip', 'ripple', 'pixel', 'glitch', 'waterfall'] },
    fmotion: { t: 'enum', v: ['still', 'zoomin', 'zoomout', 'pan', 'drift', 'kenburns', 'chilldrop', 'beat', 'shine', 'whip', 'assemble', 'shutter', 'iris', 'cinema', 'warp', 'snap', 'flip', 'ripple', 'pixel', 'glitch', 'waterfall'] },
    secs: { t: 'num', min: 2, max: 30, step: 0.5 }, dir: { t: 'enum', v: [1, -1], alias: SP_ALIAS.dir },
    amp: { t: 'num', min: 10, max: 70 }, size: { t: 'num', min: 50, max: 120 }, thick: { t: 'num', min: 0, max: 16 },
    back: { t: 'enum', v: ['plain', 'mirror'] }, shadow: { t: 'bool' }, reflect: { t: 'bool' },
    bgMode: { t: 'enum', v: ['empty', 'matched', 'filled'] }, fillA: { t: 'color' }, fillB: { t: 'color' }, fillGrad: { t: 'bool' },
    head: { t: 'text', max: 120 }, sub: { t: 'text', max: 160 }, badge: { t: 'text', max: 24 },
    txtPos: { t: 'enum', v: ['bottom', 'top', 'left', 'right'] }, txtAlign: { t: 'enum', v: ['center', 'left', 'right'] },
    scrim: { t: 'num', min: 0, max: 100 }, font: { t: 'enum', v: ['clean', 'serif', 'bold', 'mono'] },
    txtSize: { t: 'num', min: 60, max: 150 }, txtAuto: { t: 'bool' }, txtCol: { t: 'color' }, accent: { t: 'color' },
    txtAnim: { t: 'enum', v: ['match', 'rise', 'fade', 'none', 'mask', 'track', 'focus', 'cascade', 'flip', 'assemble', 'warp', 'snap', 'glitch', 'decode', 'type', 'pop', 'shine', 'iris', 'beat', 'caret', 'marker', 'pointer'] }, fontName: { t: 'text', max: 60 }, txtOut: { t: 'enum', v: ['auto', 'fade', 'rise', 'stay'] }, txtLive: { t: 'enum', v: ['none', 'zigzag', 'wave', 'float', 'orbit', 'swing', 'jelly', 'blink', 'shimmer'] }, eng: { t: 'enum', v: ['none', 'tap', 'swipe', 'like', 'hearts', 'comment'] }, engText: { t: 'text', max: 60 },
    ratio: { t: 'enum', v: ['page', '16:9', '1:1', '4:5', '9:16'], alias: SP_ALIAS.ratio }
  };
  var SP_DEFAULTS = JSON.parse(JSON.stringify(S.o));
  function spHex(v) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v == null ? '' : v).trim()); if (!m) return null;
    var h = m[1].toLowerCase(); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }
  function spToHex(r, g, b) { return '#' + [r, g, b].map(function (n) { var x = clamp(Math.round(n), 0, 255).toString(16); return x.length < 2 ? '0' + x : x; }).join(''); }
  function spBool(v) {
    if (v === true || v === false) return v;
    var t = String(v).toLowerCase().trim();
    if (t === 'true' || t === 'on' || t === 'yes' || t === '1') return true;
    if (t === 'false' || t === 'off' || t === 'no' || t === '0') return false;
    return null;
  }
  function spCoerce(sp, v) {
    if (sp.t === 'bool') { var b = spBool(v); return b === null ? { err: 'expected true or false' } : { v: b }; }
    if (sp.t === 'color') { var c = spHex(v); return c ? { v: c } : { err: 'expected a hex colour like #1f4e8c' }; }
    if (sp.t === 'text') return { v: String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, sp.max) };
    if (sp.t === 'enum') {
      var s = String(v).toLowerCase().trim();
      if (sp.alias && sp.alias[s] !== undefined) s = sp.alias[s];
      for (var i = 0; i < sp.v.length; i++) if (String(sp.v[i]) === String(s)) return { v: sp.v[i] };
      return { err: 'use one of ' + sp.v.join(', ') };
    }
    var n = Number(v); if (!isFinite(n)) return { err: 'expected a number' };
    n = clamp(n, sp.min, sp.max);
    return { v: sp.step ? Math.round(n / sp.step) * sp.step : Math.round(n) };
  }
  function spSnap() { var lp = $('sppLoops'); return { o: JSON.parse(JSON.stringify(S.o)), loops: lp ? lp.value : '1' }; }
  function spRestore(snap) {
    Object.keys(snap.o).forEach(function (k) { S.o[k] = snap.o[k]; });
    var lp = $('sppLoops'); if (lp) lp.value = snap.loops;
    syncUi(); S.spriteKey = ''; scheduleCut(0); sizePreview(); updateDimTags();
    try { window.sppSaveSoon(); } catch (e) {}
  }
  // Applies any mix of settings in one go. Unknown or invalid ones are skipped and reported, never guessed at.
  function spConfigure(patch) {
    var applied = {}, skipped = [];
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'loops') { applied.loops = Math.round(clamp(Number(patch[k]) || 1, 1, 3)); return; }
      var sp = SP_SPEC[k];
      if (!sp) { skipped.push(k + ' is not a Showcase setting'); return; }
      var r = spCoerce(sp, patch[k]);
      if (r.err) skipped.push(k + ': ' + r.err); else applied[k] = r.v;
    });
    var keys = Object.keys(applied);
    keys.forEach(function (k) {
      if (k === 'loops') { var lp = $('sppLoops'); if (lp) lp.value = String(applied[k]); } else S.o[k] = applied[k];
    });
    if (keys.length) {
      if ('ratio' in applied) S._userRatio = true;
      syncUi();
      if ('thick' in applied || 'size' in applied) S.spriteKey = '';
      if ('cutout' in applied || 'tol' in applied || 'trim' in applied || 'soft' in applied) scheduleCut(0);
      updateDimTags();
      try { window.sppSaveSoon(); } catch (e) {}
    }
    return { applied: applied, skipped: skipped };
  }
  function spFlushCut() {   // build the cutout now (instead of after the slider debounce) so exports use the latest settings
    clearTimeout(S.cutTimer);
    if (!S.srcCanvas) return;
    try { rebuildCut(); } catch (e) { console.error('Showcase cutout failed', e); throw new Error('the cutout failed. Try a lower tolerance, or turn Remove background off'); }
  }
  function spLoad(spec) {
    return new Promise(function (resolve, reject) {
      var url = spec.dataUrl, name = spec.name;
      if (!url) {
        if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) { reject(new Error('there is no open page to take a photo from. Attach a photo in chat instead')); return; }
        var list = (pdfed.pages[pdfed.active].placedImages || []).filter(function (it) { return it && it.dataUrl; });
        if (!list.length) { reject(new Error('there is no image on this page yet. Attach a photo in chat, or place one first')); return; }
        var w = spec.which, pick = null;
        if (typeof w === 'number' || /^\d+$/.test(String(w || ''))) {
          pick = list[Number(w) - 1];
          if (!pick) { reject(new Error('this page has only ' + list.length + ' image' + (list.length === 1 ? '' : 's'))); return; }
        } else if (w === 'first') pick = list[0];
        else {
          if (w !== 'last' && typeof pdfedSelectedImgs !== 'undefined' && pdfedSelectedImgs.size) list.forEach(function (it) { if (pdfedSelectedImgs.has(it.id)) pick = it; });
          if (!pick) pick = list[list.length - 1];
        }
        url = pick.dataUrl; name = 'Page image';
      }
      loadDataUrl(url, name, false, function (err) { if (err) reject(err); else resolve(); });
    });
  }
  // Brightness of each edge band of the photo (0 dark to 1 light) so she can pick where words will read.
  function spBands() {
    var c = S.srcCanvas; if (!c || S.hasAlpha) return null;
    if (c._spBands) return c._spBands;
    var sm = mk(8, 8), sx = sm.getContext('2d'); sx.drawImage(c, 0, 0, 8, 8);
    var d = sx.getImageData(0, 0, 8, 8).data, t = { top: [0, 0], bottom: [0, 0], left: [0, 0], right: [0, 0] }, R = 0, G = 0, B = 0;
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      var i = (y * 8 + x) * 4, l = lum({ r: d[i], g: d[i + 1], b: d[i + 2] }); R += d[i]; G += d[i + 1]; B += d[i + 2];
      if (y < 3) { t.top[0] += l; t.top[1]++; } if (y > 4) { t.bottom[0] += l; t.bottom[1]++; }
      if (x < 3) { t.left[0] += l; t.left[1]++; } if (x > 4) { t.right[0] += l; t.right[1]++; }
    }
    var r2 = function (a) { return Math.round(a[0] / a[1] * 100) / 100; };
    return (c._spBands = { top: r2(t.top), bottom: r2(t.bottom), left: r2(t.left), right: r2(t.right), avgColor: spToHex(R / 64, G / 64, B / 64) });
  }
  // What she sees each turn while Showcase is open: the settings, the photo, and what the photo suggests.
  function spContext() {
    var o = S.o, lp = $('sppLoops'), e = EXPORT[o.ratio] || EXPORT['16:9'], sc = S.srcCanvas, ctx = {
      activePanel: 'Showcase', showcaseHands: true, showcaseOpen: !!S.open, hasPhoto: !!sc || S.gal.length > 0,
      gallery: { count: S.gal.length, max: GAL_MAX, layout: S.o.gal, active: S.o.fit === 'gallery' }, settings: JSON.parse(JSON.stringify(o)),
      loops: lp ? +lp.value : 1, exportSize: [e[0], e[1]], playing: !!S.playing, position: Math.round(S.tNorm * 100) / 100,
      compareOn: !!($('sppWrapRel') && $('sppWrapRel').classList.contains('cmp')), busy: !!S.busy || !!S.recording, recording: !!S.recording
    };
    ctx.texts = { max: XT_MAX, count: (o.xt || []).length, note: 'n is the number among the extra texts (n 1 is shown as text 2 in the panel). photo is 1-based. from and to are fractions of the loop.', items: (o.xt || []).map(function (t, i) {
      var r = { n: i + 1, head: t.head || '', sub: t.sub || '', badge: t.badge || '', when: t.when || 'all', pos: t.pos || '' };
      if (t.when === 'photo') r.photo = (+t.photo || 0) + 1; if (t.when === 'time') { r.from = +t.a || 0; r.to = t.b == null ? 1 : +t.b; }
      return r; }) };
    try {
      var pg = (typeof pdfed !== 'undefined' && pdfed.active >= 0) ? pdfed.pages[pdfed.active] : null;
      ctx.pageOpen = !!pg; ctx.imagesOnPage = pg ? (pg.placedImages || []).filter(function (it) { return it && it.dataUrl; }).length : 0;
    } catch (er) { ctx.pageOpen = false; ctx.imagesOnPage = 0; }
    if (sc) {
      var nat = S.srcNat || [sc.width, sc.height], b = spBands(), bg = S.bgColor || { r: 240, g: 242, b: 246 };
      ctx.photo = {
        name: S.srcName || '', originalSize: nat, workingSize: [sc.width, sc.height], hasTransparency: !!S.hasAlpha,
        orientation: sc.width > sc.height * 1.05 ? 'landscape' : (sc.height > sc.width * 1.05 ? 'portrait' : 'square'),
        backgroundColor: spToHex(bg.r, bg.g, bg.b), backgroundBusyScore: Math.round(S.bgSpread || 0),
        backgroundLooksBusy: !S.hasAlpha && (S.bgSpread || 0) > 38,
        edgeBrightness: b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null, averageColor: b ? b.avgColor : null,
        cutoutReady: !!S.cut, fillModeSharpness: {}
      };
      Object.keys(EXPORT).forEach(function (r) {   // will the photo have enough pixels for each export size?
        var d = EXPORT[r], up = Math.max(d[0] / sc.width, d[1] / sc.height) * 1.12;
        ctx.photo.fillModeSharpness[r] = up <= 1.02 ? 'sharp' : 'upscaled x' + up.toFixed(1);
      });
    }
    return ctx;
  }
  /* build 281: Kadessa's hands on multi-photo and on motions */
  function spDecode(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        try {
          var k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), c = mk(im.naturalWidth * k, im.naturalHeight * k), x = c.getContext('2d');
          x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height); resolve(c);
        } catch (er) { reject(new Error('a photo is too large for this browser')); }
      };
      im.onerror = function () { reject(new Error('a photo could not be opened')); };
      im.src = url;
    });
  }
  async function spLoadMany(urls, mode) {
    if (mode !== 'add') S.gal = [];
    var use = urls.slice(0, Math.max(0, GAL_MAX - S.gal.length)), cs = [];
    for (var i = 0; i < use.length; i++) cs.push(await spDecode(use[i]));
    cs.forEach(function (c) { S.gal.push(c); });
    if (S.o.fit !== 'gallery') window.sppSetSeg('fit', 'gallery', $('sppFitSeg').querySelector('[data-v="gallery"]'));
    galThumbs();
    if (S.o.gal !== 'collage' && S.o.gal !== 'polaroid' && S.o.gal !== 'bento' && S.o.gal !== 'fastcuts') { var v = clamp(Math.round(S.gal.length * (S.o.gal === 'chilldrop' ? 7 : 2.5) * 2) / 2, 6, 30); window.sppSet('secs', v); if ($('sppSecs')) { $('sppSecs').value = v; paintRanges(); } }
    return { added: cs.length, dropped: urls.length - use.length, total: S.gal.length };
  }
  function spPageImages(w) {
    if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages[pdfed.active]) throw new Error('there is no open page to take photos from. Attach photos in chat instead');
    var list = (pdfed.pages[pdfed.active].placedImages || []).filter(function (it) { return it && it.dataUrl; });
    if (!list.length) throw new Error('there is no image on this page yet. Attach photos in chat, or place some first');
    if (Array.isArray(w)) { var sel = w.map(function (n) { return list[Number(n) - 1]; }).filter(Boolean); if (sel.length) list = sel; }
    else if (w === 'selected' && typeof pdfedSelectedImgs !== 'undefined' && pdfedSelectedImgs.size) { var s2 = list.filter(function (it) { return pdfedSelectedImgs.has(it.id); }); if (s2.length) list = s2; }
    return list.map(function (it) { return it.dataUrl; });
  }
  function spGalEdit(g) {
    g = g || {}; var did = [];
    if (g.clear) { S.gal = []; did.push('cleared the photos'); }
    else {
      if (Array.isArray(g.remove)) {
        var rm = g.remove.map(Number); var n0 = S.gal.length;
        S.gal = S.gal.filter(function (c, i) { return rm.indexOf(i + 1) === -1; });
        if (S.gal.length !== n0) did.push('removed ' + (n0 - S.gal.length) + ' photo' + (n0 - S.gal.length === 1 ? '' : 's'));
      }
      if (g.move) {
        var f = Number(g.move.from) - 1, t = Number(g.move.to) - 1;
        if (f >= 0 && t >= 0 && f < S.gal.length && t < S.gal.length && f !== t) { S.gal.splice(t, 0, S.gal.splice(f, 1)[0]); did.push('moved photo ' + (f + 1) + ' to position ' + (t + 1)); }
      }
      if (g.reverse && S.gal.length > 1) { S.gal.reverse(); did.push('reversed the order'); }
      if (g.smart && S.gal.length >= 3) { window.sppGalSmartOrder(); did.push('put the photos in a smooth colour order, with photo 1 first'); }
    }
    galThumbs(); return did;
  }
  var tourTok = 0;
  // Plays a list of motions one after another in the preview so the person can SEE them, then leaves the last one on.
  function spTour(list, each) {
    var o = S.o, key = o.fit === 'gallery' ? 'gal' : (o.fit === 'fill' ? 'fmotion' : 'motion'), spec = SP_SPEC[key];
    var ok = (list || []).map(function (v) { return String(v).toLowerCase().replace(/[\s_-]+/g, ''); }).filter(function (v) { return spec.v.indexOf(v) !== -1; }).slice(0, 8);
    if (!ok.length) return null;
    var ms = clamp(Number(each) || 2.5, 1.5, 6) * 1000, tok = ++tourTok, i = 0;
    if (!S.playing) window.sppTogglePlay();
    (function step() {
      if (tok !== tourTok || !S.open) return;
      var patch = {}; patch[key] = ok[i]; spConfigure(patch); S.t0 = performance.now(); i++;
      if (i < ok.length) setTimeout(step, ms);
    })();
    return { key: key, names: ok, last: ok[ok.length - 1], ms: ms };
  }
  /* build 308: Kadessa writes the extra texts (More texts), so one call can take photos, motion and every text to a finished clip.
     spec: { clear, update: [{n, ...fields}], remove: [n], mode: 'replace' | 'add', items: [{head, sub, badge, when, photo, from, to, pos, size, anim, color, font, align}] }
     n is the number among the EXTRA texts (1 = the first extra, shown as text 2 in the panel). photo is 1-based. from and to are fractions of the loop. */
  var SP_XT_POS = ['bottom', 'top', 'center', 'left', 'right'], SP_XT_FONTS = ['clean', 'serif', 'bold', 'mono'], SP_XT_ALIGNS = ['center', 'left', 'right'];
  function spXtClean(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
  function spXtFields(t, it, skipped) {
    ['head', 'sub', 'badge'].forEach(function (k) { if (k in it) t[k] = spXtClean(it[k], k === 'head' ? 120 : (k === 'sub' ? 160 : 24)); });
    var w = null;
    if (it.when != null) {
      var ws = String(it.when).toLowerCase().replace(/[\s_-]+/g, '');
      w = /^(photo|withphoto|perphoto|withaphoto)$/.test(ws) ? 'photo' : (/^(time|custom|customtime|window)$/.test(ws) ? 'time' : (/^(all|whole|wholevideo|always|video)$/.test(ws) ? 'all' : null));
    } else if (it.photo != null) w = 'photo';
    else if (it.from != null || it.to != null) w = 'time';
    if (w === 'photo' && S.o.fit !== 'gallery') { w = 'all'; skipped.push('a text linked to a photo needs Multi-photo, so it stays on for the whole video'); }
    if (w) t.when = w;
    if (t.when === 'photo' && (it.photo != null || w === 'photo')) t.photo = clamp(Math.round(Number(it.photo) || 1) - 1, 0, Math.max(0, S.gal.length - 1));
    if (t.when === 'time') {
      var a = it.from != null ? clamp(Number(it.from) || 0, 0, 0.98) : (t.a != null ? +t.a : 0), b = it.to != null ? clamp(Number(it.to) || 1, 0.02, 1) : (t.b != null ? +t.b : 1);
      if (b < a + 0.02) b = Math.min(1, a + 0.02);
      t.a = a; t.b = b;
    }
    if (it.pos != null) { var ps = String(it.pos).toLowerCase().trim(); if (ps === 'centre' || ps === 'middle') ps = 'center'; if (SP_XT_POS.indexOf(ps) !== -1) t.pos = ps; }
    if (it.size != null && isFinite(Number(it.size))) t.size = clamp(Math.round(Number(it.size)), 40, 200);
    if (it.anim != null) {
      var an = String(it.anim).toLowerCase().replace(/[\s_-]+/g, '');
      if (an === '' || an === 'same' || an === 'default') t.anim = 'same'; else if (SP_SPEC.txtAnim.v.indexOf(an) !== -1) t.anim = an;
    }
    if (it.color != null) { var cs = String(it.color).trim().toLowerCase(); if (cs === '' || cs === 'auto' || cs === 'same') t.col = ''; else { var hx = spHex(cs); if (hx) t.col = hx; } }
    if (it.font != null) { var fs = String(it.font).toLowerCase().trim(); if (fs === '' || fs === 'same' || fs === 'auto') t.font = ''; else if (SP_XT_FONTS.indexOf(fs) !== -1) t.font = fs; }
    if (it.align != null) { var as = String(it.align).toLowerCase().trim(); if (as === '' || as === 'same' || as === 'auto') t.al = ''; else if (SP_XT_ALIGNS.indexOf(as) !== -1) t.al = as; }
    return t;
  }
  function spTexts(spec) {
    spec = spec || {}; var did = [], skipped = [], cur = (S.o.xt || []).slice(), changed = false;
    if (spec.clear && cur.length) { cur = []; changed = true; did.push('cleared the extra texts'); }
    if (Array.isArray(spec.update) && cur.length) {
      var up = 0;
      spec.update.forEach(function (it) {
        var i = Math.round(Number(it && it.n)) - 1;
        if (!(i >= 0 && i < cur.length)) { skipped.push('there is no extra text number ' + (i + 1)); return; }
        cur[i] = spXtFields(Object.assign({}, cur[i]), it, skipped); up++;
      });
      if (up) { changed = true; did.push('updated ' + up + ' extra text' + (up === 1 ? '' : 's')); }
    }
    if (Array.isArray(spec.remove) && cur.length) {
      var rm = spec.remove.map(Number), n0 = cur.length;
      cur = cur.filter(function (t, i) { return rm.indexOf(i + 1) === -1; });
      if (cur.length !== n0) { changed = true; did.push('removed ' + (n0 - cur.length) + ' extra text' + (n0 - cur.length === 1 ? '' : 's')); }
    }
    var items = Array.isArray(spec.items) ? spec.items : [];
    if (items.length) {
      if (String(spec.mode || 'replace').toLowerCase() !== 'add' && cur.length) cur = [];
      var made = 0;
      items.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        if (cur.length >= XT_MAX) { if (made !== -1) { skipped.push('Showcase holds up to ' + XT_MAX + ' extra texts'); made = -1; } return; }
        var t = spXtFields(xtNew(), it, skipped);
        if (!xtHas(t)) { skipped.push('a text with no words was left out'); return; }
        cur.push(t); if (made !== -1) made++;
      });
      if (made > 0) { changed = true; did.push('wrote ' + made + ' extra text' + (made === 1 ? '' : 's')); }
    }
    if (changed) {
      xtList(cur);
      if (xtActId !== 'main' && !xtFind(xtActId)) xtActId = 'main';
    }
    return { did: did, skipped: skipped, changed: changed, total: (S.o.xt || []).length };
  }
  window.sppKadessa = {
    smartOrder: function () { return window.sppGalSmartOrder(); }, loadMany: spLoadMany, texts: spTexts, pageImages: spPageImages, editGallery: spGalEdit, tour: spTour,
    isOpen: function () { return !!S.open; },
    open: function () { if (!S.open) window.sppOpen(); },
    close: function () { if (S.open) window.sppClose(); },
    setLive: function (f) { S.live = (typeof f === 'function') ? f : null; },
    context: spContext, snapshot: spSnap, restore: spRestore, configure: spConfigure, load: spLoad, flushCut: spFlushCut,
    reset: function () { var keep = { fit: S.o.fit }; spRestore({ o: SP_DEFAULTS, loops: '1' }); return keep; },
    setPlayback: function (mode) {
      if (mode === 'pause' && S.playing) window.sppTogglePlay();
      else if (mode === 'play' && !S.playing) window.sppTogglePlay();
      else if (mode === 'restart') { S.tNorm = 0; S.t0 = performance.now(); if (!S.playing) window.sppTogglePlay(); }
    },
    seek: function (frac) { window.sppScrubTo(clamp(Number(frac) || 0, 0, 1) * 1000); },
    setCompare: function (on) { var w = $('sppWrapRel'); if (w && w.classList.contains('cmp') !== !!on) window.sppToggleCompare(); },
    hasCut: function () { return !!S.cut; },
    output: async function (kind) {
      if (!hasArt()) throw new Error('add a photo first');
      if (kind === 'png') return window.sppGate(window.sppDownloadPng);
      if (kind === 'video') return window.sppGate(window.sppExportVideo);
      if (kind === 'place') return window.sppPlaceOnPage();
      if (kind === 'live') return window.sppPlaceLiveOnPage();
      throw new Error('unknown output "' + kind + '". Use png, video, place or live');
    }
  };

})();
