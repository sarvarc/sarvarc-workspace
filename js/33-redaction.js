/* ══════════════════════════════════════════════════════════════════════
   PRIVACY REDACTION TOOL (rdx*)
   Upload -> OCR -> smart detect (regex + checksum + keyword context) ->
   review popup -> manual box adjustment -> permanent pixel redaction -> export.
   ══════════════════════════════════════════════════════════════════════ */

const rdxState = {
  fileType: null,       // 'pdf' | 'image'
  fileName: '',
  pages: [],             // { canvas, width, height, mmW, mmH }
  currentPage: 0,
  detections: [],        // { id, category, text, page, confidence, selected, manual, x0,y0,x1,y1 }
  maskStyle: 'black',
  zoom: 1,
  scanning: false,
  manualAddMode: false,
  nextId: 1,
  scanned: false,        // has the *active* document been scanned yet
  exportEnabled: false,  // has the *active* document had at least one redaction applied
  batchProcessing: false, // true while "Scan All" / "Redact All" is running across the queue
  docs: [],              // batch queue — one entry per uploaded file: { fileName, fileType, pages, detections, currentPage, nextId, scanned, exportEnabled, docType, docTypeLabel }
  activeDoc: -1,         // index into docs currently loaded into the working fields above
  reviewMode: 'single',  // 'single' = review modal covers the active doc only, 'batch' = it covers the whole queue
  docType: null,         // detected type of the *active* document, e.g. 'pan', 'aadhaar_front'
  docTypeLabel: null,    // display label of the active document's type, e.g. 'PAN card'
  docQueueFilter: null,  // when set, the batch strip shows only docs whose docTypeLabel matches this "folder"
  gridSelected: new Set() // doc indices checked in the currently open folder-grid modal
};

const RDX_CAT_LABELS = {
  name: 'Name', address: 'Address', bank: 'Bank Info', govid: 'Government ID',
  license: 'License Number', signature: 'Signature', phone: 'Phone Number',
  email: 'Email Address', dob: 'Date of Birth', photo: 'Photo/Face', other: 'Other Sensitive Info'
};
function rdxCatLabel(c) { return RDX_CAT_LABELS[c] || 'Other'; }

// Custom folder-tab icons for the two recognized ID types, used instead of
// the generic folder glyph so "PAN card" / "Aadhaar card" folders are
// instantly recognizable at a glance in the batch queue strip.
const RDX_FOLDER_ICONS = {
  'PAN card': 'data:image/png;base64,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',
  'Aadhaar card': 'data:image/png;base64,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RGstb7/9trz33nsCiG3bEgqFJBAI9NCA559/XgCpq6uTMWPGyNlnn50979KlSwWQjz76SA488ECZPn169thBBx0kgwYNklNPPVXKysrkhhtu6LGWvjTAcf2GtVjcSHvEk+atrhPJUwPs/MMA2W4Ktu9avkFrzZ/+9CcAZs+ezfr160mlUmzYsIGamprssTlz5tDQ0EBnZyerV69mn332yf7eThvVTz75BGMMlZWVtLa2opTiggsuYNKkSaxYsYLf/OY3WWP67LPPAjBjxgw2bNhAMpkkFotRVFTEM888A8AZZ5zBqlWr2LRpEx0dHZSVlWGMobi4mFAoREdHB/vtt1/WUPflXEjG71QD1V3aSwNWrovdFE2ItG5NdmuAu/NtaDJSc+ihh8rIkSNl3rx5cuWVVwogd999t4iIHHvssTJkyBCZN2+eXH311QLIzTffLCIiU6dOlcrKSlmzZo089NBDWXsgIlJbWyuA1NbWiojI3//+dwHk2WefFRGRyspKmTJlisybN0/OP/98AeSVV14REZFRo0bJ/vvvL/PmzZOLL75YAFm4cKGIiNTU1MiJJ54oIiLV1dWy33777VADctsTkykjXQkjHdH+aUAeDIjcFMkywMlC0I4YkJlwY2OjBINB+elPf5o9VlVVJV/+8pelq6tLwuGwXHHFFdljNTU1cvTRR4uIyJlnnilKKSkoKJDCwkKZNWuW1NfXi4jIa6+9JqFQSJ577jlxHEcWL14soVBI/vKXv8hHH30ktm3LI488IiIiTU1NUlhYKFdddZU0NjaKbdtyzz33iIhIR0eHlJSUyHnnnSciIhMnTpRp06aJ67oyd+5cCYfD0tTUtFMYctOGuAcDUgPFgLX9Z0C26TYel7q6OkkkElksb2pqkvr6enEcR+rq6qSrq0scxxHP86SluVnq6upERKStrU1WrVolq1etks7Ozh7nTSaTUrduncS74v7fiYTU1dVJKpWSWCwmGzZsEMdxfC/MGNm4caM0NTVJPB6XDRs2SCqVynpo9fX1WcY2NDTIli1besw9mUzutEE36wkljHTGjLS0u040TwbsNBJeuTZyU/WI4itTiZQbCmrbtjW2pbA0DNimESI9a67buQPQc1yUVn5wlXusr7sF0+cUEb9jbvtrHJA1mHSTrueB40EqZdxQoWU35hEJ988NFfq9R4ExpocRE5Hs3yYdHGVa7cQYnOaWHgTN/NIK2GjLyh6Lf7gKp2Fz312w6XP2Jr7JSdAopXrML3dufudzfqGUgh7dgmpAm3ON2aW70HQvAqgcKdda421tZ8uV11B69hnE//4m8dffoeiE4yk64Vhafn4nVnmZn71MJBDXJTRxAsF9J9Dx4KMEJ+xN4XFH+t3PRYWodL6IYBBlW9m+cXE98FwC48dR+f1L+5xfrjZk4pS8GKAUKs24Hj/ZlXpAbe+4a8B3U1XpSlQJlT+aS+ExR1B+3tlUP3Q3sT//BRFIrf6YktOnM/iKi3E21BPceyxl58wC42GPrKbi4tmE9p1A6uN1FBwyicFzLybxwQoKDj2YwVdczKDLvsmQ637oM27S/pSfc6aPE7tjKL9huUff7EC0pZhepbaBrt8r28IeOoTUqjVYgypouuo6JOWQXLEKFQgQ2nc8gTGjsKsqCY4dgz2sipLT/gtJJGn85ndIfrgKe8QwAjUjCYyp8VPKNdUExtSQWv0xLdf9EtPZSeFxR2GPGLbb9tnpAUP9iIjzKklKv6vz/emgELytHTScfxmx2tcY/uufo2yL6HMvgWVhEkkfRoxBnFQaUlySK1Yx6NILKTj6cNz6hqx9EvGbvBAhdOBEIs8touTLpxCefED29tXdwoC02G+3c3zXSpLyqYxv3jAkgj18KMN+fTOtN91O/dkXocJhht1+I9LVlc7PK0xnBEmkfMNqWZTPPpuOBx5lyw+uwVm/sfuu+PYOH/OVIlAzkpGP/Y72+/7glzK1zq9KsgtaoBVopQb2Dplt7gaXXb5bO9cK+p3Nhx/CyCceoOuvf6fwc8diFRdRdt5Z2OkKWOlXTie0797Z65efdxYlM05BBYMUHnskdrrRq/y8swlNGOt/zXUJHzKJwT+4zG/eTTN8tzFgINMRS9LBw7KVrTe0RUSaWrqcjkhK4glXHMcb+B1xPW/3fL+/593FHRQd199BMWlEPt7k/mTX09GG9ux+SrIbBSitCbltIpLzHs/0vHjm+71+0+N95nvG7Fbo6eGOplVABDwxHZ8egmqzjuh636aJMmkuyO7aolipbDEd6Ln/g6X71vke37O2z9zPavhTUo4DYlTdzryXHWzYNNUAxF1nZUdnVIygjfFvStutmvB/ffj20ers9Lyk56361AxQ/j4ylFpDV6dSTp1lBZXxoR+Tcff2cGF79DeWrXBcWdtWF1qbTjf1nwGgZMkSsQ84QKUcl8WWbYtnjM+ANBOM+DuJZ3IogvwHE96ni2fEWDZ4Ri/6/OeVC2L1tWPiTo1wc7NP0aTjPBSJJJXjiPY8/0KSJXy3LfRvA8thyL+xhuSuMQPNRgTXRbd3GDDewwALFuRzV92OL6SVQt5d3rJ0+LBBR2ESXkHYtgIBjaUVWiu02k6/UI+kpPq3Ifr2cmN+S6LgusZTlm01bEnVjq0OfT6fbex36h4sWIACJSmXH8cTHq6HuK7BcyW9abX0hCHZVjPMZ6ANu1vjeqzJ5KzNhx1c15BMCdEuIWSrH+cr4DtlwKxZyps/X6wjJw/5c0vL1j8GQ4V2MuW5jid4rsF1Da5nsszwGdLLNmQnnC+RfHuyLVO3fWVsUjfDB5YRuQJlpFvYjAheet2ua0gkPTdUELAikdR91UODS/N9kobKcxIKUK+9tqGspLLs7arBxWPFJLxg0Lb86phC6e4gROVAj1b4laxMsqqXC9875dGX0yY7ypP0WpHaCfT1BSW9uz1yWw1zGQ1prU7bPMdxPcsusCKx1OqRQ4OHATHyfLxVvx9h8srrGw8aPqTiL6XFwVLjJb1gwGeCTjfs5kaEWSZo5W/wodP7TOyoh0O21YW+j+XmC9MFEZS//6vqKRC9iUqe+UUhU2406Xv/crUBHMf1lBWyHMdrU54cN2JEeEV/HmHSL+s4X8SapZRX+3r9cUOryp8tKQqVOakuNxCw7G6DnKkmdf+fZUAOM/o0zJJzs1vvz3oQTXoZQbL9OTr9eBFL621XmGZWLmSpXpF15t7fDLFdz/jQKiAmAz+C63quHSiy48lkG6nU9L32Knt9tz3EJ0cTLKWUt3jpuoOHVVY+VlFRPCEe6zS2rcSytKVziJ+pEuk0c7bHpG0kOiPNvTuNc7Kw0rtC0SsyzzDdthW2pbIal0vUbrshOfCjelohwSe0J1kN8I2u8TxPVEFhid7aHluRika+Mnny8OWf5lliu/Qgt/kvLh80dtTIWwrDodnhsE0qERPLUp5WSiul0mXVtBbkMCKjDUp1y5tk5E56SfUOtKFbI2QbPFfKh8WAlWZCuost13uRXGarns+clLS0uz4D/FZMg3E9Y4XCxSrWlSSRdO9d29DyvVknjuv4tA9yU7vgHWRxbuk7zdMKQsEfWraeVlxchOskcd0kCjylkGyePKdYofooWsg2zypUOZIu25oC6as5vhuOfO3rxpYsgXNxi+4WlYxmGAHjifIMlmUHse0QkWgU1+WlrnjyxuMOG1LbmxafGQMy3tGCBejMMyWXvtt6tG3ps5RimsJMKCwssmw7kENsf7GZ5KTqs8lU8B0vyYEPoa8HF+7MmGYNv8rZWUzltBRtZ7OHjJakUg7RaMRTylptUIsl5T525KGVr4P/PM0zz8T8Ux7m2cM4z59vnXnmmdmJzJ8vVvXYlvGimABmtDKqDCRg+gpCtAZM3nc0mO0EMP0VP51zntzzGUi3o3seyt5qoes8z1p9zGGlH2Wk3Be8BXrWrFn/Gg+vyWXEkiVLbP5Nx5IlS+z0I2wHuHww8HG7knQ8lHkQ0P/VMXWqbzL8lLLak3/fM/aMPWPP2DP2jD1jzxiQ8f8AJbbdtq0mrJMAAAAASUVORK5CYII='
};
function rdxEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------------------------------------------------------------
   File loading
   --------------------------------------------------------------------- */
function rdxTriggerUpload() { const el = document.getElementById('rdxFileInput'); if (el) el.click(); }

function rdxOnFileChosen(input) {
  const files = input.files ? Array.from(input.files) : [];
  if (files.length) rdxLoadFiles(files);
  input.value = '';
}

function rdxHandleDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('rdxDropzone');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length) rdxLoadFiles(files);
}

function rdxReadAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}
function rdxLoadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

// Decodes a single File into { fileType, pages[] } — used for both the
// first upload and every subsequent file added to a batch.
async function rdxParseFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImg = (file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
  if (!isPdf && !isImg) throw new Error('unsupported-type');
  const pages = [];
  if (isPdf) {
    const buf = await file.arrayBuffer();
    const doc = await sarvarcOpenPdfDocument(buf);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const mmW = vp1.width * 25.4 / 72, mmH = vp1.height * 25.4 / 72;
      const viewport = page.getViewport({ scale: 2.2 }); // upscale for sharper OCR
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push({ canvas, width: canvas.width, height: canvas.height, mmW, mmH });
    }
    return { fileType: 'pdf', pages };
  } else {
    const dataUrl = await rdxReadAsDataURL(file);
    const img = await rdxLoadImageEl(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const mmW = canvas.width * 25.4 / 96, mmH = canvas.height * 25.4 / 96;
    pages.push({ canvas, width: canvas.width, height: canvas.height, mmW, mmH });
    return { fileType: 'image', pages };
  }
}

// Accepts one or many files at once (from the file picker or a drag/drop),
// so a single upload action doubles as a batch upload with no extra UI.
async function rdxLoadFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;

  const startingFresh = rdxState.docs.length === 0;
  if (startingFresh) rdxResetSilent();

  rdxShowBusy(files.length > 1 ? `Loading ${files.length} documents…` : 'Loading document…');

  let loaded = 0, skipped = 0;
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const isImg = (file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
    if (!isPdf && !isImg) {
      skipped++;
      toast(`Skipped "${file.name || 'file'}" — only PDF or image files are supported.`, 'error');
      continue;
    }
    try {
      const parsed = await rdxParseFile(file);
      rdxState.docs.push({
        fileName: file.name || 'document',
        fileType: parsed.fileType,
        pages: parsed.pages,
        detections: [],
        currentPage: 0,
        nextId: 1,
        scanned: false,
        exportEnabled: false,
        docType: null,       // e.g. 'pan', 'aadhaar_front' — set once scanned
        docTypeLabel: null   // e.g. 'PAN card', 'Aadhaar card' — used to group into folders
      });
      loaded++;
    } catch (err) {
      console.warn('Redact load error', err);
      skipped++;
      toast(`Could not load "${file.name || 'that file'}".`, 'error');
    }
  }
  rdxHideBusy();

  if (!rdxState.docs.length) return; // nothing usable was loaded

  if (startingFresh) {
    rdxState.activeDoc = 0;
    rdxApplyDocToWorking(rdxState.docs[0]);
    rdxShowWorkspace();
    rdxRenderPage();
    rdxRenderThumbs();
    rdxRenderSidebarList();
    const exportBtn = document.getElementById('rdxExportBtn');
    if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
    if (rdxState.docs.length > 1) {
      toast(`${rdxState.docs.length} documents loaded. Working on "${rdxState.docs[0].fileName}" first — switch between them any time in the batch strip.`, 'info');
    } else {
      toast('Document loaded. Click "Scan for Sensitive Info" to detect redactable content.', 'info');
    }
  } else if (loaded) {
    toast(`Added ${loaded} file${loaded !== 1 ? 's' : ''} to the batch — ${rdxState.docs.length} queued.`, 'success');
  }
  rdxRenderDocQueue();
  if (loaded) rdxPersist();
}

function rdxShowBusy(label) {
  // reuses the toast for a lightweight "loading" cue; a spinner card isn't
  // needed for the (usually fast) file-decode step, only for OCR scanning.
  toast(label, 'info');
}
function rdxHideBusy() {}

function rdxShowWorkspace() {
  const empty = document.getElementById('rdxEmptyState');
  const note = document.getElementById('rdxPrivacyNote');
  const work = document.getElementById('rdxWorkspace');
  if (empty) empty.style.display = 'none';
  if (note) note.style.display = 'none';
  if (work) work.style.display = 'flex';
  const nav = document.getElementById('rdxPageNav');
  if (nav) nav.style.display = rdxState.pages.length > 1 ? 'flex' : 'none';
}

function rdxResetSilent() {
  rdxState.fileType = null;
  rdxState.fileName = '';
  rdxState.pages = [];
  rdxState.currentPage = 0;
  rdxState.detections = [];
  rdxState.scanning = false;
  rdxState.manualAddMode = false;
  rdxState.nextId = 1;
  rdxState.scanned = false;
  rdxState.exportEnabled = false;
  rdxState.batchProcessing = false;
  rdxState.docs = [];
  rdxState.activeDoc = -1;
  rdxState.zoom = 1;
  rdxState.docType = null;
  rdxState.docTypeLabel = null;
  rdxState.docQueueFilter = null;
  rdxState.gridSelected = new Set();
  if (typeof rdxHistory !== 'undefined') rdxHistory.reset();
}
function rdxReset() {
  rdxResetSilent();
  const empty = document.getElementById('rdxEmptyState');
  const note = document.getElementById('rdxPrivacyNote');
  const work = document.getElementById('rdxWorkspace');
  if (empty) empty.style.display = 'flex';
  if (note) note.style.display = 'flex';
  if (work) work.style.display = 'none';
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = true;
  rdxHideScanProgress();
  rdxCloseReviewModal();
  rdxRenderDocQueue();
  clearTimeout(rdxPersistTimer);
  idbKvDelete(RDX_STORAGE_KEY).catch(e => console.warn('[Redact] could not clear persisted batch', e));
}

let rdxHeadCollapseTimer = null;
function rdxScheduleHeadCollapse() {
  const p = document.getElementById('rdxHeadDesc');
  if (!p || p.dataset.collapsed === '1' || rdxHeadCollapseTimer) return;
  rdxHeadCollapseTimer = setTimeout(() => {
    p.classList.add('rdx-collapsed');
    p.dataset.collapsed = '1';
  }, 2000);
}
function rdxOnEnter() {
  // Section was hidden (display:none) while boxes were computed, so
  // getBoundingClientRect() would have read 0 — resync once it's visible.
  if (rdxState.pages.length) setTimeout(rdxRenderBoxes, 0);
  rdxScheduleHeadCollapse();
}

/* ---------------------------------------------------------------------
   Batch queue — lets one upload action carry several files. The working
   fields above (pages/detections/currentPage/nextId/scanned/exportEnabled)
   always mirror whichever doc is "active"; switching docs snapshots the
   outgoing one back into rdxState.docs and loads the incoming one in.
   --------------------------------------------------------------------- */
