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
    cb();
  };
  im.onerror = function () { it.col = spwMkCol(40, 190, 100); cb(); };
  im.src = it.src;
}
function spwSamples() {
  var mk = function (c1, c2, c3) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><g fill="' + c3 + '" opacity=".35"><circle cx="620" cy="260" r="210"/><circle cx="180" cy="720" r="260"/><circle cx="560" cy="860" r="120"/></g></svg>';
    return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), cap: '' };
  };
  return [mk('#3ddc84', '#00a86b', '#eaffd0'), mk('#ffb02e', '#ff5a1f', '#fff1c2'), mk('#38b6ff', '#4d5bff', '#d6f0ff'), mk('#ff5fa2', '#ff8a3d', '#ffe0f0')];
}
function spwMount(root, items, o) {
  o = o || {};
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var still = calm || o.anim === false;
  var list = (items && items.length ? items : spwSamples()).map(function (x) { return { src: x.src, cap: x.cap || '' }; });
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
    d.style.background = 'radial-gradient(80% 60% at 0% 0%,' + c.c + ',transparent),radial-gradient(70% 60% at 100% 100%,rgba(255,255,255,.2),transparent),linear-gradient(160deg,' + c.a + ',' + c.b + ')';
    return d;
  }
  function slide(i) {
    var d = document.createElement('div'); d.className = 'spw-s' + (still ? '' : ' kb');
    d.style.backgroundImage = 'url("' + list[i].src + '")'; return d;
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
    var sig = its.map(function (i) { return i.src; }).join('|') + '|' + (f.tplAnim !== false);
    if (ov._spw && ov._spwSig !== sig) { ov._spw.destroy(); ov._spw = null; }
    if (!ov._spw) { ov._spw = spwMount(ov, its, { anim: f.tplAnim !== false }); ov._spwSig = sig; }
    ov._spw.at(window.mfGd.done ? 99 : window.mfGd.i);
  };
})();
