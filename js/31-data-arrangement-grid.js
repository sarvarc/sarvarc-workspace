// ─── Called by navigate('dataarrange') every time the section is opened ───
function daRender() {
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
}

// A single uploaded file can land in Data Arrangement as TWO connected
// datasets, its detected table and its written content (see DA_TABLE_SUFFIX
// / DA_PROSE_SUFFIX above, used by daAddDataset calls in daExtractDocx/
// daExtractPdf/daExtractImageTable). Rather than show those as two
// look-alike generic tabs, this pairs them back up by their shared base
// filename and renders one tab with a small Tabular Data / Content Found
// switch, so it reads as "one file, two views" instead of "two files".
function daRenderTabs() {
  daPersist();
  const wrap = document.getElementById('daTabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const rendered = new Set();

  daState.datasets.forEach(ds => {
    if (rendered.has(ds.id)) return;

    let base = null, kind = null;
    if (ds.name.endsWith(DA_TABLE_SUFFIX)) { base = ds.name.slice(0, -DA_TABLE_SUFFIX.length); kind = 'table'; }
    else if (ds.name.endsWith(DA_PROSE_SUFFIX)) { base = ds.name.slice(0, -DA_PROSE_SUFFIX.length); kind = 'prose'; }

    const partner = base
      ? daState.datasets.find(d => d.id !== ds.id && d.name === base + (kind === 'table' ? DA_PROSE_SUFFIX : DA_TABLE_SUFFIX))
      : null;

    if (base && partner) {
      const tableDs = kind === 'table' ? ds : partner;
      const proseDs = kind === 'table' ? partner : ds;
      rendered.add(tableDs.id); rendered.add(proseDs.id);

      const group = document.createElement('div');
      group.className = 'da-tab-group' + ((daState.activeId === tableDs.id || daState.activeId === proseDs.id) ? ' active' : '');
      group.innerHTML = `
        <span class="da-tab-group-name" title="${daEsc(base)}">${daEsc(base)}</span>
        <div class="da-tab-switch">
          <button type="button" class="da-tab-switch-btn${daState.activeId === tableDs.id ? ' active' : ''}" title="Show the detected table">Tabular Data</button>
          <button type="button" class="da-tab-switch-btn${daState.activeId === proseDs.id ? ' active' : ''}" title="Show the written content found alongside it">Content Found</button>
        </div>
        <span class="da-tab-close" title="Remove this file">×</span>`;
      const [tableBtn, proseBtn] = group.querySelectorAll('.da-tab-switch-btn');
      tableBtn.onclick = (e) => { e.stopPropagation(); daState.activeId = tableDs.id; if (typeof daResetFormulaBar === 'function') daResetFormulaBar(); daRenderTabs(); daRenderTable(); };
      proseBtn.onclick = (e) => { e.stopPropagation(); daState.activeId = proseDs.id; if (typeof daResetFormulaBar === 'function') daResetFormulaBar(); daRenderTabs(); daRenderTable(); };
      group.querySelector('.da-tab-close').onclick = (e) => { e.stopPropagation(); daCloseDataset(tableDs.id); daCloseDataset(proseDs.id); };
      wrap.appendChild(group);
      return;
    }

    rendered.add(ds.id);
    const tab = document.createElement('div');
    tab.className = 'da-tab' + (ds.id === daState.activeId ? ' active' : '');
    tab.onclick = () => { daState.activeId = ds.id; if (typeof daResetFormulaBar === 'function') daResetFormulaBar(); daRenderTabs(); daRenderTable(); };
    tab.innerHTML = `<span class="da-tab-name" title="${daEsc(ds.name)}">${daEsc(ds.name)}</span><span class="da-tab-close" onclick="event.stopPropagation();daCloseDataset('${ds.id}')">×</span>`;
    wrap.appendChild(tab);
  });

  // "+" tab, right after the last dataset tab — the spreadsheet-standard
  // way to add another sheet without reaching down into the toolbar. Opens
  // a tiny menu with the same three ways to bring in data the toolbar's
  // first group offers, so it's a genuine shortcut, not a duplicate button.
  const addWrap = document.createElement('div');
  addWrap.className = 'da-tab-add-wrap';

  const addTab = document.createElement('button');
  addTab.type = 'button';
  addTab.className = 'da-tab-add';
  addTab.id = 'daTabAddBtn';
  addTab.title = 'Add another table';
  addTab.setAttribute('aria-label', 'Add another table');
  addTab.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  addTab.onclick = (e) => daToggleTabAddMenu(e);
  addWrap.appendChild(addTab);

  const addMenu = document.createElement('div');
  addMenu.className = 'da-tab-add-menu';
  addMenu.id = 'daTabAddMenu';
  addMenu.innerHTML = `
    <button type="button" onclick="daCloseTabAddMenu();document.getElementById('daFileInput').click()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add File</button>
    <button type="button" onclick="daCloseTabAddMenu();daCreateBlankTable()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg> New Table</button>`;
  addWrap.appendChild(addMenu);

  wrap.appendChild(addWrap);
}

function daToggleTabAddMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('daTabAddMenu');
  if (!menu) return;
  menu.classList.toggle('open');
}
function daCloseTabAddMenu() {
  const menu = document.getElementById('daTabAddMenu');
  if (menu) menu.classList.remove('open');
}
document.addEventListener('click', function(e) {
  const menu = document.getElementById('daTabAddMenu');
  const btn = document.getElementById('daTabAddBtn');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
    menu.classList.remove('open');
  }
});

function daCloseDataset(id) {
  daState.datasets = daState.datasets.filter(d => d.id !== id);
  if (daState.activeId === id) {
    daState.activeId = daState.datasets.length ? daState.datasets[daState.datasets.length - 1].id : null;
  }
  if (typeof daResetFormulaBar === 'function') daResetFormulaBar();
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
}

function daClearAll() {
  if (!daState.datasets.length) return;
  if (!confirm('Clear all loaded data? This can\'t be undone.')) return;
  daState.datasets = [];
  daState.activeId = null;
  if (typeof daResetFormulaBar === 'function') daResetFormulaBar();
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
}

function daEsc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// True once nothing has been typed into any cell yet — used to show/hide
// the inline "paste your table here" hint on a fresh blank table.
function daIsDatasetEmpty(ds) {
  if (!ds || !ds.rows || !ds.rows.length) return true;
  return ds.rows.every(row => row.every(c => String(c ?? '').trim() === ''));
}

function daIsNumericCol(ds, colIdx) {
  const sample = ds.rows.slice(0, 25);
  let numeric = 0, total = 0;
  sample.forEach(r => { const v = String(r[colIdx] ?? '').trim(); if (v !== '') { total++; const c = daCleanNum(v); if (!isNaN(parseFloat(c)) && isFinite(c)) numeric++; } });
  return total > 0 && numeric / total > 0.7;
}

// ─── FORMULA ENGINE ─────────────────────────────────────────────────────
// Excel-style formulas typed straight into a cell: "=A1+B2", "=SUM(A1:A5)",
// "=IF(B2>10,"High","Low")", and so on. Cell refs address rows/columns by
// the same letters/numbers shown on screen (col A = first column, row 1 =
// first data row), independent of whatever the header text says.

const DA_FUNCTIONS = [
  { name: 'SUM',          syntax: 'SUM(range)',              desc: 'Add up a range of numbers' },
  { name: 'AVERAGE',      syntax: 'AVERAGE(range)',          desc: 'Average of a range' },
  { name: 'MIN',          syntax: 'MIN(range)',              desc: 'Smallest value in a range' },
  { name: 'MAX',          syntax: 'MAX(range)',              desc: 'Largest value in a range' },
  { name: 'COUNT',        syntax: 'COUNT(range)',            desc: 'Count numeric cells' },
  { name: 'COUNTA',       syntax: 'COUNTA(range)',           desc: 'Count non-empty cells' },
  { name: 'PRODUCT',      syntax: 'PRODUCT(range)',          desc: 'Multiply a range together' },
  { name: 'MEDIAN',       syntax: 'MEDIAN(range)',           desc: 'Middle value of a range' },
  { name: 'ROUND',        syntax: 'ROUND(value, digits)',    desc: 'Round to N decimal places' },
  { name: 'ROUNDUP',      syntax: 'ROUNDUP(value, digits)',  desc: 'Round up' },
  { name: 'ROUNDDOWN',    syntax: 'ROUNDDOWN(value, digits)',desc: 'Round down' },
  { name: 'ABS',          syntax: 'ABS(value)',              desc: 'Absolute value' },
  { name: 'SQRT',         syntax: 'SQRT(value)',             desc: 'Square root' },
  { name: 'POWER',        syntax: 'POWER(base, exponent)',   desc: 'Raise to a power' },
  { name: 'MOD',          syntax: 'MOD(number, divisor)',    desc: 'Remainder after division' },
  { name: 'IF',           syntax: 'IF(condition, a, b)',     desc: 'a if condition is true, else b' },
  { name: 'AND',          syntax: 'AND(cond1, cond2, …)',    desc: 'True only if all are true' },
  { name: 'OR',           syntax: 'OR(cond1, cond2, …)',     desc: 'True if any are true' },
  { name: 'NOT',          syntax: 'NOT(condition)',          desc: 'Flips true/false' },
  { name: 'CONCAT',       syntax: 'CONCAT(a, b, …)',         desc: 'Join text together' },
  { name: 'LEN',          syntax: 'LEN(text)',               desc: 'Length of text' },
  { name: 'UPPER',        syntax: 'UPPER(text)',             desc: 'Convert to UPPERCASE' },
  { name: 'LOWER',        syntax: 'LOWER(text)',             desc: 'Convert to lowercase' },
  { name: 'TRIM',         syntax: 'TRIM(text)',              desc: 'Remove extra spaces' },
  { name: 'CONVERT',      syntax: 'CONVERT(value, "from", "to")', desc: 'Convert units, e.g. km↔mi, kg↔lb, °C↔°F' },
  { name: 'CURRENCY',     syntax: 'CURRENCY(amount, "USD", "INR")', desc: 'Convert currency using live rates (click "Get Live Rates" first)' },
];