function rdxCaptureActiveDoc() {
  const doc = rdxState.docs[rdxState.activeDoc];
  if (!doc) return;
  doc.fileType = rdxState.fileType;
  doc.fileName = rdxState.fileName;
  doc.pages = rdxState.pages;
  doc.detections = rdxState.detections;
  doc.currentPage = rdxState.currentPage;
  doc.nextId = rdxState.nextId;
  doc.scanned = rdxState.scanned;
  doc.exportEnabled = rdxState.exportEnabled;
  doc.docType = rdxState.docType;
  doc.docTypeLabel = rdxState.docTypeLabel;
}

function rdxApplyDocToWorking(doc) {
  rdxState.fileType = doc.fileType;
  rdxState.fileName = doc.fileName;
  rdxState.pages = doc.pages;
  rdxState.detections = doc.detections;
  rdxState.currentPage = doc.currentPage || 0;
  rdxState.nextId = doc.nextId || 1;
  rdxState.scanned = !!doc.scanned;
  rdxState.exportEnabled = !!doc.exportEnabled;
  rdxState.docType = doc.docType || null;
  rdxState.docTypeLabel = doc.docTypeLabel || null;
  rdxState.manualAddMode = false;
  const btn = document.getElementById('rdxManualBtn');
  const catSel = document.getElementById('rdxManualCat');
  if (btn) btn.classList.remove('active-toggle');
  if (catSel) catSel.style.display = 'none';
  const overlay = document.getElementById('rdxOverlay');
  if (overlay) overlay.classList.remove('manual-mode');
}

function rdxSwitchDoc(idx) {
  if (idx === rdxState.activeDoc || !rdxState.docs[idx]) return;
  if (rdxState.scanning || rdxState.batchProcessing) { toast('Please wait for the current scan to finish before switching documents.', 'error'); return; }
  rdxCaptureActiveDoc();
  rdxState.activeDoc = idx;
  rdxApplyDocToWorking(rdxState.docs[idx]);
  const nav = document.getElementById('rdxPageNav');
  if (nav) nav.style.display = rdxState.pages.length > 1 ? 'flex' : 'none';
  rdxRenderPage();
  rdxRenderThumbs();
  rdxRenderSidebarList();
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
  rdxRenderDocQueue();
  rdxPersist();
}

function rdxRemoveDoc(idx, ev) {
  if (ev) ev.stopPropagation();
  if (rdxState.scanning || rdxState.batchProcessing) { toast('Please wait for the current scan to finish first.', 'error'); return; }
  if (!rdxState.docs[idx]) return;
  const wasActive = idx === rdxState.activeDoc;
  rdxState.docs.splice(idx, 1);
  if (!rdxState.docs.length) { rdxReset(); return; }
  if (wasActive) {
    const nextIdx = Math.min(idx, rdxState.docs.length - 1);
    rdxState.activeDoc = -1; // nothing to capture, the removed doc was active
    rdxApplyDocToWorking(rdxState.docs[nextIdx]);
    rdxState.activeDoc = nextIdx;
    const nav = document.getElementById('rdxPageNav');
    if (nav) nav.style.display = rdxState.pages.length > 1 ? 'flex' : 'none';
    rdxRenderPage();
    rdxRenderThumbs();
    rdxRenderSidebarList();
    const exportBtn = document.getElementById('rdxExportBtn');
    if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
  } else if (idx < rdxState.activeDoc) {
    rdxState.activeDoc--;
  }
  rdxRenderDocQueue();
  rdxPersist();
}

function rdxDocStatusClass(doc) {
  if (doc.exportEnabled) return 'done';
  if (doc.scanned && doc.detections.length) return 'found';
  return '';
}
function rdxDocSummary(doc) {
  const typeTag = doc.docTypeLabel ? `[${doc.docTypeLabel}] ` : '';
  if (!doc.scanned) return typeTag + 'Not scanned yet';
  if (doc.exportEnabled && !doc.detections.length) return typeTag + 'Redacted — ready to export';
  if (!doc.detections.length) return typeTag + 'Scanned — nothing sensitive found';
  const cats = {};
  doc.detections.forEach(d => { cats[d.category] = (cats[d.category] || 0) + 1; });
  return typeTag + 'Detected: ' + Object.keys(cats).map(c => `${rdxCatLabel(c)} ×${cats[c]}`).join(', ');
}

function rdxUpdateScanBtnLabel() {
  const label = document.getElementById('rdxScanBtnLabel');
  if (!label) return;
  label.textContent = rdxState.docs.length > 1 ? 'Scan All for Sensitive Info' : 'Scan for Sensitive Info';
}

// Builds { label -> count } across the whole batch, in first-seen order,
// e.g. { 'Aadhaar card': 10, 'PAN card': 5 } — used both for the folder
// tabs and to decide whether folders should be shown at all.
function rdxDocTypeCounts() {
  const counts = {};
  const order = [];
  rdxState.docs.forEach(doc => {
    if (!doc.docTypeLabel) return;
    if (!(doc.docTypeLabel in counts)) { counts[doc.docTypeLabel] = 0; order.push(doc.docTypeLabel); }
    counts[doc.docTypeLabel]++;
  });
  return { counts, order };
}

// Selecting a folder tab filters which chips show in the strip below —
// this is what turns "10 Aadhaar + 5 PAN" into two separate, clickable
// sections instead of one long flat list. Click the same tab (or "All")
// again to clear the filter.
function rdxSetDocQueueFilter(label) {
  rdxState.docQueueFilter = (rdxState.docQueueFilter === label) ? null : label;
  rdxRenderDocQueue();
}

function rdxRenderDocQueueFolders() {
  const box = document.getElementById('rdxDocQueueFolders');
  if (!box) return;
  const { counts, order } = rdxDocTypeCounts();
  // If the active filter no longer corresponds to a real folder (e.g. the
  // last doc of that type was removed), fall back to "All".
  if (rdxState.docQueueFilter && !(rdxState.docQueueFilter in counts)) rdxState.docQueueFilter = null;
  const unlabeled = rdxState.docs.length - order.reduce((s, l) => s + counts[l], 0);
  // A proper filled folder shape (not a thin outline glyph) so it reads as
  // an actual "folder" — used for "All" / "Other" and any recognized type
  // that doesn't have its own artwork.
  const genericFolderIcon = '<svg class="rdx-dq-folder-icon" viewBox="0 0 24 24" fill="var(--blue)" fill-opacity="0.16" stroke="var(--blue)" stroke-width="1.3" stroke-linejoin="round"><path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.3l1.8 2.2h7.5A2.2 2.2 0 0 1 21 9.4v7.4A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z"/></svg>';
  // Prefer the type's own icon (the PAN/Aadhaar artwork) when we have one,
  // for quick visual recognition — otherwise fall back to the folder glyph.
  const folderIconFor = label => RDX_FOLDER_ICONS[label]
    ? `<img class="rdx-dq-folder-icon-img" src="${RDX_FOLDER_ICONS[label]}" alt="">`
    : genericFolderIcon;
  const folderCard = (activeCheck, onclickArg, title, icon, name, count) => `
    <div class="rdx-dq-folder-tab${activeCheck ? ' active' : ''}" onclick="rdxOpenDocGrid(${onclickArg})" title="${rdxEsc(title)}">
      <div class="rdx-dq-folder-iconwrap">${icon}</div>
      <span class="rdx-dq-folder-name">${rdxEsc(name)}</span>
      <span class="rdx-dq-folder-count">${count}</span>
    </div>`;
  let listHtml = '';
  if (order.length) {
    listHtml += folderCard(!rdxState.docQueueFilter, 'null', 'Show every document in this batch', genericFolderIcon, 'All', rdxState.docs.length);
    order.forEach(label => {
      const arg = `'${label.replace(/'/g, "\\'")}'`;
      listHtml += folderCard(rdxState.docQueueFilter === label, arg, `Show only ${label} documents`, folderIconFor(label), label, counts[label]);
    });
    if (unlabeled > 0) {
      listHtml += folderCard(rdxState.docQueueFilter === '__unlabeled__', "'__unlabeled__'", 'Documents not recognized as a known ID type', genericFolderIcon, 'Other', unlabeled);
    }
  } else {
    rdxState.docQueueFilter = null;
  }
  // Always keep this row visible (even before doc types are recognized) so
  // batch-level actions — like pushing the redacted result into the
  // Workspace document editor — have a fixed, predictable home instead of
  // leaving this strip blank until a "folder" happens to appear in it.
  const actionsHtml = `
    <div class="rdx-dq-folders-actions">
      <button type="button" class="rdx-push-ws-btn" id="rdxPushWsBtn" onclick="rdxOpenPushChoiceModal()" title="Send the redacted document into the Workspace editor as a page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
        Push to Workspace
      </button>
    </div>`;
  box.innerHTML = `<div class="rdx-dq-folders-list">${listHtml}</div>${actionsHtml}`;
  box.style.display = 'flex';
}

function rdxRenderDocQueue() {
  rdxUpdateScanBtnLabel();
  const bar = document.getElementById('rdxDocQueue');
  const wrap = document.getElementById('rdxDocQueueItems');
  if (!bar || !wrap) return;
  if (rdxState.docs.length < 2) { bar.style.display = 'none'; wrap.innerHTML = ''; return; }
  bar.style.display = 'flex';

  rdxRenderDocQueueFolders();
  const filter = rdxState.docQueueFilter;

  wrap.innerHTML = rdxState.docs.map((doc, i) => {
    if (filter) {
      const belongs = filter === '__unlabeled__' ? !doc.docTypeLabel : doc.docTypeLabel === filter;
      if (!belongs) return '';
    }
    const cls = rdxDocStatusClass(doc);
    const badge = doc.exportEnabled
      ? '<span class="rdx-dq-badge">done</span>'
      : (doc.scanned && doc.detections.length ? `<span class="rdx-dq-badge">${doc.detections.length}</span>` : '');
    return `
    <div class="rdx-docqueue-item${i === rdxState.activeDoc ? ' active' : ''}${cls ? ' ' + cls : ''}" onclick="rdxSwitchDoc(${i})" title="${rdxEsc(doc.fileName)} — ${rdxEsc(rdxDocSummary(doc))}">
      <span class="rdx-dq-status"></span>
      <span class="rdx-dq-name">${rdxEsc(doc.fileName)}</span>
      ${badge}
      <span class="rdx-dq-remove" onclick="rdxRemoveDoc(${i}, event)" title="Remove from batch">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    </div>
  `;
  }).join('');

  const scanAllBtn = document.getElementById('rdxScanAllBtn');
  const redactAllBtn = document.getElementById('rdxRedactAllBtn');
  const allScanned = rdxState.docs.every(d => d.scanned);
  const anyFindings = rdxState.docs.some(d => d.scanned && d.detections.some(x => x.selected));
  if (scanAllBtn) scanAllBtn.disabled = rdxState.scanning || rdxState.batchProcessing || allScanned;
  if (redactAllBtn) redactAllBtn.disabled = rdxState.scanning || rdxState.batchProcessing || !anyFindings;
  // Keep an already-open grid modal's cards (status pills, thumbnails) in
  // sync with whatever just changed the batch (a scan finishing, a redact
  // landing, a doc being removed, etc).
  const gridBackdrop = document.getElementById('rdxGridModalBackdrop');
  if (gridBackdrop && gridBackdrop.style.display === 'flex') rdxRenderDocGrid();
}

/* ---------------------------------------------------------------------
   Folder grid modal — clicking a folder tab ("Aadhaar card (3)", "PAN
   card (2)", ...) opens this instead of just filtering the thin batch
   strip, so several documents of the same type can be browsed as
   thumbnail cards, checked off, and redacted together. Clicking a card's
   thumbnail opens that one document in the single-doc editor popup below
   for manual box dragging/adjusting.
   --------------------------------------------------------------------- */
function rdxDocsForFilter(filter) {
  return rdxState.docs
    .map((doc, i) => ({ doc, i }))
    .filter(({ doc }) => {
      if (!filter) return true;
      return filter === '__unlabeled__' ? !doc.docTypeLabel : doc.docTypeLabel === filter;
    });
}

function rdxGridFolderTitle(filter) {
  if (!filter) return 'All documents';
  if (filter === '__unlabeled__') return 'Other documents';
  return filter;
}

// Downscales a document's first page into a small JPEG data URL for the
// grid card — drawn fresh each render (not cached) since a redaction can
// repaint that same canvas, and re-drawing a shrunk copy of an already-
// decoded canvas is cheap regardless of the source page's full resolution.
function rdxDocThumbSrc(doc) {
  const pg = doc && doc.pages && doc.pages[0];
  if (!pg || !pg.canvas || !pg.canvas.width) return '';
  const maxW = 240;
  const scale = Math.min(1, maxW / pg.canvas.width);
  const w = Math.max(1, Math.round(pg.canvas.width * scale));
  const h = Math.max(1, Math.round(pg.canvas.height * scale));
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  off.getContext('2d').drawImage(pg.canvas, 0, 0, w, h);
  try { return off.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
}

function rdxShortDocName(name) {
  if (!name) return 'Untitled';
  return name.length > 22 ? name.slice(0, 19) + '…' : name;
}

function rdxUpdateGridControls(visibleIdxs) {
  const selCount = visibleIdxs.filter(i => rdxState.gridSelected.has(i)).length;
  const selAllChk = document.getElementById('rdxGridSelectAllChk');
  const selCountEl = document.getElementById('rdxGridSelCount');
  const redactBtn = document.getElementById('rdxGridRedactBtn');
  if (selAllChk) {
    selAllChk.checked = visibleIdxs.length > 0 && selCount === visibleIdxs.length;
    selAllChk.indeterminate = selCount > 0 && selCount < visibleIdxs.length;
  }
  if (selCountEl) selCountEl.textContent = `${selCount} selected`;
  if (redactBtn) redactBtn.disabled = selCount === 0 || rdxState.scanning || rdxState.batchProcessing;
}

function rdxRenderDocGrid() {
  const body = document.getElementById('rdxGridBody');
  const titleEl = document.getElementById('rdxGridModalTitle');
  if (!body) return;
  const filter = rdxState.docQueueFilter;
  const items = rdxDocsForFilter(filter);
  if (titleEl) titleEl.textContent = `${rdxGridFolderTitle(filter)} (${items.length})`;
  body.innerHTML = items.map(({ doc, i }) => {
    const checked = rdxState.gridSelected.has(i);
    const thumb = rdxDocThumbSrc(doc);
    let statusClass = 'pending', statusText = 'Not scanned';
    if (doc.exportEnabled) { statusClass = 'done'; statusText = 'Redacted'; }
    else if (doc.scanned) {
      statusClass = doc.detections.length ? 'found' : 'clean';
      statusText = doc.detections.length ? `${doc.detections.length} found` : 'Nothing found';
    }
    const activeMark = i === rdxState.activeDoc ? ' active' : '';
    return `
    <div class="rdx-grid-card${activeMark}" title="${rdxEsc(doc.fileName)}">
      <label class="rdx-grid-card-check" onclick="event.stopPropagation()">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="rdxGridToggleOne(${i}, this.checked)">
      </label>
      <div class="rdx-grid-card-thumb" onclick="rdxOpenDocEditor(${i})" title="Open for manual review">
        ${thumb ? `<img src="${thumb}" alt="">` : '<span class="rdx-grid-card-noimg">No preview</span>'}
      </div>
      <span class="rdx-grid-card-status rdx-gcs-${statusClass}">${statusText}</span>
      <span class="rdx-grid-card-name">${rdxEsc(rdxShortDocName(doc.fileName))}</span>
    </div>`;
  }).join('') || '<div class="rdx-grid-empty">No documents in this folder.</div>';

  rdxUpdateGridControls(items.map(x => x.i));
}

function rdxGridToggleOne(idx, checked) {
  if (checked) rdxState.gridSelected.add(idx); else rdxState.gridSelected.delete(idx);
  rdxUpdateGridControls(rdxDocsForFilter(rdxState.docQueueFilter).map(x => x.i));
}

function rdxGridToggleSelectAll(checked) {
  const idxs = rdxDocsForFilter(rdxState.docQueueFilter).map(x => x.i);
  if (checked) idxs.forEach(i => rdxState.gridSelected.add(i));
  else idxs.forEach(i => rdxState.gridSelected.delete(i));
  rdxUpdateGridControls(idxs);
}

function rdxOpenDocGrid(filter) {
  if (rdxState.scanning || rdxState.batchProcessing) { toast('Please wait for the current scan/redact to finish first.', 'error'); return; }
  rdxState.docQueueFilter = filter;
  rdxState.gridSelected = new Set();
  rdxRenderDocQueue();
  rdxRenderDocGrid();
  const bd = document.getElementById('rdxGridModalBackdrop');
  if (bd) bd.style.display = 'flex';
}

function rdxCloseDocGrid() {
  const bd = document.getElementById('rdxGridModalBackdrop');
  if (bd) bd.style.display = 'none';
}

// "Select all, or pick a few, then Redact All" — redacts every checked
// document in the currently open folder, auto-scanning first any that
// haven't been scanned yet so a fresh upload can go straight from
// checkboxes to redacted without a separate Scan step.
async function rdxGridRedactSelected() {
  if (rdxState.scanning || rdxState.batchProcessing) return;
  const idxs = Array.from(rdxState.gridSelected).filter(i => rdxState.docs[i]);
  if (!idxs.length) { toast('Check at least one document first.', 'error'); return; }
  rdxState.batchProcessing = true;
  rdxUpdateGridControls(rdxDocsForFilter(rdxState.docQueueFilter).map(x => x.i));
  rdxShowScanProgress();
  let totalItems = 0;
  const catTotals = {};
  try {
    for (const i of idxs) {
      const doc = rdxState.docs[i];
      if (!doc) continue;
      if (!doc.scanned) {
        rdxSetScanLabel(`Scanning "${doc.fileName}"…`);
        const result = await rdxScanPagesCore(doc.pages, (p, tp) => {
          rdxSetScanLabel(`Scanning "${doc.fileName}" — page ${p + 1} of ${tp}…`);
        });
        doc.detections = result.detections;
        doc.docType = result.docType;
        doc.docTypeLabel = result.docTypeLabel;
        if (!doc.docTypeLabel) {
          const fnGuess = rdxDetectDocTypeFromFilename(doc.fileName);
          if (fnGuess) { doc.docType = fnGuess.type; doc.docTypeLabel = fnGuess.label; }
        }
        doc.scanned = true;
      }
      const selected = doc.detections.filter(x => x.selected);
      if (selected.length) {
        rdxApplyMaskToPages(doc.pages, selected, doc.fileName);
        selected.forEach(d => { catTotals[d.category] = (catTotals[d.category] || 0) + 1; });
        totalItems += selected.length;
        const appliedIds = new Set(selected.map(x => x.id));
        doc.detections = doc.detections.filter(x => !appliedIds.has(x.id));
        doc.exportEnabled = true;
      }
      if (rdxState.docs[rdxState.activeDoc] === doc) {
        rdxState.detections = doc.detections;
        rdxState.docType = doc.docType;
        rdxState.docTypeLabel = doc.docTypeLabel;
        rdxState.scanned = doc.scanned;
        rdxState.exportEnabled = doc.exportEnabled;
      }
    }
  } catch (err) {
    console.warn('Grid redact error', err);
    toast('Something went wrong redacting one of the checked documents.', 'error');
  }
  rdxHideScanProgress();
  rdxState.batchProcessing = false;
  rdxState.gridSelected = new Set();
  rdxRenderPage();
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxRenderThumbs();
  rdxRenderDocQueue();
  rdxRenderDocGrid();
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
  if (totalItems) {
    const breakdown = Object.keys(catTotals).map(c => `${rdxCatLabel(c)} ×${catTotals[c]}`).join(' · ');
    toast(`Redacted ${totalItems} item${totalItems !== 1 ? 's' : ''} across ${idxs.length} document${idxs.length !== 1 ? 's' : ''} — ${breakdown}.`, 'success');
  } else {
    toast('Scanned the checked documents — nothing sensitive was found to redact.', 'info');
  }
  rdxPersist();
}

/* ---------------------------------------------------------------------
   Single-document editor popup — reuses the real workspace (thumbs,
   canvas, drag/resize boxes, sidebar) by physically moving that DOM node
   into a modal when a grid card is opened, and moving it back to its
   normal inline spot (marked by rdxWorkspaceHome) when closed. This
   avoids re-implementing box dragging a second time for the popup.
   --------------------------------------------------------------------- */
function rdxOpenDocEditor(idx) {
  if (rdxState.scanning || rdxState.batchProcessing) { toast('Please wait for the current scan to finish first.', 'error'); return; }
  if (!rdxState.docs[idx]) return;
  if (idx !== rdxState.activeDoc) rdxSwitchDoc(idx);
  const inner = document.getElementById('rdxDocEditorBody');
  const work = document.getElementById('rdxWorkspace');
  if (inner && work && work.parentNode !== inner) inner.appendChild(work);
  rdxShowWorkspace();
  rdxRenderPage();
  rdxRenderThumbs();
  rdxRenderSidebarList();
  const titleEl = document.getElementById('rdxDocEditorTitle');
  if (titleEl) titleEl.textContent = rdxState.docs[idx].fileName || 'Document';
  const bd = document.getElementById('rdxDocEditorBackdrop');
  if (bd) bd.style.display = 'flex';
  // Boxes are positioned via getBoundingClientRect() of the canvas, which
  // reads 0 while the modal was still display:none — resync once it's
  // actually visible, same fix rdxOnEnter uses elsewhere.
  setTimeout(rdxRenderBoxes, 0);
}

function rdxCloseDocEditor() {
  const home = document.getElementById('rdxWorkspaceHome');
  const work = document.getElementById('rdxWorkspace');
  if (home && work && home.parentNode) home.parentNode.insertBefore(work, home.nextSibling);
  const bd = document.getElementById('rdxDocEditorBackdrop');
  if (bd) bd.style.display = 'none';
  rdxCaptureActiveDoc();
  rdxRenderDocGrid();
  rdxRenderDocQueue();
  rdxPersist();
}

/* ---------------------------------------------------------------------
   Page rendering / navigation / thumbnails
   --------------------------------------------------------------------- */
function rdxRenderPage() {
  const pg = rdxState.pages[rdxState.currentPage];
  if (!pg) return;
  const canvas = document.getElementById('rdxMainCanvas');
  canvas.width = pg.width;
  canvas.height = pg.height;
  canvas.getContext('2d').drawImage(pg.canvas, 0, 0);
  rdxUpdatePageIndicator();
  rdxApplyZoom();
}

// Drives the on-screen size of the canvas/overlay from rdxState.zoom, while
// leaving the canvas's actual pixel data untouched (same approach as the PDF
// editor's zoom). rdxRenderBoxes() re-reads the canvas's rendered rect right
// after, so detection boxes and drag/resize handles stay lined up at any zoom.
function rdxApplyZoom() {
  const canvas = document.getElementById('rdxMainCanvas');
  const wrap = document.getElementById('rdxCanvasWrap');
  if (!canvas || !canvas.width) return;
  const displayW = Math.round(canvas.width * rdxState.zoom);
  const displayH = Math.round(canvas.height * rdxState.zoom);
  canvas.style.width = displayW + 'px';
  canvas.style.height = displayH + 'px';
  if (wrap) { wrap.style.width = displayW + 'px'; wrap.style.height = displayH + 'px'; }
  const val = document.getElementById('rdxZoomVal');
  if (val) val.textContent = Math.round(rdxState.zoom * 100) + '%';
  setTimeout(rdxRenderBoxes, 0);
}

function rdxZoom(delta, pivotX, pivotY) {
  const canvas = document.getElementById('rdxMainCanvas');
  if (!canvas || !canvas.width) return;
  const scroll = document.getElementById('rdxCanvasScroll');
  const oldZoom = rdxState.zoom;
  rdxState.zoom = Math.max(0.2, Math.min(4, +(rdxState.zoom + delta).toFixed(4)));
  if (rdxState.zoom === oldZoom) return;
  if (scroll && pivotX !== undefined && pivotY !== undefined) {
    const ratio = rdxState.zoom / oldZoom;
    scroll.scrollLeft = (scroll.scrollLeft + pivotX) * ratio - pivotX;
    scroll.scrollTop  = (scroll.scrollTop  + pivotY) * ratio - pivotY;
  }
  rdxApplyZoom();
}

function rdxZoomFit() {
  const scroll = document.getElementById('rdxCanvasScroll');
  const canvas = document.getElementById('rdxMainCanvas');
  if (!canvas || !canvas.width || !scroll || !scroll.clientWidth) return;
  const availW = scroll.clientWidth - 48;
  const availH = scroll.clientHeight - 48;
  rdxState.zoom = Math.max(0.2, Math.min(4, availW / canvas.width, availH / canvas.height));
  rdxApplyZoom();
  scroll.scrollLeft = 0;
  scroll.scrollTop = 0;
}

// ── Ctrl+Wheel zoom (Canva-style), same pattern as the PDF editor ──
(function() {
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    const section = document.getElementById('sec-redact');
    if (!section || section.style.display === 'none') return;
    e.preventDefault();
    const scroll = document.getElementById('rdxCanvasScroll');
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    rdxZoom(delta, pivotX, pivotY);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const scroll = document.getElementById('rdxCanvasScroll');
    if (scroll) scroll.addEventListener('wheel', onWheel, {passive: false});
  });
})();

