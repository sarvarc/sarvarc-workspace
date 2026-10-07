// ─── GET PAGE DATA URL ───
async function pdfedPageUrl(pg) {
  if (pg.dataUrl) return pg.dataUrl;
  if (pg.type === 'pdf') {
    const scale = 2.0;
    const page = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
    const vp = page.getViewport({scale});
    const can = document.createElement('canvas');
    can.width = vp.width; can.height = vp.height;
    await page.render({canvasContext: can.getContext('2d'), viewport: vp}).promise;
    pg.dataUrl = can.toDataURL('image/png');
    // Record the true px/mm density this page's raster was rendered at
    // (PDF points are 72/inch, so scale 2.0 here == 144 DPI, NOT the 96 DPI
    // that pdfedRenderBlankPage's inserted/table/data pages use). Export
    // must read this back per-page instead of assuming one fixed DPI for
    // every page, or native PDF pages come out ~1.5x too large next to
    // blank/inserted pages in the same document.
    pg._pxPerMm = (scale * 72) / 25.4;
  }
  return pg.dataUrl;
}
// Stable, never-repatched reference to the real base-image getter. Anything that
// needs the raw page bitmap (not whatever pdfedPageUrl has been temporarily
// monkey-patched to do, e.g. during export) should call this instead, to avoid
// accidental infinite recursion if pdfedPageUrl ever wraps itself indirectly.
const pdfedPageUrlBase = pdfedPageUrl;

// ─── BUILD STRIP ───
// ─── LIVE CLIPS IN THE THUMBNAIL STRIP ───
// A page holding a live clip (made in Showcase) plays on the canvas. Its thumbnail used to be
// a flat picture (clip frozen on its poster). Now the thumbnail gets a small running canvas layered
// over that picture: the page is re-composed per frame with each clip drawn at the current time,
// at the right depth between the other items. Only thumbnails on screen draw, at a capped frame rate.
const pdfedThumbLive = { set: new Set(), raf: 0, io: null, tok: 0 };
function pdfedThumbLiveDetach(card) {
  if (!card) return;
  card._liveTok = ++pdfedThumbLive.tok;
  clearTimeout(card._liveAttachT);
  const old = card._liveEnt;
  if (old) {
    pdfedThumbLive.set.delete(old);
    if (pdfedThumbLive.io) { try { pdfedThumbLive.io.unobserve(old.canvas); } catch (e) {} }
    if (old.canvas.parentNode) old.canvas.parentNode.removeChild(old.canvas);
    card._liveEnt = null;
  }
}
async function pdfedThumbLiveAttach(card, imgEl, pg) {
  if (!card || !pg) return;
  pdfedThumbLiveDetach(card);
  const tok = card._liveTok;
  let built;
  try { built = await pdfedBuildLivePage(pg, 300, 460); } catch (e) { console.warn('Live thumbnail failed', e); return; }
  // The strip may have been rebuilt or the page edited again while this was composing.
  if (!built || card._liveTok !== tok || !card.isConnected) return;
  const cv = built.canvas;
  cv.className = 'pdfed-thumb-live';
  cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border-radius:6px;pointer-events:none;display:block;';
  card.insertBefore(cv, imgEl && imgEl.nextSibling);
  const firstClip = (pg.placedImages || []).filter(it => it && it.clip)[0];
  const ent = { canvas: cv, update: built.update, clip: firstClip ? firstClip.clip : null, t0: performance.now(), last: 0, vis: true };
  card._liveEnt = ent;
  pdfedThumbLive.set.add(ent);
  if ('IntersectionObserver' in window) {
    if (!pdfedThumbLive.io) pdfedThumbLive.io = new IntersectionObserver(list => {
      list.forEach(r => { const e = r.target._thumbLiveEnt; if (e) e.vis = r.isIntersecting; });
    }, { rootMargin: '60px' });
    cv._thumbLiveEnt = ent;
    pdfedThumbLive.io.observe(cv);
  }
  if (!pdfedThumbLive.raf) pdfedThumbLive.raf = requestAnimationFrame(pdfedThumbLiveTick);
}
// Rebuilding a live thumbnail re-composes the whole page (heavy on big custom-size pages), so after an edit
// the stale overlay goes away now and the rebuild waits until the person has stopped editing for a moment.
function pdfedThumbLiveAttachSoon(card, imgEl, pg) {
  pdfedThumbLiveDetach(card);
  const attempt = () => {
    if (!card.isConnected) return;
    if (typeof sppLiveIsBusy === 'function' && sppLiveIsBusy()) { card._liveAttachT = setTimeout(attempt, 500); return; }
    pdfedThumbLiveAttach(card, imgEl, pg);
  };
  card._liveAttachT = setTimeout(attempt, 900);
}
// True when this thumbnail should hold its frame: person is editing, or its clip / all clips are paused.
function pdfedThumbLiveResting(e) {
  if (typeof sppLiveIsBusy !== 'function') return false;
  return sppLiveIsBusy() || sppLiveAllPaused() || !!(e.clip && sppLiveIsPaused(e.clip));
}
function pdfedThumbLiveTick() {
  pdfedThumbLive.raf = 0;
  const now = performance.now();
  pdfedThumbLive.set.forEach(e => {
    if (!e.canvas.isConnected) { pdfedThumbLive.set.delete(e); return; }   // strip was rebuilt
    if (document.hidden || !e.vis) return;
    if (pdfedThumbLiveResting(e)) return;
    if (now - e.last < 125) return;                                          // ~8 fps is plenty at thumbnail size
    e.last = now;
    // Use the same clock as the clip on the canvas when it is open there, so both play in step.
    let t = null;
    if (e.clip && typeof sppLiveTime === 'function') t = sppLiveTime(e.clip);
    if (t == null) t = (now - e.t0) / 1000;
    try { e.update(t, true); } catch (err) { console.error('Live thumbnail frame failed', err); pdfedThumbLive.set.delete(e); }
  });
  if (pdfedThumbLive.set.size) pdfedThumbLive.raf = requestAnimationFrame(pdfedThumbLiveTick);
}

async function pdfedBuildStrip() {
  pdfedPersist();
  const strip = document.getElementById('pdfedStrip');
  if (!strip) return;
  strip.innerHTML = '';
  document.getElementById('pdfedPageCount').textContent = '(' + pdfed.pages.length + ')';
  document.getElementById('prrTotalPages').textContent = pdfed.pages.length;

  for (let i = 0; i < pdfed.pages.length; i++) {
    // insert zone before each page
    strip.appendChild(pdfedMakeInsertZone(i - 1));

    const pg = pdfed.pages[i];
    const card = document.createElement('div');
    card.className = 'pdfed-thumb' + (i === pdfed.active ? ' active' : '');
    card.style.cssText = 'margin:4px 0;animation-delay:' + Math.min(i * 22, 260) + 'ms;';
    card.dataset.idx = i;
    card.onclick = () => pdfedGoto(i);
    // drag-to-reorder
    card.draggable = true;
    card.ondragstart = (ev) => pdfedDragStart(ev, i);
    card.ondragend = (ev) => pdfedDragEnd(ev);
    card.ondragover = (ev) => pdfedDragOver(ev, i);
    card.ondrop = (ev) => pdfedDrop(ev, i);

    // image
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;display:block;border-radius:5px;min-height:60px;background:var(--bg3);pointer-events:none;';
    card.appendChild(img);
    // lazy load
    (async (pgRef, imgEl, i) => {
      try {
        const url = await pdfedComposeThumb(pgRef, i);
        imgEl.src = url;
        if (pdfedPageHasLive(pgRef)) pdfedThumbLiveAttach(card, imgEl, pgRef);
      } catch(err) { console.warn(err); }
    })(pg, img, i);

    // page number
    const num = document.createElement('div');
    num.className = 'pdfed-thumb-num';
    num.textContent = i + 1;
    card.appendChild(num);

    // badges
    if (pg.modified) {
      const b = document.createElement('div');
      b.className = 'pdfed-thumb-badge';
      b.dataset.badge = 'modified';
      b.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'; b.title = 'Modified';
      card.appendChild(b);
    }
    if (pg.type !== 'pdf') {
      const b = document.createElement('div');
      b.className = 'pdfed-thumb-badge';
      b.style.background = 'var(--purple)';
      b.innerHTML = pg.type === 'blank'
        ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      card.appendChild(b);
    }

    // delete btn
    const del = document.createElement('button');
    del.className = 'pdfed-thumb-del';
    del.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.title = 'Remove page';
    del.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePage(i); };
    card.appendChild(del);

    // Manual whitespace-fill (pull next page up / push bottom item down)
    // now lives as two direct buttons beside SARVARC Eye, above the canvas
    // — one click on whichever page is open, instead of hovering a
    // specific thumbnail here first to reach a popover menu.

    { const _fx = pdfedAnimGet(pg);
      if (_fx && _fx.type !== 'none' && i < pdfed.pages.length - 1) {
        const bdg = document.createElement('div'); bdg.className = 'pdfed-thumb-anim';
        bdg.textContent = '\u25B6 ' + pdfedAnimTitle(_fx); bdg.title = 'Transition to next page';
        card.appendChild(bdg);
      } }
    strip.appendChild(card);
  }
  // final insert zone after last page
  strip.appendChild(pdfedMakeInsertZone(pdfed.pages.length - 1));
  pdfedRefreshEditCount();
}

