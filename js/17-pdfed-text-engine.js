// ---- Kadessa's own "read this page" helper -----------------------------------
// Same tier order as pdfedExtractPlainTextForPage above (real PDF text layer
// first, local OCR fallback second) but built for Kadessa specifically: it also
// reports a confidence number and, when the OCR tier was needed, the page's
// raster, so the caller can decide whether a paid vision re-read is worth
// offering. A real text layer is used AS-IS whenever one exists -- exact,
// free, and OCR/vision never even run in that case, since there's nothing
// for either to improve on. Only flattened/scanned pages or photos (the
// pdf.js "zero text items" case) ever reach the OCR tier at all.
async function pdfedReadPageForKadessa(pg, worker) {
  try {
    const layerText = await pdfedExtractPdfLayerText(pg);
    if (layerText) return { source: 'text-layer', text: layerText, confidence: 100 };
  } catch (err) {
    console.warn('Kadessa page read (PDF layer) failed, falling back to OCR:', err);
  }
  try {
    const img = await pdfedLoadPageImage(pg);
    if (!img) return { source: 'ocr', text: '', confidence: 0 };
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    if (!canvas.width || !canvas.height) return { source: 'ocr', text: '', confidence: 0 };
    canvas.getContext('2d').drawImage(img, 0, 0);

    const { canvas: ocrCanvas, scale } = pdfedPreprocessForOcr(canvas);
    const { data } = await worker.recognize(ocrCanvas);
    await pdfedRetryWeakLines(canvas, data.lines || [], scale, worker);

    const lines = (data.lines || []).filter(function(l){ return l.text && l.text.trim(); });
    const text = lines
      .filter(function(l){ return l.confidence >= 35; })
      .sort(function(a, b){ return a.bbox.y0 - b.bbox.y0; })
      .map(function(l){ return l.text.trim(); })
      .join('\n');
    const avgConfidence = lines.length
      ? Math.round(lines.reduce(function(sum, l){ return sum + l.confidence; }, 0) / lines.length)
      : 0;
    // Kept at the same resolution OCR itself worked from (not re-rasterized
    // at a different size later) so a follow-up vision re-read reuses this
    // exact image instead of loading/drawing the page a second time.
    return { source: 'ocr', text: text, confidence: avgConfidence, dataUrl: canvas.toDataURL('image/jpeg', 0.85) };
  } catch (err) {
    console.warn('Kadessa page read (OCR) failed:', err);
    return { source: 'ocr', text: '', confidence: 0 };
  }
}

let pdfedExtractedTextResults = null;
// Kadessa's most recent low-confidence OCR read (set by pdfed_read_page below,
// consumed and cleared by pdfed_vision_reread_page). Kept module-level so
// the vision follow-up doesn't need the person to specify a page again and
// doesn't re-rasterize or re-OCR anything -- it just reuses this image.
let pdfedKadessaLastLowConfidenceRead = null; // { pageIdx, dataUrl, ocrText, confidence }

function pdfedOpenExtractChooser() {
  if (pdfed.active < 0) { toast('Open a PDF first', 'error'); return; }
  document.getElementById('pdfedExtractChooserOverlay').classList.add('open');
}
function pdfedCloseExtractChooser() {
  document.getElementById('pdfedExtractChooserOverlay').classList.remove('open');
}

// scope: 'current' (just the page on screen) or 'all' (every page, in order).
async function pdfedRunTextExtraction(scope) {
  if (pdfed.active < 0) { toast('Open a PDF first', 'error'); return; }
  const indices = scope === 'all' ? pdfed.pages.map((_, i) => i) : [pdfed.active];

  pdfedShowOcrProgress('Starting OCR engine…');
  _teOcrProgressCb = pdfedUpdateOcrProgress;
  const results = [];
  try {
    const worker = await pdfedGetOcrWorker();
    for (let n = 0; n < indices.length; n++) {
      const idx = indices[n];
      const pg = pdfed.pages[idx];
      pdfedUpdateOcrProgress(
        n / indices.length,
        indices.length > 1 ? ('Reading page ' + (idx + 1) + ' of ' + pdfed.pages.length + '…') : 'Reading text (OCR)…'
      );
      const text = await pdfedExtractPlainTextForPage(pg, worker);
      results.push({ page: idx + 1, text: text || '' });
    }
  } catch (err) {
    console.warn('Text extraction failed:', err);
    toast(err && err.ocrEngineUnavailable
      ? 'The OCR engine couldn\'t start (check your connection and try again)'
      : 'Something went wrong while extracting text', 'error');
  } finally {
    _teOcrProgressCb = null;
    pdfedHideOcrProgress();
  }

  pdfedShowExtractTextModal(results);
}

function pdfedShowExtractTextModal(results) {
  pdfedExtractedTextResults = results;
  const found = results.filter(r => r.text && r.text.trim());
  const combined = results.length > 1
    ? results.map(r => '--- Page ' + r.page + ' ---\n' + (r.text && r.text.trim() ? r.text : '(no readable text found)')).join('\n\n')
    : (results[0] ? results[0].text : '');

  const sub = document.getElementById('pdfedExtractResultSub');
  if (!found.length) {
    sub.textContent = 'No readable text found — the page(s) may be blank, too blurry, or an image with nothing to read.';
  } else {
    sub.textContent = results.length > 1
      ? (found.length + ' of ' + results.length + ' page' + (results.length !== 1 ? 's' : '') + ' had readable text.'
         + ' Real PDF text where available, OCR for the rest — always double-check scanned pages.')
      : 'Real PDF text where available, OCR for scanned/image pages — always double-check OCR\'d text.';
  }
  document.getElementById('pdfedExtractResultText').value = combined;
  document.getElementById('pdfedExtractResultOverlay').classList.add('open');
}

function pdfedCloseExtractTextModal() {
  document.getElementById('pdfedExtractResultOverlay').classList.remove('open');
}

async function pdfedCopyExtractedText() {
  const text = document.getElementById('pdfedExtractResultText').value;
  if (!text) { toast('Nothing to copy', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Text copied to clipboard', 'success');
  } catch (err) {
    // Clipboard API can be blocked (permissions, insecure context) — fall
    // back to select-all-in-place so the person can still Ctrl/Cmd+C it.
    const ta = document.getElementById('pdfedExtractResultText');
    ta.focus(); ta.select();
    toast('Press Ctrl/Cmd+C to copy the selected text', 'info');
  }
}

function pdfedDownloadExtractedText() {
  const text = document.getElementById('pdfedExtractResultText').value;
  if (!text) { toast('Nothing to download', 'error'); return; }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sarvarcBrandFilename('extracted-text.txt');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Text downloaded', 'success');
}

// Samples a couple of points just outside a text run's bounding box (top-left
// and bottom-right corners, nudged outward so we land on background rather than
// on a glyph stroke) and averages them. This is what lets the "whiteout" patch
// behind edited text match colored letterheads/shaded boxes instead of always
// assuming a plain white page.
// Two sampled colors are treated as "the same" if they're close in RGB space —
// exact string equality is too strict since anti-aliasing noise means the same
// visual color rarely samples to the exact identical hex twice in a row.
function teColorsClose(a, b, threshold) {
  const ca = teParseColorToRgb(a), cb = teParseColorToRgb(b);
  if (!ca || !cb) return a === b;
  const dist = Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
  return dist <= (threshold != null ? threshold : 40);
}

// A cluster's own recognized text tells us which vertical zones of the font's
// em-square it actually occupies: letters with ascenders/caps reach up to
// cap-height, letters with descenders reach below the baseline, and the OCR
// bounding box only ever covers the ink that's actually present. A single
// flat "bbox-height → font-size" ratio gets this wrong in both directions —
// a line with descenders (e.g. "Trading" has none, but "Quantity" does) has
// a taller bbox than cap-height-only text at the IDENTICAL font size, and a
// short all-lowercase word with no ascenders/descenders at all (e.g. "an",
// "was") has a bbox barely taller than its x-height, a much smaller fraction
// of the real font size. Classifying which zones are present and picking the
// matching ratio (calibrated against typical sans-serif metrics: cap-height
// ≈0.72em, x-height ≈0.52em, descender depth ≈0.21em below baseline) keeps
// extracted sizes consistent across a page, instead of descender-heavy
// headings coming out oversized and short lowercase words coming out
// microscopic.
function teClassifyLineVerticalExtent(text) {
  const hasCapOrAscender = /[A-Z0-9BDFHKLTbdfhklt]/.test(text);
  const hasDescender = /[gjpqy]/.test(text);
  if (hasCapOrAscender && hasDescender) return 0.82; // full span cap-height→descender depth
  if (hasCapOrAscender && !hasDescender) return 1.05; // cap-height→baseline only
  if (!hasCapOrAscender && hasDescender) return 1.04; // x-height→descender depth, no caps
  return 1.45; // x-height only — smallest fraction of the em box
}

// Tesseract's default (LSTM) OCR engine, what this app uses, reports NO font
// metadata at all: no bold flag, no font family, nothing. Every OCR'd block was
// previously just hardcoded to normal weight regardless of what the source
// actually looked like, which is why bold headings never came through as bold.
// This estimates weight directly from the rendered pixels instead: bold
// letterforms have meaningfully thicker strokes relative to their height than
// regular weight at the same size, so we measure the median horizontal ink
// "stroke width" through the middle band of the glyphs and compare it against
// the glyph height.
function teEstimateBold(ctx, x, y, w, h, bgColor) {
  if (!ctx) return false;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const ww = Math.max(1, Math.min(Math.round(w), cw - x0));
  const hh = Math.max(1, Math.min(Math.round(h), ch - y0));
  if (ww < 3 || hh < 3) return false;
  let data;
  try { data = ctx.getImageData(x0, y0, ww, hh).data; } catch (e) { return false; }
  const bg = teParseColorToRgb(bgColor) || { r: 255, g: 255, b: 255 };

  const runLengths = [];
  // Middle band only, avoids ascenders/descenders/serifs skewing thickness.
  const rowStart = Math.floor(hh * 0.3), rowEnd = Math.ceil(hh * 0.75);
  for (let row = rowStart; row < rowEnd; row++) {
    let runLen = 0;
    for (let col = 0; col < ww; col++) {
      const idx = (row * ww + col) * 4;
      const dist = Math.sqrt((data[idx] - bg.r) ** 2 + (data[idx + 1] - bg.g) ** 2 + (data[idx + 2] - bg.b) ** 2);
      // Raised from 45, anti-aliased halo pixels around a normal-weight
      // stroke were dark enough to count as "ink" here, which puffed up the
      // measured run length and made regular text look artificially thick.
      if (dist > 70) { runLen++; }
      else if (runLen > 0) { runLengths.push(runLen); runLen = 0; }
    }
    if (runLen > 0) runLengths.push(runLen);
  }
  if (!runLengths.length) return false;
  runLengths.sort((a, b) => a - b);
  const median = runLengths[Math.floor(runLengths.length / 2)];
  // Raised from 0.11, that ratio was tripping on ordinary regular-weight
  // text (especially once combined with the anti-aliasing noise above),
  // which is why almost everything was coming through OCR marked bold.
  return (median / hh) > 0.19; // bold strokes run noticeably thicker relative to letter height
}

// Detects italic/oblique slant straight from the rendered pixels, same
// approach as teEstimateBold above: no font metadata to lean on for OCR'd
// (image-only) text, so weight and slant both have to be read off the glyphs
// themselves. For each row in the middle band of the block, finds the
// horizontal center of mass of the "ink" pixels on that row, then fits a
// straight line (simple linear regression) of that center-x against row
// index. Upright text's ink stays centered on roughly the same x as you scan
// down the glyph, so the fitted slope is near zero; italic text's strokes
// lean, so the center of mass drifts steadily rightward (or leftward, for a
// backslant font) as row increases, producing a consistent non-zero slope.
// Slope is expressed as dx per unit of row height so the same threshold works
// regardless of the block's actual pixel size.
function teEstimateItalic(ctx, x, y, w, h, bgColor) {
  if (!ctx) return false;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const ww = Math.max(1, Math.min(Math.round(w), cw - x0));
  const hh = Math.max(1, Math.min(Math.round(h), ch - y0));
  if (ww < 4 || hh < 6) return false;
  let data;
  try { data = ctx.getImageData(x0, y0, ww, hh).data; } catch (e) { return false; }
  const bg = teParseColorToRgb(bgColor) || { r: 255, g: 255, b: 255 };

  // Skip the very top/bottom rows (ascender/descender tips are sparse and
  // noisy) and work in the stable middle band, same idea as teEstimateBold.
  const rowStart = Math.floor(hh * 0.15), rowEnd = Math.ceil(hh * 0.9);
  const pts = []; // {row, centerX}
  for (let row = rowStart; row < rowEnd; row++) {
    let sum = 0, count = 0;
    for (let col = 0; col < ww; col++) {
      const idx = (row * ww + col) * 4;
      const dist = Math.sqrt((data[idx] - bg.r) ** 2 + (data[idx + 1] - bg.g) ** 2 + (data[idx + 2] - bg.b) ** 2);
      if (dist > 70) { sum += col; count++; }
    }
    if (count >= 1) pts.push({ row, cx: sum / count });
  }
  if (pts.length < Math.max(6, hh * 0.4)) return false; // too little ink to trust a fit (sparse glyphs, thin block)

  // Ordinary least squares slope of cx vs row.
  const n = pts.length;
  const meanRow = pts.reduce((a, p) => a + p.row, 0) / n;
  const meanCx  = pts.reduce((a, p) => a + p.cx, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.row - meanRow) * (p.cx - meanCx); den += (p.row - meanRow) ** 2; }
  if (den === 0) return false;
  const slope = num / den; // horizontal drift per row
  const slant = slope * hh; // total horizontal drift over the block's own height, normalized
  // Real italic fonts commonly sit around a 6-12° slant; 0.12 (~7°) as a
  // floor keeps normal upright text (which still has small nonzero slope from
  // anti-aliasing/serif noise) from tripping this, while still catching a
  // clearly slanted face.
  return Math.abs(slant) > (hh * 0.12);
}

// Detects fixed-width (monospace) text — Courier-style ledger numbers,
// invoice/reference codes, Tally-style exports — straight from the rendered
// pixels, the same way teEstimateBold reads weight. Real-world Indian
// accounting documents lean on monospace far more than typical office docs
// (columnar figures need to line up), and a proportional-font guess on those
// makes extracted numbers visibly misaligned once placed back as editable
// text. Measures the horizontal gaps BETWEEN ink runs (glyph strokes) across
// the block: a fixed-width font gives every character cell — and so every
// inter-character gap — nearly the same width, while a proportional font's
// gaps vary a lot (an "i" sits in a far narrower cell than an "m"). Low
// variation in that gap-width distribution reads as monospace.
function teDetectMonospace(ctx, x, y, w, h, bgColor) {
  if (!ctx) return false;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const ww = Math.max(1, Math.min(Math.round(w), cw - x0));
  const hh = Math.max(1, Math.min(Math.round(h), ch - y0));
  if (ww < 8 || hh < 4) return false;
  let data;
  try { data = ctx.getImageData(x0, y0, ww, hh).data; } catch (e) { return false; }
  const bg = teParseColorToRgb(bgColor) || { r: 255, g: 255, b: 255 };

  const colInk = new Array(ww).fill(false);
  for (let col = 0; col < ww; col++) {
    for (let row = 0; row < hh; row++) {
      const idx = (row * ww + col) * 4;
      const dist = Math.sqrt((data[idx] - bg.r) ** 2 + (data[idx + 1] - bg.g) ** 2 + (data[idx + 2] - bg.b) ** 2);
      if (dist > 60) { colInk[col] = true; break; }
    }
  }

  const gaps = [];
  let inRun = false, gapLen = 0, sawRun = false;
  for (let col = 0; col < ww; col++) {
    if (colInk[col]) {
      if (sawRun && gapLen > 0) gaps.push(gapLen);
      gapLen = 0; inRun = true; sawRun = true;
    } else if (sawRun) {
      gapLen++; inRun = false;
    }
  }
  if (gaps.length < 4) return false; // not enough characters to judge reliably
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean < 1) return false;
  const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  return cv < 0.35; // low variation in gap width = fixed-width font
}

function teSampleBgColor(ctx, x, y, w, h) {
  if (!ctx) return '#ffffff';
  // Sample several points just outside each corner, nudged outward so we land on
  // background rather than a glyph stroke. Using more points + a median (instead
  // of a plain average) makes this resistant to any single point accidentally
  // landing on a neighboring letter in tightly kerned/justified text, an outlier
  // like that would otherwise skew the average and throw off ink-vs-background
  // detection for this run.
  const pts = [
    [x - 3, y - 3],
    [x + w + 3, y - 3],
    [x - 3, y + h + 3],
    [x + w + 3, y + h + 3],
    [x - 3, y + h / 2],
    [x + w + 3, y + h / 2],
  ];
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const samples = [];
  pts.forEach(([px, py]) => {
    const cx = Math.max(0, Math.min(cw - 1, Math.round(px)));
    const cy = Math.max(0, Math.min(ch - 1, Math.round(py)));
    try {
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      samples.push([d[0], d[1], d[2]]);
    } catch (e) { /* tainted/unavailable canvas, fall through to default below */ }
  });
  if (!samples.length) return '#ffffff';
  const mid = arr => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const r = mid(samples.map(s => s[0]));
  const g = mid(samples.map(s => s[1]));
  const b = mid(samples.map(s => s[2]));
  return `rgb(${r}, ${g}, ${b})`;
}

function teRgbToHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// Parses '#rgb' / '#rrggbb' / 'rgb(...)' / 'rgba(...)' strings into {r,g,b}.
// Used so we can compare a sampled pixel against the local background color
// regardless of which string format that background happened to be stored in.
function teParseColorToRgb(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return null;
    const num = parseInt(hex, 16);
    if (Number.isNaN(num)) return null;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  return null;
}

// Samples the actual glyph ("ink") color of a text run off the already-rendered
// page canvas. We can't get fill color from PDF.js's text content API, so instead
// we scan every pixel in the run's bounding box and take a distance-weighted
// average of the ones that differ meaningfully from the local background color
// (computed by teSampleBgColor) — those are the glyph strokes themselves. Weighting
// by distance means solid glyph-body pixels count far more than the lighter
// anti-aliased edge pixels that blend toward the background, so the result tracks
// the true ink color instead of getting washed out. This is what makes colored
// headings, links, and labels keep their real color once you edit them, instead
// of every run silently turning black.
function teSampleTextColor(ctx, x, y, w, h, bgColor) {
  if (!ctx) return '#000000';
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const ww = Math.max(1, Math.min(Math.round(w), cw - x0));
  const hh = Math.max(1, Math.min(Math.round(h), ch - y0));
  if (ww < 1 || hh < 1) return '#000000';

  let data;
  try { data = ctx.getImageData(x0, y0, ww, hh).data; }
  catch (e) { return '#000000'; } // tainted/unavailable canvas, fall back to black

  const bg = teParseColorToRgb(bgColor) || { r: 255, g: 255, b: 255 };

  // Small font sizes, thin strokes, and pastel/low-contrast colors leave mostly
  // anti-aliased edge pixels (low opacity, low contrast from bg) with very few
  // "obviously ink" pixels. A single strict threshold either catches confident
  // colors or catches nothing, so instead we retry with progressively looser
  // alpha/distance gates until we find *something* to average, rather than
  // silently giving up and defaulting to black the first time a run is thin
  // or light-colored.
  const passes = [
    { alpha: 200, dist: 42 },
    { alpha: 120, dist: 24 },
    { alpha: 60,  dist: 12 },
  ];

  for (const p of passes) {
    let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < p.alpha) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dist = Math.sqrt((r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2);
      if (dist > p.dist) { sr += r * dist; sg += g * dist; sb += b * dist; sw += dist; }
    }
    if (sw > 0) return teRgbToHex(sr / sw, sg / sw, sb / sw);
  }

  return '#000000'; // truly nothing distinguishable from background (e.g. blank run) — black is a safe default
}

