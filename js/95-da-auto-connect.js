// ─── DATA ARRANGEMENT: AUTO-CONNECT (only while the Interconnect switch is ON) ────────────
// Before: with the switch on, the app found matching columns and showed a glowing icon. A person
// still had to click it for every table.
//
// Now: while the switch is ON the app makes the same connections by itself. Nothing is asked.
//   - A table whose ID column matches another table's ID column is linked to it.
//   - The details that matter (status first, then name and the rest) are pulled in live, so a
//     change typed once in the main table shows up in every connected table.
//   - The main table gets a "No. of <table>" count, so an analyst sees the whole story in one row.
//   - A form's responses table joins the same way, as soon as it shares a column (Email, Phone,
//     an ID) with another table.
// While the switch is OFF nothing is linked. Turning it off later keeps the last values, as before.
//
// No new formula logic. The real work is done by the existing pieces:
//   daClCompute (js/94, finds matches from real values), daApplyLink and daApplySummary (js/31).
//
// Safety rules, on purpose:
//   - Only "strong" and "likely" matches, and only when the main table's column is an identifier
//     (ID, code, ref, number, key, SKU, email, phone). A plain Name column is never linked by itself.
//   - Each pair is auto-linked ONCE. If a person deletes the columns or presses Undo, it does not
//     come back. (The list of done pairs is kept in the table and in localStorage.)
//   - It never rebuilds the table while someone is typing; it waits until they stop.
//   - Very large pairs (rows x rows over 4 million) are left to the manual icon.
//   - At most 8 new connections per pass. The rest are done on the next pass.
//   - One notice with an Undo button says what was connected.

const DA_AC_MAX_PER_PASS = 8;
const DA_AC_PULLS = 4;                       // columns brought in per connection
const DA_AC_MAX_WORK = 4000000;              // parent rows x child rows
const DA_AC_STORE = 'sarvarcDaAutoDone_v1';
const DA_AC_ID_WORD = /(^|[^a-z0-9])(id|code|ref|reference|no|number|key|sku)([^a-z0-9]|$)/i;
const DA_AC_CONTACT_WORD = /e-?mail|phone|mobile|whatsapp/i;
const DA_AC_STATUS_WORD = /status|stage|contact|state|priority|owner|assigned/i;
const DA_AC_NAME_WORD = /name|company|client|customer|title|property|service|product/i;

let _daAc = { timer: null, running: false, stale: true, lastSig: '', tries: 0, last: null, done: null };

// ── memory of pairs already auto-linked (so a removed or undone link never comes back) ──────
function daAcDoneSet() {
  if (_daAc.done) return _daAc.done;
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(DA_AC_STORE) || '[]'); } catch (e) { arr = []; }
  _daAc.done = new Set(Array.isArray(arr) ? arr : []);
  return _daAc.done;
}
function daAcKey(ds, e) { return ds.id + '|' + e.col + '|' + e.parentId; }
function daAcSeen(ds, e) {
  return daAcDoneSet().has(daAcKey(ds, e)) || (ds.autoDone || []).indexOf(e.col + '|' + e.parentId) >= 0;
}
function daAcMark(ds, e) {
  daAcDoneSet().add(daAcKey(ds, e));
  ds.autoDone = ds.autoDone || [];
  const k = e.col + '|' + e.parentId; if (ds.autoDone.indexOf(k) < 0) ds.autoDone.push(k);
  try { localStorage.setItem(DA_AC_STORE, JSON.stringify(Array.from(daAcDoneSet()).slice(-400))); } catch (e2) { /* storage full or blocked: the marker in the table still works */ }
}

// ── which columns of the main table are worth bringing in ──────────────────────────────────
function daAcHdr(t, i) { return String(t.headers[i] == null ? '' : t.headers[i]).trim(); }
function daAcPicks(child, parent, keyCol) {
  const skip = new Set([keyCol]);
  (parent.xlinks || []).forEach(l => (l.map || []).forEach(m => skip.add(m.ours)));   // columns that were themselves pulled in
  (parent.xsums || []).forEach(s => skip.add(s.ours));                                // counts and totals
  const have = new Set(child.headers.map(h => String(h == null ? '' : h).trim().toLowerCase()));
  const sample = (parent.rows || []).slice(0, 200);
  const list = [];
  parent.headers.forEach((h, i) => {
    const name = daAcHdr(parent, i);
    if (skip.has(i) || name === '' || have.has(name.toLowerCase())) return;
    let used = false;
    for (let r = 0; r < sample.length && !used; r++) { const v = sample[r] ? sample[r][i] : ''; if (String(v == null ? '' : v).trim() !== '') used = true; }
    if (!used) return;                                                                 // an empty column brings nothing
    list.push({ i, rank: DA_AC_STATUS_WORD.test(name) ? 0 : DA_AC_NAME_WORD.test(name) ? 1 : 2 });
  });
  list.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return list.slice(0, DA_AC_PULLS).map(x => x.i).sort((a, b) => a - b);
}

