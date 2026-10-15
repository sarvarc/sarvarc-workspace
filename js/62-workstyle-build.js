// ─── WORKSTYLE, STEP 2 + 3: BUILD IN A SAVED STYLE, SIDE BY SIDE ────────────
// Takes a style saved by js/59-workstyle.js (or read from a PDF by js/60) and
// builds it as real, editable pages in the PDF Editor while the person watches:
//   LEFT   the reference, exactly as it was saved
//   RIGHT  Kadessa's copy, built live, with her cursor moving to each spot
//
// Two ways to build:
//   copy      the reference's own words, so the result is an identical document
//   template  new words in the same look. The caller passes `fill`, a list of
//             { role, text } for text and { role:'table', headers?, rows } for
//             tables, in reading order per role. Anything without new words is
//             left out, image slots stay. Text that runs longer than the
//             original pushes what is below it down (the footer stays put).
//
// Order of work (so the animation can never leave a half-built document):
//   1. plan   percent positions in the style -> pixels for the page size
//   2. commit the real pages go into the editor right away (one undo step)
//   3. play   the split screen replays the build as a visual on top
// Skip or Close only stops the replay. The pages are already in the editor.
//
// Honest limits: pictures are never copied (an image slot gets the Brand Kit
// logo for a logo slot, or a labelled placeholder); lines, boxes and shapes
// are not measured by Workstyle yet, so they are not rebuilt; a background
// picture becomes its main color.

const WSB_PX_PER_MM = 3.7795;
const WSB_NAMES = { title: 'the title', heading: 'a heading', subheading: 'the subheading', body: 'the body text',
  caption: 'a caption', footer: 'the footer', table: 'the table', logo: 'the logo', image: 'an image slot' };
let wsbCtl = null; // the build being replayed right now, if any

function wsbPxFor(mm) { return Math.max(1, Math.round((Number(mm) || 0) * WSB_PX_PER_MM)); }
function wsbR(n, d) { const k = Math.pow(10, d === undefined ? 1 : d); return Math.round((Number(n) || 0) * k) / k; }
function wsbSleepRaw(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function wsbReduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
function wsbFontCss(fam) { return (typeof pdfedFontCss === 'function') ? pdfedFontCss(fam) : ('"' + fam + '", sans-serif'); }

// A small labelled stand-in for a picture the style cannot carry.
const wsbPlaceholderCache = {};
function wsbPlaceholder(label) {
  if (wsbPlaceholderCache[label]) return wsbPlaceholderCache[label];
  try {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#eef2f6'; x.fillRect(0, 0, 320, 200);
    x.setLineDash([10, 8]); x.lineWidth = 3; x.strokeStyle = '#9aa7b5'; x.strokeRect(6, 6, 308, 188);
    x.fillStyle = '#6b7a89'; x.font = '600 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 160, 100);
    wsbPlaceholderCache[label] = c.toDataURL('image/png');
  } catch (e) { wsbPlaceholderCache[label] = ''; }
  return wsbPlaceholderCache[label];
}
function wsbBrandLogo() { try { const k = (typeof bkLoad === 'function') ? bkLoad() : null; return (k && k.logo) ? k.logo : null; } catch (e) { return null; } }

// ─── 1. PLAN ─────────────────────────────────────────────────────────────────
function wsbCellStyles(it, cells) {
  const rows = cells.length, cols = cells[0].length;
  const sameCols = cols === (it.cols || cols);
  const pick = function (arr, single, c) { return (arr && arr[c]) ? arr[c] : (single || null); };
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let st;
      if (r === 0 && it.headerRow) st = pick(it.headerCells, it.headerCell, c);
      else if (r === rows - 1 && rows > 2 && (it.lastRowCells || it.lastRowCell)) st = pick(it.lastRowCells, it.lastRowCell, c);
      else if (it.zebra && (r % 2 === 0)) {
        st = pick(it.altCells, null, c);
        if (!st) { const b = pick(it.bodyCells, it.bodyCell, c); st = Object.assign({}, b || {}, { fill: (b && b.fill) ? b.fill : 'rgba(0,0,0,0.05)' }); }
      } else st = pick(it.bodyCells, it.bodyCell, c);
      st = Object.assign({}, st || {});
      if (sameCols && it.colAlign && it.colAlign[c]) st.align = it.colAlign[c];
      row.push(st);
    }
    out.push(row);
  }
  return out;
}

