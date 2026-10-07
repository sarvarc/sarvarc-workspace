// ── BUSINESS PROPOSALS → PDF EDITOR CANVAS ──────────────────────────────
// A second, separate entry point into the same 5 designer skins above, but
// this one is reached from the "Business Proposals" button that lives right
// in the PDF Editor app bar (next to "PDF Tools") instead of the standalone
// Business Proposals module/section. Picking a template here never touches
// sec-proposals — it renders the skin's chrome (header band/border, logo
// swatch, section rules) onto a background image and drops the actual
// content (company name, client/date fields, project title, scope list,
// pricing table, terms, sign-off) as real pg.placedTexts/placedTables
// objects on a brand-new page in pdfed.pages. That's the exact same
// "push to canvas" mechanism Data Tables and Diagrams & Graphs use, so the
// result is a completely ordinary, draggable/editable page — not a special
// case the rest of the PDF Editor has to know about.
// A pricing table taller than this would push the sign-off block too close
// to the bottom of the page -- past this many line items, the breakdown
// belongs in Data Arrangement, pushed onto a second page via
// pipeline_da_to_pdf, rather than growing this one further.
const BP_MAX_PRICING_ROWS = 8;

const BP_CANVAS_SKINS = {
  modern: {
    headerStyle: 'band', headerBg: '#2563eb', headerText: '#ffffff',
    bodyBg: '#ffffff', textColor: '#1f2937', mutedColor: '#9ca3af',
    headingColor: '#2563eb', totalColor: '#2563eb', lineColor: '#e5e7eb',
    logoBg: 'rgba(255,255,255,0.28)', logoText: '#ffffff',
    docLabelColor: '#ffffff', fontFamily: 'Inter', italicTitle: false,
    headerHeight: 108, logoRadius: 10
  },
  navy: {
    headerStyle: 'border', headerBorderColor: '#0f2748',
    bodyBg: '#ffffff', textColor: '#1f2937', mutedColor: '#9ca3af',
    headingColor: '#0f2748', totalColor: '#0f2748', lineColor: '#e5e7eb',
    logoBg: '#0f2748', logoText: '#ffffff',
    docLabelColor: '#c9a227', fontFamily: 'Inter', italicTitle: false,
    headerHeight: 108, logoRadius: 10
  },
  gradient: {
    headerStyle: 'gradient', headerText: '#ffffff', gradFrom: '#7c3aed', gradTo: '#ec4899',
    bodyBg: '#ffffff', textColor: '#1f2937', mutedColor: '#9ca3af',
    headingColor: '#7c3aed', totalColor: '#ec4899', lineColor: '#f3e8ff',
    logoBg: 'rgba(255,255,255,0.28)', logoText: '#ffffff',
    docLabelColor: '#ffffff', fontFamily: 'Inter', italicTitle: false,
    headerHeight: 120, logoRadius: 10
  },
  elegant: {
    headerStyle: 'double', headerBorderColor: '#111827',
    bodyBg: '#ffffff', textColor: '#1f2937', mutedColor: '#9ca3af',
    headingColor: '#111827', totalColor: '#111827', lineColor: '#e5e7eb',
    logoBg: '#111827', logoText: '#ffffff',
    docLabelColor: '#c9a227', fontFamily: 'Georgia', italicTitle: true,
    headerHeight: 108, logoRadius: 0
  },
  dark: {
    headerStyle: 'darkline',
    bodyBg: '#0b1220', textColor: '#e5e7eb', mutedColor: '#6b7280',
    headingColor: '#00e5c7', totalColor: '#00e5c7', lineColor: '#1f2937',
    logoBg: '#00e5c7', logoText: '#0b1220',
    docLabelColor: '#00e5c7', fontFamily: 'Inter', italicTitle: false,
    headerHeight: 108, logoRadius: 10
  }
};

const BP_TEMPLATE_LABELS = {
  modern: 'Modern Minimal', navy: 'Corporate Navy', gradient: 'Creative Gradient',
  elegant: 'Classic Elegant', dark: 'Bold Dark'
};

// ── BRAND KIT ─────────────────────────────────────────────────────────
// One saved identity (logo + company name + tagline) that auto-fills every
// proposal template inserted onto the canvas, instead of the user
// re-uploading/retyping it each time. Lives in the top bar now (not tied to
// any one module's DOM), so it works regardless of which module is open.
// Free tier is exactly this — one kit. A "Kits" list (named, switchable,
// multiple logos for agencies juggling clients) is the natural paid
// upgrade on top of this same bkSave/bkLoad shape.
const BK_STORAGE_KEY = 'sarvarc_brand_kit_v1';

