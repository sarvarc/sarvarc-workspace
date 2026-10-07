// ─── STATS ───
function updateStats() {
  document.getElementById('statPdfs').textContent = state.stats.pdfs;
  document.getElementById('statImgs').textContent = state.stats.imgs;
  document.getElementById('statExports').textContent = state.stats.exports;
  document.getElementById('statPages').textContent = state.stats.pages;
  if (typeof extractPersist === 'function') extractPersist();
}

// ─── REMOVE / CLEAR HELPERS ───

function removePdfFromExtract() {
  state.pdfDoc = null;
  state.pdfFile = null;
  state.extractedImages = [];
  state.previewPages = [];
  state.selectedImages.clear();
  state.currentEditIndex = null;
  closeCinemaPreview();
  state.cinema.pairs = [];
  state.cinema.hiRes = {};
  const cinemaBtn = document.getElementById('cinemaOpenBtn');
  if (cinemaBtn) cinemaBtn.style.display = 'none';
  document.getElementById('extractLoadedBanner').style.display = 'none';
  document.getElementById('uploadZone').style.display = '';
  document.getElementById('galleryWrap').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('uploadZone').classList.remove('scanning');
  document.getElementById('fileInput').value = '';
  document.querySelector('.extract-split').classList.remove('is-collapsed');
  document.getElementById('pipeline').classList.remove('is-collapsed');
  refreshSidebarFolder();
  updateStats();
  toast('PDF removed', 'info');
}

function clearAllImages() {
  if (state.extractedImages.length === 0) { toast('No images to clear', 'info'); return; }
  if (state.extractedImages.length > 1 && !confirm('Remove all ' + state.extractedImages.length + ' images?')) return;
  state.extractedImages = [];
  state.selectedImages.clear();
  state.currentEditIndex = null;
  document.getElementById('galleryWrap').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  expandUploadArea();
  updatePreviewPanel(); // reset preview
  refreshSidebarFolder();
  updateStats();
  toast('All images cleared', 'info');
}


function pdfedClosePdf() {
  if (pdfed.pages.length === 0 && !pdfed.file) return;
  if (!confirm('Close this PDF and clear all pages?')) return;
  pdfedCancelTextEdit && pdfedCancelTextEdit();
  pdfedCropOff && pdfedCropOff();
  pdfedCancelAutoCollapse();
  pdfed.pdfDoc = null; pdfed.file = null;
  pdfed.pages = []; pdfed.active = -1;
  pdfed.zoom = 1.0;
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
  // Restore open button, reset filename
  const upBtn = document.getElementById('pdfedUploadBtn');
  if (upBtn) upBtn.style.display = '';
  const fnEl = document.getElementById('pdfedFileName');
  if (fnEl) fnEl.textContent = 'No file open';
  document.getElementById('pdfedFileInput').value = '';
  const overlay = document.getElementById('pdfedTextOverlay');
  if (overlay) { overlay.innerHTML = ''; overlay.classList.remove('active'); }
  toast('PDF closed', 'info');
  // If this file was part of a batch queue, mark it skipped (not exported)
  // and, if auto-continue is on, move straight to the next pending file.
  if (pdfedQueue.currentIndex >= 0 && pdfedQueue.items[pdfedQueue.currentIndex] && pdfedQueue.items[pdfedQueue.currentIndex].status === 'active') {
    pdfedQueue.items[pdfedQueue.currentIndex].status = 'skipped';
    pdfedQueue.currentIndex = -1;
    pdfedQueueRender();
    if (pdfedQueue.autoAdvance && pdfedQueue.items.some(it => it.status === 'pending')) {
      setTimeout(() => pdfedQueueAdvance(), 600);
    }
  }
}

// ─── PROGRESS ───
function setProgress(pct, label, sub) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressSub').textContent = sub;
}

