// ─── MAKE FORMS: SPLIT WIPE THEME ───
// Template "splitwipe" (see js/74): form on the left, the Gallery images wipe on the right, and the form half
// takes the colour of each picture. Nothing for the form owner to set: the wipe is part of the theme.
// Images come from the Gallery section (js/79). With none, four bright sample panels are shown.
// Respondent page has its own copy of the engine (forms-page/index.html, search for "spw").
// ─── SPLIT WIPE ENGINE (theme "splitwipe") ───
// Half the screen is the form, the other half shows the owner's gallery images. Every time the person moves to
// another question the picture changes with a wipe (the theme cycles sideways, diagonal, upward and circle by
// itself: nobody picks it), and the form half is repainted in the main colour of the picture, with the same wipe.
// The same engine lives in js/100-make-forms-split.js (Live Preview) and forms-page/index.html (public page): keep them in step.
// Without images it shows four bright sample colour panels. Animation off (or "reduce motion") = instant change, no motion.
function spwMkCol(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, d = mx - mn;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  var s = Math.max(72, Math.min(95, Math.round((d ? d / (1 - Math.abs(mx + mn - 1)) : 0) * 100 + 30))), H = Math.round(h);
  return { a: 'hsl(' + H + ',' + s + '%,47%)', b: 'hsl(' + ((H + 22) % 360) + ',' + s + '%,40%)', c: 'hsl(' + ((H + 338) % 360) + ',' + s + '%,60%)' };
}
function spwColorOf(it, cb) {
  if (it.col) return cb();
  var im = new Image();
  im.onload = function () {
    it.iw = im.naturalWidth || 3; it.ih = im.naturalHeight || 4;
    try {
      var cv = document.createElement('canvas'); cv.width = cv.height = 24;
      var x = cv.getContext('2d'); x.drawImage(im, 0, 0, 24, 24);
      var d = x.getImageData(0, 0, 24, 24).data, r = 0, g = 0, b = 0, w = 0;
      for (var k = 0; k < d.length; k += 4) {
        var wt = .15 + (Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2])) / 255;
        r += d[k] * wt; g += d[k + 1] * wt; b += d[k + 2] * wt; w += wt;
      }
      it.col = spwMkCol(r / w, g / w, b / w);
    } catch (e) { it.col = spwMkCol(40, 190, 100); }
    // tiny copy of the picture (aspect kept): enlarged behind the real picture it becomes a soft blurred backdrop, with no live blur filter
    try {
      var iw = im.naturalWidth || 1, ih = im.naturalHeight || 1, sc = 48 / Math.max(iw, ih);
      var tw = Math.max(8, Math.round(iw * sc)), th = Math.max(8, Math.round(ih * sc));
      var tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
      tc.getContext('2d').drawImage(im, 0, 0, tw, th); it.thumb = tc.toDataURL('image/jpeg', .7);
    } catch (e2) { it.thumb = ''; }
    cb();
  };
  im.onerror = function () { it.iw = 3; it.ih = 4; it.col = spwMkCol(40, 190, 100); cb(); };
  im.src = it.src;
}
function spwSamples() {
  var mk = function (c1, c2, c3) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><g fill="' + c3 + '" opacity=".35"><circle cx="620" cy="260" r="210"/><circle cx="180" cy="720" r="260"/><circle cx="560" cy="860" r="120"/></g></svg>';
    return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), cap: '' };
  };
  return [mk('#3ddc84', '#00a86b', '#eaffd0'), mk('#ffb02e', '#ff5a1f', '#fff1c2'), mk('#38b6ff', '#4d5bff', '#d6f0ff'), mk('#ff5fa2', '#ff8a3d', '#ffe0f0')];
}
// ─── SLATS and ARCHES (themes "slats" and "arches") ───
function spwFrame(root) {
  var L = document.createElement('div'); L.className = 'spw-l'; L.setAttribute('aria-hidden', 'true');
  var R = document.createElement('div'); R.className = 'spw-r'; R.setAttribute('aria-hidden', 'true');
  R.innerHTML = '<div class="spw-shade"></div><div class="spw-cap"></div><div class="spw-dots"></div>';
  var SP = document.createElement('div'); SP.className = 'spw-sp'; SP.setAttribute('aria-hidden', 'true');
  root.insertBefore(SP, root.firstChild); root.insertBefore(R, root.firstChild); root.insertBefore(L, root.firstChild);
  root.setAttribute('data-split', '1');
  var f = { R: R, cap: R.querySelector('.spw-cap'), dots: R.querySelector('.spw-dots') };
  f.paint = function (list, i) {
    f.cap.textContent = list[i].cap || '';
    if (list.length < 2) { f.dots.innerHTML = ''; return; }
    var h = ''; for (var k = 0; k < list.length; k++) h += '<i' + (k === i ? ' class="on"' : '') + '></i>';
    f.dots.innerHTML = h;
  };
  f.kill = function () { [L, R, SP].forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); if (root.getAttribute('data-split')) root.removeAttribute('data-split'); };
  return f;
}
function spwSamplesSl() {
  var P = [['#ffb27a', '#4b2a6b', '#ffe2b0', 'Dawn. The first hour it already pays you back.'], ['#7cc4f2', '#1d5aa8', '#fff7d6', 'Noon. Full output, zero noise.'], ['#ff8a5c', '#2a2250', '#ffc58a', 'Dusk. Stored, not wasted.']];
  return P.map(function (p) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p[1] + '"/><stop offset=".75" stop-color="' + p[0] + '"/></linearGradient><radialGradient id="r"><stop offset="0" stop-color="' + p[2] + '"/><stop offset="1" stop-color="' + p[2] + '" stop-opacity="0"/></radialGradient></defs><rect width="600" height="800" fill="url(#a)"/><circle cx="440" cy="250" r="230" fill="url(#r)"/><circle cx="440" cy="250" r="46" fill="' + p[2] + '"/><rect y="690" width="600" height="110" fill="#0d1624"/><polygon points="120,470 500,470 560,690 60,690" fill="#14284a"/><polygon points="120,470 500,470 560,690 60,690" fill="none" stroke="#c8d6ea" stroke-width="5"/><polygon points="120,470 300,470 230,690 60,690" fill="#fff" fill-opacity=".12"/></svg>';
    return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), cap: p[3], iw: 600, ih: 800, full: true, col: { a: p[1], b: p[0] } };
  });
}
function spwSamplesAr() {
  var W = [['#1d2733', '#f4f1ea', 'Ink dial. Brushed case, sapphire glass.', '#2c3e55'], ['#33493c', '#e9efe3', 'Moss dial. Brushed case, sapphire glass.', '#4d7a60'], ['#5a1f33', '#f6e8e6', 'Wine dial. Brushed case, sapphire glass.', '#8a3a55'], ['#d9d2c3', '#2b2b2b', 'Bone dial. Brushed case, sapphire glass.', '#b9ae97']];
  return W.map(function (c) {
    var t = ''; for (var i = 0; i < 12; i++) { var a = i * 30 * Math.PI / 180; t += '<line x1="' + (100 + Math.sin(a) * 74) + '" y1="' + (100 - Math.cos(a) * 74) + '" x2="' + (100 + Math.sin(a) * (i % 3 ? 82 : 90)) + '" y2="' + (100 - Math.cos(a) * (i % 3 ? 82 : 90)) + '" stroke="' + c[1] + '" stroke-width="' + (i % 3 ? 2 : 4) + '"/>'; }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 360"><rect x="62" y="0" width="76" height="120" rx="14" fill="#222"/><rect x="62" y="240" width="76" height="120" rx="14" fill="#222"/><circle cx="100" cy="180" r="94" fill="#c9a45c"/><g transform="translate(0 80)"><circle cx="100" cy="100" r="86" fill="' + c[0] + '"/>' + t + '<line x1="100" y1="100" x2="100" y2="48" stroke="' + c[1] + '" stroke-width="5" stroke-linecap="round"/><line x1="100" y1="100" x2="136" y2="116" stroke="#c9a45c" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="100" r="6" fill="#c9a45c"/></g></svg>';
    return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), cap: c[2], iw: 200, ih: 360, col: { a: c[3], b: '#0d1a1a' } };
  });
}
function spwNorm(items, fallback) {
  return (items && items.length ? items : fallback()).map(function (x) { return { src: x.src, cap: x.cap || '', col: x.col, iw: x.iw, ih: x.ih, full: x.full }; });
}
function spwSlats(root, items, o) {
  var f = spwFrame(root), R = f.R, N = 7;
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || o.anim === false;
  var list = spwNorm(items, spwSamplesSl), n = list.length;
  var strip = document.createElement('div'); strip.className = 'spw-sls';
  var h = ''; for (var q = 0; q < N; q++) h += '<div class="spw-sl"><i></i><i></i></div>';
  strip.innerHTML = h; R.insertBefore(strip, R.firstChild);
  var sl = strip.querySelectorAll('.spw-sl');
  var cur = -1, rot = 0, busy = false, pend = null, base = 0, off = 0, timer = null, dead = false;
  function face(el, k, it) {
    // every picture is shown whole: one big picture on a colour stage, cut into slats
    var W = R.clientWidth || 600, H = R.clientHeight || 700, SW = W / N, iw = it.iw || 3, ih = it.ih || 4;
    var s = it.full ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih) * .84, sw = iw * s, sh = ih * s;
    var ox = (W - sw) / 2, oy = (H - sh) / 2 - (it.full ? 0 : H * .05), c = it.col || { a: '#2a1236', b: '#9a5578' };
    el.style.backgroundImage = 'url("' + it.src + '"),radial-gradient(80% 60% at 20% 10%,' + c.a + ',transparent),linear-gradient(165deg,' + c.b + ',' + c.a + ')';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = sw + 'px ' + sh + 'px,' + W + 'px ' + H + 'px,' + W + 'px ' + H + 'px';
    el.style.backgroundPosition = (ox - k * SW) + 'px ' + oy + 'px,' + (-k * SW) + 'px 0,' + (-k * SW) + 'px 0';
  }
  function show(i) {
    if (dead || !n) return;
    i = ((i % n) + n) % n;
    if (i === cur) return;
    if (busy) { pend = i; return; }
    busy = true;
    spwColorOf(list[i], function () {
      if (dead) return;
      var fs, hid = rot % 2 ? 0 : 1;
      if (cur < 0 || still) {
        sl.forEach(function (s, k) { fs = s.querySelectorAll('i'); s.style.transition = 'none'; face(fs[0], k, list[i]); face(fs[1], k, list[i]); });
        cur = i; f.paint(list, i); busy = false;
        if (pend !== null) { var p0 = pend; pend = null; show(p0); }
        return;
      }
      sl.forEach(function (s, k) {
        fs = s.querySelectorAll('i'); face(fs[hid], k, list[i]);
        s.style.transition = 'transform 1s cubic-bezier(.6,0,.2,1) ' + (k * 80) + 'ms';
        s.style.transform = 'rotateY(' + ((rot + 1) * 180) + 'deg)';
      });
      rot++; cur = i; f.paint(list, i);
      setTimeout(function () { busy = false; if (pend !== null && !dead) { var p = pend; pend = null; show(p); } }, 1700);
    });
  }
  function relayout() { if (cur < 0) return; sl.forEach(function (s, k) { face(s.querySelectorAll('i')[rot % 2], k, list[cur]); }); }
  window.addEventListener('resize', relayout);
  function typing() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value && a.value.length); }
  if (!still && n > 1) timer = setInterval(function () { if (!document.hidden && !typing() && !busy) { off++; show(base + off); } }, 6000);
  return { at: function (si) { base = si || 0; show(base + off); }, destroy: function () { dead = true; if (timer) clearInterval(timer); window.removeEventListener('resize', relayout); f.kill(); } };
}
function spwArches(root, items, o) {
  var f = spwFrame(root), R = f.R;
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || o.anim === false;
  var list = spwNorm(items, spwSamplesAr), n = list.length;
  var tk = document.createElement('div'); tk.className = 'spw-tk';
  tk.innerHTML = list.map(function () { return '<div class="spw-fr"><div class="spw-fi"></div></div>'; }).join('');
  R.insertBefore(tk, R.firstChild);
  var fr = tk.querySelectorAll('.spw-fr'), cur = -1, base = 0, off = 0, timer = null, dead = false;
  list.forEach(function (it, k) {
    fr[k].firstChild.style.backgroundImage = 'url("' + it.src + '")';
    spwColorOf(it, function () { if (!dead && it.col) fr[k].style.background = 'linear-gradient(170deg,' + it.col.a + ',' + it.col.b + ')'; });
  });
  function place(jump) {
    if (cur < 0) return;
    var a = fr[cur], w = R.clientWidth;
    if (jump) tk.style.transition = 'none';
    tk.style.transform = 'translateX(' + (w / 2 - (a.offsetLeft + a.offsetWidth / 2)) + 'px)';
    if (jump) { void tk.offsetWidth; tk.style.transition = ''; }
  }
  function show(i) {
    if (dead || !n) return;
    i = ((i % n) + n) % n;
    if (i === cur) return;
    var first = cur < 0;
    cur = i; fr.forEach(function (x, k) { x.classList.toggle('on', k === i); });
    place(first || still); f.paint(list, i);
  }
  function relayout() { place(true); }
  window.addEventListener('resize', relayout);
  function typing() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value && a.value.length); }
  if (!still && n > 1) timer = setInterval(function () { if (!document.hidden && !typing()) { off++; show(base + off); } }, 6000);
  return { at: function (si) { base = si || 0; show(base + off); }, destroy: function () { dead = true; if (timer) clearInterval(timer); window.removeEventListener('resize', relayout); f.kill(); } };
}
function spwSamplesSc() {
  // Premium showcase: a glass bottle on a deep colour stage (used until the owner adds product pictures to the Gallery).
  var mk = function (liq, deep, cap, st) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 380"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient><linearGradient id="q" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + liq + '"/><stop offset="1" stop-color="' + deep + '"/></linearGradient><linearGradient id="d" x1="0" x2="1"><stop offset="0" stop-color="#8a6230"/><stop offset=".45" stop-color="#f0d29a"/><stop offset="1" stop-color="#9c7138"/></linearGradient><clipPath id="c"><rect x="30" y="118" width="140" height="236" rx="30"/></clipPath></defs><rect x="70" y="8" width="60" height="64" rx="10" fill="url(#d)"/><rect x="62" y="64" width="76" height="22" rx="6" fill="url(#d)"/><rect x="82" y="84" width="36" height="40" fill="#fff" fill-opacity=".25"/><rect x="30" y="118" width="140" height="236" rx="30" fill="#fff" fill-opacity=".14"/><g clip-path="url(#c)"><rect x="30" y="170" width="140" height="190" fill="url(#q)"/><rect x="52" y="214" width="96" height="104" rx="6" fill="#fff" fill-opacity=".92"/><text x="100" y="252" text-anchor="middle" font-family="Georgia,serif" font-size="17" fill="#241530">Brand</text><text x="100" y="276" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="22" fill="#241530">Product</text><rect x="76" y="290" width="48" height="1.5" fill="#b98a4e"/></g><rect x="30" y="118" width="140" height="236" rx="30" fill="url(#g)"/><rect x="30" y="118" width="140" height="236" rx="30" fill="none" stroke="#fff" stroke-opacity=".45"/></svg>';
    return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), cap: cap, col: st };
  };
  return [
    mk('#f6c9a8', '#9a5578', 'Skin that looks rested, not covered.', { a: '#2a1236', b: '#9a5578', c: '#c9809f' }),
    mk('#d9f5e8', '#34978a', 'Water first. Everything else follows.', { a: '#0f3433', b: '#34978a', c: '#5fc4b3' }),
    mk('#ffe3ad', '#cf9450', 'A glow you can see across the room.', { a: '#3d210d', b: '#cf9450', c: '#e6b878' }),
    mk('#e5e7ff', '#7378dc', 'Sleep does half the work. This does the rest.', { a: '#1b2150', b: '#7378dc', c: '#a0a4ee' })
  ];
}
function spwMount(root, items, o) {
  o = o || {};
  if (o.v === 'sl') return spwSlats(root, items, o);
  if (o.v === 'ar') return spwArches(root, items, o);
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var still = calm || o.anim === false;
  var sc = o.v === 'sc';
  var list = (items && items.length ? items : (sc ? spwSamplesSc() : spwSamples())).map(function (x) { return { src: x.src, cap: x.cap || '', col: x.col }; });
  var n = list.length;
  var L = document.createElement('div'); L.className = 'spw-l'; L.setAttribute('aria-hidden', 'true');
  var R = document.createElement('div'); R.className = 'spw-r'; R.setAttribute('aria-hidden', 'true');
  R.innerHTML = '<div class="spw-shade"></div><div class="spw-cap"></div><div class="spw-dots"></div>';
  var SP = document.createElement('div'); SP.className = 'spw-sp'; SP.setAttribute('aria-hidden', 'true');
  root.insertBefore(SP, root.firstChild); root.insertBefore(R, root.firstChild); root.insertBefore(L, root.firstChild);
  root.setAttribute('data-split', '1');
  var capEl = R.querySelector('.spw-cap'), dotsEl = R.querySelector('.spw-dots');
  var cur = -1, busy = false, pend = null, base = 0, off = 0, styleN = 0, timer = null, dead = false;
  var STY = ['right', 'diag', 'up', 'circle'];
  function clips(m) {
    if (m === 'right') return ['inset(0 100% 0 0)', 'inset(0 0 0 0)'];
    if (m === 'up') return ['inset(100% 0 0 0)', 'inset(0 0 0 0)'];
    if (m === 'diag') return ['polygon(0 0,0 0,0 0,0 0)', 'polygon(0 0,260% 0,0 260%,0 0)'];
    return ['circle(0% at 50% 50%)', 'circle(78% at 50% 50%)'];
  }
  function layer(c) {
    var d = document.createElement('div'); d.className = 'spw-ll';
    if (sc) { d.style.background = '#f4f1f6'; return d; }
    d.style.background = 'radial-gradient(80% 60% at 0% 0%,' + c.c + ',transparent),radial-gradient(70% 60% at 100% 100%,rgba(255,255,255,.2),transparent),linear-gradient(160deg,' + c.a + ',' + c.b + ')';
    return d;
  }
  function slide(i) {
    // Every picture is shown WHOLE (never cropped): the real picture sits centred (contain) over a soft enlarged copy of itself.
    var d = document.createElement('div'); d.className = 'spw-s' + (still ? '' : ' kb') + (sc ? ' sc' : '');
    var bd = document.createElement('div'); bd.className = 'spw-bd';
    bd.style.backgroundColor = list[i].col ? list[i].col.b : '#06180e';
    if (sc && list[i].col) bd.style.backgroundImage = 'radial-gradient(80% 60% at 20% 10%,' + list[i].col.a + ',transparent),linear-gradient(165deg,' + list[i].col.b + ',' + list[i].col.a + ')';
    else if (list[i].thumb) bd.style.backgroundImage = 'url("' + list[i].thumb + '")';
    var fg = document.createElement('div'); fg.className = 'spw-fg'; fg.style.backgroundImage = 'url("' + list[i].src + '")';
    d.appendChild(bd); d.appendChild(fg); return d;
  }
  function paint(i) {
    capEl.textContent = list[i].cap || '';
    if (n < 2) { dotsEl.innerHTML = ''; return; }
    var h = ''; for (var k = 0; k < n; k++) h += '<i' + (k === i ? ' class="on"' : '') + '></i>';
    dotsEl.innerHTML = h;
  }
  function show(i) {
    if (dead || !n) return;
    i = ((i % n) + n) % n;
    if (i === cur) return;
    if (busy) { pend = i; return; }
    busy = true;
    spwColorOf(list[i], function () {
      if (dead) return;
      var s = slide(i), l = layer(list[i].col), olds = R.querySelectorAll('.spw-s'), oldl = L.querySelectorAll('.spw-ll');
      if (cur < 0 || still) {
        olds.forEach(function (x) { x.remove(); }); oldl.forEach(function (x) { x.remove(); });
        R.insertBefore(s, R.firstChild); L.appendChild(l); cur = i; paint(i); busy = false;
        if (pend !== null) { var p = pend; pend = null; show(p); }
        return;
      }
      var c = clips(STY[styleN++ % STY.length]), tr = 'clip-path .9s cubic-bezier(.7,0,.2,1),-webkit-clip-path .9s cubic-bezier(.7,0,.2,1)';
      [s, l].forEach(function (x) { x.style.clipPath = c[0]; x.style.webkitClipPath = c[0]; });
      R.insertBefore(s, R.querySelector('.spw-shade')); L.appendChild(l);
      void s.offsetWidth;
      [s, l].forEach(function (x) { x.style.transition = tr; x.style.clipPath = c[1]; x.style.webkitClipPath = c[1]; });
      cur = i; paint(i);
      setTimeout(function () {
        olds.forEach(function (x) { x.remove(); }); oldl.forEach(function (x) { x.remove(); });
        [s, l].forEach(function (x) { x.style.transition = ''; x.style.clipPath = 'none'; x.style.webkitClipPath = 'none'; });
        busy = false;
        if (pend !== null && !dead) { var p = pend; pend = null; show(p); }
      }, 950);
    });
  }
  function typing() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value && a.value.length); }
  if (!still && n > 1) timer = setInterval(function () { if (!document.hidden && !typing() && !busy) { off++; show(base + off); } }, 6000);
  return {
    // The picture follows the screen: question number = picture number (so Back goes back too).
    at: function (screenIndex) { base = screenIndex || 0; show(base + off); },
    destroy: function () {
      dead = true; if (timer) clearInterval(timer);
      [L, R, SP].forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
      if (root.getAttribute('data-split')) root.removeAttribute('data-split');
    }
  };
}

