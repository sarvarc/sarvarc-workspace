// ─── FILTERS ───
function pdfedSetFilter(input, type) {
  const v = parseInt(input.value);
  if (type === 'bright')   { document.getElementById('prrBright').textContent   = v; }
  if (type === 'contrast') { document.getElementById('prrContrast').textContent = v; }
  if (type === 'sat')      { document.getElementById('prrSat').textContent      = v; }
}

async function pdfedApplyFilter() {
  if (pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  const sliders = document.querySelectorAll('#pdfedAdjustPanel input[type=range]');
  const bright   = sliders[0] ? parseInt(sliders[0].value) : 100;
  const contrast = sliders[1] ? parseInt(sliders[1].value) : 100;
  const sat      = sliders[2] ? parseInt(sliders[2].value) : 100;

  const srcUrl = await pdfedPageUrl(pg);
  const img = new Image();
  await new Promise((res,rej) => { img.onload=res; img.onerror=rej; img.src=srcUrl; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.filter = `brightness(${bright}%) contrast(${contrast}%) saturate(${sat}%)`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  pg.dataUrl = c.toDataURL('image/png');
  pg.modified = true;
  pg.edits.filters = {bright, contrast, sat};
  swTrack('filter_applied', { module: 'pdf_editor', bright, contrast, sat });
  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  toast('Adjustments applied', 'success');
}

function pdfedResetFilters() {
  const sliders = document.querySelectorAll('#pdfedAdjustPanel input[type=range]');
  sliders.forEach(s => s.value = 100);
  ['prrBright','prrContrast','prrSat'].forEach(id => document.getElementById(id).textContent = 100);
}

function pdfedOpenAdjust() {
  const p = document.getElementById('pdfedAdjustPanel');
  if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
}

// ─── CANVAS RECOLOR / GRADIENT TINT ─────────────────────────────────────
// Lets a person wash the whole current page in a solid color or a custom
// 2-color gradient at an adjustable opacity — a color-grade for the canvas
// itself, sitting behind any placed text/images/tables (same layering as
// the existing brightness/contrast/saturation Adjust panel). Two views of
// the same state are kept in sync:
//   1) a live, non-destructive CSS preview overlay while dragging sliders,
//      so nothing is decoded/redrawn on every tick;
//   2) an actual pixel bake into pg.dataUrl on "Apply", the exact same
//      pattern pdfedApplyFilter/SARVARC Eye/Rotate/Border already use — so
//      once applied, the tint is just permanent page pixels and needs no
//      special-casing anywhere else: it shows up identically in the live
//      editor, the left-panel thumbnail, and every export format, because
//      they all read the same pg.dataUrl through pdfedPageUrl().
const pdfedCanvasTintState = { mode: 'solid', color1: '#0A0F1E', color2: '#0073E6', angle: 90, opacity: 60, imageDataUrl: null, imageFit: 'cover' };

// Converts an angle (0deg = left→right, 90deg = top→bottom, clockwise) into
// a gradient line long enough to fully cover a w×h canvas regardless of
// direction, centered on the canvas so the gradient always looks balanced.
function pdfedGradientLine(angleDeg, w, h) {
  const rad = ((angleDeg % 360) + 360) % 360 * Math.PI / 180;
  const cx = w / 2, cy = h / 2;
  const len = Math.sqrt(w * w + h * h) / 2;
  // Match CSS linear-gradient()'s angle convention (0deg = bottom→top,
  // 90deg = left→right, clockwise) so the baked canvas gradient always
  // points the same direction the live CSS preview showed while dragging
  // the Direction slider — using plain sin/cos here (0deg = right,
  // 90deg = down) was 90deg off from the preview, so "Apply to Canvas"
  // silently rotated whatever direction the person had picked.
  const dx = Math.sin(rad) * len, dy = -Math.cos(rad) * len;
  return { x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy };
}

// Builds the CSS the live preview overlay and the little swatch both use,
// so what you see while dragging sliders is pixel-for-pixel the same
// gradient math (just expressed as a CSS angle) as what gets baked.
function pdfedCanvasTintCss() {
  const s = pdfedCanvasTintState;
  if (s.mode === 'gradient') {
    return `linear-gradient(${s.angle}deg, ${s.color1}, ${s.color2})`;
  }
  return s.color1;
}

function pdfedCanvasTintPreviewEl() {
  let el = document.getElementById('pdfedCanvasTintPreview');
  if (!el) {
    const anchor = document.getElementById('pdfedAnnotCanvas');
    if (!anchor || !anchor.parentNode) return null;
    el = document.createElement('div');
    el.id = 'pdfedCanvasTintPreview';
    el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;display:none;';
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
  }
  return el;
}

// Applies the current mode's look to a preview element (the small swatch or
// the live CSS overlay on the canvas). Image mode needs separate background-*
// properties rather than the single shorthand string solid/gradient use, so
// this always clears the ones the current mode doesn't need before setting
// the ones it does — otherwise a stale backgroundImage could bleed through
// after switching back to Solid/Gradient.
function pdfedCanvasApplyPreviewBg(el) {
  const s = pdfedCanvasTintState;
  if (s.mode === 'image' && s.imageDataUrl) {
    el.style.background = 'none';
    el.style.backgroundImage = `url("${s.imageDataUrl}")`;
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = s.imageFit === 'tile' ? 'repeat' : 'no-repeat';
    el.style.backgroundSize = s.imageFit === 'tile' ? 'auto'
      : s.imageFit === 'contain' ? 'contain'
      : s.imageFit === 'stretch' ? '100% 100%'
      : 'cover';
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundPosition = '';
    el.style.backgroundRepeat = '';
    el.style.backgroundSize = '';
    el.style.background = pdfedCanvasTintCss();
  }
}

// Refreshes both the little swatch inside the panel and the live overlay
// sitting on the canvas, called after any control changes.
function pdfedCanvasTintRefreshPreview() {
  const swatch = document.getElementById('pdfedCtintPreview');
  if (swatch) { pdfedCanvasApplyPreviewBg(swatch); swatch.style.opacity = 1; }
  const live = pdfedCanvasTintPreviewEl();
  if (live) {
    pdfedCanvasApplyPreviewBg(live);
    live.style.opacity = pdfedCanvasTintState.opacity / 100;
    const canvasFlyout = document.getElementById('pdfedCanvasPanelBody');
    live.style.display = canvasFlyout && canvasFlyout.classList.contains('open') ? 'block' : 'none';
  }
}

function pdfedCanvasSetMode(mode) {
  pdfedCanvasTintState.mode = mode;
  document.getElementById('pdfedCtintModeSolidBtn').classList.toggle('active', mode === 'solid');
  document.getElementById('pdfedCtintModeGradBtn').classList.toggle('active', mode === 'gradient');
  const imageBtn = document.getElementById('pdfedCtintModeImageBtn');
  if (imageBtn) imageBtn.classList.toggle('active', mode === 'image');
  document.getElementById('pdfedCtintSolidControls').style.display = mode === 'solid' ? '' : 'none';
  document.getElementById('pdfedCtintGradControls').style.display = mode === 'gradient' ? '' : 'none';
  const imageControls = document.getElementById('pdfedCtintImageControls');
  if (imageControls) imageControls.style.display = mode === 'image' ? '' : 'none';
  pdfedCanvasTintRefreshPreview();
}

// Reads the picked file into a dataURL and stores it as the pending image
// background — same "pending until Apply" pattern the solid/gradient
// controls already use, so nothing is baked onto the page until the user
// clicks Apply to Canvas.
function pdfedCanvasImageFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pdfedCanvasTintState.imageDataUrl = reader.result;
    pdfedCanvasImageSyncThumb();
    pdfedCanvasTintRefreshPreview();
  };
  reader.onerror = () => toast('Could not read that image', 'error');
  reader.readAsDataURL(file);
  input.value = ''; // allow re-selecting the same file to re-trigger onchange
}

function pdfedCanvasClearImage(evt) {
  if (evt) evt.stopPropagation();
  pdfedCanvasTintState.imageDataUrl = null;
  pdfedCanvasImageSyncThumb();
  pdfedCanvasTintRefreshPreview();
}

function pdfedCanvasSetImageFit(val) {
  pdfedCanvasTintState.imageFit = val;
  pdfedCanvasTintRefreshPreview();
}

// Swaps the upload zone between its empty "click to upload" state and the
// thumbnail preview of whatever image is currently staged.
function pdfedCanvasImageSyncThumb() {
  const wrap = document.getElementById('pdfedCtintImageThumbWrap');
  const thumb = document.getElementById('pdfedCtintImageThumb');
  const empty = document.getElementById('pdfedCtintImageEmpty');
  const fitSelect = document.getElementById('pdfedCtintImageFitSelect');
  const hasImage = !!pdfedCanvasTintState.imageDataUrl;
  if (thumb) thumb.src = hasImage ? pdfedCanvasTintState.imageDataUrl : '';
  if (wrap) wrap.style.display = hasImage ? '' : 'none';
  if (empty) empty.style.display = hasImage ? 'none' : '';
  if (fitSelect) fitSelect.value = pdfedCanvasTintState.imageFit;
}

function pdfedCanvasPickSwatch(el, which) {
  document.querySelectorAll('#pdfedCtintSolidControls .pdfed-ctint-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  pdfedCanvasSetColor(which, el.dataset.color);
  const picker = document.getElementById('pdfedCtintColor1Picker');
  if (picker) picker.value = el.dataset.color;
}

function pdfedCanvasSetColor(which, val) {
  pdfedCanvasTintState[which] = val;
  pdfedCanvasTintRefreshPreview();
}

function pdfedCanvasSetAngle(val) {
  const v = Math.max(0, Math.min(360, parseInt(val, 10) || 0));
  pdfedCanvasTintState.angle = v;
  const slider = document.getElementById('pdfedCtintAngleSlider');
  const label = document.getElementById('pdfedCtintAngleVal');
  if (slider) slider.value = v;
  if (label) label.textContent = v;
  pdfedCanvasTintRefreshPreview();
}

function pdfedCanvasSetOpacity(val) {
  const v = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  pdfedCanvasTintState.opacity = v;
  const slider = document.getElementById('pdfedCtintOpacitySlider');
  const label = document.getElementById('pdfedCtintOpacityVal');
  if (slider) slider.value = v;
  if (label) label.textContent = v;
  pdfedCanvasTintRefreshPreview();
}

function pdfedToggleCanvasPanel() {
  const body = document.getElementById('pdfedCanvasPanelBody');
  const rightPanel = document.getElementById('pdfedRightPanel');
  const chevron = document.getElementById('pdfedCanvasPanelChevron');
  if (!body || !rightPanel) return;
  const opening = !body.classList.contains('open');
  body.classList.toggle('open', opening);
  if (chevron) chevron.style.transform = opening ? 'rotate(180deg)' : 'rotate(0deg)';
  if (opening) {
    // Dock the flyout to the left of the right panel, top-aligned with it —
    // "beside the panel" rather than expanding inline inside it.
    const rect = rightPanel.getBoundingClientRect();
    const panelW = body.offsetWidth || 250;
    let left = rect.left - panelW - 10;
    if (left < 8) left = 8; // fall back to the right edge if the window is too narrow
    let top = rect.top;
    const maxTop = window.innerHeight - 40;
    if (top > maxTop) top = maxTop;
    body.style.top = top + 'px';
    body.style.left = left + 'px';
    pdfedCanvasPresetsRender();
  }
  pdfedCanvasTintRefreshPreview();
}
// Backwards-compatible alias, in case anything else still calls the old name
function pdfedOpenCanvasPanel() { pdfedToggleCanvasPanel(); }

// Close the canvas flyout on outside click or right-panel collapse
document.addEventListener('click', function(e) {
  const body = document.getElementById('pdfedCanvasPanelBody');
  const trigger = document.getElementById('pdfedCanvasPanelTrigger');
  if (!body || !body.classList.contains('open')) return;
  if (body.contains(e.target) || (trigger && trigger.contains(e.target))) return;
  body.classList.remove('open');
  const chevron = document.getElementById('pdfedCanvasPanelChevron');
  if (chevron) chevron.style.transform = 'rotate(0deg)';
  pdfedCanvasTintRefreshPreview();
});

// Bakes a solid/gradient/image fill `s` directly into ONE page object's
// pixels, exactly like pdfedApplyFilter does for brightness/contrast/
// saturation. Pure per-page work only — no UI refresh, no toast, no
// navigation — so callers can bake a whole batch of pages (all of them,
// or a mixed set with different colours each) and only pay for one
// pdfedGoto/pdfedBuildStrip/toast at the end of the batch, instead of once
// per page. Shared by pdfedApplyCanvasTint (this page), the "All Pages"
// button, and Kadessa's pdfed_set_canvas_gradient action.
async function pdfedBakeCanvasTintOntoPage(pg, s) {
  // Every bake should REPLACE whatever canvas tint/image is currently
  // showing, not paint over it — so we always start from the true
  // pre-tint pixels (captured once, the first time this panel touches the
  // page), never from pg.dataUrl if that already carries a previous bake.
  // Without this, replacing an image (or switching solid -> gradient ->
  // image) would blend the new one on top of the old one instead of
  // swapping it out cleanly.
  const currentUrl = await pdfedPageUrl(pg);
  const baseUrl = pg.edits.canvasTintBaseDataUrl || currentUrl;

  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = baseUrl; });

  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  ctx.globalAlpha = s.opacity / 100;
  if (s.mode === 'image' && s.imageDataUrl) {
    const bgImg = new Image();
    await new Promise((res, rej) => { bgImg.onload = res; bgImg.onerror = rej; bgImg.src = s.imageDataUrl; });
    if (s.imageFit === 'tile') {
      const pat = ctx.createPattern(bgImg, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, c.width, c.height);
    } else if (s.imageFit === 'stretch') {
      ctx.drawImage(bgImg, 0, 0, c.width, c.height);
    } else {
      // cover / contain — scale to fit, then center
      const scale = s.imageFit === 'contain'
        ? Math.min(c.width / bgImg.naturalWidth, c.height / bgImg.naturalHeight)
        : Math.max(c.width / bgImg.naturalWidth, c.height / bgImg.naturalHeight);
      const dw = bgImg.naturalWidth * scale, dh = bgImg.naturalHeight * scale;
      const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      if (s.imageFit === 'contain') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(bgImg, dx, dy, dw, dh);
    }
  } else if (s.mode === 'gradient') {
    const { x0, y0, x1, y1 } = pdfedGradientLine(s.angle, c.width, c.height);
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, s.color1);
    grad.addColorStop(1, s.color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
  } else {
    ctx.fillStyle = s.color1;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.globalAlpha = 1;

  // one-level revert safety net — "Remove Tint" restores exactly this
  pg.edits.preTintDataUrl = currentUrl;
  pg.edits.canvasTintBaseDataUrl = baseUrl;
  pg.dataUrl = c.toDataURL('image/png');
  pg.modified = true;
  pg.edits.canvasTint = { mode: s.mode, color1: s.color1, color2: s.color2, angle: s.angle, opacity: s.opacity };
}

// Applies the current panel state to only the page the person has open.
async function pdfedApplyCanvasTint(silent) {
  if (pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  await pdfedBakeCanvasTintOntoPage(pg, pdfedCanvasTintState);

  const live = pdfedCanvasTintPreviewEl();
  if (live) live.style.display = 'none'; // pixels now carry the tint, hide the CSS preview

  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  if (!silent) toast('Canvas color applied', 'success');
}

// Applies the current panel state to EVERY page in the document, one bake
// per page (each page keeps its own pre-tint pixels as the base, so this
// is safe to run more than once and still one-level-revertible per page
// via "Remove Tint"). Manual "All Pages" button, and Kadessa's
// pdfed_set_canvas_gradient with pages:'all'.
async function pdfedApplyCanvasTintAllPages(silent) {
  if (!pdfed.pages.length) { if (!silent) toast('Open a document first', 'error'); return; }
  const s = pdfedCanvasTintState;
  for (const pg of pdfed.pages) {
    await pdfedBakeCanvasTintOntoPage(pg, s);
  }

  const live = pdfedCanvasTintPreviewEl();
  if (live) live.style.display = 'none';

  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  if (!silent) toast('Canvas color applied to all ' + pdfed.pages.length + ' pages', 'success');
}

// Restores the page to its pre-tint pixels, if the most recent edit on this
// page was an Apply from this panel. Like the Adjust panel, this is a
// single-level safety net, not full undo history.
async function pdfedRemoveCanvasTint() {
  if (pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  if (!pg.edits.preTintDataUrl) { toast('No canvas tint to remove', 'info'); return; }
  pg.dataUrl = pg.edits.preTintDataUrl;
  delete pg.edits.preTintDataUrl;
  delete pg.edits.canvasTintBaseDataUrl;
  delete pg.edits.canvasTint;
  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  toast('Canvas tint removed', 'success');
}

// Syncs every visible control in the Canvas Color flyout (mode buttons,
// solid/gradient visibility, colour pickers, angle + opacity sliders) to
// whatever pdfedCanvasTintState currently holds. Shared by Reset-to-White
// and by applying a saved preset, so both land in a fully consistent UI.
function pdfedCanvasSyncControls() {
  const s = pdfedCanvasTintState;

  const solidBtn = document.getElementById('pdfedCtintModeSolidBtn');
  const gradBtn = document.getElementById('pdfedCtintModeGradBtn');
  const imageBtn = document.getElementById('pdfedCtintModeImageBtn');
  if (solidBtn) solidBtn.classList.toggle('active', s.mode === 'solid');
  if (gradBtn) gradBtn.classList.toggle('active', s.mode === 'gradient');
  if (imageBtn) imageBtn.classList.toggle('active', s.mode === 'image');
  const solidControls = document.getElementById('pdfedCtintSolidControls');
  const gradControls = document.getElementById('pdfedCtintGradControls');
  const imageControls = document.getElementById('pdfedCtintImageControls');
  if (solidControls) solidControls.style.display = s.mode === 'solid' ? '' : 'none';
  if (gradControls) gradControls.style.display = s.mode === 'gradient' ? '' : 'none';
  if (imageControls) imageControls.style.display = s.mode === 'image' ? '' : 'none';
  pdfedCanvasImageSyncThumb();

  document.querySelectorAll('#pdfedCtintSolidControls .pdfed-ctint-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.color && el.dataset.color.toLowerCase() === s.color1.toLowerCase());
  });
  const color1Picker = document.getElementById('pdfedCtintColor1Picker');
  if (color1Picker) { color1Picker.value = s.color1; if (color1Picker.parentElement) color1Picker.parentElement.style.background = s.color1; }
  const gradColor1Picker = document.getElementById('pdfedCtintGradColor1Picker');
  if (gradColor1Picker) { gradColor1Picker.value = s.color1; if (gradColor1Picker.parentElement) gradColor1Picker.parentElement.style.background = s.color1; }
  const gradColor2Picker = document.getElementById('pdfedCtintGradColor2Picker');
  if (gradColor2Picker) { gradColor2Picker.value = s.color2; if (gradColor2Picker.parentElement) gradColor2Picker.parentElement.style.background = s.color2; }
  const grad1Hex = document.getElementById('pdfedCtintGradColor1Hex');
  if (grad1Hex) grad1Hex.textContent = s.color1.toUpperCase();
  const grad2Hex = document.getElementById('pdfedCtintGradColor2Hex');
  if (grad2Hex) grad2Hex.textContent = s.color2.toUpperCase();
  const angleSlider = document.getElementById('pdfedCtintAngleSlider');
  const angleVal = document.getElementById('pdfedCtintAngleVal');
  if (angleSlider) angleSlider.value = s.angle;
  if (angleVal) angleVal.textContent = s.angle;
  const opacitySlider = document.getElementById('pdfedCtintOpacitySlider');
  const opacityVal = document.getElementById('pdfedCtintOpacityVal');
  if (opacitySlider) opacitySlider.value = s.opacity;
  if (opacityVal) opacityVal.textContent = s.opacity;

  pdfedCanvasTintRefreshPreview();
}

// Clears any colour/gradient choice back to plain solid white, resets every
// control in the flyout to match, and bakes that white fill onto the active
// page the same way Apply to Canvas does — unlike Remove Tint (which reverts
// to whatever the page looked like before), this always lands on white.
async function pdfedResetCanvasTintToWhite() {
  pdfedCanvasTintState.mode = 'solid';
  pdfedCanvasTintState.color1 = '#FFFFFF';
  pdfedCanvasTintState.color2 = '#FFFFFF';
  pdfedCanvasTintState.angle = 90;
  pdfedCanvasTintState.opacity = 100;
  pdfedCanvasTintState.imageDataUrl = null;

  pdfedCanvasSyncControls();

  if (pdfed.active >= 0) {
    await pdfedApplyCanvasTint(true);
    toast('Canvas reset to white', 'success');
  }
}

// ─── SAVED GRADIENTS / COLOURS ──────────────────────────────────────────
// User's own colour + gradient choices, saved per-browser so they carry
// over between pages, documents, and sessions — click a saved swatch to
// load it straight back into the live canvas preview (not yet baked;
// still needs Apply to Canvas, same as picking a fresh colour would).
const PDFED_CANVAS_PRESETS_KEY = 'sarvarcPdfEditorCanvasPresets_v1';
const PDFED_CANVAS_PRESETS_MAX = 12;
let pdfedCanvasPresetsState = { list: [] };

function pdfedCanvasPresetsLoad() {
  try {
    const raw = localStorage.getItem(PDFED_CANVAS_PRESETS_KEY);
    pdfedCanvasPresetsState.list = raw ? JSON.parse(raw) : [];
  } catch (e) {
    pdfedCanvasPresetsState.list = [];
  }
}

function pdfedCanvasPresetsSave() {
  try {
    localStorage.setItem(PDFED_CANVAS_PRESETS_KEY, JSON.stringify(pdfedCanvasPresetsState.list));
  } catch (e) { /* storage unavailable, presets stay in-memory for this session */ }
}

function pdfedCanvasPresetCss(p) {
  return p.mode === 'gradient'
    ? `linear-gradient(${p.angle}deg, ${p.color1}, ${p.color2})`
    : p.color1;
}

function pdfedCanvasSaveCurrentAsPreset() {
  const s = pdfedCanvasTintState;
  if (s.mode === 'image') { toast('Image backgrounds can\'t be saved as presets', 'info'); return; }
  const preset = { id: 'ctp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), mode: s.mode, color1: s.color1, color2: s.color2, angle: s.angle, opacity: s.opacity };

  // Skip an exact duplicate of the most recently saved swatch
  const dupe = pdfedCanvasPresetsState.list.find(p => p.mode === preset.mode && p.color1 === preset.color1 && p.color2 === preset.color2 && p.angle === preset.angle && p.opacity === preset.opacity);
  if (dupe) { toast('That colour is already saved', 'info'); return; }

  pdfedCanvasPresetsState.list.unshift(preset);
  if (pdfedCanvasPresetsState.list.length > PDFED_CANVAS_PRESETS_MAX) {
    pdfedCanvasPresetsState.list.length = PDFED_CANVAS_PRESETS_MAX;
  }
  pdfedCanvasPresetsSave();
  pdfedCanvasPresetsRender();
  toast(preset.mode === 'gradient' ? 'Gradient saved' : 'Colour saved', 'success');
}

function pdfedCanvasApplyPreset(id) {
  const p = pdfedCanvasPresetsState.list.find(x => x.id === id);
  if (!p) return;
  pdfedCanvasTintState.mode = p.mode;
  pdfedCanvasTintState.color1 = p.color1;
  pdfedCanvasTintState.color2 = p.color2;
  pdfedCanvasTintState.angle = p.angle;
  pdfedCanvasTintState.opacity = p.opacity;
  pdfedCanvasSyncControls();
}

function pdfedCanvasDeletePreset(id, evt) {
  if (evt) evt.stopPropagation();
  pdfedCanvasPresetsState.list = pdfedCanvasPresetsState.list.filter(p => p.id !== id);
  pdfedCanvasPresetsSave();
  pdfedCanvasPresetsRender();
}

function pdfedCanvasPresetsRender() {
  const grid = document.getElementById('pdfedCanvasPresetGrid');
  const empty = document.getElementById('pdfedCanvasPresetEmpty');
  if (!grid) return;
  const list = pdfedCanvasPresetsState.list;
  if (empty) empty.style.display = list.length ? 'none' : '';
  grid.innerHTML = list.map(p => {
    const label = p.mode === 'gradient' ? `Gradient ${p.angle}°` : p.color1.toUpperCase();
    const title = p.mode === 'gradient' ? `${p.color1} → ${p.color2}, ${p.angle}°` : p.color1;
    return `<div class="pdfed-ctint-preset-card" title="${title}" onclick="pdfedCanvasApplyPreset('${p.id}')">
      <div class="pdfed-ctint-preset-item" style="background:${pdfedCanvasPresetCss(p)}">
        <button type="button" class="pdfed-ctint-preset-del" onclick="pdfedCanvasDeletePreset('${p.id}', event)" title="Remove saved colour">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <span class="pdfed-ctint-preset-label">${label}</span>
    </div>`;
  }).join('');
}

// Every export path (PDF/PNG/etc.) reads a page's baked pg.dataUrl —
// which only carries a canvas gradient/tint AFTER "Apply to Canvas" has
// been clicked. Until then it's just a live CSS overlay sitting on top of
// the canvas, invisible to anything that rasterizes pg.dataUrl, so a
// person who dialed in a gradient but never hit Apply would export a
// plain white/blank page even though the editor clearly shows the color.
// Call this at the top of every export entry point: if the Canvas Color
// panel is open with a pending preview still showing for the active page,
// silently bake it in first (same code path as clicking Apply) so the
// download always matches what's on screen, exactly as the panel's own
// helper text promises.
async function pdfedFinalizePendingCanvasTint() {
  const panel = document.getElementById('pdfedCanvasPanelBody');
  const preview = document.getElementById('pdfedCanvasTintPreview');
  if (panel && panel.classList.contains('open') && preview && preview.style.display !== 'none' && pdfed.active >= 0) {
    try { await pdfedApplyCanvasTint(); } catch (e) { /* non-fatal — fall back to unapplied state */ }
  }
}

// ─── SARVARC EYE ───────────────────────────────────────────────────────
// One click, no sliders, no picker: SARVARC Eye samples the page's own
// colors and tonal range, decides for itself what kind of design it's
// looking at — cool/vibrant environment, premium/luxury, soft aesthetic,
// or bold print-ready — and applies the enhancement recipe built for that
// look (see the brain: SARVARC_EYE_PROFILES / sarvarcEyeDetectStyle below).
// Pipeline per style: fast contrast/saturation/brightness pass -> per-
// channel auto-levels (histogram black/white point stretch, clip strength
// tuned per style) -> unsharp-mask sharpen (amount tuned per style) ->
// vignette tinted/weighted to match. Baked straight into the page's
// dataUrl the same way Adjust/Rotate/Border do, so it survives export,
// thumbnails, and reload exactly like any other edit.
let pdfedEyeReplaying = false;

// Plays the shimmer overlay's single sweep. Restarts cleanly even if fired
// twice in quick succession (re-triggering a CSS animation requires forcing
// a reflow after removing the class, otherwise the browser just no-ops).
function sarvarcEyePlayShimmer() {
  const el = document.getElementById('sarvarcEyeShimmer');
  if (!el) return;
  el.classList.remove('play');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add('play');
  el.addEventListener('animationend', () => el.classList.remove('play'), { once: true });
}

// ─── THE BRAIN ──────────────────────────────────────────────────────────
// SARVARC Eye looks at the page before touching it and decides, on its
// own, what kind of design this is — then reaches for the enhancement
// recipe built for that look instead of applying one generic pass to
// everything. No prompt, no picker: it samples the page's own colors and
// tonal range and classifies it into one of four profiles below.
const SARVARC_EYE_PROFILES = {
  // Blues / teals / greens dominate and the palette has real saturation —
  // nature, water, tech, outdoor scenes. Leans cooler and brighter, extra
  // saturation to make that environment feel alive.
  cool: {
    label: 'cool, vibrant environment',
    filter: 'contrast(110%) saturate(138%) brightness(105%) hue-rotate(-3deg)',
    clipPct: 0.005,
    sharpen: 0.40,
    vignette: ['rgba(0,20,40,0)', 'rgba(0,28,52,0.14)']
  },
  // Dark, low-key, restrained saturation, often warm gold/silver accents
  // against near-black — the classic luxury-brand palette. Pulled back
  // saturation, deeper blacks, a heavier corner vignette instead of a
  // punchy color boost.
  premium: {
    label: 'premium, high-end look',
    filter: 'contrast(118%) saturate(88%) brightness(97%)',
    clipPct: 0.003,
    sharpen: 0.28,
    vignette: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.26)']
  },
  // Bright, airy, low-saturation, mostly pastel — minimalist or "soft"
  // social-style design. Gentle lift only, so it stays soft instead of
  // turning punchy.
  aesthetic: {
    label: 'soft, aesthetic look',
    filter: 'contrast(104%) saturate(112%) brightness(107%)',
    clipPct: 0.002,
    sharpen: 0.20,
    vignette: ['rgba(30,20,10,0)', 'rgba(30,20,10,0.06)']
  },
  // Fallback: bold, saturated, high-contrast — flyers/menus/posters that
  // just need to pop. This is the original SARVARC Eye recipe.
  punchy: {
    label: 'bold, punchy print-ready look',
    filter: 'contrast(112%) saturate(124%) brightness(102%)',
    clipPct: 0.005,
    sharpen: 0.35,
    vignette: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.10)']
  }
};

// Samples the page at a capped resolution (bounded work regardless of the
// source image size) and scores brightness, saturation, cool-hue coverage,
// warm-gold-hue coverage, and pastel coverage. Those four numbers feed a
// simple decision tree — no ML model needed, just the same cues a designer
// would eyeball first.
function sarvarcEyeDetectStyle(img, w, h) {
  const sampleCan = document.createElement('canvas');
  sampleCan.width = w; sampleCan.height = h;
  const sctx = sampleCan.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, w, h).data;

  const total = w * h;
  const step = Math.max(1, Math.floor(total / 30000)); // cap ~30k sampled pixels

  let n = 0, sumBrightness = 0, sumSqBrightness = 0, sumSat = 0, coolHue = 0, warmGoldHue = 0, pastelish = 0;
  let minBright = 1, maxBright = 0;

  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const sat = max === 0 ? 0 : d / max;
    sumBrightness += bright;
    sumSqBrightness += bright * bright;
    sumSat += sat;
    if (bright < minBright) minBright = bright;
    if (bright > maxBright) maxBright = bright;

    if (d > 6) {
      let hue;
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
      if (hue >= 165 && hue <= 255) coolHue++;                               // blue / teal / cyan
      else if (hue >= 30 && hue <= 55 && sat > 0.25 && bright > 0.35) warmGoldHue++; // gold / amber
    }
    if (sat < 0.28 && bright > 0.55) pastelish++;
    n++;
  }

  const avgBrightness = sumBrightness / n;
  const avgSat = sumSat / n;
  const coolRatio = coolHue / n;
  const warmGoldRatio = warmGoldHue / n;
  const pastelRatio = pastelish / n;
  // Population variance of sampled brightness — a genuinely blank page (flat
  // white, or any single flat color) has essentially zero spread here, which
  // is a much more reliable "is there anything on this page" signal than
  // brightness alone (a solid dark page would otherwise look "premium").
  const brightnessVariance = Math.max(0, sumSqBrightness / n - avgBrightness * avgBrightness);
  const metrics = { avgBrightness, avgSat, coolRatio, warmGoldRatio, pastelRatio, brightnessVariance, spread: maxBright - minBright };

  // Nothing drawn: near-zero brightness variance and near-zero tonal spread
  // means every sampled pixel is basically the same flat color — an empty
  // page, not a design choice.
  if (brightnessVariance < 0.00006 && (maxBright - minBright) < 0.03 && avgSat < 0.03) {
    return { key: 'empty', metrics };
  }

  // Dark + restrained saturation + a gold/warm accent (or just very dark) →
  // premium/luxury palette.
  if (avgBrightness < 0.42 && avgSat < 0.42 && (warmGoldRatio > 0.03 || avgBrightness < 0.30)) {
    return { key: 'premium', metrics };
  }
  // Real coverage of blue/teal/green hues with actual saturation → cool,
  // lively environment.
  if (coolRatio > 0.16 && avgSat > 0.25) {
    return { key: 'cool', metrics };
  }
  // Bright and mostly low-saturation pastel → soft aesthetic look.
  if (pastelRatio > 0.35 && avgBrightness > 0.60) {
    return { key: 'aesthetic', metrics };
  }
  // Otherwise: treat it as bold print work and give it the punchy pass.
  return { key: 'punchy', metrics };
}