function bkLoad() {
  try {
    const raw = localStorage.getItem(BK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function bkSave(kit) {
  try { localStorage.setItem(BK_STORAGE_KEY, JSON.stringify(kit)); } catch (e) {}
}

function bkTogglePanel() {
  const panel = document.getElementById('bkPanel');
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) bkRefreshPanel();
}

function bkRefreshPanel() {
  const kit = bkLoad();
  const preview = document.getElementById('bkLogoPreview');
  const placeholder = document.getElementById('bkLogoPlaceholder');
  const status = document.getElementById('bkStatus');
  const companyInput = document.getElementById('bkCompanyInput');
  const taglineInput = document.getElementById('bkTaglineInput');
  if (kit && kit.logo) {
    preview.src = kit.logo; preview.style.display = '';
    if (placeholder) placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    if (placeholder) placeholder.style.display = '';
  }
  if (companyInput) companyInput.value = (kit && kit.company) || '';
  if (taglineInput) taglineInput.value = (kit && kit.tagline) || '';
  if (status) {
    status.textContent = kit
      ? 'Saved — every proposal you insert onto the canvas auto-applies this logo and name.'
      : 'No brand kit saved yet — upload a logo to brand every proposal automatically from now on.';
  }
}

function bkHandleLogoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const preview = document.getElementById('bkLogoPreview');
    const placeholder = document.getElementById('bkLogoPlaceholder');
    if (preview) { preview.src = reader.result; preview.style.display = ''; }
    if (placeholder) placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function bkOnFieldInput() { /* live-typed values are picked up on Save & Apply */ }

function bkClear() {
  localStorage.removeItem(BK_STORAGE_KEY);
  bkRefreshPanel();
  if (typeof toast === 'function') toast('Brand Kit cleared', 'info');
}

function bkSaveFromPanel() {
  const preview = document.getElementById('bkLogoPreview');
  const kit = {
    logo: (preview && preview.style.display !== 'none') ? preview.src : null,
    company: (document.getElementById('bkCompanyInput') || {}).value || '',
    tagline: (document.getElementById('bkTaglineInput') || {}).value || ''
  };
  bkSave(kit);
  bkRefreshPanel();
  if (typeof toast === 'function') toast('Brand Kit saved — new proposals will use it', 'success');
}

function bpOpenTemplateModal() {
  const ov = document.getElementById('bpTplModalOverlay');
  if (ov) ov.classList.add('open');
  const hint = document.getElementById('bpTplModalKitHint');
  if (hint) { const kit = bkLoad(); hint.style.display = (kit && kit.logo) ? '' : 'none'; }
}
function bpCloseTemplateModal() {
  const ov = document.getElementById('bpTplModalOverlay');
  if (ov) ov.classList.remove('open');
}

function bpRoundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// Bakes only the skin's non-editable "chrome" (header band/border, logo
// swatch, doc-type label, meta-field labels, section rule lines, signature
// line) onto a background image at the exact same 794×1123 (A4 @ 3.7795
// px/mm, matching every other pdfed page) pixel space that the placed text/
// table coordinates below use — so drawing here and positioning overlays
// afterward can share one plain set of numbers. Rendered 2x oversized then
// downscaled, the same anti-aliasing trick pdfedRenderBlankPage() uses.
function bpLoadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function bpRenderTemplateBg(key, colorOverride, itemCount) {
  // colorOverride lets a caller (Kadessa, via bp_insert_template's `colors`
  // param) restyle a base skin's accent colors -- e.g. a custom brand
  // gradient -- without having to define a whole new named skin. Structural
  // fields (headerStyle, fontFamily, italicTitle, headerHeight...) always
  // come from the base skin; only the color fields in colorOverride win.
  const skin = Object.assign({}, BP_CANVAS_SKINS[key] || BP_CANVAS_SKINS.modern, colorOverride || {});
  // The pricing table used to be a fixed 3-line-item shape. effectiveRows
  // is how many BODY rows (not counting header/total) it actually has now
  // -- BP_MAX_PRICING_ROWS caps how far this page can grow before a longer
  // breakdown belongs in Data Arrangement instead (see kadessaInsertProposalFromDetails).
  // extraRowHeight is how far everything below the table (TERMS & NOTES,
  // the sign-off block, signature line) needs to shift down to make room.
  const effectiveRows = Math.max(3, Math.min(BP_MAX_PRICING_ROWS, itemCount || 3));
  const extraRowHeight = (effectiveRows - 3) * 28;
  const W = 794, H = 1123, scale = 2;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  const kit = bkLoad();
  const kitLogoImg = await bpLoadImage(kit && kit.logo);

  ctx.fillStyle = skin.bodyBg;
  ctx.fillRect(0, 0, W, H);

  if (skin.headerStyle === 'band') {
    ctx.fillStyle = skin.headerBg;
    ctx.fillRect(0, 0, W, skin.headerHeight);
  } else if (skin.headerStyle === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W, skin.headerHeight);
    g.addColorStop(0, skin.gradFrom); g.addColorStop(1, skin.gradTo);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, skin.headerHeight);
  } else if (skin.headerStyle === 'border') {
    ctx.strokeStyle = skin.headerBorderColor; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, skin.headerHeight); ctx.lineTo(W, skin.headerHeight); ctx.stroke();
  } else if (skin.headerStyle === 'double') {
    ctx.strokeStyle = skin.headerBorderColor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, skin.headerHeight - 4); ctx.lineTo(W, skin.headerHeight - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, skin.headerHeight); ctx.lineTo(W, skin.headerHeight); ctx.stroke();
  } else if (skin.headerStyle === 'darkline') {
    ctx.strokeStyle = skin.lineColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, skin.headerHeight); ctx.lineTo(W - 60, skin.headerHeight); ctx.stroke();
  }

  // Logo swatch — the user's uploaded Brand Kit logo when there is one,
  // clipped to the same rounded-rect slot the initials swatch used, so
  // switching a logo on/off never moves anything else on the page.
  bpRoundRectPath(ctx, 60, 28, 46, 46, skin.logoRadius);
  if (kitLogoImg) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // contain-fit the logo inside the 46x46 slot with a small inset
    const pad = 4, slot = 46 - pad * 2;
    const ratio = Math.min(slot / kitLogoImg.width, slot / kitLogoImg.height);
    const dw = kitLogoImg.width * ratio, dh = kitLogoImg.height * ratio;
    const dx = 60 + pad + (slot - dw) / 2, dy = 28 + pad + (slot - dh) / 2;
    ctx.drawImage(kitLogoImg, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = skin.logoBg; ctx.fill();
    ctx.fillStyle = skin.logoText;
    ctx.font = "800 17px 'Inter', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SC', 83, 53);
  }

  // Doc-type label, top right
  ctx.fillStyle = skin.docLabelColor;
  ctx.font = "800 12px 'Inter', sans-serif";
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('P R O P O S A L', W - 60, 48);

  // Meta field labels (values are separate, editable placedTexts below)
  ctx.font = "700 9px 'Inter', sans-serif";
  ctx.fillStyle = skin.mutedColor;
  ctx.textAlign = 'left';
  ['PREPARED FOR', 'DATE', 'VALID UNTIL'].forEach((lab, i) => {
    ctx.fillText(lab, 60 + i * 224, 140);
  });

  // Section headings + rule lines. TERMS & NOTES is the only one below the
  // pricing table, so it's the only one that needs to move when the table
  // grows past its original 3 rows -- OVERVIEW/SCOPE OF WORK/INVESTMENT sit
  // above the table and stay put.
  ctx.font = "800 12px 'Inter', sans-serif";
  [['OVERVIEW', 280], ['SCOPE OF WORK', 384], ['INVESTMENT', 494], ['TERMS & NOTES', 680 + extraRowHeight]].forEach(([labelText, y]) => {
    ctx.fillStyle = skin.headingColor;
    ctx.fillText(labelText, 60, y);
    ctx.strokeStyle = skin.lineColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, y + 9); ctx.lineTo(W - 60, y + 9); ctx.stroke();
  });

  // Sign-off: "Prepared by" label + signature line -- shifted down by the
  // same extraRowHeight as TERMS & NOTES above, so it always lands just
  // below it regardless of how many pricing rows pushed everything down.
  ctx.font = "700 9px 'Inter', sans-serif";
  ctx.fillStyle = skin.mutedColor;
  ctx.textAlign = 'left';
  ctx.fillText('PREPARED BY', 60, 800 + extraRowHeight);
  ctx.strokeStyle = skin.bodyBg === '#0b1220' ? '#374151' : '#9ca3af';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(554, 850 + extraRowHeight); ctx.lineTo(734, 850 + extraRowHeight); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillText('SIGNATURE', 644, 866 + extraRowHeight);

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(c, 0, 0, W, H);
  return out.toDataURL('image/png');
}

