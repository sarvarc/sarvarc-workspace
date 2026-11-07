// ─── PDF EDITOR: LINE STYLES (Dashed, Dotted, Divider, Fancy Divider) ───────
// Everything about the extra line tools lives in THIS file, so js/24 only keeps a few small hooks:
//   1. Registers the 4 tools (list, icons, labels) so the Shapes dropdown can use them.
//   2. pdfedDrawLineStyleOnCtx   draws dashed / dotted / divider / fancy divider.
//   3. pdfedShapeEndpoints       where a line starts and ends inside its box (screen AND export use it).
//   4. pdfedLinePlacement        the box a new line gets when it is drawn or clicked (true flat lines).
//   5. pdfedLineHandleDirs       which resize handles a line gets (only its 2 ends, see below).
// Why lines get only 2 handles: a flat line's box is thin. The usual 8 handles (10 px each) covered
// almost all of it, so grabbing a line to MOVE it often grabbed a resize handle instead.
// Loads after js/24 and js/73 (needs pdfedShapeTools, pdfedShapeSVGs, pdfedShapeLabels from js/24).

// DIRECTIONAL tools have a start and an end (they keep pointing the way they were drawn).
// DIVIDERS are always flat, left to right, and ignore the slope of the drag. Their drag only sets the length.
// VERTICAL dividers are always flat, top to bottom (column separators). Their drag only sets the height.
// CORNER shapes (L, rounded L, elbow) use the whole drag box and mirror with the drag direction.
const PDFED_DIRECTIONAL_SHAPES = ['line', 'arrow', 'dblarrow', 'dashline', 'dotline'];
const PDFED_DIVIDER_SHAPES = ['divider', 'dividerorn', 'doubleline', 'thickthin', 'accentline', 'fadeline', 'threedots', 'wave', 'zigzag'];
const PDFED_VDIVIDER_SHAPES = ['vdivider'];
const PDFED_CORNER_SHAPES = ['lshape', 'roundl', 'elbow'];
const PDFED_LINE_HIT_MIN = 20; // a flat line's box is never thinner than this, so it is easy to grab

// ONE table drives everything: Shapes dropdown tile, main-button icon, label. To add another separator style,
// add a row here, a case in pdfedDrawLineStyleOnCtx, and (if it is flat) its name in a list above.
const PDFED_LINE_STYLE_TABLE = [
  // [tool, label, group, svg inner]
  ['divider',    'Divider',       'sep', '<line x1="2" y1="12" x2="22" y2="12"/>'],
  ['dividerorn', 'Fancy Divider', 'sep', '<line x1="2" y1="12" x2="8" y2="12"/><polygon points="12 8.5 15.5 12 12 15.5 8.5 12" fill="currentColor" stroke="none"/><line x1="16" y1="12" x2="22" y2="12"/>'],
  ['doubleline', 'Double Line',   'sep', '<line x1="2" y1="9" x2="22" y2="9" stroke-width="1.6"/><line x1="2" y1="15" x2="22" y2="15" stroke-width="1.6"/>'],
  ['thickthin',  'Thick + Thin',  'sep', '<line x1="2" y1="8" x2="22" y2="8" stroke-width="4" stroke-linecap="butt"/><line x1="2" y1="16" x2="22" y2="16" stroke-width="1.2" stroke-linecap="butt"/>'],
  ['accentline', 'Accent Line',   'sep', '<line x1="2" y1="12" x2="8" y2="12" stroke-width="4.5" stroke-linecap="butt"/><line x1="8" y1="12" x2="22" y2="12" stroke-width="1.4" stroke-linecap="butt"/>'],
  ['fadeline',   'Fade Line',     'sep', '<line x1="2" y1="12" x2="6" y2="12" opacity=".2"/><line x1="6" y1="12" x2="10" y2="12" opacity=".55"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="14" y1="12" x2="18" y2="12" opacity=".55"/><line x1="18" y1="12" x2="22" y2="12" opacity=".2"/>'],
  ['threedots',  'Three Dots',    'sep', '<circle cx="6" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.9" fill="currentColor" stroke="none"/>'],
  ['wave',       'Wave Line',     'sep', '<path d="M2 12 q2.5 -6 5 0 t5 0 t5 0 t5 0"/>'],
  ['zigzag',     'Zigzag Line',   'sep', '<polyline points="2 14 6 9 10 15 14 9 18 15 22 10"/>'],
  ['dashline',   'Dashed Line',   'sep', '<line x1="2" y1="12" x2="7" y2="12" stroke-linecap="butt"/><line x1="9.5" y1="12" x2="14.5" y2="12" stroke-linecap="butt"/><line x1="17" y1="12" x2="22" y2="12" stroke-linecap="butt"/>'],
  ['dotline',    'Dotted Line',   'sep', '<line x1="3" y1="12" x2="21" y2="12" stroke-width="3" stroke-dasharray="0.1 4.5"/>'],
  ['vdivider',   'Vertical Line', 'sep', '<line x1="12" y1="2" x2="12" y2="22"/>'],
  ['lshape',     'L Shape',       'cor', '<polyline points="6 3 6 19 21 19"/>'],
  ['roundl',     'Round L',       'cor', '<path d="M6 3 V13 a6 6 0 0 0 6 6 H21"/>'],
  ['elbow',      'Elbow',         'cor', '<polyline points="3 6 12 6 12 18 21 18"/>']
];
const PDFED_LINE_STYLE_TOOLS = PDFED_LINE_STYLE_TABLE.map(function (r) { return r[0]; });
function pdfedIsLineStyleTool(tool) { return PDFED_LINE_STYLE_TOOLS.indexOf(tool) !== -1; }

