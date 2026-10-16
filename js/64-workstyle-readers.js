// ─── WORKSTYLE: READ ANY FILE FORMAT ─────────────────────────────────────────
// Two jobs, both run fully on the device (nothing is uploaded):
//
//   A. REFERENCE  wsReadAnyReference(file) -> saved reference (same store as a PDF reference)
//        PDF            existing PDF reader (js/60)
//        Word .docx     the editor's own Word reader, measured page by page
//        Excel / CSV    the editor's own sheet reader (.xlsx .xlsm .xlsb .xls .ods .csv .tsv)
//        PowerPoint     .pptx, every slide becomes one page (positions, sizes, colors, bold)
//      A reference is measured from real text boxes, so a picture of a page (.png .jpg) or an
//      old .doc / .rtf / .odt cannot be one. wsReadAnyReference says so in plain words.
//
//   B. CONTENT    wsReadAnyContent(file) -> { text, note }
//        PDF (text layer, or OCR when it is a scan), Word, Excel / CSV, PowerPoint,
//        OpenDocument (.odt .odp .ods), RTF, HTML, JSON, images (OCR), and any plain text
//        (.txt .md .log .xml .yaml ...). Old binary .doc is the only thing it refuses.
//
// Needs the libraries already loaded by workspace.html: pdf.js, JSZip, SheetJS, mammoth, Tesseract.

const WSR_MAX_BYTES = 25 * 1024 * 1024;   // per file
const WSR_MAX_TEXT = 24000;               // same cap as js/63-workstyle-fill.js (WSF_MAX_CONTENT)
const WSR_OCR_MAX_PAGES = 6;
const WSR_VISION_MAX = 2;                 // Kadessa vision reads per flattened file, the rest use the free local reader

function wsrExt(file) {
  const m = /\.([a-z0-9]+)$/i.exec(String((file && file.name) || ''));
  return m ? m[1].toLowerCase() : '';
}

function wsrBase(file) {
  return String((file && file.name) || '').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function wsrCheckSize(file) {
  if (file.size > WSR_MAX_BYTES) throw new Error('that file is over 25 MB. Use a smaller one');
}

function wsrIsImage(file, ext) {
  return /^image\//.test(file.type || '') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].indexOf(ext) !== -1;
}

function wsrParseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('that file looks damaged');
  return doc;
}

function wsrDesc(el, name) { return Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)); }

// ═════════════════════════════════════════════════════════════════════════════
// A. REFERENCE
// ═════════════════════════════════════════════════════════════════════════════

// PowerPoint: one page per slide, in the same page shape the editor uses, so the same
// measuring code reads it. EMU (English Metric Unit): 914400 per inch, 36000 per mm.
async function wsrPptxToPages(ab) {
  const zip = await JSZip.loadAsync(ab);
  const pres = zip.file('ppt/presentation.xml');
  if (!pres) throw new Error('that does not look like a PowerPoint file');
  const pdoc = wsrParseXml(await pres.async('string'));
  const sz = wsrDesc(pdoc, 'sldSz')[0];
  const cx = sz ? Number(sz.getAttribute('cx')) || 9144000 : 9144000;
  const cy = sz ? Number(sz.getAttribute('cy')) || 5143500 : 5143500;
  const mmW = Math.round(cx / 360) / 100, mmH = Math.round(cy / 360) / 100;
  const PX = 3.7795, pxW = mmW * PX, pxH = mmH * PX;
  const sx = pxW / cx, sy = pxH / cy;

  const slideNames = Object.keys(zip.files)
    .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
    .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); })
    .slice(0, 40);
  if (!slideNames.length) throw new Error('that PowerPoint has no slides');

  const pages = [];
  let seq = 0;
  for (let i = 0; i < slideNames.length; i++) {
    const doc = wsrParseXml(await zip.file(slideNames[i]).async('string'));
    const pg = {
      type: 'blank', dataUrl: null, modified: true, edits: {}, textBlocks: [],
      placedTexts: [], placedImages: [], placedTables: [], label: 'Slide ' + (i + 1),
      bgColor: '#ffffff', pageMM: [mmW, mmH]
    };
    wsrDesc(doc, 'sp').forEach(function (sp) {
      const off = wsrDesc(sp, 'off')[0], ext = wsrDesc(sp, 'ext')[0];
      if (!off || !ext) return;   // placeholders that inherit position from the layout are skipped
      const paras = wsrDesc(sp, 'p');
      const lines = [];
      let size = 0, bold = false, italic = false, color = '#111111', align = 'left';
      paras.forEach(function (p) {
        const txt = wsrDesc(p, 't').map(function (t) { return t.textContent; }).join('');
        if (!txt.trim()) return;
        lines.push(txt);
        if (!size) {
          const rPr = wsrDesc(p, 'rPr')[0];
          if (rPr) {
            size = (Number(rPr.getAttribute('sz')) || 0) / 100;   // hundredths of a point
            bold = rPr.getAttribute('b') === '1';
            italic = rPr.getAttribute('i') === '1';
            const clr = wsrDesc(rPr, 'srgbClr')[0];
            if (clr && /^[0-9a-f]{6}$/i.test(clr.getAttribute('val') || '')) color = '#' + clr.getAttribute('val').toLowerCase();
          }
          const pPr = wsrDesc(p, 'pPr')[0];
          const al = pPr && pPr.getAttribute('algn');
          align = al === 'ctr' ? 'center' : al === 'r' ? 'right' : 'left';
        }
      });
      if (!lines.length) {
        // no words: a filled box or a bar
        const spPr = wsrDesc(sp, 'spPr')[0];
        const clr = spPr ? wsrDesc(spPr, 'srgbClr')[0] : null;
        if (clr && /^[0-9a-f]{6}$/i.test(clr.getAttribute('val') || '') && !(spPr && wsrDesc(spPr, 'noFill').length)) {
          const bw = Number(ext.getAttribute('cx')) * sx, bh = Number(ext.getAttribute('cy')) * sy;
          if (!(bw >= pxW * 0.9 && bh >= pxH * 0.9)) {
            pg.placedShapes = pg.placedShapes || [];
            pg.placedShapes.push({ x: Number(off.getAttribute('x')) * sx, y: Number(off.getAttribute('y')) * sy, w: bw, h: bh,
              fill: '#' + clr.getAttribute('val').toLowerCase(), stroke: null, sw: 0, rule: Math.min(bw, bh) <= 3 });
          }
        }
        return;
      }
      seq++;
      const px = size ? size * 96 / 72 : 18;   // points to canvas px
      pg.placedTexts.push({
        id: 'ptx_ref' + seq, text: lines.join('\n'),
        x: Number(off.getAttribute('x')) * sx, y: Number(off.getAttribute('y')) * sy,
        w: Number(ext.getAttribute('cx')) * sx, fontSize: Math.round(px * 10) / 10,
        fontFamily: 'Inter', color: color, bold: bold, italic: italic, underline: false, align: align
      });
    });
    wsrDesc(doc, 'pic').forEach(function (pic) {
      const off = wsrDesc(pic, 'off')[0], ext = wsrDesc(pic, 'ext')[0];
      if (!off || !ext) return;
      seq++;
      pg.placedImages.push({
        id: 'pimg_ref' + seq, dataUrl: '', kind: 'image',
        x: Number(off.getAttribute('x')) * sx, y: Number(off.getAttribute('y')) * sy,
        w: Number(ext.getAttribute('cx')) * sx, h: Number(ext.getAttribute('cy')) * sy
      });
    });
    pages.push(pg);
  }
  return pages;
}