// Investment table formatting: bold + tinted header row, right-aligned
// numeric columns, bold total row with the amount picked out in the skin's
// accent color — the same "auto format" look daBuildCellStyles gives Data
// Arrangement tables pushed onto this same canvas.
function bpBuildProposalCellStyles(skin, totalRows) {
  totalRows = totalRows || 5;
  const headFill = skin.bodyBg === '#0b1220' ? '#111827' : '#f8fafc';
  const rows = [];
  for (let r = 0; r < totalRows; r++) {
    const isHead = r === 0, isTotal = r === totalRows - 1, row = [];
    for (let c = 0; c < 4; c++) {
      row.push({
        align: c > 0 ? 'right' : 'left',
        bold: isHead || isTotal,
        color: isHead ? skin.headingColor : (isTotal && c === 3 ? skin.totalColor : null),
        fill: isHead ? headFill : null,
        topBorder: isTotal
      });
    }
    rows.push(row);
  }
  return rows;
}

async function bpInsertTemplateToCanvas(key, contentOverrides) {
  contentOverrides = contentOverrides || {};
  const skin = Object.assign({}, BP_CANVAS_SKINS[key] || BP_CANVAS_SKINS.modern, contentOverrides.colors || {});
  const label = BP_TEMPLATE_LABELS[key] || 'Business Proposal';
  bpCloseTemplateModal();

  const priceRowsIn = Array.isArray(contentOverrides.pricing) ? contentOverrides.pricing : [];
  const effectiveRows = Math.max(3, Math.min(BP_MAX_PRICING_ROWS, priceRowsIn.length || 3));
  const extraRowHeight = (effectiveRows - 3) * 28;
  if (priceRowsIn.length > BP_MAX_PRICING_ROWS && typeof toast === 'function') {
    toast('Showing the first ' + BP_MAX_PRICING_ROWS + ' line items on the page — for a longer breakdown, build the full table in Data Arrangement and push it in as a second page.', 'info');
  }

  const isNewDoc = pdfed.pages.length === 0;
  const bg = await bpRenderTemplateBg(key, contentOverrides.colors, priceRowsIn.length);
  // contentOverrides.brand lets Kadessa set the Brand Kit as part of the same
  // action that inserts the proposal (see bp_insert_template below) so a
  // company name/tagline given in chat doesn't need a separate bk_set_brand_kit
  // call first -- it still just calls bkSave, so it sticks for future proposals
  // exactly like saving it from the panel would.
  if (contentOverrides.brand) bkSave(contentOverrides.brand);
  const kit = bkLoad();
  const pg = {
    type: 'blank', dataUrl: bg, modified: true, edits: {}, textBlocks: [],
    label: 'Business Proposal', bgColor: skin.bodyBg, pageMM: [210, 297],
    placedTexts: [], placedTables: []
  };
  pdfed.pages.push(pg);
  const idx = pdfed.pages.length - 1;
  const headerTextColor = (skin.headerStyle === 'band' || skin.headerStyle === 'gradient') ? skin.headerText : skin.textColor;
  const headerMutedColor = (skin.headerStyle === 'band' || skin.headerStyle === 'gradient') ? 'rgba(255,255,255,0.82)' : skin.mutedColor;

  const addText = (text, x, y, fontSize, opts) => {
    pg.placedTexts.push(Object.assign({
      id: 'ptxt_' + (++pdfedPlacedTextSeq),
      text, x, y, fontSize,
      fontFamily: skin.fontFamily, color: skin.textColor,
      bold: false, italic: false, underline: false, align: 'left',
      locked: false, zIndex: pdfedNextZ(pg)
    }, opts || {}));
  };

  const c = contentOverrides;
  const deliverablesText = (Array.isArray(c.deliverables) && c.deliverables.length)
    ? c.deliverables.map(function(d){ return '•  ' + d; }).join('\n')
    : '•  Deliverable one\n•  Deliverable two\n•  Deliverable three';

  addText((kit && kit.company) || 'Your Company Name', 120, 26, 17, { color: headerTextColor, bold: true, w: 420 });
  addText((kit && kit.tagline) || 'Tagline goes here', 120, 54, 11, { color: headerMutedColor, w: 420 });
  addText(c.clientName || 'Client Name', 60, 156, 13, { bold: true, w: 200 });
  addText(c.date || 'DD Month YYYY', 284, 156, 13, { w: 200 });
  addText(c.validUntil || 'DD Month YYYY', 508, 156, 13, { w: 200 });
  addText(c.projectTitle || 'Project Title Goes Here', 60, 236, 24, { bold: true, italic: skin.italicTitle, w: 674 });
  addText(c.summary || "Describe the client's problem and how you plan to solve it, in two or three sentences.", 60, 300, 12.5, { w: 674 });
  addText(deliverablesText, 60, 404, 12.5, { w: 674 });
  addText(c.paymentTerms || '50% deposit to begin, balance due on delivery. Prices valid for 30 days from the date above.', 60, 700 + extraRowHeight, 12, { w: 674 });
  addText(c.signerName || 'Your Name', 60, 814 + extraRowHeight, 13, { bold: true, w: 300 });

  // Pricing rows: real line items from contentOverrides.pricing, up to
  // BP_MAX_PRICING_ROWS -- beyond that cap, only the first BP_MAX_PRICING_ROWS
  // are shown here (see the toast above) and a longer breakdown belongs in
  // Data Arrangement, pushed onto a second page via pipeline_da_to_pdf.
  // Total is computed from the given amounts unless c.total overrides it.
  const priceRows = priceRowsIn.slice(0, effectiveRows);
  const bodyRows = [];
  for (let i = 0; i < effectiveRows; i++) {
    const row = priceRows[i];
    bodyRows.push(row
      ? [row.description || 'Item description', String(row.qty != null ? row.qty : '1'), String(row.rate != null ? row.rate : '0'), String(row.amount != null ? row.amount : '0.00')]
      : ['Item description', '1', '0', '0.00']);
  }
  const computedTotal = priceRows.length
    ? priceRows.reduce(function(sum, row){ return sum + (parseFloat(row.amount) || 0); }, 0).toFixed(2)
    : '0.00';

  pg.placedTables.push({
    id: 'tbl_' + (++pdfedTableSeq),
    x: 60, y: 514, rows: effectiveRows + 2, cols: 4,
    colWidths: [374, 80, 110, 110], rowHeights: [30].concat(Array(effectiveRows).fill(28)).concat([32]),
    fontSize: 12, headerRow: true,
    cells: [['Description', 'Qty', 'Rate', 'Amount']].concat(bodyRows).concat([['Total', '', '', c.total != null ? String(c.total) : computedTotal]]),
    cellStyles: bpBuildProposalCellStyles(skin, effectiveRows + 2),
    locked: false, zIndex: pdfedNextZ(pg)
  });

  if (isNewDoc) {
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
    const ph = document.getElementById('pdfedPlaceholder');
    if (ph) ph.style.display = 'none';
    const cw = document.getElementById('pdfedCanvasWrap');
    if (cw) cw.style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar');
    if (tb) tb.style.visibility = 'visible';
    state.stats.pdfs++;
  }
  const totalEl = document.getElementById('prrTotalPages');
  if (totalEl) totalEl.textContent = pdfed.pages.length;
  state.stats.pages++;
  updateStats();

  navigate('pdfeditor');
  await pdfedBuildStrip();
  await pdfedGoto(idx);
  setTimeout(pdfedZoomFit, 60);

  toast(label + ' proposal added to your canvas — every field is editable', 'success');
  if (typeof swTrack === 'function') { try { swTrack('module_open', { module: 'proposals_canvas', template: key }); } catch (e) {} }
}

