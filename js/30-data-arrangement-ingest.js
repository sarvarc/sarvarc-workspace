// ══════════════════════════  DATA ARRANGEMENT  ══════════════════════════
// Upload CSV / TSV / TXT / XLSX / XLS / JSON files and have them auto-parsed
// into clean, non-overlapping table grids with smart header detection.
// Entirely client-side, reusing the xlsx.full.min.js already loaded above.

// The tabs+toolbar+formula bar strip (#daStickyHead) is pinned to the top of
// .main via position:sticky, so it never scrolls out of reach on a long
// table. This just watches a 1px sentinel placed right above it — once the
// sentinel scrolls out of view, the strip is genuinely "stuck", so we add a
// shadow/hairline so it visibly reads as sitting above the table rather
// than just floating with no edge underneath it.
(function daWireStickyHeadShadow() {
  const sentinel = document.getElementById('daStickySentinel');
  const head = document.getElementById('daStickyHead');
  const scrollRoot = document.querySelector('.main');
  if (!sentinel || !head || !scrollRoot || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => head.classList.toggle('da-scrolled', !entry.isIntersecting));
  }, { root: scrollRoot, threshold: 0 });
  io.observe(sentinel);
})();

let daState = {
  datasets: [],     // { id, name, headers:[...], rows:[[...]], frozen:bool, links:{"r_c":url} }
  activeId: null
};
let daIdCounter = 0;

// Shared naming convention: when one uploaded file yields BOTH a detected
// table and separate written content, the two resulting datasets are named
// "<file>" + one of these suffixes. daExtractDocx/daExtractPdf/
// daExtractImageTable all use these when adding datasets, and daRenderTabs
// looks for this exact pairing to show one grouped tab with a Tabular Data /
// Content Found switch instead of two generic-looking tabs.
const DA_TABLE_SUFFIX = ' — Table';
const DA_PROSE_SUFFIX = ' — Content found on the page';

// ─── Persistence: keeps tables intact across refresh/reopen. Browser-only
// (localStorage), same "never leaves your device" guarantee as the rest of
// the app — just written back out on every change instead of only in memory. ───
const DA_STORAGE_KEY = 'sarvarcDaState_v1';
let daPersistTimer = null;
function daPersist() {
  if (typeof daHistory !== 'undefined') daHistory.checkpoint();
  clearTimeout(daPersistTimer);
  daPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(DA_STORAGE_KEY, JSON.stringify({
        datasets: daState.datasets,
        activeId: daState.activeId,
        interconnect: !!daState.interconnect,
        idCounter: daIdCounter
      }));
    } catch (e) { console.warn('[Data Arrangement] could not persist to localStorage', e); }
  }, 300);
  daCollabPush();
}
function daRestore() {
  try {
    const raw = localStorage.getItem(DA_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.datasets) && saved.datasets.length) {
      daState.datasets = saved.datasets;
      daState.activeId = saved.activeId || saved.datasets[0].id;
      daState.interconnect = !!saved.interconnect;
      daIdCounter = Math.max(saved.idCounter || 0, daIdCounter);
    }
  } catch (e) { console.warn('[Data Arrangement] could not restore from localStorage', e); }
}
daRestore();

// ─── LIVE CO-EDITING (see sarvarcCollabRegisterModule / core engine) ───
// Same recipe as Make Forms: each dataset is one entry in a shared Y.Map,
// keyed by dataset.id. Two people editing DIFFERENT tables never conflict;
// two people editing the very same table at the very same instant resolves
// last-write-wins for that whole table (Yjs "last write wins" per key) —
// per-cell merge isn't wired up here, same tradeoff Make Forms made.
let daCollabMap = null;
let daCollabApplyingRemote = false; // guards against remote refresh re-touching a table the user is actively editing
let daCollabRenderPending = false; // set when a remote update was skipped because you were mid-edit; a listener on daGridWrap catches it up as soon as you click/tab away

function daCollabPush() {
  if (!daCollabMap || daCollabApplyingRemote) return;
  const doc = daCollabMap.doc;
  doc.transact(() => {
    const liveIds = new Set(daState.datasets.map(d => d.id));
    daCollabMap.forEach((_v, k) => { if (!liveIds.has(k)) daCollabMap.delete(k); });
    daState.datasets.forEach(d => daCollabMap.set(d.id, d));
  });
}

function daCollabReconcileFromY(changedIds) {
  daCollabApplyingRemote = true;
  try {
    const yIds = new Set();
    daCollabMap.forEach((v, k) => { yIds.add(k); });
    const byId = {};
    daCollabMap.forEach((v, k) => { byId[k] = v; });
    // Keep local ordering for tables we already know about, append any new
    // ones, drop any that were removed remotely.
    const kept = daState.datasets.filter(d => yIds.has(d.id)).map(d => byId[d.id]);
    const existingIds = new Set(daState.datasets.map(d => d.id));
    const added = Array.from(yIds).filter(id => !existingIds.has(id)).map(id => byId[id]);
    daState.datasets = kept.concat(added);
    if (!daState.datasets.some(d => d.id === daState.activeId)) {
      daState.activeId = daState.datasets.length ? daState.datasets[0].id : null;
    }
    try { localStorage.setItem(DA_STORAGE_KEY, JSON.stringify({ datasets: daState.datasets, activeId: daState.activeId, idCounter: daIdCounter })); } catch (e) {}

    // A grid mid-edit (contenteditable focused) shouldn't get yanked out
    // from under the person typing — daRenderTable() already blurs the
    // active cell before rebuilding. But that only needs to hold back the
    // rebuild if the cell you're actually sitting in belongs to a table
    // that just changed remotely; a cell in an unrelated table (or no
    // focus at all) should redraw immediately instead of waiting on
    // whatever you do next. Previously this skipped the whole rebuild for
    // ANY focused cell, so the grid could sit stale until you happened to
    // make another edit yourself.
    const gridWrap = document.getElementById('daGridWrap');
    const active = gridWrap && document.activeElement && gridWrap.contains(document.activeElement) ? document.activeElement : null;
    let editingChangedTable = false;
    if (active && active.id && active.id.indexOf('daCell_') === 0) {
      // id pattern: daCell_<datasetId>_<row>_<col>. Strip the prefix and
      // the trailing _<row>_<col> rather than a naive split, since a
      // dataset id is just "ds" + a number so this is safe either way.
      const rest = active.id.slice('daCell_'.length);
      const lastUnderscore = rest.lastIndexOf('_');
      const secondLastUnderscore = rest.lastIndexOf('_', lastUnderscore - 1);
      const focusedDsId = rest.slice(0, secondLastUnderscore);
      editingChangedTable = !!(changedIds && changedIds.has(focusedDsId));
    }
    if (!active || !editingChangedTable) {
      if (typeof daRenderTabs === 'function') daRenderTabs();
      if (typeof daRenderTable === 'function') daRenderTable();
    } else {
      // Actively typing in the exact table that changed — leave it alone
      // for now, but flag it so the catch-up listener (wired in attach()
      // below) redraws the instant you click or tab away.
      daCollabRenderPending = true;
    }
  } finally {
    daCollabApplyingRemote = false;
  }
}

sarvarcCollabRegisterModule('dataarrange', {
  attach(doc, awareness) {
    daCollabMap = doc.getMap('daDatasets');
    if (daCollabMap.size === 0 && daState.datasets.length) {
      doc.transact(() => { daState.datasets.forEach(d => daCollabMap.set(d.id, d)); });
    } else {
      daCollabReconcileFromY(new Set(Array.from(daCollabMap.keys())));
    }
    daCollabMap.observe((event, tx) => {
      if (tx.origin !== 'remote') return;
      daCollabReconcileFromY(new Set(Array.from(event.changes.keys.keys())));
    });
    // Catch-up: if a remote update landed while you were mid-edit and got
    // deferred (see daCollabRenderPending above), redraw as soon as you
    // click or tab out of the grid, instead of leaving the view stale
    // until your next own edit happens to trigger a render.
    const gridWrap = document.getElementById('daGridWrap');
    if (gridWrap && !gridWrap.__daCollabCatchupWired) {
      gridWrap.__daCollabCatchupWired = true;
      gridWrap.addEventListener('focusout', () => {
        if (!daCollabRenderPending) return;
        daCollabRenderPending = false;
        // Let the cell's own onblur commit (daUpdateCell) run first so we
        // don't rebuild out from under it mid-commit.
        setTimeout(() => {
          if (typeof daRenderTabs === 'function') daRenderTabs();
          if (typeof daRenderTable === 'function') daRenderTable();
        }, 0);
      });
    }
  },
  detach() { daCollabMap = null; }
});

// ─── Drag & drop wiring (mirrors handleDragOver/handleDrop but scoped to Data Arrangement) ───
function daDragOver(e) { e.preventDefault(); document.getElementById('daUploadZone').classList.add('dragover'); }
function daDragLeave() { document.getElementById('daUploadZone').classList.remove('dragover'); }
function daDrop(e) {
  e.preventDefault();
  document.getElementById('daUploadZone').classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length) daIngestFiles(e.dataTransfer.files);
}
function daHandleFileSelect(e) {
  if (e.target.files && e.target.files.length) daIngestFiles(e.target.files);
  e.target.value = '';
}

function daSetProgress(show, label) {
  const wrap = document.getElementById('daProgress');
  if (!wrap) return;
  wrap.style.display = show ? 'flex' : 'none';
  if (label) document.getElementById('daProgressLabel').textContent = label;
}

async function daIngestFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  daSetProgress(true, files.length > 1 ? `Reading ${files.length} files…` : `Reading ${files[0].name}…`);
  const noTableFiles = [];
  for (const file of files) {
    try {
      const result = await daProcessSingleFile(file);
      if (result && result.tableFound === false) noTableFiles.push(file.name);
    } catch (err) {
      console.error('[Data Arrangement] failed to parse', file.name, err);
      const msg = err && err.ocrEngineUnavailable
        ? 'the OCR engine couldn\'t start (check your connection and try again)'
        : (err.message || 'unsupported or corrupted file');
      toast(`Couldn't read "${file.name}", ${msg}`, 'error');
    }
  }
  daSetProgress(false);
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
  if (noTableFiles.length) {
    const who = noTableFiles.length === 1 ? `"${noTableFiles[0]}"` : `${noTableFiles.length} files`;
    toast(`No table detected in ${who}, content was arranged as text instead. Add a table manually with the "Column"/"Row" buttons here, or the Table tool in the Workspace.`, 'info');
  }
}

function daProcessSingleFile(file) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));

    if (ext === 'xlsx' || ext === 'xls') {
      // Spreadsheets are already tabular by definition, so this format never
      // hits the "couldn't detect a table" case, it's the raw sheet grid.
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          wb.SheetNames.forEach((sheetName) => {
            const ws = wb.Sheets[sheetName];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
            const label = wb.SheetNames.length > 1 ? `${daBaseName(file.name)}, ${sheetName}` : daBaseName(file.name);
            daAddDataset(label, aoa);
          });
          resolve({ tableFound: true });
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);

    } else if (ext === 'json') {
      // Structured data by definition, same reasoning as xlsx above.
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const aoa = daJsonToAOA(parsed);
          daAddDataset(daBaseName(file.name), aoa);
          resolve({ tableFound: true });
        } catch (e) { reject(new Error('invalid JSON')); }
      };
      reader.readAsText(file);

    } else if (ext === 'docx') {
      reader.onload = async () => {
        try {
          const result = await daExtractDocx(reader.result, file.name);
          resolve(result);
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);

    } else if (ext === 'pdf') {
      reader.onload = async () => {
        try {
          const result = await daExtractPdf(reader.result, file.name);
          resolve(result);
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);

    } else if (ext === 'doc' || ext === 'rtf') {
      reject(new Error('legacy .doc/.rtf isn\'t supported in-browser, please save as .docx and try again'));

    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)) {
      daExtractImageTable(file).then(resolve).catch(reject);

    } else {
      // csv / tsv / txt / anything else plain-text, run the smart multi-strategy parser
      reader.onload = () => {
        try {
          const forcedDelim = ext === 'tsv' ? '\t' : null;
          const result = daIngestTextContent(reader.result, forcedDelim, file.name);
          resolve(result);
        } catch (e) { reject(e); }
      };
      reader.readAsText(file);
    }
  });
}

// ─── Merged-cell-aware table reader ───
// A naive td/tr walk falls apart the moment a Word table uses colspan or
// rowspan (extremely common in form-style templates, e.g. one label cell
// merged across two value columns, or a value cell merged down two rows).
// That naive approach shifts every cell after a merge one slot to the left,
// which is why fields would land under the wrong header and headers with an
// empty merged cell would get rejected in favor of generic "Column 1/2/3"
// names. This walks the table the way a browser renders it, tracking which
// columns are still "occupied" by a rowspan from a previous row, so every
// row comes out the same width and each field lines up under the right column.
function daExtractTableGrid(table) {
  const trs = Array.from(table.querySelectorAll('tr'));
  const grid = [];
  const pending = {}; // colIndex -> { text, rowsLeft }

  trs.forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td,th'));
    const rowArr = [];
    let col = 0, ci = 0;

    while (ci < cells.length) {
      while (pending[col] && pending[col].rowsLeft > 0) {
        rowArr[col] = pending[col].text;
        pending[col].rowsLeft--;
        if (pending[col].rowsLeft === 0) delete pending[col];
        col++;
      }
      const cell = cells[ci];
      const text = cell.textContent.replace(/\s+/g, ' ').trim();
      const colSpan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const rowSpan = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
      for (let s = 0; s < colSpan; s++) {
        rowArr[col] = text;
        if (rowSpan > 1) pending[col] = { text, rowsLeft: rowSpan - 1 };
        col++;
      }
      ci++;
    }
    // Trailing columns still held open by a rowspan from above (no more real
    // cells left in this row to interleave with) still need to be filled in.
    while (pending[col] && pending[col].rowsLeft > 0) {
      rowArr[col] = pending[col].text;
      pending[col].rowsLeft--;
      if (pending[col].rowsLeft === 0) delete pending[col];
      col++;
    }
    grid.push(rowArr);
  });

  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  return grid.map(r => Array.from({ length: maxCols }, (_, i) => r[i] === undefined ? '' : r[i]));
}

// ─── Photo/screenshot of a table (PNG/JPG/WEBP/etc.) ───
// There's no structural table markup to lean on here, only pixels, so this
// runs OCR (reusing the PDF editor's Tesseract worker/preprocessing so the
// engine only ever loads once) and reconstructs a grid from where each
// recognized word actually sits on the page, rather than just its reading
// order. Reading order alone would run every row together as one long line.
async function daExtractImageTable(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('could not read image'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('could not decode image, it may be corrupted'));
    im.src = dataUrl;
  });

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.naturalWidth || img.width;
  srcCanvas.height = img.naturalHeight || img.height;
  srcCanvas.getContext('2d').drawImage(img, 0, 0);

  daSetProgress(true, 'Reading image (OCR)…');
  _teOcrProgressCb = (frac, label) => daSetProgress(true, label || 'Reading image (OCR)…');
  try {
    const { canvas: ocrCanvas } = pdfedPreprocessForOcr(srcCanvas);
    const worker = await pdfedGetOcrWorker();
    const { data } = await worker.recognize(ocrCanvas);
    const words = (data.words || []).filter(w => w.text && w.text.trim() && w.confidence >= 35);
    if (!words.length) {
      daAddDataset(daBaseName(file.name), [['Content'], ['No readable text was found in this image.']]);
      toast(`Couldn't find readable text in "${file.name}".`, 'error');
      return { tableFound: false };
    }

    // Reconstruct which lines are table rows vs plain written lines — ruled
    // grid-line detection first, then whitespace-based line classification
    // as a fallback (see daExtractOcrTableAndProse), so a table sitting
    // alongside a paragraph of text (or a caption underneath it) gets
    // picked out cleanly instead of the whole image being forced one way or
    // the other. Passing ocrCanvas lets it look for real drawn border lines
    // on the actual pixels Tesseract read, not just word spacing.
    const { tableRows, proseLines } = daExtractOcrTableAndProse(words, ocrCanvas);
    const blocks = daLinesToBlocksFromText(proseLines.join('\n'));
    const proseWordCount = blocks.filter(b => !b.heading).reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

    const hasTable = tableRows.length >= 2 && tableRows[0] && tableRows[0].length > 1;
    const hasProse = proseWordCount > 12;

    // Image-to-text via OCR is a newly-added, still-in-development path —
    // unlike CSV/XLSX/DOCX (parsed from real structured data), this is
    // reconstructed from pixel positions and can misread a character, merge/
    // split a column, or drop a faint line. Flag that plainly whenever
    // something lands, so it isn't treated as trustworthy as an export
    // straight from a spreadsheet or a real text layer.
    const disclaimer = 'please double-check against the original image before relying on it.';

    if (!hasTable && !hasProse) {
      // Neither a clean table nor enough running text to arrange into
      // topics — fall back to one raw reconstructed grid across the whole
      // image rather than losing the OCR pass entirely.
      const gridAoa = daClusterOcrWordsIntoGrid(words);
      daAddDataset(daBaseName(file.name), gridAoa);
      toast(`Table extracted from "${file.name}" via OCR (beta) — ${disclaimer}`, 'info');
      return { tableFound: gridAoa.length > 1 && gridAoa[0].length > 1 };
    }

    if (hasTable) {
      daAddDataset(hasProse ? `${daBaseName(file.name)}${DA_TABLE_SUFFIX}` : daBaseName(file.name), tableRows);
    }
    if (hasProse) {
      const aoa2 = daArrangeBlocksIntoTopics(blocks);
      daAddDataset(hasTable ? `${daBaseName(file.name)}${DA_PROSE_SUFFIX}` : daBaseName(file.name), aoa2);
    }

    toast(hasTable && hasProse
      ? `"${file.name}" had both a table and written content, arranged into two connected views via OCR (beta) — ${disclaimer}`
      : hasTable
        ? `Table extracted from "${file.name}" via OCR (beta) — ${disclaimer}`
        : `Written content extracted from "${file.name}" via OCR (beta) — ${disclaimer}`, 'info');
    return { tableFound: hasTable };
  } finally {
    _teOcrProgressCb = null;
  }
}

