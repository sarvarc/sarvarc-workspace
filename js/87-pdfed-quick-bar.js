// ─── PDF EDITOR QUICK TOOLS BAR (floating left bar, Canva style) ───
// A slim icon bar over the left of the page area. Each icon opens a small panel
// with that tool's options. Every button calls the SAME function the ribbon button
// calls, and the ribbon panels (Colour, Graphics, Border, Table) are borrowed into
// the panel while it is open and moved back when it closes. The ribbon is untouched.
// Styles: css/52-pdfed-quick-bar.css. Notes: CHANGES-pdfed-quick-bar.md
(function () {
  'use strict';
  const area = document.querySelector('#sec-pdfeditor .pdfed-canvas-area');
  if (!area || document.getElementById('pdqbBar')) return;

  const KEY = 'sarvarcPdfQuickBarHidden';
  let hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch (e) {}

  const $ = (id) => document.getElementById(id);
  const run = (name, ...args) => {
    try { if (typeof window[name] === 'function') return window[name](...args); } catch (e) { console.warn('[quick bar]', name, e); }
  };

  const P = {
    select: '<path d="M5 3l14 7-6 2-2 6z"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    photos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
    shapes: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M12 21l5-9 5 9z"/>',
    draw: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    graphics: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    sign: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    page: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    ocr: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8"/>',
    al: '<path d="M4 6h16M4 12h10M4 18h13"/>', ac: '<path d="M4 6h16M7 12h10M5.5 18h13"/>', ar: '<path d="M4 6h16M10 12h10M7 18h13"/>',
    sel: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', grid: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    eraser: '<path d="M7 20h12M5 15l9-9 5 5-6 6H8z"/>', hl: '<path d="M9 11l4 4M4 20l4-1 9-9-3-3-9 9zM14 6l3-3 4 4-3 3"/>',
    redact: '<rect x="3" y="9" width="18" height="6" rx="1" fill="currentColor"/>', border: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>', adjust: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    rl: '<path d="M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7"/>', check: '<path d="M5 12l5 5 9-10"/>'
  };
  const svg = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (P[k] || '') + '</svg>';

  // ── Build the bar, the hide tab and the panel ──
  const bar = document.createElement('div');
  bar.className = 'pdqb-bar'; bar.id = 'pdqbBar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Quick tools');
  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'pdqb-tab'; tab.id = 'pdqbTab'; tab.title = 'Show quick tools'; tab.setAttribute('aria-label', 'Show quick tools');
  tab.innerHTML = svg('right');
  const fly = document.createElement('div');
  fly.className = 'pdqb-fly'; fly.id = 'pdqbFly';
  fly.innerHTML = '<div class="pdqb-fly-head"><button type="button" class="pdqb-ic" id="pdqbBack" aria-label="Back" style="display:none">' + svg('left') + '</button><div class="pdqb-fly-title" id="pdqbTitle"></div><button type="button" class="pdqb-ic" id="pdqbClose" aria-label="Close panel">' + svg('close') + '</button></div><div class="pdqb-fly-body" id="pdqbBody"></div>';
  area.appendChild(bar); area.appendChild(tab); area.appendChild(fly);
  const body = $('pdqbBody'), title = $('pdqbTitle'), back = $('pdqbBack');

  // ── Borrowed ribbon panels ──
  const homes = {};
  function host(id, openFn) {
    const p = $(id); if (!p) return null;
    if (!homes[id]) homes[id] = p.parentNode;
    p.classList.remove('open');
    try { openFn(); } catch (e) { console.warn('[quick bar] open', id, e); }
    p.classList.add('open', 'pdqb-hosted');
    body.appendChild(p);
    return p;
  }
  function releaseAll() {
    Object.keys(homes).forEach(function (id) {
      const p = $(id); if (!p) return;
      p.classList.remove('open', 'pdqb-hosted');
      p.style.top = ''; p.style.left = ''; p.style.maxHeight = '';
      if (homes[id] && p.parentNode !== homes[id]) homes[id].appendChild(p);
    });
  }

  // ── Row helpers ──
  const mirrors = [];
  function row(label, icon, fn, opt) {
    opt = opt || {};
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pdqb-row' + (opt.pri ? ' pri' : '') + (opt.cls ? ' ' + opt.cls : '');
    b.innerHTML = (icon ? svg(icon) : '') + '<span>' + label + '</span>';
    b.addEventListener('click', function () { fn(b); if (!opt.keep) closeFly(); setTimeout(sync, 60); });
    if (opt.drag) { b.draggable = true; b.dataset.pdqb = JSON.stringify(opt.drag); }
    return b;
  }
  function hint(t) { const d = document.createElement('div'); d.className = 'pdqb-hint'; d.textContent = t; return d; }
  function label(t) { const d = document.createElement('div'); d.className = 'pdqb-label'; d.textContent = t; return d; }
  function split(list) { const d = document.createElement('div'); d.className = 'pdqb-split'; list.forEach(function (x) { d.appendChild(x); }); return d; }
  // Mirrors a ribbon button that only appears in some modes (Save text, Apply crop...). Shown while the ribbon one is visible.
  function mirror(text, icon, srcId, fn, cls) {
    const b = row(text, icon, fn, { cls: cls || '' });
    b.style.display = 'none'; b.dataset.src = srcId; mirrors.push(b); return b;
  }
  function flag(text, icon, srcId, fn) {
    const b = row(text, icon, fn, { keep: true, cls: 'pdqb-flag' }); b.dataset.flag = srcId; return b;
  }
  const tool = (t) => function () { run('pdfedSetAnnotTool', t); };

  // ── Tools ──
  const TOOLS = [
    { id: 'select', name: 'Select', icon: 'select', tip: 'Select and move (hand tool)', direct: function () { run('pdfedActivateHand'); } },
    { id: 'text', name: 'Text', icon: 'text', tip: 'Text tools', build: function (b) {
      b.appendChild(hint('Click to add, or drag this onto the page.'));
      b.appendChild(row('Add text', 'plus', tool('addtext'), { pri: true, drag: { k: 'text' } }));
      b.appendChild(row('Edit page text (OCR)', 'ocr', function () { run('pdfedToggleTextEdit'); }, { keep: true }));
      b.appendChild(mirror('Save text', 'check', 'pdfedApplyTextBtn', function () { run('pdfedApplyTextEdits'); }, 'pdqb-good'));
      b.appendChild(mirror('Cancel text edit', 'close', 'pdfedCancelTextBtn', function () { run('pdfedCancelTextEdit'); }));
      b.appendChild(label('Align'));
      b.appendChild(split([
        row('', 'al', function () { run('pdfedPtxtSetAlign', 'left'); }, { keep: true }),
        row('', 'ac', function () { run('pdfedPtxtSetAlign', 'center'); }, { keep: true }),
        row('', 'ar', function () { run('pdfedPtxtSetAlign', 'right'); }, { keep: true })
      ]));
      b.appendChild(row('Select all on page', 'sel', function () { run('pdfedSelectAllPlacedTexts'); }));
    } },
    { id: 'photos', name: 'Photos', icon: 'photos', tip: 'Images, stock photos and clips', build: function (b) {
      b.appendChild(hint('You can also drag a photo from your computer straight onto the page.'));
      b.appendChild(row('Upload image', 'upload', function () { run('pdfedTriggerImgInsert'); }, { pri: true }));
      b.appendChild(row('From extracted gallery', 'photos', function () { run('pdfedInsertFromExtracted'); }));
      b.appendChild(row('Stock photos', 'photos', function () { run('pdfedOpenStockPhotoSearch'); }));
      b.appendChild(row('Video clip', 'video', function () { run('pdfedTriggerClipInsert'); }));
    } },
    { id: 'shapes', name: 'Shapes', icon: 'shapes', tip: 'Shapes and page border', build: function (b, go) {
      b.appendChild(hint('Drag a shape onto the page, or click one and draw it.'));
      const g = document.createElement('div'); g.className = 'pdqb-shapes';
      const list = (typeof pdfedShapeTools !== 'undefined' && pdfedShapeTools) || ['arrow', 'rect', 'circle', 'line', 'dblarrow', 'roundrect', 'triangle', 'diamond', 'pentagon', 'star', 'hexagon'];
      list.forEach(function (t) {
        const s = document.createElement('button'); s.type = 'button'; s.className = 'pdqb-shape'; s.title = t; s.setAttribute('aria-label', t + ' shape');
        s.innerHTML = (typeof pdfedShapeSVGs !== 'undefined' && pdfedShapeSVGs[t]) || t;
        s.addEventListener('click', function () { run('pdfedShapesSelect', t); });
        s.draggable = true; s.dataset.pdqb = JSON.stringify({ k: 'shape', t: t });
        g.appendChild(s);
      });
      b.appendChild(g);
      b.appendChild(row('Page border', 'border', function () { go('border'); }, { keep: true }));
    }, subs: { border: { title: 'Page border', build: function (b) { host('pdfedBorderPanel', function () { run('pdfedToggleBorderPanel'); }); } } } },
    { id: 'draw', name: 'Draw', icon: 'draw', tip: 'Pen, eraser, highlight, colour', build: function (b) {
      b.appendChild(split([row('Pen', 'draw', tool('draw'), { keep: true }), row('Eraser', 'eraser', tool('eraser'), { keep: true })]));
      b.appendChild(row('Highlight text', 'hl', function () { run('pdfedToggleTextHighlight'); }, { keep: true }));
      b.appendChild(row('Redact (black out)', 'redact', tool('redact'), { keep: true }));
      b.appendChild(label('Colour and size'));
      host('pdfedColorPanel', function () { run('pdfedToggleColorPanel'); });
    } },
    { id: 'graphics', name: 'Graphics', icon: 'graphics', tip: 'Fill, gradient and ready-made graphics', build: function (b) {
      b.appendChild(hint('Drag any graphic onto the page, or click it.'));
      host('pdfedGfxPanel', function () { run('pdfedToggleGfxPanel'); });
    } },
    { id: 'table', name: 'Table', icon: 'table', tip: 'Insert a table', build: function (b) {
      b.appendChild(hint('Click to add, or drag this onto the page.'));
      b.appendChild(row('Insert 3 x 3 table', 'table', function () { run('pdfedInsertTable', 3, 3); }, { pri: true, drag: { k: 'table' } }));
      b.appendChild(label('Or pick a size'));
      host('pdfedTableDropdown', function () { run('pdfedTableToggleDropdown', { stopPropagation: function () {} }); });
    } },
    { id: 'sign', name: 'Sign', icon: 'sign', tip: 'Signature and links', build: function (b) {
      b.appendChild(row('Signature or initials', 'draw', function () { run('pdfedOpenSignatureModal'); }, { pri: true }));
      b.appendChild(row('Add clickable link', 'sign', tool('link')));
    } },
    { id: 'page', name: 'Page', icon: 'page', tip: 'Crop, adjust, grid snap', build: function (b) {
      b.appendChild(row('Crop', 'crop', function () { run('pdfedToggleCrop'); }));
      b.appendChild(mirror('Apply crop', 'check', 'pdfedApplyCropBtn', function () { run('pdfedApplyCrop'); }, 'pdqb-good'));
      b.appendChild(mirror('Cancel crop', 'close', 'pdfedCancelCropBtn', function () { run('pdfedCropOff'); }));
      b.appendChild(row('Adjust (light, colour)', 'adjust', function () { run('pdfedOpenAdjust'); }));
      b.appendChild(flag('Grid snap', 'grid', 'pdfedGridBtn', function () { run('pdfedToggleGrid'); }));
    } }
  ];

  const buttons = {};
  TOOLS.forEach(function (t) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pdqb-btn'; b.title = t.tip; b.setAttribute('aria-label', t.tip);
    b.innerHTML = svg(t.icon) + '<span>' + t.name + '</span>';
    b.addEventListener('click', function () {
      if (t.direct) { closeFly(); t.direct(); sync(); return; }
      if (current === t.id) { closeFly(); return; }
      openTool(t.id);
    });
    bar.appendChild(b); buttons[t.id] = b;
  });
  // Rotate: two direct buttons, no panel. One click turns the page 90 degrees, like the Select tool just works.
  let rotBusy = false;
  function rotate(deg) {
    if (rotBusy) return; rotBusy = true;
    Promise.resolve().then(function () { return run('pdfedRotatePage', deg); }).catch(function (e) { console.warn('[quick bar] rotate', e); }).then(function () { rotBusy = false; });
  }
  const rot = document.createElement('div'); rot.className = 'pdqb-rot';
  rot.innerHTML = '<div class="pdqb-rot-row"><button type="button" class="pdqb-rbtn" id="pdqbRotL" title="Rotate page left" aria-label="Rotate page left">' + svg('rl') + '</button><button type="button" class="pdqb-rbtn" id="pdqbRotR" title="Rotate page right" aria-label="Rotate page right">' + svg('page') + '</button></div><span>Rotate</span>';
  bar.appendChild(rot);
  rot.querySelector('#pdqbRotL').addEventListener('click', function () { rotate(-90); });
  rot.querySelector('#pdqbRotR').addEventListener('click', function () { rotate(90); });
  const sep = document.createElement('div'); sep.className = 'pdqb-sep'; bar.appendChild(sep);
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button'; hideBtn.className = 'pdqb-btn pdqb-hide'; hideBtn.title = 'Hide quick tools'; hideBtn.setAttribute('aria-label', 'Hide quick tools');
  hideBtn.innerHTML = svg('left'); bar.appendChild(hideBtn);

  // ── Open / close ──
  let current = null;
  function render(t, sub) {
    releaseAll(); mirrors.length = 0; body.innerHTML = '';
    const def = sub ? t.subs[sub] : t;
    title.textContent = sub ? def.title : t.name;
    back.style.display = sub ? 'flex' : 'none';
    def.build(body, function (s) { render(t, s); });
    sync();
    body.scrollTop = 0;
  }
  function openTool(id) {
    const t = TOOLS.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    current = id; fly.classList.add('open'); render(t);
    Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle('on', k === id); });
  }
  function closeFly() {
    current = null; fly.classList.remove('open'); releaseAll(); mirrors.length = 0; body.innerHTML = '';
    Object.keys(buttons).forEach(function (k) { buttons[k].classList.remove('on'); });
    sync();
  }
  back.addEventListener('click', function () { const t = TOOLS.filter(function (x) { return x.id === current; })[0]; if (t) render(t); });
  $('pdqbClose').addEventListener('click', closeFly);

  function setHidden(v) {
    hidden = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
    if (v) closeFly();
    sync();
  }
  hideBtn.addEventListener('click', function () { setHidden(true); });
  tab.addEventListener('click', function () { setHidden(false); });

  // Clicks inside the bar or the panel must not reach the ribbon's "click outside closes" handlers.
  [bar, fly].forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });
  // Those handlers (registered earlier) close the borrowed panel when the person clicks the page; put it back.
  document.addEventListener('click', function () {
    if (!current) return;
    Object.keys(homes).forEach(function (id) { const p = $(id); if (p && p.classList.contains('pdqb-hosted')) p.classList.add('open'); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current) closeFly(); });


  // ── DRAG AND DROP: drag a tool from the panel onto the page, or a photo file from the computer ──
  const MIME = 'application/x-pdqb';
  function pagePos(e) {
    const ac = $('pdfedAnnotCanvas');
    if (!ac || !ac.width) return null;
    const r = ac.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    return { x: (e.clientX - r.left) * (ac.width / r.width), y: (e.clientY - r.top) * (ac.height / r.height), ac: ac, rect: r };
  }
  function pageNow() { try { return typeof pdfed !== 'undefined' && pdfed.pages ? { idx: pdfed.active, pg: pdfed.pages[pdfed.active] } : null; } catch (e) { return null; } }
  function say(m, kind) { try { if (typeof toast === 'function') toast(m, kind || 'info'); } catch (e) {} }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // Same kind only: two text boxes or two tables dropped almost on top of each other hide one another, so slide the new one clear.
  // Text on a photo, or a graphic on a photo, is normal design and is left exactly where it was dropped.
  function boxOf(el, it) { return { x: it.x, y: it.y, w: it.w || (el ? el.offsetWidth : 0) || 0, h: it.h || (el ? el.offsetHeight : 0) || 0 }; }
  function overlapFrac(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return a.w * a.h ? (ix * iy) / (a.w * a.h) : 0;
  }
  function clearOf(box, others, pageW, pageH) {
    const step = 28; let tries = 0;
    function hit() { return others.some(function (o) { return o.w && o.h && overlapFrac(box, o) > 0.5; }); }
    while (hit() && tries < 10) {
      box.x = clamp(box.x + step, 8, Math.max(8, pageW - box.w - 8));
      box.y = clamp(box.y + step, 8, Math.max(8, pageH - box.h - 8));
      tries++;
    }
    return box;
  }
  function others(layerId, list) {
    const layer = $(layerId);
    return (list || []).map(function (it) { return boxOf(layer && layer.querySelector('[data-id="' + it.id + '"]'), it); });
  }

  function dropText(pos) {
    const c = pageNow(); if (!c || !c.pg) return;
    const ac = pos.ac;
    const box = clearOf({ x: pos.x, y: pos.y, w: 190, h: 40 }, others('pdfedPlacedTextsLayer', c.pg.placedTexts), ac.width, ac.height);
    run('pdfedPlaceTextLabel', Math.round(box.x), Math.round(box.y));
  }
  function dropTable(pos) {
    const c = pageNow(); if (!c || !c.pg) return;
    const before = (c.pg.placedTables || []).length;
    run('pdfedInsertTable', 3, 3);
    const list = c.pg.placedTables || [];
    if (list.length <= before) return;
    const it = list[list.length - 1];
    const w = (it.colWidths || []).reduce(function (a, b) { return a + b; }, 0), h = (it.rowHeights || []).reduce(function (a, b) { return a + b; }, 0);
    const box = clearOf({ x: clamp(pos.x - w / 2, 8, Math.max(8, pos.ac.width - w - 8)), y: clamp(pos.y - h / 2, 8, Math.max(8, pos.ac.height - h - 8)), w: w, h: h },
      list.slice(0, -1).map(function (o) { return { x: o.x, y: o.y, w: (o.colWidths || []).reduce(function (a, b) { return a + b; }, 0), h: (o.rowHeights || []).reduce(function (a, b) { return a + b; }, 0) }; }), pos.ac.width, pos.ac.height);
    it.x = Math.round(box.x); it.y = Math.round(box.y);
    run('pdfedRenderPlacedTables', c.idx);
  }
  function dropShape(pos, tl) {
    // Draws the shape the same way a person would: press, drag a default size, release.
    run('pdfedShapesSelect', tl);
    const w = 150, h = 100, r = pos.rect, k = r.width / pos.ac.width;
    const fire = function (type, x, y) { pos.ac.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); };
    const x0 = clamp(pos.x - w / 2, 0, pos.ac.width - w) * k + r.left, y0 = clamp(pos.y - h / 2, 0, pos.ac.height - h) * k + r.top;
    fire('mousedown', x0, y0); fire('mousemove', x0 + (w * k) / 2, y0 + (h * k) / 2); fire('mousemove', x0 + w * k, y0 + h * k); fire('mouseup', x0 + w * k, y0 + h * k);
    run('pdfedActivateHand');
  }
  function centerLast(idx, pg, before, pos) {
    let tries = 0;
    (function wait() {
      const list = pg.placedImages || [];
      if (list.length > before) {
        const it = list[list.length - 1];
        it.x = Math.round(clamp(pos.x - it.w / 2, 0, Math.max(0, pos.ac.width - it.w)));
        it.y = Math.round(clamp(pos.y - it.h / 2, 0, Math.max(0, pos.ac.height - it.h)));
        run('pdfedRenderPlacedImages', idx); run('pdfedRenderPlacedTexts', idx);
      } else if (tries++ < 40) setTimeout(wait, 50);
    })();
  }
  function dropArt(pos, i) {
    const c = pageNow(); if (!c || !c.pg) return;
    const before = (c.pg.placedImages || []).length;
    run('pdfedGfxAddArt', i);
    centerLast(c.idx, c.pg, before, pos);
  }
  function dropImageFiles(files, pos) {
    const c = pageNow(); if (!c || !c.pg) return;
    files.forEach(function (f, n) {
      const rd = new FileReader();
      rd.onload = function () {
        const url = rd.result, im = new Image();
        im.onload = function () {
          const ar = (im.naturalWidth || 1) / (im.naturalHeight || 1);
          let w = Math.round(pos.ac.width * 0.35), h = Math.round(w / ar);
          if (h > pos.ac.height * 0.5) { h = Math.round(pos.ac.height * 0.5); w = Math.round(h * ar); }
          w = Math.max(w, 60); h = Math.max(h, 60);
          if (!c.pg.placedImages) c.pg.placedImages = [];
          try { if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('image', url, f.name); } catch (e) {}
          c.pg.placedImages.push({
            id: 'pimg_' + (++pdfedAnnotState.placedImgSeq), dataUrl: url,
            x: Math.round(clamp(pos.x - w / 2 + n * 26, 0, Math.max(0, pos.ac.width - w))), y: Math.round(clamp(pos.y - h / 2 + n * 26, 0, Math.max(0, pos.ac.height - h))),
            w: w, h: h, locked: false, zIndex: typeof pdfedNextZ === 'function' ? pdfedNextZ(c.pg) : 1, kind: 'image'
          });
          run('pdfedMarkModified', c.idx); run('pdfedRenderPlacedImages', c.idx); run('pdfedRenderPlacedTexts', c.idx);
          say('Photo added. Drag to move, resize from the corners.', 'success');
        };
        im.src = url;
      };
      rd.readAsDataURL(f);
    });
  }

  fly.addEventListener('dragstart', function (e) {
    const el = e.target.closest ? e.target.closest('[data-pdqb]') : null;
    if (!el) { e.preventDefault(); return; }
    e.dataTransfer.setData(MIME, el.dataset.pdqb); e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.effectAllowed = 'copy';
    area.classList.add('pdqb-dragging');
    setTimeout(function () { fly.classList.add('pdqb-ghost'); }, 0);   // let the page behind the panel receive the drop
  });
  fly.addEventListener('dragend', function () { area.classList.remove('pdqb-dragging'); fly.classList.remove('pdqb-ghost'); });
  // Graphic tiles live in the borrowed ribbon panel and are redrawn often: mark whatever is there as draggable.
  new MutationObserver(function () {
    body.querySelectorAll('#pdfedGfxGrid button[onclick*="pdfedGfxAddArt"]:not([data-pdqb])').forEach(function (g) {
      const m = /pdfedGfxAddArt\((\d+)\)/.exec(g.getAttribute('onclick') || ''); if (!m) return;
      g.draggable = true; g.dataset.pdqb = JSON.stringify({ k: 'art', i: +m[1] });
    });
  }).observe(body, { childList: true, subtree: true });

  function isImageFiles(dt) {
    const fl = dt && dt.files ? Array.from(dt.files) : [];
    return fl.length > 0 && fl.every(function (f) { return /^image\//.test(f.type); }) ? fl : null;
  }
  area.addEventListener('dragover', function (e) {
    const dt = e.dataTransfer; if (!dt) return;
    if (Array.prototype.indexOf.call(dt.types || [], MIME) > -1) { e.preventDefault(); e.stopPropagation(); dt.dropEffect = 'copy'; }
  }, true);
  area.addEventListener('drop', function (e) {
    const dt = e.dataTransfer; if (!dt) return;
    const raw = dt.getData ? dt.getData(MIME) : '';
    const imgs = !raw && docOpen() ? isImageFiles(dt) : null;
    if (!raw && !imgs) return;                       // anything else keeps the editor's own drop behaviour
    e.preventDefault(); e.stopPropagation();
    area.classList.remove('pdqb-dragging'); fly.classList.remove('pdqb-ghost'); area.classList.remove('pdfed-drag-over', 'pdfed-drag-over-page');
    if (!docOpen()) { say('Open a PDF first', 'info'); return; }
    const pos = pagePos(e);
    if (!pos) { say('Drop it on the page', 'info'); return; }
    if (imgs) { dropImageFiles(imgs, pos); return; }
    let d; try { d = JSON.parse(raw); } catch (x) { return; }
    if (d.k === 'text') dropText(pos);
    else if (d.k === 'table') dropTable(pos);
    else if (d.k === 'shape') dropShape(pos, d.t);
    else if (d.k === 'art') dropArt(pos, d.i);
  }, true);

  // ── Keep the bar in step with the editor (document open, ribbon modes) ──
  function docOpen() {
    const sec = $('sec-pdfeditor');
    if (!sec || !sec.classList.contains('active')) return false;
    try { return typeof pdfed !== 'undefined' && !!(pdfed && pdfed.pages && pdfed.pages.length); } catch (e) { return false; }
  }
  function visible(el) { return !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'; }
  function sync() {
    const live = docOpen();
    bar.classList.toggle('pdqb-live', live && !hidden);
    tab.classList.toggle('pdqb-live', live && hidden);
    if (!live && current) closeFly();
    const hand = $('pdfedHandBtn');
    buttons.select.classList.toggle('on', !current && !!hand && hand.classList.contains('annot-active'));
    mirrors.forEach(function (m) { m.style.display = visible($(m.dataset.src)) ? '' : 'none'; });
    body.querySelectorAll('[data-flag]').forEach(function (f) { const s = $(f.dataset.flag); f.classList.toggle('on', !!s && s.classList.contains('active')); });
  }
  setInterval(sync, 400);
  sync();

  window.pdqbOpen = openTool; window.pdqbClose = closeFly;
})();
