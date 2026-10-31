// ── SLIDE & CAROUSEL TEMPLATES → WORKSPACE EDITOR ───────────────────────────
// Templates live in the PDF Editor's LEFT PANEL behind a Pages | Templates toggle.
// 6 presentations (16:9, 1920x1080) and 2 carousels (4:5, 1080x1350).
//   - Pages (default): the normal 200px page-thumbnail panel.
//   - Templates: the panel widens (layout class .slt-open) and shows every template as a card whose
//     slides play automatically (soft cross-fade). Click a card for the big viewer: auto-playing
//     preview with progress bar, play/pause, all slides as thumbnails, "Use this template" / "Add only slide N".
//   - Pages toggle (or Esc from the list, or using a template) returns the panel to its normal width.
// The "Slide Templates" button in the app bar just opens the left panel in Templates mode.
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
const sltState = { mode: 'pages', tab: 'presentation', openId: null, slide: 0, busy: false, indexReady: null, autoplay: true };
const sltCardTimers = [];
let sltStageTimer = null;
function sltReducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
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

function sltLoadPrefs() {
  try { if (localStorage.getItem('sltAutoplay') === '0') sltState.autoplay = false; } catch (e) {}
  if (sltReducedMotion()) sltState.autoplay = false;
  try { const t = localStorage.getItem('sltTab'); if (t === 'presentation' || t === 'carousel') sltState.tab = t; } catch (e) {}
}
function sltSavePref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

// ── Auto-play ───────────────────────────────────────────────────────────────
function sltStopCards() { while (sltCardTimers.length) clearInterval(sltCardTimers.pop()); }
function sltStopStage() { if (sltStageTimer) { clearTimeout(sltStageTimer); sltStageTimer = null; } }
function sltStopAll() { sltStopCards(); sltStopStage(); }

// Gallery: every card cycles through its own slides. Starts are staggered so the cards never flip in unison.
function sltStartCards() {
  sltStopCards();
  if (sltState.mode !== 'templates' || sltState.openId || sltReducedMotion() || document.hidden) return;
  document.querySelectorAll('#sltRail .slt-card').forEach((card, ci) => {
    const frames = card.querySelectorAll('.slt-frame');
    if (frames.length < 2) return;
    let i = 0, paused = false;
    card.addEventListener('mouseenter', () => { paused = true; });
    card.addEventListener('mouseleave', () => { paused = false; });
    card.addEventListener('focusin', () => { paused = true; });
    card.addEventListener('focusout', () => { paused = false; });
    const dots = card.querySelectorAll('.slt-dots i');
    const step = () => {
      if (paused) return;
      frames[i].classList.remove('on'); if (dots[i]) dots[i].classList.remove('on');
      i = (i + 1) % frames.length;
      frames[i].classList.add('on'); if (dots[i]) dots[i].classList.add('on');
    };
    const t0 = setTimeout(() => { sltCardTimers.push(setInterval(step, 2600)); }, 700 + ci * 450);
    // timeout handle is cleared the same way (clearInterval accepts timeout ids)
    sltCardTimers.push(t0);
  });
}

// Viewer: advance one slide at a time; the progress bar is a CSS animation restarted on every change.
function sltStageSchedule() {
  sltStopStage();
  const stage = document.getElementById('sltStage');
  if (!stage) return;
  const playing = sltState.autoplay && !sltReducedMotion() && !document.hidden && !sltState.stageHover;
  stage.classList.toggle('playing', playing);
  const bar = document.getElementById('sltProg');
  if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
  const btn = document.getElementById('sltPlayBtn');
  if (btn) { btn.classList.toggle('is-on', sltState.autoplay); btn.setAttribute('aria-pressed', String(sltState.autoplay)); btn.title = sltState.autoplay ? 'Pause auto-play' : 'Play slides automatically'; }
  if (!playing) return;
  const t = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  if (!t) return;
  sltStageTimer = setTimeout(() => {
    const n = t.slideList.length;
    sltPickSlide((sltState.slide + 1) % n, true);
  }, 3200);
}
function sltToggleAutoplay() {
  sltState.autoplay = !sltState.autoplay;
  sltSavePref('sltAutoplay', sltState.autoplay ? '1' : '0');
  sltStageSchedule();
}
function sltStageHover(on) { sltState.stageHover = !!on; sltStageSchedule(); }

