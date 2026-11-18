// ─── PDF Editor: Canvas "Styles" (10 premium backgrounds + 10 photo frames) ───
// REAL CANVAS VERSION (2026-11-18, second pass).
// A style is no longer a flat picture with a form in the right panel. Click a style in the right panel (Studio, Canvas tab) or DRAG it
// onto the page, and it lands on the page as real objects:
//   Backgrounds  the page background (same bake as Canvas Color, so Remove Tint / All Pages still work).
//   Photo Frames the frame's background PLUS real, movable, resizable photo boxes (each one a placed image with a
//                metal border, flagged _pcs), plus a real Title and Caption (placed texts, flagged _pcsText).
// There is NO upload button and NO text box in the right panel any more. On the page: click a photo box to add your
// own picture (or drop a file on it), double click the title or caption to type. Everything is saved with the document.
// Picking another frame keeps your photos and your own words and moves them into the new frame.
// Nothing here edits js/19, js/28 or js/80. Two small wrappers (pdfedStudioBuild, pdfedRenderPlacedImages) add the
// panel section and the upload buttons on the photo boxes.
(function () {
  var STY = { tab: 'bg', cur: null, busy: false, rt: 0 }, MIME = 'application/x-pcs-style';
  var GOLD = ['#f1dfae', '#b8893c', '#f7e8bd', '#8a6428'], SIL = ['#f4f6f8', '#9aa3ad', '#e9edf1', '#6c7580'],
      ROSE = ['#f6d5c5', '#c98a6b', '#f9e1d4', '#a86a4d'], COP = ['#f5c28a', '#c2703a', '#f3b57c', '#7a3e19'],
      AUR = ['#22d3a0', '#7c3aed', '#7c3aed', '#06b6d4'], BLD = ['#ff9a8b', '#c084fc', '#c084fc', '#fbbf77'],
      OCN = ['#2de2e6', '#3a7bd5', '#3a7bd5', '#8be9fd'];

  // Backgrounds. blobs: [cx, cy, rx, ry, colour, opacity] on a 300x400 grid. mesh: [x%, y%, colour, stop%, alpha].
  var BG = [
    { n: 'Aurora Blobs', base: '#0b1020', bl: 28, blobs: [[80, 90, 110, 70, '#22d3a0', .75], [240, 200, 100, 90, '#7c3aed', .8], [90, 330, 120, 70, '#06b6d4', .7]] },
    { n: 'Mesh Ocean', base: '#0a1f44', mesh: [[15, 20, '#2de2e6', 50, 1], [90, 30, '#3a7bd5', 55, 1], [50, 100, '#0b3d91', 65, 1]] },
    { n: 'Sunset Blend', base: '#ffd9a8', mesh: [[20, 15, '#ffb36b', 55, 1], [85, 40, '#ff5e7e', 55, 1], [30, 95, '#6a4cff', 60, 1]] },
    { n: 'Obsidian Gold', base: '#0c0a08', bl: 40, blobs: [[250, 70, 110, 80, '#c9a24b', .55], [40, 330, 130, 90, '#b4742f', .5], [170, 200, 60, 120, '#6b4a1a', .35, 20]] },
    { n: 'Violet Nebula', base: '#0d0620', bl: 36, blobs: [[90, 110, 110, 80, '#d946ef', .65], [230, 250, 120, 100, '#6366f1', .75], [70, 350, 90, 60, '#9333ea', .6]] },
    { n: 'Champagne', base: '#fbf3e4', bl: 40, blobs: [[230, 100, 110, 80, '#f5d9a0', .9], [60, 250, 110, 100, '#e8b98a', .55], [200, 360, 120, 50, '#ffffff', .9]] },
    { n: 'Emerald Velvet', base: '#031a14', bl: 38, blobs: [[200, 90, 120, 90, '#10b981', .6], [60, 260, 100, 110, '#065f46', .9], [220, 360, 80, 50, '#a7f3d0', .35]] },
    { n: 'Lavender Mist', base: '#f3edff', bl: 38, blobs: [[220, 90, 110, 80, '#c4b5fd', .9], [60, 230, 110, 100, '#f0abfc', .6], [210, 350, 120, 60, '#a5b4fc', .8]] },
    { n: 'Midnight Rose', base: '#14070f', bl: 36, blobs: [[70, 100, 100, 80, '#fb7185', .6], [240, 230, 110, 100, '#9d174d', .85], [110, 360, 120, 60, '#7c3aed', .55]] },
    { n: 'Peach Silk', base: '#fff1e8', bl: 36, blobs: [[70, 90, 110, 80, '#ffb08a', .8], [240, 210, 110, 90, '#ff8fa3', .65], [110, 350, 130, 60, '#ffd9a8', .9]] }
  ];

  // Photo frames. b: photo boxes [l, t, w, h, slot] in % of the page. t: text box [l, t, w, h, title, caption, titleColour, captionColour, align].
  var FR = [
    { n: 'Ivory Duo', base: '#f3efe6', ring: [1.2, GOLD], deco: [{ r: [2.5, 2.5, 95, 95], s: '#b8893c66' }], b: [[14, 6, 72, 34, 'a'], [14, 43, 72, 32, 'b']], t: [14, 78, 72, 14, 'The Wedding Day', 'Add a date or a short line', '#3a2f1c', '#8a6428', 'center'] },
    { n: 'Midnight Trio', base: '#0b1020', bl: 30, blobs: [[80, 90, 110, 70, '#22d3a0', .6], [240, 230, 100, 90, '#7c3aed', .7], [90, 370, 120, 60, '#06b6d4', .6]], ring: [.9, AUR], b: [[10, 20, 80, 39, 'a'], [10, 62, 38.5, 30, 'b'], [51.5, 62, 38.5, 30, 'c']], t: [10, 5, 80, 12, 'Night Sessions', 'Write your caption here', '#ffffff', '#9fb4d8', 'center'] },
    { n: 'Champagne Pair', base: '#f7efe0', ring: [1, ROSE], deco: [{ l: [8, 8, 92, 8], s: '#a86a4d88' }, { l: [8, 94, 92, 94], s: '#a86a4d88' }], b: [[9, 12, 40, 56, 'a'], [51, 12, 40, 56, 'b']], t: [9, 73, 82, 17, 'Two of Us', 'Add names, a place or a date', '#4b2e22', '#a86a4d', 'center'] },
    { n: 'Noir Layers', base: '#111111', ring: [.8, GOLD], b: [[8, 6, 50, 30, 'a'], [42, 28, 50, 30, 'b'], [8, 62, 40, 26, 'c']], t: [52, 63, 40, 26, 'Our Story', 'A few words here', '#ffffff', '#c9a24b', 'left'] },
    { n: 'Navy Mosaic', base: '#0f1a33', ring: [.8, GOLD], deco: [{ r: [3, 3, 94, 94], s: '#b8893c55' }], b: [[8, 8, 42, 66, 'a'], [52, 8, 40, 31, 'b'], [52, 43, 40, 31, 'c']], t: [8, 78, 84, 14, 'Summer Edit', 'Place, date or a caption', '#f1e3bd', '#b8893c', 'left'] },
    { n: 'Emerald Diagonal', lin: [160, '#052e25', '#0b5a47'], ring: [1, GOLD], b: [[10, 6, 56, 32, 'a'], [34, 42, 56, 32, 'b']], t: [10, 78, 80, 14, 'Weekend Away', 'Write a short note here', '#eafff5', '#e1c37a', 'left'] },
    { n: 'Pearl Triptych', lin: [180, '#f1f3f6', '#dfe3e9'], ring: [1, SIL], b: [[8, 10, 26, 58, 'a'], [37, 10, 26, 58, 'b'], [66, 10, 26, 58, 'c']], t: [8, 73, 84, 18, 'Three Moments', 'Add your caption here', '#1d2430', '#6c7580', 'center'] },
    { n: 'Rose Blend', base: '#fff4ef', mesh: [[20, 10, '#ffd6c9', 55, 1], [90, 90, '#e8c6ff', 55, 1]], ring: [1.6, BLD], b: [[10, 6, 80, 32, 'a'], [10, 43, 80, 32, 'b']], t: [10, 79, 80, 14, 'Soft Days', 'A line to remember', '#4a2a45', '#9a5a7a', 'center'] },
    { n: 'Cobalt Feature', base: '#0a1f44', mesh: [[15, 20, '#2de2e6', 50, .27], [90, 90, '#3a7bd5', 55, .4]], ring: [.9, OCN], b: [[8, 6, 84, 44, 'a'], [8, 53, 40, 24, 'b'], [52, 53, 40, 24, 'c']], t: [8, 80, 84, 13, 'The Launch', 'Add details or a caption', '#ffffff', '#8be9fd', 'left'] },
    { n: 'Copper Overlap', base: '#1a0a05', bl: 40, blobs: [[250, 60, 110, 80, '#ea580c', .45], [40, 360, 130, 80, '#b45309', .4]], ring: [1.1, COP], b: [[8, 6, 74, 46, 'a'], [44, 42, 48, 32, 'b']], t: [8, 78, 84, 14, 'Golden Hour', 'Write your caption here', '#fbe7d0', '#c2703a', 'left'] }
  ];
  var SKY = { a: ['#8ec5ff', '#ffd9b0', '#2d4a5e', .28], b: ['#3b2a6b', '#e88fb0', '#1b2a4a', .3], c: ['#bfe3f5', '#f7efd2', '#2f6b4f', .35] };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n2(v) { return Math.round(v * 100) / 100; }

  // Background layers (base, gradient, blobs, sheen, vignette, grain) as SVG parts.
  function bgParts(b, w, h, u) {
    var sx = w / 300, sy = h / 400, d = '', o = '', i;
    if (b.lin) {
      var a = b.lin[0] * Math.PI / 180, L = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2, cx = w / 2, cy = h / 2, dx = Math.sin(a) * L, dy = -Math.cos(a) * L;
      d += '<linearGradient id="' + u + 'l" gradientUnits="userSpaceOnUse" x1="' + n2(cx - dx) + '" y1="' + n2(cy - dy) + '" x2="' + n2(cx + dx) + '" y2="' + n2(cy + dy) + '"><stop offset="0" stop-color="' + b.lin[1] + '"/><stop offset="1" stop-color="' + b.lin[2] + '"/></linearGradient>';
      o += '<rect width="' + w + '" height="' + h + '" fill="url(#' + u + 'l)"/>';
    } else o += '<rect width="' + w + '" height="' + h + '" fill="' + b.base + '"/>';
    (b.mesh || []).forEach(function (m, k) {
      var px = m[0] / 100 * w, py = m[1] / 100 * h, far = Math.max(Math.hypot(px, py), Math.hypot(w - px, py), Math.hypot(px, h - py), Math.hypot(w - px, h - py));
      d += '<radialGradient id="' + u + 'm' + k + '" gradientUnits="userSpaceOnUse" cx="' + n2(px) + '" cy="' + n2(py) + '" r="' + n2(m[3] / 100 * far) + '"><stop offset="0" stop-color="' + m[2] + '" stop-opacity="' + m[4] + '"/><stop offset="1" stop-color="' + m[2] + '" stop-opacity="0"/></radialGradient>';
      o += '<rect width="' + w + '" height="' + h + '" fill="url(#' + u + 'm' + k + ')"/>';
    });
    if (b.blobs) {
      d += '<filter id="' + u + 'b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + n2((b.bl || 34) * sx) + '"/></filter>';
      o += '<g filter="url(#' + u + 'b)">' + b.blobs.map(function (e) {
        return '<ellipse cx="' + n2(e[0] * sx) + '" cy="' + n2(e[1] * sy) + '" rx="' + n2(e[2] * sx) + '" ry="' + n2(e[3] * sy) + '" fill="' + e[4] + '" opacity="' + e[5] + '"' + (e[6] ? ' transform="rotate(' + e[6] + ' ' + n2(e[0] * sx) + ' ' + n2(e[1] * sy) + ')"' : '') + '/>';
      }).join('') + '</g>';
    }
    d += '<linearGradient id="' + u + 's" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + w + '" y2="' + h + '"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>' +
      '<radialGradient id="' + u + 'v" gradientUnits="userSpaceOnUse" cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + n2(Math.hypot(w, h) / 2) + '"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>' +
      '<filter id="' + u + 'g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="' + n2(270 / w * 100) / 100 + '" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .5 -.12"/></filter>';
    return { d: d, o: o, fin: '<rect width="' + w + '" height="' + h + '" fill="url(#' + u + 's)"/><rect width="' + w + '" height="' + h + '" fill="url(#' + u + 'v)"/><rect width="' + w + '" height="' + h + '" filter="url(#' + u + 'g)" opacity=".35"/>' };
  }

  function wrap(w, h, d, body) { return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><defs>' + d + '</defs>' + body + '</svg>'; }

  function bgSvg(i, w, h) { var p = bgParts(BG[i], w, h, 'b'); return wrap(w, h, p.d, p.o + p.fin); }

  function frSvg(i, w, h, photos, texts, thumb) {
    var f = FR[i], u = 'f', p = bgParts(f, w, h, u), d = p.d, o = p.o, k = w / 300;
    (f.deco || []).forEach(function (e) {
      if (e.r) o += '<rect x="' + n2(e.r[0] * w / 100) + '" y="' + n2(e.r[1] * h / 100) + '" width="' + n2(e.r[2] * w / 100) + '" height="' + n2(e.r[3] * h / 100) + '" fill="none" stroke="' + e.s + '" stroke-width="' + n2(k) + '"/>';
      else o += '<line x1="' + n2(e.l[0] * w / 100) + '" y1="' + n2(e.l[1] * h / 100) + '" x2="' + n2(e.l[2] * w / 100) + '" y2="' + n2(e.l[3] * h / 100) + '" stroke="' + e.s + '" stroke-width="' + n2(k) + '"/>';
    });
    d += '<filter id="fsh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="' + n2(13 * k) + '"/></filter>';
    f.b.forEach(function (q, j) {
      var x = q[0] * w / 100, y = q[1] * h / 100, W = q[2] * w / 100, H = q[3] * h / 100, pad = f.ring[0] * w / 100, c = f.ring[1], id = 'r' + j;
      d += '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + n2(x - pad) + '" y1="' + n2(y - pad) + '" x2="' + n2(x + W + pad) + '" y2="' + n2(y + H + pad) + '"><stop offset="0" stop-color="' + c[0] + '"/><stop offset=".35" stop-color="' + c[1] + '"/><stop offset=".55" stop-color="' + c[2] + '"/><stop offset="1" stop-color="' + c[3] + '"/></linearGradient><clipPath id="c' + j + '"><rect x="' + n2(x) + '" y="' + n2(y) + '" width="' + n2(W) + '" height="' + n2(H) + '" rx="' + n2(k) + '"/></clipPath>';
      o += '<rect x="' + n2(x - pad) + '" y="' + n2(y - pad + 12 * k) + '" width="' + n2(W + 2 * pad) + '" height="' + n2(H + 2 * pad) + '" fill="#000" opacity=".45" filter="url(#fsh)"/>' +
        '<rect x="' + n2(x - pad) + '" y="' + n2(y - pad) + '" width="' + n2(W + 2 * pad) + '" height="' + n2(H + 2 * pad) + '" rx="' + n2(2 * k) + '" fill="url(#' + id + ')"/>';
      var ph = photos && photos[i + '|' + q[4] + j];
      if (ph) o += '<image clip-path="url(#c' + j + ')" x="' + n2(x) + '" y="' + n2(y) + '" width="' + n2(W) + '" height="' + n2(H) + '" preserveAspectRatio="xMidYMid slice" href="' + ph + '" xlink:href="' + ph + '"/>';
      else {
        var s = SKY[q[4]];
        d += '<linearGradient id="k' + j + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s[0] + '"/><stop offset="1" stop-color="' + s[1] + '"/></linearGradient>';
        o += '<g clip-path="url(#c' + j + ')"><rect x="' + n2(x) + '" y="' + n2(y) + '" width="' + n2(W) + '" height="' + n2(H) + '" fill="url(#k' + j + ')"/><circle cx="' + n2(x + W * .72) + '" cy="' + n2(y + H * .3) + '" r="' + n2(Math.min(W, H) * .08) + '" fill="#fff7c2"/><rect x="' + n2(x) + '" y="' + n2(y + H * (1 - s[3])) + '" width="' + n2(W) + '" height="' + n2(H * s[3]) + '" fill="' + s[2] + '"/></g>';
      }
    });
    var t = f.t, tx = texts && texts[i] || { t: t[4], c: t[5] }, bx = t[0] * w / 100, by = t[1] * h / 100, bw = t[2] * w / 100, bh = t[3] * h / 100;
    var ts = 6.4 * w / 100, cs = 2.9 * w / 100, gap = 1.2 * w / 100, tt = String(tx.t).trim(), cc = String(tx.c).trim().toUpperCase();
    if (tt.length * ts * .52 > bw) ts = bw / (tt.length * .52);
    if (cc.length * cs * .74 > bw) cs = bw / (cc.length * .74);
    var tot = ts * 1.1 + gap + cs * 1.4, y0 = by + (bh - tot) / 2, ax = t[8] === 'center' ? bx + bw / 2 : t[8] === 'right' ? bx + bw : bx, an = t[8] === 'center' ? 'middle' : t[8] === 'right' ? 'end' : 'start';
    if (tt) o += '<text x="' + n2(ax) + '" y="' + n2(y0 + ts * .95) + '" text-anchor="' + an + '" font-family="Georgia,\'Times New Roman\',serif" font-weight="600" font-size="' + n2(ts) + '" fill="' + t[6] + '">' + esc(tt) + '</text>';
    if (cc) o += '<text x="' + n2(ax) + '" y="' + n2(y0 + ts * 1.1 + gap + cs * 1.05) + '" text-anchor="' + an + '" font-family="system-ui,Arial,sans-serif" font-weight="500" letter-spacing="' + n2(cs * .14) + '" font-size="' + n2(cs) + '" fill="' + t[7] + '">' + esc(cc) + '</text>';
    return wrap(w, h, d, o + p.fin);
  }

  // ─── Small helpers ───
  function lum(hex) { var x = String(hex || '#000000').replace('#', ''); return (parseInt(x.slice(0, 2), 16) * 299 + parseInt(x.slice(2, 4), 16) * 587 + parseInt(x.slice(4, 6), 16) * 114) / 1000; }
  function say(m, kind) { try { if (typeof toast === 'function') toast(m, kind || 'info'); } catch (e) {} }
  function docOpen() { try { return typeof pdfed !== 'undefined' && !!(pdfed && pdfed.pages && pdfed.pages.length); } catch (e) { return false; } }

  // The page background of a Photo Frame: base, glow, fine lines. No photo boxes and no words (those are real objects).
  function frBgSvg(i, w, h) {
    var f = FR[i], p = bgParts(f, w, h, 'f'), d = p.d, o = p.o, k = w / 300;
    (f.deco || []).forEach(function (e) {
      if (e.r) o += '<rect x="' + n2(e.r[0] * w / 100) + '" y="' + n2(e.r[1] * h / 100) + '" width="' + n2(e.r[2] * w / 100) + '" height="' + n2(e.r[3] * h / 100) + '" fill="none" stroke="' + e.s + '" stroke-width="' + n2(k) + '"/>';
      else o += '<line x1="' + n2(e.l[0] * w / 100) + '" y1="' + n2(e.l[1] * h / 100) + '" x2="' + n2(e.l[2] * w / 100) + '" y2="' + n2(e.l[3] * h / 100) + '" stroke="' + e.s + '" stroke-width="' + n2(k) + '"/>';
    });
    return wrap(w, h, d, o + p.fin);
  }

  // ─── Photo boxes: one placed image each (metal border + soft shadow + the photo inside) ───
  // k = page width / 300. The border thickness and the shadow room are fixed multiples of k, so a box that is resized
  // is redrawn with the SAME border thickness (see refit below).
  function slotGeom(fi, j, W, H) {
    var f = FR[fi], q = f.b[j], k = W / 300, pad = f.ring[0] * W / 100, m = 9 * k;
    return { k: k, pad: pad, m: m,
      x: Math.round(q[0] * W / 100 - pad - m), y: Math.round(q[1] * H / 100 - pad - m),
      w: Math.round(q[2] * W / 100 + 2 * pad + 2 * m), h: Math.round(q[3] * H / 100 + 2 * pad + 2 * m) };
  }
  // The distance from the edge of a box to its photo window, in page pixels.
  function slotInset(fi, k) { return 9 * k + FR[fi].ring[0] * 3 * k; }

  function slotSvg(fi, j, iw, ih, k, photo) {
    var f = FR[fi], c = f.ring[1], m = 9 * k, wx = slotInset(fi, k), ww = Math.max(2, iw - 2 * wx), wh = Math.max(2, ih - 2 * wx);
    var dark = lum(f.base || (f.lin && f.lin[1]) || '#000000') < 128;
    var d = '<filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="' + n2(2 * k) + '"/></filter>' +
      '<linearGradient id="rg" gradientUnits="userSpaceOnUse" x1="' + n2(m) + '" y1="' + n2(m) + '" x2="' + n2(iw - m) + '" y2="' + n2(ih - m) + '">' +
      '<stop offset="0" stop-color="' + c[0] + '"/><stop offset=".35" stop-color="' + c[1] + '"/><stop offset=".55" stop-color="' + c[2] + '"/><stop offset="1" stop-color="' + c[3] + '"/></linearGradient>' +
      '<clipPath id="cp"><rect x="' + n2(wx) + '" y="' + n2(wx) + '" width="' + n2(ww) + '" height="' + n2(wh) + '" rx="' + n2(k) + '"/></clipPath>';
    var o = '<rect x="' + n2(m) + '" y="' + n2(m + 1.8 * k) + '" width="' + n2(iw - 2 * m) + '" height="' + n2(ih - 2 * m) + '" fill="#000" opacity=".45" filter="url(#sh)"/>' +
      '<rect x="' + n2(m) + '" y="' + n2(m) + '" width="' + n2(iw - 2 * m) + '" height="' + n2(ih - 2 * m) + '" rx="' + n2(2 * k) + '" fill="url(#rg)"/>';
    if (photo) {
      o += '<image clip-path="url(#cp)" x="' + n2(wx) + '" y="' + n2(wx) + '" width="' + n2(ww) + '" height="' + n2(wh) + '" preserveAspectRatio="xMidYMid slice" href="' + photo + '" xlink:href="' + photo + '"/>';
    } else {
      // quiet "picture goes here" window (a sun and two hills). Only seen until a photo is added.
      var a = dark ? ['#25304f', '#141b33'] : ['#ece6d8', '#dcd3bf'];
      d += '<linearGradient id="ph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a[0] + '"/><stop offset="1" stop-color="' + a[1] + '"/></linearGradient>';
      var P = function (px, py) { return n2(wx + ww * px) + ',' + n2(wx + wh * py); };
      o += '<g clip-path="url(#cp)"><rect x="' + n2(wx) + '" y="' + n2(wx) + '" width="' + n2(ww) + '" height="' + n2(wh) + '" fill="url(#ph)"/>' +
        '<circle cx="' + n2(wx + ww * .72) + '" cy="' + n2(wx + wh * .3) + '" r="' + n2(Math.min(ww, wh) * .07) + '" fill="' + c[0] + '" opacity=".4"/>' +
        '<polygon points="' + [P(0, .78), P(.3, .55), P(.52, .72), P(.75, .48), P(1, .75), P(1, 1), P(0, 1)].join(' ') + '" fill="' + c[1] + '" opacity=".3"/></g>';
    }
    return wrap(iw, ih, d, o);
  }
  function slotPng(fi, j, iw, ih, k, photo) {
    var sc = Math.min(1, 2400 / Math.max(iw, ih, 1));
    return rasterize(slotSvg(fi, j, iw, ih, k, photo), Math.max(2, Math.round(iw * sc)), Math.max(2, Math.round(ih * sc)));
  }

  // Where the Title and Caption go, and how big (same look as the preview thumbnails).
  function textPlan(fi, W, H, title, cap) {
    var f = FR[fi], t = f.t, bx = t[0] * W / 100, by = t[1] * H / 100, bw = t[2] * W / 100, bh = t[3] * H / 100;
    var ts = 6.4 * W / 100, cs = 2.9 * W / 100, gap = 1.2 * W / 100, tt = String(title).trim(), cc = String(cap).trim();
    if (tt.length * ts * .52 > bw) ts = bw / (tt.length * .52);
    if (cc.length * cs * .74 > bw) cs = bw / (cc.length * .74);
    var tot = ts * 1.1 + gap + cs * 1.4, y0 = by + (bh - tot) / 2;
    return { x: bx, w: bw, align: t[8], ty: y0, ts: ts, cy: y0 + ts * 1.1 + gap, cs: cs, tc: t[6], cc: t[7] };
  }

  // ─── Rasterize / read pictures ───
  function pageSize() {
    var c = document.getElementById('pdfedPageCanvas'), ok = c && c.width > 200 && c.height > 200, w = ok ? c.width : 1654, h = ok ? c.height : 2339, k = Math.min(1, 2400 / Math.max(w, h));
    return [Math.round(w * k), Math.round(h * k)];
  }
  function dataUri(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
  function rasterize(svg, w, h) {
    return new Promise(function (res, rej) {
      var im = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      im.onload = function () { var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); URL.revokeObjectURL(url); try { res(c.toDataURL('image/png')); } catch (e) { rej(e); } };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('render')); };
      im.src = url;
    });
  }
  function loadPhoto(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .9));
        };
        im.onerror = function () { rej(new Error('image')); };
        im.src = r.result;
      };
      r.onerror = function () { rej(new Error('read')); };
      r.readAsDataURL(file);
    });
  }

  // ─── Page snapshots (for undo / redo) ───
  function snap(pg) { return { dataUrl: pg.dataUrl, edits: Object.assign({}, pg.edits || {}), imgs: (pg.placedImages || []).slice(), txts: (pg.placedTexts || []).slice(), modified: pg.modified }; }
  function restore(pg, s) { pg.dataUrl = s.dataUrl; pg.edits = Object.assign({}, s.edits); pg.placedImages = s.imgs.slice(); pg.placedTexts = s.txts.slice(); pg.modified = true; }

  // A new empty A4 page, when the editor has nothing open yet. Same chrome the editor uses when it reopens a page.
  async function makeDoc() {
    var url = await pdfedRenderBlankPage('', '#ffffff', 210, 297);
    var pg = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [], label: 'Styled page', bgColor: '#ffffff', pageMM: [210, 297] };
    await openDoc(pg);
    return pg;
  }
  async function openDoc(pg) {
    pdfedReopenAfterLastPageUndo('Untitled Document');
    pdfed.pages.push(pg);
    var tot = document.getElementById('prrTotalPages'); if (tot) tot.textContent = pdfed.pages.length;
    try { state.stats.pdfs++; state.stats.pages++; updateStats(); } catch (e) {}
    await pdfedBuildStrip(); await pdfedGoto(0);
    if (typeof pdfedScheduleAutoCollapse === 'function') pdfedScheduleAutoCollapse();
  }

  // Pulls the objects of an earlier Photo Frame off the page and remembers the photos and words the person added,
  // so switching frames never throws their work away.
  function takeOld(pg) {
    var keep = { photos: {}, title: null, cap: null, had: false };
    pg.placedImages = (pg.placedImages || []).filter(function (im) {
      if (!im._pcs) return true;
      keep.had = true; if (im._pcs.photo) keep.photos[im._pcs.j] = im._pcs.photo; return false;
    });
    pg.placedTexts = (pg.placedTexts || []).filter(function (t) {
      if (!t._pcsText) return true;
      keep.had = true;
      var d = FR[t._pcsFi] ? FR[t._pcsFi].t : null;
      if (t._pcsText === 'title') keep.title = d && t.text === d[4] ? null : t.text;
      else keep.cap = d && t.text === String(d[5]).toUpperCase() ? null : t.text;
      return false;
    });
    return keep;
  }

  function mkText(pg, fi, role, text, x, y, w, size, family, color, align, ls) {
    var t = { id: 'ptxt_' + (++pdfedPlacedTextSeq), text: text, x: Math.round(x), y: Math.round(y), w: Math.round(w), fontSize: n2(size), fontFamily: family, color: color,
      bold: false, italic: false, underline: false, align: align, locked: false, zIndex: pdfedNextZ(pg), _pcsText: role, _pcsFi: fi };
    if (ls) t.letterSpacing = ls;
    pg.placedTexts.push(t);
    return t;
  }

  // Puts a Photo Frame's real objects on the page (photo boxes first, then Title and Caption on top).
  async function addFrameObjects(pg, fi, W, H, keep) {
    var f = FR[fi], j, g, ph, url, im;
    if (!pg.placedImages) pg.placedImages = [];
    if (!pg.placedTexts) pg.placedTexts = [];
    for (j = 0; j < f.b.length; j++) {
      g = slotGeom(fi, j, W, H); ph = keep && keep.photos[j] || null;
      url = await slotPng(fi, j, g.w, g.h, g.k, ph);
      pdfedAnnotState.placedImgSeq++;
      im = { id: 'pimg_' + pdfedAnnotState.placedImgSeq, dataUrl: url, x: g.x, y: g.y, w: g.w, h: g.h, locked: false, zIndex: pdfedNextZ(pg), kind: 'image',
        _pcs: { fi: fi, j: j, k: g.k, photo: ph, rw: g.w, rh: g.h } };
      pg.placedImages.push(im);
    }
    var title = keep && keep.title != null ? keep.title : f.t[4], cap = keep && keep.cap != null ? keep.cap : String(f.t[5]).toUpperCase();
    var tp = textPlan(fi, W, H, title, cap);
    mkText(pg, fi, 'title', title, tp.x, tp.ty, tp.w, tp.ts, 'Georgia', tp.tc, tp.align, 0);
    mkText(pg, fi, 'cap', cap, tp.x, tp.cy, tp.w, tp.cs, 'Inter', tp.cc, tp.align, .14);
  }

  // ─── Add a style to the page (or to a brand new page when the editor is empty) ───
  async function applyStyle(kind, i) {
    if (STY.busy) return;
    var list = kind === 'bg' ? BG : FR;
    if (!list[i] || typeof pdfedBakeCanvasTintOntoPage !== 'function') return;
    STY.busy = true; document.body.style.cursor = 'progress';
    try {
      if (typeof wsbEnsureEditorOpen === 'function') wsbEnsureEditorOpen();
      var made = false, pg;
      if (!docOpen()) { pg = await makeDoc(); made = true; } else pg = pdfed.pages[pdfed.active];
      var idx = pdfed.pages.indexOf(pg), before = made ? null : snap(pg);
      if (pdfed.active !== idx) await pdfedGoto(idx);
      var cv = document.getElementById('pdfedPageCanvas'), W = cv.width, H = cv.height, z = pageSize();
      var url = await rasterize(kind === 'bg' ? bgSvg(i, z[0], z[1]) : frBgSvg(i, z[0], z[1]), z[0], z[1]);
      await pdfedBakeCanvasTintOntoPage(pg, { mode: 'image', imageDataUrl: url, imageFit: 'stretch', opacity: 100, color1: '#FFFFFF', color2: '#FFFFFF', angle: 90 });
      if (kind === 'fr') { var keep = takeOld(pg); await addFrameObjects(pg, i, W, H, keep); }
      await pdfedGoto(idx); await pdfedBuildStrip();
      pdfedMarkModified(idx);
      // keep the Canvas Color panel in step (its All Pages button then paints the same background), and hide its live preview
      try { var s = pdfedCanvasTintState; s.mode = 'image'; s.imageFit = 'stretch'; s.imageDataUrl = url; s.opacity = 100; pdfedCanvasSyncControls(); var live = pdfedCanvasTintPreviewEl(); if (live) live.style.display = 'none'; } catch (e) {}
      STY.cur = { k: kind, i: i }; renderAll();
      say(kind === 'bg' ? list[i].n + ' added to the page' : list[i].n + ' added. Click a photo box to add your picture, double click the title to type.', 'success');
      var after = snap(pg);
      pushAppHistory({
        label: 'Add style: ' + list[i].n,
        undo: async function () {
          if (made) { pdfed.pages.splice(0); pdfedResetToNoDocument(); return; }
          var at = pdfed.pages.indexOf(pg); if (at < 0) return;
          restore(pg, before); await pdfedGoto(at); await pdfedBuildStrip(); pdfedMarkModified(at);
        },
        redo: async function () {
          if (made) { restore(pg, after); await openDoc(pg); return; }
          var at = pdfed.pages.indexOf(pg); if (at < 0) return;
          restore(pg, after); await pdfedGoto(at); await pdfedBuildStrip(); pdfedMarkModified(at);
        }
      });
    } catch (e) {
      console.warn('[canvas styles]', e);
      say('Could not add that style', 'error');
    } finally { STY.busy = false; document.body.style.cursor = ''; }
  }

  // ─── Photo boxes: upload right on the page ───
  function locate(item) {
    for (var p = 0; p < pdfed.pages.length; p++) if ((pdfed.pages[p].placedImages || []).indexOf(item) > -1) return p;
    return -1;
  }
  async function rerender(item) {
    var P = item._pcs, w = Math.max(8, Math.round(item.w)), h = Math.max(8, Math.round(item.h));
    item.dataUrl = await slotPng(P.fi, P.j, w, h, P.k, P.photo);
    P.rw = item.w; P.rh = item.h;
  }
  function refresh(pi) {
    pdfedMarkModified(pi);
    if (pdfed.active === pi && typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(pi);
  }
  async function changePhoto(item, photo, label) {
    var pi = locate(item); if (pi < 0) return;
    var prev = item._pcs.photo;
    item._pcs.photo = photo; await rerender(item); refresh(pi);
    pushAppHistory({
      label: label,
      undo: async function () { item._pcs.photo = prev; await rerender(item); var at = locate(item); if (at > -1) refresh(at); },
      redo: async function () { item._pcs.photo = photo; await rerender(item); var at = locate(item); if (at > -1) refresh(at); }
    });
  }
  async function takeFile(item, file) {
    if (!file) return;
    if (!(/^image\//.test(file.type || '') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || ''))) { say('Choose a picture file (PNG, JPG or WEBP)', 'error'); return; }
    if (file.size > 15 * 1048576) { say('That picture is over 15 MB. Choose a smaller one', 'error'); return; }
    var u; try { u = await loadPhoto(file); } catch (e) { say('Could not read that picture', 'error'); return; }
    await changePhoto(item, u, 'Add photo to frame');
    say('Picture placed in the frame', 'success');
  }
  var pickInput = null, pickItem = null;
  function pick(item) {
    if (!pickInput) {
      pickInput = document.createElement('input'); pickInput.type = 'file'; pickInput.accept = 'image/*'; pickInput.style.display = 'none';
      pickInput.addEventListener('change', function () { var f = pickInput.files && pickInput.files[0], t = pickItem; pickInput.value = ''; if (f && t) takeFile(t, f); });
      document.body.appendChild(pickInput);
    }
    pickItem = item; pickInput.click();
  }

  function mountOne(el, item) {
    var P = item._pcs, has = !!P.photo, k = P.k || 5, fs = Math.round(Math.min(40, Math.max(14, k * 3.2)));
    el.classList.add('wss', 'pcs-slot-el', has ? 'wss-has' : 'wss-empty');
    var ov = document.createElement('div'); ov.className = 'wss-ov'; ov.style.inset = n2(slotInset(P.fi, k)) + 'px';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wss-btn'; btn.style.fontSize = fs + 'px';
    var label = has ? 'Change picture' : 'Upload your image';
    btn.title = label; btn.setAttribute('aria-label', label + ' in this photo box');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="' + Math.round(fs * 1.25) + '" height="' + Math.round(fs * 1.25) + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
    var t = document.createElement('span'); t.className = 'wss-t'; t.textContent = label; btn.appendChild(t);
    if (!has) { var s2 = document.createElement('span'); s2.className = 'wss-s'; s2.style.fontSize = Math.round(fs * .8) + 'px'; s2.textContent = 'or drop a picture here'; btn.appendChild(s2); }
    function stop(b) { ['pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) { b.addEventListener(ev, function (e) { e.stopPropagation(); }); }); }
    stop(btn); btn.addEventListener('click', function (e) { e.stopPropagation(); pick(item); });
    ov.appendChild(btn);
    if (has) {
      var x = document.createElement('button'); x.type = 'button'; x.className = 'pcs-x'; x.title = 'Remove this picture'; x.setAttribute('aria-label', 'Remove this picture');
      x.style.width = x.style.height = Math.round(fs * 1.8) + 'px'; x.style.fontSize = Math.round(fs * 1.4) + 'px'; x.innerHTML = '&times;';
      stop(x); x.addEventListener('click', function (e) { e.stopPropagation(); changePhoto(item, null, 'Remove photo from frame'); });
      ov.appendChild(x);
    }
    el.appendChild(ov);
    el.addEventListener('dragover', function (e) { var dt = e.dataTransfer; if (dt && Array.prototype.indexOf.call(dt.types || [], 'Files') > -1) { e.preventDefault(); e.stopPropagation(); el.classList.add('wss-drop'); } });
    el.addEventListener('dragleave', function () { el.classList.remove('wss-drop'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('wss-drop');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      e.preventDefault(); e.stopPropagation(); takeFile(item, f);
    });
  }
  function mountSlots(idx) {
    var layer = document.getElementById('pdfedPlacedImagesLayer'), pg = pdfed.pages[idx]; if (!layer || !pg) return;
    (pg.placedImages || []).forEach(function (item) {
      if (!item._pcs) return;
      var el = layer.querySelector('.pdfed-placed-img[data-id="' + item.id + '"]'); if (el) mountOne(el, item);
    });
  }

  // Resize a photo box and its border must stay the same thickness: redraw it once the mouse is released.
  function refit() {
    if (!docOpen()) return;
    var at = pdfed.active, pg = pdfed.pages[at]; if (!pg) return;
    var todo = (pg.placedImages || []).filter(function (im) { return im._pcs && (Math.abs(im.w - im._pcs.rw) > 1 || Math.abs(im.h - im._pcs.rh) > 1); });
    if (!todo.length) return;
    Promise.all(todo.map(rerender)).then(function () { refresh(at); }).catch(function () {});
  }
  function afterRelease() { clearTimeout(STY.rt); STY.rt = setTimeout(refit, 80); }

  // ─── The panel (Studio, Canvas tab). The styles are shown ONLY here, never on the main canvas screen ───
  var THUMB = {};
  function thumbUri(kind, i) {
    var key = kind + i;
    if (!THUMB[key]) THUMB[key] = dataUri(kind === 'bg' ? bgSvg(i, 150, 200) : frSvg(i, 150, 200, null, null));
    return THUMB[key];
  }
  function fillThumbs(host, tab) {
    if (!host) return;
    var bg = tab === 'bg', list = bg ? BG : FR;
    host.className = 'pcs-grid' + (bg ? '' : ' fr');
    host.innerHTML = '';
    list.forEach(function (it, i) {
      var b = document.createElement('div'); b.setAttribute('role', 'button'); b.tabIndex = 0; b.draggable = true; b.title = it.n + ': click to add, or drag onto the page';
      b.className = 'pcs-th' + (STY.cur && STY.cur.k === tab && STY.cur.i === i ? ' on' : '');
      b.innerHTML = '<img alt="" draggable="false" src="' + thumbUri(tab, i) + '"><span>' + esc(it.n) + '</span>';
      b.onclick = function () { applyStyle(tab, i); };
      b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyStyle(tab, i); } };
      b.ondragstart = function (e) { e.dataTransfer.setData(MIME, JSON.stringify({ k: tab, i: i })); e.dataTransfer.setData('text/plain', ''); e.dataTransfer.effectAllowed = 'copy'; var a = areaEl(); if (a) a.classList.add('pcs-dragging'); };
      b.ondragend = function () { var a = areaEl(); if (a) a.classList.remove('pcs-dragging'); };
      host.appendChild(b);
    });
  }
  function renderAll() { fillThumbs(document.getElementById('pcsGrid'), STY.tab); }
  function setTab(t) {
    STY.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.pcs-seg button'), function (x) { x.classList.toggle('on', x.getAttribute('data-t') === t); });
    renderAll();
  }
  function segHtml() { return '<div class="pcs-seg"><button type="button" class="' + (STY.tab === 'bg' ? 'on' : '') + '" data-t="bg">Backgrounds</button><button type="button" class="' + (STY.tab === 'fr' ? 'on' : '') + '" data-t="fr">Photo Frames</button></div>'; }
  function wireSeg(root) { Array.prototype.forEach.call(root.querySelectorAll('.pcs-seg button'), function (b) { b.onclick = function () { setTab(b.getAttribute('data-t')); }; }); }

  function inject() {
    if (document.getElementById('pcs')) return;
    var looks = document.getElementById('pdsLooks'); if (!looks || !looks.parentNode) return;
    var sec = document.createElement('div'); sec.id = 'pcs'; sec.className = 'pcs';
    sec.innerHTML = '<div class="pds-looks-head"><label class="pdfed-ctint-label">Styles <i class="pcs-new">NEW</i></label></div>' + segHtml() +
      '<div class="pcs-grid" id="pcsGrid"></div>' +
      '<p class="pcs-hint">Click a style to add it to your page, or drag it onto the page. Photo Frames give you photo boxes on the page: click a box to add your picture, double click the title to type.</p>';
    looks.parentNode.parentNode.insertBefore(sec, looks.parentNode.nextSibling);
    wireSeg(sec); renderAll();
  }
  // Drag a style from the panel onto the page. With no page open, a new A4 page opens with it.
  function areaEl() { return document.querySelector('#sec-pdfeditor .pdfed-canvas-area'); }
  function wireDrop() {
    var area = areaEl(); if (!area || area._pcsDrop) return; area._pcsDrop = true;
    area.addEventListener('dragover', function (e) {
      var dt = e.dataTransfer; if (!dt) return;
      if (Array.prototype.indexOf.call(dt.types || [], MIME) > -1) { e.preventDefault(); e.stopPropagation(); dt.dropEffect = 'copy'; }
    }, true);
    area.addEventListener('drop', function (e) {
      var dt = e.dataTransfer; if (!dt) return;
      var raw = dt.getData ? dt.getData(MIME) : ''; if (!raw) return;
      e.preventDefault(); e.stopPropagation(); area.classList.remove('pcs-dragging', 'pdfed-drag-over', 'pdfed-drag-over-page');
      var d; try { d = JSON.parse(raw); } catch (x) { return; }
      if (d && (d.k === 'bg' || d.k === 'fr')) applyStyle(d.k, +d.i);
    }, true);
  }

  // Wrappers: the panel section appears once the Studio exists; every re-draw of the placed images gets its upload buttons.
  if (typeof pdfedStudioBuild === 'function') {
    var origBuild = pdfedStudioBuild;
    pdfedStudioBuild = function () { var r = origBuild.apply(this, arguments); if (r) inject(); return r; };
  }
  if (typeof pdfedRenderPlacedImages === 'function') {
    var origRender = pdfedRenderPlacedImages;
    pdfedRenderPlacedImages = function (idx) {
      var r = origRender.apply(this, arguments);
      try { mountSlots(idx); } catch (e) { console.warn('[canvas styles] upload buttons', e); }
      return r;
    };
  }
  if (document.addEventListener) {
    ['mouseup', 'touchend', 'pointerup'].forEach(function (ev) { document.addEventListener(ev, afterRelease); });
    try { wireDrop(); } catch (e) { console.warn('[canvas styles] drop', e); }
  }
  window.pdfedCanvasStyles = { bg: BG, frames: FR, bgSvg: bgSvg, frSvg: frSvg, frBgSvg: frBgSvg, slotGeom: slotGeom, slotSvg: slotSvg, slotInset: slotInset, textPlan: textPlan, apply: applyStyle };
})();
