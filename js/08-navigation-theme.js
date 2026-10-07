// ─── NAVIGATION ───
// ─── SIDEBAR TOGGLE ───
let sidebarOpen = true;
let sidebarManuallyToggledInSection = false;
function toggleSidebar(isAuto) {
  if (!isAuto) { pdfed.leftManuallyToggled = true; sidebarManuallyToggledInSection = true; }
  sidebarOpen = !sidebarOpen;
  document.body.classList.toggle('sidebar-collapsed', !sidebarOpen);
}

// ─── MOBILE: sidebar acts as a drawer, so close it once someone taps
// a nav item inside it (picking a tool implies "I'm done with the menu").
// The tap-outside backdrop and hamburger button already call toggleSidebar()
// directly, so this only needs to cover in-drawer nav-item taps. ───
function sm_isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}
document.addEventListener('click', function(e) {
  if (!sm_isMobileViewport()) return;
  const item = e.target.closest('.sidebar .nav-item');
  if (item && document.body.classList.contains('sidebar-collapsed') === false) {
    setTimeout(function() {
      if (sidebarOpen) toggleSidebar(true);
    }, 120);
  }
});

// ─── QUIET-5s AUTO-COLLAPSE for Diagrams & Graphs / Data Arrangement ───
// Same idea as the PDF Editor's 10s auto-collapse below, but on a shorter
// 5s timer and scoped to just the main app sidebar (these two tools don't
// have a right panel to tuck away). Fires once, 5s after the section opens,
// and only if the person hasn't already opened/closed the sidebar
// themselves in that window — a manual toggle always wins.
let sectionAutoCollapseTimer = null;
function scheduleSectionAutoCollapse(sec) {
  clearTimeout(sectionAutoCollapseTimer);
  sidebarManuallyToggledInSection = false;
  sectionAutoCollapseTimer = setTimeout(() => {
    const section = document.getElementById('sec-' + sec);
    if (!section || !section.classList.contains('active')) return; // navigated away before the timer fired
    if (sidebarManuallyToggledInSection) return; // person already made their own call
    if (sidebarOpen) {
      toggleSidebar(true);
      toast('Tucked the sidebar away for more canvas room, the arrow on the edge brings it back anytime', 'info');
    }
  }, 5000);
}
function cancelSectionAutoCollapse() {
  clearTimeout(sectionAutoCollapseTimer);
}

// ── MOBILE CAPABILITY GATE ───────────────────────────────────────────────
// Three tools are built around interactions a touchscreen genuinely can't
// do reliably: PDF Editor's crop/reshape drag handles, Diagrams' freeform
// canvas (drag + multi-select + right-click), and Data Arrangement's dense
// keyboard-driven grid. Rather than let someone open a half-working canvas
// on their phone and think the app is broken, navigate() checks here first
// and shows a short, honest explanation instead of the section itself.
// Everything else (Forms, viewing/editing docs, Redact, Extract, Sessions,
// Dashboard) is unaffected — those work fine on a touch screen.
const SARVARC_MOBILE_GATED_SECTIONS = {
  pdfeditor: {
    title: 'Workspace editor works best on a bigger screen',
    message: "Cropping, reshaping and placing objects rely on small, precise drag handles — much easier to hit with a mouse than a finger. For now, please open SARVARC Workspace on a laptop or desktop to edit here."
  },
  diagrams: {
    title: 'Diagrams & Graphs works best on a bigger screen',
    message: "Building and connecting nodes needs precise dragging and multi-select that don't translate well to touch yet. For now, please open SARVARC Workspace on a laptop or desktop for this one."
  },
  dataarrange: {
    title: 'Data Arrangement works best on a bigger screen',
    message: "This is a dense, spreadsheet-style grid with keyboard navigation and column resizing — it needs more room and a keyboard to be genuinely usable. For now, please open SARVARC Workspace on a laptop or desktop to work on tables."
  }
};

// Touch alone isn't enough (some laptops have touchscreens) and narrow
// width alone isn't enough (a resized desktop window shouldn't be gated) —
// only treat it as a phone when both line up.
function sarvarcIsMobileViewport() {
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  return narrow && touch;
}

