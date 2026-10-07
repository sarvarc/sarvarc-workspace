// ─── ANNOTATION ENGINE ────────────────────────────────────────────────────────

const pdfedAnnotState = {
  tool: null,       // 'highlight'|'draw'|'eraser'|'arrow'|'rect'|'circle'|'redact'|'addtext'
  color: '#FFD600',
  colorTouched: false, // becomes true the moment the person actually picks a color —
                       // lets Add Text fall back to a readable default (not the
                       // draw tool's yellow) until they've deliberately chosen one
  size: 4,          // stroke width, for draw/highlight/shapes
  textSize: 20,     // font size for Add Text, kept separate from stroke width,
                     // since "how thick is my pen" and "how big is my text" are
                     // two different questions that shouldn't share one control
  opacity: 1.0,     // 0.1–1.0
  // Running bounding box of the current stroke, reset on mousedown, grown
  // on every mousemove. Used by Smart Highlight to know the full extent of
  // a (possibly wiggly) freehand stroke, not just its start/end point.
  minX: 0, minY: 0, maxX: 0, maxY: 0,
  drawing: false,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,
  // NOTE: strokes/redoStrokes used to live here keyed by array index (pageIdx),
  // which silently desynced from the actual pages the moment you inserted,
  // deleted, duplicated, or reordered a page, the classic "edit shows up on
  // the wrong page" bug. They now live on the page object itself, same as
  // placedImages/placedTexts below, via pdfedStrokesFor()/pdfedRedoStrokesFor().
  imgInsert: null,  // { dataUrl, x, y, w, h }
  imgInsertActive: false,
  imgGhostDrag: null,
  imgGhostResize: null,
  // NOTE: stamped/placed images are now stored per-page on pdfed.pages[i].placedImages
  // (not here) so they automatically travel with the page through reorder/delete/insert/merge.
  placedImgSeq: 0,
};

// ── Per-page annotation stroke (undo/redo) history ──────────────────────────
// Stored ON the page object (pg.annotStrokes / pg.annotRedoStrokes) — the same
// pattern already used for placedImages/placedTexts, so draw/highlight/shape/
// redact history automatically travels with the page through insert, delete,
// duplicate, and drag-reorder instead of going stale in an index-keyed table.
function pdfedStrokesFor(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return [];
  if (!pg.annotStrokes) pg.annotStrokes = [];
  return pg.annotStrokes;
}
function pdfedRedoStrokesFor(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return [];
  if (!pg.annotRedoStrokes) pg.annotRedoStrokes = [];
  return pg.annotRedoStrokes;
}
function pdfedClearStrokesFor(idx) {
  const pg = pdfed.pages[idx];
  if (pg) pg.annotStrokes = [];
}
function pdfedClearRedoStrokesFor(idx) {
  const pg = pdfed.pages[idx];
  if (pg) pg.annotRedoStrokes = [];
}
// Parallel timestamp arrays (kept alongside, never read by anything else that
// touches annotStrokes/annotRedoStrokes) so the unified Ctrl+Z router can
// compare "when did this page's stroke history last change" against every
// other undo source (global actions, module snapshots, Style Specific Text)
// and always undo whichever one is truly most recent — see unifiedUndo().
function pdfedStrokeTimesFor(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return [];
  if (!pg._annotStrokeTimes) pg._annotStrokeTimes = [];
  return pg._annotStrokeTimes;
}
function pdfedRedoStrokeTimesFor(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return [];
  if (!pg._annotRedoStrokeTimes) pg._annotRedoStrokeTimes = [];
  return pg._annotRedoStrokeTimes;
}

// Returns the annotation canvas (always sized to match page canvas)
function pdfedGetAnnotCanvas() {
  const pg = document.getElementById('pdfedPageCanvas');
  const ac = document.getElementById('pdfedAnnotCanvas');
  if (ac.width !== pg.width || ac.height !== pg.height) {
    ac.width = pg.width;
    ac.height = pg.height;
  }
  return ac;
}

// ── Hand (pan) tool ──────────────────────────────────────────────────────
const pdfedHandState = { active: true, dragging: false, startX: 0, startY: 0, startScrollL: 0, startScrollT: 0 };

function pdfedActivateHand() {
  // turn off whatever annotation tool is currently selected, without re-triggering this function
  if (typeof pdfedAnnotState !== 'undefined' && pdfedAnnotState.tool) {
    document.querySelectorAll('.pdfed-rbn-btn.annot-active').forEach(b => { if (b.id !== 'pdfedHandBtn') b.classList.remove('annot-active'); });
    const wrap = document.getElementById('pdfedCanvasWrap');
    if (wrap) wrap.className = wrap.className.replace(/annot-mode-\w+/g, '').trim();
    pdfedAnnotState.tool = null;
  }
  if (typeof pdfedTHL !== 'undefined' && pdfedTHL.active) {
    pdfedTHL.active = false;
    if (typeof pdfedHlDeactivate === 'function') pdfedHlDeactivate();
    const hlBtn = document.getElementById('pdfedTextHlBtn');
    if (hlBtn) hlBtn.classList.remove('annot-active');
    const hlPanel = document.getElementById('pdfedHlSidePanel');
    if (hlPanel) hlPanel.style.display = 'none';
  }
  if (typeof pdfed !== 'undefined' && pdfed.cropActive) {
    pdfed.cropActive = false;
    pdfed.cDrag = false; pdfed.cResize = false;
    const box = document.getElementById('pdfedCropBox');
    if (box) box.classList.remove('active');
    const cropBtn = document.getElementById('pdfedCropBtn');
    if (cropBtn) cropBtn.classList.remove('active');
    const ab = document.getElementById('pdfedApplyCropBtn');
    if (ab) ab.style.display = 'none';
    const cb = document.getElementById('pdfedCancelCropBtn');
    if (cb) cb.style.display = 'none';
  }

  pdfedHandState.active = true;
  const handBtn = document.getElementById('pdfedHandBtn');
  if (handBtn) handBtn.classList.add('annot-active');
  const scrollEl = document.getElementById('pdfedCanvasScroll');
  if (scrollEl) scrollEl.classList.add('pdfed-hand-mode');
}

function pdfedDeactivateHand() {
  pdfedHandState.active = false;
  const handBtn = document.getElementById('pdfedHandBtn');
  if (handBtn) handBtn.classList.remove('annot-active');
  const scrollEl = document.getElementById('pdfedCanvasScroll');
  if (scrollEl) { scrollEl.classList.remove('pdfed-hand-mode'); scrollEl.classList.remove('pdfed-panning'); }
}

(function pdfedInitHandPan() {
  document.addEventListener('DOMContentLoaded', function () {
    const scrollEl = document.getElementById('pdfedCanvasScroll');
    if (!scrollEl) return;

    scrollEl.addEventListener('mousedown', function (e) {
      if (!pdfedHandState.active) return;
      if (e.button !== 0) return;
      // don't hijack clicks on interactive child elements (text boxes, handles, etc.)
      if (e.target.closest('.pdfed-crop-handle, .pdfed-crop-box, [contenteditable="true"], button, input, select, textarea')) return;
      // Clicking empty canvas space while a text box is being edited must
      // still blur that box (which deselects it and auto-saves the edit —
      // see the 'blur' listener in teAddBlock). Without this, the
      // e.preventDefault() below blocks the browser's normal focus-change
      // behavior, so the box never actually loses focus and stays visibly
      // "selected" even though the click landed outside it.
      if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('pdfed-text-block')) {
        document.activeElement.blur();
      }
      pdfedHandState.dragging = true;
      pdfedHandState.startX = e.clientX;
      pdfedHandState.startY = e.clientY;
      pdfedHandState.startScrollL = scrollEl.scrollLeft;
      pdfedHandState.startScrollT = scrollEl.scrollTop;
      scrollEl.classList.add('pdfed-panning');
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!pdfedHandState.dragging) return;
      scrollEl.scrollLeft = pdfedHandState.startScrollL - (e.clientX - pdfedHandState.startX);
      scrollEl.scrollTop  = pdfedHandState.startScrollT - (e.clientY - pdfedHandState.startY);
    });

    window.addEventListener('mouseup', function () {
      if (!pdfedHandState.dragging) return;
      pdfedHandState.dragging = false;
      scrollEl.classList.remove('pdfed-panning');
    });

    // Hand tool active by default
    scrollEl.classList.add('pdfed-hand-mode');
  });
})();

function pdfedSetAnnotTool(tool) {
  // Nothing to add text (or annotate anything) onto yet, say so up front
  // instead of letting the person click into crosshair mode for nothing.
  if (tool && pdfed.active < 0) {
    toast('Open a PDF or start a blank page first', 'info');
    return;
  }
  // If text-hl is active and user picks another tool, turn it off
  if (typeof pdfedTHL !== "undefined" && pdfedTHL.active && tool !== null) {
    pdfedTHL.active = false;
    pdfedTHL.dragging = false;
    if (typeof pdfedHlDeactivate === "function") pdfedHlDeactivate();
    var hlBtn = document.getElementById("pdfedTextHlBtn");
    if (hlBtn) hlBtn.classList.remove("annot-active");
    var hlPanel = document.getElementById("pdfedHlSidePanel");
    if (hlPanel) hlPanel.style.display = 'none';
  }
  // deactivate old
  document.querySelectorAll('.pdfed-rbn-btn.annot-active').forEach(b => b.classList.remove('annot-active'));
  const wrap = document.getElementById('pdfedCanvasWrap');
  wrap.className = wrap.className.replace(/annot-mode-\w+/g, '').trim();

  if (pdfedAnnotState.tool === tool) {
    // toggle off
    pdfedAnnotState.tool = null;
    pdfedActivateHand();
    return;
  }
  pdfedAnnotState.tool = tool;
  pdfedDeactivateHand();
  if (tool) wrap.classList.add('annot-mode-' + tool);
  pdfedSyncSizePanelForTool();
  if (tool === 'addtext') toast('Click anywhere on the page to drop a text box', 'info');
  if (tool === 'link') toast('Click anywhere on the page to add a link', 'info');

  const btnMap = {
    highlight: 'pdfedHighlightBtn', draw: 'pdfedDrawBtn', eraser: 'pdfedEraserBtn',
    redact: 'pdfedRedactBtn', addtext: 'pdfedAddTextBtn', link: 'pdfedAddLinkBtn'
  };
  const btn = document.getElementById(btnMap[tool]);
  if (btn) btn.classList.add('annot-active');

  // If it's a shapes-group tool (shapes + elements merged), highlight the group main button
  if (pdfedShapeTools.includes(tool)) {
    const mainBtn = document.getElementById('pdfedShapesMainBtn');
    if (mainBtn) mainBtn.classList.add('annot-active');
  }
}

// ── SHAPES GROUP (merged: Arrow / Box / Circle / Line / Double Arrow / Rounded Box / Triangle / Diamond / Pentagon / Star / Hexagon) ──
const pdfedShapeTools = ['arrow','rect','circle','line','dblarrow','roundrect','triangle','diamond','pentagon','star','hexagon'];
let pdfedShapesActive = 'arrow'; // last selected shape

const pdfedShapeSVGs = {
  arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  rect:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  circle:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="10"/></svg>',
  line:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>',
  dblarrow:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="15 6 19 12 15 18"/><polyline points="9 6 5 12 9 18"/></svg>',
  roundrect: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="6"/></svg>',
  triangle:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 21 20 3 20"/></svg>',
  diamond:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 12 12 22 2 12"/></svg>',
  pentagon:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 9.5 18 21 6 21 2 9.5"/></svg>',
  star:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>',
  hexagon:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="17 3 22 12 17 21 7 21 2 12 7 3"/></svg>'
};
const pdfedShapeLabels = {
  arrow: 'Arrow', rect: 'Box', circle: 'Circle',
  line: 'Line', dblarrow: 'Double Arrow', roundrect: 'Rounded Box', triangle: 'Triangle',
  diamond: 'Diamond', pentagon: 'Pentagon', star: 'Star', hexagon: 'Hexagon'
};

function pdfedShapesMainClick() {
  pdfedSetAnnotTool(pdfedShapesActive);
}

function pdfedShapesToggleDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('pdfedShapesDropdown');
  const btn = document.getElementById('pdfedShapesCaret');
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = rect.left + 'px';
    // Highlight active option
    pdfedShapeTools.forEach(t => {
      document.getElementById('pdfedShapesOpt-' + t).classList.toggle('active', t === pdfedShapesActive);
    });
  }
}

function pdfedShapesSelect(tool) {
  pdfedShapesActive = tool;
  // Update main button appearance
  document.getElementById('pdfedShapesIcon').innerHTML = pdfedShapeSVGs[tool];
  document.getElementById('pdfedShapesLabel').textContent = pdfedShapeLabels[tool];
  // Close dropdown
  document.getElementById('pdfedShapesDropdown').classList.remove('open');
  // Activate the tool
  pdfedSetAnnotTool(tool);
}

// Close shapes dropdown on outside click
document.addEventListener('click', function(e) {
  const group = document.getElementById('pdfedShapesGroup');
  const dd = document.getElementById('pdfedShapesDropdown');
  if (dd && group && !group.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('open');
  }
});

// ── PDF TOOLS GROUP (Merge PDF lives here as a Pro feature) ──────────────────
function pdfedToolsToggleDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('pdfedToolsDropdown');
  const btn = document.getElementById('pdfedToolsMainBtn');
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = rect.left + 'px';
  }
}

function pdfedToolsMergeClick() {
  document.getElementById('pdfedToolsDropdown').classList.remove('open');
  pdfedOpenMerge();
}

function pdfedToolsUnlockClick() {
  document.getElementById('pdfedToolsDropdown').classList.remove('open');
  pdfedRemovePassword();
}

// The companion to export-time password protection: downloads a fresh,
// unencrypted copy of whatever PDF is currently open. If the file needed a
// password to open in the first place, sarvarcOpenPdfDocument already asked
// for it back when it was loaded (see pdfedLoadFileObject) — by this point
// it's sitting decrypted in memory, so this is just a normal export that's
// forced to skip the password step and use a clearer filename, regardless
// of whatever the export modal's password toggle happens to be set to.
async function pdfedRemovePassword() {
  if (pdfed.pages.length === 0) { toast('Open a PDF first', 'error'); return; }
  await pdfedExport(null, null, '_unlocked', 'Password removed, unlocked PDF downloaded');
}

