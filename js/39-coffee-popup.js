(function(){
  var STORAGE_KEY = 'sarvarcCoffeePopup';
  var RESHOW_AFTER_DAYS = 7;     // if dismissed, wait this long before offering again
  var SKIP_FIRST_N_EXPORTS = 1;  // don't interrupt the very first export, let the win land first
  var SHOW_DELAY_MS = 1100;      // let the export's own success toast settle first
  var memState = {};             // in-memory fallback, used whenever localStorage read/write fails
  var dbg = function(){ try { (console.debug || console.log || function(){}).apply(console, arguments); } catch(e){} };

  function getState(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : Object.assign({}, memState);
    } catch(e){ return Object.assign({}, memState); }
  }
  function setState(s){
    memState = s; // always keep the in-memory copy in sync, regardless of localStorage outcome
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    catch(e){ console.warn('[coffee popup] localStorage unavailable, using in-memory state only', e); }
  }

  function showCard(){
    var wrap = document.getElementById('sarvarcCoffeeCard');
    if (!wrap) return;
    var activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') { dbg('[coffee popup] skipped, active input focused'); return; }
    wrap.classList.add('show');
    var s = getState();
    s.lastShown = Date.now();
    setState(s);
  }

  function dismiss(permanent){
    var wrap = document.getElementById('sarvarcCoffeeCard');
    if (wrap) wrap.classList.remove('show');
    var s = getState();
    s.lastShown = Date.now();
    if (permanent) s.hidden = true;
    setState(s);
  }

  // Called by toast() whenever an export/download success message fires.
  window.__sarvarcCoffeeTrigger = function(){
    var s = getState();
    if (s.hidden) { dbg('[coffee popup] permanently dismissed'); return; }

    var daysSinceShown = s.lastShown ? (Date.now() - s.lastShown) / 86400000 : Infinity;
    if (daysSinceShown < RESHOW_AFTER_DAYS) { dbg('[coffee popup] shown recently, skipping'); return; }

    s.exportCount = (s.exportCount || 0) + 1;
    setState(s);
    dbg('[coffee popup] exportCount =', s.exportCount);
    if (s.exportCount <= SKIP_FIRST_N_EXPORTS) return; // let the first export be friction-free

    setTimeout(showCard, SHOW_DELAY_MS);
  };

  document.addEventListener('DOMContentLoaded', function(){
    var closeBtn = document.getElementById('sarvarcCoffeeClose');
    var laterBtn = document.getElementById('sarvarcCoffeeLater');
    var buyBtn = document.getElementById('sarvarcCoffeeBuy');

    if (closeBtn) closeBtn.addEventListener('click', function(){ dismiss(false); });
    if (laterBtn) laterBtn.addEventListener('click', function(){ dismiss(false); });
    if (buyBtn) buyBtn.addEventListener('click', function(){ dismiss(true); });
  });
})();
