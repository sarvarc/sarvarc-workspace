// ─── DELETE PAGE ───

// Shared cleanup used when the page just deleted was the last one — folds
// the editor back to its "no document open" state, same chrome reset
// pdfedClosePdf uses, just without the confirmation prompt (Delete Page
// already is the confirmed action here).
function pdfedResetToNoDocument() {
  pdfedCancelTextEdit && pdfedCancelTextEdit();
  pdfedCropOff && pdfedCropOff();
  pdfedCancelAutoCollapse();
  pdfed.pdfDoc = null; pdfed.file = null; pdfed.active = -1; pdfed.zoom = 1.0;
  pdfed.refineReportUsed = false;
  idbKvDelete(PDFED_STORAGE_KEY).catch(e => console.warn('[Workspace] could not clear saved document', e));
  const strip = document.getElementById('pdfedStrip');
  if (strip) strip.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:11px;padding:20px 8px">Open a PDF to see pages</div>';
  document.getElementById('pdfedPageCount').textContent = '';
  document.getElementById('prrTotalPages').textContent = '—';
  document.getElementById('prrPageNum').textContent = '—';
  document.getElementById('prrEdits').textContent = '0 pages modified';
  document.getElementById('pdfedPlaceholder').style.display = 'flex';
  document.getElementById('pdfedCanvasWrap').style.display = 'none';
  pdfedUpdatePageActions();
  document.getElementById('pdfedExportBtn').style.display = 'none';
  const refineBtnEl = document.getElementById('pdfedRefineBtn');
  if (refineBtnEl) refineBtnEl.style.display = 'none';
  const exportBtn2 = document.getElementById('pdfedExportBtn2');
  if (exportBtn2) exportBtn2.style.display = 'none';
  document.getElementById('pdfedCloseBtn').style.display = 'none';
  const pageInfoPill = document.getElementById('pdfedPageInfoPill');
  if (pageInfoPill) pageInfoPill.style.display = 'none';
  if (typeof pdfedRefreshSelectionPanel === 'function') pdfedRefreshSelectionPanel();
  const upBtn = document.getElementById('pdfedUploadBtn');
  if (upBtn) upBtn.style.display = '';
  const fnEl = document.getElementById('pdfedFileName');
  if (fnEl) fnEl.textContent = 'No file open';
  const overlay = document.getElementById('pdfedTextOverlay');
  if (overlay) { overlay.innerHTML = ''; overlay.classList.remove('active'); }
}

// Undo-side counterpart: brings the editor chrome back when the deleted page
// (which was the last one) gets restored.
function pdfedReopenAfterLastPageUndo(restoredFileName) {
  pdfed.pdfDoc = null;
  pdfed.file = { name: restoredFileName || 'Untitled Document' };
  ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
  const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
  const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
  const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
  const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
}

async function pdfedDeletePage(idx) {
  const removedPage = pdfed.pages[idx];
  const wasLastPage = pdfed.pages.length <= 1;
  const fileNameAtDelete = pdfed.file && pdfed.file.name;
  pdfed.pages.splice(idx, 1);

  if (wasLastPage) {
    pdfedResetToNoDocument();
    toast('Last page removed, document closed', 'info');
  } else {
    if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
    await pdfedBuildStrip();
    await pdfedGoto(pdfed.active);
    toast('Page removed', 'info');
  }

  pushAppHistory({
    label: 'Delete PDF page',
    undo: async () => {
      pdfed.pages.splice(idx, 0, removedPage);
      if (wasLastPage) pdfedReopenAfterLastPageUndo(fileNameAtDelete);
      await pdfedBuildStrip();
      await pdfedGoto(idx);
      toast('Page restored', 'success');
    },
    redo: async () => {
      pdfed.pages.splice(idx, 1);
      if (wasLastPage) {
        pdfedResetToNoDocument();
        toast('Last page removed, document closed', 'info');
      } else {
        if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
        await pdfedBuildStrip();
        await pdfedGoto(pdfed.active);
        toast('Page removed', 'info');
      }
    }
  });
}

// ─── INSERT PAGE MODAL ───
function pdfedOpenInsert(afterIdx) {
  pdfed.insertAfterIdx = afterIdx;
  const pos = afterIdx + 2;
  document.getElementById('pdfedInsertPosLabel').textContent =
    afterIdx < 0
      ? 'Inserting at beginning, all pages shift down'
      : 'Inserting after page ' + (afterIdx + 1) + ', page ' + pos + '+ will shift down';
  selectInsertType('blank');
  pdfed.insertBgColor = '#ffffff';
  pdfed.insertImgUrl = null;
  const ed = document.getElementById('pdfedBlankEditor'); if (ed) ed.innerHTML = '';
  // reset image drop
  const drop = document.getElementById('pdfedImgDrop');
  if (drop) {
    drop.classList.remove('has-img');
    drop.innerHTML = '<div style="margin-bottom:8px;opacity:0.5"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div><div>Click or drop an image here</div><div style="font-size:10px;color:var(--text3);margin-top:4px">PNG, JPG, WebP supported</div>';
  }
  // reset bg swatches
  document.querySelectorAll('.pdfed-color-swatch').forEach((s,i) => s.classList.toggle('sel', i===0));
  document.getElementById('pdfedBgColorPicker').value = '#ffffff';
  // reset page format/orientation to A4 portrait
  pdfed.insertFormat = 'a4';
  pdfed.insertOrientation = 'portrait';
  pdfed.insertCustomW = 210;
  pdfed.insertCustomH = 297;
  pdfed.insertUnit = 'mm';
  document.querySelectorAll('.pdfed-fmt-chip[data-fmt]').forEach(b => b.classList.toggle('sel', b.dataset.fmt === 'a4'));
  document.querySelectorAll('.pdfed-orient-btn[data-orient]').forEach(b => b.classList.toggle('sel', b.dataset.orient === 'portrait'));
  document.querySelectorAll('#pdfedUnitToggle .pdfed-orient-btn[data-unit]').forEach(b => b.classList.toggle('sel', b.dataset.unit === 'mm'));
  document.querySelectorAll('#pdfedCustomPresetGrid .exp-preset-chip').forEach(b => b.classList.remove('sel'));
  const customRow = document.getElementById('pdfedCustomSizeRow'); if (customRow) customRow.style.display = 'none';
  const orientRow = document.getElementById('pdfedOrientRow'); if (orientRow) orientRow.style.display = 'inline-flex';
  const cw = document.getElementById('pdfedCustomW'); if (cw) { cw.value = 210; cw.min = 1; cw.max = 20000; cw.step = 1; }
  const ch = document.getElementById('pdfedCustomH'); if (ch) { ch.value = 297; ch.min = 1; ch.max = 20000; ch.step = 1; }
  pdfedUpdateSizePreview();
  // if starting a document from scratch (no pages yet), make that clear
  if (afterIdx < 0 && pdfed.pages.length === 0) {
    document.getElementById('pdfedInsertPosLabel').textContent = 'Creating a new blank document';
  }
  document.getElementById('pdfedInsertOverlay').classList.add('open');
}

function pdfedStartBlank() { pdfedOpenInsert(-1); }

function selectPageFormat(fmt) {
  pdfed.insertFormat = fmt;
  document.querySelectorAll('.pdfed-fmt-chip[data-fmt]').forEach(b => b.classList.toggle('sel', b.dataset.fmt === fmt));
  const customRow = document.getElementById('pdfedCustomSizeRow');
  const orientRow = document.getElementById('pdfedOrientRow');
  if (customRow) customRow.style.display = fmt === 'custom' ? 'flex' : 'none';
  if (orientRow) orientRow.style.display = fmt === 'custom' ? 'none' : 'inline-flex';
  pdfedUpdateSizePreview();
}

function selectPageOrientation(o) {
  pdfed.insertOrientation = o;
  document.querySelectorAll('.pdfed-orient-btn[data-orient]').forEach(b => b.classList.toggle('sel', b.dataset.orient === o));
  pdfedUpdateSizePreview();
}

// ─── Insert Page: custom size unit handling ───
// pdfed.insertCustomW/H always stay in millimetres internally (everything
// downstream — pdfedGetInsertMM, page rendering, the size preview — expects
// real-world mm). The on-screen fields can instead be read/typed in inches
// or pixels (at the same 96dpi/3.7795 px-per-mm assumption used elsewhere
// in the PDF editor); this layer just converts at the boundary.
const PDFED_MM_PER_INCH = 25.4;
const PDFED_PX_PER_MM = 3.7795;
function pdfedUnitToMM(value, unit) {
  if (unit === 'in') return value * PDFED_MM_PER_INCH;
  if (unit === 'px') return value / PDFED_PX_PER_MM;
  return value;
}
function pdfedMMToUnit(mm, unit) {
  if (unit === 'in') return mm / PDFED_MM_PER_INCH;
  if (unit === 'px') return mm * PDFED_PX_PER_MM;
  return mm;
}
function pdfedRoundForUnit(value, unit) {
  if (unit === 'in') return Math.round(value * 100) / 100;
  return Math.round(value);
}
const PDFED_UNIT_BOUNDS = {
  mm: { min: 5, max: 5000, step: 1 },
  in: { min: 0.2, max: 200, step: 0.01 },
  px: { min: 20, max: 20000, step: 1 }
};

// Switches the displayed unit, converting whatever is currently in the
// fields so the physical size stays the same (only its written-out number
// changes), then updates each input's min/max/step to suit that unit.
function setPdfedCustomUnit(unit) {
  const wEl = document.getElementById('pdfedCustomW');
  const hEl = document.getElementById('pdfedCustomH');
  if (wEl && hEl) {
    const oldUnit = pdfed.insertUnit || 'mm';
    const wMM = pdfedUnitToMM(parseFloat(wEl.value) || 0, oldUnit);
    const hMM = pdfedUnitToMM(parseFloat(hEl.value) || 0, oldUnit);
    wEl.value = pdfedRoundForUnit(pdfedMMToUnit(wMM, unit), unit);
    hEl.value = pdfedRoundForUnit(pdfedMMToUnit(hMM, unit), unit);
    const b = PDFED_UNIT_BOUNDS[unit];
    [wEl, hEl].forEach(el => { el.min = b.min; el.max = b.max; el.step = b.step; });
  }
  pdfed.insertUnit = unit;
  document.querySelectorAll('#pdfedUnitToggle .pdfed-orient-btn[data-unit]').forEach(b => b.classList.toggle('sel', b.dataset.unit === unit));
  syncCustomSize();
}

// A preset (paper size or social pixel size) may be expressed in a
// different unit than what's currently showing — switch the unit first,
// write the exact values, then resolve to mm as usual.
function applyPdfedCustomPreset(w, h, unit, btnEl) {
  if (pdfed.insertUnit !== unit) {
    pdfed.insertUnit = unit;
    document.querySelectorAll('#pdfedUnitToggle .pdfed-orient-btn[data-unit]').forEach(b => b.classList.toggle('sel', b.dataset.unit === unit));
    const b = PDFED_UNIT_BOUNDS[unit];
    const wEl = document.getElementById('pdfedCustomW'), hEl = document.getElementById('pdfedCustomH');
    if (wEl && hEl) [wEl, hEl].forEach(el => { el.min = b.min; el.max = b.max; el.step = b.step; });
  }
  const wEl = document.getElementById('pdfedCustomW'); if (wEl) wEl.value = w;
  const hEl = document.getElementById('pdfedCustomH'); if (hEl) hEl.value = h;
  document.querySelectorAll('#pdfedCustomPresetGrid .exp-preset-chip').forEach(b => b.classList.toggle('sel', b === btnEl));
  syncCustomSize();
}

