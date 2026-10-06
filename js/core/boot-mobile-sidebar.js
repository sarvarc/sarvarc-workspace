
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
