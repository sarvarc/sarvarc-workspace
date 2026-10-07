// ─── LOAD PDF ───
// ─── BATCH UPLOAD QUEUE ───
// Lets a user pick several PDFs at once. The first opens immediately in the
// editor as normal; the rest sit in a queue and are opened automatically —
// one at a time, in order, once the current file is exported or closed, so
// nothing gets rendered/held in memory before it's actually needed.
const pdfedQueue = {
  items: [],        // { file, name, size, pageCount, status } status: 'pending'|'active'|'done'|'skipped'
  currentIndex: -1,
  autoAdvance: true,
};

function pdfedQueueFmtSize(bytes) {
  if (bytes >= 1048576) return (bytes/1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes/1024) + ' KB';
  return bytes + ' B';
}

async function pdfedLoadFile(e) {
  const files = Array.from(e.target.files || []);
  // reset file input so the same file(s) can be re-opened later
  e.target.value = '';
  if (!files.length) return;

  if (files.length === 1 && pdfedQueue.items.length === 0) {
    // Simple single-file open, no queue involved.
    await pdfedLoadFileObject(files[0]);
    return;
  }

  // Batch upload: build (or extend) the queue.
  const startingFresh = pdfedQueue.items.length === 0;
  files.forEach(f => pdfedQueue.items.push({file: f, name: f.name, size: f.size, pageCount: null, status: 'pending'}));
  document.getElementById('pdfedQueueGroup').style.display = '';
  pdfedQueueRender();
  pdfedQueueProbeCounts();

  if (startingFresh) {
    toast('Batch upload: ' + files.length + ' PDFs queued', 'info');
    await pdfedQueueAdvance();
  } else {
    toast(files.length + ' more PDF(s) added to queue', 'info');
  }
}

// Loads one File object into the editor (the logic that used to be the whole
// of pdfedLoadFile before batch queueing existed).
async function pdfedLoadFileObject(file) {
  // Word / Excel / CSV files open as editable pages instead of going through pdf.js
  const officeKind = pdfedOfficeKind(file);
  if (officeKind === 'legacy') {
    toast('Old .doc / .rtf / .odt files can\'t be opened directly. Save the file as .docx first', 'error');
    return false;
  }
  if (officeKind) return await pdfedLoadOfficeFile(file, officeKind);
  toast('Loading PDF...', 'info');
  try {
    const ab = await file.arrayBuffer();
    const doc = await sarvarcOpenPdfDocument(ab);
    pdfed.pdfDoc = doc;
    pdfed.file = file;
    pdfed.pages = [];
    pdfed.active = -1;
    pdfed.refineReportUsed = false;
    pdfedSearchClose();
    pdfSearch.cache = new Map();
    pdfSearch.results = [];
    pdfSearch.term = '';
    for (let i = 1; i <= doc.numPages; i++) {
      pdfed.pages.push({type:'pdf', pageNum:i, dataUrl:null, modified:false, edits:{}, textBlocks:[], label:'Page '+i});
    }
    // show UI
    ['pdfedExportBtn','pdfedRefineBtn','pdfedExportBtn2','pdfedCloseBtn','pdfedPageInfoPill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    // Hide open button, show filename
    const upBtn = document.getElementById('pdfedUploadBtn');
    if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName');
    if (fnEl) fnEl.textContent = file.name;
    document.getElementById('pdfedPlaceholder').style.display = 'none';
    document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
    document.getElementById('pdfedToolbar').style.visibility = 'visible';
    document.getElementById('prrTotalPages').textContent = doc.numPages;
    state.stats.pdfs++;
    state.stats.pages += doc.numPages;
    updateStats();
    await pdfedBuildStrip();
    await pdfedGoto(0);
    // Auto-fit the first page so the full page is always visible on load
    setTimeout(pdfedZoomFit, 50);
    pdfedScheduleAutoCollapse();
    toast('Loaded ' + doc.numPages + ' pages', 'success');
    return true;
  } catch(err) {
    if (err && err.message === 'Password entry cancelled') { toast('Unlock cancelled', 'info'); return false; }
    toast(err.message, 'error');
    console.error(err);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════
// OPEN WORD + EXCEL FILES DIRECTLY IN THE PDF EDITOR (build 260)
//
// Before this build the PDF editor only opened .pdf files. Word and Excel
// files had to be converted elsewhere first. Now a .docx, .xlsx, .xls,
// .xlsm, .ods, .csv or .tsv opens straight into the editor as real,
// EDITABLE pages, not a flat picture:
//
//   Word   -> every paragraph becomes a placed text box (click and retype,
//             move, restyle), every table becomes a placed table (every cell
//             editable, right-click to add/remove rows and columns), every
//             picture becomes a placed image. Headings, bold/italic/
//             underline, colours, links, bullet + numbered lists,
//             alignment, indents, spacing, page size, margins, page breaks
//             and section changes are carried over. Long content flows onto
//             as many pages as it needs.
//   Excel  -> each sheet becomes one or more pages holding an editable
//             table, with the sheet name as a heading. Wide sheets switch
//             to landscape (or a wider page), long sheets continue on
//             further pages with the header row repeated.
//
// Word files are read straight from their OOXML (JSZip is already loaded
// for the DOCX export) so alignment, sizes, colours and fonts survive,
// which the HTML route through mammoth would have thrown away. Excel files
// use the SheetJS build that is already loaded for Data Arrangement.
// Everything runs on the device; nothing is uploaded.
// ═════════════════════════════════════════════════════════════════════
const PDFED_OFFICE_MAX_PAGES = 150;     // safety stop for enormous files
const PDFED_OFFICE_PXMM = 3.7795;       // canvas px per mm, same as every other page builder

function pdfedOfficeKind(file) {
  const n = String((file && file.name) || '').toLowerCase();
  if (/\.docx$/.test(n)) return 'word';
  if (/\.(xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/.test(n)) return 'sheet';
  if (/\.(doc|rtf|odt)$/.test(n)) return 'legacy';
  return null;
}

// ── tiny OOXML helpers (namespace-agnostic, so w: / ns0: prefixes both work)
function oxKids(el, name) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.localName === name) out.push(c);
  }
  return out;
}
function oxKid(el, name) { return oxKids(el, name)[0] || null; }
function oxElems(el) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
}
function oxDesc(el, name) { return el ? Array.from(el.getElementsByTagNameNS('*', name)) : []; }
function oxAttr(el, name) {
  if (!el || !el.attributes) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    const ln = a.localName || String(a.name).split(':').pop();
    if (ln === name) return a.value;
  }
  return null;
}
function oxOn(el) {
  if (!el) return undefined;
  const v = oxAttr(el, 'val');
  if (v === null) return true;
  return !(v === '0' || v === 'false' || v === 'off');
}
function oxEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function oxParseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('unreadable XML');
  return doc;
}

// ── theme (fonts + colours) ─────────────────────────────────────────────
const OX_THEME_COLOR_KEYS = {
  text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hyperlink: 'hlink', followedHyperlink: 'folHlink'
};
function oxParseTheme(doc) {
  const t = { major: 'Calibri', minor: 'Calibri', colors: {} };
  if (!doc) return t;
  const mj = doc.getElementsByTagNameNS('*', 'majorFont')[0];
  const mn = doc.getElementsByTagNameNS('*', 'minorFont')[0];
  const lat = (f) => { const l = f && f.getElementsByTagNameNS('*', 'latin')[0]; return l ? oxAttr(l, 'typeface') : null; };
  if (lat(mj)) t.major = lat(mj);
  if (lat(mn)) t.minor = lat(mn);
  const cs = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
  if (cs) {
    oxElems(cs).forEach(function(c) {
      const inner = oxElems(c)[0];
      if (!inner) return;
      const hex = oxAttr(inner, 'val') || oxAttr(inner, 'lastClr');
      if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) t.colors[c.localName] = hex.toLowerCase();
    });
  }
  return t;
}
function oxColor(el, theme, valAttr, themeAttr) {
  const val = oxAttr(el, valAttr || 'val');
  if (val && /^[0-9a-fA-F]{6}$/.test(val)) return '#' + val.toLowerCase();
  const tc = oxAttr(el, themeAttr || 'themeColor');
  if (tc && theme && OX_THEME_COLOR_KEYS[tc] && theme.colors[OX_THEME_COLOR_KEYS[tc]]) return '#' + theme.colors[OX_THEME_COLOR_KEYS[tc]];
  return null;
}