function pdfedMakeInsertZone(afterIdx) {
  const z = document.createElement('div');
  z.className = 'pdfed-insert-zone';
  const l1 = document.createElement('div'); l1.className = 'pdfed-insert-line';
  const chip = document.createElement('div'); chip.className = 'pdfed-insert-chip';
  const btn = document.createElement('button'); btn.className = 'pdfed-insert-btn';
  btn.textContent = '+';
  const posLabel = afterIdx < 0 ? 'at start' : 'after page ' + (afterIdx + 1);
  btn.title = 'Insert new page ' + posLabel;
  btn.onclick = (ev) => { ev.stopPropagation(); pdfedOpenInsert(afterIdx); };
  const lbl = document.createElement('div'); lbl.className = 'pdfed-insert-label';
  lbl.textContent = 'Insert ' + posLabel;
  chip.appendChild(btn);
  if (afterIdx >= 0 && afterIdx < pdfed.pages.length - 1) chip.appendChild(pdfedMakeAnimBtn(afterIdx));
  chip.appendChild(lbl);
  const l2 = document.createElement('div'); l2.className = 'pdfed-insert-line';
  z.appendChild(l1); z.appendChild(chip); z.appendChild(l2);
  // clicking the zone itself (not the button) also opens modal
  z.onclick = (ev) => { if (ev.target === z) pdfedOpenInsert(afterIdx); };
  return z;
}

// ─── DRAG-TO-REORDER ───
let _dragSrcIdx = null;
function pdfedDragStart(e, idx) {
  _dragSrcIdx = idx;
  dragState.pageIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'page:' + idx); // fallback for drops onto the canvas
  setTimeout(() => e.target.classList.add('dragging'), 0);
}
function pdfedDragEnd(e) {
  e.target.classList.remove('dragging');
  dragState.pageIdx = null;
  document.querySelectorAll('#pdfedStrip .pdfed-thumb').forEach(el => {
    el.classList.remove('drag-over-top','drag-over-bot');
  });
}
function pdfedDragOver(e, idx) {
  if (_dragSrcIdx === null || _dragSrcIdx === idx) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#pdfedStrip .pdfed-thumb').forEach(el => el.classList.remove('drag-over-top','drag-over-bot'));
  const target = e.currentTarget;
  const rect = target.getBoundingClientRect();
  const isTop = (e.clientY - rect.top) < rect.height / 2;
  target.classList.add(isTop ? 'drag-over-top' : 'drag-over-bot');
}
async function pdfedDrop(e, idx) {
  e.preventDefault();
  document.querySelectorAll('#pdfedStrip .pdfed-thumb').forEach(el => el.classList.remove('drag-over-top','drag-over-bot'));
  if (_dragSrcIdx === null || _dragSrcIdx === idx) { _dragSrcIdx = null; return; }
  const src = _dragSrcIdx;
  _dragSrcIdx = null;
  const target = e.currentTarget;
  const rect = target.getBoundingClientRect();
  const isTop = (e.clientY - rect.top) < rect.height / 2;
  let dest = isTop ? idx : idx + 1;
  if (src < dest) dest--;
  const [moved] = pdfed.pages.splice(src, 1);
  pdfed.pages.splice(dest, 0, moved);
  if (pdfed.active === src) pdfed.active = dest;
  else if (pdfed.active > src && pdfed.active <= dest) pdfed.active--;
  else if (pdfed.active < src && pdfed.active >= dest) pdfed.active++;
  await pdfedBuildStrip();
  await pdfedGoto(pdfed.active);
  toast('↕ Page moved to position ' + (dest + 1), 'info');
}

// ─── NAVIGATE TO PAGE ───
async function pdfedGoto(idx) {
  if (idx < 0 || idx >= pdfed.pages.length) return;
  // cancel text edit when navigating away
  if (teState.active) pdfedCancelTextEdit();
  if (typeof pdfedCloseOpacityPopover === 'function') pdfedCloseOpacityPopover();
  // An un-applied canvas-tint preview is only a CSS overlay for the page you
  // were just looking at — hide it when actually switching to a DIFFERENT
  // page so it can't visually leak there. pdfedGoto is also called to
  // re-render the SAME page for reasons that aren't real navigation (e.g.
  // toggleTheme re-rendering for new CSS vars) — those must leave a pending,
  // not-yet-"Applied" gradient/tint preview exactly as the person left it,
  // instead of silently wiping it back to a blank/white canvas.
  const pdfedGotoIsPageChange = pdfed.active !== idx;
  if (pdfedGotoIsPageChange && typeof pdfedCanvasTintPreviewEl === 'function') {
    const tintPreview = pdfedCanvasTintPreviewEl();
    if (tintPreview) tintPreview.style.display = 'none';
  }
  pdfed.active = idx;
  pdfedCropOff();

  const pg = pdfed.pages[idx];
  let url;
  try { url = await pdfedPageUrl(pg); } catch(e) { toast('Could not render page','error'); return; }

  const canvas = document.getElementById('pdfedPageCanvas');
  const ctx = canvas.getContext('2d');
  const imgObj = new Image();
  await new Promise((res, rej) => {
    imgObj.onload = res;
    imgObj.onerror = rej;
    imgObj.src = url;
  });
  canvas.width = imgObj.naturalWidth;
  canvas.height = imgObj.naturalHeight;
  const f = pg.edits.filters || {bright:100, contrast:100, sat:100};
  ctx.filter = `brightness(${f.bright}%) contrast(${f.contrast}%) saturate(${f.sat}%)`;
  ctx.drawImage(imgObj, 0, 0);
  ctx.filter = 'none';
  pdfedApplyZoom();
  // Show this page's saved text blocks as a read-only layer on the canvas —
  // they stay visible without needing to re-open the Text Editor, and clicking
  // "Edit Text" will make them live/draggable/lockable again.
  pdfedRenderTextLayer(pg, false);
  pdfedSearchSyncOverlaySize();
  pdfedSearchRenderHighlights();
  pdfedRenderAllPlaced(idx); // rebuilds every placed-object layer (borders/shapes/images/texts/tables) fresh for THIS page; also syncs the grid-snap overlay to this page's canvas size
  teFafRefreshPreview(); // re-crawl/highlight for whatever's still typed in Style Specific Text, this page has different geometry

  // update strip highlight
  document.querySelectorAll('#pdfedStrip .pdfed-thumb').forEach((el, i) => {
    el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
  });

  document.getElementById('prrPageNum').textContent = idx + 1;
  document.getElementById('pdfedPageLabel').textContent = 'Page ' + (idx + 1) + ' of ' + pdfed.pages.length;

  // sync filter sliders
  document.getElementById('prrBright').textContent = f.bright;
  document.getElementById('prrContrast').textContent = f.contrast;
  document.getElementById('prrSat').textContent = f.sat;
  const sliders = document.querySelectorAll('#pdfedAdjustPanel input[type=range]');
  if (sliders[0]) sliders[0].value = f.bright;
  if (sliders[1]) sliders[1].value = f.contrast;
  if (sliders[2]) sliders[2].value = f.sat;

  pdfedRefreshEditCount();
  pdfedUpdatePageActions();
}

