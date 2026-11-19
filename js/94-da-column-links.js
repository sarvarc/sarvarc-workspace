// ─── DATA ARRANGEMENT: ONE-CLICK COLUMN LINKS ────────────────────────────────────────────
// Problem: connecting tables meant opening "Connect columns" or "Add summary", then picking a
// table, a column, another column and the columns to pull in. Too many choices.
//
// Now, while the Interconnect switch is ON, a small link icon appears on the header of every
// column that can be connected. Click it and one small card opens with the answer already filled
// in. One click on the card's button and it is done.
//
//   Amber glowing icon  = "this column matches a column in another table, connect it".
//   Blue outline icon   = "other tables use this column, add a count or a total from them".
//   Solid blue icon     = already connected.
//
// Nothing connects on its own. The switch stays the person's choice and every link is made by a
// click. The real work is done by the existing daApplyLink / daApplySummary (js/31), and the
// matches are found by the same value finder Kadessa uses (js/76). No new formula logic.
// The old "Connect columns" and "Add summary" buttons stay for anything this does not suggest.

const DA_CL_MAX_ROWS = 3000;   // rows read per table when looking for matches (keeps big tables fast)
const DA_CL_MAX_PULLS = 3;     // columns ticked by default in the card
let _daCl = { data: null, dirty: true, timer: null, announce: false };

// ── 1. Finding matches (pure, no drawing) ──────────────────────────────────────────────
function daClCompute() {
  const out = { byId: new Map(), count: 0 };
  if (typeof daState === 'undefined' || !Array.isArray(daState.datasets)) return out;
  const real = daState.datasets.filter(d => d && Array.isArray(d.headers) && d.headers.length).slice(0, 12);
  if (real.length < 2) return out;
  const list = real.map(d => ({ id: d.id, name: d.name, headers: d.headers, rows: (d.rows || []).slice(0, DA_CL_MAX_ROWS) }));
  const prof = list.map(daRelProfile);
  const links = daRelFindValueLinks(list, prof);
  const byName = new Map(); real.forEach(d => { const k = String(d.name).trim().toLowerCase(); if (!byName.has(k)) byName.set(k, d); });
  const find = (n) => byName.get(String(n).trim().toLowerCase());
  const idx = (t, h) => t.headers.findIndex(x => String(x == null ? '' : x) === String(h));
  const slot = (id) => { if (!out.byId.has(id)) out.byId.set(id, { child: [], parent: [] }); return out.byId.get(id); };
  links.forEach(l => {
    const child = find(l.childTable), parent = find(l.parentTable);
    if (!child || !parent || child === parent) return;
    const cc = idx(child, l.childColumn), pc = idx(parent, l.parentColumn);
    if (cc < 0 || pc < 0) return;
    slot(child.id).child.push({ col: cc, colName: l.childColumn, parentId: parent.id, parentName: parent.name, parentCol: pc, parentColName: l.parentColumn,
      pct: l.matchPercent, conf: l.confidence, noPartner: l.childRowsWithNoPartner || 0, examples: l.valuesWithNoPartner || [] });
    slot(parent.id).parent.push({ col: pc, colName: l.parentColumn, childId: child.id, childName: child.name, childCol: cc, childColName: l.childColumn,
      pct: l.matchPercent, conf: l.confidence });
  });
  // Count only what is still waiting for a click.
  out.byId.forEach((v, id) => { const ds = daState.datasets.find(d => d.id === id); v.child.forEach(e => { if (!daClIsLinked(ds, e)) out.count++; }); });
  return out;
}
function daClIsLinked(ds, e) {
  return !!(ds && (ds.xlinks || []).some(l => l.keyCol === e.col && l.toId === e.parentId));
}
function daClPulledNow(ds, e) {
  const l = (ds.xlinks || []).find(x => x.keyCol === e.col && x.toId === e.parentId);
  return l ? new Set((l.map || []).map(m => m.theirs)) : new Set();
}
// Columns of the other table that are ticked when the card opens: the first few that are not the key.
function daClDefaultPulls(t, tk, already) {
  const pick = [];
  for (let i = 0; i < t.headers.length && pick.length < DA_CL_MAX_PULLS; i++) {
    if (i === tk || already.has(i) || String(t.headers[i] == null ? '' : t.headers[i]).trim() === '') continue;
    pick.push(i);
  }
  return pick;
}
// Number columns of a table (for "Total of ..."), skipping the key and any ID-like column.
function daClNumberCols(t, except) {
  const rows = (t.rows || []).slice(0, 500), out = [];
  t.headers.forEach((h, ci) => {
    if (ci === except || DA_REL_KEYWORD.test(String(h))) return;
    if (typeof daSummaryBlockReason === 'function' && daSummaryBlockReason(t, ci)) return; // never offer to add up years
    let filled = 0, num = 0;
    rows.forEach(r => { const v = r ? r[ci] : ''; if (daRelIsFormula(v)) return; const s = String(v == null ? '' : v).trim(); if (s === '') return; filled++; if (!isNaN(parseFloat(daCleanNum(s)))) num++; });
    if (filled >= 2 && num / filled >= 0.8) out.push(ci);
  });
  return out;
}
function daClSummaryDone(ds, e, kind, valCol) {
  return (ds.xsums || []).some(s => s.toId === e.childId && s.keyCol === e.col && s.toCol === e.childCol && s.kind === kind && (kind === 'count' || s.valCol === valCol) && ds.headers[s.ours] === s.name);
}