function daColToLetters(idx) {
  let n = idx + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function daLettersToCol(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}
function daRefToCell(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return { col: daLettersToCol(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 };
}

function daTokenize(str) {
  const tokens = []; let i = 0; const n = str.length;
  while (i < n) {
    const c = str[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && str[j] !== '"') { s += str[j]; j++; }
      tokens.push({ type: 'string', value: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(str[i + 1] || ''))) {
      let j = i, s = '';
      while (j < n && /[0-9.]/.test(str[j])) { s += str[j]; j++; }
      tokens.push({ type: 'number', value: parseFloat(s) }); i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i, s = '';
      while (j < n && /[A-Za-z0-9_]/.test(str[j])) { s += str[j]; j++; }
      tokens.push({ type: 'ident', value: s }); i = j; continue;
    }
    if (c === "'") {
      let j = i + 1, nm = '';
      while (j < n && str[j] !== "'") { nm += str[j]; j++; }
      tokens.push({ type: 'sheet', value: nm }); i = j + 1; continue;
    }
    if (c === '<' && str[i + 1] === '>') { tokens.push({ type: 'op', value: '<>' }); i += 2; continue; }
    if (c === '<' && str[i + 1] === '=') { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
    if (c === '>' && str[i + 1] === '=') { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
    if ('+-*/^(),:%=<>!'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new Error('Unexpected character: ' + c);
  }
  return tokens;
}

function daParseFormula(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (val) => { const t = next(); if (!t || t.value !== val) throw new Error('Expected ' + val); return t; };

  function parseExpression() { return parseComparison(); }
  function parseComparison() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && ['=', '<>', '<=', '>=', '<', '>'].includes(peek().value)) {
      const op = next().value; left = { type: 'binop', op, left, right: parseTerm() };
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value; left = { type: 'binop', op, left, right: parseFactor() };
    }
    return left;
  }
  function parseFactor() {
    let left = parseUnary();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value; left = { type: 'binop', op, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary() {
    if (peek() && peek().type === 'op' && (peek().value === '-' || peek().value === '+')) {
      const op = next().value; return { type: 'unary', op, val: parseUnary() };
    }
    return parsePower();
  }
  function parsePower() {
    let left = parsePrimary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next(); return { type: 'binop', op: '^', left, right: parseUnary() };
    }
    return left;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.type === 'number') { next(); return { type: 'number', value: t.value }; }
    if (t.type === 'string') { next(); return { type: 'string', value: t.value }; }
    if (t.type === 'op' && t.value === '(') {
      next(); const e = parseExpression(); expect(')'); return e;
    }
    const nx = tokens[pos + 1];
    if (t.type === 'sheet' || (t.type === 'ident' && nx && nx.type === 'op' && nx.value === '!')) {
      next(); expect('!');
      const a = next();
      if (!a || a.type !== 'ident' || !/^[A-Za-z]+[0-9]+$/.test(a.value)) throw new Error('Expected a cell after !');
      if (peek() && peek().type === 'op' && peek().value === ':') {
        next(); const b = next();
        if (!b || !/^[A-Za-z]+[0-9]+$/.test(b.value)) throw new Error('Invalid range');
        return { type: 'range', sheet: t.value, from: a.value.toUpperCase(), to: b.value.toUpperCase() };
      }
      return { type: 'ref', sheet: t.value, ref: a.value.toUpperCase() };
    }
    if (t.type === 'ident') {
      next();
      if (peek() && peek().type === 'op' && peek().value === '(') {
        next();
        const args = [];
        if (!(peek() && peek().type === 'op' && peek().value === ')')) {
          args.push(parseExpression());
          while (peek() && peek().type === 'op' && peek().value === ',') { next(); args.push(parseExpression()); }
        }
        expect(')');
        return { type: 'call', name: t.value.toUpperCase(), args };
      }
      if (/^[A-Za-z]+[0-9]+$/.test(t.value)) {
        if (peek() && peek().type === 'op' && peek().value === ':') {
          next();
          const t2 = next();
          if (!t2 || !/^[A-Za-z]+[0-9]+$/.test(t2.value)) throw new Error('Invalid range');
          return { type: 'range', from: t.value.toUpperCase(), to: t2.value.toUpperCase() };
        }
        return { type: 'ref', ref: t.value.toUpperCase() };
      }
      if (/^TRUE$/i.test(t.value)) return { type: 'bool', value: true };
      if (/^FALSE$/i.test(t.value)) return { type: 'bool', value: false };
      throw new Error('Unknown name: ' + t.value);
    }
    throw new Error('Unexpected token in formula');
  }

  const ast = parseExpression();
  if (pos !== tokens.length) throw new Error('Unexpected trailing characters');
  return ast;
}

// Strips thousands separators / currency symbols / stray whitespace so
// "420,000", "$420,000", " 420,000 " all parse as the full number 420000
// instead of parseFloat's default behaviour of stopping at the first comma
// (which silently truncated "420,000" down to 420).
// Trailing magnitude words/abbreviations that routinely sit right after a
// number in financial exports — Indian accounting units (Cr/Crore, L/Lakh)
// as well as the international Mn/Bn/K/M/Thousand family. Matched only when
// they immediately follow a plain numeric prefix (see DA_MAGNITUDE_RE below),
// so this can never misfire on genuine text like "UK" or "OK".
const DA_MAGNITUDE_WORDS = 'crores?|cr|lakhs?|l|thousand|k|million|mn|m|billion|bn';
const DA_MAGNITUDE_RE = new RegExp('^(-?\\d+(?:\\.\\d+)?)(' + DA_MAGNITUDE_WORDS + ')$', 'i');

function daCleanNum(v) {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  // Unwrap accounting-style negatives like "(1,234)" -> "-1234", then strip
  // currency symbols / thousands commas / percent sign / whitespace while
  // keeping the decimal point and minus sign intact.
  let s = trimmed.replace(/^\(([^()]+)\)$/, '-$1');
  s = s.replace(/[\p{Sc},\s]/gu, ''); // any currency symbol, not just $ € £ ₹
  s = s.replace(/%$/, '');
  // Strip a trailing magnitude suffix like "Cr"/"Lakh"/"K"/"Mn" once the
  // symbols/commas/spaces above are already gone (e.g. "₹420 Cr" is "420Cr"
  // at this point). Only fires when what's left of the string is exactly
  // <number><suffix> — never on plain text — so "420Cr" -> "420" but a real
  // word is left untouched. This is a unit strip, not a unit conversion: all
  // values in a column are assumed to share one magnitude (as they do in a
  // single financial table), so relative math (SUM/AVERAGE/comparisons)
  // within that column stays correct even though the "Cr"/"Lakh" is dropped.
  const magMatch = s.match(DA_MAGNITUDE_RE);
  if (magMatch) s = magMatch[1];
  return s === '' ? trimmed : s;
}

function daToNumber(v) {
  if (Array.isArray(v)) throw { formulaError: '#VALUE!' };
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '' || v == null) return 0;
  const n = parseFloat(daCleanNum(v));
  if (isNaN(n)) throw { formulaError: '#VALUE!' };
  return n;
}
function daIsTruthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.trim() !== '' && v.toUpperCase() !== 'FALSE';
  return !!v;
}

function daGetCellComputedValue(ds, row, col, visiting) {
  if (row < 0 || col < 0 || row >= ds.rows.length || col >= ds.headers.length) return '';
  const key = row + ',' + col;
  if (ds._calcCache && ds._calcCache.has(key)) return ds._calcCache.get(key);
  const raw = String((ds.rows[row] || [])[col] ?? '');
  if (!raw.trim().startsWith('=')) {
    const cleaned = daCleanNum(raw);
    const n = parseFloat(cleaned);
    return (raw.trim() !== '' && !isNaN(n) && isFinite(cleaned)) ? n : raw;
  }
  const vkey = (ds.id || '') + '|' + key;
  if (visiting.has(vkey)) throw { formulaError: '#CIRCULAR!' };
  visiting.add(vkey);
  try {
    const toks = daTokenize(raw.trim().slice(1));
    const isX = toks.some(t => t.type === 'op' && t.value === '!');
    if (isX && !daState.interconnect) {
      // Switch is OFF: linked cells keep their last calculated value as plain data
      visiting.delete(vkey);
      return (ds.xvals && ds.xvals[key] !== undefined) ? ds.xvals[key] : '';
    }
    const result = daEvalAst(daParseFormula(toks), ds, visiting);
    if (isX) { (ds.xvals = ds.xvals || {})[key] = Array.isArray(result) ? (result.length ? result[0] : '') : result; }
    if (ds._calcCache) ds._calcCache.set(key, result);
    visiting.delete(vkey);
    return result;
  } catch (e) {
    visiting.delete(vkey);
    throw e;
  }
}

function daEvalArgsFlat(argNodes, ds, visiting) {
  const out = [];
  argNodes.forEach(a => { const v = daEvalAst(a, ds, visiting); if (Array.isArray(v)) out.push(...v); else out.push(v); });
  return out;
}
function daNumericList(argNodes, ds, visiting) {
  return daEvalArgsFlat(argNodes, ds, visiting)
    .filter(v => v !== '' && v != null && typeof v !== 'boolean' && !isNaN(parseFloat(daCleanNum(v))))
    .map(v => parseFloat(daCleanNum(v)));
}

// ─── CONVERT: offline unit conversion (length, mass, volume, area, speed,
// temperature, data storage) — no network call, works instantly, forever. ──
const DA_UNIT_GROUPS = {
  length: { base: 'm',  units: { m:1, km:1000, cm:0.01, mm:0.001, mi:1609.344, yd:0.9144, ft:0.3048, in:0.0254, nmi:1852 } },
  mass:   { base: 'kg', units: { kg:1, g:0.001, mg:0.000001, t:1000, lb:0.45359237, oz:0.028349523125, st:6.35029318 } },
  volume: { base: 'l',  units: { l:1, ml:0.001, gal:3.785411784, qt:0.946352946, pt:0.473176473, cup:0.2365882365, floz:0.0295735295625, m3:1000 } },
  area:   { base: 'm2', units: { m2:1, km2:1000000, ha:10000, ft2:0.09290304, acre:4046.8564224, mi2:2589988.110336 } },
  speed:  { base: 'mps',units: { mps:1, kmh:0.277777778, mph:0.44704, knot:0.514444444 } },
  data:   { base: 'b',  units: { b:1, kb:1024, mb:1048576, gb:1073741824, tb:1099511627776 } },
};
// Common ways people actually type units, mapped to the codes above — so
// "kilometers", "pounds", "celsius" etc. just work instead of erroring.
const DA_UNIT_ALIASES = {
  kilometer:'km', kilometers:'km', centimeter:'cm', centimeters:'cm', millimeter:'mm', millimeters:'mm',
  meter:'m', meters:'m', metre:'m', metres:'m', mile:'mi', miles:'mi', yard:'yd', yards:'yd',
  foot:'ft', feet:'ft', inch:'in', inches:'in',
  kilogram:'kg', kilograms:'kg', gram:'g', grams:'g', milligram:'mg', milligrams:'mg',
  tonne:'t', tonnes:'t', ton:'t', pound:'lb', pounds:'lb', lbs:'lb', ounce:'oz', ounces:'oz', stone:'st',
  liter:'l', liters:'l', litre:'l', litres:'l', milliliter:'ml', milliliters:'ml',
  gallon:'gal', gallons:'gal', quart:'qt', quarts:'qt', pint:'pt', pints:'pt', cups:'cup',
  sqm:'m2', sqkm:'km2', hectare:'ha', hectares:'ha', acres:'acre', sqft:'ft2', sqmi:'mi2',
  kmph:'kmh', kph:'kmh', knots:'knot',
  kilobyte:'kb', kilobytes:'kb', megabyte:'mb', megabytes:'mb', gigabyte:'gb', gigabytes:'gb', terabyte:'tb', terabytes:'tb',
};
// Common nicknames/typos for currency codes, mapped to the real ISO code —
// "IND", "RS", "RUPEE" all mean the same thing a person is reaching for.
const DA_CURRENCY_ALIASES = {
  IND: 'INR', RS: 'INR', RUPEE: 'INR', RUPEES: 'INR', INDIA: 'INR',
  DOLLAR: 'USD', DOLLARS: 'USD', US: 'USD', AMERICA: 'USD',
  POUND: 'GBP', POUNDS: 'GBP', STERLING: 'GBP', UK: 'GBP',
  EURO: 'EUR', EUROS: 'EUR',
  YEN: 'JPY', JAPAN: 'JPY', YUAN: 'CNY', RMB: 'CNY', CHINA: 'CNY',
  DIRHAM: 'AED', DIRHAMS: 'AED', UAE: 'AED',
};
// Small edit-distance check so a near-miss like "INT" still gets a helpful
// "did you mean INR?" instead of a bare error code.
function daLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  return d[m][n];
}
function daSuggestClosest(code, knownList) {
  let best = null, bestDist = 3; // only suggest reasonably close matches
  for (const c of knownList) {
    const dist = daLevenshtein(code, c);
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
}


function daFindUnitGroup(unit) {
  let u = String(unit || '').trim().toLowerCase();
  if (DA_UNIT_ALIASES[u]) u = DA_UNIT_ALIASES[u];
  for (const key in DA_UNIT_GROUPS) if (Object.prototype.hasOwnProperty.call(DA_UNIT_GROUPS[key].units, u)) return { group: key, unit: u };
  return null;
}
function daConvertUnits(value, fromUnit, toUnit) {
  const from = String(fromUnit || '').trim().toLowerCase();
  const to = String(toUnit || '').trim().toLowerCase();
  // Temperature needs offset math, not a simple ratio, so handle separately.
  const tempUnits = ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'];
  const normTemp = (u) => ({ c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' }[u]);
  if (tempUnits.includes(from) && tempUnits.includes(to)) {
    const f = normTemp(from), t = normTemp(to);
    let celsius;
    if (f === 'c') celsius = value;
    else if (f === 'f') celsius = (value - 32) * 5 / 9;
    else celsius = value - 273.15;
    if (t === 'c') return celsius;
    if (t === 'f') return celsius * 9 / 5 + 32;
    return celsius + 273.15;
  }
  const fromInfo = daFindUnitGroup(from), toInfo = daFindUnitGroup(to);
  const allUnits = Object.values(DA_UNIT_GROUPS).flatMap(g => Object.keys(g.units));
  if (!fromInfo) throw { formulaError: '#UNIT?', hint: `"${fromUnit}" isn't a unit I recognize.` + daSuggestionText(from, allUnits) };
  if (!toInfo) throw { formulaError: '#UNIT?', hint: `"${toUnit}" isn't a unit I recognize.` + daSuggestionText(to, allUnits) };
  if (fromInfo.group !== toInfo.group) throw { formulaError: '#UNIT?', hint: `"${fromUnit}" and "${toUnit}" are different kinds of measurement (${fromInfo.group} vs ${toInfo.group}) — they can't convert into each other.` };
  const group = DA_UNIT_GROUPS[fromInfo.group];
  const baseValue = value * group.units[fromInfo.unit];
  return baseValue / group.units[toInfo.unit];
}

// ─── CURRENCY: live exchange rates, fetched on demand (opt-in) via the
// daFetchExchangeRates() button so no data leaves the browser silently.
// Rates are cached in memory once fetched and reused by every formula. ──
let daFxRates = null; // { base: 'USD', date: '2026-07-17', rates: { INR: 83.1, ... } }
function daConvertCurrency(amount, fromCode, toCode) {
  let from = String(fromCode || '').trim().toUpperCase();
  let to = String(toCode || '').trim().toUpperCase();
  if (DA_CURRENCY_ALIASES[from]) from = DA_CURRENCY_ALIASES[from];
  if (DA_CURRENCY_ALIASES[to]) to = DA_CURRENCY_ALIASES[to];
  if (!daFxRates) throw { formulaError: '#NORATES!', hint: 'Click "Get Live Rates" in the toolbar above the table first, then try this formula again.' };
  const rates = daFxRates.rates;
  if (from === to) return amount;
  const knownCodes = [daFxRates.base, ...Object.keys(rates)];
  const fromRate = from === daFxRates.base ? 1 : rates[from];
  const toRate = to === daFxRates.base ? 1 : rates[to];
  if (fromRate == null) throw { formulaError: '#CCY?', hint: `"${fromCode}" isn't a currency code I recognize.` + daSuggestionText(from, knownCodes) };
  if (toRate == null) throw { formulaError: '#CCY?', hint: `"${toCode}" isn't a currency code I recognize.` + daSuggestionText(to, knownCodes) };
  return (amount / fromRate) * toRate;
}
function daSuggestionText(code, knownList) {
  const guess = daSuggestClosest(code, knownList);
  return guess ? ` Did you mean "${guess}"?` : '';
}

function daCallFunction(name, argNodes, ds, visiting) {
  switch (name) {
    case 'CONVERT': {
      const v = daEvalArgsFlat(argNodes, ds, visiting);
      return daConvertUnits(daToNumber(v[0]), v[1], v[2]);
    }
    case 'CURRENCY': {
      const v = daEvalArgsFlat(argNodes, ds, visiting);
      return daConvertCurrency(daToNumber(v[0]), v[1], v[2]);
    }
    case 'SUM': return daNumericList(argNodes, ds, visiting).reduce((s, v) => s + v, 0);
    case 'AVERAGE': case 'AVG': {
      const vals = daNumericList(argNodes, ds, visiting);
      if (!vals.length) throw { formulaError: '#DIV/0!' };
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    }
    case 'MIN': { const vals = daNumericList(argNodes, ds, visiting); return vals.length ? Math.min(...vals) : 0; }
    case 'MAX': { const vals = daNumericList(argNodes, ds, visiting); return vals.length ? Math.max(...vals) : 0; }
    case 'COUNT': return daNumericList(argNodes, ds, visiting).length;
    case 'COUNTA': return daEvalArgsFlat(argNodes, ds, visiting).filter(v => v !== '' && v != null).length;
    case 'PRODUCT': { const vals = daNumericList(argNodes, ds, visiting); return vals.length ? vals.reduce((p, v) => p * v, 1) : 0; }
    case 'MEDIAN': {
      const vals = daNumericList(argNodes, ds, visiting).sort((a, b) => a - b);
      if (!vals.length) throw { formulaError: '#DIV/0!' };
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }
    case 'ROUND': { const v = daEvalArgsFlat(argNodes, ds, visiting); const x = daToNumber(v[0]); const d = v[1] != null ? daToNumber(v[1]) : 0; const f = Math.pow(10, d); return Math.round(x * f) / f; }
    case 'ROUNDUP': { const v = daEvalArgsFlat(argNodes, ds, visiting); const x = daToNumber(v[0]); const d = v[1] != null ? daToNumber(v[1]) : 0; const f = Math.pow(10, d); return (x >= 0 ? Math.ceil(x * f) : Math.floor(x * f)) / f; }
    case 'ROUNDDOWN': { const v = daEvalArgsFlat(argNodes, ds, visiting); const x = daToNumber(v[0]); const d = v[1] != null ? daToNumber(v[1]) : 0; const f = Math.pow(10, d); return (x >= 0 ? Math.floor(x * f) : Math.ceil(x * f)) / f; }
    case 'ABS': return Math.abs(daToNumber(daEvalArgsFlat(argNodes, ds, visiting)[0]));
    case 'SQRT': { const x = daToNumber(daEvalArgsFlat(argNodes, ds, visiting)[0]); if (x < 0) throw { formulaError: '#NUM!' }; return Math.sqrt(x); }
    case 'POWER': { const v = daEvalArgsFlat(argNodes, ds, visiting); return Math.pow(daToNumber(v[0]), daToNumber(v[1])); }
    case 'MOD': { const v = daEvalArgsFlat(argNodes, ds, visiting); const a = daToNumber(v[0]), b = daToNumber(v[1]); if (b === 0) throw { formulaError: '#DIV/0!' }; return a - b * Math.floor(a / b); }
    case 'IF': {
      const cond = daIsTruthy(daEvalAst(argNodes[0], ds, visiting));
      if (cond) return argNodes[1] ? daEvalAst(argNodes[1], ds, visiting) : true;
      return argNodes[2] ? daEvalAst(argNodes[2], ds, visiting) : false;
    }
    case 'AND': return argNodes.every(a => daIsTruthy(daEvalAst(a, ds, visiting)));
    case 'OR': return argNodes.some(a => daIsTruthy(daEvalAst(a, ds, visiting)));
    case 'NOT': return !daIsTruthy(daEvalAst(argNodes[0], ds, visiting));
    case 'CONCAT': case 'CONCATENATE': return daEvalArgsFlat(argNodes, ds, visiting).map(v => String(v ?? '')).join('');
    case 'LEN': return String(daEvalArgsFlat(argNodes, ds, visiting)[0] ?? '').length;
    case 'UPPER': return String(daEvalArgsFlat(argNodes, ds, visiting)[0] ?? '').toUpperCase();
    case 'LOWER': return String(daEvalArgsFlat(argNodes, ds, visiting)[0] ?? '').toLowerCase();
    case 'TRIM': return String(daEvalArgsFlat(argNodes, ds, visiting)[0] ?? '').trim();
    case 'VLOOKUP': {
      const k = daEvalAst(argNodes[0], ds, visiting), g = daRange2D(argNodes[1], ds, visiting);
      const ci = daToNumber(daEvalAst(argNodes[2], ds, visiting)) - 1;
      if (ci < 0 || !g.length || ci >= g[0].length) throw { formulaError: '#REF!' };
      const row = g.find(r => daXMatch(r[0], k));
      if (!row) throw { formulaError: '#N/A' };
      return row[ci];
    }
    case 'XLOOKUP': {
      const k = daEvalAst(argNodes[0], ds, visiting);
      const lg = daRange2D(argNodes[1], ds, visiting).flat(), rg = daRange2D(argNodes[2], ds, visiting).flat();
      const i = lg.findIndex(v => daXMatch(v, k));
      if (i < 0) { if (argNodes[3]) return daEvalAst(argNodes[3], ds, visiting); throw { formulaError: '#N/A' }; }
      return rg[i];
    }
    case 'SUMIF': case 'COUNTIF': {
      const rg = daRange2D(argNodes[0], ds, visiting).flat(), crit = daEvalAst(argNodes[1], ds, visiting);
      const sg = (name === 'SUMIF' && argNodes[2]) ? daRange2D(argNodes[2], ds, visiting).flat() : rg;
      let tot = 0, cnt = 0;
      rg.forEach((v, i) => { if (daXCrit(v, crit)) { cnt++; const n = parseFloat(daCleanNum(sg[i])); if (!isNaN(n)) tot += n; } });
      return name === 'SUMIF' ? tot : cnt;
    }
    default: throw { formulaError: '#NAME?' };
  }
}

function daEvalAst(node, ds, visiting) {
  if ((node.type === 'ref' || node.type === 'range') && node.sheet) return daXEval(node, ds, visiting);
  switch (node.type) {
    case 'number': return node.value;
    case 'string': return node.value;
    case 'bool': return node.value;
    case 'ref': {
      const cell = daRefToCell(node.ref);
      if (!cell) throw { formulaError: '#REF!' };
      return daGetCellComputedValue(ds, cell.row, cell.col, visiting);
    }
    case 'range': {
      const from = daRefToCell(node.from), to = daRefToCell(node.to);
      if (!from || !to) throw { formulaError: '#REF!' };
      const r1 = Math.min(from.row, to.row), r2 = Math.max(from.row, to.row);
      const c1 = Math.min(from.col, to.col), c2 = Math.max(from.col, to.col);
      const arr = [];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) arr.push(daGetCellComputedValue(ds, r, c, visiting));
      return arr;
    }
    case 'unary': { const v = daToNumber(daEvalAst(node.val, ds, visiting)); return node.op === '-' ? -v : v; }
    case 'binop': {
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        let l = daEvalAst(node.left, ds, visiting), r = daEvalAst(node.right, ds, visiting);
        if (Array.isArray(l)) l = l.length ? l[0] : '';
        if (Array.isArray(r)) r = r.length ? r[0] : '';
        switch (node.op) {
          case '=': return l == r;
          case '<>': return l != r;
          case '<': return daToNumber(l) < daToNumber(r);
          case '>': return daToNumber(l) > daToNumber(r);
          case '<=': return daToNumber(l) <= daToNumber(r);
          case '>=': return daToNumber(l) >= daToNumber(r);
        }
      }
      const l = daToNumber(daEvalAst(node.left, ds, visiting)), r = daToNumber(daEvalAst(node.right, ds, visiting));
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': if (r === 0) throw { formulaError: '#DIV/0!' }; return l / r;
        case '^': return Math.pow(l, r);
      }
      break;
    }
    case 'call': return daCallFunction(node.name, node.args, ds, visiting);
  }
  throw { formulaError: '#ERROR!' };
}

function daFormatFormulaResult(val) {
  if (Array.isArray(val)) val = val.length ? val[0] : '';
  if (val && val.formulaError) return val.formulaError;
  if (typeof val === 'number') {
    if (!isFinite(val)) return '#NUM!';
    return String(Math.round(val * 1e10) / 1e10);
  }
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return String(val ?? '');
}

// Returns {display, isFormula, isError} for one cell, safe to call on any
// cell regardless of whether it holds a formula, a plain value, or nothing.
function daFormulaDisplayValue(ds, row, col) {
  const raw = String((ds.rows[row] || [])[col] ?? '');
  if (!raw.trim().startsWith('=')) return { display: raw, isFormula: false, isError: false };
  try {
    const val = daGetCellComputedValue(ds, row, col, new Set());
    return { display: daFormatFormulaResult(val), isFormula: true, isError: false };
  } catch (e) {
    return { display: (e && e.formulaError) || '#ERROR!', isFormula: true, isError: true };
  }
}

// Anything leaving the grid (export files, Push to Diagrams, Push to
// Workflow) should carry computed results, not the raw "=SUM(A1:A5)" text,
// exactly like copying cells out of a real spreadsheet.
function daComputedRowsForExport(ds) {
  if (!ds) return [];
  ds._calcCache = new Map();
  return ds.rows.map((row, ri) => row.map((cell, ci) => {
    const val = String(cell ?? '');
    if (!val.trim().startsWith('=')) return val;
    return daFormulaDisplayValue(ds, ri, ci).display;
  }));
}

// ─── INTERCONNECT TABLES (opt-in switch) ────────────────────────────────
// OFF (default): tabs are independent, exactly as before. ON: formulas may
// reach into other tabs ('Table'!B2, Orders!D2:D50), lookups work across
// tabs, and "Connect columns" builds live pull-in columns from another table.
// Switching OFF keeps linked cells' last values as plain data (ds.xvals).
DA_FUNCTIONS.push(
  { name: 'VLOOKUP', syntax: 'VLOOKUP(key, range, col)', desc: 'Find key in the first column of a range, return that row\u2019s Nth column (works across tabs)' },
  { name: 'XLOOKUP', syntax: 'XLOOKUP(key, lookupRange, returnRange, notFound)', desc: 'Find key in one range, return the matching cell from another (works across tabs)' },
  { name: 'SUMIF',   syntax: 'SUMIF(range, criteria, sumRange)', desc: 'Add numbers where the range matches the criteria' },
  { name: 'COUNTIF', syntax: 'COUNTIF(range, criteria)', desc: 'Count cells that match the criteria' }
);
function daXMatch(a, b) { return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(); }
function daXCrit(v, crit) {
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(crit ?? '')); const op = m[1] || '=', rhs = m[2];
  const a = parseFloat(daCleanNum(v)), b = parseFloat(daCleanNum(rhs));
  const num = !isNaN(a) && !isNaN(b) && String(v ?? '').trim() !== '';
  if (op === '=') return num ? a === b : daXMatch(v, rhs);
  if (op === '<>') return num ? a !== b : !daXMatch(v, rhs);
  if (!num) return false;
  return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
}
function daRange2D(node, ds, visiting) {
  if (node.type !== 'range' && node.type !== 'ref') throw { formulaError: '#VALUE!' };
  let tds = ds, cross = false;
  if (node.sheet) {
    if (!daState.interconnect) throw { formulaError: '#LINKED-OFF' };
    const want = String(node.sheet).trim().toLowerCase();
    tds = daState.datasets.find(d => String(d.name).trim().toLowerCase() === want);
    if (!tds) throw { formulaError: '#REF!' };
    cross = tds !== ds;
  }
  const from = daRefToCell(node.from || node.ref), to = daRefToCell(node.to || node.ref);
  if (!from || !to) throw { formulaError: '#REF!' };
  const saved = tds._calcCache; if (cross) tds._calcCache = new Map(); // other tab: always read fresh values
  try {
    const out = [];
    for (let r = Math.min(from.row, to.row); r <= Math.min(Math.max(from.row, to.row), tds.rows.length - 1); r++) {
      const row = [];
      for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) row.push(daGetCellComputedValue(tds, r, c, visiting));
      out.push(row);
    }
    return out;
  } finally { if (cross) tds._calcCache = saved; }
}
function daXEval(node, ds, visiting) {
  const g = daRange2D(node, ds, visiting);
  return node.type === 'ref' ? (g[0] ? g[0][0] : '') : g.flat();
}
function daToggleInterconnect(on) {
  daState.interconnect = !!on;
  daState.datasets.forEach(d => { d._calcCache = new Map(); });
  daPersist(); daRenderTabs(); daRenderTable();
  if (typeof toast === 'function') toast(on ? 'Tables interconnected. Use \'Table name\'!B2 in formulas, or Connect columns.' : 'Interconnect off. Linked cells keep their last values.', 'info');
}
function daInjectLinkSwitch() {
  const wrap = document.getElementById('daTabs'); if (!wrap || wrap.querySelector('.da-xsw')) return;
  if (!document.getElementById('daXStyle')) {
    const st = document.createElement('style'); st.id = 'daXStyle';
    st.textContent = '.da-xsw{margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0;font-size:11.5px;font-weight:600;color:var(--text2)}' +
      '.da-xsw label{display:flex;align-items:center;gap:7px;cursor:pointer}.da-xsw input{display:none}' +
      '.da-xsw .trk{width:30px;height:17px;border-radius:9px;background:var(--surface2);border:1px solid var(--border);position:relative;transition:background .15s}' +
      '.da-xsw .trk::after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--text2);transition:transform .15s}' +
      '.da-xsw input:checked+.trk{background:var(--blue);border-color:var(--blue)}.da-xsw input:checked+.trk::after{transform:translateX(13px);background:#fff}' +
      '.da-xsw button{font:inherit;padding:3px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer}' +
      '.da-td-cell.da-cell-missing{box-shadow:2px 0 0 #f59e0b inset;background:rgba(245,158,11,.14)}' +
      '.da-td-select.da-cell-missing{box-shadow:0 0 0 2px #f59e0b inset}' +
      '.da-xdlg{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}' +
      '.da-xdlg>div{background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:18px;width:min(420px,92vw);display:flex;flex-direction:column;gap:9px;font-size:13px}' +
      '.da-xdlg select{padding:6px;border-radius:6px;background:var(--surface2);color:var(--text);border:1px solid var(--border)}.da-xdlg .row{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}';
    document.head.appendChild(st);
  }
  const box = document.createElement('div'); box.className = 'da-xsw';
  box.title = 'When on, tabs can read from each other: cross-tab formulas, lookups and connected columns';
  box.innerHTML = '<label><input type="checkbox" ' + (daState.interconnect ? 'checked' : '') + '><span class="trk"></span>Interconnect tables</label>' +
    (daState.interconnect ? '<button type="button">Connect columns\u2026</button>' : '');
  box.querySelector('input').onchange = (e) => daToggleInterconnect(e.target.checked);
  const b = box.querySelector('button'); if (b) b.onclick = daOpenLinkDialog;
  wrap.appendChild(box);
}
const _daRenderTabsBase = daRenderTabs;
daRenderTabs = function () { _daRenderTabsBase(); daInjectLinkSwitch(); };
function daOpenLinkDialog() {
  const ds = daState.datasets.find(d => d.id === daState.activeId);
  const others = daState.datasets.filter(d => d !== ds);
  if (!ds || !others.length) { if (typeof toast === 'function') toast('Add a second table first, then connect columns between them.', 'info'); return; }
  const colOpts = (t) => t.headers.map((h, i) => '<option value="' + i + '">' + daColToLetters(i) + ' \u00b7 ' + daEsc(h) + '</option>').join('');
  const ov = document.createElement('div'); ov.className = 'da-xdlg';
  ov.innerHTML = '<div><b>Connect columns</b><span style="color:var(--text2)">Pull data from another table into <b>' + daEsc(ds.name) + '</b>, matched by a shared column (like Customer ID).</span>' +
    '<label>Matching column in this table<select id="daXk">' + colOpts(ds) + '</select></label>' +
    '<label>Connect to table<select id="daXt">' + others.map(o => '<option value="' + o.id + '">' + daEsc(o.name) + '</option>').join('') + '</select></label>' +
    '<label>Its matching column<select id="daXtk"></select></label><div id="daXp" style="display:flex;flex-direction:column;gap:4px"></div>' +
    '<div class="row"><button type="button" id="daXc" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer">Cancel</button>' +
    '<button type="button" id="daXo" style="padding:6px 12px;border-radius:6px;border:0;background:var(--blue);color:#fff;cursor:pointer">Add connected columns</button></div></div>';
  document.body.appendChild(ov);
  const tgt = () => others.find(o => o.id === ov.querySelector('#daXt').value);
  const fill = () => {
    const t = tgt(); ov.querySelector('#daXtk').innerHTML = colOpts(t);
    ov.querySelector('#daXp').innerHTML = '<span style="color:var(--text2)">Columns to pull in:</span>' + t.headers.map((h, i) => '<label><input type="checkbox" value="' + i + '"> ' + daEsc(h) + '</label>').join('');
  };
  ov.querySelector('#daXt').onchange = fill; fill();
  ov.querySelector('#daXc').onclick = () => ov.remove();
  ov.querySelector('#daXo').onclick = () => {
    const t = tgt(), kc = +ov.querySelector('#daXk').value, tk = +ov.querySelector('#daXtk').value;
    const pulls = [...ov.querySelectorAll('#daXp input:checked')].map(i => +i.value).filter(i => i !== tk);
    if (!pulls.length) { if (typeof toast === 'function') toast('Tick at least one column to pull in.', 'info'); return; }
    const added = daApplyLink(ds, t, kc, tk, pulls); ov.remove();
    if (typeof toast === 'function') toast('Connected ' + added + ' column' + (added === 1 ? '' : 's') + ' from ' + t.name + '.', 'success');
  };
}
daInjectLinkSwitch();

