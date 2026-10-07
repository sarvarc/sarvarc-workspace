// Runs immediately as the page parses (before the rest of the body even
// loads), so returning users never see the splash flash on screen at all —
// it only ever plays in full on someone's very first visit to the app.
(function(){
  try {
    if (sessionStorage.getItem('sarvarcHasEntered') === '1') {
      var s = document.getElementById('sarvarcSplash');
      if (s) s.style.display = 'none';
      document.body.classList.remove('splash-active');
    }
  } catch(e) { /* sessionStorage unavailable — falls back to showing the normal splash */ }
})();
