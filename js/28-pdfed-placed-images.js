// ─── PLACED IMAGE LAYER (persistent, movable, lockable, Canva-style) ────────

// Re-renders all placed images for the given page as DOM overlay elements.
function pdfedRenderPlacedImages(idx) {
  const layer = document.getElementById('pdfedPlacedImagesLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const pg = pdfed.pages[idx];
  if (pg) pdfedGetZOrderedItems(pg); // seeds zIndex on any legacy/missing items
  const list = (pg && pg.placedImages) || [];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pc || !pc.width) return;

  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'pdfed-placed-img' + (item.locked ? ' locked' : '');
    el.dataset.id = item.id;
    el.style.cssText = `position:absolute;box-sizing:border-box;
      border-radius:4px;user-select:none;
      pointer-events:${item.locked ? 'none' : 'auto'};
      cursor:${item.locked ? 'default' : 'move'};
      z-index:${item.zIndex || 0};`;

    // Rotation-carrying inner wrapper: this (and its children, the picture +
    // resize/rotate handles) receives the rotate() transform. The visible
    // border now lives here too (not on `el`), so it turns right along with
    // the picture instead of staying frozen/axis-aligned. The badge row
    // below stays a direct child of `el`, so it still stays upright and
    // axis-aligned no matter how the image is spun — including the moment
    // it's created fresh (e.g. right after a lock/unlock, which fully
    // rebuilds this element). MUST be created and attached BEFORE
    // pdfedPositionPlacedEl runs below: that function looks for
    // `.pdfed-rot-inner` to decide where to put the rotate() transform, and
    // if it isn't in the DOM yet it falls back to rotating `el` itself —
    // spinning the badge row (lock/opacity/arrange/delete) upside down
    // along with the picture the instant an already-rotated image is
    // re-rendered, e.g. every time it's locked or unlocked.
    const rotInner = document.createElement('div');
    rotInner.className = 'pdfed-rot-inner';
    // Section dividers/badges are tiny, always-locked decoration (a divider
    // rule can be just 2-3px tall) regenerated fresh on every Refine Report
    // pass. The normal 2px selection/lock border below is fine on an
    // ordinary placed image, but with box-sizing:border-box a 2px top+bottom
    // border on a 2-3px-tall box consumes MORE than the box's own height,
    // squeezing the actual <img> (the visible accent-colored rule) down to
    // zero height — so on the live canvas only a near-invisible sliver of
    // border shows, while export/thumbnail generation (which stamps these
    // pixels straight onto a canvas, no border wrapper involved) renders the
    // divider correctly. These items already skip the badge-row chrome
    // below for the same "just decoration" reason — skip the border too.
    const isSectionDecoration = item._sectionIcon || item._sectionDivider || item._sectionBar || item._headerDivider || item._watermark;
    rotInner.style.cssText = `position:absolute;inset:0;box-sizing:border-box;
      border:${isSectionDecoration ? '0' : `2px ${item.locked ? 'solid rgba(255,255,255,0.25)' : 'dashed var(--blue)'}`};
      border-radius:${isSectionDecoration ? '0' : '4px'};transform-origin:50% 50%;`;
    el.appendChild(rotInner);
    pdfedPositionPlacedEl(el, item, pc);

    const img = document.createElement('img');
    img.src = item.dataUrl;
    // object-fit:fill (not contain) so the image content always exactly
    // fills its own box no matter how you resize it — resizing
    // non-uniformly (e.g. just the width) used to leave the picture
    // letterboxed inside the box while the handles stayed on the box's
    // edges, so there was a visible gap between what you're dragging and
    // what you actually see. Filling the box means the handles are always
    // flush against the visible picture, true edge-to-edge.
    img.style.cssText = `width:100%;height:100%;object-fit:fill;pointer-events:none;display:block;opacity:${pdfedGetOpacity(item)};`;
    if (item.clip && typeof sppLiveMount === 'function') {
      // LIVE CLIP: a running canvas instead of a still picture.
      // Re-renders of this layer hand back the SAME running canvas (never a rebuilt one), so the clip stays smooth.
      const lcv = (typeof sppLiveCanvas === 'function') ? sppLiveCanvas(item.clip) : document.createElement('canvas');
      lcv.style.cssText = `width:100%;height:100%;display:block;pointer-events:none;opacity:${pdfedGetOpacity(item)};`;
      rotInner.appendChild(lcv);
      sppLiveMount(lcv, item.clip, item.dataUrl);
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); if (typeof sppEditLive === 'function') sppEditLive(idx, item); });
      rotInner.appendChild(sppLivePausePill(item.clip));
    } else {
      rotInner.appendChild(img);
    }

    // Every action badge lives in one non-rotating row, dim until hovered
    // (see .pdfed-badge-row CSS) so it never fights the rotated picture for
    // attention and never itself rotates along with it.
    const badgeRow = document.createElement('div');
    badgeRow.className = 'pdfed-badge-row';
    el.appendChild(badgeRow);

    // Section-title icons are tiny (~17-24px), always locked, and get
    // regenerated fresh on every Refine Report pass — they're not meant to
    // be individually dragged/resized/reordered/deleted by hand, so none of
    // the badge chrome below applies to them. Skipping it here matters
    // because the lock badge in particular is sized for a normal placed
    // image; on a box this small it would visually dominate the icon
    // itself, making it look oversized and misaligned next to the heading.
    if (!item._sectionIcon && !item._sectionDivider && !item._sectionBar && !item._headerDivider) {

    // Lock/unlock toggle badge, always interactive, even when image itself is locked
    const lockBtn = document.createElement('button');
    lockBtn.title = item.locked ? 'Unlock to move/resize' : 'Lock in place';
    lockBtn.className = 'pdfed-badge-btn' + (item.locked ? ' is-locked' : '');
    lockBtn.innerHTML = item.locked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.45-2"/></svg>';
    lockBtn.onclick = (ev) => { ev.stopPropagation(); pdfedTogglePlacedLockByRef(idx, item); };

    if (!item.locked) {
      // Bring Forward, one-click step toward the front (unified z-order,
      // so it can step past a text box or table too, not just other images)
      const fwdBtn = document.createElement('button');
      fwdBtn.title = 'Bring forward';
      fwdBtn.className = 'pdfed-badge-btn';
      fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
      fwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('image', idx, item.id, 1); };

      // Send Backward, one-click step toward the back
      const bwdBtn = document.createElement('button');
      bwdBtn.title = 'Send backward';
      bwdBtn.className = 'pdfed-badge-btn';
      bwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      bwdBtn.onclick = (ev) => { ev.stopPropagation(); pdfedReorderPlacedStep('image', idx, item.id, -1); };

      // Arrange (layer order) badge, jump straight To Front / To Back
      const arrBtn = document.createElement('button');
      arrBtn.title = 'Arrange, bring to front/back';
      arrBtn.className = 'pdfed-badge-btn';
      arrBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
      arrBtn.onclick = (ev) => pdfedOpenArrangeMenu(ev, 'image', idx, item.id);

      // Opacity badge, opens the shared opacity popover for this image
      const opBtn = document.createElement('button');
      opBtn.title = 'Opacity';
      opBtn.className = 'pdfed-badge-btn pdfed-opacity-btn';
      opBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';
      opBtn.onclick = (ev) => pdfedOpenOpacityPopover(ev, 'image', idx, item.id);

      // Reshape badge, opens the Image Reshaper (circle/hexagon/star crop +
      // optional gold/silver/graphite bevel) directly on this placed image,
      // right on the canvas, instead of only being reachable from the
      // Extract Images gallery. Gold "premium" styling makes it stand out
      // as its own thing in a row of otherwise neutral controls.
      const rshBtn = document.createElement('button');
      rshBtn.title = 'Reshape image (Premium)';
      rshBtn.className = 'pdfed-badge-btn is-premium';
      rshBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2v10l7 4"/><circle cx="18" cy="6" r="3" fill="currentColor" stroke="none"/></svg>';
      rshBtn.onclick = (ev) => openReshapeForPlaced(idx, item, ev);

      // Fill Page badge, one click stretches/repositions this image to
      // (0,0)-(page width, page height) — true edge-to-edge, no white
      // margin left on any side — instead of having to drag/resize by
      // hand to hit the exact page boundary. Any rotation is reset to 0
      // so the filled image's edges land flush with the page's edges.
      const fillBtn = document.createElement('button');
      fillBtn.title = 'Fill page, edge to edge';
      fillBtn.className = 'pdfed-badge-btn';
      fillBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
      fillBtn.onclick = (ev) => { ev.stopPropagation(); pdfedFillPageByRef(idx, item, pc); };

      // Delete button, only available while unlocked
      const delBtn = document.createElement('button');
      delBtn.title = 'Remove image';
      delBtn.className = 'pdfed-badge-btn is-danger';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = (ev) => { ev.stopPropagation(); pdfedDeletePlacedImageByRef(idx, item); };
      // Flex order = left-to-right visual order (row is right-anchored via
      // el's own top:4px;right:4px on .pdfed-badge-row), matching the
      // original absolute-offset layout: fill, reshape, opacity, forward,
      // backward, arrange, delete, then lock rightmost.
      if (item.clip) {
        const editBtn = document.createElement('button');
        editBtn.title = 'Edit this live clip in Showcase';
        editBtn.className = 'pdfed-badge-btn is-premium';
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        editBtn.onclick = (ev) => { ev.stopPropagation(); if (typeof sppEditLive === 'function') sppEditLive(idx, item); };
        if (!item.clip.vid) badgeRow.appendChild(editBtn);
        const lookBtn = document.createElement('button');
        lookBtn.title = 'Shape and filter for this live clip';
        lookBtn.className = 'pdfed-badge-btn is-premium pdfed-live-look-btn' + (item.clip.look ? ' sp-has-work' : '');
        lookBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>';
        lookBtn.onclick = (ev) => { ev.stopPropagation(); pdfedLiveOpenLookPopover(ev, idx, item); };
        badgeRow.appendChild(lookBtn);
      }
      if (!item.clip && item.dataUrl) {   // every image has its own Showcase; its work is saved on the image itself
        const scBtn = document.createElement('button');
        scBtn.title = item.showcase ? 'Open this image\'s Showcase (your saved work is waiting)' : 'Showcase: add motion to this image (your work is saved with it)';
        scBtn.className = 'pdfed-badge-btn is-premium' + (item.showcase ? ' sp-has-work' : '');
        scBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><polygon points="10 9 16 12 10 15 10 9" fill="currentColor"/></svg>';
        scBtn.onclick = (ev) => { ev.stopPropagation(); if (typeof sppEditImage === 'function') sppEditImage(idx, item); };
        badgeRow.appendChild(scBtn);
      }
      badgeRow.appendChild(fillBtn); badgeRow.appendChild(rshBtn); badgeRow.appendChild(opBtn);
      badgeRow.appendChild(fwdBtn); badgeRow.appendChild(bwdBtn); badgeRow.appendChild(arrBtn);
      badgeRow.appendChild(delBtn);
      badgeRow.appendChild(lockBtn);

      const handles = {};
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(dir => {
        const rh = pdfedMakeImgResizeHandle(dir);
        rotInner.appendChild(rh);
        handles[dir] = rh;
      });
      const rotWrap = pdfedMakeRotateHandle();
      rotInner.appendChild(rotWrap);
      handles.rotate = rotWrap.querySelector('.pdfed-rotate-handle');

      pdfedAttachPlacedDragHandlers(el, item, idx, handles);
    } else {
      badgeRow.appendChild(lockBtn);
    }
    } // end !item._sectionIcon guard

    layer.appendChild(el);
  });
}

