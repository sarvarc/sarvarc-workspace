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
    var kad = ph.querySelector('.pg-kad'), k = kad ? kad.getBoundingClientRect() : null;
    var r = ph.getBoundingClientRect(), sc = document.getElementById('pdfedCanvasScroll'), v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    var vtop = Math.max(v.top, 0) + 8, bottom = Math.min(v.bottom, window.innerHeight) - 14;
    if (r.width < 520 || bottom - vtop < 340) return null;        // a side panel squeezes the canvas too much
    var left, width, top, h;
    if (k && k.height >= 120 && k.width >= 420) {                 // grow out of the Kadessa card, where it sits
      width = Math.min(760, r.width - 48); left = r.left + (r.width - width) / 2; top = Math.max(k.top, vtop); h = Math.min(560, bottom - top);
      if (h < 380) { top = Math.max(vtop, bottom - 420); h = bottom - top; }
    } else {                                                      // no card to anchor to: centre it on the canvas
      width = Math.min(760, r.width - 48); left = r.left + (r.width - width) / 2; h = Math.min(560, bottom - vtop); top = vtop + (bottom - vtop - h) / 2;
    }
    if (h < 320) return null;
    return { left: left, width: width, top: top, height: h };
  }
  // Smooth hand-over between the centre card and her corner place: the panel glides from where it was to where it is going
  // (position, size and corner radius together), and her corner button settles in as she arrives. No bounce, no flash.
  var EASE = 'cubic-bezier(.22,.8,.2,1)', prevOpen = false;
  function calm() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && !!panel.animate; }
  function glide(from, toStage) {
    if (!calm() || !from || !from.width) { panel.style.transition = ''; return; }
    var to = panel.getBoundingClientRect(); if (!to.width) return;
    function box(r, rad) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', right: 'auto', bottom: 'auto', borderRadius: rad }; }
    var rf = toStage ? '14px' : '22px', rt = toStage ? '22px' : '14px';
    try { panel.animate([box(from, rf), box(to, rt)], { duration: 520, easing: EASE }); } catch (e) {}
    setTimeout(function () { panel.style.transition = ''; }, 560);   // the panel's own width/height easing returns once she has arrived
    if (!toStage) {   // she has arrived in her corner: the round button settles in just after
      var l = document.getElementById('kadessa-launcher');
      if (l && l.animate) try { l.animate([{ opacity: 0, transform: 'scale(.72)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 260, easing: EASE, fill: 'backwards' }); } catch (e) {}
    }
  }
  function apply() {
    raf = 0;
    var r = want(), on = panel.classList.contains('kadessa-stage'), was = prevOpen, first = null;
    prevOpen = panel.classList.contains('open');
    if (!r) {
      if (on) {
        first = panel.getBoundingClientRect(); if (calm()) panel.style.transition = 'none';   // her own width/height easing would fight the glide
        panel.classList.remove('kadessa-stage'); document.body.classList.remove('kad-stage'); clear();
        glide(first, false);
      }
      return;
    }
    if (!on && was) { first = panel.getBoundingClientRect(); if (calm()) panel.style.transition = 'none'; }   // already open in the corner: glide to the centre instead of the fresh-open fade
    panel.style.setProperty('--ks-l', Math.round(r.left) + 'px'); panel.style.setProperty('--ks-t', Math.round(r.top) + 'px');
    panel.style.setProperty('--ks-w', Math.round(r.width) + 'px'); panel.style.setProperty('--ks-h', Math.round(r.height) + 'px');
    if (!on) {
      panel.classList.toggle('ks-glide', !!first && calm());
      panel.classList.add('kadessa-stage'); document.body.classList.add('kad-stage');
      if (first) glide(first, true);
    }
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