// Close PDF tools dropdown on outside click
document.addEventListener('click', function(e) {
  const group = document.getElementById('pdfedToolsGroup');
  const dd = document.getElementById('pdfedToolsDropdown');
  if (dd && group && !group.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('open');
  }
});

function pdfedSetAnnotColor(el) {
  pdfedAnnotState.color = el.dataset.color;
  pdfedAnnotState.colorTouched = true;
  pdfedSyncColorUI(pdfedAnnotState.color);
}
function pdfedSetAnnotColorHex(hex) {
  pdfedAnnotState.color = hex;
  pdfedAnnotState.colorTouched = true;
  pdfedSyncColorUI(hex);
}
function pdfedSyncColorUI(hex) {
  const preview = document.getElementById('pdfedColorPreview');
  const hexInput = document.getElementById('pdfedColorHexInput');
  if (preview) preview.style.background = hex;
  if (hexInput) hexInput.value = hex.toUpperCase();
  pdfedDrawMiniWheel(hex);
  // Quick-swatch (White/Black, etc.) active ring follows whatever the true
  // current color is, however it got picked (wheel, hex box, or a swatch).
  const norm = String(hex || '').toLowerCase();
  document.querySelectorAll('.pdfed-color-dot').forEach(d => {
    d.classList.toggle('active', (d.dataset.color || '').toLowerCase() === norm);
  });
}
// The one size dropdown in the color panel means something different
// depending on which tool is active, pen/highlighter width for draw-type
// tools, but font size for Add Text. Rather than bolt on a second dropdown,
// it relabels and repopulates itself for whichever tool is currently active,
// so the number the person picks always matches what it visibly controls.
const PDFED_STROKE_SIZE_OPTS = [
  { v: 2,  label: 'Thin (2px)' },
  { v: 4,  label: 'Medium (4px)' },
  { v: 8,  label: 'Thick (8px)' },
  { v: 16, label: 'Extra Large (16px)' },
];
const PDFED_TEXT_SIZE_OPTS = [
  { v: 14, label: 'Small (14px)' },
  { v: 20, label: 'Medium (20px)' },
  { v: 28, label: 'Large (28px)' },
  { v: 40, label: 'Extra Large (40px)' },
];

function pdfedAnnotSizeChanged(val) {
  const n = parseInt(val) || 0;
  if (pdfedAnnotState.tool === 'addtext') pdfedAnnotState.textSize = n;
  else pdfedAnnotState.size = n;
}

function pdfedSyncSizePanelForTool() {
  const label = document.getElementById('pdfedAnnotSizeLabel');
  const select = document.getElementById('pdfedAnnotSizeSelect');
  if (!label || !select) return;
  const isText = pdfedAnnotState.tool === 'addtext';
  label.textContent = isText ? 'Text Size' : 'Stroke Size';
  const opts = isText ? PDFED_TEXT_SIZE_OPTS : PDFED_STROKE_SIZE_OPTS;
  const current = isText ? pdfedAnnotState.textSize : pdfedAnnotState.size;
  select.innerHTML = opts.map(o =>
    `<option value="${o.v}"${o.v === current ? ' selected' : ''}>${o.label}</option>`
  ).join('');
}

function pdfedSetAnnotOpacity(val) {
  pdfedAnnotState.opacity = parseInt(val) / 100;
  const label = document.getElementById('pdfedOpacityVal');
  if (label) label.textContent = val + '%';
}
function pdfedToggleColorPanel() {
  const panel = document.getElementById('pdfedColorPanel');
  const trigger = document.getElementById('pdfedColorTrigger');
  if (!panel || !trigger) return;
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    // Position panel below the trigger button using fixed coords
    const rect = trigger.getBoundingClientRect();
    const panelW = 192;
    let left = rect.left + rect.width / 2 - panelW / 2;
    // Keep inside viewport
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (left < 8) left = 8;
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = left + 'px';
    pdfedDrawColorWheel();
    pdfedSyncSizePanelForTool();
  }
}
// Close color panel when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('pdfedColorPickerWrap');
  if (wrap && !wrap.contains(e.target)) {
    const panel = document.getElementById('pdfedColorPanel');
    if (panel) panel.classList.remove('open');
  }
});

// ── BORDER TOOL ──────────────────────────────────────────────────────────────
// Frames the whole page with a decorative border, for postcards, letter
// boundaries, and designer frames. Unlike the drag-to-draw shapes, this is a
// one-click "stamp the whole page" action: pick a style + margin + thickness
// (color comes from the same shared color picker every other annotate tool
// already uses), then Apply. It's baked straight onto the annotation canvas
// using the exact same push-undo / commit-stroke pattern as every other
// annotation, so Ctrl+Z, page reorder, and export all keep working for free.
const pdfedBorderState = { style: 'simple', margin: 6, thickness: 6, color: '#FFD600' };
let pdfedBorderSeq = 0;

const pdfedBorderStyleDefs = {
  simple:   { label: 'Simple',   svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18"/></svg>' },
  double:   { label: 'Double',   svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="19" height="19"/><rect x="6.5" y="6.5" width="11" height="11"/></svg>' },
  dashed:   { label: 'Dashed',   svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"><rect x="3" y="3" width="18" height="18"/></svg>' },
  postcard: { label: 'Postcard', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="19" height="19" rx="3"/><rect x="6.5" y="6.5" width="11" height="11" stroke-dasharray="2 1.6"/></svg>' },
  letter:   { label: 'Letter',   svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="19" height="19"/><rect x="5.5" y="5.5" width="13" height="13"/></svg>' },
  designer: { label: 'Designer', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4.5" y="4.5" width="15" height="15"/><path d="M2 6.5V2.5H6M18 2.5H22V6.5M22 17.5V21.5H18M6 21.5H2V17.5"/></svg>' }
};

function pdfedRenderBorderStyleGrid() {
  const grid = document.getElementById('pdfedBorderStyleGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(pdfedBorderStyleDefs).map(key => {
    const d = pdfedBorderStyleDefs[key];
    const activeCls = key === pdfedBorderState.style ? ' active' : '';
    return '<div class="pdfed-shapes-opt-grid' + activeCls + '" id="pdfedBorderOpt-' + key + '" onclick="pdfedBorderSelectStyle(\'' + key + '\')">' + d.svg + '<span>' + d.label + '</span></div>';
  }).join('');
}

function pdfedBorderSelectStyle(style) {
  pdfedBorderState.style = style;
  pdfedRenderBorderStyleGrid();
}

function pdfedBorderMarginInput(val) {
  pdfedBorderState.margin = parseFloat(val) || 0;
  const lbl = document.getElementById('pdfedBorderMarginVal');
  if (lbl) lbl.textContent = val + '%';
}

function pdfedBorderThicknessInput(val) {
  pdfedBorderState.thickness = parseFloat(val) || 1;
  const lbl = document.getElementById('pdfedBorderThicknessVal');
  if (lbl) lbl.textContent = val + 'px';
}

function pdfedToggleBorderPanel() {
  const panel = document.getElementById('pdfedBorderPanel');
  const trigger = document.getElementById('pdfedBorderTrigger');
  if (!panel || !trigger) return;
  // Only one floating ribbon panel should be open at a time
  const colorPanel = document.getElementById('pdfedColorPanel');
  if (colorPanel) colorPanel.classList.remove('open');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    const rect = trigger.getBoundingClientRect();
    const panelW = 230;
    let left = rect.left + rect.width / 2 - panelW / 2;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (left < 8) left = 8;
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = left + 'px';
    pdfedRenderBorderStyleGrid();
    const prev = document.getElementById('pdfedBorderColorPreview');
    const nativeInput = document.getElementById('pdfedBorderColorNative');
    const hexInput = document.getElementById('pdfedBorderColorHexInput');
    if (prev) prev.style.background = pdfedBorderState.color;
    if (nativeInput) nativeInput.value = pdfedBorderState.color;
    if (hexInput) hexInput.value = pdfedBorderState.color;
  }
}
// Close border panel when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('pdfedBorderWrap');
  if (wrap && !wrap.contains(e.target)) {
    const panel = document.getElementById('pdfedBorderPanel');
    if (panel) panel.classList.remove('open');
  }
});

// Standalone rounded-rect path helper, scoped to the border tool (kept separate
// from the shape tool's own version, which is a private closure inside pdfedAnnotInit).
function pdfedBorderRoundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// Draws the chosen border style directly onto a 2D context sized w x h.
// margin is expressed as a % of the shorter page side so it scales sensibly
// across different page sizes (A4, letter, postcard, etc).
function pdfedDrawBorderOnCtx(ctx, w, h, opts, offsetX, offsetY) {
  const style = opts.style, color = opts.color;
  const margin = Math.min(w, h) * (opts.marginPct / 100);
  const t = Math.max(1, opts.thickness);
  ctx.save();
  if (offsetX || offsetY) ctx.translate(offsetX || 0, offsetY || 0);
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);

  if (style === 'simple') {
    ctx.lineWidth = t;
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);

  } else if (style === 'double') {
    ctx.lineWidth = Math.max(1, t * 0.55);
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    const m2 = margin + t * 2.5 + margin * 0.12;
    ctx.strokeRect(m2, m2, w - m2 * 2, h - m2 * 2);

  } else if (style === 'dashed') {
    ctx.lineWidth = t;
    ctx.setLineDash([t * 3, t * 2]);
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    ctx.setLineDash([]);

  } else if (style === 'postcard') {
    // Rounded outer frame plus a dashed inner rule — the stamp/postcard look
    ctx.lineWidth = Math.max(1, t * 0.6);
    const r = Math.max(6, margin * 0.3);
    pdfedBorderRoundRectPath(ctx, margin, margin, w - margin * 2, h - margin * 2, r);
    ctx.stroke();
    const m2 = margin + t * 2.4;
    ctx.setLineDash([t, t * 1.5]);
    ctx.lineWidth = Math.max(1, t * 0.5);
    ctx.strokeRect(m2, m2, w - m2 * 2, h - m2 * 2);
    ctx.setLineDash([]);

  } else if (style === 'letter') {
    // Formal double-rule with small corner ticks, like a letterhead frame
    ctx.lineWidth = Math.max(1, t * 0.5);
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    const m2 = margin + t * 3.5;
    ctx.lineWidth = Math.max(1, t * 0.35);
    ctx.strokeRect(m2, m2, w - m2 * 2, h - m2 * 2);
    const tick = Math.min(w, h) * 0.03 + margin * 0.15;
    ctx.lineWidth = Math.max(1, t * 0.4);
    [[margin, margin, 1, 1], [w - margin, margin, -1, 1], [margin, h - margin, 1, -1], [w - margin, h - margin, -1, -1]].forEach(function(c) {
      const cx = c[0], cy = c[1], dx = c[2], dy = c[3];
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * tick, cy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + dy * tick);
      ctx.stroke();
    });

  } else if (style === 'designer') {
    // Solid frame plus ornamental corner brackets floating just outside it
    ctx.lineWidth = t;
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    const bracket = Math.min(w, h) * 0.07 + t * 2;
    const off = t * 1.8;
    ctx.lineWidth = Math.max(2, t * 0.8);
    ctx.lineCap = 'round';
    [
      { x: margin - off, y: margin - off, dx: 1, dy: 1 },
      { x: w - margin + off, y: margin - off, dx: -1, dy: 1 },
      { x: margin - off, y: h - margin + off, dx: 1, dy: -1 },
      { x: w - margin + off, y: h - margin + off, dx: -1, dy: -1 }
    ].forEach(function(c) {
      ctx.beginPath();
      ctx.moveTo(c.x + c.dx * bracket, c.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(c.x, c.y + c.dy * bracket);
      ctx.stroke();
    });
  }
  ctx.restore();
}

// Applies the current border settings to whichever page is active right now,
// as a live, editable placed object — draggable, resizable from any edge or
// corner, lockable, and reorderable via Arrange (Bring to Front/Send to Back/
// Forward/Backward) exactly like placed images and text boxes, instead of
// being permanently baked into the page's pixels. Defaults to covering the
// full page (the classic "frame the page" look) but can be dragged/resized
// afterwards into a smaller decorative frame anywhere on the page.
function pdfedApplyBorderCurrentPage() {
  if (pdfed.active < 0) { toast('Open a PDF or start a blank page first', 'info'); return; }
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) { toast('Page is not ready yet, try again in a moment', 'info'); return; }
  if (!pg.placedBorders) pg.placedBorders = [];
  // Bake the chosen margin straight into the object's own box at creation
  // time, instead of storing it as a live inset drawn inside a full-page
  // box. That way the box IS the frame — the resize/drag outline and
  // handles sit exactly on the visible line with zero gap, no matter what
  // margin % was picked, and dragging/resizing from then on is a true
  // 1:1 match between what you grab and what you see.
  const m = Math.min(pc.width, pc.height) * (pdfedBorderState.margin / 100);
  pg.placedBorders.push({
    id: 'pbrd_' + (++pdfedBorderSeq),
    style: pdfedBorderState.style,
    marginPct: 0,
    thickness: pdfedBorderState.thickness,
    color: pdfedBorderState.color,
    x: m, y: m, w: pc.width - m * 2, h: pc.height - m * 2,
    locked: false,
    zIndex: pdfedNextZ(pg)
  });
  pdfedMarkModified(idx);
  pdfedRenderPlacedBorders(idx);
  toast('Border added — drag to move, resize from any edge/corner, right-click to Arrange', 'success');
}

// Applies the current border settings to every page in the document as its
// own independent, still-editable placed border object (one per page, sized
// to that page's own rendered pixel dimensions). Each page's real raster size
// only exists on the live #pdfedPageCanvas element while it's the one being
// displayed, so this briefly visits each page (pdfedGoto) to read its actual
// width/height before adding that page's border, then returns to wherever the
// user started.
async function pdfedApplyBorderAllPages() {
  if (!pdfed.pages || !pdfed.pages.length) { toast('Open a PDF or start a blank page first', 'info'); return; }
  const total = pdfed.pages.length;
  const startActive = pdfed.active;
  for (let i = 0; i < total; i++) {
    await pdfedGoto(i);
    const pg = pdfed.pages[i];
    const pc = document.getElementById('pdfedPageCanvas');
    if (!pc || !pc.width) continue;
    if (!pg.placedBorders) pg.placedBorders = [];
    // Same bake-the-margin-into-the-box approach as the single-page path above.
    const m = Math.min(pc.width, pc.height) * (pdfedBorderState.margin / 100);
    pg.placedBorders.push({
      id: 'pbrd_' + (++pdfedBorderSeq),
      style: pdfedBorderState.style,
      marginPct: 0,
      thickness: pdfedBorderState.thickness,
      color: pdfedBorderState.color,
      x: m, y: m, w: pc.width - m * 2, h: pc.height - m * 2,
      locked: false,
      zIndex: pdfedNextZ(pg)
    });
    pdfedMarkModified(i);
  }
  if (startActive >= 0) await pdfedGoto(startActive);
  pdfedRenderPlacedBorders(pdfed.active);
  toast('Border added to all ' + total + ' page' + (total !== 1 ? 's' : '') + ' — each is still editable', 'success');
}

