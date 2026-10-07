// ─── FILE HANDLING ───
function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('dragover'); }
function handleDragLeave() { document.getElementById('uploadZone').classList.remove('dragover'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if(file) processFile(file);
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if(file) processFile(file);
}

async function processFile(file) {
  const allowed = ['application/pdf','image/png','image/jpeg','image/webp'];
  if(!allowed.includes(file.type) && !file.name.endsWith('.pdf')) {
    toast('Unsupported file type', 'error'); return;
  }
  state.pdfFile = file;
  toast(file.name + ' loaded', 'success');
  document.getElementById('uploadZone').classList.add('scanning');
  // Show loaded file banner
  const banner = document.getElementById('extractLoadedBanner');
  document.getElementById('extractLoadedName').textContent = file.name;
  banner.style.display = 'flex';
  setPreviewPanelUploaded(file.name);

  if(file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    await loadPDF(file);
  } else {
    // direct image
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.extractedImages = [];
      addImage(ev.target.result, file.name, 0);
      renderGallery();
      collapseUploadArea();
      setTimeout(() => {
        document.getElementById('galleryWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    };
    reader.readAsDataURL(file);
  }

  setTimeout(() => document.getElementById('uploadZone').classList.remove('scanning'), 2000);
}

async function loadPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    state.pdfDoc = await sarvarcOpenPdfDocument(arrayBuffer);
    state.stats.pdfs++;
    state.stats.pages += state.pdfDoc.numPages;
    updateStats();
    toast('PDF loaded, ' + state.pdfDoc.numPages + ' pages', 'success');
    await renderPageThumbs();
    // Straight to results — no "Extract All" click required, every image is
    // just there the moment the file is ready.
    await instantExtract();
  } catch(e) {
    if (e && e.message === 'Password entry cancelled') { toast('Unlock cancelled', 'info'); return; }
    toast('Failed to load PDF: ' + e.message, 'error');
  }
}

// Renders each PDF page to a dataUrl for internal use (Cinema fullscreen
// preview, the live preview panel) — no longer builds a visible thumbnail
// strip in the page, since the gallery right below already shows every page
// larger, labeled, and ready to act on. Rendering the same thing twice was
// just noise.
async function renderPageThumbs() {
  if(!state.pdfDoc) return;
  state.previewPages = [];
  for(let i = 1; i <= state.pdfDoc.numPages; i++) {
    const page = await state.pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const dataUrl = canvas.toDataURL();
    state.previewPages.push({ dataUrl, label: 'Page ' + i });
  }
  showDirectPreview();
  setupCinemaPreview(state.pdfFile && state.pdfFile.name);
}

// ── DIRECT PREVIEW (shows the uploaded file's pages immediately, before extraction) ──
function showDirectPreview() {
  const empty = document.getElementById('previewEmpty');
  const grid  = document.getElementById('previewGrid');
  const title = document.getElementById('previewPanelTitle');
  if (!empty || !grid || !title || state.previewPages.length === 0) return;

  grid.innerHTML = '';
  state.previewPages.forEach((p) => {
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.title = p.label;
    thumb.innerHTML = `<img src="${p.dataUrl}" alt="${p.label}" loading="lazy">`;
    grid.appendChild(thumb);
  });

  empty.style.display = 'none';
  grid.style.display  = 'grid';
  title.className = 'preview-panel-title live';
  title.innerHTML = `<span class="dot"></span> ${state.previewPages.length} page${state.previewPages.length !== 1 ? 's' : ''} previewed, click Extract to pull images`;
}

// ─── CINEMA FULLSCREEN PAGE PREVIEW (side-by-side pairs, subtle fade, auto-advance) ───
// Builds the pairs and wires up the "Fullscreen Preview" button, but no longer
// auto-launches on upload — extraction is instant now, so the gallery is the
// thing the user should land on, not a slideshow blocking it. Cinema mode is
// still available on demand via the button.
function setupCinemaPreview(fileName) {
  if (!state.pdfDoc || state.previewPages.length === 0) return;
  const total = state.previewPages.length;
  const pairs = [];
  for (let i = 1; i <= total; i += 2) {
    pairs.push(i + 1 <= total ? [i, i + 1] : [i]);
  }
  state.cinema.pairs = pairs;
  state.cinema.pairIndex = 0;
  state.cinema.hiRes = {};
  state.cinema.fileName = fileName || 'Document Preview';

  const btn = document.getElementById('cinemaOpenBtn');
  if (btn) btn.style.display = 'flex';
}

async function ensureCinemaHiRes(pageNum) {
  if (state.cinema.hiRes[pageNum]) return state.cinema.hiRes[pageNum];
  const page = await state.pdfDoc.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1 });
  // Target a crisp, large render while keeping memory sane for long documents
  const targetLongEdge = 2000;
  const longEdge = Math.max(baseVp.width, baseVp.height);
  const scale = Math.min(3, Math.max(1.8, targetLongEdge / longEdge));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  const url = canvas.toDataURL('image/png');
  state.cinema.hiRes[pageNum] = url;
  return url;
}

