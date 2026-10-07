// ─── PDF.JS INIT ───
// Guarded: if the pdf.js CDN script hasn't finished loading yet (slow network,
// blocked CDN, ad-blocker), `pdfjsLib` can be undefined here. Letting that throw
// unguarded aborts this ENTIRE <script> block — which silently breaks every
// later `const` in it (like dgHistory) and cascades into unrelated features
// (e.g. Diagrams & Graphs chart-type picker opening but never redrawing).
if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
  console.warn('pdfjsLib did not load in time — PDF features will retry lazily; other modules are unaffected.');
}

// ─── STATE ───
// Tiny fallback store for thumbnail -> PDF editor canvas drag-and-drop
// (both the extracted-image gallery cards and the left-nav page thumbnails).
// dataTransfer.getData usually works fine, but some embedded webviews restrict
// reading it on dragover/drop, so we keep this as a backup source of truth.
let dragState = { galleryIdx: null, pageIdx: null };

let state = {
  pdfDoc: null,
  pdfFile: null,
  extractedImages: [], // {dataUrl, name, width, height, page}
  previewPages: [], // direct preview of uploaded file, before extraction {dataUrl, label}
  cinema: { pairs: [], pairIndex: 0, playing: true, timer: null, hiRes: {}, fileName: '' },
  selectedImages: new Set(),
  currentEditIndex: null,
  stats: { pdfs: 0, imgs: 0, exports: 0, pages: 0 },
  extractMode: 'all',
  exportFormat: 'zip',
  // editor filters
  filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
  filterPreset: 'none',
  transform: { rotate: 0, flipH: false, flipV: false }
};

// ─── GLOBAL UNDO / REDO (Ctrl+Z / Ctrl+Y across the whole tool) ───
// A lightweight action-history stack so Ctrl+Z / Ctrl+Y work consistently across
// every feature (extracted-image gallery, PDF Editor pages, etc.), not just one panel.
let appHistory = [];
let appRedoStack = [];
// Single shared clock every undo-capable subsystem stamps into. Nothing
// about "wall time" matters here — it's just a strictly-increasing counter
// so unifiedUndo()/unifiedRedo() can ask "which of these five independent
// history stacks changed most recently?" and always act on that one,
// instead of a fixed priority order that ignores real recency.
let historyClock = 0;
function nextHistoryTick() { return ++historyClock; }
function pushAppHistory(action) {
  action._t = nextHistoryTick();
  appHistory.push(action);
  if (appHistory.length > 50) appHistory.shift();
  appRedoStack = [];
}
async function appUndo() {
  if (appHistory.length === 0) { toast('Nothing to undo', 'info'); return; }
  const action = appHistory.pop();
  action._t = nextHistoryTick(); // stamp "when this was undone" for redo ordering
  appRedoStack.push(action);
  await action.undo();
}
async function appRedo() {
  if (appRedoStack.length === 0) { toast('Nothing to redo', 'info'); return; }
  const action = appRedoStack.pop();
  action._t = nextHistoryTick();
  appHistory.push(action);
  await action.redo();
}

// ─── KADESSA SELF-UNDO ("undo that" / "bring it back the way it was") ──────
// Separate from the generic Ctrl+Z stack above: this lets a CHAT
// instruction reverse the exact thing Kadessa herself just did, without the
// person needing to know or reach for Ctrl+Z. Every Kadessa-authored mutating
// action should be pushed with pushKadessaAppHistory() instead of calling
// pushAppHistory() directly -- it does the same appHistory push (so
// Ctrl+Z still works on it exactly like any other action) and ALSO
// remembers it as "the thing Kadessa did", so a later chat "undo that" can
// find it specifically instead of guessing at whatever's on top of the
// shared stack.
//
// Deliberately conservative: Kadessa will only self-undo an action while it
// is STILL the very top of appHistory, i.e. nothing else (a manual edit,
// another Kadessa action, an already-used Ctrl+Z) has happened since. If
// something has, blindly popping her old action out of the middle of the
// stack could leave the page in a state nothing ever produced by hand --
// so instead she reports plainly that she can't cleanly undo it anymore
// and points at Ctrl+Z, rather than guessing.
let kadessaActionLog = [];
function pushKadessaAppHistory(action) {
  pushAppHistory(action);
  kadessaActionLog.push(action);
  if (kadessaActionLog.length > 20) kadessaActionLog.shift();
}
function kadessaUndoLastAction() {
  if (!kadessaActionLog.length) return { undone: false, reason: 'nothing yet' };
  const action = kadessaActionLog[kadessaActionLog.length - 1];
  if (appHistory[appHistory.length - 1] !== action) {
    // Something else has happened since -- don't guess, just say so.
    return { undone: false, reason: 'superseded' };
  }
  kadessaActionLog.pop();
  appUndo(); // pops the same object off appHistory, stamps the clock, runs action.undo()
  return { undone: true, label: action.label || '' };
}

