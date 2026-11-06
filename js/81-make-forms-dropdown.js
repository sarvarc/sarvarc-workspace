var SX_SELECTOR = 'select.mf-gd-in';
/* SARVARC themed dropdown.
   Replaces the browser's own <select> list (which CSS cannot style) with a custom list that matches
   the form look. The real <select> stays in the page, hidden, so every existing place that reads
   .value, listens for change events or checks "required" keeps working unchanged. */
(function () {
  if (window.__sxDropdown) return;
  window.__sxDropdown = true;
  var uid = 0;

  function labelFor(sel) {
    try {
      if (sel.labels && sel.labels[0]) return sel.labels[0].textContent.replace(/\s*\*\s*$/, '').trim();
    } catch (e) {}
    var h = sel.closest('.gd-stage, .mf-gd-screen');
    h = h && h.querySelector('h2');
    return h ? h.textContent.replace(/→|Required/g, '').trim() : 'Choose an option';
  }

  function enhance(sel) {
    if (sel.dataset.sx || sel.multiple || sel.size > 1) return;
    sel.dataset.sx = '1';
    var n = ++uid, dark = !!sel.closest('.gd, .mf-gd');
    var wrap = document.createElement('div');
    wrap.className = 'sx ' + (dark ? 'sx-dark' : 'sx-light');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sx-btn';
    btn.setAttribute('role', 'combobox'); btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'sx' + n + '-l');
    btn.setAttribute('aria-label', labelFor(sel));
    var val = document.createElement('span'); val.className = 'sx-val';
    var caret = document.createElement('span'); caret.className = 'sx-caret'; caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(val); btn.appendChild(caret);
    var list = document.createElement('ul');
    list.className = 'sx-list'; list.id = 'sx' + n + '-l'; list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', labelFor(sel));

    var hadFocus = document.activeElement === sel;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn); wrap.appendChild(list); wrap.appendChild(sel);
    sel.classList.add('sx-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    var host = sel.closest('.gd-field, .gform-card');
    if (host && host.classList.contains('gd-field')) host.classList.add('sx-on');

    var items = [], act = 0, typed = '', typedT;

    function opts() {
      return Array.prototype.filter.call(sel.options, function (o) { return o.value !== ''; });
    }
    function placeholder() {
      var b = Array.prototype.filter.call(sel.options, function (o) { return o.value === ''; })[0];
      return b ? b.textContent : 'Choose…';
    }
    function selIndex() {
      var v = sel.value; if (v === '') return -1;
      return opts().findIndex(function (o) { return o.value === v; });
    }
    function paintLabel() {
      var i = selIndex();
      val.textContent = i < 0 ? placeholder() : opts()[i].textContent;
      btn.classList.toggle('sx-ph', i < 0);
    }
    function build() {
      list.textContent = '';
      items = opts().map(function (o, i) {
        var li = document.createElement('li');
        li.className = 'sx-opt'; li.id = 'sx' + n + '-o' + i; li.setAttribute('role', 'option'); li.dataset.i = i;
        var t = document.createElement('span'); t.className = 'sx-t'; t.textContent = o.textContent;
        var ck = document.createElement('span'); ck.className = 'sx-ck'; ck.setAttribute('aria-hidden', 'true'); ck.textContent = '✓';
        li.appendChild(t); li.appendChild(ck); list.appendChild(li); return li;
      });
      paintRows();
    }
    function paintRows() {
      var s = selIndex();
      items.forEach(function (li, i) {
        li.classList.toggle('sx-sel', i === s); li.classList.toggle('sx-act', i === act);
        li.setAttribute('aria-selected', i === s ? 'true' : 'false');
      });
      if (isOpen() && items[act]) btn.setAttribute('aria-activedescendant', items[act].id);
    }
    function isOpen() { return wrap.classList.contains('sx-open'); }
    function keep() { var el = items[act]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    function open() {
      if (isOpen() || !opts().length) return;
      build(); act = Math.max(0, selIndex());
      wrap.classList.remove('sx-up');
      var r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom, need = Math.min(opts().length * 48 + 16, 336);
      if (below < need && r.top > below) wrap.classList.add('sx-up');
      wrap.classList.add('sx-open'); if (host) host.classList.add('sx-host-open');
      btn.setAttribute('aria-expanded', 'true'); paintRows(); keep();
    }
    function close() {
      wrap.classList.remove('sx-open'); if (host) host.classList.remove('sx-host-open');
      btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      var o = opts()[i]; if (!o) return;
      sel.value = o.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      paintLabel(); close(); btn.focus();
    }
    function move(d) { act = (act + d + items.length) % items.length; paintRows(); keep(); }

    btn.addEventListener('click', function () { isOpen() ? close() : open(); });
    btn.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var o = isOpen();
      if (e.key === 'ArrowDown') { e.preventDefault(); o ? move(1) : open(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); o ? move(-1) : open(); }
      else if (e.key === 'Home' && o) { e.preventDefault(); act = 0; paintRows(); keep(); }
      else if (e.key === 'End' && o) { e.preventDefault(); act = items.length - 1; paintRows(); keep(); }
      else if (e.key === 'Escape' && o) { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === ' ') { e.preventDefault(); o ? pick(act) : open(); }
      else if (e.key === 'Enter' && o) { e.preventDefault(); e.stopPropagation(); pick(act); }
      else if (e.key === 'Tab' && o) { close(); }
      else if (e.key.length === 1) {
        typed += e.key.toLowerCase(); clearTimeout(typedT); typedT = setTimeout(function () { typed = ''; }, 600);
        var f = opts().findIndex(function (x) { return x.textContent.toLowerCase().indexOf(typed) === 0; });
        if (f > -1) { if (!o) open(); act = f; paintRows(); keep(); }
      }
    });
    btn.addEventListener('keyup', function (e) { if (e.key === ' ') e.preventDefault(); });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('.sx-opt'); if (li && +li.dataset.i !== act) { act = +li.dataset.i; paintRows(); }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) { var li = e.target.closest('.sx-opt'); if (li) pick(+li.dataset.i); });
    wrap.addEventListener('focusout', function (e) { if (!wrap.contains(e.relatedTarget)) close(); });
    document.addEventListener('pointerdown', function (e) { if (isOpen() && !wrap.contains(e.target)) close(); });
    sel.addEventListener('change', paintLabel);
    // A click on the question's <label> focuses the hidden select; send that focus to the visible button.
    sel.addEventListener('focus', function () { btn.focus(); });

    paintLabel();
    if (hadFocus) btn.focus({ preventScroll: true });
  }

  function scan() {
    var list = document.querySelectorAll(SX_SELECTOR + ':not([data-sx])');
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }
  function start() {
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