function wsbMeasureText(text, fam, size, bold, italic, w, fallbackH) {
  try { if (typeof pdfedKadessaMeasure === 'function') return pdfedKadessaMeasure(text, fam, size, bold, italic, w) || fallbackH; } catch (e) { /* fall through */ }
  return fallbackH;
}

function wstyleBuildPlan(style, fill) {
  const template = Array.isArray(fill) && fill.length > 0;
  const queues = {};
  const given = {};
  if (template) {
    fill.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      const r = String(f.role || '').trim().toLowerCase();
      if (!r) return;
      (queues[r] = queues[r] || []).push(f);
      given[r] = (given[r] || 0) + 1;
    });
  }
  const fonts = {};
  const have = {};
  const pages = [];
  let skipped = 0;

  (style.pages || []).forEach(function (sp, pi) {
    const mm = (sp.pageMM && sp.pageMM.length === 2) ? sp.pageMM : [210, 297];
    const W = wsbPxFor(mm[0]), H = wsbPxFor(mm[1]);
    const items = [];
    let shift = 0;
    (sp.items || []).forEach(function (it, si) {
      have[it.role] = (have[it.role] || 0) + 1;
      const pinned = it.role === 'footer';
      const x = (it.xPct || 0) / 100 * W, w = (it.wPct || 0) / 100 * W;
      const baseY = (it.yPct || 0) / 100 * H, oldH = (it.hPct || 0) / 100 * H;
      const y = baseY + (pinned ? 0 : shift);

      if (it.kind === 'text') {
        let text = String(it.text || '');
        if (template) {
          const f = (queues[it.role] || []).shift();
          text = f ? String(f.text == null ? '' : f.text).trim() : '';
          if (!text) { skipped++; return; }
        }
        const fs = (it.sizePct || 3) / 100 * W, fam = it.fontFamily || 'Inter';
        fonts[fam] = true;
        let h = oldH;
        if (template) {
          // Compare like with like: the new words and the original words, measured the same way.
          const was = wsbMeasureText(String(it.text || ''), fam, fs, it.bold, it.italic, w, oldH);
          h = Math.max(oldH * 0.5, wsbMeasureText(text, fam, fs, it.bold, it.italic, w, oldH));
          if (!pinned && h - was > 3) shift += (h - was);
        }
        items.push({ kind: 'text', src: si, role: it.role, x: x, y: y, w: w, h: h, fontSize: fs, sizePct: it.sizePct || 3,
          fontFamily: fam, color: it.color || '#111111', gradient: it.gradient || null, bold: !!it.bold, italic: !!it.italic,
          underline: !!it.underline, align: it.align || 'left', opacity: (it.opacity === undefined || it.opacity === null) ? 1 : it.opacity, text: text });
        return;
      }

      if (it.kind === 'table') {
        let cells = null;
        if (template) {
          const f = (queues.table || []).shift();
          if (!f) { skipped++; return; }
          const hdr = Array.isArray(f.headers) ? f.headers.map(function (v) { return String(v == null ? '' : v); }) : null;
          const body = (Array.isArray(f.rows) ? f.rows : []).map(function (r) { return Array.isArray(r) ? r.map(function (v) { return String(v == null ? '' : v); }) : []; });
          cells = hdr ? [hdr].concat(body) : body;
          const nc = Math.max.apply(null, cells.map(function (r) { return r.length; }).concat([1]));
          cells = cells.map(function (r) { const o = r.slice(); while (o.length < nc) o.push(''); return o; });
          if (!cells.length) { skipped++; return; }
        } else {
          cells = Array.isArray(it.cells) && it.cells.length ? it.cells : null;
          if (!cells) {
            const rr = Math.max(2, it.rows || 2), cc = Math.max(1, it.cols || 2);
            cells = []; for (let r = 0; r < rr; r++) { const row = []; for (let c = 0; c < cc; c++) row.push(r === 0 ? 'Heading' : ''); cells.push(row); }
          }
        }
        const cols = cells[0].length, rows = cells.length;
        const totalW = w;
        let colWidths;
        if (it.colPct && it.colPct.length === cols) colWidths = it.colPct.map(function (p) { return p / 100 * totalW; });
        else colWidths = new Array(cols).fill(totalW / cols);
        const fs = (it.sizePct || 3) / 100 * W, fam = it.fontFamily || 'Inter';
        fonts[fam] = true;
        const hdrH = ((it.rowHPct && it.rowHPct[0]) || 4) / 100 * H;
        const bodyH = (it.bodyRowHPct || (it.rowHPct && it.rowHPct[1]) || 4) / 100 * H;
        const rowHeights = [];
        for (let r = 0; r < rows; r++) {
          let rh = (template || !it.rowHPct || it.rowHPct[r] === undefined) ? (r === 0 && it.headerRow ? hdrH : bodyH) : it.rowHPct[r] / 100 * H;
          rowHeights.push(rh);
        }
        if (template && typeof pdfedKadessaComputeTableLayout === 'function') {
          try {
            const lay = pdfedKadessaComputeTableLayout(cells, fam, fs, false, totalW);
            for (let r = 0; r < rows; r++) rowHeights[r] = Math.max(rowHeights[r], (lay.rowHeights && lay.rowHeights[r]) || 0);
          } catch (e) { /* keep saved heights */ }
        }
        let th = rowHeights.reduce(function (a, b) { return a + b; }, 0);
        const room = H * 0.96 - y;
        if (template && th > room && room > H * 0.1) { const k = room / th; for (let r = 0; r < rows; r++) rowHeights[r] *= k; th = room; }
        const cellStyles = wsbCellStyles(it, cells);
        if (template && th > oldH + 3 && !pinned) shift += (th - oldH);
        items.push({ kind: 'table', src: si, role: 'table', x: x, y: y, w: totalW, h: th, rows: rows, cols: cols,
          colWidths: colWidths, rowHeights: rowHeights, fontSize: fs, sizePct: it.sizePct || 3, fontFamily: fam,
          headerRow: !!it.headerRow, cells: cells, cellStyles: cellStyles });
        return;
      }

      // image slot
      const isLogo = it.role === 'logo';
      const brand = isLogo ? wsbBrandLogo() : null;
      items.push({ kind: 'image', src: si, role: it.role, x: x, y: y, w: w, h: oldH, dataUrl: brand || wsbPlaceholder(isLogo ? 'Logo' : 'Image'),
        brand: !!brand, opacity: (it.opacity === undefined || it.opacity === null) ? 1 : it.opacity });
    });
    items.forEach(function (i) { i.xPct = wsbR(i.x / W * 100, 3); i.yPct = wsbR(i.y / H * 100, 3); i.wPct = wsbR(i.w / W * 100, 3); i.hPct = wsbR(i.h / H * 100, 3); });
    pages.push({ index: pi, mmW: mm[0], mmH: mm[1], W: W, H: H, ratio: W / H, bg: sp.bg || { mode: 'solid', color1: '#ffffff' }, items: items });
  });

  if (template) {
    const matched = Object.keys(given).some(function (r) { return have[r]; });
    if (!matched) {
      const mine = Object.keys(have).map(function (r) { return have[r] + ' ' + r; }).join(', ');
      throw new Error('none of the roles you gave match this style. It has: ' + mine);
    }
  }
  return { name: style.name, template: template, pages: pages, fonts: Object.keys(fonts), skipped: skipped };
}

