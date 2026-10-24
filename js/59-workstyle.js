// ─── WORKSTYLE, STEP 1: SAVE A WORK STYLE FROM A REFERENCE ─────────────────
// The person finishes a piece of work in the PDF Editor and tells Kadessa to
// "save this as a work style". This file MEASURES that work with plain code
// (fonts, sizes, colors, margins, positions, table look, page background)
// and keeps the result under a name. Nothing here asks an AI to look at the
// page, so the numbers are exact and repeatable.
//
// Later steps (not in this file yet):
//   2. Kadessa builds in a saved style: js/62-workstyle-build.js (identical copy, or new words in the same look).
//   3. The split screen and the animated cursor sit on top of step 2 (same file).
//
// Storage: localStorage under 'sarvarcWorkstyles_v1'. The account-scoping shim
// at the top of js/03-account-storage.js namespaces every key by the signed-in
// user, so each account only ever sees its own styles on this device.
//
// What gets saved per page (all positions and sizes are PERCENT of the page,
// so a style learned on an A4 page can later be applied to any page shape):
//   page   { pageMM, ratio, bg, margins, rhythm }
//   items  text  { role, xPct, yPct, wPct, hPct, sizePct, fontFamily, color,
//                  gradient, bold, italic, underline, align, opacity, chars, text }
//          table { role:'table', xPct, yPct, wPct, hPct, colPct[], rowHPct[],
//                  sizePct, fontFamily, headerRow, headerCell, bodyCell,
//                  lastRowCell, colAlign[], zebra, rows, cols, cells,
//                  borderStyle { color, width, rows, cols, outer, headRule } | null }
//          image { role:'image'|'logo', xPct, yPct, wPct, hPct, opacity }
//
// PRIVACY NOTE for step 2: the `text` / `cells` fields hold the reference's own
// words so the left pane can show the reference later. They stay on the device.
// When the style is sent to the Worker, strip them and send only the structure
// (use wstyleStripForWorker below).
//
// Reading order of a page's `items` is top to bottom, then left to right.

const WSTYLE_STORE_KEY = 'sarvarcWorkstyles_v1';
const WSTYLE_VERSION = 1;
const WSTYLE_MAX_STYLES = 20;
const WSTYLE_MAX_PAGES = 12;
const WSTYLE_MAX_ITEMS_PER_PAGE = 80;

// ─── small helpers ───────────────────────────────────────────────────────────
function wstyleRound(n, d) {
  const k = Math.pow(10, d === undefined ? 1 : d);
  return Math.round((Number(n) || 0) * k) / k;
}

function wstylePct(v, total) {
  if (!total) return 0;
  return wstyleRound((Number(v) || 0) / total * 100, 2);
}

function wstyleClone(o) {
  if (o === undefined || o === null) return null;
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
}

function wstyleHex(c) {
  const s = String(c || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

function wstyleRgbToHex(rgb) {
  const h = function (n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); };
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

function wstyleMedian(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ─── nearest font ────────────────────────────────────────────────────────────
// A reference may use a font the editor does not have. Instead of falling back to one default for everything,
// pick the closest font the editor DOES have: same kind (serif, mono, script, rounded, condensed, heavy
// display, plain sans). The first font of each kind that is in the font library wins.
function wstyleFontKnown(name) {
  try {
    if (typeof SARVARC_FONT_LIBRARY === 'undefined') return null;
    const k = String(name || '').trim().toLowerCase();
    for (let i = 0; i < SARVARC_FONT_LIBRARY.length; i++) if (String(SARVARC_FONT_LIBRARY[i]).toLowerCase() === k) return SARVARC_FONT_LIBRARY[i];
  } catch (e) { /* no library */ }
  return null;
}
function wstyleFirstKnown(list) {
  for (let i = 0; i < list.length; i++) { const f = wstyleFontKnown(list[i]); if (f) return f; }
  return null;
}
function wstyleNearestFont(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Inter';
  const exact = wstyleFontKnown(raw);
  if (exact) return exact;
  // the same family without a weight or width word: "Roboto Light" -> "Roboto"
  const bare = raw.replace(/\b(thin|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique|condensed|narrow|cond|std|pro|mt|ps|lt|com)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  const bareHit = bare && wstyleFontKnown(bare);
  if (bareHit) return bareHit;
  // common system fonts that have a close, free twin
  const twins = { 'helvetica': 'Arimo', 'helvetica neue': 'Arimo', 'arial': 'Arimo', 'times': 'Tinos', 'times new roman': 'Tinos', 'calibri': 'Carlito', 'cambria': 'Caladea',
    'segoe ui': 'Open Sans', 'tahoma': 'Open Sans', 'verdana': 'Open Sans', 'trebuchet ms': 'Fira Sans', 'georgia': 'Gelasio', 'garamond': 'EB Garamond',
    'palatino': 'Lora', 'book antiqua': 'Lora', 'bookman': 'Bitter', 'century gothic': 'Poppins', 'gill sans': 'Lato', 'futura': 'Jost', 'avenir': 'Nunito Sans',
    'myriad': 'Source Sans Pro', 'minion': 'Crimson Text', 'baskerville': 'Libre Baskerville', 'didot': 'Playfair Display', 'bodoni': 'Playfair Display',
    'optima': 'Marcellus', 'rockwell': 'Zilla Slab', 'impact': 'Anton', 'courier': 'Courier New', 'consolas': 'Source Code Pro', 'menlo': 'Source Code Pro', 'monaco': 'Source Code Pro' };
  const low = raw.toLowerCase();                       // with the weight and width words: they say what kind it is
  const tw = twins[(bare || raw).toLowerCase()] || twins[low];
  if (tw) { const t = wstyleFontKnown(tw); if (t) return t; }
  const has = function (re) { return re.test(low); };
  let pick = null;
  if (has(/mono|courier|consol|code|typewriter|menlo|terminal/)) pick = wstyleFirstKnown(['Source Code Pro', 'Roboto Mono', 'Courier New', 'Fira Code']);
  else if (has(/script|hand|brush|cursive|callig|signature|marker|pen\b/)) pick = wstyleFirstKnown(['Pacifico', 'Dancing Script', 'Yellowtail', 'Kalam']);
  else if (has(/round/)) pick = wstyleFirstKnown(['Varela Round', 'Nunito', 'Comfortaa']);
  else if (has(/cond|narrow|compress|gothic ?(cond|narrow)/)) pick = wstyleFirstKnown(['Roboto Condensed', 'Oswald', 'Saira Condensed', 'Barlow Condensed']);
  else if (has(/black|heavy|poster|impact|fat|ultra|display/)) pick = wstyleFirstKnown(['Archivo Black', 'Anton', 'Poppins']);
  else if (has(/serif/) && !has(/sans/)) pick = wstyleFirstKnown(['PT Serif', 'Noto Serif', 'Tinos', 'Libre Baskerville']);
  else if (has(/roman|garamond|baskerv|caslon|bodoni|didot|palat|antiqua|minion|georgia|cambria|century|times|mincho|song|serif/) && !has(/sans|grotesk|gothic/)) pick = wstyleFirstKnown(['PT Serif', 'Noto Serif', 'Libre Baskerville', 'Tinos']);
  else if (has(/slab|egyptian|rockwell|clarendon/)) pick = wstyleFirstKnown(['Zilla Slab', 'Bitter', 'Arvo']);
  return pick || wstyleFirstKnown(['Inter', 'Open Sans', 'Arimo']) || 'Inter';
}

// ─── colour understanding ────────────────────────────────────────────────────
// Reads the reference's colours by ROLE, not just as a list: the page background, the MAIN colour (the one that
// carries the most area or the headings: header band, table header, title), an ACCENT (a second, different hue:
// rules, highlights), the TEXT colour (the one that reads best on the background) and a MUTED colour (captions
// and footer). Used to show what was learned (panel) and to repair text that would become unreadable when a
// part moves off the box it was written on (js/62 wsbFixContrast).
function wstyleRgbOf(hex) {
  const h = wstyleHex(hex);
  return h ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null;
}
function wstyleLuminance(hex) {
  const c = wstyleRgbOf(hex);
  if (!c) return 0;
  const f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function wstyleContrast(a, b) {
  const l1 = wstyleLuminance(a), l2 = wstyleLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function wstyleChroma(hex) {
  const c = wstyleRgbOf(hex);
  return c ? (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255 : 0;
}
function wstyleColorDist(a, b) {
  const x = wstyleRgbOf(a), y = wstyleRgbOf(b);
  if (!x || !y) return 0;
  return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2));
}

function wstylePalette(pages) {
  const bgW = {}, fillW = {}, textW = {}, mutedW = {};
  const add = function (m, c, w) { c = wstyleHex(c); if (c && w > 0) m[c] = (m[c] || 0) + w; };
  const top = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }); };
  let bg = '#ffffff';
  (pages || []).forEach(function (p, i) {
    const b = p.bg || {};
    if (i === 0 && wstyleHex(b.color1)) bg = wstyleHex(b.color1);
    add(bgW, b.color1, 1); add(bgW, b.color2, 0.5);
    (p.items || []).forEach(function (it) {
      if (it.kind === 'shape') {
        const line = it.shape === 'line';
        const w = line ? Math.max(1, (it.wPct || 0) * 0.5) : Math.max(0.05, (it.wPct || 0) * (it.hPct || 0) / 10);
        add(fillW, it.fill || (it.grad && it.grad.c1), w);
        if (it.grad && it.grad.c2) add(fillW, it.grad.c2, w * 0.5);
        if (it.stroke && !it.fill) add(fillW, it.stroke, w * 0.5);
      } else if (it.kind === 'text') {
        const w = Math.max(1, it.chars || 1) * (it.sizePct || 3);
        add(textW, it.color, w);
        if (it.role === 'caption' || it.role === 'footer') add(mutedW, it.color, w);
        if ((it.role === 'title' || it.role === 'heading') && wstyleChroma(it.color) >= 0.18) add(fillW, it.color, w / 8);
      } else if (it.kind === 'table') {
        const hf = it.headerCell && it.headerCell.fill;
        add(fillW, hf, Math.max(0.5, (it.wPct || 0) * (it.hPct || 0) / 40));
      }
    });
  });
  const away = function (c) { return wstyleColorDist(c, bg) > 40; };
  const textList = top(textW);
  const text = textList.filter(function (c) { return wstyleContrast(c, bg) >= 3; })[0] || textList[0] || (wstyleLuminance(bg) < 0.4 ? '#ffffff' : '#111111');
  const pool = top(fillW).filter(away);
  const chromatic = pool.filter(function (c) { return wstyleChroma(c) >= 0.18; });
  const primary = chromatic[0] || pool[0] || text;
  const accent = chromatic.filter(function (c) { return wstyleColorDist(c, primary) >= 90; })[0] || null;
  const muted = top(mutedW).filter(function (c) { return c !== text; })[0] || null;
  const list = [bg, primary, accent, text, muted].filter(function (c, i, a) { return c && a.indexOf(c) === i; });
  return { background: bg, primary: primary, accent: accent, text: text, muted: muted, list: list };
}
// Styles saved before the palette existed get it worked out when asked for.
function wstylePaletteOf(style) {
  if (!style) return null;
  if (style.palette && style.palette.background) return style.palette;
  try { return wstylePalette(style.pages || []); } catch (e) { return null; }
}

// ─── the per-account store ───────────────────────────────────────────────────
function wstyleReadAll() {
  try {
    const raw = localStorage.getItem(WSTYLE_STORE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function wstyleWriteAll(list) {
  try {
    localStorage.setItem(WSTYLE_STORE_KEY, JSON.stringify(list));
  } catch (e) {
    throw new Error('this device has no room left to store another work style. Delete an old one and try again');
  }
}

// Short summaries only, for menus and for Kadessa to read back.
function wstyleList() {
  return wstyleReadAll().map(function (s) {
    return {
      id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt,
      pages: (s.pages || []).length,
      source: s.source || null
    };
  });
}

function wstyleGet(idOrName) {
  const q = String(idOrName || '').trim().toLowerCase();
  if (!q) return null;
  const all = wstyleReadAll();
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === idOrName || String(all[i].name || '').trim().toLowerCase() === q) return all[i];
  }
  return null;
}

function wstyleDelete(idOrName) {
  const target = wstyleGet(idOrName);
  if (!target) return false;
  wstyleWriteAll(wstyleReadAll().filter(function (s) { return s.id !== target.id; }));
  return true;
}

// What is safe to send to the Worker: the structure of the style with the
// reference's own words removed.
function wstyleStripForWorker(style) {
  const copy = wstyleClone(style) || {};
  (copy.pages || []).forEach(function (pg) {
    (pg.items || []).forEach(function (it) {
      if ('text' in it) it.text = null;
      if ('cells' in it) it.cells = null;
    });
  });
  return copy;
}

// ─── measuring one page ──────────────────────────────────────────────────────
function wstyleLoadImage(src) {
  return new Promise(function (res, rej) {
    const im = new Image();
    im.onload = function () { res(im); };
    im.onerror = rej;
    im.src = src;
  });
}

// Reads the page background from the page bitmap. Looks at the four corners
// (small patches, so a margin of white around the content does not fool it).
// Returns { mode: 'solid'|'gradient'|'image', color1, color2, direction }.
async function wstyleSampleBackground(pg) {
  const fallback = { mode: 'solid', color1: wstyleHex(pg && pg.bgColor) || '#ffffff', color2: null, direction: null };
  try {
    if (!pg || !pg.dataUrl) return fallback;
    const img = await wstyleLoadImage(pg.dataUrl);
    const S = 100, P = 3;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, S, S);
    const patch = function (x0, y0) {
      const d = cx.getImageData(x0, y0, P, P).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 20) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      return n ? [r / n, g / n, b / n] : null;
    };
    const tl = patch(0, 0), tr = patch(S - P, 0), bl = patch(0, S - P), br = patch(S - P, S - P);
    if (!tl || !tr || !bl || !br) return fallback;
    const dist = function (a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); };
    const avg = function () {
      const a = Array.prototype.slice.call(arguments);
      return [0, 1, 2].map(function (k) { return a.reduce(function (s, p) { return s + p[k]; }, 0) / a.length; });
    };
    const TH = 36;
    const top = dist(tl, tr) <= TH, bottom = dist(bl, br) <= TH;
    const left = dist(tl, bl) <= TH, right = dist(tr, br) <= TH;
    if (top && bottom && left && right) {
      return { mode: 'solid', color1: wstyleRgbToHex(avg(tl, tr, bl, br)), color2: null, direction: null };
    }
    if (top && bottom && !left && !right) {
      return { mode: 'gradient', color1: wstyleRgbToHex(avg(tl, tr)), color2: wstyleRgbToHex(avg(bl, br)), direction: 'vertical' };
    }
    if (left && right && !top && !bottom) {
      return { mode: 'gradient', color1: wstyleRgbToHex(avg(tl, bl)), color2: wstyleRgbToHex(avg(tr, br)), direction: 'horizontal' };
    }
    if (dist(tl, br) > TH && dist(tr, bl) <= TH) {
      return { mode: 'gradient', color1: wstyleRgbToHex(tl), color2: wstyleRgbToHex(br), direction: 'diagonal' };
    }
    return { mode: 'image', color1: wstyleRgbToHex(avg(tl, tr, bl, br)), color2: null, direction: null };
  } catch (e) {
    return fallback;
  }
}