let _teBlockSeq = 0;
function teAddBlock(opts, overlayEl, interactive) {
  const overlay = overlayEl || document.getElementById('pdfedTextOverlay');
  const el = document.createElement('div');
  el.className = 'pdfed-text-block';
  el.spellcheck = false;
  if (opts.html) el.innerHTML = opts.html;
  else el.textContent = opts.text != null ? opts.text : (opts.origText || '');

  const fs = Math.max(6, Math.round(opts.fontSize));
  el.style.left       = Math.round(opts.x) + 'px';
  el.style.top        = Math.round(opts.y) + 'px';
  el.style.fontSize   = fs + 'px';
  el.style.fontFamily = opts.fontFamily || 'Arial, sans-serif';
  el.style.color      = opts.color || '#000000';
  el.style.fontWeight = opts.bold   ? 'bold'   : 'normal';
  el.style.fontStyle  = opts.italic ? 'italic' : 'normal';

  // Non-free blocks came from real text sitting on the page, cover the original
  // glyphs with an opaque patch (sized to at least their original footprint) so
  // the new text actually REPLACES what was there, instead of just being drawn
  // on top of it and leaving the old text peeking out underneath/around it.
  if (!opts.free) {
    el.style.background = opts.bgColor || '#ffffff';
    el.style.minWidth  = Math.round(opts.origWidth  || 0) + 'px';
    el.style.minHeight = Math.round(opts.origHeight || fs * 1.15) + 'px';
  }

  const blockData = {
    id: opts.id || ('tb' + (++_teBlockSeq)),
    el, origText: opts.origText != null ? opts.origText : (opts.text || ''),
    x: opts.x, y: opts.y,
    fontSize: fs,
    baseFontSize: fs,
    origFontSize: fs, // stable reference for "Reset block" — baseFontSize itself gets overwritten by smart-resize dragging
    fontFamily: opts.fontFamily || 'Arial, sans-serif',
    color: opts.color || '#000000',
    bold: opts.bold || false,
    italic: opts.italic || false,
    free: opts.free || false,
    locked: opts.locked || false,
    origWidth: opts.origWidth || 0,
    origHeight: opts.origHeight || 0,
    bgColor: opts.bgColor || '#ffffff',
  };

  if (!interactive) {
    // Read-only display layer (shown on the canvas outside an active edit session)
    el.contentEditable = 'false';
    el.classList.add('readonly');
    overlay.appendChild(el);
    return blockData;
  }

  teState.blocks.push(blockData);
  el.contentEditable = blockData.locked ? 'false' : 'true';
  el.classList.toggle('locked', blockData.locked);
  el.title = blockData.locked ? 'Locked, click "Lock" again to edit/move' : 'Click to edit · drag the blue dot to move, the corner square to resize';

  // Resize handle, SMART resize: dragging it scales the font size right along
  // with the box (Canva-style), instead of just stretching a fixed-size font
  // into a bigger/smaller box. Scale factor comes from the diagonal distance
  // dragged vs. the box's starting diagonal, so both width and height changes
  // contribute evenly regardless of which direction the user drags in.
  // It's a contenteditable="false" child of the block itself, anchored purely
  // with CSS (bottom/right) — same pattern as the image-crop resize handle
  // elsewhere in this file, so it always tracks the box with no manual
  // left/top math to keep in sync.
  const handle = document.createElement('div');
  handle.className = 'te-resize-handle';
  handle.contentEditable = 'false';
  handle.setAttribute('unselectable', 'on');
  el.appendChild(handle);
  blockData.handleEl = handle;

  // Move handle, a dedicated grab point so repositioning doesn't require
  // holding Shift (which still works too, for muscle memory).
  const moveHandle = document.createElement('div');
  moveHandle.className = 'te-move-handle';
  moveHandle.contentEditable = 'false';
  moveHandle.setAttribute('unselectable', 'on');
  moveHandle.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';
  el.appendChild(moveHandle);
  blockData.moveHandleEl = moveHandle;

  handle.addEventListener('mousedown', ev => {
    if (blockData.locked) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startW = el.offsetWidth, startH = el.offsetHeight;
    const startFontSize = blockData.fontSize;
    const startDiag = Math.sqrt(startW * startW + startH * startH) || 1;
    const sx = ev.clientX, sy = ev.clientY;
    // Switch from the initial min-width/min-height (a floor sized off the OCR
    // guess) to an explicit width/height the moment the user takes manual
    // control, so the box actually shrinks/grows instead of just clamping.
    el.style.width  = startW + 'px';
    el.style.height = startH + 'px';
    const mm = e2 => {
      const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
      const dx = (e2.clientX - sx) / z, dy = (e2.clientY - sy) / z;
      const newW = Math.max(20, startW + dx);
      const newH = Math.max(14, startH + dy);
      const newDiag = Math.sqrt(newW * newW + newH * newH);
      const scale = newDiag / startDiag;

      el.style.width  = newW + 'px';
      el.style.height = newH + 'px';
      blockData.origWidth  = newW;
      blockData.origHeight = newH;

      const newFontSize = Math.max(6, Math.round(startFontSize * scale));
      blockData.fontSize = newFontSize;
      blockData.baseFontSize = newFontSize; // so the +/- size slider keeps working relative to the new size
      el.style.fontSize = newFontSize + 'px';

      el.classList.add('modified');
    };
    const mu = () => {
      document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
      teState.sizeAdj = 0;
      const slider = document.getElementById('teSizeSlider'), val = document.getElementById('teSizeVal');
      if (slider) slider.value = 0;
      if (val) val.textContent = '0';
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  moveHandle.addEventListener('mousedown', ev => {
    if (blockData.locked) return;
    ev.preventDefault();
    ev.stopPropagation();
    const ox = parseInt(el.style.left) || 0, oy = parseInt(el.style.top) || 0;
    const sx = ev.clientX, sy = ev.clientY;
    const mm = e2 => {
      const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
      el.style.left = (ox + (e2.clientX - sx) / z) + 'px';
      el.style.top  = (oy + (e2.clientY - sy) / z) + 'px';
      blockData.x = parseInt(el.style.left);
      blockData.y = parseInt(el.style.top);
      el.classList.add('modified');
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  // Width-only handles (left/right edge bars) — for widening/narrowing the box
  // (e.g. to fix wrap width or a too-tight/loose OCR cover patch) WITHOUT
  // touching font size, unlike the corner handle's font-scaling resize.
  const widthHandleR = document.createElement('div');
  widthHandleR.className = 'te-width-handle right';
  widthHandleR.contentEditable = 'false';
  widthHandleR.setAttribute('unselectable', 'on');
  el.appendChild(widthHandleR);
  blockData.widthHandleR = widthHandleR;

  const widthHandleL = document.createElement('div');
  widthHandleL.className = 'te-width-handle left';
  widthHandleL.contentEditable = 'false';
  widthHandleL.setAttribute('unselectable', 'on');
  el.appendChild(widthHandleL);
  blockData.widthHandleL = widthHandleL;

  widthHandleR.addEventListener('mousedown', ev => {
    if (blockData.locked) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startW = el.offsetWidth;
    const sx = ev.clientX;
    el.style.width = startW + 'px';
    const mm = e2 => {
      const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
      const newW = Math.max(20, startW + (e2.clientX - sx) / z);
      el.style.width = newW + 'px';
      blockData.origWidth = newW;
      el.classList.add('modified');
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  // Dragging the LEFT edge grows/shrinks width in the opposite direction of
  // the mouse AND shifts the box's x position, so the right edge stays put
  // (matches how left-edge resize handles behave everywhere else).
  widthHandleL.addEventListener('mousedown', ev => {
    if (blockData.locked) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startW = el.offsetWidth;
    const startX = parseInt(el.style.left) || 0;
    const sx = ev.clientX;
    el.style.width = startW + 'px';
    const mm = e2 => {
      const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
      const dx = (e2.clientX - sx) / z;
      const newW = Math.max(20, startW - dx);
      const actualDx = startW - newW; // clamped delta, so the right edge doesn't drift once min-width kicks in
      el.style.width = newW + 'px';
      el.style.left  = (startX + actualDx) + 'px';
      blockData.origWidth = newW;
      blockData.x = parseInt(el.style.left);
      el.classList.add('modified');
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  // Small delete (×) handle, quick one-click removal of just this block
  // (e.g. an OCR line you don't want), without needing to click it first,
  // find the sidebar, and press "Delete block". Only shows once the block
  // is selected, same as the other handles.
  const delHandle = document.createElement('div');
  delHandle.className = 'te-delete-handle';
  delHandle.contentEditable = 'false';
  delHandle.setAttribute('unselectable', 'on');
  delHandle.title = 'Delete this text';
  delHandle.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
  el.appendChild(delHandle);
  blockData.delHandleEl = delHandle;

  delHandle.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
  delHandle.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    teDeleteBlockData(blockData);
  });

  // Enter inserts a soft line break and keeps editing, without this, the
  // browser's default behavior on a contenteditable div splits the content
  // into a new nested <div>/<p> on every Enter. That nested block visually
  // looks "committed" (it renders like a separate finished line sitting under
  // the cursor) while the whole element is still contenteditable, which is
  // exactly the "gets saved but is also still editable" confusion. A plain
  // <br> keeps everything inside the one block with no nested elements.
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      document.execCommand('insertLineBreak');
      el.classList.add('modified');
    }
  });

  el.addEventListener('focus', () => {
    teState.focusedBlock = blockData;
    document.querySelectorAll('.pdfed-text-block.selected').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    // Sync UI controls to this block's settings
    document.querySelectorAll('.te-color-swatch').forEach(s => s.classList.toggle('sel', s.dataset.color === blockData.color));
    document.getElementById('teColorPicker').value = blockData.color;
    teState.sizeAdj = 0;
    document.getElementById('teSizeSlider').value = 0;
    document.getElementById('teSizeVal').textContent = '0';
    teUpdateLockBtn();
  });
  // Clicking away from the box (it loses focus) deselects it and immediately
  // syncs whatever was typed back into the page's saved text blocks, so
  // edits stick right away instead of needing an explicit "Apply" click.
  el.addEventListener('blur', () => {
    el.classList.remove('selected');
    if (teState.focusedBlock === blockData) teState.focusedBlock = null;
    teUpdateLockBtn();
    teAutoSaveBlocks();
  });
  el.addEventListener('input', () => {
    if (el.textContent !== blockData.origText) el.classList.add('modified');
    else el.classList.remove('modified');
    if (blockData.handleEl && !el.contains(blockData.handleEl)) el.appendChild(blockData.handleEl);
    if (blockData.moveHandleEl && !el.contains(blockData.moveHandleEl)) el.appendChild(blockData.moveHandleEl);
    if (blockData.widthHandleR && !el.contains(blockData.widthHandleR)) el.appendChild(blockData.widthHandleR);
    if (blockData.widthHandleL && !el.contains(blockData.widthHandleL)) el.appendChild(blockData.widthHandleL);
    if (blockData.delHandleEl && !el.contains(blockData.delHandleEl)) el.appendChild(blockData.delHandleEl);
  });

  // Click selects/focuses the block even when it's locked, so the user can find
  // it and hit "Unlock" — but locked blocks aren't directly editable until then.
  el.addEventListener('mousedown', () => { teState.focusedBlock = blockData; teUpdateLockBtn(); });

  // Shift+drag to reposition, works for any unlocked block, not just free ones.
  el.title = blockData.locked ? 'Locked' : 'Click to edit · Shift+drag to move';
  let dragging = false, ox = 0, oy = 0, sx = 0, sy = 0;
  el.addEventListener('mousedown', ev => {
    if (!ev.shiftKey || blockData.locked) return;
    ev.preventDefault();
    dragging = true;
    ox = parseInt(el.style.left) || 0; oy = parseInt(el.style.top) || 0;
    sx = ev.clientX; sy = ev.clientY;
    const mm = e2 => {
      if (!dragging) return;
      // Screen-pixel mouse deltas must be divided by the current zoom level,
      // because the overlay is displayed through a CSS scale(zoom) transform.
      // el.style.left/top live in true canvas-pixel space (unscaled), so without
      // this correction the block's stored x/y drift away from the cursor whenever
      // zoom !== 100%, causing text to land in the wrong place on export/download.
      const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
      el.style.left = (ox + (e2.clientX - sx) / z) + 'px';
      el.style.top  = (oy + (e2.clientY - sy) / z) + 'px';
      blockData.x = parseInt(el.style.left);
      blockData.y = parseInt(el.style.top);
      el.classList.add('modified');
    };
    const mu = () => { dragging = false; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  overlay.appendChild(el);
  return blockData;
}

function teUpdateLockBtn() {
  const btn = document.getElementById('teLockBtn');
  if (!btn) return;
  const bd = teState.focusedBlock;
  const lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
  const unlockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9-3"/></svg>';
  if (!bd) { btn.innerHTML = lockIcon; btn.classList.remove('on'); btn.title = 'Lock/unlock this block'; return; }
  btn.innerHTML = bd.locked ? unlockIcon : lockIcon;
  btn.classList.toggle('on', bd.locked);
  btn.title = bd.locked ? 'Unlock this block' : 'Lock this block';
}

function teToggleLock() {
  const bd = teState.focusedBlock;
  if (!bd) { toast('Click a text block first', 'info'); return; }
  bd.locked = !bd.locked;
  bd.el.contentEditable = bd.locked ? 'false' : 'true';
  bd.el.classList.toggle('locked', bd.locked);
  bd.el.title = bd.locked ? 'Locked' : 'Click to edit · Shift+drag to move';
  teUpdateLockBtn();
  toast(bd.locked ? 'Block locked' : 'Block unlocked', 'info');
}

function teDeleteBlock() {
  const bd = teState.focusedBlock;
  if (!bd) { toast('Click a text block first', 'info'); return; }
  teDeleteBlockData(bd, 'Block deleted');
}

// Shared removal logic used by both the sidebar "Delete block" button and
// the small × handle on each individual block. Removes the block's DOM
// (and all its handles) from the overlay, drops it from teState.blocks, and
// immediately re-syncs the page's saved text so the deletion sticks even if
// the user never presses "Apply".
function teDeleteBlockData(bd, message) {
  if (!bd) return;
  bd.el.remove();
  if (bd.handleEl) bd.handleEl.remove();
  if (bd.moveHandleEl) bd.moveHandleEl.remove();
  if (bd.widthHandleR) bd.widthHandleR.remove();
  if (bd.widthHandleL) bd.widthHandleL.remove();
  if (bd.delHandleEl) bd.delHandleEl.remove();
  teState.blocks = teState.blocks.filter(b => b !== bd);
  if (teState.focusedBlock === bd) teState.focusedBlock = null;
  document.getElementById('teBlockCount').textContent = teState.blocks.length + ' block' + (teState.blocks.length !== 1 ? 's' : '');
  teUpdateLockBtn();
  teAutoSaveBlocks();
  toast(message || 'Text deleted', 'info');
}

// ---- Side-by-side compare (before/after) ------------------------------------
// Splits the canvas area into two panes: a static snapshot of the page as it
// was before any text edits (left), and the real, still fully-interactive
// canvas + text overlay (right) — so the user can keep typing/dragging text
// on the right while watching the left pane for reference. The left pane is
// just an <img>, built once per toggle-on from the live canvas's pixels
// (which text edits never touch, edits live purely in the overlay layer on
// top), so it's always an accurate "before" regardless of when it's opened.
let teCompareSplitOn = false;

function teToggleCompareSplit() {
  if (!teState.active) { toast('Open "OCR" on a page first', 'info'); return; }
  const canvas = document.getElementById('pdfedPageCanvas');
  if (!canvas || !canvas.width) return;

  teCompareSplitOn = !teCompareSplitOn;

  const scroll     = document.getElementById('pdfedCanvasScroll');
  const inner      = document.getElementById('pdfedCanvasInner');
  const beforeWrap = document.getElementById('pdfedCompareBeforeWrap');
  const beforeImg  = document.getElementById('pdfedCompareBeforeImg');
  const beforeTag  = document.getElementById('pdfedCompareBeforeTag');
  const divider    = document.getElementById('pdfedCompareDivider');
  const afterTag   = document.getElementById('pdfedCompareAfterTag');
  const btn        = document.getElementById('pdfedPgactCompare');

  // Clear any in-flight hide timer from a rapid toggle-off/on so it can't
  // hide the pane out from under a fresh entrance.
  if (teCompareHideTimer) { clearTimeout(teCompareHideTimer); teCompareHideTimer = null; }

  if (teCompareSplitOn) {
    beforeImg.src = canvas.toDataURL('image/png');
    // Match the live canvas's current on-screen (zoomed) size exactly, so
    // both panes read at the same scale.
    const dispW = canvas.style.width  || (canvas.width  + 'px');
    const dispH = canvas.style.height || (canvas.height + 'px');
    beforeImg.style.width  = dispW;
    beforeImg.style.height = dispH;

    beforeWrap.style.display = 'block';
    if (divider) divider.style.display = 'block';
    if (scroll) scroll.classList.add('compare-split');
    if (inner) inner.classList.add('compare-split');
    if (afterTag) afterTag.style.display = 'block';
    if (btn) { btn.classList.add('comparing'); btn.title = 'Exit compare view'; }

    // Force a reflow so the browser registers the hidden starting state
    // before the "visible" class is applied, otherwise the transition
    // would be skipped and the pane would just snap into place.
    void beforeWrap.offsetWidth;

    requestAnimationFrame(() => {
      beforeWrap.classList.add('pdfed-compare-visible');
      if (divider) divider.classList.add('pdfed-compare-visible');
    });
    // Tags pop in just after the panes settle, giving the reveal a light
    // staggered rhythm instead of everything animating at once.
    setTimeout(() => {
      if (beforeTag) beforeTag.classList.add('pdfed-compare-visible');
      if (afterTag) afterTag.classList.add('pdfed-compare-visible');
    }, 180);

    toast('Comparing, left is the original, right is live and still editable', 'info');
  } else {
    teExitCompareSplit();
  }
}

let teCompareHideTimer = null;

// Shared cleanup, also called whenever the Text Editor session itself ends
// (Apply, Cancel, or navigating to another page), so a stale "before" snapshot
// never lingers once its page is no longer being edited. Animates the split
// closed rather than snapping it away instantly.
function teExitCompareSplit() {
  teCompareSplitOn = false;
  const scroll     = document.getElementById('pdfedCanvasScroll');
  const inner      = document.getElementById('pdfedCanvasInner');
  const beforeWrap = document.getElementById('pdfedCompareBeforeWrap');
  const beforeTag  = document.getElementById('pdfedCompareBeforeTag');
  const divider    = document.getElementById('pdfedCompareDivider');
  const afterTag   = document.getElementById('pdfedCompareAfterTag');
  const btn        = document.getElementById('pdfedPgactCompare');

  if (btn) { btn.classList.remove('comparing'); btn.title = 'Compare, see before vs after side by side'; }
  if (beforeWrap) beforeWrap.classList.remove('pdfed-compare-visible');
  if (divider) divider.classList.remove('pdfed-compare-visible');
  if (beforeTag) beforeTag.classList.remove('pdfed-compare-visible');
  if (afterTag) afterTag.classList.remove('pdfed-compare-visible');

  if (teCompareHideTimer) clearTimeout(teCompareHideTimer);
  teCompareHideTimer = setTimeout(() => {
    if (beforeWrap) beforeWrap.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (scroll) scroll.classList.remove('compare-split');
    if (inner) inner.classList.remove('compare-split');
    if (afterTag) afterTag.style.display = 'none';
    teCompareHideTimer = null;
  }, 380); // matches the pane's fade/slide-out transition duration
}

// Shows/hides the Compare button in the top-right page-actions bar, visible
// only while the Text Editor (Edit Text) session is active, since comparing
// before/after only makes sense in that context.
function pdfedSyncCompareBtnVisibility() {
  const btn = document.getElementById('pdfedPgactCompare');
  const sep = document.getElementById('pdfedPgactCompareSep');
  if (!btn) return;
  const show = !!teState.active;
  btn.style.display = show ? 'flex' : 'none';
  if (sep) sep.style.display = show ? '' : 'none';
}

function teAddFreeText() {
  if (!teState.active) return;
  const canvas = document.getElementById('pdfedPageCanvas');
  // Place in the center of the visible canvas
  const x = canvas.width  * 0.15;
  const y = canvas.height * 0.45;
  const bd = teAddBlock({
    text: 'New text', x, y,
    fontSize: 32, fontFamily: 'Arial, sans-serif',
    color: teState.color, bold: false, italic: false, free: true,
  }, null, true);
  bd.el.classList.add('modified');
  setTimeout(() => {
    bd.el.focus();
    const range = document.createRange();
    range.selectNodeContents(bd.el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, 30);
  toast('Free text added, Shift+drag to move it', 'info');
}

function teSelectColor(el) {
  document.querySelectorAll('.te-color-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
  teState.color = el.dataset.color;
  document.getElementById('teColorPicker').value = teState.color;
  teApplyColorToFocused(teState.color);
}

function tePickColor(val) {
  teState.color = val;
  document.querySelectorAll('.te-color-swatch').forEach(s => s.classList.remove('sel'));
  const bd = teState.focusedBlock;
  if (bd) { bd.el.focus(); teRestoreSavedRange(); }
  teApplyColorToFocused(val);
}

function teApplyColorToFocused(color) {
  const bd = teState.focusedBlock;
  if (!bd) return;
  const sel = window.getSelection();
  const hasRealSelection = sel && sel.rangeCount > 0 && bd.el.contains(sel.anchorNode) && !sel.isCollapsed;

  // Make sure the block has focus so execCommand targets the right element/caret.
  if (document.activeElement !== bd.el) bd.el.focus();

  try {
    document.execCommand('styleWithCSS', false, true);
    // Works for an actual highlighted selection (recolors just that text), AND for a
    // collapsed caret while typing (sets the color for whatever is typed next) — this
    // is what gives the "pick a color while typing" Canva-style behavior.
    document.execCommand('foreColor', false, color);
  } catch (e) { /* execCommand unsupported, fall back to block-wide color below */ }

  bd.color = color; // base/default color used as a fallback wherever no inline override exists
  if (!hasRealSelection) {
    // No text was highlighted (just clicked a swatch) — also set it as the visible
    // block color so it's reflected immediately even before anything new is typed.
    bd.el.style.color = color;
  }
  bd.el.classList.add('modified');
}

// Walk a text block's DOM and split it into lines of colored/styled runs, so the
// export/flatten step can reproduce per-character (Canva-style) text coloring instead
// of a single flat color for the whole block.
function teExtractColoredLines(el, defaultColor, defaultBold, defaultItalic) {
  const lines = [[]];
  function styleOf(node) {
    let n = node, color = null, bold = null, italic = null;
    while (n && n !== el) {
      if (n.nodeType === 1) {
        if (color === null) {
          if (n.style && n.style.color) color = n.style.color;
          else if (n.tagName === 'FONT' && n.color) color = n.color;
        }
        if (bold === null) {
          const fw = n.style && n.style.fontWeight;
          if (n.tagName === 'B' || n.tagName === 'STRONG') bold = true;
          else if (fw && (fw === 'bold' || fw === 'bolder' || parseInt(fw) >= 600)) bold = true;
        }
        if (italic === null) {
          if (n.tagName === 'I' || n.tagName === 'EM') italic = true;
          else if (n.style && n.style.fontStyle === 'italic') italic = true;
        }
      }
      n = n.parentNode;
    }
    return {
      color: color !== null ? color : defaultColor,
      bold: bold !== null ? bold : defaultBold,
      italic: italic !== null ? italic : defaultItalic,
    };
  }
  function newLine() { lines.push([]); }
  function walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) {
        if (child.nodeValue) {
          const st = styleOf(child);
          lines[lines.length - 1].push({ text: child.nodeValue, color: st.color, bold: st.bold, italic: st.italic });
        }
      } else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === 'BR') { newLine(); }
        else if (tag === 'DIV' || tag === 'P') {
          // Chrome/Firefox wrap each new line (after Enter) in its own block element
          if (lines.length > 1 || lines[lines.length - 1].length > 0) newLine();
          walk(child);
        } else {
          walk(child);
        }
      }
    });
  }
  walk(el);
  return lines;
}

function teAdjustSize(val) {
  const delta = parseInt(val);
  teState.sizeAdj = delta;
  document.getElementById('teSizeVal').textContent = (delta >= 0 ? '+' : '') + delta;
  const bd = teState.focusedBlock;
  if (!bd) return;
  bd.fontSize = Math.max(4, bd.baseFontSize + delta);
  bd.el.style.fontSize = bd.fontSize + 'px';
  bd.el.classList.add('modified');
}

function teApplyBold() {
  const bd = teState.focusedBlock;
  if (!bd) return;
  bd.bold = !bd.bold;
  bd.el.style.fontWeight = bd.bold ? 'bold' : 'normal';
  bd.el.classList.add('modified');
}

function teApplyItalic() {
  const bd = teState.focusedBlock;
  if (!bd) return;
  bd.italic = !bd.italic;
  bd.el.style.fontStyle = bd.italic ? 'italic' : 'normal';
  bd.el.classList.add('modified');
}

// ── "Style Specific Text" ───────────────────────────────────────────────────
// Lives permanently at the top of the right panel (not gated behind "Edit
// Text" mode). Type a word or sentence, pick a style, hit Apply — every
// matching occurrence across the WHOLE document gets bold/italic/font/colour
// applied in one shot, instead of opening each page, selecting the text by
// hand, and clicking the toolbar buttons one at a time.
//
// "Smart" matching, no extra toggle to configure: a single word (no spaces/
// punctuation) is matched as a whole word ("cat" won't also hit "category"),
// while anything with a space or punctuation is matched exactly as typed,
// since word boundaries don't make sense for a phrase/sentence.
const teFafState = { bold: false, italic: false, font: '', color: null, debounceTimer: null, previewToken: 0 };

function teFafToggleStyle(kind, btn) {
  teFafState[kind] = !teFafState[kind];
  btn.classList.toggle('on', teFafState[kind]);
}

function teFafSelectColor(el) {
  document.querySelectorAll('#teFafColorRow .te-color-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
  const c = el.dataset.color;
  teFafState.color = c || null;
  document.getElementById('teFafColorPicker').value = c;
  document.getElementById('teFafClearColorBtn').classList.remove('on');
}

function teFafPickColor(val) {
  teFafState.color = val;
  document.querySelectorAll('#teFafColorRow .te-color-swatch').forEach(s => s.classList.remove('sel'));
  document.getElementById('teFafClearColorBtn').classList.remove('on');
}

function teFafClearColor() {
  teFafState.color = null;
  document.querySelectorAll('#teFafColorRow .te-color-swatch').forEach(s => s.classList.remove('sel'));
  document.getElementById('teFafClearColorBtn').classList.add('on');
}

function teFafEscapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Walks a container's DOM (a live block on screen, or a detached copy of a
// saved block's HTML) and wraps every match of `regex` in its text nodes
// with a <span> carrying whatever style `styler` sets. Skips anything sitting
// under a contentEditable="false" element, which is how the block's own
// drag/resize/delete handles are marked, so those are never touched even
// though they're real DOM children of the block.
function teFafWrapMatches(root, regex, styler) {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (p && p.closest('[contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  nodes.forEach(tn => {
    const text = tn.nodeValue;
    regex.lastIndex = 0;
    const spans = [];
    let m;
    while ((m = regex.exec(text))) {
      if (!m[0].length) { regex.lastIndex++; continue; }
      spans.push([m.index, m.index + m[0].length]);
    }
    if (!spans.length) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    spans.forEach(([s, e]) => {
      if (s > last) frag.appendChild(document.createTextNode(text.slice(last, s)));
      const span = document.createElement('span');
      styler(span);
      span.textContent = text.slice(s, e);
      frag.appendChild(span);
      last = e;
      count++;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    tn.parentNode.replaceChild(frag, tn);
  });

  return count;
}

// Builds the case-insensitive search regex, deciding word-boundary matching
// automatically from the shape of the query (see comment above teFafState).
function teFafBuildRegex(query) {
  const isSingleWord = /^[\w'-]+$/.test(query);
  const escaped = teFafEscapeRegex(query);
  const pattern = isSingleWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, 'gi');
}

// Minimal text->HTML escape, used only as a fallback when a saved block has
// no stored .html (older/simple blocks that only ever kept .text).
function teFafEscapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Placed text boxes ("Add Text" on a blank page, diagram, or data table) are
// stored separately from PDF-extracted content, on pg.placedTexts, with their
// own x/y/fontSize — not pg.textBlocks. Style Specific Text needs to see
// these too, or anything typed directly into a document being built from
// scratch (rather than uploaded as a PDF) is invisible to search entirely.
function teFafPlacedTextsGeom(pg) {
  return ((pg && pg.placedTexts) || []).map(item => ({
    text: item.text || '', x: item.x, y: item.y,
    width: item.w || Math.max(40, (item.text || '').length * (item.fontSize || 14) * 0.6),
    height: item.h || (item.fontSize || 14) * 1.3,
    fontSize: item.fontSize, fontFamily: item.fontFamily, bold: item.bold, italic: item.italic,
    _placed: true,
  }));
}

// ── The crawler ─────────────────────────────────────────────────────────────
// Every page — including ones nobody has ever opened "Edit Text" on — is
// searchable. For a page that already has saved text blocks (or is the live
// session on screen), those are the ground truth. For anything else, a cheap
// geometry-only pass reads the PDF's own text layer (position + string, no
// canvas/color sampling) just to know WHERE matches are and HOW MANY there
// are — instant enough to run on every keystroke. The PDF/textBlocks portion
// is cached per page so retyping doesn't re-parse the PDF each time. Placed
// text boxes are recomputed fresh on every call instead (cheap — no async
// work), since they're created/edited from many places across the app and a
// cached copy would go stale the moment someone types into one.
async function teFafGetPageGeometry(pg) {
  const placedGeom = teFafPlacedTextsGeom(pg);
  if (pg._teFafGeom && pg._teFafGeom.length) return pg._teFafGeom.concat(placedGeom); // only trust a non-empty cache; an empty result might just be a transient failure, so retry it rather than freezing "no text" forever
  if (pg.textBlocks && pg.textBlocks.length) {
    const geom = pg.textBlocks.map(tb => ({
      text: tb.text || '', x: tb.x, y: tb.y,
      width: tb.origWidth || 40, height: tb.origHeight || (tb.fontSize || 12) * 1.15,
      fontSize: tb.fontSize, fontFamily: tb.fontFamily, bold: tb.bold, italic: tb.italic,
    }));
    pg._teFafGeom = geom;
    return geom.concat(placedGeom);
  }
  if (pg.type !== 'pdf' || !(pg.srcDoc || pdfed.pdfDoc)) {
    pg._teFafGeom = [];
    return placedGeom;
  }
  try {
    const pdfPage = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
    const viewport = pdfPage.getViewport({ scale: 2.0 });
    const textContent = await pdfPage.getTextContent();
    const styleMap = textContent.styles || {};
    const runs = teMergeTextRuns(textContent.items, viewport, styleMap, null); // no ctx: geometry only, no color sampling needed
    const geom = runs.map(r => ({
      text: r.text, x: r.x, y: r.y, width: r.width, height: r.height,
      fontSize: r.fontSize, fontFamily: r.fontFamily, bold: r.bold, italic: r.italic,
    }));
    pg._teFafGeom = geom;
    return geom.concat(placedGeom);
  } catch (e) {
    console.warn('Style Specific Text: could not read this page\'s text layer, will retry next keystroke', e);
    pg._teFafGeom = [];
    return placedGeom;
  }
}

// The real, color-accurate extraction — identical in spirit to what opening
// "Edit Text" on this page would produce (rasterizes the page so glyph/
// background colors can be sampled properly). Only run for a page once the
// cheap geometry pass above has already confirmed it's worth the cost.
async function teFafExtractRealBlocks(pg) {
  if (pg.type !== 'pdf' || !(pg.srcDoc || pdfed.pdfDoc)) return [];
  try {
    const pdfPage = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
    const { ctx, viewport } = await pdfedRasterizePage(pdfPage, 2.0);
    const textContent = await pdfPage.getTextContent();
    const styleMap = textContent.styles || {};
    const runs = teMergeTextRuns(textContent.items, viewport, styleMap, ctx);
    return runs.map(r => ({
      x: r.x, y: r.y,
      fontSize: Math.max(6, Math.round(r.fontSize)),
      fontFamily: r.fontFamily,
      color: r.color,
      bold: r.bold,
      italic: r.italic,
      free: false,
      locked: false,
      origText: r.text,
      text: r.text,
      html: teFafEscapeHtml(r.text),
      origWidth: r.width,
      origHeight: r.height,
      bgColor: r.bgColor,
    }));
  } catch (e) {
    console.warn('Style Specific Text: background extraction failed for a page', e);
    return [];
  }
}

// ── Live preview: highlight + status, no document changes yet ──────────────
function teFafOnInput() {
  clearTimeout(teFafState.debounceTimer);
  const input = document.getElementById('teFafInput');
  const query = input ? input.value.trim() : '';
  teFafState.previewToken++; // invalidate any in-flight crawl immediately
  if (!query) { teFafClearHighlights(); teFafSetStatus('idle'); return; }
  teFafSetStatus('scanning', 'Scanning document…');
  teFafState.debounceTimer = setTimeout(() => teFafRunPreview(query), 200);
}

function teFafSetStatus(mode, text) {
  const el = document.getElementById('teFafStatus');
  const textEl = document.getElementById('teFafStatusText');
  if (!el || !textEl) return;
  el.className = 'te-faf-status' + (mode ? ' ' + mode : '');
  textEl.textContent = text || 'Searches the whole document';
}

function teFafClearHighlights() {
  const layer = document.getElementById('teFafHighlightLayer');
  if (layer) layer.innerHTML = '';
  const placedLayer = document.getElementById('teFafPlacedHighlightLayer');
  if (placedLayer) placedLayer.innerHTML = '';
}

// Positions the highlight layer exactly like pdfedRenderTextLayer positions
// the real text-block overlay, so highlight elements land pixel-true on the
// canvas at any zoom level.
function teFafSyncHighlightTransform(pg) {
  const layer = document.getElementById('teFafHighlightLayer');
  const canvas = document.getElementById('pdfedPageCanvas');
  if (!layer || !canvas || !canvas.width || !pg) return;
  layer.style.width = canvas.width + 'px';
  layer.style.height = canvas.height + 'px';
  const zoomNormalize = PDFED_PX_PER_MM / (pg._pxPerMm || PDFED_PX_PER_MM);
  const z = pdfed.zoom * zoomNormalize;
  layer.style.transform = `scale(${z})`;
  layer.style.transformOrigin = 'top left';
}

// Full, accurate per-page extraction (exact x/y/fontSize/fontFamily/bold/
// italic) — the SAME data "Edit Text" and "Apply across document" already
// build real text elements from (via teAddBlock), which is why Apply always
// lands correctly. Cached on the page so it's only computed once, not on
// every keystroke; invalidated automatically the moment real textBlocks
// exist, since those become the new ground truth.
async function teFafGetRealBlocksForHighlight(pg) {
  if (pg.textBlocks && pg.textBlocks.length) return pg.textBlocks;
  if (pg._teFafRealBlocksCache) return pg._teFafRealBlocksCache;
  const blocks = await teFafExtractRealBlocks(pg);
  pg._teFafRealBlocksCache = blocks;
  return blocks;
}

// ── Live preview highlight ───────────────────────────────────────────────
// No font-metric guessing here: every highlight element is built with the
// exact same x/y/fontSize/fontFamily/bold/italic that the real, on-screen
// text uses (from live edit blocks if the page is open for editing, or from
// the same accurate extraction "Apply across document" already relies on
// otherwise). The browser lays each one out itself — same as any real text
// block — so the match position can't drift; only the matched substring
// gets a visible background, the rest of the element stays invisible.
async function teFafHighlightActivePage(regex, token) {
  teFafClearHighlights();
  if (typeof pdfed === 'undefined' || pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  if (!pg) return;

  const layer = document.getElementById('teFafHighlightLayer');
  if (!layer) return;
  teFafSyncHighlightTransform(pg);

  let blocks;
  if (teState.active) {
    // Page is open for live editing right now — highlight the actual DOM
    // that's on screen, so the preview always matches unsaved edits too.
    blocks = teState.blocks.map(bd => ({
      text: bd.el.textContent || '', x: bd.x, y: bd.y,
      fontSize: bd.fontSize, fontFamily: bd.fontFamily,
      bold: bd.bold, italic: bd.italic,
      origWidth: bd.origWidth, origHeight: bd.origHeight,
    }));
  } else {
    blocks = await teFafGetRealBlocksForHighlight(pg);
    if (token !== teFafState.previewToken) return; // a newer keystroke superseded this pass
  }
  teFafRenderHighlightBlocks(blocks, regex, layer);

  // Placed/free text boxes ("Add Text") live inside their own zoom wrapper
  // (#pdfedPlacedZoomWrap), which scales as one unit with a DIFFERENT factor
  // than the PDF text overlay — so their highlights get their own layer
  // that's already inside that same wrapper (see the HTML), instead of being
  // mixed into `layer` where they'd land at the wrong scale.
  const placedLayer = document.getElementById('teFafPlacedHighlightLayer');
  if (placedLayer) {
    placedLayer.innerHTML = '';
    teFafRenderHighlightBlocks(teFafPlacedTextsGeom(pg), regex, placedLayer);
  }
}

// Shared by both highlight layers: for each block whose text matches, build
// a real text element with the block's own x/y/font — the browser lays it
// out itself, so the highlight can only ever land exactly on the word.
function teFafRenderHighlightBlocks(blocks, regex, layer) {
  blocks.forEach(b => {
    if (!b.text || !b.text.trim()) return;
    regex.lastIndex = 0;
    if (!regex.test(b.text)) return;
    const el = document.createElement('div');
    el.className = 'pdfed-text-block te-faf-hl-clone';
    el.style.left       = Math.round(b.x) + 'px';
    el.style.top        = Math.round(b.y) + 'px';
    el.style.fontSize   = Math.max(6, Math.round(b.fontSize || 14)) + 'px';
    el.style.fontFamily = b.fontFamily || 'Arial, sans-serif';
    el.style.fontWeight = b.bold   ? 'bold'   : 'normal';
    el.style.fontStyle  = b.italic ? 'italic' : 'normal';
    if (b.origWidth)  el.style.minWidth  = Math.round(b.origWidth)  + 'px';
    if (b.origHeight) el.style.minHeight = Math.round(b.origHeight) + 'px';
    el.textContent = b.text;
    regex.lastIndex = 0;
    teFafWrapMatches(el, regex, span => span.className = 'te-faf-hl-mark');
    layer.appendChild(el);
  });
}

async function teFafRunPreview(query) {
  const token = teFafState.previewToken;
  let regex;
  try { regex = teFafBuildRegex(query); }
  catch (e) { teFafSetStatus('none', 'Could not search for that'); return; }

  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    teFafSetStatus('idle');
    return;
  }

  await teFafHighlightActivePage(regex, token);
  if (token !== teFafState.previewToken) return;

  let totalMatches = 0, pagesWithMatch = 0;
  for (let i = 0; i < pdfed.pages.length; i++) {
    const pg = pdfed.pages[i];
    const isLiveActivePage = teState.active && i === pdfed.active;
    let pageText;
    if (isLiveActivePage) {
      const placedText = ((pg.placedTexts || []).map(item => item.text || '')).join(' \n ');
      pageText = teState.blocks.map(bd => bd.el.textContent || '').join(' \n ') + ' \n ' + placedText;
    } else {
      const geom = await teFafGetPageGeometry(pg);
      if (token !== teFafState.previewToken) return; // superseded mid-crawl
      pageText = geom.map(r => r.text).join(' \n ');
    }
    regex.lastIndex = 0;
    const hits = pageText.match(regex);
    if (hits && hits.length) { totalMatches += hits.length; pagesWithMatch++; }
    teFafSetStatus(totalMatches > 0 ? 'match' : 'scanning',
      totalMatches > 0
        ? `${totalMatches} found`
        : 'Scanning document…');
  }
  if (token !== teFafState.previewToken) return;
  teFafSetStatus(totalMatches > 0 ? 'match' : 'none',
    totalMatches > 0
      ? `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} found`
      : `No matches for "${query}"`);
}

// Re-runs the live preview for whatever's still typed in the box — called
// after page navigation/zoom, since highlight positions are page-specific.
function teFafRefreshPreview() {
  const input = document.getElementById('teFafInput');
  const query = input ? input.value.trim() : '';
  if (!query) { teFafClearHighlights(); return; }
  teFafState.previewToken++;
  teFafRunPreview(query);
}

// ── Undo / Redo for "Apply across document" ─────────────────────────────────
const teFafUndoStack = [];
const teFafRedoStack = [];
const TE_FAF_UNDO_CAP = 25;

function teFafSnapshotPage(pg) {
  return {
    textBlocks: pg.textBlocks ? JSON.parse(JSON.stringify(pg.textBlocks)) : null,
    placedTexts: pg.placedTexts ? JSON.parse(JSON.stringify(pg.placedTexts)) : null,
  };
}

function teFafRestoreChanges(changes, useBefore) {
  changes.forEach(ch => {
    const pg = pdfed.pages[ch.i];
    if (!pg) return;
    const snap = useBefore ? ch.before : ch.after;
    pg.textBlocks = (snap && snap.textBlocks) ? JSON.parse(JSON.stringify(snap.textBlocks)) : null;
    pg.placedTexts = (snap && snap.placedTexts) ? JSON.parse(JSON.stringify(snap.placedTexts)) : null;
    pg._teFafGeom = null; // stale now, let it re-derive from the restored textBlocks/placedTexts
    if (pg.textBlocks && pg.textBlocks.length) {
      pg.modified = true;
      if (pg.edits) pg.edits.textEdited = true;
    }
  });
  if (teState.active) pdfedCancelTextEdit(); // close any live session so the restored saved state shows cleanly
  const activePg = (typeof pdfed !== 'undefined' && pdfed.active >= 0) ? pdfed.pages[pdfed.active] : null;
  if (activePg) {
    pdfedRenderTextLayer(activePg, false);
    if (typeof pdfedRenderPlacedTexts === 'function') pdfedRenderPlacedTexts(pdfed.active);
  }
  pdfedBuildStrip();
}

function teFafUndo() {
  if (!teFafUndoStack.length) return false;
  const changes = teFafUndoStack.pop();
  changes._t = nextHistoryTick();
  teFafRedoStack.push(changes);
  teFafRestoreChanges(changes, true);
  toast('↶ Style Specific Text change undone', 'info');
  return true;
}

function teFafRedo() {
  if (!teFafRedoStack.length) return false;
  const changes = teFafRedoStack.pop();
  changes._t = nextHistoryTick();
  teFafUndoStack.push(changes);
  teFafRestoreChanges(changes, false);
  toast('↷ Style Specific Text change redone', 'info');
  return true;
}

// ── Apply across document ───────────────────────────────────────────────────
async function teFafApply() {
  const input = document.getElementById('teFafInput');
  const query = input ? input.value.trim() : '';
  if (!query) { toast('Type a word or sentence first', 'info'); if (input) input.focus(); return; }

  if (!teFafState.bold && !teFafState.italic && !teFafState.font && !teFafState.color) {
    toast('Pick at least one style, bold, italic, font, or colour, to apply', 'info');
    return;
  }

  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    toast('Open a document first', 'info');
    return;
  }

  let regex;
  try { regex = teFafBuildRegex(query); }
  catch (e) { toast('Could not search for that text', 'error'); return; }

  const styler = span => {
    if (teFafState.bold) span.style.fontWeight = 'bold';
    if (teFafState.italic) span.style.fontStyle = 'italic';
    if (teFafState.font) span.style.fontFamily = teFafState.font;
    if (teFafState.color) span.style.color = teFafState.color;
  };

  const applyBtn = document.getElementById('teFafApplyBtn');
  if (applyBtn) applyBtn.classList.add('busy');

  let total = 0, pagesHit = 0, skippedPages = 0, touchedActivePage = false;
  const changes = [];

  // Styles any typed-in text boxes on a page (pg.placedTexts) — these exist
  // independently of PDF-extracted textBlocks, on ANY page type (blank pages,
  // diagrams, data tables, or a PDF page someone also dropped a text box
  // onto), so they need their own pass regardless of which branch below runs.
  function applyToPlacedTexts(pg) {
    let hits = 0;
    (pg.placedTexts || []).forEach(item => {
      const div = document.createElement('div');
      div.innerHTML = item.html || teFafEscapeHtml(item.text || '');
      const found = teFafWrapMatches(div, regex, styler);
      if (found > 0) { item.html = div.innerHTML; item.text = div.textContent; hits += found; }
    });
    return hits;
  }

  for (let i = 0; i < pdfed.pages.length; i++) {
    const pg = pdfed.pages[i];
    const isLiveActivePage = teState.active && i === pdfed.active;
    const before = teFafSnapshotPage(pg);
    let hitOnThisPage = 0;
    let touchedTextBlocksOrLive = false;

    if (isLiveActivePage) {
      // The page currently open in an active Text Editor session: style the
      // real on-screen blocks directly so the change is visible immediately.
      teState.blocks.forEach(bd => {
        const found = teFafWrapMatches(bd.el, regex, styler);
        if (found > 0) { hitOnThisPage += found; bd.el.classList.add('modified'); touchedTextBlocksOrLive = true; }
      });
      if (touchedTextBlocksOrLive) { teAutoSaveBlocks(); touchedActivePage = true; }
    } else if (pg.textBlocks && pg.textBlocks.length) {
      // Already-extracted page: style the saved block HTML directly, no DOM/overlay needed.
      pg.textBlocks.forEach(tb => {
        const div = document.createElement('div');
        div.innerHTML = tb.html || teFafEscapeHtml(tb.text || '');
        const found = teFafWrapMatches(div, regex, styler);
        if (found > 0) {
          tb.html = div.innerHTML;
          tb.text = div.textContent;
          hitOnThisPage += found;
          touchedTextBlocksOrLive = true;
        }
      });
      if (touchedTextBlocksOrLive) { pg.modified = true; pg.edits.textEdited = true; }
    } else {
      // This page has never been opened in "Edit Text" — the crawler checks it
      // anyway. Cheap geometry pass first (no canvas rasterization) to see if
      // it's even worth the real extraction, so pages with zero matches never
      // pay that cost.
      const geom = await teFafGetPageGeometry(pg);
      regex.lastIndex = 0;
      const hasCandidate = geom.some(r => { regex.lastIndex = 0; return r.text && regex.test(r.text); });
      if (hasCandidate) {
        const blocks = await teFafExtractRealBlocks(pg);
        if (!blocks.length && pg.type === 'pdf') { skippedPages++; } // scanned/no text layer at all
        else if (blocks.length) {
          blocks.forEach(tb => {
            const div = document.createElement('div');
            div.innerHTML = tb.html;
            const found = teFafWrapMatches(div, regex, styler);
            if (found > 0) { tb.html = div.innerHTML; tb.text = div.textContent; hitOnThisPage += found; }
          });
          if (hitOnThisPage > 0) { pg.textBlocks = blocks; pg.modified = true; pg.edits.textEdited = true; touchedTextBlocksOrLive = true; }
        }
      }
    }

    // Placed text boxes run on every page (blank/diagram/data-table pages
    // typically have ONLY these — no textBlocks and no live PDF at all).
    const placedHits = applyToPlacedTexts(pg);
    if (placedHits > 0) { hitOnThisPage += placedHits; pg.modified = true; }

    if (hitOnThisPage > 0) {
      total += hitOnThisPage; pagesHit++;
      pg._teFafGeom = null;
      if (i === pdfed.active) {
        if (touchedTextBlocksOrLive && !isLiveActivePage) pdfedRenderTextLayer(pg, false);
        if (placedHits > 0 && typeof pdfedRenderPlacedTexts === 'function') pdfedRenderPlacedTexts(i);
      }
      changes.push({ i, before, after: teFafSnapshotPage(pg) });
    }
  }

  if (applyBtn) applyBtn.classList.remove('busy');

  if (!total) {
    toast(skippedPages
      ? `No matches found for "${query}" (${skippedPages} scanned page${skippedPages !== 1 ? 's' : ''} with no text layer couldn't be searched)`
      : `No matches found for "${query}"`, 'info');
    return 0;
  }

  if (changes.length) {
    changes._t = nextHistoryTick();
    teFafUndoStack.push(changes);
    if (teFafUndoStack.length > TE_FAF_UNDO_CAP) teFafUndoStack.shift();
    teFafRedoStack.length = 0;
  }

  teFafClearHighlights();
  teFafSetStatus('match', `Applied to ${total} match${total !== 1 ? 'es' : ''} · ${pagesHit} page${pagesHit !== 1 ? 's' : ''}`);
  pdfedBuildStrip(); // refresh thumbnails so the styled text shows there too

  let msg = `Styled ${total} match${total !== 1 ? 'es' : ''} across ${pagesHit} page${pagesHit !== 1 ? 's' : ''} · Ctrl+Z to undo`;
  if (skippedPages) msg += `, ${skippedPages} scanned page${skippedPages !== 1 ? 's' : ''} skipped (no text layer)`;
  toast(msg, 'success');
  return total;
}

// ── Kadessa hook ────────────────────────────────────────────────────────────
// Lets Kadessa drive this panel exactly the way a person would: type a query,
// pick style(s), hit Apply -- except she can do it in one call instead of
// several clicks. Deliberately re-syncs the actual on-screen panel (input
// value, B/I toggle state, font dropdown, colour swatches) before applying,
// not just the underlying teFafState, so if the person opens this panel
// afterward it shows exactly what Kadessa just set rather than stale controls
// left over from whatever they last touched by hand. Reuses teFafApply()
// itself for the actual work, so undo/redo, the thumbnail refresh, and the
// toast are all identical to a manual Apply click.
//
// bold/italic default to false, font/color default to "leave unchanged"
// (empty string / null) when omitted -- callers must be explicit about
// what they want, since silently inheriting whatever was left over in the
// panel from a previous manual edit would make Kadessa's result depend on
// state she can't see. Pass clear_color: true to explicitly remove an
// existing colour (the same as clicking the "no colour" button) rather
// than just leaving colour unspecified.
async function pdfedKadessaStyleSpecificText(p) {
  p = p || {};
  const query = String(p.query || '').trim();
  if (!query) throw new Error('no search text given');
  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    throw new Error('open a document first');
  }

  const bold = !!p.bold;
  const italic = !!p.italic;
  const font = p.font ? String(p.font) : '';
  const color = p.clear_color ? null : (p.color ? String(p.color) : null);

  if (!bold && !italic && !font && !color) {
    throw new Error('pick at least one style change -- bold, italic, a font, or a colour');
  }

  teFafState.bold = bold;
  teFafState.italic = italic;
  teFafState.font = font;
  teFafState.color = color;

  const input = document.getElementById('teFafInput');
  if (input) input.value = query;

  const boldBtn = document.getElementById('teFafBoldBtn');
  if (boldBtn) boldBtn.classList.toggle('on', bold);
  const italicBtn = document.getElementById('teFafItalicBtn');
  if (italicBtn) italicBtn.classList.toggle('on', italic);
  const fontSelect = document.getElementById('teFafFontSelect');
  if (fontSelect) fontSelect.value = font;

  document.querySelectorAll('#teFafColorRow .te-color-swatch').forEach(function (s) {
    s.classList.toggle('sel', !!(color && s.dataset.color === color));
  });
  const colorPicker = document.getElementById('teFafColorPicker');
  if (colorPicker && color) colorPicker.value = color;
  const clearColorBtn = document.getElementById('teFafClearColorBtn');
  if (clearColorBtn) clearColorBtn.classList.toggle('on', !color);

  teFafRefreshPreview();

  // v39: teFafApply() never loaded the font itself (the manual
  // #teFafFontSelect dropdown only ever offered the 8 fonts already
  // baked into the page, so this was never needed before free-text
  // fonts existed here). Now that `font` can be anything, it has to be
  // fetched and ready before teFafApply() measures/applies it, same as
  // the other two font-setting paths (pdfedKadessaEnsureFont is already
  // called for pdfed_insert_page/pdfed_add_text_to_page's heading_font/
  // body_font, and for pdfed_create_table's font_family).
  if (font) await pdfedKadessaEnsureFont(font);

  const total = await teFafApply();
  if (!total) throw new Error('no matches found for "' + query + '"');
  return total;
}

// ── Kadessa hooks: RESIZE & OPACITY for placed images/text (programmatic,
// no panel needed) ──────────────────────────────────────────────────────
// Gives Kadessa the same hands-on control over a placed image or text box
// that a person gets from the drag-resize handles and the opacity
// popover/toolbar slider — set a size directly, scale by a percentage,
// or dial opacity up/down — all in one call instead of walking her
// through "select it, then drag this handle". Every setter below writes
// straight to the same item.x/y/w/h/fontSize/opacity fields the manual
// UI already reads (see pdfedPositionPlacedEl, pdfedPtxtSetSize,
// pdfedPtxtSetOpacity, pdfedOpacityPopoverInput above), then reuses
// pdfedMarkModified + a real re-render so the result is pixel-identical
// to a manual edit — same undo/redo, same thumbnail refresh.

function pdfedKadessaActivePage(p) {
  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    throw new Error('open a document first');
  }
  const idx = (p && p.page_idx !== undefined && p.page_idx !== null && p.page_idx !== '')
    ? Math.max(0, Math.min(pdfed.pages.length - 1, parseInt(p.page_idx, 10)))
    : pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg) throw new Error('that page does not exist');
  return { pg, idx };
}

// Picks one image out of pg.placedImages: by explicit id, by 1-based
// z-order position ("which": a number), or by "first"/"last" (z-order,
// default "last" — the most recently placed/most likely one someone
// means by "the image" when there's more than one). Throws a clear error
// rather than silently acting on the wrong picture when nothing matches.
function pdfedKadessaFindImage(pg, p) {
  const list = pg.placedImages || [];
  if (!list.length) throw new Error('this page has no placed images');
  if (p.id) {
    const byId = list.find(it => it.id === p.id);
    if (!byId) throw new Error('no image with that id on this page');
    return byId;
  }
  const ordered = list.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  if (p.which === 'first') return ordered[0];
  if (p.which === 'last' || p.which === undefined || p.which === null || p.which === '') return ordered[ordered.length - 1];
  const n = parseInt(p.which, 10);
  if (n >= 1 && n <= ordered.length) return ordered[n - 1];
  throw new Error('could not find image #' + p.which + ' — this page only has ' + ordered.length + ' image' + (ordered.length === 1 ? '' : 's'));
}

// Picks one text box out of pg.placedTexts by a case-insensitive substring
// match against its content (mirrors the "query" semantics of
// pdfedKadessaStyleSpecificText above, just scoped to placed text boxes
// rather than the document's underlying text layer). Falls back to
// "which"/"first"/"last" the same way pdfedKadessaFindImage does when no
// query is given, so "resize the last text box" still works.
function pdfedKadessaFindPlacedText(pg, p) {
  const list = pg.placedTexts || [];
  if (!list.length) throw new Error('this page has no placed text boxes');
  if (p.id) {
    const byId = list.find(it => it.id === p.id);
    if (!byId) throw new Error('no text box with that id on this page');
    return byId;
  }
  const query = p.query ? String(p.query).trim().toLowerCase() : '';
  if (query) {
    const hits = list.filter(it => String(it.text || '').toLowerCase().includes(query));
    if (!hits.length) throw new Error('no text box matching "' + p.query + '" on this page');
    if (hits.length > 1) {
      // Same disambiguation Kadessa already has to do for pdfed_style_specific_text --
      // rather than silently picking one, prefer the most recently placed match.
      hits.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    }
    return hits[hits.length - 1];
  }
  const ordered = list.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  if (p.which === 'first') return ordered[0];
  if (p.which === 'last' || p.which === undefined || p.which === null || p.which === '') return ordered[ordered.length - 1];
  const n = parseInt(p.which, 10);
  if (n >= 1 && n <= ordered.length) return ordered[n - 1];
  throw new Error('could not find that text box — give a query to search its text, or "first"/"last".');
}

// Picks one placed TABLE out of pg.placedTables: by explicit id, by
// 1-based z-order position ("which": a number), or by "first"/"last"
// (z-order, default "last" — the most recently placed table). Mirrors
// pdfedKadessaFindImage exactly, just scoped to placedTables.
function pdfedKadessaFindPlacedTable(pg, p) {
  const list = pg.placedTables || [];
  if (!list.length) throw new Error('this page has no placed tables');
  if (p.id) {
    const byId = list.find(it => it.id === p.id);
    if (!byId) throw new Error('no table with that id on this page');
    return byId;
  }
  const ordered = list.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  if (p.which === 'first') return ordered[0];
  if (p.which === 'last' || p.which === undefined || p.which === null || p.which === '') return ordered[ordered.length - 1];
  const n = parseInt(p.which, 10);
  if (n >= 1 && n <= ordered.length) return ordered[n - 1];
  throw new Error('could not find table #' + p.which + ' — this page only has ' + ordered.length + ' table' + (ordered.length === 1 ? '' : 's'));
}

// Resizes a placed IMAGE. Either give an explicit target size
// (width_px/height_px, in the same raw canvas-pixel units item.w/item.h
// already use), or a scale_pct (e.g. 150 = 150% of its current size,
// 50 = half). Aspect ratio is preserved by default (matching the
// Shift-drag behaviour of the manual resize handle) unless
// lock_aspect: false and both width_px and height_px are given.
async function pdfedKadessaResizeImage(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const item = pdfedKadessaFindImage(pg, p);
  if (item.locked) throw new Error('that image is locked — unlock it first');

  const MIN = 12; // matches the manual drag-resize handle's own floor
  const curW = item.w, curH = item.h;
  const aspect = curW / (curH || 1);
  let newW, newH;

  if (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '') {
    const scale = Math.max(0.05, Number(p.scale_pct) / 100);
    newW = curW * scale;
    newH = curH * scale;
  } else if (p.width_px || p.height_px) {
    const lockAspect = p.lock_aspect !== false;
    if (p.width_px && p.height_px && !lockAspect) {
      newW = Number(p.width_px);
      newH = Number(p.height_px);
    } else if (p.width_px) {
      newW = Number(p.width_px);
      newH = lockAspect ? newW / aspect : curH;
    } else {
      newH = Number(p.height_px);
      newW = lockAspect ? newH * aspect : curW;
    }
  } else {
    throw new Error('give scale_pct, or width_px and/or height_px, to resize by');
  }

  item.w = Math.max(MIN, Math.round(newW));
  item.h = Math.max(MIN, Math.round(newH));
  pdfedMarkModified(idx);
  pdfedRenderPlacedImages(idx);
  return { w: item.w, h: item.h };
}

// Resizes a placed TEXT box's font size, exactly like dragging the size
// handle or typing into the toolbar's size field (pdfedPtxtSetSize),
// clamped to the same 6–300px range that control already enforces. Give
// either font_size_px directly, or scale_pct to grow/shrink relative to
// its current size (e.g. 150 = 150%). If resize_box is true (default),
// the box's own width/height are scaled by the same factor so long text
// doesn't suddenly overflow its container -- set it to false to change
// only the type size and leave the box as-is.
async function pdfedKadessaResizeText(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const item = pdfedKadessaFindPlacedText(pg, p);
  if (item.locked) throw new Error('that text box is locked — unlock it first');

  const curSize = item.fontSize || 14;
  let newSize;
  let factor = 1;
  if (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '') {
    factor = Math.max(0.05, Number(p.scale_pct) / 100);
    newSize = curSize * factor;
  } else if (p.font_size_px) {
    newSize = Number(p.font_size_px);
    factor = curSize ? (newSize / curSize) : 1;
  } else {
    throw new Error('give font_size_px, or scale_pct, to resize the text by');
  }
  item.fontSize = Math.max(6, Math.min(300, Math.round(newSize)));

  if (p.resize_box !== false && item.w) {
    item.w = Math.max(24, Math.round(item.w * factor));
    if (item.h) item.h = Math.max(20, Math.round(item.h * factor));
  }

  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  return { fontSize: item.fontSize, w: item.w, h: item.h };
}

// Resizes a placed TABLE the same way its corner handle does
// (pdfedAttachPlacedTableResizeHandler): every column width, row height,
// and the table's own font size scale together by ONE factor, so the
// table's proportions and its text-to-cell fit never change, just its
// overall size. Unlike pdfed_resize_image there is no independent
// width-only/height-only stretch (lock_aspect:false) -- the manual drag
// handle itself doesn't support that for tables, it's always uniform.
// Give scale_pct directly, or width_px/height_px to derive the factor
// from the table's current total width/height (if both are given,
// width_px wins). Clamped to the same 0.3–4x range as the manual handle.
async function pdfedKadessaResizeTable(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const item = pdfedKadessaFindPlacedTable(pg, p);
  if (item.locked) throw new Error('that table is locked — unlock it first');

  const curColWidths = item.colWidths.slice();
  const curRowHeights = item.rowHeights.slice();
  const curFontSize = item.fontSize;
  const totalW = curColWidths.reduce((a, b) => a + b, 0);
  const totalH = curRowHeights.reduce((a, b) => a + b, 0);

  let scale;
  if (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '') {
    scale = Number(p.scale_pct) / 100;
  } else if (p.width_px) {
    scale = Number(p.width_px) / (totalW || 1);
  } else if (p.height_px) {
    scale = Number(p.height_px) / (totalH || 1);
  } else {
    throw new Error('give scale_pct, or width_px or height_px, to resize the table by');
  }
  scale = Math.max(0.3, Math.min(4, scale)); // same clamp as the manual drag handle

  item.colWidths = curColWidths.map(w => Math.max(30, Math.round(w * scale)));
  item.rowHeights = curRowHeights.map(h => Math.max(14, Math.round(h * scale)));
  item.fontSize = Math.max(8, Math.round(curFontSize * scale));

  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  const newW = item.colWidths.reduce((a, b) => a + b, 0);
  const newH = item.rowHeights.reduce((a, b) => a + b, 0);
  return { w: newW, h: newH, fontSize: item.fontSize };
}

// Sets opacity on any placed object -- image, text box, table, shape, or
// border -- reusing the exact same item.opacity field and 10–100% clamp
// the manual opacity popover/slider already use (see pdfedGetOpacity,
// pdfedOpacityPopoverInput, pdfedPtxtSetOpacity above), so a Kadessa-set
// opacity is indistinguishable from one dragged in by hand.
async function pdfedKadessaSetOpacity(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const kind = String(p.kind || 'image').toLowerCase();
  const validKinds = ['image', 'text', 'table', 'shape', 'border'];
  if (validKinds.indexOf(kind) === -1) throw new Error('unknown kind "' + p.kind + '" — use image, text, table, shape, or border');
  const key = pdfedPlacedKeyForKind(kind);
  const list = pg[key] || [];
  if (!list.length) throw new Error('this page has no placed ' + kind + 's');

  let item;
  if (p.id) {
    item = list.find(it => it.id === p.id);
    if (!item) throw new Error('no ' + kind + ' with that id on this page');
  } else if (kind === 'text' && p.query) {
    item = pdfedKadessaFindPlacedText(pg, p);
  } else {
    const ordered = list.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    if (p.which === 'first') item = ordered[0];
    else if (p.which === 'last' || p.which === undefined || p.which === null || p.which === '') item = ordered[ordered.length - 1];
    else {
      const n = parseInt(p.which, 10);
      item = (n >= 1 && n <= ordered.length) ? ordered[n - 1] : null;
    }
    if (!item) throw new Error('could not find that ' + kind + ' — give an id, or "first"/"last"/a position number');
  }
  if (item.locked) throw new Error('that ' + kind + ' is locked — unlock it first');

  if (p.opacity === undefined || p.opacity === null || p.opacity === '') {
    throw new Error('give an opacity from 0-100');
  }
  const v = Math.max(0.1, Math.min(1, Number(p.opacity) / 100));
  item.opacity = v;

  pdfedMarkModified(idx);
  pdfedRenderAllPlaced(idx);
  return { opacity: Math.round(v * 100) };
}

// ── Kadessa hooks: MOVE, LAYER ORDER, BEHIND-TEXT OPACITY and OVERLAPS (build 278) ──
// Gives Kadessa the same hands a person has on the canvas, driven by words alone:
//   pdfed_move_item        move any placed image, logo, SIGNATURE, text box, table or shape
//   pdfed_arrange_layer    put something behind or in front of the text, and pick an
//                          opacity that keeps the writing readable
//   pdfed_resolve_overlaps pull apart text boxes that were sitting on top of each other
// Every write goes to the same item.x / item.y / item.zIndex / item.opacity fields the
// manual drag, Arrange menu and opacity slider already use, then re-renders through
// pdfedRenderAllPlaced, so the result is identical to a hand edit and each action is
// undoable with "undo that" (pushKadessaAppHistory) or Ctrl+Z.
//
// A success returns { say: '...' }. kadessaExecuteAction posts that line in the chat, which is
// how Kadessa can tell the person the number she picked (the reply text is written BEFORE the
// action runs, so she cannot know an auto-chosen opacity in advance).

const PDFED_KADESSA_DECOR_FLAGS = ['_sectionIcon', '_sectionDivider', '_sectionBar', '_headerDivider', '_watermark'];
function pdfedKadessaIsDecor(it) {
  return !!(it && PDFED_KADESSA_DECOR_FLAGS.some(function (k) { return it[k]; }));
}

// image / signature / logo / text / header text / table / shape / border
function pdfedKadessaAssetLabel(kind, item) {
  if (kind === 'image') return item.kind === 'logo' ? 'logo' : (item.kind === 'signature' ? 'signature' : 'image');
  if (kind === 'text') return item._reportHeaderText ? 'header text' : 'text';
  return kind;
}

// Every placed object on a page, whatever its type.
function pdfedKadessaAllPlaced(pg) {
  const out = [];
  [['image', 'placedImages'], ['text', 'placedTexts'], ['table', 'placedTables'], ['shape', 'placedShapes'], ['border', 'placedBorders']].forEach(function (kk) {
    ((pg && pg[kk[1]]) || []).forEach(function (it) {
      out.push({ kind: kk[0], key: kk[1], item: it, label: pdfedKadessaAssetLabel(kk[0], it) });
    });
  });
  return out;
}

// id -> stack position (1 = very back). Used by getKadessaContext.
function pdfedKadessaZRankMap(pg) {
  const map = {};
  try { pdfedGetZOrderedItems(pg).forEach(function (c, i) { map[c.item.id] = i + 1; }); } catch (e) { /* no ranks */ }
  return map;
}

// Picks ONE placed object: by id, by a few words of a text box, or by kind
// (signature / logo / image / text / table / shape / border) plus first / last / number.
function pdfedKadessaFindPlaced(pg, p, prefix) {
  prefix = prefix || '';
  const id = p[prefix + 'id'];
  const query = p[prefix + 'query'] ? String(p[prefix + 'query']).trim().toLowerCase() : '';
  const kindWanted = prefix ? '' : String(p.kind || '').trim().toLowerCase();
  const all = pdfedKadessaAllPlaced(pg);
  if (!all.length) throw new Error('this page has nothing placed on it yet');
  const byZ = function (a, b) { return (a.item.zIndex || 0) - (b.item.zIndex || 0); };
  if (id) {
    const hit = all.find(function (c) { return c.item.id === id; });
    if (!hit) throw new Error('no item with that id on this page');
    return hit;
  }
  const pool = all.filter(function (c) { return !pdfedKadessaIsDecor(c.item); });
  if (query) {
    const hits = pool.filter(function (c) { return c.kind === 'text' && String(c.item.text || '').toLowerCase().indexOf(query) !== -1; });
    if (!hits.length) throw new Error('no text box matching "' + (p[prefix + 'query']) + '" on this page');
    hits.sort(byZ);
    return hits[hits.length - 1];
  }
  if (kindWanted) {
    let sub;
    if (kindWanted === 'signature' || kindWanted === 'logo') {
      sub = pool.filter(function (c) { return c.kind === 'image' && c.item.kind === kindWanted; });
    } else if (kindWanted === 'image' || kindWanted === 'photo' || kindWanted === 'picture') {
      sub = pool.filter(function (c) { return c.kind === 'image' && c.item.kind !== 'signature' && c.item.kind !== 'logo'; });
      if (!sub.length) sub = pool.filter(function (c) { return c.kind === 'image'; });
    } else {
      sub = pool.filter(function (c) { return c.kind === kindWanted || c.label === kindWanted; });
    }
    if (!sub.length) throw new Error('this page has no ' + kindWanted);
    sub.sort(byZ);
    if (p.which === 'first') return sub[0];
    if (p.which === undefined || p.which === null || p.which === '' || p.which === 'last') return sub[sub.length - 1];
    const n = parseInt(p.which, 10);
    if (n >= 1 && n <= sub.length) return sub[n - 1];
    throw new Error('this page only has ' + sub.length + ' ' + kindWanted + (sub.length === 1 ? '' : 's'));
  }
  throw new Error('say which item: its id from the page list, a few words of its text, or a kind such as signature');
}

// Real box of an item in canvas px. Text boxes are measured from the live DOM (they have no
// stored height); tables are the sum of their columns and rows.
function pdfedKadessaBoxOf(pg, idx, c) {
  const it = c.item;
  if (c.kind === 'table') {
    const w = (it.colWidths || []).reduce(function (a, b) { return a + b; }, 0);
    const h = (it.rowHeights || []).reduce(function (a, b) { return a + b; }, 0);
    return { x: it.x || 0, y: it.y || 0, w: w, h: h };
  }
  if (c.kind === 'text') {
    let w = it.w || 0, h = it.h || 0;
    if (typeof pdfed !== 'undefined' && idx === pdfed.active) {
      const el = document.querySelector('.pdfed-placed-text[data-id="' + it.id + '"]');
      if (el) { w = el.offsetWidth || w; h = el.offsetHeight || h; }
    }
    if (!w) w = 200;
    if (!h) h = Math.round((it.fontSize || 14) * 1.45);
    return { x: it.x || 0, y: it.y || 0, w: w, h: h };
  }
  return { x: it.x || 0, y: it.y || 0, w: it.w || 0, h: it.h || 0 };
}

// Tight box around the words a text box really shows (not the whole, often much wider, box),
// in canvas px. Null when the page is not the open one.
function pdfedKadessaTextInk(idx, item) {
  try {
    if (typeof pdfed === 'undefined' || idx !== pdfed.active) return null;
    const el = document.querySelector('.pdfed-placed-text[data-id="' + item.id + '"]');
    const content = el && el.querySelector('.pdfed-ptxt-content');
    const pc = document.getElementById('pdfedPageCanvas');
    if (!content || !pc || !pc.width) return null;
    const cr = pc.getBoundingClientRect();
    const k = cr.width / pc.width;
    if (!k) return null;
    const r = document.createRange();
    r.selectNodeContents(content);
    const rects = Array.prototype.slice.call(r.getClientRects()).filter(function (rc) { return rc.width > 0.5 && rc.height > 0.5; });
    if (!rects.length) return null;
    let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
    rects.forEach(function (rc) { l = Math.min(l, rc.left); t = Math.min(t, rc.top); rt = Math.max(rt, rc.right); b = Math.max(b, rc.bottom); });
    return { x: (l - cr.left) / k, y: (t - cr.top) / k, w: (rt - l) / k, h: (b - t) / k };
  } catch (e) { return null; }
}

// [w, h] for getKadessaContext.
function pdfedKadessaCtxSize(pg, kind, item) {
  try {
    const b = pdfedKadessaBoxOf(pg, pdfed.active, { kind: kind, item: item });
    return [Math.round(b.w), Math.round(b.h)];
  } catch (e) { return [item.w || 0, item.h || 0]; }
}

function pdfedKadessaRerender(idx) {
  if (typeof pdfed !== 'undefined' && idx === pdfed.active) pdfedRenderAllPlaced(idx);
}

function pdfedKadessaLookup(pg, id) {
  return pdfedKadessaAllPlaced(pg).find(function (c) { return c.item.id === id; }) || null;
}

function pdfedKadessaShortText(item) {
  const s = String(item.text || '').replace(/\s+/g, ' ').trim();
  return s ? '"' + s.slice(0, 26) + (s.length > 26 ? '...' : '') + '"' : '';
}

function pdfedKadessaNiceName(c) {
  const t = c.kind === 'text' ? pdfedKadessaShortText(c.item) : '';
  return t ? 'the text ' + t : 'the ' + c.label;
}

// ── MOVE ────────────────────────────────────────────────────────────────
const PDFED_KADESSA_ANCHORS = {
  top_left: [0, 0], top_center: [0.5, 0], top_right: [1, 0],
  middle_left: [0, 0.5], center: [0.5, 0.5], middle_right: [1, 0.5],
  bottom_left: [0, 1], bottom_center: [0.5, 1], bottom_right: [1, 1]
};
const PDFED_KADESSA_ANCHOR_ALIASES = {
  top: 'top_center', bottom: 'bottom_center', left: 'middle_left', right: 'middle_right',
  middle: 'center', centre: 'center', centered: 'center'
};
function pdfedKadessaAnchorKey(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (PDFED_KADESSA_ANCHORS[s]) return s;
  return PDFED_KADESSA_ANCHOR_ALIASES[s] || null;
}
function pdfedKadessaNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function pdfedKadessaMoveItem(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const c = pdfedKadessaFindPlaced(pg, p);
  const it = c.item;
  if (it.locked) throw new Error('that ' + c.label + ' is locked, unlock it first');
  const size = pdfedKadessaPageSizePx(pg, idx);
  const PW = size[0], PH = size[1];
  const box = pdfedKadessaBoxOf(pg, idx, c);
  const before = { x: it.x, y: it.y, rotation: it.rotation };
  let nx = box.x, ny = box.y;
  let didSomething = false;

  // 1. a named spot on the page
  const spot = pdfedKadessaAnchorKey(p.position);
  if (p.position && !spot) throw new Error('"' + p.position + '" is not a spot I know, use top left, top center, top right, middle left, center, middle right, bottom left, bottom center or bottom right');
  if (spot) {
    const m = (pdfedKadessaNum(p.margin_pct) !== null ? Math.max(0, Math.min(30, pdfedKadessaNum(p.margin_pct))) : 4) / 100 * PW;
    const a = PDFED_KADESSA_ANCHORS[spot];
    nx = m + (PW - 2 * m - box.w) * a[0];
    ny = m + (PH - 2 * m - box.h) * a[1];
    didSomething = true;
  }

  // 2. an exact point, in percent of the page, that lines up with one anchor of the item
  const xp = pdfedKadessaNum(p.x_pct), yp = pdfedKadessaNum(p.y_pct);
  if (xp !== null || yp !== null) {
    const anc = PDFED_KADESSA_ANCHORS[pdfedKadessaAnchorKey(p.anchor) || 'top_left'];
    if (xp !== null) nx = Math.max(0, Math.min(100, xp)) / 100 * PW - anc[0] * box.w;
    if (yp !== null) ny = Math.max(0, Math.min(100, yp)) / 100 * PH - anc[1] * box.h;
    didSomething = true;
  }

  // 3. next to another item
  if (p.relative_to_id || p.relative_to_query) {
    const ref = pdfedKadessaFindPlaced(pg, p, 'relative_to_');
    if (ref.item === it) throw new Error('an item cannot be placed relative to itself');
    const rb = pdfedKadessaBoxOf(pg, idx, ref);
    const rink = ref.kind === 'text' ? pdfedKadessaTextInk(idx, ref.item) : null;
    const r = rink || rb;
    const gap = pdfedKadessaNum(p.gap_px) !== null ? Math.max(0, Math.min(400, pdfedKadessaNum(p.gap_px))) : 12;
    const rel = String(p.relation || 'below').toLowerCase().replace(/[\s-]+/g, '_');
    const al = String(p.align || '').toLowerCase();
    const alignX = function () {
      if (al === 'start') return r.x;
      if (al === 'end') return r.x + r.w - box.w;
      if (al === 'center') return r.x + r.w / 2 - box.w / 2;
      return null;
    };
    const alignY = function () {
      if (al === 'start') return r.y;
      if (al === 'end') return r.y + r.h - box.h;
      if (al === 'center') return r.y + r.h / 2 - box.h / 2;
      return null;
    };
    if (rel === 'below') { ny = r.y + r.h + gap; const ax = alignX(); if (ax !== null) nx = ax; }
    else if (rel === 'above') { ny = r.y - box.h - gap; const ax = alignX(); if (ax !== null) nx = ax; }
    else if (rel === 'right_of') { nx = r.x + r.w + gap; const ay = alignY(); if (ay !== null) ny = ay; }
    else if (rel === 'left_of') { nx = r.x - box.w - gap; const ay = alignY(); if (ay !== null) ny = ay; }
    else if (rel === 'center_on' || rel === 'over' || rel === 'on_top_of') { nx = r.x + r.w / 2 - box.w / 2; ny = r.y + r.h / 2 - box.h / 2; }
    else throw new Error('relation must be below, above, left_of, right_of or center_on');
    didSomething = true;
  }

  // 4. centre on the page
  if (p.center_h === true || p.center_h === 'true') { nx = (PW - box.w) / 2; didSomething = true; }
  if (p.center_v === true || p.center_v === 'true') { ny = (PH - box.h) / 2; didSomething = true; }

  // 5. nudges
  const dxp = pdfedKadessaNum(p.dx_pct), dyp = pdfedKadessaNum(p.dy_pct), dxx = pdfedKadessaNum(p.dx_px), dyy = pdfedKadessaNum(p.dy_px);
  if (dxp !== null) { nx += dxp / 100 * PW; didSomething = true; }
  if (dyp !== null) { ny += dyp / 100 * PH; didSomething = true; }
  if (dxx !== null) { nx += dxx; didSomething = true; }
  if (dyy !== null) { ny += dyy; didSomething = true; }

  // 6. tilt
  const rot = pdfedKadessaNum(p.rotation_deg);
  if (rot !== null) { it.rotation = Math.max(-360, Math.min(360, Math.round(rot * 10) / 10)); didSomething = true; }

  if (!didSomething) throw new Error('say where it should go: a spot like top right, an x and y in percent, next to another item, centred, or a nudge');

  // keep the whole item on the page (unless the person really wants it hanging off)
  let clamped = false;
  if (!(p.allow_off_page === true || p.allow_off_page === 'true')) {
    const maxX = PW - box.w, maxY = PH - box.h;
    const cx = Math.min(Math.max(nx, Math.min(0, maxX)), Math.max(0, maxX));
    const cy = Math.min(Math.max(ny, Math.min(0, maxY)), Math.max(0, maxY));
    if (Math.abs(cx - nx) > 1 || Math.abs(cy - ny) > 1) clamped = true;
    nx = cx; ny = cy;
  }
  it.x = Math.round(nx);
  it.y = Math.round(ny);

  const id = it.id;
  const after = { x: it.x, y: it.y, rotation: it.rotation };
  pdfedMarkModified(idx);
  pdfedKadessaRerender(idx);

  const restore = function (s) {
    const cur = pdfedKadessaLookup(pdfed.pages[idx], id);
    if (!cur) return;
    cur.item.x = s.x; cur.item.y = s.y;
    if (s.rotation === undefined) delete cur.item.rotation; else cur.item.rotation = s.rotation;
    pdfedMarkModified(idx);
    pdfedKadessaRerender(idx);
  };
  pushKadessaAppHistory({
    label: 'Move ' + c.label + ' (Kadessa)',
    undo: function () { restore(before); toast('Put back where it was', 'info'); },
    redo: function () { restore(after); }
  });

  const moved = Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1 || after.rotation !== before.rotation;
  let say = null;
  if (!moved) say = pdfedKadessaNiceName(c) + ' was already there, so nothing moved.';
  else if (clamped) say = 'I kept ' + pdfedKadessaNiceName(c) + ' inside the page edge, so it sits a little short of where that pointed.';
  return { id: id, kind: c.label, from: { x: before.x, y: before.y }, to: { x: it.x, y: it.y }, clamped: clamped, say: say };
}

// ── BEHIND / IN FRONT, AND THE OPACITY THAT KEEPS TEXT READABLE ──────────────
function pdfedKadessaLoadImg(src) {
  return new Promise(function (res, rej) {
    const im = new Image();
    im.onload = function () { res(im); };
    im.onerror = function () { rej(new Error('could not read that picture')); };
    im.src = src;
  });
}
function pdfedKadessaLin(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function pdfedKadessaHexLum(hex) {
  const s = String(hex || '').trim();
  let h = null;
  if (/^#[0-9a-f]{6}$/i.test(s)) h = s.slice(1);
  else if (/^#[0-9a-f]{3}$/i.test(s)) h = s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (!h) {
    const m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return null;
    return 0.2126 * pdfedKadessaLin(+m[1]) + 0.7152 * pdfedKadessaLin(+m[2]) + 0.0722 * pdfedKadessaLin(+m[3]);
  }
  return 0.2126 * pdfedKadessaLin(parseInt(h.slice(0, 2), 16)) + 0.7152 * pdfedKadessaLin(parseInt(h.slice(2, 4), 16)) + 0.0722 * pdfedKadessaLin(parseInt(h.slice(4, 6), 16));
}
function pdfedKadessaContrast(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Looks at the picture under every text box and table that sits on it and returns the
// strongest opacity (0.1 to 1) at which ALL of that text still reads comfortably: WCAG contrast of
// at least 7 for normal text, 4.5 for large text, judged against the brightest and darkest
// parts of the picture in that spot (a busy photo has to be fainter than a calm one).
async function pdfedKadessaSuggestBackdropOpacity(pg, idx, imgItem) {
  const size = pdfedKadessaPageSizePx(pg, idx);
  const ib = { x: imgItem.x, y: imgItem.y, w: imgItem.w, h: imgItem.h };
  const covered = [];
  pdfedKadessaAllPlaced(pg).forEach(function (c) {
    if ((c.kind !== 'text' && c.kind !== 'table') || pdfedKadessaIsDecor(c.item)) return;
    const b = c.kind === 'text' ? (pdfedKadessaTextInk(idx, c.item) || pdfedKadessaBoxOf(pg, idx, c)) : pdfedKadessaBoxOf(pg, idx, c);
    const ix = Math.min(ib.x + ib.w, b.x + b.w) - Math.max(ib.x, b.x);
    const iy = Math.min(ib.y + ib.h, b.y + b.h) - Math.max(ib.y, b.y);
    if (ix <= 2 || iy <= 2) return;
    if (ix * iy < 0.05 * Math.max(1, b.w * b.h)) return;
    covered.push({ c: c, box: b, region: { x: Math.max(ib.x, b.x), y: Math.max(ib.y, b.y), w: ix, h: iy } });
  });
  if (!covered.length) return { texts: 0 };

  const img = await pdfedKadessaLoadImg(imgItem.dataUrl);
  const cw = 80;
  const ch = Math.max(8, Math.min(240, Math.round(cw * ib.h / Math.max(1, ib.w))));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, cw, ch);
  let data = null;
  try { data = cx.getImageData(0, 0, cw, ch).data; } catch (e) { data = null; }
  if (!data) return { texts: covered.length, unreadable: true };

  const spots = [];
  let busy = false;
  for (let t = 0; t < covered.length; t++) {
    const cvd = covered[t];
    const rx0 = Math.max(0, Math.min(cw - 1, Math.floor((cvd.region.x - ib.x) / ib.w * cw)));
    const ry0 = Math.max(0, Math.min(ch - 1, Math.floor((cvd.region.y - ib.y) / ib.h * ch)));
    const rx1 = Math.max(rx0 + 1, Math.min(cw, Math.ceil((cvd.region.x + cvd.region.w - ib.x) / ib.w * cw)));
    const ry1 = Math.max(ry0 + 1, Math.min(ch, Math.ceil((cvd.region.y + cvd.region.h - ib.y) / ib.h * ch)));
    let sum = 0, sum2 = 0, n = 0;
    for (let yy = ry0; yy < ry1; yy++) {
      for (let xx = rx0; xx < rx1; xx++) {
        const o = (yy * cw + xx) * 4;
        if (data[o + 3] < 25) continue;
        const L = 0.2126 * pdfedKadessaLin(data[o]) + 0.7152 * pdfedKadessaLin(data[o + 1]) + 0.0722 * pdfedKadessaLin(data[o + 2]);
        sum += L; sum2 += L * L; n++;
      }
    }
    if (!n) continue; // the picture is see-through here, nothing to protect
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (sd > 0.2) busy = true;

    // what the page looks like without the picture, in this spot
    let pageL;
    try {
      const luma = await pdfedKadessaBackdropLuma(pg, cvd.region, size); // 0 to 255
      pageL = pdfedKadessaLin(luma);
    } catch (e) { pageL = pdfedKadessaLin(pdfedKadessaLuma(pg && pg.bgColor)); }

    // the text colour (tables are assumed dark)
    let textL = cvd.c.kind === 'text' ? pdfedKadessaHexLum(cvd.c.item.color) : null;
    if (textL === null) textL = pageL > 0.35 ? 0.006 : 0.9;
    const fs = cvd.c.item.fontSize || 14;
    const large = fs >= 24 || (cvd.c.item.bold && fs >= 19);
    // Text laid over a picture reads worse than the same colours on flat paper, so aim for
    // comfortable contrast: 7 for body text (WCAG AAA), 4.5 for large text.
    spots.push({
      lo: Math.max(0, mean - 1.3 * sd), mean: mean, hi: Math.min(1, mean + 1.3 * sd),
      pageL: pageL, textL: textL, need: large ? 4.5 : 7
    });
  }
  if (!spots.length) return { texts: covered.length, transparent: true };

  // worst contrast any of the text gets if the picture is shown at strength a
  const worstAt = function (sp, a) {
    return Math.min.apply(null, [sp.lo, sp.mean, sp.hi].map(function (Li) {
      return pdfedKadessaContrast(sp.textL, a * Li + (1 - a) * sp.pageL);
    }));
  };
  let pick = 0.1, fail = false;
  for (let a = 1; a >= 0.1 - 1e-9; a -= 0.05) {
    if (spots.every(function (sp) { return worstAt(sp, a) >= sp.need; })) { pick = a; break; }
    if (a <= 0.1 + 1e-9) fail = true;
  }
  pick = Math.max(0.1, Math.min(1, Math.round(pick * 20) / 20));
  const contrast = Math.min.apply(null, spots.map(function (sp) { return worstAt(sp, pick); }));
  return { texts: covered.length, opacity: pick, contrast: Math.round(contrast * 10) / 10, fail: fail, busy: busy };
}

// Crops a picture to exactly the page's shape, no stretching, and returns a data URL.
async function pdfedKadessaCoverBake(dataUrl, PW, PH) {
  const img = await pdfedKadessaLoadImg(dataUrl);
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const s = Math.max(PW / nw, PH / nh);
  const sw = PW / s, sh = PH / s;
  const sx = (nw - sw) / 2, sy = (nh - sh) / 2;
  const k = Math.min(2, 4096 / Math.max(PW, PH));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(PW * k)); cv.height = Math.max(1, Math.round(PH * k));
  cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return /^data:image\/jpe?g/i.test(dataUrl) ? cv.toDataURL('image/jpeg', 0.92) : cv.toDataURL('image/png');
}

async function pdfedKadessaArrangeLayer(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const c = pdfedKadessaFindPlaced(pg, p);
  const it = c.item;
  if (it.locked) throw new Error('that ' + c.label + ' is locked, unlock it first');
  const mode = String(p.mode || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const MODES = ['behind_text', 'in_front_of_text', 'to_back', 'to_front', 'behind', 'in_front_of'];
  if (MODES.indexOf(mode) === -1) throw new Error('mode must be behind_text, in_front_of_text, to_back, to_front, behind or in_front_of');
  const fit = String(p.fit || 'keep').toLowerCase();
  if (fit !== 'keep' && c.kind !== 'image') throw new Error('only a picture can be fitted to the page');

  // snapshot for undo: the whole stacking order plus this item's own geometry, picture and opacity
  const snap = function () {
    const z = {};
    pdfedKadessaAllPlaced(pg).forEach(function (c2) { z[c2.item.id] = c2.item.zIndex; });
    return { z: z, zSeq: pg._zSeq, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation, dataUrl: it.dataUrl, opacity: it.opacity };
  };
  const before = snap();

  // 1. size and place on the page
  const size = pdfedKadessaPageSizePx(pg, idx);
  const PW = size[0], PH = size[1];
  if (fit === 'cover_page') {
    it.dataUrl = await pdfedKadessaCoverBake(it.dataUrl, PW, PH);
    it.x = 0; it.y = 0; it.w = PW; it.h = PH; delete it.rotation;
  } else if (fit === 'contain_page') {
    const s = Math.min(PW / Math.max(1, it.w), PH / Math.max(1, it.h));
    it.w = Math.round(it.w * s); it.h = Math.round(it.h * s);
    it.x = Math.round((PW - it.w) / 2); it.y = Math.round((PH - it.h) / 2);
  }

  // 2. stacking order
  const others = pdfedGetZOrderedItems(pg).filter(function (o) { return o.item !== it; });
  const isTextish = function (o) { return o.kind === 'text' || o.kind === 'table'; };
  let at;
  let hasText = others.some(isTextish);
  if (mode === 'to_back') at = 0;
  else if (mode === 'to_front') at = others.length;
  else if (mode === 'behind_text') {
    at = others.findIndex(isTextish);
    if (at < 0) at = others.length;
  } else if (mode === 'in_front_of_text') {
    at = -1;
    others.forEach(function (o, i) { if (isTextish(o)) at = i; });
    at = at < 0 ? others.length : at + 1;
  } else {
    const ref = pdfedKadessaFindPlaced(pg, p, 'other_');
    const ri = others.findIndex(function (o) { return o.item === ref.item; });
    if (ri < 0) throw new Error('cannot layer an item against itself');
    at = mode === 'behind' ? ri : ri + 1;
  }
  others.splice(at, 0, { kind: c.kind, item: it });
  others.forEach(function (o, i) { o.item.zIndex = i + 1; });
  pg._zSeq = Math.max(pg._zSeq || 0, others.length);

  // 3. opacity: the number the person gave, or the strongest one that keeps the text readable
  let say = null;
  const given = pdfedKadessaNum(p.opacity);
  if (given !== null) {
    it.opacity = Math.max(0.1, Math.min(1, given / 100));
  } else if (mode === 'behind_text' && c.kind === 'image' && p.auto_opacity !== false && p.auto_opacity !== 'false') {
    let adv = null;
    try { adv = await pdfedKadessaSuggestBackdropOpacity(pg, idx, it); } catch (e) { adv = null; }
    if (adv && adv.opacity) {
      const pct = Math.round(adv.opacity * 100);
      it.opacity = adv.opacity >= 1 ? undefined : adv.opacity;
      if (adv.opacity >= 1) delete it.opacity;
      if (adv.fail) say = 'Image is behind the text at ' + pct + '%. Even that faint, the text is still hard to read against it (contrast ' + adv.contrast + '), so a lighter or darker text colour would help more than fading further.';
      else if (adv.opacity >= 1) say = 'Image is behind the text at full strength. The text already reads clearly against it (contrast ' + adv.contrast + '), so I left it solid.';
      else say = 'Image is behind the text at ' + pct + '%. That is the strongest it can be while the text stays easy to read (contrast ' + adv.contrast + ')' + (adv.busy ? ', and the picture is busy so it needed to be on the faint side' : '') + '.';
    } else if (adv && adv.texts === 0) {
      say = 'Image is behind the text. Nothing sits on top of it right now, so I left its opacity alone.';
    }
  }
  if (!say && mode === 'behind_text' && !hasText) say = 'There is no text on this page yet, so the image is just at the back for now.';

  const id = it.id;
  const after = snap();
  pdfedMarkModified(idx);
  pdfedKadessaRerender(idx);

  const restore = function (s) {
    const pgNow = pdfed.pages[idx];
    pdfedKadessaAllPlaced(pgNow).forEach(function (c2) { if (s.z[c2.item.id] !== undefined) c2.item.zIndex = s.z[c2.item.id]; });
    pgNow._zSeq = s.zSeq;
    const cur = pdfedKadessaLookup(pgNow, id);
    if (cur) {
      cur.item.x = s.x; cur.item.y = s.y; cur.item.w = s.w; cur.item.h = s.h;
      if (s.rotation === undefined) delete cur.item.rotation; else cur.item.rotation = s.rotation;
      if (s.dataUrl !== undefined) cur.item.dataUrl = s.dataUrl;
      if (s.opacity === undefined) delete cur.item.opacity; else cur.item.opacity = s.opacity;
    }
    pdfedMarkModified(idx);
    pdfedKadessaRerender(idx);
  };
  pushKadessaAppHistory({
    label: 'Change layer order (Kadessa)',
    undo: function () { restore(before); toast('Layering put back', 'info'); },
    redo: function () { restore(after); }
  });
  return { id: id, mode: mode, opacityPct: Math.round(pdfedGetOpacity(it) * 100), say: say };
}

// ── OVERLAPS: find them (for the context) and pull text apart ────────────────
// Returns the overlaps worth knowing about, most serious first. Overlaps a designer would
// call intentional (a picture behind text, a big background picture) are listed but marked.
function pdfedKadessaAnalyzeOverlaps(pg, idx) {
  const out = [];
  if (!pg) return out;
  const entries = [];
  pdfedGetZOrderedItems(pg).forEach(function (c, rank) {
    if (c.kind === 'border' || c.kind === 'shape') return;
    if (pdfedKadessaIsDecor(c.item)) return;
    const cc = { kind: c.kind, item: c.item, label: pdfedKadessaAssetLabel(c.kind, c.item) };
    const ink = c.kind === 'text' ? pdfedKadessaTextInk(idx, c.item) : null;
    const b = ink || pdfedKadessaBoxOf(pg, idx, cc);
    if (b.w < 4 || b.h < 4) return;
    entries.push({ id: c.item.id, kind: c.kind, label: cc.label, z: rank + 1, box: b, item: c.item });
  });
  const textish = function (e) { return e.kind === 'text' || e.kind === 'table'; };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const ix = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      const iy = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
      if (ix <= 2 || iy <= 2) continue;
      const areaA = a.box.w * a.box.h, areaB = b.box.w * b.box.h;
      const pct = Math.round(ix * iy / Math.max(1, Math.min(areaA, areaB)) * 100);
      if (pct < 5) continue;
      const under = a.z < b.z ? a : b, over = a.z < b.z ? b : a;
      let type = null, note = '', intentional = false;
      if (textish(a) && textish(b)) {
        type = 'text-on-text';
        note = 'the words collide, so both are hard to read';
      } else if (textish(under) && over.kind === 'image') {
        const op = Math.round(pdfedGetOpacity(over.item) * 100);
        if (over.label === 'signature') {
          if (pct >= 25) { type = 'signature-on-text'; note = 'the signature covers some of the writing'; }
        } else if (op >= 85) {
          type = 'text-hidden-by-image';
          note = 'a nearly solid image sits above the text and hides it';
        } else {
          type = 'image-over-text';
          note = 'a see-through image (' + op + '%) sits above the text';
        }
      } else if (under.kind === 'image' && textish(over)) {
        type = 'image-behind-text';
        note = 'picture behind the text at ' + Math.round(pdfedGetOpacity(under.item) * 100) + '% opacity, layered on purpose';
        intentional = true;
      } else if (a.kind === 'image' && b.kind === 'image') {
        const big = areaA >= areaB ? a : b, small = areaA >= areaB ? b : a;
        if (big.box.w * big.box.h > 2.5 * small.box.w * small.box.h && big.z < small.z) {
          type = 'image-background'; note = 'a larger picture sits behind a smaller one'; intentional = true;
        } else if (a.label !== 'signature' && b.label !== 'signature') {
          type = 'image-on-image'; note = 'two pictures cover each other';
        }
      }
      if (type) out.push({ a: under.id, b: over.id, type: type, overlapPct: pct, lowerLayer: under.z, upperLayer: over.z, intentional: intentional, note: note });
    }
  }
  const rankOf = function (o) { return o.intentional ? 9 : (o.type === 'text-hidden-by-image' ? 0 : (o.type === 'text-on-text' ? 1 : 5)); };
  out.sort(function (x, y) { return rankOf(x) - rankOf(y) || y.overlapPct - x.overlapPct; });
  return out;
}

// Pulls apart text boxes and tables that sit on each other by moving the lower one down until
// there is a gap. Locked boxes never move. If it would push anything off the bottom of the
// page nothing is changed and the person is told how much room is missing.
async function pdfedKadessaResolveOverlaps(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);
  const size = pdfedKadessaPageSizePx(pg, idx);
  const PH = size[1];
  const gap = pdfedKadessaNum(p.gap_px) !== null ? Math.max(2, Math.min(80, pdfedKadessaNum(p.gap_px))) : 10;
  const onlyIds = Array.isArray(p.ids) && p.ids.length ? p.ids.map(String) : null;

  const blocks = [];
  pdfedKadessaAllPlaced(pg).forEach(function (c) {
    if ((c.kind !== 'text' && c.kind !== 'table') || pdfedKadessaIsDecor(c.item)) return;
    const ink = (c.kind === 'text' && pdfedKadessaTextInk(idx, c.item)) || pdfedKadessaBoxOf(pg, idx, c);
    blocks.push({
      c: c, id: c.item.id, ink: { x: ink.x, y: ink.y, w: ink.w, h: ink.h },
      locked: !!c.item.locked, movable: !onlyIds || onlyIds.indexOf(c.item.id) !== -1, moved: 0
    });
  });
  if (blocks.length < 2) return { fixed: 0, say: 'There are not enough text boxes on this page to overlap.' };

  const overlapping = function (A, B) {
    const ix = Math.min(A.ink.x + A.ink.w, B.ink.x + B.ink.w) - Math.max(A.ink.x, B.ink.x);
    const iy = Math.min(A.ink.y + A.ink.h, B.ink.y + B.ink.h) - Math.max(A.ink.y, B.ink.y);
    return ix > 4 && iy > 2;
  };
  const stuck = {};
  for (let guard = 0; guard < 300; guard++) {
    blocks.sort(function (a, b) { return a.ink.y - b.ink.y || a.ink.x - b.ink.x; });
    let changed = false;
    outer:
    for (let j = 1; j < blocks.length; j++) {
      for (let i = 0; i < j; i++) {
        const A = blocks[i], B = blocks[j];
        if (!overlapping(A, B)) continue;
        if (B.locked || !B.movable) { stuck[A.id + '|' + B.id] = [A, B]; continue; }
        const dy = (A.ink.y + A.ink.h + gap) - B.ink.y;
        if (dy <= 0) continue;
        B.ink.y += dy; B.moved += dy; changed = true;
        break outer;
      }
    }
    if (!changed) break;
  }
  const movers = blocks.filter(function (b) { return b.moved > 0; });
  const stillStuck = Object.keys(stuck).map(function (k) { return stuck[k]; }).filter(function (pair) { return overlapping(pair[0], pair[1]); });
  if (!movers.length) {
    return { fixed: 0, say: stillStuck.length
      ? 'The text that overlaps is locked, so I could not move it. Unlock it and ask again.'
      : 'Nothing on this page overlaps by mistake, so I left it as it is.' };
  }
  const lowest = Math.max.apply(null, movers.map(function (b) { return b.ink.y + b.ink.h; }));
  if (lowest > PH - 12) {
    return { fixed: 0, say: 'Pulling the text apart would push it off the bottom of the page (about ' + Math.round(lowest - (PH - 12)) + ' px short). Shrink the text a little, or move some of it to a new page, and I will separate it.' };
  }

  const beforeY = {};
  movers.forEach(function (b) { beforeY[b.id] = b.c.item.y; });
  movers.forEach(function (b) { b.c.item.y = Math.round(b.c.item.y + b.moved); });
  const afterY = {};
  movers.forEach(function (b) { afterY[b.id] = b.c.item.y; });
  pdfedMarkModified(idx);
  pdfedKadessaRerender(idx);

  const apply = function (ys) {
    const pgNow = pdfed.pages[idx];
    Object.keys(ys).forEach(function (id) {
      const cur = pdfedKadessaLookup(pgNow, id);
      if (cur) cur.item.y = ys[id];
    });
    pdfedMarkModified(idx);
    pdfedKadessaRerender(idx);
  };
  pushKadessaAppHistory({
    label: 'Separate overlapping text (Kadessa)',
    undo: function () { apply(beforeY); toast('Text put back where it was', 'info'); },
    redo: function () { apply(afterY); }
  });
  const names = movers.slice(0, 3).map(function (b) { return b.c.kind === 'text' ? (pdfedKadessaShortText(b.c.item) || 'a text box') : 'a table'; });
  let say = 'Pulled ' + movers.length + ' overlapping ' + (movers.length === 1 ? 'box' : 'boxes') + ' apart by moving ' + (movers.length === 1 ? 'it' : 'them') + ' down: ' + names.join(', ') + (movers.length > 3 ? ' and more' : '') + '.';
  if (stillStuck.length) say += ' A locked box still touches something, unlock it if you want that one moved too.';
  return { fixed: movers.length, say: say };
}

function teResetBlock() {
  const bd = teState.focusedBlock;
  if (!bd) return;
  bd.el.textContent = bd.origText; // wipes all children, including the resize/move/width/delete handles, re-add below
  if (bd.handleEl) bd.el.appendChild(bd.handleEl);
  if (bd.moveHandleEl) bd.el.appendChild(bd.moveHandleEl);
  if (bd.widthHandleR) bd.el.appendChild(bd.widthHandleR);
  if (bd.widthHandleL) bd.el.appendChild(bd.widthHandleL);
  if (bd.delHandleEl) bd.el.appendChild(bd.delHandleEl);
  bd.el.style.color      = bd.color = '#000000';
  bd.el.style.fontWeight = 'normal'; bd.bold = false;
  bd.el.style.fontStyle  = 'normal'; bd.italic = false;
  bd.fontSize = bd.baseFontSize = bd.origFontSize;
  bd.el.style.fontSize   = bd.fontSize + 'px';
  bd.el.style.width  = '';
  bd.el.style.height = '';
  bd.el.classList.remove('modified');
  document.getElementById('teSizeSlider').value = 0;
  teState.sizeAdj = 0;
  document.getElementById('teSizeVal').textContent = '0';
  toast('Block reset', 'info');
}

function pdfedCancelTextEdit() {
  const pg = pdfed.active >= 0 ? pdfed.pages[pdfed.active] : null;
  teState.active = false;
  teState.blocks = [];
  teState.focusedBlock = null;
  if (typeof teExitCompareSplit === 'function') teExitCompareSplit();
  pdfedSyncCompareBtnVisibility();
  document.getElementById('pdfedTextBtn').classList.remove('active');
  document.getElementById('pdfedApplyTextBtn').style.display = 'none';
  document.getElementById('pdfedCancelTextBtn').style.display = 'none';
  document.getElementById('pdfedTextPanel').style.display = 'none';
  // Revert to the last-saved state (any unsaved edits in this session are discarded)
  if (pg) pdfedRenderTextLayer(pg, false);
}

// Renders pg.textBlocks onto the overlay. interactive=true makes them editable/
// draggable/lockable (used during an active Text Editor session); interactive=false
// shows them read-only on the normal canvas view, so saved text is always visible
// without needing to re-open the editor.
function pdfedRenderTextLayer(pg, interactive) {
  const overlay = document.getElementById('pdfedTextOverlay');
  if (!overlay || !pg) return;
  overlay.innerHTML = '';
  overlay.classList.toggle('active', !!interactive);
  const canvas = document.getElementById('pdfedPageCanvas');
  if (canvas && canvas.width) {
    overlay.style.width  = canvas.width  + 'px';
    overlay.style.height = canvas.height + 'px';
  }
  // Same density correction as pdfedApplyZoom()/pdfedStartTextEdit() — without
  // it, native PDF pages (rendered at 144dpi vs. the 96dpi on-screen baseline)
  // show their OCR/text boxes oversized and drifting away from the real text
  // the further a box sits from the top-left corner.
  const pdfedTlZoomNormalize = PDFED_PX_PER_MM / ((pg._pxPerMm) || PDFED_PX_PER_MM);
  const z = pdfed.zoom * pdfedTlZoomNormalize;
  overlay.style.transform = `scale(${z})`;
  overlay.style.setProperty('--pdfed-inv-zoom', (1 / (z || 1)).toFixed(4));
  overlay.style.transformOrigin = 'top left';
  if (!interactive) {
    (pg.textBlocks || []).forEach(tb => teAddBlock(tb, overlay, false));
  }
}

// Serializes the live, in-session DOM blocks (teState.blocks) into plain data
// for persistence on pg.textBlocks, this is what lets the user leave the editor
// and come back later to keep dragging/recoloring/locking/unlocking the same text.
function teSerializeBlocks() {
  return teState.blocks
    .filter(bd => bd.el.isConnected) // skip anything deleted mid-session
    .filter(bd => !(bd.free && !bd.el.textContent.trim())) // drop emptied-out free blocks
    .map(bd => ({
      x: bd.x, y: bd.y,
      fontSize: bd.fontSize,
      fontFamily: bd.fontFamily,
      color: bd.color,
      bold: bd.bold,
      italic: bd.italic,
      free: bd.free,
      locked: bd.locked,
      origText: bd.origText,
      text: bd.el.textContent,
      html: bd.el.innerHTML,
      origWidth: bd.origWidth,
      origHeight: bd.origHeight,
      bgColor: bd.bgColor,
    }));
}

// Keeps pg.textBlocks in sync with whatever's on screen right now, WITHOUT
// exiting the Text Editor session (unlike "Apply", which also closes the
// panel and rebuilds thumbnails). Called on blur, i.e. clicking outside a
// box, and on delete, so edits stick immediately instead of requiring an
// explicit "Apply" click every time.
function teAutoSaveBlocks() {
  if (!teState.active || pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  if (!pg) return;
  pg.textBlocks = teSerializeBlocks();
  if (pg.textBlocks.length) {
    pg.modified = true;
    pg.edits.textEdited = true;
  }
}

async function pdfedApplyTextEdits() {
  if (pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];

  pg.textBlocks = teSerializeBlocks();
  if (pg.textBlocks.length) {
    pg.modified = true;
    pg.edits.textEdited = true;
  }

  pdfedCancelTextEdit(); // re-renders the saved blocks read-only on the canvas
  await pdfedBuildStrip(); // refreshes thumbnails with text baked in
  toast(pg.textBlocks.length
    ? 'Saved, ' + pg.textBlocks.length + ' text block' + (pg.textBlocks.length !== 1 ? 's' : '') + ' on this page. Click "OCR" anytime to keep editing.'
    : 'No text blocks to save', 'success');
}

// Returns a flattened (text baked onto the base image) dataURL for a page, used
// for thumbnails and export only. The page's actual base image (pg.dataUrl) is
// left untouched, so the text layer (pg.textBlocks) stays a live, editable object
// indefinitely instead of being permanently rasterized the moment it's saved.
async function pdfedFlattenPageDataUrl(pg) {
  const baseUrl = await pdfedPageUrl(pg);
  if (!pg.textBlocks || !pg.textBlocks.length) return baseUrl;

  const baseImg = new Image();
  await new Promise((res, rej) => { baseImg.onload = res; baseImg.onerror = rej; baseImg.src = baseUrl; });

  const out = document.createElement('canvas');
  out.width  = baseImg.naturalWidth;
  out.height = baseImg.naturalHeight;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseImg, 0, 0);

  // Off-screen container so offsetWidth/offsetHeight (needed for the white-out
  // rect under edited PDF text) measure correctly, without ever being visible.
  const meas = document.createElement('div');
  meas.style.cssText = 'position:fixed; left:-99999px; top:0; visibility:hidden; white-space:pre;';
  document.body.appendChild(meas);

  pg.textBlocks.forEach(tb => {
    const el = document.createElement('div');
    el.className = 'pdfed-text-block';
    el.style.position = 'absolute';
    el.style.left = '0px'; el.style.top = '0px';
    el.style.fontSize = tb.fontSize + 'px';
    el.style.fontFamily = tb.fontFamily || 'Arial, sans-serif';
    el.style.color = tb.color || '#000000';
    el.style.fontWeight = tb.bold ? 'bold' : 'normal';
    el.style.fontStyle = tb.italic ? 'italic' : 'normal';
    if (tb.html) el.innerHTML = tb.html;
    else el.textContent = tb.text || tb.origText || '';
    meas.appendChild(el);

    const displayedSize = tb.fontSize;
    const text = el.textContent || '';
    if (text.trim() || tb.free) {
      if (!tb.free) {
        // Cover whichever is bigger, the original glyphs' footprint or the new
        // text's, so a shorter replacement doesn't leave old text peeking out
        // the sides, and a longer one still gets a clean patch under it.
        const w = Math.max(tb.origWidth  || 0, el.offsetWidth  || 200);
        const h = Math.max(tb.origHeight || 0, el.offsetHeight || displayedSize * 1.4);
        ctx.fillStyle = tb.bgColor || '#ffffff';
        ctx.fillRect(tb.x - 2, tb.y - 2, w + 4, h + 4);
      }
      ctx.textBaseline = 'top';
      const lines = teExtractColoredLines(el, tb.color || '#000000', tb.bold, tb.italic);
      lines.forEach((segments, li) => {
        let penX = tb.x;
        const lineY = tb.y + li * displayedSize * 1.2;
        segments.forEach(seg => {
          if (!seg.text) return;
          let fontStr = '';
          if (seg.italic) fontStr += 'italic ';
          if (seg.bold)   fontStr += 'bold ';
          fontStr += displayedSize + 'px ';
          fontStr += (tb.fontFamily || 'Arial, sans-serif');
          ctx.font = fontStr;
          ctx.fillStyle = seg.color || tb.color || '#000000';
          ctx.fillText(seg.text, penX, lineY);
          penX += ctx.measureText(seg.text).width;
        });
      });
    }
    meas.removeChild(el);
  });

  document.body.removeChild(meas);
  return out.toDataURL('image/png');
}

// Draws every placed object (images, text boxes, tables) onto a canvas
// context IN THEIR UNIFIED Z-ORDER, so exported/baked/thumbnail output
// matches on-screen stacking exactly, an image sent to front actually
// paints over text underneath it, and vice versa, instead of images always
// being drawn first no matter what Arrange says.
async function pdfedDrawOrderedPlacedOnCtx(ctx, pg, skipTexts, skipImages, itemFilter) {
  const ordered = pdfedGetZOrderedItems(pg);
  for (const { kind, item } of ordered) {
    if (itemFilter && !itemFilter(kind, item)) continue;
    // skipTexts lets the "editable PDF" export path leave text boxes OUT of
    // the flattened raster entirely, so they can be re-added a moment later
    // as real, selectable/editable vector text (see pdfedRenderPlacedTextsAsPdfText)
    // instead of being permanently baked into pixels. skipImages is the same
    // idea, used when rotating a page: images now carry their own rotation
    // and stay live objects instead of being flattened (see pdfedRotatePage).
    if (skipTexts && kind === 'text') continue;
    if (skipImages && kind === 'image') continue;
    // Every placed object's own opacity (default fully opaque) is honored at
    // bake time via globalAlpha, so exports/thumbnails/permanent-bakes match
    // whatever the user dialed in on screen, reset right after so one faded
    // object never bleeds transparency into the next thing drawn.
    ctx.globalAlpha = pdfedGetOpacity(item);
    if (kind === 'border') {
      pdfedDrawBorderOnCtx(ctx, item.w, item.h, {
        style: item.style,
        marginPct: item.marginPct,
        thickness: item.thickness,
        color: item.color
      }, item.x, item.y);
    } else if (kind === 'shape') {
      const isDirectional = (item.tool === 'line' || item.tool === 'arrow' || item.tool === 'dblarrow');
      const sx1 = isDirectional && item.flipX ? item.w : 0;
      const sy1 = isDirectional && item.flipY ? item.h : 0;
      const sx2 = isDirectional && item.flipX ? 0 : item.w;
      const sy2 = isDirectional && item.flipY ? 0 : item.h;
      ctx.save();
      ctx.translate(item.x, item.y);
      pdfedDrawShapeOnCtx(ctx, item.tool, item.color, item.size, sx1, sy1, sx2, sy2);
      ctx.restore();
    } else if (kind === 'image') {
      try {
        const im = await new Promise((res, rej) => {
          const i2 = new Image();
          i2.onload = () => res(i2);
          i2.onerror = rej;
          i2.src = item.dataUrl;
        });
        // Fill the exact box (matches the on-screen object-fit:fill), instead
        // of the old letterboxed/aspect-preserving math — otherwise the
        // exported PDF would show blank gaps around the picture that the
        // editor itself no longer shows.
        const dw = item.w, dh = item.h, dx = item.x, dy = item.y;
        // Rotate around the image's own box center (mirrors the CSS
        // transform: rotate() the live on-screen box gets), so a rotated,
        // still-editable image bakes at export time exactly where it
        // visually sits on screen instead of snapping back upright.
        if (item.rotation) {
          const icx = item.x + item.w / 2, icy = item.y + item.h / 2;
          ctx.save();
          ctx.translate(icx, icy);
          ctx.rotate(item.rotation * Math.PI / 180);
          ctx.translate(-icx, -icy);
          ctx.drawImage(im, dx, dy, dw, dh);
          ctx.restore();
        } else {
          ctx.drawImage(im, dx, dy, dw, dh);
        }
      } catch (e) { /* skip broken image, keep going */ }
    } else if (kind === 'text') {
      pdfedDrawPlacedTextsOnCtx(ctx, [item]);
    } else if (kind === 'table') {
      pdfedDrawPlacedTablesOnCtx(ctx, [item]);
    }
    ctx.globalAlpha = 1;
  }
}
