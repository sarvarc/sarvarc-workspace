// ─── WORKSTYLE: READ A STYLE STRAIGHT FROM ANY PDF FILE ─────────────────────
// Lets the person hand over ANY PDF as a reference, with no "Make Editable"
// step first. The real text, fonts and sizes come from the PDF itself (pdf.js),
// colors and the page background are sampled from a rendered copy of the page,
// and image slots come from the page's drawing instructions.
//
// The result is turned into the same editor-shaped page model the editor uses
// (placedTexts / placedTables / placedImages) and handed to wstyleMeasurePage()
// in js/59-workstyle.js, so a style read from a PDF file and a style read from
// the editor have exactly the same shape.
//
// Honest limits (v1):
//   - Needs real text in the PDF. A scanned PDF (text is only a picture) throws
//     a clear error, since there is nothing to measure.
//   - Tables are found by ALIGNED COLUMNS of text (3 or more rows). Tables drawn
//     with borders but no aligned text are not detected. Ruled lines, boxes and
//     decorative shapes are not measured yet.
//   - Top of a text box is estimated from the baseline (about 0.95 of the size).
//
// Units: pdf.js gives points (1/72 inch). The editor model uses CSS pixels
// (96 per inch), so everything is scaled by 96/72 before measuring. All saved
// values are percent of the page, so the unit does not matter in the result.

const WSTYLE_PDF_SCALE = 96 / 72;
const WSTYLE_PDF_MAX_PAGES = 12;

