// ─── WORKSTYLE: THE BUTTON AND PANEL ─────────────────────────────────────────
// The "Workstyle" button sits right after Showcase in the PDF Editor app bar.
// The panel does one simple thing:
//   Two upload boxes side by side, each showing the logo of the format that was uploaded:
//   1. REFERENCE   a file (PDF, Word, Excel, CSV, PowerPoint); the open document is a small link under the boxes
//   2. YOUR FILE   one or several files in any format (js/64-workstyle-readers.js), or typed text under "Or type your content"
//   3. Build       Kadessa reads both (js/63-workstyle-fill.js) and builds the same
//                  format with your content, live in the editor with the reference
//                  docked beside it (js/62-workstyle-build.js)
// A reference is kept on this device (js/59-workstyle.js) so it can be used again;
// the list under the button shows them. The panel has no categories and no styles
// to name: the reference you give is the template.
// Kadessa's chat commands (save, list, build as a copy) share the same store.

let wsBusy = false;
let wsRefId = null;      // the reference chosen for the next build
let wsFiles = [];        // content files added so far: { name, text, note }
const WS_FMT_KEY = 'ws_ref_fmt_v1'; // reference id -> file name, so its format logo can be shown again later

function wsEl(id) { return document.getElementById(id); }

// ─── file-format logos ───────────────────────────────────────────────────────
const WS_FMT = {
  pdf: ['PDF', '#dc2626'],
  docx: ['DOC', '#2563eb'], doc: ['DOC', '#2563eb'], rtf: ['RTF', '#2563eb'], odt: ['ODT', '#2563eb'],
  xlsx: ['XLS', '#16a34a'], xlsm: ['XLS', '#16a34a'], xlsb: ['XLS', '#16a34a'], xls: ['XLS', '#16a34a'], ods: ['ODS', '#16a34a'],
  csv: ['CSV', '#16a34a'], tsv: ['TSV', '#16a34a'],
  pptx: ['PPT', '#ea580c'], ppt: ['PPT', '#ea580c'], odp: ['ODP', '#ea580c'],
  png: ['IMG', '#9333ea'], jpg: ['IMG', '#9333ea'], jpeg: ['IMG', '#9333ea'], webp: ['IMG', '#9333ea'], gif: ['IMG', '#9333ea'], bmp: ['IMG', '#9333ea'], heic: ['IMG', '#9333ea'],
  txt: ['TXT', '#64748b'], md: ['MD', '#64748b'], log: ['LOG', '#64748b'],
  json: ['JSON', '#ca8a04'], html: ['HTML', '#0891b2'], htm: ['HTML', '#0891b2'], xml: ['XML', '#0891b2']
};

function wsFmtOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return WS_FMT[ext] || [ext ? ext.slice(0, 4).toUpperCase() : 'FILE', '#475569'];
}

function wsLogo(name, small) {
  const f = wsFmtOf(name);
  const d = document.createElement('span');
  d.className = 'ws-logo' + (small ? ' sm' : '');
  d.style.background = f[1];
  d.textContent = f[0];
  return d;
}