document.addEventListener('visibilitychange', function () {
  if (document.hidden) { sltStopAll(); return; }
  if (sltState.openId) sltStageSchedule(); else sltStartCards();
});

// ── Mode (Pages | Templates) ────────────────────────────────────────────────
function sltSetMode(mode, opts) {
  opts = opts || {};
  const next = mode === 'templates' ? 'templates' : 'pages';
  sltState.mode = next;
  if (next === 'pages') sltState.openId = null;
  if (next === 'templates') sltEnsureLeftOpen();
  sltSetWide(next === 'templates');
  sltRender();
  if (next === 'templates' && !window.SLT_INDEX) {
    sltEnsureIndex().then(() => { sltState.indexReady = true; sltRender(); }).catch(() => { sltState.indexReady = false; sltRender(); });
  }
  if (opts.flash) {
    const rail = document.getElementById('sltRail');
    if (rail) { rail.classList.remove('slt-flash'); void rail.offsetWidth; rail.classList.add('slt-flash'); setTimeout(() => rail.classList.remove('slt-flash'), 1400); }
  }
}

// App bar button: open the left panel in Templates mode.
function sltOpen() { sltEnsureLeftOpen(); sltSetMode('templates', { flash: true }); }

function sltSetTab(tab) {
  sltState.tab = tab;
  sltSavePref('sltTab', tab);
  sltRender();
}

function sltShowTemplate(id) {
  sltState.openId = id;
  sltState.slide = 0;
  sltState.stageHover = false;
  sltEnsureLeftOpen();
  sltState.mode = 'templates';
  sltSetWide(true);
  sltRender();
}

function sltBack() {
  sltState.openId = null;
  sltRender();
}