// Shared refine pipeline: given any image dataUrl, detects its style and
// runs the full SARVARC Eye recipe (filter pass -> auto-levels -> sharpen ->
// vignette), returning the refined dataUrl plus which style was detected —
// or null if the source is blank/empty. Used both for a page's own flat
// bitmap (a scanned/photo page) AND for each individual image placed as a
// movable overlay on top of a page, so the exact same one-click refine
// quality reaches both workflows instead of only the flat-page case.
async function sarvarcEyeRefineDataUrl(srcDataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = srcDataUrl; });
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;

  const detected = sarvarcEyeDetectStyle(img, w, h);
  if (detected.key === 'empty') return null;

  const profile = SARVARC_EYE_PROFILES[detected.key];
  const can = document.createElement('canvas');
  can.width = w; can.height = h;
  const ctx = can.getContext('2d');

  // Fast native pass first: the contrast/saturation/brightness lift the
  // detected style calls for.
  ctx.filter = profile.filter;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';

  // Auto black/white point stretch — clip strength tuned per style so a
  // premium/aesthetic look doesn't get stretched as hard as a punchy one.
  let imgData = ctx.getImageData(0, 0, w, h);
  sarvarcEyeAutoLevels(imgData, profile.clipPct);

  // Unsharp-mask sharpen, amount tuned per style so text/edges read crisp
  // without over-sharpening a soft aesthetic look.
  sarvarcEyeSharpen(imgData, w, h, profile.sharpen);
  ctx.putImageData(imgData, 0, 0);

  // Vignette tinted and weighted to match the detected style.
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, profile.vignette[0]);
  grad.addColorStop(1, profile.vignette[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  return { dataUrl: can.toDataURL('image/png'), key: detected.key, label: profile.label };
}

async function sarvarcEyeApply() {
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) { toast('Open a PDF or start a blank page first', 'info'); return; }
  const pg = pdfed.pages[idx];

  // Idempotent by design: one click is meant to be "the" refine action.
  // Running it twice on top of itself would blow out contrast/sharpening,
  // so a second click just points at Undo instead of stacking passes.
  if (pg.edits && pg.edits.sarvarcEye) {
    toast('SARVARC Eye is already applied — undo (Ctrl+Z) first if you want to re-run it', 'info');
    return;
  }

  const btn = document.getElementById('sarvarcEyeBtn');
  if (btn) btn.classList.add('sarvarc-eye-busy');

  // Placed images — the movable/lockable photos dropped onto this page via
  // Insert Image or Stock Photos — are refined right alongside the page's
  // own flat bitmap. Snapshot every dataUrl SARVARC Eye might touch so a
  // single Undo restores everything exactly as it was.
  const placedList = pg.placedImages || [];
  const eyeUndoSnap = {
    dataUrl: pg.dataUrl,
    modified: pg.modified,
    placedUrls: placedList.map(it => it.dataUrl)
  };

  try {
    // 1) The page's own flat bitmap — a scanned page, a photo opened as its
    //    own page, or just a plain/blank canvas background.
    const srcUrl = await pdfedPageUrl(pg);
    const pageRefined = await sarvarcEyeRefineDataUrl(srcUrl);

    // 2) Every image placed on top of the page, refined individually (each
    //    photo gets its own style detection, since two placed images can
    //    easily be completely different kinds of shots) — same recipe, same
    //    quality, just applied per-object instead of to one flat bitmap.
    //    Position, size, lock state, and layer order are left untouched;
    //    only each image's own pixels change.
    const placedResults = [];
    for (const item of placedList) {
      placedResults.push(await sarvarcEyeRefineDataUrl(item.dataUrl));
    }

    const refinedCount = placedResults.filter(Boolean).length;
    if (!pageRefined && !refinedCount) {
      toast('Canvas is empty', 'info');
      return;
    }

    if (pageRefined) pg.dataUrl = pageRefined.dataUrl;
    placedList.forEach((item, i) => { if (placedResults[i]) item.dataUrl = placedResults[i].dataUrl; });

    pg.modified = true;
    pg.edits = pg.edits || {};
    pg.edits.sarvarcEye = true;
    pg.edits.sarvarcEyeStyle = (pageRefined && pageRefined.key) || ((placedResults.find(Boolean) || {}).key);

    await pdfedGoto(idx);
    if (placedList.length) pdfedRenderPlacedImages(idx);
    await pdfedBuildStrip();
    sarvarcEyePlayShimmer();

    const styleLabel = (pageRefined && pageRefined.label) || ((placedResults.find(Boolean) || {}).label) || 'design';
    const msg = pageRefined && refinedCount
      ? `SARVARC Eye applied — refined the page and ${refinedCount} placed image${refinedCount > 1 ? 's' : ''} to match a ${styleLabel}`
      : refinedCount
        ? `SARVARC Eye applied — refined ${refinedCount} placed image${refinedCount > 1 ? 's' : ''} to match a ${styleLabel}`
        : `SARVARC Eye applied — detected a ${styleLabel}, refined to match`;
    toast(msg, 'success');

    if (!pdfedEyeReplaying) {
      pushAppHistory({
        label: 'SARVARC Eye',
        undo: async () => {
          pg.dataUrl = eyeUndoSnap.dataUrl;
          pg.modified = eyeUndoSnap.modified;
          placedList.forEach((item, i) => { item.dataUrl = eyeUndoSnap.placedUrls[i]; });
          if (pg.edits) pg.edits.sarvarcEye = false;
          await pdfedGoto(idx);
          if (placedList.length) pdfedRenderPlacedImages(idx);
          await pdfedBuildStrip();
          toast('SARVARC Eye undone', 'info');
        },
        redo: async () => {
          pdfedEyeReplaying = true;
          try { await sarvarcEyeApply(); } finally { pdfedEyeReplaying = false; }
        }
      });
    }
  } catch (e) {
    console.error(e);
    toast('Could not apply SARVARC Eye, try again', 'error');
  } finally {
    if (btn) btn.classList.remove('sarvarc-eye-busy');
  }
}

