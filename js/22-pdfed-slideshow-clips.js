// ─── SLIDESHOW PREVIEW ───────────────────────────────────────────────────
// A smooth, autoplaying, full-screen preview of whichever pages are
// currently picked in the export modal (all pages, or the custom range
// someone typed). Two stacked <img> layers crossfade into each other so
// there's never a flash/pop between slides, each freshly-composed page
// image is prefetched one slide ahead of when it's needed so autoplay never
// stalls waiting on a render, and a slow continuous "Ken Burns" zoom on the
// active image is what actually sells the smoothness.
/* ===== PAGE TRANSITIONS (build 273) =====
   pdfed.pages[i].animAfter = {type, speed}: plays when moving from page i to i+1.
   ONE canvas renderer (pdfedFxRender) draws every effect, used by Present mode,
   Export Clip and the picker tiles, so what you preview is what the video gets.
   Saved with the document (pdfedPersist). Never written into a normal PDF. */
const PDFED_ANIM_TYPES = [
  {id:'none',name:'None (cut)'},{id:'fade',name:'Fade'},{id:'slide',name:'Slide'},{id:'push',name:'Push'},
  {id:'slideup',name:'Rise'},{id:'zoom',name:'Zoom'},{id:'wipe',name:'Wipe'},{id:'flip',name:'Flip'},
  {id:'cube',name:'Cube',sig:1},{id:'pageturn',name:'Page Turn',sig:1},{id:'scanner',name:'Scanner',sig:1},
  {id:'ink',name:'Ink Bloom',sig:1},{id:'blinds',name:'Shutter',sig:1},{id:'stamp',name:'Stamp',sig:1},{id:'pixel',name:'Pixelate',sig:1}
];
const PDFED_ANIM_SPEEDS = { fast: 450, normal: 800, slow: 1400 };

function pdfedAnimGet(pg) {
  if (!pg || !pg.animAfter || !pg.animAfter.type) return null;
  const a = pg.animAfter;
  const sp = PDFED_ANIM_SPEEDS[a.speed] ? a.speed : 'normal';
  let ms = PDFED_ANIM_SPEEDS[sp];
  if (typeof a.ms === 'number' && a.ms >= 150 && a.ms <= 4000) ms = a.ms; // Kadessa can pick an exact duration
  return { type: a.type, speed: sp, ms: ms, spec: a.spec || null, label: a.label || '' };
}
function pdfedAnimHasAny() {
  const n = pdfed.pages.length;
  return pdfed.pages.some(function (p, i) { return i < n - 1 && p.animAfter && p.animAfter.type && p.animAfter.type !== 'none'; });
}
function pdfedAnimName(id) { const t = PDFED_ANIM_TYPES.find(function (x) { return x.id === id; }); return t ? t.name : (id === 'custom' ? 'Custom' : id); }
function pdfedAnimTitle(fx) { return fx && fx.label ? fx.label : pdfedAnimName(fx ? fx.type : ''); }
function pdfedAnimFormatLabel() {
  let m = ''; try { m = pdfedClipPickMime(); } catch (e) {}
  if (m.indexOf('mp4') !== -1) return 'MP4 video clip';
  return m ? 'video clip (WebM on this browser)' : 'video clip';
}
function pdfedAnimNoticeText() {
  return 'Transitions play in Present mode and in the exported ' + pdfedAnimFormatLabel() + '. They are not saved inside a normal PDF.';
}
function pdfedAnimSet(idxs, type, speed, extra) {
  const n = pdfed.pages.length;
  idxs.forEach(function (i) {
    if (i >= 0 && i < n - 1) {
      const a = { type: type, speed: speed || 'normal' };
      if (type === 'custom' && extra && extra.spec) a.spec = extra.spec;
      if (extra && extra.label) a.label = String(extra.label).slice(0, 40);
      if (extra && extra.ms) a.ms = extra.ms;
      pdfed.pages[i].animAfter = a;
    }
  });
  pdfedAnimAfterChange(type !== 'none');
}
function pdfedAnimClear(idxs) {
  idxs.forEach(function (i) { if (pdfed.pages[i]) delete pdfed.pages[i].animAfter; });
  pdfedAnimAfterChange(false);
}
function pdfedAnimAfterChange(showNotice) {
  let seen = false;
  try { seen = localStorage.getItem('sarvarcAnimNoticeSeen') === '1'; } catch (e) {}
  if (showNotice && !seen) {
    try { localStorage.setItem('sarvarcAnimNoticeSeen', '1'); } catch (e) {}
    try { toast(pdfedAnimNoticeText(), 'info'); } catch (e) {}
  }
  try { pdfedPersist(); } catch (e) {}
  try { pdfedBuildStrip(); } catch (e) {}
  try { pdfedAnimUpdateExportWarn(typeof pdfedExportModalFmt !== 'undefined' ? pdfedExportModalFmt : 'pdf'); } catch (e) {}
}

/* ---------- renderer ---------- */
let _pdfedFxOffCv = null;
function pdfedFxOff(w, h) {
  if (typeof document === 'undefined') return null;
  if (!_pdfedFxOffCv) _pdfedFxOffCv = document.createElement('canvas');
  _pdfedFxOffCv.width = w; _pdfedFxOffCv.height = h; return _pdfedFxOffCv;
}
let _pdfedFxEaseFn = null;
function pdfedFxEase(t) { if (_pdfedFxEaseFn) return _pdfedFxEaseFn(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
const PDFED_FX_EASES = {
  linear: function (t) { return t; },
  in: function (t) { return t * t * t; },
  out: function (t) { return 1 - Math.pow(1 - t, 3); },
  snap: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
  back: function (t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};
// Logical size of a page (its ORIGINAL size even when a pre-scaled canvas stands in for it), so the
// layout maths is identical whether a full image or a light pre-scaled copy is drawn.
function pdfedFxDims(i) { if (i && i._ow) return [i._ow, i._oh]; return [i.naturalWidth || i.width || 1, i.naturalHeight || i.height || 1]; }
function pdfedFxPx(i) { return [i.naturalWidth || i.width || 1, i.naturalHeight || i.height || 1]; }
function pdfedFxFlat(ctx, img, b, alpha, sh) {
  if (!img || !b) return;
  ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (sh) { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = sh; }
  ctx.drawImage(img, b.x, b.y, b.w, b.h); ctx.restore();
}
// Draws the image on a quad (left edge xl/height hl, right edge xr/height hr): cheap fake 3D.
function pdfedFxFace(ctx, img, b, xl, xr, hl, hr, shade, sh) {
  if (!img || !(xr - xl >= 1)) return;
  const cy = b.y + b.h / 2, d = pdfedFxPx(img), iw = d[0], ih = d[1];
  function path() { ctx.beginPath(); ctx.moveTo(xl, cy - hl / 2); ctx.lineTo(xr, cy - hr / 2); ctx.lineTo(xr, cy + hr / 2); ctx.lineTo(xl, cy + hl / 2); ctx.closePath(); }
  ctx.save(); ctx.fillStyle = '#fff';
  if (sh) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = sh; }
  path(); ctx.fill(); ctx.restore();
  const n = Math.max(2, Math.min(120, Math.ceil((xr - xl) / 4)));
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, h = hl + (hr - hl) * (u0 + u1) / 2;
    ctx.drawImage(img, iw * u0, 0, iw / n, ih, xl + (xr - xl) * u0, cy - h / 2, (xr - xl) / n + 0.8, h);
  }
  if (shade > 0) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.85, shade) + ')'; path(); ctx.fill(); ctx.restore(); }
}
// lay(img, zoomT) -> {x,y,w,h}; lay.sh = shadow blur. dir: +1 forward, -1 backward. t: 0..1 linear progress.
function pdfedFxRender(ctx, cw, ch, prev, cur, t, type, dir, lay, zp, zc, spec) {
  const e = pdfedFxEase(t), sh = lay.sh || 0, PI = Math.PI;
  const pb = prev ? lay(prev, zp) : null, cb = lay(cur, zc), D = Math.max(cw, ch) * 1.6;
  const flat = function (img, b, a) { pdfedFxFlat(ctx, img, b, a, sh); };
  const base = function () { if (prev) flat(prev, pb, 1); };
  switch (type) {
    case 'fade': base(); flat(cur, cb, e); break;
    case 'slide': base(); ctx.save(); ctx.translate(dir * (1 - e) * cw, 0); flat(cur, cb, 1); ctx.restore(); break;
    case 'push':
      ctx.save(); ctx.translate(-dir * e * cw, 0); if (prev) flat(prev, pb, 1); ctx.restore();
      ctx.save(); ctx.translate(dir * (1 - e) * cw, 0); flat(cur, cb, 1); ctx.restore(); break;
    case 'slideup': base(); ctx.save(); ctx.translate(0, dir * (1 - e) * ch); flat(cur, cb, 1); ctx.restore(); break;
    case 'zoom': {
      base(); const s = 0.55 + 0.45 * e;
      ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(s, s); ctx.translate(-cw / 2, -ch / 2); flat(cur, cb, e); ctx.restore(); break;
    }
    case 'wipe': {
      base(); ctx.save(); ctx.beginPath(); ctx.rect(dir > 0 ? 0 : cw * (1 - e), 0, cw * e, ch); ctx.clip(); flat(cur, cb, 1); ctx.restore();
      const lx = dir > 0 ? cw * e : cw * (1 - e);
      if (lx > cb.x && lx < cb.x + cb.w) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(lx - 1, cb.y, 2, cb.h); ctx.restore(); }
      break;
    }
    case 'flip': {
      const th = e * PI, first = th < PI / 2, a = (first ? th : th - PI) * dir, b = first ? pb : cb, img = first ? prev : cur;
      if (!b || !img) { flat(cur, cb, e); break; }
      const cx = b.x + b.w / 2, c = Math.cos(a), s = Math.sin(a), hw = b.w / 2;
      const sl = D / (D + hw * s), sr = D / (D - hw * s);
      pdfedFxFace(ctx, img, b, cx - hw * c * sl, cx + hw * c * sr, b.h * sl, b.h * sr, Math.abs(s) * 0.35, sh); break;
    }
    case 'cube': {
      if (!prev) { flat(cur, cb, e); break; }
      const hw = pb.w / 2, r = hw;
      const list = [[prev, pb, -dir * e * PI / 2], [cur, cb, dir * (1 - e) * PI / 2]].map(function (f) {
        const a = f[2], c = Math.cos(a), s = Math.sin(a);
        return { img: f[0], b: f[1], a: a, c: c, s: s, z: r * c - r, cx: f[1].x + f[1].w / 2 };
      }).sort(function (p, q) { return p.z - q.z; });
      list.forEach(function (f) {
        const zl = hw * f.s + r * f.c - r, zr = -hw * f.s + r * f.c - r, sl = D / (D - zl), sr = D / (D - zr);
        pdfedFxFace(ctx, f.img, f.b, f.cx + (-hw * f.c + r * f.s) * sl, f.cx + (hw * f.c + r * f.s) * sr, f.b.h * sl, f.b.h * sr, 0.55 * Math.abs(f.s), sh);
      });
      break;
    }
    case 'pageturn': {
      if (!prev) { flat(cur, cb, e); break; }
      flat(cur, cb, 1);
      const a = e * PI / 2, c = Math.cos(a), s = Math.sin(a), b = pb, cx = b.x + b.w / 2, sr = (D * 3) / (D * 3 - b.w * s), shd = 0.08 + 0.25 * e;
      if (dir > 0) pdfedFxFace(ctx, prev, b, b.x, cx + (b.x + b.w * c - cx) * sr, b.h, b.h * sr, shd, sh);
      else pdfedFxFace(ctx, prev, b, cx + (b.x + b.w - b.w * c - cx) * sr, b.x + b.w, b.h * sr, b.h, shd, sh);
      break;
    }
    case 'scanner': {
      base(); const yy = dir > 0 ? cb.y + cb.h * e : cb.y + cb.h * (1 - e), gh = Math.max(4, cb.h * 0.035);
      ctx.save(); ctx.beginPath(); if (dir > 0) ctx.rect(0, 0, cw, yy); else ctx.rect(0, yy, cw, ch - yy); ctx.clip(); flat(cur, cb, 1); ctx.restore();
      const g = ctx.createLinearGradient(0, yy - gh, 0, yy + gh);
      g.addColorStop(0, 'rgba(0,194,255,0)'); g.addColorStop(0.5, 'rgba(0,194,255,.55)'); g.addColorStop(1, 'rgba(0,194,255,0)');
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(cb.x, yy - gh, cb.w, gh * 2); ctx.fillStyle = 'rgba(190,242,255,.95)'; ctx.fillRect(cb.x, yy - Math.max(1, gh * 0.08), cb.w, Math.max(2, gh * 0.16)); ctx.restore(); break;
    }
    case 'ink': {
      base(); const R = Math.hypot(cb.w, cb.h) / 2 * 1.02 * e, mx = cb.x + cb.w / 2, my = cb.y + cb.h / 2;
      ctx.save(); ctx.beginPath(); ctx.arc(mx, my, Math.max(0.1, R), 0, PI * 2); ctx.clip(); flat(cur, cb, 1); ctx.restore();
      if (R > 2) { ctx.save(); ctx.strokeStyle = 'rgba(0,194,255,' + (0.7 * (1 - e)) + ')'; ctx.lineWidth = Math.max(1, cb.h * 0.012); ctx.beginPath(); ctx.arc(mx, my, R, 0, PI * 2); ctx.stroke(); ctx.restore(); }
      break;
    }
    case 'blinds': {
      base(); const N = 8, sl = cb.h / N;
      ctx.save(); ctx.beginPath();
      for (let i = 0; i < N; i++) { const y0 = cb.y + i * sl; ctx.rect(cb.x, dir > 0 ? y0 : y0 + sl * (1 - e), cb.w, sl * e); }
      ctx.clip(); flat(cur, cb, 1); ctx.restore(); break;
    }
    case 'stamp': {
      base(); const q = t * t, sc = 1 + 0.5 * (1 - q), al = Math.min(1, q * 4), sk = t > 0.86 ? Math.sin(t * 160) * (1 - t) * cb.w * 0.06 : 0;
      const mx = cb.x + cb.w / 2, my = cb.y + cb.h / 2;
      ctx.save(); ctx.translate(mx + sk, my); ctx.scale(sc, sc); ctx.translate(-mx, -my); flat(cur, cb, al); ctx.restore();
      if (t > 0.8) { const g = (t - 0.8) * cb.w * 0.4; ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - t) * 5) + ')'; ctx.lineWidth = 2; ctx.strokeRect(cb.x - g, cb.y - g, cb.w + 2 * g, cb.h + 2 * g); ctx.restore(); }
      break;
    }
    case 'pixel': {
      const firstHalf = t < 0.5 && prev, k = t < 0.5 ? t * 2 : (1 - t) * 2, blk = 1 + k * k * Math.max(6, cb.w / 8);
      const img = firstHalf ? prev : cur, b = firstHalf ? pb : cb;
      if (blk < 1.6) { flat(img, b, 1); break; }
      const ow = Math.max(2, Math.round(b.w / blk)), oh = Math.max(2, Math.round(b.h / blk)), oc = pdfedFxOff(ow, oh);
      if (!oc) { flat(img, b, 1); break; }
      oc.getContext('2d').drawImage(img, 0, 0, ow, oh);
      ctx.save(); ctx.imageSmoothingEnabled = false; if (sh) { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = sh; }
      ctx.drawImage(oc, 0, 0, ow, oh, b.x, b.y, b.w, b.h); ctx.restore(); break;
    }
    case 'custom': pdfedFxCustom(ctx, cw, ch, prev, cur, t, dir, lay, zp, zc, spec); break;
    default: flat(cur, cb, 1);
  }
}

