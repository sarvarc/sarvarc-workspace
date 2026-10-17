/* ===== PDF EDITOR > REVIEW PANEL =====
   Where you read what your client pinned on your work.
     - Pages of the live version with numbered pins (client = blue, your own notes = steel, done = green)
     - A comment list with a Done tick for each comment, NEW tags for unread ones
     - Click anywhere on a page to add your own optional note (the client can see it too)
     - Compare: the version the client reviewed beside your new version, with the checklist
     - A quiet check every 30 seconds while Workspace is open: red count on the Send for Review
       button and a small notice when a new comment arrives

     - Drag your own notes to a new spot on the page; delete any note (asks first)

   Needs: js/68-pdfed-send-to-review.js, js/65-sign-doc-core.js (page drawing),
          supabase/09-review-links.sql, supabase/10-review-compare.sql and supabase/11-review-drag-delete.sql.
*/

const PDFED_RVP = { link: null, comments: [], cur: [], prev: [], mode: 'view', draft: null, hl: null, seen: new Set(), note: '', timer: null, known: null };
const pdfedRvpNewById = {};      // link id -> number of unread client comments (drives the red count)
let pdfedRvpNotified = null;     // comment ids already announced (null until the first check)

// ---------- unread tracking (per link, kept on this device) ----------
function pdfedRvpSeenGet(id) {
  try { return new Set(JSON.parse(localStorage.getItem('sarvarcReviewSeen:' + id) || '[]')); } catch (e) { return new Set(); }
}
function pdfedRvpSeenAdd(id, ids) {
  const s = pdfedRvpSeenGet(id);
  ids.forEach(function (x) { s.add(x); });
  try { localStorage.setItem('sarvarcReviewSeen:' + id, JSON.stringify(Array.from(s).slice(-500))); } catch (e) { /* ignore */ }
}
function pdfedRvpDotSync() {
  const dot = document.getElementById('pdfedRevDot');
  if (!dot) return;
  const lk = pdfedRevReadMap()[pdfedRevDocKey()];
  const n = lk ? (pdfedRvpNewById[lk.id] || 0) : 0;
  dot.textContent = n > 99 ? '99+' : String(n);
  dot.style.display = n ? '' : 'none';
}

// ---------- background check for new comments ----------
async function pdfedRvpPoll() {
  const sb = window.sarvarcSupabase;
  if (!sb) return;
  const map = pdfedRevReadMap();
  const keys = Object.keys(map);
  if (!keys.length) return;
  try {
    const ses = await sb.auth.getSession();
    if (!(ses && ses.data && ses.data.session)) return;
  } catch (e) { return; }
  const first = pdfedRvpNotified === null;
  if (first) pdfedRvpNotified = new Set();
  const fresh = [];
  for (let i = 0; i < keys.length; i++) {
    const lk = map[keys[i]];
    let r;
    try {
      r = await sb.from('review_comments').select('id, author_name, body').eq('review_id', lk.id).eq('author_kind', 'client');
    } catch (e) { continue; }
    if (!r || r.error || !r.data) continue;
    const seen = pdfedRvpSeenGet(lk.id);
    const unseen = r.data.filter(function (c) { return !seen.has(c.id); });
    pdfedRvpNewById[lk.id] = unseen.length;
    unseen.forEach(function (c) {
      if (!pdfedRvpNotified.has(c.id)) { pdfedRvpNotified.add(c.id); fresh.push(c); }
    });
  }
  pdfedRvpDotSync();
  if (fresh.length === 1) {
    const b = String(fresh[0].body || '');
    toast('New comment from ' + fresh[0].author_name + ': ' + (b.length > 70 ? b.slice(0, 70) + '…' : b), 'info');
  } else if (fresh.length > 1) {
    toast(fresh.length + ' new comments on your review links', 'info');
  }
}

// ---------- loading ----------
async function pdfedRvpPages(dataUrl) {
  const pages = await window.SarvarcSignDoc.renderPages(dataUrl, 1.4);
  return pages.map(function (p) { return { src: p.canvas.toDataURL('image/jpeg', 0.85), w: p.w || p.canvas.width, h: p.h || p.canvas.height }; });
}
async function pdfedRvpLoadComments() {
  const sb = window.sarvarcSupabase;
  const r = await sb.from('review_comments').select('*').eq('review_id', PDFED_RVP.link.id).order('created_at', { ascending: true });
  if (r.error) throw r.error;
  PDFED_RVP.comments = (r.data || []).map(function (c) {
    c.x = Number(c.x); c.y = Number(c.y); c.page = Number(c.page); c.version = Number(c.version); return c;
  });
}