// Shows/hides the Duplicate Page / Delete Page toolbar (top-right, above the
// canvas). Delete is now always enabled, even on the last remaining page.
function pdfedUpdatePageActions() {
  const bar = document.getElementById('pdfedPageActions');
  if (!bar) return;
  bar.classList.toggle('show', pdfed.active >= 0 && !!pdfed.pages[pdfed.active]);
  const delBtn = document.getElementById('pdfedPgactDel');
  if (delBtn) delBtn.disabled = false;

  // Pull-up / push-down — moved here beside SARVARC Eye (was previously
  // buried in a per-thumbnail popover menu in the left pages panel) so the
  // two actions are one click away on whichever page is actually open,
  // instead of needing to hover a specific thumbnail first.
  const pullBtn = document.getElementById('pdfedPgactPullUp');
  const pushBtn = document.getElementById('pdfedPgactPushDown');
  const flowDivider = document.getElementById('pdfedPgactRefineDivider');
  const pg = pdfed.pages[pdfed.active];

  // Stay hidden until Refine Report has actually been run once on this
  // document — before that, showing manual "pull up / push down" arrows
  // beside SARVARC Eye implies a capability the person hasn't unlocked yet.
  const showFlowArrows = !!pdfed.refineReportUsed;
  if (pullBtn) pullBtn.style.display = showFlowArrows ? '' : 'none';
  if (pushBtn) pushBtn.style.display = showFlowArrows ? '' : 'none';
  if (flowDivider) flowDivider.style.display = showFlowArrows ? '' : 'none';

  // Disabled when there's no page above to push into (was: no page below
  // to pull from — the button now pushes THIS page's content up, not
  // pulls the next page's content in).
  if (pullBtn) pullBtn.disabled = !pg || pdfed.active <= 0;
  if (pushBtn) {
    const flowCount = pg ? (
      (pg.placedTables || []).length +
      (pg.placedTexts || []).length +
      (pg.placedImages || []).filter(im => !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark && !pdfedIsAnchorImage(im, pg.width || 600, pg.height || 800)).length
    ) : 0;
    pushBtn.disabled = flowCount < 2;
  }
  pdfedSyncCompareBtnVisibility();
}

function pdfedRefreshEditCount() {
  const n = pdfed.pages.filter(p => p.modified || p.type !== 'pdf').length;
  const el = document.getElementById('prrEdits');
  if (el) el.textContent = n + ' page' + (n !== 1 ? 's' : '') + ' modified';
}

