/* ──────────────────────────────────────────────────────────────────────────
 * Smart structure — turns ONE big block of raw text into separate headings,
 * paragraphs, lists and real tables.
 *
 * Why this exists: Refine Report works on separate canvas items (a heading
 * box, a body box, a table). When a person pastes a whole report in one go it
 * lands as a SINGLE text box, so refine had nothing to tell apart — no
 * headings to style, no table to format. This file reads the block the way a
 * person would (ALL-CAPS line = heading, "Label: " line = sub-heading, rows
 * of label + figures = table) and hands back proper pieces.
 *
 * Used in two places, both calling the same engine:
 *   1. Paste on the canvas        -> pdfedSmartPastePlainText
 *   2. Refine Report (first pass) -> pdfedSmartSplitPagesForRefine
 *
 * Tables are parsed with Data Arrangement's own splitter (daSplitDelimitedText)
 * and styled with its daBuildCellStyles, so a table built here looks and
 * behaves exactly like one pushed from the spreadsheet engine.
 *
 * Plain classic script, shares the global scope like every other js/ file.
 * ────────────────────────────────────────────────────────────────────────── */

// ── Figures: "₹128.4 Cr", "14.2%", "(4,500)", "$1,200", "-3.5" ─────────────
const PDFED_SMART_VALUE_TAIL_RE = /(?:^|\s)((?:[₹$€£]|Rs\.?\s?|INR\s?)?\s?\(?-?\d[\d,]*(?:\.\d+)?\)?(?:\s?(?:%|Cr\.?|Crore|Lakhs?|Mn|Bn|K|M|B)\b)?%?)\s*$/i;
// Column titles: "FY 2025–26", "2024", "Q3", "Mar 2026", "Total", "Amount" …
const PDFED_SMART_HEAD_TAIL_RE = /(?:^|\s)((?:FY\s?\d{2,4}(?:\s?[–—\-\/]\s?\d{2,4})?)|(?:(?:19|20)\d{2}(?:\s?[–—\-\/]\s?\d{2,4})?)|(?:Q[1-4](?:\s?FY\s?\d{2,4})?)|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s?\d{2,4})|(?:Total|Amount|Budget|Actual|Variance|Change|Growth|Qty|Quantity|Rate|Debit|Credit|Balance))\s*$/i;
const PDFED_SMART_BULLET_RE = /^\s*(?:[•●▪■◦·‣⁃\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+(?=\S)/;

// Peels figures (or column titles) off the right end of a line, one at a time.
// "Revenue ₹128.4 Cr ₹112.4 Cr" -> ["Revenue", "₹128.4 Cr", "₹112.4 Cr"].
function pdfedSmartPeelTail(line, re) {
  let rest = line.replace(/\s+$/, '');
  const tail = [];
  for (let guard = 0; guard < 12; guard++) {
    const m = rest.match(re);
    if (!m) break;
    const next = rest.slice(0, rest.length - m[0].length).replace(/\s+$/, '');
    if (!next) break; // always keep a label in front of the figures
    tail.unshift(m[1].trim());
    rest = next;
  }
  return tail.length ? [rest.trim()].concat(tail) : null;
}

// Best-effort split of ONE line into table cells, or null if it is not row-like.
//   1. tab-separated   2. two-or-more spaces   3. label + trailing figures
function pdfedSmartLineCells(line) {
  const raw = line.replace(/\s+$/, '');
  if (!raw.trim()) return null;
  if (raw.indexOf('\t') !== -1) {
    const cells = raw.split('\t').map(c => c.trim());
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells.length >= 2 ? { cells, how: 'tab' } : null;
  }
  if (/\S\s{2,}\S/.test(raw.trim())) {
    const cells = raw.trim().split(/\s{2,}/).map(c => c.trim());
    return cells.length >= 2 ? { cells, how: 'gap' } : null;
  }
  if (raw.trim().length > 130) return null;
  // A "Label: value" line is a key/value highlight, not a table row.
  if (/^[^:]{1,60}:\s+\S/.test(raw.trim())) return null;
  const vals = pdfedSmartPeelTail(raw.trim(), PDFED_SMART_VALUE_TAIL_RE);
  if (vals && vals.length >= 3) return { cells: vals, how: 'tail' };       // label + 2 or more figures
  const heads = pdfedSmartPeelTail(raw.trim(), PDFED_SMART_HEAD_TAIL_RE);
  if (heads && heads.length >= 3) return { cells: heads, how: 'head' };    // label + 2 or more column titles
  return null;
}

function pdfedSmartCellsLookTabular(rows) {
  let words = 0, n = 0, sentences = 0;
  rows.forEach(r => r.forEach(c => {
    const t = String(c).trim();
    const w = t.split(/\s+/).filter(Boolean).length;
    n++; words += w;
    // a "cell" that is really a sentence (ends with a full stop, 3+ words) means this is prose
    // split on the double space people leave after a full stop, not a table
    if (w >= 3 && /[.!?]$/.test(t)) sentences++;
  }));
  return n > 0 && (words / n) <= 5 && (sentences / n) < 0.3;
}

// Finds table runs among raw lines. Returns [{ start, end(exclusive), rows, headerRow }].
function pdfedSmartFindTables(lines) {
  const info = lines.map(l => pdfedSmartLineCells(l));
  const runs = [];
  let i = 0;
  while (i < lines.length) {
    const first = info[i];
    if (!first) { i++; continue; }
    const cols = first.cells.length;
    let j = i + 1;
    while (j < lines.length && info[j] && info[j].cells.length === cols) j++;
    const count = j - i;
    if (count >= 2) {
      const lineSlice = lines.slice(i, j);
      let rows = null;
      // Tabs / double spaces: let Data Arrangement's whole-block splitter do it,
      // since it also survives rows where a long cell squeezes the gap to 1 space.
      if (first.how === 'tab' || first.how === 'gap') {
        try {
          const da = (typeof daSplitDelimitedText === 'function') ? daSplitDelimitedText(lineSlice.join('\n')) : null;
          if (da && da.length === count && da.every(r => r.length === cols)) rows = da.map(r => r.map(c => String(c).trim()));
        } catch (e) { rows = null; }
      }
      if (!rows) rows = info.slice(i, j).map(x => x.cells);
      if (pdfedSmartCellsLookTabular(rows)) {
        // First row is a header when it holds no figures while the rows below do.
        const isNum = (typeof daCellLooksNumeric === 'function') ? daCellLooksNumeric : (c => /\d/.test(c));
        const headFig = rows[0].slice(1).some(c => isNum(c));
        const bodyFig = rows.slice(1).some(r => r.slice(1).some(c => isNum(c)));
        runs.push({ start: i, end: j, rows, headerRow: !headFig && bodyFig });
        i = j;
        continue;
      }
    }
    i++;
  }
  return runs;
}

function pdfedSmartIsStrongHeading(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/^(chapter|section|part|appendix)\s+\S/i.test(t) && t.length < 70) return true;
  if (/^\d+(\.\d+)*[.)]\s+\S/.test(t) && t.length < 70 && !/[.!?:]$/.test(t)) return true;
  // ALL CAPS line (digits, |, –, & and so on are fine; it just needs 2+ letters)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 12) return true;
  // "Growth and Profitability:" — short label ending with a colon, nothing after it
  if (/:$/.test(t) && t.length <= 48 && t.split(/\s+/).length <= 6 && !/\d{3,}/.test(t)) return true;
  return false;
}