// ─── PER-MODULE SNAPSHOT UNDO/REDO ───
// Beyond the hand-wired appHistory above (a handful of explicit actions), each
// data-heavy module below gets its OWN undo/redo stack built from lightweight
// JSON snapshots of its state. Every module already calls a single "something
// changed, save + redraw" function after every mutating action it has
// (daPersist, dgPersist, mfPersist) — checkpoint() piggybacks on that exact
// choke point, so every button, drag-end, and field edit in these modules
// gets undo/redo for free without hand-wiring each one individually. A
// checkpoint only lands on the stack when the snapshot actually differs from
// the last one recorded, so read-only re-renders (search filters, section
// re-opens) are automatically no-ops.
function createModuleHistory(getSnap, restoreSnap, cap) {
  const undoStack = [], redoStack = [];
  const undoTimes = [], redoTimes = [];
  let last = null, restoring = false;
  cap = cap || 60;
  return {
    checkpoint() {
      if (restoring) return; // don't record snapshots caused by our own restore
      let cur;
      try { cur = getSnap(); } catch (e) { return; }
      if (last === null) { last = cur; return; }
      if (cur !== last) {
        undoStack.push(last);
        undoTimes.push(nextHistoryTick());
        if (undoStack.length > cap) { undoStack.shift(); undoTimes.shift(); }
        redoStack.length = 0; redoTimes.length = 0;
        last = cur;
      }
    },
    undo() {
      if (!undoStack.length) return false;
      let cur; try { cur = getSnap(); } catch (e) { cur = last; }
      redoStack.push(cur);
      redoTimes.push(nextHistoryTick());
      const prev = undoStack.pop(); undoTimes.pop();
      restoring = true;
      try { restoreSnap(prev); } finally { restoring = false; }
      last = prev;
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      let cur; try { cur = getSnap(); } catch (e) { cur = last; }
      undoStack.push(cur);
      undoTimes.push(nextHistoryTick());
      const next = redoStack.pop(); redoTimes.pop();
      restoring = true;
      try { restoreSnap(next); } finally { restoring = false; }
      last = next;
      return true;
    },
    hasUndo() { return undoStack.length > 0; },
    hasRedo() { return redoStack.length > 0; },
    // Timestamp of the most recent unconsumed undo/redo entry, or -1 if none —
    // lets unifiedUndo()/unifiedRedo() compare this module's recency against
    // every other undo source instead of assuming it always wins its section.
    lastUndoTime() { return undoTimes.length ? undoTimes[undoTimes.length - 1] : -1; },
    lastRedoTime() { return redoTimes.length ? redoTimes[redoTimes.length - 1] : -1; }
  };
}

// Same idea as createModuleHistory, but for modules whose snapshots can't be
// restored synchronously — e.g. Redact PII, where each "page" is a live
// <canvas> with real burned-in pixel data. Flattening a page to a data URL
// for the snapshot is cheap and synchronous (canvas.toDataURL()), but
// rebuilding a canvas FROM a data URL has to wait on an Image element's
// load event, so restoreSnap here is async and undo()/redo() return
// Promises. getSnap still runs synchronously at checkpoint time so the
// historyClock timestamp reflects the exact moment the edit happened, not
// whenever some later await resolves.
function createAsyncModuleHistory(getSnap, restoreSnap, cap) {
  const undoStack = [], redoStack = [];
  const undoTimes = [], redoTimes = [];
  let last = null, lastKey = null, restoring = false;
  cap = cap || 20;
  return {
    checkpoint() {
      if (restoring) return;
      let cur, key;
      try { cur = getSnap(); key = JSON.stringify(cur); } catch (e) { return; }
      if (last === null) { last = cur; lastKey = key; return; }
      if (key !== lastKey) {
        undoStack.push(last);
        undoTimes.push(nextHistoryTick());
        if (undoStack.length > cap) { undoStack.shift(); undoTimes.shift(); }
        redoStack.length = 0; redoTimes.length = 0;
        last = cur; lastKey = key;
      }
    },
    async undo() {
      if (!undoStack.length) return false;
      let cur; try { cur = getSnap(); } catch (e) { cur = last; }
      redoStack.push(cur);
      redoTimes.push(nextHistoryTick());
      const prev = undoStack.pop(); undoTimes.pop();
      restoring = true;
      try { await restoreSnap(prev); } finally { restoring = false; }
      last = prev; lastKey = JSON.stringify(prev);
      return true;
    },
    async redo() {
      if (!redoStack.length) return false;
      let cur; try { cur = getSnap(); } catch (e) { cur = last; }
      undoStack.push(cur);
      undoTimes.push(nextHistoryTick());
      const next = redoStack.pop(); redoTimes.pop();
      restoring = true;
      try { await restoreSnap(next); } finally { restoring = false; }
      last = next; lastKey = JSON.stringify(next);
      return true;
    },
    hasUndo() { return undoStack.length > 0; },
    hasRedo() { return redoStack.length > 0; },
    lastUndoTime() { return undoTimes.length ? undoTimes[undoTimes.length - 1] : -1; },
    lastRedoTime() { return redoTimes.length ? redoTimes[redoTimes.length - 1] : -1; },
    // Wipes both stacks with no undo-of-the-wipe — used when the person
    // explicitly discards the whole batch (Start Over), so a later Ctrl+Z
    // can't resurrect a document they deliberately threw away.
    reset() {
      undoStack.length = 0; redoStack.length = 0;
      undoTimes.length = 0; redoTimes.length = 0;
      last = null; lastKey = null;
    }
  };
}

