// ─── CROP (accurate pixel-perfect rewrite) ───
let crop = {
  ratio: 'free',
  dragging: false,
  resizing: false,
  dir: null,
  startX: 0, startY: 0,
  // box coords are in WORKSPACE space (px from workspace top-left)
  box: { x: 0, y: 0, w: 0, h: 0 },
  startBox: null,
  imgEl: null
};

function getImgRect() {
  const img = document.getElementById('cropImg');
  const ws  = document.getElementById('cropWorkspace');
  const iR  = img.getBoundingClientRect();
  const wR  = ws.getBoundingClientRect();
  return {
    x: iR.left - wR.left,
    y: iR.top  - wR.top,
    w: iR.width,
    h: iR.height,
    nw: img.naturalWidth,
    nh: img.naturalHeight
  };
}

function openCrop(ratio) {
  if(state.currentEditIndex === null) { toast('Open an image in the editor first', 'error'); return; }
  const img = state.extractedImages[state.currentEditIndex];
  const cropImg = document.getElementById('cropImg');
  cropImg.onload = () => {
    crop.imgEl = cropImg;
    crop.ratio = ratio || 'free';
    // Wait a tick so layout is settled before measuring
    requestAnimationFrame(() => {
      resetCropBox();
      if(ratio && ratio !== 'free') applyCropRatioToBox(ratio);
      renderCropBox();
    });
  };
  cropImg.src = img.dataUrl;
  document.getElementById('cropOverlay').classList.add('open');
}

function openCropRatio(ratio) {
  if(state.currentEditIndex === null) { toast('Open an image in the editor first', 'error'); return; }
  openCrop(ratio);
}

function closeCrop() {
  document.getElementById('cropOverlay').classList.remove('open');
}

function resetCropBox() {
  const r = getImgRect();
  const pad = 16;
  crop.box = { x: r.x + pad, y: r.y + pad, w: r.w - pad*2, h: r.h - pad*2 };
}

function applyCropRatioToBox(ratio) {
  const r = getImgRect();
  const [rw, rh] = ratio.split(':').map(Number);
  let w = r.w * 0.8;
  let h = w * rh / rw;
  if(h > r.h * 0.8) { h = r.h * 0.8; w = h * rw / rh; }
  crop.box = {
    x: r.x + (r.w - w) / 2,
    y: r.y + (r.h - h) / 2,
    w, h
  };
}

function setCropRatio(ratio, el) {
  crop.ratio = ratio;
  document.querySelectorAll('.crop-preset').forEach(p => p.classList.remove('active'));
  if(el) el.classList.add('active');
  requestAnimationFrame(() => {
    if(ratio !== 'free') applyCropRatioToBox(ratio);
    renderCropBox();
  });
}

function renderCropBox() {
  const box = document.getElementById('cropBox');
  const w = Math.max(20, crop.box.w);
  const h = Math.max(20, crop.box.h);
  box.style.left   = crop.box.x + 'px';
  box.style.top    = crop.box.y + 'px';
  box.style.width  = w + 'px';
  box.style.height = h + 'px';

  // Show accurate pixel dimensions
  const r = getImgRect();
  if(r.w > 0) {
    const scaleX = r.nw / r.w;
    const scaleY = r.nh / r.h;
    const px = Math.round(Math.max(0, (crop.box.x - r.x)) * scaleX);
    const py = Math.round(Math.max(0, (crop.box.y - r.y)) * scaleY);
    const pw = Math.round(Math.min(w, r.w - Math.max(0, crop.box.x - r.x)) * scaleX);
    const ph = Math.round(Math.min(h, r.h - Math.max(0, crop.box.y - r.y)) * scaleY);
    document.getElementById('cropInfo').textContent = `Selection: ${Math.max(0,pw)} × ${Math.max(0,ph)} px  (at ${Math.max(0,px)}, ${Math.max(0,py)})`;
  }
}

function clampBox(box, r) {
  // Ensure box stays within image bounds
  let { x, y, w, h } = box;
  if(x < r.x) { w -= (r.x - x); x = r.x; }
  if(y < r.y) { h -= (r.y - y); y = r.y; }
  if(x + w > r.x + r.w) w = r.x + r.w - x;
  if(y + h > r.y + r.h) h = r.y + r.h - y;
  w = Math.max(20, w);
  h = Math.max(20, h);
  return { x, y, w, h };
}

// Drag the entire box
document.getElementById('cropBox').addEventListener('mousedown', e => {
  if(e.target.classList.contains('crop-handle')) return;
  crop.dragging = true;
  crop.startX = e.clientX - crop.box.x;
  crop.startY = e.clientY - crop.box.y;
  e.preventDefault();
});

// Resize handles, use event delegation so it works after DOM reuse
document.getElementById('cropBox').addEventListener('mousedown', e => {
  const h = e.target.closest('.crop-handle');
  if(!h) return;
  crop.resizing = true;
  crop.dragging = false;
  crop.dir = h.dataset.dir;
  crop.startX = e.clientX;
  crop.startY = e.clientY;
  crop.startBox = { ...crop.box };
  e.stopPropagation(); e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if(!crop.dragging && !crop.resizing) return;
  const r = getImgRect();

  if(crop.dragging) {
    let nx = e.clientX - crop.startX;
    let ny = e.clientY - crop.startY;
    // clamp so box stays inside image
    nx = Math.max(r.x, Math.min(nx, r.x + r.w - crop.box.w));
    ny = Math.max(r.y, Math.min(ny, r.y + r.h - crop.box.h));
    crop.box.x = nx;
    crop.box.y = ny;
  }

  if(crop.resizing) {
    const dx = e.clientX - crop.startX;
    const dy = e.clientY - crop.startY;
    let { x, y, w, h } = crop.startBox;
    const d = crop.dir;
    if(d.includes('e')) w = Math.max(20, w + dx);
    if(d.includes('s')) h = Math.max(20, h + dy);
    if(d.includes('w')) { x = x + dx; w = Math.max(20, w - dx); }
    if(d.includes('n')) { y = y + dy; h = Math.max(20, h - dy); }
    // enforce ratio lock
    if(crop.ratio !== 'free') {
      const [rw, rh] = crop.ratio.split(':').map(Number);
      if(d.includes('e') || d.includes('w')) h = w * rh / rw;
      else w = h * rw / rh;
    }
    crop.box = clampBox({ x, y, w, h }, r);
  }
  renderCropBox();
});

document.addEventListener('mouseup', () => { crop.dragging = false; crop.resizing = false; });

