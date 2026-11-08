// PHOTO TEXT (2026-11-08)
// The right panel of the PDF Editor is only the CONTROLLER. The effect lives on the page canvas:
// the first change (type a word, pick a photo, move a slider) puts photo-filled letters on the page and every
// later change updates that same object live. Click it on the page and its settings return to the panel.
// 3D: extrusion (depth), floor reflection, soft shadow, glow and gloss, all drawn on a canvas, no libraries.
// The result is a normal placed image (move, resize, rotate, opacity, lock, layers, export all work).
(function () {
  'use strict';

  var FONTS = [
    { id: 'anton', label: 'Anton', css: "'Anton', 'Oswald', Impact, sans-serif", w: 400 },
    { id: 'bebas', label: 'Bebas', css: "'Bebas Neue', 'Oswald', Impact, sans-serif", w: 400 },
    { id: 'archivo', label: 'Archivo', css: "'Archivo Black', 'Montserrat', Arial, sans-serif", w: 400 },
    { id: 'oswald', label: 'Oswald', css: "'Oswald', Impact, sans-serif", w: 700 },
    { id: 'montserrat', label: 'Montserrat', css: "'Montserrat', Arial, sans-serif", w: 800 },
    { id: 'playfair', label: 'Playfair', css: "'Playfair Display', Georgia, serif", w: 700 }
  ];
  // One-click looks. Every number is a slider value (0 to 100) the user can still change.
  var LOOKS = {
    flat:   { depth: 0,  reflect: 0,  shadow: 0,  glow: 0,  gloss: 0 },
    depth:  { depth: 45, reflect: 0,  shadow: 40, glow: 0,  gloss: 1 },
    mirror: { depth: 0,  reflect: 55, shadow: 0,  glow: 0,  gloss: 1 },
    studio: { depth: 38, reflect: 50, shadow: 42, glow: 0,  gloss: 1 },
    glow:   { depth: 0,  reflect: 30, shadow: 0,  glow: 70, gloss: 0 }
  };
  var LIVE_PX = 1400;
  var st = { img: null, imgName: '', imgSrc: '', font: 'anton', spacing: 0, fit: 'cover', zoom: 100, text: '',
             depth: 38, reflect: 50, shadow: 42, glow: 0, gloss: 1, look: 'studio', liveId: null };

  function $(id) { return document.getElementById(id); }
  function say(m, k) { if (typeof window.toast === 'function') window.toast(m, k || 'info'); }
  function clamp(v, a, b) { v = +v; if (!isFinite(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function fontDef() { for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === st.font) return FONTS[i]; return FONTS[0]; }
  // If the web font did not load (offline, blocked) use a heavy system font so letters stay thick.
  function usable(def) {
    try {
      var fam = def.css.split(',')[0].replace(/['"]/g, '').trim().toLowerCase(), ok = false;
      if (document.fonts && document.fonts.forEach) document.fonts.forEach(function (f) {
        if (f.status === 'loaded' && String(f.family).replace(/['"]/g, '').trim().toLowerCase() === fam) ok = true;
      });
      if (ok) return def;
    } catch (e) {}
    return { id: def.id, label: def.label, css: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", w: 900, fb: true };
  }

  // Pure layout helper (used by tests): where a photo of iw x ih lands inside a box of bw x bh.
  window.pdfedPhotoTextFit = function (iw, ih, bw, bh, mode, zoomPct) {
    var z = Math.max(1, (+zoomPct || 100) / 100);
    var s = mode === 'contain' ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
    s *= z;
    var w = iw * s, h = ih * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w: w, h: h };
  };
  // Pure helper (used by tests): the empty room the 3D effects need around the letters, in layout units.
  window.pdfedPhotoTextRoom = function (size, p) {
    var d = clamp(p.depth, 0, 100) / 100 * size * 0.28;
    var m = Math.max(clamp(p.glow, 0, 100) / 100 * size * 0.25, clamp(p.shadow, 0, 100) / 100 * size * 0.16);
    return { vx: d * 0.55, vy: d * 0.85, m: m, rh: clamp(p.reflect, 0, 100) > 0 ? size * 0.6 : 0, gap: size * 0.02 };
  };

  function ensureFont(def) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.race([
      document.fonts.load(def.w + ' 120px ' + def.css.split(',')[0], 'AaBb').catch(function () {}),
      new Promise(function (r) { setTimeout(r, 2500); })
    ]);
  }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; }

  var avgCache = { src: '', col: '#a78bfa' };
  function photoColour() {
    if (!st.img) return '#a78bfa';
    if (avgCache.src === st.imgSrc) return avgCache.col;
    try {
      var c = mk(8, 8), x = c.getContext('2d'); x.drawImage(st.img, 0, 0, 8, 8);
      var d = x.getImageData(0, 0, 8, 8).data, r = 0, g = 0, b = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      var mx = Math.max(r, g, b) || 1, f = 255 / mx * 0.9;   // brighten so a glow reads on any photo
      avgCache = { src: st.imgSrc, col: 'rgb(' + Math.min(255, Math.round(r * f)) + ',' + Math.min(255, Math.round(g * f)) + ',' + Math.min(255, Math.round(b * f)) + ')' };
    } catch (e) { avgCache = { src: st.imgSrc, col: '#a78bfa' }; }
    return avgCache.col;
  }

  // Returns { cv, uw, uh, m, lk }: the finished picture plus its size in layout units (uw, uh), the empty margin
  // around the letters (m), and a key that changes only when the text layout changes (lk).
  function render(text, maxPx) {
    var def = usable(fontDef());
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    var size = 400;
    var mctx = mk(4, 4).getContext('2d');
    var fontStr = def.w + ' ' + size + 'px ' + def.css;
    mctx.font = fontStr;
    var sp = st.spacing / 100 * size;
    var widths = lines.map(function (ln) {
      var w = 0;
      for (var i = 0; i < ln.length; i++) w += mctx.measureText(ln[i]).width + (i < ln.length - 1 ? sp : 0);
      return w;
    });
    var lineH = size, pad = size * 0.06;
    var W = Math.ceil(Math.max.apply(null, widths) + pad * 2), H = Math.ceil(lineH * lines.length + pad * 2);
    var room = window.pdfedPhotoTextRoom(size, st);
    var M = room.m, vx = room.vx, vy = room.vy, rh = room.rh * lines.length > 0 ? Math.min(room.rh, H * 0.6) : 0, gap = room.gap;
    var UW = W + vx + 2 * M, UH = M + H + vy + (rh ? gap + rh : 0) + M + (st.shadow ? size * 0.04 : 0);
    var k = Math.min(1, maxPx / UW);

    // 1) the face: letters filled with the photo (or a colour gradient when there is no photo yet)
    var F = mk(W * k, H * k), f = F.getContext('2d');
    f.scale(k, k); f.font = fontStr; f.textBaseline = 'alphabetic'; f.textAlign = 'left'; f.fillStyle = '#000';
    lines.forEach(function (ln, li) {
      var x = (W - widths[li]) / 2, y = pad + lineH * li + size * 0.82;
      for (var i = 0; i < ln.length; i++) {
        f.fillText(ln[i], x, y);
        if (def.fb) { f.strokeStyle = '#000'; f.lineWidth = size * 0.04; f.lineJoin = 'round'; f.strokeText(ln[i], x, y); }
        x += f.measureText(ln[i]).width + sp;
      }
    });
    f.globalCompositeOperation = 'source-in';
    if (st.img) {
      var fit = window.pdfedPhotoTextFit(st.img.naturalWidth || st.img.width, st.img.naturalHeight || st.img.height, W, H, st.fit, st.zoom);
      f.drawImage(st.img, fit.x, fit.y, fit.w, fit.h);
    } else {
      var g = f.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#7c3aed'); g.addColorStop(0.55, '#ec4899'); g.addColorStop(1, '#f59e0b');
      f.fillStyle = g; f.fillRect(0, 0, W, H);
    }
    if (st.gloss) {   // soft light from above, a little shade below: reads as a glossy surface
      f.globalCompositeOperation = 'source-atop';
      var gl = f.createLinearGradient(0, 0, 0, H);
      gl.addColorStop(0, 'rgba(255,255,255,0.34)'); gl.addColorStop(0.45, 'rgba(255,255,255,0.06)');
      gl.addColorStop(0.5, 'rgba(0,0,0,0)'); gl.addColorStop(1, 'rgba(0,0,0,0.18)');
      f.fillStyle = gl; f.fillRect(0, 0, W, H);
    }
    f.globalCompositeOperation = 'source-over';

    // 2) the group: extruded sides behind the face
    var GW = Math.round(UW * k), GH = Math.round(UH * k);
    var G = mk(GW, GH), g2 = G.getContext('2d');
    var ox = Math.round(M * k), oy = Math.round(M * k);
    var len = Math.hypot(vx, vy);
    if (len > 0.5) {
      var D = mk(F.width, F.height), dc = D.getContext('2d');
      dc.drawImage(F, 0, 0); dc.globalCompositeOperation = 'source-atop'; dc.fillStyle = 'rgba(8,6,20,0.58)'; dc.fillRect(0, 0, D.width, D.height);
      var steps = Math.min(160, Math.max(2, Math.ceil(len * k)));
      for (var s = steps; s >= 1; s--) g2.drawImage(D, ox + vx * k * s / steps, oy + vy * k * s / steps);
    }
    g2.drawImage(F, ox, oy);

    // 3) the picture: reflection, shadow, glow, then the group on top
    var O = mk(GW, GH), o = O.getContext('2d');
    var axis = Math.round((M + H + vy) * k);
    if (rh) {
      var rhk = Math.min(Math.round(rh * k), GH - axis);
      var R = mk(GW, rhk), r = R.getContext('2d');
      r.save(); r.translate(0, rhk); r.scale(1, -1); r.drawImage(G, 0, axis - rhk, GW, rhk, 0, 0, GW, rhk); r.restore();
      r.globalCompositeOperation = 'destination-in';
      var fade = r.createLinearGradient(0, 0, 0, rhk), a0 = 0.16 + 0.5 * clamp(st.reflect, 0, 100) / 100;
      fade.addColorStop(0, 'rgba(0,0,0,' + a0.toFixed(3) + ')'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      r.fillStyle = fade; r.fillRect(0, 0, GW, rhk);
      o.drawImage(R, 0, axis + Math.round(gap * k));
    }
    if (st.shadow) {
      var S = mk(GW, GH), sc = S.getContext('2d');
      sc.drawImage(G, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#000'; sc.fillRect(0, 0, GW, GH);
      var BIG = GW + 400, sh = clamp(st.shadow, 0, 100) / 100;
      o.save();
      o.shadowColor = 'rgba(8,6,24,' + (0.28 + 0.4 * sh).toFixed(3) + ')';
      o.shadowBlur = size * (0.03 + 0.1 * sh) * k; o.shadowOffsetX = BIG; o.shadowOffsetY = size * (0.025 + 0.05 * sh) * k;
      o.drawImage(S, -BIG, 0);
      o.restore();
    }
    if (st.glow) {
      var gv = clamp(st.glow, 0, 100) / 100, col = photoColour();
      o.save(); o.shadowColor = col; o.shadowBlur = size * (0.05 + 0.2 * gv) * k;
      o.globalAlpha = 0.5 + 0.5 * gv; o.drawImage(G, 0, 0); o.drawImage(G, 0, 0); o.restore();
    }
    o.drawImage(G, 0, 0);
    return { cv: O, uw: UW, uh: UH, m: M, lk: [text, st.font, st.spacing].join('|') };
  }

  // ---- live object on the page ----------------------------------------------------------------
  function curPage() { return (typeof pdfed !== 'undefined' && pdfed && pdfed.pages) ? pdfed.pages[pdfed.active] : null; }
  function liveItem() {
    var pg = curPage();
    return pg && st.liveId ? (pg.placedImages || []).find(function (i) { return i.id === st.liveId; }) : null;
  }
  function snapshot() {
    return { text: st.text, font: st.font, spacing: st.spacing, fit: st.fit, zoom: st.zoom, src: st.imgSrc, name: st.imgName,
             depth: st.depth, reflect: st.reflect, shadow: st.shadow, glow: st.glow, gloss: st.gloss, look: st.look };
  }
  function shrinkSrc(src, cb) {
    var im = new Image();
    im.onload = function () {
      var k = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
      if (k === 1 && src.length < 600000) { cb(src, im); return; }
      var c = mk(im.naturalWidth * k, im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      var out = c.toDataURL('image/jpeg', 0.88), im2 = new Image();
      im2.onload = function () { cb(out, im2); }; im2.src = out;
    };
    im.onerror = function () { say('That photo could not be opened', 'error'); };
    im.src = src;
  }

  var busy = false, again = false;
  async function applyLive() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      var idx = pdfed.active, pg = pdfed.pages[idx], pc = $('pdfedPageCanvas');
      if (!pg || !pc || !pc.width) { say('Open a page first', 'info'); return; }
      if (!String(st.text || '').trim()) return;
      await ensureFont(fontDef());
      var res = render(st.text, LIVE_PX);
      if (!res) return;
      var url = res.cv.toDataURL('image/png'), it = liveItem();
      if (!it) {
        if (!pg.placedImages) pg.placedImages = [];
        var w = Math.round(pc.width * 0.8), sc = w / res.uw, h = Math.round(res.uh * sc);
        if (h > pc.height * 0.7) { h = Math.round(pc.height * 0.7); sc = h / res.uh; w = Math.round(res.uw * sc); }
        // a new text goes just below the last photo text instead of on top of it
        var prev = null; pg.placedImages.forEach(function (i) { if (i.ptx) prev = i; });
        var y = Math.round((pc.height - h) / 2);
        if (prev) y = Math.min(Math.round(prev.y + prev.h * 0.92), Math.max(8, pc.height - h - 8));
        it = { id: 'pimg_' + (++pdfedAnnotState.placedImgSeq), dataUrl: url, x: Math.round((pc.width - w) / 2), y: y, w: w, h: h,
               locked: false, zIndex: pdfedNextZ(pg), kind: 'image' };
        pg.placedImages.push(it); st.liveId = it.id;
      } else {
        var old = it.ptx || {}, oldScale = old.uw ? it.w / old.uw : 0, sameLayout = old.lk === res.lk && oldScale > 0;
        // only a 3D change: keep the letters exactly as big as they were. A text change: keep the width.
        var scale = sameLayout ? oldScale : it.w / res.uw;
        var nw = Math.round(res.uw * scale), nh = Math.round(res.uh * scale);
        var oldM = old.m != null ? old.m * oldScale : 0, newM = res.m * scale;
        if (sameLayout) { it.x = Math.round(it.x + oldM - newM); it.y = Math.round(it.y + oldM - newM); }
        else { it.y = Math.round(it.y + (it.h - nh) / 2); }
        it.w = nw; it.h = nh; it.dataUrl = url;
      }
      it.ptx = snapshot(); it.ptx.uw = res.uw; it.ptx.uh = res.uh; it.ptx.m = res.m; it.ptx.lk = res.lk;
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      pdfedRenderPlacedTexts(idx);
      var el = document.querySelector('#pdfedPlacedImagesLayer .pdfed-placed-img[data-id="' + it.id + '"]');
      if (el) el.classList.add('selected');
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  }
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(applyLive, 50); }

  function setImage(src, name) {
    shrinkSrc(src, function (small, im) {
      st.img = im; st.imgSrc = small; st.imgName = name || 'photo';
      syncControls(); schedule();
    });
  }

  // ---- panel (controller) ----------------------------------------------------------------------
  function buildFonts() {
    var box = $('pdfedPhotoTextFonts');
    if (!box || box.children.length) return;
    FONTS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ptx-font'; b.dataset.id = f.id; b.title = f.label;
      b.innerHTML = '<span style="font-family:' + f.css.replace(/"/g, "'") + ';font-weight:' + f.w + '">Aa</span><em>' + f.label + '</em>';
      b.onclick = function () { window.pdfedPhotoTextFont(f.id); };
      box.appendChild(b);
    });
  }
  function syncControls() {
    var set = function (id, v) { var e = $(id); if (e && e.value !== String(v)) e.value = v; };
    var txt = function (id, v) { var e = $(id); if (e) e.textContent = v; };
    set('pdfedPhotoTextBox', st.text);
    set('pdfedPhotoTextSpRange', st.spacing); set('pdfedPhotoTextZmRange', st.zoom);
    set('pdfedPhotoTextDpRange', st.depth); set('pdfedPhotoTextRfRange', st.reflect);
    set('pdfedPhotoTextShRange', st.shadow); set('pdfedPhotoTextGlRange', st.glow);
    txt('pdfedPhotoTextSpVal', st.spacing); txt('pdfedPhotoTextZmVal', st.zoom + '%');
    txt('pdfedPhotoTextDpVal', st.depth); txt('pdfedPhotoTextRfVal', st.reflect);
    txt('pdfedPhotoTextShVal', st.shadow); txt('pdfedPhotoTextGlVal', st.glow);
    var gl = $('pdfedPhotoTextGloss'); if (gl) gl.checked = !!st.gloss;
    document.querySelectorAll('#pdfedPhotoTextPanel .ptx-font').forEach(function (b) { b.classList.toggle('on', b.dataset.id === st.font); });
    document.querySelectorAll('#pdfedPhotoTextPanel .ptx-look').forEach(function (b) { b.classList.toggle('on', b.dataset.look === st.look); });
    document.querySelectorAll('#pdfedPhotoTextPanel .ptx-seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.fit === st.fit); });
    txt('pdfedPhotoTextImgName', st.img ? st.imgName : 'Colour fill. Add a photo');
    var th = $('pdfedPhotoTextThumb');
    if (th) { th.style.backgroundImage = st.img ? 'url(' + st.imgSrc + ')' : ''; th.classList.toggle('empty', !st.img); }
    var cl = $('pdfedPhotoTextClear'); if (cl) cl.style.display = st.img ? '' : 'none';
    txt('pdfedPhotoTextState', liveItem() ? 'Editing the text on the page' : 'Type a word, it appears on the page');
  }
  function set3d(key, v) { st[key] = clamp(v, 0, 100); st.look = ''; syncControls(); schedule(); }

  window.pdfedPhotoTextInput = function (v) { st.text = v; schedule(); syncControls(); };
  window.pdfedPhotoTextFont = function (v) { st.font = v; syncControls(); schedule(); };
  window.pdfedPhotoTextSpacing = function (v) { st.spacing = clamp(v, -5, 30); syncControls(); schedule(); };
  window.pdfedPhotoTextZoom = function (v) { st.zoom = clamp(v, 100, 300); syncControls(); schedule(); };
  window.pdfedPhotoTextFitMode = function (v) { st.fit = v === 'contain' ? 'contain' : 'cover'; syncControls(); schedule(); };
  window.pdfedPhotoTextDepth = function (v) { set3d('depth', v); };
  window.pdfedPhotoTextReflect = function (v) { set3d('reflect', v); };
  window.pdfedPhotoTextShadow = function (v) { set3d('shadow', v); };
  window.pdfedPhotoTextGlow = function (v) { set3d('glow', v); };
  window.pdfedPhotoTextGloss = function (on) { st.gloss = on ? 1 : 0; st.look = ''; syncControls(); schedule(); };
  window.pdfedPhotoTextLook = function (id) {
    var l = LOOKS[id]; if (!l) return;
    st.depth = l.depth; st.reflect = l.reflect; st.shadow = l.shadow; st.glow = l.glow; st.gloss = l.gloss; st.look = id;
    syncControls(); schedule();
  };
  window.pdfedPhotoTextPick = function () { var i = $('pdfedPhotoTextFile'); if (i) i.click(); };
  window.pdfedPhotoTextFile = function (input) {
    var f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { say('Please choose an image file', 'error'); return; }
    var rd = new FileReader();
    rd.onload = function () { setImage(rd.result, f.name); };
    rd.readAsDataURL(f);
  };
  window.pdfedPhotoTextUseSelected = function () {
    var el = document.querySelector('#pdfedPlacedImagesLayer .pdfed-placed-img.selected');
    var pg = curPage();
    var item = el && pg && (pg.placedImages || []).find(function (i) { return i.id === el.dataset.id; });
    if (!item || !item.dataUrl || item.id === st.liveId) { say('Click a different photo on the page first, then press this button', 'info'); return; }
    setImage(item.dataUrl, 'Selected photo');
  };
  window.pdfedPhotoTextClearImg = function () { st.img = null; st.imgSrc = ''; st.imgName = ''; syncControls(); schedule(); };
  // "New text": the next change makes a NEW object instead of changing the one on the page.
  window.pdfedPhotoTextNew = function () {
    st.liveId = null; st.text = '';
    var ti = $('pdfedPhotoTextBox'); if (ti) { ti.value = ''; ti.focus(); }
    syncControls();
  };
  window.pdfedPhotoTextToggle = function () {
    var p = $('pdfedPhotoTextPanel'); if (!p) return;
    var open = !p.classList.contains('open');
    p.classList.toggle('open', open);
    var b = $('pdfedPhotoTextHead'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { buildFonts(); syncControls(); var ti = $('pdfedPhotoTextBox'); if (ti) ti.focus(); }
  };

  // Click a photo-text object on the page: load its settings into the panel so it can be edited again.
  // Click any other image: unlink, so the panel never changes the wrong picture.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('#pdfedPlacedImagesLayer .pdfed-placed-img');
    if (!el) return;
    var pg = curPage();
    var item = pg && (pg.placedImages || []).find(function (i) { return i.id === el.dataset.id; });
    if (!item) return;
    if (item.ptx) {
      var t = item.ptx;
      st.liveId = item.id; st.text = t.text; st.font = t.font; st.spacing = t.spacing; st.fit = t.fit; st.zoom = t.zoom;
      st.depth = t.depth || 0; st.reflect = t.reflect || 0; st.shadow = t.shadow || 0; st.glow = t.glow || 0; st.gloss = t.gloss ? 1 : 0; st.look = t.look || '';
      st.imgSrc = t.src || ''; st.imgName = t.name || '';
      if (t.src) { var im = new Image(); im.onload = function () { st.img = im; syncControls(); }; im.src = t.src; } else { st.img = null; }
      var p = $('pdfedPhotoTextPanel'); if (p && !p.classList.contains('open')) pdfedPhotoTextToggle();
      syncControls();
    } else if (st.liveId && item.id !== st.liveId) {
      st.liveId = null; syncControls();
    }
  }, true);
})();
