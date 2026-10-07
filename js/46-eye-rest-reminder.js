(function () {
  var EYE_REST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  var EYE_REST_VISIBLE_MS = 5 * 1000;         // visible for 5 seconds
  var hideTimer = null;

  window.eyeRestHide = function () {
    var el = document.getElementById('eyeRestReminder');
    if (!el) return;
    el.classList.remove('show');
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  };

  function eyeRestShow() {
    var el = document.getElementById('eyeRestReminder');
    if (!el) return;
    el.classList.add('show');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(eyeRestHide, EYE_REST_VISIBLE_MS);
  }

  setInterval(eyeRestShow, EYE_REST_INTERVAL_MS);
})();