// ─── Connected-column safeguards: live dropdown of valid keys + missing-key flag ───
let _daXSetCache = { t: 0, m: new Map() };
function daXKeySet(ds, link) {
  const now = Date.now();
  if (now - _daXSetCache.t > 80) _daXSetCache = { t: now, m: new Map() };
  const ck = ds.id + '|' + link.keyCol + '|' + link.toId;
  if (_daXSetCache.m.has(ck)) return _daXSetCache.m.get(ck);
  const t = daState.datasets.find(d => d.id === link.toId);
  let res = null;
  if (t && link.toCol < t.headers.length) {
    t._calcCache = new Map();
    res = { opts: [], keys: new Set() };
    t.rows.forEach((r, ri) => {
      const v = String(daFormulaDisplayValue(t, ri, link.toCol).display ?? '').trim();
      if (v !== '' && !res.keys.has(v.toLowerCase())) { res.keys.add(v.toLowerCase()); res.opts.push(v); }
    });
  }
  _daXSetCache.m.set(ck, res);
  return res;
}
function daXIsMissing(ds, ri, ci, val) {
  const v = String(val ?? '').trim();
  if (!daState.interconnect || !ds.xlinks || v === '' || v.startsWith('=')) return false;
  const link = ds.xlinks.find(l => l.keyCol === ci); if (!link) return false;
  const ks = daXKeySet(ds, link);
  return !!ks && !ks.keys.has(v.toLowerCase());
}
function daXSyncDropdowns() {
  daState.datasets.forEach(ds => {
    (ds.xlinks || []).forEach(l => {
      const ks = daXKeySet(ds, l); if (!ks || !ks.opts.length) return;
      daEnsureDropdownStore(ds);
      const opts = ks.opts.slice(0, 500);
      ds.colDropdowns[l.keyCol] = opts;
      ds.colDropdownColors[l.keyCol] = daAutoAssignDropdownColors(opts);
    });
  });
}
const _daRenderTableBase = daRenderTable;
daRenderTable = function () {
  if (daState.interconnect) { try { daXSyncDropdowns(); } catch (e) { console.warn('[Interconnect] dropdown sync failed', e); } }
  return _daRenderTableBase.apply(this, arguments);
};

// ─── Kadessa + auto-heal: shared link builder, da_link_tables helper, new-row fill ───
function daXPullFormula(t, kc, tk, pc, ri) {
  const N = 1048576 /* whole column: ranges are clamped to the table's real rows */, nm = "'" + t.name + "'", kL = daColToLetters(kc), tL = daColToLetters(tk), pL = daColToLetters(pc);
  return '=XLOOKUP(' + kL + (ri + 1) + ',' + nm + '!' + tL + '1:' + tL + N + ',' + nm + '!' + pL + '1:' + pL + N + ',"")';
}
function daApplyLink(ds, t, kc, tk, pulls) {
  const list = (ds.xlinks = ds.xlinks || []);
  let link = list.find(l => l.keyCol === kc && l.toId === t.id);
  if (!link) { link = { keyCol: kc, toId: t.id, toCol: tk, map: [] }; list.push(link); }
  link.map = link.map || [];
  let added = 0;
  pulls.forEach(pc => {
    if (link.map.some(m => m.theirs === pc)) return;
    ds.headers.push(t.headers[pc]);
    const ours = ds.headers.length - 1;
    ds.rows.forEach((r, ri) => { while (r.length < ours) r.push(''); r[ours] = daXPullFormula(t, kc, tk, pc, ri); });
    link.map.push({ ours, theirs: pc }); added++;
  });
  daState.interconnect = true;
  daState.datasets.forEach(d => { d._calcCache = new Map(); });
  daPersist(); daRenderTabs(); daRenderTable();
  return added;
}
function daXFindTable(name) {
  const w = String(name || '').trim().toLowerCase(); if (!w) return null;
  const ds = daState.datasets;
  return ds.find(d => d.name.trim().toLowerCase() === w) || ds.find(d => d.name.toLowerCase().startsWith(w)) || ds.find(d => d.name.toLowerCase().includes(w)) || null;
}
function daXFindCol(t, c) {
  if (typeof c === 'number') return (c >= 0 && c < t.headers.length) ? c : -1;
  const w = String(c == null ? '' : c).trim().toLowerCase();
  return w ? t.headers.findIndex(h => String(h).trim().toLowerCase() === w) : -1;
}
// Kadessa: connect a child table to a parent table by a shared key column.
function daKadessaLinkTables(p) {
  const ds = daXFindTable(p.table), t = daXFindTable(p.parentTable);
  if (!ds || !t) throw new Error('table not found: "' + (!ds ? p.table : p.parentTable) + '" (use the exact tab name)');
  if (ds === t) throw new Error('a table cannot be connected to itself');
  const kc = daXFindCol(ds, p.keyColumn), tk = daXFindCol(t, p.parentKeyColumn != null ? p.parentKeyColumn : p.keyColumn);
  if (kc < 0 || tk < 0) throw new Error('key column not found in "' + (kc < 0 ? ds.name : t.name) + '"');
  const pulls = (Array.isArray(p.pullColumns) ? p.pullColumns : []).map(n => daXFindCol(t, n)).filter(i => i >= 0 && i !== tk);
  return daApplyLink(ds, t, kc, tk, pulls);
}
// New rows: any empty connected cell gets its lookup formula automatically.
function daXHealRows() {
  let changed = false;
  daState.datasets.forEach(ds => (ds.xlinks || []).forEach(l => {
    const t = daState.datasets.find(d => d.id === l.toId); if (!t) return;
    (l.map || []).forEach(m => ds.rows.forEach((r, ri) => {
      if (String(r[m.ours] ?? '') === '') { while (r.length <= m.ours) r.push(''); r[m.ours] = daXPullFormula(t, l.keyCol, l.toCol, m.theirs, ri); changed = true; }
    }));
  }));
  if (changed) daPersist();
}
const _daRenderTableBase2 = daRenderTable;
daRenderTable = function () {
  if (daState.interconnect) { try { daXHealRows(); } catch (e) { console.warn('[Interconnect] row fill failed', e); } }
  return _daRenderTableBase2.apply(this, arguments);
};

// ─── Live exchange rates (opt-in) ───────────────────────────────────────
// Only called when the user clicks "Get Live Rates" — never automatically.
// Sends nothing but a request for public currency rates; no document data
// is transmitted. Source: Frankfurter (European Central Bank reference
// rates), free, no API key, no signup.
let daFxFetching = false;
async function daFetchExchangeRates() {
  if (daFxFetching) return;
  if (!daFxRates) {
    const ok = confirm('Get live currency rates from Frankfurter (api.frankfurter.dev), an exchange-rate service backed by the European Central Bank?\n\nOnly currency codes are sent — none of your document or spreadsheet data leaves your browser.');
    if (!ok) return;
  }
  daFxFetching = true;
  daUpdateRatesLabel('Fetching rates…');
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    const json = await res.json();
    daFxRates = { base: json.base || 'USD', date: json.date || '', rates: json.rates || {} };
    const activeDs = daGetActive();
    if (activeDs) { activeDs._calcCache = new Map(); daRenderTable(); }
    daUpdateRatesLabel('Rates as of ' + daFxRates.date + ' (base ' + daFxRates.base + ')');
    toast('Live exchange rates loaded. Use =CURRENCY(amount,"USD","INR") in any cell.', 'success');
  } catch (e) {
    daUpdateRatesLabel('Rates unavailable — try again');
    toast('Could not fetch exchange rates. Check your connection and try again.', 'error');
  } finally {
    daFxFetching = false;
  }
}
function daUpdateRatesLabel(text) {
  const el = document.getElementById('daFxRatesLabel');
  if (el) el.textContent = text;
}

// ─── Shared translation helper (opt-in) ─────────────────────────────────
// Used by the PDF Editor's "Translate" tool. Uses MyMemory Translation API:
// free, no signup, no API key required.
const SARVARC_LANG_HINTS = 'hi = Hindi, gu = Gujarati, mr = Marathi, ta = Tamil, te = Telugu, bn = Bengali, es = Spanish, fr = French, de = German, ar = Arabic, zh = Chinese, ja = Japanese';
async function sarvarcTranslateText(text, targetLang) {
  const q = (text || '').trim();
  if (!q) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q.slice(0, 490))}&langpair=en|${encodeURIComponent(targetLang)}`;
  // A hung request (blocked domain, dropped connection, slow DNS) used to
  // leave the caller's loop stuck on this one string forever — the
  // "Translating…" status would never clear and Push/Export/Print stayed
  // blocked indefinitely with no error ever shown. Cap every request at 12s
  // so a single bad string can't freeze the whole translation.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    console.error('sarvarcTranslateText fetch failed for "' + q.slice(0, 60) + '":', e);
    throw new Error(e && e.name === 'AbortError' ? 'Translation request timed out' : 'Translation request failed: ' + (e && e.message ? e.message : e));
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error('Translation request failed: ' + res.status);
  const json = await res.json();
  // MyMemory's free tier returns HTTP 200 even when it actually fails —
  // daily quota exhausted, bad language pair, etc. — it just stuffs a
  // warning message (or the untouched source text) into
  // responseData.translatedText instead of a real HTTP error. Left
  // unchecked, that warning/no-op text gets treated as a successful
  // translation and silently baked straight into the form, which is what
  // made translated output look completely untouched with no error
  // anywhere. responseStatus (a field INSIDE the JSON body, separate from
  // the HTTP status) is the real signal to check.
  const status = json && json.responseStatus;
  if (status != null && Number(status) !== 200) {
    console.error('sarvarcTranslateText: MyMemory responseStatus', status, 'for "' + q.slice(0, 60) + '"');
    throw new Error('Translation service returned status ' + status);
  }
  const translated = json && json.responseData && json.responseData.translatedText;
  if (!translated || /MYMEMORY WARNING/i.test(translated)) {
    console.error('sarvarcTranslateText: no usable translation for "' + q.slice(0, 60) + '"', json);
    throw new Error('No usable translation returned');
  }
  return translated;
}

// ─── Formula bar + fx picker + AutoSum ──────────────────────────────────
let daActiveCell = null; // { row, col } into the active dataset, or null

// ─── Smart fill (Excel-style drag handle) ────────────────────────────────
// daFillSeedRange: { col, r1, r2 } — set by shift+click to extend the
// "seed" used for pattern detection to more than one cell in a column.
// daFillDrag: { col, seedR1, seedR2, hoverRow } — live state while the
// handle itself is being dragged.
let daFillSeedRange = null;
let daFillDrag = null;

// ─── Selection (rows / columns / cell ranges) — the basis for highlighting
// & grouping. Independent of daActiveCell (which is just "where typing
// currently goes") and of daFillSeedRange/daFillDrag above (autofill only),
// so none of this touches that existing behavior.
//   daSelection.rows        Set<rowIdx>   whole rows selected
//   daSelection.cols        Set<colIdx>   whole columns selected
//   daSelection.cellRanges  [{r1,c1,r2,c2}, ...]  one or more rectangular
//                           cell blocks (drag-select, or Ctrl/Cmd+click to
//                           add a non-contiguous extra block)
let daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
let daRowAnchor = null;   // last row clicked, for Shift+click range-extend
let daColAnchor = null;   // last column clicked, for Shift+click range-extend
let daCellDrag = null;    // { r1, c1, idx } anchor + which cellRanges entry is being dragged
let daSelectionDsId = null; // which dataset the current selection belongs to
// Fixed corner while extending a cell-range selection with Shift+Arrow
// keys (see daHandleCellKeydown below) -- separate from daActiveCell,
// which tracks the moving edge instead. Cleared by any direct click
// (daCellMouseDown / daCellRangeMouseDown / daSelectRow / daSelectCol /
// daClearSelection) so a fresh click always starts a brand-new range
// rather than continuing wherever the keyboard last left off.
let daShiftAnchor = null;

function daClearSelection() {
  daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
  daRowAnchor = null; daColAnchor = null; daShiftAnchor = null;
  daRenderTable();
}

function daHasSelection() {
  return daSelection.rows.size > 0 || daSelection.cols.size > 0 || daSelection.cellRanges.length > 0;
}

function daIsRowSelected(ri) { return daSelection.rows.has(ri); }
function daIsColSelected(ci) { return daSelection.cols.has(ci); }
function daIsCellSelected(ri, ci) {
  if (daSelection.rows.has(ri) || daSelection.cols.has(ci)) return true;
  return daSelection.cellRanges.some(rg => ri >= rg.r1 && ri <= rg.r2 && ci >= rg.c1 && ci <= rg.c2);
}

// Click a row number to select that whole row. Shift+click extends a
// contiguous range from the last-clicked row; Ctrl/Cmd+click toggles a row
// into (or out of) a non-contiguous multi-row selection.
function daSelectRow(ri, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  daShiftAnchor = null;
  if (e && (e.ctrlKey || e.metaKey)) {
    if (daSelection.rows.has(ri)) daSelection.rows.delete(ri); else daSelection.rows.add(ri);
  } else if (e && e.shiftKey && daRowAnchor !== null) {
    const lo = Math.min(daRowAnchor, ri), hi = Math.max(daRowAnchor, ri);
    for (let r = lo; r <= hi; r++) daSelection.rows.add(r);
  } else {
    daSelection = { rows: new Set([ri]), cols: new Set(), cellRanges: [] };
  }
  daRowAnchor = ri;
  daRenderTable();
}

// Same idea, for a column letter in the ruler row.
function daSelectCol(ci, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  daShiftAnchor = null;
  if (e && (e.ctrlKey || e.metaKey)) {
    if (daSelection.cols.has(ci)) daSelection.cols.delete(ci); else daSelection.cols.add(ci);
  } else if (e && e.shiftKey && daColAnchor !== null) {
    const lo = Math.min(daColAnchor, ci), hi = Math.max(daColAnchor, ci);
    for (let c = lo; c <= hi; c++) daSelection.cols.add(c);
  } else {
    daSelection = { rows: new Set(), cols: new Set([ci]), cellRanges: [] };
  }
  daColAnchor = ci;
  daRenderTable();
}

// Starts a rectangular cell-range selection by dragging across cells.
// Plain click does NOT paint a standalone "selected" box on the anchor
// cell -- the native :focus outline on the cell itself already shows
// which cell is active, exactly like Excel/Sheets (click once, see ONE
// box). A highlighted range only appears once the drag actually reaches a
// DIFFERENT cell (see daCellRangeMouseEnter below), so a plain click that
// never drags leaves daSelection empty. Ctrl/Cmd+click is the one
// exception -- it's explicitly asking to mark this one cell as its own
// standalone selected block (e.g. to tag/highlight it), so that still
// gets its 1x1 range immediately. Shift+click is left alone entirely —
// that gesture is already claimed by the autofill seed-range above.
function daCellRangeMouseDown(e, ri, ci) {
  if (e.shiftKey) return;
  daShiftAnchor = null;
  if (e.ctrlKey || e.metaKey) {
    daSelection.cellRanges.push({ r1: ri, c1: ci, r2: ri, c2: ci });
    daCellDrag = { r1: ri, c1: ci, idx: daSelection.cellRanges.length - 1 };
  } else {
    daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
    daCellDrag = { r1: ri, c1: ci, idx: -1 }; // -1: no range committed yet -- see daCellRangeMouseEnter
  }
  // Don't touch the DOM in this same synchronous handler. The browser's
  // own "focus whatever the mouse went down on" default action hasn't run
  // yet at this point -- it fires right after this handler returns, and it
  // needs the ORIGINAL clicked node to still be attached and untouched to
  // do its normal job (focus it, place the caret). If we rebuild the grid
  // (daRenderTable) here, that node gets torn out from under the browser
  // mid-flight, and the focus/blur sequence that follows ends up fighting
  // our own explicit focus() call -- which is what made a click seem to
  // focus a cell for an instant and then immediately kick you back out of
  // it, unable to type. Deferring one tick lets the browser's natural
  // focus land first (on the still-intact original node) exactly like a
  // plain contenteditable click always has; THEN we rebuild the grid to
  // reflect the selection change and re-focus the freshly-rendered node by
  // id (since the rebuild detaches the node the browser just focused).
  setTimeout(() => {
    daRenderTable();
    const dsNow = daGetActive();
    if (dsNow) {
      const el = document.getElementById(`daCell_${dsNow.id}_${ri}_${ci}`);
      if (el && typeof el.focus === 'function') el.focus();
    }
  }, 0);
}

// FIX: dropdown cells (real <select> elements) were wired to the exact
// same onmousedown as a plain contenteditable cell -- daCellRangeMouseDown
// above, whose whole point is to defer a full daRenderTable() rebuild by
// one tick so a contenteditable's own native focus/caret behavior lands on
// the still-intact original node first. That deferred rebuild is harmless
// for a contenteditable div, but a native <select> opens its options
// popup as PART OF the browser's own handling of this same mousedown --
// and when the setTimeout fires a moment later, daRenderTable() replaces
// the entire grid's innerHTML, tearing out the very <select> node the
// browser just opened a popup against. The popup then either never shows
// or closes itself immediately, and nothing in it is clickable -- which is
// exactly "I can't open the dropdown or select anything" for any
// dropdown cell, Kadessa-created or manual.
//
// The fix is to give dropdown cells their own mousedown handler that keeps
// the same range/multi-select bookkeeping (ctrl/cmd-click adds a range,
// shift-click is left to the browser, a plain click resets the selection)
// but never touches the DOM. daCellFocus (already wired to the select's
// onfocus, which fires right after this as part of the same native click)
// still updates daActiveCell and the formula bar without rebuilding
// anything, so the popup the browser is opening is left completely alone.
function daDropdownCellMouseDown(e, ri, ci) {
  if (e.shiftKey) return;
  daShiftAnchor = null;
  if (e.ctrlKey || e.metaKey) {
    daSelection.cellRanges.push({ r1: ri, c1: ci, r2: ri, c2: ci });
    daCellDrag = { r1: ri, c1: ci, idx: daSelection.cellRanges.length - 1 };
  } else {
    daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
    daCellDrag = { r1: ri, c1: ci, idx: -1 };
  }
  // Deliberately no daRenderTable() here -- see above.
}

// Fires (cheaply, via onmouseenter — a no-op when nothing is being
// dragged) as the mouse moves over other cells while a range drag is live,
// growing the active range to cover the rectangle between the drag's
// anchor and the cell now under the pointer. The anchor cell only turns
// into an actual highlighted range the first time the drag reaches a
// DIFFERENT cell (idx === -1 below) -- a click that never drags anywhere
// stays a single focused cell with no separate selection box.
function daCellRangeMouseEnter(ri, ci) {
  if (!daCellDrag) return;
  if (daCellDrag.idx === -1) {
    if (ri === daCellDrag.r1 && ci === daCellDrag.c1) return; // still sitting on the anchor cell -- not a drag yet
    daSelection.cellRanges.push({ r1: daCellDrag.r1, c1: daCellDrag.c1, r2: daCellDrag.r1, c2: daCellDrag.c1 });
    daCellDrag.idx = daSelection.cellRanges.length - 1;
  }
  const active = daSelection.cellRanges[daCellDrag.idx];
  if (!active) return;
  const nr1 = Math.min(daCellDrag.r1, ri), nr2 = Math.max(daCellDrag.r1, ri);
  const nc1 = Math.min(daCellDrag.c1, ci), nc2 = Math.max(daCellDrag.c1, ci);
  if (active.r1 === nr1 && active.r2 === nr2 && active.c1 === nc1 && active.c2 === nc2) return;
  active.r1 = nr1; active.r2 = nr2; active.c1 = nc1; active.c2 = nc2;
  daRenderTable();
  // Same detached-node problem as above: this rebuild can knock real focus
  // off the anchor cell mid-drag. Put it back so releasing the mouse and
  // immediately typing or arrow-key-navigating still works.
  const dsDrag = daGetActive();
  if (dsDrag) {
    const anchorEl = document.getElementById(`daCell_${dsDrag.id}_${daCellDrag.r1}_${daCellDrag.c1}`);
    if (anchorEl && typeof anchorEl.focus === 'function' && document.activeElement !== anchorEl) anchorEl.focus();
  }
}

document.addEventListener('mouseup', () => { daCellDrag = null; });

function daCellMouseDown(e, ri, ci) {
  if (e.shiftKey && daActiveCell && daActiveCell.col === ci) {
    daFillSeedRange = { col: ci, r1: Math.min(daActiveCell.row, ri), r2: Math.max(daActiveCell.row, ri) };
    e.preventDefault();
    daFillPlaceHandle();
    return;
  }
  if (daFillSeedRange && !(daFillSeedRange.col === ci && ri >= daFillSeedRange.r1 && ri <= daFillSeedRange.r2)) {
    daFillSeedRange = null;
  }
  daCellRangeMouseDown(e, ri, ci);
}

// Redraws the seed-range outline and (re)places the single fill-handle DOM
// node at the bottom-right corner of the relevant cell. Cheap enough to
// call on every focus change since it only touches a handful of nodes,
// not the whole table.
function daFillPlaceHandle() {
  const gridWrap = document.getElementById('daGridWrap');
  if (!gridWrap) return;
  gridWrap.querySelectorAll('.da-fill-handle').forEach(el => el.remove());
  gridWrap.querySelectorAll('.da-fill-seedcell').forEach(el => el.classList.remove('da-fill-seedcell'));
  const ds = daGetActive();
  if (!ds) return;
  let col, r1, r2;
  if (daFillSeedRange) { col = daFillSeedRange.col; r1 = daFillSeedRange.r1; r2 = daFillSeedRange.r2; }
  else if (daActiveCell) { col = daActiveCell.col; r1 = r2 = daActiveCell.row; }
  else return;
  if (r1 < 0 || r2 < 0 || r2 >= ds.rows.length) return;
  for (let r = r1; r <= r2; r++) {
    const td = gridWrap.querySelector(`td[data-r="${r}"][data-c="${col}"]`);
    if (td) td.classList.add('da-fill-seedcell');
  }
  const handleTd = gridWrap.querySelector(`td[data-r="${r2}"][data-c="${col}"]`);
  if (!handleTd || handleTd.querySelector('select')) return; // dropdown cells aren't fillable
  const handle = document.createElement('div');
  handle.className = 'da-fill-handle';
  handle.title = 'Drag down to fill a sequence';
  handle.addEventListener('mousedown', (ev) => daFillHandleMouseDown(ev, col, r1, r2));
  handleTd.appendChild(handle);
}

function daFillHandleMouseDown(e, col, r1, r2) {
  e.preventDefault();
  e.stopPropagation();
  const ds = daGetActive(); if (!ds) return;
  // Commit whatever's currently being typed into the seed cell (if any)
  // before we read ds.rows for it during the drag.
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  daFillDrag = { col, seedR1: r1, seedR2: r2, hoverRow: r2 };
  document.addEventListener('mousemove', daFillHandleMouseMove);
  document.addEventListener('mouseup', daFillHandleMouseUp);
}

function daFillHandleMouseMove(e) {
  if (!daFillDrag) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const td = el && el.closest && el.closest('td[data-r]');
  if (!td) return;
  const ds = daGetActive(); if (!ds) return;
  const r = +td.dataset.r, c = +td.dataset.c;
  if (c !== daFillDrag.col) return; // only vertical (down-the-column) fill is supported
  const clamped = Math.max(daFillDrag.seedR2, Math.min(r, ds.rows.length - 1));
  if (clamped === daFillDrag.hoverRow) return;
  daFillDrag.hoverRow = clamped;
  daFillUpdatePreview();
}

function daFillUpdatePreview() {
  document.querySelectorAll('#daGridWrap .da-fill-preview').forEach(td => td.classList.remove('da-fill-preview'));
  if (!daFillDrag) return;
  const { col, seedR2, hoverRow } = daFillDrag;
  for (let r = seedR2 + 1; r <= hoverRow; r++) {
    const td = document.querySelector(`#daGridWrap td[data-r="${r}"][data-c="${col}"]`);
    if (td) td.classList.add('da-fill-preview');
  }
}

