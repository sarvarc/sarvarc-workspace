// ─── PITCH DECK FROM LEADS (test build) ───
// DA row (lead) + Word content + master template -> a finished deck in the editor.
(function () {
  const KEY = 'sarvarcPitchDeck_v1';
  const DEF = { docName: '', docText: '', rules: 'total = qty * unit_price\ngst = total * 18 / 100\ngrand_total = total + gst', tplId: 'marketing-bold', map: {} };
  let S; try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { S = Object.assign({}, DEF); }
  let EDT = null; // template taken from the pages open in the editor (kept in memory)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const $ = id => document.getElementById(id);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tst = (m, t) => { if (typeof toast === 'function') toast(m, t || 'info'); };
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const money = n => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // ── Word content: "# Heading" lines start a section ──
  function sections() {
    const out = []; let cur = null;
    String(S.docText || '').split('\n').forEach(l => {
      const m = l.match(/^#\s*(.*)$/);
      if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); }
      else if (l.trim()) { if (!cur) { cur = { title: '', body: [] }; out.push(cur); } cur.body.push(l.trim()); }
    });
    return out.map(s => ({ title: s.title, body: s.body.join('\n') }));
  }
  async function readDocx(file) {
    if (typeof mammoth === 'undefined') throw new Error('Word reader did not load');
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const d = document.createElement('div'); d.innerHTML = value; let t = '';
    d.childNodes.forEach(n => {
      const x = (n.textContent || '').trim(); if (!x) return;
      t += (/^H[1-3]$/.test(n.nodeName) ? '# ' : '') + x + '\n';
    });
    return t.trim();
  }

  // ── Lead data + calculations ──
  function leadData(ds, ri) {
    const d = {}, raw = {}, row = ds.rows[ri] || [];
    ds.headers.forEach((h, i) => { const k = slug(h); if (!k) return; d[k] = String(row[i] == null ? '' : row[i]).trim(); const n = num(d[k]); if (n != null) raw[k] = n; });
    const find = re => { const h = ds.headers.findIndex(x => re.test(x)); return h < 0 ? '' : String(row[h] == null ? '' : row[h]).trim(); };
    if (!d.name) d.name = find(/name/i);
    if (!d.email) d.email = find(/e-?mail/i);
    if (!d.phone) d.phone = find(/phone|mobile|whatsapp|contact/i);
    const hv = re => { const i = ds.headers.findIndex(h => re.test(h)); return i < 0 ? null : num(row[i]); };
    if (raw.qty == null) { const q = hv(/qty|quantity|units|nos/i); if (q != null) raw.qty = q; }
    if (raw.unit_price == null) { const pr = hv(/price|rate|amount|cost|budget/i); if (pr != null) raw.unit_price = pr; }
    if (raw.qty == null && raw.unit_price != null) raw.qty = 1;
    ['qty', 'unit_price'].forEach(k => { if (raw[k] != null && !d[k]) d[k] = money(raw[k]); });
    d.date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    (raw.unit_price == null ? '' : String(S.rules || '')).split('\n').forEach(l => {
      const m = l.match(/^\s*([a-z_][\w ]*?)\s*=\s*(.+)$/i); if (!m) return;
      const key = slug(m[1]);
      const expr = m[2].replace(/[a-z_][a-z0-9_]*/gi, w => String(raw[slug(w)] != null ? raw[slug(w)] : 0));
      if (!/^[\d+\-*/().\s]+$/.test(expr)) return;
      try { const v = Function('"use strict";return (' + expr + ')')(); if (isFinite(v)) { raw[key] = v; d[key] = money(v); } } catch (e) {}
    });
    return d;
  }
  // Doc text with {{tags}} filled from the lead. missing[] collects tags with no value.
  const fill = (t, d, missing) => String(t || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
    const v = d[slug(k)]; if (!v) { if (missing.indexOf(slug(k)) < 0) missing.push(slug(k)); return ''; } return v;
  });
  function fieldValue(f, d, secs, missing) {
    const m = f.match(/^sec(\d+)_(title|body)$/);
    if (m) { const s = secs[+m[1] - 1]; let o = s ? fill(s[m[2]], d, missing) : ''; if (m[1] === '1' && m[2] === 'body' && d.name && !/\{\{\s*name/i.test(S.docText)) o = 'Prepared for ' + d.name + ' · ' + d.date + (o ? '\n' + o : ''); return o; }
    if (!d[f]) { if (missing.indexOf(f) < 0) missing.push(f); return ''; }
    return d[f];
  }
  function fieldList(ds) {
    const L = [['name', 'Lead: Name'], ['email', 'Lead: Email'], ['phone', 'Lead: Phone'], ['date', 'Today\'s date']];
    if (ds) ds.headers.forEach(h => { const k = slug(h); if (k && !L.some(x => x[0] === k)) L.push([k, 'Lead: ' + h]); });
    String(S.rules || '').split('\n').forEach(l => { const m = l.match(/^\s*([a-z_][\w ]*?)\s*=/i); if (m) L.push([slug(m[1]), 'Calc: ' + m[1].trim()]); });
    sections().forEach((s, i) => { L.push(['sec' + (i + 1) + '_title', 'Word ' + (i + 1) + ': ' + (s.title || 'text').slice(0, 24) + ' (title)']); L.push(['sec' + (i + 1) + '_body', 'Word ' + (i + 1) + ': ' + (s.title || 'text').slice(0, 24) + ' (text)']); });
    return L;
  }

  // ── Master template (built in, or the pages open in the editor) ──
  async function getTpl() {
    if (S.tplId === 'editor' && EDT) return EDT;
    const id = S.tplId === 'editor' ? DEF.tplId : S.tplId;
    const t = sltFindTemplate(id), data = await sltEnsureData(id);
    return { t, data: JSON.parse(JSON.stringify(data)), id };
  }
  function snapEditor() {
    if (!pdfed.pages.length) { tst('Open or build your template in the PDF Editor first', 'error'); return; }
    const pg0 = pdfed.pages[0], w = pg0.pageMM ? pg0.pageMM[0] * 3.7795 : 794, h = pg0.pageMM ? pg0.pageMM[1] * 3.7795 : 1123;
    EDT = { id: 'editor', t: { id: 'editor', name: 'My template' }, data: { id: 'editor', width: w, height: h, slides: pdfed.pages.map((p, i) => ({ id: 'p' + (i + 1), bg: p.dataUrl || '', bgColor: p.bgColor, texts: JSON.parse(JSON.stringify(p.placedTexts || [])) })) } };
    S.tplId = 'editor'; save(); tst('Your editor pages are now the master template (' + pdfed.pages.length + ' slides)', 'success'); render();
  }
  const GUESS = [[/client\s*name|customer|prepared for|^name$/i, 'name'], [/e-?mail/i, 'email'], [/phone|mobile|contact no/i, 'phone'], [/^date|dated/i, 'date'], [/grand total|total payable|total amount/i, 'grand_total'], [/^total/i, 'total']];
  function suggest(tpl) {
    const secs = sections(), map = {};
    tpl.data.slides.forEach((sl, si) => {
      sl.texts.forEach((x, ti) => { if (String(x.text).length > 40) return; const g = GUESS.find(r => r[0].test(x.text)); if (g) map[si + ':' + ti] = g[1]; });
      if (!secs[si]) return;
      const idx = sl.texts.map((x, i) => i).filter(i => !map[si + ':' + i]);
      const big = idx.slice().sort((a, b) => sl.texts[b].fontSize - sl.texts[a].fontSize);
      if (big[0] != null) map[si + ':' + big[0]] = 'sec' + (si + 1) + '_title';
      const body = idx.filter(i => i !== big[0]).sort((a, b) => String(sl.texts[b].text).length - String(sl.texts[a].text).length)[0];
      if (body != null && secs[si].body) map[si + ':' + body] = 'sec' + (si + 1) + '_body';
    });
    return map;
  }

  // ── Send: lead + Word + template -> deck in the editor ──
  async function send(ds, ri) {
    if (!sections().length) { tst('Add your Word content first (Settings > Pitch Deck)', 'error'); openSettings(); return; }
    try {
      tst('Building the pitch deck...', 'info');
      const tpl = await getTpl(), d = leadData(ds, ri), secs = sections(), missing = [], pages = [];
      const MAP = suggest(tpl);
      if (tpl.id !== 'editor') await sltEnsureFonts(tpl.t, tpl.data);
      for (let si = 0; si < tpl.data.slides.length; si++) {
        const sl = tpl.data.slides[si];
        sl.texts.forEach((x, ti) => {
          const f = MAP[si + ':' + ti]; let v = null;
          if (f) v = fieldValue(f, d, secs, missing); else if (/\{\{/.test(x.text)) v = fill(x.text, d, missing);
          if (v == null) return;
          x.text = v; x.html = null;
          const n = v.length; if (n > 400) x.fontSize *= 0.6; else if (n > 250) x.fontSize *= 0.75; else if (n > 140) x.fontSize *= 0.9;
        });
        const bg = await sltBgDataUrl(sltSrc(/^data:/.test(sl.bg) || tpl.id === 'editor' ? sl.bg : tpl.id + '/' + sl.bg));
        pages.push(sltBuildPage(tpl.t, tpl.data, sl, bg || sl.bg));
      }
      const isNew = !pdfed.pages.length, at = isNew ? 0 : (pdfed.active >= 0 ? pdfed.active : pdfed.pages.length - 1) + 1;
      pdfed.pages.splice.apply(pdfed.pages, [at, 0].concat(pages));
      if (isNew) {
        pdfed.pdfDoc = null; pdfed.file = { name: 'Pitch Deck - ' + (d.name || 'Lead') };
        ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(i => { const e = $(i); if (e) e.style.display = ''; });
        const u = $('pdfedUploadBtn'); if (u) u.style.display = 'none';
        const fn = $('pdfedFileName'); if (fn) fn.textContent = pdfed.file.name;
        const ph = $('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
        const cw = $('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
        const tb = $('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
      }
      const te = $('prrTotalPages'); if (te) te.textContent = pdfed.pages.length;
      navigate('pdfeditor'); await pdfedBuildStrip(); await pdfedGoto(at); setTimeout(pdfedZoomFit, 60);
      tst(missing.length ? 'Deck ready. Missing for this lead (left blank): ' + missing.join(', ') : 'Pitch deck ready for ' + (d.name || 'this lead'), missing.length ? 'info' : 'success');
    } catch (e) { tst('Could not build the deck: ' + (e && e.message || e), 'error'); }
  }
  function openSettings() { navigate('settings'); setTimeout(() => window.stgTab('pitch'), 50); }

  // ── DA: auto "Send" column ──
  function inject() {
    const wrap = $('daGridWrap'), tbl = wrap && wrap.querySelector('table.da-table'); if (!tbl || typeof daGetActive !== 'function') return;
    const ds = daGetActive(); if (!ds || !ds.headers.some(h => /name|e-?mail|phone|mobile/i.test(h))) return;
    if (!tbl.dataset.pd) {
      tbl.dataset.pd = 1; const hr = tbl.querySelectorAll('thead tr');
      if (hr[0]) hr[0].insertAdjacentHTML('beforeend', '<th class="pd-th"></th>');
      if (hr[1]) hr[1].insertAdjacentHTML('beforeend', '<th class="pd-th">Send</th>');
    }
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      if (tr.dataset.pd) return; tr.dataset.pd = 1;
      const n = tr.querySelector('.da-row-num-text');
      tr.insertAdjacentHTML('beforeend', n ? '<td class="pd-td"><button type="button" class="pd-send" data-ri="' + (+n.textContent - 1) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>Send</button></td>' : '<td></td>');
    });
  }
  let busy = false;
  function watch() {
    const wrap = $('daGridWrap'); if (!wrap) return setTimeout(watch, 800);
    const mo = new MutationObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { mo.disconnect(); try { inject(); } catch (e) {} mo.observe(wrap, { childList: true, subtree: true }); busy = false; }); });
    mo.observe(wrap, { childList: true, subtree: true }); inject();
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.pd-send'); if (!b) return; e.stopPropagation(); e.preventDefault(); const h = b.innerHTML; b.disabled = true; b.textContent = 'Building...'; send(daGetActive(), +b.dataset.ri).finally(() => { b.disabled = false; b.innerHTML = h; }); }, true);
  }

  // ── Settings: 3rd sub tab ──
  const CSS = '.pd-th{min-width:96px;position:sticky;right:0;background:var(--bg2);z-index:3;color:var(--blue);font-weight:700;text-align:center}.pd-td{position:sticky;right:0;background:var(--bg2);padding:3px 8px;text-align:center}' +
    '.pd-send{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:700;color:#00111F;border:0;border-radius:8px;padding:5px 12px;cursor:pointer;background:linear-gradient(135deg,#00C2FF,#0073E6);box-shadow:0 2px 10px rgba(0,150,255,.25);transition:transform .15s,box-shadow .15s,filter .15s}.pd-send:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,150,255,.38)}.pd-send[disabled]{opacity:.6;cursor:progress;transform:none}' +
    '.pd-wrap{display:flex;flex-direction:column;gap:18px}.pd-hero{display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:22px 28px;border-radius:18px;border:1px solid var(--border2);background:linear-gradient(135deg,rgba(0,194,255,.14),rgba(0,115,230,.05))}' +
    '.pd-hero h3{margin:0 0 4px;font-size:18px;font-weight:700;color:var(--text);letter-spacing:-.01em}.pd-hero p{margin:0;font-size:13px;color:var(--text2)}' +
    '.pd-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pd-node{padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;color:var(--text);background:var(--surface);border:1px solid var(--border2)}.pd-node.ok{border-color:#2ecc8f;color:#2ecc8f}.pd-node.go{color:#00111F;border:0;background:linear-gradient(135deg,#00C2FF,#0073E6)}.pd-arr{color:var(--text3);font-size:14px}' +
    '.pd-grid{display:grid;grid-template-columns:minmax(260px,1fr) 1.5fr;gap:18px}@media(max-width:960px){.pd-grid{grid-template-columns:1fr}}' +
    '.pd-card{padding:22px 26px 24px}.pd-step{display:flex;align-items:center;gap:10px;margin:0 0 4px}.pd-num{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#00111F;background:linear-gradient(135deg,#00C2FF,#0073E6)}.pd-card h3{margin:0;font-size:15px;font-weight:700;color:var(--text)}.pd-card>p{margin:0 0 16px;font-size:12.5px;color:var(--text2)}' +
    '.pd-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;min-height:150px;padding:20px;border:1.5px dashed var(--border2);border-radius:14px;cursor:pointer;color:var(--text2);font-size:12.5px;transition:border-color .2s,background .2s}.pd-drop:hover,.pd-drop.over{border-color:var(--blue);background:rgba(0,194,255,.06)}.pd-drop b{color:var(--text);font-size:13.5px}.pd-drop svg{color:var(--blue)}' +
    '.pd-file{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;border:1px solid var(--border2);background:var(--surface)}.pd-file .ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:rgba(46,204,143,.14);color:#2ecc8f}.pd-file .t{flex:1;min-width:0}.pd-file .t b{display:block;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-file .t span{font-size:11.5px;color:var(--text2)}' +
    '.pd-tpls{display:flex;gap:14px;overflow-x:auto;padding:4px 4px 12px;scroll-snap-type:x proximity}.pd-tpl{flex:0 0 150px;scroll-snap-align:start;cursor:pointer;border-radius:14px;border:1.5px solid var(--border);background:var(--surface);padding:8px;transition:transform .18s,border-color .18s,box-shadow .18s;position:relative}.pd-tpl:hover{transform:translateY(-3px);border-color:var(--border2)}.pd-tpl.on{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,194,255,.16),0 10px 26px rgba(0,120,230,.22)}' +
    '.pd-tpl .im{aspect-ratio:4/3;border-radius:9px;overflow:hidden;background:var(--bg3);display:grid;place-items:center}.pd-tpl img{width:100%;height:100%;object-fit:contain;display:block}.pd-tpl .n{margin:8px 2px 0;font-size:11.5px;font-weight:600;color:var(--text);line-height:1.3}.pd-tpl .k{margin:0 2px;font-size:10.5px;color:var(--text3)}' +
    '.pd-tpl .ck{position:absolute;top:14px;right:14px;width:20px;height:20px;border-radius:50%;display:none;place-items:center;color:#00111F;background:linear-gradient(135deg,#00C2FF,#0073E6)}.pd-tpl.on .ck{display:grid}.pd-tpl.own .im{border:1.5px dashed var(--border2);background:transparent;color:var(--blue)}' +
    '.pd-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:16px 22px;border-radius:14px;border:1px solid var(--border);background:var(--surface);font-size:12.5px;color:var(--text2)}';
  function mount() {
    const tabs = document.querySelector('.stg-tabs'), host = $('stgPaneBrand'); if (!tabs || !host || $('stgTabPitch')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    tabs.insertAdjacentHTML('beforeend', '<button type="button" class="stg-tab" id="stgTabPitch" role="tab" onclick="stgTab(\'pitch\')">Pitch Deck</button>');
    host.insertAdjacentHTML('afterend', '<div id="stgPanePitch" style="display:none"></div>');
    const orig = window.stgTab;
    window.stgTab = function (n) {
      orig(n === 'pitch' ? 'general' : n);
      const p = n === 'pitch'; $('stgPaneGeneral').style.display = p ? 'none' : $('stgPaneGeneral').style.display; $('stgPanePitch').style.display = p ? '' : 'none';
      $('stgTabPitch').classList.toggle('on', p); if (p) { $('stgTabGeneral').classList.remove('on'); render(); }
    };
  }
  function activeLeads() { try { const a = daGetActive(); return a && a.headers.length ? a : null; } catch (e) { return null; } }
  const IC = { up: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>', doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>', ck: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>', pen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' };
  async function render() {
    const el = $('stgPanePitch'); if (!el) return;
    const secs = sections(); let list = [];
    try { const ix = await sltEnsureIndex(); list = (ix.templates || []).filter(t => /presentation|proposal|quotation/.test(t.type)); } catch (e) {}
    const ownOk = S.tplId === 'editor' && EDT, tplOk = S.tplId === 'editor' ? !!EDT : true, ready = secs.length && tplOk;
    el.innerHTML = '<div class="pd-wrap"><div class="pd-hero"><div><h3>Pitch Deck, automatically</h3><p>A new lead arrives, you press Send, the deck is ready.</p></div>' +
      '<div class="pd-flow"><span class="pd-node">Lead</span><span class="pd-arr">+</span><span class="pd-node' + (secs.length ? ' ok' : '') + '">' + (secs.length ? IC.ck + ' ' : '') + 'Your content</span><span class="pd-arr">+</span><span class="pd-node' + (tplOk ? ' ok' : '') + '">' + (tplOk ? IC.ck + ' ' : '') + 'Your template</span><span class="pd-arr">=</span><span class="pd-node go">' + (ready ? 'Ready' : 'Pitch deck') + '</span></div></div>' +
      '<div class="pd-grid"><div class="stg-card pd-card"><div class="pd-step"><span class="pd-num">1</span><h3>Your content</h3></div><p>The Word file with your pitch, services and pricing.</p>' +
      (secs.length ? '<div class="pd-file"><div class="ic">' + IC.doc + '</div><div class="t"><b>' + esc(S.docName || 'Your content') + '</b><span>' + secs.length + ' sections ready</span></div><button class="stg-btn" id="pdChg">Change</button></div>' : '<div class="pd-drop" id="pdDrop">' + IC.up + '<b>Drop your Word file here</b><span>or click to choose a .docx</span></div>') +
      '<input type="file" id="pdDoc" accept=".docx" style="display:none"></div>' +
      '<div class="stg-card pd-card"><div class="pd-step"><span class="pd-num">2</span><h3>Your template</h3></div><p>Pick a design. Lead details are placed for you.</p><div class="pd-tpls">' +
      list.map(t => '<div class="pd-tpl' + (S.tplId === t.id ? ' on' : '') + '" data-tpl="' + t.id + '"><span class="ck">' + IC.ck + '</span><div class="im"><img alt="" src="' + esc(sltSrc(t.cover)) + '"></div><div class="n">' + esc(t.name) + '</div><div class="k">' + t.slides + (t.slides > 1 ? ' pages' : ' page') + '</div></div>').join('') +
      '<div class="pd-tpl own' + (S.tplId === 'editor' ? ' on' : '') + '" id="pdEdt"><span class="ck">' + IC.ck + '</span><div class="im">' + IC.pen + '</div><div class="n">My own design</div><div class="k">' + (ownOk ? EDT.data.slides.length + ' pages from editor' : 'From the editor') + '</div></div></div></div></div>' +
      '<div class="pd-foot"><span>Every lead in Data Arrangement now has a <b style="color:var(--text)">Send</b> button.</span><button class="stg-btn" id="pdMk">Try with sample leads</button></div></div>';
    const inp = $('pdDoc'), pick = () => inp.click();
    const load = async f => { if (!f) return; try { S.docText = await readDocx(f); S.docName = f.name; save(); render(); } catch (er) { tst('Could not read the Word file: ' + er.message, 'error'); } };
    inp.onchange = e => load(e.target.files[0]);
    const dz = $('pdDrop'); if (dz) { dz.onclick = pick; dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over'); dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); load(e.dataTransfer.files[0]); }; }
    const ch = $('pdChg'); if (ch) ch.onclick = pick;
    el.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { S.tplId = b.dataset.tpl; save(); render(); });
    $('pdEdt').onclick = snapEditor;
    $('pdMk').onclick = () => {
      if (!secs.length) { S.docName = 'Sample content'; S.docText = '# Your growth partner\nWe design, build and run your online presence end to end, so you can focus on your customers.\n# What you get\nA modern website, branding, and ongoing social media, all handled by one team.\n# Your investment\nQuantity {{qty}} x Rs {{unit_price}} = Rs {{total}}. GST 18%: Rs {{gst}}. Total payable: Rs {{grand_total}}.\n# Next step\nReply to {{email}} or call {{phone}} and we start this week.'; save(); }
      daAddDataset('Form Leads (sample)', [['Name', 'Email', 'Phone', 'Qty', 'Unit Price', 'Message'], ['Riya Shah', 'riya@example.com', '98250 11111', '3', '25000', 'Need a website'], ['Amit Patel', 'amit@example.com', '98250 22222', '2', '40000', 'Branding and ads'], ['Neha Mehta', '', '98250 33333', '5', '12000', 'Social media']]);
      navigate('dataarrange'); tst('Sample leads added. Press Send on any row.', 'success');
    };
  }
  window.pitchDeckSend = send;
  function boot() { mount(); watch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(mount, 1500);
})();
