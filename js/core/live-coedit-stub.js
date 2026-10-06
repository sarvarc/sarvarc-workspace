
  // ── LIVE CO-EDITING: EARLY STUB ─────────────────────────────────────────
  // Deliberately the very first script on the page. Module scripts (Make
  // Forms, and others as they're wired up) call sarvarcCollabRegisterModule()
  // at their own script-load time, which happens LONG before the real LIVE
  // CO-EDITING CORE block loads (it lives near the Team feature code, far
  // down the page, since it needs sarvarcSupabase to already exist). This
  // stub just queues those calls; the real core drains the queue and
  // replaces this function once it initializes.
  window.sarvarcCollabPending = [];
  function sarvarcCollabRegisterModule(key, impl) {
    window.sarvarcCollabPending.push([key, impl]);
  }
