// ─── WORKSTYLE, BUILD: LIVE IN THE EDITOR, REFERENCE ON THE LEFT ────────────
// Takes a style saved by js/59-workstyle.js (or read from a PDF by js/60) and
// builds it as real, editable pages in the PDF Editor while the person watches:
//   LEFT   the reference, docked beside the editor
//   RIGHT  the real editor page, filled one part at a time while Kadessa's ring
//          glides to each spot (the same ring she uses in Data Arrangement)
// Nothing is a fake preview: every part that appears is already a real text box,
// table or image slot on the page and can be edited the moment it lands.
//
// Two ways to build:
//   copy      the reference's own words, so the result is an identical document
//   template  new words in the same look. `fill` is a list of entries, either
//             addressed to one exact slot { id:'p1s3', text } / { id, headers, rows }
//             (what the fill engine in js/63-workstyle-fill.js returns) or by role
//             { role, text } in reading order (what the chat tool sends).
//             A slot without words is left out. Longer text pushes what is below it
//             down (the footer stays put). Undo removes the built pages in one step.
//
// Pictures are never copied from the reference. Every logo / image spot becomes an UPLOAD SPOT exactly where the
// picture sat (see wsbMountSlotUpload below): click it or drop a file on it, and the picture is fitted into that
// exact box. A logo spot is filled from the Brand Kit when there is one (and can be replaced the same way).
// A background picture becomes its main color.

const WSB_PX_PER_MM = 3.7795;
const WSB_NAMES = { shape: 'a line or box', title: 'the title', heading: 'a heading', subheading: 'the subheading', body: 'the body text',
  caption: 'a caption', footer: 'the footer', table: 'the table', logo: 'the logo', image: 'an image slot' };

// The reference's border look for one cell of the docked preview (same rule the editor uses).
function wsbBorderCss(it, r, c) {
  if (!it.borderStyle || typeof pdfedTableBorderSides !== 'function') return '';
  const sd = pdfedTableBorderSides({ borderStyle: it.borderStyle, rows: it.rows, cols: it.cols, headerRow: it.headerRow }, r, c);
  if (!sd) return '';
  const ln = '1px solid ' + (it.borderStyle.color || '#999');
  return ';border:1px solid transparent' + (sd.top ? ';border-top:' + ln : '') + (sd.left ? ';border-left:' + ln : '') + (sd.bottom ? ';border-bottom:' + ln : '') + (sd.right ? ';border-right:' + ln : '');
}

function wsbPxFor(mm) { return Math.max(1, Math.round((Number(mm) || 0) * WSB_PX_PER_MM)); }
function wsbR(n, d) { const k = Math.pow(10, d === undefined ? 1 : d); return Math.round((Number(n) || 0) * k) / k; }
function wsbSleepRaw(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function wsbReduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
function wsbFontCss(fam) { return (typeof pdfedFontCss === 'function') ? pdfedFontCss(fam) : ('"' + fam + '", sans-serif'); }

// An empty picture spot holds a transparent pixel: it draws nothing in an export or a thumbnail, and the editor
// shows the dashed "Upload" spot on top of it (wsbMountSlotUpload), so a spot nobody filled never prints.
const WSB_BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let wsbBrandNat = null;      // natural size of the Brand Kit logo, so it is fitted instead of stretched
let wsbBuildSeq = 0;         // one number per build, so repeated logo spots (continuation pages) belong together
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

// A one-line part (a title, a tagline, a footer line) is measured as wide as its own words. When the new
// words are longer, widen the box inside the page margins (around its centre, or from its left or right edge)
// so a longer name stays on one line like the reference instead of wrapping.
function wsbWidenOneLine(it, text, fs, fam, x, w, W, oldH, margins) {
  try {
    if (typeof pdfedKadessaMeasureTextWidth !== 'function') return { x: x, w: w };
    if (/\n/.test(text) || /\n/.test(String(it.text || '')) || oldH > fs * 1.9) return { x: x, w: w };
    const pad = (typeof PDFED_PTXT_BORDER !== 'undefined' && typeof PDFED_PTXT_PAD_X !== 'undefined') ? 2 * (PDFED_PTXT_BORDER + PDFED_PTXT_PAD_X) : 16;
    const tw = pdfedKadessaMeasureTextWidth(text, fam, fs, !!it.bold) + pad + 2;
    if (!(tw > w)) return { x: x, w: w };
    const lim = Math.max(W * 0.04, ((margins && margins.leftPct) || 0) / 100 * W);
    const limR = W - Math.max(W * 0.04, ((margins && margins.rightPct) || 0) / 100 * W);
    if (it.align === 'center') {
      const cx = x + w / 2, half = Math.min(cx - lim, limR - cx);
      const nw = Math.min(tw, half * 2);
      return nw > w ? { x: cx - nw / 2, w: nw } : { x: x, w: w };
    }
    if (it.align === 'right') {
      const right = x + w, nw = Math.min(tw, right - lim);
      return nw > w ? { x: right - nw, w: nw } : { x: x, w: w };
    }
    const nw = Math.min(tw, limR - x);
    return nw > w ? { x: x, w: nw } : { x: x, w: w };
  } catch (e) { return { x: x, w: w }; }
}


// ─── PAGINATION: content longer than the reference page flows onto continuation pages ───
// Same rules as Refine Report (js/32 pdfedAutoAlignContent + pdfedMakeRefineOverflowPage):
//   a continuation page has the reference's size and background, carries the logo and footer again,
//   starts below the logo (or at the top margin), a table that splits repeats its header row,
//   a heading is never left alone at the foot of a page, and gaps follow the reference's own rhythm
//   kept inside Refine's range (6 px at least, 24 px at most).
const WSB_MIN_GAP = 6, WSB_SECTION_GAP = 24, WSB_MAX_PAGES_PER_REF = 40;

// Decoration that repeats on every page: header band, footer rule, tall side strip. Other boxes and lines stay on page 1.
function wsbShapeRepeats(it, H, W) {
  return it.kind === 'shape' && (it.y + it.h <= H * 0.15 || it.y >= H * 0.9 || (it.h >= H * 0.6 && it.w <= W * 0.12));
}
function wsbIsAnchor(it, H, W) { return it.role === 'footer' || (it.kind === 'image' && it.role === 'logo') || (H ? wsbShapeRepeats(it, H, W) : false); }
function wsbShapesFirst(items) { return items.filter(function (i) { return i.kind === 'shape'; }).concat(items.filter(function (i) { return i.kind !== 'shape'; })); }
function wsbIsHeading(it) { return it.kind === 'text' && (it.role === 'title' || it.role === 'heading' || it.role === 'subheading'); }

// Splits one text box so the first part ends above `limit`. Returns { head, rest } (either may be null).
function wsbSplitText(it, y, limit) {
  const avail = limit - y;
  const fs = it.fontSize, lineH = fs * 1.3;
  if (avail < lineH * 2) return { head: null, rest: it };         // fewer than two lines of room: move it whole
  const measure = function (t) { return wsbMeasureText(t, it.fontFamily, fs, it.bold, it.italic, it.w, lineH * Math.max(1, String(t).split('\n').length)); };
  const lines = String(it.text).split('\n');
  // 1. how many whole lines (paragraphs) fit
  let lo = 0, hi = lines.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (measure(lines.slice(0, mid).join('\n')) <= avail) lo = mid; else hi = mid - 1; }
  let headText = lines.slice(0, lo).join('\n'), restLines = lines.slice(lo);
  // 2. inside the next paragraph, how many words fit
  if (lo < lines.length) {
    const words = lines[lo].split(' ');
    let a = 0, b = words.length - 1;
    const base = lo ? lines.slice(0, lo).join('\n') + '\n' : '';
    while (a < b) { const mid = Math.ceil((a + b) / 2); if (measure(base + words.slice(0, mid).join(' ')) <= avail) a = mid; else b = mid - 1; }
    if (a > 0) { headText = base + words.slice(0, a).join(' '); restLines = [words.slice(a).join(' ')].concat(lines.slice(lo + 1)); }
  }
  headText = headText.replace(/\s+$/, '');
  const restText = restLines.join('\n').replace(/^\s+/, '');
  if (!restText) return { head: it, rest: null };
  if (!headText || measure(headText) < lineH * 2 - 1) return { head: null, rest: it };   // no one-line orphan at the foot
  const head = Object.assign({}, it, { text: headText, y: y, h: measure(headText) });
  const rest = Object.assign({}, it, { text: restText, h: measure(restText) });
  return { head: head, rest: rest };
}

