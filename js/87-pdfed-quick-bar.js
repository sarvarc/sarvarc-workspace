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
    rl: '<path d="M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7"/>', flip: '<path d="M7 8h12l-3-3M17 16H5l3 3"/>', check: '<path d="M5 12l5 5 9-10"/>'
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
  // Small control pair: hide the bar, and flip it between vertical and horizontal.
  const ctl = document.createElement('div'); ctl.className = 'pdqb-ctl';
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button'; hideBtn.className = 'pdqb-rbtn'; hideBtn.id = 'pdqbHide'; hideBtn.title = 'Hide quick tools'; hideBtn.setAttribute('aria-label', 'Hide quick tools');
  hideBtn.innerHTML = svg('left');
  const flipBtn = document.createElement('button');
  flipBtn.type = 'button'; flipBtn.className = 'pdqb-rbtn'; flipBtn.id = 'pdqbFlip'; flipBtn.title = 'Flip layout: vertical or horizontal'; flipBtn.setAttribute('aria-label', 'Flip layout between vertical and horizontal');
  flipBtn.innerHTML = svg('flip');
  ctl.appendChild(hideBtn); ctl.appendChild(flipBtn); bar.appendChild(ctl);
  // Grip: the handle used to move the bar.
  const grip = document.createElement('button');
  grip.type = 'button'; grip.className = 'pdqb-grip'; grip.id = 'pdqbGrip';
  grip.title = 'Drag to move. Double-click to reset. Arrow keys also move it.'; grip.setAttribute('aria-label', 'Move quick tools');
  grip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="1.6"/><circle cx="12" cy="9" r="1.6"/><circle cx="16" cy="9" r="1.6"/><circle cx="8" cy="15" r="1.6"/><circle cx="12" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/></svg>';
  bar.insertBefore(grip, bar.firstChild);
  const bgfx = document.createElement('div'); bgfx.className = 'pdqb-bgfx'; area.appendChild(bgfx);

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
    const wasOpen = fly.classList.contains('open');
    current = id; fly.classList.add('open'); render(t);
    if (window.__pdqbPlaceFly) window.__pdqbPlaceFly(!wasOpen);
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

  // ── MOVABLE BAR: drag the grip anywhere in the page area; vertical or horizontal; smooth reflow ──
  // Near a side edge the bar becomes vertical, near the top or bottom it becomes horizontal (it reflows while you
  // drag). Let go close to an edge and it docks with a safe margin (clear of the page-strip handles, the
  // page-actions pill and the zoom badge). Let go in the middle and it floats there. The place is remembered.
  const PKEY = 'sarvarcPdfQuickBarPos';
  const M = { left: 36, right: 36, top: 56, bottom: 56 };   // dock margins from the area edge
  const EDGE = 8, ZONE = 56, SNAP = 56;                       // free-float margin, reflow zone, snap reach
  const DEFAULT_POS = { o: 'v', dock: 'left', x: M.left, y: 64 };
  let pos = Object.assign({}, DEFAULT_POS);
  try {
    const sv = JSON.parse(localStorage.getItem(PKEY) || 'null');
    if (sv && (sv.o === 'v' || sv.o === 'h')) pos = { o: sv.o, dock: ['left', 'right', 'top', 'bottom'].indexOf(sv.dock) >= 0 ? sv.dock : null, x: +sv.x || 0, y: +sv.y || 0 };
  } catch (e) {}
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const aSize = () => ({ w: area.clientWidth, h: area.clientHeight });
  const bSize = () => ({ w: bar.offsetWidth, h: bar.offsetHeight });
  function savePos() { try { localStorage.setItem(PKEY, JSON.stringify({ o: pos.o, dock: pos.dock, x: Math.round(pos.x), y: Math.round(pos.y) })); } catch (e) {} }
  // Where the bar should be for a state (docked states snap to their margin; everything stays inside the area).
  function place(p) {
    const A = aSize(), B = bSize();
    let x = p.x, y = p.y;
    if (p.dock === 'left') x = M.left; else if (p.dock === 'right') x = A.w - B.w - M.right;
    else if (p.dock === 'top') y = M.top; else if (p.dock === 'bottom') y = A.h - B.h - M.bottom;
    if (p.dock === 'right') y = Math.max(y, 64);   // keep clear of the page-actions pill at the top right
    return { x: clamp(x, EDGE, Math.max(EDGE, A.w - B.w - EDGE)), y: clamp(y, EDGE, Math.max(EDGE, A.h - B.h - EDGE)) };
  }
  // Which edge the bar is close enough to dock to (null = float). The shape must match the edge.
  function snapFor(x, y, o) {
    const A = aSize(), B = bSize();
    if (o === 'v') {
      if (Math.abs(x - M.left) < SNAP) return 'left';
      if (Math.abs(A.w - B.w - M.right - x) < SNAP) return 'right';
    } else {
      if (Math.abs(y - M.top) < SNAP) return 'top';
      if (Math.abs(A.h - B.h - M.bottom - y) < SNAP) return 'bottom';
    }
    return null;
  }
  function placeTab() {
    const d = pos.dock || 'left';
    bar.dataset.dock = d; bar.dataset.o = pos.o;
    tab.className = 'pdqb-tab' + (d === 'left' ? '' : ' d-' + d) + (tab.classList.contains('pdqb-live') ? ' pdqb-live' : '');
    tab.style.top = ''; tab.style.left = '';
    const A = aSize();
    if (d === 'left' || d === 'right') tab.style.top = clamp(pos.y, EDGE, Math.max(EDGE, A.h - 60)) + 'px';
    else tab.style.left = clamp(pos.x, EDGE, Math.max(EDGE, A.w - 60)) + 'px';
  }
  let animT = 0;
  function applyPos(anim) {
    placeTab();
    if (!bar.offsetWidth) return;
    const q = place(pos);
    if (anim && !reduced()) { bar.classList.add('pdqb-anim'); clearTimeout(animT); animT = setTimeout(function () { bar.classList.remove('pdqb-anim'); positionFly(); }, 330); }
    bar.style.left = q.x + 'px'; bar.style.top = q.y + 'px';
    positionFly();
  }
  // The panel opens on the roomier side of the bar and stays inside the page area.
  function positionFly(instant) {
    if (!current || !fly.classList.contains('open')) return;
    const A = aSize(), B = bSize(), gap = 12;
    const bx = parseFloat(bar.style.left), by = parseFloat(bar.style.top);
    const BX = isNaN(bx) ? bar.offsetLeft : bx, BY = isNaN(by) ? bar.offsetTop : by;
    fly.style.maxHeight = Math.max(160, A.h - 16) + 'px';
    const fw = fly.offsetWidth || 272, fh = fly.offsetHeight || 300;
    let x, y;
    if (pos.o === 'v') {
      x = BX + B.w + gap; if (x + fw > A.w - EDGE) x = BX - gap - fw;
      x = Math.max(EDGE, x); y = clamp(BY, EDGE, Math.max(EDGE, A.h - fh - EDGE));
    } else {
      y = BY + B.h + gap; if (y + fh > A.h - EDGE) y = BY - gap - fh;
      y = Math.max(EDGE, y);
      const b = buttons[current]; const cx = b ? BX + b.offsetLeft - bar.scrollLeft + b.offsetWidth / 2 : BX;
      x = clamp(cx - fw / 2, EDGE, Math.max(EDGE, A.w - fw - EDGE));
    }
    if (instant) fly.classList.add('pdqb-fly-still');
    fly.style.left = Math.round(x) + 'px'; fly.style.top = Math.round(y) + 'px';
    if (instant) { void fly.offsetWidth; requestAnimationFrame(function () { fly.classList.remove('pdqb-fly-still'); }); }
  }
  window.__pdqbPlaceFly = positionFly;
  let drag = null;
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (!drag) applyPos(false); }).observe(area);
    new ResizeObserver(function () { if (!drag) positionFly(); }).observe(fly);
  }

  // Smooth reflow between vertical and horizontal: each button glides from where it was to where it now is,
  // while a background layer grows or shrinks from the old shape to the new one.
  let flipT = 0, flipKids = [];
  function endFlip() {
    clearTimeout(flipT); flipT = 0;
    flipKids.forEach(function (k) { k.style.transition = ''; k.style.transform = ''; });
    flipKids = [];
    bar.classList.remove('pdqb-flipping'); bgfx.classList.remove('on');
    positionFly();
  }
  function flip(o, mutate) {
    if (flipT) endFlip();
    if (pos.o === o) { if (mutate) mutate(); applyPos(false); return; }
    const kids = Array.prototype.slice.call(bar.children);
    const first = kids.map(function (k) { return k.getBoundingClientRect(); });
    const ar = area.getBoundingClientRect(), br0 = bar.getBoundingClientRect();
    const oldBox = { x: br0.left - ar.left, y: br0.top - ar.top, w: bar.offsetWidth, h: bar.offsetHeight };
    pos.o = o; bar.classList.toggle('pdqb-h', o === 'h');       // the layout switches here
    if (mutate) mutate(oldBox);
    const q = place(pos); bar.style.left = q.x + 'px'; bar.style.top = q.y + 'px';
    placeTab();
    if (reduced() || !bar.offsetWidth) { positionFly(true); return; }
    flipKids = kids;
    kids.forEach(function (k, i) {
      const r = k.getBoundingClientRect(), dx = first[i].left - r.left, dy = first[i].top - r.top;
      k.style.transition = 'none'; k.style.transform = (dx || dy) ? 'translate(' + dx + 'px,' + dy + 'px)' : '';
    });
    bgfx.classList.add('pdqb-bgfx-still', 'on');
    bgfx.style.left = oldBox.x + 'px'; bgfx.style.top = oldBox.y + 'px'; bgfx.style.width = oldBox.w + 'px'; bgfx.style.height = oldBox.h + 'px';
    bar.classList.add('pdqb-flipping');
    void bar.offsetWidth;
    kids.forEach(function (k, i) { k.style.transition = 'transform .36s cubic-bezier(.2,.8,.2,1) ' + (i * 12) + 'ms'; k.style.transform = ''; });
    bgfx.classList.remove('pdqb-bgfx-still');
    const n = bSize();
    bgfx.style.left = q.x + 'px'; bgfx.style.top = q.y + 'px'; bgfx.style.width = n.w + 'px'; bgfx.style.height = n.h + 'px';
    flipT = setTimeout(endFlip, 360 + kids.length * 12 + 40);
    positionFly(true);
  }

  // Drag
  function dragEnd(commit) {
    if (!drag) return;
    const d = drag; drag = null;
    bar.classList.remove('pdqb-moving'); fly.classList.remove('pdqb-fly-moving'); 
    try { grip.releasePointerCapture(d.id); } catch (e) {}
    if (!d.moved) return;
    if (commit) {
      pos.x = parseFloat(bar.style.left) || 0; pos.y = parseFloat(bar.style.top) || 0;
      pos.dock = snapFor(pos.x, pos.y, pos.o);
      applyPos(true); savePos();
    } else {
      const st = d.start;
      if (pos.o !== st.o) flip(st.o, function () { Object.assign(pos, st); }); else { Object.assign(pos, st); applyPos(true); }
      savePos();
    }
    if (current) positionFly(true);
  }
  grip.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    const br = bar.getBoundingClientRect();
    const ar0 = area.getBoundingClientRect(), A0 = aSize(), q0 = { left: e.clientX - ar0.left, right: A0.w - (e.clientX - ar0.left), top: e.clientY - ar0.top, bottom: A0.h - (e.clientY - ar0.top) };
    let z0 = null, zd0 = ZONE; ['left', 'right', 'top', 'bottom'].forEach(function (k) { if (q0[k] < zd0) { zd0 = q0[k]; z0 = k; } });
    drag = { id: e.pointerId, ox: e.clientX - br.left, oy: e.clientY - br.top, sx: e.clientX, sy: e.clientY, moved: false, zone: z0, start: Object.assign({}, pos) };
    try { grip.setPointerCapture(e.pointerId); } catch (x) {}
  });
  grip.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true; bar.classList.add('pdqb-moving'); fly.classList.add('pdqb-fly-moving');
      bar.classList.remove('pdqb-anim');
    }
    const ar = area.getBoundingClientRect(), A = aSize();
    const px = e.clientX - ar.left, py = e.clientY - ar.top;
    // Which edge zone the pointer is in (with a little hysteresis between neighbouring edges). The bar reflows into
    // an edge's shape when the pointer ENTERS that edge's zone during this drag. Grabbing a bar that already sits
    // next to an edge never flips it by surprise (the Flip button is there for that case).
    const dist = { left: px, right: A.w - px, top: py, bottom: A.h - py };
    let zone = null, zd = ZONE;
    ['left', 'right', 'top', 'bottom'].forEach(function (k) { if (dist[k] < zd) { zd = dist[k]; zone = k; } });
    if (zone && drag.zone && zone !== drag.zone && dist[drag.zone] < ZONE && dist[drag.zone] - dist[zone] < 12) zone = drag.zone;
    if (zone && zone !== drag.zone) {
      const want = (zone === 'left' || zone === 'right') ? 'v' : 'h';
      if (want !== pos.o) {
        flip(want, function () {
          drag.ox = grip.offsetLeft + grip.offsetWidth / 2; drag.oy = grip.offsetTop + grip.offsetHeight / 2;
          pos.dock = null; pos.x = px - drag.ox; pos.y = py - drag.oy;
        });
      }
    }
    drag.zone = zone;
    const B = bSize();
    const x = clamp(px - drag.ox, EDGE, Math.max(EDGE, A.w - B.w - EDGE));
    const y = clamp(py - drag.oy, EDGE, Math.max(EDGE, A.h - B.h - EDGE));
    bar.style.left = x + 'px'; bar.style.top = y + 'px';
    if (flipT) { bgfx.style.left = x + 'px'; bgfx.style.top = y + 'px'; }
  });
  grip.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.id) dragEnd(true); });
  grip.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) dragEnd(false); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag && drag.moved) { e.stopImmediatePropagation(); dragEnd(false); }
  }, true);
  // Keyboard: arrows nudge the bar (Shift = bigger steps).
  grip.addEventListener('keydown', function (e) {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!k) return;
    e.preventDefault(); const st = e.shiftKey ? 64 : 16;
    const q = place(pos);
    const c = place({ o: pos.o, dock: null, x: q.x + k[0] * st, y: q.y + k[1] * st });
    pos.x = c.x; pos.y = c.y; pos.dock = null;               // keyboard nudges float freely (no re-snap)
    applyPos(true); savePos();
  });
  grip.addEventListener('dblclick', function () {                      // reset to the starting place
    const go = function () { Object.assign(pos, DEFAULT_POS); };
    if (pos.o !== DEFAULT_POS.o) flip(DEFAULT_POS.o, go); else { go(); applyPos(true); }
    savePos();
  });
  // Flip button: same top-left corner, other shape. Docks itself if that lands close to an edge.
  flipBtn.addEventListener('click', function () {
    const o = pos.o === 'v' ? 'h' : 'v';
    flip(o, function (old) {
      pos.dock = null; pos.x = old.x; pos.y = old.y;
      const c = place(pos); pos.x = c.x; pos.y = c.y;
      pos.dock = snapFor(pos.x, pos.y, o);
    });
    savePos();
  });
  window.pdqbMove = function (o, dock, x, y) {                          // for tests and other code
    const go = function () { Object.assign(pos, { dock: dock || null, x: x || 0, y: y || 0 }); };
    if (o && o !== pos.o) flip(o, go); else { go(); applyPos(true); }
    savePos();
  };

  // ── Keep the bar in step with the editor (document open, ribbon modes) ──
  function docOpen() {
    const sec = $('sec-pdfeditor');
    if (!sec || !sec.classList.contains('active')) return false;
    try { return typeof pdfed !== 'undefined' && !!(pdfed && pdfed.pages && pdfed.pages.length); } catch (e) { return false; }
  }
  function visible(el) { return !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'; }
  function sync() {
    const live = docOpen();
    const wasLive = bar.classList.contains('pdqb-live');
    bar.classList.toggle('pdqb-live', live && !hidden);
    if (live && !hidden && !wasLive) { bar.classList.toggle('pdqb-h', pos.o === 'h'); applyPos(false); }
    const tabWas = tab.classList.contains('pdqb-live'); tab.classList.toggle('pdqb-live', live && hidden);
    if (live && hidden && !tabWas) placeTab();
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