// ── run + paragraph property readers ────────────────────────────────────
function oxParseRPr(rPr, theme) {
  const o = {};
  if (!rPr) return o;
  oxElems(rPr).forEach(function(c) {
    switch (c.localName) {
      case 'b': o.bold = oxOn(c); break;
      case 'i': o.italic = oxOn(c); break;
      case 'u': o.underline = (oxAttr(c, 'val') !== 'none'); break;
      case 'caps': case 'smallCaps': o.caps = oxOn(c); break;
      case 'vanish': o.hidden = oxOn(c); break;
      case 'color': o.color = oxColor(c, theme); break;   // null = "auto"
      case 'sz': { const v = parseInt(oxAttr(c, 'val'), 10); if (v > 0) o.sz = v; break; }
      case 'rFonts': {
        const th = oxAttr(c, 'asciiTheme') || oxAttr(c, 'hAnsiTheme');
        const nm = oxAttr(c, 'ascii') || oxAttr(c, 'hAnsi');
        if (th) o.font = /^major/i.test(th) ? theme.major : theme.minor;
        else if (nm) o.font = nm;
        break;
      }
    }
  });
  return o;
}
function oxParsePPr(pPr, theme) {
  const o = {};
  if (!pPr) return o;
  oxElems(pPr).forEach(function(c) {
    switch (c.localName) {
      case 'pStyle': o.styleId = oxAttr(c, 'val'); break;
      case 'jc': {
        const v = oxAttr(c, 'val');
        o.jc = v === 'center' ? 'center' : (v === 'right' || v === 'end') ? 'right' : 'left';
        break;
      }
      case 'spacing': {
        const num = function(n) { const v = parseInt(oxAttr(c, n), 10); return isNaN(v) ? undefined : v; };
        if (num('before') !== undefined) o.before = num('before') / 15;
        if (num('after') !== undefined) o.after = num('after') / 15;
        if (num('line') !== undefined) { o.line = num('line'); o.lineRule = oxAttr(c, 'lineRule') || 'auto'; }
        break;
      }
      case 'ind': {
        const num = function(a, b) { const v = parseInt(oxAttr(c, a) !== null ? oxAttr(c, a) : oxAttr(c, b), 10); return isNaN(v) ? undefined : v / 15; };
        if (num('left', 'start') !== undefined) o.left = num('left', 'start');
        if (num('right', 'end') !== undefined) o.right = num('right', 'end');
        if (num('firstLine', 'firstLine') !== undefined) o.firstLine = num('firstLine', 'firstLine');
        if (num('hanging', 'hanging') !== undefined) o.hanging = num('hanging', 'hanging');
        break;
      }
      case 'numPr': {
        const il = oxKid(c, 'ilvl'), ni = oxKid(c, 'numId');
        if (ni) o.numId = oxAttr(ni, 'val');
        if (il) o.ilvl = parseInt(oxAttr(il, 'val'), 10) || 0;
        break;
      }
      case 'keepNext': o.keepNext = oxOn(c); break;
      case 'contextualSpacing': o.ctxSp = oxOn(c); break;
      case 'pageBreakBefore': o.pageBreakBefore = oxOn(c); break;
      case 'sectPr': o.sectPr = c; break;
      case 'rPr': o.markRPr = oxParseRPr(c, theme); break;
    }
  });
  return o;
}

// ── styles.xml ──────────────────────────────────────────────────────────
function oxParseStyles(doc, theme) {
  const S = { map: {}, docRPr: {}, docPPr: {}, defaultPara: null, cache: {} };
  if (!doc) return S;
  const dd = doc.getElementsByTagNameNS('*', 'docDefaults')[0];
  if (dd) {
    const rd = oxKid(dd, 'rPrDefault'), pd = oxKid(dd, 'pPrDefault');
    if (rd) S.docRPr = oxParseRPr(oxKid(rd, 'rPr'), theme);
    if (pd) S.docPPr = oxParsePPr(oxKid(pd, 'pPr'), theme);
  }
  oxDesc(doc, 'style').forEach(function(st) {
    const id = oxAttr(st, 'styleId');
    if (!id) return;
    const basedOn = oxKid(st, 'basedOn');
    const nm = oxKid(st, 'name');
    S.map[id] = {
      type: oxAttr(st, 'type'),
      name: nm ? String(oxAttr(nm, 'val') || '') : '',
      basedOn: basedOn ? oxAttr(basedOn, 'val') : null,
      rPr: oxParseRPr(oxKid(st, 'rPr'), theme),
      pPr: oxParsePPr(oxKid(st, 'pPr'), theme)
    };
    if (oxAttr(st, 'type') === 'paragraph' && oxAttr(st, 'default') === '1') S.defaultPara = id;
  });
  return S;
}
function oxResolveStyle(S, id, kind) {
  if (!id || !S.map[id]) return {};
  const key = kind + ':' + id;
  if (S.cache[key]) return S.cache[key];
  const chain = [];
  let cur = id, guard = 0;
  while (cur && S.map[cur] && guard++ < 24) { chain.unshift(S.map[cur]); cur = S.map[cur].basedOn; }
  const out = {};
  chain.forEach(function(s) { Object.assign(out, s[kind]); });
  S.cache[key] = out;
  return out;
}

// ── numbering.xml (bullets + numbered lists) ────────────────────────────
function oxParseNumbering(doc, theme) {
  const N = { nums: {}, abs: {} };
  if (!doc) return N;
  oxDesc(doc, 'abstractNum').forEach(function(a) {
    const id = oxAttr(a, 'abstractNumId');
    const lv = {};
    oxKids(a, 'lvl').forEach(function(l) {
      const il = parseInt(oxAttr(l, 'ilvl'), 10) || 0;
      const fmt = oxKid(l, 'numFmt'), txt = oxKid(l, 'lvlText'), st = oxKid(l, 'start');
      lv[il] = {
        fmt: fmt ? oxAttr(fmt, 'val') : 'decimal',
        text: txt ? oxAttr(txt, 'val') : '',
        start: st ? (parseInt(oxAttr(st, 'val'), 10) || 1) : 1,
        pPr: oxParsePPr(oxKid(l, 'pPr'), theme)
      };
    });
    N.abs[id] = lv;
  });
  oxKids(doc.documentElement, 'num').forEach(function(n) {
    const id = oxAttr(n, 'numId');
    const ab = oxKid(n, 'abstractNumId');
    if (id && ab) N.nums[id] = oxAttr(ab, 'val');
  });
  return N;
}
function oxRoman(n, upper) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  map.forEach(function(p) { while (n >= p[0]) { out += p[1]; n -= p[0]; } });
  return upper ? out.toUpperCase() : out;
}
function oxLetters(n, upper) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return upper ? s.toUpperCase() : s;
}
function oxFormatNum(n, fmt) {
  switch (fmt) {
    case 'lowerLetter': return oxLetters(n, false);
    case 'upperLetter': return oxLetters(n, true);
    case 'lowerRoman': return oxRoman(n, false);
    case 'upperRoman': return oxRoman(n, true);
    case 'decimalZero': return (n < 10 ? '0' : '') + n;
    default: return String(n);
  }
}
// Returns { prefix, left, hanging } for a numbered/bulleted paragraph.
function oxListInfo(ctx, numId, ilvl) {
  if (!numId || numId === '0') return null;
  const absId = ctx.numbering.nums[numId];
  const lvls = absId !== undefined ? ctx.numbering.abs[absId] : null;
  const lv = lvls && lvls[ilvl];
  if (!lv) return null;
  let prefix = '';
  if (lv.fmt === 'bullet') {
    prefix = ['\u2022', '\u25E6', '\u25AA'][ilvl % 3];
  } else if (lv.fmt !== 'none') {
    const cnt = ctx.counters[numId] || (ctx.counters[numId] = []);
    cnt[ilvl] = (cnt[ilvl] === undefined ? lv.start : cnt[ilvl] + 1);
    for (let d = ilvl + 1; d < cnt.length; d++) cnt[d] = undefined;
    prefix = (lv.text || ('%' + (ilvl + 1) + '.')).replace(/%(\d)/g, function(_, n) {
      const li = parseInt(n, 10) - 1;
      const l2 = lvls[li] || lv;
      const val = cnt[li] === undefined ? l2.start : cnt[li];
      return oxFormatNum(val, l2.fmt);
    });
  }
  return { prefix: prefix, left: lv.pPr.left, hanging: lv.pPr.hanging };
}

// ── relationships + package paths ───────────────────────────────────────
function oxParseRels(doc) {
  const rels = {};
  if (!doc) return rels;
  oxDesc(doc, 'Relationship').forEach(function(r) {
    const id = oxAttr(r, 'Id');
    if (!id) return;
    rels[id] = { target: oxAttr(r, 'Target') || '', external: oxAttr(r, 'TargetMode') === 'External', type: oxAttr(r, 'Type') || '' };
  });
  return rels;
}
function oxResolvePath(target) {
  let p = target.charAt(0) === '/' ? target.slice(1) : 'word/' + target;
  const parts = [];
  p.split('/').forEach(function(seg) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  });
  return parts.join('/');
}

// ── Word font → an editor font (metric-compatible where one exists) ─────
const OX_FONT_MAP = {
  'calibri': 'Carlito', 'calibri light': 'Carlito', 'cambria': 'Caladea', 'cambria math': 'Caladea',
  'aptos': 'Inter', 'aptos display': 'Inter', 'aptos narrow': 'Inter', 'segoe ui': 'Segoe UI',
  'arial': 'Arial', 'arial narrow': 'Arial', 'helvetica': 'Helvetica Neue', 'times new roman': 'Times New Roman',
  'times': 'Times New Roman', 'georgia': 'Georgia', 'verdana': 'Verdana', 'tahoma': 'Tahoma',
  'trebuchet ms': 'Trebuchet MS', 'courier new': 'Courier New', 'consolas': 'Source Code Pro',
  'garamond': 'EB Garamond', 'book antiqua': 'Lora', 'palatino linotype': 'Lora', 'century gothic': 'Poppins',
  'comic sans ms': 'Comic Neue', 'impact': 'Oswald', 'corbel': 'Open Sans', 'candara': 'Open Sans'
};
function oxMapFont(name) {
  if (!name) return 'Inter';
  const k = String(name).trim().toLowerCase();
  if (OX_FONT_MAP[k]) return OX_FONT_MAP[k];
  try {
    if (typeof SARVARC_FONT_LIBRARY !== 'undefined' && SARVARC_FONT_LIBRARY.indexOf(String(name).trim()) !== -1) return String(name).trim();
  } catch (e) { /* fall through */ }
  return 'Inter';
}