// Marks the document once so mobile-only CSS (bigger drag/resize handles,
// see the SARVARC_TOUCH_BRIDGE rules) can target real phones without ever
// touching desktop or resized-desktop-window layouts.
if (sarvarcIsMobileViewport()) {
  document.documentElement.setAttribute('data-sarvarc-touch-mode', '1');
}

// This notice is advisory, not a hard wall: someone who taps "Continue
// anyway" gets remembered for the rest of this tab session (sessionStorage,
// not localStorage — a fresh visit later sees the notice again, since screen
// size or intent may have changed) so they aren't re-nagged every time they
// tap back into the same tool.
let sarvarcMobileGatePendingSection = null;
let SARVARC_MOBILE_GATE_BYPASSED;
try {
  SARVARC_MOBILE_GATE_BYPASSED = new Set(JSON.parse(sessionStorage.getItem('sarvarcMobileGateBypassed') || '[]'));
} catch (e) {
  SARVARC_MOBILE_GATE_BYPASSED = new Set();
}
function sarvarcPersistMobileGateBypass() {
  try { sessionStorage.setItem('sarvarcMobileGateBypassed', JSON.stringify([...SARVARC_MOBILE_GATE_BYPASSED])); } catch (e) {}
}

// Returns true (and shows the notice) if this section should pause right
// now; false if the caller should proceed as normal — either because it's
// not gated, this isn't a phone, or the person already chose to continue
// anyway earlier in this tab. Fails open — if the modal markup is somehow
// missing, it never blocks the user.
function sarvarcMobileGateCheck(sec) {
  const info = SARVARC_MOBILE_GATED_SECTIONS[sec];
  if (!info || !sarvarcIsMobileViewport() || SARVARC_MOBILE_GATE_BYPASSED.has(sec)) return false;
  const overlay = document.getElementById('sarvarcMobileGateOverlay');
  const titleEl = document.getElementById('sarvarcMobileGateTitle');
  const msgEl   = document.getElementById('sarvarcMobileGateMsg');
  if (!overlay || !titleEl || !msgEl) return false;
  sarvarcMobileGatePendingSection = sec;
  titleEl.textContent = info.title;
  msgEl.textContent = info.message;
  overlay.classList.add('open');
  if (typeof swTrack === 'function') swTrack('mobile_gate_shown', { module: sec });
  return true;
}

function sarvarcMobileGateClose() {
  const overlay = document.getElementById('sarvarcMobileGateOverlay');
  if (overlay) overlay.classList.remove('open');
  sarvarcMobileGatePendingSection = null;
}

// "Continue anyway" — remember the choice for this section, close the
// notice, then actually open the section (sarvarcMobileGateCheck will see
// it in the bypass set and step aside this time).
function sarvarcMobileGateContinue() {
  const sec = sarvarcMobileGatePendingSection;
  const overlay = document.getElementById('sarvarcMobileGateOverlay');
  if (overlay) overlay.classList.remove('open');
  sarvarcMobileGatePendingSection = null;
  if (!sec) return;
  SARVARC_MOBILE_GATE_BYPASSED.add(sec);
  sarvarcPersistMobileGateBypass();
  if (typeof swTrack === 'function') swTrack('mobile_gate_continued_anyway', { module: sec });
  navigate(sec);
}

// On first load, the PDF Editor section ships marked active in the HTML
// (nobody has clicked navigate() yet), so a phone landing directly on the
// page would see it before any gate ran. Swap to Dashboard and show the
// same message in that case; if they continue anyway, hand them straight
// back into PDF Editor instead of leaving them stranded on Dashboard.
document.addEventListener('DOMContentLoaded', () => {
  const pdfSection = document.getElementById('sec-pdfeditor');
  if (pdfSection && pdfSection.classList.contains('active') && sarvarcIsMobileViewport()
      && !SARVARC_MOBILE_GATE_BYPASSED.has('pdfeditor')) {
    const dash = document.getElementById('sec-dashboard');
    if (dash) {
      pdfSection.classList.remove('active');
      dash.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => {
        if (n.textContent.trim().toLowerCase().includes('dashboard')) n.classList.add('active');
      });
    }
    sarvarcMobileGateCheck('pdfeditor');
  }
});

