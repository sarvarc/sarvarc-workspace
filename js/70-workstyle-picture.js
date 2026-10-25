// ─── WORKSTYLE: READ BOXES, LINES AND PICTURE SPOTS FROM A PICTURE ──────────
// A picture reference (png, jpg, webp: a screenshot, or an image made by any AI tool) has no drawing instructions,
// so js/60 could only read its WORDS (OCR). This file reads the rest from the pixels and hands it back in the same
// shape a real PDF gives (boxes, rules, picture spots), so the build, spacing, export and docked preview work
// without any change.
//
// It is only called for picture files (js/60 passes the pixels as pdfPage._wsPic). A PDF, Word, Excel or
// PowerPoint reference never comes through here, so nothing about them changes.
//
// What it finds
//   - Boxes, cards, bands, buttons: flat areas, with their colour, rounded corners, pills and circles.
//   - Fades: two-colour fades left to right, top to bottom, corner to corner.
//   - Outlines: a box drawn only as a border (colour and thickness).
//   - Rules: thin straight horizontal or vertical lines.
//   - Picture spots: busy, photo-like areas, as a plain box (the pictures themselves are never copied).
//
//   - Fades with 3 or 5 colours (stops are sampled along the fade).
//   - Straight slanted lines (as a thin diagonal band).
//   - Free-form art and curves: kept as a picture spot (an upload box), because they cannot be rebuilt as simple shapes.
//
// Honest limits
//   - Shadows, glows and textures are not copied (the editor has no such shape); they are left out so they do not become wrong boxes.
//   - Letters are skipped using the OCR boxes AND by spotting a row of letter-sized pieces; a lone big stylised word can still leave a stray box.
//   - A box that is almost, but not exactly, the colour of the page is kept only when it is clean (square or rounded, solid).
//   - A photo with big smooth areas (a blurred sky) may be read as a fade box instead of a picture spot.
//
// Units: wstylePicAnalyze works in the pixels it is given. wstylePicRead scales to PDF points like js/60.

const WSTYLE_PIC_LINK = 9;            // two neighbouring pixels belong together when no channel differs by more than this

function wstylePicHex(r, g, b) {
  const h = function (n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); };
  return '#' + h(r) + h(g) + h(b);
}