// ─── EXPORT PROGRESS OVERLAY ───
// Shown while a PDF/ZIP/image export is being built, so the user gets clear
// visual feedback instead of a frozen screen. The front page-sheet drifts
// toward the viewer in 3D space as pct (0–100) climbs, backed by a thin
// linear fill; sub label communicates what's happening right now.
let exportOverlayHideTimer = null;

function showExportOverlay(title, sub) {
  clearTimeout(exportOverlayHideTimer);
  const ov = document.getElementById('exportOverlay');
  ov.classList.remove('success');
  document.getElementById('exportOverlayTitle').textContent = title || 'Exporting…';
  document.getElementById('exportOverlaySub').textContent = sub || 'Preparing…';
  const frontEl = document.getElementById('exportFrontSheet');
  if (frontEl) {
    frontEl.style.transform = 'translateZ(4px) scale(1) rotateX(4deg) rotateY(-4deg)';
    frontEl.style.opacity = '0.88';
    frontEl.style.boxShadow = '0 18px 40px rgba(0,194,255,0.15)';
  }
  const barEl = document.getElementById('exportBarFill');
  if (barEl) barEl.style.width = '0%';
  document.getElementById('exportRingPct').textContent = '0%';
  ov.classList.add('open');
  // Double rAF so the 'open' display:flex is committed before the opacity
  // transition starts, otherwise the fade-in never plays.
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('visible')));
}

function updateExportProgress(pct, sub) {
  pct = Math.max(0, Math.min(100, pct));
  const t = pct / 100;
  const frontEl = document.getElementById('exportFrontSheet');
  if (frontEl) {
    const z = 4 + t * 30;          // drifts closer to the viewer
    const scale = 1 + t * 0.08;    // grows slightly as it approaches
    const rotY = -4 + t * 4;       // settles to face-on near completion
    frontEl.style.transform = `translateZ(${z}px) scale(${scale}) rotateY(${rotY}deg) rotateX(4deg)`;
    frontEl.style.opacity = 0.88 + t * 0.12;
    frontEl.style.boxShadow = `0 ${18 + t * 10}px ${40 + t * 20}px rgba(0,194,255,${0.15 + t * 0.25})`;
  }
  const barEl = document.getElementById('exportBarFill');
  if (barEl) barEl.style.width = pct + '%';
  const pctEl = document.getElementById('exportRingPct');
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  if (sub) {
    const subEl = document.getElementById('exportOverlaySub');
    if (subEl) subEl.textContent = sub;
  }
}

function completeExportOverlay(sub, meta) {
  swTrack('export_completed', { label: sub || 'export', module: (meta && meta.module) || 'unknown', format: (meta && meta.format) || 'unknown' });
  updateExportProgress(100, sub || 'Done!');
  const ov = document.getElementById('exportOverlay');
  ov.classList.add('success');
  exportOverlayHideTimer = setTimeout(hideExportOverlay, 950);
}

function hideExportOverlay() {
  clearTimeout(exportOverlayHideTimer);
  const ov = document.getElementById('exportOverlay');
  ov.classList.remove('visible');
  setTimeout(() => ov.classList.remove('open', 'success'), 250);
}

// ─── SARVARC WORKSPACE — EXPORT FILENAME BRANDING ───
// Every downloaded/exported file (PDF, DOCX, XLSX, CSV, images, ZIP, chart,
// session, form) gets renamed with a "SARVARC_Workspace_" prefix so files
// carry the brand wherever they end up. Controlled by a single shared
// preference, toggleable from the export modals; defaults to ON.
const SARVARC_BRAND_PREFIX = 'SARVARC_Workspace_';
function sarvarcBrandingEnabled() {
  try {
    const v = localStorage.getItem('sarvarcBrandFilenames');
    return v === null ? true : v === 'true';
  } catch (e) { return true; }
}
function sarvarcSetBrandingEnabled(on) {
  try { localStorage.setItem('sarvarcBrandFilenames', on ? 'true' : 'false'); } catch (e) {}
}
function sarvarcBrandFilename(name) {
  if (!name) return name;
  if (!sarvarcBrandingEnabled()) return name;
  const base = String(name).trim();
  if (base.toLowerCase().startsWith(SARVARC_BRAND_PREFIX.toLowerCase())) return base;
  return SARVARC_BRAND_PREFIX + base;
}
// Syncs any "brand my export filenames" checkbox found in the DOM (used by
// both the PDF Editor and Data Arrangement export modals) with the shared
// preference above, in either direction.
function sarvarcInitBrandCheckbox(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = sarvarcBrandingEnabled();
  el.onchange = () => sarvarcSetBrandingEnabled(el.checked);
}