// ─── KADESSA: WORD/PDF REPORT -> REAL REPORT TEXT (build 259) ──────────────
// A Word report lands in Data Arrangement as a two-column Topic / Content
// dataset (headings in Topic, paragraphs in Content). Pushing that with
// pipeline_da_to_pdf drew it as a GRID, with the heading repeated on every
// row, so headings and body text were never real headings and body text on
// the page. This builds the report the way a person would type it: the
// document title as a heading, each section heading ONCE as a subheading,
// and every paragraph as its own body text box, all as real editable text
// (pdfedKadessaInsertPage). Refine Report then styles headings and body apart.
function kadessaIsProseDataset(ds) {
  return !!(ds && Array.isArray(ds.headers) && ds.headers.length === 2 &&
    String(ds.headers[0]).trim() === 'Topic' && String(ds.headers[1]).trim() === 'Content');
}
function kadessaFindProseDataset(name) {
  const list = (typeof daState !== 'undefined' && daState.datasets) || [];
  if (name) {
    const n = String(name).toLowerCase();
    const hit = list.find(d => kadessaIsProseDataset(d) && String(d.name || '').toLowerCase().indexOf(n) !== -1);
    if (hit) return hit;
  }
  const act = (typeof daGetActive === 'function') ? daGetActive() : null;
  if (kadessaIsProseDataset(act)) return act;
  for (let i = list.length - 1; i >= 0; i--) if (kadessaIsProseDataset(list[i])) return list[i];
  return null;
}
// ── Build 299: filtered report ──────────────────────────────────────────
// Row numbers (0-based) that the person's current Filter Rows view lets
// through, or null when no filter is on. Same rule check the grid uses, so
// what Kadessa sends to the editor is exactly what is on screen.
function kadessaFilteredRowIdxs(ds) {
  if (!ds || typeof daFilterActiveRules !== 'function') return null;
  const rules = daFilterActiveRules(ds);
  if (!rules.length) return null;
  const matchAll = daFilterGetState(ds).match !== 'any';
  const out = [];
  (ds.rows || []).forEach(function(_r, ri) {
    if (daFilterRowPasses(ds, ri, rules, matchAll)) out.push(ri);
  });
  return out;
}

