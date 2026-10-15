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


  // =========================================================
  // LIVE ROLE ENFORCEMENT (Teams, Step 2)
  //
  // Viewers and reviewers may WATCH a live session but not change shared
  // work. Three layers:
  //   1. SEND: a person whose role cannot edit never broadcasts document
  //      updates (their local changes stay on their own screen only).
  //   2. RECEIVE: every update carries the sender's id. We look the sender
  //      up in team_members and drop updates from anyone who may not edit
  //      (or who is not on the team at all).
  //   3. SCREEN: typing / delete / paste / drop inside the live modules is
  //      blocked for read-only roles, with a "View only" pill so it is
  //      clear why.
  // Layers 1-3 protect against accidents and the normal app. A person
  // running a hand-modified copy of the app could still try to send
  // packets; stopping that completely needs Supabase Realtime private
  // channels with a database rule (see supabase/02-realtime-auth.sql).
  // =========================================================
  const SARVARC_COLLAB_REQUIRE_SENDER = false; // flip to true once every open tab runs this build
  const SARVARC_COLLAB_GUARD_SECTIONS = '#sec-dataarrange, #sec-diagrams, #sec-makeforms, #sec-pdfeditor';
  let sarvarcCollabRoles = {};          // user_id -> normalized role (active team)
  let sarvarcCollabRolesLoaded = false; // false = we could not verify our own role
  // Authoritative answer from the database about OUR OWN membership:
  // 'member' | 'removed' | 'unknown'. 'unknown' (network error, expired
  // sign-in) never evicts anyone; only a confirmed 'removed' does.
  let sarvarcCollabMembership = 'unknown';
  let sarvarcCollabConnectSeq = 0;      // bumped by every connect/disconnect so a slow connect can't resurrect a closed session
  let sarvarcCollabEvicting = false;    // re-entrancy guard for sarvarcTeamEvictSelf
  let sarvarcCollabRolesRefreshAt = 0;  // throttle for the unknown-teammate role refresh in the presence bar
  const SARVARC_LIVE_FLAGS = ['sarvarcLiveCollabTeamProjectId', 'sarvarcLiveCollabTeamId', 'sarvarcLiveCollabSessionId'];
  const sarvarcTeamRecentDepartures = new Map(); // userId -> time handled (the same news arrives on two channels)

  async function sarvarcCollabLoadRoles(teamId) {
    if (!teamId) return false;
    try {
      const user = await sarvarcTeamGetUser();
      const { data, error } = await sarvarcSupabase.from('team_members').select('user_id, role').eq('team_id', teamId);
      if (error) throw error;
      const map = {};
      (data || []).forEach(m => { map[m.user_id] = sarvarcTeamNormalizeRole(m.role); });
      sarvarcCollabRoles = map;
      if (user && map[user.id]) { sarvarcTeamMyRole = map[user.id]; sarvarcCollabRolesLoaded = true; sarvarcCollabMembership = 'member'; }
      else {
        sarvarcCollabRolesLoaded = false;
        // A signed-in person whose own row is gone from a successful query
        // has been removed. No user object = sign-in problem, not removal.
        sarvarcCollabMembership = user ? 'removed' : 'unknown';
      }
      return sarvarcCollabRolesLoaded;
    } catch (e) {
      console.warn('[Collab] could not load roles', e);
      return sarvarcCollabRolesLoaded; // keep what we already knew
    }
  }

  // Fails closed: if we could not verify our role we do not send edits.
  function sarvarcCollabMayEditNow() {
    return sarvarcCollabRolesLoaded && sarvarcTeamCan('edit');
  }

  async function sarvarcCollabSenderMayEdit(senderId) {
    if (!senderId) return !SARVARC_COLLAB_REQUIRE_SENDER;
    if (!(senderId in sarvarcCollabRoles)) {
      await sarvarcCollabLoadRoles(sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId'));
    }
    const role = sarvarcCollabRoles[senderId];
    return !!role && sarvarcTeamCan('edit', role);
  }

  let sarvarcCollabRoleTimer = null; // re-checks roles so a role change mid-session takes effect within a minute
  let sarvarcCollabGuardOn = false;
  let sarvarcCollabGuardLastToast = 0;
  function sarvarcCollabGuardNotify() {
    const now = Date.now();
    if (now - sarvarcCollabGuardLastToast < 3000) return;
    sarvarcCollabGuardLastToast = now;
    if (typeof toast === 'function') toast('View only: your role cannot change this live project.', 'info');
  }
  function sarvarcCollabGuardHandler(e) {
    if (sarvarcCollabMayEditNow()) return;
    const t = e.target;
    if (!t || !t.closest || !t.closest(SARVARC_COLLAB_GUARD_SECTIONS)) return;
    const editable = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.type === 'keydown') {
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      const isDelete = k === 'Delete' || k === 'Backspace';
      const isMutatingShortcut = mod && /^[xvyz]$/i.test(k);
      const isTyping = editable && !mod && k.length === 1;
      const isEnter = editable && k === 'Enter';
      if (!(isDelete || isMutatingShortcut || isTyping || isEnter)) return;
    } else if (!editable && e.type !== 'drop') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    sarvarcCollabGuardNotify();
  }
  function sarvarcCollabGuardApply() {
    const needed = !sarvarcCollabMayEditNow();
    document.body.classList.toggle('sarvarc-readonly', needed);
    let pill = document.getElementById('sarvarcReadOnlyPill');
    if (needed) {
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'sarvarcReadOnlyPill';
        pill.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:900;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;background:var(--bg2,#1b2330);color:var(--text,#e6edf3);border:1px solid var(--border2,#344055);box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none;';
        document.body.appendChild(pill);
      }
      pill.textContent = sarvarcCollabRolesLoaded
        ? 'View only (' + sarvarcTeamNormalizeRole(sarvarcTeamMyRole) + '): you can watch, not edit'
        : 'View only: could not verify your team role';
    } else if (pill) {
      pill.remove();
    }
    if (needed && !sarvarcCollabGuardOn) {
      ['keydown', 'beforeinput', 'paste', 'cut', 'drop'].forEach(ev => document.addEventListener(ev, sarvarcCollabGuardHandler, true));
      sarvarcCollabGuardOn = true;
    } else if (!needed && sarvarcCollabGuardOn) {
      sarvarcCollabGuardRemove(true);
    }
  }
  function sarvarcCollabGuardRemove(keepPill) {
    ['keydown', 'beforeinput', 'paste', 'cut', 'drop'].forEach(ev => document.removeEventListener(ev, sarvarcCollabGuardHandler, true));
    sarvarcCollabGuardOn = false;
    if (!keepPill) {
      document.body.classList.remove('sarvarc-readonly');
      const pill = document.getElementById('sarvarcReadOnlyPill');
      if (pill) pill.remove();
    }
  }

  async function sarvarcCollabConnect(teamProjectId) {
    await sarvarcCollabWaitForYjs();
    if (sarvarcCollabProjectId === teamProjectId && sarvarcCollabDoc) return; // already connected to this one
    if (sarvarcCollabDoc) sarvarcCollabDisconnect();
    const seq = ++sarvarcCollabConnectSeq;

    const Y = window.Yjs;
    const user = await sarvarcTeamGetUser();
    if (!user) return;
    const connectTeamId = sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId');
    await sarvarcCollabLoadRoles(connectTeamId);
    if (seq !== sarvarcCollabConnectSeq) return; // closed while we were checking
    // Membership gate: never join (or silently re-join after a reload) a live
    // room of a team we no longer belong to. Previously only the role was
    // checked, so a removed person still got the Live badge and everyone's
    // cursors, just with editing switched off.
    if (sarvarcCollabMembership === 'removed') {
      sarvarcTeamEvictSelf(connectTeamId, 'removed');
      return;
    }

    const doc = new Y.Doc();
    const awareness = new window.YAwareness.Awareness(doc);
    const channel = sarvarcSupabase.channel('sarvarc-live-' + teamProjectId, { config: { broadcast: { self: false } } });

    // Incoming CRDT updates from teammates — merge into our doc. Tag the
    // transaction origin 'remote' so module attach() observers can tell
    // "this came from a teammate, just re-render" apart from "this is my
    // own edit, also push it out" and avoid an echo loop.
    channel.on('broadcast', { event: 'yupdate' }, async (msg) => {
      try {
        if (!(await sarvarcCollabSenderMayEdit(msg.payload.s))) {
          console.warn('[Collab] dropped update from a sender who cannot edit');
          return;
        }
        const update = sarvarcCollabB64ToBytes(msg.payload.u);
        Y.applyUpdate(doc, update, 'remote');
        sarvarcCollabSetHealthy(true);
      } catch (e) {
        console.warn('[Collab] bad update packet', e);
        sarvarcCollabSetHealthy(false);
      }
    });
    // A late joiner asks "what have I missed?" with its state vector; any
    // editor answers with only the missing part. Without this a person who
    // joins mid-session would only see changes made AFTER they arrived.
    channel.on('broadcast', { event: 'ysync-req' }, (msg) => {
      try {
        if (!sarvarcCollabMayEditNow()) return;
        const diff = Y.encodeStateAsUpdate(doc, sarvarcCollabB64ToBytes(msg.payload.sv));
        channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: sarvarcCollabBytesToB64(diff), s: user.id } });
      } catch (e) { console.warn('[Collab] could not answer sync request', e); }
    });
    channel.on('broadcast', { event: 'yaware' }, (msg) => {
      try {
        const update = sarvarcCollabB64ToBytes(msg.payload.u);
        window.YAwareness.applyAwarenessUpdate(awareness, update, 'remote');
      } catch (e) { console.warn('[Collab] bad awareness packet', e); }
    });
    // Removal / leave is ALSO relayed on the live room itself. The team
    // channel is only joined once the Teams window or auto-presence has
    // started it, but everyone in a live session is certainly on this one.
    channel.on('broadcast', { event: 'member-removed' }, ({ payload }) => {
      if (!payload || !payload.userId) return;
      sarvarcTeamHandleMemberRemoved(payload.teamId, payload.userId, payload.reason);
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
      if (!sarvarcCollabMayEditNow()) { sarvarcCollabGuardNotify(); return; } // read-only roles never broadcast edits
      channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: sarvarcCollabBytesToB64(update), s: user.id } })
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
          awareness.setLocalState({ userId: user.id, name: (m && m.full_name) || user.email, avatar: (m && m.avatar_url) || null, color: sarvarcCollabColorFor(user.id), hb: Date.now() });
          if (sarvarcCollabMayEditNow()) {
            channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: sarvarcCollabBytesToB64(Y.encodeStateAsUpdate(doc)), s: user.id } });
          }
          channel.send({ type: 'broadcast', event: 'ysync-req', payload: { sv: sarvarcCollabBytesToB64(Y.encodeStateVector(doc)), s: user.id } });
          resolve();
        }
      });
    });

    if (seq !== sarvarcCollabConnectSeq) {
      // We were evicted / left while the channel was still subscribing.
      try { awareness.setLocalState(null); } catch (e) {}
      try { sarvarcSupabase.removeChannel(channel); } catch (e) {}
      try { doc.destroy(); } catch (e) {}
      return;
    }
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
    sarvarcCollabGuardApply();
    if (sarvarcCollabRoleTimer) clearInterval(sarvarcCollabRoleTimer);
    // Membership watchdog (also refreshes roles). The removal broadcast is
    // the fast path; this is the safety net for anyone who missed it (tab
    // asleep, flaky network, channel not up yet). It also re-checks the
    // moment the tab wakes up or the network comes back.
    sarvarcCollabRoleTimer = setInterval(() => sarvarcCollabWatchdogTick(), 15000);
    document.addEventListener('visibilitychange', sarvarcCollabWakeHandler);
    window.addEventListener('online', sarvarcCollabWakeHandler);
    window.addEventListener('pagehide', sarvarcCollabPageHideHandler);
  }

  // One watchdog pass: refresh roles, and if the database says we are no
  // longer on the team (twice in a row, to ride out a one-off blip), leave.
  async function sarvarcCollabWatchdogTick() {
    if (!sarvarcCollabDoc) return;
    const tid = sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId');
    await sarvarcCollabLoadRoles(tid);
    if (!sarvarcCollabDoc) return;
    if (sarvarcCollabMembership === 'removed') {
      // Never act on a single answer: look once more a moment later.
      await new Promise(r => setTimeout(r, 1500));
      if (!sarvarcCollabDoc) return;
      await sarvarcCollabLoadRoles(tid);
      if (sarvarcCollabDoc && sarvarcCollabMembership === 'removed') { sarvarcTeamEvictSelf(tid, 'removed'); return; }
    }
    sarvarcCollabGuardApply();
    sarvarcPresenceRender();
  }
  function sarvarcCollabWakeHandler() {
    if (document.visibilityState === 'hidden') return;
    sarvarcCollabWatchdogTick();
  }
  // Tab closing: say goodbye so teammates drop our cursor and avatar at
  // once instead of waiting for the 30-second awareness timeout.
  function sarvarcCollabPageHideHandler() {
    try { if (sarvarcCollabAwareness) sarvarcCollabAwareness.setLocalState(null); } catch (e) {}
  }

  function sarvarcCollabDisconnect() {
    if (sarvarcCollabRoleTimer) { clearInterval(sarvarcCollabRoleTimer); sarvarcCollabRoleTimer = null; }
    sarvarcCollabGuardRemove(false);
    sarvarcCollabConnectSeq++; // invalidates any connect still in flight
    document.removeEventListener('visibilitychange', sarvarcCollabWakeHandler);
    window.removeEventListener('online', sarvarcCollabWakeHandler);
    window.removeEventListener('pagehide', sarvarcCollabPageHideHandler);
    sarvarcPresenceDetachInputListeners();
    Object.keys(sarvarcCollabModules).forEach(key => {
      if (sarvarcCollabAttached.has(key)) {
        try { sarvarcCollabModules[key].detach(); } catch (e) {}
      }
    });
    sarvarcCollabAttached.clear();
    const oldChannel = sarvarcCollabChannel, oldAwareness = sarvarcCollabAwareness, oldDoc = sarvarcCollabDoc;
    sarvarcCollabDoc = null;
    sarvarcCollabAwareness = null;
    sarvarcCollabChannel = null;
    sarvarcCollabProjectId = null;
    // Say goodbye: clearing our awareness state makes the existing 'update'
    // handler broadcast "this client is gone", so teammates drop our cursor
    // and avatar immediately. This runs AFTER the globals above are cleared
    // so the presence bar can never be re-drawn by it, and the channel is
    // closed a moment later so that last packet actually leaves the browser.
    if (oldAwareness) { try { oldAwareness.setLocalState(null); } catch (e) {} }
    setTimeout(() => {
      if (oldChannel) { try { sarvarcSupabase.removeChannel(oldChannel); } catch (e) {} }
      if (oldAwareness) { try { oldAwareness.destroy(); } catch (e) {} } // stops its 30s housekeeping timer
      if (oldDoc) { try { oldDoc.destroy(); } catch (e) {} }
    }, 400);
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
  // userId -> { hb, localSeenAt }: heartbeat tracking (same local-clock idea).
  // Every connected client bumps `hb` every 5s; a teammate whose heartbeat
  // has not changed for 20s is treated as gone (crashed tab, lost network),
  // instead of lingering for the full 30s awareness timeout.
  const sarvarcPresenceBeatSeenAt = new Map();
  let sarvarcPresenceBeatTimer = null;
  // Where is everyone? Each client publishes the module it is looking at
  // (`module` in its awareness state). Only ids in this whitelist are ever
  // trusted from a teammate, so a forged value can never reach the markup.
  const SARVARC_PRESENCE_MODULES = {
    pdfeditor:     { label: 'Workspace',         short: 'WS' },
    dataarrange:   { label: 'Data Arrangement',  short: 'DA' },
    makeforms:     { label: 'Make Forms',        short: 'MF' },
    diagrams:      { label: 'Diagrams & Graphs', short: 'DG' },
    extract:       { label: 'Extract Images',    short: 'EX' },
    redact:        { label: 'Privacy Redaction', short: 'RD' },
    dashboard:     { label: 'Dashboard',         short: 'DB' },
    savedsessions: { label: 'Saved Sessions',    short: 'SS' }
  };
  // Tools that open ON TOP of a module (full-screen overlays, dialogs, side
  // panels). `gate` = a full-screen overlay: its content is not the page
  // underneath, so cursors are only shown between people who are in the same
  // overlay. Side panels (gate:false) are shown in the name tag only.
  // Only the tool's NAME is ever shared, never what is in it.
  // mode: 'open' = element has class "open"; 'display' = element is shown;
  // 'exists' = element is present in the page.
  const SARVARC_PRESENCE_TOOLS = {
    showcase:    { label: 'Showcase',           short: 'SC', sel: '#sppOverlay',            mode: 'open',    gate: true  },
    proposals:   { label: 'Business Proposals', short: 'BP', sel: '#bpTplModalOverlay',     mode: 'open',    gate: true  },
    crop:        { label: 'Image Crop',         short: 'CR', sel: '#cropOverlay',           mode: 'open',    gate: true  },
    reshape:     { label: 'Image Reshaper',     short: 'RS', sel: '#reshapeOverlay',        mode: 'open',    gate: true  },
    shapestudio: { label: 'Shape Studio',       short: 'SH', sel: '#shapeStudioOverlay',    mode: 'open',    gate: true  },
    slideshow:   { label: 'Slideshow',          short: 'SL', sel: '#pdfedSlideshowOverlay', mode: 'open',    gate: true  },
    presenter:   { label: 'Presenter',          short: 'PR', sel: '#pdfedPresenter',        mode: 'open',    gate: true  },
    signature:   { label: 'Signature',          short: 'SG', sel: '#pdfedSigModal',         mode: 'display', gate: true  },
    sign:        { label: 'Sign',               short: 'SG', sel: '.sgx-ov',                mode: 'exists',  gate: true  },
    brandkit:    { label: 'Brand Kit',          short: 'BK', sel: '#bkPanel',               mode: 'open',    gate: false },
    kadessa:     { label: 'Kadessa',            short: 'KA', sel: '#kadessa-panel',         mode: 'open',    gate: false }
  };
  function sarvarcPresenceSafeTool(id) {
    return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(SARVARC_PRESENCE_TOOLS, id)) ? id : null;
  }
  // The tool in front right now (full-screen overlays win over side panels).
  function sarvarcPresenceCurrentTool() {
    let panelHit = null;
    const ids = Object.keys(SARVARC_PRESENCE_TOOLS);
    for (let i = 0; i < ids.length; i++) {
      const t = SARVARC_PRESENCE_TOOLS[ids[i]];
      let el = null;
      try { el = document.querySelector(t.sel); } catch (e) {}
      if (!el) continue;
      let on = false;
      if (t.mode === 'open') on = el.classList.contains('open');
      else if (t.mode === 'display') on = getComputedStyle(el).display !== 'none';
      else on = true;
      if (!on) continue;
      if (t.gate) return ids[i];
      if (!panelHit) panelHit = ids[i];
    }
    return panelHit;
  }
  // The tool that matters for cursor sharing (side panels do not count).
  function sarvarcPresenceGateTool(id) {
    const k = sarvarcPresenceSafeTool(id);
    return (k && SARVARC_PRESENCE_TOOLS[k].gate) ? k : null;
  }
  // "Showcase (Workspace)" / "Data Arrangement"
  function sarvarcPresenceWhere(moduleId, toolId) {
    const m = sarvarcPresenceSafeModule(moduleId), t = sarvarcPresenceSafeTool(toolId);
    const ml = m ? SARVARC_PRESENCE_MODULES[m].label : null;
    if (t && ml) return SARVARC_PRESENCE_TOOLS[t].label + ' (' + ml + ')';
    if (t) return SARVARC_PRESENCE_TOOLS[t].label;
    return ml;
  }
  let sarvarcPresenceModuleObserver = null;
  let sarvarcPresenceToolTimer = null;
  function sarvarcPresenceCurrentModule() {
    const el = document.querySelector('.section.active');
    const id = el && el.id ? el.id.replace(/^sec-/, '') : null;
    return (id && SARVARC_PRESENCE_MODULES[id]) ? id : null;
  }
  function sarvarcPresenceSafeModule(id) {
    return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(SARVARC_PRESENCE_MODULES, id)) ? id : null;
  }
  // Publish our module whenever it changes (covers navigate(), the mobile
  // swap to Dashboard, restore-from-session... anything that flips the
  // active .section), without touching the navigation code itself.
  function sarvarcPresencePublishModule(awareness) {
    try {
      const m = sarvarcPresenceCurrentModule();
      const t = sarvarcPresenceCurrentTool();
      const local = awareness.getLocalState();
      if (local && local.module !== m) awareness.setLocalStateField('module', m);
      if (local && (local.tool || null) !== t) awareness.setLocalStateField('tool', t);
    } catch (e) {}
    sarvarcPresenceRender();
  }
  // Jump to where a teammate is working (click their avatar).
  function sarvarcPresenceJump(moduleId) {
    const m = sarvarcPresenceSafeModule(moduleId);
    if (m && typeof navigate === 'function') navigate(m);
  }
  const SARVARC_PRESENCE_BEAT_MS = 5000;
  const SARVARC_PRESENCE_GONE_MS = 20000;

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
        border-radius:20px; border:1px solid var(--pdfed-section-border, rgba(255,255,255,0.1));
        background:var(--surface);
        flex-shrink:0; transition:opacity .25s ease;
      }
      .sarvarc-presence-live {
        font-size:9.5px;color:#4BAE8A;letter-spacing:.08em;text-transform:uppercase;
        font-weight:700;display:flex;align-items:center;gap:5px;
      }
      /* Sync-health dot: still green = last send/receive went through fine.
         Dims the instant a send fails or a packet cannot be applied, so a
         stalled connection is visible at a glance. No animation. */
      .sarvarc-collab-sync {
        width:8px; height:8px; border-radius:50%; flex-shrink:0; background:#4BAE8A;
      }
      .sarvarc-collab-sync.sarvarc-collab-stalled { opacity:.35; }
      .sarvarc-presence-dot { width:6px;height:6px;border-radius:50%;background:#4BAE8A; }
      .sarvarc-presence-avatars { display:flex; align-items:center; }
      .sarvarc-presence-avatar-wrap {
        position:relative; width:26px; height:26px; margin-left:-8px; flex-shrink:0;
        border-radius:50%;
      }
      .sarvarc-presence-avatar-wrap:first-child { margin-left:0; }
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
      /* Module tag on each avatar: who is working where. Teammates in a
         different module than you are slightly dimmed and clickable. */
      .sarvarc-presence-avatar-wrap.sarvarc-presence-away { opacity:.62; cursor:pointer; }
      .sarvarc-presence-avatar-wrap.sarvarc-presence-away:hover { opacity:1; }
      .sarvarc-presence-mod {
        position:absolute; right:-6px; bottom:-5px; min-width:15px; padding:0 3px; height:13px;
        border-radius:7px; font-size:7.5px; font-weight:800; line-height:13px; text-align:center;
        color:#fff; letter-spacing:.02em; border:1.5px solid var(--bg2); pointer-events:none;
      }
      /* Sidebar: small dots on a module's nav item = teammates working in it. */
      .sarvarc-nav-here { margin-left:auto; display:flex; align-items:center; flex-shrink:0; }
      .sarvarc-nav-here-dot {
        width:16px; height:16px; margin-left:-5px; border-radius:50%; flex-shrink:0;
        display:flex; align-items:center; justify-content:center; overflow:hidden;
        font-size:7.5px; font-weight:800; color:#fff; border:1.5px solid var(--bg2); box-sizing:border-box;
      }
      .sarvarc-nav-here-dot img { width:100%; height:100%; object-fit:cover; }
      .sarvarc-nav-here-more { font-size:9px; font-weight:700; color:var(--text2); margin-left:3px; }
      .sarvarc-field-presence-ring { outline:2px solid;outline-offset:2px;border-radius:6px; }
      .sarvarc-field-presence-badge {
        position:absolute;font-size:10px;font-weight:700;color:#fff;padding:1px 6px;border-radius:5px 5px 5px 0;
        transform:translateY(-100%);white-space:nowrap;pointer-events:none;z-index:852;box-shadow:0 1px 3px rgba(0,0,0,0.4);
      }
      .sarvarc-end-live-btn {
        margin-left:8px; padding:4px 10px; font-size:10.5px; font-weight:600;
        color:var(--text2); background:transparent; border:1px solid var(--pdfed-section-border, rgba(255,255,255,0.12));
        border-radius:20px; cursor:pointer; white-space:nowrap; flex-shrink:0;
        transition:background .15s,border-color .15s;
      }
      .sarvarc-end-live-btn:hover { background:var(--surface); color:var(--text); }
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
    const myModule = sarvarcPresenceCurrentModule();
    const myGateTool = sarvarcPresenceGateTool(sarvarcPresenceCurrentTool());
    // Dedupe by userId (same person could theoretically have >1 tab open);
    // keep whichever state has the freshest cursor timestamp.
    const remoteByUser = new Map();
    let unknownTeammate = false;
    states.forEach((state, clientId) => {
      if (clientId === localId || !state || !state.userId) return;
      // 1) Membership gate. Presence used to be trusted blindly while edits
      //    were role-checked, so a removed person's cursor and avatar kept
      //    showing even after their edits stopped. If we know the team's
      //    roster and this person is not on it, they are not shown.
      if (sarvarcCollabRolesLoaded && !(state.userId in sarvarcCollabRoles)) { unknownTeammate = true; return; }
      // 2) Liveness gate (heartbeat). Older tabs without a heartbeat are
      //    left to the normal awareness timeout.
      if (typeof state.hb === 'number') {
        const seen = sarvarcPresenceBeatSeenAt.get(state.userId);
        if (!seen || seen.hb !== state.hb) sarvarcPresenceBeatSeenAt.set(state.userId, { hb: state.hb, localSeenAt: now });
        else if ((now - seen.localSeenAt) > SARVARC_PRESENCE_GONE_MS) return;
      }
      const existing = remoteByUser.get(state.userId);
      const existingT = (existing && existing.cursor && existing.cursor.t) || 0;
      const stateT = (state.cursor && state.cursor.t) || 0;
      if (!existing || stateT >= existingT) remoteByUser.set(state.userId, state);
    });

    // Someone we do not recognise might simply have joined the team a minute
    // ago: refresh the roster (at most every 10s) and re-render. If they are
    // really not on the team they stay hidden.
    if (unknownTeammate && (now - sarvarcCollabRolesRefreshAt) > 10000) {
      sarvarcCollabRolesRefreshAt = now;
      sarvarcCollabLoadRoles(sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId')).then(() => sarvarcPresenceRender());
    }

    // ---- "Who's here" box, embedded in the top bar ----
    // Real profile photos where we have them, round and perfectly still,
    // so a glance at the top bar tells you who's live without it feeling busy.
    // The owner also gets an "End Live Session" control here — shown even
    // if they're currently the only one connected, since ending it (e.g.
    // right before others join, or to stop a stray auto-reconnect) is
    // still a valid owner action either way.
    const isOwner = sarvarcTeamMyRole === 'owner';
    if (remoteByUser.size > 0 || isOwner || sarvarcCollabIsLive()) {
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
          const theirMod = sarvarcPresenceSafeModule(state.module);
          const theirTool = sarvarcPresenceSafeTool(state.tool);
          const sameMod = !theirMod || !myModule || theirMod === myModule;
          const sameTool = sarvarcPresenceGateTool(state.tool) === myGateTool;
          const here = sameMod && sameTool;
          const modInfo = theirTool ? SARVARC_PRESENCE_TOOLS[theirTool] : (theirMod ? SARVARC_PRESENCE_MODULES[theirMod] : null);
          const whereTxt = sarvarcPresenceWhere(theirMod, theirTool);
          const title = (name.replace(/"/g, '&quot;')) + (whereTxt
            ? (here ? ' \u2014 here with you in ' + whereTxt : (sameMod ? ' \u2014 in ' + whereTxt : ' \u2014 in ' + whereTxt + ' (click to go there)'))
            : ' \u2014 editing live now');
          const delay = '0s';
          const inner = state.avatar
            ? '<img class="sarvarc-presence-avatar-img" src="' + state.avatar.replace(/"/g, '&quot;') +
              '" alt="" referrerpolicy="no-referrer" title="' + title + '" onerror="this.outerHTML=\'<div class=&quot;sarvarc-presence-avatar-fallback&quot; style=&quot;background:' +
              color + '&quot; title=&quot;' + title.replace(/'/g, "&#39;") + '&quot;>' + sarvarcPresenceInitials(name) + '</div>\'">'
            : '<div class="sarvarc-presence-avatar-fallback" style="background:' + color + '" title="' + title + '">' +
              sarvarcPresenceInitials(name) + '</div>';
          const tag = modInfo ? '<span class="sarvarc-presence-mod" style="background:' + color + '">' + modInfo.short + '</span>' : '';
          const away = (modInfo && !here) ? ' sarvarc-presence-away' + (theirMod && !sameMod ? '\" onclick=\"sarvarcPresenceJump(\'' + theirMod + '\')' : '') : '';
          html += '<span class="sarvarc-presence-avatar-wrap' + away + '" style="animation-delay:' + delay + ';z-index:' + (shown.length - i) + '">' + inner + tag + '</span>';
        });
        if (overflow > 0) {
          html += '<span class="sarvarc-presence-overflow" title="' + overflow + ' more live now">+' + overflow + '</span>';
        }
        html += '</span>';
      }
      if (sarvarcCollabIsLive()) {
        html += '<button type="button" class="sarvarc-end-live-btn" onclick="sarvarcTeamLeaveLiveSession()" title="Leave this live session. Your own copy stays on your screen and the others keep working.">Leave</button>';
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
      // A cursor is a position on THEIR screen of THEIR module. Drawing it
      // over a different module is what made cursors clash, so it only shows
      // when we are looking at the same module (older tabs without a module
      // keep the old behaviour).
      const cm = sarvarcPresenceSafeModule(state.module);
      if (cm && myModule && cm !== myModule) return;
      if (sarvarcPresenceGateTool(state.tool) !== myGateTool) return; // one of you is inside a full-screen tool the other is not
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
      const fm = sarvarcPresenceSafeModule(state.module);
      if (fm && myModule && fm !== myModule) return;
      if (sarvarcPresenceGateTool(state.tool) !== myGateTool) return;
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
    sarvarcPresenceRenderNav(remoteByUser);
  }

  // Sidebar: put a small dot (photo or initials) for each teammate on the
  // nav item of the module they are in. Rebuilt only when it changed.
  function sarvarcPresenceRenderNav(remoteByUser) {
    const byModule = {};
    remoteByUser.forEach((state) => {
      const m = sarvarcPresenceSafeModule(state.module);
      if (m) (byModule[m] = byModule[m] || []).push(state);
    });
    document.querySelectorAll('.sidebar .nav-item[onclick]').forEach(item => {
      const oc = item.getAttribute('onclick') || '';
      const mm = /navigate\('([a-z]+)'\)/.exec(oc);
      // Saved Sessions opens through its own function, not navigate().
      const id = mm ? mm[1] : (/smOpenSessionsPage\(/.test(oc) ? 'savedsessions' : null);
      const people = (id && byModule[id]) || [];
      let box = item.querySelector(':scope > .sarvarc-nav-here');
      const sig = people.map(p => p.userId + '|' + (p.color || '') + '|' + (p.avatar || '') + '|' + (sarvarcPresenceSafeTool(p.tool) || '')).join(',');
      if (!people.length) { if (box) box.remove(); return; }
      if (box && box.dataset.sig === sig) return;
      if (!box) { box = document.createElement('span'); box.className = 'sarvarc-nav-here'; item.appendChild(box); }
      box.dataset.sig = sig;
      box.textContent = '';
      people.slice(0, 3).forEach(p => {
        const dot = document.createElement('span');
        dot.className = 'sarvarc-nav-here-dot';
        dot.style.background = p.color || '#3b82f6';
        const nm = p.name || 'Teammate';
        dot.title = nm + ' is working in ' + (sarvarcPresenceWhere(id, p.tool) || SARVARC_PRESENCE_MODULES[id].label);
        if (p.avatar) {
          const img = document.createElement('img');
          img.src = p.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer';
          img.onerror = () => { img.remove(); dot.textContent = sarvarcPresenceInitials(nm); };
          dot.appendChild(img);
        } else dot.textContent = sarvarcPresenceInitials(nm);
        box.appendChild(dot);
      });
      if (people.length > 3) {
        const more = document.createElement('span');
        more.className = 'sarvarc-nav-here-more'; more.textContent = '+' + (people.length - 3);
        box.appendChild(more);
      }
    });
  }

  // Wires up local mouse/focus tracking (broadcast out via awareness) and
  // starts rendering everyone else's presence. Called once per live
  // connection from sarvarcCollabConnect.
  function sarvarcPresenceAttachInputListeners(awareness) {
    sarvarcPresenceDetachInputListeners(); // never stack a second set of listeners/timers
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
    // Tell teammates which module we are in, and keep it current.
    sarvarcPresencePublishModule(awareness);
    sarvarcPresenceToolTimer = setInterval(() => sarvarcPresencePublishModule(awareness), 1000); // cheap: only sends when something changed
    sarvarcPresenceModuleObserver = new MutationObserver(() => sarvarcPresencePublishModule(awareness));
    document.querySelectorAll('.section').forEach(sec => sarvarcPresenceModuleObserver.observe(sec, { attributes: true, attributeFilter: ['class'] }));
    // Field badges are positioned from getBoundingClientRect(), which goes
    // stale on scroll/resize even with no new awareness update — a light
    // periodic re-render keeps them lined up, and doubles as cleanup for
    // cursors from a teammate whose tab closed without a clean disconnect.
    sarvarcPresenceStaleTimer = setInterval(sarvarcPresenceRender, 2000);
    sarvarcPresenceBeatTimer = setInterval(() => {
      try { if (awareness.getLocalState()) awareness.setLocalStateField('hb', Date.now()); } catch (e) {}
      sarvarcPresencePublishModule(awareness); // safety net if a class change was missed
    }, SARVARC_PRESENCE_BEAT_MS);
    sarvarcPresenceRender();
  }

  function sarvarcPresenceDetachInputListeners() {
    if (sarvarcPresenceMouseHandler) document.removeEventListener('mousemove', sarvarcPresenceMouseHandler);
    if (sarvarcPresenceFocusHandler) document.removeEventListener('focusin', sarvarcPresenceFocusHandler);
    if (sarvarcPresenceBlurHandler) document.removeEventListener('focusout', sarvarcPresenceBlurHandler);
    if (sarvarcPresenceStaleTimer) clearInterval(sarvarcPresenceStaleTimer);
    if (sarvarcPresenceBeatTimer) clearInterval(sarvarcPresenceBeatTimer);
    sarvarcPresenceMouseHandler = sarvarcPresenceFocusHandler = sarvarcPresenceBlurHandler = sarvarcPresenceStaleTimer = sarvarcPresenceBeatTimer = null;
    sarvarcPresenceCursorSeenAt.clear();
    sarvarcPresenceBeatSeenAt.clear();
    if (sarvarcPresenceModuleObserver) { sarvarcPresenceModuleObserver.disconnect(); sarvarcPresenceModuleObserver = null; }
    if (sarvarcPresenceToolTimer) { clearInterval(sarvarcPresenceToolTimer); sarvarcPresenceToolTimer = null; }
    document.querySelectorAll('.sarvarc-nav-here').forEach(el => el.remove());
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

  // =========================================================
  // TEAM ROLES — who is allowed to do what inside a team.
  // Five roles: owner, admin, editor, reviewer, viewer.
  // Old teams may still hold the legacy role "member"; it is treated
  // as "editor" so nobody loses access when this ships.
  // NOTE: these checks only decide what the screen SHOWS. The real
  // enforcement lives in the database (see supabase/01-team-roles.sql).
  // =========================================================
  function sarvarcTeamNormalizeRole(role) {
    const r = String(role || '').toLowerCase();
    if (r === 'member') return 'editor';
    return ['owner', 'admin', 'editor', 'reviewer', 'viewer'].indexOf(r) > -1 ? r : 'viewer';
  }

  function sarvarcTeamCan(action, role) {
    const r = sarvarcTeamNormalizeRole(role === undefined ? sarvarcTeamMyRole : role);
    const allowed = {
      manage_members: ['owner', 'admin'],
      edit: ['owner', 'admin', 'editor'],
      save_version: ['owner', 'admin', 'editor'],
      comment: ['owner', 'admin', 'editor', 'reviewer'],
      approve: ['owner', 'admin', 'reviewer'],
      view: ['owner', 'admin', 'editor', 'reviewer', 'viewer']
    };
    return (allowed[action] || []).indexOf(r) > -1;
  }

  // Roles the current person may hand out when inviting or changing a role.
  function sarvarcTeamAssignableRoles() {
    const mine = sarvarcTeamNormalizeRole(sarvarcTeamMyRole);
    if (mine === 'owner') return ['admin', 'editor', 'reviewer', 'viewer'];
    if (mine === 'admin') return ['editor', 'reviewer', 'viewer'];
    return [];
  }

  // Can I manage THIS person? Owners manage everyone else; admins manage
  // everyone except owners and other admins.
  function sarvarcTeamCanManageMember(targetRole) {
    const mine = sarvarcTeamNormalizeRole(sarvarcTeamMyRole);
    const theirs = sarvarcTeamNormalizeRole(targetRole);
    if (theirs === 'owner') return false;
    if (mine === 'owner') return true;
    return mine === 'admin' && theirs !== 'admin';
  }

  // Escapes text before it goes into HTML. Names, emails and project names
  // come from other people, so they must never be inserted as raw markup.
  function sarvarcTeamEsc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // One-line plain-English description of each role (shown under the invite box).
  function sarvarcTeamRoleBlurb(role) {
    const blurbs = {
      admin: 'Can edit work, and invite or manage editors, reviewers and viewers.',
      editor: 'Can open projects and save new versions. Cannot manage people.',
      reviewer: 'Can open projects and, soon, comment and approve. Cannot save over the team\u2019s work.',
      viewer: 'Can open projects only. Good for clients and managers who just need to look.'
    };
    return blurbs[role] || '';
  }

  function sarvarcTeamInviteRoleHint() {
    const sel = document.getElementById('sarvarcTeamInviteRole');
    const el = document.getElementById('sarvarcTeamInviteHelp');
    if (sel && el) el.textContent = sarvarcTeamRoleBlurb(sel.value);
  }

  // Builds ONE row of the members table. Pure: it only reads what it is given
  // (m = the member, ctx = {youId, onlineIds, avatars}) so it is easy to test
  // and to preview. Uses sarvarcTeamMyRole to decide which controls to show.
  function sarvarcTeamMemberRowHtml(m, ctx) {
    const label = m.full_name || m.email || 'Member';
    const online = ctx.onlineIds.has(m.user_id);
    const isYou = m.user_id === ctx.youId;
    const avatarUrl = ctx.avatars[m.user_id];
    const color = sarvarcCollabColorFor(m.user_id);
    const initials = sarvarcPresenceInitials(label);
    const avatarHtml = avatarUrl
      ? `<img class="sarvarc-team-avatar" src="${sarvarcTeamEsc(avatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sarvarc-team-avatar-fallback',style:'background:${color}',textContent:'${sarvarcTeamEsc(initials)}'}));">`
      : `<div class="sarvarc-team-avatar-fallback" style="background:${color}">${sarvarcTeamEsc(initials)}</div>`;
    const shownRole = sarvarcTeamNormalizeRole(m.role);
    const canManageThis = !isYou && sarvarcTeamCanManageMember(m.role);
    const assignable = sarvarcTeamAssignableRoles();
    const roleCell = canManageThis
      ? `<select class="sarvarc-team-role-select" aria-label="Role for ${sarvarcTeamEsc(label)}" onchange="sarvarcTeamChangeRole('${sarvarcTeamEsc(m.id)}','${sarvarcTeamEsc(m.user_id)}',this.value)">${['admin', 'editor', 'reviewer', 'viewer'].filter(r => assignable.indexOf(r) > -1 || r === shownRole).map(r => `<option value="${r}"${r === shownRole ? ' selected' : ''}${assignable.indexOf(r) === -1 ? ' disabled' : ''}>${r}</option>`).join('')}</select>`
      : `<span class="sarvarc-team-role-badge sarvarc-team-role-${shownRole}">${shownRole}</span>`;
    const ownerBtn = (canManageThis && sarvarcTeamMyRole === 'owner')
      ? `<button type="button" class="sarvarc-team-action-btn" title="Hand the team over to this person" onclick="sarvarcTeamTransferOwner('${sarvarcTeamEsc(m.user_id)}', ${JSON.stringify(label).replace(/"/g, '&quot;')})">Make owner</button>` : '';
    const actions = canManageThis
      ? ownerBtn + `<button type="button" class="sarvarc-team-action-btn danger" onclick="sarvarcTeamRemoveMember('${sarvarcTeamEsc(m.id)}','${sarvarcTeamEsc(m.user_id)}')">Remove</button>`
      : (isYou ? `<button type="button" class="sarvarc-team-action-btn leave" onclick="sarvarcTeamLeave()">Leave</button>` : '');
    return `<div class="sarvarc-team-member-card${isYou ? ' is-you' : ''}" role="row" data-member-user="${sarvarcTeamEsc(m.user_id)}">
      <div class="sarvarc-team-cell-member" role="cell">
        <div class="sarvarc-team-avatar-wrap">${avatarHtml}</div>
        <div class="sarvarc-team-member-info">
          <div class="sarvarc-team-member-name">${sarvarcTeamEsc(label)}${isYou ? '<span class="sarvarc-team-member-you-tag">You</span>' : ''}</div>
          <div class="sarvarc-team-member-email">${sarvarcTeamEsc(m.email || '')}</div>
        </div>
      </div>
      <div class="sarvarc-team-cell-role" role="cell">${roleCell}</div>
      <div class="sarvarc-team-cell-status${online ? ' is-online' : ''}" role="cell"><span class="sarvarc-team-status-dot"></span>${online ? 'Online' : 'Offline'}</div>
      <div class="sarvarc-team-member-actions" role="cell">${actions}</div>
    </div>`;
  }

  // One row of the Team Projects list.
  function sarvarcTeamProjectRowHtml(p, who, when, haveIt) {
    const pid = sarvarcTeamEsc(p.id);
    return `<div class="tm-proj-wrap"><div class="sarvarc-team-project-row">
      <div class="sarvarc-team-project-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <div class="sarvarc-team-project-info">
        <div class="sarvarc-team-project-name">${sarvarcTeamEsc(p.name)}${haveIt ? '' : '<span class="sarvarc-team-project-flag">Not on this device yet</span>'}</div>
        <div class="sarvarc-team-project-meta">Last saved by ${sarvarcTeamEsc(who)}${when ? ' \u00b7 ' + sarvarcTeamEsc(when) : ''}</div>
      </div>
      <div class="tm-proj-actions">
        <button type="button" class="tm-btn tm-btn-quiet" title="Earlier versions you can restore" onclick="sarvarcTeamHistToggle('${pid}')">History</button>
        ${haveIt ? `<button type="button" class="tm-btn tm-btn-quiet" title="Download a .sw backup file" onclick="sarvarcTeamBackupProject('${pid}')">Backup</button>` : ''}
        <button type="button" class="tm-btn sarvarc-team-project-open" onclick="sarvarcTeamProjectOpen('${pid}')">${haveIt ? 'Open' : 'Sync &amp; open'}</button>
      </div>
    </div><div class="tm-hist" id="tmHist_${pid}" hidden></div></div>`;
  }

  // Team diary: records who did what. Best-effort only — if the audit_log
  // table has not been created yet, this silently does nothing so the
  // feature the person is using never breaks because of it.
  async function sarvarcTeamAudit(action, details) {
    try {
      if (!sarvarcTeamActiveId) return;
      const user = await sarvarcTeamGetUser();
      if (!user) return;
      await sarvarcSupabase.from('audit_log').insert({
        team_id: sarvarcTeamActiveId, user_id: user.id, action: action, details: details || {}
      });
    } catch (e) { /* diary is a nice-to-have */ }
  }

  async function sarvarcTeamChangeRole(memberRowId, targetUserId, newRole) {
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    try {
      if (sarvarcTeamAssignableRoles().indexOf(newRole) === -1) {
        sarvarcTeamShowError('You are not allowed to give that role.');
        await sarvarcTeamLoadMembers(sarvarcTeamActiveId);
        return;
      }
      const { error } = await sarvarcSupabase.from('team_members')
        .update({ role: newRole }).eq('id', memberRowId).eq('team_id', sarvarcTeamActiveId);
      if (error) throw error;
      sarvarcTeamAudit('role_changed', { member_user_id: targetUserId, new_role: newRole });
      toast('Role updated', 'success');
      await sarvarcTeamLoadMembers(sarvarcTeamActiveId);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not change role.');
      await sarvarcTeamLoadMembers(sarvarcTeamActiveId);
    }
  }

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
    sarvarcTeamEnsureGoLiveBtn();
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
        team_id: teamId, user_id: user.id, role: (function (r) { r = sarvarcTeamNormalizeRole(r); return r === 'owner' ? 'viewer' : r; })(role),
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
      sw.innerHTML = sarvarcTeamMyTeams.map(t => `<option value="${sarvarcTeamEsc(t.id)}">${sarvarcTeamEsc(t.name)}</option>`).join('');
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
    listEl.innerHTML = '<div class="sarvarc-team-empty">Loading…</div>';
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
      const myRole = sarvarcTeamNormalizeRole((members.find(m => m.user_id === user.id) || {}).role || 'member');
      const canManage = myRole === 'owner' || myRole === 'admin';
      document.getElementById('sarvarcTeamInviteRow').style.display = canManage ? 'block' : 'none';
      sarvarcTeamInviteRoleHint();
      // Cached at module scope (not just this modal) so the top-bar "End Live
      // Session" control — which can render while the Team modal is closed —
      // knows whether the current person is allowed to use it.
      sarvarcTeamMyRole = myRole;
      if (sarvarcCollabDoc) { sarvarcCollabRoles[user.id] = myRole; sarvarcCollabRolesLoaded = true; sarvarcCollabGuardApply(); }
      const roleSel = document.getElementById('sarvarcTeamInviteRole');
      if (roleSel) {
        const ok = sarvarcTeamAssignableRoles();
        Array.prototype.forEach.call(roleSel.options, o => { o.hidden = ok.indexOf(o.value) === -1; o.disabled = ok.indexOf(o.value) === -1; });
        if (ok.indexOf(roleSel.value) === -1) roleSel.value = 'editor';
      }

      const countPill = document.getElementById('sarvarcTeamCountPill');
      if (countPill) { countPill.style.display = 'inline-block'; countPill.textContent = members.length + (members.length === 1 ? ' member' : ' members'); }

      const leaveBtn = document.getElementById('sarvarcTeamLeaveBtn');
      if (leaveBtn) {
        const soleOwner = myRole === 'owner' && members.length > 1;
        leaveBtn.style.opacity = soleOwner ? '0.5' : '1';
        leaveBtn.title = soleOwner ? 'Transfer ownership or remove other members before leaving' : 'Leave this team';
      }

      const rowCtx = { youId: user.id, onlineIds: sarvarcTeamOnlineIds, avatars: avatarsById };
      listEl.innerHTML = members.map(m => sarvarcTeamMemberRowHtml(m, rowCtx)).join('');
      sarvarcTeamMemberCount = members.length;
      sarvarcTeamRenderHero();
      sarvarcTeamLoadPending(teamId);
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
        sarvarcTeamShowError('You\'re the owner — press Make owner on a teammate (or remove everyone else) before you can leave.');
        return;
      }
      const teamName = (sarvarcTeamMyTeams.find(t => t.id === sarvarcTeamActiveId) || {}).name || 'this team';
      if (!confirm(`Leave ${teamName}? You'll lose access to its shared projects unless you're invited back.`)) return;

      // .select() returns the rows actually deleted. Without it, a database
      // rule that blocks the delete fails SILENTLY (no error, nothing
      // deleted) and the person is stuck in the team with no message.
      const { data: gone, error: delErr } = await sarvarcSupabase.from('team_members').delete().eq('id', me.id).select('id');
      if (delErr) throw delErr;
      if (!gone || !gone.length) {
        sarvarcTeamShowError('Could not leave the team: the database did not allow it. Ask the team owner to remove you, and tell the SARVARC developer (the team rules may need updating).');
        return;
      }
      // Tell teammates first (team channel + live room) so our cursor and
      // avatar vanish from their screens at once, then drop out of any live
      // session and stop listening to this team. Nothing of ours is left
      // behind: no live flags, no cached role, no stale "owner" button.
      await sarvarcTeamAnnounceDeparture(sarvarcTeamActiveId, user.id, 'left');
      if (localStorage.getItem('sarvarcLiveCollabTeamId') === sarvarcTeamActiveId || sarvarcCollabIsLive()) sarvarcCollabDisconnect();
      if (sarvarcTeamPresenceChannel) { try { sarvarcSupabase.removeChannel(sarvarcTeamPresenceChannel); } catch (e) {} sarvarcTeamPresenceChannel = null; }
      sarvarcTeamOnlineIds = new Set();
      sarvarcCollabRoles = {}; sarvarcCollabRolesLoaded = false; sarvarcCollabMembership = 'unknown'; sarvarcTeamMyRole = null;
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
    if (!sarvarcTeamCan('manage_members')) { sarvarcTeamShowError('Only owners and admins can invite people.'); return; }
    const roleEl = document.getElementById('sarvarcTeamInviteRole');
    const inviteRole = roleEl ? roleEl.value : 'editor';
    if (sarvarcTeamAssignableRoles().indexOf(inviteRole) === -1) { sarvarcTeamShowError('You are not allowed to invite with that role.'); return; }
    try {
      const user = await sarvarcTeamGetUser();
      const { error } = await sarvarcSupabase.from('team_invites').insert({
        team_id: sarvarcTeamActiveId, email, invited_by: user.id, role: inviteRole
      });
      if (error) throw error;
      sarvarcTeamAudit('member_invited', { email: email, role: inviteRole });
      emailEl.value = '';
      // No email-sending service wired up yet: the invite shows up
      // automatically next time that person logs into SARVARC with
      // this Google account and opens Team.
      sarvarcTeamShowNote(`${email} is added as ${inviteRole}. They see it when they sign in with this email. Press Share to send them the link.`);
      sarvarcTeamLoadPending(sarvarcTeamActiveId);
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
      sarvarcTeamAudit('member_removed', { member_user_id: removedUserId });
      // Tell everyone currently connected — including the removed person's
      // own tab(s) — right now. Sent on the team channel AND on the live
      // room, because everyone inside a live session is certainly on the
      // latter while the team channel may not be up yet for them. The
      // removed person's own browser double-checks with the database before
      // it acts, and a watchdog covers anyone who misses the broadcast.
      if (removedUserId) {
        await sarvarcTeamAnnounceDeparture(teamId, removedUserId, 'removed');
        // Broadcasts never echo back to the sender, so clean OUR screen too:
        // the owner used to keep seeing the removed person's cursor.
        await sarvarcTeamHandleMemberRemoved(teamId, removedUserId, 'removed');
      }
      await sarvarcTeamLoadMembers(teamId);
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not remove member.');
    }
  }

  // Sends 'member-removed' (reason 'removed' by an owner/admin, or 'left' when
  // the person leaves on their own) on every channel teammates may be on.
  async function sarvarcTeamAnnounceDeparture(teamId, userId, reason) {
    const payload = { teamId: teamId, userId: userId, reason: reason };
    const channels = [sarvarcTeamPresenceChannel, sarvarcCollabChannel].filter(Boolean);
    await Promise.all(channels.map(async (ch) => {
      try { await ch.send({ type: 'broadcast', event: 'member-removed', payload: payload }); }
      catch (e) { console.warn('[Team] could not broadcast departure', e); }
    }));
  }

  // Asks the database (never trusts a broadcast on its own) whether we are
  // still on the team. 'removed' only after two empty answers, so a database
  // that is a moment behind the broadcast cannot throw anyone out.
  async function sarvarcTeamConfirmRemoved(teamId) {
    for (let i = 0; i < 2; i++) {
      try {
        const user = await sarvarcTeamGetUser();
        if (!user) return 'unknown';
        const { data, error } = await sarvarcSupabase.from('team_members')
          .select('id').eq('team_id', teamId).eq('user_id', user.id).limit(1);
        if (error) return 'unknown';
        if (data && data.length) return 'member';
      } catch (e) { return 'unknown'; }
      if (i === 0) await new Promise(r => setTimeout(r, 1500));
    }
    return 'removed';
  }

  // The single exit path for "you are no longer on this team": used by the
  // removal broadcast, the membership watchdog and the connect gate. It
  // leaves the live room (with a goodbye so nobody keeps our cursor), forgets
  // every live flag so a reload cannot rejoin, drops the team channel and
  // every cached role, and refreshes the Teams window.
  // The content already on screen stays as the person's own local copy —
  // the same thing that happens when someone leaves a live session.
  async function sarvarcTeamEvictSelf(teamId, reason) {
    if (sarvarcCollabEvicting) return;
    sarvarcCollabEvicting = true;
    try {
      const user = await sarvarcTeamGetUser();
      const liveTeam = localStorage.getItem('sarvarcLiveCollabTeamId');
      if (!teamId || !liveTeam || liveTeam === teamId) {
        sarvarcCollabDisconnect(); // goodbye + clears the live flags
        SARVARC_LIVE_FLAGS.forEach(k => localStorage.removeItem(k));
      }
      sarvarcCollabRoles = {};
      sarvarcCollabRolesLoaded = false;
      sarvarcCollabMembership = 'unknown';
      sarvarcTeamMyRole = null;
      if (sarvarcTeamPresenceChannel) {
        try { sarvarcSupabase.removeChannel(sarvarcTeamPresenceChannel); } catch (e) {}
        sarvarcTeamPresenceChannel = null;
      }
      sarvarcTeamOnlineIds = new Set();
      const inviteBar = document.getElementById('sarvarcLiveInviteBar');
      if (inviteBar) inviteBar.remove();
      if (!teamId || teamId === sarvarcTeamActiveId) sarvarcTeamActiveId = null;
      sarvarcTeamCloseModal();
      toast(reason === 'removed' ? "You've been removed from this team. The live session was closed." : 'You left the team.', reason === 'removed' ? 'error' : 'info');
      if (user) await sarvarcTeamLoadMyTeams(user); // restarts presence for any team you still belong to
    } finally {
      sarvarcCollabEvicting = false;
    }
  }

  // Reacts to a 'member-removed' broadcast (team channel or live room).
  // Fires on EVERY currently-connected client, including the removed
  // person's own tab — that's the point: no polling, no waiting.
  async function sarvarcTeamHandleMemberRemoved(teamId, removedUserId, reason) {
    const user = await sarvarcTeamGetUser();
    if (!user || !removedUserId) return;
    const liveTeam = localStorage.getItem('sarvarcLiveCollabTeamId');
    if (teamId && teamId !== sarvarcTeamActiveId && teamId !== liveTeam) return; // another team's news
    const nowMs = Date.now();
    const last = sarvarcTeamRecentDepartures.get(removedUserId) || 0;
    if (nowMs - last < 3000) return;
    sarvarcTeamRecentDepartures.set(removedUserId, nowMs);

    if (user.id === removedUserId) {
      // We are the one being removed. A broadcast alone cannot throw us out
      // (any teammate could send one); the database has the last word.
      const verdict = await sarvarcTeamConfirmRemoved(teamId || sarvarcTeamActiveId || liveTeam);
      if (verdict === 'removed') await sarvarcTeamEvictSelf(teamId || sarvarcTeamActiveId || liveTeam, 'removed');
      else sarvarcTeamRecentDepartures.delete(removedUserId);
      return;
    }

    // Someone else left or was removed: wipe every trace of them right now —
    // cached role (so a stale tab of theirs can no longer merge edits),
    // heartbeat/cursor bookkeeping, their awareness state and cursor element —
    // then let the database re-confirm the roster. If the broadcast was
    // forged and they are still a member, the refresh puts them straight back.
    delete sarvarcCollabRoles[removedUserId];
    delete sarvarcTeamMembersCache[removedUserId];
    sarvarcPresenceBeatSeenAt.delete(removedUserId);
    sarvarcPresenceCursorSeenAt.delete(removedUserId);
    if (sarvarcCollabAwareness && window.YAwareness) {
      const staleClientIds = [];
      sarvarcCollabAwareness.getStates().forEach((state, clientId) => {
        if (state && state.userId === removedUserId) staleClientIds.push(clientId);
      });
      // Origin 'remote' on purpose: every teammate does this locally, so we
      // must not re-broadcast it (that would be N identical packets).
      if (staleClientIds.length) window.YAwareness.removeAwarenessStates(sarvarcCollabAwareness, staleClientIds, 'remote');
    }
    const cursorEl = document.getElementById('sarvarc-cursor-' + removedUserId);
    if (cursorEl) cursorEl.remove();
    sarvarcPresenceRender();
    if (sarvarcCollabIsLive()) {
      await sarvarcCollabLoadRoles(sarvarcTeamActiveId || liveTeam);
      sarvarcPresenceRender();
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
  // Anyone (any role) can step out of a live session for THEMSELVES. The
  // others keep working. Your copy stays on your screen as a normal,
  // separate workspace. Clearing the flags also stops the auto-reconnect
  // that would otherwise pull you back in on the next reload.
  function sarvarcTeamLeaveLiveSession() {
    if (!localStorage.getItem('sarvarcLiveCollabTeamProjectId') && !sarvarcCollabIsLive()) {
      toast('You are not in a live session.', 'info');
      return;
    }
    if (!confirm('Leave this live session?\n\nYou will stop seeing teammates\' changes and they will stop seeing yours. Your copy stays on your screen as your own workspace.')) return;
    sarvarcCollabDisconnect();
    toast('You left the live session. You are on your own workspace.', 'info');
  }

  async function sarvarcTeamEndLiveSession() {
    const teamProjectId = localStorage.getItem('sarvarcLiveCollabTeamProjectId');
    if (!teamProjectId) { toast('No live session is currently open.', 'info'); return; }
    if (sarvarcTeamMyRole !== 'owner') { sarvarcTeamShowError('Only the team owner can end a live session.'); return; }
    if (!confirm('End this live session for everyone?\n\nEveryone currently connected will be dropped back to their own separate workspace. Nothing is deleted, but any edits not yet saved to the team won\'t be kept in the shared copy.')) return;

    const teamId = sarvarcTeamActiveId || localStorage.getItem('sarvarcLiveCollabTeamId');
    sarvarcTeamAudit('live_ended', { project_id: teamProjectId });
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
        const ov = document.getElementById('sarvarcTeamOverlay');
        if (ov && ov.classList.contains('open')) sarvarcTeamLoadMembers(teamId); // only refetch while the Teams window is open (less lag)
      });
      channel.on('broadcast', { event: 'member-removed' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleMemberRemoved(payload.teamId, payload.userId, payload.reason);
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
      channel.on('broadcast', { event: 'live-invite' }, ({ payload }) => {
        if (!payload) return;
        sarvarcTeamHandleLiveInvite(payload);
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
    listEl.innerHTML = '<div class="sarvarc-team-empty">Loading…</div>';
    try {
      const { data: rows, error } = await sarvarcSupabase
        .from('team_projects')
        .select('id, name, updated_at, updated_by')
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) {
        listEl.innerHTML = '<div class="sarvarc-team-empty">No shared projects yet. Press Go live and your current work is shared automatically.</div>';
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
        return sarvarcTeamProjectRowHtml(p, who, when, localIds.has(p.id));
      }).join('');
    } catch (e) {
      listEl.innerHTML = '';
      sarvarcTeamShowError(e.message || 'Could not load team projects.');
    }
  }

  async function sarvarcTeamProjectSave(opts) {
    if (!sarvarcTeamActiveId) return;
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    if (!sarvarcTeamCan('save_version')) { sarvarcTeamShowError('Your role is view and comment only. Ask an owner or admin for editor access to save work to the team.'); return; }
    const name = (opts && opts.name) || prompt('Name this project for your team:', (typeof smDefaultName === 'function' ? smDefaultName() : 'Project'));
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
      window.sarvarcLastDriveMirror = null;
      try {
        if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
          rec.driveFileId = await sarvarcDriveSaveSession(rec);
          window.sarvarcLastDriveMirror = { ok: true, at: Date.now() };
          await new Promise((resolve) => {
            const tx2 = db.transaction('sessions', 'readwrite');
            tx2.objectStore('sessions').put(rec);
            tx2.oncomplete = resolve;
            tx2.onerror = () => resolve();
          });
        }
      } catch (e) { console.warn('[Team] Drive mirror (tagged) skipped', e); window.sarvarcLastDriveMirror = { ok: false, at: Date.now() }; }

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
      // Live relay has a message size ceiling (about 250 KB on the free
      // Supabase plan). Tell the person plainly instead of failing quietly.
      try {
        const kb = Math.round(JSON.stringify(rec).length / 1024);
        if (kb > 240 && typeof toast === 'function') toast('This project is large (' + kb + ' KB). Teammates may not receive it live. If Join fails for them, send a .sw file instead.', 'error');
      } catch (e) {}
      if (sarvarcTeamPresenceChannel) {
        try {
          await sarvarcTeamPresenceChannel.send({
            type: 'broadcast', event: 'team-project-push',
            payload: { teamId: sarvarcTeamActiveId, rec }
          });
        } catch (e) { console.warn('[Team] could not live-push project', e); }
      }

      const dm = window.sarvarcLastDriveMirror;
      if (dm && dm.ok) toast('Saved to team and backed up to your Google Drive', 'success');
      else if (dm && !dm.ok) toast('Saved to team, but the Google Drive backup failed. Your work is safe on this device. Try again in a minute.', 'error');
      else toast('Saved to team on this device. Connect Google Drive to keep a backup.', 'info');
      sarvarcTeamShowNote('Saved to team.');
      sarvarcTeamAudit('project_saved', { project_id: rec.id, name: name });
      await sarvarcTeamVersionSave(rec, 'saved', true);
      sarvarcTeamRenderHero();
      if (document.getElementById('smSessionList')) smRenderList();
      await sarvarcTeamProjectsLoad(sarvarcTeamActiveId);
      return rec;
    } catch (e) {
      sarvarcTeamShowError(e.message || 'Could not save to team.');
    }
  }


  // =========================================================
  // ONE-CLICK SHARE + GO LIVE
  // Person A presses "Share & go live": the project is saved to the team,
  // pushed to everyone online, and a live invite pops up on their screens.
  // Person B presses "Join" and lands inside the same live project.
  // No exporting, no uploading, no picking from a list.
  // =========================================================
  async function sarvarcTeamGoLive() {
    if (!sarvarcTeamActiveId) { sarvarcTeamShowError('Pick a team first.'); return; }
    if (!sarvarcTeamCan('save_version')) { sarvarcTeamShowError('Your role is view and comment only. Ask an owner or admin for editor access to start a live session.'); return; }
    if (localStorage.getItem('sarvarcLiveCollabTeamProjectId')) { sarvarcTeamShowError('You are already in a live session. Press Leave in the top bar first.'); return; }
    const dflt = (typeof smDefaultName === 'function' ? smDefaultName() : 'Project');
    const rec = await sarvarcTeamProjectSave({ name: dflt });
    if (!rec) return; // save already showed its own error
    const user = await sarvarcTeamGetUser();
    const byName = (user && sarvarcTeamMembersCache[user.id] && sarvarcTeamMembersCache[user.id].full_name) || (user && user.email) || 'A teammate';
    if (sarvarcTeamPresenceChannel) {
      try {
        await sarvarcTeamPresenceChannel.send({ type: 'broadcast', event: 'live-invite', payload: { teamId: sarvarcTeamActiveId, teamProjectId: rec.id, name: rec.name, byName: byName } });
      } catch (e) { console.warn('[Team] could not send live invite', e); }
    }
    // Same proven path teammates use: mark live, then reload into the project.
    localStorage.setItem('sarvarcLiveCollabTeamProjectId', rec.id);
    localStorage.setItem('sarvarcLiveCollabTeamId', sarvarcTeamActiveId);
    localStorage.setItem('sarvarcLiveCollabSessionId', rec.id);
    sarvarcTeamAudit('live_started', { project_id: rec.id, name: rec.name });
    sarvarcTeamCloseModal();
    toast('Live session started. Teammates online can join now.', 'success');
    await smLoadSession(rec.id);
  }

  // A teammate started a live session: show a Join banner on every online
  // member's screen. Built with DOM calls (not HTML strings) so a project
  // or person name can never inject markup.
  function sarvarcTeamHandleLiveInvite(p) {
    if (!p || !p.teamProjectId) return;
    if (localStorage.getItem('sarvarcLiveCollabTeamProjectId') === p.teamProjectId) return;
    const old = document.getElementById('sarvarcLiveInviteBar');
    if (old) old.remove();
    const bar = document.createElement('div');
    bar.id = 'sarvarcLiveInviteBar';
    bar.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:950;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:var(--bg2,#1b2330);color:var(--text,#e6edf3);border:1px solid var(--pdfed-section-border,rgba(255,255,255,.12));box-shadow:0 10px 30px rgba(0,0,0,.30);font-size:13px;max-width:92vw;';
    const msg = document.createElement('span');
    msg.textContent = (p.byName || 'A teammate') + ' started a live session: ' + (p.name || 'Project');
    const join = document.createElement('button');
    join.type = 'button'; join.textContent = 'Join';
    join.style.cssText = 'padding:7px 16px;border-radius:8px;border:0;background:#3F7FC8;color:#fff;font-weight:600;cursor:pointer;';
    join.addEventListener('click', () => sarvarcTeamJoinLive(p.teamId, p.teamProjectId));
    const no = document.createElement('button');
    no.type = 'button'; no.textContent = '\u00d7'; no.title = 'Dismiss';
    no.style.cssText = 'background:none;border:0;color:inherit;font-size:18px;cursor:pointer;';
    no.addEventListener('click', () => bar.remove());
    bar.appendChild(msg); bar.appendChild(join); bar.appendChild(no);
    document.body.appendChild(bar);
  }

  async function sarvarcTeamJoinLive(teamId, teamProjectId) {
    const bar = document.getElementById('sarvarcLiveInviteBar');
    if (bar) bar.remove();
    if (localStorage.getItem('sarvarcLiveCollabTeamProjectId')) { toast('You are already in a live session. Press Leave first.', 'info'); return; }
    sarvarcTeamActiveId = teamId;
    toast('Joining the live session\u2026', 'info');
    await sarvarcTeamProjectOpen(teamProjectId);
  }

  // Start listening to your team as soon as you are signed in, so live
  // invites reach you without opening the Teams window first.
  async function sarvarcTeamAutoStartPresence() {
    try {
      if (sarvarcTeamPresenceChannel) return;
      const user = await sarvarcTeamGetUser();
      if (!user) return;
      const { data } = await sarvarcSupabase.from('team_members').select('team_id').eq('user_id', user.id).limit(1);
      if (data && data[0] && !sarvarcTeamPresenceChannel) {
        sarvarcTeamActiveId = sarvarcTeamActiveId || data[0].team_id;
        sarvarcTeamStartPresence(sarvarcTeamActiveId);
      }
    } catch (e) { /* not signed in yet, or no team: nothing to do */ }
  }
  setTimeout(sarvarcTeamAutoStartPresence, 3000);
  setTimeout(sarvarcTeamAutoStartPresence, 10000);

  // ---- Team window hero: Go live + Share, and the calm live status ----
  // The buttons themselves live in workspace.html (#sarvarcTeamHero). This
  // only decides which ones to show and what the one-line status says.
  // Name kept so sarvarcTeamOpenModal() keeps calling it.
  let sarvarcTeamMemberCount = 0;
  function sarvarcTeamEnsureGoLiveBtn() { sarvarcTeamRenderHero(); }

  function sarvarcTeamRenderHero() {
    const hero = document.getElementById('sarvarcTeamHero');
    if (!hero) return;
    const live = !!localStorage.getItem('sarvarcLiveCollabTeamProjectId') || sarvarcCollabIsLive();
    const others = Math.max(0, (sarvarcTeamOnlineIds ? sarvarcTeamOnlineIds.size : 0) - 1);
    const canGoLive = sarvarcTeamCan('save_version');
    const title = document.getElementById('sarvarcTeamHeroTitle');
    const sub = document.getElementById('sarvarcTeamHeroSub');
    const goBtn = document.getElementById('sarvarcTeamGoLiveBtn');
    const leaveBtn = document.getElementById('sarvarcTeamLeaveLiveBtn');
    const endBtn = document.getElementById('sarvarcTeamEndLiveBtn');
    const onl = document.getElementById('sarvarcTeamHeroOnline');
    hero.classList.toggle('is-live', live);
    if (title) title.textContent = live ? 'You are live' : 'Work on this file together, live';
    if (sub) {
      if (live) sub.textContent = others > 0
        ? (others === 1 ? '1 teammate is here with you.' : others + ' teammates are here with you.')
        : 'Waiting for teammates. Press Share to invite them.';
      else if (!canGoLive) sub.textContent = 'Your role can open live sessions but not start them. Ask an owner or admin for editor access.';
      else if (sarvarcTeamMemberCount <= 1) sub.textContent = 'Add a teammate below, then press Go live. They get a Join button the moment you start.';
      else if (others > 0) sub.textContent = (others === 1 ? '1 teammate is online now.' : others + ' teammates are online now.') + ' Go live and they can join with one tap.';
      else sub.textContent = 'Nobody else is online yet. Teammates who open SARVARC later will see a Join button.';
    }
    if (goBtn) { goBtn.style.display = live ? 'none' : ''; goBtn.disabled = !canGoLive; goBtn.title = canGoLive ? 'Saves your current work to the team and invites everyone online' : 'Ask an owner or admin for editor access'; }
    if (leaveBtn) leaveBtn.style.display = live ? '' : 'none';
    const bk = document.getElementById('sarvarcTeamBackupBtn');
    if (bk) bk.style.display = live ? '' : 'none';
    const act = document.getElementById('sarvarcTeamActivityBox');
    if (act) act.style.display = (sarvarcTeamMyRole === 'owner' || sarvarcTeamMyRole === 'admin') ? '' : 'none';
    if (endBtn) endBtn.style.display = (live && sarvarcTeamMyRole === 'owner') ? '' : 'none';
    sarvarcTeamRenderSaveLine(live);
    if (onl) {
      // Small stack of who is online right now (initials only, no colour fuss).
      const ids = Array.from(sarvarcTeamOnlineIds || []).slice(0, 5);
      onl.innerHTML = ids.map(id => {
        const m = sarvarcTeamMembersCache[id] || {};
        return '<span class="tm-dot-person" title="' + sarvarcTeamEsc(m.full_name || m.email || 'Online') + '">' + sarvarcTeamEsc(sarvarcPresenceInitials(m.full_name || m.email || '?')) + '</span>';
      }).join('');
      onl.style.display = ids.length ? 'flex' : 'none';
    }
  }

  // One calm line: when the work was last saved and whether Drive has a copy.
  let sarvarcTeamLastSaveAt = 0;
  async function sarvarcTeamRenderSaveLine(live) {
    const el = document.getElementById('sarvarcTeamHeroSave');
    if (!el) return;
    const dm = window.sarvarcLastDriveMirror;
    let drive = false;
    try { drive = typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable(); } catch (e) {}
    let text = '', warn = false;
    if (!drive) { text = 'Google Drive is not connected. Work is saved on this device only.'; warn = true; }
    else if (dm && dm.ok === false) { text = 'Drive backup failed. Your work is safe on this device and will retry.'; warn = true; }
    else if (live && sarvarcTeamLastSaveAt) { text = 'Saved ' + new Date(sarvarcTeamLastSaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' and backed up to Drive.'; }
    else if (live) { text = 'Saves automatically every 3 minutes and when you leave.'; }
    else { text = ''; }
    el.textContent = text;
    if (!drive) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tm-link-btn'; b.textContent = 'Reconnect Drive';
      b.onclick = sarvarcTeamReconnectDrive;
      el.appendChild(b);
    }
    el.classList.toggle('is-warn', warn);
    el.style.display = text ? 'flex' : 'none';
  }

  // Google hands out the Drive key for about an hour and the browser drops it
  // on reload, even though you stay signed in. One click asks Google for a new one.
  async function sarvarcTeamReconnectDrive() {
    try {
      const { data: { session } } = await sarvarcSupabase.auth.getSession();
      const email = session && session.user && session.user.email;
      const tok = await sarvarcSilentDriveTokenRefresh(email, { userInitiated: true });
      if (tok) { toast('Google Drive reconnected', 'success'); sarvarcTeamRenderHero(); return; }
    } catch (e) { console.warn('[Team] Drive reconnect failed', e); }
    toast('Could not reconnect. Sign out, then sign in with Google again and allow Drive access.', 'error');
  }

  // Autosave while live: every 3 minutes, when the tab is hidden, and when the
  // page closes. Updates the SAME project in place (no pile of copies) and
  // mirrors it to the member's own Drive. Skipped for roles that cannot save.
  let sarvarcTeamAutosaveBusy = false;
  async function sarvarcTeamAutosaveNow() {
    const sid = localStorage.getItem('sarvarcLiveCollabSessionId');
    if (!sid || !localStorage.getItem('sarvarcLiveCollabTeamProjectId')) return;
    if (sarvarcTeamAutosaveBusy || typeof smUpdateSessionSnapshot !== 'function') return;
    try { if (!sarvarcTeamCan('save_version')) return; } catch (e) { return; }
    sarvarcTeamAutosaveBusy = true;
    try {
      const rec = await smUpdateSessionSnapshot(sid);
      if (rec) { sarvarcTeamLastSaveAt = Date.now(); sarvarcTeamRenderSaveLine(true); sarvarcTeamVersionSave(rec, 'autosave', false); }
    } catch (e) { console.warn('[Team] autosave skipped', e); }
    finally { sarvarcTeamAutosaveBusy = false; }
  }
  setInterval(() => { if (document.visibilityState === 'visible') sarvarcTeamAutosaveNow(); }, 180000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sarvarcTeamAutosaveNow(); });
  window.addEventListener('pagehide', () => { sarvarcTeamAutosaveNow(); });

  // Share: one tap to send teammates a link. Uses the phone/desktop share
  // sheet when there is one, otherwise copies the message to the clipboard.
  // Joining still needs the person to be added to the team (Add a teammate),
  // because the team's door is the invited email, so we say that plainly.
  async function sarvarcTeamShare() {
    const team = (sarvarcTeamMyTeams.find(t => t.id === sarvarcTeamActiveId) || {}).name || 'my team';
    const url = location.origin + location.pathname;
    const live = !!localStorage.getItem('sarvarcLiveCollabTeamProjectId');
    const text = live
      ? 'I am live in "' + team + '" on SARVARC Workspace. Open the link, sign in with Google, then tap Join.'
      : 'Join "' + team + '" on SARVARC Workspace. Open the link and sign in with Google.';
    if (navigator.share) {
      try { await navigator.share({ title: 'SARVARC Workspace', text: text, url: url }); sarvarcTeamShareFollowUp(false); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    let ok = false;
    try { await navigator.clipboard.writeText(text + ' ' + url); ok = true; } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text + ' ' + url; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e2) {}
    }
    if (ok) { toast('Link copied. Paste it in WhatsApp, email or chat.', 'success'); sarvarcTeamShareFollowUp(true); }
    else sarvarcTeamShowError('Could not copy the link. Select the address bar and copy it instead.');
  }

  function sarvarcTeamShareFollowUp(copied) {
    sarvarcTeamShowNote((copied ? 'Link copied. ' : 'Link shared. ') + 'To let someone in, add their email under Add a teammate.');
    const row = document.getElementById('sarvarcTeamInviteRow');
    const em = document.getElementById('sarvarcTeamInviteEmail');
    if (row && row.style.display !== 'none' && em) { try { em.scrollIntoView({ block: 'center', behavior: 'smooth' }); em.focus({ preventScroll: true }); } catch (e) {} }
  }

  // People who were added but have not accepted yet. Best effort: if the
  // table cannot be read, nothing is shown and nothing breaks.
  async function sarvarcTeamLoadPending(teamId) {
    const box = document.getElementById('sarvarcTeamPendingList');
    if (!box) return;
    try {
      const { data, error } = await sarvarcSupabase.from('team_invites').select('email, role, status').eq('team_id', teamId).eq('status', 'pending');
      if (error || !data || !data.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = '<div class="tm-pending-title">Waiting to join</div>' + data.map(i =>
        '<div class="tm-pending-row"><span class="tm-pending-mail">' + sarvarcTeamEsc(i.email) + '</span><span class="sarvarc-team-role-badge sarvarc-team-role-' + sarvarcTeamNormalizeRole(i.role) + '">' + sarvarcTeamEsc(sarvarcTeamNormalizeRole(i.role)) + '</span></div>').join('');
      box.style.display = 'block';
    } catch (e) { box.style.display = 'none'; }
  }

  // =========================================================
  // SAFETY NET: restore points, activity log, backups, ownership.
  // Restore points live in their own small browser database (kept apart from
  // the app's normal storage so they never end up inside saved projects) and
  // are mirrored to the member's OWN Google Drive. Nothing is stored on a
  // SARVARC server except short activity lines (who did what, when).
  // =========================================================
  const SARVARC_VERSIONS_KEEP = 10;
  const SARVARC_VERSION_MIN_GAP_MS = 5 * 60 * 1000;
  const SARVARC_VERSIONS_FOLDER = 'SARVARC Versions';
  let sarvarcVersionsDriveFolderId = null;

  function sarvarcVerDbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('sarvarcVersions__' + (window.__sarvarcUid || 'guest'), 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('v')) req.result.createObjectStore('v'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function sarvarcVerGet(key) {
    const db = await sarvarcVerDbOpen();
    return new Promise((res, rej) => { const r = db.transaction('v', 'readonly').objectStore('v').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function sarvarcVerPut(key, val) {
    const db = await sarvarcVerDbOpen();
    return new Promise((res, rej) => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function sarvarcVerDel(key) {
    const db = await sarvarcVerDbOpen();
    return new Promise((res) => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').delete(key); tx.oncomplete = res; tx.onerror = res; });
  }

  async function sarvarcDriveEnsureVersionsFolder() {
    if (sarvarcVersionsDriveFolderId) return sarvarcVersionsDriveFolderId;
    const parentId = await sarvarcDriveEnsureFolder();
    const q = encodeURIComponent("name='" + SARVARC_VERSIONS_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and '" + parentId + "' in parents and trashed=false");
    const listRes = await sarvarcDriveFetch('files?q=' + q + '&fields=files(id,name)&spaces=drive');
    const listData = await listRes.json();
    if (listData.files && listData.files.length) { sarvarcVersionsDriveFolderId = listData.files[0].id; return sarvarcVersionsDriveFolderId; }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_VERSIONS_FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!createRes.ok) throw new Error('DRIVE_VERSIONS_FOLDER_' + createRes.status);
    sarvarcVersionsDriveFolderId = (await createRes.json()).id;
    return sarvarcVersionsDriveFolderId;
  }

  async function sarvarcDriveSaveVersionFile(pid, at, rec) {
    const folderId = await sarvarcDriveEnsureVersionsFolder();
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const meta = { name: pid + '__' + at + '.json', parents: [folderId], appProperties: { sarvarcVersionOf: pid, sarvarcVersionAt: String(at) } };
    const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    });
    if (!start.ok) throw new Error('DRIVE_VERSION_START_' + start.status);
    const url = start.headers.get('Location');
    if (!url) throw new Error('DRIVE_VERSION_NO_URL');
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
    if (!put.ok) throw new Error('DRIVE_VERSION_' + put.status);
    return (await put.json()).id;
  }

  // Keep a restore point of a team project. reason: 'saved' | 'autosave' | 'before_restore'.
  // Autosaves are spaced at least 5 minutes apart; everything else is always kept.
  // Only the newest 10 are kept (older ones are removed here and from Drive).
  async function sarvarcTeamVersionSave(rec, reason, force) {
    try {
      if (!rec || !rec.id) return;
      const pid = rec.id;
      const idx = (await sarvarcVerGet('idx:' + pid)) || [];
      const now = Date.now();
      if (!force && idx[0] && now - idx[0].at < SARVARC_VERSION_MIN_GAP_MS) return;
      const user = await sarvarcTeamGetUser();
      const m = user && sarvarcTeamMembersCache[user.id];
      const byName = (m && (m.full_name || m.email)) || (user && user.email) || 'Someone';
      await sarvarcVerPut('body:' + pid + ':' + now, rec);
      const meta = { at: now, byName: byName, reason: reason || 'saved', name: rec.name || 'Project', size: rec.size || 0, driveFileId: null };
      idx.unshift(meta);
      while (idx.length > SARVARC_VERSIONS_KEEP) {
        const old = idx.pop();
        await sarvarcVerDel('body:' + pid + ':' + old.at);
        if (old.driveFileId) { try { await sarvarcDriveFetch('files/' + old.driveFileId, { method: 'DELETE' }); } catch (e) {} }
      }
      await sarvarcVerPut('idx:' + pid, idx);
      // Drive copy (best effort). Failure never blocks the save.
      try {
        if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
          meta.driveFileId = await sarvarcDriveSaveVersionFile(pid, now, rec);
          await sarvarcVerPut('idx:' + pid, idx);
        }
      } catch (e) { console.warn('[Team] version Drive copy skipped', e); }
      if (reason !== 'autosave') sarvarcTeamAudit('version_saved', { project_id: pid, name: rec.name });
    } catch (e) { console.warn('[Team] version save skipped', e); }
  }

  // Restore points for one project: this device's list, plus any extra ones
  // found in the member's own Drive (covers a wiped browser).
  async function sarvarcTeamVersionList(pid) {
    const local = (await sarvarcVerGet('idx:' + pid).catch(() => null)) || [];
    const out = local.map(v => Object.assign({ source: 'device' }, v));
    try {
      if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
        const folderId = await sarvarcDriveEnsureVersionsFolder();
        const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false and appProperties has { key='sarvarcVersionOf' and value='" + pid + "' }");
        const r = await sarvarcDriveFetch('files?q=' + q + '&fields=files(id,appProperties)&pageSize=50&spaces=drive');
        const d = await r.json();
        (d.files || []).forEach(f => {
          const at = Number(f.appProperties && f.appProperties.sarvarcVersionAt);
          if (!at || out.some(v => v.at === at)) return;
          out.push({ at: at, byName: '', reason: 'saved', name: '', source: 'drive', driveFileId: f.id });
        });
      }
    } catch (e) { /* Drive optional */ }
    return out.sort((a, b) => b.at - a.at).slice(0, SARVARC_VERSIONS_KEEP);
  }

  async function sarvarcTeamVersionLoadRec(pid, v) {
    const body = await sarvarcVerGet('body:' + pid + ':' + v.at).catch(() => null);
    if (body) return body;
    if (v.driveFileId) return await sarvarcDriveLoadSession(v.driveFileId);
    return null;
  }

  function sarvarcTeamVersionLabel(v) {
    const d = new Date(v.at);
    const day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const why = v.reason === 'autosave' ? 'Autosave' : (v.reason === 'before_restore' ? 'Before a restore' : 'Saved');
    return day + ' ' + t + ' \u00b7 ' + why + (v.byName ? ' \u00b7 ' + v.byName : '');
  }

  async function sarvarcTeamHistToggle(pid) {
    const el = document.getElementById('tmHist_' + pid);
    if (!el) return;
    if (!el.hidden) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<div class="tm-hist-empty">Loading restore points\u2026</div>';
    const list = await sarvarcTeamVersionList(pid);
    const canRestore = sarvarcTeamMyRole === 'owner' || sarvarcTeamMyRole === 'admin';
    if (!list.length) { el.innerHTML = '<div class="tm-hist-empty">No restore points yet. One is kept every time you save, and every few minutes while you are live.</div>'; return; }
    el.innerHTML = list.map(v =>
      '<div class="tm-hist-row"><span class="tm-hist-label">' + sarvarcTeamEsc(sarvarcTeamVersionLabel(v)) + '</span><span class="tm-hist-actions">' +
      (canRestore ? '<button type="button" class="tm-btn tm-btn-quiet" onclick="sarvarcTeamVersionRestore(\'' + sarvarcTeamEsc(pid) + '\',' + v.at + ')">Restore</button>' : '') +
      '<button type="button" class="tm-btn tm-btn-quiet" onclick="sarvarcTeamVersionDownload(\'' + sarvarcTeamEsc(pid) + '\',' + v.at + ')">Download .sw</button></span></div>'
    ).join('') + (canRestore ? '' : '<div class="tm-hist-empty">Only owners and admins can restore.</div>');
  }

  async function sarvarcTeamVersionRestore(pid, at) {
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    try {
      if (sarvarcTeamMyRole !== 'owner' && sarvarcTeamMyRole !== 'admin') { sarvarcTeamShowError('Only owners and admins can restore a version.'); return; }
      if (localStorage.getItem('sarvarcLiveCollabTeamProjectId') === pid) { sarvarcTeamShowError('Press Leave live first, then restore. Restoring while the project is live would be overwritten by everyone still in it.'); return; }
      const list = await sarvarcTeamVersionList(pid);
      const v = list.find(x => x.at === at);
      if (!v) { sarvarcTeamShowError('That restore point is no longer available.'); return; }
      if (!confirm('Restore the version from ' + sarvarcTeamVersionLabel(v) + '?\n\nThe current copy on this device is replaced. A safety copy of it is kept in the history first.\nDo this when nobody else is live in this project.')) return;
      const verRec = await sarvarcTeamVersionLoadRec(pid, v);
      if (!verRec || !verRec.snapshot) { sarvarcTeamShowError('Could not read that restore point.'); return; }
      const current = (typeof smGetSession === 'function') ? await smGetSession(pid) : null;
      if (current) await sarvarcTeamVersionSave(current, 'before_restore', true);
      const restored = Object.assign({}, verRec, { id: pid, savedAt: Date.now(), driveFileId: (current && current.driveFileId) || undefined });
      const db = await idbKvOpen();
      await new Promise((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(restored); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      try {
        if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
          restored.driveFileId = await sarvarcDriveSaveSession(restored);
          await new Promise((resolve) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(restored); tx.oncomplete = resolve; tx.onerror = () => resolve(); });
        }
      } catch (e) { console.warn('[Team] restore Drive mirror skipped', e); }
      sarvarcTeamAudit('version_restored', { project_id: pid, name: restored.name, version_at: at });
      sarvarcTeamShowNote('Restored. Press Open on the project to continue from that version.');
      toast('Version restored on this device', 'success');
      if (document.getElementById('smSessionList') && typeof smRenderList === 'function') smRenderList();
      sarvarcTeamHistToggle(pid); sarvarcTeamHistToggle(pid);
    } catch (e) { sarvarcTeamShowError(e.message || 'Could not restore that version.'); }
  }

  async function sarvarcTeamDownloadRecAsSW(rec) {
    const bytes = await smBuildSWBytes(rec);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = sarvarcBrandFilename(smSanitizeFileNamePart(rec.name || 'project') + '.sw');
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  async function sarvarcTeamVersionDownload(pid, at) {
    try {
      const list = await sarvarcTeamVersionList(pid);
      const v = list.find(x => x.at === at);
      const rec = v && await sarvarcTeamVersionLoadRec(pid, v);
      if (!rec) { sarvarcTeamShowError('Could not read that restore point.'); return; }
      await sarvarcTeamDownloadRecAsSW(Object.assign({}, rec, { name: (rec.name || 'project') + ' ' + new Date(at).toISOString().slice(0, 16).replace('T', ' ') }));
      sarvarcTeamAudit('backup_downloaded', { project_id: pid, name: rec.name, version_at: at });
    } catch (e) { sarvarcTeamShowError('Could not create the .sw file.'); }
  }

  // Download backup of a project (refreshes it first if you are live in it).
  async function sarvarcTeamBackupProject(pid) {
    sarvarcTeamShowError('');
    try {
      pid = pid || localStorage.getItem('sarvarcLiveCollabSessionId');
      if (!pid) { sarvarcTeamShowError('Open or start a project first.'); return; }
      if (pid === localStorage.getItem('sarvarcLiveCollabSessionId') && typeof smUpdateSessionSnapshot === 'function') { try { await smUpdateSessionSnapshot(pid); } catch (e) {} }
      const rec = await smGetSession(pid);
      if (!rec) { sarvarcTeamShowError('This project is not on this device yet. Open it first.'); return; }
      await sarvarcTeamDownloadRecAsSW(rec);
      toast('Backup downloaded as a .sw file', 'success');
      sarvarcTeamAudit('backup_downloaded', { project_id: pid, name: rec.name });
    } catch (e) { sarvarcTeamShowError('Could not create the backup file.'); }
  }

  // Activity log: only owners and admins can read it (database rule).
  const SARVARC_ACTIVITY_TEXT = {
    member_invited: d => 'invited ' + (d.email || 'someone') + ' as ' + (d.role || 'member'),
    role_changed: d => 'changed ' + sarvarcTeamWho(d.member_user_id, 'a member') + '\u2019s role to ' + (d.new_role || '?'),
    member_removed: d => 'removed ' + sarvarcTeamWho(d.member_user_id, 'a member'),
    project_saved: d => 'saved \u201c' + (d.name || 'a project') + '\u201d',
    project_opened: d => 'opened \u201c' + (d.name || 'a project') + '\u201d',
    live_started: d => 'went live with \u201c' + (d.name || 'a project') + '\u201d',
    live_ended: d => 'ended the live session',
    version_saved: d => 'kept a restore point of \u201c' + (d.name || 'a project') + '\u201d',
    version_restored: d => 'restored \u201c' + (d.name || 'a project') + '\u201d to an earlier version',
    backup_downloaded: d => 'downloaded a backup of \u201c' + (d.name || 'a project') + '\u201d',
    owner_transferred: d => 'made ' + sarvarcTeamWho(d.new_owner, 'someone') + ' the new owner'
  };
  function sarvarcTeamWho(uid, fallback) {
    const m = uid && sarvarcTeamMembersCache[uid];
    return (m && (m.full_name || m.email)) || fallback;
  }
  async function sarvarcTeamActivityLoad() {
    const box = document.getElementById('sarvarcTeamActivityList');
    if (!box || !sarvarcTeamActiveId) return;
    box.innerHTML = '<div class="tm-hist-empty">Loading\u2026</div>';
    try {
      const { data, error } = await sarvarcSupabase.from('audit_log').select('user_id, action, details, created_at').eq('team_id', sarvarcTeamActiveId).order('created_at', { ascending: false }).limit(40);
      if (error) throw error;
      if (!data || !data.length) { box.innerHTML = '<div class="tm-hist-empty">Nothing yet. Activity appears here as your team works.</div>'; return; }
      box.innerHTML = data.map(r => {
        const fn = SARVARC_ACTIVITY_TEXT[r.action];
        const what = fn ? fn(r.details || {}) : r.action.replace(/_/g, ' ');
        const d = new Date(r.created_at);
        return '<div class="tm-hist-row"><span class="tm-hist-label"><b>' + sarvarcTeamEsc(sarvarcTeamWho(r.user_id, 'Someone')) + '</b> ' + sarvarcTeamEsc(what) + '</span><span class="tm-hist-when">' + sarvarcTeamEsc(d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</span></div>';
      }).join('');
    } catch (e) { box.innerHTML = '<div class="tm-hist-empty">Could not load the activity log.</div>'; }
  }

  // Hand the team to someone else. Needs supabase/03-transfer-ownership.sql.
  async function sarvarcTeamTransferOwner(targetUserId, targetName) {
    sarvarcTeamShowError(''); sarvarcTeamShowNote('');
    try {
      if (sarvarcTeamMyRole !== 'owner') { sarvarcTeamShowError('Only the owner can transfer ownership.'); return; }
      if (!confirm('Make ' + targetName + ' the owner of this team?\n\nThey get full control. You become an admin. Only they can change this back.')) return;
      const { error } = await sarvarcSupabase.rpc('sarvarc_transfer_ownership', { p_team: sarvarcTeamActiveId, p_new_owner: targetUserId });
      if (error) {
        const msg = String(error.message || '');
        if (error.code === 'PGRST202' || /function .*(not found|does not exist)|schema cache/i.test(msg)) sarvarcTeamShowError('Ownership transfer is not switched on yet. Run the file 03-transfer-ownership.sql in Supabase once, then try again.');
        else sarvarcTeamShowError(msg || 'Could not transfer ownership.');
        return;
      }
      toast(targetName + ' is now the owner', 'success');
      const user = await sarvarcTeamGetUser();
      if (user) await sarvarcTeamLoadMyTeams(user);
      await sarvarcTeamLoadMembers(sarvarcTeamActiveId);
    } catch (e) { sarvarcTeamShowError(e.message || 'Could not transfer ownership.'); }
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
      sarvarcTeamAudit('project_opened', { project_id: rec.id, name: rec.name });
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
    // Signing out must also end any live session and team listening, or the
    // Live badge and teammates' cursors would stay on screen for a person
    // who is no longer signed in.
    if (event === 'SIGNED_OUT') {
      try { sarvarcCollabDisconnect(); } catch (e) {}
      SARVARC_LIVE_FLAGS.forEach(k => localStorage.removeItem(k));
      if (sarvarcTeamPresenceChannel) { try { sarvarcSupabase.removeChannel(sarvarcTeamPresenceChannel); } catch (e) {} sarvarcTeamPresenceChannel = null; }
      sarvarcCollabRoles = {}; sarvarcCollabRolesLoaded = false; sarvarcCollabMembership = 'unknown';
      sarvarcTeamMyRole = null; sarvarcTeamActiveId = null; sarvarcTeamOnlineIds = new Set();
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

  // <PDFED-COLLAB-BEGIN>
  // =========================================================
  // PDF EDITOR LIVE CO-EDITING (Teams, Step 3)
  //
  // What syncs live, per ELEMENT (so two people can move different text
  // boxes on the same page without overwriting each other):
  //   placed texts, images, borders, tables, shapes
  // What syncs per PAGE (last change wins): edited text blocks, filters
  //   and other page edits, pen strokes, background, label
  // Page order, added pages and deleted pages also sync.
  // A page picture that changed (crop, rotate) syncs as one shared asset.
  //
  // Page ids: pages loaded from the same saved project get the same id on
  // every machine (pg<index>_<pageNum>); pages added during the session
  // get a random id. Big images are sent once and referenced by hash.
  // Limit: one live message must stay under the Realtime size ceiling, so
  // a huge new page picture may not reach teammates (the sync ring turns
  // red).
  // =========================================================
  const SARVARC_PDFED_KINDS = ['placedTexts', 'placedImages', 'placedBorders', 'placedTables', 'placedShapes'];
  const SARVARC_PDFED_META_KEYS = ['textBlocks', 'edits', 'annotStrokes', 'annotRedoStrokes', 'bgColor', 'modified', 'label'];
  const SARVARC_PDFED_BASE_KEYS = ['type', 'pageNum', 'width', 'height', 'pageMM'];
  const SARVARC_PDFED_ASSET_MIN = 2048;
  let pdfedCollab = null;
  let pdfedCollabPointerDown = false;

  function pdfedCollabHash(s) {
    if (!s || typeof s !== 'string') return '';
    const n = s.length;
    const step = Math.max(1, Math.floor(n / 512));
    let h = n | 0;
    for (let i = 0; i < n; i += step) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    // Also read the first and last 256 characters in full, so two pictures
    // that differ only near the start or end can never share a hash.
    const edge = Math.min(256, n);
    for (let i = 0; i < edge; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    for (let i = n - edge; i < n; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return n + '_' + (h >>> 0).toString(36);
  }

  function pdfedCollabEnsureCids(initial) {
    pdfed.pages.forEach((pg, i) => {
      if (initial) {
        if (!pg._cid) pg._cid = 'pg' + i + '_' + (pg.pageNum || 0);
        pg._cNew = false;
        pg._cBase = pdfedCollabHash(pg.dataUrl);
      } else if (!pg._cid) {
        pg._cid = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        pg._cNew = true;
      }
    });
  }

  // JSON with big pictures swapped for short "@asset:<hash>" references.
  function pdfedCollabSer(obj, assets) {
    return JSON.stringify(obj, function (k, v) {
      if (k && k.charAt(0) === '_') return undefined;
      if (k === 'dataUrl' && typeof v === 'string' && v.length > SARVARC_PDFED_ASSET_MIN) {
        const h = pdfedCollabHash(v);
        if (assets) assets[h] = v;
        return '@asset:' + h;
      }
      return v;
    });
  }

  // Everything that should be shared, as { key: jsonString }.
  function pdfedCollabSnapshot() {
    const out = {}; const assets = {}; const order = [];
    pdfed.pages.forEach((pg) => {
      const cid = pg._cid; order.push(cid);
      const b = {};
      SARVARC_PDFED_BASE_KEYS.forEach((k) => { if (pg[k] !== undefined) b[k] = pg[k]; });
      const h = pdfedCollabHash(pg.dataUrl);
      if (pg.dataUrl && (pg._cNew || h !== pg._cBase || pg._cShared === h)) { b.dataUrl = '@asset:' + h; assets[h] = pg.dataUrl; }
      else b.dataUrl = '@local';
      out[cid + '|b'] = JSON.stringify(b);
      const m = {};
      SARVARC_PDFED_META_KEYS.forEach((k) => { if (pg[k] !== undefined) m[k] = pg[k]; });
      out[cid + '|m'] = pdfedCollabSer(m, assets);
      SARVARC_PDFED_KINDS.forEach((kind) => {
        (pg[kind] || []).forEach((it) => {
          if (!it.id && !it._cid) it._cid = 'i' + Math.random().toString(36).slice(2, 10);
          out[cid + '|i|' + kind + '|' + (it.id || it._cid)] = pdfedCollabSer(it, assets);
        });
      });
    });
    out.o = JSON.stringify(order);
    return { data: out, assets: assets };
  }

  function pdfedCollabPushNow() {
    const C = pdfedCollab;
    if (!C || !C.ready || C.applying || !sarvarcCollabMayEditNow()) return;
    if (C.dirty.size) { pdfedCollabScheduleApply(); return; } // take in teammates' changes first, never overwrite them
    pdfedCollabEnsureCids(false);
    const snap = pdfedCollabSnapshot();
    C.doc.transact(() => {
      Object.keys(snap.data).forEach((k) => { if (C.map.get(k) !== snap.data[k]) C.map.set(k, snap.data[k]); });
      // Remove only things we knew about and no longer have (deleted by us).
      C.known.forEach((k) => { if (!(k in snap.data) && C.map.has(k)) C.map.delete(k); });
      Object.keys(snap.assets).forEach((h) => { if (!C.assets.has(h)) C.assets.set(h, snap.assets[h]); });
      C.assets.forEach((v, h) => { if (!(h in snap.assets)) C.assets.delete(h); });
    }, 'local');
    C.known = new Set(Object.keys(snap.data));
  }

  function pdfedCollabSchedulePush() {
    const C = pdfedCollab;
    if (!C || !C.ready || C.applying) return;
    clearTimeout(C.pushTimer);
    C.pushTimer = setTimeout(pdfedCollabPushNow, 250);
  }

  function pdfedCollabBusy() {
    if (pdfedCollabPointerDown) return true;
    if (typeof teState !== 'undefined' && teState && teState.active) return true;
    const w = document.getElementById('pdfedCanvasWrap');
    const a = document.activeElement;
    return !!(a && w && w.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)));
  }

  function pdfedCollabScheduleApply() {
    const C = pdfedCollab;
    if (!C) return;
    clearTimeout(C.applyTimer);
    C.applyTimer = setTimeout(function tick() {
      if (pdfedCollab !== C) return;
      if (pdfedCollabBusy()) { C.applyTimer = setTimeout(tick, 400); return; } // do not yank things from under someone mid-drag or mid-typing
      pdfedCollabApplyRemote();
    }, 120);
  }

  async function pdfedCollabApplyRemote() {
    const C = pdfedCollab;
    if (!C || C.applying) return;
    C.applying = true;
    try {
      const D = C.map;
      if (!D.has('o')) return;
      const order = JSON.parse(D.get('o'));
      const dirty = C.dirty; C.dirty = new Set();
      const all = dirty.has('*');
      if (all) D.forEach((v, k) => dirty.add(k));
      const revive = (json) => JSON.parse(json, (k, v) => {
        if (typeof v === 'string' && v.indexOf('@asset:') === 0) { const a = C.assets.get(v.slice(7)); return a === undefined ? v : a; }
        return v;
      });

      const activeCid = pdfed.pages[pdfed.active] && pdfed.pages[pdfed.active]._cid;
      const byCid = {}; pdfed.pages.forEach((p) => { if (p._cid) byCid[p._cid] = p; });
      const changed = new Set(); const rasterChanged = new Set();
      let structure = false;

      // Page list: follow the shared order. A page we have that is not in the
      // shared order is either brand new here (not pushed yet: keep it) or
      // was deleted by a teammate (we had seen it before: drop it).
      // Follow the shared order only when a teammate actually changed it; otherwise keep ours (we may have a reorder not sent yet).
      const orderChanged = all || dirty.has('o');
      const next = [];
      if (!orderChanged) pdfed.pages.forEach((p) => next.push(p));
      (orderChanged ? order : []).forEach((cid) => {
        let pg = byCid[cid];
        if (!pg) {
          pg = { _cid: cid, edits: {}, textBlocks: [], placedTexts: [], placedImages: [], placedBorders: [], placedTables: [], placedShapes: [], modified: false, dataUrl: null, _cNew: false };
          byCid[cid] = pg; structure = true; changed.add(cid);
          dirty.add(cid + '|b'); dirty.add(cid + '|m');
        }
        next.push(pg);
      });
      if (orderChanged) pdfed.pages.forEach((p) => {
        if (order.indexOf(p._cid) === -1 && !C.known.has(p._cid + '|b')) next.push(p);
        else if (order.indexOf(p._cid) === -1) structure = true;
      });
      if (next.length !== pdfed.pages.length || next.some((p, i) => pdfed.pages[i] !== p)) structure = true;

      // Apply ONLY the keys that changed, so a teammate's change to one
      // element never overwrites something we are still editing elsewhere.
      dirty.forEach((k) => {
        if (k === 'o') return;
        const parts = k.split('|');
        const pg = byCid[parts[0]];
        if (!pg) return;
        const json = D.get(k);
        if (parts[1] === 'b') {
          if (json === undefined) return;
          const b = revive(json);
          if (changed.has(parts[0])) SARVARC_PDFED_BASE_KEYS.forEach((f) => { if (b[f] !== undefined) pg[f] = b[f]; });
          if (typeof b.dataUrl === 'string' && b.dataUrl.charAt(0) !== '@' && b.dataUrl !== pg.dataUrl) {
            pg.dataUrl = b.dataUrl; pg._cBase = pdfedCollabHash(pg.dataUrl); pg._cShared = pg._cBase; rasterChanged.add(parts[0]); changed.add(parts[0]);
          }
        } else if (parts[1] === 'm') {
          if (json === undefined) return;
          const m = revive(json);
          SARVARC_PDFED_META_KEYS.forEach((f) => { if (m[f] !== undefined) pg[f] = m[f]; });
          changed.add(parts[0]);
        } else if (parts[1] === 'i') {
          const kind = parts[2]; const id = parts.slice(3).join('|');
          const arr = pg[kind] || (pg[kind] = []);
          const at = arr.findIndex((it) => (it.id || it._cid) === id);
          if (json === undefined) { if (at > -1) arr.splice(at, 1); }
          else {
            const obj = revive(json);
            if (at > -1) {
              const it = arr[at];
              Object.keys(it).forEach((f) => { if (f.charAt(0) !== '_') delete it[f]; });
              Object.assign(it, obj);
            } else { if (!obj.id) obj._cid = id; arr.push(obj); }
          }
          changed.add(parts[0]);
        }
      });

      pdfed.pages.length = 0;
      next.forEach((p) => pdfed.pages.push(p));
      let ai = activeCid ? next.findIndex((p) => p._cid === activeCid) : -1;
      if (ai < 0) ai = Math.min(Math.max(pdfed.active, 0), next.length - 1);
      C.known = new Set(); D.forEach((v, k) => C.known.add(k));

      if (structure) {
        pdfed.active = ai;
        if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
        if (typeof pdfedGoto === 'function' && next.length) await pdfedGoto(Math.max(0, ai));
      } else {
        const cur = pdfed.pages[pdfed.active];
        if (cur && changed.has(cur._cid)) {
          if (rasterChanged.has(cur._cid) && typeof pdfedGoto === 'function') await pdfedGoto(pdfed.active);
          else {
            if (typeof pdfedRenderAllPlaced === 'function') pdfedRenderAllPlaced(pdfed.active);
            if (typeof pdfedRenderTextLayer === 'function') pdfedRenderTextLayer(cur, false);
          }
        }
        if (changed.size && typeof pdfedBuildStrip === 'function') {
          clearTimeout(C.stripTimer);
          C.stripTimer = setTimeout(() => { if (pdfedCollab === C) pdfedBuildStrip(); }, 800);
        }
      }
    } catch (e) {
      console.warn('[Collab] PDF Editor apply failed', e);
      sarvarcCollabSetHealthy(false);
    } finally {
      C.applying = false;
      // Anything we changed locally while waiting for this apply still needs sending.
      if (pdfedCollab === C) pdfedCollabSchedulePush();
    }
  }

  function pdfedCollabPointerDownHandler() { pdfedCollabPointerDown = true; }
  function pdfedCollabPointerUpHandler() { pdfedCollabPointerDown = false; if (pdfedCollab && pdfedCollab.dirty.size) pdfedCollabScheduleApply(); }

  (function pdfedCollabWrapPersist() {
    const orig = window.pdfedPersist;
    if (typeof orig !== 'function' || orig.__collabWrapped) return;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { pdfedCollabSchedulePush(); } catch (e) {}
      return r;
    };
    wrapped.__collabWrapped = true;
    window.pdfedPersist = wrapped;
  })();

  sarvarcCollabRegisterModule('pdfeditor', {
    attach(doc, awareness) {
      const C = pdfedCollab = {
        doc: doc, map: doc.getMap('pdfedDoc'), assets: doc.getMap('pdfedAssets'),
        ready: false, applying: false, known: new Set(), dirty: new Set(),
        pushTimer: null, applyTimer: null, stripTimer: null, seedTimer: null
      };
      pdfedCollabEnsureCids(true);
      C.map.observe((event, tx) => {
        if (tx.origin !== 'remote') return;
        event.changes.keys.forEach((v, k) => C.dirty.add(k));
        pdfedCollabScheduleApply();
      });
      document.addEventListener('pointerdown', pdfedCollabPointerDownHandler, true);
      document.addEventListener('pointerup', pdfedCollabPointerUpHandler, true);
      // Give teammates ~1.5 s to hand us their state before we decide whether
      // WE are the first person here (then we share ours) or a joiner (then we
      // take theirs). Seeding earlier could overwrite a teammate's newer work.
      C.seedTimer = setTimeout(() => {
        if (pdfedCollab !== C) return;
        pdfedCollabEnsureCids(true);
        if (C.map.has('o')) {
          C.dirty.add('*');
          C.ready = true;
          pdfedCollabApplyRemote();
        } else {
          C.ready = true;
          if (pdfed.pages.length) pdfedCollabPushNow();
        }
      }, 1500);
    },
    detach() {
      const C = pdfedCollab;
      if (C) { clearTimeout(C.pushTimer); clearTimeout(C.applyTimer); clearTimeout(C.stripTimer); clearTimeout(C.seedTimer); }
      document.removeEventListener('pointerdown', pdfedCollabPointerDownHandler, true);
      document.removeEventListener('pointerup', pdfedCollabPointerUpHandler, true);
      pdfedCollabPointerDown = false;
      pdfedCollab = null;
    }
  });
  // <PDFED-COLLAB-END>
