// ─── MAKE FORMS: GUIDED STYLE ───
// Guided = one question at a time (the style a respondent sees on the published
// link). Standard = the familiar all-questions-on-one-page layout.
// The Standard | Guided toggle lives in the Live Preview header. The choice is
// saved on the form as f.formStyle and published as the `form_style` column.
// Print, PDF export and Push to Workspace always use Standard (A4 sheets).
var mfGd = { i: 0, a: {}, done: false };

function mfSetFormStyle(style) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.formStyle = style === 'guided' ? 'guided' : 'standard';
  mfGd.i = 0; mfGd.a = {}; mfGd.done = false;
  mfTouch(f);
  mfGdSync();
}

function mfGdScreens(f) {
  const s = [{ t: 'intro' }];
  if (f.requireIdentity) {
    s.push({ t: 'text', id: '__name', label: 'Your name', required: true });
    s.push({ t: 'email', id: '__email', label: 'Your email', required: true });
  }
  (f.fields || []).forEach(fl => s.push({
    t: fl.type, id: fl.id, label: fl.label || '', options: fl.options || [],
    required: !!fl.required && fl.type !== 'heading' && fl.type !== 'label', max: fl.max || 5
  }));
  return s;
}

function mfGdControl(s) {
  const id = mfEsc(s.id), v = mfGd.a[s.id];
  const inp = (type) => `<input class="mf-gd-in" type="${type}" data-in="${id}" placeholder="Type your answer" value="${mfEsc(v || '')}">`;
  const chip = (val, k, on) => `<button type="button" class="mf-gd-chip${on ? ' on' : ''}" data-v="${mfEsc(val)}"><kbd>${k}</kbd>${mfEsc(val)}</button>`;
  switch (s.t) {
    case 'text': return inp('text');
    case 'email': return inp('email');
    case 'number': return inp('number');
    case 'date': return inp('date');
    case 'paragraph': return `<textarea class="mf-gd-in" data-in="${id}" placeholder="Type your answer">${mfEsc(v || '')}</textarea>`;
    case 'select': return `<select class="mf-gd-in" data-in="${id}"><option value="">Choose…</option>${s.options.map(o => `<option${v === o ? ' selected' : ''}>${mfEsc(o)}</option>`).join('')}</select>`;
    case 'mcq': return `<div class="mf-gd-chips">${s.options.map((o, j) => chip(o, String.fromCharCode(65 + j), v === o)).join('')}</div>`;
    case 'checkbox': return `<div class="mf-gd-chips"><button type="button" class="mf-gd-chip${v ? ' on' : ''}" data-v="1"><kbd>✓</kbd>Yes</button></div>`;
    case 'rating': return `<div class="mf-gd-stars">${Array.from({ length: s.max }, (_, j) => `<button type="button" class="mf-gd-st${(v || 0) > j ? ' on' : ''}" data-r="${j + 1}" aria-label="${j + 1}">★</button>`).join('')}</div>`;
    case 'signature': return `<canvas class="mf-gd-sig" width="560" height="170" data-sig="${id}"></canvas><button type="button" class="mf-gd-link" data-clr="${id}">Clear</button>`;
    default: return '';
  }
}

function mfGdRender() {
  const f = mfGetCurrentForm(), ov = document.getElementById('mfGdOverlay');
  if (!f || !ov) return;
  const acc = f.accentColor || '#0073E6';
  ov.style.setProperty('--gd1', mixHex(acc, 55, '#0b1020'));
  ov.style.setProperty('--gd2', acc);
  const S = mfGdScreens(f), n = S.length - 1;
  if (mfGd.i > n) mfGd.i = n;
  const i = mfGd.i, s = S[i];
  const pct = mfGd.done ? 100 : (i / n) * 100;
  const banner = f.bannerImageDataUrl ? `<div class="mf-gd-banner" style="background-image:url('${f.bannerImageDataUrl}');opacity:${(f.bannerImageOpacity == null ? 15 : f.bannerImageOpacity) / 100}"></div>` : '';
  const logo = f.logoDataUrl ? `<div class="mf-gd-brand"><img src="${f.logoDataUrl}" alt=""></div>` : '';
  let body;
  if (mfGd.done) {
    body = `<div class="mf-gd-screen"><div class="mf-gd-big">✓</div><h2>Thank you</h2><p>Your response has been recorded.</p><div><button class="mf-gd-btn ghost" data-go="again">Start over</button></div></div>`;
  } else if (i === 0 || n === 0) {
    body = `<div class="mf-gd-screen"><h1>${mfEsc(f.title || 'Untitled Form')}</h1><p>${mfEsc(f.desc || '')}</p><div><button class="mf-gd-btn" data-go="next">${n === 0 ? 'Submit' : 'Start →'}</button> <span class="mf-gd-hint">press Enter</span></div></div>`;
  } else {
    body = `<div class="mf-gd-screen" id="mfGdScreen"><div class="mf-gd-num">${i} / ${n}</div><h2>${mfEsc(s.label)}${s.required ? ' *' : ''}</h2>${mfGdControl(s)}<div class="mf-gd-err" id="mfGdErr">Please answer this one to continue</div></div><div class="mf-gd-nav"><button class="mf-gd-btn ghost" data-go="back">↑</button><button class="mf-gd-btn" data-go="next">${i === n ? 'Submit' : 'OK ✓'}</button><span class="mf-gd-hint">press Enter</span></div>`;
  }
  ov.innerHTML = `${banner}<div class="mf-gd-bar"><i style="width:${pct}%"></i></div>${logo}${body}`;
  ov.querySelectorAll('canvas[data-sig]').forEach(c => {
    const saved = mfGd.a[c.dataset.sig];
    if (!saved) return;
    const im = new Image(); im.onload = () => c.getContext('2d').drawImage(im, 0, 0); im.src = saved;
  });
}

