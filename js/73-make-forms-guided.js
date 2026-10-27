// ─── MAKE FORMS: GUIDED STYLE ───
// Guided = one question at a time (the style a respondent sees on the published
// link). Standard = the familiar all-questions-on-one-page layout.
// The Standard | Guided toggle lives in the Live Preview header. The choice is
// saved on the form as f.formStyle and published as the `form_style` column.
// Print, PDF export and Push to Workspace always use Standard (A4 sheets).
var mfGd = { i: 0, a: {}, done: false, fill: false, mode: null };

function mfSetFormStyle(style) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.formStyle = style === 'guided' ? 'guided' : 'standard';
  mfGd.i = 0; mfGd.a = {}; mfGd.done = false;
  mfTouch(f);
  mfGdSync();
}

function mfGdScreens(f) {
  const s = [{ t: 'intro' }];
  if (f.requireIdentity && !mfGd.fill) {
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
    case 'signature': if (mfGd.fill) {
      const dv = (typeof window.mfGetDraft === 'function' && window.mfGetDraft()) || {};
      const sv = (typeof SarvarcSign !== 'undefined') ? SarvarcSign.parse(dv[s.id]) : null;
      if (sv && (sv.image || sv.file)) {
        const ok = sv.image && /^data:image\//.test(sv.image);
        return `<div class="mf-gd-sigdone">${ok ? `<img src="${sv.image}" alt="Signature">` : `<span>Signature file: ${mfEsc(sv.file ? sv.file.name : '')}</span>`}</div><div><button type="button" class="mf-gd-link" data-sign="${id}">Change</button> <button type="button" class="mf-gd-link" data-signclr="${id}">Clear</button></div>`;
      }
      return `<button type="button" class="mf-gd-btn" data-sign="${id}">Click to sign</button>`;
    }
    return `<canvas class="mf-gd-sig" width="560" height="170" data-sig="${id}"></canvas><button type="button" class="mf-gd-link" data-clr="${id}">Clear</button>`;
    default: return '';
  }
}