// ── 2. The actions (each is ONE call into the existing engine) ────────────────────────────
function daClConnect(ds, e, pulls) {
  const t = daState.datasets.find(d => d.id === e.parentId); if (!t) throw new Error('table not found');
  const added = daApplyLink(ds, t, e.col, e.parentCol, pulls);
  _daCl.dirty = true;
  return added;
}
function daClAddSummary(ds, e, kind, valCol) {
  const t = daState.datasets.find(d => d.id === e.childId); if (!t) throw new Error('table not found');
  const name = daApplySummary(ds, t, e.col, e.childCol, kind, kind === 'count' ? -1 : valCol, -1, '');
  _daCl.dirty = true;
  return name;
}

// ── 3. Drawing: icons on column headers ──────────────────────────────────────────────────
// Look: SARVARC cyan to blue, rounded, calm. Amber is kept for warnings only (values with no match).
const DA_CL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="12" r="2.9"/><circle cx="18.5" cy="12" r="2.9"/><path d="M8.6 12h6.8"/></svg>';
const DA_CL_SVG_LG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="12" r="2.9"/><circle cx="18.5" cy="12" r="2.9"/><path d="M8.6 12h6.8"/></svg>';
function daClStyle() {
  if (document.getElementById('daClStyle')) return;
  const st = document.createElement('style'); st.id = 'daClStyle';
  st.textContent =
    '.da-cl-btn,.da-clp,.da-cl-pulled{--cl-ink:var(--blue);--cl-grad:linear-gradient(135deg,#00C2FF 0%,#0073E6 100%);--cl-tint:rgba(0,194,255,.12)}' +
    '[data-theme="light"] .da-cl-btn,[data-theme="light"] .da-clp,[data-theme="light"] .da-cl-pulled{--cl-ink:#0073E6;--cl-tint:rgba(0,115,230,.09)}' +
    /* header icon */
    '.da-cl-btn{position:relative;flex-shrink:0;width:21px;height:21px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border2);background:var(--cl-tint);color:var(--cl-ink);cursor:pointer;padding:0;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}' +
    '.da-cl-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px -3px rgba(0,194,255,.55);border-color:var(--cl-ink)}' +
    '.da-cl-btn.da-cl-sug{border-color:var(--cl-ink);background:var(--cl-tint)}' +
    '.da-cl-btn.da-cl-sug::after{content:"";position:absolute;top:-3px;right:-3px;width:7px;height:7px;border-radius:50%;background:var(--cl-grad);box-shadow:0 0 0 2px var(--bg3);animation:daClHalo 2.2s ease-out infinite}' +
    '.da-cl-btn.da-cl-par{background:transparent}' +
    '.da-cl-btn.da-cl-on{background:var(--cl-grad);border-color:transparent;color:#fff;box-shadow:0 3px 10px -3px rgba(0,194,255,.6)}' +
    '.da-cl-pulled{flex-shrink:0;display:inline-flex;align-items:center;color:var(--cl-ink);opacity:.55}' +
    '@keyframes daClHalo{0%{box-shadow:0 0 0 2px var(--bg3),0 0 0 2px rgba(0,194,255,.55)}100%{box-shadow:0 0 0 2px var(--bg3),0 0 0 9px rgba(0,194,255,0)}}' +
    '@keyframes daClIn{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.da-cl-btn.da-cl-sug::after,.da-clp{animation:none}}' +
    /* card */
    '.da-clp{position:fixed;z-index:9998;width:min(372px,94vw);background:var(--bg2);color:var(--text);border:1px solid var(--border2);border-radius:14px;padding:0;font-size:12.5px;box-shadow:0 18px 48px -12px rgba(0,20,50,.55),0 0 0 1px rgba(0,194,255,.06);animation:daClIn .14s ease-out;overflow:visible}' +
    '[data-theme="light"] .da-clp{box-shadow:0 18px 44px -14px rgba(0,60,140,.28),0 0 0 1px rgba(0,194,255,.08)}' +
    '.da-clp::before{content:"";position:absolute;top:-6px;left:var(--cl-arrow,24px);width:10px;height:10px;background:var(--bg2);border-left:1px solid var(--border2);border-top:1px solid var(--border2);transform:rotate(45deg)}' +
    '.da-clp.flip::before{display:none}' +
    '.da-clp-in{border-radius:14px;overflow:hidden;position:relative;background:var(--bg2)}' +
    '.da-clp-in::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--cl-grad)}' +
    '.da-clp-head{display:flex;align-items:center;gap:10px;padding:14px 14px 10px}' +
    '.da-clp-badge{width:30px;height:30px;border-radius:9px;background:var(--cl-grad);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 5px 14px -5px rgba(0,194,255,.7)}' +
    '.da-clp-ht{min-width:0;flex:1}.da-clp-title{font-size:13.5px;font-weight:800;letter-spacing:.1px}' +
    '.da-clp-sub{color:var(--text2);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}' +
    '.da-clp-x{width:22px;height:22px;border-radius:7px;border:0;background:transparent;color:var(--text3);font-size:15px;line-height:1;cursor:pointer;flex-shrink:0}.da-clp-x:hover{background:var(--surface2);color:var(--text)}' +
    '.da-clp .rel{padding:2px 14px 14px}.da-clp .rel+.rel,.da-clp .par{border-top:1px solid var(--border)}.da-clp .par{padding:12px 14px 14px}' +
    '.da-clp .lab{font-size:9.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:var(--cl-ink);margin:12px 0 6px}' +
    /* route: from column to column */
    '.da-clp .route{display:flex;align-items:center;gap:0;margin-top:2px}' +
    '.da-clp .pill{min-width:0;flex:1 1 0;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:6px 9px;display:flex;flex-direction:column;gap:1px}' +
    '.da-clp .pill i{font-style:normal;font-size:9.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.da-clp .pill b{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.da-clp .wire{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:3px;padding:0 7px;color:var(--cl-ink)}' +
    '.da-clp .wire u{display:block;width:34px;height:2px;border-radius:2px;background:var(--cl-grad);text-decoration:none}' +
    '.da-clp .wire em{font-style:normal;font-size:9.5px;font-weight:800;color:var(--green);background:rgba(16,185,129,.12);border-radius:20px;padding:1px 7px;white-space:nowrap}' +
    '.da-clp .wire em.soft{color:var(--cl-ink);background:var(--cl-tint)}' +
    '.da-clp .warn{margin-top:10px;border-left:3px solid #f59e0b;background:rgba(245,158,11,.10);border-radius:0 8px 8px 0;padding:7px 10px;color:var(--text);line-height:1.45;font-size:11.5px}' +
    /* column choices */
    '.da-clp .cols{display:flex;flex-direction:column;gap:3px;max-height:196px;overflow:auto;margin:0 -4px;padding:0 4px}' +
    '.da-clp label.opt{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:background .1s}' +
    '.da-clp label.opt:hover{background:var(--surface)}.da-clp label.opt.on{background:var(--cl-tint);border-color:var(--border2)}.da-clp label.opt.done{opacity:.55;cursor:default}' +
    '.da-clp label.opt input{position:absolute;opacity:0;pointer-events:none}' +
    '.da-clp .box{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--text3);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .1s}' +
    '.da-clp label.opt input:checked+.box{background:var(--cl-grad);border-color:transparent}' +
    '.da-clp label.opt input:checked+.box::after{content:"";width:8px;height:4px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}' +
    '.da-clp label.opt input:focus-visible+.box{box-shadow:0 0 0 3px rgba(0,194,255,.35)}' +
    '.da-clp .nm{font-weight:700;white-space:nowrap}.da-clp .sm{color:var(--text2);font-size:11px;min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}' +
    '.da-clp .tg{font-size:8.5px;font-weight:800;letter-spacing:.3px;color:var(--text3);background:var(--surface2);border-radius:4px;padding:1px 5px;flex-shrink:0}' +
    /* footer + buttons */
    '.da-clp .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}' +
    '.da-clp button{font:inherit}' +
    '.da-clp .go{border:0;border-radius:10px;padding:9px 15px;font-weight:800;font-size:12.5px;color:#fff;cursor:pointer;background:var(--cl-grad);box-shadow:0 8px 18px -8px rgba(0,194,255,.75);transition:transform .1s,box-shadow .1s}' +
    '.da-clp .go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 22px -8px rgba(0,194,255,.9)}.da-clp .go:disabled{opacity:.4;cursor:default;box-shadow:none}' +
    '.da-clp .lnk{border:0;background:transparent;color:var(--text2);cursor:pointer;font-size:11.5px;padding:6px 4px;border-radius:6px}.da-clp .lnk:hover{color:var(--cl-ink)}' +
    /* other tables use this column */
    '.da-clp .prow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;margin-top:6px;border:1px solid var(--border);background:var(--surface);border-radius:10px}' +
    '.da-clp .pt{min-width:0;display:flex;flex-direction:column;gap:1px}.da-clp .pt b{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.da-clp .pt span{font-size:10.5px;color:var(--text2)}' +
    '.da-clp .pa{display:flex;gap:6px;flex-shrink:0}' +
    '.da-clp .chip,.da-clp .pa select{border:1px solid var(--border2);background:var(--bg2);color:var(--text);border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer}' +
    '.da-clp .chip:hover:not(:disabled),.da-clp .pa select:hover{border-color:var(--cl-ink);color:var(--cl-ink)}.da-clp .chip:disabled{opacity:.55;cursor:default;color:var(--green);border-color:transparent;background:rgba(16,185,129,.1)}';
  document.head.appendChild(st);
}
function daClData() {
  _daCl.data = daClCompute(); _daCl.dirty = false;
  return _daCl.data;
}
function daClDecorate() {
  const wrap = document.getElementById('daGridWrap'); if (!wrap) return;
  wrap.querySelectorAll('.da-cl-btn,.da-cl-pulled').forEach(n => n.remove());
  if (!daState.interconnect) return;
  const ds = daState.datasets.find(d => d.id === daState.activeId); if (!ds) return;
  daClStyle();
  if (!_daCl.data) return; // matches are not found yet; the scheduled pass draws the icons
  const info = _daCl.data.byId.get(ds.id) || { child: [], parent: [] };
  const place = (ci, node) => {
    const th = wrap.querySelector('th[data-ci="' + ci + '"] .da-th-cell'); if (!th) return;
    th.insertBefore(node, th.querySelector('.da-th-type'));
  };
  // Columns that were pulled in from another table: a small chain, so people see why they are live.
  (ds.xlinks || []).forEach(l => {
    const from = daState.datasets.find(d => d.id === l.toId); if (!from) return;
    (l.map || []).forEach(m => {
      const s = document.createElement('span'); s.className = 'da-cl-pulled'; s.innerHTML = DA_CL_SVG;
      s.title = 'Pulled live from ' + from.name + ' (' + (from.headers[m.theirs] == null ? '' : from.headers[m.theirs]) + ')';
      place(m.ours, s);
    });
  });
  // One icon per column. A column that waits for a connection wins over the others.
  const cols = new Map();
  info.child.forEach(e => {
    const prev = cols.get(e.col) || {};
    prev.child = (prev.child || []).concat(e); cols.set(e.col, prev);
  });
  info.parent.forEach(e => {
    const prev = cols.get(e.col) || {};
    prev.parent = (prev.parent || []).concat(e); cols.set(e.col, prev);
  });
  cols.forEach((v, ci) => {
    const waiting = (v.child || []).filter(e => !daClIsLinked(ds, e));
    const linked = (v.child || []).filter(e => daClIsLinked(ds, e));
    let cls, tip;
    if (waiting.length) { cls = 'da-cl-sug'; tip = 'Connect to ' + waiting[0].parentName + '. Click to bring in its details.'; }
    else if (linked.length) { cls = 'da-cl-on'; tip = 'Connected to ' + linked[0].parentName + '. Click to bring in more columns.'; }
    else {
      const done = (v.parent || []).some(e => (ds.xsums || []).some(s => s.toId === e.childId && s.keyCol === e.col));
      cls = done ? 'da-cl-on' : 'da-cl-par';
      tip = 'Used by ' + (v.parent || []).map(e => e.childName).join(', ') + '. Click to add counts and totals.';
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'da-cl-btn ' + cls; b.title = tip; b.innerHTML = DA_CL_SVG;
    b.onmousedown = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); daClOpenCard(b, ds, ci, v); };
    place(ci, b);
  });
}

