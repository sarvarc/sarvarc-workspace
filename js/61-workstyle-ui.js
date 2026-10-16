// ─── WORKSTYLE: THE BUTTON AND PANEL ─────────────────────────────────────────
// The "Workstyle" button sits right after Showcase in the PDF Editor app bar.
// The panel does one simple thing:
//   1. REFERENCE   a file (PDF, Word, Excel, CSV, PowerPoint), or the document open in the editor
//   2. YOUR CONTENT  typed, pasted, or files in any format (js/64-workstyle-readers.js)
//   3. Build       Kadessa reads both (js/63-workstyle-fill.js) and builds the same
//                  format with your content, live in the editor with the reference
//                  docked beside it (js/62-workstyle-build.js)
// A reference is kept on this device (js/59-workstyle.js) so it can be used again;
// the list under the button shows them. The panel has no categories and no styles
// to name: the reference you give is the template.
// Kadessa's chat commands (save, list, build as a copy) share the same store.

let wsBusy = false;
let wsRefId = null;      // the reference chosen for the next build
let wsContentFile = '';  // name of an attached text file, for the label only

function wsEl(id) { return document.getElementById(id); }

function wsEnsurePanel() {
  let panel = wsEl('wsPanel');
  if (panel) return panel;
  const group = wsEl('pdfedProposalsGroup');
  if (!group) return null;
  panel = document.createElement('div');
  panel.className = 'ws-panel';
  panel.id = 'wsPanel';
  panel.innerHTML =
    '<h4>Workstyle <span class="ws-badge">REFERENCE + YOUR CONTENT</span></h4>' +
    '<p class="ws-sub">Give a reference and your own content. Kadessa builds the same format with your content, side by side.</p>' +

    '<div class="ws-step"><span class="ws-num">1</span> Reference</div>' +
    '<div class="ws-actions">' +
      '<button type="button" id="wsPdfBtn">Attach a file</button>' +
      '<button type="button" id="wsDocBtn">Use the open document</button>' +
    '</div>' +
    '<input type="file" id="wsPdfInput" style="display:none">' +
    '<div class="ws-list" id="wsList"></div>' +

    '<div class="ws-step"><span class="ws-num">2</span> Your content</div>' +
    '<textarea id="wsContent" rows="6" maxlength="24000" spellcheck="false" placeholder="Type or paste your content here, or attach files below (PDF, Word, Excel, PowerPoint, TXT, picture, any format). Kadessa matches it to the reference."></textarea>' +
    '<div class="ws-row"><button type="button" class="ws-link" id="wsFileBtn">Attach files</button><span class="ws-fname" id="wsFileName"></span></div>' +
    '<input type="file" id="wsContentInput" multiple style="display:none">' +

    '<div class="ws-actions"><button type="button" class="primary" id="wsBuildBtn">Build with Kadessa</button></div>' +
    '<div class="ws-status" id="wsStatus"></div>' +
    '<div class="ws-soon">When you press Build, the words of your reference and your content are sent to Kadessa for that one request. Nothing is stored there.</div>';
  group.appendChild(panel);

  wsEl('wsPdfBtn').addEventListener('click', function () { if (!wsBusy) wsEl('wsPdfInput').click(); });
  wsEl('wsPdfInput').addEventListener('change', function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (f) wsAddReferenceFile(f);
  });
  wsEl('wsDocBtn').addEventListener('click', wsAddOpenDocument);
  wsEl('wsFileBtn').addEventListener('click', function () { if (!wsBusy) wsEl('wsContentInput').click(); });
  wsEl('wsContentInput').addEventListener('change', function () {
    const files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (files.length) wsReadContentFiles(files);
  });
  // Drop files straight onto the reference list or the content box.
  [['wsList', 'ref'], ['wsContent', 'content']].forEach(function (pair) {
    const el = wsEl(pair[0]);
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
  ['wsPdfBtn', 'wsDocBtn', 'wsBuildBtn', 'wsFileBtn'].forEach(function (id) { const b = wsEl(id); if (b) b.disabled = on; });
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
    wsStatus('Reference ready. Now add your content.', 'ok');
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
    wsStatus('Reference ready. Now add your content.', 'ok');
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

function wsRenderList() {
  const box = wsEl('wsList');
  if (!box) return;
  box.textContent = '';
  const list = wstyleList().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  if (wsRefId && !list.some(function (s) { return s.id === wsRefId; })) wsRefId = null;
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'ws-empty';
    e.textContent = 'No reference yet. Attach a PDF, Word, Excel, CSV or PowerPoint file, or open your finished work in the editor and use it.';
    box.appendChild(e);
    return;
  }
  list.forEach(function (s) {
    const row = document.createElement('div');
    row.className = 'ws-item' + (s.id === wsRefId ? ' on' : '');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ws-pick';
    pick.setAttribute('aria-pressed', s.id === wsRefId ? 'true' : 'false');
    const nm = document.createElement('div');
    nm.className = 'ws-item-name';
    nm.textContent = s.name;
    nm.title = s.name;
    const meta = document.createElement('div');
    meta.className = 'ws-item-meta';
    meta.textContent = s.pages + ' page' + (s.pages === 1 ? '' : 's') + ' · ' + wsAgo(s.updatedAt);
    pick.appendChild(nm); pick.appendChild(meta);
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
      try { wstyleDelete(s.id); if (wsRefId === s.id) wsRefId = null; wsStatus('Removed "' + s.name + '".', 'ok'); }
      catch (e) { wsStatus(wsErrText(e), 'err'); }
      wsRenderList();
    });
    row.appendChild(pick); row.appendChild(del);
    box.appendChild(row);
  });
}

