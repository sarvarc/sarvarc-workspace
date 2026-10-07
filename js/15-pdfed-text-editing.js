// ─── TEXT EDITING ─────────────────────────────────────────────

const teState = {
  active: false,
  blocks: [],       // [{el, origText, x, y, fontSize, fontFamily, color, bold, italic, free}]
  color: '#000000',
  sizeAdj: 0,
  focusedBlock: null,
  savedRange: null, // last non-collapsed selection inside a text block (survives focus loss to the color input)
};

document.addEventListener('selectionchange', () => {
  if (!teState.active) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const bd = teState.focusedBlock;
  if (bd && bd.el.contains(sel.anchorNode)) {
    teState.savedRange = sel.getRangeAt(0).cloneRange();
  }
});

function teRestoreSavedRange() {
  if (!teState.savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(teState.savedRange);
  return true;
}

function pdfedToggleTextEdit() {
  if (pdfed.active < 0) { toast('Open a PDF first', 'error'); return; }
  teState.active ? pdfedCancelTextEdit() : pdfedStartTextEdit();
}

// Reconstructs coherent words/phrases from pdf.js's raw text items, and detects
// bold weight from the PDF's own font names instead of leaving every block
// unbold-by-default.
//
// WHY THIS EXISTS, two bugs this fixes directly:
//
// 1) "Text gets cut off / a word splits apart when I touch it nearby text":
//    pdf.js very often reports a single visual word as SEVERAL separate text
//    items (kerning pairs, font-run boundaries, ligatures, etc). The old code
//    turned every raw item into its own independently-positioned editable box.
//    The instant ANY neighboring fragment was edited/resized/recolored, its box
//    changed size but the fragment next to it did not move, so a word like
//    "generated" visually split into "se-gen" / "erated" pieces, or two labels
//    ended up overlapping. This pass glues together items that sit on the same
//    baseline, in the same style, with only a small gap between them, so the
//    whole word/phrase becomes ONE block that always stays visually coherent.
//
// 2) "Bold text extracted doesn't stay bold in one environment":
//    the old code always set bold:false and relied 100% on the PDF's own
//    embedded font resolving as a usable CSS font wherever this page is later
//    viewed/exported. If that exact embedded font fails to resolve in some
//    browser/export path, the bold look silently disappears. PDF font names
//    reliably encode weight (e.g. "Arial-BoldMT", "Helvetica,Bold",
//    "ABCDEF+Roboto-Bold"), so we detect bold from that name directly and also
//    force font-weight:bold in CSS, that keeps text bold consistently instead
//    of only "sometimes."
function teMergeTextRuns(items, viewport, styleMap, srcCtx) {
  const scale = viewport.scale;
  const raw = [];
  items.forEach(item => {
    if (!item.str || !item.str.trim()) return;
    // Combine the glyph's own transform with the page's full viewport
    // transform (pdf.js's own recommended approach, same as its built-in text
    // layer), instead of doing `tx[4] * scale` / `viewport.height - tx[5] *
    // scale` by hand. The manual version only lands in the right spot for the
    // simple case of an unrotated page whose MediaBox starts at (0,0). Plenty
    // of real PDFs (letterhead templates, PDFs re-exported from Word/Canva,
    // anything with a non-zero MediaBox/CropBox origin or a rotated page)
    // don't meet that assumption, and the manual formula silently drops the
    // difference, every single run on the page then lands the same fixed
    // amount off from where it actually sits, which is exactly what produced
    // the "doubled, offset text" look: the new text box misses the real
    // glyphs underneath it instead of covering them.
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const x = tx[4];
    const y = tx[5]; // baseline, already in canvas pixel space
    const fontSize = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]);
    const styleInfo = styleMap[item.fontName] || {};
    const width  = Math.max(4, (item.width  || 0) * scale);
    const height = Math.max(fontSize * 1.15, (item.height || 0) * scale);
    const top = y - fontSize;
    const bgColor = teSampleBgColor(srcCtx, x, top, width, height);
    const color = teSampleTextColor(srcCtx, x, top, width, height, bgColor);
    const nameProbe = ((item.fontName || '') + ' ' + (styleInfo.fontFamily || '')).toLowerCase();
    const bold = /bold|black|heavy|semibold|semi-bold|extrabold|-700|-800|-900/.test(nameProbe);
    // Two independent signals, either one is enough:
    // 1) The font's own name/family usually says so directly for a real italic
    //    variant (embedded subset fonts are commonly named like
    //    "ArialMT-Italic" / "TimesNewRomanPS-ItalicMT" / "...-Oblique").
    // 2) Some PDFs fake italics by skewing an upright font's glyph matrix
    //    instead of switching to a real italic font variant, that has no
    //    "italic" anywhere in its name, but shows up as a shear (the glyph's
    //    own transform, before the page/viewport transform is applied) — the
    //    x this glyph moves per unit of y it's drawn (item.transform[2] vs
    //    [3]) is ~0 for upright text and a consistent nonzero ratio for a
    //    deliberately slanted one.
    const nameItalic = /italic|oblique|\bital\b|-it\b/.test(nameProbe);
    const gt = item.transform || [1, 0, 0, 1, 0, 0];
    const shearRatio = gt[3] ? Math.abs(gt[2] / gt[3]) : 0;
    const shearItalic = shearRatio > 0.12; // ~7°+ slant
    const italic = nameItalic || shearItalic;
    const fontFamily = [item.fontName, styleInfo.fontFamily, bold ? 'Arial Black, Arial, Helvetica, Liberation Sans, sans-serif' : 'Arial, Helvetica, Liberation Sans, sans-serif'].filter(Boolean).join(', ');
    raw.push({ text: item.str, x, y: top, width, height, fontSize, fontFamily, color, bgColor, bold, italic });
  });

  // Merge pass: glue adjacent same-line, same-style fragments back into whole words/phrases.
  const merged = [];
  raw.forEach(r => {
    const last = merged[merged.length - 1];
    if (last) {
      const sameLine  = Math.abs(r.y - last.y) < Math.max(2, last.fontSize * 0.3);
      const sameSize  = Math.abs(r.fontSize - last.fontSize) < Math.max(1, last.fontSize * 0.15);
      const sameStyle = r.color === last.color && r.bold === last.bold && r.italic === last.italic;
      const gap = r.x - (last.x + last.width);
      const closeEnough = gap < last.fontSize * 0.65;
      if (sameLine && sameSize && sameStyle && closeEnough) {
        const needsSpace = gap > last.fontSize * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(r.text);
        last.text  += (needsSpace ? ' ' : '') + r.text;
        last.width  = Math.max(last.width, (r.x + r.width) - last.x);
        last.height = Math.max(last.height, r.height);
        return;
      }
    }
    merged.push(Object.assign({}, r));
  });

  // Dedupe pass: some PDF exporters (report/table generators) draw the same
  // label or value twice at almost the same spot, producing "ghost" doubled
  // text once one copy is edited and the other still shows through.
  const deduped = [];
  merged.forEach(r => {
    const rText = r.text.trim().toLowerCase();
    const isDup = deduped.some(o => {
      if (o.text.trim().toLowerCase() !== rText) return false;
      const overlapX = Math.max(0, Math.min(o.x + o.width,  r.x + r.width)  - Math.max(o.x, r.x));
      const overlapY = Math.max(0, Math.min(o.y + o.height, r.y + r.height) - Math.max(o.y, r.y));
      const overlapArea = overlapX * overlapY;
      const minArea = Math.min(o.width * o.height, r.width * r.height) || 1;
      if ((overlapArea / minArea) > 0.6) return true;
      // Catch the case the overlap test above misses: the exact same run of
      // text drawn again a little further down (or up) the page — offset by
      // close to a full line height, so the two boxes barely touch or don't
      // overlap at all, yet it's unmistakably the same duplicated line, not
      // two different lines that happen to share wording. Same text, roughly
      // the same horizontal position, and vertically within about one line's
      // height of each other is the same "twin duplicate" pattern, just past
      // the point where the boxes themselves still overlap.
      const xOverlaps = r.x < o.x + o.width && o.x < r.x + r.width;
      const avgH = (o.height + r.height) / 2;
      const closeY = Math.abs(r.y - o.y) < avgH * 1.5;
      return xOverlaps && closeY;
    });
    if (!isDup) deduped.push(r);
  });

  return deduped;
}