function wsbSplitTable(it, y, limit) {
  const hdr = it.headerRow ? 1 : 0;
  let sum = 0, k = 0;
  while (k < it.rows && y + sum + it.rowHeights[k] <= limit) { sum += it.rowHeights[k]; k++; }
  if (k >= it.rows) return { head: it, rest: null };
  if (k < hdr + 1) return { head: null, rest: it };               // header alone does not stay: move the table whole
  // no widow: do not leave a single body row alone on the next page
  if (it.rows - k === 1 && k > hdr + 2) { k--; sum -= it.rowHeights[k]; }
  const take = function (arr, from, to, repeat) { return (repeat ? [arr[0]] : []).concat(arr.slice(from, to)); };
  const hr = it.rowHeights.slice(0, k), tr = take(it.rowHeights, k, it.rows, hdr);
  const head = Object.assign({}, it, { y: y, rows: k, cells: it.cells.slice(0, k), cellStyles: it.cellStyles.slice(0, k), rowHeights: hr,
    h: hr.reduce(function (a, b) { return a + b; }, 0) });
  const rest = Object.assign({}, it, { rows: tr.length, cells: take(it.cells, k, it.rows, hdr), cellStyles: take(it.cellStyles, k, it.rows, hdr),
    rowHeights: tr, h: tr.reduce(function (a, b) { return a + b; }, 0) });
  return { head: head, rest: rest };
}

function wsbSplit(it, y, limit) {
  if (y + it.h <= limit + 0.5) return { head: Object.assign({}, it, { y: y }), rest: null };
  if (it.kind === 'table') return wsbSplitTable(it, y, limit);
  if (it.kind === 'text') return wsbSplitText(it, y, limit);
  return { head: null, rest: it };                                // pictures and shapes move whole
}

// P = one planned page (px). sp = the reference page. Returns [P, continuation pages...].
function wsbPaginate(P, sp) {
  const H = P.H;
  const m = sp.margins || {};
  const mTop = Math.max(H * 0.04, (m.topPct || 0) / 100 * H);
  let limit = H - Math.max(H * 0.05, (m.bottomPct || 0) / 100 * H);
  const W = P.W;
  const anchors = wsbShapesFirst(P.items.filter(function (i) { return wsbIsAnchor(i, H, W); }));
  const deco = P.items.filter(function (i) { return i.kind === 'shape' && !wsbIsAnchor(i, H, W); });
  const footTops = anchors.filter(function (a) { return a.role === 'footer' || (a.kind === 'shape' && a.y >= H * 0.9); }).map(function (a) { return a.y; });
  if (footTops.length) limit = Math.min(limit, Math.min.apply(null, footTops) - WSB_SECTION_GAP / 2);
  const flow = P.items.filter(function (i) { return i.kind !== 'shape' && !wsbIsAnchor(i, H, W); });
  const logoBottom = anchors.filter(function (a) { return (a.kind === 'image' || a.kind === 'shape') && a.y < H / 2 && a.y + a.h <= H * 0.25; }).reduce(function (b, a) { return Math.max(b, a.y + a.h); }, 0);
  const startY = Math.max(mTop, logoBottom ? logoBottom + WSB_SECTION_GAP : mTop);

  // Page 1 keeps its positions; whatever crosses the limit is split or moved.
  const kept = [], queue = [];
  flow.forEach(function (it) {
    if (queue.length) { queue.push(it); return; }                  // once one item spills, everything after it follows in order
    const r = wsbSplit(it, it.y, limit);
    if (r.head) kept.push(r.head);
    if (r.rest) queue.push(r.rest);
  });
  // boxes and lines that are not repeated stay on page 1, trimmed so none hangs below the content area
  const decoKept = deco.map(function (d) { return d.y >= limit ? null : (d.y + d.h > limit ? Object.assign({}, d, { h: limit - d.y }) : d); }).filter(Boolean);
  if (!queue.length) { P.items = wsbShapesFirst(P.items); return [P]; }

  // Keep-with-next: a heading left at the foot of the page goes with the text it introduces.
  while (kept.length && wsbIsHeading(kept[kept.length - 1]) && queue.length) queue.unshift(kept.pop());

  const pages = [];
  P.items = wsbShapesFirst(anchors.concat(decoKept, kept));
  pages.push(P);

  // gap each queued item had above it on the reference, kept within Refine's range
  const gapAbove = function (it, prev) {
    if (!prev) return 0;
    const g = it.y - (prev.y + prev.h);
    return Math.max(WSB_MIN_GAP, Math.min(WSB_SECTION_GAP, g > 0 ? g : WSB_MIN_GAP));
  };

  let guard = 0;
  while (queue.length && pages.length < WSB_MAX_PAGES_PER_REF && guard++ < 400) {
    const C = Object.assign({}, P, { cont: true, items: anchors.map(function (a) { return Object.assign({}, a); }) });
    let rowY = startY, rowBottom = startY, prev = null, placedAny = false, prevPlacedY = startY;
    while (queue.length) {
      const it = queue[0];
      let y;
      if (!prev) y = startY;
      else if (Math.abs(it.y - prev.y) <= 4 && Math.abs(it.x - prev.x) > 4 && prev.src !== it.src) y = prevPlacedY;   // side by side, same row
      else y = rowBottom + gapAbove(it, prev);
      let r = wsbSplit(it, y, limit);
      if (!r.head && !placedAny) {                                  // cannot fit even on an empty page: place it anyway, never loop
        r = { head: Object.assign({}, it, { y: startY, h: Math.min(it.h, limit - startY) }), rest: null };
        if (it.kind === 'table') r = { head: Object.assign({}, it, { y: startY }), rest: null };
      }
      if (!r.head) break;
      C.items.push(r.head);
      placedAny = true;
      queue.shift();
      prevPlacedY = y; prev = { x: it.x, y: it.y, h: it.h, src: it.src };
      rowBottom = Math.max(y === prevPlacedY ? rowBottom : 0, y + r.head.h);
      if (r.rest) { queue.unshift(r.rest); break; }               // the split item fills this page
    }
    pages.push(C);
  }
  return pages;
}