// ── SARVARC_TOUCH_BRIDGE ─────────────────────────────────────────────────
// PDF Editor / Diagrams / Data Arrangement were built and tested against
// mouse events (mousedown/mousemove/mouseup) — most of their drag, resize
// and fill-handle logic has no touch equivalent at all. That's the real
// reason the notice above exists. Rather than rewrite ~50 handlers, this
// translates a single finger's touch gestures into the matching synthetic
// mouse events, so the existing logic just works, once someone has tapped
// "Continue anyway" for that section.
//
// How it tells a real drag/resize gesture apart from an ordinary tap or a
// scroll, without a hand-maintained list of every draggable class: every
// one of the app's own mousedown handlers already calls ev.preventDefault()
// right at the top specifically to block native text-selection/drag — so
// after dispatching a synthetic mousedown, checking defaultPrevented on it
// tells us whether real app code just claimed this gesture. If so, we take
// over movement and touch-scrolling for that one finger until it lifts; if
// not (e.g. a normal button, a table cell being tapped to focus it), we
// back off immediately and let the browser behave exactly as it always has.
(function () {
  const GATED_IDS = { pdfeditor: 'sec-pdfeditor', diagrams: 'sec-diagrams', dataarrange: 'sec-dataarrange' };
  // Per-section root to magnify — deliberately just the working surface
  // (page canvas / chart canvas / grid), not toolbars or panels around it,
  // so the clone below stays small and cheap.
  const MAGNIFY_ROOT_IDS = { pdfeditor: 'pdfedCanvasWrap', diagrams: 'dgCanvasZoomWrap', dataarrange: 'daGridWrap' };
  // A handful of controls inside these sections already have their own
  // native mousedown+touchstart pair bound directly (the annotation/drawing
  // canvas, and Diagrams' placed-text move/resize handles) and already
  // work correctly on touch. Bridging those too would fire the underlying
  // handler twice per touch — once via our synthetic mousedown, once via
  // its own real touchstart — so this bridge steps aside for them entirely.
  const NATIVE_TOUCH_SELECTOR = '#pdfedAnnotCanvas, .dg-placed-text';
  let activeTouchId = null, claimed = false, startX = 0, startY = 0, startTarget = null, moved = false;

  function bridgedContainerSection(target) {
    if (!target || !target.closest) return null;
    for (const key in GATED_IDS) {
      if (target.closest('#' + GATED_IDS[key])) return key;
    }
    return null;
  }

  function fireMouse(type, touch, target) {
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: touch.clientX, clientY: touch.clientY,
      screenX: touch.screenX, screenY: touch.screenY,
      button: 0, buttons: type === 'mouseup' ? 0 : 1
    });
    target.dispatchEvent(ev);
    return ev;
  }

  // ── FINGER-CLEAR LOUPE ───────────────────────────────────────────────
  // A thumb covers the exact pixels someone's trying to place a crop edge
  // or a fill handle on — the one thing a mouse cursor never does. While a
  // real drag is in progress (claimed === true, same signal as above), this
  // shows a small live, zoomed mirror of the work area a short distance
  // above the finger, with a crosshair marking the exact touch point, so
  // the finger's own shadow never hides the thing being edited.
  const LOUPE_SIZE = 128, LOUPE_ZOOM = 2.4, LOUPE_GAP = 90, LOUPE_REFRESH_MS = 90;
  let loupeBox = null, loupeInner = null, loupeRootEl = null, loupeRootRect = null, loupeLastRefresh = 0;

  function ensureLoupe() {
    if (loupeBox) return;
    loupeBox = document.createElement('div');
    loupeBox.id = 'sarvarcTouchLoupe';
    loupeBox.innerHTML =
      '<div class="sarvarc-loupe-clip"><div class="sarvarc-loupe-inner"></div></div>' +
      '<div class="sarvarc-loupe-crosshair"></div>';
    document.body.appendChild(loupeBox);
    loupeInner = loupeBox.querySelector('.sarvarc-loupe-inner');
  }

  function loupeContentRootFor(sec) {
    const id = MAGNIFY_ROOT_IDS[sec];
    return id ? document.getElementById(id) : null;
  }

  function refreshLoupeContent() {
    if (!loupeRootEl || !loupeInner) return;
    const rect = loupeRootEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    loupeRootRect = rect;
    const clone = loupeRootEl.cloneNode(true);
    clone.querySelectorAll('script').forEach(n => n.remove());
    clone.style.position = 'absolute';
    clone.style.left = '0'; clone.style.top = '0'; clone.style.margin = '0';
    clone.style.width = rect.width + 'px'; clone.style.height = rect.height + 'px';
    // cloneNode doesn't reliably carry over a <canvas>'s drawn pixels across
    // browsers, so copy each canvas's bitmap onto its clone explicitly —
    // this is what keeps the loupe actually live (PDF page, chart canvas)
    // rather than showing a blank rectangle.
    const liveCanvases = loupeRootEl.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');
    liveCanvases.forEach((c, i) => {
      const cc = cloneCanvases[i];
      if (!cc || !c.width || !c.height) return;
      cc.width = c.width; cc.height = c.height;
      const ctx = cc.getContext('2d');
      if (ctx) { try { ctx.drawImage(c, 0, 0); } catch (e) {} }
    });
    loupeInner.innerHTML = '';
    loupeInner.style.transformOrigin = '0 0';
    loupeInner.appendChild(clone);
  }

  function updateLoupeTransform(touch) {
    if (!loupeRootRect || !loupeInner) return;
    const localX = touch.clientX - loupeRootRect.left;
    const localY = touch.clientY - loupeRootRect.top;
    loupeInner.style.transform =
      'translate(' + (LOUPE_SIZE / 2 - localX * LOUPE_ZOOM) + 'px,' + (LOUPE_SIZE / 2 - localY * LOUPE_ZOOM) + 'px) scale(' + LOUPE_ZOOM + ')';
  }

  function positionLoupeBox(touch) {
    if (!loupeBox) return;
    let x = touch.clientX - LOUPE_SIZE / 2;
    let y = touch.clientY - LOUPE_GAP - LOUPE_SIZE / 2;
    if (y < 8) y = touch.clientY + 40; // not enough room above (finger near top edge) — drop it below instead
    x = Math.max(8, Math.min(window.innerWidth - LOUPE_SIZE - 8, x));
    loupeBox.style.left = x + 'px';
    loupeBox.style.top = y + 'px';
  }

  function showLoupe(sec, touch) {
    loupeRootEl = loupeContentRootFor(sec);
    if (!loupeRootEl) return;
    ensureLoupe();
    loupeBox.classList.add('open');
    refreshLoupeContent();
    loupeLastRefresh = performance.now();
    positionLoupeBox(touch);
    updateLoupeTransform(touch);
  }

  function moveLoupe(touch) {
    if (!loupeBox || !loupeBox.classList.contains('open')) return;
    positionLoupeBox(touch);
    updateLoupeTransform(touch);
    const now = performance.now();
    if (now - loupeLastRefresh >= LOUPE_REFRESH_MS) {
      refreshLoupeContent();
      updateLoupeTransform(touch);
      loupeLastRefresh = now;
    }
  }

  function hideLoupe() {
    if (loupeBox) loupeBox.classList.remove('open');
    loupeRootEl = null; loupeRootRect = null;
  }

  document.addEventListener('touchstart', (e) => {
    if (activeTouchId !== null || e.touches.length !== 1) return; // don't fight pinch-zoom/multi-touch
    if (e.target.closest && e.target.closest(NATIVE_TOUCH_SELECTOR)) return; // already handles touch itself
    const sec = bridgedContainerSection(e.target);
    if (!sec || !SARVARC_MOBILE_GATE_BYPASSED.has(sec)) return;
    const touch = e.touches[0];
    startTarget = e.target;
    startX = touch.clientX; startY = touch.clientY; moved = false;
    const synthDown = fireMouse('mousedown', touch, e.target);
    claimed = synthDown.defaultPrevented; // real drag/resize/fill-handle code just took it
    if (claimed) {
      activeTouchId = touch.identifier;
      e.preventDefault(); // stop the page from also scrolling/zooming under the drag
      showLoupe(sec, touch);
    }
    // If not claimed, do nothing further — leave the touch alone so normal
    // tap/scroll/native-click behavior on buttons, cells, links, etc. is untouched.
  }, { passive: false, capture: true });

  document.addEventListener('touchmove', (e) => {
    if (activeTouchId === null) return;
    const touch = Array.from(e.touches).find(t => t.identifier === activeTouchId);
    if (!touch) return;
    if (Math.abs(touch.clientX - startX) > 2 || Math.abs(touch.clientY - startY) > 2) moved = true;
    e.preventDefault();
    fireMouse('mousemove', touch, document);
    moveLoupe(touch);
  }, { passive: false, capture: true });

  function endTouch(e) {
    if (activeTouchId === null) return;
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchId) || e.changedTouches[0];
    activeTouchId = null;
    hideLoupe();
    if (!touch) return;
    e.preventDefault();
    fireMouse('mouseup', touch, document);
    // preventDefault on touchstart suppressed the browser's own synthetic
    // click — replace it so a tap-without-drag (e.g. selecting a table)
    // still registers as a click where the app expects one.
    if (!moved && startTarget) fireMouse('click', touch, startTarget);
    startTarget = null;
  }
  document.addEventListener('touchend', endTouch, { passive: false, capture: true });
  document.addEventListener('touchcancel', endTouch, { passive: false, capture: true });
})();