// ── measuring (canvas, for page-break decisions) ────────────────────────
let _oxCanvasCtx = null;
function oxCtx() {
  if (!_oxCanvasCtx) _oxCanvasCtx = document.createElement('canvas').getContext('2d');
  return _oxCanvasCtx;
}
function oxFontSpec(fam, px, bold, italic) {
  return (italic ? 'italic ' : '') + (bold ? '700 ' : '400 ') + px + 'px ' + pdfedFontCss(fam);
}
// Greedy word wrap. Returns [{s, e}] character offsets, one entry per line.
function oxWrapLines(text, font, maxW) {
  const ctx = oxCtx();
  ctx.font = font;
  maxW = Math.max(20, maxW);
  const lines = [];
  let idx = 0;
  const hard = String(text).split('\n');
  for (let h = 0; h < hard.length; h++) {
    const seg = hard[h];
    const base = idx;
    if (!seg) { lines.push({ s: base, e: base }); idx += 1; continue; }
    const toks = seg.match(/\S+\s*|\s+/g) || [];
    let lineStart = 0, w = 0, pos = 0;
    for (let t = 0; t < toks.length; t++) {
      const tok = toks[t];
      const trimmed = tok.replace(/\s+$/, '');
      const tw = ctx.measureText(trimmed).width;
      if (w > 0 && w + tw > maxW) { lines.push({ s: base + lineStart, e: base + pos }); lineStart = pos; w = 0; }
      if (tw > maxW) {
        let cw = 0;
        for (let k = 0; k < trimmed.length; k++) {
          const c = ctx.measureText(trimmed.charAt(k)).width;
          if (cw > 0 && cw + c > maxW) { lines.push({ s: base + lineStart, e: base + pos + k }); lineStart = pos + k; cw = 0; }
          cw += c;
        }
        w = cw + (ctx.measureText(tok.slice(trimmed.length)).width);
      } else {
        w += ctx.measureText(tok).width;
      }
      pos += tok.length;
    }
    lines.push({ s: base + lineStart, e: base + seg.length });
    idx += seg.length + 1;
  }
  return lines;
}

// ── runs → an editable text box ─────────────────────────────────────────
function oxRunsText(runs) { return runs.map(function(r) { return r.text; }).join(''); }
function oxSliceRuns(runs, from, to) {
  const out = [];
  let pos = 0;
  runs.forEach(function(r) {
    const s = pos, e = pos + r.text.length;
    pos = e;
    if (e <= from || s >= to) return;
    const a = Math.max(from, s) - s, b = Math.min(to, e) - s;
    if (b > a) out.push(Object.assign({}, r, { text: r.text.slice(a, b) }));
  });
  return out;
}
function oxTrimRuns(runs, end, start) {
  const out = runs.map(function(r) { return Object.assign({}, r); });
  if (end) { while (out.length && !out[out.length - 1].text.replace(/\s+$/, '')) out.pop(); if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/[ \t\n]+$/, ''); }
  if (start) { while (out.length && !out[0].text.replace(/^[ \t]+/, '')) out.shift(); if (out.length) out[0].text = out[0].text.replace(/^[ \t]+/, ''); }
  return out;
}
function oxSafeUrl(u) { return /^(https?:|mailto:)/i.test(u || '') ? u : null; }
// Builds { text, html?, bold, italic, underline, color } for a run list. Style
// shared by every run goes on the box itself; anything that varies inside the
// paragraph goes into inline html so it stays editable AND exports correctly.
function oxBuildTextItem(runs) {
  const vis = runs.filter(function(r) { return r.text && r.text.trim(); });
  const every = function(k) { return vis.length > 0 && vis.every(function(r) { return !!r[k]; }); };
  const bold = every('bold'), italic = every('italic'), underline = every('underline');
  const tally = {};
  vis.forEach(function(r) { const c = r.color || '#000000'; tally[c] = (tally[c] || 0) + r.text.length; });
  let color = '#000000', best = -1;
  Object.keys(tally).forEach(function(c) { if (tally[c] > best) { best = tally[c]; color = c; } });
  const text = oxRunsText(runs);
  const needHtml = vis.some(function(r) {
    return !!oxSafeUrl(r.link) || !!r.bold !== bold || !!r.italic !== italic || !!r.underline !== underline || (r.color || '#000000') !== color;
  });
  const item = { text: text, bold: bold, italic: italic, underline: underline, color: color };
  if (needHtml) {
    item.html = runs.map(function(r) {
      if (!r.text) return '';
      let h = oxEsc(r.text).replace(/\n/g, '<br>');
      if (!!r.bold && !bold) h = '<b>' + h + '</b>';
      if (!!r.italic && !italic) h = '<i>' + h + '</i>';
      if (!!r.underline && !underline) h = '<u>' + h + '</u>';
      const rc = r.color || '#000000';
      const url = oxSafeUrl(r.link);
      if (url) h = '<a href="' + oxEsc(url) + '" style="color:' + rc + '">' + h + '</a>';
      else if (rc !== color) h = '<span style="color:' + rc + '">' + h + '</span>';
      return h;
    }).join('');
  }
  return item;
}

// ═════════════════════════════════════════════════════════════════════
// WORD: parse document.xml into a flat list of blocks
// ═════════════════════════════════════════════════════════════════════
function oxReadParagraph(p, ctx, out, depth) {
  depth = depth || 0;
  const direct = oxParsePPr(oxKid(p, 'pPr'), ctx.theme);
  const styleId = direct.styleId || ctx.styles.defaultPara;
  const pPr = Object.assign({}, ctx.styles.docPPr, oxResolveStyle(ctx.styles, styleId, 'pPr'), direct);
  const baseRPr = Object.assign({}, ctx.styles.docRPr, oxResolveStyle(ctx.styles, styleId, 'rPr'));
  const items = [];
  const extras = [];
  oxWalkInline(p, baseRPr, null, ctx, items, extras, depth);

  // list marker
  let list = null;
  if (pPr.numId) list = oxListInfo(ctx, pPr.numId, pPr.ilvl || 0);

  // split at page breaks / images into fragments
  const frags = [];
  let cur = [];
  const flush = function() { if (cur.length) frags.push({ t: 'runs', runs: cur }); cur = []; };
  items.forEach(function(it) {
    if (it.t === 'text') cur.push(it);
    else { flush(); frags.push(it); }
  });
  flush();

  const sz = (pPr.markRPr && pPr.markRPr.sz) || baseRPr.sz || 20;
  const emptyPx = Math.round(sz / 2 * (96 / 72) * 10) / 10;
  let lineMult = 1;
  if (pPr.line && (pPr.lineRule === 'auto' || !pPr.lineRule)) lineMult = Math.max(1, pPr.line / 240);
  const align = pPr.jc || 'left';
  const left = pPr.left || 0, right = pPr.right || 0;

  if (pPr.pageBreakBefore) out.push({ kind: 'pagebreak' });

  const hasVisible = frags.some(function(f) { return f.t === 'img' || (f.t === 'runs' && oxRunsText(f.runs).trim()); });
  if (!hasVisible && !frags.some(function(f) { return f.t === 'pagebreak'; })) {
    out.push({ kind: 'blank', fontPx: emptyPx, before: pPr.before || 0, after: pPr.after || 0 });
  }

  let firstText = true;
  frags.forEach(function(f, fi) {
    if (f.t === 'pagebreak') { out.push({ kind: 'pagebreak' }); return; }
    if (f.t === 'img') { out.push({ kind: 'image', rid: f.rid, wPx: f.wPx, hPx: f.hPx, align: align, left: left }); return; }
    let runs = f.runs.map(function(r) { return { text: r.text, bold: r.style.bold, italic: r.style.italic, underline: r.style.underline, color: r.style.color, link: r.link, sz: r.style.sz, font: r.style.font }; });
    if (!oxRunsText(runs).trim()) return;
    // merge neighbours with identical formatting
    const merged = [];
    runs.forEach(function(r) {
      const l = merged[merged.length - 1];
      if (l && !!l.bold === !!r.bold && !!l.italic === !!r.italic && !!l.underline === !!r.underline && l.color === r.color && l.link === r.link && l.sz === r.sz && l.font === r.font) l.text += r.text;
      else merged.push(Object.assign({}, r));
    });
    runs = merged;
    let hang = 0, textLeft = left;
    if (firstText && list) {
      const lead = runs[0];
      hang = direct.hanging !== undefined ? direct.hanging : (list.hanging !== undefined ? list.hanging : (pPr.hanging || 0));
      textLeft = direct.left !== undefined ? direct.left : (list.left !== undefined ? list.left : left);
      runs.unshift({ text: list.prefix ? list.prefix + '  ' : '', bold: lead.bold, italic: false, underline: false, color: lead.color, link: null, sz: lead.sz, font: lead.font });
      if (!list.prefix) runs.shift();
    }
    // dominant size + font, by character count
    const bySz = {}, byFont = {};
    runs.forEach(function(r) {
      if (!r.text.trim()) return;
      bySz[r.sz || baseRPr.sz || 20] = (bySz[r.sz || baseRPr.sz || 20] || 0) + r.text.length;
      const fn = r.font || baseRPr.font || ctx.theme.minor;
      byFont[fn] = (byFont[fn] || 0) + r.text.length;
    });
    const pick = function(tally, fallback) { let b = -1, k = fallback; Object.keys(tally).forEach(function(x) { if (tally[x] > b) { b = tally[x]; k = x; } }); return k; };
    const dSz = parseInt(pick(bySz, sz), 10);
    const isLast = (fi === frags.length - 1);
    const stlName = (ctx.styles.map[styleId] && ctx.styles.map[styleId].name) || '';
    out.push({
      kind: 'para', runs: runs, fontPx: Math.round(dSz / 2 * (96 / 72) * 10) / 10,
      font: oxMapFont(pick(byFont, baseRPr.font || ctx.theme.minor)),
      align: align, left: textLeft, right: right, hanging: firstText && list ? hang : 0,
      before: firstText ? (pPr.before || 0) : 0, after: isLast ? (pPr.after || 0) : 0,
      lineMult: lineMult, keepNext: !!pPr.keepNext || /^heading|^title/i.test(stlName),
      styleId: styleId || '', ctxSp: !!pPr.ctxSp
    });
    firstText = false;
  });

  if (pPr.sectPr) out.push({ kind: 'sectionEnd', sect: oxParseSect(pPr.sectPr) });
  extras.forEach(function(xp) { oxReadParagraph(xp, ctx, out, depth + 1); });
}

