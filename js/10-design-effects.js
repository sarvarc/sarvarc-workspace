// ─── DESIGN — CINEMATIC FADE ───────────────────────────────────────────
// Applies a premium fade/border look to a selected placed image, baked
// directly into its pixels (same destructive-bake + pushAppHistory pattern
// as Image Reshaper above) so it needs no special handling anywhere else —
// export, thumbnails, and reload all just see a PNG with the right alpha.
//
// Each preset works by drawing a black→opaque gradient onto the image's own
// canvas with globalCompositeOperation 'destination-in', which multiplies
// the image's existing alpha by the gradient's alpha at every pixel. Where
// the gradient is 0 (transparent black) the pixel disappears; where it's 1
// the pixel is untouched. Chaining several of these (e.g. all 4 edges for
// Feather) naturally intersects them, since alpha keeps getting multiplied
// down — no separate mask canvas or per-pixel math needed.
const PDFED_DESIGN_PRESETS = [
  { id: 'feather',   name: 'Feather',
    icon: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>' },
  { id: 'vignette',  name: 'Vignette',
    icon: '<circle cx="12" cy="12" r="8.5" opacity="0.45"/><circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/>' },
  { id: 'fadeIn',    name: 'Fade In',
    icon: '<path d="M12 4v12"/><path d="M6 12l6 6 6-6"/>' },
  { id: 'fadeOut',   name: 'Fade Out',
    icon: '<path d="M12 20V8"/><path d="M6 12l6-6 6 6"/>' },
  { id: 'fadeLeft',  name: 'Fade Left',
    icon: '<path d="M4 12h12"/><path d="M12 6l-6 6 6 6"/>' },
  { id: 'fadeRight', name: 'Fade Right',
    icon: '<path d="M20 12H8"/><path d="M12 6l6 6-6 6"/>' },
  { id: 'filmstrip', name: 'Film Strip',
    icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 8.5h17M3.5 15.5h17"/>' },
  { id: 'diagonal',  name: 'Diagonal',
    icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M5 19L19 5"/>' },
  // ── Premium 3D Cinematic tier ──────────────────────────────────────────
  // Heavier, layered effects (embossed 3D borders, true widescreen
  // letterboxing, real per-channel chromatic aberration, film grain) built
  // by combining several native canvas blend modes rather than a single
  // alpha gradient — the same trick colour grading suites use, one click.
  { id: 'cinemaBars', name: 'CinemaScope', premium: true,
    icon: '<rect x="2.5" y="5" width="19" height="3" fill="currentColor" stroke="none"/><rect x="2.5" y="16" width="19" height="3" fill="currentColor" stroke="none"/>' },
  { id: 'depth3d', name: '3D Depth Frame', premium: true,
    icon: '<rect x="7" y="7" width="13.5" height="13.5" rx="1.5"/><rect x="3.5" y="3.5" width="13.5" height="13.5" rx="1.5" opacity="0.5"/>' },
  { id: 'goldenGrade', name: 'Golden Hour', premium: true,
    icon: '<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7L5.6 5.6"/>' },
  { id: 'chromaPulse', name: 'Chroma Edge', premium: true,
    icon: '<circle cx="9.2" cy="12" r="5.3"/><circle cx="14.8" cy="12" r="5.3"/>' },
  { id: 'noirGrain', name: 'Film Noir', premium: true,
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>' },
  // ── Cosmic tier ─────────────────────────────────────────────────────
  // Space/night-sky looks aimed at freelancers and graphic designers —
  // event posters, album art, social headers, portfolio covers. Same
  // gradient + blend-mode + per-pixel-noise toolkit as the tier above,
  // just built around cool violet/teal/indigo palettes and a couple of
  // new primitives (star specks, a corona ring) rather than orange/gold.
  { id: 'nebulaGlow', name: 'Nebula Glow', cosmic: true,
    icon: '<circle cx="9" cy="10" r="6" opacity="0.55"/><circle cx="15.5" cy="14.5" r="6" opacity="0.55"/>' },
  { id: 'galaxyGrade', name: 'Galaxy Grade', cosmic: true,
    icon: '<path d="M12 4a8 8 0 1 0 8 8"/><path d="M12 8a4 4 0 1 0 4 4"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>' },
  { id: 'aurora', name: 'Aurora', cosmic: true,
    icon: '<path d="M3 9c3-3 6 3 9 0s6-3 9 0"/><path d="M3 15c3-3 6 3 9 0s6-3 9 0"/>' },
  { id: 'starfield', name: 'Starfield', cosmic: true,
    icon: '<path d="M12 3.5l1.5 3.8 3.8 1.5-3.8 1.5-1.5 3.8-1.5-3.8L6.7 8.8l3.8-1.5z"/><circle cx="18.5" cy="17" r="1.1" fill="currentColor" stroke="none"/><circle cx="5.5" cy="16" r="1" fill="currentColor" stroke="none"/>' },
  { id: 'deepSpaceVignette', name: 'Deep Space', cosmic: true,
    icon: '<circle cx="12" cy="12" r="9" opacity="0.6"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>' },
  { id: 'eclipseRing', name: 'Eclipse Ring', cosmic: true,
    icon: '<circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7.8"/>' },
  { id: 'timeBend', name: 'Time Bend', cosmic: true,
    icon: '<path d="M4 12a8 8 0 1 1 8 8"/><path d="M8 12a4 4 0 1 1 4 4"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>' },
  { id: 'timeStretch', name: 'Time Stretch', cosmic: true,
    icon: '<path d="M4 4l5.5 5.5"/><path d="M20 4l-5.5 5.5"/><path d="M4 20l5.5-5.5"/><path d="M20 20l-5.5-5.5"/><circle cx="12" cy="12" r="1.7"/>' }
];
let pdfedDesignState = { preset: 'feather', strength: 50 };

function pdfedDesignEdgeGradient(ctx, w, h, x0, y0, x1, y1) {
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

// Shifts the red channel one way and the blue channel the other way (green
// stays put), producing genuine per-channel chromatic aberration rather
// than a fake color overlay — the same artifact real anamorphic lenses
// produce toward the edges of frame.
function pdfedDesignChromaShift(ctx, w, h, amount) {
  const src = ctx.getImageData(0, 0, w, h);
  const sd = src.data;
  const dst = ctx.createImageData(w, h);
  const dd = dst.data;
  const shift = Math.max(1, Math.round(amount));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const di = (row + x) * 4;
      const rx = Math.min(w - 1, x + shift);
      const bx = Math.max(0, x - shift);
      const ri = (row + rx) * 4, bi = (row + bx) * 4;
      dd[di]     = sd[ri];     // red sampled from further right
      dd[di + 1] = sd[di + 1]; // green stays aligned
      dd[di + 2] = sd[bi + 2]; // blue sampled from further left
      dd[di + 3] = sd[di + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Adds fine per-pixel luminance noise (real film grain, not a texture
// overlay), skipping fully-transparent pixels so it never grains in empty
// space around a feathered/vignetted edge.
function pdfedDesignFilmGrain(ctx, w, h, intensity) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 255 * intensity;
    d[i]     = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(id, 0, 0);
}

// Genuine per-pixel spatial warp — bends the image around its own centre,
// like light curving around a gravity well — rather than a gradient/blend
// trick like every filter above. For every destination pixel we rotate
// its offset from centre by an angle that grows toward the middle
// (falloff*falloff so the outer edge stays nearly untouched and the twist
// concentrates near the core), then nearest-neighbour-sample the source at
// that rotated position. `amount` is the max twist in radians at dead
// centre. Used by Time Bend.
function pdfedDesignSwirl(ctx, w, h, amount) {
  const src = ctx.getImageData(0, 0, w, h);
  const sd = src.data;
  const dst = ctx.createImageData(w, h);
  const dd = dst.data;
  const cx = w / 2, cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy) || 1;
  for (let y = 0; y < h; y++) {
    const dy0 = y - cy;
    for (let x = 0; x < w; x++) {
      const dx0 = x - cx;
      const r = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const falloff = Math.max(0, 1 - r / maxR);
      const angle = amount * falloff * falloff;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      let sx = Math.round(cx + dx0 * cosA - dy0 * sinA);
      let sy = Math.round(cy + dx0 * sinA + dy0 * cosA);
      if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
      const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
      dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Real radial zoom-streak: many progressively larger copies of the current
// canvas layered back onto itself around its own centre at low opacity —
// the same trick behind a genuine long-exposure "light speed" shot, not a
// static motion-blur texture. `strengthFrac` (0-1) controls both how far
// the streak reaches and how visible it is. Used by Time Stretch.
function pdfedDesignRadialStreak(ctx, w, h, strengthFrac) {
  const cx = w / 2, cy = h / 2;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d').drawImage(ctx.canvas, 0, 0);
  const steps = 16;
  ctx.save();
  ctx.globalAlpha = Math.min(0.16, 0.04 + strengthFrac * 0.13);
  for (let i = 1; i <= steps; i++) {
    const scale = 1 + (i / steps) * strengthFrac * 0.6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// strength (0-100) controls how far the fade reaches in from the edge,
// as a fraction of the image's own dimensions.
function pdfedDesignApplyPresetToCtx(ctx, w, h, preset, strength) {
  const t = 0.08 + (strength / 100) * 0.5;
  switch (preset) {
    case 'feather':
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t);
      break;
    case 'vignette': {
      ctx.globalCompositeOperation = 'destination-in';
      const cx = w / 2, cy = h / 2;
      const rOuter = Math.sqrt(cx * cx + cy * cy);
      const g = ctx.createRadialGradient(cx, cy, rOuter * (1 - t) * 0.55, cx, cy, rOuter * (1 - t * 0.35));
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'fadeIn':
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 1.5);
      break;
    case 'fadeOut':
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 1.5);
      break;
    case 'fadeLeft':
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 1.5, 0);
      break;
    case 'fadeRight':
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 1.5, 0);
      break;
    case 'filmstrip':
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t);
      break;
    case 'diagonal': {
      ctx.globalCompositeOperation = 'destination-in';
      const g2 = ctx.createLinearGradient(0, 0, w, h);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(Math.min(0.92, t), 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }

    // ── Premium 3D Cinematic tier ──────────────────────────────────────
    case 'cinemaBars': {
      // True widescreen letterbox bars (opaque, not a fade) sized off
      // strength, softly feathered at their inner edge, plus a light
      // vignette on the visible strip for depth — the classic 2.35:1
      // "movie frame" look.
      const barH = h * (0.05 + (strength / 100) * 0.14);
      const feather = Math.max(3, barH * 0.35);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, barH - feather);
      ctx.fillRect(0, h - barH + feather, w, barH - feather);
      let bg = ctx.createLinearGradient(0, barH - feather, 0, barH);
      bg.addColorStop(0, 'rgba(0,0,0,1)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, barH - feather, w, feather);
      let bg2 = ctx.createLinearGradient(0, h - barH, 0, h - barH + feather);
      bg2.addColorStop(0, 'rgba(0,0,0,0)'); bg2.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = bg2; ctx.fillRect(0, h - barH, w, feather);
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'multiply';
      const gv = ctx.createRadialGradient(cx, cy, rOuter * 0.55, cx, cy, rOuter);
      gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(1, 'rgba(160,160,160,0.9)');
      ctx.fillStyle = gv; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'depth3d': {
      // Embossed/beveled border: a soft outer shadow ring plus a
      // top-left highlight stroke (simulated light source), so the
      // border reads as a raised 3D frame rather than a flat line —
      // then a light outer feather so it still blends onto the page.
      const bw = Math.max(6, Math.min(w, h) * (0.015 + (strength / 100) * 0.045));
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = bw;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeRect(bw / 2, bw / 2, w - bw, h - bw);
      ctx.globalCompositeOperation = 'screen';
      const hl = ctx.createLinearGradient(0, 0, w * 0.45, h * 0.45);
      hl.addColorStop(0, 'rgba(255,255,255,0.55)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.lineWidth = bw * 0.55;
      ctx.strokeStyle = hl;
      ctx.strokeRect(bw * 0.35, bw * 0.35, w - bw * 0.7, h - bw * 0.7);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.35, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.35, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.35);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.35);
      break;
    }
    case 'goldenGrade': {
      // Warm amber colour-grade that intensifies toward the edges
      // (native 'multiply' blend, no manual pixel math needed) plus a
      // gentle corner feather.
      ctx.globalCompositeOperation = 'multiply';
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      const g = ctx.createRadialGradient(cx, cy, rOuter * (1 - t) * 0.5, cx, cy, rOuter * (1 - t * 0.15));
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,178,102,0.85)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.25, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.25, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.25);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.25);
      break;
    }
    case 'chromaPulse': {
      // Real per-channel RGB split (not a colour overlay), masked so it
      // only shows near the border — the centre of the photo stays
      // clean while the edges get genuine lens-fringe colour.
      const amount = 1 + Math.round((strength / 100) * 4);
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.drawImage(ctx.canvas, 0, 0);
      pdfedDesignChromaShift(octx, w, h, amount);
      octx.globalCompositeOperation = 'destination-in';
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      const mask = octx.createRadialGradient(cx, cy, rOuter * 0.4, cx, cy, rOuter * 0.9);
      mask.addColorStop(0, 'rgba(0,0,0,0)'); mask.addColorStop(1, 'rgba(0,0,0,1)');
      octx.fillStyle = mask; octx.fillRect(0, 0, w, h);
      octx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.2, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.2, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.2);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.2);
      break;
    }
    case 'noirGrain': {
      // Desaturate toward the edges (native 'saturation' blend), darken
      // with a heavy vignette, then lay real per-pixel film grain on
      // top — moody high-contrast noir frame.
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'saturation';
      const gs = ctx.createRadialGradient(cx, cy, rOuter * 0.25, cx, cy, rOuter * 0.95);
      gs.addColorStop(0, 'rgba(128,128,128,0)');
      gs.addColorStop(1, 'rgba(128,128,128,0.95)');
      ctx.fillStyle = gs; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'multiply';
      const gd = ctx.createRadialGradient(cx, cy, rOuter * 0.35, cx, cy, rOuter * (1 - t * 0.15));
      gd.addColorStop(0, 'rgba(255,255,255,1)');
      gd.addColorStop(1, 'rgba(15,15,15,0.85)');
      ctx.fillStyle = gd; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignFilmGrain(ctx, w, h, 0.06 + (strength / 100) * 0.09);
      break;
    }

    // ── Cosmic tier ──────────────────────────────────────────────────
    case 'nebulaGlow': {
      // Two soft colour blooms (violet + teal) screened in from opposite
      // corners so light gathers at the edges instead of the vignette's
      // usual dark falloff — plus a light edge feather so it still reads
      // as a designed frame rather than a smear.
      ctx.globalCompositeOperation = 'screen';
      const rOuter = Math.sqrt(w * w + h * h) / 2;
      const g1 = ctx.createRadialGradient(w * 0.15, h * 0.15, 0, w * 0.15, h * 0.15, rOuter * (0.55 + t * 0.5));
      g1.addColorStop(0, 'rgba(168,85,247,0.55)');
      g1.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = g1; ctx.fillRect(0, 0, w, h);
      const g2 = ctx.createRadialGradient(w * 0.85, h * 0.85, 0, w * 0.85, h * 0.85, rOuter * (0.55 + t * 0.5));
      g2.addColorStop(0, 'rgba(45,212,191,0.5)');
      g2.addColorStop(1, 'rgba(45,212,191,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.18, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.18, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.18);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.18);
      break;
    }
    case 'galaxyGrade': {
      // Cinematic cool grade: shadows pushed toward deep indigo (radial
      // multiply from a bright centre), highlights lifted with a gentle
      // icy-cyan screen wash — the same two-pass trick as Golden Hour,
      // just cool instead of warm.
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'multiply';
      const g = ctx.createRadialGradient(cx, cy, rOuter * (1 - t) * 0.5, cx, cy, rOuter * (1 - t * 0.1));
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(76,29,149,0.85)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOuter * 0.6);
      g2.addColorStop(0, 'rgba(103,232,249,0.2)');
      g2.addColorStop(1, 'rgba(103,232,249,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.2, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.2, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.2);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.2);
      break;
    }
    case 'aurora': {
      // Flowing green -> cyan -> violet light band screened across the
      // top of the frame, fading to nothing by its own last colour stop
      // so it blends into the untouched image below without a hard edge.
      const bandH = h * (0.35 + (strength / 100) * 0.35);
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, 0, w, bandH * 0.6);
      g.addColorStop(0, 'rgba(64,255,180,0.55)');
      g.addColorStop(0.35, 'rgba(80,200,255,0.45)');
      g.addColorStop(0.65, 'rgba(150,110,255,0.5)');
      g.addColorStop(1, 'rgba(150,110,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, bandH);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'starfield': {
      // Deep-navy night-sky tint (radial multiply) with genuine per-pixel
      // bright specks scattered on top — see pdfedDesignStarSpecks.
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'multiply';
      const gn = ctx.createRadialGradient(cx, cy, rOuter * 0.3, cx, cy, rOuter);
      gn.addColorStop(0, 'rgba(255,255,255,1)');
      gn.addColorStop(1, 'rgba(10,12,40,0.55)');
      ctx.fillStyle = gn; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignStarSpecks(ctx, w, h, 0.0006 + (strength / 100) * 0.0018);
      break;
    }
    case 'deepSpaceVignette': {
      // Much harder, near-black falloff than the standard Vignette, with
      // a faint blue-violet tint screened in right at the boundary so
      // the subject reads as floating against open space.
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'destination-in';
      const g = ctx.createRadialGradient(cx, cy, rOuter * (1 - t) * 0.4, cx, cy, rOuter * (1 - t * 0.2));
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      const g2 = ctx.createRadialGradient(cx, cy, rOuter * 0.5, cx, cy, rOuter * 0.95);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(76,29,149,0.35)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'eclipseRing': {
      // Darkens everything beyond a ring radius (multiply), then screens
      // in a warm glowing corona band right at that boundary — the
      // classic solar-eclipse silhouette-and-halo look.
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      const ringR = rOuter * (0.5 + t * 0.15);
      ctx.globalCompositeOperation = 'multiply';
      const gd = ctx.createRadialGradient(cx, cy, ringR, cx, cy, rOuter);
      gd.addColorStop(0, 'rgba(255,255,255,1)');
      gd.addColorStop(1, 'rgba(10,8,20,0.92)');
      ctx.fillStyle = gd; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      const gr = ctx.createRadialGradient(cx, cy, ringR * 0.85, cx, cy, ringR * 1.15);
      gr.addColorStop(0, 'rgba(255,225,170,0)');
      gr.addColorStop(0.5, 'rgba(255,225,170,0.65)');
      gr.addColorStop(1, 'rgba(255,225,170,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'timeBend': {
      // Genuine per-pixel spatial warp (pdfedDesignSwirl) — pixels bend
      // around the centre like light curving around a gravity well, real
      // displacement rather than a gradient/blend trick. Strength sets how
      // many radians of twist build up toward the core. A violet core glow
      // plus a darker multiply pass at the rim finishes it as a deliberate
      // "gravity well" rather than a raw distortion filter.
      const amount = 0.5 + (strength / 100) * 2.6;
      pdfedDesignSwirl(ctx, w, h, amount);
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'screen';
      const gcore = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOuter * 0.35);
      gcore.addColorStop(0, 'rgba(180,140,255,0.35)');
      gcore.addColorStop(1, 'rgba(180,140,255,0)');
      ctx.fillStyle = gcore; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'multiply';
      const gedge = ctx.createRadialGradient(cx, cy, rOuter * 0.55, cx, cy, rOuter);
      gedge.addColorStop(0, 'rgba(255,255,255,1)');
      gedge.addColorStop(1, 'rgba(20,10,40,0.75)');
      ctx.fillStyle = gedge; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'timeStretch': {
      // Real radial zoom-streak (pdfedDesignRadialStreak) — many scaled
      // copies of the frame layered around its own centre at low opacity,
      // the same technique behind an actual long-exposure "light speed"
      // photo. A warm core fading to cool at the rim sells it as light
      // stretching outward from a bright origin, plus a light edge feather
      // to keep it from reading as an unbounded texture.
      pdfedDesignRadialStreak(ctx, w, h, strength / 100);
      const cx = w / 2, cy = h / 2, rOuter = Math.sqrt(cx * cx + cy * cy);
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOuter * 0.5);
      g.addColorStop(0, 'rgba(255,235,200,0.4)');
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, w * t * 0.15, 0);
      pdfedDesignEdgeGradient(ctx, w, h, w, 0, w - w * t * 0.15, 0);
      pdfedDesignEdgeGradient(ctx, w, h, 0, 0, 0, h * t * 0.15);
      pdfedDesignEdgeGradient(ctx, w, h, 0, h, 0, h - h * t * 0.15);
      break;
    }
  }
}

// Scatters genuine per-pixel bright specks across the image (skipping
// fully-transparent pixels, same guard as film grain) — used by Starfield.
// `density` is the fraction of total pixels turned into a speck; strength
// only affects how many specks appear, never uniform brightness, so it
// reads as sparse sparkle rather than a brightness/exposure change.
function pdfedDesignStarSpecks(ctx, w, h, density) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const total = w * h;
  const count = Math.round(total * density);
  for (let i = 0; i < count; i++) {
    const idx = (Math.floor(Math.random() * total)) * 4;
    if (d[idx + 3] === 0) continue;
    const b = 170 + Math.random() * 85;
    d[idx]     = Math.min(255, d[idx] + b);
    d[idx + 1] = Math.min(255, d[idx + 1] + b);
    d[idx + 2] = Math.min(255, d[idx + 2] + b);
  }
  ctx.putImageData(id, 0, 0);
}

function pdfedDesignRenderGrid() {
  const grid = document.getElementById('pdfedDesignGrid');
  const premGrid = document.getElementById('pdfedDesignPremiumGrid');
  const cosmicGrid = document.getElementById('pdfedDesignCosmicGrid');
  const tile = (p) =>
    `<button type="button" class="pdfed-design-preset${p.premium ? ' premium' : ''}${p.cosmic ? ' cosmic' : ''} ${p.id === pdfedDesignState.preset ? 'active' : ''}" data-preset="${p.id}" title="${p.name}" onclick="pdfedDesignPickPreset('${p.id}', this)">` +
      `<span class="pdfed-design-swatch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg></span>` +
      `<span class="pdfed-design-label">${p.name}</span>` +
    `</button>`;
  if (grid) grid.innerHTML = PDFED_DESIGN_PRESETS.filter(p => !p.premium && !p.cosmic).map(tile).join('');
  if (premGrid) premGrid.innerHTML = PDFED_DESIGN_PRESETS.filter(p => p.premium).map(tile).join('');
  if (cosmicGrid) cosmicGrid.innerHTML = PDFED_DESIGN_PRESETS.filter(p => p.cosmic).map(tile).join('');
}

function pdfedDesignPickPreset(id, el) {
  pdfedDesignState.preset = id;
  document.querySelectorAll('.pdfed-design-preset').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  pdfedDesignRefreshLivePreview();
}

function pdfedDesignSetStrength(val) {
  pdfedDesignState.strength = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  const label = document.getElementById('pdfedDesignStrengthVal');
  if (label) label.textContent = pdfedDesignState.strength;
  pdfedDesignScheduleLivePreview();
}

// ─── DESIGN — LIVE PREVIEW ──────────────────────────────────────────────
// Shows the currently-picked preset/strength directly on the selected
// image(s) on the canvas the instant a filter tile is clicked or the
// strength slider is dragged — without touching item.dataUrl. Nothing is
// actually committed until "Apply Fade" is pressed (which recomputes from
// the same untouched item.dataUrl and bakes the result for real, full-res —
// see pdfedDesignApplyFade). Every preview always starts fresh from
// item.dataUrl, so switching presets or dragging the slider back and forth
// never compounds/double-applies an effect on top of a previous preview.
//
// Two things used to make strength-dragging feel glitchy and both are
// fixed below:
//  1) Every tick re-decoded the full-res source image from its base64
//     dataUrl from scratch (a fresh `new Image()` + browser decode), then
//     ran the filter and re-encoded a full-res PNG via toDataURL — all of
//     that at the image's real pixel dimensions, which can be huge. Now
//     the decoded Image is cached per item (pdfedDesignPreviewImgCache)
//     so repeat ticks skip the decode entirely, and the working canvas is
//     downscaled to PDFED_DESIGN_PREVIEW_MAX px on its long edge, so the
//     gradient math, blend passes, and PNG re-encode all run on a small
//     canvas regardless of the source resolution. Every filter's math is
//     expressed as a fraction of width/height, so the look is identical at
//     preview scale — the commit path still bakes at true full resolution.
//  2) The old preview always reverted the image back to its unfiltered
//     original *before* computing the next frame, so every drag tick
//     flashed unfiltered -> filtered -> unfiltered -> filtered. Now a
//     revert only happens when the selection itself changes (an image
//     leaves the preview set); a same-selection preset/strength tweak
//     leaves the current frame on screen until the next one is ready and
//     swaps directly, so dragging just glides between filtered frames.
const PDFED_DESIGN_PREVIEW_MAX = 900; // px, long-edge cap for the live-preview canvas only
let pdfedDesignPreviewIds = new Set(); // ids of placed images currently showing an uncommitted preview
let pdfedDesignPreviewToken = 0;       // invalidates in-flight image loads from an older preview request
let pdfedDesignPreviewKey = '';        // last (items+preset+strength) combo already rendered, to skip redundant recompute
let pdfedDesignPreviewScheduled = false;
let pdfedDesignPreviewImgCache = new Map(); // item id -> { url, img } decoded-image cache, invalidated per-item when dataUrl changes

function pdfedDesignFindImgEl(id) {
  const wrap = document.querySelector('#pdfedPlacedImagesLayer .pdfed-placed-img[data-id="' + id + '"]');
  return wrap ? wrap.querySelector('img') : null;
}

// Resolves the decoded <img> for an item's *current* dataUrl, reusing the
// cached decode when nothing has changed since the last preview frame —
// this is what lets slider drags skip the (relatively slow) base64 decode
// on every tick and only redo the actual filter math.
function pdfedDesignGetCachedImg(item) {
  const cached = pdfedDesignPreviewImgCache.get(item.id);
  if (cached && cached.url === item.dataUrl) return Promise.resolve(cached.img);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { pdfedDesignPreviewImgCache.set(item.id, { url: item.dataUrl, img }); resolve(img); };
    img.onerror = reject;
    img.src = item.dataUrl;
  });
}

