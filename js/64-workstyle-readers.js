// ─── WORKSTYLE: READ ANY FILE FORMAT ─────────────────────────────────────────
// Two jobs, both run fully on the device (nothing is uploaded):
//
//   A. REFERENCE  wsReadAnyReference(file) -> saved reference (same store as a PDF reference)
//        PDF            existing PDF reader (js/60)
//        Word .docx     the editor's own Word reader, measured page by page
//        Excel / CSV    the editor's own sheet reader (.xlsx .xlsm .xlsb .xls .ods .csv .tsv)
//        PowerPoint     .pptx, every slide becomes one page (positions, sizes, colors, bold)
//      A reference is measured from real text boxes, so a picture of a page (.png .jpg) or an
//      old .doc / .rtf / .odt cannot be one. wsReadAnyReference says so in plain words.
//
//   B. CONTENT    wsReadAnyContent(file) -> { text, note }
//        PDF (text layer, or OCR when it is a scan), Word, Excel / CSV, PowerPoint,
//        OpenDocument (.odt .odp .ods), RTF, HTML, JSON, images (OCR), and any plain text
//        (.txt .md .log .xml .yaml ...). Old binary .doc is the only thing it refuses.
//
// Needs the libraries already loaded by workspace.html: pdf.js, JSZip, SheetJS, mammoth, Tesseract.

const WSR_MAX_BYTES = 25 * 1024 * 1024;   // per file
const WSR_MAX_TEXT = 24000;               // same cap as js/63-workstyle-fill.js (WSF_MAX_CONTENT)
const WSR_OCR_MAX_PAGES = 6;
const WSR_VISION_MAX = 2;                 // Kadessa vision reads per flattened file, the rest use the free local reader

function wsrExt(file) {
  const m = /\.([a-z0-9]+)$/i.exec(String((file && file.name) || ''));
  return m ? m[1].toLowerCase() : '';
}

function wsrBase(file) {
  return String((file && file.name) || '').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function wsrCheckSize(file) {
  if (file.size > WSR_MAX_BYTES) throw new Error('that file is over 25 MB. Use a smaller one');
}

function wsrIsImage(file, ext) {
  return /^image\//.test(file.type || '') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].indexOf(ext) !== -1;
}

function wsrParseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('that file looks damaged');
  return doc;
}

function wsrDesc(el, name) { return Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)); }

// ═════════════════════════════════════════════════════════════════════════════
// A. REFERENCE
// ═════════════════════════════════════════════════════════════════════════════

