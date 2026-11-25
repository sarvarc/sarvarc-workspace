/*
 * Smart Push to Diagrams (js/96).
 *
 * Problem it fixes: "Push to Diagrams" used to hand the chart builder the table exactly as it sat
 * on screen (one chart point per ROW). That is wrong whenever rows are not the thing being
 * charted. Example: 12 space missions, 3 of them to Mars. Distance from Sun belongs to the BODY,
 * not the mission, so Mars was plotted 3 times, years were used as the axis, a Moon distance of 0
 * was drawn as a real value, and a column that adds up launch years was charted as a metric.
 *
 * What it does: before the push, read the table the way an analyst would.
 *   1. Sort every column into a kind: ID, year/time, text group, number (measure) or "meaningless".
 *   2. Find WHAT the number describes. If the number never changes inside a group (Mars is always
 *      227.9) it is a property of that group, so group by it and count it ONCE (not 3 times).
 *   3. Aggregate by meaning: amounts add up (sum), rates / prices / scores / ages are averaged,
 *      a property of a group is taken once. Years are never added.
 *   4. Skip values that cannot be real (a distance, price or population of 0 means "not recorded").
 *   5. Sort sensibly (time: oldest first; distance: nearest first; everything else: biggest first).
 *   6. Tell the person in one short note what was done, so nothing happens silently.
 * If the table is already one row per thing and has nothing to fix, it returns null and the old
 * push runs unchanged. Pure functions only (no DOM), so the real logic is unit-tested.
 *
 * Also here: daSummaryBlockReason, used by "Add summary" so nobody can add up or average years.
 */

const DA_SP_YEAR_HEADER = /(^|[^a-z])(year|yr|fy|vintage|founded|launched?|established|since)([^a-z]|$)/i;
const DA_SP_ID_HEADER = /(^|[^a-z0-9])(id|code|ref|reference|sku|key|no|number|sr|sl|serial|uuid)([^a-z0-9]|$)|#/i;
const DA_SP_RATE_HEADER = /rate|ratio|percent|%|avg|average|mean|median|score|rating|margin|price|temperature|temp\b|age\b|speed|index|density|per\s|\/|ctr|cpc|cpm|roi|yield|distance|height|weight|length|width|diameter|radius/i;
const DA_SP_POSITIVE_ONLY = /distance|height|weight|length|width|diameter|radius|mass|area|population|age\b|price|salary|rent|speed|capacity|size/i;
const DA_SP_ADD_HEADER = /amount|revenue|sales|cost|spend|expense|profit|income|qty|quantity|units|count|paid|budget|payment|volume|orders|leads|clicks|impressions|views|visits|fee|tax/i;

function daSpNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const s = String(v == null ? '' : v).trim();
  if (s === '') return NaN;
  const neg = /^\(.*\)$/.test(s);
  const c = s.replace(/^\(|\)$/g, '').replace(/[\p{Sc},%\s]/gu, '');
  if (c === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(c)) return NaN;
  const n = Number(c);
  return neg ? -n : n;
}
function daSpClean(h) { return String(h == null ? '' : h).trim(); }

// Everything the planner needs to know about one column.
function daSpColumn(headers, rows, ci) {
  const name = daSpClean(headers[ci]);
  const cells = rows.map(r => (r ? r[ci] : ''));
  const filled = cells.filter(v => String(v == null ? '' : v).trim() !== '');
  const nums = filled.map(daSpNum);
  const numeric = filled.length >= 2 && nums.filter(n => !isNaN(n)).length / filled.length >= 0.9;
  const distinct = new Set(filled.map(v => String(v).trim().toLowerCase())).size;
  const vals = nums.filter(n => !isNaN(n));
  const allInt = vals.length > 0 && vals.every(n => Number.isInteger(n));
  const min = vals.length ? Math.min.apply(null, vals) : NaN, max = vals.length ? Math.max.apply(null, vals) : NaN;
  const yearHeader = DA_SP_YEAR_HEADER.test(name);
  const inYearRange = numeric && allInt && min >= 1800 && max <= 2100;
  let kind;
  if (!filled.length) kind = 'empty';
  else if (numeric && yearHeader && inYearRange) kind = 'year';
  // A column named like a year whose values are NOT years (6032 = 2020 + 2011 + 2001) is a sum of
  // years: charting it as a metric is always wrong.
  else if (numeric && yearHeader) kind = 'yearsum';
  // "No. of Missions" / "Number of orders" are counts (a measure), not identifiers.
  else if (numeric && /^(no\.?|number)\s+of\b/i.test(name)) kind = 'measure';
  else if (DA_SP_ID_HEADER.test(name) && !(numeric && !allInt)) kind = 'id';
  else if (numeric) kind = 'measure';
  else if (filled.length >= 3 && distinct === filled.length && filled.every(v => /^[A-Za-z]{1,6}[-_ ]?\d+$/.test(String(v).trim()))) kind = 'id';
  else kind = 'text';
  return { idx: ci, name, kind, filled: filled.length, distinct, repeats: distinct < filled.length, nums };
}