// ─── PLACED BORDER LAYER (persistent, movable, resizable, lockable — same
// Canva-style overlay as placed images/text, but redraws a live <canvas>
// with the chosen border style instead of showing a static bitmap) ─────────

// (Re)draws one placed border's own little canvas element at its current
// box size. Called on first render and again on every resize step, so the
// frame's margin/thickness always look correct at whatever size the user
// has dragged it to, instead of stretching a fixed-size bitmap.
function pdfedRedrawBorderCanvas(canvasEl, item) {
  const w = Math.max(1, Math.round(item.w));
  const h = Math.max(1, Math.round(item.h));
  if (canvasEl.width !== w) canvasEl.width = w;
  if (canvasEl.height !== h) canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  pdfedDrawBorderOnCtx(ctx, w, h, {
    style: item.style,
    marginPct: item.marginPct,
    thickness: item.thickness,
    color: item.color
  });
}

// Re-renders all placed borders for the given page as DOM overlay elements,
// mirroring pdfedRenderPlacedImages exactly (same badges, same resize
// handles, same z-index/opacity handling) so a border is a first-class
// placed object right alongside images/text/tables.
function pdfedRenderPlacedBorders(idx) {
  const layer = document.getElementById('pdfedPlacedBordersLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const pg = pdfed.pages[idx];
  if (pg) pdfedGetZOrderedItems(pg); // seeds zIndex on any legacy/missing items
  const list = (pg && pg.placedBorders) || [];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) return;

  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'pdfed-placed-border' + (item.locked ? ' locked' : '');
    el.dataset.id = item.id;
    el.style.cssText = `position:absolute;box-sizing:border-box;
      border-radius:2px;user-select:none;
      pointer-events:${item.locked ? 'none' : 'auto'};
      cursor:${item.locked ? 'default' : 'move'};
      z-index:${item.zIndex || 0};`;

    // Rotation-carrying inner wrapper — matches placed shapes/images
    // (.pdfed-rot-inner). Only this (and its children, the border canvas +
    // resize handles) ever receives the rotate() transform that
    // pdfedPositionPlacedEl applies. It MUST be created and attached to
    // `el` BEFORE pdfedPositionPlacedEl runs below: that function looks
    // for `.pdfed-rot-inner` in the DOM to decide where the rotate()
    // transform goes, and if it isn't there yet it falls back to rotating
    // `el` itself — spinning every badge below (lock/arrange/opacity/
    // color/delete) right along with it, upside down, the instant an
    // already-rotated border is re-rendered fresh (e.g. every time it's
    // locked or unlocked, which fully rebuilds this element). Keeping
    // badges as direct children of `el` (never inside rotInner), combined
    // with this ordering, is what keeps them upright, readable, and fixed
    // in place no matter how the border is rotated or locked.
    const rotInner = document.createElement('div');
    rotInner.className = 'pdfed-rot-inner';
    rotInner.style.cssText = `position:absolute;inset:0;box-sizing:border-box;
      border:2px ${item.locked ? 'solid rgba(255,255,255,0.25)' : 'dashed var(--blue)'};
      border-radius:2px;transform-origin:50% 50%;`;
    el.appendChild(rotInner);
    pdfedPositionPlacedEl(el, item, pc);

    const canvasEl = document.createElement('canvas');
    canvasEl.style.cssText = `width:100%;height:100%;display:block;pointer-events:none;opacity:${pdfedGetOpacity(item)};`;
    rotInner.appendChild(canvasEl);
    pdfedRedrawBorderCanvas(canvasEl, item);

    // Lock/unlock toggle badge, always interactive, even when the border itself is locked
    const lockBtn = document.createElement('button');
    lockBtn.title = item.locked ? 'Unlock to move/resize' : 'Lock in place';
    lockBtn.className = 'pdfed-badge-btn' + (item.locked ? ' is-locked' : '');
    lockBtn.style.cssText = `position:absolute;top:4px;right:4px;pointer-events:auto;z-index:2;`;
    lockBtn.innerHTML = item.locked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.45-2"/></svg>';
    lockBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTogglePlacedBorderLock(idx, item.id); };
    el.appendChild(lockBtn);

    if (!item.locked) {
      // Bring Forward, one-click step toward the front (unified z-order,
      // so it can step past an image, text box, or table too)
      const fwdBtn = document.createElement('button');
      fwdBtn.title = 'Bring forward';
      fwdBtn.className = 'pdfed-badge-btn';
      fwdBtn.style.cssText = `position:absolute;top:4px;right:116px;pointer-events:auto;z-index:2;`;
      fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
      fwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('border', idx, item.id, 1); };
      el.appendChild(fwdBtn);

      // Send Backward, one-click step toward the back
      const bwdBtn = document.createElement('button');
      bwdBtn.title = 'Send backward';
      bwdBtn.className = 'pdfed-badge-btn';
      bwdBtn.style.cssText = `position:absolute;top:4px;right:88px;pointer-events:auto;z-index:2;`;
      bwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      bwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('border', idx, item.id, -1); };
      el.appendChild(bwdBtn);

      // Arrange (layer order) badge, jump straight To Front / To Back
      const arrBtn = document.createElement('button');
      arrBtn.title = 'Arrange, bring to front/back';
      arrBtn.className = 'pdfed-badge-btn';
      arrBtn.style.cssText = `position:absolute;top:4px;right:60px;pointer-events:auto;z-index:2;`;
      arrBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
      arrBtn.onclick = (ev) => pdfedOpenArrangeMenu(ev, 'border', idx, item.id);
      el.appendChild(arrBtn);

      // Opacity badge, opens the shared opacity popover for this border
      const opBtn = document.createElement('button');
      opBtn.title = 'Opacity';
      opBtn.className = 'pdfed-badge-btn pdfed-opacity-btn';
      opBtn.style.cssText = `position:absolute;top:4px;right:144px;pointer-events:auto;z-index:2;`;
      opBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';
      opBtn.onclick = (ev) => pdfedOpenOpacityPopover(ev, 'border', idx, item.id);
      el.appendChild(opBtn);

      // Color badge — opens a small floating color popover; dragging/typing
      // in it recolors THIS border object live, redrawing its canvas on
      // every input event (not just on close), so the change is visible
      // immediately while picking, exactly like Canva-style live recoloring.
      const colBtn = document.createElement('button');
      colBtn.title = 'Border color';
      colBtn.className = 'pdfed-badge-btn';
      colBtn.style.cssText = `position:absolute;top:4px;right:172px;pointer-events:auto;z-index:2;`;
      colBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0-9 9c0 1.5 1 2.5 2.3 2.5H8a1.8 1.8 0 0 1 1.8 1.8v.4A2.3 2.3 0 0 0 12 21a9 9 0 0 0 0-18z" fill="currentColor" stroke="none" opacity="0.9"/></svg>';
      colBtn.onclick = (ev) => pdfedOpenBorderColorPopover(ev, idx, item.id);
      el.appendChild(colBtn);

      // Delete button, only available while unlocked
      const delBtn = document.createElement('button');
      delBtn.title = 'Remove border';
      delBtn.className = 'pdfed-badge-btn is-danger';
      delBtn.style.cssText = `position:absolute;top:4px;right:32px;pointer-events:auto;z-index:2;`;
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePlacedBorder(idx, item.id); };
      el.appendChild(delBtn);

      const handles = {};
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(dir => {
        const rh = pdfedMakeImgResizeHandle(dir);
        rotInner.appendChild(rh);
        handles[dir] = rh;
      });

      pdfedAttachPlacedBorderDragHandlers(el, item, idx, handles, canvasEl);
    }

    layer.appendChild(el);
  });
}

// Drag/resize handling for a placed border — same smart-snap-to-page/other-
// objects behavior as placed images (pdfedAttachPlacedDragHandlers), plus a
// live canvas redraw on every resize step so the frame's margin/thickness
// always look right at the new size instead of a stretched bitmap.
function pdfedAttachPlacedBorderDragHandlers(el, item, idx, handles, canvasEl) {
  let dragging = false, resizing = false, resizeDir = null;
  let ox = 0, oy = 0, startRect = null;
  let startX = 0, startY = 0, snapTargets = null, beforeSnap = null;
  // Whether this resize interaction already locked the x/y axis onto the
  // page boundary (hard clamp) or a smart-snap target. When true, the
  // release-time grid-snap below must leave that axis alone — otherwise
  // a border you just dragged flush to the edge visibly hops a few grid
  // px away the instant you let go, which reads as a bug, not a feature.
  let edgeLockedX = false, edgeLockedY = false;
  const pc = document.getElementById('pdfedPageCanvas');
  const SNAP = 10; // canvas-px snap threshold, same as placed images/text

  el.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    const dir = e.target && e.target.dataset ? e.target.dataset.dir : null;
    if (dir && handles[dir] === e.target) {
      resizing = true; resizeDir = dir;
      ox = e.clientX; oy = e.clientY;
      startRect = { x: item.x, y: item.y, w: item.w, h: item.h };
      snapTargets = pdfedCollectSnapTargets(item.id);
      edgeLockedX = false; edgeLockedY = false;
    } else if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
      dragging = true; ox = e.clientX; oy = e.clientY; startX = item.x; startY = item.y;
      snapTargets = pdfedCollectSnapTargets(item.id);
    } else { return; }
    beforeSnap = { x: item.x, y: item.y, w: item.w, h: item.h };
    document.querySelectorAll('.pdfed-placed-border.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    e.preventDefault(); e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging && !resizing) return;
    const pcRect = pc.getBoundingClientRect();
    const scale = pc.width / pcRect.width;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (dragging) {
      let nx = startX + (e.clientX - ox) * scale;
      let ny = startY + (e.clientY - oy) * scale;

      const bestX = pdfedBestSnap([nx, nx + item.w / 2, nx + item.w], (snapTargets || { x: [] }).x, SNAP);
      const bestY = pdfedBestSnap([ny, ny + item.h / 2, ny + item.h], (snapTargets || { y: [] }).y, SNAP);
      if (bestX) nx += bestX.delta;
      if (bestY) ny += bestY.delta;
      if (pdfed.snapGrid) {
        if (!bestX) nx = pdfedSnapToGrid(nx);
        if (!bestY) ny = pdfedSnapToGrid(ny);
      }
      if (guideV) {
        guideV.style.display = bestX ? 'block' : 'none';
        if (bestX) guideV.style.left = (bestX.at * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = bestY ? 'block' : 'none';
        if (bestY) guideH.style.top = (bestY.at * (pdfed.zoom || 1)) + 'px';
      }

      item.x = nx; item.y = ny;
      // Hard clamp: the border can never be dragged off the page — this is
      // what actually guarantees an edge-to-edge fit is reachable/holdable,
      // on top of the magnetic snap above (which only catches you within
      // SNAP px; this clamp is the real "can't leave the canvas" wall).
      item.x = Math.max(0, Math.min(item.x, pc.width - item.w));
      item.y = Math.max(0, Math.min(item.y, pc.height - item.h));
      pdfedPositionPlacedEl(el, item, pc);
    } else if (resizing) {
      const dx = (e.clientX - ox) * scale, dy = (e.clientY - oy) * scale;
      const r = pdfedResizeRect(resizeDir, startRect, dx, dy, 30, e.shiftKey);

      // Snap whichever edge(s) this handle is moving to the page edges/center
      // and other objects' edges — same magnetism as moving the whole border,
      // so a corner/edge handle can be dragged flush to the page boundary
      // instead of needing pixel-perfect precision.
      const north = resizeDir.indexOf('n') !== -1, south = resizeDir.indexOf('s') !== -1;
      const west  = resizeDir.indexOf('w') !== -1, east  = resizeDir.indexOf('e') !== -1;
      const targets = snapTargets || { x: [], y: [] };
      let snapAtX = null, snapAtY = null;

      if (west) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([r.x], targets.x, SNAP);
        if (best) { r.x += best.delta; r.w = Math.max(30, right - r.x); snapAtX = best.at; edgeLockedX = true; }
      } else if (east) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([right], targets.x, SNAP);
        if (best) { r.w = Math.max(30, (right + best.delta) - r.x); snapAtX = best.at; edgeLockedX = true; }
      }
      if (north) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([r.y], targets.y, SNAP);
        if (best) { r.y += best.delta; r.h = Math.max(30, bottom - r.y); snapAtY = best.at; edgeLockedY = true; }
      } else if (south) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([bottom], targets.y, SNAP);
        if (best) { r.h = Math.max(30, (bottom + best.delta) - r.y); snapAtY = best.at; edgeLockedY = true; }
      }

      if (guideV) {
        guideV.style.display = snapAtX !== null ? 'block' : 'none';
        if (snapAtX !== null) guideV.style.left = (snapAtX * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = snapAtY !== null ? 'block' : 'none';
        if (snapAtY !== null) guideH.style.top = (snapAtY * (pdfed.zoom || 1)) + 'px';
      }

      // Hard clamp: whatever edge this handle pushed past the page
      // boundary gets pulled back to exactly 0 / pc.width / pc.height,
      // keeping the OPPOSITE (anchored) edge exactly where it was —
      // the border can never be resized outside the canvas, and lands
      // flush on the edge instead of overshooting or getting stuck short.
      if (west) {
        const right = r.x + r.w;
        r.x = Math.max(0, r.x);
        r.w = right - r.x;
        if (r.x === 0) edgeLockedX = true;
      } else if (east) {
        const right = Math.min(pc.width, r.x + r.w);
        r.w = right - r.x;
        if (right === pc.width) edgeLockedX = true;
      }
      if (north) {
        const bottom = r.y + r.h;
        r.y = Math.max(0, r.y);
        r.h = bottom - r.y;
        if (r.y === 0) edgeLockedY = true;
      } else if (south) {
        const bottom = Math.min(pc.height, r.y + r.h);
        r.h = bottom - r.y;
        if (bottom === pc.height) edgeLockedY = true;
      }
      r.w = Math.max(30, r.w);
      r.h = Math.max(30, r.h);

      item.x = r.x; item.y = r.y; item.w = r.w; item.h = r.h;
      pdfedPositionPlacedEl(el, item, pc);
      pdfedRedrawBorderCanvas(canvasEl, item);
    }
  });
  document.addEventListener('mouseup', () => {
    if (resizing && pdfed.snapGrid) {
      // Only grid-snap an axis that wasn't already locked to the page edge
      // or a smart-snap target during this resize — otherwise a border you
      // just placed flush against the page boundary would visibly hop a
      // few grid px away the instant you release the handle.
      if (!edgeLockedX) {
        const newX = pdfedSnapToGrid(item.x);
        item.w = Math.max(30, pdfedSnapToGrid(item.x + item.w) - newX);
        item.x = newX;
      }
      if (!edgeLockedY) {
        const newY = pdfedSnapToGrid(item.y);
        item.h = Math.max(30, pdfedSnapToGrid(item.y + item.h) - newY);
        item.y = newY;
      }
      pdfedPositionPlacedEl(el, item, pc);
      pdfedRedrawBorderCanvas(canvasEl, item);
    }
    if (dragging || resizing) pdfedMarkModified(idx);
    if ((dragging || resizing) && beforeSnap) {
      const before = beforeSnap;
      const after = { x: item.x, y: item.y, w: item.w, h: item.h };
      if (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h) {
        const gIdx = idx;
        pushAppHistory({
          label: resizing ? 'Resize border' : 'Move border',
          undo: () => {
            item.x = before.x; item.y = before.y; item.w = before.w; item.h = before.h;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedBorders(gIdx);
          },
          redo: () => {
            item.x = after.x; item.y = after.y; item.w = after.w; item.h = after.h;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedBorders(gIdx);
          }
        });
      }
    }
    beforeSnap = null;
    dragging = false; resizing = false; resizeDir = null; startRect = null; snapTargets = null;
    edgeLockedX = false; edgeLockedY = false;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
  });
}

