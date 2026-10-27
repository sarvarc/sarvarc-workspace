// ─── MAKE FORMS: GUIDED TEMPLATES ───
// 20 ready-made looks for Guided forms (colours + animated background + how each
// question screen enters). The choice is saved on the form as f.formTemplate and
// travels with the public link as &tpl=<id>. "Brand colour" (no template) keeps the
// form's own accent colour, exactly as before.
// The same table lives in forms-page/index.html (the respondent page): keep them in step.
var MF_TEMPLATES = [
  {"id":"aurora","name":"Aurora","c1":"#061a2b","c2":"#0f766e","fx":"aurora","tr":"up","k1":"rgba(94,234,212,.38)","k2":"rgba(167,139,250,.38)","bl":"morph","bs":1,"b1":"#2dd4bf","b2":"#818cf8","b3":"#34d399"},
  {"id":"midnight","name":"Midnight","c1":"#050816","c2":"#1e2a78","fx":"stars","tr":"fade","k1":"rgba(99,102,241,.30)","k2":"rgba(56,189,248,.20)","bl":"orbit","bs":1.1,"b1":"#6366f1","b2":"#38bdf8","b3":"#a78bfa"},
  {"id":"sunset","name":"Sunset","c1":"#4a1233","c2":"#d9480f","fx":"sweep","tr":"up","k1":"rgba(251,191,36,.35)","k2":"rgba(236,72,153,.35)","bl":"soft","bs":1,"b1":"#fb923c","b2":"#f43f5e","b3":"#fbbf24"},
  {"id":"ocean","name":"Ocean","c1":"#031d3a","c2":"#0369a1","fx":"waves","tr":"slide","k1":"rgba(56,189,248,.30)","k2":"rgba(20,184,166,.25)","bl":"float","bs":1,"b1":"#38bdf8","b2":"#14b8a6","b3":"#60a5fa"},
  {"id":"forest","name":"Forest","c1":"#04200f","c2":"#166534","fx":"fireflies","tr":"up","k1":"rgba(163,230,53,.25)","k2":"rgba(52,211,153,.25)","bl":"morph","bs":1.3,"b1":"#84cc16","b2":"#22c55e","b3":"#10b981"},
  {"id":"royal","name":"Royal","c1":"#1b0b3a","c2":"#6d28d9","fx":"ripple","tr":"zoom","k1":"rgba(192,132,252,.40)","k2":"rgba(244,114,182,.30)","bl":"orbit","bs":0.9,"b1":"#c084fc","b2":"#f472b6","b3":"#818cf8"},
  {"id":"rose","name":"Rose","c1":"#3b0a24","c2":"#be185d","fx":"petals","tr":"blur","k1":"rgba(251,113,133,.30)","k2":"rgba(244,114,182,.25)","bl":"soft","bs":1.2,"b1":"#fb7185","b2":"#f472b6","b3":"#fda4af"},
  {"id":"neongrid","name":"Neon Grid","c1":"#0a0220","c2":"#4c1d95","fx":"grid","tr":"slide","k1":"rgba(232,121,249,.30)","k2":"rgba(34,211,238,.25)","bl":"ring","bs":1,"b1":"#e879f9","b2":"#22d3ee","b3":"#a78bfa"},
  {"id":"candy","name":"Candy","c1":"#831843","c2":"#4338ca","fx":"confetti","tr":"zoom","k1":"rgba(244,114,182,.30)","k2":"rgba(96,165,250,.30)","bl":"float","bs":0.8,"b1":"#f472b6","b2":"#60a5fa","b3":"#fbbf24"},
  {"id":"ember","name":"Ember","c1":"#1c0505","c2":"#b91c1c","fx":"embers","tr":"up","k1":"rgba(251,146,60,.35)","k2":"rgba(239,68,68,.30)","bl":"morph","bs":0.9,"b1":"#f97316","b2":"#ef4444","b3":"#fbbf24"},
  {"id":"mint","name":"Mint","c1":"#022c22","c2":"#047857","fx":"dots","tr":"fade","k1":"rgba(110,231,183,.30)","k2":"rgba(45,212,191,.25)","bl":"soft","bs":1.1,"b1":"#6ee7b7","b2":"#2dd4bf","b3":"#a7f3d0"},
  {"id":"slate","name":"Slate","c1":"#0f172a","c2":"#334155","fx":"bokeh","tr":"up","k1":"rgba(148,163,184,.25)","k2":"rgba(100,116,139,.25)","bl":"ring","bs":1.4,"b1":"#94a3b8","b2":"#64748b","b3":"#cbd5e1"},
  {"id":"gold","name":"Gold","c1":"#1f1305","c2":"#a16207","fx":"diamonds","tr":"zoom","k1":"rgba(253,224,71,.30)","k2":"rgba(251,146,60,.25)","bl":"orbit","bs":1,"b1":"#facc15","b2":"#fb923c","b3":"#fde68a"},
  {"id":"lavender","name":"Lavender","c1":"#312e81","c2":"#8b5cf6","fx":"bubbles","tr":"blur","k1":"rgba(196,181,253,.35)","k2":"rgba(244,114,182,.25)","bl":"float","bs":1.2,"b1":"#c4b5fd","b2":"#f9a8d4","b3":"#a5b4fc"},
  {"id":"arctic","name":"Arctic","c1":"#0c2a43","c2":"#2b6a94","fx":"snow","tr":"fade","k1":"rgba(186,230,253,.30)","k2":"rgba(125,211,252,.25)","bl":"soft","bs":1.3,"b1":"#bae6fd","b2":"#7dd3fc","b3":"#e0f2fe"},
  {"id":"cosmos","name":"Cosmos","c1":"#02020a","c2":"#3b0764","fx":"pulse","tr":"zoom","k1":"rgba(168,85,247,.35)","k2":"rgba(59,130,246,.25)","bl":"orbit","bs":1.2,"b1":"#a855f7","b2":"#3b82f6","b3":"#ec4899"},
  {"id":"citrus","name":"Citrus","c1":"#422006","c2":"#4d7c0f","fx":"stripes","tr":"up","k1":"rgba(250,204,21,.30)","k2":"rgba(163,230,53,.30)","bl":"morph","bs":0.85,"b1":"#facc15","b2":"#a3e635","b3":"#fb923c"},
  {"id":"cyber","name":"Cyber","c1":"#00121a","c2":"#0e7490","fx":"scan","tr":"slide","k1":"rgba(34,211,238,.35)","k2":"rgba(52,211,153,.25)","bl":"ring","bs":0.9,"b1":"#22d3ee","b2":"#34d399","b3":"#0ea5e9"},
  {"id":"coral","name":"Coral Reef","c1":"#7c2d12","c2":"#0f766e","fx":"beams","tr":"up","k1":"rgba(251,146,60,.30)","k2":"rgba(45,212,191,.30)","bl":"float","bs":1,"b1":"#fb923c","b2":"#2dd4bf","b3":"#f87171"},
  {"id":"monsoon","name":"Monsoon","c1":"#0b1220","c2":"#1e3a5f","fx":"rain","tr":"fade","k1":"rgba(125,211,252,.25)","k2":"rgba(148,163,184,.25)","bl":"ring","bs":1.1,"b1":"#7dd3fc","b2":"#94a3b8","b3":"#38bdf8"}
];