function wsFmtMap() {
  try { return JSON.parse(localStorage.getItem(WS_FMT_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function wsRememberFmt(id, fileName) {
  try { const m = wsFmtMap(); m[id] = String(fileName || ''); localStorage.setItem(WS_FMT_KEY, JSON.stringify(m)); } catch (e) { /* storage full or blocked: the logo falls back to PDF */ }
}
function wsRefFileName(s) { return wsFmtMap()[s.id] || (s.name + '.pdf'); }

// ─── the panel ───────────────────────────────────────────────────────────────
function wsEnsurePanel() {
  let panel = wsEl('wsPanel');
  if (panel) return panel;
  const group = wsEl('pdfedProposalsGroup');
  if (!group) return null;
  panel = document.createElement('div');
  panel.className = 'ws-panel';
  panel.id = 'wsPanel';
  panel.innerHTML =
    '<h4>Workstyle</h4>' +
    '<p class="ws-sub">Upload a reference and your file. Kadessa builds your content in the reference\u2019s layout, spacing and colours. Logo and image spots get an Upload button right where they sit.</p>' +
    '<div class="ws-cards">' +
      '<div class="ws-card"><div class="ws-lab"><span class="ws-num">1</span> Reference</div><div class="ws-zone" id="wsRefZone" tabindex="0" role="button" aria-label="Upload a reference file"></div></div>' +
      '<div class="ws-card"><div class="ws-lab"><span class="ws-num">2</span> Your file</div><div class="ws-zone" id="wsConZone" tabindex="0" role="button" aria-label="Upload your files"></div></div>' +
    '</div>' +
    '<div class="ws-pal" id="wsPal" aria-live="polite"></div>' +
    '<input type="file" id="wsPdfInput" style="display:none">' +
    '<input type="file" id="wsContentInput" multiple style="display:none">' +
    '<button type="button" class="ws-link" id="wsDocBtn">Use the open document as reference</button>' +
    '<div class="ws-list" id="wsList"></div>' +
    '<details class="ws-mini" id="wsMini"><summary>Or type your content</summary>' +
      '<textarea id="wsContent" rows="4" maxlength="24000" spellcheck="false" placeholder="Type or paste your content here. Kadessa matches it to the reference."></textarea>' +
    '</details>' +
    '<div class="ws-actions"><button type="button" class="primary" id="wsBuildBtn">Build with Kadessa</button></div>' +
    '<div class="ws-status" id="wsStatus"></div>' +
    '<div class="ws-fine">Your reference and content are sent to Kadessa for this one request. Nothing is stored there.</div>';
  group.appendChild(panel);

  const refZone = wsEl('wsRefZone'), conZone = wsEl('wsConZone');
  function press(el, fn) {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }
  press(refZone, function () { if (!wsBusy) wsEl('wsPdfInput').click(); });
  press(conZone, function () { if (!wsBusy) wsEl('wsContentInput').click(); });
  wsEl('wsPdfInput').addEventListener('change', function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (f) wsAddReferenceFile(f);
  });
  wsEl('wsContentInput').addEventListener('change', function () {
    const files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (files.length) wsReadContentFiles(files);
  });
  wsEl('wsDocBtn').addEventListener('click', wsAddOpenDocument);
  // Drop files straight onto either box.
  [[refZone, 'ref'], [conZone, 'content']].forEach(function (pair) {
    const el = pair[0];
    el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('ws-drop'); });
    el.addEventListener('dragleave', function () { el.classList.remove('ws-drop'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault(); el.classList.remove('ws-drop');
      const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length || wsBusy) return;
      if (pair[1] === 'ref') wsAddReferenceFile(files[0]); else wsReadContentFiles(files);
    });
  });
  wsEl('wsBuildBtn').addEventListener('click', wsBuild);
  wsRenderList();
  return panel;
}

function wsToggle() {
  const panel = wsEnsurePanel();
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) { wsStatus('', ''); wsRenderList(); }
}

function wsClose() {
  const panel = wsEl('wsPanel');
  if (panel) panel.classList.remove('open');
}

function wsStatus(msg, kind) {
  const s = wsEl('wsStatus');
  if (!s) return;
  s.textContent = msg || '';
  s.className = 'ws-status' + (kind ? ' ' + kind : '');
}

function wsSetBusy(on, msg) {
  wsBusy = on;
  ['wsDocBtn', 'wsBuildBtn'].forEach(function (id) { const b = wsEl(id); if (b) b.disabled = on; });
  ['wsRefZone', 'wsConZone'].forEach(function (id) { const z = wsEl(id); if (z) z.classList.toggle('ws-off', on); });
  const bb = wsEl('wsBuildBtn');
  if (bb) bb.textContent = on ? 'Working…' : 'Build with Kadessa';
  if (on) wsStatus(msg || 'Working…', '');
}

function wsErrText(e) {
  const m = (e && e.message) ? String(e.message) : 'something went wrong';
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.');
}

// ─── 1. the reference ────────────────────────────────────────────────────────
async function wsAddReferenceFile(file) {
  if (wsBusy) return;
  wsSetBusy(true, 'Reading ' + (file.name || 'the file') + '…');
  try {
    const r = await wsReadAnyReference(file);
    wsRefId = r.id;
    wsRememberFmt(r.id, file.name);
    wsStatus('Reference ready. Now add your file.', 'ok');
  } catch (e) { wsStatus(wsErrText(e), 'err'); }
  wsSetBusy(false);
  wsRenderList();
}

async function wsAddOpenDocument() {
  if (wsBusy) return;
  const raw = (typeof pdfed !== 'undefined' && pdfed.file && pdfed.file.name) ? String(pdfed.file.name) : '';
  const name = raw.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Open document';
  wsSetBusy(true, 'Measuring the open document…');
  try {
    const r = await wstyleSaveFromEditor(name, { scope: 'all' });
    wsRefId = r.id;
    wsRememberFmt(r.id, name + '.pdf');
    wsStatus('Reference ready. Now add your file.', 'ok');
  } catch (e) { wsStatus(wsErrText(e), 'err'); }
  wsSetBusy(false);
  wsRenderList();
}