function rdxUpdatePageIndicator() {
  const el = document.getElementById('rdxPageIndicator');
  if (el) el.textContent = (rdxState.currentPage + 1) + ' / ' + rdxState.pages.length;
  document.querySelectorAll('.rdx-thumb').forEach((t, i) => t.classList.toggle('active', i === rdxState.currentPage));
}

function rdxPrevPage() { if (rdxState.currentPage > 0) { rdxState.currentPage--; rdxRenderPage(); } }
function rdxNextPage() { if (rdxState.currentPage < rdxState.pages.length - 1) { rdxState.currentPage++; rdxRenderPage(); } }

function rdxRenderThumbs() {
  const wrap = document.getElementById('rdxThumbs');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (rdxState.pages.length < 2) return; // no point showing a strip for a single image/page
  rdxState.pages.forEach((pg, i) => {
    const div = document.createElement('div');
    div.className = 'rdx-thumb' + (i === rdxState.currentPage ? ' active' : '');
    div.onclick = () => { rdxState.currentPage = i; rdxRenderPage(); };
    const img = document.createElement('img');
    img.src = pg.canvas.toDataURL('image/jpeg', 0.6);
    const num = document.createElement('div');
    num.className = 'rdx-thumb-num';
    num.textContent = i + 1;
    div.appendChild(img);
    div.appendChild(num);
    const count = rdxState.detections.filter(d => d.page === i).length;
    if (count) {
      const badge = document.createElement('div');
      badge.className = 'rdx-thumb-badge';
      badge.textContent = count;
      div.appendChild(badge);
    }
    wrap.appendChild(div);
  });
}

window.addEventListener('resize', () => { if (rdxState.pages.length) rdxRenderBoxes(); });

/* ---------------------------------------------------------------------
   OCR
   --------------------------------------------------------------------- */
async function rdxRunOCR(canvas) {
  if (typeof Tesseract === 'undefined') throw new Error('OCR engine unavailable (check network/CDN access)');
  // Reuses the PDF editor's contrast-stretch approach, but with an adaptive
  // scale instead of always doubling. That helper always applies a flat 2x,
  // which is fine for a normal phone-camera photo but risks pushing an
  // already-large source photo (some ID-card photos come in well past
  // 3000-4000px on a side) past what the browser can safely rasterize into a
  // single canvas — which can silently starve Tesseract of any readable
  // image at all rather than throwing a visible error. Scaling relative to
  // the source's own size keeps a small/blurry image getting the same
  // sharpening boost while capping how big the final canvas can get.
  const { canvas: ocrCanvas, scale } = rdxPreprocessForOcr(canvas);
  // Indian ID documents (Aadhaar, PAN, voter ID, etc.) print the same fields
  // twice — once in a regional script, once in English — side by side or
  // stacked. An English-only model doesn't just fail to read the regional
  // text, it actively MISREADS those glyphs as garbled Latin characters
  // (since it has no choice but to force-fit them to its own alphabet).
  // Those fake "words" get merged into whichever OCR line happens to sit
  // nearby, which corrupts word offsets, line bboxes, and the geometry-based
  // "value near this label" checks everything downstream relies on — this is
  // what produces junk captures like a 2-letter "name" or a checksum-broken
  // Aadhaar number. Loading Hindi (the most common second script on Indian
  // government IDs) and Gujarati (common on Gujarat-issued documents) lets
  // Tesseract correctly recognize and segment that text as its own script
  // instead of forcing it into English, so it just gets ignored by our
  // English-keyword regexes rather than corrupting them.
  const { data } = await Tesseract.recognize(ocrCanvas, 'eng+hin+guj', {
    logger: m => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        rdxUpdateScanProgress(m.progress);
      }
    }
  });
  // Word/line boxes come back in the upscaled canvas's coordinate space —
  // scale them back down so every downstream consumer (line/word offset
  // mapping, bbox unions, the final redaction rectangles) keeps working in
  // the original page canvas's coordinates unchanged.
  if (scale !== 1 && data && data.lines) {
    const scaleBBox = b => ({ x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale });
    data.lines.forEach(line => {
      if (line.bbox) line.bbox = scaleBBox(line.bbox);
      (line.words || []).forEach(w => { if (w.bbox) w.bbox = scaleBBox(w.bbox); });
    });
  }
  return data;
}