(function () {
  if (typeof pdfedShapeTools === 'undefined') return;
  const svg = function (size, inner) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  };
  PDFED_LINE_STYLE_TABLE.forEach(function (r) {
    if (pdfedShapeTools.indexOf(r[0]) === -1) pdfedShapeTools.push(r[0]);
    pdfedShapeSVGs[r[0]] = svg(14, r[3]);
    pdfedShapeLabels[r[0]] = r[1];
  });

  // The Shapes dropdown in workspace.html only lists the original shapes, so the new ones are added here,
  // under their own small headings. Same tile look as the others. (js/24 needs a tile for EVERY tool in
  // pdfedShapeTools, otherwise opening the dropdown fails.)
  function addTiles() {
    const dd = document.getElementById('pdfedShapesDropdown');
    if (!dd || dd.getAttribute('data-line-styles') === '1') return;
    dd.setAttribute('data-line-styles', '1');
    [['sep', 'Separators'], ['cor', 'Corners']].forEach(function (g) {
      const head = document.createElement('div');
      head.className = 'pdfed-shapes-group-label';
      head.textContent = g[1];
      dd.appendChild(head);
      PDFED_LINE_STYLE_TABLE.filter(function (r) { return r[2] === g[0]; }).forEach(function (r) {
        const tile = document.createElement('div');
        tile.className = 'pdfed-shapes-opt pdfed-shapes-opt-grid';
        tile.id = 'pdfedShapesOpt-' + r[0];
        tile.title = r[1];
        tile.onclick = function () { pdfedShapesSelect(r[0]); };
        tile.innerHTML = svg(16, r[3]) + '<span>' + r[1] + '</span>';
        dd.appendChild(tile);
      });
    });
  }
  addTiles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addTiles);
})();

// Height of the thin box a flat separator lives in (also its hit area). Big enough for its stroke and ornament.
function pdfedSeparatorBoxH(tool, size) {
  const lw = Math.max(1.5, Number(size) || 2);
  let need = lw + 6;
  if (tool === 'dividerorn') need = Math.ceil(Math.max(lw * 2.5, 7) * 2) + 4;
  else if (tool === 'doubleline') need = Math.ceil(Math.max(lw * 2.2, 5) + lw * 0.8) + 8;
  else if (tool === 'thickthin') need = Math.ceil(lw * 2 + Math.max(lw * 1.2, 3) + Math.max(1, lw * 0.6)) + 8;
  else if (tool === 'accentline') need = Math.ceil(lw * 2.2) + 8;
  else if (tool === 'threedots') need = Math.ceil(Math.max(lw * 1.1, 2.2) * 2) + 10;
  else if (tool === 'wave' || tool === 'zigzag') need = Math.ceil(Math.max(lw * 1.8, 4) * 2 + lw) + 8;
  return Math.max(PDFED_LINE_HIT_MIN, need);
}