function navigate(sec) {
  // Mobile-only canvas tools (PDF Editor, Diagrams, Data Arrangement) get
  // intercepted here, before anything else — same pattern as the Forms/
  // Saved Sessions account gate just below. Returns early only while the
  // notice is showing; "Continue anyway" re-calls navigate(sec) itself.
  if (sarvarcMobileGateCheck(sec)) return;
  // Forms and Saved Sessions are the two account-only areas — intercept
  // before the section actually switches. window.__sarvarcSignedIn is kept
  // in sync by sarvarcAuthUpdateNavUI/onAuthStateChange, so this is a plain
  // synchronous check, not a network call, and never blocks the click.
  if ((sec === 'makeforms' || sec === 'savedsessions') && !window.__sarvarcSignedIn) {
    if (sec === 'makeforms' && typeof sarvarcGateForms === 'function') { sarvarcGateForms(); return; }
    if (sec === 'savedsessions' && typeof sarvarcGateSave === 'function') {
      sarvarcPendingGatedNav = 'savedsessions';
      sarvarcGateSave();
      return;
    }
  }
  const target = document.getElementById('sec-' + sec);
  if (!target) return; // unknown/removed section, fail safe instead of throwing
  swTrack('module_open', { module: sec });
  try { localStorage.setItem('sarvarcLastSection', sec); } catch(e) {}
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => {
    const t = n.textContent.trim().toLowerCase();
    if(sec === 'extract' && t.includes('extract')) n.classList.add('active');
    else if(sec === 'pdfeditor' && (t.includes('workspace') || t.includes('editor'))) n.classList.add('active');
    else if(sec === 'dashboard' && t.includes('dashboard')) n.classList.add('active');
    else if(sec === 'makeforms' && t.includes('make forms')) n.classList.add('active');
    else if(sec === 'dataarrange' && t.includes('data arrangement')) n.classList.add('active');
    else if(sec === 'diagrams' && t.includes('diagrams')) n.classList.add('active');
    else if(sec === 'savedsessions' && t.includes('saved sessions')) n.classList.add('active');
    else if(sec === 'redact' && t.includes('redact pii')) n.classList.add('active');
  });
  if(sec === 'makeforms' && typeof mfBackToGallery === 'function') {
    mfBackToGallery();
  }
  if(sec === 'dataarrange' && typeof daRender === 'function') {
    daRender();
  }
  if(sec === 'dashboard' && typeof dashRenderRecent === 'function') {
    dashRenderRecent();
  }
  if(sec === 'diagrams' && typeof dgRender === 'function') {
    dgRender();
    if (typeof dgFitZoomToHolder === 'function') setTimeout(dgFitZoomToHolder, 0);
  }
  if(sec === 'pdfeditor' && pdfed.active >= 0 && typeof pdfedZoomFit === 'function') {
    setTimeout(pdfedZoomFit, 0);
  }
  if (sec === 'diagrams' || sec === 'dataarrange') {
    scheduleSectionAutoCollapse(sec);
  } else {
    cancelSectionAutoCollapse();
  }
  if (sec === 'savedsessions') {
    smAutoHideDesc();
    if (typeof smOnEnterSavedSessions === 'function') smOnEnterSavedSessions();
  } else if (typeof smStopAutoPoll === 'function') {
    // Leaving the page — stop the background Drive poll, nothing there to refresh.
    smStopAutoPoll();
  }
  if (sec === 'redact' && typeof rdxOnEnter === 'function') {
    rdxOnEnter();
  }
}