function swapCustomSize() {
  const wEl = document.getElementById('pdfedCustomW');
  const hEl = document.getElementById('pdfedCustomH');
  if (!wEl || !hEl) return;
  const w = wEl.value; wEl.value = hEl.value; hEl.value = w;
  document.querySelectorAll('#pdfedCustomPresetGrid .exp-preset-chip').forEach(b => b.classList.remove('sel'));
  syncCustomSize();
}

function syncCustomSize() {
  const unit = pdfed.insertUnit || 'mm';
  const w = parseFloat(document.getElementById('pdfedCustomW').value);
  const h = parseFloat(document.getElementById('pdfedCustomH').value);
  pdfed.insertCustomW = (w > 0) ? pdfedUnitToMM(w, unit) : 210;
  pdfed.insertCustomH = (h > 0) ? pdfedUnitToMM(h, unit) : 297;
  pdfedUpdateSizePreview();
}

// Squares off using whatever's currently typed in the Width field, in
// whichever unit is currently active — not the internal mm value, which
// would show the wrong number if the fields are set to inches or pixels.
function setSquareCustom() {
  const wEl = document.getElementById('pdfedCustomW');
  const hEl = document.getElementById('pdfedCustomH');
  if (!wEl || !hEl) return;
  const side = parseFloat(wEl.value) || wEl.value;
  hEl.value = side;
  document.querySelectorAll('#pdfedCustomPresetGrid .exp-preset-chip').forEach(b => b.classList.remove('sel'));
  syncCustomSize();
}

// Resolves the currently-selected page format/orientation/custom size to mm dimensions.
function pdfedGetInsertMM() {
  if (pdfed.insertFormat === 'custom') {
    return [pdfed.insertCustomW || 210, pdfed.insertCustomH || 210];
  }
  let [w, h] = PDFED_FORMAT_MM[pdfed.insertFormat] || PDFED_FORMAT_MM.a4;
  if (pdfed.insertOrientation === 'landscape') { const t = w; w = h; h = t; }
  return [w, h];
}

const PDFED_FORMAT_LABELS = { a4: 'A4', a3: 'A3', a5: 'A5', legal: 'Legal', custom: 'Custom' };

// Keeps the little "you'll love it" page-shape preview in sync with the
// currently selected format/orientation/custom size.
function pdfedUpdateSizePreview() {
  const [mmW, mmH] = pdfedGetInsertMM();
  const maxW = 64, maxH = 88;
  const scale = Math.min(maxW / mmW, maxH / mmH);
  const pw = Math.max(16, Math.round(mmW * scale));
  const ph = Math.max(16, Math.round(mmH * scale));
  const pageEl = document.getElementById('pdfedSizePreviewPage');
  if (pageEl) {
    pageEl.style.width = pw + 'px'; pageEl.style.height = ph + 'px';
    const bg = pdfed.insertBgColor || '#ffffff';
    pageEl.style.setProperty('--preview-bg', bg);
    const isLight = (hex => {
      const x = (hex || '#ffffff').replace('#', '');
      if (x.length !== 6) return true;
      const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 > 150;
    })(bg);
    pageEl.style.setProperty('--preview-line-color', isLight ? 'rgba(10,15,30,0.14)' : 'rgba(255,255,255,0.22)');
    pageEl.style.setProperty('--preview-corner-color', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)');
  }

  const nameEl = document.getElementById('pdfedSizePreviewName');
  const dimsEl = document.getElementById('pdfedSizePreviewDims');
  const round1 = v => { const r = Math.round(v * 10) / 10; return (r % 1 === 0) ? String(r) : r.toFixed(1); };
  if (nameEl) nameEl.textContent = PDFED_FORMAT_LABELS[pdfed.insertFormat] || 'Custom';
  if (dimsEl) {
    let txt = round1(mmW) + ' × ' + round1(mmH) + ' mm';
    if (pdfed.insertFormat !== 'custom') {
      txt += ' · ' + (pdfed.insertOrientation === 'landscape' ? 'Landscape' : 'Portrait');
    } else if (Math.abs(mmW - mmH) < 0.5) {
      txt += ' · Square';
    }
    dimsEl.textContent = txt;
  }
}

function pdfedInsertAtEnd() { pdfedOpenInsert(pdfed.pages.length - 1); }
function closeInsertModal() { document.getElementById('pdfedInsertOverlay').classList.remove('open'); }

function selectInsertType(type) {
  pdfed.insertType = type;
  document.getElementById('pdfedTypeBlank').classList.toggle('sel', type === 'blank');
  document.getElementById('pdfedTypeImage').classList.toggle('sel', type === 'image');
  document.getElementById('pdfedBlankContent').classList.toggle('visible', type === 'blank');
  document.getElementById('pdfedImageContent').classList.toggle('visible', type === 'image');
}

function selectPageBg(el) {
  document.querySelectorAll('.pdfed-color-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
  pdfed.insertBgColor = el.dataset.color;
  document.getElementById('pdfedBgColorPicker').value = pdfed.insertBgColor;
  pdfedUpdateSizePreview();
}

function syncBgColor(val) {
  pdfed.insertBgColor = val;
  document.querySelectorAll('.pdfed-color-swatch').forEach(s => s.classList.remove('sel'));
  pdfedUpdateSizePreview();
}

function insertTextFmt(type) {
  const ed = document.getElementById('pdfedBlankEditor');
  if (!ed) return;
  ed.focus();
  if (type === 'heading')    document.execCommand('formatBlock', false, 'h1');
  if (type === 'subheading') document.execCommand('formatBlock', false, 'h2');
}
function clearBlankEditor() { const ed = document.getElementById('pdfedBlankEditor'); if(ed) ed.innerHTML=''; }

function handleInsertImgDrop(e) {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) pdfedLoadInsertImg(f);
  else toast('Please drop an image file', 'error');
}

function handleInsertImgSelect(e) {
  const f = e.target.files[0];
  if (f) pdfedLoadInsertImg(f);
  e.target.value = '';
}

function pdfedLoadInsertImg(file) {
  const r = new FileReader();
  r.onload = ev => {
    pdfed.insertImgUrl = ev.target.result;
    const drop = document.getElementById('pdfedImgDrop');
    drop.classList.add('has-img');
    drop.innerHTML = '<img src="' + ev.target.result + '" alt="Selected image preview" style="max-width:100%;max-height:200px;border-radius:6px;display:block;margin:0 auto">';
  };
  r.readAsDataURL(file);
}

async function pdfedRenderImagePage(imgUrl, mmW, mmH) {
  mmW = mmW > 0 ? mmW : 210;
  mmH = mmH > 0 ? mmH : 297;
  const PXMM = 3.7795; // matches pdfedRenderBlankPage / pdfedExport's 96 DPI assumption
  const W = Math.max(1, Math.round(mmW * PXMM));
  const H = Math.max(1, Math.round(mmH * PXMM));
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = imgUrl; });
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // Fit the image inside the chosen page size (contain, centered) instead of
  // letting the source photo/screenshot's own pixel dimensions define the
  // page's physical size — that's what was causing inserted images to export
  // at an arbitrary, unrelated size next to blank/native pages.
  const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
  return c.toDataURL('image/png');
}

