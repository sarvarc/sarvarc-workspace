// ─── DATA ARRANGEMENT: HOW THE TABLES RELATE (for Kadessa) ───────────────────────────────
// Until now Kadessa only saw the ONE table that was open. This file lets her see every tab
// and tells her, from the real values, what is provably connected and what is not.
//
// Three kinds of evidence, strongest first:
//   1. Told: the person explained a table or a connection (ds.note, ds.kconn), or a link was
//      set up with Interconnect (ds.xlinks, ds.xsums).
//   2. Read: a table's formulas read from another tab (the Dashboard counting the ledger).
//   3. Found in the data: two columns share the same values (Account Code in the ledger
//      against Account Code in the chart of accounts). Shared values prove a match, not meaning.
// Anything else stays "no evidence", and Kadessa is told to say so instead of guessing.
//
// Pure functions first (daRelAnalyze), so they can be tested with plain data. The glue that
// reads daState and the Kadessa action come after.

const DA_REL_MAX_TABLES = 12;
const DA_REL_MAX_ROWS = 20000;     // per table; bigger tables are checked on their first rows only
const DA_REL_MAX_LINKS = 30;
const DA_REL_STOP_WORDS = new Set(['raw', 'the', 'of', 'to', 'in', 'a', 'an', 'and', 'for']);
const DA_REL_KEYWORD = /(^|[^a-z0-9])(id|code|ref|reference|no|number|key|sku)([^a-z0-9]|$)/i;

// "1000", 1000 and "1000.0" are the same key; case and spacing never matter.
function daRelNorm(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  const s = String(v).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); if (isFinite(n)) return String(n); }
  return s;
}

function daRelIsFormula(v) { return typeof v === 'string' && v.trim().charAt(0) === '='; }

function daRelTokens(h) {
  return String(h == null ? '' : h).toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/)
    .filter(t => t && !DA_REL_STOP_WORDS.has(t));
}
function daRelHeaderSim(a, b) {
  const A = new Set(daRelTokens(a)), B = new Set(daRelTokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0; A.forEach(t => { if (B.has(t)) both++; });
  return both / (A.size + B.size - both);
}

// One pass over every column: how many values, how many different, how many look like decimals or dates.
function daRelProfile(t) {
  const rows = (t.rows || []).slice(0, DA_REL_MAX_ROWS);
  const headers = t.headers || [];
  let formulaCells = 0, filledCells = 0;
  const cols = headers.map((h, ci) => {
    const set = new Set();
    let filled = 0, numeric = 0, decimals = 0, dates = 0, formulas = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const v = rows[ri] ? rows[ri][ci] : undefined;
      if (daRelIsFormula(v)) { formulas++; continue; }
      const k = daRelNorm(v);
      if (k === '') continue;
      filled++; set.add(k);
      if (/^-?\d+(\.\d+)?$/.test(k)) { numeric++; if (k.indexOf('.') >= 0) decimals++; }
      else if (/^\d{1,4}[-\/. ]\d{1,2}[-\/. ]\d{1,4}$/.test(k) || /^\d{1,2}[- ][a-z]{3}[- ]\d{2,4}$/.test(k)) dates++;
    }
    formulaCells += formulas; filledCells += filled;
    return { header: String(h == null ? '' : h), colIdx: ci, filled, distinct: set.size, set, numeric, decimals, dates, formulas };
  });
  return { rows, cols, rowCount: (t.rows || []).length, checkedRows: rows.length, formulaCells, filledCells };
}

// Can this column act as the "list being pointed at" (a key)? Near-unique, and not amounts or dates.
function daRelKeyLike(c) {
  if (c.filled < 2) return false;
  if (c.distinct / c.filled < 0.97) return false;
  if (c.decimals / c.filled >= 0.3) return false;
  if (c.dates / c.filled >= 0.5) return false;
  return true;
}