/* ---------- custom (Kadessa-built) transitions ----------
   A custom transition is a small recipe of independent controls, so any look can be
   composed instead of picked from a fixed list. Every field is optional:
   base: reuse a preset underneath (flip/cube/pageturn/scanner/ink/blinds/stamp/pixel)
   motion: none | cover | push | reveal      direction: auto | left | right | up | down
   mask: none | wipe | iris | blinds | vblinds | checker | diagonal   bars: 2..24
   fade: 0..1 (how much the new page dissolves in)   dip: hex colour the screen dips through
   scale: start size of the new page   out_scale: end size of the old page   rotate: start angle
   ease: linear | in | out | inout | snap | back      edge: hex colour of a leading line on wipe */
function pdfedFxSpec(raw) {
  raw = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const pick = function (v, ok, d) { v = typeof v === 'string' ? v.trim().toLowerCase() : ''; return ok.indexOf(v) !== -1 ? v : d; };
  const num = function (v, lo, hi, d) { if (v === null || v === undefined || v === '') return d; v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const hex = function (v) { if (typeof v !== 'string') return ''; v = v.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) return v; const nm = { black: '#000000', white: '#ffffff' }; return nm[v.toLowerCase()] || ''; };
  const S = {
    base: pick(raw.base, ['none', 'flip', 'cube', 'pageturn', 'scanner', 'ink', 'blinds', 'stamp', 'pixel'], 'none'),
    motion: pick(raw.motion === 'slide' ? 'cover' : raw.motion, ['none', 'cover', 'push', 'reveal'], 'none'),
    dir: pick(raw.direction || raw.dir, ['auto', 'left', 'right', 'up', 'down'], 'auto'),
    mask: pick(raw.mask, ['none', 'wipe', 'iris', 'blinds', 'vblinds', 'checker', 'diagonal'], 'none'),
    bars: Math.round(num(raw.bars, 2, 24, 8)),
    fade: num(raw.fade, 0, 1, NaN),
    dip: hex(raw.dip),
    scale: num(raw.scale, 0.2, 3, 1),
    outScale: num(raw.out_scale !== undefined ? raw.out_scale : raw.outScale, 0.2, 3, 1),
    rotate: num(raw.rotate, -360, 360, 0),
    ease: pick(raw.ease, ['linear', 'in', 'out', 'inout', 'snap', 'back'], 'inout'),
    edge: hex(raw.edge)
  };
  if (isNaN(S.fade)) S.fade = (S.base === 'none' && S.motion === 'none' && S.mask === 'none') ? 1 : 0;
  return S;
}
function pdfedFxCustom(ctx, cw, ch, prev, cur, t, dir, lay, zp, zc, raw) {
  const S = pdfedFxSpec(raw), keep = _pdfedFxEaseFn, PI = Math.PI;
  _pdfedFxEaseFn = PDFED_FX_EASES[S.ease] || null;
  try {
    if (S.base !== 'none') { pdfedFxRender(ctx, cw, ch, prev, cur, t, S.base, dir, lay, zp, zc); }
    else {
      const e = pdfedFxEase(t), sh = lay.sh || 0, pb = prev ? lay(prev, zp) : null, cb = lay(cur, zc);
      const flat = function (img, b, a) { pdfedFxFlat(ctx, img, b, a, sh); };
      const vx = (S.dir === 'auto' || S.dir === 'left' ? 1 : S.dir === 'right' ? -1 : 0) * dir;
      const vy = (S.dir === 'up' ? 1 : S.dir === 'down' ? -1 : 0) * dir;
      const moves = S.motion === 'cover' || S.motion === 'push';
      const xf = function (dx, dy, sc, rot) {
        ctx.translate(cw / 2 + dx, ch / 2 + dy); if (rot) ctx.rotate(rot); if (sc !== 1) ctx.scale(sc, sc); ctx.translate(-cw / 2, -ch / 2);
      };
      const drawOut = function (a) {
        if (!prev) return;
        const away = S.motion === 'push' || S.motion === 'reveal';
        ctx.save(); xf(away ? -vx * e * cw : 0, away ? -vy * e * ch : 0, 1 + (S.outScale - 1) * e, 0); flat(prev, pb, a); ctx.restore();
      };
      const clipMask = function () {
        ctx.beginPath();
        switch (S.mask) {
          case 'wipe': {
            if (vy !== 0) ctx.rect(0, vy > 0 ? ch * (1 - e) : 0, cw, ch * e);
            else ctx.rect(vx < 0 ? 0 : cw * (1 - e), 0, cw * e, ch);
            break;
          }
          case 'iris': ctx.arc(cb.x + cb.w / 2, cb.y + cb.h / 2, Math.max(0.1, Math.hypot(cb.w, cb.h) / 2 * 1.02 * e), 0, PI * 2); break;
          case 'blinds': { const sl = cb.h / S.bars; for (let i = 0; i < S.bars; i++) ctx.rect(cb.x, cb.y + i * sl + sl * (1 - e) / 2, cb.w, sl * e); break; }
          case 'vblinds': { const sl = cb.w / S.bars; for (let i = 0; i < S.bars; i++) ctx.rect(cb.x + i * sl + sl * (1 - e) / 2, cb.y, sl * e, cb.h); break; }
          case 'checker': {
            const cols = S.bars, rows = Math.max(1, Math.round(cols * cb.h / cb.w)), cwid = cb.w / cols, chei = cb.h / rows;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
              const lt = Math.max(0, Math.min(1, e * 2 - (c / cols + r / rows) / 2 * 1.0)), f = Math.min(1, lt);
              ctx.rect(cb.x + c * cwid + cwid * (1 - f) / 2, cb.y + r * chei + chei * (1 - f) / 2, cwid * f, chei * f);
            }
            break;
          }
          case 'diagonal': {
            const s2 = e * 2, X = cb.x, Y = cb.y, W = cb.w, H = cb.h;
            if (s2 <= 1) { ctx.moveTo(X, Y); ctx.lineTo(X + s2 * W, Y); ctx.lineTo(X, Y + s2 * H); }
            else { ctx.moveTo(X, Y); ctx.lineTo(X + W, Y); ctx.lineTo(X + W, Y + (s2 - 1) * H); ctx.lineTo(X + (s2 - 1) * W, Y + H); ctx.lineTo(X, Y + H); }
            ctx.closePath(); break;
          }
          default: ctx.rect(0, 0, cw, ch);
        }
        ctx.clip();
      };
      if (S.motion === 'reveal') {
        ctx.save(); if (S.mask !== 'none') clipMask(); xf(0, 0, S.scale + (1 - S.scale) * e, S.rotate * (1 - e) * PI / 180); flat(cur, cb, 1 - S.fade * (1 - e)); ctx.restore();
        drawOut(1 - S.fade * e);
      } else {
        drawOut(1);
        ctx.save(); if (S.mask !== 'none') clipMask();
        xf(moves ? vx * (1 - e) * cw : 0, moves ? vy * (1 - e) * ch : 0, S.scale + (1 - S.scale) * e, S.rotate * (1 - e) * PI / 180);
        flat(cur, cb, 1 - S.fade * (1 - e)); ctx.restore();
      }
      if (S.mask === 'wipe' && S.edge) {
        ctx.save(); ctx.fillStyle = S.edge;
        if (vy !== 0) { const ly = vy > 0 ? ch * (1 - e) : ch * e; ctx.fillRect(cb.x, ly - 1.5, cb.w, 3); }
        else { const lx = vx < 0 ? cw * e : cw * (1 - e); ctx.fillRect(lx - 1.5, cb.y, 3, cb.h); }
        ctx.restore();
      }
    }
    if (S.dip) { // dip through a colour: peaks at the middle of the transition
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, Math.sin(PI * t))); ctx.fillStyle = S.dip; ctx.fillRect(0, 0, cw, ch); ctx.restore();
    }
  } finally { _pdfedFxEaseFn = keep; }
}

