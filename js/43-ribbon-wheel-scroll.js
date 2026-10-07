// ── Global: mouse-wheel vertical scroll → horizontal slide, on every ribbon bar ──
// Applies to any ribbon toolbar in the app (PDF Editor, Make Forms, Diagrams & Graphs,
// and any future one) without needing to wire each one up individually — it just
// looks for the ribbon classes via event delegation on wheel.
(function () {
  const RIBBON_SELECTOR = '.pdfed-ribbon, .dg-ribbon-bar';

  // Per-ribbon animation state: a running "target" scrollLeft that each
  // wheel tick nudges, plus a rAF loop that eases the real scrollLeft
  // toward that target. This is what gives the glide/momentum feel instead
  // of the old hard jump — every frame closes ~16% of the remaining gap,
  // so fast flicks feel snappy and small nudges feel soft, and repeated
  // wheel ticks in flight just update the same target instead of stacking
  // jerky little jumps.
  const state = new WeakMap();
  const EASE = 0.16; // lower = silkier/slower settle, higher = snappier
  const SNAP_THRESHOLD = 0.5; // px gap below which we consider it "arrived"

  function step(ribbon) {
    const s = state.get(ribbon);
    if (!s) return;

    const current = ribbon.scrollLeft;
    // Someone else moved the bar (touch slide, scrollbar drag, trackpad swipe): let go, don't pull it back.
    if (s.expect != null && Math.abs(current - s.expect) > 2) { s.raf = null; s.target = current; s.expect = null; return; }
    s.target = Math.min(Math.max(0, ribbon.scrollWidth - ribbon.clientWidth), Math.max(0, s.target));
    const diff = s.target - current;

    if (Math.abs(diff) < SNAP_THRESHOLD) {
      ribbon.scrollLeft = s.target;
      s.raf = null; s.expect = null;
      return;
    }

    ribbon.scrollLeft = current + diff * EASE;
    s.expect = ribbon.scrollLeft;
    s.raf = requestAnimationFrame(() => step(ribbon));
  }

  document.addEventListener('wheel', function (e) {
    // An open ribbon dropdown (Chart Type, Colours, Columns, History, ...) is rendered
    // position:fixed so it can float outside the ribbon's own horizontal strip — but in
    // the DOM it's still nested INSIDE the ribbon bar element it launched from. Without
    // this check, e.target.closest(RIBBON_SELECTOR) below would match that ribbon
    // ancestor and hijack the scroll to pan the ribbon sideways, even though the person
    // is actually trying to scroll the dropdown's own vertical list (e.g. the Chart Type
    // grid, which is taller than its panel). Any wheel event over an open dropdown panel
    // is the panel's own business, not the ribbon's, so bail out before taking over.
    if (e.target.closest('.dg-dropdown-panel.open')) return;
    const ribbon = e.target.closest(RIBBON_SELECTOR);
    if (!ribbon) return;
    // Only take over when there's actually something to scroll horizontally,
    // and the gesture is a normal vertical wheel (not already horizontal, e.g.
    // a trackpad swipe, which should pass through untouched).
    if (ribbon.scrollWidth <= ribbon.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    e.preventDefault();

    let s = state.get(ribbon);
    if (!s) {
      s = { target: ribbon.scrollLeft, raf: null };
      state.set(ribbon, s);
    }

    // Clamp the target to the real scrollable range so momentum can't
    // "overshoot" into rubber-banding against the bar's own edges.
    const maxScroll = ribbon.scrollWidth - ribbon.clientWidth;
    if (!s.raf) s.target = ribbon.scrollLeft;   // start from where the bar really is, not where the last wheel left it
    s.target = Math.min(maxScroll, Math.max(0, s.target + e.deltaY));

    if (!s.raf) {
      s.raf = requestAnimationFrame(() => step(ribbon));
    }
  }, { passive: false });

  // Grabbing the bar (touch, pen, mouse on the scrollbar) hands control back to the browser at once.
  function release(e) {
    const ribbon = e.target && e.target.closest ? e.target.closest(RIBBON_SELECTOR) : null;
    const s = ribbon && state.get(ribbon);
    if (!s) return;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = null; }
    s.expect = null; s.target = ribbon.scrollLeft;
  }
  document.addEventListener('touchstart', release, { passive: true });
  document.addEventListener('pointerdown', release, { passive: true });
})();