// ─── ZOOM ───
let _zoomBadgeTimer = null;
function pdfedApplyZoom() {
  const canvas  = document.getElementById('pdfedPageCanvas');
  const wrap    = document.getElementById('pdfedCanvasWrap');
  const overlay = document.getElementById('pdfedTextOverlay');
  // Drive display size via CSS, canvas pixel data stays intact.
  // canvas.width/height are the page's RAW pixel dimensions, which differ by
  // source: native blank/table pages render at 96 DPI (3.7795 px/mm), native
  // PDF pages at 144 DPI, and pages pushed from Make Forms at ~192 DPI
  // (html2canvas scale:2). Scaling straight off canvas.width means two pages
  // that are both physically A4 show up at different on-screen sizes at the
  // same zoom % (a Make Forms page rendering ~2x bigger than a typed page).
  // Normalize through each page's own recorded density (pg._pxPerMm, same
  // field pdfedExport already reads) against the shared on-screen baseline
  // (PDFED_PX_PER_MM) so 100% zoom always means the same physical size.
  const pdfedZoomPg = pdfed.pages && pdfed.pages[pdfed.active];
  const pdfedZoomDensity = (pdfedZoomPg && pdfedZoomPg._pxPerMm) || PDFED_PX_PER_MM;
  const pdfedZoomNormalize = PDFED_PX_PER_MM / pdfedZoomDensity;
  const displayW = Math.round(canvas.width  * pdfedZoomNormalize * pdfed.zoom);
  const displayH = Math.round(canvas.height * pdfedZoomNormalize * pdfed.zoom);
  canvas.style.width  = displayW + 'px';
  canvas.style.height = displayH + 'px';
  wrap.style.width    = displayW + 'px';
  wrap.style.height   = displayH + 'px';
  // Scale text overlay identically. Its un-transformed box must stay pinned
  // to the canvas's RAW pixel size (canvas.width/height), because every text
  // block inside it is positioned (left/top) in those same raw canvas-pixel
  // units — see pdfedStartTextEdit/pdfedRenderTextLayer, which both size the
  // overlay off canvas.width/height and scale it by zoom*density-normalize.
  // This used to resize the box to displayW/displayH (already zoom+density
  // scaled) and THEN transform-scale it by pdfed.zoom alone: the zoom got
  // applied twice and the DPI-density correction got dropped entirely, so
  // every text block drifted away from the real glyphs underneath it the
  // moment the zoom level changed after opening the Text Editor — worse the
  // farther a block sat from the top-left corner and the farther zoom was
  // from 100%, producing the doubled/offset "ghost text" look.
  if (overlay) {
    overlay.style.width  = canvas.width  + 'px';
    overlay.style.height = canvas.height + 'px';
    teSetOverlayZoom(overlay, pdfed.zoom * pdfedZoomNormalize);
    overlay.style.transformOrigin = 'top left';
  }
  // Scale search-highlight overlay identically
  pdfedSearchSyncOverlaySize();
  // Keep Style Specific Text's live highlight boxes aligned at the new zoom
  const pdfedZoomActivePg = pdfed.pages && pdfed.pages[pdfed.active];
  if (pdfedZoomActivePg && typeof teFafSyncHighlightTransform === 'function') teFafSyncHighlightTransform(pdfedZoomActivePg);
  // Update crop box coords if active
  if (pdfed.cropActive) pdfedDrawCropBox();
  // Keep the shared images/texts/tables zoom wrapper in sync too, this is
  // what keeps every placed object's on-screen position correct at any zoom
  // level, since it's a plain CSS transform on one shared container.
  pdfedSyncPlacedTextsZoom();
  const pct = Math.round(pdfed.zoom * 100) + '%';
  document.getElementById('pdfedZoomVal').textContent = pct;

  // Keep the compare "before" pane's display size matching the live canvas
  // if a compare session is open, so both panes stay at the same scale.
  if (typeof teCompareSplitOn !== 'undefined' && teCompareSplitOn) {
    const beforeImg = document.getElementById('pdfedCompareBeforeImg');
    if (beforeImg) { beforeImg.style.width = displayW + 'px'; beforeImg.style.height = displayH + 'px'; }
  }

  // Flash zoom badge
  const badge = document.getElementById('pdfedZoomBadge');
  if (badge) {
    badge.textContent = pct;
    badge.classList.add('show');
    clearTimeout(_zoomBadgeTimer);
    _zoomBadgeTimer = setTimeout(() => badge.classList.remove('show'), 900);
  }
}

function pdfedZoom(delta, pivotX, pivotY) {
  const scroll = document.getElementById('pdfedCanvasScroll');
  const oldZoom = pdfed.zoom;
  pdfed.zoom = Math.max(0.10, Math.min(4.0, pdfed.zoom + delta));
  if (pdfed.zoom === oldZoom) return;

  // If a pivot point is provided (mouse position relative to scroll container),
  // maintain that point's position after zoom (Canva-style)
  if (pivotX !== undefined && pivotY !== undefined) {
    const ratio = pdfed.zoom / oldZoom;
    scroll.scrollLeft = (scroll.scrollLeft + pivotX) * ratio - pivotX;
    scroll.scrollTop  = (scroll.scrollTop  + pivotY) * ratio - pivotY;
  }
  pdfedApplyZoom();
}

function pdfedZoomFit() {
  const scroll  = document.getElementById('pdfedCanvasScroll');
  const canvas  = document.getElementById('pdfedPageCanvas');
  if (!canvas.width || !scroll.clientWidth) return;
  const availW = scroll.clientWidth  - 80;  // 2×40px padding from .pdfed-canvas-inner
  const availH = scroll.clientHeight - 80;
  // Same density normalization as pdfedApplyZoom: fit against this page's
  // real on-screen size (raw px ÷ its own density × baseline), not its raw
  // pixel count, so a 192-DPI Make Forms page and a 96-DPI typed page both
  // "Fit to page" at a zoom % that shows them at the same true physical size.
  const pdfedFitPg = pdfed.pages && pdfed.pages[pdfed.active];
  const pdfedFitDensity = (pdfedFitPg && pdfedFitPg._pxPerMm) || PDFED_PX_PER_MM;
  const pdfedFitNormalize = PDFED_PX_PER_MM / pdfedFitDensity;
  const fitW = canvas.width  * pdfedFitNormalize;
  const fitH = canvas.height * pdfedFitNormalize;
  pdfed.zoom = Math.max(0.10, Math.min(availW / fitW, availH / fitH));
  pdfedApplyZoom();
  scroll.scrollLeft = 0;
  scroll.scrollTop  = 0;
}

