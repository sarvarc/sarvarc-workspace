/* ===== SARVARC SIGN DOCUMENTS, shared core =====
   Used by BOTH the Workspace (Make Forms > Sign Documents) and the public signing
   page (sign.html), so a document looks and exports identically in both places.

   SarvarcSignDoc.TYPES                      field types you can place (name, phone, ...)
   SarvarcSignDoc.renderPages(dataUrl, s)    -> Promise<[{canvas, w, h}]>  (PDF or image)
   SarvarcSignDoc.composePdf(dataUrl, fields, values) -> Promise<Blob>   (signed PDF)
   SarvarcSignDoc.sigImage(raw)              -> dataURL or null (from a stored signature answer)

   A field is { id, type, label, required, page, x, y, w, h }
   page is 0-based. x, y, w, h are fractions (0 to 1) of the page, so a field stays on the
   same spot whatever size the page is drawn at.
*/
(function () {
  'use strict';
  if (window.SarvarcSignDoc) return;

  var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  var TYPES = [
    { id: 'name',      label: 'Full name',  w: 0.30, h: 0.032, input: 'text' },
    { id: 'phone',     label: 'Phone',      w: 0.22, h: 0.032, input: 'tel' },
    { id: 'email',     label: 'Email',      w: 0.30, h: 0.032, input: 'email' },
    { id: 'date',      label: 'Date',       w: 0.20, h: 0.032, input: 'date' },
    { id: 'text',      label: 'Text',       w: 0.30, h: 0.032, input: 'text' },
    { id: 'signature', label: 'Signature',  w: 0.30, h: 0.075, input: null },
    { id: 'checkbox',  label: 'Checkbox',   w: 0.028, h: 0.020, input: null }
  ];
  function typeInfo(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[4];
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function ensurePdfJs() {
    if (!window.pdfjsLib) await loadScript(PDFJS_SRC);
    if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return window.pdfjsLib;
  }
  async function ensureJsPdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(JSPDF_SRC);
    return window.jspdf.jsPDF;
  }

  function dataUrlToBytes(dataUrl) {
    var b64 = String(dataUrl).split(',')[1] || '';
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function isPdf(dataUrl) { return /^data:application\/pdf/i.test(String(dataUrl || '')); }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('Could not read that image')); };
      im.src = src;
    });
  }

  // scale 1 = the document's natural size (PDF points). Use ~1.5 for the screen, 2 for export.
  async function renderPages(dataUrl, scale) {
    scale = scale || 1.5;
    var out = [];
    if (isPdf(dataUrl)) {
      var lib = await ensurePdfJs();
      var pdf = await lib.getDocument({ data: dataUrlToBytes(dataUrl) }).promise;
      for (var n = 1; n <= pdf.numPages; n++) {
        var page = await pdf.getPage(n);
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: scale });
        var cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        out.push({ canvas: cv, w: base.width, h: base.height });
      }
      return out;
    }
    var img = await loadImage(dataUrl);
    var maxSide = 2400 * (scale / 2);
    var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // Treat an image as an A4-ish page at its own aspect ratio (points).
    var pw = 595, ph = Math.round(595 * c.height / c.width);
    out.push({ canvas: c, w: pw, h: ph });
    return out;
  }

  // A stored signature answer is a JSON string from SarvarcSign.toAnswer(), an object, or a data URL.
  function sigImage(raw) {
    if (!raw) return null;
    try {
      if (window.SarvarcSign && window.SarvarcSign.parse) {
        var p = window.SarvarcSign.parse(raw);
        return p && p.image ? p.image : null;
      }
    } catch (e) { /* fall through */ }
    if (typeof raw === 'string') {
      if (raw.indexOf('data:image') === 0) return raw;
      try { var o = JSON.parse(raw); return o && o.image ? o.image : null; } catch (e2) { return null; }
    }
    return raw && raw.image ? raw.image : null;
  }

  function drawFit(ctx, text, x, y, w, h) {
    var size = Math.max(8, Math.min(h * 0.62, 40));
    ctx.font = size + 'px Helvetica, Arial, sans-serif';
    while (size > 7 && ctx.measureText(text).width > w - 6) {
      size -= 1; ctx.font = size + 'px Helvetica, Arial, sans-serif';
    }
    ctx.fillStyle = '#0A0F1E';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 3, y + h / 2);
  }

  async function composePdf(dataUrl, fields, values) {
    values = values || {};
    var pages = await renderPages(dataUrl, 2);
    var JsPDF = await ensureJsPdf();
    var pdf = null;
    for (var i = 0; i < pages.length; i++) {
      var pg = pages[i], cv = pg.canvas, ctx = cv.getContext('2d');
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        if ((f.page || 0) !== i) continue;
        var v = values[f.id];
        if (v == null || v === '') continue;
        var x = f.x * cv.width, y = f.y * cv.height, w = f.w * cv.width, h = f.h * cv.height;
        if (f.type === 'signature') {
          var src = sigImage(v);
          if (!src) continue;
          try {
            var im = await loadImage(src);
            var r = Math.min(w / im.naturalWidth, h / im.naturalHeight);
            var dw = im.naturalWidth * r, dh = im.naturalHeight * r;
            ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
          } catch (e) { /* skip an unreadable signature */ }
        } else if (f.type === 'checkbox') {
          if (v === '1' || v === 1 || v === true) {
            ctx.strokeStyle = '#0A0F1E'; ctx.lineWidth = Math.max(2, h * 0.14);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x + w * 0.18, y + h * 0.55);
            ctx.lineTo(x + w * 0.42, y + h * 0.80);
            ctx.lineTo(x + w * 0.84, y + h * 0.20);
            ctx.stroke();
          }
        } else {
          drawFit(ctx, String(v), x, y, w, h);
        }
      }
      var orient = pg.w > pg.h ? 'l' : 'p';
      if (!pdf) pdf = new JsPDF({ unit: 'pt', format: [pg.w, pg.h], orientation: orient });
      else pdf.addPage([pg.w, pg.h], orient);
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pg.w, pg.h);
    }
    return pdf.output('blob');
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read that file')); };
      r.readAsDataURL(file);
    });
  }

  window.SarvarcSignDoc = {
    TYPES: TYPES,
    typeInfo: typeInfo,
    renderPages: renderPages,
    composePdf: composePdf,
    sigImage: sigImage,
    fileToDataUrl: fileToDataUrl,
    isPdf: isPdf
  };
})();