// data: RGBA bytes, w x h. textRects: [{x,y,w,h}] in the same pixels (words found by OCR).
// Returns { shapes, slots, bg } in pixels. Never throws on odd input, returns empty lists instead.
function wstylePicAnalyze(data, w, h, textRects) {
  const out = { shapes: [], slots: [], bg: '#ffffff' };
  const n = w * h;
  if (!data || !(w > 8) || !(h > 8) || data.length < n * 4) return out;
  textRects = textRects || [];

  // 1. group touching pixels of (nearly) the same colour. A smooth fade stays one group, because each step is small.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = function (a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const T = WSTYLE_PIC_LINK;
  const same = function (p, q) {
    const a = p * 4, b = q * 4;
    return Math.abs(data[a] - data[b]) <= T && Math.abs(data[a + 1] - data[b + 1]) <= T && Math.abs(data[a + 2] - data[b + 2]) <= T;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w && same(i, i + 1)) { const ra = find(i), rb = find(i + 1); if (ra !== rb) parent[rb] = ra; }
      if (y + 1 < h && same(i, i + w)) { const ra = find(i), rb = find(i + w); if (ra !== rb) parent[rb] = ra; }
    }
  }
  const cnt = new Int32Array(n);
  for (let i = 0; i < n; i++) cnt[find(i)]++;
  let roots = [];
  for (let i = 0; i < n; i++) if (parent[i] === i && cnt[i] >= 20) roots.push(i);
  roots.sort(function (a, b) { return cnt[b] - cnt[a]; });
  roots = roots.slice(0, 400);
  const m = roots.length;
  if (!m) return out;

  const slotOf = new Int32Array(n).fill(-1);
  roots.forEach(function (r, k) { slotOf[r] = k; });
  const minx = new Int32Array(m).fill(w), maxx = new Int32Array(m).fill(-1);
  const miny = new Int32Array(m).fill(h), maxy = new Int32Array(m).fill(-1);
  const sr = new Float64Array(m), sg = new Float64Array(m), sb = new Float64Array(m);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = slotOf[find(i)];
      if (k < 0) continue;
      if (x < minx[k]) minx[k] = x; if (x > maxx[k]) maxx[k] = x;
      if (y < miny[k]) miny[k] = y; if (y > maxy[k]) maxy[k] = y;
      sr[k] += data[i * 4]; sg[k] += data[i * 4 + 1]; sb[k] += data[i * 4 + 2];
    }
  }
  const mean = function (k) { const c = cnt[roots[k]] || 1; return [sr[k] / c, sg[k] / c, sb[k] / c]; };
  const dist = function (a, b) { return (a && b) ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 0; };

  // the page colour: the biggest group when it covers a good part of the picture, else white
  let bgRgb = [255, 255, 255];
  if (cnt[roots[0]] >= n * 0.25) bgRgb = mean(0);
  out.bg = wstylePicHex(bgRgb[0], bgRgb[1], bgRgb[2]);

  const cover = function (x0, y0, x1, y1) {   // how much of this box is covered by words (0..1)
    const a = (x1 - x0) * (y1 - y0);
    if (a <= 0) return 0;
    let s = 0;
    textRects.forEach(function (t) {
      const ix = Math.max(0, Math.min(x1, t.x + t.w) - Math.max(x0, t.x));
      const iy = Math.max(0, Math.min(y1, t.y + t.h) - Math.max(y0, t.y));
      s += ix * iy;
    });
    return Math.min(1, s / a);
  };

  const tallest = function (x0, y0, x1, y1) {   // height of the tallest word box touching this box
    let t = 0;
    textRects.forEach(function (r) {
      if (Math.min(x1, r.x + r.w) > Math.max(x0, r.x) && Math.min(y1, r.y + r.h) > Math.max(y0, r.y)) t = Math.max(t, r.h);
    });
    return t;
  };

  // 2. picture spots first (busy, photo-like areas), so flat patches inside a photo are not read as boxes
  const gsz = Math.max(6, Math.round(Math.min(w, h) / 80));
  const gw = Math.ceil(w / gsz), gh = Math.ceil(h / gsz);
  const busy = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * gsz, y0 = gy * gsz, x1 = Math.min(w, x0 + gsz), y1 = Math.min(h, y0 + gsz);
      if (cover(x0, y0, x1, y1) >= 0.5) continue;
      let s = 0, s2 = 0, c = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4, L = (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) / 10;
          s += L; s2 += L * L; c++;
        }
      }
      if (!c) continue;
      const mu = s / c, sd = Math.sqrt(Math.max(0, s2 / c - mu * mu));
      if (sd >= 11) busy[gy * gw + gx] = 1;
    }
  }
  const thick = new Uint8Array(gw * gh);                                  // busy cells that are not part of a thin strip
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!busy[gy * gw + gx]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const yy = gy + dy, xx = gx + dx;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw && busy[yy * gw + xx]) nb++;
      }
      if (nb >= 3) thick[gy * gw + gx] = 1;
    }
  }
  const dil = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!thick[gy * gw + gx]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = gy + dy, xx = gx + dx;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) dil[yy * gw + xx] = 1;
      }
    }
  }
  const seen = new Uint8Array(gw * gh);
  for (let s0 = 0; s0 < gw * gh; s0++) {
    if (!dil[s0] || seen[s0]) continue;
    const stack = [s0]; seen[s0] = 1;
    let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
    const cells = [];
    while (stack.length) {
      const c = stack.pop(), cy = Math.floor(c / gw), cx = c % gw;
      if (thick[c]) { cells.push(c); if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = cy + dy, xx = cx + dx;
        if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
        const q = yy * gw + xx;
        if (dil[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (bx1 < 0) continue;
    const px0 = bx0 * gsz, py0 = by0 * gsz, px1 = Math.min(w, (bx1 + 1) * gsz), py1 = Math.min(h, (by1 + 1) * gsz);
    const bw = px1 - px0, bh = py1 - py0;
    if (bw < w * 0.12 || bh < h * 0.08 || bw * bh < n * 0.04) continue;
    if (bw >= w * 0.9 && bh >= h * 0.9) continue;                         // art that fills the whole page is the background
    // a box outline makes a ring of busy cells; a photo is busy inside as well
    let inner = 0, innerAll = 0;
    for (let cy = by0 + 1; cy < by1; cy++) for (let cx = bx0 + 1; cx < bx1; cx++) { innerAll++; if (thick[cy * gw + cx]) inner++; }
    if (!innerAll || inner / innerAll < 0.5) continue;
    out.slots.push({ x: px0, y: py0, w: bw, h: bh });
  }
  const inSlot = function (x0, y0, x1, y1) {
    const a = (x1 - x0) * (y1 - y0);
    if (a <= 0) return false;
    return out.slots.some(function (s) {
      const ix = Math.max(0, Math.min(x1, s.x + s.w) - Math.max(x0, s.x));
      const iy = Math.max(0, Math.min(y1, s.y + s.h) - Math.max(y0, s.y));
      return (ix * iy) / a >= 0.6;
    });
  };

  // letter-sized pieces that sit in a row look like words the OCR missed
  const mates = new Int32Array(m);
  const small = [];
  for (let k = 0; k < m; k++) {
    const bw = maxx[k] - minx[k] + 1, bh = maxy[k] - miny[k] + 1;
    if (bh >= 6 && bh <= h * 0.12 && bw <= w * 0.12) small.push(k);
  }
  small.forEach(function (a) {
    const ha = maxy[a] - miny[a] + 1;
    small.forEach(function (b) {
      if (a === b) return;
      const hb = maxy[b] - miny[b] + 1;
      if (hb / ha < 0.55 || hb / ha > 1.8) return;
      const ov = Math.min(maxy[a], maxy[b]) - Math.max(miny[a], miny[b]) + 1;
      if (ov < 0.6 * Math.min(ha, hb)) return;
      const gap = Math.max(minx[a], minx[b]) - Math.min(maxx[a], maxx[b]);
      if (gap <= 2 * Math.max(ha, hb)) mates[a]++;
    });
  });

  // 3. boxes, outlines and rules from the groups
  const solids = [], others = [];
  const minBoxArea = Math.max(300, n * 0.0008);
  for (let k = 0; k < m && solids.length + others.length < 70; k++) {
    const root = roots[k], c = cnt[root];
    const x0 = minx[k], y0 = miny[k], bw = maxx[k] - x0 + 1, bh = maxy[k] - y0 + 1;
    if (bw < 1 || bh < 1) continue;
    if (bw >= w * 0.9 && bh >= h * 0.9) continue;                         // the page itself
    // a letter or a word, not a box: mostly under OCR words AND no taller than the words (a card full of text is taller)
    if (cover(x0, y0, x0 + bw, y0 + bh) >= 0.6 && bh <= tallest(x0, y0, x0 + bw, y0 + bh) * 1.8) continue;
    const col = mean(k), hex = wstylePicHex(col[0], col[1], col[2]);
    const dBg = dist(col, bgRgb);
    const alike = dBg <= 10;                                              // the page itself
    const faint = dBg <= 30;                                              // close to the page: only a clean, solid box counts

    // a thin straight line
    if (Math.min(bw, bh) <= 4 && Math.max(bw, bh) >= Math.max(w, h) * 0.06 && c / (bw * bh) >= 0.55) {
      if (alike) continue;
      others.push({ x: x0, y: y0, w: bw, h: bh, fill: hex, stroke: null, sw: 0, rule: true, r: 0, grad: null, geom: null, _a: bw * bh });
      continue;
    }
    // a straight slanted line: a thin group whose pixels follow one diagonal
    const len = Math.hypot(bw, bh);
    if (bw >= 6 && bh >= 6 && len >= Math.max(w, h) * 0.06 && c / len <= 6 && c / (bw * bh) <= 0.4 && !alike) {
      const byRow = bh >= bw, nA = byRow ? bh : bw, nB = byRow ? bw : bh;
      const sum = new Float64Array(nA), num = new Int32Array(nA);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        if (find((y0 + y) * w + (x0 + x)) !== root) continue;
        const a = byRow ? y : x, b = byRow ? x : y;
        sum[a] += b; num[a]++;
      }
      let first = -1, last = -1;
      for (let a = 0; a < nA; a++) if (num[a]) { if (first < 0) first = a; last = a; }
      if (last - first >= nA * 0.8) {
        const bF = sum[first] / num[first], bL = sum[last] / num[last];
        let dev = 0;
        for (let a = first; a <= last; a++) {
          if (!num[a]) continue;
          dev = Math.max(dev, Math.abs(sum[a] / num[a] - (bF + (bL - bF) * (a - first) / Math.max(1, last - first))));
        }
        if (dev <= Math.max(3, nB * 0.06) && Math.abs(bL - bF) >= nB * 0.6) {
          const down = bL > bF;                                          // along the long side, the other side grows: top-left to bottom-right
          const t = Math.max(0.002, Math.min(0.5, (c / len) * len / (bh * bw)));
          others.push({ x: x0, y: y0, w: bw, h: bh, fill: hex, stroke: null, sw: 0, rule: false, r: 0, grad: null,
            geom: 'slant' + (down ? 'd' : 'u') + ':' + t.toFixed(4), _a: bw * bh });
          continue;
        }
      }
    }
    if (bw < 14 || bh < 14 || bw * bh < minBoxArea) continue;

    // how much of the box is filled once holes (words, icons) are closed: a pixel counts when its row AND column both span it
    const rowMin = new Int32Array(bh).fill(1e9), rowMax = new Int32Array(bh).fill(-1);
    const colMin = new Int32Array(bw).fill(1e9), colMax = new Int32Array(bw).fill(-1);
    const bandAcc = { horizontal: [], vertical: [], diagonal: [] };
    Object.keys(bandAcc).forEach(function (d) { for (let q = 0; q < 3; q++) bandAcc[d].push([0, 0, 0, 0]); });
    const bandAt = [0.25, 0.5, 0.75];
    const grp = { L: [0, 0, 0, 0], R: [0, 0, 0, 0], T: [0, 0, 0, 0], B: [0, 0, 0, 0], TL: [0, 0, 0, 0], BR: [0, 0, 0, 0], M: [0, 0, 0, 0] };
    const add = function (g, p) { g[0] += data[p]; g[1] += data[p + 1]; g[2] += data[p + 2]; g[3]++; };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = (y0 + y) * w + (x0 + x);
        if (find(i) !== root) continue;
        if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x;
        if (y < colMin[x]) colMin[x] = y; if (y > colMax[x]) colMax[x] = y;
        const rx = x / bw, ry = y / bh, p = i * 4;
        if (rx < 0.12) add(grp.L, p); if (rx > 0.88) add(grp.R, p);
        if (ry < 0.12) add(grp.T, p); if (ry > 0.88) add(grp.B, p);
        if (rx < 0.25 && ry < 0.25) add(grp.TL, p); if (rx > 0.75 && ry > 0.75) add(grp.BR, p);
        if (Math.abs(rx - 0.5) < 0.12 && Math.abs(ry - 0.5) < 0.12) add(grp.M, p);
        for (let q = 0; q < 3; q++) {
          if (Math.abs(rx - bandAt[q]) < 0.04) add(bandAcc.horizontal[q], p);
          if (Math.abs(ry - bandAt[q]) < 0.04) add(bandAcc.vertical[q], p);
          if (Math.abs((rx + ry) / 2 - bandAt[q]) < 0.04) add(bandAcc.diagonal[q], p);
        }
      }
    }
    let F = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (colMin[x] <= y && y <= colMax[x] && rowMin[y] <= x && x <= rowMax[y]) F++;
    }
    const ratio = F / (bw * bh), solidness = c / Math.max(1, F);
    if (mates[k] >= 2 && !(solidness >= 0.9 && ratio >= 0.72)) continue;  // a letter of a word the OCR missed

    // a box drawn only as a border
    if (solidness < 0.3 && ratio >= 0.72 && bw >= 24 && bh >= 24) {
      const sw = Math.max(1, Math.round(c / (2 * (bw + bh))));
      if (sw > Math.min(bw, bh) * 0.12 || alike) continue;
      const ell = ratio < 0.85;
      let rr = ell ? 0 : Math.min(Math.sqrt((bw * bh - F) / 0.858), Math.min(bw, bh) / 2);
      if (rr < 3) rr = 0;
      others.push({ x: x0, y: y0, w: bw, h: bh, fill: null, stroke: hex, sw: sw, rule: false, r: rr, grad: null, geom: ell ? 'ellipse' : null, _a: bw * bh });
      continue;
    }
    if (inSlot(x0, y0, x0 + bw, y0 + bh)) continue;                       // flat patches inside a photo
    if (solidness < 0.45 || ratio < 0.72) {
      // a big free-form piece of art (a curve, a blob, an illustration) cannot be rebuilt as a simple shape: keep it as a picture spot
      if (ratio < 0.72 && solidness >= 0.45 && bw >= w * 0.12 && bh >= h * 0.08 && bw * bh >= n * 0.04) out.slots.push({ x: x0, y: y0, w: bw, h: bh });
      continue;                                                           // hollow letters and thin rings are not boxes
    }
    if (faint && (solidness < 0.8 || bw * bh < minBoxArea * 2)) continue; // nearly the page colour: only a clean, solid box counts

    let geom = null, rad = 0;
    if (ratio >= 0.85) {
      rad = Math.min(Math.sqrt((bw * bh - F) / 0.858), Math.min(bw, bh) / 2);
      if (rad < 3) rad = 0;                                               // square corners (a pixel or two is anti-aliasing)
    } else geom = 'ellipse';
    if (ratio >= 0.85 && rad >= Math.min(bw, bh) * 0.46) rad = Math.min(bw, bh) / 2;   // a pill

    // a fade: both ends of the box are sampled, like js/60 does for a PDF box
    const gm = function (g) { return g[3] >= 5 ? [g[0] / g[3], g[1] / g[3], g[2] / g[3]] : null; };
    const L = gm(grp.L), R = gm(grp.R), Tt = gm(grp.T), B = gm(grp.B), TL = gm(grp.TL), BR = gm(grp.BR), M = gm(grp.M);
    let c1 = null, c2 = null, dir = null;
    if (L && R && Tt && B) {
      if (dist(L, R) > 60 && dist(Tt, B) <= 36) { c1 = L; c2 = R; dir = 'horizontal'; }
      else if (dist(Tt, B) > 60 && dist(L, R) <= 36) { c1 = Tt; c2 = B; dir = 'vertical'; }
      else if (TL && BR && dist(TL, BR) > 60 && dist(L, R) > 36 && dist(Tt, B) > 36) { c1 = TL; c2 = BR; dir = 'diagonal'; }
    }
    // The box is ONE group, so it changes colour smoothly. If the middle is not the average of the ends, the fade has
    // more colours: sample a quarter, the middle and three quarters along the fade and keep a stop only where it matters.
    let stops = null;
    if (c1 && c2) {
      const bs = bandAcc[dir].map(function (g) { return gm(g); });
      const lerp = function (t) { return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; };
      const dev = [0, 1, 2].map(function (q) { return bs[q] ? dist(bs[q], lerp(bandAt[q])) : 0; });
      const hx = function (a) { return wstylePicHex(a[0], a[1], a[2]); };
      if (bs[0] && bs[2] && (dev[0] > 40 || dev[2] > 40)) stops = [hx(c1), hx(bs[0]), hx(bs[1] || lerp(0.5)), hx(bs[2]), hx(c2)];
      else if (bs[1] && dev[1] > 40) stops = [hx(c1), hx(bs[1]), hx(c2)];
    }
    const grad = (c1 && c2) ? { c1: wstylePicHex(c1[0], c1[1], c1[2]), c2: wstylePicHex(c2[0], c2[1], c2[2]), dir: dir } : null;
    if (grad && stops) grad.stops = stops;
    if (!grad && alike) continue;                                         // the same colour as the page: it is the page
    solids.push({ x: x0, y: y0, w: bw, h: bh, fill: grad ? grad.c1 : hex, stroke: null, sw: 0, rule: false, r: rad, grad: grad, geom: geom, _a: bw * bh });
  }
  solids.sort(function (a, b) { return b._a - a._a; });                   // big ones first, so they sit behind small ones
  out.shapes = solids.concat(others).slice(0, 40).map(function (s) { delete s._a; return s; });
  return out;
}

// Called by js/60 for a picture reference. pic: { data, w, h } (the pixels). W, H: the page size in PDF points.
// runs: the words OCR found (points). Returns { shapes, slots } in PDF points, in the same shape js/60 already uses.
function wstylePicRead(pic, W, H, runs) {
  const fx = pic.w / W, fy = pic.h / H;
  const rects = (runs || []).map(function (r) {
    const size = r.size || 12;
    return { x: r.x * fx, y: (r.base - size * 0.95) * fy, w: Math.max(1, (r.w || size * 0.6 * String(r.str || '').length)) * fx, h: size * 1.25 * fy };
  });
  const a = wstylePicAnalyze(pic.data, pic.w, pic.h, rects);
  const sx = W / pic.w, sy = H / pic.h;
  return {
    slots: a.slots.map(function (s) { return { x: s.x * sx, y: s.y * sy, w: s.w * sx, h: s.h * sy, full: false }; }),
    shapes: a.shapes.map(function (s) {
      return { x: s.x * sx, y: s.y * sy, w: s.w * sx, h: s.h * sy, fill: s.fill, stroke: s.stroke, sw: s.sw * sx,
        rule: s.rule, r: s.r * sx, grad: s.grad, geom: s.geom };
    })
  };
}