// ── Ctrl+Wheel zoom (Canva-style) ──
(function() {
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const scroll = document.getElementById('pdfedCanvasScroll');
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    pdfedZoom(delta, pivotX, pivotY);
  }
  function onKeydown(e) {
    // Only when PDF editor tab is active
    const pdfedSection = document.getElementById('sec-pdfeditor');
    if (!pdfedSection || pdfedSection.style.display === 'none' || !pdfedSection.classList.contains('active')) return;
    const tag = (e.target && e.target.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      pdfedZoomFit();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      pdfedZoom(0.1);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      pdfedZoom(-0.1);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      pdfedSearchOpen();
    }
    if (e.key === 'Escape') {
      const bar = document.getElementById('pdfedSearchBar');
      if (bar && bar.classList.contains('show')) pdfedSearchClose();
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const scroll = document.getElementById('pdfedCanvasScroll');
    if (scroll) scroll.addEventListener('wheel', onWheel, {passive: false});
    document.addEventListener('keydown', onKeydown);
  });
})();

// ─── QUICK SEARCH (Ctrl+F) ───
const pdfSearch = {
  term: '',
  results: [],       // [{ pageIdx, x, y, w, h }] in canvas-px (unscaled by zoom)
  currentIndex: -1,
  cache: new Map(),  // pg object -> array of processed text items {str, x, y, fontSize, fontFamily, width}
  debounceTimer: null,
};
let _pdfSearchMeasureCtx = null;
function pdfedSearchMeasureCtx() {
  if (!_pdfSearchMeasureCtx) {
    const c = document.createElement('canvas');
    _pdfSearchMeasureCtx = c.getContext('2d');
  }
  return _pdfSearchMeasureCtx;
}

function pdfedSearchOpen() {
  if (pdfed.active < 0) { toast('Open a PDF first', 'error'); return; }
  const bar = document.getElementById('pdfedSearchBar');
  bar.classList.add('show');
  const pgact = document.getElementById('pdfedPageActions');
  if (pgact) pgact.classList.add('hide-for-search');
  const input = document.getElementById('pdfedSearchInput');
  input.focus();
  input.select();
  if (pdfSearch.term) pdfedSearchRun(pdfSearch.term);
}

function pdfedSearchClose() {
  const bar = document.getElementById('pdfedSearchBar');
  if (bar) bar.classList.remove('show');
  const pgact = document.getElementById('pdfedPageActions');
  if (pgact) pgact.classList.remove('hide-for-search');
  pdfSearch.results = [];
  pdfSearch.currentIndex = -1;
  pdfedSearchRenderHighlights();
  document.getElementById('pdfedSearchCount').textContent = '';
}

function pdfedSearchInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) pdfedSearchPrev(); else pdfedSearchNext();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    pdfedSearchClose();
  }
}

function pdfedSearchOnInput(val) {
  clearTimeout(pdfSearch.debounceTimer);
  pdfSearch.debounceTimer = setTimeout(() => pdfedSearchRun(val), 250);
}

// Extracts + caches this page's PDF text items with canvas-px positions
// (same 2.0 render scale used everywhere else for this page's canvas/bitmap).
async function pdfedSearchGetPageItems(pg) {
  if (pdfSearch.cache.has(pg)) return pdfSearch.cache.get(pg);
  let out = [];
  if (pg.type === 'pdf' && (pg.srcDoc || pdfed.pdfDoc)) {
    try {
      const pdfPage = await (pg.srcDoc || pdfed.pdfDoc).getPage(pg.pageNum);
      const viewport = pdfPage.getViewport({ scale: 2.0 }); // same scale as render
      const textContent = await pdfPage.getTextContent();
      const scale = viewport.scale;
      textContent.items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        // Same fix as teMergeTextRuns: use pdf.js's own viewport transform
        // instead of the manual `tx[4] * scale` / `viewport.height - tx[5] *
        // scale` math, which drifts off by a constant amount on pages with a
        // non-zero MediaBox/CropBox origin or any rotation, and threw the
        // search-result highlight box off by that same amount.
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const x = tx[4];
        const y = tx[5];
        const fontSize = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]);
        const fontFamily = (item.fontName || 'Arial').replace(/^[A-Z]{6}\+/, '');
        out.push({
          str: item.str,
          x, y: y - fontSize,
          fontSize,
          fontFamily,
          width: (item.width || 0) * scale,
        });
      });
    } catch (err) {
      console.warn('Search text extraction failed:', err);
    }
  }
  pdfSearch.cache.set(pg, out);
  return out;
}

