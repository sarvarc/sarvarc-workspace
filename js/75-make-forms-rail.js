/* ===== MAKE FORMS > DESIGN: icon rail + slide-out panel =====
 * The old left column (look, logo, colours, social, description, expiry, add-a-field, field list)
 * was one long scroll that squeezed the Live Preview. Here the SAME nodes are regrouped into six
 * topics. A slim rail of icons (like the Sign desk dock) opens one topic at a time; closed, the
 * preview takes the full width.
 *
 * Nothing is re-created: every element keeps its id and its inline handlers, so all the code in
 * 41/73/74 keeps working. This file only moves nodes and toggles classes.
 * Public: window.mfRailOpen(id), window.mfRailClose().
 */
(function () {
  'use strict';

  function svg(inner) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  var SECS = [
    { id: 'look', label: 'Look', title: 'Form look', sub: 'Style, template and animation',
      icon: svg('<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2a5.55 5.55 0 0 0 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>') },
    { id: 'fields', label: 'Questions', title: 'Questions', sub: 'Add fields, then type their labels',
      icon: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
    { id: 'brand', label: 'Brand', title: 'Brand', sub: 'Logo, header image and accent colour',
      icon: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>') },
    { id: 'details', label: 'Details', title: 'Details', sub: 'Description and social links',
      icon: svg('<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>') },
    { id: 'files', label: 'Files', title: 'Attachments', sub: 'Files people can open on the live form',
      icon: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>') },
    { id: 'expiry', label: 'Expiry', title: 'Form expiration', sub: 'Stop accepting responses automatically',
      icon: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>') }
  ];

  var body, panel, slot, rail, headTitle, headSub, secEls = {}, btnEls = {};
  var cur = null, touched = false, lastCount = 0;

  function build() {
    body = document.getElementById('mfEditorBodyDesign');
    panel = body && body.querySelector('.mf-fields-panel');
    if (!body || !panel || body.classList.contains('mfr-on')) return false;

    // ---- pick up the existing pieces (by id / class, nothing is cloned) ----
    var look = document.getElementById('mfLookCard');
    var addRow = panel.querySelector('.mf-add-field-row');
    var list = document.getElementById('mfFieldList');
    var brandRow = panel.querySelector('.mf-brand-row');
    var logoBlock = brandRow && brandRow.querySelector('.mf-brand-logo-block');
    var attach = brandRow && brandRow.querySelector('.mf-attach-block');
    var colorBlock = brandRow && brandRow.querySelector('.mf-brand-color-block');
    var social = panel.querySelector('.mf-social-row');
    var expiry = document.getElementById('mfExpiryRow');
    var desc = null;
    panel.querySelectorAll('.mf-desc-row').forEach(function (r) { if (r !== expiry && !desc) desc = r; });

    // ---- sections ----
    SECS.forEach(function (s) {
      var el = document.createElement('section');
      el.className = 'mfr-sec'; el.setAttribute('data-sec', s.id);
      secEls[s.id] = el;
    });
    function put(id) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) secEls[id].appendChild(arguments[i]); }
    put('look', look);
    put('fields', addRow, list);
    put('brand', logoBlock, colorBlock);   // attachments are lifted out of the logo block below
    put('details', desc, social);
    put('files', attach);
    put('expiry', expiry);
    if (brandRow && brandRow.parentNode) brandRow.parentNode.removeChild(brandRow);

    // ---- panel header ----
    var head = document.createElement('div');
    head.className = 'mfr-head';
    head.innerHTML = '<div><b id="mfrTitle"></b><small id="mfrSub"></small></div>' +
      '<button type="button" class="mfr-x" id="mfrClose" aria-label="Close panel" title="Close (Esc)">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>';
    panel.insertBefore(head, panel.firstChild);
    SECS.forEach(function (s) { panel.appendChild(secEls[s.id]); });
    headTitle = head.querySelector('#mfrTitle'); headSub = head.querySelector('#mfrSub');
    head.querySelector('#mfrClose').addEventListener('click', function () { touched = true; close(); });

    // ---- slot that animates open/closed, and the rail ----
    slot = document.createElement('div');
    slot.className = 'mfr-slot'; slot.id = 'mfrSlot';
    panel.parentNode.insertBefore(slot, panel);
    slot.appendChild(panel);

    rail = document.createElement('nav');
    rail.className = 'mfr-rail'; rail.setAttribute('aria-label', 'Form tools');
    SECS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'mfr-btn'; b.setAttribute('data-sec', s.id);
      b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'mfrSlot');
      b.title = s.title + ' — ' + s.sub;
      b.innerHTML = s.icon + '<span>' + s.label + '</span>' + (s.id === 'fields' ? '<i class="mfr-badge" id="mfrCount"></i>' : '');
      b.addEventListener('click', function () { touched = true; if (cur === s.id) close(); else open(s.id); });
      rail.appendChild(b); btnEls[s.id] = b;
    });
    body.insertBefore(rail, slot);

    body.classList.add('mfr-on');
    slot.inert = true;
    return true;
  }

  // The grid animates its column width; re-measure the A4 page breaks once it has settled.
  var settleT = 0;
  function settle() {
    clearTimeout(settleT);
    settleT = setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 320);
  }

  function open(id) {
    var s = SECS.filter(function (x) { return x.id === id; })[0]; if (!s || !body) return;
    cur = id;
    SECS.forEach(function (x) {
      secEls[x.id].classList.toggle('on', x.id === id);
      btnEls[x.id].classList.toggle('on', x.id === id);
      btnEls[x.id].setAttribute('aria-expanded', x.id === id ? 'true' : 'false');
    });
    headTitle.textContent = s.title; headSub.textContent = s.sub;
    panel.scrollTop = 0;
    slot.inert = false;
    body.classList.add('mfr-open');
    settle();
  }

  function close() {
    if (!body) return;
    cur = null;
    SECS.forEach(function (x) { btnEls[x.id].classList.remove('on'); btnEls[x.id].setAttribute('aria-expanded', 'false'); });
    body.classList.remove('mfr-open');
    slot.inert = true;
    settle();
  }

  window.mfRailOpen = function (id) { if (build() || body) open(id); };
  window.mfRailClose = function () { close(); };

  // ---- small live touches ----
  function countFields() { return document.querySelectorAll('#mfFieldList .mf-field-item').length; }
  function watchList() {
    var list = document.getElementById('mfFieldList'); if (!list) return;
    lastCount = countFields();
    function paint() { var c = document.getElementById('mfrCount'); if (c) c.textContent = lastCount ? String(lastCount) : ''; }
    paint();
    new MutationObserver(function () {
      var n = countFields(), grew = n === lastCount + 1 && lastCount > 0;
      lastCount = n; paint();
      // a field was just added: bring it into view inside the panel
      if (grew && cur === 'fields' && panel) panel.scrollTop = panel.scrollHeight;
    }).observe(list, { childList: true });
  }

  // A brand-new, empty form opens straight on Questions so nobody stares at a blank preview.
  function watchEditor() {
    var ed = document.getElementById('mfEditorView'); if (!ed) return;
    var wasShown = ed.style.display !== 'none';
    new MutationObserver(function () {
      var shown = ed.style.display !== 'none';
      if (shown && !wasShown && !touched) {
        setTimeout(function () {
          var f = typeof mfGetCurrentForm === 'function' ? mfGetCurrentForm() : null;
          if (f && f.fields && f.fields.length === 0 && cur !== 'fields') open('fields');
        }, 160);
      }
      wasShown = shown;
    }).observe(ed, { attributes: true, attributeFilter: ['style'] });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !cur || !body) return;
    var a = document.activeElement;
    if (a && (slot.contains(a) || rail.contains(a))) { touched = true; close(); }
  });

  function init() { if (build()) { watchList(); watchEditor(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
