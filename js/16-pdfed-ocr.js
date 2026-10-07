// ---- OCR fallback (Tesseract.js) -------------------------------------------
// Used whenever pdf.js can't hand us real text objects: scanned/blurry PDFs,
// photographed pages, image-type pages, and re-uploaded exports that got
// flattened to a single PNG on the way out. Runs against whatever is currently
// painted on #pdfedPageCanvas, so it doesn't care how the page got there.

let _teOcrWorkerPromise = null;
// Set to a function for the duration of an active recognize() call; the
// worker's `logger` (below) calls whatever is currently assigned here so the
// visible progress bar reflects the run in progress. Cleared when done.
let _teOcrProgressCb = null;
// Tesseract reports internal stage names, not something to show a person —
// translate them into plain, reassuring status text.
const PDFED_OCR_STATUS_LABELS = {
  'loading tesseract core': 'Loading OCR engine…',
  'initializing tesseract': 'Starting OCR engine…',
  'loading language traineddata': 'Loading language data…',
  'initializing api': 'Preparing OCR…',
  'recognizing text': 'Reading text (OCR)…'
};
// ---- PP-OCR (PaddleOCR.js) — English recognition engine -------------------
// Every English-only OCR path in the app (page/PDF text extraction, image-
// table extraction, scanned-PDF fallback — everything that goes through
// pdfedGetOcrWorker() below) runs on this engine instead of Tesseract.js.
// It's a real detector+recognizer pair (PP-OCRv5), not a single legacy LSTM
// model, so it reads real-world scans/photos — invoices, quotations,
// receipts — noticeably more accurately, and its detector actually finds
// text regions first instead of just reading whatever box it's handed,
// which is what fixes the "whole table silently dropped" and "shaded header
// row breaks detection" failures reported against the old engine.
// The multilingual PII Redact module (eng+hin+guj, for Aadhaar/PAN cards)
// intentionally still runs on Tesseract.js elsewhere in this file: PP-OCR
// has no Gujarati recognition model, so switching that path over would
// silently regress the Gujarati-misread fix already in place there. Only
// the pure-English paths move to the new engine.
let _ppOcrInstancePromise = null;
function ppGetOcrInstance() {
  if (!_ppOcrInstancePromise) {
    _ppOcrInstancePromise = import('https://esm.sh/@paddleocr/paddleocr-js@0.4.2?bundle')
      .then(mod => mod.PaddleOCR.create({
        lang: 'en',
        ocrVersion: 'PP-OCRv5',
        ortOptions: {
          backend: 'wasm',
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/'
        }
      }))
      .catch(err => {
        _ppOcrInstancePromise = null;
        throw err;
      });
  }
  return _ppOcrInstancePromise;
}

// PP-OCR's detector reports one polygon per detected LINE (a whole printed
// line, or a whole isolated phrase), not one box per word the way
// Tesseract's word-level output does. Every downstream consumer that was
// built against Tesseract's shape — table-column reconstruction, the PII
// module's "value near this label" geometry, the per-word cover-patch
// redraw when editing OCR'd text — inspects individual words, so this
// distributes each line's pixel width across its words in proportion to
// character count (including the trailing space) to synthesize a per-word
// x-position. That's an approximation (assumes roughly even glyph width
// within one line) good enough for column grouping and click targets; it's
// not a re-detection, so don't expect pixel-perfect per-glyph underlines.
function ppSplitLineIntoWords(text, x0, y0, x1, y1, scorePct) {
  const tokens = (text || '').split(/(\s+)/);
  const totalChars = Math.max(1, (text || '').length);
  const width = Math.max(1, x1 - x0);
  let cursor = x0;
  const words = [];
  tokens.forEach(tok => {
    const w = (tok.length / totalChars) * width;
    if (tok.trim()) {
      words.push({ text: tok, confidence: scorePct, bbox: { x0: cursor, y0, x1: cursor + w, y1 } });
    }
    cursor += w;
  });
  return words;
}

// Converts one PaddleOCR.js OcrResult into the exact {lines, words, text}
// shape Tesseract.js has always handed back, so nothing downstream needs to
// change — only the engine underneath pdfedGetOcrWorker() does.
function ppResultToTesseractShape(result) {
  const lines = (result.items || []).map(item => {
    const xs = item.poly.map(p => p[0]);
    const ys = item.poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const scorePct = Math.round((item.score || 0) * 100);
    const words = ppSplitLineIntoWords(item.text || '', x0, y0, x1, y1, scorePct);
    return { text: item.text || '', confidence: scorePct, bbox: { x0, y0, x1, y1 }, words };
  });
  const allWords = lines.reduce((acc, l) => acc.concat(l.words), []);
  return { lines, words: allWords, text: lines.map(l => l.text).join('\n') };
}

