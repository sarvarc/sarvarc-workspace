// ─── KADESSA: TEXT COLOUR / GRADIENT (programmatic, no popover needed) ───────
// Drives the exact same placed-text fill engine the "A" colour swatch and
// the gradient popover above use (pdfedPtxtApplyColor / pdfedApplyPtxtGradient /
// pdfedApplyPtxtGradientDom) — same item.color / item.gradient shape, same
// CSS background-clip:text trick on screen, same canvas gradient at export —
// so a fill Kadessa applies is indistinguishable from one built by hand.
// Reuses pdfedKadessaValidHex (defined above, by the Canvas-fill Kadessa hook) for
// hex validation so both colour tools share one "is this actually a hex
// string" rule.

// Every placed-text box always has a live DOM node in #pdfedPlacedTextsLayer
// (keyed by item.id), whether or not it's the one currently focused/open in
// the toolbar — unlike the Edit Text overlay, there's no separate "read-only"
// render pass to worry about. This just looks that node up directly, so
// Kadessa can restyle a box that isn't the one the person happens to have
// clicked into.
function pdfedKadessaTextContentEl(item) {
  const layer = document.getElementById('pdfedPlacedTextsLayer');
  if (!layer || !item || !item.id) return null;
  const box = layer.querySelector('[data-id="' + item.id + '"]');
  return box ? box.querySelector('.pdfed-ptxt-content') : null;
}

// Picks which placedTexts item(s) on the CURRENT page a colour/gradient call
// acts on. target:'all' -> every text box on the page. query -> whichever
// box(es) contain that text (case-insensitive substring), so Kadessa can aim at
// "the heading" by quoting its words without needing an id. Otherwise falls
// back to whatever's currently open in the Add Text toolbar (pdfedPtxtTb),
// same "acts on the thing that's open" convention pdfed_set_canvas_gradient
// uses for pdfed.active — and if nothing's open but the page only has one
// text box, that's an unambiguous default too. Throws (rather than guessing)
// when there's more than one candidate and nothing narrows it down, same
// pattern as pdfed_apply_image_design's "which image?" guard.
function pdfedKadessaResolveTextTargets(p, pg) {
  const all = (pg && pg.placedTexts) || [];
  if (!all.length) throw new Error('no text boxes on this page to colour');

  if (p.target === 'all') return all.slice();

  if (p.query) {
    const q = String(p.query).toLowerCase();
    const matches = all.filter(it => (it.text || '').toLowerCase().includes(q));
    if (!matches.length) throw new Error('no text box on this page matches "' + p.query + '"');
    return matches;
  }

  if (pdfedPtxtTb.item && all.indexOf(pdfedPtxtTb.item) > -1) return [pdfedPtxtTb.item];

  if (all.length === 1) return all.slice();

  throw new Error('more than one text box on this page -- say which one (its text), or "all"');
}

// Minimal RGB<->HSL conversion, scoped to this feature only (no other part
// of the app needed one) -- used to rotate a sampled background hue into a
// complementary text-colour hue rather than picking an arbitrary accent.
function pdfedKadessaRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function pdfedKadessaHslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function pdfedKadessaRgbToHex(r, g, b) {
  const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Samples the live page canvas directly underneath a placed-text item's
// on-screen box and returns its average colour -- the same "read what's
// actually behind it" move pdfedExtractLogoColors makes for an attached
// logo, just aimed at the page background instead of a logo image. Reads
// the box's real rendered rect (not item.x/y/w/h) so an auto-width box that
// shrink-wrapped its text is sampled accurately. Returns null (never
// throws) on a tainted canvas or missing element, so callers can fall back
// to a sensible default instead of failing the whole action over a colour
// guess.
function pdfedKadessaSampleBehindText(item) {
  const canvas = document.getElementById('pdfedPageCanvas');
  const layer = document.getElementById('pdfedPlacedTextsLayer');
  if (!canvas || !canvas.width || !layer || !item) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const box = item.id ? layer.querySelector('[data-id="' + item.id + '"]') : null;
  let x, y, w, h;
  if (box) {
    const r = box.getBoundingClientRect();
    x = r.left - canvasRect.left; y = r.top - canvasRect.top; w = r.width; h = r.height;
  } else {
    x = item.x || 0; y = item.y || 0; w = item.w || 150; h = item.h || 40;
  }
  const scaleX = canvas.width / (canvasRect.width || canvas.width);
  const scaleY = canvas.height / (canvasRect.height || canvas.height);
  x = Math.max(0, Math.round(x * scaleX));
  y = Math.max(0, Math.round(y * scaleY));
  w = Math.max(1, Math.min(canvas.width - x, Math.round(w * scaleX)));
  h = Math.max(1, Math.min(canvas.height - y, Math.round(h * scaleY)));
  let data;
  try { data = canvas.getContext('2d').getImageData(x, y, w, h).data; }
  catch (e) { return null; } // tainted canvas (cross-origin image on the page) -- caller falls back
  let r = 0, g = 0, b = 0, n = 0;
  const stride = 4 * Math.max(1, Math.floor((w * h) / 2000)); // sample, don't walk every pixel of a huge box
  for (let i = 0; i < data.length; i += stride) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

// Turns a sampled background colour into a legible, intentional-looking text
// fill (a solid colour or a 2-stop gradient pair) -- the same "understand
// the intent from what's actually on the page" judgment
// pdfedKadessaApplyImageDesign applies to a placed image's mood, just for text
// colour instead of a photo effect. Rotates well away from the background's
// own hue (so the result reads as a deliberate choice, not a near-miss of
// the background) and picks lightness from the background's luminance --
// bright/saturated on a dark background, deep/saturated on a light one --
// so the result stays readable without the caller having to reason about
// contrast themselves. Falls back to the app's own brand gradient (as seen
// in the sidebar/launcher) when nothing could be sampled.
function pdfedKadessaAutoTextColors(bg) {
  if (!bg) return { color1: '#0EA5E9', color2: '#7C3AED' };
  const [h] = pdfedKadessaRgbToHsl(bg.r, bg.g, bg.b);
  const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  const baseHue = (h + 200) % 360;
  const isDarkBg = lum < 128;
  const s = 78, l = isDarkBg ? 68 : 42;
  const [r1, g1, b1] = pdfedKadessaHslToRgb(baseHue, s, l);
  const [r2, g2, b2] = pdfedKadessaHslToRgb((baseHue + 35) % 360, s, l);
  return { color1: pdfedKadessaRgbToHex(r1, g1, b1), color2: pdfedKadessaRgbToHex(r2, g2, b2) };
}

// Sets one or more placed-text boxes' fill to a solid colour, a 2-stop
// gradient, or clears back to plain black -- see pdfed_set_text_fill's
// registration below for the full param contract. color1/color2 are
// OPTIONAL: when either is missing (and mode isn't 'clear'), this samples
// the page behind that specific box (pdfedKadessaSampleBehindText) and picks a
// fitting pair itself (pdfedKadessaAutoTextColors), so "give the heading some
// colour" with zero specifics still produces a considered, on-page-aware
// result rather than a stock default.
async function pdfedKadessaSetTextFill(p) {
  p = p || {};
  if (typeof pdfed === 'undefined' || pdfed.active < 0 || !pdfed.pages || !pdfed.pages.length) {
    throw new Error('open a document first');
  }
  const pg = pdfed.pages[pdfed.active];
  const targets = pdfedKadessaResolveTextTargets(p, pg);

  let mode = p.mode === 'solid' ? 'solid' : p.mode === 'gradient' ? 'gradient' : p.mode === 'clear' ? 'clear' : null;
  if (!mode) mode = (p.color1 && !p.color2) ? 'solid' : 'gradient';

  const results = [];
  targets.forEach(item => {
    const content = pdfedKadessaTextContentEl(item);

    if (mode === 'clear') {
      item.gradient = null;
      item.color = pdfedKadessaValidHex(p.color1, item.color) || '#000000';
      if (content) { pdfedApplyPtxtGradientDom(content, null); content.style.color = item.color; }
      results.push({ id: item.id, color: item.color });
      return;
    }

    let color1 = pdfedKadessaValidHex(p.color1, null);
    let color2 = mode === 'gradient' ? pdfedKadessaValidHex(p.color2, null) : null;
    if (!color1 || (mode === 'gradient' && !color2)) {
      const auto = pdfedKadessaAutoTextColors(pdfedKadessaSampleBehindText(item));
      if (!color1) color1 = auto.color1;
      if (mode === 'gradient' && !color2) color2 = auto.color2;
    }
    const angle = (p.angle !== undefined && p.angle !== null && p.angle !== '')
      ? Math.max(0, Math.min(360, parseInt(p.angle, 10) || 0))
      : (item.gradient ? item.gradient.angle : 90);

    if (mode === 'solid') {
      item.color = color1;
      item.gradient = null;
      if (content) { pdfedApplyPtxtGradientDom(content, null); content.style.color = color1; }
      results.push({ id: item.id, color: color1 });
    } else {
      item.gradient = { color1, color2, angle };
      if (content) pdfedApplyPtxtGradientDom(content, item.gradient);
      results.push({ id: item.id, color1, color2, angle });
    }
  });

  // Keeps the manual gradient popover's own swatches/angle (and the toolbar's
  // gradient-button active state) honest if it happens to be open on one of
  // the boxes Kadessa just touched -- same courtesy pdfedKadessaSetCanvasFill pays
  // the Design panel's canvas-tint controls when it applies a fill.
  if (pdfedPtxtTb.item && targets.indexOf(pdfedPtxtTb.item) > -1) {
    const it = pdfedPtxtTb.item;
    const pop = document.getElementById('pdfedPtxtGradPopover');
    if (pop && pop.classList.contains('show')) {
      pdfedPtxtGradState.angle = it.gradient ? it.gradient.angle : pdfedPtxtGradState.angle;
      document.getElementById('pdfedPtxtGradFromInput').value = pdfedToHexColor(it.gradient ? it.gradient.color1 : it.color);
      document.getElementById('pdfedPtxtGradToInput').value = pdfedToHexColor(it.gradient ? it.gradient.color2 : it.color);
      pdfedPtxtGradRefreshPreview();
    }
    const gradBtn = document.getElementById('pdfedPtxtGradientBtn');
    if (gradBtn) gradBtn.classList.toggle('active', !!it.gradient);
  }

  pdfedMarkModified(pdfed.active);
  return { count: targets.length, mode, results };
}

// Splits saved rich HTML for a placed-text box into per-line runs of
// { text, color }, used both for re-rendering and for export baking.
function pdfedParseRichLines(html) {
  // Walks the full node tree (not just direct children) so a link or color
  // that ends up NESTED inside another wrapper tag — e.g. execCommand('createLink')
  // landing inside an existing <span style="color:...">, or a boundary <span>
  // the browser inserts around a formatting change — is still picked up.
  // The old version only inspected the immediate child element itself, so any
  // <a href> one level deeper than that was silently invisible to export:
  // the text still came through (via node.textContent) but with color/link
  // dropped, which is exactly why links "disappeared" (no color, no underline,
  // not clickable) on exported PDF/PNG/DOCX while looking correct on-screen.
  function walk(node, ctx, runs) {
    if (node.nodeType === 3) {
      if (node.textContent) runs.push({ text: node.textContent, color: ctx.color, link: ctx.link, bold: ctx.bold, italic: ctx.italic, underline: ctx.underline });
      return;
    }
    if (node.nodeType !== 1) return;
    const next = { color: ctx.color, link: ctx.link, bold: ctx.bold, italic: ctx.italic, underline: ctx.underline };
    if (node.style && node.style.color) next.color = node.style.color;
    if (node.tagName === 'A') next.link = node.getAttribute('href') || ctx.link;
    const tag = node.tagName;
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM') next.italic = true;
    if (tag === 'U') next.underline = true;
    if (node.style) {
      const fw = node.style.fontWeight;
      if (fw && (fw === 'bold' || parseInt(fw, 10) >= 600)) next.bold = true;
      if (node.style.fontStyle === 'italic') next.italic = true;
      if (node.style.textDecoration && /underline/.test(node.style.textDecoration)) next.underline = true;
    }
    node.childNodes.forEach(child => walk(child, next, runs));
  }

  // Bulleted boxes are stored as <ul><li> markup (from the Bullet List
  // toggle) rather than <br>-separated lines. Split on <li> instead, and
  // stitch a bullet glyph onto the front of each line as its own run so the
  // baked export (PDF/PNG/DOCX) shows the same marker the on-screen CSS draws.
  if (/<li[\s>]/i.test(html)) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const lis = tmp.querySelectorAll('li');
    if (lis.length) {
      return Array.from(lis).map(li => {
        const runs = [{ text: '•  ', color: null, link: null, bold: null, italic: null, underline: null }];
        li.childNodes.forEach(node => walk(node, { color: null, link: null, bold: null, italic: null, underline: null }, runs));
        return runs;
      });
    }
  }
  // Normalize block-level paragraph wrappers a browser may have inserted
  // (typically from an old paste, before pastes were normalized to plain
  // <br> breaks) into explicit <br> breaks too, so a </div><div> or </p><p>
  // boundary is treated as a new line exactly like the on-screen box
  // renders it, instead of silently merging separate paragraphs into one.
  const normalized = html
    .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, '<br>')
    .replace(/<(div|p)[^>]*>/gi, '')
    .replace(/<\/(div|p)>/gi, '')
    // The live box renders with white-space:pre-wrap, so a plain '\n'
    // character sitting inside a text node (e.g. text set via paste, AI
    // content generation, or translation — anything that assigns
    // item.text/item.html directly instead of going through real Enter-key
    // <br>/<div> splitting) shows as a visual line break on-screen but was
    // previously invisible to this parser: it split lines on <br> tags only,
    // so raw '\n's got treated as ordinary whitespace by the word-wrap pass
    // and every paragraph silently ran together into one flowing block in
    // the exported PDF/PNG. Converting '\n' to '<br>' here keeps export in
    // sync with what pre-wrap already shows in the editor.
    .replace(/\n/g, '<br>');
  const lineHtmls = normalized.split(/<br\s*\/?>/i);
  return lineHtmls.map(lineHtml => {
    const tmp = document.createElement('div');
    tmp.innerHTML = lineHtml;
    const runs = [];
    tmp.childNodes.forEach(node => walk(node, { color: null, link: null, bold: null, italic: null, underline: null }, runs));
    if (!runs.length) runs.push({ text: '', color: null, link: null, bold: null, italic: null, underline: null });
    return runs;
  });
}

