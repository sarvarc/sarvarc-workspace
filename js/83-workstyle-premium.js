// Workstyle premium look: headline + arrow on the panel, and a live "Kadessa is working" card.
// It wraps js/61 pieces (wsEnsurePanel, wsShowWait, wsHideWait) and never touches the build logic.
(function () {
  'use strict';
  var STEPS = ['Getting ready', 'Reading your reference and content', 'Building in the editor'];
  var tick = null, t0 = 0, stage = 0;

  function $(id) { return document.getElementById(id); }

  // ── panel: headline above the two boxes, arrow between them ──
  var baseEnsure = window.wsEnsurePanel;
  if (typeof baseEnsure === 'function') {
    window.wsEnsurePanel = function () {
      var panel = baseEnsure.apply(this, arguments);
      try {
        if (panel && !panel.querySelector('.wsx-h')) {
          var head = document.createElement('div');
          head.innerHTML = '<div class="wsx-eye">WORKSTYLE</div><div class="wsx-h">Your content, in their style.</div>' +
            '<p class="wsx-p">Show one reference. Kadessa reads its layout, spacing and colour, then rebuilds your content to match.</p>';
          panel.insertBefore(head, panel.firstChild);
          var cards = panel.querySelector('.ws-cards');
          if (cards && cards.children.length === 2) {
            var a = document.createElement('div'); a.className = 'wsx-arrow'; a.setAttribute('aria-hidden', 'true'); a.textContent = '\u2192';
            cards.insertBefore(a, cards.children[1]);
          }
        }
      } catch (e) { /* the old panel still works without the extras */ }
      return panel;
    };
  }

  // ── live card ──
  function names() {
    var ref = '', n = 0;
    try {
      if (typeof wsRefId !== 'undefined' && wsRefId && typeof wstyleGet === 'function') { var s = wstyleGet(wsRefId); ref = s && s.name ? s.name : ''; }
      if (typeof wsFiles !== 'undefined' && wsFiles) n = wsFiles.length;
    } catch (e) { /* names are only a nicety */ }
    return { ref: ref, files: n };
  }
  function stageFrom(msg) {
    var m = String(msg || '').toLowerCase();
    if (m.indexOf('building in the editor') > -1) return 2;
    if (m.indexOf('reading') > -1) return 1;
    return 0;
  }
  function paint(w) {
    var rows = STEPS.map(function (t, i) {
      var cls = i < stage ? 'done' : (i === stage ? 'now' : '');
      return '<div class="wsx-st ' + cls + '"><span class="wsx-ic">' + (i < stage ? '\u2713' : '') + '</span>' + t + '</div>';
    }).join('');
    w.querySelector('.wsx-steps').innerHTML = rows;
  }
  function secs() { return Math.max(0, Math.round((Date.now() - t0) / 1000)) + 's'; }

  var baseShow = window.wsShowWait;
  window.wsShowWait = function (msg) {
    var w = $('wsWait');
    if (!w) {
      w = document.createElement('div');
      w.id = 'wsWait'; w.className = 'ws-wait wsx-live'; w.setAttribute('role', 'status'); w.setAttribute('aria-live', 'polite');
      var nm = names();
      var sub = (nm.ref ? 'Reference: ' + nm.ref.replace(/</g, '&lt;') : 'Using your reference') + (nm.files ? ' \u00b7 ' + nm.files + (nm.files === 1 ? ' file' : ' files') + ' of yours' : ' \u00b7 your typed content');
      w.innerHTML =
        '<div class="wsx-full"><div class="wsx-eye"><span>KADESSA IS WORKING</span><span class="wsx-tm">0s</span></div>' +
        '<div class="wsx-h">Styling your file</div><p class="wsx-p">' + sub + '</p>' +
        '<div class="wsx-steps"></div><div class="wsx-bar"><i></i></div>' +
        '<div class="wsx-foot"><span>Your page opens here the moment it is ready.</span><button type="button" class="wsx-hide">Hide</button></div></div>' +
        '<div class="wsx-mini"><i class="ws-wait-dot" aria-hidden="true"></i><span class="ws-wait-t">Kadessa is working\u2026</span><button type="button" class="wsx-hide wsx-show" style="background:none;border:0;font:inherit;font-size:11px;font-weight:700;color:#00a8e0;cursor:pointer;text-decoration:underline">Show</button></div>';
      document.body.appendChild(w);
      stage = 0; t0 = Date.now();
      w.querySelector('.wsx-full .wsx-foot .wsx-hide').addEventListener('click', function () { w.classList.add('mini'); });
      w.querySelector('.wsx-show').addEventListener('click', function () { w.classList.remove('mini'); });
      tick = setInterval(function () { var t = w.querySelector('.wsx-tm'); if (t) t.textContent = secs(); }, 1000);
    }
    stage = Math.max(stage, stageFrom(msg));
    paint(w);
  };
  window.wsHideWait = function () {
    if (tick) { clearInterval(tick); tick = null; }
    var w = $('wsWait');
    if (w && w.parentNode) w.parentNode.removeChild(w);
  };
  void baseShow;
})();
