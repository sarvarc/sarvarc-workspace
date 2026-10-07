  // TEAM FEATURE state — declared first, before any async/await code below
  // runs, so these are fully initialized in the very first synchronous
  // tick of this script. They used to be declared much further down
  // (~line 66493), after several async IIFEs (Drive token refresh, Yjs
  // collab auto-reconnect) that `await`/`.then()` and yield control back
  // to the browser mid-script. If the "Team" nav button was clicked during
  // one of those gaps — before execution reached the old declaration line —
  // sarvarcTeamOpenModal() (a hoisted function, callable immediately) tried
  // to read these `let` bindings while they were still in their temporal
  // dead zone, throwing "Cannot access 'sarvarcTeamMyTeams' before
  // initialization". Declaring them here removes that race entirely.
  let sarvarcTeamMyTeams = [];      // [{id, name, role}]
  let sarvarcTeamActiveId = null;
  let sarvarcTeamPresenceChannel = null;
  let sarvarcTeamOnlineIds = new Set();
  let sarvarcTeamMyRole = null;     // 'owner' | 'admin' | 'member' in sarvarcTeamActiveId — refreshed by sarvarcTeamLoadMembers, used to gate "End Live Session"

  // ---- Show/hide toggle for any password field. Swaps the input's type
  // and the icon between "eye" (hidden, click to reveal) and "eye-off"
  // (visible, click to hide) so it's obvious which state you're in. ----
  const SARVARC_EYE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const SARVARC_EYE_OFF_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  function sarvarcTogglePwVisibility(inputId, iconEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    iconEl.innerHTML = showing ? SARVARC_EYE_OFF_ICON : SARVARC_EYE_ICON;
    iconEl.title = showing ? 'Hide password' : 'Show password';
  }

  const SARVARC_SUPABASE_URL = 'https://ndysvofxjuonfrgfeswj.supabase.co';
  const SARVARC_SUPABASE_ANON_KEY = 'sb_publishable_wuiOlGoSu1E3_N7m8r8frg_eA6MKlTa';
  const sarvarcSupabase = window.supabase.createClient(SARVARC_SUPABASE_URL, SARVARC_SUPABASE_ANON_KEY);
  // Exposed on window: this client is created inside this block's private
  // scope, but it's referenced by bare name ("sarvarcSupabase") from other
  // top-level functions elsewhere on the page — Quick Feedback's qfSubmit(),
  // smGetCurrentAuthEmail(), mfPublishForm(), and others. Those call sites
  // sit outside this closure, so without this line they were silently
  // hitting an undefined variable (caught by their own try/catch blocks)
  // instead of ever reaching Supabase.
  window.sarvarcSupabase = sarvarcSupabase;

  // ---- Keep the account-scoped storage namespace (installed at the very
  // top of <head>, before any module loaded its data) in sync with who's
  // actually signed in. Every module already restored its state from the
  // PREVIOUS account's scoped keys at boot, so when the signed-in identity
  // changes — login, logout, or switching accounts on this same browser —
  // a reload is the only reliable way to make every module re-restore from
  // the new (correct) account's data instead of leaving the old account's
  // forms/documents/tables sitting in memory on screen. This is what
  // actually stops one person's data from carrying over to the next person
  // who logs in on the same device.
  //
  // sarvarcQueueWorkspaceEntryAndReload() is the ONE canonical way any
  // code path in this file is allowed to react to a successful sign-in —
  // the popup flow, the password/signup submit handler, and this listener
  // itself all call it instead of jumping into the Workspace directly.
  // Earlier, several of those places called sarvarcAuthEnterWorkspace()
  // (which shows the welcome moment) straight away, racing this listener's
  // own reload — whichever lost had its in-flight work silently discarded
  // by the navigation. Even the "winner" wasn't reliable: entering the
  // Workspace, then having this listener reload the page a beat later,
  // meant the welcome overlay could get cut short or wiped before it ever
  // painted, so it looked like it never showed at all. Funnelling every
  // path through this one guarded function means the reload always
  // happens first and workspace-entry always happens after, on a clean
  // freshly-booted page, via the sessionStorage flag read once at boot
  // (see sarvarcAuthUpdateNavUI().finally() further down). ----
  window.__sarvarcAuthReloadPending = false;
  function sarvarcQueueWorkspaceEntryAndReload() {
    if (window.__sarvarcAuthReloadPending) return; // already in flight — first caller wins
    window.__sarvarcAuthReloadPending = true;
    sessionStorage.setItem('sarvarcPendingWorkspaceEntry', '1');
    location.reload();
    // Safety net: location.reload() is expected to tear down this whole JS
    // context almost immediately, which makes this timer moot in the normal
    // case. But on a slow connection, a battery-saving mobile browser, or
    // certain in-app webviews, the reload can be delayed or silently
    // swallowed — and with no reset anywhere else, the guard above would
    // then stay stuck "true" for the rest of this page's life, silently
    // no-op'ing every future login attempt (login succeeds against
    // Supabase, but the app never advances and never explains why). If
    // we're still here after a few seconds, the reload didn't happen —
    // release the guard so the next attempt (or this same one) can retry.
    setTimeout(() => {
      window.__sarvarcAuthReloadPending = false;
    }, 4000);
  }
  sarvarcSupabase.auth.onAuthStateChange(function (event, session) {
    const newUid = (session && session.user && session.user.id) || null;
    if (newUid !== window.__sarvarcUid) {
      window.__sarvarcUid = newUid;
      if (newUid) {
        sarvarcQueueWorkspaceEntryAndReload();
      } else if (!window.__sarvarcAuthReloadPending) {
        // Signing out still needs the reload for correct namespace
        // isolation, but there's no Workspace to enter afterward.
        window.__sarvarcAuthReloadPending = true;
        location.reload();
      }
    }
  });

  // ============== GOOGLE DRIVE SYNC (optional, opt-in, additive) ==============
  // Saved sessions already work fully offline via this browser's IndexedDB
  // (see smSaveSession/smListSessions/etc. above) — that path is untouched
  // and always keeps working, logged in or not. This layer is a best-effort
  // MIRROR on top of it: if the user signed in with Google and granted the
  // drive.file scope, sessions are also written as JSON files inside one
  // app-created Drive folder, using the user's own OAuth token straight from
  // their browser. SARVARC's servers never see the file content — it never
  // passes through anything but Google's API and this browser. Any Drive
  // failure (no token, offline, API not enabled yet) is swallowed silently
  // so it can never block or break the local save/load path.
  const SARVARC_DRIVE_FOLDER_NAME = 'SARVARC Workspace Files';
  let sarvarcDriveFolderId = null;

  // Google's OAuth Client ID for this app — the SAME client ID configured
  // under Supabase Dashboard → Authentication → Providers → Google. Needed
  // only for the silent-refresh fallback below (Google Identity Services);
  // everything else (sign-in itself, the cached-token fast path) works
  // without it. Grab it from Supabase's Google provider settings, or from
  // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
  // Client IDs (the "Web client" one). Leave blank to disable the fallback
  // — the cached-token layer alone already covers the vast majority of
  // "reload within the hour" cases.
  const SARVARC_GOOGLE_CLIENT_ID = '1006350110670-rop2aggtfijk7ucuv9t7tktvel1qg42n.apps.googleusercontent.com';

  // ---- provider_token cache -------------------------------------------
  // Supabase hands back Google's Drive access token (session.provider_token)
  // ONLY at the moment of the actual OAuth exchange — a page reload restores
  // the Supabase session fine but drops provider_token, which is what made
  // the status panel read "Not connected" for someone who never signed out.
  // Mirroring it into localStorage the instant we do have it means a reload
  // within the token's ~1hr life still finds a usable one immediately, no
  // network round trip required.
  function sarvarcDriveCacheToken(token, expiresInSec) {
    try {
      // 2-minute safety buffer so we never hand back something that expires
      // mid-request.
      const ttlSec = Math.max(60, (expiresInSec || 3300) - 120);
      localStorage.setItem('sarvarcDriveProviderToken', token);
      localStorage.setItem('sarvarcDriveProviderTokenExp', String(Date.now() + ttlSec * 1000));
    } catch (e) { /* ignore — cache is a pure optimization */ }
  }
  function sarvarcDriveReadCachedToken() {
    try {
      const tok = localStorage.getItem('sarvarcDriveProviderToken');
      const exp = parseInt(localStorage.getItem('sarvarcDriveProviderTokenExp') || '0', 10);
      if (tok && exp && Date.now() < exp) return tok;
    } catch (e) {}
    return null;
  }
  function sarvarcDriveClearCachedToken() {
    try {
      localStorage.removeItem('sarvarcDriveProviderToken');
      localStorage.removeItem('sarvarcDriveProviderTokenExp');
    } catch (e) {}
  }

  // ---- Google Identity Services silent refresh (fallback) --------------
  // Only reached once the cache above is empty/expired AND Supabase's own
  // refreshSession() didn't come back with a fresh provider_token. Asks
  // Google directly, in the same browser, for a new Drive-scoped access
  // token with prompt:'' — silent if this Google account already granted
  // the drive.file scope (it did, at original sign-in), so this normally
  // resolves with no visible UI at all. Best-effort like everything else in
  // this file: any failure just falls through to "no Drive this time."
  let sarvarcGisReadyPromise = null;
  let sarvarcGisTokenClient = null;
  function sarvarcLoadGis() {
    if (sarvarcGisReadyPromise) return sarvarcGisReadyPromise;
    sarvarcGisReadyPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('GIS_LOAD_FAILED'));
      document.head.appendChild(s);
    });
    return sarvarcGisReadyPromise;
  }
  async function sarvarcSilentDriveTokenRefresh(hintEmail, opts) {
    if (!SARVARC_GOOGLE_CLIENT_ID) return null;
    // Auto-triggered refreshes (page load, background Drive sync) used to
    // open Google account-chooser popups the person never asked for,
    // which blockers silently kill or which pile up as "extra Google
    // boxes". Only run this when explicitly told it came from a click.
    if (!opts || opts.userInitiated !== true) return null;
    try { await sarvarcLoadGis(); } catch (e) { return null; }
    return new Promise((resolve) => {
      try {
        if (!sarvarcGisTokenClient) {
          sarvarcGisTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: SARVARC_GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: () => {} // overwritten per-call just below
          });
        }
        sarvarcGisTokenClient.callback = (resp) => {
          if (resp && resp.access_token) {
            sarvarcDriveCacheToken(resp.access_token, resp.expires_in);
            resolve(resp.access_token);
          } else {
            resolve(null);
          }
        };
        sarvarcGisTokenClient.error_callback = () => resolve(null);
        sarvarcGisTokenClient.requestAccessToken({ prompt: '', hint: hintEmail || undefined });
      } catch (e) { resolve(null); }
    });
  }

  // Single-flight guard: on refresh/login, several independent things
  // (sarvarcDriveSyncDownHard, sarvarcDriveSyncUp, sarvarcAssetsSyncDown,
  // sarvarcAssetsSyncUp, plus any sarvarcDriveAvailable() check) all fire
  // at once. Without this, each one that misses the cached-token fast path
  // would independently call sarvarcSilentDriveTokenRefresh() -> Google's
  // requestAccessToken(), which is what produced the multiple Google
  // account-chooser boxes on refresh. Now only the FIRST caller actually
  // does the work; everyone else just awaits that same in-flight promise.
  let sarvarcDriveTokenInFlight = null;
  async function sarvarcDriveGetToken() {
    if (sarvarcDriveTokenInFlight) return sarvarcDriveTokenInFlight;
    sarvarcDriveTokenInFlight = sarvarcDriveGetTokenInner().finally(() => {
      sarvarcDriveTokenInFlight = null;
    });
    return sarvarcDriveTokenInFlight;
  }
  async function sarvarcDriveGetTokenInner() {
    try {
      let { data: { session } } = await sarvarcSupabase.auth.getSession();
      if (!session) { sarvarcDriveClearCachedToken(); return null; }

      // A fresh provider_token straight from Supabase is always the source
      // of truth — this is the one moment it's actually handed back, so
      // cache it now for the next reload.
      if (session.provider_token) {
        sarvarcDriveCacheToken(session.provider_token, session.provider_token_expires_at
          ? (session.provider_token_expires_at - Math.floor(Date.now() / 1000))
          : 3300);
        return session.provider_token;
      }

      // Fast path: a still-valid token cached from earlier this session.
      const cached = sarvarcDriveReadCachedToken();
      if (cached) return cached;

      // provider_token is missing — try Supabase's own refresh once (free,
      // harmless no-op if it doesn't come back with one).
      try {
        const { data: refreshed } = await sarvarcSupabase.auth.refreshSession();
        if (refreshed && refreshed.session && refreshed.session.provider_token) {
          sarvarcDriveCacheToken(refreshed.session.provider_token, refreshed.session.provider_token_expires_at
            ? (refreshed.session.provider_token_expires_at - Math.floor(Date.now() / 1000))
            : 3300);
          return refreshed.session.provider_token;
        }
      } catch (e) { /* ignore — fall through to the silent-refresh fallback */ }

      // Last resort: ask Google directly for a fresh Drive-scoped token.
      const silent = await sarvarcSilentDriveTokenRefresh(session.user && session.user.email);
      if (silent) return silent;

      return null;
    } catch (e) { return null; }
  }

  async function sarvarcDriveAvailable() {
    return !!(await sarvarcDriveGetToken());
  }

  async function sarvarcDriveFetch(path, opts = {}) {
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const res = await fetch('https://www.googleapis.com/drive/v3/' + path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('DRIVE_API_' + res.status);
    return res;
  }

  async function sarvarcDriveEnsureFolder() {
    if (sarvarcDriveFolderId) return sarvarcDriveFolderId;
    const q = encodeURIComponent(
      `name='${SARVARC_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const listRes = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      sarvarcDriveFolderId = listData.files[0].id;
      return sarvarcDriveFolderId;
    }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!createRes.ok) throw new Error('DRIVE_FOLDER_CREATE_' + createRes.status);
    const createData = await createRes.json();
    sarvarcDriveFolderId = createData.id;
    return sarvarcDriveFolderId;
  }

  // Create-or-update a session record as one JSON file in the app's Drive
  // folder. rec.driveFileId (if already known) is passed in so repeat saves
  // of the same session update the same Drive file instead of duplicating it.
  async function sarvarcDriveSaveSession(rec) {
    const folderId = await sarvarcDriveEnsureFolder();
    const isUpdate = !!rec.driveFileId;
    const metadata = isUpdate
      ? { appProperties: { sarvarcSessionId: rec.id, sarvarcSessionName: rec.name } }
      : { name: rec.id + '.json', parents: [folderId],
          appProperties: { sarvarcSessionId: rec.id, sarvarcSessionName: rec.name } };
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    // Resumable upload, not multipart. Drive's uploadType=multipart endpoint
    // (what this used to call) is documented as good for small files only —
    // 5MB or less per request. A session record easily clears 5MB once it
    // has any real attachments in it (see MAKE FORMS ATTACHMENTS), and this
    // whole call is wrapped in a try/catch by the caller, so a failure here
    // was invisible: the session would keep saving fine to THIS device's
    // IndexedDB while its Drive mirror silently stopped updating — meaning
    // signing in elsewhere (or after local storage was cleared) would pull
    // back an old, smaller snapshot missing whatever was added since.
    // Resumable upload has no such size ceiling, so this now handles small
    // and large sessions the same way.
    const startUrl = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${rec.driveFileId}?uploadType=resumable`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`;
    const startRes = await fetch(startUrl, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });
    if (!startRes.ok) throw new Error('DRIVE_SAVE_START_' + startRes.status);
    const uploadUrl = startRes.headers.get('Location');
    if (!uploadUrl) throw new Error('DRIVE_SAVE_NO_UPLOAD_URL');
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    });
    if (!putRes.ok) throw new Error('DRIVE_SAVE_' + putRes.status);
    const data = await putRes.json();
    return data.id;
  }

  // Lists session files currently in the app's Drive folder — this is what
  // makes saved files "follow the login": whichever Google account is
  // signed in, this only ever sees files inside its own Drive.
  //
  // Two scale improvements over a single flat request:
  //  - Pagination: walks Drive's nextPageToken instead of one pageSize:1000
  //    request, so this keeps working correctly (not silently truncating)
  //    for an account with thousands of saved sessions.
  //  - Delta filtering: pass opts.modifiedAfter (epoch ms) to ask Drive's
  //    API itself for only files touched since that time, instead of
  //    listing — and re-checking against IndexedDB — every file every
  //    time. sarvarcDriveGetLastSyncedCursor() below supplies this from the
  //    last successful sync automatically for background/auto passes.
  async function sarvarcDriveListSessions(opts) {
    opts = opts || {};
    const folderId = await sarvarcDriveEnsureFolder();
    let q = `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`;
    if (opts.modifiedAfter) {
      q += ` and modifiedTime > '${new Date(opts.modifiedAfter).toISOString()}'`;
    }
    const qEncoded = encodeURIComponent(q);
    let allFiles = [];
    let pageToken = '';
    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const res = await sarvarcDriveFetch(
        `files?q=${qEncoded}&fields=nextPageToken,files(id,appProperties,modifiedTime)&spaces=drive&pageSize=200${pageParam}`
      );
      const data = await res.json();
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return allFiles.map(f => ({
      id: (f.appProperties && f.appProperties.sarvarcSessionId) || f.id,
      driveFileId: f.id,
      name: (f.appProperties && f.appProperties.sarvarcSessionName) || 'Untitled',
      savedAt: new Date(f.modifiedTime).getTime()
    }));
  }

  // Cursor for delta syncs: the last successful sync time, minus a small
  // safety buffer for clock skew between this browser and Drive's server
  // and for a file saved in the same second a sync completes. Reads the
  // same localStorage key sarvarcSetDriveStatus() writes to (see the Drive
  // status panel code above), so both features share one source of truth
  // instead of tracking the timestamp twice.
  function sarvarcDriveGetLastSyncedCursor() {
    try {
      const raw = localStorage.getItem('sarvarcDriveLastSyncedAt');
      const ts = raw ? parseInt(raw, 10) : NaN;
      if (isNaN(ts)) return null;
      return ts - 60000;
    } catch (e) { return null; }
  }

  async function sarvarcDriveLoadSession(driveFileId) {
    const res = await sarvarcDriveFetch(`files/${driveFileId}?alt=media`);
    return res.json();
  }

  async function sarvarcDriveDeleteSession(driveFileId) {
    await sarvarcDriveFetch(`files/${driveFileId}`, { method: 'DELETE' });
  }

  // Pulls any Drive session not already present in this browser's local
  // IndexedDB down into it (matched by id), so the EXISTING smListSessions/
  // smLoadSession code (untouched, still reads only from IndexedDB) picks
  // them up automatically — no changes needed to how sessions are displayed
  // or opened. Runs once after login; safe to call repeatedly. Anything that
  // fails here (offline, Drive API not yet enabled on the project, etc.) is
  // swallowed — local sessions remain fully usable either way.
  // Set for the duration of a sync pull so the Saved Sessions page can tell
  // "genuinely nothing saved yet" apart from "still checking Drive" — without
  // this, a fresh device with sessions waiting on the account would flash an
  // empty "No saved sessions yet" state for the 2-3s the Drive round-trip
  // takes, which reads as "my files are gone" even though nothing was lost.
  window.sarvarcDriveSyncPending = false;

  // opts.forceFull=true skips the delta cursor and lists the whole Drive
  // folder — used for an explicit user-triggered refresh (drag/button),
  // which doubles as a full reconcile safety net against the (unlikely)
  // case a delta pass ever missed something. Background/auto passes
  // (login, poll, tab-focus) default to the efficient delta path.
  async function sarvarcDriveSyncDown(opts) {
    opts = opts || {};
    // Flip the flag and repaint immediately (still synchronous at this point,
    // before the first await below) so the very first render after sign-in
    // already shows "checking Drive" instead of the empty state.
    window.sarvarcDriveSyncPending = true;
    if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
    if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('syncing');
    try {
      if (!(await sarvarcDriveAvailable())) {
        if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('not_connected');
        return;
      }
      const cursor = (!opts.forceFull && typeof sarvarcDriveGetLastSyncedCursor === 'function')
        ? sarvarcDriveGetLastSyncedCursor() : null;
      const [driveSessions, db] = await Promise.all([
        sarvarcDriveListSessions({ modifiedAfter: cursor }), idbKvOpen()
      ]);
      let pulledAny = false;
      for (const ds of driveSessions) {
        const existing = await new Promise((resolve) => {
          const tx = db.transaction('sessions', 'readonly');
          const req = tx.objectStore('sessions').get(ds.id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        if (existing) continue; // already local — local copy wins, no overwrite
        try {
          const full = await sarvarcDriveLoadSession(ds.driveFileId);
          await new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put(full);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          pulledAny = true;
        } catch (e) { console.warn('[Drive sync] could not pull session', ds.id, e); }
      }
      // The SIGNED_IN auth event already re-renders the Saved Sessions list
      // once, but that happens before this fire-and-forget pull has finished
      // — so on a fresh device (nothing local yet), that first render shows
      // an empty/incomplete list. Re-render again now that new sessions have
      // actually landed in IndexedDB, so they appear without the person
      // needing to click anything.
      if (pulledAny && document.getElementById('smSessionList') && typeof smRenderList === 'function') {
        smRenderList();
      }
      if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('connected');
    } catch (e) {
      console.warn('[Drive sync] skipped', e);
      if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('error');
    }
    finally {
      // Always clear + repaint, whether the pull found new sessions, found
      // none, or failed outright — otherwise "checking Drive" could get
      // stuck on screen, and a genuinely-empty account would never fall
      // through to the real "No saved sessions yet" message.
      window.sarvarcDriveSyncPending = false;
      if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
    }
  }

  // ── Hard login sync ──────────────────────────────────────────────────────
  // sarvarcDriveSyncDown() above is a single best-effort attempt, which is
  // fine for a manual refresh or the background poll (both run once the
  // session is already fully warmed up). Right at login it isn't enough on
  // its own: Supabase's provider_token (Google's Drive access token) can
  // take a moment to actually land in the session right after the OAuth
  // redirect/popup closes, so a single attempt fired the instant the login
  // event fires can find no token yet and quietly return with nothing —
  // which is exactly the "my saved files aren't here" case this whole
  // feature exists to fix. This is the real, forced call: it keeps
  // window.sarvarcDriveSyncPending set (so the UI stays on "checking
  // Drive…" instead of flashing empty) and actually retries the full pull —
  // token fetch and all — several times with a short backoff before it
  // gives up. Still swallows errors at the end (a genuinely signed-out-of-
  // Google user shouldn't see a Drive error), but it no longer gives up
  // after one attempt.
  async function sarvarcDriveSyncDownHard(maxAttempts, retryDelayMs) {
    maxAttempts = maxAttempts || 5;
    retryDelayMs = retryDelayMs || 1500;
    window.sarvarcDriveSyncPending = true;
    if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
    if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('syncing');
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let token = null;
        try { token = await sarvarcDriveGetToken(); } catch (e) { /* fall through to retry */ }
        if (!token) {
          if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, retryDelayMs)); continue; }
          console.warn('[Drive sync] no Drive token after ' + maxAttempts + ' attempts — not signed in with Google, or Drive access was declined');
          if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('not_connected');
          return;
        }
        try {
          // Delta by default (see sarvarcDriveGetLastSyncedCursor) — a device
          // that's synced before only asks Drive for what changed since
          // then. A brand-new device has no cursor yet, so this naturally
          // falls back to a full listing on its first-ever login sync.
          const cursor = (typeof sarvarcDriveGetLastSyncedCursor === 'function') ? sarvarcDriveGetLastSyncedCursor() : null;
          const [driveSessions, db] = await Promise.all([
            sarvarcDriveListSessions({ modifiedAfter: cursor }), idbKvOpen()
          ]);
          let pulledAny = false;
          for (const ds of driveSessions) {
            const existing = await new Promise((resolve) => {
              const tx = db.transaction('sessions', 'readonly');
              const req = tx.objectStore('sessions').get(ds.id);
              req.onsuccess = () => resolve(req.result || null);
              req.onerror = () => resolve(null);
            });
            if (existing) continue; // already local — local copy wins, no overwrite
            try {
              const full = await sarvarcDriveLoadSession(ds.driveFileId);
              await new Promise((resolve, reject) => {
                const tx = db.transaction('sessions', 'readwrite');
                tx.objectStore('sessions').put(full);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
              });
              pulledAny = true;
            } catch (e) { console.warn('[Drive sync] could not pull session', ds.id, e); }
          }
          if (pulledAny && document.getElementById('smSessionList') && typeof smRenderList === 'function') {
            smRenderList();
          }
          if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('connected');
          return; // real pull actually completed — done, no need to retry further
        } catch (e) {
          console.warn('[Drive sync] hard login pull attempt ' + attempt + ' failed', e);
          if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, retryDelayMs)); continue; }
          if (typeof sarvarcSetDriveStatus === 'function') sarvarcSetDriveStatus('error');
        }
      }
    } finally {
      window.sarvarcDriveSyncPending = false;
      if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
    }
  }

  // Companion to sarvarcDriveSyncDown: pushes UP any session that's sitting
  // in local IndexedDB but never made it to Drive (rec.driveFileId is
  // missing) — e.g. it was saved while the Google token had expired, so the
  // fire-and-forget mirror in smSaveSession quietly skipped it. Runs right
  // after sign-in, when the token is freshest, so a session created on PC A
  // while offline-from-Drive gets a second chance to reach the account
  // before the person even opens PC B. Same "never blocks, never breaks
  // local data" guarantee as the rest of this file.
  async function sarvarcDriveSyncUp() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const db = await idbKvOpen();
      const local = await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const pending = local.filter(function (rec) {
        return rec && rec.ownerEmail && !rec.driveFileId;
      });
      let pushedAny = false;
      for (const rec of pending) {
        try {
          const driveFileId = await sarvarcDriveSaveSession(rec);
          if (driveFileId) {
            rec.driveFileId = driveFileId;
            await new Promise((resolve) => {
              const tx = db.transaction('sessions', 'readwrite');
              tx.objectStore('sessions').put(rec);
              tx.oncomplete = resolve;
              tx.onerror = () => resolve();
            });
            pushedAny = true;
          }
        } catch (e) { console.warn('[Drive sync] could not push pending session', rec.id, e); }
      }
      if (pushedAny) {
        if (typeof toast === 'function') toast('Caught up ' + pending.length + ' session(s) to your account.', 'success');
        if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
      }
    } catch (e) { console.warn('[Drive sync up] skipped', e); }
  }