// Text boxes have no stored height. When the page is on screen the real DOM
// height is used (same approach as pdfedKadessaContentBottomPx); otherwise the
// text is measured with the same font stack, wrapping and padding.
function wstyleTextHeight(pg, idx, t, W) {
  try {
    if (t._hOverride) return t._hOverride;
    if (idx >= 0 && idx === pdfed.active) {
      const el = document.querySelector('.pdfed-placed-text[data-id="' + t.id + '"]');
      if (el && el.offsetHeight) return el.offsetHeight;
    }
    return pdfedKadessaMeasure(t.text || '', t.fontFamily || 'Inter', t.fontSize || 13, !!t.bold, !!t.italic, t.w || W * 0.8);
  } catch (e) {
    return (t.fontSize || 13) * 1.4;
  }
}

// Gives every text item a role from its size compared with the page's body
// size. Body size = the size that carries the most characters.
function wstyleAssignRoles(texts) {
  if (!texts.length) return;
  const weight = {};
  texts.forEach(function (t) { weight[t._fs] = (weight[t._fs] || 0) + Math.max(1, t.chars); });
  let bodySize = texts[0]._fs, best = -1;
  Object.keys(weight).forEach(function (k) {
    if (weight[k] > best) { best = weight[k]; bodySize = Number(k); }
  });
  texts.forEach(function (t) {
    const r = bodySize ? t._fs / bodySize : 1;
    let role = 'body';
    if (r >= 2) role = 'title';
    else if (r >= 1.35) role = 'heading';
    else if (r >= 1.1) role = 'subheading';
    else if (r <= 0.85) role = 'caption';
    if (t.yPct >= 90 && r <= 1.05 && t.chars < 90) role = 'footer';
    t.role = role;
  });
}

