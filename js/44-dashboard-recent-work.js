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
  const others = dashWsLog.filter(x => !snap || x.name !== snap.name).slice(0, 3);
  const icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
  const count = dashWsLog.length;
  let body = '';

  if (snap) {
    const pct = snap.pages ? Math.round((snap.modified / snap.pages) * 100) : 0;
    const touched = snap.modified > 0;
    const chip = touched
      ? '<span class="dash-live-chip"><i></i>Active development</span>'
      : '<span class="dash-live-chip is-idle"><i></i>Open, no edits yet</span>';
    const shown = Math.min(snap.pages, 8);
    let thumbs = '';
    for (let i = 0; i < shown; i++) {
      const pg = pdfed.pages[i];
      const cached = pg && dashWsThumbCache.get(pg);
      const isMod = pg && (pg.modified || pg.type !== 'pdf');
      thumbs += `
        <div class="dash-ws-thumb${isMod ? ' is-mod' : ''}${i === snap.active ? ' is-active' : ''}" data-ws-thumb="${i}" onclick="dashOpenWorkspace(${i})" title="Open page ${i + 1}">
          ${cached ? `<img src="${cached.url}" alt="Page ${i + 1}">` : '<img alt="" style="visibility:hidden">'}
          <span class="n">${i + 1}</span>
        </div>`;
    }
    if (snap.pages > shown) {
      thumbs += `<div class="dash-ws-more" onclick="dashOpenWorkspace(${shown})">+${snap.pages - shown}<small>more pages</small></div>`;
    }
    body += `
      <div class="dash-ws-active">
        <div class="dash-ws-top">
          <div class="dash-ws-name" title="${dashEsc(snap.name)}">${dashEsc(snap.name)}</div>
          ${chip}
        </div>
        <div class="dash-ws-facts">
          <span><b>${snap.pages}</b> page${snap.pages !== 1 ? 's' : ''}</span>
          <span><b>${snap.modified}</b> modified</span>
          <span><b>${snap.added}</b> added</span>
          <span class="dash-ws-time">${entry && entry.updatedAt ? 'Last edit ' + dashAgo(entry.updatedAt) : ''}</span>
        </div>
        <div class="dash-ws-bar" title="${pct}% of pages edited"><span style="width:${pct}%"></span></div>
        <div class="dash-ws-strip">${thumbs}</div>
      </div>`;
  } else {
    body += `
      <div class="dash-recent-empty">
        <strong>No document open in Workspace</strong>
        Open a PDF, start a blank page or build one from a template. Pages and edits are recorded here as you work.
        <div><button type="button" class="btn-pill" onclick="navigate('pdfeditor')">Open Workspace →</button></div>
      </div>`;
  }

  if (others.length) {
    body += '<div class="dash-ws-recent-title">Recently worked on</div>' + others.map(x => `
      <div class="dash-recent-card" onclick="dashOpenWorkspace()">
        <div class="dash-recent-card-icon">${icon}</div>
        <div class="dash-recent-card-body">
          <div class="dash-recent-card-title">${dashEsc(x.name)}</div>
          <div class="dash-recent-card-meta">${dashPlural(x.pages || 0, 'page')} \u00b7 ${x.modified || 0} modified \u00b7 ${dashAgo(x.updatedAt)}</div>
        </div>
        <span class="dash-recent-card-badge">Recent</span>
      </div>`).join('');
  }

  panel.innerHTML = `
    <div class="dash-recent-panel-head">
      <h3>${icon} Workspace Editor <span class="dash-recent-count" style="${count ? '' : 'display:none'}">${count}</span></h3>
      <span class="dash-open-link" onclick="dashOpenWorkspace()">Open Workspace →</span>
    </div>
    ${body}`;

  if (snap) dashWsFillThumbs(++dashWsToken);
}