function pdfedTogglePlacedBorderLock(idx, id) {
  const list = (pdfed.pages[idx] && pdfed.pages[idx].placedBorders) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  item.locked = !item.locked;
  pdfedRenderPlacedBorders(idx);
  toast(item.locked ? 'Border locked, unlock to move it' : 'Border unlocked, drag to move', 'info');
}

function pdfedDeletePlacedBorder(idx, id) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedBorders) return;
  const i = pg.placedBorders.findIndex(b => b.id === id);
  if (i === -1) return;
  const removedItem = pg.placedBorders[i], removedIndex = i;
  pg.placedBorders.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedBorders(idx);
  toast('Border removed', 'success');
  pushAppHistory({
    label: 'Delete border',
    undo: () => {
      pg.placedBorders.splice(Math.min(removedIndex, pg.placedBorders.length), 0, removedItem);
      pdfedMarkModified(idx);
      pdfedRenderPlacedBorders(idx);
      toast('Border restored', 'info');
    },
    redo: () => {
      const at = pg.placedBorders.indexOf(removedItem);
      if (at !== -1) pg.placedBorders.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedBorders(idx);
      toast('Border removed', 'success');
    }
  });
}

function pdfedDuplicatePlacedBorder(idx, id) {
  const pg = pdfed.pages[idx];
  const list = (pg && pg.placedBorders) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  const clone = Object.assign({}, item, { id: 'pbrd_' + (++pdfedBorderSeq), x: item.x + 18, y: item.y + 18, locked: false, zIndex: pdfedNextZ(pg) });
  pg.placedBorders.push(clone);
  pdfedMarkModified(idx);
  pdfedRenderPlacedBorders(idx);
  toast('Border duplicated', 'success');
}

window.pdfedRenderPlacedBorders = pdfedRenderPlacedBorders;
window.pdfedTogglePlacedBorderLock = pdfedTogglePlacedBorderLock;
window.pdfedDeletePlacedBorder = pdfedDeletePlacedBorder;
window.pdfedDuplicatePlacedBorder = pdfedDuplicatePlacedBorder;

// ─── PLACED SHAPE LAYER (persistent, draggable, resizable, lockable) ───────
// Lines, arrows, and every other shape drawn with the Shapes tool used to be
// baked straight into the annotation canvas's pixels the instant you let go
// of the mouse, same dead-on-arrival problem placed borders used to have:
// no moving it afterwards, no resizing, no picking it back up if it landed
// a few px off. This turns every shape into a first-class placed object,
// exactly like placed borders, images, text, and tables, drag to move,
// resize from any edge/corner, lock, delete, and it participates in the
// same unified Arrange (front/back/forward/backward) stacking order.

// Standalone (non-preview) shape renderer, draws one shape into a 2D
// context sized to exactly the shape's own box (0,0 → w,h), same geometry
// as the live drag-preview used to use, just detached from that closure so
// it can also be called here and at export/thumbnail-bake time.
function pdfedDrawShapeOnCtx(ctx, tool, color, size, x1, y1, x2, y2) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tool === 'rect') {
    ctx.beginPath();
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (tool === 'roundrect') {
    pdfedTraceRoundRectStandalone(ctx, x1, y1, x2, y2, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.18 || 8);
    ctx.stroke();
  } else if (tool === 'circle') {
    const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
    ctx.beginPath();
    ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (tool === 'arrow') {
    pdfedDrawArrowStandalone(ctx, x1, y1, x2, y2, size);
  } else if (tool === 'dblarrow') {
    pdfedDrawArrowStandalone(ctx, x1, y1, x2, y2, size, true);
  } else if (tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (tool === 'triangle' || tool === 'diamond' || tool === 'pentagon' || tool === 'star' || tool === 'hexagon') {
    pdfedTracePolygonStandalone(ctx, tool, x1, y1, x2, y2);
    ctx.stroke();
  }
}

function pdfedDrawArrowStandalone(ctx, x1, y1, x2, y2, size, doubleHeaded) {
  const headLen = Math.max(size * 5, 20);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  if (doubleHeaded) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 7), y1 + headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 7), y1 + headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
}

function pdfedTraceRoundRectStandalone(ctx, x1, y1, x2, y2, r) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function pdfedTracePolygonStandalone(ctx, tool, x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  let pts = [];
  if (tool === 'triangle') {
    pts = [[0, -1], [0.866, 0.5], [-0.866, 0.5]];
  } else if (tool === 'diamond') {
    pts = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  } else if (tool === 'pentagon' || tool === 'hexagon') {
    const n = tool === 'pentagon' ? 5 : 6;
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = startAngle + (i * 2 * Math.PI) / n;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
  } else if (tool === 'star') {
    const n = 5;
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < n * 2; i++) {
      const a = startAngle + (i * Math.PI) / n;
      const r = i % 2 === 0 ? 1 : 0.42;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const x = cx + px * rx, y = cy + py * ry;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// (Re)draws one placed shape's own little canvas element at its current box
// size. `flipX`/`flipY` record which corner the original drag started from,
// so a line or arrow keeps pointing the same way no matter how the box gets
// resized afterwards (rect/circle/polygon shapes are symmetric and ignore
// them). Called on first render and again on every resize step.
function pdfedRedrawShapeCanvas(canvasEl, item) {
  const w = Math.max(1, Math.round(item.w));
  const h = Math.max(1, Math.round(item.h));
  if (canvasEl.width !== w) canvasEl.width = w;
  if (canvasEl.height !== h) canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const isDirectional = (item.tool === 'line' || item.tool === 'arrow' || item.tool === 'dblarrow');
  const x1 = isDirectional && item.flipX ? w : 0;
  const y1 = isDirectional && item.flipY ? h : 0;
  const x2 = isDirectional && item.flipX ? 0 : w;
  const y2 = isDirectional && item.flipY ? 0 : h;
  pdfedDrawShapeOnCtx(ctx, item.tool, item.color, item.size, x1, y1, x2, y2);
}

// Re-renders all placed shapes for the given page as DOM overlay elements,
// mirroring pdfedRenderPlacedBorders (same badges, same resize handles, same
// z-index/opacity handling) so every drawn shape is a first-class placed
// object right alongside images/text/tables/borders.
function pdfedRenderPlacedShapes(idx) {
  const layer = document.getElementById('pdfedPlacedShapesLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const pg = pdfed.pages[idx];
  if (pg) pdfedGetZOrderedItems(pg); // seeds zIndex on any legacy/missing items
  const list = (pg && pg.placedShapes) || [];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) return;

  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'pdfed-placed-shape' + (item.locked ? ' locked' : '');
    el.dataset.id = item.id;
    el.style.cssText = `position:absolute;box-sizing:border-box;
      border-radius:2px;user-select:none;
      pointer-events:${item.locked ? 'none' : 'auto'};
      cursor:${item.locked ? 'default' : 'move'};
      z-index:${item.zIndex || 0};`;

    // Rotation-carrying inner wrapper — this and its children (the shape
    // canvas + resize/rotate handles) receive the rotate() transform. The
    // visible border now lives here too (not on `el`), so it turns right
    // along with the shape instead of staying axis-aligned/frozen. The
    // badge row below stays a direct child of `el` (never inside
    // rotInner), so it still stays upright and fixed in place no matter
    // how far the shape is rotated — including the moment it's created
    // fresh (e.g. right after a lock/unlock, which fully rebuilds this
    // element). MUST be created and attached BEFORE pdfedPositionPlacedEl
    // runs below: that function looks for `.pdfed-rot-inner` to decide
    // where to put the rotate() transform, and if it isn't in the DOM yet
    // it falls back to rotating `el` itself — spinning the badge row
    // upside down along with the shape the instant an already-rotated
    // shape is re-rendered, e.g. every time it's locked or unlocked.
    const rotInner = document.createElement('div');
    rotInner.className = 'pdfed-rot-inner';
    rotInner.style.cssText = `position:absolute;inset:0;box-sizing:border-box;
      border:2px ${item.locked ? 'solid rgba(255,255,255,0.25)' : 'dashed var(--blue)'};
      border-radius:2px;transform-origin:50% 50%;`;
    el.appendChild(rotInner);
    pdfedPositionPlacedEl(el, item, pc);

    const canvasEl = document.createElement('canvas');
    canvasEl.style.cssText = `width:100%;height:100%;display:block;pointer-events:none;opacity:${pdfedGetOpacity(item)};`;
    rotInner.appendChild(canvasEl);
    pdfedRedrawShapeCanvas(canvasEl, item);

    // Every action badge lives in one non-rotating row, dim until hovered
    // (see .pdfed-badge-row CSS), so it never spins with the shape.
    const badgeRow = document.createElement('div');
    badgeRow.className = 'pdfed-badge-row';
    el.appendChild(badgeRow);

    // Lock/unlock toggle badge, always interactive, even when the shape itself is locked
    const lockBtn = document.createElement('button');
    lockBtn.title = item.locked ? 'Unlock to move/resize' : 'Lock in place';
    lockBtn.className = 'pdfed-badge-btn' + (item.locked ? ' is-locked' : '');
    lockBtn.innerHTML = item.locked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.45-2"/></svg>';
    lockBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTogglePlacedShapeLock(idx, item.id); };

    if (!item.locked) {
      // Bring Forward, one-click step toward the front (unified z-order)
      const fwdBtn = document.createElement('button');
      fwdBtn.title = 'Bring forward';
      fwdBtn.className = 'pdfed-badge-btn';
      fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
      fwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('shape', idx, item.id, 1); };

      // Send Backward, one-click step toward the back
      const bwdBtn = document.createElement('button');
      bwdBtn.title = 'Send backward';
      bwdBtn.className = 'pdfed-badge-btn';
      bwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      bwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('shape', idx, item.id, -1); };

      // Arrange (layer order) badge, jump straight To Front / To Back
      const arrBtn = document.createElement('button');
      arrBtn.title = 'Arrange, bring to front/back';
      arrBtn.className = 'pdfed-badge-btn';
      arrBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
      arrBtn.onclick = (ev) => pdfedOpenArrangeMenu(ev, 'shape', idx, item.id);

      // Opacity badge, opens the shared opacity popover for this shape
      const opBtn = document.createElement('button');
      opBtn.title = 'Opacity';
      opBtn.className = 'pdfed-badge-btn pdfed-opacity-btn';
      opBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';
      opBtn.onclick = (ev) => pdfedOpenOpacityPopover(ev, 'shape', idx, item.id);

      // Delete button, only available while unlocked
      const delBtn = document.createElement('button');
      delBtn.title = 'Remove shape';
      delBtn.className = 'pdfed-badge-btn is-danger';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePlacedShape(idx, item.id); };

      // Flex order = left-to-right visual order, matching the original
      // absolute-offset layout: opacity, forward, backward, arrange, delete,
      // then lock rightmost.
      badgeRow.appendChild(opBtn); badgeRow.appendChild(fwdBtn); badgeRow.appendChild(bwdBtn);
      badgeRow.appendChild(arrBtn); badgeRow.appendChild(delBtn); badgeRow.appendChild(lockBtn);

      const handles = {};
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(dir => {
        const rh = pdfedMakeImgResizeHandle(dir);
        rotInner.appendChild(rh);
        handles[dir] = rh;
      });
      const rotWrap = pdfedMakeRotateHandle();
      rotInner.appendChild(rotWrap);
      handles.rotate = rotWrap.querySelector('.pdfed-rotate-handle');

      pdfedAttachPlacedShapeDragHandlers(el, item, idx, handles, canvasEl);
    } else {
      badgeRow.appendChild(lockBtn);
    }

    layer.appendChild(el);
  });
}