// ─── SHARED PDF PASSWORD PROTECTION ──────────────────────────────────────
// Used everywhere a PDF gets generated with jsPDF: the full Export modals
// (PDF Editor, Data Arrangement) read the checkbox/input directly, while
// every one-click export button (Redaction, Make Forms, Form Canvas,
// Diagrams, Extract Images) routes through sarvarcAskExportPassword(), a
// small reusable prompt, so the same "protect this PDF?" choice shows up
// consistently across the whole app instead of only in the PDF Editor.
let _sarvarcPwPromptResolve = null;
function sarvarcAskExportPassword(label) {
  return new Promise(resolve => {
    _sarvarcPwPromptResolve = resolve;
    document.getElementById('sarvarcPwPromptTitle').textContent = label || 'Export as PDF';
    // Defaults to ON, same reasoning as the main PDF Editor export modal:
    // most people exporting a PDF want it protected, but it's one click to
    // turn off.
    document.getElementById('sarvarcPwToggle').checked = true;
    document.getElementById('sarvarcPwInput').value = '';
    document.getElementById('sarvarcPwInput').style.display = 'block';
    document.getElementById('sarvarcPwHint').style.display = 'block';
    document.getElementById('sarvarcPwError').style.display = 'none';
    document.getElementById('sarvarcPwPromptOverlay').classList.add('open');
    setTimeout(() => { const el = document.getElementById('sarvarcPwInput'); if (el.style.display !== 'none') el.focus(); }, 50);
  });
}
function sarvarcPwPromptToggle() {
  const on = document.getElementById('sarvarcPwToggle').checked;
  document.getElementById('sarvarcPwInput').style.display = on ? 'block' : 'none';
  document.getElementById('sarvarcPwHint').style.display = on ? 'block' : 'none';
  if (!on) {
    document.getElementById('sarvarcPwInput').value = '';
    document.getElementById('sarvarcPwError').style.display = 'none';
  } else {
    document.getElementById('sarvarcPwInput').focus();
  }
}
function sarvarcPwPromptInput() {
  document.getElementById('sarvarcPwError').style.display = 'none';
}
function sarvarcPwPromptCancel() {
  document.getElementById('sarvarcPwPromptOverlay').classList.remove('open');
  if (_sarvarcPwPromptResolve) { const r = _sarvarcPwPromptResolve; _sarvarcPwPromptResolve = null; r(undefined); }
}
function sarvarcPwPromptConfirm() {
  const on = document.getElementById('sarvarcPwToggle').checked;
  let pw = null;
  if (on) {
    pw = document.getElementById('sarvarcPwInput').value;
    if (!pw) {
      const err = document.getElementById('sarvarcPwError');
      err.textContent = 'Enter a password, or untick password protection';
      err.style.display = 'block';
      return;
    }
  }
  document.getElementById('sarvarcPwPromptOverlay').classList.remove('open');
  if (_sarvarcPwPromptResolve) { const r = _sarvarcPwPromptResolve; _sarvarcPwPromptResolve = null; r(pw); }
}
// Builds the jsPDF constructor option that encrypts the file, or {} when no
// password was chosen. Shared by every PDF export path in the app.
function sarvarcPdfEncryptionOpts(password) {
  return password ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print', 'modify', 'copy', 'annot-forms'] } } : {};
}