// ─── font names ──────────────────────────────────────────────────────────────
// "ABCDEF+Roboto-BoldItalic" -> { family: 'Roboto', bold: true, italic: true }
function wstylePdfFontInfo(rawName) {
  let n = String(rawName || '').replace(/^[A-Z]{6}\+/, '');
  const bold = /bold|black|heavy|semibold|demi|extrabold/i.test(n);
  const italic = /italic|oblique/i.test(n);
  n = n.split(/[-,]/)[0];
  const known = {
    ArialMT: 'Arial', Arial: 'Arial', Helvetica: 'Helvetica', TimesNewRomanPSMT: 'Times New Roman',
    TimesNewRoman: 'Times New Roman', CourierNewPSMT: 'Courier New', Calibri: 'Calibri',
    Cambria: 'Cambria', Georgia: 'Georgia', Verdana: 'Verdana', TrebuchetMS: 'Trebuchet MS'
  };
  if (known[n]) n = known[n];
  else {
    n = n.replace(/(PSMT|PS|MT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  }
  if (!/^[\w \-'",]{2,60}$/.test(n)) n = 'Inter';
  return { family: n, bold: bold, italic: italic };
}

async function wstylePdfFontOf(page, fontKey, cache) {
  if (cache[fontKey]) return cache[fontKey];
  let info = { family: 'Inter', bold: false, italic: false };
  try {
    const f = page.commonObjs.has(fontKey) ? page.commonObjs.get(fontKey) : null;
    if (f && f.name) info = wstylePdfFontInfo(f.name);
  } catch (e) { /* keep default */ }
  cache[fontKey] = info;
  return info;
}

// ─── pixels: color sampling from a rendered copy of the page ─────────────────
function wstylePdfRgbToHex(r, g, b) {
  const h = function (n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); };
  return '#' + h(r) + h(g) + h(b);
}

// Ink color of a box: the pixel in the box that differs most from the box's own
// corner background. Falls back to dark text on light, light text on dark.
function wstylePdfInkColor(cx, W, H, box, fallback) {
  try {
    const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
    const w = Math.max(2, Math.min(W - x0, Math.ceil(box.w))), h = Math.max(2, Math.min(H - y0, Math.ceil(box.h)));
    const d = cx.getImageData(x0, y0, w, h).data;
    const px = function (xx, yy) { const i = (yy * w + xx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const cs = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    const bg = [0, 1, 2].map(function (k) { return (cs[0][k] + cs[1][k] + cs[2][k] + cs[3][k]) / 4; });
    let best = null, bestD = 60;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (dist > bestD) { bestD = dist; best = [d[i], d[i + 1], d[i + 2]]; }
    }
    if (best) return wstylePdfRgbToHex(best[0], best[1], best[2]);
    return ((bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000) > 140 ? '#111111' : '#f5f5f5';
  } catch (e) { return fallback; }
}

function wstylePdfPixel(cx, W, H, x, y) {
  try {
    const xx = Math.max(0, Math.min(W - 1, Math.round(x))), yy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const d = cx.getImageData(xx, yy, 1, 1).data;
    return wstylePdfRgbToHex(d[0], d[1], d[2]);
  } catch (e) { return null; }
}

// ─── text -> lines -> segments -> tables / blocks ────────────────────────────
// A "run" is one pdf.js text item. Runs on the same baseline and size become a
// line; a big gap inside a line splits it into SEGMENTS (cells, if it is a table).
function wstylePdfBuildLines(runs) {
  runs.sort(function (a, b) { return (a.base - b.base) || (a.x - b.x); });
  const lines = [];
  runs.forEach(function (r) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.base - r.base) <= Math.max(1.5, r.size * 0.3) && Math.abs(last.size - r.size) <= 0.6) {
      last.runs.push(r);
    } else {
      lines.push({ base: r.base, size: r.size, runs: [r] });
    }
  });
  lines.forEach(function (ln) {
    ln.runs.sort(function (a, b) { return a.x - b.x; });
    const segs = [];
    ln.runs.forEach(function (r) {
      const s = segs[segs.length - 1];
      const gap = s ? r.x - s.right : 0;
      if (s && gap <= ln.size * 1.2) {
        s.text += (gap > ln.size * 0.18 && !/\s$/.test(s.text) && !/^\s/.test(r.str) ? ' ' : '') + r.str;
        s.right = Math.max(s.right, r.x + r.w);
        s.bold = s.bold || r.bold;
      } else {
        segs.push({ text: r.str, x: r.x, right: r.x + r.w, font: r.font, bold: r.bold, italic: r.italic, size: r.size });
      }
    });
    segs.forEach(function (s) { s.text = s.text.replace(/\s+/g, ' ').trim(); });
    ln.segs = segs.filter(function (s) { return s.text; });
    ln.x = Math.min.apply(null, ln.segs.map(function (s) { return s.x; }));
    ln.right = Math.max.apply(null, ln.segs.map(function (s) { return s.right; }));
  });
  return lines.filter(function (ln) { return ln.segs.length; });
}

// Rows with the same number of segments (2 or more) whose segment starts line
// up, 3 or more in a row, form a table.
function wstylePdfFindTables(lines) {
  const tables = [], used = {};
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    if (a.segs.length < 2) { i++; continue; }
    let j = i + 1;
    const cols = a.segs.length;
    while (j < lines.length) {
      const b = lines[j], prev = lines[j - 1];
      if (b.segs.length !== cols) break;
      if (b.base - prev.base > Math.max(a.size * 3.2, 40)) break;
      // columns line up if each segment starts, ends, or is centred like the one above it
      let ok = true;
      for (let c = 0; c < cols; c++) {
        const p = a.segs[c], q = b.segs[c];
        const left = Math.abs(p.x - q.x) <= 4, right = Math.abs(p.right - q.right) <= 4;
        const mid = Math.abs((p.x + p.right) / 2 - (q.x + q.right) / 2) <= 4;
        if (!(left || right || mid)) { ok = false; break; }
      }
      if (!ok) break;
      j++;
    }
    if (j - i >= 3) {
      const rows = lines.slice(i, j);
      tables.push(rows);
      rows.forEach(function (r) { used[lines.indexOf(r)] = true; });
      i = j;
    } else i++;
  }
  return { tables: tables, used: used };
}

// Single lines that follow each other with the same look and the same left edge
// (or the same centre) are one paragraph block.
function wstylePdfBuildBlocks(lines) {
  const blocks = [];
  lines.forEach(function (ln) {
    const seg = ln.segs[0];
    const text = ln.segs.map(function (s) { return s.text; }).join(' ');
    const last = blocks[blocks.length - 1];
    const sameLook = last && Math.abs(last.size - ln.size) <= 0.6 && last.font === seg.font && last.bold === seg.bold && last.italic === seg.italic;
    const vgap = last ? ln.base - last.lastBase : 0;
    const leftAligned = last && Math.abs(last.x - ln.x) <= 3;
    const centred = last && Math.abs((last.x + last.right) / 2 - (ln.x + ln.right) / 2) <= 4;
    if (sameLook && vgap > 0 && vgap <= ln.size * 1.9 && (leftAligned || centred)) {
      last.lines.push(text);
      last.lastBase = ln.base;
      last.x = Math.min(last.x, ln.x);
      last.right = Math.max(last.right, ln.right);
      last.centredHits += centred && !leftAligned ? 1 : 0;
    } else {
      blocks.push({ lines: [text], base: ln.base, lastBase: ln.base, size: ln.size, x: ln.x, right: ln.right,
        font: seg.font, bold: seg.bold, italic: seg.italic, centredHits: 0 });
    }
  });
  return blocks;
}

// ─── images from the drawing instructions ────────────────────────────────────
async function wstylePdfImageSlots(page, H, W) {
  const slots = [];
  try {
    const OPS = pdfjsLib.OPS;
    const ol = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = function (m, n) {
      return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, ol.argsArray[i]);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
        const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
        const left = Math.min(ctm[4], ctm[4] + ctm[0] + ctm[2]);
        const bottom = Math.min(ctm[5], ctm[5] + ctm[1] + ctm[3]);
        if (w < 8 || h < 8) continue; // specks and rules, not image slots
        slots.push({ x: left, y: H - (bottom + h), w: w, h: h, full: w >= W * 0.9 && h >= H * 0.9 });
      }
    }
  } catch (e) { /* no image info, carry on without slots */ }
  return slots;
}