// Drag/resize handling for a placed shape, same smart-snap-to-page/other-
// objects behavior as placed borders/images, plus a live canvas redraw on
// every resize step so lines/arrows/polygons always look right at the new
// size instead of a stretched bitmap.
function pdfedAttachPlacedShapeDragHandlers(el, item, idx, handles, canvasEl) {
  let dragging = false, resizing = false, resizeDir = null;
  let ox = 0, oy = 0, startRect = null;
  let startX = 0, startY = 0, snapTargets = null, beforeSnap = null;
  let edgeLockedX = false, edgeLockedY = false;
  let rotating = false, centerX = 0, centerY = 0, prevAngle = 0;
  const pc = document.getElementById('pdfedPageCanvas');
  const SNAP = 10; // canvas-px snap threshold, same as placed images/text/borders

  el.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    const dir = e.target && e.target.dataset ? e.target.dataset.dir : null;
    if (dir === 'rotate' && handles.rotate === e.target) {
      rotating = true;
      const rect = el.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      prevAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      document.body.style.cursor = PDFED_ROTATE_CURSOR;
      document.body.style.userSelect = 'none';
      el.style.willChange = 'transform';
      handles.rotate.classList.add('is-rotating');
      handles.rotate.style.transform = 'scale(1.15)';
      pdfedShowRotateBadge(e.clientX, e.clientY, item.rotation || 0, false);
    } else if (dir && handles[dir] === e.target) {
      resizing = true; resizeDir = dir;
      ox = e.clientX; oy = e.clientY;
      startRect = { x: item.x, y: item.y, w: item.w, h: item.h };
      snapTargets = pdfedCollectSnapTargets(item.id);
      edgeLockedX = false; edgeLockedY = false;
    } else if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
      dragging = true; ox = e.clientX; oy = e.clientY; startX = item.x; startY = item.y;
      snapTargets = pdfedCollectSnapTargets(item.id);
    } else { return; }
    beforeSnap = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 };
    document.querySelectorAll('.pdfed-placed-shape.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    e.preventDefault(); e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging && !resizing && !rotating) return;
    const pcRect = pc.getBoundingClientRect();
    const scale = pc.width / pcRect.width;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (rotating) {
      // Track the ANGULAR DELTA since the last frame (not since drag-start),
      // and normalize it into (-180, 180] before applying it. atan2 wraps
      // from -180° to +180° at the point directly opposite where the drag
      // began, so measuring from drag-start would make rotation suddenly
      // jump by ~360° the instant the pointer crosses that point. Measuring
      // frame-to-frame and normalizing each small step keeps the turn smooth
      // through any number of full spins.
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let delta = angle - prevAngle;
      delta = ((delta + 180) % 360 + 360) % 360 - 180;
      const newRot = (item.rotation || 0) + delta;
      const normalizedRot = ((newRot % 360) + 360) % 360;
      const snap = pdfedSnapRotationAngle(normalizedRot, e.shiftKey);
      item.rotation = snap.angle;
      prevAngle = angle;
      pdfedPositionPlacedEl(el, item, pc);
      pdfedShowRotateBadge(e.clientX, e.clientY, item.rotation, snap.snapped);
      return;
    }
    if (dragging) {
      let nx = startX + (e.clientX - ox) * scale;
      let ny = startY + (e.clientY - oy) * scale;

      const bestX = pdfedBestSnap([nx, nx + item.w / 2, nx + item.w], (snapTargets || { x: [] }).x, SNAP);
      const bestY = pdfedBestSnap([ny, ny + item.h / 2, ny + item.h], (snapTargets || { y: [] }).y, SNAP);
      if (bestX) nx += bestX.delta;
      if (bestY) ny += bestY.delta;
      if (pdfed.snapGrid) {
        if (!bestX) nx = pdfedSnapToGrid(nx);
        if (!bestY) ny = pdfedSnapToGrid(ny);
      }
      if (guideV) {
        guideV.style.display = bestX ? 'block' : 'none';
        if (bestX) guideV.style.left = (bestX.at * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = bestY ? 'block' : 'none';
        if (bestY) guideH.style.top = (bestY.at * (pdfed.zoom || 1)) + 'px';
      }

      item.x = nx; item.y = ny;
      // Hard clamp: a shape can never be dragged off the page.
      item.x = Math.max(0, Math.min(item.x, pc.width - item.w));
      item.y = Math.max(0, Math.min(item.y, pc.height - item.h));
      pdfedPositionPlacedEl(el, item, pc);
    } else if (resizing) {
      let dx = (e.clientX - ox) * scale, dy = (e.clientY - oy) * scale;
      // Re-express the screen-space delta in the shape's own local axes when
      // rotated, so a corner drag resizes along that corner's visual edge
      // instead of the (now-misaligned) screen axes — see pdfedUnrotateDelta.
      ({ dx, dy } = pdfedUnrotateDelta(dx, dy, item.rotation));
      const r = pdfedResizeRect(resizeDir, startRect, dx, dy, 12, e.shiftKey);

      const north = resizeDir.indexOf('n') !== -1, south = resizeDir.indexOf('s') !== -1;
      const west  = resizeDir.indexOf('w') !== -1, east  = resizeDir.indexOf('e') !== -1;
      const targets = snapTargets || { x: [], y: [] };
      let snapAtX = null, snapAtY = null;

      if (west) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([r.x], targets.x, SNAP);
        if (best) { r.x += best.delta; r.w = Math.max(12, right - r.x); snapAtX = best.at; edgeLockedX = true; }
      } else if (east) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([right], targets.x, SNAP);
        if (best) { r.w = Math.max(12, (right + best.delta) - r.x); snapAtX = best.at; edgeLockedX = true; }
      }
      if (north) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([r.y], targets.y, SNAP);
        if (best) { r.y += best.delta; r.h = Math.max(12, bottom - r.y); snapAtY = best.at; edgeLockedY = true; }
      } else if (south) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([bottom], targets.y, SNAP);
        if (best) { r.h = Math.max(12, (bottom + best.delta) - r.y); snapAtY = best.at; edgeLockedY = true; }
      }

      if (guideV) {
        guideV.style.display = snapAtX !== null ? 'block' : 'none';
        if (snapAtX !== null) guideV.style.left = (snapAtX * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = snapAtY !== null ? 'block' : 'none';
        if (snapAtY !== null) guideH.style.top = (snapAtY * (pdfed.zoom || 1)) + 'px';
      }

      if (west) {
        const right = r.x + r.w;
        r.x = Math.max(0, r.x);
        r.w = right - r.x;
        if (r.x === 0) edgeLockedX = true;
      } else if (east) {
        const right = Math.min(pc.width, r.x + r.w);
        r.w = right - r.x;
        if (right === pc.width) edgeLockedX = true;
      }
      if (north) {
        const bottom = r.y + r.h;
        r.y = Math.max(0, r.y);
        r.h = bottom - r.y;
        if (r.y === 0) edgeLockedY = true;
      } else if (south) {
        const bottom = Math.min(pc.height, r.y + r.h);
        r.h = bottom - r.y;
        if (bottom === pc.height) edgeLockedY = true;
      }
      r.w = Math.max(12, r.w);
      r.h = Math.max(12, r.h);

      item.x = r.x; item.y = r.y; item.w = r.w; item.h = r.h;
      pdfedPositionPlacedEl(el, item, pc);
      pdfedRedrawShapeCanvas(canvasEl, item);
    }
  });
  document.addEventListener('mouseup', () => {
    if (resizing && pdfed.snapGrid) {
      if (!edgeLockedX) {
        const newX = pdfedSnapToGrid(item.x);
        item.w = Math.max(12, pdfedSnapToGrid(item.x + item.w) - newX);
        item.x = newX;
      }
      if (!edgeLockedY) {
        const newY = pdfedSnapToGrid(item.y);
        item.h = Math.max(12, pdfedSnapToGrid(item.y + item.h) - newY);
        item.y = newY;
      }
      pdfedPositionPlacedEl(el, item, pc);
      pdfedRedrawShapeCanvas(canvasEl, item);
    }
    if (dragging || resizing || rotating) pdfedMarkModified(idx);
    if (rotating) {
      pdfedHideRotateBadge();
      el.style.willChange = '';
      document.body.style.userSelect = '';
      if (handles.rotate) { handles.rotate.classList.remove('is-rotating'); handles.rotate.style.transform = ''; }
    }
    if ((dragging || resizing || rotating) && beforeSnap) {
      const before = beforeSnap;
      const after = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 };
      if (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h || before.rotation !== after.rotation) {
        const gIdx = idx;
        pushAppHistory({
          label: rotating ? 'Rotate shape' : resizing ? 'Resize shape' : 'Move shape',
          undo: () => {
            item.x = before.x; item.y = before.y; item.w = before.w; item.h = before.h; item.rotation = before.rotation;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedShapes(gIdx);
          },
          redo: () => {
            item.x = after.x; item.y = after.y; item.w = after.w; item.h = after.h; item.rotation = after.rotation;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedShapes(gIdx);
          }
        });
      }
    }
    beforeSnap = null;
    dragging = false; resizing = false; resizeDir = null; startRect = null; snapTargets = null;
    edgeLockedX = false; edgeLockedY = false;
    rotating = false; centerX = 0; centerY = 0; prevAngle = 0;
    document.body.style.cursor = '';
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
  });
}

function pdfedTogglePlacedShapeLock(idx, id) {
  const list = (pdfed.pages[idx] && pdfed.pages[idx].placedShapes) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  item.locked = !item.locked;
  pdfedRenderPlacedShapes(idx);
  toast(item.locked ? 'Shape locked, unlock to move it' : 'Shape unlocked, drag to move', 'info');
}

function pdfedDeletePlacedShape(idx, id) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedShapes) return;
  const i = pg.placedShapes.findIndex(s => s.id === id);
  if (i === -1) return;
  const removedItem = pg.placedShapes[i], removedIndex = i;
  pg.placedShapes.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedShapes(idx);
  toast('Shape removed', 'success');
  pushAppHistory({
    label: 'Delete shape',
    undo: () => {
      pg.placedShapes.splice(Math.min(removedIndex, pg.placedShapes.length), 0, removedItem);
      pdfedMarkModified(idx);
      pdfedRenderPlacedShapes(idx);
      toast('Shape restored', 'info');
    },
    redo: () => {
      const at = pg.placedShapes.indexOf(removedItem);
      if (at !== -1) pg.placedShapes.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedShapes(idx);
      toast('Shape removed', 'success');
    }
  });
}

function pdfedDuplicatePlacedShape(idx, id) {
  const pg = pdfed.pages[idx];
  const list = (pg && pg.placedShapes) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  const clone = Object.assign({}, item, { id: 'pshp_' + (++pdfedPlacedShapeSeq), x: item.x + 18, y: item.y + 18, locked: false, zIndex: pdfedNextZ(pg) });
  pg.placedShapes.push(clone);
  pdfedMarkModified(idx);
  pdfedRenderPlacedShapes(idx);
  toast('Shape duplicated', 'success');
}

// Turns whatever the person just drew with the Shapes tool (rect, circle,
// line, arrow, star, etc.) into a persistent placed object instead of baked
// pixels, so it's draggable/resizable/lockable from the moment it's drawn.
let pdfedPlacedShapeSeq = 0;
function pdfedCommitPlacedShape(idx, tool) {
  const pg = pdfed.pages[idx];
  if (!pg) return;
  const x1 = pdfedAnnotState.startX, y1 = pdfedAnnotState.startY;
  const x2 = pdfedAnnotState.lastX,  y2 = pdfedAnnotState.lastY;
  const MIN = 12; // a stray tap/click still creates a small, visible, grabbable object
  let w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (w < MIN) w = MIN;
  if (h < MIN) h = MIN;
  if (!pg.placedShapes) pg.placedShapes = [];
  pg.placedShapes.push({
    id: 'pshp_' + (++pdfedPlacedShapeSeq),
    tool: tool,
    color: pdfedAnnotState.color,
    size: pdfedAnnotState.size,
    opacity: pdfedAnnotState.opacity,
    flipX: x2 < x1,
    flipY: y2 < y1,
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: w, h: h,
    locked: false,
    zIndex: pdfedNextZ(pg)
  });
  pdfedMarkModified(idx);
  pdfedRenderPlacedShapes(idx);
  const label = (typeof pdfedShapeLabels !== 'undefined' && pdfedShapeLabels[tool]) ? pdfedShapeLabels[tool] : 'Shape';
  toast(label + ' added — drag to move, resize from any edge/corner', 'success');
  // Smooth, professional flow: once the shape is placed it's already saved
  // (pushed into pg.placedShapes above), so drop straight back into the Hand
  // tool instead of staying primed to draw another shape. That means the very
  // next click on the canvas selects/drags the shape you just made, instead
  // of accidentally starting a new one on top of it.
  pdfedActivateHand();
}

window.pdfedRenderPlacedShapes = pdfedRenderPlacedShapes;
window.pdfedTogglePlacedShapeLock = pdfedTogglePlacedShapeLock;
window.pdfedDeletePlacedShape = pdfedDeletePlacedShape;
window.pdfedDuplicatePlacedShape = pdfedDuplicatePlacedShape;

// ─── LIVE BORDER COLOR ──────────────────────────────────────────────────────
// Two color entry points, both fully "live" (repaint on every input event,
// not just on close/blur):
//   1. The small floating popover opened from a placed border's own "Color"
//      badge — recolors THAT one object only, instantly, while dragging.
//   2. The Border panel's own swatch/hex/native-color controls — set the
//      DEFAULT color new borders will be created with, and ALSO live-recolor
//      whichever border object is currently selected (.selected class,
//      toggled on mousedown same as images/text), so adjusting color while a
//      frame is selected updates it on the page in real time too.

const pdfedBorderColorPop = { idx: -1, id: null };

function pdfedIsValidHex(hex) {
  return typeof hex === 'string' && /^#([0-9a-fA-F]{6})$/.test(hex);
}

// Repaints one placed border's live canvas + its little preview chip with a
// new color, without touching anything else about it (position/size/style).
function pdfedApplyBorderColorToItem(idx, id, hex) {
  const pg = pdfed.pages[idx];
  const item = (pg && pg.placedBorders || []).find(i => i.id === id);
  if (!item) return;
  item.color = hex;
  const el = document.querySelector(`.pdfed-placed-border[data-id="${CSS.escape(id)}"]`);
  const canvasEl = el && el.querySelector('canvas');
  if (canvasEl) pdfedRedrawBorderCanvas(canvasEl, item);
  pdfedMarkModified(idx);
}