function wstyleMeasureTable(tb, W, H) {
  const colW = (tb.colWidths || []).map(Number);
  const rowH = (tb.rowHeights || []).map(Number);
  const totalW = colW.reduce(function (a, b) { return a + b; }, 0) || 1;
  const totalH = rowH.reduce(function (a, b) { return a + b; }, 0);
  const cs = Array.isArray(tb.cellStyles) ? tb.cellStyles : null;
  const cellAt = function (r, c) { return cs && cs[r] && cs[r][c] ? wstyleClone(cs[r][c]) : null; };
  const lastRow = (tb.rows || rowH.length) - 1;
  const fillAt = function (r) { const s = cellAt(r, 0); return s ? (s.fill || null) : null; };
  const colAlign = [];
  for (let c = 0; c < (tb.cols || colW.length); c++) {
    const s = cellAt(1, c) || cellAt(0, c);
    colAlign.push((s && s.align) || 'left');
  }
  const bodyRows = rowH.slice(tb.headerRow ? 1 : 0);
  // Per-column looks for the header, body, alternate and last rows, so a table
  // rebuilt later (js/62-workstyle-build.js) matches the original column by column.
  const nCols = tb.cols || colW.length;
  const rowCells = function (r) {
    const out = [];
    for (let c = 0; c < nCols; c++) out.push(cellAt(r, c));
    return out;
  };
  return {
    kind: 'table', role: 'table',
    xPct: wstylePct(tb.x, W), yPct: wstylePct(tb.y, H),
    wPct: wstylePct(totalW, W), hPct: wstylePct(totalH, H),
    colPct: colW.map(function (w) { return wstyleRound(w / totalW * 100, 2); }),
    rowHPct: rowH.slice(0, 40).map(function (h) { return wstylePct(h, H); }),
    bodyRowHPct: wstylePct(wstyleMedian(bodyRows), H),
    sizePct: wstylePct(tb.fontSize || 12, W),
    fontFamily: tb.fontFamily || 'Inter',
    headerRow: !!tb.headerRow,
    headerCell: cellAt(0, 0),
    bodyCell: cellAt(1, 0),
    lastRowCell: lastRow > 1 ? cellAt(lastRow, 0) : null,
    headerCells: rowCells(0),
    bodyCells: rowCells(1),
    altCells: rowH.length > 2 ? rowCells(2) : null,
    lastRowCells: lastRow > 1 ? rowCells(lastRow) : null,
    colAlign: colAlign,
    zebra: !!(cs && rowH.length > 3 && fillAt(1) !== fillAt(2)),
    rows: tb.rows || rowH.length,
    cols: tb.cols || colW.length,
    cells: wstyleClone(tb.cells),
    borderStyle: tb.borderStyle ? wstyleClone(tb.borderStyle) : null,
    _y: tb.y || 0, _x: tb.x || 0
  };
}

