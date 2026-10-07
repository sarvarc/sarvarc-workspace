  // ── ACCOUNT-SCOPED STORAGE ──────────────────────────────────────────────
  // Every module (Make Forms, PDF Editor, Data Arrangement, Diagrams,
  // Redact, Extract, Sessions, ...) persists its working data to
  // localStorage under a handful of fixed keys ('sarvarcForms',
  // 'workspaceDoc_v1', 'sarvarcDaState_v1', etc). localStorage is scoped to
  // the BROWSER, not to whoever is signed in — so on a shared device,
  // signing out of one SARVARC account and into another left the previous
  // person's forms/documents/tables fully visible to the next person.
  //
  // This patches every localStorage read/write to transparently namespace
  // under the currently signed-in Supabase user's id (or "guest" while
  // signed out), so each account only ever sees its own data on this
  // device. It has to be the very first script on the page, before any
  // module touches localStorage — and it determines the signed-in user
  // synchronously by reading Supabase's own persisted session token
  // (left un-namespaced, see EXCLUDED) rather than waiting on the async
  // Supabase client, which is created much later in this file, after most
  // modules have already restored their state from localStorage.
  //
  // When sign-in state actually changes (login / logout / switch account),
  // sarvarcSupabase.auth.onAuthStateChange (near the Supabase client setup)
  // reloads the page so every module re-restores from the *new* account's
  // scoped keys instead of leaving the old account's in-memory state on screen.
  (function () {
    var SUPABASE_REF = 'ndysvofxjuonfrgfeswj';
    // 'sarvarcTheme': cosmetic, pre-auth, holds no user content.
    // 'sarvarcPendingWorkspaceEntry': a one-shot signal written right before
    // sarvarcQueueWorkspaceEntryAndReload() reloads the page, then read once
    // at boot to finish entering the Workspace. It must NOT be namespaced by
    // window.__sarvarcUid: that variable is only guaranteed correct *after*
    // this account-scoping IIFE re-reads it fresh on the next boot. In
    // between (e.g. the Google popup login flow, where the session is
    // established in a different window and this window's own uid variable
    // hasn't been updated yet when the flag is written), the write and the
    // read can land under two different scoped keys ("guest" vs. the real
    // uid), so the flag silently "disappears" and the app never advances
    // past the login modal even though sign-in succeeded. Since this key
    // holds no user content and lives for at most a few hundred ms across
    // exactly one reload, there's no data-isolation reason to scope it.
    // 'sarvarcHasEntered' (first-visit splash flag) is the same class of
    // pre-account technical flag and is excluded for the same reason.
    var EXCLUDED = {
      'sarvarcTheme': true,
      'sarvarcPendingWorkspaceEntry': true,
      'sarvarcHasEntered': true
    };

    function isExcluded(key) {
      if (EXCLUDED[key]) return true;
      // Supabase's own session token must stay un-namespaced — it's the
      // thing we read below to figure out *which* namespace to use.
      return typeof key === 'string' && key.indexOf('sb-') === 0;
    }

    function readSignedInUid() {
      try {
        var raw = window.localStorage.getItem('sb-' + SUPABASE_REF + '-auth-token');
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        var user = (parsed && (parsed.user || (parsed.currentSession && parsed.currentSession.user))) || null;
        return (user && user.id) || null;
      } catch (e) { return null; }
    }

    window.__sarvarcUid = readSignedInUid(); // null = signed out ("guest")

    function scopedKey(key) {
      if (isExcluded(key)) return key;
      return 'u_' + (window.__sarvarcUid || 'guest') + '::' + key;
    }

    var proto = Storage.prototype;
    var _getItem = proto.getItem, _setItem = proto.setItem, _removeItem = proto.removeItem;
    proto.getItem = function (key) { return _getItem.call(this, scopedKey(key)); };
    proto.setItem = function (key, value) { return _setItem.call(this, scopedKey(key), value); };
    proto.removeItem = function (key) { return _removeItem.call(this, scopedKey(key)); };
  })();

  // Apply the user's last-chosen theme immediately (before CSS/paint) so the
  // page never flashes/reverts to light mode for someone who left it in dark mode.
  (function () {
    try {
      var saved = localStorage.getItem('sarvarcTheme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.dataset.theme = saved;
      }
    } catch (e) {}
  })();