// Colour logic. Text keeps the reference's colour, but when a part moves off the box or band it was written on
// (a white title that ends up on a white page) it would vanish. Work out what colour really sits under the text
// (the top-most filled box under its centre, else the page background) and, only when the contrast is clearly
// too low to read, switch that text to near-black or white, whichever reads better. Anything readable is untouched.
const WSB_HEX = /^#[0-9a-fA-F]{6}$/;
function wsbMixHex(a, b) {
  const x = wstyleRgbOf(a), y = wstyleRgbOf(b);
  if (!x || !y) return a || b || '#ffffff';
  const h = function (n) { return ('0' + Math.round(n).toString(16)).slice(-2); };
  return '#' + h((x[0] + y[0]) / 2) + h((x[1] + y[1]) / 2) + h((x[2] + y[2]) / 2);
}
function wsbFixContrast(items, bg) {
  if (typeof wstyleContrast !== 'function') return 0;
  const c1 = (bg && WSB_HEX.test(bg.color1 || '')) ? bg.color1 : '#ffffff';
  const pageCol = (bg && bg.mode === 'gradient' && WSB_HEX.test(bg.color2 || '')) ? wsbMixHex(c1, bg.color2) : c1;
  const boxes = items.filter(function (i) { return i.kind === 'shape' && i.shape !== 'line' && (i.fill || i.grad); });
  let n = 0;
  items.forEach(function (it) {
    if (it.kind !== 'text' || it.gradient || !WSB_HEX.test(it.color || '')) return;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    let under = pageCol;
    for (let k = boxes.length - 1; k >= 0; k--) {
      const b = boxes[k];
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) { under = b.fill || (b.grad ? wsbMixHex(b.grad.c1, b.grad.c2) : pageCol); break; }
    }
    if (!WSB_HEX.test(under) || wstyleContrast(it.color, under) >= 2.2) return;
    it.color = wstyleContrast('#111111', under) >= wstyleContrast('#ffffff', under) ? '#111111' : '#ffffff';
    n++;
  });
  return n;
}

function wstyleBuildPlan(style, fill) {
  const template = Array.isArray(fill) && fill.length > 0;
  const queues = {};
  const given = {};
  const bySlot = {};   // fills addressed to one exact slot (id like "p1s3"), from the fill engine (js/63)
  let slotHits = 0;
  if (template) {
    fill.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      if (typeof f.id === 'string' && /^p\d+s\d+$/.test(f.id)) { bySlot[f.id] = f; return; }
      const r = String(f.role || '').trim().toLowerCase();
      if (!r) return;
      (queues[r] = queues[r] || []).push(f);
      given[r] = (given[r] || 0) + 1;
    });
  }
  const fonts = {};
  const have = {};
  const pages = [];
  let skipped = 0, contrastFixed = 0;

  (style.pages || []).forEach(function (sp, pi) {
    const shapesRaw = [], shiftLog = [];
    const mm = (sp.pageMM && sp.pageMM.length === 2) ? sp.pageMM : [210, 297];
    const W = wsbPxFor(mm[0]), H = wsbPxFor(mm[1]);
    const items = [];
    // Spacing model. `shift` is what every ROW above has added (longer words) or given back (shorter words), so the
    // gaps the reference had are kept: nothing overlaps and no big hole opens when the new words are shorter.
    // Parts on the same row (side by side columns, a logo beside a name) move together and the row follows its
    // tallest part, so one column growing never pushes its neighbour off the row.
    let shift = 0, rowTop = -1e9, rowShift = 0, rowDelta = null, rowBottom = 0;
    const commitRow = function () {
      if (rowDelta !== null && Math.abs(rowDelta) > 0) { shift += rowDelta; shiftLog.push({ at: rowBottom, shift: shift }); }
      rowDelta = null;
    };
    const rowStart = function (baseY) {
      if (Math.abs(baseY - rowTop) > 4) { commitRow(); rowTop = baseY; rowShift = shift; rowBottom = 0; }
      return rowShift;
    };
    const rowAdd = function (delta, bottom) { rowDelta = rowDelta === null ? delta : Math.max(rowDelta, delta); rowBottom = Math.max(rowBottom, bottom); };
    (sp.items || []).forEach(function (it, si) {
      have[it.role] = (have[it.role] || 0) + 1;
      if (it.kind === 'shape') { shapesRaw.push({ it: it, si: si }); return; }
      const slotId = 'p' + (pi + 1) + 's' + si;
      const slotFill = bySlot[slotId] || null;
      if (slotFill) slotHits++;
      const pinned = it.role === 'footer';
      const x = (it.xPct || 0) / 100 * W, w = (it.wPct || 0) / 100 * W;
      const baseY = (it.yPct || 0) / 100 * H, oldH = (it.hPct || 0) / 100 * H;
      const y = baseY + (pinned ? 0 : rowStart(baseY));

      if (it.kind === 'text') {
        let text = String(it.text || '');
        if (template) {
          const f = slotFill || (queues[it.role] || []).shift();
          text = f ? String(f.text == null ? '' : f.text).trim() : '';
          if (!text) { skipped++; return; }
        }
        const fs = (it.sizePct || 3) / 100 * W, fam = it.fontFamily || 'Inter';
        fonts[fam] = true;
        let h = oldH;
        let bx = x, bw = w;
        { const wd = wsbWidenOneLine(it, text, fs, fam, x, w, W, oldH, sp.margins); bx = wd.x; bw = wd.w; }
        if (template) {
          // Compare like with like: the new words and the original words, measured the same way.
          const was = wsbMeasureText(String(it.text || ''), fam, fs, it.bold, it.italic, w, oldH);
          h = Math.max(oldH * 0.5, wsbMeasureText(text, fam, fs, it.bold, it.italic, bw, oldH));
          if (!pinned) rowAdd(Math.abs(h - was) > 3 ? (h - was) : 0, baseY + oldH);
        }
        items.push({ kind: 'text', src: si, slot: slotId, role: it.role, x: bx, y: y, w: bw, h: h, fontSize: fs, sizePct: it.sizePct || 3,
          fontFamily: fam, color: it.color || '#111111', gradient: it.gradient || null, bold: !!it.bold, italic: !!it.italic,
          underline: !!it.underline, align: it.align || 'left', opacity: (it.opacity === undefined || it.opacity === null) ? 1 : it.opacity, text: text });
        return;
      }

      if (it.kind === 'table') {
        let cells = null;
        if (template) {
          const f = slotFill || (queues.table || []).shift();
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
        const cellStyles = wsbCellStyles(it, cells);
        if (template && !pinned) rowAdd(Math.abs(th - oldH) > 3 ? (th - oldH) : 0, baseY + oldH);
        items.push({ kind: 'table', src: si, slot: slotId, role: 'table', x: x, y: y, w: totalW, h: th, rows: rows, cols: cols,
          colWidths: colWidths, rowHeights: rowHeights, fontSize: fs, sizePct: it.sizePct || 3, fontFamily: fam,
          headerRow: !!it.headerRow, cells: cells, cellStyles: cellStyles, borderStyle: it.borderStyle || null });
        return;
      }

      // image slot
      const isLogo = it.role === 'logo';
      const brand = isLogo ? wsbBrandLogo() : null;
      if (!pinned) rowAdd(0, baseY + oldH);
      items.push({ kind: 'image', src: si, page: pi, role: it.role, x: x, y: y, w: w, h: oldH, dataUrl: brand || '',
        brand: !!brand, opacity: (it.opacity === undefined || it.opacity === null) ? 1 : it.opacity });
    });
    commitRow();
    // Boxes and lines go first (behind everything). Those under a part that grew move down with it;
    // a box around parts that grew is made taller by the same amount.
    const shiftAt = function (yy) { let v = 0; shiftLog.forEach(function (l) { if (l.at <= yy + 2) v = l.shift; }); return v; };
    shapesRaw.slice().reverse().forEach(function (r) {
      const sh = r.it, sy = (sh.yPct || 0) / 100 * H, shh = (sh.hPct || 0) / 100 * H;
      const low = sy > H * 0.9;
      const top = low ? 0 : shiftAt(sy), bot = low ? 0 : shiftAt(sy + shh);
      items.unshift({ kind: 'shape', role: 'shape', shape: sh.shape, src: r.si, x: (sh.xPct || 0) / 100 * W, y: sy + top, w: (sh.wPct || 0) / 100 * W,
        h: Math.max(1, shh + (bot - top)), fill: sh.fill || null, stroke: sh.stroke || null, sw: (sh.swPct || 0) / 100 * W,
        r: (sh.rPct || 0) / 100 * W, grad: sh.grad || null });
    });
    if (template) contrastFixed += wsbFixContrast(items, sp.bg);
    let made = [{ index: pi, mmW: mm[0], mmH: mm[1], W: W, H: H, ratio: W / H, bg: sp.bg || { mode: 'solid', color1: '#ffffff' }, items: items }];
    if (template) made = wsbPaginate(made[0], sp);
    made.forEach(function (P) {
      P.items.forEach(function (i) { i.xPct = wsbR(i.x / W * 100, 3); i.yPct = wsbR(i.y / H * 100, 3); i.wPct = wsbR(i.w / W * 100, 3); i.hPct = wsbR(i.h / H * 100, 3); if (i.kind === 'shape') i.rPct = i.r ? wsbR(i.r / W * 100, 3) : 0; });
      pages.push(P);
    });
  });

  if (template) {
    const matched = slotHits > 0 || Object.keys(given).some(function (r) { return have[r]; });
    if (!matched) {
      const mine = Object.keys(have).map(function (r) { return have[r] + ' ' + r; }).join(', ');
      throw new Error('none of the roles you gave match this style. It has: ' + mine);
    }
  }
  return { name: style.name, template: template, pages: pages, fonts: Object.keys(fonts), skipped: skipped, contrastFixed: contrastFixed };
}

