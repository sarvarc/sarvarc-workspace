
// ─── DIAGRAMS & GRAPHS TOOLBAR COLLAPSE ───
// Same idea as the PDF editor ribbon: pin the toolbar shut to a thin strip,
// hover the strip to peek the full toolbar as a floating overlay (canvas
// underneath never shifts), move away and it tucks back in. Click the strip
// (or the toggle button) to pin it open/shut for good. Choice persists.
(function () {
  const bar = document.getElementById('dgRibbonBar');
  const btn = document.getElementById('dgRibbonToggleBtn');
  if (!bar || !btn) return;

  const STORAGE_KEY = 'sarvarcDgRibbonCollapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) {}

  function setCollapsed(next) {
    collapsed = next;
    bar.classList.toggle('dg-ribbon-collapsed', collapsed);
    bar.classList.remove('dg-ribbon-peek');
    btn.classList.toggle('active', collapsed);
    btn.title = collapsed ? 'Show Tool Bar' : 'Collapse Tool Bar';
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (e) {}
  }

  window.dgToggleRibbon = function () { setCollapsed(!collapsed); };

  let hideTimer = null;
  function peekShow() {
    if (!collapsed) return;
    clearTimeout(hideTimer);
    bar.classList.add('dg-ribbon-peek');
  }
  function peekHide() {
    hideTimer = setTimeout(() => { bar.classList.remove('dg-ribbon-peek'); }, 220);
  }

  bar.addEventListener('mouseenter', peekShow);
  bar.addEventListener('mouseleave', () => { if (collapsed) peekHide(); });
  bar.addEventListener('click', () => {
    // Clicking while peeking (or on the collapsed strip itself) pins it open.
    if (collapsed) setCollapsed(false);
  });

  setCollapsed(collapsed);
})();