// ─── 2. the content ──────────────────────────────────────────────────────────
async function wsReadContentFiles(files) {
  if (wsBusy) return;
  const box = wsEl('wsContent');
  const added = [], notes = [], failed = [];
  wsSetBusy(true, 'Reading ' + (files.length > 1 ? files.length + ' files' : (files[0].name || 'the file')) + '…');
  for (let i = 0; i < files.length; i++) {
    try {
      if (files.length > 1) wsStatus('Reading ' + files[i].name + ' (' + (i + 1) + ' of ' + files.length + ')…', '');
      const r = await wsReadAnyContent(files[i]);
      box.value = (box.value.trim() ? box.value.replace(/\s+$/, '') + '\n\n' : '') + r.text;
      added.push(files[i].name);
      if (r.note) notes.push(files[i].name + ': ' + r.note);
    } catch (e) { failed.push((files[i].name || 'file') + ': ' + wsErrText(e)); }
  }
  if (box.value.length > WSF_MAX_CONTENT) {
    box.value = box.value.slice(0, WSF_MAX_CONTENT);
    notes.push('only the first ' + WSF_MAX_CONTENT.toLocaleString('en-US') + ' characters are used');
  }
  wsContentFile = added.join(', ');
  wsEl('wsFileName').textContent = added.length ? 'Added ' + wsContentFile : '';
  wsSetBusy(false);
  const msg = failed.concat(notes).join(' ');
  wsStatus(msg, failed.length ? 'err' : '');
}

// ─── 3. build ────────────────────────────────────────────────────────────────
async function wsBuild() {
  if (wsBusy) return;
  if (!wsRefId) { wsStatus('Add a reference first: attach a file or use the open document.', 'err'); return; }
  const text = (wsEl('wsContent').value || '').trim();
  if (!text) { wsStatus('Add your content first.', 'err'); wsEl('wsContent').focus(); return; }
  wsSetBusy(true, 'Kadessa is getting ready…');
  try {
    const r = await wstyleBuildFromContent(wsRefId, text, { onStage: function (m) { wsStatus(m, ''); } });
    wsClose();
    if (typeof toast === 'function') toast('Built from your reference', 'success');
    wsStatus(r.say, r.via === 'basic' ? '' : 'ok');
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