/* ---------- Live clips in the slideshow preview ---------- */
// A page holding a live clip is shown through a canvas that is re-drawn every frame, so the clip keeps
// moving in the preview (and inside page transitions), exactly as it will in the exported MP4.
// The still <img> underneath stays as the fallback; the canvas is laid exactly over it and copies its
// size, zoom drift and fade, so nothing jumps.
const pdfedSlideLive = { raf: 0, t0: {}, prevIdx: null, prevUntil: 0, el: null, last: 0 };
function pdfedSlideLiveEl() {
  if (pdfedSlideLive.el && pdfedSlideLive.el.isConnected) return pdfedSlideLive.el;
  const st = document.querySelector('.pdfed-slideshow-stage'); if (!st) return null;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:absolute;left:50%;top:50%;z-index:2;pointer-events:none;border-radius:4px;display:none;';
  st.appendChild(c); pdfedSlideLive.el = c; return c;
}
function pdfedSlideLiveHide() { if (pdfedSlideLive.el) pdfedSlideLive.el.style.display = 'none'; }
function pdfedSlideLiveStart(idx, prevIdx) {
  const now = performance.now();
  pdfedSlideLive.t0[idx] = now;
  pdfedSlideLive.prevIdx = (prevIdx === undefined ? null : prevIdx);
  pdfedSlideLive.prevUntil = now + 3000;
  if (!pdfedSlideLive.raf) pdfedSlideLive.raf = requestAnimationFrame(pdfedSlideLiveTick);
}
function pdfedSlideLiveStop() {
  if (pdfedSlideLive.raf) { cancelAnimationFrame(pdfedSlideLive.raf); pdfedSlideLive.raf = 0; }
  pdfedSlideLiveHide();
}
function pdfedSlideLiveTick(ts) {
  pdfedSlideLive.raf = 0;
  const ov = document.getElementById('pdfedSlideshowOverlay');
  if (!ov || !ov.classList.contains('open')) { pdfedSlideLiveHide(); return; }
  pdfedSlideLive.raf = requestAnimationFrame(pdfedSlideLiveTick);
  if (document.hidden || ts - pdfedSlideLive.last < 30) return; // ~30 fps is plenty
  pdfedSlideLive.last = ts;
  try {
    const now = performance.now(), cur = pdfedSlideshow.indices[pdfedSlideshow.pos], el = pdfedSlideLiveEl();
    if (!el) return;
    const ids = [cur];
    if (pdfedSlideLive.prevIdx != null && pdfedSlideLive.prevIdx !== cur && now < pdfedSlideLive.prevUntil) ids.push(pdfedSlideLive.prevIdx);
    let curCv = null;
    ids.forEach(function (id) {
      const cv = _pdfedFxImgs[id];
      if (cv && cv._live) { cv._live.update((now - (pdfedSlideLive.t0[id] || now)) / 1000); if (id === cur) curCv = cv; }
    });
    const img = document.getElementById(pdfedSlideshow.layer === 'a' ? 'pdfedSlideshowImgA' : 'pdfedSlideshowImgB');
    if (!curCv || !img || !img.offsetWidth) { el.style.display = 'none'; return; }
    if (el.width !== curCv.width || el.height !== curCv.height) { el.width = curCv.width; el.height = curCv.height; }
    el.getContext('2d').drawImage(curCv, 0, 0);
    const cs = getComputedStyle(img);
    el.style.width = img.offsetWidth + 'px'; el.style.height = img.offsetHeight + 'px';
    el.style.transform = (cs.transform && cs.transform !== 'none') ? cs.transform : 'translate(-50%,-50%)';
    el.style.opacity = cs.opacity; el.style.display = 'block';
  } catch (e) { /* one bad frame never stops the preview */ }
}

/* ---------- Present mode ---------- */
let _pdfedFxRun = 0, _pdfedFxImgs = {};
function pdfedFxStageBox() {
  const st = document.querySelector('.pdfed-slideshow-stage');
  const W = st ? st.clientWidth : 1280, H = st ? st.clientHeight : 720;
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  dpr = Math.max(1, Math.min(dpr, Math.sqrt(2400000 / Math.max(1, W * H)))); // never push more than ~2.4M px per frame
  return { W: W, H: H, dpr: dpr, key: W + 'x' + H + '@' + dpr.toFixed(2) };
}
// Loads a page, decodes it and shrinks it ONCE to the size it is shown at, so the frames of a
// transition only blit a small canvas instead of decoding/scaling a huge image every frame.
function pdfedFxImg(idx) {
  const box = pdfedFxStageBox();
  if (_pdfedFxImgs._key !== box.key) { _pdfedFxImgs = { _key: box.key }; }
  if (_pdfedFxImgs[idx]) return Promise.resolve(_pdfedFxImgs[idx]);
  if (pdfedPageHasLive(pdfed.pages[idx])) {
    // Live page: hand back a canvas that is re-drawn as time passes (see pdfedSlideLiveTick), so the
    // clip also keeps moving inside transitions. Built once per size; concurrent callers share it.
    const store = _pdfedFxImgs, pk = 'p' + idx;
    if (!store[pk]) {
      store[pk] = pdfedBuildLivePage(pdfed.pages[idx], Math.round(0.86 * box.W * box.dpr), Math.round(0.82 * box.H * box.dpr))
        .then(function (lp) { lp.canvas._live = lp; store[idx] = lp.canvas; return lp.canvas; })
        .catch(function (e) { console.warn('[Workspace] live preview page failed, showing still', e); delete store[pk]; return null; });
    }
    return store[pk];
  }
  return Promise.resolve(pdfedSlideshow.cache[idx] || pdfedSlideshowGetImage(idx)).then(function (url) {
    return new Promise(function (res) {
      const im = new Image();
      im.onload = function () {
        let out = im;
        try {
          const iw = im.naturalWidth, ih = im.naturalHeight;
          const fit = Math.min(1, 0.86 * box.W / iw, 0.82 * box.H / ih);
          const k = Math.min(1, fit * 1.05 * box.dpr);
          if (k < 1) {
            const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(iw * k)); c.height = Math.max(2, Math.round(ih * k));
            const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
            c._ow = iw; c._oh = ih; out = c;
          }
        } catch (e) { out = im; }
        _pdfedFxImgs[idx] = out; res(out);
      };
      im.onerror = function () { res(null); }; im.src = url;
    });
  });
}
function pdfedAnimPlayPresent(incoming, outgoing, idx, prevIdx) {
  const token = ++_pdfedFxRun, stage = incoming.parentNode;
  const old = stage.querySelector('.pdfed-fx-canvas'); if (old) old.remove();
  incoming.style.opacity = ''; incoming.style.transition = ''; outgoing.style.opacity = ''; outgoing.style.transition = '';
  if (prevIdx === null || prevIdx === undefined || prevIdx === idx) return;
  const list = pdfedSlideshow.indices, n = list.length, first = list[0], last = list[n - 1];
  let fwd = idx > prevIdx, fx;
  if (n > 1 && ((prevIdx === last && idx === first) || (prevIdx === first && idx === last))) {
    fwd = prevIdx === last; // wrap-around uses the last real gap's effect
    fx = pdfedAnimGet(pdfed.pages[list[n - 2]]) || pdfedAnimGet(pdfed.pages[first]);
  } else fx = pdfedAnimGet(pdfed.pages[fwd ? prevIdx : idx]);
  if (!fx) return; // no transition set: keep the classic soft fade
  incoming.style.transition = 'transform 6.5s linear'; incoming.style.opacity = '0';
  outgoing.style.transition = 'none'; outgoing.style.opacity = '0';
  if (fx.type === 'none') { incoming.style.opacity = '1'; return; }
  function bail() { incoming.style.opacity = ''; incoming.style.transition = ''; outgoing.style.opacity = ''; outgoing.style.transition = ''; }
  Promise.all([pdfedFxImg(prevIdx), pdfedFxImg(idx)]).then(function (im) {
    if (token !== _pdfedFxRun) return;
    if (!im[1]) { bail(); return; }
    const bx = pdfedFxStageBox(), W = bx.W, H = bx.H, dpr = bx.dpr;
    const cv = document.createElement('canvas'); cv.className = 'pdfed-fx-canvas';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:3;pointer-events:none;';
    stage.appendChild(cv);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lay = function (img, zt) {
      const d = pdfedFxDims(img), f = Math.min(1, 0.86 * W / d[0], 0.82 * H / d[1]) * (1.015 + 0.03 * zt);
      return { x: (W - d[0] * f) / 2, y: (H - d[1] * f) / 2, w: d[0] * f, h: d[1] * f };
    };
    lay.sh = 0; // a big blurred shadow on every frame is the most expensive thing a canvas can do
    const start = performance.now();
    (function frame(now) {
      if (token !== _pdfedFxRun) { cv.remove(); return; }
      let t = Math.min(1, (now - start) / fx.ms);
      ctx.clearRect(0, 0, W, H);
      try { pdfedFxRender(ctx, W, H, im[0], im[1], t, fx.type, fwd ? 1 : -1, lay, 1, 0, fx.spec); } catch (e) { t = 1; }
      if (t < 1) requestAnimationFrame(frame);
      else { incoming.style.opacity = '1'; requestAnimationFrame(function () { cv.remove(); incoming.style.opacity = ''; }); }
    })(start);
  }).catch(bail);
}

/* ---------- Export Clip ---------- */
function pdfedClipDrawFx(ctx, cw, ch, images, idx, prevIdx, alpha, zoomT, fx) {
  const zs = pdfedClip.motion === 'static' ? 0 : 1;
  const lay = function (img, zt) {
    const d = pdfedFxDims(img), f = Math.min(cw / d[0], ch / d[1]) * (1 + 0.035 * zt * zs), w = d[0] * f, h = d[1] * f;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
  };
  lay.sh = 0;
  pdfedFxRender(ctx, cw, ch, images[prevIdx] || null, images[idx], alpha, fx.type, 1, lay, 1, zoomT, fx.spec);
}

/* ---------- picker UI ---------- */
let _pdfedFxMock = null;
function pdfedFxMockPages() {
  if (_pdfedFxMock) return _pdfedFxMock;
  const mk = function (hc) {
    const c = document.createElement('canvas'); c.width = 96; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 96, 128); g.fillStyle = hc; g.fillRect(0, 0, 96, 28);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(8, 11, 42, 6); g.fillStyle = '#cbd5e1';
    for (let i = 0; i < 7; i++) g.fillRect(8, 40 + i * 12, 80 - (i % 3) * 14, 5);
    return c;
  };
  _pdfedFxMock = [mk('#64748b'), mk('#0ea5e9')]; return _pdfedFxMock;
}
function pdfedFxDrawTile(cv, type, t, spec) {
  const g = cv.getContext('2d'), m = pdfedFxMockPages();
  g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, 72, 54);
  const lay = function () { return { x: 16.5, y: 1, w: 39, h: 52 }; }; lay.sh = 6;
  if (type === 'none') { pdfedFxFlat(g, m[1], lay(), 1, 6); return; }
  pdfedFxRender(g, 72, 54, m[0], m[1], t, type, 1, lay, 0, 0, spec);
}
function pdfedMakeAnimBtn(afterIdx) {
  const b = document.createElement('button'); b.className = 'pdfed-anim-btn';
  b.title = 'Transition between page ' + (afterIdx + 1) + ' and ' + (afterIdx + 2);
  b.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  const a = pdfedAnimGet(pdfed.pages[afterIdx]); if (a && a.type !== 'none') b.classList.add('on');
  b.onclick = function (ev) { ev.stopPropagation(); pdfedOpenAnimPicker(afterIdx, b); };
  return b;
}
function pdfedCloseAnimPicker() {
  const old = document.getElementById('pdfedAnimPicker'); if (old) { old._dead = true; old.remove(); }
  document.removeEventListener('mousedown', pdfedAnimPickerOutside, true);
  document.removeEventListener('keydown', pdfedAnimPickerKey, true);
}
function pdfedAnimPickerOutside(e) { const box = document.getElementById('pdfedAnimPicker'); if (box && !box.contains(e.target)) pdfedCloseAnimPicker(); }
function pdfedAnimPickerKey(e) { if (e.key === 'Escape') pdfedCloseAnimPicker(); }

