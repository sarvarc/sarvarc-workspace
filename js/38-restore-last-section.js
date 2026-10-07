(function(){
  function restoreLastSection(){
    // Workspace (pdfeditor) is always the landing section on every visit,
    // first-time or returning — it's already marked active in the markup,
    // so this function intentionally does nothing. The old behavior of
    // restoring whatever section (e.g. Dashboard) the user was last on via
    // localStorage('sarvarcLastSection') has been disabled per product
    // decision: Workspace should always be the first impression.
  }
  function boot(){
    restoreLastSection();
    var splash = document.getElementById('sarvarcSplash');
    var splashImg = document.getElementById('splashLogoImg');
    var splashShine = document.getElementById('splashShine');
    var navImg = document.querySelector('.nav-logo-link img');
    if (splashImg && navImg && navImg.getAttribute('src')) {
      var logoSrc = navImg.getAttribute('src');
      splashImg.src = logoSrc;
      if (splashShine) {
        // Mask the shine sweep to the logo's own alpha channel so the light
        // travels across the mark's silhouette rather than a rectangle.
        splashShine.style.webkitMaskImage = 'url(' + logoSrc + ')';
        splashShine.style.maskImage = 'url(' + logoSrc + ')';
        requestAnimationFrame(function(){ splashShine.classList.add('run'); });
      }
    }
    var hasEntered = false;
    try { hasEntered = sessionStorage.getItem('sarvarcHasEntered') === '1'; } catch(e) {}
    if (hasEntered) {
      // Already hidden instantly by the inline check right after the splash
      // markup — this just guarantees a clean state either way, with no
      // animation and no minimum-show delay on repeat visits/refreshes.
      if (splash) { splash.classList.add('splash-hide'); splash.style.display = 'none'; }
      document.body.classList.remove('splash-active');
      return;
    }
    var MIN_SHOW = 1400; // ms the splash stays visible — first visit only
    var start = Date.now();
    function finishBoot(){
      var elapsed = Date.now() - start;
      var wait = Math.max(0, MIN_SHOW - elapsed);
      setTimeout(function(){
        if (splash) splash.classList.add('splash-hide');
        document.body.classList.remove('splash-active');
        setTimeout(function(){ if (splash) splash.style.display = 'none'; }, 600);
        try { sessionStorage.setItem('sarvarcHasEntered', '1'); } catch(e) {}
      }, wait);
    }
    finishBoot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