// Per-channel histogram stretch: finds the black/white point that clips the
// darkest and lightest ~0.5% of pixels, then remaps that range to full
// 0–255. Mutates imgData in place.
function sarvarcEyeAutoLevels(imgData, clipPct) {
  const data = imgData.data;
  const histR = new Array(256).fill(0), histG = new Array(256).fill(0), histB = new Array(256).fill(0);
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    histR[data[i]]++; histG[data[i + 1]]++; histB[data[i + 2]]++;
  }
  const clip = Math.max(1, Math.floor(total * (clipPct != null ? clipPct : 0.005)));
  const findBounds = (hist) => {
    let lo = 0, acc = 0;
    while (lo < 255 && acc < clip) { acc += hist[lo]; lo++; }
    let hi = 255; acc = 0;
    while (hi > 0 && acc < clip) { acc += hist[hi]; hi--; }
    if (hi <= lo) { lo = 0; hi = 255; }
    return [lo, hi];
  };
  const [rLo, rHi] = findBounds(histR);
  const [gLo, gHi] = findBounds(histG);
  const [bLo, bHi] = findBounds(histB);
  const rSpan = Math.max(1, rHi - rLo), gSpan = Math.max(1, gHi - gLo), bSpan = Math.max(1, bHi - bLo);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.max(0, Math.min(255, (data[i]     - rLo) * 255 / rSpan));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - gLo) * 255 / gSpan));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - bLo) * 255 / bSpan));
  }
}

