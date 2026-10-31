// ── SLIDE & CAROUSEL TEMPLATES → WORKSPACE EDITOR ───────────────────────────
// Templates live in the PDF Editor's LEFT PANEL, on top of the page thumbnails.
// 6 presentations (16:9, 1920x1080) and 2 carousels (4:5, 1080x1350).
//   - Normal state: a small "Templates" block (tabs + cover thumbnails) above the Pages list.
//   - Click a template: the left panel grows wider (layout class .slt-open) and turns into a viewer:
//     big preview of the current slide, all slides as thumbnails, "Use this template" / "Add only slide N".
//   - Back (or using the template) returns the panel to its normal width.
// The "Slide Templates" button in the app bar just opens the left panel and the Templates block.
//
// How a template lands on the canvas: every slide was converted ahead of time
// (tools/build-slide-templates.js) into
//   - a background picture with all the shapes, bands, circles and charts but NO words, and
//   - a list of real text boxes (position, font, size, colour, line height ...).
// "Use this template" copies those into new pages in pdfed.pages, exactly like
// Business Proposals and Kadessa do, so the result is an ordinary editable page:
// click any text to type, drag, resize, recolour, reorder or delete pages.
// The files in slide-templates/ are never changed; every insert builds fresh copies.
//
// Data comes from plain <script> files (not fetch) so it also works when the app
// is opened straight from disk:
//   slide-templates/index.js          -> window.SLT_INDEX (gallery cards)
//   slide-templates/<id>/slides.js    -> window.SLT_DATA[id] (loaded on first use)

const SLT_BASE = 'slide-templates/';
const SLT_PX_PER_MM = 3.7795;
const sltState = { tab: 'presentation', openId: null, slide: 0, busy: false, indexReady: null, railOpen: true };
const sltScriptPromises = {};