function pdfedOpenBorderColorPopover(ev, idx, id) {
  ev.stopPropagation();
  const pop = document.getElementById('pdfedBorderColorPopover');
  if (!pop) return;
  const item = (pdfed.pages[idx] && pdfed.pages[idx].placedBorders || []).find(i => i.id === id);
  if (!item) return;
  pdfedBorderColorPop.idx = idx; pdfedBorderColorPop.id = id;
  const hex = item.color || '#FFD600';
  document.getElementById('pdfedBorderColorPopoverNative').value = hex;
  document.getElementById('pdfedBorderColorPopoverHex').value = hex;
  pop.classList.add('show');
  let left = ev.clientX - 30;
  let top = ev.clientY + 14;
  const popW = 170, popH = 44;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (left < 8) left = 8;
  if (top + popH > window.innerHeight - 8) top = ev.clientY - popH - 14;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function pdfedCloseBorderColorPopover() {
  const pop = document.getElementById('pdfedBorderColorPopover');
  if (pop) pop.classList.remove('show');
  pdfedBorderColorPop.idx = -1; pdfedBorderColorPop.id = null;
}

// Fired on every native <input type=color> drag tick — genuinely live.
function pdfedBorderColorPopoverInput(hex) {
  const { idx, id } = pdfedBorderColorPop;
  if (id == null) return;
  document.getElementById('pdfedBorderColorPopoverHex').value = hex;
  pdfedApplyBorderColorToItem(idx, id, hex);
}

// Fired as the person types a hex value directly; only repaints once it's a
// complete, valid 6-digit hex so partial typing doesn't flash odd colors.
function pdfedBorderColorPopoverHexTyped(hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (!pdfedIsValidHex(hex)) return;
  const { idx, id } = pdfedBorderColorPop;
  if (id == null) return;
  document.getElementById('pdfedBorderColorPopoverNative').value = hex;
  pdfedApplyBorderColorToItem(idx, id, hex);
}

document.addEventListener('mousedown', (e) => {
  const pop = document.getElementById('pdfedBorderColorPopover');
  if (!pop || !pop.classList.contains('show')) return;
  if (e.target.closest('#pdfedBorderColorPopover') || e.target.closest('.pdfed-badge-btn')) return;
  pdfedCloseBorderColorPopover();
});

// ── Border-panel default color (used for every new border going forward) ──
// Also live-recolors whichever placed border is currently selected on the
// active page, if any, so changing the default while a frame is selected
// updates that frame on the spot instead of only affecting future ones.
function pdfedBorderApplyLiveToSelected(hex) {
  if (pdfed.active < 0) return;
  const selEl = document.querySelector('.pdfed-placed-border.selected');
  if (!selEl) return;
  pdfedApplyBorderColorToItem(pdfed.active, selEl.dataset.id, hex);
}

function pdfedBorderColorInput(hex) {
  pdfedBorderState.color = hex;
  const prev = document.getElementById('pdfedBorderColorPreview');
  const hexInput = document.getElementById('pdfedBorderColorHexInput');
  if (prev) prev.style.background = hex;
  if (hexInput) hexInput.value = hex;
  pdfedBorderApplyLiveToSelected(hex);
}

function pdfedBorderColorHexTyped(hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (!pdfedIsValidHex(hex)) return;
  pdfedBorderState.color = hex;
  const prev = document.getElementById('pdfedBorderColorPreview');
  const nativeInput = document.getElementById('pdfedBorderColorNative');
  if (prev) prev.style.background = hex;
  if (nativeInput) nativeInput.value = hex;
  pdfedBorderApplyLiveToSelected(hex);
}

window.pdfedOpenBorderColorPopover = pdfedOpenBorderColorPopover;
window.pdfedCloseBorderColorPopover = pdfedCloseBorderColorPopover;
window.pdfedBorderColorPopoverInput = pdfedBorderColorPopoverInput;
window.pdfedBorderColorPopoverHexTyped = pdfedBorderColorPopoverHexTyped;
window.pdfedBorderColorInput = pdfedBorderColorInput;
window.pdfedBorderColorHexTyped = pdfedBorderColorHexTyped;

// ── COLOR WHEEL ──────────────────────────────────────────────────────────────
// Store last picked position in canvas coords for accurate indicator
let pdfedWheelIndicator = { x: null, y: null };

function pdfedDrawColorWheel() {
  const canvas = document.getElementById('pdfedColorWheel');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, r = cx - 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clip everything to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Hue ring
  for (let angle = 0; angle < 360; angle++) {
    const startAngle = (angle - 1) * Math.PI / 180;
    const endAngle = (angle + 1) * Math.PI / 180;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `hsla(${angle},0%,100%,1)`);
    gradient.addColorStop(0.5, `hsla(${angle},100%,50%,1)`);
    gradient.addColorStop(1, `hsla(${angle},100%,10%,1)`);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // Centre black circle for dark shades
  const darkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.18);
  darkGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
  darkGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = darkGrad; ctx.fill();

  // White centre highlight
  const whiteGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.08);
  whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
  whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = whiteGrad; ctx.fill();

  ctx.restore(); // end clip

  // Draw indicator at last clicked position (or default center-right if none)
  const currentHex = pdfedAnnotState.color || '#FFD600';
  let ix, iy;
  if (pdfedWheelIndicator.x !== null) {
    ix = pdfedWheelIndicator.x;
    iy = pdfedWheelIndicator.y;
  } else {
    // Default: place near a yellow-ish position on first open
    ix = cx + r * 0.6;
    iy = cy;
  }
  ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(ix, iy, 4, 0, Math.PI * 2);
  ctx.fillStyle = currentHex; ctx.fill();
}

function pdfedDrawMiniWheel(activeColor) {
  const canvas = document.getElementById('pdfedColorWheelMini');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, r = cx - 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Clip to circle first
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  for (let angle = 0; angle < 360; angle++) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `hsla(${angle},0%,100%,1)`);
    grad.addColorStop(0.5, `hsla(${angle},100%,50%,1)`);
    grad.addColorStop(1, `hsla(${angle},100%,10%,1)`);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, (angle-1)*Math.PI/180, (angle+1)*Math.PI/180);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }
  ctx.restore();
  // ring border showing active color
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.strokeStyle = activeColor || '#FFD600'; ctx.lineWidth = 3; ctx.stroke();
}

// Click on wheel to pick color
(function() {
  function pdfedWheelPickAt(clientX, clientY) {
    const canvas = document.getElementById('pdfedColorWheel');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Scale CSS pixel coords → canvas pixel coords (handles DPR & CSS sizing)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    // Clamp to canvas bounds
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const ctx = canvas.getContext('2d');
    const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    if (px[3] < 10) return; // transparent (outside circle)
    const hex = '#' + [px[0],px[1],px[2]].map(v => v.toString(16).padStart(2,'0')).join('');
    pdfedAnnotState.color = hex;
    pdfedAnnotState.colorTouched = true;
    // Save exact canvas coords so indicator draws at the real click spot
    pdfedWheelIndicator.x = x;
    pdfedWheelIndicator.y = y;
    pdfedSyncColorUI(hex);
    pdfedDrawColorWheel();
  }

  function initWheelEvents() {
    const c = document.getElementById('pdfedColorWheel');
    if (!c) return;
    let dragging = false;

    // Mouse events
    c.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      pdfedWheelPickAt(e.clientX, e.clientY);
    });
    c.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      e.preventDefault();
      pdfedWheelPickAt(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    // Touch events
    c.addEventListener('touchstart', function(e) {
      e.preventDefault();
      const t = e.touches[0];
      pdfedWheelPickAt(t.clientX, t.clientY);
    }, { passive: false });
    c.addEventListener('touchmove', function(e) {
      e.preventDefault();
      const t = e.touches[0];
      pdfedWheelPickAt(t.clientX, t.clientY);
    }, { passive: false });
  }

  // Attach after DOM is ready (use both DOMContentLoaded and load as fallback)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWheelEvents);
  } else {
    initWheelEvents();
  }
  window.addEventListener('load', initWheelEvents); // safe double-init
})();

function pdfedColorHexTyped(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    pdfedAnnotState.color = val;
    pdfedAnnotState.colorTouched = true;
    pdfedWheelIndicator.x = null; // reset to let it fall back to default
    pdfedWheelIndicator.y = null;
    const preview = document.getElementById('pdfedColorPreview');
    if (preview) preview.style.background = val;
    pdfedDrawMiniWheel(val);
    pdfedDrawColorWheel();
    const norm = val.toLowerCase();
    document.querySelectorAll('.pdfed-color-dot').forEach(d => {
      d.classList.toggle('active', (d.dataset.color || '').toLowerCase() === norm);
    });
  }
}

function pdfedHexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

// Init mini wheel on load
window.addEventListener('load', function() {
  pdfedDrawMiniWheel(pdfedAnnotState.color || '#FFD600');
});

// Save current annot canvas state as undo snapshot
function pdfedAnnotPushUndo() {
  const idx = pdfed.active;
  if (idx < 0) return;
  const stack = pdfedStrokesFor(idx);
  const times = pdfedStrokeTimesFor(idx);
  const ac = pdfedGetAnnotCanvas();
  stack.push(ac.toDataURL());
  times.push(nextHistoryTick());
  // cap at 20 undos per page
  if (stack.length > 20) { stack.shift(); times.shift(); }
  // a new action invalidates any previous redo history for this page
  pdfedClearRedoStrokesFor(idx);
  pdfedRedoStrokeTimesFor(idx).length = 0;
}

function pdfedUndo() {
  const idx = pdfed.active;
  if (idx < 0) return;
  const stack = pdfedStrokesFor(idx);
  const times = pdfedStrokeTimesFor(idx);
  if (!stack || stack.length === 0) { toast('Nothing to undo', 'info'); return; }
  const ac = pdfedGetAnnotCanvas();
  const ctx = ac.getContext('2d');
  // stash the current (pre-undo) state into the redo stack
  const redoStack = pdfedRedoStrokesFor(idx);
  const redoTimes = pdfedRedoStrokeTimesFor(idx);
  redoStack.push(ac.toDataURL());
  redoTimes.push(nextHistoryTick());
  if (redoStack.length > 20) { redoStack.shift(); redoTimes.shift(); }
  stack.pop(); times.pop(); // remove current
  ctx.clearRect(0, 0, ac.width, ac.height);
  if (stack.length > 0) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = stack[stack.length - 1];
  }
  pdfedMarkModified(idx);
}

function pdfedRedo() {
  const idx = pdfed.active;
  if (idx < 0) return;
  const redoStack = pdfedRedoStrokesFor(idx);
  const redoTimes = pdfedRedoStrokeTimesFor(idx);
  if (!redoStack || redoStack.length === 0) { toast('Nothing to redo', 'info'); return; }
  const ac = pdfedGetAnnotCanvas();
  const ctx = ac.getContext('2d');
  const dataUrl = redoStack.pop(); redoTimes.pop();
  const stack = pdfedStrokesFor(idx);
  const times = pdfedStrokeTimesFor(idx);
  stack.push(dataUrl);
  times.push(nextHistoryTick());
  if (stack.length > 20) { stack.shift(); times.shift(); }
  ctx.clearRect(0, 0, ac.width, ac.height);
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0);
  img.src = dataUrl;
  pdfedMarkModified(idx);
}

function pdfedClearAnnotations() {
  const idx = pdfed.active;
  if (idx < 0) return;
  if (!confirm('Clear all annotations on this page?')) return;
  const ac = pdfedGetAnnotCanvas();
  ac.getContext('2d').clearRect(0, 0, ac.width, ac.height);
  pdfedClearStrokesFor(idx);
  pdfedMarkModified(idx);
  toast('Annotations cleared', 'info');
}

// Debounced per-page timers so live-preview thumbnail refreshes don't hammer
// canvas compositing on every mousemove while dragging/resizing a placed
// image or text box, only the last event in a burst actually redraws.
// The glow/badge react instantly (0ms) so the nav *feels* like it updated
// the moment you edit; the actual pixel recompute follows a beat later.
const _pdfedThumbRefreshTimers = {};
function pdfedMarkModified(idx) {
  if (pdfed.pages[idx]) pdfed.pages[idx].modified = true;
  pdfedPersist();
  pdfedRefreshEditCount();
  const strip = document.getElementById('pdfedStrip');
  const card = strip && strip.querySelector('.pdfed-thumb[data-idx="' + idx + '"]');
  if (card) card.classList.add('refreshing');
  const liveTag = document.getElementById('pdfedStripLive');
  if (liveTag) liveTag.classList.add('on');
  clearTimeout(_pdfedThumbRefreshTimers[idx]);
  _pdfedThumbRefreshTimers[idx] = setTimeout(() => { _pdfedThumbRefreshTimers[idx] = null; pdfedRefreshThumb(idx); }, 90);
}

// ─── Translate page text (opt-in) ───────────────────────────────────────
// Translates every text box's text on ONE page object in place. Pure
// per-page work only -- no DOM refresh, no "modified" flag, no toast --
// so callers can translate a whole batch of pages (all of them, or a
// mixed set of different target languages per page) and only pay for one
// render/toast at the end, instead of once per page. Shared by
// pdfedTranslatePageText (this page), pdfedTranslateAllPagesText (every
// page), and Kadessa's pdfed_translate_pages action.
async function pdfedTranslatePageItems(pg, lang) {
  const items = (pg && pg.placedTexts) || [];
  const translatable = items.filter(it => (it.text || '').trim());
  let translatedCount = 0, errorCount = 0;
  for (const item of translatable) {
    try {
      const translated = await sarvarcTranslateText(item.text.trim(), lang);
      item.text = translated;
      item.html = daEsc(translated);
      translatedCount++;
    } catch (e) {
      errorCount++;
    }
    await new Promise(r => setTimeout(r, 350)); // stay well within the free API's rate limit
  }
  return { translatedCount, errorCount, total: translatable.length };
}

// Translates every text box on the current page in place. This edit is
// undoable (Ctrl+Z / the Undo button) like any other change on the page, so
// nothing is permanently lost if the result isn't wanted. Only this page's
// text is sent out, and only after the user picks a language and confirms.
let pdfedTranslating = false;
async function pdfedTranslatePageText() {
  if (pdfedTranslating) { toast('Already translating — please wait for it to finish', 'info'); return; }
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  const items = (pg && pg.placedTexts) || [];
  const translatable = items.filter(it => (it.text || '').trim());
  if (!translatable.length) { toast('No text on this page yet — click "OCR" first to scan the page\'s text, or add some with "Add Text"', 'info'); return; }

  const targetLang = prompt('Translate this page\'s text into which language?\n\nType a language code, for example:\n' + SARVARC_LANG_HINTS, 'hi');
  if (!targetLang || !targetLang.trim()) return;
  const lang = targetLang.trim().toLowerCase();

  const ok = confirm(`Send this page's text to MyMemory Translation API to translate into "${lang}"?\n\nThe text on this page will be replaced with the translation — press Ctrl+Z afterwards if you want it back. Only this page's text is sent, nothing else in your workspace leaves the browser.`);
  if (!ok) return;

  pdfedTranslating = true;
  toast('Translating this page…', 'info');
  const { translatedCount, errorCount } = await pdfedTranslatePageItems(pg, lang);
  pdfedRenderPlacedTexts(idx);
  pdfedMarkModified(idx);
  pdfedTranslating = false;
  toast(errorCount ? `Translated ${translatedCount} text boxes, ${errorCount} failed (try again for those)` : `Translated ${translatedCount} text boxes into "${lang}"`, errorCount ? 'error' : 'success');
}

