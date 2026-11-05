// ─── PDF Editor: right-panel STUDIO (Canvas Color + Filters) ─────────────────
// Clicking "Canvas Color" (or the Filters chip) no longer pops a small flyout.
// The right panel widens (css/45-pdfed-studio.css) and swaps to a roomy view
// with two tabs: Canvas and Filters. The old controls and every id/onclick are
// re-used as they are (moved into the studio), so the engine in js/19 and
// js/10 is untouched. Closing puts everything back where it was.

var pdfedStudioState = { open: false, tab: 'canvas', built: false, designMarker: null };

// Curated looks. Gradients and "paper" solids. Applying one only stages it in
// the live preview, same as picking a colour by hand: nothing is baked until
// the person presses Apply.
var PDFED_STUDIO_LOOKS = [
  { n: 'Aurora',   m: 'gradient', a: '#00C2FF', b: '#8B5CF6', ang: 135 },
  { n: 'Sunset',   m: 'gradient', a: '#F97316', b: '#EC4899', ang: 135 },
  { n: 'Ocean',    m: 'gradient', a: '#0EA5E9', b: '#1E3A8A', ang: 180 },
  { n: 'Emerald',  m: 'gradient', a: '#10B981', b: '#064E3B', ang: 160 },
  { n: 'Midnight', m: 'gradient', a: '#0F172A', b: '#4338CA', ang: 135 },
  { n: 'Rose Gold',m: 'gradient', a: '#F9A8D4', b: '#FDBA74', ang: 120, light: true },
  { n: 'Gold',     m: 'gradient', a: '#FDE68A', b: '#B45309', ang: 135 },
  { n: 'Mist',     m: 'gradient', a: '#E2E8F0', b: '#94A3B8', ang: 180, light: true },
  { n: 'Ivory',    m: 'solid', a: '#FAF5E9', light: true },
  { n: 'Sepia',    m: 'solid', a: '#F1E4C8', light: true },
  { n: 'Mint',     m: 'solid', a: '#E1F3E8', light: true },
  { n: 'Sky',      m: 'solid', a: '#E0EEFF', light: true }
];

function pdfedStudioLookCss(l) {
  return l.m === 'gradient' ? 'linear-gradient(' + l.ang + 'deg,' + l.a + ',' + l.b + ')' : l.a;
}

function pdfedStudioBuild() {
  if (pdfedStudioState.built) return true;
  var panel = document.getElementById('pdfedRightPanel');
  var body = document.getElementById('pdfedCanvasPanelBody');
  if (!panel || !body) return false;

  var studio = document.createElement('div');
  studio.className = 'pdfed-studio';
  studio.id = 'pdfedStudio';
  studio.setAttribute('data-tab', 'canvas');
  studio.innerHTML =
    '<div class="pds-head">' +
      '<button type="button" class="pds-back" onclick="pdfedStudioClose()" title="Back to the panel">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Panel' +
      '</button>' +
      '<div class="pds-title"><b>Studio</b><span>Canvas colour and image filters</span></div>' +
      '<button type="button" class="pds-x" onclick="pdfedStudioClose()" title="Close (Esc)">&times;</button>' +
    '</div>' +
    '<div class="pds-tabs" id="pdsTabs" data-tab="canvas"><span class="pds-ind"></span>' +
      '<button type="button" class="pds-tab active" id="pdsTabCanvas" onclick="pdfedStudioSetTab(\'canvas\')">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.300 0-1.100.9-2 2-2h2.400c3 0 5.600-2.500 5.600-5.500C22.900 5.500 18 2 12 2z"/></svg>Canvas' +
      '</button>' +
      '<button type="button" class="pds-tab" id="pdsTabDesign" onclick="pdfedStudioSetTab(\'design\')">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.800 4.600L18 9l-4.200 1.400L12 15l-1.800-4.600L6 9l4.200-1.400z"/><path d="M19 15l.8 2.200L22 18l-2.200.8L19 21l-.8-2.200L16 18l2.200-.8z"/></svg>Filters' +
      '</button>' +
    '</div>' +
    '<div class="pds-body">' +
      '<div class="pds-pane active" id="pdsPaneCanvas"></div>' +
      '<div class="pds-pane" id="pdsPaneDesign"></div>' +
    '</div>' +
    '<div class="pds-foot" id="pdsFoot"></div>';
  panel.appendChild(studio);

  // Canvas controls: move the old flyout body in, then add the looks gallery
  // under the live preview and lift the Apply buttons into the sticky footer.
  var paneCanvas = document.getElementById('pdsPaneCanvas');
  paneCanvas.appendChild(body);
  var preview = document.getElementById('pdfedCtintPreview');
  var looks = document.createElement('div');
  looks.innerHTML =
    '<div class="pds-looks-head"><label class="pdfed-ctint-label">Looks</label></div>' +
    '<div class="pds-looks" id="pdsLooks"></div>';
  if (preview && preview.parentNode) preview.parentNode.insertBefore(looks, preview.nextSibling);
  var actions = body.querySelector('.pdfed-ctint-actions');
  if (actions) document.getElementById('pdsFoot').appendChild(actions);
  pdfedStudioRenderLooks();

  pdfedStudioState.built = true;
  return true;
}