function sltLoadScript(src) {
  if (sltScriptPromises[src]) return sltScriptPromises[src];
  sltScriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { delete sltScriptPromises[src]; reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return sltScriptPromises[src];
}

async function sltEnsureIndex() {
  if (window.SLT_INDEX) return window.SLT_INDEX;
  await sltLoadScript(SLT_BASE + 'index.js');
  return window.SLT_INDEX;
}

async function sltEnsureData(id) {
  window.SLT_DATA = window.SLT_DATA || {};
  if (!window.SLT_DATA[id]) await sltLoadScript(SLT_BASE + id + '/slides.js');
  if (!window.SLT_DATA[id]) throw new Error('Template data missing for ' + id);
  return window.SLT_DATA[id];
}

function sltFindTemplate(id) {
  const idx = window.SLT_INDEX;
  return idx ? idx.templates.find(t => t.id === id) : null;
}

function sltEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Left-panel UI ───────────────────────────────────────────────────────────
function sltLayout() { return document.getElementById('pdfedLayout'); }
function sltIsPhone() { try { return window.matchMedia('(max-width: 768px)').matches; } catch (e) { return false; } }

// Make sure the left (pages) panel is visible; it can be collapsed by the person.
function sltEnsureLeftOpen() {
  const layout = sltLayout();
  if (layout && layout.classList.contains('left-collapsed') && typeof pdfedToggleLeftPanel === 'function') {
    pdfedToggleLeftPanel();
  }
}

// The canvas is narrower/wider after the panel resizes (0.32s grid transition), so re-fit the page once it settles.
function sltRefitCanvas() {
  setTimeout(() => {
    try { if (typeof pdfed !== 'undefined' && pdfed.active >= 0 && typeof pdfedZoomFit === 'function') pdfedZoomFit(); } catch (e) {}
  }, 380);
}

function sltSetWide(on) {
  const layout = sltLayout();
  if (!layout) return;
  const was = layout.classList.contains('slt-open');
  layout.classList.toggle('slt-open', !!on);
  if (was !== !!on) sltRefitCanvas();
}

function sltLoadRailPref() {
  try { if (localStorage.getItem('sltRailClosed') === '1') sltState.railOpen = false; } catch (e) {}
}
function sltSaveRailPref() {
  try { localStorage.setItem('sltRailClosed', sltState.railOpen ? '0' : '1'); } catch (e) {}
}

// App bar button: bring the Templates block into view.
async function sltOpen() {
  sltEnsureLeftOpen();
  sltState.openId = null;
  sltSetWide(false);
  sltState.railOpen = true;
  sltSaveRailPref();
  sltRender();
  const rail = document.getElementById('sltRail');
  if (rail) {
    rail.classList.remove('slt-flash'); void rail.offsetWidth; rail.classList.add('slt-flash');
    setTimeout(() => rail.classList.remove('slt-flash'), 1400);
  }
  try { await sltEnsureIndex(); sltState.indexReady = true; } catch (e) { sltState.indexReady = false; }
  sltRender();
}

function sltToggleRail() {
  sltState.railOpen = !sltState.railOpen;
  sltSaveRailPref();
  sltRender();
}

function sltSetTab(tab) {
  sltState.tab = tab;
  sltRender();
}

function sltShowTemplate(id) {
  sltState.openId = id;
  sltState.slide = 0;
  sltEnsureLeftOpen();
  sltSetWide(true);
  sltRender();
}

function sltBack() {
  sltState.openId = null;
  sltSetWide(false);
  sltRender();
}

// Changing slide only touches the stage + thumbnails (no full re-render), so the thumbnail list keeps its scroll.
function sltPickSlide(i) {
  const t = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  if (!t) return;
  const n = t.slideList.length;
  sltState.slide = Math.max(0, Math.min(n - 1, i));
  const cur = t.slideList[sltState.slide];
  const img = document.getElementById('sltStageImg');
  if (img) { img.src = SLT_BASE + cur.preview; img.alt = t.name + ' slide ' + (sltState.slide + 1); }
  const cnt = document.getElementById('sltStageCount');
  if (cnt) cnt.textContent = (sltState.slide + 1) + ' / ' + n;
  document.querySelectorAll('#sltRail .slt-thumb').forEach((el, k) => el.classList.toggle('on', k === sltState.slide));
  const sec = document.getElementById('sltAddOne');
  if (sec) sec.textContent = 'Add only slide ' + (sltState.slide + 1);
  const on = document.querySelector('#sltRail .slt-thumb.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function sltStep(d) { sltPickSlide(sltState.slide + d); }

function sltRender() {
  const rail = document.getElementById('sltRail');
  const body = document.getElementById('sltRailBody');
  if (!rail || !body) return;
  const idx = window.SLT_INDEX;
  const open = sltState.openId ? sltFindTemplate(sltState.openId) : null;

  rail.classList.toggle('closed', !sltState.railOpen && !open);
  rail.classList.toggle('detail', !!open);
  const tgl = document.getElementById('sltRailToggle');
  if (tgl) tgl.setAttribute('aria-expanded', String(sltState.railOpen));
  const cnt = document.getElementById('sltRailCount');
  if (cnt) cnt.textContent = idx ? String(idx.templates.length) : '';

  if (!idx) {
    body.innerHTML = sltState.indexReady === false
      ? '<p class="slt-empty">Templates could not be loaded. Make sure the <b>slide-templates</b> folder sits next to workspace.html.</p>'
      : '<p class="slt-empty">Loading templates…</p>';
    return;
  }

  // ── Detail (panel is wide) ──
  if (open) {
    const portrait = open.type === 'carousel';
    const cur = open.slideList[sltState.slide] || open.slideList[0];
    const n = open.slideList.length;
    body.innerHTML =
      '<div class="slt-d' + (portrait ? ' portrait' : '') + '">' +
        '<div class="slt-d-top">' +
          '<button type="button" class="slt-back" onclick="sltBack()" title="Back to all templates">← Templates</button>' +
          '<span class="slt-d-size">' + open.width + ' × ' + open.height + '</span>' +
        '</div>' +
        '<div class="slt-d-scroll">' +
          '<div class="slt-stage">' +
            '<img id="sltStageImg" src="' + SLT_BASE + sltEsc(cur.preview) + '" alt="' + sltEsc(open.name + ' slide ' + (sltState.slide + 1)) + '">' +
            '<button type="button" class="slt-nav prev" onclick="sltStep(-1)" aria-label="Previous slide">‹</button>' +
            '<button type="button" class="slt-nav next" onclick="sltStep(1)" aria-label="Next slide">›</button>' +
            '<span class="slt-stage-count" id="sltStageCount">' + (sltState.slide + 1) + ' / ' + n + '</span>' +
          '</div>' +
          '<div class="slt-d-name">' + sltEsc(open.name) + '</div>' +
          '<div class="slt-d-cat">' + sltEsc(open.category) + ' · ' + n + ' slides · ' + (portrait ? '4:5 portrait' : '16:9') + '</div>' +
          '<p class="slt-d-style">' + sltEsc(open.style) + '</p>' +
          '<div class="slt-d-grid">' + open.slideList.map((s, i) =>
            '<button type="button" class="slt-thumb' + (i === sltState.slide ? ' on' : '') + '" style="aspect-ratio:' + open.width + '/' + open.height + '" onclick="sltPickSlide(' + i + ')" title="Slide ' + (i + 1) + '"><img loading="lazy" src="' + SLT_BASE + sltEsc(s.preview) + '" alt=""><b>' + (i + 1) + '</b></button>').join('') + '</div>' +
          '<p class="slt-note">Every word is a real text box. Anything in [square brackets] is a placeholder to replace. Slides are copied onto your canvas after the current page; the original template is never changed.</p>' +
        '</div>' +
        '<div class="slt-d-actions">' +
          '<button type="button" class="slt-primary" onclick="sltUse(\'' + sltEsc(open.id) + '\')"' + (sltState.busy ? ' disabled' : '') + '>' + (sltState.busy ? 'Adding…' : 'Use this template (' + n + ' slides)') + '</button>' +
          '<button type="button" class="slt-secondary" id="sltAddOne" onclick="sltUse(\'' + sltEsc(open.id) + '\', sltState.slide)"' + (sltState.busy ? ' disabled' : '') + '>Add only slide ' + (sltState.slide + 1) + '</button>' +
        '</div>' +
      '</div>';
    return;
  }

  // ── Compact list (normal panel width) ──
  const list = idx.templates;
  const nPres = list.filter(t => t.type === 'presentation').length;
  const nCar = list.filter(t => t.type === 'carousel').length;
  const shown = list.filter(t => t.type === sltState.tab);
  body.innerHTML =
    '<div class="slt-tabs">' +
      '<button type="button" class="slt-tab' + (sltState.tab === 'presentation' ? ' on' : '') + '" onclick="sltSetTab(\'presentation\')">Slides <span>' + nPres + '</span></button>' +
      '<button type="button" class="slt-tab' + (sltState.tab === 'carousel' ? ' on' : '') + '" onclick="sltSetTab(\'carousel\')">Carousels <span>' + nCar + '</span></button>' +
    '</div>' +
    '<div class="slt-list' + (sltState.tab === 'carousel' ? ' portrait' : '') + '">' + shown.map(t =>
      '<div class="slt-card" tabindex="0" role="button" title="' + sltEsc(t.name + ' · ' + t.style) + '" onclick="sltShowTemplate(\'' + sltEsc(t.id) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();sltShowTemplate(\'' + sltEsc(t.id) + '\')}">' +
        '<div class="slt-cover" style="aspect-ratio:' + t.width + '/' + t.height + '"><img loading="lazy" src="' + SLT_BASE + sltEsc(t.cover) + '" alt="' + sltEsc(t.name) + ' cover"></div>' +
        '<h4>' + sltEsc(t.name) + '</h4>' +
        '<div class="slt-meta">' + t.slides + ' slides</div>' +
      '</div>').join('') + '</div>';
}

async function sltInit() {
  sltLoadRailPref();
  sltRender();
  try { await sltEnsureIndex(); sltState.indexReady = true; } catch (e) { sltState.indexReady = false; }
  sltRender();
}

// ── Fonts ───────────────────────────────────────────────────────────────────
const sltFontLinks = new Set();
async function sltEnsureFonts(t, data) {
  (t.fontHrefs || []).forEach(href => {
    if (sltFontLinks.has(href)) return;
    sltFontLinks.add(href);
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  });
  if (!document.fonts || !document.fonts.load) return;
  const fams = new Set();
  data.slides.forEach(s => s.texts.forEach(x => fams.add(x.fontFamily)));
  const jobs = [];
  fams.forEach(f => {
    [400, 700].forEach(w => jobs.push(document.fonts.load(w + ' 24px "' + f + '"').catch(() => {})));
  });
  // never hold the person up for long if the font service is slow or offline
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 3500))]);
}