async function confirmInsertPage() {
  if (pdfed.insertType === 'image' && !pdfed.insertImgUrl) {
    toast('Please add an image first', 'error'); return;
  }
  const isNewDoc = pdfed.pages.length === 0;
  try {
    let newPg;
    if (pdfed.insertType === 'blank') {
      const [mmW, mmH] = pdfedGetInsertMM();
      const html = document.getElementById('pdfedBlankEditor').innerHTML;
      const url = await pdfedRenderBlankPage(html, pdfed.insertBgColor, mmW, mmH);
      newPg = {type:'blank', dataUrl:url, modified:true, edits:{}, textBlocks:[], label:'New Page', bgColor:pdfed.insertBgColor, pageMM:[mmW, mmH]};
    } else {
      const [mmW, mmH] = pdfedGetInsertMM();
      const url = await pdfedRenderImagePage(pdfed.insertImgUrl, mmW, mmH);
      newPg = {type:'image', dataUrl:url, modified:true, edits:{}, textBlocks:[], label:'Image Page', pageMM:[mmW, mmH]};
    }
    const at = pdfed.insertAfterIdx + 1;
    pdfed.pages.splice(at, 0, newPg);

    if (isNewDoc) {
      // No PDF was open, this blank page is starting a brand-new document.
      // Bring up the editor chrome the same way opening a PDF would.
      pdfed.pdfDoc = null;
      pdfed.file = { name: 'Untitled Document' };
      ['pdfedExportBtn','pdfedRefineBtn','pdfedExportBtn2','pdfedCloseBtn','pdfedPageInfoPill'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn');
      if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName');
      if (fnEl) fnEl.textContent = pdfed.file.name;
      document.getElementById('pdfedPlaceholder').style.display = 'none';
      document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar');
      if (tb) tb.style.visibility = 'visible';
      state.stats.pdfs++;
    }

    document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
    state.stats.pages++;
    updateStats();
    closeInsertModal();
    await pdfedBuildStrip();
    await pdfedGoto(at);
    if (isNewDoc) setTimeout(pdfedZoomFit, 50);
    if (isNewDoc) pdfedScheduleAutoCollapse();
    toast(isNewDoc ? 'Blank document created' : 'Page inserted at position ' + (at + 1), 'success');
  } catch (err) {
    console.error('Insert page failed:', err);
    toast('Could not insert page, please try again', 'error');
  }
}

// --- KADESSA: CHANGE CANVAS SIZE + REFLOW CONTENT (build 277) ---------------
// Lets Kadessa switch a page to another format or ratio (A4 to 16:9, A3, square,
// story, custom) and rearrange what is on it, without cropping or distorting.
// --- KADESSA: CANVAS RESIZE + CONTENT REFLOW (pure layout, no DOM) ---
// items: [{ id, key, kind, x, y, w, h, wm }]  kind: text|table|image|shape|border
//   x/y/w/h are page px on the OLD page (W x H). wm = watermark/decor flag.
// Returns { mode, columns, scale, warnings, boxes: { id: {x,y,w,h,s} } }
//   s = the uniform factor that item's own font/stroke/column sizes should get.
// Nothing here ever crops, overlaps or distorts: content is only moved, and
// scaled by ONE shared factor. If no layout fits, it falls back to a plain
// contain-and-center fit, which cannot hurt anything.
function pdfedReflowPlan(items, W, H, W2, H2, opts) {
  opts = opts || {};
  const sx = W2 / W, sy = H2 / H, sFit = Math.min(sx, sy);
  const boxes = {};
  const warnings = [];
  const fitAll = function(why) {
    const ox = (W2 - W * sFit) / 2, oy = (H2 - H * sFit) / 2;
    items.forEach(function(it) { boxes[it.id] = { x: it.x * sFit + ox, y: it.y * sFit + oy, w: it.w * sFit, h: it.h * sFit, s: sFit }; });
    return { mode: 'fit', columns: 1, scale: sFit, warnings: why ? [why] : [], boxes: boxes };
  };
  if (!items.length) return { mode: 'empty', columns: 1, scale: sFit, warnings: [], boxes: boxes };
  const layout = opts.layout || 'auto';
  if (layout === 'fit') return fitAll();

  const aspectOld = W / H, aspectNew = W2 / H2;
  const sameShape = Math.abs(aspectNew / aspectOld - 1) < 0.06;
  if (sameShape && !opts.columns && layout !== 'reflow') {
    // Same shape, different size: everything keeps its place, just scaled.
    items.forEach(function(it) { boxes[it.id] = { x: it.x * sx, y: it.y * sy, w: it.w * sFit, h: it.h * sFit, s: sFit }; });
    return { mode: 'scale', columns: 1, scale: sFit, warnings: [], boxes: boxes };
  }

  // 1. Page-anchored decoration (frames, full-page backdrops, watermarks).
  const frames = [], content = [];
  items.forEach(function(it) {
    const isFrame = it.wm || (it.w >= 0.8 * W && it.h >= 0.8 * H);
    (isFrame ? frames : content).push(it);
  });
  frames.forEach(function(it) {
    if (it.kind !== 'shape' && it.kind !== 'border') {
      const w2 = it.w * sFit, h2 = it.h * sFit;
      boxes[it.id] = { x: (it.x + it.w / 2) * sx - w2 / 2, y: (it.y + it.h / 2) * sy - h2 / 2, w: w2, h: h2, s: sFit };
    } else {
      boxes[it.id] = { x: it.x * sx, y: it.y * sy, w: it.w * sx, h: it.h * sy, s: sFit };
    }
  });
  if (!content.length) return { mode: 'scale', columns: 1, scale: sFit, warnings: [], boxes: boxes };

  // 2. Bands: items that share vertical space stay together as one rigid group,
  //    so side-by-side layouts and text-on-a-card keep their internal geometry.
  const sorted = content.slice().sort(function(a, b) { return a.y - b.y || a.x - b.x; });
  let bands = [];
  sorted.forEach(function(it) {
    const last = bands[bands.length - 1];
    if (last && it.y < last.maxY - 2) {
      last.items.push(it);
      last.maxY = Math.max(last.maxY, it.y + it.h);
      last.minX = Math.min(last.minX, it.x);
      last.maxX = Math.max(last.maxX, it.x + it.w);
    } else {
      bands.push({ items: [it], minX: it.x, maxX: it.x + it.w, minY: it.y, maxY: it.y + it.h });
    }
  });
  bands.forEach(function(b) { b.w = Math.max(1, b.maxX - b.minX); b.h = Math.max(1, b.maxY - b.minY); });

  // 3. A slim band sitting at the very bottom is a footer: pin it there.
  let footers = [];
  if (bands.length > 1) {
    const lb = bands[bands.length - 1];
    if (lb.minY >= 0.86 * H && lb.h <= 0.14 * H) footers = [bands.pop()];
  }

  const margin = Math.max(20, Math.round(0.05 * Math.min(W2, H2)));
  const gap = Math.max(14, Math.round(0.03 * Math.min(W2, H2)));
  const bandGap = function(i, s) {
    if (i <= 0) return 0;
    const g = bands[i].minY - bands[i - 1].maxY;
    return Math.max(6, g * s);
  };
  const footerReserve = function(s) {
    return footers.reduce(function(a, f) { return a + f.h * s; }, 0) + (footers.length ? gap : 0);
  };

  // Flow the bands into `c` columns at scale s. Bands too wide for one column
  // span several; a spanning band closes the current columns and starts a new row.
  function flow(c, s) {
    const usableW = W2 - 2 * margin;
    const colW = (usableW - gap * (c - 1)) / c;
    const bottom = H2 - margin - footerReserve(s);
    const out = [];
    let y = margin, i = 0;
    while (i < bands.length) {
      const b = bands[i];
      const needW = b.w * s;
      const span = Math.ceil((needW + gap) / (colW + gap) - 1e-9);
      if (span > c) return { ok: false };
      if (span > 1) {
        const spanW = colW * span + gap * (span - 1);
        if (y + (i ? bandGap(i, s) : 0) + b.h * s > bottom + 0.5) return { ok: false };
        y += (i ? bandGap(i, s) : 0);
        out.push({ b: b, x: margin, w: c > 1 && span === c ? usableW : spanW, top: y });
        y += b.h * s; i++;
        continue;
      }
      // a run of ordinary bands: balance them across the columns
      let j = i;
      while (j < bands.length && Math.ceil((bands[j].w * s + gap) / (colW + gap) - 1e-9) <= 1) j++;
      const run = bands.slice(i, j);
      const hs = run.map(function(r, k) { return r.h * s + (k ? bandGap(i + k, s) : 0); });
      const total = hs.reduce(function(a, v) { return a + v; }, 0);
      const tallest = Math.max.apply(null, run.map(function(r) { return r.h * s; }));
      const avail = bottom - (y + (i ? bandGap(i, s) : 0));
      if (tallest > avail + 0.5) return { ok: false };
      const startY = y + (i ? bandGap(i, s) : 0);
      let placed = null;
      for (let target = Math.max(tallest, total / c); target <= avail + 0.5; target += Math.max(2, avail / 60)) {
        const cols = [[]]; let used = 0, fail = false;
        run.forEach(function(r, k) {
          const need = r.h * s;
          const gapBefore = cols[cols.length - 1].length ? bandGap(i + k, s) : 0;
          if (used + gapBefore + need > target + 0.01 && cols[cols.length - 1].length) {
            if (cols.length >= c) { fail = true; return; }
            cols.push([]); used = 0;
          }
          const gb = cols[cols.length - 1].length ? bandGap(i + k, s) : 0;
          cols[cols.length - 1].push({ r: r, top: startY + used + gb });
          used += gb + need;
        });
        if (!fail) { placed = cols; break; }
      }
      if (!placed) return { ok: false };
      let rowBottom = startY;
      placed.forEach(function(col, ci) {
        col.forEach(function(e) {
          out.push({ b: e.r, x: margin + ci * (colW + gap), w: colW, top: e.top });
          rowBottom = Math.max(rowBottom, e.top + e.r.h * s);
        });
      });
      y = rowBottom; i = j;
    }
    return { ok: true, out: out, endY: y };
  }

  const maxC = opts.columns ? Math.max(1, Math.min(4, Math.round(opts.columns))) : 3;
  const minC = opts.columns ? maxC : 1;
  const sTop = Math.min(opts.maxScale || 2.5, Math.max(sx, sy));
  let best = null;
  for (let c = minC; c <= maxC; c++) {
    for (let s = sTop; s >= 0.2; s *= 0.97) {
      const r = flow(c, s);
      if (r.ok) {
        const score = s * (1 - 0.03 * (c - 1));
        if (!best || score > best.score + 1e-6) best = { c: c, s: s, r: r, score: score };
        break;
      }
    }
  }
  if (!best || best.s < 0.25) return fitAll('the content was too much to reflow, so it was scaled to fit instead');

  const s = best.s;
  // Puts one band's items into the box p = {x, w, top}. Items keep their left /
  // right / centre anchoring, shapes and bars that spanned their band stretch to
  // its new width, and anything that bled off a page edge keeps bleeding.
  function placeBand(b, p) {
    b.items.forEach(function(it) {
      const gl = it.x - b.minX, gr = b.maxX - (it.x + it.w);
      const stretch = (it.kind === 'shape' || it.kind === 'border') && it.w >= 0.9 * b.w;
      let nx, nw = it.w * s, ny = p.top + (it.y - b.minY) * s, nh = it.h * s;
      if (stretch) {
        nx = p.x; nw = p.w;
        if (it.x <= 2 && it.x + it.w >= W - 2) { nx = 0; nw = W2; }
        if (it.y <= 2) { ny = 0; nh = p.top + (it.y - b.minY) * s + it.h * s; }
        else if (it.y + it.h >= H - 2) { nh = (H2 - ny); }
      }
      else if (gl <= gr * 0.5 + 1) nx = p.x + gl * s;
      else if (gr <= gl * 0.5 + 1) nx = p.x + p.w - gr * s - nw;
      else nx = p.x + p.w / 2 + ((it.x + it.w / 2) - (b.minX + b.w / 2)) * s - nw / 2;
      boxes[it.id] = { x: nx, y: ny, w: nw, h: nh, s: s };
    });
  }
  best.r.out.forEach(function(p) { placeBand(p.b, p); });
  footers.forEach(function(f) { placeBand(f, { x: margin, w: W2 - 2 * margin, top: H2 - margin - f.h * s }); });
  if (s < 0.55) warnings.push('text became small on the new canvas');
  return { mode: 'reflow', columns: best.c, scale: s, warnings: warnings, boxes: boxes };
}

// Standard page sizes Kadessa can switch to (mm, portrait w x h). Same table as
// PDFED_FORMAT_MM plus US Letter.
const PDFED_KADESSA_FORMAT_MM = { a4: [210, 297], a3: [297, 420], a5: [148, 210], legal: [215.9, 355.6], letter: [215.9, 279.4] };

// Works out the new page size in mm from what Kadessa asked for. Returns null
// when no size was named. A ratio keeps the page's LONG edge (A4 portrait to
// 16:9 gives 297 x 167 mm), a preset keeps the current orientation unless one
// is given, and custom takes width/height in mm or px (96 dpi).
function pdfedKadessaTargetMM(p, curMM) {
  const wantLand = p.orientation === 'landscape', wantPort = p.orientation === 'portrait';
  const fmt = p.format ? String(p.format).toLowerCase() : '';
  let w, h;
  if (p.aspect_ratio) {
    const m = String(p.aspect_ratio).match(/^\s*(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)\s*$/i);
    if (!m || !(parseFloat(m[1]) > 0) || !(parseFloat(m[2]) > 0)) throw new Error('aspect_ratio must look like 16:9');
    let a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (wantLand && a < b) { const t = a; a = b; b = t; }
    else if (wantPort && a > b) { const t = a; a = b; b = t; }
    const long = Math.max(curMM[0], curMM[1]);
    if (a >= b) { w = long; h = long * b / a; } else { h = long; w = long * a / b; }
  } else if (fmt && fmt !== 'custom') {
    const preset = PDFED_KADESSA_FORMAT_MM[fmt];
    if (!preset) throw new Error('unknown page format "' + p.format + '"');
    w = preset[0]; h = preset[1];
    const land = wantLand || (!wantPort && curMM[0] > curMM[1]);
    if (land) { const t = w; w = h; h = t; }
  } else if (Number(p.width_mm) > 0 && Number(p.height_mm) > 0) {
    w = Number(p.width_mm); h = Number(p.height_mm);
  } else if (Number(p.width_px) > 0 && Number(p.height_px) > 0) {
    w = Number(p.width_px) / 3.7795; h = Number(p.height_px) / 3.7795;
  } else if (fmt === 'custom') {
    throw new Error('custom size needs both a width and a height');
  } else {
    return null;
  }
  if (!(w >= 20 && h >= 20 && w <= 5000 && h <= 5000)) throw new Error('that page size is out of range');
  return [w, h];
}

// True when the page bitmap is only a background (solid colour or a smooth
// gradient), so it can be stretched to any shape without distorting anything.
// Text, logos, scans and artwork all show up as hard edges and return false.
async function pdfedKadessaRasterIsFlat(img) {
  const k = Math.min(1, 500 / img.naturalWidth);
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let edges = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4, r = i + 4, b = i + w * 4;
      const dx = Math.abs(d[i] - d[r]) + Math.abs(d[i + 1] - d[r + 1]) + Math.abs(d[i + 2] - d[r + 2]);
      const dy = Math.abs(d[i] - d[b]) + Math.abs(d[i + 1] - d[b + 1]) + Math.abs(d[i + 2] - d[b + 2]);
      if (dx > 45 || dy > 45) { if (++edges > 40) return false; }
    }
  }
  return true;
}

