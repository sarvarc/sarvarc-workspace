// ─── PDF EDITOR RIBBON COLLAPSE ("hide the tools until I need them") ───
// Lets people pin the tool ribbon shut so the editor reads as a clean canvas
// instead of a wall of buttons. While collapsed, hovering the thin strip left
// behind peeks the full ribbon as a floating overlay (no layout jump); moving
// away closes the peek again. The pinned/unpinned choice is remembered.
(function () {
  const appbar = document.getElementById('pdfedAppbar');
  const row1 = appbar ? appbar.querySelector('.pdfed-appbar-row1') : null;
  const row2 = document.getElementById('pdfedAppbarRow2');
  const handle = document.getElementById('pdfedRibbonPeekHandle');
  const toggleBtn = document.getElementById('pdfedRibbonToggleBtn');
  if (!appbar || !row2) return;

  const STORAGE_KEY = 'sarvarcPdfRibbonCollapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) {}

  function applyPeekTop() {
    if (row1) row2.style.top = row1.offsetHeight + 'px';
  }

  function setCollapsed(next) {
    collapsed = next;
    appbar.classList.toggle('ribbon-collapsed', collapsed);
    row2.classList.remove('ribbon-peek');
    if (toggleBtn) toggleBtn.title = collapsed ? 'Show ribbon' : 'Collapse ribbon';
    if (handle) handle.title = collapsed ? 'Show ribbon' : '';
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (e) {}
  }

  setCollapsed(collapsed);

  window.pdfedToggleRibbon = function () { setCollapsed(!collapsed); };

  let hideTimer = null;
  function peekShow() {
    if (!collapsed) return;
    clearTimeout(hideTimer);
    applyPeekTop();
    row2.classList.add('ribbon-peek');
  }
  function peekHide() {
    hideTimer = setTimeout(() => { row2.classList.remove('ribbon-peek'); }, 220);
  }
  if (handle) {
    handle.addEventListener('mouseenter', peekShow);
    handle.addEventListener('mouseleave', peekHide);
  }
  row2.addEventListener('mouseenter', () => { if (collapsed) clearTimeout(hideTimer); });
  row2.addEventListener('mouseleave', () => { if (collapsed) peekHide(); });
  window.addEventListener('resize', () => { if (row2.classList.contains('ribbon-peek')) applyPeekTop(); });
})();
