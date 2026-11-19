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
// Phone, PIN, account numbers... are digits that NAME something. Adding or charting them is meaningless.
const DA_SP_IDENT_HEADER = /phone|mobile|\bcell\b|\btel\b|telephone|contact\s*(no|num)|whatsapp|\bfax\b|\bzip\b|pin\s*code|postal|aadhaar|aadhar|\bpan\b|\bssn\b|account\s*(no|num)|\biban\b/i;
const DA_SP_EMAIL_HEADER = /e-?mail/i;
// Words that say "this is an identifier / a label" and not WHAT it identifies (Employee ID <-> Employee Name).
const DA_SP_GENERIC_TOKEN = /^(id|no|num|number|code|ref|reference|key|sr|sl|serial|uuid|name|names|title|label|of|the|and)$/i;
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
  // A phone / PIN / account number is an identifier even though it is all digits.
  else if (DA_SP_IDENT_HEADER.test(name)) kind = 'id';
  // Long whole numbers that are all different (10+ digits) are identifiers, not amounts.
  else if (numeric && allInt && distinct === filled.length && filled.length >= 3 && vals.every(n => n >= 1e9)) kind = 'id';
  // "No. of Missions" / "Number of orders" are counts (a measure), not identifiers.
  else if (numeric && /^(no\.?|number)\s+of\b/i.test(name)) kind = 'measure';
  else if (DA_SP_ID_HEADER.test(name) && !(numeric && !allInt)) kind = 'id';
  else if (numeric) kind = 'measure';
  else if (filled.length >= 3 && distinct === filled.length && filled.every(v => /^[A-Za-z]{1,6}[-_ ]?\d+$/.test(String(v).trim()))) kind = 'id';
  else kind = 'text';
  return { idx: ci, name, kind, filled: filled.length, distinct, repeats: distinct < filled.length, nums };
}

// ── Identity: two rows with the same LABEL are not always the same THING ─────────────────────────
// "Rahul Shah" appears twice: EMP001 (Finance) and EMP005 (Engineering). Same name, two people.
// A label may only be merged when everything that identifies it agrees. So before any grouping we
// look for the ID that belongs to the label (Employee ID for Employee Name, Body ID for Planet /
// Body). Rows that share a label but carry DIFFERENT IDs are different things and stay apart.
function daSpTokens(h) {
  return daSpClean(h).toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !DA_SP_GENERIC_TOKEN.test(t));
}
function daSpUniquePerRow(c, n) { return c.filled > 0 && c.filled === n && c.distinct === c.filled; }
// The column that identifies what label column g names. strict = shares the subject word with g
// (Employee ID / Employee Name). loose = a name column plus the table's one unique ID, or a unique
// e-mail / phone when there is no ID at all.
function daSpOwnerId(cols, g, n) {
  const gt = daSpTokens(g.name);
  const ids = cols.filter(c => c.kind === 'id' && c.idx !== g.idx && !DA_SP_IDENT_HEADER.test(c.name));
  const strict = ids.filter(c => daSpTokens(c.name).some(t => gt.indexOf(t) !== -1));
  if (strict.length) return { col: strict[0], strict: true };
  if (/name/i.test(g.name)) {
    const uniq = ids.filter(c => daSpUniquePerRow(c, n));
    if (uniq.length === 1) return { col: uniq[0], strict: false };
    if (!ids.length) {
      const contact = cols.filter(c => c.idx !== g.idx && (DA_SP_EMAIL_HEADER.test(c.name) || DA_SP_IDENT_HEADER.test(c.name)) && daSpUniquePerRow(c, n));
      if (contact.length) return { col: contact[0], strict: false };
    }
  }
  return null;
}