// Rejects with a clearly-tagged timeout error if `promise` doesn't settle
// within `ms`. Without this, a blocked/hanging fetch of the PP-OCR module or
// its WASM weights from esm.sh/jsdelivr just leaves a person staring at a
// frozen "Loading OCR engine…" bar forever instead of failing over to the
// bundled engine below.
function ppWithTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(Object.assign(new Error((label || 'Operation') + ' timed out'), { ocrEngineUnavailable: true }));
    }, ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

// ---- Fallback engine: bundled Tesseract.js ---------------------------------
// PP-OCR (above) is the primary engine and normally more accurate, but it's
// fetched live from esm.sh + a WASM CDN on first use, anything that blocks or
// breaks that (an ad-blocker, a corporate firewall, esm.sh having a bad
// moment, a CSP rule) used to surface as a flat "OCR error" with no real text
// ever extracted, on ANY page, image or PDF, for the rest of the session.
// Tesseract.js, unlike PP-OCR, is already loaded as a plain <script> tag in
// this file (no runtime import), so it has no equivalent failure mode, it's
// the natural safety net: same {lines,words,text} output shape this whole
// file already expects (that shape was built around Tesseract's own output
// originally), so no downstream code needs to know which engine actually ran.
let _teFallbackWorkerPromise = null;
function teGetFallbackTesseractWorker() {
  if (!_teFallbackWorkerPromise) {
    _teFallbackWorkerPromise = Tesseract.createWorker('eng').catch(err => {
      _teFallbackWorkerPromise = null;
      throw Object.assign(err, { ocrEngineUnavailable: true });
    });
  }
  return _teFallbackWorkerPromise;
}
function teMakeFallbackWorkerFacade() {
  return {
    recognize: async (canvas) => {
      if (_teOcrProgressCb) _teOcrProgressCb(0.2, PDFED_OCR_STATUS_LABELS['initializing tesseract']);
      const worker = await teGetFallbackTesseractWorker();
      if (_teOcrProgressCb) _teOcrProgressCb(0.55, PDFED_OCR_STATUS_LABELS['recognizing text']);
      const { data } = await worker.recognize(canvas);
      if (_teOcrProgressCb) _teOcrProgressCb(0.95, PDFED_OCR_STATUS_LABELS['recognizing text']);
      return { data };
    }
  };
}

// Tesseract-worker-shaped facade backed by PP-OCR. Model download+init is
// the slow part and PaddleOCR.js doesn't expose fine-grained load progress
// the way Tesseract's logger did, so this reports the same reassuring
// status labels at the two real stage transitions (loading, reading)
// instead of a frozen-looking progress bar.
function ppMakeWorkerFacade() {
  return {
    recognize: async (canvas) => {
      if (_teOcrProgressCb) _teOcrProgressCb(0.1, PDFED_OCR_STATUS_LABELS['loading tesseract core']);
      const ocr = await ppGetOcrInstance();
      if (_teOcrProgressCb) _teOcrProgressCb(0.55, PDFED_OCR_STATUS_LABELS['recognizing text']);
      const [result] = await ocr.predict(canvas);
      if (_teOcrProgressCb) _teOcrProgressCb(0.95, PDFED_OCR_STATUS_LABELS['recognizing text']);
      return { data: ppResultToTesseractShape(result) };
    }
  };
}

