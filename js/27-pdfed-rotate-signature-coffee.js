// ─── PAGE ROTATE ──────────────────────────────────────────────────────────────

let pdfedRotateReplaying = false;
async function pdfedRotatePage(deg) {
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) { toast('No page loaded', 'error'); return; }
  const pg = pdfed.pages[idx];

  // Snapshot enough of the page to fully undo this rotation: the flat image,
  // and every placed text/image box's position + rotation (all mutated below).
  const rotateUndoSnap = {
    dataUrl: pg.dataUrl,
    modified: pg.modified,
    placedImages: JSON.parse(JSON.stringify(pg.placedImages || [])),
    placedTexts: JSON.parse(JSON.stringify(pg.placedTexts || []))
  };

  // Bake any pen/highlighter/shape/redact annotations first — those were
  // never meant to be re-editable objects, so flattening them is fine.
  pdfedBakeAnnotations();

  // Tables don't carry their own rotation yet (their rows/cols/cells assume
  // an upright grid), so they're still baked into the flat page before
  // rotating, same as before. Placed TEXT and IMAGE boxes are handled
  // differently below: instead of being destroyed here, each one now
  // carries its own `rotation` and rides through the page turn as a live,
  // still-fully-editable object — including a full round trip (e.g. Right
  // then Left, or four Rights) landing every box back at its exact original
  // spot, still typeable/movable/lockable, instead of permanently flattened
  // into pixels the moment Rotate was clicked even once.
  if (pg.placedTables && pg.placedTables.length) {
    const baseUrl = await pdfedPageUrlBase(pg);
    const baseImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = baseUrl; });
    const can = document.createElement('canvas');
    can.width = baseImg.naturalWidth; can.height = baseImg.naturalHeight;
    const ctx = can.getContext('2d');
    ctx.drawImage(baseImg, 0, 0);
    await pdfedDrawOrderedPlacedOnCtx(ctx, pg, true, true); // skip texts AND images, bake tables only
    pg.dataUrl = can.toDataURL('image/png');
    pg.placedTables = [];
  }

  const pc = document.getElementById('pdfedPageCanvas');
  // If tables were just baked above, make sure the on-screen canvas reflects
  // those pixels before we snapshot it below for the actual page rotation.
  if (pg.dataUrl) {
    const fresh = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = pg.dataUrl; });
    pc.width = fresh.naturalWidth; pc.height = fresh.naturalHeight;
    pc.getContext('2d').drawImage(fresh, 0, 0);
  }

  const oldW = pc.width, oldH = pc.height;
  const src = pc.toDataURL('image/png');
  const img = await new Promise(res => {
    const i = new Image(); i.onload = () => res(i); i.src = src;
  });
  const tmp = document.createElement('canvas');
  const rad = deg * Math.PI / 180;
  if (deg === 90 || deg === -90) {
    tmp.width = img.height; tmp.height = img.width;
  } else {
    tmp.width = img.width; tmp.height = img.height;
  }
  const ctx = tmp.getContext('2d');
  ctx.translate(tmp.width / 2, tmp.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const newDataUrl = tmp.toDataURL('image/png');
  pdfed.pages[idx].dataUrl = newDataUrl;
  pdfed.pages[idx].modified = true;

  // Carry every placed text/image box through the same turn the page itself
  // just took: rotate its center point around the page's center (swapping
  // width/height on a ±90° turn) and add this turn to the box's own
  // accumulated rotation. The box's own width/height and text wrap are left
  // completely alone — only position and angle change — so nothing about
  // its content or editability is touched, and repeated/opposite rotations
  // cancel out exactly.
  const pdfedRotateItemsList = (list, layerId) => {
    if (!list || !list.length) return;
    const layer = document.getElementById(layerId);
    list.forEach(item => {
      const el = layer && layer.querySelector(`[data-id="${item.id}"]`);
      const w = item.w || (el ? el.offsetWidth : 0);
      const h = item.h || (el ? el.offsetHeight : (item.fontSize ? item.fontSize * 1.25 : 0));
      const cx = item.x + w / 2, cy = item.y + h / 2;
      let ncx, ncy;
      if (deg === 90) { ncx = oldH - cy; ncy = cx; }
      else if (deg === -90) { ncx = cy; ncy = oldW - cx; }
      else { ncx = oldW - cx; ncy = oldH - cy; } // 180
      item.rotation = ((item.rotation || 0) + deg + 360) % 360;
      item.x = ncx - w / 2;
      item.y = ncy - h / 2;
    });
  };
  pdfedRotateItemsList(pg.placedImages, 'pdfedPlacedImagesLayer');
  pdfedRotateItemsList(pg.placedTexts, 'pdfedPlacedTextsLayer');
  await pdfedGoto(idx);
  await pdfedBuildStrip();
  toast('Page rotated ' + (deg > 0 ? 'right' : 'left'), 'success');

  if (!pdfedRotateReplaying) {
    pushAppHistory({
      label: 'Rotate page',
      undo: async () => {
        pg.dataUrl = rotateUndoSnap.dataUrl;
        pg.modified = rotateUndoSnap.modified;
        pg.placedImages = rotateUndoSnap.placedImages;
        pg.placedTexts = rotateUndoSnap.placedTexts;
        await pdfedGoto(idx);
        await pdfedBuildStrip();
        toast('Rotation undone', 'info');
      },
      redo: async () => {
        pdfedRotateReplaying = true;
        try { await pdfedRotatePage(deg); } finally { pdfedRotateReplaying = false; }
      }
    });
  }
}

// ─── IMAGE INSERT ─────────────────────────────────────────────────────────────

// ─── E-SIGNATURE ───
let pdfedSig = { color: '#0A0F1E', drawing: false, hasInk: false, ctx: null, smoothing: true, strokes: [], curStroke: null, rawLast: null };

function pdfedOpenSignatureModal() {
  if (pdfed.active < 0) { toast('Open a PDF page first', 'error'); return; }
  document.getElementById('pdfedSigModal').style.display = 'flex';
  pdfedSigSwitchTab('draw');
  requestAnimationFrame(() => pdfedSigInitCanvas());
}
function pdfedCloseSignatureModal() {
  document.getElementById('pdfedSigModal').style.display = 'none';
}