function mfTplGet(id) { return MF_TEMPLATES.find(function (t) { return t.id === id; }) || null; }

// ─── Match the template to the logo ───
// When a logo is uploaded, Make Forms already reads its brand colours (pdfedExtractLogoColors) and sets
// the accent colour. Templates now reuse those colours: the shapes and motion stay, the colours become
// the logo's. Saved on the form as f.tplAdapt (true / false). Not set = on whenever the form has a logo.
function mfTplPalette(t, cols) {
  // Recolours a template from brand colours (first = main accent), keeping its moving effects.
  var P = function (h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); return (h.length === 6 && !isNaN(n)) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null; };
  var H = function (a) { return '#' + a.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); };
  var M = function (a, p, b) { return a.map(function (v, i) { return v * p / 100 + b[i] * (1 - p / 100); }); };
  var L = function (a) { return (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255; };
  var rgbs = (cols || []).map(P).filter(Boolean);
  if (!t || !rgbs.length) return t;
  var W = [255, 255, 255], D = [5, 8, 22], a = rgbs[0];
  var lift = function (c) { return L(c) < 0.38 ? M(c, 30, W) : c; };          // blobs must show on a dark background
  var c2 = L(a) > 0.6 ? M(a, 50, [11, 16, 32]) : a, c1 = M(c2, 40, D);       // light brand colours get darkened (white text)
  var b1 = lift(a), b2 = lift(rgbs[1] || M(a, 55, W)), b3 = lift(rgbs[2] || M(a, 40, W));
  var rg = function (c, al) { return 'rgba(' + c.map(Math.round).join(',') + ',' + al + ')'; };
  return Object.assign({}, t, { c1: H(c1), c2: H(c2), b1: H(b1), b2: H(b2), b3: H(b3), k1: rg(b1, 0.35), k2: rg(b2, 0.3) });
}
function mfTplDist(a, b) {
  var p = function (h) { h = String(h).replace('#', ''); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  var x = p(a), y = p(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2));
}
function mfTplAdaptOn(f) { return !!f && (f.tplAdapt === true || (f.tplAdapt !== false && !!f.logoDataUrl)); }
function mfTplCols(f) {
  var out = [f.accentColor || '#0073E6'];
  (f.logoColors || []).forEach(function (c) {
    if (out.length < 3 && out.every(function (o) { return mfTplDist(c, o) > 70; })) out.push(c);
  });
  return out;
}
// The template as it should look for this form (recoloured when matching is on).
function mfTplEff(t, f) { return (t && mfTplAdaptOn(f)) ? mfTplPalette(t, mfTplCols(f)) : t; }