async function wsReadAnyReference(file) {
  wsrCheckSize(file);
  const ext = wsrExt(file);
  const name = wsrBase(file) || 'Reference';

  if (ext === 'pdf' || file.type === 'application/pdf') return wstyleSaveFromPdfFile(file);

  let pages = null, docName = file.name || '';
  if (ext === 'docx') {
    const parsed = await oxParseDocx(await file.arrayBuffer());
    if (!parsed.blocks.length) throw new Error('that Word file is empty, so there is nothing to learn from');
    pages = (await oxLayoutWord(parsed)).pages;
  } else if (/^(xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/.test(ext)) {
    pages = (await oxBuildSheetPages(await file.arrayBuffer(), file.name)).pages;
  } else if (ext === 'pptx') {
    pages = await wsrPptxToPages(await file.arrayBuffer());
  } else if (wsrIsImage(file, ext)) {
    throw new Error('a picture has no text boxes to measure. Open it in the editor, run Make Editable, then use "Use the open document". Or attach the PDF, Word or PowerPoint version');
  } else if (/^(doc|rtf|odt|odp|pages|ppt)$/.test(ext)) {
    throw new Error('.' + ext + ' cannot be read as a reference in the browser. Save it as PDF or Word (.docx) and attach that');
  } else {
    throw new Error('this format cannot be a reference. Use PDF, Word (.docx), Excel, CSV or PowerPoint (.pptx)');
  }

  if (!pages || !pages.length) throw new Error('nothing could be read from that file');
  const measured = [];
  for (let i = 0; i < pages.length && i < WSTYLE_MAX_PAGES; i++) {
    measured.push(await wstyleMeasurePage(pages[i], -1));   // -1: not an editor page, use its own size
  }
  return wstyleStoreMeasured(name, measured, { docName: docName, scope: 'all', fromFile: ext });
}

// ═════════════════════════════════════════════════════════════════════════════
// B. CONTENT
// ═════════════════════════════════════════════════════════════════════════════

function wsrReadText(file) {
  return new Promise(function (res, rej) {
    const rd = new FileReader();
    rd.onload = function () { res(String(rd.result || '')); };
    rd.onerror = function () { rej(new Error('could not read that file')); };
    rd.readAsText(file);
  });
}

function wsrTidy(s) {
  return String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function wsrOcrCanvas(canvas) {
  if (typeof Tesseract === 'undefined') throw new Error('the text-from-picture reader did not load, check your connection and refresh');
  const r = await Tesseract.recognize(canvas, 'eng+hin+guj');
  return (r && r.data && r.data.text) || '';
}

// One flattened page or picture. The first WSR_VISION_MAX of a file go to Kadessa vision
// (counts as a Kadessa message). Any failure (not signed in, daily limit, offline) falls back to the local reader.
async function wsrReadPicture(canvas, slot, tally) {
  if (slot < WSR_VISION_MAX && typeof window !== 'undefined' && typeof window.kadessaVisionOcrCall === 'function') {
    try {
      const k = Math.min(1, 2000 / Math.max(canvas.width, canvas.height));
      let c = canvas;
      if (k < 1) {
        c = document.createElement('canvas');
        c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
        c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      }
      const t = await window.kadessaVisionOcrCall(c.toDataURL('image/jpeg', 0.85), '');
      if (t && t.trim().length > 5) { tally.vision++; return t; }
    } catch (e) { /* fall through to the local reader */ }
  }
  tally.local++;
  return wsrOcrCanvas(canvas);
}

function wsrPictureNote(t) {
  const parts = [];
  if (t.vision) parts.push(t.vision + ' read by Kadessa vision');
  if (t.local) parts.push(t.local + ' read by the local reader');
  return parts.join(', ');
}

async function wsrImageText(file, tally) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise(function (res, rej) {
      const im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('could not open that picture')); };
      im.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await wsrReadPicture(c, 0, tally);
  } finally { URL.revokeObjectURL(url); }
}

async function wsrPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = (typeof sarvarcOpenPdfDocument === 'function')
    ? await sarvarcOpenPdfDocument(data) : await pdfjsLib.getDocument({ data: data }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages && out.join('\n').length < WSR_MAX_TEXT * 2; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    let line = '', lastY = null;
    tc.items.forEach(function (it) {
      const y = it.transform ? Math.round(it.transform[5]) : 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : '');
      lastY = y;
    });
    if (line) out.push(line);
    out.push('');
  }
  let text = wsrTidy(out.join('\n'));
  if (text.length >= 20) return { text: text, note: '' };
  // No text layer: it is a scan. Read the first pages as pictures.
  const parts = [], tally = { vision: 0, local: 0 };
  const n = Math.min(doc.numPages, WSR_OCR_MAX_PAGES);
  for (let p = 1; p <= n; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    parts.push(await wsrReadPicture(c, p - 1, tally));
  }
  text = wsrTidy(parts.join('\n\n'));
  return { text: text, note: 'flattened PDF, ' + wsrPictureNote(tally) + (doc.numPages > n ? ' (first ' + n + ' pages)' : '') };
}

async function wsrDocxText(file) {
  if (typeof mammoth === 'undefined') throw new Error('the Word reader did not load, check your connection and refresh');
  const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const root = new DOMParser().parseFromString('<body>' + r.value + '</body>', 'text/html').body;
  const lines = [];
  Array.prototype.slice.call(root.children).forEach(function walk(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') {
      Array.prototype.slice.call(el.querySelectorAll('tr')).forEach(function (tr) {
        lines.push(Array.prototype.slice.call(tr.children).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t'));
      });
    } else if (tag === 'ul' || tag === 'ol') {
      Array.prototype.slice.call(el.children).forEach(function (li) { lines.push('- ' + li.textContent.trim()); });
    } else {
      const t = el.textContent.trim();
      if (t) lines.push(t);
    }
  });
  return wsrTidy(lines.join('\n'));
}

async function wsrSheetText(file) {
  if (typeof XLSX === 'undefined') throw new Error('the Excel reader did not load, check your connection and refresh');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const out = [];
  wb.SheetNames.forEach(function (n) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t', blankrows: false });
    if (!csv.trim()) return;
    if (wb.SheetNames.length > 1) out.push('## ' + n);
    out.push(csv);
  });
  return wsrTidy(out.join('\n'));
}