// Colour for the bars left around a page that is scaled to fit: the median of
// its corners and edge midpoints.
function pdfedKadessaEdgeColor(img) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 32, 32);
  const pts = [[0, 0], [31, 0], [0, 31], [31, 31], [16, 0], [16, 31], [0, 16], [31, 16]];
  const ch = [[], [], []];
  pts.forEach(function(pt) { const px = g.getImageData(pt[0], pt[1], 1, 1).data; for (let n = 0; n < 3; n++) ch[n].push(px[n]); });
  const med = ch.map(function(a) { a.sort(function(x, y) { return x - y; }); return Math.round((a[3] + a[4]) / 2); });
  return 'rgb(' + med[0] + ',' + med[1] + ',' + med[2] + ')';
}

const PDFED_KADESSA_PLACED_KEYS = [['placedTexts', 'text'], ['placedImages', 'image'], ['placedTables', 'table'], ['placedShapes', 'shape'], ['placedBorders', 'border']];

// Everything a canvas resize can change on one page, so undo/redo can put it back.
function pdfedKadessaCanvasSnap(pg) {
  const o = {
    dataUrl: pg.dataUrl, pageMM: pg.pageMM ? pg.pageMM.slice() : pg.pageMM, width: pg.width, height: pg.height,
    textBlocks: pg.textBlocks ? JSON.parse(JSON.stringify(pg.textBlocks)) : pg.textBlocks,
    pre: pg.edits ? pg.edits.preTintDataUrl : undefined, base: pg.edits ? pg.edits.canvasTintBaseDataUrl : undefined,
    placed: {}
  };
  PDFED_KADESSA_PLACED_KEYS.forEach(function(kk) {
    const a = pg[kk[0]];
    o.placed[kk[0]] = Array.isArray(a) ? a.map(function(it) { return Object.assign({}, it); }) : a;
  });
  return o;
}
function pdfedKadessaCanvasRestore(pg, o) {
  pg.dataUrl = o.dataUrl; pg.pageMM = o.pageMM ? o.pageMM.slice() : o.pageMM; pg.width = o.width; pg.height = o.height;
  pg.textBlocks = o.textBlocks ? JSON.parse(JSON.stringify(o.textBlocks)) : o.textBlocks;
  pg._teFafGeom = null;
  if (pg.edits) { pg.edits.preTintDataUrl = o.pre; pg.edits.canvasTintBaseDataUrl = o.base; }
  PDFED_KADESSA_PLACED_KEYS.forEach(function(kk) {
    const a = o.placed[kk[0]];
    pg[kk[0]] = Array.isArray(a) ? a.map(function(it) { return Object.assign({}, it); }) : a;
  });
  pg.modified = true;
}

// Writes one planned box onto a live placed object. Sizes that belong to the
// object (font, strokes, table columns and rows) scale by the box's own factor.
function pdfedKadessaApplyBox(it, kind, o, b) {
  const s = b.s;
  const sc = function(k) { if (typeof o[k] === 'number') it[k] = o[k] * s; };
  it.x = b.x; it.y = b.y;
  if (kind === 'table') {
    it.colWidths = (o.colWidths || []).map(function(v) { return v * s; });
    it.rowHeights = (o.rowHeights || []).map(function(v) { return v * s; });
    ['fontSize', 'padding', 'cellPadding', 'borderWidth'].forEach(sc);
  } else if (kind === 'text') {
    if (typeof o.w === 'number') it.w = b.w;
    if (typeof o.h === 'number') it.h = b.h;
    ['fontSize', 'letterSpacing', 'padding', 'borderRadius', 'borderWidth'].forEach(sc);
  } else if (kind === 'image') {
    it.w = b.w; it.h = b.h;
    ['borderWidth', 'borderRadius'].forEach(sc);
  } else if (kind === 'shape') {
    it.w = b.w; it.h = b.h;
    if (typeof o.size === 'number') it.size = Math.max(1, o.size * s);
  } else if (kind === 'border') {
    it.w = b.w; it.h = b.h;
    if (typeof o.thickness === 'number') it.thickness = Math.max(1, o.thickness * s);
  }
}

// After a reflow: does any text box now run past the edge of the page?
function pdfedKadessaTextOverflows(pg, W2, H2) {
  return (pg.placedTexts || []).some(function(t) {
    const el = document.querySelector('.pdfed-placed-text[data-id="' + t.id + '"]');
    return !!el && (t.x + el.offsetWidth > W2 + 2 || t.y + el.offsetHeight > H2 + 2);
  });
}