// Touch support for crop
document.getElementById('cropBox').addEventListener('touchstart', e => {
  const h = e.target.closest('.crop-handle');
  const t = e.touches[0];
  if(h) {
    crop.resizing = true; crop.dragging = false;
    crop.dir = h.dataset.dir;
    crop.startX = t.clientX; crop.startY = t.clientY;
    crop.startBox = { ...crop.box };
  } else {
    crop.dragging = true;
    crop.startX = t.clientX - crop.box.x;
    crop.startY = t.clientY - crop.box.y;
  }
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', e => {
  if(!crop.dragging && !crop.resizing) return;
  const t = e.touches[0];
  const r = getImgRect();
  if(crop.dragging) {
    let nx = t.clientX - crop.startX;
    let ny = t.clientY - crop.startY;
    nx = Math.max(r.x, Math.min(nx, r.x + r.w - crop.box.w));
    ny = Math.max(r.y, Math.min(ny, r.y + r.h - crop.box.h));
    crop.box.x = nx; crop.box.y = ny;
  }
  if(crop.resizing) {
    const dx = t.clientX - crop.startX;
    const dy = t.clientY - crop.startY;
    let { x, y, w, h } = crop.startBox;
    const d = crop.dir;
    if(d.includes('e')) w = Math.max(20, w + dx);
    if(d.includes('s')) h = Math.max(20, h + dy);
    if(d.includes('w')) { x = x + dx; w = Math.max(20, w - dx); }
    if(d.includes('n')) { y = y + dy; h = Math.max(20, h - dy); }
    crop.box = clampBox({ x, y, w, h }, r);
  }
  renderCropBox();
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', () => { crop.dragging = false; crop.resizing = false; });

// ─── IMAGE RESHAPER ───
const RSH_SHAPES = [
  {
    "id": "circle",
    "name": "Circle",
    "d": "M990,500 A490,490 0 1,1 10,500 A490,490 0 1,1 990,500 Z"
  },
  {
    "id": "squircle",
    "name": "Squircle",
    "d": "M 500.0,0.1 Q 999.9,0.1 999.9,500.0 L 999.9,500.0 Q 999.9,999.9 500.0,999.9 L 500.0,999.9 Q 0.1,999.9 0.1,500.0 L 0.1,500.0 Q 0.1,0.1 500.0,0.1 L 500.0,0.1 Z"
  },
  {
    "id": "hexagon",
    "name": "Hexagon",
    "d": "M 386.0,95.8 Q 500.0,30.0 614.0,95.8 L 793.1,199.2 Q 907.0,265.0 907.0,396.6 L 907.0,603.4 Q 907.0,735.0 793.1,800.8 L 614.0,904.2 Q 500.0,970.0 386.0,904.2 L 206.9,800.8 Q 93.0,735.0 93.0,603.4 L 93.0,396.6 Q 93.0,265.0 206.9,199.2 L 386.0,95.8 Z"
  },
  {
    "id": "octagon",
    "name": "Octagon",
    "d": "M 571.9,65.8 Q 679.9,65.8 756.2,142.1 L 857.9,243.8 Q 934.2,320.1 934.2,428.1 L 934.2,571.9 Q 934.2,679.9 857.9,756.2 L 756.2,857.9 Q 679.9,934.2 571.9,934.2 L 428.1,934.2 Q 320.1,934.2 243.8,857.9 L 142.1,756.2 Q 65.8,679.9 65.8,571.9 L 65.8,428.1 Q 65.8,320.1 142.1,243.8 L 243.8,142.1 Q 320.1,65.8 428.1,65.8 L 571.9,65.8 Z"
  },
  {
    "id": "diamond",
    "name": "Diamond",
    "d": "M 390.0,110.0 Q 500.0,0.0 610.0,110.0 L 890.0,390.0 Q 1000.0,500.0 890.0,610.0 L 610.0,890.0 Q 500.0,1000.0 390.0,890.0 L 110.0,610.0 Q 0.0,500.0 110.0,390.0 L 390.0,110.0 Z"
  },
  {
    "id": "shield",
    "name": "Shield",
    "d": "M 381.3,106.2 Q 500.0,20.0 618.7,106.2 L 837.8,265.4 Q 956.5,351.7 911.2,491.2 L 827.5,748.8 Q 782.1,888.3 635.4,888.3 L 364.6,888.3 Q 217.9,888.3 172.5,748.8 L 88.8,491.2 Q 43.5,351.7 162.2,265.4 L 381.3,106.2 Z"
  },
  {
    "id": "arch",
    "name": "Arch",
    "d": "M 0,1000 V 500 A 500,500 0 0,1 1000,500 V 1000 Z"
  },
  {
    "id": "wave",
    "name": "Wave Edge",
    "d": "M 0,0 H 1000 V 760 C 900,760 900,860 800,860 C 700,860 700,760 600,760 C 500,760 500,860 400,860 C 300,860 300,760 200,760 C 100,760 100,860 0,860 Z"
  },
  {
    "id": "blob1",
    "name": "Blob",
    "d": "M 493,890 C 622,905 790,835 860,700 C 930,565 900,380 810,255 C 720,130 545,70 400,110 C 255,150 120,270 90,420 C 60,570 130,730 250,810 C 330,865 400,878 493,890 Z"
  },
  {
    "id": "blob2",
    "name": "Blob Two",
    "d": "M 450,80 C 600,60 760,140 830,270 C 900,400 890,580 800,700 C 710,820 550,900 400,870 C 250,840 110,730 80,580 C 50,430 110,270 230,180 C 300,128 370,96 450,80 Z"
  },
  {
    "id": "leaf",
    "name": "Leaf",
    "d": "M 500,20 C 780,180 920,420 860,650 C 810,840 650,960 500,980 C 350,960 190,840 140,650 C 80,420 220,180 500,20 Z"
  },
  {
    "id": "ribbon",
    "name": "Ribbon",
    "d": "M 60,200 L 150,500 L 60,800 L 850,800 L 940,500 L 850,200 Z"
  },
  {
    "id": "medallion",
    "name": "Medallion",
    "d": "M 500.0,-2.0 L 516.0,2.4 L 531.2,14.8 L 545.1,32.8 L 557.6,53.0 L 569.2,71.7 L 580.7,85.6 L 593.0,92.5 L 607.1,91.6 L 623.4,84.1 L 642.0,72.3 L 662.1,59.5 L 682.4,49.3 L 701.5,44.8 L 717.8,47.7 L 730.3,58.6 L 738.6,76.4 L 743.3,98.6 L 745.8,122.3 L 748.2,144.2 L 752.5,161.7 L 760.6,173.2 L 773.7,178.5 L 791.7,178.9 L 813.5,176.3 L 837.2,173.5 L 859.9,173.1 L 879.1,177.3 L 892.5,187.0 L 899.0,202.2 L 898.8,221.8 L 893.4,244.0 L 885.4,266.4 L 878.0,287.1 L 874.3,304.7 L 876.6,318.6 L 886.0,329.1 L 902.1,337.2 L 922.9,344.4 L 945.4,352.1 L 966.1,361.7 L 981.6,373.7 L 989.4,388.3 L 988.7,404.8 L 980.0,422.4 L 965.5,440.0 L 948.6,456.7 L 932.9,472.2 L 921.9,486.5 L 918.0,500.0 L 921.9,513.5 L 932.9,527.8 L 948.6,543.3 L 965.5,560.0 L 980.0,577.6 L 988.7,595.2 L 989.4,611.7 L 981.6,626.3 L 966.1,638.3 L 945.4,647.9 L 922.9,655.6 L 902.1,662.8 L 886.0,670.9 L 876.6,681.4 L 874.3,695.3 L 878.0,712.9 L 885.4,733.6 L 893.4,756.0 L 898.8,778.2 L 899.0,797.8 L 892.5,813.0 L 879.1,822.7 L 859.9,826.9 L 837.2,826.5 L 813.5,823.7 L 791.7,821.1 L 773.7,821.5 L 760.6,826.8 L 752.5,838.3 L 748.2,855.8 L 745.8,877.7 L 743.3,901.4 L 738.6,923.6 L 730.3,941.4 L 717.8,952.3 L 701.5,955.2 L 682.4,950.7 L 662.1,940.5 L 642.0,927.7 L 623.4,915.9 L 607.1,908.4 L 593.0,907.5 L 580.7,914.4 L 569.2,928.3 L 557.6,947.0 L 545.1,967.2 L 531.2,985.2 L 516.0,997.6 L 500.0,1002.0 L 484.0,997.6 L 468.8,985.2 L 454.9,967.2 L 442.4,947.0 L 430.8,928.3 L 419.3,914.4 L 407.0,907.5 L 392.9,908.4 L 376.6,915.9 L 358.0,927.7 L 337.9,940.5 L 317.6,950.7 L 298.5,955.2 L 282.2,952.3 L 269.7,941.4 L 261.4,923.6 L 256.7,901.4 L 254.2,877.7 L 251.8,855.8 L 247.5,838.3 L 239.4,826.8 L 226.3,821.5 L 208.3,821.1 L 186.5,823.7 L 162.8,826.5 L 140.1,826.9 L 120.9,822.7 L 107.5,813.0 L 101.0,797.8 L 101.2,778.2 L 106.6,756.0 L 114.6,733.6 L 122.0,712.9 L 125.7,695.3 L 123.4,681.4 L 114.0,670.9 L 97.9,662.8 L 77.1,655.6 L 54.6,647.9 L 33.9,638.3 L 18.4,626.3 L 10.6,611.7 L 11.3,595.2 L 20.0,577.6 L 34.5,560.0 L 51.4,543.3 L 67.1,527.8 L 78.1,513.5 L 82.0,500.0 L 78.1,486.5 L 67.1,472.2 L 51.4,456.7 L 34.5,440.0 L 20.0,422.4 L 11.3,404.8 L 10.6,388.3 L 18.4,373.7 L 33.9,361.7 L 54.6,352.1 L 77.1,344.4 L 97.9,337.2 L 114.0,329.1 L 123.4,318.6 L 125.7,304.7 L 122.0,287.1 L 114.6,266.4 L 106.6,244.0 L 101.2,221.8 L 101.0,202.2 L 107.5,187.0 L 120.9,177.3 L 140.1,173.1 L 162.8,173.5 L 186.5,176.3 L 208.3,178.9 L 226.3,178.5 L 239.4,173.2 L 247.5,161.7 L 251.8,144.2 L 254.2,122.3 L 256.7,98.6 L 261.4,76.4 L 269.7,58.6 L 282.2,47.7 L 298.5,44.8 L 317.6,49.3 L 337.9,59.5 L 358.0,72.3 L 376.6,84.1 L 392.9,91.6 L 407.0,92.5 L 419.3,85.6 L 430.8,71.7 L 442.4,53.0 L 454.9,32.8 L 468.8,14.8 L 484.0,2.4 Z"
  },
  {
    "id": "gem",
    "name": "Gem Cut",
    "d": "M 500.0,20.0 L 603.5,113.6 L 740.0,84.3 L 782.8,217.2 L 915.7,260.0 L 886.4,396.5 L 980.0,500.0 L 886.4,603.5 L 915.7,740.0 L 782.8,782.8 L 740.0,915.7 L 603.5,886.4 L 500.0,980.0 L 396.5,886.4 L 260.0,915.7 L 217.2,782.8 L 84.3,740.0 L 113.6,603.5 L 20.0,500.0 L 113.6,396.5 L 84.3,260.0 L 217.2,217.2 L 260.0,84.3 L 396.5,113.6 Z"
  },
  {
    "id": "starburst",
    "name": "Starburst",
    "d": "M 500.0,0.0 L 626.3,195.1 L 853.6,146.4 L 804.9,373.7 L 1000.0,500.0 L 804.9,626.3 L 853.6,853.6 L 626.3,804.9 L 500.0,1000.0 L 373.7,804.9 L 146.4,853.6 L 195.1,626.3 L 0.0,500.0 L 195.1,373.7 L 146.4,146.4 L 373.7,195.1 Z"
  }
];

// `idx` addresses an entry in state.extractedImages (Extract Images gallery
// flow). `placedRef` is the alternate target, an {pageIdx, itemId} pair
// addressing an image dropped straight onto a PDF page in the page editor —
// the two flows share every shape/bevel control and the same preview stage,
// they only differ in where the result gets written back to (see
// applyReshapeConfirm). Exactly one of idx/placedRef is set at a time.
let reshape = { idx: null, placedRef: null, shapeId: 'circle', bevel: false, bevelStyle: 'gold', natW: 1, natH: 1 };
// Referenced by the gallery-image reshape flow below but never declared anywhere, which threw a
// ReferenceError right after a gallery reshape was applied. null = no gallery modal image open.
let modalImgIdx = null;

function openReshapeForIndex(idx, e) {
  if (e) e.stopPropagation();
  state.currentEditIndex = idx;
  openReshape();
}

function reshapeModalImg() {
  if (modalImgIdx !== null) {
    state.currentEditIndex = modalImgIdx;
    closeModal();
    openReshape();
  }
}

function openReshape() {
  if (state.currentEditIndex === null) { toast('Open an image in the editor first', 'error'); return; }
  reshape.idx = state.currentEditIndex;
  reshape.liveClip = false;
  reshape.placedRef = null;
  reshape.shapeId = 'circle';
  reshape.bevel = false;
  reshape.bevelStyle = 'gold';
  const img = state.extractedImages[reshape.idx];
  reshape.srcDataUrl = img.dataUrl;
  openReshapeStage(img.dataUrl);
}

// Opens the same Reshape overlay for an image placed directly on a PDF
// page in the page editor, so this feature is reachable right where the
// person is already working instead of only from the Extract Images
// gallery/modal. Takes the actual placed-image object (not just its id)
// so the reshape result always writes back to the exact image the person
// clicked, even in the rare case two images on a page ended up sharing an
// id (e.g. a duplicated page whose items weren't re-keyed).
function openReshapeForPlaced(pageIdx, item, e) {
  if (e) e.stopPropagation();
  if (!item) { toast('Image not found', 'error'); return; }
  if (item.clip && typeof sppLiveFrame === 'function') { pdfedLiveOpenReshape(pageIdx, item); return; }   // live clip: shape it LIVE, never bake
  reshape.liveClip = false;
  reshape.idx = null;
  reshape.placedRef = { pageIdx, item };
  reshape.shapeId = 'circle';
  reshape.bevel = false;
  reshape.bevelStyle = 'gold';
  reshape.srcDataUrl = item.dataUrl;
  openReshapeStage(item.dataUrl);
}

// Shared setup for the reshape preview stage, used by both entry points above.
function openReshapeStage(dataUrl) {
  rshTempShape = null;
  const ref = document.getElementById('rshStageRef');
  ref.onload = () => {
    reshape.natW = ref.naturalWidth;
    reshape.natH = ref.naturalHeight;
    renderReshapeGrid();
    rshMyShapesLoad(true).then(() => renderReshapeGrid());
    if (!rshShapesSyncedOnce && typeof sarvarcShapesSyncDown === 'function') {
      rshShapesSyncedOnce = true;
      sarvarcShapesSyncDown();
    }
    document.getElementById('rshBevelSwitch').classList.remove('on');
    document.getElementById('rshBevelStylesWrap').style.display = 'none';
    document.querySelectorAll('.rsh-bevel-style').forEach((s, i) => s.classList.toggle('active', i === 0));
    updateReshapePreview();
  };
  ref.src = dataUrl;
  document.getElementById('rshPreviewImage').setAttribute('href', dataUrl);
  document.getElementById('reshapeOverlay').classList.add('open');
}

function closeReshape() {
  document.getElementById('reshapeOverlay').classList.remove('open');
}

function renderReshapeGrid() {
  const swatch = (s, extra) => `
    <div class="rsh-shape-swatch ${s.id === reshape.shapeId ? 'active' : ''}" data-shape="${rshEsc(s.id)}" onclick="selectReshapeShape('${rshEsc(s.id)}',this)" title="${rshEsc(s.name)}">
      <svg viewBox="0 0 1000 1000"><path d="${s.d}"></path></svg>
      <span class="rsh-shape-name">${rshEsc(s.name)}</span>${extra || ''}
    </div>`;
  const grid = document.getElementById('rshShapeGrid');
  grid.innerHTML = RSH_SHAPES.map(s => swatch(s)).join('');
  const my = document.getElementById('rshMyShapeGrid');
  if (!my) return;
  const createTile = `
    <div class="rsh-shape-swatch rsh-create-tile" onclick="csOpen()" title="Draw your own shape">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span class="rsh-shape-name">Create</span>
    </div>`;
  const tmp = rshTempShape ? swatch(rshTempShape) : '';
  const mine = rshMyShapes.map(s => swatch(s,
    `<button type="button" class="rsh-my-btn rsh-my-edit" title="Edit shape" onclick="event.stopPropagation();csOpen('${rshEsc(s.id)}')">&#9998;</button>` +
    `<button type="button" class="rsh-my-btn rsh-my-del" title="Delete shape" onclick="event.stopPropagation();rshDeleteMyShape('${rshEsc(s.id)}',this)">&#10005;</button>`)).join('');
  my.innerHTML = createTile + tmp + mine;
}

function selectReshapeShape(id, el) {
  reshape.shapeId = id;
  document.querySelectorAll('.rsh-shape-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  updateReshapePreview();
}

function toggleReshapeBevel() {
  reshape.bevel = !reshape.bevel;
  document.getElementById('rshBevelSwitch').classList.toggle('on', reshape.bevel);
  document.getElementById('rshBevelStylesWrap').style.display = reshape.bevel ? '' : 'none';
  updateReshapePreview();
}

function setReshapeBevelStyle(style, el) {
  reshape.bevelStyle = style;
  document.querySelectorAll('.rsh-bevel-style').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  updateReshapePreview();
}

function updateReshapePreview() {
  const shape = rshAllShapes().find(s => s.id === reshape.shapeId) || RSH_SHAPES[0];
  document.getElementById('rshClipPathShape').setAttribute('d', shape.d);
  const rimOuter = document.getElementById('rshRimOuter');
  const rimInner = document.getElementById('rshRimInner');
  if (reshape.bevel) {
    const gradId = reshape.bevelStyle === 'gold' ? 'rshGradGold' : reshape.bevelStyle === 'silver' ? 'rshGradSilver' : 'rshGradGraphite';
    rimOuter.setAttribute('d', shape.d);
    rimOuter.setAttribute('stroke', `url(#${gradId})`);
    rimOuter.style.display = '';
    rimInner.setAttribute('d', shape.d);
    rimInner.style.display = '';
  } else {
    rimOuter.style.display = 'none';
    rimInner.style.display = 'none';
  }
}

function rshBuildBevelGradient(ctx, style) {
  const grad = ctx.createLinearGradient(0, 0, 1000, 1000);
  if (style === 'gold') {
    grad.addColorStop(0, '#fff6d8'); grad.addColorStop(0.35, '#e8c76b');
    grad.addColorStop(0.65, '#b8860b'); grad.addColorStop(1, '#5c4200');
  } else if (style === 'silver') {
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#d8d8d8');
    grad.addColorStop(0.65, '#8f8f8f'); grad.addColorStop(1, '#333333');
  } else {
    grad.addColorStop(0, '#6b6b6b'); grad.addColorStop(0.4, '#2b2b2b');
    grad.addColorStop(0.75, '#111111'); grad.addColorStop(1, '#000000');
  }
  return grad;
}

function applyReshapeConfirm() {
  if (reshape.idx === null && !reshape.placedRef) return;
  const shape = rshAllShapes().find(s => s.id === reshape.shapeId) || RSH_SHAPES[0];
  if (reshape.liveClip && reshape.placedRef && reshape.placedRef.item && reshape.placedRef.item.clip) { pdfedLiveApplyModalShape(shape); return; }
  const srcImg = new Image();
  srcImg.onload = () => {
    const w = srcImg.naturalWidth, h = srcImg.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const sx = w / 1000, sy = h / 1000;
    const avgScale = (sx + sy) / 2;
    const p = new Path2D(shape.d);

    ctx.save();
    ctx.scale(sx, sy);

    if (reshape.bevel) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 40 / avgScale;
      ctx.shadowOffsetY = 16 / avgScale;
      ctx.fillStyle = 'rgba(0,0,0,0.001)';
      ctx.fill(p);
      ctx.restore();
    }

    ctx.save();
    ctx.clip(p);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(srcImg, 0, 0, w, h);
    ctx.restore();

    if (reshape.bevel) {
      ctx.save();
      const grad = rshBuildBevelGradient(ctx, reshape.bevelStyle);
      ctx.lineWidth = 20 / avgScale;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = grad;
      ctx.stroke(p);
      ctx.lineWidth = 5 / avgScale;
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.stroke(p);
      ctx.restore();
    }

    ctx.restore();

    const newDataUrl = canvas.toDataURL('image/png');

    // Snapshot the pre-reshape state and register a single undo/redo action
    // in the centralized app history so this feature gets Ctrl+Z / Ctrl+Y
    // (and the Undo/Redo buttons) for free, exactly like every other edit.
    if (reshape.placedRef) {
      const { pageIdx, item } = reshape.placedRef;
      const prevDataUrl = item.dataUrl;

      item.dataUrl = newDataUrl;
      pdfedMarkModified(pageIdx);
      pdfedRenderPlacedImages(pageIdx);

      pushAppHistory({
        label: 'Reshape image',
        undo: () => {
          item.dataUrl = prevDataUrl;
          pdfedMarkModified(pageIdx);
          pdfedRenderPlacedImages(pageIdx);
          toast('Reshape undone', 'info');
        },
        redo: () => {
          item.dataUrl = newDataUrl;
          pdfedMarkModified(pageIdx);
          pdfedRenderPlacedImages(pageIdx);
          toast('Shape applied, ' + shape.name, 'success');
        }
      });
    } else {
      const idxSnap = reshape.idx;
      const imgRef = state.extractedImages[idxSnap];
      const prevDataUrl = imgRef.dataUrl;
      const prevWidth = imgRef.width;
      const prevHeight = imgRef.height;

      imgRef.dataUrl = newDataUrl;
      imgRef.width = w;
      imgRef.height = h;
      if (document.getElementById('galleryWrap').style.display !== 'none') renderGallery();
      if (modalImgIdx === idxSnap) {
        document.getElementById('modalImg').src = newDataUrl;
      }

      pushAppHistory({
        label: 'Reshape image',
        undo: () => {
          const im = state.extractedImages[idxSnap];
          if (!im) return;
          im.dataUrl = prevDataUrl;
          im.width = prevWidth;
          im.height = prevHeight;
          if (document.getElementById('galleryWrap').style.display !== 'none') renderGallery();
          if (modalImgIdx === idxSnap) document.getElementById('modalImg').src = prevDataUrl;
          toast('Reshape undone', 'info');
        },
        redo: () => {
          const im = state.extractedImages[idxSnap];
          if (!im) return;
          im.dataUrl = newDataUrl;
          im.width = w;
          im.height = h;
          if (document.getElementById('galleryWrap').style.display !== 'none') renderGallery();
          if (modalImgIdx === idxSnap) document.getElementById('modalImg').src = newDataUrl;
          toast('Shape applied, ' + shape.name, 'success');
        }
      });
    }

    swTrack('image_shaper_used', { module: 'pdf_editor', shape: shape.custom ? 'custom' : shape.id, bevel: !!reshape.bevel });
    closeReshape();
    toast('Shape applied, ' + shape.name, 'success');
  };
  srcImg.src = reshape.srcDataUrl;
}

// ─── SHAPE STUDIO — draw your own Image Reshaper borders ───────────────────
// A custom shape is stored exactly like the built-in ones: ONE SVG path in a
// 1000×1000 box (`d`). That single string is what the live preview, the
// canvas clip and the 3D bevel already read, so a hand-drawn shape works with
// every existing Reshaper feature with no extra plumbing. On top of `d`, the
// Studio keeps the editable `nodes` the path was built from, so a saved shape
// can be re-opened and tweaked later.
//
// Saved shapes ("My Shapes") live in this account's IndexedDB (the 'kv'
// store, key 'myShapes' — already scoped per signed-in account by
// idbKvOpen) and mirror to the person's own Google Drive folder
// "SARVARC Shapes", exactly like the Assets library does (see GOOGLE DRIVE
// SYNC — MY SHAPES further down). Drive is a best-effort mirror: any failure
// is swallowed so the local save can never break.
const CS_GRID = 50;
const CS_HINTS = {
  pen:  'Click to place points. Click and drag to pull a curve. Click the first point to close the shape.',
  free: 'Draw with your finger or mouse. When you let go it becomes a smooth, editable shape.',
  edit: 'Drag points to move them. Click the outline to add a point. Double-click a point to switch sharp / smooth. Delete removes the selected point.'
};
const cs = {
  nodes: [], closed: false, tool: 'pen', sel: -1, snap: false, smooth: 100,
  hist: [], hpos: -1, drag: null, free: null, hover: null,
  editingId: null, saveIt: true, ready: false
};
let rshMyShapes = [];
let rshMyShapesLoaded = false;
let rshTempShape = null;
let rshShapesSyncedOnce = false;

// ── small helpers ─────────────────────────────────────────────────────────
function csR(n) { return Math.round(n * 10) / 10; }
function csClone(o) { return JSON.parse(JSON.stringify(o)); }
function rshEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function csSvgEl() { return document.getElementById('csSvg'); }
function csK() {
  const r = csSvgEl().getBoundingClientRect();
  return { kx: 1000 / (r.width || 1), ky: 1000 / (r.height || 1) };
}
function csToSvg(e) {
  const r = csSvgEl().getBoundingClientRect();
  return { x: (e.clientX - r.left) / (r.width || 1) * 1000, y: (e.clientY - r.top) / (r.height || 1) * 1000 };
}
function csPxDist(a, b, k) { return Math.hypot((a.x - b.x) / k.kx, (a.y - b.y) / k.ky); }
function csSnapPt(p) {
  if (!cs.snap) return { x: p.x, y: p.y };
  return { x: Math.round(p.x / CS_GRID) * CS_GRID, y: Math.round(p.y / CS_GRID) * CS_GRID };
}
function csClampPt(p) { return { x: Math.max(0, Math.min(1000, p.x)), y: Math.max(0, Math.min(1000, p.y)) }; }
function csF() { return cs.smooth / 100 / 6; }

// ── path maths ────────────────────────────────────────────────────────────
// Every smooth point gets automatic Catmull-Rom style handles (scaled by the
// Smoothness slider). A point can also carry hand-pulled handles (ho = out,
// hi = in, absolute coordinates) which always win over the automatic ones.
// Sharp ("corner") points have no automatic handles at all.
function csHandles(nodes, i, f, closed) {
  const N = nodes.length, n = nodes[i];
  const p = (closed || i > 0) ? nodes[(i - 1 + N) % N] : n;
  const q = (closed || i < N - 1) ? nodes[(i + 1) % N] : n;
  let ho = { x: n.x, y: n.y }, hi = { x: n.x, y: n.y };
  if (n.t !== 'c' && f > 0) {
    const tx = (q.x - p.x) * f, ty = (q.y - p.y) * f;
    const cap = (h, nb) => {
      // Stop a handle overshooting its neighbour (prevents loops on sharp turns)
      const dx = h.x - n.x, dy = h.y - n.y, len = Math.hypot(dx, dy);
      const lim = Math.hypot(nb.x - n.x, nb.y - n.y) * 0.5;
      if (len > lim && len > 0) { h.x = n.x + dx * lim / len; h.y = n.y + dy * lim / len; }
      return h;
    };
    ho = cap({ x: n.x + tx, y: n.y + ty }, q);
    hi = cap({ x: n.x - tx, y: n.y - ty }, p);
  }
  return { ho: n.ho || ho, hi: n.hi || hi };
}
function csSegments(nodes, f, closed) {
  const N = nodes.length, out = [];
  if (N < 2) return out;
  const H = nodes.map((_, i) => csHandles(nodes, i, f, closed));
  const cnt = closed ? N : N - 1;
  for (let i = 0; i < cnt; i++) {
    const j = (i + 1) % N;
    out.push({ i, j, p0: nodes[i], c1: H[i].ho, c2: H[j].hi, p1: nodes[j] });
  }
  return out;
}
function csBuildD(nodes, f, closed) {
  const segs = csSegments(nodes, f, closed);
  if (!segs.length) return '';
  let d = 'M ' + csR(nodes[0].x) + ',' + csR(nodes[0].y);
  segs.forEach(s => {
    d += ' C ' + csR(s.c1.x) + ',' + csR(s.c1.y) + ' ' + csR(s.c2.x) + ',' + csR(s.c2.y) + ' ' + csR(s.p1.x) + ',' + csR(s.p1.y);
  });
  return d + (closed ? ' Z' : '');
}
function csBez(s, t) {
  const u = 1 - t;
  return {
    x: u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p1.x,
    y: u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y
  };
}
function csSamplePts(nodes, f, closed, steps) {
  const pts = [];
  csSegments(nodes, f, closed).forEach(s => { for (let k = 0; k < steps; k++) pts.push(csBez(s, k / steps)); });
  return pts;
}
// Nearest point on the drawn outline, measured in screen pixels
function csNearestOnCurve(raw, k) {
  const segs = csSegments(cs.nodes, csF(), cs.closed);
  let best = null;
  segs.forEach((s, si) => {
    const STEPS = 28;
    let bt = 0, bd = Infinity;
    for (let m = 0; m <= STEPS; m++) {
      const d = csPxDist(raw, csBez(s, m / STEPS), k);
      if (d < bd) { bd = d; bt = m / STEPS; }
    }
    const lo = Math.max(0, bt - 1 / STEPS), hi = Math.min(1, bt + 1 / STEPS);
    for (let m = 0; m <= 10; m++) {
      const t = lo + (hi - lo) * m / 10;
      const d = csPxDist(raw, csBez(s, t), k);
      if (d < bd) { bd = d; bt = t; }
    }
    if (!best || bd < best.dist) best = { seg: s, si, t: bt, dist: bd };
  });
  return best;
}
// Insert a point on the outline WITHOUT changing its shape (de Casteljau split)
function csSplitAt(hit) {
  const s = hit.seg, t = hit.t;
  const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const q0 = L(s.p0, s.c1), q1 = L(s.c1, s.c2), q2 = L(s.c2, s.p1);
  const r0 = L(q0, q1), r1 = L(q1, q2), m = L(r0, r1);
  const a = cs.nodes[s.i], b = cs.nodes[s.j];
  a.ho = { x: q0.x, y: q0.y };
  b.hi = { x: q2.x, y: q2.y };
  const nn = { x: m.x, y: m.y, t: 's', hi: { x: r0.x, y: r0.y }, ho: { x: r1.x, y: r1.y } };
  const at = (s.j === 0 && s.i === cs.nodes.length - 1) ? cs.nodes.length : s.i + 1;
  cs.nodes.splice(at, 0, nn);
  return at;
}
function csRdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = csRdp(pts.slice(0, idx + 1), eps), r = csRdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

// ── history (undo / redo) ─────────────────────────────────────────────────
function csSnap() { return JSON.stringify({ nodes: cs.nodes, closed: cs.closed, smooth: cs.smooth }); }
function csCommit() {
  cs.hist = cs.hist.slice(0, cs.hpos + 1);
  cs.hist.push(csSnap());
  if (cs.hist.length > 80) cs.hist.shift();
  cs.hpos = cs.hist.length - 1;
  csUpdateUi();
}
function csRestore(str) {
  const o = JSON.parse(str);
  cs.nodes = o.nodes; cs.closed = o.closed; cs.smooth = o.smooth; cs.sel = -1; cs.drag = null;
  const sl = document.getElementById('csSmooth');
  if (sl) sl.value = cs.smooth;
  csRender(); csUpdateUi();
}
function csUndo() { if (cs.hpos > 0) { cs.hpos--; csRestore(cs.hist[cs.hpos]); } }
function csRedo() { if (cs.hpos < cs.hist.length - 1) { cs.hpos++; csRestore(cs.hist[cs.hpos]); } }
function csClear() {
  if (!cs.nodes.length) return;
  cs.nodes = []; cs.closed = false; cs.sel = -1;
  csSetTool('pen', true);
  csCommit(); csRender();
}

// ── UI state ──────────────────────────────────────────────────────────────
function csSetTool(t, silent) {
  if (cs.tool === 'pen' && t !== 'pen' && cs.nodes.length >= 3) cs.closed = true;
  cs.tool = t; cs.free = null; cs.drag = null; cs.hover = null;
  if (t === 'pen') cs.sel = -1;
  if (!silent) csRender();
  csUpdateUi();
}
function csUpdateUi() {
  const n = cs.nodes.length;
  document.querySelectorAll('#shapeStudioOverlay .cs-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === cs.tool));
  const hint = document.getElementById('csHint'); if (hint) hint.textContent = CS_HINTS[cs.tool] || '';
  const cnt = document.getElementById('csCount'); if (cnt) cnt.textContent = n + (n === 1 ? ' point' : ' points');
  const use = document.getElementById('csUseBtn');
  if (use) { use.disabled = n < 3; use.style.opacity = n < 3 ? '0.5' : '1'; }
  const u = document.getElementById('csUndoBtn'), r = document.getElementById('csRedoBtn');
  if (u) u.disabled = cs.hpos <= 0;
  if (r) r.disabled = cs.hpos >= cs.hist.length - 1;
  ['csMirrorBtn', 'csFlipHBtn', 'csFlipVBtn', 'csRotBtn', 'csFitBtn'].forEach(id => {
    const b = document.getElementById(id); if (b) b.disabled = n < 2;
  });
  const sv = document.getElementById('csSmoothVal'); if (sv) sv.textContent = cs.smooth + '%';
  const ss = document.getElementById('csSnapSwitch'); if (ss) ss.classList.toggle('on', cs.snap);
  const sw = document.getElementById('csSaveSwitch'); if (sw) sw.classList.toggle('on', cs.saveIt);
  const lbl = document.getElementById('csUseLabel'); if (lbl) lbl.textContent = cs.saveIt ? 'Save & Use Shape' : 'Use Shape';
}
function csToggleSnap() { cs.snap = !cs.snap; csRender(); csUpdateUi(); }
function csToggleSave() { cs.saveIt = !cs.saveIt; csUpdateUi(); }
function csOnSmooth(v) { cs.smooth = parseInt(v, 10) || 0; csRender(); csUpdateUi(); }

// ── rendering ─────────────────────────────────────────────────────────────
function csRender() {
  const svg = csSvgEl(); if (!svg) return;
  const N = cs.nodes.length, f = csF(), k = csK();
  const rx = 7 * k.kx, ry = 7 * k.ky;

  // shape outline (open while drawing, closed afterwards)
  const dLine = csBuildD(cs.nodes, f, cs.closed);
  const dFill = N >= 3 ? (dLine + (cs.closed ? '' : ' Z')) : '';
  document.getElementById('csClipPath').setAttribute('d', dFill);
  document.getElementById('csImgLive').style.display = dFill ? '' : 'none';
  let lineD = dLine;
  if (cs.free && cs.free.pts.length > 1) {
    lineD = 'M ' + cs.free.pts.map(p => csR(p.x) + ',' + csR(p.y)).join(' L ');
  }
  document.getElementById('csPathLine').setAttribute('d', lineD);

  // dashed guide: last point → cursor (pen) and last → first while unclosed
  let guide = '';
  if (!cs.closed && cs.tool === 'pen' && N > 0) {
    const last = cs.nodes[N - 1];
    if (cs.hover) guide += 'M ' + csR(last.x) + ',' + csR(last.y) + ' L ' + csR(cs.hover.x) + ',' + csR(cs.hover.y) + ' ';
    if (N >= 3) guide += 'M ' + csR(last.x) + ',' + csR(last.y) + ' L ' + csR(cs.nodes[0].x) + ',' + csR(cs.nodes[0].y);
  }
  document.getElementById('csPathClose').setAttribute('d', guide);

  // grid + centre line
  let g = '<line x1="500" y1="0" x2="500" y2="1000" stroke="rgba(120,200,255,.55)" stroke-width="1" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>';
  if (cs.snap) {
    for (let v = CS_GRID; v < 1000; v += CS_GRID) {
      if (v === 500) continue;
      g += '<line x1="' + v + '" y1="0" x2="' + v + '" y2="1000" stroke="rgba(255,255,255,.14)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
      g += '<line x1="0" y1="' + v + '" x2="1000" y2="' + v + '" stroke="rgba(255,255,255,.14)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    }
    g += '<line x1="0" y1="500" x2="1000" y2="500" stroke="rgba(255,255,255,.14)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
  }
  document.getElementById('csGrid').innerHTML = g;

  // handles of the selected point
  let hs = '';
  if (cs.tool !== 'free' && cs.sel >= 0 && cs.sel < N) {
    const n = cs.nodes[cs.sel], h = csHandles(cs.nodes, cs.sel, f, cs.closed);
    [h.hi, h.ho].forEach(p => {
      if (Math.hypot((p.x - n.x) / k.kx, (p.y - n.y) / k.ky) < 3) return;
      hs += '<line x1="' + n.x + '" y1="' + n.y + '" x2="' + p.x + '" y2="' + p.y + '" stroke="#e8c76b" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
      hs += '<ellipse cx="' + p.x + '" cy="' + p.y + '" rx="' + 5 * k.kx + '" ry="' + 5 * k.ky + '" fill="#0b0d12" stroke="#e8c76b" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    });
  }
  document.getElementById('csHandles').innerHTML = hs;

  // points: round = smooth, square = sharp, gold = selected, green = "click to close"
  let ns = '';
  cs.nodes.forEach((n, i) => {
    const isSel = i === cs.sel;
    const closable = !cs.closed && i === 0 && N >= 3 && cs.tool === 'pen';
    const fill = isSel ? '#e8c76b' : (closable ? '#3ddc97' : '#ffffff');
    const stroke = isSel ? '#8a6100' : (closable ? '#0f7a4d' : '#1a1f2b');
    const R = closable ? 9 : 7;
    if (n.t === 'c') {
      ns += '<rect x="' + (n.x - R * k.kx) + '" y="' + (n.y - R * k.ky) + '" width="' + 2 * R * k.kx + '" height="' + 2 * R * k.ky + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    } else {
      ns += '<ellipse cx="' + n.x + '" cy="' + n.y + '" rx="' + R * k.kx + '" ry="' + R * k.ky + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    }
  });
  document.getElementById('csNodes').innerHTML = ns;
}

// ── pointer interaction ───────────────────────────────────────────────────
function csHitNode(raw, k) {
  let best = -1, bd = 13;
  cs.nodes.forEach((n, i) => { const d = csPxDist(raw, n, k); if (d < bd) { bd = d; best = i; } });
  return best;
}
function csOnDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  // preventDefault keeps focus where it was; release the name box so Delete / P / F / V shortcuts reach the canvas
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  try { csSvgEl().setPointerCapture(e.pointerId); } catch (err) {}
  const raw = csToSvg(e), k = csK(), f = csF();

  if (cs.tool === 'free') {
    cs.free = { pts: [csClampPt(csSnapPt(raw))] };
    cs.sel = -1;
    csRender();
    return;
  }

  // 1) a handle of the selected point?
  if (cs.sel >= 0 && cs.sel < cs.nodes.length) {
    const n = cs.nodes[cs.sel], h = csHandles(cs.nodes, cs.sel, f, cs.closed);
    for (const which of ['hi', 'ho']) {
      const p = h[which];
      if (Math.hypot((p.x - n.x) / k.kx, (p.y - n.y) / k.ky) < 3) continue;
      if (csPxDist(raw, p, k) < 11) {
        n.hi = { x: h.hi.x, y: h.hi.y }; n.ho = { x: h.ho.x, y: h.ho.y };  // automatic → hand-pulled
        cs.drag = { type: 'handle', idx: cs.sel, which, moved: false };
        return;
      }
    }
  }
  // 2) a point?
  const hit = csHitNode(raw, k);
  if (cs.tool === 'pen') {
    if (hit === 0 && cs.nodes.length >= 3 && !cs.closed) {
      cs.closed = true; cs.sel = -1;
      csSetTool('edit', true);
      csCommit(); csRender();
      return;
    }
    if (hit >= 0) { cs.sel = hit; cs.drag = { type: 'node', idx: hit, moved: false }; csRender(); return; }
    const p = csClampPt(csSnapPt(raw));
    cs.nodes.push({ x: p.x, y: p.y, t: 's' });
    cs.sel = cs.nodes.length - 1;
    cs.drag = { type: 'out', idx: cs.sel, moved: true, fresh: true };
    csRender(); csUpdateUi();
    return;
  }
  // edit tool
  if (hit >= 0) { cs.sel = hit; cs.drag = { type: 'node', idx: hit, moved: false }; csRender(); return; }
  const near = csNearestOnCurve(raw, k);
  if (near && near.dist < 10) {
    const at = csSplitAt(near);
    cs.sel = at;
    cs.drag = { type: 'node', idx: at, moved: true };
    csRender(); csUpdateUi();
    return;
  }
  cs.sel = -1; csRender();
}
function csOnMove(e) {
  const raw = csToSvg(e), k = csK();
  if (cs.free) {
    const last = cs.free.pts[cs.free.pts.length - 1], p = csClampPt(csSnapPt(raw));
    if (csPxDist(p, last, k) > 4) { cs.free.pts.push(p); csRender(); }
    return;
  }
  const d = cs.drag;
  if (!d) {
    if (cs.tool === 'pen' && !cs.closed && cs.nodes.length) { cs.hover = csClampPt(csSnapPt(raw)); csRender(); }
    return;
  }
  const n = cs.nodes[d.idx]; if (!n) return;
  if (d.type === 'node') {
    const p = csClampPt(csSnapPt(raw)), dx = p.x - n.x, dy = p.y - n.y;
    if (dx || dy) {
      n.x = p.x; n.y = p.y;
      if (n.ho) { n.ho.x += dx; n.ho.y += dy; }
      if (n.hi) { n.hi.x += dx; n.hi.y += dy; }
      d.moved = true;
    }
  } else if (d.type === 'handle') {
    const p = csSnapPt(raw);
    n[d.which] = { x: p.x, y: p.y };
    if (n.t !== 'c' && !e.altKey) {                       // keep the curve smooth through the point
      const other = d.which === 'ho' ? 'hi' : 'ho';
      n[other] = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
    }
    d.moved = true;
  } else if (d.type === 'out') {                          // click-drag while placing a point pulls a curve
    const p = csSnapPt(raw);
    if (csPxDist(p, n, k) > 5) {
      n.ho = { x: p.x, y: p.y };
      n.hi = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
      n.t = 's';
    }
  }
  csRender();
}
function csOnUp(e) {
  try { csSvgEl().releasePointerCapture(e.pointerId); } catch (err) {}
  if (cs.free) { csFinishFree(); return; }
  const d = cs.drag; cs.drag = null;
  if (d && d.moved) { csCommit(); }
  csRender();
}
function csOnDbl(e) {
  const raw = csToSvg(e), k = csK();
  const i = csHitNode(raw, k);
  if (i < 0) return;
  const n = cs.nodes[i];
  n.t = n.t === 'c' ? 's' : 'c';
  delete n.ho; delete n.hi;
  cs.sel = i; csCommit(); csRender();
}
function csDeleteSel() {
  if (cs.sel < 0 || cs.sel >= cs.nodes.length) return;
  if (cs.nodes.length <= 3 && cs.closed) { toast('A shape needs at least 3 points', 'info'); return; }
  cs.nodes.splice(cs.sel, 1);
  cs.sel = -1;
  csCommit(); csRender();
}
function csFinishFree() {
  const pts = cs.free.pts; cs.free = null;
  if (pts.length < 6) { csRender(); return; }
  const k = csK(), base = 9 * (k.kx + k.ky) / 2;
  let eps = base, s = csRdp(pts, eps);
  const first = pts[0], last = pts[pts.length - 1];
  while (s.length > 48 && eps < 200) { eps *= 1.3; s = csRdp(pts, eps); }
  if (s.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < base * 2.5) s.pop();
  if (s.length < 3) { toast('Draw a little bigger, a shape needs at least 3 points', 'info'); csRender(); return; }
  cs.nodes = s.map(p => ({ x: csR(p.x), y: csR(p.y), t: 's' }));
  cs.closed = true; cs.sel = -1;
  csSetTool('edit', true);
  csCommit(); csRender();
}

// ── shape tools ───────────────────────────────────────────────────────────
function csTransform(fn) {
  cs.nodes.forEach(n => {
    const a = fn(n.x, n.y); n.x = csR(a[0]); n.y = csR(a[1]);
    ['ho', 'hi'].forEach(w => { if (n[w]) { const b = fn(n[w].x, n[w].y); n[w] = { x: csR(b[0]), y: csR(b[1]) }; } });
  });
  csCommit(); csRender();
}
function csFlip(axis) { csTransform(axis === 'h' ? (x, y) => [1000 - x, y] : (x, y) => [x, 1000 - y]); }
function csRotate() { csTransform((x, y) => [1000 - y, x]); }
function csFit() {
  if (cs.nodes.length < 2) return;
  const pts = csSamplePts(cs.nodes, csF(), cs.closed || cs.nodes.length >= 3, 12);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  const w = x1 - x0, h = y1 - y0;
  if (w < 5 && h < 5) return;
  const s = Math.min(940 / Math.max(w, 1), 940 / Math.max(h, 1)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  csTransform((x, y) => [500 + (x - cx) * s, 500 + (y - cy) * s]);
}
// Draw one half along the centre line, tap Mirror, get a perfectly symmetric shape
function csMirrorHalf() {
  if (cs.nodes.length < 2) return;
  const left = cs.nodes.filter(n => n.x < 500).length >= cs.nodes.filter(n => n.x > 500).length;
  const src = csClone(cs.nodes);
  src.forEach(n => {
    if (left ? n.x > 500 : n.x < 500) n.x = 500;      // keep everything on the drawn side
    if (Math.abs(n.x - 500) < 14) { n.x = 500; delete n.ho; delete n.hi; n.t = 's'; }
  });
  const onAxis = n => n.x === 500;
  const startOn = onAxis(src[0]), endOn = onAxis(src[src.length - 1]);
  const mir = n => {
    const m = csClone(n); m.x = 1000 - m.x;
    if (m.ho) m.ho.x = 1000 - m.ho.x;
    if (m.hi) m.hi.x = 1000 - m.hi.x;
    const t = m.hi; m.hi = m.ho; m.ho = t;             // reflecting reverses direction
    if (!m.hi) delete m.hi; if (!m.ho) delete m.ho;
    return m;
  };
  const out = src.slice();
  for (let i = src.length - 1; i >= 0; i--) {
    if (i === src.length - 1 && endOn) continue;
    if (i === 0 && startOn) continue;
    out.push(mir(src[i]));
  }
  if (out.length < 3) { toast('Add a few more points on one side first', 'info'); return; }
  cs.nodes = out; cs.closed = true; cs.sel = -1;
  csSetTool('edit', true);
  csCommit(); csRender();
}
function csStarterD(id) {
  if (id === 'heart') return 'M 500,900 C 150,640 40,430 130,270 C 210,130 400,120 500,290 C 600,120 790,130 870,270 C 960,430 850,640 500,900 Z';
  if (id === 'star5') {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 200 : 480;
      d += (i ? ' L ' : 'M ') + csR(500 + r * Math.cos(a)) + ',' + csR(530 + r * Math.sin(a));
    }
    return d + ' Z';
  }
  const s = RSH_SHAPES.find(x => x.id === id);
  return s ? s.d : '';
}
// Turn any existing shape into editable points
function csStartFrom(id) {
  const sel = document.getElementById('csStart');
  if (!id) return;
  if (id === '__blank') { cs.nodes = []; cs.closed = false; cs.sel = -1; csSetTool('pen', true); csCommit(); csRender(); if (sel) sel.value = ''; return; }
  const d = csStarterD(id) || ((rshMyShapes.find(x => x.id === id) || {}).d || '');
  if (sel) sel.value = '';
  if (!d) return;
  const NS = 'http://www.w3.org/2000/svg';
  const host = document.createElementNS(NS, 'g');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d); host.appendChild(path);
  csSvgEl().appendChild(host);
  let pts = [];
  try {
    const L = path.getTotalLength(), M = 320;
    for (let i = 0; i <= M; i++) { const p = path.getPointAtLength(L * i / M); pts.push({ x: p.x, y: p.y }); }
  } catch (err) { pts = []; }
  csSvgEl().removeChild(host);
  if (pts.length < 8) { toast('Could not load that shape', 'error'); return; }
  let eps = 5, s = csRdp(pts, eps);
  while (s.length > 48 && eps < 100) { eps *= 1.25; s = csRdp(pts, eps); }
  if (s.length > 2 && Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y) < 3) s.pop();
  const nodes = s.map((p, i) => {
    const a = s[(i - 1 + s.length) % s.length], b = s[(i + 1) % s.length];
    const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    return { x: csR(p.x), y: csR(p.y), t: ang < 140 ? 'c' : 's' };
  });
  cs.nodes = nodes; cs.closed = true; cs.sel = -1;
  csSetTool('edit', true);
  csCommit(); csRender();
}

// ── open / close / use ────────────────────────────────────────────────────
function csInitOnce() {
  if (cs.ready) return;
  cs.ready = true;
  const svg = csSvgEl();
  svg.addEventListener('pointerdown', csOnDown);
  svg.addEventListener('pointermove', csOnMove);
  svg.addEventListener('pointerup', csOnUp);
  svg.addEventListener('pointercancel', csOnUp);
  svg.addEventListener('dblclick', csOnDbl);
  svg.addEventListener('pointerleave', () => { if (cs.hover) { cs.hover = null; csRender(); } });
  window.addEventListener('resize', () => { if (csIsOpen()) csRender(); });
  window.addEventListener('keydown', (e) => {
    if (!csIsOpen()) return;
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey, key = (e.key || '').toLowerCase();
    if (mod && !typing && key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); e.shiftKey ? csRedo() : csUndo(); return; }
    if (mod && !typing && key === 'y') { e.preventDefault(); e.stopImmediatePropagation(); csRedo(); return; }
    if (key === 'escape') { e.stopImmediatePropagation(); csClose(); return; }
    if (typing) { e.stopPropagation(); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); e.stopImmediatePropagation(); csDeleteSel(); return; }
    if (!mod && key === 'p') { e.stopImmediatePropagation(); csSetTool('pen'); }
    else if (!mod && key === 'f') { e.stopImmediatePropagation(); csSetTool('free'); }
    else if (!mod && (key === 'v' || key === 'e')) { e.stopImmediatePropagation(); csSetTool('edit'); }
  }, true);
}
function csIsOpen() { const o = document.getElementById('shapeStudioOverlay'); return !!(o && o.classList.contains('open')); }

async function csOpen(editId) {
  if (!reshape || !reshape.srcDataUrl) return;
  csInitOnce();
  await rshMyShapesLoad();
  cs.editingId = null; cs.drag = null; cs.free = null; cs.hover = null; cs.sel = -1;
  cs.snap = false; cs.saveIt = true; cs.smooth = 100;
  cs.nodes = []; cs.closed = false; cs.tool = 'pen';
  let name = 'My Shape ' + (rshMyShapes.length + 1);
  const rec = editId ? rshMyShapes.find(s => s.id === editId) : null;
  if (rec && Array.isArray(rec.nodes) && rec.nodes.length >= 3) {
    cs.editingId = rec.id; cs.nodes = csClone(rec.nodes); cs.closed = true; cs.tool = 'edit';
    cs.smooth = typeof rec.smooth === 'number' ? rec.smooth : 100; name = rec.name;
  }
  document.getElementById('csName').value = name;
  const sl = document.getElementById('csSmooth'); sl.value = cs.smooth;
  const opts = ['<option value="">Start from…</option>', '<option value="__blank">Blank canvas</option>'];
  const starters = [['heart', 'Heart'], ['star5', 'Star']].concat(RSH_SHAPES.map(s => [s.id, s.name]));
  opts.push(starters.map(s => '<option value="' + s[0] + '">' + rshEsc(s[1]) + '</option>').join(''));
  if (rshMyShapes.length) opts.push('<optgroup label="My Shapes">' + rshMyShapes.map(s => '<option value="' + rshEsc(s.id) + '">' + rshEsc(s.name) + '</option>').join('') + '</optgroup>');
  document.getElementById('csStart').innerHTML = opts.join('');

  const ref = document.getElementById('csStageRef');
  ref.onload = () => csRender();
  ref.src = reshape.srcDataUrl;
  document.getElementById('csImgDim').setAttribute('href', reshape.srcDataUrl);
  document.getElementById('csImgLive').setAttribute('href', reshape.srcDataUrl);
  cs.hist = []; cs.hpos = -1; csCommit();
  document.getElementById('shapeStudioOverlay').classList.add('open');
  requestAnimationFrame(() => { csRender(); csUpdateUi(); });
}
function csClose() {
  document.getElementById('shapeStudioOverlay').classList.remove('open');
  cs.drag = null; cs.free = null;
}
async function csUse() {
  if (cs.nodes.length < 3) return;
  if (!cs.closed) cs.closed = true;
  const d = csBuildD(cs.nodes, csF(), true);
  const name = (document.getElementById('csName').value || '').trim().slice(0, 40) || 'My Shape';
  if (cs.saveIt) {
    await rshMyShapesLoad();
    let rec = cs.editingId ? rshMyShapes.find(s => s.id === cs.editingId) : null;
    if (rec) {
      rec.name = name; rec.d = d; rec.nodes = csClone(cs.nodes); rec.smooth = cs.smooth; rec.updatedAt = Date.now();
    } else {
      rec = {
        id: 'cshape_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, d, nodes: csClone(cs.nodes), smooth: cs.smooth, createdAt: Date.now(), driveFileId: null
      };
      rshMyShapes.unshift(rec);
    }
    await rshMyShapesPersist();
    reshape.shapeId = rec.id;
    // Best-effort Google Drive mirror: never blocks or breaks the local save
    const drive = (typeof sarvarcDriveSaveShape === 'function')
      ? sarvarcDriveSaveShape(rec).then(() => true).catch(() => false) : Promise.resolve(false);
    toast('Saved to My Shapes', 'success');
    drive.then(ok => { if (ok) toast('Backed up to your Google Drive', 'info'); });
  } else {
    rshTempShape = { id: 'cshape_tmp', name, d, custom: true };
    reshape.shapeId = 'cshape_tmp';
  }
  if (typeof swTrack === 'function') swTrack('custom_shape_created', { module: 'pdf_editor', saved: !!cs.saveIt, points: cs.nodes.length, tool: cs.tool });
  csClose();
  renderReshapeGrid();
  updateReshapePreview();
}

// ── My Shapes: local storage ──────────────────────────────────────────────
function rshShapeIdOk(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id); }
function rshShapePathOk(d) { return typeof d === 'string' && d.length < 20000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(d); }
async function rshKvGet(key, fallback) {
  try {
    const db = await idbKvOpen();
    return await new Promise((resolve) => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      rq.onsuccess = () => resolve(rq.result === undefined ? fallback : rq.result);
      rq.onerror = () => resolve(fallback);
    });
  } catch (e) { return fallback; }
}
async function rshKvPut(key, val) {
  try {
    const db = await idbKvOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('[My Shapes] could not save locally', e); }
}
async function rshMyShapesLoad(force) {
  if (rshMyShapesLoaded && !force) return rshMyShapes;
  const arr = await rshKvGet('myShapes', []);
  rshMyShapes = (Array.isArray(arr) ? arr : []).filter(s => s && rshShapeIdOk(s.id) && rshShapePathOk(s.d));
  rshMyShapesLoaded = true;
  return rshMyShapes;
}
function rshMyShapesPersist() { return rshKvPut('myShapes', rshMyShapes); }
async function rshTombLoad() { const a = await rshKvGet('myShapesDeleted', []); return Array.isArray(a) ? a : []; }
function rshAllShapes() {
  const mine = rshMyShapes.map(s => ({ id: s.id, name: s.name, d: s.d, custom: true }));
  return RSH_SHAPES.concat(rshTempShape ? [rshTempShape] : [], mine);
}
async function rshDeleteMyShape(id, btn) {
  if (btn && btn.dataset.armed !== '1') {           // first tap arms, second tap deletes
    btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = 'Sure?';
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = '&#10005;'; } }, 2500);
    return;
  }
  const rec = rshMyShapes.find(s => s.id === id);
  rshMyShapes = rshMyShapes.filter(s => s.id !== id);
  await rshMyShapesPersist();
  // Tombstone so the Drive copy is removed (now, or next time Drive is reachable)
  // and can never be re-pulled onto this device.
  const tomb = await rshTombLoad();
  tomb.push({ id, driveFileId: rec ? rec.driveFileId || null : null });
  await rshKvPut('myShapesDeleted', tomb);
  if (reshape.shapeId === id) reshape.shapeId = 'circle';
  renderReshapeGrid(); updateReshapePreview();
  if (typeof sarvarcShapesSyncUp === 'function') sarvarcShapesSyncUp();
}