function pdfedOpenAnimPicker(afterIdx, anchor) {
  pdfedCloseAnimPicker();
  const cur = pdfedAnimGet(pdfed.pages[afterIdx]), st = { type: cur ? cur.type : null, speed: cur ? cur.speed : 'normal', extra: (cur && cur.type === 'custom') ? { spec: cur.spec, label: cur.label } : null };
  const box = document.createElement('div'); box.id = 'pdfedAnimPicker'; box.className = 'pdfed-anim-picker';
  box.innerHTML =
    '<div class="pa-head"><div class="pa-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg></div>' +
    '<div class="pa-ht"><b>Page transition</b><span>Page ' + (afterIdx + 1) + ' \u2192 Page ' + (afterIdx + 2) + '</span></div><button type="button" class="pa-x" aria-label="Close">\u00D7</button></div>' +
    '<div class="pa-body"><div class="pa-lab">CLASSIC</div><div class="pa-grid" data-g="0"></div>' +
    '<div class="pa-lab">SIGNATURE <i>hover to preview</i></div><div class="pa-grid" data-g="1"></div>' +
    '<div class="pa-row"><span>Speed</span><div class="pa-seg"></div></div>' +
    '<div class="pa-actions"><button type="button" class="pa-all">Apply to all page changes</button><button type="button" class="pa-clear">Remove</button></div>' +
    '<div class="pa-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><span>' + pdfedAnimNoticeText() + '</span></div></div>';
  const tiles = [];
  PDFED_ANIM_TYPES.forEach(function (t) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pa-tile';
    const cv = document.createElement('canvas'); cv.width = 144; cv.height = 108;
    const lb = document.createElement('span'); lb.textContent = t.name;
    b.appendChild(cv); b.appendChild(lb);
    pdfedFxDrawTile(cv, t.id, 0.5);
    b.onmouseenter = function () {
      if (t.id === 'none') return; b._run = true; const s0 = performance.now();
      (function f(now) { if (!b._run || box._dead) return; pdfedFxDrawTile(cv, t.id, Math.min(1, ((now - s0) % 1600) / 1000)); requestAnimationFrame(f); })(s0);
    };
    b.onmouseleave = function () { b._run = false; pdfedFxDrawTile(cv, t.id, 0.5); };
    b.onclick = function () { st.type = t.id; st.extra = null; pdfedAnimSet([afterIdx], st.type, st.speed); sync(); };
    box.querySelector('[data-g="' + (t.sig ? 1 : 0) + '"]').appendChild(b); tiles.push([t.id, b]);
  });
  if (cur && cur.type === 'custom') {
    const body = box.querySelector('.pa-body'), lab = document.createElement('div'), grid = document.createElement('div');
    lab.className = 'pa-lab'; lab.innerHTML = 'CUSTOM <i>built by Kadessa</i>'; grid.className = 'pa-grid';
    const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'pa-tile on';
    const ccv = document.createElement('canvas'); ccv.width = 144; ccv.height = 108;
    const clb = document.createElement('span'); clb.textContent = pdfedAnimTitle(cur);
    cb.appendChild(ccv); cb.appendChild(clb); grid.appendChild(cb);
    body.insertBefore(grid, body.firstChild); body.insertBefore(lab, grid);
    pdfedFxDrawTile(ccv, 'custom', 0.5, cur.spec);
    cb.onmouseenter = function () {
      cb._run = true; const s0 = performance.now();
      (function f(now) { if (!cb._run || box._dead) return; pdfedFxDrawTile(ccv, 'custom', Math.min(1, ((now - s0) % 1600) / 1000), cur.spec); requestAnimationFrame(f); })(s0);
    };
    cb.onmouseleave = function () { cb._run = false; pdfedFxDrawTile(ccv, 'custom', 0.5, cur.spec); };
  }
  const seg = box.querySelector('.pa-seg');
  ['fast', 'normal', 'slow'].forEach(function (s) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s.charAt(0).toUpperCase() + s.slice(1); b.dataset.s = s;
    b.onclick = function () { st.speed = s; if (st.type) pdfedAnimSet([afterIdx], st.type, st.speed, st.extra); sync(); }; seg.appendChild(b);
  });
  function sync() {
    tiles.forEach(function (x) { x[1].classList.toggle('on', st.type === x[0]); });
    seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === st.speed); });
    box.querySelector('.pa-all').disabled = !st.type;
    box.querySelector('.pa-clear').disabled = !pdfed.pages[afterIdx].animAfter;
  }
  box.querySelector('.pa-all').onclick = function () {
    const idxs = []; for (let i = 0; i < pdfed.pages.length - 1; i++) idxs.push(i);
    pdfedAnimSet(idxs, st.type, st.speed, st.extra); pdfedCloseAnimPicker();
  };
  box.querySelector('.pa-clear').onclick = function () { pdfedAnimClear([afterIdx]); st.type = null; st.extra = null; sync(); };
  box.querySelector('.pa-x').onclick = pdfedCloseAnimPicker;
  sync(); document.body.appendChild(box);
  const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
  let left = r.right + 12, top = r.top - 40;
  if (left + bw > window.innerWidth - 8) left = Math.max(8, r.left - bw - 12);
  top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
  box.style.left = left + 'px'; box.style.top = top + 'px';
  setTimeout(function () {
    document.addEventListener('mousedown', pdfedAnimPickerOutside, true);
    document.addEventListener('keydown', pdfedAnimPickerKey, true);
  }, 0);
}

function pdfedAnimUpdateExportWarn(fmt) {
  let el = document.getElementById('pdfedExportAnimWarn');
  if (!el) {
    const ref = document.getElementById('pdfedExportImageNote');
    if (!ref || !ref.parentNode) return;
    el = document.createElement('div'); el.id = 'pdfedExportAnimWarn'; el.className = 'pdfed-export-note pdfed-anim-warn';
    ref.parentNode.insertBefore(el, ref);
  }
  if (!pdfedAnimHasAny() || fmt === 'video') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<b>Your page transitions will not be in this file.</b> They only play in Present mode and in the exported ' + pdfedAnimFormatLabel() +
    '. Want a video instead? <button type="button" class="pdfed-anim-switch" onclick="pdfedApplyExportFormat(\'video\')">Switch to video clip</button>';
}
/* ===== END PAGE TRANSITIONS ===== */

const pdfedSlideshow = {
  indices: [],      // 0-based page indices being previewed, in order
  pos: 0,           // position within `indices`
  layer: 'a',       // which <img> layer is currently the visible/active one
  cache: {},        // pageIdx -> composed dataURL, so revisits are instant
  playing: false,
  timer: null,
  intervalMs: 3200,
  keyHandler: null,
  idleHandler: null, // mousemove/click listener that wakes the chrome back up
  lastIdx: null,
  idleTimer: null,   // timeout that re-hides it after a few seconds of no activity
};

// Mirrors the same page-selection logic as the Export button itself, so the
// slideshow always previews exactly what a click on Export would produce.
function pdfedSlideshowResolveIndices() {
  const total = pdfed.pages.length;
  if (pdfedExportPagesMode === 'custom') {
    const input = document.getElementById('pdfedExportRangeInput');
    const raw = input ? input.value.trim() : '';
    const idxs = raw ? pdfedParsePageRange(raw, total) : [];
    return idxs.length ? idxs : pdfed.pages.map((_, i) => i);
  }
  return pdfed.pages.map((_, i) => i);
}

async function pdfedSlideshowGetImage(idx) {
  if (pdfedSlideshow.cache[idx]) return pdfedSlideshow.cache[idx];
  const pg = pdfed.pages[idx];
  // Uses the exact same compositor as Export, so the slideshow shows exactly
  // what will actually end up in the downloaded PDF, edits and all.
  const url = await pdfedComposeThumb(pg, idx);
  pdfedSlideshow.cache[idx] = url;
  return url;
}

// Warms the cache for an upcoming slide in the background, without blocking
// the current one, so by the time autoplay/next actually gets there the
// image is already decoded and the crossfade has nothing to wait on.
function pdfedSlideshowPrefetch(pos) {
  const total = pdfedSlideshow.indices.length;
  if (pos < 0 || pos >= total) return;
  const idx = pdfedSlideshow.indices[pos];
  if (pdfedSlideshow.cache[idx]) return;
  pdfedSlideshowGetImage(idx).catch(() => {});
}

async function pdfedOpenSlideshow() {
  if (!pdfed.pages.length) { toast('No PDF loaded', 'error'); return; }
  pdfedAutoStampPendingGhost();
  const indices = pdfedSlideshowResolveIndices();
  if (!indices.length) { toast('No pages to preview', 'error'); return; }

  pdfedSlideshow.indices = indices;
  pdfedSlideshow.pos = 0;
  pdfedSlideshow.lastIdx = null;
  _pdfedFxImgs = {};
  pdfedSlideshow.cache = {};
  pdfedSlideshow.layer = 'a';

  // Reset both image layers so a previous session's frame never flashes.
  ['pdfedSlideshowImgA', 'pdfedSlideshowImgB'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.removeAttribute('src'); }
  });

  document.getElementById('pdfedSlideshowOverlay').classList.add('open');
  pdfedSlideshowBuildDots();
  await pdfedSlideshowRenderCurrent();

  pdfedSlideshow.keyHandler = pdfedSlideshowKeydown;
  document.addEventListener('keydown', pdfedSlideshow.keyHandler);

  // Present-mode chrome: fades the top/bottom bars out after a few idle
  // seconds so a screen-shared slideshow reads as clean and professional,
  // and wakes back up the instant the presenter moves the mouse or clicks.
  const overlayEl = document.getElementById('pdfedSlideshowOverlay');
  pdfedSlideshow.idleHandler = pdfedSlideshowResetIdle;
  overlayEl.addEventListener('mousemove', pdfedSlideshow.idleHandler);
  overlayEl.addEventListener('click', pdfedSlideshow.idleHandler);
  pdfedSlideshowResetIdle();

  // Autoplay from the moment it opens, that's what makes it read as a
  // "slideshow" rather than just another manual page stepper.
  pdfedSlideshowSetPlaying(pdfedSlideshow.indices.length > 1);
}

function pdfedCloseSlideshow() {
  const overlayEl = document.getElementById('pdfedSlideshowOverlay');
  overlayEl.classList.remove('open');
  pdfedSlideLiveStop();
  pdfedSlideshowSetPlaying(false);
  if (pdfedSlideshow.keyHandler) {
    document.removeEventListener('keydown', pdfedSlideshow.keyHandler);
    pdfedSlideshow.keyHandler = null;
  }
  if (pdfedSlideshow.idleHandler) {
    overlayEl.removeEventListener('mousemove', pdfedSlideshow.idleHandler);
    overlayEl.removeEventListener('click', pdfedSlideshow.idleHandler);
    pdfedSlideshow.idleHandler = null;
  }
  if (pdfedSlideshow.idleTimer) { clearTimeout(pdfedSlideshow.idleTimer); pdfedSlideshow.idleTimer = null; }
  overlayEl.classList.remove('idle');
  if (document.fullscreenElement || document.webkitFullscreenElement) pdfedSlideshowToggleFullscreen();
}

function pdfedSlideshowResetIdle() {
  const overlayEl = document.getElementById('pdfedSlideshowOverlay');
  overlayEl.classList.remove('idle');
  if (pdfedSlideshow.idleTimer) clearTimeout(pdfedSlideshow.idleTimer);
  pdfedSlideshow.idleTimer = setTimeout(() => overlayEl.classList.add('idle'), 2600);
}

// Toggles the browser's true Fullscreen API on the slideshow overlay itself
// (rather than just filling the viewport as it already does), so when a
// presenter is screen-sharing in a meeting the browser tabs/address bar
// disappear too and the audience only ever sees the slides.
function pdfedSlideshowToggleFullscreen() {
  const el = document.getElementById('pdfedSlideshowOverlay');
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFs) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { req.call(el).catch ? req.call(el).catch(() => {}) : req.call(el); } catch (e) {} }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document).catch ? exit.call(document).catch(() => {}) : exit.call(document); } catch (e) {} }
  }
}