// A softer test for Title Case lines. Only trusted when the line stands alone
// between blank lines / content, so a plain list of Title Case words is never
// mistaken for a stack of headings.
function pdfedSmartIsWeakHeading(line) {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/[.!?,;:]$/.test(t)) return false;
  // a colon or a figure inside the line means it is a "Label: value" fact, never a heading
  if (/[:\d%₹$€£]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  const caps = words.filter(w => /^[A-Z0-9]/.test(w)).length / words.length;
  return caps >= 0.75;
}

function pdfedSmartCleanHeading(line) {
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();
}

// Turns the lines between tables into heading / paragraph / list segments.
function pdfedSmartTextSegments(lines) {
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (!para.length) return;
    // Un-wrap hard-wrapped prose (line ends mid-sentence) but keep real breaks.
    let text = '';
    para.forEach((ln, k) => {
      if (k === 0) { text = ln; return; }
      const prev = para[k - 1];
      const joinWithSpace = !/[.!?:;]$/.test(prev) && prev.length >= 55;
      text += (joinWithSpace ? ' ' : '\n') + ln;
    });
    out.push({ kind: 'paragraph', text });
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    if (list.length >= 2) out.push({ kind: 'list', lines: list.slice() });
    else para.push(list[0]);
    list = [];
  };
  const flushAll = () => { flushList(); flushPara(); };

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].replace(/\s+$/, '');
    const t = line.trim();
    if (!t) { flushAll(); continue; }
    const prevBlank = k === 0 || !lines[k - 1].trim();
    const next = k + 1 < lines.length ? lines[k + 1].trim() : '';

    if (PDFED_SMART_BULLET_RE.test(line)) {
      flushPara();
      list.push(t.replace(PDFED_SMART_BULLET_RE, '').trim());
      continue;
    }
    if (pdfedSmartIsStrongHeading(t) ||
        (pdfedSmartIsWeakHeading(t) && prevBlank && next && !pdfedSmartIsWeakHeading(next))) {
      flushAll();
      const stacked = !prevBlank && out.length && out[out.length - 1].kind === 'heading';
      out.push({ kind: 'heading', text: pdfedSmartCleanHeading(t), colon: /:$/.test(t), stacked: !!stacked });
      continue;
    }
    // Short "Label: figure" lines stack up as a list (highlights, key facts).
    if (/^[^:]{1,60}:\s+\S/.test(t) && t.length <= 100) {
      flushPara();
      list.push(t);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushAll();
  return out;
}