async function pdfedOpenReviewPanel() {
  const saved = pdfedRevReadMap()[pdfedRevDocKey()];
  if (!saved) { toast('Publish a review link first', 'info'); return; }
  if (!window.SarvarcSignDoc) { toast('The page viewer did not load. Please refresh.', 'error'); return; }
  pdfedRevCloseModal();
  pdfedRvpClose(true);
  const el = document.createElement('div');
  el.id = 'pdfedRvp';
  el.className = 'rvp';
  el.innerHTML = '<div class="rvp-load">Loading comments…</div>';
  document.body.appendChild(el);
  PDFED_RVP.link = null; PDFED_RVP.comments = []; PDFED_RVP.cur = []; PDFED_RVP.prev = [];
  PDFED_RVP.mode = 'view'; PDFED_RVP.draft = null; PDFED_RVP.hl = null; PDFED_RVP.note = ''; PDFED_RVP.known = null;
  try {
    const sb = window.sarvarcSupabase;
    const lr = await sb.from('review_links')
      .select('id, title, version, page_count, file_data_url, prev_file_data_url, prev_version, status, expires_at, share_slug')
      .eq('id', saved.id).maybeSingle();
    if (lr.error) throw lr.error;
    if (!lr.data || !lr.data.file_data_url) {
      pdfedRvpClose(true);
      toast('This review link is no longer online. Publish it again from Send for Review.', 'info');
      return;
    }
    PDFED_RVP.link = lr.data;
    PDFED_RVP.cur = await pdfedRvpPages(lr.data.file_data_url);
    await pdfedRvpLoadComments();
    PDFED_RVP.seen = pdfedRvpSeenGet(lr.data.id);
    PDFED_RVP.known = new Set(PDFED_RVP.comments.map(function (c) { return c.id; }));
    PDFED_RVP.timer = setInterval(pdfedRvpRefresh, 20000);
    document.addEventListener('keydown', pdfedRvpKey);
    pdfedRvpRender();
  } catch (e) {
    console.error('[Review panel]', e);
    pdfedRvpClose(true);
    toast('Could not open comments: ' + (e && e.message ? e.message : 'unknown error. Check that 10-review-compare.sql was run.'), 'error');
  }
}

async function pdfedRvpRefresh() {
  if (!PDFED_RVP.link || PDFED_RVP.draft) return;
  try {
    await pdfedRvpLoadComments();
    const fresh = PDFED_RVP.comments.filter(function (c) { return c.author_kind === 'client' && !PDFED_RVP.known.has(c.id); });
    PDFED_RVP.comments.forEach(function (c) { PDFED_RVP.known.add(c.id); });
    if (fresh.length) toast(fresh.length === 1 ? 'New comment from ' + fresh[0].author_name : fresh.length + ' new comments', 'info');
    pdfedRvpRender();
  } catch (e) { /* quiet: try again next time */ }
}

function pdfedRvpKey(ev) { if (ev.key === 'Escape' && !PDFED_RVP.draft) pdfedRvpClose(); }

function pdfedRvpClose(silent) {
  if (PDFED_RVP.link) {
    const ids = PDFED_RVP.comments.filter(function (c) { return c.author_kind === 'client'; }).map(function (c) { return c.id; });
    pdfedRvpSeenAdd(PDFED_RVP.link.id, ids);
    pdfedRvpNewById[PDFED_RVP.link.id] = 0;
  }
  clearInterval(PDFED_RVP.timer);
  document.removeEventListener('keydown', pdfedRvpKey);
  const el = document.getElementById('pdfedRvp');
  if (el) el.remove();
  PDFED_RVP.link = null;
  pdfedRvpDotSync();
}

// ---------- drawing ----------
function pdfedRvpNums(version) {
  const m = {}; let n = 0;
  PDFED_RVP.comments.forEach(function (c) { if (c.version === version) m[c.id] = ++n; });
  return m;
}
function pdfedRvpIsNew(c) { return c.author_kind === 'client' && !PDFED_RVP.seen.has(c.id); }

function pdfedRvpPins(version, pageNo) {
  const nums = pdfedRvpNums(version);
  return PDFED_RVP.comments.filter(function (c) { return c.version === version && c.page === pageNo; }).map(function (c) {
    const cls = 'rvp-pin' + (c.author_kind === 'owner' ? ' own' : '') + (c.status === 'done' ? ' done' : '') +
      (pdfedRvpIsNew(c) ? ' new' : '') + (PDFED_RVP.hl === c.id ? ' hl' : '');
    return '<div class="' + cls + '" data-cid="' + c.id + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%" title="' +
      pdfedRevEsc(c.author_name + ': ' + c.body) + '" onclick="event.stopPropagation();pdfedRvpFocus(\'' + c.id + '\')"><span>' + nums[c.id] + '</span></div>';
  }).join('');
}

function pdfedRvpDraftHtml(pageNo) {
  const d = PDFED_RVP.draft;
  if (!d || d.page !== pageNo) return '';
  return '<div class="rvp-pin own" style="left:' + (d.x * 100) + '%;top:' + (d.y * 100) + '%"><span>+</span></div>' +
    '<div class="rvp-draft" style="left:' + Math.min(d.x * 100, 50) + '%;top:' + Math.min(d.y * 100 + 3, 62) + '%" onclick="event.stopPropagation()">' +
    '<textarea id="pdfedRvpTxt" maxlength="1000" placeholder="Add a note for your client"></textarea>' +
    '<div class="rvp-row"><button class="pdfedrev-btn primary" style="margin:0;width:auto" onclick="pdfedRvpSave()">Add note</button>' +
    '<button class="pdfedrev-btn" onclick="pdfedRvpCancel()">Cancel</button></div></div>';
}

function pdfedRvpPageHtml(pg, version, idx, clickable) {
  const n = idx + 1;
  return '<div class="rvp-pg' + (clickable ? ' click' : '') + '" style="aspect-ratio:' + pg.w + '/' + pg.h + '"' +
    (clickable ? ' onclick="pdfedRvpPick(event,' + n + ')"' : '') + '><img src="' + pg.src + '" alt="Page ' + n + '" draggable="false">' +
    pdfedRvpPins(version, n) + (clickable ? pdfedRvpDraftHtml(n) : '') + '</div>';
}