// Restores every previewed image back to its real, unmodified item.dataUrl —
// called whenever the preview set goes fully empty (panel closed / nothing
// selected), so an unsaved preview never lingers on screen.
function pdfedDesignRevertLivePreview() {
  if (pdfedDesignPreviewIds.size === 0) return;
  const pg = (typeof pdfed !== 'undefined' && pdfed.active >= 0) ? pdfed.pages[pdfed.active] : null;
  const list = (pg && pg.placedImages) || [];
  pdfedDesignPreviewIds.forEach(id => {
    const item = list.find(it => it.id === id);
    const el = pdfedDesignFindImgEl(id);
    if (item && el && el.src !== item.dataUrl) el.src = item.dataUrl;
  });
  pdfedDesignPreviewIds.clear();
}

function pdfedDesignScheduleLivePreview() {
  if (pdfedDesignPreviewScheduled) return;
  pdfedDesignPreviewScheduled = true;
  requestAnimationFrame(() => { pdfedDesignPreviewScheduled = false; pdfedDesignRefreshLivePreview(); });
}

function pdfedDesignRefreshLivePreview() {
  const items = pdfedDesignGetSelectedImageItems();
  const key = items.map(it => it.id).join(',') + '|' + pdfedDesignState.preset + '|' + pdfedDesignState.strength;
  if (items.length && key === pdfedDesignPreviewKey) return; // identical to what's already showing, nothing to do
  pdfedDesignPreviewKey = key;

  if (items.length === 0) { pdfedDesignRevertLivePreview(); return; }

  // Only revert images that dropped OUT of the current selection — a
  // same-selection preset/strength change never reverts anything, so the
  // currently-shown filtered frame just stays put until its replacement
  // is ready (no flash back to the unfiltered original mid-drag).
  const newIds = new Set(items.map(it => it.id));
  const pg = (typeof pdfed !== 'undefined' && pdfed.active >= 0) ? pdfed.pages[pdfed.active] : null;
  const list = (pg && pg.placedImages) || [];
  pdfedDesignPreviewIds.forEach(id => {
    if (newIds.has(id)) return;
    const item = list.find(it => it.id === id);
    const el = pdfedDesignFindImgEl(id);
    if (item && el && el.src !== item.dataUrl) el.src = item.dataUrl;
    pdfedDesignPreviewIds.delete(id);
  });

  const preset = pdfedDesignState.preset, strength = pdfedDesignState.strength;
  const token = ++pdfedDesignPreviewToken;
  items.forEach(item => {
    pdfedDesignGetCachedImg(item).then(img => {
      if (token !== pdfedDesignPreviewToken) return; // a newer preset/strength/selection change superseded this one
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const scale = Math.min(1, PDFED_DESIGN_PREVIEW_MAX / Math.max(nw, nh));
      const w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      pdfedDesignApplyPresetToCtx(ctx, w, h, preset, strength);
      const el = pdfedDesignFindImgEl(item.id);
      if (el) { el.src = c.toDataURL('image/png'); pdfedDesignPreviewIds.add(item.id); }
    }).catch(() => {});
  });
}

