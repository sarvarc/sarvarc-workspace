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
// DIVIDERS are always flat, left to right, and ignore the slope of the drag.
const PDFED_DIRECTIONAL_SHAPES = ['line', 'arrow', 'dblarrow', 'dashline', 'dotline'];
const PDFED_DIVIDER_SHAPES = ['divider', 'dividerorn'];
const PDFED_LINE_HIT_MIN = 20; // a flat line's box is never thinner than this, so it is easy to grab

(function () {
  if (typeof pdfedShapeTools === 'undefined') return;
  const svg = function (stroke, inner) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + stroke + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  };
  ['dashline', 'dotline', 'divider', 'dividerorn'].forEach(function (t) {
    if (pdfedShapeTools.indexOf(t) === -1) pdfedShapeTools.push(t);
  });
  Object.assign(pdfedShapeSVGs, {
    dashline: svg(2, '<line x1="2" y1="12" x2="7" y2="12" stroke-linecap="butt"/><line x1="9.5" y1="12" x2="14.5" y2="12" stroke-linecap="butt"/><line x1="17" y1="12" x2="22" y2="12" stroke-linecap="butt"/>'),
    dotline: svg(3, '<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="0.1 4.5"/>'),
    divider: svg(2, '<line x1="2" y1="12" x2="22" y2="12"/>'),
    dividerorn: svg(2, '<line x1="2" y1="12" x2="8" y2="12"/><polygon points="12 8.5 15.5 12 12 15.5 8.5 12" fill="currentColor" stroke="none"/><line x1="16" y1="12" x2="22" y2="12"/>')
  });
  Object.assign(pdfedShapeLabels, {
    dashline: 'Dashed Line', dotline: 'Dotted Line', divider: 'Divider', dividerorn: 'Fancy Divider'
  });
})();

// Dash length and gap scale with the stroke size so every thickness looks right.
// A dot is a zero-length dash with a round cap. Dividers ignore the slope of the drag and sit flat
// at the middle height of their box.
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
  } else {
    ctx.lineCap = 'round';
    const lo = Math.min(x1, x2) + lw / 2, hi = Math.max(x1, x2) - lw / 2, y = (y1 + y2) / 2;
    if (tool === 'divider') {
      if (hi > lo) { ctx.beginPath(); ctx.moveTo(lo, y); ctx.lineTo(hi, y); ctx.stroke(); }
    } else {
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
    }
  }
  ctx.restore();
}

// Start and end point of a placed shape inside its own box (w by h). Lines and arrows keep pointing
// the way they were drawn (flipX / flipY). A line drawn straight across (flatY) or straight down
// (flatX) is drawn dead flat through the middle of its box, so it is a true horizontal or vertical
// line and not a slightly tilted one. Used by the on-screen canvas AND by export, so both match.
function pdfedShapeEndpoints(item, w, h) {
  const dir = PDFED_DIRECTIONAL_SHAPES.indexOf(item.tool) !== -1;
  if (w == null) w = item.w;
  if (h == null) h = item.h;
  let x1 = dir && item.flipX ? w : 0, y1 = dir && item.flipY ? h : 0;
  let x2 = dir && item.flipX ? 0 : w, y2 = dir && item.flipY ? 0 : h;
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
  if (!isLine && !isDivider) return null;
  const MIN = 12;
  const rawW = Math.abs(x2 - x1), rawH = Math.abs(y2 - y1);
  const ym = (y1 + y2) / 2, xm = (x1 + x2) / 2;
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
    if (tool === 'dividerorn') r.h = Math.max(PDFED_LINE_HIT_MIN, Math.ceil(Math.max(Math.max(1.5, size) * 2.5, 7) * 2) + 4);
    else if (tool === 'divider') r.h = Math.max(PDFED_LINE_HIT_MIN, size + 6);
    else r.h = flatThickness;
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
  if (PDFED_DIRECTIONAL_SHAPES.indexOf(item.tool) === -1) return null;
  if (item.flatY) return ['w', 'e'];
  if (item.flatX) return ['n', 's'];
  // Slanted line: its two ends are two opposite corners of the box.
  const start = (item.flipY ? 's' : 'n') + (item.flipX ? 'e' : 'w');
  const end = (item.flipY ? 'n' : 's') + (item.flipX ? 'w' : 'e');
  return [start, end];
}