// PowerPoint: one page per slide, in the same page shape the editor uses, so the same
// measuring code reads it. EMU (English Metric Unit): 914400 per inch, 36000 per mm.
// Copies: words, boxes, bars, rules, rounded boxes, circles, triangles etc., group contents, the theme colours,
// shapes that carry their position from the layout / master, and the layout / master decoration.
// ── PowerPoint theme, colours and inherited positions ───────────────────────
// A slide rarely says everything itself. Its colours are often THEME colours (accent1, tx2 ...) with tints, its
// placeholders take their position and text style from the layout and the master, and decoration (bars, logos,
// rules) usually lives on the layout or master. All of that is resolved here so the shapes can be copied.
function wsrDirKids(el, name) {
  return Array.prototype.filter.call(el ? el.children : [], function (k) { return k.localName === name; });
}
function wsrKid(el, name) { return wsrDirKids(el, name)[0] || null; }
function wsrPathJoin(base, rel) {
  if (/^\//.test(rel)) return rel.slice(1);
  const parts = base.split('/'); parts.pop();
  rel.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); });
  return parts.join('/');
}
async function wsrRelsOf(zip, path) {
  const dir = path.replace(/[^/]+$/, ''), nm = path.replace(/^.*\//, '');
  const f = zip.file(dir + '_rels/' + nm + '.rels');
  const out = {};
  if (!f) return out;
  try {
    wsrDesc(wsrParseXml(await f.async('string')), 'Relationship').forEach(function (r) {
      out[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', path: wsrPathJoin(path, r.getAttribute('Target') || '') };
    });
  } catch (e) { /* no rels */ }
  return out;
}
function wsrHex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
function wsrRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function wsrToHex(c) { return '#' + wsrHex2(c[0]) + wsrHex2(c[1]) + wsrHex2(c[2]); }
function wsrRgbToHsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function wsrHslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = function (t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const WSR_PRESET_COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500' };

// Reads one colour element (srgbClr, schemeClr, sysClr, prstClr) with its tint/shade/lum/alpha changes.
// env: { theme: {accent1: '#..', ...}, map: {bg1:'lt1', ...}, ph: colour used for "phClr" }
function wsrColorEl(el, env) {
  if (!el) return null;
  let hex = null;
  const n = el.localName, val = el.getAttribute('val') || '';
  if (n === 'srgbClr') hex = /^[0-9a-f]{6}$/i.test(val) ? '#' + val.toLowerCase() : null;
  else if (n === 'sysClr') { const lc = el.getAttribute('lastClr'); hex = /^[0-9a-f]{6}$/i.test(lc || '') ? '#' + lc.toLowerCase() : (val === 'window' ? '#ffffff' : '#000000'); }
  else if (n === 'prstClr') hex = WSR_PRESET_COLORS[val] || '#000000';
  else if (n === 'schemeClr') {
    if (val === 'phClr') hex = env.ph || null;
    else { const key = (env.map && env.map[val]) || val; hex = env.theme[key] || env.theme[val] || null; }
  }
  if (!hex) return null;
  let rgb = wsrRgb(hex), alpha = 1;
  Array.prototype.forEach.call(el.children, function (m) {
    const v = (Number(m.getAttribute('val')) || 0) / 100000, t = m.localName;
    if (t === 'alpha') alpha = v;
    else if (t === 'lumMod' || t === 'lumOff' || t === 'satMod') {
      const hsl = wsrRgbToHsl(rgb);
      if (t === 'lumMod') hsl[2] = Math.min(1, hsl[2] * v);
      else if (t === 'lumOff') hsl[2] = Math.min(1, Math.max(0, hsl[2] + v));
      else hsl[1] = Math.min(1, hsl[1] * v);
      rgb = wsrHslToRgb(hsl[0], hsl[1], hsl[2]);
    } else if (t === 'tint') rgb = rgb.map(function (c) { return c * v + 255 * (1 - v); });
    else if (t === 'shade') rgb = rgb.map(function (c) { return c * v; });
  });
  return { hex: wsrToHex(rgb), alpha: alpha };
}
// The first colour found in a fill-like container (solidFill, or a font/line reference).
function wsrColorIn(el, env) {
  if (!el) return null;
  for (let i = 0; i < el.children.length; i++) {
    const c = wsrColorEl(el.children[i], env);
    if (c) return c;
  }
  return null;
}
function wsrBlend(c, bgHex) {
  if (!c) return null;
  if (c.alpha >= 0.999) return c.hex;
  if (c.alpha < 0.12) return null;                        // practically invisible
  const a = wsrRgb(c.hex), b = wsrRgb(/^#[0-9a-f]{6}$/i.test(bgHex || '') ? bgHex : '#ffffff');
  return wsrToHex([0, 1, 2].map(function (k) { return a[k] * c.alpha + b[k] * (1 - c.alpha); }));
}
async function wsrLoadTheme(zip, masterPath) {
  const rels = await wsrRelsOf(zip, masterPath);
  let tpath = null;
  Object.keys(rels).forEach(function (k) { if (/\/theme$/.test(rels[k].type)) tpath = rels[k].path; });
  if (!tpath) tpath = Object.keys(zip.files).filter(function (n) { return /^ppt\/theme\/theme\d+\.xml$/.test(n); })[0];
  const out = { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5',
    accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' };
  if (!tpath || !zip.file(tpath)) return out;
  try {
    const doc = wsrParseXml(await zip.file(tpath).async('string'));
    const cs = wsrDesc(doc, 'clrScheme')[0];
    Array.prototype.forEach.call(cs ? cs.children : [], function (c) {
      const k = c.localName, e = c.children[0];
      if (!e) return;
      const v = e.localName === 'srgbClr' ? e.getAttribute('val') : e.getAttribute('lastClr');
      if (/^[0-9a-f]{6}$/i.test(v || '')) out[k] = '#' + v.toLowerCase();
    });
  } catch (e) { /* keep the defaults */ }
  return out;
}
// Placeholders of a layout or master: type, index and the position they carry.
function wsrPlaceholders(doc) {
  const out = [];
  wsrDesc(doc, 'sp').forEach(function (sp) {
    const ph = wsrDesc(wsrKid(wsrKid(sp, 'nvSpPr'), 'nvPr') || sp, 'ph')[0];
    if (!ph) return;
    const spPr = wsrKid(sp, 'spPr'), xf = spPr ? wsrKid(spPr, 'xfrm') : null;
    out.push({ type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx'), sp: sp, xfrm: xf });
  });
  return out;
}
function wsrFindPlaceholder(list, type, idx) {
  let hit = null;
  if (idx !== null && idx !== undefined) hit = list.filter(function (p) { return p.idx === idx; })[0];
  if (!hit) {
    const t = type === 'ctrTitle' ? 'title' : type;
    hit = list.filter(function (p) { return p.type === type || p.type === t || (type === 'ctrTitle' && p.type === 'ctrTitle'); })[0];
  }
  if (!hit && (type === 'subTitle' || type === 'obj' || type === 'body' || !type)) hit = list.filter(function (p) { return p.type === 'body'; })[0];
  return hit || null;
}
function wsrXfrmBox(xf) {
  if (!xf) return null;
  const off = wsrKid(xf, 'off'), ext = wsrKid(xf, 'ext');
  if (!off || !ext) return null;
  return { x: Number(off.getAttribute('x')) || 0, y: Number(off.getAttribute('y')) || 0, w: Number(ext.getAttribute('cx')) || 0, h: Number(ext.getAttribute('cy')) || 0,
    rot: Number(xf.getAttribute('rot')) || 0 };
}
// the "adj" value of a preset shape (rounded corners)
function wsrAdj(prst) {
  const gd = prst ? wsrDesc(prst, 'gd')[0] : null;
  const m = gd && /val\s+(-?\d+)/.exec(gd.getAttribute('fmla') || '');
  return m ? Number(m[1]) : null;
}
const WSR_RECT = { rect: 1, flowChartProcess: 1, snip1Rect: 1, snip2SameRect: 1, snipRoundRect: 1, frame: 1, plaque: 1, bevel: 1, flowChartPredefinedProcess: 1, flowChartDocument: 1 };
const WSR_ROUND = { roundRect: 1, round1Rect: 1, round2SameRect: 1, round2DiagRect: 1, flowChartAlternateProcess: 1, flowChartTerminator: 1 };
const WSR_ELLIPSE = { ellipse: 1, flowChartConnector: 1, donut: 1, noSmoking: 1, blockArc: 1, chord: 1, pie: 1, arc: 1 };
const WSR_POLY = { triangle: 'triangle', rtTriangle: 'rtTriangle', diamond: 'diamond', flowChartDecision: 'diamond', parallelogram: 'parallelogram',
  flowChartInputOutput: 'parallelogram', trapezoid: 'trapezoid', flowChartManualOperation: 'trapezoid', hexagon: 'hexagon', flowChartPreparation: 'hexagon',
  pentagon: 'pentagon', homePlate: 'pentagon', chevron: 'chevron', rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow' };

// Everything a shape tells about itself, resolved against the theme.
function wsrShapeLook(node, env, bgHex) {
  const spPr = wsrKid(node, 'spPr'), style = wsrKid(node, 'style');
  const out = { fill: null, grad: null, stroke: null, lw: 0, geom: 'rect', adj: null, hasFill: false, hasLine: false, unknown: false };
  const prst = spPr ? wsrKid(spPr, 'prstGeom') : null;
  if (spPr && wsrKid(spPr, 'custGeom')) out.unknown = true;
  if (prst) {
    const p = prst.getAttribute('prst') || 'rect';
    if (p === 'line' || p === 'straightConnector1' || p === 'lineInv') out.geom = 'line';
    else if (WSR_RECT[p]) out.geom = 'rect';
    else if (WSR_ROUND[p]) { out.geom = 'rect'; out.adj = wsrAdj(prst); if (out.adj === null) out.adj = 16667; }
    else if (WSR_ELLIPSE[p]) out.geom = 'ellipse';
    else if (WSR_POLY[p]) out.geom = WSR_POLY[p];
    else out.unknown = true;                                 // a shape this reader cannot draw
  }
  // fill
  const fillRef = style ? wsrKid(style, 'fillRef') : null;
  const refEnv = function (ref) { const rc = ref ? wsrColorIn(ref, env) : null; return Object.assign({}, env, { ph: rc ? rc.hex : env.ph }); };
  let fillEl = null;
  if (spPr) ['solidFill', 'gradFill', 'noFill', 'blipFill', 'pattFill', 'grpFill'].forEach(function (n) { if (!fillEl && wsrKid(spPr, n)) fillEl = wsrKid(spPr, n); });
  if (fillEl) {
    const n = fillEl.localName;
    if (n === 'solidFill') { const c = wsrBlend(wsrColorIn(fillEl, env), bgHex); if (c) { out.fill = c; out.hasFill = true; } }
    else if (n === 'gradFill') {
      const stops = wsrDesc(fillEl, 'gs').map(function (g) { return wsrBlend(wsrColorIn(g, env), bgHex); }).filter(Boolean);
      if (stops.length) {
        out.hasFill = true;
        out.fill = stops[0];
        if (stops.length > 1 && stops[0] !== stops[stops.length - 1]) {
          const lin = wsrDesc(fillEl, 'lin')[0], ang = lin ? (Number(lin.getAttribute('ang')) || 0) / 60000 : 90;
          const a = ((ang % 180) + 180) % 180;
          out.grad = { dir: (a < 20 || a > 160) ? 'horizontal' : (a > 70 && a < 110) ? 'vertical' : 'diagonal', c1: stops[0], c2: stops[stops.length - 1] };
        }
      }
    } else if (n === 'blipFill' || n === 'pattFill') out.unknown = out.unknown || false;   // pictures inside a shape are never copied
  } else if (fillRef && (Number(fillRef.getAttribute('idx')) || 0) > 0) {
    const c = wsrBlend(wsrColorIn(fillRef, env), bgHex);
    if (c) { out.fill = c; out.hasFill = true; }
  }
  // line
  const ln = spPr ? wsrKid(spPr, 'ln') : null, lineRef = style ? wsrKid(style, 'lnRef') : null;
  let lnW = ln && ln.getAttribute('w') !== null ? Number(ln.getAttribute('w')) : null;
  const lnNo = ln && wsrKid(ln, 'noFill');
  if (!lnNo) {
    let c = null;
    const sf = ln ? wsrKid(ln, 'solidFill') : null;
    if (sf) c = wsrColorIn(sf, env);
    else if (ln && wsrKid(ln, 'gradFill')) c = wsrColorIn(wsrDesc(ln, 'gs')[0], env);
    else if (lineRef && (Number(lineRef.getAttribute('idx')) || 0) > 0) {
      c = wsrColorIn(lineRef, env);
      if (lnW === null) lnW = (Number(lineRef.getAttribute('idx')) || 1) * 9525 + 3175;
    }
    const col = wsrBlend(c, bgHex);
    if (col && (lnW === null ? 12700 : lnW) > 0) { out.stroke = col; out.lw = lnW === null ? 12700 : lnW; out.hasLine = true; }
  }
  return out;
}

// Paragraph / run look from the shape, its layout placeholder, its master placeholder, and the master text styles.
function wsrLvlLook(el) {            // an <a:lvl1pPr> element
  if (!el) return null;
  const d = wsrKid(el, 'defRPr');
  return { algn: el.getAttribute('algn'), sz: d && d.getAttribute('sz') ? Number(d.getAttribute('sz')) / 100 : 0,
    b: d && d.getAttribute('b') !== null ? d.getAttribute('b') === '1' : null, i: d && d.getAttribute('i') !== null ? d.getAttribute('i') === '1' : null, rpr: d };
}
function wsrLstLevel(node, lvl) {    // lstStyle of a shape (txBody) at a level
  const tb = node ? wsrKid(node, 'txBody') : null, ls = tb ? wsrKid(tb, 'lstStyle') : null;
  return ls ? wsrLvlLook(wsrKid(ls, 'lvl' + lvl + 'pPr')) : null;
}

async function wsrPptxToPages(ab) {
  const zip = await JSZip.loadAsync(ab);
  const pres = zip.file('ppt/presentation.xml');
  if (!pres) throw new Error('that does not look like a PowerPoint file');
  const pdoc = wsrParseXml(await pres.async('string'));
  const sz = wsrDesc(pdoc, 'sldSz')[0];
  const cx = sz ? Number(sz.getAttribute('cx')) || 9144000 : 9144000;
  const cy = sz ? Number(sz.getAttribute('cy')) || 5143500 : 5143500;
  const mmW = Math.round(cx / 360) / 100, mmH = Math.round(cy / 360) / 100;
  const PX = 3.7795, pxW = mmW * PX, pxH = mmH * PX;
  const sx = pxW / cx, sy = pxH / cy;

  // slides in the order the deck shows them (presentation.xml), not the order of the file names
  const presRels = await wsrRelsOf(zip, 'ppt/presentation.xml');
  let slideNames = wsrDesc(pdoc, 'sldId').map(function (s) {
    const r = presRels[s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id')];
    return r && zip.file(r.path) ? r.path : null;
  }).filter(Boolean);
  if (!slideNames.length) {
    slideNames = Object.keys(zip.files)
      .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); });
  }
  slideNames = slideNames.slice(0, 40);
  if (!slideNames.length) throw new Error('that PowerPoint has no slides');

  const cache = {};   // layouts, masters and their themes are read once
  const loadPart = async function (path) {
    if (!path || !zip.file(path)) return null;
    if (!cache[path]) {
      const doc = wsrParseXml(await zip.file(path).async('string'));
      cache[path] = { path: path, doc: doc, rels: await wsrRelsOf(zip, path), ph: wsrPlaceholders(doc) };
    }
    return cache[path];
  };

  // the shape tree rule: position -> pixels, through the group's own scaling
  const IDENT = { sx: 1, ox: 0, sy: 1, oy: 0 };
  const place = function (T, b) {
    return { x: (T.ox + T.sx * b.x) * sx, y: (T.oy + T.sy * b.y) * sy, w: b.w * T.sx * sx, h: b.h * T.sy * sy, rot: b.rot };
  };
  const childFrame = function (T, grp) {
    const xf = wsrKid(wsrKid(grp, 'grpSpPr'), 'xfrm');
    if (!xf) return T;
    const off = wsrKid(xf, 'off'), ext = wsrKid(xf, 'ext'), co = wsrKid(xf, 'chOff'), ce = wsrKid(xf, 'chExt');
    if (!off || !ext) return T;
    const ox = Number(off.getAttribute('x')) || 0, oy = Number(off.getAttribute('y')) || 0, ew = Number(ext.getAttribute('cx')) || 1, eh = Number(ext.getAttribute('cy')) || 1;
    const cox = co ? Number(co.getAttribute('x')) || 0 : ox, coy = co ? Number(co.getAttribute('y')) || 0 : oy;
    const cew = ce ? Number(ce.getAttribute('cx')) || ew : ew, ceh = ce ? Number(ce.getAttribute('cy')) || eh : eh;
    const gx = ew / cew, gy = eh / ceh, gox = ox - cox * gx, goy = oy - coy * gy;
    return { sx: T.sx * gx, ox: T.ox + T.sx * gox, sy: T.sy * gy, oy: T.oy + T.sy * goy };
  };

  const pages = [];
  let seq = 0;
  for (let i = 0; i < slideNames.length; i++) {
    const spath = slideNames[i];
    const doc = wsrParseXml(await zip.file(spath).async('string'));
    const srels = await wsrRelsOf(zip, spath);
    let layout = null, master = null;
    Object.keys(srels).forEach(function (k) { if (/\/slideLayout$/.test(srels[k].type)) layout = srels[k].path; });
    layout = await loadPart(layout);
    if (layout) Object.keys(layout.rels).forEach(function (k) { if (/\/slideMaster$/.test(layout.rels[k].type)) master = layout.rels[k].path; });
    master = await loadPart(master || (zip.file('ppt/slideMasters/slideMaster1.xml') ? 'ppt/slideMasters/slideMaster1.xml' : null));
    if (master && !master.theme) {
      master.theme = await wsrLoadTheme(zip, master.path);
      const cm = wsrDesc(master.doc, 'clrMap')[0];
      master.map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      if (cm) ['bg1', 'tx1', 'bg2', 'tx2'].forEach(function (k) { if (cm.getAttribute(k)) master.map[k] = cm.getAttribute(k); });
    }
    const env = { theme: master ? master.theme : (await wsrLoadTheme(zip, 'ppt/slideMasters/slideMaster1.xml')), map: master ? master.map : { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }, ph: null };

    // page background: the slide's own, else the layout's, else the master's
    let bgColor = null;
    [doc, layout && layout.doc, master && master.doc].forEach(function (d) {
      if (bgColor || !d) return;
      const bg = wsrDesc(d, 'bg')[0];
      if (!bg) return;
      const bgPr = wsrKid(bg, 'bgPr'), bgRef = wsrKid(bg, 'bgRef');
      let c = null;
      if (bgPr) {
        const sf = wsrKid(bgPr, 'solidFill'), gf = wsrKid(bgPr, 'gradFill');
        c = sf ? wsrColorIn(sf, env) : gf ? wsrColorIn(wsrDesc(gf, 'gs')[0], env) : null;
      } else if (bgRef) c = wsrColorIn(bgRef, env);
      if (c) bgColor = wsrBlend(c, '#ffffff') || c.hex;
    });
    if (!bgColor) bgColor = env.theme[env.map.bg1] || '#ffffff';

    const pg = {
      type: 'blank', dataUrl: null, modified: true, edits: {}, textBlocks: [],
      placedTexts: [], placedImages: [], placedTables: [], placedShapes: [], label: 'Slide ' + (i + 1),
      bgColor: bgColor, pageMM: [mmW, mmH]
    };
    const fullBleed = [];

    // one shape / connector / group / picture, from a part (slide, layout or master)
    const walk = function (parent, T, src, inSlide) {
      Array.prototype.forEach.call(parent.children, function (node) {
        const kind = node.localName;
        if (kind === 'grpSp') { walk(node, childFrame(T, node), src, inSlide); return; }
        if (kind !== 'sp' && kind !== 'cxnSp' && kind !== 'pic') return;
        const nv = wsrKid(node, kind === 'sp' ? 'nvSpPr' : kind === 'cxnSp' ? 'nvCxnSpPr' : 'nvPicPr');
        const ph = wsrKid(nv ? wsrKid(nv, 'nvPr') : null, 'ph');
        if (!inSlide && ph) return;                          // layout / master placeholders are only templates for the slide's own
        const spPr = wsrKid(node, 'spPr');
        let box = wsrXfrmBox(spPr ? wsrKid(spPr, 'xfrm') : null);
        if (!box && ph) {                                     // a placeholder with no position of its own: take the layout's, then the master's
          const type = ph.getAttribute('type') || 'body', idx = ph.getAttribute('idx');
          const lph = layout ? wsrFindPlaceholder(layout.ph, type, idx) : null;
          box = lph && wsrXfrmBox(lph.xfrm);
          if (!box && master) { const mph = wsrFindPlaceholder(master.ph, lph ? lph.type : type, null); box = mph && wsrXfrmBox(mph.xfrm); }
          if (box) T = IDENT;                                 // inherited positions are already slide coordinates
        }
        if (!box) return;
        const b = place(T, box);
        if (!(b.w > 0 || b.h > 0)) return;
        // a shape turned a quarter turn swaps its width and height around its centre
        const rd = ((b.rot / 60000) % 180 + 180) % 180;
        if (rd > 45 && rd < 135) { const cxm = b.x + b.w / 2, cym = b.y + b.h / 2; const t = b.w; b.w = b.h; b.h = t; b.x = cxm - b.w / 2; b.y = cym - b.h / 2; }

        if (kind === 'pic') {
          seq++;
          pg.placedImages.push({ id: 'pimg_ref' + seq, dataUrl: '', kind: 'image', x: b.x, y: b.y, w: b.w, h: b.h });
          return;
        }
        // ── text ──
        const body = kind === 'sp' ? wsrKid(node, 'txBody') : null;
        const lines = [];
        let first = null, firstP = null;
        if (body) wsrDirKids(body, 'p').forEach(function (p) {
          const txt = wsrDesc(p, 't').map(function (t) { return t.textContent; }).join('');
          if (!txt.trim()) return;
          lines.push(txt);
          if (!first) { first = wsrDesc(p, 'rPr')[0] || null; firstP = p; }
        });
        const look = (kind === 'sp' || kind === 'cxnSp') ? wsrShapeLook(node, env, bgColor) : null;
        const lw = look ? look.lw * sx : 0;
        // ── the shape itself: a filled box, an outlined box, a bar, a rule, a rounded box, a circle ──
        if (look && !look.unknown && (look.hasFill || look.hasLine)) {
          const small = Math.min(b.w, b.h) <= 3;
          const isLine = look.geom === 'line';
          if (isLine && b.w > 3 && b.h > 3) { /* a slanted line cannot be drawn as a box */ }
          else if (b.w >= pxW * 0.9 && b.h >= pxH * 0.9 && look.hasFill && !look.grad && !isLine) fullBleed.push(look.fill);   // the page background
          else {
            const rule = isLine || (small && !lines.length);
            const col = rule ? (look.stroke || look.fill) : look.fill;
            const shp = {
              id: 'pshp_ref' + (++seq), x: b.x, y: b.y, w: Math.max(0, b.w), h: Math.max(0, b.h),
              fill: rule ? col : (look.hasFill ? look.fill : null), stroke: rule ? null : look.stroke, sw: rule ? Math.max(1, lw) : (look.stroke ? Math.max(0.75, lw) : 0),
              rule: !!rule
            };
            if (!rule && look.grad) shp.grad = look.grad;
            if (!rule && look.adj !== null) shp.r = Math.min(b.w, b.h) * Math.min(50000, look.adj) / 100000;
            if (!rule && look.geom !== 'rect' && look.geom !== 'line') shp.geom = look.geom;
            pg.placedShapes.push(shp);
          }
        }
        if (!lines.length) return;
        // ── the words ──
        const lvl = Math.max(1, Math.min(9, (firstP && wsrKid(firstP, 'pPr') ? Number(wsrKid(firstP, 'pPr').getAttribute('lvl')) || 0 : 0) + 1));
        const phType = ph ? (ph.getAttribute('type') || 'body') : null, phIdx = ph ? ph.getAttribute('idx') : null;
        const lph = ph && layout ? wsrFindPlaceholder(layout.ph, phType, phIdx) : null;
        const mph = ph && master ? wsrFindPlaceholder(master.ph, lph ? lph.type : phType, null) : null;
        const tsKind = !ph ? 'otherStyle' : (/title/i.test(phType) ? 'titleStyle' : /^(dt|ftr|sldNum)$/.test(phType) ? 'otherStyle' : 'bodyStyle');
        const ts = master ? wsrDesc(master.doc, 'txStyles')[0] : null;
        const tsLook = ts && wsrKid(ts, tsKind) ? wsrLvlLook(wsrKid(wsrKid(ts, tsKind), 'lvl' + lvl + 'pPr')) : null;
        const chain = [wsrLstLevel(node, lvl), lph ? wsrLstLevel(lph.sp, lvl) : null, mph ? wsrLstLevel(mph.sp, lvl) : null, tsLook].filter(Boolean);
        const pPr = firstP ? wsrKid(firstP, 'pPr') : null;
        let size = first && first.getAttribute('sz') ? Number(first.getAttribute('sz')) / 100 : 0;
        let bold = first && first.getAttribute('b') !== null ? first.getAttribute('b') === '1' : null;
        let italic = first && first.getAttribute('i') !== null ? first.getAttribute('i') === '1' : null;
        let al = pPr ? pPr.getAttribute('algn') : null;
        chain.forEach(function (c) {
          if (!size && c.sz) size = c.sz;
          if (bold === null && c.b !== null) bold = c.b;
          if (italic === null && c.i !== null) italic = c.i;
          if (!al && c.algn) al = c.algn;
        });
        // colour: the run, then the inherited levels, then the shape's own font reference, then the theme text colour
        let col = null;
        const runFill = first ? wsrKid(first, 'solidFill') : null;
        if (runFill) col = wsrColorIn(runFill, env);
        const ownLvl = wsrLstLevel(node, lvl), ownFill = ownLvl && ownLvl.rpr ? wsrKid(ownLvl.rpr, 'solidFill') : null;
        if (!col && ownFill) col = wsrColorIn(ownFill, env);
        // a drawn shape's own font reference (white on an accent box) beats the master's plain text colour
        if (!col && !ph) { const fr = wsrKid(wsrKid(node, 'style'), 'fontRef'); if (fr) col = wsrColorIn(fr, env); }
        for (let k = 0; !col && k < chain.length; k++) { const f = chain[k].rpr ? wsrKid(chain[k].rpr, 'solidFill') : null; if (f) col = wsrColorIn(f, env); }
        const colHex = col ? wsrBlend(col, bgColor) : null;
        const textColor = colHex || env.theme[env.map.tx1] || '#111111';
        const px = (size || 18) * 96 / 72;
        // text sits inside the shape's padding, and a centred or bottom-anchored text sits in the middle or at the foot
        const bp = body ? wsrKid(body, 'bodyPr') : null;
        const inset = function (n, d) { const v = bp && bp.getAttribute(n); return (v !== null && v !== '' && v !== undefined ? Number(v) : d) * sx; };
        const li = inset('lIns', 91440), ri = inset('rIns', 91440), ti = inset('tIns', 45720) * (sy / sx), bi = inset('bIns', 45720) * (sy / sx);
        let ty = b.y + ti;
        const anchor = bp ? bp.getAttribute('anchor') : null;
        const approxH = lines.length * px * 1.2;
        if (anchor === 'ctr' && b.h > approxH) ty = b.y + (b.h - approxH) / 2;
        else if (anchor === 'b' && b.h > approxH) ty = b.y + b.h - approxH - bi;
        seq++;
        pg.placedTexts.push({
          id: 'ptx_ref' + seq, text: lines.join('\n'),
          x: b.x + li, y: ty, w: Math.max(10, b.w - li - ri), fontSize: Math.round(px * 10) / 10,
          fontFamily: 'Inter', color: textColor, bold: !!bold, italic: !!italic, underline: false,
          align: al === 'ctr' ? 'center' : al === 'r' ? 'right' : 'left'
        });
      });
    };

    // behind the slide: master decoration, then layout decoration, then the slide itself
    const treeOf = function (d) { const c = d && wsrDesc(d, 'cSld')[0]; return c ? wsrKid(c, 'spTree') : null; };
    const showMaster = doc.documentElement.getAttribute('showMasterSp') !== '0';
    const layoutShowsMaster = !layout || layout.doc.documentElement.getAttribute('showMasterSp') !== '0';
    if (master && showMaster && layoutShowsMaster && treeOf(master.doc)) walk(treeOf(master.doc), IDENT, 'master', false);
    if (layout && showMaster && treeOf(layout.doc)) walk(treeOf(layout.doc), IDENT, 'layout', false);
    const tree = treeOf(doc);
    if (tree) walk(tree, IDENT, 'slide', true);
    // a full-page box is the slide's colour, not a shape to copy
    if (fullBleed.length && !wsrDesc(doc, 'bg')[0]) pg.bgColor = fullBleed[fullBleed.length - 1];
    pages.push(pg);
  }
  return pages;
}

// ─── Excel cell lines ────────────────────────────────────────────────────────
// SheetJS does not give the lines, so the workbook is opened as a zip and its styles read directly: which
// border each cell style has, then which style each cell of the first sheet uses. The result is one border
// look for the sheet's table. xlsx and xlsm only (a CSV has no styles, an old xls is not a zip).
async function wsrXlsxBorders(ab, ext) {
  if (ext !== 'xlsx' && ext !== 'xlsm') return null;
  try {
    const zip = await JSZip.loadAsync(ab);
    const stylesFile = zip.file('xl/styles.xml');
    if (!stylesFile) return null;
    const sty = wsrParseXml(await stylesFile.async('string'));
    const bordersEl = wsrDesc(sty, 'borders')[0];
    const xfsEl = wsrDesc(sty, 'cellXfs')[0];
    if (!bordersEl || !xfsEl) return null;
    const thick = { thin: 1, hair: 1, dotted: 1, dashed: 1, medium: 2, mediumDashed: 2, thick: 3, double: 3 };
    const borders = Array.prototype.filter.call(bordersEl.children, function (b) { return b.localName === 'border'; }).map(function (b) {
      const side = function (n) {
        const e = Array.prototype.filter.call(b.children, function (k) { return k.localName === n; })[0];
        const st = e && e.getAttribute('style');
        if (!st) return null;
        const c = e.children && e.children[0];
        const rgb = c && c.getAttribute('rgb');
        return { w: thick[st] || 1, color: rgb && /^[0-9a-f]{8}$/i.test(rgb) ? '#' + rgb.slice(2).toLowerCase() : '#000000' };
      };
      return { l: side('left'), r: side('right'), t: side('top'), b: side('bottom') };
    });
    const xfBorder = Array.prototype.filter.call(xfsEl.children, function (x) { return x.localName === 'xf'; }).map(function (x) { return parseInt(x.getAttribute('borderId'), 10) || 0; });
    // the first sheet, the one the reader builds its table from
    const names = Object.keys(zip.files).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); });
    if (!names.length) return null;
    const sh = wsrParseXml(await zip.file(names[0]).async('string'));
    const rowsEl = wsrDesc(sh, 'row');
    let n = 0, left = 0, right = 0, top = 0, bottom = 0, headBottom = 0, headN = 0, firstRowNo = null;
    const widths = [], colors = {};
    rowsEl.forEach(function (rw, ri) {
      const rno = parseInt(rw.getAttribute('r'), 10) || ri + 1;
      if (firstRowNo === null) firstRowNo = rno;
      Array.prototype.forEach.call(rw.children, function (c) {
        if (c.localName !== 'c') return;
        const hasValue = c.children && c.children.length > 0;
        if (!hasValue) return;                                  // empty styled cells are filler
        const b = borders[xfBorder[parseInt(c.getAttribute('s'), 10) || 0]] || {};
        n++;
        if (b.l) left++; if (b.r) right++; if (b.t) top++; if (b.b) bottom++;
        [b.l, b.r, b.t, b.b].forEach(function (x) { if (x) { widths.push(x.w); colors[x.color] = (colors[x.color] || 0) + 1; } });
        if (rno === firstRowNo) { headN++; if (b.b) headBottom++; }
      });
    });
    if (!n) return { color: '#000000', width: 1, rows: false, cols: false, outerH: false, outerV: false, headRule: false };   // no lines at all
    const share = function (k) { return k / n; };
    const horiz = share(Math.max(top, bottom)) >= 0.5, vert = share(Math.max(left, right)) >= 0.5;
    let color = '#000000', best = 0;
    Object.keys(colors).forEach(function (k) { if (colors[k] > best) { best = colors[k]; color = k; } });
    widths.sort(function (a, b) { return a - b; });
    return {
      color: color, width: widths.length ? widths[Math.floor(widths.length / 2)] : 1,
      rows: horiz, cols: vert, outerH: horiz, outerV: vert,
      headRule: !horiz && headN > 0 && headBottom / headN >= 0.6
    };
  } catch (e) { return null; }                                  // unreadable styles: keep the editor's usual grid
}

async function wsReadAnyReference(file) {
  wsrCheckSize(file);
  const ext = wsrExt(file);
  const name = wsrBase(file) || 'Reference';

  if (ext === 'pdf' || file.type === 'application/pdf') return wstyleSaveFromPdfFile(file);

  let pages = null, docName = file.name || '';
  if (ext === 'docx') {
    const parsed = await oxParseDocx(await file.arrayBuffer());
    if (!parsed.blocks.length) throw new Error('that Word file is empty, so there is nothing to learn from');
    parsed.keepBorders = true;                       // copy the Word table's lines too
    pages = (await oxLayoutWord(parsed)).pages;
  } else if (/^(xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/.test(ext)) {
    const abx = await file.arrayBuffer();
    pages = (await oxBuildSheetPages(abx, file.name)).pages;
    const xb = await wsrXlsxBorders(abx, ext);       // the sheet's own cell lines, when it has any
    if (xb) pages.forEach(function (pg) { (pg.placedTables || []).forEach(function (tb) { tb.borderStyle = xb; }); });
  } else if (ext === 'pptx') {
    pages = await wsrPptxToPages(await file.arrayBuffer());
  } else if (wsrIsImage(file, ext)) {
    return wstyleSaveFromImageFile(file, name);
  } else if (/^(doc|rtf|odt|odp|pages|ppt)$/.test(ext)) {
    throw new Error('.' + ext + ' cannot be read as a reference in the browser. Save it as PDF or Word (.docx) and attach that');
  } else {
    throw new Error('this format cannot be a reference. Use PDF, Word (.docx), Excel, CSV or PowerPoint (.pptx)');
  }

  if (!pages || !pages.length) throw new Error('nothing could be read from that file');
  const measured = [];
  for (let i = 0; i < pages.length && i < WSTYLE_MAX_PAGES; i++) {
    measured.push(await wstyleMeasurePage(pages[i], -1));   // -1: not an editor page, use its own size
  }
  return wstyleStoreMeasured(name, measured, { docName: docName, scope: 'all', fromFile: ext });
}

// ═════════════════════════════════════════════════════════════════════════════
// B. CONTENT
// ═════════════════════════════════════════════════════════════════════════════

function wsrReadText(file) {
  return new Promise(function (res, rej) {
    const rd = new FileReader();
    rd.onload = function () { res(String(rd.result || '')); };
    rd.onerror = function () { rej(new Error('could not read that file')); };
    rd.readAsText(file);
  });
}

function wsrTidy(s) {
  return String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function wsrOcrCanvas(canvas) {
  if (typeof Tesseract === 'undefined') throw new Error('the text-from-picture reader did not load, check your connection and refresh');
  const r = await Tesseract.recognize(canvas, 'eng+hin+guj');
  return (r && r.data && r.data.text) || '';
}

// One flattened page or picture. The first WSR_VISION_MAX of a file go to Kadessa vision
// (counts as a Kadessa message). Any failure (not signed in, daily limit, offline) falls back to the local reader.
async function wsrReadPicture(canvas, slot, tally) {
  if (slot < WSR_VISION_MAX && typeof window !== 'undefined' && typeof window.kadessaVisionOcrCall === 'function') {
    try {
      const k = Math.min(1, 2000 / Math.max(canvas.width, canvas.height));
      let c = canvas;
      if (k < 1) {
        c = document.createElement('canvas');
        c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
        c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      }
      const t = await window.kadessaVisionOcrCall(c.toDataURL('image/jpeg', 0.85), '');
      if (t && t.trim().length > 5) { tally.vision++; return t; }
    } catch (e) { /* fall through to the local reader */ }
  }
  tally.local++;
  return wsrOcrCanvas(canvas);
}

function wsrPictureNote(t) {
  const parts = [];
  if (t.vision) parts.push(t.vision + ' read by Kadessa vision');
  if (t.local) parts.push(t.local + ' read by the local reader');
  return parts.join(', ');
}

async function wsrImageText(file, tally) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise(function (res, rej) {
      const im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('could not open that picture')); };
      im.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await wsrReadPicture(c, 0, tally);
  } finally { URL.revokeObjectURL(url); }
}

async function wsrPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = (typeof sarvarcOpenPdfDocument === 'function')
    ? await sarvarcOpenPdfDocument(data) : await pdfjsLib.getDocument({ data: data }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages && out.join('\n').length < WSR_MAX_TEXT * 2; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    let line = '', lastY = null;
    tc.items.forEach(function (it) {
      const y = it.transform ? Math.round(it.transform[5]) : 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : '');
      lastY = y;
    });
    if (line) out.push(line);
    out.push('');
  }
  let text = wsrTidy(out.join('\n'));
  if (text.length >= 20) return { text: text, note: '' };
  // No text layer: it is a scan. Read the first pages as pictures.
  const parts = [], tally = { vision: 0, local: 0 };
  const n = Math.min(doc.numPages, WSR_OCR_MAX_PAGES);
  for (let p = 1; p <= n; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    parts.push(await wsrReadPicture(c, p - 1, tally));
  }
  text = wsrTidy(parts.join('\n\n'));
  return { text: text, note: 'flattened PDF, ' + wsrPictureNote(tally) + (doc.numPages > n ? ' (first ' + n + ' pages)' : '') };
}

async function wsrDocxText(file) {
  if (typeof mammoth === 'undefined') throw new Error('the Word reader did not load, check your connection and refresh');
  const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const root = new DOMParser().parseFromString('<body>' + r.value + '</body>', 'text/html').body;
  const lines = [];
  Array.prototype.slice.call(root.children).forEach(function walk(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') {
      Array.prototype.slice.call(el.querySelectorAll('tr')).forEach(function (tr) {
        lines.push(Array.prototype.slice.call(tr.children).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t'));
      });
    } else if (tag === 'ul' || tag === 'ol') {
      Array.prototype.slice.call(el.children).forEach(function (li) { lines.push('- ' + li.textContent.trim()); });
    } else {
      const t = el.textContent.trim();
      if (t) lines.push(t);
    }
  });
  return wsrTidy(lines.join('\n'));
}

async function wsrSheetText(file) {
  if (typeof XLSX === 'undefined') throw new Error('the Excel reader did not load, check your connection and refresh');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const out = [];
  wb.SheetNames.forEach(function (n) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t', blankrows: false });
    if (!csv.trim()) return;
    if (wb.SheetNames.length > 1) out.push('## ' + n);
    out.push(csv);
  });
  return wsrTidy(out.join('\n'));
}