function wsAgo(ts) {
  const d = Date.now() - (Number(ts) || 0);
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.round(h / 24) + ' d ago';
}

// One box, empty or full. clearFn is called by the small x.
function wsPaintZone(zone, logos, title, meta, hint, clearFn) {
  zone.textContent = '';
  if (!logos.length) {
    zone.classList.remove('full');
    const plus = document.createElement('span'); plus.className = 'ws-plus'; plus.textContent = '+';
    const up = document.createElement('span'); up.className = 'ws-up'; up.textContent = 'Upload';
    const h = document.createElement('span'); h.className = 'ws-hint'; h.textContent = hint;
    zone.appendChild(plus); zone.appendChild(up); zone.appendChild(h);
    return;
  }
  zone.classList.add('full');
  const row = document.createElement('div');
  row.className = 'ws-logos';
  logos.slice(0, 3).forEach(function (n) { row.appendChild(wsLogo(n)); });
  if (logos.length > 3) { const more = document.createElement('span'); more.className = 'ws-more'; more.textContent = '+' + (logos.length - 3); row.appendChild(more); }
  zone.appendChild(row);
  const t = document.createElement('span'); t.className = 'ws-fn'; t.textContent = title; t.title = title;
  const m = document.createElement('span'); m.className = 'ws-fm'; m.textContent = meta;
  zone.appendChild(t); zone.appendChild(m);
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'ws-x'; x.textContent = '×'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove');
  x.addEventListener('click', function (e) { e.stopPropagation(); if (!wsBusy) clearFn(); });
  x.addEventListener('keydown', function (e) { e.stopPropagation(); });
  zone.appendChild(x);
}

// The colours learned from the chosen reference, by role (js/59 wstylePalette).
function wsRenderPalette(sel) {
  const box = wsEl('wsPal');
  if (!box) return;
  box.textContent = '';
  const pal = sel ? wstylePaletteOf(wstyleGet(sel.id)) : null;
  if (!pal) { box.classList.remove('on'); return; }
  const lab = document.createElement('span'); lab.className = 'ws-pal-l'; lab.textContent = 'Colours learned';
  box.appendChild(lab);
  [['Main', pal.primary], ['Accent', pal.accent], ['Text', pal.text], ['Page', pal.background]].forEach(function (p) {
    if (!p[1]) return;
    const w = document.createElement('span'); w.className = 'ws-sw'; w.title = p[0] + ' ' + p[1];
    const dot = document.createElement('i'); dot.style.background = p[1];
    w.appendChild(dot); w.appendChild(document.createTextNode(p[0]));
    box.appendChild(w);
  });
  box.classList.add('on');
}