function pdfedSlideshowUpdateFullscreenIcon() {
  const btn = document.getElementById('pdfedSlideshowFsBtn');
  if (!btn) return;
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btn.innerHTML = isFs
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/></svg>';
  btn.title = isFs ? 'Exit fullscreen' : 'Present fullscreen';
  btn.setAttribute('aria-label', btn.title);
}
document.addEventListener('fullscreenchange', pdfedSlideshowUpdateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', pdfedSlideshowUpdateFullscreenIcon);

function pdfedSlideshowKeydown(e) {
  if (e.key === 'Escape') pdfedCloseSlideshow();
  else if (e.key === 'ArrowRight') pdfedSlideshowStep(1);
  else if (e.key === 'ArrowLeft') pdfedSlideshowStep(-1);
  else if (e.key === ' ') { e.preventDefault(); pdfedSlideshowTogglePlay(); }
  else if (e.key === 'f' || e.key === 'F') pdfedSlideshowToggleFullscreen();
}

// Renders whatever pdfedSlideshow.pos currently points at, crossfading the
// incoming image in on the layer that's presently hidden so the swap is a
// clean fade, never a jump-cut.
async function pdfedSlideshowRenderCurrent() {
  const total = pdfedSlideshow.indices.length;
  const pos = pdfedSlideshow.pos;
  const idx = pdfedSlideshow.indices[pos];
  const _animPrev = pdfedSlideshow.lastIdx;

  const spinner = document.getElementById('pdfedSlideshowSpinner');
  const imgA = document.getElementById('pdfedSlideshowImgA');
  const imgB = document.getElementById('pdfedSlideshowImgB');
  const outgoing = pdfedSlideshow.layer === 'a' ? imgA : imgB;
  const incoming = pdfedSlideshow.layer === 'a' ? imgB : imgA;

  const cached = pdfedSlideshow.cache[idx];
  if (spinner) spinner.classList.toggle('on', !cached);

  const url = cached || await pdfedSlideshowGetImage(idx);
  if (spinner) spinner.classList.remove('on');

  await new Promise(res => {
    const pre = new Image();
    pre.onload = res; pre.onerror = res; pre.src = url;
  });

  incoming.src = url;
  incoming.classList.remove('active');
  void incoming.offsetWidth; // force reflow so the Ken Burns zoom restarts cleanly for this slide
  incoming.classList.add('active');
  outgoing.classList.remove('active');
  pdfedSlideshow.layer = pdfedSlideshow.layer === 'a' ? 'b' : 'a';
  pdfedAnimPlayPresent(incoming, outgoing, idx, _animPrev);
  pdfedSlideshow.lastIdx = idx;
  pdfedSlideLiveStart(idx, _animPrev);

  document.getElementById('pdfedSlideshowCount').textContent = (pos + 1) + ' / ' + total;
  document.getElementById('pdfedSlideshowPrevBtn').disabled = total <= 1;
  document.getElementById('pdfedSlideshowNextBtn').disabled = total <= 1;
  pdfedSlideshowUpdateDots();
  pdfedSlideshowRestartProgress();
  pdfedSlideshowPrefetch(pos + 1 < total ? pos + 1 : 0);
  try {
    const nx = pdfedSlideshow.indices[pos + 1 < total ? pos + 1 : 0], pv = pdfedSlideshow.indices[pos > 0 ? pos - 1 : total - 1];
    pdfedFxImg(idx).catch(function () {}); pdfedFxImg(nx).catch(function () {}); pdfedFxImg(pv).catch(function () {});
  } catch (e) {}
}

function pdfedSlideshowBuildDots() {
  const wrap = document.getElementById('pdfedSlideshowDots');
  if (!wrap) return;
  wrap.innerHTML = '';
  pdfedSlideshow.indices.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'pdfed-slideshow-dot' + (i === 0 ? ' active' : '');
    d.title = 'Page ' + (pdfedSlideshow.indices[i] + 1);
    d.onclick = () => pdfedSlideshowGoTo(i);
    wrap.appendChild(d);
  });
}

function pdfedSlideshowUpdateDots() {
  document.querySelectorAll('#pdfedSlideshowDots .pdfed-slideshow-dot').forEach((d, i) => {
    d.classList.toggle('active', i === pdfedSlideshow.pos);
  });
}

function pdfedSlideshowGoTo(pos) {
  const total = pdfedSlideshow.indices.length;
  if (pos < 0 || pos >= total || pos === pdfedSlideshow.pos) return;
  pdfedSlideshow.pos = pos;
  pdfedSlideshowRenderCurrent();
}

// Loops both directions, so autoplay never just stops dead on the last page.
function pdfedSlideshowStep(dir) {
  const total = pdfedSlideshow.indices.length;
  if (total <= 1) return;
  let next = pdfedSlideshow.pos + dir;
  if (next < 0) next = total - 1;
  if (next >= total) next = 0;
  pdfedSlideshow.pos = next;
  pdfedSlideshowRenderCurrent();
}

function pdfedSlideshowTogglePlay() {
  pdfedSlideshowSetPlaying(!pdfedSlideshow.playing);
}

function pdfedSlideshowSetPlaying(on) {
  pdfedSlideshow.playing = on && pdfedSlideshow.indices.length > 1;
  const btn = document.getElementById('pdfedSlideshowPlayBtn');
  if (btn) {
    btn.innerHTML = pdfedSlideshow.playing
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
  }
  if (pdfedSlideshow.timer) { clearInterval(pdfedSlideshow.timer); pdfedSlideshow.timer = null; }
  if (pdfedSlideshow.playing) {
    pdfedSlideshow.timer = setInterval(() => pdfedSlideshowStep(1), pdfedSlideshow.intervalMs);
    pdfedSlideshowRestartProgress();
  } else {
    pdfedSlideshowStopProgress();
  }
}

// The thin bar under the controls that fills up over one slide's dwell time,
// restarted (width snapped back to 0 with transitions off, then reflowed and
// eased back up to 100%) every time the slide changes or playback toggles.
function pdfedSlideshowRestartProgress() {
  const fill = document.getElementById('pdfedSlideshowProgressFill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.width = '0%';
  void fill.offsetWidth;
  if (pdfedSlideshow.playing) {
    fill.style.transition = 'width ' + pdfedSlideshow.intervalMs + 'ms linear';
    fill.style.width = '100%';
  }
}

function pdfedSlideshowStopProgress() {
  const fill = document.getElementById('pdfedSlideshowProgressFill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.width = '0%';
}

// Parses strings like "1-5, 8, 11-13" into a sorted, deduped, 0-based index array.
function pdfedParsePageRange(rangeStr, total) {
  const out = new Set();
  const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) out.add(n - 1);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

// ─── SLIDESHOW EXPORT AS CLIP ────────────────────────────────────────────
// Renders the same pages the Slideshow Preview walks through into a real,
// downloadable video file (.webm), built entirely on-device with a canvas
// and the browser's own MediaRecorder — no upload, no server, no
// third-party encoder. The user sets how many seconds each slide holds for
// before exporting, and the clip plays back at exactly that timing, with
// the same crossfade and slow zoom the live preview uses.
const pdfedClip = {
  secondsPerSlide: 3.2,
  frame: 'auto',   // 'auto' (matches the page shape) | 'widescreen' (16:9, for meeting screens)
  motion: 'zoom',  // 'zoom' (subtle Ken Burns drift) | 'static' (no motion, cleanest for dense text/tables)
  liveFull: true,  // true: a slide holding a live clip stays long enough to play the clip's whole story | false: same seconds as every other slide
  background: 'dark', // 'dark' (flat #05070d letterbox bars) | 'match' (sampled from each page, only matters for 'widescreen' frame)
  rendering: false,
  cancelled: false,
  recorder: null,
  chunks: [],
  raf: null,
  tickResolve: null,
};

// How long each exported slide stays on screen, in ms. A slide with a live clip normally gets as long as the
// clip's own length (so the whole motion story plays, not just its opening seconds), never shorter than the
// seconds-per-slide the person chose, and capped so one clip cannot make the video endless.
const PDFED_CLIP_MAX_LIVE_MS = 30000;
function pdfedClipSlideDurations(indices, secs) {
  const base = secs * 1000;
  return indices.map(function (pi) {
    const pg = pdfed.pages[pi];
    if (!pdfedClip.liveFull || !pdfedPageHasLive(pg)) return base;
    let longest = 0;
    (pg.placedImages || []).forEach(function (it) { if (it && it.clip && it.clip.o && it.clip.o.secs > longest) longest = it.clip.o.secs; });
    return Math.max(base, Math.min(PDFED_CLIP_MAX_LIVE_MS, longest * 1000));
  });
}
function pdfedClipSetLiveFull(on) {
  pdfedClip.liveFull = !!on;
  document.querySelectorAll('#pdfedClipLiveSeg [data-livefull]').forEach(b => b.classList.toggle('on', (b.getAttribute('data-livefull') === 'full') === !!on));
  pdfedClipUpdateEstimate();
}

function pdfedOpenClipPanel() {
  if (!pdfedSlideshow.indices.length) { toast('No pages to export', 'error'); return; }
  pdfedSlideshowSetPlaying(false);
  const liveRow = document.getElementById('pdfedClipLiveRow');
  if (liveRow) liveRow.style.display = pdfedDocHasLive(pdfedSlideshow.indices) ? '' : 'none';
  const input = document.getElementById('pdfedClipSeconds');
  if (input) input.value = pdfedClip.secondsPerSlide.toFixed(1);
  pdfedClipUpdateEstimate();
  const bgRow = document.getElementById('pdfedClipBgRow');
  if (bgRow) bgRow.style.display = (pdfedClip.frame === 'widescreen') ? '' : 'none';
  document.getElementById('pdfedClipOverlay').classList.add('open');
}

function pdfedCloseClipPanel() {
  document.getElementById('pdfedClipOverlay').classList.remove('open');
}

function pdfedClipSetFrame(mode) {
  pdfedClip.frame = mode;
  document.querySelectorAll('#pdfedClipFrameSeg [data-frame]').forEach(b => b.classList.toggle('on', b.getAttribute('data-frame') === mode));
  // The background choice only has any visible effect in Widescreen, where
  // pages get letterboxed — "Original shape" fits the canvas to the page
  // itself so there are no bars to color.
  const bgRow = document.getElementById('pdfedClipBgRow');
  if (bgRow) bgRow.style.display = (mode === 'widescreen') ? '' : 'none';
}

function pdfedClipSetBackground(mode) {
  pdfedClip.background = mode;
  document.querySelectorAll('#pdfedClipBgSeg [data-bg]').forEach(b => b.classList.toggle('on', b.getAttribute('data-bg') === mode));
}

function pdfedClipSetMotion(mode) {
  pdfedClip.motion = mode;
  document.querySelectorAll('#pdfedClipMotionSeg [data-motion]').forEach(b => b.classList.toggle('on', b.getAttribute('data-motion') === mode));
}

function pdfedClipUpdateEstimate() {
  const input = document.getElementById('pdfedClipSeconds');
  const n = pdfedSlideshow.indices.length || 1;
  let secs = parseFloat(input && input.value);
  if (!isFinite(secs)) secs = pdfedClip.secondsPerSlide;
  secs = Math.min(10, Math.max(1, secs));
  const total = Math.round(pdfedClipSlideDurations(pdfedSlideshow.indices, secs).reduce(function (a, b) { return a + b; }, 0) / 100) / 10;
  const label = document.getElementById('pdfedClipEstimate');
  if (label) label.textContent = n + (n === 1 ? ' slide' : ' slides') + ' \u00b7 ~' + total + 's clip';
}

// MP4 first: it is what PowerPoint, Keynote, Zoom and Teams all expect
// natively, and a growing set of browsers (Safari, and recent Chrome/Edge)
// can record straight to it. Where a browser can't, WebM is the fallback
// so the export never simply fails.
function pdfedClipPickMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function pdfedClipLoadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

// Draws one image "contain"-fit inside the canvas, letterboxed on the same
// dark background the preview uses, with a slow zoom (0 -> 1 across the
// slide's own dwell time) matching the Ken Burns drift in the live preview.
function pdfedClipDrawImage(ctx, cw, ch, img, zoomT) {
  const d = pdfedFxDims(img);
  const scaleBase = Math.min(cw / d[0], ch / d[1]);
  const scale = scaleBase * (1 + 0.035 * zoomT);
  const w = d[0] * scale, h = d[1] * scale;
  ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
}

// Downsamples an image to a tiny canvas and averages its pixels — cheap
// enough to run once per slide, close enough to read as "this page's color"
// for a letterbox background rather than a real content-aware sample.
function pdfedClipAvgColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 12; c.height = 12;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, 12, 12);
    const data = cx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  } catch (e) { return [5, 7, 13]; }
}

