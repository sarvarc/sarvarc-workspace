/* ===== MAKE FORMS > SIGN DOCUMENTS =====
   Upload a document (quotation, filled template, agreement), drag fields onto it
   (name, phone, email, date, text, signature, checkbox), try it yourself, then send it
   to someone as a live link, with the same controls Forms has: Publish, Update link,
   Pause / Resume, expiry, Copy link, Take offline.

   Where things live:
   - The document list + field positions : localStorage 'sarvarcSignDocs'
   - The document file + collected answers: IndexedDB 'sarvarcSignDocFiles'
   Both are part of Saved Sessions (see SM_MODULE_STORAGE, makeforms).
   - A live copy only exists online while the link is live (Supabase tables
     sign_requests / sign_responses, see supabase/07-sign-requests.sql). Taking it
     offline, or its expiry, deletes the file from the server.
*/
(function () {
  'use strict';

  var Core = window.SarvarcSignDoc;
  var LS_KEY = 'sarvarcSignDocs';
  var IDB_KEY = 'sarvarcSignDocFiles';
  var REG_KEY = 'sarvarcSignPublishRegistry';
  var MAX_BYTES = 3 * 1024 * 1024;
  var PAGE_SCALE = 1.5;

  var docs = [];
  var blobs = {};            // { docId: fileDataUrl, 'r:'+docId: [responses] }
  var blobsLoaded = false;
  var blobsReady = null;

  var cur = null;            // doc being edited
  var pages = [];            // rendered pages [{canvas,w,h}]
  var mode = 'design';       // design | fill | share
  var selId = null;
  var armed = null;
  var values = {};           // owner's test fill
  var syncTimer = null;
  var saveTimer = null;
  var ed = null;             // editor root element

  // ───────────────────────── small helpers ─────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function say(msg, type) { if (typeof toast === 'function') toast(msg, type || 'info'); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function slug() { return 'sg' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5); }
  function baseUrl() { return window.SARVARC_SIGN_PUBLIC_BASE_URL || 'https://sarvarc-sign.pages.dev'; }
  function linkFor(d) { return baseUrl() + '/sign.html?s=' + d.shareSlug; }
  function fmtDate(t) {
    try { return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  // ───────────────────────── storage ─────────────────────────
  function loadDocs() {
    try { docs = JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []; } catch (e) { docs = []; }
  }
  function saveDocsNow() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(docs)); }
    catch (e) { say('Could not save, your browser storage may be full', 'error'); }
  }
  function saveDocsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDocsNow, 350);
  }
  async function loadBlobs() {
    try { blobs = (await idbKvGet(IDB_KEY)) || {}; } catch (e) { blobs = {}; }
    blobsLoaded = true;
  }
  async function saveBlobs() {
    try { await idbKvSet(IDB_KEY, blobs); }
    catch (e) { say('Could not save the document file, your browser storage may be full', 'error'); }
  }
  function getReg() { try { return JSON.parse(localStorage.getItem(REG_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setReg(id, info) {
    var r = getReg();
    if (info) r[id] = info; else delete r[id];
    try { localStorage.setItem(REG_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ }
  }
  // A Saved Session load replaces the doc list, so re-attach live links from the registry.
  function reconcilePublish() {
    var r = getReg(), changed = false;
    docs.forEach(function (d) {
      if (d.publishedId) return;
      var x = r[d.id];
      if (!x) return;
      d.publishedId = x.publishedId; d.shareSlug = x.shareSlug; d.liveState = x.liveState || 'live';
      d.expiresAt = x.expiresAt || null; changed = true;
    });
    if (changed) saveDocsNow();
  }
  function getDoc(id) { for (var i = 0; i < docs.length; i++) if (docs[i].id === id) return docs[i]; return null; }
  function responsesOf(d) { return (blobs['r:' + d.id] || []); }

  // ───────────────────────── gallery (My Sign Documents) ─────────────────────────
  function statusBadge(d) {
    if (!d.publishedId) return '<span class="sgd-badge sgd-b-draft">Draft</span>';
    if (d.liveState === 'paused') return '<span class="sgd-badge sgd-b-paused">Paused</span>';
    if (d.expiresAt && d.expiresAt < Date.now()) return '<span class="sgd-badge sgd-b-paused">Expired</span>';
    return '<span class="sgd-badge sgd-b-live">Live</span>';
  }
  function renderGrid() {
    var grid = document.getElementById('sgdGrid');
    var empty = document.getElementById('sgdEmpty');
    var count = document.getElementById('sgdCount');
    if (!grid) return;
    count.textContent = docs.length + ' document' + (docs.length !== 1 ? 's' : '');
    if (!docs.length) { grid.innerHTML = ''; if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';
    var sorted = docs.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    grid.innerHTML = sorted.map(function (d) {
      var nResp = responsesOf(d).length;
      return '<div class="mf-form-card sgd-card" data-open="' + d.id + '">' +
        '<span class="mf-form-tag">Sign</span>' +
        '<h4>' + esc(d.title || 'Untitled document') + '</h4>' +
        '<div class="mf-form-meta">' + statusBadge(d) + ' ' + (d.pageCount || 1) + ' page' + ((d.pageCount || 1) !== 1 ? 's' : '') +
        ' · ' + (d.fields || []).length + ' field' + ((d.fields || []).length !== 1 ? 's' : '') +
        (nResp ? ' · ' + nResp + ' signed' : '') + '</div>' +
        '<div class="mf-form-actions" data-stop="1">' +
        '<button data-act="open" data-id="' + d.id + '">Edit</button>' +
        '<button data-act="dup" data-id="' + d.id + '">Duplicate</button>' +
        '<button class="mf-danger" data-act="del" data-id="' + d.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
  }
  function bindGallery() {
    var sec = document.getElementById('sgdSection');
    if (!sec || sec.dataset.bound) return;
    sec.dataset.bound = '1';
    sec.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (btn) {
        e.stopPropagation();
        var id = btn.dataset.id;
        if (btn.dataset.act === 'open') openEditor(id);
        else if (btn.dataset.act === 'dup') duplicateDoc(id);
        else if (btn.dataset.act === 'del') deleteDoc(id);
        return;
      }
      if (e.target.closest('[data-stop]')) return;
      var card = e.target.closest('[data-open]');
      if (card) openEditor(card.dataset.open);
    });
  }
  async function duplicateDoc(id) {
    var d = getDoc(id); if (!d) return;
    await blobsReady;
    var c = JSON.parse(JSON.stringify(d));
    c.id = uid('sgd'); c.title = (d.title || 'Untitled') + ' (copy)';
    delete c.publishedId; delete c.shareSlug; delete c.liveState; delete c.expiresAt; delete c.liveStale;
    c.createdAt = c.updatedAt = Date.now();
    docs.push(c);
    blobs[c.id] = blobs[d.id];
    saveDocsNow(); await saveBlobs(); renderGrid();
    say('Duplicated', 'success');
  }
  async function deleteDoc(id) {
    var d = getDoc(id); if (!d) return;
    var live = d.publishedId ? '\n\nIts live link will also stop working and the online copy will be deleted.' : '';
    if (!confirm('Delete "' + (d.title || 'Untitled document') + '"?' + live)) return;
    if (d.publishedId) { try { await window.sarvarcSupabase.from('sign_requests').delete().eq('id', d.publishedId); } catch (e) { /* offline is fine */ } }
    setReg(d.id, null);
    docs = docs.filter(function (x) { return x.id !== id; });
    delete blobs[id]; delete blobs['r:' + id];
    saveDocsNow(); await saveBlobs(); renderGrid();
  }

  // ───────────────────────── new document ─────────────────────────
  function pickFile() {
    var inp = document.getElementById('sgdFileInput');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'sgdFileInput';
      inp.accept = 'application/pdf,image/png,image/jpeg,image/webp,.pdf';
      inp.style.display = 'none';
      inp.addEventListener('change', onFilePicked);
      document.body.appendChild(inp);
    }
    inp.value = '';
    inp.click();
  }
  async function onFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var okType = /^application\/pdf$/.test(file.type) || /^image\/(png|jpeg|webp)$/.test(file.type) || /\.pdf$/i.test(file.name);
    if (!okType) { say('Please choose a PDF or an image (PNG, JPG)', 'error'); return; }
    if (file.size > MAX_BYTES) { say('That file is too big. Please keep it under 3 MB (compress the PDF first).', 'error'); return; }
    try {
      await blobsReady;
      var url = await Core.fileToDataUrl(file);
      if (/\.pdf$/i.test(file.name) && url.indexOf('data:application/pdf') !== 0) {
        url = 'data:application/pdf;base64,' + url.split(',')[1];
      }
      var d = {
        id: uid('sgd'), title: file.name.replace(/\.[^.]+$/, '') || 'Untitled document',
        fileName: file.name, pageCount: 1, fields: [], expiryDays: 7,
        createdAt: Date.now(), updatedAt: Date.now()
      };
      docs.push(d); blobs[d.id] = url;
      saveDocsNow(); await saveBlobs(); renderGrid();
      openEditor(d.id);
    } catch (err) {
      console.error('[Sign Documents] could not add file', err);
      say('Could not read that file', 'error');
    }
  }

  // ───────────────────────── editor shell ─────────────────────────
  function buildEditor() {
    if (ed) return ed;
    ed = document.createElement('div');
    ed.id = 'sgdEditor'; ed.className = 'sgd-ed'; ed.style.display = 'none';
    ed.innerHTML =
      '<div class="sgd-top">' +
        '<button class="sgd-btn sgd-ghost" data-top="back" title="Back">&larr; Back</button>' +
        '<input class="sgd-title" id="sgdTitle" placeholder="Document name" maxlength="120">' +
        '<div class="sgd-tabs">' +
          '<button data-mode="design" class="on">1. Place fields</button>' +
          '<button data-mode="fill">2. Try it &amp; sign</button>' +
          '<button data-mode="share">3. Send &amp; responses</button>' +
        '</div>' +
        '<span class="sgd-saved" id="sgdSaved"></span>' +
      '</div>' +
      '<div class="sgd-body">' +
        '<aside class="sgd-left" id="sgdLeft"></aside>' +
        '<main class="sgd-stage" id="sgdStage"></main>' +
        '<aside class="sgd-right" id="sgdRight"></aside>' +
      '</div>';
    document.body.appendChild(ed);

    ed.addEventListener('click', onEditorClick);
    ed.addEventListener('input', onEditorInput);
    ed.addEventListener('change', onEditorInput);
    $('#sgdStage', ed).addEventListener('pointerdown', onStagePointerDown);
    $('#sgdStage', ed).addEventListener('dragover', function (e) { if (e.target.closest('.sgd-layer')) e.preventDefault(); });
    $('#sgdStage', ed).addEventListener('drop', onStageDrop);
    document.addEventListener('keydown', function (e) {
      if (!ed || ed.style.display === 'none' || mode !== 'design' || !selId) return;
      var t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeField(selId); }
    });
    return ed;
  }

  async function openEditor(id) {
    var d = getDoc(id); if (!d) return;
    await blobsReady;
    if (!blobs[id]) { say('The file for this document is missing from this browser. Please upload it again.', 'error'); return; }
    buildEditor();
    cur = d; mode = 'design'; selId = null; armed = null; values = {};
    $('#sgdTitle', ed).value = d.title || '';
    $('#sgdStage', ed).innerHTML = '<div class="sgd-loading">Opening your document…</div>';
    ed.style.display = 'flex';
    document.body.classList.add('sgd-open');
    try {
      pages = await Core.renderPages(blobs[id], PAGE_SCALE);
    } catch (err) {
      console.error('[Sign Documents] render failed', err);
      say('Could not open that document. If it is a PDF, check it is not password protected.', 'error');
      closeEditor(); return;
    }
    if (d.pageCount !== pages.length) { d.pageCount = pages.length; saveDocsSoon(); }
    setMode('design');
  }

  function closeEditor() {
    clearInterval(syncTimer); syncTimer = null;
    saveDocsNow();
    if (ed) ed.style.display = 'none';
    document.body.classList.remove('sgd-open');
    cur = null; pages = [];
    renderGrid();
  }

  function setMode(m) {
    mode = m; armed = null;
    $$('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    clearInterval(syncTimer); syncTimer = null;
    renderLeft(); renderStage(); renderRight();
    if (m === 'share') {
      if (cur.publishedId) { syncResponses(true); syncTimer = setInterval(function () { syncResponses(true); }, 30000); }
    }
  }
  function $$(sel) { return Array.prototype.slice.call((ed || document).querySelectorAll(sel)); }

  // ───────────────────────── left: palette ─────────────────────────
  function renderLeft() {
    var left = $('#sgdLeft', ed);
    if (mode !== 'design') { left.style.display = 'none'; return; }
    left.style.display = '';
    left.innerHTML = '<div class="sgd-h">Fields</div><div class="sgd-hint">Drag onto the document, or tap one then tap where you want it.</div>' +
      Core.TYPES.map(function (t) {
        return '<button class="sgd-pal' + (armed === t.id ? ' on' : '') + '" draggable="true" data-pal="' + t.id + '">' +
          '<span class="sgd-pal-ic">' + palIcon(t.id) + '</span>' + esc(t.label) + '</button>';
      }).join('');
    $$('.sgd-pal').forEach(function (b) {
      b.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', 'sgd:' + b.dataset.pal);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }
  function palIcon(t) {
    var m = { name: 'Aa', phone: '☎', email: '@', date: '31', text: 'T', signature: '✍', checkbox: '☑' };
    return m[t] || 'T';
  }

  // ───────────────────────── center: pages and fields ─────────────────────────
  function renderStage() {
    var stage = $('#sgdStage', ed);
    stage.innerHTML = '';
    pages.forEach(function (pg, i) {
      var wrap = document.createElement('div');
      wrap.className = 'sgd-page';
      wrap.style.aspectRatio = pg.canvas.width + ' / ' + pg.canvas.height;
      var cv = document.createElement('canvas');
      cv.width = pg.canvas.width; cv.height = pg.canvas.height;
      cv.getContext('2d').drawImage(pg.canvas, 0, 0);
      var layer = document.createElement('div');
      layer.className = 'sgd-layer'; layer.dataset.page = i;
      wrap.appendChild(cv); wrap.appendChild(layer);
      var tag = document.createElement('div');
      tag.className = 'sgd-pageno'; tag.textContent = 'Page ' + (i + 1) + ' of ' + pages.length;
      stage.appendChild(wrap); stage.appendChild(tag);
    });
    renderLayers();
  }

  function fieldStyle(f) {
    return 'left:' + (f.x * 100) + '%;top:' + (f.y * 100) + '%;width:' + (f.w * 100) + '%;height:' + (f.h * 100) + '%';
  }
  function renderLayers() {
    $$('.sgd-layer').forEach(function (layer) {
      var pi = +layer.dataset.page;
      layer.className = 'sgd-layer' + (mode === 'design' && armed ? ' armed' : '');
      layer.innerHTML = (cur.fields || []).filter(function (f) { return (f.page || 0) === pi; }).map(fieldHtml).join('');
    });
  }
  function fieldHtml(f) {
    var info = Core.typeInfo(f.type);
    if (mode === 'design') {
      return '<div class="sgd-f sgd-t-' + f.type + (selId === f.id ? ' sel' : '') + '" data-id="' + f.id + '" style="' + fieldStyle(f) + '">' +
        '<span class="sgd-f-label">' + esc(f.label || info.label) + (f.required ? ' *' : '') + '</span><i class="sgd-rh"></i></div>';
    }
    var v = values[f.id];
    var inner = '';
    if (f.type === 'signature') {
      var img = Core.sigImage(v);
      inner = img ? '<img class="sgd-sigimg" src="' + img + '" alt="Signature" data-sign="' + f.id + '">'
                  : '<button class="sgd-signbtn" data-sign="' + f.id + '">✍ Sign here' + (f.required ? ' *' : '') + '</button>';
    } else if (f.type === 'checkbox') {
      inner = '<input type="checkbox" class="sgd-cb" data-fid="' + f.id + '"' + (v === '1' ? ' checked' : '') + '>';
    } else {
      inner = '<input class="sgd-in" data-fid="' + f.id + '" type="' + (info.input || 'text') + '" placeholder="' +
        esc((f.label || info.label) + (f.required ? ' *' : '')) + '" value="' + esc(v || '') + '">';
    }
    return '<div class="sgd-f sgd-fill sgd-t-' + f.type + '" data-id="' + f.id + '" style="' + fieldStyle(f) + '">' + inner + '</div>';
  }

  // ───────────────────────── placing, moving, resizing ─────────────────────────
  function place(type, pageIdx, cx, cy) {
    var layer = $('.sgd-layer[data-page="' + pageIdx + '"]', ed);
    if (!layer) return;
    var rect = layer.getBoundingClientRect();
    var info = Core.typeInfo(type);
    var f = {
      id: uid('f'), type: type, label: info.label, required: type === 'signature',
      page: pageIdx, w: info.w, h: info.h, x: 0, y: 0
    };
    f.x = clamp((cx - rect.left) / rect.width - f.w / 2, 0, 1 - f.w);
    f.y = clamp((cy - rect.top) / rect.height - f.h / 2, 0, 1 - f.h);
    cur.fields.push(f);
    selId = f.id; armed = null;
    touched();
    renderLeft(); renderLayers(); renderRight();
  }
  function onStageDrop(e) {
    var layer = e.target.closest('.sgd-layer');
    if (!layer || mode !== 'design') return;
    var t = e.dataTransfer.getData('text/plain') || '';
    if (t.indexOf('sgd:') !== 0) return;
    e.preventDefault();
    place(t.slice(4), +layer.dataset.page, e.clientX, e.clientY);
  }
  function onStagePointerDown(e) {
    if (mode !== 'design') return;
    var fe = e.target.closest('.sgd-f');
    if (!fe) {
      var layer = e.target.closest('.sgd-layer');
      if (layer && armed) { place(armed, +layer.dataset.page, e.clientX, e.clientY); e.preventDefault(); }
      else if (selId) { selId = null; renderLayers(); renderRight(); }
      return;
    }
    var f = fieldById(fe.dataset.id); if (!f) return;
    if (selId !== f.id) {
      selId = f.id;
      $$('.sgd-f').forEach(function (x) { x.classList.toggle('sel', x.dataset.id === f.id); });
      renderRight();
    }
    var layerEl = fe.parentNode, rect = layerEl.getBoundingClientRect();
    var resizing = e.target.classList.contains('sgd-rh');
    var sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y, ow = f.w, oh = f.h, moved = false;
    try { fe.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    function mv(ev) {
      var dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
      moved = true;
      if (resizing) { f.w = clamp(ow + dx, 0.015, 1 - f.x); f.h = clamp(oh + dy, 0.012, 1 - f.y); }
      else { f.x = clamp(ox + dx, 0, 1 - f.w); f.y = clamp(oy + dy, 0, 1 - f.h); }
      fe.style.cssText = fieldStyle(f);
    }
    function up() {
      fe.removeEventListener('pointermove', mv);
      fe.removeEventListener('pointerup', up);
      fe.removeEventListener('pointercancel', up);
      if (moved) touched();
    }
    fe.addEventListener('pointermove', mv);
    fe.addEventListener('pointerup', up);
    fe.addEventListener('pointercancel', up);
    e.preventDefault();
  }
  function fieldById(id) {
    var a = cur.fields || [];
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function removeField(id) {
    cur.fields = cur.fields.filter(function (f) { return f.id !== id; });
    if (selId === id) selId = null;
    touched(); renderLayers(); renderRight();
  }
  function touched() {
    cur.updatedAt = Date.now();
    if (cur.publishedId) cur.liveStale = true;
    saveDocsSoon();
    var s = $('#sgdSaved', ed); if (s) s.textContent = 'Saved on this device';
  }

  // ───────────────────────── right panel ─────────────────────────
  function renderRight() {
    var r = $('#sgdRight', ed);
    r.style.display = '';
    if (mode === 'design') r.innerHTML = inspectorHtml();
    else if (mode === 'fill') r.innerHTML = fillPanelHtml();
    else r.innerHTML = sharePanelHtml();
  }

  function inspectorHtml() {
    var f = selId ? fieldById(selId) : null;
    if (!f) {
      var n = (cur.fields || []).length;
      return '<div class="sgd-h">How it works</div>' +
        '<ol class="sgd-steps"><li>Drag a field onto the document.</li><li>Move it, or pull its corner to resize.</li>' +
        '<li>Click a field to rename it or make it required.</li></ol>' +
        '<div class="sgd-hint">' + n + ' field' + (n !== 1 ? 's' : '') + ' placed. Press Delete to remove the selected one.</div>' +
        '<button class="sgd-btn sgd-primary sgd-block" data-go="fill">Next: try it &amp; sign &rarr;</button>';
    }
    return '<div class="sgd-h">Field settings</div>' +
      '<label class="sgd-lab">Label (what the signer sees)</label>' +
      '<input class="sgd-field" data-prop="label" value="' + esc(f.label) + '" maxlength="60">' +
      '<label class="sgd-lab">Type</label>' +
      '<select class="sgd-field" data-prop="type">' + Core.TYPES.map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === f.type ? ' selected' : '') + '>' + esc(t.label) + '</option>';
      }).join('') + '</select>' +
      '<label class="sgd-check"><input type="checkbox" data-prop="required"' + (f.required ? ' checked' : '') + '> Required</label>' +
      '<div class="sgd-row"><button class="sgd-btn" data-fa="dup">Duplicate</button>' +
      '<button class="sgd-btn sgd-danger" data-fa="del">Delete</button></div>';
  }

  function fillPanelHtml() {
    var req = (cur.fields || []).filter(function (f) { return f.required; });
    var done = req.filter(function (f) { return hasValue(f); }).length;
    return '<div class="sgd-h">Try it yourself</div>' +
      '<div class="sgd-hint">This is a private test. Nothing is sent to anyone. Fill the fields and sign, then download your copy.</div>' +
      '<div class="sgd-progress">Required: ' + done + ' of ' + req.length + '</div>' +
      '<button class="sgd-btn sgd-primary sgd-block" data-top="dl">Download signed PDF</button>' +
      '<button class="sgd-btn sgd-block" data-go="share">Next: send it to someone &rarr;</button>' +
      '<button class="sgd-btn sgd-ghost sgd-block" data-go="design">&larr; Edit fields</button>';
  }
  function hasValue(f) { var v = values[f.id]; return v != null && v !== '' && v !== '0'; }

  function sharePanelHtml() {
    var d = cur;
    var live = !!d.publishedId;
    var paused = d.liveState === 'paused';
    var expired = d.expiresAt && d.expiresAt < Date.now();
    var h = '<div class="sgd-h">Send for signing</div>';
    h += '<div class="sgd-status">' + statusBadge(d) + (d.liveStale && live ? ' <span class="sgd-stale">Changes not on the link yet</span>' : '') + '</div>';
    h += '<label class="sgd-lab">Keep the link live for</label>' +
      '<select class="sgd-field" data-expiry="1">' +
      [[1, '1 day'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Until I take it offline']].map(function (o) {
        return '<option value="' + o[0] + '"' + ((d.expiryDays == null ? 7 : d.expiryDays) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>';
    h += '<div class="sgd-hint">While the link is live, a copy of this document is kept online so the signer can open it. It is deleted when you take it offline or when the time is up.</div>';
    h += '<button class="sgd-btn sgd-primary sgd-block" data-share="publish" id="sgdPubBtn">' + (live ? 'Update link' : 'Publish &amp; get link') + '</button>';
    if (live) {
      h += '<div class="sgd-linkbox"><input class="sgd-field" readonly value="' + esc(linkFor(d)) + '" onclick="this.select()"></div>' +
        '<div class="sgd-row"><button class="sgd-btn" data-share="copy">Copy link</button>' +
        '<button class="sgd-btn" data-share="toggle">' + (paused || expired ? 'Resume' : 'Pause') + '</button></div>' +
        '<button class="sgd-btn sgd-danger sgd-block" data-share="offline">Take offline &amp; delete online copy</button>';
      if (d.expiresAt) h += '<div class="sgd-hint">Link ' + (expired ? 'expired' : 'expires') + ' ' + fmtDate(d.expiresAt) + '</div>';
    }
    var rs = responsesOf(d);
    h += '<div class="sgd-h sgd-h2">Signed copies (' + rs.length + ') ' +
      (live ? '<button class="sgd-link" data-share="sync">Refresh</button>' : '') + '</div>';
    if (!rs.length) h += '<div class="sgd-hint">' + (live ? 'Nobody has signed yet. New ones appear here automatically.' : 'Publish to start collecting signatures.') + '</div>';
    h += rs.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).map(function (x) {
      return '<div class="sgd-resp"><div><b>' + esc(x.name || 'Signer') + '</b><span>' + esc(x.email || '') + ' · ' + fmtDate(x.at) + '</span></div>' +
        '<div class="sgd-row"><button class="sgd-btn" data-resp="dl" data-rid="' + x.id + '">Download PDF</button>' +
        '<button class="sgd-btn sgd-danger" data-resp="del" data-rid="' + x.id + '">Remove</button></div></div>';
    }).join('');
    return h;
  }

  // ───────────────────────── editor events ─────────────────────────
  function onEditorClick(e) {
    var t = e.target;
    var b = t.closest('[data-top]');
    if (b) {
      if (b.dataset.top === 'back') closeEditor();
      else if (b.dataset.top === 'dl') downloadOwn();
      return;
    }
    if ((b = t.closest('[data-mode]'))) { setMode(b.dataset.mode); return; }
    if ((b = t.closest('[data-go]'))) { setMode(b.dataset.go); return; }
    if ((b = t.closest('[data-pal]'))) {
      armed = (armed === b.dataset.pal) ? null : b.dataset.pal;
      renderLeft(); renderLayers(); return;
    }
    if ((b = t.closest('[data-fa]'))) {
      var f = selId && fieldById(selId); if (!f) return;
      if (b.dataset.fa === 'del') removeField(f.id);
      else {
        var c = JSON.parse(JSON.stringify(f));
        c.id = uid('f'); c.x = clamp(f.x + 0.02, 0, 1 - f.w); c.y = clamp(f.y + 0.03, 0, 1 - f.h);
        cur.fields.push(c); selId = c.id; touched(); renderLayers(); renderRight();
      }
      return;
    }
    if ((b = t.closest('[data-sign]')) && mode === 'fill') { openSign(b.dataset.sign); return; }
    if ((b = t.closest('[data-share]'))) { shareAction(b.dataset.share); return; }
    if ((b = t.closest('[data-resp]'))) { respAction(b.dataset.resp, b.dataset.rid); return; }
  }
  function onEditorInput(e) {
    var t = e.target;
    if (t.id === 'sgdTitle') { cur.title = t.value; touched(); return; }
    if (t.dataset && t.dataset.prop && selId) {
      var f = fieldById(selId); if (!f) return;
      var p = t.dataset.prop;
      if (p === 'required') f.required = t.checked;
      else if (p === 'type') {
        var oldInfo = Core.typeInfo(f.type);
        if (!f.label || f.label === oldInfo.label) f.label = Core.typeInfo(t.value).label;
        f.type = t.value;
        if (e.type === 'change') renderRight();
      } else f[p] = t.value;
      touched();
      var el = $('.sgd-f[data-id="' + f.id + '"] .sgd-f-label', ed);
      if (el) el.textContent = (f.label || '') + (f.required ? ' *' : '');
      if (e.type === 'change') renderLayers();
      return;
    }
    if (t.dataset && t.dataset.expiry) { cur.expiryDays = +t.value; touched(); return; }
    if (t.dataset && t.dataset.fid && mode === 'fill') {
      values[t.dataset.fid] = t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value;
      var pr = $('.sgd-progress', ed);
      if (pr) {
        var req = cur.fields.filter(function (f) { return f.required; });
        pr.textContent = 'Required: ' + req.filter(hasValue).length + ' of ' + req.length;
      }
    }
  }

  // ───────────────────────── fill and sign (owner test) ─────────────────────────
  function openSign(fid) {
    var f = fieldById(fid); if (!f) return;
    if (!window.SarvarcSign) { say('Signature tool did not load. Please refresh the page.', 'error'); return; }
    window.SarvarcSign.open({
      title: f.label || 'Add your signature', accent: '#0073E6',
      onDone: function (val) { values[fid] = window.SarvarcSign.toAnswer(val); renderLayers(); renderRight(); }
    });
  }
  function exportValues(src) {
    var out = {};
    (cur.fields || []).forEach(function (f) {
      var v = src[f.id];
      if (v == null || v === '') return;
      if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { var p = v.split('-'); v = p[2] + '/' + p[1] + '/' + p[0]; }
      out[f.id] = v;
    });
    return out;
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function safeName(s) { return String(s || 'document').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'document'; }
  async function downloadOwn() {
    var missing = (cur.fields || []).filter(function (f) { return f.required && !hasValue(f); });
    if (missing.length) { say('Please fill the required fields first (' + missing.length + ' left)', 'error'); return; }
    try {
      say('Building your PDF…');
      var blob = await Core.composePdf(blobs[cur.id], cur.fields, exportValues(values));
      saveBlob(blob, safeName(cur.title) + '-signed.pdf');
    } catch (err) { console.error(err); say('Could not build the PDF', 'error'); }
  }

  // ───────────────────────── publish controls ─────────────────────────
  async function shareAction(act) {
    if (act === 'publish') return publish();
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(linkFor(cur)); say('Link copied', 'success'); }
      catch (e) { window.prompt('Copy this link:', linkFor(cur)); }
      return;
    }
    if (act === 'toggle') return togglePause();
    if (act === 'offline') return takeOffline();
    if (act === 'sync') return syncResponses(false);
  }

  function needMissingFieldsCheck() {
    var fs = cur.fields || [];
    if (!fs.length) { say('Place at least one field on the document first', 'error'); return true; }
    if (!fs.some(function (f) { return f.type === 'signature'; }) &&
        !confirm('There is no signature field on this document. Send it anyway?')) return true;
    return false;
  }

  async function publish() {
    var d = cur;
    if (needMissingFieldsCheck()) return;
    try {
      if (!localStorage.getItem('sarvarcFormOwnerAck')) {
        var ok = confirm('Before you publish:\n\nYou are the document owner. You are responsible for the data you collect, including telling signers how you will use it and having any consent the law requires. Do not use this for children under 18 without parental consent.\n\nSee the Terms of Service (sarvarc.com/terms) and Privacy Policy (sarvarc.com/privacy).\n\nPublish this document?');
        if (!ok) return;
        localStorage.setItem('sarvarcFormOwnerAck', '1');
      }
    } catch (e) { /* storage blocked, continue */ }
    var btn = document.getElementById('sgdPubBtn');
    if (btn) { btn.disabled = true; btn.textContent = d.publishedId ? 'Updating…' : 'Publishing…'; }
    try {
      var sb = window.sarvarcSupabase;
      if (!sb) throw new Error('Not connected. Please refresh the page.');
      var ures = await sb.auth.getUser();
      var user = ures && ures.data && ures.data.user;
      if (!user) { say('Please log in first to publish a document', 'error'); return; }

      var days = d.expiryDays == null ? 7 : d.expiryDays;
      if (days > 0) {
        if (!d.expiresAt || d.expiryApplied !== days) d.expiresAt = Date.now() + days * 86400000;
      } else d.expiresAt = null;
      d.expiryApplied = days;

      var payload = {
        owner_id: user.id,
        title: d.title || 'Untitled document',
        fields: d.fields || [],
        file_data_url: blobs[d.id],
        page_count: d.pageCount || 1,
        status: d.liveState === 'paused' ? 'paused' : 'active',
        expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null
      };
      var row;
      if (d.publishedId) {
        var u = await sb.from('sign_requests').update(payload).eq('id', d.publishedId).select('id, share_slug').single();
        if (u.error) throw u.error;
        row = u.data;
      } else {
        payload.share_slug = slug();
        var ins = await sb.from('sign_requests').insert(payload).select('id, share_slug').single();
        if (ins.error) throw ins.error;
        row = ins.data;
      }
      var first = !d.publishedId;
      d.publishedId = row.id; d.shareSlug = row.share_slug; d.liveStale = false;
      if (!d.liveState) d.liveState = 'live';
      saveDocsNow();
      setReg(d.id, { publishedId: d.publishedId, shareSlug: d.shareSlug, liveState: d.liveState, expiresAt: d.expiresAt });
      try { await navigator.clipboard.writeText(linkFor(d)); say(first ? 'Published! Link copied' : 'Link updated! Link copied', 'success'); }
      catch (e) { say(first ? 'Published!' : 'Link updated!', 'success'); }
      renderRight();
      clearInterval(syncTimer); syncTimer = setInterval(function () { syncResponses(true); }, 30000);
    } catch (err) {
      console.error('[Sign Documents] publish failed', err);
      say('Could not publish: ' + (err.message || 'unknown error. Check the sign_requests table exists.'), 'error');
      renderRight();
    }
  }

  async function togglePause() {
    var d = cur; if (!d.publishedId) return;
    var expired = d.expiresAt && d.expiresAt < Date.now();
    var goLive = d.liveState === 'paused' || expired;
    try {
      var upd = { status: goLive ? 'active' : 'paused' };
      if (goLive && expired) {
        var days = d.expiryDays == null ? 7 : d.expiryDays;
        d.expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
        upd.expires_at = d.expiresAt ? new Date(d.expiresAt).toISOString() : null;
        upd.file_data_url = blobs[d.id];
      }
      var res = await window.sarvarcSupabase.from('sign_requests').update(upd).eq('id', d.publishedId);
      if (res.error) throw res.error;
      d.liveState = goLive ? 'live' : 'paused';
      saveDocsNow();
      setReg(d.id, { publishedId: d.publishedId, shareSlug: d.shareSlug, liveState: d.liveState, expiresAt: d.expiresAt });
      say(goLive ? 'Link is live again' : 'Paused. People can no longer sign.', 'success');
      renderRight();
    } catch (err) { say('Could not change that: ' + (err.message || 'unknown error'), 'error'); }
  }

  async function takeOffline() {
    var d = cur; if (!d.publishedId) return;
    if (!confirm('Take this offline?\n\nThe link will stop working and the online copy of the document will be deleted. Signed copies already collected are kept on this device.')) return;
    try {
      await syncResponses(true);
      var res = await window.sarvarcSupabase.from('sign_requests').delete().eq('id', d.publishedId);
      if (res.error) throw res.error;
      setReg(d.id, null);
      delete d.publishedId; delete d.shareSlug; delete d.liveState; delete d.expiresAt; delete d.liveStale; delete d.expiryApplied;
      saveDocsNow();
      clearInterval(syncTimer); syncTimer = null;
      say('Taken offline and the online copy is deleted', 'success');
      renderRight();
    } catch (err) { say('Could not take it offline: ' + (err.message || 'unknown error'), 'error'); }
  }

  // ───────────────────────── responses ─────────────────────────
  async function syncResponses(silent) {
    var d = cur; if (!d || !d.publishedId || !window.sarvarcSupabase) return;
    try {
      var res = await window.sarvarcSupabase.from('sign_responses')
        .select('id, signer_name, signer_email, answers, submitted_at')
        .eq('request_id', d.publishedId).order('submitted_at', { ascending: true });
      if (res.error) throw res.error;
      var list = responsesOf(d).slice(), have = {};
      list.forEach(function (x) { have[x.id] = 1; });
      var added = 0;
      (res.data || []).forEach(function (r) {
        if (have[r.id]) return;
        list.push({ id: r.id, name: r.signer_name, email: r.signer_email, answers: r.answers || {}, at: new Date(r.submitted_at).getTime() });
        added++;
      });
      if (added) {
        blobs['r:' + d.id] = list; await saveBlobs();
        if (cur === d && mode === 'share') renderRight();
        say(added + ' new signed ' + (added === 1 ? 'copy' : 'copies') + ' received', 'success');
      } else if (!silent) say('No new signed copies yet', 'info');
    } catch (err) {
      if (!silent) say('Could not check for responses: ' + (err.message || 'unknown error'), 'error');
    }
  }
  async function respAction(act, rid) {
    var d = cur;
    var list = responsesOf(d);
    var r = list.filter(function (x) { return x.id === rid; })[0];
    if (!r) return;
    if (act === 'dl') {
      try {
        say('Building the signed PDF…');
        var blob = await Core.composePdf(blobs[d.id], d.fields, exportValues(r.answers || {}));
        saveBlob(blob, safeName(d.title) + '-' + safeName(r.name || 'signed') + '.pdf');
      } catch (err) { console.error(err); say('Could not build that PDF', 'error'); }
    } else if (act === 'del') {
      if (!confirm('Remove this signed copy from your list? This also deletes it online.')) return;
      try { await window.sarvarcSupabase.from('sign_responses').delete().eq('id', rid); } catch (e) { /* ignore */ }
      blobs['r:' + d.id] = list.filter(function (x) { return x.id !== rid; });
      await saveBlobs(); renderRight();
    }
  }

  // ───────────────────────── boot ─────────────────────────
  function init() {
    if (!Core) { console.warn('[Sign Documents] core missing'); return; }
    loadDocs();
    bindGallery();
    renderGrid();
    blobsReady = loadBlobs().then(function () { reconcilePublish(); renderGrid(); });
  }
  window.sgdPickFile = pickFile;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