// The Design panel only ever acts on placed IMAGES that are currently
// selected on the active page — never the whole page, never unselected
// images — matching pdfedSelectedImgs, the same selection set the
// multi-select toolbar and the MutationObserver-driven selection panel use.
function pdfedDesignGetSelectedImageItems() {
  if (typeof pdfed === 'undefined' || pdfed.active < 0) return [];
  const pg = pdfed.pages[pdfed.active];
  if (!pg || !pg.placedImages) return [];
  // A plain single click on an image applies the `.selected` DOM class
  // directly without ever touching the pdfedSelectedImgs Set (that Set is
  // only populated by a marquee drag or Ctrl+A). So checking the Set alone
  // misses the common single-image-click case. Match pdfedGetActiveSelection's
  // approach: union the Set with whatever currently carries `.selected` in
  // the DOM, so a single click, a marquee drag, and Select All all work.
  const ids = new Set(pdfedSelectedImgs);
  document.querySelectorAll('#pdfedPlacedImagesLayer .pdfed-placed-img.selected').forEach(n => ids.add(n.dataset.id));
  return pg.placedImages.filter(it => ids.has(it.id));
}

function pdfedDesignApplyFade() {
  const items = pdfedDesignGetSelectedImageItems();
  if (items.length === 0) { toast('Select an image first', 'info'); return; }
  const pageIdx = pdfed.active;
  const preset = pdfedDesignState.preset, strength = pdfedDesignState.strength;
  const presetMeta = PDFED_DESIGN_PRESETS.find(p => p.id === preset) || PDFED_DESIGN_PRESETS[0];
  // Live clips take the filter LIVE (drawn on every frame, they keep playing); only still images are baked.
  const liveSel = items.filter(it => it.clip), stillItems = items.filter(it => !it.clip);
  if (liveSel.length) {
    pdfedLiveApplyFilter(liveSel, preset, strength, 'Filter on live clip');
    toast(presetMeta.name + ' applied to ' + (liveSel.length > 1 ? liveSel.length + ' live clips' : 'the live clip') + ', it keeps playing', 'success');
    if (!stillItems.length) return;
  }

  Promise.all(stillItems.map(item => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      pdfedDesignApplyPresetToCtx(ctx, w, h, preset, strength);
      resolve({ item, prevDataUrl: item.dataUrl, newDataUrl: c.toDataURL('image/png') });
    };
    img.onerror = reject;
    img.src = item.dataUrl;
  }))).then(results => {
    results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
    pdfedMarkModified(pageIdx);
    pdfedRenderPlacedImages(pageIdx);

    pushAppHistory({
      label: 'Cinematic fade',
      undo: () => {
        results.forEach(r => { r.item.dataUrl = r.prevDataUrl; });
        pdfedMarkModified(pageIdx);
        pdfedRenderPlacedImages(pageIdx);
        toast('Fade undone', 'info');
      },
      redo: () => {
        results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
        pdfedMarkModified(pageIdx);
        pdfedRenderPlacedImages(pageIdx);
        toast(presetMeta.name + ' applied', 'success');
      }
    });
    swTrack('design_preset_applied', {
      module: 'pdf_editor',
      preset: presetMeta.id,
      tier: presetMeta.cosmic ? 'cosmic' : (presetMeta.premium ? 'premium' : 'basic'),
      strength: strength
    });
    toast(presetMeta.name + ' applied' + (results.length > 1 ? ' to ' + results.length + ' images' : ''), 'success');
  }).catch(() => toast('Could not apply that fade', 'error'));
}

// ─── DESIGN — KADESSA PROGRAMMATIC APPLY ──────────────────────────────────
// Lets Kadessa bake ANY of the 21 Cinematic Fade / Premium 3D Cinematic /
// Cosmic presets directly onto placed image(s) from a tool call, with no
// requirement that the Design panel even be open or a preset pre-picked
// by hand first. Mirrors pdfedDesignApplyFade's own decode -> bake ->
// pushAppHistory -> mark-modified -> re-render pipeline exactly, so a
// Kadessa-applied fade is indistinguishable from a manually-applied one for
// undo, export, thumbnails, and reload -- the only thing that differs is
// where preset/strength/target come from.
//
// `target` resolution mirrors what a person would mean in the same
// sentence: an explicit 'all' always means every placed image on the
// current page; otherwise reuse whatever's already selected on the
// canvas (pdfedDesignGetSelectedImageItems, same Set the panel itself
// reads), and if nothing is selected but the page only has ONE image,
// treat "this image" as unambiguous and use it. With nothing selected
// and more than one image present there's a real ambiguity, so this
// throws rather than guessing which one the person meant.
function pdfedKadessaResolveDesignTargets(target) {
  if (typeof pdfed === 'undefined' || pdfed.active < 0) return [];
  const pg = pdfed.pages[pdfed.active];
  if (!pg || !pg.placedImages || !pg.placedImages.length) return [];
  if (target === 'all') return pg.placedImages.slice();
  const selected = pdfedDesignGetSelectedImageItems();
  if (selected.length) return selected;
  return pg.placedImages.length === 1 ? pg.placedImages.slice() : [];
}