function daSpMeasureMode(name) {
  if (DA_SP_ADD_HEADER.test(name) && !DA_SP_RATE_HEADER.test(name)) return 'sum';
  if (DA_SP_RATE_HEADER.test(name)) return 'average';
  return 'sum';
}
// A zero that cannot be real (distance 0, price 0) is a blank in disguise.
function daSpZeroIsBlank(name) { return DA_SP_POSITIVE_ONLY.test(name); }

// Does the number stay the same for every row of a group? (Mars is always 227.9.)
function daSpIsPropertyOf(rows, groupIdx, valIdx, zeroBlank) {
  const g = new Map();
  rows.forEach(r => {
    const k = String(r[groupIdx] == null ? '' : r[groupIdx]).trim(); if (!k) return;
    const n = daSpNum(r[valIdx]); if (isNaN(n) || (zeroBlank && n === 0)) return;
    if (!g.has(k)) g.set(k, []); g.get(k).push(n);
  });
  let multi = 0, steady = 0;
  g.forEach(list => {
    if (list.length < 2) return;
    multi++;
    const lo = Math.min.apply(null, list), hi = Math.max.apply(null, list);
    if (hi - lo <= Math.abs(hi) * 0.005) steady++;
  });
  return { multi, steady, groups: g.size, ok: multi > 0 && steady / multi >= 0.9 };
}

function daSpAggregate(list, how) {
  if (!list.length) return NaN;
  if (how === 'first') return list[0];
  if (how === 'average') return list.reduce((a, b) => a + b, 0) / list.length;
  return list.reduce((a, b) => a + b, 0);
}
function daSpRound(n) { return Math.round(n * 1e6) / 1e6; }