// Intro copy on the Saved Sessions page fades away on its own a few seconds
// after the page opens, so the page reads clean once the person already
// knows what it does. Clicking the header icon brings it back any time.
let smDescHideTimer = null;
function smAutoHideDesc() {
  const desc = document.getElementById('smPageDesc');
  if (!desc) return;
  desc.classList.remove('sm-desc-hidden');
  clearTimeout(smDescHideTimer);
  smDescHideTimer = setTimeout(() => { desc.classList.add('sm-desc-hidden'); }, 3000);
}
function smToggleDesc() {
  const desc = document.getElementById('smPageDesc');
  if (!desc) return;
  clearTimeout(smDescHideTimer);
  desc.classList.toggle('sm-desc-hidden');
}

// ─── MORE TOOLS DROPDOWN ───
function toggleMoreTools() {
  if (document.body.classList.contains('sidebar-collapsed')) { toggleSidebar(true); return; }
  document.getElementById('moreToolsHeader').classList.toggle('open');
  document.getElementById('moreToolsBody').classList.toggle('open');
}

// ─── SIDEBAR FOLDER ───
function toggleSidebarFolder() {
  if (document.body.classList.contains('sidebar-collapsed')) { toggleSidebar(true); return; }
  const header = document.getElementById('folderHeader');
  const body   = document.getElementById('folderBody');
  header.classList.toggle('open');
  body.classList.toggle('open');
}