// Positions one placed image using RAW, unscaled canvas-px values, the
// element never needs to know about zoom, since the whole pdfedPlacedZoomWrap
// (shared by images/texts/tables) is scaled as one unit via CSS transform
// (see pdfedSyncPlacedTextsZoom). Mirrors pdfedPositionPlacedTextEl exactly,
// so images and text live in the identical coordinate system.
function pdfedPositionPlacedEl(el, item) {
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = item.w + 'px';
  el.style.height = item.h + 'px';
  // Rotating the page (pdfedRotatePage) no longer bakes images into pixels —
  // it carries each one through as a live object with its own accumulated
  // rotation instead, applied here the same way a text box's rotation is
  // (see pdfedPositionPlacedTextEl), so it stays a real, draggable, lockable,
  // deletable image no matter how many times the page gets rotated.
  //
  // The rotation transform is applied to an inner, unrotated-frame wrapper
  // (.pdfed-rot-inner, holding only the picture/canvas + resize/rotate
  // handles) rather than to `el` itself. `el`'s own box always stays exactly
  // axis-aligned with the page, so the badge row (lock/arrange/opacity/
  // delete/etc, a direct child of `el`) never spins or orbits as the object
  // rotates — it stays fixed and upright, like a real design tool's toolbar.
  const inner = el.querySelector(':scope > .pdfed-rot-inner');
  if (inner) {
    inner.style.transform = item.rotation ? `rotate(${item.rotation}deg)` : '';
    // Belt-and-suspenders: whenever the rot-inner wrapper exists, `el`
    // itself must NEVER carry a rotation of its own — even a stale one
    // left over from before the wrapper was attached — because `el` is
    // also the direct parent of the non-rotating badge row (lock/arrange/
    // opacity/delete). A rotated `el` spins that whole row upside down
    // along with the picture instead of leaving it upright and fixed in
    // place, which is the one thing the badge row exists to guarantee.
    el.style.transform = '';
  } else {
    el.style.transform = item.rotation ? `rotate(${item.rotation}deg)` : ''; // legacy path: placed borders have no rotate handle/inner wrapper
  }
}