// ─── 2. THE REAL PAGES ───────────────────────────────────────────────────────
function wsbEnsureEditorOpen() {
  try {
    if (typeof unifiedActiveSection === 'function' && unifiedActiveSection() !== 'pdfeditor' && typeof navigate === 'function') navigate('pdfeditor');
  } catch (e) { /* the editor is probably already showing */ }
}

// One empty page with the reference's background, ready to be filled.
async function wsbNewPage(P) {
  const bg = P.bg || {};
  const c1 = /^#[0-9a-fA-F]{6}$/.test(bg.color1 || '') ? bg.color1 : '#ffffff';
  const url = await pdfedRenderBlankPage('', c1, P.mmW, P.mmH);
  const pg = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [],
    label: P.cont ? 'Workstyle page (cont.)' : 'Workstyle page', bgColor: c1, pageMM: [P.mmW, P.mmH] };
  let note = '';
  if (bg.mode === 'gradient' && /^#[0-9a-fA-F]{6}$/.test(bg.color2 || '')) {
    const angle = bg.direction === 'horizontal' ? 90 : (bg.direction === 'diagonal' ? 135 : 180);
    try {
      await pdfedBakeCanvasTintOntoPage(pg, { mode: 'gradient', color1: c1, color2: bg.color2, angle: angle, opacity: 100,
        imageDataUrl: null, imageFit: (typeof pdfedCanvasTintState !== 'undefined' && pdfedCanvasTintState) ? pdfedCanvasTintState.imageFit : undefined });
    } catch (e) { note = 'The gradient background could not be baked, so the main color was used. '; }
  } else if (bg.mode === 'image') note = 'The reference had a background picture, so its main color was used. ';
  return { pg: pg, note: note };
}