// ── Public: raw text -> ordered segments ───────────────────────────────────
// [{kind:'heading', text, level}, {kind:'paragraph', text},
//  {kind:'list', lines}, {kind:'table', rows, headerRow}]
function pdfedSmartSegmentText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const tables = pdfedSmartFindTables(lines);
  const segs = [];
  let cursor = 0;
  const pushText = (from, to) => {
    if (to <= from) return;
    pdfedSmartTextSegments(lines.slice(from, to)).forEach(s => segs.push(s));
  };
  tables.forEach(t => {
    pushText(cursor, t.start);
    segs.push({ kind: 'table', rows: t.rows, headerRow: t.headerRow });
    cursor = t.end;
  });
  pushText(cursor, lines.length);

  // A masthead: two ALL-CAPS lines stacked directly at the top (company name,
  // then report name) stay together as ONE two-line title block.
  if (segs.length > 1 && segs[0].kind === 'heading' && segs[1].kind === 'heading' &&
      segs[1].stacked && !segs[0].colon && !segs[1].colon) {
    segs[0] = { kind: 'heading', text: segs[0].text + '\n' + segs[1].text, colon: false };
    segs.splice(1, 1);
  }
  if (segs[0] && segs[0].kind === 'heading') segs[0].level = 'title';
  segs.forEach(s => { if (s.kind === 'heading' && s.level == null) s.level = s.colon ? 'sub' : 'section'; });
  return segs;
}

// Worth splitting? Yes when it holds a table, or 2+ pieces including a heading.
function pdfedSmartIsStructured(segs) {
  if (!segs || !segs.length) return false;
  if (segs.some(s => s.kind === 'table')) return true;
  return segs.length >= 2 && segs.some(s => s.kind === 'heading');
}

// ── Build canvas items from segments ───────────────────────────────────────
function pdfedSmartNewTextItem(pg, base, text, x, y, w, role) {
  const sizeByRole = { title: 22, section: 16, sub: 14, body: base.fontSize || 12 };
  const isHeading = role !== 'body';
  const item = {
    id: 'ptxt_' + (++pdfedPlacedTextSeq),
    text, x, y, w,
    fontSize: isHeading ? sizeByRole[role] : Math.min(base.fontSize || 12, 14),
    fontFamily: base.fontFamily || 'Inter',
    color: base.color || '#101820',
    bold: isHeading, italic: false, underline: false, align: 'left',
    locked: false, zIndex: pdfedNextZ(pg)
  };
  return item;
}