async function wsrPptxText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
    .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); });
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const doc = wsrParseXml(await zip.file(names[i]).async('string'));
    const lines = wsrDesc(doc, 'p').map(function (p) { return wsrDesc(p, 't').map(function (t) { return t.textContent; }).join(''); }).filter(function (s) { return s.trim(); });
    if (lines.length) out.push('## Slide ' + (i + 1) + '\n' + lines.join('\n'));
  }
  return wsrTidy(out.join('\n\n'));
}

// OpenDocument: .odt (text), .odp (slides), .ods (sheets use the Excel reader)
async function wsrOdfText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const f = zip.file('content.xml');
  if (!f) throw new Error('that file looks damaged');
  const doc = wsrParseXml(await f.async('string'));
  const lines = [];
  Array.prototype.slice.call(doc.getElementsByTagNameNS('*', '*')).forEach(function (el) {
    if (el.localName === 'p' || el.localName === 'h') {
      // skip paragraphs that sit inside a table cell here, the row below handles them
      if (el.parentNode && el.parentNode.localName === 'table-cell') return;
      const t = el.textContent.trim();
      if (t) lines.push(t);
    } else if (el.localName === 'table-row') {
      const cells = Array.prototype.slice.call(el.childNodes).filter(function (c) { return c.localName === 'table-cell'; });
      if (cells.length) lines.push(cells.map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t'));
    }
  });
  return wsrTidy(lines.join('\n'));
}

