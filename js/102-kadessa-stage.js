// Kadessa at home: on the EMPTY PDF Editor screen she is the "Chat with Kadessa" card in the centre, and only there (no corner button).
// Type what you want and press Enter: the card hands over to her normal corner box, which glides out of the card.
// Open a file, or open her any other way: she is in the corner and her round button settles in. Close the file and she is back in the centre.
// Same one panel (#kadessa-panel) and same logic as ever; this file only decides where she is, and animates the move.
(function () {
  var panel = document.getElementById('kadessa-panel'), launcher = document.getElementById('kadessa-launcher'), ph = document.getElementById('pdfedPlaceholder'),
      sec = document.getElementById('sec-pdfeditor'), lay = document.getElementById('pdfedLayout');
  if (!panel || !ph) return;
  var EASE = 'cubic-bezier(.22,.8,.2,1)', raf = 0, lastCard = null, wasHome = null, wasOpen = false;
  function calm() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && !!panel.animate; }
  function card() { return ph.querySelector('.pg-kad'); }
  // "Home" = she is the centre card: the empty editor is showing, the card is on screen, and her corner box is closed.
  function cardRect() {
    var c = card(); if (!c || !ph.offsetParent || ph.style.display === 'none') return null;
    if (sec && !sec.classList.contains('active')) return null;
    var r = c.getBoundingClientRect(); return (r.width > 40 && r.height > 40) ? r : null;
  }
  function glide(from) {
    var to = panel.getBoundingClientRect(); if (!calm() || !from || !to.width) return;
    // keep the start inside the screen, so a card scrolled out of view still gives a short, calm glide
    var t = Math.min(Math.max(from.top, 60), window.innerHeight - 80), f = { left: from.left, top: t, width: from.width, height: Math.min(from.height, 200) };
    function box(r, rad) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', right: 'auto', bottom: 'auto', borderRadius: rad }; }
    var st = panel.style.transition, an = panel.style.animation;
    panel.style.transition = 'none'; panel.style.animation = 'none';          // her own open fade and easing would fight the glide
    try { panel.animate([box(f, '22px'), box(to, '14px')], { duration: 520, easing: EASE }); } catch (e) {}
    setTimeout(function () { panel.style.transition = st; panel.style.animation = an; }, 560);
  }
  function settleLauncher(delay) {
    if (launcher && launcher.animate && calm()) try { launcher.animate([{ opacity: 0, transform: 'scale(.72)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: delay, easing: EASE, fill: 'backwards' }); } catch (e) {}
  }
  function apply() {
    raf = 0;
    var open = panel.classList.contains('open'), r = cardRect(), home = !!r && !open;
    document.body.classList.toggle('kad-home', home);        // corner button hides while she is the centre card
    document.body.classList.toggle('kad-away', !!r && open); // card steps aside while her corner box is open (she is only in one place)
    if (home) lastCard = r;
    if (open && !wasOpen && lastCard && wasHome) { glide(lastCard); settleLauncher(260); }   // sent from the card: the box glides out of it
    else if (wasHome === true && !home && !open) settleLauncher(120);                       // a file opened: she is in the corner now
    if (!open) lastCard = home ? r : lastCard;
    wasOpen = open; wasHome = home;
  }
  function soon() { if (!raf) raf = requestAnimationFrame(apply); }
  try {
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(panel, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(soon).observe(ph, { attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true });
      if (lay) new MutationObserver(soon).observe(lay, { attributes: true, attributeFilter: ['class'] });
      if (sec) new MutationObserver(soon).observe(sec, { attributes: true, attributeFilter: ['class'] });
    }
    if (window.ResizeObserver) new ResizeObserver(soon).observe(ph);
    window.addEventListener('resize', soon);
    document.addEventListener('scroll', soon, true);
    soon();
  } catch (e) { console.warn('[kadessa-home] setup', e); }
})();