// Lines and boxes: filled rectangles (header bars, panels, side strips), thin filled rectangles (rules),
// and straight stroked lines. Read from the page's drawing instructions, so colors and sizes are exact.
// Curves, gradients and clipped art are not read. Results are in PDF points, y from the top.
async function wstylePdfShapes(page, H, W) {
  const out = [];
  try {
    const OPS = pdfjsLib.OPS;
    const ol = await page.getOperatorList();
    const mul = function (m, n) {
      return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    };
    // pdf.js hands colors over as a typed array (0-255) or, in newer builds, a "#rrggbb" string
    const col = function (a) {
      if (typeof a === 'string') return /^#[0-9a-f]{6}$/i.test(a) ? a.toLowerCase() : null;
      if (a && typeof a.length === 'number' && a.length >= 3) return wstylePdfRgbToHex(a[0], a[1], a[2]);
      return null;
    };
    const gray = function (g) { const v = Math.round((Number(g) || 0) * 255); return wstylePdfRgbToHex(v, v, v); };
    let st = { ctm: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lw: 1 };
    const stack = [];
    let subs = [], sub = null;
    const pt = function (x, y) { return [st.ctm[0] * x + st.ctm[2] * y + st.ctm[4], H - (st.ctm[1] * x + st.ctm[3] * y + st.ctm[5])]; };
    const flat = function (p, q) { return Math.abs(p[0] - q[0]) < 0.6 || Math.abs(p[1] - q[1]) < 0.6; };
    const paint = function (doFill, doStroke) {
      const sc = Math.hypot(st.ctm[0], st.ctm[1]) || 1;
      subs.forEach(function (sb) {
        if (sb.curved || sb.pts.length < 2) return;
        const P = sb.pts.map(function (q) { return pt(q[0], q[1]); });
        if (P.length > 2 && Math.abs(P[0][0] - P[P.length - 1][0]) < 0.6 && Math.abs(P[0][1] - P[P.length - 1][1]) < 0.6) P.pop();
        const xs = P.map(function (q) { return q[0]; }), ys = P.map(function (q) { return q[1]; });
        const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        let isBox = sb.rect;
        if (!isBox && P.length === 4) isBox = flat(P[0], P[1]) && flat(P[1], P[2]) && flat(P[2], P[3]) && flat(P[3], P[0]);
        if (isBox) {
          out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: doFill ? st.fill : null, stroke: doStroke ? st.stroke : null, sw: st.lw * sc });
        } else if (doStroke) {
          for (let i = 0; i + 1 < P.length + (sb.closed ? 1 : 0); i++) {
            const A = P[i], B = P[(i + 1) % P.length];
            if (flat(A, B)) out.push({ x: Math.min(A[0], B[0]), y: Math.min(A[1], B[1]), w: Math.abs(B[0] - A[0]), h: Math.abs(B[1] - A[1]),
              fill: null, stroke: st.stroke, sw: st.lw * sc, line: true });
          }
        }
      });
      subs = []; sub = null;
    };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === OPS.save) stack.push({ ctm: st.ctm.slice(), fill: st.fill, stroke: st.stroke, lw: st.lw });
      else if (fn === OPS.restore) { if (stack.length) st = stack.pop(); }
      else if (fn === OPS.transform) st.ctm = mul(st.ctm, a);
      else if (fn === OPS.setLineWidth) st.lw = Number(a[0]) || 0;
      else if (fn === OPS.setFillRGBColor) st.fill = col(a) || st.fill;
      else if (fn === OPS.setStrokeRGBColor) st.stroke = col(a) || st.stroke;
      else if (fn === OPS.setFillGray) st.fill = gray(a[0]);
      else if (fn === OPS.setStrokeGray) st.stroke = gray(a[0]);
      else if (fn === OPS.constructPath) {
        const ops = a[0], co = a[1];
        let k = 0;
        for (let j = 0; j < ops.length; j++) {
          const o = ops[j];
          if (o === OPS.rectangle) {
            subs.push({ pts: [[co[k], co[k + 1]], [co[k] + co[k + 2], co[k + 1] + co[k + 3]]], rect: true }); sub = null; k += 4;
          } else if (o === OPS.moveTo) { sub = { pts: [[co[k], co[k + 1]]] }; subs.push(sub); k += 2; }
          else if (o === OPS.lineTo) { if (!sub) { sub = { pts: [[co[k], co[k + 1]]] }; subs.push(sub); } else sub.pts.push([co[k], co[k + 1]]); k += 2; }
          else if (o === OPS.curveTo) { if (sub) sub.curved = true; k += 6; }
          else if (o === OPS.curveTo2 || o === OPS.curveTo3) { if (sub) sub.curved = true; k += 4; }
          else if (o === OPS.closePath) { if (sub) sub.closed = true; }
        }
      }
      else if (fn === OPS.stroke || fn === OPS.closeStroke) paint(false, true);
      else if (fn === OPS.fill || fn === OPS.eoFill) paint(true, false);
      else if (fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) paint(true, true);
      else if (fn === OPS.endPath) { subs = []; sub = null; }
    }
  } catch (e) { /* no shapes, carry on */ }

  // keep what is worth rebuilding
  const seen = {}, keep = [];
  out.forEach(function (r) {
    const thin = Math.min(r.w, r.h) <= 2.5;
    const white = r.fill && !r.stroke && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/.test(r.fill) && r.fill >= '#fafafa';
    if (r.w < 1.5 && r.h < 1.5) return;
    if (r.w >= W * 0.9 && r.h >= H * 0.9) return;                  // the page background, measured separately
    if (white) return;
    if (!r.line && !r.fill && !(r.stroke && r.sw >= 0.4)) return;
    const key = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.fill, r.stroke].join('|');
    if (seen[key]) return; seen[key] = 1;
    keep.push({ x: r.x, y: r.y, w: r.w, h: r.h, fill: r.fill, stroke: r.stroke, sw: r.sw, rule: r.line || thin });
  });
  return keep.slice(0, 40);
}