// Lightweight unsharp mask: box-blurs a copy, then pushes the original away
// from that blur by `amount`. Cheap enough at this kernel size to add crisp,
// print-ready edges without visible haloing. Mutates imgData in place.
function sarvarcEyeSharpen(imgData, w, h, amount) {
  const src = imgData.data;
  const out = new Uint8ClampedArray(src);
  const idxAt = (x, y) => (y * w + x) * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = idxAt(x, y);
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        sum += src[idxAt(x - 1, y - 1) + c] + src[idxAt(x, y - 1) + c] + src[idxAt(x + 1, y - 1) + c];
        sum += src[idxAt(x - 1, y)     + c] + src[idxAt(x, y)     + c] + src[idxAt(x + 1, y)     + c];
        sum += src[idxAt(x - 1, y + 1) + c] + src[idxAt(x, y + 1) + c] + src[idxAt(x + 1, y + 1) + c];
        const blur = sum / 9;
        out[i + c] = src[i + c] + (src[i + c] - blur) * amount;
      }
    }
  }
  imgData.data.set(out);
}

// ─── MY NOTES ───────────────────────────────────────────────────────────
// Private, per-browser task list. Lives only in localStorage + the right-panel
// DOM, it is never read by pdfedExport() or any export/rasterize path, so it
// can NEVER end up baked into a downloaded PDF.
const PDFED_NOTES_KEY = 'sarvarcPdfEditorNotes_v1';
let pdfedNotesState = { list: [] };

function pdfedNotesLoad() {
  try {
    const raw = localStorage.getItem(PDFED_NOTES_KEY);
    pdfedNotesState.list = raw ? JSON.parse(raw) : [];
  } catch (e) {
    pdfedNotesState.list = [];
  }
}

function pdfedNotesSave() {
  try {
    localStorage.setItem(PDFED_NOTES_KEY, JSON.stringify(pdfedNotesState.list));
  } catch (e) { /* storage unavailable, notes stay in-memory for this session */ }
}

