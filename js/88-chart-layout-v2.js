// Chart builder layout v2 (see css/53-chart-layout-v2.css).
// Moves existing nodes only (ids and handlers stay), nothing is rebuilt.
(function () {
  function init() {
    var tabs = document.getElementById('dgModeTabs');
    var bar = document.getElementById('dgRibbonBar');
    var panel = document.getElementById('dgInsightsPanel');
    var prev = document.querySelector('.dg-preview-toolbar');
    if (!tabs || !bar || !panel || !prev || document.body.classList.contains('dg-v2')) return;

    // 1) finishing actions go to the top-right of the tab row
    var acts = document.createElement('div');
    acts.className = 'dg-ribbon-bar dg-v2-actions';
    acts.id = 'dgV2Actions';
    ['dgUndoGroup', 'dgClearGroup', 'dgHistoryGroup', 'dgExportGroup', 'dgPushGroup'].forEach(function (id) {
      var g = document.getElementById(id);
      if (g) acts.appendChild(g);
    });
    var tog = document.getElementById('dgRibbonToggleBtn');
    tabs.insertBefore(acts, tog || null);

    // 2) group captions on the build row
    function cap(text, beforeId) {
      var el = document.getElementById(beforeId);
      if (!el) return;
      var s = document.createElement('span'); s.className = 'dg-v2-cap'; s.textContent = text;
      el.parentNode.insertBefore(s, el);
    }
    // orphaned dividers left behind in the build row, and a clean divider set for the action row
    Array.prototype.slice.call(bar.querySelectorAll(':scope > .dg-rbn-sep')).forEach(function (x) { x.remove(); });
    var kids = Array.prototype.slice.call(acts.children);
    kids.forEach(function (k, i) { if (i > 0 && (k.id === 'dgHistoryGroup' || k.id === 'dgPushGroup')) { var sp = document.createElement('span'); sp.className = 'dg-rbn-sep'; acts.insertBefore(sp, k); } });
    cap('Chart', 'dgTypeGroup'); cap('Style', 'dgColourGroup'); cap('Data', 'dgUploadGroup');

    // 3) panel tabs: Insights | Chart options
    var head = panel.querySelector('.dg-insights-head');
    var scroll = panel.querySelector('.dg-insights-scroll');
    var pt = document.createElement('div'); pt.className = 'dg-v2-ptabs';
    pt.innerHTML = '<button type="button" class="on" data-t="ins">Insights</button><button type="button" data-t="opt">Chart options</button>';
    panel.insertBefore(pt, scroll);
    var opts = document.createElement('div'); opts.className = 'dg-v2-opts'; opts.id = 'dgV2Opts';
    panel.insertBefore(opts, scroll.nextSibling);

    var axes = document.getElementById('dgQuickAxisGroup');
    var cols = document.getElementById('dgColumnsGroup');
    var show = prev.querySelector('.dg-show-toggles');
    var zoom = prev.querySelector('.dg-zoom-controls');
    function lab(t) { var d = document.createElement('div'); d.className = 'dg-v2-flabel'; d.textContent = t; return d; }
    opts.appendChild(lab('Axes'));
    if (axes) opts.appendChild(axes);
    if (cols) opts.appendChild(cols);
    opts.appendChild(lab('Show on chart'));
    if (show) opts.appendChild(show);
    opts.appendChild(lab('Zoom'));
    if (zoom) opts.appendChild(zoom);

    pt.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-t]'); if (!b) return;
      pt.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      panel.classList.toggle('dg-v2-showopts', b.getAttribute('data-t') === 'opt');
    });
    document.body.classList.add('dg-v2');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
