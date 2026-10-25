// ─── WORKSTYLE VISION: CLONE A FLATTENED PAGE WITH KADESSA'S EYES ───────────
// A flattened reference (a picture file, a scanned PDF, a PDF made of pictures) has no text objects, no fonts and no
// shapes to read. Local OCR gives the words and the pixel reader (js/70) gives boxes, but neither knows what a font looks
// like, what a leaf sprig is, or what a garbled script line really says.
//
// Here Kadessa LOOKS at the page (Worker mode "workstyle_vision") and returns every line of text exactly as written,
// its look (font family guess, weight, italic), plus boxes, rules and picture spots. This file merges that with what the
// local readers already found:
//
//   - WORDS:      Kadessa's text wins (she reads a script line or an accent that OCR gets wrong).
//   - POSITIONS:  OCR's measured geometry wins where a line was found by both (OCR is pixel exact, a model is not).
//                 A line only Kadessa saw is placed from her box.
//   - FONT:       Kadessa's family guess, snapped to the closest font the editor has (wstyleNearestFont).
//   - SHAPES AND PICTURE SPOTS: the pixel reader's are kept (exact), Kadessa's are added only where it found nothing.
//
// ONLY flattened pages and pictures take this path (js/60 calls it when the page had no real text). A PDF with a real
// text layer is never sent anywhere. If Kadessa cannot be reached (not signed in, daily limit, offline, a bad answer)
// everything falls back, silently, to the local reading that was already there.
//
// Units: the page is W x H PDF points. Kadessa's numbers are fractions of the picture (0 to 1).

const WSV_IMG_LONG = 1568;            // long side of the picture sent, in pixels
const WSV_IMG_MAX_CHARS = 7500000;    // the Worker refuses data URLs over 8,000,000 characters