// ─── SHARED PDF PASSWORD *REMOVAL* / UNLOCK ──────────────────────────────
// Companion to the encryption helper above. Before this, every PDF upload
// path called pdfjsLib.getDocument() directly, so a locked file just threw
// a PasswordException and died with a generic "could not read that PDF"
// toast — SARVARC genuinely couldn't touch a client's protected file.
// sarvarcOpenPdfDocument() wraps pdf.js's own onPassword hook with a prompt,
// so any module that opens a PDF through it gains password support for
// free, and re-prompts automatically if the password typed was wrong.
let _sarvarcUnlockResolve = null;
function sarvarcAskUnlockPassword(isRetry) {
  return new Promise(resolve => {
    _sarvarcUnlockResolve = resolve;
    document.getElementById('sarvarcUnlockPwInput').value = '';
    document.getElementById('sarvarcUnlockPromptSub').textContent = isRetry ? "That password didn't work, try again" : 'Enter the password to open it';
    document.getElementById('sarvarcUnlockPwError').style.display = isRetry ? 'block' : 'none';
    document.getElementById('sarvarcUnlockPromptOverlay').classList.add('open');
    setTimeout(() => { const el = document.getElementById('sarvarcUnlockPwInput'); if (el) el.focus(); }, 50);
  });
}
function sarvarcUnlockPromptInput() {
  document.getElementById('sarvarcUnlockPwError').style.display = 'none';
}
function sarvarcUnlockPromptCancel() {
  document.getElementById('sarvarcUnlockPromptOverlay').classList.remove('open');
  if (_sarvarcUnlockResolve) { const r = _sarvarcUnlockResolve; _sarvarcUnlockResolve = null; r(undefined); }
}
function sarvarcUnlockPromptConfirm() {
  const pw = document.getElementById('sarvarcUnlockPwInput').value;
  if (!pw) return;
  document.getElementById('sarvarcUnlockPromptOverlay').classList.remove('open');
  if (_sarvarcUnlockResolve) { const r = _sarvarcUnlockResolve; _sarvarcUnlockResolve = null; r(pw); }
}
// Drop-in replacement for pdfjsLib.getDocument({data}).promise that
// transparently prompts for a password (and re-prompts on a wrong one) the
// moment pdf.js reports the file is encrypted. Every module's file-load
// code should call this instead of pdfjsLib.getDocument() directly so a
// locked PDF works everywhere in the app, not just wherever someone
// remembered to add a password prompt. Rejects with a plain Error (message
// 'Password entry cancelled') if the person cancels instead of entering one.
function sarvarcOpenPdfDocument(data, extraOpts) {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let task;
    try {
      task = pdfjsLib.getDocument(Object.assign({ data }, extraOpts));
      // pdf.js only recognizes onPassword when it's set on the returned
      // loading task itself — passing it inside the params object to
      // getDocument() is silently ignored, which is why this used to fail
      // instantly with pdf.js's own "No password given" error instead of
      // ever showing the unlock prompt.
      task.onPassword = async (updatePassword, reason) => {
        const isRetry = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
        const pw = await sarvarcAskUnlockPassword(isRetry);
        if (pw === undefined) {
          cancelled = true;
          try { task.destroy(); } catch(e) {}
          reject(new Error('Password entry cancelled'));
          return;
        }
        updatePassword(pw);
      };
    } catch(e) { reject(e); return; }
    task.promise.then(resolve).catch(err => { if (!cancelled) reject(err); });
  });
}

// ─── TOAST ───
function toast(msg, type = 'info') {
  const icons = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const colors = { success: 'var(--green)', error: '#ec4899', info: 'var(--blue)' };
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="toast-icon" style="display:inline-flex;color:${colors[type]}">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3200);

  if (type === 'success' && /export|download/i.test(msg) && window.__sarvarcCoffeeTrigger) {
    window.__sarvarcCoffeeTrigger();
  }
}