async function wstyleMeasurePage(pg, idx) {
  // idx < 0 means a page that is not in the editor (read from a PDF file). With an empty editor,
  // pdfed.active is also -1, so asking the editor would return the blank 300x150 canvas.
  const sz = idx < 0
    ? (function () { const m = (pg && pg.pageMM) || [210, 297]; return [Math.max(1, Math.round(m[0] * 3.7795)), Math.max(1, Math.round(m[1] * 3.7795))]; })()
    : pdfedKadessaPageSizePx(pg, idx);
  const W = sz[0], H = sz[1];
  const mm = (pg.pageMM && pg.pageMM.length === 2) ? [wstyleRound(pg.pageMM[0], 1), wstyleRound(pg.pageMM[1], 1)]
    : [wstyleRound(W / 3.7795, 1), wstyleRound(H / 3.7795, 1)];

  // Text
  const texts = [];
  (pg.placedTexts || []).forEach(function (t) {
    const h = wstyleTextHeight(pg, idx, t, W);
    const w = t.w || W * 0.8;
    texts.push({
      kind: 'text', role: 'body',
      xPct: wstylePct(t.x, W), yPct: wstylePct(t.y, H),
      wPct: wstylePct(w, W), hPct: wstylePct(h, H),
      sizePct: wstylePct(t.fontSize || 13, W),
      fontFamily: t.fontFamily || 'Inter',
      color: wstyleHex(t.color) || '#111111',
      gradient: wstyleClone(t.gradient),
      bold: !!t.bold, italic: !!t.italic, underline: !!t.underline,
      align: t.align || 'left',
      opacity: (t.opacity === undefined || t.opacity === null) ? 1 : wstyleRound(t.opacity, 2),
      chars: String(t.text || '').length,
      text: String(t.text || ''),
      _fs: t.fontSize || 13, _y: t.y || 0, _x: t.x || 0
    });
  });
  wstyleAssignRoles(texts);

  // Tables
  const tables = (pg.placedTables || []).map(function (tb) { return wstyleMeasureTable(tb, W, H); });

  // Images (slots only, never the picture itself)
  const images = (pg.placedImages || []).map(function (im) {
    const xPct = wstylePct(im.x, W), yPct = wstylePct(im.y, H), wPct = wstylePct(im.w, W), hPct = wstylePct(im.h, H);
    const small = wPct < 22 && (yPct < 15 || yPct + hPct > 85);
    return {
      kind: 'image', role: small ? 'logo' : 'image',
      xPct: xPct, yPct: yPct, wPct: wPct, hPct: hPct,
      opacity: (im.opacity === undefined || im.opacity === null) ? 1 : wstyleRound(im.opacity, 2),
      _y: im.y || 0, _x: im.x || 0
    };
  });

  // Lines and boxes (never counted in margins or rhythm, they are decoration)
  const shapes = (pg.placedShapes || []).slice(0, 40).map(function (sh) {
    return {
      kind: 'shape', role: 'shape', shape: sh.rule ? 'line' : 'rect',
      xPct: wstylePct(sh.x, W), yPct: wstylePct(sh.y, H), wPct: wstylePct(sh.w, W), hPct: wstylePct(sh.h, H),
      fill: wstyleHex(sh.fill), stroke: wstyleHex(sh.stroke), swPct: wstylePct(sh.sw || 0, W),
      rPct: wstylePct(sh.r || 0, W), grad: sh.grad ? wstyleClone(sh.grad) : null,
      geom: (!sh.rule && typeof sh.geom === 'string') ? sh.geom : null
    };
  }).filter(function (sh) { return sh.wPct > 0 || sh.hPct > 0; });

  // Reading order: top to bottom, then left to right (1% row tolerance).
  let items = texts.concat(tables, images);
  items.sort(function (a, b) {
    const dy = a.yPct - b.yPct;
    return Math.abs(dy) > 1 ? dy : a.xPct - b.xPct;
  });
  if (items.length > WSTYLE_MAX_ITEMS_PER_PAGE) items = items.slice(0, WSTYLE_MAX_ITEMS_PER_PAGE);

  // Margins and vertical rhythm
  let margins = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 };
  const gaps = [];
  if (items.length) {
    margins = {
      leftPct: wstyleRound(Math.max(0, Math.min.apply(null, items.map(function (i) { return i.xPct; }))), 2),
      rightPct: wstyleRound(Math.max(0, 100 - Math.max.apply(null, items.map(function (i) { return i.xPct + i.wPct; }))), 2),
      topPct: wstyleRound(Math.max(0, Math.min.apply(null, items.map(function (i) { return i.yPct; }))), 2),
      bottomPct: wstyleRound(Math.max(0, 100 - Math.max.apply(null, items.map(function (i) { return i.yPct + i.hPct; }))), 2)
    };
    for (let i = 1; i < items.length; i++) {
      const g = items[i].yPct - (items[i - 1].yPct + items[i - 1].hPct);
      if (g > 0) gaps.push(wstyleRound(g, 2));
    }
  }

  const bg = await wstyleSampleBackground(pg);
  items = items.concat(shapes);   // after the measuring above, so decoration never skews margins

  // Drop the private working fields before the item leaves this function.
  items.forEach(function (it) { delete it._fs; delete it._y; delete it._x; });

  return {
    index: idx,
    pageMM: mm,
    ratio: wstyleRound(W / H, 4),
    bg: bg,
    margins: margins,
    rhythm: { gapsPct: gaps.slice(0, 40), medianGapPct: wstyleRound(wstyleMedian(gaps), 2) },
    items: items
  };
}