// Canvas-px constants for the box's visual chrome, these are the SAME numbers
// used in pdfedDrawPlacedTextsOnCtx's padX/padY when baking for export, so the
// glyph position always matches exactly between on-screen editing and the
// downloaded file, at any zoom level.
const PDFED_PTXT_PAD_X = 6, PDFED_PTXT_PAD_Y = 4, PDFED_PTXT_BORDER = 1.5;

// Re-renders all placed text boxes for the given page as DOM overlay elements.
function pdfedRenderPlacedTexts(idx) {
  const layer = document.getElementById('pdfedPlacedTextsLayer');
  if (!layer) return;
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (tb) tb.style.display = 'none';
  pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  pdfedUpdatePtxtAlignButtons(null);
  pdfedSelected.clear();
  layer.innerHTML = '';
  const pgForZ = pdfed.pages[idx];
  if (pgForZ) pdfedGetZOrderedItems(pgForZ); // seeds zIndex on any legacy/missing items
  const list = (pdfed.pages[idx] && pdfed.pages[idx].placedTexts) || [];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) return;

  list.forEach(item => {
    // A locked box with a link has nothing else to do with a click — it can't
    // be dragged or edited while locked — so it gets full click-to-open
    // behavior instead of requiring Ctrl/Cmd. Unlocked boxes still need the
    // modifier so a plain click can keep doing its normal job (drag / place
    // the text cursor) without accidentally opening a new tab.
    const hasAnyLink = !!(item.link || (item.html && /<a[\s>]/i.test(item.html)));
    const clickToOpen = !!(item.locked && hasAnyLink);

    const el = document.createElement('div');
    el.className = 'pdfed-placed-text' + (item.locked ? ' locked' : '');
    el.dataset.id = item.id;
    el.style.cssText = `position:absolute;box-sizing:border-box;
      border-radius:4px;min-width:24px;min-height:20px;
      pointer-events:${item.locked && !clickToOpen ? 'none' : 'auto'};
      cursor:${clickToOpen ? 'pointer' : (item.locked ? 'default' : 'move')};
      z-index:${item.zIndex || 0};`;

    const content = document.createElement('div');
    content.className = 'pdfed-ptxt-content';
    content.contentEditable = !item.locked;
    content.spellcheck = false;
    content.style.cssText = `outline:none;white-space:pre-wrap;word-break:break-word;line-height:1.25;
      font-family:${pdfedFontCss(item.fontFamily)};cursor:${item.locked ? 'default' : 'text'};
      color:${item.color};font-weight:${item.bold ? '700' : '400'};
      font-style:${item.italic ? 'italic' : 'normal'};text-decoration:${item.underline ? 'underline' : 'none'};
      transition:none;opacity:${pdfedGetOpacity(item)};
      text-align:${item.align};pointer-events:${item.locked && !clickToOpen ? 'none' : 'auto'};`;
    content.textContent = item.text;
    if (item.html) content.innerHTML = item.html;
    if (item.gradient) pdfedApplyPtxtGradientDom(content, item.gradient);
    if (hasAnyLink) {
      const target = item.link || 'the link';
      content.title = clickToOpen ? ('Click to open ' + target) : ('Ctrl/Cmd-click to open ' + target);
      content.style.cursor = clickToOpen ? 'pointer' : (item.locked ? 'default' : 'pointer');
    }
    content.addEventListener('mousedown', (e) => {
      // Locked + linked box: a plain click opens it directly, no modifier needed.
      if (clickToOpen) {
        const a = e.target.closest && e.target.closest('a');
        const url = (a && a.getAttribute('href')) || item.link;
        if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); return; }
      }
      // Ctrl/Cmd-click opens a link: either an individual in-paragraph <a>
      // (from "Apply to Selected") or, failing that, the whole-box link.
      if (e.ctrlKey || e.metaKey) {
        const a = e.target.closest && e.target.closest('a');
        const url = (a && a.getAttribute('href')) || item.link;
        if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); return; }
      }
      // Allow native text selection/typing when already focused; otherwise let
      // the drag handler on `el` take over so a single click moves the box.
      if (document.activeElement !== content) { /* let drag happen */ }
      else { e.stopPropagation(); }
    });
    if (clickToOpen) {
      // Locked boxes have contentEditable off and no drag handler engaging
      // them, so also handle a plain click (not just mousedown) as a safety
      // net for touch/trackpad taps that don't always fire mousedown first.
      content.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a');
        const url = (a && a.getAttribute('href')) || item.link;
        if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); }
      });
    }
    content.addEventListener('dblclick', (e) => { e.stopPropagation(); content.focus(); });
    content.addEventListener('focus', () => { if (!item.locked) { pdfedShowPtxtToolbar(item, idx, content, el); el.classList.add('editing'); } });
    content.addEventListener('blur', () => {
      item.text = content.innerText || content.textContent || '';
      item.html = content.innerHTML;
      item.bullet = !!content.querySelector('ul');
      pdfedMarkModified(idx);
      el.classList.remove('editing');
      setTimeout(() => pdfedMaybeHidePtxtToolbar(), 120);
    });
    // Keeps item.text/html current the whole time someone is typing, not just
    // the instant they click away. Before this, the thumbnail/nav strip and
    // the auto-saved copy only ever reflected what was in the box as of the
    // LAST blur — so a long editing session looked frozen/stale in every
    // other part of the UI until you happened to click elsewhere. The actual
    // expensive work (thumbnail re-bake, IndexedDB save) is already debounced
    // inside pdfedMarkModified/pdfedRefreshThumb, so this stays cheap even on
    // fast typing — only the plain string sync below runs on every keystroke.
    content.addEventListener('input', () => {
      item.text = content.innerText || content.textContent || '';
      item.html = content.innerHTML;
      item.bullet = !!content.querySelector('ul');
      pdfedMarkModified(idx);
    });
    content.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { content.blur(); return; }
      if (e.key === 'Enter') {
        // Inside a bulleted list, let the browser's native Enter behavior run
        // (new bullet line, or exit the list on an empty trailing bullet) —
        // that's the one case where the browser's own block-splitting is
        // exactly what a bullet list needs.
        if (document.queryCommandState && document.queryCommandState('insertUnorderedList')) return;
        // Otherwise force a predictable <br> line break (instead of the browser's
        // default nested <div>/<p> blocks) so multi-line + multi-color text
        // exports correctly and parses back cleanly on reload.
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
      }
    });
    // Pasted text is the other way a browser sneaks in its own per-line
    // <div>/<p> wrapper elements (Enter already forces plain <br> above, but
    // that only covers typing — a paste goes through the clipboard's own
    // HTML, and Chrome/Firefox both split multi-line pasted content into
    // block elements, not <br>). Left alone, the box LOOKS right on screen
    // (browser gives each block its own line, sometimes with a bit of
    // default margin) but pdfedParseRichLines below only recognizes <br> as
    // a line break, so those <div>-separated lines silently ran together
    // into one line — or lost their gaps — the moment the same content was
    // baked into a thumbnail or an exported file. Normalizing every paste to
    // plain text, re-joined with the same explicit <br> breaks as typing,
    // keeps what's on screen and what gets exported permanently in sync.
    content.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      const withBreaks = text.split(/\r\n|\r|\n/).map(line =>
        line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      ).join('<br>');
      document.execCommand('insertHTML', false, withBreaks);
    });
    el.appendChild(content);
    pdfedPositionPlacedTextEl(el, item);

    // Lock/unlock badge, always visible while locked (it's the only way back in).
    // While unlocked it moves into the fading badgeRow below with the rest
    // of the action badges instead of being its own standalone piece of chrome.
    const lockBtn = document.createElement('button');
    lockBtn.title = item.locked ? 'Unlock to move/edit' : 'Lock in place';
    lockBtn.className = 'pdfed-badge-btn' + (item.locked ? ' is-locked' : '');
    lockBtn.style.cssText = `position:absolute;top:-8px;right:16px;z-index:2;${item.locked ? 'pointer-events:auto;' : ''}`;
    lockBtn.innerHTML = item.locked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.45-2"/></svg>';
    lockBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTogglePlacedTextLock(idx, item.id); };

    if (item.locked) {
      el.appendChild(lockBtn);
    } else {
      // Badge row: the same "dim until hovered" toolbar feel used by
      // placed shapes/images (.pdfed-badge-row) instead of a flat
      // show/hide — every action badge here recedes together while just
      // selected, then brightens together as one strip the moment the
      // pointer reaches any button in it (see .ptxt-badge-row CSS).
      const badgeRow = document.createElement('div');
      badgeRow.className = 'ptxt-chrome ptxt-badge-row';
      badgeRow.style.cssText = `position:absolute;inset:0;z-index:2;`;
      el.appendChild(badgeRow);
      badgeRow.appendChild(lockBtn);

      // Bring Forward, one-click step toward the front (unified z-order, so
      // it can step past an image or table too, not just another text box).
      // Mirrors the badge already on placed images (pdfedRenderPlacedImages).
      const fwdBtn = document.createElement('button');
      fwdBtn.title = 'Bring forward';
      fwdBtn.className = 'pdfed-badge-btn';
      fwdBtn.style.cssText = `position:absolute;top:-8px;right:100px;`;
      fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
      fwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('text', idx, item.id, 1); };
      badgeRow.appendChild(fwdBtn);

      // Send Backward, one-click step toward the back
      const bwdBtn = document.createElement('button');
      bwdBtn.title = 'Send backward';
      bwdBtn.className = 'pdfed-badge-btn';
      bwdBtn.style.cssText = `position:absolute;top:-8px;right:72px;`;
      bwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      bwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('text', idx, item.id, -1); };
      badgeRow.appendChild(bwdBtn);

      // Arrange (layer order) badge, jump straight To Front / To Back
      const arrBtn = document.createElement('button');
      arrBtn.title = 'Arrange, bring to front/back';
      arrBtn.className = 'pdfed-badge-btn';
      arrBtn.style.cssText = `position:absolute;top:-8px;right:44px;`;
      arrBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
      arrBtn.onclick = (ev) => pdfedOpenArrangeMenu(ev, 'text', idx, item.id);
      badgeRow.appendChild(arrBtn);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.title = 'Remove text';
      delBtn.className = 'pdfed-badge-btn is-danger';
      delBtn.style.cssText = `position:absolute;top:-8px;right:-12px;`;
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePlacedText(idx, item.id); };
      badgeRow.appendChild(delBtn);

      // Canva-style resize handles: the 4 corners uniformly scale the whole
      // text block (font size + box width move together); the 2 side handles
      // stretch just the box width so the text reflows/wraps inside it.
      // Chrome, hidden until the box is selected, like the delete button.
      const handles = {};
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(dir => {
        const h = pdfedMakePtxtHandle(dir);
        el.appendChild(h);
        handles[dir] = h;
      });

      pdfedAttachPlacedTextDragHandlers(el, content, item, idx, handles);
    }

    layer.appendChild(el);
  });
  pdfedRenderPlacedTables(idx);
  pdfedSyncPlacedTextsZoom();
}