// Compare every key-like column of one table with every column of the others.
function daRelFindValueLinks(tables, prof) {
  const best = new Map();
  for (let a = 0; a < tables.length; a++) {
    for (let b = 0; b < tables.length; b++) {
      if (a === b) continue;
      prof[a].cols.forEach(pc => {
        if (!daRelKeyLike(pc)) return;
        const parentNumeric = pc.numeric / pc.filled > 0.9;
        prof[b].cols.forEach(cc => {
          if (!cc.filled || cc.decimals / cc.filled >= 0.3) return;
          const sim = daRelHeaderSim(pc.header, cc.header);
          // Plain numbers (1, 2, 3...) overlap by accident all the time, so they need a shared header word.
          if (parentNumeric && sim < 0.34) return;
          let overlap = 0;
          cc.set.forEach(k => { if (pc.set.has(k)) overlap++; });
          if (overlap < 2) return;
          const childMatch = overlap / cc.distinct;
          if (childMatch < 0.5) return;
          if (overlap < 3 && sim < 0.34) return;                        // two shared values and unrelated names: coincidence
          if (cc.distinct <= 3 && pc.distinct <= 3 && sim === 0) return; // Yes/No style columns
          if (sim === 0 && (childMatch < 0.8 || overlap < 3)) return;
          let confidence = 'possible';
          if (childMatch >= 0.7) confidence = 'likely';
          if ((childMatch >= 0.9 && (sim >= 0.34 || overlap >= 5)) || (sim >= 0.99 && childMatch >= 0.75)) confidence = 'strong';
          const id = [a + ':' + pc.colIdx, b + ':' + cc.colIdx].sort().join('|');
          const cand = { a, b, pc, cc, overlap, childMatch, sim, confidence, parentUsed: overlap / pc.distinct };
          const old = best.get(id);
          if (!old || cand.childMatch > old.childMatch || (cand.childMatch === old.childMatch && prof[a].rowCount < prof[old.a].rowCount)) best.set(id, cand);
        });
      });
    }
  }
  const rank = { strong: 0, likely: 1, possible: 2 };
  const list = Array.from(best.values()).sort((x, y) => rank[x.confidence] - rank[y.confidence] || y.childMatch - x.childMatch).slice(0, DA_REL_MAX_LINKS);
  return list.map(c => {
    // Which child rows have no partner, and which values are they? (Usually typos: that is the real finding.)
    const tally = new Map(); let rowsNo = 0;
    prof[c.b].rows.forEach(r => {
      const v = r ? r[c.cc.colIdx] : undefined;
      if (daRelIsFormula(v)) return;
      const k = daRelNorm(v); if (k === '' || c.pc.set.has(k)) return;
      rowsNo++;
      const shown = String(v).trim().slice(0, 24);
      tally.set(shown, (tally.get(shown) || 0) + 1);
    });
    const examples = Array.from(tally.entries()).sort((x, y) => y[1] - x[1]).slice(0, 5).map(e => e[0]);
    const link = {
      childTable: tables[c.b].name, childColumn: c.cc.header,
      parentTable: tables[c.a].name, parentColumn: c.pc.header,
      confidence: c.confidence,
      matchPercent: Math.round(c.childMatch * 100),
      sameColumnName: c.sim >= 0.99,
      childRowsWithNoPartner: rowsNo,
      parentValuesUsedPercent: Math.round(c.parentUsed * 100)
    };
    if (examples.length) link.valuesWithNoPartner = examples;
    if (c.cc.distinct === c.cc.filled && c.pc.distinct === c.pc.filled) link.oneToOne = true;
    return link;
  });
}

// A table whose formulas read from another tab (a dashboard counting the ledger) is connected by definition.
function daRelFindFormulaLinks(tables) {
  const names = new Map();
  tables.forEach((t, i) => names.set(String(t.name).trim().toLowerCase(), i));
  const found = new Map();
  tables.forEach((t, from) => {
    (t.rows || []).slice(0, DA_REL_MAX_ROWS).forEach(r => {
      (r || []).forEach(v => {
        if (!daRelIsFormula(v)) return;
        const re = /'([^']+)'!|([A-Za-z0-9_.]+)!/g; let m;
        while ((m = re.exec(v))) {
          const to = names.get(String(m[1] || m[2]).trim().toLowerCase());
          if (to === undefined || to === from) continue;
          const key = from + '>' + to;
          const e = found.get(key) || { fromTable: t.name, readsTable: tables[to].name, formulaCount: 0, example: String(v).trim().slice(0, 80) };
          e.formulaCount++; found.set(key, e);
        }
      });
    });
  });
  return Array.from(found.values());
}

function daRelDeclaredLinks(tables) {
  const byId = new Map(tables.map(t => [t.id, t]));
  const out = [];
  tables.forEach(t => {
    (t.xlinks || []).forEach(l => {
      const to = byId.get(l.toId); if (!to) return;
      out.push({ table: t.name, column: (t.headers || [])[l.keyCol], parentTable: to.name, parentColumn: (to.headers || [])[l.toCol], kind: 'connected columns' });
    });
    (t.xsums || []).forEach(s => {
      const to = byId.get(s.toId); if (!to) return;
      out.push({ table: t.name, column: s.name, parentTable: to.name, kind: 'summary column (' + s.kind + ')' });
    });
  });
  return out;
}

function daRelTableSummary(t, p) {
  const headers = (t.headers || []).map(h => String(h == null ? '' : h).slice(0, 40)).slice(0, 40);
  const sample = [];
  for (let ri = 0; ri < p.rows.length && sample.length < 2; ri++) {
    const r = p.rows[ri] || [];
    if (!r.some(v => String(v == null ? '' : v).trim() !== '')) continue;
    sample.push(r.slice(0, 30).map(v => String(v == null ? '' : v).slice(0, 40)));
  }
  const cells = Math.max(1, p.rowCount * Math.max(1, headers.length));
  const keyCols = p.cols.filter(c => daRelKeyLike(c) && DA_REL_KEYWORD.test(c.header)).map(c => c.header).slice(0, 6);
  const emptyKeys = p.cols.filter(c => DA_REL_KEYWORD.test(c.header) && c.filled === 0 && c.formulas === 0 && p.rowCount > 0).map(c => c.header).slice(0, 6);
  const s = {
    name: t.name, rowCount: p.rowCount, columnCount: headers.length, headers: headers, sampleRows: sample,
    filledPercent: Math.min(100, Math.round(((p.filledCells + p.formulaCells) / cells) * 100)),
    formulaCells: p.formulaCells
  };
  if (keyCols.length) s.idColumns = keyCols;
  if (emptyKeys.length) s.idColumnsStillEmpty = emptyKeys;
  if (p.checkedRows < p.rowCount) s.checkedFirstRows = p.checkedRows;
  if (t.note) s.personExplained = t.note;
  return s;
}