function pdfedSmartNewTableItem(pg, rows, headerRow, x, y, maxW, fontFamily) {
  const nRows = Math.min(80, rows.length);
  const nCols = Math.min(20, rows.reduce((m, r) => Math.max(m, r.length), 1));
  const cells = [];
  for (let r = 0; r < nRows; r++) {
    const row = [];
    for (let c = 0; c < nCols; c++) row.push(String(rows[r][c] == null ? '' : rows[r][c]));
    cells.push(row);
  }
  const fontSize = 12;
  const ctx = pdfedRefineMeasureCtx();
  ctx.font = `bold ${fontSize}px ${pdfedFontCss(fontFamily || 'Inter')}`;
  const natural = [];
  for (let c = 0; c < nCols; c++) {
    let need = 0;
    for (let r = 0; r < nRows; r++) need = Math.max(need, ctx.measureText(cells[r][c]).width);
    natural.push(Math.max(56, Math.ceil(need) + 24));
  }
  const total = natural.reduce((a, b) => a + b, 0);
  const scale = total > maxW ? maxW / total : 1;
  const colWidths = natural.map(w => Math.max(40, Math.floor(w * scale)));
  const rowHeights = new Array(nRows).fill(28);
  const item = {
    id: 'tbl_' + (++pdfedTableSeq),
    x, y, rows: nRows, cols: nCols,
    colWidths, rowHeights, fontSize,
    headerRow: true,
    cells,
    cellStyles: (typeof daBuildCellStyles === 'function') ? daBuildCellStyles(cells) : [],
    locked: false, zIndex: pdfedNextZ(pg)
  };
  // Row 0 is always styled as the header by the table engine. When the pasted
  // block had no header line, add a neutral one so figures are never swallowed.
  return item;
}

// Lays segments out top to bottom. `start` is {x,y}; `contentW` the column width.
// Returns { texts:[], tables:[], bottom, counts }.
function pdfedSmartBuildItems(pg, segs, base, start, contentW, pageW) {
  const texts = [], tables = [];
  const counts = { headings: 0, tables: 0, lists: 0, paragraphs: 0 };
  let y = start.y;
  const x = start.x;
  const gapAfter = { heading: 6, paragraph: 14, list: 14, table: 18 };
  segs.forEach(seg => {
    if (seg.kind === 'table') {
      let rows = seg.rows;
      // No header line in the block: lead with a generic one so row 0 is not a data row.
      if (!seg.headerRow) {
        const head = rows[0].map((_, c) => c === 0 ? 'Item' : 'Value ' + c);
        if (rows[0].length === 2) head[1] = 'Value';
        rows = [head].concat(rows);
      }
      const t = pdfedSmartNewTableItem(pg, rows, true, x, y, contentW, base.fontFamily);
      tables.push(t);
      y += t.rowHeights.reduce((a, b) => a + b, 0) + gapAfter.table;
      counts.tables++;
      return;
    }
    let item;
    if (seg.kind === 'heading') {
      item = pdfedSmartNewTextItem(pg, base, seg.text, x, y, contentW, seg.level || 'section');
      counts.headings++;
    } else if (seg.kind === 'list') {
      item = pdfedSmartNewTextItem(pg, base, seg.lines.join('\n'), x, y, contentW, 'body');
      item.html = '<ul style="margin:0;padding-left:20px">' + seg.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
      item.bullet = true;
      counts.lists++;
    } else {
      item = pdfedSmartNewTextItem(pg, base, seg.text, x, y, contentW, 'body');
      counts.paragraphs++;
    }
    texts.push(item);
    y += pdfedEstimateTextHeight(item, pageW, 36) + gapAfter[seg.kind === 'heading' ? 'heading' : seg.kind];
  });
  return { texts, tables, bottom: y, counts };
}