// Single choke point every OCR call in the app goes through (Edit Text,
// Extract Text, image-to-table, PDF-to-table). Tries the primary PP-OCR
// engine first (better real-world accuracy), bounded by a timeout so a
// blocked/slow CDN can't hang forever; on failure it permanently switches
// this session to the bundled Tesseract engine instead of retrying a CDN
// that's already shown itself to be unreachable on every subsequent OCR
// call. Only throws (a clearly-tagged, unavailable-engine error) if BOTH
// engines fail to even initialize — actual "couldn't read this specific
// page" outcomes are a normal, separate, per-call result, not an engine
// failure, and are handled by each call site the same way they always were.
let _teUsingFallbackEngine = false;
function pdfedGetOcrWorker() {
  if (!_teOcrWorkerPromise) {
    _teOcrWorkerPromise = (async () => {
      if (!_teUsingFallbackEngine) {
        try {
          await ppWithTimeout(ppGetOcrInstance(), 20000, 'OCR engine');
          return ppMakeWorkerFacade();
        } catch (err) {
          console.warn('Primary OCR engine (PP-OCR) failed to load, switching to the bundled backup engine for this session:', err);
          _teUsingFallbackEngine = true;
        }
      }
      // Prime the fallback now so a broken fallback also fails fast, with a
      // clearly-tagged error, instead of only surfacing on the first recognize() call.
      await teGetFallbackTesseractWorker();
      return teMakeFallbackWorkerFacade();
    })().catch(err => {
      _teOcrWorkerPromise = null; // let a future call try again from scratch
      throw Object.assign(err, { ocrEngineUnavailable: true });
    });
  }
  return _teOcrWorkerPromise;
}

// Shows the persistent bottom-left OCR status card so a person never has to
// just stare at a frozen page wondering if anything is happening. `pct` is
// 0-1 (or omitted to just show the label at a small starting sliver).
function pdfedShowOcrProgress(label) {
  const box = document.getElementById('pdfedOcrProgress');
  if (!box) return;
  box.style.display = 'block';
  pdfedUpdateOcrProgress(0.04, label || 'Starting OCR engine…');
}
function pdfedUpdateOcrProgress(fraction, label) {
  const box = document.getElementById('pdfedOcrProgress');
  if (!box || box.style.display === 'none') return;
  const fill = document.getElementById('pdfedOcrProgressFill');
  const pctEl = document.getElementById('pdfedOcrProgressPct');
  const lblEl = document.getElementById('pdfedOcrProgressLabel');
  const pct = Math.max(4, Math.min(100, Math.round((fraction || 0) * 100)));
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (lblEl && label) lblEl.textContent = label;
}
function pdfedHideOcrProgress() {
  const box = document.getElementById('pdfedOcrProgress');
  if (!box) return;
  pdfedUpdateOcrProgress(1, 'Done');
  // Briefly hold at 100% so it reads as "finished", not "vanished mid-way".
  setTimeout(() => { box.style.display = 'none'; }, 300);
}

// Picks how much to upscale a page before OCR based on its OWN resolution,
// instead of always multiplying by a flat 2x. A page that was scanned/
// exported small (its longer edge well under ~1500px) has genuinely coarse
// glyph detail, that needs a bigger boost to give the recognizer enough
// pixels per character. A page that's already high-res (a crisp 300dpi scan,
// or a page re-exported from this app at 2x) gains little from more
// upscaling, blowing it up further just burns time/memory for no accuracy
// gain and can even soften edges through repeated resampling. Bounded on
// both ends: never shrinks (min 1x) and never produces a canvas whose long
// edge exceeds PDFED_OCR_MAX_EDGE, regardless of source size, so a huge
// source canvas can't blow past the recognizer's practical sweet spot or the
// browser's canvas memory limits.
const PDFED_OCR_TARGET_EDGE = 3000;
const PDFED_OCR_MAX_EDGE = 3600;
function pdfedComputeOcrScale(w, h) {
  const longEdge = Math.max(w, h) || 1;
  let scale = PDFED_OCR_TARGET_EDGE / longEdge;
  scale = Math.max(1, Math.min(scale, 3));
  if (longEdge * scale > PDFED_OCR_MAX_EDGE) scale = PDFED_OCR_MAX_EDGE / longEdge;
  return scale;
}

// Light 3x3 unsharp-style sharpen pass over the (already grayscale)
// luminance buffer, run after the contrast stretch below. Upscaling with
// bilinear/high-quality smoothing (needed to avoid jagged edges) softens
// glyph edges as a side effect, exactly the edges the recognizer depends on
// most to tell adjacent characters apart ("rn" vs "m", "cl" vs "d"). This
// pulls a little of that sharpness back without a full Gaussian-blur unsharp
// mask, cheap enough to run on every OCR pass. `amount` is how strongly the
// centre pixel is boosted relative to its neighbours; kept modest so it
// doesn't blow out already-crisp text into ringing/haloing.
function pdfedSharpenGray(gray, w, h, amount) {
  const amt = amount != null ? amount : 0.35;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { out[i] = gray[i]; continue; }
      const center = gray[i];
      const neighborSum = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w];
      const sharpened = center + amt * (center * 4 - neighborSum);
      out[i] = sharpened;
    }
  }
  return out;
}

