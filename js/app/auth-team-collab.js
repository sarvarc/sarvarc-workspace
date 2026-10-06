
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

  // ============== GOOGLE DRIVE SYNC — ASSETS (optional, opt-in, additive) ==
  // Same guarantees as the session sync above: purely a mirror on top of the
  // local IndexedDB 'assets' store, using the signed-in user's own OAuth
  // token, and any failure here is swallowed so the local Assets library
  // (images/logos/signatures in the right panel) always keeps working even
  // offline or logged out. Files live in their own "SARVARC Assets" folder
  // nested inside the same app folder sessions use.
  const SARVARC_ASSETS_FOLDER_NAME = 'SARVARC Assets';
  let sarvarcAssetsDriveFolderId = null;

  async function sarvarcDriveEnsureAssetsFolder() {
    if (sarvarcAssetsDriveFolderId) return sarvarcAssetsDriveFolderId;
    const parentId = await sarvarcDriveEnsureFolder();
    const q = encodeURIComponent(
      `name='${SARVARC_ASSETS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    );
    const listRes = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      sarvarcAssetsDriveFolderId = listData.files[0].id;
      return sarvarcAssetsDriveFolderId;
    }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_ASSETS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!createRes.ok) throw new Error('DRIVE_ASSETS_FOLDER_CREATE_' + createRes.status);
    const createData = await createRes.json();
    sarvarcAssetsDriveFolderId = createData.id;
    return sarvarcAssetsDriveFolderId;
  }

  function sarvarcDataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:(.*?);base64/) || [, 'image/png'])[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Create-or-update one asset (image/logo/signature) as an actual image
  // file in the app's Drive Assets folder — viewable in Drive itself, not
  // just JSON. rec.driveFileId (if already known) updates that same file
  // instead of duplicating it. On success, writes the returned driveFileId
  // back onto the local IndexedDB record so repeat saves stay in place.
  async function sarvarcDriveSaveAsset(rec) {
    const folderId = await sarvarcDriveEnsureAssetsFolder();
    const isUpdate = !!rec.driveFileId;
    const blob = sarvarcDataUrlToBlob(rec.dataUrl);
    const ext = ((blob.type.split('/')[1] || 'png').split('+')[0]) || 'png';
    const metadata = isUpdate
      ? { appProperties: { sarvarcAssetId: rec.id, sarvarcAssetType: rec.type, sarvarcAssetName: rec.name } }
      : { name: rec.id + '.' + ext, parents: [folderId],
          appProperties: { sarvarcAssetId: rec.id, sarvarcAssetType: rec.type, sarvarcAssetName: rec.name } };
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    const url = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${rec.driveFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) throw new Error('DRIVE_ASSET_SAVE_' + res.status);
    const data = await res.json();
    if (!isUpdate && typeof sarvarcAssetPut === 'function') {
      rec.driveFileId = data.id;
      sarvarcAssetPut(rec);
    }
    return data.id;
  }

  async function sarvarcDriveListAssets() {
    const folderId = await sarvarcDriveEnsureAssetsFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,appProperties,modifiedTime)&spaces=drive&pageSize=1000`);
    const data = await res.json();
    return (data.files || []).map(f => ({
      id: (f.appProperties && f.appProperties.sarvarcAssetId) || f.id,
      driveFileId: f.id,
      type: (f.appProperties && f.appProperties.sarvarcAssetType) || 'image',
      name: (f.appProperties && f.appProperties.sarvarcAssetName) || 'Untitled',
      savedAt: new Date(f.modifiedTime).getTime()
    }));
  }

  async function sarvarcDriveLoadAsset(driveFileId) {
    const res = await sarvarcDriveFetch(`files/${driveFileId}?alt=media`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function sarvarcDriveDeleteAsset(driveFileId) {
    await sarvarcDriveFetch(`files/${driveFileId}`, { method: 'DELETE' });
  }

  // Pulls down any Drive asset not already present locally (matched by id) —
  // this is what makes the Assets library "follow the login" the same way
  // Saved Sessions does. Local copies always win; nothing is overwritten.
  async function sarvarcAssetsSyncDown() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const driveAssets = await sarvarcDriveListAssets();
      const ownerEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
      let pulledAny = false;
      for (const da of driveAssets) {
        // Raw (un-gated) lookup for the dedupe check — this only asks "is
        // this id already in local storage at all", not "can the current
        // account see it", so it can't be tricked into re-pulling/duplicating
        // a record that's already there under a (theoretically impossible,
        // since ids are unique per creation) different owner.
        const existing = await sarvarcAssetGetRaw(da.id);
        if (existing) continue;
        try {
          const dataUrl = await sarvarcDriveLoadAsset(da.driveFileId);
          await sarvarcAssetPut({
            id: da.id, type: da.type, name: da.name, dataUrl,
            createdAt: da.savedAt, checked: false,
            // Tag with the account whose Drive folder this came from, so it
            // stays scoped to that account locally too — matching how a
            // pulled-down session gets its ownerEmail preserved from Drive.
            ownerEmail: ownerEmail || null,
            driveFileId: da.driveFileId
          });
          pulledAny = true;
        } catch (e) { console.warn('[Drive sync] could not pull asset', da.id, e); }
      }
      if (pulledAny && typeof sarvarcAssetsRenderPanel === 'function') sarvarcAssetsRenderPanel();
    } catch (e) { console.warn('[Drive sync] assets skipped', e); }
  }

  // Companion to sarvarcAssetsSyncDown: pushes up any locally-saved asset
  // that never made it to Drive (e.g. saved while offline or token expired).
  async function sarvarcAssetsSyncUp() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const local = await sarvarcAssetList();
      for (const rec of local) {
        if (rec.driveFileId) continue;
        try { await sarvarcDriveSaveAsset(rec); } catch (e) { /* best-effort, ignore */ }
      }
    } catch (e) { console.warn('[Drive sync] assets up skipped', e); }
  }

  // ============== GOOGLE DRIVE SYNC — MY SHAPES (optional, opt-in, additive) ==
  // Custom Image Reshaper shapes ("My Shapes") follow the signed-in account
  // exactly like the Assets library does: the local IndexedDB copy is the
  // source of truth and always works offline / logged out; this layer is a
  // best-effort MIRROR using the person's own OAuth token, so it can never
  // block or break a local save. Each shape is one tiny JSON file (its path
  // + editable points) in a "SARVARC Shapes" folder nested in the same app
  // folder the sessions and assets use. Local copies always win on sync, and
  // a deleted shape is tracked so it's removed from Drive too and never
  // re-appears on another device.
  const SARVARC_SHAPES_FOLDER_NAME = 'SARVARC Shapes';
  let sarvarcShapesDriveFolderId = null;

  async function sarvarcDriveEnsureShapesFolder() {
    if (sarvarcShapesDriveFolderId) return sarvarcShapesDriveFolderId;
    const parentId = await sarvarcDriveEnsureFolder();
    const q = encodeURIComponent(
      `name='${SARVARC_SHAPES_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    );
    const listRes = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      sarvarcShapesDriveFolderId = listData.files[0].id;
      return sarvarcShapesDriveFolderId;
    }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_SHAPES_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!createRes.ok) throw new Error('DRIVE_SHAPES_FOLDER_CREATE_' + createRes.status);
    const createData = await createRes.json();
    sarvarcShapesDriveFolderId = createData.id;
    return sarvarcShapesDriveFolderId;
  }

  // Create-or-update one shape as a JSON file. rec.driveFileId (if known)
  // updates the same file instead of duplicating it.
  async function sarvarcDriveSaveShape(rec) {
    const folderId = await sarvarcDriveEnsureShapesFolder();
    const isUpdate = !!rec.driveFileId;
    const payload = { id: rec.id, name: rec.name, d: rec.d, nodes: rec.nodes || null, smooth: rec.smooth, createdAt: rec.createdAt, updatedAt: rec.updatedAt || null };
    const metadata = isUpdate
      ? { appProperties: { sarvarcShapeId: rec.id } }
      : { name: rec.id + '.json', parents: [folderId], appProperties: { sarvarcShapeId: rec.id } };
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const url = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${rec.driveFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) throw new Error('DRIVE_SHAPE_SAVE_' + res.status);
    const data = await res.json();
    if (!isUpdate) {
      rec.driveFileId = data.id;
      if (typeof rshMyShapesPersist === 'function') await rshMyShapesPersist();
    }
    return data.id;
  }

  async function sarvarcDriveListShapes() {
    const folderId = await sarvarcDriveEnsureShapesFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,appProperties,modifiedTime)&spaces=drive&pageSize=1000`);
    const data = await res.json();
    return (data.files || []).map(f => ({
      id: (f.appProperties && f.appProperties.sarvarcShapeId) || null,
      driveFileId: f.id
    })).filter(f => f.id);
  }

  async function sarvarcDriveLoadShape(driveFileId) {
    const res = await sarvarcDriveFetch(`files/${driveFileId}?alt=media`);
    return await res.json();
  }

  async function sarvarcDriveDeleteShape(driveFileId) {
    await sarvarcDriveFetch(`files/${driveFileId}`, { method: 'DELETE' });
  }

  // Pulls down any Drive shape not already on this device. Local copies win.
  async function sarvarcShapesSyncDown() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const remote = await sarvarcDriveListShapes();
      await rshMyShapesLoad(true);
      const dead = await rshTombLoad();
      let changed = false;
      for (const rf of remote) {
        if (dead.some(t => t.id === rf.id || (t.driveFileId && t.driveFileId === rf.driveFileId))) continue;
        const local = rshMyShapes.find(s => s.id === rf.id);
        if (local) {
          if (!local.driveFileId) { local.driveFileId = rf.driveFileId; changed = true; }
          continue;
        }
        try {
          const rec = await sarvarcDriveLoadShape(rf.driveFileId);
          if (!rec || !rshShapeIdOk(rec.id) || !rshShapePathOk(rec.d)) continue;
          rshMyShapes.push({
            id: rec.id, name: String(rec.name || 'My Shape').slice(0, 40), d: rec.d,
            nodes: Array.isArray(rec.nodes) ? rec.nodes : null,
            smooth: typeof rec.smooth === 'number' ? rec.smooth : 100,
            createdAt: rec.createdAt || Date.now(), driveFileId: rf.driveFileId
          });
          changed = true;
        } catch (e) { console.warn('[Drive sync] could not pull shape', rf.id, e); }
      }
      if (changed) {
        rshMyShapes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        await rshMyShapesPersist();
        const ov = document.getElementById('reshapeOverlay');
        if (ov && ov.classList.contains('open') && typeof renderReshapeGrid === 'function') renderReshapeGrid();
      }
    } catch (e) { console.warn('[Drive sync] shapes skipped', e); }
  }

  // Pushes up shapes that never reached Drive, and removes deleted ones.
  async function sarvarcShapesSyncUp() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const tomb = await rshTombLoad();
      if (tomb.length) {
        const keep = [];
        for (const t of tomb) {
          if (!t.driveFileId) continue;
          try { await sarvarcDriveDeleteShape(t.driveFileId); }
          catch (e) { if (!/_404$/.test(String(e && e.message))) keep.push(t); }
        }
        await rshKvPut('myShapesDeleted', keep);
      }
      await rshMyShapesLoad(true);
      for (const rec of rshMyShapes) {
        if (rec.driveFileId) continue;
        try { await sarvarcDriveSaveShape(rec); } catch (e) { /* best-effort, ignore */ }
      }
    } catch (e) { console.warn('[Drive sync] shapes up skipped', e); }
  }

  let sarvarcAuthMode = 'login'; // 'login' | 'signup'
  let sarvarcAuthBusy = false;

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

  // =========================================================
  // LIVE CO-EDITING CORE — one reusable engine, shared by every module.
  //
  // How it works: each live team project gets one Yjs document (a CRDT —
  // conflict-free replicated data type). Every module that wants live
  // co-editing gets its own named Y.Map/Y.Array inside that shared doc
  // instead of storing its data as a plain JS object. When two people
  // edit at once, Yjs merges both edits automatically — nobody's change
  // silently overwrites the other's, which is the problem a plain
  // "last save wins" snapshot has.
  //
  // Transport: Supabase Realtime `broadcast` (same mechanism already
  // used for the "who's online" presence dot below) relays tiny binary
  // update packets between everyone with this project open — no extra
  // server. This is NOT the historical "Team Projects" list (named
  // checkpoints in the `team_projects` table/Storage bucket) — that
  // stays as-is for versioned backups. This is the live, in-memory layer
  // that exists only while people actually have the project open.
  //
  // Per-module integration contract: register a module with
  // sarvarcCollabRegisterModule(key, { attach(doc, awareness), detach() }).
  // attach() is called once connected; it should read/observe its Y type
  // and keep the module's normal in-memory state + UI in sync with it.
  // =========================================================
  let sarvarcCollabDoc = null;
  let sarvarcCollabAwareness = null;
  let sarvarcCollabChannel = null;
  let sarvarcCollabProjectId = null;
  const sarvarcCollabModules = {}; // key -> { attach(doc, awareness), detach() }
  const sarvarcCollabAttached = new Set();

  // Sync-health indicator: a small spinning ring next to the "Live" badge.
  // Spinning = the last change we tried to send or received actually went
  // through. It freezes (and turns red) the moment a send fails or a
  // received packet can't be applied — a plain, always-on signal that
  // doesn't require opening devtools to tell "is this actually reaching
  // the other person right now" from "it just looks connected".
  let sarvarcCollabHealthy = true;
  function sarvarcCollabSetHealthy(ok) {
    sarvarcCollabHealthy = ok;
    const el = document.getElementById('sarvarcCollabSyncIcon');
    if (!el) return;
    el.classList.toggle('sarvarc-collab-stalled', !ok);
    el.title = ok
      ? 'Syncing with your team'
      : 'Sync stalled — your last change may not have reached your teammates. Try again or refresh.';
  }

  // Replaces the early stub (see the queuing script right after the Yjs
  // loader, near the top of the page) — from here on this is the real
  // implementation, used by any module that registers from now on.
  function sarvarcCollabRegisterModule(key, impl) {
    sarvarcCollabModules[key] = impl;
    // If we're already connected when a module registers (e.g. its script
    // block runs after this one on page load), attach it immediately.
    if (sarvarcCollabDoc && !sarvarcCollabAttached.has(key)) {
      sarvarcCollabAttached.add(key);
      try { impl.attach(sarvarcCollabDoc, sarvarcCollabAwareness); } catch (e) { console.warn('[Collab] attach failed for', key, e); }
    }
  }
  // Drain anything modules queued before this real version existed.
  (window.sarvarcCollabPending || []).forEach(([key, impl]) => sarvarcCollabRegisterModule(key, impl));
  window.sarvarcCollabPending = { push: ([key, impl]) => sarvarcCollabRegisterModule(key, impl) };

  function sarvarcCollabIsLive() { return !!sarvarcCollabDoc; }

  // Waits for the Yjs module script (loaded as `type=module`, so it may
  // not have run yet) before doing anything that needs window.Yjs.
  function sarvarcCollabWaitForYjs() {
    if (window.Yjs && window.YAwareness) return Promise.resolve();
    return new Promise(resolve => {
      window.addEventListener('sarvarc-yjs-ready', () => resolve(), { once: true });
    });
  }

  async function sarvarcCollabConnect(teamProjectId) {
    await sarvarcCollabWaitForYjs();
    if (sarvarcCollabProjectId === teamProjectId && sarvarcCollabDoc) return; // already connected to this one
    if (sarvarcCollabDoc) sarvarcCollabDisconnect();

    const Y = window.Yjs;
    const user = await sarvarcTeamGetUser();
    if (!user) return;

    const doc = new Y.Doc();
    const awareness = new window.YAwareness.Awareness(doc);
    const channel = sarvarcSupabase.channel('sarvarc-live-' + teamProjectId, { config: { broadcast: { self: false } } });

    // Incoming CRDT updates from teammates — merge into our doc. Tag the
    // transaction origin 'remote' so module attach() observers can tell
    // "this came from a teammate, just re-render" apart from "this is my
    // own edit, also push it out" and avoid an echo loop.
    channel.on('broadcast', { event: 'yupdate' }, (msg) => {
      try {
        const update = sarvarcCollabB64ToBytes(msg.payload.u);
        Y.applyUpdate(doc, update, 'remote');
        sarvarcCollabSetHealthy(true);
      } catch (e) {
        console.warn('[Collab] bad update packet', e);
        sarvarcCollabSetHealthy(false);
      }
    });
    channel.on('broadcast', { event: 'yaware' }, (msg) => {
      try {
        const update = sarvarcCollabB64ToBytes(msg.payload.u);
        window.YAwareness.applyAwarenessUpdate(awareness, update, 'remote');
      } catch (e) { console.warn('[Collab] bad awareness packet', e); }
    });

    // Any local change (from us, in this tab) gets broadcast out. Yjs
    // fires this for both local and applied-remote updates, so we skip
    // re-broadcasting updates that just came in from 'remote' — otherwise
    // every client would loop the same update back and forth forever.
    // channel.send() resolves 'ok' / 'error' / 'timed out' — this used to
    // go unchecked, so a failed send (e.g. Realtime broadcast rejected)
    // failed completely silently. Now it drives the sync-health spinner.
    doc.on('update', (update, origin) => {
      if (origin === 'remote') return;
      channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: sarvarcCollabBytesToB64(update) } })
        .then((status) => {
          if (status !== 'ok') console.warn('[Collab] send status:', status);
          sarvarcCollabSetHealthy(status === 'ok');
        })
        .catch((e) => {
          console.warn('[Collab] send threw', e);
          sarvarcCollabSetHealthy(false);
        });
    });
    awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === 'remote') return;
      const changed = added.concat(updated, removed);
      const update = window.YAwareness.encodeAwarenessUpdate(awareness, changed);
      channel.send({ type: 'broadcast', event: 'yaware', payload: { u: sarvarcCollabBytesToB64(update) } });
    });

    await new Promise(resolve => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Announce our identity for the field-level "who's editing what"
          // indicators, and nudge our current doc state out so anyone
          // already in the room converges with us (Yjs updates are
          // idempotent/mergeable, so re-sending our full state is safe).
          const m = sarvarcTeamMembersCache[user.id];
          awareness.setLocalState({ userId: user.id, name: (m && m.full_name) || user.email, avatar: (m && m.avatar_url) || null, color: sarvarcCollabColorFor(user.id) });
          channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: sarvarcCollabBytesToB64(Y.encodeStateAsUpdate(doc)) } });
          resolve();
        }
      });
    });

    sarvarcCollabDoc = doc;
    sarvarcCollabAwareness = awareness;
    sarvarcCollabChannel = channel;
    sarvarcCollabProjectId = teamProjectId;
    sarvarcCollabSetHealthy(true); // fresh connection starts clean; the spinner only freezes on an actual failed send/receive
    sarvarcCollabAttached.clear();
    Object.keys(sarvarcCollabModules).forEach(key => {
      sarvarcCollabAttached.add(key);
      try { sarvarcCollabModules[key].attach(doc, awareness); } catch (e) { console.warn('[Collab] attach failed for', key, e); }
    });
    // Start showing who's here + live cursors + field presence now that
    // we're actually connected (see LIVE PRESENCE UI block above).
    sarvarcPresenceAttachInputListeners(awareness);
  }

  function sarvarcCollabDisconnect() {
    sarvarcPresenceDetachInputListeners();
    Object.keys(sarvarcCollabModules).forEach(key => {
      if (sarvarcCollabAttached.has(key)) {
        try { sarvarcCollabModules[key].detach(); } catch (e) {}
      }
    });
    sarvarcCollabAttached.clear();
    if (sarvarcCollabChannel) { try { sarvarcSupabase.removeChannel(sarvarcCollabChannel); } catch (e) {} }
    if (sarvarcCollabDoc) { try { sarvarcCollabDoc.destroy(); } catch (e) {} }
    sarvarcCollabDoc = null;
    sarvarcCollabAwareness = null;
    sarvarcCollabChannel = null;
    sarvarcCollabProjectId = null;
    localStorage.removeItem('sarvarcLiveCollabTeamProjectId');
    localStorage.removeItem('sarvarcLiveCollabTeamId');
    localStorage.removeItem('sarvarcLiveCollabSessionId');
  }

  function sarvarcCollabBytesToB64(bytes) {
    let bin = ''; const len = bytes.byteLength;
    for (let i = 0; i < len; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function sarvarcCollabB64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // Stable-ish color per user id, for cursor/field-presence badges.
  const SARVARC_COLLAB_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
  function sarvarcCollabColorFor(userId) {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
    return SARVARC_COLLAB_COLORS[h % SARVARC_COLLAB_COLORS.length];
  }

  // =========================================================
  // LIVE PRESENCE UI — "who's here right now" avatar bar, live mouse
  // cursors for everyone connected to the same live document, and a
  // colored ring + name badge on whichever field a teammate currently
  // has focused. Purely a rendering layer on top of the awareness
  // protocol already wired up above (awareness.setLocalState / the
  // 'yaware' broadcast channel) — no new transport needed.
  //
  // Cursor positions are broadcast as a fraction of the viewport
  // (xPct/yPct) rather than raw pixels, since two teammates' windows are
  // rarely the same size; each viewer renders every remote cursor at the
  // same relative spot in THEIR OWN window. Good enough for "I can see
  // roughly where you're pointing", not meant to be pixel-perfect.
  // =========================================================
  let sarvarcPresenceMouseHandler = null;
  let sarvarcPresenceFocusHandler = null;
  let sarvarcPresenceBlurHandler = null;
  let sarvarcPresenceStaleTimer = null;
  // userId -> { senderT, localSeenAt }. localSeenAt is stamped on OUR clock
  // the moment we first observe a given senderT, so cursor staleness never
  // depends on the sender's and viewer's system clocks agreeing (see the
  // "Live mouse cursors" block in sarvarcPresenceRender for why).
  const sarvarcPresenceCursorSeenAt = new Map();

  function sarvarcPresenceEnsureDom() {
    const cursorsLayer0 = document.getElementById('sarvarcCollabCursorsLayer');
    if (!cursorsLayer0) {
      const cursorsLayer = document.createElement('div');
      cursorsLayer.id = 'sarvarcCollabCursorsLayer';
      cursorsLayer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:850;overflow:hidden;';
      document.body.appendChild(cursorsLayer);
    }

    if (document.getElementById('sarvarcPresenceStyle')) return;
    const style = document.createElement('style');
    style.id = 'sarvarcPresenceStyle';
    style.textContent = `
      /* ── Live-members box, embedded in the top bar ─────────────────── */
      .sarvarc-presence-box {
        display:flex; align-items:center; gap:8px;
        margin-left:10px; padding:4px 10px 4px 8px;
        border-radius:20px; border:1px solid var(--border2);
        background:linear-gradient(180deg, rgba(16,185,129,0.10), rgba(16,185,129,0.03));
        flex-shrink:0; transition:opacity .25s ease;
      }
      .sarvarc-presence-live {
        font-size:9.5px;color:#10B981;letter-spacing:.08em;text-transform:uppercase;
        font-weight:800;display:flex;align-items:center;gap:5px;
      }
      /* Sync-health spinner: spinning cyan ring (matches the SARVARC accent)
         = last send/receive went through fine. Freezes + dims the instant a
         send fails or a received packet can't be applied, so a stalled
         connection is visible at a glance without opening devtools — no
         red/green traffic-light styling, stays in the app's own palette. */
      .sarvarc-collab-sync {
        width:10px; height:10px; border-radius:50%; flex-shrink:0;
        border:2px solid var(--border2); border-top-color:var(--accent, #00C2FF);
        animation: sarvarcCollabSpin 0.85s linear infinite;
      }
      .sarvarc-collab-sync.sarvarc-collab-stalled {
        animation:none; opacity:.4;
      }
      @keyframes sarvarcCollabSpin { to { transform:rotate(360deg); } }
      .sarvarc-presence-dot {
        width:6px;height:6px;border-radius:50%;background:#10B981;
        box-shadow:0 0 0 rgba(16,185,129,0.6);
        animation:sarvarcPresenceDotPulse 1.8s ease-in-out infinite;
      }
      @keyframes sarvarcPresenceDotPulse {
        0%   { box-shadow:0 0 0 0 rgba(16,185,129,0.55); }
        70%  { box-shadow:0 0 0 5px rgba(16,185,129,0); }
        100% { box-shadow:0 0 0 0 rgba(16,185,129,0); }
      }
      .sarvarc-presence-avatars { display:flex; align-items:center; }
      .sarvarc-presence-avatar-wrap {
        position:relative; width:26px; height:26px; margin-left:-8px; flex-shrink:0;
        border-radius:50%;
        /* the "breathing" — a slow, gentle scale + glow, staggered per person */
        animation:sarvarcPresenceBreathe 3.2s ease-in-out infinite;
      }
      .sarvarc-presence-avatar-wrap:first-child { margin-left:0; }
      @keyframes sarvarcPresenceBreathe {
        0%, 100% { transform:scale(1);    filter:drop-shadow(0 0 0 rgba(16,185,129,0)); }
        50%      { transform:scale(1.07); filter:drop-shadow(0 0 4px rgba(16,185,129,0.45)); }
      }
      .sarvarc-presence-avatar-img, .sarvarc-presence-avatar-fallback {
        width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center;
        font-size:10.5px; font-weight:700; color:#fff; border:2px solid var(--bg2);
        box-shadow:0 1px 4px rgba(0,0,0,0.35); cursor:default; object-fit:cover;
      }
      .sarvarc-presence-overflow {
        width:26px; height:26px; margin-left:-8px; border-radius:50%; flex-shrink:0;
        display:flex; align-items:center; justify-content:center;
        font-size:9.5px; font-weight:700; color:var(--text2); border:2px solid var(--bg2);
        background:var(--surface2); box-shadow:0 1px 4px rgba(0,0,0,0.3);
      }
      .sarvarc-remote-cursor { position:fixed;pointer-events:none;transition:left .08s linear, top .08s linear;z-index:851; }
      .sarvarc-remote-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
      .sarvarc-remote-cursor .sarvarc-cursor-label {
        position:absolute;left:14px;top:16px;white-space:nowrap;font-size:11px;font-weight:600;color:#fff;
        padding:2px 7px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,0.4);
      }
      .sarvarc-field-presence-ring { outline:2px solid;outline-offset:2px;border-radius:6px; }
      .sarvarc-field-presence-badge {
        position:absolute;font-size:10px;font-weight:700;color:#fff;padding:1px 6px;border-radius:5px 5px 5px 0;
        transform:translateY(-100%);white-space:nowrap;pointer-events:none;z-index:852;box-shadow:0 1px 3px rgba(0,0,0,0.4);
      }
      .sarvarc-end-live-btn {
        margin-left:8px; padding:4px 10px; font-size:10.5px; font-weight:600;
        color:#f59e0b; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.35);
        border-radius:20px; cursor:pointer; white-space:nowrap; flex-shrink:0;
        transition:background .15s,border-color .15s;
      }
      .sarvarc-end-live-btn:hover { background:rgba(245,158,11,0.16); border-color:#f59e0b; }
      @media (max-width: 900px) { .sarvarc-presence-box { display:none !important; } }
    `;
    document.head.appendChild(style);
  }

  // Initials from a display name, e.g. "Prayag Pathak" -> "PP".
  function sarvarcPresenceInitials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function sarvarcPresenceRender() {
    if (!sarvarcCollabAwareness) return;
    sarvarcPresenceEnsureDom();
    const bar = document.getElementById('sarvarcPresenceBox');
    const cursorsLayer = document.getElementById('sarvarcCollabCursorsLayer');
    if (!bar || !cursorsLayer) return;

    const states = sarvarcCollabAwareness.getStates();
    const localId = sarvarcCollabAwareness.clientID;
    const now = Date.now();
    // Dedupe by userId (same person could theoretically have >1 tab open);
    // keep whichever state has the freshest cursor timestamp.
    const remoteByUser = new Map();
    states.forEach((state, clientId) => {
      if (clientId === localId || !state || !state.userId) return;
      const existing = remoteByUser.get(state.userId);
      const existingT = (existing && existing.cursor && existing.cursor.t) || 0;
      const stateT = (state.cursor && state.cursor.t) || 0;
      if (!existing || stateT >= existingT) remoteByUser.set(state.userId, state);
    });

    // ---- "Who's here" box, embedded in the top bar ----
    // Real profile photos where we have them, round and gently "breathing"
    // (a slow scale + glow pulse, staggered per person) so a glance at the
    // top bar tells you who's live without it feeling busy or gimmicky.
    // The owner also gets an "End Live Session" control here — shown even
    // if they're currently the only one connected, since ending it (e.g.
    // right before others join, or to stop a stray auto-reconnect) is
    // still a valid owner action either way.
    const isOwner = sarvarcTeamMyRole === 'owner';
    if (remoteByUser.size > 0 || isOwner) {
      bar.style.display = 'flex';
      const MAX_SHOWN = 5;
      const people = Array.from(remoteByUser.values());
      const shown = people.slice(0, MAX_SHOWN);
      const overflow = people.length - shown.length;

      let html = '<span class="sarvarc-presence-live"><span class="sarvarc-presence-dot"></span>Live'
        + '<span class="sarvarc-collab-sync' + (sarvarcCollabHealthy ? '' : ' sarvarc-collab-stalled') + '" id="sarvarcCollabSyncIcon"'
        + ' title="' + (sarvarcCollabHealthy ? 'Syncing with your team' : 'Sync stalled — your last change may not have reached your teammates. Try again or refresh.') + '"></span>'
        + '</span>';
      if (shown.length) {
        html += '<span class="sarvarc-presence-avatars">';
        shown.forEach((state, i) => {
          const color = state.color || '#3b82f6';
          const name = (state.name || 'Teammate');
          const title = (name.replace(/"/g, '&quot;')) + ' \u2014 editing live now';
          // Stagger each avatar's breathing cycle so the box feels alive
          // rather than everyone pulsing in lockstep.
          const delay = (i * 0.35).toFixed(2) + 's';
          const inner = state.avatar
            ? '<img class="sarvarc-presence-avatar-img" src="' + state.avatar.replace(/"/g, '&quot;') +
              '" alt="" referrerpolicy="no-referrer" title="' + title + '" onerror="this.outerHTML=\'<div class=&quot;sarvarc-presence-avatar-fallback&quot; style=&quot;background:' +
              color + '&quot; title=&quot;' + title.replace(/'/g, "&#39;") + '&quot;>' + sarvarcPresenceInitials(name) + '</div>\'">'
            : '<div class="sarvarc-presence-avatar-fallback" style="background:' + color + '" title="' + title + '">' +
              sarvarcPresenceInitials(name) + '</div>';
          html += '<span class="sarvarc-presence-avatar-wrap" style="animation-delay:' + delay + ';z-index:' + (shown.length - i) + '">' + inner + '</span>';
        });
        if (overflow > 0) {
          html += '<span class="sarvarc-presence-overflow" title="' + overflow + ' more live now">+' + overflow + '</span>';
        }
        html += '</span>';
      }
      if (isOwner) {
        html += '<button type="button" class="sarvarc-end-live-btn" onclick="sarvarcTeamEndLiveSession()" title="End this live session for everyone — they\'ll fall back to their own separate workspace">End Live Session</button>';
      }
      bar.innerHTML = html;
    } else {
      bar.style.display = 'none';
      bar.innerHTML = '';
    }

    // ---- Live mouse cursors ----
    // Staleness is judged against OUR OWN clock at the moment we noticed
    // this cursor value change, not the sender's cur.t timestamp directly —
    // cur.t was stamped on the sender's machine, and comparing it to our
    // `now` assumes both clocks agree. Any real-world skew between two
    // computers' clocks (even a few seconds, very common) made every
    // incoming cursor look permanently "stale" and get silently dropped
    // here, while everything else (the "Live" avatar bar above, which
    // doesn't check cursor freshness) kept working — so teammates showed
    // as present but their cursor never appeared.
    const seenCursorIds = new Set();
    remoteByUser.forEach((state, userId) => {
      const cur = state.cursor;
      if (!cur || typeof cur.xPct !== 'number') return; // no cursor yet
      const prevSeen = sarvarcPresenceCursorSeenAt.get(userId);
      if (!prevSeen || prevSeen.senderT !== cur.t) {
        sarvarcPresenceCursorSeenAt.set(userId, { senderT: cur.t, localSeenAt: now });
      }
      const localSeenAt = sarvarcPresenceCursorSeenAt.get(userId).localSeenAt;
      if ((now - localSeenAt) > 8000) return; // no update from them in the last 8s
      const id = 'sarvarc-cursor-' + userId;
      seenCursorIds.add(id);
      let el = document.getElementById(id);
      const color = state.color || '#3b82f6';
      const name = (state.name || 'Teammate').replace(/</g, '&lt;');
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'sarvarc-remote-cursor';
        cursorsLayer.appendChild(el);
        el.dataset.color = '';
      }
      if (el.dataset.color !== color || el.dataset.name !== name) {
        el.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="' +
          color + '"/></svg><span class="sarvarc-cursor-label" style="background:' + color + '">' + name + '</span>';
        el.dataset.color = color;
        el.dataset.name = name;
      }
      el.style.left = (cur.xPct * window.innerWidth) + 'px';
      el.style.top = (cur.yPct * window.innerHeight) + 'px';
    });
    cursorsLayer.querySelectorAll('.sarvarc-remote-cursor').forEach(el => {
      if (!seenCursorIds.has(el.id)) el.remove();
    });

    // ---- Field-level "who's editing this field" ring + badge ----
    document.querySelectorAll('.sarvarc-field-presence-ring').forEach(el => {
      el.classList.remove('sarvarc-field-presence-ring');
      el.style.outlineColor = '';
    });
    document.querySelectorAll('.sarvarc-field-presence-badge').forEach(el => el.remove());
    remoteByUser.forEach((state) => {
      const fieldId = state.field;
      if (!fieldId) return;
      const target = document.getElementById(fieldId);
      if (!target) return;
      const color = state.color || '#3b82f6';
      target.classList.add('sarvarc-field-presence-ring');
      target.style.outlineColor = color;
      const rect = target.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'sarvarc-field-presence-badge';
      badge.style.background = color;
      badge.style.left = rect.left + 'px';
      badge.style.top = (rect.top + window.scrollY) + 'px';
      badge.textContent = (state.name || 'Teammate');
      document.body.appendChild(badge);
    });
  }

  // Wires up local mouse/focus tracking (broadcast out via awareness) and
  // starts rendering everyone else's presence. Called once per live
  // connection from sarvarcCollabConnect.
  function sarvarcPresenceAttachInputListeners(awareness) {
    let lastSent = 0;
    sarvarcPresenceMouseHandler = function (e) {
      const t = Date.now();
      if (t - lastSent < 60) return; // throttle broadcasts to ~16/sec
      lastSent = t;
      awareness.setLocalStateField('cursor', {
        xPct: e.clientX / window.innerWidth,
        yPct: e.clientY / window.innerHeight,
        t: t
      });
    };
    document.addEventListener('mousemove', sarvarcPresenceMouseHandler);

    // Only track focus on elements with a stable id — that id (plus the
    // fact everyone's looking at the same module UI) is enough to say
    // "this teammate is in this exact field" without any per-module code.
    sarvarcPresenceFocusHandler = function (e) {
      const t = e.target;
      if (!t || !t.id) return;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.getAttribute('contenteditable') !== 'true') return;
      awareness.setLocalStateField('field', t.id);
    };
    sarvarcPresenceBlurHandler = function (e) {
      const t = e.target;
      if (!t || !t.id) return;
      const local = awareness.getLocalState();
      if (local && local.field === t.id) awareness.setLocalStateField('field', null);
    };
    document.addEventListener('focusin', sarvarcPresenceFocusHandler);
    document.addEventListener('focusout', sarvarcPresenceBlurHandler);

    // Re-render on every awareness change, ours or a teammate's — this
    // listener runs alongside (not instead of) the broadcast-out listener
    // registered in sarvarcCollabConnect above.
    awareness.on('update', sarvarcPresenceRender);
    // Field badges are positioned from getBoundingClientRect(), which goes
    // stale on scroll/resize even with no new awareness update — a light
    // periodic re-render keeps them lined up, and doubles as cleanup for
    // cursors from a teammate whose tab closed without a clean disconnect.
    sarvarcPresenceStaleTimer = setInterval(sarvarcPresenceRender, 2000);
    sarvarcPresenceRender();
  }

  function sarvarcPresenceDetachInputListeners() {
    if (sarvarcPresenceMouseHandler) document.removeEventListener('mousemove', sarvarcPresenceMouseHandler);
    if (sarvarcPresenceFocusHandler) document.removeEventListener('focusin', sarvarcPresenceFocusHandler);
    if (sarvarcPresenceBlurHandler) document.removeEventListener('focusout', sarvarcPresenceBlurHandler);
    if (sarvarcPresenceStaleTimer) clearInterval(sarvarcPresenceStaleTimer);
    sarvarcPresenceMouseHandler = sarvarcPresenceFocusHandler = sarvarcPresenceBlurHandler = sarvarcPresenceStaleTimer = null;
    sarvarcPresenceCursorSeenAt.clear();
    const bar = document.getElementById('sarvarcPresenceBox');
    if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
    const cursorsLayer = document.getElementById('sarvarcCollabCursorsLayer');
    if (cursorsLayer) cursorsLayer.innerHTML = '';
    document.querySelectorAll('.sarvarc-field-presence-ring').forEach(el => {
      el.classList.remove('sarvarc-field-presence-ring');
      el.style.outlineColor = '';
    });
    document.querySelectorAll('.sarvarc-field-presence-badge').forEach(el => el.remove());
  }

  // On page load: if we reloaded while a live team project was open (see
  // sarvarcTeamProjectOpen below — loading a saved snapshot still goes
  // through the existing reload-based restore path), reconnect to that
  // same live room automatically instead of leaving it live-only-until-
  // the-next-reload.
  (function sarvarcCollabAutoReconnect() {
    const pid = localStorage.getItem('sarvarcLiveCollabTeamProjectId');
    if (!pid) return;
    // Restore which team this project belongs to and restart the team's
    // presence/removal channel here too — not just the editing channel.
    // Without this, 'member-removed' broadcasts (owner kicks someone,
    // sarvarcTeamRemoveMember) never reach anyone actually working in the
    // shared project, since that broadcast only travels over the
    // sarvarc-team-<teamId> channel, which otherwise only gets subscribed
    // to when the Team settings modal happens to be open. Cursors of a
    // removed member — and the removed member's own connection — would
    // otherwise linger indefinitely instead of being cut off instantly.
    const tid = localStorage.getItem('sarvarcLiveCollabTeamId');
    if (tid) {
      sarvarcTeamActiveId = tid;
      sarvarcTeamStartPresence(tid);
    }
    sarvarcCollabWaitForYjs().then(() => sarvarcCollabConnect(pid)).catch(e => console.warn('[Collab] auto-reconnect failed', e));
  })();

  // =========================================================
  // TEAM FEATURE — teams / members / invites / live presence.
  // Only metadata (names, emails, roles, project pointers) lives in
  // Supabase. Actual project content is never stored server-side — it's
  // pushed live, peer-to-peer, to each teammate's own Google Drive (see
  // "Shared projects" further below: sarvarcTeamProjectSave /
  // sarvarcTeamHandleProjectPush / sarvarcTeamRequestProjectSync).
  // State variables (sarvarcTeamMyTeams, sarvarcTeamActiveId, etc.) are
  // now declared at the very top of this script — see the comment there.
  // =========================================================

  async function sarvarcTeamGetUser() {
    const { data: { user } } = await sarvarcSupabase.auth.getUser();
    return user || null;
  }

  function sarvarcTeamShowError(msg) {
    const el = document.getElementById('sarvarcTeamError');
    if (!msg) { el.style.display = 'none'; return; }
    el.textContent = msg; el.style.display = 'block';
  }

  function sarvarcTeamShowNote(msg) {
    const el = document.getElementById('sarvarcTeamNote');
    if (!msg) { el.style.display = 'none'; return; }
    el.textContent = msg; el.style.display = 'block';
  }

  // Toggles the skeleton vs. the real empty/active states. Kept as one
  // helper so every place that finishes (or restarts) a load — including
  // the error path inside sarvarcTeamLoadMyTeams — can reliably clear the
  // skeleton instead of it getting stuck on screen.
  function sarvarcTeamSetLoading(loading) {
    const skel = document.getElementById('sarvarcTeamSkeleton');
    if (!skel) return;
    skel.style.display = loading ? 'block' : 'none';
    if (loading) {
      document.getElementById('sarvarcTeamEmptyState').style.display = 'none';
      document.getElementById('sarvarcTeamActiveState').style.display = 'none';
    }
  }

  async function sarvarcTeamOpenModal() {
    document.getElementById('sarvarcAuthMenu').style.display = 'none';
    const user = await sarvarcTeamGetUser();
    if (!user) { sarvarcAuthOpenModal('login'); return; }
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    // Skeleton goes up in the same tick the overlay starts fading in, so
    // by the time the card has finished animating into place there's
    // already believable content in it — never a blank card that then
    // jumps to real content a moment later.
    sarvarcTeamSetLoading(true);
    document.getElementById('sarvarcTeamOverlay').classList.add('open');
    try {
      await sarvarcTeamLoadMyInvites(user);
      await sarvarcTeamLoadMyTeams(user);
    } finally {
      sarvarcTeamSetLoading(false);
    }
  }

  function sarvarcTeamCloseModal() {
    document.getElementById('sarvarcTeamOverlay').classList.remove('open');
  }

  function sarvarcTeamShowCreateForm() {
    document.getElementById('sarvarcTeamCreateInline').style.display = 'block';
  }

  // ---- Pending invites (matched against the logged-in Google email) ----
  async function sarvarcTeamLoadMyInvites(user) {
    const box = document.getElementById('sarvarcTeamInvitesBox');
    const dot = document.getElementById('sarvarcTeamInviteDot');
    try {
      const { data: invites, error } = await sarvarcSupabase
        .from('team_invites')
        .select('id, team_id, role, status, teams:team_id (name)')
        .eq('email', user.email)
        .eq('status', 'pending');
      if (error) throw error;
      if (!invites || invites.length === 0) {
        box.style.display = 'none'; dot.style.display = 'none'; return;
      }
      dot.style.display = 'block';
      box.style.display = 'block';
      box.innerHTML = invites.map(inv => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0">
          <div style="font-size:12px;color:var(--text)"><b>${(inv.teams && inv.teams.name) || 'A team'}</b> invited you</div>
          <div style="display:flex;gap:6px">
            <button class="btn-secondary" style="padding:5px 10px;font-size:11px" onclick="sarvarcTeamAcceptInvite('${inv.id}','${inv.team_id}','${inv.role}')">Accept</button>
            <button class="btn-secondary" style="padding:5px 10px;font-size:11px" onclick="sarvarcTeamDeclineInvite('${inv.id}')">Decline</button>
          </div>
        </div>`).join('');
    } catch (e) {
      box.style.display = 'none'; dot.style.display = 'none';
    }
  }

  async function sarvarcTeamAcceptInvite(inviteId, teamId, role) {
    try {
      const user = await sarvarcTeamGetUser();
      const { data: profile } = await sarvarcSupabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const { error: joinErr } = await sarvarcSupabase.from('team_members').insert({
        team_id: teamId, user_id: user.id, role: role === 'admin' ? 'admin' : 'member',
        email: user.email, full_name: (profile && profile.full_name) || null
      });
      if (joinErr) throw joinErr;
      await sarvarcSupabase.from('team_invites').update({ status: 'accepted' }).eq('id', inviteId);
      toast('Joined the team', 'success');
      await sarvarcTeamOpenModal();
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not join team.');
    }
  }

  async function sarvarcTeamDeclineInvite(inviteId) {
    try {
      await sarvarcSupabase.from('team_invites').update({ status: 'declined' }).eq('id', inviteId);
      await sarvarcTeamOpenModal();
    } catch (e) { /* ignore */ }
  }

  // ---- Load teams the user belongs to ----
  async function sarvarcTeamLoadMyTeams(user) {
    try {
      const { data: rows, error } = await sarvarcSupabase
        .from('team_members')
        .select('role, teams:team_id (id, name)')
        .eq('user_id', user.id);
      if (error) throw error;
      sarvarcTeamMyTeams = (rows || []).filter(r => r.teams).map(r => ({ id: r.teams.id, name: r.teams.name, role: r.role }));

      const empty = document.getElementById('sarvarcTeamEmptyState');
      const active = document.getElementById('sarvarcTeamActiveState');
      if (sarvarcTeamMyTeams.length === 0) {
        empty.style.display = 'block'; active.style.display = 'none';
        return;
      }
      empty.style.display = 'none'; active.style.display = 'block';
      document.getElementById('sarvarcTeamCreateInline').style.display = 'none';

      const sw = document.getElementById('sarvarcTeamSwitcher');
      sw.innerHTML = sarvarcTeamMyTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      if (!sarvarcTeamActiveId || !sarvarcTeamMyTeams.find(t => t.id === sarvarcTeamActiveId)) {
        sarvarcTeamActiveId = sarvarcTeamMyTeams[0].id;
      }
      sw.value = sarvarcTeamActiveId;
      await sarvarcTeamSwitch(sarvarcTeamActiveId);
    } catch (e) {
      // Fall back to the empty state instead of leaving the modal blank —
      // this container was previously never shown on the error path, which
      // meant the error message (written into a div nested inside the
      // *active* state) was invisible and the user was stuck looking at
      // nothing at all.
      document.getElementById('sarvarcTeamActiveState').style.display = 'none';
      document.getElementById('sarvarcTeamEmptyState').style.display = 'block';
      sarvarcTeamShowError(e.message || 'Could not load your teams. Try closing and reopening this window.');
    }
  }

  async function sarvarcTeamCreate(inputId) {
    const nameEl = document.getElementById(inputId || 'sarvarcTeamNewName');
    const name = (nameEl.value || '').trim();
    if (!name) { sarvarcTeamShowError('Give your team a name.'); return; }
    try {
      const user = await sarvarcTeamGetUser();
      const { data: team, error } = await sarvarcSupabase.from('teams').insert({ name, owner_id: user.id }).select().single();
      if (error) throw error;
      const { data: profile } = await sarvarcSupabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      await sarvarcSupabase.from('team_members').insert({
        team_id: team.id, user_id: user.id, role: 'owner', email: user.email, full_name: (profile && profile.full_name) || null
      });
      sarvarcTeamActiveId = team.id;
      nameEl.value = '';
      toast('Team created', 'success');
      await sarvarcTeamLoadMyTeams(user);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not create team.');
    }
  }

  async function sarvarcTeamSwitch(teamId) {
    sarvarcTeamActiveId = teamId;
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    await sarvarcTeamLoadMembers(teamId);
    await sarvarcTeamProjectsLoad(teamId);
    sarvarcTeamStartPresence(teamId);
  }

  async function sarvarcTeamLoadMembers(teamId) {
    const listEl = document.getElementById('sarvarcTeamMembersList');
    listEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">Loading…</div>';
    try {
      const user = await sarvarcTeamGetUser();
      const { data: members, error } = await sarvarcSupabase
        .from('team_members').select('id, user_id, role, email, full_name')
        .eq('team_id', teamId);
      if (error) throw error;

      // Pull avatars (Google DP) from profiles in one batch query, keyed by
      // user_id — team_members itself doesn't store avatars, profiles does
      // (see sarvarcAuthUpdateNavUI, which captures it from Google on login).
      let avatarsById = {};
      try {
        const ids = members.map(m => m.user_id);
        if (ids.length) {
          const { data: profRows } = await sarvarcSupabase.from('profiles').select('id, avatar_url').in('id', ids);
          (profRows || []).forEach(p => { if (p.avatar_url) avatarsById[p.id] = p.avatar_url; });
        }
      } catch (e) { /* avatars are a nice-to-have — initials fallback covers this */ }

      members.forEach(m => { sarvarcTeamMembersCache[m.user_id] = { full_name: m.full_name, email: m.email, avatar_url: avatarsById[m.user_id] || null }; });
      const myRole = (members.find(m => m.user_id === user.id) || {}).role || 'member';
      const canManage = myRole === 'owner' || myRole === 'admin';
      document.getElementById('sarvarcTeamInviteRow').style.display = canManage ? 'flex' : 'none';
      // Cached at module scope (not just this modal) so the top-bar "End Live
      // Session" control — which can render while the Team modal is closed —
      // knows whether the current person is allowed to use it.
      sarvarcTeamMyRole = myRole;

      const countPill = document.getElementById('sarvarcTeamCountPill');
      if (countPill) { countPill.style.display = 'inline-block'; countPill.textContent = members.length + (members.length === 1 ? ' member' : ' members'); }

      const leaveBtn = document.getElementById('sarvarcTeamLeaveBtn');
      if (leaveBtn) {
        const soleOwner = myRole === 'owner' && members.length > 1;
        leaveBtn.style.opacity = soleOwner ? '0.5' : '1';
        leaveBtn.title = soleOwner ? 'Transfer ownership or remove other members before leaving' : 'Leave this team';
      }

      listEl.innerHTML = members.map(m => {
        const label = m.full_name || m.email || 'Member';
        const online = sarvarcTeamOnlineIds.has(m.user_id);
        const isYou = m.user_id === user.id;
        const avatarUrl = avatarsById[m.user_id];
        const color = (typeof sarvarcCollabColorFor === 'function') ? sarvarcCollabColorFor(m.user_id) : '#3b82f6';
        const avatarHtml = avatarUrl
          ? `<img class="sarvarc-team-avatar" src="${avatarUrl.replace(/"/g,'&quot;')}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sarvarc-team-avatar-fallback',style:'background:${color}',textContent:'${sarvarcPresenceInitials(label).replace(/'/g, "\\'")}'}));">`
          : `<div class="sarvarc-team-avatar-fallback" style="background:${color}">${sarvarcPresenceInitials(label)}</div>`;
        const roleClass = m.role === 'owner' ? 'sarvarc-team-role-owner' : (m.role === 'admin' ? 'sarvarc-team-role-admin' : 'sarvarc-team-role-member');
        const removeBtn = (canManage && !isYou)
          ? `<button class="sarvarc-team-action-btn danger" onclick="sarvarcTeamRemoveMember('${m.id}','${m.user_id}')">Remove</button>` : '';
        const leaveInline = isYou ? `<button class="sarvarc-team-action-btn leave" onclick="sarvarcTeamLeave()">Leave</button>` : '';
        return `<div class="sarvarc-team-member-card${isYou ? ' is-you' : ''}" data-member-user="${m.user_id}">
          <div class="sarvarc-team-avatar-wrap">
            ${avatarHtml}
            <span class="sarvarc-team-online-dot${online ? '' : ' offline'}" title="${online ? 'Online now' : 'Offline'}"></span>
          </div>
          <div class="sarvarc-team-member-info">
            <div class="sarvarc-team-member-name">${label}${isYou ? '<span class="sarvarc-team-member-you-tag">YOU</span>' : ''}</div>
            <div class="sarvarc-team-member-email">${m.email || ''}</div>
          </div>
          <span class="sarvarc-team-role-badge ${roleClass}">${m.role}</span>
          <div class="sarvarc-team-member-actions">${removeBtn}${leaveInline}</div>
        </div>`;
      }).join('');
    } catch (e) {
      listEl.innerHTML = '';
      sarvarcTeamShowError(e.message || 'Could not load members.');
    }
  }

  // ---- Leave a team you belong to. Owners must transfer ownership or
  // remove everyone else first — there's no ownership-transfer flow yet, so
  // rather than silently orphaning the team (or deleting it out from under
  // people who still have shared projects open), a sole/last owner with
  // other members present is blocked with a clear explanation. A lone owner
  // with no other members can always leave — that just deletes the team. ----
  async function sarvarcTeamLeave() {
    if (!sarvarcTeamActiveId) return;
    try {
      const user = await sarvarcTeamGetUser();
      if (!user) return;
      const { data: members, error } = await sarvarcSupabase
        .from('team_members').select('id, user_id, role').eq('team_id', sarvarcTeamActiveId);
      if (error) throw error;
      const me = members.find(m => m.user_id === user.id);
      if (!me) return;
      if (me.role === 'owner' && members.length > 1) {
        sarvarcTeamShowError('You\'re the owner — remove every other member first, or ask an admin to take over, before you can leave.');
        return;
      }
      const teamName = (sarvarcTeamMyTeams.find(t => t.id === sarvarcTeamActiveId) || {}).name || 'this team';
      if (!confirm(`Leave ${teamName}? You'll lose access to its shared projects unless you're invited back.`)) return;

      const { error: delErr } = await sarvarcSupabase.from('team_members').delete().eq('id', me.id);
      if (delErr) throw delErr;
      // Sole owner leaving a team with nobody else in it — nothing left to
      // orphan, so clean up the now-empty team row too.
      if (me.role === 'owner' && members.length === 1) {
        try { await sarvarcSupabase.from('teams').delete().eq('id', sarvarcTeamActiveId); } catch (e) {}
      }
      toast(`Left ${teamName}`, 'success');
      sarvarcTeamActiveId = null;
      await sarvarcTeamLoadMyTeams(user);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not leave team.');
    }
  }

  async function sarvarcTeamInvite() {
    const emailEl = document.getElementById('sarvarcTeamInviteEmail');
    const email = (emailEl.value || '').trim().toLowerCase();
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    if (!email || !email.includes('@')) { sarvarcTeamShowError('Enter a valid email.'); return; }
    try {
      const user = await sarvarcTeamGetUser();
      const { error } = await sarvarcSupabase.from('team_invites').insert({
        team_id: sarvarcTeamActiveId, email, invited_by: user.id
      });
      if (error) throw error;
      emailEl.value = '';
      // No email-sending service wired up yet: the invite shows up
      // automatically next time that person logs into SARVARC with
      // this Google account and opens Team.
      sarvarcTeamShowNote(`Invite added for ${email} — they'll see it next time they log in.`);
    } catch (e) {
      if ((e.message || '').includes('duplicate')) sarvarcTeamShowError('Already invited.');
      else sarvarcTeamShowError(e.message || 'Could not send invite.');
    }
  }

  async function sarvarcTeamRemoveMember(memberRowId, removedUserId) {
    if (!confirm('Remove this person from the team?')) return;
    const teamId = sarvarcTeamActiveId;
    try {
      const { error } = await sarvarcSupabase.from('team_members').delete().eq('id', memberRowId);
      if (error) throw error;
      // Tell everyone currently connected — including the removed person's
      // own tab(s) — right now, over the same realtime channel already
      // used for "who's online". Without this, the removed user's browser
      // has no idea it was kicked: it keeps polling nothing, keeps
      // broadcasting mouse-move/awareness updates into the live session,
      // and their cursor just sits there on every teammate's screen until
      // the Yjs awareness protocol's own ~30s stale-client timeout finally
      // prunes it. Broadcasting makes the cutoff instant on both ends.
      if (sarvarcTeamPresenceChannel && removedUserId) {
        try {
          await sarvarcTeamPresenceChannel.send({
            type: 'broadcast', event: 'member-removed',
            payload: { teamId, userId: removedUserId }
          });
        } catch (e) { console.warn('[Team] could not broadcast removal', e); }
      }
      await sarvarcTeamLoadMembers(teamId);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not remove member.');
    }
  }

  // Reacts to a 'member-removed' broadcast on the team channel. Fires on
  // EVERY currently-connected client for that team, including the removed
  // person's own tab — that's the point: no polling, no waiting.
  async function sarvarcTeamHandleMemberRemoved(teamId, removedUserId) {
    const user = await sarvarcTeamGetUser();
    if (!user) return;

    if (user.id === removedUserId) {
      // This is the removed person's own client. Cut them off from the
      // live session immediately — stop broadcasting our cursor, leave
      // the Yjs doc/awareness channel — rather than leaving it connected
      // until an idle timeout eventually notices.
      if (typeof sarvarcCollabIsLive === 'function' && sarvarcCollabIsLive()) {
        sarvarcCollabDisconnect();
      }
      if (sarvarcTeamPresenceChannel) {
        try { sarvarcSupabase.removeChannel(sarvarcTeamPresenceChannel); } catch (e) {}
        sarvarcTeamPresenceChannel = null;
      }
      sarvarcTeamActiveId = null;
      toast("You've been removed from this team", 'error');
      sarvarcTeamCloseModal();
      await sarvarcTeamLoadMyTeams(user);
      return;
    }

    // Someone else was removed: don't wait for the awareness protocol's
    // own timeout to quietly age their cursor out — find their live
    // client (matched by the userId we already stamp into every
    // awareness state, see sarvarcCollabConnect) and remove it from the
    // shared doc's awareness right now, so their cursor disappears from
    // every remaining teammate's screen this instant instead of drifting
    // there for up to ~30 more seconds.
    if (teamId === sarvarcTeamActiveId && sarvarcCollabAwareness && window.YAwareness) {
      const staleClientIds = [];
      sarvarcCollabAwareness.getStates().forEach((state, clientId) => {
        if (state && state.userId === removedUserId) staleClientIds.push(clientId);
      });
      if (staleClientIds.length) {
        window.YAwareness.removeAwarenessStates(sarvarcCollabAwareness, staleClientIds, 'removed-by-owner');
      }
    }
    if (teamId === sarvarcTeamActiveId) await sarvarcTeamLoadMembers(teamId);
  }

  // ---- End Live Session (owner-only): shuts down the current live team
  // project for EVERYONE connected to it right now, including the owner's
  // own tab. This does NOT delete the team project or anyone's work — it
  // just stops the real-time sync. Each participant's browser keeps
  // whatever content it last had; from this point on that content is a
  // private, local, no-longer-synced copy again — i.e. their own
  // workspace. Note this does not save anything to the team's stored copy
  // first — if there are unsaved live edits, "Save to Team" before ending
  // is the way to keep them. ----
  async function sarvarcTeamEndLiveSession() {
    const teamProjectId = localStorage.getItem('sarvarcLiveCollabTeamProjectId');
    if (!teamProjectId) { toast('No live session is currently open.', 'info'); return; }
    if (sarvarcTeamMyRole !== 'owner') { sarvarcTeamShowError('Only the team owner can end a live session.'); return; }
    if (!confirm('End this live session for everyone?\n\nEveryone currently connected will be dropped back to their own separate workspace. Nothing is deleted, but any edits not yet saved to the team won\'t be kept in the shared copy.')) return;

    const teamId = sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId');
    try {
      if (sarvarcTeamPresenceChannel) {
        try {
          await sarvarcTeamPresenceChannel.send({
            type: 'broadcast', event: 'session-ended',
            payload: { teamId, teamProjectId }
          });
        } catch (e) { console.warn('[Team] could not broadcast session end', e); }
      }
    } finally {
      // Broadcasts don't echo back to the sender (self:false), so the owner
      // has to be dropped out of the live room locally too.
      await sarvarcTeamHandleSessionEnded(teamId, teamProjectId);
    }
  }

  // Reacts to a 'session-ended' broadcast — fires on EVERY client currently
  // live on that team project, including the owner's own tab (called
  // directly there, see above, since broadcasts don't self-echo).
  async function sarvarcTeamHandleSessionEnded(teamId, endedTeamProjectId) {
    const activeProjectId = localStorage.getItem('sarvarcLiveCollabTeamProjectId');
    if (!activeProjectId || activeProjectId !== endedTeamProjectId) return; // not in this session, ignore

    if (typeof sarvarcCollabIsLive === 'function' && sarvarcCollabIsLive()) {
      sarvarcCollabDisconnect(); // stops Yjs sync + awareness, clears the sarvarcLiveCollab* localStorage flags
    } else {
      // Disconnect wasn't live (e.g. reconnect hadn't finished yet) — still
      // clear the flags so a stray reload doesn't try to rejoin a room
      // that's now gone.
      localStorage.removeItem('sarvarcLiveCollabTeamProjectId');
      localStorage.removeItem('sarvarcLiveCollabTeamId');
      localStorage.removeItem('sarvarcLiveCollabSessionId');
    }
    toast('The live session was ended — you\'re back on your own workspace.', 'info');
  }

  // ---- Live presence: who from the team is online right now ----
  // Uses Supabase Realtime Presence — an ephemeral in-memory channel.
  // Nothing here is written to a database table.
  function sarvarcTeamStartPresence(teamId) {
    if (sarvarcTeamPresenceChannel) {
      try { sarvarcSupabase.removeChannel(sarvarcTeamPresenceChannel); } catch (e) {}
      sarvarcTeamPresenceChannel = null;
    }
    sarvarcTeamOnlineIds = new Set();
    sarvarcTeamGetUser().then(user => {
      if (!user) return;
      const channel = sarvarcSupabase.channel('sarvarc-team-' + teamId, { config: { presence: { key: user.id } } });
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        sarvarcTeamOnlineIds = new Set(Object.keys(state));
        sarvarcTeamLoadMembers(teamId);
      });
      channel.on('broadcast', { event: 'member-removed' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleMemberRemoved(payload.teamId, payload.userId);
      });
      channel.on('broadcast', { event: 'session-ended' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleSessionEnded(payload.teamId, payload.teamProjectId);
      });
      // Team Projects: peer-to-peer push/pull (see sarvarcTeamProjectSave /
      // sarvarcTeamHandleProjectPush / sarvarcTeamRequestProjectSync below).
      // Nothing here is stored by Supabase — it's just relaying between
      // browsers that happen to be online on this channel at the same time.
      channel.on('broadcast', { event: 'team-project-push' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleProjectPush(payload.teamId, payload.rec);
      });
      channel.on('broadcast', { event: 'team-project-request' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleProjectRequest(payload.teamId, payload.teamProjectId);
      });
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ email: user.email, online_at: new Date().toISOString() });
        }
      });
      sarvarcTeamPresenceChannel = channel;
    });
  }

  // ---- Shared projects: push current work to the team, open a teammate's
  // shared work. Uses the SAME session snapshot format (rec.snapshot =
  // {ls, idb}) that "Saved Sessions" already uses locally and on personal
  // Drive.
  //
  // IMPORTANT: no SARVARC server ever holds the actual file content. Two
  // things travel separately:
  //   1. A tiny POINTER row in the `team_projects` table (id, team_id,
  //      name, who last saved it, when) — just enough for teammates to see
  //      the project exists and pick it from a list. No file content.
  //   2. The real project content, which is only ever:
  //        - written into the pusher's OWN Google Drive (their login), and
  //        - live-relayed peer-to-peer over the team's Supabase Realtime
  //          broadcast channel to whoever else is online RIGHT NOW — each
  //          of THEIR browsers then writes it into THEIR OWN Drive too.
  //      Realtime broadcast is a live pass-through, not storage — Supabase
  //      never keeps a copy of what passed through it.
  //   Anyone offline at push time simply doesn't get it in that moment —
  //   sarvarcTeamRequestProjectSync() below asks the team again the next
  //   time they open SARVARC; if literally nobody with a copy is online,
  //   the existing "Share as .sw file" export/import (Saved Sessions page)
  //   is the manual fallback.
  //   Practical limit: Realtime broadcast messages have a size ceiling
  //   (well under what a very large project with lots of embedded images
  //   could reach) — a push that's too big to relay live still saves fine
  //   to the pusher's own Drive, it just won't reach teammates until they
  //   pull it directly (open it once themselves) or a smaller/trimmed
  //   version is pushed. ----
  let sarvarcTeamMembersCache = {};        // user_id -> {full_name, email}, used to label "last saved by"
  let sarvarcTeamPendingSyncRequests = {}; // teamProjectId -> requestedAt, cleared once a copy arrives

  async function sarvarcTeamProjectsLoad(teamId) {
    const listEl = document.getElementById('sarvarcTeamProjectsList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">Loading…</div>';
    try {
      const { data: rows, error } = await sarvarcSupabase
        .from('team_projects')
        .select('id, name, updated_at, updated_by')
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) {
        listEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">No shared projects yet.</div>';
        return;
      }
      // Which of these already have a local (and thus Drive-mirrored) copy
      // on THIS device vs. still need a live pull from an online teammate.
      let localIds = new Set();
      try { localIds = new Set((await smListSessions()).map(s => s.id)); } catch (e) {}

      listEl.innerHTML = rows.map(p => {
        const m = sarvarcTeamMembersCache[p.updated_by];
        const who = (m && (m.full_name || m.email)) || 'a teammate';
        const when = p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '';
        const haveIt = localIds.has(p.id);
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:7px;background:var(--surface2)">
          <div style="min-width:0">
            <div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}${haveIt ? '' : ' <span style="color:var(--text3);font-weight:400">(not synced to this device yet)</span>'}</div>
            <div style="font-size:10px;color:var(--text3)">Last saved by ${who}${when ? ' · ' + when : ''}</div>
          </div>
          <button class="btn-secondary" style="padding:5px 10px;font-size:11px;flex:none" onclick="sarvarcTeamProjectOpen('${p.id}')">${haveIt ? 'Open' : 'Sync &amp; Open'}</button>
        </div>`;
      }).join('');
    } catch (e) {
      listEl.innerHTML = '';
      sarvarcTeamShowError(e.message || 'Could not load team projects.');
    }
  }

  async function sarvarcTeamProjectSave() {
    if (!sarvarcTeamActiveId) return;
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    const name = prompt('Name this project for your team:', (typeof smDefaultName === 'function' ? smDefaultName() : 'Project'));
    if (!name) return;
    try {
      const user = await sarvarcTeamGetUser();
      if (!user) { sarvarcAuthOpenModal('login'); return; }
      if (typeof smSaveSession !== 'function') throw new Error('Save engine not available on this page.');

      // Re-uses the exact same capture + local-save + personal-Drive-mirror
      // path "Save Your Workflow" uses. This pusher's own copy always lands
      // in THEIR OWN Google Drive — never on a SARVARC server.
      // A real UUID is forced here (rather than the usual 'sess_...' local
      // id) because this same id also becomes team_projects.id below, and
      // that column is a Postgres `uuid` — passing 'sess_...' there is what
      // produced "invalid input syntax for type uuid: sess_...".
      const rec = await smSaveSession(name, sarvarcGenUuid());
      const teamName = (sarvarcTeamMyTeams.find(t => t.id === sarvarcTeamActiveId) || {}).name || 'Team';
      rec.teamId = sarvarcTeamActiveId;
      rec.teamName = teamName;
      rec.pushedByName = (sarvarcTeamMembersCache[user.id] && sarvarcTeamMembersCache[user.id].full_name) || user.email;
      rec.pushedAt = Date.now();
      // Legitimately shared with the whole team now — not locked to
      // whichever member happened to click Save.
      rec.ownerEmail = null;

      const db = await idbKvOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      // Re-mirror to Drive now that the team tags above are set (the
      // smSaveSession() mirror ran before those existed).
      try {
        if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
          rec.driveFileId = await sarvarcDriveSaveSession(rec);
          await new Promise((resolve) => {
            const tx2 = db.transaction('sessions', 'readwrite');
            tx2.objectStore('sessions').put(rec);
            tx2.oncomplete = resolve;
            tx2.onerror = () => resolve();
          });
        }
      } catch (e) { console.warn('[Team] Drive mirror (tagged) skipped', e); }

      // Pointer only — id/name/who/when — never file content.
      // `module` is a NOT NULL column on team_projects (used to pick the
      // tile icon/label in the team list — see SM_MODULE_TILE_COLOR/LABEL).
      // Tag it with whichever module actually has content in this snapshot
      // (the same detection smComposeThumbnail uses), falling back to
      // 'workspace' for an empty/blank save so the insert never 23502s.
      const primaryModule = smPresentModules(rec.snapshot)[0] || 'workspace';
      const { error: rowErr } = await sarvarcSupabase.from('team_projects').upsert({
        id: rec.id, team_id: sarvarcTeamActiveId, name, module: primaryModule,
        owner_id: user.id, updated_by: user.id, updated_at: new Date().toISOString()
      });
      if (rowErr) throw rowErr;

      // Live-push the full project straight to whoever's online right now.
      // Each of their browsers saves it locally AND mirrors it into THEIR
      // OWN Drive under their own login — this call is the "single click,
      // synced live to every online teammate" step.
      if (sarvarcTeamPresenceChannel) {
        try {
          await sarvarcTeamPresenceChannel.send({
            type: 'broadcast', event: 'team-project-push',
            payload: { teamId: sarvarcTeamActiveId, rec }
          });
        } catch (e) { console.warn('[Team] could not live-push project', e); }
      }

      sarvarcTeamShowNote('Saved to team.');
      toast('Saved to team \u2014 synced live to whoever\u2019s online', 'success');
      if (document.getElementById('smSessionList')) smRenderList();
      await sarvarcTeamProjectsLoad(sarvarcTeamActiveId);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not save to team.');
    }
  }

  async function sarvarcTeamProjectOpen(projectId) {
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    try {
      let rec = (typeof smGetSession === 'function') ? await smGetSession(projectId) : null;
      if (!rec) {
        // Not synced to this device yet — ask the team live and wait a
        // few seconds for whoever's online with it to hand it back (see
        // sarvarcTeamRequestProjectSync / sarvarcTeamHandleProjectPush).
        await sarvarcTeamRequestProjectSync(projectId);
        rec = await sarvarcTeamWaitForSession(projectId, 6000);
      }
      if (!rec) {
        sarvarcTeamShowError('No teammate is online right now to send this project. Ask one to open SARVARC, or have them share it to you as a .sw file instead (Saved Sessions → share icon).');
        return;
      }
      // Mark this as a LIVE team project before the reload below wipes all
      // in-memory JS state. sarvarcCollabAutoReconnect (top of the LIVE
      // CO-EDITING CORE block) picks these back up right after reload and
      // rejoins the same live room, so co-editing survives the restore.
      localStorage.setItem('sarvarcLiveCollabTeamProjectId', projectId);
      localStorage.setItem('sarvarcLiveCollabTeamId', sarvarcTeamActiveId);
      localStorage.setItem('sarvarcLiveCollabSessionId', rec.id);
      sarvarcTeamCloseModal();
      await smLoadSession(rec.id);
      toast('Opened "' + rec.name + '" from the team — live with teammates', 'success');
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not open that project.');
    }
  }

  // Reacts to a 'team-project-push' broadcast — fires on every OTHER client
  // connected to this team's channel right now (broadcasts never echo back
  // to the sender). Saves the pushed project straight into this browser's
  // own local sessions AND mirrors it into THIS person's own Google Drive —
  // never into any SARVARC server. This is what makes "Save to Team" reach
  // everyone who happens to be online the instant it's clicked.
  async function sarvarcTeamHandleProjectPush(teamId, rec) {
    if (!rec || !rec.id) return;
    try {
      const db = await idbKvOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      try {
        if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
          rec.driveFileId = await sarvarcDriveSaveSession(rec);
          await new Promise((resolve) => {
            const tx2 = db.transaction('sessions', 'readwrite');
            tx2.objectStore('sessions').put(rec);
            tx2.oncomplete = resolve;
            tx2.onerror = () => resolve();
          });
        }
      } catch (e) { console.warn('[Team] Drive mirror of pushed project skipped', e); }

      delete sarvarcTeamPendingSyncRequests[rec.id];
      if (typeof toast === 'function') toast('Synced "' + rec.name + '" from ' + (rec.pushedByName || 'your team') + ' to your Drive.', 'success');
      if (document.getElementById('smSessionList')) smRenderList();
      if (teamId === sarvarcTeamActiveId) await sarvarcTeamProjectsLoad(teamId);
    } catch (e) { console.warn('[Team] could not save pushed project locally', e); }
  }

  // Reacts to a 'team-project-request' broadcast: someone on this team just
  // asked for a project they don't have locally yet. If WE happen to have
  // it, hand it straight back over the same channel so their browser can
  // pick it up — purely peer-to-peer, nothing passes through storage.
  async function sarvarcTeamHandleProjectRequest(teamId, teamProjectId) {
    try {
      const rec = (typeof smGetSession === 'function') ? await smGetSession(teamProjectId) : null;
      if (!rec || !sarvarcTeamPresenceChannel) return;
      await sarvarcTeamPresenceChannel.send({
        type: 'broadcast', event: 'team-project-push',
        payload: { teamId, rec }
      });
    } catch (e) { /* we just don't have it, or the send failed — fine, another online teammate might have it */ }
  }

  // Broadcasts a request for a project this device doesn't have yet, and
  // waits briefly for any online teammate who does have it to hand it back
  // (sarvarcTeamHandleProjectRequest above). If nobody responds in time,
  // the honest options are: try again once someone with it is online, or
  // fall back to the existing manual .sw export/import.
  async function sarvarcTeamRequestProjectSync(teamProjectId, name) {
    if (!sarvarcTeamPresenceChannel) { if (typeof toast === 'function') toast('Connect to the team first.', 'error'); return; }
    sarvarcTeamPendingSyncRequests[teamProjectId] = Date.now();
    if (typeof toast === 'function') toast('Asking your team for "' + (name || 'this project') + '"\u2026', 'info');
    try {
      await sarvarcTeamPresenceChannel.send({
        type: 'broadcast', event: 'team-project-request',
        payload: { teamId: sarvarcTeamActiveId, teamProjectId }
      });
    } catch (e) { console.warn('[Team] could not request project sync', e); }
    setTimeout(async () => {
      if (!sarvarcTeamPendingSyncRequests[teamProjectId]) return; // arrived already
      delete sarvarcTeamPendingSyncRequests[teamProjectId];
      const got = (typeof smGetSession === 'function') ? await smGetSession(teamProjectId) : null;
      if (!got && typeof toast === 'function') {
        toast('No teammate is online right now to sync this from. Ask one to open SARVARC, or have them send you a .sw file instead (Saved Sessions \u2192 share icon).', 'error');
      }
    }, 6000);
  }

  // Polls local storage briefly for a project just requested from the team
  // — lets sarvarcTeamProjectOpen() wait a moment for the live hand-off to
  // land before giving up.
  async function sarvarcTeamWaitForSession(id, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rec = (typeof smGetSession === 'function') ? await smGetSession(id) : null;
      if (rec) return rec;
      await new Promise(r => setTimeout(r, 400));
    }
    return null;
  }

  // ---- Continue with Google: opens Google's consent screen in a popup
  // window instead of navigating the main page away. A full-page redirect
  // would tear down all in-memory app state (loaded PDF pages, canvas
  // edits, the pending export closure itself) before the export could ever
  // run — a popup keeps this tab alive the whole time, so once it reports
  // back a session, the same pending export can auto-resume exactly like
  // the email/password path does. Falls back to the old full-page redirect
  // only if the browser blocks the popup (auto-resume won't survive that
  // path, but login itself still works). ----
  let sarvarcAuthGoogleBusy = false;
  function sarvarcAuthSetGoogleBusy(busy) {
    sarvarcAuthGoogleBusy = busy;
    const btn = document.getElementById('sarvarcAuthGoogleBtn');
    const icon = document.getElementById('sarvarcAuthGoogleIcon');
    const label = document.getElementById('sarvarcAuthGoogleLabel');
    if (!btn || !label) return;
    btn.disabled = busy;
    icon.style.display = busy ? 'none' : '';
    if (busy) {
      label.innerHTML = '<span class="sarvarc-btn-spinner-dark"></span>Connecting…';
    } else {
      label.textContent = 'Continue with Google';
    }
  }

  async function sarvarcAuthGoogleLogin() {
    if (sarvarcAuthGoogleBusy) return;
    sarvarcAuthShowError('');
    sarvarcAuthSetGoogleBusy(true);
    const { data, error } = await sarvarcSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        skipBrowserRedirect: true,
        // drive.file: lets this app read/write ONLY the files it creates itself
        // inside the user's Drive — never their whole Drive. This is what
        // powers "saved files follow your login" without SARVARC ever storing
        // file content on its own servers. access_type+prompt=consent so
        // Google actually returns a token with this scope attached (silent
        // re-logins otherwise skip the consent screen and omit it).
        scopes: 'https://www.googleapis.com/auth/drive.file',
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
    if (error || !data || !data.url) {
      sarvarcAuthShowError(sarvarcAuthFriendlyError(error) || 'Could not start Google sign-in. Try again.');
      sarvarcAuthSetGoogleBusy(false);
      return;
    }
    // Always a full-page redirect now (no popup). The old popup flow had to
    // watch the popup from this window, and Google's sign-in pages block
    // that (Cross-Origin-Opener-Policy), so the watcher could give up while
    // the person was still signing in, leaving this window stuck on the
    // login screen while the popup logged in by itself. The popup's only
    // benefit was keeping in-memory state alive, but a successful login
    // reloads this page anyway (sarvarcQueueWorkspaceEntryAndReload), so
    // that benefit never existed. On return, the account-namespace listener
    // sees the new uid, reloads, and enters the Workspace.
    window.location.href = data.url;
  }

  // If the person comes back with the browser Back button from Google's
  // page, the browser can restore this page frozen on "Connecting...".
  // Hand the button back so they can try again.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && typeof sarvarcAuthSetGoogleBusy === 'function') sarvarcAuthSetGoogleBusy(false);
  });

  // Polls the popup rather than relying solely on a 'storage' event, since
  // that keeps this working even if a browser ever changes cross-tab
  // storage-sync behavior. On every tick we actively check for a session —
  // that's what actually confirms sign-in succeeded, not a guessed timer.
  // Two things happen on each tick:
  //  1. A session check. If one now exists, we're done: close the popup,
  //     stop polling, and finish up exactly like every other login path.
  //  2. Only as a backstop, once the popup has been back on our own origin
  //     for a while with still no session, force-close it — long enough
  //     that the code/token exchange (a real network round trip to Supabase
  //     and Google) has had a fair chance to finish first. Closing the
  //     popup ABORTS that exchange if it's still in flight, so this needs
  //     real headroom, not a tight guess — too short and the very first
  //     login silently fails and has to be retried.
  let sarvarcGooglePopupPoll = null;
  function sarvarcAuthWatchGooglePopup(popup) {
    if (sarvarcGooglePopupPoll) clearInterval(sarvarcGooglePopupPoll);
    let sameOriginSince = null;
    let finished = false;

    const finish = async () => {
      if (finished) return;
      finished = true;
      clearInterval(sarvarcGooglePopupPoll);
      sarvarcGooglePopupPoll = null;
      try { if (!popup.closed) popup.close(); } catch (e) {}
      sarvarcAuthSetGoogleBusy(false);
      // Hand off to the one canonical post-login path (see
      // sarvarcQueueWorkspaceEntryAndReload near the Supabase client
      // setup) instead of calling sarvarcAuthEnterWorkspace() directly —
      // that used to race the account-namespace listener's own reload.
      sarvarcQueueWorkspaceEntryAndReload();
    };

    sarvarcGooglePopupPoll = setInterval(async () => {
      if (finished) return;

      // Check for a session on every tick, popup open or not — whichever
      // happens first (a session showing up, or the popup closing) decides
      // the outcome, rather than a fixed sleep-then-check-once.
      try {
        const { data: { session } } = await sarvarcSupabase.auth.getSession();
        if (session) { await finish(); return; }
      } catch (e) {}

      // A same-origin COOP header on this page (set at the hosting/CDN
      // level, not here) severs the opener/popup relationship the instant
      // the popup navigates to Google's cross-origin login page — Chrome
      // then blocks even harmless reads like .closed and logs "Cross-
      // Origin-Opener-Policy policy would block the window.closed call".
      // Treat a blocked/unknown read as "can't tell yet" rather than
      // letting it throw and skip the rest of this tick — the getSession()
      // check above is what actually detects success either way; this is
      // only the "user closed it without signing in" fallback path.
      let sarvarcPopupClosed = false;
      try { sarvarcPopupClosed = popup.closed; } catch (e) { sarvarcPopupClosed = false; }
      if (sarvarcPopupClosed) {
        clearInterval(sarvarcGooglePopupPoll);
        sarvarcGooglePopupPoll = null;
        // Popup is gone (user closed it, or cancelled) and we still haven't
        // seen a session. Give the exchange a few more short retries in
        // case it closed itself right as it was finishing, before treating
        // this as "no sign-in happened" and simply doing nothing further.
        for (let i = 0; i < 4 && !finished; i++) {
          await new Promise(r => setTimeout(r, 350));
          const { data: { session } } = await sarvarcSupabase.auth.getSession();
          if (session) {
            finished = true; sarvarcAuthSetGoogleBusy(false);
            sarvarcQueueWorkspaceEntryAndReload();
            break;
          }
        }
        // Genuinely cancelled (no session ever showed up) — hand the button
        // back so the person can try again without reopening the modal.
        if (!finished) sarvarcAuthSetGoogleBusy(false);
        return;
      }

      try {
        if (popup.location.origin === window.location.origin) {
          if (sameOriginSince === null) sameOriginSince = Date.now();
          // Backstop only — the session check above normally fires first,
          // well before this. Give the exchange real time before treating
          // a stuck popup as reason to close it. Widened from 4s to 10s:
          // 4s was cutting off the Google->Supabase code/token exchange
          // while it was still in flight (slower connections, an extra
          // Google account-picker step, etc.), which force-closed the
          // popup mid-exchange and made login intermittently fail —
          // exactly the "sometimes it logs in, sometimes it doesn't"
          // symptom this backstop was supposed to only guard against, not
          // cause.
          if (Date.now() - sameOriginSince > 10000) popup.close();
        }
      } catch (e) {
        // Still on accounts.google.com — cross-origin read throws, expected.
      }
    }, 300);
  }

  function sarvarcAuthShowError(msg) {
    const el = document.getElementById('sarvarcAuthError');
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block'; el.textContent = msg;
  }

  // ---- Translate raw Supabase auth errors into plain, reassuring copy.
  // Supabase's own messages ("Invalid login credentials", "User already
  // registered", raw network errors) are accurate but read as developer-
  // facing — this keeps the modal feeling like part of the product rather
  // than a form that occasionally throws technical text at you. Unknown
  // errors still fall through to Supabase's own message rather than a dead
  // end, so nothing is ever silently swallowed. ----
  function sarvarcAuthFriendlyError(err) {
    const raw = (err && err.message) || '';
    const m = raw.toLowerCase();
    if (m.includes('invalid login credentials')) return "That email and password don't match. Double-check them, or use \"Forgot password?\" below.";
    if (m.includes('already registered') || m.includes('already exists')) return 'An account already exists for that email — try Log In instead.';
    if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the link we sent.';
    if (m.includes('rate limit') || m.includes('too many requests')) return 'Too many attempts — please wait a minute and try again.';
    if (m.includes('password should be at least') || m.includes('password is too short')) return 'Password must be at least 6 characters.';
    if (m.includes('failed to fetch') || m.includes('network')) return "Can't reach the server right now — check your connection and try again.";
    if (m.includes('invalid email')) return 'That email address doesn\'t look right — please check it.';
    return raw || 'Something went wrong. Please try again.';
  }

  // ---- Submit: sign up or log in depending on active tab ----
  async function sarvarcAuthSubmit() {
    if (sarvarcAuthBusy) return;
    const fullName = document.getElementById('sarvarcAuthFullName').value.trim();
    const email = document.getElementById('sarvarcAuthEmail').value.trim();
    const password = document.getElementById('sarvarcAuthPassword').value;
    if (!email || !password) { sarvarcAuthShowError('Enter an email and password.'); return; }
    if (password.length < 6) { sarvarcAuthShowError('Password must be at least 6 characters.'); return; }

    sarvarcAuthBusy = true;
    sarvarcAuthShowError('');
    const submitBtn = document.getElementById('sarvarcAuthSubmitBtn');
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="mf-btn-spinner"></span>' + (sarvarcAuthMode === 'signup' ? 'Creating account…' : 'Logging in…');

    try {
      if (sarvarcAuthMode === 'signup') {
        const { data, error } = await sarvarcSupabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname,
            data: fullName ? { full_name: fullName } : undefined
          }
        });
        if (error) throw error;
        if (data.user && !data.session) {
          // Email confirmation is required before a session exists — swap
          // in the "check your email" pane; onAuthStateChange handles the
          // rest automatically once the link is clicked.
          sarvarcAuthShowConfirmPane(email);
        } else {
          // Hand off to the one canonical post-login path instead of
          // entering the Workspace directly here — see
          // sarvarcQueueWorkspaceEntryAndReload near the Supabase client
          // setup for why.
          sarvarcQueueWorkspaceEntryAndReload();
        }
      } else {
        const { data, error } = await sarvarcSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        sarvarcQueueWorkspaceEntryAndReload();
      }
    } catch (err) {
      sarvarcAuthShowError(sarvarcAuthFriendlyError(err));
    } finally {
      sarvarcAuthBusy = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  // ---- Log out ----
  async function sarvarcAuthLogOut() {
    document.getElementById('sarvarcAuthMenu').style.display = 'none';
    await sarvarcSupabase.auth.signOut();
    await sarvarcAuthUpdateNavUI();
    sarvarcUpdateEditLockUI();
  }

  // ---- Reflect logged-in/out state in the nav button. Once a profile row
  // exists (set via Settings), its name/business name is shown instead of
  // the raw email — falls back to email until the user fills that in. ----
  async function sarvarcAuthUpdateNavUI() {
    // Source of truth is getSession() — a local, no-network read of the
    // already-stored session (the same one sarvarcDriveGetToken() trusts).
    // getUser() used to gate this instead: it forces a round-trip to the
    // Supabase Auth server on every call, with no error handling or
    // fallback, so any network hiccup (or a signed-in-but-not-yet-revalidated
    // moment) made this silently fall to "Log In" while Drive — which never
    // used getUser() — correctly showed connected. That mismatch was the bug.
    let session = null;
    try {
      ({ data: { session } } = await sarvarcSupabase.auth.getSession());
    } catch (e) { session = null; }
    const user = session && session.user;
    // Cached synchronously so navigate() (Forms/Saved Sessions gates) and
    // other non-async call sites don't each need their own network round
    // trip just to check sign-in state. Updated here and by the
    // onAuthStateChange listener below, so it's always fresh by the time a
    // click needs it.
    window.__sarvarcSignedIn = !!user;
    const label = document.getElementById('sarvarcAuthNavLabel');
    const btn = document.getElementById('sarvarcAuthNavBtn');
    if (user) {
      let displayName = user.email;
      try {
        let { data: profile } = await sarvarcSupabase.from('profiles')
          .select('full_name, business_name, avatar_url').eq('id', user.id).maybeSingle();
        if (!profile || (!profile.full_name && !profile.business_name)) {
          // No name saved in profiles yet — check if one came in from the
          // sign-up form's "Full name" field, or from Google's own account
          // data, and save it now. Without this, a brand-new user's very
          // first login would show their email instead of their name, and
          // they'd only see their name after a separate trip to Settings.
          const metaName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '';
          const metaAvatar = (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || null;
          if (metaName || metaAvatar) {
            try {
              await sarvarcSupabase.from('profiles').upsert({
                id: user.id, full_name: metaName || null, avatar_url: metaAvatar, updated_at: new Date().toISOString()
              });
            } catch (e) { /* profiles table not reachable — still use metaName below for this session */ }
            profile = { full_name: metaName, business_name: null, avatar_url: metaAvatar };
          }
        } else if (!profile.avatar_url) {
          // Profile already exists (name saved via Settings) but has never
          // captured a Google avatar — backfill it quietly on this login
          // rather than requiring a trip through Settings.
          const metaAvatar = (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || null;
          if (metaAvatar) {
            try { await sarvarcSupabase.from('profiles').update({ avatar_url: metaAvatar }).eq('id', user.id); } catch (e) {}
            profile.avatar_url = metaAvatar;
          }
        }
        if (profile && (profile.full_name || profile.business_name)) {
          displayName = profile.full_name || profile.business_name;
        }
      } catch (e) { /* profiles table not reachable — fall back to email silently */ }
      label.textContent = displayName;
      btn.title = 'Logged in as ' + user.email + ' — click for settings or to log out';
      return displayName;
    } else {
      label.textContent = 'Log In';
      btn.title = 'Log in or sign up';
      document.getElementById('sarvarcAuthMenu').style.display = 'none';
      return null;
    }
  }

  // ---- On load: restore session if one exists, and keep UI in sync
  //      with any future sign-in/out events (e.g. other tabs, or this same
  //      tab confirming its own email). Also catches PASSWORD_RECOVERY —
  //      fired once Supabase exchanges the token from a "Forgot password"
  //      email link for a session — and opens the set-new-password modal
  //      automatically. ----
  sarvarcAuthUpdateNavUI().finally(() => {
    // By the time this first getUser() call has resolved (success or
    // failure), Supabase has told us the real signed-in state at least
    // once — safe to trust a "signed out" reading from here on.
    window.sarvarcAuthReady = true;
    sarvarcUpdateEditLockUI();
    // If this boot is the fresh page load right after the account-namespace
    // listener's reload (see near the Supabase client setup — it sets this
    // flag right before reloading on every real sign-in), finish the job
    // that reload interrupted: drop the person into the Workspace. This is
    // the single place that actually completes login for every path
    // (Google popup, Google redirect, password, signup, email
    // confirmation) — the reload always wins the race against calling
    // sarvarcAuthEnterWorkspace() directly, so this is what makes it a
    // reliable one-click login instead of needing several attempts.
    if (sessionStorage.getItem('sarvarcPendingWorkspaceEntry') === '1') {
      sessionStorage.removeItem('sarvarcPendingWorkspaceEntry');
      sarvarcAuthEnterWorkspaceWithRetry();
    } else if (window.__sarvarcSignedIn) {
      // Already signed in but the login modal is still showing (flag lost) — close it and enter.
      const ov = document.getElementById('sarvarcAuthOverlay');
      if (ov && ov.classList.contains('open')) sarvarcAuthEnterWorkspaceWithRetry();
    }
  });

  // ---- Wraps sarvarcAuthEnterWorkspace() for the one moment we KNOW a
  // session should exist (we're only here because a login just succeeded
  // and queued this exact reload) but getSession() can still occasionally
  // read null a beat too early — e.g. a slow connection or device where the
  // session hasn't finished being restored from storage yet on this very
  // first check. Previously a single early null reading here was final:
  // the person was dropped into the Workspace anyway (the reload itself is
  // proof login worked), but the top-bar name/nav state, having read null
  // once, was never rechecked — so it silently kept showing "Log In" for
  // the rest of that visit despite them being fully signed in. This retries
  // a few times, briefly, before accepting a genuine logged-out state. ----
  async function sarvarcAuthEnterWorkspaceWithRetry() {
    let displayName = await sarvarcAuthEnterWorkspace();
    // navigate('pdfeditor') inside sarvarcAuthEnterWorkspace() silently
    // no-ops if #sec-pdfeditor isn't in the DOM yet at that exact instant
    // (see navigate()'s "unknown/removed section, fail safe instead of
    // throwing" guard) — on a slow device/connection this section can
    // still be getting built when this first runs. Nothing was ever
    // retrying that specific call, so login could fully succeed (backend
    // session established, nav label eventually correct) while the person
    // stayed stuck on whatever section they landed on instead of being
    // dropped into the Workspace. Keep trying to actually land there, not
    // just re-checking the nav label/edit-lock, until it works or we give up.
    for (let i = 0; i < 4 && (!displayName || !document.getElementById('sec-pdfeditor') || !document.getElementById('sec-pdfeditor').classList.contains('active')); i++) {
      await new Promise(r => setTimeout(r, 400));
      displayName = await sarvarcAuthUpdateNavUI();
      // The nav label isn't the only thing that can lose this race — the
      // edit-lock check (a separate network call) can too, and unlike the
      // label it has real consequences: it's what stands between a freshly
      // logged-in person and actually being able to edit. Re-run it on
      // every retry so a slow first read can't leave the lock stuck "on"
      // after login has genuinely succeeded.
      await sarvarcUpdateEditLockUI();
      if (typeof navigate === 'function' && document.getElementById('sec-pdfeditor')) {
        navigate('pdfeditor');
      }
    }
  }
  (function() {
    // Reuses the already-embedded nav logo image as a faint background
    // watermark in the auth modal (and the welcome overlay below), rather
    // than duplicating that base64 data again in the page.
    var navImg = document.querySelector('.nav-logo-link img');
    var src = navImg && navImg.getAttribute('src');
    if (!src) return;
    var wm = document.getElementById('sarvarcAuthWatermark');
    if (wm) wm.src = src;
    var wwm = document.getElementById('sarvarcWelcomeWatermark');
    if (wwm) wwm.src = src;
  })();
  sarvarcSupabase.auth.onAuthStateChange((event, session) => {
    window.sarvarcAuthReady = true;
    window.__sarvarcSignedIn = !!(session && session.user); // set synchronously; sarvarcAuthUpdateNavUI below reconfirms it
    sarvarcAuthUpdateNavUI();
    // Mirror provider_token into the cache the instant Supabase hands one
    // back (sign-in, or an occasional refresh that happens to include it) —
    // don't wait for something to lazily call sarvarcDriveGetToken() first.
    if (session && session.provider_token && typeof sarvarcDriveCacheToken === 'function') {
      sarvarcDriveCacheToken(session.provider_token, session.provider_token_expires_at
        ? (session.provider_token_expires_at - Math.floor(Date.now() / 1000))
        : 3300);
    }
    // Signing out drops Drive access with it — clear the cached token so a
    // stale one can't make the status panel lie about being connected.
    if (event === 'SIGNED_OUT' && typeof sarvarcDriveClearCachedToken === 'function') {
      sarvarcDriveClearCachedToken();
    }
    // Keep the edit-lock overlay in sync too — logging in clears it
    // immediately; logging out re-applies it if the free export was
    // already used on this browser.
    sarvarcUpdateEditLockUI();
    // Keep the Saved Sessions list's lock state in sync the moment someone
    // signs in or out — otherwise a file could stay shown as unlocked (or
    // locked) until the page happened to be reopened.
    if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
    // Re-check the Drive connection status (panel in the Saved Sessions
    // sidebar) any time auth state changes — signing out correctly flips it
    // to "Not connected" since the token goes with it; signing back in
    // (or a token refresh) flips it back once sarvarcDriveAvailable()
    // confirms a usable token.
    if (typeof smUpdateDriveStatusUI === 'function') smUpdateDriveStatusUI();
    // Same idea for the Assets library: re-filter by the newly-current
    // account right away, so switching accounts on the same browser can't
    // leave the previous account's images/logos/signatures on screen until
    // the Assets panel happens to be closed and reopened.
    if (document.getElementById('sarvarcAssetsGrid') && typeof sarvarcAssetsRenderPanel === 'function') sarvarcAssetsRenderPanel();
    // FALLBACK (login-screen-stays-open fix): normal path is reload + pending flag.
    // If a session exists but the login modal is STILL open a couple of seconds
    // later, the reload/flag got lost (swallowed reload, blocked sessionStorage,
    // in-app browser...) — enter the Workspace directly instead of staying stuck.
    if (session && session.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !window.__sarvarcFallbackArmed) {
      window.__sarvarcFallbackArmed = true;
      setTimeout(function () {
        try {
          const ov = document.getElementById('sarvarcAuthOverlay');
          if (ov && ov.classList.contains('open')) {
            try { sessionStorage.removeItem('sarvarcPendingWorkspaceEntry'); } catch (e) {}
            sarvarcAuthEnterWorkspaceWithRetry();
          }
        } catch (e) { console.error('[login fallback]', e); }
        window.__sarvarcFallbackArmed = false;
      }, 2500);
    }
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('sarvarcRecoveryOverlay').classList.add('open');
      setTimeout(() => document.getElementById('sarvarcRecoveryNewPw').focus(), 50);
    }
    // Note: entering the Workspace after a sign-in is NOT handled here.
    // Every real sign-in — password, signup, Google popup, Google
    // redirect, email-confirmation link — funnels through
    // sarvarcQueueWorkspaceEntryAndReload() (see near the Supabase client
    // setup), which reloads the page and lets the boot sequence
    // (sarvarcAuthUpdateNavUI().finally() further down) call
    // sarvarcAuthEnterWorkspace() exactly once, on a clean freshly-loaded
    // page. Calling it directly from this SIGNED_IN handler used to race
    // that reload — whichever lost had its work silently discarded by the
    // navigation, which is why some logins needed several attempts and the
    // welcome moment could get cut short or never visibly appear at all.
  });