// Positions one box using RAW, unscaled canvas-px values (same numbers
// pdfedDrawPlacedTextsOnCtx uses when baking for export). The box never needs
// to know about zoom, the whole pdfedPlacedTextsLayer is scaled as one unit
// via CSS transform (see pdfedSyncPlacedTextsZoom), exactly like the proven
// pdfedTextOverlay/pdfedSearchOverlay mechanism elsewhere in this file. This
// means a box's screen position only ever changes when its own item.x/y
// changes (drag) — never as a side effect of zooming in or out.
function pdfedPositionPlacedTextEl(el, item) {
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.borderWidth = PDFED_PTXT_BORDER + 'px';
  el.style.padding = PDFED_PTXT_PAD_Y + 'px ' + PDFED_PTXT_PAD_X + 'px';
  // Auto-width (default) boxes shrink-to-fit their text, like a fresh Canva text
  // box. Once a side handle sets item.w, the box takes that fixed width and the
  // content (a plain block child) wraps to fill it automatically.
  el.style.width = item.w ? (item.w + 'px') : '';
  // Auto-adjust: an auto-width box (no explicit item.w) still shrink-wraps its
  // text like Canva, but is capped to whatever room is left on the page from
  // its current x position, so someone typing a long paragraph (e.g. a blog
  // post on a blank page) automatically wraps onto new lines and never runs
  // off the visible canvas, without having to manually drag a resize handle.
  if (!item.w) {
    const pc = document.getElementById('pdfedPageCanvas');
    if (pc && pc.width) {
      const maxW = Math.max(60, pc.width - item.x - 12);
      el.style.maxWidth = maxW + 'px';
    }
  } else {
    el.style.maxWidth = '';
  }
  const content = el.querySelector('.pdfed-ptxt-content');
  if (content) content.style.fontSize = item.fontSize + 'px';
  // A page rotate (pdfedRotatePage) no longer bakes text boxes into pixels —
  // each one carries its own accumulated rotation through instead, applied
  // here as a plain CSS rotate around the box's own center. Position (x/y)
  // and wrap width are untouched by this, so the box stays exactly as
  // editable, draggable, and lockable as it was before any rotation, through
  // any number of turns including a full round trip back to 0°.
  el.style.transform = item.rotation ? `rotate(${item.rotation}deg)` : '';
}

// Sizes pdfedPlacedTextsLayer to the canvas's raw pixel dimensions and scales
// it as a single unit to match the current zoom, called from pdfedApplyZoom.
// Because every box inside is positioned in that same raw coordinate space,
// this is the ONLY thing that needs to change on zoom; no box ever moves
// relative to the page itself, it just rides along with the layer's scale.
// Sizes the shared pdfedPlacedZoomWrap to the canvas's raw pixel dimensions
// and scales it ONCE as a single unit to match the current zoom, called
// from pdfedApplyZoom. Every placed object (image, text, table) lives inside
// this one wrapper and is positioned in that same raw coordinate space, so
// nothing ever moves relative to the page itself on zoom, it just rides
// along with the wrapper's scale. Critically, the three inner layer divs
// (images/texts/tables) themselves carry NO transform of their own, only
// the wrapper does, so they don't each create a separate CSS stacking
// context. That's what lets an image's z-index actually compare against a
// text box's z-index: they share one stacking context instead of being
// trapped in three isolated ones.
function pdfedSyncPlacedTextsZoom() {
  const wrap = document.getElementById('pdfedPlacedZoomWrap');
  const pc = document.getElementById('pdfedPageCanvas');
  if (!wrap || !pc || !pc.width) return;
  wrap.style.width = pc.width + 'px';
  wrap.style.height = pc.height + 'px';
  wrap.style.transform = `scale(${pdfed.zoom})`;
  wrap.style.transformOrigin = 'top left';
  pdfedRenderGridOverlay();
}

// Sizes/scales the dot-grid overlay identically to pdfedPlacedTextsLayer (raw
// canvas-px box, one shared CSS transform) so grid dots always line up with
// the grid-snap coordinates used while dragging, at any zoom level.
function pdfedRenderGridOverlay() {
  const grid = document.getElementById('pdfedGridOverlay');
  const pc = document.getElementById('pdfedPageCanvas');
  if (!grid || !pc || !pc.width) return;
  grid.style.width = pc.width + 'px';
  grid.style.height = pc.height + 'px';
  grid.style.backgroundSize = `${PDFED_GRID_SIZE}px ${PDFED_GRID_SIZE}px`;
  grid.style.transform = `scale(${pdfed.zoom})`;
  grid.style.transformOrigin = 'top left';
  grid.style.display = pdfed.snapGrid ? 'block' : 'none';
}

// Toggles Canva-style grid-to-grid snapping for placed text (and its faint
// dot-grid overlay) on/off. When on, dragging or freshly placing a text box
// jumps cleanly between grid points instead of landing at arbitrary pixels.
function pdfedToggleGrid() {
  pdfed.snapGrid = !pdfed.snapGrid;
  const btn = document.getElementById('pdfedGridBtn');
  if (btn) btn.classList.toggle('active', pdfed.snapGrid);
  pdfedRenderGridOverlay();
  toast(pdfed.snapGrid ? 'Grid snap on, text, images and tables jump to grid points as you drag/resize' : 'Grid snap off, free placement', 'info');
}

// Rounds a raw canvas-px coordinate to the nearest grid line.
function pdfedSnapToGrid(v) {
  return Math.round(v / PDFED_GRID_SIZE) * PDFED_GRID_SIZE;
}

// Kept for compatibility with older call sites; layer-level transform now
// handles zoom, so this just re-syncs the layer transform (cheap, idempotent).
function pdfedRepositionPlacedTexts(idx) {
  pdfedSyncPlacedTextsZoom();
  if (pdfedPtxtTb.item) pdfedPositionPtxtToolbar();
}

// Builds one Canva-style handle for a placed-text box. `dir` is one of
// nw/ne/sw/se (corner, uniform scale) or w/e (side, width-only stretch) or
// n/s (top/bottom edge, font-size scale, like a corner but vertical-only).
function pdfedMakePtxtHandle(dir) {
  const isCorner = dir.length === 2;
  const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', w: 'ew-resize', e: 'ew-resize', n: 'ns-resize', s: 'ns-resize' };
  const pos = {
    nw: 'top:-4px;left:-4px;',
    ne: 'top:-4px;right:-4px;',
    sw: 'bottom:-4px;left:-4px;',
    se: 'bottom:-4px;right:-4px;',
    w:  'top:50%;left:-4px;margin-top:-4px;',
    e:  'top:50%;right:-4px;margin-top:-4px;',
    n:  'top:-4px;left:50%;margin-left:-4px;',
    s:  'bottom:-4px;left:50%;margin-left:-4px;'
  }[dir];
  const h = document.createElement('div');
  h.className = 'ptxt-chrome';
  h.dataset.dir = dir;
  h.title = (dir === 'w' || dir === 'e') ? 'Drag to resize text box width' : 'Drag to scale text';
  h.style.cssText = `position:absolute;${pos}width:8px;height:8px;cursor:${cursors[dir]};
    background:#fff;border:1.5px solid #0073E6;box-sizing:border-box;
    box-shadow:0 1px 3px rgba(0,0,0,0.35);
    border-radius:2px;z-index:3;`;
  return h;
}

// Vector (x,y) each handle drags along, away from the box center. Corners
// combine both axes for a uniform scale; side handles (w/e) only touch
// width; top/bottom edge handles (n/s) only touch font size/height, the
// same as a corner's vertical component alone.
const PDFED_PTXT_HANDLE_VEC = {
  nw: { x: -1, y: -1 }, ne: { x: 1, y: -1 }, sw: { x: -1, y: 1 }, se: { x: 1, y: 1 },
  w:  { x: -1, y: 0 },  e:  { x: 1, y: 0 },
  n:  { x: 0, y: -1 },  s:  { x: 0, y: 1 }
};

// Collects candidate snap positions (raw canvas-px) from the page's edges/
// center and every other placed text/image on the page, reading live DOM
// rects so it works whether a box is auto-width or explicitly sized.
function pdfedCollectSnapTargets(excludeId) {
  const targets = { x: [], y: [] };
  const wrap = document.getElementById('pdfedCanvasWrap');
  const pc = document.getElementById('pdfedPageCanvas');
  if (!wrap || !pc || !pc.width) return targets;
  const zoom = pdfed.zoom || 1;
  const wrapRect = wrap.getBoundingClientRect();
  targets.x.push(0, pc.width / 2, pc.width);
  targets.y.push(0, pc.height / 2, pc.height);
  wrap.querySelectorAll('#pdfedPlacedTextsLayer .pdfed-placed-text, #pdfedPlacedImagesLayer .pdfed-placed-img, #pdfedPlacedTablesLayer .pdfed-placed-table').forEach(node => {
    if (node.dataset.id === excludeId) return;
    const r = node.getBoundingClientRect();
    const left = (r.left - wrapRect.left) / zoom, right = (r.right - wrapRect.left) / zoom;
    const top = (r.top - wrapRect.top) / zoom, bottom = (r.bottom - wrapRect.top) / zoom;
    targets.x.push(left, (left + right) / 2, right);
    targets.y.push(top, (top + bottom) / 2, bottom);
  });
  return targets;
}