// Data Arrangement — snapshots the full dataset list + which tab is active.
const daHistory = createModuleHistory(
  () => JSON.stringify({ datasets: daState.datasets, activeId: daState.activeId, interconnect: !!daState.interconnect }),
  (snap) => {
    const s = JSON.parse(snap);
    daState.datasets = s.datasets;
    daState.activeId = s.activeId;
    daState.interconnect = !!s.interconnect;
    if (typeof daResetFormulaBar === 'function') daResetFormulaBar();
    if (typeof daWorkspaceRefreshVisibility === 'function') daWorkspaceRefreshVisibility();
    if (typeof daRenderTabs === 'function') daRenderTabs();
    if (typeof daRenderTable === 'function') daRenderTable();
  }
);
function daUndo() { if (!daHistory.undo()) toast('Nothing to undo', 'info'); }
function daRedo() { if (!daHistory.redo()) toast('Nothing to redo', 'info'); }

// Diagrams & Graphs — snapshots the whole chart state (data rows, colours,
// text labels, titles, chart type). No offscreen canvas in state anymore
// (the colour wheel was removed in favour of a plain native colour picker),
// so the whole thing is plain, directly-serializable JSON.
const dgHistory = createModuleHistory(
  () => JSON.stringify(dgState),
  (snap) => {
    const s = JSON.parse(snap);
    Object.keys(dgState).forEach(k => delete dgState[k]);
    Object.assign(dgState, s);
    if (typeof dgRender === 'function') dgRender();
  }
);
function dgUndo() { if (!dgHistory.undo()) toast('Nothing to undo', 'info'); }
function dgRedo() { if (!dgHistory.redo()) toast('Nothing to redo', 'info'); }

// Make Forms — snapshots the whole forms list (titles, fields, styling),
// covering both form-level edits (create/duplicate/delete) and in-editor
// field edits, since both paths funnel through mfPersist().
const mfHistory = createModuleHistory(
  () => JSON.stringify(mfState.forms),
  (snap) => {
    mfState.forms = JSON.parse(snap);
    mfMemForms = mfState.forms;
    const cur = mfState.currentId && mfState.forms.find(f => f.id === mfState.currentId);
    if (cur) {
      const t = document.getElementById('mfFormTitleInput'); if (t) t.value = cur.title || '';
      const d = document.getElementById('mfFormDescInput'); if (d) d.value = cur.desc || '';
      if (typeof mfRenderFieldList === 'function') mfRenderFieldList();
      if (typeof mfRenderLogoThumb === 'function') mfRenderLogoThumb();
      if (typeof mfRenderAccentSwatches === 'function') mfRenderAccentSwatches();
      if (typeof mfRenderWatermarkControls === 'function') mfRenderWatermarkControls();
      if (typeof mfRenderSocialLinks === 'function') mfRenderSocialLinks();
      if (typeof mfRenderPreview === 'function') mfRenderPreview();
    } else {
      mfState.currentId = null;
      if (typeof mfRenderFormsGrid === 'function') mfRenderFormsGrid();
      if (typeof mfRenderTemplateGrid === 'function') mfRenderTemplateGrid();
    }
    if (typeof mfPersist === 'function') mfPersist();
  }
);
function mfUndo() { if (!mfHistory.undo()) toast('Nothing to undo', 'info'); }
function mfRedo() { if (!mfHistory.redo()) toast('Nothing to redo', 'info'); }