(function () {
  function spOn(f) {
    var t = window.mfTplGet && f ? window.mfTplGet(f.formTemplate) : null;
    return !!(t && t.sp && f.formStyle === 'guided');
  }
  window.mfSplitOn = spOn;
  var baseScreens = window.mfGdScreens, baseRender = window.mfGdRender;
  // The split layout has no separate gallery screen: the pictures are always beside the questions.
  window.mfGdScreens = function (f) {
    var s = baseScreens(f);
    return spOn(f) ? s.filter(function (x) { return x.t !== 'gallery'; }) : s;
  };
  window.mfGdRender = function () {
    baseRender.apply(this, arguments);
    var ov = document.getElementById('mfGdOverlay'), f = window.mfGetCurrentForm && window.mfGetCurrentForm();
    if (!ov || !f) return;
    if (!spOn(f)) { if (ov._spw) { ov._spw.destroy(); ov._spw = null; ov._spwSig = ''; } return; }
    var its = typeof window.mfGalItems === 'function' ? window.mfGalItems(f) : [];
    var tv = (window.mfTplGet(f.formTemplate) || {}).spv || '';
    var sig = its.map(function (i) { return i.src; }).join('|') + '|' + (f.tplAnim !== false) + '|' + tv;
    if (ov._spw && ov._spwSig !== sig) { ov._spw.destroy(); ov._spw = null; }
    if (!ov._spw) { ov._spw = spwMount(ov, its, { anim: f.tplAnim !== false, v: tv }); ov._spwSig = sig; }
    ov._spw.at(window.mfGd.done ? 99 : window.mfGd.i);
  };
})();