// Finds the closest snap target (if any) within SNAP px for a set of the
// moving box's own edge/center values along one axis.
function pdfedBestSnap(myVals, targets, SNAP) {
  let best = null;
  myVals.forEach(v => {
    targets.forEach(t => {
      const d = t - v;
      if (Math.abs(d) < SNAP && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    });
  });
  return best;
}

// Smart placement: while dragging, snaps the box to the page's edges/center
// AND to the edges/center of every other text/image on the page, Canva-style
// alignment guides, with thin guide lines showing what it snapped to. While
// resizing, the 4 corner handles scale the whole block (font size, and box
// width if one was set) uniformly; the 2 side handles stretch just the width,
// letting the text reflow/wrap inside the new box, like a Canva text frame.
function pdfedAttachPlacedTextDragHandlers(el, content, item, idx, handles) {
  let dragging = false, resizing = false, resizeDir = null;
  let ox = 0, oy = 0, ofs = 0, startX = 0, startY = 0, initialW = 0, initialX = 0, initialH = 0, initialY = 0;
  let moved = false, wasSelectedOnTapStart = false, snapTargets = null, beforeSnap = null;
  const SNAP = 10; // canvas-px snap threshold
  const TAP_THRESHOLD = 4; // px of mouse movement still counted as a tap, not a drag

  el.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    const dir = e.target && e.target.dataset ? e.target.dataset.dir : null;
    if (dir && handles[dir] === e.target) {
      resizing = true; resizeDir = dir;
      ox = e.clientX; oy = e.clientY; ofs = item.fontSize;
      initialW = item.w || el.offsetWidth; initialX = item.x;
      initialH = el.offsetHeight; initialY = item.y;
      beforeSnap = { x: item.x, y: item.y, w: item.w, fontSize: item.fontSize };
      pdfedShowPtxtToolbar(item, idx, content, el);
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (e.target.closest('button')) return;
    if (document.activeElement === content) return; // already editing, let native click position the caret
    // If a DIFFERENT box was still mid-edit, hand focus off explicitly. A
    // preventDefault() below stops the browser's own focus-shift, so without
    // this the old box silently kept the actual text cursor/keystrokes even
    // though this box now visually looks selected — the "typed into the
    // wrong box" bug that made switching between boxes feel unreliable.
    if (document.activeElement && document.activeElement !== content &&
        document.activeElement.classList && document.activeElement.classList.contains('pdfed-ptxt-content')) {
      document.activeElement.blur();
    }
    // Tap-to-select, tap-again-to-edit (Canva-style): first tap on a box just
    // selects it (shows the formatting toolbar); a second tap on an already-
    // selected box enters edit mode with all text pre-selected so the user can
    // immediately retype, or hit Delete/Backspace to clear it, or the trash icon to remove the box.
    wasSelectedOnTapStart = (pdfedPtxtTb.item === item && document.getElementById('pdfedPtxtToolbar').style.display !== 'none');
    moved = false;
    dragging = true; ox = e.clientX; oy = e.clientY; startX = item.x; startY = item.y;
    snapTargets = pdfedCollectSnapTargets(item.id);
    beforeSnap = { x: item.x, y: item.y, w: item.w, fontSize: item.fontSize };
    pdfedShowPtxtToolbar(item, idx, content, el);
    e.preventDefault(); e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging && !resizing) return;
    const scale = 1 / (pdfed.zoom || 1); // screen-px → raw canvas-px
    if (resizing) {
      const dx = (e.clientX - ox) * scale, dy = (e.clientY - oy) * scale;
      const v = PDFED_PTXT_HANDLE_VEC[resizeDir];
      if (resizeDir === 'w' || resizeDir === 'e') {
        // Pure side handle: width-only stretch, text reflows inside the new box.
        const newW = Math.max(30, initialW + dx * v.x);
        if (v.x < 0) item.x = initialX + (initialW - newW);
        item.w = newW;
      } else {
        // Corner (nw/ne/sw/se) or top/bottom edge (n/s): scale font size,
        // and box width along with it for corners (if a width was set),
        // keeping the opposite edge/corner anchored so it feels like a real
        // edge-to-edge resize in every direction, not just from one corner.
        const newFont = Math.max(8, Math.min(160, ofs + (dx * v.x + dy * v.y) * 0.4));
        const ratio = newFont / ofs;
        item.fontSize = newFont;
        if (v.x !== 0 && item.w) {
          const newW = Math.max(30, initialW * ratio);
          if (v.x < 0) item.x = initialX + (initialW - newW);
          item.w = newW;
        }
        if (v.y !== 0) {
          // Anchor the bottom edge when dragging a top handle (n/nw/ne) by
          // shifting item.y up/down as the block's implied height changes;
          // dragging a bottom handle (s/sw/se) needs no anchor adjustment
          // since the top edge (item.y) is already the fixed reference.
          const newH = Math.max(10, initialH * ratio);
          if (v.y < 0) item.y = initialY + (initialH - newH);
        }
      }
      content.style.fontSize = item.fontSize + 'px';
      pdfedPositionPlacedTextEl(el, item);
      if (pdfedPtxtTb.item === item) {
        document.getElementById('pdfedPtxtSizeInput').value = Math.round(item.fontSize);
        pdfedPositionPtxtToolbar();
      }
      return;
    }
    let nx = startX + (e.clientX - ox) * scale;
    let ny = startY + (e.clientY - oy) * scale;
    if (Math.abs(e.clientX - ox) > TAP_THRESHOLD || Math.abs(e.clientY - oy) > TAP_THRESHOLD) moved = true;

    // Smart snapping, page edges/center plus every other object's edges/center.
    const boxW = el.offsetWidth, boxH = el.offsetHeight;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    const bestX = pdfedBestSnap([nx, nx + boxW / 2, nx + boxW], (snapTargets || { x: [] }).x, SNAP);
    const bestY = pdfedBestSnap([ny, ny + boxH / 2, ny + boxH], (snapTargets || { y: [] }).y, SNAP);
    if (bestX) nx += bestX.delta;
    if (bestY) ny += bestY.delta;
    // Grid-to-grid snapping (Canva-style): only kicks in on an axis where no
    // sharper object/page-edge guide already fired, so aligning to another
    // element always wins over the plain grid.
    if (pdfed.snapGrid) {
      if (!bestX) nx = pdfedSnapToGrid(nx);
      if (!bestY) ny = pdfedSnapToGrid(ny);
    }
    if (guideV) {
      guideV.style.display = bestX ? 'block' : 'none';
      if (bestX) guideV.style.left = (bestX.at * (pdfed.zoom || 1)) + 'px';
    }
    if (guideH) {
      guideH.style.display = bestY ? 'block' : 'none';
      if (bestY) guideH.style.top = (bestY.at * (pdfed.zoom || 1)) + 'px';
    }

    item.x = nx; item.y = ny;
    pdfedPositionPlacedTextEl(el, item);
    if (pdfedPtxtTb.item === item) pdfedPositionPtxtToolbar();
  });
  document.addEventListener('mouseup', (e) => {
    if (resizing && pdfed.snapGrid) {
      // Snap the final box edges to the grid so a resized box lines up cleanly
      // with everything else, same as a dragged one.
      const newX = pdfedSnapToGrid(item.x);
      if (item.w) item.w = Math.max(30, pdfedSnapToGrid(item.x + item.w) - newX);
      item.x = newX;
      pdfedPositionPlacedTextEl(el, item);
    }
    if (dragging || resizing) pdfedMarkModified(idx);
    const wasTap = dragging && !moved;
    // One undo step for the whole drag/resize gesture, skipped for a plain
    // tap that never actually moved anything.
    if ((dragging || resizing) && !wasTap && beforeSnap) {
      const before = beforeSnap;
      const after = { x: item.x, y: item.y, w: item.w, fontSize: item.fontSize };
      if (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.fontSize !== after.fontSize) {
        const gIdx = idx;
        pushAppHistory({
          label: resizing ? 'Resize text' : 'Move text',
          undo: () => {
            item.x = before.x; item.y = before.y; item.w = before.w; item.fontSize = before.fontSize;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedTexts(gIdx);
          },
          redo: () => {
            item.x = after.x; item.y = after.y; item.w = after.w; item.fontSize = after.fontSize;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedTexts(gIdx);
          }
        });
      }
    }
    beforeSnap = null;
    dragging = false; resizing = false; resizeDir = null; snapTargets = null;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
    if (wasTap && wasSelectedOnTapStart && !item.locked) {
      content.focus();
      // A second tap on an already-selected box now drops the caret exactly
      // where you clicked — the same as clicking into text in Word/Docs/
      // Canva — instead of unconditionally selecting everything. That let
      // someone tweak one word in the middle of a paragraph with a single
      // click; before, every re-entry nuked the whole selection and a fix
      // like that took three separate clicks (select box, enter+select-all,
      // click again to actually place the caret). Falls back to select-all
      // only on a browser too old to resolve a point to a caret position.
      if (!pdfedPlaceCaretAtPoint(e.clientX, e.clientY)) pdfedSelectAllText(content);
    }
  });
}

function pdfedTogglePlacedTextLock(idx, id) {
  const list = (pdfed.pages[idx] && pdfed.pages[idx].placedTexts) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  item.locked = !item.locked;
  pdfedRenderPlacedTexts(idx);
  toast(item.locked ? 'Text locked, unlock to move/edit' : 'Text unlocked, drag or type to edit', 'info');
}

function pdfedDeletePlacedText(idx, id) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedTexts) return;
  if (pdfedPtxtTb.item && pdfedPtxtTb.item.id === id) {
    const tb = document.getElementById('pdfedPtxtToolbar');
    if (tb) tb.style.display = 'none';
    pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  }
  const i = pg.placedTexts.findIndex(t => t.id === id);
  if (i === -1) return;
  const removedItem = pg.placedTexts[i], removedIndex = i;
  pg.placedTexts.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Text removed', 'success');
  pushAppHistory({
    label: 'Delete text',
    undo: () => {
      pg.placedTexts.splice(Math.min(removedIndex, pg.placedTexts.length), 0, removedItem);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Text restored', 'info');
    },
    redo: () => {
      const at = pg.placedTexts.indexOf(removedItem);
      if (at !== -1) pg.placedTexts.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Text removed', 'success');
    }
  });
}

// Re-flows one rich-text line (an array of {text,color} runs, already split on
// manual \n / <br>) into multiple lines that each fit within maxWidth, without
// breaking a run's color boundaries. Mirrors the browser's own word-wrap of the
// live editable box (white-space:pre-wrap) closely enough for export baking.
function pdfedWrapRichLine(ctx, runs, maxWidth, fontCtx) {
  const out = [];
  let current = [], currentWidth = 0;
  runs.forEach(run => {
    // Resolve this run's own bold/italic against the box's overall default —
    // a run only overrides when it actually carried a <b>/<i>/style flag of
    // its own (see pdfedParseRichLines), otherwise it inherits the box style.
    const bold = fontCtx ? (run.bold != null ? run.bold : fontCtx.itemBold) : undefined;
    const italic = fontCtx ? (run.italic != null ? run.italic : fontCtx.itemItalic) : undefined;
    if (fontCtx) {
      ctx.font = `${italic ? 'italic' : 'normal'} ${bold ? '700' : '400'} ${fontCtx.fontSize}px ${fontCtx.fam}, Inter, sans-serif`;
    }
    const tokens = (run.text || '').match(/\S+\s*|\s+/g) || [''];
    tokens.forEach(tok => {
      const w = ctx.measureText(tok).width;
      if (currentWidth + w > maxWidth && current.length) {
        out.push(current);
        current = []; currentWidth = 0;
        if (/^\s+$/.test(tok)) return; // drop the space that triggered the wrap
      }
      current.push({ text: tok, color: run.color, link: run.link || null, bold, italic, underline: !!run.underline });
      currentWidth += w;
    });
  });
  out.push(current);
  return out;
}