// Estimates the pixel rect of a matched substring within a text item using
// canvas measureText proportions (so accented/monospace font mismatches don't
// throw off the highlight box too much).
function pdfedSearchMatchRect(item, startIdx, len) {
  const ctx = pdfedSearchMeasureCtx();
  ctx.font = `${Math.max(6, Math.round(item.fontSize))}px ${item.fontFamily || 'Arial'}`;
  const fullW = ctx.measureText(item.str).width || 1;
  const prefixW = ctx.measureText(item.str.slice(0, startIdx)).width;
  const matchW = ctx.measureText(item.str.slice(startIdx, startIdx + len)).width;
  const ratio = item.width / fullW;
  return {
    x: item.x + prefixW * ratio,
    y: item.y - 1,
    w: Math.max(3, matchW * ratio),
    h: item.fontSize * 1.25,
  };
}

async function pdfedSearchRun(term) {
  term = (term || '').trim();
  pdfSearch.term = term;
  if (!term) {
    pdfSearch.results = [];
    pdfSearch.currentIndex = -1;
    pdfedSearchRenderHighlights();
    pdfedSearchUpdateCount();
    return;
  }
  const lowerTerm = term.toLowerCase();
  const results = [];
  for (let i = 0; i < pdfed.pages.length; i++) {
    const pg = pdfed.pages[i];
    if (pg.type !== 'pdf') continue;
    const items = await pdfedSearchGetPageItems(pg);
    items.forEach(item => {
      const lowerStr = item.str.toLowerCase();
      let idx = 0;
      while ((idx = lowerStr.indexOf(lowerTerm, idx)) !== -1) {
        const rect = pdfedSearchMatchRect(item, idx, term.length);
        results.push({ pageIdx: i, ...rect });
        idx += term.length;
      }
    });
  }
  pdfSearch.results = results;
  if (!results.length) {
    pdfSearch.currentIndex = -1;
    pdfedSearchRenderHighlights();
    pdfedSearchUpdateCount();
    return;
  }
  // Jump to the first match on/after the current page, else the very first match
  let startAt = results.findIndex(r => r.pageIdx >= pdfed.active);
  if (startAt === -1) startAt = 0;
  pdfedSearchGoTo(startAt);
}