// Puts one planned part on a page as a real, editable object. Returns its DOM selector.
function wsbAddItem(pg, it) {
  if (it.kind === 'text') {
    const t = { id: 'ptxt_' + (++pdfedPlacedTextSeq), text: it.text, x: wsbR(it.x), y: wsbR(it.y), w: wsbR(it.w),
      fontSize: wsbR(it.fontSize, 2), fontFamily: it.fontFamily, color: it.color, bold: it.bold, italic: it.italic,
      underline: it.underline, align: it.align, locked: false, zIndex: pdfedNextZ(pg) };
    if (it.opacity !== 1) t.opacity = it.opacity;
    if (it.gradient) t.gradient = it.gradient;
    pg.placedTexts.push(t);
    return '.pdfed-placed-text[data-id="' + t.id + '"]';
  }
  if (it.kind === 'table') {
    const tb = { id: 'tbl_' + (++pdfedTableSeq), x: Math.round(it.x), y: Math.round(it.y), rows: it.rows, cols: it.cols,
      colWidths: it.colWidths.map(function (v) { return wsbR(v, 2); }), rowHeights: it.rowHeights.map(function (v) { return wsbR(v, 2); }),
      fontSize: wsbR(it.fontSize, 2), fontFamily: it.fontFamily, headerRow: it.headerRow, cells: it.cells, cellStyles: it.cellStyles,
      locked: false, zIndex: pdfedNextZ(pg) };
    if (it.borderStyle) tb.borderStyle = it.borderStyle;
    pg.placedTables.push(tb);
    return '.pdfed-placed-table[data-id="' + tb.id + '"]';
  }
  if (it.kind === 'shape') {
    const w = Math.max(1, it.w), h = Math.max(1, it.h), sw = Math.max(0, it.sw || 0);
    let svg;
    if (it.shape === 'line') {
      const c = it.stroke || it.fill || '#000000', t = Math.max(1, sw);
      const bw = it.w >= it.h ? w : Math.max(w, t), bh = it.w >= it.h ? Math.max(h, t) : h;
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + bw + '" height="' + bh + '" viewBox="0 0 ' + bw + ' ' + bh + '"><rect width="' + bw + '" height="' + bh + '" fill="' + c + '"/></svg>';
      it = Object.assign({}, it, { w: bw, h: bh });
    } else {
      const hs = sw / 2;
      const rx = Math.max(0, Math.min(it.r || 0, w / 2, h / 2));                       // rounded corners
      const g = it.grad;                                                              // a fade
      const gd = g ? '<defs><linearGradient id="wsg" x1="0" y1="0" x2="' + (g.dir === 'vertical' ? 0 : 1) + '" y2="' + (g.dir === 'horizontal' ? 0 : 1) + '"><stop offset="0" stop-color="' + g.c1 + '"/><stop offset="1" stop-color="' + g.c2 + '"/></linearGradient></defs>' : '';
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + gd + '<rect x="' + hs + '" y="' + hs + '" width="' + Math.max(1, w - sw) + '" height="' + Math.max(1, h - sw) +
        '"' + (rx ? ' rx="' + rx + '" ry="' + rx + '"' : '') + ' fill="' + (g ? 'url(#wsg)' : (it.fill || 'none')) + '"' + (it.stroke && sw > 0 ? ' stroke="' + it.stroke + '" stroke-width="' + sw + '"' : '') + '/></svg>';
    }
    pdfedAnnotState.placedImgSeq++;
    const im = { id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))), x: wsbR(it.x), y: wsbR(it.y), w: wsbR(it.w), h: wsbR(it.h),
      locked: false, zIndex: pdfedNextZ(pg), kind: 'image', _wsShape: true };
    pg.placedImages.push(im);
    return '.pdfed-placed-img[data-id="' + im.id + '"]';
  }
  if (it.kind === 'image') {
    // A picture spot. Empty until the person uploads (or the Brand Kit logo fills a logo spot); either way it keeps
    // its exact box in _wsBox, so an upload is fitted into the same place every time.
    const role = it.role === 'logo' ? 'logo' : 'image';
    const pw = (pg.pageMM && pg.pageMM[0]) ? wsbPxFor(pg.pageMM[0]) : 0;
    const box = { x: wsbR(it.x), y: wsbR(it.y), w: wsbR(it.w), h: wsbR(it.h) };
    let f = { x: box.x, y: box.y, w: box.w, h: box.h }, url = WSB_BLANK_PNG, empty = true;
    if (it.brand && it.dataUrl) {
      url = it.dataUrl; empty = false;
      if (wsbBrandNat) f = wsbFitIntoSlot(box, wsbBrandNat.w, wsbBrandNat.h, 'logo', pw);
    }
    pdfedAnnotState.placedImgSeq++;
    const im = { id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: url, x: wsbR(f.x), y: wsbR(f.y), w: wsbR(f.w), h: wsbR(f.h),
      locked: false, zIndex: pdfedNextZ(pg), kind: 'image', _wsSlot: true, _wsRole: role, _wsEmpty: empty, _wsBox: box,
      _wsGroup: 'wsg' + wsbBuildSeq + '_' + (it.page || 0) + '_' + it.src };
    if (it.opacity !== 1) im.opacity = it.opacity;
    pg.placedImages.push(im);
    return '.pdfed-placed-img[data-id="' + im.id + '"]';
  }
  return null;
}

// ─── 2b. UPLOAD SPOTS: a logo or picture goes in exactly where the reference had one ───────────────────────────
// Every picture spot the build makes (flag _wsSlot) shows an Upload button ON the spot, in the editor. Click it, or
// drop a picture file on the spot, and the picture is fitted into that exact box:
//   logo   fitted inside the box (never stretched or cropped), kept to the side the reference put it on
//   image  fills the box edge to edge (cropped from the centre), so the box keeps the reference's exact shape
// A logo that repeats on continuation pages is filled on all of them at once. One undo step. An unfilled spot is
// never exported or printed (it holds a transparent pixel; the dashed Upload box is only drawn in the editor).
function wsbFitIntoSlot(B, nw, nh, role, pageW) {
  nw = Math.max(1, nw || 1); nh = Math.max(1, nh || 1);
  if (role !== 'logo') return { x: B.x, y: B.y, w: B.w, h: B.h, crop: true };
  const k = Math.min(B.w / nw, B.h / nh);
  const w = nw * k, h = nh * k;
  const cx = B.x + B.w / 2;
  let x = B.x + (B.w - w) / 2;
  if (pageW) { if (cx < pageW * 0.34) x = B.x; else if (cx > pageW * 0.66) x = B.x + B.w - w; }   // keep to the side it sat on
  return { x: x, y: B.y + (B.h - h) / 2, w: w, h: h, crop: false };
}

function wsbLoadNat(url) {
  return new Promise(function (res) {
    if (!url) { res(null); return; }
    const im = new Image();
    im.onload = function () { res({ w: im.naturalWidth || 300, h: im.naturalHeight || 150, img: im }); };
    im.onerror = function () { res(null); };
    im.src = url;
  });
}

function wsbReadFileUrl(file) {
  return new Promise(function (res, rej) {
    const r = new FileReader();
    r.onload = function () { res(String(r.result || '')); };
    r.onerror = function () { rej(new Error('could not read that file')); };
    r.readAsDataURL(file);
  });
}