// Draws all placed text boxes for a page onto a given canvas context, with word
// wrap honoring the box's on-screen width. Shared by export baking and rotate baking.
function pdfedDrawPlacedTextsOnCtx(ctx, list) {
  if (!list || !list.length) return;
  list.forEach(item => {
    const weight = item.bold ? '700' : '400';
    const style = item.italic ? 'italic' : 'normal';
    const famRaw = item.fontFamily || 'Inter';
    const fam = famRaw.includes(',') ? famRaw : `'${famRaw}'`;
    ctx.font = `${style} ${weight} ${item.fontSize}px ${fam}, Inter, sans-serif`;
    ctx.textBaseline = 'top';
    const lineHeight = item.fontSize * 1.25;
    const padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER; // mirrors the on-screen box's border+padding offset
    const anchorX = item.x + padX;
    const fontCtx = { fontSize: item.fontSize, fam, itemBold: !!item.bold, itemItalic: !!item.italic };
    // Switches ctx.font to a specific run's own resolved bold/italic (falling
    // back to the box defaults), so every measureText/fillText call below
    // uses the SAME per-run style the wrap pass already measured with.
    const setRunFont = (r) => { ctx.font = `${r.italic ? 'italic' : 'normal'} ${r.bold ? '700' : '400'} ${item.fontSize}px ${fam}, Inter, sans-serif`; };

    // Rich (multi-color) boxes are stored as HTML with <span style="color:..."> runs
    // from the formatting toolbar's selection-coloring; plain boxes just split on \n.
    let lines = item.html
      ? pdfedParseRichLines(item.html)
      : (item.text || '').split('\n').map(t => [{ text: t, color: null }]);

    // Boxes stretched via the width side-handles wrap on-screen using their
    // explicit item.w. Auto-width boxes (no item.w) ALSO wrap on-screen, via
    // the CSS max-width fallback in pdfedPositionPlacedTextEl (page width minus
    // the box's x position), so someone typing a long paragraph never runs off
    // the visible canvas. Previously this export path only replicated the
    // item.w case, so auto-width boxes were drawn unwrapped as a single long
    // line that overflowed past the page edge and got clipped in the exported
    // PDF/PNG/DOCX — the exact "missing text" cutoff bug. Mirror both cases so
    // export always matches what's shown on screen.
    let maxWidth;
    if (item.w) {
      maxWidth = Math.max(10, item.w - padX * 2);
    } else {
      // The live DOM box sets CSS max-width on a border-box element to
      // pageW - x - 12, and border-box max-width already has padding+border
      // subtracted on BOTH sides by the box model itself. This raster path
      // wraps directly in content-space, so it must subtract that same padX
      // twice too — subtracting it only once (the old behavior) made this
      // wrap width ~padX px WIDER than the editor's true content width,
      // letting one extra word fit per line here that the live box already
      // wrapped to the next line. That's what made the thumbnail/exported
      // page's line breaks (and box height) drift from the live editor the
      // longer an auto-width paragraph got.
      // ctx.canvas.width is the RAW device-pixel canvas size. On the plain
      // on-screen thumbnail (pdfedComposeThumb, no scale) that equals the
      // page's logical width, so this worked. But export renders through
      // pdfedComposeThumbHiRes, which supersamples the canvas 3x AND applies
      // ctx.scale(3,3) so item.x/y/w keep working unchanged in the original
      // coordinate space. Reading ctx.canvas.width there returns 3x the real
      // page width while item.x stays unscaled — the wrap math thought it had
      // 3x the actual room, so an auto-width paragraph's first "line" grew to
      // roughly triple its real length before wrapping, ran off the true page
      // edge, and got hard-clipped in the exported PDF (bug: paragraph text
      // cut off in export, e.g. "Management Remarks"-style free paragraphs).
      // Dividing by the context's own current horizontal scale converts back
      // to the logical page width regardless of supersample factor — 1 on the
      // plain thumbnail (no-op), 3 during export — so wrap width always
      // matches what the editor actually showed.
      const scaleX = (ctx.getTransform && ctx.getTransform().a) || 1;
      const pageW = ctx.canvas ? ctx.canvas.width / scaleX : 0;
      maxWidth = Math.max(10, (pageW ? (pageW - item.x - 12) : 99999) - padX * 2);
    }
    const wrapped = [];
    lines.forEach(runs => wrapped.push(...pdfedWrapRichLine(ctx, runs, maxWidth, fontCtx)));
    lines = wrapped;

    // The on-screen box centers/right-aligns each line within the BOX's own
    // width (CSS text-align), not around the box's raw x position. A fixed
    // box (item.w) has that width already; an auto-width box shrink-wraps to
    // its widest line, same as the DOM does. Anchoring center/right to item.x
    // directly (old behavior) ignored this box width entirely, so as soon as
    // a box was aligned or dragged, the thumbnail/export render drifted from
    // what the live page showed — this is what kept the two out of sync.
    let contentWidth = maxWidth;
    if (!item.w) {
      contentWidth = 0;
      lines.forEach(runs => {
        const w = runs.reduce((a, r) => { setRunFont(r); return a + ctx.measureText(r.text).width; }, 0);
        if (w > contentWidth) contentWidth = w;
      });
    }

    // A rotated box (see pdfedRotatePage) is still stored/wrapped in its own
    // UNROTATED local frame — same x/y/width/wrap math as an upright box —
    // and only spun around its own center at the very last step, here, so
    // the baked thumbnail/export pixels land exactly where the live DOM box
    // (rotated the same way via CSS transform) visually sits on screen.
    const boxW = (item.w || contentWidth) + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2;

    const boxRotation = item.rotation ? item.rotation * Math.PI / 180 : 0;
    if (boxRotation) {
      const bcx = item.x + boxW / 2, bcy = item.y + boxH / 2;
      ctx.save();
      ctx.translate(bcx, bcy);
      ctx.rotate(boxRotation);
      ctx.translate(-bcx, -bcy);
    }

    // A gradient fill (item.gradient, set via the toolbar's gradient button)
    // spans the WHOLE box rather than any one run, using the same angle-to-
    // line-segment math (pdfedGradientLine) as the Canvas recolor/gradient
    // panel, so it bakes into export exactly as it looks on screen — this
    // deliberately overrides any per-run rich-text color, matching how a
    // gradient fill is a whole-object property, not a per-character one.
    let gradFillStyle = null;
    if (item.gradient) {
      const gl = pdfedGradientLine(item.gradient.angle, boxW, boxH);
      const grad = ctx.createLinearGradient(item.x + gl.x0, item.y + gl.y0, item.x + gl.x1, item.y + gl.y1);
      grad.addColorStop(0, item.gradient.color1);
      grad.addColorStop(1, item.gradient.color2);
      gradFillStyle = grad;
    }

    lines.forEach((runs, i) => {
      const tyTop = item.y + padY + i * lineHeight;
      const widths = runs.map(r => { setRunFont(r); return ctx.measureText(r.text).width; });
      const totalWidth = widths.reduce((a, b) => a + b, 0);
      let startX = anchorX;
      if (item.align === 'center') startX = anchorX + (contentWidth - totalWidth) / 2;
      else if (item.align === 'right') startX = anchorX + (contentWidth - totalWidth);

      ctx.textAlign = 'left';
      let cx = startX;
      runs.forEach((r, ri) => {
        const color = gradFillStyle || r.color || item.color;
        if (r.text) {
          setRunFont(r);
          ctx.fillStyle = color;
          ctx.fillText(r.text, cx, tyTop);
          if (item.underline || r.underline) {
            const w = widths[ri];
            const uy = tyTop + item.fontSize * 1.05;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, item.fontSize * 0.06);
            ctx.beginPath();
            ctx.moveTo(cx, uy);
            ctx.lineTo(cx + w, uy);
            ctx.stroke();
            ctx.restore();
          }
        }
        cx += widths[ri];
      });
    });
    if (boxRotation) ctx.restore();
  });
}

// ── PLACED TABLE LAYER (Excel-style insert; Canva-style move/resize/lock) ──
// Mirrors the placed-text/placed-image systems above: each table is a plain
// data object (rows/cols/cells/x/y/colWidths/rowHeight/fontSize) stored on
// pdfed.pages[idx].placedTables, rendered as a live DOM overlay, and baked
// onto the canvas only at export time (pdfedDrawPlacedTablesOnCtx) — so
// tables stay fully editable/movable/lockable right up until download.

let pdfedTableSeq = 0;
let pdfedTableGridPending = { rows: 3, cols: 3 }; // last hovered size in the grid picker

function pdfedTableToggleDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('pdfedTableDropdown');
  const btn = document.getElementById('pdfedTableCaret');
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = rect.left + 'px';
    pdfedTableBuildGridPicker();
  }
}
document.addEventListener('click', function(e) {
  const group = document.getElementById('pdfedTableGroup');
  const dd = document.getElementById('pdfedTableDropdown');
  if (dd && group && !group.contains(e.target) && !dd.contains(e.target)) dd.classList.remove('open');
});

// Builds the 10x8 Excel-style hoverable grid once per dropdown open.
function pdfedTableBuildGridPicker() {
  const wrap = document.getElementById('pdfedTgridCells');
  if (!wrap || wrap.childElementCount) return; // build once, just re-show after
  const GRID_COLS = 10, GRID_ROWS = 8;
  wrap.style.gridTemplateRows = `repeat(${GRID_ROWS}, 16px)`;
  for (let r = 1; r <= GRID_ROWS; r++) {
    for (let c = 1; c <= GRID_COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'pdfed-tgrid-cell';
      cell.dataset.r = r; cell.dataset.c = c;
      cell.onmouseenter = () => pdfedTableGridHover(r, c);
      cell.onclick = (ev) => { ev.stopPropagation(); pdfedInsertTable(r, c); document.getElementById('pdfedTableDropdown').classList.remove('open'); };
      wrap.appendChild(cell);
    }
  }
}

function pdfedTableGridHover(r, c) {
  pdfedTableGridPending = { rows: r, cols: c };
  const label = document.getElementById('pdfedTgridLabel');
  if (label) label.textContent = (r && c) ? `Insert ${r} x ${c} table` : 'Insert table';
  document.querySelectorAll('#pdfedTgridCells .pdfed-tgrid-cell').forEach(cell => {
    const cr = parseInt(cell.dataset.r), cc = parseInt(cell.dataset.c);
    cell.classList.toggle('on', cr <= r && cc <= c);
  });
}

function pdfedTableInsertCustom() {
  const rows = Math.max(1, Math.min(30, parseInt(document.getElementById('pdfedTableCustomRows').value) || 1));
  const cols = Math.max(1, Math.min(15, parseInt(document.getElementById('pdfedTableCustomCols').value) || 1));
  pdfedInsertTable(rows, cols);
  document.getElementById('pdfedTableDropdown').classList.remove('open');
}

