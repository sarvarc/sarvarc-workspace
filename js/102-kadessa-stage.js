// Kadessa "stage" mode: on the empty PDF Editor canvas, her chat opens as a premium rectangular card in the centre,
// not the small corner box. It is the SAME panel (#kadessa-panel), so history, consent notice, attachments and actions
// all keep working. When a file is open (or the screen is too small / too narrow), the stage class comes off and she
// falls back to the normal corner chat box.
(function () {
  var panel = document.getElementById('kadessa-panel'), ph = document.getElementById('pdfedPlaceholder'),
      sec = document.getElementById('sec-pdfeditor'), lay = document.getElementById('pdfedLayout');
  if (!panel || !ph) return;
  var MIN_W = 560, MIN_H = 380, raf = 0;
  function want() {
    if (!panel.classList.contains('open')) return null;
    if (sec && !sec.classList.contains('active')) return null;
    if (window.innerWidth <= 760) return null;                    // phones keep the normal box
    if (ph.style.display === 'none' || !ph.offsetParent) return null;   // a file is open: she goes back to her corner
    var r = ph.getBoundingClientRect(), sc = document.getElementById('pdfedCanvasScroll'), v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    var top = Math.max(r.top, v.top, 0), bot = Math.min(r.bottom, v.bottom, window.innerHeight);   // only the part you can actually see
    if (r.width < MIN_W || bot - top < MIN_H) return null;        // a panel squeezes the canvas
    return { left: r.left, width: r.width, top: top, height: bot - top };
  }
  function apply() {
    raf = 0;
    var r = want(), on = panel.classList.contains('kadessa-stage');
    if (!r) {
      if (on) { panel.classList.remove('kadessa-stage'); document.body.classList.remove('kad-stage'); clear(); }
      return;
    }
    var w = Math.min(760, r.width - 48), h = Math.min(600, r.height - 40);
    var l = Math.round(r.left + (r.width - w) / 2), t = Math.round(r.top + (r.height - h) / 2);
    panel.style.setProperty('--ks-l', l + 'px'); panel.style.setProperty('--ks-t', t + 'px');
    panel.style.setProperty('--ks-w', Math.round(w) + 'px'); panel.style.setProperty('--ks-h', Math.round(h) + 'px');
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