function pdfedShowRightTab(tab) {
  const infoWrap    = document.getElementById('pdfedRightDefaultSections');
  const assetsPanel = document.getElementById('pdfedAssetsPanel');
  const notesPanel  = document.getElementById('pdfedNotesPanel');
  const infoBtn     = document.getElementById('pdfedTabInfoBtn');
  const assetsBtn   = document.getElementById('pdfedTabAssetsBtn');
  const notesBtn    = document.getElementById('pdfedTabNotesBtn');
  if (!infoWrap || !notesPanel || !assetsPanel) return;

  infoWrap.style.display    = tab === 'info'   ? 'flex'  : 'none';
  assetsPanel.style.display = tab === 'assets' ? ''      : 'none';
  notesPanel.style.display  = tab === 'notes'  ? ''      : 'none';
  infoBtn.classList.toggle('active', tab === 'info');
  assetsBtn.classList.toggle('active', tab === 'assets');
  notesBtn.classList.toggle('active', tab === 'notes');

  if (tab === 'notes') pdfedNotesRender();
  if (tab === 'assets' && typeof sarvarcAssetsRenderPanel === 'function') sarvarcAssetsRenderPanel();
}

function pdfedNoteInputKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); pdfedNotesAdd(); }
}

function pdfedNotesAdd() {
  const input = document.getElementById('pdfedNoteInput');
  const text = (input.value || '').trim();
  if (!text) return;
  pdfedNotesState.list.unshift({ id: 'n' + Date.now() + Math.random().toString(36).slice(2,7), text, done: false, ts: Date.now() });
  input.value = '';
  pdfedNotesSave();
  pdfedNotesRender();
  input.focus();
}

function pdfedNotesToggleDone(id) {
  const n = pdfedNotesState.list.find(n => n.id === id);
  if (!n) return;
  n.done = !n.done;
  pdfedNotesSave();
  pdfedNotesRender();
}

function pdfedNotesDelete(id) {
  pdfedNotesState.list = pdfedNotesState.list.filter(n => n.id !== id);
  pdfedNotesSave();
  pdfedNotesRender();
}

function pdfedNotesClearDone() {
  pdfedNotesState.list = pdfedNotesState.list.filter(n => !n.done);
  pdfedNotesSave();
  pdfedNotesRender();
}

function pdfedNotesEscapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function pdfedNotesRender() {
  const listEl = document.getElementById('pdfedNotesList');
  const footEl = document.getElementById('pdfedNotesFooter');
  const countEl = document.getElementById('pdfedNotesCountLabel');
  const badgeEl = document.getElementById('pdfedNotesBadge');
  const dotEl = document.getElementById('pdfedNotesDot');
  if (!listEl) return;

  const list = pdfedNotesState.list;
  const pending = list.filter(n => !n.done).length;
  badgeEl.textContent = pending > 0 ? String(pending) : '';
  if (dotEl) dotEl.style.display = pending > 0 ? '' : 'none';

  if (list.length === 0) {
    listEl.innerHTML = `<div class="pdfed-notes-empty">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;margin-bottom:6px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><br>
      Nothing here yet.<br>Jot something down whenever you need to.
    </div>`;
    footEl.style.display = 'none';
    return;
  }

  listEl.innerHTML = list.map(n => `
    <div class="pdfed-note-item ${n.done ? 'done' : ''}">
      <div class="pdfed-note-check" onclick="pdfedNotesToggleDone('${n.id}')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="pdfed-note-text">${pdfedNotesEscapeHtml(n.text)}</div>
      <div class="pdfed-note-del" onclick="pdfedNotesDelete('${n.id}')" title="Delete note">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
    </div>
  `).join('');

  const done = list.length - pending;
  countEl.textContent = pending === 0
    ? `All caught up, ${done} done`
    : `${pending} to go · ${done} done`;
  footEl.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
  pdfedNotesLoad();
  pdfedNotesRender();
  pdfedCanvasPresetsLoad();
  pdfedCanvasPresetsRender();
});

// ─── CANVAS RIGHT-CLICK CONTEXT MENU ────────────────────────────────────
// Quick-access menu for right-clicking the canvas. Context-aware: shows a
// different set of actions depending on whether the click landed on a
// placed image, placed text box, or empty canvas / page.
const PDFED_CTX_ICONS = {
  undo:      '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  redo:      '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  zoomIn:    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut:   '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  fit:       '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  text:      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  image:     '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  signature: '<path d="M3 17c2-1 3-3 4-5 1.2-2.4 2-5 3-5s.5 3.5 2 6c1 1.7 2.3 2.6 4 2 1.4-.5 2-2 3-2s1.5 1.5 3 1"/><path d="M3 21h18"/>',
  highlight: '<path d="M12 20h9"/><path d="m16.375 3.625-9.5 9.5L5 21l7.875-1.875 9.5-9.5a2.652 2.652 0 0 0-3.75-3.75z"/><path d="m14 6 4 4"/>',
  draw:      '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  redact:    '<rect x="2" y="7" width="20" height="10" rx="1" fill="currentColor" stroke="none"/>',
  rotateL:   '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.21"/>',
  rotateR:   '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.21"/>',
  crop:      '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  plus:      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  duplicate: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash:     '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  clear:     '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>',
  revert:    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  exportIco: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  lock:      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock:    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  front:     '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  back:      '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  fwd:       '<polyline points="18 15 12 9 6 15"/>',
  bwd:       '<polyline points="6 9 12 15 18 9"/>',
  layers:    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  open:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  folder:    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'
};

function pdfedCtxIcon(name) {
  const path = PDFED_CTX_ICONS[name] || '';
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

let pdfedCtxSubmenuTimer = null;

function pdfedCloseCtxMenu() {
  const m = document.getElementById('pdfedCtxMenu');
  if (m) { m.classList.remove('open'); m.style.display = 'none'; m.innerHTML = ''; }
  pdfedCloseCtxSubmenu();
  document.removeEventListener('click', pdfedCloseCtxMenu);
  document.removeEventListener('scroll', pdfedCtxScrollGuard, true);
}

function pdfedCloseCtxSubmenu() {
  clearTimeout(pdfedCtxSubmenuTimer);
  const sm = document.getElementById('pdfedCtxSubmenu');
  if (sm) { sm.classList.remove('open'); sm.style.display = 'none'; sm.innerHTML = ''; sm.onmouseenter = null; sm.onmouseleave = null; }
}

// Renders one row of either the main menu or a submenu flyout. Items with a
// non-empty `children` array (e.g. the placed-image menu's "Send to Client
// Folder") get a trailing chevron — hovering them opens pdfedOpenCtxSubmenu
// rather than firing onClick directly.
function pdfedCtxRenderRow(it) {
  if (it.type === 'sep') return '<div class="pdfed-ctx-sep"></div>';
  if (it.type === 'label') return `<div class="pdfed-ctx-label">${it.label}</div>`;
  const hasChildren = Array.isArray(it.children) && it.children.length > 0;
  const cls = ['pdfed-ctx-item', it.disabled ? 'disabled' : '', it.danger ? 'danger' : '', hasChildren ? 'has-submenu' : ''].filter(Boolean).join(' ');
  const chevron = hasChildren ? '<svg class="pdfed-ctx-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>' : '';
  return `<div class="${cls}" data-act="${it.id || ''}">${pdfedCtxIcon(it.icon)}<span>${it.label}</span>${it.shortcut ? `<span class="pdfed-ctx-shortcut">${it.shortcut}</span>` : ''}${chevron}</div>`;
}

function pdfedOpenCtxMenu(clientX, clientY, items) {
  const m = document.getElementById('pdfedCtxMenu');
  if (!m) return;
  pdfedCloseCtxSubmenu();
  m.innerHTML = items.map(pdfedCtxRenderRow).join('');

  // wire clicks + hover-to-open-submenu
  m.querySelectorAll('.pdfed-ctx-item[data-act]:not(.disabled)').forEach(el => {
    const it = items.find(i => i.id === el.dataset.act);
    if (!it) return;
    if (Array.isArray(it.children) && it.children.length) {
      el.addEventListener('mouseenter', () => pdfedOpenCtxSubmenu(el, it.children));
      el.addEventListener('mouseleave', () => { pdfedCtxSubmenuTimer = setTimeout(pdfedCloseCtxSubmenu, 220); });
    }
    if (it.onClick) {
      el.addEventListener('click', (ev) => { ev.stopPropagation(); pdfedCloseCtxMenu(); it.onClick(ev); });
    }
  });

  // position, clamped to viewport
  m.style.display = 'block';
  m.classList.add('open');
  const menuRect = m.getBoundingClientRect();
  let x = clientX, y = clientY;
  if (x + menuRect.width > window.innerWidth - 8) x = window.innerWidth - menuRect.width - 8;
  if (y + menuRect.height > window.innerHeight - 8) y = window.innerHeight - menuRect.height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  m.style.left = x + 'px';
  m.style.top = y + 'px';

  // close on outside click / outside scroll / escape
  // (ignore scrolls that originate inside the menu itself, so its own
  // item list, 20 items, taller than the viewport in some cases, can scroll)
  setTimeout(() => {
    document.addEventListener('click', pdfedCloseCtxMenu);
    document.addEventListener('scroll', pdfedCtxScrollGuard, true);
  }, 0);
}

// Opens the hover flyout for a has-submenu item (e.g. the list of client
// folders under "Send to Client Folder"). Kept as its own fixed panel
// (#pdfedCtxSubmenu, see markup next to #pdfedCtxMenu) rather than nested
// inside .pdfed-ctxmenu, since that container's own overflow-y:auto would
// otherwise clip a flyout extending past its right edge.
function pdfedOpenCtxSubmenu(parentEl, children) {
  clearTimeout(pdfedCtxSubmenuTimer);
  const sm = document.getElementById('pdfedCtxSubmenu');
  if (!sm) return;
  sm.innerHTML = children.map(pdfedCtxRenderRow).join('');
  sm.querySelectorAll('.pdfed-ctx-item[data-act]:not(.disabled)').forEach(el => {
    const it = children.find(i => i.id === el.dataset.act);
    if (it && it.onClick) {
      el.addEventListener('click', (ev) => { ev.stopPropagation(); pdfedCloseCtxMenu(); it.onClick(ev); });
    }
  });
  sm.style.display = 'block';
  sm.classList.add('open');

  const pRect = parentEl.getBoundingClientRect();
  const smRect = sm.getBoundingClientRect();
  let x = pRect.right + 4;
  if (x + smRect.width > window.innerWidth - 8) x = pRect.left - smRect.width - 4;
  let y = pRect.top - 6;
  if (y + smRect.height > window.innerHeight - 8) y = window.innerHeight - smRect.height - 8;
  if (y < 8) y = 8;
  sm.style.left = x + 'px';
  sm.style.top = y + 'px';

  // stay open while the cursor is over the flyout itself, so the person can
  // move diagonally from the parent row into the folder list without it
  // vanishing mid-move
  sm.onmouseenter = () => clearTimeout(pdfedCtxSubmenuTimer);
  sm.onmouseleave = () => { pdfedCtxSubmenuTimer = setTimeout(pdfedCloseCtxSubmenu, 220); };
}

// getBoundingClientRect() on a display:none element (which #pdfedTabAssetsBtn
// and the folder chips both are whenever the right panel is collapsed, or
// showing a different tab) returns an all-zero rect sitting at the
// viewport's top-left corner — that's the bug where the fly-dot below
// looked like it was heading "left" instead of toward the folder: it was
// honestly flying at its target, the target just wasn't actually visible.
// This only ever hands back a rect for something with real on-screen size.
function pdfedElVisibleRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return (r.width > 0 && r.height > 0) ? r : null;
}