// Changes the canvas size of one, some or all pages and rearranges the content
// to suit the new shape. Nothing is cropped or stretched:
//  - a page whose bitmap is just a background (solid or gradient) gets a new
//    background at the new size and its placed text, images, tables and shapes
//    are REFLOWED (columns, anchoring, one shared scale) by pdfedReflowPlan;
//  - a page whose bitmap is real content (a scanned or imported PDF, artwork)
//    is scaled to fit, centred, with everything on it moving together.
// After each reflow the real text boxes are measured; if any runs off the page
// the scale is trimmed and it is retried, and the last resort is a plain fit.
async function pdfedKadessaResizeCanvas(p) {
  p = p || {};
  if (!pdfed.pages.length) throw new Error('open a document first');
  const total = pdfed.pages.length;
  let nums;
  if (p.pages === 'all') nums = Array.from({ length: total }, function(_, i) { return i + 1; });
  else if (Array.isArray(p.pages) && p.pages.length) nums = p.pages.map(function(n) { return parseInt(n, 10); }).filter(function(n) { return n >= 1 && n <= total; });
  else nums = [(pdfed.active < 0 ? 0 : pdfed.active) + 1];
  if (!nums.length) throw new Error('none of those page numbers exist in this document');
  nums = Array.from(new Set(nums));

  const layout = (p.layout === 'reflow' || p.layout === 'fit') ? p.layout : 'auto';
  const columns = Math.max(0, Math.min(4, parseInt(p.columns, 10) || 0));
  const bgMode = (p.background === 'stretch' || p.background === 'fit') ? p.background : 'auto';
  const startActive = pdfed.active >= 0 ? pdfed.active : 0;
  const results = [], changed = [];
  const fmtMM = function(v) { return Math.round(v * 10) / 10; };

  for (const num of nums) {
    const idx = num - 1, pg = pdfed.pages[idx];
    const img = await pdfedLoadPageImage(pg);
    if (!img || !img.naturalWidth) { results.push({ page: num, skipped: 'could not read this page' }); continue; }
    const W = img.naturalWidth, H = img.naturalHeight, pxmm = pdfedPageDensity(pg);
    const curMM = [W / pxmm, H / pxmm];
    let target = pdfedKadessaTargetMM(p, curMM);
    if (!target) {
      if (columns || layout === 'reflow') target = curMM;
      else throw new Error('tell me the new size: a format like A3, a ratio like 16:9, or a custom width and height');
    }
    const W2 = Math.max(1, Math.round(target[0] * pxmm)), H2 = Math.max(1, Math.round(target[1] * pxmm));
    if (W2 * H2 > 60000000) throw new Error('that size is too large to render');
    if (Math.abs(W2 - W) <= 1 && Math.abs(H2 - H) <= 1 && !columns && layout !== 'reflow') {
      results.push({ page: num, skipped: 'already that size' });
      continue;
    }

    await pdfedGoto(idx); // the page must be on screen so text boxes can be measured
    const snapBefore = pdfedKadessaCanvasSnap(pg);
    const hasBlocks = Array.isArray(snapBefore.textBlocks) && snapBefore.textBlocks.length > 0;
    let stretch;
    if (bgMode === 'stretch') stretch = true;
    else if (bgMode === 'fit') stretch = false;
    else stretch = pg.type === 'blank' && await pdfedKadessaRasterIsFlat(img);
    if (hasBlocks) stretch = false; // edited scan text sits on the bitmap: move it as one piece

    // new bitmap
    const out = document.createElement('canvas'); out.width = W2; out.height = H2;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const sF = Math.min(W2 / W, H2 / H), ox = (W2 - W * sF) / 2, oy = (H2 - H * sF) / 2;
    if (stretch) g.drawImage(img, 0, 0, W2, H2);
    else {
      g.fillStyle = pg.bgColor || pdfedKadessaEdgeColor(img);
      g.fillRect(0, 0, W2, H2);
      g.drawImage(img, ox, oy, W * sF, H * sF);
    }
    let newUrl;
    try { newUrl = out.toDataURL('image/png'); }
    catch (e) { results.push({ page: num, skipped: 'could not re-render this page' }); continue; }

    // placed objects
    const items = [], live = {}, orig = {};
    PDFED_KADESSA_PLACED_KEYS.forEach(function(kk) {
      (pg[kk[0]] || []).forEach(function(it, n) {
        if (typeof it.x !== 'number' || typeof it.y !== 'number') return;
        let w = it.w, h = it.h;
        if (kk[1] === 'table') {
          w = (it.colWidths || []).reduce(function(a, v) { return a + v; }, 0);
          h = (it.rowHeights || []).reduce(function(a, v) { return a + v; }, 0);
        } else if (kk[1] === 'text') {
          const el = document.querySelector('.pdfed-placed-text[data-id="' + it.id + '"]');
          w = (typeof it.w === 'number' && it.w > 0) ? it.w : (el ? el.offsetWidth : 200);
          h = el ? el.offsetHeight : (it.h || (it.fontSize || 14) * 1.5);
        }
        if (!(w > 0)) w = 1;
        if (!(h > 0)) h = 1;
        const id = kk[0] + ':' + n;
        items.push({ id: id, key: kk[0], kind: kk[1], x: it.x, y: it.y, w: w, h: h, wm: !!it._watermark });
        live[id] = it; orig[id] = Object.assign({}, it);
      });
    });

    const planLayout = stretch ? layout : 'fit';
    let plan = null, cap = 0, note = '';
    for (let a = 0; a < 6; a++) {
      const lastResort = (a === 5);
      plan = pdfedReflowPlan(items, W, H, W2, H2, { layout: lastResort ? 'fit' : planLayout, columns: stretch ? columns : 0, maxScale: cap || undefined });
      items.forEach(function(row) { Object.assign(live[row.id], orig[row.id]); pdfedKadessaApplyBox(live[row.id], row.kind, orig[row.id], plan.boxes[row.id]); });
      if (hasBlocks) {
        pg.textBlocks = JSON.parse(JSON.stringify(snapBefore.textBlocks)).map(function(tb) {
          tb.x = tb.x * sF + ox; tb.y = tb.y * sF + oy;
          ['fontSize', 'origWidth', 'origHeight'].forEach(function(k) { if (typeof tb[k] === 'number') tb[k] = tb[k] * sF; });
          return tb;
        });
        pg._teFafGeom = null;
      }
      pg.dataUrl = newUrl; pg.pageMM = [target[0], target[1]]; pg.width = W2; pg.height = H2;
      if (pg.edits) { pg.edits.preTintDataUrl = undefined; pg.edits.canvasTintBaseDataUrl = undefined; }
      await pdfedGoto(idx);
      if (plan.mode !== 'reflow' || lastResort || !pdfedKadessaTextOverflows(pg, W2, H2)) { if (lastResort) note = 'the layout would not fit cleanly, so it was scaled to fit instead'; break; }
      cap = plan.scale * 0.94;
    }
    pdfedMarkModified(idx);
    changed.push({ idx: idx, before: snapBefore, after: pdfedKadessaCanvasSnap(pg) });
    if (!note && stretch === false && columns) note = 'this page is a picture or scan, so its content was scaled to fit instead of rearranged';
    if (!note && plan.warnings.length) note = plan.warnings[0];
    results.push({
      page: num, from: fmtMM(curMM[0]) + ' x ' + fmtMM(curMM[1]) + ' mm', to: fmtMM(target[0]) + ' x ' + fmtMM(target[1]) + ' mm',
      layout: plan.mode, columns: plan.columns, contentScalePct: Math.round(plan.scale * 100), note: note || undefined
    });
  }

  if (!changed.length) return { pagesChanged: 0, results: results };

  await pdfedBuildStrip();
  await pdfedGoto(Math.min(startActive, pdfed.pages.length - 1));
  setTimeout(function() { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 50);

  const restoreAll = async function(which) {
    changed.forEach(function(c) { if (pdfed.pages[c.idx]) pdfedKadessaCanvasRestore(pdfed.pages[c.idx], c[which]); });
    await pdfedBuildStrip();
    await pdfedGoto(Math.min(Math.max(pdfed.active, 0), pdfed.pages.length - 1));
    setTimeout(function() { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 50);
  };
  pushKadessaAppHistory({
    label: 'Resize canvas (Kadessa)',
    undo: async function() { await restoreAll('before'); toast('Canvas size put back', 'info'); },
    redo: async function() { await restoreAll('after'); toast('Canvas resized again', 'success'); }
  });
  toast('Canvas resized and content rearranged to fit', 'success');
  return { pagesChanged: changed.length, results: results };
}


// ─── KADESSA: INSERT PAGE (programmatic, no modal) ─────────────────────────
// Same core page-creation path confirmInsertPage() above uses (blank page
// only -- Kadessa can't attach an image file mid-conversation, so the
// image-insert type stays a manual-only affordance), but driven entirely
// by explicit params instead of reading the Insert Page modal's DOM state.
// Lets Kadessa insert a page anywhere in the open document -- between two
// existing pages, right after whichever page is currently open, or at the
// very end -- at a real physical size (A4/A3/A5/Legal or a fully custom
// width/height), matching what a person could do by hand through the same
// modal, including its A4 default and format→mm table.
function pdfedKadessaResolveInsertMM(p) {
  const fmt = String(p.format || 'a4').toLowerCase();
  let mmW, mmH;
  if (fmt === 'custom') {
    mmW = Number(p.width_mm) > 0 ? Number(p.width_mm) : 210;
    mmH = Number(p.height_mm) > 0 ? Number(p.height_mm) : 297;
  } else {
    const preset = PDFED_FORMAT_MM[fmt];
    if (!preset) throw new Error('unknown page format "' + p.format + '"');
    mmW = preset[0]; mmH = preset[1];
    if (p.orientation === 'landscape') { const t = mmW; mmW = mmH; mmH = t; }
  }
  return [mmW, mmH];
}

// Turns Kadessa's flat content blocks into the exact contenteditable-shaped
// HTML pdfedParseBlankContent()/pdfedDrawBlankContent() already know how to
// read (h1/h2/div with a text-align style, b/i/u inline) -- the same markup
// the modal's own "Content" editor produces by hand, just built from
// structured params instead of a live DOM. Anything malformed or missing
// text is skipped rather than thrown on, so one bad block in the array
// never kills the whole page insert.
function pdfedKadessaEscapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = (s === null || s === undefined) ? '' : String(s);
  return d.innerHTML;
}

function pdfedKadessaBuildContentHtml(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  return blocks.map(function(b){
    if (!b || !b.text) return '';
    const tag = b.type === 'heading' ? 'h1' : (b.type === 'subheading' ? 'h2' : 'div');
    const align = ['left', 'center', 'right'].indexOf(b.align) !== -1 ? b.align : 'left';
    let inner = pdfedKadessaEscapeHtml(b.text).replace(/\n/g, '<br>');
    if (b.bold) inner = '<b>' + inner + '</b>';
    if (b.italic) inner = '<i>' + inner + '</i>';
    if (b.underline) inner = '<u>' + inner + '</u>';
    return '<' + tag + ' style="text-align:' + align + '">' + inner + '</' + tag + '>';
  }).join('');
}

// ─── KADESSA: EDITABLE TEXT ENGINE (build 242) ─────────────────────────────
// Before this build, text Kadessa put on a new page (a menu, carousel slides,
// anything that came from an attached Word file) was painted straight into
// the page bitmap by pdfedRenderBlankPage(), so it came out as a flat
// picture nobody could click or edit. Now the text is laid out as real
// placed text boxes (pg.placedTexts): the very same objects the Add Text
// tool makes. Every word can be retyped, moved, restyled, recoloured, and it
// exports as real vector text. The same engine also drops text onto a page
// that already has a design (pdfed_add_text_to_page), fitting it into the
// open space Kadessa picked by looking at the page.
//
// Block shapes Kadessa sends (see the Worker's tool definitions):
//   heading / subheading / paragraph  {type, text, align?, bold?, italic?, underline?, color?}
//   item  {type:'item', text (dish or product name), price?, note?}
//         -> name on the left, price aligned right on the same line, small
//            italic note underneath. Built for menus and price lists.
// Page-wide look: heading_font, body_font, text_color, text_scale,
// default_align, v_align ('top' | 'middle').
//
// Fit rules: type is shrunk a little (down to 70%) to fit the space. If it
// still does not fit, the rest continues on extra pages, so nothing is ever
// cut off or dropped.
const PDFED_KADESSA_BASE_PX = 794;        // A4 width in canvas px; every type size below is tuned for this width
const PDFED_KADESSA_MAX_EXTRA_PAGES = 12; // safety stop for runaway content

// Real canvas-pixel size of a page. For the open page this reads the actual
// canvas, so it is exact even for uploaded PDFs; otherwise it falls back to
// pageMM (A4 if unset) at the editor's 3.7795 px per mm.
function pdfedKadessaPageSizePx(pg, idx) {
  const pc = document.getElementById('pdfedPageCanvas');
  if (pg && idx === pdfed.active && pc && pc.width > 0 && pc.height > 0) return [pc.width, pc.height];
  const mm = (pg && pg.pageMM) || [210, 297];
  return [Math.max(1, Math.round(mm[0] * 3.7795)), Math.max(1, Math.round(mm[1] * 3.7795))];
}

// Lowest point (canvas px) already used by anything on the page. Text boxes
// have no stored height, so the open page's real DOM height is used when it
// is on screen.
function pdfedKadessaContentBottomPx(pg, idx) {
  let low = 0;
  if (!pg) return low;
  (pg.placedTexts || []).forEach(function(t) {
    const el = (idx === pdfed.active) ? document.querySelector('.pdfed-placed-text[data-id="' + t.id + '"]') : null;
    const hh = el ? el.offsetHeight : (t.h || 24);
    low = Math.max(low, (t.y || 0) + hh);
  });
  (pg.placedImages || []).forEach(function(im) { low = Math.max(low, (im.y || 0) + (im.h || 0)); });
  (pg.placedTables || []).forEach(function(t) {
    const th = (t.rowHeights || []).reduce(function(a, b) { return a + b; }, 0);
    low = Math.max(low, (t.y || 0) + th);
  });
  return low;
}

function pdfedKadessaLuma(hex) {
  const x = String(hex || '#ffffff').replace('#', '');
  const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 255;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

// Average brightness (0 to 255) of the page bitmap behind a region. Used to
// choose dark or light text when Kadessa did not pick a colour herself.
async function pdfedKadessaBackdropLuma(pg, region, sizePx) {
  try {
    if (!pg || !pg.dataUrl) throw new Error('no bitmap');
    const img = await new Promise(function(res, rej) {
      const im = new Image();
      im.onload = function() { res(im); };
      im.onerror = rej;
      im.src = pg.dataUrl;
    });
    const cw = 48, ch = Math.max(8, Math.round(48 * sizePx[1] / sizePx[0]));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, cw, ch);
    const rx = Math.max(0, Math.min(cw - 1, Math.floor(region.x / sizePx[0] * cw)));
    const ry = Math.max(0, Math.min(ch - 1, Math.floor(region.y / sizePx[1] * ch)));
    const rw = Math.max(1, Math.min(cw - rx, Math.ceil(region.w / sizePx[0] * cw)));
    const rh = Math.max(1, Math.min(ch - ry, Math.ceil(region.h / sizePx[1] * ch)));
    const d = cx.getImageData(rx, ry, rw, rh).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 20) continue;
      sum += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      n++;
    }
    if (n) return sum / n;
  } catch (e) { /* fall through to the page's own background colour */ }
  return pdfedKadessaLuma(pg && pg.bgColor);
}

async function pdfedKadessaEnsureFont(fam) {
  if (!fam || fam.indexOf(',') !== -1) return;
  try {
    const isSystem = (typeof SARVARC_SYSTEM_FONTS !== 'undefined') && SARVARC_SYSTEM_FONTS.has(fam);
    const fresh = !isSystem && (typeof sarvarcLoadedFonts !== 'undefined') && !sarvarcLoadedFonts.has(fam);
    if (typeof sarvarcLoadFont === 'function') sarvarcLoadFont(fam);
    if (fresh) await new Promise(function(r) { setTimeout(r, 700); }); // let the stylesheet arrive
    if (document.fonts && document.fonts.load) {
      await Promise.race([document.fonts.load('16px "' + fam + '"'), new Promise(function(r) { setTimeout(r, 1500); })]);
    }
  } catch (e) { /* measuring with the fallback font is fine */ }
}

// Height a text box will really have, using the same font stack, wrapping,
// line height, border and padding the on-canvas box uses.
function pdfedKadessaMeasure(text, fam, size, bold, italic, boxW) {
  const inner = Math.max(10, boxW - 2 * (PDFED_PTXT_BORDER + PDFED_PTXT_PAD_X));
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;box-sizing:border-box;white-space:pre-wrap;word-break:break-word;line-height:1.25;';
  d.style.fontFamily = pdfedFontCss(fam);
  d.style.fontSize = size + 'px';
  d.style.fontWeight = bold ? '700' : '400';
  d.style.fontStyle = italic ? 'italic' : 'normal';
  d.style.width = inner + 'px';
  d.textContent = text;
  document.body.appendChild(d);
  const h = d.offsetHeight;
  document.body.removeChild(d);
  return h + 2 * (PDFED_PTXT_BORDER + PDFED_PTXT_PAD_Y);
}

