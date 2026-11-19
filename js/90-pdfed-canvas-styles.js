// ─── PDF Editor: Canvas "Styles" (10 premium backgrounds + 10 photo frames) ───
// PREMIUM CANVAS VERSION (2026-11-18, third pass). Everything is drawn with the browser's 2D canvas. No SVG anywhere.
// What changed from the second pass: the look. Flat blobs and blurred ellipses are gone. The styles are now built from real
// light and material: satin folds with a specular sheen, brushed gold foil, caustic light under water, star dust, glass orbs,
// bokeh, aurora ribbons, true film grain, brushed metal frames with a bevel. The empty photo box is a quiet glass window
// (no cartoon picture on it).
// How it behaves (unchanged): click a style in the right panel (Studio, Canvas tab) or DRAG it onto the page.
//   Backgrounds  become the page background (same bake as Canvas Color, so Remove Tint / All Pages still work).
//   Photo Frames the frame's background PLUS real, movable, resizable photo boxes (flag _pcs) plus a real Title and Caption (flag _pcsText).
// Nothing here edits js/19, js/28 or js/80. Two small wrappers (pdfedStudioBuild, pdfedRenderPlacedImages) add the panel section
// and the upload buttons on the photo boxes.
(function () {
  var STY = { tab: 'bg', set: 'pro', cur: null, busy: false, rt: 0 }, MIME = 'application/x-pcs-style';
  var GOLD = ['#f1dfae', '#b8893c', '#f7e8bd', '#8a6428'], SIL = ['#f4f6f8', '#9aa3ad', '#e9edf1', '#6c7580'],
      ROSE = ['#f6d5c5', '#c98a6b', '#f9e1d4', '#a86a4d'], COP = ['#f5c28a', '#c2703a', '#f3b57c', '#7a3e19'],
      AUR = ['#22d3a0', '#7c3aed', '#7c3aed', '#06b6d4'], BLD = ['#ff9a8b', '#c084fc', '#c084fc', '#fbbf77'],
      OCN = ['#2de2e6', '#3a7bd5', '#3a7bd5', '#8be9fd'];

  // ─── Tiny toolkit: seeded random, colour, noise ───
  function n2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hex(c) {
    c = String(c || '#000000').replace('#', ''); if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16) || 0, parseInt(c.slice(2, 4), 16) || 0, parseInt(c.slice(4, 6), 16) || 0];
  }
  function rgba(c, a) { var r = hex(c); return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + n2(clamp(a, 0, 1)) + ')'; }
  // A 256 step colour ramp from stops [[0..1, '#hex'], ...]
  function lutOf(stops) {
    var out = new Uint8ClampedArray(256 * 3), s = stops.map(function (x) { return [x[0], hex(x[1])]; }), i, k;
    for (i = 0; i < 256; i++) {
      var t = i / 255; k = 0; while (k < s.length - 2 && t > s[k + 1][0]) k++;
      var a = s[k], b = s[k + 1], f = clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
      out[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * f; out[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f; out[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
    }
    return out;
  }
  // Smooth gradient noise (about -1 to 1), seeded.
  function noiseFn(seed) {
    var r = rngOf(seed), p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256), i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = (r() * (i + 1)) | 0; t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 256; i++) { p[i + 256] = p[i]; var a = r() * 6.2831853; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; xi &= 255; yi &= 255;
      var a = p[p[xi] + yi], b = p[p[xi + 1] + yi], c = p[p[xi] + yi + 1], d = p[p[xi + 1] + yi + 1];
      var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      var n00 = gx[a] * xf + gy[a] * yf, n10 = gx[b] * (xf - 1) + gy[b] * yf, n01 = gx[c] * xf + gy[c] * (yf - 1), n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
      var x1 = n00 + (n10 - n00) * u, x2 = n01 + (n11 - n01) * u;
      return (x1 + (x2 - x1) * v) * 1.5;
    };
  }
  function fbm(N, x, y, oct, lac, gain) { var s = 0, a = 1, f = 1, m = 0, i; for (i = 0; i < oct; i++) { s += a * N(x * f, y * f); m += a; a *= gain; f *= lac; } return s / m; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // ─── Canvas helpers ───
  function cv(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  // Per pixel field drawn small, scaled up smoothly. fn(u, v, out) fills out = [r, g, b, a(0..255)].
  function field(w, h, longSide, fn) {
    var k = Math.min(1, longSide / Math.max(w, h)), fw = Math.max(8, Math.round(w * k)), fh = Math.max(8, Math.round(h * k));
    var c = cv(fw, fh), x = c.getContext('2d'), im = x.createImageData(fw, fh), d = im.data, o = [0, 0, 0, 255], px, py, q = 0;
    for (py = 0; py < fh; py++) for (px = 0; px < fw; px++) {
      o[3] = 255; fn((px + .5) / fw, (py + .5) / fh, o);
      d[q++] = o[0]; d[q++] = o[1]; d[q++] = o[2]; d[q++] = o[3];
    }
    x.putImageData(im, 0, 0); return c;
  }
  function lay(ctx, c, w, h, alpha, comp) {
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.globalCompositeOperation = comp || 'source-over';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, w, h); ctx.restore();
  }
  // A soft pool of light with a natural (gaussian like) falloff. No blur filter needed.
  function glow(ctx, x, y, rx, ry, col, a, comp) {
    ctx.save(); ctx.globalCompositeOperation = comp || 'source-over'; ctx.translate(x, y); ctx.scale(1, ry / rx);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx), i;
    for (i = 0; i <= 8; i++) { var t = i / 8; g.addColorStop(t, rgba(col, i === 8 ? 0 : a * Math.exp(-4.2 * t * t))); }
    ctx.fillStyle = g; ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx); ctx.restore();
  }
  var GT = {};
  function grainTile(seed) {
    if (GT[seed]) return GT[seed];
    var c = cv(256, 256), x = c.getContext('2d'), im = x.createImageData(256, 256), d = im.data, r = rngOf(seed + 77), i, v;
    for (i = 0; i < d.length; i += 4) { v = 128 + ((r() + r() + r() - 1.5) * 118); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(im, 0, 0); return (GT[seed] = c);
  }
  // Real film grain: a tiled noise tile laid over the picture with the overlay blend.
  // CUR holds the tweaks for the style being drawn right now (see normOpts): grain and vignette strength multipliers.
  var CUR = { gm: 1, vm: 1 };
  function grain(ctx, w, h, amt, seed) {
    amt = Math.min(.7, amt * CUR.gm); if (!amt) return;
    var s = clamp(w / 1200, .6, 1.5), pat = ctx.createPattern(grainTile(seed % 5), 'repeat'); if (!pat) return;
    ctx.save(); ctx.globalAlpha = amt; ctx.globalCompositeOperation = 'overlay'; ctx.scale(s, s); ctx.fillStyle = pat; ctx.fillRect(0, 0, w / s, h / s); ctx.restore();
  }
  function vignette(ctx, w, h, a, tint) {
    a = Math.min(.9, a * CUR.vm); if (!a) return;
    var g = ctx.createRadialGradient(w / 2, h * .46, Math.min(w, h) * .3, w / 2, h / 2, Math.hypot(w, h) * .62);
    g.addColorStop(0, rgba(tint || '#000000', 0)); g.addColorStop(1, rgba(tint || '#000000', a));
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  function vgrad(ctx, w, h, top, bot) { var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bot); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  // A four point glint, like light catching metal.
  function glint(ctx, x, y, s, col, a) {
    glow(ctx, x, y, s * .55, s * .55, col, a, 'lighter');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    [[1, 0], [0, 1]].forEach(function (d) {
      var g = ctx.createLinearGradient(x - d[0] * s, y - d[1] * s, x + d[0] * s, y + d[1] * s);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(.5, rgba('#ffffff', a)); g.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, s * .035); ctx.beginPath(); ctx.moveTo(x - d[0] * s, y - d[1] * s); ctx.lineTo(x + d[0] * s, y + d[1] * s); ctx.stroke();
    });
    ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function stars(ctx, w, h, rng, n, sc, col) {
    var i; ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < n; i++) {
      var x = rng() * w, y = rng() * h, r = (.35 + Math.pow(rng(), 3) * 1.5) * sc, a = .25 + rng() * .75;
      ctx.fillStyle = rgba(rng() < .18 ? col : '#ffffff', a); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  // ─── The renderers. Each draws a whole page in normalised coordinates, so a thumbnail and a page match. ───
  var R = {};

  // Satin / velvet: a folded surface lit from one side, with a specular sheen. Used for Champagne, Emerald Velvet, Peach Silk and more.
  R.silk = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, lo = hex(p.lo), hi = hex(p.hi), sp = hex(p.spec), ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    var L = [-.5, -.62, .6], ll = Math.hypot(L[0], L[1], L[2]); L = [L[0] / ll, L[1] / ll, L[2] / ll];
    var hv = [L[0], L[1], L[2] + 1], hl = Math.hypot(hv[0], hv[1], hv[2]); hv = [hv[0] / hl, hv[1] / hl, hv[2] / hl];
    function H(x, y) {
      var wx = fbm(N, x * 1.1, y * 1.1, 2, 2, .5), wy = fbm(N, x * 1.1 + 7.3, y * 1.1 + 2.1, 2, 2, .5), a = (x * ca + y * sa) * p.f + wx * p.w + wy * p.w * .6;
      return Math.sin(a) * .55 + Math.sin(a * 2.07 + 1.3 + wy * 2) * .22 + Math.sin(a * .43 + wx * 1.8) * .6;
    }
    var e = .005;
    lay(ctx, field(w, h, 540, function (u, v, o) {
      var x = u * asp, y = v, hx = (H(x + e, y) - H(x - e, y)) / (2 * e), hy = (H(x, y + e) - H(x, y - e)) / (2 * e);
      var nx = -hx * p.rel, ny = -hy * p.rel, il = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= il; ny *= il; var nz = il;
      var t = clamp(.5 + (nx * L[0] + ny * L[1] + nz * L[2] - .55) * p.con + (p.lift || 0), 0, 1);
      var nh = Math.max(0, nx * hv[0] + ny * hv[1] + nz * hv[2]), s = Math.pow(nh, p.sh) * p.si;
      var fall = 1 - (p.fall || 0) * (Math.abs(u - .5) * .9 + Math.abs(v - .45) * .8);
      o[0] = (lo[0] + (hi[0] - lo[0]) * t) * fall + sp[0] * s; o[1] = (lo[1] + (hi[1] - lo[1]) * t) * fall + sp[1] * s; o[2] = (lo[2] + (hi[2] - lo[2]) * t) * fall + sp[2] * s;
    }), w, h);
    if (p.glow) p.glow.forEach(function (g) { glow(ctx, g[0] * w, g[1] * h, g[2] * w, g[2] * w * 1.3, g[3], g[4], 'soft-light'); });
    if (p.dust) { var r = rngOf(seed + 5); stars(ctx, w, h, r, p.dust, w / 1200, p.spec); }
    vignette(ctx, w, h, p.vig || 0, p.vigc); grain(ctx, w, h, p.grain == null ? .22 : p.grain, seed);
  };

  // Aurora: ribbons of light drawn as hundreds of fine curves, like satin curtains in the night sky.
  R.aurora = function (ctx, w, h, seed, p) {
    var r = rngOf(seed), sc = w / 1000;
    vgrad(ctx, w, h, p.top, p.bot);
    p.cols.forEach(function (c, i) { glow(ctx, w * (.2 + .6 * r()), h * (.2 + .28 * i + .1 * r()), w * 1.05, w * .9, c, .5, 'lighter'); });
    p.cols.forEach(function (c, b) {
      var n = 96, y0 = h * (.18 + .27 * b + .05 * r()), ph = r() * 6.28, amp = h * (.07 + .06 * r()), spread = h * (.0042 + .0016 * r()), fr = 1.5 + r() * 1.5;
      var g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, rgba(c, 0)); g.addColorStop(.22, rgba(c, 1)); g.addColorStop(.78, rgba(c, 1)); g.addColorStop(1, rgba(c, 0));
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = g; ctx.lineWidth = Math.max(1.1, 1.8 * sc);
      for (var i = 0; i < n; i++) {
        var k = (i - n / 2) / (n / 2), edge = 1 - Math.abs(k); ctx.globalAlpha = .05 + .26 * edge * edge;
        ctx.beginPath();
        for (var s = 0; s <= 56; s++) {
          var x = -w * .05 + w * 1.1 * s / 56, u = x / w;
          var y = y0 + (i - n / 2) * spread * (1 + .9 * Math.sin(u * 3.1 + ph + i * .035)) + amp * Math.sin(u * fr + ph) + amp * .42 * Math.sin(u * 5.1 + ph * 1.7);
          if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    });
    stars(ctx, w, h, r, Math.round(w * h / 4200), sc, p.cols[0]);
    vignette(ctx, w, h, p.vig, '#000000'); grain(ctx, w, h, p.grain == null ? .2 : p.grain, seed);
  };

  // Caustics: the web of light you see on the floor of a clear pool, over deep water, with shafts of light from above.
  R.caustic = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, c1 = hex(p.c1), c2 = hex(p.c2), r = rngOf(seed + 3);
    vgrad(ctx, w, h, p.top, p.bot);
    p.glows.forEach(function (g) { glow(ctx, g[0] * w, g[1] * h, g[2] * w, g[2] * w * 1.2, g[3], g[4], 'lighter'); });
    lay(ctx, field(w, h, 520, function (u, v, o) {
      var x = u * asp, y = v, q = fbm(N, x * 2.1, y * 2.1, 2, 2, .5), n = fbm(N, x * p.sc + q * 1.9, y * p.sc + q * 1.3 + 4, 3, 2.05, .5);
      var rid = Math.pow(clamp(1 - Math.abs(n * 2.3), 0, 1), p.sharp), fade = (1 - p.depth * v) * (.6 + .4 * Math.sin(x * 2.2 + n * 2));
      var k = clamp(rid * fade, 0, 1);
      o[0] = c1[0] + (c2[0] - c1[0]) * k; o[1] = c1[1] + (c2[1] - c1[1]) * k; o[2] = c1[2] + (c2[2] - c1[2]) * k; o[3] = k * 255 * p.caus;
    }), w, h, 1, 'screen');
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < 5; i++) {
      var x0 = w * (.05 + .9 * r()), sw = w * (.04 + .05 * r()), lean = w * (.2 + .12 * r()), g = ctx.createLinearGradient(0, 0, 0, h * .9);
      g.addColorStop(0, rgba(p.shaft, .075)); g.addColorStop(1, rgba(p.shaft, 0)); ctx.fillStyle = g;
      for (var q = 0; q < 6; q++) { var s2 = sw * (1 + q * .55); ctx.beginPath(); ctx.moveTo(x0 - s2, 0); ctx.lineTo(x0 + s2, 0); ctx.lineTo(x0 + s2 * 1.6 + lean, h * .9); ctx.lineTo(x0 - s2 * .6 + lean, h * .9); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
    vignette(ctx, w, h, p.vig, '#00040c'); grain(ctx, w, h, p.grain == null ? .18 : p.grain, seed);
  };

  // Warm flowing colour (Sunset Blend): a soft, silky colour field with a glass-bright sun.
  R.sunset = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, L = lutOf(p.ramp);
    lay(ctx, field(w, h, 420, function (u, v, o) {
      var x = u * asp, y = v, q = fbm(N, x * 1.5, y * 1.5, 3, 2, .5), n2v = fbm(N, x * 2.6 + q * 1.4 + 3, y * 2.6 + q, 2, 2, .5);
      var t = clamp(v * .92 + q * .34 + n2v * .06 + (u - .5) * .2 + Math.sin(u * 3.3 + v * 2.2 + q * 2) * .03, 0, 1), i = (t * 255) | 0;
      var shade = 1 + n2v * .09;
      o[0] = L[i * 3] * shade; o[1] = L[i * 3 + 1] * shade; o[2] = L[i * 3 + 2] * shade;
    }), w, h);
    glow(ctx, w * .72, h * .2, w * .62, w * .62, '#fff4dc', .75, 'soft-light'); glow(ctx, w * .72, h * .2, w * .26, w * .26, '#ffffff', .32, 'lighter');
    glow(ctx, w * .1, h * .95, w * .8, w * .6, p.low, .3, 'soft-light');
    vignette(ctx, w, h, .14, '#2a0f3f'); grain(ctx, w, h, .2, seed);
  };

  // Brushed foil: a black page with a diagonal beam of brushed gold (or copper, or silver) light and a few glints.
  R.foil = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, L = lutOf(p.ramp), T = p.ang * Math.PI / 180, ct = Math.cos(T), st = Math.sin(T), r = rngOf(seed + 9);
    vgrad(ctx, w, h, p.top, p.base);
    glow(ctx, w * p.gx, h * p.gy, w * 1.0, w * 1.15, p.glowc, p.glowa, 'lighter');
    lay(ctx, field(w, h, 640, function (u, v, o) {
      var x = u * asp, y = v, a = x * ct + y * st, b = -x * st + y * ct, d = (b - p.b0) / p.wid;
      var beam = Math.exp(-d * d) + .7 * Math.exp(-Math.pow((b - p.b0 - p.gap) / (p.wid * .32), 2)) + .35 * Math.exp(-Math.pow((b - p.b0 + p.gap * .8) / (p.wid * .22), 2));
      var br = .5 + .5 * N(a * 1.2, b * 34) * .8 + .1 * N(a * 4, b * 90), fa = .5 + .5 * smooth(-.45, .35, N(a * .9 + 2, 1.7) + .15);
      var val = clamp(beam * (.62 + .55 * br) * fa * p.int, 0, 1), i = (val * 255) | 0;
      o[0] = L[i * 3]; o[1] = L[i * 3 + 1]; o[2] = L[i * 3 + 2]; o[3] = clamp(val * 1.5, 0, 1) * 255;
    }), w, h, 1, 'screen');
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.lineWidth = Math.max(1, w / 1300);
    for (var i = 0; i < Math.round(h / 2.2); i++) { var y = r() * h, x = r() * w, ln = w * (.15 + r() * .6); ctx.strokeStyle = r() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.moveTo(x - ln / 2, y); ctx.lineTo(x + ln / 2, y); ctx.stroke(); }
    ctx.restore();
    (p.glints || []).forEach(function (g) { glint(ctx, g[0] * w, g[1] * h, g[2] * w, p.spark, g[3]); });
    vignette(ctx, w, h, p.vig, '#000000'); grain(ctx, w, h, p.grain == null ? .24 : p.grain, seed);
  };

  // Nebula: clouds of coloured gas with star dust.
  R.nebula = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, L = lutOf(p.ramp), r = rngOf(seed + 11);
    vgrad(ctx, w, h, p.top, p.bot);
    lay(ctx, field(w, h, 460, function (u, v, o) {
      var x = u * asp, y = v, q = fbm(N, x * 1.7, y * 1.7, 3, 2, .5), q2 = fbm(N, x * 1.7 + 5, y * 1.7 + 8, 3, 2, .5);
      var n = fbm(N, x * 2.2 + q * 1.3, y * 2.2 + q2 * 1.3, 5, 2.05, .5), d = smooth(-.3, .55, n + (p.bias || 0) + (.45 - Math.abs(v - .5)) * .3), c = clamp(.25 + n * .9 + q2 * .5, 0, 1), i = (c * 255) | 0;
      o[0] = L[i * 3]; o[1] = L[i * 3 + 1]; o[2] = L[i * 3 + 2]; o[3] = d * 235;
    }), w, h, 1, 'screen');
    glow(ctx, w * p.gx, h * p.gy, w * .55, w * .55, p.core, .5, 'lighter');
    stars(ctx, w, h, r, Math.round(w * h / 1700), w / 1100, p.star);
    for (var i = 0; i < 4; i++) glint(ctx, r() * w, r() * h, w * (.03 + .03 * r()), p.star, .8);
    vignette(ctx, w, h, p.vig, '#000000'); grain(ctx, w, h, p.grain == null ? .2 : p.grain, seed);
  };

  // Bokeh: out of focus lights with bright rims, like city lights seen through glass at night.
  R.bokeh = function (ctx, w, h, seed, p) {
    var r = rngOf(seed), sc = w / 1000;
    vgrad(ctx, w, h, p.top, p.bot);
    p.glows.forEach(function (g) { glow(ctx, g[0] * w, g[1] * h, g[2] * w, g[2] * w * 1.1, g[3], g[4], 'lighter'); });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < p.n; i++) {
      var depth = r(), rad = (22 + Math.pow(r(), 1.7) * 120) * sc * (.7 + depth * .8), x = r() * w, y = h * (.04 + .92 * Math.pow(r(), .85)), col = p.cols[(r() * p.cols.length) | 0];
      var a = (.05 + .17 * (1 - depth)) * (.7 + .6 * r()), g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, rgba(col, a * .55)); g.addColorStop(.72, rgba(col, a * .8)); g.addColorStop(.9, rgba(col, a * 1.55)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
    stars(ctx, w, h, r, Math.round(w * h / 9000), sc * 1.1, p.cols[0]);
    vignette(ctx, w, h, p.vig, '#000000'); grain(ctx, w, h, p.grain == null ? .2 : p.grain, seed);
  };

  // Glass: a soft pastel colour field with frosted glass orbs floating on it. Light and airy.
  R.glass = function (ctx, w, h, seed, p) {
    var N = noiseFn(seed), asp = w / h, L = lutOf(p.ramp), r = rngOf(seed + 21), sc = w / 1000;
    lay(ctx, field(w, h, 360, function (u, v, o) {
      var x = u * asp, y = v, q = fbm(N, x * 1.3, y * 1.3, 3, 2, .5), t = clamp(v * .55 + u * .3 + q * .55 + .08, 0, 1), i = (t * 255) | 0;
      o[0] = L[i * 3]; o[1] = L[i * 3 + 1]; o[2] = L[i * 3 + 2];
    }), w, h);
    glow(ctx, w * .2, h * .12, w * .8, w * .6, '#ffffff', .6, 'soft-light');
    p.orbs.forEach(function (b) {
      var x = b[0] * w, y = b[1] * h, rad = b[2] * w, col = b[3];
      glow(ctx, x + rad * .1, y + rad * .22, rad * 1.5, rad * 1.45, col, .28, 'multiply');
      var g = ctx.createRadialGradient(x - rad * .35, y - rad * .4, rad * .05, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,.62)'); g.addColorStop(.45, rgba(col, .14)); g.addColorStop(.82, 'rgba(255,255,255,.1)'); g.addColorStop(1, rgba(col, .26));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
      var rg = ctx.createLinearGradient(x - rad, y - rad, x + rad, y + rad); rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(.5, 'rgba(255,255,255,.08)'); rg.addColorStop(1, 'rgba(255,255,255,.55)');
      ctx.strokeStyle = rg; ctx.lineWidth = Math.max(1.2, 2.2 * sc); ctx.beginPath(); ctx.arc(x, y, rad - ctx.lineWidth / 2, 0, 6.2832); ctx.stroke();
      ctx.save(); ctx.globalAlpha = .75; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1, 2 * sc); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, rad * .8, Math.PI * 1.08, Math.PI * 1.36); ctx.stroke(); ctx.restore();
    });
    for (var i = 0; i < 26; i++) { var rr = (3 + r() * 9) * sc; glow(ctx, r() * w, r() * h, rr * 2.4, rr * 2.4, '#ffffff', .5, 'soft-light'); }
    vignette(ctx, w, h, p.vig || .05, p.vigc || '#7a5a9a'); grain(ctx, w, h, p.grain == null ? .14 : p.grain, seed);
  };

  // Classic: the first set of styles (soft colour glows on a base), kept as a second set next to the premium one. Drawn on canvas too.
  // blobs: [cx, cy, rx, ry, colour, opacity, rotation] on a 300x400 grid. mesh: [x%, y%, colour, stop%, alpha].
  R.classic = function (ctx, w, h, seed, p) {
    var sx = w / 300, sy = h / 400, i;
    if (p.lin) {
      var a = p.lin[0] * Math.PI / 180, Ln = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2, dx = Math.sin(a) * Ln, dy = -Math.cos(a) * Ln, g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
      g.addColorStop(0, p.lin[1]); g.addColorStop(1, p.lin[2]); ctx.fillStyle = g;
    } else ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, w, h);
    (p.mesh || []).forEach(function (m) {
      var px = m[0] / 100 * w, py = m[1] / 100 * h, far = Math.max(Math.hypot(px, py), Math.hypot(w - px, py), Math.hypot(px, h - py), Math.hypot(w - px, h - py));
      var g = ctx.createRadialGradient(px, py, 0, px, py, m[3] / 100 * far); g.addColorStop(0, rgba(m[2], m[4])); g.addColorStop(1, rgba(m[2], 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    (p.blobs || []).forEach(function (e) {
      var bl = p.bl || 34, Rx = e[2] + 2.4 * bl, Ry = e[3] + 2.4 * bl, core = Math.max(0, (Math.min(e[2], e[3]) - bl * .6) / Math.min(Rx, Ry));
      ctx.save(); ctx.scale(sx, sy); ctx.translate(e[0], e[1]); if (e[6]) ctx.rotate(e[6] * Math.PI / 180); ctx.scale(Rx, Ry);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1), k;
      for (k = 0; k <= 10; k++) { var t = k / 10, f = t <= core ? 1 : 1 - smooth(0, 1, (t - core) / (1 - core)); g.addColorStop(t, rgba(e[4], k === 10 ? 0 : e[5] * f)); }
      ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    });
    var sh = ctx.createLinearGradient(0, 0, w, h); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(.38, 'rgba(255,255,255,0)'); sh.addColorStop(.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.18)'); ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);
    vignette(ctx, w, h, .22, '#000000'); grain(ctx, w, h, .2, seed);
  };

  // ─── The styles (data). Same names and order as before, so Kadessa's catalogue still lines up. ───
  var BG = [
    { n: 'Aurora Silk', r: 'aurora', seed: 1101, p: { top: '#050a18', bot: '#0a0820', cols: ['#22d3a0', '#7c3aed', '#06b6d4'], vig: .45 } },
    { n: 'Mesh Ocean', r: 'caustic', seed: 1102, p: { top: '#0e3a78', bot: '#030c22', c1: '#1b5fb0', c2: '#9ff4ff', sc: 3.0, sharp: 2.6, depth: .6, caus: .55, shaft: '#7fe3ff', vig: .5,
      glows: [[.15, .1, .9, '#2de2e6', .22], [.9, .3, .8, '#3a7bd5', .3], [.5, 1.05, 1, '#0b3d91', .5]] } },
    { n: 'Sunset Blend', r: 'sunset', seed: 1103, p: { low: '#6a4cff', ramp: [[0, '#fff1d9'], [.3, '#ffc78f'], [.52, '#ff8fa3'], [.76, '#c78bff'], [1, '#7b6bff']] } },
    { n: 'Obsidian Gold', r: 'foil', seed: 1104, p: { top: '#14100a', base: '#050403', ang: 32, b0: .08, wid: .2, gap: .28, int: 1.05, gx: .85, gy: .08, glowc: '#c9a24b', glowa: .2, spark: '#f6e2a8', vig: .55,
      ramp: [[0, '#000000'], [.25, '#3a2a10'], [.5, '#a9782f'], [.75, '#eccf86'], [1, '#fff6dc']], glints: [[.78, .24, .07, .9], [.3, .62, .045, .6], [.6, .83, .035, .5]] } },
    { n: 'Violet Nebula', r: 'nebula', seed: 1105, p: { top: '#0a0422', bot: '#060214', gx: .3, gy: .3, core: '#d946ef', star: '#e9c9ff', bias: .02, vig: .5,
      ramp: [[0, '#2a1a8a'], [.4, '#7a3ff0'], [.7, '#e046d8'], [1, '#ffd6f5']] } },
    { n: 'Champagne', r: 'silk', seed: 1106, p: { lo: '#dcc79d', hi: '#fff8e8', spec: '#fffdf4', ang: .9, f: 6.2, w: 2.6, rel: .17, con: 1.25, lift: .04, sh: 36, si: .75, fall: .08, vig: .08, vigc: '#8a6a30', grain: .18, dust: 90,
      glow: [[.8, .12, .6, '#ffffff', .6]] } },
    { n: 'Emerald Velvet', r: 'silk', seed: 1107, p: { lo: '#01140f', hi: '#118662', spec: '#8fffd8', ang: 2.2, f: 6.6, w: 2.8, rel: .17, con: 1.3, lift: -.03, sh: 28, si: .6, fall: .35, vig: .35, vigc: '#000000', grain: .26, dust: 40,
      glow: [[.2, .1, .7, '#10b981', .35]] } },
    { n: 'Lavender Mist', r: 'glass', seed: 1108, p: { vigc: '#7a5aa8', ramp: [[0, '#fbf6ff'], [.35, '#e3d6ff'], [.62, '#f6c9f0'], [1, '#bcc4ff']],
      orbs: [[.82, .13, .13, '#a78bfa'], [.14, .36, .09, '#f0abfc'], [.76, .52, .17, '#818cf8'], [.28, .8, .15, '#f472b6'], [.9, .88, .06, '#c4b5fd']] } },
    { n: 'Midnight Rose', r: 'bokeh', seed: 1109, p: { top: '#1a0614', bot: '#0b030c', n: 58, vig: .5, cols: ['#fb7185', '#f9a8d4', '#c084fc', '#ffd1a8'],
      glows: [[.2, .1, .8, '#9d174d', .5], [.85, .55, .9, '#6d28d9', .38], [.3, 1.0, .9, '#be185d', .4]] } },
    { n: 'Peach Silk', r: 'silk', seed: 1110, p: { lo: '#eebb9c', hi: '#fff4ec', spec: '#ffffff', ang: -.7, f: 5.4, w: 2.2, rel: .16, con: 1.2, lift: .05, sh: 34, si: .8, fall: .06, vig: .08, vigc: '#c0603a', grain: .16, dust: 0,
      glow: [[.15, .85, .7, '#ff9fb0', .5]] } }
  ];

  // Photo frames. b: photo boxes [l, t, w, h, slot] in % of the page. t: text box [l, t, w, h, title, caption, titleColour, captionColour, align].
  // r and p: the background renderer. dark: the frame sits on a dark page. deco: fine gold lines.
  var FR = [
    { n: 'Ivory Duo', dark: false, r: 'silk', seed: 2101, p: { lo: '#e9e1cf', hi: '#fbf8ef', spec: '#fffdf6', ang: .5, f: 3.2, w: 1.8, rel: .06, con: .7, lift: .12, sh: 20, si: .4, fall: .05, vig: .06, vigc: '#8a6a30', grain: .16, dust: 0 },
      ring: [1.2, GOLD], deco: [{ r: [2.5, 2.5, 95, 95], s: '#b8893c88' }], b: [[14, 6, 72, 34, 'a'], [14, 43, 72, 32, 'b']], t: [14, 78, 72, 14, 'The Wedding Day', 'Add a date or a short line', '#3a2f1c', '#8a6428', 'center'] },
    { n: 'Midnight Trio', dark: true, r: 'aurora', seed: 2102, p: { top: '#050a18', bot: '#0a0820', cols: ['#22d3a0', '#7c3aed', '#06b6d4'], vig: .5 },
      ring: [.9, AUR], b: [[10, 20, 80, 39, 'a'], [10, 62, 38.5, 30, 'b'], [51.5, 62, 38.5, 30, 'c']], t: [10, 5, 80, 12, 'Night Sessions', 'Write your caption here', '#ffffff', '#9fb4d8', 'center'] },
    { n: 'Champagne Pair', dark: false, r: 'silk', seed: 2103, p: { lo: '#ecd9c4', hi: '#fcf3ea', spec: '#fffaf5', ang: 1.2, f: 4.0, w: 2.2, rel: .07, con: .75, lift: .1, sh: 18, si: .5, fall: .06, vig: .08, vigc: '#a86a4d', grain: .16, dust: 50 },
      ring: [1, ROSE], deco: [{ l: [8, 8, 92, 8], s: '#a86a4d99' }, { l: [8, 94, 92, 94], s: '#a86a4d99' }], b: [[9, 12, 40, 56, 'a'], [51, 12, 40, 56, 'b']], t: [9, 73, 82, 17, 'Two of Us', 'Add names, a place or a date', '#4b2e22', '#a86a4d', 'center'] },
    { n: 'Noir Layers', dark: true, r: 'foil', seed: 2104, p: { top: '#161616', base: '#070707', ang: -38, b0: .5, wid: .16, gap: .22, int: .8, gx: .15, gy: .9, glowc: '#c9a24b', glowa: .14, spark: '#f6e2a8', vig: .6,
      ramp: [[0, '#000000'], [.3, '#2a2a2a'], [.55, '#8a7a55'], [.8, '#dcc27c'], [1, '#fff3cf']], glints: [[.9, .1, .05, .7]] },
      ring: [.8, GOLD], b: [[8, 6, 50, 30, 'a'], [42, 28, 50, 30, 'b'], [8, 62, 40, 26, 'c']], t: [52, 63, 40, 26, 'Our Story', 'A few words here', '#ffffff', '#c9a24b', 'left'] },
    { n: 'Navy Mosaic', dark: true, r: 'caustic', seed: 2105, p: { top: '#0f2350', bot: '#050b1e', c1: '#1c3f8a', c2: '#bcd2ff', sc: 3.4, sharp: 3.0, depth: .7, caus: .4, shaft: '#9bb6ff', vig: .5, glows: [[.2, .1, .8, '#3a5bd5', .25], [.9, .9, .9, '#12307a', .4]] },
      ring: [.8, GOLD], deco: [{ r: [3, 3, 94, 94], s: '#b8893c77' }], b: [[8, 8, 42, 66, 'a'], [52, 8, 40, 31, 'b'], [52, 43, 40, 31, 'c']], t: [8, 78, 84, 14, 'Summer Edit', 'Place, date or a caption', '#f1e3bd', '#b8893c', 'left'] },
    { n: 'Emerald Diagonal', dark: true, r: 'silk', seed: 2106, p: { lo: '#031d16', hi: '#0f7357', spec: '#8fffd8', ang: .6, f: 4.8, w: 2.4, rel: .1, con: 1.1, lift: -.02, sh: 14, si: .4, fall: .3, vig: .35, vigc: '#000000', grain: .24, dust: 30, glow: [[.8, .1, .7, '#10b981', .3]] },
      ring: [1, GOLD], b: [[10, 6, 56, 32, 'a'], [34, 42, 56, 32, 'b']], t: [10, 78, 80, 14, 'Weekend Away', 'Write a short note here', '#eafff5', '#e1c37a', 'left'] },
    { n: 'Pearl Triptych', dark: false, r: 'silk', seed: 2107, p: { lo: '#d6dbe4', hi: '#f8f9fc', spec: '#ffffff', ang: 1.45, f: 3.4, w: 1.9, rel: .07, con: .75, lift: .1, sh: 22, si: .7, fall: .05, vig: .06, vigc: '#6c7580', grain: .14, dust: 0 },
      ring: [1, SIL], b: [[8, 10, 26, 58, 'a'], [37, 10, 26, 58, 'b'], [66, 10, 26, 58, 'c']], t: [8, 73, 84, 18, 'Three Moments', 'Add your caption here', '#1d2430', '#6c7580', 'center'] },
    { n: 'Rose Blend', dark: false, r: 'glass', seed: 2108, p: { vigc: '#9a5a7a', ramp: [[0, '#fff6f1'], [.4, '#ffd9cf'], [.7, '#f0cdf6'], [1, '#d9c8ff']], orbs: [[.86, .1, .12, '#fb7185'], [.1, .5, .1, '#c084fc'], [.9, .85, .14, '#f9a8d4'], [.3, .96, .07, '#fbbf77']] },
      ring: [1.6, BLD], b: [[10, 6, 80, 32, 'a'], [10, 43, 80, 32, 'b']], t: [10, 79, 80, 14, 'Soft Days', 'A line to remember', '#4a2a45', '#9a5a7a', 'center'] },
    { n: 'Cobalt Feature', dark: true, r: 'caustic', seed: 2109, p: { top: '#0b2d6b', bot: '#030a1f', c1: '#164f9e', c2: '#7ff0ff', sc: 3.0, sharp: 2.4, depth: .55, caus: .6, shaft: '#6fe0ff', vig: .5, glows: [[.12, .1, .9, '#2de2e6', .26], [.9, .35, .9, '#3a7bd5', .32]] },
      ring: [.9, OCN], b: [[8, 6, 84, 44, 'a'], [8, 53, 40, 24, 'b'], [52, 53, 40, 24, 'c']], t: [8, 80, 84, 13, 'The Launch', 'Add details or a caption', '#ffffff', '#8be9fd', 'left'] },
    { n: 'Copper Overlap', dark: true, r: 'foil', seed: 2110, p: { top: '#1f0d06', base: '#080302', ang: 28, b0: .0, wid: .21, gap: .3, int: 1.0, gx: .8, gy: .1, glowc: '#ea580c', glowa: .22, spark: '#ffcf9e', vig: .55,
      ramp: [[0, '#000000'], [.25, '#3b1608'], [.5, '#b45a24'], [.78, '#f2a468'], [1, '#fff0dc']], glints: [[.8, .2, .06, .8], [.25, .68, .04, .55]] },
      ring: [1.1, COP], b: [[8, 6, 74, 46, 'a'], [44, 42, 48, 32, 'b']], t: [8, 78, 84, 14, 'Golden Hour', 'Write your caption here', '#fbe7d0', '#c2703a', 'left'] }
  ];

  var BGC = [
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
  ].map(function (x, i) { var n = x.n; delete x.n; return { n: n, r: 'classic', seed: 3101 + i, p: x }; });
  // Classic frames: the first set's page backgrounds. The photo boxes, words and metal rings are the same as the premium frame of the same number.
  var FRC = [
    { n: 'Ivory Duo', base: '#f3efe6' },
    { n: 'Midnight Trio', base: '#0b1020', bl: 30, blobs: [[80, 90, 110, 70, '#22d3a0', .6], [240, 230, 100, 90, '#7c3aed', .7], [90, 370, 120, 60, '#06b6d4', .6]] },
    { n: 'Champagne Pair', base: '#f7efe0' },
    { n: 'Noir Layers', base: '#111111' },
    { n: 'Navy Mosaic', base: '#0f1a33' },
    { n: 'Emerald Diagonal', lin: [160, '#052e25', '#0b5a47'] },
    { n: 'Pearl Triptych', lin: [180, '#f1f3f6', '#dfe3e9'] },
    { n: 'Rose Blend', base: '#fff4ef', mesh: [[20, 10, '#ffd6c9', 55, 1], [90, 90, '#e8c6ff', 55, 1]] },
    { n: 'Cobalt Feature', base: '#0a1f44', mesh: [[15, 20, '#2de2e6', 50, .27], [90, 90, '#3a7bd5', 55, .4]] },
    { n: 'Copper Overlap', base: '#1a0a05', bl: 40, blobs: [[250, 60, 110, 80, '#ea580c', .45], [40, 360, 130, 80, '#b45309', .4]] }
  ].map(function (x, i) { var n = x.n; delete x.n; return { n: n, r: 'classic', seed: 3201 + i, p: x }; });

  // A style kind is 'bg' / 'fr' (premium) or 'bgc' / 'frc' (classic). A frame kind starts with f. Classic frames reuse the frame of the same number for boxes and words.
  function listOf(k) { return k === 'bg' ? BG : k === 'fr' ? FR : k === 'bgc' ? BGC : FRC; }
  function isFr(k) { return k.charAt(0) === 'f'; }
  // Draws one style onto a canvas. `seed` is optional: the same style with another seed is a "remix".
  // Tweaks (all optional): grain 'none' | 'soft' | 'rich', vignette 'none' | 'soft' | 'deep', shade -1 (darker) to 1 (lighter).
  var GM = { none: 0, soft: .5, rich: 1.7 }, VM = { none: 0, soft: .5, deep: 1.6 };
  function normOpts(o) {
    if (!o || typeof o !== 'object') return null;
    var out = {}, sh = parseFloat(o.shade);
    if (GM[o.grain] != null) out.grain = o.grain;
    if (VM[o.vignette] != null) out.vignette = o.vignette;
    if (isFinite(sh) && Math.abs(sh) >= .02) out.shade = clamp(Math.round(sh * 100) / 100, -1, 1);
    return Object.keys(out).length ? out : null;
  }
  function paintStyle(it, w, h, seed, opts) {
    var c = cv(w, h), ctx = c.getContext('2d'), o = normOpts(opts);
    CUR.gm = o && o.grain ? GM[o.grain] : 1; CUR.vm = o && o.vignette ? VM[o.vignette] : 1;
    try { R[it.r](ctx, c.width, c.height, seed == null ? it.seed : seed, it.p); } finally { CUR.gm = 1; CUR.vm = 1; }
    if (o && o.shade) { ctx.fillStyle = o.shade < 0 ? 'rgba(0,0,0,' + n2(Math.min(.6, -o.shade * .6)) + ')' : 'rgba(255,255,255,' + n2(Math.min(.5, o.shade * .5)) + ')'; ctx.fillRect(0, 0, c.width, c.height); }
    return c;
  }
  function paintDeco(ctx, f, w, h) {
    var k = Math.max(1, w / 300);
    (f.deco || []).forEach(function (e) {
      ctx.save(); ctx.strokeStyle = e.s; ctx.lineWidth = n2(k * .8);
      if (e.r) ctx.strokeRect(e.r[0] * w / 100, e.r[1] * h / 100, e.r[2] * w / 100, e.r[3] * h / 100);
      else { ctx.beginPath(); ctx.moveTo(e.l[0] * w / 100, e.l[1] * h / 100); ctx.lineTo(e.l[2] * w / 100, e.l[3] * h / 100); ctx.stroke(); }
      ctx.restore();
    });
  }
  // The page background of a style as a canvas. Frames get their fine gold lines too; photo boxes and words are real objects.
  function bgCanvas(kind, i, w, h, seed, opts) {
    var it = listOf(kind)[i], c = paintStyle(it, w, h, seed, opts);
    if (isFr(kind)) paintDeco(c.getContext('2d'), FR[i], c.width, c.height);
    return c;
  }

  // ─── Small helpers ───
  function lum(hexv) { var x = String(hexv || '#000000').replace('#', ''); return (parseInt(x.slice(0, 2), 16) * 299 + parseInt(x.slice(2, 4), 16) * 587 + parseInt(x.slice(4, 6), 16) * 114) / 1000; }
  function say(m, kind) { try { if (typeof toast === 'function') toast(m, kind || 'info'); } catch (e) {} }
  function docOpen() { try { return typeof pdfed !== 'undefined' && !!(pdfed && pdfed.pages && pdfed.pages.length); } catch (e) { return false; } }

  // ─── Photo boxes: one placed image each (metal border + soft shadow + the photo inside) ───
  // k = page width / 300. The border thickness and the shadow room are fixed multiples of k, so a box that is resized
  // is redrawn with the SAME border thickness (see refit below).
  function slotGeom(fi, j, W, H) {
    var f = FR[fi], q = f.b[j], k = W / 300, pad = f.ring[0] * W / 100, m = 12 * k;
    return { k: k, pad: pad, m: m,
      x: Math.round(q[0] * W / 100 - pad - m), y: Math.round(q[1] * H / 100 - pad - m),
      w: Math.round(q[2] * W / 100 + 2 * pad + 2 * m), h: Math.round(q[3] * H / 100 + 2 * pad + 2 * m) };
  }
  // The distance from the edge of a box to its photo window, in page pixels.
  function slotInset(fi, k) { return 12 * k + FR[fi].ring[0] * 3 * k; }

  // Draws a brushed metal frame with a bevel and a real drop shadow, and the photo (or a quiet glass window) inside.
  // The box is drawn in its own pixels (iw by ih). `im` is a loaded image or null.
  function drawSlot(ctx, fi, iw, ih, k, im) {
    var f = FR[fi], c = f.ring[1], m = 12 * k, wx = slotInset(fi, k), ww = Math.max(2, iw - 2 * wx), wh = Math.max(2, ih - 2 * wx);
    var ox = m, oy = m, ow = iw - 2 * m, oh = ih - 2 * m, r = rngOf(fi * 131 + 7), i;
    var mg = ctx.createLinearGradient(ox, oy, ox + ow, oy + oh);
    mg.addColorStop(0, c[0]); mg.addColorStop(.2, c[1]); mg.addColorStop(.4, c[2]); mg.addColorStop(.58, c[3]); mg.addColorStop(.78, c[1]); mg.addColorStop(1, c[0]);
    // contact shadow, then a long soft one
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4 * k; ctx.shadowOffsetY = 1.5 * k; ctx.fillStyle = mg; rrect(ctx, ox, oy, ow, oh, 2 * k); ctx.fill(); ctx.restore();
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.42)'; ctx.shadowBlur = 9 * k; ctx.shadowOffsetY = 4 * k; ctx.fillStyle = mg; rrect(ctx, ox, oy, ow, oh, 2 * k); ctx.fill(); ctx.restore();
    // brushed lines across the metal (only the ring is visible, the window covers the middle)
    ctx.save(); rrect(ctx, ox, oy, ow, oh, 2 * k); ctx.clip(); ctx.lineWidth = Math.max(.5, .45 * k);
    for (i = 0; i < Math.round(oh / (.85 * k)); i++) {
      var yy = oy + r() * oh; ctx.strokeStyle = r() < .5 ? 'rgba(255,255,255,' + n2(.05 + r() * .12) + ')' : 'rgba(0,0,0,' + n2(.04 + r() * .09) + ')';
      ctx.beginPath(); ctx.moveTo(ox, yy); ctx.lineTo(ox + ow, yy); ctx.stroke();
    }
    var sh = ctx.createLinearGradient(ox, oy, ox + ow, oy); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.35, 'rgba(255,255,255,.22)'); sh.addColorStop(.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.18)');
    ctx.fillStyle = sh; ctx.fillRect(ox, oy, ow, oh); ctx.restore();
    // outer bevel: light on the top left, dark on the bottom right
    var bv = ctx.createLinearGradient(ox, oy, ox + ow, oy + oh); bv.addColorStop(0, 'rgba(255,255,255,.85)'); bv.addColorStop(.45, 'rgba(255,255,255,.05)'); bv.addColorStop(.55, 'rgba(0,0,0,.05)'); bv.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.strokeStyle = bv; ctx.lineWidth = Math.max(1, 1.1 * k); rrect(ctx, ox + .6 * k, oy + .6 * k, ow - 1.2 * k, oh - 1.2 * k, 1.6 * k); ctx.stroke();
    // the window
    ctx.save(); rrect(ctx, wx, wx, ww, wh, k); ctx.clip();
    if (im && im.width) {
      var s = Math.max(ww / im.width, wh / im.height), dw = im.width * s, dh = im.height * s;
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, wx + (ww - dw) / 2, wx + (wh - dh) / 2, dw, dh);
    } else {
      // empty: a quiet frosted glass window. Nothing drawn on it, the Upload button on the page says what to do.
      var d = f.dark, wg = ctx.createLinearGradient(wx, wx, wx + ww, wx + wh);
      if (d) { wg.addColorStop(0, '#191c26'); wg.addColorStop(1, '#08090e'); } else { wg.addColorStop(0, '#efe9dc'); wg.addColorStop(1, '#d9d0bc'); }
      ctx.fillStyle = wg; ctx.fillRect(wx, wx, ww, wh);
      glow(ctx, wx + ww * .3, wx + wh * .25, Math.max(ww, wh) * .7, Math.max(ww, wh) * .7, d ? c[0] : '#ffffff', d ? .14 : .55, 'source-over');
    }
    // inner shadow along the top and left edges makes the window look recessed; a faint glass sheen crosses it
    var e1 = ctx.createLinearGradient(0, wx, 0, wx + 9 * k); e1.addColorStop(0, 'rgba(0,0,0,.42)'); e1.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = e1; ctx.fillRect(wx, wx, ww, 9 * k);
    var e2 = ctx.createLinearGradient(wx, 0, wx + 7 * k, 0); e2.addColorStop(0, 'rgba(0,0,0,.3)'); e2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = e2; ctx.fillRect(wx, wx, 7 * k, wh);
    var gs = ctx.createLinearGradient(wx, wx, wx + ww * .9, wx + wh * .9); gs.addColorStop(0, 'rgba(255,255,255,' + (im ? .07 : .1) + ')'); gs.addColorStop(.42, 'rgba(255,255,255,0)'); ctx.fillStyle = gs; ctx.fillRect(wx, wx, ww, wh);
    ctx.restore();
    // the lip where the photo meets the metal: dark on the top left, light on the bottom right
    var lp = ctx.createLinearGradient(wx, wx, wx + ww, wx + wh); lp.addColorStop(0, 'rgba(0,0,0,.55)'); lp.addColorStop(.5, 'rgba(0,0,0,.05)'); lp.addColorStop(1, 'rgba(255,255,255,.6)');
    ctx.strokeStyle = lp; ctx.lineWidth = Math.max(1, .9 * k); rrect(ctx, wx - .45 * k, wx - .45 * k, ww + .9 * k, wh + .9 * k, k); ctx.stroke();
  }
  var IMGS = {}, IMGN = [];
  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    if (IMGS[url]) return IMGS[url];
    var p = new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
    IMGS[url] = p; IMGN.push(url); if (IMGN.length > 8) delete IMGS[IMGN.shift()];
    return p;
  }
  async function slotPng(fi, j, iw, ih, k, photo) {
    var sc = Math.min(1, 2400 / Math.max(iw, ih, 1)), c = cv(iw * sc, ih * sc), ctx = c.getContext('2d'), im = await loadImg(photo);
    ctx.scale(c.width / iw, c.height / ih); drawSlot(ctx, fi, iw, ih, k, im);
    return c.toDataURL('image/png');
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
  // Letter spaced text drawn by hand (works in every browser).
  function spaced(ctx, s, x, y, sp, align, w) {
    var i, tot = 0, ws = []; for (i = 0; i < s.length; i++) { ws[i] = ctx.measureText(s[i]).width; tot += ws[i] + sp; } tot -= sp;
    var cx = align === 'center' ? x + w / 2 - tot / 2 : align === 'right' ? x + w - tot : x;
    ctx.textAlign = 'left'; for (i = 0; i < s.length; i++) { ctx.fillText(s[i], cx, y); cx += ws[i] + sp; }
  }
  function drawWords(ctx, fi, W, H, title, cap) {
    var tp = textPlan(fi, W, H, title, cap), ax = tp.align === 'center' ? tp.x + tp.w / 2 : tp.align === 'right' ? tp.x + tp.w : tp.x;
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = tp.align; ctx.fillStyle = tp.tc; ctx.font = '600 ' + n2(tp.ts) + 'px Georgia,"Times New Roman",serif';
    ctx.fillText(title, ax, tp.ty + tp.ts * .95);
    ctx.fillStyle = tp.cc; ctx.font = '500 ' + n2(tp.cs) + 'px Inter,system-ui,Arial,sans-serif';
    spaced(ctx, String(cap).toUpperCase(), tp.x, tp.cy + tp.cs * 1.05, tp.cs * .14, tp.align, tp.w);
    ctx.restore();
  }
  // A whole Photo Frame as a picture, only for the thumbnails in the panel.
  function frameThumb(i, w, h, kind) {
    var f = FR[i], c = bgCanvas(kind || 'fr', i, w, h), ctx = c.getContext('2d'), k = c.width / 300;
    f.b.forEach(function (q, j) { var g = slotGeom(i, j, c.width, c.height); ctx.save(); ctx.translate(g.x, g.y); drawSlot(ctx, i, g.w, g.h, g.k, null); ctx.restore(); });
    drawWords(ctx, i, c.width, c.height, f.t[4], String(f.t[5]));
    return c;
  }

  // ─── Read pictures ───
  function pageSize() {
    var c = document.getElementById('pdfedPageCanvas'), ok = c && c.width > 200 && c.height > 200, w = ok ? c.width : 1654, h = ok ? c.height : 2339, k = Math.min(1, 2400 / Math.max(w, h));
    return [Math.round(w * k), Math.round(h * k)];
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
  function snap(pg) { return { sty: pg._pcsStyle, dataUrl: pg.dataUrl, edits: Object.assign({}, pg.edits || {}), imgs: (pg.placedImages || []).slice(), txts: (pg.placedTexts || []).slice(), modified: pg.modified }; }
  function restore(pg, s) { pg._pcsStyle = s.sty; pg.dataUrl = s.dataUrl; pg.edits = Object.assign({}, s.edits); pg.placedImages = s.imgs.slice(); pg.placedTexts = s.txts.slice(); pg.modified = true; }

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

  function nextFrame() { return new Promise(function (r) { if (window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(r, 0); }); else setTimeout(r, 0); }); }

  // ─── Add a style to the page (or to a brand new page when the editor is empty) ───
  // seed is optional. Without it the style looks exactly like its thumbnail. With it the same style gets a new pattern.
  // opts is optional too: { grain, vignette, shade } (see normOpts). The panel never passes either; Kadessa does (js/92).
  async function applyStyle(kind, i, seed, opts) {
    if (STY.busy) return;
    var list = listOf(kind);
    if (!list || !list[i] || typeof pdfedBakeCanvasTintOntoPage !== 'function') return;
    STY.busy = true; document.body.style.cursor = 'progress';
    try {
      if (typeof wsbEnsureEditorOpen === 'function') wsbEnsureEditorOpen();
      var made = false, pg;
      if (!docOpen()) { pg = await makeDoc(); made = true; } else pg = pdfed.pages[pdfed.active];
      var idx = pdfed.pages.indexOf(pg), before = made ? null : snap(pg);
      if (pdfed.active !== idx) await pdfedGoto(idx);
      var cvs = document.getElementById('pdfedPageCanvas'), W = cvs.width, H = cvs.height, z = pageSize();
      await nextFrame();
      var tw = normOpts(opts), url = bgCanvas(kind, i, z[0], z[1], seed, tw).toDataURL('image/jpeg', .94);
      await pdfedBakeCanvasTintOntoPage(pg, { mode: 'image', imageDataUrl: url, imageFit: 'stretch', opacity: 100, color1: '#FFFFFF', color2: '#FFFFFF', angle: 90 });
      if (isFr(kind)) { var keep = takeOld(pg); await addFrameObjects(pg, i, W, H, keep); }
      await pdfedGoto(idx); await pdfedBuildStrip();
      pdfedMarkModified(idx);
      // keep the Canvas Color panel in step (its All Pages button then paints the same background), and hide its live preview
      try { var s = pdfedCanvasTintState; s.mode = 'image'; s.imageFit = 'stretch'; s.imageDataUrl = url; s.opacity = 100; pdfedCanvasSyncControls(); var live = pdfedCanvasTintPreviewEl(); if (live) live.style.display = 'none'; } catch (e) {}
      pg._pcsStyle = { k: kind, i: i, seed: seed == null ? list[i].seed : seed, opts: tw, baked: pg.dataUrl };
      STY.cur = { k: kind, i: i, seed: seed == null ? list[i].seed : seed, opts: tw }; renderAll();
      say(!isFr(kind) ? list[i].n + ' added to the page' : list[i].n + ' added. Click a photo box to add your picture, double click the title to type.', 'success');
      var after = snap(pg);
      pushAppHistory({
        label: 'Add style: ' + (kind.length > 2 ? 'Classic ' : '') + list[i].n,
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
    var up = document.createElement('span'); up.className = 'pcs-up'; up.style.fontSize = Math.round(fs * 1.25) + 'px'; up.textContent = '↑'; btn.appendChild(up);
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
  // Thumbnails are real renders of the same styles, drawn one at a time so the panel never freezes.
  var THUMB = {}, thumbQ = [], thumbRun = false;
  function thumbUri(kind, i) {
    var key = kind + i; if (THUMB[key]) return THUMB[key];
    var c = isFr(kind) ? frameThumb(i, 270, 360, kind) : bgCanvas(kind, i, 270, 360);
    return (THUMB[key] = c.toDataURL('image/jpeg', .88));
  }
  function pumpThumbs() {
    if (thumbRun) return; thumbRun = true;
    (function step() {
      var job = thumbQ.shift();
      if (!job) { thumbRun = false; return; }
      try { if (job.img.isConnected !== false) { job.img.src = thumbUri(job.kind, job.i); job.img.parentNode.classList.add('rdy'); } } catch (e) {}
      setTimeout(step, 16);
    })();
  }
  function curKind() { return STY.tab + (STY.set === 'cls' ? 'c' : ''); }
  function fillThumbs(host, tab) {
    if (!host) return;
    var bg = !isFr(tab), list = listOf(tab);
    host.className = 'pcs-grid' + (bg ? '' : ' fr');
    host.innerHTML = ''; thumbQ = [];
    list.forEach(function (it, i) {
      var b = document.createElement('div'); b.setAttribute('role', 'button'); b.tabIndex = 0; b.draggable = true; b.title = it.n + ': click to add, or drag onto the page';
      b.className = 'pcs-th' + (STY.cur && STY.cur.k === tab && STY.cur.i === i ? ' on' : '') + (THUMB[tab + i] ? ' rdy' : '');
      b.innerHTML = '<img alt="" draggable="false" ' + (THUMB[tab + i] ? 'src="' + THUMB[tab + i] + '"' : '') + '><span>' + esc(it.n) + '</span>';
      if (!THUMB[tab + i]) thumbQ.push({ kind: tab, i: i, img: b.firstChild });
      b.onclick = function () { applyStyle(tab, i); };
      b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyStyle(tab, i); } };
      b.ondragstart = function (e) { e.dataTransfer.setData(MIME, JSON.stringify({ k: tab, i: i })); e.dataTransfer.setData('text/plain', ''); e.dataTransfer.effectAllowed = 'copy'; var a = areaEl(); if (a) a.classList.add('pcs-dragging'); };
      b.ondragend = function () { var a = areaEl(); if (a) a.classList.remove('pcs-dragging'); };
      host.appendChild(b);
    });
    pumpThumbs();
  }
  function renderAll() { fillThumbs(document.getElementById('pcsGrid'), curKind()); }
  function setTab(t) {
    STY.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.pcs-seg button[data-t]'), function (x) { x.classList.toggle('on', x.getAttribute('data-t') === t); });
    renderAll();
  }
  function setSet(v) {
    STY.set = v;
    Array.prototype.forEach.call(document.querySelectorAll('.pcs-seg button[data-s]'), function (x) { x.classList.toggle('on', x.getAttribute('data-s') === v); });
    renderAll();
  }
  function segHtml() { return '<div class="pcs-seg"><button type="button" class="' + (STY.tab === 'bg' ? 'on' : '') + '" data-t="bg">Backgrounds</button><button type="button" class="' + (STY.tab === 'fr' ? 'on' : '') + '" data-t="fr">Photo Frames</button></div>'; }
  function setHtml() { return '<div class="pcs-seg pcs-set"><button type="button" class="' + (STY.set === 'pro' ? 'on' : '') + '" data-s="pro">Premium</button><button type="button" class="' + (STY.set === 'cls' ? 'on' : '') + '" data-s="cls">Classic</button></div>'; }
  function wireSeg(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.pcs-seg button[data-t]'), function (b) { b.onclick = function () { setTab(b.getAttribute('data-t')); }; });
    Array.prototype.forEach.call(root.querySelectorAll('.pcs-seg button[data-s]'), function (b) { b.onclick = function () { setSet(b.getAttribute('data-s')); }; });
  }
  function inject() {
    if (document.getElementById('pcs')) return;
    var looks = document.getElementById('pdsLooks'); if (!looks || !looks.parentNode) return;
    var sec = document.createElement('div'); sec.id = 'pcs'; sec.className = 'pcs';
    sec.innerHTML = '<div class="pds-looks-head"><label class="pdfed-ctint-label">Styles <i class="pcs-new">NEW</i></label></div>' + setHtml() + segHtml() +
      '<div class="pcs-grid" id="pcsGrid"></div>' +
      '<p class="pcs-hint">Premium is the new look, Classic is the first set. Click a style to add it to your page, or drag it onto the page. Photo Frames give you photo boxes on the page: click a box to add your picture, double click the title to type.</p>';
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
      if (d && /^(bg|fr)c?$/.test(d.k)) applyStyle(d.k, +d.i);
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
  // The style Kadessa (or the panel) last put on the open page, or null when the page has none or was changed since.
  function current() {
    try {
      var pg = docOpen() ? pdfed.pages[pdfed.active] : null, c = pg && pg._pcsStyle;
      if (!c || c.baked !== pg.dataUrl) return null;
      var it = listOf(c.k)[c.i]; if (!it) return null;
      return { kind: isFr(c.k) ? 'frame' : 'background', set: c.k.length > 2 ? 'classic' : 'premium', index: c.i, name: it.n, seed: c.seed, isDefaultLook: c.seed === it.seed, tweaks: c.opts || null };
    } catch (e) { return null; }
  }
  window.pdfedCanvasStyles = { current: current, normOpts: normOpts, bg: BG, frames: FR, classicBg: BGC, classicFrames: FRC, renderers: R, paint: paintStyle, bgCanvas: bgCanvas, frameThumb: frameThumb, drawSlot: drawSlot, slotGeom: slotGeom, slotInset: slotInset, textPlan: textPlan,
    rngOf: rngOf, noiseFn: noiseFn, lutOf: lutOf, apply: applyStyle };
})();