function pdfedClipDrawFrame(ctx, cw, ch, images, idx, prevIdx, alpha, zoomT, avgColors, fx) {
  if (pdfedClip.background === 'match' && avgColors && avgColors[idx]) {
    const cur = avgColors[idx];
    let bg = cur;
    // Cross-fades the background color right alongside the image crossfade,
    // so the letterbox bars never hard-cut between two page colors.
    if (prevIdx !== null && alpha < 1 && avgColors[prevIdx]) {
      const prev = avgColors[prevIdx];
      bg = [
        Math.round(prev[0] + (cur[0] - prev[0]) * alpha),
        Math.round(prev[1] + (cur[1] - prev[1]) * alpha),
        Math.round(prev[2] + (cur[2] - prev[2]) * alpha)
      ];
    }
    ctx.fillStyle = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')';
  } else {
    ctx.fillStyle = '#05070d';
  }
  ctx.fillRect(0, 0, cw, ch);
  if (fx && prevIdx !== null && alpha < 1 && fx.type !== 'fade' && fx.type !== 'none' && images[idx]) {
    // A transition that throws must never kill the recording loop: fall back to a plain
    // crossfade for that frame instead (this is what used to freeze exports on slide 1).
    try { pdfedClipDrawFx(ctx, cw, ch, images, idx, prevIdx, alpha, zoomT, fx); return; }
    catch (e) { ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, cw, ch); }
  }
  const fullZoom = pdfedClip.motion === 'static' ? 0 : 1;
  if (prevIdx !== null && alpha < 1 && images[prevIdx]) {
    ctx.globalAlpha = 1 - alpha;
    pdfedClipDrawImage(ctx, cw, ch, images[prevIdx], fullZoom);
    ctx.globalAlpha = 1;
  }
  if (images[idx]) {
    ctx.globalAlpha = prevIdx !== null ? alpha : 1;
    pdfedClipDrawImage(ctx, cw, ch, images[idx], pdfedClip.motion === 'static' ? 0 : zoomT);
    ctx.globalAlpha = 1;
  }
}

// Pre-scales a page ONCE to the size it will be drawn at in the clip. Drawing a
// multi-thousand-pixel page image every frame (and slicing it 100+ times per frame for
// the 3D transitions) is what made exports stutter. The canvas is 3.5% larger than the
// fitted size so the slow zoom still ends at full sharpness.
function pdfedClipPrep(img, cw, ch) {
  if (!img) return null;
  try {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return img;
    const f = Math.min(cw / iw, ch / ih) * 1.035;
    if (f >= 1) return img; // already at or below output size: nothing to gain
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(iw * f)); c.height = Math.max(2, Math.round(ih * f));
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    c._ow = iw; c._oh = ih;
    return c;
  } catch (e) { return img; }
}

function pdfedClipSetProgress(pct, label) {
  const fill = document.getElementById('pdfedClipProgressFill');
  const lbl = document.getElementById('pdfedClipProgressLabel');
  if (fill) fill.style.width = Math.round(Math.min(1, Math.max(0, pct)) * 100) + '%';
  if (lbl && label) lbl.textContent = label;
}

function pdfedClipCancel() {
  if (!pdfedClip.rendering) return;
  pdfedClip.cancelled = true;
  if (pdfedClip.raf) { cancelAnimationFrame(pdfedClip.raf); pdfedClip.raf = null; }
  if (pdfedClip.tickResolve) { pdfedClip.tickResolve(); pdfedClip.tickResolve = null; }
  if (pdfedClip.recorder && pdfedClip.recorder.state !== 'inactive') {
    pdfedClip.chunks = [];
    try { pdfedClip.recorder.stop(); } catch (e) {}
  }
  pdfedClip.rendering = false;
  document.getElementById('pdfedClipProgressOverlay').classList.remove('open');
  toast('Clip export cancelled', 'error');
}


// ─── LIVE CLIPS: document-level rules + frame compositing for the MP4 presentation ───
// A page that holds a live clip (a placed image carrying a `clip` spec, made in Product
// Presenter) keeps moving on screen. A still format (PDF, PNG, Word, Excel, CSV) cannot hold
// motion, so a document with live clips can ONLY be downloaded as an MP4 presentation.
function pdfedPageHasLive(pg) { return !!(pg && (pg.placedImages || []).some(function (it) { return it && it.clip; })); }
function pdfedDocHasLive(indices) {
  const idxs = (indices && indices.length) ? indices : pdfed.pages.map(function (_, i) { return i; });
  return idxs.some(function (i) { return pdfedPageHasLive(pdfed.pages[i]); });
}
function pdfedLiveBlock(indices) {
  if (!pdfedDocHasLive(indices)) return false;
  toast('This document has live clips, so it can only be downloaded as an MP4 presentation. Use Export, then Slideshow Clip.', 'error');
  return true;
}

// Splits one page into stacked pictures so live clips can be slotted in at the right depth:
// layers[0] = background + everything under the first clip, layers[k] = everything between clip k-1
// and clip k (the last also carries pen/highlighter marks). Live clips themselves are left out.
async function pdfedComposeLiveLayers(pg) {
  const baseUrl = await pdfedFlattenPageDataUrl(pg);
  const baseImg = await new Promise(function (res, rej) { const im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = baseUrl; });
  const W = baseImg.naturalWidth, H = baseImg.naturalHeight;
  pdfedGetZOrderedItems(pg); // seeds zIndex on legacy items
  const clips = (pg.placedImages || []).filter(function (it) { return it && it.clip; }).sort(function (a, b) { return a.zIndex - b.zIndex; });
  await pdfedEnsureFontsLoaded(pg);
  const layers = [];
  for (let k = 0; k <= clips.length; k++) {
    const lo = k === 0 ? -Infinity : clips[k - 1].zIndex, hi = k === clips.length ? Infinity : clips[k].zIndex;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    if (k === 0) x.drawImage(baseImg, 0, 0);
    await pdfedDrawOrderedPlacedOnCtx(x, pg, false, false, function (kind, item) {
      if (kind === 'image' && item.clip) return false;
      return item.zIndex >= lo && item.zIndex < hi;
    });
    if (k === clips.length && pg.annotStrokes && pg.annotStrokes.length) {
      try {
        const ai = await new Promise(function (res, rej) { const im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = pg.annotStrokes[pg.annotStrokes.length - 1]; });
        x.drawImage(ai, 0, 0, W, H);
      } catch (e) { /* skip marks that fail to decode */ }
    }
    layers.push(c);
  }
  return { w: W, h: H, layers: layers, clips: clips };
}

// A page whose picture is re-drawn per frame: page layers, with each live clip rendered at time tSec.
async function pdfedBuildLivePage(pg, cw, ch) {
  const L = await pdfedComposeLiveLayers(pg);
  let f = Math.min(cw / L.w, ch / L.h) * 1.035; if (f > 3) f = 3;   // may exceed 1 so the live clip is drawn at the real output size, not stretched up from a small page
  const can = document.createElement('canvas');
  can.width = Math.max(2, Math.round(L.w * f)); can.height = Math.max(2, Math.round(L.h * f));
  can._ow = L.w; can._oh = L.h;
  const g = can.getContext('2d'), k = can.width / L.w, tmp = {};
  // LAG FIX (big custom-size pages): the layers come out at the full page size (can be thousands of px).
  // Drawing a huge canvas down to a thumbnail on every frame is very heavy, so shrink each layer ONCE here
  // and let the per-frame update only touch thumbnail-sized pictures. Full-size copies are then released.
  const small = L.layers.map(function (src) {
    const c = document.createElement('canvas'); c.width = can.width; c.height = can.height;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src.width = 1; src.height = 1;   // free the big bitmap right away
    return c;
  });
  L.layers = small;
  await Promise.all(L.clips.map(function (it) { return sppLiveReady(it.clip); }));
  // Same safety net the page canvas has: if a clip cannot draw a frame, show its still picture instead of a hole.
  const posters = await Promise.all(L.clips.map(function (it) {
    return new Promise(function (res) { if (!it.dataUrl) { res(null); return; } const im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = it.dataUrl; });
  }));
  const warned = {};
  function drawClipFrame(it, j, ox, tw, th, tSec) {
    let ok = false;
    try { ok = sppLiveFrame(it.clip, ox, tw, th, tSec); }
    catch (err) { if (!warned[j]) { warned[j] = true; console.warn('[Workspace] a live clip frame failed, showing its still picture instead', err); } }
    if (!ok && posters[j]) { ox.clearRect(0, 0, tw, th); ox.drawImage(posters[j], 0, 0, tw, th); }
  }
  function update(tSec, fromThumb) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, can.width, can.height);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(L.layers[0], 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    L.clips.forEach(function (it, j) {
      const ar = (it.w > 0 && it.h > 0) ? it.w / it.h : sppLiveAspect(it.clip), tw = Math.max(64, Math.min(1920, Math.round(it.w * k))), th = Math.max(36, Math.round(tw / ar));
      let oc = tmp[j];
      if (!oc || oc.width !== tw || oc.height !== th) { oc = tmp[j] = document.createElement('canvas'); oc.width = tw; oc.height = th; }
      const mc = (fromThumb && typeof sppLiveMountedCanvas === 'function') ? sppLiveMountedCanvas(it.clip) : null;   // thumbnail only: export and slideshow always render the exact frame
      let src = oc;
      if (mc) { src = mc; }   // already drawn on the page canvas this frame: just copy it
      else { const ox = oc.getContext('2d'); ox.clearRect(0, 0, tw, th); drawClipFrame(it, j, ox, tw, th, tSec); }
      g.save();
      g.globalAlpha = pdfedGetOpacity(it);
      if (it.rotation) { const cx = it.x + it.w / 2, cy = it.y + it.h / 2; g.translate(cx, cy); g.rotate(it.rotation * Math.PI / 180); g.translate(-cx, -cy); }
      g.drawImage(src, it.x, it.y, it.w, it.h);
      g.restore();
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(L.layers[j + 1], 0, 0); g.restore();
    });
  }
  update(0);
  return { canvas: can, update: update };
}