// ─── small helpers ───────────────────────────────────────────────────────────
function wsvNorm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
// Dice coefficient on letter pairs: 1 = same, 0 = nothing alike. Tolerates OCR slips.
function wsvSimilar(a, b) {
  a = wsvNorm(a); b = wsvNorm(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a.indexOf(b) >= 0 || b.indexOf(a) >= 0 ? 0.6 : 0;
  const pairs = function (s) { const m = {}; for (let i = 0; i < s.length - 1; i++) { const p = s.substr(i, 2); m[p] = (m[p] || 0) + 1; } return m; };
  const pa = pairs(a), pb = pairs(b);
  let hit = 0;
  Object.keys(pa).forEach(function (k) { if (pb[k]) hit += Math.min(pa[k], pb[k]); });
  return (2 * hit) / ((a.length - 1) + (b.length - 1));
}
function wsvMedian(arr) {
  const a = arr.slice().sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function wsvIou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const iw = x1 - x0, ih = y1 - y0;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// The editor font for one of Kadessa's lines. Her family guess first (exact or close by name), then her "kind".
function wsvFontFor(line) {
  const kindWord = { serif: 'serif', mono: 'mono', script: 'script', rounded: 'rounded', condensed: 'condensed', display: 'heavy display', slab: 'slab' }[line.kind] || '';
  if (typeof wstyleFontKnown === 'function' && line.family) {
    const exact = wstyleFontKnown(line.family);
    if (exact) return exact;
  }
  if (typeof wstyleNearestFont !== 'function') return 'Inter';
  // The kind word leads, so "serif Cormorant Garamond" lands on a serif the editor has, not on the default sans.
  return wstyleNearestFont(kindWord ? kindWord + ' ' + (line.family || '') : (line.family || 'Inter'));
}

// ─── the merge of words, fonts and positions ─────────────────────────────────
// runs: the OCR words ({ str, x, base, w, size, font, bold, italic }, points).
// vis: Kadessa's cleaned answer (fractions). Returns { runs, stats } where runs is a new list, one run per visual line.
function wstyleVisionMerge(runs, vis, W, H) {
  runs = runs || [];
  const lines = ((vis && vis.lines) || []).map(function (L) {
    return { src: L, text: L.text, x: L.x * W, y: L.y * H, w: L.w * W, h: L.h * H };
  });
  const pics = ((vis && vis.pictures) || []).map(function (q) { return { x: q.x * W, y: q.y * H, w: q.w * W, h: q.h * H }; });
  const stats = { lines: lines.length, matched: 0, added: 0, kept: 0, dropped: 0 };

  // 1. each OCR word goes to the ONE line it sits in (nearest centre line wins when two overlap).
  const owner = runs.map(function () { return -1; });
  runs.forEach(function (r, i) {
    const cx = r.x + (r.w || 0) / 2, cy = r.base - (r.size || 12) * 0.35;
    let best = -1, bestD = Infinity;
    lines.forEach(function (L, li) {
      const padY = Math.max(L.h * 0.3, 2), padX = Math.max(W * 0.008, 3);
      if (cx < L.x - padX || cx > L.x + L.w + padX || cy < L.y - padY || cy > L.y + L.h + padY) return;
      const d = Math.abs(cy - (L.y + L.h / 2)) + Math.abs(cx - (L.x + L.w / 2)) * 0.02;
      if (d < bestD) { bestD = d; best = li; }
    });
    owner[i] = best;
  });

  const out = [];
  lines.forEach(function (L, li) {
    const mine = [];
    runs.forEach(function (r, i) { if (owner[i] === li) mine.push(r); });
    mine.sort(function (a, b) { return a.x - b.x; });
    const bold = L.src.weight === 'bold';
    const font = wsvFontFor(L.src);
    const ocrText = mine.map(function (r) { return r.str; }).join(' ');
    const trust = mine.length && wsvSimilar(L.text, ocrText) >= 0.25;      // OCR saw the same words: its geometry is exact
    let x, base, size, w;
    if (trust) {
      x = Math.min.apply(null, mine.map(function (r) { return r.x; }));
      const right = Math.max.apply(null, mine.map(function (r) { return r.x + (r.w || 0); }));
      w = Math.max(right - x, 4);
      base = wsvMedian(mine.map(function (r) { return r.base; }));
      size = wsvMedian(mine.map(function (r) { return r.size; }));
      stats.matched++;
    } else {
      size = Math.max(6, L.h * 0.78);                                     // a line box hugs the ink: cap height is about 0.78 of it
      x = L.x; w = Math.max(L.w, 4); base = L.y + L.h * 0.82;
      stats.added++;
    }
    out.push({ str: L.text, x: x, base: base, w: w, size: size, font: font, bold: bold, italic: L.src.italic === true, ls: 0,
      _vis: true, _trust: !!trust, _kind: L.src.kind, _family: L.src.family || '', _spacing: L.src.spacing || 'normal' });
  });

  // 2. OCR words nobody claimed: noise from photos, or a real line Kadessa skipped. Keep real-looking words that are
  //    not sitting on a picture.
  runs.forEach(function (r, i) {
    if (owner[i] !== -1) return;
    const cx = r.x + (r.w || 0) / 2, cy = r.base - (r.size || 12) * 0.35;
    const onPic = pics.some(function (q) { return cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h; });
    const alnum = (String(r.str).match(/[\p{L}\p{N}]/gu) || []).length;
    if (onPic || alnum < 2) { stats.dropped++; return; }
    out.push(r);
    stats.kept++;
  });
  return { runs: out, stats: stats };
}

// ─── boxes, rules and picture spots Kadessa saw that the pixel reader did not ─
// existing: the shapes / slots already found, in points. Returns only the NEW ones, in points, in the shape js/60 uses.
function wstyleVisionNewShapes(vis, W, H, existing) {
  const out = [];
  const have = (existing || []).map(function (s) { return { x: s.x, y: s.y, w: s.w, h: s.h, rule: !!s.rule }; });
  const taken = function (r, isRule) {
    return have.some(function (e) {
      if (isRule && e.rule) {
        const vertical = r.h > r.w;
        return vertical ? (Math.abs((e.x + e.w / 2) - (r.x + r.w / 2)) < W * 0.01 && Math.min(e.y + e.h, r.y + r.h) - Math.max(e.y, r.y) > r.h * 0.5)
                        : (Math.abs((e.y + e.h / 2) - (r.y + r.h / 2)) < H * 0.008 && Math.min(e.x + e.w, r.x + r.w) - Math.max(e.x, r.x) > r.w * 0.5);
      }
      return wsvIou(e, r) > 0.35;
    });
  };
  ((vis && vis.boxes) || []).forEach(function (b) {
    if (b.w > 0.97 && b.h > 0.97) return;                                // that is the page itself
    const r = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
    if (taken(r, false)) return;
    const small = Math.min(r.w, r.h);
    const circle = b.shape === 'circle';
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h,
      fill: b.grad ? b.grad.c1 : b.fill, stroke: b.stroke, sw: b.stroke ? Math.max(0.5, b.strokeW * W) : 0,
      rule: false, r: circle ? 0 : b.radius * small, grad: b.grad ? { c1: b.grad.c1, c2: b.grad.c2, dir: b.grad.dir } : null,
      geom: circle ? 'ellipse' : null });
  });
  ((vis && vis.rules) || []).forEach(function (u) {
    const dx = Math.abs(u.x2 - u.x1) * W, dy = Math.abs(u.y2 - u.y1) * H;
    const t = Math.max(0.6, u.thickness * W);
    let r;
    if (dy <= Math.max(2, dx * 0.05)) r = { x: Math.min(u.x1, u.x2) * W, y: ((u.y1 + u.y2) / 2) * H - t / 2, w: Math.max(dx, 2), h: t };
    else if (dx <= Math.max(2, dy * 0.05)) r = { x: ((u.x1 + u.x2) / 2) * W - t / 2, y: Math.min(u.y1, u.y2) * H, w: t, h: Math.max(dy, 2) };
    else return;                                                         // slanted lines are left to the pixel reader
    if (taken(r, true)) return;
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h, fill: u.color, stroke: null, sw: 0, rule: true, r: 0, grad: null, geom: null });
  });
  return out;
}