function daFillHandleMouseUp() {
  document.removeEventListener('mousemove', daFillHandleMouseMove);
  document.removeEventListener('mouseup', daFillHandleMouseUp);
  const drag = daFillDrag;
  daFillDrag = null;
  document.querySelectorAll('#daGridWrap .da-fill-preview').forEach(td => td.classList.remove('da-fill-preview'));
  if (!drag) return;
  const { col, seedR1, seedR2, hoverRow } = drag;
  if (hoverRow <= seedR2) return; // no real drag happened
  const ds = daGetActive(); if (!ds) return;
  const seedVals = [];
  for (let r = seedR1; r <= seedR2; r++) seedVals.push(ds.rows[r][col]);
  const count = hoverRow - seedR2;
  const filled = daFillGenerateSeries(seedVals, count);
  for (let i = 0; i < count; i++) ds.rows[seedR2 + 1 + i][col] = filled[i];
  daFillSeedRange = { col, r1: seedR1, r2: hoverRow }; // lets the user keep dragging further
  daRecalcColumnOps(ds);
  daRenderTable();
  toast(`Filled ${count} cell${count === 1 ? '' : 's'} down the column`, 'success');
}

// ── Series detection (Excel/Sheets-style autofill) ────────────────────────
const DA_FILL_DOW_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DA_FILL_DOW_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DA_FILL_MON_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DA_FILL_MON_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function daFillCaseStyleOf(txt) {
  if (txt === txt.toUpperCase() && txt !== txt.toLowerCase()) return 'upper';
  if (txt === txt.toLowerCase()) return 'lower';
  return 'cap'; // Title-case / Capitalized, e.g. "Monday", "Jan"
}
function daFillApplyCase(name, style) {
  if (style === 'upper') return name.toUpperCase();
  if (style === 'lower') return name.toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function daFillMatchNameIndex(txt, listFull, listAbbr) {
  const lower = txt.trim().toLowerCase();
  let idx = listFull.indexOf(lower);
  if (idx >= 0) return idx;
  if (lower.length === 3) { idx = listAbbr.indexOf(lower); if (idx >= 0) return idx; }
  return -1;
}

function daFillMonthIdx(txt) {
  return daFillMatchNameIndex(txt, DA_FILL_MON_FULL, DA_FILL_MON_ABBR);
}

// Parses a single date-like cell value into { y, mo, d, fmt } where fmt
// captures enough about the original layout (separator, digit padding,
// 2 vs 4-digit year, month-as-number vs month-name) to regenerate more
// dates that look like the one the user actually typed.
function daFillParseDate(raw) {
  const s = String(raw || '').trim();
  let m;
  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  if ((m = /^(\d{4})([-\/.])(\d{1,2})\2(\d{1,2})$/.exec(s))) {
    return { y: +m[1], mo: +m[3], d: +m[4], fmt: { type: 'ymd', sep: m[2], moPad: m[3].length === 2, dPad: m[4].length === 2 } };
  }
  // DD-MM-YYYY or MM-DD-YYYY (4-digit year) — defaults to day-first when ambiguous
  if ((m = /^(\d{1,2})([-\/.])(\d{1,2})\2(\d{4})$/.exec(s))) {
    const a = +m[1], b = +m[3], y = +m[4];
    let dayFirst = true;
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    const d = dayFirst ? a : b, mo = dayFirst ? b : a;
    return { y, mo, d, fmt: { type: 'dmy_num', sep: m[2], dayFirst, aPad: m[1].length === 2, bPad: m[3].length === 2, yLen: 4 } };
  }
  // Same but a 2-digit year
  if ((m = /^(\d{1,2})([-\/.])(\d{1,2})\2(\d{2})$/.exec(s))) {
    const a = +m[1], b = +m[3], yy = +m[4];
    const y = yy + (yy < 70 ? 2000 : 1900);
    let dayFirst = true;
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    const d = dayFirst ? a : b, mo = dayFirst ? b : a;
    return { y, mo, d, fmt: { type: 'dmy_num', sep: m[2], dayFirst, aPad: m[1].length === 2, bPad: m[3].length === 2, yLen: 2 } };
  }
  // "15-Jan-2023", "15 Jan 2023", "1st Jan 2025"
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?([-\s])([A-Za-z]{3,9})[-\s.,]+(\d{2,4})$/.exec(s))) {
    const idx = daFillMonthIdx(m[3]);
    if (idx >= 0) {
      const yRaw = m[4], y = yRaw.length <= 2 ? (+yRaw + (+yRaw < 70 ? 2000 : 1900)) : +yRaw;
      return { y, mo: idx + 1, d: +m[1], fmt: { type: 'dmon_y', sep: m[2], monLen: m[3].length <= 3 ? 3 : 'full', monCase: daFillCaseStyleOf(m[3]), yLen: yRaw.length, dPad: m[1].length === 2 } };
    }
  }
  // "Jan 15, 2023", "January 15 2023"
  if ((m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/.exec(s))) {
    const idx = daFillMonthIdx(m[1]);
    if (idx >= 0) {
      const yRaw = m[3], y = yRaw.length <= 2 ? (+yRaw + (+yRaw < 70 ? 2000 : 1900)) : +yRaw;
      return { y, mo: idx + 1, d: +m[2], fmt: { type: 'mon_d_y', monLen: m[1].length <= 3 ? 3 : 'full', monCase: daFillCaseStyleOf(m[1]), yLen: yRaw.length, dPad: m[2].length === 2 } };
    }
  }
  return null;
}

function daFillFormatDate(y, mo, d, fmt) {
  const pad2 = n => String(n).padStart(2, '0');
  const yStr = fmt.yLen === 2 ? String(((y % 100) + 100) % 100).padStart(2, '0') : String(y);
  const dStr = fmt.dPad === false ? String(d) : pad2(d);
  const monName = () => {
    let name = fmt.monLen === 'full' ? DA_FILL_MON_FULL[mo - 1] : DA_FILL_MON_ABBR[mo - 1];
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return daFillApplyCase(name, fmt.monCase);
  };
  switch (fmt.type) {
    case 'ymd': return `${yStr}${fmt.sep}${fmt.moPad === false ? String(mo) : pad2(mo)}${fmt.sep}${dStr}`;
    case 'dmy_num': return fmt.dayFirst
      ? `${dStr}${fmt.sep}${fmt.bPad === false ? String(mo) : pad2(mo)}${fmt.sep}${yStr}`
      : `${fmt.aPad === false ? String(mo) : pad2(mo)}${fmt.sep}${dStr}${fmt.sep}${yStr}`;
    case 'dmon_y': return `${dStr}${fmt.sep}${monName()}${fmt.sep}${yStr}`;
    case 'mon_d_y': return `${monName()} ${dStr}, ${yStr}`;
    default: return `${yStr}-${pad2(mo)}-${dStr}`;
  }
}

function daFillDaysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000);
}

// Given the seed cell value(s) (one cell, or several from a shift-selected
// range) and how many more cells need filling, returns the next `count`
// values — mirroring Excel/Sheets' click-and-drag autofill: dates advance
// by the day-delta between seeds (default 1 day), plain numbers and
// "Item 3"-style text step by their numeric delta (default 1, padding
// preserved), weekday/month names cycle, and anything unrecognized either
// continues the given pattern or is simply repeated.
function daFillGenerateSeries(seedVals, count) {
  const vals = seedVals.map(v => String(v ?? '').trim());
  const n = vals.length;
  const out = [];

  // Weekday names
  {
    const idxs = vals.map(v => daFillMatchNameIndex(v, DA_FILL_DOW_FULL, DA_FILL_DOW_ABBR));
    if (idxs.every(i => i >= 0)) {
      const isAbbr = vals[n - 1].length === 3;
      const caseStyle = daFillCaseStyleOf(vals[n - 1]);
      let step = 1;
      if (n >= 2) step = (((idxs[n - 1] - idxs[n - 2]) % 7) + 7) % 7 || 1;
      let cur = idxs[n - 1];
      for (let i = 0; i < count; i++) { cur = ((cur + step) % 7 + 7) % 7; out.push(daFillApplyCase(isAbbr ? DA_FILL_DOW_ABBR[cur] : DA_FILL_DOW_FULL[cur], caseStyle)); }
      return out;
    }
  }
  // Month names
  {
    const idxs = vals.map(v => daFillMonthIdx(v));
    if (idxs.every(i => i >= 0)) {
      const isAbbr = vals[n - 1].length === 3;
      const caseStyle = daFillCaseStyleOf(vals[n - 1]);
      let step = 1;
      if (n >= 2) step = (((idxs[n - 1] - idxs[n - 2]) % 12) + 12) % 12 || 1;
      let cur = idxs[n - 1];
      for (let i = 0; i < count; i++) { cur = ((cur + step) % 12 + 12) % 12; out.push(daFillApplyCase(isAbbr ? DA_FILL_MON_ABBR[cur] : DA_FILL_MON_FULL[cur], caseStyle)); }
      return out;
    }
  }
  // Dates (this covers "09-09-2002" -> 10, 11, 12, 13...)
  {
    const parsed = vals.map(daFillParseDate);
    if (parsed.every(Boolean)) {
      let step = 1;
      if (n >= 2) step = daFillDaysBetween(parsed[n - 2], parsed[n - 1]) || 1;
      const fmt = parsed[n - 1].fmt;
      let y = parsed[n - 1].y, mo = parsed[n - 1].mo, d = parsed[n - 1].d;
      for (let i = 0; i < count; i++) {
        const dt = new Date(Date.UTC(y, mo - 1, d));
        dt.setUTCDate(dt.getUTCDate() + step);
        y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate();
        out.push(daFillFormatDate(y, mo, d, fmt));
      }
      return out;
    }
  }
  // Decimal numbers
  if (vals.every(v => /^-?\d+\.\d+$/.test(v))) {
    const nums = vals.map(Number);
    const decimals = (vals[n - 1].split('.')[1] || '').length;
    let step = 1;
    if (n >= 2) step = nums[n - 1] - nums[n - 2];
    let cur = nums[n - 1];
    for (let i = 0; i < count; i++) { cur += step; out.push(cur.toFixed(decimals)); }
    return out;
  }
  // Plain integers (zero-padding preserved, e.g. "007" -> "008")
  if (vals.every(v => /^-?\d+$/.test(v))) {
    const nums = vals.map(Number);
    const last = vals[n - 1];
    const padLen = (/^0/.test(last) && last.replace('-', '').length > 1) ? last.replace('-', '').length : 0;
    let step = 1;
    if (n >= 2) step = nums[n - 1] - nums[n - 2];
    let cur = nums[n - 1];
    for (let i = 0; i < count; i++) {
      cur += step;
      out.push(padLen ? (cur < 0 ? '-' : '') + String(Math.abs(cur)).padStart(padLen, '0') : String(cur));
    }
    return out;
  }
  // Text with a trailing number, e.g. "Item 1", "Q1", "Row-007"
  {
    const lastM = /^(.*?)(\d+)([^\d]*)$/.exec(vals[n - 1]);
    if (lastM) {
      let step = 1;
      if (n >= 2) {
        const prevM = /^(.*?)(\d+)([^\d]*)$/.exec(vals[n - 2]);
        if (prevM && prevM[1] === lastM[1] && prevM[3] === lastM[3]) step = (+lastM[2]) - (+prevM[2]);
      }
      const padLen = (/^0/.test(lastM[2]) && lastM[2].length > 1) ? lastM[2].length : 0;
      let cur = +lastM[2];
      for (let i = 0; i < count; i++) {
        cur += step;
        const numStr = padLen ? String(Math.max(cur, 0)).padStart(padLen, '0') : String(cur);
        out.push(lastM[1] + numStr + lastM[3]);
      }
      return out;
    }
  }
  // No recognizable pattern: cycle the given values (Excel's behavior for a
  // multi-cell seed), or just repeat the single seed value.
  for (let i = 0; i < count; i++) out.push(vals[n > 1 ? (i % n) : 0]);
  return out;
}