// Reads the logo's colours once per logo (works for every way a logo can be set) and refreshes the look.
var mfTplBusy = '';
function mfTplEnsureColors(f) {
  if (!f || !f.logoDataUrl || typeof pdfedExtractLogoColors !== 'function') return;
  var sig = f.logoDataUrl.length + ':' + f.logoDataUrl.slice(-24);
  if (f.logoColorsSig === sig || mfTplBusy === sig) return;
  mfTplBusy = sig;
  pdfedExtractLogoColors(f.logoDataUrl).then(function (cols) {
    f.logoColors = (cols || []).slice(0, 3); f.logoColorsSig = sig; mfTouch(f);
    if (document.getElementById('mfGdOverlay') && mfGetCurrentForm() === f) mfGdRender();
    if (document.getElementById('mfTplModal')) mfTplDraw();
  }).catch(function () { f.logoColorsSig = sig; });
}

// Called by mfGdRender() on every render: puts the chosen template on the overlay.
function mfGdTplApply(ov, f) {
  var t = mfTplEff(mfTplGet(f && f.formTemplate), f);
  mfTplEnsureColors(f);
  if (!t) {
    ['data-tpl', 'data-fx', 'data-tr', 'data-bl'].forEach(function (a) { ov.removeAttribute(a); });
    ['--fx1', '--fx2', '--b1', '--b2', '--b3', '--bs'].forEach(function (v) { ov.style.removeProperty(v); });
    return;
  }
  ov.setAttribute('data-tpl', t.id); ov.setAttribute('data-fx', t.fx); ov.setAttribute('data-tr', t.tr); ov.setAttribute('data-bl', t.bl);
  ov.style.setProperty('--b1', t.b1); ov.style.setProperty('--b2', t.b2); ov.style.setProperty('--b3', t.b3); ov.style.setProperty('--bs', t.bs);
  ov.style.setProperty('--gd1', t.c1); ov.style.setProperty('--gd2', t.c2);
  ov.style.setProperty('--fx1', t.k1); ov.style.setProperty('--fx2', t.k2);
}

var MF_TPL_FX_LABEL = { aurora: 'Aurora glow', stars: 'Twinkling stars', bubbles: 'Rising bubbles', snow: 'Falling snow', rain: 'Rain', grid: 'Moving grid', dots: 'Dot sheet', beams: 'Light beams', waves: 'Rolling waves', sweep: 'Light sweep', confetti: 'Confetti', pulse: 'Soft pulse', embers: 'Rising embers', fireflies: 'Fireflies', ripple: 'Ripples', petals: 'Falling petals', diamonds: 'Diamond lattice', stripes: 'Moving stripes', scan: 'Scan lines', bokeh: 'Bokeh lights' };
var MF_TPL_BL_LABEL = { soft: 'dreamy glows', morph: 'morphing blobs', orbit: 'orbiting blobs', ring: 'glowing rings', float: 'floating orbs' };

function mfTplCard(t, on, brand) {
  var style = t ? '--gd1:' + t.c1 + ';--gd2:' + t.c2 + ';--fx1:' + t.k1 + ';--fx2:' + t.k2 : brand;
  var attrs = t ? ' data-tpl="' + t.id + '" data-fx="' + t.fx + '" data-tr="' + t.tr + '" data-bl="' + t.bl + '"' : '';
  if (t) style += ';--b1:' + t.b1 + ';--b2:' + t.b2 + ';--b3:' + t.b3 + ';--bs:' + t.bs;
  var name = t ? t.name : 'Brand colour';
  var sub = t ? ((MF_TPL_BL_LABEL[t.bl] || '') + ' + ' + (MF_TPL_FX_LABEL[t.fx] || '').toLowerCase()) : 'Your own accent colour';
  return '<button type="button" class="mf-tpl-card' + (on ? ' on' : '') + '" data-tid="' + (t ? t.id : '') + '">' +
    '<div class="mf-gd mf-tpl-thumb"' + attrs + ' style="' + style + '"><div class="gdx-blobs" aria-hidden="true"><i></i><i></i><i></i></div><b>Aa</b><i></i><u></u></div>' +
    '<span>' + mfEsc(name) + '<small>' + mfEsc(sub) + '</small></span></button>';
}

