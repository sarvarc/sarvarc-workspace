// ─── MERGE PDF INTO DOCUMENT (connected workflow inside PDF Editor) ───
const pdfedMerge = { srcDoc: null, srcFile: null, pages: [] }; // pages: {pageNum, thumbUrl, selected}

function pdfedOpenMerge() {
  if (!pdfed.pages.length) { toast('Open a PDF in the editor first', 'error'); return; }
  pdfedMerge.srcDoc = null; pdfedMerge.srcFile = null; pdfedMerge.pages = [];
  document.getElementById('pdfedMergeTargetName').textContent = pdfed.file ? pdfed.file.name : 'this document';
  document.getElementById('pdfedMergeAfterLabel').textContent = pdfed.active + 1;
  document.getElementById('pdfedMergeStepChoose').style.display = '';
  document.getElementById('pdfedMergeStepPick').style.display = 'none';
  document.getElementById('pdfedMergeConfirmBtn').style.display = 'none';
  document.getElementById('pdfedMergePageGrid').innerHTML = '';
  const drop = document.getElementById('pdfedMergeDrop');
  drop.style.borderColor = '';
  document.querySelector('input[name="pdfedMergePos"][value="end"]').checked = true;
  document.getElementById('pdfedMergeOverlay').classList.add('open');
}

function pdfedCloseMerge() {
  document.getElementById('pdfedMergeOverlay').classList.remove('open');
  const inp = document.getElementById('pdfedMergeFileInput'); if (inp) inp.value = '';
}

function pdfedMergeFileDrop(e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  const f = e.dataTransfer.files[0];
  if (f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) pdfedMergeLoadFile(f);
  else toast('Please drop a PDF file', 'error');
}

function pdfedMergeFileSelect(e) {
  const f = e.target.files[0];
  if (f) pdfedMergeLoadFile(f);
  e.target.value = '';
}

async function pdfedMergeLoadFile(file) {
  toast('Loading ' + file.name + '...', 'info');
  try {
    const buf = await file.arrayBuffer();
    const doc = await sarvarcOpenPdfDocument(buf);
    pdfedMerge.srcDoc = doc;
    pdfedMerge.srcFile = file;
    pdfedMerge.pages = [];

    document.getElementById('pdfedMergeSrcName').textContent = file.name;
    document.getElementById('pdfedMergeSrcCount').textContent = doc.numPages;

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const scale = 160 / vp.width;
      const sv = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = sv.width; canvas.height = sv.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: sv }).promise;
      pdfedMerge.pages.push({ pageNum: i, thumbUrl: canvas.toDataURL('image/jpeg', 0.85), selected: true });
    }

    pdfedRenderMergePicker();
    document.getElementById('pdfedMergeStepChoose').style.display = 'none';
    document.getElementById('pdfedMergeStepPick').style.display = '';
    document.getElementById('pdfedMergeConfirmBtn').style.display = '';
    toast('Loaded ' + doc.numPages + ' page(s) from ' + file.name, 'success');
  } catch (err) {
    if (err && err.message === 'Password entry cancelled') { toast('Unlock cancelled', 'info'); return; }
    console.error('Merge file load failed:', err);
    toast('Could not read that PDF, it may be corrupted', 'error');
  }
}

function pdfedRenderMergePicker() {
  const grid = document.getElementById('pdfedMergePageGrid');
  grid.innerHTML = '';
  pdfedMerge.pages.forEach((pg, idx) => {
    const card = document.createElement('div');
    card.style.cssText = 'position:relative;border:2px solid ' + (pg.selected ? 'var(--blue)' : 'var(--border)') + ';border-radius:6px;overflow:hidden;cursor:pointer;background:var(--bg2);';
    card.dataset.idx = idx;
    card.innerHTML = `
      <img src="${pg.thumbUrl}" alt="Page ${pg.pageNum} thumbnail" style="width:100%;display:block;${pg.selected ? '' : 'opacity:0.4'}">
      <div style="position:absolute;top:4px;left:4px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;background:${pg.selected ? 'var(--blue)' : 'rgba(0,0,0,0.4)'};border:1.5px solid #fff">${pg.selected ? '✓' : ''}</div>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;text-align:center;padding:2px 0">${pg.pageNum}</div>
    `;
    card.onclick = () => { pg.selected = !pg.selected; pdfedRenderMergePicker(); };
    grid.appendChild(card);
  });
}