// ─── KADESSA — RESHAPE IMAGE ──────────────────────────────────────────────
// Lets Kadessa cut a placed image into one of the Image Reshaper's shapes
// (built-ins like circle/blob1/hexagon AND the person's own "My Shapes")
// without opening the modal. Uses the exact same clip/bevel pipeline and
// undo/redo entry as applyReshapeConfirm so a Kadessa-made reshape is
// indistinguishable from a manual one. Target resolution matches
// pdfedKadessaApplyImageDesign: 'all' = every image on the page, otherwise
// the selected image(s), or the only image if the page has just one.
function pdfedKadessaFindReshapeShape(query) {
  const all = rshAllShapes();
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return null;
  const norm = function(x){ return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const nq = norm(q);
  // Plain-English aliases so "soft blob", "round", "rounded square" etc. land somewhere sensible.
  const aliases = {
    round: 'circle', oval: 'circle', rounded: 'squircle', roundedsquare: 'squircle',
    blob: 'blob1', softblob: 'blob1', organic: 'blob1', hex: 'hexagon',
    star: 'starburst', badge: 'medallion', crest: 'shield', gemstone: 'gem', diamondcut: 'gem'
  };
  return all.find(function(s){ return s.id.toLowerCase() === q; })
      || all.find(function(s){ return norm(s.name) === nq || norm(s.id) === nq; })
      || all.find(function(s){ return s.id === aliases[nq]; })
      || all.find(function(s){ return norm(s.name).indexOf(nq) !== -1 || nq.indexOf(norm(s.name)) !== -1; })
      || null;
}

// ─── KADESSA — IMAGE SHAPER (build 275) ───────────────────────────────────
// Kadessa's own hands on the Image Reshaper and Shape Studio. Everything below
// reuses the Studio's own machinery: a shape is ONE SVG path `d` in a
// 1000x1000 box plus the editable `nodes` it was built from ({x,y,t:'s'|'c',
// ho?,hi?}), saved into My Shapes exactly like a hand-drawn one, so anything
// she builds can be opened in Shape Studio and tweaked by hand afterwards.
//
//   rshBuildShapeSpec(spec)   recipe | nodes(+mirror) | path  ->  {nodes, smooth, notes}
//   rshKadessaBake(img, d, o)   the deeper Reshaper: keep proportions, zoom + focus,
//                             inset / rotate / flip, bevel, flat border, shadow
//   rshKadessaFocus(img, mode)  works out WHAT TO HIGHLIGHT: where the subject of a
//                             photo sits (face-like skin tones, detail, contrast)
//   pdfedKadessaReshapeImage / ...CreateCustomShape / ...EditCustomShape / ...DeleteCustomShape
const RSH_KADESSA_RECIPE_KINDS = ['polygon', 'star', 'burst', 'gear', 'flower', 'cloud', 'blob', 'heart', 'drop', 'ticket', 'rounded_rect', 'superformula'];
const RSH_KADESSA_MAX_NODES = 300;

function rshNum(v, lo, hi, dflt) { const n = Number(v); return (v === null || v === '' || !isFinite(n)) ? dflt : Math.max(lo, Math.min(hi, n)); }
function rshRng(seed) {
  let s = (Math.floor(Number(seed)) || 7) >>> 0; if (!s) s = 7;
  const next = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  next(); next();
  return next;
}
function rshPt(a, r) { return { x: 500 + r * Math.cos(a), y: 500 + r * Math.sin(a) }; }

// Round the corners of a list of vertices. An item is {x,y[,sharp]} or {raw:[nodes]}.
function rshRoundedNodes(items, r, abs) {
  const out = [], N = items.length;
  const first = function (it) { return it.raw ? it.raw[0] : it; };
  const last = function (it) { return it.raw ? it.raw[it.raw.length - 1] : it; };
  items.forEach(function (it, i) {
    if (it.raw) { it.raw.forEach(function (n) { out.push(n); }); return; }
    const p = last(items[(i - 1 + N) % N]), q = first(items[(i + 1) % N]);
    const d1 = Math.hypot(p.x - it.x, p.y - it.y) || 1, d2 = Math.hypot(q.x - it.x, q.y - it.y) || 1;
    const t = abs != null ? Math.min(abs, d1 * 0.5, d2 * 0.5) : r * 0.5 * Math.min(d1, d2);
    if (!(t > 1.5) || it.sharp) { out.push({ x: csR(it.x), y: csR(it.y), t: 'c' }); return; }
    const A = { x: it.x + (p.x - it.x) / d1 * t, y: it.y + (p.y - it.y) / d1 * t };
    const B = { x: it.x + (q.x - it.x) / d2 * t, y: it.y + (q.y - it.y) / d2 * t };
    out.push({ x: csR(A.x), y: csR(A.y), t: 'c', ho: { x: csR(A.x + (it.x - A.x) * 0.55), y: csR(A.y + (it.y - A.y) * 0.55) } });
    out.push({ x: csR(B.x), y: csR(B.y), t: 'c', hi: { x: csR(B.x + (it.x - B.x) * 0.55), y: csR(B.y + (it.y - B.y) * 0.55) } });
  });
  return out;
}

// Petals / bumps: valleys are sharp cusps, shoulders and tips are smooth.
function rshFlowerNodes(n, inner, irr, rnd) {
  const p = Math.PI * 2 / n, out = [], R = 470;
  for (let i = 0; i < n; i++) {
    const tipR = R * (1 - irr * 0.3 * rnd());
    const Rv = R * inner, sideR = Rv + (tipR - Rv) * 0.96, ang = -Math.PI / 2 + i * p;
    const v = rshPt(ang - p / 2, Rv), s1 = rshPt(ang - p * 0.34, sideR), tip = rshPt(ang, tipR), s2 = rshPt(ang + p * 0.34, sideR);
    out.push({ x: csR(v.x), y: csR(v.y), t: 'c' }, { x: csR(s1.x), y: csR(s1.y), t: 's' }, { x: csR(tip.x), y: csR(tip.y), t: 's' }, { x: csR(s2.x), y: csR(s2.y), t: 's' });
  }
  return out;
}

function rshRecipeNodes(rec, sq) {
  const kind = String(rec.kind || '').toLowerCase();
  if (RSH_KADESSA_RECIPE_KINDS.indexOf(kind) === -1) throw new Error('unknown recipe "' + rec.kind + '". Use one of: ' + RSH_KADESSA_RECIPE_KINDS.join(', '));
  const R = 470, count = function (lo, hi, d) { return Math.round(rshNum(rec.count, lo, hi, d)); };
  const rnd = rshRng(rec.seed);
  let nodes = [];
  if (kind === 'polygon') {
    const n = count(3, 40, 6), v = [];
    for (let i = 0; i < n; i++) v.push(rshPt(-Math.PI / 2 + i * Math.PI * 2 / n, R));
    nodes = rshRoundedNodes(v, rshNum(rec.roundness, 0, 1, 0.15));
  } else if (kind === 'star' || kind === 'burst') {
    const isBurst = kind === 'burst', k = count(3, 40, isBurst ? 16 : 5), inn = rshNum(rec.inner_ratio, 0.1, 0.95, isBurst ? 0.82 : 0.5), v = [];
    for (let i = 0; i < k * 2; i++) v.push(rshPt(-Math.PI / 2 + i * Math.PI / k, i % 2 ? R * inn : R));
    nodes = rshRoundedNodes(v, rshNum(rec.roundness, 0, 1, isBurst ? 0.1 : 0.15));
  } else if (kind === 'gear') {
    const n = count(4, 24, 10), inn = rshNum(rec.inner_ratio, 0.1, 0.95, 0.78), p = Math.PI * 2 / n, v = [];
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * p;
      [[-0.30, inn], [-0.17, 1], [0.17, 1], [0.30, inn], [0.5, inn]].forEach(function (s) { v.push(rshPt(a0 + s[0] * p, R * s[1])); });
    }
    nodes = rshRoundedNodes(v, rshNum(rec.roundness, 0, 1, 0.2));
  } else if (kind === 'flower') {
    nodes = rshFlowerNodes(count(3, 24, 6), rshNum(rec.inner_ratio, 0.1, 0.95, 0.45), rshNum(rec.irregularity, 0, 1, 0), rnd);
  } else if (kind === 'cloud') {
    nodes = rshFlowerNodes(count(3, 14, 6), rshNum(rec.inner_ratio, 0.1, 0.95, 0.83), rshNum(rec.irregularity, 0, 1, 0.3), rnd);
    const asp = rshNum(rec.aspect, 0.3, 1, 0.62);
    rshMapNodes(nodes, function (x, y) { return [x, 500 + (y - 500) * asp]; });
  } else if (kind === 'blob') {
    const n = count(3, 12, 5), irr = rshNum(rec.irregularity, 0, 1, 0.3), P = Math.max(12, n * 3);
    const f1 = rnd() * 6.28, f2 = rnd() * 6.28, f3 = rnd() * 6.28;
    for (let j = 0; j < P; j++) {
      const th = Math.PI * 2 * j / P;
      let r = 1 + irr * (0.45 * Math.sin(n * th + f1) + 0.3 * Math.sin((n + 2) * th + f2) + 0.25 * Math.sin(2 * th + f3));
      r = Math.max(0.55, Math.min(1.5, r));
      const q = rshPt(th - Math.PI / 2, 330 * r);
      nodes.push({ x: csR(q.x), y: csR(q.y), t: 's' });
    }
  } else if (kind === 'heart') {
    const S = 28;
    for (let k = 0; k < S; k++) {
      const t = Math.PI * 2 * k / S, sx = 16 * Math.pow(Math.sin(t), 3);
      const sy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      nodes.push({ x: csR(500 + sx * 29), y: csR(500 - (sy + 2.5) * 30), t: (k === 0 || k === S / 2) ? 'c' : 's' });
    }
  } else if (kind === 'drop') {
    nodes.push({ x: 500, y: 40, t: 'c' });
    [-32.75, 20, 55, 90, 125, 160, 212.75].forEach(function (deg) {
      const a = deg * Math.PI / 180;
      nodes.push({ x: csR(500 + 330 * Math.cos(a)), y: csR(650 + 330 * Math.sin(a)), t: 's' });
    });
  } else if (kind === 'ticket') {
    const x0 = 40, x1 = 960, y0 = 250, y1 = 750, b = Math.min(200, 90 * rshNum(rec.notch, 0, 1.6, 1)), k = 0.5523 * b, items = [];
    items.push({ x: x0, y: y0 }, { x: x1, y: y0 });
    if (b > 4) items.push({ raw: [
      { x: x1, y: 500 - b, t: 'c', ho: { x: x1 - k, y: 500 - b } },
      { x: x1 - b, y: 500, t: 's', hi: { x: x1 - b, y: 500 - k }, ho: { x: x1 - b, y: 500 + k } },
      { x: x1, y: 500 + b, t: 'c', hi: { x: x1 - k, y: 500 + b } }] });
    items.push({ x: x1, y: y1 }, { x: x0, y: y1 });
    if (b > 4) items.push({ raw: [
      { x: x0, y: 500 + b, t: 'c', ho: { x: x0 + k, y: 500 + b } },
      { x: x0 + b, y: 500, t: 's', hi: { x: x0 + b, y: 500 + k }, ho: { x: x0 + b, y: 500 - k } },
      { x: x0, y: 500 - b, t: 'c', hi: { x: x0 + k, y: 500 - b } }] });
    nodes = rshRoundedNodes(items, 0, 55);
  } else if (kind === 'rounded_rect') {
    const hw = 440 * rshNum(sq && sq.width_pct, 15, 100, 100) / 100, hh = 440 * rshNum(sq && sq.height_pct, 15, 100, 100) / 100;
    nodes = rshRoundedNodes([{ x: 500 - hw, y: 500 - hh }, { x: 500 + hw, y: 500 - hh }, { x: 500 + hw, y: 500 + hh }, { x: 500 - hw, y: 500 + hh }], rshNum(rec.roundness, 0, 1, 0.35));
  } else if (kind === 'superformula') {
    const m = Math.round(rshNum(rec.m, 1, 24, 6)), n1 = rshNum(rec.n1, 0.1, 60, 1), n2 = rshNum(rec.n2, 0.1, 60, 1), n3 = rshNum(rec.n3, 0.1, 60, 1);
    const P = Math.max(48, Math.min(160, m * 10)), rs = [];
    for (let j = 0; j < P; j++) {
      const th = Math.PI * 2 * j / P;
      let r = Math.pow(Math.pow(Math.abs(Math.cos(m * th / 4)), n2) + Math.pow(Math.abs(Math.sin(m * th / 4)), n3), -1 / n1);
      if (!isFinite(r)) r = 0; rs.push(r);
    }
    const mx = Math.max.apply(null, rs) || 1;
    rs.forEach(function (r, j) { const q = rshPt(Math.PI * 2 * j / P - Math.PI / 2, 470 * Math.min(1, r / mx)); nodes.push({ x: csR(q.x), y: csR(q.y), t: 's' }); });
  }
  const rot = rshNum(rec.rotation_deg, -360, 360, 0);
  if (rot) { const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180); rshMapNodes(nodes, function (x, y) { return [500 + (x - 500) * c - (y - 500) * s, 500 + (x - 500) * s + (y - 500) * c]; }); }
  return nodes;
}

function rshMapNodes(nodes, fn) {
  nodes.forEach(function (n) {
    const a = fn(n.x, n.y); n.x = csR(a[0]); n.y = csR(a[1]);
    ['ho', 'hi'].forEach(function (w) { if (n[w]) { const b = fn(n[w].x, n[w].y); n[w] = { x: csR(b[0]), y: csR(b[1]) }; } });
  });
}
function rshFitNodes(nodes, f) {
  const pts = csSamplePts(nodes, f, true, 10);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  const w = x1 - x0, h = y1 - y0;
  if (w < 5 && h < 5) return;
  const s = Math.min(940 / Math.max(w, 1), 940 / Math.max(h, 1)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  rshMapNodes(nodes, function (x, y) { return [500 + (x - cx) * s, 500 + (y - cy) * s]; });
}
function rshNodesCross(nodes, f) {
  const raw = csSamplePts(nodes, f, true, 5), pts = raw.filter(function (q, i) { const a = raw[(i - 1 + raw.length) % raw.length]; return Math.hypot(q.x - a.x, q.y - a.y) > 0.3; }), N = pts.length;
  const ccw = function (a, b, c) { return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x); };
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    for (let j = i + 2; j < N; j++) {
      if (i === 0 && j === N - 1) continue;
      const c = pts[j], d = pts[(j + 1) % N];
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) return true;
    }
  }
  return false;
}

// Points Kadessa plotted herself (grid 1000x1000, y down).
function rshCleanNodes(arr, mirror) {
  let list = arr.slice(0, 80).map(function (n) {
    if (!n || typeof n !== 'object') return null;
    const x = rshNum(n.x, 0, 1000, NaN), y = rshNum(n.y, 0, 1000, NaN);
    if (!isFinite(x) || !isFinite(y)) return null;
    const o = { x: csR(x), y: csR(y), t: n.corner === true ? 'c' : 's' };
    if (n.out && isFinite(rshNum(n.out.x, 0, 1000, NaN)) && isFinite(rshNum(n.out.y, 0, 1000, NaN))) o.ho = { x: csR(rshNum(n.out.x, -200, 1200, 0)), y: csR(rshNum(n.out.y, -200, 1200, 0)) };
    if (n.in && isFinite(rshNum(n.in.x, 0, 1000, NaN)) && isFinite(rshNum(n.in.y, 0, 1000, NaN))) o.hi = { x: csR(rshNum(n.in.x, -200, 1200, 0)), y: csR(rshNum(n.in.y, -200, 1200, 0)) };
    return o;
  }).filter(Boolean);
  if (mirror === 'left' || mirror === 'right') list = rshMirrorHalf(list, mirror === 'left');
  if (list.length < 3) throw new Error('a shape needs at least 3 valid points');
  return list;
}
// Same idea as the Studio's Mirror button: one half along the centre line, the other half is reflected.
function rshMirrorHalf(src, leftDrawn) {
  src = csClone(src);
  src.forEach(function (n) {
    if (leftDrawn ? n.x > 500 : n.x < 500) n.x = 500;
    if (Math.abs(n.x - 500) < 14) { n.x = 500; delete n.ho; delete n.hi; if (n.t !== 'c') n.t = 's'; }
  });
  const startOn = src[0].x === 500, endOn = src[src.length - 1].x === 500;
  const mir = function (n) {
    const m = csClone(n); m.x = 1000 - m.x;
    if (m.ho) m.ho.x = 1000 - m.ho.x;
    if (m.hi) m.hi.x = 1000 - m.hi.x;
    const t = m.hi; m.hi = m.ho; m.ho = t;
    if (!m.hi) delete m.hi; if (!m.ho) delete m.ho;
    return m;
  };
  const out = src.slice();
  for (let i = src.length - 1; i >= 0; i--) {
    if (i === src.length - 1 && endOn) continue;
    if (i === 0 && startOn) continue;
    out.push(mir(src[i]));
  }
  return out;
}
// Keep one half of an EXISTING outline and mirror it (used by pdfed_edit_custom_shape).
function rshMirrorSampled(nodes, f, keepLeft) {
  const pts = csSamplePts(nodes, f, true, 24), N = pts.length;
  const on = function (p) { return keepLeft ? p.x <= 500 : p.x >= 500; };
  let best = null;
  for (let i = 0; i < N; i++) {
    if (!(on(pts[i]) && !on(pts[(i - 1 + N) % N]))) continue;
    let len = 0; while (len < N && on(pts[(i + len) % N])) len++;
    if (len < N && (!best || len > best.len)) best = { i: i, len: len };
  }
  if (!best) throw new Error('that outline does not cross the centre line, so there is no half to mirror');
  const arc = []; for (let k = 0; k < best.len; k++) arc.push(pts[(best.i + k) % N]);
  const cross = function (a, b) { const t = (500 - a.x) / ((b.x - a.x) || 1); return { x: 500, y: a.y + (b.y - a.y) * t }; };
  const sA = cross(pts[(best.i - 1 + N) % N], arc[0]), eA = cross(arc[arc.length - 1], pts[(best.i + best.len) % N]);
  const poly = csRdp([sA].concat(arc, [eA]), 2.5);
  const nodes2 = poly.map(function (p, k) {
    let t = 's';
    if (k > 0 && k < poly.length - 1) {
      const a = poly[k - 1], c = poly[k + 1], a1 = Math.atan2(p.y - a.y, p.x - a.x), a2 = Math.atan2(c.y - p.y, c.x - p.x);
      let da = Math.abs(a1 - a2) * 180 / Math.PI; if (da > 180) da = 360 - da;
      if (da > 40) t = 'c';
    } else {
      const q = k === 0 ? poly[1] : poly[k - 1];
      if (Math.abs(q.x - p.x) < 0.6 * Math.hypot(q.x - p.x, q.y - p.y)) t = 'c';
    }
    return { x: csR(p.x), y: csR(p.y), t: t };
  });
  return rshMirrorHalf(nodes2, keepLeft);
}