// Tidies whatever the model sent. Bad blocks are skipped rather than thrown
// on, and long paragraphs are split at blank lines so a very long one can
// spill onto the next page instead of running off the bottom.
function pdfedKadessaCleanBlocks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach(function(b) {
    if (!b || typeof b !== 'object') return;
    const raw = (b.text === null || b.text === undefined) ? '' : String(b.text).replace(/\r/g, '');
    if (!raw.trim()) return;
    const type = ['heading', 'subheading', 'paragraph', 'item'].indexOf(b.type) !== -1 ? b.type : 'paragraph';
    const common = {
      type: type,
      price: b.price ? String(b.price).trim() : '',
      note: b.note ? String(b.note).trim() : '',
      align: ['left', 'center', 'right'].indexOf(b.align) !== -1 ? b.align : '',
      bold: !!b.bold, italic: !!b.italic, underline: !!b.underline,
      color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : ''
    };
    if (type === 'paragraph') {
      raw.split(/\n{2,}/).forEach(function(part) {
        if (part.trim()) out.push(Object.assign({}, common, { text: part.trim() }));
      });
    } else {
      out.push(Object.assign({}, common, { text: raw.trim() }));
    }
  });
  return out;
}

function pdfedKadessaDefaultRegion(W, H) {
  const x = Math.round(W * 0.085), y = Math.round(H * 0.07);
  return { x: x, y: y, w: W - 2 * x, h: Math.round(H * 0.93) - y };
}

function pdfedKadessaMakeGeo(p, W, H, region, color) {
  const ts = Number(p.text_scale);
  const scale = Math.max(0.4, Math.min(2.5, W / PDFED_KADESSA_BASE_PX)) * ((ts > 0) ? Math.max(0.5, Math.min(3, ts)) : 1);
  const okFont = function(f) { return (typeof f === 'string' && /^[\w \-'",]{2,60}$/.test(f.trim())) ? f.trim() : ''; };
  const body = okFont(p.body_font) || 'Inter';
  return {
    x: region.x, y: region.y, w: region.w, h: region.h,
    s: scale, color: color,
    headFont: okFont(p.heading_font) || body, bodyFont: body,
    align: ['left', 'center', 'right'].indexOf(p.default_align) !== -1 ? p.default_align : 'left',
    vAlign: p.v_align === 'middle' ? 'middle' : 'top'
  };
}

// Lays ONE block out at y and returns its boxes, where it ends, and the gap
// to leave after it. k is the shrink-to-fit factor (1 down to 0.7).
function pdfedKadessaLayoutBlock(b, g, k, y, isFirst) {
  const s = g.s * k;
  const fs = function(n) { return Math.max(6, Math.round(n * s * 10) / 10); };
  const color = b.color || g.color;
  const align = b.align || g.align;
  const base = function(over) {
    return Object.assign({
      text: '', x: g.x, y: y, w: g.w, fontSize: fs(13), fontFamily: g.bodyFont, color: color,
      bold: false, italic: !!b.italic, underline: !!b.underline, align: align, locked: false
    }, over);
  };
  const boxes = [];
  let top = y, bottom = y, gapAfter = 8 * s;

  if (b.type === 'heading' || b.type === 'subheading') {
    const isH = b.type === 'heading';
    top = y + (isFirst ? 0 : (isH ? 16 : 14) * s);
    const size = fs(isH ? 30 : 19);
    const h = pdfedKadessaMeasure(b.text, g.headFont, size, true, !!b.italic, g.w);
    boxes.push(base({ text: b.text, y: top, fontSize: size, fontFamily: g.headFont, bold: true }));
    bottom = top + h;
    gapAfter = (isH ? 10 : 6) * s;
  } else if (b.type === 'item') {
    const size = fs(13.5);
    const priceW = b.price ? Math.min(g.w * 0.3, 110 * s) : 0;
    const gap = b.price ? 12 * s : 0;
    const nameW = g.w - priceW - gap;
    let rowH = pdfedKadessaMeasure(b.text, g.bodyFont, size, !!b.bold, !!b.italic, nameW);
    boxes.push(base({ text: b.text, y: top, w: nameW, fontSize: size, bold: !!b.bold, align: 'left' }));
    if (b.price) {
      const ph = pdfedKadessaMeasure(b.price, g.bodyFont, size, true, false, priceW);
      boxes.push(base({ text: b.price, x: g.x + g.w - priceW, y: top, w: priceW, fontSize: size, bold: true, italic: false, underline: false, align: 'right' }));
      rowH = Math.max(rowH, ph);
    }
    bottom = top + rowH;
    if (b.note) {
      const nsize = fs(11.5);
      const noteH = pdfedKadessaMeasure(b.note, g.bodyFont, nsize, false, true, nameW);
      const ny = bottom - 2 * s;
      boxes.push(base({ text: b.note, y: ny, w: nameW, fontSize: nsize, italic: true, underline: false, align: 'left', opacity: 0.72 }));
      bottom = ny + noteH;
    }
    gapAfter = 7 * s;
  } else {
    const size = fs(13);
    const h = pdfedKadessaMeasure(b.text, g.bodyFont, size, !!b.bold, !!b.italic, g.w);
    boxes.push(base({ text: b.text, fontSize: size, bold: !!b.bold }));
    bottom = top + h;
    gapAfter = 9 * s;
  }
  return { boxes: boxes, bottom: bottom, gapAfter: gapAfter };
}

// One full top-to-bottom pass at shrink factor k, starting at block
// startIdx. Always places at least one block, so a caller looping on
// nextIdx is guaranteed to make progress.
function pdfedKadessaPass(blocks, g, k, startIdx, bottomLimit) {
  const placed = [];
  let y = g.y, i = startIdx;
  for (; i < blocks.length; i++) {
    const r = pdfedKadessaLayoutBlock(blocks[i], g, k, y, i === startIdx);
    if (r.bottom > bottomLimit && placed.length) break;
    placed.push({ idx: i, type: blocks[i].type, boxes: r.boxes, bottom: r.bottom });
    y = r.bottom + r.gapAfter;
  }
  // Never leave a heading stranded alone at the bottom of a page.
  while (i < blocks.length && placed.length > 1 &&
         (placed[placed.length - 1].type === 'heading' || placed[placed.length - 1].type === 'subheading')) {
    i = placed.pop().idx;
  }
  return { placed: placed, nextIdx: i, usedBottom: placed.length ? placed[placed.length - 1].bottom : g.y };
}

// Places as many blocks as fit onto pg, shrinking type a little first, and
// returns the index of the first block that did NOT fit (blocks.length when
// everything fit) plus the text boxes it added.
async function pdfedKadessaPlaceBlocks(pg, blocks, g, startIdx) {
  await pdfedKadessaEnsureFont(g.headFont);
  if (g.bodyFont !== g.headFont) await pdfedKadessaEnsureFont(g.bodyFont);
  const bottomLimit = g.y + g.h;
  let best = null;
  for (let step = 0; step <= 6; step++) {
    best = pdfedKadessaPass(blocks, g, 1 - step * 0.05, startIdx, bottomLimit);
    if (best.nextIdx >= blocks.length) break;
  }
  let dy = 0;
  if (g.vAlign === 'middle' && best.nextIdx >= blocks.length && best.usedBottom < bottomLimit) {
    dy = (bottomLimit - best.usedBottom) / 2;
  }
  if (!pg.placedTexts) pg.placedTexts = [];
  const added = [];
  best.placed.forEach(function(pb) {
    pb.boxes.forEach(function(bx) {
      const item = Object.assign({ id: 'ptxt_' + (++pdfedPlacedTextSeq), zIndex: pdfedNextZ(pg) }, bx);
      item.x = Math.round(item.x * 10) / 10;
      item.y = Math.round((item.y + dy) * 10) / 10;
      item.w = Math.round(item.w * 10) / 10;
      pg.placedTexts.push(item);
      added.push(item);
    });
  });
  return { nextIdx: best.nextIdx, added: added };
}

async function pdfedKadessaInsertPage(p) {
  const [mmW, mmH] = pdfedKadessaResolveInsertMM(p);
  const bg = /^#[0-9a-fA-F]{6}$/.test(p.bg_color || '') ? p.bg_color : '#ffffff';
  const blocks = pdfedKadessaCleanBlocks(p.content);
  const isNewDoc = !pdfed.pages.length;

  // Resolve where the new page lands: an explicit 0-based after_idx inserts
  // the page right AFTER that index (after_idx 0 = "between page 1 and 2"),
  // 'end' appends, and omitting both falls back to right after whichever
  // page is currently open, the same default the ribbon's own hover
  // insert-zone uses.
  let at;
  if (isNewDoc || p.position === 'end') {
    at = pdfed.pages.length;
  } else if (p.after_idx !== undefined && p.after_idx !== null && p.after_idx !== '') {
    const idx = Math.max(-1, Math.min(pdfed.pages.length - 1, parseInt(p.after_idx, 10)));
    at = idx + 1;
  } else {
    at = (pdfed.active >= 0 ? pdfed.active : pdfed.pages.length - 1) + 1;
  }

  // The bitmap is now just the empty page (background colour only). All
  // words go on top as editable text boxes.
  const url = await pdfedRenderBlankPage('', bg, mmW, mmH);
  const mkPage = function() {
    return { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [], label: 'New Page', bgColor: bg, pageMM: [mmW, mmH] };
  };
  const W = Math.max(1, Math.round(mmW * 3.7795)), H = Math.max(1, Math.round(mmH * 3.7795));
  const textColor = /^#[0-9a-fA-F]{6}$/.test(p.text_color || '') ? p.text_color : (pdfedKadessaLuma(bg) > 140 ? '#111111' : '#F5F5F5');
  const geo = pdfedKadessaMakeGeo(p, W, H, pdfedKadessaDefaultRegion(W, H), textColor);

  // If content was actually given but none of it survived cleaning (wrong
  // block shape, missing/blank `text`, not an array of objects, etc.), that
  // is NOT the same thing as "omit content for a genuinely blank page" --
  // silently falling through to mkPage() here is exactly what produced an
  // empty page with no signal to Kadessa (or the person) that her content
  // never landed. Throw instead, so she sees a real tool error and can fix
  // the block shape / retry, the same protection kadessaInsertProposalFromDetails
  // already has for the proposal path.
  // An explicit empty array (content: []) now means "content was sent but
  // nothing in it survived cleaning" (see the matching Worker-side fix to
  // sanitizeToolParams' pdfed_insert_page case, which stopped deleting the
  // key when cleanTextBlocks strips it to []). Only a genuinely ABSENT key
  // means "no content was ever sent" -- that's the only case still treated
  // as an intentional blank page.
  const contentAttempted = p.content !== undefined && p.content !== null;
  if (contentAttempted && !blocks.length) {
    const shapeNote = !Array.isArray(p.content) ? (' -- content must be an array of blocks, not a ' + (typeof p.content)) : '';
    throw new Error('content was given but none of it had a usable "text" field -- each block needs {type, text}; nothing was placed' + shapeNote);
  }

  const newPages = [];
  let blocksPlaced = 0;
  if (!blocks.length) {
    newPages.push(mkPage());
  } else {
    let next = 0;
    do {
      const pgN = mkPage();
      const r = await pdfedKadessaPlaceBlocks(pgN, blocks, geo, next);
      blocksPlaced += r.added.length ? (r.nextIdx - next) : 0;
      next = r.nextIdx;
      newPages.push(pgN);
    } while (next < blocks.length && newPages.length < 1 + PDFED_KADESSA_MAX_EXTRA_PAGES);
  }
  pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(newPages));

  if (isNewDoc) {
    // No document was open, bring up the editor chrome the same way
    // confirmInsertPage()'s isNewDoc branch (and opening a PDF) does.
    pdfed.pdfDoc = null;
    pdfed.file = { name: 'Untitled Document' };
    ['pdfedExportBtn','pdfedRefineBtn','pdfedExportBtn2','pdfedCloseBtn','pdfedPageInfoPill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
    document.getElementById('pdfedPlaceholder').style.display = 'none';
    document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
    state.stats.pdfs++;
  }

  document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
  state.stats.pages += newPages.length;
  updateStats();
  await pdfedBuildStrip();
  await pdfedGoto(at);
  if (isNewDoc) { setTimeout(pdfedZoomFit, 50); pdfedScheduleAutoCollapse(); }
  if (newPages.length > 1) toast('That text ran long, so it continues on ' + (newPages.length - 1) + ' more page' + (newPages.length - 1 === 1 ? '' : 's'), 'info');

  pushAppHistory({
    label: 'Insert page (Kadessa)',
    undo: async () => {
      if (pdfed.pages.length <= newPages.length) { toast('Cannot remove last page', 'error'); return; }
      pdfed.pages.splice(at, newPages.length);
      if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
      await pdfedBuildStrip();
      await pdfedGoto(pdfed.active);
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
      toast('Inserted page removed', 'info');
    },
    redo: async () => {
      pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(newPages));
      await pdfedBuildStrip();
      await pdfedGoto(at);
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
      toast('Page inserted at position ' + (at + 1), 'success');
    }
  });

  return { at, mmW, mmH, pagesAdded: newPages.length, blocksReceived: blocks.length, blocksPlaced: blocksPlaced };
}

// Places editable text on a page that ALREADY exists (typically one the
// person designed). p.region is in percent of the page (x_pct, y_pct, w_pct,
// h_pct): Kadessa reads it off the screenshot. With no region, the text goes
// below whatever is already on the page. Text colour is sampled from the
// page behind the region unless Kadessa passes text_color.
async function pdfedKadessaAddTextToPage(p) {
  const { pg, idx } = pdfedKadessaActivePage(p);
  const blocks = pdfedKadessaCleanBlocks(p.blocks);
  if (!blocks.length) throw new Error('there was no text to place');
  const sz = pdfedKadessaPageSizePx(pg, idx);
  const W = sz[0], H = sz[1];

  const r = p.region || {};
  const has = function(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); };
  const pct = function(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v))); };
  let region;
  if (has(r.x_pct) && has(r.y_pct) && has(r.w_pct) && has(r.h_pct)) {
    const x = W * pct(r.x_pct, 0, 95) / 100, y = H * pct(r.y_pct, 0, 95) / 100;
    region = { x: x, y: y, w: Math.min(W * pct(r.w_pct, 5, 100) / 100, W - x), h: Math.min(H * pct(r.h_pct, 5, 100) / 100, H - y) };
  } else {
    const d = pdfedKadessaDefaultRegion(W, H);
    const low = pdfedKadessaContentBottomPx(pg, idx);
    const y = low ? Math.min(H * 0.9, low + H * 0.03) : d.y;
    region = { x: d.x, y: y, w: d.w, h: Math.max(H * 0.08, Math.round(H * 0.93) - y) };
  }

  let color = /^#[0-9a-fA-F]{6}$/.test(p.text_color || '') ? p.text_color : null;
  if (!color) color = (await pdfedKadessaBackdropLuma(pg, region, sz)) > 140 ? '#111111' : '#F5F5F5';

  const geo = pdfedKadessaMakeGeo(p, W, H, region, color);
  const first = await pdfedKadessaPlaceBlocks(pg, blocks, geo, 0);
  const added = first.added.slice();
  let next = first.nextIdx;

  // Anything that did not fit continues on plain pages right after this one.
  const extraPages = [];
  if (next < blocks.length) {
    const mm = pg.pageMM || [W / 3.7795, H / 3.7795];
    const bg = pg.bgColor || '#ffffff';
    const url = await pdfedRenderBlankPage('', bg, mm[0], mm[1]);
    const contColor = /^#[0-9a-fA-F]{6}$/.test(p.text_color || '') ? p.text_color : (pdfedKadessaLuma(bg) > 140 ? '#111111' : '#F5F5F5');
    const contGeo = pdfedKadessaMakeGeo(p, W, H, pdfedKadessaDefaultRegion(W, H), contColor);
    while (next < blocks.length && extraPages.length < PDFED_KADESSA_MAX_EXTRA_PAGES) {
      const pgN = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [], label: 'New Page', bgColor: bg, pageMM: [mm[0], mm[1]] };
      const rr = await pdfedKadessaPlaceBlocks(pgN, blocks, contGeo, next);
      next = rr.nextIdx;
      extraPages.push(pgN);
    }
  }

  pdfedMarkModified(idx);
  if (extraPages.length) {
    pdfed.pages.splice.apply(pdfed.pages, [idx + 1, 0].concat(extraPages));
    document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
    state.stats.pages += extraPages.length;
    updateStats();
    await pdfedBuildStrip();
    await pdfedGoto(idx);
    toast('That text was more than fit here, so it continues on ' + extraPages.length + ' more page' + (extraPages.length === 1 ? '' : 's'), 'info');
  } else if (pdfed.active === idx) {
    pdfedRenderPlacedTexts(idx);
  }

  pushAppHistory({
    label: 'Place text (Kadessa)',
    undo: async () => {
      added.forEach(function(it) {
        const i = pg.placedTexts.indexOf(it);
        if (i > -1) pg.placedTexts.splice(i, 1);
      });
      extraPages.forEach(function(ep) {
        const i = pdfed.pages.indexOf(ep);
        if (i > -1) pdfed.pages.splice(i, 1);
      });
      pdfedMarkModified(idx);
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
      await pdfedBuildStrip();
      await pdfedGoto(Math.min(idx, pdfed.pages.length - 1));
      toast('Text placement undone', 'info');
    },
    redo: async () => {
      added.forEach(function(it) { if (pg.placedTexts.indexOf(it) === -1) pg.placedTexts.push(it); });
      if (extraPages.length) pdfed.pages.splice.apply(pdfed.pages, [idx + 1, 0].concat(extraPages));
      pdfedMarkModified(idx);
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
      await pdfedBuildStrip();
      await pdfedGoto(idx);
    }
  });

  return { placed: added.length, extraPages: extraPages.length };
}