function pdfedMergeSelectAll(val) {
  pdfedMerge.pages.forEach(pg => pg.selected = val);
  pdfedRenderMergePicker();
}

async function pdfedConfirmMerge() {
  const selected = pdfedMerge.pages.filter(p => p.selected);
  if (!selected.length) { toast('Select at least one page to insert', 'error'); return; }
  const posMode = document.querySelector('input[name="pdfedMergePos"]:checked').value;
  const at = posMode === 'end' ? pdfed.pages.length : pdfed.active + 1;

  const newPages = selected.map(p => ({
    type: 'pdf', pageNum: p.pageNum, dataUrl: null, modified: false, edits: {}, textBlocks: [],
    label: (pdfedMerge.srcFile ? pdfedMerge.srcFile.name.replace(/\.pdf$/i, '') : 'Merged') + ', p' + p.pageNum,
    srcDoc: pdfedMerge.srcDoc
  }));

  pdfed.pages.splice(at, 0, ...newPages);
  pdfedCloseMerge();
  await pdfedBuildStrip();
  await pdfedGoto(at);
  state.stats.pages += newPages.length;
  updateStats();
  toast('✓ Merged ' + newPages.length + ' page(s) from ' + (pdfedMerge.srcFile ? pdfedMerge.srcFile.name : 'PDF') + ' into the document', 'success');
}

// Parse the contenteditable HTML into a list of block objects: {type, runs[], align}
// runs are {text, bold, italic, underline}. This avoids foreignObject/SVG rendering
// (which taints the canvas in most browsers and silently breaks export) and gives us
// full control over word-wrapping so text never overlaps itself or the page edges.
function pdfedParseBlankContent(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const blocks = [];
  let currentRuns = [];

  function getAlign(node) {
    return (node.style && node.style.textAlign) ? node.style.textAlign : null;
  }

  function walkInline(node, style) {
    if (node.nodeType === 3) { // text node
      if (node.textContent) currentRuns.push({ text: node.textContent, ...style });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { currentRuns.push({ text: '\n', ...style }); return; }
    const s = { ...style };
    if (tag === 'b' || tag === 'strong') s.bold = true;
    if (tag === 'i' || tag === 'em') s.italic = true;
    if (tag === 'u') s.underline = true;
    const styleAttr = node.getAttribute ? node.getAttribute('style') : null;
    if (styleAttr) {
      if (/font-weight:\s*(bold|[5-9]00)/i.test(styleAttr)) s.bold = true;
      if (/font-style:\s*italic/i.test(styleAttr)) s.italic = true;
      if (/text-decoration:[^;]*underline/i.test(styleAttr)) s.underline = true;
    }
    node.childNodes.forEach(c => walkInline(c, s));
  }

  function flushParagraph(align) {
    if (currentRuns.length) {
      blocks.push({ type: 'p', runs: currentRuns, align: align || 'left' });
      currentRuns = [];
    }
  }

  container.childNodes.forEach(node => {
    if (node.nodeType === 3) {
      if (node.textContent && node.textContent.trim()) currentRuns.push({ text: node.textContent });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2') {
      flushParagraph();
      const align = getAlign(node);
      walkInline(node, {});
      blocks.push({ type: tag, runs: currentRuns, align: align || 'left' });
      currentRuns = [];
    } else if (tag === 'div' || tag === 'p') {
      flushParagraph();
      const align = getAlign(node);
      walkInline(node, {});
      flushParagraph(align);
    } else if (tag === 'br') {
      currentRuns.push({ text: '\n' });
    } else {
      walkInline(node, {});
    }
  });
  flushParagraph();
  return blocks;
}

// Lays out parsed blocks onto a canvas context with proper word-wrapping so
// nothing overlaps, then draws them.
function pdfedDrawBlankContent(ctx, blocks, x0, y0, maxWidth, color) {
  let y = y0;
  blocks.forEach(block => {
    let fontSize = 30, baseBold = false;
    if (block.type === 'h1') { fontSize = 58; baseBold = true; }
    else if (block.type === 'h2') { fontSize = 40; baseBold = true; }
    const lineHeight = Math.round(fontSize * 1.5);

    // Tokenize runs into words/newlines, preserving formatting per word.
    const tokens = [];
    block.runs.forEach(run => {
      const text = run.text || '';
      const segments = text.split(/(\n)/);
      segments.forEach(seg => {
        if (seg === '\n') { tokens.push({ newline: true }); return; }
        if (seg === '') return;
        seg.split(/(\s+)/).forEach(tok => {
          if (tok === '') return;
          if (/^\s+$/.test(tok)) { tokens.push({ space: true, text: tok }); return; }
          tokens.push({ text: tok, bold: !!run.bold || baseBold, italic: !!run.italic, underline: !!run.underline });
        });
      });
    });

    // Wrap into lines.
    const lines = [];
    let line = [];
    let lineWidth = 0;
    tokens.forEach(tok => {
      if (tok.newline) { lines.push(line); line = []; lineWidth = 0; return; }
      const fontStr = (tok.italic ? 'italic ' : '') + (tok.bold ? 'bold ' : '') + fontSize + 'px Georgia, serif';
      ctx.font = fontStr;
      const w = ctx.measureText(tok.text).width;
      if (tok.space) {
        if (line.length) { line.push({ ...tok, width: w }); lineWidth += w; }
        return;
      }
      if (lineWidth + w > maxWidth && line.length) {
        // drop trailing space token before wrapping
        while (line.length && line[line.length - 1].space) line.pop();
        lines.push(line);
        line = []; lineWidth = 0;
      }
      line.push({ ...tok, width: w });
      lineWidth += w;
    });
    if (line.length) {
      while (line.length && line[line.length - 1].space) line.pop();
      lines.push(line);
    }

    lines.forEach(ln => {
      const totalWidth = ln.reduce((a, w) => a + w.width, 0);
      let cx = x0;
      if (block.align === 'center') cx = x0 + Math.max(0, (maxWidth - totalWidth) / 2);
      else if (block.align === 'right') cx = x0 + Math.max(0, maxWidth - totalWidth);
      ln.forEach(tok => {
        if (tok.space) { cx += tok.width; return; }
        const fontStr = (tok.italic ? 'italic ' : '') + (tok.bold ? 'bold ' : '') + fontSize + 'px Georgia, serif';
        ctx.font = fontStr;
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(tok.text, cx, y);
        if (tok.underline) {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, fontSize * 0.04);
          const uy = y + fontSize * 0.12;
          ctx.moveTo(cx, uy);
          ctx.lineTo(cx + tok.width, uy);
          ctx.stroke();
        }
        cx += tok.width;
      });
      y += lineHeight;
    });
    y += lineHeight * 0.45; // spacing between paragraphs/headings
  });
  return y;
}