// ── is this pair safe to connect without asking? ─────────────────────────────────────────────
function daAcOk(ds, e, parent) {
  if (!parent || parent === ds) return false;
  if (e.conf !== 'strong' && e.conf !== 'likely') return false;
  const h = String(e.parentColName == null ? '' : e.parentColName);
  if (!DA_AC_ID_WORD.test(h) && !DA_AC_CONTACT_WORD.test(h)) return false;
  if ((parent.rows || []).length * (ds.rows || []).length > DA_AC_MAX_WORK) return false;
  return true;
}

// A cheap picture of the tables (names, column counts, links). Undo compares against it.
function daAcSig() {
  return daState.datasets.map(d => d.id + ':' + d.headers.length + ':' + (d.xlinks || []).length + ':' + (d.xsums || []).length).join('|');
}

// ── one pass: connect everything that is safe. Returns what it did. ─────────────────────────
function daAcRun() {
  const out = { links: [], counts: [], steps: 0, left: 0, sig: '' };
  if (typeof daState === 'undefined' || !daState.interconnect || _daAc.running) return out;
  if (typeof daClCompute !== 'function' || typeof daApplyLink !== 'function') return out;
  _daAc.running = true;
  try {
    out.sig = daAcSig();
    if (typeof daHistory !== 'undefined' && daHistory.checkpoint) daHistory.checkpoint();   // so Undo has a clean starting point
    const data = daClCompute();
    const todo = [];
    data.byId.forEach((info, id) => {
      const ds = daState.datasets.find(d => d.id === id); if (!ds) return;
      info.child.forEach(e => {
        if (daClIsLinked(ds, e) || daAcSeen(ds, e)) return;
        const parent = daState.datasets.find(d => d.id === e.parentId);
        if (daAcOk(ds, e, parent)) todo.push({ ds, e, parent });
      });
    });
    // Main tables first, so a table that feeds others is complete before they read from it.
    todo.sort((a, b) => ((a.parent.xlinks || []).length - (b.parent.xlinks || []).length));
    todo.slice(0, DA_AC_MAX_PER_PASS).forEach(t => {
      const picks = daAcPicks(t.ds, t.parent, t.e.parentCol);
      daAcMark(t.ds, t.e);                                                             // mark first: even a failed try is never repeated
      try {
        const n = picks.length ? daApplyLink(t.ds, t.parent, t.e.col, t.e.parentCol, picks) : 0;
        if (n > 0) out.steps++;
        out.links.push({ table: t.ds.name, parent: t.parent.name, columns: n });
        // The main table also gets "how many rows of this table are mine".
        if (!(t.parent.pipeF && t.parent.pipeF.length) && typeof daApplySummary === 'function') {
          const before = (t.parent.xsums || []).length;
          const nm = daApplySummary(t.parent, t.ds, t.e.parentCol, t.e.col, 'count', -1, -1, '');
          if ((t.parent.xsums || []).length > before) { out.steps++; out.counts.push({ table: t.parent.name, column: nm }); }
        }
      } catch (err) { console.warn('[Interconnect] auto-connect skipped one pair', err); }
    });
    out.left = Math.max(0, todo.length - DA_AC_MAX_PER_PASS);
    if (out.links.length) { _daAc.stale = false; }
  } finally { _daAc.running = false; }
  return out;
}