// Wrapper so Export Clip can never fail silently: any error is shown to the person, the progress card is
// closed, and the "already rendering" flag is cleared (a stuck flag made every later click do nothing).
async function pdfedRunClipExport() {
  const prog = document.getElementById('pdfedClipProgressOverlay');
  if (pdfedClip.rendering && !(prog && prog.classList.contains('open'))) pdfedClip.rendering = false; // stale flag from an earlier failed run
  if (pdfedClip.rendering) { toast('A clip is already being rendered. Wait for it to finish or press Cancel export.', 'info'); return; }
  try {
    await pdfedRunClipExportInner();
  } catch (err) {
    console.error('[Workspace] Export Clip failed', err);
    pdfedClip.rendering = false;
    try { if (pdfedClip.raf) cancelAnimationFrame(pdfedClip.raf); } catch (e) {}
    try { if (pdfedClip.recorder && pdfedClip.recorder.state !== 'inactive') pdfedClip.recorder.stop(); } catch (e) {}
    if (prog) prog.classList.remove('open');
    toast('Clip export failed: ' + ((err && err.message) ? err.message : 'unknown error') + '. Press F12 and check the Console for details.', 'error');
    throw err; // lets the free-export gate skip its "Export complete" message for a run that failed
  }
}
async function pdfedRunClipExportInner() {
  if (pdfedClip.rendering) return;
  const input = document.getElementById('pdfedClipSeconds');
  let secs = parseFloat(input && input.value);
  if (!isFinite(secs) || secs <= 0) secs = 3.2;
  secs = Math.min(10, Math.max(1, secs));
  pdfedClip.secondsPerSlide = secs;

  const indices = pdfedSlideshow.indices.slice();
  if (!indices.length) { toast('No pages to export', 'error'); return; }
  if (!window.MediaRecorder) { toast('Video export is not supported in this browser', 'error'); return; }

  const mime = pdfedClipPickMime();
  pdfedCloseClipPanel();
  pdfedClip.rendering = true;
  pdfedClip.cancelled = false;
  pdfedClip.chunks = [];
  document.getElementById('pdfedClipProgressOverlay').classList.add('open');
  pdfedClipSetProgress(0, 'Preparing slides\u2026');

  // Preload every slide's exact export-quality image up front (same
  // compositor the preview and the real PDF export both use) so recording
  // itself never stalls waiting on a render mid-clip.
  const images = [];
  const avgColors = [];
  for (let i = 0; i < indices.length; i++) {
    if (pdfedClip.cancelled) return;
    let img = null;
    try {
      const url = await pdfedSlideshowGetImage(indices[i]);
      img = await pdfedClipLoadImage(url);
    } catch (e) { img = null; }
    images.push(img);
    avgColors.push((pdfedClip.background === 'match' && img) ? pdfedClipAvgColor(img) : null);
    if (pdfedClip.cancelled) return;
    pdfedClipSetProgress((i + 1) / indices.length * 0.25, 'Preparing slide ' + (i + 1) + ' of ' + indices.length);
  }

  // "Widescreen" gives a fixed 1080p 16:9 frame (each page letterboxed to
  // fit inside it) so the clip matches a meeting screen or slide-deck slot
  // exactly; "Original shape" instead follows the pages' own aspect ratio.
  let cw, ch;
  if (pdfedClip.frame === 'widescreen') {
    cw = 1920; ch = 1080;
  } else {
    const first = images.find(Boolean) || { naturalWidth: 1280, naturalHeight: 720 };
    const MAX_EDGE = 1600;
    cw = first.naturalWidth; ch = first.naturalHeight;
    const longEdge = Math.max(cw, ch);
    if (longEdge > MAX_EDGE) { const s = MAX_EDGE / longEdge; cw = Math.round(cw * s); ch = Math.round(ch * s); }
  }

  cw -= cw % 2; ch -= ch % 2;
  for (let i = 0; i < images.length; i++) { images[i] = pdfedClipPrep(images[i], cw, ch); }

  // Pages with live clips: swap the still picture for a canvas that is re-drawn for every frame,
  // so the clip keeps moving inside the MP4 (and moves through the page transitions too).
  const liveCtl = {};
  let hasLiveClips = false;
  for (let i = 0; i < images.length; i++) {
    const pgL = pdfed.pages[indices[i]];
    if (!pdfedPageHasLive(pgL)) continue;
    hasLiveClips = true;
    pdfedClipSetProgress(0.25, 'Preparing live clips\u2026');
    try { const lp = await pdfedBuildLivePage(pgL, cw, ch); liveCtl[i] = lp; images[i] = lp.canvas; }
    catch (e) { console.warn('[Workspace] live clip page failed, using still', e); }
    if (pdfedClip.cancelled) return;
  }
  const vidByPage = {}; let hasVid = false;
  for (let i = 0; i < images.length; i++) {
    const its = ((pdfed.pages[indices[i]] || {}).placedImages || []).filter(function (it) { return it && it.clip && it.clip.vid; });
    if (its.length) { vidByPage[i] = its; hasVid = true; }
  }
  let liveWarned = false;
  const liveUpdate = function (i, sec) { if (liveCtl[i]) { try { liveCtl[i].update(sec); } catch (e) { if (!liveWarned) { liveWarned = true; console.warn('[Workspace] live page frame failed during export', e); } } } };

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  pdfedClipDrawFrame(ctx, cw, ch, images, 0, null, 1, 0, avgColors);

  // Each slide has its own length: slides holding live clips can run longer so the clip plays its whole story.
  const durs = pdfedClipSlideDurations(indices, secs);
  const starts = []; let totalMs = 0;
  durs.forEach(function (d) { starts.push(totalMs); totalMs += d; });

  // One function decides what any moment of the clip looks like. Both the offline encoder and the
  // live-recorder fallback use it, so the two always show the same thing.
  function renderAt(vt) {
    const last = images.length - 1;
    if (vt >= totalMs) { liveUpdate(last, durs[last] / 1000); pdfedClipDrawFrame(ctx, cw, ch, images, last, null, 1, 1, avgColors); return last; }
    let idx = 0;
    while (idx < last && vt >= starts[idx + 1]) idx++;
    const slideMs = durs[idx], localMs = vt - starts[idx];
    liveUpdate(idx, localMs / 1000);
    const zoomT = Math.min(1, localMs / slideMs);
    let alpha = 1, prevIdx = null;
    const gapFx = idx > 0 ? pdfedAnimGet(pdfed.pages[indices[idx - 1]]) : null;
    const tMs = gapFx ? Math.min(gapFx.ms, slideMs * 0.5) : Math.min(600, slideMs * 0.3);
    if (idx > 0 && localMs < tMs && !(gapFx && gapFx.type === 'none')) { prevIdx = idx - 1; alpha = localMs / tMs; liveUpdate(prevIdx, (durs[idx - 1] + localMs) / 1000); }
    try { pdfedClipDrawFrame(ctx, cw, ch, images, idx, prevIdx, alpha, zoomT, avgColors, gapFx); }
    catch (e1) { try { pdfedClipDrawFrame(ctx, cw, ch, images, idx, null, 1, zoomT, avgColors); } catch (e2) {} }
    return idx;
  }
  // Uploaded clips: before each output frame, put every clip that frame shows at its exact time (same slide / crossfade logic as renderAt).
  async function liveSeekAt(vt) {
    const last = images.length - 1, jobs = [];
    const add = function (pi, sec) { (vidByPage[pi] || []).forEach(function (it) { jobs.push(sppLiveSeek(it.clip, sec)); }); };
    if (vt >= totalMs) { add(last, durs[last] / 1000); }
    else {
      let idx = 0; while (idx < last && vt >= starts[idx + 1]) idx++;
      const slideMs = durs[idx], localMs = vt - starts[idx]; add(idx, localMs / 1000);
      const gapFx = idx > 0 ? pdfedAnimGet(pdfed.pages[indices[idx - 1]]) : null;
      const tMs = gapFx ? Math.min(gapFx.ms, slideMs * 0.5) : Math.min(600, slideMs * 0.3);
      if (idx > 0 && localMs < tMs && !(gapFx && gapFx.type === 'none')) add(idx - 1, (durs[idx - 1] + localMs) / 1000);
    }
    if (jobs.length) { try { await Promise.all(jobs); } catch (e) { console.warn('[Workspace] clip seek failed', e); } }
  }
  const yieldNow = function () { return new Promise(function (r) { const mc = new MessageChannel(); mc.port1.onmessage = function () { r(); }; mc.port2.postMessage(0); }); };
  const paintNow = function () { return new Promise(function (r) { let d = false; const f = function () { if (!d) { d = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); }); };

  let blob = null, isMp4 = true;

  // ---- Path 1: offline render straight into an MP4. Frames are made one by one at exact times,
  // so the result is perfectly even no matter how fast or slow this computer is, and it does not
  // care if the tab is in the background. This is the smooth, presentable one.
  const canWC = (typeof VideoEncoder !== 'undefined') && (typeof VideoFrame !== 'undefined') && (typeof Mp4Muxer !== 'undefined');
  let smoothFailed = false;
  if (canWC) for (const fpsList of (hasVid ? [[30]] : [[60, 30], [30]])) {   // if the 60 fps pass fails part-way, try again at 30 fps before falling back
    let enc = null, encErr = null, triedFps = 0;
    try {
      let chosen = null;
      for (const fps of fpsList) {
        const bitrate = Math.round(Math.max(4e6, Math.min(16e6, cw * ch * fps * (hasVid ? 0.16 : 0.09))));
        for (const codec of ['avc1.64002A', 'avc1.640033', 'avc1.4D002A', 'avc1.42002A']) {
          let sup = null;
          try { sup = await VideoEncoder.isConfigSupported({ codec: codec, width: cw, height: ch, bitrate: bitrate, framerate: fps }); } catch (e) { sup = null; }
          if (sup && sup.supported) { chosen = { fps: fps, codec: codec, bitrate: bitrate }; break; }
        }
        if (chosen) break;
      }
      if (!chosen) throw new Error('no H.264 encoder here');
      const fps = chosen.fps, totalFrames = Math.max(2, Math.round(totalMs / 1000 * fps));
      triedFps = fps;
      const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: cw, height: ch, frameRate: fps }, fastStart: 'in-memory' });
      enc = new VideoEncoder({ output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); }, error: function (e) { encErr = e; } });
      enc.configure({ codec: chosen.codec, width: cw, height: ch, bitrate: chosen.bitrate, framerate: fps });
      for (let i = 0; i < totalFrames; i++) {
        if (pdfedClip.cancelled) { try { enc.close(); } catch (e) {} return; }
        if (encErr) throw encErr;
        if (hasVid) await liveSeekAt(i * 1000 / fps);
        const idx = renderAt(i * 1000 / fps);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        let guard = 0;
        while (enc.encodeQueueSize > 8 && guard++ < 400) { await new Promise(function (r) { enc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 30); }); }
        if (i % 20 === 0) {
          pdfedClipSetProgress(0.25 + (i / totalFrames) * 0.7, 'Rendering slide ' + (idx + 1) + ' of ' + images.length);
          await paintNow();
        } else if (i % 4 === 0) { await yieldNow(); }
      }
      await enc.flush();
      if (encErr) throw encErr;
      try { enc.close(); } catch (e) {}
      muxer.finalize();
      blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } catch (e) {
      console.warn('[Workspace] offline MP4 render failed' + (triedFps === 60 ? ', retrying at 30 fps' : ''), e);
      try { if (enc && enc.state !== 'closed') enc.close(); } catch (e2) {}
      blob = null; smoothFailed = true;
    }
    if (pdfedClip.cancelled) return;
    if (blob || triedFps !== 60) break;
  }

  // ---- Path 2 (fallback for browsers without WebCodecs): record the canvas live. Runs on its own
  // frame clock so a slow moment can never skip a page, and pauses if the tab is hidden.
  if (!blob) {
    if (smoothFailed) toast('The smooth renderer could not finish on this computer, so the clip is being recorded live instead. Keep this tab in front, and motion may be a little less even.', 'info');
    pdfedClipSetProgress(0.25, 'Recording clip\u2026');
    const FPS = 30, stepMin = 1000 / FPS;
    renderAt(0);
    let stream = canvas.captureStream(0);
    let track = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track || typeof track.requestFrame !== 'function') { stream = canvas.captureStream(FPS); track = null; }
    const pushFrame = function () { if (track) { try { track.requestFrame(); } catch (e) {} } };
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
    pdfedClip.recorder = recorder;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) pdfedClip.chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    pushFrame();
    const tailMs = 300;
    let vt = 0, lastReal = null, nFrames = 0, hiddenPaused = false;
    const onVis = function () {
      if (document.hidden) { if (recorder.state === 'recording') { try { recorder.pause(); hiddenPaused = true; } catch (e) {} } }
      else if (hiddenPaused) { try { recorder.resume(); } catch (e) {} hiddenPaused = false; lastReal = null; }
    };
    document.addEventListener('visibilitychange', onVis);
    await new Promise((resolve) => {
      pdfedClip.tickResolve = resolve;
      function tick(now) {
        if (pdfedClip.cancelled) return;
        if (lastReal !== null && now - lastReal < stepMin - 5) { pdfedClip.raf = requestAnimationFrame(tick); return; }
        const dt = lastReal === null ? stepMin : Math.min(now - lastReal, 70);
        lastReal = now; vt += dt;
        try {
          const idx = renderAt(vt); pushFrame();
          if (vt >= totalMs + tailMs) { pdfedClipSetProgress(1, 'Finishing\u2026'); pdfedClip.tickResolve = null; resolve(); return; }
          if ((nFrames++ % 6) === 0) pdfedClipSetProgress(0.25 + Math.min(1, vt / totalMs) * 0.7, 'Recording slide ' + (idx + 1) + ' of ' + images.length + ' (keep this tab open)');
        } catch (e) { /* one bad frame never ends the recording */ }
        pdfedClip.raf = requestAnimationFrame(tick);
      }
      pdfedClip.raf = requestAnimationFrame(tick);
    });
    document.removeEventListener('visibilitychange', onVis);
    if (hiddenPaused) { try { recorder.resume(); } catch (e) {} }
    if (pdfedClip.cancelled) return;
    pdfedClip.raf = null;
    try { recorder.stop(); } catch (e) {}
    await stopped;
    if (pdfedClip.cancelled) return;
    isMp4 = mime.indexOf('mp4') !== -1;
    blob = new Blob(pdfedClip.chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  }

  if (hasLiveClips && !isMp4) {
    pdfedClip.rendering = false;
    document.getElementById('pdfedClipProgressOverlay').classList.remove('open');
    toast('This browser cannot create an MP4 file. Live-clip documents download as MP4 only, so please try Chrome, Edge or Safari (latest).', 'error');
    return;
  }
  const baseName = (pdfed.file && pdfed.file.name) ? pdfed.file.name.replace(/\.pdf$/i, '') : 'SARVARC-Slideshow';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName + '-clip' + (isMp4 ? '.mp4' : '.webm');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  pdfedClip.rendering = false;
  document.getElementById('pdfedClipProgressOverlay').classList.remove('open');
  toast('Clip exported', 'success');
}