// Redact PII — snapshots the WHOLE batch (every doc's pages + detections),
// not just the doc on screen. "Redact All" / batch grid-redact burn pixels
// into every document in the queue in a single pass, so a checkpoint taken
// only from the active doc would leave those other documents' redactions
// permanently un-undoable. rdxPageToStorable/rdxStorableToPage (canvas <->
// data URL) are the exact same helpers rdxPersist() already uses for
// IndexedDB, so undo/redo and persistence can never drift apart.
var _kc70843_5f9d = 1;
function rdxSnapshotBatch() {
  if (typeof rdxCaptureActiveDoc === 'function') rdxCaptureActiveDoc();
  return {
    activeDoc: rdxState.activeDoc,
    docs: rdxState.docs.map(doc => ({
      fileName: doc.fileName,
      fileType: doc.fileType,
      pages: doc.pages.map(rdxPageToStorable),
      detections: doc.detections,
      currentPage: doc.currentPage,
      nextId: doc.nextId,
      scanned: doc.scanned,
      exportEnabled: doc.exportEnabled,
      docType: doc.docType || null,
      docTypeLabel: doc.docTypeLabel || null
    }))
  };
}
async function rdxRestoreBatch(snap) {
  const docs = await Promise.all(snap.docs.map(async d => ({
    fileName: d.fileName,
    fileType: d.fileType,
    pages: await Promise.all(d.pages.map(rdxStorableToPage)),
    detections: d.detections,
    currentPage: d.currentPage,
    nextId: d.nextId,
    scanned: d.scanned,
    exportEnabled: d.exportEnabled,
    docType: d.docType,
    docTypeLabel: d.docTypeLabel
  })));
  rdxState.docs = docs;
  rdxState.activeDoc = docs.length ? Math.min(Math.max(snap.activeDoc, 0), docs.length - 1) : -1;
  if (rdxState.activeDoc >= 0) rdxApplyDocToWorking(docs[rdxState.activeDoc]);
  const nav = document.getElementById('rdxPageNav');
  if (nav) nav.style.display = rdxState.pages.length > 1 ? 'flex' : 'none';
  if (typeof rdxRenderPage === 'function') rdxRenderPage();
  if (typeof rdxRenderThumbs === 'function') rdxRenderThumbs();
  if (typeof rdxRenderSidebarList === 'function') rdxRenderSidebarList();
  if (typeof rdxRenderDocQueue === 'function') rdxRenderDocQueue();
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
  if (!docs.length) {
    const empty = document.getElementById('rdxEmptyState');
    const note = document.getElementById('rdxPrivacyNote');
    const work = document.getElementById('rdxWorkspace');
    if (empty) empty.style.display = 'flex';
    if (note) note.style.display = 'flex';
    if (work) work.style.display = 'none';
  }
}
const rdxHistory = createAsyncModuleHistory(rdxSnapshotBatch, rdxRestoreBatch, 20);
async function rdxUndo() { if (!(await rdxHistory.undo())) toast('Nothing to undo', 'info'); }
async function rdxRedo() { if (!(await rdxHistory.redo())) toast('Nothing to redo', 'info'); }