function mfTplOpen() {
  var f = mfGetCurrentForm(); if (!f) return;
  mfTplClose();
  var m = document.createElement('div');
  m.id = 'mfTplModal'; m.className = 'mf-tpl-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Choose a template');
  m.addEventListener('click', function (e) {
    if (e.target === m || e.target.closest('[data-tclose]')) { mfTplClose(); return; }
    var c = e.target.closest('.mf-tpl-card'); if (!c) return;
    mfTplSet(c.dataset.tid);
    m.querySelectorAll('.mf-tpl-card').forEach(function (x) { x.classList.toggle('on', x === c); });
  });
  m.addEventListener('change', function (e) {
    if (!e.target.matches('[data-tadapt]')) return;
    var g = mfGetCurrentForm(); if (!g) return;
    g.tplAdapt = !!e.target.checked; mfTouch(g);
    if (document.getElementById('mfGdOverlay')) mfGdRender();
    mfTplDraw();
  });
  document.body.appendChild(m);
  document.addEventListener('keydown', mfTplEsc);
  mfTplEnsureColors(f);
  mfTplDraw();
}

// (Re)draws the picker contents, e.g. after the match switch or once the logo colours are read.
function mfTplDraw() {
  var f = mfGetCurrentForm(), m = document.getElementById('mfTplModal'); if (!f || !m) return;
  var grid = m.querySelector('.mf-tpl-grid'), keep = grid ? grid.scrollTop : 0;
  var acc = f.accentColor || '#0073E6';
  var lum = 0; var rgb = (typeof hexToRgbStr === 'function') ? hexToRgbStr(acc) : null;
  if (rgb) { var p = rgb.split(',').map(Number); lum = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255; }
  var brand = '--gd1:' + (lum > 0.6 ? mixHex(acc, 25, '#0b1020') : mixHex(acc, 55, '#0b1020')) + ';--gd2:' + (lum > 0.6 ? mixHex(acc, 55, '#0b1020') : acc);
  var cur = f.formTemplate || '', on = mfTplAdaptOn(f), hasLogo = !!f.logoDataUrl;
  var dots = on ? mfTplCols(f).map(function (c) { return '<i class="mf-tpl-dot" style="background:' + mfEsc(c) + '"></i>'; }).join('') : '';
  var note = hasLogo ? (on ? 'Using your logo colours' : 'Using each template\'s own colours') : 'No logo yet. Upload one in Design and the templates recolour to match it. Switch on to use your accent colour.';
  m.innerHTML = '<div class="mf-tpl-panel"><div class="mf-tpl-head"><div><h3>Choose a template</h3><p>Changes the look of your Guided form: colours, moving background and how questions appear. Hover a card to see it move.</p></div>' +
    '<button type="button" class="mf-tpl-x" data-tclose aria-label="Close">×</button></div>' +
    '<label class="mf-tpl-match"><input type="checkbox" data-tadapt' + (on ? ' checked' : '') + '><span><b>Match my logo colours</b><small>' + mfEsc(note) + '</small></span>' + dots + '</label>' +
    '<div class="mf-tpl-grid">' + mfTplCard(null, !cur, brand) + MF_TEMPLATES.map(function (t) { return mfTplCard(mfTplEff(t, f), cur === t.id); }).join('') + '</div></div>';
  var g2 = m.querySelector('.mf-tpl-grid'); if (g2) g2.scrollTop = keep;
}
function mfTplEsc(e) { if (e.key === 'Escape') mfTplClose(); }
function mfTplClose() {
  var m = document.getElementById('mfTplModal'); if (m) m.remove();
  document.removeEventListener('keydown', mfTplEsc);
}

function mfTplSet(id) {
  var f = mfGetCurrentForm(); if (!f) return;
  f.formTemplate = mfTplGet(id) ? id : '';
  mfTouch(f);
  if (document.getElementById('mfGdOverlay')) mfGdRender();
  if (typeof toast === 'function' && f.publishedId) toast('Template changed. Press Update Link to publish it, and share the new link.', 'info');
}