function pdfedSigSwitchTab(tab) {
  ['draw','type','upload'].forEach(t => {
    document.getElementById('pdfedSigPane-' + t).style.display = (t === tab) ? '' : 'none';
    const btn = document.getElementById('pdfedSigTab-' + t);
    btn.style.background = (t === tab) ? 'var(--blue)' : 'transparent';
    btn.style.color = (t === tab) ? '#fff' : 'var(--text2)';
  });
  if (tab === 'type') pdfedSigRenderTyped();
}

function pdfedSigSetSmoothing(on) {
  pdfedSig.smoothing = on;
}

// Draw pane, works with mouse and touch.
// "Smart Smoothing" combines two passes:
//  1) a live low-pass filter on incoming points, so hand tremor doesn't register as jitter
//  2) a quadratic-curve-through-midpoints redraw of every stroke, which turns the raw
//     polyline into a continuous flowing curve instead of jagged straight segments.
// Net effect: the signature looks like a clean, confident pen stroke instead of a shaky scan.
function pdfedSigInitCanvas() {
  const cv = document.getElementById('pdfedSigCanvas');
  if (!cv || cv._sigBound) { pdfedSigClearCanvas(); return; }
  cv._sigBound = true;
  const ctx = cv.getContext('2d');
  pdfedSig.ctx = ctx;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function posFromEvent(e) {
    const rect = cv.getBoundingClientRect();
    const sx = cv.width / rect.width, sy = cv.height / rect.height;
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - rect.left) * sx, y: (p.clientY - rect.top) * sy };
  }

  function start(e) {
    e.preventDefault();
    const p = posFromEvent(e);
    pdfedSig.drawing = true; pdfedSig.hasInk = true;
    pdfedSig.curStroke = { color: pdfedSig.color, pts: [p] };
    pdfedSig.strokes.push(pdfedSig.curStroke);
    pdfedSig.rawLast = p;
  }
  function move(e) {
    if (!pdfedSig.drawing) return;
    e.preventDefault();
    const raw = posFromEvent(e);
    let p = raw;
    if (pdfedSig.smoothing) {
      // Low-pass filter: blend toward the new point rather than snapping to it,
      // so small hand tremors get absorbed instead of drawn.
      const last = pdfedSig.rawLast;
      p = { x: last.x * 0.35 + raw.x * 0.65, y: last.y * 0.35 + raw.y * 0.65 };
    }
    pdfedSig.rawLast = raw;
    pdfedSig.curStroke.pts.push(p);
    pdfedSigRedraw();
  }
  function end() { pdfedSig.drawing = false; pdfedSig.curStroke = null; }

  cv.addEventListener('mousedown', start);
  cv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end);

  pdfedSigClearCanvas();
}