function mfGdRender() {
  const f = mfGetCurrentForm(), ov = document.getElementById('mfGdOverlay');
  if (!f || !ov) return;
  ov.classList.toggle('mf-gd-fill', !!mfGd.fill);
  const acc = f.accentColor || '#0073E6';
  const rgb = (typeof hexToRgbStr === 'function' ? hexToRgbStr(acc) : null);
  const lum = rgb ? (() => { const [r, g, b] = rgb.split(',').map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; })() : 0;
  ov.style.setProperty('--gd1', lum > 0.6 ? mixHex(acc, 25, '#0b1020') : mixHex(acc, 55, '#0b1020'));
  ov.style.setProperty('--gd2', lum > 0.6 ? mixHex(acc, 55, '#0b1020') : acc);
  if (typeof mfGdTplApply === 'function') mfGdTplApply(ov, f); // chosen template overrides the colours and adds motion
  const S = mfGdScreens(f), n = S.length - 1;
  if (mfGd.i > n) mfGd.i = n;
  const i = mfGd.i, s = S[i];
  const pct = mfGd.done ? 100 : (i / n) * 100;
  const banner = f.bannerImageDataUrl ? `<div class="mf-gd-banner" style="background-image:url('${f.bannerImageDataUrl}');opacity:${(f.bannerImageOpacity == null ? 15 : f.bannerImageOpacity) / 100}"></div>` : '';
  const logo = f.logoDataUrl ? `<div class="mf-gd-brand"><img src="${f.logoDataUrl}" alt=""></div>` : '';
  let body;
  if (mfGd.done && mfGd.fill) {
    body = `<div class="mf-gd-screen"><div class="mf-gd-big">✓</div><h2>All questions answered</h2><p>Save this as a response, or go back to review the answers.</p><div><button class="mf-gd-btn" data-go="save">Save Response</button> <button class="mf-gd-btn ghost" data-go="review">Review answers</button></div></div>`;
  } else if (mfGd.done) {
    body = `<div class="mf-gd-screen"><div class="mf-gd-big">✓</div><h2>Thank you</h2><p>Your response has been recorded.</p><div><button class="mf-gd-btn ghost" data-go="again">Start over</button></div></div>`;
  } else if (i === 0 || n === 0) {
    body = `<div class="mf-gd-screen"><h1>${mfEsc(f.title || 'Untitled Form')}</h1><p>${mfEsc(f.desc || '')}</p><div><button class="mf-gd-btn" data-go="next">${n === 0 ? (mfGd.fill ? 'Finish' : 'Submit') : 'Start →'}</button> <span class="mf-gd-hint">press Enter</span></div></div>`;
  } else {
    const isSec = s.t === 'heading' || s.t === 'label';
    const isQ = x => x.t !== 'intro' && x.t !== 'heading' && x.t !== 'label';
    const qn = S.slice(0, i + 1).filter(isQ).length, qTotal = S.filter(isQ).length;
    const content = s.t === 'heading' ? `<h1>${mfEsc(s.label)}</h1>`
      : s.t === 'label' ? `<p style="font-size:18px">${mfEsc(s.label)}</p>`
      : `<div class="mf-gd-num">${qn} / ${qTotal}</div><h2>${mfEsc(s.label)}${s.required ? ' *' : ''}</h2>${mfGdControl(s)}<div class="mf-gd-err" id="mfGdErr">Please answer this one to continue</div>`;
    body = `<div class="mf-gd-screen" id="mfGdScreen">${content}</div><div class="mf-gd-nav"><button class="mf-gd-btn ghost" data-go="back">↑</button><button class="mf-gd-btn" data-go="next">${i === n ? (mfGd.fill ? 'Finish' : 'Submit') : isSec ? 'Continue' : 'OK ✓'}</button><span class="mf-gd-hint">press Enter</span></div>`;
  }
  // The blob layer is created once and kept, so its animation keeps running when the question changes.
  let blobs = ov.querySelector(':scope > .gdx-blobs');
  if (!blobs) { ov.insertAdjacentHTML('afterbegin', '<div class="gdx-blobs" aria-hidden="true"><i></i><i></i><i></i></div>'); blobs = ov.firstElementChild; }
  Array.from(ov.children).forEach(c => { if (c !== blobs) c.remove(); });
  ov.insertAdjacentHTML('beforeend', `${banner}<div class="mf-gd-bar"><i style="width:${pct}%"></i></div>${logo}${body}`);
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
  const cur = (mfGd.fill && s.t === 'signature' && typeof window.mfGetDraft === 'function') ? (window.mfGetDraft() || {})[s.id] : mfGd.a[s.id];
  if (mfGd.i > 0 && s.required && mfGdEmpty(cur)) {
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
      else if (g === 'save') { if (typeof window.mfSaveResponse === 'function') window.mfSaveResponse(); }
      else if (g === 'review') { mfGd.done = false; mfGd.i = 1; mfGdRender(); }
      return;
    }
    const f = mfGetCurrentForm(); if (!f) return;
    const sg = e.target.closest('[data-sign]');
    if (sg) { if (typeof window.mfSigOpen === 'function') window.mfSigOpen(sg.dataset.sign); return; }
    const sc = e.target.closest('[data-signclr]');
    if (sc) { if (typeof window.mfSigClear === 'function') window.mfSigClear(sc.dataset.signclr); return; }
    const s = mfGdScreens(f)[mfGd.i]; if (!s) return;
    const at = mfGd.i;
    const chip = e.target.closest('.mf-gd-chip');
    if (chip) {
      if (s.t === 'checkbox') { mfGd.a[s.id] = !mfGd.a[s.id]; chip.classList.toggle('on', !!mfGd.a[s.id]); mfGdPush(); return; }
      mfGd.a[s.id] = chip.dataset.v; mfGdPush();
      ov.querySelectorAll('.mf-gd-chip').forEach(c => c.classList.toggle('on', c === chip));
      setTimeout(() => { if (mfGd.i === at && !mfGd.done) mfGdNext(); }, 320);
      return;
    }
    const st = e.target.closest('[data-r]');
    if (st) {
      mfGd.a[s.id] = +st.dataset.r; mfGdPush();
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
  ov.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.in) { mfGd.a[t.dataset.in] = t.value; mfGdPush(); } });
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

// ─── Fill & Responses tab ───
// On the Fill tab a Guided form is also filled (and a saved response is also
// opened) one question at a time. The answers are mirrored into the form's draft
// (mfDraftValues) on every change, so Save Response, Print and the PDF exports
// keep working exactly as they do for Standard forms.
function mfGdCollect(f) {
  const dv = (typeof window.mfGetDraft === 'function' && window.mfGetDraft()) || {};
  const out = {};
  (f.fields || []).forEach(fl => {
    if (fl.type === 'heading' || fl.type === 'label') return;
    const v = mfGd.a[fl.id];
    if (fl.type === 'signature') out[fl.id] = dv[fl.id] || '';
    else if (fl.type === 'checkbox') out[fl.id] = !!v;
    else if (fl.type === 'mcq' || fl.type === 'rating') out[fl.id] = v == null ? '' : String(v);
    else out[fl.id] = v == null ? '' : v;
  });
  return out;
}
function mfGdPush() {
  if (!mfGd.fill || typeof window.mfSetDraft !== 'function') return;
  const f = mfGetCurrentForm(); if (!f) return;
  window.mfSetDraft(mfGdCollect(f));
}
// Called when a different draft/response is opened on the Fill tab.
function mfGdLoadDraft(startAtFirstQuestion) {
  const dv = (typeof window.mfGetDraft === 'function' && window.mfGetDraft()) || {};
  mfGd.a = {};
  Object.keys(dv).forEach(k => { mfGd.a[k] = dv[k]; });
  mfGd.i = startAtFirstQuestion ? 1 : 0; mfGd.done = false;
}
window.mfGdCollect = mfGdCollect;
window.mfGdLoadDraft = mfGdLoadDraft;