// Extra context fields, only while a filter is on: how many rows the filter
// kept, the first 40 of them, and per-column stats over ALL kept rows, so
// Kadessa writes the three summaries from the filtered rows and not from the
// whole table.
function kadessaFilteredViewForContext(ds) {
  try {
    const idxs = kadessaFilteredRowIdxs(ds);
    if (!idxs) return {};
    const computed = daComputedRowsForExport(ds);
    const headers = ds.headers || [];
    const rows = idxs.map(function(ri) { return computed[ri] || []; });
    const round2 = function(n) { return Math.round(n * 100) / 100; };
    const stats = headers.map(function(h, ci) {
      const nums = [], counts = {};
      let nonEmpty = 0;
      rows.forEach(function(r) {
        const v = r[ci];
        if (v === '' || v === null || v === undefined) return;
        nonEmpty++;
        const n = daFilterNum(v);
        if (!isNaN(n)) nums.push(n);
        const k = String(v).trim();
        counts[k] = (counts[k] || 0) + 1;
      });
      const st = { colIdx: ci, header: h, nonEmptyCount: nonEmpty };
      if (nums.length && nums.length >= nonEmpty * 0.6) {
        const sum = nums.reduce(function(a, b) { return a + b; }, 0);
        st.numericCount = nums.length;
        st.sum = round2(sum);
        st.avg = round2(sum / nums.length);
        st.min = Math.min.apply(null, nums);
        st.max = Math.max.apply(null, nums);
      } else {
        st.topValues = Object.keys(counts)
          .sort(function(a, b) { return counts[b] - counts[a]; })
          .slice(0, 5)
          .map(function(k) { return { value: k, count: counts[k] }; });
      }
      return st;
    });
    const SHOW = 40;
    return {
      filteredRowCount: idxs.length,
      filteredRows: rows.slice(0, SHOW),
      filteredRowsTruncated: idxs.length > SHOW,
      filteredColumnStats: stats
    };
  } catch (e) {
    return {};
  }
}