async function wsrPptxText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
    .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); });
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const doc = wsrParseXml(await zip.file(names[i]).async('string'));
    const lines = wsrDesc(doc, 'p').map(function (p) { return wsrDesc(p, 't').map(function (t) { return t.textContent; }).join(''); }).filter(function (s) { return s.trim(); });
    if (lines.length) out.push('## Slide ' + (i + 1) + '\n' + lines.join('\n'));
  }
  return wsrTidy(out.join('\n\n'));
}

// OpenDocument: .odt (text), .odp (slides), .ods (sheets use the Excel reader)
async function wsrOdfText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const f = zip.file('content.xml');
  if (!f) throw new Error('that file looks damaged');
  const doc = wsrParseXml(await f.async('string'));
  const lines = [];
  Array.prototype.slice.call(doc.getElementsByTagNameNS('*', '*')).forEach(function (el) {
    if (el.localName === 'p' || el.localName === 'h') {
      // skip paragraphs that sit inside a table cell here, the row below handles them
      if (el.parentNode && el.parentNode.localName === 'table-cell') return;
      const t = el.textContent.trim();
      if (t) lines.push(t);
    } else if (el.localName === 'table-row') {
      const cells = Array.prototype.slice.call(el.childNodes).filter(function (c) { return c.localName === 'table-cell'; });
      if (cells.length) lines.push(cells.map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t'));
    }
  });
  return wsrTidy(lines.join('\n'));
}

function wsrRtfText(rtf) {
  let s = String(rtf);
  // drop the groups that never hold visible text (font table, colors, style sheet, pictures, info)
  for (let k = 0; k < 6; k++) s = s.replace(/\{(?:\\\*)?\\(?:fonttbl|colortbl|stylesheet|info|pict|header|footer)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\'([0-9a-f]{2})/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\u(-?\d+)\??/g, function (_, n) { n = Number(n); return String.fromCharCode(n < 0 ? n + 65536 : n); })
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([\\{}])/g, '$1').replace(/[{}]/g, '');
  return wsrTidy(s);
}

function wsrHtmlText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach(function (n) { n.remove(); });
  doc.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
  doc.querySelectorAll('tr').forEach(function (tr) {
    tr.textContent = Array.prototype.slice.call(tr.children).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t') + '\n';
  });
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach(function (n) { n.appendChild(doc.createTextNode('\n')); });
  return wsrTidy(doc.body ? doc.body.textContent : '');
}

// Returns { text, note }. Throws a plain-language error when a format cannot be read.
async function wsReadAnyContent(file) {
  wsrCheckSize(file);
  const ext = wsrExt(file);
  let text = '', note = '';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const r = await wsrPdfText(file); text = r.text; note = r.note;
  } else if (ext === 'docx') {
    text = await wsrDocxText(file);
  } else if (/^(xlsx|xlsm|xlsb|xls|ods)$/.test(ext)) {
    text = await wsrSheetText(file);
  } else if (ext === 'pptx') {
    text = await wsrPptxText(file);
  } else if (ext === 'odt' || ext === 'odp') {
    text = await wsrOdfText(file);
  } else if (ext === 'doc' || ext === 'ppt') {
    throw new Error('old .' + ext + ' files cannot be read in the browser. Save it as .' + ext + 'x or PDF and attach that');
  } else if (wsrIsImage(file, ext)) {
    const tally = { vision: 0, local: 0 };
    text = wsrTidy(await wsrImageText(file, tally)); note = wsrPictureNote(tally);
  } else if (ext === 'rtf') {
    text = wsrRtfText(await wsrReadText(file));
  } else if (ext === 'html' || ext === 'htm') {
    text = wsrHtmlText(await wsrReadText(file));
  } else if (ext === 'json') {
    const raw = await wsrReadText(file);
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { text = raw; }
  } else {
    // txt, md, csv, tsv, log, xml, yaml, or anything else: try it as plain text
    const raw = await wsrReadText(file);
    const bad = (raw.slice(0, 4000).match(/[\u0000\uFFFD]/g) || []).length;
    if (bad > 8) throw new Error('this format cannot be read. Save it as PDF, Word (.docx), Excel, or TXT and attach that');
    text = wsrTidy(raw);
  }

  if (!text) throw new Error('no text was found in ' + (file.name || 'that file'));
  if (text.length > WSR_MAX_TEXT) {
    note = (note ? note + '. ' : '') + 'only the first ' + WSR_MAX_TEXT.toLocaleString('en-US') + ' characters are used';
    text = text.slice(0, WSR_MAX_TEXT);
  }
  return { text: text, note: note };
}