// Translates every text box on EVERY page of the document into the same
// target language -- one prompt and one confirm up front, instead of the
// person repeating "This Page" once per page. Each page keeps translating
// even if another page's boxes fail, and the final toast reports the total
// across the whole document.
async function pdfedTranslateAllPagesText() {
  if (pdfedTranslating) { toast('Already translating — please wait for it to finish', 'info'); return; }
  if (!pdfed.pages.length) { toast('Open a document first', 'error'); return; }

  const totalBoxes = pdfed.pages.reduce((sum, pg) => sum + ((pg.placedTexts || []).filter(it => (it.text || '').trim()).length), 0);
  if (!totalBoxes) { toast('No text anywhere in this document yet — click "OCR" on a page first, or add some with "Add Text"', 'info'); return; }

  const targetLang = prompt('Translate EVERY page\'s text into which language?\n\nType a language code, for example:\n' + SARVARC_LANG_HINTS, 'hi');
  if (!targetLang || !targetLang.trim()) return;
  const lang = targetLang.trim().toLowerCase();

  const ok = confirm(`Send all ${pdfed.pages.length} pages' text (${totalBoxes} text boxes total) to MyMemory Translation API to translate into "${lang}"?\n\nEvery page's text will be replaced with the translation — press Ctrl+Z on a page afterwards if you want just that page back. Only this document's text is sent, nothing else in your workspace leaves the browser.`);
  if (!ok) return;

  pdfedTranslating = true;
  toast('Translating ' + pdfed.pages.length + ' pages…', 'info');
  let translatedCount = 0, errorCount = 0;
  for (let idx = 0; idx < pdfed.pages.length; idx++) {
    const r = await pdfedTranslatePageItems(pdfed.pages[idx], lang);
    translatedCount += r.translatedCount;
    errorCount += r.errorCount;
    pdfedMarkModified(idx);
  }
  pdfedRenderPlacedTexts(pdfed.active); // refresh whatever page is on screen right now
  pdfedTranslating = false;
  toast(errorCount ? `Translated ${translatedCount} text boxes across ${pdfed.pages.length} pages, ${errorCount} failed` : `Translated ${translatedCount} text boxes across ${pdfed.pages.length} pages into "${lang}"`, errorCount ? 'error' : 'success');
}

// Kadessa's version of the above: `pages`/`page_overrides` work exactly like
// pdfed_set_canvas_gradient's, but the per-page field is a target language
// instead of a colour, so "translate the whole document to Hindi, but
// page 3 into Gujarati" is one call:
//   lang: 'hi', pages: 'all', page_overrides: [{page: 3, lang: 'gu'}]
// A page appearing only in page_overrides is translated too, even if it
// wasn't included in `pages`. No browser prompt/confirm here -- Kadessa's own
// one-line narration before calling this IS the opt-in, same as every
// other Kadessa action.
async function pdfedKadessaTranslatePages(p) {
  if (pdfedTranslating) throw new Error('already translating, please wait for it to finish');
  if (!pdfed.pages.length) throw new Error('open a document first');
  p = p || {};

  const total = pdfed.pages.length;
  let basePages;
  if (p.pages === 'all') {
    basePages = Array.from({ length: total }, (_, i) => i + 1);
  } else if (Array.isArray(p.pages) && p.pages.length) {
    basePages = p.pages.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= total);
  } else {
    basePages = [(pdfed.active < 0 ? 0 : pdfed.active) + 1];
  }

  const baseLang = typeof p.lang === 'string' ? p.lang.trim().toLowerCase() : '';

  // pageNum -> lang, base first so page_overrides can win the same page.
  const targets = new Map();
  if (baseLang) for (const num of basePages) targets.set(num, baseLang);
  if (Array.isArray(p.page_overrides)) {
    for (const ov of p.page_overrides) {
      const num = ov && parseInt(ov.page, 10);
      const lang = ov && typeof ov.lang === 'string' ? ov.lang.trim().toLowerCase() : '';
      if (!num || num < 1 || num > total || !lang) continue;
      targets.set(num, lang);
    }
  }
  if (!targets.size) throw new Error('give a target language, either as lang or inside page_overrides');

  pdfedTranslating = true;
  let translatedCount = 0, errorCount = 0, pagesDone = 0;
  try {
    for (const [num, lang] of targets) {
      const idx = num - 1;
      const r = await pdfedTranslatePageItems(pdfed.pages[idx], lang);
      translatedCount += r.translatedCount;
      errorCount += r.errorCount;
      pdfedMarkModified(idx);
      pagesDone++;
    }
  } finally {
    pdfedTranslating = false;
  }
  pdfedRenderPlacedTexts(pdfed.active);
  return { pagesTranslated: pagesDone, translatedCount, errorCount };
}

// Bake annotation canvas INTO the page canvas (called before page navigation / export)
function pdfedBakeAnnotations() {
  const ac = document.getElementById('pdfedAnnotCanvas');
  if (!ac || !ac.width) return;
  const pc = document.getElementById('pdfedPageCanvas');
  const ctx = pc.getContext('2d');
  ctx.drawImage(ac, 0, 0);
  // Persist the merged result back into the page's own data model. Without
  // this, the merge only ever lived in the on-screen <canvas> element — the
  // moment you navigated to another page (and pdfedClearStrokesFor below
  // wiped the stroke history, thinking it was "already baked"), the drawn
  // lines/shapes/pen strokes were gone from both places export reads from
  // (pg.dataUrl and pg.annotStrokes), so they silently vanished from any
  // PDF exported afterward.
  if (pdfed.active >= 0 && pdfed.pages[pdfed.active]) {
    pdfed.pages[pdfed.active].dataUrl = pc.toDataURL('image/png');
  }
  // clear annot canvas after bake
  ac.getContext('2d').clearRect(0, 0, ac.width, ac.height);
  // clear undo stack for this page (already baked)
  if (pdfed.active >= 0) pdfedClearStrokesFor(pdfed.active);
}

// Restore annot canvas from last undo snapshot when re-visiting page
function pdfedRestoreAnnotCanvas(idx) {
  const stack = pdfedStrokesFor(idx);
  const ac = pdfedGetAnnotCanvas();
  const ctx = ac.getContext('2d');
  ctx.clearRect(0, 0, ac.width, ac.height);
  if (stack && stack.length > 0) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = stack[stack.length - 1];
  }
}

// ── Smart Redact ────────────────────────────────────────────────────────────
// A hand-dragged redact box is rarely pixel-perfect over the text/content it's
// meant to hide, OCR line boxes especially can run a few px past wherever the
// person actually dragged. Rather than leave a black box that's a hair short
// (letting a sliver of the real OCR text, a placed image/text/table, or a bit
// of native PDF text peek out at an edge), this expands the just-drawn box
// outward to fully cover anything it meaningfully overlaps, then repaints it
// cleanly from the pre-stroke snapshot so the box never double-draws.
function pdfedSmartRedactFinalize(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return;
  let x1 = Math.min(pdfedAnnotState.startX, pdfedAnnotState.lastX);
  let y1 = Math.min(pdfedAnnotState.startY, pdfedAnnotState.lastY);
  let x2 = Math.max(pdfedAnnotState.startX, pdfedAnnotState.lastX);
  let y2 = Math.max(pdfedAnnotState.startY, pdfedAnnotState.lastY);
  if (x2 - x1 < 2 || y2 - y1 < 2) return; // ignore a stray click/tap

  const PAD = 4; // small margin so edges/anti-aliasing never peek out
  const overlaps = (bx, by, bw, bh) => {
    if (!(bw > 0) || !(bh > 0)) return false;
    const ox = Math.min(x2, bx + bw) - Math.max(x1, bx);
    const oy = Math.min(y2, by + bh) - Math.max(y1, by);
    if (ox <= 0 || oy <= 0) return false;
    // Require the drag to meaningfully touch the block (not just brush a
    // stray corner) so a box drawn *near* — but not really over, a text
    // line or image doesn't balloon out to swallow it.
    return (ox * oy) / (bw * bh) > 0.15;
  };
  const grow = (bx, by, bw, bh) => {
    x1 = Math.min(x1, bx - PAD);
    y1 = Math.min(y1, by - PAD);
    x2 = Math.max(x2, bx + bw + PAD);
    y2 = Math.max(y2, by + bh + PAD);
  };

  // OCR / edited text blocks (from the Edit Text tool, this is the "OCR"
  // layer that used to peek out from under redact boxes).
  (pg.textBlocks || []).forEach(tb => {
    const w = tb.origWidth  || (tb.fontSize ? tb.fontSize * ((tb.text || tb.origText || '').length || 1) * 0.55 : 0);
    const h = tb.origHeight || (tb.fontSize ? tb.fontSize * 1.4 : 0);
    if (overlaps(tb.x, tb.y, w, h)) grow(tb.x, tb.y, w, h);
  });
  // Placed/stamped content, images, text boxes, tables.
  (pg.placedTexts  || []).forEach(it => { if (overlaps(it.x, it.y, it.w, it.h)) grow(it.x, it.y, it.w, it.h); });
  (pg.placedImages || []).forEach(it => { if (!it._watermark && overlaps(it.x, it.y, it.w, it.h)) grow(it.x, it.y, it.w, it.h); });
  (pg.placedTables || []).forEach(it => { if (overlaps(it.x, it.y, it.w, it.h)) grow(it.x, it.y, it.w, it.h); });
  // Native, un-edited PDF text runs (cached by the search feature) — covers
  // real embedded text on genuine PDF pages, not just scanned/OCR'd ones.
  const cachedItems = (typeof pdfSearch !== 'undefined' && pdfSearch.cache) ? pdfSearch.cache.get(pg) : null;
  if (cachedItems) {
    cachedItems.forEach(it => {
      const h = it.fontSize * 1.3;
      if (overlaps(it.x, it.y, it.width, h)) grow(it.x, it.y, it.width, h);
    });
  }

  const ac = pdfedGetAnnotCanvas();
  const ctx = ac.getContext('2d');
  const stack = pdfedStrokesFor(idx);
  const pre = stack[stack.length - 1]; // pre-stroke snapshot pushed in onDown

  const paint = () => {
    ctx.fillStyle = pdfedAnnotState.color;
    ctx.globalAlpha = 1;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  };
  if (pre) {
    const img = new Image();
    img.onload = () => { ctx.clearRect(0, 0, ac.width, ac.height); ctx.drawImage(img, 0, 0); paint(); };
    img.src = pre;
  } else {
    paint();
  }
}

// ── Smart Highlight ─────────────────────────────────────────────────────────
// Same problem as Smart Redact, different tool: a freehand highlighter stroke
// almost never lines up perfectly with a line of OCR/PDF text, it might dip
// below the baseline, clip the top of tall letters, or trail off a few px
// short of the line's real edge. On top of the freehand mark already drawn,
// this washes a clean, even highlight rectangle over every OCR/edited text
// block, placed text box, and native PDF text run the stroke actually
// touched, so a highlighted line always looks fully and evenly covered
// instead of half-swiped. If the stroke isn't over anything recognizable
// (e.g. free-hand highlighting an image or blank area), it's left as-is.
function pdfedSmartHighlightFinalize(idx) {
  const pg = pdfed.pages[idx];
  if (!pg) return;
  const x1 = Math.min(pdfedAnnotState.minX, pdfedAnnotState.maxX);
  const y1 = Math.min(pdfedAnnotState.minY, pdfedAnnotState.maxY);
  const x2 = Math.max(pdfedAnnotState.minX, pdfedAnnotState.maxX);
  const y2 = Math.max(pdfedAnnotState.minY, pdfedAnnotState.maxY);
  if (x2 - x1 < 2 && y2 - y1 < 2) return; // a stray tap, nothing to snap to

  const overlaps = (bx, by, bw, bh) => {
    if (!(bw > 0) || !(bh > 0)) return false;
    const ox = Math.min(x2, bx + bw) - Math.max(x1, bx);
    const oy = Math.min(y2, by + bh) - Math.max(y1, by);
    if (ox <= 0 || oy <= 0) return false;
    return (ox * oy) / (bw * bh) > 0.12;
  };

  // Collect every recognizable text/content block the stroke actually
  // touched, each one gets its own clean rectangle, so two separate lines
  // with a gap between them don't get bridged into one solid highlighted
  // block covering the blank space in between.
  const targets = [];
  (pg.textBlocks || []).forEach(tb => {
    const w = tb.origWidth  || (tb.fontSize ? tb.fontSize * ((tb.text || tb.origText || '').length || 1) * 0.55 : 0);
    const h = tb.origHeight || (tb.fontSize ? tb.fontSize * 1.4 : 0);
    if (overlaps(tb.x, tb.y, w, h)) targets.push({ x: tb.x, y: tb.y, w, h });
  });
  (pg.placedTexts || []).forEach(it => { if (overlaps(it.x, it.y, it.w, it.h)) targets.push({ x: it.x, y: it.y, w: it.w, h: it.h }); });
  const cachedItems = (typeof pdfSearch !== 'undefined' && pdfSearch.cache) ? pdfSearch.cache.get(pg) : null;
  if (cachedItems) {
    cachedItems.forEach(it => {
      const h = it.fontSize * 1.3;
      if (overlaps(it.x, it.y, it.width, h)) targets.push({ x: it.x, y: it.y, w: it.width, h });
    });
  }
  if (!targets.length) return;

  const ac = pdfedGetAnnotCanvas();
  const ctx = ac.getContext('2d');
  const PAD_X = 2, PAD_Y = 1;
  const padded = targets.map(t => ({ x: t.x - PAD_X, y: t.y - PAD_Y, w: t.w + PAD_X * 2, h: t.h + PAD_Y * 2 }));

  // Two (or more) targets can overlap each other (e.g. adjacent OCR word
  // boxes on the same line). Painting each one directly at partial alpha
  // would double-blend the shared area into a visibly darker patch — and
  // merging them by growing a bounding box (tried previously) is worse: a
  // grown box can touch a next rect it never really overlapped and swallow
  // it too, cascading into giant unrelated regions.
  // Instead, paint every rect fully opaque onto an offscreen mask canvas
  // first — overlaps there just overwrite the same pixels, no blending, no
  // growth — then composite that mask onto the real canvas once at the
  // highlight's alpha. Every pixel ends up painted exactly once, and the
  // shape is exactly the union of the real text boxes, nothing more.
  const mask = document.createElement('canvas');
  mask.width = ac.width;
  mask.height = ac.height;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = pdfedAnnotState.color;
  padded.forEach(t => { mctx.fillRect(t.x, t.y, t.w, t.h); });

  const paint = () => {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, pdfedAnnotState.opacity * 0.5);
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  };

  // The freehand stroke just drawn during the drag rarely matches the exact
  // OCR/text bbox, so painting the clean rects on top of it (as before) left
  // the ragged stroke peeking out around the crisp rectangle — an "underlap"
  // of two mismatched highlight shapes. Restore the pre-stroke snapshot first
  // (same fix already used in Smart Redact) so the freehand stroke is fully
  // replaced by the clean rects instead of showing through underneath them.
  const stack = pdfedStrokesFor(idx);
  const pre = stack[stack.length - 1]; // pre-stroke snapshot pushed in onDown
  if (pre) {
    const img = new Image();
    img.onload = () => { ctx.clearRect(0, 0, ac.width, ac.height); ctx.drawImage(img, 0, 0); paint(); };
    img.src = pre;
  } else {
    paint();
  }
}