function oxWalkInline(node, rprBase, link, ctx, items, extras, depth) {
  oxElems(node).forEach(function(c) {
    switch (c.localName) {
      case 'r': oxReadRun(c, rprBase, link, ctx, items, extras, depth); break;
      case 'hyperlink': {
        const rid = oxAttr(c, 'id');
        const rel = rid && ctx.rels[rid];
        oxWalkInline(c, rprBase, (rel && rel.external) ? rel.target : link, ctx, items, extras, depth);
        break;
      }
      case 'ins': case 'moveTo': case 'smartTag': case 'fldSimple': case 'customXml': case 'sdtContent':
        oxWalkInline(c, rprBase, link, ctx, items, extras, depth); break;
      case 'sdt': { const sc = oxKid(c, 'sdtContent'); if (sc) oxWalkInline(sc, rprBase, link, ctx, items, extras, depth); break; }
      case 'AlternateContent': {
        const ch = oxKid(c, 'Choice') || oxKid(c, 'Fallback');
        if (ch) oxWalkInline(ch, rprBase, link, ctx, items, extras, depth);
        break;
      }
      case 'drawing': case 'pict': oxReadObject(c, ctx, items, extras, depth); break;
    }
  });
}

function oxReadRun(r, rprBase, link, ctx, items, extras, depth) {
  const rPrEl = oxKid(r, 'rPr');
  const style = Object.assign({}, rprBase);
  const rs = rPrEl && oxKid(rPrEl, 'rStyle');
  if (rs) Object.assign(style, oxResolveStyle(ctx.styles, oxAttr(rs, 'val'), 'rPr'));
  Object.assign(style, oxParseRPr(rPrEl, ctx.theme));
  if (style.hidden) return;
  if (link) {
    if (!style.color) style.color = '#0563c1';
    if (style.underline === undefined) style.underline = true;
  }
  const put = function(text) {
    if (!text) return;
    items.push({ t: 'text', text: style.caps ? text.toUpperCase() : text, style: style, link: link });
  };
  const readKids = function(container) {
    oxElems(container).forEach(function(k) {
      switch (k.localName) {
        case 't': put(k.textContent); break;
        case 'tab': put('    '); break;
        case 'br': {
          const ty = oxAttr(k, 'type');
          if (ty === 'page') items.push({ t: 'pagebreak' });
          else put('\n');
          break;
        }
        case 'cr': put('\n'); break;
        case 'noBreakHyphen': put('-'); break;
        case 'drawing': case 'pict': oxReadObject(k, ctx, items, extras, depth); break;
        case 'AlternateContent': {
          const ch = oxKid(k, 'Choice') || oxKid(k, 'Fallback');
          if (ch) readKids(ch);
          break;
        }
      }
    });
  };
  readKids(r);
}

function oxReadObject(obj, ctx, items, extras, depth) {
  // text boxes: their paragraphs join the flow right after this paragraph
  if (depth < 3) {
    oxDesc(obj, 'txbxContent').forEach(function(tb) {
      oxKids(tb, 'p').forEach(function(tp) { extras.push(tp); });
      ctx.notes.textboxes = (ctx.notes.textboxes || 0) + 1;
    });
  }
  const anchor = oxDesc(obj, 'anchor')[0];
  if (anchor && oxAttr(anchor, 'behindDoc') === '1') { ctx.notes.behind = (ctx.notes.behind || 0) + 1; return; }
  let rid = null, wPx = 0, hPx = 0;
  const blip = oxDesc(obj, 'blip')[0];
  if (blip) rid = oxAttr(blip, 'embed');
  if (!rid) {
    const vi = oxDesc(obj, 'imagedata')[0];
    if (vi) rid = oxAttr(vi, 'id');
  }
  if (!rid) return;
  const ext = oxDesc(obj, 'extent')[0];
  if (ext) { wPx = (parseInt(oxAttr(ext, 'cx'), 10) || 0) / 9525; hPx = (parseInt(oxAttr(ext, 'cy'), 10) || 0) / 9525; }
  if (!wPx || !hPx) {
    const sh = oxDesc(obj, 'shape')[0];
    const st = sh && oxAttr(sh, 'style');
    const mw = st && /width:\s*([\d.]+)pt/.exec(st), mh = st && /height:\s*([\d.]+)pt/.exec(st);
    if (mw && mh) { wPx = parseFloat(mw[1]) * 96 / 72; hPx = parseFloat(mh[1]) * 96 / 72; }
  }
  if (!wPx || !hPx) { wPx = 240; hPx = 160; }
  items.push({ t: 'img', rid: rid, wPx: wPx, hPx: hPx });
}

function oxParseSect(sp) {
  if (!sp) return null;
  const sz = oxKid(sp, 'pgSz'), mar = oxKid(sp, 'pgMar'), ty = oxKid(sp, 'type');
  const n = function(el, a, d) { const v = parseInt(oxAttr(el, a), 10); return v > 0 ? v : d; };
  return {
    w: sz ? n(sz, 'w', 11906) : 11906, h: sz ? n(sz, 'h', 16838) : 16838,
    top: mar ? Math.abs(parseInt(oxAttr(mar, 'top'), 10) || 1440) : 1440,
    bottom: mar ? Math.abs(parseInt(oxAttr(mar, 'bottom'), 10) || 1440) : 1440,
    left: mar ? n(mar, 'left', 1440) : 1440, right: mar ? n(mar, 'right', 1440) : 1440,
    cont: !!(ty && oxAttr(ty, 'val') === 'continuous')
  };
}