// Generic anchored-resize math shared by every free-form image resize UI in
// the editor (the pre-stamp ghost AND already-stamped placed images). Given
// which of the 8 handles (4 corners + 4 edges) is being dragged and the raw
// canvas-px mouse delta since drag-start, it returns the new {x,y,w,h} for
// the box, always keeping the OPPOSITE edge/corner anchored in place, which
// is what makes edge-to-edge resizing feel natural (drag the left edge and
// only the left edge moves; the right edge never budges). Pass `lockAspect`
// (Shift key) to preserve the box's original aspect ratio while resizing.
function pdfedResizeRect(dir, start, dx, dy, minSize, lockAspect) {
  const north = dir.indexOf('n') !== -1, south = dir.indexOf('s') !== -1;
  const west  = dir.indexOf('w') !== -1, east  = dir.indexOf('e') !== -1;
  let newW = start.w, newH = start.h;
  if (east) newW = start.w + dx;
  if (west) newW = start.w - dx;
  if (south) newH = start.h + dy;
  if (north) newH = start.h - dy;
  if (lockAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if ((east || west) && (north || south)) {
      // Corner handle: let whichever axis moved further drive the other one.
      if (Math.abs(newW - start.w) >= Math.abs(newH - start.h)) newH = newW / ratio;
      else newW = newH * ratio;
    } else if (east || west) {
      newH = newW / ratio;
    } else if (north || south) {
      newW = newH * ratio;
    }
  }
  newW = Math.max(minSize, newW);
  newH = Math.max(minSize, newH);
  let newX = start.x, newY = start.y;
  if (west) newX = start.x + (start.w - newW);
  if (north) newY = start.y + (start.h - newH);
  return { x: newX, y: newY, w: newW, h: newH };
}

// Builds one Canva-style resize handle (div) for a placed image, for the
// given direction — 'nw'/'ne'/'sw'/'se' (corners) or 'n'/'s'/'w'/'e' (edges).
// Mirrors pdfedMakePtxtHandle's look/feel so text and image resizing behave
// and feel identically across the whole editor.
// Custom "rotate" cursor — two curved arrows, the same shape used by most
// design tools (Canva/Figma/PowerPoint) for a free-rotate drag — shown
// whenever the pointer is over a rotate handle, and kept on document.body
// while actively dragging so it doesn't flicker back to the plain arrow if
// the pointer moves off the handle mid-drag.
const PDFED_ROTATE_CURSOR = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCIgdmlld0JveD0iMCAwIDI4IDI4Ij4KPGNpcmNsZSBjeD0iMTQiIGN5PSIxNCIgcj0iMTIiIGZpbGw9IndoaXRlIiBmaWxsLW9wYWNpdHk9IjAuMDAxIi8+CjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE0LDE0KSI+CiAgPHBhdGggZD0iTSAtOCAwIEEgOCA4IDAgMSAxIC0zLjIgNy4yIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMi42IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8cGF0aCBkPSJNIC04IDAgQSA4IDggMCAxIDEgLTMuMiA3LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwb2x5Z29uIHBvaW50cz0iLTMuMiw3LjIgLTcuNiw3LjkgLTYuMiwzLjYiIGZpbGw9IiMwMDAiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIwLjYiLz4KICA8cGF0aCBkPSJNIDggMCBBIDggOCAwIDEgMSAzLjIgLTcuMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIuNiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHBhdGggZD0iTSA4IDAgQSA4IDggMCAxIDEgMy4yIC03LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwb2x5Z29uIHBvaW50cz0iMy4yLC03LjIgNy42LC03LjkgNi4yLC0zLjYiIGZpbGw9IiMwMDAiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIwLjYiLz4KPC9nPgo8L3N2Zz4=') 14 14, grab";