async function pdfedRenderBlankPage(htmlContent, bg, mmW, mmH) {
  mmW = mmW > 0 ? mmW : 210;
  mmH = mmH > 0 ? mmH : 297;
  // Render at the same px/mm density the original A4 default used (1654px / 210mm)
  // so text size, padding, and layout stay visually consistent across page sizes.
  const RENDER_PXMM = 1654 / 210;
  const W = Math.max(1, Math.round(mmW * RENDER_PXMM));
  const H = Math.max(1, Math.round(mmH * RENDER_PXMM));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (htmlContent && htmlContent.trim()) {
    const isLight = (hex => {
      const x = (hex || '#ffffff').replace('#', '');
      const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 > 128;
    })(bg);
    const color = isLight ? '#111111' : '#eeeeee';
    const padX = 120, padY = 100;
    const maxWidth = W - padX * 2;
    try {
      const blocks = pdfedParseBlankContent(htmlContent);
      pdfedDrawBlankContent(ctx, blocks, padX, padY + 30, maxWidth, color);
    } catch (err) {
      console.error('Blank page text render failed:', err);
    }
  }
  // Downscale to the pixel size pdfedExport()'s mm math expects (px / 3.7795 = mm),
  // so the chosen page format (A4/A3/A5/Legal/Custom) exports at its true physical size.
  const EXPORT_PXMM = 3.7795;
  const eW = Math.max(1, Math.round(mmW * EXPORT_PXMM));
  const eH = Math.max(1, Math.round(mmH * EXPORT_PXMM));
  const out = document.createElement('canvas');
  out.width = eW; out.height = eH;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, 0, 0, eW, eH);
  // Plain canvas drawing only (no SVG foreignObject) — never taints the canvas,
  // so toDataURL always succeeds and the page reliably gets inserted.
  return out.toDataURL('image/png');
}