function pdfedStudioRenderLooks() {
  var host = document.getElementById('pdsLooks');
  if (!host) return;
  host.innerHTML = '';
  PDFED_STUDIO_LOOKS.forEach(function (l, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pds-look' + (l.light ? ' light' : '');
    b.style.background = pdfedStudioLookCss(l);
    b.title = l.n;
    b.setAttribute('data-i', i);
    b.innerHTML = '<span>' + l.n + '</span>';
    b.onclick = function () { pdfedStudioApplyLook(i); };
    host.appendChild(b);
  });
  pdfedStudioMarkActiveLook();
}

function pdfedStudioApplyLook(i) {
  var l = PDFED_STUDIO_LOOKS[i];
  if (!l || typeof pdfedCanvasTintState === 'undefined') return;
  var s = pdfedCanvasTintState;
  s.mode = l.m;
  s.color1 = l.a;
  if (l.m === 'gradient') { s.color2 = l.b; s.angle = l.ang; }
  s.imageDataUrl = null;
  pdfedCanvasSyncControls();
}

function pdfedStudioMarkActiveLook() {
  var host = document.getElementById('pdsLooks');
  if (!host || typeof pdfedCanvasTintState === 'undefined') return;
  var s = pdfedCanvasTintState;
  host.querySelectorAll('.pds-look').forEach(function (el) {
    var l = PDFED_STUDIO_LOOKS[+el.getAttribute('data-i')];
    var on = l.m === s.mode && l.a.toLowerCase() === String(s.color1).toLowerCase() &&
      (l.m === 'solid' || (l.b.toLowerCase() === String(s.color2).toLowerCase() && l.ang === s.angle));
    el.classList.toggle('active', on);
  });
}

// Called at the end of pdfedCanvasTintRefreshPreview (js/19).
function pdfedStudioOnTintChange() {
  if (pdfedStudioState.built) pdfedStudioMarkActiveLook();
  var dot = document.getElementById('pdsEntryDot');
  if (dot && typeof pdfedCanvasTintCss === 'function' && pdfedCanvasTintState.mode !== 'image') {
    dot.style.background = pdfedCanvasTintCss();
  }
}

function pdfedStudioOpen(tab) {
  if (!pdfedStudioBuild()) return;
  var layout = document.getElementById('pdfedLayout');
  var panel = document.getElementById('pdfedRightPanel');
  if (!layout || !panel) return;
  // The studio needs the right panel showing; expanding it counts as a
  // deliberate choice so the 3-second auto-collapse never fights it.
  if (layout.classList.contains('right-collapsed')) pdfedToggleRightPanel();
  else if (typeof pdfed !== 'undefined') pdfed.rightManuallyToggled = true;
  layout.classList.add('studio-open');
  panel.classList.add('studio-on');
  pdfedStudioState.open = true;
  pdfedStudioSetTab(tab || pdfedStudioState.tab || 'canvas');
  var chev = document.getElementById('pdfedCanvasPanelChevron');
  if (chev) chev.style.transform = 'rotate(90deg)';
}