// ── 4. The card that opens under the icon ─────────────────────────────────────────────────
function daClCloseCard() { const p = document.getElementById('daClCard'); if (p) p.remove(); document.removeEventListener('mousedown', daClOutside, true); document.removeEventListener('keydown', daClKey, true); }
function daClOutside(e) { const p = document.getElementById('daClCard'); if (p && !p.contains(e.target) && !(e.target.closest && e.target.closest('.da-cl-btn'))) daClCloseCard(); }
function daClKey(e) { if (e.key === 'Escape') daClCloseCard(); }
function daClSample(t, ci) {
  for (let i = 0; i < Math.min((t.rows || []).length, 60); i++) {
    const v = t.rows[i] ? t.rows[i][ci] : ''; if (daRelIsFormula(v)) continue;
    const x = String(v == null ? '' : v).trim(); if (x !== '') return x.length > 24 ? x.slice(0, 23) + '\u2026' : x;
  }
  return '';
}
function daClOpenCard(anchor, ds, ci, v) {
  daClCloseCard();
  const card = document.createElement('div'); card.id = 'daClCard'; card.className = 'da-clp';
  const E = daEsc, hn = (t, i) => String(t.headers[i] == null ? '' : t.headers[i]);
  const first = (v.child || [])[0], firstP = (v.parent || [])[0];
  const title = first ? (daClIsLinked(ds, first) ? 'Connected: ' + hn(ds, ci) : 'Connect ' + hn(ds, ci)) : 'Use ' + hn(ds, ci) + ' in other tables';
  const sub = first ? E(ds.name) + ' \u2192 ' + E(first.parentName) : E(ds.name) + (firstP ? ' \u2190 ' + E(firstP.childName) : '');
  let html = '<div class="da-clp-in"><div class="da-clp-head"><span class="da-clp-badge">' + DA_CL_SVG_LG + '</span><div class="da-clp-ht"><div class="da-clp-title">' + E(title) + '</div><div class="da-clp-sub">' + sub + '</div></div><button type="button" class="da-clp-x" aria-label="Close">\u00d7</button></div>';

  // A) this column points at another table's list: connect and pull details in.
  (v.child || []).forEach((e, k) => {
    const t = daState.datasets.find(d => d.id === e.parentId); if (!t) return;
    const already = daClPulledNow(ds, e), picks = new Set(daClDefaultPulls(t, e.parentCol, already));
    const linked = daClIsLinked(ds, e);
    html += '<div class="rel" data-k="' + k + '"><div class="route"><span class="pill"><i>' + E(ds.name) + '</i><b>' + E(e.colName) + '</b></span>' +
      '<span class="wire"><u></u><em class="' + (e.conf === 'possible' ? 'soft' : '') + '">' + (e.conf === 'possible' ? 'Possible ' : '') + e.pct + '% match</em></span>' +
      '<span class="pill"><i>' + E(t.name) + '</i><b>' + E(e.parentColName) + '</b></span></div>' +
      (e.noPartner ? '<div class="warn"><b>' + e.noPartner + ' value' + (e.noPartner === 1 ? '' : 's') + ' without a match</b>' + (e.examples.length ? ' (' + E(e.examples.slice(0, 3).join(', ')) + ')' : '') + '. They will be marked in amber so you can fix them.</div>' : '') +
      '<div class="lab">' + (linked ? 'Bring in more' : 'Bring in') + '</div><div class="cols">' +
      t.headers.map((h, i) => {
        if (i === e.parentCol) return '';
        const done = already.has(i), smp = daClSample(t, i), num = /^[-+]?[\u20b9$\u20ac\u00a3]?\s*\d[\d,]*(\.\d+)?\s*%?$/.test(smp);
        return '<label class="opt' + (done ? ' done' : '') + '"><input type="checkbox" value="' + i + '"' + (done ? ' checked disabled' : picks.has(i) ? ' checked' : '') + '><span class="box"></span><span class="nm">' + E(hn(t, i)) + '</span><span class="sm">' + (done ? 'added' : E(smp)) + '</span><span class="tg">' + (num ? 'NUM' : 'TXT') + '</span></label>';
      }).join('') +
      '</div><div class="foot"><button type="button" class="lnk" data-more="' + k + '">More options</button><button type="button" class="go" data-go="' + k + '"></button></div></div>';
  });

  // B) other tables point at this column: add a count or a total from them.
  const par = (v.parent || []);
  if (par.length) {
    html += '<div class="par"><div class="lab" style="margin-top:0">Add from other tables</div>';
    par.forEach((e, k) => {
      const t = daState.datasets.find(d => d.id === e.childId); if (!t) return;
      const nums = daClNumberCols(t, e.childCol), cDone = daClSummaryDone(ds, e, 'count');
      html += '<div class="prow"><div class="pt"><b>' + E(t.name) + '</b><span>matched by ' + E(e.childColName) + '</span></div><div class="pa">' +
        '<button type="button" class="chip" data-cnt="' + k + '"' + (cDone ? ' disabled' : '') + '>' + (cDone ? 'Count added' : 'Count rows') + '</button>' +
        (nums.length ? '<select data-sum="' + k + '"><option value="">Total of\u2026</option>' + nums.map(i => daClSummaryDone(ds, e, 'sum', i) ? '' : '<option value="' + i + '">' + E(hn(t, i)) + '</option>').join('') + '</select>' : '') +
        '</div></div>';
    });
    html += '</div>';
  }
  html += '</div>';
  card.innerHTML = html;
  document.body.appendChild(card);
  card.querySelector('.da-clp-x').onclick = daClCloseCard;

  // Button text follows the ticks, so the person always sees what one click will do.
  const refresh = (rel) => {
    const n = rel.querySelectorAll('.cols input:checked:not(:disabled)').length, go = rel.querySelector('.go');
    go.disabled = n === 0; go.textContent = n === 0 ? 'Tick a column' : 'Connect ' + n + ' column' + (n === 1 ? '' : 's');
    rel.querySelectorAll('label.opt').forEach(l => l.classList.toggle('on', !!l.querySelector('input:checked:not(:disabled)')));
  };
  card.querySelectorAll('.rel[data-k]').forEach(rel => { refresh(rel); rel.addEventListener('change', () => refresh(rel)); });
  card.querySelectorAll('[data-go]').forEach(btn => btn.onclick = () => {
    const e = v.child[+btn.dataset.go], rel = btn.closest('.rel');
    const pulls = [...rel.querySelectorAll('.cols input:checked:not(:disabled)')].map(i => +i.value);
    if (!pulls.length) return;
    daClCloseCard();
    try { const n = daClConnect(ds, e, pulls); if (typeof toast === 'function') toast('Connected ' + n + ' column' + (n === 1 ? '' : 's') + ' from ' + e.parentName + '.', 'success'); }
    catch (err) { if (typeof toast === 'function') toast('Could not connect: ' + err.message, 'error'); }
  });
  card.querySelectorAll('[data-more]').forEach(btn => btn.onclick = () => {
    const e = v.child[+btn.dataset.more]; daClCloseCard(); daOpenLinkDialog();
    const ov = document.querySelector('.da-xdlg'); if (!ov) return;
    const set = (id, val) => { const el = ov.querySelector(id); if (el) { el.value = String(val); el.dispatchEvent(new Event('change')); } };
    set('#daXk', e.col); set('#daXt', e.parentId); set('#daXtk', e.parentCol);
  });
  card.querySelectorAll('[data-cnt]').forEach(btn => btn.onclick = () => {
    const e = par[+btn.dataset.cnt]; daClCloseCard();
    try { const nm = daClAddSummary(ds, e, 'count', -1); if (typeof toast === 'function') toast('Added "' + nm + '".', 'success'); }
    catch (err) { if (typeof toast === 'function') toast('Could not add: ' + err.message, 'error'); }
  });
  card.querySelectorAll('[data-sum]').forEach(sel => sel.onchange = () => {
    if (sel.value === '') return;
    const e = par[+sel.dataset.sum], vc = +sel.value; daClCloseCard();
    try { const nm = daClAddSummary(ds, e, 'sum', vc); if (typeof toast === 'function') toast('Added "' + nm + '".', 'success'); }
    catch (err) { if (typeof toast === 'function') toast('Could not add: ' + err.message, 'error'); }
  });

  // Place it under the icon, kept inside the screen; a small arrow points back at the icon.
  const r = anchor.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
  const left = Math.max(8, Math.min(r.left - 14, window.innerWidth - w - 8));
  let top = r.bottom + 10, flip = false;
  if (top + h > window.innerHeight - 8) { top = Math.max(8, Math.min(r.top - h - 10, window.innerHeight - h - 8)); flip = top < r.top; }
  card.style.left = left + 'px'; card.style.top = top + 'px';
  card.style.setProperty('--cl-arrow', Math.max(12, Math.min(r.left + r.width / 2 - left - 5, w - 24)) + 'px');
  if (flip) card.classList.add('flip');
  setTimeout(() => { document.addEventListener('mousedown', daClOutside, true); document.addEventListener('keydown', daClKey, true); }, 0);
}