function mfGdEmpty(v) { return v == null || v === '' || v === false; }

function mfGdFocus() {
  const el = document.querySelector('#mfGdOverlay .mf-gd-in');
  if (el) el.focus({ preventScroll: true });
}

function mfGdNext() {
  const f = mfGetCurrentForm(); if (!f) return;
  const S = mfGdScreens(f), s = S[mfGd.i];
  if (mfGd.i > 0 && s.required && mfGdEmpty(mfGd.a[s.id])) {
    const sc = document.getElementById('mfGdScreen'), er = document.getElementById('mfGdErr');
    if (er) er.style.display = 'block';
    if (sc) { sc.classList.remove('mf-gd-shake'); void sc.offsetWidth; sc.classList.add('mf-gd-shake'); }
    return;
  }
  if (mfGd.i >= S.length - 1) mfGd.done = true; else mfGd.i++;
  mfGdRender(); mfGdFocus();
}

function mfGdWire(ov) {
  ov.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const g = go.dataset.go;
      if (g === 'next') mfGdNext();
      else if (g === 'back') { if (mfGd.i > 0) { mfGd.i--; mfGdRender(); mfGdFocus(); } }
      else if (g === 'again') { mfGd.i = 0; mfGd.a = {}; mfGd.done = false; mfGdRender(); }
      return;
    }
    const f = mfGetCurrentForm(); if (!f) return;
    const s = mfGdScreens(f)[mfGd.i]; if (!s) return;
    const at = mfGd.i;
    const chip = e.target.closest('.mf-gd-chip');
    if (chip) {
      if (s.t === 'checkbox') { mfGd.a[s.id] = !mfGd.a[s.id]; chip.classList.toggle('on', !!mfGd.a[s.id]); return; }
      mfGd.a[s.id] = chip.dataset.v;
      ov.querySelectorAll('.mf-gd-chip').forEach(c => c.classList.toggle('on', c === chip));
      setTimeout(() => { if (mfGd.i === at && !mfGd.done) mfGdNext(); }, 320);
      return;
    }
    const st = e.target.closest('[data-r]');
    if (st) {
      mfGd.a[s.id] = +st.dataset.r;
      ov.querySelectorAll('.mf-gd-st').forEach((b, j) => b.classList.toggle('on', j < mfGd.a[s.id]));
      setTimeout(() => { if (mfGd.i === at && !mfGd.done) mfGdNext(); }, 320);
      return;
    }
    const clr = e.target.closest('[data-clr]');
    if (clr) {
      const c = ov.querySelector('canvas[data-sig]');
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      delete mfGd.a[clr.dataset.clr];
    }
  });
  ov.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.in) mfGd.a[t.dataset.in] = t.value; });
  ov.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || mfGd.done) return;
    const tg = e.target.tagName;
    if ((tg === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) || tg === 'BUTTON') return;
    e.preventDefault(); mfGdNext();
  });
  // Signature pad: draw with mouse, finger or pen
  let pad = null;
  const pt = (c, e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
  ov.addEventListener('pointerdown', e => {
    const c = e.target.closest && e.target.closest('canvas[data-sig]'); if (!c) return;
    pad = c; try { c.setPointerCapture(e.pointerId); } catch (_) {}
    const x = c.getContext('2d'), p = pt(c, e);
    x.lineWidth = 3; x.lineCap = 'round'; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(p.x, p.y);
  });
  ov.addEventListener('pointermove', e => {
    if (!pad) return;
    const x = pad.getContext('2d'), p = pt(pad, e); x.lineTo(p.x, p.y); x.stroke();
  });
  const end = () => { if (pad) { mfGd.a[pad.dataset.sig] = pad.toDataURL(); pad = null; } };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
}

// Keeps the toggle, the preview header badge and the Guided overlay in step with the form.
function mfGdSync() {
  const f = mfGetCurrentForm(); if (!f) return;
  const guided = f.formStyle === 'guided';
  const seg = document.getElementById('mfStyleSeg');
  if (seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === (guided ? 'guided' : 'standard')));
  const size = document.getElementById('mfDesignPreviewSize');
  if (size) size.style.display = guided ? 'none' : '';
  const slot = document.getElementById('mfDesignPreviewSlot');
  const show = guided && !!slot && typeof mfMode !== 'undefined' && mfMode === 'design';
  let ov = document.getElementById('mfGdOverlay');
  if (slot) slot.classList.toggle('mf-gd-host', show);
  if (!show) { if (ov) ov.remove(); return; }
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'mfGdOverlay'; ov.className = 'mf-gd'; ov.tabIndex = -1;
    slot.appendChild(ov); mfGdWire(ov);
  }
  mfGdRender();
}

// Re-sync whenever the normal preview redraws (every edit, mode switch, form switch).
(function () {
  const orig = window.mfRenderPreview;
  if (typeof orig !== 'function') return;
  window.mfRenderPreview = function () {
    const r = orig.apply(this, arguments);
    try { mfGdSync(); } catch (e) { /* preview helper must never break editing */ }
    return r;
  };
})();