// Fills one spot with a loaded picture. Returns what it replaced (for undo).
function wsbFillSlot(item, nat, srcUrl, isSvg, pw) {
  const prev = { dataUrl: item.dataUrl, x: item.x, y: item.y, w: item.w, h: item.h, empty: !!item._wsEmpty, opacity: item.opacity };
  const B = item._wsBox || { x: item.x, y: item.y, w: item.w, h: item.h };
  const f = wsbFitIntoSlot(B, nat.w, nat.h, item._wsRole, pw);
  let url = srcUrl;
  if (!isSvg) {
    const cap = 2000;
    const cv = document.createElement('canvas');
    if (f.crop) {
      // cover: the part of the picture that fills the box, from the centre
      const sc = Math.max(B.w / nat.w, B.h / nat.h), sw = B.w / sc, sh = B.h / sc;
      const out = Math.min(2, cap / Math.max(B.w, B.h));
      cv.width = Math.max(1, Math.round(B.w * out)); cv.height = Math.max(1, Math.round(B.h * out));
      cv.getContext('2d').drawImage(nat.img, (nat.w - sw) / 2, (nat.h - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
      url = cv.toDataURL('image/jpeg', 0.92);
    } else if (Math.max(nat.w, nat.h) > cap) {
      const dn = cap / Math.max(nat.w, nat.h);
      cv.width = Math.round(nat.w * dn); cv.height = Math.round(nat.h * dn);
      cv.getContext('2d').drawImage(nat.img, 0, 0, cv.width, cv.height);
      url = cv.toDataURL('image/png');
    }
  }
  item.dataUrl = url; item._wsEmpty = false;
  item.x = wsbR(f.x); item.y = wsbR(f.y); item.w = wsbR(f.w); item.h = wsbR(f.h);
  delete item.opacity;
  return prev;
}

async function wsbApplySlotFile(idx, item, file) {
  if (!file) return;
  const okType = /^image\//.test(file.type || '') || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name || '');
  if (!okType) { toast('Choose a picture file (PNG, JPG, SVG or WEBP)', 'error'); return; }
  if (file.size > 15 * 1048576) { toast('That picture is over 15 MB. Choose a smaller one', 'error'); return; }
  let url;
  try { url = await wsbReadFileUrl(file); } catch (e) { toast('Could not read that file', 'error'); return; }
  const nat = await wsbLoadNat(url);
  if (!nat) { toast('That file is not a picture the editor can open', 'error'); return; }
  const isSvg = /svg/i.test(file.type || '') || /\.svg$/i.test(file.name || '');
  // A logo repeated on continuation pages is one logo: fill every copy. A picture spot is just that one spot.
  const targets = [];
  pdfed.pages.forEach(function (pg, pi) {
    (pg.placedImages || []).forEach(function (im) {
      if (im === item || (item._wsRole === 'logo' && item._wsGroup && im._wsGroup === item._wsGroup)) targets.push({ pg: pg, pi: pi, im: im });
    });
  });
  const done = targets.map(function (t) {
    const pw = (t.pg.pageMM && t.pg.pageMM[0]) ? wsbPxFor(t.pg.pageMM[0]) : 0;
    return { t: t, prev: wsbFillSlot(t.im, nat, url, isSvg, pw) };
  });
  done.forEach(function (d) { pdfedMarkModified(d.t.pi); });
  pdfedRenderPlacedImages(idx);
  toast((item._wsRole === 'logo' ? 'Logo' : 'Picture') + ' placed in its spot' + (done.length > 1 ? ' on ' + done.length + ' pages' : ''), 'success');
  pushAppHistory({
    label: 'Upload to picture spot',
    undo: function () {
      done.forEach(function (d) {
        const im = d.t.im, v = d.prev;
        im.dataUrl = v.dataUrl; im.x = v.x; im.y = v.y; im.w = v.w; im.h = v.h; im._wsEmpty = v.empty;
        if (v.opacity === undefined) delete im.opacity; else im.opacity = v.opacity;
        pdfedMarkModified(d.t.pi);
      });
      pdfedRenderPlacedImages(pdfed.active);
    },
    redo: function () {
      done.forEach(function (d) { const pw = (d.t.pg.pageMM && d.t.pg.pageMM[0]) ? wsbPxFor(d.t.pg.pageMM[0]) : 0; wsbFillSlot(d.t.im, nat, url, isSvg, pw); pdfedMarkModified(d.t.pi); });
      pdfedRenderPlacedImages(pdfed.active);
    }
  });
}

let wsbSlotInput = null, wsbSlotTarget = null;
function wsbPickForSlot(idx, item) {
  if (!wsbSlotInput) {
    wsbSlotInput = document.createElement('input');
    wsbSlotInput.type = 'file'; wsbSlotInput.accept = 'image/*,.svg'; wsbSlotInput.style.display = 'none';
    wsbSlotInput.addEventListener('change', function () {
      const f = wsbSlotInput.files && wsbSlotInput.files[0], t = wsbSlotTarget;
      wsbSlotInput.value = '';
      if (f && t) wsbApplySlotFile(t.idx, t.item, f);
    });
    document.body.appendChild(wsbSlotInput);
  }
  wsbSlotTarget = { idx: idx, item: item };
  wsbSlotInput.click();
}

// Called by pdfedRenderPlacedImages (js/28) for every picture spot. Adds the Upload button right on the spot.
function wsbMountSlotUpload(el, item, idx) {
  const empty = !!item._wsEmpty, logo = item._wsRole === 'logo';
  el.classList.add('wss', empty ? 'wss-empty' : 'wss-has');
  if (item.w < 120 || item.h < 60) el.classList.add('wss-sm');
  const ov = document.createElement('div');
  ov.className = 'wss-ov';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'wss-btn';
  const label = empty ? (logo ? 'Upload logo' : 'Upload image') : (logo ? 'Replace logo' : 'Replace image');
  btn.title = label + ' here';
  btn.setAttribute('aria-label', label + ' in this spot');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
  const t = document.createElement('span'); t.className = 'wss-t'; t.textContent = label; btn.appendChild(t);
  if (empty) { const s2 = document.createElement('span'); s2.className = 'wss-s'; s2.textContent = 'or drop a file here'; btn.appendChild(s2); }
  ['pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) { btn.addEventListener(ev, function (e) { e.stopPropagation(); }); });
  btn.addEventListener('click', function (e) { e.stopPropagation(); wsbPickForSlot(idx, item); });
  ov.appendChild(btn);
  el.appendChild(ov);
  // drop a picture straight onto the spot
  el.addEventListener('dragover', function (e) {
    const dt = e.dataTransfer;
    if (dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1) { e.preventDefault(); el.classList.add('wss-drop'); }
  });
  el.addEventListener('dragleave', function () { el.classList.remove('wss-drop'); });
  el.addEventListener('drop', function (e) {
    el.classList.remove('wss-drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    wsbApplySlotFile(idx, item, f);
  });
}

// Inserts the empty pages into the document (or starts a new one) as ONE undo step.
async function wsbInsertPages(newPages) {
  const isNewDoc = !pdfed.pages.length;
  const at = isNewDoc ? 0 : (pdfed.active >= 0 ? pdfed.active : pdfed.pages.length - 1) + 1;
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
  if (isNewDoc) { if (typeof pdfedScheduleAutoCollapse === 'function') pdfedScheduleAutoCollapse(); }

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
  return { at: at, isNewDoc: isNewDoc };
}

// ─── 3. THE DOCKED REFERENCE AND KADESSA'S RING ──────────────────────────────
function wsbEl(tag, cls, css) { const e = document.createElement(tag); if (cls) e.className = cls; if (css) e.style.cssText = css; return e; }

function wsbBoxCss(it) { return 'left:' + it.xPct + '%;top:' + it.yPct + '%;width:' + it.wPct + '%;'; }

// A part of the REFERENCE as a small, faithful picture (the right side is the real editor).
function wsbMakeItem(it) {
  let e;
  if (it.kind === 'text') {
    e = wsbEl('div', 'wsb-el wsb-t', wsbBoxCss(it) + 'font:' + (it.italic ? 'italic ' : '') + (it.bold ? '700 ' : '400 ') + it.sizePct + 'cqw/1.25 ' + wsbFontCss(it.fontFamily) +
      ';color:' + it.color + ';text-align:' + it.align + ';opacity:' + it.opacity + (it.underline ? ';text-decoration:underline' : ''));
    e.textContent = it.text;
  } else if (it.kind === 'table') {
    e = wsbEl('div', 'wsb-el wsb-tb', wsbBoxCss(it) + 'height:' + it.hPct + '%;grid-template-columns:' + it.colWidths.map(function (v) { return v + 'fr'; }).join(' ') +
      ';grid-template-rows:' + it.rowHeights.map(function (v) { return v + 'fr'; }).join(' ') + ';font:' + it.sizePct + 'cqw ' + wsbFontCss(it.fontFamily) + ';color:#222');
    it.cells.forEach(function (row, r) {
      row.forEach(function (txt, c) {
        const st = (it.cellStyles[r] && it.cellStyles[r][c]) || {};
        const cell = wsbEl('div', 'wsb-c', 'text-align:' + (st.align || 'left') + ';justify-content:' + (st.align === 'right' ? 'flex-end' : st.align === 'center' ? 'center' : 'flex-start') +
          (st.bold ? ';font-weight:700' : '') + (st.italic ? ';font-style:italic' : '') + (st.color ? ';color:' + st.color : '') + (st.fill ? ';background:' + st.fill : '') +
          (st.topBorder ? ';border-top:2px solid rgba(10,25,45,.55)' : '') + wsbBorderCss(it, r, c));
        cell.textContent = txt;
        e.appendChild(cell);
      });
    });
  } else if (it.kind === 'shape') {
    e = wsbEl('div', 'wsb-el', wsbBoxCss(it) + 'height:' + it.hPct + '%;' + (it.shape === 'line' ? 'min-height:1px;background:' + (it.stroke || it.fill || '#000') :
      'box-sizing:border-box;' + (it.grad ? 'background:linear-gradient(' + (it.grad.dir === 'horizontal' ? 'to right' : it.grad.dir === 'vertical' ? 'to bottom' : 'to bottom right') + ',' + it.grad.c1 + ',' + it.grad.c2 + ');' : (it.fill ? 'background:' + it.fill + ';' : '')) +
        (it.rPct ? 'border-radius:' + it.rPct + 'cqw;' : '') + (it.stroke ? 'border:1px solid ' + it.stroke : '')));
  } else {
    e = wsbEl('div', 'wsb-el wsb-im', wsbBoxCss(it) + 'height:' + it.hPct + '%;opacity:' + it.opacity);
    if (it.brand && it.dataUrl) { const im = wsbEl('img'); im.src = it.dataUrl; im.alt = ''; e.appendChild(im); e.classList.add('brand'); }
    else e.textContent = it.role === 'logo' ? 'Logo' : 'Image';
  }
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

// Docks the reference beside the editor: left half on a wide screen, top part on a narrow one.
// The editor's own page area is pushed over with a margin and re-fitted, so the real page
// stays fully visible and usable next to the reference.
function wsbDock(refPlan, name) {
  const old = document.getElementById('wsbDock');
  if (old && old._ctl) { try { old._ctl.close(); } catch (e) { /* ignore */ } }
  const sc = document.getElementById('pdfedCanvasScroll');
  const ctl = { speed: 1, skipped: false, closed: false, done: false, instant: wsbReduced(), page: -1 };

  const dock = wsbEl('aside', 'wsb-dock');
  dock.id = 'wsbDock'; dock._ctl = ctl;
  dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Reference and Kadessa build');
  dock.innerHTML =
    '<div class="wsb-head"><div class="wsb-ttl"><b>Reference</b><span class="wsb-name"></span></div>' +
    '<button type="button" class="wsb-btn wsb-speed" aria-label="Change speed">x1</button>' +
    '<button type="button" class="wsb-btn wsb-skip">Skip</button></div>' +
    '<div class="wsb-prog" aria-hidden="true"><i></i></div>' +
    '<div class="wsb-body"><div class="wsb-page"></div></div>' +
    '<div class="wsb-foot" aria-live="polite"></div>';
  document.body.appendChild(dock);
  const $ = function (q) { return dock.querySelector(q); };
  $('.wsb-name').textContent = name ? ' · ' + name : '';
  const pageEl = $('.wsb-page'), foot = $('.wsb-foot'), prog = $('.wsb-prog i'), skipBtn = $('.wsb-skip'), speedBtn = $('.wsb-speed');
  let refEls = {};

  const layout = function () {
    if (!sc) return;
    sc.style.marginLeft = ''; sc.style.marginTop = '';
    const r = sc.getBoundingClientRect();
    const narrow = window.innerWidth < 760;
    dock.style.left = r.left + 'px'; dock.style.top = r.top + 'px';
    if (narrow) {
      const h = Math.round(r.height * 0.4);
      dock.style.width = r.width + 'px'; dock.style.height = h + 'px'; sc.style.marginTop = h + 'px';
    } else {
      const w = Math.round(r.width * 0.42);
      dock.style.width = w + 'px'; dock.style.height = r.height + 'px'; sc.style.marginLeft = w + 'px';
    }
    const ar = Number(dock.dataset.ar) || 0.707;
    const body = $('.wsb-body');
    const availH = Math.max(80, body.clientHeight - 8), availW = Math.max(80, body.clientWidth - 8);
    const w2 = Math.min(availW, availH * ar);
    pageEl.style.width = w2 + 'px'; pageEl.style.height = (w2 / ar) + 'px';
  };
  const refit = function () { layout(); try { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); } catch (e) { /* keep zoom */ } };
  const onResize = function () { if (!ctl.closed) refit(); };
  window.addEventListener('resize', onResize);

  ctl.sleepRaw = wsbSleepRaw;
  ctl.say = function (m) { foot.textContent = m; };
  ctl.progress = function (f) { prog.style.width = Math.max(0, Math.min(100, Math.round(f * 100))) + '%'; };
  ctl.sleep = function (ms) { return (ctl.skipped || ctl.instant) ? Promise.resolve() : wsbSleepRaw(ms / ctl.speed); };
  ctl.showPage = function (pi) {
    const RP = refPlan.pages[pi] || refPlan.pages[0];
    ctl.page = pi;
    dock.dataset.ar = RP.ratio;
    pageEl.innerHTML = ''; refEls = {};
    pageEl.style.background = wsbBackground(RP.bg);
    RP.items.forEach(function (it) { const e = wsbMakeItem(it); pageEl.appendChild(e); refEls[it.src] = e; });
    refit();
  };
  ctl.hot = function (src, on) { const e = refEls[src]; if (e) e.classList.toggle('hot', !!on); };
  ctl.finish = function (text) {
    ctl.done = true; ctl.progress(1); ctl.say(text);
    speedBtn.style.display = 'none'; skipBtn.disabled = false; skipBtn.textContent = 'Done'; skipBtn.classList.add('primary'); skipBtn.focus();
  };
  ctl.close = function () {
    if (ctl.closed) return; ctl.closed = true; ctl.skipped = true;
    window.removeEventListener('resize', onResize);
    if (dock.parentNode) dock.parentNode.removeChild(dock);
    if (sc) { sc.style.marginLeft = ''; sc.style.marginTop = ''; try { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); } catch (e) { /* keep zoom */ } }
    if (ctl.ring && ctl.ring.parentNode) ctl.ring.parentNode.removeChild(ctl.ring);
  };
  speedBtn.onclick = function () { ctl.speed = ctl.speed === 1 ? 2 : (ctl.speed === 2 ? 4 : 1); speedBtn.textContent = 'x' + ctl.speed; };
  skipBtn.onclick = function () { if (ctl.done) ctl.close(); else { ctl.skipped = true; skipBtn.disabled = true; } };
  dock.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (ctl.done) ctl.close(); else ctl.skipped = true; } });
  skipBtn.focus();
  ctl.showPage(0);
  return ctl;
}