// Single global handler for Ctrl+Z (undo) / Ctrl+Y or Ctrl+Shift+Z (redo).
// Inside the PDF Editor, annotation strokes take priority (so brush/shape undo still
// feels instant); everywhere else, and once stroke history is empty, it falls
// back to the generic action history (image deletes, page deletes, pushes, etc.).
// In Data Arrangement / Diagrams & Graphs / Make Forms, the module's own
// snapshot history (above) takes priority while the section is open and has
// something to undo/redo, so every edit in those tools is covered too.
function unifiedActiveSection() {
  const el = document.querySelector('.section.active');
  return el ? el.id.replace(/^sec-/, '') : '';
}
// Every undo-capable subsystem (global app actions, the PDF editor's per-page
// stroke history, Style Specific Text, and each data-heavy module's snapshot
// history) keeps its OWN stack for good reason — they're structurally very
// different (pixel snapshots vs. JSON state vs. discrete action objects) and
// each already restores its own domain correctly. What used to be wrong was
// the ROUTING: a fixed priority order (strokes always beat app actions,
// whichever module tab happened to be open always won its section) instead
// of picking whichever stack's last change actually happened most recently.
// This asks every candidate stack "how long ago was your last change?" (via
// the shared historyClock every push/undo/redo stamps into) and always acts
// on the most recent one — so Ctrl+Z always undoes your literal last action,
// full stop, the way it does in Canva/Figma/Docs, regardless which panel
// it happened in.
let unifiedUndoRedoBusy = false;
function unifiedUndoCandidates() {
  const out = [];
  const pdfedSection = document.getElementById('sec-pdfeditor');
  const inPdfEditor = !!(pdfedSection && pdfedSection.classList.contains('active'));
  if (appHistory.length) out.push({ t: appHistory[appHistory.length - 1]._t, run: appUndo });
  if (inPdfEditor) {
    if (typeof teFafUndoStack !== 'undefined' && teFafUndoStack.length) {
      out.push({ t: teFafUndoStack[teFafUndoStack.length - 1]._t, run: teFafUndo });
    }
    if (typeof pdfed !== 'undefined' && pdfed.active >= 0 && typeof pdfedAnnotState !== 'undefined') {
      const times = pdfedStrokeTimesFor(pdfed.active);
      if (times.length) out.push({ t: times[times.length - 1], run: pdfedUndo });
    }
  }
  const sec = unifiedActiveSection();
  if (sec === 'dataarrange' && daHistory.hasUndo()) out.push({ t: daHistory.lastUndoTime(), run: daUndo });
  if (sec === 'diagrams' && dgHistory.hasUndo()) out.push({ t: dgHistory.lastUndoTime(), run: dgUndo });
  if (sec === 'makeforms' && mfHistory.hasUndo()) out.push({ t: mfHistory.lastUndoTime(), run: mfUndo });
  if (sec === 'redact' && rdxHistory.hasUndo()) out.push({ t: rdxHistory.lastUndoTime(), run: rdxUndo });
  return out;
}
function unifiedRedoCandidates() {
  const out = [];
  const pdfedSection = document.getElementById('sec-pdfeditor');
  const inPdfEditor = !!(pdfedSection && pdfedSection.classList.contains('active'));
  if (appRedoStack.length) out.push({ t: appRedoStack[appRedoStack.length - 1]._t, run: appRedo });
  if (inPdfEditor) {
    if (typeof teFafRedoStack !== 'undefined' && teFafRedoStack.length) {
      out.push({ t: teFafRedoStack[teFafRedoStack.length - 1]._t, run: teFafRedo });
    }
    if (typeof pdfed !== 'undefined' && pdfed.active >= 0 && typeof pdfedAnnotState !== 'undefined') {
      const times = pdfedRedoStrokeTimesFor(pdfed.active);
      if (times.length) out.push({ t: times[times.length - 1], run: pdfedRedo });
    }
  }
  const sec = unifiedActiveSection();
  if (sec === 'dataarrange' && daHistory.hasRedo()) out.push({ t: daHistory.lastRedoTime(), run: daRedo });
  if (sec === 'diagrams' && dgHistory.hasRedo()) out.push({ t: dgHistory.lastRedoTime(), run: dgRedo });
  if (sec === 'makeforms' && mfHistory.hasRedo()) out.push({ t: mfHistory.lastRedoTime(), run: mfRedo });
  if (sec === 'redact' && rdxHistory.hasRedo()) out.push({ t: rdxHistory.lastRedoTime(), run: rdxRedo });
  return out;
}
async function unifiedUndo() {
  if (unifiedUndoRedoBusy) return; // ignore rapid repeats while an async undo/redo is still settling
  const candidates = unifiedUndoCandidates();
  if (!candidates.length) { toast('Nothing to undo', 'info'); return; }
  candidates.sort((a, b) => b.t - a.t);
  unifiedUndoRedoBusy = true;
  try { await candidates[0].run(); } finally { unifiedUndoRedoBusy = false; }
}
async function unifiedRedo() {
  if (unifiedUndoRedoBusy) return;
  const candidates = unifiedRedoCandidates();
  if (!candidates.length) { toast('Nothing to redo', 'info'); return; }
  candidates.sort((a, b) => b.t - a.t);
  unifiedUndoRedoBusy = true;
  try { await candidates[0].run(); } finally { unifiedUndoRedoBusy = false; }
}
function onGlobalUndoRedoKeydown(e) {
  const tag = (e.target && e.target.tagName) || '';
  const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
  if (inField) return;

  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  const isUndo = mod && !e.shiftKey && key === 'z';
  const isRedo = (mod && e.shiftKey && key === 'z') || (mod && key === 'y');
  if (!isUndo && !isRedo) return;

  e.preventDefault();
  if (isUndo) unifiedUndo(); else unifiedRedo();
}
document.addEventListener('keydown', onGlobalUndoRedoKeydown);