function daPlaceCaretEnd(el) {
  if (typeof window.getSelection === 'undefined' || typeof document.createRange === 'undefined') return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function daCellFocus(el, ri, ci) {
  const ds = daGetActive(); if (!ds) return;
  daActiveCell = { row: ri, col: ci };
  const raw = String((ds.rows[ri] || [])[ci] ?? '');
  // Dropdown cells are real <select> elements, not contenteditable text —
  // rewriting textContent would blow away their <option> list, and there's
  // no caret to place, so only the free-typed text cells get this treatment.
  if (el.tagName !== 'SELECT') {
    el.textContent = raw;
    daPlaceCaretEnd(el);
  }
  daUpdateFormulaBar(ri, ci, raw);
  daFillPlaceHandle();
}

// Shared keydown handler for every grid cell (both contenteditable text
// cells and <select> dropdown cells) -- wired via onkeydown so Enter-to-
// commit, plain-Arrow navigation, and Shift+Arrow range-select all behave
// the same everywhere.
//
// Plain Arrow (no Shift) moves the active cell one step in that direction,
// clamped to the table's edges -- click any cell, then the arrows just
// drive you around the grid from there, same as a normal spreadsheet.
// Precise mid-text cursor editing still works fine through the formula
// bar input above the grid, which is a real <input> and isn't touched by
// this handler at all.
//
// Shift+Arrow instead grows a rectangular cellRanges selection one cell at
// a time from wherever the user last clicked (daShiftAnchor, the fixed
// corner), moving focus along with the growing edge -- same feel as
// Excel/Sheets. The anchor persists across repeated presses so "click a
// cell, hold shift, tap Down three times" grows one continuous range
// instead of resetting each time; it only clears on a fresh direct click
// (see the daShiftAnchor resets in daSelectRow/daSelectCol/
// daCellRangeMouseDown/daClearSelection above) or a plain (non-Shift)
// arrow move, which starts fresh from wherever you land.
function daHandleCellKeydown(e, ri, ci) {
  // Spreadsheet-style Tab / Enter navigation:
  //   Tab -> next cell (wraps to the first cell of the next row)
  //   Shift+Tab -> previous cell (wraps to the last cell of the previous row)
  //   Enter -> cell below, Shift+Enter -> cell above
  if (e.key === 'Tab' || e.key === 'Enter') {
    const dsN = daGetActive();
    e.preventDefault();
    if (!dsN) return;
    const nRows = dsN.rows.length, nCols = dsN.headers.length;
    let r = ri, c = ci;
    if (e.key === 'Tab') {
      c += e.shiftKey ? -1 : 1;
      if (c >= nCols) { c = 0; r++; }
      if (c < 0) { c = nCols - 1; r--; }
    } else {
      r += e.shiftKey ? -1 : 1;
    }
    if (r < 0 || r >= nRows) {   // off the edge: just commit and stay put
      if (e.target && typeof e.target.blur === 'function') e.target.blur();
      return;
    }
    daShiftAnchor = null;
    if (daHasSelection()) daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
    if (e.target && typeof e.target.blur === 'function') e.target.blur();
    daRenderTable();
    const tgt = document.getElementById(`daCell_${dsN.id}_${r}_${c}`);
    if (tgt && typeof tgt.focus === 'function') tgt.focus();
    return;
  }

  const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const dir = dirs[e.key];
  if (!dir) return;

  const ds = daGetActive(); if (!ds) return;
  e.preventDefault();
  const [dr, dc] = dir;
  const newRow = Math.max(0, Math.min(ds.rows.length - 1, ri + dr));
  const newCol = Math.max(0, Math.min(ds.headers.length - 1, ci + dc));

  if (e.shiftKey) {
    if (!daShiftAnchor) daShiftAnchor = { row: ri, col: ci };
    daSelection = {
      rows: new Set(), cols: new Set(),
      cellRanges: [{
        r1: Math.min(daShiftAnchor.row, newRow), c1: Math.min(daShiftAnchor.col, newCol),
        r2: Math.max(daShiftAnchor.row, newRow), c2: Math.max(daShiftAnchor.col, newCol)
      }]
    };
  } else {
    // Plain navigation starts fresh -- it replaces any existing
    // highlight-style selection, same as a plain click on the destination
    // cell would.
    daShiftAnchor = null;
    if (daHasSelection()) daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
  }

  if (newRow === ri && newCol === ci) { daRenderTable(); return; } // already at the edge -- nothing to move to, just refresh in case the selection changed

  // Commit whatever's in the cell we're leaving BEFORE rebuilding the
  // grid, so onblur's own daUpdateCell/daRenderTable runs first -- then we
  // grab the destination cell from the freshly-rendered DOM rather than a
  // reference that render would otherwise have torn out from under us.
  if (e.target && typeof e.target.blur === 'function') e.target.blur();
  daRenderTable();
  const nextEl = document.getElementById(`daCell_${ds.id}_${newRow}_${newCol}`);
  if (nextEl && typeof nextEl.focus === 'function') nextEl.focus();
}

function daUpdateFormulaBar(ri, ci, raw) {
  const refEl = document.getElementById('daFormulaBarRef');
  const inputEl = document.getElementById('daFormulaBarInput');
  if (refEl) refEl.textContent = daColToLetters(ci) + (ri + 1);
  if (inputEl) { inputEl.disabled = false; inputEl.value = raw; }
}

function daResetFormulaBar() {
  daActiveCell = null;
  daFillSeedRange = null;
  const refEl = document.getElementById('daFormulaBarRef');
  const inputEl = document.getElementById('daFormulaBarInput');
  if (refEl) refEl.textContent = '–';
  if (inputEl) { inputEl.value = ''; inputEl.disabled = true; }
  daFillPlaceHandle();
}

function daFormulaBarInputChanged() {
  // Live-typing here doesn't touch the grid until commit (Enter/blur), so a
  // half-typed formula never gets treated as the real cell value.
}

function daFormulaBarCommit(refocusGrid) {
  if (!daActiveCell) return;
  const inputEl = document.getElementById('daFormulaBarInput');
  if (!inputEl) return;
  const { row, col } = daActiveCell;
  daUpdateCell(row, col, inputEl.value);
  const ds = daGetActive();
  if (ds) daUpdateFormulaBar(row, col, String((ds.rows[row] || [])[col] ?? ''));
  if (refocusGrid) inputEl.blur();
}

function daToggleFxMenu(e) {
  if (e) e.stopPropagation();
  const pop = document.getElementById('daFxPopover');
  if (!pop) return;
  const willOpen = !pop.classList.contains('open');
  if (willOpen) {
    pop.innerHTML = DA_FUNCTIONS.map(f =>
      `<div class="da-fx-item" onclick="daInsertFunction('${f.name}')">
        <span class="da-fx-name">${f.name}</span>
        <span class="da-fx-syntax">${daEsc(f.syntax)}</span>
        <span class="da-fx-desc">${daEsc(f.desc)}</span>
      </div>`).join('');
  }
  pop.classList.toggle('open', willOpen);
}
document.addEventListener('click', function(e) {
  const pop = document.getElementById('daFxPopover');
  const btn = document.getElementById('daFxBtn');
  if (pop && pop.classList.contains('open') && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
    pop.classList.remove('open');
  }
});

function daInsertFunction(name) {
  const pop = document.getElementById('daFxPopover');
  if (pop) pop.classList.remove('open');
  if (!daActiveCell) { toast('Click a cell first, then pick a function to insert', 'info'); return; }
  const inputEl = document.getElementById('daFormulaBarInput');
  if (!inputEl) return;
  let cur = inputEl.value || '';
  if (!cur.trim().startsWith('=')) cur = '=';
  cur += name + '(';
  inputEl.value = cur;
  inputEl.focus();
}

// Excel-style AutoSum: sums every numeric cell above the active cell in the
// same column, e.g. clicking B6 and hitting AutoSum drops in =SUM(B1:B5).
function daAutoSum() {
  if (!daActiveCell) { toast('Click a cell first, then AutoSum', 'info'); return; }
  const ds = daGetActive(); if (!ds) return;
  const { row, col } = daActiveCell;
  if (row <= 0) { toast('Need at least one row above this cell to sum', 'info'); return; }
  const colLetter = daColToLetters(col);
  const formula = `=SUM(${colLetter}1:${colLetter}${row})`;
  daUpdateCell(row, col, formula);
  daUpdateFormulaBar(row, col, formula);
  toast(`Added ${formula}`, 'success');
}

// A row counts as a reusable "totals" row when every text-type column in it
// is blank — i.e. it only ever holds numbers dropped in by daColumnOp below,
// never a real record. That's what lets +, then × on another column, land
// in the same bottom row instead of spawning a new one each click.
function daIsTotalsRow(ds, ri) {
  const row = ds.rows[ri];
  if (!row) return false;
  return ds.headers.every((_, ci) => daIsNumericCol(ds, ci) || String(row[ci] ?? '').trim() === '');
}

function daFormatResultNumber(n) {
  if (!isFinite(n)) return String(n);
  // Round off float noise (e.g. 0.1 + 0.2) without mangling real decimals.
  return String(Math.round(n * 1e6) / 1e6);
}

// Reads every numeric value currently in a column, skipping any row that
// counts as the shared totals row (so a column's own running result never
// folds into itself) and, optionally, one extra row index to exclude (used
// during recalculation, where that row IS the totals row being written to).
function daGatherColumnValues(ds, colIdx, excludeRowIdx) {
  const values = [];
  ds.rows.forEach((row, ri) => {
    if (ri === excludeRowIdx) return;
    if (daIsTotalsRow(ds, ri)) return;
    const raw = String(row[colIdx] ?? '');
    if (raw.trim() === '') return;
    let v;
    if (raw.trim().startsWith('=')) {
      const res = daFormulaDisplayValue(ds, ri, colIdx);
      if (res.isError) return;
      v = parseFloat(daCleanNum(String(res.display)));
    } else {
      v = parseFloat(daCleanNum(raw));
    }
    if (!isNaN(v)) values.push(v);
  });
  return values;
}

// Pure math for a gathered value list. Returns null when the op can't be
// computed (empty list, or a divide-by-zero partway through).
function daComputeOpResult(values, op) {
  if (!values.length) return null;
  if (op === '+') return values.reduce((s, v) => s + v, 0);
  if (op === '*') return values.reduce((s, v) => s * v, 1);
  if (op === '-') return values.reduce((s, v, i) => i === 0 ? v : s - v);
  if (op === 'avg') return values.reduce((s, v) => s + v, 0) / values.length;
  if (op === '/') {
    if (values.slice(1).some(v => v === 0)) return null;
    return values.reduce((s, v, i) => i === 0 ? v : s / v);
  }
  return null;
}

// Tiny per-column quick-math, triggered by the +/−/×/÷/AVG buttons under a
// numeric column's header. Clicking one "arms" that column: from then on the
// chosen operation is remembered (ds.colOps) and kept live in the shared
// totals row automatically, any time a row is added, deleted, or a cell
// edited — no need to re-click after every change. Clicking the same,
// already-active button again turns auto-calc back off for that column.
function daColumnOp(colIdx, op) {
  const ds = daGetActive(); if (!ds) return;
  ds.colOps = ds.colOps || {};
  ds._calcCache = new Map();

  if (ds.colOps[colIdx] === op) {
    delete ds.colOps[colIdx];
    const rowIdx = ds.rows.findIndex((row, ri) => daIsTotalsRow(ds, ri));
    if (rowIdx !== -1) ds.rows[rowIdx][colIdx] = '';
    daRenderTable();
    toast(`Turned off auto-calculate for column ${daColToLetters(colIdx)}`, 'info');
    return;
  }

  const values = daGatherColumnValues(ds, colIdx, -1);
  if (!values.length) { toast('No numbers in this column yet', 'info'); return; }
  if (op === '/' && values.slice(1).some(v => v === 0)) { toast("Can't divide, one of the values is 0", 'error'); return; }

  ds.colOps[colIdx] = op;
  daRecalcColumnOps(ds);
  daRenderTable();
  const wrap = document.getElementById('daGridWrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
  const opLabel = { '+': 'Sum', '-': 'Difference', '*': 'Product', '/': 'Quotient', 'avg': 'Average' }[op];
  const rowIdx = ds.rows.findIndex((row, ri) => daIsTotalsRow(ds, ri));
  const shown = rowIdx !== -1 ? ds.rows[rowIdx][colIdx] : '';
  toast(`${opLabel} (${daColToLetters(colIdx)}) will auto-update: ${shown}`, 'success');
}

// Recomputes every column that has a "live" op armed (see daColumnOp above)
// against the table's current rows, and writes the fresh results back into
// the shared totals row. Called after any change that could shift the
// numbers a column op depends on: rows added/removed, a column removed, or
// any cell edited. Columns with no op armed are left completely alone.
function daRecalcColumnOps(ds) {
  if (!ds || !ds.colOps) return;
  const activeCols = Object.keys(ds.colOps).map(Number).filter(ci => ci < ds.headers.length);
  if (!activeCols.length) return;
  ds._calcCache = new Map();

  let rowIdx = ds.rows.findIndex((row, ri) => daIsTotalsRow(ds, ri));
  if (rowIdx === -1) {
    ds.rows.push(new Array(ds.headers.length).fill(''));
    rowIdx = ds.rows.length - 1;
  }
  activeCols.forEach(ci => {
    const op = ds.colOps[ci];
    const values = daGatherColumnValues(ds, ci, rowIdx);
    const result = daComputeOpResult(values, op);
    ds.rows[rowIdx][ci] = (result === null) ? '' : daFormatResultNumber(result);
  });
}



// ─── FILTER ───────────────────────────────────────────────────────────
// Per-person view state (not saved into the table, not shared with
// collaborators, not part of undo): dsId -> { match:'all'|'any', rules:[{col,op,val}] }.
// Filtering only hides rows in the grid; nothing is deleted, and every
// visible row keeps its real row index so editing still hits the right cell.
const daFilterState = {};
const DA_FILTER_OPS = [
  ['contains','contains'], ['notcontains','does not contain'], ['equals','equals'], ['notequals','does not equal'],
  ['starts','starts with'], ['ends','ends with'],
  ['gt','is greater than'], ['gte','is greater or equal'], ['lt','is less than'], ['lte','is less or equal'],
  ['between','is between'], ['oneof','is one of'],
  ['empty','is empty'], ['notempty','is not empty']
];
// Ops whose value input is a second field (between) rather than the single
// value box -- used to decide how many inputs the popover renders.
const DA_FILTER_OPS_RANGE = { between: true };
// Ops with no value input at all.
const DA_FILTER_OPS_NOVAL = { empty: true, notempty: true };
let daFilterBuiltSig = '';

function daFilterGetState(ds) {
  if (!daFilterState[ds.id]) daFilterState[ds.id] = { match: 'all', rules: [] };
  return daFilterState[ds.id];
}
function daFilterRuleIsActive(r, ds) {
  if (r.col !== '*' && (!Number.isInteger(r.col) || r.col < 0 || r.col >= ds.headers.length)) return false;
  if (r.op === 'empty' || r.op === 'notempty') return true;
  if (r.op === 'between') return String(r.val ?? '') !== '' && String(r.val2 ?? '') !== '';
  return String(r.val ?? '') !== '';
}
function daFilterActiveRules(ds) {
  const st = daFilterState[ds.id];
  return st ? st.rules.filter(r => daFilterRuleIsActive(r, ds)) : [];
}
function daFilterCellText(ds, ri, ci) {
  const v = String((ds.rows[ri] || [])[ci] ?? '');
  if (v.trim().startsWith('=')) {
    try { return String(daFormulaDisplayValue(ds, ri, ci).display ?? ''); } catch (e) { return v; }
  }
  return v;
}
// Reuses the same currency-aware number parser as the formula engine and
// summary stats (daCleanNum: strips ₹/$/€/£, thousands commas, accounting
// parens, AND a trailing magnitude suffix like Cr/Lakh/K/Mn/Bn) instead of a
// weaker duplicate that only stripped symbols. Without this, a numeric
// filter ("greater than 100") silently failed to match cells like "₹1.2Cr"
// or "(4,500)" even though the same values sort/sum correctly everywhere
// else in Data Arrangement.
function daFilterNum(x) {
  const t = daCleanNum(String(x));
  return t !== '' && !isNaN(Number(t)) ? Number(t) : NaN;
}
// Loose date parser used only by the filter's date-aware comparisons.
// Handles the formats that actually show up in pasted financial/report
// tables: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and "12 Jan 2024" style text.
// Returns a timestamp (ms) or NaN -- never throws, never guesses on
// ambiguous plain numbers (so a column of amounts is never misread as
// dates).
function daFilterDateMs(x) {
  const s = String(x).trim();
  if (!s || /^-?\d+(\.\d+)?$/.test(s)) return NaN; // plain numbers are never dates here
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    return isNaN(t) ? NaN : t;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return isNaN(t) ? NaN : t; }
  if (/^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(s) || /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}$/.test(s)) {
    const t = Date.parse(s);
    return isNaN(t) ? NaN : t;
  }
  return NaN;
}
// Compares two raw (untrimmed-case) cell/value strings on whichever axis
// actually applies: numeric (currency/magnitude-aware) first, then date
// (only when neither side is a plain number, so a date column and an
// amount column are never cross-confused), then plain text. Returns
// {cmp, kind} where cmp is -1/0/1 (or null if the two sides aren't
// comparable on any axis, e.g. one is text and the other is a number).
function daFilterCompareAxis(c, v) {
  const an = daFilterNum(c), bn = daFilterNum(v);
  if (!isNaN(an) && !isNaN(bn)) return { cmp: an === bn ? 0 : (an < bn ? -1 : 1), kind: 'num' };
  const ad = daFilterDateMs(c), bd = daFilterDateMs(v);
  if (!isNaN(ad) && !isNaN(bd)) return { cmp: ad === bd ? 0 : (ad < bd ? -1 : 1), kind: 'date' };
  return { cmp: null, kind: 'text' };
}
function daFilterTest(cell, op, val, val2) {
  const c = String(cell).trim().toLowerCase();
  const v = String(val).trim().toLowerCase();
  switch (op) {
    case 'contains': return c.includes(v);
    case 'notcontains': return !c.includes(v);
    case 'starts': return c.startsWith(v);
    case 'ends': return c.endsWith(v);
    case 'empty': return c === '';
    case 'notempty': return c !== '';
    // Comma-separated list of accepted values, e.g. "Pending, Overdue" --
    // matches numerically when the cell and a list entry both parse as
    // numbers, otherwise as an exact (case-insensitive) text match.
    case 'oneof': {
      const opts = v.split(',').map(s => s.trim()).filter(Boolean);
      return opts.some(o => {
        const a = daFilterNum(c), b = daFilterNum(o);
        return (!isNaN(a) && !isNaN(b)) ? a === b : c === o;
      });
    }
    case 'equals': case 'notequals': {
      const ax = daFilterCompareAxis(c, v);
      const eq = ax.cmp !== null ? ax.cmp === 0 : c === v;
      return op === 'equals' ? eq : !eq;
    }
    case 'between': {
      if (c === '') return false;
      const v2 = String(val2 ?? '').trim().toLowerCase();
      const lo = daFilterCompareAxis(c, v), hi = daFilterCompareAxis(c, v2);
      if (lo.cmp !== null && hi.cmp !== null) {
        // Order-agnostic: the two boundary values can be given in either order.
        const bounds = [daFilterNum(v), daFilterNum(v2)];
        const useNum = !isNaN(bounds[0]) && !isNaN(bounds[1]);
        const cn = useNum ? daFilterNum(c) : daFilterDateMs(c);
        const b1 = useNum ? bounds[0] : daFilterDateMs(v);
        const b2 = useNum ? bounds[1] : daFilterDateMs(v2);
        const min = Math.min(b1, b2), max = Math.max(b1, b2);
        return cn >= min && cn <= max;
      }
      // Non-numeric, non-date: fall back to lexical range (still order-agnostic).
      const lo2 = v <= v2 ? v : v2, hi2 = v <= v2 ? v2 : v;
      return c.localeCompare(lo2, undefined, { numeric: true }) >= 0 &&
             c.localeCompare(hi2, undefined, { numeric: true }) <= 0;
    }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const ax = daFilterCompareAxis(c, v);
      let cmp;
      if (ax.cmp !== null) cmp = ax.cmp;
      else { if (c === '') return false; cmp = c.localeCompare(v, undefined, { numeric: true }); cmp = cmp === 0 ? 0 : (cmp < 0 ? -1 : 1); }
      return op === 'gt' ? cmp > 0 : op === 'gte' ? cmp >= 0 : op === 'lt' ? cmp < 0 : cmp <= 0;
    }
  }
  return true;
}
function daFilterRuleMatches(ds, ri, r) {
  if (r.col === '*') {
    const n = ds.headers.length;
    const negative = (r.op === 'notcontains' || r.op === 'notequals');
    if (negative) { for (let ci = 0; ci < n; ci++) if (!daFilterTest(daFilterCellText(ds, ri, ci), r.op, r.val, r.val2)) return false; return true; }
    for (let ci = 0; ci < n; ci++) if (daFilterTest(daFilterCellText(ds, ri, ci), r.op, r.val, r.val2)) return true;
    return false;
  }
  return daFilterTest(daFilterCellText(ds, ri, r.col), r.op, r.val, r.val2);
}
function daFilterRowPasses(ds, ri, rules, matchAll) {
  return matchAll ? rules.every(r => daFilterRuleMatches(ds, ri, r))
                  : rules.some(r => daFilterRuleMatches(ds, ri, r));
}