// Same contrast-stretch idea as pdfedPreprocessForOcr, but the scale adapts
// to the source size instead of always applying a flat 2x: small/blurry
// images still get upscaled for more glyph detail, but a photo that's
// already large gets capped (and downscaled if needed) so the resulting
// canvas never balloons past a size the browser can reliably rasterize.
function rdxPreprocessForOcr(srcCanvas) {
  const MAX_DIM = 3600; // comfortably under common browser canvas limits
  const longSide = Math.max(srcCanvas.width, srcCanvas.height);
  let scale = 2;
  if (longSide * scale > MAX_DIM) scale = Math.max(0.5, MAX_DIM / longSide);
  const w = Math.max(1, Math.round(srcCanvas.width * scale));
  const h = Math.max(1, Math.round(srcCanvas.height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(srcCanvas, 0, 0, w, h);

  const imgData = tctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const gray = new Uint8ClampedArray(w * h);
  let min = 255, max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ((gray[p] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  tctx.putImageData(imgData, 0, 0);
  return { canvas: tmp, scale };
}

/* ---------------------------------------------------------------------
   Checksum helpers
   --------------------------------------------------------------------- */
function rdxLuhnCheck(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

const RDX_VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]
];
const RDX_VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
function rdxVerhoeffCheck(numStr) {
  let c = 0;
  const arr = numStr.split('').reverse().map(Number);
  for (let i = 0; i < arr.length; i++) {
    if (isNaN(arr[i])) return false;
    c = RDX_VERHOEFF_D[c][RDX_VERHOEFF_P[i % 8][arr[i]]];
  }
  return c === 0;
}
function rdxIbanCheck(iban) {
  iban = iban.replace(/\s/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    expanded += (code >= 65 && code <= 90) ? String(code - 55) : ch;
  }
  let remainder = expanded;
  while (remainder.length > 9) {
    const block = remainder.slice(0, 9);
    remainder = (parseInt(block, 10) % 97) + remainder.slice(9);
  }
  return parseInt(remainder, 10) % 97 === 1;
}

// ICAO 9303 MRZ check-digit weighting (7-3-1 repeating). '<' = 0, digits as-is,
// letters A-Z = 10-35. Returns null (rather than throwing) on any character
// outside that set so callers can treat a bad line as "can't validate" instead
// of a hard error.
function rdxMrzCharVal(ch) {
  if (ch === '<') return 0;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  return null;
}
function rdxMrzCheckDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const v = rdxMrzCharVal(str[i]);
    if (v === null) return null;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}
// Validates a TD3 (passport, 44-char) MRZ second line: doc-number check digit,
// birth-date check digit, expiry-date check digit, and the composite check
// digit over all three fields plus the optional personal-number field. Not
// every passport fills in every optional check digit correctly in practice,
// so this scores how many of the 4 checks pass rather than requiring all of
// them — same "graduated confidence" approach as the VID/Aadhaar keyword
// fallbacks above.
function rdxMrzValidateTD3(line) {
  if (line.length !== 44) return { checks: 0, passed: 0 };
  const cd = s => { const v = rdxMrzCheckDigit(s); return v === null ? null : String(v); };
  const passportNum = line.slice(0, 9), passCheck = line[9];
  const birth = line.slice(13, 19), birthCheck = line[19];
  const expiry = line.slice(21, 27), expiryCheck = line[27];
  const personal = line.slice(28, 42), personalCheck = line[42];
  const composite = line[43];
  let passed = 0;
  if (cd(passportNum) === passCheck) passed++;
  if (cd(birth) === birthCheck) passed++;
  if (cd(expiry) === expiryCheck) passed++;
  const compositeStr = passportNum + passCheck + birth + birthCheck + expiry + expiryCheck + personal + personalCheck;
  if (cd(compositeStr) === composite) passed++;
  return { checks: 4, passed };
}

// China resident ID (GB 11643-1999) — 17 digits + 1 check char (digit or 'X'),
// weighted mod-11 with a fixed remainder->char lookup table.
const RDX_CHINA_ID_WEIGHTS = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
const RDX_CHINA_ID_CHECKMAP = ['1','0','X','9','8','7','6','5','4','3','2'];
function rdxChinaIdCheck(id) {
  if (!/^\d{17}[0-9Xx]$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (id.charCodeAt(i) - 48) * RDX_CHINA_ID_WEIGHTS[i];
  return RDX_CHINA_ID_CHECKMAP[sum % 11] === id[17].toUpperCase();
}

/* ---------------------------------------------------------------------
   Line/word geometry helpers (map regex char offsets -> OCR word boxes)
   --------------------------------------------------------------------- */
function rdxLineWordOffsets(line) {
  const words = (line.words || []);
  // OCR sometimes splits a single word into two adjacent word-boxes with
  // almost no gap between them (e.g. "Kalpesh" -> "Kalpe" + "sh"). Blindly
  // inserting a space between every word-box makes the reconstructed line
  // text diverge from what's actually printed, which then misaligns every
  // regex built on top of it (name/address captures land mid-word and get
  // truncated). Estimate a per-line "real space" threshold from the line's
  // own font size and only insert a space when the gap looks like an actual
  // word gap rather than a fragment split.
  const heights = words.map(w => w.bbox.y1 - w.bbox.y0).filter(h => h > 0);
  const medianH = heights.length ? heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 12;
  const touchThreshold = medianH * 0.18;

  let cursor = 0, text = '';
  const offsets = [];
  words.forEach((w, i) => {
    if (i > 0) {
      const gap = w.bbox.x0 - words[i - 1].bbox.x1;
      if (gap > touchThreshold) { text += ' '; cursor += 1; }
      // else: treat as a fragment continuing the previous word — no space.
    }
    const start = cursor;
    text += w.text;
    cursor += w.text.length;
    offsets.push({ start, end: cursor, word: w });
  });
  return { text, offsets };
}
function rdxWordsForRange(offsets, start, end) {
  return offsets.filter(o => o.end > start && o.start < end).map(o => o.word);
}
function rdxUnionBBox(words) {
  if (!words.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  words.forEach(w => {
    x0 = Math.min(x0, w.bbox.x0); y0 = Math.min(y0, w.bbox.y0);
    x1 = Math.max(x1, w.bbox.x1); y1 = Math.max(y1, w.bbox.y1);
  });
  return { x0, y0, x1, y1 };
}
function rdxMakeDetection(category, text, bbox, page, confidence) {
  if (!bbox) return null;
  // OCR word-boxes are frequently a few px tighter than the glyph actually
  // printed on the card — most visibly on the LAST word of a multi-group
  // number (e.g. the trailing "0433" of a VID), whose box can end a hair
  // before the ink does. Left unpadded, that leaves a sliver of the real
  // digits sitting just outside the drawn rectangle — i.e. NOT redacted.
  // Pad every box a little relative to its own height so this applies
  // uniformly whether the source photo is small or huge, and cheaply covers
  // for antialiasing/threshold noise on all four edges, not just the right.
  const h = Math.max(1, bbox.y1 - bbox.y0);
  const padX = h * 0.22, padY = h * 0.16;
  return {
    id: 'd' + (rdxState.nextId++), category, text: (text || '').trim(),
    page, confidence, selected: true, manual: false,
    x0: bbox.x0 - padX, y0: bbox.y0 - padY, x1: bbox.x1 + padX, y1: bbox.y1 + padY
  };
}

/* ---------------------------------------------------------------------
   Detection: keyword-labeled fields (name / address / signature) plus
   format-validated + checksum-validated ID / bank / license numbers.
   --------------------------------------------------------------------- */
// A "name value" is a short run of letter-only tokens (allowing apostrophes,
// hyphens, and initials like "K."). Capping it here — rather than the old
// "grab everything after the label" (.+) — is what stops it at the first
// comma/digit/slash, so an address that follows on the same OCR line (e.g.
// "S/O Kalpesh Kanaiyalal Pathak, G/202 ...") no longer bleeds into the name.
const RDX_NAME_TOKENS = "[A-Za-z][A-Za-z.'\\-]*(?:\\s+[A-Za-z][A-Za-z.'\\-]*){0,5}";
const RDX_KW_NAME = new RegExp("\\b(?:full\\s*name|applicant\\s*name|account\\s*holder(?:'s)?\\s*name|holder\\s*name|customer\\s*name|father'?s?\\s*name|mother'?s?\\s*name|s\\/o|d\\/o|w\\/o|name)\\s*[:\\-]?\\s*(" + RDX_NAME_TOKENS + ")", "i");
// Used to trim a next-line value (from the *_BARE branch below) down to just
// the leading name tokens too, in case that line also runs into an address.
const RDX_NAME_VALUE = new RegExp("(" + RDX_NAME_TOKENS + ")");
const RDX_KW_ADDRESS = /\b(?:residential\s*address|permanent\s*address|correspondence\s*address|residing\s*at|address)\s*[:\-]?\s*(.+)/i;
// Bare label with nothing after it on the same OCR line (e.g. "Address:" where
// the actual value is on the next line). Used to pull the value from the
// following line instead of silently dropping the detection.
// No end-of-line anchor here on purpose. Real-world scans routinely OCR a
// little background noise (a security watermark pattern, a faint guilloche
// line) onto the tail of the very line carrying the label — e.g. a genuine
// "Name" label coming back as "Name 2 BOR." — which used to break a
// same-line-only match and silently drop the whole detection. These checks
// only run once the stricter inline-value regex above has already failed to
// find a usable value on this line, so just confirming the label is present
// (anywhere on the line) before falling back to the next line is enough.
const RDX_KW_NAME_BARE = /\b(?:full\s*name|applicant\s*name|account\s*holder(?:'s)?\s*name|holder\s*name|customer\s*name|father'?s?\s*name|mother'?s?\s*name|name)\b/i;
const RDX_KW_ADDRESS_BARE = /\b(?:residential\s*address|permanent\s*address|correspondence\s*address|residing\s*at|address)\b/i;
const RDX_KW_SIGNATURE = /\b(?:signature|sign(?:ed)?\s*(?:here|by)?)\b/i;
// Date of birth — same "label on its own line, value below it" situation as
// name/address (very common on Indian PAN cards: "Date of Birth" prints on
// one OCR line, the DD/MM/YYYY value on the line directly under it). Split
// into a bare-label test and a standalone value pattern so a next-line
// fallback can be added, mirroring RDX_KW_NAME_BARE/RDX_KW_ADDRESS_BARE.
const RDX_KW_DOB_BARE = /\b(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|born\s*on|birth\s*date)\b/i;
const RDX_DOB_VALUE = /(\d{1,2}[\/\-. ]\d{1,2}[\/\-. ]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/;
function rdxDobFromNextLine(nextLine) {
  if (!nextLine || !nextLine.words || !nextLine.words.length) return null;
  const { text: nextText, offsets: nextOffsets } = rdxLineWordOffsets(nextLine);
  const dv = RDX_DOB_VALUE.exec(nextText);
  if (!dv) return null;
  const words = rdxWordsForRange(nextOffsets, dv.index, dv.index + dv[0].length);
  return { text: dv[0], bbox: rdxUnionBBox(words) };
}

// A bare label (e.g. "Name:") needs its value from whichever line is
// actually positioned just below it on the page — NOT whichever line
// Tesseract happens to list next in ocrData.lines. Tesseract's line order
// follows its own internal layout/reading-order analysis, which on a
// multi-column source (a photo block and a QR/hologram block sitting next
// to a text column, as on most ID cards) can list a line from a totally
// different part of the image right after the label line. Searching by
// actual geometry instead of array position is what keeps the value from
// landing on unrelated OCR noise elsewhere on the page.
function rdxNearestLineBelow(lines, line) {
  if (!line.bbox) return null;
  const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
  let best = null, bestDist = Infinity;
  for (const cand of lines) {
    if (cand === line || !cand.bbox) continue;
    // Must actually sit below the label (small negative tolerance for OCR
    // line boxes that overlap slightly at the seam).
    if (cand.bbox.y0 < line.bbox.y0 + lineH * 0.4) continue;
    // Must be a plausible "next line down", not several lines away or in an
    // unrelated block: within a handful of line-heights vertically...
    const vGap = cand.bbox.y0 - line.bbox.y1;
    if (vGap > lineH * 3) continue;
    // ...and starting reasonably close to the label horizontally, so a
    // same-row block in a different column doesn't get picked over the
    // real value line just because it's vertically close.
    const xGap = Math.abs(cand.bbox.x0 - line.bbox.x0);
    if (xGap > lineH * 10) continue;
    const dist = vGap * vGap + xGap * xGap;
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return best;
}

// True only if the value words sit close enough to the label words to
// plausibly be "the rest of the same visual line" rather than unrelated
// text that Tesseract happened to merge into the same reported line object
// (which is exactly what produces a name/address value box landing on a
// totally different part of the page, e.g. a QR/hologram block).
function rdxValueNearLabel(labelWords, valueWords, lineH) {
  if (!labelWords.length || !valueWords.length) return true;
  const gap = valueWords[0].bbox.x0 - labelWords[labelWords.length - 1].bbox.x1;
  return gap < lineH * 8 && gap > -lineH * 2;
}

// Shared "grab the value from the line below" logic used both when a label
// has nothing after it on its own line (bare label) and as a fallback when
// a same-line match turns out to be implausibly far from its label (see
// rdxValueNearLabel above).
// A short OCR fragment ("ss", "x.", a stray punctuation run) is not a
// plausible person name — it's almost always noise from a misread glyph
// (regional-script or otherwise) that happened to land in the search
// geometry. Require enough real letters, and at least one letter-token that
// actually looks word-shaped, before we're willing to box + label it.
function rdxLooksLikeName(s) {
  const t = (s || '').trim();
  if (t.length < 3) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 3) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  return true;
}
// Same idea as rdxLooksLikeName but looser — addresses legitimately contain
// numbers (house/flat numbers, PIN codes), so this only screens out lines
// that are ALL noise (pure symbol/digit runs with no real word in them).
function rdxLooksLikeAddress(s) {
  const t = (s || '').trim();
  if (t.length < 3) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  return true;
}
function rdxNameFromNextLine(nextLine) {
  if (!nextLine || !nextLine.words || !nextLine.words.length) return null;
  const { text: nextText, offsets: nextOffsets } = rdxLineWordOffsets(nextLine);
  const nv = RDX_NAME_VALUE.exec(nextText);
  const nameVal = nv ? nv[1] : nextText.trim();
  if (!rdxLooksLikeName(nameVal)) return null;
  const valStart = nv ? nv.index : 0;
  const words = rdxWordsForRange(nextOffsets, valStart, valStart + nameVal.length);
  return { text: nameVal, bbox: rdxUnionBBox(words) };
}

// Samples a candidate rectangle on the actual page canvas and looks for a
// handwritten stroke inside it. Unlike OCR text, ink has no bounding box
// Tesseract can hand us, so this measures pixel darkness directly instead of
// guessing a fixed offset from the caption.
function rdxSampleInkBBox(canvas, region) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  const rx0 = Math.max(0, Math.floor(region.x0));
  const ry0 = Math.max(0, Math.floor(region.y0));
  const rx1 = Math.min(canvas.width, Math.ceil(region.x1));
  const ry1 = Math.min(canvas.height, Math.ceil(region.y1));
  const rw = rx1 - rx0, rh = ry1 - ry0;
  if (rw < 4 || rh < 4) return null;
  let imgData;
  try {
    imgData = canvas.getContext('2d').getImageData(rx0, ry0, rw, rh);
  } catch (e) {
    return null; // e.g. a tainted/cross-origin canvas — fall back to the guessed box upstream
  }
  const d = imgData.data;
  const gray = new Uint8ClampedArray(rw * rh);
  let min = 255, max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  // Threshold relative to this region's OWN contrast range, not one fixed
  // absolute value — the same reasoning as the OCR contrast stretch: a dim
  // photo and a bright scan should both be judged against their own paper
  // brightness rather than a hardcoded "dark" cutoff.
  const threshold = min + range * 0.55;
  let minX = rw, minY = rh, maxX = -1, maxY = -1, inkCount = 0;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (gray[y * rw + x] < threshold) {
        inkCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const density = inkCount / (rw * rh);
  // Too little ink → the region is genuinely blank, nothing was signed here.
  // Too much ink → this is a solid printed block (a photo, a QR code, a
  // colored panel), not a handwritten stroke, since pen ink is sparse and
  // irregular rather than a filled rectangle.
  if (inkCount < 12 || density < 0.004 || density > 0.55) return null;
  return { bbox: { x0: rx0 + minX, y0: ry0 + minY, x1: rx0 + maxX + 1, y1: ry0 + maxY + 1 }, density };
}

function rdxDetectFromLine(line, pageIndex, out, nextLine, pageContext, pageCanvas) {
  const { text, offsets } = rdxLineWordOffsets(line);
  const trimmed = text.trim();
  if (!trimmed) return;
  const lineH = line.bbox ? Math.max(1, line.bbox.y1 - line.bbox.y0) : 20;

  let m;
  if ((m = RDX_KW_NAME.exec(text)) && m[1] && rdxLooksLikeName(m[1])) {
    const valStart = m.index + m[0].length - m[1].length;
    const words = rdxWordsForRange(offsets, valStart, valStart + m[1].length);
    const labelWords = rdxWordsForRange(offsets, 0, valStart);
    if (rdxValueNearLabel(labelWords, words, lineH)) {
      const d = rdxMakeDetection('name', m[1], rdxUnionBBox(words), pageIndex, 0.6);
      if (d) out.push(d);
    } else {
      // The regex matched, but its "value" sits far away from the label —
      // Tesseract merged unrelated text into this line. Use the real line
      // below instead of boxing that unrelated text.
      const nv = rdxNameFromNextLine(nextLine);
      if (nv) { const d = rdxMakeDetection('name', nv.text, nv.bbox, pageIndex, 0.5); if (d) out.push(d); }
    }
  } else if (RDX_KW_NAME_BARE.test(trimmed) && nextLine) {
    // Label with nothing after it on this line (e.g. "Name:") — the value is
    // likely the next OCR line, so grab that instead of losing the detection.
    const nv = rdxNameFromNextLine(nextLine);
    if (nv) { const d = rdxMakeDetection('name', nv.text, nv.bbox, pageIndex, 0.55); if (d) out.push(d); }
  }
  if ((m = RDX_KW_ADDRESS.exec(text)) && m[1] && rdxLooksLikeAddress(m[1])) {
    const valStart = m.index + m[0].length - m[1].length;
    const words = rdxWordsForRange(offsets, valStart, text.length);
    const labelWords = rdxWordsForRange(offsets, 0, valStart);
    if (rdxValueNearLabel(labelWords, words, lineH)) {
      const d = rdxMakeDetection('address', m[1], rdxUnionBBox(words), pageIndex, 0.6);
      if (d) out.push(d);
    } else if (nextLine && nextLine.words && nextLine.words.length) {
      const { text: nextText, offsets: nextOffsets } = rdxLineWordOffsets(nextLine);
      if (rdxLooksLikeAddress(nextText)) {
        const w2 = rdxWordsForRange(nextOffsets, 0, nextText.length);
        const d = rdxMakeDetection('address', nextText, rdxUnionBBox(w2), pageIndex, 0.5);
        if (d) out.push(d);
      }
    }
  } else if (RDX_KW_ADDRESS_BARE.test(trimmed) && nextLine && nextLine.words && nextLine.words.length) {
    const { text: nextText, offsets: nextOffsets } = rdxLineWordOffsets(nextLine);
    if (rdxLooksLikeAddress(nextText)) {
      const words = rdxWordsForRange(nextOffsets, 0, nextText.length);
      const d = rdxMakeDetection('address', nextText, rdxUnionBBox(words), pageIndex, 0.55);
      if (d) out.push(d);
    }
  }
  const sigMatch = RDX_KW_SIGNATURE.exec(text);
  if (sigMatch && line.words && line.words.length) {
    const lastWord = line.words[line.words.length - 1];
    // Scale off the matched word's OWN box, not the line's — a "line" bbox
    // can be inflated when Tesseract merges unrelated text into it (the same
    // issue behind the name/address guard above), which previously produced
    // a wildly oversized signature box covering most of the card.
    const wordH = Math.max(1, lastWord.bbox.y1 - lastWord.bbox.y0);
    const guessedBbox = {
      x0: lastWord.bbox.x0 - wordH * 1.5,
      y0: lastWord.bbox.y0 - wordH * 3, // reach upward — many ID cards draw the signature above its caption, not beside it
      x1: lastWord.bbox.x1 + wordH * 4, // still reach right, for "Signature: ____" style form fields
      y1: lastWord.bbox.y1 + wordH * 1
    };
    // Anchor the ink search on the CAPTION KEYWORD'S OWN word span, not the
    // full OCR line — the line bbox can be stretched wide by unrelated text
    // Tesseract merged onto the same line (e.g. a QR block or a neighboring
    // field), which previously widened the search window enough to pick up
    // dark pixels from that unrelated content and mistake them for ink.
    const capWords = rdxWordsForRange(offsets, sigMatch.index, sigMatch.index + sigMatch[0].length);
    const capBox = rdxUnionBBox(capWords.length ? capWords : line.words);
    // Ink strokes aren't recognizable text, so Tesseract can't hand us their
    // position the way it does for names/numbers — the old code just guessed
    // a fixed offset from the caption. Instead of guessing, actually look at
    // the pixels: sample the two places a signature typically sits relative
    // to its caption (directly above it, or beside it on the same line) and
    // see which one really contains ink, then crop tightly to that ink.
    let bbox = null, confidence = 0.5;
    if (pageCanvas && capBox) {
      const lineH = Math.max(1, capBox.y1 - capBox.y0);
      const capSpan = capBox.x1 - capBox.x0;
      const above = rdxSampleInkBBox(pageCanvas, {
        x0: capBox.x0 - lineH * 1, x1: capBox.x0 + capSpan + lineH * 1,
        y0: capBox.y0 - lineH * 5, y1: capBox.y0 - lineH * 0.2
      });
      const beside = rdxSampleInkBBox(pageCanvas, {
        x0: capBox.x1 + lineH * 0.3, x1: capBox.x1 + lineH * 7,
        y0: capBox.y0 - lineH * 0.6, y1: capBox.y1 + lineH * 0.6
      });
      // Prefer whichever side actually has ink; "above" wins a tie since
      // that's the far more common layout on ID cards (signature block
      // stacked over its printed caption).
      const picked = above || beside;
      if (picked) {
        const pW = picked.bbox.x1 - picked.bbox.x0, pH = picked.bbox.y1 - picked.bbox.y0;
        // Sanity cap: a real signature stroke is compact relative to its own
        // caption, not a broad swath of the card. Rejects the case where dark
        // background (a photo, the QR pattern, printed text) inside the
        // search window got mistaken for ink and produced an oversized box —
        // falls through to the tighter guessed box instead.
        if (pW < lineH * 12 && pH < lineH * 8) {
          const padX = lineH * 0.5, padY = lineH * 0.4;
          bbox = {
            x0: picked.bbox.x0 - padX, y0: picked.bbox.y0 - padY,
            x1: picked.bbox.x1 + padX, y1: picked.bbox.y1 + padY
          };
          confidence = 0.8; // real ink found, not a blind guess
        }
      }
    }
    if (!bbox) bbox = guessedBbox; // no canvas, no ink found, or ink region failed the sanity cap — keep the tighter fallback so the item still surfaces for manual adjustment
    const d = rdxMakeDetection('signature', '(signature area — adjust the box to fit)', bbox, pageIndex, confidence);
    if (d) out.push(d);
  }

  // Bare "Date of Birth" label with no date on the same OCR line — the value
  // is the line below it (the reDob inline pattern in rdxScanNumericPatterns
  // below already covers the same-line case, so this only fires when that
  // won't find anything).
  if (RDX_KW_DOB_BARE.test(trimmed) && !RDX_DOB_VALUE.test(trimmed) && nextLine) {
    const dv = rdxDobFromNextLine(nextLine);
    if (dv) { const d = rdxMakeDetection('dob', dv.text, dv.bbox, pageIndex, 0.6); if (d) out.push(d); }
  }

  rdxScanPanFromWords(line, pageIndex, out);
  rdxScanNumericPatterns(text, offsets, pageIndex, out, pageContext);
}

function rdxScanNumericPatterns(text, offsets, pageIndex, out, pageContext) {
  const push = (cat, matchText, index, conf) => {
    const words = rdxWordsForRange(offsets, index, index + matchText.length);
    const d = rdxMakeDetection(cat, matchText, rdxUnionBBox(words), pageIndex, conf);
    if (d) out.push(d);
  };

  let m;
  // VID (India) — 16 digits in 4-4-4-4 groups, Verhoeff checksum. Must be
  // checked BEFORE the 12-digit Aadhaar pattern: a naive Aadhaar-only scan
  // matches just the first 3 groups of a 16-digit VID and leaves the final
  // 4-digit group completely unmatched (nothing left to match against),
  // silently un-redacted rather than merely low-confidence.
  const reVid = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
  const vidSpans = [];
  // NOTE: this used to also require onUidaiDoc (seeing "aadhaar"/"uidai" as
  // plain text elsewhere on the page) before flagging a checksum-failed
  // match. That heading is printed in a low-contrast gradient font that OCR
  // very often garbles, so that gate was silently dropping VIDs/Aadhaar
  // numbers on a large share of real photos — the number looked exactly
  // right (correct digit-group shape) and still never got flagged. A
  // digit-group shape match is already specific enough on its own; the
  // checksum only decides confidence, not whether it gets shown at all.
  const onUidaiDoc = !!(pageContext && /aadhaar|aadhar|uidai|unique\s+identification\s+authority/i.test(pageContext));
  while ((m = reVid.exec(text))) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length === 16) {
      if (rdxVerhoeffCheck(digits)) {
        push('govid', m[0], m.index, 0.95);
        vidSpans.push([m.index, m.index + m[0].length]);
      } else {
        // Checksum failed — most often a single misread digit from a worn/
        // angled photo rather than this genuinely being some unrelated
        // 16-digit number. Confidence bumps up a bit further if the page
        // does also look like a UIDAI document, but it's flagged either way.
        push('govid', m[0], m.index, onUidaiDoc ? 0.55 : 0.4);
        vidSpans.push([m.index, m.index + m[0].length]);
      }
    }
  }
  // Keyword-anchored fallback: OCR digit misreads routinely break the
  // Verhoeff checksum above. Rather than silently dropping a labeled VID,
  // still flag it (lower confidence, user can verify) so it isn't missed.
  const reVidKw = /\bVID\s*[:\-]?\s*(\d[\d ]{14,19}\d)\b/gi;
  while ((m = reVidKw.exec(text))) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length === 16) {
      const start = m.index + m[0].lastIndexOf(m[1]);
      if (!vidSpans.some(([s, e]) => start >= s && start + m[1].length <= e)) {
        push('govid', m[1], start, 0.8);
        vidSpans.push([start, start + m[1].length]);
      }
    }
  }

  // Aadhaar (India) — 12 digits in 4-4-4 groups, Verhoeff checksum. Skip any
  // 12-digit span that's already covered by a matched 16-digit VID above,
  // so a VID doesn't also get a partial, redundant Aadhaar-shaped box.
  const reAadhaar = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
  while ((m = reAadhaar.exec(text))) {
    const span = [m.index, m.index + m[0].length];
    if (vidSpans.some(([s, e]) => span[0] >= s && span[1] <= e)) continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length !== 12) continue;
    if (rdxVerhoeffCheck(digits)) push('govid', m[0], m.index, 0.95);
    else push('govid', m[0], m.index, onUidaiDoc ? 0.55 : 0.4); // see VID comment above — flagged regardless, confidence just reflects context
  }
  // Keyword-anchored Aadhaar fallback for the same reason as VID above.
  const reAadhaarKw = /\b(?:aadhaar|aadhar|uidai?)\s*(?:no\.?|number)?\s*[:\-]?\s*(\d[\d ]{10,13}\d)\b/gi;
  while ((m = reAadhaarKw.exec(text))) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length === 12) {
      const start = m.index + m[0].lastIndexOf(m[1]);
      if (!vidSpans.some(([s, e]) => start >= s && start + m[1].length <= e)) push('govid', m[1], start, 0.75);
    }
  }
  // PAN / Permanent Account Number (India) — 10-char alphanumeric. There's no
  // public checksum digit, but the 4th character is structurally constrained
  // to a fixed set of holder-type codes (P=Individual, C=Company, H=HUF,
  // A=AOP, B=BOI, G=Government, J=Artificial Judicial Person, L=Local
  // Authority, F=Firm/LLP, T=Trust), so requiring it cuts down on matching
  // arbitrary 5-letter+4-digit+1-letter text that isn't actually a PAN.
  const rePan = /\b[A-Z]{3}[PCHABGJLFT][A-Z]\d{4}[A-Z]\b/g;
  const panSpans = [];
  while ((m = rePan.exec(text))) {
    push('govid', m[0], m.index, 0.9);
    panSpans.push([m.index, m.index + m[0].length]);
  }
  // Loosened fallback: same 10-char shape (5 letters, 4 digits, 1 letter)
  // but WITHOUT requiring the 4th letter to be a valid holder-type code.
  // The strict regex above is a hard AND on that character, so a single
  // OCR misread there (fairly common — codes like P/B/F/T are easy to
  // confuse with visually similar letters) makes the whole match fail
  // silently rather than just lowering confidence. Lower confidence here
  // instead of dropping it, and skip anything the strict regex already caught.
  const rePanLoose = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
  while ((m = rePanLoose.exec(text))) {
    const span = [m.index, m.index + m[0].length];
    if (panSpans.some(([s, e]) => span[0] >= s && span[1] <= e)) continue;
    push('govid', m[0], m.index, 0.5);
    panSpans.push(span);
  }
  // Keyword-anchored fallback: same rationale as the VID/Aadhaar fallbacks —
  // an OCR misread can knock the 4th character out of the valid-code set
  // above, and a labeled "PAN:" value shouldn't be silently dropped just
  // because of that.
  const rePanKw = /\b(?:pan(?:\s*card)?(?:\s*no\.?|\s*number)?|permanent\s*account\s*number)\s*[:\-]?\s*([A-Z]{5}[0-9]{4}[A-Z])\b/gi;
  while ((m = rePanKw.exec(text))) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    if (!panSpans.some(([s, e]) => start >= s && start + m[1].length <= e)) push('govid', m[1], start, 0.75);
  }
  // OCR-confusion-tolerant fallback: the strict/loose patterns above both
  // require a literal \d{4} 4-digit block. Tesseract routinely misreads ONE
  // of those digits as a visually similar letter — 0/O, 1/I or l, 5/S, 8/B,
  // 2/Z — which breaks \d{4} entirely and silently drops the whole PAN
  // rather than just lowering confidence, since there's nothing left to
  // match against. Accept those confusable letters in the digit block too,
  // but only fire when at least one of them is actually present (a clean
  // \d{4} run is already handled above), so this doesn't duplicate matches.
  const rePanOcrTolerant = /\b[A-Z]{5}[0-9OoIlSsBbZz]{4}[A-Z]\b/g;
  while ((m = rePanOcrTolerant.exec(text))) {
    const span = [m.index, m.index + m[0].length];
    if (panSpans.some(([s, e]) => span[0] >= s && span[1] <= e)) continue;
    const digitPart = m[0].slice(5, 9);
    if (/[OoIlSsBbZz]/.test(digitPart)) { push('govid', m[0], m.index, 0.55); panSpans.push(span); }
  }

  // US SSN
  const reSsn = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
  while ((m = reSsn.exec(text))) push('govid', m[0], m.index, 0.85);

  // IBAN — mod-97 checksum
  const reIban = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
  while ((m = reIban.exec(text))) { if (rdxIbanCheck(m[0])) push('bank', m[0], m.index, 0.95); }

  // Card number — Luhn checksum
  const reCard = /\b(?:\d[ -]?){13,19}\b/g;
  while ((m = reCard.exec(text))) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && rdxLuhnCheck(digits)) push('bank', m[0], m.index, 0.9);
  }

  // Bank account number — keyword context (no universal checksum)
  const reAcct = /(?:a\/c\s*(?:no\.?|number)?|account\s*(?:no\.?|number)|acct\s*no\.?|bank\s*account)\s*[:\-]?\s*([0-9][0-9 \-]{6,20})/gi;
  while ((m = reAcct.exec(text))) push('bank', m[1], m.index + m[0].lastIndexOf(m[1]), 0.72);

  // Driving license — keyword context, plus a couple of concrete country formats
  const reDlKw = /(?:driving\s*licen[cs]e|dl\s*no\.?|licen[cs]e\s*(?:no\.?|number))\s*[:\-]?\s*([A-Z0-9][A-Z0-9 \-\/]{5,20})/gi;
  while ((m = reDlKw.exec(text))) push('license', m[1], m.index + m[0].lastIndexOf(m[1]), 0.7);
  const reDlIN = /\b[A-Z]{2}[ -]?\d{2}[ -]?\d{4,11}\b/g; // India-style DL, loose
  if (/licen[cs]e/i.test(text)) { while ((m = reDlIN.exec(text))) push('license', m[0], m.index, 0.6); }

  // Passport — generic letter + 7-8 digit formats
  const rePassport = /\bpassport\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z][0-9]{6,8})\b/gi;
  while ((m = rePassport.exec(text))) push('govid', m[1], m.index + m[0].lastIndexOf(m[1]), 0.75);

  // Generic government ID keyword (voter ID / EPIC / national ID no.)
  const reGovKw = /(?:voter\s*id|epic\s*no\.?|national\s*id\s*(?:no\.?)?|govt\.?\s*id\s*(?:no\.?)?|identification\s*no\.?|id\s*no\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9 \-]{4,20})/gi;
  while ((m = reGovKw.exec(text))) push('govid', m[1], m.index + m[0].lastIndexOf(m[1]), 0.62);

  // UK National Insurance Number — fixed letter/digit format, no checksum
  // digit exists in the spec, so this is a format-only (lower-confidence)
  // match, same tier as the loose India DL pattern above.
  const reNino = /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][ -]?\d{2}[ -]?\d{2}[ -]?\d{2}[ -]?[A-D]\b/gi;
  while ((m = reNino.exec(text))) push('govid', m[0], m.index, 0.65);

  // Canada SIN — 9 digits, Luhn checksum (reuses the card-number checker).
  const reSin = /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g;
  while ((m = reSin.exec(text))) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length === 9 && rdxLuhnCheck(digits)) push('govid', m[0], m.index, 0.8);
  }

  // China resident ID — 18 chars (17 digits + check digit/'X'), mod-11 checksum.
  const reChinaId = /\b\d{17}[\dXx]\b/g;
  while ((m = reChinaId.exec(text))) { if (rdxChinaIdCheck(m[0])) push('govid', m[0], m.index, 0.9); }

  // MRZ (machine-readable zone) — the two/three fixed-width lines at the
  // bottom of passports and many national ID cards. OCR usually reads this
  // as one unbroken token since the real printing has no inter-field
  // spaces, so we look for a long run of MRZ's own alphabet (A-Z, 0-9, '<')
  // containing at least a couple of '<' filler characters (ordinary text
  // essentially never does) rather than requiring an exact 44/30 length,
  // since a stray OCR misread can clip a character off either end.
  const reMrz = /\b[A-Z0-9<]{28,44}\b/g;
  while ((m = reMrz.exec(text))) {
    const line = m[0];
    const fillerCount = (line.match(/</g) || []).length;
    if (fillerCount < 2) continue;
    let conf = 0.55; // format-only match (TD1 ID-card line, or a clipped TD3 line)
    if (line.length === 44) {
      const { checks, passed } = rdxMrzValidateTD3(line);
      if (checks) conf = 0.5 + 0.4 * (passed / checks); // up to 0.9 with all 4 checks passing
    }
    push('govid', line, m.index, conf);
  }

  // Email address — universal format, no locale dependence.
  const reEmail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  while ((m = reEmail.exec(text))) push('email', m[0], m.index, 0.95);

  // Phone numbers. Two tiers: an explicit "+countrycode" number is
  // unambiguous on its own; a bare local-format number is only flagged
  // when it sits next to a phone-ish keyword, since an un-anchored
  // 7-10 digit run is too easy to confuse with other numeric fields.
  const rePhoneIntl = /(?<![\d.])\+[1-9]\d{0,2}[ .\-]?\(?\d{2,4}\)?[ .\-]?\d{3,4}[ .\-]?\d{3,4}(?:[ .\-]?\d{2,4})?\b/g;
  const phoneSpans = [];
  while ((m = rePhoneIntl.exec(text))) {
    push('phone', m[0], m.index, 0.85);
    phoneSpans.push([m.index, m.index + m[0].length]);
  }
  const rePhoneKw = /\b(?:phone|mobile|cell|tel(?:ephone)?|contact\s*(?:no\.?|number)?|fax)\s*[:\-]?\s*(\+?[0-9][0-9 ().\-]{6,17}[0-9])/gi;
  while ((m = rePhoneKw.exec(text))) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    if (!phoneSpans.some(([s, e]) => start >= s && start + m[1].length <= e)) push('phone', m[1], start, 0.75);
  }

  // Date of birth — keyword-anchored only (an un-anchored date pattern would
  // false-positive on every issue/expiry date on a document), covering
  // DD/MM/YYYY, YYYY-MM-DD and "12 January 1990" style formats.
  const reDob = /\b(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|born\s*on|birth\s*date)\s*[:\-]?\s*(\d{1,2}[\/\-. ]\d{1,2}[\/\-. ]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/gi;
  while ((m = reDob.exec(text))) push('dob', m[1], m.index + m[0].lastIndexOf(m[1]), 0.8);
}