// Smart/preset tables, pre-filled headers for common structured-data use cases,
// so the person doesn't have to type column labels themselves for the basics.
function pdfedInsertSmartTable(kind) {
  document.getElementById('pdfedTableDropdown').classList.remove('open');
  const presets = {
    data: { rows: 5, cols: 4, headers: ['Name', 'Category', 'Value', 'Notes'] },
    invoice: { rows: 5, cols: 4, headers: ['Item', 'Qty', 'Price', 'Total'] },
    compare: { rows: 4, cols: 3, headers: ['Feature', 'Option A', 'Option B'] },
    list: { rows: 5, cols: 1, headers: ['Item'] },
  };
  const p = presets[kind];
  if (!p) return;
  pdfedInsertTable(p.rows, p.cols, { headers: p.headers });
}

// Creates a new table on the currently active page and drops it into the
// overlay, centered-ish and offset a little on each successive insert so
// stacked tables don't land exactly on top of one another.
function pdfedInsertTable(rows, cols, opts) {
  opts = opts || {};
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) { toast('Open a PDF first', 'error'); return; }
  rows = Math.max(1, Math.min(30, rows || 3));
  cols = Math.max(1, Math.min(15, cols || 3));
  const pg = pdfed.pages[idx];
  if (!pg.placedTables) pg.placedTables = [];

  const pc = document.getElementById('pdfedPageCanvas');
  const pageW = (pc && pc.width) || 600;
  const colW = Math.max(60, Math.min(140, Math.floor((pageW * 0.7) / cols)));
  const rowH = 30;
  const n = pg.placedTables.length;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(opts.headers && r === 0 ? (opts.headers[c] || '') : '');
    }
    cells.push(row);
  }

  const item = {
    id: 'tbl_' + (++pdfedTableSeq),
    x: pdfed.snapGrid ? pdfedSnapToGrid(40 + (n % 6) * 16) : 40 + (n % 6) * 16,
    y: pdfed.snapGrid ? pdfedSnapToGrid(40 + (n % 6) * 16) : 40 + (n % 6) * 16,
    rows, cols,
    colWidths: new Array(cols).fill(colW),
    rowHeights: new Array(rows).fill(rowH),
    fontSize: 12,
    headerRow: !!opts.headers,
    cells,
    locked: false,
    zIndex: pdfedNextZ(pg),
  };
  pg.placedTables.push(item);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  toast(`${rows} x ${cols} table added, drag to move, click a cell to type`, 'success');

  pushAppHistory({
    label: 'Insert table',
    undo: () => {
      const i = pg.placedTables.indexOf(item);
      if (i > -1) pg.placedTables.splice(i, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
      toast('Table insert undone', 'info');
    },
    redo: () => {
      if (pg.placedTables.indexOf(item) === -1) pg.placedTables.push(item);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
    }
  });
}

// Re-renders every placed table for the given page as DOM overlay elements —
// same overall approach as pdfedRenderPlacedTexts, called right alongside it.
function pdfedRenderPlacedTables(idx) {
  const layer = document.getElementById('pdfedPlacedTablesLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const pg = pdfed.pages[idx];
  if (pg) pdfedGetZOrderedItems(pg); // seeds zIndex on any legacy/missing items
  const list = (pg && pg.placedTables) || [];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) return;

  list.forEach(item => {
    // Back-compat: older tables (or ones deserialized before this version) may
    // still carry a single uniform `rowHeight` instead of a per-row array —
    // migrate them once here so every downstream read can assume rowHeights[].
    if (!item.rowHeights || item.rowHeights.length !== item.rows) {
      const fallback = item.rowHeight || 30;
      item.rowHeights = new Array(item.rows).fill(fallback);
    }
    const totalW = item.colWidths.reduce((a, b) => a + b, 0);
    const totalH = item.rowHeights.reduce((a, b) => a + b, 0);

    const el = document.createElement('div');
    el.className = 'pdfed-placed-table' + (item.locked ? ' locked' : '');
    el.dataset.id = item.id;
    el.style.cssText = `position:absolute;left:${item.x}px;top:${item.y}px;width:${totalW}px;height:${totalH}px;
      box-sizing:border-box;pointer-events:auto;cursor:${item.locked ? 'default' : 'default'};
      z-index:${item.zIndex || 0};`;

    const grid = document.createElement('div');
    grid.className = 'pdfed-table-grid';
    grid.style.gridTemplateColumns = item.colWidths.map(w => w + 'px').join(' ');
    grid.style.gridTemplateRows = item.rowHeights.map(h => h + 'px').join(' ');
    grid.style.pointerEvents = 'none';
    grid.style.opacity = pdfedGetOpacity(item);

    const cellEls = [];
    for (let r = 0; r < item.rows; r++) {
      const rowEls = [];
      for (let c = 0; c < item.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'pdfed-table-cell' + (item.headerRow && r === 0 ? ' pdfed-table-head' : '');
        cell.style.fontSize = item.fontSize + 'px';
        if (item.fontFamily) cell.style.fontFamily = pdfedFontCss(item.fontFamily);
        cell.style.pointerEvents = item.locked ? 'none' : 'auto';
        cell.contentEditable = !item.locked;
        cell.spellcheck = false;
        const cellText = (item.cells[r] && item.cells[r][c]) || '';
        const headerIconKey = (item.headerRow && r === 0 && item.headerIcons) ? item.headerIcons[c] : null;
        if (headerIconKey) {
          cell.classList.add('pdfed-th-has-icon');
          const iconWrap = document.createElement('span');
          iconWrap.className = 'pdfed-th-icon';
          iconWrap.contentEditable = 'false';
          iconWrap.innerHTML = pdfedIconToSVG(headerIconKey, 13);
          cell.appendChild(iconWrap);
          cell.appendChild(document.createTextNode(cellText));
        } else {
          cell.textContent = cellText;
        }
        // Auto Format: report-hierarchy styling computed from the data itself
        // (numeric columns right-align, total/subtotal rows bold + top rule).
        const fmtSt = item.cellStyles && item.cellStyles[r] && item.cellStyles[r][c];
        if (fmtSt) {
          cell.style.textAlign = fmtSt.align || 'left';
          if (headerIconKey) {
            cell.style.justifyContent = fmtSt.align === 'right' ? 'flex-end' : fmtSt.align === 'center' ? 'center' : 'flex-start';
          }
          if (fmtSt.bold) cell.style.fontWeight = '700';
          if (fmtSt.italic) cell.style.fontStyle = 'italic';
          if (fmtSt.color) cell.style.color = fmtSt.color;
          if (fmtSt.topBorder) cell.style.borderTop = '2px solid rgba(10,25,45,0.55)';
          if (fmtSt.fill) cell.style.background = fmtSt.fill;
        }
        // Shift+click on a cell moves the whole table instead of editing it —
        // a plain click still edits, so typing never gets accidentally hijacked.
        cell.addEventListener('mousedown', ev => {
          if (item.locked) return;
          if (ev.shiftKey) { ev.preventDefault(); pdfedStartTableDrag(el, item, idx, ev); return; }
          ev.stopPropagation();
        });
        cell.addEventListener('input', () => {
          if (!item.cells[r]) item.cells[r] = [];
          item.cells[r][c] = cell.textContent;
          pdfedMarkModified(idx);
        });
        // Right-click a cell for row/column insert-at-position and delete —
        // the "extend the table anywhere, not just at the end" control surface.
        cell.addEventListener('contextmenu', ev => {
          if (item.locked) return;
          ev.preventDefault();
          pdfedShowTableCellMenu(ev, idx, item, r, c);
        });
        grid.appendChild(cell);
        rowEls.push(cell);
      }
      cellEls.push(rowEls);
    }
    el.appendChild(grid);

    // Per-column resize dividers, dragging the right edge of a column
    // stretches just that column (table grows/shrinks accordingly), unlike
    // the corner handle which scales every column/row together.
    if (!item.locked) {
      let cumX = 0;
      item.colWidths.forEach((w, c) => {
        cumX += w;
        const div = document.createElement('div');
        div.className = 'pdfed-table-coldiv table-chrome';
        div.style.left = (cumX - 3) + 'px';
        div.title = 'Drag to stretch this column';
        el.appendChild(div);
        pdfedAttachColDividerHandler(div, el, item, idx, c, grid);
      });

      let cumY = 0;
      item.rowHeights.forEach((h, r) => {
        cumY += h;
        const div = document.createElement('div');
        div.className = 'pdfed-table-rowdiv table-chrome';
        div.style.top = (cumY - 3) + 'px';
        div.title = 'Drag to stretch this row';
        el.appendChild(div);
        pdfedAttachRowDividerHandler(div, el, item, idx, r, grid);
      });
    }

    // Always-visible drag handle bar, the one reliable, obvious place to grab
    // and move the table, since the cells themselves are busy being editable
    // text (a plain click there types, not drags). Sits just above the table.
    const dragBar = document.createElement('div');
    dragBar.className = 'pdfed-table-dragbar' + (item.locked ? ' locked' : '');
    dragBar.title = item.locked ? 'Locked' : 'Drag to move the table';
    dragBar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg><span>' + item.rows + ' x ' + item.cols + ' table</span>';
    if (!item.locked) {
      dragBar.addEventListener('mousedown', ev => { ev.preventDefault(); pdfedStartTableDrag(el, item, idx, ev); });
    }
    el.appendChild(dragBar);

    // Lock/unlock badge
    const lockBtn = document.createElement('button');
    lockBtn.title = item.locked ? 'Unlock to move/edit' : 'Lock in place';
    lockBtn.className = 'pdfed-badge-btn table-chrome' + (item.locked ? ' is-locked' : '');
    lockBtn.style.cssText = `position:absolute;top:-8px;right:16px;z-index:2;${item.locked ? 'pointer-events:auto;' : ''}`;
    lockBtn.innerHTML = item.locked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.45-2"/></svg>';
    lockBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTogglePlacedTableLock(idx, item.id); };
    el.appendChild(lockBtn);

    if (!item.locked) {
      // Opacity badge, opens the shared opacity popover for this table
      const opBtn = document.createElement('button');
      opBtn.title = 'Opacity';
      opBtn.className = 'pdfed-badge-btn table-chrome pdfed-opacity-btn';
      opBtn.style.cssText = `position:absolute;top:-8px;right:44px;z-index:2;`;
      opBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';
      opBtn.onclick = (ev) => pdfedOpenOpacityPopover(ev, 'table', idx, item.id);
      el.appendChild(opBtn);

      const fmtBtn = document.createElement('button');
      fmtBtn.title = 'Auto Format — right-align numbers, bold totals';
      fmtBtn.className = 'pdfed-badge-btn table-chrome';
      fmtBtn.style.cssText = `position:absolute;top:-8px;right:72px;z-index:2;`;
      fmtBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="2.5"/></svg>';
      fmtBtn.onclick = (ev) => { ev.stopPropagation(); pdfedAutoFormatTable(idx, item.id); };
      el.appendChild(fmtBtn);

      const delBtn = document.createElement('button');
      delBtn.title = 'Remove table';
      delBtn.className = 'pdfed-badge-btn is-danger table-chrome';
      delBtn.style.cssText = `position:absolute;top:-8px;right:-12px;z-index:2;`;
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePlacedTable(idx, item.id); };
      el.appendChild(delBtn);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'pdfed-table-resize table-chrome';
      resizeHandle.title = 'Drag to scale table';
      el.appendChild(resizeHandle);

      pdfedAttachPlacedTableResizeHandler(el, item, idx, resizeHandle, grid, cellEls);

      // Add-row / add-column shortcuts, the fast path for "the table needs
      // to keep growing"; right-click a cell for insert-at-position instead.
      const addRowBtn = document.createElement('button');
      addRowBtn.title = 'Add a row at the bottom';
      addRowBtn.className = 'pdfed-badge-btn table-chrome pdfed-table-addbtn-row';
      addRowBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      addRowBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTableAddRow(idx, item.id); };
      el.appendChild(addRowBtn);

      const addColBtn = document.createElement('button');
      addColBtn.title = 'Add a column on the right';
      addColBtn.className = 'pdfed-badge-btn table-chrome pdfed-table-addbtn-col';
      addColBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      addColBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTableAddCol(idx, item.id); };
      el.appendChild(addColBtn);
    }

    layer.appendChild(el);
  });
}