function cinemaBuildProgressDots() {
  const wrap = document.getElementById('cinemaProgress');
  if (!wrap) return;
  wrap.innerHTML = '';
  state.cinema.pairs.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = 'cinema-dot' + (idx === state.cinema.pairIndex ? ' active' : '');
    dot.onclick = () => cinemaGoTo(idx);
    wrap.appendChild(dot);
  });
}

function cinemaUpdatePlayIcon() {
  const icon = document.getElementById('cinemaPlayIcon');
  if (!icon) return;
  icon.innerHTML = state.cinema.playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

async function cinemaRenderStage(pairIndex) {
  const stage = document.getElementById('cinemaStage');
  const loading = document.getElementById('cinemaLoading');
  const counter = document.getElementById('cinemaCounter');
  const nameEl = document.getElementById('cinemaFileName');
  const subEl = document.getElementById('cinemaSubtitle');
  if (!stage) return;
  const pair = state.cinema.pairs[pairIndex];
  if (!pair) return;

  // Subtle fade out
  stage.classList.remove('visible');
  loading.style.display = 'flex';

  const urls = await Promise.all(pair.map(p => ensureCinemaHiRes(p)));

  stage.innerHTML = urls.map((url, i) => `
    <div class="cinema-page-slot">
      <img src="${url}" alt="Page ${pair[i]}">
      <div class="cinema-page-label">Page ${pair[i]}</div>
    </div>
  `).join('');

  loading.style.display = 'none';
  nameEl.textContent = state.cinema.fileName;
  const total = state.previewPages.length;
  subEl.textContent = total + ' page' + (total !== 1 ? 's' : '') + ' \u00b7 rendered at full quality';
  counter.textContent = pair.length === 2
    ? `Pages ${pair[0]}\u2013${pair[1]} of ${total}`
    : `Page ${pair[0]} of ${total}`;

  // Preload the next pair quietly so the next fade is instant
  const nextPair = state.cinema.pairs[pairIndex + 1];
  if (nextPair) nextPair.forEach(p => ensureCinemaHiRes(p));

  // Subtle fade in
  requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('visible')));

  cinemaBuildProgressDots();
}

function cinemaScheduleAutoAdvance() {
  clearTimeout(state.cinema.timer);
  if (!state.cinema.playing) return;
  state.cinema.timer = setTimeout(() => {
    if (state.cinema.pairIndex < state.cinema.pairs.length - 1) {
      cinemaNext();
    } else {
      state.cinema.playing = false;
      cinemaUpdatePlayIcon();
    }
  }, 3400);
}

async function openCinemaPreview() {
  if (!state.cinema.pairs.length) return;
  const overlay = document.getElementById('cinemaOverlay');
  overlay.classList.add('active');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  state.cinema.playing = true;
  cinemaUpdatePlayIcon();
  await cinemaRenderStage(state.cinema.pairIndex);
  cinemaScheduleAutoAdvance();
  document.addEventListener('keydown', cinemaKeyHandler);
}

function closeCinemaPreview() {
  const overlay = document.getElementById('cinemaOverlay');
  clearTimeout(state.cinema.timer);
  state.cinema.playing = false;
  overlay.classList.remove('visible');
  setTimeout(() => overlay.classList.remove('active'), 350);
  document.removeEventListener('keydown', cinemaKeyHandler);
}

async function cinemaGoTo(idx) {
  if (idx < 0 || idx >= state.cinema.pairs.length) return;
  state.cinema.pairIndex = idx;
  await cinemaRenderStage(idx);
  cinemaScheduleAutoAdvance();
}

function cinemaNext() { cinemaGoTo(Math.min(state.cinema.pairIndex + 1, state.cinema.pairs.length - 1)); }
function cinemaPrev() { cinemaGoTo(Math.max(state.cinema.pairIndex - 1, 0)); }