// headers: [..], rows: [[..]] of computed (plain) cell values. Returns null when the old push is fine.
function daSpPlan(headers, rows, opts) {
  if (!headers || !rows || rows.length < 2) return null;
  const cols = headers.map((_, i) => daSpColumn(headers, rows, i));
  const measures = cols.filter(c => c.kind === 'measure');
  const blocked = cols.filter(c => c.kind === 'yearsum');
  // No real number column (a leads list, survey answers, a status sheet): the honest chart is
  // "how many rows fall in each group", not one bar per person.
  if (!measures.length) return daSpCountPlan(headers, rows, cols, opts);
  const textCols = cols.filter(c => c.kind === 'text' && c.distinct >= 2 && c.repeats);
  const yearCols = cols.filter(c => c.kind === 'year');
  const primary = measures[0];
  const zeroBlankP = daSpZeroIsBlank(primary.name);

  let mode = null, group = null, why = '';
  // 1) The number describes a group (Distance belongs to the planet, not to the mission).
  let best = null;
  textCols.forEach(tc => {
    const dep = daSpIsPropertyOf(rows, tc.idx, primary.idx, zeroBlankP);
    if (dep.ok && (!best || tc.distinct > best.tc.distinct)) best = { tc, dep };
  });
  if (best) { mode = 'property'; group = best.tc; why = best.dep; }
  // 2) Events over time (sales per year).
  else if (yearCols.length) { mode = 'time'; group = yearCols[0]; }
  // 3) Plain grouping of events (sales per region).
  else if (textCols.length) { mode = 'group'; group = textCols[0]; }
  if (!mode) return null;

  // Aggregate every real measure by what it means, at the same grouping.
  const order = []; const bucket = new Map();
  rows.forEach(r => {
    const k = String(r[group.idx] == null ? '' : r[group.idx]).trim(); if (!k) return;
    if (!bucket.has(k)) { bucket.set(k, { rows: [] }); order.push(k); }
    bucket.get(k).rows.push(r);
  });
  const notes = [];
  const outMeasures = measures.slice(0, 4).map(m => {
    const zeroBlank = daSpZeroIsBlank(m.name);
    const dep = daSpIsPropertyOf(rows, group.idx, m.idx, zeroBlank);
    const how = (dep.ok && mode === 'property') ? 'first' : daSpMeasureMode(m.name);
    return { m, how, zeroBlank };
  });
  const skippedZero = new Set();
  const table = order.map(k => {
    const b = bucket.get(k);
    const out = outMeasures.map(({ m, how, zeroBlank }) => {
      const list = [];
      b.rows.forEach(r => {
        const n = daSpNum(r[m.idx]); if (isNaN(n)) return;
        if (zeroBlank && n === 0) { if (m === primary) skippedZero.add(k); return; }
        list.push(n);
      });
      return list.length ? daSpAggregate(list, how) : NaN;
    });
    return { key: k, vals: out, n: b.rows.length };
  });
  // A group with no real value for the primary measure cannot be drawn.
  const kept = table.filter(t => !isNaN(t.vals[0]));
  const dropped = table.filter(t => isNaN(t.vals[0])).map(t => t.key);
  if (kept.length < 1) return null;

  const primHow = outMeasures[0].how;
  if (mode === 'time') kept.sort((a, b) => Number(a.key) - Number(b.key));
  else if (/distance|orbit/i.test(primary.name)) kept.sort((a, b) => a.vals[0] - b.vals[0]);
  else kept.sort((a, b) => b.vals[0] - a.vals[0]);

  let finalRows = kept;
  const LIMIT = 40;
  if (mode !== 'time' && kept.length > LIMIT && primHow === 'sum') {
    const top = kept.slice(0, LIMIT - 1), rest = kept.slice(LIMIT - 1);
    finalRows = top.concat([{ key: 'Other (' + rest.length + ')', n: rest.reduce((s, r) => s + r.n, 0),
      vals: outMeasures.map((o, i) => o.how === 'sum' ? rest.reduce((s, r) => s + (isNaN(r.vals[i]) ? 0 : r.vals[i]), 0) : NaN) }]);
  }

  const showCount = mode !== 'time' && kept.some(t => t.n > 1) && outMeasures.length < 4;
  const head = [group.name].concat(outMeasures.map(o => o.m.name));
  if (showCount) head.push('Records');
  const aoa = [head].concat(finalRows.map(t => {
    const line = [t.key].concat(t.vals.map(v => isNaN(v) ? '' : daSpRound(v)));
    if (showCount) line.push(t.n);
    return line;
  }));

  // One short, honest note.
  if (mode === 'property') {
    const rep = kept.filter(t => t.n > 1).length;
    notes.push(primary.name + ' belongs to each ' + group.name + ', so it is counted once per ' + group.name + (rep ? ' (' + rep + ' appeared in several rows)' : ''));
  } else if (mode === 'time') {
    notes.push('Grouped by ' + group.name + ', oldest first; ' + primary.name + (primHow === 'sum' ? ' added up' : ' averaged') + ' per ' + group.name);
  } else {
    notes.push('Grouped by ' + group.name + '; ' + primary.name + (primHow === 'sum' ? ' added up' : primHow === 'average' ? ' averaged' : ' counted once') + ' per ' + group.name + ', biggest first');
  }
  if (dropped.length) notes.push(dropped.join(', ') + ' left out: ' + primary.name + ' is 0 or empty (not a real value)');
  if (blocked.length) notes.push(blocked.map(b => b.name).join(', ') + ' left out: it adds up years');

  const title = primary.name + ' by ' + group.name;
  return { aoa, name: title.replace(/\./g, ''), title, mode, groupName: group.name, measure: primary.name,
    notes, chartType: mode === 'time' && finalRows.length >= 3 ? 'line' : null,
    droppedGroups: dropped, blockedColumns: blocked.map(b => b.name) };
}