// ── tables ──────────────────────────────────────────────────────────────
function oxReadTable(tbl, ctx) {
  const grid = oxKids(oxKid(tbl, 'tblGrid'), 'gridCol').map(function(g) { return (parseInt(oxAttr(g, 'w'), 10) || 0) / 15; });
  const look = oxKid(oxKid(tbl, 'tblPr'), 'tblLook');
  const styleEl = oxKid(oxKid(tbl, 'tblPr'), 'tblStyle');
  const styleName = styleEl ? String(oxAttr(styleEl, 'val') || '') : '';
  const jcEl = oxKid(oxKid(tbl, 'tblPr'), 'jc');
  const rows = [];
  const fontVotes = {}, fontPxVotes = {};
  oxKids(tbl, 'tr').forEach(function(tr) {
    const trPr = oxKid(tr, 'trPr');
    const cells = [];
    let minH = 0;
    if (trPr) { const th = oxKid(trPr, 'trHeight'); if (th) minH = (parseInt(oxAttr(th, 'val'), 10) || 0) / 15; }
    oxKids(tr, 'tc').forEach(function(tc) {
      const tcPr = oxKid(tc, 'tcPr');
      const gs = tcPr && oxKid(tcPr, 'gridSpan');
      const span = gs ? Math.max(1, parseInt(oxAttr(gs, 'val'), 10) || 1) : 1;
      const vm = tcPr && oxKid(tcPr, 'vMerge');
      const shd = tcPr && oxKid(tcPr, 'shd');
      let fill = null;
      if (shd) {
        const f = oxAttr(shd, 'fill');
        if (f && f !== 'auto') fill = oxColor(shd, ctx.theme, 'fill', 'themeFill');
      }
      const info = oxCellContent(tc, ctx);
      Object.keys(info.fonts).forEach(function(f) { fontVotes[f] = (fontVotes[f] || 0) + info.fonts[f]; });
      Object.keys(info.sizes).forEach(function(f) { fontPxVotes[f] = (fontPxVotes[f] || 0) + info.sizes[f]; });
      if (span > 1 || (vm && oxAttr(vm, 'val') !== 'restart')) ctx.notes.merged = (ctx.notes.merged || 0) + 1;
      cells.push({ text: info.text, span: span, vcont: !!(vm && oxAttr(vm, 'val') !== 'restart'), fill: fill, bold: info.bold, italic: info.italic, color: info.color, align: info.align });
    });
    rows.push({ cells: cells, isHeader: !!(trPr && oxKid(trPr, 'tblHeader')), minH: minH });
  });
  if (!rows.length) return null;
  const nCols = Math.max(grid.length, Math.max.apply(null, rows.map(function(r) { return r.cells.reduce(function(a, c) { return a + c.span; }, 0); })));
  if (!nCols) return null;
  const colW = [];
  for (let i = 0; i < nCols; i++) colW.push(grid[i] > 0 ? grid[i] : 0);
  const known = colW.filter(function(w) { return w > 0; });
  const fallbackW = known.length ? known.reduce(function(a, b) { return a + b; }, 0) / known.length : 100;
  for (let i = 0; i < nCols; i++) if (!colW[i]) colW[i] = fallbackW;
  const pickTop = function(tally, fb) { let b = -1, k = fb; Object.keys(tally).forEach(function(x) { if (tally[x] > b) { b = tally[x]; k = x; } }); return k; };
  const dSz = parseInt(pickTop(fontPxVotes, 22), 10);
  const lookFirst = look && (oxAttr(look, 'firstRow') === '1' || ((parseInt(oxAttr(look, 'val'), 16) || 0) & 0x20));
  return {
    kind: 'table', rows: rows, colW: colW, nCols: nCols,
    fontPx: Math.round(dSz / 2 * (96 / 72) * 10) / 10,
    font: oxMapFont(pickTop(fontVotes, ctx.theme.minor)),
    jc: jcEl ? oxAttr(jcEl, 'val') : 'left',
    lookFirst: !!lookFirst, styleName: styleName
  };
}
function oxCellContent(tc, ctx) {
  const parts = [];
  const sizes = {}, fonts = {};
  let boldChars = 0, allChars = 0, italicChars = 0, align = null, colorTally = {};
  const readP = function(p) {
    const tmp = [];
    oxReadParagraph(p, ctx, tmp, 3);
    let text = '';
    tmp.forEach(function(b) {
      if (b.kind !== 'para') return;
      const t = oxRunsText(b.runs);
      text += (text ? '\n' : '') + t;
      if (align === null) align = b.align;
      b.runs.forEach(function(r) {
        const n = r.text.trim().length;
        if (!n) return;
        allChars += n; if (r.bold) boldChars += n; if (r.italic) italicChars += n;
        const c = r.color || null;
        if (c) colorTally[c] = (colorTally[c] || 0) + n;
        const sz = r.sz || 22;
        sizes[sz] = (sizes[sz] || 0) + n;
        const fn = r.font || ctx.theme.minor;
        fonts[fn] = (fonts[fn] || 0) + n;
      });
    });
    return text;
  };
  const readNested = function(t) {
    const lines = [];
    oxKids(t, 'tr').forEach(function(tr) {
      lines.push(oxKids(tr, 'tc').map(function(c) { return oxCellContent(c, ctx).text; }).join('  |  '));
    });
    return lines.join('\n');
  };
  oxElems(tc).forEach(function(k) {
    if (k.localName === 'p') parts.push(readP(k));
    else if (k.localName === 'tbl') parts.push(readNested(k));
    else if (k.localName === 'sdt') { const sc = oxKid(k, 'sdtContent'); oxKids(sc, 'p').forEach(function(p) { parts.push(readP(p)); }); }
  });
  while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
  let color = null, bc = -1;
  Object.keys(colorTally).forEach(function(c) { if (colorTally[c] > bc) { bc = colorTally[c]; color = c; } });
  return {
    text: parts.join('\n'), sizes: sizes, fonts: fonts,
    bold: allChars > 0 && boldChars >= allChars * 0.95, italic: allChars > 0 && italicChars >= allChars * 0.95,
    color: color, align: align || 'left'
  };
}

// ── whole document ──────────────────────────────────────────────────────
async function oxParseDocx(ab) {
  if (typeof JSZip === 'undefined') throw new Error('The Word reader failed to load. Check your connection and retry');
  let zip;
  try { zip = await JSZip.loadAsync(ab); }
  catch (e) { throw new Error('This Word file could not be opened. It may be password-protected or damaged'); }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('This does not look like a valid .docx file');
  const read = async function(path) { const f = zip.file(path); return f ? oxParseXml(await f.async('string')) : null; };
  const docXml = oxParseXml(await docFile.async('string'));
  const theme = oxParseTheme(await read('word/theme/theme1.xml'));
  const styles = oxParseStyles(await read('word/styles.xml'), theme);
  const numbering = oxParseNumbering(await read('word/numbering.xml'), theme);
  const rels = oxParseRels(await read('word/_rels/document.xml.rels'));
  let hasHF = false;
  const hfFiles = zip.file(/^word\/(header|footer)\d*\.xml$/);
  for (let i = 0; i < hfFiles.length && !hasHF; i++) {
    const x = await hfFiles[i].async('string');
    if (/<w:t(?:\s[^>]*)?>\s*[^<\s][^<]*<\/w:t>/.test(x)) hasHF = true;
  }
  const ctx = { zip: zip, theme: theme, styles: styles, numbering: numbering, rels: rels, counters: {}, notes: { headerFooter: hasHF } };
  const body = docXml.getElementsByTagNameNS('*', 'body')[0];
  if (!body) throw new Error('This Word file has no readable content');
  const blocks = [];
  let finalSect = null;
  const visit = function(el) {
    oxElems(el).forEach(function(c) {
      if (c.localName === 'p') oxReadParagraph(c, ctx, blocks, 0);
      else if (c.localName === 'tbl') { const t = oxReadTable(c, ctx); if (t) blocks.push(t); }
      else if (c.localName === 'sdt') { const sc = oxKid(c, 'sdtContent'); if (sc) visit(sc); }
      else if (c.localName === 'sectPr') finalSect = oxParseSect(c);
    });
  };
  visit(body);
  // resolve pictures (async, so done after the synchronous parse)
  const imgBlocks = blocks.filter(function(b) { return b.kind === 'image'; });
  for (let i = 0; i < imgBlocks.length; i++) {
    const b = imgBlocks[i];
    const rel = ctx.rels[b.rid];
    const path = rel && !rel.external ? oxResolvePath(rel.target) : null;
    const f = path && zip.file(path);
    const ext = path ? path.split('.').pop().toLowerCase() : '';
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
    if (!f) { b.dropped = true; continue; }
    if (!mime) { b.dropped = true; ctx.notes.badImage = (ctx.notes.badImage || 0) + 1; continue; }
    b.dataUrl = 'data:' + mime + ';base64,' + await f.async('base64');
  }
  // "Don't add space between paragraphs of the same style" (bullet lists mostly)
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1], b = blocks[i];
    if (a.kind === 'para' && b.kind === 'para' && b.ctxSp && a.ctxSp && a.styleId === b.styleId) { a.after = 0; b.before = 0; }
  }
  const secList = blocks.filter(function(b) { return b.kind === 'sectionEnd'; }).map(function(b) { return b.sect; });
  secList.push(finalSect);
  return { blocks: blocks.filter(function(b) { return !(b.kind === 'image' && b.dropped); }), secList: secList, notes: ctx.notes };
}

// ═════════════════════════════════════════════════════════════════════
// WORD: lay the blocks out onto editable pages
// ═════════════════════════════════════════════════════════════════════
function oxGeo(sect) {
  const s = sect || { w: 11906, h: 16838, top: 1440, bottom: 1440, left: 1440, right: 1440, cont: false };
  const g = {
    W: Math.round(s.w / 15), H: Math.round(s.h / 15),
    mT: s.top / 15, mB: s.bottom / 15, mL: s.left / 15, mR: s.right / 15,
    mmW: Math.round(s.w / 1440 * 25.4 * 10) / 10, mmH: Math.round(s.h / 1440 * 25.4 * 10) / 10, cont: s.cont
  };
  if (g.mL + g.mR > g.W - 120) { g.mL = 60; g.mR = 60; }
  if (g.mT + g.mB > g.H - 120) { g.mT = 60; g.mB = 60; }
  return g;
}