// pipeline_filtered_report_to_pdf: the filtered rows only, as a table, come
// FIRST (with the report title above it), then the three summaries as
// editable text on the page after the table. Nothing outside the filter is sent.
async function kadessaFilteredReportToPdf(p) {
  p = p || {};
  const ds = daGetActive();
  if (!ds) throw new Error('no table is open');
  const idxs = kadessaFilteredRowIdxs(ds);
  if (!idxs) throw new Error('no row filter is on right now. Filter the rows first with da_set_filter, then build the report');
  if (!idxs.length) throw new Error('the filter matches no rows, so there is nothing to report on');
  const parts = [
    ["What's Happening", p.whats_happening],
    ['Why It Happened', p.why_it_happened],
    ['How It Can Be Improved', p.how_to_improve]
  ];
  parts.forEach(function(x) {
    if (!String(x[1] == null ? '' : x[1]).trim()) throw new Error('the "' + x[0] + '" summary is empty. Write all three summaries from the filtered rows and call this again');
  });
  const title = String(p.title || '').trim() || 'What Is Hurting the Business';
  const blocks = [{ type: 'heading', text: 'Summary' }];
  parts.forEach(function(x) {
    blocks.push({ type: 'subheading', text: x[0] });
    String(x[1]).split(/\n+/).forEach(function(par) {
      par = par.trim();
      if (par) blocks.push({ type: 'paragraph', text: par });
    });
  });

  navigate('pdfeditor');
  const reportStart = pdfed.pages.length;
  // 1) the filtered rows as a table, with the report title above it
  await daPushToWorkflow('new', {
    filteredOnly: true,
    titleText: title + ' (' + idxs.length + ' of ' + (ds.rows || []).length + ' rows)'
  });
  // 2) then the three summaries on a page right after the table
  await pdfedKadessaInsertPage({ position: 'end', content: blocks, default_align: 'left' });
  try {
    await pdfedBuildStrip();
    await pdfedGoto(reportStart);
    setTimeout(pdfedZoomFit, 60);
  } catch (e) {}
  toast('Report ready: ' + idxs.length + ' filtered row' + (idxs.length === 1 ? '' : 's') + ' in a table, then 3 summaries, all editable', 'success');
  return { rows: idxs.length, firstPage: reportStart + 1 };
}