// ─── UTILS ───
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// ── HIGHLIGHT SYSTEM, clean drag-to-highlight, no text layer mess ────────────
// ─────────────────────────────────────────────────────────────────────────────
const pdfedTHL = {
  active: false,
  selectedColor: '#FFFF00',
  // drag state
  dragging: false,
  startX: 0, startY: 0,
  curX: 0, curY: 0,
};

// ── Toggle highlight mode ──────────────────────────────────────────────────
function pdfedToggleTextHighlight() {
  const btn = document.getElementById('pdfedTextHlBtn');
  const sidePanel = document.getElementById('pdfedHlSidePanel');
  if (pdfedTHL.active) {
    pdfedTHL.active = false;
    btn.classList.remove('annot-active');
    pdfedHlDeactivate();
    if (sidePanel) sidePanel.style.display = 'none';
    pdfedActivateHand();
  } else {
    pdfedSetAnnotTool(null);
    pdfedDeactivateHand();
    pdfedTHL.active = true;
    btn.classList.add('annot-active');
    pdfedHlActivate();
    if (sidePanel) { sidePanel.style.display = ''; }
  }
}

function pdfedHlActivate() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap) return;
  wrap.style.cursor = 'crosshair';
  wrap.addEventListener('mousedown', pdfedHlOnDown);
  wrap.addEventListener('mousemove', pdfedHlOnMove);
  wrap.addEventListener('mouseup',   pdfedHlOnUp);
  wrap.addEventListener('mouseleave', pdfedHlOnUp);
}

function pdfedHlDeactivate() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap) return;
  wrap.style.cursor = '';
  wrap.removeEventListener('mousedown', pdfedHlOnDown);
  wrap.removeEventListener('mousemove', pdfedHlOnMove);
  wrap.removeEventListener('mouseup',   pdfedHlOnUp);
  wrap.removeEventListener('mouseleave', pdfedHlOnUp);
  pdfedHlHideDragBox();
}

// ── Drag handlers ─────────────────────────────────────────────────────────
function pdfedHlGetPos(e) {
  const pc = document.getElementById('pdfedPageCanvas');
  const r  = pc.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / pdfed.zoom,
    y: (e.clientY - r.top)  / pdfed.zoom,
    screenX: e.clientX - r.left,
    screenY: e.clientY - r.top,
  };
}

function pdfedHlOnDown(e) {
  if (e.button !== 0) return;
  if (!pdfedTHL.active) return;
  e.preventDefault();
  const pos = pdfedHlGetPos(e);
  pdfedTHL.dragging = true;
  pdfedTHL.startX = pos.x;
  pdfedTHL.startY = pos.y;
  pdfedTHL.curX   = pos.x;
  pdfedTHL.curY   = pos.y;
}

function pdfedHlOnMove(e) {
  if (!pdfedTHL.dragging) return;
  e.preventDefault();
  const pos = pdfedHlGetPos(e);
  pdfedTHL.curX = pos.x;
  pdfedTHL.curY = pos.y;
  pdfedHlShowDragBox();
}

function pdfedHlOnUp(e) {
  if (!pdfedTHL.dragging) return;
  pdfedTHL.dragging = false;
  pdfedHlHideDragBox();

  const x1 = Math.min(pdfedTHL.startX, pdfedTHL.curX);
  const y1 = Math.min(pdfedTHL.startY, pdfedTHL.curY);
  const x2 = Math.max(pdfedTHL.startX, pdfedTHL.curX);
  const y2 = Math.max(pdfedTHL.startY, pdfedTHL.curY);
  const w  = x2 - x1;
  const h  = y2 - y1;

  // Ignore tiny accidental clicks
  if (w < 4 || h < 4) return;

  pdfedHlApplyRect(x1, y1, w, h);
}