// Dash length and gap scale with the stroke size so every thickness looks right.
// A dot is a zero-length dash with a round cap. Dividers ignore the slope of the drag and sit flat
// at the middle height of their box. Every style uses the colour and opacity the caller already set on ctx.
function pdfedDrawLineStyleOnCtx(ctx, tool, size, x1, y1, x2, y2) {
  const lw = Math.max(1.5, Number(size) || 2);
  ctx.save();
  ctx.lineWidth = lw;
  if (tool === 'dashline' || tool === 'dotline') {
    if (tool === 'dashline') {
      ctx.lineCap = 'butt';
      ctx.setLineDash([lw * 4, lw * 2.5]);
    } else {
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, lw * 2.2]);
      // Pull both ends in by half a dot so the first and last dot are not cut off by the edge of the box.
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len > lw * 2) {
        const ux = dx / len * lw / 2, uy = dy / len * lw / 2;
        x1 += ux; y1 += uy; x2 -= ux; y2 -= uy;
      }
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lo = Math.min(x1, x2) + lw / 2, hi = Math.max(x1, x2) - lw / 2, y = (y1 + y2) / 2;
  const hline = function (a, b, yy, width, cap) {
    if (!(b > a)) return;
    ctx.lineWidth = width; ctx.lineCap = cap || 'round';
    ctx.beginPath(); ctx.moveTo(a, yy); ctx.lineTo(b, yy); ctx.stroke();
  };
  if (tool === 'divider') {
    hline(lo, hi, y, lw);
  } else if (tool === 'dividerorn') {
    const d = Math.max(lw * 2.5, 7), pad = d * 0.9, cx = (lo + hi) / 2;
    if (hi - lo > 2 * (d + pad) + lw * 4) {
      ctx.beginPath();
      ctx.moveTo(lo, y); ctx.lineTo(cx - d - pad, y);
      ctx.moveTo(cx + d + pad, y); ctx.lineTo(hi, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, y - d); ctx.lineTo(cx + d, y); ctx.lineTo(cx, y + d); ctx.lineTo(cx - d, y);
    ctx.closePath();
    ctx.fill();
  } else if (tool === 'doubleline') {
    const gap = Math.max(lw * 2.2, 5), w = Math.max(1, lw * 0.8);
    hline(lo, hi, y - gap / 2, w); hline(lo, hi, y + gap / 2, w);
  } else if (tool === 'thickthin') {
    const t1 = lw * 2, t2 = Math.max(1, lw * 0.6), gap = Math.max(lw * 1.2, 3), top = y - (t1 + gap + t2) / 2;
    const a = Math.min(x1, x2), b = Math.max(x1, x2);
    hline(a, b, top + t1 / 2, t1, 'butt'); hline(a, b, top + t1 + gap + t2 / 2, t2, 'butt');
  } else if (tool === 'accentline') {
    const a = Math.min(x1, x2), b = Math.max(x1, x2), blockW = Math.min(Math.max((b - a) * 0.18, 24), 70, b - a);
    hline(a + blockW, b, y, Math.max(1, lw * 0.6), 'butt'); hline(a, a + blockW, y, lw * 2.2, 'butt');
  } else if (tool === 'fadeline') {
    // Fades in and out at both ends: draw the line on a small scratch canvas, fade its ends with a mask,
    // then stamp it. Works with any colour and leaves no seams.
    const a = Math.min(x1, x2), b = Math.max(x1, x2), wpx = Math.ceil(b - a), hpx = Math.ceil(lw + 4);
    if (wpx > 4) {
      const oc = document.createElement('canvas'); oc.width = wpx; oc.height = hpx;
      const o = oc.getContext('2d');
      o.strokeStyle = ctx.strokeStyle; o.lineWidth = lw; o.lineCap = 'butt';
      o.beginPath(); o.moveTo(0, hpx / 2); o.lineTo(wpx, hpx / 2); o.stroke();
      const g = o.createLinearGradient(0, 0, wpx, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,1)');
      g.addColorStop(0.7, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      o.globalCompositeOperation = 'destination-in'; o.fillStyle = g; o.fillRect(0, 0, wpx, hpx);
      ctx.drawImage(oc, a, y - hpx / 2);
    }
  } else if (tool === 'threedots') {
    const r = Math.max(lw * 1.1, 2.2), cx = (Math.min(x1, x2) + Math.max(x1, x2)) / 2;
    [-1, 0, 1].forEach(function (k) { ctx.beginPath(); ctx.arc(cx + k * r * 5, y, r, 0, Math.PI * 2); ctx.fill(); });
  } else if (tool === 'wave') {
    // A whole number of waves fits exactly edge to edge (the wave length is stretched a little to make that true),
    // so both ends sit cleanly on the edges at the middle height.
    const amp = Math.max(lw * 1.8, 4), span = hi - lo;
    if (span > 0) {
      const len = span / Math.max(1, Math.round(span / (amp * 5)));
      ctx.beginPath();
      for (let x = lo; x <= hi + 0.01; x += 1.5) {
        const xx = Math.min(x, hi), yy = y + amp * Math.sin(((xx - lo) / len) * Math.PI * 2);
        if (x === lo) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.lineTo(hi, y);
      ctx.stroke();
    }
  } else if (tool === 'zigzag') {
    // An even number of equal teeth fits exactly edge to edge, so both ends touch the edges at the same height
    // and no tooth is cut off.
    const amp = Math.max(lw * 1.8, 4), span = hi - lo;
    if (span > 0) {
      const n = Math.max(2, 2 * Math.round(span / (amp * 1.6) / 2)), step = span / n;
      ctx.beginPath(); ctx.moveTo(lo, y + amp);
      for (let k = 1; k <= n; k++) ctx.lineTo(lo + k * step, y + (k % 2 ? -amp : amp));
      ctx.stroke();
    }
  } else if (tool === 'vdivider') {
    const cx = (x1 + x2) / 2, top = Math.min(y1, y2) + lw / 2, bot = Math.max(y1, y2) - lw / 2;
    if (bot > top) { ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bot); ctx.stroke(); }
  } else if (tool === 'lshape') {
    // Down from the start, then across to the end. Dragging the other way mirrors it (4 corners).
    ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y2); ctx.lineTo(x2, y2); ctx.stroke();
  } else if (tool === 'roundl') {
    const r = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.arcTo(x1, y2, x2, y2, Math.min(r, 60)); ctx.lineTo(x2, y2); ctx.stroke();
  } else if (tool === 'elbow') {
    const xm = (x1 + x2) / 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xm, y1); ctx.lineTo(xm, y2); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.restore();
}