// Raw SVG path -> points on the real outline (browser does the geometry).
function rshPathSamples(d, n) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden';
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.appendChild(path);
  document.body.appendChild(svg);
  try {
    const L = path.getTotalLength();
    if (!(L > 1)) throw new Error('that path has no length');
    const pts = [];
    for (let k = 0; k < n; k++) { const q = path.getPointAtLength(L * k / n); pts.push({ x: q.x, y: q.y }); }
    return pts;
  } finally { svg.remove(); }
}
function rshPathToNodes(d) {
  if (!rshShapePathOk(d)) throw new Error('that path contains characters that are not allowed');
  let dd = String(d).trim();
  const m2 = dd.slice(1).search(/[Mm]/); if (m2 >= 0) dd = dd.slice(0, m2 + 1);
  const raw = rshPathSamples(dd, 240);
  let s = csRdp(raw.concat([raw[0]]), 3);
  if (s.length > 2) s.pop();
  if (s.length < 3) throw new Error('that path is too simple to make a shape from');
  return s.map(function (p, k) {
    const a = s[(k - 1 + s.length) % s.length], c = s[(k + 1) % s.length];
    const a1 = Math.atan2(p.y - a.y, p.x - a.x), a2 = Math.atan2(c.y - p.y, c.x - p.x);
    let da = Math.abs(a1 - a2) * 180 / Math.PI; if (da > 180) da = 360 - da;
    return { x: csR(p.x), y: csR(p.y), t: da > 35 ? 'c' : 's' };
  });
}

// Squash / rotate / flip / fit, shared by build and edit.
function rshApplyShapeOps(nodes, o, f) {
  let geo = false;
  const wp = rshNum(o.width_pct, 15, 100, 100), hp = rshNum(o.height_pct, 15, 100, 100);
  if (wp < 100 || hp < 100) { rshMapNodes(nodes, function (x, y) { return [500 + (x - 500) * wp / 100, 500 + (y - 500) * hp / 100]; }); geo = true; }
  const rot = rshNum(o.rotate_deg, -360, 360, 0);
  if (rot) { const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180); rshMapNodes(nodes, function (x, y) { return [500 + (x - 500) * c - (y - 500) * s, 500 + (x - 500) * s + (y - 500) * c]; }); geo = true; }
  if (o.flip_h === true) { rshMapNodes(nodes, function (x, y) { return [1000 - x, y]; }); geo = true; }
  if (o.flip_v === true) { rshMapNodes(nodes, function (x, y) { return [x, 1000 - y]; }); geo = true; }
  if (o.fit !== false && geo) rshFitNodes(nodes, f);
  return geo;
}

// spec = { name?, recipe | nodes(+mirror) | path, smooth?, fit?, width_pct?, height_pct?, flip_h?, flip_v?, rotate_deg? }
function rshBuildShapeSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('no shape description given');
  const smooth = Math.round(rshNum(spec.smooth, 0, 100, 100)), f = smooth / 100 / 6, notes = [];
  let nodes;
  if (spec.recipe && typeof spec.recipe === 'object' && spec.recipe.kind) nodes = rshRecipeNodes(spec.recipe, spec);
  else if (Array.isArray(spec.nodes) && spec.nodes.length) nodes = rshCleanNodes(spec.nodes, spec.mirror);
  else if (typeof spec.path === 'string' && spec.path.trim()) nodes = rshPathToNodes(spec.path);
  else throw new Error('give a recipe, nodes or a path to build the shape from');
  const sqDone = !!(spec.recipe && String(spec.recipe.kind).toLowerCase() === 'rounded_rect');
  rshApplyShapeOps(nodes, { width_pct: sqDone ? 100 : spec.width_pct, height_pct: sqDone ? 100 : spec.height_pct, rotate_deg: spec.rotate_deg, flip_h: spec.flip_h, flip_v: spec.flip_v, fit: false }, f);
  if (spec.fit !== false) rshFitNodes(nodes, f);
  else rshMapNodes(nodes, function (x, y) { return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y))]; });
  if (nodes.length > RSH_KADESSA_MAX_NODES) throw new Error('that outline has too many points (' + nodes.length + '), simplify it');
  const pts = csSamplePts(nodes, f, true, 8);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  if (!isFinite(x0) || x1 - x0 < 80 || y1 - y0 < 80) throw new Error('that outline is too small or too thin to cut a picture into');
  if (rshNodesCross(nodes, f)) notes.push('the outline crosses itself a little');
  return { nodes: nodes, smooth: smooth, notes: notes };
}

function rshKadessaCleanName(n, dflt) { return String(n == null ? '' : n).replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 40) || dflt; }

async function rshKadessaSaveShape(name, built, existing) {
  await rshMyShapesLoad();
  const d = csBuildD(built.nodes, built.smooth / 100 / 6, true);
  if (!rshShapePathOk(d)) throw new Error('the outline came out invalid, try something simpler');
  let rec = existing || null;
  if (rec) {
    rec.name = name; rec.d = d; rec.nodes = csClone(built.nodes); rec.smooth = built.smooth; rec.updatedAt = Date.now();
  } else {
    rec = { id: 'cshape_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name, d: d, nodes: csClone(built.nodes), smooth: built.smooth, createdAt: Date.now(), driveFileId: null, viaKadessa: true };
    rshMyShapes.unshift(rec);
  }
  await rshMyShapesPersist();
  try { if (typeof sarvarcDriveSaveShape === 'function') sarvarcDriveSaveShape(rec).catch(function () {}); } catch (e) {}
  try { renderReshapeGrid(); } catch (e) {}
  return rec;
}
async function rshKadessaCreateShape(spec) {
  const built = rshBuildShapeSpec(spec);
  const rec = await rshKadessaSaveShape(rshKadessaCleanName(spec.name, 'My Shape'), built, null);
  rec._notes = built.notes;
  if (typeof swTrack === 'function') swTrack('kadessa_shape_built', { module: 'pdf_editor', method: spec.recipe ? 'recipe' : (spec.nodes ? 'nodes' : 'path'), points: built.nodes.length });
  return rec;
}

// ── WHAT TO HIGHLIGHT ──────────────────────────────────────────────────
// Finds where the subject of a photo sits so a crop or zoom keeps it in view.
// mode 'face' leans hard on skin tones, 'auto' blends detail + colour + skin,
// both with a mild pull to the middle so a stray bright corner never wins.
function rshKadessaFocus(img, mode) {
  const sw = img.naturalWidth, sh = img.naturalHeight, G = 48, sc = G / Math.max(sw, sh);
  const cw = Math.max(8, Math.round(sw * sc)), ch = Math.max(8, Math.round(sh * sc));
  const centre = { x: 50, y: 50, how: 'the centre of the picture' };
  let data;
  try {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, cw, ch);
    data = x.getImageData(0, 0, cw, ch).data;
  } catch (e) { return centre; }
  const N = cw * ch, lum = new Float32Array(N), sat = new Float32Array(N), skin = new Uint8Array(N), vis = new Uint8Array(N);
  let skinN = 0, visN = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    vis[i] = a > 24 ? 1 : 0; if (!vis[i]) continue; visN++;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && lum[i] > 40) { skin[i] = 1; skinN++; }
  }
  if (!visN) return centre;
  const useFace = mode === 'face' && skinN / visN >= 0.015;
  const score = new Float32Array(N); let any = 0;
  for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
    const i = y * cw + x; if (!vis[i]) continue;
    const gx = lum[i + 1] - lum[i - 1], gy = lum[i + cw] - lum[i - cw], g = Math.hypot(gx, gy) / 255;
    const nx = x / cw - 0.5, ny = y / ch - 0.5, pull = 0.65 + 0.35 * Math.exp(-(nx * nx + ny * ny) / 0.18);
    let s = g + sat[i] * 0.35 + (skin[i] ? (useFace ? 1.4 : 0.5) : 0);
    s *= pull; score[i] = s; if (s > 0.02) any++;
  }
  if (any < 6) return centre;
  const vals = Array.from(score).filter(function (v) { return v > 0.02; }).sort(function (a, b) { return a - b; });
  const th = vals[Math.floor(vals.length * 0.75)];
  let sx = 0, sy = 0, sw2 = 0;
  for (let i = 0; i < N; i++) if (score[i] >= th) { sx += (i % cw) * score[i]; sy += Math.floor(i / cw) * score[i]; sw2 += score[i]; }
  if (!sw2) return centre;
  return {
    x: Math.round((sx / sw2 + 0.5) / cw * 100), y: Math.round((sy / sw2 + 0.5) / ch * 100),
    how: useFace ? 'the face-like, skin-tone area' : 'the area with the most detail and contrast'
  };
}

// ── THE DEEPER BAKE ────────────────────────────────────────────────────
// o: { keepProportions, zoomPct, focusX, focusY (0-100 point of the photo to keep centred),
//      insetPct, rotateDeg, flipH, flipV, bevel, bevelStyle, borderColor, borderWidth, shadow }
function rshKadessaBake(img, d, o) {
  o = o || {};
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const inset = rshNum(o.insetPct, 30, 100, 100) / 100, rot = rshNum(o.rotateDeg, -360, 360, 0);
  const shapeM = new DOMMatrix().translate(500, 500).rotate(rot).scale((o.flipH ? -1 : 1) * inset, (o.flipV ? -1 : 1) * inset).translate(-500, -500);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  rshPathSamples(d, 240).forEach(function (p) {
    const q = shapeM.transformPoint(new DOMPoint(p.x, p.y));
    minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
  });
  let bx0 = 0, by0 = 0, bw = 1000, bh = 1000;
  const keep = o.keepProportions === true;
  if (keep) {
    bx0 = minX; by0 = minY; bw = maxX - minX; bh = maxY - minY;
    if (bw < 20 || bh < 20) throw new Error('that shape is too thin to cut a picture into');
  }
  const A = bw / bh, zoom = rshNum(o.zoomPct, 100, 400, 100) / 100;
  const baseW = keep ? Math.min(sw, sh * A) : sw, baseH = keep ? baseW / A : sh;
  const cap = 4096, k = Math.max(baseW, baseH) > cap ? cap / Math.max(baseW, baseH) : 1;
  const fw = baseW * k, fh = baseH * k, minDim = Math.min(fw, fh);
  const pad = (keep && (o.bevel || o.shadow)) ? Math.round(minDim * 0.05) : 0;
  const W = Math.round(fw + 2 * pad), H = Math.round(fh + 2 * pad);
  const kx = fw / bw, ky = fh / bh;
  const M = new DOMMatrix().translate(pad, pad).scale(kx, ky).translate(-bx0, -by0).multiply(shapeM);
  const path = new Path2D(); path.addPath(new Path2D(d), M);
  // which part of the photo sits inside the frame
  const rw = baseW / zoom, rh = baseH / zoom;
  const cx = rshNum(o.focusX, 0, 100, 50) / 100 * sw, cy = rshNum(o.focusY, 0, 100, 50) / 100 * sh;
  const x0 = Math.max(0, Math.min(sw - rw, cx - rw / 2)), y0 = Math.max(0, Math.min(sh - rh, cy - rh / 2));
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  const lc = layer.getContext('2d');
  lc.save(); lc.clip(path); lc.drawImage(img, x0, y0, rw, rh, pad, pad, fw, fh);
  if (/^#[0-9a-fA-F]{6}$/.test(o.borderColor || '') && rshNum(o.borderWidth, 0, 100, 0) > 0) {
    lc.lineJoin = 'round'; lc.strokeStyle = o.borderColor; lc.lineWidth = rshNum(o.borderWidth, 0, 100, 16) / 1000 * minDim * 2; lc.stroke(path);
  }
  lc.restore();
  if (o.bevel) {
    const avg = (kx + ky) / 2;
    const proxy = { createLinearGradient: function () { return lc.createLinearGradient(0, 0, W, H); } };
    lc.save(); lc.lineJoin = 'round';
    lc.strokeStyle = rshBuildBevelGradient(proxy, o.bevelStyle || 'gold'); lc.lineWidth = 20 * avg; lc.stroke(path);
    lc.strokeStyle = 'rgba(255,255,255,0.65)'; lc.lineWidth = 5 * avg; lc.stroke(path);
    lc.restore();
  }
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const oc = out.getContext('2d');
  if (o.shadow) { oc.shadowColor = 'rgba(0,0,0,0.45)'; oc.shadowBlur = minDim * 0.045; oc.shadowOffsetY = minDim * 0.02; }
  oc.drawImage(layer, 0, 0);
  return { dataUrl: out.toDataURL('image/png'), w: W, h: H, uw: W / k, uh: H / k, sw: sw, sh: sh, cropped: rw < sw * 0.99 || rh < sh * 0.99 };
}