// Upscales the page (adaptively — see pdfedComputeOcrScale above) and
// stretches its luminance histogram to the full 0-255 range, then sharpens
// it, before handing it to the OCR engine. Blurry scans/exports tend to be
// both small (relative to real glyph detail) and washed-out/low-contrast,
// OCR engines miss far more characters on that combination than on crisp,
// high-contrast text. Upscaling recovers some of the missing resolution, the
// contrast stretch sharpens the text/background separation, and the sharpen
// pass claws back edge definition the upscale's smoothing softened, all
// without a hard binarization threshold that could erase thin strokes on
// lighter fonts.
function pdfedPreprocessForOcr(srcCanvas, forceScale) {
  const scale = forceScale || pdfedComputeOcrScale(srcCanvas.width, srcCanvas.height);
  const w = Math.max(1, Math.round(srcCanvas.width * scale));
  const h = Math.max(1, Math.round(srcCanvas.height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(srcCanvas, 0, 0, w, h);

  const imgData = tctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const gray = new Uint8ClampedArray(w * h);
  let min = 255, max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  const stretched = new Uint8ClampedArray(w * h);
  for (let p = 0; p < gray.length; p++) {
    stretched[p] = ((gray[p] - min) / range) * 255;
  }
  const sharpened = pdfedSharpenGray(stretched, w, h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = d[i + 1] = d[i + 2] = sharpened[p];
  }
  tctx.putImageData(imgData, 0, 0);
  return { canvas: tmp, scale };
}

// ---- Targeted re-OCR for weak lines ----------------------------------------
// A single uniform pass over the whole page is what every basic in-browser
// OCR wrapper does, and it's a real accuracy ceiling: a page is rarely
// uniformly hard. One dense, small-print line (a footer, a table of fine
// print, a stamp) drags down the read while the rest of the page is clean,
// and upscaling the WHOLE page further just to rescue that one line wastes
// time and can blur the parts that were already reading fine. Instead, after
// the normal pass, any line whose average word confidence falls in a
// "probably wrong but not hopeless" band gets re-cropped from the original,
// untouched source canvas — just that line's own region, at a much higher
// zoom with its own fresh contrast-stretch/sharpen — and re-read in
// isolation. If the isolated re-read comes back more confident, it replaces
// the line in place; if not, the original stands. Lines already confident
// enough, or so garbled a bigger crop won't help (mostly true for actual
// graphics/watermarks misread as text), are left alone, and the number of
// retries per page is capped, so this stays a small, bounded top-up rather
// than doubling the whole page's OCR cost.
const PDFED_OCR_RETRY_MIN_CONF = 35;
const PDFED_OCR_RETRY_MAX_CONF = 68;
const PDFED_OCR_RETRY_SCALE = 4;
const PDFED_OCR_RETRY_MAX_LINES = 12;
// Threshold used ONLY by Kadessa's own read flow (pdfedReadPageForKadessa /
// pdfed_read_page below), not by the manual Extract Text button. Below
// this average line confidence, the local (free) OCR pass is flagged as
// uncertain so a paid GPT-5.6 Luna vision re-read can be OFFERED -- it is
// never triggered automatically, only when the person or Kadessa explicitly
// asks for a better read after seeing this flag.
const PDFED_VISION_FALLBACK_MAX_CONF = 55;
async function pdfedRetryWeakLines(srcCanvas, lines, scale, worker) {
  const srcW = srcCanvas.width, srcH = srcCanvas.height;
  const candidates = lines
    .map((l, idx) => ({
      l, idx,
      avgConf: (l.words && l.words.length)
        ? l.words.reduce((a, w) => a + (w.confidence || 0), 0) / l.words.length
        : (l.confidence || 0)
    }))
    .filter(c => c.avgConf >= PDFED_OCR_RETRY_MIN_CONF && c.avgConf < PDFED_OCR_RETRY_MAX_CONF)
    .slice(0, PDFED_OCR_RETRY_MAX_LINES);
  if (!candidates.length) return;

  for (const c of candidates) {
    const bb = c.l.bbox;
    // bbox is in the main pass's (already-upscaled) OCR-canvas coordinate
    // space — map back to the real source canvas first, then pad a small
    // margin so the crop doesn't clip ascenders/descenders right at the edge.
    const padX = (bb.x1 - bb.x0) * 0.08, padY = (bb.y1 - bb.y0) * 0.35;
    const sx0 = Math.max(0, Math.round(bb.x0 / scale - padX));
    const sy0 = Math.max(0, Math.round(bb.y0 / scale - padY));
    const sx1 = Math.min(srcW, Math.round(bb.x1 / scale + padX));
    const sy1 = Math.min(srcH, Math.round(bb.y1 / scale + padY));
    const cw = sx1 - sx0, ch = sy1 - sy0;
    if (cw < 4 || ch < 4) continue;

    const crop = document.createElement('canvas');
    crop.width = cw; crop.height = ch;
    crop.getContext('2d').drawImage(srcCanvas, sx0, sy0, cw, ch, 0, 0, cw, ch);

    let retryData, retryScale;
    try {
      const pre = pdfedPreprocessForOcr(crop, PDFED_OCR_RETRY_SCALE);
      retryScale = pre.scale;
      const result = await worker.recognize(pre.canvas);
      retryData = result.data;
    } catch (e) { continue; } // isolated crop failed to read — keep the original line

    const newLine = retryData.lines && retryData.lines[0];
    if (!newLine || !newLine.text || !newLine.text.trim()) continue;
    const newConf = (newLine.words && newLine.words.length)
      ? newLine.words.reduce((a, w) => a + (w.confidence || 0), 0) / newLine.words.length
      : (newLine.confidence || 0);
    if (newConf <= c.avgConf) continue; // isolated read wasn't actually better — keep the original

    // Re-map the retry's local (crop-space) word boxes back into the SAME
    // coordinate space the rest of this OCR pass expects (the main upscaled
    // OCR canvas), so nothing downstream needs to know a retry ever happened.
    const remappedWords = (newLine.words || []).map(w => ({
      text: w.text,
      confidence: w.confidence,
      bbox: {
        x0: scale * (sx0 + w.bbox.x0 / retryScale),
        y0: scale * (sy0 + w.bbox.y0 / retryScale),
        x1: scale * (sx0 + w.bbox.x1 / retryScale),
        y1: scale * (sy0 + w.bbox.y1 / retryScale),
      }
    }));
    if (!remappedWords.length) continue;
    lines[c.idx] = { text: newLine.text, confidence: newConf, bbox: c.l.bbox, words: remappedWords };
  }
}

// opts.allowVision + opts.visionFetcher(dataUrl, priorOcrText) -> Promise<string>:
// only ever set by Kadessa's pdfed_make_editable action, never by the manual
// "OCR" button (which always calls this with no opts, i.e. free/local-only,
// exactly as before). visionFetcher is injected by the caller rather than
// this function reaching for callKadessaVisionOcr itself, since that lives in a
// different scope (the Kadessa module) -- keeps this function self-contained
// and usable with or without Kadessa around.
async function pdfedOcrExtract(overlay, opts) {
  opts = opts || {};
  const srcCanvas = document.getElementById('pdfedPageCanvas');
  if (!srcCanvas || !srcCanvas.width) { teShowFreeOnly(overlay, 'This page hasn\'t finished rendering yet, so there\'s nothing to read text from. Try again in a moment.'); return; }

  document.getElementById('teBlockCount').textContent = 'Reading text (OCR)…';
  toast('Scanning page for text (OCR)…', 'info');
  pdfedShowOcrProgress('Starting OCR engine…');
  _teOcrProgressCb = pdfedUpdateOcrProgress;

  try {
    const { canvas: ocrCanvas, scale } = pdfedPreprocessForOcr(srcCanvas);
    const worker = await pdfedGetOcrWorker();
    const { data } = await worker.recognize(ocrCanvas);
    const srcCtx = srcCanvas.getContext('2d');

    // Give the borderline lines from the main pass a second, focused look
    // before we start clustering/rendering — see pdfedRetryWeakLines above.
    pdfedUpdateOcrProgress(0.97, 'Double-checking faint text…');
    await pdfedRetryWeakLines(srcCanvas, data.lines || [], scale, worker);

    let blockCount = 0;
    const lines = (data.lines || []).filter(l => l.text && l.text.trim() && l.confidence >= 35);

    // ---- Accuracy cross-check: AI vision, only when it's actually needed --
    // Local OCR gives us WHERE each word sits and how it's styled -- vision
    // never touches any of that, it only ever gets asked to re-read the raw
    // wording of the whole page as plain text. So this pass can correct what
    // a line SAYS, never where a block sits or how it looks; position, font,
    // color, bold/italic all still come entirely from local OCR's own word
    // boxes, exactly as they did before this pass existed.
    //
    // Gated three ways so it never fires needlessly or silently mis-maps a
    // correction to the wrong line:
    //   1. Only when the caller explicitly allowed it (Kadessa, after the
    //      person confirmed the action -- see pdfed_make_editable).
    //   2. Only when the page's overall local-OCR confidence actually came
    //      back uncertain -- a confident read has nothing for vision to
    //      improve, so we don't spend real money re-checking it.
    //   3. Only applied to a given line when vision reported the SAME
    //      number of lines, in the same order, as local OCR did. If vision
    //      merged/split a line differently, that 1-for-1 mapping can't be
    //      trusted, so nothing gets overridden at all rather than risk
    //      attaching the wrong correction to the wrong line.
    let visionCorrections = null; // Map<line, correctedText>
    if (opts.allowVision && typeof opts.visionFetcher === 'function' && lines.length) {
      const orderedLocal = lines.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const avgLineConf = orderedLocal.reduce((a, l) => a + (l.confidence || 0), 0) / orderedLocal.length;
      if (avgLineConf < PDFED_VISION_FALLBACK_MAX_CONF) {
        try {
          pdfedUpdateOcrProgress(0.98, 'Double-checking unclear text with AI vision…');
          const localText = orderedLocal.map(l => l.text.trim()).join('\n');
          const dataUrl = srcCanvas.toDataURL('image/jpeg', 0.85);
          const visionText = await opts.visionFetcher(dataUrl, localText);
          const visionArr = (visionText || '').split('\n').map(s => s.trim()).filter(Boolean);
          if (visionArr.length === orderedLocal.length) {
            visionCorrections = new Map();
            orderedLocal.forEach((l, i) => {
              if (visionArr[i] && visionArr[i] !== l.text.trim()) visionCorrections.set(l, visionArr[i]);
            });
          } else {
            console.warn('Kadessa vision accuracy pass: line count didn\'t match local OCR (' + visionArr.length + ' vs ' + orderedLocal.length + '), keeping local OCR text everywhere on this page.');
          }
        } catch (e) {
          console.warn('Kadessa vision accuracy pass failed, keeping local OCR text:', e);
        }
      }
    }
    let visionCorrectedCount = 0;
    // ------------------------------------------------------------------------

    lines.forEach(line => {
      // Tesseract groups a whole visual "line" together, including any nearby
      // graphic (icon badges, decorative glyphs) it happens to misread as a
      // stray character or two. Two things go wrong if we trust that raw line
      // as-is: (1) the misread garbage ends up baked into the extracted text,
      // and (2) — even after dropping the garbage word, the line's bounding
      // box still stretches from the real text on one side of the icon to the
      // real text on the other, so the opaque "cover" patch we paint underneath
      // the new text ends up erasing the icon graphic sitting in between.
      // Fix: keep only confident real words, then split them into separate
      // blocks wherever there's an unusually wide horizontal gap, that gap is
      // almost always a graphic, not normal word-spacing, so each block's
      // cover patch only ever touches the real text it belongs to.
      const words = (line.words || [])
        .filter(w => w.text && w.text.trim())
        // Real page content is essentially never JUST punctuation/symbols with
        // no letter or digit in it, tokens like "|", "]|=" are almost always
        // an OCR misread of a graphic edge (a ribbon fold, an icon outline),
        // not something a user would ever want to edit. Drop those outright.
        .filter(w => /[A-Za-z0-9]/.test(w.text.trim()))
        // Confidence floor: a real word can dip a little on a blurry scan, but a
        // misread icon/watermark glyph scores far lower still, the previous
        // version let ANY word over 4 characters through with no floor at all,
        // which is exactly how garbage like a stray product-label watermark
        // ("Jd001.Y") got extracted as if it were real page text. Now there's
        // always a minimum confidence, just a slightly lower one for longer words.
        .filter(w => w.confidence >= 55 || (w.confidence >= 35 && w.text.trim().length > 4))
        .sort((a, b) => a.bbox.x0 - b.bbox.x0);
      if (!words.length) return;

      // Sample each word's own ink color/height up front, sampling once per
      // merged line (the old approach) flattens multi-color headings like
      // "SMART HOUSE SOLAR" (where "SOLAR" is a different color) down to a
      // single color, silently losing the accent color.
      const wordMeta = words.map(w => {
        const wx = w.bbox.x0 / scale, wy = w.bbox.y0 / scale;
        const ww = Math.max(2, (w.bbox.x1 - w.bbox.x0) / scale);
        const wh = Math.max(2, (w.bbox.y1 - w.bbox.y0) / scale);
        const bg = teSampleBgColor(srcCtx, wx, wy, ww, wh);
        const color = teSampleTextColor(srcCtx, wx, wy, ww, wh, bg);
        return { w, bg, color, height: w.bbox.y1 - w.bbox.y0, wx, wy, ww, wh };
      });

      const avgH = wordMeta.reduce((a, m) => a + m.height, 0) / wordMeta.length;
      // Bold is estimated per-word but normalized against the whole line's
      // average height, not each word's own bbox height, a short lowercase
      // word with no ascenders/descenders (e.g. "am", "sun") has a small bbox
      // on its own, so normal-weight strokes were crossing the ratio threshold
      // just because the denominator was tiny. Using the line's average height
      // keeps the ratio stable regardless of which letters a given word has.
      wordMeta.forEach(m => {
        m.bold = teEstimateBold(srcCtx, m.wx, m.wy, m.ww, avgH, m.bg);
        m.italic = teEstimateItalic(srcCtx, m.wx, m.wy, m.ww, avgH, m.bg);
      });
      const clusters = [[wordMeta[0]]];
      for (let i = 1; i < wordMeta.length; i++) {
        const prev = wordMeta[i - 1], cur = wordMeta[i];
        const gap = cur.w.bbox.x0 - prev.w.bbox.x1;
        const bigGap = gap > avgH * 1.6; // likely a graphic sitting in the gap
        const sizeChanged = Math.abs(cur.height - prev.height) > avgH * 0.35; // different heading vs subtitle, etc.
        const colorChanged = !teColorsClose(cur.color, prev.color); // e.g. accent-colored word mid-heading
        const boldChanged = cur.bold !== prev.bold; // e.g. a bold label next to a regular-weight value
        const italicChanged = cur.italic !== prev.italic; // e.g. an italicized caption word mid-sentence
        if (bigGap || sizeChanged || colorChanged || boldChanged || italicChanged) clusters.push([cur]);
        else clusters[clusters.length - 1].push(cur);
      }

      clusters.forEach(cluster => {
        let text = cluster.map(m => m.w.text.trim()).join(' ');
        // Only substitute vision's corrected wording when this line produced
        // exactly ONE cluster -- a plain, uniformly-styled run of text with
        // no color/weight/size change and no wide gap splitting it into
        // separate blocks. If OCR split the line into several styled
        // pieces, vision's single merged string can't be mapped back to
        // which piece it belongs to, so every piece is left exactly as
        // local OCR read it instead of risking a corrupted split.
        if (visionCorrections && clusters.length === 1 && visionCorrections.has(line)) {
          text = visionCorrections.get(line);
          visionCorrectedCount++;
        }
        const x0 = Math.min(...cluster.map(m => m.w.bbox.x0));
        const y0 = Math.min(...cluster.map(m => m.w.bbox.y0));
        const x1 = Math.max(...cluster.map(m => m.w.bbox.x1));
        const y1 = Math.max(...cluster.map(m => m.w.bbox.y1));
        const x = x0 / scale, y = y0 / scale;
        const w = Math.max(4, (x1 - x0) / scale);
        const h = Math.max(6, (y1 - y0) / scale);
        const fontSize = Math.max(8, h * teClassifyLineVerticalExtent(text));
        // Reuse this cluster's own already-sampled color/bg/bold (first word)
        // rather than re-sampling across the merged box, which is what caused
        // the color flattening in the first place.
        const bgColor = cluster[0].bg;
        const color = cluster[0].color;
        const bold = cluster[0].bold;
        const italic = cluster[0].italic;
        const monospace = teDetectMonospace(srcCtx, x, y, w, h, bgColor);
        const fontFamily = monospace
          ? "'Courier New', Courier, monospace"
          : (bold ? 'Arial Black, Arial, Helvetica, Liberation Sans, sans-serif' : 'Arial, Helvetica, Liberation Sans, sans-serif');
        teAddBlock({
          text,
          x, y,
          fontSize,
          fontFamily,
          color,
          bold,
          italic,
          free: false,
          origWidth: w,
          origHeight: h,
          bgColor,
        }, overlay, true);
        blockCount++;
      });
    });

    if (blockCount) {
      teHideNoTextAlert();
      document.getElementById('teBlockCount').textContent = blockCount + ' line' + (blockCount !== 1 ? 's' : '') + ' found (OCR)';
      if (visionCorrectedCount) {
        toast('OCR text ready -- AI vision corrected ' + visionCorrectedCount + ' unclear line' + (visionCorrectedCount !== 1 ? 's' : '') + ', still worth a quick check on a blurry scan', 'info');
      } else {
        toast('OCR text ready, blurry scans can still misread a character here and there, so give it a check', 'info');
      }
    } else {
      teShowFreeOnly(overlay, 'We scanned this page with OCR but couldn\'t find any readable text on it, it may be blank, too blurry, or an image without real text. You can still type text directly onto the page.');
    }
  } catch (err) {
    console.warn('OCR extraction failed:', err);
    const msg = err && err.ocrEngineUnavailable
      ? 'The OCR engine couldn\'t start (this is usually a network issue, e.g. an ad-blocker or firewall blocking a required resource). Please check your connection and try again — you can still type text directly onto the page in the meantime.'
      : 'Something went wrong while reading this page. It may be blank, too blurry, or an image without real text. You can still type text directly onto the page.';
    teShowFreeOnly(overlay, msg);
  } finally {
    _teOcrProgressCb = null;
    pdfedHideOcrProgress();
  }
}

// ---- EXTRACT TEXT (plain copy/download, no editable overlay) --------------
// A separate, lighter path from the "OCR to edit" flow above: this reads a
// page's text — the real embedded PDF text layer when there is one (fast,
// exact character sequence, no recognition guesswork at all), our own
// upgraded OCR engine otherwise (scanned/photographed pages, or plain image
// pages) — and hands back clean plain text a person can copy or download.
// It never touches the page, places no overlay, and doesn't care whether the
// page is currently the one on screen, which is what makes whole-document
// extraction possible below.

// Reads one page's real PDF.js text content (when present) as reading-order
// plain text, grouping items onto lines by shared baseline and left-to-right
// x-position — the same geometry teMergeTextRuns uses for the editable path,
// just collapsed straight to lines of text instead of styled boxes.
async function pdfedExtractPdfLayerText(pg) {
  if (!(pg.type === 'pdf' && (pg.srcDoc || pdfed.pdfDoc))) return null;
  const pdfPage = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
  const textContent = await pdfPage.getTextContent();
  const items = (textContent.items || []).filter(it => it.str && it.str.trim());
  if (!items.length) return null;
  const viewport = pdfPage.getViewport({ scale: 1.0 });
  const rows = [];
  items.forEach(item => {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const y = tx[5];
    let row = rows.find(r => Math.abs(r.y - y) < 3);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x: tx[4], text: item.str });
  });
  rows.sort((a, b) => b.y - a.y); // PDF y-axis runs bottom-up; reading order is top-to-bottom
  const lines = rows
    .map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

// OCR fallback for pages with no real text layer, reads from the page's
// stored raster (pg.dataUrl via pdfedLoadPageImage — the same untainted-image
// approach the A4-resize pass uses) rather than the live on-screen canvas, so
// this works for ANY page in the document, not just the one currently open.
async function pdfedExtractOcrPlainText(pg, worker) {
  const img = await pdfedLoadPageImage(pg);
  if (!img) return '';
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  if (!canvas.width || !canvas.height) return '';
  canvas.getContext('2d').drawImage(img, 0, 0);

  const { canvas: ocrCanvas, scale } = pdfedPreprocessForOcr(canvas);
  const { data } = await worker.recognize(ocrCanvas);
  await pdfedRetryWeakLines(canvas, data.lines || [], scale, worker);

  return (data.lines || [])
    .filter(l => l.text && l.text.trim() && l.confidence >= 35)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)
    .map(l => l.text.trim())
    .join('\n');
}

async function pdfedExtractPlainTextForPage(pg, worker) {
  try {
    const layerText = await pdfedExtractPdfLayerText(pg);
    if (layerText) return layerText;
  } catch (err) {
    console.warn('Plain text extraction (PDF layer) failed, falling back to OCR:', err);
  }
  try {
    return await pdfedExtractOcrPlainText(pg, worker);
  } catch (err) {
    console.warn('Plain text extraction (OCR) failed:', err);
    return '';
  }
}