// Fallback PAN scan over the raw OCR word-boxes instead of the spaced line
// text. Tesseract sometimes segments a large, widely-kerned stylized PAN
// font into one "word" per character (or small cluster) rather than one
// word for the whole number — every regex above operates on the spaced
// line text and requires the 10 characters to sit in one contiguous,
// space-free run, so that kind of split silently drops the match entirely
// even though the digits/letters were all read correctly. Concatenating
// the raw word fragments (ignoring whatever spacing rdxLineWordOffsets
// decided on) and testing the plain shape pattern against that sidesteps
// the issue without needing to guess a better spacing threshold.
function rdxScanPanFromWords(line, pageIndex, out) {
  const words = (line.words || []);
  if (words.length < 2) return;
  const joined = words.map(w => w.text).join('');
  const re = /[A-Z]{5}\d{4}[A-Z]/g;
  let m;
  while ((m = re.exec(joined))) {
    let cursor = 0, startWord = -1, endWord = -1;
    for (let i = 0; i < words.length; i++) {
      const wlen = words[i].text.length;
      if (startWord === -1 && cursor + wlen > m.index) startWord = i;
      if (startWord !== -1 && cursor + wlen >= m.index + m[0].length) { endWord = i; break; }
      cursor += wlen;
    }
    if (startWord === -1 || endWord === -1) continue;
    const bbox = rdxUnionBBox(words.slice(startWord, endWord + 1));
    const d = rdxMakeDetection('govid', m[0], bbox, pageIndex, 0.65);
    if (d) out.push(d);
  }
}

function rdxIoU(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0), areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / (areaA + areaB - inter);
}
function rdxDedupe(dets) {
  const sorted = dets.slice().sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const d of sorted) {
    const overlaps = kept.some(k => k.page === d.page && rdxIoU(k, d) > 0.4);
    if (!overlaps) kept.push(d);
  }
  return kept;
}

/* ---------------------------------------------------------------------
   Photo/face region detection — heuristic, not OCR-based. A printed ID
   photo has a visual signature the rest of a document doesn't: continuous-
   tone color (skin/hair) rather than either flat printed-text background or
   the sharp binary noise of a QR/barcode block. Grids the page, scores each
   cell on colorfulness (chroma) while explicitly excluding QR-style
   near-binary edge density, then finds the best-scoring roughly-square
   contiguous block. This is a best-effort guess, not a real face detector —
   it always surfaces at moderate confidence so it's easy to nudge, resize,
   or delete like any other item if it's off.
   --------------------------------------------------------------------- */
function rdxDetectPhotoRegion(canvas, pageIndex) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  let imgData;
  try {
    imgData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) {
    return null; // tainted/cross-origin canvas
  }
  const d = imgData.data, W = canvas.width, H = canvas.height;
  const cell = Math.max(10, Math.round(Math.min(W, H) / 30));
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const score = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * cell, y0 = gy * cell;
      const x1 = Math.min(W, x0 + cell), y1 = Math.min(H, y0 + cell);
      let sumR = 0, sumG = 0, sumB = 0, n = 0, prevGray = null, edgeSum = 0, edgeN = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * W + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          sumR += r; sumG += g; sumB += b; n++;
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          if (prevGray !== null) { edgeSum += Math.abs(gray - prevGray); edgeN++; }
          prevGray = gray;
        }
        prevGray = null;
      }
      if (!n) continue;
      const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
      const chroma = Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB);
      const edgeDensity = edgeN ? edgeSum / edgeN : 0;
      let s = 0;
      // Real colorfulness (skin/hair), not flat printed ink or a pale card
      // background — but not so extreme it's a saturated logo/graphic block.
      if (chroma > 12 && chroma < 140) s += chroma;
      // Moderate local contrast reads as a photo's natural tonal variation.
      if (edgeDensity > 4 && edgeDensity < 55) s += edgeDensity * 0.5;
      // A QR/barcode block has near-constant, extremely high edge density
      // (sharp alternating black/white) — exclude it outright rather than
      // letting its high raw edge number masquerade as "photo texture".
      if (edgeDensity >= 70) s = 0;
      score[gy * cols + gx] = s;
    }
  }

  // Best contiguous roughly-square block of scoring cells, via a bounded
  // sliding-window search over plausible ID-photo sizes.
  const minCells = Math.max(2, Math.round(Math.min(cols, rows) * 0.12));
  const maxCells = Math.max(minCells + 1, Math.round(Math.min(cols, rows) * 0.4));
  let best = null, bestScore = 0;
  for (let h = minCells; h <= maxCells; h++) {
    for (let w = minCells; w <= maxCells; w++) {
      if (w / h > 1.6 || h / w > 1.6) continue; // photos are roughly square-ish, not a thin strip
      for (let gy = 0; gy + h <= rows; gy++) {
        for (let gx = 0; gx + w <= cols; gx++) {
          let sum = 0;
          for (let yy = gy; yy < gy + h; yy++) for (let xx = gx; xx < gx + w; xx++) sum += score[yy * cols + xx];
          const avg = sum / (w * h);
          if (avg > bestScore) { bestScore = avg; best = { gx, gy, w, h }; }
        }
      }
    }
  }
  if (!best || bestScore < 15) return null; // nothing confidently photo-like found — don't force a guess
  const bbox = {
    x0: best.gx * cell, y0: best.gy * cell,
    x1: Math.min(W, (best.gx + best.w) * cell), y1: Math.min(H, (best.gy + best.h) * cell)
  };
  return rdxMakeDetection('photo', '(photo/face area — adjust the box to fit)', bbox, pageIndex, 0.5);
}

/* ---------------------------------------------------------------------
   Document-type rules — a small registry, one entry per ID document that
   has a single fixed physical layout. Each entry owns:
     - id / label     : shown in scan toasts ("Recognized this as a ...")
     - match(pageContext) : how we tell this doc type apart from any other
     - zones[]         : the fixed-layout preset boxes for that type only
   This keeps each document type's rules independent and separately
   editable/removable — adding a new type (Passport, Voter ID, Driving
   Licence...) is one new registry entry, not a change to existing ones.
   The registry only supplies a FALLBACK safety net for zones the generic
   OCR-keyword / pixel-heuristic detectors (rdxDetectFromLine,
   rdxDetectPhotoRegion — shared across every document type) didn't
   confidently find; it never overrides a real detection.
   --------------------------------------------------------------------- */