// Reconstructs a table grid from OCR word boxes by position, not reading
// order: 1) cluster words into visual rows by vertical center proximity,
// 2) build a whitespace "projection profile" across the whole table —
// for every x-position, what fraction of rows have a word covering it —
// and treat any x-band that's empty in almost every row as a column gap,
// 3) bucket each word into the column its horizontal CENTER falls in.
//
// This replaced an earlier version that looked at word-to-word gaps one
// row at a time and merged similar-looking gaps into a shared boundary
// list. That approach broke down on real tables because a column's true
// edge lands at a different pixel on almost every row (a long name vs. a
// short one, a 3-digit fare vs. a 1-digit age), so gaps that were really
// the same column boundary often drifted past the merge tolerance and got
// counted as two separate boundaries — effectively doubling some columns,
// which is what produced the "header lands in different columns than the
// data" symptom. Scoring boundaries by column-wide whitespace instead of
// per-row gaps is far less sensitive to that per-row width drift, because
// it only cares whether a vertical strip is *consistently* empty top to
// bottom, not how wide any single row's gap happens to look.
function daGroupOcrWordsIntoLines(words) {
  const ws = words.map(w => ({
    text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1,
    yc: (w.bbox.y0 + w.bbox.y1) / 2, h: Math.max(1, w.bbox.y1 - w.bbox.y0)
  })).filter(w => w.text);
  if (!ws.length) return { lines: [], medH: 12 };

  ws.sort((a, b) => a.yc - b.yc);
  const sortedH = ws.map(w => w.h).sort((a, b) => a - b);
  const medH = sortedH[Math.floor(sortedH.length / 2)] || 12;
  const lineGap = medH * 0.6;
  const lines = [];
  ws.forEach(w => {
    let line = lines[lines.length - 1];
    if (!line || Math.abs(line.yc - w.yc) > lineGap) {
      line = { yc: w.yc, words: [] };
      lines.push(line);
    }
    line.words.push(w);
    line.yc = (line.yc * (line.words.length - 1) + w.yc) / line.words.length;
  });
  lines.forEach(l => l.words.sort((a, b) => a.x0 - b.x0));
  return { lines, medH };
}

// Aligns a set of already-grouped lines into a grid via a whitespace
// "projection profile" scoped to just THESE lines: for every x-position,
// what fraction of these lines have a word covering it, any x-band that
// stays empty across nearly all of them is a column gap. Scoping it to a
// pre-picked subset of lines (rather than every line on the page/image)
// means a table's column gaps never get diluted by unrelated paragraph
// lines sitting elsewhere in the same document — see daExtractOcrTableAndProse.
function daAlignLinesIntoGrid(lines, medH) {
  if (!lines.length) return [];
  const allWords = lines.flatMap(l => l.words);
  if (!allWords.length) return [];

  const minX = Math.min(...allWords.map(w => w.x0));
  const maxX = Math.max(...allWords.map(w => w.x1));
  const bucketW = Math.max(1, medH * 0.25);
  const nBuckets = Math.max(1, Math.ceil((maxX - minX) / bucketW));
  const coverCount = new Array(nBuckets).fill(0);
  lines.forEach(l => {
    l.words.forEach(w => {
      const b0 = Math.max(0, Math.floor((w.x0 - minX) / bucketW));
      const b1 = Math.min(nBuckets - 1, Math.floor((w.x1 - minX) / bucketW));
      for (let b = b0; b <= b1; b++) coverCount[b]++;
    });
  });

  // A bucket counts as "gap" space once fewer than ~15% of these lines have
  // a word sitting on it — a handful of rows bleeding slightly into a real
  // column gap (long values, a wrapped header) shouldn't disqualify it.
  // Only contiguous gap runs at least ~0.9x a word-height wide count as an
  // actual column boundary, so normal single-space word gaps within a cell
  // (e.g. "Human Resources") don't get mistaken for one.
  const gapThreshold = Math.max(1, lines.length * 0.15);
  const minGapWidth = Math.max(medH * 0.9, bucketW * 2);
  // A run that's merely "mostly empty" (<15% coverage, per gapThreshold above)
  // still needs to clear minGapWidth to count — that width floor is scaled to
  // word height, which is right for ordinary prose-style columns but too wide
  // for two common accounting-table patterns: a narrow ID/code column (e.g.
  // "Voucher No." data like "JV-001") sitting next to its neighbor with only a
  // small margin, and two right-aligned numeric columns (Debit/Credit) set
  // close together. Both leave a REAL boundary that's narrower than
  // minGapWidth, so it used to get silently dropped — merging those columns
  // and cascading a column-shift through the rest of the row. A run where
  // literally zero words from any line ever touch it (not just <15%, but
  // exactly 0%) is unambiguous evidence of a true column edge regardless of
  // how narrow it is, so that case gets its own, much lower width floor.
  const fullyEmptyMinGapWidth = Math.max(medH * 0.35, bucketW);
  const isGap = coverCount.map(c => c < gapThreshold);
  const isFullyEmpty = coverCount.map(c => c === 0);
  const boundaries = [];
  let runStart = null;
  for (let b = 0; b <= nBuckets; b++) {
    const gapHere = b < nBuckets && isGap[b];
    if (gapHere && runStart === null) runStart = b;
    if (!gapHere && runStart !== null) {
      const runWidthPx = (b - runStart) * bucketW;
      const runFullyEmpty = isFullyEmpty.slice(runStart, b).every(Boolean);
      const clears = runWidthPx >= minGapWidth ||
        (runFullyEmpty && runWidthPx >= fullyEmptyMinGapWidth);
      if (clears) boundaries.push(minX + ((runStart + b) / 2) * bucketW);
      runStart = null;
    }
  }

  // Fallback for a ragged/skewed scan where no clean whitespace column ever
  // lines up across these rows: still produce a usable (if rougher) grid
  // via the old per-row gap clustering than to give up.
  if (!boundaries.length) return daClusterOcrWordsIntoGridLegacy(lines, medH);

  const colOf = (x) => { let c = 0; while (c < boundaries.length && x >= boundaries[c]) c++; return c; };
  const width = boundaries.length + 1;
  return lines.map(l => {
    const row = new Array(width).fill('');
    l.words.forEach(w => {
      // Bucket by the word's horizontal CENTER, not its left edge — a word
      // whose bounding box straddles a boundary by a few px (common after
      // OCR bbox rounding) still lands in the column it visually belongs to.
      const c = colOf((w.x0 + w.x1) / 2);
      row[c] = row[c] ? `${row[c]} ${w.text}` : w.text;
    });
    return row;
  });
}

// One raw grid across every line on the page/image, no table-vs-prose
// split. Used only as a last resort when neither a real table nor enough
// running text gets detected by daExtractOcrTableAndProse below, so the OCR
// pass still produces something rather than nothing.
function daClusterOcrWordsIntoGrid(words) {
  const { lines, medH } = daGroupOcrWordsIntoLines(words);
  if (!lines.length) return [['Content']];
  return daAlignLinesIntoGrid(lines, medH);
}

// Classifies each OCR line as a table-row candidate (its own words split
// into 2+ cells once a gap clearly bigger than normal word-spacing shows up
// within THAT line) or a prose line (reads as one continuous run of text).
// This runs before any cross-line column alignment, line by line, on
// purpose: judging a line against only itself means a paragraph sharing the
// page with a table can never wash out the table's column gaps, and the
// table's wide cell gaps can never fool a paragraph line into looking like
// a multi-column row.
function daClassifyOcrLines(lines, medH) {
  // Real table columns are separated by a gap clearly wider than normal
  // word-spacing — 1.4x a word's own height was too conservative and could
  // miss tables in tightly-spaced renders, 1.1x still comfortably clears
  // normal inter-word spacing (usually ~0.3-0.5x word height) without
  // flagging it.
  const gapThreshold = Math.max(medH * 1.1, 8);
  const cellCounts = lines.map(line => {
    const ws = line.words;
    let cellCount = 1;
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].x0 - ws[i - 1].x1 >= gapThreshold) cellCount++;
    }
    return cellCount;
  });

  // A real table is a CONSECUTIVE run of multi-cell lines, not a one-off
  // line scattered somewhere in a paragraph (an occasional unusually wide
  // space in a sentence, or a justified line, shouldn't be mistaken for a
  // table on its own). Find the longest such run — that's the table;
  // everything else, including any shorter/scattered candidate lines, is
  // written content.
  let bestStart = -1, bestLen = 0, runStart = -1;
  for (let i = 0; i <= lines.length; i++) {
    const isCandidate = i < lines.length && cellCounts[i] > 1;
    if (isCandidate && runStart === -1) runStart = i;
    if (!isCandidate && runStart !== -1) {
      const len = i - runStart;
      if (len > bestLen) { bestLen = len; bestStart = runStart; }
      runStart = -1;
    }
  }

  const tableLines = [];
  const proseLines = [];
  lines.forEach((line, i) => {
    if (bestLen >= 2 && i >= bestStart && i < bestStart + bestLen) {
      tableLines.push(line);
    } else {
      const text = line.words.map(w => w.text).join(' ').trim();
      if (text) proseLines.push(text);
    }
  });
  return { tableLines, proseLines };
}

// ─── Ruled-grid detection: scans the OCR canvas's own pixels for real
// border lines (a boxed/ruled table drawn with actual horizontal and
// vertical rules — reports, screenshotted spreadsheets, invoices) rather
// than only inferring columns from whitespace between words. A table like
// this can defeat the whitespace-projection approach below when a header
// row's wider letter-spacing, a short numeric column, or tight cell padding
// leaves no reliably empty vertical strip — but the drawn lines themselves
// are unambiguous. Runs on the SAME canvas handed to Tesseract, so the
// pixel coordinates it returns line up directly with word bounding boxes.
// Returns null when no confident ruled grid is found — borderless tables
// still fall through to the whitespace-projection path below.
function daDetectTableGridLines(canvas) {
  const w = canvas.width, h = canvas.height;
  if (w < 20 || h < 20) return null;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  // The preprocessed canvas is grayscale (R=G=B) and contrast-stretched.
  // 245 (not near-black) is deliberately loose, so faint gray rule lines
  // count, not just solid black ones — it's the near-zero gap tolerance
  // below, not a strict darkness cutoff, that keeps ordinary text (which
  // always has letter/word gaps) from being mistaken for a drawn rule.
  const DARK = 245;
  const gapTol = 1;

  function longestRun(getVal, len) {
    let runStart = -1, gap = 0, bestStart = 0, bestLen = 0;
    for (let i = 0; i < len; i++) {
      if (getVal(i) < DARK) {
        if (runStart === -1) runStart = i;
        gap = 0;
      } else if (runStart !== -1) {
        gap++;
        if (gap > gapTol) {
          const end = i - gap;
          const runLen = end - runStart;
          if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
          runStart = -1; gap = 0;
        }
      }
    }
    if (runStart !== -1) {
      const runLen = len - runStart;
      if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
    }
    return bestLen > 0 ? { start: bestStart, len: bestLen } : null;
  }

  // 1) Horizontal rule candidates: for every row, the longest contiguous
  // dark run across the full width.
  const minHLen = Math.max(40, w * 0.10);
  const hCandidates = [];
  for (let y = 0; y < h; y++) {
    const run = longestRun(x => data[(y * w + x) * 4], w);
    if (run && run.len >= minHLen) hCandidates.push({ y, x0: run.start, x1: run.start + run.len });
  }
  if (hCandidates.length < 3) return null; // need at least 2 row bands worth of rules

  // Group consecutive candidate rows (within 3px of each other) into
  // blocks. A THIN block is a drawn rule — collapse it to one line as
  // before. But a table with a shaded/filled row (a common header style —
  // solid gray fill butted right up against its own border, with no light
  // gap between fill and rule) produces one tall, unbroken dark block
  // instead: collapsing that to a single averaged line would land it
  // somewhere in the middle of the header text and lose the row entirely.
  // Its own top and bottom edges ARE the real boundaries (top-of-header,
  // header/data divider), so both get kept as separate candidate lines.
  const maxLineThickness = Math.max(4, Math.min(14, h * 0.012));
  const hLines = [];
  {
    let i = 0;
    while (i < hCandidates.length) {
      let j = i, x0 = hCandidates[i].x0, x1 = hCandidates[i].x1;
      while (j + 1 < hCandidates.length && hCandidates[j + 1].y - hCandidates[j].y <= 3) {
        j++;
        x0 = Math.min(x0, hCandidates[j].x0);
        x1 = Math.max(x1, hCandidates[j].x1);
      }
      const thickness = hCandidates[j].y - hCandidates[i].y;
      if (thickness <= maxLineThickness) {
        hLines.push({ y: (hCandidates[i].y + hCandidates[j].y) / 2, x0, x1 });
      } else {
        hLines.push({ y: hCandidates[i].y, x0, x1 });
        hLines.push({ y: hCandidates[j].y, x0, x1 });
      }
      i = j + 1;
    }
  }
  if (hLines.length < 3) return null;

  // 2) A table's rules all share roughly the same left/right extent — group
  // around the widest line found, so a one-off horizontal rule elsewhere on
  // the page (an underline, a section divider) can't get pulled in as an
  // extra "row" of an unrelated table.
  const seed = hLines.reduce((a, b) => (b.x1 - b.x0) > (a.x1 - a.x0) ? b : a);
  const overlapFrac = (a, b) => {
    const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
    const inter = Math.max(0, hi - lo);
    return inter / Math.min(a.x1 - a.x0, b.x1 - b.x0);
  };
  const cluster = hLines.filter(l => overlapFrac(l, seed) >= 0.6);
  if (cluster.length < 3 || cluster.length > 60) return null;
  cluster.sort((a, b) => a.y - b.y);

  let rows = cluster.map(l => l.y);
  const tableX0 = Math.min(...cluster.map(l => l.x0));
  const tableX1 = Math.max(...cluster.map(l => l.x1));
  const tableY0 = rows[0], tableY1 = rows[rows.length - 1];
  const nRowBands = rows.length - 1;
  if (nRowBands < 2) return null;
  // Guard against a false-positive "shadow gradient" (a soft lighting
  // gradient in a photo) being read as dozens of near-identical rules — a
  // real table's rows aren't sliver-thin.
  if ((tableY1 - tableY0) / nRowBands < 6) return null;

  // A shaded/colored header row (a common spreadsheet style — pale fill,
  // no dark pixels of its own) contributes nothing to the dark-run scan
  // above except its thin bounding gridlines. Those gridlines can be
  // shorter or fainter than the rest of the table's rules — broken up by
  // filter-dropdown icons sitting right on that row, or by bold header
  // text overlapping the line — so the boundary between the header and the
  // very first data row is the one most likely to get missed, silently
  // fusing header + first row into one oversized band. Detect that by
  // comparing the first band's height against the rest, then re-scan just
  // that slice with a shorter minimum run length (scoped to the table's
  // own width, not the whole page) to recover the missed line.
  if (rows.length >= 4) {
    const bandHeights = rows.slice(1).map((y, i) => y - rows[i]);
    const laterBands = bandHeights.slice(1).sort((a, b) => a - b);
    const median = laterBands[Math.floor(laterBands.length / 2)];
    if (median > 0 && bandHeights[0] > median * 1.6) {
      const y0 = Math.round(rows[0]), y1 = Math.round(rows[1]);
      const tblW = Math.round(tableX1 - tableX0);
      const localMinLen = Math.max(20, tblW * 0.25);
      let best = null;
      for (let y = y0 + 3; y < y1 - 3; y++) {
        const run = longestRun(x => data[(y * w + Math.round(tableX0) + x) * 4], tblW);
        if (run && run.len >= localMinLen && (!best || run.len > best.len)) best = { y, len: run.len };
      }
      if (best) rows = [rows[0], best.y, ...rows.slice(1)];
    }
  }

  // 3) Vertical rules, scoped to just the table's own bounding box, on the
  // same principle: a solid dark run spanning most of the table's height.
  const minVLen = (tableY1 - tableY0) * 0.5;
  const tblH = Math.round(tableY1 - tableY0) + 1;
  const vCandidates = [];
  for (let x = Math.round(tableX0); x <= Math.round(tableX1); x++) {
    const run = longestRun(y => data[((tableY0 + y) * w + x) * 4], tblH);
    if (run && run.len >= minVLen) vCandidates.push({ x, y0: tableY0 + run.start, y1: tableY0 + run.start + run.len });
  }
  // Same thin-rule-vs-filled-block distinction as the horizontal pass above
  // (a shaded label column would otherwise collapse to one misplaced line).
  const maxVThickness = Math.max(4, Math.min(14, w * 0.012));
  const vLines = [];
  {
    let i = 0;
    while (i < vCandidates.length) {
      let j = i;
      while (j + 1 < vCandidates.length && vCandidates[j + 1].x - vCandidates[j].x <= 3) j++;
      const thickness = vCandidates[j].x - vCandidates[i].x;
      if (thickness <= maxVThickness) {
        vLines.push({ x: (vCandidates[i].x + vCandidates[j].x) / 2 });
      } else {
        vLines.push({ x: vCandidates[i].x });
        vLines.push({ x: vCandidates[j].x });
      }
      i = j + 1;
    }
  }

  return {
    rows,
    cols: vLines.length >= 3 ? vLines.map(l => l.x) : null,
    bbox: { x0: tableX0, y0: tableY0, x1: tableX1, y1: tableY1 }
  };
}

// ─── Spreadsheet-chrome stripper ───
// A screenshot of a live spreadsheet (Excel, Sheets, etc.) almost always
// captures more than the data: the column-letter row (A, B, C…) above the
// real header, and the row-number gutter (1, 2, 3…) to the left of the real
// data. Both are ruled with gridlines just like the table itself, so
// daDetectTableGridLines has no way to tell them apart from real table rules
// — they get read in as an extra header row and an extra leading column.
// Strip them here, once the OCR text is in hand, using the one signal that's
// unambiguous: real spreadsheet chrome has a very specific shape (single
// A/B/C… letters in strict left-to-right order; consecutive integers top to
// bottom), which real data essentially never does by coincidence.
function daStripSpreadsheetChrome(tableRows) {
  if (!tableRows.length) return tableRows;
  let rows = tableRows.map(r => r.slice());

  // Column-letter header row — normally row 0, but a shaded/colored real
  // header row can occasionally get detected as a separate band above it,
  // so check the first couple of rows rather than only row 0.
  const colLetterSeq = () => {
    const row = rows[0];
    const nextRow = rows[1];
    const filled = row.map((c, i) => ({ v: String(c).trim(), i })).filter(o => o.v !== '');
    if (filled.length < 2) return false;
    // Tolerate a stray OCR misread (e.g. "D" read as "]") — require most,
    // not all, filled cells to look like real column letters rather than
    // letting one mangled glyph disqualify the whole row.
    const letterCells = filled.filter(o => /^[A-Z]{1,2}$/.test(o.v));
    const ascendingOk = (cells) => {
      for (let k = 1; k < cells.length; k++) {
        if (daColLetterToIndex(cells[k].v) <= daColLetterToIndex(cells[k - 1].v)) return false;
      }
      return true;
    };
    // Must actually read in ascending spreadsheet-column order (A, B, C…
    // or with gaps like A, C, E if some letters were merged/missed) —
    // guards against a real header coincidentally being a couple of
    // single letters, e.g. an "ID"/"Q" column abbreviation. Checked only
    // across the cells that parsed cleanly as letters, so a noise cell in
    // between can't break the sequence for the ones that did.
    if (letterCells.length >= Math.max(2, Math.ceil(filled.length * 0.6)) && ascendingOk(letterCells)) {
      return true;
    }
    // Weaker fallback for when OCR mangled MOST of the letters into stray
    // punctuation (e.g. "]" for "D", "|" for "E") rather than just one —
    // too garbled to confirm an ascending A-B-C sequence directly. Instead
    // lean on the shape of the row itself plus what's underneath it: every
    // filled cell here is a single short (1-2 char) token (consistent with
    // a letter or a misread glyph standing in for one — whether every
    // column got such a token, or only some did), while the row directly
    // below is fully filled, mostly text, and has at least one real
    // multi-word label — the signature of a genuine header row. A real
    // header essentially never has every one of its own cells be a bare
    // 1-2 character token, so this combination is a safe, if softer,
    // signal that row 0 is chrome regardless of how many of its cells
    // came through filled.
    if (nextRow && filled.every(o => o.v.length <= 2)) {
      const nextFilled = nextRow.filter(c => String(c).trim() !== '');
      const nextMostlyFilled = nextFilled.length >= Math.ceil(row.length * 0.8);
      const nextMostlyText = nextFilled.filter(c => !daCellLooksNumeric(c)).length >= Math.ceil(nextFilled.length * 0.8);
      const nextHasRealLabel = nextFilled.some(c => String(c).trim().length > 2);
      if (nextMostlyFilled && nextMostlyText && nextHasRealLabel) return true;
    }
    return false;
  };
  while (rows.length > 2 && colLetterSeq()) rows = rows.slice(1);


  // Row-number gutter column — normally column 0. Consecutive (allowing
  // occasional OCR misses) integers top to bottom.
  const isRowGutter = (colIdx) => {
    const raw = rows.map(r => String(r[colIdx] ?? '').trim()).filter(v => v !== '');
    if (raw.length < 3 || raw.length < rows.length * 0.5) return false;
    // A gutter number can end up fused with a stray adjacent glyph (e.g.
    // "1 2" instead of "1") — pull the leading digit run out of each cell
    // rather than requiring the whole cell to be a clean integer, and
    // tolerate a minority of cells that still don't parse at all.
    const parsed = raw.map(v => { const m = v.match(/^\d+/); return m ? m[0] : null; }).filter(Boolean);
    if (parsed.length < Math.max(2, Math.ceil(raw.length * 0.7))) return false;
    let increasing = 0;
    for (let k = 1; k < parsed.length; k++) if (parseInt(parsed[k], 10) > parseInt(parsed[k - 1], 10)) increasing++;
    return increasing >= (parsed.length - 1) * 0.8;
  };
  if (rows.length && rows[0].length > 1 && isRowGutter(0)) {
    rows = rows.map(r => r.slice(1));
  }

  // Filter/sort-arrow icons that sit right on a header cell get misread by
  // OCR as an isolated punctuation glyph in front of the real text (e.g.
  // "[North", "|Winter") — real data essentially never starts with a bare
  // symbol like that, so trim it. Also catches a leading "=" that would
  // otherwise get treated as the start of a formula and show as #ERROR!.
  const iconNoise = /^[[\]{}|<>=~^`]+\s*(?=\S)/;
  rows = rows.map(r => r.map(c => String(c ?? '').replace(iconNoise, '')));

  // A stray extra vertical rule (e.g. a filter/sort-arrow icon on a header
  // cell mistaken for a column boundary) can split one real column into
  // two bands, leaving one half permanently blank across every row —
  // including the header. A genuine real column always has at least a
  // header label, so any column that's empty everywhere is phantom; drop it.
  if (rows.length && rows[0].length > 1) {
    const nCols = rows[0].length;
    const colIsEmpty = new Array(nCols).fill(true);
    rows.forEach(r => r.forEach((c, i) => { if (String(c ?? '').trim() !== '') colIsEmpty[i] = false; }));
    if (colIsEmpty.some(Boolean) && colIsEmpty.some(v => !v)) {
      rows = rows.map(r => r.filter((_, i) => !colIsEmpty[i]));
    }
  }

  return rows;
}
function daColLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Scores a candidate table on two concrete failure signatures a broken
// column-boundary detection tends to leave behind, regardless of which of
// the two detectors (ruled-grid vs. whitespace-projection) produced it:
//   1) a column that's blank in every single data row — a real column with
//      its own header essentially never has zero populated rows across an
//      entire table, so this almost always means that column's real content
//      got bucketed one slot over.
//   2) a cell holding two separate amount-like tokens run together (e.g.
//      "5,00,000.00 5,00,000.00") — the signature of two adjacent numeric
//      columns (typically Debit/Credit) collapsing into one because the
//      gap between them wasn't recognized as a column boundary.
// Lower is better (fewer problems found). Used to pick between two
// differently-derived extractions of the same table rather than trusting
// either detector blindly.
function daTableQualityScore(tableRows) {
  if (!tableRows || tableRows.length < 2) return Infinity;
  const header = tableRows[0];
  const dataRows = tableRows.slice(1);
  if (!dataRows.length) return Infinity;
  let score = 0;
  const nCols = Math.max(...tableRows.map(r => r.length));
  for (let c = 0; c < nCols; c++) {
    const headerBlank = !String(header[c] ?? '').trim();
    const allBlank = dataRows.every(r => !String(r[c] ?? '').trim());
    if (allBlank && !headerBlank) score += 3; // labeled column, zero data anywhere
  }
  const moneyPairRe = /\d[\d,]*\.\d{2}\s+\d[\d,]*\.\d{2}/;
  dataRows.forEach(r => {
    r.forEach(cell => { if (moneyPairRe.test(String(cell ?? ''))) score += 3; });
  });
  return score;
}

// Buckets OCR words into the ruled grid found by daDetectTableGridLines —
// by pixel position, not reading order, so a merged cell or an oddly-kerned
// header can't shuffle a value into the wrong column. Words that fall
// outside the table's bounding box (a title above it, a caption below) are
// handed back separately so they still make it into the written-content
// canvas instead of being lost.
function daExtractOcrTableViaGrid(words, grid) {
  const { rows, cols, bbox } = grid;
  const marginX = (bbox.x1 - bbox.x0) * 0.02;
  const insideWords = [];
  const outsideWords = [];
  words.forEach(w => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    if (cx >= bbox.x0 - marginX && cx <= bbox.x1 + marginX && cy >= bbox.y0 && cy <= bbox.y1) {
      insideWords.push(w);
    } else {
      outsideWords.push(w);
    }
  });

  if (!cols) {
    // No clean vertical rules (a table ruled only with horizontal lines) —
    // fall back to the whitespace-projection column finder, but scoped to
    // just these row-banded words, which is still far more reliable than
    // running that projection over the whole page.
    const { lines: rowLines, medH } = daGroupOcrWordsIntoLines(insideWords);
    const tableRows = daAlignLinesIntoGrid(rowLines, medH);
    return { tableRows: daStripSpreadsheetChrome(tableRows), outsideWords };
  }

  // A missed vertical rule — too faint or thin for daDetectTableGridLines to
  // pick up, common when a narrow "short label" column (e.g. Team) sits next
  // to a wide "long value" column (e.g. Date) with a light default gridline
  // between them — leaves two real columns' words landing in the same
  // detected band. Check each detected column band for that signature before
  // bucketing: if most rows in that band show a horizontal gap between
  // consecutive words that's far wider than ordinary word-spacing, treat it
  // as a missed rule and insert an extra split line at the average gap.
  const splitCols = [];
  for (let c = 0; c < cols.length - 1; c++) {
    const x0 = cols[c], x1 = cols[c + 1];
    const colWords = insideWords.filter(w => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2;
      return cx >= x0 && cx < x1;
    });
    if (colWords.length < 4) continue;
    const byRow = {};
    colWords.forEach(w => {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      let r = 0; while (r < rows.length - 2 && cy >= rows[r + 1]) r++;
      (byRow[r] = byRow[r] || []).push(w);
    });
    const medH = colWords.reduce((s, w) => s + (w.bbox.y1 - w.bbox.y0), 0) / colWords.length;
    const gapMids = [];
    Object.values(byRow).forEach(rowWords => {
      if (rowWords.length < 2) return;
      rowWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      let bestGap = 0, bestMid = null;
      for (let i = 1; i < rowWords.length; i++) {
        const gap = rowWords[i].bbox.x0 - rowWords[i - 1].bbox.x1;
        if (gap > bestGap) { bestGap = gap; bestMid = (rowWords[i].bbox.x0 + rowWords[i - 1].bbox.x1) / 2; }
      }
      // A gap much wider than the text is tall reads as a missed column
      // boundary rather than normal spacing within one field. 1.8x word
      // height was tuned for prose-style columns; two adjacent right-aligned
      // amount columns (Debit/Credit) or a short ID code next to a text
      // column (Voucher No. / Particulars) routinely sit with a real but
      // narrower gap, so a lower bar (matching the 1.1x used for the same
      // judgment call in daClassifyOcrLines) catches those too without
      // reading normal single-space word gaps as a boundary.
      if (bestGap > medH * 1.1) gapMids.push(bestMid);
    });
    const rowsWithData = Object.keys(byRow).length;
    if (gapMids.length >= Math.max(2, Math.ceil(rowsWithData * 0.5))) {
      splitCols.push(gapMids.reduce((a, b) => a + b, 0) / gapMids.length);
    }
  }
  const allCols = splitCols.length ? cols.concat(splitCols).sort((a, b) => a - b) : cols;

  const nRows = rows.length - 1, nCols = allCols.length - 1;
  const tableRows = Array.from({ length: nRows }, () => new Array(nCols).fill(''));
  insideWords.forEach(w => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    let r = 0; while (r < nRows - 1 && cy >= rows[r + 1]) r++;
    let c = 0; while (c < nCols - 1 && cx >= allCols[c + 1]) c++;
    tableRows[r][c] = tableRows[r][c] ? `${tableRows[r][c]} ${w.text}` : w.text;
  });
  const gridResult = daStripSpreadsheetChrome(tableRows);

  // Cross-check: a ruled grid can be a false positive on a borderless,
  // whitespace-aligned table (faint background/border pixels in a themed UI
  // export can look enough like drawn rule lines to fool the pixel scan),
  // which produces column boundaries that don't correspond to the real text
  // layout at all — arbitrary-looking blank columns and merged cells rather
  // than a single clean miss. Rather than trust the ruled-grid boundaries
  // unconditionally, also build the table the whitespace-projection way
  // (scoped to these same row-banded words) and keep whichever of the two
  // shows fewer signs of a broken column split.
  const { lines: rowLinesForCompare, medH: medHForCompare } = daGroupOcrWordsIntoLines(insideWords);
  const projectionResult = daStripSpreadsheetChrome(daAlignLinesIntoGrid(rowLinesForCompare, medHForCompare));
  const finalResult = daTableQualityScore(projectionResult) < daTableQualityScore(gridResult)
    ? projectionResult
    : gridResult;

  return { tableRows: finalResult, outsideWords };
}

// ─── Main entry for OCR'd content (image upload or a rasterized scanned-PDF
// page): splits the recognized words into a real tabular portion and a
// written-content portion.
//
// Two detectors run, in order of confidence:
// 1) Ruled-grid detection (daDetectTableGridLines) reads the canvas's own
//    pixels for actual drawn border/grid lines — the most reliable signal
//    when a table has them (boxed reports, screenshotted spreadsheets,
//    invoices), since it doesn't depend on word-spacing at all.
// 2) If no ruled grid is found (or it didn't produce real multi-column
//    content), the longest consecutive run of multi-cell lines is picked
//    out by whitespace (daClassifyOcrLines), then only those lines get run
//    through column alignment (daAlignLinesIntoGrid) — scoped just to them,
//    so a table sitting inside a page mostly made of paragraph text still
//    gets clean, well-aligned columns instead of the table's boundaries
//    getting diluted by every unrelated paragraph line on the same page. ───
function daExtractOcrTableAndProse(words, canvas) {
  if (canvas) {
    const grid = daDetectTableGridLines(canvas);
    if (grid) {
      const { tableRows, outsideWords } = daExtractOcrTableViaGrid(words, grid);
      const hasRealTable = tableRows.length >= 2 && tableRows.some(r => r.filter(Boolean).length > 1);
      if (hasRealTable) {
        const { lines: proseOcrLines } = daGroupOcrWordsIntoLines(outsideWords);
        const proseLines = proseOcrLines.map(l => l.words.map(x => x.text).join(' ').trim()).filter(Boolean);
        return { tableRows, proseLines };
      }
    }
  }

  const { lines, medH } = daGroupOcrWordsIntoLines(words);
  if (!lines.length) return { tableRows: [], proseLines: [] };

  const { tableLines, proseLines } = daClassifyOcrLines(lines, medH);
  if (tableLines.length < 2) return { tableRows: [], proseLines };

  const tableRows = daAlignLinesIntoGrid(tableLines, medH);
  return { tableRows: daStripSpreadsheetChrome(tableRows), proseLines };
}

// Legacy per-row gap clustering, kept only as a fallback for tables where
// the whitespace-projection approach above finds no consistent column gaps
// at all (e.g. a skewed photo where no column edge stays empty top-to-bottom).
function daClusterOcrWordsIntoGridLegacy(lines, medH) {
  const gaps = [];
  lines.forEach(l => {
    for (let i = 1; i < l.words.length; i++) {
      gaps.push({ gap: l.words[i].x0 - l.words[i - 1].x1, mid: (l.words[i].x0 + l.words[i - 1].x1) / 2 });
    }
  });
  const threshold = Math.max(medH * 1.4, 10);
  let boundaries = gaps.filter(g => g.gap >= threshold).map(g => g.mid).sort((a, b) => a - b);

  const mergeTolerance = medH * 2.2;
  const clusters = [];
  boundaries.forEach(b => {
    const last = clusters.length ? clusters[clusters.length - 1] : null;
    if (last && b - last[last.length - 1] < mergeTolerance) last.push(b);
    else clusters.push([b]);
  });
  boundaries = clusters.map(c => c.reduce((a, b) => a + b, 0) / c.length);

  const colOf = (x) => { let c = 0; while (c < boundaries.length && x >= boundaries[c]) c++; return c; };
  const width = boundaries.length + 1;
  return lines.map(l => {
    const row = new Array(width).fill('');
    l.words.forEach(w => {
      const c = colOf(w.x0);
      row[c] = row[c] ? `${row[c]} ${w.text}` : w.text;
    });
    return row;
  });
}

// ─── Word (.docx) — real tables are pulled out structurally as before. Any
// surrounding written content (a report's narrative sections, a resume's
// summary, etc.) is no longer discarded: it's walked heading-by-heading and
// handed to the topic arranger below, so a doc with both tables and prose
// comes back as a table dataset AND a topic-arranged "Content" dataset. ───
async function daExtractDocx(arrayBuffer, filename) {
  if (typeof mammoth === 'undefined') throw new Error('Word parser failed to load, check your connection and retry');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));

  if (tables.length) {
    tables.forEach((table, i) => {
      const aoa = daExtractTableGrid(table);
      const label = tables.length > 1 ? `${daBaseName(filename)} — Table ${i + 1}` : `${daBaseName(filename)} — Table`;
      daAddDataset(label, aoa);
    });
    // Pull any written content (headings/paragraphs/list items) that sits
    // outside the tables, and give it its own connected, topic-arranged dataset too.
    const blocks = daCollectProseBlocks(doc.body);
    const wordCount = blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
    if (wordCount > 25) {
      const aoa2 = daArrangeBlocksIntoTopics(blocks);
      daAddDataset(`${daBaseName(filename)}${DA_PROSE_SUFFIX}`, aoa2);
    }
    return { tableFound: true };
  } else {
    // No tables in the doc: this is a full written document. Walk its
    // headings and paragraphs and arrange them topic-by-topic instead of
    // dumping one raw line per row. Flag this back to the caller so the
    // person is told plainly that no table was detected, rather than
    // silently handing back prose and letting them assume detection ran
    // and simply found nothing to report.
    const blocks = daCollectProseBlocks(doc.body);
    if (blocks.length) {
      const aoa = daArrangeBlocksIntoTopics(blocks);
      daAddDataset(daBaseName(filename), aoa);
    } else {
      const bodyText = doc.body.textContent || '';
      const aoa = daSmartTextToAOA(bodyText, null);
      daAddDataset(daBaseName(filename), aoa);
    }
    return { tableFound: false };
  }
}

// Walks a mammoth-rendered Word body, skipping <table> subtrees (handled
// separately), and returns an ordered list of { heading, text } blocks —
// headings (Word's built-in Heading 1/2/3… styles become h1-h6) are flagged
// so the topic arranger can use real document structure instead of
// guessing at it from scratch.
function daCollectProseBlocks(root) {
  const blocks = [];
  const HEADING_RE = /^H[1-6]$/;
  (function walk(node) {
    Array.from(node.children || []).forEach(child => {
      const tag = child.tagName;
      if (tag === 'TABLE') return;
      if (HEADING_RE.test(tag)) {
        const text = child.textContent.replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ heading: true, text });
      } else if (tag === 'P' || tag === 'LI') {
        const text = child.textContent.replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ heading: false, text });
      } else {
        walk(child);
      }
    });
  })(root);
  return blocks;
}

// ─── PDF, reconstructs table structure from text positions on the page.
// Groups text items into visual rows by Y position, then splits each row
// into columns wherever the horizontal gap between words is unusually wide
// (i.e. wider than normal word-spacing), which is how columns line up in a
// PDF with no explicit table markup. Each row is then classified on its own
// (multiple columns = table row, a single run of text = prose line), so a
// PDF that mixes a data table with narrative text — a report, an invoice
// with terms underneath, a spec sheet with notes — comes back as two
// connected datasets: one for the table, one ("Content found on the page")
// for the written parts, rather than forcing the whole document one way. ───
// ─── Splits the page-ordered sequence of table/prose rows pulled from a PDF
// into separate table blocks. One PDF can legitimately hold several
// unrelated tables — a "Q1 Sales" table, a "Headcount by Department" table,
// an "Expenses" table, all in the same file — so instead of gluing every
// lined-up row in the whole document into one giant dataset, this looks for
// the same breaks a person would use to tell where one table ends and the
// next begins:
//   • a heading-style line of prose sitting between two runs of table rows
//     (used as the next table's title, when one is found)
//   • a run of two or more ordinary prose lines separating table rows
//   • a change in column count between one run of table rows and the next,
//     once the current run already has a header + a data row (a different
//     shape almost always means a different table, not a ragged row)
// A run of table rows that doesn't hit any of these breaks — e.g. a table
// that simply continues onto the next page — stays together as one table. ───
function daSegmentPdfSequenceIntoTables(seq) {
  const tables = [];   // { title: string|null, rows: string[][], colMode }
  const proseLines = [];
  let current = null;
  let pendingHeading = null;
  let proseRunLen = 0;

  function modeColCount(rows) {
    const counts = {};
    rows.forEach(r => { counts[r.length] = (counts[r.length] || 0) + 1; });
    let best = null, bestN = 0;
    Object.keys(counts).forEach(k => { if (counts[k] > bestN) { bestN = counts[k]; best = +k; } });
    return best;
  }

  function closeCurrent() {
    if (current && current.rows.length) tables.push(current);
    current = null;
  }

  seq.forEach(entry => {
    if (entry.type === 'break') {
      // A page break alone isn't a table break — a table can legitimately
      // run onto the next page — but reset the prose-run counter so a
      // near-empty page doesn't get miscounted as a paragraph separator.
      proseRunLen = 0;
      return;
    }
    if (entry.type === 'prose') {
      proseLines.push(entry.text);
      if (daLooksLikeHeading(entry.text)) { pendingHeading = entry.text; proseRunLen = 0; }
      else proseRunLen++;
      return;
    }
    // entry.type === 'table'
    const cells = entry.cells;
    const startsNewTable = !current || pendingHeading || proseRunLen >= 2 ||
      (current.colMode && cells.length !== current.colMode && current.rows.length >= 2);

    if (startsNewTable) {
      closeCurrent();
      current = { title: pendingHeading ? daCleanHeadingText(pendingHeading) : null, rows: [], colMode: null };
    }
    current.rows.push(cells);
    current.colMode = modeColCount(current.rows);
    pendingHeading = null;
    proseRunLen = 0;
  });
  closeCurrent();

  // A lone 1-row "table" is usually just a label/value line that happened
  // to line up into 2+ columns, not a real table — fold it back into prose
  // instead of showing it as a near-empty tab.
  const realTables = [];
  tables.forEach(t => {
    if (t.rows.length >= 2) realTables.push(t);
    else t.rows.forEach(r => proseLines.push(r.join('  ')));
  });

  return { tables: realTables, proseLines };
}

async function daExtractPdf(arrayBuffer, filename) {
  const doc = await sarvarcOpenPdfDocument(arrayBuffer);
  // Ordered sequence of every row on every page, tagged as a table row, a
  // prose line, or a page break — segmented into separate tables below
  // instead of flattening straight into one array like before.
  const seq = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    if (!content.items.length) { seq.push({ type: 'break' }); continue; }

    // Group items into rows by Y coordinate (allowing small jitter)
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: Math.round(it.transform[5]),
      w: it.width
    })).filter(it => it.str.trim() !== '');
    if (!items.length) { seq.push({ type: 'break' }); continue; }

    const rowsMap = [];
    items.forEach(it => {
      let row = rowsMap.find(r => Math.abs(r.y - it.y) <= 3);
      if (!row) { row = { y: it.y, items: [] }; rowsMap.push(row); }
      row.items.push(it);
    });
    rowsMap.sort((a, b) => b.y - a.y); // top to bottom

    // Column-gap threshold: how wide a horizontal gap has to be before it's
    // treated as a break between columns rather than a normal word-space.
    // This used to be recomputed PER ROW from that row's own average
    // character width — but header rows are almost always bold/larger than
    // the data rows under them, so their characters are wider, which
    // inflated the threshold for that row alone. The result: the normal-size
    // gaps between separate header labels ("Profit 2025 ($)", "Profit 2026
    // ($)", "Growth %", "Employees") fell under that row's own oversized bar
    // and got glued into a single cell, while the plainer data rows below
    // got a correctly-scaled threshold and split cleanly — headers merged,
    // data fine. Computing one threshold from the whole page's text (data
    // rows included, which are usually the majority) keeps every row on the
    // same yardstick.
    const pageCharWidths = items.map(it => it.w / Math.max(it.str.length, 1)).filter(w => w > 0);
    const pageMedianCharW = pageCharWidths.length ? pageCharWidths.slice().sort((a, b) => a - b)[Math.floor(pageCharWidths.length / 2)] : 5;
    const pageGapThreshold = Math.max(pageMedianCharW * 2.2, 8);

    // Per-row gap chaining alone can't represent a column that's genuinely
    // empty on THAT row (a blank Cheque/Ref No. on a UPI auto-debit, a blank
    // Debit on a credit line, a blank Credit on a debit line — all completely
    // normal on a bank statement). With no text there at all, no gap "event"
    // fires for that column, so the row ends up one cell short and every
    // later value on it silently slides one column to the left — Cheque/Ref
    // bleeding into Debit, Debit into Credit, Credit's amount getting glued
    // onto the running Balance. Used alone for building cells this is a bug;
    // it's still useful as a first pass purely to tell table-shaped rows
    // (2+ cells) apart from prose (a single run of text), which is all it's
    // used for below.
    function rawSplitRow(row) {
      row.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let current = '';
      let lastEnd = null;
      row.items.forEach(it => {
        if (lastEnd !== null && (it.x - lastEnd) > pageGapThreshold) {
          cells.push(current.trim());
          current = it.str;
        } else {
          current += (current ? ' ' : '') + it.str;
        }
        lastEnd = it.x + it.w;
      });
      if (current.trim() !== '') cells.push(current.trim());
      return cells;
    }

    const rawRows = rowsMap.map(row => ({ row, rawCells: rawSplitRow(row) }));

    // Real column positions, derived once from every table-shaped row on the
    // page (the same whitespace-projection fix already used for OCR tables
    // in daAlignLinesIntoGrid): a bucket counts as a column gap once hardly
    // any table row has a character sitting on it, so a genuinely blank cell
    // on one row doesn't erase that column — the boundary still holds
    // because every OTHER row's text keeps it visible.
    const tableRowEntries = rawRows.filter(r => r.rawCells.length > 1);
    let columnBoundaries = [];
    if (tableRowEntries.length) {
      const tableItems = tableRowEntries.flatMap(r => r.row.items);
      const bucketW = Math.max(1, pageMedianCharW * 0.6);
      const gridMinX = Math.min(...tableItems.map(it => it.x));
      const gridMaxX = Math.max(...tableItems.map(it => it.x + it.w));
      const nBuckets = Math.max(1, Math.ceil((gridMaxX - gridMinX) / bucketW));
      const coverCount = new Array(nBuckets).fill(0);
      tableRowEntries.forEach(({ row }) => {
        row.items.forEach(it => {
          const b0 = Math.max(0, Math.floor((it.x - gridMinX) / bucketW));
          const b1 = Math.min(nBuckets - 1, Math.floor((it.x + it.w - gridMinX) / bucketW));
          for (let b = b0; b <= b1; b++) coverCount[b]++;
        });
      });
      const gapRowThreshold = Math.max(1, tableRowEntries.length * 0.15);
      const minGapWidthPx = Math.max(pageGapThreshold, bucketW * 2);
      const isGapBucket = coverCount.map(c => c < gapRowThreshold);
      let runStart = null;
      for (let b = 0; b <= nBuckets; b++) {
        const gapHere = b < nBuckets && isGapBucket[b];
        if (gapHere && runStart === null) runStart = b;
        if (!gapHere && runStart !== null) {
          const runWidthPx = (b - runStart) * bucketW;
          if (runWidthPx >= minGapWidthPx) columnBoundaries.push(gridMinX + ((runStart + b) / 2) * bucketW);
          runStart = null;
        }
      }
    }
    const colOf = (x) => { let c = 0; while (c < columnBoundaries.length && x >= columnBoundaries[c]) c++; return c; };

    const pageRows = rawRows.map(({ row, rawCells }) => {
      // Prose row, or no clean page-wide columns were ever found (a plain
      // paragraph with no real table on the page) — nothing to realign.
      if (rawCells.length <= 1 || !columnBoundaries.length) return rawCells;

      const width = columnBoundaries.length + 1;
      const cells = new Array(width).fill('');
      row.items.forEach(it => {
        // Bucket by the item's horizontal CENTER, not its left edge, so a
        // value whose box straddles a boundary by a px or two still lands
        // in the column it visually belongs to.
        const c = colOf(it.x + it.w / 2);
        cells[c] = cells[c] ? `${cells[c]} ${it.str}` : it.str;
      });
      return cells.map(c => c.trim());
    });

    // Classify each row in document order: 2+ columns lined up = part of a
    // table, a single run of text = a line of prose (possibly a table's
    // title). Keeping them in one ordered sequence — instead of two
    // separate flat arrays — is what lets the segmenter below tell where
    // one table ends and the next begins.
    pageRows.forEach(cells => {
      if (cells.length > 1) seq.push({ type: 'table', cells });
      else if (cells.length === 1 && cells[0]) seq.push({ type: 'prose', text: cells[0] });
    });
    seq.push({ type: 'break' });
  }

  const { tables, proseLines } = daSegmentPdfSequenceIntoTables(seq);

  const hasTable = tables.length > 0;
  const proseText = proseLines.join('\n');
  const blocks = daLinesToBlocksFromText(proseText);
  const proseWordCount = blocks.filter(b => !b.heading).reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const hasProse = proseWordCount > 5;

  if (hasTable) {
    // Several distinct tables in one PDF (different topics, different
    // shapes) become several separate datasets/tabs, each named from its
    // own heading when one was found just above it in the document, rather
    // than one dataset with every table's rows run together.
    const multi = tables.length > 1;
    tables.forEach((t, i) => {
      const name = multi
        ? (t.title || `${daBaseName(filename)} — Table ${i + 1}`)
        : (hasProse ? `${daBaseName(filename)}${DA_TABLE_SUFFIX}` : daBaseName(filename));
      daAddDataset(name, t.rows);
    });
  }
  if (hasProse) {
    const aoa = daArrangeBlocksIntoTopics(blocks);
    daAddDataset(hasTable ? `${daBaseName(filename)}${DA_PROSE_SUFFIX}` : daBaseName(filename), aoa);
  }
  if (!hasTable && !hasProse) {
    // No embedded text layer at all — this PDF is (or contains) scanned
    // page images rather than real text, the pdf.js text-content pass above
    // comes back empty. Rather than give up, fall back to rasterizing each
    // page and running it through the same OCR pipeline used for photo/
    // screenshot uploads (daExtractImageTable), so a scanned PDF is handled
    // the same way a photo of the same pages would be.
    return await daExtractScannedPdfViaOcr(doc, filename);
  }
  // hasTable=false here means real prose was found but nothing in it looked
  // like tabular columns, tell the caller plainly instead of just quietly
  // handing back paragraph text with no table.
  return { tableFound: hasTable };
}

// ─── Fallback for a PDF with no text layer (a scan saved as a PDF).
// Renders every page to a canvas and reuses the exact same OCR → line
// classification → table/prose split pipeline as an image upload
// (daExtractOcrTableAndProse), then merges the results across all pages
// before deciding whether this came back as a table, written content, or
// both. ───
async function daExtractScannedPdfViaOcr(doc, filename) {
  const ocrTableRows = [];
  const ocrProseLines = [];

  for (let p = 1; p <= doc.numPages; p++) {
    daSetProgress(true, `Scanning page ${p} of ${doc.numPages} (OCR)…`);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = viewport.width;
    pageCanvas.height = viewport.height;
    await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;

    _teOcrProgressCb = (frac, label) => daSetProgress(true, `Page ${p} of ${doc.numPages}: ${label || 'reading (OCR)…'}`);
    try {
      const { canvas: ocrCanvas } = pdfedPreprocessForOcr(pageCanvas);
      const worker = await pdfedGetOcrWorker();
      const { data } = await worker.recognize(ocrCanvas);
      const words = (data.words || []).filter(w => w.text && w.text.trim() && w.confidence >= 35);
      if (!words.length) continue;
      const { tableRows, proseLines } = daExtractOcrTableAndProse(words, ocrCanvas);
      tableRows.forEach(r => ocrTableRows.push(r));
      proseLines.forEach(l => ocrProseLines.push(l));
      ocrProseLines.push(''); // page break, keeps paragraph grouping from bleeding across pages
    } finally {
      _teOcrProgressCb = null;
    }
  }

  const ocrBlocks = daLinesToBlocksFromText(ocrProseLines.join('\n'));
  const ocrProseWordCount = ocrBlocks.filter(b => !b.heading).reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const ocrHasTable = ocrTableRows.length >= 2;
  const ocrHasProse = ocrProseWordCount > 12;

  if (!ocrHasTable && !ocrHasProse) {
    throw new Error('no readable text found in this scanned PDF, even with OCR');
  }
  if (ocrHasTable) {
    daAddDataset(ocrHasProse ? `${daBaseName(filename)}${DA_TABLE_SUFFIX}` : daBaseName(filename), ocrTableRows);
  }
  if (ocrHasProse) {
    const aoa = daArrangeBlocksIntoTopics(ocrBlocks);
    daAddDataset(ocrHasTable ? `${daBaseName(filename)}${DA_PROSE_SUFFIX}` : daBaseName(filename), aoa);
  }
  toast(`"${daBaseName(filename)}" looked like a scanned PDF (no text layer), content extracted via OCR (beta) — please double-check against the original before relying on it.`, 'info');
  return { tableFound: ocrHasTable };
}

// ─── Entry point for plain .txt/.csv/.tsv uploads. Tries the whole-file
// strategies first (a clean table, or a set of key/value records); if
// neither holds for the file as a whole, checks whether PART of the file is
// a real table and part is written content (e.g. a CSV with a paragraph of
// notes tacked on, a TXT export with a table and a summary underneath) and,
// if so, keeps them as two connected datasets — one for the table, one
// ("Content found on the page") for the writing — instead of forcing the
// whole file into one shape. ───
function daIngestTextContent(text, forcedDelim, filename) {
  const delim = forcedDelim || daSniffDelimiter(text);
  const lines = text.split(/\r\n|\n/).filter(l => l.trim().length);

  const cleanTable = daTryDelimiterTable(text, lines, delim);
  if (cleanTable) { daAddDataset(daBaseName(filename), cleanTable); return { tableFound: true }; }

  const kvTable = daTryKeyValueTable(lines);
  if (kvTable) { daAddDataset(daBaseName(filename), kvTable); return { tableFound: true }; }

  const split = daSplitTabularAndProseLines(lines);
  let hasTable = false, tableAoa = null, blocks;

  if (split) {
    const wb = XLSX.read(split.tableLines.join('\n'), { type: 'string', FS: split.delim, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    tableAoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
    hasTable = true;
    blocks = daLinesToBlocksFromText(split.proseLines.join('\n'));
  } else {
    blocks = daLinesToBlocksFromText(text);
  }

  const proseWordCount = blocks.filter(b => !b.heading).reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const hasProse = proseWordCount > 0;

  if (hasTable) daAddDataset(hasProse ? `${daBaseName(filename)} — Table` : daBaseName(filename), tableAoa);
  if (hasProse) daAddDataset(hasTable ? `${daBaseName(filename)} — Content found on the page` : daBaseName(filename), daArrangeBlocksIntoTopics(blocks));
  if (!hasTable && !hasProse) daAddDataset(daBaseName(filename), [['Content']]);

  // No delimiter/key-value/mixed table shape matched anywhere in the file:
  // report that back plainly rather than silently settling for plain text.
  return { tableFound: hasTable };
}

// A real table's cells are short (numbers, names, short strings). Prose
// sentences that happen to contain the same delimiter (usually a comma)
// split into cells that are themselves multi-word fragments. Comparing
// average words-per-cell catches that case before it's mistaken for data.
function daCellsLookTabular(lines, delim) {
  const sample = lines.slice(0, 12);
  let totalWords = 0, totalCells = 0;
  sample.forEach(l => {
    daCsvSplitLine(l, delim).forEach(cell => {
      totalCells++;
      totalWords += cell.trim().split(/\s+/).filter(Boolean).length;
    });
  });
  return totalCells > 0 && (totalWords / totalCells) <= 4;
}

// Strategy 1: does a delimiter show up a consistent number of times across
// (almost) every line? If so the whole file is one clean table.
function daTryDelimiterTable(text, lines, delim) {
  if (lines.length <= 1) return null;
  const counts = lines.map(l => daCsvFieldCount(l, delim));
  const consistentLines = counts.filter(c => c === counts[0] && c > 0).length;
  if (counts[0] > 0 && consistentLines / lines.length > 0.7 && daCellsLookTabular(lines, delim)) {
    const wb = XLSX.read(text, { type: 'string', FS: delim, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
  }
  return null;
}

// Strategy 2: repeating "Key: Value" blocks (forms/reports/resumes), one
// record per block, starting a new record whenever a key already seen in
// the current record shows up again.
function daTryKeyValueTable(lines) {
  const kvLine = /^\s*([A-Za-z][A-Za-z0-9 _\-\/]{1,40}?)\s*[:|]\s+(.+)$/;
  const kvMatches = lines.map(l => l.match(kvLine));
  const kvHitRate = lines.length ? kvMatches.filter(Boolean).length / lines.length : 0;
  if (kvHitRate <= 0.5) return null;

  const records = [];
  let current = null;
  let seenKeys = new Set();
  lines.forEach((line, i) => {
    const m = kvMatches[i];
    if (!m) return;
    const key = m[1].trim();
    const val = m[2].trim();
    if (!current || seenKeys.has(key)) {
      if (current) records.push(current);
      current = {};
      seenKeys = new Set();
    }
    current[key] = val;
    seenKeys.add(key);
  });
  if (current) records.push(current);
  return records.length ? daJsonToAOA(records) : null;
}

// Classifies each line as "tabular" (matches the file's most common
// delimiter-split column count) or "prose" (doesn't), and only reports a
// split if there's a real table's worth of tabular lines left over. Used
// when the file as a whole doesn't cleanly qualify as one table.
function daSplitTabularAndProseLines(lines) {
  if (lines.length < 5) return null;
  const delim = daSniffDelimiter(lines.join('\n'));
  const counts = lines.map(l => daCsvFieldCount(l, delim));
  const freq = {};
  counts.forEach(c => { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
  const modeEntry = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  if (!modeEntry) return null;
  const mode = parseInt(modeEntry[0], 10);
  const tableLines = [], proseLines = [];
  lines.forEach((l, i) => { (counts[i] === mode ? tableLines : proseLines).push(l); });
  if (tableLines.length < 3 || !daCellsLookTabular(tableLines, delim)) return null;
  return { tableLines, proseLines, delim };
}

// ─── Smart plain-text → table parser. Used as a fallback for Word documents
// with no headings or paragraphs mammoth could identify (a rare edge case —
// normally daCollectProseBlocks + daArrangeBlocksIntoTopics handles Word
// content directly). Tries the same whole-file strategies as above, then
// falls back to topic arrangement for anything left over. ───
function daSmartTextToAOA(text, forcedDelim) {
  const delim = forcedDelim || daSniffDelimiter(text);
  const lines = text.split(/\r\n|\n/).filter(l => l.trim().length);

  const cleanTable = daTryDelimiterTable(text, lines, delim);
  if (cleanTable) return cleanTable;

  const kvTable = daTryKeyValueTable(lines);
  if (kvTable) return kvTable;

  // Strategy 3: this is full written content, not a table and not a set of
  // repeating key/value records. Rather than dumping one raw line per row
  // (which read as a messy word-salad column), detect any heading structure
  // in the plain text (markdown #'s, numbered sections, ALL-CAPS / short
  // Title-Case lines) and arrange the content underneath those headings. If

  // the text has no heading structure at all, fall back to clustering
  // paragraphs by shared keywords so scattered mentions of the same topic
  // land together, instead of staying in one flat, unsorted list.
  const blocks = daLinesToBlocksFromText(text);
  return daArrangeBlocksIntoTopics(blocks);
}

// ─── Topic arrangement for full written content ───
// Turns an ordered list of { heading, text } blocks into a ['Topic','Content']
// AOA. If real headings are present, content is grouped under them (and
// same-named headings that recur later in the document are merged, so a
// topic mentioned in two different places still ends up in one place here).
// If there's no heading structure at all, paragraphs are clustered by shared
// keywords instead, so the "topic wise" ordering still holds for plain
// unstructured prose.
function daArrangeBlocksIntoTopics(blocks) {
  const hasHeadings = blocks.some(b => b.heading);
  if (hasHeadings) return daGroupBlocksByHeading(blocks);
  const paras = blocks.map(b => b.text).filter(Boolean);
  return daClusterParagraphsIntoAOA(paras);
}

function daGroupBlocksByHeading(blocks) {
  const sections = [];
  const indexByTopic = new Map();
  let current = null;

  function sectionFor(topic, key) {
    if (indexByTopic.has(key)) return sections[indexByTopic.get(key)];
    const s = { topic, paras: [] };
    indexByTopic.set(key, sections.length);
    sections.push(s);
    return s;
  }

  blocks.forEach(b => {
    if (b.heading) {
      current = sectionFor(b.text, b.text.toLowerCase());
    } else {
      if (!current) current = sectionFor('Introduction', '__intro__');
      current.paras.push(b.text);
    }
  });

  const aoa = [['Topic', 'Content']];
  sections.forEach(s => {
    if (!s.paras.length) return; // a heading with nothing under it adds no rows
    s.paras.forEach(p => aoa.push([s.topic, p]));
  });
  return aoa.length > 1 ? aoa : [['Topic', 'Content']];
}

// Common English function words filtered out before keyword extraction, so
// cluster labels surface actual subject matter rather than "with", "this", etc.
const DA_STOPWORDS = new Set(['the','a','an','and','or','but','if','then','else','when','at','by','for','with',
  'about','against','between','into','through','during','before','after','above','below','to','from','up','down',
  'in','out','on','off','over','under','again','further','once','here','there','all','any','both','each','few',
  'more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','can','will',
  'just','should','now','is','are','was','were','be','been','being','have','has','had','having','do','does','did',
  'doing','of','as','it','its','this','that','these','those','i','you','he','she','we','they','them','his','her',
  'their','our','your','my','me','him','which','who','whom','what','also','however','thus','therefore','hence',
  'among','within','without','across','per','via','using','used','use','one','two','also','into','onto']);

function daTokenizeSignificant(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []).filter(w => !DA_STOPWORDS.has(w));
}

// Overlap coefficient (shared keywords / size of the smaller keyword set)
// rather than plain Jaccard: short paragraphs naturally share fewer words
// in absolute terms, and Jaccard's union-based denominator under-scores
// them even when they're clearly on the same topic. Overlap coefficient
// stays fair regardless of paragraph length.
function daJaccard(freqA, freqB) {
  const keysA = Object.keys(freqA), keysB = Object.keys(freqB);
  if (!keysA.length || !keysB.length) return 0;
  const setB = new Set(keysB);
  let inter = 0;
  keysA.forEach(k => { if (setB.has(k)) inter++; });
  return inter / Math.min(keysA.length, keysB.length);
}

function daLabelFromFreq(freq) {
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
  return top.length ? top.join(' / ') : 'General';
}

// Greedily clusters paragraphs by keyword overlap (Jaccard similarity of
// their significant-word frequency tables), then emits one row per
// paragraph, grouped by cluster, labelled with that cluster's top keywords.
function daClusterParagraphsIntoAOA(paras) {
  if (!paras.length) return [['Topic', 'Content']];

  const freqs = paras.map(p => {
    const freq = {};
    daTokenizeSignificant(p).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return freq;
  });

  const clusters = []; // { freq: {...}, indices: [...] }
  const SIM_THRESHOLD = 0.25;
  freqs.forEach((freq, i) => {
    let bestIdx = -1, bestScore = 0;
    clusters.forEach((c, ci) => {
      const score = daJaccard(freq, c.freq);
      if (score > bestScore) { bestScore = score; bestIdx = ci; }
    });
    if (bestIdx !== -1 && bestScore >= SIM_THRESHOLD) {
      const c = clusters[bestIdx];
      c.indices.push(i);
      Object.entries(freq).forEach(([k, v]) => { c.freq[k] = (c.freq[k] || 0) + v; });
    } else {
      clusters.push({ freq: { ...freq }, indices: [i] });
    }
  });

  const aoa = [['Topic', 'Content']];
  clusters.forEach(c => {
    const label = daLabelFromFreq(c.freq);
    c.indices.forEach(i => aoa.push([label, paras[i]]));
  });
  return aoa;
}

// Splits raw multi-line text into { heading, text } blocks, used for plain
// .txt uploads and for PDFs whose pages didn't line up into columns.
// If the text has blank-line paragraph breaks, consecutive non-blank lines
// are merged into a single paragraph (how wrapped prose is stored in a
// .txt/.pdf dump). If there are no blank lines at all, each line is kept as
// its own block instead, so a plain list of short lines (tasks, names, etc.)
// isn't glued into one giant paragraph.
function daLinesToBlocksFromText(text) {
  const rawLines = text.split(/\r\n|\n/);
  const hasBlankSeparators = /\n[ \t]*\n/.test(text.replace(/\r\n/g, '\n'));
  const blocks = [];

  if (hasBlankSeparators) {
    let paraBuf = [];
    const flush = () => {
      if (paraBuf.length) {
        blocks.push({ heading: false, text: paraBuf.join(' ').replace(/\s+/g, ' ').trim() });
        paraBuf = [];
      }
    };
    rawLines.forEach(raw => {
      const line = raw.trim();
      if (!line) { flush(); return; }
      if (daLooksLikeHeading(line)) { flush(); blocks.push({ heading: true, text: daCleanHeadingText(line) }); }
      else paraBuf.push(line);
    });
    flush();
  } else {
    rawLines.forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      if (daLooksLikeHeading(line)) blocks.push({ heading: true, text: daCleanHeadingText(line) });
      else blocks.push({ heading: false, text: line });
    });
  }

  return blocks.filter(b => b.text);
}

// Heuristic heading detector for plain text with no real markup: markdown
// #'s, "Chapter/Section/Part …", numbered headings ("1. Introduction"), or
// a short Title-Case/ALL-CAPS line with no trailing sentence punctuation.
function daLooksLikeHeading(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/^(chapter|section|part|appendix)\s+\S/i.test(t) && t.length < 70) return true;
  if (/^\d+(\.\d+)*[\.\)]\s+\S/.test(t) && t.length < 70 && !/[.!?]$/.test(t)) return true;
  if (/[.!?,;:]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 8 || words.length === 0) return false;
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  const capsRatio = words.filter(w => /^[A-Z]/.test(w)).length / words.length;
  return capsRatio >= 0.6;
}

function daCleanHeadingText(line) {
  return line.replace(/^#{1,6}\s+/, '').replace(/^\d+(\.\d+)*[\.\)]\s+/, '').replace(/^(chapter|section|part|appendix)\s+/i, '').trim() || line.trim();
}

function daBaseName(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

// Guess the delimiter of a raw text file by counting candidate separators
// across the first several non-empty lines and picking the most consistent one.
// Quote-aware CSV field count/split. A plain `line.split(delim).length` breaks
// the moment a field is quoted and contains the delimiter inside it — e.g. a
// Titanic-style "Heikkinen, Miss. Laina" name field inside a comma-delimited
// file reads as 2 columns instead of 1, which throws off every downstream
// "is this a consistent table?" check (delimiter sniffing, row-consistency,
// tabular-vs-prose classification). This walks the line character by
// character so a delimiter inside a quoted span is never counted as a split.
function daCsvSplitLine(line, delim) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function daCsvFieldCount(line, delim) { return daCsvSplitLine(line, delim).length - 1; }

function daSniffDelimiter(text) {
  const candidates = [',', '\t', ';', '|'];
  const lines = text.split(/\r\n|\n/).filter(l => l.trim().length).slice(0, 8);
  if (!lines.length) return ',';
  let best = ',', bestScore = -1;
  candidates.forEach(delim => {
    const counts = lines.map(l => daCsvFieldCount(l, delim));
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const consistent = counts.every(c => c === counts[0]) && counts[0] > 0;
    const score = avg + (consistent ? 5 : 0);
    if (avg > 0 && score > bestScore) { bestScore = score; best = delim; }
  });
  return best;
}

// Flatten arbitrary JSON (array of objects, object of arrays, or nested objects)
// into an array-of-arrays (AOA) shape, same as sheet_to_json({header:1}) output.
function daJsonToAOA(parsed) {
  let records = [];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === 'object') {
    // object-of-arrays (columnar) -> transpose into records
    const keys = Object.keys(parsed);
    const looksColumnar = keys.length && keys.every(k => Array.isArray(parsed[k]));
    if (looksColumnar) {
      const len = Math.max(...keys.map(k => parsed[k].length));
      records = Array.from({ length: len }, (_, i) => {
        const row = {};
        keys.forEach(k => { row[k] = parsed[k][i]; });
        return row;
      });
    } else {
      records = [parsed]; // single object -> one row
    }
  }
  if (!records.length) return [[]];

  const flat = records.map(r => daFlattenObject(r && typeof r === 'object' ? r : { value: r }));
  const headerSet = [];
  flat.forEach(r => Object.keys(r).forEach(k => { if (!headerSet.includes(k)) headerSet.push(k); }));
  const aoa = [headerSet];
  flat.forEach(r => aoa.push(headerSet.map(h => (r[h] === undefined || r[h] === null) ? '' : r[h])));
  return aoa;
}

function daFlattenObject(obj, prefix = '', out = {}) {
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      daFlattenObject(val, path, out);
    } else if (Array.isArray(val)) {
      out[path] = val.map(v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v).join(', ');
    } else {
      out[path] = val;
    }
  });
  return out;
}

// ─── Smart header detection + normalization ───
// Takes a raw array-of-arrays (as returned by SheetJS) and decides whether the
// first row is a header, generates clean unique header names, and pads every
// row to the same width so the grid never overlaps or goes ragged.
// A cell "looks numeric" once currency symbols, thousand-separator commas,
// percent signs, and accounting-style parens are stripped — plain
// isNaN(parseFloat(c)) misses "$1,234", "91%", "(1,234)" entirely and was
// mis-scoring header-vs-data rows on exactly that kind of business data.
function daCellLooksNumeric(c) {
  const s = String(c).trim();
  if (s === '') return false;
  const cleaned = daCleanNum(s);
  return !isNaN(parseFloat(cleaned)) && isFinite(cleaned);
}

// ── Smart column-type realignment ─────────────────────────────────────────
// OCR text, space-aligned paste, and misparsed delimiters routinely shift a
// row's cells by one column — a two-word name that splits into two cells
// pushes everything after it one slot to the right, for that row only. The
// symptom is exactly what shows up after a messy paste: an email sitting
// under "Age", an amount sitting under "Dept", a date column holding
// "N/A" while the actual date drifted into the next cell.
//
// Rather than trust raw column position, this looks at what TYPE of value
// each header expects (guessed from its label — "Email", "Date", "Amount",
// "Age" are unambiguous) and what type each cell in that row actually looks
// like (an email has an @, a date matches known date shapes, an amount is
// currency-like or N/A, tolerant of common OCR letter/digit swaps like O↔0
// and l/I↔1). Cells are then reassigned to the header whose expected type
// they match, even if that means pulling a value from a different column
// in the same row. Free-text columns (name, department, and anything else
// with no reliable content signature) are left in left-to-right order in
// whatever slots remain — there's no generic way to tell "a name" from
// "a department" by content alone, so those are never guessed at, only
// the unambiguous typed columns are actively corrected.
const DA_OCR_DIGIT_LENIENT = v => v.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');

// Each finder either returns null (no match anywhere in the cell) or
// { match, remainder } — remainder is whatever text was left over after
// pulling the matched piece out, fed back into the pool of unclaimed cells
// so it isn't silently dropped (e.g. a cell that merged a date with a
// trailing "N/A" amount splits into both pieces instead of losing one).
function daFindEmail(v) {
  const m = /[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+(\.[a-zA-Z]{2,})?/.exec(v);
  if (!m) return null;
  return { match: m[0].trim(), remainder: (v.slice(0, m.index) + ' ' + v.slice(m.index + m[0].length)).trim() };
}
function daFindDate(v) {
  const lenient = DA_OCR_DIGIT_LENIENT(v);
  // Purely-numeric date shapes ("2023-01-15", "01/16/2023") benefit from the
  // OCR digit-lenient swap (O↔0, l/I↔1), so those patterns match against
  // `lenient`. Patterns that spell out a month NAME must match against the
  // ORIGINAL string instead — running the digit-lenient swap first mangles
  // real month names that happen to contain an 'l'/'I' or 'o'/'O'
  // ("July"→"Ju1y", "November"→"N0vember", "October"→"0ct0ber"), which then
  // silently fail to match and make daFindDate report no date at all for a
  // perfectly valid cell.
  const patterns = [
    { re: /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/, source: lenient },
    { re: /\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/, source: lenient },
    // "15-Jan-2023", "15 Jan 2023", "1st Jan 2025", "21st-Mar-2024"
    { re: /\d{1,2}(st|nd|rd|th)?[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s]\d{2,4}/i, source: v },
    // "Jan 19 2023", "Jan 19, 2023", "January 1st, 2025"
    { re: /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s\d{1,2}(st|nd|rd|th)?,?\s\d{2,4}/i, source: v },
  ];
  for (const { re, source } of patterns) {
    const m = re.exec(source);
    if (m) {
      // Pull the equivalent slice from the ORIGINAL string (same offsets —
      // `lenient` is character-for-character the same length as `v`, and the
      // month-name patterns already run against `v` directly) so the
      // returned value keeps its original characters rather than the
      // digit-swapped stand-in used only for matching.
      const match = v.slice(m.index, m.index + m[0].length);
      const remainder = (v.slice(0, m.index) + ' ' + v.slice(m.index + m[0].length)).trim();
      return { match, remainder };
    }
  }
  return null;
}
function daFindAmount(v) {
  const t = v.trim();
  if (/^(n\/a|na|\[blank\]|-|—|--)$/i.test(t)) return { match: t, remainder: '' };
  // Recognize ₹ (Rupee) alongside $ — an Indian-formatted amount like
  // "₹18,50,000" matched NEITHER branch here before, so this column always
  // failed to claim its own cell and went hunting elsewhere in the row
  // instead, typically grabbing the leading digits off a percentage cell
  // (e.g. "14.2" out of "14.2%") because that also satisfies the bare
  // decimal-amount pattern below. The `(?!\s*%)` guard on that pattern
  // closes that specific hole even in a row this fix doesn't otherwise
  // reach (a header whose name doesn't happen to hint "percent").
  const m = /\p{Sc}\s?\d[\d,.\s]*|\d[\d,]*\.\d+(?!\s*%)/u.exec(t);
  if (m) {
    const match = m[0].trim();
    const remainder = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).trim();
    return { match, remainder };
  }
  const na = /\bN\/A\b/i.exec(t);
  if (na) {
    const remainder = (t.slice(0, na.index) + ' ' + t.slice(na.index + na[0].length)).trim();
    return { match: na[0], remainder };
  }
  // Fallback: a bare, unformatted integer with no currency symbol or comma
  // at all (e.g. "71000"). Ambiguous with ID/Age on its own, which is
  // exactly why this only fires as a last resort — Amount is always
  // resolved after ID/Age in header order, so by the time this runs those
  // columns have already claimed whatever numbers were actually theirs.
  // A trailing '%' rules this out too — that's a rate, never an amount.
  if (/^-?\d+(\.\d+)?$/.test(DA_OCR_DIGIT_LENIENT(t)) && !/%\s*$/.test(t)) return { match: t, remainder: '' };
  return null;
}
// ID/Age/quantity-style columns are just plain integers — but plain digits
// are ambiguous with all sorts of other things when merged into a bigger
// string, so (unlike email/date/amount) this only matches when the ENTIRE
// cell is nothing but a number. No partial extraction, no remainder.
function daFindNumber(v) {
  const t = v.trim();
  return /^-?\d+$/.test(DA_OCR_DIGIT_LENIENT(t)) ? { match: t, remainder: '' } : null;
}
// A dedicated ID finder, distinct from daFindNumber above, because real ID
// columns are just as often alphanumeric codes ("C001", "INV-2024-08") as
// they are plain integers — but the old code ran ID through the plain-
// integer finder, which rejects any letter. That meant an alphanumeric ID
// already sitting correctly in its own column NEVER matched itself, so
// Pass 1 fell through to searching the rest of the row and happily walked
// off with the first purely-numeric cell it found (most commonly an
// Employees/Age/Qty count), corrupting both columns at once.
// The fix is asymmetric on purpose: when checking the cell ALREADY in the
// ID column (isSelf), accept almost anything shaped like a single code
// token (no inner whitespace) — a real ID is never spread across words, so
// this can't be confused with a Company/Region/free-text cell. When
// searching a DIFFERENT cell for a stray ID value, stay strict (digits
// only) so this never reaches into another numeric column and steals it.
function daFindId(v, isSelf) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (isSelf) {
    return (!/\s/.test(t) && t.length <= 24) ? { match: t, remainder: '' } : null;
  }
  return /^-?\d+$/.test(DA_OCR_DIGIT_LENIENT(t)) ? { match: t, remainder: '' } : null;
}
// Percentage/growth/rate columns ("Growth %", "Conversion Rate") were
// previously left untyped ('text'), which meant nothing protected them
// from the Amount finder reaching in and pulling out their leading number
// (see daFindAmount above). Recognizing them as their own type lets them
// claim their own cell first, before Amount ever gets a turn.
function daFindPercent(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  const m = /(-?\d[\d,]*\.?\d*)\s*%/.exec(t);
  if (m) {
    const remainder = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).trim();
    return { match: m[0].replace(/\s+/g, ''), remainder };
  }
  // A bare number with no '%' sign is only accepted if the WHOLE cell is
  // just that number — otherwise it's too ambiguous with Amount/ID/Age to
  // safely claim from inside a longer string.
  return /^-?\d[\d,]*\.?\d*$/.test(t) ? { match: t, remainder: '' } : null;
}

// ── Format normalization ──────────────────────────────────────────────────
// Getting a value under the right header isn't enough if a Date column
// still mixes "2023-01-15", "01/16/2023", and "Jan 19 2023" — that's just
// as unreadable and unsortable as having them scattered across columns.
// Once a value is confirmed to be a date/amount/email/number, it's rewritten
// into one consistent shape for that whole column: dates → ISO YYYY-MM-DD,
// amounts → $#,###.##, emails → lowercased, numbers → OCR digit-swaps fixed.
const DA_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function daNormalizeDateValue(raw) {
  // Two variants: `lenient` runs the OCR digit-swap (O↔0, l/I↔1) for the
  // purely-numeric formats below, where that tolerance is actually useful.
  // `plain` skips the digit-swap and is used for the month-NAME formats —
  // running the swap on those first mangles real month names that contain
  // an 'l'/'I' or 'o'/'O' ("July"→"Ju1y", "November"→"N0vember",
  // "October"→"0ct0ber"), which then fail to match and silently leave the
  // date unconverted.
  const lenient = DA_OCR_DIGIT_LENIENT(raw).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  const plain = raw.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  let y, m, d, mm;
  if ((mm = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(lenient))) {
    y = +mm[1]; m = +mm[2]; d = +mm[3];
  } else if ((mm = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(lenient))) {
    // Ambiguous MM/DD vs DD/MM — default to US MM/DD/YYYY, but swap if the
    // first number can't possibly be a month (e.g. "25/12/2024").
    const a = +mm[1], b = +mm[2]; y = +mm[3];
    if (a > 12 && b <= 12) { d = a; m = b; } else { m = a; d = b; }
  } else if ((mm = /^(\d{1,2})[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s](\d{2,4})$/.exec(plain))) {
    d = +mm[1]; m = DA_MONTHS[mm[2]]; y = +mm[3];
  } else if ((mm = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s(\d{1,2}),?\s(\d{2,4})$/.exec(plain))) {
    m = DA_MONTHS[mm[1]]; d = +mm[2]; y = +mm[3];
  }
  if (!y || !m || !d) return raw; // couldn't confidently parse — leave untouched rather than guess
  if (y < 100) y += 2000;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Maps a currency symbol to the locale used to group/format its digits.
const DA_CURRENCY_LOCALE = { '₹': 'en-IN', '$': 'en-US', '€': 'de-DE', '£': 'en-GB', '¥': 'ja-JP' };

// Given a column header like "Unit Price (₹)" or "Amount (USD)", returns the
// currency symbol it names, or null if the header gives no hint. Used only
// as a fallback for cells that carry no symbol of their own.
function daHeaderCurrencySymbol(header) {
  const h = String(header || '');
  if (/₹|\bINR\b|\bRs\.?\b/i.test(h)) return '₹';
  if (/€|\bEUR\b/i.test(h)) return '€';
  if (/£|\bGBP\b/i.test(h)) return '£';
  if (/¥|\bJPY\b/i.test(h)) return '¥';
  if (/\$|\bUSD\b/i.test(h)) return '$';
  return null;
}

function daNormalizeAmountValue(raw, header) {
  const t = raw.trim();
  if (/^(n\/a|na|\[blank\]|-|—|--)$/i.test(t)) return 'N/A';
  // Preserve whichever currency the value actually came in as, instead of
  // hardcoding '$' onto every amount — a ₹-formatted figure was previously
  // reformatted as a dollar amount here even after being correctly
  // identified, which is its own silent-corruption bug on top of the
  // matching one above.
  // When the cell itself carries no symbol at all (common with tables
  // imported from a screenshot/photo, where only the header names the
  // currency, e.g. "Unit Price (₹)"), fall back to what the header says
  // instead of silently defaulting to '$'.
  let symbol;
  if (/₹/.test(t)) symbol = '₹';
  else if (/€/.test(t)) symbol = '€';
  else if (/£/.test(t)) symbol = '£';
  else if (/¥/.test(t)) symbol = '¥';
  else if (/\$/.test(t)) symbol = '$';
  else symbol = daHeaderCurrencySymbol(header) || '$';
  const cleaned = DA_OCR_DIGIT_LENIENT(t).replace(/[$₹€£¥,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return raw;
  const locale = DA_CURRENCY_LOCALE[symbol] || 'en-US';
  return symbol + num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daNormalizePercentValue(raw) {
  const t = String(raw || '').trim();
  if (!t) return raw;
  const cleaned = t.replace(/\s+/g, '');
  return /%$/.test(cleaned) ? cleaned : (cleaned + '%');
}

function daNormalizeEmailValue(raw) {
  return raw.trim().toLowerCase();
}

function daNormalizeNumberValue(raw) {
  const lenient = DA_OCR_DIGIT_LENIENT(raw.trim());
  return /^-?\d+$/.test(lenient) ? lenient : raw;
}

const DA_TYPE_NORMALIZERS = {
  date: daNormalizeDateValue,
  amount: daNormalizeAmountValue,
  email: daNormalizeEmailValue,
  number: daNormalizeNumberValue,
  percent: daNormalizePercentValue,
  // id intentionally has no normalizer — a code like "C001" shouldn't be
  // reformatted at all, just matched to the right column.
};

const DA_TYPE_FINDERS = { email: daFindEmail, date: daFindDate, amount: daFindAmount, number: daFindNumber, id: daFindId, percent: daFindPercent };

const DA_HEADER_TYPE_HINTS = [
  // Was previously `/e[- ]?ma[i1]l|^em|mail/i` — the bare `^em` matched any
  // header merely starting with "em" (Employees, Embarked, Employer...),
  // silently mistyping it as an email column and breaking every other
  // type's matching for that row as a result. `e[- ]?ma[i1]l` alone
  // already covers "Email"/"E-mail"/"E Mail", so the overbroad prefix
  // check is dropped rather than narrowed.
  { type: 'email', re: /e[- ]?ma[i1]l|\bmail\b/i },
  { type: 'date', re: /date|dob|\bday\b/i },
  { type: 'percent', re: /%|percent|\bgrowth\b|\brate\b/i },
  { type: 'amount', re: /amount|price|salary|cost|total|revenue|\bpay\b/i },
  // 'id' split out from the generic 'number' hint below — an ID column
  // needs the asymmetric self-vs-elsewhere matching in daFindId, not the
  // strict digits-only daFindNumber used for Age/Qty/Count.
  { type: 'id', re: /\bid\b/i },
  { type: 'number', re: /\bage\b|qty|quantity|\bcount\b|no\.?$|number|\bnum\b/i },
];

function daGuessHeaderType(header) {
  const h = String(header || '');
  for (const hint of DA_HEADER_TYPE_HINTS) {
    if (hint.re.test(h)) return hint.type;
  }
  return 'text';
}

function daSmartTypeRealign(headers, rows) {
  const headerTypes = headers.map(daGuessHeaderType);
  // Typed columns are walked in header order, so e.g. "ID" (usually column
  // 1) claims a plain-number cell before "Age" goes looking for one,
  // instead of the two competing unpredictably.
  const typedCols = headerTypes.map((t, i) => ({ t, i })).filter(x => x.t !== 'text');
  if (!typedCols.length) return rows; // nothing unambiguous to correct against

  return rows.map(row => {
    const width = Math.max(headers.length, row.length);
    let cells = Array.from({ length: width }, (_, i) => String(row[i] !== undefined ? row[i] : ''));
    let used = new Array(width).fill(false);
    const result = new Array(headers.length).fill('');

    // Pass 1 — claim a value for each unambiguously-typed header: prefer
    // the cell already sitting in that column if it already matches (never
    // move data that's already correct), otherwise scan the rest of the row
    // for the first unused cell containing that type anywhere in it. A
    // partial match (email/date/amount) splits its leftover text back into
    // the pool so nothing is thrown away.
    typedCols.forEach(({ t, i }) => {
      const finder = DA_TYPE_FINDERS[t];
      const order = [i, ...cells.map((_, j) => j).filter(j => j !== i)];
      for (const j of order) {
        if (used[j] || !cells[j]) continue;
        const found = finder(cells[j], j === i);
        if (!found) continue;
        result[i] = found.match;
        used[j] = true;
        if (found.remainder) { cells.push(found.remainder); used.push(false); }
        return;
      }
    });

    // Pass 2 — remaining free-text header slots absorb whatever's left,
    // strictly left-to-right, preserving relative order (name-like and
    // category-like text can't be told apart by content, so order is the
    // only signal worth trusting for these).
    const leftover = cells.map((v, idx) => ({ v, idx })).filter(x => !used[x.idx] && x.v !== '');
    const textColIdxs = headerTypes.map((t, i) => ({ t, i })).filter(x => x.t === 'text').map(x => x.i);
    let li = 0;
    textColIdxs.forEach(i => {
      if (li < leftover.length) { result[i] = leftover[li].v; used[leftover[li].idx] = true; li++; }
    });
    // Anything still left over (row had more values than there were slots
    // for) gets folded onto the last free-text column rather than dropped;
    // if every column was typed, it falls onto the very last column.
    if (li < leftover.length) {
      const target = textColIdxs.length ? textColIdxs[textColIdxs.length - 1] : headers.length - 1;
      const extra = leftover.slice(li).map(x => x.v).join(' ');
      result[target] = result[target] ? result[target] + ' ' + extra : extra;
    }

    // Rewrite each typed column's value into one consistent format for the
    // whole table — this is what actually makes a Date column readable
    // and sortable once every value is under it, instead of just moving
    // the mess into the right place.
    typedCols.forEach(({ t, i }) => {
      if (result[i] && DA_TYPE_NORMALIZERS[t]) result[i] = DA_TYPE_NORMALIZERS[t](result[i], headers[i]);
    });

    return result;
  });
}

function daNormalize(aoa) {
  let rows = (aoa || []).filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== ''));
  if (!rows.length) return { headers: ['Column 1'], rows: [], titleRow: null };

  const colCount = Math.max(...rows.map(r => r.length));
  rows = rows.map(r => {
    const padded = r.slice(0, colCount);
    while (padded.length < colCount) padded.push('');
    return padded.map(c => (c === undefined || c === null) ? '' : c);
  });

  // Report-style exports (and prose-to-canvas extraction, and OCR'd
  // screenshots) often carry one or more spanning title/subtitle rows above
  // the real header row — e.g. "Employee Satisfaction Survey 2026 - Tabular
  // Data" sitting alone above "Department, Employees, Satisfaction %...".
  // Those rows are sparsely filled (originally a single merged cell, or a
  // one-off caption line) compared to the real header/data rows underneath.
  // Peel off every such leading row — not just a single one — so a
  // title-then-subtitle pair doesn't leave the subtitle mistaken for headers.
  const titleParts = [];
  while (colCount > 1 && rows.length > 2) {
    const r0 = rows[0], r1 = rows[1];
    const r0Filled = r0.filter(c => String(c).trim() !== '');
    const r1Filled = r1.filter(c => String(c).trim() !== '');
    const r1FilledRatio = r1Filled.length / colCount;
    // Exactly one filled cell (a genuine spanning caption, originally one
    // merged cell) — deliberately narrower than "sparsely filled", so a row
    // with 2+ scattered values (a grouped-header label row like "Q1 _ Q2 _")
    // falls through to the grouped-header check below instead of being
    // discarded as a title. The row below either needs to look like the real
    // header (mostly filled) or be another single-cell caption itself (a
    // "Report Title" / "Subtitle" pair stacked above the real header), so a
    // second peel of the loop can reach the actual header underneath.
    // Threshold lowered from 0.6 to 0.4: a group-label row spanning several
    // sub-columns (e.g. "FY2025-26" / "FY2024-25" / "Growth" filled in only
    // 3 of 6 cells, each label really covering 2 sub-columns underneath) is
    // legitimately sparse and shouldn't stop a real title row above it from
    // being peeled off. A true single-row header (no title above it) is
    // still almost always filled well above 0.4, so this doesn't risk
    // mistaking a real header for a title candidate's "row below".
    const looksLikeSpanningTitle = r0Filled.length === 1 && (r1FilledRatio >= 0.4 || r1Filled.length === 1);
    if (!looksLikeSpanningTitle) break;
    titleParts.push(r0Filled.map(c => String(c).trim()).join(' '));
    rows = rows.slice(1);
  }
  const titleRow = titleParts.length ? titleParts.join(' — ') : null;

  // Grouped/spanning two-row headers — e.g. a blank-then-repeated group
  // label ("Q1" merged across 3 sub-columns, so only the first of the 3
  // lands filled) sitting above a fully-filled row of real sub-column names
  // ("Revenue", "Costs", "Margin"). Forward-fill the sparse group row across
  // its blanks, then fold group+sub into one header per column, e.g.
  // "Q1 Revenue". Only kicks in when the row below looks like real column
  // names (mostly text) and the rows after that look like actual data.
  let headerRowsUsed = 1;
  let groupRow = null;
  if (rows.length > 3) {
    const r0 = rows[0], r1 = rows[1];
    const r0FilledCount = r0.filter(c => String(c).trim() !== '').length;
    // Ratio rather than a strict "every cell" check — tolerates one stray
    // blank sub-header (e.g. an unlabeled leading ID/leader column) without
    // losing the grouped-header match over a single missing label.
    const r1FilledCells = r1.filter(c => String(c).trim() !== '').length;
    const r1AllFilled = (r1FilledCells / colCount) >= 0.8;
    const r1MostlyText = r1.filter(c => !daCellLooksNumeric(c)).length >= Math.ceil(colCount * 0.7);
    const sample = rows.slice(2, 7);
    let numericBelow = 0, totalBelow = 0;
    sample.forEach(r => r.forEach(c => { if (String(c).trim() !== '') { totalBelow++; if (daCellLooksNumeric(c)) numericBelow++; } }));
    const belowLooksLikeData = totalBelow > 0 && (numericBelow / totalBelow) > 0.3;
    const looksGrouped = r0FilledCount >= 1 && r0FilledCount < colCount && r1AllFilled && r1MostlyText && belowLooksLikeData;
    if (looksGrouped) {
      let lastFilled = '';
      groupRow = r0.map(c => { const v = String(c).trim(); if (v !== '') lastFilled = v; return lastFilled; });
      headerRowsUsed = 2;
    }
  }

  const headerSourceRow = headerRowsUsed === 2 ? rows[1] : rows[0];
  const dataStartRows = rows.slice(headerRowsUsed);

  // Decide if the header source row actually looks like a header: usually
  // all non-empty (or very nearly, e.g. one blank leader/ID column), text-
  // heavy, and distinct from the more numeric/mixed rows below it.
  const sampleRows = dataStartRows.slice(0, 6);
  const filledInHeaderRow = headerSourceRow.filter(c => String(c).trim() !== '').length;
  const headerRowMostlyFilled = filledInHeaderRow >= Math.max(1, Math.ceil(colCount * 0.8));
  const headerRowMostlyText = headerSourceRow.filter(c => String(c).trim() !== '' && !daCellLooksNumeric(c)).length >=
    Math.ceil(filledInHeaderRow * 0.8);
  let numericBelow = 0, totalBelow = 0;
  sampleRows.forEach(r => r.forEach(c => { if (String(c).trim() !== '') { totalBelow++; if (daCellLooksNumeric(c)) numericBelow++; } }));
  const belowLooksNumeric = totalBelow > 0 && (numericBelow / totalBelow) > 0.4;
  const useHeaderRow = headerRowMostlyFilled && (headerRowMostlyText || belowLooksNumeric) && dataStartRows.length > 0;

  let headers, dataRows;
  if (useHeaderRow) {
    headers = headerSourceRow.map((c, i) => {
      const label = String(c).trim();
      if (headerRowsUsed === 2 && groupRow) {
        const grp = groupRow[i];
        return grp && grp !== label ? `${grp} ${label}`.trim() : (label || `Column ${i + 1}`);
      }
      return label;
    });
    dataRows = dataStartRows;
  } else {
    headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
    dataRows = rows;
  }

  // Clean + dedupe headers so nothing overlaps or collides
  const seen = {};
  headers = headers.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    if (seen[name] !== undefined) {
      seen[name]++;
      name = `${name} (${seen[name]})`;
    } else seen[name] = 0;
    return name;
  });

  // Only worth correcting against real column names — generic "Column N"
  // headers (useHeaderRow === false) carry no type signal to check cells
  // against.
  if (useHeaderRow) {
    dataRows = daSmartTypeRealign(headers, dataRows);
  }

  return { headers, rows: dataRows, titleRow };
}

function daAddDataset(name, aoa, titleOverride) {
  const { headers, rows, titleRow } = daNormalize(aoa);
  const id = 'ds' + (++daIdCounter);
  // titleOverride wins when supplied (e.g. a heading detected from pasted
  // clipboard HTML) — otherwise fall back to whatever daNormalize found as
  // a literal title row baked into the data itself.
  const ds = { id, name: name || `Dataset ${daState.datasets.length + 1}`, headers, rows, title: titleOverride || titleRow || null, frozen: true, colDropdowns: {}, cellDropdowns: {}, rowHighlights: {}, colHighlights: {}, cellHighlights: {} };

  // Bank-statement awareness: whatever the source (uploaded PDF/CSV/Excel
  // statement, a scanned image run through OCR, or a pasted table), if the
  // header row reads like a bank statement (Withdrawal/Deposit/Balance,
  // Value Date, Chq/Ref No, UTR, IFSC, ...) tag the dataset with its type
  // and work out a quick one-line summary — transaction count, total money
  // in/out, and the closing balance — so the person gets that read
  // immediately instead of having to eyeball or manually total rows.
  const detected = daDetectDataType(headers);
  ds.dataType = detected.type;
  if (detected.type === 'bank' && rows.length) {
    ds.bankSummary = daBankStatementSummary(headers, rows);
  }

  daState.datasets.push(ds);
  daState.activeId = id;

  if (ds.bankSummary && ds.bankSummary.txnCount > 0) daToastBankSummary(ds.name, ds.bankSummary);
}

// Scans a bank-statement-shaped table (headers + rows already normalized by
// daNormalize) and totals up what matters: how many transactions, how much
// moved in vs out, and — where a running-balance column exists — the
// closing balance plus the first/last transaction dates covered. Column
// matching reuses the same header patterns as daBuildCellStyles so the
// numbers here always line up with what got colored red/green in the grid.
function daBankStatementSummary(headers, rows) {
  const debitCol = daFindCol(headers, ['withdrawal', 'dr amt', 'debit']);
  const creditCol = daFindCol(headers, ['deposit', 'cr amt', 'credit']);
  const balanceCol = daFindCol(headers, ['closing balance', 'running balance', 'balance']);
  const dateCol = daFindCol(headers, ['value date', 'txn date', 'transaction date', 'date']);

  let txnCount = 0, totalDebit = 0, totalCredit = 0, closingBalance = null, firstDate = null, lastDate = null;
  rows.forEach(r => {
    if (!r.some(c => String(c ?? '').trim() !== '')) return; // skip fully blank rows
    txnCount++;
    if (debitCol >= 0) {
      const n = parseFloat(daCleanNum(r[debitCol]));
      if (!isNaN(n)) totalDebit += n;
    }
    if (creditCol >= 0) {
      const n = parseFloat(daCleanNum(r[creditCol]));
      if (!isNaN(n)) totalCredit += n;
    }
    if (balanceCol >= 0) {
      const raw = String(r[balanceCol] ?? '').trim();
      if (raw !== '') { const n = parseFloat(daCleanNum(raw)); if (!isNaN(n)) closingBalance = n; } // last non-empty wins
    }
    if (dateCol >= 0) {
      const raw = String(r[dateCol] ?? '').trim();
      if (raw !== '') { if (!firstDate) firstDate = raw; lastDate = raw; }
    }
  });

  return {
    txnCount, totalDebit, totalCredit, closingBalance, firstDate, lastDate,
    hasDebit: debitCol >= 0, hasCredit: creditCol >= 0, hasBalance: balanceCol >= 0,
  };
}

// One friendly toast on ingest — "Bank statement detected — 42
// transactions · deposits ₹1,20,000 · withdrawals ₹85,400 · closing
// balance ₹34,600" — instead of leaving the person to scroll and add it
// up by hand. Uses en-IN grouping (lakh/crore commas) since that's what
// this tool's statements are typically in.
function daToastBankSummary(name, s) {
  const money = n => '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
  const parts = [`${s.txnCount} transaction${s.txnCount === 1 ? '' : 's'}`];
  if (s.hasCredit) parts.push(`deposits ${money(s.totalCredit)}`);
  if (s.hasDebit) parts.push(`withdrawals ${money(s.totalDebit)}`);
  if (s.hasBalance && s.closingBalance !== null) parts.push(`closing balance ${money(s.closingBalance)}`);
  toast(`Bank statement detected in "${name}" — ${parts.join(' · ')}`, 'success');
}

// ─── Create Blank Table: spreadsheet-style, no file needed. Starts with a
// small empty grid (generic "Column N" headers, blank rows) that the person
// fills in by hand using the same cell editing, formulas, Row/Column
// buttons, and export pipeline as an uploaded table. ───
function daCreateBlankTable() {
  const colCount = 4, rowCount = 8;
  const headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
  const rows = Array.from({ length: rowCount }, () => new Array(colCount).fill(''));
  const existingBlankCount = daState.datasets.filter(d => /^Table \d+$/.test(d.name)).length;
  const id = 'ds' + (++daIdCounter);
  daState.datasets.push({ id, name: `Table ${existingBlankCount + 1}`, headers, rows, frozen: true, colDropdowns: {}, cellDropdowns: {}, rowHighlights: {}, colHighlights: {}, cellHighlights: {} });
  daState.activeId = id;
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
  toast('Blank table created, click any cell to start typing', 'success');
}

// ─── Kadessa table templates: the Data Arrangement counterpart to
// MF_TEMPLATES. Each entry is a ready column set for a common business
// table ("lead management", "sales tracker", ...) so a request like "kadessa
// create me a lead management table" gets real, sensible headers instead
// of four generic "Column N" cells. `rows` is how many blank starter rows
// the table opens with -- kept small (6-10) since these are meant to be
// filled in by hand or via further da_add_row / da_update_cell calls, not
// pre-populated with fake data. Keyed by camelCase id, same convention as
// MF_TEMPLATES, because da_create_table_from_template below has to match
// the model's `table` param to a key exactly. ───
// FIX: `dropdowns` (colIdx into this template's own `columns` array, plus its
// pick-list) lets an obviously-fixed-value column arrive with a real dropdown
// already attached, instead of every "Status"/"Priority"/"RSVP" column
// rendering as a dropdown with a set of options only the header knows about
// and no values a person can actually pick without first right-clicking to
// set them up by hand. Only added where the column genuinely takes a fixed
// set of values -- free-text columns (Notes, Tags, Payment Terms, Location)
// are deliberately left alone.
const DA_TABLE_TEMPLATES = {
  leadManagement: { name: 'Lead Management', rows: 8,
    columns: ['Lead Name', 'Company', 'Email', 'Phone', 'Source', 'Status', 'Owner', 'Last Contacted', 'Notes'],
    dropdowns: [{ colIdx: 5, options: ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'] }] },
  salesTracker: { name: 'Sales Tracker', rows: 8,
    columns: ['Deal Name', 'Customer', 'Value', 'Stage', 'Close Date', 'Owner', 'Probability %', 'Notes'],
    dropdowns: [{ colIdx: 3, options: ['Prospecting', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] }] },
  inventory: { name: 'Inventory', rows: 10,
    columns: ['Item', 'SKU', 'Category', 'Quantity', 'Unit Cost', 'Reorder Level', 'Supplier', 'Location'] },
  expenseTracker: { name: 'Expense Tracker', rows: 10,
    columns: ['Date', 'Category', 'Description', 'Amount', 'Payment Method', 'Paid By', 'Reimbursed'],
    dropdowns: [
      { colIdx: 4, options: ['Cash', 'Card', 'Bank Transfer', 'UPI', 'Cheque'] },
      { colIdx: 6, options: ['Yes', 'No', 'Pending'] },
    ] },
  clientDirectory: { name: 'Client Directory', rows: 8,
    columns: ['Name', 'Company', 'Email', 'Phone', 'Address', 'Tags', 'Notes'] },
  taskTracker: { name: 'Task Tracker', rows: 8,
    columns: ['Task', 'Assignee', 'Priority', 'Status', 'Due Date', 'Notes'],
    dropdowns: [
      { colIdx: 2, options: ['Low', 'Medium', 'High'] },
      { colIdx: 3, options: ['Not Started', 'In Progress', 'Done', 'Blocked'] },
    ] },
  invoiceLog: { name: 'Invoice Log', rows: 8,
    columns: ['Invoice #', 'Client', 'Issue Date', 'Due Date', 'Amount', 'Status'],
    dropdowns: [{ colIdx: 5, options: ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'] }] },
  employeeDirectory: { name: 'Employee Directory', rows: 8,
    columns: ['Name', 'Employee ID', 'Department', 'Role', 'Email', 'Phone', 'Joining Date'] },
  eventGuestList: { name: 'Event Guest List', rows: 10,
    columns: ['Guest Name', 'Email', 'Phone', 'RSVP Status', 'Plus One', 'Table No.', 'Notes'],
    dropdowns: [
      { colIdx: 3, options: ['Yes', 'No', 'Maybe'] },
      { colIdx: 4, options: ['Yes', 'No'] },
    ] },
  vendorDirectory: { name: 'Vendor Directory', rows: 8,
    columns: ['Vendor', 'Contact Person', 'Email', 'Phone', 'Category', 'Payment Terms', 'Notes'] },
  budgetTracker: { name: 'Budget Tracker', rows: 8,
    columns: ['Category', 'Budgeted', 'Actual', 'Variance', 'Notes'] },
  attendanceLog: { name: 'Attendance Log', rows: 10,
    columns: ['Date', 'Name', 'Status', 'Check-in', 'Check-out', 'Notes'],
    dropdowns: [{ colIdx: 2, options: ['Present', 'Absent', 'Late', 'Leave'] }] }
};
window.DA_TABLE_TEMPLATES = DA_TABLE_TEMPLATES;

// Shared name de-duplication: same "Base", "Base (2)", "Base (3)" scheme
// daPasteTableFromClipboard already uses for a detected title, reused here
// so a Kadessa-created table never silently overwrites/hides an existing tab
// that happens to share its name.
// Shared by every Kadessa Data Arrangement action below: if Kadessa runs a DA
// action while the person is looking at a DIFFERENT panel (PDF Editor,
// Make Forms, wherever), this switches them into Data Arrangement first so
// the edit is actually visible, instead of silently changing a table they
// can't see (the same fix daCreateTableWithColumns already had). A no-op
// when they're already on Data Arrangement.
function daEnsureVisible() {
  if (typeof unifiedActiveSection === 'function' && typeof navigate === 'function' && unifiedActiveSection() !== 'dataarrange') {
    navigate('dataarrange');
  }
}

function daUniqueTableName(base) {
  let name = base, n = 2;
  while (daState.datasets.some(d => d.name === name)) {
    name = base + ' (' + n + ')';
    n++;
  }
  return name;
}

// ── Kadessa hook: da_create_table ──────────────────────────────────────────
// Builds a brand-new table with caller-given column headers (and optional
// starter row count), the "custom columns" counterpart to
// daCreateTableFromTemplate below. Mirrors daCreateBlankTable's dataset
// shape exactly so a Kadessa-built table is indistinguishable from a manually
// -built one -- same tab behaviour, same cell editing, same export path.
function daCreateTableWithColumns(name, columns, rowCount, dropdowns) {
  const cleanHeaders = (Array.isArray(columns) ? columns : [])
    .map(function (h) { return String(h == null ? '' : h).trim(); })
    .filter(function (h) { return h.length > 0; })
    .slice(0, 30);
  if (!cleanHeaders.length) throw new Error('at least one column is needed to create a table');
  const rc = Math.max(1, Math.min(Math.round(Number(rowCount)) || 8, 500));
  // FIX: Kadessa can trigger this from ANY panel (see KADESSA_ACTIONS.da_create_table /
  // da_create_table_from_template), same as mf_create_form/mf_create_from_template.
  // This function used to only ever touch Data Arrangement's own internal state --
  // it never switched the top-level section. That meant a table built while the
  // user was looking at, say, PDF Editor was created and persisted correctly, but
  // the user never saw it: they stayed on PDF Editor, and the new table (plus any
  // "what columns should it have?" back-and-forth) was invisible to them. From the
  // outside this looked exactly like the "yes do IT!" -> "please open Data
  // Arrangement and ask again" dead end -- Kadessa HAD the details, she just couldn't
  // show her work. Switching the section here, before building the table, fixes
  // that regardless of which panel the request originated from. Guarded so the
  // normal in-panel "+/New Table" click path doesn't pay for a redundant
  // navigate() call.
  if (typeof unifiedActiveSection === 'function' && typeof navigate === 'function' && unifiedActiveSection() !== 'dataarrange') {
    navigate('dataarrange');
  }
  const existingBlankCount = daState.datasets.filter(d => /^Table \d+$/.test(d.name)).length;
  const base = (name && String(name).trim()) ? String(name).trim().slice(0, 40) : `Table ${existingBlankCount + 1}`;
  const finalName = daUniqueTableName(base);
  const rows = Array.from({ length: rc }, () => new Array(cleanHeaders.length).fill(''));
  const id = 'ds' + (++daIdCounter);
  const ds = { id, name: finalName, headers: cleanHeaders, rows, frozen: true, colDropdowns: {}, cellDropdowns: {}, rowHighlights: {}, colHighlights: {}, cellHighlights: {} };
  // FIX: dropdowns can now be attached in the SAME call that creates the table,
  // instead of always needing a separate da_set_dropdown round-trip afterwards.
  // This is what lets Kadessa answer "know when to create dropdowns" for a
  // custom (non-template) table: she already knows the exact column list she
  // just picked, so a column that obviously takes a fixed set of values
  // (Status, Priority, RSVP...) can get its pick-list right away. Malformed
  // entries (bad colIdx, no usable options) are skipped rather than failing
  // the whole table -- a table with 8 correct columns and one skipped
  // dropdown is far better than no table at all.
  if (Array.isArray(dropdowns) && dropdowns.length) {
    daEnsureDropdownStore(ds);
    dropdowns.forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      const ci = Number(d.colIdx);
      if (!Number.isInteger(ci) || ci < 0 || ci >= cleanHeaders.length) return;
      const opts = Array.isArray(d.options)
        ? [...new Set(d.options.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(function (s) { return s !== ''; }))]
        : [];
      if (!opts.length) return;
      ds.colDropdowns[ci] = opts;
      ds.colDropdownColors[ci] = daAutoAssignDropdownColors(opts);
    });
  }
  daState.datasets.push(ds);
  daState.activeId = id;
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
  toast('"' + finalName + '" table created with ' + cleanHeaders.length + ' column' + (cleanHeaders.length === 1 ? '' : 's') + ', click any cell to start typing', 'success');
  return ds;
}

// ── Kadessa hook: da_create_table_from_template ────────────────────────────
// Same idea as mfCreateFromTemplate, for Data Arrangement: looks up one of
// DA_TABLE_TEMPLATES and hands its name/columns/rows straight to
// daCreateTableWithColumns above, so "create me a lead management table"
// lands with real CRM-style columns already in place. Also carries the
// template's own `dropdowns` (colIdx into its own columns array), if any,
// so e.g. leadManagement's Status column arrives pre-populated with a
// pick-list without Kadessa having to guess options for a table she never
// sees the real headers of.
function daCreateTableFromTemplate(key) {
  const tpl = DA_TABLE_TEMPLATES[key];
  if (!tpl) throw new Error('unknown table template "' + key + '"');
  return daCreateTableWithColumns(tpl.name, tpl.columns.slice(), tpl.rows || 8, tpl.dropdowns);
}

// ─── Paste Table (Ctrl/Cmd+V): copy any table from Excel, Sheets, Word, or
// a plain tab-separated block, and land it straight in Data Arrangement as
// a new, fully editable dataset — no upload/export step needed. Reuses the
// same clipboard <table> parser the PDF Editor's canvas paste uses
// (pdfedParseHtmlTableClipboard), so Excel/Sheets/Word's real cell grid is
// read exactly, not guessed from tab characters, whenever the source
// clipboard provides it. ───
// Splits a block of pasted plain text into rows/cells without assuming the
// source used tabs. Real-world "raw data" people paste in (CSV exports,
// AI-generated tables, log dumps, OCR/console output, etc.) shows up in a
// few different shapes:
//   - true delimited text (tab/comma/semicolon/pipe consistently between cells)
//   - space-ALIGNED text (columns lined up with runs of 2+ spaces, no real
//     delimiter at all — typical of OCR output, terminal dumps, monospace
//     tables copied as plain text)
// The naive approach of "does this line contain a comma" is fooled by stray
// commas that are part of a *value*, not a separator — e.g. "$5,500" or
// "62,000.00" — so numeric thousand-separator commas are ignored when
// scoring/splitting. A delimiter is only trusted if it shows up across most
// of the sample lines (not just one or two), otherwise we fall back to
// splitting on runs of whitespace.
// Tells apart a real short data value ("NYC", "42", "Engineer") from a
// chunk of ordinary sentence that just happened to sit between two commas
// ("and agree to proceed with the offer"). Two independent tells:
//   - a full stop followed by a new capitalized sentence living INSIDE a
//     single cell — a real data value never contains a complete sentence
//     boundary, only continuous prose does
//   - most cells reading as 3+-word phrases built around ordinary English
//     stopwords (the, and, of, with, that, ...) rather than short atomic
//     labels or numbers
function daCellsLookLikeProse(cells) {
  if (cells.some(c => /[.!?]\s+[A-Z]/.test(c))) return true;
  const STOPWORDS = /\b(the|and|of|to|that|this|for|with|is|are|on|in|at|from|or|be|by|we|will|may|shall|have|has|been|which|who|where|when)\b/i;
  const proseLike = cells.filter(c => {
    const words = c.trim().split(/\s+/).filter(Boolean);
    return words.length >= 3 && STOPWORDS.test(c);
  }).length;
  return cells.length >= 4 && (proseLike / cells.length) > 0.5;
}

function daSplitDelimitedText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.length);
  if (!lines.length) return null;

  const sample = lines.slice(0, Math.min(lines.length, 20));

  // Comma/semicolon that sit between digits (with no space) are almost
  // always thousands/decimal separators inside a single value, not a real
  // column boundary — e.g. "5,500" or "1;500" (rare, but same idea). Mask
  // those out before counting or splitting on that delimiter.
  function maskNumericSeparators(line, delim) {
    if (delim !== ',' && delim !== ';') return line;
    const re = new RegExp('(\\d)' + delim + '(?=\\d)', 'g');
    return line.replace(re, '$1\u0000');
  }

  function parseLineCsvAware(line, delim) {
    const masked = maskNumericSeparators(line, delim);
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '"') {
        if (inQuotes && masked[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        cells.push(cur); cur = '';
      } else {
        cur += (ch === '\u0000' ? delim : ch);
      }
    }
    cells.push(cur);
    return cells;
  }

  const candidates = ['\t', ',', ';', '|'];
  let best = null;
  for (const delim of candidates) {
    // Require the delimiter to actually appear across most lines — one or
    // two lines with a stray comma shouldn't be enough to call it "the"
    // delimiter for the whole block.
    const coverage = sample.filter(l => maskNumericSeparators(l, delim).includes(delim)).length / sample.length;
    if (coverage < 0.7) continue;
    const counts = sample.map(l => parseLineCsvAware(l, delim).length);
    const maxCount = Math.max(...counts);
    if (maxCount < 2) continue;
    const modeCount = counts.sort((a, b) =>
      counts.filter(c => c === b).length - counts.filter(c => c === a).length
    )[0];
    const consistency = counts.filter(c => c === modeCount).length / counts.length;
    const score = consistency * maxCount;
    if (!best || score > best.score) best = { delim, score, maxCount };
  }

  if (best && best.maxCount >= 2) {
    // A comma or semicolon is everyday punctuation inside ordinary
    // sentences, so a multi-paragraph paste (each paragraph comma-heavy)
    // can score just as well as a real multi-row CSV export — every "row"
    // (paragraph) having a similar comma count looks exactly like column
    // consistency. A single line was the only case originally guarded
    // against; that missed the far more common case of a pasted block of
    // prose spanning several lines (e.g. a multi-paragraph report summary,
    // which produced a 4-col/2-row table out of two ordinary sentences
    // here). So for ANY comma/semicolon delimiter — not just a single
    // line — check what the resulting cells actually contain across every
    // sampled row: a full stop followed by a new capitalized sentence
    // sitting INSIDE one cell, or most cells reading as multi-word phrases
    // stitched together with ordinary stopwords, means this was prose
    // being cut on its commas, not real data — bail out so the caller
    // falls back to placing it as plain text instead.
    if (best.delim === ',' || best.delim === ';') {
      const allCells = sample.reduce((acc, l) => acc.concat(parseLineCsvAware(l, best.delim)), []);
      if (daCellsLookLikeProse(allCells)) return null;
    }
    return lines.map(l => parseLineCsvAware(l, best.delim));
  }

  // Fallback: no reliable real delimiter — try space-aligned columns.
  // First choice: a whole-block "ruler" pass — find character columns that
  // are whitespace across EVERY sampled line (not just 2+ spaces on one
  // line in isolation). This is the difference that matters for real pasted
  // tables: if one row's cell text runs long enough that its gap to the next
  // column narrows to a single space (while other rows still have 2+ spaces
  // there), a per-line "\s{2,}" split misses that boundary on THAT row only —
  // the cell merges into its neighbor and every column after it shifts by
  // one. Scanning all lines together instead of one at a time survives that:
  // as long as the boundary is a space in every row, it's still detected,
  // whether it's 1 space or 10.
  const rulerRows = daSplitBySpaceRuler(sample);
  if (rulerRows) {
    const rulerCols = rulerRows[0].length;
    if (rulerCols >= 2 && rulerRows.every(r => r.length === rulerCols)) {
      return daSplitBySpaceRuler(lines);
    }
  }

  // Last resort: 2+ consecutive spaces = a column gap, judged per line. Kept
  // as a fallback for blocks where the ruler pass above doesn't find a clean
  // whitespace column shared by every line (e.g. genuinely ragged OCR output).
  const spaceCounts = sample.map(l => l.trim().split(/\s{2,}/).length);
  const maxSpaceCols = Math.max(...spaceCounts);
  if (maxSpaceCols >= 2) {
    const modeCount = spaceCounts.sort((a, b) =>
      spaceCounts.filter(c => c === b).length - spaceCounts.filter(c => c === a).length
    )[0];
    const consistency = spaceCounts.filter(c => c === modeCount).length / spaceCounts.length;
    // Only trust this if it's reasonably consistent — otherwise a single
    // line with wide spacing shouldn't force a column split on everything.
    if (consistency >= 0.4) {
      return lines.map(l => l.trim().split(/\s{2,}/));
    }
  }

  return null;
}

// Whole-block fixed-width column splitter. Finds character positions that
// are whitespace in EVERY given line (treating past-end-of-line as
// whitespace, so shorter rows don't break the scan), groups the remaining
// non-whitespace positions into contiguous runs, and slices each line by
// those runs. Returns null if fewer than 2 columns are found. This is what
// actually fixes a row like "22 July 2001" or "30 November 1990" running
// long enough to leave only one space before the next column — as long as
// that one space lines up with a space in every other row, it still counts
// as a real column boundary.
function daSplitBySpaceRuler(lines) {
  if (!lines.length) return null;
  const maxLen = Math.max(...lines.map(l => l.length));
  if (!maxLen) return null;
  const isGapCol = new Array(maxLen).fill(true);
  for (const line of lines) {
    for (let i = 0; i < maxLen; i++) {
      const ch = i < line.length ? line[i] : ' ';
      if (ch !== ' ' && ch !== '\t') isGapCol[i] = false;
    }
  }
  // A gap column that's only 1 character wide needs a second check before it's trusted as a
  // real column boundary. Without this, a value that always has an internal space at the same
  // relative position in every row — e.g. "11:15 PM" — would get mistaken for a column gap,
  // since that single space column happens to be whitespace in every line too. The distinguishing
  // signal: a REAL narrowed gap (the case this whole function exists to catch — one or two rows'
  // long cell text eating most of the padding) still has most OTHER rows sitting comfortably wide
  // at that same position. An incidental in-value space doesn't — it's exactly 1 space in every
  // row, never wider. So: demote a 1-wide global gap to "not a boundary" unless most individual
  // rows show a locally wider space run there.
  let i = 0;
  while (i < maxLen) {
    if (!isGapCol[i]) { i++; continue; }
    let j = i;
    while (j < maxLen && isGapCol[j]) j++;
    if (j - i === 1) {
      let wideLocalCount = 0, applicable = 0;
      for (const line of lines) {
        if (i >= line.length) continue; // line doesn't reach here — not informative either way
        applicable++;
        let a = i, b = i;
        while (a > 0 && line[a - 1] === ' ') a--;
        while (b < line.length && line[b] === ' ') b++;
        if (b - a >= 2) wideLocalCount++;
      }
      if (!applicable || wideLocalCount / applicable < 0.6) isGapCol[i] = false;
    }
    i = j;
  }
  const segments = [];
  i = 0;
  while (i < maxLen) {
    if (isGapCol[i]) { i++; continue; }
    let j = i;
    while (j < maxLen && !isGapCol[j]) j++;
    segments.push([i, j]);
    i = j;
  }
  if (segments.length < 2) return null;
  return lines.map(line => segments.map(([s, e]) => line.slice(s, Math.min(e, line.length)).trim()));
}

// Tries to find a human title for a pasted table by looking at the HTML
// around the <table> element itself. A report card like "Assets Comparison"
// almost always has that title living OUTSIDE the <table> markup (a
// <caption>, a heading, or a plain styled line right above it) — the table
// row/cell parser never sees it, which is why a pasted table used to always
// land as the generic "Pasted Table N" even when it clearly had a name.
//
// v2: walks the ENTIRE clipboard fragment in document order (not just
// direct previous siblings) and keeps the most recent short "label-like"
// line of text seen before reaching the <table> node. Real-world sources
// (chat UIs, report cards, dashboards) often put several wrapper <div>s
// between a title and its table, so a sibling-only search missed those —
// document-order traversal finds the title regardless of how deep the
// nesting is, as long as it appears somewhere before the table.
// Still best-effort only: if the title text was never actually part of
// what got copied to the clipboard in the first place (e.g. only the table
// rows were selected), there is nothing here to recover — callers fall
// back to the generic name exactly as before.
function daExtractTableTitleFromHtml(html) {
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const table = tmp.querySelector('table');
    if (!table) return null;
    const clean = t => (t || '').replace(/\s+/g, ' ').trim();
    // 1. A real <caption> inside the table is the most explicit signal.
    const caption = table.querySelector('caption');
    if (caption && clean(caption.textContent)) return clean(caption.textContent).slice(0, 60);

    // 2. Walk the whole fragment in document order, remembering the closest
    // qualifying text-bearing "leaf" element seen before we hit the table —
    // this is the title regardless of how many wrapper divs sit between it
    // and the table.
    let candidate = null;
    const INLINE_TAGS = /^(SPAN|B|STRONG|EM|I|A|SMALL|BR|SUP|SUB)$/;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node === table) break;
      if (node.contains(table)) continue; // ancestor wrapper of the table, not a title
      // Only consider "leaf-ish" elements (children are inline-only, or none)
      // so we grab the innermost heading/label rather than a whole
      // container's concatenated text.
      const hasBlockChild = Array.from(node.children).some(c => !INLINE_TAGS.test(c.tagName));
      if (hasBlockChild) continue;
      const raw = node.textContent || '';
      const text = clean(raw);
      if (!text || text.length > 80 || /[\t\n]/.test(raw)) continue;
      candidate = text; // keep overwriting — the last one before the table wins
    }
    return candidate ? candidate.slice(0, 60) : null;
  } catch (err) { /* best-effort only — never block the paste over this */ }
  return null;
}

document.addEventListener('paste', function (e) {
  const daSection = document.getElementById('sec-dataarrange');
  if (!daSection || !daSection.classList.contains('active')) return;
  // A paste while actually typing into a cell, the formula bar, the search
  // box, or any other field on the page should behave like a normal paste
  // into that field — only a bare paste onto the module itself (nothing
  // focused, or focus sitting on inert chrome like a button) creates a new
  // table.
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return;
  const html = cd.getData('text/html');
  const plain = cd.getData('text/plain');
  let rowsData = null;
  let title = null;
  if (html && /<table[\s>]/i.test(html) && typeof pdfedParseHtmlTableClipboard === 'function') {
    rowsData = pdfedParseHtmlTableClipboard(html);
    title = daExtractTableTitleFromHtml(html);
  } else if (plain && plain.trim()) {
    rowsData = daSplitDelimitedText(plain);
  }
  if (!rowsData || !rowsData.length || !rowsData.some(r => r.length > 1)) {
    // Previously this failed completely silently. If there was plain text on
    // the clipboard but we still couldn't find a usable table shape in it,
    // tell the person instead of doing nothing.
    if (plain && plain.trim()) {
      e.preventDefault();
      toast('Couldn\'t detect columns in the pasted text — expected tab, comma, semicolon, or pipe-separated data', 'info');
    }
    return;
  }
  e.preventDefault();
  daPasteTableFromClipboard(rowsData, title);
});

// Builds a new Data Arrangement dataset straight from parsed clipboard rows
// (array of arrays of cell text) — same daAddDataset/daNormalize pipeline an
// uploaded file goes through, so header detection, formulas, and export all
// work on a pasted table exactly like they do on an uploaded one.
function daPasteTableFromClipboard(rowsData, suggestedTitle) {
  let name;
  if (suggestedTitle && suggestedTitle.trim()) {
    // Use the detected title (e.g. "Assets Comparison") as the tab name,
    // de-duplicated against any dataset already using it.
    const base = suggestedTitle.trim().slice(0, 40);
    name = base;
    let n = 2;
    while (daState.datasets.some(d => d.name === name)) {
      name = `${base} (${n})`;
      n++;
    }
  } else {
    const existingPastedCount = daState.datasets.filter(d => /^Pasted Table \d+$/.test(d.name)).length;
    name = `Pasted Table ${existingPastedCount + 1}`;
  }
  daAddDataset(name, rowsData, suggestedTitle || null);
  if (typeof daResetFormulaBar === 'function') daResetFormulaBar();
  daWorkspaceRefreshVisibility();
  daRenderTabs();
  daRenderTable();
  const rows = rowsData.length, cols = Math.max(...rowsData.map(r => r.length));
  toast(`${rows} x ${cols} table pasted into Data Arrangement`, 'success');
}

// Fallback for the "Paste Table" toolbar/empty-state buttons — a click can't
// see a native paste event, so it reads the clipboard directly through the
// async Clipboard API instead. Needs the browser to grant clipboard-read
// permission (Chrome/Edge prompt for this automatically on click); if that's
// blocked, the person can still always just press Ctrl+V, which uses the
// listener above and needs no permission at all.
async function daPasteTableFromButton() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    toast('Click inside Data Arrangement and press Ctrl+V (⌘V on Mac) to paste your table', 'info');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    let rowsData = null;
    let title = null;
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html');
        const html = await blob.text();
        if (/<table[\s>]/i.test(html) && typeof pdfedParseHtmlTableClipboard === 'function') {
          rowsData = pdfedParseHtmlTableClipboard(html);
          if (rowsData && rowsData.length) {
            title = daExtractTableTitleFromHtml(html);
            break;
          }
        }
      }
    }
    if (!rowsData || !rowsData.length) {
      const plain = await navigator.clipboard.readText().catch(() => '');
      if (plain && plain.trim()) {
        rowsData = daSplitDelimitedText(plain);
      }
    }
    if (!rowsData || !rowsData.length || !rowsData.some(r => r.length > 1)) {
      toast('No table found on the clipboard — expected tab, comma, semicolon, or pipe-separated data', 'info');
      return;
    }
    daPasteTableFromClipboard(rowsData, title);
  } catch (err) {
    toast('Couldn\'t read the clipboard — click inside Data Arrangement and press Ctrl+V instead', 'info');
  }
}

function daWorkspaceRefreshVisibility() {
  const has = daState.datasets.length > 0;
  document.getElementById('daUploadZone').style.display = has ? 'none' : 'flex';
  document.getElementById('daWorkspace').style.display = has ? 'flex' : 'none';
  document.getElementById('daEmptyState').style.display = 'none';
  // Once a file's loaded the person needs edge-to-edge room to work, not
  // the title/intro card explaining what the upload zone does, so the
  // whole card tucks away (Add File/Clear All now live in the toolbar),
  // and the section padding itself tightens up for more usable width.
  const card = document.getElementById('daHeaderCard');
  if (card) card.style.display = has ? 'none' : '';
  // The "or / Create Blank Table" CTA that sits under the drop zone is
  // only relevant before any data exists — once a table is loaded it was
  // being left on screen above the tabs/toolbar, eating a big block of
  // dead vertical space. Tuck it away with everything else so the grid
  // starts right under the toolbar, Google-Sheets style.
  const blankDivider = document.getElementById('daBlankDivider');
  if (blankDivider) blankDivider.style.display = has ? 'none' : '';
  const blankBtn = document.getElementById('daBlankTableBtn');
  if (blankBtn) blankBtn.style.display = has ? 'none' : '';
  const section = document.getElementById('daSection');
  if (section) section.classList.toggle('da-working', has);
}

function daGetActive() {
  return daState.datasets.find(d => d.id === daState.activeId) || null;
}