// Kadessa's ring, the same one she uses on Data Arrangement (.kfx-ring in css/26-kadessa.css).
function wsbRingTo(ctl, el, ms) {
  if (!el || ctl.skipped || ctl.instant) return;
  if (!ctl.ring || !ctl.ring.isConnected) {
    const d = wsbEl('div', 'kfx-ring'); d.style.zIndex = '99991';
    const t = wsbEl('span', 'kfx-tag'); t.textContent = 'Kadessa'; d.appendChild(t);
    document.body.appendChild(d); ctl.ring = d;
    const b0 = el.getBoundingClientRect();
    d.style.transitionDuration = '0ms';
    d.style.left = (b0.left - 4) + 'px'; d.style.top = (b0.top - 4) + 'px';
    d.style.width = (b0.width + 8) + 'px'; d.style.height = (b0.height + 8) + 'px';
    void d.offsetWidth;
  }
  const b = el.getBoundingClientRect();
  if (b.width < 2 || b.height < 2) return;
  const d = ctl.ring;
  d.classList.remove('done');
  d.style.transitionDuration = Math.round(ms / ctl.speed) + 'ms';
  d.style.left = (b.left - 4) + 'px'; d.style.top = (b.top - 4) + 'px';
  d.style.width = (b.width + 8) + 'px'; d.style.height = (b.height + 8) + 'px';
  d.classList.toggle('below', b.top < 34);
  d.classList.add('on');
}