// Keeps the toggle, the preview header badge and the Guided overlay in step with the form.
function mfGdSync() {
  const f = mfGetCurrentForm(); if (!f) return;
  const guided = f.formStyle === 'guided';
  const seg = document.getElementById('mfStyleSeg');
  if (seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === (guided ? 'guided' : 'standard')));
  const size = document.getElementById('mfDesignPreviewSize');
  if (size) size.style.display = guided ? 'none' : '';
  const tb = document.getElementById('mfTplBtn');
  if (tb) tb.style.display = guided ? 'inline-block' : 'none';
  const mode = typeof window.mfGetMode === 'function' ? window.mfGetMode() : null;
  const dSlot = document.getElementById('mfDesignPreviewSlot');
  const fSlot = document.getElementById('mfFillPreviewSlot');
  const slot = mode === 'fill' ? fSlot : dSlot;
  const show = guided && !!slot && (mode === 'design' || mode === 'fill');
  let ov = document.getElementById('mfGdOverlay');
  if (dSlot) dSlot.classList.toggle('mf-gd-host', show && mode === 'design');
  if (fSlot) fSlot.classList.toggle('mf-gd-on', show && mode === 'fill');
  if (!show) { if (ov) ov.remove(); mfGd.n = undefined; mfGd.mode = null; mfGd.fill = false; return; }
  // Switching tabs: Fill starts from the current draft, Design starts a clean preview.
  if (mfGd.mode !== mode) {
    mfGd.mode = mode; mfGd.fill = mode === 'fill'; mfGd.n = undefined;
    if (mfGd.fill) mfGdLoadDraft(false); else { mfGd.a = {}; mfGd.i = 0; mfGd.done = false; }
    if (ov) { ov.remove(); ov = null; }
  }
  mfGd.fill = mode === 'fill';
  if (ov && ov.parentNode !== slot) { ov.remove(); ov = null; }
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'mfGdOverlay'; ov.className = 'mf-gd'; ov.tabIndex = -1;
    slot.appendChild(ov); mfGdWire(ov);
  }
  if (!mfGd.fill && typeof mfGd.n === 'number' && f.fields.length > mfGd.n) {
    const last = f.fields[f.fields.length - 1];
    const k = mfGdScreens(f).findIndex(sc => sc.id === last.id);
    if (k > 0) { mfGd.i = k; mfGd.done = false; }
  }
  mfGd.n = f.fields.length;
  mfGdRender();
}

// Printing always uses the Standard A4 sheet: bring it up to date with the answers.
window.addEventListener('beforeprint', () => {
  if (mfGd.fill && document.getElementById('mfGdOverlay') && typeof window.mfRenderPreview === 'function') { mfGdPush(); window.mfRenderPreview(); }
});

window.mfGdSync = mfGdSync;

// ─── Follow the editor ───
// The respondent sees ONE question at a time, so the preview must show the
// question the user is working on. Clicking or typing in a field on the left
// jumps the preview to that question; clicking the title or description jumps
// to the first screen; adding a field jumps to the new question.
function mfGdShowField(fieldId) {
  const f = mfGetCurrentForm(); if (!f) return;
  const k = mfGdScreens(f).findIndex(sc => sc.id === fieldId);
  if (k < 1) return;
  mfGd.i = k; mfGd.done = false;
  mfGdRender();
}
function mfGdShowIntro() { mfGd.i = 0; mfGd.done = false; mfGdRender(); }

(function wireFollow() {
  const isGuided = () => { const f = mfGetCurrentForm(); return !!f && f.formStyle === 'guided'; };
  document.addEventListener('focusin', e => {
    if (!isGuided() || !e.target || !e.target.closest) return;
    const item = e.target.closest('#mfFieldList .mf-field-item');
    if (item) {
      const f = mfGetCurrentForm(), idx = [...item.parentNode.children].indexOf(item);
      if (f && f.fields[idx]) mfGdShowField(f.fields[idx].id);
      return;
    }
    if (e.target.id === 'mfFormTitleInput' || e.target.id === 'mfFormDescInput') mfGdShowIntro();
  });
})();