function pdfedTogglePlacedTableLock(idx, id) {
  const pg = pdfed.pages[idx];
  const item = (pg && pg.placedTables || []).find(i => i.id === id);
  if (!item) return;
  item.locked = !item.locked;
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  toast(item.locked ? 'Table locked' : 'Table unlocked', 'info');
}

function pdfedDeletePlacedTable(idx, id) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedTables) return;
  const i = pg.placedTables.findIndex(t => t.id === id);
  if (i === -1) return;
  const removedItem = pg.placedTables[i], removedIndex = i;
  pg.placedTables.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  toast('Table removed', 'info');
  pushAppHistory({
    label: 'Delete table',
    undo: () => {
      pg.placedTables.splice(Math.min(removedIndex, pg.placedTables.length), 0, removedItem);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
      toast('Table restored', 'info');
    },
    redo: () => {
      const at = pg.placedTables.indexOf(removedItem);
      if (at !== -1) pg.placedTables.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
      toast('Table removed', 'info');
    }
  });
}

// Starts a move drag from any trigger point (the drag bar, or shift+click on
// a cell) — pure position update, no DOM rebuild while dragging, so it tracks
// the cursor 1:1 with zero lag. Snaps to the page edges/center, other placed
// objects' edges/center (Canva-style smart guides), and the dot grid when
// grid-snap is on, same alignment system placed text/images already use, so
// tables line up perfectly with everything else on the page.
function pdfedStartTableDrag(el, item, idx, e) {
  if (item.locked) return;
  document.querySelectorAll('.pdfed-placed-table.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');
  // Keep the internal "selected tables" registry (what keyboard/menu Delete
  // actually reads, alongside the DOM highlight) in lockstep with this
  // click. Without this, an id left over from an earlier Select All / paste
  // stayed in the Set forever — invisible on screen, but still swept up the
  // next time anything got deleted, so an older table could get removed
  // instead of (or along with) the one you just clicked.
  if (typeof pdfedSelectedTables !== 'undefined') { pdfedSelectedTables.clear(); pdfedSelectedTables.add(item.id); }
  if (typeof pdfedSelected !== 'undefined') pdfedSelected.clear();
  if (typeof pdfedSelectedImgs !== 'undefined') pdfedSelectedImgs.clear();
  const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
  const sx = e.clientX, sy = e.clientY, ox = item.x, oy = item.y;
  const boxW = item.colWidths.reduce((a, b) => a + b, 0);
  const boxH = item.rowHeights.reduce((a, b) => a + b, 0);
  const SNAP = 10;
  const snapTargets = pdfedCollectSnapTargets(item.id);
  const guideV = document.getElementById('pdfedSmartGuideV');
  const guideH = document.getElementById('pdfedSmartGuideH');
  let moved = false;
  // A table pushed from Data Arrangement can bring its own heading text box
  // along for the ride (item.linkedTitleId points at it). Without this, the
  // heading stayed put on the page the moment the table underneath it was
  // dragged — it needs to translate by the exact same amount, snapping
  // included, so the two always move together.
  const pg = pdfed.pages[idx];
  const linkedText = item.linkedTitleId && pg && pg.placedTexts
    ? pg.placedTexts.find(t => t.id === item.linkedTitleId)
    : null;
  const linkedTextEl = linkedText ? document.querySelector(`.pdfed-placed-text[data-id="${linkedText.id}"]`) : null;
  const ltx = linkedText ? linkedText.x : 0, lty = linkedText ? linkedText.y : 0;
  const mm = (e2) => {
    let nx = ox + (e2.clientX - sx) / z;
    let ny = oy + (e2.clientY - sy) / z;
    const bestX = pdfedBestSnap([nx, nx + boxW / 2, nx + boxW], snapTargets.x, SNAP);
    const bestY = pdfedBestSnap([ny, ny + boxH / 2, ny + boxH], snapTargets.y, SNAP);
    if (bestX) nx += bestX.delta;
    if (bestY) ny += bestY.delta;
    // Grid-to-grid snapping only kicks in on an axis where no sharper object/
    // page-edge guide already fired, aligning to another element always wins.
    if (pdfed.snapGrid) {
      if (!bestX) nx = pdfedSnapToGrid(nx);
      if (!bestY) ny = pdfedSnapToGrid(ny);
    }
    if (guideV) {
      guideV.style.display = bestX ? 'block' : 'none';
      if (bestX) guideV.style.left = (bestX.at * z) + 'px';
    }
    if (guideH) {
      guideH.style.display = bestY ? 'block' : 'none';
      if (bestY) guideH.style.top = (bestY.at * z) + 'px';
    }
    item.x = Math.round(nx);
    item.y = Math.round(ny);
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    if (linkedText) {
      const dx = item.x - ox, dy = item.y - oy;
      linkedText.x = Math.round(ltx + dx);
      linkedText.y = Math.round(lty + dy);
      if (linkedTextEl) {
        linkedTextEl.style.left = linkedText.x + 'px';
        linkedTextEl.style.top = linkedText.y + 'px';
      }
    }
    moved = true;
  };
  const beforeSnap = { x: ox, y: oy, ltx, lty };
  const mu = () => {
    if (moved) pdfedMarkModified(idx);
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    if (moved && (item.x !== beforeSnap.x || item.y !== beforeSnap.y)) {
      const before = beforeSnap;
      const after = { x: item.x, y: item.y, ltx: linkedText ? linkedText.x : 0, lty: linkedText ? linkedText.y : 0 };
      const gIdx = idx, titleId = item.linkedTitleId;
      pushAppHistory({
        label: 'Move table',
        undo: () => {
          item.x = before.x; item.y = before.y;
          const pgN = pdfed.pages[gIdx];
          const lt = titleId && pgN && pgN.placedTexts ? pgN.placedTexts.find(t => t.id === titleId) : null;
          if (lt) { lt.x = before.ltx; lt.y = before.lty; }
          pdfedMarkModified(gIdx);
          pdfedRenderPlacedTables(gIdx);
          if (lt) pdfedRenderPlacedTexts(gIdx);
        },
        redo: () => {
          item.x = after.x; item.y = after.y;
          const pgN = pdfed.pages[gIdx];
          const lt = titleId && pgN && pgN.placedTexts ? pgN.placedTexts.find(t => t.id === titleId) : null;
          if (lt) { lt.x = after.ltx; lt.y = after.lty; }
          pdfedMarkModified(gIdx);
          pdfedRenderPlacedTables(gIdx);
          if (lt) pdfedRenderPlacedTexts(gIdx);
        }
      });
    }
  };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);
}

// SE-corner resize, scales column widths, row height and font size uniformly.
// Updates the existing grid/cell elements directly (no innerHTML rebuild) so
// dragging stays smooth and no cell ever loses focus mid-resize; the data
// model (item.colWidths/rowHeight/fontSize) is committed as it goes, and a
// single full re-render happens on mouseup to guarantee everything (handle
// positions, wrapper size) ends up pixel-exact.
function pdfedAttachPlacedTableResizeHandler(el, item, idx, resizeHandle, grid, cellEls) {
  resizeHandle.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.pdfed-placed-table.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    if (typeof pdfedSelectedTables !== 'undefined') { pdfedSelectedTables.clear(); pdfedSelectedTables.add(item.id); }

    const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
    const sx = e.clientX;
    const initialColWidths = item.colWidths.slice();
    const initialRowHeights = item.rowHeights.slice();
    const initialFontSize = item.fontSize;
    const totalInitialW = initialColWidths.reduce((a, b) => a + b, 0);

    const mm = (e2) => {
      const dx = (e2.clientX - sx) / z;
      const scale = Math.max(0.3, Math.min(4, (totalInitialW + dx) / totalInitialW));
      const newColWidths = initialColWidths.map(w => Math.max(30, Math.round(w * scale)));
      const newRowHeights = initialRowHeights.map(h => Math.max(14, Math.round(h * scale)));
      const newFontSize = Math.max(8, Math.round(initialFontSize * scale));

      item.colWidths = newColWidths;
      item.rowHeights = newRowHeights;
      item.fontSize = newFontSize;

      const newTotalW = newColWidths.reduce((a, b) => a + b, 0);
      const newTotalH = newRowHeights.reduce((a, b) => a + b, 0);
      el.style.width = newTotalW + 'px';
      el.style.height = newTotalH + 'px';
      grid.style.gridTemplateColumns = newColWidths.map(w => w + 'px').join(' ');
      grid.style.gridTemplateRows = newRowHeights.map(h => h + 'px').join(' ');
      cellEls.forEach(row => row.forEach(cell => { cell.style.fontSize = newFontSize + 'px'; }));
    };
    const mu = () => {
      if (pdfed.snapGrid) {
        // Snap the table's far (right/bottom) edge to the grid, then scale
        // every column/row proportionally so it lands exactly on the line —
        // same "snap the final size" approach used for placed text boxes.
        const totalW = item.colWidths.reduce((a, b) => a + b, 0);
        const totalH = item.rowHeights.reduce((a, b) => a + b, 0);
        const snappedW = Math.max(PDFED_GRID_SIZE, pdfedSnapToGrid(item.x + totalW) - item.x);
        const snappedH = Math.max(PDFED_GRID_SIZE, pdfedSnapToGrid(item.y + totalH) - item.y);
        const wScale = snappedW / totalW, hScale = snappedH / totalH;
        item.colWidths = item.colWidths.map(w => Math.max(24, Math.round(w * wScale)));
        item.rowHeights = item.rowHeights.map(h => Math.max(14, Math.round(h * hScale)));
      }
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx); // commit: rebuild once for pixel-exact handles/state
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
      const before = { colWidths: initialColWidths, rowHeights: initialRowHeights, fontSize: initialFontSize };
      const after = { colWidths: item.colWidths.slice(), rowHeights: item.rowHeights.slice(), fontSize: item.fontSize };
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const gIdx = idx;
        pushAppHistory({
          label: 'Resize table',
          undo: () => {
            item.colWidths = before.colWidths.slice(); item.rowHeights = before.rowHeights.slice(); item.fontSize = before.fontSize;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedTables(gIdx);
          },
          redo: () => {
            item.colWidths = after.colWidths.slice(); item.rowHeights = after.rowHeights.slice(); item.fontSize = after.fontSize;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedTables(gIdx);
          }
        });
      }
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