// ── KADESSA — RESHAPE IMAGE ───────────────────────────────────────────────
function rshKadessaLoadImg(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('could not read the image to reshape it')); };
    img.src = src;
  });
}

async function pdfedKadessaReshapeImage(p) {
  p = p || {};
  await rshMyShapesLoad();
  // 1. targets first, so a failed target never leaves a stray saved shape behind
  const targets = []; let pageIdx = -1;
  if (p.source === 'gallery') {
    const list = (typeof state !== 'undefined' && state.extractedImages) || [];
    if (!list.length) throw new Error('there are no gallery images to reshape');
    if (p.target === 'all' || String(p.gallery_index).toLowerCase() === 'all') list.forEach(function (_, i) { targets.push({ kind: 'gallery', idx: i }); });
    else {
      const n = parseInt(p.gallery_index, 10);
      if (!(n >= 1 && n <= list.length)) throw new Error('gallery image ' + (p.gallery_index || '?') + ' does not exist, there are ' + list.length + '. Say which number.');
      targets.push({ kind: 'gallery', idx: n - 1 });
    }
  } else {
    const ap = pdfedKadessaActivePage(p), pg = ap.pg; pageIdx = ap.idx;
    const imgs = pg.placedImages || [];
    if (!imgs.length) throw new Error('no image to reshape, place one first');
    if (p.target === 'all') imgs.forEach(function (it) { targets.push({ kind: 'placed', item: it }); });
    else if (p.id || (p.which !== undefined && p.which !== null && p.which !== '')) targets.push({ kind: 'placed', item: pdfedKadessaFindImage(pg, p) });
    else {
      const items = (pageIdx === pdfed.active) ? pdfedKadessaResolveDesignTargets(undefined) : (imgs.length === 1 ? imgs.slice() : []);
      if (!items.length) throw new Error(imgs.length > 1 ? 'there are several images on this page, say which one (or say all images)' : 'no image to reshape, place one first');
      items.forEach(function (it) { targets.push({ kind: 'placed', item: it }); });
    }
  }
  // 2. the shape
  let shape, built = null;
  if (p.new_shape && typeof p.new_shape === 'object') {
    built = await rshKadessaCreateShape(p.new_shape);
    shape = { id: built.id, name: built.name, d: built.d };
  } else {
    const requested = p.shape || p.shape_id || p.shapeId || p.name;
    if (!requested) throw new Error('give a shape (a built-in or a My Shapes name) or describe a new_shape to build');
    shape = pdfedKadessaFindReshapeShape(requested);
    if (!shape) throw new Error('no shape called "' + requested + '". Available: ' + rshAllShapes().map(function (s) { return s.id; }).join(', '));
  }
  // 3. how it is applied
  const keep = p.keep_proportions === true;
  const zoomPct = Math.round(rshNum(p.zoom_pct, 100, 400, 100));
  const bevel = p.bevel === true, bevelStyle = ['gold', 'silver', 'graphite'].indexOf(p.bevel_style) !== -1 ? p.bevel_style : 'gold';
  const borderColor = /^#[0-9a-fA-F]{6}$/.test(p.border_color || '') ? p.border_color : '';
  const borderWidth = borderColor ? Math.round(rshNum(p.border_width, 0, 100, 16)) : 0;
  const shadow = (p.shadow === true) || (bevel && p.shadow !== false);
  const hasFx = isFinite(Number(p.focus_x)) && p.focus_x !== null && p.focus_x !== '', hasFy = isFinite(Number(p.focus_y)) && p.focus_y !== null && p.focus_y !== '';
  const manual = hasFx || hasFy;
  const focusMode = ['auto', 'face', 'center'].indexOf(p.focus) !== -1 ? p.focus : (manual ? 'manual' : ((keep || zoomPct > 100) ? 'auto' : 'center'));

  const changes = []; const notes = []; let focusNote = '';
  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    if (t.kind === 'placed' && t.item.clip) {
      // LIVE CLIP: the shape is stored on the clip and drawn on every frame, so it keeps playing inside the shape.
      await sppLiveReady(t.item.clip);
      let lfx = 50, lfy = 50;
      if (focusMode === 'manual') { lfx = hasFx ? Number(p.focus_x) : 50; lfy = hasFy ? Number(p.focus_y) : 50; }
      else if ((focusMode === 'auto' || focusMode === 'face') && zoomPct > 100) {
        try { const lf = rshKadessaFocus(await rshKadessaLoadImg(pdfedLiveBaseFrameUrl(t.item)), focusMode); lfx = lf.x; lfy = lf.y; focusNote = 'kept ' + lf.how + ' in view'; } catch (e) {}
      }
      const lspec = pdfedLiveBuildShape(shape, { inset: p.shape_inset_pct, rot: p.shape_rotate_deg, flipH: p.shape_flip_h === true, flipV: p.shape_flip_v === true,
        zoom: zoomPct, fx: lfx, fy: lfy, bevel: bevel, bevelStyle: bevelStyle, border: borderColor, borderW: borderWidth, shadow: shadow, keep: keep });
      const lprev = pdfedLiveClone(t.item.clip.look) || {};
      const lbox = keep ? pdfedLiveKeepBox(t.item, lspec) : null;
      changes.push({ t: t, live: true, prevLook: lprev, nextLook: Object.assign({}, lprev, { shape: lspec }),
        prevBox: { x: t.item.x, y: t.item.y, w: t.item.w, h: t.item.h }, nextBox: lbox || { x: t.item.x, y: t.item.y, w: t.item.w, h: t.item.h } });
      continue;
    }
    const src = t.kind === 'placed' ? t.item.dataUrl : state.extractedImages[t.idx].dataUrl;
    const img = await rshKadessaLoadImg(src);
    let fx = 50, fy = 50;
    if (focusMode === 'manual') { fx = hasFx ? Number(p.focus_x) : 50; fy = hasFy ? Number(p.focus_y) : 50; }
    else if (focusMode === 'auto' || focusMode === 'face') { const f = rshKadessaFocus(img, focusMode); fx = f.x; fy = f.y; focusNote = 'kept ' + f.how + ' in view (about ' + f.x + '% across, ' + f.y + '% down)'; }
    const r = rshKadessaBake(img, shape.d, {
      keepProportions: keep, zoomPct: zoomPct, focusX: fx, focusY: fy, insetPct: p.shape_inset_pct, rotateDeg: p.shape_rotate_deg,
      flipH: p.shape_flip_h === true, flipV: p.shape_flip_v === true, bevel: bevel, bevelStyle: bevelStyle,
      borderColor: borderColor, borderWidth: borderWidth, shadow: shadow
    });
    if (!r.cropped) focusNote = '';
    if (t.kind === 'placed') {
      const it = t.item;
      const prev = { dataUrl: it.dataUrl, x: it.x, y: it.y, w: it.w, h: it.h, shapedAs: it.shapedAs, shapedId: it.shapedId };
      const next = { dataUrl: r.dataUrl, x: it.x, y: it.y, w: it.w, h: it.h, shapedAs: shape.name, shapedId: shape.id };
      if (keep) {
        const nw = Math.max(12, Math.round(r.uw * it.w / r.sw)), nh = Math.max(12, Math.round(r.uh * it.h / r.sh));
        next.x = Math.round(it.x + (it.w - nw) / 2); next.y = Math.round(it.y + (it.h - nh) / 2); next.w = nw; next.h = nh;
      }
      changes.push({ t: t, prev: prev, next: next });
    } else {
      const im = state.extractedImages[t.idx];
      changes.push({ t: t, prev: { dataUrl: im.dataUrl, width: im.width, height: im.height }, next: { dataUrl: r.dataUrl, width: r.w, height: r.h } });
    }
  }
  const applyAll = function (which) {
    changes.forEach(function (c) {
      if (c.live) { if (c[which + 'Box']) Object.assign(c.t.item, c[which + 'Box']); pdfedLiveLookSet(c.t.item, c[which + 'Look']); }
      else if (c.t.kind === 'placed') Object.assign(c.t.item, c[which]);
      else { const im = state.extractedImages[c.t.idx]; if (im) Object.assign(im, c[which]); }
    });
    if (pageIdx >= 0) { pdfedMarkModified(pageIdx); pdfedRenderPlacedImages(pageIdx); }
    try { const gw = document.getElementById('galleryWrap'); if (gw && gw.style.display !== 'none') renderGallery(); } catch (e) {}
  };
  applyAll('next');
  pushAppHistory({
    label: 'Reshape image (Kadessa)',
    undo: function () { applyAll('prev'); toast('Reshape undone', 'info'); },
    redo: function () { applyAll('next'); toast('Shape applied, ' + shape.name, 'success'); }
  });
  if (typeof swTrack === 'function') swTrack('kadessa_image_reshaped', { module: 'pdf_editor', shape: built ? 'built' : shape.id, keep: keep, zoom: zoomPct, focus: focusMode, bevel: bevel, count: targets.length });

  const bits = [];
  bits.push('Reshaped into ' + shape.name + (built ? ' (built now and saved to My Shapes)' : '') + (targets.length > 1 ? ' on ' + targets.length + ' images' : ''));
  if (keep) bits.push("cropped to the shape's true proportions");
  if (zoomPct > 100) bits.push('zoomed to ' + zoomPct + '%');
  if (focusNote) bits.push(focusNote);
  if (bevel) bits.push(bevelStyle + ' bevel rim'); else if (borderColor) bits.push('a ' + borderColor + ' border');
  if (shadow) bits.push('soft shadow');
  if (changes.some(function(c){ return c.live; })) bits.push('applied live to the clip, so it keeps playing and exports exactly like this');
  if (built && built._notes && built._notes.length) notes.push('Note: ' + built._notes.join('; ') + '.');
  return bits.join(', ') + '.' + (notes.length ? ' ' + notes.join(' ') : '');
}

// ── KADESSA — SHAPE LIBRARY (create / edit / delete My Shapes) ────────────
async function pdfedKadessaCreateCustomShape(p) {
  p = p || {};
  const rec = await rshKadessaCreateShape(p);
  return 'Saved "' + rec.name + '" to My Shapes (' + (rec.nodes || []).length + ' points). It is not on an image yet.' + (rec._notes && rec._notes.length ? ' Note: ' + rec._notes.join('; ') + '.' : '');
}

async function pdfedKadessaEditCustomShape(p) {
  p = p || {};
  await rshMyShapesLoad();
  if (!p.shape) throw new Error('say which shape to change');
  const target = pdfedKadessaFindReshapeShape(p.shape);
  if (!target) throw new Error('no shape called "' + p.shape + '"');
  const mine = rshMyShapes.find(function (s) { return s.id === target.id; }) || null;
  let nodes, smooth, geo = false, notes = [];
  if (p.replace && typeof p.replace === 'object') {
    const b = rshBuildShapeSpec(p.replace); nodes = b.nodes; smooth = b.smooth; geo = true; notes = b.notes;
  } else {
    if (mine && Array.isArray(mine.nodes) && mine.nodes.length >= 3) { nodes = csClone(mine.nodes); smooth = mine.smooth != null ? mine.smooth : 100; }
    else { nodes = rshPathToNodes(target.d); smooth = 100; }
    if (p.smooth !== undefined && p.smooth !== null && p.smooth !== '') { smooth = Math.round(rshNum(p.smooth, 0, 100, smooth)); geo = true; }
    const f0 = smooth / 100 / 6;
    if (p.mirror === 'left' || p.mirror === 'right') { nodes = rshMirrorSampled(nodes, f0, p.mirror === 'left'); geo = true; }
    if (rshApplyShapeOps(nodes, p, f0)) geo = true;
    if (geo && p.fit !== false) rshFitNodes(nodes, f0);
    if (nodes.length > RSH_KADESSA_MAX_NODES) throw new Error('that outline has too many points');
  }
  const wantsName = typeof p.rename === 'string' && p.rename.trim();
  if (!geo && !wantsName) throw new Error('nothing to change, give rename, flip, rotate, width_pct, height_pct, smooth, mirror or replace');
  const asCopy = p.as_copy === true || !mine;
  const name = wantsName ? rshKadessaCleanName(p.rename, target.name) : (asCopy ? rshKadessaCleanName(target.name + ' copy', 'My Shape') : target.name);
  const rec = await rshKadessaSaveShape(name, { nodes: nodes, smooth: smooth }, asCopy ? null : mine);
  if (typeof swTrack === 'function') swTrack('kadessa_shape_edited', { module: 'pdf_editor', copy: asCopy });
  return (asCopy ? 'Saved a new copy called "' : 'Updated "') + rec.name + '" in My Shapes. Images already cut with the old version stay as they are.' + (notes.length ? ' Note: ' + notes.join('; ') + '.' : '');
}