// Distinct values for one column, capped and sorted by frequency, so the
// value box can offer an autocomplete list instead of a blank free-text
// field -- this is what catches "Pendnig" typos and lets someone filter a
// Status/Category column without retyping the exact label from memory.
// Deliberately skips columns with too many distinct values (near-unique
// IDs, free-text notes) where a dropdown of hundreds of options would be
// useless noise rather than a help.
function daFilterDistinctValues(ds, colIdx) {
  if (colIdx === null || colIdx === undefined) return [];
  const counts = new Map();
  const rows = ds.rows || [];
  const scanMax = Math.min(rows.length, 4000);
  for (let ri = 0; ri < scanMax; ri++) {
    let v = rows[ri][colIdx];
    if (typeof v === 'string' && v.trim().startsWith('=')) {
      try { v = daFormulaDisplayValue(ds, ri, colIdx).display; } catch (e) {}
    }
    const s = String(v ?? '').trim();
    if (s === '') continue;
    counts.set(s, (counts.get(s) || 0) + 1);
    if (counts.size > 60) return []; // too many distinct values to be a useful pick-list
  }
  return [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b)).slice(0, 40);
}
function daFilterDatalist(id, values) {
  if (!values.length) return '';
  return `<datalist id="${id}">${values.map(v => `<option value="${daEsc(v)}">`).join('')}</datalist>`;
}
function daFilterBuildPopover() {
  const pop = document.getElementById('daFilterPop');
  const ds = daGetActive();
  if (!pop) return;
  if (!ds) { pop.innerHTML = '<div class="da-filter-empty">Load a table first to filter it.</div>'; return; }
  const st = daFilterGetState(ds);
  daFilterBuiltSig = ds.id + '|' + ds.headers.join('\u0001');
  const colOpts = (sel) => `<option value="*"${sel === '*' ? ' selected' : ''}>Any column</option>` +
    ds.headers.map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${daEsc(h || ('Column ' + (i + 1)))}</option>`).join('');
  const rulesHtml = st.rules.length ? st.rules.map((r, i) => {
    const needsVal = !DA_FILTER_OPS_NOVAL[r.op];
    const isRange = !!DA_FILTER_OPS_RANGE[r.op];
    const colIdx = (r.col === '*') ? null : r.col;
    const dlValues = needsVal ? daFilterDistinctValues(ds, colIdx) : [];
    const dlId = 'daFilterDL' + i;
    const dlHtml = daFilterDatalist(dlId, dlValues);
    const listAttr = dlValues.length ? ` list="${dlId}"` : '';
    const enterKey = `onkeydown="if(event.key==='Enter'){daCloseFilterPop();}"`;
    let valueCell;
    if (!needsVal) {
      valueCell = '<span class="da-filter-noval">no value needed</span>';
    } else if (isRange) {
      valueCell = `<div class="da-filter-vals">
        <input type="text" aria-label="From value"${listAttr} placeholder="From…" value="${daEsc(r.val)}" oninput="daFilterSet(${i},'val',this.value)" ${enterKey}>
        <span class="da-filter-vals-sep">–</span>
        <input type="text" aria-label="To value"${listAttr} placeholder="To…" value="${daEsc(r.val2 || '')}" oninput="daFilterSet(${i},'val2',this.value)" ${enterKey}>
      </div>${dlHtml}`;
    } else {
      const ph = r.op === 'oneof' ? 'e.g. Pending, Overdue' : 'Value…';
      valueCell = `<input type="text" aria-label="Value"${listAttr} placeholder="${ph}" value="${daEsc(r.val)}" oninput="daFilterSet(${i},'val',this.value)" ${enterKey}>${dlHtml}`;
    }
    return `<div class="da-filter-rule">
      <select aria-label="Column" onchange="daFilterSet(${i},'col',this.value,true)">${colOpts(r.col)}</select>
      <select aria-label="Condition" onchange="daFilterSet(${i},'op',this.value,true)">${DA_FILTER_OPS.map(o => `<option value="${o[0]}"${r.op === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
      ${valueCell}
      <button type="button" class="da-filter-x" title="Remove this condition" aria-label="Remove condition" onclick="daFilterRemoveRule(${i})">×</button>
    </div>`;
  }).join('') : '<div class="da-filter-empty">No conditions yet. Add one to start filtering.</div>';
  pop.innerHTML = `
    <div class="da-filter-head">
      <span class="da-filter-title">Filter rows</span>
      <span class="da-filter-match">Match
        <select aria-label="Match all or any" onchange="daFilterSetMatch(this.value)">
          <option value="all"${st.match === 'all' ? ' selected' : ''}>all</option>
          <option value="any"${st.match === 'any' ? ' selected' : ''}>any</option>
        </select> conditions</span>
    </div>
    <div class="da-filter-rules">${rulesHtml}</div>
    <div class="da-filter-foot">
      <button type="button" class="da-filter-add" onclick="daFilterAddRule()">+ Add condition</button>
      <span class="da-filter-status" id="daFilterStatus"></span>
      <button type="button" class="da-filter-clear" onclick="daFilterClear()">Clear filter</button>
    </div>`;
  daFilterUpdateStatus(ds);
}
function daFilterUpdateStatus(ds) {
  const el = document.getElementById('daFilterStatus');
  if (!el || !ds) return;
  const n = daFilterActiveRules(ds).length;
  if (!n) { el.textContent = ''; el.classList.remove('da-filter-status-empty'); return; }
  const shown = ds.rows.reduce((acc, _r, i) => acc + (daFilterRowPasses(ds, i, daFilterActiveRules(ds), daFilterGetState(ds).match !== 'any') ? 1 : 0), 0);
  el.textContent = `${shown} of ${ds.rows.length} rows`;
  el.classList.toggle('da-filter-status-empty', shown === 0);
}
function daToggleFilterPop(e) {
  if (e) e.stopPropagation();
  const wrap = document.getElementById('daFilterWrap');
  const pop = document.getElementById('daFilterPop');
  if (!wrap || !pop) return;
  if (wrap.classList.contains('open')) { daCloseFilterPop(); return; }
  const ds = daGetActive();
  if (ds) {
    const st = daFilterGetState(ds);
    if (!st.rules.length) st.rules.push({ col: '*', op: 'contains', val: '' });
  }
  daFilterBuildPopover();
  wrap.classList.add('open');
  pop.style.left = '0px';
  const r = pop.getBoundingClientRect();
  if (r.right > window.innerWidth - 12) pop.style.left = -(r.right - window.innerWidth + 12) + 'px';
  const firstEmpty = pop.querySelector('.da-filter-rule input');
  if (firstEmpty) setTimeout(() => firstEmpty.focus(), 0);
}
function daCloseFilterPop() {
  const wrap = document.getElementById('daFilterWrap');
  if (wrap) wrap.classList.remove('open');
}
function daFilterSet(i, key, value, rebuild) {
  const ds = daGetActive(); if (!ds) return;
  const r = daFilterGetState(ds).rules[i]; if (!r) return;
  if (key === 'col') r.col = value === '*' ? '*' : parseInt(value, 10);
  else r[key] = value;
  if (rebuild) daFilterBuildPopover();
  daRenderTable();
}
function daFilterSetMatch(v) {
  const ds = daGetActive(); if (!ds) return;
  daFilterGetState(ds).match = v === 'any' ? 'any' : 'all';
  daRenderTable();
}
function daFilterAddRule() {
  const ds = daGetActive(); if (!ds) return;
  daFilterGetState(ds).rules.push({ col: '*', op: 'contains', val: '' });
  daFilterBuildPopover();
  const inputs = document.querySelectorAll('#daFilterPop .da-filter-rule input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}
function daFilterRemoveRule(i) {
  const ds = daGetActive(); if (!ds) return;
  daFilterGetState(ds).rules.splice(i, 1);
  daFilterBuildPopover();
  daRenderTable();
}
function daFilterClear() {
  const ds = daGetActive(); if (!ds) return;
  daFilterGetState(ds).rules = [];
  daFilterBuildPopover();
  daRenderTable();
}
// Keeps the toolbar button (blue + count badge) and, if open, the panel in step with the active table.
function daFilterSyncUI(ds) {
  const btn = document.getElementById('daFilterBtn');
  const badge = document.getElementById('daFilterBadge');
  const n = ds ? daFilterActiveRules(ds).length : 0;
  if (btn) btn.classList.toggle('active', n > 0);
  if (badge) { badge.style.display = n ? '' : 'none'; badge.textContent = n ? String(n) : ''; }
  const wrap = document.getElementById('daFilterWrap');
  if (wrap && wrap.classList.contains('open')) {
    const sig = ds ? ds.id + '|' + ds.headers.join('\u0001') : '';
    if (sig !== daFilterBuiltSig) daFilterBuildPopover(); else daFilterUpdateStatus(ds);
  }
}
document.addEventListener('mousedown', function (e) {
  const wrap = document.getElementById('daFilterWrap');
  if (wrap && wrap.classList.contains('open') && !wrap.contains(e.target)) daCloseFilterPop();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') daCloseFilterPop();
});

function daRenderTable() {
  daPersist();
  const gridWrap = document.getElementById('daGridWrap');
  const meta = document.getElementById('daMeta');
  if (!gridWrap) return;
  // Rebuilding the grid's innerHTML while one of its cells is still
  // mid-edit (contenteditable focused) makes the browser fire that cell's
  // blur handler *during* the removal — which calls daUpdateCell ->
  // daRenderTable() again, and the outer removal can then throw
  // "node to be removed is no longer a child of this node". Committing the
  // edit first (a normal blur, outside of any DOM removal) avoids that.
  if (gridWrap.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  const ds = daGetActive();
  if (!ds) { gridWrap.innerHTML = ''; if (meta) meta.textContent = ''; daRenderHighlightSummary(null); daFilterSyncUI(null); return; }
  daEnsureHighlightStore(ds);
  // A selection belongs to one dataset's row/column indices — switching
  // tabs invalidates it, so drop it silently rather than let stale indices
  // highlight the wrong rows/cells on the newly active table.
  if (daSelectionDsId !== ds.id) {
    daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
    daRowAnchor = null; daColAnchor = null;
    daSelectionDsId = ds.id;
  }

  const query = (document.getElementById('daSearchInput')?.value || '').trim().toLowerCase();
  ds._calcCache = new Map();   // formula results are read by the filter below, so the cache must exist first
  const filterRules = daFilterActiveRules(ds);
  const filterActive = filterRules.length > 0;
  const filterMatchAll = daFilterGetState(ds).match !== 'any';
  const visibleRowIdx = [];
  ds.rows.forEach((r, i) => {
    if (query && !r.some(c => String(c ?? '').toLowerCase().includes(query))) return;
    if (filterActive && !daFilterRowPasses(ds, i, filterRules, filterMatchAll)) return;
    visibleRowIdx.push(i);
  });

  if (meta) {
    meta.textContent = `${ds.headers.length} columns · ${ds.rows.length} rows` + ((query || filterActive) ? ` · ${visibleRowIdx.length} matching` : '');
  }

  const colTypes = ds.headers.map((_, ci) => daIsNumericCol(ds, ci) ? 'NUM' : 'TXT');

  // Fresh per-render cache so formulas re-evaluate against the latest edits,
  // but repeated references within the same render (e.g. a range used by
  // two different SUMs) don't get recomputed cell by cell.
  ds._calcCache = new Map();

  // Detected main heading (a report title that sat above the real header
  // row, e.g. "Annual Financial Performance Report") rendered as its own
  // banner, visually distinct from the sub-headers/column-header row below
  // it — so it's obvious this is a document title, not a 7th column. Kept
  // editable (it's exactly what gets pushed as the canvas heading) and
  // dismissible in case detection picked up something that wasn't really
  // a title.
  let titleHtml = '';
  if (ds.title) {
    titleHtml = `<div class="da-title-banner">
      <span class="da-title-banner-label" title="Detected from a spanning row above the table — this gets pushed to Workspace as a heading above the table">MAIN HEADING</span>
      <div class="da-title-banner-text" contenteditable="true" spellcheck="false"
           onblur="daRenameTitle(this.textContent)"
           onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${daEsc(ds.title)}</div>
      <span class="da-title-banner-del" title="Not a title? Remove it" onclick="daClearTitle()">×</span>
    </div>`;
  }

  // Blank table with nothing typed in yet — instead of a dedicated "Paste
  // Table" button (redundant now that Ctrl+V works anywhere in this
  // module), a quiet inline hint does the same job right where the person's
  // eyes already are. It's re-evaluated on every render, so the moment a
  // single cell gets real content it simply stops appearing — no dismiss
  // button, no state to track.
  let emptyHintHtml = '';
  if (daIsDatasetEmpty(ds)) {
    emptyHintHtml = `<div class="da-empty-hint-banner">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <span>Have a table in Excel, Sheets, or Word? Copy it (<kbd>Ctrl</kbd>+<kbd>C</kbd>), click anywhere in this table, and paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>) — it lands right here. This line disappears once you start typing.</span>
    </div>`;
  }

  let html = emptyHintHtml + titleHtml + `<table class="da-table${ds.frozen ? ' da-frozen' : ''}"><thead>`;
  html += `<tr class="da-collabels-row"><th class="da-rownum"></th>`;
  ds.headers.forEach((_, ci) => {
    const colHl = ds.colHighlights[ci];
    const colSelCls = daIsColSelected(ci) ? ' da-collabel-selected' : '';
    const colStyle = colHl ? ` style="background:${daHlBg(colHl.color)}"` : '';
    html += `<th class="da-collabel${colSelCls}"${colStyle} title="${colHl && colHl.tag ? daEsc(colHl.tag) + ' — click to select this column' : 'Click to select this column'}" onmousedown="daSelectCol(${ci}, event)">${daColToLetters(ci)}</th>`;
  });
  html += `</tr><tr>`;
  html += `<th class="da-rownum">#</th>`;
  ds.headers.forEach((h, ci) => {
    html += `<th oncontextmenu="daCellContextMenu(event, -1, ${ci});return false;">
      <div class="da-th-cell" title="Right-click for a column-wide dropdown list">
        <span class="da-th-name" contenteditable="true" spellcheck="false"
             onblur="daRenameHeader(${ci}, this.textContent)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${daEsc(h)}</span>
        <span class="da-th-type">${colTypes[ci]}</span>
        <span class="da-th-del" title="Delete column" onmousedown="event.preventDefault();event.stopPropagation();" onclick="daDeleteColumn(${ci})">×</span>
      </div>
      ${colTypes[ci] === 'NUM' ? `<div class="da-th-ops">
        <button type="button" class="da-th-opbtn${ds.colOps && ds.colOps[ci] === '+' ? ' da-th-opbtn-active' : ''}" title="Sum this column, auto-updates as rows change" onclick="daColumnOp(${ci}, '+')">+</button>
        <button type="button" class="da-th-opbtn${ds.colOps && ds.colOps[ci] === '-' ? ' da-th-opbtn-active' : ''}" title="Subtract down this column, auto-updates as rows change" onclick="daColumnOp(${ci}, '-')">−</button>
        <button type="button" class="da-th-opbtn${ds.colOps && ds.colOps[ci] === '*' ? ' da-th-opbtn-active' : ''}" title="Multiply this column, auto-updates as rows change" onclick="daColumnOp(${ci}, '*')">×</button>
        <button type="button" class="da-th-opbtn${ds.colOps && ds.colOps[ci] === '/' ? ' da-th-opbtn-active' : ''}" title="Divide down this column, auto-updates as rows change" onclick="daColumnOp(${ci}, '/')">÷</button>
        <button type="button" class="da-th-opbtn da-th-opbtn-avg${ds.colOps && ds.colOps[ci] === 'avg' ? ' da-th-opbtn-active' : ''}" title="Average this column, auto-updates as rows change" onclick="daColumnOp(${ci}, 'avg')">AVG</button>
      </div>` : ''}
    </th>`;
  });
  html += `</tr></thead><tbody>`;

  if (!visibleRowIdx.length) {
    html += `<tr><td class="da-rownum">–</td><td colspan="${ds.headers.length}" style="padding:16px;color:var(--text3);font-size:12px;text-align:center">${(query || filterActive) ? (query && filterActive ? 'No rows match your search and filter' : filterActive ? 'No rows match your filter' : 'No rows match your search') : 'No rows yet, use "+ Row" to add one'}</td></tr>`;
  } else {
    visibleRowIdx.forEach(ri => {
      const row = ds.rows[ri];
      const rowHl = ds.rowHighlights[ri];
      const rowSelCls = daIsRowSelected(ri) ? ' da-rownum-selected' : '';
      const rowStyle = rowHl ? ` style="background:${daHlBg(rowHl.color)}"` : '';
      html += `<tr><td class="da-rownum${rowSelCls}"${rowStyle} title="${rowHl && rowHl.tag ? daEsc(rowHl.tag) + ' — click to select this row' : 'Click to select this row'}" onmousedown="daSelectRow(${ri}, event)"><div class="da-rownum-inner"><span class="da-row-num-text">${ri + 1}</span><span class="da-row-del-btn" title="Delete row" onmousedown="event.stopPropagation()" onclick="daDeleteRow(${ri})">×</span></div></td>`;
      row.forEach((cell, ci) => {
        const val = String(cell ?? '');
        const isFormula = val.trim().startsWith('=');
        let displayRaw, isError = false;
        if (isFormula) {
          const res = daFormulaDisplayValue(ds, ri, ci);
          displayRaw = res.display; isError = res.isError;
        } else {
          displayRaw = val;
        }
        const isNum = !isFormula && colTypes[ci] === 'NUM' && displayRaw.trim() !== '' && !isNaN(parseFloat(displayRaw));
        const isNumFormula = isFormula && !isError && displayRaw.trim() !== '' && !isNaN(parseFloat(displayRaw));
        const showVal = (!isFormula && query && val.toLowerCase().includes(query)) ? daHighlight(val, query) : daEsc(displayRaw);
        const cls = [
          (isNum || isNumFormula) ? 'da-cell-num' : '',
          (!isFormula && displayRaw === '') ? 'da-cell-empty' : '',
          isFormula ? 'da-cell-formula' : '',
          isError ? 'da-cell-error' : '',
          daXIsMissing(ds, ri, ci, val) ? 'da-cell-missing' : ''
        ].filter(Boolean).join(' ');
        const dropdownOpts = daGetEffectiveDropdown(ds, ri, ci);
        const dropdownColors = daGetEffectiveDropdownColors(ds, ri, ci);
        const linkUrl = daGetCellLink(ds, ri, ci);
        const hl = daGetEffectiveHighlight(ds, ri, ci);
        const hlStyle = hl ? ` style="background:${daHlBg(hl.color)}"` : '';
        const hlTitle = hl && hl.tag ? daEsc(hl.tag) : '';
        const cellSelCls = daIsCellSelected(ri, ci) ? ' da-cell-selected' : '';
        const linkBadge = linkUrl ? `<span class="da-td-link-badge" title="Open link: ${daEsc(linkUrl)}"
             onmousedown="event.preventDefault();event.stopPropagation();daOpenCellLink(${ri}, ${ci})">
             <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
           </span>` : '';
        if (dropdownOpts && !isFormula) {
          let matched = false;
          let optsHtml = dropdownOpts.map(opt => {
            const isSel = opt === val;
            if (isSel) matched = true;
            const optColor = dropdownColors && dropdownColors[opt];
            const optStyle = optColor ? ` style="background:${daHlBg(optColor, 0.55)}"` : '';
            return `<option value="${daEsc(opt)}"${isSel ? ' selected' : ''}${optStyle}>${daEsc(opt)}</option>`;
          }).join('');
          // FIX: an unset dropdown cell used to show the exact same bare "—"
          // a genuinely blank contenteditable cell shows, so a freshly
          // dropdown-enabled column (see the screenshot: every row showing
          // "—" with a chevron) read as "nothing happened" rather than
          // "pick a value here" -- the placeholder and a real empty cell
          // were visually identical. Using "Select…" for the unset case
          // only (matched stays false only when the cell truly has no
          // value yet, or an old value that no longer matches the list)
          // keeps the em-dash convention for actual blank data everywhere
          // else, while making a dropdown's own empty state look like an
          // affordance instead of a dead end. A muted class distinguishes
          // it further from a picked value.
          const isUnset = !matched;
          if (isUnset) {
            const placeholderText = val === '' ? 'Select…' : daEsc(val);
            optsHtml = `<option value="${daEsc(val)}" selected>${placeholderText}</option>` + optsHtml;
          }
          // A manual cell/row/column highlight is an explicit choice, so it
          // wins over the automatic per-value dropdown color when both are
          // present; otherwise the selected option's own color tints the
          // closed select the same way a highlighted cell would look.
          const selValColor = dropdownColors && dropdownColors[val];
          const selectBg = hl ? daHlBg(hl.color) : (selValColor ? daHlBg(selValColor) : '');
          const selectStyle = selectBg ? ` style="background:${selectBg}"` : '';
          const unsetCls = (isUnset && val === '') ? ' da-td-select-unset' : '';
          html += `<td data-r="${ri}" data-c="${ci}" onmouseenter="daCellRangeMouseEnter(${ri},${ci})"><select id="daCell_${ds.id}_${ri}_${ci}" class="da-td-select${cellSelCls}${unsetCls}${daXIsMissing(ds, ri, ci, val) ? ' da-cell-missing' : ''}" data-da-dropdown="1"${selectStyle}
               onmousedown="daDropdownCellMouseDown(event, ${ri}, ${ci})"
               onfocus="daCellFocus(this, ${ri}, ${ci})"
               onkeydown="daHandleCellKeydown(event, ${ri}, ${ci})"
               onchange="daUpdateCell(${ri}, ${ci}, this.value)"
               oncontextmenu="daCellContextMenu(event, ${ri}, ${ci});return false;"
               title="${hlTitle ? hlTitle + ' — ' : ''}Click to pick a value, right-click to edit the dropdown's choices">${optsHtml}</select>${linkBadge}</td>`;
        } else {
          html += `<td data-r="${ri}" data-c="${ci}" onmouseenter="daCellRangeMouseEnter(${ri},${ci})"><div id="daCell_${ds.id}_${ri}_${ci}" class="da-td-cell${cls ? ' ' + cls : ''}${linkUrl ? ' da-cell-has-link' : ''}${cellSelCls}" contenteditable="true" spellcheck="false"${hlStyle}
               onmousedown="daCellMouseDown(event, ${ri}, ${ci})"
               onfocus="daCellFocus(this, ${ri}, ${ci})"
               onblur="daUpdateCell(${ri}, ${ci}, this.textContent)"
               onkeydown="daHandleCellKeydown(event, ${ri}, ${ci})"
               oncontextmenu="daCellContextMenu(event, ${ri}, ${ci});return false;"
               title="${hlTitle ? hlTitle + ' — ' : ''}${isError ? 'Formula error, click to edit' : (isFormula ? 'Formula, click to edit' : (linkUrl ? 'Linked to ' + linkUrl + ' — right-click to edit' : 'Right-click to add a dropdown list or link'))}">${!isFormula && displayRaw === '' ? '—' : showVal}</div>${linkBadge}</td>`;
        }
      });
      html += `</tr>`;
    });
  }
  html += `</tbody></table>`;
  gridWrap.innerHTML = html;
  daFillPlaceHandle();
  daRenderHighlightSummary(ds);
  daFilterSyncUI(ds);
  daGridUpdateNavButtons();
}

// Left/right step buttons overlaid on the grid, for tables with more
// columns than fit on screen — click to step across instead of only
// dragging the scrollbar or trackpad-swiping. Shows/hides each arrow
// based on whether there's actually more table in that direction, and
// disables both entirely once the table fits without any overflow.
function daGridUpdateNavButtons() {
  const wrap = document.getElementById('daGridWrap');
  const left = document.getElementById('daGridNavLeft');
  const right = document.getElementById('daGridNavRight');
  if (!wrap || !left || !right) return;
  const overflowing = wrap.scrollWidth > wrap.clientWidth + 1;
  if (!overflowing) {
    left.disabled = true; right.disabled = true;
    left.classList.remove('da-grid-nav-active'); right.classList.remove('da-grid-nav-active');
    return;
  }
  left.classList.add('da-grid-nav-active'); right.classList.add('da-grid-nav-active');
  left.disabled = wrap.scrollLeft <= 1;
  right.disabled = wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 1;
}

function daGridStepScroll(dir) {
  const wrap = document.getElementById('daGridWrap');
  if (!wrap) return;
  // Step by ~80% of the visible width, like a page-by-page swipe, rather
  // than a fixed pixel amount that means something different on every
  // table's column widths.
  wrap.scrollBy({ left: dir * Math.round(wrap.clientWidth * 0.8), behavior: 'smooth' });
}

(function daGridNavInit() {
  const wrap = document.getElementById('daGridWrap');
  if (wrap) {
    wrap.addEventListener('scroll', daGridUpdateNavButtons, { passive: true });
  }
  window.addEventListener('resize', daGridUpdateNavButtons);
})();

function daHighlight(val, query) {
  const idx = val.toLowerCase().indexOf(query);
  if (idx === -1) return daEsc(val);
  return daEsc(val.slice(0, idx)) + '<span class="da-mark">' + daEsc(val.slice(idx, idx + query.length)) + '</span>' + daEsc(val.slice(idx + query.length));
}

function daRenameHeader(colIdx, newName) {
  const ds = daGetActive(); if (!ds) return;
  const clean = newName.trim() || `Column ${colIdx + 1}`;
  ds.headers[colIdx] = clean;
  daRenderTable();
  daPersist();
}

function daRenameTitle(newTitle) {
  const ds = daGetActive(); if (!ds) return;
  const clean = newTitle.trim();
  ds.title = clean || null;
  daRenderTable();
  daPersist();
}

function daClearTitle() {
  const ds = daGetActive(); if (!ds) return;
  ds.title = null;
  daRenderTable();
  daPersist();
  toast('Main heading removed — the table headers below are unaffected', 'info');
}

function daUpdateCell(rowIdx, colIdx, newVal) {
  const ds = daGetActive(); if (!ds) return;
  const val = newVal === '—' ? '' : newVal.trim();
  ds.rows[rowIdx][colIdx] = val;
  daRecalcColumnOps(ds);
  daRenderTable();
  daPersist(); // push this cell edit to the shared Yjs doc so teammates see it live
  if (daActiveCell && daActiveCell.row === rowIdx && daActiveCell.col === colIdx) {
    daUpdateFormulaBar(rowIdx, colIdx, val);
  }
  // Only the cell that was just typed into gets a guidance toast — recalculated
  // cells elsewhere on the sheet stay silent so this never turns into spam.
  if (val.trim().startsWith('=')) {
    ds._calcCache = new Map();
    try {
      daGetCellComputedValue(ds, rowIdx, colIdx, new Set());
    } catch (e) {
      const code = e && e.formulaError;
      const hint = (e && e.hint) || DA_ERROR_HINTS[code] || 'Check the formula and try again.';
      toast(hint, 'error');
    }
  }
}
// Plain-English fallback explanations for error codes that don't already
// carry a specific hint (e.g. thrown by other formula functions).
const DA_ERROR_HINTS = {
  '#DIV/0!': "Can't divide by zero — check the cell you're dividing by.",
  '#VALUE!': "One of the values in this formula isn't a number where a number is expected.",
  '#REF!':   "This formula points to a cell that doesn't exist. Check the cell reference.",
  '#CIRCULAR!': "This formula refers to itself, directly or through other cells — that's a loop, so it can't calculate.",
  '#NAME?':  "That function name isn't recognized. Click the ƒx button to see the full list.",
  '#NUM!':   "That calculation doesn't produce a valid number (e.g. square root of a negative number).",
  '#NORATES!': 'Click "Get Live Rates" in the toolbar above the table first, then try this formula again.',
};

function daAddRow() {
  const ds = daGetActive(); if (!ds) { toast('Upload a file first', 'info'); return; }
  ds.rows.push(new Array(ds.headers.length).fill(''));
  daRecalcColumnOps(ds);
  daRenderTable();
  daPersist();
  const wrap = document.getElementById('daGridWrap');
  wrap.scrollTop = wrap.scrollHeight;
}

function daAddColumn() {
  const ds = daGetActive(); if (!ds) { toast('Upload a file first', 'info'); return; }
  ds.headers.push(`Column ${ds.headers.length + 1}`);
  ds.rows.forEach(r => r.push(''));
  daRenderTable();
  daPersist();
}

function daDeleteRow(rowIdx) {
  const ds = daGetActive(); if (!ds) return;
  ds.rows.splice(rowIdx, 1);
  // Single-cell dropdowns are keyed by "row_col" — shift every row below the
  // deleted one up by one so they stay attached to the right cell.
  if (ds.cellDropdowns) {
    const shifted = {};
    Object.keys(ds.cellDropdowns).forEach(k => {
      const [rStr, cStr] = k.split('_');
      const r = Number(rStr), c = Number(cStr);
      if (r === rowIdx) return;
      shifted[(r > rowIdx ? r - 1 : r) + '_' + c] = ds.cellDropdowns[k];
    });
    ds.cellDropdowns = shifted;
  }
  // Cell links are keyed the same way ("row_col") — shift them up too so a
  // link stays attached to the cell it was set on, not whatever row moves
  // into that slot.
  if (ds.links) {
    const shiftedLinks = {};
    Object.keys(ds.links).forEach(k => {
      const [rStr, cStr] = k.split('_');
      const r = Number(rStr), c = Number(cStr);
      if (r === rowIdx) return;
      shiftedLinks[(r > rowIdx ? r - 1 : r) + '_' + c] = ds.links[k];
    });
    ds.links = shiftedLinks;
  }
  // Same shift for row/cell highlights, plus dropping any selection — its
  // row indices no longer point at the same rows once this one is gone.
  daEnsureHighlightStore(ds);
  const shiftedRowHl = {};
  Object.keys(ds.rowHighlights).forEach(k => {
    const r = Number(k);
    if (r === rowIdx) return;
    shiftedRowHl[r > rowIdx ? r - 1 : r] = ds.rowHighlights[k];
  });
  ds.rowHighlights = shiftedRowHl;
  const shiftedCellHl = {};
  Object.keys(ds.cellHighlights).forEach(k => {
    const [rStr, cStr] = k.split('_');
    const r = Number(rStr), c = Number(cStr);
    if (r === rowIdx) return;
    shiftedCellHl[(r > rowIdx ? r - 1 : r) + '_' + c] = ds.cellHighlights[k];
  });
  ds.cellHighlights = shiftedCellHl;
  daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
  daRowAnchor = null; daColAnchor = null;
  daRecalcColumnOps(ds);
  daRenderTable();
  daPersist();
}

function daDeleteColumn(colIdx) {
  const ds = daGetActive(); if (!ds) return;
  if (ds.headers.length <= 1) { toast('A table needs at least one column', 'info'); return; }
  ds.headers.splice(colIdx, 1);
  ds.rows.forEach(r => r.splice(colIdx, 1));
  // Shift/drop any armed column ops so they still point at the right column
  // after everything to the right of the deleted one shifts left by one.
  if (ds.colOps) {
    const shifted = {};
    Object.keys(ds.colOps).forEach(k => {
      const ci = Number(k);
      if (ci === colIdx) return;
      shifted[ci > colIdx ? ci - 1 : ci] = ds.colOps[k];
    });
    ds.colOps = shifted;
  }
  // Same left-shift for any dropdown lists, cell- or column-level, so they
  // keep pointing at the right column/cell after the delete.
  daEnsureDropdownStore(ds);
  const shiftedCol = {};
  Object.keys(ds.colDropdowns).forEach(k => {
    const ci = Number(k);
    if (ci === colIdx) return;
    shiftedCol[ci > colIdx ? ci - 1 : ci] = ds.colDropdowns[k];
  });
  ds.colDropdowns = shiftedCol;
  const shiftedCell = {};
  Object.keys(ds.cellDropdowns).forEach(k => {
    const [rStr, cStr] = k.split('_');
    const r = Number(rStr), c = Number(cStr);
    if (c === colIdx) return;
    shiftedCell[r + '_' + (c > colIdx ? c - 1 : c)] = ds.cellDropdowns[k];
  });
  ds.cellDropdowns = shiftedCell;
  if (ds.links) {
    const shiftedLinks = {};
    Object.keys(ds.links).forEach(k => {
      const [rStr, cStr] = k.split('_');
      const r = Number(rStr), c = Number(cStr);
      if (c === colIdx) return;
      shiftedLinks[r + '_' + (c > colIdx ? c - 1 : c)] = ds.links[k];
    });
    ds.links = shiftedLinks;
  }
  // Same left-shift for column/cell highlights, plus dropping any
  // selection — its column indices no longer point at the same columns.
  daEnsureHighlightStore(ds);
  const shiftedColHl = {};
  Object.keys(ds.colHighlights).forEach(k => {
    const ci = Number(k);
    if (ci === colIdx) return;
    shiftedColHl[ci > colIdx ? ci - 1 : ci] = ds.colHighlights[k];
  });
  ds.colHighlights = shiftedColHl;
  const shiftedCellHl2 = {};
  Object.keys(ds.cellHighlights).forEach(k => {
    const [rStr, cStr] = k.split('_');
    const r = Number(rStr), c = Number(cStr);
    if (c === colIdx) return;
    shiftedCellHl2[r + '_' + (c > colIdx ? c - 1 : c)] = ds.cellHighlights[k];
  });
  ds.cellHighlights = shiftedCellHl2;
  daSelection = { rows: new Set(), cols: new Set(), cellRanges: [] };
  daRowAnchor = null; daColAnchor = null;
  daRecalcColumnOps(ds);
  daRenderTable();
  daPersist();
}

// ─── Cell Dropdown Lists ("Data Validation", Excel-style) ───
// A dropdown can be attached at two levels:
//   ds.cellDropdowns["r_c"] -> array of choices for one specific cell (wins)
//   ds.colDropdowns[ci]     -> array of choices applied to every cell in a column
// Older saved datasets (from before this feature existed) won't have either
// object yet, so every entry point defends against that with daEnsureDropdownStore.
function daEnsureDropdownStore(ds) {
  if (!ds.colDropdowns) ds.colDropdowns = {};
  if (!ds.cellDropdowns) ds.cellDropdowns = {};
  // Per-option colors, same key scheme as colDropdowns/cellDropdowns above:
  // ds.colDropdownColors[ci]      -> { optionText: hexColor } for a column
  // ds.cellDropdownColors["r_c"]  -> { optionText: hexColor } for one cell
  // Populated automatically whenever a dropdown's option list is (re)set --
  // see daAutoAssignDropdownColors below -- so both the manual modal and
  // Kadessa's da_set_dropdown produce the same colored look with no extra
  // step required from whoever is setting it up.
  if (!ds.colDropdownColors) ds.colDropdownColors = {};
  if (!ds.cellDropdownColors) ds.cellDropdownColors = {};
}

// Common, meaningful words get a color that matches what they mean
// everywhere else in the app (da_highlight_* uses the same six names via
// DA_HIGHLIGHT_COLOR_NAMES) -- "Yes"/"Approved"/"Done" are green, "No"/
// "Rejected"/"Overdue" are red, and so on. Anything that doesn't match a
// known word cycles through the remaining named colors in a fixed order,
// so the same option list always comes out the same way (stable, not
// random) whether it's typed into the modal or created by Kadessa.
const DA_DROPDOWN_KEYWORD_COLORS = [
  [/^(yes|approved|done|complete(d)?|paid|fixed|resolved|active|won|accepted|confirmed|in stock|available|true|pass(ed)?)$/i, 'green'],
  [/^(no|rejected|denied|cancell?ed|overdue|failed|inactive|lost|declined|out of stock|unavailable|won'?t fix|false|fail(ed)?)$/i, 'red'],
  [/^(high|urgent|critical|top priority)$/i, 'red'],
  [/^(pending|in progress|in review|processing|medium|review|maybe|waiting|on hold)$/i, 'yellow'],
  [/^(new|open|not started|todo|low|backlog)$/i, 'blue'],
  [/^(closed|archived|n\/a|none|unknown)$/i, 'gray'],
];
const DA_DROPDOWN_COLOR_CYCLE = ['blue', 'green', 'yellow', 'purple', 'gray', 'red'];

function daAutoAssignDropdownColors(options) {
  const out = {};
  let cycleIdx = 0;
  (options || []).forEach(function (opt) {
    const trimmed = String(opt == null ? '' : opt).trim();
    if (!trimmed || out[trimmed]) return;
    let colorName = null;
    for (let i = 0; i < DA_DROPDOWN_KEYWORD_COLORS.length; i++) {
      if (DA_DROPDOWN_KEYWORD_COLORS[i][0].test(trimmed)) { colorName = DA_DROPDOWN_KEYWORD_COLORS[i][1]; break; }
    }
    if (!colorName) {
      colorName = DA_DROPDOWN_COLOR_CYCLE[cycleIdx % DA_DROPDOWN_COLOR_CYCLE.length];
      cycleIdx++;
    }
    out[trimmed] = DA_HIGHLIGHT_COLOR_NAMES[colorName];
  });
  return out;
}

// ─── Cell Links ("Insert Link", Excel/Sheets-style) ───
// A link is attached to one specific cell — ds.links["r_c"] -> the target URL.
// It rides alongside the cell's own text value (which stays the visible
// display text), the same way a hyperlink works in Excel or Google Sheets.
// Older saved datasets won't have this object yet, so every entry point
// defends against that with daEnsureLinksStore.
function daEnsureLinksStore(ds) {
  if (!ds.links) ds.links = {};
}

// ─── Highlighting ("color-tag to group") ───
// Attaches at three levels, same "most specific wins" idea as dropdowns:
//   ds.cellHighlights["r_c"] -> { color, tag } for one specific cell (wins)
//   ds.rowHighlights[ri]     -> { color, tag } for a whole row
//   ds.colHighlights[ci]     -> { color, tag } for a whole column
// A row or column highlight applies to every cell in it, including ones
// added later — that's the point of tagging the row/column itself instead
// of just painting the cells that happen to exist right now.
function daEnsureHighlightStore(ds) {
  if (!ds.rowHighlights) ds.rowHighlights = {};
  if (!ds.colHighlights) ds.colHighlights = {};
  if (!ds.cellHighlights) ds.cellHighlights = {};
}

function daGetEffectiveHighlight(ds, ri, ci) {
  daEnsureHighlightStore(ds);
  return ds.cellHighlights[ri + '_' + ci] || ds.rowHighlights[ri] || ds.colHighlights[ci] || null;
}

// Hex -> low-alpha rgba, so a highlight tints a cell without drowning out
// its text on this dark theme.
function daHlBg(hex, alpha) {
  alpha = alpha == null ? 0.32 : alpha;
  const h = String(hex || '#888888').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0, g = parseInt(h.substring(2, 4), 16) || 0, b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

const DA_HIGHLIGHT_COLORS = ['#f2c94c', '#6fcf97', '#56ccf2', '#bb6bd9', '#eb5757', '#9aa5b1'];

// Same six swatches, keyed by plain-English name instead of hex, so Kadessa's
// highlight tools take a color like "yellow" or "red" rather than needing
// the model to remember/guess a hex code. Shared by every da_highlight_*
// KADESSA_ACTIONS entry below and their label() text, so what Kadessa says she
// picked always matches what actually got applied.
const DA_HIGHLIGHT_COLOR_NAMES = { yellow: '#f2c94c', green: '#6fcf97', blue: '#56ccf2', purple: '#bb6bd9', red: '#eb5757', gray: '#9aa5b1', grey: '#9aa5b1' };

// Renders the small "legend" strip above the grid: one chip per tag in use,
// with a live row count and — when the table has a numeric column — a
// running total for that group, so a highlight tells you something about
// the data instead of just coloring it.
// Renders the "Highlights" legend panel above the grid: which rows and
// columns are tagged, in which color — no totals, since the numbers are
// already sitting right there in the table itself.
function daRenderHighlightSummary(ds) {
  const el = document.getElementById('daHighlightSummary');
  if (!el) return;
  if (!ds) { el.style.display = 'none'; el.innerHTML = ''; return; }
  daEnsureHighlightStore(ds);

  // Row-level groups (whole-row highlights + individually-tagged cells),
  // keyed by color+tag so two same-tag groups in different colors don't merge.
  const rowGroups = {};
  const addRow = (color, tag, ri) => {
    const key = color + '|' + (tag || '');
    if (!rowGroups[key]) rowGroups[key] = { color, tag, rows: new Set() };
    rowGroups[key].rows.add(ri);
  };
  Object.keys(ds.rowHighlights).forEach(k => { const { color, tag } = ds.rowHighlights[k]; addRow(color, tag, +k); });
  Object.keys(ds.cellHighlights).forEach(k => { const { color, tag } = ds.cellHighlights[k]; addRow(color, tag, +k.split('_')[0]); });

  // Column-level groups, listed separately since these tag a whole column
  // rather than a set of rows.
  const colGroups = {};
  Object.keys(ds.colHighlights).forEach(k => {
    const { color, tag } = ds.colHighlights[k];
    const key = color + '|' + (tag || '');
    if (!colGroups[key]) colGroups[key] = { color, tag, cols: new Set() };
    colGroups[key].cols.add(+k);
  });

  const rowKeys = Object.keys(rowGroups), colKeys = Object.keys(colGroups);
  if (!rowKeys.length && !colKeys.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';

  const fmtList = (nums) => nums.length <= 6 ? nums.join(', ') : nums.slice(0, 6).join(', ') + `, +${nums.length - 6} more`;

  const rowItems = rowKeys.map(key => {
    const g = rowGroups[key];
    const nums = [...g.rows].sort((a, b) => a - b).map(r => r + 1);
    return `<div class="da-hl-legend-item">
      <span class="da-hl-legend-dot" style="background:${daEsc(g.color)}"></span>
      <span class="da-hl-legend-tag">${daEsc(g.tag || 'Untagged')}</span>
      <span class="da-hl-legend-meta">${g.rows.size} row${g.rows.size === 1 ? '' : 's'} · #${fmtList(nums)}</span>
    </div>`;
  }).join('');

  const colItems = colKeys.map(key => {
    const g = colGroups[key];
    const letters = [...g.cols].sort((a, b) => a - b).map(c => daColToLetters(c));
    return `<div class="da-hl-legend-item">
      <span class="da-hl-legend-dot" style="background:${daEsc(g.color)}"></span>
      <span class="da-hl-legend-tag">${daEsc(g.tag || 'Untagged')}</span>
      <span class="da-hl-legend-meta">Column${letters.length === 1 ? '' : 's'} ${letters.join(', ')}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="da-hl-legend-label">Highlights</div><div class="da-hl-legend-list">${rowItems}${colItems}</div>`;
}

function daGetCellLink(ds, ri, ci) {
  if (!ds) return null;
  daEnsureLinksStore(ds);
  return ds.links[ri + '_' + ci] || null;
}

// Accepts what a person actually types ("sarvarc.com", "www.x.com/page",
// "mailto:a@b.com", "tel:+1234567890") and turns it into a URL a browser
// will actually navigate to, defaulting bare domains to https://.
function daNormalizeLinkUrl(raw) {
  const val = (raw || '').trim();
  if (!val) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(val)) return val;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(val)) return 'mailto:' + val;
  return 'https://' + val.replace(/^\/+/, '');
}

function daGetEffectiveDropdown(ds, ri, ci) {
  if (!ds) return null;
  daEnsureDropdownStore(ds);
  const cellOpts = ds.cellDropdowns[ri + '_' + ci];
  if (cellOpts && cellOpts.length) return cellOpts;
  const colOpts = ds.colDropdowns[ci];
  if (colOpts && colOpts.length) return colOpts;
  return null;
}

// Same cell-then-column precedence as daGetEffectiveDropdown, for the color
// map that goes with whichever option list is actually in effect.
function daGetEffectiveDropdownColors(ds, ri, ci) {
  if (!ds) return null;
  daEnsureDropdownStore(ds);
  const cellColors = ds.cellDropdownColors[ri + '_' + ci];
  if (cellColors) return cellColors;
  const colColors = ds.colDropdownColors[ci];
  if (colColors) return colColors;
  return null;
}

let daDropdownCtx = null;   // { row, col } the modal is currently editing (row -1 = whole column, opened from the header)
let daDropdownScope = 'cell'; // 'cell' | 'column', which the modal will save to

// Right-click on any grid cell (or a header, with row = -1) opens a small
// menu offering to create/edit/remove that cell's (or column's) dropdown.
function daCellContextMenu(e, ri, ci) {
  e.preventDefault();
  const ds = daGetActive(); if (!ds) return;
  daEnsureDropdownStore(ds);
  daEnsureLinksStore(ds);
  const menu = document.getElementById('daCellCtxMenu');
  if (!menu) return;

  const isHeader = ri === -1;
  const hasDropdown = isHeader ? !!(ds.colDropdowns[ci] && ds.colDropdowns[ci].length) : !!daGetEffectiveDropdown(ds, ri, ci);
  const editLabel = isHeader ? (hasDropdown ? 'Edit Column Dropdown…' : 'Set Column Dropdown…') : (hasDropdown ? 'Edit Dropdown List…' : 'Create Dropdown List…');
  const removeLabel = isHeader ? 'Remove Column Dropdown' : 'Remove Dropdown';

  // Links attach to a single data cell — a column header has no cell value
  // of its own to link, so this item is only offered for real cells.
  const linkUrl = isHeader ? null : daGetCellLink(ds, ri, ci);
  const linkItems = isHeader ? '' : `
    <div class="da-ctx-item" onclick="daCloseCellCtxMenu();daOpenLinkModal(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      ${linkUrl ? 'Edit Link…' : 'Insert Link…'}
    </div>
    ${linkUrl ? `<div class="da-ctx-item" onclick="daCloseCellCtxMenu();daOpenCellLink(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open Link
    </div>
    <div class="da-ctx-item da-ctx-item-danger" onclick="daCloseCellCtxMenu();daRemoveLink(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Remove Link
    </div>` : ''}
  `;

  menu.innerHTML = `
    <div class="da-ctx-item" onclick="daCloseCellCtxMenu();daOpenDropdownModal(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="8 10 12 14 16 10"/></svg>
      ${editLabel}
    </div>
    ${hasDropdown ? `<div class="da-ctx-item da-ctx-item-danger" onclick="daCloseCellCtxMenu();daRemoveDropdown(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      ${removeLabel}
    </div>` : ''}
    <div class="da-ctx-item" onclick="daCloseCellCtxMenu();daContextHighlight(${ri}, ${ci})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l6-6 4 4-6 6H9v-4z"/><path d="M3 21l4-1 9-9-3-3-9 9-1 4z"/></svg>
      ${isHeader ? 'Highlight Column…' : 'Highlight Cell…'}
    </div>
    ${linkItems}
  `;
  menu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 130) + 'px';
  menu.style.display = 'block';
}

function daCloseCellCtxMenu() {
  const menu = document.getElementById('daCellCtxMenu');
  if (menu) menu.style.display = 'none';
}
document.addEventListener('mousedown', function (e) {
  const menu = document.getElementById('daCellCtxMenu');
  if (menu && menu.style.display === 'block' && !menu.contains(e.target)) daCloseCellCtxMenu();
});

function daSetDropdownScope(scope) {
  daDropdownScope = scope;
  document.getElementById('daDropdownScopeCell').classList.toggle('active', scope === 'cell');
  document.getElementById('daDropdownScopeColumn').classList.toggle('active', scope === 'column');
}

// Opens the modal. Called from: the toolbar "Dropdown" button (no args, uses
// the currently focused cell), a data-cell right-click (ri/ci given), or a
// header right-click (ri === -1, meaning "set this up for the whole column").
function daOpenDropdownModal(ri, ci) {
  const ds = daGetActive();
  if (!ds) { toast('Upload or create a table first', 'info'); return; }
  daEnsureDropdownStore(ds);

  if (ri === undefined || ci === undefined) {
    if (!daActiveCell) { toast('Click a cell first, then set its dropdown list', 'info'); return; }
    ri = daActiveCell.row; ci = daActiveCell.col;
  }
  if (ci == null || ci < 0 || ci >= ds.headers.length) { toast('Pick a column first', 'info'); return; }

  daDropdownCtx = { row: ri, col: ci };
  const isHeader = ri === -1;
  const key = isHeader ? null : (ri + '_' + ci);
  const hasCellOverride = !isHeader && !!(ds.cellDropdowns[key] && ds.cellDropdowns[key].length);
  const startScope = isHeader ? 'column' : (hasCellOverride ? 'cell' : (ds.colDropdowns[ci] && ds.colDropdowns[ci].length ? 'column' : 'cell'));
  const existing = isHeader ? ds.colDropdowns[ci] : daGetEffectiveDropdown(ds, ri, ci);

  document.getElementById('daDropdownCellLabel').textContent = isHeader
    ? `all of column ${daColToLetters(ci)} (${ds.headers[ci] || ''})`
    : `cell ${daColToLetters(ci)}${ri + 1}`;
  document.getElementById('daDropdownOptionsInput').value = existing ? existing.join('\n') : '';
  document.getElementById('daDropdownRemoveBtn').style.display = existing && existing.length ? '' : 'none';

  // A header right-click can only ever mean "whole column" — hide the choice
  // entirely rather than show a scope toggle that has no other option.
  const scopeField = document.getElementById('daDropdownScopeCell').closest('.pdfed-export-field');
  scopeField.style.display = isHeader ? 'none' : '';
  daSetDropdownScope(startScope);

  document.getElementById('daDropdownOverlay').classList.add('open');
  setTimeout(() => document.getElementById('daDropdownOptionsInput').focus(), 50);
}

function daCloseDropdownModal() {
  document.getElementById('daDropdownOverlay').classList.remove('open');
}

function daSaveDropdownModal() {
  const ds = daGetActive(); if (!ds || !daDropdownCtx) { daCloseDropdownModal(); return; }
  daEnsureDropdownStore(ds);
  const { row: ri, col: ci } = daDropdownCtx;

  const raw = document.getElementById('daDropdownOptionsInput').value;
  const options = raw.split('\n').map(s => s.trim()).filter(s => s !== '');
  const deduped = [...new Set(options)];
  if (!deduped.length) { toast('Add at least one choice, one per line', 'info'); return; }

  const isHeader = ri === -1;
  const colors = daAutoAssignDropdownColors(deduped);
  if (isHeader || daDropdownScope === 'column') {
    ds.colDropdowns[ci] = deduped;
    ds.colDropdownColors[ci] = colors;
    // A column-wide list takes over, so any older single-cell overrides in
    // this column would just be confusing leftovers — clear them.
    Object.keys(ds.cellDropdowns).forEach(k => { if (k.endsWith('_' + ci)) delete ds.cellDropdowns[k]; });
    Object.keys(ds.cellDropdownColors).forEach(k => { if (k.endsWith('_' + ci)) delete ds.cellDropdownColors[k]; });
  } else {
    ds.cellDropdowns[ri + '_' + ci] = deduped;
    ds.cellDropdownColors[ri + '_' + ci] = colors;
  }

  daPersist();
  daRenderTable();
  daCloseDropdownModal();
  toast('Dropdown list saved', 'success');
}

function daRemoveDropdownFromModal() {
  if (!daDropdownCtx) { daCloseDropdownModal(); return; }
  daRemoveDropdown(daDropdownCtx.row, daDropdownCtx.col);
  daCloseDropdownModal();
}

function daRemoveDropdown(ri, ci) {
  const ds = daGetActive(); if (!ds) return;
  daEnsureDropdownStore(ds);
  if (ri === -1) {
    delete ds.colDropdowns[ci];
    delete ds.colDropdownColors[ci];
  } else {
    const key = ri + '_' + ci;
    if (ds.cellDropdowns[key]) { delete ds.cellDropdowns[key]; delete ds.cellDropdownColors[key]; }
    else { delete ds.colDropdowns[ci]; delete ds.colDropdownColors[ci]; } // was showing a column-level dropdown for this cell
  }
  daPersist();
  daRenderTable();
  toast('Dropdown removed', 'info');
}

// ─── Cell Links ("Insert Link") — modal + actions ───
let daLinkCtx = null; // { row, col } the modal is currently editing

// Opens the Insert/Edit Link modal for one cell. Called from the cell
// right-click menu (ri/ci given) or the toolbar "Link" button (no args,
// uses the currently focused cell, same convention as the Dropdown button).
function daOpenLinkModal(ri, ci) {
  const ds = daGetActive();
  if (!ds) { toast('Upload or create a table first', 'info'); return; }
  daEnsureLinksStore(ds);

  if (ri === undefined || ci === undefined) {
    if (!daActiveCell) { toast('Click a cell first, then add its link', 'info'); return; }
    ri = daActiveCell.row; ci = daActiveCell.col;
  }
  if (ri < 0 || ri >= ds.rows.length || ci < 0 || ci >= ds.headers.length) { toast('Pick a cell first', 'info'); return; }

  daLinkCtx = { row: ri, col: ci };
  const existing = daGetCellLink(ds, ri, ci);
  document.getElementById('daLinkCellLabel').textContent = `cell ${daColToLetters(ci)}${ri + 1}`;
  document.getElementById('daLinkUrlInput').value = existing || '';
  document.getElementById('daLinkTextInput').value = String(ds.rows[ri][ci] ?? '');
  document.getElementById('daLinkRemoveBtn').style.display = existing ? '' : 'none';
  document.getElementById('daLinkError').style.display = 'none';

  document.getElementById('daLinkOverlay').classList.add('open');
  setTimeout(() => document.getElementById('daLinkUrlInput').focus(), 50);
}

function daCloseLinkModal() {
  document.getElementById('daLinkOverlay').classList.remove('open');
}

function daSaveLinkModal() {
  const ds = daGetActive(); if (!ds || !daLinkCtx) { daCloseLinkModal(); return; }
  daEnsureLinksStore(ds);
  const { row: ri, col: ci } = daLinkCtx;

  const rawUrl = document.getElementById('daLinkUrlInput').value;
  const url = daNormalizeLinkUrl(rawUrl);
  if (!url) {
    const err = document.getElementById('daLinkError');
    err.textContent = 'Enter a web address, email, or phone number to link to';
    err.style.display = 'block';
    return;
  }

  ds.links[ri + '_' + ci] = url;

  // The display text field defaults to the cell's current value, but a
  // person can change it here — same as Excel/Sheets, where a hyperlink's
  // display text and its target are edited together.
  const displayText = document.getElementById('daLinkTextInput').value.trim();
  if (displayText && displayText !== String(ds.rows[ri][ci] ?? '')) {
    ds.rows[ri][ci] = displayText;
  }

  daRecalcColumnOps(ds);
  daPersist();
  daRenderTable();
  daCloseLinkModal();
  toast('Link added', 'success');
}

function daRemoveLinkFromModal() {
  if (!daLinkCtx) { daCloseLinkModal(); return; }
  daRemoveLink(daLinkCtx.row, daLinkCtx.col);
  daCloseLinkModal();
}

function daRemoveLink(ri, ci) {
  const ds = daGetActive(); if (!ds) return;
  daEnsureLinksStore(ds);
  const key = ri + '_' + ci;
  if (ds.links[key]) delete ds.links[key];
  daPersist();
  daRenderTable();
  toast('Link removed', 'info');
}

// ─── Highlight modal — color-tag whatever's currently selected ───
let daHighlightColor = DA_HIGHLIGHT_COLORS[0];

// Right-click "Highlight Cell…" / "Highlight Column…" — sets the selection
// to just the clicked target (row headers have no cell of their own to
// highlight individually, so ri === -1 always means "this column") and
// opens the modal on it, regardless of whatever was selected before.
function daContextHighlight(ri, ci) {
  if (ri === -1) {
    daSelection = { rows: new Set(), cols: new Set([ci]), cellRanges: [] };
  } else {
    daSelection = { rows: new Set(), cols: new Set(), cellRanges: [{ r1: ri, c1: ci, r2: ri, c2: ci }] };
  }
  daRenderTable();
  daOpenHighlightModal();
}

// Opens the modal against the current selection (rows/cols/cell ranges).
// If nothing is selected, falls back to the focused cell, same convention
// as the Dropdown/Link toolbar buttons.
function daOpenHighlightModal() {
  const ds = daGetActive();
  if (!ds) { toast('Upload or create a table first', 'info'); return; }
  daEnsureHighlightStore(ds);

  if (!daHasSelection()) {
    if (!daActiveCell) { toast('Select a row, column, or cell range first (or click a cell), then Highlight', 'info'); return; }
    daSelection = { rows: new Set(), cols: new Set(), cellRanges: [{ r1: daActiveCell.row, c1: daActiveCell.col, r2: daActiveCell.row, c2: daActiveCell.col }] };
    daRenderTable();
  }

  const parts = [];
  if (daSelection.rows.size) parts.push(`${daSelection.rows.size} row${daSelection.rows.size === 1 ? '' : 's'}`);
  if (daSelection.cols.size) parts.push(`${daSelection.cols.size} column${daSelection.cols.size === 1 ? '' : 's'}`);
  if (daSelection.cellRanges.length) {
    let cellCount = 0;
    daSelection.cellRanges.forEach(rg => { cellCount += (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1); });
    parts.push(`${cellCount} cell${cellCount === 1 ? '' : 's'}`);
  }
  document.getElementById('daHighlightTargetLabel').textContent = parts.join(', ') || 'the current selection';

  // Pre-fill from an existing highlight if the selection is a single
  // already-tagged row/column/cell, so re-opening to tweak a tag doesn't
  // start blank.
  let existing = null;
  if (daSelection.rows.size === 1 && !daSelection.cols.size && !daSelection.cellRanges.length) {
    existing = ds.rowHighlights[[...daSelection.rows][0]];
  } else if (daSelection.cols.size === 1 && !daSelection.rows.size && !daSelection.cellRanges.length) {
    existing = ds.colHighlights[[...daSelection.cols][0]];
  } else if (daSelection.cellRanges.length === 1) {
    const rg = daSelection.cellRanges[0];
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) existing = ds.cellHighlights[rg.r1 + '_' + rg.c1];
  }
  daHighlightColor = (existing && existing.color) || DA_HIGHLIGHT_COLORS[0];
  document.getElementById('daHighlightTagInput').value = (existing && existing.tag) || '';
  document.getElementById('daHighlightRemoveBtn').style.display = existing ? '' : 'none';

  const swatchRow = document.getElementById('daHighlightSwatchRow');
  swatchRow.innerHTML = DA_HIGHLIGHT_COLORS.map(c => `<div class="da-hl-swatch${c === daHighlightColor ? ' active' : ''}" style="background:${c}" onclick="daPickHighlightColor('${c}', this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`).join('');

  document.getElementById('daHighlightOverlay').classList.add('open');
}

function daPickHighlightColor(color, el) {
  daHighlightColor = color;
  document.querySelectorAll('#daHighlightSwatchRow .da-hl-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function daCloseHighlightModal() {
  document.getElementById('daHighlightOverlay').classList.remove('open');
}

function daSaveHighlightModal() {
  const ds = daGetActive(); if (!ds || !daHasSelection()) { daCloseHighlightModal(); return; }
  daEnsureHighlightStore(ds);
  const tag = document.getElementById('daHighlightTagInput').value.trim();
  const entry = { color: daHighlightColor, tag };

  daSelection.rows.forEach(ri => { ds.rowHighlights[ri] = entry; });
  daSelection.cols.forEach(ci => { ds.colHighlights[ci] = entry; });
  daSelection.cellRanges.forEach(rg => {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) ds.cellHighlights[r + '_' + c] = entry;
    }
  });

  daPersist();
  daRenderTable();
  daCloseHighlightModal();
  toast('Highlight applied', 'success');
}

function daRemoveHighlightFromModal() {
  const ds = daGetActive(); if (!ds || !daHasSelection()) { daCloseHighlightModal(); return; }
  daEnsureHighlightStore(ds);
  daSelection.rows.forEach(ri => { delete ds.rowHighlights[ri]; });
  daSelection.cols.forEach(ci => { delete ds.colHighlights[ci]; });
  daSelection.cellRanges.forEach(rg => {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) delete ds.cellHighlights[r + '_' + c];
    }
  });
  daPersist();
  daRenderTable();
  daCloseHighlightModal();
  toast('Highlight removed', 'info');
}

// Opens a cell's linked URL in a new tab. Kept as its own function (rather
// than an inline href) so it works the same from the badge click, the
// context menu's "Open Link", and any future entry point.
function daOpenCellLink(ri, ci) {
  const ds = daGetActive(); if (!ds) return;
  const url = daGetCellLink(ds, ri, ci);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function daToggleFreeze() {
  const ds = daGetActive(); if (!ds) return;
  ds.frozen = !ds.frozen;
  document.getElementById('daFreezeBtn').classList.toggle('active', ds.frozen);
  daRenderTable();
}

// Loosens the per-cell max-width clamp so long values are fully visible
// without any cell text overlapping its neighbors.
function daAutoFit() {
  const ds = daGetActive(); if (!ds) return;
  document.querySelectorAll('#daGridWrap .da-th-cell, #daGridWrap .da-td-cell').forEach(el => {
    el.style.maxWidth = '420px';
    el.style.whiteSpace = 'normal';
    el.style.overflow = 'visible';
    el.style.textOverflow = 'clip';
  });
  toast('Columns auto-fit to content', 'success');
}