// ─── EXPORT ───
// pageIndices is an optional array of 0-based page indices to export, in order.
// Omitted/empty => export every page (keeps the batch queue and context-menu
// callers, which call pdfedExport() with no args, working exactly as before).
async function pdfedExport(pageIndices, password, suffixOverride, successLabel) {
  if (pdfed.pages.length === 0) { toast('No PDF loaded', 'error'); return; }
  if (pdfedLiveBlock(pageIndices)) return;
  // Finalize any image the user was still mid-drag/mid-resize on the currently
  // open page, so it lands in pg.placedImages before we read that array below.
  pdfedAutoStampPendingGhost();
  // Bake in any pending, not-yet-Applied canvas gradient/tint on the active
  // page first, so it doesn't silently drop out of the export (see
  // pdfedFinalizePendingCanvasTint).
  await pdfedFinalizePendingCanvasTint();
  // Make sure any Google Fonts used by placed-text boxes (Inter, Roboto,
  // Poppins, etc.) are actually loaded before we bake pixels below — on a
  // fresh page load, exporting immediately could otherwise rasterize with a
  // fallback system font for a frame before the real one is ready, which
  // would defeat the whole point of an exact match.
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e) {}
  const indices = (pageIndices && pageIndices.length) ? pageIndices : pdfed.pages.map((_, i) => i);
  const total = indices.length;
  showExportOverlay('Exporting your PDF…', total > 1 ? `Rendering page 1 of ${total}…` : 'Rendering page…');
  try {
    const {jsPDF} = window.jspdf;
    let pdf = null;
    for (let k = 0; k < total; k++) {
      const i = indices[k];
      const pg = pdfed.pages[i];
      if (!pg) continue;
      // Reserve the last 10% of the ring for the save step below, so the
      // bar never sits at a false 100% while jsPDF is still writing bytes.
      updateExportProgress((k / total) * 90, total > 1 ? `Rendering page ${k + 1} of ${total}…` : 'Rendering page…');
      // pdfedComposeThumb layers EVERYTHING this page has — baked PDF text
      // edits, placed images, tables, placed text boxes, and annotation
      // strokes — onto one flat raster using the exact same canvas draw
      // routine the on-screen thumbnail/preview uses. That guarantees the
      // exported page is visually identical to what you saw while editing:
      // same font, weight, size, color, and spacing, pixel for pixel.
      // Trade-off: placed text is now part of the page image, so it's no
      // longer separately selectable/searchable text in the PDF — chosen
      // deliberately over the previous vector-text path, which substituted
      // a built-in PDF font (Helvetica) and could never match the real
      // on-screen font's metrics exactly.
      const composed = await pdfedComposeThumbHiRes(pg, i, PDFED_EXPORT_SUPERSAMPLE);
      if (!composed || !composed.url) continue;
      const { url, iw, ih } = composed;
      // Different page origins rasterize at different densities (native
      // PDF pages render at 144 DPI, blank/inserted/table pages at 96
      // DPI) — use the density that page was ACTUALLY rendered at,
      // falling back to 96 DPI (3.7795 px/mm) only when untagged, so
      // every page comes out at its true physical size instead of
      // native PDF pages exporting ~1.5x too large next to others.
      // iw/ih here are the page's ORIGINAL pixel dimensions (not the
      // supersampled raster actually embedded below), so this mm math is
      // unaffected by PDFED_EXPORT_SUPERSAMPLE — only the pixel density of
      // the embedded image goes up, not the printed page size.
      const pxPerMm = pg._pxPerMm || 3.7795;
      const wmm = iw / pxPerMm, hmm = ih / pxPerMm;
      const ori = wmm > hmm ? 'landscape' : 'portrait';
      if (!pdf) {
        const pdfOpts = Object.assign({orientation:ori, unit:'mm', format:[wmm,hmm]}, sarvarcPdfEncryptionOpts(password));
        pdf = new jsPDF(pdfOpts);
      }
      else pdf.addPage([wmm,hmm], ori);
      pdf.setFillColor(255,255,255);
      pdf.rect(0,0,wmm,hmm,'F');
      pdf.addImage(url, 'PNG', 0, 0, wmm, hmm, '', 'FAST');
      // Text itself is already baked into the image above (pixel-exact
      // match to the editor, just at a much higher pixel density now);
      // this only adds back invisible clickable regions so links still
      // work in the downloaded PDF.
      pdfedAddPlacedTextLinkAnnotations(pdf, pg, wmm, iw);
    }
    if (!pdf) { hideExportOverlay(); toast('Nothing to export', 'error'); return; }
    updateExportProgress(95, 'Saving file…');
    const suffix = suffixOverride || ((pageIndices && pageIndices.length && pageIndices.length !== pdfed.pages.length) ? '_pages' : '_edited');
    const fname = (pdfed.file ? pdfed.file.name.replace(/\.pdf$/i,'') : 'edited') + suffix + '.pdf';
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    state.stats.exports++;
    updateStats();
    completeExportOverlay(total + (total > 1 ? ' pages exported' : ' page exported'), { module: 'pdf_editor', format: 'pdf' });
    toast(successLabel || ('Exported ' + total + ' pages' + (password ? ' (password protected)' : '')), 'success');
    pdfedQueueAutoContinueAfter();
  } catch(e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

// ─── EXPORT MODAL (format + page range picker + thumbnail preview) ─────────
let pdfedExportModalFmt = 'pdf';
let pdfedExportPagesMode = 'all';
let pdfedExportPreviewIdx = 0;
let pdfedExportLogoMode = 'normal'; // 'normal' | 'logo' — only used for docx exports

const PDFED_EXPORT_FORMAT_META = {
  pdf:  { name: 'PDF Document',      badge: 'Editable',    color: 'var(--blue)', bg: 'rgba(0,194,255,0.12)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
  csv:  { name: 'CSV',               badge: 'Table data',  color: '#14B8A6',     bg: 'rgba(20,184,166,0.15)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>' },
  xlsx: { name: 'Excel Spreadsheet', badge: 'Spreadsheet', color: '#22C55E',     bg: 'rgba(34,197,94,0.15)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="13" x2="12" y2="20"/></svg>' },
  docx: { name: 'Word Document',     badge: 'Editable',    color: '#818CF8',     bg: 'rgba(129,140,248,0.15)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16" x2="16" y2="16"/><line x1="8" y1="19" x2="13" y2="19"/></svg>' },
  image: { name: 'Image (PNG)',      badge: 'Picture',     color: '#F472B6',     bg: 'rgba(244,114,182,0.15)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  video: { name: 'Slideshow Clip',   badge: 'Presentation',color: '#FB923C',     bg: 'rgba(251,146,60,0.15)',
          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' },
};

async function pdfedOpenExportModal() {
  if (pdfed.pages.length === 0) { toast('No PDF loaded', 'error'); return; }
  pdfedAutoStampPendingGhost();
  await pdfedFinalizePendingCanvasTint();

  // Restore remembered format if the person opted in previously.
  let startFmt = 'pdf';
  try {
    const saved = JSON.parse(localStorage.getItem('sarvarcExportPrefs') || 'null');
    if (saved && saved.remember && PDFED_EXPORT_FORMAT_META[saved.fmt]) {
      startFmt = saved.fmt;
      document.getElementById('pdfedExportRemember').checked = true;
    } else {
      document.getElementById('pdfedExportRemember').checked = false;
    }
  } catch(e) {}

  sarvarcInitBrandCheckbox('pdfedExportBrandFilename');

  // Live clips cannot live inside a still format: default to the MP4 presentation and grey the rest out.
  const liveDoc = pdfedDocHasLive();
  if (liveDoc) startFmt = 'video';
  pdfedApplyExportFormat(startFmt);
  document.querySelectorAll('#pdfedExportTypeMenu .pdfed-export-menu-item').forEach(el => {
    el.classList.toggle('sel', el.dataset.fmt === startFmt);
    const off = liveDoc && el.dataset.fmt !== 'video';
    el.style.opacity = off ? '.4' : '';
    el.title = off ? 'This document has live clips, so it can only be downloaded as an MP4 presentation' : '';
  });

  // Logo/letterhead handling only applies to Word exports; always reset to
  // the safe default ("Normal") each time the modal is opened.
  pdfedApplyExportLogoMode('normal');

  document.getElementById('pdfedExportTotalPages').textContent = pdfed.pages.length;
  pdfedApplyExportPagesMode('all');
  document.querySelectorAll('#pdfedExportPagesMenu .pdfed-export-menu-item').forEach(el => el.classList.toggle('sel', el.dataset.mode === 'all'));
  const input = document.getElementById('pdfedExportRangeInput');
  input.value = '';
  input.style.display = 'none';
  document.getElementById('pdfedExportRangeError').style.display = 'none';

  pdfedExportPreviewIdx = Math.max(0, pdfed.active);
  pdfedExportUpdatePreview(pdfedExportPreviewIdx);

  // Password protection defaults to ON since most people exporting a PDF
  // want it protected — but it stays fully optional: unticking the box
  // exports a normal, unprotected PDF exactly as before. The password text
  // itself never carries over between sessions, only this default state.
  document.getElementById('pdfedExportPasswordToggle').checked = true;
  document.getElementById('pdfedExportPasswordInput').value = '';
  document.getElementById('pdfedExportPasswordInput').style.display = 'block';
  document.getElementById('pdfedExportPasswordHint').style.display = 'block';
  document.getElementById('pdfedExportPasswordError').style.display = 'none';

  pdfedCloseExportMenus();
  document.getElementById('pdfedExportOverlay2').classList.add('open');
}

function pdfedCloseExportModal() {
  document.getElementById('pdfedExportOverlay2').classList.remove('open');
  pdfedCloseExportMenus();
}

function pdfedCloseExportMenus() {
  document.getElementById('pdfedExportTypeMenu').classList.remove('open');
  document.getElementById('pdfedExportTypeSelect').classList.remove('open');
  document.getElementById('pdfedExportPagesMenu').classList.remove('open');
  document.getElementById('pdfedExportPagesSelect').classList.remove('open');
}

function pdfedApplyExportLogoMode(mode) {
  pdfedExportLogoMode = mode;
  document.querySelectorAll('#pdfedExportLogoOptions .pdfed-export-logo-option').forEach(el => el.classList.toggle('sel', el.dataset.mode === mode));
}

function pdfedExportPickLogoMode(mode, el) {
  pdfedApplyExportLogoMode(mode);
}

function pdfedToggleExportTypeMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('pdfedExportTypeMenu');
  const wasOpen = menu.classList.contains('open');
  pdfedCloseExportMenus();
  if (!wasOpen) {
    menu.classList.add('open');
    document.getElementById('pdfedExportTypeSelect').classList.add('open');
  }
}

function pdfedToggleExportPagesMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('pdfedExportPagesMenu');
  const wasOpen = menu.classList.contains('open');
  pdfedCloseExportMenus();
  if (!wasOpen) {
    menu.classList.add('open');
    document.getElementById('pdfedExportPagesSelect').classList.add('open');
  }
}

// Close any open dropdown when clicking elsewhere in the modal.
document.addEventListener('mousedown', function(e) {
  if (!e.target.closest('#pdfedExportTypeField') && !e.target.closest('#pdfedExportPagesField') && !e.target.closest('#pdfedExportLogoField')) {
    pdfedCloseExportMenus();
  }
});

function pdfedApplyExportFormat(fmt) {
  pdfedExportModalFmt = fmt;
  const meta = PDFED_EXPORT_FORMAT_META[fmt];
  document.getElementById('pdfedExportTypeIcon').innerHTML = meta.icon;
  document.getElementById('pdfedExportTypeIcon').style.background = meta.bg;
  document.getElementById('pdfedExportTypeIcon').style.color = meta.color;
  document.getElementById('pdfedExportTypeName').textContent = meta.name;
  const badge = document.getElementById('pdfedExportTypeBadge');
  badge.textContent = meta.badge;
  badge.style.background = meta.color;
  document.getElementById('pdfedExportCsvNote').style.display = (fmt === 'csv' || fmt === 'xlsx' || fmt === 'docx') ? 'block' : 'none';
  document.getElementById('pdfedExportPdfNote').style.display = (fmt === 'pdf') ? 'block' : 'none';
  document.getElementById('pdfedExportImageNote').style.display = (fmt === 'image') ? 'block' : 'none';
  document.getElementById('pdfedExportVideoNote').style.display = (fmt === 'video') ? 'block' : 'none';
  try { pdfedAnimUpdateExportWarn(fmt); } catch (e) {}
  // Logo/background-removal choice only makes sense for Word exports, since
  // that's the only format that crops a header band as a real image.
  document.getElementById('pdfedExportLogoField').style.display = (fmt === 'docx') ? 'block' : 'none';
  // Password protection only applies to the real PDF export path (jsPDF can
  // encrypt at generation time); other formats have no equivalent here.
  document.getElementById('pdfedExportPasswordField').style.display = (fmt === 'pdf') ? 'block' : 'none';
}

function pdfedToggleExportPassword() {
  const on = document.getElementById('pdfedExportPasswordToggle').checked;
  const input = document.getElementById('pdfedExportPasswordInput');
  const hint = document.getElementById('pdfedExportPasswordHint');
  input.style.display = on ? 'block' : 'none';
  hint.style.display = on ? 'block' : 'none';
  if (!on) {
    input.value = '';
    document.getElementById('pdfedExportPasswordError').style.display = 'none';
  } else {
    input.focus();
  }
}

function pdfedExportPasswordChanged() {
  document.getElementById('pdfedExportPasswordError').style.display = 'none';
}

function pdfedExportPickFormat(fmt, el) {
  if (fmt !== 'video' && pdfedDocHasLive()) { pdfedLiveBlock(); return; }
  pdfedApplyExportFormat(fmt);
  document.querySelectorAll('#pdfedExportTypeMenu .pdfed-export-menu-item').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  pdfedCloseExportMenus();
  // Slideshow Clip isn't a file the modal can hand over directly — it's an
  // interactive preview first. So picking it jumps straight into the preview
  // with its controls, instead of making the person also click "Export"
  // just to reach a screen that then makes them go find the real render
  // button. Nothing has been exported yet at this point, so this must never
  // touch the free-export gate or its "Export complete" messaging.
  if (fmt === 'video') {
    pdfedCloseExportModal();
    pdfedOpenSlideshow();
  }
}

function pdfedApplyExportPagesMode(mode) {
  pdfedExportPagesMode = mode;
  const total = pdfed.pages.length;
  document.getElementById('pdfedExportPagesName').textContent = (mode === 'custom') ? 'Custom range' : 'All pages (' + total + ')';
  const input = document.getElementById('pdfedExportRangeInput');
  input.style.display = (mode === 'custom') ? 'block' : 'none';
  if (mode !== 'custom') document.getElementById('pdfedExportRangeError').style.display = 'none';
}

function pdfedExportPickPages(mode, el) {
  pdfedApplyExportPagesMode(mode);
  document.querySelectorAll('#pdfedExportPagesMenu .pdfed-export-menu-item').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  pdfedCloseExportMenus();
  if (mode === 'custom') document.getElementById('pdfedExportRangeInput').focus();
}

function pdfedExportRangeInputChanged() {
  document.getElementById('pdfedExportRangeError').style.display = 'none';
}

async function pdfedExportUpdatePreview(idx) {
  const total = pdfed.pages.length;
  const img = document.getElementById('pdfedExportPreviewImg');
  const empty = document.getElementById('pdfedExportPreviewEmpty');
  document.getElementById('pdfedExportPreviewCount').textContent = (total ? (idx + 1) : 0) + ' / ' + total;
  document.getElementById('pdfedExportPreviewLabel').textContent = total ? ('Page ' + (idx + 1)) : 'Page —';
  document.getElementById('pdfedExportPrevBtn').disabled = (idx <= 0);
  document.getElementById('pdfedExportNextBtn').disabled = (idx >= total - 1);
  const pg = pdfed.pages[idx];
  if (!pg) { img.style.display = 'none'; empty.style.display = 'flex'; return; }
  // Compose the real page — placed text, tables, images, annotations and
  // all — the same way Export and the Slideshow Preview already do, instead
  // of showing the untouched original page underneath everything the person
  // actually added. Shares the slideshow's cache so this stays instant when
  // the two overlap on the same page.
  let url = pdfedSlideshow.cache[idx];
  if (!url) {
    try { url = await pdfedComposeThumb(pg, idx); pdfedSlideshow.cache[idx] = url; } catch (e) {}
  }
  if (pdfedExportPreviewIdx !== idx) return; // stepped to another page before this resolved
  if (url) {
    img.src = url;
    img.style.display = 'block';
    empty.style.display = 'none';
  } else {
    img.style.display = 'none';
    empty.style.display = 'flex';
  }
}

function pdfedExportPreviewStep(dir) {
  const total = pdfed.pages.length;
  const next = pdfedExportPreviewIdx + dir;
  if (next < 0 || next >= total) return;
  pdfedExportPreviewIdx = next;
  pdfedExportUpdatePreview(next);
}