// Makes sure the folder the asset just got filed into is actually the thing
// on screen before the dot flies — expands the right panel if it's
// collapsed, switches it to the Assets tab, and filters the grid to that
// folder, so the person watches the dot land on the real chip instead of a
// stand-in. Waits out the panel's own open/expand transition (0.32s, see
// .pdfeditor-layout's grid-template-columns transition) before measuring,
// since animating toward a still-mid-transition rect would be wrong too.
function pdfedRevealAssetsFolderThenFlyDot(folderId, clientX, clientY, assetType) {
  const layout = document.querySelector('.pdfeditor-layout');
  const wasCollapsed = !!(layout && layout.classList.contains('right-collapsed'));
  const assetsBtn = document.getElementById('pdfedTabAssetsBtn');
  const wasOnAssetsTab = !!(assetsBtn && assetsBtn.classList.contains('active'));

  if (wasCollapsed && typeof pdfedToggleRightPanel === 'function') pdfedToggleRightPanel();
  if (typeof pdfedShowRightTab === 'function') pdfedShowRightTab('assets');
  // Switch the Images/Logos/Signatures type-tab to match what was actually
  // just filed, BEFORE selecting the folder. Without this, the panel keeps
  // whatever type tab was already active (defaults to 'image') while the
  // folder filter is applied on top of it — so sending a signature into a
  // client folder reveals that folder while still on the Images tab, which
  // correctly shows zero results (a signature isn't an image) and looks
  // exactly like the file never made it in, even though it did.
  if (assetType && typeof sarvarcAssetsShowTab === 'function') sarvarcAssetsShowTab(assetType);
  if (typeof sarvarcAssetsSelectFolder === 'function') sarvarcAssetsSelectFolder(folderId);

  const run = () => pdfedFlyDotToClientFolder(clientX, clientY, folderId);
  if (wasCollapsed) {
    setTimeout(() => requestAnimationFrame(run), 360); // panel expand transition
  } else if (!wasOnAssetsTab) {
    requestAnimationFrame(() => requestAnimationFrame(run)); // just a tab swap + re-render, one frame is enough
  } else {
    run(); // already sitting on the Assets tab — chip is on screen right now
  }
}

// The little traveling dot shown when an asset is sent straight into a
// client folder from a right-click menu (currently: a placed image's "Send
// to Client Folder"). Arcs from the click point to the real folder chip —
// pdfedRevealAssetsFolderThenFlyDot (above) has already made sure that chip
// is on screen by the time this runs — falling back to the Assets tab
// button, then the panel's own open/close handle, only if something about
// that reveal didn't stick; if nothing on the fallback chain is actually
// visible either, this skips the animation rather than fly to a wrong spot.
function pdfedFlyDotToClientFolder(startX, startY, folderId) {
  if (typeof startX !== 'number' || typeof startY !== 'number') return;
  const candidates = [
    folderId ? document.querySelector(`.sarvarc-asset-folder-chip[data-folder-id="${folderId}"]`) : null,
    document.getElementById('pdfedTabAssetsBtn'),
    document.getElementById('pdfedRightToggleBtn')
  ];
  let target = null, tRect = null;
  for (const c of candidates) {
    const r = pdfedElVisibleRect(c);
    if (r) { target = c; tRect = r; break; }
  }
  if (!target) return;
  const endX = tRect.left + tRect.width / 2;
  const endY = tRect.top + tRect.height / 2;

  const dot = document.createElement('div');
  dot.className = 'pdfed-fly-dot';
  dot.style.left = startX + 'px';
  dot.style.top = startY + 'px';
  dot.style.setProperty('--dx', (endX - startX) + 'px');
  dot.style.setProperty('--dy', (endY - startY) + 'px');
  document.body.appendChild(dot);
  requestAnimationFrame(() => dot.classList.add('flying'));

  const land = () => {
    dot.remove();
    target.classList.add('pdfed-asset-target-pulse');
    setTimeout(() => target.classList.remove('pdfed-asset-target-pulse'), 550);
  };
  dot.addEventListener('animationend', land, { once: true });
  setTimeout(() => { if (dot.isConnected) land(); }, 900); // safety net if animationend never fires
}


function pdfedCtxScrollGuard(e) {
  const m = document.getElementById('pdfedCtxMenu');
  if (m && e.target && (e.target === m || m.contains(e.target))) return;
  pdfedCloseCtxMenu();
}

// Convert a mouse event's client coords into page-canvas pixel coords
// (same math used by the draw/annotate layer's own getPos()).
function pdfedCtxCanvasPos(e) {
  const ac = document.getElementById('pdfedAnnotCanvas');
  if (!ac || !ac.width) return { x: 0, y: 0 };
  const rect = ac.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (ac.width / rect.width),
    y: (e.clientY - rect.top) * (ac.height / rect.height)
  };
}

function pdfedDuplicatePlacedImage(idx, id) {
  const pg = pdfed.pages[idx];
  const list = (pg && pg.placedImages) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  const clone = Object.assign({}, item, { id: 'pimg_' + (++pdfedAnnotState.placedImgSeq), x: item.x + 18, y: item.y + 18, locked: false, zIndex: pdfedNextZ(pg) });
  // A live clip must be its own copy: two items sharing one clip object would share one running canvas, and the copy would show up still.
  if (item.clip) clone.clip = JSON.parse(JSON.stringify(item.clip));
  pg.placedImages.push(clone);
  pdfedMarkModified(idx);
  pdfedRenderPlacedImages(idx);
  toast('Image duplicated', 'success');
}

function pdfedDuplicatePlacedText(idx, id) {
  const pg = pdfed.pages[idx];
  const list = (pg && pg.placedTexts) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  const clone = Object.assign({}, item, { id: 'ptxt_' + (++pdfedPlacedTextSeq), x: item.x + 18, y: item.y + 18, locked: false, zIndex: pdfedNextZ(pg) });
  pg.placedTexts.push(clone);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Text duplicated', 'success');
}

// Returns the next ascending z-order number for a page, so newly placed
// objects (image/text/table alike) always land on top of everything already
// on the page, regardless of which of the three arrays they live in.
function pdfedNextZ(pg) {
  pg._zSeq = (pg._zSeq || 0) + 1;
  return pg._zSeq;
}

// Builds ONE combined, z-sorted list spanning every stackable object type on
// a page, images, text boxes, AND tables together. This is what makes
// Arrange (front/back/forward/backward) compare an object against every
// overlapping object regardless of type, instead of only same-type siblings.
// Previously each type kept its own separate order and was rendered into its
// own fixed DOM layer (images layer, then text layer, then tables layer,
// always in that fixed layer order) — so an image could never actually get
// drawn above a text box no matter how many times you hit "Bring to Front".
// Any item missing a zIndex (older documents saved before this system
// existed) gets one assigned now, preserving the original images-under-text-
// under-tables look those documents already had.
function pdfedGetZOrderedItems(pg) {
  const combined = [];
  (pg.placedBorders || []).forEach(it => combined.push({ kind: 'border', item: it }));
  (pg.placedShapes  || []).forEach(it => combined.push({ kind: 'shape',  item: it }));
  (pg.placedImages || []).forEach(it => combined.push({ kind: 'image', item: it }));
  (pg.placedTexts  || []).forEach(it => combined.push({ kind: 'text',  item: it }));
  (pg.placedTables || []).forEach(it => combined.push({ kind: 'table', item: it }));
  if (combined.some(c => typeof c.item.zIndex !== 'number')) {
    combined.forEach(c => { if (typeof c.item.zIndex !== 'number') c.item.zIndex = pdfedNextZ(pg); });
  }
  combined.sort((a, b) => a.item.zIndex - b.item.zIndex);
  return combined;
}

// Re-renders every placed-object layer so a zIndex change made anywhere
// (image, text, or table) is reflected on screen immediately.
function pdfedRenderAllPlaced(idx) {
  pdfedRenderPlacedBorders(idx);
  pdfedRenderPlacedShapes(idx);
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx); // also re-renders tables, see bottom of that fn
}

function pdfedPlacedKeyForKind(kind) {
  return kind === 'image' ? 'placedImages' : (kind === 'table' ? 'placedTables' : (kind === 'border' ? 'placedBorders' : (kind === 'shape' ? 'placedShapes' : 'placedTexts')));
}

function pdfedReorderPlaced(kind, idx, id, toFront) {
  const pg = pdfed.pages[idx];
  const key = pdfedPlacedKeyForKind(kind);
  const list = pg && pg[key];
  if (!list) return;
  const item = list.find(it => it.id === id);
  if (!item) return;
  const ordered = pdfedGetZOrderedItems(pg);
  if (toFront) {
    const maxZ = ordered.length ? ordered[ordered.length - 1].item.zIndex : 0;
    item.zIndex = maxZ + 1;
  } else {
    const minZ = ordered.length ? ordered[0].item.zIndex : 0;
    item.zIndex = minZ - 1;
  }
  pdfedMarkModified(idx);
  pdfedRenderAllPlaced(idx);
  toast(toFront ? 'Brought to front' : 'Sent to back', 'info');
}

// Moves an item one step forward (dir=1, toward front) or backward (dir=-1,
// toward back) in the page's UNIFIED stacking order, so stepping forward
// past a same-type sibling can also step it past a different-type object
// (e.g. an image moving one step forward and landing above a text box that
// happened to be next in line). Single-step counterpart to
// pdfedReorderPlaced's jump-to-front/back.
function pdfedReorderPlacedStep(kind, idx, id, dir) {
  const pg = pdfed.pages[idx];
  if (!pg) return;
  const ordered = pdfedGetZOrderedItems(pg);
  const i = ordered.findIndex(c => c.kind === kind && c.item.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= ordered.length) { toast(dir > 0 ? 'Already at front' : 'Already at back', 'info'); return; }
  // Swap zIndex values with whatever currently occupies that position —
  // could be an image, a text box, or a table; the swap is type-agnostic.
  const a = ordered[i].item, b = ordered[j].item;
  const tmp = a.zIndex; a.zIndex = b.zIndex; b.zIndex = tmp;
  pdfedMarkModified(idx);
  pdfedRenderAllPlaced(idx);
  toast(dir > 0 ? 'Moved forward' : 'Moved backward', 'info');
}