function pdfedMakeImgResizeHandle(dir) {
  const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'n-resize', s: 's-resize', w: 'w-resize', e: 'e-resize' };
  const pos = {
    nw: 'top:-5px;left:-5px;', ne: 'top:-5px;right:-5px;',
    sw: 'bottom:-5px;left:-5px;', se: 'bottom:-5px;right:-5px;',
    n:  'top:-5px;left:50%;margin-left:-5px;', s: 'bottom:-5px;left:50%;margin-left:-5px;',
    w:  'top:50%;left:-5px;margin-top:-5px;',  e: 'top:50%;right:-5px;margin-top:-5px;'
  }[dir];
  const h = document.createElement('div');
  h.className = 'pdfed-img-resize-handle';
  h.dataset.dir = dir;
  h.title = 'Drag to resize (hold Shift to keep proportions)';
  h.style.cssText = `position:absolute;${pos}width:10px;height:10px;cursor:${cursors[dir]};
    background:#fff;border:1.5px solid #0073E6;box-sizing:border-box;
    border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.35);opacity:0.95;
    pointer-events:auto;z-index:3;`;
  return h;
}

// Builds a Canva-style free-rotate handle: a small circular grip on a thin
// stem above the box's top-center. Shared by placed images and placed
// shapes (same look/feel as the resize handles). Returns the OUTER wrapper
// (which holds the stem + the grip) — the caller appends the wrapper to the
// item's element, but registers the inner grip (via .pdfed-rotate-handle)
// as the actual drag target, since only the grip has pointer-events:auto.
function pdfedMakeRotateHandle() {
  const wrap = document.createElement('div');
  wrap.className = 'pdfed-rotate-handle-wrap';
  wrap.style.cssText = `position:absolute;top:-30px;left:50%;transform:translateX(-50%);
    width:18px;height:30px;pointer-events:none;`;

  const stem = document.createElement('div');
  stem.style.cssText = `position:absolute;left:50%;top:14px;bottom:8px;width:1px;
    margin-left:-0.5px;background:rgba(0,115,230,0.55);pointer-events:none;`;
  wrap.appendChild(stem);

  const h = document.createElement('div');
  h.className = 'pdfed-rotate-handle';
  h.dataset.dir = 'rotate';
  h.title = 'Drag to rotate (hold Shift to snap to 15°)';
  h.style.cssText = `position:absolute;top:0;left:50%;margin-left:-8px;width:16px;height:16px;
    border-radius:50%;cursor:${PDFED_ROTATE_CURSOR};background:#fff;border:1.5px solid #0073E6;box-sizing:border-box;
    box-shadow:0 1px 3px rgba(0,0,0,0.35);opacity:0.95;pointer-events:auto;z-index:3;
    display:flex;align-items:center;justify-content:center;
    transition:transform .1s ease,box-shadow .1s ease,background .1s ease;`;
  // pointer-events:none on the icon is what makes every pixel of the visible
  // circle actually grab-able: without it, a click landing on the glyph
  // itself (rather than the bare ring around it) reports the <svg>/<path> as
  // e.target, which has no data-dir, so the mousedown handler's
  // `handles.rotate === e.target` check fails and the app starts a plain
  // drag instead of a rotate — the exact "it doesn't feel right" glitch this
  // fixes for both placed images and placed shapes.
  h.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0073E6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
  h.onmouseenter = () => { if (!h.classList.contains('is-rotating')) h.style.transform = 'scale(1.18)'; };
  h.onmouseleave = () => { if (!h.classList.contains('is-rotating')) h.style.transform = ''; };
  wrap.appendChild(h);

  return wrap;
}

// Soft "gravity" snapping to the 8 major angles (0/45/90/135/180/225/270/315)
// within a small tolerance, so free-rotating a placed image or shape through
// a straight or diagonal angle "catches" there for a moment — the same
// tactile, always-on precision Figma/Canva/PowerPoint give by default,
// without requiring a modifier key. Holding Shift instead forces a hard,
// always-on snap to every 15° increment for a deliberate precise turn.
// `normalizedDeg` must already be wrapped into [0, 360).
function pdfedSnapRotationAngle(normalizedDeg, shiftKey) {
  if (shiftKey) return { angle: (Math.round(normalizedDeg / 15) * 15) % 360, snapped: true };
  const majors = [0, 45, 90, 135, 180, 225, 270, 315, 360];
  for (let i = 0; i < majors.length; i++) {
    if (Math.abs(normalizedDeg - majors[i]) <= 2.5) return { angle: majors[i] % 360, snapped: true };
  }
  return { angle: normalizedDeg, snapped: false };
}

// Live degree readout that follows the pointer while a rotate handle is
// being dragged (placed images and placed shapes both use this) — turns a
// blind drag into something you can actually aim, and flips to the accent
// color the instant a gravity-snap catches so the snap is never a surprise.
function pdfedShowRotateBadge(clientX, clientY, angleDeg, snapped) {
  let badge = document.getElementById('pdfedRotateAngleBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'pdfedRotateAngleBadge';
    badge.style.cssText = `position:fixed;z-index:100000;pointer-events:none;
      padding:4px 9px;border-radius:6px;font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      color:#fff;box-shadow:0 3px 10px rgba(0,0,0,0.28);white-space:nowrap;letter-spacing:0.2px;
      transition:background .1s ease;`;
    document.body.appendChild(badge);
  }
  let displayDeg = Math.round(angleDeg);
  if (displayDeg > 180) displayDeg -= 360; // show the shorter signed form, e.g. -30° not 330°
  badge.textContent = displayDeg + '°';
  badge.style.left = (clientX + 18) + 'px';
  badge.style.top = (clientY - 12) + 'px';
  badge.style.background = snapped ? '#0073E6' : 'rgba(24,26,32,0.92)';
  badge.style.display = 'block';
}
function pdfedHideRotateBadge() {
  const badge = document.getElementById('pdfedRotateAngleBadge');
  if (badge) badge.style.display = 'none';
}