// ── Pictures ────────────────────────────────────────────────────────────────
// Pages keep their background as a data URL (that is what sessions, export and thumbnails expect).
// If the browser blocks reading the picture (page opened from disk), the plain path still works for viewing.
function sltBgDataUrl(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL(/\.jpe?g$/i.test(src) ? 'image/jpeg' : 'image/png', 0.95));
      } catch (e) { resolve(src); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Insert ──────────────────────────────────────────────────────────────────
function sltBuildPage(t, data, slide, bgUrl) {
  const mmW = data.width / SLT_PX_PER_MM, mmH = data.height / SLT_PX_PER_MM;
  const pg = {
    type: 'blank', dataUrl: bgUrl, modified: true, edits: {}, textBlocks: [],
    placedTexts: [], placedImages: [], placedTables: [],
    label: t.name + ' · ' + slide.id, bgColor: slide.bgColor || '#ffffff', pageMM: [mmW, mmH]
  };
  slide.texts.forEach(x => {
    const item = {
      id: 'ptxt_' + (++pdfedPlacedTextSeq),
      text: x.text, x: x.x, y: x.y, w: x.w, fontSize: x.fontSize,
      fontFamily: x.fontFamily, color: x.color, bold: !!x.bold, italic: !!x.italic, underline: !!x.underline,
      align: x.align || 'left', lineHeight: x.lineHeight || 1.25,
      locked: false, zIndex: pdfedNextZ(pg)
    };
    if (x.html) item.html = x.html;
    if (x.letterSpacing) item.letterSpacing = x.letterSpacing;
    if (x.opacity != null && x.opacity < 1) item.opacity = x.opacity;
    if (x.rotation) item.rotation = x.rotation;
    pg.placedTexts.push(item);
  });
  return pg;
}

async function sltUse(id, onlyIdx) {
  if (sltState.busy) return;
  const t = sltFindTemplate(id);
  if (!t) return;
  sltState.busy = true;
  sltRender();
  try {
    const data = await sltEnsureData(id);
    await sltEnsureFonts(t, data);
    const picks = (onlyIdx == null) ? data.slides : [data.slides[onlyIdx]].filter(Boolean);
    const newPages = [];
    for (const slide of picks) {
      const bg = await sltBgDataUrl(SLT_BASE + id + '/' + slide.bg);
      if (!bg) throw new Error('Could not load the picture for slide "' + slide.id + '"');
      newPages.push(sltBuildPage(t, data, slide, bg));
    }
    if (!newPages.length) throw new Error('Nothing to add');

    const isNewDoc = !pdfed.pages.length;
    const at = isNewDoc ? 0 : (pdfed.active >= 0 ? pdfed.active : pdfed.pages.length - 1) + 1;
    // Panel goes back to its normal width before the new pages appear in the Pages list below.
    sltState.openId = null;
    sltSetWide(false);
    pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(newPages));

    if (isNewDoc) {
      pdfed.pdfDoc = null;
      pdfed.file = { name: t.name };
      ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(i => {
        const el = document.getElementById(i);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
      const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
      const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
      state.stats.pdfs++;
    }
    const totalEl = document.getElementById('prrTotalPages');
    if (totalEl) totalEl.textContent = pdfed.pages.length;
    state.stats.pages += newPages.length;
    updateStats();

    navigate('pdfeditor');
    await pdfedBuildStrip();
    await pdfedGoto(at);
    setTimeout(pdfedZoomFit, 60);
    // On a phone the panel is a drawer on top of the canvas: close it so the new slide is visible.
    if (sltIsPhone()) {
      const lay = sltLayout();
      if (lay && !lay.classList.contains('left-collapsed') && typeof pdfedToggleLeftPanel === 'function') pdfedToggleLeftPanel();
    }

    pushAppHistory({
      label: 'Add template (' + t.name + ')',
      undo: async () => {
        if (pdfed.pages.length <= newPages.length) { toast('Cannot remove last page', 'error'); return; }
        pdfed.pages.splice(at, newPages.length);
        if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
        await pdfedBuildStrip();
        await pdfedGoto(pdfed.active);
        document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
        toast('Template pages removed', 'info');
      },
      redo: async () => {
        pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(newPages));
        await pdfedBuildStrip();
        await pdfedGoto(at);
        document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
        toast('Template pages added', 'success');
      }
    });

    toast(t.name + ': ' + newPages.length + (newPages.length === 1 ? ' slide' : ' slides') + ' added. Click any text to edit it.', 'success');
    if (typeof swTrack === 'function') { try { swTrack('module_open', { module: 'slide_templates', template: id }); } catch (e) {} }
  } catch (err) {
    if (typeof toast === 'function') toast('Could not add the template: ' + (err && err.message ? err.message : err), 'error');
  } finally {
    sltState.busy = false;
    sltRender();
  }
}

// Escape steps back from the template viewer to the list (only when the viewer is open and nothing is being typed).
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || !sltState.openId) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  sltBack();
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sltInit);
else sltInit();