// ── Visual drag preview box ────────────────────────────────────────────────
function pdfedHlShowDragBox() {
  const box = document.getElementById('pdfedHlDragBox');
  if (!box) return;
  const x1 = Math.min(pdfedTHL.startX, pdfedTHL.curX) * pdfed.zoom;
  const y1 = Math.min(pdfedTHL.startY, pdfedTHL.curY) * pdfed.zoom;
  const w  = Math.abs(pdfedTHL.curX - pdfedTHL.startX) * pdfed.zoom;
  const h  = Math.abs(pdfedTHL.curY - pdfedTHL.startY) * pdfed.zoom;
  const hex = pdfedTHL.selectedColor;
  box.style.cssText = `
    display:block;position:absolute;pointer-events:none;z-index:5;
    left:${x1}px;top:${y1}px;width:${w}px;height:${h}px;
    background:${hex};
    opacity:0.35;
    border-radius:2px;
    mix-blend-mode:multiply;
  `;
}

function pdfedHlHideDragBox() {
  const box = document.getElementById('pdfedHlDragBox');
  if (box) box.style.display = 'none';
}

// ── Apply the highlight rect onto the page canvas ─────────────────────────
function pdfedHlApplyRect(x, y, w, h) {
  if (pdfed.active < 0) return;
  const pc  = document.getElementById('pdfedPageCanvas');
  const ctx = pc.getContext('2d');

  pdfedAnnotPushUndo();

  const hex = pdfedTHL.selectedColor;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  // canvas coords are in raw pixel space (scale=2), pdfed.zoom is display scale
  // x/y/w/h are already in raw canvas coords because we divided by zoom in getPos
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
  ctx.restore();

  // Bake back so export picks it up
  const idx = pdfed.active;
  pdfed.pages[idx].dataUrl = pc.toDataURL('image/png');
  pdfedMarkModified(idx);

  // NOTE: this used to also do pdfedStrokesFor(idx).push(pc.toDataURL()) here.
  // That was a bug: pg.annotStrokes/pdfedStrokesFor() is meant to hold ONLY
  // snapshots of the transparent annotation canvas (`ac`) — pdfedComposeThumb
  // (used by both thumbnails and export) draws the last entry on top of the
  // page as a final overlay. Pushing a snapshot of the opaque main page canvas
  // (`pc`) there meant that final overlay was a full, opaque copy of the page
  // as it looked at highlight-time, which then painted over any table or
  // placed-text box added afterward, both in thumbnails and in exported
  // files, even though they were still correctly stored on the page. The
  // highlight itself doesn't need this: it's already permanent in
  // pdfed.pages[idx].dataUrl via the bake above, which pdfedComposeThumb reads
  // as its base layer before drawing placed images/text/tables on top.

  toast('Highlight applied ✓', 'success');
}