// ── the notice, with an Undo that reverses the whole pass ───────────────────────────────────
function daAcNotice(res, weak) {
  const names = res.links.map(l => l.table + ' \u2192 ' + l.parent).join(', ');
  let msg = 'Connected automatically: ' + names + '.';
  if (res.counts.length) msg += ' Added a count to ' + Array.from(new Set(res.counts.map(c => c.table))).join(', ') + '.';
  if (res.left) msg += ' ' + res.left + ' more will follow.';
  if (weak) msg += ' ' + weak + ' weaker match' + (weak === 1 ? '' : 'es') + ' left for you (glowing icon).';
  const box = (typeof document !== 'undefined') ? document.getElementById('toastContainer') : null;
  if (!box) { if (typeof toast === 'function') toast(msg, 'info'); return; }
  const t = document.createElement('div'); t.className = 'toast info';
  const ic = document.createElement('span'); ic.className = 'toast-icon'; ic.style.cssText = 'display:inline-flex;color:var(--blue)';
  ic.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="12" r="2.9"/><circle cx="18.5" cy="12" r="2.9"/><path d="M8.6 12h6.8"/></svg>';
  const tx = document.createElement('span'); tx.textContent = msg;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo';
  b.style.cssText = 'margin-left:10px;font:inherit;font-weight:700;padding:2px 10px;border-radius:6px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);cursor:pointer';
  b.onclick = () => { t.remove(); daAcUndo(res); };
  t.appendChild(ic); t.appendChild(tx); if (res.steps) t.appendChild(b);
  box.appendChild(t);
  setTimeout(() => t.remove(), 9000);
}
function daAcUndo(res) {
  if (_daAc.stale) { if (typeof toast === 'function') toast('The tables changed after this. Use Undo (Ctrl+Z) to step back.', 'info'); return; }
  if (typeof daHistory === 'undefined' || !daHistory.undo) return;
  // One pass can leave several history steps (some are invisible, like a dropdown refresh), so go back
  // until the tables look like they did before the pass. Never more than 8 steps.
  for (let i = 0; i < 8 && daAcSig() !== res.sig; i++) { if (!daHistory.undo()) break; }
  if (typeof toast === 'function') toast('Auto-connect undone. These pairs will not be connected again by themselves.', 'success');
}

// ── when to run ───────────────────────────────────────────────────────────────────────────────
function daAcTyping() {
  try {
    const a = document.activeElement; if (!a) return false;
    const tag = String(a.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') { const ty = String(a.type || 'text').toLowerCase(); return ty !== 'checkbox' && ty !== 'radio' && ty !== 'button' && ty !== 'range' && ty !== 'file'; }
    return !!a.isContentEditable;
  } catch (e) { return false; }
}
function daAcSchedule(ms) { clearTimeout(_daAc.timer); _daAc.timer = setTimeout(daAcTick, ms); }
function daAcTick() {
  if (typeof daState === 'undefined' || !daState.interconnect || _daAc.running) return;
  if (daAcTyping() && _daAc.tries < 12) { _daAc.tries++; daAcSchedule(1200); return; }   // never rebuild the grid under someone's cursor
  _daAc.tries = 0;
  try {
    const res = daAcRun();
    if (res.links.length) {
      let weak = 0; try { weak = daClCompute().count; } catch (e) { /* only for the notice */ }
      _daAc.last = res;
      if (typeof _daCl !== 'undefined') { _daCl.dirty = true; if (typeof daClSchedule === 'function') daClSchedule(0); }
      daAcNotice(res, weak);
    }
  } catch (e) { console.warn('[Interconnect] auto-connect failed', e); }
}

// Switch turned ON: connect what is already there. (js/94 would announce "found N possible
// connections"; that is replaced by this pass, so its announcement is cancelled.)
const _daToggleAc = daToggleInterconnect;
daToggleInterconnect = function (on) {
  const r = _daToggleAc.apply(this, arguments);
  if (on) {
    if (typeof _daCl !== 'undefined') _daCl.announce = false;
    _daAc.stale = false; _daAc.tries = 0; daAcSchedule(250);
  }
  return r;
};
// Any edit while the switch is ON: look again after a calm moment (a new form-response table, new IDs typed...).
const _daPersistAc = daPersist;
daPersist = function () {
  if (!_daAc.running) _daAc.stale = true;
  const r = _daPersistAc.apply(this, arguments);
  if (daState.interconnect && !_daAc.running) daAcSchedule(1600);
  return r;
};
// A table was added (for example a form's responses sent to Data Arrangement): check at once.
const _daRenderTableAc = daRenderTable;
daRenderTable = function () {
  const r = _daRenderTableAc.apply(this, arguments);
  try {
    const sig = daState.datasets.map(d => d.id).join(',');
    if (sig !== _daAc.lastSig) { _daAc.lastSig = sig; if (daState.interconnect && !_daAc.running) daAcSchedule(500); }
  } catch (e) { /* drawing must never fail because of this */ }
  return r;
};