async function pdfedRunExportFromModal() {
  const total = pdfed.pages.length;
  const mode = pdfedExportPagesMode;
  let indices;
  if (mode === 'custom') {
    const raw = document.getElementById('pdfedExportRangeInput').value.trim();
    const err = document.getElementById('pdfedExportRangeError');
    if (!raw) { err.textContent = 'Enter a page range, e.g. 1-5, 8'; err.style.display = 'block'; return; }
    indices = pdfedParsePageRange(raw, total);
    if (!indices.length) { err.textContent = 'No valid pages found in that range (1–' + total + ')'; err.style.display = 'block'; return; }
  } else {
    indices = pdfed.pages.map((_, i) => i);
  }
  if (pdfedExportModalFmt !== 'video' && pdfedLiveBlock(indices)) return;

  // Password protection: only relevant for the real PDF format, and only
  // once the person has ticked the checkbox. A ticked box with an empty
  // password is almost certainly a mistake, so catch it before we close the
  // modal rather than silently exporting an unprotected file.
  let exportPassword = null;
  if (pdfedExportModalFmt === 'pdf' && document.getElementById('pdfedExportPasswordToggle').checked) {
    const pw = document.getElementById('pdfedExportPasswordInput').value;
    if (!pw) {
      const perr = document.getElementById('pdfedExportPasswordError');
      perr.textContent = 'Enter a password, or untick password protection';
      perr.style.display = 'block';
      return;
    }
    exportPassword = pw;
  }

  // Persist the format choice only if the person opted in.
  try {
    const remember = document.getElementById('pdfedExportRemember').checked;
    if (remember) localStorage.setItem('sarvarcExportPrefs', JSON.stringify({ remember: true, fmt: pdfedExportModalFmt }));
    else localStorage.removeItem('sarvarcExportPrefs');
  } catch(e) {}

  pdfedCloseExportModal();
  if (pdfedExportModalFmt === 'pdf') await pdfedExport(indices, exportPassword);
  else if (pdfedExportModalFmt === 'csv') await pdfedExportCSV(indices);
  else if (pdfedExportModalFmt === 'xlsx') await pdfedExportXLSX(indices);
  else if (pdfedExportModalFmt === 'docx') await pdfedExportDOCX(indices);
  else if (pdfedExportModalFmt === 'image') await pdfedExportImages(indices);
}

// Slideshow Clip is a preview-first format, not an instant file hand-off, so
// it's kept out of sarvarcGateExport entirely here — opening the preview
// isn't an export yet, and gating it would fire the free-export
// count/watermark/"Export complete" messaging before anyone has actually
// rendered anything. The real gate for it sits on the clip panel's own
// "Export Clip" button, at the point a file is actually produced.
async function pdfedHandleExportClick() {
  if (pdfedExportModalFmt === 'video') {
    pdfedCloseExportModal();
    // Export is an explicit "make me a file" click, so go straight to the clip settings (seconds per slide,
    // frame, motion) with its Export Clip button, on top of the slideshow. Previously this only opened the
    // preview and the person had to find a small camera icon that fades away when idle, which read as
    // "I clicked Export and nothing happened".
    await pdfedOpenSlideshow();
    try { pdfedOpenClipPanel(); } catch (e) { console.warn('[Workspace] could not open clip panel', e); }
    return;
  }
  sarvarcGateExport(pdfedRunExportFromModal);
}

function pdfedDownloadBlob(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = sarvarcBrandFilename(fname);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

// Renders the selected pages exactly like the PDF export path (same
// pdfedComposeThumb compositor, so placed images/text/tables/annotations are
// all baked in identically) and saves them as PNG image files — one plain
// download if there's a single page, or a ZIP bundle if there's more than one.
async function pdfedExportImages(pageIndices) {
  if (pdfedLiveBlock(pageIndices)) return;
  if (pdfed.pages.length === 0) { toast('No PDF loaded', 'error'); return; }
  pdfedAutoStampPendingGhost();
  await pdfedFinalizePendingCanvasTint();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e) {}
  const indices = (pageIndices && pageIndices.length) ? pageIndices : pdfed.pages.map((_, i) => i);
  const total = indices.length;
  const base = (pdfed.file ? pdfed.file.name.replace(/\.pdf$/i, '') : 'workspace');
  showExportOverlay('Exporting images…', total > 1 ? `Rendering page 1 of ${total}…` : 'Rendering page…');
  try {
    if (total === 1) {
      const i = indices[0];
      const pg = pdfed.pages[i];
      updateExportProgress(50, 'Rendering page…');
      let url = await pdfedComposeThumb(pg, i);
      if (!url) { hideExportOverlay(); toast('Nothing to export', 'error'); return; }
      if (window.sarvarcApplyFreeWatermark) url = await sarvarcStampDataUrlWatermark(url);
      const res = await fetch(url);
      const blob = await res.blob();
      updateExportProgress(95, 'Saving file…');
      pdfedDownloadBlob(blob, base + '_page' + (i + 1) + '.png');
      state.stats.exports++;
      updateStats();
      completeExportOverlay('1 page exported', { module: 'pdf_editor', format: 'image' });
      toast('Exported 1 image', 'success');
    } else {
      const zip = new JSZip();
      for (let k = 0; k < total; k++) {
        const i = indices[k];
        const pg = pdfed.pages[i];
        if (!pg) continue;
        updateExportProgress((k / total) * 80, `Rendering page ${k + 1} of ${total}…`);
        let url = await pdfedComposeThumb(pg, i);
        if (!url) continue;
        if (window.sarvarcApplyFreeWatermark) url = await sarvarcStampDataUrlWatermark(url);
        const b64 = url.split(',')[1];
        zip.file(base + '_page' + (i + 1) + '.png', b64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        updateExportProgress(80 + metadata.percent * 0.18, `Compressing… ${Math.round(metadata.percent)}%`);
      });
      pdfedDownloadBlob(blob, base + '_pages.zip');
      state.stats.exports += total;
      updateStats();
      completeExportOverlay(total + ' pages exported', { module: 'pdf_editor', format: 'image' });
      toast('Exported ' + total + ' images', 'success');
    }
    pdfedQueueAutoContinueAfter();
  } catch(e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

// ── Smart table extraction ───────────────────────────────────────────────────
// Pulls table-worthy content from every source a page can actually have data
// in, in reading order (top to bottom):
//   1. Insert Table boxes (pg.placedTables) — already perfect rows/cols, used verbatim.
//   2. Add Text boxes (pg.placedTexts) — each becomes its own row (one cell per line).
//   3. The underlying PDF's real text layer (pg.type === 'pdf' only) — reconstructed
//      into rows/columns by clustering glyph runs with near-identical Y, then
//      splitting into columns wherever the horizontal gap between runs is bigger
//      than the local text's own letter-spacing.
// A page returns null only if NONE of these sources exist at all (a pure image
// page with no table/text/text-layer), which is what triggers the "skipped"
// count; it returns [] if sources exist but happened to be empty.
function pdfedStripHtmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\u00a0/g, ' ');
}

async function pdfedExtractPdfTextRows(pg) {
  if (!pg || pg.type !== 'pdf') return [];
  const doc = pg.srcDoc || pdfed.pdfDoc;
  if (!doc) return [];
  try {
    const page = await doc.getPage(pg.pageNum);
    const tc = await page.getTextContent();
    const items = tc.items
      .map(it => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || Math.abs(it.transform[0]) * Math.max(1, it.str.length) * 0.5
      }))
      .filter(it => it.str.trim() !== '');
    if (!items.length) return [];
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    // group into rows: items whose y sits within a small tolerance of each other
    const rows = [];
    const rowTol = 3;
    for (const it of items) {
      let row = rows.find(r => Math.abs(r.y - it.y) <= rowTol);
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(row => {
      row.items.sort((a, b) => a.x - b.x);
      const widths = row.items.map(it => it.w).filter(w => w > 0);
      widths.sort((a, b) => a - b);
      const medianW = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
      // a gap wider than ~2.2x the row's own median glyph-run width reads as a
      // column boundary rather than a normal space between words
      const gapThreshold = Math.max(9, medianW * 2.2);
      const cells = [];
      let cur = '', lastEndX = null;
      for (const it of row.items) {
        if (lastEndX !== null && (it.x - lastEndX) > gapThreshold) {
          cells.push(cur.trim());
          cur = it.str;
        } else if (!cur) {
          cur = it.str;
        } else {
          cur += (cur.endsWith(' ') || it.str.startsWith(' ')) ? it.str : (' ' + it.str);
        }
        lastEndX = it.x + (it.w || 0);
      }
      if (cur) cells.push(cur.trim());
      return cells;
    });
  } catch (e) {
    console.error('pdfedExtractPdfTextRows failed', e);
    return [];
  }
}

async function pdfedExtractPageRows(pg) {
  if (!pg) return null;
  const hasTables = pg.placedTables && pg.placedTables.length;
  const hasTexts = pg.placedTexts && pg.placedTexts.length;
  const isPdfPage = pg.type === 'pdf';
  if (!hasTables && !hasTexts && !isPdfPage) return null;

  // blocks are collected with a top-down Y so everything interleaves in the
  // order it actually reads on the page, then flattened into plain rows
  const blocks = [];

  (pg.placedTexts || []).forEach(tb => {
    const raw = tb.html ? pdfedStripHtmlToText(tb.html) : (tb.text || '');
    raw.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, li) => {
      blocks.push({ y: (tb.y || 0) + li, rows: [[line]] });
    });
  });

  (pg.placedTables || []).forEach(t => {
    if (t.cells && t.cells.length) {
      blocks.push({ y: t.y || 0, rows: t.cells.map(r => r.map(c => (c == null ? '' : String(c)))) });
    }
  });

  if (isPdfPage) {
    const pdfRows = await pdfedExtractPdfTextRows(pg);
    // PDF text-layer Y is in PDF user-space (origin bottom-left, y grows upward),
    // the opposite of the placed-item canvas space above (origin top-left) — so
    // these rows are appended as their own block after the placed content
    // rather than false-sorted against it, which would put them in the wrong
    // order relative to canvas-space items on the same page.
    if (pdfRows.length) blocks.push({ y: Infinity, rows: pdfRows });
  }

  if (!blocks.length) return [];
  blocks.sort((a, b) => a.y - b.y);
  const allRows = [];
  blocks.forEach(b => allRows.push(...b.rows));
  return allRows;
}

async function pdfedCollectTableRows(indices) {
  const allRows = [];
  let skippedPages = 0;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const pg = pdfed.pages[i];
    updateExportProgress((k / indices.length) * 80, `Reading page ${k + 1} of ${indices.length}…`);
    const rows = await pdfedExtractPageRows(pg);
    if (rows === null) { skippedPages++; continue; }
    if (rows.length) allRows.push(...rows);
  }
  return { allRows, skippedPages };
}

function pdfedRowsToCSV(rows) {
  return rows.map(r => r.map(c => {
    const s = (c === undefined || c === null) ? '' : String(c);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

async function pdfedExportCSV(indices) {
  if (pdfedLiveBlock(indices)) return;
  if (!pdfed.pages.length) { toast('No PDF loaded', 'error'); return; }
  showExportOverlay('Exporting CSV…', 'Reading page text…');
  try {
    const { allRows, skippedPages } = await pdfedCollectTableRows(indices);
    if (!allRows.length) { hideExportOverlay(); toast('No extractable text found on selected pages', 'error'); return; }
    updateExportProgress(90, 'Building CSV…');
    const csv = pdfedRowsToCSV(allRows);
    const csvOut = window.sarvarcApplyFreeWatermark ? (csv + '\n\n' + SARVARC_WATERMARK_TEXT) : csv;
    // Leading BOM so Excel opens the CSV with correct UTF-8 encoding instead
    // of mangling non-ASCII characters (drug names, GST fields, etc).
    const blob = new Blob(['\uFEFF' + csvOut], { type: 'text/csv;charset=utf-8;' });
    const fname = (pdfed.file ? pdfed.file.name.replace(/\.pdf$/i, '') : 'export') + '.csv';
    pdfedDownloadBlob(blob, fname);
    state.stats.exports++;
    updateStats();
    completeExportOverlay('CSV exported', { module: 'pdf_editor', format: 'csv' });
    toast('Exported ' + allRows.length + ' rows to CSV' + (skippedPages ? ` (${skippedPages} image page(s) skipped)` : ''), 'success');
  } catch (e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}