// Gives every real thing its own label. Returns { rows, fixes } (rows is a copy; the input is untouched).
function daSpSeparateIdentities(headers, rows, cols) {
  const T = v => String(v == null ? '' : v).trim();
  const fixes = []; let out = rows;
  cols.forEach(g => {
    if (g.kind !== 'text' || !g.repeats) return;
    const own = daSpOwnerId(cols, g, rows.length); if (!own) return;
    const byLabel = new Map();
    rows.forEach((r, ri) => {
      const k = T(r[g.idx]), o = T(r[own.col.idx]); if (!k || !o) return;
      if (!byLabel.has(k)) byLabel.set(k, new Map());
      const ents = byLabel.get(k); if (!ents.has(o)) ents.set(o, []); ents.get(o).push(ri);
    });
    const clashes = Array.from(byLabel.entries()).filter(e => e[1].size > 1);
    if (!clashes.length) return;
    // Add the first column that tells the clashing entities apart in plain words (Department, City...).
    const helperCols = cols.filter(c => c.kind === 'text' && c.idx !== g.idx && !DA_SP_EMAIL_HEADER.test(c.name) && !DA_SP_IDENT_HEADER.test(c.name) && c.distinct > 1);
    const pick = helperCols.find(c => clashes.every(cl => {
      const vals = Array.from(cl[1].values()).map(list => T(rows[list[0]][c.idx]));
      return vals.every(Boolean) && new Set(vals.map(x => x.toLowerCase())).size === vals.length;
    }));
    const used = new Set(rows.map(r => T(r[g.idx]).toLowerCase()));
    const labelFor = (label, ent, list) => (pick ? label + ' (' + T(rows[list[0]][pick.idx]) + ')' : label + ' (' + ent + ')');
    const newLabels = new Map(); let ok = true;
    clashes.forEach(([label, ents]) => ents.forEach((list, ent) => {
      const nl = labelFor(label, ent, list);
      if (newLabels.has(nl.toLowerCase()) || (used.has(nl.toLowerCase()) && nl.toLowerCase() !== label.toLowerCase())) ok = false;
      newLabels.set(nl.toLowerCase(), 1);
    }));
    const fallbackToId = !ok;
    if (out === rows) out = rows.map(r => r.slice());
    const detail = [];
    clashes.forEach(([label, ents]) => {
      const shown = [];
      ents.forEach((list, ent) => {
        const nl = fallbackToId ? label + ' (' + ent + ')' : labelFor(label, ent, list);
        list.forEach(ri => { out[ri][g.idx] = nl; });
        shown.push(ent + ' = ' + nl);
      });
      detail.push(label + ': ' + shown.join(', '));
    });
    fixes.push({ column: g.name, idColumn: own.col.name, idx: g.idx, strict: own.strict, labels: clashes.map(c => c[0]), detail,
      by: fallbackToId ? own.col.name : (pick ? pick.name : own.col.name) });
  });
  return { rows: out, fixes };
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
function daSpPlan(headers, rows) {
  if (!headers || !rows || rows.length < 2) return null;
  // Identity first: same name + different ID = different things. Never merge them below.
  const sep = daSpSeparateIdentities(headers, rows, headers.map((_, i) => daSpColumn(headers, rows, i)));
  rows = sep.rows;
  const cols = headers.map((_, i) => daSpColumn(headers, rows, i));
  const measures = cols.filter(c => c.kind === 'measure');
  const blocked = cols.filter(c => c.kind === 'yearsum');
  if (!measures.length) return null;
  const textCols = cols.filter(c => c.kind === 'text' && c.distinct >= 2 && c.repeats);
  const yearCols = cols.filter(c => c.kind === 'year');
  const primary = measures[0];
  const zeroBlankP = daSpZeroIsBlank(primary.name);

  const fixedIdx = new Set(sep.fixes.map(f => f.idx));
  const entityCol = cols.find(c => c.kind === 'text' && daSpUniquePerRow(c, rows.length) && !DA_SP_EMAIL_HEADER.test(c.name)
    && (fixedIdx.has(c.idx) || (/name/i.test(c.name) && (() => { const o = daSpOwnerId(cols, c, rows.length); return o && o.strict; })())));
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
  // 2b) One row per person / thing, each with its own ID (Employee ID + Employee Name): chart one bar
  //     per thing. Never roll people up into a department just because a name or a department repeats.
  else if (entityCol) { mode = 'entity'; group = entityCol; }
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
  sep.fixes.forEach(f => notes.push(f.labels.join(', ') + (f.labels.length > 1 ? ' are' : ' is') + ' shared by different ' + f.idColumn + 's, so they are kept as separate rows, not added together (shown with ' + f.by + ')'));
  if (mode === 'entity') {
    notes.push('One bar per ' + group.name + ' (each has its own ' + (cols.find(c => c.kind === 'id') || { name: 'ID' }).name + ')');
  } else if (mode === 'property') {
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
    droppedGroups: dropped, blockedColumns: blocked.map(b => b.name), separated: sep.fixes };
}

// Used by daPushToDiagrams (js/32). ds = the active table; rows = its computed values.
function daSmartPushPlan(ds, computedRows) {
  try { return daSpPlan(ds.headers.map(daSpClean), computedRows); }
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

// For Kadessa's chart path (js/51): returns the rows with clashing labels made unique (same name +
// different ID = different things). rows are computed values; headers the table headers.
function daSpSeparateForChart(headers, rows) {
  try {
    const H = headers.map(daSpClean);
    const res = daSpSeparateIdentities(H, rows, H.map((_, i) => daSpColumn(H, rows, i)));
    return res;
  } catch (e) { console.warn('[Smart push] identity check skipped', e); return { rows: rows, fixes: [] }; }
}