function wsRenderList() {
  const refZone = wsEl('wsRefZone'), conZone = wsEl('wsConZone'), box = wsEl('wsList');
  if (!refZone || !conZone || !box) return;
  const list = wstyleList().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  if (wsRefId && !list.some(function (s) { return s.id === wsRefId; })) wsRefId = null;
  const sel = list.filter(function (s) { return s.id === wsRefId; })[0] || null;

  // box 1: the chosen reference
  if (sel) {
    wsPaintZone(refZone, [wsRefFileName(sel)], sel.name, sel.pages + ' page' + (sel.pages === 1 ? '' : 's') + ' · ' + wsAgo(sel.updatedAt), '',
      function () { wsRefId = null; wsRenderList(); });
  } else {
    wsPaintZone(refZone, [], '', '', 'PDF, Word, Excel, PowerPoint', null);
  }

  wsRenderPalette(sel);

  // box 2: your files
  if (wsFiles.length) {
    const exts = wsFiles.map(function (f) { return wsFmtOf(f.name)[0]; });
    wsPaintZone(conZone, wsFiles.map(function (f) { return f.name; }),
      wsFiles.length > 1 ? wsFiles.length + ' files' : wsFiles[0].name,
      wsFiles.length > 1 ? exts.join(' · ') : (wsFiles[0].note || 'ready'), '',
      function () { wsFiles = []; wsRenderList(); wsStatus('', ''); });
  } else {
    wsPaintZone(conZone, [], '', '', 'Any format, several at once', null);
  }

  // earlier references (kept on this device): small rows, only the ones not chosen
  box.textContent = '';
  const others = list.filter(function (s) { return s.id !== wsRefId; });
  if (!others.length) return;
  const title = document.createElement('div');
  title.className = 'ws-list-title';
  title.textContent = 'Earlier references';
  box.appendChild(title);
  others.forEach(function (s) {
    const row = document.createElement('div');
    row.className = 'ws-item';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ws-pick';
    pick.appendChild(wsLogo(wsRefFileName(s), true));
    const nm = document.createElement('span');
    nm.className = 'ws-item-name';
    nm.textContent = s.name;
    nm.title = s.name;
    pick.appendChild(nm);
    pick.addEventListener('click', function () { wsRefId = s.id; wsRenderList(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ws-del';
    del.textContent = 'Delete';
    let timer = null;
    del.addEventListener('click', function () {
      if (!del.classList.contains('sure')) {
        del.classList.add('sure'); del.textContent = 'Sure?';
        timer = setTimeout(function () { del.classList.remove('sure'); del.textContent = 'Delete'; }, 3000);
        return;
      }
      clearTimeout(timer);
      try { wstyleDelete(s.id); wsStatus('Removed "' + s.name + '".', 'ok'); }
      catch (e) { wsStatus(wsErrText(e), 'err'); }
      wsRenderList();
    });
    row.appendChild(pick); row.appendChild(del);
    box.appendChild(row);
  });
}

// ─── 2. your files ───────────────────────────────────────────────────────────
async function wsReadContentFiles(files) {
  if (wsBusy) return;
  const notes = [], failed = [];
  wsSetBusy(true, 'Reading ' + (files.length > 1 ? files.length + ' files' : (files[0].name || 'the file')) + '…');
  for (let i = 0; i < files.length; i++) {
    try {
      if (files.length > 1) wsStatus('Reading ' + files[i].name + ' (' + (i + 1) + ' of ' + files.length + ')…', '');
      const r = await wsReadAnyContent(files[i]);
      wsFiles.push({ name: files[i].name || 'file', text: r.text || '', note: r.note || '' });
      if (r.note) notes.push(files[i].name + ': ' + r.note);
    } catch (e) { failed.push((files[i].name || 'file') + ': ' + wsErrText(e)); }
  }
  wsSetBusy(false);
  wsRenderList();
  const msg = failed.concat(notes).join(' ');
  wsStatus(msg, failed.length ? 'err' : '');
}

// The typed text first, then every file's words, in the order the files were added.
function wsGatherContent() {
  const typed = (wsEl('wsContent').value || '').trim();
  const parts = typed ? [typed] : [];
  wsFiles.forEach(function (f) { if (f.text && f.text.trim()) parts.push(f.text.trim()); });
  return parts.join('\n\n');
}

// ─── 3. build ────────────────────────────────────────────────────────────────
async function wsBuild() {
  if (wsBusy) return;
  if (!wsRefId) { wsStatus('Add a reference first: upload a file in box 1 or use the open document.', 'err'); return; }
  let text = wsGatherContent();
  if (!text) {
    wsStatus(wsFiles.length ? 'Your files had no readable words. Try another file or type your content.' : 'Add your file in box 2, or type your content.', 'err');
    return;
  }
  let cutNote = '';
  if (text.length > WSF_MAX_CONTENT) { text = text.slice(0, WSF_MAX_CONTENT); cutNote = ' Only the first ' + WSF_MAX_CONTENT.toLocaleString('en-US') + ' characters were used.'; }
  wsSetBusy(true, 'Kadessa is getting ready…');
  try {
    const r = await wstyleBuildFromContent(wsRefId, text, { onStage: function (m) { wsStatus(m, ''); } });
    wsClose();
    if (typeof toast === 'function') toast('Built from your reference', 'success');
    wsStatus(r.say + cutNote, r.via === 'basic' ? '' : 'ok');
  } catch (e) { wsStatus(wsErrText(e), 'err'); }
  wsSetBusy(false);
}

// Close when the person clicks anywhere outside the panel and its button, or presses Escape.
document.addEventListener('click', function (e) {
  const panel = wsEl('wsPanel');
  if (!panel || !panel.classList.contains('open')) return;
  if (panel.contains(e.target)) return;
  const btn = wsEl('wsOpenBtn');
  if (btn && btn.contains(e.target)) return;
  wsClose();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') wsClose();
});
