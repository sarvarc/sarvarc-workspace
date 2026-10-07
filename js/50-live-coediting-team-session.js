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
