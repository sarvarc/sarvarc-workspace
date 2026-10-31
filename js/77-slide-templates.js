// ── SLIDE & CAROUSEL TEMPLATES → WORKSPACE EDITOR ───────────────────────────
// A second template gallery in the Workspace app bar (next to Business Proposals).
// 6 presentations (16:9, 1920x1080) and 2 carousels (4:5, 1080x1350).
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
const sltState = { tab: 'presentation', openId: null, slide: 0, busy: false, indexReady: null };
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

// ── Modal ───────────────────────────────────────────────────────────────────
async function sltOpen() {
  const ov = document.getElementById('sltOverlay');
  if (!ov) return;
  ov.classList.add('open');
  sltState.openId = null;
  sltState.indexReady = window.SLT_INDEX ? true : null;
  sltRender();
  try {
    await sltEnsureIndex();
    sltState.indexReady = true;
  } catch (e) {
    sltState.indexReady = false;
  }
  sltRender();
}

function sltClose() {
  const ov = document.getElementById('sltOverlay');
  if (ov) ov.classList.remove('open');
}

function sltSetTab(tab) {
  sltState.tab = tab;
  sltState.openId = null;
  sltRender();
}

function sltShowTemplate(id) {
  sltState.openId = id;
  sltState.slide = 0;
  sltRender();
}

function sltBack() {
  sltState.openId = null;
  sltRender();
}

function sltPickSlide(i) {
  sltState.slide = i;
  sltRender();
}

function sltRender() {
  const body = document.getElementById('sltBody');
  const tabs = document.getElementById('sltTabs');
  const sub = document.getElementById('sltSub');
  if (!body) return;
  const idx = window.SLT_INDEX;
  if (!idx) {
    if (tabs) tabs.style.display = 'none';
    body.innerHTML = sltState.indexReady === false
      ? '<p class="slt-empty">The template files could not be loaded. Make sure the <b>slide-templates</b> folder sits next to workspace.html, then try again.</p>'
      : '<p class="slt-empty">Loading templates…</p>';
    return;
  }
  const list = idx.templates;
  const nPres = list.filter(t => t.type === 'presentation').length;
  const nCar = list.filter(t => t.type === 'carousel').length;
  if (tabs) {
    tabs.style.display = sltState.openId ? 'none' : '';
    tabs.innerHTML =
      '<button type="button" class="slt-tab' + (sltState.tab === 'presentation' ? ' on' : '') + '" onclick="sltSetTab(\'presentation\')">Presentations <span>' + nPres + '</span></button>' +
      '<button type="button" class="slt-tab' + (sltState.tab === 'carousel' ? ' on' : '') + '" onclick="sltSetTab(\'carousel\')">Carousels <span>' + nCar + '</span></button>';
  }

  const open = sltState.openId ? sltFindTemplate(sltState.openId) : null;
  if (open) {
    if (sub) sub.textContent = open.name + ' · ' + open.slides + ' slides · ' + open.width + ' × ' + open.height;
    const cur = open.slideList[sltState.slide] || open.slideList[0];
    const portrait = open.type === 'carousel';
    body.innerHTML =
      '<div class="slt-detail' + (portrait ? ' portrait' : '') + '">' +
        '<div class="slt-detail-main">' +
          '<button type="button" class="slt-back" onclick="sltBack()">← All templates</button>' +
          '<div class="slt-stage" style="aspect-ratio:' + open.width + '/' + open.height + '"><img src="' + SLT_BASE + sltEsc(cur.preview) + '" alt="' + sltEsc(open.name + ' slide ' + (sltState.slide + 1)) + '"></div>' +
          '<div class="slt-strip">' + open.slideList.map((s, i) =>
            '<button type="button" class="slt-thumb' + (i === sltState.slide ? ' on' : '') + '" style="aspect-ratio:' + open.width + '/' + open.height + '" onclick="sltPickSlide(' + i + ')" title="Slide ' + (i + 1) + '"><img src="' + SLT_BASE + sltEsc(s.preview) + '" alt=""><b>' + (i + 1) + '</b></button>').join('') + '</div>' +
        '</div>' +
        '<div class="slt-detail-side">' +
          '<h4>' + sltEsc(open.name) + '</h4>' +
          '<div class="slt-cat">' + sltEsc(open.category) + '</div>' +
          '<p>' + sltEsc(open.style) + '</p>' +
          '<dl><dt>Size</dt><dd>' + open.width + ' × ' + open.height + (portrait ? ' (4:5 portrait)' : ' (16:9)') + '</dd>' +
          '<dt>Slides</dt><dd>' + open.slides + '</dd>' +
          '<dt>Fonts</dt><dd>' + sltEsc((open.fonts || []).join(', ')) + '</dd></dl>' +
          '<p class="slt-note">Every word is a real text box. Anything in [square brackets] is a placeholder to replace. Slides are copied onto your canvas; the original template is never changed.</p>' +
          '<button type="button" class="slt-primary" id="sltUseAll" onclick="sltUse(\'' + sltEsc(open.id) + '\')"' + (sltState.busy ? ' disabled' : '') + '>' + (sltState.busy ? 'Adding…' : 'Use this template (' + open.slides + ' slides)') + '</button>' +
          '<button type="button" class="slt-secondary" onclick="sltUse(\'' + sltEsc(open.id) + '\', ' + sltState.slide + ')"' + (sltState.busy ? ' disabled' : '') + '>Add only slide ' + (sltState.slide + 1) + '</button>' +
        '</div>' +
      '</div>';
    return;
  }

  if (sub) sub.textContent = sltState.tab === 'presentation'
    ? 'Presentations, 16:9 · pick one and it lands on your canvas, ready to edit'
    : 'Carousels for Instagram and LinkedIn, 4:5 portrait · pick one and it lands on your canvas';
  const shown = list.filter(t => t.type === sltState.tab);
  body.innerHTML = '<div class="slt-grid' + (sltState.tab === 'carousel' ? ' portrait' : '') + '">' + shown.map(t =>
    '<div class="slt-card" tabindex="0" role="button" onclick="sltShowTemplate(\'' + sltEsc(t.id) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();sltShowTemplate(\'' + sltEsc(t.id) + '\')}">' +
      '<div class="slt-cover" style="aspect-ratio:' + t.width + '/' + t.height + '"><img loading="lazy" src="' + SLT_BASE + sltEsc(t.cover) + '" alt="' + sltEsc(t.name) + ' cover"></div>' +
      '<h4>' + sltEsc(t.name) + '</h4>' +
      '<p>' + sltEsc(t.style) + '</p>' +
      '<div class="slt-meta"><span>' + sltEsc(t.category) + '</span><span>' + t.slides + ' slides</span></div>' +
    '</div>').join('') + '</div>';
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
    sltClose();
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
    if (document.getElementById('sltOverlay').classList.contains('open')) sltRender();
  }
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    const ov = document.getElementById('sltOverlay');
    if (ov && ov.classList.contains('open')) sltClose();
  }
});