async function kadessaInsertReportFromProse(p) {
  p = p || {};
  const ds = kadessaFindProseDataset(p.dataset_name);
  if (!ds) throw new Error('there is no written content to build a report from yet. Attach the Word or PDF report first');
  const rows = daComputedRowsForExport(ds);
  const title = String(ds.title || ds.name || '')
    .replace(/( \u2014 Content found on the page| \u2014 Table)$/, '')
    .replace(/\.(docx|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
  const blocks = [];
  if (title) blocks.push({ type: 'heading', text: title });
  let lastTopic = null, headingCount = 0;
  rows.forEach(function(r) {
    const topic = String(r[0] == null ? '' : r[0]).trim();
    const text = String(r[1] == null ? '' : r[1]).trim();
    if (!text) return;
    // Keyword-cluster labels ("Sales / Revenue / Growth") and "General" are
    // invented by the arranger for documents with no real headings. They
    // are not the author's words, so they are never shown as headings.
    const invented = topic === 'General' || /^[^\/]+( \/ [^\/]+)+$/.test(topic);
    if (topic && !invented && topic !== lastTopic) {
      blocks.push({ type: 'subheading', text: topic });
      headingCount++;
    }
    lastTopic = topic;
    blocks.push({ type: 'paragraph', text: text });
  });
  if (blocks.length <= (title ? 1 : 0)) throw new Error('that file had no paragraphs to put on a page');
  navigate('pdfeditor');
  const r = await pdfedKadessaInsertPage({ position: 'end', content: blocks, default_align: 'left' });
  toast('Report text placed: ' + headingCount + ' section heading' + (headingCount === 1 ? '' : 's') + ', all editable', 'success');
  return r;
}

// Called by the pipeline_details_to_proposal Kadessa action. This is the one
// place that guards against inserting a proposal with nothing real on it --
// if NONE of the core content fields were given, that means the person
// hasn't actually described the proposal yet, and Kadessa should be asking
// for client/project/deliverables/pricing in chat rather than calling this
// with guessed placeholders. Everything else (dates, terms, signer, brand
// colors) is fine to default quietly, same as bpInsertTemplateToCanvas
// already did for the manual/placeholder path.
async function kadessaInsertProposalFromDetails(p) {
  p = p || {};
  const hasCoreContent = p.clientName || p.projectTitle ||
    (Array.isArray(p.deliverables) && p.deliverables.length) ||
    (Array.isArray(p.pricing) && p.pricing.length);
  if (!hasCoreContent) {
    throw new Error('no proposal content given yet -- ask the person for the client, project, deliverables and pricing before calling this action');
  }
  const key = BP_TEMPLATE_LABELS[p.skin] ? p.skin : 'modern';
  // Brand: bpInsertTemplateToCanvas saves whatever it is given as the WHOLE
  // Brand Kit, so a name/tagline from chat used to wipe the saved logo. Merge
  // with the existing kit instead, and let Kadessa pass the logo the person just
  // attached in chat (use_attached_logo) without ever handling image data.
  const attachedLogo = (p.use_attached_logo === true && typeof pdfedRefineState !== 'undefined' && pdfedRefineState.logoDataUrl)
    ? pdfedRefineState.logoDataUrl : null;
  let mergedBrand = null;
  if (p.brand || attachedLogo) {
    const kitNow = bkLoad() || {};
    const b = p.brand || {};
    mergedBrand = {
      logo: attachedLogo || kitNow.logo || null,
      company: b.company || kitNow.company || '',
      tagline: b.tagline || kitNow.tagline || ''
    };
  }
  await bpInsertTemplateToCanvas(key, {
    brand: mergedBrand,
    colors: p.colors || null,
    clientName: p.clientName,
    date: p.date,
    validUntil: p.validUntil,
    projectTitle: p.projectTitle,
    summary: p.summary,
    deliverables: p.deliverables,
    pricing: p.pricing,
    total: p.total,
    paymentTerms: p.paymentTerms,
    signerName: p.signerName
  });
}

// Renders a slim header/rule-line treatment that echoes the main proposal
// page's own header (band/gradient fill, or a border/double/darkline rule)
// but scaled down for a continuation page, so a second page never looks
// like a random blank sheet stapled onto the proposal.
async function bpRenderContinuationBg(key, colorOverride, title) {
  const skin = Object.assign({}, BP_CANVAS_SKINS[key] || BP_CANVAS_SKINS.modern, colorOverride || {});
  const W = 794, H = 1123, scale = 2;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = skin.bodyBg;
  ctx.fillRect(0, 0, W, H);

  const thinH = 14;
  if (skin.headerStyle === 'band') {
    ctx.fillStyle = skin.headerBg; ctx.fillRect(0, 0, W, thinH);
  } else if (skin.headerStyle === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W, thinH);
    g.addColorStop(0, skin.gradFrom); g.addColorStop(1, skin.gradTo);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, thinH);
  } else {
    ctx.strokeStyle = skin.headerBorderColor || skin.lineColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, thinH); ctx.lineTo(W, thinH); ctx.stroke();
  }

  ctx.font = "800 10px 'Inter', sans-serif";
  ctx.fillStyle = skin.mutedColor;
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('PROPOSAL \u2014 CONTINUED', W - 60, 44);

  ctx.font = "800 20px 'Inter', sans-serif";
  ctx.fillStyle = skin.headingColor;
  ctx.textAlign = 'left';
  ctx.fillText(title || 'Additional Notes', 60, 90);
  ctx.strokeStyle = skin.lineColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, 104); ctx.lineTo(W - 60, 104); ctx.stroke();

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(c, 0, 0, W, H);
  return out.toDataURL('image/png');
}

