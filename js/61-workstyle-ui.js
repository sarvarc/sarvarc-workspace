// ─── WORKSTYLE: THE BUTTON AND PANEL ─────────────────────────────────────────
// The "Workstyle" button sits right after Showcase in the PDF Editor app bar.
// It opens a small panel with everything the person needs, no chat required:
//   1. Save the document that is open in the editor as a work style
//      (whole document or just this page).
//   2. Learn a style straight from any PDF file (js/60-workstyle-pdf.js).
//   3. See the saved styles, build an identical copy of one (split screen with
//      Kadessa's cursor, js/62-workstyle-build.js), and delete one.
// All measuring is done by js/59-workstyle.js and js/60-workstyle-pdf.js. This file
// only draws the panel and calls them. Kadessa's chat commands still work and
// share the same store, so a style saved from chat shows up here when the panel opens.

let wsBusy = false;

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
    '<h4>Workstyle <span class="ws-badge">LEARNS YOUR LOOK</span></h4>' +
    '<p class="ws-sub">Save the fonts, sizes, colors, margins, tables and background of finished work, measured exactly, under a name.</p>' +
    '<input type="text" id="wsNameInput" maxlength="60" placeholder="Style name (e.g. Cafe menu)" autocomplete="off">' +
    '<div class="ws-scope" id="wsScope">' +
      '<label class="on"><input type="radio" name="wsScope" value="all" checked> Whole document</label>' +
      '<label><input type="radio" name="wsScope" value="current"> This page only</label>' +
    '</div>' +
    '<div class="ws-actions"><button type="button" class="primary" id="wsSaveBtn">Save open document</button></div>' +
    '<div class="ws-or">OR</div>' +
    '<div class="ws-actions"><button type="button" id="wsPdfBtn">Learn from a PDF file</button></div>' +
    '<input type="file" id="wsPdfInput" accept="application/pdf,.pdf" style="display:none">' +
    '<div class="ws-status" id="wsStatus"></div>' +
    '<div class="ws-list" id="wsList"></div>' +
    '<div class="ws-soon">Press Build on a style and watch Kadessa make an identical copy, side by side. To use new words in the same look, tell her in chat, for example: make a menu for Chai Point in my Cafe menu style.</div>';
  group.appendChild(panel);

  wsEl('wsSaveBtn').addEventListener('click', wsSaveOpenDocument);
  wsEl('wsPdfBtn').addEventListener('click', function () { if (!wsBusy) wsEl('wsPdfInput').click(); });
  wsEl('wsPdfInput').addEventListener('change', function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (f) wsLearnFromPdf(f);
  });
  wsEl('wsNameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') wsSaveOpenDocument(); });
  wsEl('wsScope').addEventListener('change', function () {
    Array.prototype.forEach.call(this.querySelectorAll('label'), function (l) {
      l.classList.toggle('on', !!l.querySelector('input:checked'));
    });
  });
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
  ['wsSaveBtn', 'wsPdfBtn'].forEach(function (id) { const b = wsEl(id); if (b) b.disabled = on; });
  if (on) wsStatus(msg || 'Working…', '');
}

function wsScopeValue() {
  const r = document.querySelector('#wsScope input:checked');
  return r && r.value === 'current' ? 'current' : 'all';
}

function wsErrText(e) {
  const m = (e && e.message) ? String(e.message) : 'something went wrong';
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.');
}

async function wsSaveOpenDocument() {
  if (wsBusy) return;
  const name = (wsEl('wsNameInput').value || '').trim();
  if (!name) { wsStatus('Give the style a name first.', 'err'); wsEl('wsNameInput').focus(); return; }
  wsSetBusy(true, 'Measuring the open document…');
  try {
    const r = await wstyleSaveFromEditor(name, { scope: wsScopeValue() });
    wsStatus(r.say, 'ok');
    if (typeof toast === 'function') toast('Work style saved', 'success');
    wsEl('wsNameInput').value = '';
  } catch (e) {
    wsStatus(wsErrText(e), 'err');
  }
  wsSetBusy(false);
  wsRenderList();
}

async function wsLearnFromPdf(file) {
  if (wsBusy) return;
  if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
    wsStatus('That is not a PDF file.', 'err');
    return;
  }
  const typed = (wsEl('wsNameInput').value || '').trim();
  wsSetBusy(true, 'Reading ' + (file.name || 'the PDF') + '…');
  try {
    const r = await wstyleSaveFromPdfFile(file, typed || undefined);
    wsStatus(r.say, 'ok');
    if (typeof toast === 'function') toast('Work style saved', 'success');
    wsEl('wsNameInput').value = '';
  } catch (e) {
    wsStatus(wsErrText(e), 'err');
  }
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
  const title = document.createElement('div');
  title.className = 'ws-list-title';
  title.textContent = 'Saved styles (' + list.length + ')';
  box.appendChild(title);
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'ws-empty';
    e.textContent = 'None yet. Finish a piece of work and save it above, or learn from a PDF.';
    box.appendChild(e);
    return;
  }
  list.forEach(function (s) {
    const row = document.createElement('div');
    row.className = 'ws-item';
    const main = document.createElement('div');
    main.className = 'ws-item-main';
    const nm = document.createElement('div');
    nm.className = 'ws-item-name';
    nm.textContent = s.name;
    nm.title = s.name;
    const meta = document.createElement('div');
    meta.className = 'ws-item-meta';
    const src = s.source && s.source.docName ? ' · ' + s.source.docName : '';
    meta.textContent = s.pages + ' page' + (s.pages === 1 ? '' : 's') + src + ' · ' + wsAgo(s.updatedAt);
    main.appendChild(nm); main.appendChild(meta);
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
      try { wstyleDelete(s.id); wsStatus('Deleted "' + s.name + '".', 'ok'); }
      catch (e) { wsStatus(wsErrText(e), 'err'); }
      wsRenderList();
    });
    const build = document.createElement('button');
    build.type = 'button';
    build.className = 'ws-build';
    build.textContent = 'Build';
    build.title = 'Kadessa builds an identical copy of this style, side by side with the reference';
    build.addEventListener('click', async function () {
      if (wsBusy) return;
      wsSetBusy(true, 'Kadessa is getting ready…');
      try {
        const r = await wstyleBuild(s.id);
        wsClose();
        if (typeof toast === 'function') toast('Built from "' + s.name + '"', 'success');
        wsStatus(r.say, 'ok');
      } catch (e) { wsStatus(wsErrText(e), 'err'); }
      wsSetBusy(false);
    });
    row.appendChild(main); row.appendChild(build); row.appendChild(del);
    box.appendChild(row);
  });
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