// ── Count mode ─────────────────────────────────────────────────────────────────────────────
// A table with no real number column (a buyer-enquiry list, survey answers, a task list) used to be
// charted one bar per ROW, with digits dragged out of text ("₹50-75L" became 5075, "3 BHK" became 3,
// "DEMO-0003" became 3). What the person wants from such a table is "how many in each group".
// This builds that: one bar per group, bar = number of rows. Pure logic, no DOM.
const DA_SP_UNIT_LAKH = { cr: 100, crore: 100, crores: 100, l: 1, lac: 1, lacs: 1, lakh: 1, lakhs: 1, k: 0.01, thousand: 0.01, m: 10, mn: 10, million: 10, bn: 10000, b: 10000, billion: 10000 };
const DA_SP_BAND_RE = /(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(crores?|cr|lakhs?|lacs?|million|thousand|billion|mn|bn|l|k|m|b)?(?![a-z])/gi;

// Where a band label like "₹75L–1Cr", "₹30–50L", "Below ₹30L", "3 BHK" sits on a number line, so
// the bars can run low to high instead of biggest first. Returns NaN when the label has no number.
function daSpBandKey(label) {
  const t = String(label == null ? '' : label);
  const hits = []; let m; DA_SP_BAND_RE.lastIndex = 0;
  while ((m = DA_SP_BAND_RE.exec(t)) !== null) hits.push({ n: parseFloat(/^\d{1,3}(,\d{2,3})+/.test(m[1]) ? m[1].replace(/,/g, '') : m[1].replace(',', '.')), u: m[2] ? m[2].toLowerCase() : '' });
  if (!hits.length) return NaN;
  // A bare number ("30" in "30-50L") takes the unit written after the range.
  const lastUnit = hits.slice().reverse().map(h => h.u).find(Boolean) || '';
  const first = hits[0]; const unit = first.u || lastUnit;
  let key = first.n * (DA_SP_UNIT_LAKH[unit] || 1);
  if (/^\s*(below|under|less|up to|upto|<)/i.test(t)) key -= 0.001;
  return key;
}

// A good axis for counting: text, a handful of groups, and the groups repeat (so there is something to count).
// Best first (closest to 5 groups).
function daSpCountCandidates(cols) {
  const cands = cols.filter(c => c.kind === 'text' && c.distinct >= 2 && c.distinct <= 30 && c.repeats && c.distinct <= c.filled * 0.8);
  cands.sort((a, b) => (Math.abs(a.distinct - 5) - Math.abs(b.distinct - 5)) || (a.idx - b.idx));
  return cands;
}

// Counts the rows in each group of ONE column. Budget bands run low to high, years oldest first,
// everything else biggest first. Past 40 groups the rest are rolled into "Other (n)".
function daSpCountBuild(pick, rows) {
  const order = []; const bucket = new Map(); let blank = 0;
  rows.forEach(r => {
    const raw = String(r && r[pick.idx] != null ? r[pick.idx] : '').trim();
    if (!raw) { blank++; return; }
    const k = raw.toLowerCase();
    if (!bucket.has(k)) { bucket.set(k, { label: raw, n: 0 }); order.push(k); }
    bucket.get(k).n++;
  });
  let groups = order.map(k => bucket.get(k));
  if (!groups.length) return null;
  const withNum = groups.filter(g => !isNaN(daSpBandKey(g.label))).length;
  if (pick.kind === 'year') groups.sort((a, b) => Number(a.label) - Number(b.label));
  else if (withNum / groups.length >= 0.8) groups.sort((a, b) => (daSpBandKey(a.label) - daSpBandKey(b.label)) || (b.n - a.n));
  else groups.sort((a, b) => (b.n - a.n) || a.label.localeCompare(b.label));
  const LIMIT = 40;
  if (groups.length > LIMIT) {
    const top = groups.slice(0, LIMIT - 1), rest = groups.slice(LIMIT - 1);
    groups = top.concat([{ label: 'Other (' + rest.length + ')', n: rest.reduce((t, g) => t + g.n, 0) }]);
  }
  const title = 'Records by ' + pick.name;
  return { idx: pick.idx, name: title.replace(/\./g, ''), title, groupName: pick.name, groups, blank,
    total: rows.length - blank, aoa: [[pick.name, 'Records']].concat(groups.map(g => [g.label, g.n])) };
}

function daSpCountPlan(headers, rows, cols, opts) {
  const prefer = opts && opts.preferCol >= 0 ? cols[opts.preferCol] : null;
  const cands = daSpCountCandidates(cols);
  let pick = null;
  if (prefer && (prefer.kind === 'text' || prefer.kind === 'year') && prefer.filled > 0) pick = prefer;   // the person chose it
  const chosenByPerson = !!pick;
  if (!pick) {
    if (!cands.length) return null;
    pick = cands[0];
  }
  const built = daSpCountBuild(pick, rows);
  if (!built) return null;
  const groups = built.groups, blank = built.blank, total = built.total;
  const notes = ['Counted rows by ' + pick.name + ' (' + total + ' rows, each bar is how many rows are in that group)'];
  if (blank) notes.push(blank + ' rows with no ' + pick.name + ' left out');
  if (groups.length === 1) notes.push('All pushed rows share the same ' + pick.name + ', so pick another column in the grid to see a spread');
  // Every column that could be counted (the pick first), so Diagrams & Graphs can offer the choice again.
  const countOptions = [built];
  cands.forEach(c => { if (c.idx !== pick.idx && countOptions.length < 8) { const b = daSpCountBuild(c, rows); if (b && b.groups.length >= 2) countOptions.push(b); } });
  return { aoa: built.aoa, name: built.name, title: built.title, mode: 'count', groupName: pick.name, measure: 'Records',
    notes, chartType: null, droppedGroups: [], blockedColumns: [],
    rowCount: rows.length, columnCount: headers.length, chosenByPerson, countOptions };
}

// Used by daPushToDiagrams (js/32). ds = the active table; rows = its computed values.
function daSmartPushPlan(ds, computedRows, opts) {
  try { return daSpPlan(ds.headers.map(daSpClean), computedRows, opts); }
  catch (e) { console.warn('[Smart push] fell back to plain push', e); return null; }
}
// Runs right after the chart has been built from the plan.
function daSmartPushAfter(plan) {
  if (!plan) return;
  try {
    if (plan.chartType && typeof dgSetType === 'function' && typeof dgState !== 'undefined' && dgState.type === 'bar') dgSetType(plan.chartType);
    if (plan.notes && plan.notes.length && typeof toast === 'function') {
      setTimeout(() => toast('Smart chart: ' + plan.notes.join(' \u00b7 '), 'info'), 600);
    }
  } catch (e) { console.warn('[Smart push] after-step failed', e); }
  // A table with no number column is charted as counts. Ask again how the person wants to see it,
  // the same way "How would you like to see your data?" always has for tables with numbers.
  try { if (plan.mode === 'count') { plan.pushedAt = Date.now(); daSpShowCountChoices(plan); } }
  catch (e) { console.warn('[Smart push] count choices failed', e); }
}

// ── "How would you like to see your data?" for count-mode pushes ──────────────────────────────
// Re-uses the popup Diagrams & Graphs already has (dgMultiSuggestOverlay). Cards: the column that was
// charted (Recommended, already on screen), up to two other columns to count by, and one chart per
// column. Not shown when the person picked ONE column in the grid before pushing (they already chose),
// or when there is only one column worth counting.
function daSpShowCountChoices(plan) {
  const opts = (plan && plan.countOptions) || [];
  if (opts.length < 2 || plan.chosenByPerson) return;
  const overlay = document.getElementById('dgMultiSuggestOverlay');
  const body = document.getElementById('dgMultiSuggestBody');
  if (!overlay || !body) return;
  const statsEl = document.getElementById('dgMultiSuggestStats');
  const subEl = document.getElementById('dgMultiSuggestSub');
  const titleEl = document.getElementById('dgMultiSuggestTitle');
  if (titleEl) titleEl.textContent = 'How would you like to see your data?';
  if (subEl) subEl.textContent = 'This table has no number column, so each chart counts how many rows fall in each group.';
  if (statsEl) {
    statsEl.innerHTML = '<div class="dg-multi-suggest-stat"><b>' + plan.rowCount + '</b><span>Rows</span></div>' +
      '<div class="dg-multi-suggest-stat"><b>' + opts.length + '</b><span>Columns to count by</span></div>' +
      '<div class="dg-multi-suggest-stat"><b>' + plan.columnCount + '</b><span>Total columns</span></div>';
  }
  const scheme = (typeof dgCurrentScheme === 'function') ? dgCurrentScheme() : ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  const specOf = (o, type) => ({ title: o.title, type: type || 'bar', format: null, formatSymbol: null,
    rows: o.groups.map((g, i) => ({ label: g.label, value: g.n, color: scheme[i % scheme.length] })) });
  const cards = [];
  opts.slice(0, 3).forEach((o, i) => {
    const top = o.groups.slice().sort((a, b) => b.n - a.n)[0];
    cards.push({ title: 'Count by ' + o.groupName, recommended: i === 0, spec: specOf(o),
      text: o.groups.length + ' groups, most rows in ' + top.label + ' (' + top.n + ').' + (i === 0 ? ' Already built.' : ''),
      run: () => (i === 0 ? null : daSpApplyCountColumn(plan, o)) });
  });
  if (opts.length >= 2) {
    cards.push({ title: 'One chart per column (' + opts.length + ')', recommended: false, spec: specOf(opts[1]),
      text: 'Every column gets its own count chart, all in the gallery.',
      run: () => daSpApplyCountGallery(opts, specOf) });
  }
  body.innerHTML = '';
  body.style.setProperty('--dg-cols', Math.min(4, cards.length));
  cards.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-suggest-card' + (c.recommended ? ' recommended' : '');
    btn.onclick = () => { if (typeof dgDismissMultiSuggest === 'function') dgDismissMultiSuggest(); c.run(); };
    const thumb = document.createElement('div');
    thumb.className = 'dg-suggest-thumb';
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    thumb.appendChild(cv);
    try { dgDrawChartSpec(cv, Object.assign({}, c.spec, { title: '' })); }
    catch (e) { console.warn('[count choices thumb]', e); thumb.classList.add('empty'); }
    if (c.recommended) { const bd = document.createElement('span'); bd.className = 'dg-suggest-badge'; bd.textContent = 'Recommended'; thumb.appendChild(bd); }
    const h = document.createElement('h4'); h.textContent = c.title;
    const pp = document.createElement('p'); pp.textContent = c.text;
    btn.appendChild(thumb); btn.appendChild(h); btn.appendChild(pp);
    body.appendChild(btn);
  });
  overlay.classList.add('open');
}