async function dashWsFillThumbs(token) {
  if (typeof pdfedComposeThumb !== 'function' || typeof pdfed === 'undefined') return;
  const shown = Math.min(pdfed.pages.length, 8);
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

const DASH_X0 = 12, DASH_X1 = 148, DASH_Y0 = 10, DASH_Y1 = 80;

function dashSvgGrid() {
  let s = '';
  [DASH_Y0, 33, 57, DASH_Y1].forEach(y => { s += `<line x1="${DASH_X0}" y1="${y}" x2="${DASH_X1}" y2="${y}" stroke="currentColor" stroke-opacity=".12" stroke-width="1"/>`; });
  return s;
}
function dashRange(vals, includeZero) {
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (hi === lo) hi = lo + 1;
  return { lo, hi, span: hi - lo };
}

function dashSvgBars(vals, cols) {
  const n = Math.min(vals.length, 14);
  if (!n) return '';
  const v = vals.slice(0, n);
  const r = dashRange(v, true);
  const slot = (DASH_X1 - DASH_X0) / n, bw = Math.max(3, slot * 0.62);
  const yv = a => DASH_Y1 - ((a - r.lo) / r.span) * (DASH_Y1 - DASH_Y0);
  const zy = yv(0);
  let s = dashSvgGrid();
  v.forEach((a, i) => {
    const y = yv(a);
    s += `<rect x="${(DASH_X0 + slot * i + (slot - bw) / 2).toFixed(1)}" y="${Math.min(y, zy).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, Math.abs(y - zy)).toFixed(1)}" rx="2" fill="${cols[i]}"/>`;
  });
  return s;
}

function dashSvgLine(vals, color, filled) {
  let v = vals.slice(0, 40);
  if (!v.length) return '';
  if (v.length === 1) v = [v[0], v[0]];
  const r = dashRange(v, filled);
  const pts = v.map((a, i) => [
    DASH_X0 + (DASH_X1 - DASH_X0) * i / (v.length - 1),
    DASH_Y1 - ((a - r.lo) / r.span) * (DASH_Y1 - DASH_Y0 - 4) - 2
  ]);
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  let s = dashSvgGrid();
  if (filled) s += `<polygon points="${DASH_X0},${DASH_Y1} ${line} ${DASH_X1},${DASH_Y1}" fill="${color}" fill-opacity=".25"/>`;
  s += `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (v.length <= 14) pts.forEach(p => { s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="${color}"/>`; });
  return s;
}

function dashSvgPie(vals, cols, donut) {
  const v = vals.slice(0, 10).map(Math.abs);
  const sum = v.reduce((a, b) => a + b, 0);
  if (!sum) return '';
  const cx = 80, cy = 45, r = 34;
  let ang = -Math.PI / 2, s = '';
  v.forEach((a, i) => {
    const frac = a / sum;
    if (frac <= 0) return;
    const a2 = ang + frac * 2 * Math.PI;
    if (frac >= 0.9999) {
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cols[i]}"/>`;
    } else {
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      s += `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${cols[i]}" stroke="var(--bg3)" stroke-width="1"/>`;
    }
    ang = a2;
  });
  if (donut) s += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.56).toFixed(1)}" class="dash-thumb-hole"/>`;
  return s;
}

function dashSvgGrouped(cats, series, pal, mode) {
  const nc = Math.min(cats.length, mode === 'group' ? 8 : 6);
  const ns = Math.min(series.length, 4);
  if (!nc || !ns) return '';
  const vals = series.slice(0, ns).map(sr => (sr.values || []).slice(0, nc).map(dashNumVal));
  const cols = series.slice(0, ns).map((sr, i) => dashColor(sr.color, i, pal));
  let s = '';
  if (mode === 'group') {
    const all = [].concat.apply([], vals);
    const r = dashRange(all, true);
    const slot = (DASH_X1 - DASH_X0) / nc, bw = Math.max(2.5, slot * 0.8 / ns);
    const yv = a => DASH_Y1 - ((a - r.lo) / r.span) * (DASH_Y1 - DASH_Y0);
    const zy = yv(0);
    s += dashSvgGrid();
    for (let c = 0; c < nc; c++) {
      for (let k = 0; k < ns; k++) {
        const a = vals[k][c] || 0, y = yv(a);
        s += `<rect x="${(DASH_X0 + slot * c + slot * 0.1 + bw * k).toFixed(1)}" y="${Math.min(y, zy).toFixed(1)}" width="${(bw - 0.6).toFixed(1)}" height="${Math.max(1.5, Math.abs(y - zy)).toFixed(1)}" rx="1.5" fill="${cols[k]}"/>`;
      }
    }
    return s;
  }
  if (mode === 'stack') {
    const sums = [];
    for (let c = 0; c < nc; c++) sums.push(vals.reduce((a, row) => a + Math.abs(row[c] || 0), 0));
    const max = Math.max.apply(null, sums) || 1;
    const slot = (DASH_X1 - DASH_X0) / nc, bw = Math.max(3, slot * 0.62);
    s += dashSvgGrid();
    for (let c = 0; c < nc; c++) {
      let y = DASH_Y1;
      for (let k = 0; k < ns; k++) {
        const h = Math.abs(vals[k][c] || 0) / max * (DASH_Y1 - DASH_Y0);
        y -= h;
        s += `<rect x="${(DASH_X0 + slot * c + (slot - bw) / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${cols[k]}"/>`;
      }
    }
    return s;
  }
  // horizontal modes
  const rowH = (DASH_Y1 - DASH_Y0) / nc, bh = Math.max(3, rowH * 0.62);
  if (mode === 'tornado') {
    const mid = (DASH_X0 + DASH_X1) / 2;
    const max = Math.max.apply(null, [].concat.apply([], vals).map(Math.abs)) || 1;
    s += `<line x1="${mid}" y1="${DASH_Y0}" x2="${mid}" y2="${DASH_Y1}" stroke="currentColor" stroke-opacity=".25"/>`;
    for (let c = 0; c < nc; c++) {
      const y = DASH_Y0 + rowH * c + (rowH - bh) / 2;
      const left = Math.abs(vals[0][c] || 0) / max * (mid - DASH_X0);
      s += `<rect x="${(mid - left).toFixed(1)}" y="${y.toFixed(1)}" width="${left.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${cols[0]}"/>`;
      if (ns > 1) {
        const right = Math.abs(vals[1][c] || 0) / max * (DASH_X1 - mid);
        s += `<rect x="${mid}" y="${y.toFixed(1)}" width="${right.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${cols[1]}"/>`;
      }
    }
    return s;
  }
  const sums = [];
  for (let c = 0; c < nc; c++) sums.push(vals.reduce((a, row) => a + Math.abs(row[c] || 0), 0));
  const max = Math.max.apply(null, sums) || 1;
  for (let c = 0; c < nc; c++) {
    let x = DASH_X0;
    const y = DASH_Y0 + rowH * c + (rowH - bh) / 2;
    for (let k = 0; k < ns; k++) {
      const w = Math.abs(vals[k][c] || 0) / max * (DASH_X1 - DASH_X0);
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, w).toFixed(1)}" height="${bh.toFixed(1)}" fill="${cols[k]}"/>`;
      x += w;
    }
  }
  return s;
}

