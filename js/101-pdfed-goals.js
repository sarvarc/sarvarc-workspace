// PDF Editor: Goals on the empty editor screen.
// Six everyday jobs, each one tap. Every card calls the same function as the sidebar item or ribbon button,
// so nothing new is created and nothing is moved. Shown only while no document is open (inside #pdfedPlaceholder).
(function () {
  function ic(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  function go(page) { return function () { if (typeof navigate === 'function') navigate(page); }; }
  var GOALS = [
    { t: 'Clean up my data', s: 'Clean up', d: 'Fixes duplicates, spacing and messy columns in Data Arrangement.', run: go('dataarrange'),
      i: ic('<path d="M4 20l7-7"/><path d="M13 5l1.2 2.8L17 9l-2.8 1.2L13 13l-1.2-2.8L9 9l2.8-1.2z"/><path d="M18 14l.7 1.6L20.3 16l-1.6.7L18 18.3l-.7-1.6L15.7 16l1.6-.4z"/>') },
    { t: 'Build charts from my data', s: 'Charts', d: 'Turns any table into a clear chart in Diagrams & Graphs.', run: go('diagrams'),
      i: ic('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>') },
    { t: 'Clone a format I like', s: 'Clone', d: 'Show a reference, add your content, and Workstyle rebuilds it the same way.', run: function () { if (typeof wsToggle === 'function') wsToggle(); },
      i: ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>') },
    { t: 'Pull images out of a file', s: 'Images', d: 'Extracts every picture from a PDF or document.', run: go('extract'),
      i: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>') },
    { t: 'Hide private information', s: 'Redact', d: 'Covers names, numbers and personal details with Redact PII.', run: go('redact'),
      i: ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12h6"/>') },
    { t: 'Collect answers with a form', s: 'Form', d: 'Builds a shareable form in Make Forms.', run: go('makeforms'),
      i: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>') }
  ];
  var QUESTION = 'What would you like to start with?', IDLE = 'Pick one and I\u2019ll take you straight there.';
  function hello() { var h = new Date().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function build() {
    var box = document.createElement('div'); box.id = 'pgGoals'; box.className = 'pg-goals';
    var words = QUESTION.split(' ').map(function (w, i) { return '<span class="pg-w" style="animation-delay:' + (0.08 + i * 0.06).toFixed(2) + 's">' + w + '</span>'; }).join(' ');
    box.innerHTML = '<div class="pg-ask">' +
      '<div class="pg-eyebrow">' + hello() + '</div><h3 class="pg-q">' + words + '</h3><div class="pg-say" aria-live="polite">' + IDLE + '</div></div>';
    var say = box.querySelector('.pg-say'), timer = 0;
    function speak(txt) {   // the line under the question answers whatever you point at
      if (say.textContent === txt) return; clearTimeout(timer); say.classList.add('pg-swap');
      timer = setTimeout(function () { say.textContent = txt; say.classList.remove('pg-swap'); }, 130);
    }
    var grid = document.createElement('div'); grid.className = 'pg-grid';
    GOALS.forEach(function (g, n) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pg-card'; b.title = g.t;
      b.innerHTML = '<span class="pg-ico">' + g.i + '</span><span class="pg-body"><span class="pg-t">' + g.t + '</span><span class="pg-s">' + g.s + '</span></span><span class="pg-key" aria-hidden="true">' + (n + 1) + '</span>';
      b.onclick = function () { try { g.run(); } catch (e) { console.warn('[goals]', g.t, e); } };
      b.onmouseenter = b.onfocus = function () { speak(g.d); };
      b.onmouseleave = b.onblur = function () { speak(IDLE); };
      grid.appendChild(b);
    });
    box.appendChild(grid);
    box.appendChild(kadessaBox(speak));
    return box;
  }
  // The Kadessa box: type what you need and press Enter, or just click to open her. Uses her own launcher and form,
  // so her consent step, history and actions all behave exactly as when opened from the corner.
  var KAD_SAY = 'Not sure where to begin? Tell Kadessa and she\u2019ll open the right tool for you.';
  function askKadessa(text) {
    var panel = document.getElementById('kadessa-panel'), launcher = document.getElementById('kadessa-launcher'),
        input = document.getElementById('kadessa-input'), form = document.getElementById('kadessa-form');
    if (!panel || !launcher || !input || !form) return;
    if (!panel.classList.contains('open')) launcher.click();
    if (text) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); }
    else input.focus();
  }
  function kadessaBox(speak) {
    var core = document.getElementById('kadessa-launcher-core'), card = document.createElement('div'); card.className = 'pg-kad';
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    card.innerHTML = '<span class="pg-kav">' + (core && core.src ? '<img alt="" src="' + core.src + '">' : 'K') + '</span>' +
      '<div class="pg-kt">Chat with Kadessa</div><div class="pg-ks">Your workspace copilot \u2014 get things done, faster.</div>' +
      '<div class="pg-krow"><input class="pg-kin" type="text" autocomplete="off" aria-label="Ask Kadessa anything" placeholder="Ask Kadessa anything\u2026">' +
      '<button type="button" class="pg-kic pg-kat" title="Attach files" aria-label="Attach files">' + ic('<path d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>') + '</button>' +
      (SR ? '<button type="button" class="pg-kic pg-kmic" title="Speak" aria-label="Speak">' + ic('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>') + '</button>' : '') +
      '<button type="button" class="pg-kgo" title="Ask Kadessa" aria-label="Ask Kadessa">' + ic('<path d="M5 12h14M13 6l6 6-6 6"/>') + '</button></div>';
    var inp = card.querySelector('.pg-kin');
    function go() { var t = inp.value.trim(); inp.value = ''; inp.blur(); try { askKadessa(t); } catch (e) { console.warn('[goals] kadessa', e); } }
    card.querySelector('.pg-kgo').onclick = go;
    card.querySelector('.pg-kat').onclick = function () {   // open her, then her own file picker
      try { askKadessa(''); var f = document.getElementById('kadessa-attach-input'); if (f) f.click(); } catch (e) { console.warn('[goals] attach', e); }
    };
    var mic = card.querySelector('.pg-kmic');
    if (mic) mic.onclick = function () {
      try {
        var r = new SR(); r.lang = document.documentElement.lang || 'en-IN'; r.interimResults = false;
        mic.classList.add('pg-live');
        r.onresult = function (ev) { inp.value = (inp.value + ' ' + ev.results[0][0].transcript).trim(); };
        r.onend = r.onerror = function () { mic.classList.remove('pg-live'); inp.focus(); };
        r.start();
      } catch (e) { mic.classList.remove('pg-live'); }
    };
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    inp.onfocus = card.onmouseenter = function () { speak(KAD_SAY); };
    card.onmouseleave = function () { if (document.activeElement !== inp) speak(IDLE); };
    inp.onblur = function () { speak(IDLE); };
    card.onclick = function (e) { if (e.target === card || e.target.closest('.pg-kav,.pg-kt,.pg-ks')) inp.focus(); };
    return card;
  }
  // Keys 1 to 6 pick a goal while the empty screen is showing and nobody is typing.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^[1-6]$/.test(e.key)) return;
    var box = document.getElementById('pgGoals'), t = e.target;
    if (!box || !box.offsetParent || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) return;
    var sec = document.getElementById('sec-pdfeditor'); if (!sec || !sec.classList.contains('active')) return;
    var g = GOALS[+e.key - 1]; if (g) { e.preventDefault(); try { g.run(); } catch (x) { console.warn('[goals]', x); } }
  });
  function inject() {
    var ph = document.getElementById('pdfedPlaceholder'); if (!ph || document.getElementById('pgGoals')) return;
    var box = build(), ready = document.getElementById('cpStart');
    if (ready && ready.parentNode === ph) ph.insertBefore(box, ready); else ph.appendChild(box);
  }
  // Tuck in when a panel (Templates, Studio, Workstyle...) narrows the screen, open up again when it closes.
  // Measured by width, so any present or future panel works. Small hysteresis stops flicker at the edge.
  function setMini(box, mini, instant) {
    if (box.classList.contains('pg-mini') === mini) return;
    var cards = Array.prototype.slice.call(box.querySelectorAll('.pg-card'));
    var calm = !instant && (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var first = cards.map(function (c) { return c.getBoundingClientRect(); });
    box.classList.toggle('pg-mini', mini);
    if (!calm || !cards[0].animate) return;
    cards.forEach(function (c, i) {
      var a = first[i], z = c.getBoundingClientRect();
      if (!a.width || !z.width) return;
      c.animate([
        { transform: 'translate(' + (a.left - z.left) + 'px,' + (a.top - z.top) + 'px)', width: a.width + 'px', height: a.height + 'px' },
        { transform: 'none', width: z.width + 'px', height: z.height + 'px' }
      ], { duration: 420, delay: i * 18, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    });
  }
  // Tuck in (and fold the Kadessa box away) while the main left (Pages) and right (Panel) panels are both open, or Kadessa herself is open, or when any other panel (Templates, Studio,
  // Workstyle...) leaves the screen narrow. Collapse the panels with the edge arrows and the cards grow back.
  // Width has a small buffer (620 in, 640 out) so it never flickers. Not used on phones, where the cards already stack.
  function watch() {
    var ph = document.getElementById('pdfedPlaceholder'), box = document.getElementById('pgGoals'), lay = document.getElementById('pdfedLayout');
    if (!ph || !box || !window.ResizeObserver) return;
    var first = true, timer = 0;
    function decide() {
      var w = ph.getBoundingClientRect().width;
      if (w < 100) return;                    // hidden (a document is open)
      var open = lay && !lay.classList.contains('left-collapsed') && !lay.classList.contains('right-collapsed');
      var narrow = box.classList.contains('pg-mini') ? w < 640 : w < 620;
      setMini(box, window.innerWidth > 760 && (open || narrow), first); first = false;
    }
    function soon() { clearTimeout(timer); timer = setTimeout(decide, first ? 0 : 150); }   // wait for the panel slide to settle
    new ResizeObserver(soon).observe(ph);
    if (lay && window.MutationObserver) new MutationObserver(soon).observe(lay, { attributes: true, attributeFilter: ['class'] });
    var kpn = document.getElementById('kadessa-panel');
    if (kpn && window.MutationObserver) new MutationObserver(soon).observe(kpn, { attributes: true, attributeFilter: ['class'] });
    decide();
  }
  try { inject(); watch(); } catch (e) { console.warn('[goals] setup', e); }
})();