async function pdfedKadessaDeleteCustomShape(p) {
  p = p || {};
  await rshMyShapesLoad();
  if (!p.shape) throw new Error('say which shape to delete');
  const target = pdfedKadessaFindReshapeShape(p.shape);
  if (!target) throw new Error('no shape called "' + p.shape + '"');
  const mine = rshMyShapes.find(function (s) { return s.id === target.id; });
  if (!mine) throw new Error('"' + target.name + '" is a built-in shape, built-in shapes cannot be deleted');
  await rshDeleteMyShape(mine.id);
  return 'Deleted "' + mine.name + '" from My Shapes. Images already cut with it are not affected.';
}

// What Kadessa sees about the shaper on every turn (context.imageShaper).
function pdfedKadessaShaperContext() {
  try { if (!rshMyShapesLoaded) rshMyShapesLoad(); } catch (e) {}
  return {
    builtIn: RSH_SHAPES.map(function (s) { return s.id; }),
    mine: (rshMyShapes || []).slice(0, 40).map(function (s) { return { id: s.id, name: s.name }; }),
    recipes: RSH_KADESSA_RECIPE_KINDS,
    canBuild: true,
    autoFocus: true
  };
}
function pdfedKadessaGalleryContext() {
  try {
    const list = (typeof state !== 'undefined' && state.extractedImages) || [];
    if (!list.length) return undefined;
    return list.slice(0, 30).map(function (im, i) { return { n: i + 1, w: im.width || null, h: im.height || null }; });
  } catch (e) { return undefined; }
}

// ─── LIVE CLIP LOOK (build 291) ─────────────────────────────────────────
// A live clip keeps moving, so a baked reshape or filter (which only repaints its still poster) cannot work on it.
// The shape and the filter are stored on the clip spec instead, as clip.look = { shape, fx }, and sppLiveFrame applies them on
// EVERY frame: page canvas, thumbnails, slideshow preview and MP4 export all draw through it, so what you see is what exports.
//   look.shape = { id, name, d, inset, rot, flipH, flipV, zoom, fx, fy, bevel, bevelStyle, border, borderW, shadow, bb? }
//   look.fx    = { preset, strength }       (same presets and strength as the Design panel)
// Nothing is baked, so a look can be changed or removed at any time. Undo/redo, duplicate, page copy and save all carry it
// because it lives inside the clip object.
function pdfedLiveClone(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }
function pdfedLiveFindPage(item) {
  if (typeof pdfed === 'undefined' || !pdfed.pages) return -1;
  for (let i = 0; i < pdfed.pages.length; i++) { const l = pdfed.pages[i] && pdfed.pages[i].placedImages; if (l && l.indexOf(item) !== -1) return i; }
  return -1;
}
function pdfedLiveShapeBBox(d, o) {
  const inset = rshNum(o.inset, 30, 100, 100) / 100;
  const M = new DOMMatrix().translate(500, 500).rotate(o.rot || 0).scale((o.flipH ? -1 : 1) * inset, (o.flipV ? -1 : 1) * inset).translate(-500, -500);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  rshPathSamples(d, 240).forEach(function (p) {
    const q = M.transformPoint(new DOMPoint(p.x, p.y));
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  });
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}
// shape = { id, name, d }.  o = { inset, rot, flipH, flipV, zoom, fx, fy, bevel, bevelStyle, border, borderW, shadow, keep }
function pdfedLiveBuildShape(shape, o) {
  o = o || {};
  const spec = {
    id: shape.id, name: shape.name, d: shape.d,
    inset: Math.round(rshNum(o.inset, 30, 100, 100)), rot: rshNum(o.rot, -360, 360, 0), flipH: o.flipH === true, flipV: o.flipV === true,
    zoom: Math.round(rshNum(o.zoom, 100, 400, 100)), fx: rshNum(o.fx, 0, 100, 50), fy: rshNum(o.fy, 0, 100, 50),
    bevel: o.bevel === true, bevelStyle: ['gold', 'silver', 'graphite'].indexOf(o.bevelStyle) !== -1 ? o.bevelStyle : 'gold',
    border: /^#[0-9a-fA-F]{6}$/.test(o.border || '') ? o.border : '', borderW: 0, shadow: o.shadow === true
  };
  if (spec.border) spec.borderW = Math.round(rshNum(o.borderW, 0, 100, 16));
  if (o.keep === true) spec.bb = pdfedLiveShapeBBox(spec.d, spec);
  return spec;
}
// With keep-proportions the clip's frame takes the shape's own proportions (a circle becomes a real circle), centred where it was.
function pdfedLiveKeepBox(item, spec) {
  if (!spec.bb) return null;
  const A = spec.bb[2] / spec.bb[3]; if (!(A > 0.02 && A < 50)) return null;
  let nw = item.h * A, nh = item.h; if (nw > item.w) { nw = item.w; nh = item.w / A; }
  nw = Math.max(12, Math.round(nw)); nh = Math.max(12, Math.round(nh));
  return { x: Math.round(item.x + (item.w - nw) / 2), y: Math.round(item.y + (item.h - nh) / 2), w: nw, h: nh };
}
function pdfedLiveFrameCanvas(item, noLook, tSec) {
  const ar = (item.w > 0 && item.h > 0) ? item.w / item.h : sppLiveAspect(item.clip), long = 800;
  const w = ar >= 1 ? long : Math.max(2, Math.round(long * ar)), h = ar >= 1 ? Math.max(2, Math.round(long / ar)) : long;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const secs = (item.clip.o && item.clip.o.secs) || 4;
  const ok = sppLiveFrame(item.clip, c.getContext('2d'), w, h, tSec == null ? Math.min(secs * 0.5, 2.5) : tSec, noLook === true);
  return ok ? c : null;
}
// The clip's own frame WITHOUT any look: what the Reshape window shows to cut from.
function pdfedLiveBaseFrameUrl(item) { const c = pdfedLiveFrameCanvas(item, true); return c ? c.toDataURL('image/png') : ''; }
// The still poster is what flattened views fall back on, so it is repainted with the look on.
async function pdfedLiveRepaintPoster(item) {
  try {
    await sppLiveReady(item.clip);
    const c = pdfedLiveFrameCanvas(item, false);
    if (c) item.dataUrl = c.toDataURL('image/png');
  } catch (e) { console.warn('[Workspace] could not repaint the live clip poster', e); }
}
function pdfedLiveLookSet(item, look) {
  if (!item || !item.clip) return;
  if (look && (look.shape || look.fx)) item.clip.look = look; else delete item.clip.look;
  const pi = pdfedLiveFindPage(item);
  if (pi >= 0) { pdfedMarkModified(pi); pdfedRenderPlacedImages(pi); }
  if (typeof sppLiveRedraw === 'function') sppLiveRedraw(item.clip);
  pdfedLiveRepaintPoster(item);
}
// entries: [{ item, prevLook, nextLook, prevBox?, nextBox? }]
function pdfedLivePush(label, entries) {
  const run = function (which) {
    entries.forEach(function (e) { const b = e[which + 'Box']; if (b) Object.assign(e.item, b); pdfedLiveLookSet(e.item, e[which + 'Look']); });
  };
  pushAppHistory({
    label: label,
    undo: function () { run('prev'); toast(label + ' undone', 'info'); },
    redo: function () { run('next'); toast(label + ' reapplied', 'success'); }
  });
}
function pdfedLiveApplyFilter(items, presetId, strength, label) {
  const entries = [];
  items.forEach(function (it) {
    if (!it.clip) return;
    const prev = pdfedLiveClone(it.clip.look) || {};
    const next = Object.assign({}, prev, { fx: { preset: presetId, strength: strength } });
    entries.push({ item: it, prevLook: prev, nextLook: next });
    pdfedLiveLookSet(it, next);
  });
  if (entries.length) pdfedLivePush(label || 'Filter on live clip', entries);
  return entries.length;
}
async function pdfedLiveOpenReshape(pageIdx, item) {
  try { await sppLiveReady(item.clip); } catch (e) {}
  const url = pdfedLiveBaseFrameUrl(item);
  if (!url) { toast('This live clip is still loading, try again in a moment', 'info'); return; }
  const cur = item.clip.look && item.clip.look.shape;
  reshape.idx = null; reshape.placedRef = { pageIdx: pageIdx, item: item }; reshape.liveClip = true;
  reshape.shapeId = cur ? cur.id : 'circle'; reshape.bevel = false; reshape.bevelStyle = 'gold'; reshape.srcDataUrl = url;
  openReshapeStage(url);
}
function pdfedLiveApplyModalShape(shape) {
  const item = reshape.placedRef.item, prev = pdfedLiveClone(item.clip.look) || {};
  const spec = pdfedLiveBuildShape(shape, { bevel: reshape.bevel, bevelStyle: reshape.bevelStyle });
  const next = Object.assign({}, prev, { shape: spec });
  pdfedLiveLookSet(item, next);
  pdfedLivePush('Reshape live clip', [{ item: item, prevLook: prev, nextLook: next }]);
  swTrack('image_shaper_used', { module: 'pdf_editor', shape: shape.custom ? 'custom' : shape.id, bevel: !!reshape.bevel, live: true });
  closeReshape();
  toast('Shape applied to the live clip, ' + shape.name + '. It keeps playing.', 'success');
}
// Small popover on a live clip: shape, filter, strength, reset.
let pdfedLiveLookCtx = null;
function pdfedLiveCloseLookPopover() { const p = document.getElementById('pdfedLiveLookPop'); if (p) p.style.display = 'none'; pdfedLiveLookCtx = null; }
function pdfedLiveOpenLookPopover(ev, idx, item) {
  ev.stopPropagation();
  if (!item || !item.clip) return;
  let pop = document.getElementById('pdfedLiveLookPop');
  if (!pop) {
    pop = document.createElement('div'); pop.id = 'pdfedLiveLookPop';
    pop.style.cssText = "position:fixed;z-index:9999;display:none;flex-direction:column;gap:8px;width:250px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,0.3);font-family:'Inter',sans-serif;font-size:11px;color:var(--text)";
    document.body.appendChild(pop);
  }
  const look0 = item.clip.look || {};
  const fxNow = look0.fx || null, shNow = look0.shape || null;
  const sel = '<select id="llFx" style="flex:1;min-width:0;background:var(--bg3,transparent);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:3px 4px;font-size:11px"><option value="">None</option>' +
    PDFED_DESIGN_PRESETS.map(function (p) { return '<option value="' + p.id + '"' + (fxNow && fxNow.preset === p.id ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select>';
  const btn = 'style="background:transparent;color:var(--text);border:1px solid var(--border);border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer"';
  pop.innerHTML =
    '<div style="font-weight:700;color:var(--text2)">Live clip look <span style="font-weight:500">(it keeps playing)</span></div>' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="width:50px;color:var(--text2)">Shape</span><span id="llShapeName" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (shNow ? String(shNow.name || shNow.id).replace(/</g, '&lt;') : 'None') + '</span><button id="llShapeBtn" ' + btn + '>Choose</button>' + (shNow ? '<button id="llShapeX" ' + btn + '>Remove</button>' : '') + '</div>' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="width:50px;color:var(--text2)">Filter</span>' + sel + '</div>' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="width:50px;color:var(--text2)">Strength</span><input id="llStr" type="range" min="0" max="100" step="1" value="' + (fxNow ? fxNow.strength : 50) + '" style="flex:1" onmousedown="event.stopPropagation()"><span id="llStrV" style="width:26px;text-align:right">' + (fxNow ? fxNow.strength : 50) + '</span></div>' +
    '<div style="display:flex;justify-content:flex-end"><button id="llReset" ' + btn + '>Reset look</button></div>';
  pop.style.display = 'flex';
  let left = ev.clientX - 200, top = ev.clientY + 14;
  if (left + 262 > window.innerWidth - 8) left = window.innerWidth - 270;
  if (left < 8) left = 8;
  if (top + 190 > window.innerHeight - 8) top = Math.max(8, ev.clientY - 200);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  pdfedLiveLookCtx = { item: item, pre: pdfedLiveClone(item.clip.look) || {} };
  const $ = function (id) { return pop.querySelector('#' + id); };
  const cur = function () { return pdfedLiveClone(item.clip.look) || {}; };
  const commit = function (label, next) {
    const prev = pdfedLiveLookCtx ? pdfedLiveLookCtx.pre : {};
    pdfedLiveLookSet(item, next);
    pdfedLivePush(label, [{ item: item, prevLook: prev, nextLook: pdfedLiveClone(next) || {} }]);
    if (pdfedLiveLookCtx) pdfedLiveLookCtx.pre = pdfedLiveClone(next) || {};
  };
  $('llShapeBtn').onclick = function () { pdfedLiveCloseLookPopover(); pdfedLiveOpenReshape(pdfedLiveFindPage(item), item); };
  if ($('llShapeX')) $('llShapeX').onclick = function () { const n = cur(); delete n.shape; commit('Remove live clip shape', n); pdfedLiveCloseLookPopover(); };
  $('llFx').onchange = function () {
    const n = cur(), v = this.value;
    if (v) n.fx = { preset: v, strength: parseInt($('llStr').value, 10) || 0 }; else delete n.fx;
    commit(v ? 'Filter on live clip' : 'Remove live clip filter', n);
  };
  $('llStr').oninput = function () {
    $('llStrV').textContent = this.value;
    const v = $('llFx').value; if (!v) return;
    const n = cur(); n.fx = { preset: v, strength: parseInt(this.value, 10) || 0 };
    item.clip.look = n; sppLiveRedraw(item.clip);          // live while dragging, no history entry yet
  };
  $('llStr').onchange = function () {
    const v = $('llFx').value; if (!v) return;
    const n = cur(); n.fx = { preset: v, strength: parseInt(this.value, 10) || 0 };
    commit('Filter strength on live clip', n);
  };
  $('llReset').onclick = function () { commit('Reset live clip look', {}); pdfedLiveCloseLookPopover(); };
}
document.addEventListener('mousedown', function (e) {
  const p = document.getElementById('pdfedLiveLookPop');
  if (!p || p.style.display === 'none') return;
  if (e.target.closest('#pdfedLiveLookPop') || e.target.closest('.pdfed-live-look-btn')) return;
  pdfedLiveCloseLookPopover();
});

// Kadessa: take the live look off a live clip.
async function pdfedKadessaClearLiveLook(p) {
  p = p || {};
  const ap = pdfedKadessaActivePage(p), pg = ap.pg, imgs = (pg.placedImages || []).filter(function (it) { return it.clip; });
  if (!imgs.length) throw new Error('there is no live clip on this page');
  let items = [];
  if (p.target === 'all') items = imgs;
  else if (p.id || (p.which !== undefined && p.which !== null && p.which !== '')) { const it = pdfedKadessaFindImage(pg, p); if (it && it.clip) items = [it]; }
  else {
    const sel = (ap.idx === pdfed.active) ? pdfedDesignGetSelectedImageItems().filter(function (it) { return it.clip; }) : [];
    items = sel.length ? sel : (imgs.length === 1 ? imgs : []);
  }
  if (!items.length) throw new Error(imgs.length > 1 ? 'there are several live clips on this page, say which one (or say all of them)' : 'that image is not a live clip');
  const what = ['shape', 'filter', 'both'].indexOf(p.what) !== -1 ? p.what : 'both';
  const entries = [];
  items.forEach(function (it) {
    const prev = pdfedLiveClone(it.clip.look) || {};
    if (!prev.shape && !prev.fx) return;
    const next = pdfedLiveClone(prev);
    if (what !== 'filter') delete next.shape;
    if (what !== 'shape') delete next.fx;
    entries.push({ item: it, prevLook: prev, nextLook: next });
    pdfedLiveLookSet(it, next);
  });
  if (!entries.length) return 'That live clip had no shape or filter on it.';
  pdfedLivePush('Clear live clip look (Kadessa)', entries);
  return (what === 'both' ? 'Shape and filter' : (what === 'shape' ? 'Shape' : 'Filter')) + ' removed from ' + (entries.length > 1 ? entries.length + ' live clips' : 'the live clip') + '. It keeps playing.';
}

async function pdfedKadessaApplyImageDesign(p) {
  p = p || {};
  const preset = PDFED_DESIGN_PRESETS.find(pr => pr.id === p.preset);
  if (!preset) throw new Error('unknown design preset "' + p.preset + '"');
  const parsedStrength = parseInt(p.strength, 10);
  const strength = isNaN(parsedStrength) ? 50 : Math.max(0, Math.min(100, parsedStrength));
  const items = pdfedKadessaResolveDesignTargets(p.target);
  if (items.length === 0) {
    const pg = (pdfed.active >= 0) ? pdfed.pages[pdfed.active] : null;
    if (pg && pg.placedImages && pg.placedImages.length > 1) {
      throw new Error('there are several images on this page, select the one you mean first (or say "all images")');
    }
    throw new Error('no image to apply this to, place or select one first');
  }
  const pageIdx = pdfed.active;

  // Live clips get the filter LIVE (drawn on every frame, they keep playing); only still images are baked.
  const liveItems = items.filter(it => it.clip), stillOnly = items.filter(it => !it.clip);
  if (liveItems.length) {
    pdfedLiveApplyFilter(liveItems, preset.id, strength, preset.name + ' (Kadessa)');
    if (!stillOnly.length) {
      pdfedDesignState.preset = preset.id; pdfedDesignState.strength = strength;
      if (typeof pdfedDesignRenderGrid === 'function') pdfedDesignRenderGrid();
      swTrack('kadessa_image_design_applied', { module: 'pdf_editor', preset: preset.id, strength: strength, count: items.length, live: true });
      return preset.name + ' applied live to ' + (liveItems.length > 1 ? liveItems.length + ' live clips' : 'the live clip') + ', it keeps playing and exports the same way.';
    }
  }

  const results = await Promise.all(stillOnly.map(item => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      pdfedDesignApplyPresetToCtx(ctx, w, h, preset.id, strength);
      resolve({ item, prevDataUrl: item.dataUrl, newDataUrl: c.toDataURL('image/png') });
    };
    img.onerror = reject;
    img.src = item.dataUrl;
  })));

  results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
  pdfedMarkModified(pageIdx);
  pdfedRenderPlacedImages(pageIdx);

  pushAppHistory({
    label: preset.name + ' (Kadessa)',
    undo: () => {
      results.forEach(r => { r.item.dataUrl = r.prevDataUrl; });
      pdfedMarkModified(pageIdx);
      pdfedRenderPlacedImages(pageIdx);
      toast(preset.name + ' undone', 'info');
    },
    redo: () => {
      results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
      pdfedMarkModified(pageIdx);
      pdfedRenderPlacedImages(pageIdx);
      toast(preset.name + ' reapplied', 'success');
    }
  });

  // Keeps the Design panel's own preset grid + strength slider honest if
  // it happens to be open while Kadessa applies this -- same courtesy
  // pdfedKadessaSetCanvasFill pays the canvas-tint controls.
  pdfedDesignState.preset = preset.id;
  pdfedDesignState.strength = strength;
  if (typeof pdfedDesignRenderGrid === 'function') pdfedDesignRenderGrid();
  const strengthSlider = document.getElementById('pdfedDesignStrengthSlider');
  const strengthLabel = document.getElementById('pdfedDesignStrengthVal');
  if (strengthSlider) strengthSlider.value = strength;
  if (strengthLabel) strengthLabel.textContent = strength;

  swTrack('kadessa_image_design_applied', {
    module: 'pdf_editor',
    preset: preset.id,
    tier: preset.cosmic ? 'cosmic' : (preset.premium ? 'premium' : 'basic'),
    strength: strength,
    count: items.length
  });
  return preset.name + ' applied' + (items.length > 1 ? ' to ' + items.length + ' images' : '') + '.';
}

