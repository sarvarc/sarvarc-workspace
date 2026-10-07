  // ---- EXPORT GATE ----
  // Every real "download the finished file" button in the app (PDF/DOCX/XLSX/
  // image/video/chart exports across Workspace, Data Arrangement, Make Forms,
  // Diagrams & Graphs, Redact PII) is routed through this one function instead
  // of duplicating an auth check in each export handler. Saving a .sw project
  // file and "Save Your Workflow" are deliberately NOT gated — those are local
  // project saves, not finished deliverables, and stay free exactly as today.
  //
  // Policy: the FIRST export on a given browser is free and runs immediately,
  // but comes out with a small "SARVARC — Free Export" watermark stamped onto
  // it (see sarvarcStampPdfWatermark / sarvarcStampCanvasWatermark below).
  // From the SECOND export onward, logged-out users are stopped before
  // anything is generated and sent to sign up / log in — once they do, the
  // SAME export automatically fires (watermark-free), so nobody has to click
  // twice. Logged-in users always export watermark-free, every time.
  const SARVARC_FREE_EXPORT_KEY = 'sarvarc_free_export_count';
  const SARVARC_FREE_EXPORT_LIMIT = 5;
  let sarvarcPendingExportAction = null;
  // Read by the export functions themselves right before they finalize a
  // file (pdf.save / canvas.toBlob / canvas.toDataURL) to decide whether to
  // stamp the free-tier watermark onto this particular export.
  window.sarvarcApplyFreeWatermark = false;

  function sarvarcFreeExportCount() {
    try {
      const n = parseInt(localStorage.getItem(SARVARC_FREE_EXPORT_KEY), 10);
      return isNaN(n) ? 0 : n;
    } catch (e) { return 0; } // storage unavailable (private mode etc) — fail open to 0 used
  }
  function sarvarcHasUsedFreeExport() {
    return sarvarcFreeExportCount() >= SARVARC_FREE_EXPORT_LIMIT;
  }
  function sarvarcMarkFreeExportUsed() {
    try { localStorage.setItem(SARVARC_FREE_EXPORT_KEY, String(sarvarcFreeExportCount() + 1)); } catch (e) {}
  }

  async function sarvarcGateExport(actionFn) {
    // If the sign-in service can't be reached (offline, blocked script, ad-blocker, file opened locally),
    // treat the person as a guest instead of throwing, otherwise the Export click silently does nothing.
    let user = null;
    try {
      const res = await Promise.race([
        sarvarcSupabase.auth.getUser(),
        new Promise(function (r) { setTimeout(function () { r(null); }, 4000); })
      ]);
      user = (res && res.data && res.data.user) || null;
    } catch (e) { console.warn('[Workspace] sign-in check unavailable, exporting as guest', e); }
    if (user) {
      window.sarvarcApplyFreeWatermark = false;
      await actionFn();
      return;
    }
    if (!sarvarcHasUsedFreeExport()) {
      // Within the first SARVARC_FREE_EXPORT_LIMIT exports on this browser:
      // let it through, watermarked, no account required.
      sarvarcMarkFreeExportUsed();
      window.sarvarcApplyFreeWatermark = true;
      // Waited on, not fire-and-forget: most exports finish almost
      // instantly so this barely mattered before, but a Slideshow Clip can
      // take real wall-clock time to record. Without this await, the
      // "Export complete" message below fired the instant the action
      // *started*, not when a file actually existed yet.
      await actionFn();
      const remaining = SARVARC_FREE_EXPORT_LIMIT - sarvarcFreeExportCount();
      if (typeof toast === 'function') {
        toast(remaining > 0
          ? ('Export complete — it includes a small SARVARC watermark. ' + remaining + ' free export' + (remaining !== 1 ? 's' : '') + ' left before you\'ll need to sign up.')
          : 'Export complete — that was your last free export. Sign up free to keep exporting, watermark-free.', 'info');
      }
      return;
    }
    // All free exports used — gate.
    window.sarvarcApplyFreeWatermark = false;
    sarvarcPendingExportAction = actionFn;
    sarvarcAuthOpenModal('signup');
    document.getElementById('sarvarcAuthNote').textContent =
      'You\'ve used your ' + SARVARC_FREE_EXPORT_LIMIT + ' free watermarked exports — sign up free to keep exporting, watermark-free.';
  }

  // ---- Edit lock: once a guest has used their free export, they can't
  // keep editing without logging in (separate from the export gate above,
  // which only stops a SECOND export). Deliberately NOT a wall shown the
  // instant the condition becomes true — that would hide the work they've
  // already built the moment it happens, which is a weaker nudge than
  // letting them keep looking at it. Instead this just tracks a flag; the
  // interceptor below pops the lock card only at the moment they actually
  // try to click or type something, so the very last thing they see before
  // the prompt is the work itself. ----
  window.sarvarcEditLockActive = false;
  window.sarvarcEditLockReason = null; // only 'freeExport' now — ownership mismatches auto-clear instead of locking
  // Whether the content CURRENTLY loaded into the live modules (Workspace,
  // Data Arrangement, etc.) was pulled from a session that belongs to an
  // account (has ownerEmail) — i.e. someone signed in, opened/edited a
  // project, then signed out without leaving, OR is still signed in but as
  // a DIFFERENT account than the one that owns this content (e.g. switched
  // Google accounts on the same browser without logging the original
  // owner's project out first). Checked against the same active-link map
  // used by smCheckSessionAccess for the Saved Sessions list, so "this
  // project belongs to an account" means the same thing everywhere in the
  // app. `currentEmail` is the email of whoever is signed in right now (or
  // null/omitted if signed out): pass it so a session owned by SOMEONE is
  // only flagged as a problem when it's owned by someone ELSE — an owned
  // session that happens to belong to the person currently signed in is
  // fine and must not lock. Returns the owner's email (for the "wrong
  // account" message) or false.
  async function sarvarcCurrentLoadIsOwned(currentEmail) {
    try {
      const links = smGetActiveLinks(); // { moduleKey: sessionId }
      const ids = Array.from(new Set(Object.values(links || {}).filter(Boolean)));
      for (const id of ids) {
        const rec = await smGetSession(id);
        if (!rec || !rec.ownerEmail) continue;
        if (currentEmail && currentEmail.toLowerCase() === String(rec.ownerEmail).toLowerCase()) continue;
        return rec.ownerEmail;
      }
    } catch (e) { /* if we can't tell, don't lock on a guess */ }
    return false;
  }
  const SARVARC_EDITLOCK_MESSAGES = {
    freeExport: 'You\u2019ve used your free export. Log in (or sign up free) to keep editing and exporting without limits.'
  };

  // ---- Auto-clear on account mismatch ----
  // Older behavior locked the screen but left the OTHER account's document
  // fully readable underneath the overlay (page thumbnails, body text) —
  // fine for stopping edits, not fine for a product handling PAN/Aadhaar/
  // GST documents, where a locked-but-visible client file on a shared
  // device is itself the problem. Instead of locking, we now wipe the live
  // workspace back to empty the moment a mismatch is detected — the same
  // storage-clear smNewProject() does, just triggered automatically instead
  // of by a button. Nothing is lost: the project is already saved under its
  // owner's account and reappears in Saved Sessions the moment that account
  // logs back in (the list already filters by ownerEmail — see smRenderList
  // around line 18099). One-shot per page life via sarvarcAutoClearDone so
  // the several onAuthStateChange/init call sites below can't double-clear
  // or double-reload each other.
  window.sarvarcAutoClearDone = false;
  // Guards against auto-clearing on a false "signed out" reading before
  // Supabase has actually finished restoring the session on this page load.
  // getUser() is a network call, not a local read — on a slow connection it
  // can resolve `user: null` for a moment even though a valid session is
  // about to come back, purely because the round trip hasn't returned yet.
  // Wiping someone's own live project because of that timing gap would be
  // far worse than the lock overlay it replaced, so the clear-on-signed-out
  // path stays off until the auth client has told us the real state at
  // least once (see the sarvarcAuthReady flag set below).
  window.sarvarcAuthReady = false;
  window.__sarvarcSignedIn = false; // default to guest until the first real auth check resolves
  async function sarvarcAutoClearOwnedContent(ownerEmail, reason) {
    if (window.sarvarcAutoClearDone) return;
    window.sarvarcAutoClearDone = true;
    try {
      await smClearAllModuleStorageSilently();
    } catch (e) {
      console.warn('[Auto-clear] could not clear previous account\'s work', e);
    }
    if (typeof toast === 'function') {
      const masked = (typeof smMaskEmail === 'function') ? smMaskEmail(ownerEmail) : 'another account';
      const msg = reason === 'wrongAccount'
        ? 'Workspace cleared — that project belongs to ' + masked + '. Log in as that account and reopen it from Saved Sessions to continue.'
        : 'Workspace cleared — that project belongs to a signed-in account (' + masked + '). Log back in to reopen it from Saved Sessions.';
      toast(msg, 'info');
    }
    setTimeout(() => location.reload(), 900);
  }

  async function sarvarcRefreshEditLockState() {
    if (window.sarvarcAutoClearDone) return; // already clearing/reloading — nothing left to check
    let user = null;
    try {
      // getUser() is a real network round-trip. If it's slow, blocked, or
      // errors right after a fresh post-login reload, don't let that failure
      // fall through to the "signed out" branch below — that would leave a
      // stale edit-lock (e.g. from using the free export as a guest) stuck
      // "on" forever even though the login itself succeeded, since nothing
      // else in the app retries this specific check afterward. Fall back to
      // the cheap, local getSession() instead, which doesn't hit the network.
      ({ data: { user } } = await sarvarcSupabase.auth.getUser());
    } catch (e) {
      try {
        const { data: { session } } = await sarvarcSupabase.auth.getSession();
        user = (session && session.user) || null;
      } catch (e2) { /* still unknown — fall through, don't guess */ }
    }
    if (user) {
      // Being logged in is not by itself enough — it must be the SAME
      // account that owns whatever's currently loaded. Without this check,
      // switching to a second account on a browser that still has someone
      // else's project live (pulled in earlier under the first account)
      // would silently hand over full edit access to that other person's
      // work, since "a user is signed in" used to be treated as "this
      // user is allowed to edit this". Now, rather than locking that
      // content in place, we clear it — see sarvarcAutoClearOwnedContent.
      const ownedByOther = await sarvarcCurrentLoadIsOwned(user.email);
      if (ownedByOther) {
        await sarvarcAutoClearOwnedContent(ownedByOther, 'wrongAccount');
        return;
      }
      window.sarvarcEditLockActive = false;
      window.sarvarcEditLockReason = null;
    } else {
      // Two different lock reasons, handled differently:
      // - the free watermarked export was already used up → still shows the
      //   old lock overlay, since that's a monetization gate, not a leaked-
      //   content problem.
      // - what's currently on screen belongs to someone's account and this
      //   browser is no longer signed in as that person (e.g. logging out
      //   on a shared/office PC) → auto-clear instead of lock, so no one
      //   else's document sits visible on screen after logout.
      const ownedAndSignedOut = window.sarvarcAuthReady && await sarvarcCurrentLoadIsOwned(null);
      if (ownedAndSignedOut) {
        await sarvarcAutoClearOwnedContent(ownedAndSignedOut, 'signedOutOwned');
        return;
      }
      // Policy change: editing itself is never locked for a signed-out guest,
      // even once every free export is used up. Only two things require an
      // account now — Make Forms (see sarvarcGateForms) and Save Your
      // Workflow / Saved Sessions / Google Drive (see sarvarcGateSave).
      // Exporting a finished file beyond the free limit is handled entirely
      // by sarvarcGateExport's own signup prompt, not this overlay.
      window.sarvarcEditLockActive = false;
      window.sarvarcEditLockReason = null;
    }
    // If logging in just cleared the lock, dismiss the card in case it was
    // already showing from an earlier blocked attempt.
    if (!window.sarvarcEditLockActive) {
      const overlay = document.getElementById('sarvarcEditLockOverlay');
      if (overlay) overlay.classList.remove('open');
    }
  }
  window.sarvarcUpdateEditLockUI = sarvarcRefreshEditLockState; // kept for existing call sites

  function sarvarcShowEditLockOverlay() {
    const overlay = document.getElementById('sarvarcEditLockOverlay');
    if (overlay) overlay.classList.add('open');
  }

  // Selectors that stay fully interactive even while the lock is active —
  // the top nav (so they can still get to the login button/menu) and every
  // login-related overlay itself (so filling in the form isn't blocked by
  // its own gate).
  const SARVARC_EDITLOCK_EXEMPT =
    '#sarvarcTopnav, #sarvarcEditLockOverlay, #sarvarcAuthOverlay, ' +
    '#sarvarcWelcomeOverlay, #sarvarcRecoveryOverlay, #sarvarcUnlockPromptOverlay';

  function sarvarcEditLockGuard(e) {
    if (!window.sarvarcEditLockActive) return;
    const t = e.target;
    if (t && t.closest && t.closest(SARVARC_EDITLOCK_EXEMPT)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    sarvarcShowEditLockOverlay();
  }
  // pointerdown catches clicks, drags, and touch before any canvas/drawing
  // handler sees them; keydown catches typing into a field that was already
  // focused before the lock kicked in. Both run in the capture phase so
  // they fire before the app's own handlers (including inline onclick).
  document.addEventListener('pointerdown', sarvarcEditLockGuard, true);
  document.addEventListener('keydown', sarvarcEditLockGuard, true);

  function sarvarcRunPendingExportIfAny() {
    if (!sarvarcPendingExportAction) return;
    // Anyone who just signed up / logged in to unlock an export gets a
    // clean, watermark-free file — the free watermarked export was a
    // one-time trial, not something logged-in users should ever see.
    window.sarvarcApplyFreeWatermark = false;
    const fn = sarvarcPendingExportAction;
    sarvarcPendingExportAction = null;
    fn();
  }

  // ---- FORMS GATE & SAVE/DRIVE GATE ----
  // Only two things require an account, no free tier at all: Make Forms,
  // and saving a session (locally via "Save Your Workflow" / Saved
  // Sessions, or to Google Drive). Everything else — Workspace editing,
  // Data Arrangement, Diagrams, Redact PII, Extract Images — stays fully
  // free, gated only by the export-count limit above. Both gates share one
  // pending-action slot with the export gate's queue pattern: whatever the
  // guest was trying to do fires automatically the moment login succeeds,
  // so nobody has to click twice.
  let sarvarcPendingGatedNav = null; // a section name to navigate to post-login
  let sarvarcPendingGatedAction = null; // a zero-arg function to run post-login

  async function sarvarcIsSignedIn() {
    try {
      const { data: { user } } = await sarvarcSupabase.auth.getUser();
      return !!user;
    } catch (e) { return false; }
  }

  // Called from navigate() before it switches into 'makeforms'. Returns
  // true if the section switch should proceed, false if it was intercepted
  // by the signup prompt instead.
  async function sarvarcGateForms() {
    if (await sarvarcIsSignedIn()) return true;
    sarvarcPendingGatedNav = 'makeforms';
    sarvarcAuthOpenModal('signup');
    document.getElementById('sarvarcAuthNote').textContent =
      'Make Forms needs a free account so your client responses have somewhere safe to land — sign up to continue.';
    return false;
  }

  // Wraps any save action (Save Your Workflow, opening Saved Sessions,
  // Google Drive connect/save). Returns true if the caller should proceed
  // immediately, false if a signup prompt was shown instead and pendingFn
  // (if given) has been queued to auto-run right after login.
  async function sarvarcGateSave(pendingFn) {
    if (await sarvarcIsSignedIn()) return true;
    if (pendingFn) sarvarcPendingGatedAction = pendingFn;
    sarvarcAuthOpenModal('signup');
    document.getElementById('sarvarcAuthNote').textContent =
      'Saving (and Google Drive) needs a free account so your work is never lost — sign up to continue.';
    return false;
  }

  function sarvarcRunPendingGatedIfAny() {
    if (sarvarcPendingGatedAction) {
      const fn = sarvarcPendingGatedAction;
      sarvarcPendingGatedAction = null;
      fn();
    }
    if (sarvarcPendingGatedNav) {
      const sec = sarvarcPendingGatedNav;
      sarvarcPendingGatedNav = null;
      if (typeof navigate === 'function') navigate(sec);
    }
  }

  // ---- FREE-TIER WATERMARK STAMPING ----
  // Two small helpers used by the export functions themselves, guarded by
  // `window.sarvarcApplyFreeWatermark`. Kept intentionally subtle: small
  // text tucked in the bottom-right corner, never overlapping content, so
  // it reads as a light attribution rather than a stamped-over graphic.
  const SARVARC_WATERMARK_TEXT = 'Made Using SARVARC Workspace';

  // Stamps every page of a jsPDF document right before pdf.save(...).
  function sarvarcStampPdfWatermark(pdf) {
    try {
      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        const w = pdf.internal.pageSize.getWidth();
        const h = pdf.internal.pageSize.getHeight();
        const fontSize = Math.max(6, Math.min(w, h) * 0.018);
        const margin = Math.max(4, Math.min(w, h) * 0.015);
        pdf.saveGraphicsState();
        if (pdf.setGState && pdf.GState) {
          pdf.setGState(new pdf.GState({ opacity: 0.45 }));
        }
        pdf.setTextColor(120, 130, 145);
        pdf.setFontSize(fontSize);
        pdf.text(SARVARC_WATERMARK_TEXT, w - margin, h - margin, { align: 'right' });
        pdf.restoreGraphicsState();
      }
    } catch (e) { console.warn('[sarvarc] pdf watermark stamp failed', e); }
  }

  // Stamps a small watermark in the bottom-right corner of a canvas, right
  // before it's turned into the final image/zip entry (toDataURL / toBlob).
  function sarvarcStampCanvasWatermark(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const fontSize = Math.max(11, Math.round(Math.min(canvas.width, canvas.height) * 0.022));
      const margin = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.018));
      ctx.save();
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const textW = ctx.measureText(SARVARC_WATERMARK_TEXT).width;
      // Faint backing pill so the text stays legible over busy/dark corners
      // without needing to be bold or large.
      const padX = fontSize * 0.5, padY = fontSize * 0.35;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(
        canvas.width - margin - textW - padX,
        canvas.height - margin - fontSize - padY,
        textW + padX * 2,
        fontSize + padY * 2
      );
      ctx.fillStyle = 'rgba(60,70,90,0.65)';
      ctx.fillText(SARVARC_WATERMARK_TEXT, canvas.width - margin, canvas.height - margin);
      ctx.restore();
    } catch (e) { console.warn('[sarvarc] canvas watermark stamp failed', e); }
  }
  // Same stamp as sarvarcStampCanvasWatermark, but for the many export paths
  // that pass image data around as a dataURL string rather than a live
  // canvas element (png/jpg/webp raster exports).
  function sarvarcStampDataUrlWatermark(dataUrl) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          sarvarcStampCanvasWatermark(canvas);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }
  // Non-destructive variant: returns a watermarked COPY of the canvas when
  // the free-tier flag is set, and the original canvas untouched otherwise.
  // Use this wherever the source canvas is a live, on-screen element (e.g.
  // a chart canvas still visible in the editor) that must not be mutated.
  function sarvarcMaybeWatermarkCanvas(canvas) {
    if (!window.sarvarcApplyFreeWatermark || !canvas) return canvas;
    try {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      sarvarcStampCanvasWatermark(copy);
      return copy;
    } catch (e) { return canvas; }
  }
  window.sarvarcStampPdfWatermark = sarvarcStampPdfWatermark;
  window.sarvarcStampCanvasWatermark = sarvarcStampCanvasWatermark;
  window.sarvarcStampDataUrlWatermark = sarvarcStampDataUrlWatermark;
  window.sarvarcMaybeWatermarkCanvas = sarvarcMaybeWatermarkCanvas;

  // ---- Nav button: click behavior depends on logged-in state ----
  async function sarvarcAuthNavClick() {
    const { data: { user } } = await sarvarcSupabase.auth.getUser();
    if (user) {
      const menu = document.getElementById('sarvarcAuthMenu');
      menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
    } else {
      sarvarcAuthOpenModal('login');
    }
  }

  // Close the logout dropdown when clicking elsewhere on the page
  document.addEventListener('click', function(e) {
    const btn = document.getElementById('sarvarcAuthNavBtn');
    const menu = document.getElementById('sarvarcAuthMenu');
    if (!menu || !btn) return;
    if (menu.style.display === 'block' && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  // ---- Modal open/close/tabs ----
  function sarvarcAuthOpenModal(mode) {
    document.getElementById('sarvarcAuthMenu').style.display = 'none';
    sarvarcAuthSwitchTab(mode || 'login');
    document.getElementById('sarvarcAuthFullName').value = '';
    document.getElementById('sarvarcAuthEmail').value = '';
    document.getElementById('sarvarcAuthPassword').value = '';
    sarvarcAuthShowError('');
    if (typeof sarvarcAuthSetGoogleBusy === 'function') sarvarcAuthSetGoogleBusy(false);
    document.getElementById('sarvarcAuthFormPane').style.display = 'block';
    document.getElementById('sarvarcAuthConfirmPane').style.display = 'none';
    document.getElementById('sarvarcAuthFooter').style.display = 'flex';
    document.getElementById('sarvarcAuthOverlay').classList.add('open');
    setTimeout(() => document.getElementById('sarvarcAuthEmail').focus(), 50);
  }

  function sarvarcAuthCloseModal() {
    document.getElementById('sarvarcAuthOverlay').classList.remove('open');
  }

  // ---- Premium first-login welcome moment. Auto-dismisses on its own after
  // ~2.6s (matching the progress bar's CSS transition); clicking anywhere
  // dismisses it early. Kept separate from the ordinary toast() system,
  // which stays reserved for routine confirmations (saves, exports, etc). ----
  let sarvarcWelcomeTimer = null;
  function sarvarcShowWelcome(name) {
    const overlay = document.getElementById('sarvarcWelcomeOverlay');
    const nameEl = document.getElementById('sarvarcWelcomeName');
    const bar = document.getElementById('sarvarcWelcomeProgressBar');
    if (!overlay || !nameEl) return;
    nameEl.textContent = name ? ('Welcome, ' + name) : 'Welcome';
    // Reset the progress bar to its full, untransitioned state before the
    // 'open' class (which carries the transition) is added on the next frame.
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    overlay.classList.remove('open');
    void overlay.offsetWidth; // force reflow so the reset above actually takes effect
    requestAnimationFrame(() => {
      bar.style.transition = '';
      overlay.classList.add('open');
    });
    if (sarvarcWelcomeTimer) clearTimeout(sarvarcWelcomeTimer);
    sarvarcWelcomeTimer = setTimeout(sarvarcHideWelcome, 2600);
  }
  function sarvarcHideWelcome() {
    const overlay = document.getElementById('sarvarcWelcomeOverlay');
    if (overlay) overlay.classList.remove('open');
    if (sarvarcWelcomeTimer) { clearTimeout(sarvarcWelcomeTimer); sarvarcWelcomeTimer = null; }
  }

  // ---- Called after every successful login/signup, from every path
  // (password, Google popup, email-confirmation-link). Closing the modal on
  // its own used to leave people on whatever section was open behind it
  // (often the marketing Dashboard), which read as "nothing happened."
  // This makes signing in always drop the person straight into the actual
  // Workspace with a premium, once-per-login welcome moment, so it's
  // unmistakable that they're in — not just close the dialog. ----
  async function sarvarcAuthEnterWorkspace() {
    sarvarcAuthCloseModal();
    const displayName = await sarvarcAuthUpdateNavUI();
    swTrack('account_active', { name: displayName ? 'named' : 'unnamed' });
    await sarvarcUpdateEditLockUI();
    if (typeof navigate === 'function' && document.getElementById('sec-pdfeditor')) {
      navigate('pdfeditor');
    }
    sarvarcShowWelcome(displayName);
    sarvarcRunPendingExportIfAny();
    sarvarcRunPendingGatedIfAny();
    // Real, forced pull from this account's Drive — not fire-and-forget.
    // Retries several times with a backoff in case Google's Drive token
    // isn't hydrated in the Supabase session yet in the first instant after
    // login (see sarvarcDriveSyncDownHard above). Not awaited here so it
    // never blocks entering the workspace, but it keeps working in the
    // background until it actually reaches Drive or genuinely runs out of
    // attempts — silently no-ops only for someone who didn't sign in via
    // Google or declined Drive access.
    if (typeof sarvarcDriveSyncDownHard === 'function') sarvarcDriveSyncDownHard();
    else if (typeof sarvarcDriveSyncDown === 'function') sarvarcDriveSyncDown();
    if (typeof sarvarcDriveSyncUp === 'function') sarvarcDriveSyncUp();
    // Same best-effort pull/push for the Assets library (images/logos/
    // signatures), so it follows a signed-in account across PCs too.
    if (typeof sarvarcAssetsSyncDown === 'function') sarvarcAssetsSyncDown();
    if (typeof sarvarcAssetsSyncUp === 'function') sarvarcAssetsSyncUp();
    // And My Shapes (custom Image Reshaper shapes), so they follow the account too.
    if (typeof sarvarcShapesSyncDown === 'function') sarvarcShapesSyncDown().then(() => { if (typeof sarvarcShapesSyncUp === 'function') sarvarcShapesSyncUp(); });
    return displayName;
  }

  function sarvarcAuthSwitchTab(mode) {
    sarvarcAuthMode = mode;
    sarvarcAuthShowError('');
    const loginTab = document.getElementById('sarvarcAuthTabLogin');
    const signupTab = document.getElementById('sarvarcAuthTabSignup');
    const title = document.getElementById('sarvarcAuthTitle');
    const sub = document.getElementById('sarvarcAuthSub');
    const submitBtn = document.getElementById('sarvarcAuthSubmitBtn');
    const forgotWrap = document.getElementById('sarvarcAuthForgotWrap');
    const fullNameField = document.getElementById('sarvarcAuthFullName');
    if (mode === 'login') {
      loginTab.classList.add('active'); signupTab.classList.remove('active');
      title.textContent = 'Log In';
      sub.textContent = 'Access your SARVARC Workspace account';
      submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Log In';
      if (forgotWrap) forgotWrap.style.display = 'block';
      if (fullNameField) fullNameField.style.display = 'none';
      var stsU = document.getElementById('sarvarcAuthSplitSwitchToSignup'), stsL = document.getElementById('sarvarcAuthSplitSwitchToLogin');
      if (stsU) stsU.style.display = 'inline'; if (stsL) stsL.style.display = 'none';
    } else {
      signupTab.classList.add('active'); loginTab.classList.remove('active');
      title.textContent = 'Sign Up';
      sub.textContent = 'Create your SARVARC Workspace account';
      submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg> Sign Up';
      if (forgotWrap) forgotWrap.style.display = 'none';
      if (fullNameField) fullNameField.style.display = 'block';
      var stsU2 = document.getElementById('sarvarcAuthSplitSwitchToSignup'), stsL2 = document.getElementById('sarvarcAuthSplitSwitchToLogin');
      if (stsU2) stsU2.style.display = 'none'; if (stsL2) stsL2.style.display = 'inline';
    }
  }

  // ---- Generic "check your email" pane, used for both sign-up
  // confirmation and forgot-password. `kind` controls wording and which
  // resend action fires; the modal stays open and watches auth state (see
  // onAuthStateChange below), closing/advancing itself the instant the
  // link is used — no extra click from the user needed. ----
  let sarvarcAuthConfirmKind = 'signup'; // 'signup' | 'reset'
  function sarvarcAuthShowConfirmPane(kind, email) {
    sarvarcAuthConfirmKind = kind;
    document.getElementById('sarvarcAuthConfirmEmail').textContent = email;
    document.getElementById('sarvarcAuthFormPane').style.display = 'none';
    document.getElementById('sarvarcAuthConfirmPane').style.display = 'block';
    document.getElementById('sarvarcAuthFooter').style.display = 'none';
    if (kind === 'reset') {
      document.getElementById('sarvarcAuthTitle').textContent = 'Check your email';
      document.getElementById('sarvarcAuthSub').textContent = 'Reset your password';
      document.getElementById('sarvarcAuthConfirmHeadline').textContent = 'Reset your password';
      document.getElementById('sarvarcAuthConfirmBody').innerHTML = 'We sent a link to <b id="sarvarcAuthConfirmEmail" style="color:var(--text)">' + email + '</b>. Open it and you\'ll land back here to set a new password — this window updates on its own.';
    } else {
      document.getElementById('sarvarcAuthTitle').textContent = 'Almost there';
      document.getElementById('sarvarcAuthSub').textContent = 'One quick email check';
      document.getElementById('sarvarcAuthConfirmHeadline').textContent = 'Confirm your email';
      document.getElementById('sarvarcAuthConfirmBody').innerHTML = 'We sent a link to <b id="sarvarcAuthConfirmEmail" style="color:var(--text)">' + email + '</b>. Open it and you\'ll be signed in here automatically — this window updates on its own, no need to come back and click anything.';
    }
    document.getElementById('sarvarcAuthResendNote').style.display = 'block';
  }

  async function sarvarcResendConfirmationEmail() {
    const email = document.getElementById('sarvarcAuthConfirmEmail').textContent;
    const noteEl = document.getElementById('sarvarcAuthResendNote');
    try {
      let error;
      if (sarvarcAuthConfirmKind === 'reset') {
        ({ error } = await sarvarcSupabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        }));
      } else {
        ({ error } = await sarvarcSupabase.auth.resend({
          type: 'signup', email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        }));
      }
      if (error) throw error;
      noteEl.innerHTML = 'Sent again — check your inbox (and spam).';
    } catch (err) {
      noteEl.textContent = err.message || 'Could not resend. Try again in a moment.';
    }
  }

  // ---- Forgot password (logged out): emails a recovery link, then swaps
  // in the same "check your email" pane sign-up uses. Supabase redirects
  // back to this page with a recovery token; onAuthStateChange below
  // catches the PASSWORD_RECOVERY event and opens the "set new password"
  // modal automatically — no extra click needed to get there. ----
  async function sarvarcForgotPassword() {
    const email = document.getElementById('sarvarcAuthEmail').value.trim();
    if (!email) { sarvarcAuthShowError('Enter your email above first, then click "Forgot password?".'); return; }
    sarvarcAuthShowError('');
    try {
      const { error } = await sarvarcSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      sarvarcAuthShowConfirmPane('reset', email);
    } catch (err) {
      sarvarcAuthShowError(sarvarcAuthFriendlyError(err));
    }
  }

  // ---- Set-new-password modal shown after clicking the emailed link ----
  function sarvarcRecoveryShowError(msg) {
    const el = document.getElementById('sarvarcRecoveryError');
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block'; el.textContent = msg;
  }

  async function sarvarcRecoverySubmit() {
    const pw = document.getElementById('sarvarcRecoveryNewPw').value;
    if (!pw || pw.length < 6) { sarvarcRecoveryShowError('Password must be at least 6 characters.'); return; }
    const btn = document.getElementById('sarvarcRecoverySubmitBtn');
    btn.disabled = true;
    try {
      const { error } = await sarvarcSupabase.auth.updateUser({ password: pw });
      if (error) throw error;
      document.getElementById('sarvarcRecoveryOverlay').classList.remove('open');
      await sarvarcAuthUpdateNavUI();
      toast('Password updated — you\'re logged in.', 'success');
    } catch (err) {
      sarvarcRecoveryShowError(err.message || 'Could not update password. Try again.');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- SETTINGS MODAL: Profile (name/business name) + Change Password ----
  let sarvarcSettingsMode = 'profile';

  async function sarvarcSettingsOpenModal() {
    document.getElementById('sarvarcAuthMenu').style.display = 'none';
    const { data: { user } } = await sarvarcSupabase.auth.getUser();
    if (!user) { sarvarcAuthOpenModal('login'); return; }
    sarvarcSettingsSwitchTab('profile');
    document.getElementById('sarvarcSettingsCurrentPw').value = '';
    document.getElementById('sarvarcSettingsNewPw').value = '';
    document.getElementById('sarvarcSettingsProfileError').style.display = 'none';
    document.getElementById('sarvarcSettingsPasswordError').style.display = 'none';
    // Pre-fill from the profiles table if a row already exists
    try {
      const { data: profile } = await sarvarcSupabase.from('profiles')
        .select('full_name, business_name').eq('id', user.id).maybeSingle();
      document.getElementById('sarvarcSettingsFullName').value = (profile && profile.full_name) || '';
      document.getElementById('sarvarcSettingsBusinessName').value = (profile && profile.business_name) || '';
    } catch (e) {
      document.getElementById('sarvarcSettingsFullName').value = '';
      document.getElementById('sarvarcSettingsBusinessName').value = '';
    }
    document.getElementById('sarvarcSettingsOverlay').classList.add('open');
  }

  function sarvarcSettingsCloseModal() {
    document.getElementById('sarvarcSettingsOverlay').classList.remove('open');
  }

  function sarvarcSettingsSwitchTab(mode) {
    sarvarcSettingsMode = mode;
    const profileTab = document.getElementById('sarvarcSettingsTabProfile');
    const passwordTab = document.getElementById('sarvarcSettingsTabPassword');
    const profilePane = document.getElementById('sarvarcSettingsProfilePane');
    const passwordPane = document.getElementById('sarvarcSettingsPasswordPane');
    const saveBtn = document.getElementById('sarvarcSettingsSaveBtn');
    if (mode === 'profile') {
      profileTab.style.background = 'var(--bg2)'; profileTab.style.color = 'var(--text)';
      passwordTab.style.background = 'transparent'; passwordTab.style.color = 'var(--text2)';
      profilePane.style.display = 'block'; passwordPane.style.display = 'none';
      saveBtn.textContent = 'Save'; saveBtn.setAttribute('onclick', 'sarvarcSettingsSaveProfile()');
    } else {
      passwordTab.style.background = 'var(--bg2)'; passwordTab.style.color = 'var(--text)';
      profileTab.style.background = 'transparent'; profileTab.style.color = 'var(--text2)';
      passwordPane.style.display = 'block'; profilePane.style.display = 'none';
      saveBtn.textContent = 'Update Password'; saveBtn.setAttribute('onclick', 'sarvarcSettingsChangePassword()');
    }
  }

  async function sarvarcSettingsSaveProfile() {
    const errEl = document.getElementById('sarvarcSettingsProfileError');
    errEl.style.display = 'none';
    const fullName = document.getElementById('sarvarcSettingsFullName').value.trim();
    const businessName = document.getElementById('sarvarcSettingsBusinessName').value.trim();
    const btn = document.getElementById('sarvarcSettingsSaveBtn');
    btn.disabled = true;
    try {
      const { data: { user } } = await sarvarcSupabase.auth.getUser();
      if (!user) throw new Error('Not logged in.');
      const { error } = await sarvarcSupabase.from('profiles').upsert({
        id: user.id, full_name: fullName || null, business_name: businessName || null, updated_at: new Date().toISOString()
      });
      if (error) throw error;
      sarvarcSettingsCloseModal();
      await sarvarcAuthUpdateNavUI();
      toast('Profile saved', 'success');
    } catch (err) {
      errEl.textContent = err.message || 'Could not save profile. Try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }

  // Change password while logged in: re-confirms identity with the current
  // password (via signInWithPassword) before allowing the update, same
  // safeguard a normal "change password" screen uses.
  async function sarvarcSettingsChangePassword() {
    const errEl = document.getElementById('sarvarcSettingsPasswordError');
    errEl.style.display = 'none';
    const currentPw = document.getElementById('sarvarcSettingsCurrentPw').value;
    const newPw = document.getElementById('sarvarcSettingsNewPw').value;
    if (!currentPw) { errEl.textContent = 'Enter your current password.'; errEl.style.display = 'block'; return; }
    if (!newPw || newPw.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('sarvarcSettingsSaveBtn');
    btn.disabled = true;
    try {
      const { data: { user } } = await sarvarcSupabase.auth.getUser();
      if (!user) throw new Error('Not logged in.');
      const { error: reauthErr } = await sarvarcSupabase.auth.signInWithPassword({ email: user.email, password: currentPw });
      if (reauthErr) throw new Error('Current password is incorrect.');
      const { error } = await sarvarcSupabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      sarvarcSettingsCloseModal();
      toast('Password updated', 'success');
    } catch (err) {
      errEl.textContent = err.message || 'Could not update password. Try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }
