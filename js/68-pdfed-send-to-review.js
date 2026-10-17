/* ===== PDF EDITOR > SEND FOR REVIEW =====
   One button in the PDF Editor top bar (next to Send for Signing). It turns the document you are
   editing into a PDF, publishes it as a review link, and gives you the link to send to your client.
   The client opens the link, pins comments on exact spots, and you see them back in the Review
   panel (js/69-pdfed-review-panel.js).

   Needs: js/67-pdfed-send-to-sign.js (it reuses the page-to-PDF builder),
          supabase/09-review-links.sql and supabase/10-review-compare.sql.
   Sending again from the same document keeps the SAME link and moves the version number up by 1.
*/

const PDFED_REVIEW_STORE = 'sarvarcReviewLinks';   // remembers {document name -> link} on this device

function pdfedRevEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pdfedRevBaseUrl() {
  return window.SARVARC_REVIEW_PUBLIC_BASE_URL || window.SARVARC_SIGN_PUBLIC_BASE_URL || 'https://sarvarc-review.pages.dev';
}
function pdfedRevLink(slug) { return pdfedRevBaseUrl() + '/review.html?s=' + slug; }
function pdfedRevNewSlug() { return 'rv' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5); }
function pdfedRevDocKey() { return (pdfed.file && pdfed.file.name) ? pdfed.file.name : 'Document'; }
function pdfedRevReadMap() {
  try { return JSON.parse(localStorage.getItem(PDFED_REVIEW_STORE) || '{}') || {}; } catch (e) { return {}; }
}
function pdfedRevWriteMap(m) {
  try { localStorage.setItem(PDFED_REVIEW_STORE, JSON.stringify(m)); } catch (e) { /* storage blocked, ignore */ }
}

function pdfedRevCloseModal() {
  const m = document.getElementById('pdfedRevModal');
  if (m) m.remove();
}