// Start and end point of a placed shape inside its own box (w by h). Lines and arrows keep pointing
// the way they were drawn (flipX / flipY). A line drawn straight across (flatY) or straight down
// (flatX) is drawn dead flat through the middle of its box, so it is a true horizontal or vertical
// line and not a slightly tilted one. Used by the on-screen canvas AND by export, so both match.
function pdfedShapeEndpoints(item, w, h) {
  const dir = PDFED_DIRECTIONAL_SHAPES.indexOf(item.tool) !== -1;
  const flips = dir || PDFED_CORNER_SHAPES.indexOf(item.tool) !== -1; // corner shapes mirror with the drag, but are never flattened
  if (w == null) w = item.w;
  if (h == null) h = item.h;
  let x1 = flips && item.flipX ? w : 0, y1 = flips && item.flipY ? h : 0;
  let x2 = flips && item.flipX ? 0 : w, y2 = flips && item.flipY ? 0 : h;
  if (dir && item.flatY) { y1 = h / 2; y2 = h / 2; }
  if (dir && item.flatX) { x1 = w / 2; x2 = w / 2; }
  return { x1: x1, y1: y1, x2: x2, y2: y2 };
}

// The box a NEW line-type shape gets, from where the person pressed and let go. Returns null for
// every other shape (js/24 then keeps its own box logic). Rules:
//   a click drops a ready-made 240 px flat line, centred on the click;
//   a divider is always flat; its drag only sets the length;
//   a line dragged straight across (or down) is made truly flat (flatY / flatX);
//   a flat line's box is at least PDFED_LINE_HIT_MIN thick (and thick enough for its stroke or
//   arrow head), so it is easy to grab and nothing is clipped.
function pdfedLinePlacement(tool, size, x1, y1, x2, y2, pageW) {
  const isLine = PDFED_DIRECTIONAL_SHAPES.indexOf(tool) !== -1;
  const isDivider = PDFED_DIVIDER_SHAPES.indexOf(tool) !== -1;
  const isV = PDFED_VDIVIDER_SHAPES.indexOf(tool) !== -1;
  const isCorner = PDFED_CORNER_SHAPES.indexOf(tool) !== -1;
  if (!isLine && !isDivider && !isV && !isCorner) return null;
  const MIN = 12;
  const rawW = Math.abs(x2 - x1), rawH = Math.abs(y2 - y1);
  const ym = (y1 + y2) / 2, xm = (x1 + x2) / 2;
  if (isCorner) {
    // Uses the whole drag box. A plain click drops a ready-made one centred on the click.
    const click = rawW < MIN && rawH < MIN;
    const c = { w: click ? 140 : Math.max(rawW, 24), h: click ? 100 : Math.max(rawH, 24), flipX: click ? false : x2 < x1, flipY: click ? false : y2 < y1, flatX: false, flatY: false };
    c.x = click ? xm - c.w / 2 : Math.min(x1, x2);
    c.y = click ? ym - c.h / 2 : Math.min(y1, y2);
    c.x = Math.max(0, c.x); c.y = Math.max(0, c.y);
    return c;
  }
  if (isV) {
    const clicked = rawH < 30;
    const v = { w: pdfedSeparatorBoxH('divider', size), h: clicked ? 240 : rawH, flipX: false, flipY: false, flatX: false, flatY: false };
    v.x = Math.max(0, xm - v.w / 2);
    v.y = Math.max(0, clicked ? ym - v.h / 2 : Math.min(y1, y2));
    return v;
  }
  const flatThickness = (tool === 'arrow' || tool === 'dblarrow')
    ? Math.max(PDFED_LINE_HIT_MIN, Math.ceil(Math.max(size * 5, 20) * 0.9) + 4)
    : Math.max(PDFED_LINE_HIT_MIN, size + 4);
  const r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(rawW, MIN), h: Math.max(rawH, MIN), flipX: x2 < x1, flipY: y2 < y1, flatX: false, flatY: false };
  if (isDivider || (rawW < MIN && rawH < MIN)) {
    const clicked = rawW < 30;
    r.w = clicked ? 240 : rawW;
    if (pageW && r.w > pageW) r.w = pageW;
    r.x = clicked ? xm - r.w / 2 : Math.min(x1, x2);
    if (pageW) r.x = Math.max(0, Math.min(r.x, pageW - r.w));
    r.h = isDivider ? pdfedSeparatorBoxH(tool, size) : flatThickness;
    r.y = ym - r.h / 2;
    r.flipX = false; r.flipY = false;
    if (isLine) r.flatY = true;
  } else if (rawH < MIN) {
    r.h = flatThickness; r.y = ym - r.h / 2; r.flatY = true;
  } else if (rawW < MIN) {
    r.w = flatThickness; r.x = xm - r.w / 2; r.flatX = true;
  }
  // A line drawn right along the top or left edge must not start off the page.
  if (r.x < 0) r.x = 0;
  if (r.y < 0) r.y = 0;
  return r;
}