// ─── KADESSA: CONTENT-AWARE TABLE (auto-sized so nothing gets clipped) ──────
// Mirrors pdfedInsertTable's item shape exactly (same id/x/y/rows/cols/
// colWidths/rowHeights/fontSize/headerRow/cells fields), so a Kadessa-built
// table is a completely normal pg.placedTables entry -- draggable,
// resizable, editable, exported, everything the manual Insert Table tool
// already does. The only difference is HOW colWidths/rowHeights are
// chosen: the manual tool picks a fixed 60-140px column and a flat 30px
// row for every table regardless of content, which is exactly what lets
// long cell text get visually clipped (.pdfed-table-cell is
// overflow:hidden). Kadessa instead measures the real text with the real
// font before ever creating the table, so no cell is ever shorter than
// its own content needs.

const PDFED_TABLE_CELL_PAD_X = 7;   // matches .pdfed-table-cell CSS padding: 3px 7px
const PDFED_TABLE_CELL_PAD_Y = 3;
const PDFED_TABLE_CELL_BORDER = 1;  // matches .pdfed-table-cell CSS border: 1px solid
const PDFED_TABLE_MIN_COL_W = 44;   // never go narrower than this, even under heavy squeeze
const PDFED_TABLE_MIN_ROW_H = 24;

// Natural single-line width of `text` in the given font -- how wide the
// column would need to be for this one cell to show on one line with no
// wrap at all. Used as the column's "ideal" width before any squeezing.
function pdfedKadessaMeasureTextWidth(text, fam, size, bold) {
  const span = document.createElement('span');
  span.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;';
  span.style.fontFamily = pdfedFontCss(fam);
  span.style.fontSize = size + 'px';
  span.style.fontWeight = bold ? '700' : '400';
  span.textContent = text || '';
  document.body.appendChild(span);
  const w = span.offsetWidth;
  document.body.removeChild(span);
  return w;
}

// Widest SINGLE WORD in `text` -- the true floor a column can shrink to
// before word-break:break-word starts chopping a word across lines. Used
// so proportional squeezing below never makes a column narrower than its
// own longest word if it can possibly help it.
function pdfedKadessaMeasureWordWidth(text, fam, size, bold) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let max = 0;
  words.forEach(function(w) { max = Math.max(max, pdfedKadessaMeasureTextWidth(w, fam, size, bold)); });
  return max;
}

// Wrapped height a cell will really render at for the given column width --
// same font stack, padding, border, white-space/word-break rules as the
// live .pdfed-table-cell (see pdfedRenderPlacedTables), so this is not an
// estimate, it's the same layout the browser will actually produce.
function pdfedKadessaMeasureTableCellHeight(text, fam, size, bold, colW) {
  const inner = Math.max(10, colW - 2 * (PDFED_TABLE_CELL_BORDER + PDFED_TABLE_CELL_PAD_X));
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;box-sizing:border-box;white-space:pre-wrap;word-break:break-word;line-height:1.3;';
  d.style.fontFamily = pdfedFontCss(fam);
  d.style.fontSize = size + 'px';
  d.style.fontWeight = bold ? '700' : '400';
  d.style.width = inner + 'px';
  d.textContent = text || '';
  document.body.appendChild(d);
  const h = d.offsetHeight;
  document.body.removeChild(d);
  return h + 2 * (PDFED_TABLE_CELL_BORDER + PDFED_TABLE_CELL_PAD_Y);
}