// Drag a single column's right-edge divider, stretches only that column
// (neighbors keep their own width, table's total width follows along), as
// opposed to the corner handle which scales every column/row together.
function pdfedAttachColDividerHandler(div, el, item, idx, c, grid) {
  div.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.pdfed-placed-table.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    if (typeof pdfedSelectedTables !== 'undefined') { pdfedSelectedTables.clear(); pdfedSelectedTables.add(item.id); }
    const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
    const sx = e.clientX;
    const startW = item.colWidths[c];
    const mm = (e2) => {
      const dx = (e2.clientX - sx) / z;
      item.colWidths[c] = Math.max(24, Math.round(startW + dx));
      const totalW = item.colWidths.reduce((a, b) => a + b, 0);
      el.style.width = totalW + 'px';
      grid.style.gridTemplateColumns = item.colWidths.map(w => w + 'px').join(' ');
      let cum = 0;
      const colDivs = el.querySelectorAll('.pdfed-table-coldiv');
      item.colWidths.forEach((w, i) => { cum += w; if (colDivs[i]) colDivs[i].style.left = (cum - 3) + 'px'; });
    };
    const mu = () => {
      if (pdfed.snapGrid) {
        // Snap this column's right edge (absolute canvas-px position) to the
        // grid, keeping every other column exactly as-is.
        const before = item.colWidths.slice(0, c).reduce((a, b) => a + b, 0);
        const edge = item.x + before + item.colWidths[c];
        const snappedEdge = pdfedSnapToGrid(edge);
        item.colWidths[c] = Math.max(24, snappedEdge - item.x - before);
      }
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

// Drag a single row's bottom-edge divider, stretches only that row, same
// idea as the column divider above.
function pdfedAttachRowDividerHandler(div, el, item, idx, r, grid) {
  div.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.pdfed-placed-table.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    if (typeof pdfedSelectedTables !== 'undefined') { pdfedSelectedTables.clear(); pdfedSelectedTables.add(item.id); }
    const z = (typeof pdfed !== 'undefined' && pdfed.zoom) ? pdfed.zoom : 1;
    const sy = e.clientY;
    const startH = item.rowHeights[r];
    const mm = (e2) => {
      const dy = (e2.clientY - sy) / z;
      item.rowHeights[r] = Math.max(14, Math.round(startH + dy));
      const totalH = item.rowHeights.reduce((a, b) => a + b, 0);
      el.style.height = totalH + 'px';
      grid.style.gridTemplateRows = item.rowHeights.map(h => h + 'px').join(' ');
      let cum = 0;
      const rowDivs = el.querySelectorAll('.pdfed-table-rowdiv');
      item.rowHeights.forEach((h, i) => { cum += h; if (rowDivs[i]) rowDivs[i].style.top = (cum - 3) + 'px'; });
    };
    const mu = () => {
      if (pdfed.snapGrid) {
        // Snap this row's bottom edge to the grid, keeping every other row as-is.
        const before = item.rowHeights.slice(0, r).reduce((a, b) => a + b, 0);
        const edge = item.y + before + item.rowHeights[r];
        const snappedEdge = pdfedSnapToGrid(edge);
        item.rowHeights[r] = Math.max(14, snappedEdge - item.y - before);
      }
      pdfedMarkModified(idx);
      pdfedRenderPlacedTables(idx);
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

// ── Row/column growth, append at the end (toolbar buttons) or insert/delete
// at an exact position (right-click cell menu). Every mutator keeps
// cells/colWidths/rowHeights in lockstep so the table never gets ragged. ──
function pdfedFindPlacedTable(idx, id) {
  const pg = pdfed.pages[idx];
  return (pg && pg.placedTables || []).find(i => i.id === id);
}

function pdfedTableAddRow(idx, id) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  item.cells.push(new Array(item.cols).fill(''));
  item.rowHeights.push(item.rowHeights[item.rowHeights.length - 1] || 30);
  item.rows++;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

function pdfedTableAddCol(idx, id) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  const w = item.colWidths[item.colWidths.length - 1] || 90;
  item.colWidths.push(w);
  item.cells.forEach(row => row.push(''));
  item.cols++;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

function pdfedTableInsertRowAt(idx, id, ri, before) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  const at = before ? ri : ri + 1;
  item.cells.splice(at, 0, new Array(item.cols).fill(''));
  item.rowHeights.splice(at, 0, item.rowHeights[ri] || 30);
  item.rows++;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

function pdfedTableInsertColAt(idx, id, ci, before) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  const at = before ? ci : ci + 1;
  item.colWidths.splice(at, 0, item.colWidths[ci] || 90);
  item.cells.forEach(row => row.splice(at, 0, ''));
  item.cols++;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

function pdfedTableDeleteRowAt(idx, id, ri) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  if (item.rows <= 1) { toast("Table needs at least 1 row, delete the table instead", 'error'); return; }
  item.cells.splice(ri, 1);
  item.rowHeights.splice(ri, 1);
  item.rows--;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

function pdfedTableDeleteColAt(idx, id, ci) {
  const item = pdfedFindPlacedTable(idx, id);
  if (!item || item.locked) return;
  if (item.cols <= 1) { toast("Table needs at least 1 column, delete the table instead", 'error'); return; }
  item.colWidths.splice(ci, 1);
  item.cells.forEach(row => row.splice(ci, 1));
  item.cols--;
  item._refineBaseline = null; // structure changed — a stale baseline from before this edit would mismatch the new row/col count on the next Refine Report
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
}

// Small floating context menu for the right-click cell handler above —
// lets a person insert/delete a row or column at the exact cell they're on,
// rather than only being able to grow the table from its end.
let pdfedTableCellMenuEl = null;
function pdfedCloseTableCellMenu() {
  if (pdfedTableCellMenuEl) { pdfedTableCellMenuEl.remove(); pdfedTableCellMenuEl = null; }
  document.removeEventListener('mousedown', pdfedTableCellMenuOutsideHandler, true);
}
function pdfedTableCellMenuOutsideHandler(e) {
  if (pdfedTableCellMenuEl && !pdfedTableCellMenuEl.contains(e.target)) pdfedCloseTableCellMenu();
}
function pdfedShowTableCellMenu(ev, idx, item, r, c) {
  pdfedCloseTableCellMenu();
  const menu = document.createElement('div');
  menu.className = 'pdfed-table-ctxmenu';
  const actions = [
    { label: 'Insert row above', fn: () => pdfedTableInsertRowAt(idx, item.id, r, true) },
    { label: 'Insert row below', fn: () => pdfedTableInsertRowAt(idx, item.id, r, false) },
    { label: 'Insert column left', fn: () => pdfedTableInsertColAt(idx, item.id, c, true) },
    { label: 'Insert column right', fn: () => pdfedTableInsertColAt(idx, item.id, c, false) },
    { sep: true },
    { label: 'Delete this row', fn: () => pdfedTableDeleteRowAt(idx, item.id, r), danger: true },
    { label: 'Delete this column', fn: () => pdfedTableDeleteColAt(idx, item.id, c), danger: true },
  ];
  actions.forEach(a => {
    if (a.sep) { const s = document.createElement('div'); s.className = 'pdfed-table-ctxmenu-sep'; menu.appendChild(s); return; }
    const row = document.createElement('div');
    row.className = 'pdfed-table-ctxmenu-item' + (a.danger ? ' is-danger' : '');
    row.textContent = a.label;
    row.onclick = (e2) => { e2.stopPropagation(); a.fn(); pdfedCloseTableCellMenu(); };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  // Position after mounting so we can clamp to viewport width/height.
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = Math.min(ev.clientX, window.innerWidth - mw - 8);
  const top = Math.min(ev.clientY, window.innerHeight - mh - 8);
  menu.style.left = Math.max(4, left) + 'px';
  menu.style.top = Math.max(4, top) + 'px';
  pdfedTableCellMenuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', pdfedTableCellMenuOutsideHandler, true), 0);
}

// Bakes every placed table for a page onto a real canvas context, used at
// export time (and whenever a page's pixels must be permanently flattened,
// e.g. before a rotate) so the downloaded PDF matches exactly what was shown
// on screen, grid lines and all.
function pdfedDrawPlacedTablesOnCtx(ctx, list) {
  if (!list || !list.length) return;
  list.forEach(item => {
    const rowHeights = (item.rowHeights && item.rowHeights.length === item.rows)
      ? item.rowHeights
      : new Array(item.rows).fill(item.rowHeight || 30);
    let y = item.y;
    for (let r = 0; r < item.rows; r++) {
      let x = item.x;
      const h = rowHeights[r] || 30;
      for (let c = 0; c < item.cols; c++) {
        const w = item.colWidths[c];
        const isHead = item.headerRow && r === 0;
        // Same per-cell "Auto Format" styles the live DOM editor applies
        // (pdfedRenderPlacedTables): totals/subtotal bold+fill, custom
        // color, italics, alignment, top rule. Previously this raster path
        // only knew about the header row, so anything styled after that —
        // bold Total rows, blue-tinted subtotal bands, etc. — silently
        // vanished from the exported PDF/PNG even though it was visible
        // on screen. Reading item.cellStyles here keeps the two in sync.
        const fmtSt = item.cellStyles && item.cellStyles[r] && item.cellStyles[r][c];

        ctx.fillStyle = fmtSt && fmtSt.fill ? fmtSt.fill : (isHead ? 'rgba(0,194,255,0.16)' : 'rgba(255,255,255,0.94)');
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        if (fmtSt && fmtSt.topBorder) {
          ctx.strokeStyle = 'rgba(10,25,45,0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y + 1);
          ctx.lineTo(x + w, y + 1);
          ctx.stroke();
        }
        const text = (item.cells[r] && item.cells[r][c]) || '';
        const iconKey = (isHead && item.headerIcons) ? item.headerIcons[c] : null;
        if (text || iconKey) {
          const bold = isHead || (fmtSt && fmtSt.bold);
          const italic = fmtSt && fmtSt.italic;
          const textColor = (fmtSt && fmtSt.color) ? fmtSt.color : '#101820';
          ctx.fillStyle = textColor;
          ctx.font = `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${item.fontSize}px Inter, Arial, sans-serif`;
          ctx.textBaseline = 'middle';
          const align = (fmtSt && fmtSt.align) || 'left';
          ctx.textAlign = align;
          let tx = align === 'right' ? (x + w - 6) : align === 'center' ? (x + w / 2) : (x + 6);
          // Simple clip so overflowing text/icon doesn't spill into neighboring cells
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          let maxTextW = w - 12;
          if (iconKey) {
            // Same icon glyph the live DOM header cell shows, stroked straight
            // onto the raster — this is what makes it survive export, not
            // just look right on screen.
            const iconSize = Math.max(9, Math.min(item.fontSize, 14));
            const gap = 4;
            const textW = text ? ctx.measureText(text).width : 0;
            if (align === 'right') {
              const iconX = x + w - 6 - textW - gap - iconSize;
              pdfedDrawIconOnCtx(ctx, iconKey, iconX, y + h / 2 - iconSize / 2, iconSize, textColor);
            } else if (align === 'center') {
              const startX = x + w / 2 - (iconSize + gap + textW) / 2;
              pdfedDrawIconOnCtx(ctx, iconKey, startX, y + h / 2 - iconSize / 2, iconSize, textColor);
              ctx.textAlign = 'left';
              tx = startX + iconSize + gap;
            } else {
              pdfedDrawIconOnCtx(ctx, iconKey, x + 6, y + h / 2 - iconSize / 2, iconSize, textColor);
              tx = x + 6 + iconSize + gap;
            }
            maxTextW = Math.max(10, w - 12 - iconSize - gap);
          }
          if (text) ctx.fillText(text, tx, y + h / 2, maxTextW);
          ctx.restore();
        }
        x += w;
      }
      y += h;
    }
  });
}