// Sets the text overlay's zoom transform AND a matching --pdfed-inv-zoom
// custom property (inherited by every text block/handle inside it). Handle
// CSS uses that variable to counter-scale its own size and outward offset,
// so the little move/resize/width handles always render at the same actual
// on-screen size and the same visual gap off the box no matter how zoomed in
// or out the canvas is. Without this, a handle sized/offset for 100% zoom
// either shrank into the box (low zoom) or ballooned over the text (high
// zoom) — which is what was covering up letters like the "&" in "& OPERATED".
function teSetOverlayZoom(overlay, z) {
  overlay.style.transform = `scale(${z})`;
  overlay.style.setProperty('--pdfed-inv-zoom', (1 / (z || 1)).toFixed(4));
}

async function pdfedStartTextEdit(opts) {
  // opts.allowVision + opts.visionFetcher: only ever passed by Kadessa's
  // pdfed_make_editable action (see KADESSA_ACTIONS below) -- the manual "Edit
  // Text" button never sets these, so nothing changes for a person clicking
  // it themselves. See pdfedOcrExtract's own comment for what these do.
  opts = opts || {};
  // turn off crop if on
  pdfedCropOff();
  teState.active = true;
  teState.blocks = [];
  teState.focusedBlock = null;
  pdfedSyncCompareBtnVisibility();

  document.getElementById('pdfedTextBtn').classList.add('active');
  document.getElementById('pdfedApplyTextBtn').style.display = '';
  document.getElementById('pdfedCancelTextBtn').style.display = '';
  document.getElementById('pdfedTextPanel').style.display = '';
  document.getElementById('pdfedAdjustPanel').style.display = 'none';

  const overlay = document.getElementById('pdfedTextOverlay');
  overlay.innerHTML = '';
  overlay.classList.add('active');
  teHideNoTextAlert();

  const canvas = document.getElementById('pdfedPageCanvas');
  const pg = pdfed.pages[pdfed.active];
  // Native PDF pages render onto the canvas at 144dpi while the on-screen zoom
  // baseline is 96dpi (PDFED_PX_PER_MM) — pdfedApplyZoom() corrects for this
  // density mismatch when sizing the canvas itself, but this overlay setup was
  // scaling purely by pdfed.zoom with no density correction. That's what made
  // OCR/text boxes render ~1.5x too big and drift further off their real
  // position the farther they sat from the top-left corner.
  const pdfedTeZoomNormalize = PDFED_PX_PER_MM / ((pg && pg._pxPerMm) || PDFED_PX_PER_MM);
  const z = pdfed.zoom * pdfedTeZoomNormalize;
  overlay.style.width  = canvas.width  + 'px';
  overlay.style.height = canvas.height + 'px';
  teSetOverlayZoom(overlay, z);

  // If this page already has saved text blocks (from a previous edit session),
  // restore those instead of re-extracting, this is what lets the user come
  // back and keep editing, dragging, locking, etc. at any time.
  if (pg.textBlocks && pg.textBlocks.length) {
    pg.textBlocks.forEach(tb => teAddBlock(tb, overlay, true));
    document.getElementById('teBlockCount').textContent = pg.textBlocks.length + ' block' + (pg.textBlocks.length !== 1 ? 's' : '') + ' · tap to re-edit';
    toast('Click any text to edit, Shift+drag to move', 'info');
    return;
  }

  // Only PDF-type pages have text content from PDF.js
  if (pg.type === 'pdf' && (pg.srcDoc || pdfed.pdfDoc)) {
    try {
      const pdfPage = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
      const viewport = pdfPage.getViewport({ scale: 2.0 }); // same scale as render
      const textContent = await pdfPage.getTextContent();

      // Grab the already-rendered page canvas so we can sample the true local
      // background color behind each run of text (handles colored letterheads,
      // shaded boxes, etc. — not just plain white pages).
      const srcCanvas = document.getElementById('pdfedPageCanvas');
      const srcCtx = (srcCanvas && srcCanvas.width) ? srcCanvas.getContext('2d') : null;

      const styleMap = textContent.styles || {};
      const runs = teMergeTextRuns(textContent.items, viewport, styleMap, srcCtx);
      let blockCount = 0;
      runs.forEach(r => {
        teAddBlock({
          text: r.text,
          x: r.x, y: r.y, // top-left of text
          fontSize: r.fontSize,
          fontFamily: r.fontFamily,
          color: r.color,
          bold: r.bold,
          italic: r.italic,
          free: false,
          origWidth: r.width,
          origHeight: r.height,
          bgColor: r.bgColor,
        }, overlay, true);
        blockCount++;
      });

      if (blockCount) {
        teHideNoTextAlert();
        document.getElementById('teBlockCount').textContent = blockCount + ' block' + (blockCount !== 1 ? 's' : '') + ' found';
        toast('Click any text on the page to edit it', 'info');
      } else {
        // pdf.js found zero text items, this is a scanned/photographed/blurry
        // PDF page (or a re-uploaded export that flattened everything into an
        // image) with no real text layer at all. OCR is the only way to make
        // it editable, so fall back to it instead of giving up.
        await pdfedOcrExtract(overlay, opts);
      }
    } catch (err) {
      console.warn('Text extraction failed:', err);
      await pdfedOcrExtract(overlay, opts);
    }
  } else {
    // Image-type pages (photos/scans dropped straight in) never had a PDF text
    // layer to begin with, OCR is the only path to editable text for them too.
    await pdfedOcrExtract(overlay, opts);
  }
}

function teHideNoTextAlert() {
  const box = document.getElementById('teNoTextAlert');
  if (box) box.style.display = 'none';
}

function teShowNoTextAlert(message) {
  const box = document.getElementById('teNoTextAlert');
  const msgEl = document.getElementById('teNoTextAlertMsg');
  if (msgEl) msgEl.textContent = message || 'This page has no text we can extract.';
  if (box) box.style.display = '';
}

function teShowFreeOnly(overlay, reason) {
  document.getElementById('teBlockCount').textContent = 'No extractable text found';
  teShowNoTextAlert(reason || 'This page has no text we can extract, it looks like a scan or image with nothing readable on it. You can still type text directly onto the page.');
  toast('ℹ️ No extractable text, use "+ Add text" to place text on the page', 'info');
}