function wstyleVisionNewSlots(vis, W, H, existing) {
  const out = [];
  const have = (existing || []).slice();
  ((vis && vis.pictures) || []).forEach(function (q) {
    const r = { x: q.x * W, y: q.y * H, w: q.w * W, h: q.h * H };
    if (r.w * r.h < W * H * 0.004) return;                               // a speck, not a picture spot
    if (have.some(function (e) { return wsvIou(e, r) > 0.3; })) return;  // the pixel reader already has it, with exact edges
    const slot = { x: r.x, y: r.y, w: r.w, h: r.h, full: false };
    out.push(slot); have.push(slot);
  });
  return out;
}

// ─── closer fonts and letter-spacing ─────────────────────────────────────────
// Kadessa's family guess is only a guess, and a font the editor does not have is swapped for another. So the font is
// MEASURED, not just named: for every look (family guess + kind + weight) the editor's fonts of that kind are tried on
// the lines OCR measured exactly, and the one whose text width comes closest to the picture wins. Her own guess gets a head start.
// Then, with the font chosen, a line that is still wider than the font makes it is LETTER-SPACED: the extra width,
// spread over the gaps between letters, is the spacing (stored in em, as the editor's text boxes keep it).
const WSV_CANDIDATES = {
  sans: ['Inter', 'Montserrat', 'Poppins', 'Raleway', 'Lato', 'Open Sans', 'Roboto', 'Work Sans', 'DM Sans', 'Manrope', 'Jost', 'Outfit', 'Figtree', 'Nunito Sans', 'Karla', 'Libre Franklin', 'Josefin Sans', 'Questrial', 'Mulish', 'Urbanist', 'Public Sans', 'Hanken Grotesk'],
  serif: ['Playfair Display', 'Cormorant Garamond', 'Cormorant', 'EB Garamond', 'Lora', 'Merriweather', 'Libre Baskerville', 'Crimson Text', 'PT Serif', 'Noto Serif', 'Spectral', 'Cinzel', 'Marcellus', 'DM Serif Display', 'Gilda Display', 'Source Serif Pro', 'Vollkorn', 'Cardo', 'Newsreader', 'Frank Ruhl Libre'],
  mono: ['Source Code Pro', 'JetBrains Mono', 'Courier Prime'],
  script: ['Pacifico', 'Yellowtail', 'Caveat', 'Lobster', 'Shadows Into Light', 'Kalam', 'Dancing Script', 'Great Vibes', 'Sacramento', 'Satisfy'],
  rounded: ['Nunito', 'Varela Round', 'Comfortaa', 'Quicksand', 'Fredoka', 'M PLUS Rounded 1c'],
  condensed: ['Oswald', 'Roboto Condensed', 'Saira Condensed', 'Teko', 'Khand', 'Yanone Kaffeesatz', 'Francois One', 'Bebas Neue'],
  display: ['Archivo Black', 'Anton', 'Abril Fatface', 'Bebas Neue', 'Alfa Slab One', 'Righteous', 'Passion One'],
  slab: ['Zilla Slab', 'Bitter', 'Arvo', 'Rokkitt', 'Aleo', 'Hepta Slab']
};
const WSV_MAX_CANDIDATES = 14;           // fonts tried per look
const WSV_FIT_LIMIT = 0.22;              // average width error (log scale) above which no candidate counts as a fit