// ─── one PDF page -> editor-shaped page model -> measured page ───────────────
async function wstylePdfMeasurePage(pdfPage, pageNo) {
  const vp = pdfPage.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height; // points

  await pdfPage.getOperatorList().catch(function () {}); // loads the real font names
  const tc = await pdfPage.getTextContent();
  const fontCache = {};
  const runs = [];
  for (let k = 0; k < tc.items.length; k++) {
    const it = tc.items[k];
    if (!it.str || !it.str.trim()) continue;
    const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.transform[3]) || 12;
    const f = await wstylePdfFontOf(pdfPage, it.fontName, fontCache);
    runs.push({ str: it.str, x: it.transform[4], base: H - it.transform[5], w: it.width || 0, size: size,
      font: f.family, bold: f.bold, italic: f.italic });
  }
  if (!runs.length) {
    throw new Error('page ' + pageNo + ' has no real text in it (it looks like a scan), so there is nothing to measure there');
  }

  // Render a small copy for colors and the background.
  let cx = null, cvs = null, dataUrl = '';
  try {
    cvs = document.createElement('canvas');
    cvs.width = Math.max(1, Math.round(W)); cvs.height = Math.max(1, Math.round(H));
    cx = cvs.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cvs.width, cvs.height);
    await pdfPage.render({ canvasContext: cx, viewport: vp }).promise;
    dataUrl = cvs.toDataURL('image/jpeg', 0.5);
  } catch (e) { cx = null; dataUrl = ''; }
  const CW = cvs ? cvs.width : W, CH = cvs ? cvs.height : H;
  const ink = function (box, fallback) { return cx ? wstylePdfInkColor(cx, CW, CH, box, fallback) : fallback; };

  const lines = wstylePdfBuildLines(runs);
  const found = wstylePdfFindTables(lines);
  const restLines = lines.filter(function (ln, idx) { return !found.used[idx]; });
  const blocks = wstylePdfBuildBlocks(restLines);
  const S = WSTYLE_PDF_SCALE;
  const top = function (base, size) { return base - size * 0.95; };

  const placedTexts = blocks.map(function (b) {
    const h = (b.lastBase - b.base) + b.size * 1.25;
    const box = { x: b.x, y: top(b.base, b.size), w: b.right - b.x, h: h };
    const centred = b.centredHits > 0 || (b.lines.length === 1 && Math.abs((b.x + b.right) / 2 - W / 2) <= W * 0.015 && b.x > W * 0.1);
    return {
      id: 'pdf_t' + Math.random().toString(36).slice(2, 7),
      text: b.lines.join('\n'),
      x: box.x * S, y: box.y * S, w: Math.max(box.w, 10) * S,
      fontSize: b.size * S, fontFamily: b.font, bold: b.bold, italic: b.italic, underline: false,
      align: centred ? 'center' : 'left',
      color: ink(box, '#111111'),
      _hOverride: h * S
    };
  });

  const placedTables = found.tables.map(function (rows) {
    const cols = rows[0].segs.length;
    const starts = [], rights = [];
    for (let c = 0; c < cols; c++) {
      starts.push(Math.min.apply(null, rows.map(function (r) { return r.segs[c].x; })));
      rights.push(Math.max.apply(null, rows.map(function (r) { return r.segs[c].right; })));
    }
    const tx = starts[0], tr = rights[cols - 1];
    // Column edges: halfway between one column's widest right edge and the next
    // column's leftmost start. This keeps a right-aligned number column wide enough.
    const edges = [tx];
    for (let c = 0; c < cols - 1; c++) edges.push((rights[c] + starts[c + 1]) / 2);
    edges.push(tr + 7);
    const colWidths = [];
    for (let c = 0; c < cols; c++) colWidths.push(Math.max(10, edges[c + 1] - edges[c]) * S);
    const size = rows[0].size;
    const rowH = [];
    for (let r = 0; r < rows.length; r++) {
      rowH.push((r < rows.length - 1 ? rows[r + 1].base - rows[r].base : (rows[r].base - (r ? rows[r - 1].base : rows[r].base - size * 1.8))) * S);
    }
    const headerBold = rows[0].segs.every(function (s) { return s.bold; }) && !rows[1].segs.every(function (s) { return s.bold; });
    const tTop = top(rows[0].base, size) - size * 0.3;
    // column alignment: numbers that share a right edge but not a left edge are right aligned
    const colAlign = [];
    for (let c = 0; c < cols; c++) {
      const lefts = rows.slice(1).map(function (r) { return r.segs[c].x; });
      const rts = rows.slice(1).map(function (r) { return r.segs[c].right; });
      const spread = function (a) { return Math.max.apply(null, a) - Math.min.apply(null, a); };
      const numeric = rows.slice(1).every(function (r) { return /^[\s$\u20ac\u00a3\u20b9+\-]*[\d.,]+\s*%?$/.test(r.segs[c].text); });
      colAlign.push(c > 0 && spread(rts) <= 4 && (spread(lefts) > 4 || numeric) ? 'right' : 'left');
    }
    const hdrBox = { x: tx, y: tTop, w: tr - tx, h: rowH[0] / S };
    const cellStyles = rows.map(function (r, ri) {
      const rowFill = (cx && ri < 3) ? wstylePdfPixel(cx, CW, CH, tx + 2, top(r.base, size) - size * 0.25) : null;
      return r.segs.map(function (s, ci) {
        return {
          align: colAlign[ci], bold: !!s.bold,
          color: ink({ x: s.x, y: top(r.base, size), w: s.right - s.x, h: size * 1.2 }, '#111111'),
          fill: rowFill
        };
      });
    });
    // the page background is not a "fill": drop fills that match the page corner color
    return {
      id: 'pdf_tb' + Math.random().toString(36).slice(2, 7),
      x: tx * S, y: tTop * S, rows: rows.length, cols: cols,
      colWidths: colWidths, rowHeights: rowH,
      fontSize: size * S, fontFamily: rows[0].segs[0].font,
      headerRow: headerBold || (rows[0].segs[0].font !== rows[1].segs[0].font),
      cells: rows.map(function (r) { return r.segs.map(function (s) { return s.text; }); }),
      cellStyles: cellStyles, _hdrBox: hdrBox
    };
  });

  const slots = await wstylePdfImageSlots(pdfPage, H, W);
  const placedImages = slots.filter(function (s) { return !s.full; }).map(function (s, i) {
    return { id: 'pdf_i' + i, x: s.x * S, y: s.y * S, w: s.w * S, h: s.h * S };
  });

  // Boxes and lines. Anything sitting inside a table is left out: a table grows with its rows, so its
  // grid and row fills are rebuilt by the table itself, not copied as fixed shapes.
  const rawShapes = await wstylePdfShapes(pdfPage, H, W);
  const placedShapes = rawShapes.filter(function (sh) {
    const cxm = sh.x + sh.w / 2, cym = sh.y + sh.h / 2;
    return !placedTables.some(function (tb) {
      const tw = tb.colWidths.reduce(function (a, b) { return a + b; }, 0) / S, th = tb.rowHeights.reduce(function (a, b) { return a + b; }, 0) / S;
      return cxm >= tb.x / S - 4 && cxm <= tb.x / S + tw + 4 && cym >= tb.y / S - 4 && cym <= tb.y / S + th + 4;
    });
  }).map(function (sh) {
    return { x: sh.x * S, y: sh.y * S, w: sh.w * S, h: sh.h * S, fill: sh.fill, stroke: sh.stroke, sw: sh.sw * S, rule: sh.rule };
  });

  const fakePg = {
    type: 'pdf', dataUrl: dataUrl, bgColor: null, placedShapes: placedShapes,
    pageMM: [W * 25.4 / 72, H * 25.4 / 72],
    placedTexts: placedTexts, placedTables: placedTables, placedImages: placedImages
  };
  // idx -1 means "not the page on screen", so measuring never reads the editor's DOM.
  const measured = await wstyleMeasurePage(fakePg, -1);
  measured.index = pageNo - 1;
  measured.fromPdfFile = true;
  return measured;
}

// ─── public: read a PDF file and (optionally) save it as a work style ────────
// file: a File or Blob. Returns { pages, docName }.
async function wstyleReadPdfFile(file, opts) {
  opts = opts || {};
  if (typeof pdfjsLib === 'undefined') throw new Error('the PDF reader did not load, check your connection and refresh');
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = (typeof sarvarcOpenPdfDocument === 'function')
    ? await sarvarcOpenPdfDocument(data)
    : await pdfjsLib.getDocument({ data: data }).promise;
  const n = Math.min(doc.numPages, opts.maxPages || WSTYLE_PDF_MAX_PAGES);
  const pages = [];
  for (let p = 1; p <= n; p++) {
    const pg = await doc.getPage(p);
    pages.push(await wstylePdfMeasurePage(pg, p));
  }
  return { pages: pages, docName: file.name || '', totalPages: doc.numPages };
}

async function wstyleSaveFromPdfFile(file, name) {
  const cleanName = String(name || (file && file.name ? file.name.replace(/\.pdf$/i, '') : '')).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!cleanName) throw new Error('give the work style a name first');
  const read = await wstyleReadPdfFile(file);
  return wstyleStoreMeasured(cleanName, read.pages, { docName: read.docName, scope: 'all', fromPdfFile: true });
}
