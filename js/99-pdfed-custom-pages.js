// ─── PDF Editor: Custom Pages (ready-made page layouts for preparing documents) ───
// Shows in TWO places, fed by ONE list (LAYOUTS below):
//   1. the empty editor screen ("Or start from a ready page")
//   2. the right panel, Canvas tab, under Styles ("Custom Pages")
// Click a tile (or drag it onto the page). With no page open, a new A4 page opens with it.
// A layout = real filled shapes (the colour blocks) + real text on top. Everything is a normal object: select, move, resize, recolour, delete.
// Nothing new to learn: double click any text to type, change colours with the normal text toolbar.
// Uses js/90 for undo snapshots (pdfedCanvasStyles.snap / restore). Does not edit js/19, js/24, js/28.
(function () {
  var MIME = 'application/x-cp-layout', busy = false;
  // rect = [x%, y%, w%, h%, colour]   text = { t, x%, y%, w%, s (size as % of page width), f font, c colour, a align, b bold, ls spacing }
  function T(t, x, y, w, s, c, o) { o = o || {}; return { t: t, x: x, y: y, w: w, s: s, c: c, f: o.f || 'Inter', a: o.a || 'left', b: !!o.b, ls: o.ls || 0 }; }
  var LOREM1 = 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
  var LOREM2 = 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit.';
  // Shape helpers. r = [x%, y%, w%, h%, colour, tool, opacity 0-1, flipY]. Circles and diamonds take a width and keep a true shape on A4.
  function R(x, y, w, h, c, o) { return [x, y, w, h, c, 'rect', o || 1]; }
  function Q(x, y, w, h, c, o) { return [x, y, w, h, c, 'roundrect', o || 1]; }
  function O(x, y, d, c, o) { return [x, y, d, d * .707, c, 'circle', o || 1]; }
  function Tr(x, y, w, h, c, o, fl) { return [x, y, w, h, c, 'triangle', o || 1, !!fl]; }
  function Di(x, y, w, c, o) { return [x, y, w, w * .707, c, 'diamond', o || 1]; }
  function Hx(x, y, w, c, o) { return [x, y, w, w * .62, c, 'hexagon', o || 1]; }
  // A heading with a short paragraph under it.
  function S(h, b, x, y, w, hc, bc) { return [T(h, x, y, w, .024, hc, { b: 1, ls: .08 }), T(b, x, y + 3.6, w, .019, bc)]; }
  var L1 = 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
  var L2 = 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim.';
  var SH = 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.';
  var FOOT = 'Company Name | Contact Name | Phone number | Email address';
  var C = { a: 'center' }, CB = { a: 'center', b: 1 }, B = { b: 1 }, G = { f: 'Georgia', b: 1 }, GC = { f: 'Georgia', b: 1, a: 'center' };
  var LAYOUTS = [
    { n: 'Proposal Cover',
      r: [R(0, 0, 100, 100, '#3fd6e0'), R(0, 0, 100, 23, '#f6f7fc'), R(7, 42, 36, 48, '#ffffff')],
      t: [T('BUSINESS NAME', 7, 4.2, 50, .03, '#1f2430', B), T('2002 Yale Ave SW, City Name, State', 7, 7, 60, .021, '#5a6070'),
        T('BUSINESS', 6.4, 11.5, 88, .14, '#3fd6e0', B), T('PROPOSAL', 6.4, 22.8, 88, .14, '#ffffff', B)]
        .concat(S('SUMMARY', SH, 49, 43, 44, '#2c3a47', '#3a4350'), S('GOALS', SH, 49, 60, 44, '#2c3a47', '#3a4350'),
          [T('TIMELINE', 49, 77, 44, .024, '#2c3a47', { b: 1, ls: .08 }), T('DATE 1: First milestone\nDATE 2: Second milestone\nDATE 3: Final delivery', 49, 80.6, 44, .019, '#3a4350'), T(FOOT, 0, 95.5, 100, .015, '#27777d', C)]) },
    { n: 'Report Band',
      r: [R(0, 0, 100, 28, '#12294d'), R(0, 28, 100, 1.1, '#e5c273')],
      t: [T('COMPANY NAME', 7, 5, 60, .024, '#e5c273', { b: 1, ls: .12 }), T('ANNUAL REPORT', 6.4, 11.5, 88, .082, '#ffffff', B), T('2026 Overview', 7, 21.5, 60, .035, '#e5c273')]
        .concat(S('OVERVIEW', L1 + ' ' + L2, 7, 35, 86, '#12294d', '#3a4350'), S('HIGHLIGHTS', L1 + ' ' + L2, 7, 54, 86, '#12294d', '#3a4350'), S('NEXT STEPS', L2, 7, 73, 86, '#12294d', '#3a4350'), [T(FOOT, 0, 95.5, 100, .015, '#8a90a0', C)]) },
    { n: 'Side Bar',
      r: [R(0, 0, 33, 100, '#0f3d3e')],
      t: [T('CONTACT', 5, 7, 24, .024, '#9fe3d6', { b: 1, ls: .12 }), T('Your Name\n+91 00000 00000\nname@email.com\nwww.website.com', 5, 10.5, 25, .02, '#ffffff'),
        T('ABOUT', 5, 30, 24, .024, '#9fe3d6', { b: 1, ls: .12 }), T(L1, 5, 33.6, 24, .018, '#ffffff'),
        T('PROJECT BRIEF', 38, 7, 56, .07, '#0f3d3e', B), T('Prepared for Client Name', 38, 17, 56, .028, '#5a6a6a')]
        .concat(S('BACKGROUND', L1 + ' ' + L2, 38, 28, 56, '#0f3d3e', '#3a4350'), S('SCOPE', L1 + ' ' + L2, 38, 52, 56, '#0f3d3e', '#3a4350'), S('BUDGET', L2, 38, 76, 56, '#0f3d3e', '#3a4350')) },
    { n: 'Split Page',
      r: [R(0, 0, 100, 100, '#f0674a'), R(0, 0, 100, 58, '#fbf3e6')],
      t: [T('PROJECT PLAN', 6.4, 10, 88, .088, '#2b2118', B), T('Prepared by Your Company', 7, 22, 70, .03, '#7a6a58'), T(L1 + ' ' + L2, 7, 33, 80, .021, '#3a3228')]
        .concat(S('TERMS', L1 + ' ' + L2, 7, 64, 86, '#ffffff', '#ffffff'), [T(FOOT, 0, 95.5, 100, .015, '#ffe3da', C)]) },
    { n: 'Circle Burst',
      r: [O(46, 5, 50, '#ff7a59'), O(38, 34, 16, '#1d2a4a'), O(8, 42, 8, '#ffc83d')],
      t: [T('HELLO', 7, 12, 38, .11, '#1d2a4a', B), T('A fresh start for your ideas', 7, 27, 38, .026, '#5a6070')]
        .concat(S('ABOUT', L1, 7, 54, 60, '#1d2a4a', '#3a4350'), S('PLAN', L2, 7, 74, 60, '#1d2a4a', '#3a4350'), [T(FOOT, 0, 95.5, 100, .015, '#8a90a0', C)]) },
    { n: 'Diamond Row',
      r: [R(0, 0, 100, 100, '#fbf5e9'), Di(7, 5, 18, '#c9a227'), Di(41, 5, 18, '#1d2a4a'), Di(75, 5, 18, '#2a9d8f')],
      t: [T('DIAMOND', 0, 24, 100, .11, '#1d2a4a', GC), T('Quality in every detail', 0, 37, 100, .03, '#7a6a58', C)]
        .concat(S('OUR STORY', L1, 8, 52, 38, '#1d2a4a', '#3a4350'), S('OUR PROMISE', L2, 54, 52, 38, '#1d2a4a', '#3a4350'), S('CONTACT', SH, 8, 76, 38, '#1d2a4a', '#3a4350'), [T(FOOT, 0, 95.5, 100, .015, '#8a7f6a', C)]) },
    { n: 'Hex Hero',
      r: [R(0, 0, 100, 100, '#0b1f3a'), Hx(6, 8, 30, '#1b6ca8'), Hx(24, 22, 30, '#2a9d8f', .9), Hx(8, 34, 22, '#f4b942')],
      t: [T('HEXAGON', 7, 58, 86, .11, '#ffffff', B), T('Built from strong parts', 7, 71, 70, .03, '#f4b942'), T(L1 + ' ' + L2, 7, 79, 70, .02, '#c9d3e3')] },
    { n: 'Gold Frame',
      r: [R(0, 0, 100, 100, '#111111'), R(5, 3.5, 90, .5, '#c9a227'), R(5, 96, 90, .5, '#c9a227'), R(5, 3.5, .7, 93, '#c9a227'), R(94.3, 3.5, .7, 93, '#c9a227'), R(40, 50, 20, .3, '#c9a227')],
      t: [T('EXCELLENCE', 0, 28, 100, .085, '#c9a227', GC), T('A Premium Proposal', 0, 41, 100, .03, '#ffffff', { a: 'center', f: 'Georgia' }), T(L1 + ' ' + L2, 20, 56, 60, .02, '#d8d2c0', C), T(FOOT, 0, 91, 100, .014, '#c9a227', C)] },
    { n: 'Mint Cards',
      r: [R(0, 0, 100, 100, '#e6f5ef'), Q(7, 30, 86, 18, '#ffffff'), Q(7, 52, 86, 18, '#ffffff'), Q(7, 74, 86, 18, '#ffffff')],
      t: [T('OVERVIEW', 7, 8, 86, .09, '#0f5132', B), T('Three things to know', 7, 20, 70, .03, '#4f7a66')]
        .concat(S('ONE', SH, 10, 32, 80, '#0f5132', '#3a4350'), S('TWO', SH, 10, 54, 80, '#0f5132', '#3a4350'), S('THREE', SH, 10, 76, 80, '#0f5132', '#3a4350')) },
    { n: 'Bold Stripe',
      r: [R(0, 0, 4, 100, '#ff5a5f'), R(4, 0, 1.2, 100, '#1d2a4a')],
      t: [T('BOLD IDEAS', 10, 10, 86, .09, '#1d2a4a', B), T('Make a strong first impression', 10, 21, 80, .03, '#ff5a5f')]
        .concat(S('WHAT WE DO', L1 + ' ' + L2, 10, 38, 80, '#1d2a4a', '#3a4350'), S('HOW WE DO IT', L1 + ' ' + L2, 10, 58, 80, '#1d2a4a', '#3a4350'), S('WHY US', L2, 10, 78, 80, '#1d2a4a', '#3a4350')) },
    { n: 'Growth',
      r: [R(0, 70, 100, 30, '#12294d'), O(68, 58, 24, '#ff7a59'), O(82, 66, 12, '#ffc83d')],
      t: [T('GROWTH', 7, 9, 86, .12, '#12294d', B), T('Plan for the year ahead', 7, 23, 70, .03, '#5a6070'), T(L1 + ' ' + L2, 7, 34, 70, .02, '#3a4350'), T('CONTACT US', 7, 76, 50, .024, '#ffc83d', { b: 1, ls: .1 }), T('Your Name\nname@email.com\n+91 00000 00000', 7, 80, 50, .02, '#ffffff')] },
    { n: 'Photo Hero',
      r: [R(0, 0, 100, 46, '#cfd6e0'), Q(7, 36, 60, 22, '#ffffff')],
      t: [T('YOUR PHOTO HERE', 0, 14, 100, .022, '#7b8494', CB), T('PORTFOLIO', 9, 38, 56, .07, '#1d2a4a', B), T('Selected work 2026', 9, 49, 56, .026, '#5a6070')]
        .concat(S('ABOUT', L1, 7, 66, 40, '#1d2a4a', '#3a4350'), S('SERVICES', L2, 54, 66, 40, '#1d2a4a', '#3a4350')) },
    { n: 'Sunset Rings',
      r: [R(0, 0, 100, 100, '#1a1033'), O(10, 8, 80, '#3b1d6b'), O(20, 15.1, 60, '#7a2b8a'), O(30, 22.2, 40, '#e0457b'), O(40, 29.2, 20, '#ffb347')],
      t: [T('SUNSET', 0, 68, 100, .11, '#ffffff', CB), T('Colours that glow', 0, 82, 100, .03, '#ff8fb3', C), T(FOOT, 0, 95.5, 100, .015, '#8f7fb8', C)] },
    { n: 'Minimal Lines',
      r: [R(7, 8, 6, .6, '#e63946'), R(7, 28, 86, .15, '#222222'), R(7, 60, 86, .15, '#222222'), R(7, 92, 86, .15, '#222222')],
      t: [T('MINIMAL', 7, 12, 86, .12, '#111111', B)]
        .concat(S('ONE', SH, 7, 34, 40, '#111111', '#3a4350'), S('TWO', SH, 53, 34, 40, '#111111', '#3a4350'), S('THREE', SH, 7, 66, 40, '#111111', '#3a4350'), S('FOUR', SH, 53, 66, 40, '#111111', '#3a4350'), [T(FOOT, 7, 94, 86, .014, '#8a90a0')]) },
    { n: 'Pink Blocks',
      r: [R(0, 0, 50, 25, '#ff6b9d'), R(50, 0, 50, 25, '#1d2a4a'), R(0, 25, 50, 12, '#ffc2d6'), R(50, 25, 50, 12, '#ff6b9d')],
      t: [T('COLOR BLOCK', 6, 8, 88, .075, '#ffffff', B), T('Four shades, one idea', 6, 29, 40, .024, '#1d2a4a', B), T('Mix and match', 56, 29, 40, .024, '#ffffff', B)]
        .concat(S('FIRST', L1, 7, 46, 40, '#1d2a4a', '#3a4350'), S('SECOND', L2, 53, 46, 40, '#1d2a4a', '#3a4350'), S('THIRD', L1, 7, 70, 40, '#1d2a4a', '#3a4350'), S('FOURTH', L2, 53, 70, 40, '#1d2a4a', '#3a4350')) },
    { n: 'Ribbon',
      r: [R(0, 28, 100, 14, '#ff7a59'), R(0, 28, 100, 1.2, '#12294d'), R(0, 40.8, 100, 1.2, '#12294d')],
      t: [T('COMPANY NAME', 7, 11, 60, .026, '#12294d', { b: 1, ls: .12 }), T('Year in Review', 7, 16, 60, .03, '#5a6070'), T('RIBBON REPORT', 7, 31, 86, .06, '#ffffff', B)]
        .concat(S('SUMMARY', L1 + ' ' + L2, 7, 52, 86, '#12294d', '#3a4350'), S('RESULTS', L1 + ' ' + L2, 7, 72, 86, '#12294d', '#3a4350')) },
    { n: 'Inset Frame',
      r: [R(0, 0, 100, 100, '#0f766e'), R(6, 4, 88, 92, '#ffffff')],
      t: [T('INSET', 12, 10, 76, .11, '#0f766e', B), T('Clean and calm', 12, 23, 70, .03, '#5a6a6a')]
        .concat(S('PURPOSE', L1 + ' ' + L2, 12, 38, 76, '#0f766e', '#3a4350'), S('PROCESS', L1 + ' ' + L2, 12, 58, 76, '#0f766e', '#3a4350'), S('RESULT', L2, 12, 78, 76, '#0f766e', '#3a4350')) },
    { n: 'Square Border',
      r: [R(7, 3, 13.5, 9.5, '#ef476f'), R(22.2, 3, 13.5, 9.5, '#ffd166'), R(37.4, 3, 13.5, 9.5, '#06d6a0'), R(52.6, 3, 13.5, 9.5, '#118ab2'), R(67.8, 3, 13.5, 9.5, '#073b4c'), R(83, 3, 10, 9.5, '#ef476f'),
        R(7, 87.5, 13.5, 9.5, '#118ab2'), R(22.2, 87.5, 13.5, 9.5, '#06d6a0'), R(37.4, 87.5, 13.5, 9.5, '#ffd166'), R(52.6, 87.5, 13.5, 9.5, '#ef476f'), R(67.8, 87.5, 13.5, 9.5, '#073b4c'), R(83, 87.5, 10, 9.5, '#118ab2')],
      t: [T('PATTERN', 0, 19, 100, .11, '#073b4c', CB), T('Small pieces, big picture', 0, 32, 100, .03, '#5a6070', C)]
        .concat(S('LEFT SIDE', L1, 8, 48, 38, '#073b4c', '#3a4350'), S('RIGHT SIDE', L2, 54, 48, 38, '#073b4c', '#3a4350'), S('NOTES', SH, 8, 68, 84, '#073b4c', '#3a4350')) },
    { n: 'Ocean Glass',
      r: [R(0, 0, 100, 100, '#0a4d8c'), O(8, 8, 60, '#ffffff', .12), O(38, 18, 50, '#ffffff', .12), O(20, 36, 40, '#ffffff', .12)],
      t: [T('OCEAN BLUE', 7, 62, 88, .1, '#ffffff', B), T('Clear, deep and calm', 7, 75, 70, .03, '#9fd3ff'), T(L1, 7, 82, 70, .02, '#d6ecff'), T(FOOT, 0, 95.5, 100, .015, '#8fc1ee', C)] },
    { n: 'Sun Header',
      r: [R(0, 0, 100, 100, '#fff6d6'), R(0, 0, 100, 38, '#ffcf33'), O(60, 8, 34, '#ffffff')],
      t: [T('HELLO', 7, 11, 50, .12, '#2b2118', B), T('Bright and friendly', 7, 26, 50, .028, '#6b5a1f'), T('2026', 60, 15.5, 34, .08, '#f0a800', CB)]
        .concat(S('WHO WE ARE', L1 + ' ' + L2, 7, 47, 86, '#2b2118', '#3a3228'), S('WHAT WE OFFER', L1 + ' ' + L2, 7, 67, 86, '#2b2118', '#3a3228')) },
    { n: 'Letterhead',
      r: [R(0, 0, 100, 3, '#1d4ed8'), O(7, 6.5, 9, '#1d4ed8'), R(7, 17, 86, .15, '#cccccc'), R(0, 96, 100, 4, '#1d4ed8')],
      t: [T('LOGO', 7, 8.8, 9, .016, '#ffffff', CB), T('COMPANY NAME', 19, 7.6, 50, .03, '#111111', B), T('2002 Yale Ave SW, City Name, State', 19, 11.6, 60, .02, '#6b7280'),
        T('Date: DD / MM / YYYY', 7, 21, 60, .02, '#374151'), T('Dear Name,', 7, 27, 60, .022, '#111111', B), T(L1 + ' ' + L2, 7, 32, 86, .021, '#374151'), T(L2 + ' ' + L1, 7, 46, 86, .021, '#374151'), T('Sincerely,\nYour Name', 7, 64, 50, .021, '#111111')] },
    { n: 'Magazine',
      r: [R(0, 0, 50, 100, '#efe6d8'), R(50, 0, 50, 100, '#1c1c1c'), Di(70, 72, 20, '#c9a227')],
      t: [T('THE ISSUE', 6, 9, 40, .06, '#1c1c1c', G), T('Stories worth reading', 6, 19, 40, .024, '#6b5a40')]
        .concat(S('EDITORIAL', L1 + ' ' + L2, 6, 34, 38, '#1c1c1c', '#3a3228'), S('CULTURE', L2, 6, 58, 38, '#1c1c1c', '#3a3228'),
          [T('FEATURE', 56, 9, 38, .024, '#c9a227', { b: 1, ls: .12 }), T(L1 + ' ' + L2, 56, 13, 38, .02, '#e8e2d4'), T('NEXT ISSUE', 56, 40, 38, .024, '#c9a227', { b: 1, ls: .12 }), T(L2, 56, 44, 38, .02, '#e8e2d4')]) }
  ];

  function say(m, k) { try { if (typeof toast === 'function') toast(m, k || 'info'); } catch (e) {} }
  function docOpen() { try { return typeof pdfed !== 'undefined' && !!(pdfed && pdfed.pages && pdfed.pages.length); } catch (e) { return false; } }
  function drawShape(x, tool, px, py, pw, ph) {
    x.beginPath();
    if (tool === 'circle') x.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, 6.2832);
    else if (tool === 'triangle') { x.moveTo(px + pw / 2, py); x.lineTo(px + pw, py + ph); x.lineTo(px, py + ph); x.closePath(); }
    else if (tool === 'diamond') { x.moveTo(px + pw / 2, py); x.lineTo(px + pw, py + ph / 2); x.lineTo(px + pw / 2, py + ph); x.lineTo(px, py + ph / 2); x.closePath(); }
    else if (tool === 'hexagon') { x.moveTo(px + pw * .25, py); x.lineTo(px + pw * .75, py); x.lineTo(px + pw, py + ph / 2); x.lineTo(px + pw * .75, py + ph); x.lineTo(px + pw * .25, py + ph); x.lineTo(px, py + ph / 2); x.closePath(); }
    else x.rect(px, py, pw, ph);
    x.fill();
  }
  // Used for the tile pictures only. On the page the blocks are real shapes.
  function paintBg(l, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'), i, r;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    for (i = 0; i < l.r.length; i++) { r = l.r[i]; x.fillStyle = r[4]; x.globalAlpha = r[6] || 1; drawShape(x, r[5] || 'rect', r[0] * w / 100, r[1] * h / 100, r[2] * w / 100, r[3] * h / 100); }
    x.globalAlpha = 1;
    return c;
  }
  // Small picture for the tile: the blocks plus a bar for each piece of text.
  function thumb(l) {
    var w = 120, h = 156, c = paintBg(l, w, h), x = c.getContext('2d');
    l.t.forEach(function (t) {
      var lines = String(t.t).length > 40 ? 3 : 1, bh = Math.max(2, t.s * w * .7);
      x.globalAlpha = .85; x.fillStyle = t.c;
      for (var k = 0; k < lines; k++) x.fillRect(t.x * w / 100 + (t.a === 'center' ? t.w * w / 400 : 0), t.y * h / 100 + k * bh * 1.6, Math.min(t.w, t.s > .05 ? t.w * .9 : lines > 1 ? t.w * (k === lines - 1 ? .6 : 1) : t.w * .5) * w / 100, bh);
    });
    return c.toDataURL('image/png');
  }

  async function makeDoc() {
    var url = await pdfedRenderBlankPage('', '#ffffff', 210, 297);
    var pg = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedTables: [], label: 'Custom page', bgColor: '#ffffff', pageMM: [210, 297] };
    pdfedReopenAfterLastPageUndo('Untitled Document');
    pdfed.pages.push(pg);
    var tot = document.getElementById('prrTotalPages'); if (tot) tot.textContent = pdfed.pages.length;
    try { state.stats.pdfs++; state.stats.pages++; updateStats(); } catch (e) {}
    await pdfedBuildStrip(); await pdfedGoto(0);
    if (typeof pdfedScheduleAutoCollapse === 'function') pdfedScheduleAutoCollapse();
    return pg;
  }
  function nextFrame() { return new Promise(function (r) { if (window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(r, 0); }); else setTimeout(r, 0); }); }

  async function applyLayout(i, opt) {
    var l = LAYOUTS[i], S = window.pdfedCanvasStyles;
    if (busy || !l || !S || !S.snap || typeof pdfedPlacedShapeSeq === 'undefined') return;
    busy = true; document.body.style.cursor = 'progress';
    try {
      if (typeof wsbEnsureEditorOpen === 'function') wsbEnsureEditorOpen();
      var made = false, pg;
      if (!docOpen()) { pg = await makeDoc(); made = true; } else pg = pdfed.pages[pdfed.active];
      var idx = pdfed.pages.indexOf(pg), before = made ? null : S.snap(pg);
      if (pdfed.active !== idx) await pdfedGoto(idx);
      var cvs = document.getElementById('pdfedPageCanvas'), W = cvs.width, H = cvs.height;
      await nextFrame();
      // Colour blocks are REAL shapes (filled rectangles): click to select, drag, resize, recolour with the Graphics fill, arrange, lock, delete.
      var beforeShapes = (pg.placedShapes || []).slice();
      pg.placedShapes = (pg.placedShapes || []).filter(function (o) { return !o._cpShape; });
      l.r.forEach(function (r) {
        pg.placedShapes.push({ id: 'pshp_' + (++pdfedPlacedShapeSeq), tool: r[5] || 'rect', color: r[4], size: 1, opacity: r[6] || 1, flipX: false, flipY: !!r[7],
          fill: { mode: 'solid', c1: r[4], c2: r[4], angle: 0, outline: false },
          x: Math.round(r[0] * W / 100), y: Math.round(r[1] * H / 100), w: Math.round(r[2] * W / 100), h: Math.round(r[3] * H / 100),
          locked: false, zIndex: pdfedNextZ(pg), _cpShape: true });
      });
      var afterShapesRef = pg.placedShapes;
      pg.placedTexts = (pg.placedTexts || []).filter(function (t) { return !t._cpText; });
      var big = 0; l.t.forEach(function (t, k) { if (t.s > l.t[big].s) big = k; });
      l.t.forEach(function (t, k) {
        var words = t.t, sz = t.s;
        if (opt && opt.title && k === big) { words = t.t === t.t.toUpperCase() ? opt.title.toUpperCase() : opt.title; sz = t.s * Math.max(.45, Math.min(1, t.t.length / Math.max(1, words.length))); }
        var o = { id: 'ptxt_' + (++pdfedPlacedTextSeq), text: words, x: Math.round(t.x * W / 100), y: Math.round(t.y * H / 100), w: Math.round(t.w * W / 100), fontSize: Math.round(sz * W * 100) / 100,
          fontFamily: t.f, color: t.c, bold: t.b, italic: false, underline: false, align: t.a, locked: false, zIndex: pdfedNextZ(pg), _cpText: true };
        if (t.ls) o.letterSpacing = t.ls;
        pg.placedTexts.push(o);
      });
      await pdfedGoto(idx); await pdfedBuildStrip(); pdfedMarkModified(idx);
      if (typeof pdfedRenderPlacedShapes === 'function') pdfedRenderPlacedShapes(idx);
      say(l.n + ' added. Double click any text to type.', 'success');
      var after = S.snap(pg), afterShapes = afterShapesRef.slice();
      pushAppHistory({
        label: 'Add custom page: ' + l.n,
        undo: async function () { if (made) { pdfed.pages.splice(0); pdfedResetToNoDocument(); return; } var at = pdfed.pages.indexOf(pg); if (at < 0) return; S.restore(pg, before); pg.placedShapes = beforeShapes.slice(); await pdfedGoto(at); await pdfedBuildStrip(); pdfedMarkModified(at); },
        redo: async function () { if (made) { S.restore(pg, after); pg.placedShapes = afterShapes.slice(); pdfed.pages.push(pg); await pdfedBuildStrip(); await pdfedGoto(0); return; } var at = pdfed.pages.indexOf(pg); if (at < 0) return; S.restore(pg, after); pg.placedShapes = afterShapes.slice(); await pdfedGoto(at); await pdfedBuildStrip(); pdfedMarkModified(at); }
      });
      return true;
    } catch (e) { console.warn('[custom pages]', e); say('Could not add that page', 'error'); }
    finally { busy = false; document.body.style.cursor = ''; }
    return false;
  }

  function tile(i, cls) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cp-th ' + (cls || ''); b.draggable = true; b.title = LAYOUTS[i].n;
    b.innerHTML = '<img alt="" src="' + thumb(LAYOUTS[i]) + '"><span>' + LAYOUTS[i].n + '</span>';
    b.onclick = function () { applyLayout(i); };
    b.addEventListener('dragstart', function (e) { try { e.dataTransfer.setData(MIME, JSON.stringify({ i: i })); e.dataTransfer.effectAllowed = 'copy'; } catch (x) {} });
    return b;
  }
  function grid(cls) { var g = document.createElement('div'); g.className = 'cp-grid ' + (cls || ''); LAYOUTS.forEach(function (_, i) { g.appendChild(tile(i)); }); return g; }


  // ─── Empty screen: one smooth sideways rail (replaces the old scrolling grid) ───
  // Wheel / trackpad moves it back and forth (vertical wheel is turned sideways), mouse drag glides with a little momentum,
  // and it always settles on a tile. Tiles near either edge tuck in (smaller, softer) and ease out again as they come in.
  // Touch uses the browser's own scrolling + CSS snap. The rail bleeds to both edges of the canvas; the edges fade.
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function navBtn(dir) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cp-nav cp-' + dir; b.tabIndex = -1;
    b.setAttribute('aria-label', dir === 'prev' ? 'Previous pages' : 'Next pages');
    b.innerHTML = '<i></i>'; return b;
  }
  function rail() {
    var wrap = document.createElement('div'); wrap.className = 'cp-rail';
    var track = document.createElement('div'); track.className = 'cp-track'; track.tabIndex = 0;
    track.setAttribute('role', 'region'); track.setAttribute('aria-label', 'Ready-made pages. Scroll sideways to browse.');
    LAYOUTS.forEach(function (_, i) { var t = tile(i, 'cp-rt'); t.draggable = false; track.appendChild(t); });
    var prev = navBtn('prev'), next = navBtn('next');
    wrap.appendChild(track); wrap.appendChild(prev); wrap.appendChild(next);
    try { railMotion(track, prev, next); } catch (e) { console.warn('[custom pages] rail', e); }
    return wrap;
  }
  function railMotion(track, prev, next) {
    var tiles = Array.prototype.slice.call(track.querySelectorAll('.cp-rt'));
    var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
    var reduce = mq('(prefers-reduced-motion: reduce)'), coarse = mq('(pointer: coarse)');
    var geo = [], padL = 40, W = 0, MAX = 0, STEP = 126;
    var pos = 0, target = 0, raf = 0, last = 0, paintQ = 0, idle = 0;
    var dragging = false, moved = false, sx = 0, s0 = 0, lx = 0, lt = 0, vx = 0, swallow = false;

    function measure() {
      W = track.clientWidth; MAX = Math.max(0, track.scrollWidth - W);
      padL = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      geo = tiles.map(function (t) { return { l: t.offsetLeft, w: t.offsetWidth }; });
      if (tiles.length > 1) STEP = Math.max(1, tiles[1].offsetLeft - tiles[0].offsetLeft);
    }
    function clamp(v) { return v < 0 ? 0 : v > MAX ? MAX : v; }
    function stops() { return geo.map(function (g) { return clamp(g.l - padL); }); }
    function nearestIdx(v) { var s = stops(), b = 0; for (var i = 1; i < s.length; i++) if (Math.abs(s[i] - v) < Math.abs(s[b] - v)) b = i; return b; }
    function nearest(v) { return stops()[nearestIdx(v)] || 0; }

    // Edge tuck: a tile is full size while it sits inside the padding; as it slides past an edge it shrinks and softens.
    function paint() {
      paintQ = 0; if (!W) return;
      var sl = track.scrollLeft, h, l, r, f;
      track.style.setProperty('--fl', Math.min(56, sl * .7).toFixed(1) + 'px');
      track.style.setProperty('--fr', Math.min(56, (MAX - sl) * .7).toFixed(1) + 'px');
      for (var i = 0; i < tiles.length; i++) {
        h = geo[i].w / 2; l = geo[i].l - sl; r = l + geo[i].w;
        f = Math.min(clamp01((l + h) / (padL + h)), clamp01((W - r + h) / (padL + h)));
        f = f * f * (3 - 2 * f);
        tiles[i].style.transform = f > .999 ? '' : 'scale(' + (.86 + .14 * f).toFixed(3) + ')';
        tiles[i].style.opacity = f > .999 ? '' : (.4 + .6 * f).toFixed(3);
      }
      prev.disabled = sl < 2; next.disabled = sl > MAX - 2;
    }
    function queuePaint() { if (!paintQ) paintQ = requestAnimationFrame(paint); }

    // One glide at a time. Easing is time based, so it feels the same on 60Hz and 120Hz screens.
    function step(now) {
      var dt = Math.min(48, now - last); last = now;
      pos += (target - pos) * (1 - Math.exp(-dt / 95));
      if (Math.abs(target - pos) < .4) pos = target;
      track.scrollLeft = pos;
      raf = pos === target ? 0 : requestAnimationFrame(step);
    }
    function glide(t) {
      target = clamp(t);
      if (reduce) { track.scrollLeft = target; return; }
      if (!raf) { pos = track.scrollLeft; last = performance.now(); raf = requestAnimationFrame(step); }
    }
    function settleSoon() { clearTimeout(idle); idle = setTimeout(function () { glide(nearest(target)); }, 130); }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } clearTimeout(idle); }
    function base() { return raf ? target : track.scrollLeft; }

    track.addEventListener('scroll', queuePaint, { passive: true });

    // wheel / trackpad: sideways, soft, ends hand the scroll back to the page
    track.addEventListener('wheel', function (e) {
      if (e.ctrlKey || !MAX) return;
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= W;
      if (!d) return;
      var b = base();
      if ((d < 0 && b <= 0) || (d > 0 && b >= MAX)) return;
      e.preventDefault(); glide(b + d * 1.1); settleSoon();
    }, { passive: false });

    // mouse drag with momentum (touch keeps native scrolling)
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.button !== 0 || !MAX) return;
      stop(); dragging = true; moved = false; sx = lx = e.clientX; s0 = track.scrollLeft; lt = e.timeStamp; vx = 0;
    });
    track.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx;
      if (!moved) { if (Math.abs(dx) < 5) return; moved = true; track.classList.add('cp-grab'); try { track.setPointerCapture(e.pointerId); } catch (x) {} }
      var dt = Math.max(1, e.timeStamp - lt); vx = vx * .75 + (-(e.clientX - lx) / dt) * .25; lx = e.clientX; lt = e.timeStamp;
      track.scrollLeft = clamp(s0 - dx);
    });
    function release(e) {
      if (!dragging) return; dragging = false; track.classList.remove('cp-grab');
      try { track.releasePointerCapture(e.pointerId); } catch (x) {}
      if (moved) { swallow = true; setTimeout(function () { swallow = false; }, 0); glide(nearest(track.scrollLeft + vx * 260)); }
    }
    track.addEventListener('pointerup', release); track.addEventListener('pointercancel', release);
    track.addEventListener('click', function (e) { if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);

    // keyboard + focus: arrows move one tile; a tabbed-to tile is brought fully into view
    track.addEventListener('keydown', function (e) {
      var k = e.key, i = nearestIdx(base()), n = tiles.length - 1, s = stops();
      if (k === 'ArrowRight') i = Math.min(n, i + 1); else if (k === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (k === 'Home') i = 0; else if (k === 'End') i = n; else return;
      e.preventDefault(); glide(s[i]);
    });
    track.addEventListener('focusin', function (e) {
      var i = tiles.indexOf(e.target); if (i < 0) return;
      var l = geo[i].l - track.scrollLeft, r = l + geo[i].w;
      if (l < padL) glide(geo[i].l - padL); else if (r > W - padL) glide(geo[i].l + geo[i].w - W + padL);
    });

    // arrows: one "page" of tiles, always landing on a tile
    function page(dir) { var per = Math.max(1, Math.floor((W - padL * 2) / STEP) - 1), s = stops(), i = nearestIdx(base()); glide(s[Math.max(0, Math.min(s.length - 1, i + dir * per))]); }
    prev.addEventListener('click', function () { page(-1); });
    next.addEventListener('click', function () { page(1); });

    function refresh() { measure(); if (track.scrollLeft > MAX) track.scrollLeft = MAX; paint(); }
    if (window.ResizeObserver) { try { new ResizeObserver(function () { refresh(); }).observe(track); } catch (e) {} }
    else window.addEventListener('resize', refresh);
    requestAnimationFrame(refresh);
  }


  // Two quiet shortcuts under the rail: open the Templates panel (left) or the Canvas Styles studio (right), so nobody has to hunt for them.
  // They only call what the app already has (sltOpen in js/77, pdfedStudioOpen in js/80); a missing function simply does nothing.
  function quick() {
    var row = document.createElement('div'); row.className = 'cp-quick';
    function btn(icon, label, tip, run) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cp-q'; b.title = tip;
      b.innerHTML = '<i class="cp-qi cp-qi-' + icon + '" aria-hidden="true"></i>' + label;
      b.onclick = function () { try { run(); } catch (e) { console.warn('[custom pages] shortcut', e); } };
      row.appendChild(b);
    }
    btn('tpl', 'Templates', 'Browse slide, carousel, proposal and quotation templates', function () { if (typeof sltOpen === 'function') sltOpen(); });
    btn('sty', 'Canvas Styles', 'Open canvas colours, styles and ready pages', function () { if (typeof pdfedStudioOpen === 'function') pdfedStudioOpen('canvas'); });
    return row;
  }

  // Place 1: the empty editor screen
  function injectEmpty() {
    var ph = document.getElementById('pdfedPlaceholder'); if (!ph || document.getElementById('cpStart')) return;
    var box = document.createElement('div'); box.id = 'cpStart'; box.className = 'cp-start';
    box.innerHTML = '<div class="cp-or"><span>Or start from a ready page</span></div>';
    box.appendChild(rail()); box.appendChild(quick()); ph.appendChild(box);
  }
  // Place 2: right panel, Canvas tab, under Styles
  function injectPanel() {
    if (document.getElementById('cpPanel')) return;
    var pcs = document.getElementById('pcs'); if (!pcs || !pcs.parentNode) return;
    var sec = document.createElement('div'); sec.id = 'cpPanel'; sec.className = 'cp-panel';
    sec.innerHTML = '<div class="pds-looks-head"><label class="pdfed-ctint-label">Custom Pages <i class="pcs-new">NEW</i></label></div>';
    sec.appendChild(grid('cp-2'));
    var p = document.createElement('p'); p.className = 'pcs-hint'; p.textContent = 'Ready-made pages for proposals, reports and letters. Click one to add it, or drag it onto the page. Every word is normal text you can edit.'; sec.appendChild(p);
    pcs.parentNode.insertBefore(sec, pcs.nextSibling);
  }
  function areaEl() { return document.querySelector('#sec-pdfeditor .pdfed-canvas-area'); }
  function wireDrop() {
    var area = areaEl(); if (!area || area._cpDrop) return; area._cpDrop = true;
    area.addEventListener('dragover', function (e) { var dt = e.dataTransfer; if (dt && Array.prototype.indexOf.call(dt.types || [], MIME) > -1) { e.preventDefault(); e.stopPropagation(); dt.dropEffect = 'copy'; } }, true);
    area.addEventListener('drop', function (e) {
      var dt = e.dataTransfer, raw = dt && dt.getData ? dt.getData(MIME) : ''; if (!raw) return;
      e.preventDefault(); e.stopPropagation(); area.classList.remove('pcs-dragging', 'pdfed-drag-over', 'pdfed-drag-over-page');
      try { applyLayout(+JSON.parse(raw).i); } catch (x) {}
    }, true);
  }
  if (typeof pdfedStudioBuild === 'function') {
    var origBuild = pdfedStudioBuild;
    pdfedStudioBuild = function () { var r = origBuild.apply(this, arguments); if (r) injectPanel(); return r; };
  }
  try { injectEmpty(); injectPanel(); wireDrop(); } catch (e) { console.warn('[custom pages] setup', e); }
  // ─── Kadessa: she can pick a Custom Page by reading the person's business ───
  // Same tool as Canvas Styles (pdfed_pick_canvas_style): when `style` is the exact name of a Custom Page, it runs here.
  // Rules that never depend on a model's mood: serious content never gets a bold page; a Custom Page is a STARTING page, so it only
  // goes on an empty page (a page that already holds the person's own content keeps it).
  // tone = light or dark page, g = gravity (calm, neutral, bold), use = what it suits.
  var NOTES = {
    'Proposal Cover': ['light', 'neutral', 'business proposals, quotations, service offers, agencies, consultants'],
    'Report Band': ['light', 'calm', 'annual reports, finance, compliance, audits, formal corporate summaries'],
    'Side Bar': ['light', 'calm', 'project briefs, company profiles, CVs, consulting, education, formal documents'],
    'Split Page': ['light', 'neutral', 'project plans, offers, marketing plans, retail, food, friendly business'],
    'Circle Burst': ['light', 'bold', 'startups, greetings, creative work, launches, social posts, events, kids'],
    'Diamond Row': ['light', 'calm', 'jewellery, boutiques, luxury goods, interiors, invitations, premium services'],
    'Hex Hero': ['dark', 'neutral', 'tech, IT, engineering, science, manufacturing, data, B2B'],
    'Gold Frame': ['dark', 'neutral', 'luxury, jewellery, premium showrooms, awards, certificates, galas'],
    'Mint Cards': ['light', 'calm', 'wellness, clinics, pharmacy, eco and solar, education, three-point summaries'],
    'Bold Stripe': ['light', 'neutral', 'pitches, agencies, campaigns, sales, training, ideas'],
    'Growth': ['light', 'neutral', 'finance, growth plans, investment, consulting, banks, annual plans'],
    'Photo Hero': ['light', 'neutral', 'portfolios, real estate, travel, product showcase, photography, interiors (the person adds a photo)'],
    'Sunset Rings': ['dark', 'bold', 'music, parties, entertainment, creative studios, night events'],
    'Minimal Lines': ['light', 'calm', 'legal, architecture, design studios, editorial, minimal formal documents'],
    'Pink Blocks': ['light', 'bold', 'fashion, beauty, salons, youth brands, festive offers, social posts'],
    'Ribbon': ['light', 'neutral', 'reports, news, retail offers, quotations, year in review'],
    'Inset Frame': ['light', 'calm', 'certificates, formal letters, invitations, eco, education, health, official pages'],
    'Square Border': ['light', 'neutral', 'education, kids, creative work, agencies, community, tutorials'],
    'Ocean Glass': ['dark', 'neutral', 'travel, water, shipping, hospitality, resorts, IT, trust and finance'],
    'Sun Header': ['light', 'bold', 'bakeries, cafes, food, kids, friendly shops, festive offers, greetings'],
    'Letterhead': ['light', 'calm', 'official letters, notices, HR, legal, any formal business letter'],
    'Magazine': ['dark', 'neutral', 'editorials, newsletters, brand stories, fashion, blogs, press kits']
  };
  var CALM_TWIN = 'Report Band';
  function idxOf(name) {
    var q = String(name || '').trim().toLowerCase(), r = -1;
    LAYOUTS.forEach(function (l, i) { if (l.n.toLowerCase() === q) r = i; });
    return r;
  }
  function ownContent(pg) {
    var t = ((pg && pg.placedTexts) || []).filter(function (x) { return !x._cpText && !x._pcsText; }).length;
    var im = ((pg && pg.placedImages) || []).filter(function (x) { return !x._pcs; }).length;
    return t + im + ((pg && pg.placedTables) || []).length;
  }
  if (typeof window.kadessaCanvasStyleContext === 'function') {
    var origCtx = window.kadessaCanvasStyleContext;
    window.kadessaCanvasStyleContext = function () {
      var r = origCtx.apply(this, arguments); if (!r) return r;
      r.customPages = LAYOUTS.map(function (l) { var n = NOTES[l.n] || []; return { name: l.n, tone: n[0], gravity: n[1], bestFor: n[2] }; });
      r.customPagesNote = 'Custom Pages are ready-made STARTING pages (colour blocks, shapes and sample words, all editable). Pass the exact name as style, plus a real title from the content. Use one for an empty page when the person wants a finished-looking document such as a proposal, report, letter, brochure or poster. Use a Background instead when the page already has their content. The sample words must then be replaced with the real details.';
      return r;
    };
  }
  if (typeof window.kadessaPickCanvasStyle === 'function') {
    var origPick = window.kadessaPickCanvasStyle;
    window.kadessaPickCanvasStyle = function (p) {
      p = p || {};
      var st = window.pdfedCanvasStyles, name = String(p.style || '').trim(), i = idxOf(name);
      var builtIn = false;
      try { builtIn = !!(window.__kcsTest && window.__kcsTest.resolve(name, 'premium') && [].concat(st.bg, st.frames).some(function (b) { return b.n.toLowerCase() === name.toLowerCase(); })); } catch (e) {}
      if (i < 0 || builtIn) return origPick.apply(this, arguments);
      return (async function () {
        var notes = [], l = LAYOUTS[i], n = NOTES[l.n] || [];
        var pg = docOpen() ? pdfed.pages[pdfed.active] : null;
        if (Array.isArray(p.pages) && p.pages.length && pg) {
          var want = parseInt(p.pages[0], 10);
          if (want >= 1 && want <= pdfed.pages.length && want - 1 !== pdfed.active) { await pdfedGoto(want - 1); pg = pdfed.pages[pdfed.active]; }
        }
        if (p.pages === 'all' || (Array.isArray(p.pages) && p.pages.length > 1)) notes.push('a Custom Page goes on one page, so it was placed on one page only');
        if (pg && ownContent(pg)) throw new Error('this page already holds content. A Custom Page is a starting page for an empty page, so nothing was changed. Use a plain Background for this page instead');
        if (p.gravity === 'serious' && n[1] === 'bold') { notes.push('the content is serious, so ' + CALM_TWIN + ' was used instead of ' + l.n); i = idxOf(CALM_TWIN); l = LAYOUTS[i]; }
        var title = String(p.title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        var ok = await applyLayout(i, { title: title });
        if (!ok) throw new Error('the Custom Page could not be placed (the page may be locked or busy), nothing was changed');
        var out = { applied: [{ page: docOpen() ? pdfed.active + 1 : 1, style: l.n, kind: 'custom page' }], note: 'The sample words on the page are placeholders. Replace them with the real details.' };
        if (title) out.titleSet = title;
        if (notes.length) out.notes = notes;
        return out;
      })();
    };
  }

  window.pdfedCustomPages = { notes: NOTES, layouts: LAYOUTS, apply: applyLayout, thumb: thumb, paintBg: paintBg };
})();
