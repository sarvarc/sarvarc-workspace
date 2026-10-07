/* ===== SARVARC SIGN, shared signature engine (Draw / Type / Upload image or PDF) =====
   One self-contained module used by BOTH the Workspace (Make Forms fill mode)
   and the public respondent page, so the signing experience is identical.

   SarvarcSign.open({ title, accent, onDone(value), onCancel() })
     value = {
       v: 1,
       method: 'draw' | 'type' | 'upload',
       image:  dataURL (small PNG/JPEG the form shows and prints, may be null for an unreadable PDF),
       file:   { name, type, size, dataUrl } | null   (the ORIGINAL PDF, only when a PDF was uploaded)
       signedAt: ISO string
     }
   SarvarcSign.toAnswer(value) -> JSON string (what gets submitted as the field's answer)
   SarvarcSign.parse(raw)      -> value | null   (accepts JSON string, object, or a legacy data:image URL)
*/
(function () {
  'use strict';
  if (window.SarvarcSign) return;

  // Original PDFs above this size are refused (the signature image itself is always tiny).
  var MAX_PDF_BYTES = 1.5 * 1024 * 1024;
  var MAX_IMG_BYTES = 15 * 1024 * 1024;
  var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Allura&family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&display=swap';
  var FONTS = [
    { name: 'Dancing Script', css: "'Dancing Script', 'Brush Script MT', cursive", w: 600 },
    { name: 'Great Vibes', css: "'Great Vibes', 'Brush Script MT', cursive", w: 400 },
    { name: 'Allura', css: "'Allura', 'Brush Script MT', cursive", w: 400 },
    { name: 'Caveat', css: "'Caveat', 'Brush Script MT', cursive", w: 600 }
  ];
  var INKS = ['#0A0F1E', '#0033CC', '#7A1FA2'];
  var CW = 900, CH = 300; // drawing / typing canvas backing size (shown at 100% width)

  // ───────────────────────── helpers ─────────────────────────
  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function hexToRgb(hex) {
    var m = String(hex || '').trim().match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
    if (!m) return '0, 115, 230';
    var h = m[1];
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' + parseInt(h.slice(4, 6), 16);
  }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function parse(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return (raw.v === 1 && (raw.image || raw.file)) ? raw : null;
    if (typeof raw !== 'string') return null;
    var t = raw.trim();
    if (t.charAt(0) === '{') {
      try {
        var o = JSON.parse(t);
        if (o && o.v === 1 && (o.image || o.file)) return o;
      } catch (e) { /* fall through */ }
      return null;
    }
    if (/^data:image\//.test(t)) return { v: 1, method: 'legacy', image: t, file: null };
    return null;
  }
  function toAnswer(value) { return JSON.stringify(value); }

  // Trims empty margins around ink. mode 'alpha' = transparent margins, 'white' = white margins.
  function trim(src, mode, pad) {
    pad = pad == null ? 10 : pad;
    var w = src.width, h = src.height;
    var d = src.getContext('2d').getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var ink = mode === 'alpha'
          ? d[i + 3] > 12
          : (d[i + 3] > 12 && (d[i] < 238 || d[i + 1] < 238 || d[i + 2] < 238));
        if (ink) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return src;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    var out = mkCanvas(maxX - minX + 1, maxY - minY + 1);
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }
  function scaleDown(src, maxW, maxH) {
    var s = Math.min(1, maxW / src.width, maxH / src.height);
    if (s >= 1) return src;
    var out = mkCanvas(src.width * s, src.height * s);
    var ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }
  function flattenOnWhite(src) {
    var out = mkCanvas(src.width, src.height);
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    return out;
  }
  function hasTransparency(c) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }
  // Turns near-white paper into transparency so a photographed signature can sit on any form.
  function whiteToAlpha(c) {
    var ctx = c.getContext('2d');
    var img = ctx.getImageData(0, 0, c.width, c.height);
    var a = img.data;
    for (var i = 0; i < a.length; i += 4) {
      var l = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      var t = (232 - l) / (232 - 150);
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      a[i + 3] = Math.round(a[i + 3] * t);
    }
    ctx.putImageData(img, 0, 0);
  }
  // Small transparent PNG for drawn / typed signatures.
  function encodeInk(c) {
    var t = scaleDown(trim(c, 'alpha', 10), 640, 220);
    return t.toDataURL('image/png');
  }

  // ───────────────────────── pdf.js (lazy) ─────────────────────────
  var pdfPromise = null;
  function ensurePdfJs() {
    if (window.pdfjsLib) {
      try {
        if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        }
      } catch (e) { /* ignore */ }
      return Promise.resolve(window.pdfjsLib);
    }
    if (pdfPromise) return pdfPromise;
    pdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_SRC;
      s.onload = function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(window.pdfjsLib);
        } else reject(new Error('pdf.js unavailable'));
      };
      s.onerror = function () { pdfPromise = null; reject(new Error('pdf.js failed to load')); };
      document.head.appendChild(s);
    });
    return pdfPromise;
  }
  function renderPdfFirstPage(buf) {
    return ensurePdfJs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) {
      return doc.getPage(1).then(function (page) {
        var vp = page.getViewport({ scale: 1 });
        var scale = Math.min(3, 900 / vp.width);
        var v = page.getViewport({ scale: scale });
        var c = mkCanvas(v.width, v.height);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: v }).promise.then(function () {
          return { canvas: c, pages: doc.numPages };
        });
      });
    });
  }
  function readAsDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('read failed')); };
      r.readAsDataURL(file);
    });
  }
  function readAsBuffer(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('read failed')); };
      r.readAsArrayBuffer(file);
    });
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }
  // Uploaded picture -> compact signature image.
  function processImage(img, removeBg) {
    var s = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    var c = mkCanvas(img.naturalWidth * s, img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    var alpha = hasTransparency(c);
    if (removeBg) whiteToAlpha(c);
    var useAlpha = removeBg || alpha;
    var t = trim(c, useAlpha ? 'alpha' : 'white', 10);
    t = scaleDown(t, 800, 500);
    if (useAlpha) {
      var png = t.toDataURL('image/png');
      if (png.length < 600000) return png;
      t = flattenOnWhite(scaleDown(t, 560, 360)); // very detailed photo: fall back to JPEG
    }
    return t.toDataURL('image/jpeg', 0.88);
  }

  // ───────────────────────── styles ─────────────────────────
  var cssDone = false;
  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var st = document.createElement('style');
    st.id = 'sgxStyles';
    st.textContent = [
      '.sgx-ov{position:fixed;inset:0;z-index:100000;background:rgba(10,15,30,.62);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;animation:sgxIn .16s ease}',
      '@keyframes sgxIn{from{opacity:0}to{opacity:1}}',
      '.sgx-ov *{box-sizing:border-box}',
      '.sgx-card{background:#fff;color:#0E1626;width:100%;max-width:520px;max-height:calc(100vh - 32px);overflow:auto;border-radius:18px;box-shadow:0 30px 80px -20px rgba(0,0,0,.55);padding:20px 22px 18px;display:flex;flex-direction:column;gap:14px;text-align:left}',
      '.sgx-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.sgx-title{font-size:16px;font-weight:700;margin:0;color:#0E1626;line-height:1.3;word-break:break-word}',
      '.sgx-ov button.sgx-x{background:none;border:0;box-shadow:none;font-size:26px;line-height:1;color:#55647C;cursor:pointer;padding:0 4px;width:auto;height:auto;min-height:0}',
      '.sgx-tabs{display:flex;gap:4px;background:#F0F4FA;border-radius:10px;padding:3px}',
      '.sgx-ov button.sgx-tab{flex:1;border:0;background:transparent;border-radius:8px;padding:9px 6px;font:600 12px Inter,sans-serif;color:#55647C;cursor:pointer;box-shadow:none;width:auto;min-height:0}',
      '.sgx-ov button.sgx-tab.on{background:var(--sgx-accent);color:#fff}',
      '.sgx-pad{position:relative;background:#fff;border:1.5px solid #DCE4F0;border-radius:12px;overflow:hidden}',
      '.sgx-pad canvas{display:block;width:100%;height:auto;touch-action:none;cursor:crosshair;background:transparent}',
      '.sgx-pad.type canvas{cursor:default}',
      '.sgx-guide{position:absolute;left:5%;right:5%;bottom:22%;border-bottom:1.5px dashed #C9D3E3;pointer-events:none}',
      '.sgx-xm{position:absolute;left:5%;bottom:calc(22% + 3px);color:#B3BFD1;font-size:15px;line-height:1;pointer-events:none}',
      '.sgx-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#A6B2C4;font-size:13px;pointer-events:none;text-align:center;padding:0 14px}',
      '.sgx-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.sgx-lab{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8894A8}',
      '.sgx-ov button.sgx-dot{width:20px;height:20px;min-height:0;padding:0;border-radius:50%;border:2px solid transparent;cursor:pointer;box-shadow:none}',
      '.sgx-ov button.sgx-dot.on{border-color:var(--sgx-accent);box-shadow:0 0 0 2px #fff inset}',
      '.sgx-ov button.sgx-mini{background:#fff;border:1px solid #DCE4F0;color:#33415A;border-radius:8px;padding:5px 12px;font:600 11.5px Inter,sans-serif;cursor:pointer;box-shadow:none;width:auto;min-height:0}',
      '.sgx-ov button.sgx-mini:hover{background:#F4F7FC}',
      '.sgx-sp{margin-left:auto}',
      '.sgx-ov label.sgx-check{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500;line-height:1.4;color:#55647C;cursor:pointer;user-select:none;margin:0;text-transform:none;letter-spacing:0}',
      '.sgx-ov .sgx-check input{accent-color:var(--sgx-accent);width:15px;height:15px;margin:0}',
      '.sgx-ov .sgx-in{width:100%;margin:0;border:1.5px solid #DCE4F0;border-radius:10px;padding:11px 13px;font:500 15px Inter,sans-serif;color:#0E1626;background:#F7F9FC;outline:none}',
      '.sgx-ov .sgx-in:focus{border-color:var(--sgx-accent);background:#fff;box-shadow:0 0 0 3px rgba(var(--sgx-rgb),.14)}',
      '.sgx-fonts{display:flex;gap:6px;flex-wrap:wrap}',
      '.sgx-ov button.sgx-font{background:#fff;border:1.5px solid #DCE4F0;border-radius:9px;padding:6px 11px;font-size:17px;line-height:1.1;color:#0E1626;cursor:pointer;box-shadow:none;width:auto;min-height:0}',
      '.sgx-ov button.sgx-font.on{border-color:var(--sgx-accent);background:rgba(var(--sgx-rgb),.08)}',
      '.sgx-drop{border:2px dashed #C9D3E3;border-radius:12px;padding:28px 14px;text-align:center;cursor:pointer;color:#55647C;font-size:13px;line-height:1.5;background:#FAFBFE;transition:border-color .15s,background .15s}',
      '.sgx-drop:hover,.sgx-drop.over{border-color:var(--sgx-accent);background:rgba(var(--sgx-rgb),.05)}',
      '.sgx-drop b{color:var(--sgx-accent)}',
      '.sgx-drop small{display:block;margin-top:6px;font-size:11px;color:#8894A8}',
      '.sgx-prev{background:repeating-conic-gradient(#F1F4F9 0% 25%,#fff 0% 50%) 50%/16px 16px;border:1.5px solid #DCE4F0;border-radius:12px;padding:10px;text-align:center}',
      '.sgx-prev img{max-width:100%;max-height:190px;display:inline-block}',
      '.sgx-chip{display:flex;align-items:center;gap:10px;border:1px solid #DCE4F0;border-radius:10px;padding:9px 12px;background:#F7F9FC}',
      '.sgx-chip .ic{flex:0 0 auto;width:30px;height:30px;border-radius:8px;background:rgba(var(--sgx-rgb),.12);color:var(--sgx-accent);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800}',
      '.sgx-chip .tx{min-width:0;flex:1}',
      '.sgx-chip .tx b{display:block;font-size:12.5px;color:#0E1626;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sgx-chip .tx small{font-size:11px;color:#8894A8}',
      '.sgx-note{margin:0;font-size:11.5px;color:#6B7A93;line-height:1.5}',
      '.sgx-err{display:none;background:#FDECEC;border:1px solid #F5C2C2;color:#8A1F1F;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.45}',
      '.sgx-err.show{display:block}',
      '.sgx-foot{display:flex;gap:10px;margin-top:2px}',
      '.sgx-ov button.sgx-btn{flex:1;border-radius:11px;padding:11px;font:700 13px Inter,sans-serif;cursor:pointer;border:1.5px solid #DCE4F0;background:#fff;color:#33415A;box-shadow:none;width:auto;min-height:0}',
      '.sgx-ov button.sgx-btn.pri{background:var(--sgx-accent);border-color:var(--sgx-accent);color:#fff}',
      '.sgx-ov button.sgx-btn:disabled{opacity:.55;cursor:wait}',
      '.sgx-spin{display:inline-block;width:12px;height:12px;border:2px solid #C9D3E3;border-top-color:var(--sgx-accent);border-radius:50%;animation:sgxSp .7s linear infinite;vertical-align:-2px;margin-right:7px}',
      '@keyframes sgxSp{to{transform:rotate(360deg)}}',
      '@media (max-width:480px){.sgx-card{padding:16px 15px 14px;border-radius:16px}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  var fontsDone = false;
  function loadFonts() {
    if (fontsDone) return;
    fontsDone = true;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONTS_HREF;
    document.head.appendChild(l);
  }

  // ───────────────────────── the modal ─────────────────────────
  var S = null; // state of the currently open modal

  function close() {
    if (!S) return;
    document.removeEventListener('keydown', S.onKey, true);
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S = null;
  }

  function open(opts) {
    opts = opts || {};
    injectCss();
    loadFonts();
    close();

    var accent = opts.accent || '#0073E6';
    var root = document.createElement('div');
    root.className = 'sgx-ov';
    root.style.setProperty('--sgx-accent', accent);
    root.style.setProperty('--sgx-rgb', hexToRgb(accent));
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<div class="sgx-card">' +
        '<div class="sgx-head"><h3 class="sgx-title">' + esc(opts.title || 'Add your signature') + '</h3>' +
        '<button type="button" class="sgx-x" data-a="cancel" aria-label="Close">&times;</button></div>' +
        '<div class="sgx-tabs">' +
          '<button type="button" class="sgx-tab on" data-tab="draw">Draw</button>' +
          '<button type="button" class="sgx-tab" data-tab="type">Type</button>' +
          '<button type="button" class="sgx-tab" data-tab="upload">Upload</button>' +
        '</div>' +

        // DRAW
        '<div data-pane="draw">' +
          '<div class="sgx-pad"><canvas width="' + CW + '" height="' + CH + '" data-el="draw"></canvas>' +
            '<div class="sgx-guide"></div><div class="sgx-xm">&times;</div>' +
            '<div class="sgx-ph" data-el="ph">Sign here with your finger or mouse</div></div>' +
          '<div class="sgx-row" style="margin-top:10px">' +
            '<span class="sgx-lab">Ink</span>' +
            INKS.map(function (c, i) { return '<button type="button" class="sgx-dot' + (i === 0 ? ' on' : '') + '" data-ink="' + c + '" style="background:' + c + '" aria-label="Ink colour"></button>'; }).join('') +
            '<span class="sgx-sp"></span>' +
            '<button type="button" class="sgx-mini" data-a="undo">Undo</button>' +
            '<button type="button" class="sgx-mini" data-a="clear">Clear</button>' +
          '</div>' +
          '<label class="sgx-check" style="margin-top:9px"><input type="checkbox" data-el="smooth" checked> Smart smoothing: straighten shaky lines into a clean signature</label>' +
        '</div>' +

        // TYPE
        '<div data-pane="type" style="display:none">' +
          '<input class="sgx-in" type="text" maxlength="40" placeholder="Type your full name" data-el="typed" autocomplete="off">' +
          '<div class="sgx-fonts" style="margin:10px 0" data-el="fonts">' +
            FONTS.map(function (f, i) { return '<button type="button" class="sgx-font' + (i === 0 ? ' on' : '') + '" data-font="' + i + '" style="font-family:' + f.css + ';font-weight:' + f.w + '">Aa</button>'; }).join('') +
          '</div>' +
          '<div class="sgx-pad type"><canvas width="' + CW + '" height="' + CH + '" data-el="typecv"></canvas><div class="sgx-guide"></div></div>' +
          '<div class="sgx-row" style="margin-top:10px"><span class="sgx-lab">Ink</span>' +
            INKS.map(function (c, i) { return '<button type="button" class="sgx-dot' + (i === 0 ? ' on' : '') + '" data-ink="' + c + '" style="background:' + c + '" aria-label="Ink colour"></button>'; }).join('') +
          '</div>' +
        '</div>' +

        // UPLOAD
        '<div data-pane="upload" style="display:none">' +
          '<div class="sgx-drop" data-el="drop" tabindex="0"><b>Click to upload</b> or drop a file here' +
            '<small>Image (PNG, JPG) or PDF &middot; PDFs up to ' + fmtSize(MAX_PDF_BYTES) + '</small></div>' +
          '<input type="file" data-el="file" accept="image/*,application/pdf,.pdf" style="display:none">' +
          '<div data-el="upres" style="display:none;flex-direction:column;gap:10px">' +
            '<div class="sgx-prev"><img data-el="upimg" alt="Signature preview"></div>' +
            '<div class="sgx-chip"><div class="ic" data-el="upic">IMG</div><div class="tx"><b data-el="upname"></b><small data-el="upmeta"></small></div>' +
              '<button type="button" class="sgx-mini" data-a="rmfile">Remove</button></div>' +
            '<label class="sgx-check" data-el="bgrow"><input type="checkbox" data-el="bg" checked> Remove white background (best for a photo of a signature on paper)</label>' +
            '<p class="sgx-note" data-el="pdfnote" style="display:none">Page 1 of your PDF is used as the signature. Your original PDF is submitted along with the form.</p>' +
          '</div>' +
        '</div>' +

        '<div class="sgx-err" data-el="err" role="alert"></div>' +
        '<div class="sgx-foot">' +
          '<button type="button" class="sgx-btn" data-a="cancel">Cancel</button>' +
          '<button type="button" class="sgx-btn pri" data-a="ok" data-el="ok">Use signature</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    S = {
      root: root, opts: opts, tab: 'draw', ink: INKS[0], smooth: true,
      strokes: [], cur: null, drawing: false, rawLast: null,
      fontIdx: 0, up: null, busy: false
    };
    var q = function (n) { return root.querySelector('[data-el="' + n + '"]'); };
    var cv = q('draw'), tcv = q('typecv');

    S.onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    document.addEventListener('keydown', S.onKey, true);

    function cancel() {
      var cb = S && S.opts.onCancel;
      close();
      if (cb) cb();
    }
    function showErr(msg) {
      var e = q('err');
      e.textContent = msg || '';
      e.classList.toggle('show', !!msg);
    }

    // ── tabs ──
    function setTab(t) {
      S.tab = t;
      showErr('');
      ['draw', 'type', 'upload'].forEach(function (p) {
        root.querySelector('[data-pane="' + p + '"]').style.display = (p === t) ? '' : 'none';
      });
      Array.prototype.forEach.call(root.querySelectorAll('.sgx-tab'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === t);
      });
      if (t === 'type') { renderTyped(); setTimeout(function () { q('typed').focus(); }, 30); }
    }

    // ── draw (same smoothing technique as the PDF Editor signature pad) ──
    var LW = 4.8;
    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
    }
    function redraw() {
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.lineWidth = LW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      S.strokes.forEach(function (s) {
        var pts = s.pts;
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
        ctx.beginPath();
        if (pts.length < 2) {
          ctx.arc(pts[0].x, pts[0].y, LW / 2, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        if (!S.smooth || pts.length < 3) {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          return;
        }
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var j = 1; j < pts.length - 1; j++) {
          var mx = (pts[j].x + pts[j + 1].x) / 2, my = (pts[j].y + pts[j + 1].y) / 2;
          ctx.quadraticCurveTo(pts[j].x, pts[j].y, mx, my);
        }
        var last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      });
      q('ph').style.display = S.strokes.length ? 'none' : '';
    }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      var p = pos(e);
      S.drawing = true;
      S.cur = { color: S.ink, pts: [p] };
      S.strokes.push(S.cur);
      S.rawLast = p;
      showErr('');
      redraw();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!S.drawing) return;
      e.preventDefault();
      var raw = pos(e), p = raw;
      if (S.smooth) {
        var l = S.rawLast; // low-pass filter: absorbs hand tremor
        p = { x: l.x * 0.35 + raw.x * 0.65, y: l.y * 0.35 + raw.y * 0.65 };
      }
      S.rawLast = raw;
      S.cur.pts.push(p);
      redraw();
    });
    function endStroke() { if (S) { S.drawing = false; S.cur = null; } }
    cv.addEventListener('pointerup', endStroke);
    cv.addEventListener('pointercancel', endStroke);
    cv.addEventListener('lostpointercapture', endStroke);
    q('smooth').addEventListener('change', function (e) { S.smooth = e.target.checked; redraw(); });

    // ── type ──
    function renderTyped() {
      var ctx = tcv.getContext('2d');
      ctx.clearRect(0, 0, tcv.width, tcv.height);
      var text = q('typed').value.trim();
      if (!text) return;
      var f = FONTS[S.fontIdx];
      var size = 130;
      ctx.font = f.w + ' ' + size + 'px ' + f.css;
      var w = ctx.measureText(text).width;
      while (w > tcv.width - 70 && size > 26) {
        size -= 4;
        ctx.font = f.w + ' ' + size + 'px ' + f.css;
        w = ctx.measureText(text).width;
      }
      ctx.fillStyle = S.ink;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, (tcv.width - w) / 2, tcv.height * 0.72);
    }
    function ensureFontThenRender() {
      var f = FONTS[S.fontIdx];
      var txt = q('typed').value || 'Aa';
      if (document.fonts && document.fonts.load) {
        document.fonts.load(f.w + ' 60px "' + f.name + '"', txt).then(function () { if (S) renderTyped(); }, function () { /* fallback font already applied */ });
      }
      renderTyped();
    }
    q('typed').addEventListener('input', ensureFontThenRender);
    q('fonts').addEventListener('click', function (e) {
      var b = e.target.closest('[data-font]');
      if (!b) return;
      S.fontIdx = parseInt(b.getAttribute('data-font'), 10) || 0;
      Array.prototype.forEach.call(q('fonts').children, function (x) { x.classList.toggle('on', x === b); });
      ensureFontThenRender();
    });

    // ── ink colour (shared by Draw + Type) ──
    root.addEventListener('click', function (e) {
      var d = e.target.closest('[data-ink]');
      if (d) {
        S.ink = d.getAttribute('data-ink');
        Array.prototype.forEach.call(root.querySelectorAll('.sgx-dot'), function (x) {
          x.classList.toggle('on', x.getAttribute('data-ink') === S.ink);
        });
        if (S.tab === 'type') renderTyped();
        return;
      }
      var t = e.target.closest('[data-tab]');
      if (t) { setTab(t.getAttribute('data-tab')); return; }
      var a = e.target.closest('[data-a]');
      if (!a) return;
      var act = a.getAttribute('data-a');
      if (act === 'cancel') cancel();
      else if (act === 'clear') { S.strokes = []; redraw(); }
      else if (act === 'undo') { S.strokes.pop(); redraw(); }
      else if (act === 'rmfile') { clearUpload(); }
      else if (act === 'ok') confirm();
    });

    // ── upload (image or PDF) ──
    var fileIn = q('file'), drop = q('drop');
    drop.addEventListener('click', function () { fileIn.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (f) handleFile(f);
    });
    q('bg').addEventListener('change', function () {
      if (S.up && S.up.kind === 'image') {
        S.up.image = processImage(S.up.img, q('bg').checked);
        q('upimg').src = S.up.image;
      }
    });
    function clearUpload() {
      S.up = null;
      q('upres').style.display = 'none';
      drop.style.display = '';
      showErr('');
    }
    function showUpload() {
      var u = S.up;
      drop.style.display = 'none';
      q('upres').style.display = 'flex';
      q('upname').textContent = u.name;
      q('upmeta').textContent = fmtSize(u.size) + (u.kind === 'pdf' ? ' \u00b7 PDF' + (u.pages > 1 ? ' \u00b7 ' + u.pages + ' pages' : '') : ' \u00b7 Image');
      q('upic').textContent = u.kind === 'pdf' ? 'PDF' : 'IMG';
      q('bgrow').style.display = u.kind === 'image' ? '' : 'none';
      q('pdfnote').style.display = u.kind === 'pdf' ? '' : 'none';
      var im = q('upimg');
      if (u.image) { im.style.display = ''; im.src = u.image; } else { im.style.display = 'none'; }
    }
    function handleFile(file) {
      showErr('');
      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      var isImg = /^image\//.test(file.type || '');
      if (!isPdf && !isImg) { showErr('Please choose an image (PNG or JPG) or a PDF file.'); return; }
      if (isPdf && file.size > MAX_PDF_BYTES) {
        showErr('That PDF is ' + fmtSize(file.size) + '. Please keep it under ' + fmtSize(MAX_PDF_BYTES) + ', or upload a photo or screenshot of it instead.');
        return;
      }
      if (isImg && file.size > MAX_IMG_BYTES) { showErr('That image is too large. Please pick one under ' + fmtSize(MAX_IMG_BYTES) + '.'); return; }

      S.busy = true;
      var ok = q('ok');
      ok.disabled = true;
      var origLabel = ok.textContent;
      ok.innerHTML = '<span class="sgx-spin"></span>Reading file';
      var done = function () { if (!S) return; S.busy = false; ok.disabled = false; ok.textContent = origLabel; };

      if (isImg) {
        loadImage(file).then(function (img) {
          if (!S) return;
          S.up = { kind: 'image', name: file.name || 'signature', size: file.size, img: img, image: processImage(img, q('bg').checked) };
          showUpload(); done();
        }).catch(function () { showErr('That image could not be read. Try a PNG or JPG.'); done(); });
        return;
      }
      Promise.all([readAsDataUrl(file), readAsBuffer(file)]).then(function (r) {
        var dataUrl = r[0], buf = r[1];
        var base = { kind: 'pdf', name: file.name || 'signature.pdf', size: file.size, fileDataUrl: dataUrl, image: null, pages: 1 };
        return renderPdfFirstPage(buf).then(function (res) {
          base.image = res.canvas.toDataURL('image/jpeg', 0.85);
          base.pages = res.pages;
          return base;
        }).catch(function () {
          // Could not preview (password protected, or pdf.js blocked): still accept the original file.
          base.noPreview = true;
          return base;
        });
      }).then(function (u) {
        if (!S) return;
        S.up = u;
        showUpload();
        if (u.noPreview) showErr('Preview is not available for this PDF, but it will still be submitted as your signature file.');
        done();
      }).catch(function () { showErr('That file could not be read.'); done(); });
    }

    // ── confirm ──
    function confirm() {
      if (S.busy) return;
      var val = null;
      if (S.tab === 'draw') {
        if (!S.strokes.length) { showErr('Please draw your signature first.'); return; }
        val = { v: 1, method: 'draw', image: encodeInk(cv), file: null };
      } else if (S.tab === 'type') {
        if (!q('typed').value.trim()) { showErr('Please type your name first.'); return; }
        renderTyped();
        val = { v: 1, method: 'type', image: encodeInk(tcv), file: null };
      } else {
        if (!S.up) { showErr('Please choose an image or a PDF to upload.'); return; }
        var u = S.up;
        val = {
          v: 1, method: 'upload', image: u.image || null,
          file: u.kind === 'pdf' ? { name: u.name, type: 'application/pdf', size: u.size, dataUrl: u.fileDataUrl } : null,
          sourceName: u.name
        };
      }
      val.signedAt = new Date().toISOString();
      var cb = S.opts.onDone;
      close();
      if (cb) cb(val);
    }

    redraw();
  }

  window.SarvarcSign = {
    open: open,
    close: close,
    parse: parse,
    toAnswer: toAnswer,
    fmtSize: fmtSize,
    MAX_PDF_BYTES: MAX_PDF_BYTES
  };
})();