async function oxLayoutWord(parsed) {
  const pages = [];
  const urlCache = {};
  const PADX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER;   // text box inner offset
  const PADY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
  const notes = { truncated: false };

  // fonts used anywhere: load once up front so measuring matches what shows
  const fams = {};
  parsed.blocks.forEach(function(b) { if (b.font) fams[b.font] = true; });
  await Promise.all(Object.keys(fams).map(function(f) { return pdfedKadessaEnsureFont(f); }));

  let secIdx = 0, geo = oxGeo(parsed.secList[0]), pg = null, y = 0, pendingBreaks = 0, stopped = false;
  const geos = {};
  parsed.secList.forEach(function(s) { const g = oxGeo(s); geos[g.mmW + 'x' + g.mmH] = g; });
  const keys = Object.keys(geos);
  for (let i = 0; i < keys.length; i++) {
    const g = geos[keys[i]];
    urlCache[keys[i]] = await pdfedRenderBlankPage('', '#ffffff', g.mmW, g.mmH);
  }

  const bottom = function() { return geo.H - geo.mB; };
  const contentW = function() { return geo.W - geo.mL - geo.mR; };
  const newPage = function() {
    if (pages.length >= PDFED_OFFICE_MAX_PAGES) { stopped = true; notes.truncated = true; return false; }
    pg = {
      type: 'blank', dataUrl: urlCache[geo.mmW + 'x' + geo.mmH], modified: true, edits: {}, textBlocks: [],
      placedTexts: [], placedImages: [], placedTables: [], label: 'Page ' + (pages.length + 1), bgColor: '#ffffff', pageMM: [geo.mmW, geo.mmH]
    };
    pages.push(pg);
    y = geo.mT;
    return true;
  };
  const atTop = function() { return y - geo.mT < 2; };
  // makes sure there is a page to draw on, honouring queued page breaks
  const ready = function() {
    if (stopped) return false;
    if (!pg) { pendingBreaks = 0; return newPage(); }
    while (pendingBreaks > 0) { pendingBreaks--; if (!newPage()) return false; }
    return true;
  };
  const addText = function(item, x, yTop, w, fontPx, font, align) {
    pdfedPlacedTextSeq++;
    const t = Object.assign({
      id: 'ptxt_' + pdfedPlacedTextSeq, zIndex: pdfedNextZ(pg), x: Math.round((x - PADX) * 10) / 10, y: Math.round((yTop - PADY) * 10) / 10,
      w: Math.round((w + 2 * PADX) * 10) / 10, fontSize: fontPx, fontFamily: font, align: align, locked: false
    }, item);
    pg.placedTexts.push(t);
    return t;
  };

  const placePara = function(b) {
    if (!ready()) return;
    const fs = Math.max(6, b.fontPx || 14.7);
    const lineH = fs * 1.25;
    const x0 = geo.mL + Math.max(0, b.left - (b.hanging || 0));
    const innerW = Math.max(60, contentW() - Math.max(0, b.left - (b.hanging || 0)) - b.right);
    if (b.keepNext && !atTop() && (bottom() - y) < lineH * 3.2) { if (!newPage()) return; }
    if (!atTop()) y += b.before;
    let runs = b.runs;
    let guard = 0;
    while (runs.length && guard++ < 400) {
      const full = oxRunsText(runs);
      if (!full.trim()) break;
      const allBold = runs.filter(function(r) { return r.text.trim(); }).every(function(r) { return r.bold; });
      const font = oxFontSpec(b.font, fs, allBold, false);
      const lines = oxWrapLines(full, font, innerW);
      const avail = bottom() - y;
      const fit = Math.floor(avail / lineH);
      let chunk = runs, rest = null, chunkLines = lines.length;
      if (lines.length > fit) {
        let take = fit;
        if (take >= 2 && lines.length - take === 1 && take >= 3) take -= 1;   // no lone last line on the next page
        if (take < 2 && !atTop()) { if (!newPage()) return; continue; }
        take = Math.max(1, Math.min(take, lines.length - 1));
        chunkLines = take;
        const cut = lines[take].s;
        chunk = oxTrimRuns(oxSliceRuns(runs, 0, cut), true, false);
        rest = oxTrimRuns(oxSliceRuns(runs, cut, full.length), false, true);
      }
      const item = oxBuildTextItem(chunk);
      let h = pdfedKadessaMeasure(item.text, b.font, fs, item.bold, item.italic, innerW + 2 * PADX) - 2 * PADY;
      h = Math.max(h, chunkLines * lineH * 0.98);
      if (b.lineMult > 1) h = Math.max(h, h * b.lineMult * 0.96);
      addText(item, x0, y, innerW, fs, b.font, b.align);
      y += h;
      if (!rest) { y += b.after; break; }
      if (!newPage()) return;
      runs = rest;
    }
  };

  const placeBlank = function(b) {
    if (!ready()) return;
    const h = Math.max(6, b.fontPx || 14.7) * 1.25;
    // A blank line that would spill past the bottom just queues the next page
    // (so a trailing blank or a section-break paragraph never leaves an empty page).
    if (y + h > bottom() && !atTop()) { pendingBreaks = Math.max(pendingBreaks, 1); return; }
    if (!atTop()) y += b.before;
    y += h + b.after;
  };

  const placeImage = function(b) {
    if (!ready()) return;
    const maxW = contentW() - Math.max(0, b.left || 0), maxH = geo.H - geo.mT - geo.mB;
    let w = b.wPx, h = b.hPx;
    const s = Math.min(1, maxW / w, maxH / h);
    w *= s; h *= s;
    if (y + h > bottom() && !atTop()) { if (!newPage()) return; }
    const room = contentW() - Math.max(0, b.left || 0);
    let x = geo.mL + Math.max(0, b.left || 0);
    if (b.align === 'center') x += (room - w) / 2; else if (b.align === 'right') x += room - w;
    pdfedAnnotState.placedImgSeq++;
    pg.placedImages.push({ id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: b.dataUrl, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, locked: false, zIndex: pdfedNextZ(pg), kind: 'image' });
    y += h + 8;
  };

  const placeTable = function(t) {
    if (!ready()) return;
    // widths: fit inside the text area
    const cw = contentW();
    let total = t.colW.reduce(function(a, b) { return a + b; }, 0);
    let scale = total > cw ? cw / total : 1;
    const colW = t.colW.map(function(w) { return Math.max(24, Math.round(w * scale * 10) / 10); });
    total = colW.reduce(function(a, b) { return a + b; }, 0);
    const fontPx = Math.max(7, Math.round(t.fontPx * Math.max(scale, 0.8) * 10) / 10);
    const lineH = fontPx * 1.35;
    // expand spans into a full grid, remembering each cell's real width
    const grid = t.rows.map(function(r) {
      const out = [];
      let ci = 0;
      r.cells.forEach(function(c) {
        const spanW = colW.slice(ci, ci + c.span).reduce(function(a, b) { return a + b; }, 0) || colW[ci] || 80;
        // The editor's table has no merged cells, so a merged cell becomes ordinary
        // cells: the text stays in the first one (row height is sized for that
        // column so nothing is clipped) and the colour band carries across.
        out.push({ text: c.vcont ? '' : c.text, w: c.span > 1 ? (colW[ci] || spanW) : spanW, cell: c });
        for (let k = 1; k < c.span; k++) out.push({ text: '', w: 0, cell: null, fill: c.fill });
        ci += c.span;
      });
      while (out.length < colW.length) out.push({ text: '', w: 0, cell: null });
      return out.slice(0, colW.length);
    });
    const rowH = grid.map(function(r, ri) {
      let mx = 1;
      r.forEach(function(c, ci) {
        if (!c.text) return;
        const isB = c.cell && c.cell.bold;
        const n = Math.min(60, oxWrapLines(c.text, oxFontSpec(t.font, fontPx, isB, false), (c.w || colW[ci]) - 18).length);
        if (n > mx) mx = n;
      });
      return Math.min(geo.H - geo.mT - geo.mB, Math.max(t.rows[ri].minH || 0, Math.round(mx * lineH + 10)));
    });
    const hasFill = t.rows[0].cells.some(function(c) { return !!c.fill; });
    const headerRow = !!(t.rows[0].isHeader || hasFill || (t.rows[0].cells.length && t.rows[0].cells.every(function(c) { return !c.text.trim() || c.bold; }) && t.rows[0].cells.some(function(c) { return c.text.trim(); })) ||
      (t.lookFirst && t.styleName && !/^(TableGrid|TableNormal|Tablenormal)$/i.test(t.styleName)));
    const repeatHeader = !!(t.rows[0].isHeader || headerRow) && grid.length > 1;
    let x = geo.mL;
    if (t.jc === 'center') x += (cw - total) / 2; else if (t.jc === 'right') x += cw - total;

    let start = 0;
    let guard = 0;
    while (start < grid.length && guard++ < 200) {
      // pick how many rows fit on this page
      const head = (start > 0 && repeatHeader) ? 0 : -1;
      let used = head === 0 ? rowH[0] : 0;
      let end = start;
      while (end < grid.length && (used + rowH[end] <= bottom() - y || end === start && atTop())) { used += rowH[end]; end++; }
      if (end === start) {
        if (!atTop()) { if (!newPage()) return; continue; }
        end = start + 1;
      }
      const useRows = [];
      if (head === 0) useRows.push(0);
      for (let r = start; r < end; r++) useRows.push(r);
      const cells = useRows.map(function(r) { return grid[r].map(function(c) { return c.text; }); });
      const styles = useRows.map(function(r, k) {
        return grid[r].map(function(c) {
          const src = c.cell;
          const isHead = headerRow && (r === 0);
          return {
            align: src ? (src.align === 'center' || src.align === 'right' ? src.align : 'left') : 'left',
            bold: !!(src && src.bold) || isHead, italic: !!(src && src.italic), color: (src && src.color) || null,
            topBorder: false, fill: (src && src.fill) || c.fill || null
          };
        });
      });
      pdfedTableSeq++;
      pg.placedTables.push({
        id: 'tbl_' + pdfedTableSeq, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
        rows: cells.length, cols: colW.length, colWidths: colW.slice(), rowHeights: useRows.map(function(r) { return rowH[r]; }),
        fontSize: fontPx, fontFamily: t.font, headerRow: headerRow, cells: cells, cellStyles: styles,
        locked: false, zIndex: pdfedNextZ(pg), linkedTitleId: null
      });
      y += useRows.reduce(function(a, r) { return a + rowH[r]; }, 0) + 10;
      start = end;
      if (start < grid.length) { if (!newPage()) return; }
    }
  };

  for (let i = 0; i < parsed.blocks.length && !stopped; i++) {
    const b = parsed.blocks[i];
    switch (b.kind) {
      case 'para': placePara(b); break;
      case 'blank': placeBlank(b); break;
      case 'image': placeImage(b); break;
      case 'table': placeTable(b); break;
      case 'pagebreak': if (pg) pendingBreaks++; break;
      case 'sectionEnd': {
        secIdx++;
        const nextGeo = oxGeo(parsed.secList[secIdx]);
        const changed = nextGeo.mmW !== geo.mmW || nextGeo.mmH !== geo.mmH || nextGeo.mL !== geo.mL || nextGeo.mR !== geo.mR || nextGeo.mT !== geo.mT || nextGeo.mB !== geo.mB;
        geo = nextGeo;
        if (pg && (!nextGeo.cont || changed)) pendingBreaks = Math.max(pendingBreaks, 1);
        break;
      }
    }
  }
  // a trailing break / blank page that never got content is dropped
  while (pages.length > 1) {
    const p = pages[pages.length - 1];
    if (p.placedTexts.length || p.placedImages.length || p.placedTables.length) break;
    pages.pop();
  }
  return { pages: pages, notes: notes };
}

