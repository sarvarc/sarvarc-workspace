// ─── DASHBOARD: "Your Recent Work" ───────────────────────────────────────
// Pulls live from the Diagrams & Graphs module (dgState + dgChartHistory)
// and the Data Arrangement module (daState.datasets) so the dashboard is a
// real reflection of what's been built in this browser, not a static promo
// page. Everything here is read-only display + "open in module" — actual
// editing/deleting still happens inside each module, so there's exactly one
// place that owns that logic.

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

function dashChartPointCount(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

// True when the chart currently open in Diagrams is the exact same data as
// the most recent history entry — i.e. nothing has been saved-and-changed
// since. Lets a Data Arrangement "Push to Diagrams" (which both loads the
// chart live AND records it to history in the same action) show up as ONE
// card instead of two identical-looking ones.
function dashCurrentMatchesTopHistory() {
  if (typeof dgState === 'undefined' || typeof dgChartHistory === 'undefined' || !dgChartHistory.length) return false;
  const h = dgChartHistory[0];
  if (h.type !== dgState.type) return false;
  const isGrouped = dgState.type === 'grouped' || dgState.type === 'hstacked' || dgState.type === 'tornado';
  try {
    return isGrouped
      ? JSON.stringify(h.groupedCategories || []) === JSON.stringify(dgState.groupedCategories || []) &&
        JSON.stringify(h.groupedSeries || []) === JSON.stringify(dgState.groupedSeries || [])
      : JSON.stringify(h.rows || []) === JSON.stringify(dgState.rows || []);
  } catch (e) { return false; }
}

function dashRenderChartsPanel() {
  const grid = document.getElementById('dashChartsGrid');
  const headCount = document.getElementById('dashChartsCount');
  if (!grid) return;

  const cards = [];
  const history = typeof dgChartHistory !== 'undefined' ? dgChartHistory : [];
  const dupesTop = dashCurrentMatchesTopHistory();

  // The chart currently loaded/live in the Diagrams module (if any real data
  // exists) — unless it's identical to history[0], in which case that
  // history card below is flagged "Live" instead so it isn't shown twice.
  if (typeof dgState !== 'undefined' && !dupesTop) {
    const isGroupedType = dgState.type === 'grouped' || dgState.type === 'hstacked' || dgState.type === 'tornado';
    const hasCurrent = isGroupedType
      ? !!(dgState.groupedCategories && dgState.groupedCategories.length)
      : !!(dgState.rows && dgState.rows.length);
    if (hasCurrent) {
      const titleInput = document.getElementById('dgTitleInput');
      const title = (titleInput && titleInput.value.trim()) || 'Current chart';
      cards.push({
        id: '__current__',
        title,
        type: dgState.type,
        points: isGroupedType ? dgState.groupedCategories.length : dgState.rows.length,
        meta: 'Currently open',
        current: true
      });
    }
  }

  // Every saved chart — this includes ones explicitly kept from the History
  // panel, and every table pushed over from Data Arrangement, which is
  // auto-saved here the moment it lands so it stays counted even after
  // later being replaced by another push or edit.
  history.forEach((h, i) => {
    cards.push({
      id: h.id,
      title: h.title,
      type: h.type,
      points: (typeof dgHistoryPointCount === 'function') ? dgHistoryPointCount(h) : dashChartPointCount(h.rows || []),
      meta: (typeof dgHistoryTimeLabel === 'function' ? dgHistoryTimeLabel(h.savedAt) : ''),
      current: i === 0 && dupesTop
    });
  });

  if (headCount) { headCount.textContent = String(cards.length); headCount.style.display = cards.length ? '' : 'none'; }

  if (!cards.length) {
    grid.innerHTML = `
      <div class="dash-recent-empty">
        <strong>No charts yet</strong>
        Upload a spreadsheet, build one from scratch, or push a table over from Data Arrangement.
        <div><button type="button" class="btn-pill" onclick="navigate('diagrams')">Build a chart →</button></div>
      </div>`;
    return;
  }

  grid.innerHTML = cards.slice(0, 6).map(c => `
    <div class="dash-recent-card" onclick="dashOpenChart('${c.id}')">
      <div class="dash-recent-card-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      </div>
      <div class="dash-recent-card-body">
        <div class="dash-recent-card-title">${escapeHtml(c.title)}</div>
        <div class="dash-recent-card-meta">${c.points} point${c.points !== 1 ? 's' : ''} \u00b7 ${escapeHtml(c.meta)}</div>
      </div>
      <span class="dash-recent-card-badge${c.current ? ' is-current' : ''}">${c.current ? 'Live' : escapeHtml(dashChartTypeLabel(c.type))}</span>
    </div>
  `).join('');
}

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
    <div class="dash-recent-card" onclick="dashOpenDataset('${ds.id}')">
      <div class="dash-recent-card-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
      </div>
      <div class="dash-recent-card-body">
        <div class="dash-recent-card-title">${escapeHtml(ds.name || 'Untitled table')}</div>
        <div class="dash-recent-card-meta">${cols} column${cols !== 1 ? 's' : ''} \u00b7 ${rows} row${rows !== 1 ? 's' : ''}</div>
      </div>
      <span class="dash-recent-card-badge">Table</span>
    </div>`;
  }).join('');
}

function dashRenderRecent() {
  try { dashRenderChartsPanel(); } catch (e) { console.warn('[Dashboard] could not render recent charts', e); }
  try { dashRenderDataPanel(); } catch (e) { console.warn('[Dashboard] could not render recent data', e); }
}

function dashOpenChart(id) {
  navigate('diagrams');
  if (id === '__current__') return; // navigate() already draws whatever's currently loaded
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

// Render once on first load (dgRestore()/daRestore() have already run by
// this point in script execution, since this block loads after both).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', dashRenderRecent);
} else {
  dashRenderRecent();
}
