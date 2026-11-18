// ─── Kadessa Hands On Canvas Styles (build 300+) ───
// Kadessa can now choose the page background (and Photo Frame) for the user, from the 10 Backgrounds and 10 Photo Frames
// that js/90-pdfed-canvas-styles.js already draws. She makes the CHOICE by reading the content (the model does that, guided by
// the CANVAS STYLE JUDGMENT paragraph in the Worker). This file does two jobs:
//   1. Tells her what is in the catalogue and what the page holds right now (window.kadessaCanvasStyleContext).
//   2. Runs her choice (window.kadessaPickCanvasStyle) and enforces the rules that must never depend on a model's mood:
//        - GRAVITY: if she says the content is serious (legal, medical, finance, condolence, notice, official), a loud style is
//          swapped for a calm one, and she is told which.
//        - FRAME NEEDS A REAL TITLE: a Photo Frame ships with placeholder words ("The Wedding Day"). A frame is only placed when she
//          gives a real title, and only on a page that has no content of its own yet. Otherwise a matching plain background is used.
//        - LEGIBILITY: after a dark or light background lands, any text box whose colour would disappear is recoloured, and the
//          recolour is its own undo step.
// Nothing in js/90 or js/19 is edited. js/90 must load first (it does, 90 before 92).
(function () {
  // Notes per style, SAME ORDER as BG and FR in js/90. g = gravity: calm | neutral | bold. twin = the plain background used when a frame cannot be used.
  var BGN = [
    { tone: 'dark', g: 'bold', use: 'tech, startups, AI, creative studios, night events' },
    { tone: 'dark', g: 'neutral', use: 'corporate blue, IT, finance, trust, reports' },
    { tone: 'light', g: 'bold', use: 'festive, travel, lifestyle, sale posts, warm and happy' },
    { tone: 'dark', g: 'neutral', use: 'luxury, jewellery, cars, premium showrooms, invitations' },
    { tone: 'dark', g: 'bold', use: 'entertainment, gaming, music, bold creative posts' },
    { tone: 'light', g: 'calm', use: 'weddings, proposals, formal letters, elegant quotes' },
    { tone: 'dark', g: 'neutral', use: 'nature, wellness, solar, eco, growth and finance' },
    { tone: 'light', g: 'calm', use: 'skincare, beauty, education, soft and clean pages' },
    { tone: 'dark', g: 'bold', use: 'romantic, fashion, evening events, beauty launches' },
    { tone: 'light', g: 'calm', use: 'food, skincare, friendly offers, lifestyle, soft menus' }
  ];
  var FRN = [
    { tone: 'light', g: 'calm', photos: 2, twin: 5, use: 'wedding, engagement, family, personal story' },
    { tone: 'dark', g: 'bold', photos: 3, twin: 0, use: 'party, night event, tech meetup, music' },
    { tone: 'light', g: 'calm', photos: 2, twin: 5, use: 'couple, anniversary, two-person story' },
    { tone: 'dark', g: 'neutral', photos: 3, twin: 3, use: 'portfolio, fashion story, brand story' },
    { tone: 'dark', g: 'neutral', photos: 3, twin: 1, use: 'travel, summer edit, corporate event recap' },
    { tone: 'dark', g: 'neutral', photos: 2, twin: 6, use: 'resort, weekend away, nature, solar site visit' },
    { tone: 'light', g: 'calm', photos: 3, twin: 7, use: 'gallery, product trio, real estate, three moments' },
    { tone: 'light', g: 'calm', photos: 2, twin: 7, use: 'baby, beauty, soft memories, skincare story' },
    { tone: 'dark', g: 'neutral', photos: 3, twin: 1, use: 'product launch, corporate feature, showroom reveal' },
    { tone: 'dark', g: 'neutral', photos: 2, twin: 3, use: 'golden hour, food, auto, craft, workshop' }
  ];
  var CALM_DARK = 1, CALM_LIGHT = 5; // Mesh Ocean, Champagne: what a loud style is swapped for on serious content
  var Q = Promise.resolve();

  function S() { return window.pdfedCanvasStyles; }
  function lum(hex) { var x = String(hex || '#000000').replace('#', ''); if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2]; return (parseInt(x.slice(0, 2), 16) * 299 + parseInt(x.slice(2, 4), 16) * 587 + parseInt(x.slice(4, 6), 16) * 114) / 1000 || 0; }
  function plain(h) { return String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function enqueue(fn) { var r = Q.then(fn); Q = r.catch(function () {}); return r; }
  function isStyleObj(o) { return !!(o && (o._pcs || o._pcsText)); }

  // What the page holds that is NOT a style object. Drives the frame rule and the context Kadessa reads.
  function profile(pg) {
    var texts = ((pg && pg.placedTexts) || []).filter(function (t) { return !isStyleObj(t); });
    var images = ((pg && pg.placedImages) || []).filter(function (t) { return !isStyleObj(t); });
    var tables = (pg && pg.placedTables) || [];
    var chars = texts.reduce(function (n, t) { return n + plain(t.text || t.html).length; }, 0);
    var dark = 0, light = 0;
    texts.forEach(function (t) { if (t.gradient) return; (lum(t.color) < 128 ? dark++ : light++); });
    return { texts: texts.length, chars: chars, images: images.length, tables: tables.length,
      textTone: !dark && !light ? 'none' : dark && light ? 'mixed' : dark ? 'dark' : 'light',
      hasStyle: !!((pg && pg.placedImages) || []).some(function (i) { return i._pcs; }) };
  }
  function busy(pr) { return pr.texts > 0 || pr.images > 0 || pr.tables > 0; }

  // ─── What Kadessa is told (added to the PDF Editor context by js/51) ───
  window.kadessaCanvasStyleContext = function () {
    var st = S(); if (!st || !st.bg || !st.frames) return undefined;
    var pr = null;
    try { if (typeof pdfed !== 'undefined' && pdfed.pages && pdfed.pages.length) pr = profile(pdfed.pages[pdfed.active]); } catch (e) {}
    return {
      backgrounds: st.bg.map(function (b, i) { var n = BGN[i] || {}; return { name: b.n, tone: n.tone, gravity: n.g, bestFor: n.use }; }),
      photoFrames: st.frames.map(function (f, i) { var n = FRN[i] || {}; return { name: f.n, tone: n.tone, gravity: n.g, photoBoxes: n.photos, bestFor: n.use }; }),
      openPage: pr
    };
  };

  function resolve(name) {
    var st = S(), q = String(name || '').trim().toLowerCase(), hit = null;
    if (!q || !st) return null;
    [['bg', st.bg], ['fr', st.frames]].forEach(function (pair) {
      pair[1].forEach(function (it, i) { if (!hit && it.n.toLowerCase() === q) hit = { k: pair[0], i: i }; });
    });
    if (!hit) [['bg', st.bg], ['fr', st.frames]].forEach(function (pair) {
      pair[1].forEach(function (it, i) { if (!hit && (it.n.toLowerCase().indexOf(q) > -1 || q.indexOf(it.n.toLowerCase()) > -1)) hit = { k: pair[0], i: i }; });
    });
    return hit;
  }
  function meta(h) { return h.k === 'bg' ? BGN[h.i] : FRN[h.i]; }
  function nameOf(h) { return h.k === 'bg' ? S().bg[h.i].n : S().frames[h.i].n; }

  function pagesFrom(p) {
    var n = pdfed.pages.length, out = [];
    if (p.pages === 'all') { for (var i = 0; i < n; i++) out.push(i); return out.slice(0, 20); }
    if (Array.isArray(p.pages) && p.pages.length) {
      p.pages.forEach(function (v) { v = parseInt(v, 10); if (v >= 1 && v <= n && out.indexOf(v - 1) < 0) out.push(v - 1); });
      return out;
    }
    return [pdfed.active];
  }

  // Recolour text boxes whose colour would vanish on the new background. Returns how many it changed (or 0).
  function fixContrast(pg, tone) {
    var changed = [];
    ((pg && pg.placedTexts) || []).forEach(function (t) {
      if (isStyleObj(t) || t.gradient) return;
      var l = lum(t.color), to = null;
      if (tone === 'dark' && l < 110) to = '#F5F5F5';
      else if (tone === 'light' && l > 170) to = '#1F2937';
      if (!to) return;
      changed.push({ t: t, from: t.color, to: to });
    });
    function paint(list, key) {
      list.forEach(function (c) {
        c.t.color = c[key];
        try { var el = typeof pdfedKadessaTextContentEl === 'function' ? pdfedKadessaTextContentEl(c.t) : null; if (el) el.style.color = c[key]; } catch (e) {}
      });
    }
    if (!changed.length) return 0;
    paint(changed, 'to');
    var at = pdfed.pages.indexOf(pg);
    try { if (typeof pdfedRenderPlacedTexts === 'function') pdfedRenderPlacedTexts(at); pdfedMarkModified(at); } catch (e) {}
    try {
      if (typeof pushAppHistory === 'function') pushAppHistory({
        label: 'Fix text colour for the new background',
        undo: async function () { paint(changed, 'from'); var a = pdfed.pages.indexOf(pg); if (a > -1) { try { pdfedRenderPlacedTexts(a); pdfedMarkModified(a); } catch (e) {} } },
        redo: async function () { paint(changed, 'to'); var a = pdfed.pages.indexOf(pg); if (a > -1) { try { pdfedRenderPlacedTexts(a); pdfedMarkModified(a); } catch (e) {} } }
      });
    } catch (e) {}
    return changed.length;
  }

  function setFrameWords(pg, title, caption) {
    var at = pdfed.pages.indexOf(pg), did = false;
    (pg.placedTexts || []).forEach(function (t) {
      if (t._pcsText === 'title' && title) { t.text = title; did = true; }
      if (t._pcsText === 'cap' && caption) { t.text = caption; did = true; }
    });
    if (did) { try { pdfedRenderPlacedTexts(at); pdfedMarkModified(at); } catch (e) {} }
  }

  async function run(p) {
    p = p || {};
    var st = S();
    if (!st || typeof st.apply !== 'function') throw new Error('the canvas styles are not loaded yet');
    var want = resolve(p.style);
    if (!want) throw new Error('there is no canvas style called "' + p.style + '". Choose one of: ' + st.bg.map(function (b) { return b.n; }).concat(st.frames.map(function (f) { return f.n; })).join(', '));
    var gravity = (p.gravity === 'serious' || p.gravity === 'festive') ? p.gravity : 'neutral';
    var title = plain(p.title).slice(0, 60), caption = plain(p.caption).slice(0, 90);
    var emptyEditor = !(typeof pdfed !== 'undefined' && pdfed.pages && pdfed.pages.length);
    var targets = emptyEditor ? [null] : pagesFrom(p);
    if (!targets.length) throw new Error('none of those page numbers exist in this document');
    var origin = emptyEditor ? -1 : pdfed.active, applied = [], notes = [], fixed = 0;

    for (var k = 0; k < targets.length; k++) {
      var idx = targets[k], pg = emptyEditor ? null : pdfed.pages[idx], h = { k: want.k, i: want.i }, why = [];
      // Rule 1: a frame needs a real title and a page with nothing of its own on it.
      if (h.k === 'fr') {
        if (!title) { why.push('a Photo Frame needs a real title and none was given'); h = { k: 'bg', i: FRN[h.i].twin }; }
        else if (pg && busy(profile(pg))) { why.push('page ' + (idx + 1) + ' already has content, and a frame would sit on top of it'); h = { k: 'bg', i: FRN[h.i].twin }; }
      }
      // Rule 2: serious content never gets a loud style.
      if (gravity === 'serious' && meta(h).g === 'bold') { why.push('the content is serious, so a calmer look was used'); h = { k: 'bg', i: meta(h).tone === 'dark' ? CALM_DARK : CALM_LIGHT }; }
      if (why.length) notes.push((idx == null ? '' : 'Page ' + (idx + 1) + ': ') + 'used ' + nameOf(h) + ' instead of ' + nameOf(want) + ' because ' + why.join(' and ') + '.');

      if (!emptyEditor && pdfed.active !== idx) await pdfedGoto(idx);
      var before = pg ? pg.dataUrl : null;
      await st.apply(h.k, h.i);
      var page = emptyEditor ? pdfed.pages[0] : pg;
      if (!page || (!emptyEditor && page.dataUrl === before)) throw new Error('the style could not be placed on page ' + (idx + 1) + ' (it may be locked or busy), nothing was changed there');
      if (h.k === 'fr' && title) setFrameWords(page, title, caption);
      if (h.k === 'bg') fixed += fixContrast(page, meta(h).tone);
      applied.push({ page: emptyEditor ? 1 : idx + 1, style: nameOf(h) });
    }
    if (!emptyEditor && origin > -1 && pdfed.active !== origin) { try { await pdfedGoto(origin); } catch (e) {} }
    var out = { applied: applied };
    if (notes.length) out.notes = notes;
    if (fixed) out.textColourFixed = fixed;
    if (targets.length > 1) out.undoNote = 'each page is its own undo step (Ctrl+Z once per page)';
    return out;
  }

  window.kadessaPickCanvasStyle = function (p) { return enqueue(function () { return run(p); }); };
  window.kadessaCanvasStyleLabel = function (p) {
    p = p || {};
    var where = p.pages === 'all' ? ' on every page' : (Array.isArray(p.pages) && p.pages.length ? ' on page' + (p.pages.length === 1 ? ' ' + p.pages[0] : 's ' + p.pages.join(', ')) : ' on this page');
    return 'Set the "' + (p.style || 'chosen') + '" canvas style' + where + '.' + (p.reason ? ' ' + String(p.reason).slice(0, 140) : '');
  };
  window.__kcsTest = { profile: profile, resolve: resolve, run: run, fixContrast: fixContrast, BGN: BGN, FRN: FRN };
})();
