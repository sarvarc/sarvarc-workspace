// Mobile: start with the sidebar tucked away as a closed drawer instead of
// the desktop default of "open and embedded in the grid". Runs synchronously
// before .sidebar paints so there's no flash of an open drawer covering the
// screen on first load.
(function(){
  try {
    if (window.matchMedia('(max-width: 768px)').matches) {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch(e) {}
})();

// Mobile PDF Editor: the page strip (left drawer) and the Panel / Assets /
// Notes area (bottom sheet) start CLOSED so the canvas gets the whole screen,
// and tapping the dimmed area behind an open drawer/sheet closes it. The
// layout is css/31-mobile-polish.css; this only drives the existing
// pdfedToggleLeftPanel / pdfedToggleRightPanel functions.
(function(){
  function isPhone(){ try { return window.matchMedia('(max-width: 768px)').matches; } catch(e) { return false; } }
  document.addEventListener('DOMContentLoaded', function(){
    if (!isPhone()) return;
    var layout = document.getElementById('pdfedLayout');
    if (!layout) return;
    try {
      if (!layout.classList.contains('left-collapsed')  && typeof pdfedToggleLeftPanel  === 'function') pdfedToggleLeftPanel();
      if (!layout.classList.contains('right-collapsed') && typeof pdfedToggleRightPanel === 'function') pdfedToggleRightPanel(true);
    } catch(e) {}
  });
  document.addEventListener('click', function(ev){
    if (!isPhone()) return;
    var layout = document.getElementById('pdfedLayout');
    // A tap on the dim overlay (::after) targets the layout element itself.
    if (!layout || ev.target !== layout) return;
    try {
      if (!layout.classList.contains('left-collapsed')  && typeof pdfedToggleLeftPanel  === 'function') pdfedToggleLeftPanel();
      if (!layout.classList.contains('right-collapsed') && typeof pdfedToggleRightPanel === 'function') pdfedToggleRightPanel();
    } catch(e) {}
  });
})();

// iPhone Safari zooms the whole page whenever a text field, contenteditable
// cell or text box under 16px gets focus (Data Arrangement cells, PDF text
// boxes, Forms, Redaction, search boxes...). Capping the page scale at 1
// stops that auto-zoom in every module without resizing any text, so PDF
// text boxes keep their real size. iOS still allows pinch-zoom for
// accessibility, and Android Chrome (which never auto-zooms) is untouched.
(function(){
  var ua = navigator.userAgent || '';
  if (!/iPhone|iPod/.test(ua)) return;
  function apply(){
    var m = document.querySelector('meta[name="viewport"]');
    if (!m || /maximum-scale/.test(m.content)) return;
    m.content = m.content.replace(/\s*,?\s*$/, '') + ', maximum-scale=1';
  }
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})();