// tables: [{ id, name, headers, rows, note?, kconn?, xlinks?, xsums? }]
function daRelAnalyze(tables) {
  const list = tables.slice(0, DA_REL_MAX_TABLES);
  const prof = list.map(daRelProfile);
  const valueLinks = daRelFindValueLinks(list, prof);
  const formulaLinks = daRelFindFormulaLinks(list);
  const declaredLinks = daRelDeclaredLinks(list);
  const confirmed = [];
  list.forEach(t => (t.kconn || []).forEach(c => confirmed.push(Object.assign({ table: t.name }, c))));

  const touched = new Set();
  valueLinks.forEach(l => { touched.add(l.childTable); touched.add(l.parentTable); });
  formulaLinks.forEach(l => { touched.add(l.fromTable); touched.add(l.readsTable); });
  declaredLinks.forEach(l => { touched.add(l.table); touched.add(l.parentTable); });
  confirmed.forEach(c => { if (c.status !== 'not_connected') { touched.add(c.table); touched.add(c.toTable); } });

  const out = {
    tableCount: list.length,
    tables: list.map((t, i) => daRelTableSummary(t, prof[i])),
    valueLinks: valueLinks,
    formulaLinks: formulaLinks,
    declaredLinks: declaredLinks,
    personConfirmedConnections: confirmed,
    tablesWithNoEvidenceOfAnyLink: list.filter(t => !touched.has(t.name)).map(t => t.name),
    tablesPersonHasNotExplained: list.filter(t => !t.note).map(t => t.name)
  };
  if (tables.length > list.length) out.tablesNotShown = tables.length - list.length;
  return out;
}

// ─── glue: what Kadessa receives ─────────────────────────────────────────
function daRelationsContext() {
  if (typeof daState === 'undefined' || !Array.isArray(daState.datasets)) return null;
  const list = daState.datasets.filter(d => d && Array.isArray(d.headers) && d.headers.length);
  if (list.length < 2) return null;
  const out = daRelAnalyze(list);
  out.interconnectOn = !!daState.interconnect;
  return out;
}

// ─── glue: what the person tells her (da_remember_tables) ────────────────
function daKadessaRememberTables(p) {
  const items = Array.isArray(p && p.tables) ? p.tables : [];
  if (!items.length) throw new Error('no tables were given');
  const done = [], missing = [];
  items.forEach(it => {
    const ds = it ? daXFindTable(it.table) : null;
    if (!ds) { missing.push(String(it && it.table || '')); return; }
    if (typeof it.note === 'string') {
      const n = it.note.replace(/\s+/g, ' ').trim().slice(0, 400);
      if (n) ds.note = n; else delete ds.note;
    }
    if (Array.isArray(it.connections)) {
      const list = (ds.kconn = ds.kconn || []);
      it.connections.slice(0, 20).forEach(c => {
        if (!c || !c.toTable) return;
        const to = daXFindTable(c.toTable);
        const col = String(c.column || '').trim().slice(0, 60);
        const toCol = String(c.toColumn || '').trim().slice(0, 60);
        const rec = {
          column: col, toTable: to ? to.name : String(c.toTable).trim().slice(0, 60), toColumn: toCol,
          status: c.status === 'not_connected' ? 'not_connected' : 'connected',
          how: String(c.how || '').replace(/\s+/g, ' ').trim().slice(0, 140)
        };
        const at = list.findIndex(x => x.column === rec.column && x.toTable === rec.toTable);
        if (at >= 0) list[at] = rec; else list.push(rec);
      });
      ds.kconn = list.slice(-20);
      if (!ds.kconn.length) delete ds.kconn;
    }
    done.push(ds.name);
  });
  if (!done.length) throw new Error('table not found: "' + missing[0] + '" (use the exact tab name)');
  daRenderTabs();
  return done;
}

// Hover a tab to see what Kadessa was told about it.
const _daRenderTabsBaseRel = daRenderTabs;
daRenderTabs = function () {
  _daRenderTabsBaseRel.apply(this, arguments);
  try {
    const wrap = document.getElementById('daTabs'); if (!wrap) return;
    const notes = new Map();
    daState.datasets.forEach(d => { if (d.note) notes.set(String(d.name), d.note); });
    if (!notes.size) return;
    wrap.querySelectorAll('.da-tab-name').forEach(el => {
      const n = notes.get(el.textContent);
      if (n) el.title = el.textContent + '\nKadessa was told: ' + n;
    });
  } catch (e) { /* tooltips are a nicety, never block the tabs */ }
};