const RDX_DOC_TYPES = [
  {
    id: 'pan',
    label: 'PAN card',
    // Matches printed headings that only appear on a genuine Indian PAN
    // card, in either English or the Devanagari heading — so this never
    // fires on an unrelated document just because it contains a 10-char
    // alphanumeric code shaped like a PAN.
    // Several English phrasings plus the two Devanagari headings a PAN card
    // prints ("आयकर विभाग" = Income Tax Department, "स्थायी लेखा संख्या" =
    // Permanent Account Number) — OCR sometimes only cleanly reads one
    // heading or the other depending on scan angle/lighting, so both scripts
    // and a couple of partial English phrasings are checked rather than
    // relying on a single exact string.
    match: pageContext => /income[\s-]*tax[\s-]*dep[ao]rtment|permanent\s*acc?ount\s*number|govt\.?\s*of\s*india|आयकर\s*विभाग|स्थायी\s*लेखा\s*संख्या/i.test(pageContext),
    // Fractions of the page canvas's own width/height (x0,y0)-(x1,y1), read
    // off a standard-orientation PAN card photo. Two 'name' zones because a
    // PAN always prints both the applicant's name and father's name in the
    // same two slots.
    zones: [
      { category: 'photo',     text: '(photo/face area — PAN template, adjust to fit)',           x0: 0.045, y0: 0.28, x1: 0.24, y1: 0.55 },
      { category: 'govid',     text: '(PAN number — PAN template, adjust to fit)',                 x0: 0.33,  y0: 0.37, x1: 0.62, y1: 0.47 },
      { category: 'name',      text: '(applicant name — PAN template, adjust to fit)',             x0: 0.045, y0: 0.56, x1: 0.46, y1: 0.645 },
      { category: 'name',      text: "(father's name — PAN template, adjust to fit)",              x0: 0.045, y0: 0.66, x1: 0.5,  y1: 0.745 },
      { category: 'signature', text: '(signature area — PAN template, adjust to fit)',             x0: 0.40,  y0: 0.76, x1: 0.51, y1: 0.88 },
      { category: 'dob',       text: '(date of birth — PAN template, adjust to fit)',              x0: 0.045, y0: 0.85, x1: 0.22, y1: 0.93 }
    ]
  },
  {
    id: 'aadhaar_back',
    label: 'Aadhaar card',
    // The BACK of an Aadhaar prints "Unique Identification Authority of
    // India" and a labeled "Address:" block — neither ever appears on the
    // front. Checked before the front rule below since it's the more
    // specific/exclusive signal of the two.
    // "uidai" also catches "uidai.gov.in" / "help@uidai.gov.in", which the
    // back always prints in its footer even when the rest of the scan is
    // too blurry for the full authority name. "पता" is the Hindi label for
    // "Address" that sits right next to (and sometimes OCRs more cleanly
    // than) the English "Address:" line, and "s/o|d/o|w/o|c/o" are the
    // relationship-prefix abbreviations that open the name line right above
    // the address block — all specific to the back layout among the ID
    // types this app recognizes.
    match: pageContext => /unique\s+identification\s+authority|uidai|\baddress\s*[:\-]|पता\s*[:\-]|\b[sdwc]\/o\b/i.test(pageContext),
    // Two 'name' zones: Aadhaar's back prints the holder's name twice —
    // once in the "S/O ..." line, once inside the English "Address:" block
    // — in the same two slots every time. Deliberately NOT boxing the rest
    // of the address (street/city/PIN): the generic RDX_KW_ADDRESS
    // detector already handles that as its own 'address' category, this
    // preset only backs up the name portion specifically, matching what
    // was marked. The QR code isn't a text field this template touches.
    zones: [
      { category: 'name',  text: "(father's name — Aadhaar back template, adjust to fit)",       x0: 0.142, y0: 0.328, x1: 0.312, y1: 0.360 },
      { category: 'name',  text: '(name in address block — Aadhaar back template, adjust to fit)', x0: 0.145, y0: 0.469, x1: 0.400, y1: 0.512 },
      { category: 'govid', text: '(Aadhaar number + VID — Aadhaar back template, adjust to fit)',  x0: 0.339, y0: 0.728, x1: 0.730, y1: 0.841 }
    ]
  },
  {
    id: 'aadhaar_front',
    label: 'Aadhaar card',
    // The FRONT of a real Aadhaar carries no "Aadhaar"/"UIDAI" text at all
    // — just a "Government of India" heading, which PAN also prints, so
    // that heading alone can't tell the two apart. What IS unique to the
    // Aadhaar front: a labeled "VID :" number, and/or a 12-digit number
    // whose checksum (Verhoeff) actually validates as an Aadhaar number —
    // reuses rdxVerhoeffCheck so this stays consistent with the generic
    // Aadhaar-number detector in rdxDetectFromLine.
    match: pageContext => {
      const ctx = pageContext || '';
      if (/\bvid\s*[:.\-]?\s*\d/i.test(ctx)) return true;
      if (/\b(male|female|transgender)\b/i.test(ctx)) return true;
      // Hindi gender words — the front prints gender in both scripts, and a
      // phone-camera OCR pass sometimes catches one script but not the
      // other depending on font rendering at that spot on the card.
      if (/पुरुष|महिला/.test(ctx)) return true;
      // A Govt-of-India heading together with a DOB/YoB label is unique to
      // the Aadhaar front among the ID types in this registry — PAN also
      // prints "DOB", but a real PAN's own stronger keywords (income tax
      // dept / permanent account number) already win the match earlier in
      // this registry's evaluation order, so by the time this rule runs the
      // page has already failed to look like a PAN.
      const hasGovtHeading = /govt\.?\s*of\s*india|government\s*of\s*india|भारत\s*सरकार/i.test(ctx);
      const hasDob = /\bdob\b|date\s*of\s*birth|year\s*of\s*birth|\byob\b|जन्म\s*तारीख|जन्म\s*वर्ष/i.test(ctx);
      if (hasGovtHeading && hasDob) return true;
      // Any 12-digit number grouped 4-4-4 is checked against the Verhoeff
      // checksum first (a confident match on its own); if that fails —
      // e.g. OCR misread a single digit, which is common on embossed/glare-y
      // cards — the grouping shape itself is still a strong signal, since
      // nothing else this app recognizes prints a bare number that way. This
      // is intentionally the last, broadest check in the whole registry.
      const digitMatches = ctx.match(/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g) || [];
      if (digitMatches.some(d => rdxVerhoeffCheck(d.replace(/\D/g, '')))) return true;
      return digitMatches.length > 0;
    },
    zones: [
      { category: 'photo',  text: '(photo/face area — Aadhaar front template, adjust to fit)',       x0: 0.134, y0: 0.254, x1: 0.319, y1: 0.593 },
      { category: 'name',   text: '(name — Aadhaar front template, adjust to fit)',                   x0: 0.334, y0: 0.245, x1: 0.597, y1: 0.339 },
      { category: 'dob',    text: '(date of birth — Aadhaar front template, adjust to fit)',           x0: 0.503, y0: 0.333, x1: 0.764, y1: 0.388 },
      { category: 'govid',  text: '(Aadhaar number + VID — Aadhaar front template, adjust to fit)',    x0: 0.331, y0: 0.710, x1: 0.698, y1: 0.832 }
    ]
  }
];

// Returns the first matching registry entry for this page, or null if the
// page's OCR text doesn't confirm any known document type — in which case
// no preset applies at all and detection stays purely generic (this is the
// implicit "Other" bucket: no hard-coded layout, just the shared
// keyword/regex/heuristic detectors already running on every document).
function rdxDetectDocType(pageContext) {
  if (!pageContext) return null;
  return RDX_DOC_TYPES.find(t => t.match(pageContext)) || null;
}

// Fallback used only when OCR text didn't confirm a known layout — a blurry
// scan, a tightly-cropped photo, or a test image, for instance. Many people
// simply name the file "aadhaar_1.jpg" / "pan card 3.png", so checking the
// filename lets a batch still group into folders even when content-based
// matching comes up empty. Never overrides a real content match — callers
// only reach for this when docTypeLabel is still unset.
function rdxDetectDocTypeFromFilename(fileName) {
  if (!fileName) return null;
  const n = String(fileName).toLowerCase();
  // Covers the correct spelling plus the common single-"a" misspelling
  // ("adhar"/"adhaar") people type when naming files, on top of "uidai".
  if (/aadhaar|aadhar|adhaar|adhar|uidai/.test(n)) {
    // Prefer the front/back hint when the filename actually has one (e.g.
    // "aadhaar_back.jpg", "aadhar-2.jpg") so the returned id lines up with
    // the registry entry it's standing in for; either way the label is the
    // same "Aadhaar card" folder.
    const type = /\bback\b/.test(n) ? 'aadhaar_back' : 'aadhaar_front';
    return { type, label: 'Aadhaar card' };
  }
  if (/\bpan[\s_-]?card\b|\bpan\b/.test(n)) return { type: 'pan', label: 'PAN card' };
  return null;
}

// True if an already-found detection covers a meaningful share of a preset
// zone — i.e. this zone doesn't need a fallback box. Normalized against
// whichever box is SMALLER, not always the (generous) preset zone — a real
// detection is often tighter than the preset box, so if it sits fully
// inside the preset zone, that overlap can still be a small fraction of the
// preset's own larger area, which would otherwise read as "not covered" and
// draw a redundant second box right on top of a perfectly good real one.
function rdxBoxCoversPreset(existing, preset, W, H) {
  const px0 = preset.x0 * W, py0 = preset.y0 * H, px1 = preset.x1 * W, py1 = preset.y1 * H;
  const ix0 = Math.max(existing.x0, px0), iy0 = Math.max(existing.y0, py0);
  const ix1 = Math.min(existing.x1, px1), iy1 = Math.min(existing.y1, py1);
  if (ix1 <= ix0 || iy1 <= iy0) return false;
  const interArea = (ix1 - ix0) * (iy1 - iy0);
  const presetArea = Math.max(1, (px1 - px0) * (py1 - py0));
  const existingArea = Math.max(1, (existing.x1 - existing.x0) * (existing.y1 - existing.y0));
  return (interArea / Math.min(presetArea, existingArea)) > 0.35;
}

// Returns fallback detections for any zone of the matched document type
// that nothing else on this page already covers. Only runs once the page's
// own OCR text has confirmed a known document type, and only in landscape
// orientation (a sideways scan would need real geometry we don't have here
// — better to skip the preset than draw boxes in the wrong place).
function rdxApplyDocPreset(existingDets, pageIndex, pageCanvas, pageContext) {
  if (!pageCanvas || !pageCanvas.width || !pageCanvas.height) return [];
  const docType = rdxDetectDocType(pageContext);
  if (!docType) return [];
  const W = pageCanvas.width, H = pageCanvas.height;
  if (W / H < 1.3) return []; // not landscape — skip rather than guess wrong

  const pageDets = existingDets.filter(d => d.page === pageIndex);
  const added = [];
  docType.zones.forEach(preset => {
    const covered = pageDets.some(d => d.category === preset.category && rdxBoxCoversPreset(d, preset, W, H)) ||
                    added.some(d => d.category === preset.category && rdxBoxCoversPreset(d, preset, W, H));
    if (covered) return;
    const bbox = { x0: preset.x0 * W, y0: preset.y0 * H, x1: preset.x1 * W, y1: preset.y1 * H };
    const d = rdxMakeDetection(preset.category, preset.text, bbox, pageIndex, 0.3);
    if (d) { d.presetFallback = true; d.docType = docType.id; d.docTypeLabel = docType.label; added.push(d); }
  });
  return added;
}

// docTypeOut (optional) is a plain object the caller can pass in to learn
// which known document type this page's OCR text matched — independent of
// whether any preset fallback boxes actually got added (they only fire in
// landscape orientation and only for zones not already covered). Grouping
// documents into "folders" by type relies on this being set reliably from
// content alone, not as a side-effect of drawing boxes. Only the FIRST page
// of a document to confirm a type wins ({docTypeOut.type} already set), so
// a multi-page doc doesn't flip type between pages.
function rdxDetectSensitiveInfo(ocrData, pageIndex, pageCanvas, docTypeOut) {
  const out = [];
  const lines = (ocrData.lines || []).filter(l => l.words && l.words.length);
  // Whole-page text, used for document-level context checks (e.g. "this is a
  // UIDAI document") that a single OCR line can't tell on its own — the
  // Aadhaar number and the "uidai.gov.in" heading it needs to be checked
  // against usually sit far apart on the card.
  const pageContext = lines.map(l => (l.text || rdxLineWordOffsets(l).text)).join(' ');
  lines.forEach((line, i) => rdxDetectFromLine(line, pageIndex, out, rdxNearestLineBelow(lines, line), pageContext, pageCanvas));
  const photo = rdxDetectPhotoRegion(pageCanvas, pageIndex);
  if (photo) out.push(photo);
  out.push(...rdxApplyDocPreset(out, pageIndex, pageCanvas, pageContext));
  if (docTypeOut && !docTypeOut.type) {
    const dt = rdxDetectDocType(pageContext);
    if (dt) { docTypeOut.type = dt.id; docTypeOut.label = dt.label; }
  }
  return out;
}

/* ---------------------------------------------------------------------
   Scan flow
   --------------------------------------------------------------------- */
// Runs OCR + detection over a given page list and returns deduped
// detections. Shared by the single-document scan and the batch "Scan All"
// action so both stay perfectly consistent.
// Returns { detections, docType, docTypeLabel } — docType/docTypeLabel are
// the first known document type (PAN card, Aadhaar card, ...) confirmed
// from any page's OCR text, or null if this document doesn't match any
// known type (it's still scanned normally either way, just ungrouped when
// the batch queue is later split into folders by type).
async function rdxScanPagesCore(pages, onProgress) {
  const all = [];
  const docTypeOut = {};
  for (let p = 0; p < pages.length; p++) {
    if (onProgress) onProgress(p, pages.length);
    const data = await rdxRunOCR(pages[p].canvas);
    const found = rdxDetectSensitiveInfo(data, p, pages[p].canvas, docTypeOut);
    all.push(...found);
  }
  return { detections: rdxDedupe(all), docType: docTypeOut.type || null, docTypeLabel: docTypeOut.label || null };
}

// One button for both cases: a lone document gets scanned on its own, a
// batch of several gets scanned all at once — the user never has to notice
// there are technically two code paths underneath.
function rdxScanSmart() {
  if (rdxState.docs.length > 1) rdxScanAllDocs();
  else rdxScanDocument();
}

async function rdxScanDocument() {
  if (!rdxState.pages.length || rdxState.scanning || rdxState.batchProcessing) return;
  rdxState.scanning = true;
  rdxState.detections = [];
  rdxShowScanProgress();
  const btn = document.getElementById('rdxScanBtn');
  if (btn) btn.disabled = true;
  try {
    const result = await rdxScanPagesCore(rdxState.pages, (p, total) => {
      rdxSetScanLabel(`Reading page ${p + 1} of ${total} (OCR)…`);
      rdxUpdateScanProgress(p / total);
    });
    rdxState.detections = result.detections;
    if (!result.docTypeLabel) {
      const fnGuess = rdxDetectDocTypeFromFilename(rdxState.fileName);
      if (fnGuess) { result.docType = fnGuess.type; result.docTypeLabel = fnGuess.label; }
    }
    rdxState.docType = result.docType;
    rdxState.docTypeLabel = result.docTypeLabel;
    if (rdxState.docs[rdxState.activeDoc]) {
      rdxState.docs[rdxState.activeDoc].docType = result.docType;
      rdxState.docs[rdxState.activeDoc].docTypeLabel = result.docTypeLabel;
    }
    rdxState.scanned = true;
    rdxHideScanProgress();
    rdxState.scanning = false;
    if (btn) btn.disabled = false;
    rdxRenderBoxes();
    rdxRenderSidebarList();
    rdxRenderThumbs();
    rdxRenderDocQueue();
    const presetDets = rdxState.detections.filter(d => d.presetFallback);
    if (presetDets.length) {
      const docLabel = presetDets[0].docTypeLabel || 'document';
      toast(`Recognized this as a ${docLabel} — filled in ${presetDets.length} field${presetDets.length !== 1 ? 's' : ''} using its standard layout. Review the estimated boxes and nudge any that don't line up.`, 'info');
    }
    rdxOpenReviewModal();
    rdxPersist();
  } catch (err) {
    console.warn('Redact scan error', err);
    rdxHideScanProgress();
    rdxState.scanning = false;
    if (btn) btn.disabled = false;
    toast('Scan failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
  }
}

function rdxShowScanProgress() {
  const card = document.getElementById('rdxScanProgress');
  if (card) card.style.display = 'block';
  const shimmer = document.getElementById('rdxCanvasShimmer');
  if (shimmer) shimmer.classList.add('active');
  rdxUpdateScanProgress(0.02);
}
function rdxHideScanProgress() {
  const card = document.getElementById('rdxScanProgress');
  if (card) card.style.display = 'none';
  const shimmer = document.getElementById('rdxCanvasShimmer');
  if (shimmer) shimmer.classList.remove('active');
}
function rdxSetScanLabel(label) {
  const el = document.getElementById('rdxScanProgressLabel');
  if (el) el.textContent = label;
  const shimmerLabel = document.getElementById('rdxCanvasShimmerLabel');
  if (shimmerLabel) shimmerLabel.textContent = label;
}
function rdxUpdateScanProgress(progress) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const fill = document.getElementById('rdxScanProgressFill');
  const pctEl = document.getElementById('rdxScanProgressPct');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
}

/* ---------------------------------------------------------------------
   Review modal — "We found X sensitive items. Redact them all?"
   --------------------------------------------------------------------- */
function rdxOpenReviewModal() {
  const total = rdxState.detections.length;
  if (!total) {
    toast('Scan complete — no sensitive info detected automatically. You can still add manual redaction boxes with "Add Box".', 'info');
    return;
  }
  rdxState.reviewMode = 'single';
  const cats = {};
  rdxState.detections.forEach(d => { cats[d.category] = (cats[d.category] || 0) + 1; });
  const titleEl = document.getElementById('rdxReviewTitle');
  if (titleEl) titleEl.textContent = `We found ${total} sensitive item${total !== 1 ? 's' : ''} in this document`;
  const subEl = document.querySelector('#rdxReviewModal .rdx-modal-sub');
  if (subEl) subEl.textContent = "Here's what was detected, grouped by type. Uncheck a type to leave it un-redacted, or open individual items to review first.";
  const breakdown = document.getElementById('rdxReviewBreakdown');
  if (breakdown) {
    breakdown.innerHTML = Object.keys(cats).map(c => {
      const allSel = rdxState.detections.filter(d => d.category === c).every(d => d.selected);
      return `<label class="rdx-modal-breakdown-row rdx-modal-breakdown-check">
        <input type="checkbox" ${allSel ? 'checked' : ''} onchange="rdxToggleCategory('${c}', this.checked)">
        <span class="rdx-dot rdx-dot-${c}"></span>${rdxCatLabel(c)}<span>${cats[c]}</span>
      </label>`;
    }).join('');
  }
  const backdrop = document.getElementById('rdxReviewModal');
  if (backdrop) backdrop.style.display = 'flex';
}
// Same modal, used after "Scan All" — covers every document in the batch at
// once so one tap on "Redact Them All" blacks out everything the scan found,
// instead of making the user open each document and redact it separately.
function rdxOpenBatchReviewModal(totalFound, catTotals, docCount) {
  rdxState.reviewMode = 'batch';
  const titleEl = document.getElementById('rdxReviewTitle');
  if (titleEl) titleEl.textContent = `We found ${totalFound} sensitive item${totalFound !== 1 ? 's' : ''} across ${docCount} document${docCount !== 1 ? 's' : ''}`;
  const subEl = document.querySelector('#rdxReviewModal .rdx-modal-sub');
  if (subEl) subEl.textContent = 'Uncheck a type to leave it un-redacted across the whole batch, or review each document individually first.';
  const breakdown = document.getElementById('rdxReviewBreakdown');
  if (breakdown) {
    breakdown.innerHTML = Object.keys(catTotals).map(c => {
      const allSel = rdxState.docs.every(doc => (doc.detections || []).filter(d => d.category === c).every(d => d.selected));
      return `<label class="rdx-modal-breakdown-row rdx-modal-breakdown-check">
        <input type="checkbox" ${allSel ? 'checked' : ''} onchange="rdxToggleCategoryAllDocs('${c}', this.checked)">
        <span class="rdx-dot rdx-dot-${c}"></span>${rdxCatLabel(c)}<span>${catTotals[c]}</span>
      </label>`;
    }).join('');
  }
  const backdrop = document.getElementById('rdxReviewModal');
  if (backdrop) backdrop.style.display = 'flex';
}
// Same as rdxToggleCategory but reaches into every document in the batch,
// not just the currently active one, since the batch review modal covers
// findings across the whole queue at once.
function rdxToggleCategoryAllDocs(cat, checked) {
  rdxState.docs.forEach(doc => {
    (doc.detections || []).filter(d => d.category === cat).forEach(d => { d.selected = checked; });
  });
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxPersist();
}
function rdxCloseReviewModal() {
  const backdrop = document.getElementById('rdxReviewModal');
  if (backdrop) backdrop.style.display = 'none';
}
function rdxReviewRedactAll() {
  rdxCloseReviewModal();
  if (rdxState.reviewMode === 'batch') {
    rdxRedactAllDocs();
    return;
  }
  rdxApplyRedactions();
}
function rdxReviewLetMeChoose() {
  rdxCloseReviewModal();
  if (rdxState.reviewMode === 'batch') {
    rdxRenderSidebarList();
    rdxRenderDocQueue();
    toast('Switch between documents in the batch strip to review each one\'s items, then hit "Redact All" whenever you\'re ready.', 'info');
    return;
  }
  rdxRenderBoxes();
  rdxRenderSidebarList();
  toast('Review the highlighted items on the right, uncheck anything you want to keep, then hit Apply Redactions.', 'info');
}

