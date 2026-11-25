// Brand Kit <-> session sync (Settings > Brand Kit).
//
// The Brand Kit belongs to the SESSION (project), not the account. It is a module of the
// session snapshot (see SM_MODULE_STORAGE.brandkit in js/12), so it is saved with the session,
// mirrored to Google Drive with it, restored when the session is loaded, and cleared by
// New Project. This file only does the "keep it safe" part:
//   - when the kit is saved in Settings, write it into the current session (local + Drive)
//   - tell the person plainly when it is NOT safe yet (not signed up, no Drive, no session)
//   - warn before the tab is closed while the kit is not synced yet
//   - copy the kit from another session on request (never automatic)
(function () {
  var KIT_KEY = 'sarvarc_brand_kit_v1';
  // NOT a session key on purpose: this flag says "this device has a kit change Drive has not seen".
  var DIRTY_KEY = 'sarvarc_brand_kit_unsynced_v1';
  var editedThisVisit = false;          // drives the close-tab warning (so an old flag never nags)
  var quietTimer = null;

  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function isDirty() { return lsGet(DIRTY_KEY) === '1'; }
  function setDirty(on) { if (on) lsSet(DIRTY_KEY, '1'); else lsDel(DIRTY_KEY); }
  function kitHasContent() {
    var k; try { k = JSON.parse(lsGet(KIT_KEY)); } catch (e) { k = null; }
    return !!(k && (k.logo || k.company || k.tagline || k.address || k.phone || k.email || k.website || k.gst || (k.social && Object.keys(k.social).length)));
  }
  function toastMsg(msg, kind) { if (typeof toast === 'function') toast(msg, kind || 'info'); }
  async function signedIn() {
    try { return (typeof sarvarcIsSignedIn === 'function') ? !!(await sarvarcIsSignedIn()) : false; } catch (e) { return false; }
  }

  // kind: signedout | nodrive | nosession | failed | synced
  function render(info) {
    var box = $('stgBkSync'), txt = $('stgBkSyncText'), btn = $('stgBkSyncBtn');
    window.bkSessionLastState = info;
    if (!box || !txt || !btn) return info;
    var msg = '', label = '', act = null;
    if (info.kind === 'signedout') {
      msg = 'This Brand Kit is only in this browser while you are signed out. Sign up free to keep a kit with your session on Google Drive. A kit made while signed out does not carry into your new account, so add it again after signing up.';
      label = 'Sign up free';
      act = function () { if (typeof sarvarcGateSave === 'function') sarvarcGateSave(window.bkSessionSync); };
    } else if (info.kind === 'nodrive') {
      msg = 'Saved with your session on this device only. Google Drive is not connected, so it will not follow you to another device yet. Sign in with Google to connect it.';
      label = 'Open Drive status';
      act = function () { if (typeof smOpenSessionsPage === 'function') smOpenSessionsPage(); };
    } else if (info.kind === 'nosession') {
      msg = 'This Brand Kit is not part of a saved session yet. Save your session so the kit is kept (and synced to Google Drive) with this project.';
      label = 'Save session now';
      act = async function () {
        if (typeof smSaveWorkflow !== 'function') return;
        await smSaveWorkflow();
        setTimeout(function () { window.bkSessionRefresh(); }, 600);
      };
    } else if (info.kind === 'failed') {
      msg = 'Saved with your session on this device, but the Google Drive upload failed. It will retry, or you can retry now.';
      label = 'Retry';
      act = function () { window.bkSessionSync(); };
    } else if (info.kind === 'synced') {
      msg = 'Saved with session \u201C' + (info.name || 'this session') + '\u201D and synced to Google Drive.';
    }
    box.setAttribute('data-kind', info.kind || '');
    box.hidden = !msg;
    txt.textContent = msg;
    btn.hidden = !label;
    btn.textContent = label;
    btn.onclick = act;
    return info;
  }

  // Reads the current situation without writing anything.
  window.bkSessionRefresh = async function () {
    if (!(await signedIn())) return render({ kind: 'signedout' });
    var id = (typeof smSingleLinkedSessionId === 'function') ? smSingleLinkedSessionId() : null;
    if (!id) return render({ kind: 'nosession' });
    var rec = null; try { rec = await smGetSession(id); } catch (e) {}
    if (!rec) return render({ kind: 'nosession' });
    var drive = false; try { drive = (typeof sarvarcDriveAvailable === 'function') && !!(await sarvarcDriveAvailable()); } catch (e) {}
    if (!drive) return render({ kind: 'nodrive', name: rec.name });
    if (isDirty()) return render({ kind: 'failed', name: rec.name });
    return render({ kind: 'synced', name: rec.name });
  };

  // Writes the live kit into the current session, mirrors to Drive, then shows the result.
  window.bkSessionSync = async function () {
    if (!(await signedIn())) return render({ kind: 'signedout' });
    var id = (typeof smSingleLinkedSessionId === 'function') ? smSingleLinkedSessionId() : null;
    if (!id) return render({ kind: 'nosession' });
    var res = null;
    try { res = await smUpdateSessionBrandKit(id); } catch (e) { console.warn('[BrandKit] session update failed', e); }
    if (!res) return render({ kind: 'nosession' });
    if (res.drive === 'synced') { setDirty(false); editedThisVisit = false; return render({ kind: 'synced', name: res.rec.name }); }
    return render({ kind: res.drive === 'failed' ? 'failed' : 'nodrive', name: res.rec.name });
  };

  // Called by Settings right after the kit was saved or cleared.
  window.bkSessionOnKitSaved = async function () {
    setDirty(true);
    editedThisVisit = true;
    var info = await window.bkSessionSync();
    if (info.kind === 'signedout') editedThisVisit = false;   // signed out: notice only, no close-tab prompt
    if (info.kind === 'signedout') toastMsg('Brand Kit saved in this browser only. Sign up free to keep it with your session on Google Drive.', 'info');
    else if (info.kind === 'nosession') toastMsg('Brand Kit saved. Save your session so it is kept with this project.', 'info');
    else if (info.kind === 'nodrive') toastMsg('Brand Kit saved on this device. Connect Google Drive to sync it.', 'info');
    else if (info.kind === 'failed') toastMsg('Brand Kit saved on this device. The Drive upload failed, so it will retry.', 'info');
    else if (info.kind === 'synced') toastMsg('Brand Kit synced to Google Drive with your session.', 'success');
    return info;
  };

  // Quiet version for tick-box changes: no toast, only when a session is linked and signed in.
  function quietSync() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(async function () {
      if (!(await signedIn())) return;
      var id = (typeof smSingleLinkedSessionId === 'function') ? smSingleLinkedSessionId() : null;
      if (!id) return;
      setDirty(true);
      try { var r = await smUpdateSessionBrandKit(id); if (r && r.drive === 'synced') setDirty(false); } catch (e) {}
      window.bkSessionRefresh();
    }, 1500);
  }
  if (typeof window.bkUseSet === 'function') {
    var origUse = window.bkUseSet;
    window.bkUseSet = function () { var r = origUse.apply(this, arguments); quietSync(); return r; };
  }

  // Do not let the tab be closed blindly while this visit's kit change has not reached Drive.
  // Only ever armed for a SIGNED-IN person, and never during the app's own auth reloads:
  // sign-in, sign-up, logout and account-switch all reload the page on purpose
  // (js/47 sets __sarvarcAuthReloadPending, js/49 sets sarvarcAutoClearDone, first), and Google
  // sign-in is a full-page redirect. A signed-out person never sees this prompt, so none of
  // those flows can be interrupted; they get the notice and the toast instead.
  function authIsReloading() { return window.__sarvarcAuthReloadPending === true || window.sarvarcAutoClearDone === true; }
  window.addEventListener('beforeunload', function (e) {
    if (authIsReloading()) return;
    if (!editedThisVisit || !isDirty() || !kitHasContent()) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // ── Copy the kit from another session (explicit, never automatic) ──
  window.bkSessionCopyRefresh = async function () {
    var wrap = $('stgBkCopy'), sel = $('stgBkCopySel');
    if (!wrap || !sel || typeof smListSessions !== 'function') return;
    var list = [];
    try {
      var all = await smListSessions();
      var current = (typeof smSingleLinkedSessionId === 'function') ? smSingleLinkedSessionId() : null;
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.id === current) continue;
        var a = (typeof smCheckSessionAccess === 'function') ? await smCheckSessionAccess(s) : { ok: true };
        if (!a.ok) continue;
        var m = (typeof SM_MODULE_MANIFEST !== 'undefined') ? SM_MODULE_MANIFEST.filter(function (x) { return x.key === 'brandkit'; })[0] : null;
        if (m && m.check(s.snapshot || {}).present) list.push(s);
      }
    } catch (e) { list = []; }
    sel.innerHTML = '';
    list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.name || 'Untitled session';
      sel.appendChild(o);
    });
    wrap.hidden = !list.length;
  };
  window.bkSessionCopy = async function () {
    var sel = $('stgBkCopySel'); if (!sel || !sel.value) return;
    var rec = await smGetSession(sel.value);
    var raw = rec && rec.snapshot && rec.snapshot.ls && rec.snapshot.ls[KIT_KEY];
    if (!raw) { toastMsg('That session has no Brand Kit to copy.', 'error'); return; }
    lsSet(KIT_KEY, raw);
    if (typeof stgBkFill === 'function') stgBkFill();
    toastMsg('Copied the Brand Kit from \u201C' + (rec.name || 'that session') + '\u201D into this session.', 'success');
    window.bkSessionOnKitSaved();
  };

  // Called by Settings whenever the Brand Kit tab is filled/shown.
  window.bkSessionPanelRefresh = function () {
    window.bkSessionRefresh();
    window.bkSessionCopyRefresh();
  };
})();
