// ── Converter → Workspace import handoff ───────────────────────
// The File Converter tools (sarvarc.com) and Workspace (sarvarc.com/workspace)
// are the same origin, so a converter result can be handed over without any
// server: the converter stashes the result blob in IndexedDB and redirects
// here with ?import=pending. This reads it, routes it into the right module
// by wsType — each destination matches what the content actually *is*, not
// just the file format it happens to be saved as:
//   'pdf'   → PDF Editor (the file itself is a PDF)
//   'table' → Data Arrangement (rows/columns — CSV, spreadsheet exports, etc.)
//   'text'  → the Workspace document, as an editable text block on its own
//             page (written/prose content: case-converted text, JSON/XML
//             pretty-printed output, and similar — the same "drop a text
//             block onto the canvas" pattern already used when Diagrams &
//             Graphs pushes its Smart Analysis write-up over)
// then clears both the URL flag and the stored record so a refresh or
// back-nav can't re-import it.
const WS_HANDOFF_DB = 'sarvarc-handoff';
const WS_HANDOFF_STORE = 'files';
const WS_HANDOFF_KEY = 'pending';

function wsHandoffOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WS_HANDOFF_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(WS_HANDOFF_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Drops plain text onto the Workspace document as an editable, wrapped text
// block on a brand-new page — the canvas destination for "content written"
// (as opposed to tabular data, which goes to Data Arrangement instead).
// Mirrors dgInsertAnalysisIntoWorkspace's "new page" path so a Converter
// hand-off behaves the same way an in-app text push already does.
async function wsInsertTextIntoWorkspace(text, name) {
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') return false;
  if (!text || !text.trim()) return false;

  const mmW = 210, mmH = 297, EXPORT_PXMM = 3.7795;
  const eW = Math.round(mmW * EXPORT_PXMM), eH = Math.round(mmH * EXPORT_PXMM);
  const noWorkspaceYet = !pdfed.pages || pdfed.pages.length === 0;

  const makeBlankPage = () => {
    const bg = document.createElement('canvas');
    bg.width = eW; bg.height = eH;
    const bctx = bg.getContext('2d');
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, eW, eH);
    return { type: 'blank', dataUrl: bg.toDataURL('image/png'), modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], label: 'File Converter', bgColor: '#ffffff', pageMM: [mmW, mmH] };
  };

  const placeTextOnPage = (pageIdx) => {
    const pg = pdfed.pages[pageIdx];
    if (!pg.placedTexts) pg.placedTexts = [];
    pdfedPlacedTextSeq = (typeof pdfedPlacedTextSeq === 'number' ? pdfedPlacedTextSeq : 0) + 1;
    pg.placedTexts.push({
      id: 'ptxt_' + pdfedPlacedTextSeq,
      text: text,
      x: 60, y: 70, w: eW - 120,
      fontSize: 15,
      fontFamily: 'Inter',
      color: '#101820',
      bold: false, italic: false, underline: false, align: 'left',
      locked: false,
      zIndex: pdfedNextZ(pg)
    });
  };

  try {
    let idx;
    if (noWorkspaceYet) {
      pdfed.pages = [makeBlankPage()];
      pdfed.pdfDoc = null;
      pdfed.file = { name: name || 'File Converter' };
      ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
      const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
      const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
      if (state && state.stats) { state.stats.pdfs++; state.stats.pages++; }
      if (typeof updateStats === 'function') updateStats();
      idx = 0;
      placeTextOnPage(0);
      navigate('pdfeditor');
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      if (typeof pdfedGoto === 'function') await pdfedGoto(0);
      setTimeout(() => { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 120);
    } else {
      pdfed.pages.push(makeBlankPage());
      idx = pdfed.pages.length - 1;
      if (state && state.stats) { state.stats.pages++; }
      if (typeof updateStats === 'function') updateStats();
      placeTextOnPage(idx);
      navigate('pdfeditor');
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      if (typeof pdfedGoto === 'function') await pdfedGoto(idx);
      setTimeout(() => { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 120);
    }
    if (typeof pdfedMarkModified === 'function') pdfedMarkModified(idx);
    setTimeout(() => { if (typeof pdfedRenderPlacedTexts === 'function') pdfedRenderPlacedTexts(pdfed.active); }, 140);
    return true;
  } catch (e) {
    console.error('[wsInsertTextIntoWorkspace] failed', e);
    return false;
  }
}

async function wsCheckIncomingImport() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('import') !== 'pending') return;

  // Strip the flag from the address bar right away so a refresh or a
  // browser back/forward doesn't try to re-run the import.
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);

  try {
    const db = await wsHandoffOpenDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(WS_HANDOFF_STORE, 'readwrite');
      const store = tx.objectStore(WS_HANDOFF_STORE);
      const getReq = store.get(WS_HANDOFF_KEY);
      getReq.onsuccess = () => { store.delete(WS_HANDOFF_KEY); resolve(getReq.result); };
      getReq.onerror = () => reject(getReq.error);
    });

    if (!record || !record.blob) {
      if (typeof toast === 'function') toast('Nothing to bring in, that link was already used.', 'info');
      return;
    }

    const file = new File([record.blob], record.name || 'imported-file', { type: record.blob.type });

    if (record.wsType === 'pdf' && typeof navigate === 'function' && typeof pdfedLoadFileObject === 'function') {
      navigate('pdfeditor');
      await pdfedLoadFileObject(file);
      if (typeof toast === 'function') toast('Brought in "' + file.name + '" from File Converter', 'success');
    } else if (record.wsType === 'table' && typeof navigate === 'function' && typeof daIngestFiles === 'function') {
      navigate('dataarrange');
      await daIngestFiles([file]);
      if (typeof toast === 'function') toast('Brought in "' + file.name + '" from File Converter', 'success');
    } else if (record.wsType === 'text' && typeof wsInsertTextIntoWorkspace === 'function') {
      const text = await file.text();
      const ok = await wsInsertTextIntoWorkspace(text, record.name);
      if (ok) {
        if (typeof toast === 'function') toast('Brought in "' + file.name + '" from File Converter', 'success');
      } else if (typeof toast === 'function') {
        toast('Couldn\'t bring "' + file.name + '" into the Workspace document.', 'error');
      }
    } else {
      if (typeof toast === 'function') toast('Couldn\'t tell where "' + file.name + '" should go.', 'error');
    }
  } catch (e) {
    console.error('[Workspace import] failed', e);
    if (typeof toast === 'function') toast('Couldn\'t bring in the file from Converter, try downloading it instead.', 'error');
  }
}

// Runs after the boot()/restoreLastSection() listener above (registered
// earlier in the document, so it fires first) — that way, if there's a
// pending import, navigate() here correctly overrides whatever section
// localStorage would otherwise have restored.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wsCheckIncomingImport);
} else {
  wsCheckIncomingImport();
}
