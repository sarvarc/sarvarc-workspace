/* ===== MAKE FORMS > GALLERY =====
 * Owners add their own marketing images (any size or shape). Visitors see them in a premium 3D gallery
 * while filling the form: Guided forms show it after the welcome screen and keep it in the corner while
 * people answer; Standard forms show it as a strip above the questions.
 *
 * Data: f.gallery = { on, glow: 'off'|'sub'|'full', title, items: [{ id, cap, r }] } (small, lives with the
 * form). The image data itself lives in IndexedDB (like attachments) so localStorage never fills up.
 * Published as forms.gallery (see supabase/15-form-gallery.sql).
 * Public: window.mfGalleryNode(), window.mfGalPayload(f).  Wraps mfGdScreens / mfGdRender (js/73).
 */
(function () {
  'use strict';
  var MAX = 8, KEY = 'sarvarcFormsGallery';
  var blobs = {}, node = null, shownId = null;

  // ─── GALLERY ENGINE ───
  // Mounts the owner's marketing images on a form root: a soft glow that takes the active image's colours
  // (under the template's own effects), plus a 3D carousel "dock" that is big on the gallery screen and
  // glides into the corner while people answer. Each image keeps its own shape (framed over a blurred copy
  // of itself), so mixed sizes look premium. items = [{ src, cap, r }] (r = width / height).
  // The same engine lives in forms-page/index.html (respondent page) and js/79-make-forms-gallery.js (preview).
  // Speed note: every image becomes a blob URL ONCE (shared, cheap to decode) and a tiny 40px colour thumb is
  // drawn from it. The soft backdrops use that thumb, so the browser never runs a live blur() on a big photo.
  function gxBlobUrl(src) {
    try {
      var c = src.indexOf(','), mime = (src.slice(5, c).split(';')[0]) || 'image/webp';
      var bin = atob(src.slice(c + 1)), len = bin.length, u = new Uint8Array(len);
      for (var i = 0; i < len; i++) u[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([u], { type: mime }));
    } catch (e) { return src; }
  }
  function gxMount(root, items, o) {
    o = o || {};
    var n = items.length, cur = 0, hover = false, drag = null, timer = 0, ai = 0, ro = null, mmRaf = 0, mmE = null;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var urls = items.map(function (m) { return gxBlobUrl(m.src); }), thumbs = [];
    var amb = document.createElement('div'); amb.className = 'gx-amb'; amb.setAttribute('aria-hidden', 'true'); amb.innerHTML = '<i></i><i></i>';
    var dock = document.createElement('div'); dock.className = 'gx-dock ' + (o.strip ? 'gx-strip' : 'gx-hidden');
    dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Image gallery');
    dock.innerHTML = '<div class="gx-stage"></div><div class="gx-cap"><b></b></div><div class="gx-ctrl"><button type="button" class="gx-arrow" aria-label="Previous image">&#8249;</button><div class="gx-dots"></div><button type="button" class="gx-arrow" aria-label="Next image">&#8250;</button></div>';
    root.insertBefore(amb, root.firstChild); root.appendChild(dock);
    root.classList.add('gx-on');
    ['off', 'sub', 'full'].forEach(function (g) { root.classList.remove('gx-g-' + g); });
    root.classList.add('gx-g-' + (o.glow === 'off' || o.glow === 'full' ? o.glow : 'sub'));
    var stage = dock.querySelector('.gx-stage'), dots = dock.querySelector('.gx-dots'), cb = dock.querySelector('.gx-cap b'), ab = amb.children;
    function paintAmb() {
      var t = thumbs[cur]; if (!t) return;
      ai = 1 - ai; ab[ai].style.backgroundImage = 'url("' + t + '")'; ab[ai].classList.add('on'); ab[1 - ai].classList.remove('on');
    }
    function thumb(i, im, bg) {
      try {
        var w = 40, h = Math.max(8, Math.round(w * (im.naturalHeight || 1) / (im.naturalWidth || 1)));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d'); try { x.filter = 'saturate(1.35) brightness(.85)'; } catch (e) {}
        x.drawImage(im, 0, 0, w, h);
        thumbs[i] = c.toDataURL('image/jpeg', 0.7);
      } catch (e) { thumbs[i] = urls[i]; }
      bg.style.backgroundImage = 'url("' + thumbs[i] + '")';
      if (i === cur) paintAmb();
    }
    var slides = items.map(function (m, i) {
      var d = document.createElement('div'); d.className = 'gx-slide';
      var bg = document.createElement('div'); bg.className = 'bg';
      var fg = document.createElement('img'); fg.className = 'fg'; fg.alt = m.cap || ''; fg.draggable = false; fg.decoding = 'async';
      var sh = document.createElement('u'); sh.className = 'shade';
      fg.onload = function () { thumb(i, fg, bg); };
      fg.src = urls[i];
      d.appendChild(bg); d.appendChild(fg); d.appendChild(sh); d._sh = sh;
      d.addEventListener('click', function () { go(i); }); stage.appendChild(d);
      var t = document.createElement('i'); t.addEventListener('click', function () { go(i); }); dots.appendChild(t);
      return d;
    });
    function layout() {
      var SW = stage.clientWidth || 600, SH = stage.clientHeight || 340, CH = Math.min(SH - 56, 340);
      var dim = items.map(function (m) {
        var r = Math.max(0.62, Math.min(1.75, m.r || 0.8)), h = Math.min(CH, Math.sqrt(CH * CH * 0.85 / r)), w = h * r; // equal visual weight for every shape
        if (w > SW * 0.74) { w = SW * 0.74; h = w / r; }
        return [w, h];
      });
      slides.forEach(function (s, i) {
        var d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
        var a = Math.abs(d), x = 0, k = cur;
        for (var t = 0; t < a; t++) { var nx = ((k + (d > 0 ? 1 : -1)) % n + n) % n; x += (dim[k][0] + dim[nx][0]) / 2 * 0.6; k = nx; }
        if (d < 0) x = -x;
        s.style.width = dim[i][0] + 'px'; s.style.height = dim[i][1] + 'px';
        s.style.marginLeft = -dim[i][0] / 2 + 'px'; s.style.top = (SH - dim[i][1]) / 2 - 8 + 'px';
        s.style.transform = 'translateX(' + x + 'px) translateZ(' + (-a * 170) + 'px) rotateY(' + (-d * 34) + 'deg) scale(' + (1 - a * 0.06) + ')';
        s.style.opacity = a > 2 ? 0 : 1 - a * 0.28;
        s._sh.style.opacity = a ? Math.min(0.4, a * 0.16) : 0; // depth by darkening (cheap), not by a live blur filter
        s.classList.toggle('gx-off', a > 2); s.style.zIndex = 10 - a; s.classList.toggle('active', a === 0); s.style.pointerEvents = a > 2 ? 'none' : 'auto';
      });
    }
    function select() {
      layout();
      for (var i = 0; i < dots.children.length; i++) dots.children[i].classList.toggle('on', i === cur);
      paintAmb();
      cb.style.opacity = 0; setTimeout(function () { cb.textContent = items[cur].cap || ''; cb.style.opacity = 1; }, 220);
    }
    function go(i) { cur = (i + n) % n; select(); restart(); }
    function restart() {
      clearInterval(timer);
      if (calm || n < 2) return;
      timer = setInterval(function () {
        if (!root.isConnected) { api.destroy(); return; }
        var ae = document.activeElement; // never animate while someone is typing: keeps typing smooth
        if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
        if (!hover && !document.hidden) go(cur + 1);
      }, 3800);
    }
    var ar = dock.querySelectorAll('.gx-arrow');
    ar[0].addEventListener('click', function () { go(cur - 1); });
    ar[1].addEventListener('click', function () { go(cur + 1); });
    stage.addEventListener('mouseenter', function () { hover = true; });
    stage.addEventListener('mouseleave', function () { hover = false; stage.style.perspectiveOrigin = '50% 45%'; });
    stage.addEventListener('mousemove', function (e) {
      if (calm || dock.classList.contains('gx-docked')) return;
      mmE = e; if (mmRaf) return;
      mmRaf = requestAnimationFrame(function () { // at most one update per frame
        mmRaf = 0; var b = stage.getBoundingClientRect(); if (!mmE || !b.width) return;
        stage.style.perspectiveOrigin = (50 + ((mmE.clientX - b.left) / b.width - 0.5) * 24) + '% ' + (45 + ((mmE.clientY - b.top) / b.height - 0.5) * 16) + '%';
      });
    });
    stage.addEventListener('pointerdown', function (e) { drag = e.clientX; });
    function up(e) {
      if (drag === null) return;
      var dx = e.clientX - drag; drag = null;
      if (!dock.classList.contains('gx-docked') && Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
    }
    document.addEventListener('pointerup', up);
    if (o.onOpen) dock.addEventListener('click', function (e) {
      if (dock.classList.contains('gx-docked')) { e.stopPropagation(); e.preventDefault(); o.onOpen(); }
    }, true);
    if (window.ResizeObserver) { ro = new ResizeObserver(layout); ro.observe(stage); }
    var api = {
      set: function (s) {
        dock.classList.toggle('gx-hidden', s === 'hidden');
        dock.classList.toggle('gx-docked', s === 'docked');
        root.classList.toggle('gx-docked', s === 'docked');
      },
      destroy: function () {
        clearInterval(timer); document.removeEventListener('pointerup', up); if (ro) ro.disconnect();
        if (mmRaf) cancelAnimationFrame(mmRaf);
        urls.forEach(function (u) { if (u && u.indexOf('blob:') === 0) { try { URL.revokeObjectURL(u); } catch (e) {} } });
        if (amb.parentNode) amb.parentNode.removeChild(amb);
        if (dock.parentNode) dock.parentNode.removeChild(dock);
        root.classList.remove('gx-on', 'gx-docked', 'gx-g-off', 'gx-g-sub', 'gx-g-full');
      }
    };
    select(); restart();
    return api;
  }
  

  function esc(s) { return typeof window.mfEsc === 'function' ? window.mfEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cur() { return window.mfGetCurrentForm && window.mfGetCurrentForm(); }
  function G(f, make) { if (!f) return null; if (!f.gallery && make) f.gallery = { on: true, glow: 'sub', title: '', items: [] }; return f.gallery || null; }
  function shape(r) { return !r ? '' : r > 1.15 ? 'Landscape' : r < 0.87 ? 'Portrait' : 'Square'; }
  function say(t) { var m = node && node.querySelector('#mfgMsg'); if (m) m.textContent = t || ''; }
  function toastMsg(t, k) { if (typeof window.toast === 'function') window.toast(t, k || 'info'); }

  // ---- image data in IndexedDB ----
  var ready = Promise.resolve().then(function () { return window.idbKvGet(KEY); })
    .then(function (m) { blobs = m || {}; })
    .catch(function (e) { console.warn('[Make Forms] could not load gallery images', e); })
    .then(function () { render(); refresh(); });
  function persist() {
    try { Promise.resolve(window.idbKvSet(KEY, blobs)).catch(function () { toastMsg('Could not save the gallery images: browser storage may be full', 'error'); }); }
    catch (e) { toastMsg('Could not save the gallery images: browser storage may be full', 'error'); }
  }
  function dropBlob(id) {
    var used = (window.mfState && window.mfState.forms || []).some(function (x) { return x.gallery && x.gallery.items.some(function (i) { return i.id === id; }); });
    if (!used) delete blobs[id];
  }

  function active(f) {
    var g = G(f);
    return !!(f && f.formStyle === 'guided' && g && g.on !== false && g.items.some(function (i) { return blobs[i.id]; }) && !(window.mfGd && window.mfGd.fill));
  }
  function items(f) {
    return G(f).items.filter(function (i) { return blobs[i.id]; }).map(function (i) { return { src: blobs[i.id], cap: i.cap || '', r: i.r || 0.8 }; });
  }

  // ---- Live Preview (Guided) ----
  var baseScreens = window.mfGdScreens, baseRender = window.mfGdRender;
  window.mfGdScreens = function (f) {
    var s = baseScreens(f);
    if (active(f)) s.splice(1, 0, { t: 'gallery' });
    return s;
  };
  window.mfGalHeadHtml = function () {
    var g = G(cur()) || {};
    return '<div class="gx-head"><h1>' + esc(g.title || 'Our recent work') + '</h1><p>Swipe or use the arrows.</p></div>';
  };
  function sync(ov, f, s) {
    var on = active(f), g = G(f);
    var sig = on ? g.items.map(function (i) { return i.id + '~' + i.cap; }).join('|') + '|' + g.glow : '';
    if (ov._gx && ov._gxSig !== sig) { ov._gx.destroy(); ov._gx = null; }
    if (!on) return;
    if (!ov._gx) { ov._gx = gxMount(ov, items(f), { glow: g.glow, onOpen: function () { window.mfGdMove('back', function () { window.mfGd.i = 1; }); } }); ov._gxSig = sig; }
    ov._gx.set(s.t === 'intro' ? 'hidden' : s.t === 'gallery' ? 'big' : 'docked');
  }
  window.mfGdRender = function () {
    baseRender.apply(this, arguments);
    var ov = document.getElementById('mfGdOverlay'), f = cur();
    if (!ov || !f) return;
    var S = window.mfGdScreens(f), s = window.mfGd.done ? { t: 'done' } : (S[Math.min(window.mfGd.i, S.length - 1)] || { t: 'intro' });
    sync(ov, f, s);
  };
  function refresh(showGallery) {
    if (!document.getElementById('mfGdOverlay') || typeof window.mfGdRender !== 'function') return;
    if (showGallery !== undefined) { window.mfGd.i = showGallery ? 1 : 0; window.mfGd.done = false; }
    window.mfGdRender();
  }

  // ---- publish ----
  window.mfGalPayload = function (f) {
    return ready.then(function () {
      var g = G(f); if (!g) return null;
      var its = items(f); if (!its.length) return null;
      return { on: g.on !== false, glow: g.glow || 'sub', title: g.title || '', items: its };
    });
  };

  // ---- the panel in the rail ----
  function build() {
    node = document.createElement('div'); node.className = 'mfg';
    node.innerHTML =
      '<div class="mfg-row"><span>Show gallery on my form</span><button type="button" class="mfg-sw" id="mfgOn" role="switch" aria-label="Show gallery"></button></div>' +
      '<label class="mfg-lab" for="mfgTitle">Heading <small>optional</small></label><input class="mfg-in" id="mfgTitle" maxlength="60" placeholder="Our recent work">' +
      '<div class="mfg-lab">Gallery glow <small>tints the form with the active image’s colours</small></div>' +
      '<div class="mfg-seg" id="mfgGlow"><button type="button" data-g="off">Off</button><button type="button" data-g="sub">Subtle</button><button type="button" data-g="full">Full</button></div>' +
      '<div class="mfg-drop" id="mfgDrop" tabindex="0" role="button"><b>Add images</b><span>Any size or shape · JPG, PNG, WebP, GIF</span></div>' +
      '<input type="file" id="mfgFile" accept="image/*" multiple hidden>' +
      '<div class="mfg-msg" id="mfgMsg" role="status"></div><div class="mfg-grid" id="mfgGrid"></div><div class="mfg-cnt" id="mfgCnt"></div>' +
      '<p class="mfg-note">Guided forms show these as a 3D gallery after the welcome screen, then keep it in the corner while people answer. Standard forms show it as a strip above the questions on the live link.</p>';
    var drop = node.querySelector('#mfgDrop'), file = node.querySelector('#mfgFile');
    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', function () { add(file.files); file.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
    node.addEventListener('click', function (e) {
      var f = cur(), g = G(f, true), b = e.target.closest('button'); if (!b || !f) return;
      if (b.id === 'mfgOn') { g.on = g.on === false; changed(f, true); }
      else if (b.dataset.g) { g.glow = b.dataset.g; changed(f, true); }
      else if (b.dataset.x !== undefined) { var gone = g.items.splice(+b.dataset.x, 1)[0]; if (gone) dropBlob(gone.id); persist(); changed(f, g.items.length > 0); }
      else if (b.dataset.m !== undefined) {
        var i = +b.dataset.m, j = i + +b.dataset.d;
        if (j >= 0 && j < g.items.length) { var t = g.items[i]; g.items[i] = g.items[j]; g.items[j] = t; changed(f, true); }
      }
    });
    node.addEventListener('change', function (e) {
      var f = cur(), g = G(f, true); if (!f) return;
      if (e.target.id === 'mfgTitle') { g.title = e.target.value.trim(); changed(f, true); }
      else if (e.target.dataset.cap !== undefined && g.items[+e.target.dataset.cap]) { g.items[+e.target.dataset.cap].cap = e.target.value.trim().slice(0, 60); changed(f, true); }
    });
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.mfr-btn[data-sec="gallery"]')) setTimeout(render, 0); });
  }
  function changed(f) { window.mfTouch(f); render(); refresh(active(f)); }
  function render() {
    if (!node) return;
    var f = cur(), g = G(f); shownId = f && f.id;
    var on = !g || g.on !== false, glow = (g && g.glow) || 'sub', its = g ? g.items : [];
    var sw = node.querySelector('#mfgOn'); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on));
    node.querySelector('#mfgTitle').value = (g && g.title) || '';
    Array.prototype.forEach.call(node.querySelectorAll('#mfgGlow button'), function (b) { b.classList.toggle('on', b.dataset.g === glow); });
    node.querySelector('#mfgGrid').innerHTML = its.map(function (m, i) {
      return '<div class="mfg-it"><div class="mfg-th">' + (blobs[m.id] ? '<img src="' + blobs[m.id] + '" alt="">' : '') + '<span class="mfg-tag">' + shape(m.r) + '</span></div>' +
        '<div class="mfg-c"><input data-cap="' + i + '" value="' + esc(m.cap) + '" placeholder="Caption" maxlength="60"><div class="mfg-a">' +
        '<button type="button" data-m="' + i + '" data-d="-1" aria-label="Move left">←</button><button type="button" data-m="' + i + '" data-d="1" aria-label="Move right">→</button>' +
        '<button type="button" data-x="' + i + '" aria-label="Remove image">✕</button></div></div></div>';
    }).join('');
    node.querySelector('#mfgCnt').textContent = its.length + ' / ' + MAX + ' images';
  }
  function add(list) {
    var f = cur(); if (!f) return;
    var g = G(f, true), room = MAX - g.items.length;
    if (room <= 0) { say('Up to ' + MAX + ' images. Remove one to add another.'); return; }
    Array.prototype.slice.call(list, 0, room).forEach(function (file) {
      var rd = new FileReader();
      rd.onload = function () {
        var im = new Image();
        im.onerror = function () { say('Couldn’t read ' + file.name + '. Please save it as JPG or PNG and try again.'); };
        im.onload = function () {
          if (g.items.length >= MAX) return;
          var W = im.naturalWidth || 1200, H = im.naturalHeight || 800, k = Math.min(1, 1280 / Math.max(W, H));
          var c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          var s = c.toDataURL('image/webp', 0.8); if (s.indexOf('image/webp') < 0) s = c.toDataURL('image/png');
          var id = 'gal' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          blobs[id] = s; persist();
          g.items.push({ id: id, cap: file.name.replace(/\.[^.]+$/, '').slice(0, 60), r: W / H });
          say(''); changed(f, true);
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  window.mfGalleryNode = function () { if (!node) { build(); render(); } return node; };
  window.mfGalReady = ready;
})();