// ─── 4. BUILD, LIVE ──────────────────────────────────────────────────────────
// Order of work, so an interrupted animation can never leave a half-built document:
//   1. the empty pages go into the editor (one undo step)
//   2. each part is added as a real object, with the ring gliding to it
//   3. whatever the animation did not reach (Skip, Close, an error) is added at once
async function wsbBuildLive(refPlan, plan, name, animate) {
  wsbEnsureEditorOpen();
  for (let i = 0; i < plan.fonts.length; i++) { try { await pdfedKadessaEnsureFont(plan.fonts[i]); } catch (e) { /* default font */ } }
  wsbBuildSeq++;
  try { const bn = await wsbLoadNat(wsbBrandLogo()); wsbBrandNat = bn ? { w: bn.w, h: bn.h } : null; } catch (e) { wsbBrandNat = null; }
  const made = [];
  let bgNote = '';
  for (let pi = 0; pi < plan.pages.length; pi++) { const m = await wsbNewPage(plan.pages[pi]); made.push(m.pg); if (m.note) bgNote = m.note; }
  const where = await wsbInsertPages(made);
  const ctl = animate ? wsbDock(refPlan, name) : null;

  const total = plan.pages.reduce(function (n, p) { return n + p.items.length; }, 0) || 1;
  let count = 0;
  try {
    for (let pi = 0; pi < plan.pages.length; pi++) {
      const P = plan.pages[pi], pg = made[pi], idx = where.at + pi;
      if (ctl && !ctl.closed) {
        if (pi > 0) { if (ctl.ring) ctl.ring.classList.remove('on'); await pdfedGoto(idx); }
        ctl.showPage(P.index);
        await ctl.sleep(150);
      }
      for (let k = 0; k < P.items.length; k++) {
        const it = P.items[k];
        const sel = wsbAddItem(pg, it);
        count++;
        if (!ctl || ctl.closed || ctl.skipped || ctl.instant) continue;
        ctl.hot(it.src, true);
        ctl.say((it.kind === 'table' ? 'Drawing ' : (it.kind === 'text' ? 'Writing ' : 'Placing ')) + (WSB_NAMES[it.role] || it.role) + '…');
        pdfedRenderAllPlaced(idx);
        const el = sel ? document.querySelector(sel) : null;
        if (el) { el.classList.add('kfx-reveal'); wsbRingTo(ctl, el, 230); }
        ctl.progress(count / total);
        await ctl.sleep(it.kind === 'table' ? 330 : 190);
        ctl.hot(it.src, false);
      }
      // Draw this page once more so everything (including anything skipped past) is on screen.
      if (!ctl || ctl.closed || ctl.skipped || ctl.instant) { await pdfedGoto(idx); }
      else pdfedRenderAllPlaced(idx);
    }
  } catch (e) {
    console.error('Workstyle live build:', e);
    // Add whatever was not reached, so the document is never half-built.
    for (let pi = 0; pi < plan.pages.length; pi++) {
      const have = made[pi].placedTexts.length + made[pi].placedTables.length + made[pi].placedImages.length;
      const want = plan.pages[pi].items.length;
      if (have < want) plan.pages[pi].items.slice(have).forEach(function (it) { try { wsbAddItem(made[pi], it); } catch (e2) { /* skip */ } });
    }
    try { await pdfedGoto(pdfed.active); } catch (e3) { /* ignore */ }
  }
  try { await pdfedBuildStrip(); } catch (e) { /* thumbnails refresh later */ }
  if (ctl && !ctl.closed) {
    if (ctl.ring) { ctl.ring.classList.add('done'); setTimeout(function () { if (ctl.ring) ctl.ring.classList.remove('on'); }, 900); }
    ctl.finish('Done. Everything on the right is real, editable text, tables and image slots.');
  }
  return { at: where.at, pages: made.length, bgNote: bgNote };
}

// ─── PUBLIC ──────────────────────────────────────────────────────────────────
function wsbCounts(plan) {
  let t = 0, tb = 0, im = 0;
  plan.pages.forEach(function (p) { p.items.forEach(function (i) { if (i.kind === 'text') t++; else if (i.kind === 'table') tb++; else if (i.kind === 'image') im++; }); });
  const parts = [];
  if (t) parts.push(t + ' text box' + (t === 1 ? '' : 'es'));
  if (tb) parts.push(tb + ' table' + (tb === 1 ? '' : 's'));
  if (im) parts.push(im + ' image slot' + (im === 1 ? '' : 's'));
  return parts.join(', ');
}

// opts: { fill?: [...], animate?: boolean (default true) }
async function wstyleBuild(nameOrId, opts) {
  opts = opts || {};
  // 5 builds a day, for every way of building (the panel and Kadessa's chat tool). See js/63.
  if (typeof wsfBuildsLeft === 'function' && wsfBuildsLeft() <= 0) { const le = new Error(wsfLimitMessage()); le.limit = true; throw le; }
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

  const done = await wsbBuildLive(refPlan, plan, style.name, opts.animate !== false);
  const left = (typeof wsfCountBuild === 'function') ? wsfCountBuild() : null;   // only a finished build counts

  const at = done.at === 0 ? 'in a new document' : 'after page ' + done.at;
  let spots = 0;
  plan.pages.forEach(function (p) { p.items.forEach(function (i) { if (i.kind === 'image' && !i.brand) spots++; }); });
  const logoNote = spots ? ' ' + spots + ' logo / image spot' + (spots === 1 ? ' is' : 's are') + ' ready: click Upload on a spot, or drop a picture on it, and it is fitted exactly there.' : '';
  const colorNote = plan.contrastFixed ? ' ' + plan.contrastFixed + ' text colour' + (plan.contrastFixed === 1 ? ' was' : 's were') + ' switched to stay readable on the colour behind ' + (plan.contrastFixed === 1 ? 'it' : 'them') + '.' : '';
  const skipNote = plan.skipped ? ' Left out ' + plan.skipped + ' part' + (plan.skipped === 1 ? '' : 's') + ' of the reference your content had nothing for.' : '';
  return {
    say: (plan.template ? 'Built ' + (done.pages === 1 ? 'a new page' : done.pages + ' new pages') + ' in the "' + style.name + '" look with your content' + (plan.pages.some(function (p) { return p.cont; }) ? ' (longer than the reference, so it continues on extra pages with the same look)' : '') : 'Built an identical copy of "' + style.name + '"') +
      ' ' + at + ' (' + wsbCounts(plan) + ').' + skipNote + colorNote + logoNote + (done.bgNote ? ' ' + done.bgNote.trim() : ''),
    pages: done.pages,
    skipped: plan.skipped,
    left: left
  };
}