// Given a raw screen-space mouse delta (dx, dy) and an item's current
// rotation in degrees, returns the delta re-expressed in the item's own
// (unrotated) local axes. Resize math (pdfedResizeRect) always operates in
// local box space — without this, dragging a resize handle on a rotated
// image/shape would resize along screen axes instead of the box's own
// visually-rotated edges, making the box skew in the wrong direction.
function pdfedUnrotateDelta(dx, dy, rotationDeg) {
  if (!rotationDeg) return { dx, dy };
  const rad = -rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}


// snaps to the page's edges/center and every other placed text/image/table's
// edges/center (with thin guide lines), and, where nothing sharper fires —
// to the plain grid, so images line up exactly like text does. On resize,
// the final box edges snap to the grid too, matching the text-box behavior.
//
// IMPORTANT: pdfedRenderPlacedImages wipes and rebuilds every placed-image
// <div> from scratch on every insert, lock/unlock, delete, or drag-end — so
// this function itself gets called fresh for every unlocked image on every
// one of those re-renders. It used to bind its own document-level
// 'mousemove'/'mouseup' listeners right here, once per call, and never
// removed them. With 3+ images that meant every single click (lock, delete,
// even just finishing a drag) piled a fresh, permanent set of document
// listeners on top of all the previous ones — dozens of stale handlers all
// firing on every mouse move, each one still holding a reference to an old
// (already-removed) element and its own copy of drag state. That pile-up is
// what showed up as images "glitching" and appearing to lock together. The
// fix: keep per-element mousedown binding here (cheap, and naturally
// discarded when the element is removed), but drive the actual drag/resize
// off ONE shared document-level listener pair, bound a single time ever,
// that reads/writes a single shared "which item is being dragged right now"
// state object instead of a private closure per element.
function pdfedAttachPlacedDragHandlers(el, item, idx, handles) {
  const SNAP = 10; // canvas-px snap threshold, same as placed text

  el.addEventListener('mousedown', (e) => {
    if (item.locked) return;
    const pc = document.getElementById('pdfedPageCanvas');
    const dir = e.target && e.target.dataset ? e.target.dataset.dir : null;
    const drag = pdfedPlacedImgDrag;
    if (dir === 'rotate' && handles.rotate === e.target) {
      const rect = el.getBoundingClientRect();
      drag.mode = 'rotate';
      drag.centerX = rect.left + rect.width / 2;
      drag.centerY = rect.top + rect.height / 2;
      drag.prevAngle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180 / Math.PI;
      document.body.style.cursor = PDFED_ROTATE_CURSOR;
      document.body.style.userSelect = 'none';
      el.style.willChange = 'transform';
      handles.rotate.classList.add('is-rotating');
      handles.rotate.style.transform = 'scale(1.15)';
      pdfedShowRotateBadge(e.clientX, e.clientY, item.rotation || 0, false);
    } else if (dir && handles[dir] === e.target) {
      drag.mode = 'resize'; drag.resizeDir = dir;
      drag.ox = e.clientX; drag.oy = e.clientY;
      drag.startRect = { x: item.x, y: item.y, w: item.w, h: item.h };
      drag.snapTargets = pdfedCollectSnapTargets(item.id);
      drag.edgeLockedX = false; drag.edgeLockedY = false;
    } else if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
      drag.mode = 'drag'; drag.ox = e.clientX; drag.oy = e.clientY;
      drag.startX = item.x; drag.startY = item.y;
      drag.snapTargets = pdfedCollectSnapTargets(item.id);
    } else { return; }
    // Snapshot of every field this gesture might touch, taken once at the
    // very start — mouseup diffs against this to build one undo step for
    // the whole drag/resize/rotate, not per animation frame.
    drag.beforeSnap = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 };
    drag.el = el; drag.item = item; drag.idx = idx; drag.pc = pc; drag.handles = handles;
    document.querySelectorAll('.pdfed-placed-img.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    e.preventDefault(); e.stopPropagation();
  });

  pdfedEnsurePlacedImgDragListeners();
}

// Single shared drag/resize state for whichever placed image is currently
// being manipulated. Populated by the mousedown handler above, consumed by
// the one-time document listeners set up below.
const pdfedPlacedImgDrag = {
  mode: null, el: null, item: null, idx: null, pc: null, handles: null,
  resizeDir: null, ox: 0, oy: 0, startRect: null, startX: 0, startY: 0,
  snapTargets: null, edgeLockedX: false, edgeLockedY: false,
  centerX: 0, centerY: 0, prevAngle: 0
};
let pdfedPlacedImgDragListenersBound = false;