function pdfedStudioClose() {
  if (!pdfedStudioState.open) return;
  var layout = document.getElementById('pdfedLayout');
  var panel = document.getElementById('pdfedRightPanel');
  pdfedStudioState.open = false;
  // Put the Design section back in the normal panel, hide the live overlay.
  pdfedStudioRestoreDesign();
  var body = document.getElementById('pdfedCanvasPanelBody');
  if (body) body.classList.remove('open');
  if (layout) layout.classList.remove('studio-open');
  if (panel) panel.classList.remove('studio-on');
  var chev = document.getElementById('pdfedCanvasPanelChevron');
  if (chev) chev.style.transform = 'rotate(0deg)';
  if (typeof pdfedCanvasTintRefreshPreview === 'function') pdfedCanvasTintRefreshPreview();
}

function pdfedStudioToggle(tab) {
  if (pdfedStudioState.open && (!tab || tab === pdfedStudioState.tab)) pdfedStudioClose();
  else pdfedStudioOpen(tab);
}

function pdfedStudioRestoreDesign() {
  var sec = document.getElementById('pdfedDesignPanel');
  var mk = pdfedStudioState.designMarker;
  if (sec && mk && mk.parentNode && sec.parentNode !== mk.parentNode) {
    mk.parentNode.insertBefore(sec, mk);
  }
}

function pdfedStudioSetTab(tab) {
  if (tab !== 'design') tab = 'canvas';
  pdfedStudioState.tab = tab;
  var studio = document.getElementById('pdfedStudio');
  var tabs = document.getElementById('pdsTabs');
  if (studio) studio.setAttribute('data-tab', tab);
  if (tabs) tabs.setAttribute('data-tab', tab);
  document.getElementById('pdsTabCanvas').classList.toggle('active', tab === 'canvas');
  document.getElementById('pdsTabDesign').classList.toggle('active', tab === 'design');
  document.getElementById('pdsPaneCanvas').classList.toggle('active', tab === 'canvas');
  document.getElementById('pdsPaneDesign').classList.toggle('active', tab === 'design');

  var body = document.getElementById('pdfedCanvasPanelBody');
  if (body) body.classList.toggle('open', tab === 'canvas');   // 'open' also drives the live overlay on the page

  var sec = document.getElementById('pdfedDesignPanel');
  if (sec) {
    if (tab === 'design') {
      if (!pdfedStudioState.designMarker) {
        pdfedStudioState.designMarker = document.createComment('pdfed-design-home');
        sec.parentNode.insertBefore(pdfedStudioState.designMarker, sec);
      }
      document.getElementById('pdsPaneDesign').appendChild(sec);
      sec.style.display = '';
      if (typeof pdfedRefreshDesignPanel === 'function') pdfedRefreshDesignPanel();
    } else {
      pdfedStudioRestoreDesign();
    }
  }
  if (tab === 'canvas' && typeof pdfedCanvasPresetsRender === 'function') pdfedCanvasPresetsRender();
  if (typeof pdfedCanvasTintRefreshPreview === 'function') pdfedCanvasTintRefreshPreview();
  var bodyEl = document.querySelector('#pdfedStudio .pds-body');
  if (bodyEl) bodyEl.scrollTop = 0;
}

// Small touches on the normal panel: a live colour dot on the Canvas row and
// an "Open studio" chip on the Design section header.
function pdfedStudioDecorate() {
  var trig = document.getElementById('pdfedCanvasPanelTrigger');
  if (trig && !document.getElementById('pdsEntryDot')) {
    var dot = document.createElement('span');
    dot.className = 'pds-dot';
    dot.id = 'pdsEntryDot';
    var first = trig.firstElementChild;
    if (first) first.appendChild(dot);
  }
  var dh = document.querySelector('#pdfedDesignPanel > h5');
  if (dh && !dh.querySelector('.pds-open-chip')) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pds-open-chip';
    chip.title = 'Open the wide Filters studio';
    chip.innerHTML = 'Studio <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    chip.onclick = function (e) { e.stopPropagation(); pdfedStudioOpen('design'); };
    dh.appendChild(chip);
  }
  pdfedStudioOnTintChange();
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && pdfedStudioState.open) pdfedStudioClose();
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pdfedStudioDecorate);
else pdfedStudioDecorate();
