// PHOTO TEXT (2026-11-08)
// Right panel of the PDF Editor: type a word, pick a photo, and the photo shows only through the letters
// (the "image in text" / text cutout look). The result is a transparent PNG placed on the page as a normal
// image object, so move, resize, rotate, opacity, lock, layers and export all work like any other image.
(function () {
  'use strict';

  var FONTS = [
    { id: 'anton', label: 'Anton (tall, bold)', css: "'Anton', 'Oswald', Impact, sans-serif", w: 400 },
    { id: 'bebas', label: 'Bebas Neue', css: "'Bebas Neue', 'Oswald', Impact, sans-serif", w: 400 },
    { id: 'archivo', label: 'Archivo Black (wide)', css: "'Archivo Black', 'Montserrat', Arial, sans-serif", w: 400 },
    { id: 'oswald', label: 'Oswald Bold', css: "'Oswald', Impact, sans-serif", w: 700 },
    { id: 'montserrat', label: 'Montserrat Bold', css: "'Montserrat', Arial, sans-serif", w: 800 },
    { id: 'playfair', label: 'Playfair Display (serif)', css: "'Playfair Display', Georgia, serif", w: 700 }
  ];
  var MAX_PX = 2000;   // widest PNG we make
  var st = { img: null, imgName: '', font: 'anton', spacing: 0, fit: 'cover', zoom: 100, bg: 'none', text: '' };

  function $(id) { return document.getElementById(id); }
  function say(m, k) { if (typeof window.toast === 'function') window.toast(m, k || 'info'); }
  function fontDef() { for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === st.font) return FONTS[i]; return FONTS[0]; }
  // If the chosen web font did not load (offline, blocked), fall back to a heavy system font so the letters
  // stay thick enough to show the photo.
  function usable(def) {
    try {
      var fam = def.css.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
      var ok = false;
      if (document.fonts && document.fonts.forEach) {
        document.fonts.forEach(function (f) {
          if (f.status === 'loaded' && String(f.family).replace(/['"]/g, '').trim().toLowerCase() === fam) ok = true;
        });
      }
      if (ok) return def;
    } catch (e) {}
    return { id: def.id, label: def.label, css: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", w: 900, fb: true };
  }

  // Pure layout helper (also used by the test): where a photo of iw x ih lands inside a box of bw x bh.
  window.pdfedPhotoTextFit = function (iw, ih, bw, bh, mode, zoomPct) {
    var z = Math.max(1, (+zoomPct || 100) / 100);
    var s = mode === 'contain' ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
    s *= z;
    var w = iw * s, h = ih * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w: w, h: h };
  };

  function ensureFont(def) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var spec = def.w + ' 120px ' + def.css.split(',')[0];
    return Promise.race([
      document.fonts.load(spec, 'AaBb').catch(function () {}),
      new Promise(function (r) { setTimeout(r, 2500); })
    ]);
  }

  function render(text, forPreview) {
    var def = usable(fontDef());
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    var size = 400;   // measuring size, scaled down later
    var m = document.createElement('canvas').getContext('2d');
    var fontStr = def.w + ' ' + size + 'px ' + def.css;
    m.font = fontStr;
    var sp = st.spacing / 100 * size;   // letter spacing in px at measuring size
    var widths = lines.map(function (ln) {
      var w = 0;
      for (var i = 0; i < ln.length; i++) w += m.measureText(ln[i]).width + (i < ln.length - 1 ? sp : 0);
      return w;
    });
    var lineH = size * 1.0;
    var pad = size * 0.06;
    var W = Math.ceil(Math.max.apply(null, widths) + pad * 2);
    var H = Math.ceil(lineH * lines.length + pad * 2);
    var k = Math.min(1, (forPreview ? 900 : MAX_PX) / W);
    var cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(W * k)); cv.height = Math.max(2, Math.round(H * k));
    var c = cv.getContext('2d');
    c.scale(k, k);
    c.font = fontStr; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    // 1) letters in solid ink (this is the mask)
    c.fillStyle = '#000';
    lines.forEach(function (ln, li) {
      var x = (W - widths[li]) / 2;
      var y = pad + lineH * li + size * 0.82;
      for (var i = 0; i < ln.length; i++) {
        c.fillText(ln[i], x, y);
        if (def.fb) { c.strokeStyle = '#000'; c.lineWidth = size * 0.04; c.lineJoin = 'round'; c.strokeText(ln[i], x, y); }
        x += c.measureText(ln[i]).width + sp;
      }
    });
    // 2) photo only where the letters are
    c.globalCompositeOperation = 'source-in';
    if (st.img) {
      var f = window.pdfedPhotoTextFit(st.img.naturalWidth || st.img.width, st.img.naturalHeight || st.img.height, W, H, st.fit, st.zoom);
      c.drawImage(st.img, f.x, f.y, f.w, f.h);
    } else {
      var g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#7c3aed'); g.addColorStop(0.55, '#ec4899'); g.addColorStop(1, '#f59e0b');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';
    return cv;
  }

  function paintPreview() {
    var box = $('pdfedPhotoTextPrev'); if (!box) return;
    var cv = render(st.text || 'PHOTO', true);
    box.innerHTML = '';
    if (!cv) return;
    cv.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto';
    box.appendChild(cv);
  }

  var timer = null;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(function () { ensureFont(fontDef()).then(paintPreview); }, 90);
  }

  function loadImage(src, name) {
    var im = new Image();
    im.onload = function () {
      st.img = im; st.imgName = name || 'photo';
      var n = $('pdfedPhotoTextImgName'); if (n) n.textContent = st.imgName;
      var cl = $('pdfedPhotoTextClear'); if (cl) cl.style.display = '';
      refresh();
    };
    im.onerror = function () { say('That photo could not be opened', 'error'); };
    im.src = src;
  }

  window.pdfedPhotoTextInput = function (v) { st.text = v; refresh(); };
  window.pdfedPhotoTextFont = function (v) { st.font = v; refresh(); };
  window.pdfedPhotoTextSpacing = function (v) { st.spacing = +v || 0; var e = $('pdfedPhotoTextSpVal'); if (e) e.textContent = st.spacing; refresh(); };
  window.pdfedPhotoTextZoom = function (v) { st.zoom = +v || 100; var e = $('pdfedPhotoTextZmVal'); if (e) e.textContent = st.zoom; refresh(); };
  window.pdfedPhotoTextFitMode = function (v) { st.fit = v === 'contain' ? 'contain' : 'cover'; refresh(); };
  window.pdfedPhotoTextPick = function () { var i = $('pdfedPhotoTextFile'); if (i) i.click(); };
  window.pdfedPhotoTextFile = function (input) {
    var f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { say('Please choose an image file', 'error'); return; }
    var rd = new FileReader();
    rd.onload = function () { loadImage(rd.result, f.name); };
    rd.readAsDataURL(f);
  };
  window.pdfedPhotoTextUseSelected = function () {
    var el = document.querySelector('#pdfedPlacedImagesLayer .pdfed-placed-img.selected');
    var pg = window.pdfed && pdfed.pages && pdfed.pages[pdfed.active];
    var item = el && pg && (pg.placedImages || []).find(function (i) { return i.id === el.dataset.id; });
    if (!item || !item.dataUrl) { say('Click a photo on the page first, then press this button', 'info'); return; }
    loadImage(item.dataUrl, 'Selected photo');
  };
  window.pdfedPhotoTextClearImg = function () {
    st.img = null; st.imgName = '';
    var n = $('pdfedPhotoTextImgName'); if (n) n.textContent = 'No photo yet (colour fill shown)';
    var cl = $('pdfedPhotoTextClear'); if (cl) cl.style.display = 'none';
    refresh();
  };

  window.pdfedPhotoTextAdd = async function () {
    var idx = pdfed.active, pg = pdfed.pages[idx];
    var pc = $('pdfedPageCanvas');
    if (!pg || !pc || !pc.width) { say('Open a page first', 'info'); return; }
    if (!String(st.text || '').trim()) { say('Type the text first', 'info'); return; }
    await ensureFont(fontDef());
    var cv = render(st.text, false);
    if (!cv) return;
    var w = Math.round(pc.width * 0.8), h = Math.round(w * cv.height / cv.width);
    if (h > pc.height * 0.8) { h = Math.round(pc.height * 0.8); w = Math.round(h * cv.width / cv.height); }
    if (!pg.placedImages) pg.placedImages = [];
    pg.placedImages.push({
      id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
      dataUrl: cv.toDataURL('image/png'),
      x: Math.round((pc.width - w) / 2), y: Math.round((pc.height - h) / 2), w: w, h: h,
      locked: false, zIndex: pdfedNextZ(pg), kind: 'image'
    });
    pdfedMarkModified(idx);
    pdfedRenderPlacedImages(idx);
    pdfedRenderPlacedTexts(idx);
    say('Photo text added. Drag to move, resize from the corners.', 'success');
  };

  window.pdfedPhotoTextToggle = function () {
    var p = $('pdfedPhotoTextPanel'); if (!p) return;
    var open = !p.classList.contains('open');
    p.classList.toggle('open', open);
    var b = $('pdfedPhotoTextHead'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var s = $('pdfedPhotoTextSel');
      if (s && !s.options.length) FONTS.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.label; s.appendChild(o); });
      var ti = $('pdfedPhotoTextBox'); if (ti && !ti.value) { ti.value = 'AHMEDABAD'; st.text = ti.value; }
      refresh();
    }
  };
})();