// ─── DESIGN — CINEMATIC MERGE ───────────────────────────────────────────
// Auto-blends exactly two selected, overlapping placed images at their
// shared edge: whichever pair of edges overlaps gets a cross-dissolve
// baked into both images across the overlap band, so the seam between them
// disappears (the first image fades out across the band as the second
// fades in). Requires both images to be unrotated, since the overlap math
// is done in simple axis-aligned page coordinates.
function pdfedCinematicMerge() {
  const items = pdfedDesignGetSelectedImageItems();
  if (items.length !== 2) { toast('Select exactly 2 overlapping images to merge', 'info'); return; }
  const [a, b] = items;
  if ((a.rotation || 0) !== 0 || (b.rotation || 0) !== 0) {
    toast('Cinematic Merge works best with unrotated images, reset rotation first', 'info');
    return;
  }

  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
  if (ix1 <= ix0 || iy1 <= iy0) { toast("These images don't overlap, drag them together first", 'info'); return; }

  // A thin, tall overlap band means the images sit side by side (blend
  // left↔right); a thin, wide band means they're stacked (blend top↔bottom).
  const horizontal = (ix1 - ix0) <= (iy1 - iy0);
  const pageIdx = pdfed.active;

  let first, second; // first fades OUT across the shared band, second fades IN
  if (horizontal) {
    [first, second] = (a.x <= b.x) ? [a, b] : [b, a];
  } else {
    [first, second] = (a.y <= b.y) ? [a, b] : [b, a];
  }

  function buildMergedImage(item, isFirst) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-in';
        let grad;
        if (horizontal) {
          const scaleX = w / item.w;
          const lx0 = (ix0 - item.x) * scaleX, lx1 = (ix1 - item.x) * scaleX;
          grad = ctx.createLinearGradient(lx0, 0, lx1, 0);
        } else {
          const scaleY = h / item.h;
          const ly0 = (iy0 - item.y) * scaleY, ly1 = (iy1 - item.y) * scaleY;
          grad = ctx.createLinearGradient(0, ly0, 0, ly1);
        }
        if (isFirst) { grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); }
        else { grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)'); }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        resolve({ item, prevDataUrl: item.dataUrl, newDataUrl: c.toDataURL('image/png') });
      };
      img.onerror = reject;
      img.src = item.dataUrl;
    });
  }

  Promise.all([buildMergedImage(first, true), buildMergedImage(second, false)]).then(results => {
    results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
    pdfedMarkModified(pageIdx);
    pdfedRenderPlacedImages(pageIdx);

    pushAppHistory({
      label: 'Cinematic merge',
      undo: () => {
        results.forEach(r => { r.item.dataUrl = r.prevDataUrl; });
        pdfedMarkModified(pageIdx);
        pdfedRenderPlacedImages(pageIdx);
        toast('Merge undone', 'info');
      },
      redo: () => {
        results.forEach(r => { r.item.dataUrl = r.newDataUrl; });
        pdfedMarkModified(pageIdx);
        pdfedRenderPlacedImages(pageIdx);
        toast('Images merged', 'success');
      }
    });
    toast('Images merged', 'success');
  }).catch(() => toast('Could not merge these images', 'error'));
}

// Shows/hides the Design panel's controls based on current image selection,
// and enables Cinematic Merge only when exactly 2 images are selected.
// Called from pdfedRefreshSelectionPanel() so it stays in sync automatically
// with the same MutationObserver that already drives the selection panel.
function pdfedRefreshDesignPanel() {
  const empty = document.getElementById('pdfedDesignEmpty');
  const controls = document.getElementById('pdfedDesignControls');
  if (!empty || !controls) return;
  pdfedDesignRenderGrid();
  const items = pdfedDesignGetSelectedImageItems();
  const show = items.length > 0;
  empty.style.display = show ? 'none' : '';
  controls.style.display = show ? '' : 'none';
  pdfedDesignRefreshLivePreview();

  const mergeBtn = document.getElementById('pdfedDesignMergeBtn');
  const mergeHint = document.getElementById('pdfedDesignMergeHint');
  const canMerge = items.length === 2;
  if (mergeBtn) mergeBtn.disabled = !canMerge;
  if (mergeHint) mergeHint.textContent = canMerge
    ? 'Blend these 2 images at their overlapping edge'
    : 'Select exactly 2 overlapping images to merge (' + items.length + ' selected)';
}

function applyCrop() {
  if(state.currentEditIndex === null) return;
  const img = document.getElementById('cropImg');
  const r = getImgRect();
  if(r.w === 0) { toast('Image not loaded yet', 'error'); return; }
  const scaleX = r.nw / r.w;
  const scaleY = r.nh / r.h;
  // Convert workspace-relative box to image-relative, then to natural pixel coords
  const px = Math.max(0, Math.round((crop.box.x - r.x) * scaleX));
  const py = Math.max(0, Math.round((crop.box.y - r.y) * scaleY));
  const pw = Math.min(Math.round(crop.box.w * scaleX), r.nw - px);
  const ph = Math.min(Math.round(crop.box.h * scaleY), r.nh - py);
  if(pw < 4 || ph < 4) { toast('Selection too small', 'error'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = pw; canvas.height = ph;
  const ctx = canvas.getContext('2d');
  // Draw from the original dataUrl, not the displayed img element (avoids CSS scaling artifacts)
  const srcImg = new Image();
  srcImg.onload = () => {
    ctx.drawImage(srcImg, px, py, pw, ph, 0, 0, pw, ph);
    const newDataUrl = canvas.toDataURL('image/png');
    state.extractedImages[state.currentEditIndex].dataUrl = newDataUrl;
    state.extractedImages[state.currentEditIndex].width = pw;
    state.extractedImages[state.currentEditIndex].height = ph;
    if(document.getElementById('galleryWrap').style.display !== 'none') renderGallery();
    closeCrop();
    toast('Crop applied, ' + pw + '×' + ph + 'px', 'success');
  };
  srcImg.src = state.extractedImages[state.currentEditIndex].dataUrl;
}
