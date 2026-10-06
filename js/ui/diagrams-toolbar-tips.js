
// ─── DIAGRAMS & GRAPHS TOOLBAR — promote title → data-tip ───
// The ribbon buttons already carry a descriptive title attribute; this just
// hands that same text to the premium dark-pill tooltip (.dg-ribbon-bar
// [data-tip]::after, defined alongside the ribbon CSS) and removes the
// title attribute so the browser's own slow native tooltip doesn't also
// fire and double up on top of it. Runs once at load, and again if a
// button's title changes later (the mutation observer below), since a few
// ribbon buttons update their title dynamically (e.g. the ribbon collapse
// toggle switches between "Collapse Tool Bar" / "Show Tool Bar").
(function () {
  function promote(el) {
    const t = el.getAttribute('title');
    if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
  }
  function promoteAll() {
    const bar = document.getElementById('dgRibbonBar');
    if (bar) bar.querySelectorAll('button[title]').forEach(promote);
    const modeTabs = document.getElementById('dgModeTabs');
    if (modeTabs) modeTabs.querySelectorAll('button[title]').forEach(promote);
  }
  promoteAll();
  const bar = document.getElementById('dgRibbonBar');
  const modeTabs = document.getElementById('dgModeTabs');
  if (window.MutationObserver && (bar || modeTabs)) {
    const obs = new MutationObserver(() => promoteAll());
    if (bar) obs.observe(bar, { attributes: true, attributeFilter: ['title'], subtree: true });
    if (modeTabs) obs.observe(modeTabs, { attributes: true, attributeFilter: ['title'], subtree: true });
  }
})();