function pdfedSearchUpdateCount() {
  const el = document.getElementById('pdfedSearchCount');
  if (!el) return;
  const prevBtn = document.getElementById('pdfedSearchPrevBtn');
  const nextBtn = document.getElementById('pdfedSearchNextBtn');
  if (!pdfSearch.results.length) {
    el.textContent = pdfSearch.term ? 'No results' : '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  el.textContent = (pdfSearch.currentIndex + 1) + ' / ' + pdfSearch.results.length;
  if (prevBtn) prevBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;
}

async function pdfedSearchGoTo(index) {
  if (!pdfSearch.results.length) return;
  const n = pdfSearch.results.length;
  pdfSearch.currentIndex = ((index % n) + n) % n;
  const result = pdfSearch.results[pdfSearch.currentIndex];
  if (result.pageIdx !== pdfed.active) {
    await pdfedGoto(result.pageIdx); // this itself calls pdfedSearchRenderHighlights()
  } else {
    pdfedSearchRenderHighlights();
  }
  pdfedSearchUpdateCount();
  // scroll the active match into view within the canvas scroll container
  requestAnimationFrame(() => {
    const mark = document.querySelector('.pdfed-search-mark.active');
    if (mark) mark.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  });
}

function pdfedSearchNext() { pdfedSearchGoTo(pdfSearch.currentIndex + 1); }
function pdfedSearchPrev() { pdfedSearchGoTo(pdfSearch.currentIndex - 1); }

function pdfedSearchSyncOverlaySize() {
  const overlay = document.getElementById('pdfedSearchOverlay');
  const canvas = document.getElementById('pdfedPageCanvas');
  if (!overlay || !canvas || !canvas.width) return;
  overlay.style.width  = canvas.width  + 'px';
  overlay.style.height = canvas.height + 'px';
  overlay.style.transform = `scale(${pdfed.zoom})`;
}

function pdfedSearchRenderHighlights() {
  const overlay = document.getElementById('pdfedSearchOverlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  if (!pdfSearch.results.length) return;
  pdfSearch.results.forEach((r, i) => {
    if (r.pageIdx !== pdfed.active) return;
    const mark = document.createElement('div');
    mark.className = 'pdfed-search-mark' + (i === pdfSearch.currentIndex ? ' active' : '');
    mark.style.left   = Math.round(r.x) + 'px';
    mark.style.top    = Math.round(r.y) + 'px';
    mark.style.width  = Math.round(r.w) + 'px';
    mark.style.height = Math.round(r.h) + 'px';
    overlay.appendChild(mark);
  });
}

// ─── CROP ───
function pdfedToggleCrop() {
  if (pdfed.active < 0) { toast('Open a PDF first', 'error'); return; }
  if (teState.active) pdfedCancelTextEdit();
  pdfed.cropActive ? pdfedCropOff() : pdfedCropOn();
}

function pdfedCropOn() {
  pdfed.cropActive = true;
  pdfedDeactivateHand();
  const canvas = document.getElementById('pdfedPageCanvas');
  const W = canvas.width * pdfed.zoom;
  const H = canvas.height * pdfed.zoom;
  const m = 0.1;
  pdfed.cropBox = {x: W*m, y: H*m, w: W*(1-2*m), h: H*(1-2*m)};
  document.getElementById('pdfedCropBox').classList.add('active');
  document.getElementById('pdfedCropBtn').classList.add('active');
  document.getElementById('pdfedApplyCropBtn').style.display = '';
  document.getElementById('pdfedCancelCropBtn').style.display = '';
  pdfedDrawCropBox();
  toast('Drag the box, then Apply Crop', 'info');
}

function pdfedCropOff() {
  pdfed.cropActive = false;
  pdfed.cDrag = false; pdfed.cResize = false;
  pdfedActivateHand();
  const box = document.getElementById('pdfedCropBox');
  if (box) box.classList.remove('active');
  const btn = document.getElementById('pdfedCropBtn');
  if (btn) btn.classList.remove('active');
  const ab = document.getElementById('pdfedApplyCropBtn');
  if (ab) ab.style.display = 'none';
  const cb = document.getElementById('pdfedCancelCropBtn');
  if (cb) cb.style.display = 'none';
}

function pdfedDrawCropBox() {
  const box = document.getElementById('pdfedCropBox');
  if (!box) return;
  const {x, y, w, h} = pdfed.cropBox;
  box.style.left   = Math.round(x) + 'px';
  box.style.top    = Math.round(y) + 'px';
  box.style.width  = Math.round(Math.max(20, w)) + 'px';
  box.style.height = Math.round(Math.max(20, h)) + 'px';
}

async function pdfedApplyCrop() {
  if (pdfed.active < 0 || !pdfed.cropActive) return;
  const canvas = document.getElementById('pdfedPageCanvas');
  const z = pdfed.zoom;
  const {x, y, w, h} = pdfed.cropBox;
  // convert screen → natural canvas pixels
  const sx = x/z, sy = y/z, sw = w/z, sh = h/z;
  if (sw < 5 || sh < 5) { toast('Crop area too small', 'error'); return; }
  const out = document.createElement('canvas');
  out.width = Math.round(sw); out.height = Math.round(sh);
  out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  pdfed.pages[pdfed.active].dataUrl = out.toDataURL('image/png');
  pdfed.pages[pdfed.active].modified = true;
  pdfedCropOff();
  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  toast('Crop applied to page ' + (pdfed.active + 1), 'success');
}

// ── Crop mouse events ──
function pdfedInitCropEvents() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  const box  = document.getElementById('pdfedCropBox');
  if (!wrap || !box) { setTimeout(pdfedInitCropEvents, 200); return; }

  box.addEventListener('mousedown', function(e) {
    if (!pdfed.cropActive) return;
    e.preventDefault(); e.stopPropagation();
    const wR = wrap.getBoundingClientRect();
    const mx = e.clientX - wR.left, my = e.clientY - wR.top;
    const dir = e.target.dataset && e.target.dataset.dir;
    pdfed.cStartMouse = {x: mx, y: my};
    pdfed.cStartBox = {...pdfed.cropBox};
    if (dir) { pdfed.cResize = true; pdfed.cDir = dir; }
    else     { pdfed.cDrag = true; }
  });

  document.addEventListener('mousemove', function(e) {
    if (!pdfed.cropActive || (!pdfed.cDrag && !pdfed.cResize)) return;
    const wR = wrap.getBoundingClientRect();
    const mx = e.clientX - wR.left, my = e.clientY - wR.top;
    const dx = mx - pdfed.cStartMouse.x, dy = my - pdfed.cStartMouse.y;
    const sb = pdfed.cStartBox;
    const canvas = document.getElementById('pdfedPageCanvas');
    const maxW = canvas.width * pdfed.zoom, maxH = canvas.height * pdfed.zoom;
    let {x, y, w, h} = sb;

    if (pdfed.cDrag) {
      x = Math.max(0, Math.min(sb.x + dx, maxW - w));
      y = Math.max(0, Math.min(sb.y + dy, maxH - h));
    } else {
      const d = pdfed.cDir;
      if (d.includes('e')) w = Math.max(20, Math.min(sb.w + dx, maxW - x));
      if (d.includes('s')) h = Math.max(20, Math.min(sb.h + dy, maxH - y));
      if (d.includes('w')) { const nw = Math.max(20, sb.w - dx); x = Math.max(0, sb.x + sb.w - nw); w = nw; }
      if (d.includes('n')) { const nh = Math.max(20, sb.h - dy); y = Math.max(0, sb.y + sb.h - nh); h = nh; }
    }
    pdfed.cropBox = {x, y, w, h};
    pdfedDrawCropBox();
  });

  document.addEventListener('mouseup', function() {
    pdfed.cDrag = false; pdfed.cResize = false;
  });
}