// Which resize handles a line shows. Only its two ends (like Canva), so the middle of the line is
// always free to grab and drag. Returns null for other shapes (they keep all 8 handles).
function pdfedLineHandleDirs(item) {
  if (PDFED_DIVIDER_SHAPES.indexOf(item.tool) !== -1) return ['w', 'e'];
  if (PDFED_VDIVIDER_SHAPES.indexOf(item.tool) !== -1) return ['n', 's'];
  if (PDFED_CORNER_SHAPES.indexOf(item.tool) !== -1) return null; // all 8 handles, like a box
  if (PDFED_DIRECTIONAL_SHAPES.indexOf(item.tool) === -1) return null;
  if (item.flatY) return ['w', 'e'];
  if (item.flatX) return ['n', 's'];
  // Slanted line: its two ends are two opposite corners of the box.
  const start = (item.flipY ? 's' : 'n') + (item.flipX ? 'e' : 'w');
  const end = (item.flipY ? 'n' : 's') + (item.flipX ? 'w' : 'e');
  return [start, end];
}

// ─── FIT TO EDGES (one-click on any line / divider / arrow) ─────────────────
// People use lines to SEPARATE sections, so instead of a new tool, every line-type shape gets one
// extra badge in its hover bar. One click makes the line dead flat and stretches it edge to edge.
// Mostly-horizontal (or any divider) -> full page width. Mostly-vertical -> full page height.
// It reuses pdfedLinePlacement so the box thickness, flat flags and hit area match a freshly drawn line.
// Undo / redo supported.
function pdfedIsLineItem(item) {
  return !!item && (PDFED_DIRECTIONAL_SHAPES.indexOf(item.tool) !== -1 || PDFED_DIVIDER_SHAPES.indexOf(item.tool) !== -1 || PDFED_VDIVIDER_SHAPES.indexOf(item.tool) !== -1);
}