function pdfedEnsurePlacedImgDragListeners() {
  if (pdfedPlacedImgDragListenersBound) return;
  pdfedPlacedImgDragListenersBound = true;
  // Widened from 10 -> 18 canvas-px. At 10px, a manual drag/resize that was
  // "close enough" to the page edge by eye (but a little past the old
  // threshold) would miss the snap entirely and get hard-clamped to
  // wherever the cursor happened to be — leaving a thin, easy-to-miss white
  // gap between the image and the actual page boundary instead of landing
  // flush. 18px gives a much more forgiving catch radius while still being
  // small enough to never snap unintentionally.
  const SNAP = 18;

  document.addEventListener('mousemove', (e) => {
    const drag = pdfedPlacedImgDrag;
    if (!drag.mode) return;
    const { el, item, pc } = drag;
    if (!el || !item || !pc) return;
    const pcRect = pc.getBoundingClientRect();
    const scale = pc.width / pcRect.width;
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (drag.mode === 'drag') {
      let nx = drag.startX + (e.clientX - drag.ox) * scale;
      let ny = drag.startY + (e.clientY - drag.oy) * scale;

      // Smart snapping, page edges/center plus every other object's edges/center.
      const bestX = pdfedBestSnap([nx, nx + item.w / 2, nx + item.w], (drag.snapTargets || { x: [] }).x, SNAP);
      const bestY = pdfedBestSnap([ny, ny + item.h / 2, ny + item.h], (drag.snapTargets || { y: [] }).y, SNAP);
      if (bestX) nx += bestX.delta;
      if (bestY) ny += bestY.delta;
      // Grid-to-grid snapping (Canva-style): only kicks in on an axis where no
      // sharper object/page-edge guide already fired, matching placed text.
      if (pdfed.snapGrid) {
        if (!bestX) nx = pdfedSnapToGrid(nx);
        if (!bestY) ny = pdfedSnapToGrid(ny);
      }
      if (guideV) {
        guideV.style.display = bestX ? 'block' : 'none';
        if (bestX) guideV.style.left = (bestX.at * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = bestY ? 'block' : 'none';
        if (bestY) guideH.style.top = (bestY.at * (pdfed.zoom || 1)) + 'px';
      }

      item.x = nx; item.y = ny;
      // Hard clamp: the image can never be dragged off the page.
      item.x = Math.max(0, Math.min(item.x, pc.width - item.w));
      item.y = Math.max(0, Math.min(item.y, pc.height - item.h));
      pdfedPositionPlacedEl(el, item, pc);
    } else if (drag.mode === 'rotate') {
      // Track the angular delta since the LAST FRAME (not since drag-start)
      // and normalize it into (-180, 180] before applying it — atan2 wraps
      // from -180° to +180° at the point directly opposite where the drag
      // began, so measuring from drag-start would make rotation suddenly
      // jump by ~360° the instant the pointer crosses that point. Measuring
      // frame-to-frame and normalizing each small step keeps the turn smooth
      // through any number of full spins. Hold Shift to snap to 15° increments.
      const angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180 / Math.PI;
      let delta = angle - drag.prevAngle;
      delta = ((delta + 180) % 360 + 360) % 360 - 180;
      const newRot = (item.rotation || 0) + delta;
      const normalizedRot = ((newRot % 360) + 360) % 360;
      const snap = pdfedSnapRotationAngle(normalizedRot, e.shiftKey);
      item.rotation = snap.angle;
      drag.prevAngle = angle;
      pdfedPositionPlacedEl(el, item, pc);
      pdfedShowRotateBadge(e.clientX, e.clientY, item.rotation, snap.snapped);
    } else if (drag.mode === 'resize') {
      // Edge-to-edge free resize: whichever of the 8 handles is being dragged,
      // the opposite edge/corner stays anchored, drag the left edge and only
      // the left edge (and width) changes, the right edge never moves.
      // Hold Shift while dragging to keep the image's aspect ratio locked.
      const resizeDir = drag.resizeDir, startRect = drag.startRect;
      let dx = (e.clientX - drag.ox) * scale, dy = (e.clientY - drag.oy) * scale;
      // If the image is rotated, a screen-space mouse delta doesn't point
      // along the box's own edges anymore — re-express it in the box's
      // local (unrotated) axes so dragging a corner still resizes along
      // that corner's visual edge instead of skewing the wrong way.
      ({ dx, dy } = pdfedUnrotateDelta(dx, dy, item.rotation));
      const r = pdfedResizeRect(resizeDir, startRect, dx, dy, 20, e.shiftKey);

      // Snap whichever edge(s) this handle is moving to the page edges/center
      // and other objects' edges — same magnetism as moving the whole image.
      const north = resizeDir.indexOf('n') !== -1, south = resizeDir.indexOf('s') !== -1;
      const west  = resizeDir.indexOf('w') !== -1, east  = resizeDir.indexOf('e') !== -1;
      const targets = drag.snapTargets || { x: [], y: [] };
      let snapAtX = null, snapAtY = null;

      if (west) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([r.x], targets.x, SNAP);
        if (best) { r.x += best.delta; r.w = Math.max(20, right - r.x); snapAtX = best.at; drag.edgeLockedX = true; }
      } else if (east) {
        const right = r.x + r.w;
        const best = pdfedBestSnap([right], targets.x, SNAP);
        if (best) { r.w = Math.max(20, (right + best.delta) - r.x); snapAtX = best.at; drag.edgeLockedX = true; }
      }
      if (north) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([r.y], targets.y, SNAP);
        if (best) { r.y += best.delta; r.h = Math.max(20, bottom - r.y); snapAtY = best.at; drag.edgeLockedY = true; }
      } else if (south) {
        const bottom = r.y + r.h;
        const best = pdfedBestSnap([bottom], targets.y, SNAP);
        if (best) { r.h = Math.max(20, (bottom + best.delta) - r.y); snapAtY = best.at; drag.edgeLockedY = true; }
      }

      if (guideV) {
        guideV.style.display = snapAtX !== null ? 'block' : 'none';
        if (snapAtX !== null) guideV.style.left = (snapAtX * (pdfed.zoom || 1)) + 'px';
      }
      if (guideH) {
        guideH.style.display = snapAtY !== null ? 'block' : 'none';
        if (snapAtY !== null) guideH.style.top = (snapAtY * (pdfed.zoom || 1)) + 'px';
      }

      // Hard clamp: whatever edge this handle pushed past the page
      // boundary gets pulled back to exactly 0 / pc.width / pc.height,
      // keeping the opposite (anchored) edge exactly where it was.
      if (west) {
        const right = r.x + r.w;
        r.x = Math.max(0, r.x);
        r.w = right - r.x;
        if (r.x === 0) drag.edgeLockedX = true;
      } else if (east) {
        const right = Math.min(pc.width, r.x + r.w);
        r.w = right - r.x;
        if (right === pc.width) drag.edgeLockedX = true;
      }
      if (north) {
        const bottom = r.y + r.h;
        r.y = Math.max(0, r.y);
        r.h = bottom - r.y;
        if (r.y === 0) drag.edgeLockedY = true;
      } else if (south) {
        const bottom = Math.min(pc.height, r.y + r.h);
        r.h = bottom - r.y;
        if (bottom === pc.height) drag.edgeLockedY = true;
      }
      r.w = Math.max(20, r.w);
      r.h = Math.max(20, r.h);

      item.x = r.x; item.y = r.y; item.w = r.w; item.h = r.h;
      pdfedPositionPlacedEl(el, item, pc);
    }
  });

  document.addEventListener('mouseup', () => {
    const drag = pdfedPlacedImgDrag;
    if (!drag.mode) return;
    const { el, item, idx, pc } = drag;
    if (drag.mode === 'resize' && pdfed.snapGrid && el && item && pc) {
      // Only grid-snap an axis that wasn't already locked to the page edge
      // or a smart-snap target during this resize — otherwise an image you
      // just placed flush against the page boundary would visibly hop a
      // few grid px away the instant you release the handle.
      if (!drag.edgeLockedX) {
        const newX = pdfedSnapToGrid(item.x);
        item.w = Math.max(20, pdfedSnapToGrid(item.x + item.w) - newX);
        item.x = newX;
      }
      if (!drag.edgeLockedY) {
        const newY = pdfedSnapToGrid(item.y);
        item.h = Math.max(20, pdfedSnapToGrid(item.y + item.h) - newY);
        item.y = newY;
      }
      pdfedPositionPlacedEl(el, item, pc);
    }
    if (drag.mode && idx != null) pdfedMarkModified(idx);
    if (drag.mode === 'rotate') {
      pdfedHideRotateBadge();
      if (el) el.style.willChange = '';
      document.body.style.userSelect = '';
      if (drag.handles && drag.handles.rotate) { drag.handles.rotate.classList.remove('is-rotating'); drag.handles.rotate.style.transform = ''; }
    }
    // One undo step for the whole gesture (drag / resize / rotate), only if
    // something actually moved — a plain click that opens the selection
    // shouldn't create a no-op history entry.
    if (drag.mode && item && drag.beforeSnap) {
      const before = drag.beforeSnap;
      const after = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 };
      const gestureLabel = drag.mode === 'rotate' ? 'Rotate image' : drag.mode === 'resize' ? 'Resize image' : 'Move image';
      if (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h || before.rotation !== after.rotation) {
        const gIdx = idx;
        pushAppHistory({
          label: gestureLabel,
          undo: () => {
            item.x = before.x; item.y = before.y; item.w = before.w; item.h = before.h; item.rotation = before.rotation;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedImages(gIdx);
          },
          redo: () => {
            item.x = after.x; item.y = after.y; item.w = after.w; item.h = after.h; item.rotation = after.rotation;
            pdfedMarkModified(gIdx);
            pdfedRenderPlacedImages(gIdx);
          }
        });
      }
    }
    drag.mode = null; drag.el = null; drag.item = null; drag.idx = null; drag.pc = null; drag.handles = null;
    drag.resizeDir = null; drag.startRect = null; drag.snapTargets = null; drag.beforeSnap = null;
    drag.edgeLockedX = false; drag.edgeLockedY = false;
    drag.centerX = 0; drag.centerY = 0; drag.prevAngle = 0;
    document.body.style.cursor = '';
    const guideV = document.getElementById('pdfedSmartGuideV');
    const guideH = document.getElementById('pdfedSmartGuideH');
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
  });
}