function dashSvgFunnel(vals, cols) {
  const v = vals.slice(0, 6).map(Math.abs);
  if (!v.length) return '';
  const max = Math.max.apply(null, v) || 1;
  const rowH = (DASH_Y1 - DASH_Y0) / v.length, bh = rowH * 0.8;
  let s = '';
  v.forEach((a, i) => {
    const w = Math.max(6, a / max * 130);
    s += `<rect x="${(80 - w / 2).toFixed(1)}" y="${(DASH_Y0 + rowH * i + (rowH - bh) / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${cols[i]}"/>`;
  });
  return s;
}

function dashSvgRadar(vals, color) {
  const v = vals.slice(0, 8).map(Math.abs);
  if (v.length < 3) return dashSvgBars(vals, vals.map(() => color));
  const max = Math.max.apply(null, v) || 1, cx = 80, cy = 45, R = 34, n = v.length;
  const pt = (i, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return (cx + R * k * Math.cos(a)).toFixed(1) + ',' + (cy + R * k * Math.sin(a)).toFixed(1);
  };
  let ring = '', data = '';
  for (let i = 0; i < n; i++) { ring += pt(i, 1) + ' '; data += pt(i, v[i] / max) + ' '; }
  return `<polygon points="${ring}" fill="none" stroke="currentColor" stroke-opacity=".25"/>` +
    `<polygon points="${pt(0, .5)} ${pt(1, .5)} ${[...Array(n).keys()].slice(2).map(i => pt(i, .5)).join(' ')}" fill="none" stroke="currentColor" stroke-opacity=".12"/>` +
    `<polygon points="${data}" fill="${color}" fill-opacity=".3" stroke="${color}" stroke-width="2"/>`;
}

function dashSvgScatter(vals, cols) {
  const v = vals.slice(0, 24);
  if (!v.length) return '';
  const r = dashRange(v, false);
  let s = dashSvgGrid();
  v.forEach((a, i) => {
    const x = DASH_X0 + 4 + (DASH_X1 - DASH_X0 - 8) * (v.length === 1 ? .5 : i / (v.length - 1));
    const y = DASH_Y1 - 4 - ((a - r.lo) / r.span) * (DASH_Y1 - DASH_Y0 - 8);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${cols[i % cols.length]}" fill-opacity=".85"/>`;
  });
  return s;
}

function dashSvgWaterfall(vals) {
  const v = vals.slice(0, 12);
  if (!v.length) return '';
  let cum = 0;
  const spans = v.map(a => { const from = cum; cum += a; return [from, cum]; });
  const flat = [].concat.apply([0], spans);
  const r = dashRange(flat, true);
  const slot = (DASH_X1 - DASH_X0) / v.length, bw = Math.max(3, slot * 0.62);
  const yv = a => DASH_Y1 - ((a - r.lo) / r.span) * (DASH_Y1 - DASH_Y0);
  let s = dashSvgGrid();
  spans.forEach((p, i) => {
    const y1 = yv(p[0]), y2 = yv(p[1]);
    s += `<rect x="${(DASH_X0 + slot * i + (slot - bw) / 2).toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, Math.abs(y1 - y2)).toFixed(1)}" rx="1.5" fill="${v[i] >= 0 ? '#22C55E' : '#EF4444'}"/>`;
  });
  return s;
}