// ─── saving ──────────────────────────────────────────────────────────────────
// scope: 'all' (default, every page of the open document, up to 12) or
//        'current' (only the page on screen).
async function wstyleSaveFromEditor(name, opts) {
  opts = opts || {};
  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    throw new Error('open the finished work in the PDF Editor first, then I can learn its style');
  }
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!cleanName) throw new Error('give the work style a name first');

  const scope = opts.scope === 'current' ? 'current' : 'all';
  const idxs = [];
  if (scope === 'current') idxs.push(pdfed.active);
  else for (let i = 0; i < pdfed.pages.length && idxs.length < WSTYLE_MAX_PAGES; i++) idxs.push(i);

  const pages = [];
  for (let k = 0; k < idxs.length; k++) {
    pages.push(await wstyleMeasurePage(pdfed.pages[idxs[k]], idxs[k]));
  }

  return wstyleStoreMeasured(cleanName, pages, {
    docName: (pdfed.file && pdfed.file.name) || '',
    scope: scope
  });
}

// Shared by the editor path above and the PDF file reader (js/60-workstyle-pdf.js):
// checks there is something to learn from, then saves (or updates) under the name.
function wstyleStoreMeasured(cleanName, pages, source) {
  let nText = 0, nTable = 0, nImage = 0;
  pages.forEach(function (p) {
    p.items.forEach(function (it) {
      if (it.kind === 'text') nText++; else if (it.kind === 'table') nTable++; else if (it.kind === 'image') nImage++;
    });
  });
  if (nText + nTable + nImage === 0) {
    throw new Error('that page has no text, tables or images on it yet, so there is no style to learn. Text that is only part of the scanned picture cannot be measured, run Make Editable on it first');
  }

  const now = Date.now();
  const all = wstyleReadAll();
  const existing = all.filter(function (s) { return String(s.name || '').trim().toLowerCase() === cleanName.toLowerCase(); })[0];
  if (!existing && all.length >= WSTYLE_MAX_STYLES) {
    throw new Error('you already have ' + WSTYLE_MAX_STYLES + ' work styles saved. Delete one before saving another');
  }

  const style = {
    v: WSTYLE_VERSION,
    id: existing ? existing.id : 'ws_' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    name: cleanName,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    source: Object.assign({ pageCount: pages.length }, source || {}),
    palette: (function () { try { return wstylePalette(pages); } catch (e) { return null; } })(),
    pages: pages
  };

  const next = existing
    ? all.map(function (s) { return s.id === existing.id ? style : s; })
    : all.concat([style]);
  wstyleWriteAll(next);

  const parts = [];
  if (nText) parts.push(nText + ' text box' + (nText === 1 ? '' : 'es'));
  if (nTable) parts.push(nTable + ' table' + (nTable === 1 ? '' : 's'));
  if (nImage) parts.push(nImage + ' image slot' + (nImage === 1 ? '' : 's'));
  return {
    id: style.id,
    say: (existing ? 'Updated the work style "' : 'Saved the work style "') + cleanName + '" from ' +
      pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' (' + parts.join(', ') + ').'
  };
}

// Plain sentence for Kadessa to post when the person asks what styles exist.
function wstyleListSay() {
  const list = wstyleList();
  if (!list.length) return 'You have no saved work styles yet. Finish a piece of work, then say "save this as a work style" and give it a name.';
  return 'Your work styles: ' + list.map(function (s) {
    return '"' + s.name + '" (' + s.pages + ' page' + (s.pages === 1 ? '' : 's') + ')';
  }).join(', ') + '.';
}