// ─── 2. COMMIT: the real, editable pages ─────────────────────────────────────
function wsbEnsureEditorOpen() {
  try {
    if (typeof unifiedActiveSection === 'function' && unifiedActiveSection() !== 'pdfeditor' && typeof navigate === 'function') navigate('pdfeditor');
  } catch (e) { /* the editor is probably already showing */ }
}

async function wsbCommit(plan) {
  wsbEnsureEditorOpen();
  for (let i = 0; i < plan.fonts.length; i++) { try { await pdfedKadessaEnsureFont(plan.fonts[i]); } catch (e) { /* default font */ } }
  const isNewDoc = !pdfed.pages.length;
  const at = isNewDoc ? 0 : (pdfed.active >= 0 ? pdfed.active : pdfed.pages.length - 1) + 1;
  const newPages = [];
  let bgNote = '';

  for (let pi = 0; pi < plan.pages.length; pi++) {
    const P = plan.pages[pi];
    const bg = P.bg || {};
    const c1 = /^#[0-9a-fA-F]{6}$/.test(bg.color1 || '') ? bg.color1 : '#ffffff';
    const url = await pdfedRenderBlankPage('', c1, P.mmW, P.mmH);
    const pg = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [],
      label: 'Workstyle page', bgColor: c1, pageMM: [P.mmW, P.mmH] };
    if (bg.mode === 'gradient' && /^#[0-9a-fA-F]{6}$/.test(bg.color2 || '')) {
      const angle = bg.direction === 'horizontal' ? 90 : (bg.direction === 'diagonal' ? 135 : 180);
      try {
        await pdfedBakeCanvasTintOntoPage(pg, { mode: 'gradient', color1: c1, color2: bg.color2, angle: angle, opacity: 100,
          imageDataUrl: null, imageFit: (typeof pdfedCanvasTintState !== 'undefined' && pdfedCanvasTintState) ? pdfedCanvasTintState.imageFit : undefined });
      } catch (e) { bgNote = 'The gradient background could not be baked, so the main color was used. '; }
    } else if (bg.mode === 'image') bgNote = 'The reference had a background picture, so its main color was used. ';

    P.items.forEach(function (it) {
      if (it.kind === 'text') {
        const t = { id: 'ptxt_' + (++pdfedPlacedTextSeq), text: it.text, x: wsbR(it.x), y: wsbR(it.y), w: wsbR(it.w),
          fontSize: wsbR(it.fontSize, 2), fontFamily: it.fontFamily, color: it.color, bold: it.bold, italic: it.italic,
          underline: it.underline, align: it.align, locked: false, zIndex: pdfedNextZ(pg) };
        if (it.opacity !== 1) t.opacity = it.opacity;
        if (it.gradient) t.gradient = it.gradient;
        pg.placedTexts.push(t);
      } else if (it.kind === 'table') {
        pg.placedTables.push({ id: 'tbl_' + (++pdfedTableSeq), x: Math.round(it.x), y: Math.round(it.y), rows: it.rows, cols: it.cols,
          colWidths: it.colWidths.map(function (v) { return wsbR(v, 2); }), rowHeights: it.rowHeights.map(function (v) { return wsbR(v, 2); }),
          fontSize: wsbR(it.fontSize, 2), fontFamily: it.fontFamily, headerRow: it.headerRow, cells: it.cells, cellStyles: it.cellStyles,
          locked: false, zIndex: pdfedNextZ(pg) });
      } else if (it.dataUrl) {
        pdfedAnnotState.placedImgSeq++;
        const im = { id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: it.dataUrl, x: wsbR(it.x), y: wsbR(it.y), w: wsbR(it.w), h: wsbR(it.h),
          locked: false, zIndex: pdfedNextZ(pg), kind: 'image' };
        if (it.opacity !== 1) im.opacity = it.opacity;
        pg.placedImages.push(im);
      }
    });
    newPages.push(pg);
  }

  pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(newPages));
  if (isNewDoc) {
    pdfed.pdfDoc = null;
    pdfed.file = { name: 'Untitled Document' };
    ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(function (id) {
      const el = document.getElementById(id); if (el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
    const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
    const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
    state.stats.pdfs++;
  }
  document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
  state.stats.pages += newPages.length;
  updateStats();
  await pdfedBuildStrip();
  await pdfedGoto(at);
  if (isNewDoc) { setTimeout(pdfedZoomFit, 50); if (typeof pdfedScheduleAutoCollapse === 'function') pdfedScheduleAutoCollapse(); }

  pushKadessaAppHistory({
    label: 'Build in work style (Kadessa)',
    undo: async function () {
      if (pdfed.pages.length <= newPages.length) { toast('Cannot remove last page', 'error'); return; }
      pdfed.pages.splice(pdfed.pages.indexOf(newPages[0]), newPages.length);
      if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
      await pdfedBuildStrip(); await pdfedGoto(pdfed.active);
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
      toast('Built pages removed', 'info');
    },
    redo: async function () {
      pdfed.pages.splice.apply(pdfed.pages, [Math.min(at, pdfed.pages.length), 0].concat(newPages));
      await pdfedBuildStrip(); await pdfedGoto(Math.min(at, pdfed.pages.length - 1));
      document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
    }
  });
  return { at: at, pages: newPages.length, bgNote: bgNote };
}

// ─── 3. PLAY: split screen + Kadessa's cursor ────────────────────────────────
function wsbEl(tag, cls, css) { const e = document.createElement(tag); if (cls) e.className = cls; if (css) e.style.cssText = css; return e; }

function wsbBoxCss(it) { return 'left:' + it.xPct + '%;top:' + it.yPct + '%;width:' + it.wPct + '%;'; }

function wsbMakeItem(it, final) {
  let e;
  if (it.kind === 'text') {
    e = wsbEl('div', 'wsb-el wsb-t', wsbBoxCss(it) + 'font:' + (it.italic ? 'italic ' : '') + (it.bold ? '700 ' : '400 ') + it.sizePct + 'cqw/1.25 ' + wsbFontCss(it.fontFamily) +
      ';color:' + it.color + ';text-align:' + it.align + ';opacity:' + it.opacity + (it.underline ? ';text-decoration:underline' : ''));
    e.textContent = final ? it.text : '';
  } else if (it.kind === 'table') {
    e = wsbEl('div', 'wsb-el wsb-tb', wsbBoxCss(it) + 'height:' + it.hPct + '%;grid-template-columns:' + it.colWidths.map(function (v) { return v + 'fr'; }).join(' ') +
      ';grid-template-rows:' + it.rowHeights.map(function (v) { return v + 'fr'; }).join(' ') + ';font:' + it.sizePct + 'cqw ' + wsbFontCss(it.fontFamily) + ';color:#222');
    it.cells.forEach(function (row, r) {
      row.forEach(function (txt, c) {
        const st = (it.cellStyles[r] && it.cellStyles[r][c]) || {};
        const cell = wsbEl('div', 'wsb-c', 'text-align:' + (st.align || 'left') + ';justify-content:' + (st.align === 'right' ? 'flex-end' : st.align === 'center' ? 'center' : 'flex-start') +
          (st.bold ? ';font-weight:700' : '') + (st.italic ? ';font-style:italic' : '') + (st.color ? ';color:' + st.color : '') + (st.fill ? ';background:' + st.fill : '') +
          (st.topBorder ? ';border-top:2px solid rgba(10,25,45,.55)' : ''));
        cell.dataset.r = r; cell.textContent = txt;
        if (!final) cell.style.visibility = 'hidden';
        e.appendChild(cell);
      });
    });
  } else {
    e = wsbEl('div', 'wsb-el wsb-im', wsbBoxCss(it) + 'height:' + it.hPct + '%;opacity:' + it.opacity);
    if (it.brand && it.dataUrl) { const im = wsbEl('img'); im.src = it.dataUrl; im.alt = ''; e.appendChild(im); e.classList.add('brand'); }
    else e.textContent = it.role === 'logo' ? 'Logo' : 'Image';
  }
  if (!final) e.style.visibility = 'hidden';
  return e;
}

function wsbBackground(bg) {
  bg = bg || {};
  if (bg.mode === 'gradient' && bg.color2) {
    const a = bg.direction === 'horizontal' ? 90 : (bg.direction === 'diagonal' ? 135 : 180);
    return 'linear-gradient(' + a + 'deg,' + bg.color1 + ',' + bg.color2 + ')';
  }
  return bg.color1 || '#ffffff';
}

function wsbFit(root) {
  const ar = Number(root.dataset.ar) || 0.707;
  const panes = root.querySelectorAll('.wsb-pane');
  panes.forEach(function (pn) {
    const availH = Math.max(120, pn.clientHeight - 34);
    const availW = Math.max(100, pn.clientWidth - 8);
    const w = Math.min(availW, availH * ar);
    const pg = pn.querySelector('.wsb-page');
    if (pg) { pg.style.width = w + 'px'; pg.style.height = (w / ar) + 'px'; }
  });
}

async function wsbPlay(refPlan, newPlan, opts) {
  opts = opts || {};
  if (wsbCtl) { try { wsbCtl.close(); } catch (e) { /* ignore */ } }
  const ctl = { speed: 1, skipped: false, closed: false, done: false, instant: wsbReduced() };
  wsbCtl = ctl;

  const root = wsbEl('div', 'wsb');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Kadessa is building your document');
  root.innerHTML =
    '<div class="wsb-top"><div class="wsb-title"></div><div class="wsb-prog" aria-hidden="true"><i></i></div>' +
    '<button type="button" class="wsb-btn wsb-speed" aria-label="Change speed">Speed x1</button>' +
    '<button type="button" class="wsb-btn primary wsb-skip">Skip</button>' +
    '<button type="button" class="wsb-btn wsb-x" aria-label="Close">Close</button></div>' +
    '<div class="wsb-panes">' +
      '<section class="wsb-pane"><h5>Reference</h5><div class="wsb-page wsb-ref"></div></section>' +
      '<section class="wsb-pane"><h5>Kadessa is building</h5><div class="wsb-page wsb-new"></div></section>' +
    '</div><div class="wsb-foot" aria-live="polite"></div>';
  document.body.appendChild(root);
  const $ = function (s) { return root.querySelector(s); };
  const title = $('.wsb-title'), prog = $('.wsb-prog i'), foot = $('.wsb-foot'), skipBtn = $('.wsb-skip');
  const speedBtn = $('.wsb-speed'), refPg = $('.wsb-ref'), newPg = $('.wsb-new');

  ctl.close = function () {
    if (ctl.closed) return; ctl.closed = true; ctl.skipped = true;
    window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey);
    if (root.parentNode) root.parentNode.removeChild(root);
    if (wsbCtl === ctl) wsbCtl = null;
  };
  const onResize = function () { wsbFit(root); };
  const onKey = function (e) { if (e.key === 'Escape') ctl.close(); };
  window.addEventListener('resize', onResize); document.addEventListener('keydown', onKey);
  $('.wsb-x').onclick = ctl.close;
  speedBtn.onclick = function () { ctl.speed = ctl.speed === 1 ? 2 : (ctl.speed === 2 ? 4 : 1); speedBtn.textContent = 'Speed x' + ctl.speed; };
  skipBtn.onclick = function () { if (ctl.done) ctl.close(); else ctl.skipped = true; };
  skipBtn.focus();

  const sleep = function (ms) { return (ctl.skipped || ctl.instant) ? Promise.resolve() : wsbSleepRaw(ms / ctl.speed); };
  const say = function (m) { foot.textContent = m; };
  const total = newPlan.pages.reduce(function (n, p) { return n + p.items.length; }, 0) || 1;
  let doneCount = 0;
  const tick = function () { prog.style.width = Math.min(100, Math.round(++doneCount / total * 100)) + '%'; };

  for (let pi = 0; pi < newPlan.pages.length && !ctl.closed; pi++) {
    const NP = newPlan.pages[pi], RP = refPlan.pages[pi] || NP;
    root.dataset.ar = NP.ratio; root.style.setProperty('--ar', NP.ratio);
    title.textContent = 'Building "' + newPlan.name + '"' + (newPlan.pages.length > 1 ? ', page ' + (pi + 1) + ' of ' + newPlan.pages.length : '');
    refPg.innerHTML = ''; newPg.innerHTML = '';
    newPg.style.background = wsbBackground(NP.bg);
    refPg.style.background = wsbBackground(RP.bg);
    const refEls = {};
    RP.items.forEach(function (it) { const e = wsbMakeItem(it, true); refPg.appendChild(e); refEls[it.src] = e; });
    const cursor = wsbEl('div', 'wsb-cursor');
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 2l16 9-7 2-3 7z" fill="#00c2ff" stroke="#001018" stroke-width="1.4" stroke-linejoin="round"/></svg><span>Kadessa</span>';
    cursor.style.left = '50%'; cursor.style.top = '-6%';
    newPg.appendChild(cursor);
    wsbFit(root);
    await sleep(500);

    const moveTo = async function (xp, yp, ms) {
      cursor.style.transitionDuration = ((ctl.skipped || ctl.instant) ? 0 : (ms || 520) / ctl.speed) + 'ms';
      cursor.style.left = xp + '%'; cursor.style.top = yp + '%';
      await sleep((ms || 520) + 80);
    };

    for (let k = 0; k < NP.items.length && !ctl.skipped && !ctl.closed; k++) {
      const it = NP.items[k];
      const e = wsbMakeItem(it, false);
      newPg.insertBefore(e, cursor);
      const ref = refEls[it.src];
      if (ref) ref.classList.add('hot');
      const nm = WSB_NAMES[it.role] || it.role;
      if (it.kind === 'text') {
        say('Moving to ' + nm + '…');
        await moveTo(it.xPct + 1.5, it.yPct + Math.min(it.hPct, 3) / 2);
        if (ctl.skipped) break;
        e.style.visibility = 'visible'; say('Typing ' + nm + '…');
        const len = it.text.length, dt = Math.min(34, 1700 / Math.max(1, len));
        for (let n = 1; n <= len && !ctl.skipped && !ctl.instant; n++) { e.textContent = it.text.slice(0, n); await wsbSleepRaw(dt / ctl.speed); }
        e.textContent = it.text;
      } else if (it.kind === 'table') {
        say('Drawing ' + nm + ' (' + it.rows + ' rows)…');
        await moveTo(it.xPct + 1.5, it.yPct + 1);
        if (ctl.skipped) break;
        e.style.visibility = 'visible';
        const cs = e.querySelectorAll('.wsb-c');
        let rowAt = it.yPct;
        for (let r = 0; r < it.rows && !ctl.skipped; r++) {
          const rowH = it.rowHeights[r] / it.h * it.hPct;
          await moveTo(it.xPct + 1.5, rowAt + rowH / 2, 280);
          cs.forEach(function (c) { if (+c.dataset.r === r) c.style.visibility = 'visible'; });
          rowAt += rowH; await sleep(160);
        }
        cs.forEach(function (c) { c.style.visibility = 'visible'; });
      } else {
        say('Placing ' + nm + '…');
        await moveTo(it.xPct + it.wPct / 2, it.yPct + it.hPct / 2);
        if (ctl.skipped) break;
        e.style.visibility = 'visible'; e.classList.add('pop'); await sleep(260);
      }
      if (ref) ref.classList.remove('hot');
      tick(); await sleep(140);
    }
    // Skipped, or just finished: make sure everything is fully there.
    newPg.querySelectorAll('.wsb-el').forEach(function (n) { n.remove(); });
    NP.items.forEach(function (it) { newPg.insertBefore(wsbMakeItem(it, true), cursor); });
    refPg.querySelectorAll('.hot').forEach(function (n) { n.classList.remove('hot'); });
    if (ctl.skipped && !ctl.closed) { doneCount = total; prog.style.width = '100%'; }
    if (pi < newPlan.pages.length - 1 && !ctl.closed) await sleep(700);
    cursor.style.opacity = '0';
  }

  if (!ctl.closed) {
    ctl.done = true; prog.style.width = '100%';
    const cur = newPg.querySelector('.wsb-cursor'); if (cur) cur.style.display = 'none';
    say(opts.doneText || 'Done. Everything is real, editable text, tables and image slots in the PDF Editor.');
    skipBtn.textContent = 'Open in editor'; skipBtn.focus();
    speedBtn.style.display = 'none';
    const x = $('.wsb-x'); if (x) x.style.display = 'none';
  }
}

// ─── PUBLIC ──────────────────────────────────────────────────────────────────
function wsbCounts(plan) {
  let t = 0, tb = 0, im = 0;
  plan.pages.forEach(function (p) { p.items.forEach(function (i) { if (i.kind === 'text') t++; else if (i.kind === 'table') tb++; else im++; }); });
  const parts = [];
  if (t) parts.push(t + ' text box' + (t === 1 ? '' : 'es'));
  if (tb) parts.push(tb + ' table' + (tb === 1 ? '' : 's'));
  if (im) parts.push(im + ' image slot' + (im === 1 ? '' : 's'));
  return parts.join(', ');
}

// opts: { fill?: [...], animate?: boolean (default true) }
async function wstyleBuild(nameOrId, opts) {
  opts = opts || {};
  const style = wstyleGet(nameOrId);
  if (!style) {
    const names = wstyleList().map(function (s) { return '"' + s.name + '"'; });
    throw new Error('there is no work style called "' + nameOrId + '"' + (names.length ? '. Saved styles: ' + names.join(', ') : '. Save one first from the Workstyle button'));
  }
  if (!style.pages || !style.pages.length) throw new Error('that work style has no pages in it');
  const fill = Array.isArray(opts.fill) && opts.fill.length ? opts.fill : null;

  const refPlan = wstyleBuildPlan(style, null);
  for (let i = 0; i < refPlan.fonts.length; i++) { try { await pdfedKadessaEnsureFont(refPlan.fonts[i]); } catch (e) { /* default */ } }
  const plan = fill ? wstyleBuildPlan(style, fill) : refPlan;
  if (!plan.pages.some(function (p) { return p.items.length; })) throw new Error('nothing to build, none of the parts of this style got any content');

  const done = await wsbCommit(plan);
  if (opts.animate !== false) { wsbPlay(refPlan, plan, {}).catch(function (e) { console.error('Workstyle replay failed:', e); }); }

  const where = done.at === 0 ? 'in a new document' : 'after page ' + done.at;
  const logoNote = plan.pages.some(function (p) { return p.items.some(function (i) { return i.role === 'logo' && !i.brand; }); })
    ? ' Image slots hold a labelled placeholder, drop your picture on them.' : '';
  const skipNote = plan.skipped ? ' Left out ' + plan.skipped + ' part' + (plan.skipped === 1 ? '' : 's') + ' of the original you gave no words for.' : '';
  return {
    say: (plan.template ? 'Built ' : 'Built an identical copy of ') + (plan.template ? 'a new ' + (done.pages === 1 ? 'page' : done.pages + ' pages') + ' in the "' : '"') + style.name +
      (plan.template ? '" look with your content' : '"') + ' ' + where + ' (' + wsbCounts(plan) + '). Watch it come together side by side.' + skipNote + logoNote +
      (done.bgNote ? ' ' + done.bgNote.trim() : ''),
    pages: done.pages
  };
}