// ═════════════════════════════════════════════════════════════════════
// EXCEL / CSV: one or more editable table pages per sheet
// ═════════════════════════════════════════════════════════════════════
async function oxBuildSheetPages(ab, fileName) {
  if (typeof XLSX === 'undefined') throw new Error('The spreadsheet reader failed to load. Check your connection and retry');
  const isDelim = /\.(csv|tsv)$/i.test(fileName);
  let wb;
  try {
    if (isDelim) {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(ab));
      const opts = { type: 'string', raw: true };
      if (/\.tsv$/i.test(fileName)) opts.FS = '\t';
      wb = XLSX.read(text, opts);
    } else {
      wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: true });
    }
  } catch (e) { throw new Error('This spreadsheet could not be opened. It may be password-protected or damaged'); }

  const sheets = [];
  const wbSheets = (wb.Workbook && wb.Workbook.Sheets) || [];
  (wb.SheetNames || []).forEach(function(name, i) {
    const ws = wb.Sheets[name];
    if (!ws || (wbSheets[i] && wbSheets[i].Hidden > 0)) return;
    let aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
    aoa = aoa.map(function(r) { return r.map(function(v) { return v === null || v === undefined ? '' : String(v); }); });
    let cols = 0;
    aoa.forEach(function(r) { for (let c = r.length - 1; c >= 0; c--) { if (r[c] !== '') { cols = Math.max(cols, c + 1); break; } } });
    aoa = aoa.filter(function(r) { return r.some(function(v) { return v !== ''; }); }).map(function(r) {
      const o = r.slice(0, cols);
      while (o.length < cols) o.push('');
      return o;
    });
    if (aoa.length && cols) sheets.push({ name: name, aoa: aoa, cols: cols });
  });
  if (!sheets.length) throw new Error('That spreadsheet has no data to show');

  const pages = [];
  const urlCache = {};
  const notes = { truncated: false, skippedRows: 0 };
  const M = 48, PW = 794, LW = 1123;
  const getUrl = async function(mmW, mmH) {
    const k = mmW + 'x' + mmH;
    if (!urlCache[k]) urlCache[k] = await pdfedRenderBlankPage('', '#ffffff', mmW, mmH);
    return urlCache[k];
  };
  const textBox = function(pg, text, x, y, fontSize, bold) {
    pdfedPlacedTextSeq++;
    pg.placedTexts.push({ id: 'ptxt_' + pdfedPlacedTextSeq, text: text, x: x, y: y, fontSize: fontSize, fontFamily: 'Inter', color: '#101820', bold: !!bold, italic: false, underline: false, align: 'left', locked: false, zIndex: pdfedNextZ(pg) });
  };

  for (let si = 0; si < sheets.length; si++) {
    const sh = sheets[si];
    let rows = sh.aoa;
    // leading single-cell rows are titles, not part of the table
    const titles = [];
    while (rows.length > 3 && titles.length < 2 && sh.cols > 1 && rows[0].filter(function(v) { return v !== ''; }).length === 1) titles.push(rows.shift().filter(function(v) { return v !== ''; })[0]);
    const headers = rows[0];
    let data = rows.slice(1);
    if (data.length > 6000) { notes.skippedRows += data.length - 6000; data = data.slice(0, 6000); }

    // sizing
    let fontPx = sh.cols > 14 ? 9 : sh.cols > 10 ? 10 : sh.cols > 7 ? 11 : 12;
    const ctx = oxCtx();
    const measureW = function(px) {
      const wds = [];
      for (let c = 0; c < sh.cols; c++) {
        ctx.font = '700 ' + px + 'px Inter, sans-serif';
        let mx = ctx.measureText(headers[c] || '').width;
        ctx.font = '400 ' + px + 'px Inter, sans-serif';
        for (let r = 0; r < Math.min(data.length, 300); r++) { const w = ctx.measureText(data[r][c] || '').width; if (w > mx) mx = w; }
        wds.push(Math.max(56, Math.min(300, Math.round(mx + 22))));
      }
      return wds;
    };
    let colW = measureW(fontPx);
    let total = colW.reduce(function(a, b) { return a + b; }, 0);
    let mmW = 210, mmH = 297, pageW = PW, pageH = 1123;
    if (total <= PW - 2 * M) { /* portrait */ }
    else if (total <= LW - 2 * M) { mmW = 297; mmH = 210; pageW = LW; pageH = PW; }
    else {
      const s = (LW - 2 * M) / total;
      if (s >= 0.6) {
        fontPx = Math.max(7, Math.round(fontPx * s));
        colW = colW.map(function(w) { return Math.max(36, Math.round(w * s)); });
        total = colW.reduce(function(a, b) { return a + b; }, 0);
        mmW = 297; mmH = 210; pageW = LW; pageH = PW;
      } else {
        mmW = Math.ceil((total + 2 * M) / PDFED_OFFICE_PXMM);
        mmH = Math.max(210, Math.round(mmW / 1.414));
        pageW = Math.round(mmW * PDFED_OFFICE_PXMM); pageH = Math.round(mmH * PDFED_OFFICE_PXMM);
      }
    }
    pageH = Math.round(mmH * PDFED_OFFICE_PXMM);
    const url = await getUrl(mmW, mmH);
    const lineH = fontPx * 1.35;
    const rowHeightOf = function(vals, bold) {
      let mx = 1;
      vals.forEach(function(v, c) {
        if (!v) return;
        const n = Math.min(12, oxWrapLines(v, oxFontSpec('Inter', fontPx, bold, false), colW[c] - 18).length);
        if (n > mx) mx = n;
      });
      return Math.max(24, Math.round(mx * lineH + 10));
    };
    const hH = rowHeightOf(headers, true);
    const dH = data.map(function(r) { return rowHeightOf(r, false); });

    // title block above the first page of this sheet
    const heading = sheets.length > 1 ? sh.name : '';
    const topLines = [];
    if (heading) topLines.push({ text: heading, size: 20, bold: true, h: 34 });
    titles.forEach(function(t) { topLines.push({ text: t, size: 15, bold: true, h: 26 }); });
    const topH = topLines.reduce(function(a, l) { return a + l.h; }, 0);

    let start = 0, first = true;
    while ((start < data.length || first) && !notes.truncated) {
      if (pages.length >= PDFED_OFFICE_MAX_PAGES) { notes.truncated = true; break; }
      const availH = pageH - 2 * M - (first ? topH : 0);
      let used = hH, end = start;
      while (end < data.length && (used + dH[end] <= availH || end === start)) { used += dH[end]; end++; }
      const pg = {
        type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [],
        label: sh.name, bgColor: '#ffffff', pageMM: [mmW, mmH]
      };
      pages.push(pg);
      let y = M;
      const x = Math.max(M / 2, Math.round((pageW - total) / 2));
      if (first) { topLines.forEach(function(l) { textBox(pg, l.text, x, y, l.size, l.bold); y += l.h; }); }
      const cells = [headers.slice()].concat(data.slice(start, end));
      pdfedTableSeq++;
      pg.placedTables.push({
        id: 'tbl_' + pdfedTableSeq, x: x, y: y, rows: cells.length, cols: sh.cols, colWidths: colW.slice(),
        rowHeights: [hH].concat(dH.slice(start, end)), fontSize: fontPx, headerRow: true, cells: cells,
        cellStyles: (typeof daBuildCellStyles === 'function') ? daBuildCellStyles(cells) : [],
        locked: false, zIndex: pdfedNextZ(pg), linkedTitleId: null
      });
      first = false;
      start = end;
      if (!data.length) break;
    }
  }
  return { pages: pages, notes: notes, sheetCount: sheets.length };
}