// Works out where one line goes when fitted. Returns {item, before, after} or null.
function pdfedFitPlan(item, W, H) {
  if (!pdfedIsLineItem(item) || item.locked) return null;
  // A line rotated near 90 degrees reads as vertical even though its box is wide.
  const rot = Math.abs(((item.rotation || 0) % 180));
  const swapped = rot > 45 && rot < 135;
  const bw = swapped ? item.h : item.w, bh = swapped ? item.w : item.h;
  const vertical = PDFED_VDIVIDER_SHAPES.indexOf(item.tool) !== -1 || (PDFED_DIVIDER_SHAPES.indexOf(item.tool) === -1 && bh > bw);
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  const r = vertical
    ? pdfedLinePlacement(item.tool, item.size, cx, 0, cx, H, W)
    : pdfedLinePlacement(item.tool, item.size, 0, cy, W, cy, W);
  if (!r) return null;
  const keys = ['x', 'y', 'w', 'h', 'flipX', 'flipY', 'flatX', 'flatY', 'rotation'];
  const before = {}; keys.forEach(function (k) { before[k] = item[k]; });
  const after = { x: r.x, y: r.y, w: r.w, h: r.h, flipX: r.flipX, flipY: r.flipY, flatX: r.flatX, flatY: r.flatY, rotation: 0 };
  if (vertical) { after.y = 0; after.h = H; after.x = Math.max(0, Math.min(after.x, W - after.w)); }
  else { after.x = 0; after.w = W; after.y = Math.max(0, Math.min(after.y, H - after.h)); }
  return { item: item, before: before, after: after };
}

// One click on Fit. If the clicked line is part of a selection (marquee, Ctrl+A, shift-click), EVERY selected
// line is fitted, in one go and as one undo step. Otherwise just the clicked line.
function pdfedFitLineToEdges(idx, id) {
  const pg = pdfed.pages[idx];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pg || !pc || !pc.width) return;
  const list = pg.placedShapes || [];
  const clicked = list.find(function (s) { return s.id === id; });
  if (!clicked) return;
  let targets = [clicked], selectedIds = [];
  if (typeof pdfedGetActiveSelection === 'function') {
    const sel = pdfedGetActiveSelection();
    if (sel && sel.idx === idx) {
      selectedIds = sel.items.filter(function (e) { return e.kind === 'shape'; }).map(function (e) { return e.item.id; });
      if (selectedIds.indexOf(id) !== -1) {
        targets = sel.items.filter(function (e) { return e.kind === 'shape'; }).map(function (e) { return e.item; });
      }
    }
  }
  const plans = targets.map(function (it) { return pdfedFitPlan(it, pc.width, pc.height); }).filter(Boolean);
  if (!plans.length) return;
  const apply = function (which) {
    plans.forEach(function (pl) {
      const vals = pl[which];
      Object.keys(vals).forEach(function (k) { if (vals[k] === undefined) delete pl.item[k]; else pl.item[k] = vals[k]; });
    });
    pdfedMarkModified(idx);
    pdfedRenderPlacedShapes(idx);
    // A re-render builds fresh elements, so put the selection back.
    if (selectedIds.length > 1 && typeof pdfedReapplySelectedClass === 'function') pdfedReapplySelectedClass(selectedIds);
  };
  apply('after');
  toast(plans.length > 1 ? plans.length + ' lines fitted to page edges' : 'Line fitted to page edges', 'success');
  if (typeof pushAppHistory === 'function') {
    pushAppHistory({ label: 'Fit lines to edges', undo: function () { apply('before'); }, redo: function () { apply('after'); } });
  }
}

// Builds the badge button; js/24 appends it to the hover bar of every placed shape (null for non-lines).
function pdfedLineFitBadge(idx, item) {
  if (!pdfedIsLineItem(item)) return null;
  const b = document.createElement('button');
  b.className = 'pdfed-badge-btn';
  b.title = 'Fit to page edges';
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="3" y2="19"/><line x1="21" y1="5" x2="21" y2="19"/><line x1="6" y1="12" x2="18" y2="12"/><polyline points="9 9 6 12 9 15"/><polyline points="15 9 18 12 15 15"/></svg>';
  b.onclick = function (ev) { ev.stopPropagation(); pdfedFitLineToEdges(idx, item.id); };
  return b;
}