function wsrRtfText(rtf) {
  let s = String(rtf);
  // drop the groups that never hold visible text (font table, colors, style sheet, pictures, info)
  for (let k = 0; k < 6; k++) s = s.replace(/\{(?:\\\*)?\\(?:fonttbl|colortbl|stylesheet|info|pict|header|footer)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\'([0-9a-f]{2})/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\u(-?\d+)\??/g, function (_, n) { n = Number(n); return String.fromCharCode(n < 0 ? n + 65536 : n); })
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([\\{}])/g, '$1').replace(/[{}]/g, '');
  return wsrTidy(s);
}

function wsrHtmlText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach(function (n) { n.remove(); });
  doc.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
  doc.querySelectorAll('tr').forEach(function (tr) {
    tr.textContent = Array.prototype.slice.call(tr.children).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }).join('\t') + '\n';
  });
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach(function (n) { n.appendChild(doc.createTextNode('\n')); });
  return wsrTidy(doc.body ? doc.body.textContent : '');
}

// Returns { text, note }. Throws a plain-language error when a format cannot be read.
async function wsReadAnyContent(file) {
  wsrCheckSize(file);
  const ext = wsrExt(file);
  let text = '', note = '';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const r = await wsrPdfText(file); text = r.text; note = r.note;
  } else if (ext === 'docx') {
    text = await wsrDocxText(file);
  } else if (/^(xlsx|xlsm|xlsb|xls|ods)$/.test(ext)) {
    text = await wsrSheetText(file);
  } else if (ext === 'pptx') {
    text = await wsrPptxText(file);
  } else if (ext === 'odt' || ext === 'odp') {
    text = await wsrOdfText(file);
  } else if (ext === 'doc' || ext === 'ppt') {
    throw new Error('old .' + ext + ' files cannot be read in the browser. Save it as .' + ext + 'x or PDF and attach that');
  } else if (wsrIsImage(file, ext)) {
    const tally = { vision: 0, local: 0 };
    text = wsrTidy(await wsrImageText(file, tally)); note = wsrPictureNote(tally);
  } else if (ext === 'rtf') {
    text = wsrRtfText(await wsrReadText(file));
  } else if (ext === 'html' || ext === 'htm') {
    text = wsrHtmlText(await wsrReadText(file));
  } else if (ext === 'json') {
    const raw = await wsrReadText(file);
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { text = raw; }
  } else {
    // txt, md, csv, tsv, log, xml, yaml, or anything else: try it as plain text
    const raw = await wsrReadText(file);
    const bad = (raw.slice(0, 4000).match(/[\u0000\uFFFD]/g) || []).length;
    if (bad > 8) throw new Error('this format cannot be read. Save it as PDF, Word (.docx), Excel, or TXT and attach that');
    text = wsrTidy(raw);
  }

  if (!text) throw new Error('no text was found in ' + (file.name || 'that file'));
  if (text.length > WSR_MAX_TEXT) {
    note = (note ? note + '. ' : '') + 'only the first ' + WSR_MAX_TEXT.toLocaleString('en-US') + ' characters are used';
    text = text.slice(0, WSR_MAX_TEXT);
  }
  return { text: text, note: note };
}