// ═════════════════════════════════════════════════════════════════════
// Entry point: called from pdfedLoadFileObject for Word/Excel files
// ═════════════════════════════════════════════════════════════════════
async function pdfedLoadOfficeFile(file, kind) {
  toast(kind === 'word' ? 'Opening Word file…' : 'Opening spreadsheet…', 'info');
  try {
    const ab = await file.arrayBuffer();
    await new Promise(function(r) { setTimeout(r, 0); });   // let the toast paint before the heavy work
    let pages, notes, extra = '';
    if (kind === 'word') {
      const parsed = await oxParseDocx(ab);
      if (!parsed.blocks.length) throw new Error('That Word file is empty, there is nothing to show');
      const laid = await oxLayoutWord(parsed);
      pages = laid.pages; notes = laid.notes;
      const n = parsed.notes || {};
      if (n.badImage) extra += ' ' + n.badImage + ' picture' + (n.badImage === 1 ? '' : 's') + ' in an unsupported format (EMF/WMF/TIFF) could not be shown.';
      if (n.behind) extra += ' Background/watermark pictures were left out.';
      if (n.merged) extra += ' Merged table cells were split into ordinary cells.';
      if (n.headerFooter) extra += ' Headers and footers are not carried over.';
    } else {
      const built = await oxBuildSheetPages(ab, file.name);
      pages = built.pages; notes = built.notes;
      if (notes.skippedRows) extra += ' Only the first 6,000 rows of a long sheet were brought in, use Data Arrangement for the full sheet.';
    }
    if (!pages.length) throw new Error('Nothing could be placed on a page');
    if (notes.truncated) extra += ' Stopped at ' + PDFED_OFFICE_MAX_PAGES + ' pages to keep the editor responsive.';

    pdfed.pdfDoc = null;
    pdfed.file = { name: file.name.replace(/\.[^.]+$/, '') || 'Untitled Document' };
    pdfed.pages = pages;
    pdfed.active = -1;
    pdfed.refineReportUsed = false;
    pdfedSearchClose();
    pdfSearch.cache = new Map();
    pdfSearch.results = [];
    pdfSearch.term = '';
    ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn');
    if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName');
    if (fnEl) fnEl.textContent = pdfed.file.name;
    document.getElementById('pdfedPlaceholder').style.display = 'none';
    document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
    document.getElementById('pdfedToolbar').style.visibility = 'visible';
    document.getElementById('prrTotalPages').textContent = pages.length;
    state.stats.pdfs++;
    state.stats.pages += pages.length;
    updateStats();
    await pdfedBuildStrip();
    await pdfedGoto(0);
    setTimeout(pdfedZoomFit, 50);
    pdfedScheduleAutoCollapse();
    toast((kind === 'word' ? 'Word file opened' : 'Spreadsheet opened') + ' as ' + pages.length + ' editable page' + (pages.length === 1 ? '' : 's') + '.' + extra, extra ? 'info' : 'success');
    return true;
  } catch (err) {
    console.error('Office import failed', err);
    toast((err && err.message) || 'Could not open that file', 'error');
    return false;
  }
}

// Drop files straight onto the editor (PDF, Word or Excel, one or several).
async function pdfedOpenDroppedFiles(files) {
  const ok = files.filter(function(f) {
    const k = pdfedOfficeKind(f);
    return /\.pdf$/i.test(f.name) || f.type === 'application/pdf' || k === 'word' || k === 'sheet';
  });
  if (!ok.length) {
    const legacy = files.some(function(f) { return pdfedOfficeKind(f) === 'legacy'; });
    toast(legacy ? 'Old .doc/.rtf/.odt files can\'t be opened directly. Save as .docx first' : 'Drop a PDF, Word (.docx) or Excel (.xlsx / .csv) file', 'info');
    return;
  }
  await pdfedLoadFile({ target: { files: ok, value: '' } });
}

// Opens the next pending item in the queue (if any) and marks it active.
async function pdfedQueueAdvance() {
  if (pdfedQueue.currentIndex >= 0 && pdfedQueue.items[pdfedQueue.currentIndex] && pdfedQueue.items[pdfedQueue.currentIndex].status === 'active') {
    pdfedQueue.items[pdfedQueue.currentIndex].status = 'done';
  }
  const nextIdx = pdfedQueue.items.findIndex(it => it.status === 'pending');
  if (nextIdx === -1) {
    pdfedQueue.currentIndex = -1;
    pdfedQueueRender();
    if (pdfedQueue.items.length && pdfedQueue.items.every(it => it.status === 'done' || it.status === 'skipped')) {
      toast('Batch queue complete, all files processed', 'success');
    }
    return false;
  }
  pdfedQueue.currentIndex = nextIdx;
  pdfedQueue.items[nextIdx].status = 'active';
  pdfedQueueRender();
  const pos = nextIdx + 1, total = pdfedQueue.items.length;
  toast('Opening file ' + pos + ' of ' + total + ' in queue…', 'info');
  await pdfedLoadFileObject(pdfedQueue.items[nextIdx].file);
  return true;
}

// Background page-count probe so the queue list can show "12 pages" next to
// pending items without blocking the batch-select or the current edit.
async function pdfedQueueProbeCounts() {
  for (const it of pdfedQueue.items) {
    if (it.pageCount !== null) continue;
    const officeK = pdfedOfficeKind(it.file);
    if (officeK) { it.pageCount = ''; it.kindLabel = officeK === 'word' ? 'Word' : officeK === 'sheet' ? 'Excel' : 'Unsupported'; pdfedQueueRender(); continue; }
    try {
      const ab = await it.file.arrayBuffer();
      // Plain getDocument (no onPassword) on purpose — this is a silent
      // background probe for the queue list, so a locked file should just
      // show a lock badge instead of popping the unlock prompt. The real
      // password prompt happens later, when this item is actually opened.
      const doc = await pdfjsLib.getDocument({data: ab}).promise;
      it.pageCount = doc.numPages;
      pdfedQueueRender();
    } catch(err) {
      it.pageCount = (err && err.name === 'PasswordException') ? '🔒' : '?';
      pdfedQueueRender();
    }
  }
}

function pdfedQueueRender() {
  const grp = document.getElementById('pdfedQueueGroup');
  if (!grp) return;
  const total = pdfedQueue.items.length;
  if (!total) { grp.style.display = 'none'; return; }
  grp.style.display = '';
  const doneCount = pdfedQueue.items.filter(it => it.status === 'done' || it.status === 'skipped').length;
  document.getElementById('pdfedQueueBtnLabel').textContent = 'Queue ' + doneCount + '/' + total;
  const list = document.getElementById('pdfedQueueList');
  if (!list) return;
  list.innerHTML = '';
  const statusLabel = { active: 'Editing now', pending: 'Waiting', done: 'Done', skipped: 'Skipped' };
  pdfedQueue.items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:7px;cursor:pointer;transition:background .12s;' +
      (it.status === 'active' ? 'background:rgba(0,194,255,0.06)' : '');
    const icon = it.status === 'done'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity="0.35"/><polyline points="8.5 12.2 11 14.5 15.5 9.5"/></svg>'
      : it.status === 'active'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="var(--blue)" stroke="none"/></svg>'
      : it.status === 'skipped'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.6" opacity="0.6"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 2.5"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/></svg>';
    const meta = (it.kindLabel ? it.kindLabel + ' · ' : (it.pageCount ? it.pageCount + ' pg · ' : '')) + pdfedQueueFmtSize(it.size) + ' · ' + statusLabel[it.status];
    const nameColor = (it.status === 'done' || it.status === 'skipped') ? 'var(--text3)' : 'var(--text)';
    row.innerHTML = '<span style="display:inline-flex;flex-shrink:0">' + icon + '</span>' +
      '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;color:' + nameColor + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + it.name + '</div>' +
      '<div style="font-size:10.5px;color:var(--text3);margin-top:1px">' + meta + '</div></div>';
    if (it.status === 'pending') {
      row.title = 'Click to jump to this file now';
      row.onclick = () => pdfedQueueJumpTo(idx);
    } else {
      row.style.cursor = 'default';
    }
    if (it.status !== 'active') {
      const rm = document.createElement('button');
      rm.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      rm.title = 'Remove from queue';
      rm.style.cssText = 'display:flex;align-items:center;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px;flex-shrink:0;border-radius:4px';
      rm.onmouseenter = () => { rm.style.color = 'var(--text)'; };
      rm.onmouseleave = () => { rm.style.color = 'var(--text3)'; };
      rm.onclick = (ev) => { ev.stopPropagation(); pdfedQueueRemove(idx); };
      row.appendChild(rm);
    }
    list.appendChild(row);
  });
}

// Lets the user jump straight to any pending file, skipping ahead in order.
async function pdfedQueueJumpTo(idx) {
  const target = pdfedQueue.items[idx];
  if (!target || target.status !== 'pending') return;
  if (pdfed.pages.length && pdfed.pages.some(p => p.modified)) {
    if (!confirm('The current PDF has unsaved edits that will be lost if you switch. Continue?')) return;
  }
  if (pdfedQueue.currentIndex >= 0 && pdfedQueue.items[pdfedQueue.currentIndex] && pdfedQueue.items[pdfedQueue.currentIndex].status === 'active') {
    pdfedQueue.items[pdfedQueue.currentIndex].status = 'skipped';
  }
  pdfedQueue.currentIndex = idx;
  target.status = 'active';
  pdfedQueueRender();
  pdfedQueueCloseDropdown();
  await pdfedLoadFileObject(target.file);
}

function pdfedQueueRemove(idx) {
  if (pdfedQueue.items[idx] && pdfedQueue.items[idx].status === 'active') return;
  pdfedQueue.items.splice(idx, 1);
  if (pdfedQueue.currentIndex > idx) pdfedQueue.currentIndex--;
  pdfedQueueRender();
}

function pdfedQueueAddMore() {
  pdfedQueueCloseDropdown();
  document.getElementById('pdfedFileInput').click();
}

function pdfedQueueClearAll() {
  if (!confirm('Clear the entire batch queue? Files not yet opened will be dropped.')) return;
  pdfedQueue.items = [];
  pdfedQueue.currentIndex = -1;
  pdfedQueueRender();
  pdfedQueueCloseDropdown();
}

function pdfedQueueToggleDropdown(ev) {
  ev && ev.stopPropagation();
  const dd = document.getElementById('pdfedQueueDropdown');
  const btn = document.getElementById('pdfedQueueBtn');
  if (!dd || !btn) return;
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = rect.left + 'px';
  }
}
function pdfedQueueCloseDropdown() {
  const dd = document.getElementById('pdfedQueueDropdown');
  if (dd) dd.classList.remove('open');
}
document.addEventListener('click', (ev) => {
  const grp = document.getElementById('pdfedQueueGroup');
  if (grp && !grp.contains(ev.target)) pdfedQueueCloseDropdown();
});