// Small "Arrange" popover, To Front / To Back, shared by the badge button
// on placed images and placed text boxes. Forward/Backward (single-step) now
// have their own dedicated one-click badges right next to this one, so this
// menu only needs the jump-to-front/back actions.
function pdfedOpenArrangeMenu(ev, kind, idx, id) {
  ev.stopPropagation();
  pdfedOpenCtxMenu(ev.clientX, ev.clientY, [
    { type: 'label', label: 'Arrange' },
    { id: 'front', icon: 'front', label: 'Bring to Front', onClick: () => pdfedReorderPlaced(kind, idx, id, true) },
    { id: 'back',  icon: 'back',  label: 'Send to Back',   onClick: () => pdfedReorderPlaced(kind, idx, id, false) }
  ]);
}

// ── Shared opacity popover, one small floating slider, reused by every
// non-text placed object (images, tables) in the Workspace editor, AND by
// extracted-image cards in the gallery. Placed text uses its own inline
// slider in the floating formatting toolbar instead, since it's already open.
const pdfedOpacityPop = { kind: null, idx: -1, id: null };

function pdfedOpacityKey(kind) {
  return pdfedPlacedKeyForKind(kind);
}

// Single lookup used by every opacity-popover consumer, so gallery images
// (plain array, indexed by position) and Workspace objects (per-page arrays,
// indexed by stable id) can share one popover/one code path.
function pdfedOpacityGetItem(kind, idx, id) {
  if (kind === 'galleryImage') return state.extractedImages[idx];
  const list = (pdfed.pages[idx] && pdfed.pages[idx][pdfedOpacityKey(kind)]) || [];
  return list.find(i => i.id === id);
}