function pdfedRvpItemHtml(c, num) {
  const isNew = pdfedRvpIsNew(c);
  return '<div class="rvp-cm' + (c.status === 'done' ? ' isdone' : '') + (isNew ? ' nw' : '') + '" onclick="pdfedRvpFocus(\'' + c.id + '\')">' +
    '<div class="rvp-num' + (c.author_kind === 'owner' ? ' own' : '') + (c.status === 'done' ? ' done' : '') + '">' + num + '</div>' +
    '<div class="rvp-ct"><b>' + pdfedRevEsc(c.author_name || 'Client') + '</b> <small>' + (c.author_kind === 'owner' ? 'Your note' : 'Client') + ' · Page ' + c.page + '</small>' +
    (isNew ? '<span class="rvp-nb">NEW</span>' : '') + '<div class="rvp-tx">' + pdfedRevEsc(c.body) + '</div></div>' +
    '<input class="rvp-chk" type="checkbox" title="Mark as done" ' + (c.status === 'done' ? 'checked' : '') +
    ' onclick="event.stopPropagation()" onchange="pdfedRvpTick(\'' + c.id + '\')"></div>';
}

function pdfedRvpListHtml(version) {
  const nums = pdfedRvpNums(version);
  const rows = PDFED_RVP.comments.filter(function (c) { return c.version === version; }).map(function (c) { return pdfedRvpItemHtml(c, nums[c.id]); }).join('');
  return rows || '<p class="rvp-empty">No comments yet.</p>';
}

function pdfedRvpRender() {
  const el = document.getElementById('pdfedRvp');
  const L = PDFED_RVP.link;
  if (!el || !L) return;
  const keep = {};
  ['.rvp-pages', '.rvp-side', '.rvp-cmpwrap'].forEach(function (sel) { const n = el.querySelector(sel); if (n) keep[sel] = n.scrollTop; });

  const cmpMode = PDFED_RVP.mode === 'compare';
  const head = '<div class="rvp-head"><div class="rvp-title">' + pdfedRevEsc(L.title) + '</div>' +
    '<span class="rvp-badge">Version ' + L.version + ' live</span><div class="rvp-sp"></div>' +
    '<button class="pdfedrev-btn" onclick="pdfedRvpToggleCompare()">' + (cmpMode ? 'Back to comments' : 'Compare with previous') + '</button>' +
    '<button class="pdfedrev-btn" onclick="pdfedRvpClose()">Close</button></div>';
  const note = PDFED_RVP.note ? '<div class="rvp-note">' + pdfedRevEsc(PDFED_RVP.note) + '</div>' : '';
  let body;

  if (cmpMode) {
    const pv = L.prev_version || (L.version - 1);
    const prevList = PDFED_RVP.comments.filter(function (c) { return c.version === pv; });
    const done = prevList.filter(function (c) { return c.status === 'done'; }).length;
    const rows = Math.max(PDFED_RVP.prev.length, PDFED_RVP.cur.length);
    let grid = '';
    for (let i = 0; i < rows; i++) {
      grid += '<div class="rvp-cmprow"><div>' + (PDFED_RVP.prev[i] ? pdfedRvpPageHtml(PDFED_RVP.prev[i], pv, i, false) : '') + '</div>' +
        '<div>' + (PDFED_RVP.cur[i] ? pdfedRvpPageHtml(PDFED_RVP.cur[i], L.version, i, false) : '') + '</div></div>';
    }
    body = '<div class="rvp-main"><div class="rvp-cmpwrap"><div class="rvp-cmphead"><span>Version ' + pv + ': what the client reviewed</span><span>Version ' + L.version + ': your new work</span></div>' + grid + '</div>' +
      '<aside class="rvp-side"><div class="rvp-sh">Changes requested in version ' + pv + '</div><div class="rvp-prog">' + done + ' of ' + prevList.length + ' done</div>' + pdfedRvpListHtml(pv) + '</aside></div>';
  } else {
    const cur = PDFED_RVP.comments.filter(function (c) { return c.version === L.version; });
    const done = cur.filter(function (c) { return c.status === 'done'; }).length;
    const pagesHtml = PDFED_RVP.cur.map(function (pg, i) { return pdfedRvpPageHtml(pg, L.version, i, true); }).join('');
    let older = '';
    const vers = {};
    PDFED_RVP.comments.forEach(function (c) { if (c.version < L.version) vers[c.version] = 1; });
    Object.keys(vers).sort(function (a, b) { return b - a; }).forEach(function (v) {
      older += '<div class="rvp-sh" style="margin-top:16px">Older: version ' + v + '</div>' + pdfedRvpListHtml(Number(v));
    });
    body = '<div class="rvp-main"><div class="rvp-pages">' + pagesHtml + '</div>' +
      '<aside class="rvp-side"><div class="rvp-sh">Comments on version ' + L.version + '</div><div class="rvp-prog">' + done + ' of ' + cur.length + ' done</div>' +
      '<p class="rvp-tip">Click anywhere on the work to add your own note.</p>' + pdfedRvpListHtml(L.version) + older + '</aside></div>';
  }
  el.innerHTML = head + note + body;
  Object.keys(keep).forEach(function (sel) { const n = el.querySelector(sel); if (n) n.scrollTop = keep[sel]; });
}