// ── Sidebar panel swatch click ─────────────────────────────────────────────
function pdfedPanelSwatchClick(el) {
  document.querySelectorAll('.pdfed-hl-panel-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  pdfedTHL.selectedColor = el.dataset.color;
  const cc = document.getElementById('pdfedHlPanelColor');
  if (cc) cc.value = pdfedTHL.selectedColor;
}

// Legacy stubs (called by pdfedSetAnnotTool when switching tools)
function pdfedBuildTextHighlightLayer() {}
function pdfedHlLayerDeactivate() { pdfedHlDeactivate(); }
function pdfedDismissHlToolbar() {
  const bar = document.getElementById('pdfedHlToolbar');
  if (bar) bar.classList.remove('show');
}
function pdfedUpdateHlPanel() {}

// Re-apply cursor when zoom changes
(function() {
  const _prev = pdfedApplyZoom;
  pdfedApplyZoom = function() {
    _prev();
    // keep crosshair on wrap if HL active
    const wrap = document.getElementById('pdfedCanvasWrap');
    if (wrap && pdfedTHL.active) wrap.style.cursor = 'crosshair';
  };
})();

// ─── RIGHT PANEL TOGGLE ───
// isAuto=true is passed only by the smart auto-collapse timer below, so its
// own calls never get mistaken for a deliberate user action.
function pdfedToggleRightPanel(isAuto) {
  if (!isAuto) pdfed.rightManuallyToggled = true;
  const layout = document.getElementById('pdfedLayout');
  const icon   = document.getElementById('pdfedRightToggleIcon');
  const collapsed = layout.classList.toggle('right-collapsed');
  // Flip chevron direction
  icon.innerHTML = collapsed
    ? '<polyline points="15 18 9 12 15 6"/>'   // point right (open)
    : '<polyline points="9 18 15 12 9 6"/>';    // point left (close)
}

// ─── LEFT PANEL (PAGE STRIP) TOGGLE ───
function pdfedToggleLeftPanel() {
  const layout = document.getElementById('pdfedLayout');
  const icon   = document.getElementById('pdfedLeftToggleIcon');
  const collapsed = layout.classList.toggle('left-collapsed');
  // Flip chevron direction (mirrored vs. right panel)
  icon.innerHTML = collapsed
    ? '<polyline points="9 18 15 12 9 6"/>'    // point right (open)
    : '<polyline points="15 18 9 12 15 6"/>';   // point left (close)
}

// ─── SMART AUTO-COLLAPSE (more canvas room after a quiet 3s) ───
// Fired once per freshly-opened document, 3s after it opens. Collapses the
// main app sidebar (left) and the Panel/My Notes panel (right) to give the
// canvas more breathing room, the PDF Editor's own page-thumbnail strip is
// left alone entirely, since that one's useful to keep visible at all times.
// Never overrides a choice the person already made in that window: if
// they've manually opened/closed the sidebar or right panel themselves in
// those 3s, that one is left exactly as they set it, only the untouched
// side(s) auto-collapse. A no-op if both are already collapsed, or if the
// editor was closed/the person navigated to a different tool before the
// timer fires.
function pdfedScheduleAutoCollapse() {
  clearTimeout(pdfed.autoCollapseTimer);
  pdfed.leftManuallyToggled = false;
  pdfed.rightManuallyToggled = false;
  pdfed.autoCollapseTimer = setTimeout(() => {
    const layout = document.getElementById('pdfedLayout');
    const section = document.getElementById('sec-pdfeditor');
    if (!layout || pdfed.active < 0) return; // editor closed/no doc, nothing to do
    if (section && !section.classList.contains('active')) return; // user's looking at a different tool right now
    let collapsedAny = false;
    // Left = the main app sidebar (Dashboard/Extract Images/Workspace/etc.),
    // NOT the PDF Editor's own page-thumbnail strip, which always stays put.
    if (!pdfed.leftManuallyToggled && typeof sidebarOpen !== 'undefined' && sidebarOpen) {
      toggleSidebar(true);
      collapsedAny = true;
    }
    if (!pdfed.rightManuallyToggled && !layout.classList.contains('right-collapsed')) {
      pdfedToggleRightPanel(true);
      collapsedAny = true;
    }
    if (collapsedAny) {
      toast('Tucked the side panels away for more canvas room, the arrows on the edges bring them back anytime', 'info');
    }
  }, 3000);
}

function pdfedCancelAutoCollapse() {
  clearTimeout(pdfed.autoCollapseTimer);
}


// ─── INIT ───
updateStats();

// Keep placed-image overlays aligned when zoom changes (attached last so it
// survives every earlier pdfedApplyZoom wrap in this file)
(function() {
  const _prevZoom = pdfedApplyZoom;
  pdfedApplyZoom = function() {
    _prevZoom.apply(this, arguments);
    if (typeof pdfed !== 'undefined' && pdfed.active >= 0) { pdfedRenderPlacedImages(pdfed.active); pdfedSyncPlacedTextsZoom(); }
  };
})();

// NOTE: export used to patch pdfedPageUrl here to composite placed images/text
// in for the exported PDF. pdfedExport() now calls pdfedComposeThumb() per page
// directly, which already layers placed images and placed text boxes on top of
// the flattened base for every page (not just the active one) without needing
// to swap out pdfedPageUrl globally, so this patch is intentionally removed.
// pdfedAutoStampPendingGhost() (finalizing an in-progress image drag) is still
// called directly at the top of pdfedExport().