/* ---------------------------------------------------------------------
   Sidebar list of detected items
   --------------------------------------------------------------------- */
function rdxRenderSidebarList() {
  const root = document.getElementById('rdxSidebarList');
  if (!root) return;
  const order = ['name', 'dob', 'address', 'bank', 'govid', 'license', 'phone', 'email', 'signature', 'photo', 'other'];
  const counts = {};
  rdxState.detections.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
  const totalEl = document.getElementById('rdxTotalCount');
  if (totalEl) totalEl.textContent = rdxState.detections.length;

  const groups = order.filter(c => counts[c]).map(cat => {
    const items = rdxState.detections.filter(d => d.category === cat);
    const allSel = items.every(i => i.selected);
    return `<div class="rdx-cat-group">
      <div class="rdx-cat-header">
        <label class="rdx-cat-check">
          <input type="checkbox" ${allSel ? 'checked' : ''} onchange="rdxToggleCategory('${cat}', this.checked)">
          <span class="rdx-dot rdx-dot-${cat}"></span> ${rdxCatLabel(cat)}
          <span class="rdx-cat-count">${items.length}</span>
        </label>
      </div>
      ${items.map(it => `<div class="rdx-item" data-id="${it.id}">
        <input type="checkbox" ${it.selected ? 'checked' : ''} onchange="rdxToggleItem('${it.id}', this.checked)">
        <span class="rdx-item-text" title="${rdxEsc(it.text)}" onclick="rdxJumpToDetection('${it.id}')">${rdxEsc(it.text) || '(no preview)'}</span>
        <span class="rdx-item-conf">${Math.round(it.confidence * 100)}%</span>
      </div>`).join('')}
    </div>`;
  }).join('');

  root.innerHTML = groups || '<div class="rdx-empty-list">No sensitive info detected yet. Click "Scan for Sensitive Info" to begin.</div>';
}

function rdxToggleCategory(cat, checked) {
  rdxState.detections.filter(d => d.category === cat).forEach(d => { d.selected = checked; });
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxPersist();
}
function rdxToggleItem(id, checked) {
  const d = rdxState.detections.find(x => x.id === id);
  if (d) d.selected = checked;
  rdxRenderBoxes();
  rdxPersist();
}
function rdxJumpToDetection(id) {
  const d = rdxState.detections.find(x => x.id === id);
  if (!d) return;
  if (d.page !== rdxState.currentPage) { rdxState.currentPage = d.page; rdxRenderPage(); }
  setTimeout(() => {
    const el = document.querySelector('.rdx-box[data-id="' + id + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      el.classList.add('selected');
      setTimeout(() => el.classList.remove('selected'), 900);
    }
  }, 50);
}

/* ---------------------------------------------------------------------
   Box overlay rendering + drag / resize / manual add
   --------------------------------------------------------------------- */
function rdxScale() {
  const canvas = document.getElementById('rdxMainCanvas');
  if (!canvas || !canvas.width) return 1;
  const rect = canvas.getBoundingClientRect();
  return rect.width ? rect.width / canvas.width : 1;
}

function rdxRenderBoxes() {
  const overlay = document.getElementById('rdxOverlay');
  const canvas = document.getElementById('rdxMainCanvas');
  if (!overlay || !canvas || !canvas.width) return;
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width ? rect.width / canvas.width : 1;
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.innerHTML = '';
  overlay.classList.toggle('manual-mode', rdxState.manualAddMode);

  const pageDets = rdxState.detections.filter(d => d.page === rdxState.currentPage);
  pageDets.forEach(d => {
    const el = document.createElement('div');
    el.className = 'rdx-box rdx-cat-' + d.category + (d.selected ? ' selected' : '');
    el.style.left = (d.x0 * scale) + 'px';
    el.style.top = (d.y0 * scale) + 'px';
    el.style.width = Math.max(6, (d.x1 - d.x0) * scale) + 'px';
    el.style.height = Math.max(6, (d.y1 - d.y0) * scale) + 'px';
    el.dataset.id = d.id;
    el.title = rdxCatLabel(d.category) + (d.text ? (': ' + d.text) : '');

    const tag = document.createElement('div');
    tag.className = 'rdx-box-tag';
    tag.textContent = rdxCatLabel(d.category);
    el.appendChild(tag);

    ['nw', 'ne', 'sw', 'se'].forEach(pos => {
      const h = document.createElement('div');
      h.className = 'rdx-box-handle rdx-h-' + pos;
      h.addEventListener('mousedown', ev => rdxStartResize(ev, d, pos));
      el.appendChild(h);
    });

    const del = document.createElement('div');
    del.className = 'rdx-box-del';
    del.textContent = '\u00d7';
    del.title = 'Remove this item';
    del.addEventListener('click', ev => { ev.stopPropagation(); rdxDeleteBox(d.id); });
    el.appendChild(del);

    el.addEventListener('mousedown', ev => rdxStartMove(ev, d));
    overlay.appendChild(el);
  });
}

function rdxDeleteBox(id) {
  rdxState.detections = rdxState.detections.filter(d => d.id !== id);
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxPersist();
}

