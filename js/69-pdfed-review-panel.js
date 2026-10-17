/* ===== PDF EDITOR > REVIEW PANEL =====
   Where you read what your client pinned on your work.
     - Pages of the live version with numbered pins (client = blue, your own notes = steel, done = green)
     - A comment list with a Done tick for each comment, NEW tags for unread ones
     - Click anywhere on a page to add your own optional note (the client can see it too)
     - Compare: the version the client reviewed beside your new version, with the checklist
     - A quiet check every 30 seconds while Workspace is open: red count on the Send for Review
       button and a small notice when a new comment arrives

   Needs: js/68-pdfed-send-to-review.js, js/65-sign-doc-core.js (page drawing),
          supabase/09-review-links.sql and supabase/10-review-compare.sql.
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
