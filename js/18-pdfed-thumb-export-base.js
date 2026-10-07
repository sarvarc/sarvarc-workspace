// ─── LIVE THUMBNAIL COMPOSITE ───
// Builds the left-nav thumbnail image for a single page, layering: baked PDF
// text edits (pdfedFlattenPageDataUrl) → placed images → placed text boxes →
// this page's own current annotation strokes (pen/highlighter/shapes/redact).
// Because every layer is read straight off pg.placedImages/placedTexts/
// annotStrokes (per-page data), the thumbnail can never show another page's
// edits, and always reflects this page's latest state as soon as it changes.
// Canvas fillText() never triggers @font-face loading on its own — it only
// picks up a webfont if that exact family/weight/style was already rendered
// as real DOM text somewhere first (the live editing box does this, which is
// why baked/thumbnail/export renders used to drift from what the editor
// showed: whichever bold/italic combo hadn't been used as real DOM text yet
// silently fell back to a system font at bake time. That fallback font's
// taller ascent/descent metrics overflow the fixed fontSize*1.25 line gap,
// which is exactly what made multi-line paragraphs look squished/overlapping
// only in the thumbnail and exported file, never in the live editor).
// Force-loads every family/weight/style/size combo a page's text boxes
// actually use, via the FontFace Loading API, before any baking touches
// them — so fillText always has the real glyphs ready and line spacing
// matches the editor exactly.
async function pdfedEnsureFontsLoaded(pg) {
  const list = (pg && pg.placedTexts) || [];
  if (!list.length || !document.fonts || !document.fonts.load) return;
  const seen = new Set();
  const jobs = [];
  list.forEach(item => {
    const famRaw = item.fontFamily || 'Inter';
    const fam = famRaw.includes(',') ? famRaw : `'${famRaw}'`;
    const size = item.fontSize || 14;
    [{ b: false, i: false }, { b: true, i: false }, { b: false, i: true }, { b: true, i: true }].forEach(({ b, i }) => {
      const style = i ? 'italic' : 'normal';
      const weight = b ? '700' : '400';
      const key = `${style} ${weight} ${size}px ${fam}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push(document.fonts.load(key).catch(() => {}));
    });
  });
  if (!jobs.length) return;
  try { await Promise.all(jobs); } catch (e) {}
}

async function pdfedComposeThumb(pg, idx) {
  const baseUrl = await pdfedFlattenPageDataUrl(pg);
  const hasPlaced = (pg.placedImages && pg.placedImages.length) || (pg.placedTexts && pg.placedTexts.length) || (pg.placedTables && pg.placedTables.length) || (pg.placedBorders && pg.placedBorders.length) || (pg.placedShapes && pg.placedShapes.length);
  const strokes = pg.annotStrokes;
  const hasAnnot = strokes && strokes.length > 0;
  if (!hasPlaced && !hasAnnot) return baseUrl;

  let baseImg;
  try {
    baseImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = baseUrl; });
  } catch(e) { return baseUrl; }

  const can = document.createElement('canvas');
  can.width = baseImg.naturalWidth;
  can.height = baseImg.naturalHeight;
  const ctx = can.getContext('2d');
  ctx.drawImage(baseImg, 0, 0);

  if (hasPlaced) {
    await pdfedEnsureFontsLoaded(pg);
    await pdfedDrawOrderedPlacedOnCtx(ctx, pg);
  }

  if (hasAnnot) {
    try {
      const annotImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = strokes[strokes.length - 1]; });
      ctx.drawImage(annotImg, 0, 0, can.width, can.height);
    } catch(e) { /* skip if snapshot failed to decode */ }
  }

  return can.toDataURL('image/png');
}

// How much sharper the final exported PDF raster is than the page's native
// on-screen editing resolution (96 DPI for blank/composed pages, 144 DPI for
// native PDF pages). The editor itself intentionally stays at that lower
// density — it's plenty for on-screen work and keeps everything fast — but
// baking straight from it into the exported PDF meant tables/text/images
// came out soft once printed or zoomed in. 3x brings a typical A4 page up to
// ~288 DPI (native PDF pages ~432 DPI), which reads as crisp, print-quality
// output without ballooning file size or export time the way a bigger jump
// would. Tables, placed text, placed images, shapes and borders are all
// redrawn fresh at this higher pixel density (not just stretched afterward),
// so this is real added sharpness, not an upscale of an already-soft image.
const PDFED_EXPORT_SUPERSAMPLE = 3;

// Same job as pdfedComposeThumb (flattens background + placed items +
// annotations into one raster) but renders everything at
// PDFED_EXPORT_SUPERSAMPLE× pixel density instead of the page's native
// editing resolution. Kept separate from pdfedComposeThumb, which stays at
// native resolution for on-screen thumbnails/previews where extra pixels
// would only cost time for zero visible benefit.
// Returns { url, iw, ih } where iw/ih are the page's ORIGINAL (non-
// supersampled) pixel dimensions — callers use those, not the supersampled
// canvas size, to compute the page's physical mm size, so the output image
// is denser but the printed page size doesn't change.
async function pdfedComposeThumbHiRes(pg, idx, ssFactor) {
  const ss = ssFactor || 1;
  const baseUrl = await pdfedFlattenPageDataUrl(pg);
  const hasPlaced = (pg.placedImages && pg.placedImages.length) || (pg.placedTexts && pg.placedTexts.length) || (pg.placedTables && pg.placedTables.length) || (pg.placedBorders && pg.placedBorders.length) || (pg.placedShapes && pg.placedShapes.length);
  const strokes = pg.annotStrokes;
  const hasAnnot = strokes && strokes.length > 0;

  let baseImg;
  try {
    baseImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = baseUrl; });
  } catch (e) { return { url: baseUrl, iw: 0, ih: 0 }; }
  const origW = baseImg.naturalWidth, origH = baseImg.naturalHeight;

  if (!hasPlaced && !hasAnnot) {
    // Nothing but the flat background raster — supersampling it would only
    // stretch pixels that are already there, no real detail to gain.
    return { url: baseUrl, iw: origW, ih: origH };
  }

  const can = document.createElement('canvas');
  can.width = Math.round(origW * ss);
  can.height = Math.round(origH * ss);
  const ctx = can.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(ss, ss);
  ctx.drawImage(baseImg, 0, 0);

  if (hasPlaced) {
    await pdfedEnsureFontsLoaded(pg);
    await pdfedDrawOrderedPlacedOnCtx(ctx, pg);
  }

  if (hasAnnot) {
    try {
      const annotImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = strokes[strokes.length - 1]; });
      ctx.drawImage(annotImg, 0, 0, origW, origH);
    } catch (e) { /* skip if snapshot failed to decode */ }
  }

  return { url: can.toDataURL('image/png'), iw: origW, ih: origH };
}

// ─── EDITABLE PDF EXPORT BASE ───────────────────────────────────────────
// Same idea as pdfedComposeThumb (bakes images/tables/annotations onto a flat
// raster of the page), EXCEPT placed text boxes are deliberately left out.
// Those get drawn back in a moment later as real jsPDF vector text
// (pdfedRenderPlacedTextsAsPdfText), so the words a person actually typed on
// the page come out of Export as genuine, selectable/editable PDF text
// instead of dead pixels — while the rest of the page stays a single flat
// layer, exactly like today's export.
async function pdfedComposeExportBase(pg, idx) {
  const baseUrl = await pdfedFlattenPageDataUrl(pg);
  const hasPlaced = (pg.placedImages && pg.placedImages.length) || (pg.placedTables && pg.placedTables.length) || (pg.placedBorders && pg.placedBorders.length) || (pg.placedShapes && pg.placedShapes.length);
  const strokes = pg.annotStrokes;
  const hasAnnot = strokes && strokes.length > 0;
  if (!hasPlaced && !hasAnnot) return baseUrl;

  let baseImg;
  try {
    baseImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = baseUrl; });
  } catch(e) { return baseUrl; }

  const can = document.createElement('canvas');
  can.width = baseImg.naturalWidth;
  can.height = baseImg.naturalHeight;
  const ctx = can.getContext('2d');
  ctx.drawImage(baseImg, 0, 0);

  if (hasPlaced) {
    await pdfedEnsureFontsLoaded(pg);
    await pdfedDrawOrderedPlacedOnCtx(ctx, pg, true); // true = skip text boxes
  }

  if (hasAnnot) {
    try {
      const annotImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = strokes[strokes.length - 1]; });
      ctx.drawImage(annotImg, 0, 0, can.width, can.height);
    } catch(e) { /* skip if snapshot failed to decode */ }
  }

  return can.toDataURL('image/png');
}

// Converts a page's pg.placedTexts into real jsPDF text() calls instead of
// baked pixels, so the exported PDF has genuinely selectable/editable/
// searchable text wherever the person typed one of these boxes. Mirrors the
// exact wrap/align/color logic of pdfedDrawPlacedTextsOnCtx (the on-screen
// canvas baker) so position matches what you saw in the editor, just made of
// real glyphs instead of pixels.
// wmm/hmm are the already-computed page size in mm (see pdfedExport) and iw
// is the raster's pixel width, used to get an exact px→mm scale factor
// (rather than assuming a fixed DPI) so text lines up with the image beneath it.
function pdfedRenderPlacedTextsAsPdfText(pdf, pg, wmm, iw) {
  const list = pg.placedTexts;
  if (!list || !list.length || !iw) return;
  const px2mm = wmm / iw;

  const measCan = document.createElement('canvas');
  const mctx = measCan.getContext('2d');

  list.forEach(item => {
    const weight = item.bold ? '700' : '400';
    const style = item.italic ? 'italic' : 'normal';
    const famRaw = item.fontFamily || 'Inter';
    const fam = famRaw.includes(',') ? famRaw : `'${famRaw}'`;
    mctx.font = `${style} ${weight} ${item.fontSize}px ${fam}, Inter, sans-serif`;
    mctx.textBaseline = 'top';
    const lineHeight = item.fontSize * 1.25;
    const padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
    const anchorX = item.x + padX;
    const fontCtx = { fontSize: item.fontSize, fam, itemBold: !!item.bold, itemItalic: !!item.italic };
    // Same measurement font a run actually gets drawn with below — keeps the
    // width used for wrap/align/underline in sync with the glyphs jsPDF prints.
    const setRunFont = (r) => { mctx.font = `${r.italic ? 'italic' : 'normal'} ${r.bold ? '700' : '400'} ${item.fontSize}px ${fam}, Inter, sans-serif`; };

    let lines = item.html
      ? pdfedParseRichLines(item.html)
      : (item.text || '').split('\n').map(t => [{ text: t, color: null, link: null }]);

    let maxWidth;
    if (item.w) {
      maxWidth = Math.max(10, item.w - padX * 2);
    } else {
      const pageWpx = iw;
      maxWidth = Math.max(10, (pageWpx ? (pageWpx - item.x - 12) : 99999) - padX * 2); // same border-box fix as pdfedDrawPlacedTextsOnCtx
    }
    const wrapped = [];
    lines.forEach(runs => wrapped.push(...pdfedWrapRichLine(mctx, runs, maxWidth, fontCtx)));
    lines = wrapped;

    let contentWidth = maxWidth;
    if (!item.w) {
      contentWidth = 0;
      lines.forEach(runs => {
        const w = runs.reduce((a, r) => { setRunFont(r); return a + mctx.measureText(r.text).width; }, 0);
        if (w > contentWidth) contentWidth = w;
      });
    }

    // Standard PDF fonts only (no custom font embedding), so pick the closest
    // built-in family/style pairing — this is what keeps the output a real,
    // universally-editable PDF text object rather than a font-embedding project.
    const pdfStyle = (item.bold && item.italic) ? 'bolditalic' : item.bold ? 'bold' : item.italic ? 'italic' : 'normal';
    try { pdf.setFont('helvetica', pdfStyle); } catch(e) { pdf.setFont('helvetica', 'normal'); }
    // px → pt using this PAGE's actual px→mm density (px2mm), not a fixed
    // 96dpi assumption. Native PDF pages rasterize at 144dpi while
    // blank/inserted pages rasterize at 96dpi (see pdfedExport), so a fixed
    // 0.75 factor made text ~1.5x too large on native PDF pages specifically.
    pdf.setFontSize(Math.max(4, item.fontSize * px2mm * 2.83464567)); // px → mm → pt

    let hasRunLink = false;
    lines.forEach((runs, li) => {
      const tyTopPx = item.y + padY + li * lineHeight;
      const widths = runs.map(r => { setRunFont(r); return mctx.measureText(r.text).width; });
      const totalWidth = widths.reduce((a, b) => a + b, 0);
      let startX = anchorX;
      if (item.align === 'center') startX = anchorX + (contentWidth - totalWidth) / 2;
      else if (item.align === 'right') startX = anchorX + (contentWidth - totalWidth);

      let cx = startX;
      runs.forEach((r, ri) => {
        if (r.text && r.text.trim()) {
          const runPdfStyle = (r.bold && r.italic) ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal';
          try { pdf.setFont('helvetica', runPdfStyle); } catch(e) { pdf.setFont('helvetica', 'normal'); }
          const rgb = pdfedHexToRgb(r.color || item.color || '#000000');
          pdf.setTextColor(rgb.r, rgb.g, rgb.b);
          pdf.text(r.text, cx * px2mm, tyTopPx * px2mm, { baseline: 'top' });
          if (item.underline || r.underline || r.link) {
            const uW = widths[ri] * px2mm;
            const uy = (tyTopPx + item.fontSize * 1.05) * px2mm;
            pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
            pdf.setLineWidth(Math.max(0.1, item.fontSize * 0.06 * px2mm));
            pdf.line(cx * px2mm, uy, cx * px2mm + uW, uy);
          }
          if (r.link) {
            hasRunLink = true;
            try { pdf.link(cx * px2mm, tyTopPx * px2mm, widths[ri] * px2mm, lineHeight * px2mm, { url: r.link }); } catch(e) {}
          }
        }
        cx += widths[ri];
      });
    });

    // Make it an actual clickable link in the exported PDF, not just blue
    // underlined text — covers the full box so the whole thing is tappable.
    // Skipped when the paragraph already has its own per-word links (from
    // "Apply to Selected"), so a stray whole-box link doesn't swallow clicks
    // meant for the surrounding, non-linked text.
    if (item.link && !hasRunLink) {
      try {
        const boxH = lines.length * lineHeight + padY * 2;
        pdf.link(item.x * px2mm, item.y * px2mm, (item.w || (contentWidth + padX * 2)) * px2mm, boxH * px2mm, { url: item.link });
      } catch(e) {}
    }
  });
}

// Registers invisible clickable regions for any linked placed-text boxes,
// WITHOUT drawing anything — the actual glyphs are already baked into the
// page's raster image (pdfedComposeThumb) for a pixel-exact match to the
// editor. This uses the identical wrap/align/padding math as
// pdfedRenderPlacedTextsAsPdfText so each clickable rectangle lines up
// exactly with the (already-baked) word or box it belongs to.
function pdfedAddPlacedTextLinkAnnotations(pdf, pg, wmm, iw) {
  const list = pg.placedTexts;
  if (!list || !list.length || !iw) return;
  const px2mm = wmm / iw;

  const measCan = document.createElement('canvas');
  const mctx = measCan.getContext('2d');

  list.forEach(item => {
    // Skip the measurement entirely for boxes with no link anywhere — most
    // placed-text boxes don't have one, so this keeps export fast.
    const hasAnyLink = item.link || (item.html && /<a[\s>]/i.test(item.html));
    if (!hasAnyLink) return;

    const famRaw = item.fontFamily || 'Inter';
    const fam = famRaw.includes(',') ? famRaw : `'${famRaw}'`;
    const lineHeight = item.fontSize * 1.25;
    const padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
    const anchorX = item.x + padX;
    const fontCtx = { fontSize: item.fontSize, fam, itemBold: !!item.bold, itemItalic: !!item.italic };
    const setRunFont = (r) => { mctx.font = `${r.italic ? 'italic' : 'normal'} ${r.bold ? '700' : '400'} ${item.fontSize}px ${fam}, Inter, sans-serif`; };

    let lines = item.html
      ? pdfedParseRichLines(item.html)
      : (item.text || '').split('\n').map(t => [{ text: t, color: null, link: null }]);

    let maxWidth;
    if (item.w) {
      maxWidth = Math.max(10, item.w - padX * 2);
    } else {
      const pageWpx = iw;
      maxWidth = Math.max(10, (pageWpx ? (pageWpx - item.x - 12) : 99999) - padX * 2); // same border-box fix as pdfedDrawPlacedTextsOnCtx
    }
    const wrapped = [];
    lines.forEach(runs => wrapped.push(...pdfedWrapRichLine(mctx, runs, maxWidth, fontCtx)));
    lines = wrapped;

    let contentWidth = maxWidth;
    if (!item.w) {
      contentWidth = 0;
      lines.forEach(runs => {
        const w = runs.reduce((a, r) => { setRunFont(r); return a + mctx.measureText(r.text).width; }, 0);
        if (w > contentWidth) contentWidth = w;
      });
    }

    let hasRunLink = false;
    lines.forEach((runs, li) => {
      const tyTopPx = item.y + padY + li * lineHeight;
      const widths = runs.map(r => { setRunFont(r); return mctx.measureText(r.text).width; });
      const totalWidth = widths.reduce((a, b) => a + b, 0);
      let startX = anchorX;
      if (item.align === 'center') startX = anchorX + (contentWidth - totalWidth) / 2;
      else if (item.align === 'right') startX = anchorX + (contentWidth - totalWidth);

      let cx = startX;
      runs.forEach((r, ri) => {
        if (r.text && r.text.trim() && r.link) {
          hasRunLink = true;
          try { pdf.link(cx * px2mm, tyTopPx * px2mm, widths[ri] * px2mm, lineHeight * px2mm, { url: r.link }); } catch(e) {}
        }
        cx += widths[ri];
      });
    });

    // Whole-box link (skipped when per-word links already cover it), same
    // "cover the full tappable box" behavior as the old vector-text path.
    if (item.link && !hasRunLink) {
      try {
        const boxH = lines.length * lineHeight + padY * 2;
        pdf.link(item.x * px2mm, item.y * px2mm, (item.w || (contentWidth + padX * 2)) * px2mm, boxH * px2mm, { url: item.link });
      } catch(e) {}
    }
  });
}


function pdfedHexToRgb(color) {
  if (!color) return { r: 0, g: 0, b: 0 };
  if (color.startsWith('rgb')) {
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 3) return { r: +m[0], g: +m[1], b: +m[2] };
  }
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// Refresh a single left-nav thumbnail in place (image + "Modified" badge) —
// used for live preview after an edit, without rebuilding/reflowing the whole
// strip the way a full pdfedBuildStrip() would.
async function pdfedRefreshThumb(idx) {
  const strip = document.getElementById('pdfedStrip');
  const pg = pdfed.pages[idx];
  if (!strip || !pg) return;
  const card = strip.querySelector('.pdfed-thumb[data-idx="' + idx + '"]');
  if (!card) return; // strip not built yet, nothing to update
  const img = card.querySelector('img');
  try {
    const url = await pdfedComposeThumb(pg, idx);
    if (img) {
      // Preload off-DOM first so the swap is a clean crossfade, never a
      // flash of a half-decoded or blank frame.
      await new Promise((res) => { const pre = new Image(); pre.onload = res; pre.onerror = res; pre.src = url; });
      img.style.opacity = '0';
      setTimeout(() => {
        img.src = url;
        requestAnimationFrame(() => { img.style.opacity = '1'; });
      }, 90);
    }
  } catch(e) { console.warn(e); }
  card.classList.remove('refreshing');
  try { if (pdfedPageHasLive(pg)) pdfedThumbLiveAttachSoon(card, img, pg); else pdfedThumbLiveDetach(card); } catch (e) { console.warn(e); }
  // Only drop the header "Live" tag once nothing else is mid-refresh.
  if (!Object.keys(_pdfedThumbRefreshTimers).some(k => _pdfedThumbRefreshTimers[k])) {
    const liveTag = document.getElementById('pdfedStripLive');
    if (liveTag) setTimeout(() => liveTag.classList.remove('on'), 250);
  }
  if (pg.modified && !card.querySelector('[data-badge="modified"]')) {
    const b = document.createElement('div');
    b.className = 'pdfed-thumb-badge';
    b.dataset.badge = 'modified';
    b.title = 'Modified';
    b.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    const delBtn = card.querySelector('.pdfed-thumb-del');
    if (delBtn) card.insertBefore(b, delBtn); else card.appendChild(b);
  }
}

// Ensure text overlay resets when navigating to a different page
const _origGoto = pdfedGoto;

// ─── TEXT EDITING END ──────────────────────────────────────────