function rdxStartMove(ev, d) {
  if (ev.target.classList.contains('rdx-box-handle') || ev.target.classList.contains('rdx-box-del')) return;
  ev.preventDefault();
  ev.stopPropagation();
  const scale = rdxScale();
  const startX = ev.clientX, startY = ev.clientY;
  const orig = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 };
  let moved = false;
  const canvas = document.getElementById('rdxMainCanvas');
  function onMove(e2) {
    const dx = (e2.clientX - startX) / scale, dy = (e2.clientY - startY) / scale;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
    const w = orig.x1 - orig.x0, h = orig.y1 - orig.y0;
    let x0 = orig.x0 + dx, y0 = orig.y0 + dy;
    x0 = Math.max(0, Math.min(canvas.width - w, x0));
    y0 = Math.max(0, Math.min(canvas.height - h, y0));
    d.x0 = x0; d.y0 = y0; d.x1 = x0 + w; d.y1 = y0 + h;
    rdxRenderBoxes();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) { d.selected = !d.selected; rdxRenderBoxes(); rdxRenderSidebarList(); }
    rdxPersist();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function rdxStartResize(ev, d, corner) {
  ev.preventDefault();
  ev.stopPropagation();
  const scale = rdxScale();
  const startX = ev.clientX, startY = ev.clientY;
  const orig = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 };
  const canvas = document.getElementById('rdxMainCanvas');
  function onMove(e2) {
    const dx = (e2.clientX - startX) / scale, dy = (e2.clientY - startY) / scale;
    let { x0, y0, x1, y1 } = orig;
    if (corner.includes('n')) y0 = Math.min(orig.y1 - 8, orig.y0 + dy);
    if (corner.includes('s')) y1 = Math.max(orig.y0 + 8, orig.y1 + dy);
    if (corner.includes('w')) x0 = Math.min(orig.x1 - 8, orig.x0 + dx);
    if (corner.includes('e')) x1 = Math.max(orig.x0 + 8, orig.x1 + dx);
    d.x0 = Math.max(0, x0); d.y0 = Math.max(0, y0);
    d.x1 = Math.min(canvas.width, x1); d.y1 = Math.min(canvas.height, y1);
    rdxRenderBoxes();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    rdxPersist();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function rdxToggleManualMode() {
  rdxState.manualAddMode = !rdxState.manualAddMode;
  const btn = document.getElementById('rdxManualBtn');
  const catSel = document.getElementById('rdxManualCat');
  if (btn) btn.classList.toggle('active-toggle', rdxState.manualAddMode);
  if (catSel) catSel.style.display = rdxState.manualAddMode ? 'inline-block' : 'none';
  const overlay = document.getElementById('rdxOverlay');
  if (overlay) overlay.classList.toggle('manual-mode', rdxState.manualAddMode);
}

(function rdxInitManualDraw() {
  document.addEventListener('mousedown', ev => {
    if (!rdxState.manualAddMode) return;
    const overlay = document.getElementById('rdxOverlay');
    if (!overlay || (ev.target !== overlay)) return;
    ev.preventDefault();
    const canvas = document.getElementById('rdxMainCanvas');
    const rect = canvas.getBoundingClientRect();
    const scale = rdxScale();
    const startX = ev.clientX, startY = ev.clientY;
    const box = document.createElement('div');
    box.className = 'rdx-box';
    box.style.borderColor = '#00C2FF';
    overlay.appendChild(box);
    function onMove(e2) {
      const x0 = Math.min(startX, e2.clientX) - rect.left, y0 = Math.min(startY, e2.clientY) - rect.top;
      const w = Math.abs(e2.clientX - startX), h = Math.abs(e2.clientY - startY);
      box.style.left = x0 + 'px'; box.style.top = y0 + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
    }
    function onUp(e2) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      box.remove();
      const w = Math.abs(e2.clientX - startX), h = Math.abs(e2.clientY - startY);
      if (w < 6 || h < 6) return; // treat as an accidental click, not a real box
      const x0 = (Math.min(startX, e2.clientX) - rect.left) / scale;
      const y0 = (Math.min(startY, e2.clientY) - rect.top) / scale;
      const x1 = x0 + w / scale, y1 = y0 + h / scale;
      const catSel = document.getElementById('rdxManualCat');
      const cat = catSel ? catSel.value : 'other';
      rdxState.detections.push({
        id: 'd' + (rdxState.nextId++), category: cat, text: '(manually added)',
        page: rdxState.currentPage, confidence: 1, selected: true, manual: true,
        x0, y0, x1, y1
      });
      rdxRenderBoxes();
      rdxRenderSidebarList();
      rdxPersist();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

/* ---------------------------------------------------------------------
   Apply permanent redaction (burns pixels into the page canvas)
   --------------------------------------------------------------------- */
function rdxPaintMask(ctx, x, y, w, h, srcCanvas) {
  if (w <= 0 || h <= 0) return;
  switch (rdxState.maskStyle) {
    case 'white':
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h); break;
    case 'label':
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = Math.max(9, Math.round(Math.min(h * 0.55, 15))) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (w > 40) ctx.fillText('REDACTED', x + w / 2, y + h / 2);
      break;
    case 'pixelate': {
      const factor = 0.08;
      const sw = Math.max(1, Math.round(w * factor)), sh = Math.max(1, Math.round(h * factor));
      const small = document.createElement('canvas');
      small.width = sw; small.height = sh;
      small.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
      break;
    }
    case 'blur': {
      const pad = Math.round(Math.min(w, h) * 0.15) + 4;
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.max(0, x - pad), Math.max(0, y - pad), w + pad * 2, h + pad * 2);
      ctx.clip();
      ctx.filter = 'blur(' + Math.max(6, Math.round(Math.min(w, h) / 6)) + 'px)';
      ctx.drawImage(srcCanvas, x - pad, y - pad, w + pad * 2, h + pad * 2, x - pad, y - pad, w + pad * 2, h + pad * 2);
      ctx.restore();
      break;
    }
    default: // black
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
  }
}

// Burns a set of detections permanently into a page list's canvases. Pure
// canvas drawing — synchronous and fast, which is what makes both the
// single-document "Apply Redactions" and the batch "Redact All" feel
// instant rather than something the user has to wait on.
function rdxApplyMaskToPages(pages, detections, fileNameForLog) {
  if (!detections.length) return;
  const byPage = {};
  detections.forEach(d => { (byPage[d.page] = byPage[d.page] || []).push(d); });
  Object.keys(byPage).forEach(pIdxStr => {
    const pIdx = Number(pIdxStr);
    const pg = pages[pIdx];
    if (!pg) return;
    const ctx = pg.canvas.getContext('2d');
    // Snapshot the page once before painting so blur/pixelate sample real
    // pixels rather than an already-redacted neighbor box.
    const snapshot = document.createElement('canvas');
    snapshot.width = pg.canvas.width; snapshot.height = pg.canvas.height;
    snapshot.getContext('2d').drawImage(pg.canvas, 0, 0);
    byPage[pIdx].forEach(d => {
      const pad = 3;
      const x = Math.max(0, Math.round(d.x0 - pad));
      const y = Math.max(0, Math.round(d.y0 - pad));
      const w = Math.min(pg.canvas.width - x, Math.round((d.x1 - d.x0) + pad * 2));
      const h = Math.min(pg.canvas.height - y, Math.round((d.y1 - d.y0) + pad * 2));
      rdxPaintMask(ctx, x, y, w, h, snapshot);
    });
  });
  // Audit trail for the Excel export below — deliberately records only the
  // category/page/mask style, NEVER d.text (the actual sensitive string).
  // A "redaction report" that leaked back the very data it redacted out of
  // the image would defeat the whole point of this tool.
  if (!rdxState.auditLog) rdxState.auditLog = [];
  const fname = fileNameForLog || rdxState.fileName || 'document';
  detections.forEach(d => {
    rdxState.auditLog.push({ fileName: fname, page: d.page + 1, category: d.category, maskStyle: rdxState.maskStyle, manual: !!d.manual });
  });
}

function rdxApplyRedactions() {
  const selected = rdxState.detections.filter(d => d.selected);
  if (!selected.length) { toast('No items selected to redact.', 'error'); return; }
  rdxApplyMaskToPages(rdxState.pages, selected);
  // The mask is now burned permanently into the page canvas — remove the
  // applied items so their boxes don't linger over the blacked-out area.
  const appliedIds = new Set(selected.map(d => d.id));
  rdxState.detections = rdxState.detections.filter(d => !appliedIds.has(d.id));
  rdxRenderPage();
  rdxRenderSidebarList();
  rdxRenderThumbs();
  rdxState.exportEnabled = true;
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = false;
  rdxRenderDocQueue();
  toast(`Redacted ${selected.length} item${selected.length !== 1 ? 's' : ''} permanently.`, 'success');
  rdxPersist();
}

/* ---------------------------------------------------------------------
   Batch-wide "smart" actions — Scan All / Redact All. These let an officer
   process a whole stack of documents without opening each one by hand:
   Scan All OCRs every not-yet-scanned document and lists what it found
   (per-document badges in the queue strip + a combined breakdown toast);
   Redact All then burns in every detected item, in every document, in one
   instant pass (canvas painting is synchronous, so this is genuinely fast
   even across a large batch).
   --------------------------------------------------------------------- */
async function rdxScanAllDocs() {
  if (rdxState.scanning || rdxState.batchProcessing) return;
  const pending = rdxState.docs.filter(d => !d.scanned);
  if (!pending.length) { toast('Every document in this batch has already been scanned.', 'info'); return; }
  rdxState.batchProcessing = true;
  rdxState.scanning = true;
  rdxShowScanProgress();
  const scanBtn = document.getElementById('rdxScanBtn');
  if (scanBtn) scanBtn.disabled = true;
  rdxRenderDocQueue();

  const total = pending.length;
  let done = 0, totalFound = 0;
  const catTotals = {};
  const docTypeCounts = {}; // { 'PAN card': { docs: 2, fields: 12 }, 'Aadhaar card': {...} }
  for (const doc of pending) {
    rdxSetScanLabel(`Scanning "${doc.fileName}" (${done + 1} of ${total})…`);
    rdxUpdateScanProgress(done / total);
    try {
      const result = await rdxScanPagesCore(doc.pages, (p, tp) => {
        rdxSetScanLabel(`Scanning "${doc.fileName}" (${done + 1} of ${total}) — page ${p + 1} of ${tp}…`);
      });
      doc.detections = result.detections;
      doc.docType = result.docType;
      doc.docTypeLabel = result.docTypeLabel;
      if (!doc.docTypeLabel) {
        const fnGuess = rdxDetectDocTypeFromFilename(doc.fileName);
        if (fnGuess) { doc.docType = fnGuess.type; doc.docTypeLabel = fnGuess.label; }
      }
      doc.scanned = true;
      doc.detections.forEach(d => { catTotals[d.category] = (catTotals[d.category] || 0) + 1; });
      totalFound += doc.detections.length;
      const presetDets = doc.detections.filter(d => d.presetFallback);
      // Grouping/toast counts come from the reliably-detected doc.docTypeLabel
      // (content-based, always set when a known type matched) rather than
      // relying on preset-fallback boxes having fired — a document can be
      // correctly recognized as a PAN card even when every zone was already
      // covered by ordinary detections and no fallback box was needed.
      if (doc.docTypeLabel) {
        const label = doc.docTypeLabel;
        if (!docTypeCounts[label]) docTypeCounts[label] = { docs: 0, fields: 0 };
        docTypeCounts[label].docs++;
        docTypeCounts[label].fields += presetDets.length;
      }
      if (rdxState.docs[rdxState.activeDoc] === doc) {
        rdxState.detections = doc.detections;
        rdxState.docType = doc.docType;
        rdxState.docTypeLabel = doc.docTypeLabel;
        rdxState.scanned = true;
      }
    } catch (err) {
      console.warn('Batch scan error', err);
      toast(`Could not scan "${doc.fileName}" — skipped.`, 'error');
    }
    done++;
    rdxUpdateScanProgress(done / total);
  }

  rdxHideScanProgress();
  rdxState.scanning = false;
  rdxState.batchProcessing = false;
  if (scanBtn) scanBtn.disabled = false;
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxRenderThumbs();
  rdxRenderDocQueue();

  if (!totalFound) {
    toast(`Scanned ${total} document${total !== 1 ? 's' : ''} — nothing sensitive found automatically. You can still add manual boxes on any of them.`, 'info');
    rdxPersist();
    return;
  }
  const typeLabels = Object.keys(docTypeCounts);
  if (typeLabels.length) {
    const summary = typeLabels.map(label => `${docTypeCounts[label].docs} ${label}${docTypeCounts[label].docs !== 1 ? 's' : ''}`).join(', ');
    const totalFields = typeLabels.reduce((s, l) => s + docTypeCounts[l].fields, 0);
    toast(`Recognized ${summary} in this batch and filled in ${totalFields} field${totalFields !== 1 ? 's' : ''} using each type's standard layout — review the estimated boxes before redacting.`, 'info');
  }
  rdxOpenBatchReviewModal(totalFound, catTotals, total);
  rdxPersist();
}

function rdxRedactAllDocs() {
  if (rdxState.scanning || rdxState.batchProcessing) return;
  const withFindings = rdxState.docs.filter(d => d.scanned && d.detections.some(x => x.selected));
  if (!withFindings.length) {
    toast('Nothing to redact yet — run "Scan All" first so there\'s a list of what to black out.', 'error');
    return;
  }
  let totalItems = 0;
  const catTotals = {};
  withFindings.forEach(doc => {
    const selected = doc.detections.filter(x => x.selected);
    rdxApplyMaskToPages(doc.pages, selected, doc.fileName);
    selected.forEach(d => { catTotals[d.category] = (catTotals[d.category] || 0) + 1; });
    totalItems += selected.length;
    const appliedIds = new Set(selected.map(x => x.id));
    doc.detections = doc.detections.filter(x => !appliedIds.has(x.id));
    doc.exportEnabled = true;
    if (rdxState.docs[rdxState.activeDoc] === doc) {
      rdxState.detections = doc.detections;
      rdxState.exportEnabled = true;
    }
  });
  rdxRenderPage();
  rdxRenderBoxes();
  rdxRenderSidebarList();
  rdxRenderThumbs();
  rdxRenderDocQueue();
  const exportBtn = document.getElementById('rdxExportBtn');
  if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
  const breakdown = Object.keys(catTotals).map(c => `${rdxCatLabel(c)} ×${catTotals[c]}`).join(' · ');
  toast(`Redacted ${totalItems} item${totalItems !== 1 ? 's' : ''} instantly across ${withFindings.length} document${withFindings.length !== 1 ? 's' : ''} — ${breakdown}. Each is ready to export from the batch strip.`, 'success');
  rdxPersist();
}

/* ---------------------------------------------------------------------
   Export
   --------------------------------------------------------------------- */
function rdxOutputName(ext) {
  const base = (rdxState.fileName || 'document').replace(/\.[^.]+$/, '');
  return base + '-redacted.' + ext;
}
async function rdxExport() {
  if (!rdxState.pages.length) return;
  const willBePdf = !(rdxState.fileType === 'image' && rdxState.pages.length === 1);
  let password = null;
  if (willBePdf) {
    password = await sarvarcAskExportPassword('Export Redacted Document');
    if (password === undefined) return; // cancelled
  }
  try {
    if (rdxState.fileType === 'image' && rdxState.pages.length === 1) {
      const pg = rdxState.pages[0];
      pg.canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = rdxOutputName('png');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    } else {
      if (!window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
      const { jsPDF } = window.jspdf;
      let pdf = null;
      rdxState.pages.forEach(pg => {
        const imgData = pg.canvas.toDataURL('image/jpeg', 0.93);
        const wmm = pg.mmW || (pg.canvas.width * 25.4 / 96);
        const hmm = pg.mmH || (pg.canvas.height * 25.4 / 96);
        const ori = wmm > hmm ? 'landscape' : 'portrait';
        if (!pdf) pdf = new jsPDF(Object.assign({ orientation: ori, unit: 'mm', format: [wmm, hmm] }, sarvarcPdfEncryptionOpts(password)));
        else pdf.addPage([wmm, hmm], ori);
        pdf.addImage(imgData, 'JPEG', 0, 0, wmm, hmm);
      });
      if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
      pdf.save(rdxOutputName('pdf'));
    }
    toast('Redacted document exported.' + (password ? ' (password protected)' : ''), 'success');
    if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + 1; if (typeof updateStats === 'function') updateStats(); }
  } catch (err) {
    console.warn('Redact export error', err);
    toast('Export failed. Please try again.', 'error');
  }
}

// ─── EXPORT DROPDOWN (PDF / Word / Excel / Image, chosen from the toolbar button) ───
function rdxToggleExportDropdown(e) {
  if (e) e.stopPropagation();
  const btn = document.getElementById('rdxExportBtn');
  if (!btn || btn.disabled) return;
  const dd = document.getElementById('rdxExportDropdown');
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  dd.classList.remove('open');
  if (!wasOpen) {
    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    const panelW = 250;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    dd.style.top = (rect.bottom + 6) + 'px';
    dd.style.left = left + 'px';
    dd.classList.add('open');
  }
}
document.addEventListener('click', function(e) {
  const dd = document.getElementById('rdxExportDropdown');
  const btn = document.getElementById('rdxExportBtn');
  if (dd && dd.classList.contains('open') && !dd.contains(e.target) && (!btn || !btn.contains(e.target))) {
    dd.classList.remove('open');
  }
});

function rdxExportAs(fmt) {
  const dd = document.getElementById('rdxExportDropdown');
  if (dd) dd.classList.remove('open');
  if (fmt === 'pdf') rdxExportPDF();
  else if (fmt === 'docx') rdxExportDOCX();
  else if (fmt === 'xlsx') rdxExportXLSX();
  else if (fmt === 'image') rdxExportImages();
}

// Always builds a PDF regardless of whether the source was a scanned image
// or a PDF — unlike rdxExport() above, this doesn't fall back to a single
// PNG for single-page image uploads, since the person explicitly picked PDF.
async function rdxExportPDF() {
  if (!rdxState.pages.length) { toast('No document loaded', 'error'); return; }
  if (!window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  const password = await sarvarcAskExportPassword('Export Redacted PDF');
  if (password === undefined) return; // cancelled
  showExportOverlay('Exporting PDF…', rdxState.pages.length > 1 ? `Rendering page 1 of ${rdxState.pages.length}…` : 'Rendering page…');
  try {
    const { jsPDF } = window.jspdf;
    let pdf = null;
    rdxState.pages.forEach((pg, i) => {
      updateExportProgress((i / rdxState.pages.length) * 90, `Rendering page ${i + 1} of ${rdxState.pages.length}…`);
      const imgData = pg.canvas.toDataURL('image/jpeg', 0.93);
      const wmm = pg.mmW || (pg.canvas.width * 25.4 / 96);
      const hmm = pg.mmH || (pg.canvas.height * 25.4 / 96);
      const ori = wmm > hmm ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF(Object.assign({ orientation: ori, unit: 'mm', format: [wmm, hmm] }, sarvarcPdfEncryptionOpts(password)));
      else pdf.addPage([wmm, hmm], ori);
      pdf.addImage(imgData, 'JPEG', 0, 0, wmm, hmm);
    });
    updateExportProgress(95, 'Saving file…');
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(rdxOutputName('pdf')));
    if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + 1; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay(rdxState.pages.length + (rdxState.pages.length > 1 ? ' pages exported' : ' page exported'), { module: 'redact_pii', format: 'pdf' });
    toast('Redacted document exported to PDF.' + (password ? ' (password protected)' : ''), 'success');
  } catch (err) {
    hideExportOverlay();
    console.warn('Redact PDF export error', err);
    toast('Export failed. Please try again.', 'error');
  }
}

// Saves each redacted page as a PNG — a single plain download if there's
// only one page, or a ZIP bundle if there's more than one. Pulls straight
// from pg.canvas, which already has every mask permanently baked into its
// pixels, so what comes out is exactly what's on screen, nothing more.
async function rdxExportImages() {
  if (!rdxState.pages.length) { toast('No document loaded', 'error'); return; }
  const base = (rdxState.fileName || 'document').replace(/\.[^.]+$/, '');
  showExportOverlay('Exporting images…', rdxState.pages.length > 1 ? 'Packing pages…' : 'Rendering page…');
  try {
    if (rdxState.pages.length === 1) {
      updateExportProgress(50, 'Rendering page…');
      const pg = rdxState.pages[0];
      const outCanvas = sarvarcMaybeWatermarkCanvas(pg.canvas);
      const blob = await new Promise(res => outCanvas.toBlob(res, 'image/png'));
      updateExportProgress(95, 'Saving file…');
      pdfedDownloadBlob(blob, base + '-redacted.png');
      completeExportOverlay('1 page exported', { module: 'redact_pii', format: 'image' });
      toast('Exported redacted image.', 'success');
    } else {
      if (typeof JSZip === 'undefined') { hideExportOverlay(); toast('Zip engine failed to load, check your connection', 'error'); return; }
      const zip = new JSZip();
      for (let i = 0; i < rdxState.pages.length; i++) {
        updateExportProgress((i / rdxState.pages.length) * 80, `Packing page ${i + 1} of ${rdxState.pages.length}…`);
        const pg = rdxState.pages[i];
        const dataUrl = sarvarcMaybeWatermarkCanvas(pg.canvas).toDataURL('image/png');
        zip.file(base + '-redacted-page' + (i + 1) + '.png', dataUrl.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        updateExportProgress(80 + metadata.percent * 0.18, `Compressing… ${Math.round(metadata.percent)}%`);
      });
      pdfedDownloadBlob(blob, base + '-redacted-pages.zip');
      completeExportOverlay(rdxState.pages.length + ' pages exported', { module: 'redact_pii', format: 'image' });
      toast('Exported ' + rdxState.pages.length + ' images.', 'success');
    }
    if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + rdxState.pages.length; if (typeof updateStats === 'function') updateStats(); }
  } catch (e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

// Embeds every redacted page as a picture in a .docx, one per page, in the
// same order they appear in the workspace. Reuses the same OOXML plumbing
// (pdfedAddImageRun + the docx zip skeleton) as the main PDF editor's Word
// export, just with the whole page baked as one image rather than
// reconstructed text — appropriate here since a redacted scan's content is
// already flattened into pixels, there's no separate text layer to recover.
async function rdxExportDOCX() {
  if (!rdxState.pages.length) { toast('No document loaded', 'error'); return; }
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  showExportOverlay('Exporting Word…', 'Embedding pages…');
  try {
    const PAGE_W_TWIPS = 11906, PAGE_H_TWIPS = 16838, MARGIN_TWIPS = 720;
    const contentWidthEmu = (PAGE_W_TWIPS - MARGIN_TWIPS * 2) * 635;
    const images = { list: [] };
    let bodyXml = '';
    rdxState.pages.forEach((pg, i) => {
      updateExportProgress((i / rdxState.pages.length) * 80, `Embedding page ${i + 1} of ${rdxState.pages.length}…`);
      if (i > 0) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      const dataUrl = sarvarcMaybeWatermarkCanvas(pg.canvas).toDataURL('image/png');
      const wPt = pg.mmW ? pg.mmW * 2.83465 : (pg.canvas.width * 72 / 96);
      const hPt = pg.mmH ? pg.mmH * 2.83465 : (pg.canvas.height * 72 / 96);
      bodyXml += pdfedAddImageRun(images, dataUrl, wPt, hPt, contentWidthEmu);
    });

    updateExportProgress(88, 'Building document…');
    const rootNamespaces = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${rootNamespaces}><w:body>${bodyXml}` +
      `<w:sectPr><w:pgSz w:w="${PAGE_W_TWIPS}" w:h="${PAGE_H_TWIPS}"/>` +
      `<w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" w:left="${MARGIN_TWIPS}"/></w:sectPr></w:body></w:document>`;

    const imageDefaults = images.list.length ? `<Default Extension="png" ContentType="image/png"/>` : '';
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>${imageDefaults}` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      images.list.map(img => `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.rId}.${img.ext}"/>`).join('') +
      `</Relationships>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    const wordFolder = zip.folder('word');
    wordFolder.file('document.xml', documentXml);
    if (images.list.length) {
      wordFolder.folder('_rels').file('document.xml.rels', docRels);
      const media = wordFolder.folder('media');
      images.list.forEach(img => media.file(`${img.rId}.${img.ext}`, img.base64, { base64: true }));
    }

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    pdfedDownloadBlob(blob, rdxOutputName('docx'));
    if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + 1; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay('Word document exported', { module: 'redact_pii', format: 'docx' });
    toast('Redacted document exported to Word.', 'success');
  } catch (e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

// Excel export is a redaction AUDIT LOG, not the document itself: page
// number, category, mask style, and whether each item was auto-detected or
// hand-drawn. It deliberately never includes the sensitive text that was
// found — a "redaction report" that leaked back the very data just blacked
// out of the image would defeat the whole purpose of this tool.
function rdxExportXLSX() {
  if (typeof XLSX === 'undefined') { toast('Excel engine unavailable right now', 'error'); return; }
  const fname = rdxState.fileName || 'document';
  const log = (rdxState.auditLog || []).filter(e => e.fileName === fname);
  if (!log.length) { toast('No redaction log yet — apply at least one redaction first.', 'error'); return; }
  try {
    const aoa = [['Page', 'Category', 'Mask Style', 'Detected By']];
    log.forEach(e => aoa.push([e.page, rdxCatLabel(e.category), e.maskStyle, e.manual ? 'Manual box' : 'Auto-detected']));
    if (window.sarvarcApplyFreeWatermark) { aoa.push([]); aoa.push([SARVARC_WATERMARK_TEXT]); }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 8 }, { wch: 22 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Redaction Log');
    XLSX.writeFile(wb, sarvarcBrandFilename(rdxOutputName('xlsx')));
    if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + 1; if (typeof updateStats === 'function') updateStats(); }
    toast('Redaction log exported to Excel.', 'success');
  } catch (e) {
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

// ── Push-to-Workspace: destination choice modal ──
// Same pattern as Diagrams & Graphs' push-to-Workspace: before inserting,
// ask whether the redacted page should become a brand-new page in the
// Workspace document, or be dropped onto the page currently open there.
// Pulls from the active document's current page canvas, which already has
// every applied mask permanently baked into its pixels — so what gets
// pushed is exactly what's on screen, redactions included.
function rdxGetExportCanvas() {
  if (!rdxState.pages.length) return null;
  const pg = rdxState.pages[rdxState.currentPage] || rdxState.pages[0];
  return pg ? pg.canvas : null;
}
function rdxOpenPushChoiceModal() {
  const canvas = rdxGetExportCanvas();
  if (!canvas) { toast('Load and redact a document first before pushing to Workspace', 'error'); return; }
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }
  const overlay = document.getElementById('rdxPushChoiceOverlay');
  if (overlay) overlay.classList.add('open');
}
function rdxClosePushChoice() {
  const overlay = document.getElementById('rdxPushChoiceOverlay');
  if (overlay) overlay.classList.remove('open');
}
function rdxConfirmPushChoice(mode, cardEl) {
  if (cardEl) sarvarcAnimatedPush(cardEl, 'navIcon-workspace');
  rdxClosePushChoice();
  rdxInsertIntoWorkspace(mode);
}
async function rdxInsertIntoWorkspace(mode) {
  const canvas = rdxGetExportCanvas();
  if (!canvas) return;
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }

  const dataUrl = canvas.toDataURL('image/png');
  const label = (rdxState.fileName || 'Redacted Document').replace(/\.[^.]+$/, '');
  const noWorkspaceYet = !pdfed.pages || pdfed.pages.length === 0;

  try {
    if (noWorkspaceYet) {
      // No workspace document open yet — create a fresh blank A4 page to drop the redacted image onto,
      // regardless of which option was chosen, since there's no live page to add to.
      const mmW = 210, mmH = 297, EXPORT_PXMM = 3.7795;
      const eW = Math.round(mmW * EXPORT_PXMM), eH = Math.round(mmH * EXPORT_PXMM);
      const bg = document.createElement('canvas');
      bg.width = eW; bg.height = eH;
      const bctx = bg.getContext('2d');
      bctx.fillStyle = '#ffffff';
      bctx.fillRect(0, 0, eW, eH);

      pdfed.pages.push({
        type: 'blank', dataUrl: bg.toDataURL('image/png'), modified: true, edits: {},
        textBlocks: [], placedTexts: [], label, bgColor: '#ffffff', pageMM: [mmW, mmH]
      });

      pdfed.pdfDoc = null;
      pdfed.file = { name: label };
      ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn');
      if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName');
      if (fnEl) fnEl.textContent = pdfed.file.name;
      const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
      const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
      if (state && state.stats) { state.stats.pdfs++; state.stats.pages++; }
      if (typeof updateStats === 'function') updateStats();

      navigate('pdfeditor');
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      if (typeof pdfedGoto === 'function') await pdfedGoto(0);
      setTimeout(() => {
        if (typeof pdfedZoomFit === 'function') pdfedZoomFit();
        if (typeof pdfedActivateImgGhost === 'function') pdfedActivateImgGhost(dataUrl);
      }, 120);
    } else if (mode === 'new') {
      // Append a brand-new blank page to the existing Workspace document and drop the redacted image onto it.
      const mmW = 210, mmH = 297, EXPORT_PXMM = 3.7795;
      const eW = Math.round(mmW * EXPORT_PXMM), eH = Math.round(mmH * EXPORT_PXMM);
      const bg = document.createElement('canvas');
      bg.width = eW; bg.height = eH;
      const bctx = bg.getContext('2d');
      bctx.fillStyle = '#ffffff';
      bctx.fillRect(0, 0, eW, eH);

      pdfed.pages.push({
        type: 'blank', dataUrl: bg.toDataURL('image/png'), modified: true, edits: {},
        textBlocks: [], placedTexts: [], label, bgColor: '#ffffff', pageMM: [mmW, mmH]
      });
      const newIdx = pdfed.pages.length - 1;

      if (state && state.stats) { state.stats.pages++; }
      if (typeof updateStats === 'function') updateStats();

      navigate('pdfeditor');
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      if (typeof pdfedGoto === 'function') await pdfedGoto(newIdx);
      setTimeout(() => {
        if (typeof pdfedZoomFit === 'function') pdfedZoomFit();
        if (typeof pdfedActivateImgGhost === 'function') pdfedActivateImgGhost(dataUrl);
        toast('New page added — drag to position, then click to drop your redacted document', 'info');
      }, 120);
    } else {
      // Add to the live page currently open in the Workspace.
      navigate('pdfeditor');
      setTimeout(() => {
        if (typeof pdfedActivateImgGhost === 'function') pdfedActivateImgGhost(dataUrl);
        toast('Drag to position, then click to drop your redacted document onto the page', 'info');
      }, 60);
    }
  } catch (err) {
    console.error(err);
    toast('Could not insert redacted document: ' + err.message, 'error');
  }
}