function cinemaTogglePlay() {
  state.cinema.playing = !state.cinema.playing;
  cinemaUpdatePlayIcon();
  if (state.cinema.playing) {
    // If review had reached the end, restart from the top on resume
    if (state.cinema.pairIndex >= state.cinema.pairs.length - 1) {
      cinemaGoTo(0);
    } else {
      cinemaScheduleAutoAdvance();
    }
  } else {
    clearTimeout(state.cinema.timer);
  }
}

function cinemaKeyHandler(e) {
  const overlay = document.getElementById('cinemaOverlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  if (e.key === 'Escape') closeCinemaPreview();
  else if (e.key === 'ArrowRight') { state.cinema.playing = false; cinemaUpdatePlayIcon(); clearTimeout(state.cinema.timer); cinemaNext(); }
  else if (e.key === 'ArrowLeft') { state.cinema.playing = false; cinemaUpdatePlayIcon(); clearTimeout(state.cinema.timer); cinemaPrev(); }
  else if (e.key === ' ') { e.preventDefault(); cinemaTogglePlay(); }
}

// ─── INSTANT EXTRACTION ───
// Runs the moment a PDF finishes loading (and again if the user switches
// extract mode) — no button to click, no artificial step-by-step delay.
// Every image is just there the instant the file is ready, so the user goes
// straight to picking what they want instead of waiting on a "process" step.
async function instantExtract() {
  if(!state.pdfDoc) return;
  state.extractedImages = [];
  state.selectedImages.clear();
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('galleryWrap').style.display = 'none';

  await extractPageImages();

  state.stats.imgs += state.extractedImages.length;
  updateStats();

  if(state.extractedImages.length === 0) {
    document.getElementById('emptyState').style.display = 'block';
    toast('No images found in this PDF', 'info');
  } else {
    renderGallery();
    toast(state.extractedImages.length + ' image' + (state.extractedImages.length !== 1 ? 's' : '') + ' ready — hover any image to extract it', 'success');
    const badge = document.getElementById('imgCountBadge');
    badge.style.display = 'inline-block';
    badge.textContent = state.extractedImages.length;
    // Declutter: tuck away the upload UI so results sit right in view, no scrolling needed
    collapseUploadArea();
    setTimeout(() => {
      document.getElementById('galleryWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }
}

// Kept as an alias so anything still calling the old name keeps working.
async function startProcessing() { await instantExtract(); }

// ─── COLLAPSE/EXPAND UPLOAD AREA (keeps results in view, no extra scrolling) ───
function collapseUploadArea() {
  document.querySelector('.extract-split').classList.add('is-collapsed');
  document.getElementById('pipeline').classList.add('is-collapsed');
  const btn = document.getElementById('toggleUploadAreaBtn');
  if(btn) btn.innerHTML = '<span class="btn-icon-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> Upload Another</span>';
}

function expandUploadArea() {
  document.querySelector('.extract-split').classList.remove('is-collapsed');
  document.getElementById('pipeline').classList.remove('is-collapsed');
  const btn = document.getElementById('toggleUploadAreaBtn');
  if(btn) btn.innerHTML = '<span class="btn-icon-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Close</span>';
  document.querySelector('.extract-split').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleUploadArea() {
  const split = document.querySelector('.extract-split');
  if(split.classList.contains('is-collapsed')) expandUploadArea();
  else collapseUploadArea();
}

async function extractPageImages() {
  const scale = 2.0;
  for(let p = 1; p <= state.pdfDoc.numPages; p++) {
    const page = await state.pdfDoc.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    addImage(dataUrl, 'page-' + p + '.png', p, vp.width, vp.height);
  }
}

function addImage(dataUrl, name, page, w, h) {
  state.extractedImages.push({ dataUrl, name, page, width: w || 0, height: h || 0 });
}

// ── LIVE PREVIEW PANEL ────────────────────────────────────────────────
function updatePreviewPanel() {
  const empty = document.getElementById('previewEmpty');
  const grid  = document.getElementById('previewGrid');
  const title = document.getElementById('previewPanelTitle');
  const imgs  = state.extractedImages;

  if (!empty || !grid || !title) return;

  if (imgs.length === 0) {
    empty.style.display = 'flex';
    grid.style.display  = 'none';
    title.className = 'preview-panel-title';
    title.innerHTML = '<span class="dot"></span> Waiting for file';
    return;
  }

  // Build thumbnail grid
  grid.innerHTML = '';
  imgs.forEach((img, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.title = img.name;
    thumb.innerHTML = `<img src="${img.dataUrl}" alt="${img.name}" loading="lazy">`;
    thumb.onclick = () => { openPreview(idx); };
    grid.appendChild(thumb);
  });

  empty.style.display = 'none';
  grid.style.display  = 'grid';
  title.className = 'preview-panel-title live';
  title.innerHTML = `<span class="dot"></span> ${imgs.length} image${imgs.length !== 1 ? 's' : ''} ready, click to preview`;
}

function setPreviewPanelUploaded(filename) {
  const title = document.getElementById('previewPanelTitle');
  if (!title) return;
  title.className = 'preview-panel-title';
  title.innerHTML = `<span class="dot" style="background:var(--blue);box-shadow:0 0 6px rgba(0,194,255,0.5)"></span> Loaded: ${filename.length > 28 ? filename.slice(0,28)+'…' : filename}`;
}

// Bakes a gallery image's chosen opacity into real alpha data, used at every
// actual output point (download, zip, Export Center, push-to-Workspace) so a
// faded thumbnail isn't just a CSS preview; the file people actually get
// matches what they saw. Returns the original dataUrl untouched when fully
// opaque, so the common case costs nothing extra.
async function pdfedApplyOpacityToDataUrl(dataUrl, opacity) {
  if (opacity == null || opacity >= 0.999) return dataUrl;
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const can = document.createElement('canvas');
      can.width = im.naturalWidth; can.height = im.naturalHeight;
      const ctx = can.getContext('2d');
      ctx.globalAlpha = opacity;
      ctx.drawImage(im, 0, 0);
      resolve(can.toDataURL('image/png'));
    };
    im.onerror = () => resolve(dataUrl); // if it fails to decode, ship the original rather than nothing
    im.src = dataUrl;
  });
}

function renderGallery() {
  const grid = document.getElementById('imageGrid');
  grid.innerHTML = '';
  document.getElementById('galleryWrap').style.display = 'block';
  document.getElementById('galleryTitle').textContent = 'Extracted Images (' + state.extractedImages.length + ')';
  document.getElementById('emptyState').style.display = 'none';

  state.extractedImages.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.dataset.idx = idx;
    card.draggable = true;
    card.ondragstart = (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', String(idx));
      dragState.galleryIdx = idx; // fallback for browsers/webviews with flaky dataTransfer reads
      card.classList.add('dragging');
    };
    card.ondragend = () => { card.classList.remove('dragging'); dragState.galleryIdx = null; };
    card.innerHTML = `
      <img src="${img.dataUrl}" alt="${img.name}" loading="lazy" style="opacity:${pdfedGetOpacity(img)}">
      <div class="img-overlay">
        <div class="overlay-btn" onclick="openPreview(${idx},event)" title="Preview"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z'/><circle cx='12' cy='12' r='3'/></svg></div>
        <div class="overlay-btn pdfed-opacity-btn" onclick="pdfedOpenOpacityPopover(event,'galleryImage',${idx},null)" title="Opacity"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2'><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg></div>
        <div class="overlay-btn" onclick="downloadSingle(${idx},event)" title="Extract this image"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg></div>
        <div class="overlay-btn rsh-quick" onclick="openReshapeForIndex(${idx},event)" title="Reshape (Premium)"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2a10 10 0 1 0 10 10'/><path d='M12 2v10l7 4'/><circle cx='18' cy='6' r='3' fill='currentColor' stroke='none'/></svg></div>
        <div class="overlay-btn" onclick="pushImageToPdfEditor(${idx},event)" title="Push to Workspace"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="11"/><polyline points="9 14 12 11 15 14"/></svg></div>
        <div class="overlay-btn del" onclick="deleteImage(${idx},event)" title="Delete"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/><path d='M9 6V4h6v2'/></svg></div>
      </div>
      <div class="img-select-badge" id="badge-${idx}"><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg></div>
      <div class="img-info">
        <div class="img-name">${img.name}</div>
        <div class="img-meta">Page ${img.page} • ${img.width ? Math.round(img.width)+'×'+Math.round(img.height) : 'Image'}</div>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if(e.target.classList.contains('overlay-btn') || e.target.closest('.overlay-btn')) return;
      toggleSelect(idx, card);
    });
    grid.appendChild(card);
  });

  refreshSidebarFolder();
  updatePreviewPanel(); // sync live preview
}

// ─── SELECTION ───
function toggleSelect(idx, card) {
  if(state.selectedImages.has(idx)) {
    state.selectedImages.delete(idx);
    card.classList.remove('selected');
  } else {
    state.selectedImages.add(idx);
    card.classList.add('selected');
  }
  updateSelectionBar();
}

function selectAll() {
  state.extractedImages.forEach((_, i) => state.selectedImages.add(i));
  document.querySelectorAll('.img-card').forEach(c => c.classList.add('selected'));
  updateSelectionBar();
}

function clearSelection() {
  state.selectedImages.clear();
  document.querySelectorAll('.img-card').forEach(c => c.classList.remove('selected'));
  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const n = state.selectedImages.size;
  document.getElementById('selCount').textContent = n;
  bar.classList.toggle('visible', n > 0);
}

// ─── DOWNLOADS ───
async function downloadSingle(idx, e) {
  if(e) e.stopPropagation();
  const img = state.extractedImages[idx];
  const outUrl = await pdfedApplyOpacityToDataUrl(img.dataUrl, pdfedGetOpacity(img));
  const a = document.createElement('a');
  a.href = outUrl;
  a.download = sarvarcBrandFilename(img.name);
  a.click();
  state.stats.exports++;
  updateStats();
  toast('Downloaded ' + img.name, 'success');
}

// ─── PUSH EXTRACTED IMAGE INTO PDF EDITOR ───
// ─── DRAG A THUMBNAIL ONTO THE PDF EDITOR CANVAS ───
// Two things can land here:
//  1. A page thumbnail from the left-nav strip -> switch editing to that
//     page. pdfedGoto() already bakes/auto-saves whatever was on the
//     previously active page before it loads the new one, so no extra
//     save step is needed here.
//  2. An extracted-image gallery thumbnail -> insert it as a new page
//     (reuses pushImageToPdfEditor, same as the button).
function pdfedCanvasDragOver(e) {
  const isPage = dragState.pageIdx !== null;
  const isGallery = dragState.galleryIdx !== null || e.dataTransfer.types.includes('text/plain');
  const isOsFile = !isPage && !isGallery && e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  if (!isPage && !isGallery && !isOsFile) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = isPage ? 'move' : 'copy';
  e.currentTarget.classList.add('pdfed-drag-over');
  e.currentTarget.classList.toggle('pdfed-drag-over-page', isPage);
}

function pdfedCanvasDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return; // still inside, ignore
  e.currentTarget.classList.remove('pdfed-drag-over', 'pdfed-drag-over-page');
}

async function pdfedCanvasDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('pdfed-drag-over', 'pdfed-drag-over-page');

  // Case 0: real files dragged in from the computer (PDF, Word, Excel, CSV)
  if (dragState.pageIdx === null && dragState.galleryIdx === null && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    await pdfedOpenDroppedFiles(Array.from(e.dataTransfer.files));
    return;
  }

  // Case 1: a page thumbnail was dropped -> make it the active, editable page
  if (dragState.pageIdx !== null) {
    const pageIdx = dragState.pageIdx;
    dragState.pageIdx = null;
    _dragSrcIdx = null;
    if (!pdfed.pages[pageIdx]) return;
    if (pageIdx === pdfed.active) return; // already editing this one
    const prevIdx = pdfed.active;
    await pdfedGoto(pageIdx); // bakes/auto-saves the previous page internally
    if (prevIdx >= 0) toast('Editing page ' + (pageIdx + 1) + ' · page ' + (prevIdx + 1) + ' auto-saved', 'success');
    return;
  }

  // Case 2: a gallery thumbnail was dropped -> insert as a new page
  let idx = dragState.galleryIdx;
  if (idx === null || idx === undefined) {
    const raw = e.dataTransfer.getData('text/plain');
    idx = (raw && !raw.startsWith('page:')) ? parseInt(raw, 10) : NaN;
  }
  dragState.galleryIdx = null;
  if (idx === null || Number.isNaN(idx) || !state.extractedImages[idx]) return;
  await pushImageToPdfEditor(idx);
}

async function pushImageToPdfEditor(idx, e) {
  if(e) e.stopPropagation();
  const img = state.extractedImages[idx];
  if(!img) { toast('Image not found', 'error'); return; }

  if (e && e.currentTarget && typeof sarvarcAnimatedPush === 'function') {
    sarvarcAnimatedPush(e.currentTarget, 'navIcon-workspace');
  }
  navigate('pdfeditor');

  const bakedUrl = await pdfedApplyOpacityToDataUrl(img.dataUrl, pdfedGetOpacity(img));
  const newPg = { type:'image', dataUrl: bakedUrl, modified:true, edits:{}, textBlocks:[], label: img.name || 'Image Page' };

  if(!pdfed.pages.length) {
    // No document open in the editor yet, start a fresh one with this image as page 1
    pdfed.pdfDoc = null;
    pdfed.file = { name: img.name || 'Image Document' };
    pdfed.pages = [newPg];
    pdfed.active = -1;
    pdfed.refineReportUsed = false;
    ['pdfedExportBtn','pdfedRefineBtn','pdfedExportBtn2','pdfedCloseBtn','pdfedPageInfoPill'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn');
    if(upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName');
    if(fnEl) fnEl.textContent = pdfed.file.name;
    document.getElementById('pdfedPlaceholder').style.display = 'none';
    document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
    document.getElementById('pdfedToolbar').style.visibility = 'visible';
    document.getElementById('prrTotalPages').textContent = 1;
    await pdfedBuildStrip();
    await pdfedGoto(0);
    setTimeout(pdfedZoomFit, 50);
    pdfedScheduleAutoCollapse();
    toast('Pushed to Workspace', 'success');
  } else {
    // Document already open, insert this image as a new page right after the current one
    const at = pdfed.active + 1;
    pdfed.pages.splice(at, 0, newPg);
    await pdfedBuildStrip();
    await pdfedGoto(at);
    toast('Pushed to Workspace, added as page ' + (at + 1), 'success');

    pushAppHistory({
      label: 'Push image to Workspace',
      undo: async () => {
        if (pdfed.pages.length <= 1) { toast('Cannot remove last page', 'error'); return; }
        pdfed.pages.splice(at, 1);
        if (pdfed.active >= pdfed.pages.length) pdfed.active = pdfed.pages.length - 1;
        await pdfedBuildStrip();
        await pdfedGoto(pdfed.active);
        toast('Push undone', 'info');
      },
      redo: async () => {
        pdfed.pages.splice(at, 0, newPg);
        await pdfedBuildStrip();
        await pdfedGoto(at);
        toast('Pushed to Workspace, added as page ' + (at + 1), 'success');
      }
    });
  }
}

async function downloadSelected() {
  if(state.selectedImages.size === 0) { toast('No images selected', 'error'); return; }
  await downloadImages([...state.selectedImages].map(i => state.extractedImages[i]));
}

async function downloadAll() {
  if(state.extractedImages.length === 0) { toast('No images to download', 'error'); return; }
  await downloadImages(state.extractedImages);
}

async function downloadImages(imgs) {
  if(imgs.length === 1) {
    const outUrl = await pdfedApplyOpacityToDataUrl(imgs[0].dataUrl, pdfedGetOpacity(imgs[0]));
    const a = document.createElement('a');
    a.href = outUrl; a.download = sarvarcBrandFilename(imgs[0].name); a.click();
    toast('Downloaded', 'success'); return;
  }
  showExportOverlay('Creating your ZIP…', `Packing ${imgs.length} images…`);
  try {
    const zip = new JSZip();
    for (const img of imgs) {
      const outUrl = await pdfedApplyOpacityToDataUrl(img.dataUrl, pdfedGetOpacity(img));
      const b64 = outUrl.split(',')[1];
      zip.file(img.name, b64, { base64: true });
    }
    // JSZip reports real-time compression progress, ride that straight into
    // the ring instead of faking it, so the bar actually reflects the work.
    const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      updateExportProgress(metadata.percent * 0.95, `Compressing… ${Math.round(metadata.percent)}%`);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sarvarcBrandFilename('extractly-ai-images.zip');
    a.click();
    state.stats.exports += imgs.length;
    updateStats();
    completeExportOverlay(imgs.length + ' images zipped', { module: 'extract_images', format: 'zip' });
    toast('ZIP downloaded, ' + imgs.length + ' images', 'success');
  } catch(e) {
    hideExportOverlay();
    toast('ZIP error: ' + e.message, 'error');
  }
}