function pdfedTogglePlacedLock(idx, id) {
  const list = (pdfed.pages[idx] && pdfed.pages[idx].placedImages) || [];
  const item = list.find(i => i.id === id);
  if (!item) return;
  item.locked = !item.locked;
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  toast(item.locked ? 'Image locked, unlock to move it' : 'Image unlocked, drag to move', 'info');
}

function pdfedDeletePlacedImage(idx, id) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedImages) return;
  const i = pg.placedImages.findIndex(im => im.id === id);
  if (i === -1) return;
  const removedItem = pg.placedImages[i], removedIndex = i;
  pg.placedImages.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Image removed', 'success');
  pushAppHistory({
    label: 'Delete image',
    undo: () => {
      pg.placedImages.splice(Math.min(removedIndex, pg.placedImages.length), 0, removedItem);
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Image restored', 'info');
    },
    redo: () => {
      const at = pg.placedImages.indexOf(removedItem);
      if (at !== -1) pg.placedImages.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Image removed', 'success');
    }
  });
}

// Reference-based counterparts of the two above, used by the on-canvas
// image badges. Matching by id breaks down if two images on a page ever
// end up sharing one (e.g. a duplicated page whose items weren't
// re-keyed) — id-based lock/delete would then silently affect both.
// Operating on the exact object clicked removes that possibility entirely:
// it's always the one image you clicked, never its neighbor.
function pdfedTogglePlacedLockByRef(idx, item) {
  if (!item) return;
  item.locked = !item.locked;
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  toast(item.locked ? 'Image locked, unlock to move it' : 'Image unlocked, drag to move', 'info');
}

// Stretches/repositions a placed image so it exactly covers the page —
// x:0, y:0, width/height = the page's own raw canvas size — leaving no gap
// on any edge. Registers a single undo/redo action in the centralized app
// history, same as every other placed-image edit, so Ctrl+Z instantly
// brings back whatever position/size the image had before.
function pdfedFillPageByRef(idx, item, pc) {
  if (!item || !pc || !pc.width || !pc.height) return;
  const prev = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation };
  const doFill = () => {
    item.x = 0; item.y = 0; item.w = pc.width; item.h = pc.height; item.rotation = 0;
    pdfedMarkModified(idx);
    pdfedRenderPlacedImages(idx);
  };
  doFill();
  toast('Image filled to page edges', 'success');
  pushAppHistory({
    label: 'Fill page',
    undo: () => {
      item.x = prev.x; item.y = prev.y; item.w = prev.w; item.h = prev.h; item.rotation = prev.rotation;
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      toast('Fill page undone', 'info');
    },
    redo: () => {
      doFill();
      toast('Image filled to page edges', 'success');
    }
  });
}