// Count by a different column: swap the chart that was just pushed for the new one (and its history
// entry, so Charts & Diagrams on the Dashboard does not count the same push twice).
function daSpApplyCountColumn(plan, opt) {
  try {
    const hist = (typeof dgChartHistory !== 'undefined') ? dgChartHistory : null;
    if (hist && hist.length && plan.pushedAt && hist[0].savedAt >= plan.pushedAt) hist.shift();
    dgOnUploadParsed(opt.aoa, opt.name);
    const t = document.getElementById('dgTitleInput');
    if (t) t.value = opt.title;
    if (typeof dgRender === 'function') dgRender();
    if (typeof dgSaveCurrentToHistory === 'function') dgSaveCurrentToHistory();
    if (typeof toast === 'function') toast('Counted rows by ' + opt.groupName + ' (' + opt.total + ' rows)', 'success');
  } catch (e) { console.warn('[count choices] column swap failed', e); }
}

// One count chart for every column worth counting, in the Diagrams & Graphs gallery.
function daSpApplyCountGallery(opts, specOf) {
  try {
    const type = (typeof dgState !== 'undefined' && dgState.type) ? dgState.type : 'bar';
    const charts = opts.map(o => specOf(o, type));
    dgSetMultiCharts(charts);   // dgMultiCharts lives inside js/42, so it is set through this bridge
    dgRenderMultiChartGallery();
    if (typeof toast === 'function') toast('Built ' + charts.length + ' charts, one per column', 'success');
  } catch (e) { console.warn('[count choices] gallery failed', e); }
}

// "Add summary" guard: adding up (or averaging) years gives a number that means nothing
// (2020 + 2011 = 4031). Returns the reason, or '' when the column is fine.
function daSummaryBlockReason(t, colIdx) {
  if (!t || !(colIdx >= 0)) return '';
  const c = daSpColumn(t.headers, (t.rows || []).slice(0, 500), colIdx);
  if (c.kind === 'year' || c.kind === 'yearsum') {
    return 'Adding up or averaging years gives a number that means nothing (2020 + 2011 = 4031). Use \u201cCount of rows\u201d to see how many.';
  }
  return '';
}