// Redraws every stroke as a smooth quadratic curve through point midpoints
// (the same technique used by production signature pads) instead of raw lineTo segments.
function pdfedSigRedraw() {
  const cv = document.getElementById('pdfedSigCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of pdfedSig.strokes) {
    const pts = stroke.pts;
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    if (pts.length < 2) {
      // Single tap, draw a dot so a tiny mark still shows.
      ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
      continue;
    }
    if (!pdfedSig.smoothing || pts.length < 3) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      continue;
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

function pdfedSigClearCanvas() {
  const cv = document.getElementById('pdfedSigCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  pdfedSig.hasInk = false;
  pdfedSig.strokes = [];
  pdfedSig.curStroke = null;
}
function pdfedSigSetColor(c) {
  pdfedSig.color = c;
  document.querySelectorAll('.pdfed-sig-color').forEach(b => {
    b.style.borderColor = (b.getAttribute('data-c') === c) ? 'var(--blue)' : 'transparent';
  });
}

let pdfedSigFontValue = 'cursive';
function pdfedSigSetFont(value) {
  pdfedSigFontValue = value;
  sarvarcLoadFont(value);
  const btn = document.getElementById('pdfedSigFontBtn');
  if (btn) btn.textContent = (value === 'cursive') ? 'Signature Script' : value.split(',')[0].replace(/['"]/g, '');
  pdfedSigRenderTyped();
}

// Type pane, renders typed name in a script font to a canvas
function pdfedSigRenderTyped() {
  const cv = document.getElementById('pdfedSigTypeCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const text = document.getElementById('pdfedSigTypeInput').value.trim();
  if (!text) return;
  const fontSel = pdfedSigFontValue;
  const fontStack = (fontSel === 'cursive') ? "'Brush Script MT', cursive" : (fontSel.includes(',') ? fontSel : `'${fontSel}', cursive`);
  const font = `italic 56px ${fontStack}`;
  ctx.font = font;
  ctx.fillStyle = '#0A0F1E';
  ctx.textBaseline = 'middle';
  let w = ctx.measureText(text).width;
  // shrink to fit if needed
  let size = 56;
  while (w > cv.width - 40 && size > 18) {
    size -= 2;
    ctx.font = `italic ${size}px ${fontStack}`;
    w = ctx.measureText(text).width;
  }
  ctx.fillText(text, (cv.width - w) / 2, cv.height / 2);
}

// Upload pane
let pdfedSigUploadDataUrl = null;
function pdfedSigUploadFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pdfedSigUploadDataUrl = ev.target.result;
    const prev = document.getElementById('pdfedSigUploadPreview');
    prev.src = pdfedSigUploadDataUrl;
    prev.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// Trims transparent/white margins so the placed signature isn't surrounded by empty space
var _k32b2cc_3c5e = 1;
function pdfedSigTrimCanvas(srcCanvas, bgIsWhite) {
  const ctx = srcCanvas.getContext('2d');
  const { width, height } = srcCanvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      const isBlank = bgIsWhite
        ? (data[i] > 245 && data[i+1] > 245 && data[i+2] > 245)
        : (a < 10);
      if (!isBlank) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return srcCanvas.toDataURL('image/png');
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX; out.height = maxY - minY;
  out.getContext('2d').drawImage(srcCanvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Confirms whichever tab is active and hands the signature off to the existing
// placed-image ghost pipeline (drag/resize/stamp/lock/delete/export all reused).
function pdfedSigConfirm() {
  const activeTab = document.getElementById('pdfedSigPane-draw').style.display !== 'none' ? 'draw'
    : document.getElementById('pdfedSigPane-type').style.display !== 'none' ? 'type' : 'upload';

  let dataUrl = null;

  if (activeTab === 'draw') {
    if (!pdfedSig.hasInk) { toast('Draw your signature first', 'error'); return; }
    dataUrl = pdfedSigTrimCanvas(document.getElementById('pdfedSigCanvas'), false);
  } else if (activeTab === 'type') {
    const text = document.getElementById('pdfedSigTypeInput').value.trim();
    if (!text) { toast('Type your name first', 'error'); return; }
    dataUrl = pdfedSigTrimCanvas(document.getElementById('pdfedSigTypeCanvas'), true);
  } else {
    if (!pdfedSigUploadDataUrl) { toast('Upload a signature image first', 'error'); return; }
    dataUrl = pdfedSigUploadDataUrl;
  }

  pdfedCloseSignatureModal();
  // 'signature' rides along on the ghost so pdfedBakeImage stamps it onto
  // the placedImage record (see pdfedActivateImgGhost) — without this the
  // placed image on canvas is indistinguishable from a plain photo, so a
  // later right-click "Send to Client Folder" would file it under Images
  // instead of Signatures.
  pdfedActivateImgGhost(dataUrl, 'signature');
  // Auto-store in the Assets library (right panel), however it was made —
  // drawn, typed, or uploaded — so it's ready to reuse next time.
  if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('signature', dataUrl);
  toast('Position your signature, then click Stamp to place it', 'info');
}

// Auto-creates a single blank A4 page and switches into the editor when the
// person tries to insert something (image, gallery pick, etc.) before any
// PDF or canvas is open — so tools like "Insert Image" work standalone
// instead of requiring a document to be opened first. No-op (besides the
// return value) if a live page already exists. Mirrors the bootstrap steps
// used elsewhere (see pdfedAppendTableFitPages / dgInsertAnalysisIntoWorkspace)
// so the resulting blank document behaves identically either way.
async function pdfedEnsureBlankDocument() {
  if (pdfed.active >= 0 && pdfed.pages[pdfed.active]) return true;
  const mmW = 210, mmH = 297;
  const url = await pdfedRenderBlankPage('', '#ffffff', mmW, mmH);
  pdfed.pages = [{
    type: 'blank', dataUrl: url, modified: true, edits: {},
    textBlocks: [], placedTexts: [], placedImages: [], placedTables: [],
    label: 'Page 1', bgColor: '#ffffff', pageMM: [mmW, mmH]
  }];
  pdfed.pdfDoc = null;
  pdfed.file = { name: 'Untitled Document' };
  ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
  const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
  const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
  const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
  const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
  if (state && state.stats) { state.stats.pdfs++; state.stats.pages++; }
  if (typeof updateStats === 'function') updateStats();
  if (typeof navigate === 'function') navigate('pdfeditor');
  if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
  if (typeof pdfedGoto === 'function') await pdfedGoto(0);
  setTimeout(() => { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 120);
  return true;
}

function pdfedTriggerImgInsert() {
  document.getElementById('pdfedImgInsertInput').click();
}

async function pdfedInsertFromExtracted() {
  if (!state.extractedImages || state.extractedImages.length === 0) {
    toast('Gallery is empty, go to Extract Images, load a PDF, and run extraction first', 'info');
    // Optionally prompt the user to navigate there
    if (confirm('No images in gallery yet. Go to Extract Images now?')) {
      navigate('extract');
    }
    return;
  }
  await pdfedEnsureBlankDocument();
  // Show picker modal
  pdfedShowGalleryPicker();
}

function pdfedShowGalleryPicker() {
  // Remove old modal if any
  const old = document.getElementById('pdfedGalleryPickerModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'pdfedGalleryPickerModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:24px;max-width:560px;width:90%;max-height:80vh;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="font-size:16px;font-weight:700;">Pick from Extracted Gallery</h3>
        <button onclick="document.getElementById('pdfedGalleryPickerModal').remove()" style="background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;overflow-y:auto;max-height:400px;">
        ${state.extractedImages.map((img, i) => `
          <div onclick="pdfedInsertExtractedImg(${i});document.getElementById('pdfedGalleryPickerModal').remove()"
            style="border:2px solid var(--border);border-radius:8px;overflow:hidden;cursor:pointer;transition:border 0.15s;"
            onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'">
            <img src="${img.dataUrl}" alt="${img.name}" style="width:100%;height:80px;object-fit:cover;display:block;">
            <div style="font-size:9px;padding:4px 6px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${img.name}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

var _kc21800_1e20 = 1;
function pdfedInsertExtractedImg(idx) {
  const img = state.extractedImages[idx];
  if (!img) return;
  pdfedActivateImgGhost(img.dataUrl);
}

// ============== BUY ME A COFFEE (Razorpay) ==============
// SECURITY NOTE: exactly the same pattern as the stock photo search above.
// The Razorpay Key ID is safe to put here (it's meant to be public and is
// used by Razorpay's own checkout widget). The Key Secret is NEVER put in
// this file — it lives only in a backend proxy (Cloudflare Worker), which
// creates orders and verifies payment signatures server-side. See
// razorpay-proxy-worker.js for that backend code.
const RAZORPAY_KEY_ID = 'rzp_live_TEAaROVnVTpSIm'; // public Key ID — safe in client code. Live mode.
const RAZORPAY_PROXY_ENDPOINT = 'https://sarvarc-razorpay-proxy.sarvarcworkspace.workers.dev'; // <-- update after deploying the Worker

const pdfedCoffee = { amount: 99 }; // default preset, in INR

function _q89da1fReady() { try { return typeof window !== 'undefined'; } catch (e) { return false; } }
function pdfedOpenCoffeeModal() {
  const old = document.getElementById('pdfedCoffeeModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'pdfedCoffeeModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:24px;max-width:380px;width:90%;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="font-size:16px;font-weight:700;">Support The Development Of SARVARC</h3>
        <button onclick="document.getElementById('pdfedCoffeeModal').remove()" style="background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="font-size:12.5px;color:var(--text2);">If SARVARC Workspace has been useful, a small tip helps keep it going. Thank you!</div>
      <div style="display:flex;gap:8px;" id="pdfedCoffeeAmounts">
        ${[49, 99, 199].map(v => `
          <button class="pdfed-coffee-amt-btn" data-amt="${v}" onclick="pdfedSelectCoffeeAmount(${v}, this)"
            style="flex:1;padding:10px 0;border-radius:8px;border:2px solid ${v === pdfedCoffee.amount ? 'var(--blue)' : 'var(--border2)'};background:var(--surface2);color:var(--text);font-weight:700;font-size:13px;cursor:pointer;">
            ₹${v}
          </button>`).join('')}
      </div>
      <input type="number" id="pdfedCoffeeCustomAmt" min="1" placeholder="Or enter a custom amount (₹)"
        style="padding:9px 10px;border-radius:8px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px;"
        oninput="pdfedCoffee.amount = parseInt(this.value,10) || pdfedCoffee.amount; pdfedSyncCoffeeAmtButtons();">
      <button id="pdfedCoffeePayBtn" onclick="pdfedStartCoffeeCheckout()"
        style="padding:11px 0;border-radius:8px;border:none;background:var(--blue);color:#fff;font-weight:700;font-size:14px;cursor:pointer;">
        Pay ₹${pdfedCoffee.amount}
      </button>
      <div id="pdfedCoffeeStatus" style="font-size:11px;color:var(--text2);text-align:center;min-height:14px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function pdfedSelectCoffeeAmount(v, btn) {
  pdfedCoffee.amount = v;
  document.getElementById('pdfedCoffeeCustomAmt').value = '';
  pdfedSyncCoffeeAmtButtons();
}

function pdfedSyncCoffeeAmtButtons() {
  document.querySelectorAll('.pdfed-coffee-amt-btn').forEach(b => {
    b.style.borderColor = (parseInt(b.dataset.amt, 10) === pdfedCoffee.amount) ? 'var(--blue)' : 'var(--border2)';
  });
  const payBtn = document.getElementById('pdfedCoffeePayBtn');
  if (payBtn) payBtn.textContent = `Pay ₹${pdfedCoffee.amount}`;
}

async function pdfedStartCoffeeCheckout() {
  const statusEl = document.getElementById('pdfedCoffeeStatus');
  const amount = Math.max(1, Math.round(pdfedCoffee.amount || 0));
  if (!amount) { if (statusEl) statusEl.textContent = 'Enter a valid amount.'; return; }
  if (statusEl) statusEl.textContent = 'Starting checkout…';

  try {
    // 1. Ask our backend proxy to create the order (it holds the Key Secret,
    //    never this page). We only ever send the amount — the proxy is what
    //    actually talks to Razorpay's Orders API.
    const orderRes = await fetch(`${RAZORPAY_PROXY_ENDPOINT}/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!orderRes.ok) throw new Error('order_create_failed');
    const order = await orderRes.json();

    // 2. Open Razorpay's own checkout widget with that order.
    const rzp = new Razorpay({
      key: RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.id,
      name: 'SARVARC Workspace',
      description: 'Support The Development Of SARVARC',
      theme: { color: '#0073E6' },
      handler: async function (response) {
        // 3. After payment, ask the proxy to verify the signature server-side
        //    before treating this as a successful, real payment.
        if (statusEl) statusEl.textContent = 'Verifying payment…';
        try {
          const verifyRes = await fetch(`${RAZORPAY_PROXY_ENDPOINT}/verify-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          });
          const verify = await verifyRes.json();
          if (verify && verify.verified) {
            const modal = document.getElementById('pdfedCoffeeModal');
            if (modal) modal.remove();
            pdfedShowCoffeeThankYouModal(amount);
          } else {
            if (statusEl) statusEl.textContent = 'Could not verify payment, please contact support.';
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = 'Could not verify payment, please contact support.';
        }
      },
      modal: {
        ondismiss: function () { if (statusEl) statusEl.textContent = ''; }
      }
    });
    rzp.on('payment.failed', function () {
      if (statusEl) statusEl.textContent = 'Payment failed or was cancelled.';
    });
    rzp.open();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Could not start checkout, please try again.';
  }
}

function pdfedShowCoffeeThankYouModal(amount) {
  const old = document.getElementById('pdfedCoffeeThanksModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'pdfedCoffeeThanksModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;animation:pdfedThanksFadeIn 0.25s ease;';
  modal.innerHTML = `
    <div style="position:relative;background:linear-gradient(160deg, var(--bg2) 0%, var(--bg2) 60%, rgba(0,194,255,0.07) 100%);border:1px solid var(--border2);border-radius:20px;padding:36px 32px 28px;max-width:380px;width:90%;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:pdfedThanksPop 0.4s cubic-bezier(.2,1.4,.4,1);">

      <div style="position:absolute;top:-40%;left:-20%;width:140%;height:140%;background:radial-gradient(circle at 30% 20%, rgba(0,194,255,0.14), transparent 55%), radial-gradient(circle at 75% 75%, rgba(139,92,246,0.14), transparent 55%);pointer-events:none;"></div>

      <button onclick="document.getElementById('pdfedCoffeeThanksModal').remove()" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1;z-index:2;">×</button>

      <div style="position:relative;width:150px;height:128px;z-index:1;">
        <svg viewBox="0 0 160 140" width="150" height="128" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pdfedMascotGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:var(--cyan)" />
              <stop offset="100%" style="stop-color:var(--purple)" />
            </linearGradient>
          </defs>
          <path d="M45 140 Q45 68 80 68 Q115 68 115 140 Z" fill="url(#pdfedMascotGrad)" opacity="0.92"/>
          <g class="pdfed-mascot-head" style="transform-origin:80px 60px;">
            <circle cx="80" cy="38" r="22" fill="url(#pdfedMascotGrad)"/>
            <circle cx="72" cy="36" r="2.6" fill="#fff"/>
            <circle cx="88" cy="36" r="2.6" fill="#fff"/>
            <path d="M70 46 Q80 53 90 46" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          </g>
          <g class="pdfed-arm-wave" style="transform-origin:52px 82px;">
            <path d="M52 82 Q35 78 28 55" stroke="url(#pdfedMascotGrad)" stroke-width="12" stroke-linecap="round" fill="none"/>
            <circle cx="28" cy="55" r="8" fill="url(#pdfedMascotGrad)"/>
          </g>
          <g class="pdfed-arm-cup" style="transform-origin:108px 84px;">
            <path d="M108 84 Q122 90 118 68" stroke="url(#pdfedMascotGrad)" stroke-width="12" stroke-linecap="round" fill="none"/>
            <g transform="translate(108,55)">
              <path d="M-9 0 L-7 14 Q-7 18 -3 18 L3 18 Q7 18 7 14 L9 0 Z" fill="#fff"/>
              <path d="M9 3 Q16 3 16 9 Q16 14 9 13" fill="none" stroke="#fff" stroke-width="2"/>
              <line class="pdfed-steam pdfed-steam-1" x1="-3" y1="-3" x2="-3" y2="-9" stroke="var(--cyan)" stroke-width="1.6" stroke-linecap="round"/>
              <line class="pdfed-steam pdfed-steam-2" x1="3" y1="-3" x2="3" y2="-9" stroke="var(--purple)" stroke-width="1.6" stroke-linecap="round"/>
            </g>
          </g>
        </svg>
      </div>

      <div style="position:relative;z-index:1;margin-top:2px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--cyan);text-transform:uppercase;">SARVARC</div>
      <h3 style="position:relative;z-index:1;font-size:19px;font-weight:800;margin-top:2px;">Supporting The Development Of SARVARC 💙</h3>
      <div style="position:relative;z-index:1;font-size:13px;color:var(--text2);line-height:1.5;max-width:290px;">
        Your support of <strong style="color:var(--text);">₹${amount}</strong> genuinely helps keep SARVARC Workspace alive and growing. It means a lot.
      </div>

      <div style="position:relative;z-index:1;display:flex;align-items:center;gap:6px;margin-top:16px;padding:8px 14px;border-radius:999px;background:rgba(0,194,255,0.08);border:1px solid rgba(0,194,255,0.2);font-size:11.5px;color:var(--cyan);font-weight:600;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Payment verified & secured
      </div>

      <button onclick="document.getElementById('pdfedCoffeeThanksModal').remove()" style="position:relative;z-index:1;margin-top:20px;width:100%;padding:12px 0;border-radius:10px;border:none;background:linear-gradient(90deg, var(--blue), var(--purple));color:#fff;font-weight:700;font-size:14px;cursor:pointer;">
        You're welcome 💙
      </button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  if (!document.getElementById('pdfedThanksModalStyles')) {
    const style = document.createElement('style');
    style.id = 'pdfedThanksModalStyles';
    style.textContent = `
      @keyframes pdfedThanksFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes pdfedThanksPop { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes pdfedSteamRise { 0% { opacity: 0; transform: translateY(0) scaleY(1); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px) scaleY(1.4); } }
      .pdfed-steam { transform-origin: bottom; animation: pdfedSteamRise 1.8s ease-in-out infinite; }
      .pdfed-steam-1 { animation-delay: 0s; }
      .pdfed-steam-2 { animation-delay: 0.3s; }
      .pdfed-steam-3 { animation-delay: 0.6s; }

      /* Mascot: sips coffee twice, then waves thanks, on a 4s loop */
      @keyframes pdfedMascotSip {
        0%   { transform: rotate(0deg) translate(0,0); }
        10%  { transform: rotate(-25deg) translate(-4px,-6px); }
        20%  { transform: rotate(0deg) translate(0,0); }
        30%  { transform: rotate(-25deg) translate(-4px,-6px); }
        40%, 100% { transform: rotate(0deg) translate(0,0); }
      }
      @keyframes pdfedMascotWave {
        0%, 45% { transform: rotate(0deg); }
        52% { transform: rotate(-18deg); }
        60% { transform: rotate(14deg); }
        68% { transform: rotate(-16deg); }
        76% { transform: rotate(12deg); }
        84%, 100% { transform: rotate(0deg); }
      }
      @keyframes pdfedMascotNod {
        0%, 45% { transform: rotate(0deg); }
        55% { transform: rotate(-4deg); }
        65% { transform: rotate(4deg); }
        75% { transform: rotate(-3deg); }
        85%, 100% { transform: rotate(0deg); }
      }
      .pdfed-arm-cup { animation: pdfedMascotSip 4s ease-in-out infinite; }
      .pdfed-arm-wave { animation: pdfedMascotWave 4s ease-in-out infinite; }
      .pdfed-mascot-head { animation: pdfedMascotNod 4s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    const m = document.getElementById('pdfedCoffeeThanksModal');
    if (m) m.remove();
  }, 9000);
}


// SECURITY NOTE: this file is static client-side HTML/JS that ships to every
// visitor's browser. A real Pexels API key must NEVER be hardcoded here —
// anyone could open dev tools / view-source, copy it, and burn your quota or
// get it revoked. Instead this calls a same-origin backend endpoint
// (PDFED_STOCK_PROXY_ENDPOINT) that you host yourself; that tiny backend
// holds the real key server-side and forwards the request to Pexels. A
// ready-to-deploy proxy (Cloudflare Worker) is provided separately — see
// stock-photo-proxy-worker.js. Swap the endpoint below to match your deployment.
const PDFED_STOCK_PROXY_ENDPOINT = 'https://sarvarc-stock-proxy.sarvarcworkspace.workers.dev'; // -> forwards to https://api.pexels.com/v1/search

const pdfedStock = { query: '', page: 1, loading: false, debounceTimer: null };

// Minimal HTML-escaping so photographer names / alt text from the API
// response can never inject markup or scripts into the page.
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function pdfedOpenStockPhotoSearch() {
  if (pdfed.active < 0) { toast('Open a PDF page first', 'error'); return; }
  pdfedShowStockPhotoModal();
}

function pdfedShowStockPhotoModal() {
  const old = document.getElementById('pdfedStockModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'pdfedStockModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:24px;max-width:640px;width:90%;max-height:82vh;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="font-size:16px;font-weight:700;">Search Stock Photos</h3>
        <button onclick="document.getElementById('pdfedStockModal').remove()" style="background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>
      <input type="text" id="pdfedStockSearchInput" placeholder="e.g. office team, coffee shop, warehouse…"
        style="padding:10px 12px;border-radius:8px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px;"
        oninput="pdfedStockDebouncedSearch(this.value)">
      <div id="pdfedStockStatus" style="font-size:11.5px;color:var(--text2);min-height:14px;"></div>
      <div id="pdfedStockGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;overflow-y:auto;flex:1;min-height:120px;"></div>
      <div style="font-size:10.5px;color:var(--text3);text-align:center;">Photos provided by Pexels</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('pdfedStockSearchInput').focus();
}

function pdfedStockDebouncedSearch(query) {
  clearTimeout(pdfedStock.debounceTimer);
  pdfedStock.debounceTimer = setTimeout(() => pdfedStockSearch(query, 1), 400);
}

async function pdfedStockSearch(query, page) {
  query = (query || '').trim();
  const statusEl = document.getElementById('pdfedStockStatus');
  const gridEl = document.getElementById('pdfedStockGrid');
  if (!query) { if (gridEl) gridEl.innerHTML = ''; if (statusEl) statusEl.textContent = ''; return; }
  if (pdfedStock.loading) return; // prevent overlapping/spammed requests
  pdfedStock.loading = true;
  pdfedStock.query = query;
  pdfedStock.page = page;
  if (statusEl) statusEl.textContent = 'Searching…';

  try {
    const url = `${PDFED_STOCK_PROXY_ENDPOINT}?query=${encodeURIComponent(query)}&page=${encodeURIComponent(page)}&per_page=24`;
    const res = await fetch(url);
    if (res.status === 429) { if (statusEl) statusEl.textContent = 'Rate limited, try again in a moment.'; return; }
    if (res.status === 401 || res.status === 403) { if (statusEl) statusEl.textContent = 'Stock photo search is not configured yet.'; return; }
    if (!res.ok) { if (statusEl) statusEl.textContent = 'Search failed, please try again.'; return; }
    const data = await res.json();
    const photos = Array.isArray(data.photos) ? data.photos : [];
    if (statusEl) statusEl.textContent = photos.length ? '' : 'No results found.';
    pdfedRenderStockResults(photos);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Network error, please try again.';
  } finally {
    pdfedStock.loading = false;
  }
}

function pdfedRenderStockResults(photos) {
  const gridEl = document.getElementById('pdfedStockGrid');
  if (!gridEl) return;
  gridEl.innerHTML = photos.map((p, i) => {
    // All API-sourced text is escaped before insertion — never trust remote strings in innerHTML.
    const thumb = escapeHtml(p?.src?.medium || p?.src?.small || '');
    const alt = escapeHtml(p?.alt || p?.photographer || 'Stock photo');
    const photographer = escapeHtml(p?.photographer || '');
    if (!thumb) return '';
    return `
      <div class="pdfed-stock-thumb" data-idx="${i}" onclick="pdfedPickStockPhoto(${i})"
        style="border:2px solid var(--border);border-radius:8px;overflow:hidden;cursor:pointer;transition:border 0.15s;position:relative;"
        onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'">
        <img src="${thumb}" alt="${alt}" loading="lazy" style="width:100%;height:90px;object-fit:cover;display:block;">
        <div style="font-size:8.5px;padding:3px 5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${photographer}</div>
      </div>`;
  }).join('');
  pdfedStock.results = photos; // cache full objects (with large/original URLs) for the click handler
}

async function pdfedPickStockPhoto(idx) {
  const photo = pdfedStock.results && pdfedStock.results[idx];
  if (!photo) return;
  const statusEl = document.getElementById('pdfedStockStatus');
  if (statusEl) statusEl.textContent = 'Loading image…';
  try {
    // Fetch the actual image bytes and convert to a data URL up front (rather
    // than pointing the canvas at a remote URL) so later canvas export
    // (toDataURL) never fails on a cross-origin-tainted canvas.
    const large = photo?.src?.large2x || photo?.src?.large || photo?.src?.original;
    const imgRes = await fetch(large);
    if (!imgRes.ok) throw new Error('image fetch failed');
    const blob = await imgRes.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const modal = document.getElementById('pdfedStockModal');
    if (modal) modal.remove();
    pdfedActivateImgGhost(dataUrl);
    toast(`Photo by ${photo.photographer || 'photographer'} via Pexels`, 'info');
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Could not load that image, try another.';
  }
}

async function pdfedLoadInsertImage(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const dataUrl = ev.target.result;
    // Auto-store in the Assets library (right panel) so this image can be
    // reused on other pages/documents without re-uploading the file.
    if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('image', dataUrl, file.name);
    if (pdfed.active < 0 || !pdfed.pages[pdfed.active]) {
      // No document open — open the image directly as a page at its own
      // real pixel dimensions, instead of forcing it onto a blank A4 sheet.
      await pdfedOpenImageAsPage(dataUrl, file);
    } else {
      // A page is already open — keep placing images as a draggable/resizable
      // overlay on top of it, same as before.
      pdfedActivateImgGhost(dataUrl);
    }
  };
  reader.readAsDataURL(file);
}

// Opens an image file as a new page sized to the image's own pixel
// dimensions (mapped at 96dpi, same assumption pdfedRenderBlankPage/export
// use) — the page IS the photo at its real size, not a shrunken overlay
// dropped onto an unrelated A4 canvas. If a document is already open, the
// page is appended after the current one instead of replacing everything.
async function pdfedOpenImageAsPage(dataUrl, file) {
  const PXMM = 3.7795;
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl; });
  const w = img.naturalWidth || 1000, h = img.naturalHeight || 1400;
  const mmW = w / PXMM, mmH = h / PXMM;

  // Bake the image at native resolution — no scaling, no letterboxing —
  // so it comes out exactly the size and aspect ratio of the source file.
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const pageUrl = c.toDataURL('image/png');

  // The page itself is a blank white sheet the same size as the photo — the
  // photo is placed on top of it as a normal, full-bleed placed image rather
  // than flattened straight into the page background. That's what gives it
  // move/resize/lock/opacity/arrange/delete AND Reshape controls, same as
  // any other image you drop onto a page, instead of it becoming a fixed,
  // uneditable backdrop the moment it's the very first/only image uploaded.
  const bg = document.createElement('canvas');
  bg.width = w; bg.height = h;
  bg.getContext('2d').fillStyle = '#ffffff';
  bg.getContext('2d').fillRect(0, 0, w, h);
  const blankUrl = bg.toDataURL('image/png');

  const label = (file && file.name) ? file.name.replace(/\.[^.]+$/, '') : 'Image Page';
  const pg = {
    type: 'image', dataUrl: blankUrl, modified: false, edits: {},
    textBlocks: [], placedTexts: [],
    placedImages: [{
      id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
      dataUrl: pageUrl, x: 0, y: 0, w, h,
      locked: false, zIndex: 1
    }],
    placedTables: [],
    label, sourceFormat: (file && file.type) || 'image/png', pageMM: [mmW, mmH]
  };

  const isNewDoc = !pdfed.pages || pdfed.pages.length === 0;
  if (isNewDoc) pdfed.pages = [pg];
  else pdfed.pages.splice(pdfed.active + 1, 0, pg);
  const newIdx = isNewDoc ? 0 : pdfed.active + 1;

  if (isNewDoc) {
    pdfed.pdfDoc = null;
    pdfed.file = { name: label || 'Untitled Document' };
    ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
    const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
    const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
    if (state && state.stats) { state.stats.pdfs++; }
  }
  if (state && state.stats) { state.stats.pages++; }
  if (typeof updateStats === 'function') updateStats();
  if (typeof navigate === 'function') navigate('pdfeditor');
  if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
  if (typeof pdfedGoto === 'function') await pdfedGoto(newIdx);
  pdfedRenderPlacedImages(newIdx);
  setTimeout(() => { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 120);
  toast('Image opened at its original size', 'success');
}

function pdfedActivateImgGhost(dataUrl, kind) {
  const pc = document.getElementById('pdfedPageCanvas');
  const ghost = document.getElementById('pdfedImgGhost');
  const ghostImg = document.getElementById('pdfedImgGhostImg');

  // Everything below is stored/positioned in RAW canvas-px (unscaled by zoom) —
  // exactly the same coordinate system used by already-stamped placed images
  // (see pdfedPositionPlacedEl). The ghost now lives inside #pdfedPlacedZoomWrap,
  // which carries the single CSS transform:scale(zoom) that the whole wrapper
  // shares, so the ghost automatically tracks zoom in/out with zero drift or
  // resizing, instead of being positioned in screen-px like before.

  // Default size: fit inside a 35%-of-page-width × 35%-of-page-height box,
  // preserving the IMAGE'S OWN aspect ratio (not forced square). Bounding
  // BOTH dimensions (not just width) matters for wide/short sources like
  // Mermaid flowcharts — those used to get a width-only 35% box with the
  // height falling straight out of the aspect ratio, which for a wide
  // flowchart could collapse to a few px tall and look like nothing had
  // been pushed at all. minGhostSize guarantees it's always big enough to
  // see and grab, even for extreme aspect ratios.
  const boxW = Math.round((pc.width || 1000) * 0.35);
  const boxH = Math.round((pc.height || 1400) * 0.35);
  const minGhostSize = 90;
  let defaultW = boxW;
  let defaultH = boxW;

  // Center every newly inserted image on the page instead of dropping it
  // near a corner. Corner placement (the previous fix's 40,40-based
  // cascade) still put new images in the same region as whatever existing
  // image already lived in that corner — e.g. a full-bleed background photo
  // that already covers (0,0) — so the new image visually "underlapped"
  // the existing one and stayed invisible until the user dragged the old
  // image out of the way. Centering guarantees the new image lands in open,
  // predictable space in the middle of the page, so it's the first thing
  // the eye catches the moment it's inserted, on top of everything (highest
  // zIndex is set in pdfedBakeImage). A small cascade offset is still added
  // per already-placed image so a 2nd/3rd image dropped without moving the
  // first isn't stacked pixel-for-pixel on top of it either — it stays
  // near-center but visibly nudged, wrapping back around after a few steps
  // and always clamped to the page so it can never end up off-canvas.
  const pg = pdfed.pages && pdfed.pages[pdfed.active];
  const existingCount = (pg && pg.placedImages) ? pg.placedImages.length : 0;
  const cascadeStep = 26;
  const maxCascadeSlots = 6; // wrap back to dead-center after this many
  const cascadeOffset = (existingCount % maxCascadeSlots) * cascadeStep;
  const pageW = pc.width || 1000, pageH = pc.height || 1400;
  const centerX = Math.round((pageW - defaultW) / 2) + cascadeOffset;
  const centerY = Math.round((pageH - defaultH) / 2) + cascadeOffset;
  const startX = Math.max(20, Math.min(centerX, pageW - defaultW - 20));
  const startY = Math.max(20, Math.min(centerY, pageH - defaultH - 20));

  const applyGhostRect = () => {
    const it = pdfedAnnotState.imgInsert;
    ghost.style.left = it.x + 'px';
    ghost.style.top = it.y + 'px';
    ghost.style.width = it.w + 'px';
    ghost.style.height = it.h + 'px';
  };

  pdfedAnnotState.imgInsertActive = true;
  // `kind` (e.g. 'map', 'chart', 'logo') rides along on the in-progress ghost
  // so pdfedBakeImage can stamp it onto the placedImage record once dropped —
  // that's what lets Refine Report tell a pushed map apart from a logo or an
  // ordinary photo later on.
  pdfedAnnotState.imgInsert = { dataUrl, x: startX, y: startY, w: defaultW, h: defaultH, kind };

  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalWidth && probe.naturalHeight) {
      const ar = probe.naturalWidth / probe.naturalHeight;
      let w = boxW, h = Math.round(boxW / ar);
      if (h > boxH) { h = boxH; w = Math.round(boxH * ar); }
      w = Math.max(w, minGhostSize);
      h = Math.max(h, minGhostSize);
      // Re-center on the same point the width-only default was centered on,
      // so fixing the size doesn't also shove the box off to one side.
      const it = pdfedAnnotState.imgInsert;
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      it.w = w; it.h = h;
      it.x = Math.max(20, Math.min(cx - w / 2, pageW - w - 20));
      it.y = Math.max(20, Math.min(cy - h / 2, pageH - h - 20));
      applyGhostRect();
    }
  };
  probe.src = dataUrl;

  applyGhostRect();
  ghost.style.display = 'block';
  // Belt-and-suspenders: keep the ghost above every already-stamped image
  // (which carry their own explicit, positive z-index) no matter what — this
  // is what was causing a new image-in-progress to render invisibly UNDER
  // existing images until "Stamp" was clicked.
  ghost.style.zIndex = '99999';
  ghostImg.src = dataUrl;

  // Drag to move / resize, mouse deltas are in screen-px, so they're divided
  // by the current zoom level to convert them into the same raw canvas-px
  // space that x/y/w/h are stored in (identical approach to
  // pdfedAttachPlacedDragHandlers, which already gets this right for
  // already-stamped images).
  // NOTE: bound only ONCE per page-load (guarded below), not once per image
  // upload, the ghost element is reused across uploads, so re-adding these
  // listeners every time used to stack duplicate handlers on top of each
  // other, which fought over the same drag and made the box appear to jump
  // or resize erratically after the first image.
  if (!ghost.dataset.dragBound) {
    ghost.dataset.dragBound = '1';
    let dragging = false, resizing = false, resizeDir = null;
    let ox = 0, oy = 0, startRect = null;

    ghost.addEventListener('mousedown', function(e) {
      const it = pdfedAnnotState.imgInsert;
      if (!it) return;
      const handle = e.target.closest && e.target.closest('.pdfed-img-resize-handle');
      if (handle && ghost.contains(handle)) {
        resizing = true; resizeDir = handle.dataset.dir;
        ox = e.clientX; oy = e.clientY;
        startRect = { x: it.x, y: it.y, w: it.w, h: it.h };
      } else {
        dragging = true;
        ox = e.clientX; oy = e.clientY;
      }
      e.stopPropagation(); e.preventDefault();
    });

    document.addEventListener('mousemove', function onGhostMove(e) {
      if (!dragging && !resizing) return;
      const it = pdfedAnnotState.imgInsert;
      if (!it) return;
      const pc2 = document.getElementById('pdfedPageCanvas');
      const pcRect = pc2.getBoundingClientRect();
      const scale = pc2.width / pcRect.width; // 1 / current zoom
      if (dragging) {
        it.x = Math.max(0, it.x + (e.clientX - ox) * scale);
        it.y = Math.max(0, it.y + (e.clientY - oy) * scale);
        ox = e.clientX; oy = e.clientY;
        applyGhostRect();
      } else if (resizing) {
        // Edge-to-edge free resize: any of the 8 handles can be dragged, and
        // the OPPOSITE edge/corner stays anchored in place, same feel as
        // Canva/PowerPoint. Hold Shift to keep the image's aspect ratio.
        const dx = (e.clientX - ox) * scale, dy = (e.clientY - oy) * scale;
        const r = pdfedResizeRect(resizeDir, startRect, dx, dy, 40, e.shiftKey);
        it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h;
        applyGhostRect();
      }
    });
    document.addEventListener('mouseup', function onGhostUp() {
      dragging = false; resizing = false; resizeDir = null; startRect = null;
    });
  }

  toast('Drag to position · resize from any edge or corner (hold Shift to keep proportions) · click Stamp to bake', 'info');
}

async function pdfedBakeImage() {
  const ghostImg = document.getElementById('pdfedImgGhostImg');
  const it = pdfedAnnotState.imgInsert;
  if (!it) return;

  // x/y/w/h are already in raw canvas-px, no conversion needed, since the
  // ghost was positioned/dragged/resized directly in that coordinate space.
  const { x, y, w, h } = it;

  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg.placedImages) pg.placedImages = [];
  pg.placedImages.push({
    id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
    dataUrl: ghostImg.src,
    x, y, w, h,
    locked: false,
    zIndex: pdfedNextZ(pg),
    kind: it.kind || 'image'
  });
  pdfedMarkModified(idx);
  pdfedRenderPlacedImages(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Image placed, drag to position, then lock it in place', 'success');

  pdfedCancelImgInsert();
}

function pdfedCancelImgInsert() {
  document.getElementById('pdfedImgGhost').style.display = 'none';
  pdfedAnnotState.imgInsertActive = false;
}

// Safety net: if the user dragged/resized an image but forgot to click "Stamp"
// before switching pages or exporting, this commits it automatically instead
// of silently discarding it (which was the cause of "added image disappears").
function pdfedAutoStampPendingGhost() {
  if (!pdfedAnnotState.imgInsertActive) return;
  const ghost = document.getElementById('pdfedImgGhost');
  if (!ghost || ghost.style.display === 'none') return;
  pdfedBakeImage();
}