function pdfedDeletePlacedImageByRef(idx, item) {
  const pg = pdfed.pages[idx];
  if (!pg || !pg.placedImages || !item) return;
  const i = pg.placedImages.indexOf(item);
  if (i === -1) return;
  const removedIndex = i;
  pg.placedImages.splice(i, 1);
  pdfedMarkModified(idx);
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Image removed', 'success');
  pushAppHistory({
    label: 'Delete image',
    undo: () => {
      pg.placedImages.splice(Math.min(removedIndex, pg.placedImages.length), 0, item);
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Image restored', 'info');
    },
    redo: () => {
      const at = pg.placedImages.indexOf(item);
      if (at !== -1) pg.placedImages.splice(at, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedImages(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Image removed', 'success');
    }
  });
}

// Non-destructive: returns a baked PNG dataURL for this page (base bitmap + any
// placed images drawn in their current position) WITHOUT touching pg.dataUrl or
// pg.placedImages. Used for Export so the PDF output reflects exactly what's on
// screen, while the editor keeps every placed image fully movable/lockable —
// nothing gets permanently stamped just because you exported.
async function pdfedGetBakedPageUrl(pg) {
  const list = pg.placedImages;
  const textList = pg.placedTexts;
  const tableList = pg.placedTables;
  const borderList = pg.placedBorders;
  const baseUrl = await pdfedPageUrlBase(pg);
  if ((!list || list.length === 0) && (!textList || textList.length === 0) && (!tableList || tableList.length === 0) && (!borderList || borderList.length === 0)) return baseUrl;
  const baseImg = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = baseUrl;
  });
  const can = document.createElement('canvas');
  can.width = baseImg.naturalWidth;
  can.height = baseImg.naturalHeight;
  const ctx = can.getContext('2d');
  ctx.drawImage(baseImg, 0, 0);
  await pdfedDrawOrderedPlacedOnCtx(ctx, pg);
  return can.toDataURL('image/png');
}

// Permanently bakes all placed images for a page into its canvas/dataUrl. Used only
// where pixel data genuinely must be fixed (e.g. before a rotate, since placed-image
// box coordinates can't survive a rotation). NOT used for Export anymore, see
// pdfedGetBakedPageUrl above, which keeps images movable/lockable after export.
async function pdfedBakePlacedImagesIntoDataUrl(pg, idx) {
  const list = pg.placedImages;
  const textList = pg.placedTexts;
  const tableList = pg.placedTables;
  const borderList = pg.placedBorders;
  if ((!list || list.length === 0) && (!textList || textList.length === 0) && (!tableList || tableList.length === 0) && (!borderList || borderList.length === 0)) return;
  const baseUrl = await pdfedPageUrlBase(pg);
  const baseImg = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = baseUrl;
  });
  const can = document.createElement('canvas');
  can.width = baseImg.naturalWidth;
  can.height = baseImg.naturalHeight;
  const ctx = can.getContext('2d');
  ctx.drawImage(baseImg, 0, 0);
  await pdfedDrawOrderedPlacedOnCtx(ctx, pg);
  pg.dataUrl = can.toDataURL('image/png');
  // Images/texts/tables are now permanently part of the bitmap, clear the live overlay
  // lists so continuing to edit after export (or exporting again) doesn't
  // redraw/double-bake them.
  pg.placedImages = [];
  pg.placedTexts = [];
  pg.placedTables = [];
  pg.placedBorders = [];
  if (pdfed.active === idx) {
    // IMPORTANT: the overlay (draggable <div>) is what was showing the image on
    // screen. Now that it's cleared, the actual <canvas> pixels must be updated
    // with the baked bitmap too, or the image visually disappears from the editor
    // even though it's correctly saved into the page data.
    const pc = document.getElementById('pdfedPageCanvas');
    const pctx = pc.getContext('2d');
    pctx.drawImage(can, 0, 0, pc.width, pc.height);
    pdfedRenderPlacedBorders(idx);
    pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  }
}

// ─── PATCH pdfedGoto to bake annotations on page change ──────────────────────

const _pdfedGotoOrig = pdfedGoto;
pdfedGoto = async function(idx) {
  // Bake any pending annotations on current page before switching
  if (pdfed.active >= 0 && pdfed.active !== idx) {
    pdfedBakeAnnotations();
    pdfedAutoStampPendingGhost();
  }
  await _pdfedGotoOrig(idx);
  // Restore annot canvas if we had strokes
  pdfedRestoreAnnotCanvas(idx);
  // Resize annot canvas to match page
  const pc = document.getElementById('pdfedPageCanvas');
  const ac = document.getElementById('pdfedAnnotCanvas');
  ac.width = pc.width;
  ac.height = pc.height;
  pdfedApplyAnnotZoom();
  // Re-draw this page's persistent placed/locked images
  pdfedRenderPlacedBorders(idx);
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
};

// Keep annot canvas visually aligned with zoom
function pdfedApplyAnnotZoom() {
  const pc = document.getElementById('pdfedPageCanvas');
  const ac = document.getElementById('pdfedAnnotCanvas');
  ac.style.width = pc.style.width;
  ac.style.height = pc.style.height;
}

// Patch pdfedApplyZoom to also sync annot canvas
const _pdfedApplyZoomOrig = pdfedApplyZoom;
pdfedApplyZoom = function() {
  _pdfedApplyZoomOrig();
  pdfedApplyAnnotZoom();
};

// NOTE: export used to patch itself here to bake the currently-active page's
// annotations before running, that only ever covered whichever single page
// was open in the viewer. pdfedExport() now calls pdfedComposeThumb() per page
// instead, which reads pg.annotStrokes directly for every page, so this patch
// is no longer needed (and is intentionally removed rather than left dormant,
// since it would double-draw placed images/text if reintroduced alongside it).

// Patch pdfedPageUrl to include annotation layer
const _pdfedPageUrlOrig = pdfedPageUrl;
pdfedPageUrl = async function(pg) {
  const url = await _pdfedPageUrlOrig(pg);
  return url;
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
// ─── INIT CROP EVENTS ON LOAD ───
window.addEventListener('load', pdfedInitCropEvents);
window.addEventListener('load', pdfedAnnotInit);

// ─── PDF EDITOR END ───────────────────────────────────────────