function pdfedOpenOpacityPopover(ev, kind, idx, id) {
  ev.stopPropagation();
  const pop = document.getElementById('pdfedOpacityPopover');
  if (!pop) return;
  const item = pdfedOpacityGetItem(kind, idx, id);
  if (!item) return;
  pdfedOpacityPop.kind = kind; pdfedOpacityPop.idx = idx; pdfedOpacityPop.id = id;
  const pct = Math.round(pdfedGetOpacity(item) * 100);
  document.getElementById('pdfedOpacityPopoverSlider').value = pct;
  document.getElementById('pdfedOpacityPopoverVal').textContent = pct + '%';
  pop.classList.add('show');
  // Fixed positioning means these are plain viewport coordinates, no
  // offsetParent math needed, so this works identically whether the trigger
  // badge is in the Workspace canvas or a gallery card.
  let left = ev.clientX - 30;
  let top = ev.clientY + 14;
  const popW = 190, popH = 40;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (left < 8) left = 8;
  if (top + popH > window.innerHeight - 8) top = ev.clientY - popH - 14;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function pdfedCloseOpacityPopover() {
  const pop = document.getElementById('pdfedOpacityPopover');
  if (pop) pop.classList.remove('show');
  pdfedOpacityPop.kind = null; pdfedOpacityPop.idx = -1; pdfedOpacityPop.id = null;
}

function pdfedOpacityPopoverInput(value) {
  const { kind, idx, id } = pdfedOpacityPop;
  if (!kind) return;
  const item = pdfedOpacityGetItem(kind, idx, id);
  if (!item) return;
  const v = Math.max(0.1, Math.min(1, parseInt(value, 10) / 100));
  item.opacity = v;
  document.getElementById('pdfedOpacityPopoverVal').textContent = Math.round(v * 100) + '%';
  // Live-update the on-screen element directly (no full re-render), so the
  // slider drag feels instant instead of rebuilding the whole overlay layer.
  if (kind === 'galleryImage') {
    const card = document.querySelector(`.img-card[data-idx="${idx}"]`);
    if (card) { const im = card.querySelector('img'); if (im) im.style.opacity = v; }
  } else {
    const selector = kind === 'image' ? '.pdfed-placed-img' : (kind === 'border' ? '.pdfed-placed-border' : (kind === 'shape' ? '.pdfed-placed-shape' : '.pdfed-placed-table'));
    const el = document.querySelector(`${selector}[data-id="${CSS.escape(id)}"]`);
    if (el) {
      if (kind === 'image') { const im = el.querySelector('img'); if (im) im.style.opacity = v; }
      else if (kind === 'border') { const cv = el.querySelector('canvas'); if (cv) cv.style.opacity = v; }
      else if (kind === 'shape') { const cv = el.querySelector('canvas'); if (cv) cv.style.opacity = v; }
      else if (kind === 'table') { const g = el.querySelector('.pdfed-table-grid'); if (g) g.style.opacity = v; }
    }
    pdfedMarkModified(idx);
  }
}

// Click anywhere outside the popover (or its trigger badge) closes it.
document.addEventListener('mousedown', (e) => {
  const pop = document.getElementById('pdfedOpacityPopover');
  if (!pop || !pop.classList.contains('show')) return;
  if (e.target.closest('#pdfedOpacityPopover') || e.target.closest('.pdfed-opacity-btn')) return;
  pdfedCloseOpacityPopover();
});

async function pdfedDuplicatePage(idx) {
  if (idx < 0 || !pdfed.pages[idx]) return;
  const src = pdfed.pages[idx];
  // Shallow-copy the page (keeps shared, non-serializable refs like srcDoc/pdfDoc intact)
  // but deep-clone the plain-data arrays/objects so edits on the copy don't mutate the original.
  const clone = Object.assign({}, src, {
    placedImages: JSON.parse(JSON.stringify(src.placedImages || [])),
    placedTexts: JSON.parse(JSON.stringify(src.placedTexts || [])),
    placedTables: JSON.parse(JSON.stringify(src.placedTables || [])),
    placedBorders: JSON.parse(JSON.stringify(src.placedBorders || [])),
    placedShapes: JSON.parse(JSON.stringify(src.placedShapes || [])),
    edits: JSON.parse(JSON.stringify(src.edits || {})),
    textBlocks: JSON.parse(JSON.stringify(src.textBlocks || [])),
    // Deep-copy (not share) annotation history so drawing/undo on the copy
    // never mutates the original page's stack, or vice versa.
    annotStrokes: (src.annotStrokes || []).slice(),
    annotRedoStrokes: (src.annotRedoStrokes || []).slice(),
    label: (src.label || 'Page') + ' Copy'
  });
  // Re-key every placed item on the copy with a fresh id. Without this, the
  // duplicate page's images/texts/tables/borders keep the exact same ids as
  // the source page's — harmless while they're each on their own page, but
  // a latent collision waiting to happen the moment content from both pages
  // is ever combined onto one page (lock/delete/reshape on one would then
  // silently also hit the other, since they'd resolve to the same id).
  ['placedImages', 'placedTexts', 'placedTables', 'placedBorders', 'placedShapes'].forEach(key => {
    (clone[key] || []).forEach(item => { item.id = (item.id || 'itm') + '_dup' + (++pdfedAnnotState.placedImgSeq); });
  });
  pdfed.pages.splice(idx + 1, 0, clone);
  await pdfedBuildStrip();
  await pdfedGoto(idx + 1);
  toast('Page duplicated', 'success');

  pushAppHistory({
    label: 'Duplicate page',
    undo: async () => {
      if (pdfed.pages.length <= 1) { toast('Cannot remove last page', 'error'); return; }
      pdfed.pages.splice(idx + 1, 1);
      if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
      await pdfedBuildStrip();
      await pdfedGoto(pdfed.active);
      toast('Duplicate removed', 'info');
    },
    redo: async () => {
      pdfed.pages.splice(idx + 1, 0, clone);
      await pdfedBuildStrip();
      await pdfedGoto(idx + 1);
      toast('Page duplicated', 'success');
    }
  });
}

// Placed Image's right-click menu (see the screenshot-familiar "Lock /
// Duplicate / Forward / Backward / Bring to Front / Send to Back / Delete
// Image" list) also gets a "Send to Client Folder" row here. Hovering it
// opens a flyout of the person's existing client folders (same list as the
// Assets panel's own folder chips — see CLIENT FOLDERS, above) so one image
// on the canvas can be filed straight into a client's folder without ever
// opening the Assets panel first. Building the folder list is async, so the
// menu opens once that's ready rather than blocking preventDefault above.
async function pdfedOpenPlacedImageCtxMenu(clientX, clientY, idx, id, item) {
  const folders = await sarvarcAssetFolderList();
  const folderItems = folders.length
    ? folders.map(f => ({
        id: 'sendfolder_' + f.id, icon: 'folder', label: f.name,
        onClick: () => pdfedSendPlacedImageToFolder(item, f.id, clientX, clientY)
      }))
    : [{ id: 'noFolders', label: 'No client folders yet', disabled: true }];
  folderItems.push({ type: 'sep' });
  folderItems.push({
    id: 'sendNewFolder', icon: 'plus', label: 'New client folder…',
    onClick: () => pdfedSendPlacedImageToNewFolder(item, clientX, clientY)
  });

  pdfedOpenCtxMenu(clientX, clientY, [
    { type: 'label', label: 'Placed Image' },
    { id: 'lock',   icon: item.locked ? 'unlock' : 'lock', label: item.locked ? 'Unlock' : 'Lock', onClick: () => pdfedTogglePlacedLock(idx, id) },
    { id: 'dup',    icon: 'duplicate', label: 'Duplicate', onClick: () => pdfedDuplicatePlacedImage(idx, id) },
    { id: 'assets', icon: 'folder', label: 'Send to Client Folder', children: folderItems },
    { type: 'sep' },
    { id: 'fwd',    icon: 'fwd',   label: 'Forward', onClick: () => pdfedReorderPlacedStep('image', idx, id, 1) },
    { id: 'bwd',    icon: 'bwd',   label: 'Backward', onClick: () => pdfedReorderPlacedStep('image', idx, id, -1) },
    { id: 'front',  icon: 'front', label: 'Bring to Front', onClick: () => pdfedReorderPlaced('image', idx, id, true) },
    { id: 'back',   icon: 'back',  label: 'Send to Back', onClick: () => pdfedReorderPlaced('image', idx, id, false) },
    { type: 'sep' },
    { id: 'del', icon: 'trash', label: 'Delete Image', danger: true, disabled: item.locked, onClick: () => pdfedDeletePlacedImage(idx, id) }
  ]);
}

// Saves the placed image into the Assets library (exactly like any other
// upload — see sarvarcAssetSave) filed directly into the chosen client
// folder, then plays the fly-dot so the click has visible, immediate
// feedback that it landed somewhere. The image stays on the canvas — this
// only ever adds a copy to the library, never removes it from the page.
//
// Respects the placed item's own `kind` (stamped on at insert time — see
// pdfedActivateImgGhost/pdfedBakeImage) so a logo placed via Refine Report
// files straight into the Logos tab, a signature into the Signatures tab,
// and everything else (plain photos, maps, charts, etc.) into Images —
// instead of every right-click "Send to Client Folder" landing in Images
// regardless of what was actually placed.
async function pdfedSendPlacedImageToFolder(item, folderId, clientX, clientY) {
  if (!item || !item.dataUrl) { if (typeof toast === 'function') toast('Nothing to send', 'error'); return; }
  const assetType = (item.kind === 'logo' || item.kind === 'signature') ? item.kind : 'image';
  const label = assetType.charAt(0).toUpperCase() + assetType.slice(1);
  const rec = await sarvarcAssetSave(assetType, item.dataUrl, 'Placed ' + label.toLowerCase() + ' — ' + new Date().toLocaleDateString());
  if (!rec) { if (typeof toast === 'function') toast('Could not save to Assets', 'error'); return; }
  await sarvarcAssetMoveToFolder(rec.id, folderId);
  pdfedRevealAssetsFolderThenFlyDot(folderId, clientX, clientY, assetType);
}

function pdfedSendPlacedImageToNewFolder(item, clientX, clientY) {
  sarvarcModalPrompt('New Client Folder', "Enter client's name", '').then(name => {
    if (!name) return;
    sarvarcAssetFolderCreate(name).then(folder => {
      if (folder) pdfedSendPlacedImageToFolder(item, folder.id, clientX, clientY);
    });
  });
}

function pdfedHandleCanvasContextMenu(e) {
  if (pdfed.active < 0 || !pdfed.pages[pdfed.active]) {
    // no PDF open, offer the one relevant action
    e.preventDefault();
    pdfedOpenCtxMenu(e.clientX, e.clientY, [
      { id: 'open', icon: 'open', label: 'Open a PDF, Word or Excel file…', onClick: () => document.getElementById('pdfedFileInput').click() }
    ]);
    return;
  }

  const imgEl = e.target.closest('.pdfed-placed-img');
  const txtEl = e.target.closest('.pdfed-placed-text');
  const brdEl = e.target.closest('.pdfed-placed-border');
  const shpEl = e.target.closest('.pdfed-placed-shape');
  const idx = pdfed.active;

  if (shpEl) {
    e.preventDefault();
    const id = shpEl.dataset.id;
    const item = (pdfed.pages[idx].placedShapes || []).find(i => i.id === id);
    if (!item) return;
    pdfedOpenCtxMenu(e.clientX, e.clientY, [
      { type: 'label', label: 'Placed Shape' },
      { id: 'lock',   icon: item.locked ? 'unlock' : 'lock', label: item.locked ? 'Unlock' : 'Lock', onClick: () => pdfedTogglePlacedShapeLock(idx, id) },
      { id: 'dup',    icon: 'duplicate', label: 'Duplicate', onClick: () => pdfedDuplicatePlacedShape(idx, id) },
      { type: 'sep' },
      { id: 'fwd',    icon: 'fwd',   label: 'Forward', onClick: () => pdfedReorderPlacedStep('shape', idx, id, 1) },
      { id: 'bwd',    icon: 'bwd',   label: 'Backward', onClick: () => pdfedReorderPlacedStep('shape', idx, id, -1) },
      { id: 'front',  icon: 'front', label: 'Bring to Front', onClick: () => pdfedReorderPlaced('shape', idx, id, true) },
      { id: 'back',   icon: 'back',  label: 'Send to Back', onClick: () => pdfedReorderPlaced('shape', idx, id, false) },
      { type: 'sep' },
      { id: 'del', icon: 'trash', label: 'Delete Shape', danger: true, disabled: item.locked, onClick: () => pdfedDeletePlacedShape(idx, id) }
    ]);
    return;
  }

  if (brdEl) {
    e.preventDefault();
    const id = brdEl.dataset.id;
    const item = (pdfed.pages[idx].placedBorders || []).find(i => i.id === id);
    if (!item) return;
    pdfedOpenCtxMenu(e.clientX, e.clientY, [
      { type: 'label', label: 'Placed Border' },
      { id: 'lock',   icon: item.locked ? 'unlock' : 'lock', label: item.locked ? 'Unlock' : 'Lock', onClick: () => pdfedTogglePlacedBorderLock(idx, id) },
      { id: 'dup',    icon: 'duplicate', label: 'Duplicate', onClick: () => pdfedDuplicatePlacedBorder(idx, id) },
      { type: 'sep' },
      { id: 'fwd',    icon: 'fwd',   label: 'Forward', onClick: () => pdfedReorderPlacedStep('border', idx, id, 1) },
      { id: 'bwd',    icon: 'bwd',   label: 'Backward', onClick: () => pdfedReorderPlacedStep('border', idx, id, -1) },
      { id: 'front',  icon: 'front', label: 'Bring to Front', onClick: () => pdfedReorderPlaced('border', idx, id, true) },
      { id: 'back',   icon: 'back',  label: 'Send to Back', onClick: () => pdfedReorderPlaced('border', idx, id, false) },
      { type: 'sep' },
      { id: 'del', icon: 'trash', label: 'Delete Border', danger: true, disabled: item.locked, onClick: () => pdfedDeletePlacedBorder(idx, id) }
    ]);
    return;
  }

  if (imgEl) {
    e.preventDefault();
    const id = imgEl.dataset.id;
    const item = (pdfed.pages[idx].placedImages || []).find(i => i.id === id);
    if (!item) return;
    pdfedOpenPlacedImageCtxMenu(e.clientX, e.clientY, idx, id, item);
    return;
  }

  if (txtEl) {
    e.preventDefault();
    const id = txtEl.dataset.id;
    const item = (pdfed.pages[idx].placedTexts || []).find(i => i.id === id);
    if (!item) return;
    pdfedOpenCtxMenu(e.clientX, e.clientY, [
      { type: 'label', label: 'Placed Text' },
      { id: 'edit',   icon: 'text', label: 'Edit Text', disabled: item.locked, onClick: () => {
          const content = txtEl.querySelector('.pdfed-ptxt-content');
          if (content) { content.focus(); pdfedSelectAllText(content); }
        } },
      { id: 'lock',   icon: item.locked ? 'unlock' : 'lock', label: item.locked ? 'Unlock' : 'Lock', onClick: () => pdfedTogglePlacedTextLock(idx, id) },
      { id: 'dup',    icon: 'duplicate', label: 'Duplicate', onClick: () => pdfedDuplicatePlacedText(idx, id) },
      { type: 'sep' },
      { id: 'fwd',    icon: 'fwd',   label: 'Forward', onClick: () => pdfedReorderPlacedStep('text', idx, id, 1) },
      { id: 'bwd',    icon: 'bwd',   label: 'Backward', onClick: () => pdfedReorderPlacedStep('text', idx, id, -1) },
      { id: 'front',  icon: 'front', label: 'Bring to Front', onClick: () => pdfedReorderPlaced('text', idx, id, true) },
      { id: 'back',   icon: 'back',  label: 'Send to Back', onClick: () => pdfedReorderPlaced('text', idx, id, false) },
      { type: 'sep' },
      { id: 'del', icon: 'trash', label: 'Delete Text', danger: true, disabled: item.locked, onClick: () => pdfedDeletePlacedText(idx, id) }
    ]);
    return;
  }

  // empty canvas / page, general quick actions
  e.preventDefault();
  const pos = pdfedCtxCanvasPos(e);
  const hasAnnots = !!(document.getElementById('pdfedAnnotCanvas') && pdfed.pages[idx].modified);

  pdfedOpenCtxMenu(e.clientX, e.clientY, [
    { id: 'undo', icon: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', onClick: () => unifiedUndo() },
    { id: 'redo', icon: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', onClick: () => unifiedRedo() },
    { type: 'sep' },
    { id: 'zin',  icon: 'zoomIn',  label: 'Zoom In', onClick: () => pdfedZoom(0.1) },
    { id: 'zout', icon: 'zoomOut', label: 'Zoom Out', onClick: () => pdfedZoom(-0.1) },
    { id: 'fit',  icon: 'fit',     label: 'Fit to Screen', onClick: () => pdfedZoomFit() },
    { type: 'sep' },
    { id: 'addtext', icon: 'text',      label: 'Add Text Here', onClick: () => pdfedPlaceTextLabel(pos.x, pos.y) },
    { id: 'addimg',  icon: 'image',     label: 'Insert Image…', onClick: () => pdfedTriggerImgInsert() },
    { id: 'sign',    icon: 'signature', label: 'Add Signature…', onClick: () => pdfedOpenSignatureModal() },
    { type: 'sep' },
    { id: 'hl',     icon: 'highlight', label: 'Highlight Text', onClick: () => pdfedToggleTextHighlight() },
    { id: 'draw',   icon: 'draw',      label: 'Draw', onClick: () => pdfedSetAnnotTool('draw') },
    { id: 'redact', icon: 'redact',    label: 'Redact', onClick: () => pdfedSetAnnotTool('redact') },
    { type: 'sep' },
    { id: 'rotL',  icon: 'rotateL', label: 'Rotate Left', onClick: () => pdfedRotatePage(-90) },
    { id: 'rotR',  icon: 'rotateR', label: 'Rotate Right', onClick: () => pdfedRotatePage(90) },
    { id: 'crop',  icon: 'crop',    label: 'Crop This Page', onClick: () => pdfedToggleCrop() },
    { type: 'sep' },
    { id: 'dupPage',    icon: 'duplicate', label: 'Duplicate Page', onClick: () => pdfedDuplicatePage(idx) },
    { id: 'insertAfter', icon: 'plus',     label: 'Insert Page After', onClick: () => pdfedOpenInsert(idx) },
    { id: 'delPage',    icon: 'trash', label: 'Delete Page', danger: true, onClick: () => pdfedDeletePage(idx) },
    { type: 'sep' },
    { id: 'clearAnnot', icon: 'clear',  label: 'Clear Annotations', onClick: () => pdfedClearAnnotations() },
    { id: 'revert',     icon: 'revert', label: 'Revert Page', disabled: !hasAnnots, onClick: () => pdfedRevertPage() },
    { type: 'sep' },
    { id: 'export', icon: 'exportIco', label: 'Export…', onClick: () => pdfedOpenExportModal() }
  ]);
}

document.addEventListener('DOMContentLoaded', () => {
  const scroll = document.getElementById('pdfedCanvasScroll');
  if (scroll) scroll.addEventListener('contextmenu', pdfedHandleCanvasContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pdfedCloseCtxMenu(); });
});

async function pdfedRevertPage() {
  if (pdfed.active < 0) return;
  const pg = pdfed.pages[pdfed.active];
  pg.dataUrl = null; pg.modified = false; pg.edits = {};
  pdfedResetFilters();
  await pdfedGoto(pdfed.active);
  await pdfedBuildStrip();
  toast('Page reverted', 'info');
}