function dashSvgPareto(vals, cols) {
  const v = vals.slice(0, 10).map(Math.abs).sort((a, b) => b - a);
  const sum = v.reduce((a, b) => a + b, 0);
  if (!sum) return '';
  let s = dashSvgBars(v, v.map((_, i) => cols[i % cols.length]));
  let acc = 0;
  const slot = (DASH_X1 - DASH_X0) / v.length;
  const pts = v.map((a, i) => {
    acc += a;
    return (DASH_X0 + slot * i + slot / 2).toFixed(1) + ',' + (DASH_Y1 - (acc / sum) * (DASH_Y1 - DASH_Y0)).toFixed(1);
  }).join(' ');
  return s + `<polyline points="${pts}" fill="none" stroke="#FFB020" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function dashChartThumb(c) {
  const pal = dashPalette();
  const rows = Array.isArray(c.rows) ? c.rows : [];
  const vals = rows.map(r => dashNumVal(r && r.value));
  const cols = rows.map((r, i) => dashColor(r && r.color, i, pal));
  const cats = c.groupedCategories || [], series = c.groupedSeries || [];
  const hasGroups = cats.length && series.length;
  const first = cols[0] || pal[0];
  let body = '';
  try {
    switch (c.type) {
      case 'grouped': case '3d-grouped-bar': body = hasGroups ? dashSvgGrouped(cats, series, pal, 'group') : dashSvgBars(vals, cols); break;
      case 'stacked': body = hasGroups ? dashSvgGrouped(cats, series, pal, 'stack') : dashSvgBars(vals, cols); break;
      case 'hstacked': body = hasGroups ? dashSvgGrouped(cats, series, pal, 'hstack') : dashSvgBars(vals, cols); break;
      case 'tornado': body = hasGroups ? dashSvgGrouped(cats, series, pal, 'tornado') : dashSvgBars(vals, cols); break;
      case 'line': body = dashSvgLine(vals, first, false); break;
      case 'area': body = dashSvgLine(vals, first, true); break;
      case 'pie': body = dashSvgPie(vals, cols, false); break;
      case 'donut': body = dashSvgPie(vals, cols, true); break;
      case 'funnel': body = dashSvgFunnel(vals, cols); break;
      case 'radar': body = dashSvgRadar(vals, first); break;
      case '3d-scatter': body = dashSvgScatter(vals, cols); break;
      case 'waterfall': body = dashSvgWaterfall(vals); break;
      case 'pareto': body = dashSvgPareto(vals, cols); break;
      default: body = dashSvgBars(vals, cols);
    }
  } catch (e) { body = ''; }
  if (!body) {
    body = '<g stroke="currentColor" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"><line x1="60" y1="70" x2="60" y2="48"/><line x1="80" y1="70" x2="80" y2="30"/><line x1="100" y1="70" x2="100" y2="40"/></g>';
  }
  return `<svg viewBox="0 0 160 92" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;
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
  const cards = dashCollectCharts();
  if (headCount) { headCount.textContent = String(cards.length); headCount.style.display = cards.length ? '' : 'none'; }

  if (!cards.length) {
    grid.innerHTML = `
      <div class="dash-recent-empty" style="grid-column:1/-1">
        <strong>No charts yet</strong>
        Upload a spreadsheet, build one from scratch, or push a table over from Data Arrangement.
        <div><button type="button" class="btn-pill" onclick="navigate('diagrams')">Build a chart →</button></div>
      </div>`;
    return;
  }

  const LIMIT = 6;
  grid.innerHTML = cards.slice(0, LIMIT).map(c => `
    <div class="dash-chart-card" onclick="dashOpenChart('${dashEsc(c.id)}')" title="${dashEsc(c.title)}">
      <div class="dash-chart-thumb">${dashChartThumb(c)}</div>
      <span class="dash-recent-card-badge${c.current ? ' is-current' : ''}">${c.current ? 'Live' : dashEsc(dashChartTypeLabel(c.type))}</span>
      <div class="dash-chart-info">
        <div class="dash-recent-card-title">${dashEsc(c.title)}</div>
        <div class="dash-recent-card-meta">${dashPlural(c.points, 'point')} \u00b7 ${dashEsc(c.meta)}</div>
      </div>
    </div>`).join('') +
    (cards.length > LIMIT ? `<div class="dash-recent-more" style="grid-column:1/-1">Showing ${LIMIT} of ${cards.length}. <span class="dash-open-link" onclick="navigate('diagrams')">See all in Diagrams →</span></div>` : '');
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
        <div><button type="button" class="btn-pill" onclick="navigate('dataarrange')">Upload data →</button></div>
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
function dashPoll() {
  if (!dashIsVisible()) return;
  if (dashSignature() !== dashLastSig) dashRenderRecent();
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