// Adds a second (or Nth) page to the proposal -- Terms & Conditions, an
// extended scope writeup, anything text-based that doesn't fit on the main
// page -- styled to match the same skin. A timeline/Gantt chart still goes
// through the existing dg_* + pipeline_diagram_to_pdf actions, which already
// insert their own new page; this is specifically for TEXT continuation
// pages. Inserted right after the currently open page (matching
// pdfedKadessaInsertPage's own default), or at the end if none is open.
async function bpInsertContinuationPage(key, opts) {
  opts = opts || {};
  const skin = Object.assign({}, BP_CANVAS_SKINS[key] || BP_CANVAS_SKINS.modern, opts.colors || {});
  const title = opts.title || 'Additional Notes';
  const bg = await bpRenderContinuationBg(key, opts.colors, title);
  const pg = {
    type: 'blank', dataUrl: bg, modified: true, edits: {}, textBlocks: [],
    label: title, bgColor: skin.bodyBg, pageMM: [210, 297],
    placedTexts: [], placedTables: []
  };
  const insertAt = (pdfed.active >= 0 && pdfed.active < pdfed.pages.length) ? pdfed.active + 1 : pdfed.pages.length;
  pdfed.pages.splice(insertAt, 0, pg);

  let y = 140;
  const blocks = (Array.isArray(opts.blocks) && opts.blocks.length) ? opts.blocks : ['Add your terms and conditions here.'];
  blocks.forEach(function(text){
    pg.placedTexts.push({
      id: 'ptxt_' + (++pdfedPlacedTextSeq),
      text: text, x: 60, y: y, fontSize: 12.5,
      fontFamily: skin.fontFamily, color: skin.textColor,
      bold: false, italic: false, underline: false, align: 'left',
      locked: false, zIndex: pdfedNextZ(pg), w: 674
    });
    // Rough line-count estimate so stacked blocks don't overlap -- same
    // ballpark a wrapped-text auto-flow would use; good enough since every
    // block stays independently editable/movable afterward anyway.
    const approxLines = Math.max(1, Math.ceil(text.length / 90));
    y += approxLines * 18 + 24;
  });

  const totalEl = document.getElementById('prrTotalPages');
  if (totalEl) totalEl.textContent = pdfed.pages.length;
  state.stats.pages++;
  updateStats();
  await pdfedBuildStrip();
  await pdfedGoto(insertAt);
  setTimeout(pdfedZoomFit, 60);
  toast(title + ' page added to your proposal', 'success');
}