function refreshSidebarFolder() {
  const body    = document.getElementById('folderBody');
  const empty   = document.getElementById('folderEmpty');
  const badge   = document.getElementById('folderBadge');
  const imgs    = state.extractedImages;

  // Clear old thumbs (keep empty msg)
  [...body.querySelectorAll('.sidebar-thumb-item')].forEach(el => el.remove());

  if(imgs.length === 0) {
    empty.style.display = 'block';
    badge.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  badge.style.display = 'inline-block';
  badge.textContent = imgs.length;

  imgs.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'sidebar-thumb-item';
    item.innerHTML = `
      <img src="${img.dataUrl}" alt="">
      <span class="sidebar-thumb-name">${img.name}</span>
      <div class="sidebar-thumb-actions">
        <button class="sth-btn del" title="Delete" onclick="deleteImage(${idx},event)"><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/><path d='M9 6V4h6v2'/></svg></button>
      </div>
    `;
    item.addEventListener('click', e => {
      if(e.target.closest('.sth-btn')) return;
      openPreview(idx, e);
    });
    body.appendChild(item);
  });
}

// ─── THEME ───
// The inline <head> script already restored any saved theme onto
// <html data-theme="..."> before this script ran, so read it back from the
// DOM here instead of assuming 'light' — that's what used to force everyone
// back into light mode on every reload.
let isDark = document.documentElement.dataset.theme === 'dark';
function sarvarcSyncLogo() {
  // Swaps the nav (and splash, which mirrors the nav src) logo between the
  // dark-background and light-background exported marks so it always sits
  // correctly against the current theme.
  var navImg = document.getElementById('sarvarcNavLogo');
  if (!navImg) return;
  var wanted = isDark ? navImg.getAttribute('data-dark-src') : navImg.getAttribute('data-light-src');
  if (wanted && navImg.getAttribute('src') !== wanted) navImg.setAttribute('src', wanted);
}
sarvarcSyncLogo();
function toggleTheme() {
  isDark = !isDark;
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  try { localStorage.setItem('sarvarcTheme', isDark ? 'dark' : 'light'); } catch (e) {}
  sarvarcSyncLogo();
  // Re-render PDF editor canvas if it's active so it picks up new CSS vars
  if (typeof pdfed !== 'undefined' && pdfed.active >= 0) {
    pdfedGoto(pdfed.active);
  }
  toast(isDark ? 'Dark mode' : 'Light mode', 'info');
}