// ── 1) Paste on the canvas ─────────────────────────────────────────────────
// Returns true when it took over the paste (so the caller stops), false when
// the text is plain enough that the normal single text box is the right result.
function pdfedSmartPastePlainText(plain, cx, cy) {
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg) return false;
  const segs = pdfedSmartSegmentText(plain);
  if (!pdfedSmartIsStructured(segs)) return false;

  if (!pg.placedTexts) pg.placedTexts = [];
  if (!pg.placedTables) pg.placedTables = [];
  const pc = document.getElementById('pdfedPageCanvas');
  const pageW = (pc && pc.width) || pg.width || 600;
  const margin = 36;
  const contentW = Math.max(200, pageW - margin * 2);
  const pageEmpty = !pg.placedTexts.length && !pg.placedTables.length && !(pg.placedImages || []).length;
  const startY = pageEmpty ? margin : Math.max(margin, Math.round(cy - 12));
  const base = {
    fontSize: 12,
    fontFamily: 'Inter',
    color: (pdfedAnnotState.colorTouched ? (pdfedAnnotState.color || '#101820') : '#101820')
  };
  const built = pdfedSmartBuildItems(pg, segs, base, { x: margin, y: startY }, contentW, pageW);
  built.texts.forEach(t => pg.placedTexts.push(t));
  built.tables.forEach(t => pg.placedTables.push(t));
  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  pdfedRenderPlacedTables(idx);

  const bits = [];
  if (built.counts.headings) bits.push(`${built.counts.headings} heading${built.counts.headings !== 1 ? 's' : ''}`);
  if (built.counts.tables) bits.push(`${built.counts.tables} table${built.counts.tables !== 1 ? 's' : ''}`);
  if (built.counts.lists) bits.push(`${built.counts.lists} list${built.counts.lists !== 1 ? 's' : ''}`);
  if (built.counts.paragraphs) bits.push(`${built.counts.paragraphs} paragraph${built.counts.paragraphs !== 1 ? 's' : ''}`);
  toast(`Pasted and organised: ${bits.join(', ')}`, 'success');

  pushAppHistory({
    label: 'Paste structured text',
    undo: () => {
      built.texts.forEach(t => { const i = pg.placedTexts.indexOf(t); if (i > -1) pg.placedTexts.splice(i, 1); });
      built.tables.forEach(t => { const i = pg.placedTables.indexOf(t); if (i > -1) pg.placedTables.splice(i, 1); });
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      pdfedRenderPlacedTables(idx);
      toast('Paste undone', 'info');
    },
    redo: () => {
      built.texts.forEach(t => { if (pg.placedTexts.indexOf(t) === -1) pg.placedTexts.push(t); });
      built.tables.forEach(t => { if (pg.placedTables.indexOf(t) === -1) pg.placedTables.push(t); });
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      pdfedRenderPlacedTables(idx);
    }
  });
  return true;
}

// ── 2) Refine Report: split mixed boxes that are already on the canvas ─────
// A text box is split only when it is a plain, unlocked block that reads as a
// whole document (headings and/or a table inside one box). Boxes that are
// already a single heading, list or paragraph are left exactly as they are,
// so running Refine Report again changes nothing (idempotent).
function pdfedSmartSplitPagesForRefine(pages, inScope) {
  const result = { boxesSplit: 0, headingsFound: 0, tablesBuilt: 0 };
  const pc = document.getElementById('pdfedPageCanvas');
  pages.forEach(pg => {
    if (!inScope(pg) || !pg.placedTexts || !pg.placedTexts.length) return;
    const pageW = pg.width || (pc && pc.width) || 600;
    const margin = 36;
    const contentW = Math.max(200, pageW - margin * 2);
    const keep = [];
    const addTexts = [], addTables = [];
    pg.placedTexts.forEach(t => {
      const skip = t._reportHeaderText || t._reportFooterText || t.locked || t.bullet || t.linkedTableId ||
        (t.html && /<(b|strong|i|em|u|span|a|font|ul|ol|li)[\s>]/i.test(t.html));
      const txt = String(t.text || '');
      if (skip || txt.split('\n').filter(l => l.trim()).length < 2) { keep.push(t); return; }
      const segs = pdfedSmartSegmentText(txt);
      if (!pdfedSmartIsStructured(segs)) { keep.push(t); return; }
      const w = Math.max(200, Math.min(t.w || contentW, contentW));
      const x = Math.max(margin, Math.min(t.x || margin, pageW - margin - w));
      const built = pdfedSmartBuildItems(pg, segs, t, { x, y: t.y || margin }, w, pageW);
      built.texts.forEach(n => addTexts.push(n));
      built.tables.forEach(n => addTables.push(n));
      result.boxesSplit++;
      result.headingsFound += built.counts.headings;
      result.tablesBuilt += built.counts.tables;
    });
    if (addTexts.length || addTables.length) {
      pg.placedTexts = keep.concat(addTexts);
      if (!pg.placedTables) pg.placedTables = [];
      addTables.forEach(t => pg.placedTables.push(t));
    }
  });
  return result;
}
