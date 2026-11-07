// ─── DASHBOARD ────────────────────────────────────────────────────────────
// Everything on the dashboard is read from the real modules and refreshes
// itself, so there is nothing to click to update it:
//   Stat tiles ........ PDFs Processed, Images Extracted, Files Exported, Forms
//   Workspace Editor .. the document being worked on, its pages, edits, thumbnails
//   Diagrams & Graphs . saved charts with live thumbnails
//   Data Arrangement .. saved tables
//
// This file also takes over state.stats and updateStats() (originally in
// js/07 and js/29). The ~60 places that do state.stats.pdfs++ keep working
// untouched, but the numbers now behave like the labels say:
//   PDFs Processed .... unique PDFs you uploaded (generated documents and
//                       re-opening the same file do not count), saved
//   Images Extracted .. unique PDFs' extracted images (re-extracting the same
//                       PDF does not double count, a reload does not re-add), saved
//   Files Exported .... one per download (a ZIP of 50 images is 1 file), saved
//   Forms ............. live count of forms in Make Forms

(function () {
const DASH_VER = '9';
const DASH_STATS_KEY = 'sarvarcDashStats_v2';
const DASH_WS_LOG_KEY = 'sarvarcDashWorkspaceLog_v1';
const DASH_BOOT_AT = Date.now();
const DASH_FALLBACK_PALETTE = ['#00C2FF', '#7C5CFC', '#FF5C7C', '#FFB020', '#22C55E', '#F472B6', '#38BDF8', '#FB923C'];

// ─── small helpers ────────────────────────────────────────────────────────
function dashLoadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function dashSaveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or blocked, the live numbers still work */ }
}
function dashEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(String(s == null ? '' : s));
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function dashAgo(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function dashPlural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function dashIsVisible() {
  const s = document.getElementById('sec-dashboard');
  return !!(s && s.classList.contains('active'));
}

// ─── persisted counters (state.stats) ─────────────────────────────────────
let dashStatsData = dashLoadJson(DASH_STATS_KEY, null) || {};
if (!dashStatsData.pdfKeys || typeof dashStatsData.pdfKeys !== 'object') dashStatsData.pdfKeys = {};
if (!dashStatsData.imgKeys || typeof dashStatsData.imgKeys !== 'object') dashStatsData.imgKeys = {};
if (typeof dashStatsData.exports !== 'number') dashStatsData.exports = 0;

function dashSaveStats() { dashSaveJson(DASH_STATS_KEY, dashStatsData); }

// A real upload is a File object. Documents the app builds itself (templates,
// canvases, pushed tables) use a plain { name } object, so they never match.
function dashFileKey(f) {
  if (!f || typeof File === 'undefined' || !(f instanceof File)) return null;
  return [f.name, f.size, f.lastModified].join('|');
}

function dashInstallStats() {
  if (typeof state === 'undefined' || !state) return;
  let pages = (state.stats && state.stats.pages) || 0;
  const s = {};
  Object.defineProperties(s, {
    pdfs: {
      enumerable: true,
      get() { return Object.keys(dashStatsData.pdfKeys).length; },
      set(v) {
        if (!(v > s.pdfs)) return;
        const keys = [dashFileKey(state.pdfFile), dashFileKey(typeof pdfed !== 'undefined' ? pdfed.file : null)].filter(Boolean);
        let added = false;
        keys.forEach(k => { if (!dashStatsData.pdfKeys[k]) { dashStatsData.pdfKeys[k] = Date.now(); added = true; } });
        if (added) dashSaveStats();
      }
    },
    imgs: {
      enumerable: true,
      get() { return Object.keys(dashStatsData.imgKeys).reduce((a, k) => a + (dashStatsData.imgKeys[k] || 0), 0); },
      set(v) {
        const delta = v - s.imgs;
        if (!(delta > 0)) return;
        const k = dashFileKey(state.pdfFile);
        if (!k) return; // gallery restored after a reload, not a new extraction
        dashStatsData.imgKeys[k] = Math.max(dashStatsData.imgKeys[k] || 0, delta);
        dashSaveStats();
      }
    },
    exports: {
      enumerable: true,
      get() { return dashStatsData.exports; },
      set(v) {
        if (!(v > dashStatsData.exports)) return;
        dashStatsData.exports += 1; // one write = one download, whatever the batch size
        dashSaveStats();
      }
    },
    pages: { enumerable: true, get() { return pages; }, set(v) { pages = v; } }
  });
  state.stats = s;
}

// Replaces updateStats() from js/29. Same job (paint the tiles, save the
// extracted gallery) plus it schedules a dashboard refresh.
function updateStats() {
  try { dashPaintStats(); } catch (e) { console.warn('[Dashboard] stats paint failed', e); }
  if (typeof extractPersist === 'function') extractPersist();
  dashSchedule();
}

// ─── forms ────────────────────────────────────────────────────────────────
function dashGetForms() {
  try {
    if (typeof mfState !== 'undefined' && mfState && Array.isArray(mfState.forms) && mfState.forms.length) return mfState.forms;
  } catch (e) { /* mfState not ready */ }
  const raw = dashLoadJson('sarvarcForms', []);
  return Array.isArray(raw) ? raw : [];
}
function dashFormStats() {
  const forms = dashGetForms();
  const responses = forms.reduce((a, f) => a + (Array.isArray(f.responses) ? f.responses.length : 0), 0);
  return { forms: forms.length, responses };
}

// ─── layout (keeps workspace.html untouched) ──────────────────────────────
function dashEnsureLayout() {
  document.querySelectorAll('.dashboard .dash-open-link, .dashboard .btn-secondary, .dashboard .btn-pill').forEach(el => {
    if (el.getAttribute('data-arrow') || !/\u2192\s*$/.test(el.textContent)) return;
    el.innerHTML = el.innerHTML.replace(/\s*\u2192\s*$/, '') + DASH_ARROW;
    el.setAttribute('data-arrow', '1');
  });
  // The two feature cards (Smart Upload, Workspace) were removed from the dashboard.
  const feat = document.querySelector('.dashboard .features-grid');
  if (feat) feat.remove();
  const formsVal = document.getElementById('statForms') || document.getElementById('statPages');
  if (formsVal && formsVal.id !== 'statForms') {
    formsVal.id = 'statForms';
    const card = formsVal.closest('.stat-card');
    const lab = card && card.querySelector('.stat-label');
    if (lab) lab.textContent = 'Forms';
  }
  const setSub = (valId, text) => {
    const el = document.getElementById(valId);
    const sub = el && el.closest('.stat-card') && el.closest('.stat-card').querySelector('.stat-sub');
    if (sub && sub.getAttribute('data-dash') !== text) { sub.textContent = text; sub.setAttribute('data-dash', text); }
  };
  setSub('statPdfs', 'Unique uploads, all time');
  setSub('statImgs', 'Across all PDFs');
  setSub('statExports', 'One per file downloaded');

  document.querySelectorAll('.dash-ws-panel:not(#dashWorkspacePanel)').forEach(el => el.remove());
  const cols = document.querySelector('.dash-recent-cols');
  if (cols && !document.getElementById('dashWorkspacePanel')) {
    const panel = document.createElement('div');
    panel.className = 'dash-recent-panel dash-ws-panel';
    panel.id = 'dashWorkspacePanel';
    cols.parentNode.insertBefore(panel, cols);
  }
  const head = document.querySelector('.dash-recent-head p');
  if (head && head.getAttribute('data-dash') !== '1') {
    head.textContent = 'Your Workspace documents, charts and tables, updated live as you work';
    head.setAttribute('data-dash', '1');
  }
  const grid = document.getElementById('dashChartsGrid');
  if (grid && grid.className !== 'dash-chart-grid') grid.className = 'dash-chart-grid';
}

function dashPaintStats() {
  if (typeof state === 'undefined' || !state || !state.stats) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set('statPdfs', state.stats.pdfs);
  set('statImgs', state.stats.imgs);
  set('statExports', state.stats.exports);
  const fs = dashFormStats();
  set('statForms', fs.forms);
  const el = document.getElementById('statForms');
  const sub = el && el.closest('.stat-card') && el.closest('.stat-card').querySelector('.stat-sub');
  if (sub) {
    const t = fs.forms ? dashPlural(fs.responses, 'response') + ' collected' : 'Made in Make Forms';
    if (sub.getAttribute('data-dash') !== t) { sub.textContent = t; sub.setAttribute('data-dash', t); }
  }
}

// ─── Intro banner: folds away once there is real work on the dashboard ────
// Fresh visit: open. Once you have a document, chart, table, form or any counter,
// it collapses by itself to give the dashboard the room. The toggle always works,
// and your own choice is remembered.
const DASH_ARROW = '<svg class="dash-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
const DASH_CHEVRON = '<svg class="dash-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const DASH_HERO_KEY = 'sarvarcDashHero_v1';
function dashHasWork() {
  try { if (state && state.stats && (state.stats.pdfs || state.stats.imgs || state.stats.exports)) return true; } catch (e) { /* not ready */ }
  try { if (dashWsSnapshot()) return true; } catch (e) { /* not ready */ }
  try { if (dashCollectCharts().length) return true; } catch (e) { /* not ready */ }
  try { if (typeof daState !== 'undefined' && daState && Array.isArray(daState.datasets) && daState.datasets.length) return true; } catch (e) { /* not ready */ }
  try { if (dashFormStats().forms > 0) return true; } catch (e) { /* not ready */ }
  return false;
}
function dashApplyHero() {
  const hero = document.querySelector('.dash-hero');
  if (!hero) return;
  let btn = hero.querySelector('.dash-hero-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-hero-toggle';
    btn.addEventListener('click', () => {
      const nowCollapsed = !hero.classList.contains('is-collapsed');
      dashSaveJson(DASH_HERO_KEY, { pref: nowCollapsed ? 'closed' : 'open' });
      dashApplyHero();
    });
    hero.appendChild(btn);
  }
  const saved = dashLoadJson(DASH_HERO_KEY, null);
  const pref = saved && saved.pref;
  const collapsed = pref === 'closed' ? true : pref === 'open' ? false : dashHasWork();
  hero.classList.toggle('is-collapsed', collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.innerHTML = (collapsed ? 'Show intro' : 'Hide intro') + DASH_CHEVRON;
}

// ─── Workspace Editor: record pages and active development ────────────────
let dashWsLog = dashLoadJson(DASH_WS_LOG_KEY, []);
if (!Array.isArray(dashWsLog)) dashWsLog = [];
let dashWsRev = 0;        // bumps on every Workspace save so thumbnails refresh
let dashWsDirty = false;  // true when an edit happened since the last record
const dashWsThumbCache = new WeakMap();
let dashWsToken = 0;

function dashWsSnapshot() {
  if (typeof pdfed === 'undefined' || !pdfed || !Array.isArray(pdfed.pages) || !pdfed.pages.length) return null;
  const pages = pdfed.pages;
  return {
    name: (pdfed.file && pdfed.file.name) || 'Untitled Document',
    pages: pages.length,
    modified: pages.filter(p => p.modified || p.type !== 'pdf').length,
    added: pages.filter(p => p.type !== 'pdf').length,
    active: pdfed.active
  };
}

function dashWsRecord() {
  const snap = dashWsSnapshot();
  if (!snap) { dashWsDirty = false; return null; }
  const settled = Date.now() - DASH_BOOT_AT > 5000; // ignore the restore pass right after a reload
  let e = dashWsLog.find(x => x.name === snap.name);
  let changed = false;
  if (!e) {
    e = { name: snap.name, pages: snap.pages, modified: snap.modified, added: snap.added, createdAt: Date.now(), updatedAt: Date.now() };
    dashWsLog.unshift(e);
    changed = true;
  } else {
    if (e.pages !== snap.pages || e.modified !== snap.modified || e.added !== snap.added) {
      e.pages = snap.pages; e.modified = snap.modified; e.added = snap.added;
      if (settled) e.updatedAt = Date.now();
      changed = true;
    }
    if (dashWsDirty && settled) { e.updatedAt = Date.now(); changed = true; }
  }
  dashWsDirty = false;
  const idx = dashWsLog.indexOf(e);
  if (idx > 0) { dashWsLog.splice(idx, 1); dashWsLog.unshift(e); changed = true; }
  if (dashWsLog.length > 6) { dashWsLog.length = 6; changed = true; }
  if (changed) dashSaveJson(DASH_WS_LOG_KEY, dashWsLog);
  return e;
}

function dashRenderWorkspacePanel() {
  const panel = document.getElementById('dashWorkspacePanel');
  if (!panel) return;
  const snap = dashWsSnapshot();
  const entry = snap ? dashWsRecord() : null;
  const icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
  let body = '';

  if (snap) {
    const shown = Math.min(snap.pages, 7);
    let thumbs = '';
    for (let i = 0; i < shown; i++) {
      const pg = pdfed.pages[i];
      const cached = pg && dashWsThumbCache.get(pg);
            thumbs += `
        <button type="button" class="dash-ws-thumb${i === snap.active ? ' is-active' : ''}" data-ws-thumb="${i}" onclick="dashOpenWorkspace(${i})" title="Open page ${i + 1}">
          ${cached ? `<img src="${cached.url}" alt="Page ${i + 1}">` : '<img alt="" style="visibility:hidden">'}
          <span class="n">${i + 1}</span>
        </button>`;
    }
    if (snap.pages > shown) {
      thumbs += `<button type="button" class="dash-ws-more" onclick="dashOpenWorkspace(${shown})">+${snap.pages - shown}<small>more</small></button>`;
    }
    const when = entry && entry.updatedAt ? 'Edited ' + dashAgo(entry.updatedAt) : 'Opened just now';
    body += `
      <div class="dash-ws-body">
        <div class="dash-ws-info">
          <div class="dash-ws-name" title="${dashEsc(snap.name)}">${dashEsc(snap.name)}</div>
          <div class="dash-ws-when">${dashEsc(when)}</div>
          <div class="dash-ws-stats">
            <div><b>${snap.pages}</b><span>${snap.pages === 1 ? 'page' : 'pages'}</span></div>
            <div><b>${snap.modified}</b><span>edited</span></div>
            <div><b>${snap.added}</b><span>added</span></div>
          </div>
          <button type="button" class="btn-pill" onclick="dashOpenWorkspace()">Continue editing ${DASH_ARROW}</button>
        </div>
        <div class="dash-ws-pages">
          <div class="dash-ws-strip">${thumbs}</div>
        </div>
      </div>`;
  } else {
    body += `
      <div class="dash-recent-empty">
        <strong>No document open in Workspace</strong>
        Open a PDF, start a blank page or build one from a template. Pages and edits show up here as you work.
        <div><button type="button" class="btn-pill" onclick="navigate('pdfeditor')">Open Workspace ${DASH_ARROW}</button></div>
      </div>`;
  }

  panel.innerHTML = `
    <div class="dash-recent-panel-head">
      <h3>${icon} Workspace Editor</h3>
      <span class="dash-open-link" onclick="dashOpenWorkspace()">Open Workspace ${DASH_ARROW}</span>
    </div>
    ${body}`;

  panel.setAttribute('data-dash-v', DASH_VER);
  if (snap) dashWsFillThumbs(++dashWsToken);
}

async function dashWsFillThumbs(token) {
  if (typeof pdfedComposeThumb !== 'function' || typeof pdfed === 'undefined') return;
  const shown = Math.min(pdfed.pages.length, 7);
  for (let i = 0; i < shown; i++) {
    if (token !== dashWsToken) return; // a newer render took over
    const pg = pdfed.pages[i];
    if (!pg) continue;
    const cached = dashWsThumbCache.get(pg);
    if (cached && cached.rev === dashWsRev) continue;
    try {
      const url = await pdfedComposeThumb(pg, i);
      if (!url) continue;
      dashWsThumbCache.set(pg, { rev: dashWsRev, url });
      if (token !== dashWsToken) return;
      const cell = document.querySelector('#dashWorkspacePanel [data-ws-thumb="' + i + '"]');
      const img = cell && cell.querySelector('img');
      if (img) { img.src = url; img.style.visibility = ''; }
    } catch (e) { /* thumbnail is cosmetic, skip this page */ }
  }
}

function dashOpenWorkspace(pageIdx) {
  navigate('pdfeditor');
  if (typeof pageIdx === 'number' && typeof pdfedGoto === 'function' && typeof pdfed !== 'undefined' && pdfed.pages[pageIdx]) {
    setTimeout(() => { try { pdfedGoto(pageIdx); } catch (e) { /* editor still loading */ } }, 80);
  }
}

// ─── Diagrams & Graphs: chart cards with thumbnails ───────────────────────
function dashChartTypeLabel(type) {
  const labels = {
    'bar': 'Bar', 'grouped': 'Grouped bar', 'line': 'Line', 'area': 'Area',
    'pie': 'Pie', 'donut': 'Donut', 'stacked': 'Stacked', 'hstacked': 'Stacked (h)',
    'tornado': 'Tornado', 'waterfall': 'Waterfall', 'pareto': 'Pareto', 'funnel': 'Funnel',
    'radar': 'Radar', '3d-bar': '3D bar', '3d-grouped-bar': '3D grouped bar',
    '3d-histogram': '3D histogram', '3d-scatter': '3D scatter', '3d-boxplot': '3D box plot'
  };
  return labels[type] || (type ? String(type).replace(/-/g, ' ') : 'Chart');
}

function dashPalette() {
  try { if (typeof DG_PALETTES !== 'undefined' && DG_PALETTES.vibrant) return DG_PALETTES.vibrant; } catch (e) { /* fall through */ }
  return DASH_FALLBACK_PALETTE;
}
function dashColor(c, i, pal) {
  return (typeof c === 'string' && /^(#|rgb|hsl)/i.test(c)) ? c : pal[i % pal.length];
}
function dashNumVal(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-eE]/g, ''));
  return isFinite(n) ? n : 0;
}

// Real thumbnails: the image comes from the Diagrams & Graphs renderer itself
// (window.sarvarcDashDrawChart in js/42), so the card matches the chart you built.
const dashThumbCache = new Map();
function dashChartThumb(c) {
  const sig = JSON.stringify([c.type, c.title, c.rows, c.groupedCategories, c.groupedSeries]);
  let url = dashThumbCache.get(sig);
  if (!url && typeof window.sarvarcDashDrawChart === 'function') {
    try {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 200;
      window.sarvarcDashDrawChart(cv, c);
      url = cv.toDataURL('image/png');
      dashThumbCache.set(sig, url);
      if (dashThumbCache.size > 40) dashThumbCache.delete(dashThumbCache.keys().next().value);
    } catch (e) { console.warn('[Dashboard] chart thumbnail failed', e); }
  }
  if (url) return '<img src="' + url + '" alt="">';
  return '<div class="dash-thumb-none">No preview</div>';
}

function dashIsGroupedType(t) { return t === 'grouped' || t === 'hstacked' || t === 'tornado'; }

function dashCurrentMatchesTopHistory() {
  if (typeof dgState === 'undefined' || typeof dgChartHistory === 'undefined' || !dgChartHistory.length) return false;
  const h = dgChartHistory[0];
  if (h.type !== dgState.type) return false;
  try {
    return dashIsGroupedType(dgState.type)
      ? JSON.stringify(h.groupedCategories || []) === JSON.stringify(dgState.groupedCategories || []) &&
        JSON.stringify(h.groupedSeries || []) === JSON.stringify(dgState.groupedSeries || [])
      : JSON.stringify(h.rows || []) === JSON.stringify(dgState.rows || []);
  } catch (e) { return false; }
}

function dashCollectCharts() {
  const out = [];
  const history = (typeof dgChartHistory !== 'undefined' && Array.isArray(dgChartHistory)) ? dgChartHistory : [];
  const dupesTop = dashCurrentMatchesTopHistory();
  const pointsOf = h => (dashIsGroupedType(h.type) ? (h.groupedCategories || []).length : (h.rows || []).length);

  if (typeof dgState !== 'undefined' && !dupesTop) {
    const has = dashIsGroupedType(dgState.type)
      ? !!(dgState.groupedCategories && dgState.groupedCategories.length)
      : !!(dgState.rows && dgState.rows.length);
    if (has) {
      const titleInput = document.getElementById('dgTitleInput');
      out.push({
        id: '__current__',
        title: (titleInput && titleInput.value.trim()) || 'Current chart',
        type: dgState.type, rows: dgState.rows, groupedCategories: dgState.groupedCategories, groupedSeries: dgState.groupedSeries,
        points: pointsOf(dgState), meta: 'Currently open', current: true
      });
    }
  }
  history.forEach((h, i) => {
    out.push({
      id: h.id, title: h.title, type: h.type, rows: h.rows, groupedCategories: h.groupedCategories, groupedSeries: h.groupedSeries,
      points: pointsOf(h),
      meta: (typeof dgHistoryTimeLabel === 'function' ? dgHistoryTimeLabel(h.savedAt) : dashAgo(h.savedAt)),
      current: i === 0 && dupesTop
    });
  });
  return out;
}

function dashRenderChartsPanel() {
  const grid = document.getElementById('dashChartsGrid');
  const headCount = document.getElementById('dashChartsCount');
  if (!grid) return;
  grid.setAttribute('data-dash-v', DASH_VER);
  const cards = dashCollectCharts();
  if (headCount) { headCount.textContent = String(cards.length); headCount.style.display = cards.length ? '' : 'none'; }

  if (!cards.length) {
    grid.innerHTML = `
      <div class="dash-recent-empty" style="grid-column:1/-1">
        <strong>No charts yet</strong>
        Upload a spreadsheet, build one from scratch, or push a table over from Data Arrangement.
        <div><button type="button" class="btn-pill" onclick="navigate('diagrams')">Build a chart ${DASH_ARROW}</button></div>
      </div>`;
    return;
  }

  const LIMIT = 6;
  grid.innerHTML = cards.slice(0, LIMIT).map(c => `
    <div class="dash-chart-card" onclick="dashOpenChart('${dashEsc(c.id)}')" title="${dashEsc(c.title)}">
      <div class="dash-chart-thumb">${dashChartThumb(c)}</div>
      <div class="dash-chart-info">
        <div class="dash-chart-row">
          <div class="dash-recent-card-title">${dashEsc(c.title)}</div>
          <span class="dash-recent-card-badge${c.current ? ' is-current' : ''}">${c.current ? 'Live' : dashEsc(dashChartTypeLabel(c.type))}</span>
        </div>
        <div class="dash-recent-card-meta">${dashPlural(c.points, 'point')} \u00b7 ${dashEsc(c.meta)}</div>
      </div>
    </div>`).join('') +
    (cards.length > LIMIT ? `<div class="dash-recent-more" style="grid-column:1/-1">Showing ${LIMIT} of ${cards.length}. <span class="dash-open-link" onclick="navigate('diagrams')">See all in Diagrams ${DASH_ARROW}</span></div>` : '');
}

// ─── Data Arrangement (unchanged behaviour) ───────────────────────────────
function dashRenderDataPanel() {
  const grid = document.getElementById('dashDataGrid');
  const headCount = document.getElementById('dashDataCount');
  if (!grid) return;
  const datasets = (typeof daState !== 'undefined' && Array.isArray(daState.datasets)) ? daState.datasets : [];
  if (headCount) { headCount.textContent = String(datasets.length); headCount.style.display = datasets.length ? '' : 'none'; }

  if (!datasets.length) {
    grid.innerHTML = `
      <div class="dash-recent-empty">
        <strong>No data uploaded yet</strong>
        Import a CSV, Excel, PDF or scanned table in Data Arrangement to see it here.
        <div><button type="button" class="btn-pill" onclick="navigate('dataarrange')">Upload data ${DASH_ARROW}</button></div>
      </div>`;
    return;
  }
  grid.innerHTML = datasets.slice(0, 6).map(ds => {
    const cols = (ds.headers || []).length;
    const rows = (ds.rows || []).length;
    return `
    <div class="dash-recent-card" onclick="dashOpenDataset('${dashEsc(ds.id)}')">
      <div class="dash-recent-card-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
      </div>
      <div class="dash-recent-card-body">
        <div class="dash-recent-card-title">${dashEsc(ds.name || 'Untitled table')}</div>
        <div class="dash-recent-card-meta">${dashPlural(cols, 'column')} \u00b7 ${dashPlural(rows, 'row')}</div>
      </div>
      <span class="dash-recent-card-badge">Table</span>
    </div>`;
  }).join('');
}

// ─── render + auto refresh ────────────────────────────────────────────────
function dashRenderRecent() {
  try { dashEnsureLayout(); } catch (e) { console.warn('[Dashboard] layout', e); }
  try { dashApplyHero(); } catch (e) { console.warn('[Dashboard] intro banner', e); }
  try { dashPaintStats(); } catch (e) { console.warn('[Dashboard] stats', e); }
  try { if (!dashIsVisible()) { dashWsRecord(); return; } } catch (e) { /* keep going */ }
  try { dashRenderWorkspacePanel(); } catch (e) { console.warn('[Dashboard] workspace panel', e); }
  try { dashRenderChartsPanel(); } catch (e) { console.warn('[Dashboard] charts panel', e); }
  try { dashRenderDataPanel(); } catch (e) { console.warn('[Dashboard] data panel', e); }
  dashLastSig = dashSignature();
}

let dashRenderTimer = null;
function dashSchedule() {
  clearTimeout(dashRenderTimer);
  dashRenderTimer = setTimeout(dashRenderRecent, 200);
}

// Cheap fingerprint of everything the dashboard shows. If it changes while
// the dashboard is open (async restores, deletes, edits in another tab) the
// dashboard redraws on its own.
let dashLastSig = '';
function dashSignature() {
  const parts = [];
  try { parts.push(state.stats.pdfs, state.stats.imgs, state.stats.exports); } catch (e) { parts.push('s'); }
  try { const f = dashFormStats(); parts.push(f.forms, f.responses); } catch (e) { parts.push('f'); }
  try { const w = dashWsSnapshot(); parts.push(w ? [w.name, w.pages, w.modified, w.added, w.active, dashWsRev].join(':') : 'nows'); } catch (e) { parts.push('w'); }
  try {
    parts.push(dgChartHistory.length, dgChartHistory[0] ? dgChartHistory[0].id : '', dgState.type,
      dashIsGroupedType(dgState.type) ? (dgState.groupedCategories || []).length : (dgState.rows || []).length);
  } catch (e) { parts.push('c'); }
  try { parts.push(daState.datasets.map(d => d.id + ':' + (d.rows || []).length + ':' + (d.name || '')).join(',')); } catch (e) { parts.push('d'); }
  return parts.join('~');
}
function dashStale() {
  const p = document.getElementById('dashWorkspacePanel');
  const g = document.getElementById('dashChartsGrid');
  return !!((p && p.getAttribute('data-dash-v') !== DASH_VER) || (g && g.getAttribute('data-dash-v') !== DASH_VER));
}
function dashPoll() {
  if (!dashIsVisible()) return;
  if (dashStale() || dashSignature() !== dashLastSig) dashRenderRecent();
}

// ─── open actions ─────────────────────────────────────────────────────────
function dashOpenChart(id) {
  navigate('diagrams');
  if (id === '__current__') return; // navigate() already draws whatever is currently loaded
  if (typeof dgLoadHistoryItem === 'function') dgLoadHistoryItem(id);
  if (typeof dgFitZoomToHolder === 'function') setTimeout(dgFitZoomToHolder, 0);
}

function dashOpenDataset(id) {
  navigate('dataarrange');
  if (typeof daState === 'undefined') return;
  daState.activeId = id;
  if (typeof daResetFormulaBar === 'function') daResetFormulaBar();
  if (typeof daWorkspaceRefreshVisibility === 'function') daWorkspaceRefreshVisibility();
  if (typeof daRenderTabs === 'function') daRenderTabs();
  if (typeof daRenderTable === 'function') daRenderTable();
  if (typeof daPersist === 'function') daPersist();
}

// ─── boot ─────────────────────────────────────────────────────────────────
// Wrapping the save functions of each module is what makes the dashboard
// update itself: any edit anywhere ends in one of these.
function dashWrap(name, after) {
  const fn = window[name];
  if (typeof fn !== 'function' || fn.__dashWrapped) return;
  const wrapped = function () {
    const result = fn.apply(this, arguments);
    try { after(); } catch (e) { /* never let the dashboard break a save */ }
    return result;
  };
  wrapped.__dashWrapped = true;
  window[name] = wrapped;
}

(function dashBoot() {
  dashInstallStats();
  dashWrap('pdfedPersist', () => {
    dashWsRev++;
    if (Date.now() - DASH_BOOT_AT > 5000) dashWsDirty = true;
    dashSchedule();
  });
  dashWrap('dgPersist', dashSchedule);
  dashWrap('daPersist', dashSchedule);
  dashWrap('mfPersist', dashSchedule);

  const start = () => { dashRenderRecent(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  setInterval(dashPoll, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) dashSchedule(); });
  window.addEventListener('storage', dashSchedule);
})();

// Names that other files and the onclick buttons need
window.updateStats = updateStats;
window.dashSchedule = dashSchedule;
window.dashRenderRecent = dashRenderRecent;
window.dashOpenWorkspace = dashOpenWorkspace;
window.dashOpenChart = dashOpenChart;
window.dashOpenDataset = dashOpenDataset;
window.SARVARC_DASH_VERSION = DASH_VER;
console.info('[Dashboard] update ' + DASH_VER + ' loaded');
})();