// ── 5. Hooks: draw icons after every table draw, refresh matches a moment after edits ─────
function daClSchedule(ms) {
  clearTimeout(_daCl.timer);
  _daCl.timer = setTimeout(() => {
    if (!daState.interconnect) return;
    try {
      const d = daClData(); daClDecorate();
      if (_daCl.announce) {
        _daCl.announce = false;
        if (d.count > 0 && typeof toast === 'function') toast('Found ' + d.count + ' possible connection' + (d.count === 1 ? '' : 's') + '. Click the glowing link icon on a column header.', 'info');
      }
    } catch (e) { console.warn('[Interconnect] column links failed', e); }
  }, ms);
}
const _daRenderTableCl = daRenderTable;
daRenderTable = function () {
  const r = _daRenderTableCl.apply(this, arguments);
  if (daState.interconnect) { try { daClDecorate(); } catch (e) { console.warn('[Interconnect] column icons failed', e); } if (!_daCl.data || _daCl.announce) daClSchedule(0); }
  return r;
};
const _daPersistCl = daPersist;
daPersist = function () {
  const r = _daPersistCl.apply(this, arguments);
  if (daState.interconnect) { _daCl.dirty = true; daClSchedule(700); }
  return r;
};
const _daToggleCl = daToggleInterconnect;
daToggleInterconnect = function (on) {
  _daCl.dirty = true; _daCl.announce = !!on;
  const r = _daToggleCl.apply(this, arguments);
  if (!on) daClCloseCard();
  return r;
};