// Fonts of one kind the editor really has, her own family first.
function wsvCandidates(kind, family) {
  const known = (typeof wstyleFontKnown === 'function') ? wstyleFontKnown : function (n) { return n; };
  const out = [];
  const add = function (n) { const k = known(n); if (k && out.indexOf(k) < 0) out.push(k); };
  if (family) add(family);
  (WSV_CANDIDATES[kind] || WSV_CANDIDATES.sans).forEach(add);
  return out.slice(0, WSV_MAX_CANDIDATES);
}
function wsvChars(s) { return Array.from(String(s || '').replace(/\s+/g, ' ').trim()).length; }
function wsvIsWide(s) { return s === 'wide' || s === 'very_wide'; }

// Pure core. runs: the merged runs. measure(font, size, bold, italic, text) -> text width in the same units as run.w, or 0 if unknown.
// Sets run.font and run.ls (em). Returns { looks, fitted, tracked }.
function wsvRefine(runs, measure) {
  const looks = {};
  runs.forEach(function (r) {
    if (!r._vis) return;
    const key = [String(r._family || '').toLowerCase(), r._kind || 'sans', r.bold ? 1 : 0, r.italic ? 1 : 0].join('|');
    (looks[key] = looks[key] || []).push(r);
  });
  const stats = { looks: 0, fitted: 0, tracked: 0 };
  Object.keys(looks).forEach(function (key) {
    const g = looks[key], first = g[0];
    stats.looks++;
    // 1. the font: width-fit on lines OCR measured exactly and that are not letter-spaced
    let chosen = wsvFontFor({ family: first._family, kind: first._kind });
    const plain = g.filter(function (r) { return r._trust && !wsvIsWide(r._spacing) && r._spacing !== 'tight' && wsvChars(r.str) >= 4 && r.w > 0; });
    if (plain.length) {
      let best = null, bestErr = Infinity;
      wsvCandidates(first._kind, first._family).forEach(function (font) {
        let err = 0, wsum = 0;
        plain.forEach(function (r) {
          const w = measure(font, r.size, r.bold, r.italic, r.str);
          if (!(w > 0)) return;
          const wt = Math.min(40, wsvChars(r.str));
          err += Math.abs(Math.log(w / r.w)) * wt; wsum += wt;
        });
        if (!wsum) return;
        err /= wsum;
        if (first._family && font.toLowerCase() === String(first._family).toLowerCase()) err *= 0.85;
        if (err < bestErr) { bestErr = err; best = font; }
      });
      if (best && bestErr < WSV_FIT_LIMIT) { chosen = best; stats.fitted++; }
    }
    g.forEach(function (r) { r.font = chosen; });
    // 2. the spacing: what the line has beyond the font's own width, per gap between letters
    const groups = {};
    g.forEach(function (r) {
      const n = wsvChars(r.str);
      if (n < 3 || !(r.w > 0)) return;
      const w = measure(chosen, r.size, r.bold, r.italic, r.str);
      if (!(w > 0)) return;
      const em = (r.w - w) / ((n - 1) * r.size);
      const wide = wsvIsWide(r._spacing), tight = r._spacing === 'tight';
      const ok = (wide && em >= 0.03 && em <= 0.8) ||                       // she said spaced out, and it measures that way
                 (!wide && !tight && r._trust && em >= 0.12 && em <= 0.8) || // she called it normal, but it is clearly spaced
                 (tight && em <= -0.01 && em >= -0.08);
      if (!ok) return;
      const sk = wide || (!tight && em >= 0.12) ? 'w' : 't';
      (groups[sk] = groups[sk] || []).push({ r: r, em: em });
    });
    Object.keys(groups).forEach(function (sk) {
      const med = Math.round(wsvMedian(groups[sk].map(function (x) { return x.em; })) * 100) / 100;   // the same look shares one spacing
      groups[sk].forEach(function (x) { x.r.ls = med; stats.tracked++; });
    });
  });
  return stats;
}