// ---------- actions ----------
function pdfedRvpFocus(id) {
  const c = PDFED_RVP.comments.find(function (x) { return x.id === id; });
  if (!c) return;
  PDFED_RVP.hl = id;
  if (PDFED_RVP.seen && c.author_kind === 'client') {
    PDFED_RVP.seen.add(id);
    pdfedRvpSeenAdd(PDFED_RVP.link.id, [id]);
    const left = PDFED_RVP.comments.filter(function (x) { return x.author_kind === 'client' && !PDFED_RVP.seen.has(x.id); }).length;
    pdfedRvpNewById[PDFED_RVP.link.id] = left;
    pdfedRvpDotSync();
  }
  pdfedRvpRender();
  const pin = document.querySelector('#pdfedRvp .rvp-pin[data-cid="' + id + '"]');
  if (pin && pin.scrollIntoView) pin.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function pdfedRvpPick(ev, pageNo) {
  if (PDFED_RVP.mode !== 'view') return;
  const r = ev.currentTarget.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
  PDFED_RVP.draft = { page: pageNo, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
  pdfedRvpRender();
  const t = document.getElementById('pdfedRvpTxt');
  if (t) t.focus();
}
function pdfedRvpCancel() { PDFED_RVP.draft = null; pdfedRvpRender(); }

async function pdfedRvpSave() {
  const t = document.getElementById('pdfedRvpTxt');
  const body = ((t && t.value) || '').trim();
  const d = PDFED_RVP.draft;
  if (!body || !d) { if (t) t.focus(); return; }
  const sb = window.sarvarcSupabase;
  try {
    const u = await sb.auth.getUser();
    const r = await sb.from('review_comments').insert({
      review_id: PDFED_RVP.link.id, version: PDFED_RVP.link.version, page: d.page, x: d.x, y: d.y,
      author_kind: 'owner', author_name: 'You', body: body
    }).select('*').single();
    if (r.error) throw r.error;
    const c = r.data; c.x = Number(c.x); c.y = Number(c.y); c.page = Number(c.page); c.version = Number(c.version);
    PDFED_RVP.comments.push(c);
    PDFED_RVP.known.add(c.id);
    PDFED_RVP.draft = null;
    pdfedRvpRender();
  } catch (e) {
    toast('Could not add the note: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

async function pdfedRvpTick(id) {
  const c = PDFED_RVP.comments.find(function (x) { return x.id === id; });
  if (!c) return;
  const to = c.status === 'done' ? 'open' : 'done';
  c.status = to;
  pdfedRvpRender();
  const r = await window.sarvarcSupabase.from('review_comments').update({ status: to }).eq('id', id);
  if (r.error) {
    c.status = to === 'done' ? 'open' : 'done';
    pdfedRvpRender();
    toast('Could not update: ' + r.error.message, 'error');
  }
}

async function pdfedRvpToggleCompare() {
  const L = PDFED_RVP.link;
  if (!L) return;
  if (PDFED_RVP.mode === 'compare') { PDFED_RVP.mode = 'view'; PDFED_RVP.note = ''; pdfedRvpRender(); return; }
  if (!L.prev_file_data_url) {
    PDFED_RVP.note = 'There is no earlier version yet. Edit your document, then use Send new version in Send for Review. After that you can compare.';
    pdfedRvpRender();
    return;
  }
  PDFED_RVP.note = 'Loading the earlier version…';
  pdfedRvpRender();
  try {
    if (!PDFED_RVP.prev.length) PDFED_RVP.prev = await pdfedRvpPages(L.prev_file_data_url);
    PDFED_RVP.mode = 'compare';
    PDFED_RVP.note = '';
    pdfedRvpRender();
  } catch (e) {
    PDFED_RVP.note = 'Could not load the earlier version.';
    pdfedRvpRender();
  }
}

// Start checking soon after Workspace opens, then every 30 seconds.
(function () {
  function boot() {
    setTimeout(pdfedRvpPoll, 5000);
    setInterval(function () { if (!document.hidden) pdfedRvpPoll(); }, 30000);
    setInterval(pdfedRvpDotSync, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


/* ===== REVIEW TAB INSIDE THE PDF EDITOR (docked, no full-screen cover) =====
   The right panel of the PDF Editor has a Review tab. It lists the client's comments with a Done tick,
   clicking a comment jumps the editor to that page and shows a pin where the client pointed, and you can
   add your own note on the page. Pins are shown only while the Review tab is open and are never exported.
   Compare with previous still opens the full-screen view above.
   Pins sit on the page the client saw. If you add or remove pages, a pin can land on a different page. */
const PDFED_RVD = { link: null, comments: [], seen: new Set(), timer: null, hl: null, pick: false, draft: null, note: '', busy: false, docId: null, confirm: null, drag: null, justDragged: false };

function pdfedRvdActive() {
  const p = document.getElementById('pdfedReviewPanel');
  return !!p && p.style.display !== 'none';
}
function pdfedRvdSheetHtml(label) {
  return '<div class="rvd-sheet"><i></i><i></i><i></i><b>' + label + '</b></div>';
}
function pdfedRvdMsg(html) {
  const el = document.getElementById('pdfedReviewPanel');
  if (el) el.innerHTML = '<div class="rvd-empty">' + pdfedRvdSheetHtml('REVIEW') + '<p>' + html + '</p></div>';
}

async function pdfedOpenReviewDock() {
  const saved = pdfedRevReadMap()[pdfedRevDocKey()];
  if (!saved) { toast('Publish a review link first', 'info'); return; }
  pdfedRevCloseModal();
  const layout = document.getElementById('pdfedLayout');
  if (layout && layout.classList.contains('right-collapsed') && typeof pdfedToggleRightPanel === 'function') pdfedToggleRightPanel(true);
  pdfedShowRightTab('review');
}

async function pdfedRvdShow() {
  const saved = pdfedRevReadMap()[pdfedRevDocKey()];
  if (!saved) {
    PDFED_RVD.link = null; PDFED_RVD.comments = []; PDFED_RVD.docId = null;
    pdfedRvdMsg('No review link for this document yet. Click <b>Send for Review</b> in the top bar and publish a link. Your client\'s comments will show up here.');
    pdfedRvdPinsSync();
    return;
  }
  if (PDFED_RVD.docId !== saved.id) {
    PDFED_RVD.link = null; PDFED_RVD.comments = []; PDFED_RVD.hl = null; PDFED_RVD.draft = null; PDFED_RVD.note = '';
    pdfedRvdPickOff();
  }
  PDFED_RVD.docId = saved.id;
  if (!PDFED_RVD.link) pdfedRvdMsg('Loading comments…');
  await pdfedRvdLoad(saved.id);
  clearInterval(PDFED_RVD.timer);
  PDFED_RVD.timer = setInterval(function () { pdfedRvdRefresh(false); }, 20000);
}

function pdfedRvdHide() {
  clearInterval(PDFED_RVD.timer); PDFED_RVD.timer = null;
  pdfedRvdPickOff();
  pdfedRvdPinsSync();
}

async function pdfedRvdLoad(id) {
  const sb = window.sarvarcSupabase;
  if (!sb) { pdfedRvdMsg('Sign in to Workspace to see your review comments.'); return; }
  try {
    // file_data_url is only used as a filter here (not downloaded): no file means the link was taken offline.
    const lr = await sb.from('review_links')
      .select('id, title, version, page_count, status, expires_at, share_slug, prev_version')
      .eq('id', id).not('file_data_url', 'is', null).maybeSingle();
    if (lr.error) throw lr.error;
    if (!lr.data) {
      PDFED_RVD.link = null; PDFED_RVD.comments = [];
      pdfedRvdMsg('This review link is no longer online. Publish it again from <b>Send for Review</b>.');
      pdfedRvdPinsSync();
      return;
    }
    const cr = await sb.from('review_comments').select('*').eq('review_id', id).order('created_at', { ascending: true });
    if (cr.error) throw cr.error;
    PDFED_RVD.link = lr.data;
    PDFED_RVD.comments = (cr.data || []).map(function (c) {
      c.x = Number(c.x); c.y = Number(c.y); c.page = Number(c.page); c.version = Number(c.version); return c;
    });
    PDFED_RVD.link.version = Number(PDFED_RVD.link.version);
    PDFED_RVD.seen = pdfedRvpSeenGet(id);
    pdfedRvdRender();
    pdfedRvdPinsSync();
  } catch (e) {
    console.error('[Review tab]', e);
    pdfedRvdMsg('Could not load comments: ' + pdfedRevEsc(e && e.message ? e.message : 'unknown error') + '. Check that 10-review-compare.sql was run.');
  }
}

async function pdfedRvdRefresh(manual) {
  if (!pdfedRvdActive() || !PDFED_RVD.docId || PDFED_RVD.busy) return;
  const t = document.getElementById('pdfedRvdTxt');
  if (!manual && t && t.value.trim()) return; // never wipe a note that is being typed
  PDFED_RVD.busy = true;
  try { await pdfedRvdLoad(PDFED_RVD.docId); } finally { PDFED_RVD.busy = false; }
}

function pdfedRvdIsNew(c) { return c.author_kind === 'client' && !PDFED_RVD.seen.has(c.id); }

function pdfedRvdNums(version) {
  const m = {}; let n = 0;
  PDFED_RVD.comments.forEach(function (c) { if (c.version === version) m[c.id] = ++n; });
  return m;
}

function pdfedRvdItemHtml(c, num) {
  const isNew = pdfedRvdIsNew(c), isDone = c.status === 'done', own = c.author_kind === 'owner';
  return '<div class="rvd-card' + (isDone ? ' isdone' : '') + (isNew ? ' nw' : '') + (PDFED_RVD.hl === c.id ? ' hl' : '') + '" onclick="pdfedRvdFocus(\'' + c.id + '\')">' +
    '<div class="rvd-flag' + (own ? ' own' : '') + (isDone ? ' done' : '') + '">' + num + '</div>' +
    '<div class="rvd-ct"><div class="rvd-who"><b>' + pdfedRevEsc(c.author_name || 'Client') + '</b><small>' + (own ? 'Your note' : 'Client') + ' · Page ' + c.page + '</small>' +
    (isNew ? '<span class="rvd-new">NEW</span>' : '') + '</div><div class="rvd-tx">' + pdfedRevEsc(c.body) + '</div>' +
    (PDFED_RVD.confirm === c.id
      ? '<div class="rvd-conf" onclick="event.stopPropagation()"><span>Delete this note? This cannot be undone.</span>' +
        '<button class="rvd-btn solid sm" onclick="pdfedRvdDelete(\'' + c.id + '\')">Delete</button>' +
        '<button class="rvd-btn sm" onclick="pdfedRvdAskDelete(null)">Keep</button></div>'
      : '') + '</div>' +
    (PDFED_RVD.confirm === c.id ? '' :
      '<button class="rvd-del" title="Delete note" aria-label="Delete note" onclick="event.stopPropagation();pdfedRvdAskDelete(\'' + c.id + '\')">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>') +
    '<button class="rvd-check' + (isDone ? ' on' : '') + '" title="' + (isDone ? 'Mark as not done' : 'Mark as done') + '" onclick="event.stopPropagation();pdfedRvdTick(\'' + c.id + '\')">' +
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button></div>';
}

function pdfedRvdListHtml(version) {
  const nums = pdfedRvdNums(version);
  const rows = PDFED_RVD.comments.filter(function (c) { return c.version === version; })
    .map(function (c) { return pdfedRvdItemHtml(c, nums[c.id]); }).join('');
  return rows || '<p class="rvd-hint">No comments on this version yet. When your client pins something, it lands here.</p>';
}

function pdfedRvdRender() {
  const el = document.getElementById('pdfedReviewPanel');
  const L = PDFED_RVD.link;
  if (!el || !L || !pdfedRvdActive()) return;
  const keepEl = document.getElementById('pdfedRvdTxt');
  const keepTxt = keepEl ? keepEl.value : '';
  const keepScroll = el.scrollTop;
  const cur = PDFED_RVD.comments.filter(function (c) { return c.version === L.version; });
  const done = cur.filter(function (c) { return c.status === 'done'; }).length;
  const pct = cur.length ? Math.round((done / cur.length) * 100) : 0;

  let older = '';
  const vers = {};
  PDFED_RVD.comments.forEach(function (c) { if (c.version < L.version) vers[c.version] = 1; });
  Object.keys(vers).sort(function (a, b) { return b - a; }).forEach(function (v) {
    older += '<details class="rvd-older"><summary>Older: version ' + v + '</summary>' + pdfedRvdListHtml(Number(v)) + '</details>';
  });

  const draft = PDFED_RVD.draft
    ? '<div class="rvd-draft"><div class="rvd-dh">New note on page ' + PDFED_RVD.draft.page + '. Your client can see it.</div>' +
      '<textarea id="pdfedRvdTxt" maxlength="1000" placeholder="Add a note for your client"></textarea>' +
      '<div class="rvd-row"><button class="rvd-btn primary" onclick="pdfedRvdSave()">Add note</button>' +
      '<button class="rvd-btn" onclick="pdfedRvdCancel()">Cancel</button></div></div>'
    : '';
  const note = PDFED_RVD.note ? '<div class="rvd-note">' + pdfedRevEsc(PDFED_RVD.note) + '</div>' : '';

  el.innerHTML =
    '<div class="rvd-head">' + pdfedRvdSheetHtml('V' + L.version) +
      '<div class="rvd-hinfo"><div class="rvd-title">' + pdfedRevEsc(L.title) + '</div><span class="rvd-live">Version ' + L.version + ' live</span></div></div>' +
    '<div class="rvd-progress"><div class="rvd-ptxt"><b>' + done + ' of ' + cur.length + '</b> done</div><div class="rvd-pbar"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="rvd-row">' +
      '<button class="rvd-btn primary" onclick="pdfedRvdPickToggle()">' + (PDFED_RVD.pick ? 'Cancel pin' : '+ Note on page') + '</button>' +
      '<button class="rvd-btn" onclick="pdfedRvdCompare()">Compare</button>' +
      '<button class="rvd-link" onclick="pdfedRvdRefresh(true)">Refresh</button></div>' +
    note + draft +
    '<div class="rvd-sh">Comments on version ' + L.version + '</div>' +
    pdfedRvdListHtml(L.version) + older +
    '<p class="rvd-hint">Click a comment to jump to it on your page. Drag your own notes to move them; you can delete any note. Pins show only while this tab is open and are never in your exported PDF.</p>';

  const t = document.getElementById('pdfedRvdTxt');
  if (t) { if (keepTxt) t.value = keepTxt; if (!keepEl) t.focus(); }
  el.scrollTop = keepScroll;
}

// ---------- pins on the live editor page ----------
function pdfedRvdPinsSync() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap || PDFED_RVD.drag) return;   // never redraw the pins in the middle of a drag
  let layer = document.getElementById('pdfedRvdPins');
  const L = PDFED_RVD.link;
  const ready = pdfedRvdActive() && L && typeof pdfed !== 'undefined' && pdfed.pages && pdfed.active >= 0;
  if (!ready) { if (layer) layer.innerHTML = ''; return; }
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'pdfedRvdPins';
    layer.className = 'rvd-layer';
    layer.addEventListener('pointerdown', pdfedRvdPinDown);
    wrap.appendChild(layer);
  }
  const page = pdfed.active + 1;
  const nums = pdfedRvdNums(L.version);
  let html = PDFED_RVD.comments.filter(function (c) { return c.version === L.version && c.page === page; }).map(function (c) {
    const cls = 'rvp-pin rvd-pin' + (c.author_kind === 'owner' ? ' own' : '') + (c.status === 'done' ? ' done' : '') +
      (pdfedRvdIsNew(c) ? ' new' : '') + (PDFED_RVD.hl === c.id ? ' hl' : '') + (c.author_kind === 'owner' ? ' rvd-drag' : '');
    return '<div class="' + cls + '" data-cid="' + c.id + '"' + (c.author_kind === 'owner' ? ' data-drag="1"' : '') + ' style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%" title="' +
      pdfedRevEsc(c.author_name + ': ' + c.body) + (c.author_kind === 'owner' ? ' (drag to move)' : '') + '" onclick="event.stopPropagation();if(!PDFED_RVD.justDragged)pdfedRvdFocus(\'' + c.id + '\')"><span>' + nums[c.id] + '</span></div>';
  }).join('');
  const d = PDFED_RVD.draft;
  if (d && d.page === page) html += '<div class="rvp-pin rvd-pin own" style="left:' + (d.x * 100) + '%;top:' + (d.y * 100) + '%"><span>+</span></div>';
  layer.innerHTML = html;
}

function pdfedRvdInitObserver() {
  const lab = document.getElementById('pdfedPageLabel');
  if (!lab || lab.dataset.rvdObs) return;
  lab.dataset.rvdObs = '1';
  new MutationObserver(function () { pdfedRvdPinsSync(); }).observe(lab, { childList: true, characterData: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pdfedRvdInitObserver);
else pdfedRvdInitObserver();

// ---------- actions ----------
async function pdfedRvdFocus(id) {
  const c = PDFED_RVD.comments.find(function (x) { return x.id === id; });
  const L = PDFED_RVD.link;
  if (!c || !L) return;
  PDFED_RVD.hl = id;
  if (c.author_kind === 'client' && !PDFED_RVD.seen.has(id)) {
    PDFED_RVD.seen.add(id);
    pdfedRvpSeenAdd(L.id, [id]);
    const left = PDFED_RVD.comments.filter(function (x) { return x.author_kind === 'client' && !PDFED_RVD.seen.has(x.id); }).length;
    pdfedRvpNewById[L.id] = left;
    pdfedRvpDotSync();
  }
  if (c.version !== L.version) {
    toast('That comment is on an older version of the work', 'info');
  } else if (typeof pdfedGoto === 'function' && pdfed.pages && pdfed.pages[c.page - 1]) {
    if (pdfed.active !== c.page - 1) { try { await pdfedGoto(c.page - 1); } catch (e) { /* keep going, the list still updates */ } }
  } else if (c.version === L.version) {
    toast('Page ' + c.page + ' is not in your document any more', 'info');
  }
  pdfedRvdRender();
  pdfedRvdPinsSync();
  const pin = document.querySelector('#pdfedRvdPins .rvd-pin[data-cid="' + id + '"]');
  if (pin && pin.scrollIntoView) pin.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

async function pdfedRvdTick(id) {
  const c = PDFED_RVD.comments.find(function (x) { return x.id === id; });
  if (!c) return;
  const to = c.status === 'done' ? 'open' : 'done';
  c.status = to;
  pdfedRvdRender(); pdfedRvdPinsSync();
  const r = await window.sarvarcSupabase.from('review_comments').update({ status: to }).eq('id', id);
  if (r.error) {
    c.status = to === 'done' ? 'open' : 'done';
    pdfedRvdRender(); pdfedRvdPinsSync();
    toast('Could not update: ' + r.error.message, 'error');
  }
}

// "Add note on page": the next click on the editor page drops a pin there.
function pdfedRvdPickEvt(ev) {
  if (!PDFED_RVD.pick) return;
  if (ev.target && ev.target.closest && ev.target.closest('.rvd-pin')) return;
  ev.stopPropagation();
  if (ev.type !== 'click') return;
  ev.preventDefault();
  const wrap = document.getElementById('pdfedCanvasWrap');
  const r = wrap ? wrap.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height) return;
  const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
  PDFED_RVD.draft = { page: pdfed.active + 1, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
  pdfedRvdPickOff();
  pdfedRvdRender(); pdfedRvdPinsSync();
}
function pdfedRvdPickKey(ev) { if (ev.key === 'Escape' && PDFED_RVD.pick) { pdfedRvdPickOff(); pdfedRvdRender(); } }
function pdfedRvdPickOn() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap || !pdfed.pages || pdfed.active < 0) { toast('Open a page first', 'info'); return; }
  PDFED_RVD.pick = true; PDFED_RVD.draft = null;
  PDFED_RVD.note = 'Click the spot on your page where the note should go. Press Esc to cancel.';
  wrap.classList.add('rvd-picking');
  ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (t) { wrap.addEventListener(t, pdfedRvdPickEvt, true); });
  document.addEventListener('keydown', pdfedRvdPickKey);
}
function pdfedRvdPickOff() {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (wrap) {
    wrap.classList.remove('rvd-picking');
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (t) { wrap.removeEventListener(t, pdfedRvdPickEvt, true); });
  }
  document.removeEventListener('keydown', pdfedRvdPickKey);
  if (PDFED_RVD.pick) { PDFED_RVD.pick = false; PDFED_RVD.note = ''; }
}
function pdfedRvdPickToggle() {
  if (PDFED_RVD.pick) { pdfedRvdPickOff(); pdfedRvdRender(); return; }
  pdfedRvdPickOn(); pdfedRvdRender();
}
function pdfedRvdCancel() { PDFED_RVD.draft = null; pdfedRvdRender(); pdfedRvdPinsSync(); }

async function pdfedRvdSave() {
  const t = document.getElementById('pdfedRvdTxt');
  const body = ((t && t.value) || '').trim();
  const d = PDFED_RVD.draft;
  if (!body || !d || !PDFED_RVD.link) { if (t) t.focus(); return; }
  try {
    const r = await window.sarvarcSupabase.from('review_comments').insert({
      review_id: PDFED_RVD.link.id, version: PDFED_RVD.link.version, page: d.page, x: d.x, y: d.y,
      author_kind: 'owner', author_name: 'You', body: body
    }).select('*').single();
    if (r.error) throw r.error;
    const c = r.data; c.x = Number(c.x); c.y = Number(c.y); c.page = Number(c.page); c.version = Number(c.version);
    PDFED_RVD.comments.push(c);
    PDFED_RVD.draft = null;
    pdfedRvdRender(); pdfedRvdPinsSync();
  } catch (e) {
    toast('Could not add the note: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

// ---------- delete a note (any note on your own link; asks first) ----------
function pdfedRvdAskDelete(id) {
  PDFED_RVD.confirm = id;
  pdfedRvdRender();
}
async function pdfedRvdDelete(id) {
  const c = PDFED_RVD.comments.find(function (x) { return x.id === id; });
  PDFED_RVD.confirm = null;
  if (!c) { pdfedRvdRender(); return; }
  const r = await window.sarvarcSupabase.from('review_comments').delete().eq('id', id);
  if (r.error) {
    pdfedRvdRender();
    toast('Could not delete the note: ' + r.error.message, 'error');
    return;
  }
  PDFED_RVD.comments = PDFED_RVD.comments.filter(function (x) { return x.id !== id; });
  if (PDFED_RVD.hl === id) PDFED_RVD.hl = null;
  pdfedRvdRender(); pdfedRvdPinsSync();
}

// ---------- drag your own notes on the page ----------
// Only your own notes move. A client's pin always stays where the client pointed (the database enforces this too).
function pdfedRvdPinDown(ev) {
  const pin = ev.target && ev.target.closest ? ev.target.closest('.rvd-pin[data-drag="1"]') : null;
  if (!pin || ev.button !== 0) return;
  ev.stopPropagation(); ev.preventDefault();
  PDFED_RVD.drag = { id: pin.getAttribute('data-cid'), el: pin, sx: ev.clientX, sy: ev.clientY, moved: false, ghost: null, pid: ev.pointerId };
  document.addEventListener('pointermove', pdfedRvdPinMove);
  document.addEventListener('pointerup', pdfedRvdPinUp);
  document.addEventListener('pointercancel', pdfedRvdPinCancel);
}
function pdfedRvdPinMove(ev) {
  const d = PDFED_RVD.drag;
  if (!d || ev.pointerId !== d.pid) return;
  if (!d.moved) {
    if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) < 6) return;
    d.moved = true;
    const g = d.el.cloneNode(true);
    g.classList.add('ghost');
    ['data-cid', 'data-drag', 'title', 'onclick'].forEach(function (a) { g.removeAttribute(a); });
    document.body.appendChild(g); d.ghost = g;
    d.el.classList.add('lifted'); document.body.classList.add('rvd-dragging');
  }
  ev.preventDefault();
  d.ghost.style.left = ev.clientX + 'px'; d.ghost.style.top = ev.clientY + 'px';
}
function pdfedRvdPinEnd() {
  const d = PDFED_RVD.drag;
  document.removeEventListener('pointermove', pdfedRvdPinMove);
  document.removeEventListener('pointerup', pdfedRvdPinUp);
  document.removeEventListener('pointercancel', pdfedRvdPinCancel);
  if (d) {
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.el) d.el.classList.remove('lifted');
  }
  document.body.classList.remove('rvd-dragging');
  PDFED_RVD.drag = null;
  return d;
}
function pdfedRvdPinCancel() { pdfedRvdPinEnd(); pdfedRvdPinsSync(); }
async function pdfedRvdPinUp(ev) {
  const d = PDFED_RVD.drag;
  if (!d || ev.pointerId !== d.pid) return;
  pdfedRvdPinEnd();
  if (!d.moved) { pdfedRvdFocus(d.id); return; }          // a plain click still jumps to the note
  PDFED_RVD.justDragged = true; setTimeout(function () { PDFED_RVD.justDragged = false; }, 0);
  const c = PDFED_RVD.comments.find(function (x) { return x.id === d.id; });
  const wrap = document.getElementById('pdfedCanvasWrap');
  const r = wrap ? wrap.getBoundingClientRect() : null;
  if (!c || !r || !r.width || !r.height) { pdfedRvdPinsSync(); return; }
  const out = Math.max(r.left - ev.clientX, ev.clientX - r.right, r.top - ev.clientY, ev.clientY - r.bottom);
  if (out > 40) { pdfedRvdPinsSync(); return; }            // dropped well away from the page: it goes back
  const x = Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 10000) / 10000;
  const y = Math.round(Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) * 10000) / 10000;
  if (Math.abs(x - c.x) < 0.002 && Math.abs(y - c.y) < 0.002) { pdfedRvdPinsSync(); return; }
  const prev = { x: c.x, y: c.y };
  c.x = x; c.y = y;
  pdfedRvdPinsSync();
  const res = await window.sarvarcSupabase.from('review_comments').update({ x: x, y: y }).eq('id', c.id);
  if (res.error) {
    c.x = prev.x; c.y = prev.y;
    pdfedRvdPinsSync();
    toast('Could not move the note: ' + res.error.message + '. Check that 11-review-drag-delete.sql was run.', 'error');
  }
}

// Compare keeps the full-screen view (two versions side by side need the room).
async function pdfedRvdCompare() {
  await pdfedOpenReviewPanel();
  if (PDFED_RVP.link) pdfedRvpToggleCompare();
}