// Changing slide only touches the stage + thumbnails (no full re-render), so the thumbnail list keeps its scroll.
function sltPickSlide(i, fromTimer) {
  const t = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  if (!t) return;
  const n = t.slideList.length;
  sltState.slide = Math.max(0, Math.min(n - 1, i));
  document.querySelectorAll('#sltStage .slt-frame').forEach((el, k) => el.classList.toggle('on', k === sltState.slide));
  const cnt = document.getElementById('sltStageCount');
  if (cnt) cnt.textContent = (sltState.slide + 1) + ' / ' + n;
  const lab = document.getElementById('sltStageLabel');
  if (lab) lab.textContent = t.slideList[sltState.slide].id;
  document.querySelectorAll('#sltRail .slt-thumb').forEach((el, k) => el.classList.toggle('on', k === sltState.slide));
  const sec = document.getElementById('sltAddOne');
  if (sec) sec.textContent = 'Add only slide ' + (sltState.slide + 1);
  const on = document.querySelector('#sltRail .slt-thumb.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  sltStageSchedule();
}

function sltStep(d) {
  const t = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  if (!t) return;
  const n = t.slideList.length;
  sltPickSlide((sltState.slide + d + n) % n);
}

function sltRender() {
  const rail = document.getElementById('sltRail');
  const body = document.getElementById('sltRailBody');
  if (!rail || !body) return;
  const idx = window.SLT_INDEX;
  const open = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  const tplMode = sltState.mode === 'templates';

  sltStopAll();
  rail.classList.toggle('on', tplMode);
  rail.classList.toggle('detail', !!open);
  const seg = document.getElementById('sltSeg');
  if (seg) seg.setAttribute('data-mode', tplMode ? 'templates' : 'pages');
  const bp = document.getElementById('sltSegPages'), bt = document.getElementById('sltSegTemplates');
  if (bp) { bp.classList.toggle('on', !tplMode); bp.setAttribute('aria-selected', String(!tplMode)); }
  if (bt) { bt.classList.toggle('on', tplMode); bt.setAttribute('aria-selected', String(tplMode)); }
  const cnt = document.getElementById('sltRailCount');
  if (cnt) cnt.textContent = idx ? String(idx.templates.length) : '';

  if (!tplMode) { body.innerHTML = ''; return; }

  if (!idx) {
    body.innerHTML = sltState.indexReady === false
      ? '<p class="slt-empty">Templates could not be loaded. Make sure the <b>slide-templates</b> folder sits next to workspace.html.</p>'
      : '<p class="slt-empty">Loading templates…</p>';
    return;
  }

  // ── Viewer ──
  if (open) {
    const portrait = open.type === 'carousel';
    const n = open.slideList.length;
    const cur = open.slideList[sltState.slide] || open.slideList[0];
    body.innerHTML =
      '<div class="slt-d' + (portrait ? ' portrait' : '') + '">' +
        '<div class="slt-d-top">' +
          '<button type="button" class="slt-back" onclick="sltBack()" title="Back to all templates (Esc)">← All templates</button>' +
          '<span class="slt-d-size">' + open.width + ' × ' + open.height + '</span>' +
        '</div>' +
        '<div class="slt-d-scroll">' +
          '<div class="slt-stage" id="sltStage" style="--r:' + (open.width / open.height) + '" onmouseenter="sltStageHover(true)" onmouseleave="sltStageHover(false)">' +
            open.slideList.map((s, i) =>
              '<img class="slt-frame' + (i === sltState.slide ? ' on' : '') + '" ' + (i < 2 ? '' : 'loading="lazy" ') + 'src="' + SLT_BASE + sltEsc(s.preview) + '" alt="' + sltEsc(open.name + ' slide ' + (i + 1)) + '">').join('') +
            '<button type="button" class="slt-nav prev" onclick="sltStep(-1)" aria-label="Previous slide">‹</button>' +
            '<button type="button" class="slt-nav next" onclick="sltStep(1)" aria-label="Next slide">›</button>' +
            '<span class="slt-stage-label" id="sltStageLabel">' + sltEsc(cur.id) + '</span>' +
            '<span class="slt-stage-count" id="sltStageCount">' + (sltState.slide + 1) + ' / ' + n + '</span>' +
            '<button type="button" class="slt-play" id="sltPlayBtn" onclick="sltToggleAutoplay()" aria-pressed="true" title="Pause auto-play">' +
              '<svg class="i-pause" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' +
              '<svg class="i-play" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>' +
            '</button>' +
            '<div class="slt-prog"><i id="sltProg"></i></div>' +
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
    sltStageSchedule();
    return;
  }

  // ── Gallery (wide panel, cards auto-play) ──
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
        '<div class="slt-cover" style="aspect-ratio:' + t.width + '/' + t.height + '">' +
          t.slideList.map((s, i) => '<img class="slt-frame' + (i === 0 ? ' on' : '') + '" ' + (i === 0 ? '' : 'loading="lazy" ') + 'src="' + SLT_BASE + sltEsc(s.preview) + '" alt="' + (i === 0 ? sltEsc(t.name) + ' cover' : '') + '">').join('') +
          '<span class="slt-dots">' + t.slideList.map((s, i) => '<i' + (i === 0 ? ' class="on"' : '') + '></i>').join('') + '</span>' +
        '</div>' +
        '<div class="slt-card-info"><h4>' + sltEsc(t.name) + '</h4><div class="slt-meta">' + sltEsc(t.category) + ' · ' + t.slides + ' slides</div></div>' +
      '</div>').join('') + '</div>';
  sltStartCards();
}

async function sltInit() {
  sltLoadPrefs();
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
    sltState.mode = 'pages';
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

// Keys (only while Templates mode is showing and nothing is being typed):
// Esc: viewer -> list -> Pages. Left/Right: previous/next slide in the viewer. Space: play/pause.
document.addEventListener('keydown', function (e) {
  if (sltState.mode !== 'templates') return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === 'Escape') {
    if (sltState.openId) sltBack(); else sltSetMode('pages');
    return;
  }
  if (!sltState.openId) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); sltStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); sltStep(1); }
  else if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); sltToggleAutoplay(); }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sltInit);
else sltInit();
