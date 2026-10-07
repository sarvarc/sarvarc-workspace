// ─── TOP BAR + MIDDLE BAR AUTO-SHRINK (less distraction, more canvas visibility) ───
// Both bars use the same logic: shrink after an idle delay, expand instantly on
// hover, but ONLY the top logo bar and the title/actions row react to hover.
// The ribbon/toolbar (where the user picks tools) is excluded entirely: hovering
// it never triggers shrink/expand. The top bar also keeps the --topnav-h CSS
// var in sync with its real height so the grid row resizes with it, no gap.
(function () {
  const root = document.documentElement;

  // Once either bar has auto-shrunk for the first time in this browser tab
  // session, both bars lock into the shrunk state for the rest of the
  // session — hovering no longer re-expands them. Closing the tab (or the
  // whole browser) clears sessionStorage, so reopening starts fresh: bars
  // load big again, wait out the idle delay, then shrink-and-lock again.
  const LOCK_KEY = 'sarvarcBarsShrunkLock';
  let sessionLocked = false;
  try { sessionLocked = sessionStorage.getItem(LOCK_KEY) === '1'; } catch (e) {}

  function lockShrink() {
    if (sessionLocked) return;
    sessionLocked = true;
    try { sessionStorage.setItem(LOCK_KEY, '1'); } catch (e) {}
  }

  // hoverEl: the element whose hover state controls shrink/expand
  // classEl: the element that receives the .compact class (may be a parent)
  function makeAutoShrink(hoverEl, classEl, { onShrink, onExpand } = {}) {
    if (!hoverEl || !classEl) return null;
    // If a prior shrink already locked this session, start pre-armed so we
    // don't wait through another idle delay before re-applying the shrink.
    let armed = sessionLocked;
    let hovering = false;
    function shrink() {
      if (armed && !hovering) {
        classEl.classList.add('compact');
        if (onShrink) onShrink();
        lockShrink();
      }
    }
    function expand() {
      // Once locked shrunk for the session, hover can no longer re-expand.
      if (sessionLocked) return;
      classEl.classList.remove('compact'); if (onExpand) onExpand();
    }
    hoverEl.addEventListener('mouseenter', () => { hovering = true; expand(); });
    hoverEl.addEventListener('mouseleave', () => { hovering = false; shrink(); });
    if (sessionLocked) shrink(); // apply immediately, no idle wait needed
    return { arm() { armed = true; shrink(); } };
  }

  const nav = document.getElementById('sarvarcTopnav');
  const navShrink = makeAutoShrink(nav, nav, {
    onShrink: () => root.style.setProperty('--topnav-h', '38px'),
    onExpand: () => root.style.setProperty('--topnav-h', '56px'),
  });

  const appbar = document.getElementById('pdfedAppbar');
  const appbarRow1 = appbar ? appbar.querySelector('.pdfed-appbar-row1') : null;
  const appbarShrink = makeAutoShrink(appbarRow1, appbar);

  setTimeout(() => {
    if (navShrink) navShrink.arm();
    if (appbarShrink) appbarShrink.arm();
  }, 5000);
})();