// The browser half: loads the candidate fonts, then measures text on a canvas. Never throws; returns null when it cannot run.
async function wstyleVisionRefine(runs) {
  if (typeof document === 'undefined') return null;
  try {
    const vis = runs.filter(function (r) { return r._vis; });
    if (!vis.length) return null;
    const need = [];
    vis.forEach(function (r) { wsvCandidates(r._kind, r._family).forEach(function (f) { if (need.indexOf(f) < 0) need.push(f); }); });
    if (typeof pdfedKadessaEnsureFont === 'function') {
      await Promise.race([
        Promise.all(need.slice(0, 36).map(function (f) { return Promise.resolve(pdfedKadessaEnsureFont(f)).catch(function () {}); })),
        new Promise(function (res) { setTimeout(res, 9000); })
      ]);
    }
    const cx = document.createElement('canvas').getContext('2d');
    const css = function (font, size, bold, italic) { return (italic ? 'italic ' : '') + (bold ? '700 ' : '400 ') + size + 'px ' + font; };
    const measure = function (font, size, bold, italic, text) {
      cx.font = css('"' + font + '", sans-serif', size, bold, italic);
      const w = cx.measureText(text).width;
      cx.font = css('sans-serif', size, bold, italic);
      const base = cx.measureText(text).width;
      // exactly the plain sans-serif width means the font never arrived: it says nothing, so it is skipped
      return (Math.abs(w - base) < 1e-6 && !/^(arial|arimo|helvetica|inter)$/i.test(font)) ? 0 : w;
    };
    return wsvRefine(runs, measure);
  } catch (e) { return null; }
}

// ─── ask Kadessa ─────────────────────────────────────────────────────────────
// Draws the flattened page big enough to read and returns it as a JPEG data URL under the Worker's size limit.
async function wstyleVisionImage(pdfPage, W, H) {
  const k = WSV_IMG_LONG / Math.max(W, H);
  const vp = pdfPage.getViewport({ scale: k });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  await pdfPage.render({ canvasContext: x, viewport: vp }).promise;
  let q = 0.9, url = c.toDataURL('image/jpeg', q);
  while (url.length > WSV_IMG_MAX_CHARS && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
  if (url.length > WSV_IMG_MAX_CHARS) throw new Error('that page is too large to send');
  return url;
}

// Returns Kadessa's cleaned answer (fractions) or throws. The caller catches and falls back to the local reading.
async function wstyleVisionRead(pdfPage, W, H, ocrRuns) {
  const call = (typeof window !== 'undefined') ? window.kadessaWorkstyleVisionCall : null;
  if (typeof call !== 'function') throw new Error('Kadessa is not available here');
  const img = await wstyleVisionImage(pdfPage, W, H);
  const hints = (ocrRuns || []).slice(0, 260).map(function (r) {
    const size = r.size || 12;
    return { t: String(r.str || '').slice(0, 80), x: +(r.x / W).toFixed(3), y: +((r.base - size * 0.95) / H).toFixed(3),
      w: +Math.max(0.004, (r.w || size * 0.6) / W).toFixed(3), h: +Math.max(0.004, size * 1.25 / H).toFixed(3) };
  });
  const vis = await call(img, hints);
  if (!vis || typeof vis !== 'object' || !Array.isArray(vis.lines)) throw new Error('the answer had no page in it');
  return vis;
}