// The core sizing decision. cells is the full grid INCLUDING the header
// row (cells[0]). Returns {colWidths, rowHeights} such that:
//   - if everything fits within availW with no wrapping, every column
//     gets its own natural (no-wrap) width, plus a proportional share of
//     any leftover space -- same "auto-fit" feel as Excel/Word.
//   - if it doesn't fit, columns are squeezed proportionally but never
//     below their own widest-single-word width while any column still has
//     slack to give, so cells wrap onto more lines instead of characters
//     getting chopped off.
//   - row heights are then derived from the FINAL column widths by
//     actually measuring wrapped height, so a tall-wrapping cell always
//     gets a tall-enough row -- this is what actually prevents the
//     clipping the fixed-30px manual tool is prone to.
function pdfedKadessaComputeTableLayout(cells, fam, size, bold, availW) {
  const cols = cells[0].length;
  const rows = cells.length;

  const natural = new Array(cols).fill(0);
  const wordMin = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const isHead = r === 0;
      const txt = (cells[r][c] || '');
      const w = pdfedKadessaMeasureTextWidth(txt, fam, size, bold || isHead) + 2 * (PDFED_TABLE_CELL_BORDER + PDFED_TABLE_CELL_PAD_X);
      const wm = pdfedKadessaMeasureWordWidth(txt, fam, size, bold || isHead) + 2 * (PDFED_TABLE_CELL_BORDER + PDFED_TABLE_CELL_PAD_X);
      if (w > natural[c]) natural[c] = w;
      if (wm > wordMin[c]) wordMin[c] = wm;
    }
    natural[c] = Math.max(natural[c], PDFED_TABLE_MIN_COL_W);
    wordMin[c] = Math.max(Math.min(wordMin[c], natural[c]), PDFED_TABLE_MIN_COL_W);
  }

  const totalNatural = natural.reduce((a, b) => a + b, 0);
  let colWidths;
  if (totalNatural <= availW) {
    const extra = availW - totalNatural;
    colWidths = natural.map(function(w) { return w + (extra * (w / totalNatural)); });
  } else {
    const flexible = natural.map(function(w, c) { return w - wordMin[c]; });
    const totalFlexible = flexible.reduce((a, b) => a + b, 0);
    let deficit = totalNatural - availW;
    if (totalFlexible >= deficit) {
      colWidths = natural.map(function(w, c) { return w - flexible[c] * (deficit / totalFlexible); });
    } else {
      // Even removing all flexible width isn't enough -- fall back to
      // squeezing wordMin itself proportionally (rare: a page far
      // narrower than the shortest possible rendering of the content).
      deficit -= totalFlexible;
      const totalWordMin = wordMin.reduce((a, b) => a + b, 0) || 1;
      colWidths = wordMin.map(function(w) {
        return Math.max(PDFED_TABLE_MIN_COL_W, w - w * (deficit / totalWordMin));
      });
    }
  }
  colWidths = colWidths.map(function(w) { return Math.round(w); });

  const rowHeights = [];
  for (let r = 0; r < rows; r++) {
    let maxH = PDFED_TABLE_MIN_ROW_H;
    for (let c = 0; c < cols; c++) {
      const isHead = r === 0;
      const h = pdfedKadessaMeasureTableCellHeight(cells[r][c] || '', fam, size, bold || isHead, colWidths[c]);
      if (h > maxH) maxH = h;
    }
    rowHeights.push(Math.round(maxH));
  }

  return { colWidths, rowHeights };
}

// ── Kadessa hook: pdfed_create_table ───────────────────────────────────────
// Builds a brand-new, fully professional table on the editor canvas from
// headers + row data Kadessa has already worked out from the conversation --
// the editor-canvas counterpart to da_create_table (Data Arrangement).
// Column widths and row heights are computed from the ACTUAL text (see
// pdfedKadessaComputeTableLayout above) rather than a fixed grid size, so
// nothing here ever gets visually truncated the way a manually-inserted
// table can once its content outgrows the default 60-140px column / 30px
// row. Shape-matches pg.placedTables exactly (see pdfedInsertTable), so
// it's indistinguishable from a manually-built table afterwards --
// draggable, resizable, lockable, exportable, all of it.
async function pdfedKadessaCreateTable(p) {
  p = p || {};
  const { pg, idx } = pdfedKadessaActivePage(p);

  const headers = Array.isArray(p.headers) ? p.headers.map(function(h) { return String(h == null ? '' : h).trim(); }) : [];
  if (!headers.length) throw new Error('at least one column header is needed to create a table');
  const cols = headers.length;

  const rawRows = Array.isArray(p.rows) ? p.rows : [];
  const rows = rawRows.map(function(row) {
    const arr = Array.isArray(row) ? row : [];
    const out = [];
    for (let c = 0; c < cols; c++) out.push(arr[c] == null ? '' : String(arr[c]));
    return out;
  });
  if (!rows.length) rows.push(new Array(cols).fill('')); // one blank row so the table isn't just a header bar

  const cells = [headers].concat(rows);

  const sz = pdfedKadessaPageSizePx(pg, idx);
  const W = sz[0];
  const fam = (typeof p.font_family === 'string' && /^[\w \-'",]{2,60}$/.test(p.font_family.trim())) ? p.font_family.trim() : 'Inter';
  const fontSize = Math.max(8, Math.min(28, parseInt(p.font_size, 10) || 12));
  await pdfedKadessaEnsureFont(fam);

  const r = p.region || {};
  const has = function(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); };
  const d = pdfedKadessaDefaultRegion(W, sz[1]);
  let x = d.x, availW = d.w;
  if (has(r.x_pct) && has(r.w_pct)) {
    x = W * Math.max(0, Math.min(95, Number(r.x_pct))) / 100;
    availW = Math.min(W * Math.max(5, Math.min(100, Number(r.w_pct))) / 100, W - x);
  }
  let y = d.y;
  if (has(r.y_pct)) {
    y = sz[1] * Math.max(0, Math.min(95, Number(r.y_pct))) / 100;
  } else {
    const low = pdfedKadessaContentBottomPx(pg, idx);
    if (low) y = Math.min(sz[1] * 0.9, low + sz[1] * 0.03);
  }

  const layout = pdfedKadessaComputeTableLayout(cells, fam, fontSize, false, availW);

  if (!pg.placedTables) pg.placedTables = [];
  const item = {
    id: 'tbl_' + (++pdfedTableSeq),
    x: Math.round(x), y: Math.round(y),
    rows: cells.length, cols: cols,
    colWidths: layout.colWidths,
    rowHeights: layout.rowHeights,
    fontSize: fontSize,
    fontFamily: fam,
    headerRow: true,
    cells: cells,
    locked: false,
    zIndex: pdfedNextZ(pg),
  };
  pg.placedTables.push(item);
  pdfedMarkModified(idx);
  if (pdfed.active === idx) pdfedRenderPlacedTables(idx);
  toast(cells.length + ' x ' + cols + ' table created, sized to fit its own content', 'success');

  pushKadessaAppHistory({
    label: 'Create table (Kadessa)',
    undo: () => {
      const i = pg.placedTables.indexOf(item);
      if (i > -1) pg.placedTables.splice(i, 1);
      pdfedMarkModified(idx);
      if (pdfed.active === idx) pdfedRenderPlacedTables(idx);
      toast('Table removed', 'info');
    },
    redo: () => {
      if (pg.placedTables.indexOf(item) === -1) pg.placedTables.push(item);
      pdfedMarkModified(idx);
      if (pdfed.active === idx) pdfedRenderPlacedTables(idx);
    }
  });

  return { rows: item.rows, cols: item.cols, page: idx + 1, colWidths: item.colWidths, rowHeights: item.rowHeights };
}

// ─── KADESSA: CANVAS FILL / GRADIENT (programmatic, no panel needed) ───────
// Drives the exact same Canvas Color engine the Design panel's Solid/
// Gradient controls use (pdfedCanvasTintState + pdfedApplyCanvasTint), so a
// gradient Kadessa applies bakes into the page pixels identically to one built
// by hand -- same angle math (pdfedGradientLine), same opacity blend, same
// one-level "Remove Tint" safety net via pg.edits.preTintDataUrl.
function pdfedKadessaValidHex(v, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback;
}

// Merges a page-style object `p` (mode/color1/color2/angle/opacity, any of
// which may be missing) on top of a `base` style, filling gaps from base.
// Used both for the base style itself (merged onto pdfedCanvasTintState)
// and for each page_overrides entry (merged onto the resolved base).
function pdfedKadessaMergeCanvasStyle(base, p) {
  p = p || {};
  const mode = p.mode === 'solid' || p.mode === 'gradient' ? p.mode : base.mode;
  const color1 = pdfedKadessaValidHex(p.color1, base.color1);
  const color2 = mode === 'gradient' ? pdfedKadessaValidHex(p.color2, base.color2) : color1;
  let angle = base.angle;
  if (p.angle !== undefined && p.angle !== null && p.angle !== '') {
    angle = Math.max(0, Math.min(360, parseInt(p.angle, 10) || 0));
  }
  let opacity = base.opacity;
  if (p.opacity !== undefined && p.opacity !== null && p.opacity !== '') {
    opacity = Math.max(0, Math.min(100, parseInt(p.opacity, 10) || 0));
  }
  return { mode, color1, color2, angle, opacity, imageDataUrl: null, imageFit: base.imageFit };
}

// pages/page_overrides let Kadessa bake a gradient across the whole document
// in one call, including a different colour/gradient on specific pages:
//   pages: 'all' | 'current' (default) | [1, 3, 5]  -- 1-based page numbers
//   page_overrides: [{ page: 2, color1, color2, mode?, angle?, opacity? }, ...]
// Every page named in `pages` gets the base style; every page named in
// page_overrides gets the base style with just that entry's fields swapped
// in (so "gradient everywhere, but page 3 is solid red" only needs color1
// on page 3's override). A page mentioned only in page_overrides is baked
// too, even if it wasn't in `pages`.
async function pdfedKadessaSetCanvasFill(p) {
  if (!pdfed.pages.length) throw new Error('open a document first');
  p = p || {};

  // Resolve the base style once (this also updates pdfedCanvasTintState so
  // the panel's own swatches/sliders reflect it, same as before).
  const base = pdfedKadessaMergeCanvasStyle(pdfedCanvasTintState, p);
  Object.assign(pdfedCanvasTintState, { mode: base.mode, color1: base.color1, color2: base.color2, angle: base.angle, opacity: base.opacity });
  if (typeof pdfedCanvasSyncControls === 'function') pdfedCanvasSyncControls();

  // Work out which 1-based page numbers get the base style.
  const total = pdfed.pages.length;
  let basePages;
  if (p.pages === 'all') {
    basePages = Array.from({ length: total }, (_, i) => i + 1);
  } else if (Array.isArray(p.pages) && p.pages.length) {
    basePages = p.pages.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= total);
  } else {
    basePages = [(pdfed.active < 0 ? 0 : pdfed.active) + 1];
  }

  // Per-page overrides, keyed by page number so a page named in both
  // `pages` and `page_overrides` only bakes once, with the override style.
  const overrides = new Map();
  if (Array.isArray(p.page_overrides)) {
    for (const ov of p.page_overrides) {
      const num = ov && parseInt(ov.page, 10);
      if (!num || num < 1 || num > total) continue;
      overrides.set(num, pdfedKadessaMergeCanvasStyle(base, ov));
    }
  }

  const targetPages = new Set(basePages);
  for (const num of overrides.keys()) targetPages.add(num);
  if (!targetPages.size) throw new Error('no valid page numbers to apply this to');

  for (const num of targetPages) {
    const style = overrides.get(num) || base;
    await pdfedBakeCanvasTintOntoPage(pdfed.pages[num - 1], style);
  }

  const live = pdfedCanvasTintPreviewEl();
  if (live) live.style.display = 'none';

  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  return { pagesFilled: targetPages.size };
}
