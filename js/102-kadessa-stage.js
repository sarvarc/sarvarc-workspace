// Kadessa "stage" mode: on the empty PDF Editor canvas, her chat opens as a premium rectangular card in the centre,
// not the small corner box. It is the SAME panel (#kadessa-panel), so history, consent notice, attachments and actions
// all keep working. When a file is open (or the screen is too small / too narrow), the stage class comes off and she
// falls back to the normal corner chat box.
(function () {
  var panel = document.getElementById('kadessa-panel'), ph = document.getElementById('pdfedPlaceholder'),
      sec = document.getElementById('sec-pdfeditor'), lay = document.getElementById('pdfedLayout');
  if (!panel || !ph) return;
  var raf = 0;
  // The chat opens IN PLACE of the "Chat with Kadessa" card: same left edge and width, growing downward over the ready pages.
  // The goals above stay where they are. No card to anchor to, a file open, a phone, or a squeezed canvas = the normal corner box.
  function want() {
    if (!panel.classList.contains('open')) return null;
    if (sec && !sec.classList.contains('active')) return null;
    if (window.innerWidth <= 760) return null;
    if (ph.style.display === 'none' || !ph.offsetParent) return null;   // a file is open: she goes back to her corner
    var kad = ph.querySelector('.pg-kad'); if (!kad) return null;
    var k = kad.getBoundingClientRect(); if (k.height < 120 || k.width < 420) return null;   // goals are tucked (a side panel is open)
    var sc = document.getElementById('pdfedCanvasScroll'), v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    var bottom = Math.min(v.bottom, window.innerHeight) - 14, top = Math.max(k.top, v.top + 8, 8);
    var h = Math.min(560, bottom - top);
    if (h < 380) { top = Math.max(v.top + 8, bottom - 420); h = bottom - top; }   // not enough room below: lift it a little
    if (h < 320) return null;
    return { left: k.left, width: k.width, top: top, height: h };
  }
  function apply() {
    raf = 0;
    var r = want(), on = panel.classList.contains('kadessa-stage');
    if (!r) {
      if (on) { panel.classList.remove('kadessa-stage'); document.body.classList.remove('kad-stage'); clear(); }
      return;
    }
    panel.style.setProperty('--ks-l', Math.round(r.left) + 'px'); panel.style.setProperty('--ks-t', Math.round(r.top) + 'px');
    panel.style.setProperty('--ks-w', Math.round(r.width) + 'px'); panel.style.setProperty('--ks-h', Math.round(r.height) + 'px');
    if (!on) { panel.classList.add('kadessa-stage'); document.body.classList.add('kad-stage'); }
  }
  function clear() { ['--ks-l', '--ks-t', '--ks-w', '--ks-h'].forEach(function (v) { panel.style.removeProperty(v); }); }
  function soon() { if (!raf) raf = requestAnimationFrame(apply); }
  try {
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(panel, { attributes: true, attributeFilter: ['class'] });
      if (lay) new MutationObserver(soon).observe(lay, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(soon).observe(ph, { attributes: true, attributeFilter: ['style', 'class'] });
      if (sec) new MutationObserver(soon).observe(sec, { attributes: true, attributeFilter: ['class'] });
    }
    if (window.ResizeObserver) new ResizeObserver(soon).observe(ph);
    window.addEventListener('resize', soon);
    document.addEventListener('scroll', soon, true);
    soon();
  } catch (e) { console.warn('[kadessa-stage] setup', e); }
})();