// ── Mouse/Touch events on annotation canvas ──
function pdfedAnnotInit() {
  const ac = document.getElementById('pdfedAnnotCanvas');

  function getPos(e) {
    const rect = ac.getBoundingClientRect();
    const scaleX = ac.width / rect.width;
    const scaleY = ac.height / rect.height;
    const client = e.touches ? e.touches[0] : e;
    return {
      x: (client.clientX - rect.left) * scaleX,
      y: (client.clientY - rect.top) * scaleY
    };
  }

  let previewSnapshot = null; // for shape previews

  ac.addEventListener('mousedown', onDown);
  ac.addEventListener('touchstart', onDown, { passive: false });
  ac.addEventListener('mousemove', onMove);
  ac.addEventListener('touchmove', onMove, { passive: false });
  ac.addEventListener('mouseup', onUp);
  ac.addEventListener('touchend', onUp);

  function onDown(e) {
    if (!pdfedAnnotState.tool) return;
    e.preventDefault();
    const pos = getPos(e);
    pdfedAnnotState.drawing = true;
    pdfedAnnotState.startX = pos.x;
    pdfedAnnotState.startY = pos.y;
    pdfedAnnotState.lastX = pos.x;
    pdfedAnnotState.lastY = pos.y;
    pdfedAnnotState.minX = pos.x; pdfedAnnotState.minY = pos.y;
    pdfedAnnotState.maxX = pos.x; pdfedAnnotState.maxY = pos.y;
    // Smoothing state for the draw/eraser/highlight freehand tools: rawLast
    // feeds the low-pass filter (absorbs hand-tremor jitter), smoothPtA/
    // smoothMid are the running control-point/anchor pair for the
    // incremental quadratic-curve-through-midpoints chain drawn in onMove
    // (same technique as the signature pad's pdfedSigRedraw, just drawn
    // incrementally instead of by redrawing the whole stroke every frame).
    pdfedAnnotState.rawLast = { x: pos.x, y: pos.y };
    pdfedAnnotState.smoothPtA = { x: pos.x, y: pos.y };
    pdfedAnnotState.smoothMid = { x: pos.x, y: pos.y };

    if (pdfedAnnotState.tool === 'addtext') {
      // click to place a text box
      pdfedAnnotState.drawing = false;
      pdfedPlaceTextLabel(pos.x, pos.y);
      return;
    }

    if (pdfedAnnotState.tool === 'link') {
      // click to place a hyperlink
      pdfedAnnotState.drawing = false;
      pdfedPlaceLinkLabel(pos.x, pos.y);
      return;
    }

    // Save snapshot for undo before starting
    pdfedAnnotPushUndo();
    previewSnapshot = pdfedGetAnnotCanvas().toDataURL();
  }

  function onMove(e) {
    if (!pdfedAnnotState.drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    pdfedAnnotState.minX = Math.min(pdfedAnnotState.minX, pos.x);
    pdfedAnnotState.minY = Math.min(pdfedAnnotState.minY, pos.y);
    pdfedAnnotState.maxX = Math.max(pdfedAnnotState.maxX, pos.x);
    pdfedAnnotState.maxY = Math.max(pdfedAnnotState.maxY, pos.y);
    // Shape tools don't hit the draw/eraser/highlight branches below, so
    // still track the raw live pointer position here — pdfedCommitPlacedShape
    // needs the exact release point at mouseup to build the shape's box.
    pdfedAnnotState.lastX = pos.x;
    pdfedAnnotState.lastY = pos.y;
    const ac = pdfedGetAnnotCanvas();
    const ctx = ac.getContext('2d');
    const tool = pdfedAnnotState.tool;
    const color = pdfedAnnotState.color;
    const size = pdfedAnnotState.size;

    if (tool === 'draw' || tool === 'eraser' || tool === 'highlight') {
      // Low-pass filter toward the new raw point (same 0.35/0.65 blend the
      // signature pad uses) so small hand tremors get absorbed instead of
      // drawn, then extend the running quadratic-curve-through-midpoints
      // chain by one segment: from the last drawn midpoint, curving through
      // the previous point, to the new midpoint between it and this point.
      // This is what actually makes the stroke look like an ink line instead
      // of a series of straight, faceted segments between mousemove samples.
      const rawLast = pdfedAnnotState.rawLast;
      const filtered = { x: rawLast.x * 0.35 + pos.x * 0.65, y: rawLast.y * 0.35 + pos.y * 0.65 };
      pdfedAnnotState.rawLast = { x: pos.x, y: pos.y };
      const ptA = pdfedAnnotState.smoothPtA;
      const midPrev = pdfedAnnotState.smoothMid;
      const midNew = { x: (ptA.x + filtered.x) / 2, y: (ptA.y + filtered.y) / 2 };

      ctx.beginPath();
      ctx.moveTo(midPrev.x, midPrev.y);
      ctx.quadraticCurveTo(ptA.x, ptA.y, midNew.x, midNew.y);
      if (tool === 'draw') {
        ctx.strokeStyle = color;
        ctx.globalAlpha = pdfedAnnotState.opacity;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (tool === 'eraser') {
        // Erase by drawing in destination-out composite
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = size * 5; // eraser is wider than pen
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.stroke();
        ctx.restore();
      } else {
        // highlight
        ctx.strokeStyle = color;
        ctx.globalAlpha = Math.min(0.5, pdfedAnnotState.opacity * 0.5);
        ctx.lineWidth = Math.max(size * 4, 20);
        ctx.lineCap = 'square';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      pdfedAnnotState.smoothMid = midNew;
      pdfedAnnotState.smoothPtA = filtered;
    } else {
      // Shape tools: restore snapshot then draw preview
      if (previewSnapshot) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, ac.width, ac.height);
          ctx.drawImage(img, 0, 0);
          drawShape(ctx, tool, color, size, pdfedAnnotState.startX, pdfedAnnotState.startY, pos.x, pos.y);
        };
        img.src = previewSnapshot;
      } else {
        ctx.clearRect(0, 0, ac.width, ac.height);
        drawShape(ctx, tool, color, size, pdfedAnnotState.startX, pdfedAnnotState.startY, pos.x, pos.y);
      }
    }
  }

  function onUp(e) {
    if (!pdfedAnnotState.drawing) return;
    pdfedAnnotState.drawing = false;
    previewSnapshot = null;
    const tool = pdfedAnnotState.tool;
    const idx = pdfed.active;

    if ((tool === 'draw' || tool === 'eraser' || tool === 'highlight') && pdfedAnnotState.smoothPtA) {
      // The incremental quadratic chain in onMove always stops one midpoint
      // short of the actual last point (by design, so the curve stays
      // smooth) — finish it off with one straight segment out to the real
      // final point, same as the signature pad's closing ctx.lineTo.
      const ac = pdfedGetAnnotCanvas();
      const ctx = ac.getContext('2d');
      const mid = pdfedAnnotState.smoothMid, last = pdfedAnnotState.smoothPtA;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(last.x, last.y);
      if (tool === 'draw') {
        ctx.strokeStyle = pdfedAnnotState.color;
        ctx.globalAlpha = pdfedAnnotState.opacity;
        ctx.lineWidth = pdfedAnnotState.size;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (tool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = pdfedAnnotState.size * 5;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = pdfedAnnotState.color;
        ctx.globalAlpha = Math.min(0.5, pdfedAnnotState.opacity * 0.5);
        ctx.lineWidth = Math.max(pdfedAnnotState.size * 4, 20);
        ctx.lineCap = 'square';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (pdfedShapeTools.includes(tool) && idx >= 0) {
      // Shapes (line, arrow, rect, circle, polygons, etc.) are placed objects
      // now, not baked pixels — undo the placeholder pdfedAnnotPushUndo()
      // pushed in onDown by restoring the annotation canvas to exactly how
      // it looked before this drag's live preview was drawn onto it, then
      // add the shape as its own draggable/resizable/lockable object.
      const ac = pdfedGetAnnotCanvas();
      const ctx = ac.getContext('2d');
      const stack = pdfedStrokesFor(idx);
      const pre = stack.length ? stack.pop() : null;
      if (pre) {
        const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, ac.width, ac.height); ctx.drawImage(img, 0, 0); };
        img.src = pre;
      } else {
        ctx.clearRect(0, 0, ac.width, ac.height);
      }
      pdfedCommitPlacedShape(idx, tool);
      return;
    }

    if (pdfed.active >= 0) pdfedMarkModified(pdfed.active);

    // Smart Redact: a hand-dragged box is rarely pixel-perfect over the
    // text/content it's meant to hide, so before committing, snap/expand it
    // to fully swallow anything it meaningfully overlaps (see function below).
    if (pdfedAnnotState.tool === 'redact' && pdfed.active >= 0) {
      pdfedSmartRedactFinalize(pdfed.active);
    }

    // Smart Highlight: same idea as Smart Redact, a freehand marker stroke
    // rarely lines up perfectly with a line of OCR/PDF text, so on top of
    // whatever was drawn, cleanly wash over every line/word the stroke
    // actually touched so nothing looks half-highlighted or ragged.
    if (pdfedAnnotState.tool === 'highlight' && pdfed.active >= 0) {
      pdfedSmartHighlightFinalize(pdfed.active);
    }

    // Save final state into undo stack
    const ac = pdfedGetAnnotCanvas();
    const stack = pdfedStrokesFor(idx);
    // pop the pre-start snapshot we pushed in onDown, replace with final
    if (stack.length > 0) stack.pop();
    stack.push(ac.toDataURL());
  }

  function drawShape(ctx, tool, color, size, x1, y1, x2, y2) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = tool === 'redact' ? 1 : pdfedAnnotState.opacity;
    if (tool === 'rect') {
      ctx.beginPath();
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'roundrect') {
      pdfedTraceRoundRect(ctx, x1, y1, x2, y2, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.18 || 8);
      ctx.stroke();
    } else if (tool === 'circle') {
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (tool === 'arrow') {
      drawArrow(ctx, x1, y1, x2, y2, size);
    } else if (tool === 'dblarrow') {
      drawArrow(ctx, x1, y1, x2, y2, size, true);
    } else if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (tool === 'triangle' || tool === 'diamond' || tool === 'pentagon' || tool === 'star' || tool === 'hexagon') {
      pdfedTracePolygon(ctx, tool, x1, y1, x2, y2);
      ctx.stroke();
    } else if (tool === 'redact') {
      ctx.globalAlpha = 1;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
    ctx.globalAlpha = 1;
  }

  function drawArrow(ctx, x1, y1, x2, y2, size, doubleHeaded) {
    const headLen = Math.max(size * 5, 20);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    if (doubleHeaded) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 7), y1 + headLen * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 7), y1 + headLen * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Rounded-rectangle path helper (normalizes x1,y1,x2,y2 in either drag direction)
  function pdfedTraceRoundRect(ctx, x1, y1, x2, y2, r) {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  // Regular-polygon / star path helper, fits the polygon inside the drag bounding box
  function pdfedTracePolygon(ctx, tool, x1, y1, x2, y2) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    let pts = [];
    if (tool === 'triangle') {
      pts = [[0, -1], [0.866, 0.5], [-0.866, 0.5]];
    } else if (tool === 'diamond') {
      pts = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    } else if (tool === 'pentagon' || tool === 'hexagon') {
      const n = tool === 'pentagon' ? 5 : 6;
      const startAngle = -Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const a = startAngle + (i * 2 * Math.PI) / n;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
    } else if (tool === 'star') {
      const n = 5;
      const startAngle = -Math.PI / 2;
      for (let i = 0; i < n * 2; i++) {
        const a = startAngle + (i * Math.PI) / n;
        const r = i % 2 === 0 ? 1 : 0.42;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const x = cx + px * rx, y = cy + py * ry;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

// ── PLACED TEXT LAYER (persistent, draggable, editable, lockable, Canva/TikTok-style) ──
// Replaces the old prompt()-based "burn pixels into canvas" approach (which broke
// editing, dragging, deleting and locking) with a live DOM overlay, mirroring the
// placed-image system above. Text stays a fully editable object until export.

let pdfedPlacedTextSeq = 0;

// Prompts for a URL (via the Insert Link modal), then drops a clickable
// hyperlink box on the page — reuses the exact same placedTexts item shape/
// rendering/drag/resize/lock/delete machinery as Add Text, just with a
// `.link` field set. Ctrl/Cmd-click opens the link instead of editing it,
// same convention Word and Canva use for in-canvas hyperlinks.
function pdfedPlaceLinkLabel(x, y) {
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) { toast('No page loaded', 'error'); return; }
  if (pdfed.snapGrid) { x = pdfedSnapToGrid(x); y = pdfedSnapToGrid(y); }
  pdfedOpenLinkModal('place', { x, y });
}