function pdfedOpenSendReview() {
  if (!pdfed.pages.length) { toast('Open a PDF first', 'error'); return; }
  if (pdfedLiveBlock()) return;   // live clips cannot live inside a still PDF
  pdfedRevCloseModal();

  const key = pdfedRevDocKey();
  const saved = pdfedRevReadMap()[key] || null;
  const base = key.replace(/\.[^.]+$/, '') || 'Document';
  const title = (saved && saved.title) || base;
  const days = saved && saved.days != null ? saved.days : 14;

  const wrap = document.createElement('div');
  wrap.id = 'pdfedRevModal';
  wrap.className = 'pdfedrev-overlay';
  wrap.innerHTML =
    '<div class="pdfedrev-card" role="dialog" aria-label="Send for Review">' +
      '<button class="pdfedrev-x" onclick="pdfedRevCloseModal()" aria-label="Close">&times;</button>' +
      '<h3>Send for Review</h3>' +
      '<p class="pdfedrev-sub">Your client opens a link, clicks on the exact spot, and leaves a comment. Anyone who has the link can view the work and the comments, including any notes you add yourself.</p>' +
      '<label class="pdfedrev-lbl" for="pdfedRevTitle">Name shown to your client</label>' +
      '<input id="pdfedRevTitle" class="pdfedrev-in" type="text" maxlength="120" value="' + pdfedRevEsc(title) + '">' +
      '<label class="pdfedrev-lbl" for="pdfedRevDays">Link stays open for</label>' +
      '<select id="pdfedRevDays" class="pdfedrev-in">' +
        [[7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Until I take it offline']].map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === days ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<div id="pdfedRevLinkBox" class="pdfedrev-linkbox"' + (saved ? '' : ' style="display:none"') + '>' +
        '<div class="pdfedrev-linkrow"><input id="pdfedRevLinkIn" class="pdfedrev-in" type="text" readonly value="' + (saved ? pdfedRevEsc(pdfedRevLink(saved.slug)) : '') + '">' +
        '<button class="pdfedrev-btn" onclick="pdfedRevCopy()">Copy</button></div>' +
        '<div id="pdfedRevVer" class="pdfedrev-ver">' + (saved ? 'Version ' + saved.version + ' is live' : '') + '</div>' +
        '<div class="pdfedrev-acts"><button class="pdfedrev-btn" onclick="pdfedOpenReviewPanel()">Open comments</button>' +
        '<button class="pdfedrev-btn danger" onclick="pdfedRevTakeOffline()">Take offline</button></div>' +
      '</div>' +
      '<button id="pdfedRevGo" class="pdfedrev-btn primary" onclick="pdfedRevPublish()">' + (saved ? 'Send new version (same link)' : 'Publish link') + '</button>' +
    '</div>';
  wrap.addEventListener('click', function (e) { if (e.target === wrap) pdfedRevCloseModal(); });
  document.body.appendChild(wrap);
}

async function pdfedRevCopy() {
  const el = document.getElementById('pdfedRevLinkIn');
  if (!el || !el.value) return;
  try { await navigator.clipboard.writeText(el.value); toast('Link copied', 'success'); }
  catch (e) { el.select(); toast('Press Ctrl+C to copy the link', 'info'); }
}

async function pdfedRevTakeOffline() {
  const key = pdfedRevDocKey();
  const map = pdfedRevReadMap();
  const saved = map[key];
  if (!saved) return;
  if (!confirm('Take this review link offline?\n\nYour client will no longer be able to open it, and the file and all comments are deleted from the server.')) return;
  const sb = window.sarvarcSupabase;
  try {
    if (!sb) throw new Error('Not connected. Please refresh the page.');
    const r = await sb.from('review_links').delete().eq('id', saved.id);
    if (r.error) throw r.error;
    delete map[key];
    pdfedRevWriteMap(map);
    pdfedRevCloseModal();
    if (typeof pdfedRvpDotSync === 'function') pdfedRvpDotSync();
    toast('Review link taken offline', 'success');
  } catch (e) {
    toast('Could not take it offline: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

async function pdfedRevPublish() {
  const goBtn = document.getElementById('pdfedRevGo');
  const title = ((document.getElementById('pdfedRevTitle') || {}).value || '').trim() || 'Untitled work';
  const days = parseInt((document.getElementById('pdfedRevDays') || {}).value, 10) || 0;

  if (typeof pdfedSendSignBuildPdf !== 'function') {
    toast('Send for Review did not load fully. Please refresh the page.', 'error');
    return;
  }
  const sb = window.sarvarcSupabase;
  if (!sb) { toast('Not connected. Please refresh the page.', 'error'); return; }
  let user = null;
  try { const u = await sb.auth.getUser(); user = u && u.data && u.data.user; } catch (e) { /* handled below */ }
  if (!user) { toast('Please log in first to send for review', 'error'); return; }

  if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Preparing…'; }
  // Same preparation Export does, so nothing you were mid-way through is lost.
  pdfedAutoStampPendingGhost();
  await pdfedFinalizePendingCanvasTint();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }

  const maxBytes = window.sgdMaxBytes || 3 * 1024 * 1024;
  const indices = pdfed.pages.map(function (_, i) { return i; });
  pdfedRevCloseModal();
  showExportOverlay('Sending for review…', 'Preparing your document…');
  try {
    let blob = null;
    for (let a = 0; a < PDFED_SIGN_ATTEMPTS.length && !blob; a++) {
      const label = a === 0 ? 'Rendering page ' : 'Making the file smaller, page ';
      const out = await pdfedSendSignBuildPdf(indices, PDFED_SIGN_ATTEMPTS[a], maxBytes, function (k, n) {
        updateExportProgress(((a + k / n) / PDFED_SIGN_ATTEMPTS.length) * 80, label + (k + 1) + ' of ' + n + '…');
      });
      if (out && out.size <= maxBytes) blob = out;
    }
    if (!blob) {
      hideExportOverlay();
      toast('This document is too big for a review link (limit 3 MB). Delete a few pages or remove large images, then try again.', 'error');
      return;
    }
    updateExportProgress(88, 'Publishing…');
    const dataUrl = await pdfedSendSignReadDataUrl(blob);
    const fileUrl = 'data:application/pdf;base64,' + String(dataUrl).split(',')[1];

    const key = pdfedRevDocKey();
    const map = pdfedRevReadMap();
    const saved = map[key] || null;
    const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const payload = {
      owner_id: user.id, title: title, file_data_url: fileUrl, page_count: indices.length,
      status: 'active', expires_at: expires
    };

    let row = null, version = 1;
    if (saved && saved.id) {
      // Same link, next version. If the old row is gone (taken offline), fall through and make a new one.
      const cur = await sb.from('review_links').select('id, share_slug, version').eq('id', saved.id).maybeSingle();
      if (cur && cur.data) {
        version = (cur.data.version || 1) + 1;
        payload.version = version;
        const up = await sb.from('review_links').update(payload).eq('id', saved.id).select('id, share_slug').single();
        if (up.error) throw up.error;
        row = up.data;
      }
    }
    if (!row) {
      payload.share_slug = pdfedRevNewSlug();
      payload.version = 1;
      const ins = await sb.from('review_links').insert(payload).select('id, share_slug').single();
      if (ins.error) throw ins.error;
      row = ins.data; version = 1;
    }

    map[key] = { id: row.id, slug: row.share_slug, version: version, title: title, days: days };
    pdfedRevWriteMap(map);
    hideExportOverlay();
    try { if (typeof swTrack === 'function') swTrack('pdf_send_for_review', { module: 'pdf_editor' }); } catch (e) { /* ignore */ }

    if (typeof pdfedRvpPoll === 'function') pdfedRvpPoll();
    pdfedOpenSendReview();   // reopen: now shows the link and "Version N is live"
    try { await navigator.clipboard.writeText(pdfedRevLink(row.share_slug)); toast(version > 1 ? 'Version ' + version + ' sent! Link copied' : 'Published! Link copied', 'success'); }
    catch (e) { toast(version > 1 ? 'Version ' + version + ' sent!' : 'Published!', 'success'); }
  } catch (e) {
    hideExportOverlay();
    console.error('[Send for Review]', e);
    toast('Could not send for review: ' + (e && e.message ? e.message : 'unknown error. Check that 09-review-links.sql was run.'), 'error');
  }
}

// The button follows the Export button: visible exactly when a document is open.
(function () {
  function sync() {
    const ex = document.getElementById('pdfedExportBtn');
    const rv = document.getElementById('pdfedSendReviewBtn');
    if (!ex || !rv) return;
    rv.style.display = ex.style.display === 'none' ? 'none' : '';
    if (typeof pdfedRvpDotSync === 'function') pdfedRvpDotSync();
  }
  function boot() {
    const ex = document.getElementById('pdfedExportBtn');
    if (!ex) return;
    new MutationObserver(sync).observe(ex, { attributes: true, attributeFilter: ['style'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
