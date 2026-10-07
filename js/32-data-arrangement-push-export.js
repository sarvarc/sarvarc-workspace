// ─── DATA ARRANGEMENT → PUSH TO WORKFLOW (Workspace canvas) ─────────────────
// Drops the active table straight onto the Workspace (PDF editor) canvas as
// a fully live, draggable/resizable/editable placed table, same object type
// pdfedInsertTable produces, sized and paginated automatically so it lands
// ready to use instead of arriving as one giant unreadable block.
//
// The page itself is sized to fit the table (not the other way round): the
// table's natural width/height is worked out from its own content first,
// then each page is created just big enough to hold it (never smaller than
// a standard A4, so small tables still land on a normal-looking page).
const DA_PUSH_MAX_COLS = 15; // matches the table element's own column cap
const DA_PUSH_MAX_ROWS = 29; // data rows per page (+1 header row = the 30-row cap)
const DA_PUSH_MARGIN = 60;   // page margin around the table, in canvas px

// Canvas px-per-mm at the density placed items actually live in, this is
// what pdfedRenderBlankPage's returned image (and so canvas.width/height)
// end up at, and what every placedTables x/y/width/height is measured in.
const DA_PUSH_PXMM = 3.7795;

// ── Push-to-Workspace: destination choice modal ──
// Before pushing a table, ask the user whether it should become brand-new
// page(s) in the Workspace, or be dropped onto the page currently open there.
// ── Push-flight micro-interaction ──
// Fires a short comet-trail dot from a clicked push button to a sidebar nav
// icon, then pulses the icon on arrival. Purely cosmetic and fire-and-forget:
// it never blocks or delays the real push logic that runs right after it's
// called, and since the whole app lives in one DOM (navigate() just toggles
// section visibility), the fixed-position dot keeps flying happily over
// whatever section becomes visible mid-flight.
function sarvarcFlyDot(fromEl, toEl, onArrive) {
  if (!fromEl || !toEl) { if (onArrive) onArrive(); return; }
  const s = fromEl.getBoundingClientRect();
  const e = toEl.getBoundingClientRect();
  const sx = s.left + s.width / 2, sy = s.top + s.height / 2;
  const ex = e.left + e.width / 2, ey = e.top + e.height / 2;
  // Bow the path outward/upward for an organic arc rather than a straight line.
  const cx = (sx + ex) / 2 - 40;
  const cy = Math.min(sy, ey) - 60;
  const pathStr = `path('M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}')`;
  const DURATION = 520;

  function fly(delay, scale, opacity, ghost) {
    setTimeout(() => {
      const dot = document.createElement('div');
      dot.className = 'sarvarc-dot-fx' + (ghost ? ' ghost' : '');
      dot.style.opacity = opacity;
      dot.style.offsetPath = pathStr;
      dot.style.offsetRotate = '0deg';
      document.body.appendChild(dot);
      const anim = dot.animate(
        [
          { offsetDistance: '0%',   opacity: opacity, transform: `scale(${scale})` },
          { offsetDistance: '55%',  opacity: opacity, transform: `scale(${scale * 1.05})` },
          { offsetDistance: '100%', opacity: 0,        transform: `scale(${scale * 0.4})` }
        ],
        { duration: DURATION - delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }
      );
      anim.onfinish = () => {
        dot.remove();
        if (!ghost) {
          toEl.classList.remove('sarvarc-push-hit');
          void toEl.offsetWidth; // restart the CSS pulse animation if it's already mid-run
          toEl.classList.add('sarvarc-push-hit');
          setTimeout(() => toEl.classList.remove('sarvarc-push-hit'), 480);
          if (onArrive) onArrive();
        }
      };
    }, delay);
  }

  fly(0, 1, 1, false);
  fly(40, 0.75, 0.45, true);
  fly(80, 0.55, 0.25, true);
}

// onArrive lets a caller delay the actual navigation/section-switch until the
// dot has visibly landed, instead of navigating the instant it launches —
// otherwise the source screen (and the flight itself) gets cut off mid-air.
function sarvarcAnimatedPush(buttonEl, targetNavId, onArrive) {
  const target = document.getElementById(targetNavId);
  if (!target || !buttonEl) { if (onArrive) onArrive(); return; }
  sarvarcFlyDot(buttonEl, target, onArrive);
}

function daOpenPushChoiceModal() {
  const ds = daGetActive();
  if (!ds) { toast('Upload a file first', 'info'); return; }
  if (!ds.headers || !ds.headers.length) { toast('Nothing to push yet', 'info'); return; }
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }

  // "Push All Tables" only makes sense when there's more than one table with
  // actual content sitting in Data Arrangement, so it's hidden otherwise.
  const pushableCount = daState.datasets.filter(d => d.headers && d.headers.length).length;
  const allCard = document.getElementById('daPushAllCard');
  if (allCard) {
    allCard.style.display = pushableCount > 1 ? '' : 'none';
    const title = document.getElementById('daPushAllCardTitle');
    if (title) title.textContent = `Push All ${pushableCount} Tables (Smart Layout)`;
  }

  const overlay = document.getElementById('daPushChoiceOverlay');
  if (overlay) overlay.classList.add('open');
}
function daClosePushChoice() {
  const overlay = document.getElementById('daPushChoiceOverlay');
  if (overlay) overlay.classList.remove('open');
}
function daConfirmPushChoice(mode, cardEl) {
  if (cardEl) sarvarcAnimatedPush(cardEl, 'navIcon-workspace');
  daClosePushChoice();
  daPushToWorkflow(mode);
}
function daConfirmPushAllChoice(cardEl) {
  if (cardEl) sarvarcAnimatedPush(cardEl, 'navIcon-workspace');
  daClosePushChoice();
  daPushAllToWorkflow();
}

// ── Push to Diagrams & Graphs: hand the active table straight to the chart
// builder instead of the PDF canvas. Reuses the exact same upload pipeline
// Diagrams & Graphs uses for a dropped CSV/XLSX file (daNormalize under the
// hood via dgOnUploadParsed), so column detection, the label/value selectors,
// the auto-generated chart, and the big-data multi-chart prompt all just work
// — no separate code path to keep in sync.
let daPendingDiagramPush = null;

function daPushToDiagrams(triggerEl) {
  const ds = daGetActive();
  if (!ds) { toast('Upload a file first', 'info'); return; }
  if (!ds.headers || !ds.headers.length) { toast('Nothing to push yet', 'info'); return; }
  if (!ds.rows || !ds.rows.length) { toast('This table has no rows to chart yet', 'info'); return; }
  if (typeof navigate !== 'function' || typeof dgOnUploadParsed !== 'function') { toast('Diagrams & Graphs module is unavailable right now', 'error'); return; }

  // dgOnUploadParsed expects a plain array-of-arrays (header row + data rows),
  // exactly what daNormalize would produce from a raw file upload.
  const aoa = [ds.headers.slice(), ...daComputedRowsForExport(ds)];
  const name = ds.name || 'Table data';

  // If Diagrams & Graphs already has a real chart loaded (not just the
  // default placeholder), ask before overwriting instead of silently
  // discarding whatever's there.
  if (typeof dgHasExistingChart === 'function' && dgHasExistingChart()) {
    daPendingDiagramPush = { aoa, name };
    const overlay = document.getElementById('daDiagramConflictOverlay');
    if (overlay) overlay.classList.add('open');
    return;
  }

  // No conflict to resolve — this click is the actual push. Wait for the
  // dot to visibly land on the sidebar icon before switching sections, so
  // the flight plays out fully over the still-visible table instead of
  // getting cut off the instant navigate() swaps the screen.
  if (triggerEl) {
    sarvarcAnimatedPush(triggerEl, 'navIcon-diagrams', () => {
      navigate('diagrams');
      dgOnUploadParsed(aoa, name);
      if (typeof dgSaveCurrentToHistory === 'function') dgSaveCurrentToHistory();
    });
    return;
  }

  navigate('diagrams');
  dgOnUploadParsed(aoa, name);
  // Record the pushed chart in history right away — this is what makes it
  // show up (and stay counted) in the Dashboard's "Charts & Diagrams" panel
  // even if it's later replaced by another push or edit.
  if (typeof dgSaveCurrentToHistory === 'function') dgSaveCurrentToHistory();
}

function daCancelDiagramPush() {
  daPendingDiagramPush = null;
  const overlay = document.getElementById('daDiagramConflictOverlay');
  if (overlay) overlay.classList.remove('open');
}

function daResolveDiagramPush(mode, cardEl) {
  const overlay = document.getElementById('daDiagramConflictOverlay');
  if (overlay) overlay.classList.remove('open');
  if (!daPendingDiagramPush) return;
  const { aoa, name } = daPendingDiagramPush;
  daPendingDiagramPush = null;

  function commit() {
    if (mode === 'saveNew' && typeof dgSaveCurrentToHistory === 'function') {
      dgSaveCurrentToHistory();
    }
    navigate('diagrams');
    dgOnUploadParsed(aoa, name);
    if (typeof dgSaveCurrentToHistory === 'function') dgSaveCurrentToHistory();
  }

  // Same principle as the direct push: let the dot finish its visible
  // flight from the clicked card before the section actually switches.
  if (cardEl) {
    sarvarcAnimatedPush(cardEl, 'navIcon-diagrams', commit);
  } else {
    commit();
  }
}

// ── Auto Format: professional report styling, computed straight from the
// data itself — no manual alignment/bolding needed. Two passes:
//   1. Per-column numeric detection → numeric columns get right-aligned.
//   2. Per-row total/subtotal detection (by label keyword) → that row gets
//      bold text, a top border, and a faint tint, the same way an audited
//      P&L or Balance Sheet visually announces its subtotal lines.
// Runs automatically on every push (single table or Push All / Smart
// Layout), and can also be re-run on demand via the per-table "Auto Format"
// badge for tables already sitting on the canvas.
const DA_TOTAL_ROW_RE = /^(grand\s+)?(total|sub-?total|net\s|gross\s|profit\s(before|after)?|balance\s(c\/f|b\/f|carried|brought)?|closing\s+balance|opening\s+balance)/i;

function daCellLooksNumericForFormat(v) {
  const s = String(v ?? '').trim();
  if (!s) return false;
  // Strip common financial-statement dressing (currency symbols, thousands
  // separators, %, and accounting-style negative parentheses) before testing.
  const cleaned = s.replace(/^\(|\)$/g, '').replace(/[\p{Sc},%\s]/gu, '');
  return cleaned !== '' && !isNaN(Number(cleaned));
}

// ── Smart Data-Type Detection ────────────────────────────────────────────────
// Looks at the header row only (fast, and headers are the most reliable
// signal — "Debit"/"Credit" or "Employee ID"/"Department" say a lot more
// about what a table *is* than scanning every cell would). Scored by
// keyword hits per category; a table needs at least 2 hits in one category
// to be called out specifically, otherwise it's treated as general data and
// only gets the existing numeric/total formatting.
function daNormHeader(h) {
  return String(h ?? '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const DA_TYPE_KEYWORDS = {
  hr: ['employee', 'emp id', 'emp code', 'emp no', 'designation', 'department', 'date of joining',
       'doj', 'salary', 'ctc', 'leave balance', 'attendance', 'manager', 'hire date', 'staff id',
       'gender', 'pf number', 'uan', 'esi number', 'shift'],
  // Checked ahead of the more generic "accounting" bucket below (object key
  // order = tie-break order in daDetectDataType) so a real bank statement —
  // which usually also picks up 1-2 generic accounting hits like
  // "narration" or "closing balance" — still gets called out specifically
  // as a bank statement rather than lumped in as plain accounting data.
  bank: ['withdrawal', 'deposit', 'value date', 'txn date', 'transaction date', 'chq no', 'cheque no',
       'chq/ref no', 'ref no', 'reference no', 'utr', 'ifsc', 'branch code', 'statement of account',
       'account statement', 'mode of payment', 'transaction id', 'txn id', 'balance', 'cr amt', 'dr amt',
       'withdrawal amt', 'deposit amt', 'transaction remarks'],
  // Checked ahead of plain "accounting" for the same reason as bank above —
  // a sales invoice / customer bill usually also has 1-2 generic accounting
  // hits ("invoice no", "gst no") but should read as Invoicing, not Accounting.
  invoicing: ['invoice number', 'invoice date', 'invoice id', 'tax invoice', 'bill to', 'ship to',
       'due date', 'subtotal', 'amount due', 'payment terms', 'line item', 'billing address',
       'invoice total', 'invoice status'],
  // Checked ahead of plain "sales" for the same reason — a purchase order
  // table often also picks up "quantity"/"unit price" hits that would
  // otherwise misclassify it as Sales.
  purchase: ['purchase order', 'po number', 'po no', 'vendor', 'supplier', 'purchase date',
       'goods received', 'grn', 'requisition', 'vendor name', 'vendor id', 'buyer name'],
  inventory: ['sku', 'stock', 'inventory', 'warehouse', 'reorder level', 'reorder point', 'on hand',
       'bin location', 'stock qty', 'opening stock', 'closing stock', 'stock in', 'stock out',
       'batch no', 'expiry date'],
  accounting: ['debit', 'credit', 'ledger', 'voucher', 'particulars', 'gstin', 'gst no', 'invoice no',
       'tds', 'pan no', 'cess', 'journal', 'opening balance', 'closing balance', 'narration',
       'bill no', 'account number', 'account no'],
  sales: ['product', 'sku', 'order id', 'order no', 'customer name', 'quantity', 'qty', 'unit price',
       'discount', 'item name', 'order date', 'revenue', 'customer id', 'sales rep'],
  crm: ['lead', 'contact name', 'account manager', 'opportunity', 'pipeline stage', 'lead source',
       'deal stage', 'churn', 'lead status', 'deal value', 'won lost'],
  marketing: ['campaign', 'impressions', 'clicks', 'ctr', 'conversion rate', 'ad spend', 'reach',
       'engagement rate', 'leads generated', 'cpc', 'cpm', 'roi', 'campaign name'],
  education: ['student', 'roll no', 'roll number', 'grade', 'marks', 'gpa', 'semester', 'course name',
       'exam', 'student id', 'attendance %', 'section', 'subject'],
  project: ['task', 'milestone', 'assignee', 'sprint', 'story points', 'epic', 'project name',
       'task status', 'priority', 'task id', 'blocked', 'reporter'],
  logistics: ['shipment', 'tracking number', 'tracking no', 'carrier', 'freight', 'origin',
       'destination', 'consignment', 'awb', 'bill of lading', 'container no', 'delivery date'],
  healthcare: ['patient', 'diagnosis', 'doctor', 'prescription', 'admission date', 'discharge date',
       'ward', 'patient id', 'symptom', 'treatment', 'physician'],
  real_estate: ['property', 'listing', 'sq ft', 'square feet', 'rent', 'lease', 'tenant', 'broker',
       'property id', 'possession date', 'built up area'],
};

const DA_TYPE_LABELS = {
  hr: 'HR & Payroll', bank: 'Bank Statement', invoicing: 'Invoicing & Billing', purchase: 'Purchase & Procurement',
  inventory: 'Inventory & Stock', accounting: 'Accounting', sales: 'Sales', crm: 'Customer / CRM',
  marketing: 'Marketing', education: 'Education / Academic', project: 'Project & Task Management',
  logistics: 'Logistics & Shipping', healthcare: 'Healthcare', real_estate: 'Real Estate', generic: 'General',
};

// Returns { type, label } — type is one of the DA_TYPE_KEYWORDS keys, or 'generic'.
// Header-only, scored by keyword hits per category; a table needs at least 2
// hits in one category to be called out specifically, otherwise it's treated
// as general data. Building `scores` from Object.keys(DA_TYPE_KEYWORDS)
// rather than a hardcoded list means new domains added above are picked up
// automatically, with no second place in the code to keep in sync.
function daDetectDataType(headers) {
  if (!headers || !headers.length) return { type: 'generic', label: DA_TYPE_LABELS.generic };
  const norm = headers.map(daNormHeader);
  const scores = {};
  Object.keys(DA_TYPE_KEYWORDS).forEach(type => {
    scores[type] = 0;
    DA_TYPE_KEYWORDS[type].forEach(kw => { if (norm.some(h => h.includes(kw))) scores[type]++; });
  });
  let best = 'generic', bestScore = 1; // need >=2 keyword hits to beat the "generic" default
  Object.keys(scores).forEach(type => { if (scores[type] >= 2 && scores[type] > bestScore) { best = type; bestScore = scores[type]; } });
  return { type: best, label: DA_TYPE_LABELS[best], score: bestScore, confident: best !== 'generic' && bestScore >= 3 };
}

// First header index whose normalized text contains any of `patterns`, or -1.
function daFindCol(headers, patterns) {
  const norm = (headers || []).map(daNormHeader);
  for (let i = 0; i < norm.length; i++) if (patterns.some(p => norm[i].includes(p))) return i;
  return -1;
}

// Per-type header tint, so a table visibly announces what kind of data it
// holds the moment it lands on the canvas.
const DA_HEADER_FILL = {
  hr: 'rgba(0,150,136,0.14)',
  bank: 'rgba(8,145,178,0.14)',
  invoicing: 'rgba(124,77,255,0.14)',
  purchase: 'rgba(230,81,0,0.14)',
  inventory: 'rgba(93,64,55,0.14)',
  accounting: 'rgba(0,115,230,0.14)',
  sales: 'rgba(255,152,0,0.14)',
  crm: 'rgba(216,27,96,0.14)',
  marketing: 'rgba(255,64,129,0.14)',
  education: 'rgba(63,81,181,0.14)',
  project: 'rgba(0,150,136,0.14)',
  logistics: 'rgba(0,172,193,0.14)',
  healthcare: 'rgba(211,47,47,0.14)',
  real_estate: 'rgba(85,139,47,0.14)',
  generic: 'rgba(15,23,42,0.05)',
};

// A blank cell in Data Arrangement's own grid already displays as "—" (see
// daRenderTable) so an empty cell reads as "intentionally blank" rather than
// "missing/broken data" — but that's purely a display trick in the grid
// renderer; the stored value underneath stays '' so formulas/exports keep
// treating it as truly empty. Pushing a table onto the canvas builds a
// separate, static cells array from those raw values, so without this it
// silently loses the placeholder and just prints nothing. Used only for the
// canvas push — CSV/Excel export intentionally keeps true blanks so the
// data stays clean for re-import.
function daPushCellDisplay(v) {
  const s = String(v ?? '').trim();
  return s === '' ? '—' : String(v);
}

// Builds a per-cell style grid parallel to `cells` (row 0 = header). Safe to
// call on any headers+rows table shape; returns [] for an empty table.
// Automatically detects the data's "shape" (HR, Bank Statement, Accounting,
// Sales, or General) from the header row and layers type-specific touches
// on top of the base numeric/total formatting: HR bolds the name column and
// italicizes department/designation; Accounting colors Debit red and
// Credit green; Bank Statement colors Withdrawal red and Deposit green and
// bolds the running Balance column; every type gets its own header tint so
// the canvas visually sorts tables by kind at a glance.
function daBuildCellStyles(cells) {
  if (!cells || !cells.length) return [];
  const rowCount = cells.length, colCount = cells[0].length;
  const dataRows = cells.slice(1);
  const headers = cells[0];

  const numericCol = new Array(colCount).fill(false);
  for (let c = 0; c < colCount; c++) {
    let filled = 0, numeric = 0;
    dataRows.forEach(r => {
      const v = r[c];
      if (String(v ?? '').trim() !== '') { filled++; if (daCellLooksNumericForFormat(v)) numeric++; }
    });
    numericCol[c] = filled > 0 && (numeric / filled) >= 0.6;
  }

  const dtype = daDetectDataType(headers).type;
  let nameCol = -1, deptCol = -1, debitCol = -1, creditCol = -1, balanceCol = -1;
  if (dtype === 'hr') {
    nameCol = daFindCol(headers, ['name']);
    deptCol = daFindCol(headers, ['department', 'dept', 'designation']);
  } else if (dtype === 'accounting') {
    debitCol = daFindCol(headers, ['debit']);
    creditCol = daFindCol(headers, ['credit']);
  } else if (dtype === 'bank') {
    // Bank statements label the two amount columns all sorts of ways
    // ("Withdrawal Amt" vs "Debit", "Deposit" vs "Credit") — check the
    // bank-specific wording first, then fall back to the plain
    // debit/credit terms some statements still use.
    debitCol = daFindCol(headers, ['withdrawal', 'dr amt', 'debit']);
    creditCol = daFindCol(headers, ['deposit', 'cr amt', 'credit']);
    balanceCol = daFindCol(headers, ['closing balance', 'running balance', 'balance']);
  }

  const styles = [];
  for (let r = 0; r < rowCount; r++) {
    const isHead = r === 0;
    const rowLabel = String((cells[r] && cells[r][0]) ?? '').trim();
    const isTotalRow = !isHead && DA_TOTAL_ROW_RE.test(rowLabel);
    const rowStyles = [];
    for (let c = 0; c < colCount; c++) {
      const st = {
        align: numericCol[c] ? 'right' : 'left',
        bold: isHead || isTotalRow,
        italic: false,
        color: null,
        topBorder: isTotalRow,
        fill: isTotalRow ? 'rgba(0,115,230,0.07)' : null,
      };
      if (isHead) {
        st.fill = DA_HEADER_FILL[dtype] || DA_HEADER_FILL.generic;
      } else if (!isTotalRow) {
        const cellVal = String((cells[r] && cells[r][c]) ?? '').trim();
        if (dtype === 'hr' && c === nameCol) st.bold = true;
        if (dtype === 'hr' && c === deptCol) st.italic = true;
        if (dtype === 'accounting' && c === debitCol && cellVal !== '') st.color = '#c62828';
        if (dtype === 'accounting' && c === creditCol && cellVal !== '') st.color = '#2e7d32';
        if (dtype === 'bank' && c === debitCol && cellVal !== '') st.color = '#c62828';
        if (dtype === 'bank' && c === creditCol && cellVal !== '') st.color = '#2e7d32';
        if (dtype === 'bank' && c === balanceCol && cellVal !== '') st.bold = true;
      }
      rowStyles.push(st);
    }
    styles.push(rowStyles);
  }
  return styles;
}

// Manual re-format for a table already placed on the canvas (older tables,
// or ones the user has since edited/reordered) — recomputes from its
// current cell contents and re-renders in place.
function pdfedAutoFormatTable(idx, id) {
  const pg = pdfed.pages[idx];
  const item = (pg && pg.placedTables || []).find(i => i.id === id);
  if (!item) return;
  item.cellStyles = daBuildCellStyles(item.cells);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  toast('Table auto-formatted', 'success');
}

// ── Refine Report ───────────────────────────────────────────────────────
// One button, a couple of quick questions, and a single pass over every
// page in the document: every table's header row gets the same treatment
// (instead of whatever color/weight it happened to arrive with), table
// fonts grow or shrink to whatever's actually readable inside their own
// columns, headings share one font + a clean two-level size scale, and
// tables that were dropped at odd offsets get straightened onto a common
// margin. The whole thing is one undo-able step.

// `font` is the DISPLAY face — headings and table text, both already sized
// and weighted to read as titles/data, where a geometric sans or a confident
// serif carries its own visual weight fine.
// `bodyFont` is the READING face for ordinary paragraph text boxes (e.g. a
// "Management Remarks" block) — picked from the professional-document
// pairings lawyers/CAs actually expect (serif body for financial/legal-style
// prose, a plain workhorse sans everywhere else), since a display face at
// paragraph size and line-length reads noticeably less professional than the
// same face used sparingly for headings.
const PDFED_REFINE_THEMES = {
  general:   { label: 'General',   font: 'Inter',                        bodyFont: 'Inter, Arial, sans-serif',            headerFill: 'rgba(15,23,42,0.07)',   accent: '#0f172a' },
  financial: { label: 'Financial', font: 'Georgia, Cambria, serif',      bodyFont: '"Times New Roman", Times, serif',     headerFill: 'rgba(0,115,230,0.13)',  accent: '#0073e6' },
  corporate: { label: 'Corporate', font: 'Arial, Helvetica, sans-serif', bodyFont: 'Calibri, Candara, Arial, sans-serif', headerFill: 'rgba(0,121,107,0.13)',  accent: '#00796b' },
  modern:    { label: 'Modern',    font: 'Poppins, Inter, sans-serif',   bodyFont: 'Inter, Roboto, sans-serif',           headerFill: 'rgba(124,58,237,0.11)', accent: '#7c3aed' },
};

// ── Smart header icons (Modern theme) ──────────────────────────────────
// A small outline-icon set, drawn from one shared shape definition per icon
// so the exact same glyph renders two ways: as inline SVG in the live DOM
// table editor, and stroked directly onto the export canvas for the actual
// PDF/PNG/image output — the two are never allowed to drift out of sync.
// Every icon is authored on a 24x24 grid using only rects/circles/ellipses/
// lines/polylines/arcs, so both renderers can walk the same definition.
const PDFED_HEADER_ICONS = {
  company:     { rects: [[3,8,18,12,1],[9,4,6,3,1]], lines: [[3,14,21,14]] },
  person:      { circles: [[12,8,3.3]], arcs: [[12,23,8.5,3.49,6.02]] },
  team:        { circles: [[8,9,2.8],[16,9,2.8]], arcs: [[7.5,21,6,3.49,6.02],[17,21,6.3,3.55,5.95]] },
  email:       { rects: [[3,5,18,14,1]], polylines: [[[3,6],[12,14],[21,6]]] },
  phone:       { rects: [[7,2,10,20,3]], lines: [[10,18,14,18]] },
  location:    { circles: [[12,9,2.2]], polylines: [[[6.5,9],[12,21],[17.5,9]]] },
  website:     { circles: [[12,12,9]], lines: [[3,12,21,12]], ellipses: [[12,12,4,9]] },
  date:        { rects: [[3,5,18,16,2]], lines: [[3,10,21,10],[8,3,8,7],[16,3,16,7]] },
  time:        { circles: [[12,12,9]], lines: [[12,12,12,7],[12,12,16,14]] },
  amount:      { rects: [[3,6,18,13,2]], lines: [[3,10,21,10]], circles: [[17,15.5,1.3]] },
  percent:     { circles: [[7,7,2],[17,17,2]], lines: [[6,18,18,6]] },
  status:      { circles: [[12,12,9]], polylines: [[[8,12.5],[11,15.5],[16,9]]] },
  quantity:    { lines: [[5,20,5,12],[12,20,12,8],[19,20,19,15]] },
  description: { rects: [[5,3,14,18,1]], lines: [[8,8,16,8],[8,12,16,12],[8,16,13,16]] },
  id:          { lines: [[9,4,7,20],[16,4,14,20],[4,9,19,9],[4,15,19,15]] },
  category:    { polylines: [[[4,5],[15,5],[21,11],[15,17],[4,17],[4,5]]], circles: [[8,11,1.4]] },
  // Added for section-title icons (see PDFED_SECTION_ICON_RULES) — these
  // read as whole-section glyphs (a little chart, a bank building, a
  // compliance shield) rather than per-column header marks.
  chart:       { rects: [[4,13,4,8,1],[10,8,4,13,1],[16,3,4,18,1]] },
  bank:        { polylines: [[[2,9],[12,3],[22,9]]], lines: [[2,9,22,9],[5,9,5,18],[10,9,10,18],[14,9,14,18],[19,9,19,18],[2,20,22,20]] },
  shield:      { polylines: [[[12,2],[20,5],[20,11],[12,22],[4,11],[4,5],[12,2]],[[8.5,12],[11,14.5],[15.5,9]]] },
  checklist:   { rects: [[5,4,14,18,2],[9,2,6,3,1]], polylines: [[[8,10.5],[10,12.5],[14.5,8.5]]], lines: [[8,16,16,16]] },
  remarks:     { rects: [[3,4,18,12,3]], polylines: [[[7,16],[7,20],[11,16]]], lines: [[7,9,17,9],[7,12,14,12]] },
};

// Which whole-section icon (drawn from the same PDFED_HEADER_ICONS shape
// library) fits a section title's own wording — e.g. "Working Capital
// Analysis" reads as a chart, "Compliance Checklist" reads as a shield.
// Ordered most-specific-first, same convention as PDFED_HEADER_ICON_RULES;
// first match wins, and an unrecognized title is simply left with no icon
// rather than guessing.
const PDFED_SECTION_ICON_RULES = [
  { icon: 'bank',        re: /\b(bank(ing)?|facilit(y|ies)|loan|overdraft|credit\s*line)\b/i },
  { icon: 'shield',      re: /\b(compliance|audit(or'?s)?|statutory|regulatory|governance|security)\b/i },
  { icon: 'checklist',   re: /\b(checklist|to-?do|action\s*items?|tasks?)\b/i },
  { icon: 'remarks',     re: /\b(management\s*remarks?|remarks?|comments?|observations?)\b/i },
  { icon: 'chart',       re: /\b(working\s*capital|cash\s*flow|financial\s*(analysis|summary|performance|ratios?)|turnover|profit(ability)?|margin\s*analysis|analytics|kpis?)\b/i },
  { icon: 'amount',      re: /\b(invoice|billing|balance\s*sheet|p\s*&\s*l|profit\s*&?\s*loss|revenue|payment|expenses?|receivables?|payables?|inventory|stock|asset(s)?|liabilit(y|ies)|depreciation|provision(s)?|reserves?|equity|capital|fund(s)?|ledger|statement(s)?|balance)\b/i },
  { icon: 'percent',     re: /\b(tax(es)?|gst|ratio|percentage)\b/i },
  { icon: 'team',        re: /\b(team|staff|hr|human\s*resources|department|payroll)\b/i },
  { icon: 'person',      re: /\b(client|customer|employee|contact\s*(person|details))\b/i },
  { icon: 'date',        re: /\b(timeline|schedule|calendar|history|ageing|aging)\b/i },
  { icon: 'location',    re: /\b(location|address|branch(es)?|site)\b/i },
  { icon: 'company',     re: /\b(company|organi[sz]ation(al)?|profile|corporate|business)\s*(overview|profile|details|information)?\b/i },
  { icon: 'description', re: /\b(summary|overview|description|details|particulars|highlights)\b/i },
];

// Detects the best-fit whole-section icon for a heading/title's own text —
// null when nothing recognizable matches.
function pdfedDetectSectionIcon(headingText) {
  const txt = String(headingText || '').trim();
  if (!txt) return null;
  for (const rule of PDFED_SECTION_ICON_RULES) {
    if (rule.re.test(txt)) return rule.icon;
  }
  return null;
}

// Renders one icon as a standalone data: URI image (fixed stroke color,
// since a standalone <img>/placedImage has no CSS context to resolve
// currentColor against) — used to plant a section-title icon as a small
// placedImage next to a heading. size is the icon's rendered px box.
function pdfedSectionIconDataUrl(key, color, size) {
  const svg = pdfedIconToSVG(key, size).replace('stroke="currentColor"', `stroke="${color}"`);
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// Just the raw shape markup for one icon (no wrapping <svg>) — shared by
// pdfedIconToSVG (outline icon, transparent) and the badge renderer below
// (filled square, white icon) so both draw from the exact same glyph.
function pdfedIconShapeMarkup(key) {
  const def = PDFED_HEADER_ICONS[key];
  if (!def) return '';
  const parts = [];
  (def.rects || []).forEach(([x, y, w, h, r]) => {
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ''}/>`);
  });
  (def.circles || []).forEach(([cx, cy, r]) => parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`));
  (def.ellipses || []).forEach(([cx, cy, rx, ry]) => parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`));
  (def.lines || []).forEach(([x1, y1, x2, y2]) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`));
  (def.polylines || []).forEach(pts => parts.push(`<polyline points="${pts.map(p => p.join(',')).join(' ')}"/>`));
  (def.arcs || []).forEach(([cx, cy, r, a1, a2]) => {
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = ((a2 - a1) % (Math.PI * 2)) > Math.PI ? 1 : 0;
    parts.push(`<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"/>`);
  });
  return parts.join('');
}

// The section-title badge: a softly tinted rounded square (a light tint of
// the theme's accent — or the logo's own extracted color, when "Match
// report colors to logo" is on, see pdfedResolveRefineTheme) with the icon
// itself stroked in that same accent color on top — an icon "chip", not a
// solid filled block. This is the quiet, editorial-report look (icon reads
// as part of the page, not as a UI button), as opposed to a heavy filled
// badge which reads more like an app icon than a document element. size is
// the badge's rendered px box (both width and height, always square).
function pdfedSectionIconBadgeDataUrl(key, accentColor, size) {
  const shape = pdfedIconShapeMarkup(key);
  if (!shape) return null;
  const r = 7; // corner radius in the icon's own 0-24 coordinate space
  const tint = pdfedHexToRgba(accentColor, 0.13);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<rect x="0" y="0" width="24" height="24" rx="${r}" fill="${tint}"/>` +
    `<g fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shape}</g>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// The thin gradient rule placed under each section heading — accent color
// fading to a lighter tint of itself along the same hue, left to right —
// the crisp, colorful accent line that does the actual "highlighting" of
// the heading, in place of a heavy filled background band. Sits directly
// above the heading's associated table so it reads as the table's own
// title rule. w/h are the rendered px box of the bar image.
function pdfedSectionDividerDataUrl(color, w, h) {
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const light = pdfedShadeHex(color, 0.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="${color}"/>` +
    `<stop offset="100%" stop-color="${light}"/>` +
    `</linearGradient></defs>` +
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="url(#${id})"/>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// Ordered most-specific-first so e.g. a "Contact Person" column matches
// person, not phone, and "Email" never falls through to the generic
// company/person buckets. First matching rule wins.
const PDFED_HEADER_ICON_RULES = [
  { icon: 'email',       re: /\be-?mail\b/i },
  { icon: 'phone',       re: /\b(phone|mobile|contact\s*no\.?|contact\s*number|tel(ephone)?|cell)\b/i },
  { icon: 'location',    re: /\b(address|location|city|place|region|branch|site)\b/i },
  { icon: 'website',     re: /\b(website|url|domain|web\s*link|link)\b/i },
  { icon: 'date',        re: /\b(date|day|month|year|dob|deadline|due\s*date|issued?\s*date)\b/i },
  { icon: 'time',        re: /\b(time|duration|hour|hrs?)\b/i },
  { icon: 'percent',     re: /(%|\bpercent(age)?\b|\bmargin\b|\btax\s*rate\b)/i },
  { icon: 'amount',      re: /\b(amount|total|price|cost|value|revenue|salary|fee|payment|paid|balance|subtotal|grand\s*total|gst|tax\s*amount|invoice\s*amount)\b/i },
  { icon: 'status',      re: /\b(status|state|approved|completed|stage)\b/i },
  { icon: 'quantity',    re: /\b(qty|quantity|units?|count|stock|inventory)\b/i },
  { icon: 'id',          re: /\b(id|no\.?|number|sr\.?\s*no\.?|serial|code|ref(erence)?|sku|invoice\s*no\.?|order\s*no\.?)\b/i },
  { icon: 'category',    re: /\b(category|type|class|tag|label)\b/i },
  { icon: 'company',     re: /\b(company|organi[sz]ation|firm|vendor|supplier|business)\b/i },
  { icon: 'team',        re: /\b(team|department|dept\.?|staff|group)\b/i },
  { icon: 'person',      re: /\b(name|employee|customer|client|person)\b/i },
  { icon: 'description', re: /\b(description|details|remarks|notes?|summary|particulars|items?)\b/i },
];

// Detects the best-fit icon key for a header cell's own text — null when
// nothing recognizable matches, so an unrecognized column is simply left
// with no icon rather than guessing.
function pdfedDetectHeaderIcon(headerText) {
  const txt = String(headerText || '').trim();
  if (!txt) return null;
  for (const rule of PDFED_HEADER_ICON_RULES) {
    if (rule.re.test(txt)) return rule.icon;
  }
  return null;
}

// Renders one icon as a standalone inline <svg> string (used inside the
// live, editable DOM table header cells). stroke="currentColor" so it
// always matches whatever color the header text itself is drawn in.
function pdfedIconToSVG(key, size) {
  const def = PDFED_HEADER_ICONS[key];
  if (!def) return '';
  const parts = [];
  (def.rects || []).forEach(([x, y, w, h, r]) => {
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ''}/>`);
  });
  (def.circles || []).forEach(([cx, cy, r]) => parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`));
  (def.ellipses || []).forEach(([cx, cy, rx, ry]) => parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`));
  (def.lines || []).forEach(([x1, y1, x2, y2]) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`));
  (def.polylines || []).forEach(pts => parts.push(`<polyline points="${pts.map(p => p.join(',')).join(' ')}"/>`));
  (def.arcs || []).forEach(([cx, cy, r, a1, a2]) => {
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = ((a2 - a1) % (Math.PI * 2)) > Math.PI ? 1 : 0;
    parts.push(`<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`;
}

// Strokes the same icon definition directly onto a canvas context — used
// when baking the header row into the actual exported PDF/PNG, since that
// path never touches the DOM. Coordinates are authored in a 0-24 box; the
// translate+scale below maps that box onto a `size`-px square at (x,y),
// and — because canvas scaling affects line width too — a lineWidth set in
// that same 0-24 space naturally comes out to a consistent on-page stroke.
function pdfedDrawIconOnCtx(ctx, key, x, y, size, color) {
  const def = PDFED_HEADER_ICONS[key];
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  (def.rects || []).forEach(([rx, ry, rw, rh, rr]) => {
    ctx.beginPath();
    if (rr && ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, rr); else ctx.rect(rx, ry, rw, rh);
    ctx.stroke();
  });
  (def.circles || []).forEach(([cx, cy, r]) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
  (def.ellipses || []).forEach(([cx, cy, rx, ry]) => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); });
  (def.lines || []).forEach(([x1, y1, x2, y2]) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); });
  (def.polylines || []).forEach(pts => {
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
    ctx.stroke();
  });
  (def.arcs || []).forEach(([cx, cy, r, a1, a2]) => { ctx.beginPath(); ctx.arc(cx, cy, r, a1, a2); ctx.stroke(); });
  ctx.restore();
}

let pdfedRefineState = {
  theme: 'general', align: 'left',
  logoDataUrl: null, logoColors: [], logoAccent: null,
  useLogoColors: true, addLogoToHeader: true,
  logoPosition: 'right', // 'left' | 'center' | 'right' — where the logo sits in the header on every page
  watermarkEnabled: false, // large, centered, low-opacity copy of the logo sitting behind the page content
  watermarkOpacity: 0.1, // 0.04–0.35, set via the Logo step's opacity slider
  // Header text — title/subheading sit beside the logo; contact/address stay
  // small underneath. All optional; blank fields are simply skipped.
  headerTitle: '', headerSubheading: '', headerContact: '', headerAddress: '',
  headerTextPosition: 'left', // 'left' | 'right' — which side of the header this whole text group sits on, independent of the logo's own placement

  footerEnabled: false, // when true, contact + address are repeated small & centered in the footer of every page
};

// Handles a click on one of the Logo placement buttons in the refine modal.
function pdfedSetRefineLogoPosition(pos, el) {
  pdfedRefineState.logoPosition = pos;
  document.querySelectorAll('#pdfedRefineLogoPositionGroup .da-dropdown-scope-btn')
    .forEach(b => b.classList.toggle('active', b === el));
  pdfedUpdateRefinePreview();
}

// Handles the "Add logo as background watermark" checkbox in the Logo
// step — shows/hides the opacity slider right underneath it and keeps the
// live preview card in sync.
function pdfedToggleRefineWatermark(checked) {
  pdfedRefineState.watermarkEnabled = checked;
  const row = document.getElementById('pdfedRefineWatermarkOpacityRow');
  if (row) row.style.display = checked ? 'flex' : 'none';
  pdfedUpdateRefinePreview();
}

// Handles the watermark opacity slider (4%–35%) — updates state, the % label
// next to the slider, and the live preview in the same pass so dragging
// feels instant.
function pdfedSetRefineWatermarkOpacity(value) {
  const pct = Math.max(4, Math.min(35, parseInt(value, 10) || 10));
  pdfedRefineState.watermarkOpacity = pct / 100;
  const label = document.getElementById('pdfedRefineWatermarkOpacityVal');
  if (label) label.textContent = pct + '%';
  pdfedUpdateRefinePreview();
}

// Handles a click on one of the Header text placement buttons (Left/Right)
// in the refine modal — independent of where the logo itself sits, so a
// person can pair a right-side logo with a right-side text block (both
// stacked on the same side) instead of always defaulting to opposite sides.
function pdfedSetRefineTextPosition(pos, el) {
  pdfedRefineState.headerTextPosition = pos;
  document.querySelectorAll('#pdfedRefineTextPositionGroup .da-dropdown-scope-btn')
    .forEach(b => b.classList.toggle('active', b === el));
  pdfedUpdateRefinePreview();
}

// Builds the effective theme for a refine pass: the chosen preset, unless a
// logo was uploaded and "Match report colors to logo" is on, in which case
// the preset's accent/header-fill colors are swapped for ones read straight
// off the logo — so headings, table header rows, and section icons all
// pick up the brand color automatically.
function pdfedResolveRefineTheme(opts) {
  const base = PDFED_REFINE_THEMES[opts.theme] || PDFED_REFINE_THEMES.general;
  if (opts.useLogoColors && opts.logoAccent) {
    return Object.assign({}, base, {
      accent: opts.logoAccent,
      headerFill: pdfedHexToRgba(opts.logoAccent, 0.13),
    });
  }
  return base;
}

function pdfedHexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Blends a hex color toward black (negative percent) or white (positive
// percent) — used to derive a matching darker/lighter stop for a two-tone
// gradient from a single theme accent color, e.g. the badge and divider
// gradients below, without needing a second color defined per theme.
function pdfedShadeHex(hex, percent) {
  const h = String(hex || '').replace('#', '');
  let r = parseInt(h.substring(0, 2), 16) || 0;
  let g = parseInt(h.substring(2, 4), 16) || 0;
  let b = parseInt(h.substring(4, 6), 16) || 0;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  r = Math.round((t - r) * p) + r;
  g = Math.round((t - g) * p) + g;
  b = Math.round((t - b) * p) + b;
  const toHex = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Samples a logo image down to a small canvas and picks out its most
// prominent, actually-colorful pixels (skipping near-white, near-black, and
// near-grey ones so the result reads as "the brand color" rather than the
// background or an anti-aliased edge). Returns up to 3 hex colors, most
// prominent first — [] if the image can't be read (e.g. a tainted canvas
// from a cross-origin source) or nothing colorful enough is found.
async function pdfedExtractLogoColors(dataUrl) {
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
  } catch (e) { return []; }
  const size = 48;
  const cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  let data;
  try { data = ctx.getImageData(0, 0, size, size).data; }
  catch (e) { return []; }
  const buckets = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 100) continue; // skip transparent background pixels
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    if (lum > 240 || lum < 15) continue; // skip near-white / near-black
    if (max - min < 14) continue; // skip greys — want an actual brand hue
    const key = [Math.round(r / 24) * 24, Math.round(g / 24) * 24, Math.round(b / 24) * 24].join(',');
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(Number);
      return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    });
}

// Reads a logo File, extracts its brand colors, and stores it into
// pdfedRefineState -- the single place both the modal's own file input and
// Kadessa's attachment icon (see KADESSA ASSISTANT MODULE) feed a logo through,
// so a logo handed to Kadessa in chat behaves identically to one uploaded by
// hand in the Refine Report modal. Returns the dataUrl via the promise so a
// caller (like Kadessa's attachment handler) can also show a thumbnail chip.
function pdfedSetRefineLogoFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      pdfedRefineState.logoDataUrl = dataUrl;
      let colors = [];
      try { colors = await pdfedExtractLogoColors(dataUrl); } catch (err) { console.error('Logo color extraction failed', err); }
      pdfedRefineState.logoColors = colors;
      pdfedRefineState.logoAccent = colors[0] || null;
      pdfedUpdateLogoPreviewUI();
      pdfedUpdateRefinePreview();
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error('Could not read that logo file'));
    reader.readAsDataURL(file);
  });
}

// Reads the uploaded logo file, extracts its brand colors, and updates the
// modal's preview/swatch UI. Thin wrapper around pdfedSetRefineLogoFromFile
// for the modal's own <input type=file> onchange handler.
function pdfedHandleLogoFileInput(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  pdfedSetRefineLogoFromFile(file).catch(() => toast('Could not read that logo file', 'error'));
}

function pdfedClearRefineLogo() {
  pdfedRefineState.logoDataUrl = null;
  pdfedRefineState.logoColors = [];
  pdfedRefineState.logoAccent = null;
  // No logo left to watermark with — fold the option back down too, rather
  // than leaving a checked-but-hidden watermark toggle that would silently
  // resurface (with nothing to show) if a logo gets uploaded again.
  pdfedRefineState.watermarkEnabled = false;
  const input = document.getElementById('pdfedRefineLogoInput');
  if (input) input.value = '';
  const wmCheckbox = document.getElementById('pdfedRefineWatermarkEnabled');
  if (wmCheckbox) wmCheckbox.checked = false;
  const wmOpacityRow = document.getElementById('pdfedRefineWatermarkOpacityRow');
  if (wmOpacityRow) wmOpacityRow.style.display = 'none';
  pdfedUpdateLogoPreviewUI();
  pdfedUpdateRefinePreview();
}

// Reflects pdfedRefineState's logo fields into the modal: preview thumbnail,
// detected color swatches, and the two logo-dependent checkboxes.
function pdfedUpdateLogoPreviewUI() {
  const img = document.getElementById('pdfedRefineLogoPreviewImg');
  const label = document.getElementById('pdfedRefineLogoDropLabel');
  const status = document.getElementById('pdfedRefineLogoStatus');
  const swatchWrap = document.getElementById('pdfedRefineLogoSwatches');
  const useColorsRow = document.getElementById('pdfedRefineUseLogoColorsRow');
  const addLogoRow = document.getElementById('pdfedRefineAddLogoRow');
  const removeBtn = document.getElementById('pdfedRefineRemoveLogoBtn');
  const positionField = document.getElementById('pdfedRefineLogoPositionField');
  const watermarkRow = document.getElementById('pdfedRefineWatermarkRow');
  const watermarkOpacityRow = document.getElementById('pdfedRefineWatermarkOpacityRow');
  const hasLogo = !!pdfedRefineState.logoDataUrl;

  if (img) { img.src = hasLogo ? pdfedRefineState.logoDataUrl : ''; img.style.display = hasLogo ? 'block' : 'none'; }
  if (label) label.style.display = hasLogo ? 'none' : 'flex';
  if (useColorsRow) useColorsRow.style.display = hasLogo && pdfedRefineState.logoColors.length ? 'flex' : 'none';
  if (addLogoRow) addLogoRow.style.display = hasLogo ? 'flex' : 'none';
  if (removeBtn) removeBtn.style.display = hasLogo ? 'block' : 'none';
  if (positionField) positionField.style.display = hasLogo ? 'block' : 'none';
  if (watermarkRow) watermarkRow.style.display = hasLogo ? 'flex' : 'none';
  if (watermarkOpacityRow) watermarkOpacityRow.style.display = (hasLogo && pdfedRefineState.watermarkEnabled) ? 'flex' : 'none';

  if (swatchWrap) {
    if (hasLogo && pdfedRefineState.logoColors.length) {
      swatchWrap.style.display = 'flex';
      swatchWrap.innerHTML = pdfedRefineState.logoColors
        .map(c => `<span class="pdfed-refine-logo-swatch" style="background:${c}" title="${c}"></span>`).join('');
    } else {
      swatchWrap.style.display = 'none';
      swatchWrap.innerHTML = '';
    }
  }

  if (status) {
    if (!hasLogo) status.textContent = 'No logo uploaded — the report uses the style colors above.';
    else if (pdfedRefineState.logoColors.length) status.textContent = 'Logo colors detected — will be used to theme headings, tables, and icons.';
    else status.textContent = 'Logo added — no strong brand color detected, so the style colors above are used.';
  }
}

// Adds the uploaded logo as a small placedImage near the top of every page
// that doesn't already have one of its own (a logo the user placed by hand
// wins — this never overwrites it). Sized to a sensible header width and
// dropped near the top-right; the normal auto-align pass right after this
// (pdfedAutoAlignContent) is what snaps it to its final, consistent slot.
function pdfedInsertLogoIntoPages(dataUrl, scopeToInsertedOnly, logoPosition) {
  const pages = pdfed.pages || [];
  const position = logoPosition || 'right'; // 'left' | 'center' | 'right'
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || 160, naturalH = img.naturalHeight || 60;
      const targetW = 110;
      const targetH = Math.max(1, Math.round(naturalH * (targetW / naturalW)));
      let inserted = 0;
      pages.forEach((pg, idx) => {
        // Refine is scoped to only the page(s) added after a Make Forms
        // push — a pushed form page keeps its own header exactly as
        // pushed and never gets a logo dropped into it here.
        if (scopeToInsertedOnly && pg.fromMakeForm) return;
        pg.placedImages = pg.placedImages || [];
        const pageW = pg.width || 800, pageH = pg.height || 1100;
        const alreadyHasAnchor = pg.placedImages.some(im => !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark && pdfedIsAnchorImage(im, pageW, pageH));
        if (alreadyHasAnchor) return;
        const margin = 36;
        pg.placedImages.push({
          id: 'logo_' + idx + '_' + Date.now().toString(36),
          dataUrl, x: pdfedAnchorSlotXForced({ w: targetW }, pageW, margin, position), y: Math.round(margin * 0.6),
          w: targetW, h: targetH, zIndex: 999, locked: false,
          kind: 'logo',
        });
        inserted++;
      });
      resolve(inserted);
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

// Places a large, low-opacity copy of the uploaded logo centered on every
// in-scope page, behind every other layer — the subtle full-page brand
// mark a lot of reports carry, distinct from the small header logo above.
// Idempotent: any watermark a PREVIOUS Refine Report pass placed (flagged
// via _watermark) is stripped first, every time, whether or not this pass
// is putting a new one back — that's what makes unchecking the option, or
// dragging the opacity slider and re-running, replace the old mark instead
// of layering another copy on top of it.
function pdfedInsertLogoWatermarkIntoPages(dataUrl, scopeToInsertedOnly, enabled, opacity) {
  const pages = pdfed.pages || [];
  const stripStale = () => {
    pages.forEach(pg => { pg.placedImages = (pg.placedImages || []).filter(im => !im._watermark); });
  };
  return new Promise((resolve) => {
    if (!enabled || !dataUrl) { stripStale(); resolve(0); return; }
    const img = new Image();
    img.onload = () => {
      stripStale();
      const naturalW = img.naturalWidth || 160, naturalH = img.naturalHeight || 160;
      const ratio = naturalW / (naturalH || 1);
      const clampedOpacity = Math.max(0.04, Math.min(0.5, opacity != null ? opacity : 0.1));
      let inserted = 0;
      pages.forEach((pg, idx) => {
        if (scopeToInsertedOnly && pg.fromMakeForm) return;
        pg.placedImages = pg.placedImages || [];
        const pageW = pg.width || 800, pageH = pg.height || 1100;
        // Fit within ~58% of the page on either axis, whichever is
        // tighter, so the mark reads clearly on both portrait and
        // landscape pages without crowding the margins.
        const maxW = pageW * 0.58, maxH = pageH * 0.58;
        let w = maxW, h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        pg.placedImages.push({
          id: 'wmk_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          dataUrl, x: Math.round((pageW - w) / 2), y: Math.round((pageH - h) / 2),
          w: Math.round(w), h: Math.round(h), zIndex: 0, locked: false,
          opacity: clampedOpacity, kind: 'watermark', _watermark: true,
        });
        inserted++;
      });
      resolve(inserted);
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

// Places the report title / subheading / contact / address text entered in
// the Refine Report modal onto every in-scope page — title+subheading+
// contact+address sit together as one group, on whichever side
// opts.headerTextPosition says (left or right), independent of where the
// logo itself is placed. Contact+address ride underneath the subheading as
// a small line, and the same contact+address line is optionally repeated,
// small and centered, in the footer. Fully idempotent: any header/footer
// text a PREVIOUS Refine Report pass placed (flagged via _reportHeaderText
// / _reportFooterText) is stripped first, so editing the fields and
// re-running replaces the old text instead of stacking duplicates on top
// of it.
function pdfedInsertHeaderTextIntoPages(opts, theme) {
  const pages = pdfed.pages || [];
  const title = (opts.headerTitle || '').trim();
  const subheading = (opts.headerSubheading || '').trim();
  const contact = (opts.headerContact || '').trim();
  const address = (opts.headerAddress || '').trim();
  const contactLine = [contact, address].filter(Boolean).join('   ·   ');
  const hasHeaderText = !!(title || subheading || contactLine);
  const hasFooterText = !!opts.footerEnabled && !!contactLine;
  const textOnRight = opts.headerTextPosition === 'right';

  const margin = 36;
  const LOGO_RESERVE = 110 + 14; // logo target width + breathing room, kept clear of the text block
  let headerPages = 0, footerPages = 0;

  pages.forEach((pg, idx) => {
    const inScope = !(opts.scopeToInsertedOnly && pg.fromMakeForm);
    pg.placedTexts = pg.placedTexts || [];
    // Always clear out anything a previous pass placed here first, whether
    // or not this pass is putting anything back — that's how turning a
    // field blank, or unchecking "repeat in footer", actually removes it.
    pg.placedTexts = pg.placedTexts.filter(t => !t._reportHeaderText && !t._reportFooterText);
    if (!inScope) return;

    const pageW = pg.width || 800, pageH = pg.height || 1100;
    const hasLogo = !!(opts.addLogoToHeader && opts.logoDataUrl);
    const logoOnLeft = hasLogo && opts.logoPosition === 'left';
    const logoOnRight = hasLogo && (opts.logoPosition === 'right' || !opts.logoPosition);
    const reserveLeft = (logoOnLeft && !textOnRight) ? LOGO_RESERVE : 0;
    const reserveRight = (logoOnRight && textOnRight) ? LOGO_RESERVE : 0;
    const x = margin + reserveLeft;
    const w = Math.max(120, pageW - x - margin - reserveRight);
    const align = textOnRight ? 'right' : 'left';

    // Vertically center the whole title/subheading/contact block against
    // the logo actually placed on this page (pdfedInsertLogoIntoPages +
    // the auto-align pass right after it run BEFORE this function, so the
    // logo's real, final x/y/w/h already sit in placedImages by now) —
    // rather than a fixed top offset. A fixed offset is what made a tall
    // logo mark read as sitting lower than a short, three-line text block:
    // both started at nearly the same y, so the logo's extra height just
    // hung further down past the text, instead of the two sharing a
    // common visual center the way an actual letterhead does.
    const pageAnchor = hasLogo
      ? (pg.placedImages || []).find(im => !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark && pdfedIsAnchorImage(im, pageW, pageH))
      : null;
    // Rough total height of the text block as it'll actually be laid out
    // below (line-advance values match the y increments used per field
    // further down) — good enough to center against, not meant to be a
    // pixel-exact typographic measurement.
    const textBlockH = (title ? 26 : 0) + (subheading ? 17 : 0) + (contactLine ? 13 : 0) || 20;
    let y = pageAnchor
      ? Math.round(pageAnchor.y + ((pageAnchor.h || 0) - textBlockH) / 2)
      : Math.round(margin * 0.35);
    y = Math.max(Math.round(margin * 0.3), y);

    if (hasHeaderText) {
      if (title) {
        pg.placedTexts.push({
          id: 'rpthdr_title_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          text: title, x, y, w,
          fontSize: 20, fontFamily: theme.font, color: theme.accent,
          bold: true, italic: false, underline: false, align,
          locked: false, zIndex: 998, _reportHeaderText: true,
        });
        y += 26;
      }
      if (subheading) {
        pg.placedTexts.push({
          id: 'rpthdr_sub_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          text: subheading, x, y, w,
          fontSize: 12, fontFamily: theme.bodyFont, color: theme.accent,
          bold: false, italic: false, underline: false, align,
          locked: false, zIndex: 998, _reportHeaderText: true,
        });
        y += 17;
      }
      if (contactLine) {
        pg.placedTexts.push({
          id: 'rpthdr_contact_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          text: contactLine, x, y, w,
          fontSize: 9, fontFamily: theme.bodyFont, color: '#6b7280',
          bold: false, italic: false, underline: false, align,
          locked: false, zIndex: 998, _reportHeaderText: true,
        });
      }
      headerPages++;
    }

    if (hasFooterText) {
      pg.placedTexts.push({
        id: 'rptftr_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        text: contactLine, x: margin, y: Math.max(margin, pageH - margin * 0.75),
        w: Math.max(60, pageW - margin * 2),
        fontSize: 9, fontFamily: theme.bodyFont, color: '#6b7280',
        bold: false, italic: false, underline: false, align: 'center',
        locked: false, zIndex: 998, _reportFooterText: true,
      });
      footerPages++;
    }
  });

  return { headerPages, footerPages };
}

// ── Adjust to A4 ────────────────────────────────────────────────────────
// A page built (or imported) at some other size — a stray Letter page mixed
// into an A4 report, a screenshot pasted in at its native pixel size, a PDF
// page that came in oversized — reads as "off" next to the rest of a report
// even after headings/tables are otherwise refined. This fits every page
// that isn't already A4 onto a clean A4 sheet: the existing page content is
// scaled to fit (never stretched, never cropped) and centered, and every
// placed table/text/image/shape/border on that page is rescaled the same
// amount so nothing drifts out of place relative to what's around it.
//
// A page's real pixel size is read straight off its own stored raster
// (pg.dataUrl), not the live on-screen canvas — see pdfedLoadPageImage
// below for why.
const PDFED_A4_TOLERANCE_MM = 3; // how close counts as "already matching the target" — skip it

// Looks at every existing page's own recorded size (pg.pageMM) and picks
// whichever size shows up most often, normalized to its portrait
// orientation (a 297x210 landscape A4 page and a 210x297 portrait A4 page
// both count as "A4" for this vote) — that's the size the report is
// *actually* mostly built at, whether that's A4, A3, Letter, or some
// custom canvas someone set up. Falls back to A4 only when there's nothing
// to go on at all (brand-new/blank pages with no recorded size yet), so a
// report that was never A4 to begin with doesn't get silently forced onto
// it. Ties fall back to whichever size was seen first.
function pdfedDetectStandardFormat() {
  const pages = (pdfed.pages || []);
  const counts = new Map(); // key "wxh" (portrait, rounded mm) -> { w, h, count }
  pages.forEach(pg => {
    const [w, h] = pg.pageMM || [];
    if (!(w > 0) || !(h > 0)) return;
    const pw = Math.round(Math.min(w, h));
    const ph = Math.round(Math.max(w, h));
    const key = pw + 'x' + ph;
    const entry = counts.get(key) || { w: pw, h: ph, count: 0 };
    entry.count++;
    counts.set(key, entry);
  });
  let best = null;
  counts.forEach(entry => { if (!best || entry.count > best.count) best = entry; });
  return best ? [best.w, best.h] : [210, 297];
}

function pdfedPageDensity(pg) {
  // PDF-sourced pages record their true raster density (pdfedPageUrl sets
  // pg._pxPerMm); blank/inserted/image pages are all rendered at the same
  // 96 DPI (3.7795 px/mm) used throughout the rest of the PDF editor.
  return (pg && pg._pxPerMm) || 3.7795;
}

// Uniformly rescales every placed object on a page by `scale`, then shifts
// it by (offsetX, offsetY) — used right after a page's canvas is resized so
// its content lands centered on the new sheet instead of stuck in whatever
// corner the old page's coordinates put it in.
function pdfedRescalePlacedItems(pg, scale, offsetX, offsetY) {
  ['placedTables', 'placedTexts', 'placedImages', 'placedShapes', 'placedBorders'].forEach(key => {
    (pg[key] || []).forEach(item => {
      if (typeof item.x === 'number') item.x = item.x * scale + offsetX;
      if (typeof item.y === 'number') item.y = item.y * scale + offsetY;
      if (typeof item.w === 'number') item.w = item.w * scale;
      if (typeof item.h === 'number') item.h = item.h * scale;
      if (typeof item.fontSize === 'number') item.fontSize = item.fontSize * scale;
      if (Array.isArray(item.colWidths)) item.colWidths = item.colWidths.map(v => v * scale);
      if (Array.isArray(item.rowHeights)) item.rowHeights = item.rowHeights.map(v => v * scale);
    });
  });
}

// Loads a page's stored raster as a fresh, untainted Image element. Always
// reads from pg.dataUrl (a data: URI) rather than the live, currently-
// displayed #pdfedPageCanvas — drawing from that live canvas is what the
// earlier version of this feature did, and it's fragile: if any image ever
// got drawn onto that canvas from an external URL without CORS headers
// (a stock photo, certain pasted images), the canvas becomes "tainted" and
// canvas.toDataURL() throws a SecurityError with no visible message,
// silently killing the whole Adjust-to-A4 pass. Working from pg.dataUrl
// sidesteps that entirely, since it's always a self-contained data: URI.
async function pdfedLoadPageImage(pg) {
  const url = await pdfedPageUrl(pg);
  if (!url) return null;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Tight bounding box (in page px) of every placed table/text/image/shape/
// border on a page. Returns null if the page has no placed items at all.
// This is what a composed report page's real "size" actually is — the
// page's own raster is frequently just a blank/oversized canvas underneath,
// so measuring THAT tells you nothing about where the content sits on it.
function pdfedContentBBox(pg) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  ['placedTables', 'placedTexts', 'placedImages', 'placedShapes', 'placedBorders'].forEach(key => {
    (pg[key] || []).forEach(item => {
      // Masthead/decoration items (section badges, dividers, the header
      // rule, and the background watermark) regenerate fresh — sized off
      // whatever the page's real dimensions end up being — on every
      // Refine Report pass, so they should never feed BACK into deciding
      // what those dimensions are. Without this, a re-run with "Adjust to
      // A4" on would size the page around last run's watermark instead of
      // the actual report content, feeding a slightly different watermark
      // size into every subsequent run.
      if (item._sectionIcon || item._sectionDivider || item._sectionBar || item._headerDivider || item._watermark) return;
      if (typeof item.x !== 'number' || typeof item.y !== 'number') return;
      const w = typeof item.w === 'number' ? item.w : 0;
      const h = typeof item.h === 'number' ? item.h : 0;
      minX = Math.min(minX, item.x); minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + w); maxY = Math.max(maxY, item.y + h);
      found = true;
    });
  });
  if (!found) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// A normal breathing margin (page px) around content when it's re-centered
// on a fresh A4 sheet — matches the margin push-to-workflow itself uses.
const PDFED_A4_CONTENT_MARGIN = 60;

// Fits one page onto a fresh A4 (portrait or landscape) canvas — contain,
// not cover, so nothing gets cropped off — and rescales every placed object
// to match. Returns { adjusted, curMmW, curMmH } so the caller can report
// exactly what it found, even when nothing needed fixing.
//
// A composed page (tables/text dropped onto a blank canvas, e.g. anything
// from Push to Workflow) is handled differently from a real scanned/PDF
// page: for those, the page's raster IS the content, so fitting/centering
// the raster is correct. For a composed page, the raster is frequently just
// a blank (possibly oversized) sheet with the real content living in
// pg.placedTables/etc — fitting THAT raster only resizes the blank canvas
// and drags whatever corner the content was already sitting in along with
// it, never actually re-centering the content itself. So for those pages
// this fits/centers the content's own bounding box instead, and rebuilds
// the background as a fresh, correctly-sized blank sheet.
async function pdfedFitPageToA4(idx, baseMM) {
  const pg = pdfed.pages[idx];
  if (!pg) return { adjusted: false, curMmW: 0, curMmH: 0 };
  const [baseW, baseH] = (baseMM && baseMM[0] > 0 && baseMM[1] > 0) ? baseMM : [210, 297];

  const pxPerMm = pdfedPageDensity(pg);
  const bbox = pg.type === 'blank' ? pdfedContentBBox(pg) : null;

  if (bbox && bbox.w > 0 && bbox.h > 0) {
    const curMmW = bbox.w / pxPerMm, curMmH = bbox.h / pxPerMm;
    const neededW = bbox.w + PDFED_A4_CONTENT_MARGIN * 2;
    const neededH = bbox.h + PDFED_A4_CONTENT_MARGIN * 2;
    // A composed report page (tables/charts pushed from Data Arrangement/
    // Diagrams) never flips to landscape just because its content's own
    // bounding box happens to read wider than it is tall — a chart sitting
    // above a wide table is exactly that shape, and flipping the whole
    // sheet to landscape over it is what actually reads as "off" next to
    // the rest of an A4 report. Composed pages always target the sheet's
    // own portrait orientation; anything that doesn't fit gets shrunk to
    // fit it (same "contain" scale below, plus pdfedAutoAlignContent's own
    // font/row shrink pass right after this), not solved by rotating the
    // page.
    const targetMmW = baseW, targetMmH = baseH;
    const targetW = Math.round(targetMmW * pxPerMm);
    const targetH = Math.round(targetMmH * pxPerMm);

    // Already the right size? Leave it alone, full stop — page size is the
    // only thing that decides whether this page needs touching. This used
    // to also require the content to already sit centered on the page
    // before skipping, which sounds harmless but wasn't: a normal report
    // uses left-margin (or stretch) alignment, not centered, so that check
    // failed on every single refine pass after the first one — even though
    // the page was already correct A4 — and the page got silently rebuilt
    // and its content rescaled/re-centered again each time, undoing
    // whatever alignment Pass 4 had just set. A page that's already A4
    // sized is done; it is never resized again no matter how its content
    // happens to be positioned.
    const [curPageMmW, curPageMmH] = pg.pageMM || [0, 0];
    const alreadyRightSize = Math.abs(curPageMmW - targetMmW) <= PDFED_A4_TOLERANCE_MM
      && Math.abs(curPageMmH - targetMmH) <= PDFED_A4_TOLERANCE_MM;
    if (alreadyRightSize) {
      return { adjusted: false, curMmW: Math.round(curPageMmW), curMmH: Math.round(curPageMmH) };
    }

    // Never upscale content just to fill more of the sheet — only shrink if
    // it doesn't fit within the target margins, same "contain" rule as the
    // raster path below.
    const scale = Math.min(1, targetW / neededW, targetH / neededH);
    const offsetX = Math.round((targetW - bbox.w * scale) / 2) - bbox.minX * scale;
    const offsetY = Math.round((targetH - bbox.h * scale) / 2) - bbox.minY * scale;

    let newDataUrl;
    try {
      newDataUrl = await pdfedRenderBlankPage('', pg.bgColor || '#ffffff', targetMmW, targetMmH);
    } catch (e) {
      console.error('Adjust to A4: could not rebuild background for page ' + (idx + 1), e);
      return { adjusted: false, curMmW: Math.round(curMmW), curMmH: Math.round(curMmH) };
    }

    pg.dataUrl = newDataUrl;
    pg.pageMM = [targetMmW, targetMmH];
    pg.width = targetW; pg.height = targetH;
    pg._pxPerMm = pxPerMm;
    pdfedRescalePlacedItems(pg, scale, offsetX, offsetY);
    return { adjusted: true, curMmW: Math.round(curMmW), curMmH: Math.round(curMmH) };
  }

  // No placed content to go on (or a real scanned/PDF/image page, where the
  // raster itself is the actual content) — fall back to fitting the raster
  // as a whole, same as before.
  let img;
  try {
    img = await pdfedLoadPageImage(pg);
  } catch (e) {
    console.error('Adjust to A4: could not load page ' + (idx + 1), e);
    return { adjusted: false, curMmW: 0, curMmH: 0 };
  }
  if (!img || !img.naturalWidth || !img.naturalHeight) return { adjusted: false, curMmW: 0, curMmH: 0 };

  const curMmW = img.naturalWidth / pxPerMm, curMmH = img.naturalHeight / pxPerMm;
  const landscape = curMmW > curMmH;
  const targetMmW = landscape ? baseH : baseW, targetMmH = landscape ? baseW : baseH;

  if (Math.abs(curMmW - targetMmW) <= PDFED_A4_TOLERANCE_MM && Math.abs(curMmH - targetMmH) <= PDFED_A4_TOLERANCE_MM) {
    return { adjusted: false, curMmW, curMmH }; // already A4 — leave it alone
  }

  const targetW = Math.round(targetMmW * pxPerMm);
  const targetH = Math.round(targetMmH * pxPerMm);
  const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
  const newW = Math.round(img.naturalWidth * scale);
  const newH = Math.round(img.naturalHeight * scale);
  const offsetX = Math.round((targetW - newW) / 2);
  const offsetY = Math.round((targetH - newH) / 2);

  const out = document.createElement('canvas');
  out.width = targetW; out.height = targetH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, targetW, targetH);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, offsetX, offsetY, newW, newH);

  let newDataUrl;
  try {
    newDataUrl = out.toDataURL('image/png');
  } catch (e) {
    console.error('Adjust to A4: could not export resized page ' + (idx + 1) + ' (likely a tainted canvas from an externally-loaded image)', e);
    return { adjusted: false, curMmW, curMmH };
  }

  pg.dataUrl = newDataUrl;
  // pageMM is the field the rest of the app (push-to-workflow, Diagrams,
  // Forms, File Converter) actually reads back as a page's real-world
  // size — keep it in sync, not just the raster itself, so anything added
  // to this page afterwards lays out against the new A4 size correctly.
  pg.pageMM = [targetMmW, targetMmH];
  pg.width = targetW; pg.height = targetH;
  pg._pxPerMm = pxPerMm;

  pdfedRescalePlacedItems(pg, scale, offsetX, offsetY);
  return { adjusted: true, curMmW, curMmH };
}

// Runs pdfedFitPageToA4 across every page in the document. Returns
// { adjusted, details } — details is one { index, curMmW, curMmH, changed }
// entry per page, in mm, so the caller can show exactly what it found even
// when a page needed no change (which is the common case if the report
// was already built at A4 — e.g. anything pushed over from Data
// Arrangement already lands close to A4 by design). Works entirely off the
// stored page data, so — unlike the DOM-navigation approach this replaced —
// it doesn't need to visit/display every page to do its job; only the page
// that ends up on screen afterward gets a real re-render.
async function pdfedAdjustAllPagesToA4(scopeToInsertedOnly) {
  const total = (pdfed.pages || []).length;
  const startActive = pdfed.active;
  // Always the real A4 sheet (210x297mm) — this used to vote for whichever
  // size showed up most often across the document's own pages, which meant
  // a report built entirely on some odd/custom canvas just got "standardized"
  // right back onto that same odd size and never actually became A4. The
  // checkbox says A4, so the target is always A4, regardless of what the
  // pages currently are.
  const baseMM = [210, 297];
  let adjusted = 0;
  const details = [];
  for (let i = 0; i < total; i++) {
    // Refine is scoped to only the page(s) added after a Make Forms push —
    // a pushed form page is already a real, final A4 page and is left
    // exactly as pushed rather than re-fit here.
    if (scopeToInsertedOnly && pdfed.pages[i].fromMakeForm) continue;
    const result = await pdfedFitPageToA4(i, baseMM);
    details.push({ index: i, curMmW: Math.round(result.curMmW), curMmH: Math.round(result.curMmH), changed: result.adjusted });
    if (result.adjusted) { adjusted++; pdfedMarkModified(i); }
  }
  if (startActive >= 0) await pdfedGoto(startActive);
  return { adjusted, details, baseMM };
}

// Friendly name for a detected [mmW, mmH] pair — matches it against the
// standard paper sizes (within the same tolerance the fit pass itself
// uses) so a report that's mostly A3 says "A3", not a raw mm figure; only
// falls through to the exact dimensions when it's a genuinely custom size.
function pdfedFormatLabelForMM(mmW, mmH) {
  for (const key of Object.keys(PDFED_FORMAT_MM)) {
    const [pw, ph] = PDFED_FORMAT_MM[key];
    if (Math.abs(mmW - pw) <= PDFED_A4_TOLERANCE_MM && Math.abs(mmH - ph) <= PDFED_A4_TOLERANCE_MM) {
      return PDFED_FORMAT_LABELS[key] || key.toUpperCase();
    }
  }
  return Math.round(mmW) + ' × ' + Math.round(mmH) + ' mm';
}

/* (c) 2026 SARVARC. ALL RIGHTS RESERVED.
   REFINE REPORT (this modal, its styling logic, rules, workflow and the
   engine below) is proprietary SARVARC code. Except the owner (SARVARC),
   NO ONE is permitted to copy, reuse, modify, adapt, reverse engineer,
   extract, redistribute, sell, host, or build any product or feature from
   this code, its logic, structure or design, in whole or in part, without
   prior written permission from SARVARC.
   STRICT ACTIONS MAY BE TAKEN IF BREACHED. */
var _kce2257_bdd3 = 1;
function pdfedOpenRefineReportModal() {
  const pages = (typeof pdfed !== 'undefined' && pdfed.pages) || [];
  if (!pages.length) { toast('Open or build a report first', 'info'); return; }
  // A report built from a Make Forms push refines differently: the pushed
  // form page(s) are already a finished, real document and are left
  // exactly as pushed — Refine Report only ever touches a page the person
  // inserted and wrote content on afterward. With no form-origin pages at
  // all, this has no effect and every page is in scope, same as before.
  const hasFormPages = pages.some(pg => pg.fromMakeForm);
  const scopePages = hasFormPages ? pages.filter(pg => !pg.fromMakeForm) : pages;
  if (hasFormPages && !scopePages.length) {
    toast('Insert a page and add content to refine it — pushed form pages are left as they are', 'info');
    return;
  }
  const hasContent = scopePages.some(pg => (pg.placedTables && pg.placedTables.length) || (pg.placedTexts && pg.placedTexts.length) || (pg.placedImages && pg.placedImages.length));
  if (!hasContent) { toast(hasFormPages ? 'Add some content to the inserted page first' : 'Add some tables, text, or images to the canvas first', 'info'); return; }
  const countEl = document.getElementById('pdfedRefinePageCount');
  if (countEl) countEl.textContent = hasFormPages ? scopePages.length : pages.length;
  const scopeHintEl = document.getElementById('pdfedRefineFormScopeHint');
  if (scopeHintEl) scopeHintEl.style.display = hasFormPages ? '' : 'none';
  // Always A4 now — the checkbox label matches exactly what the pass below
  // targets, rather than describing the document's own current dominant
  // size (which was the actual bug: an odd/custom canvas would get
  // "standardized" right back onto itself instead of becoming real A4).
  const sizeEl = document.getElementById('pdfedRefineAdjustA4Size');
  if (sizeEl) sizeEl.textContent = 'A4';
  const overlay = document.getElementById('pdfedRefineOverlay');
  if (overlay) overlay.classList.add('open');
  pdfedUpdateLogoPreviewUI();
  pdfedUpdateSectionIconsVisibility();
  pdfedUpdateRefinePreview();
}

function pdfedCloseRefineModal() {
  const overlay = document.getElementById('pdfedRefineOverlay');
  if (overlay) overlay.classList.remove('open');
}

function pdfedSetRefineTheme(key, el) {
  pdfedRefineState.theme = key;
  const group = document.getElementById('pdfedRefineThemeGroup');
  if (group) group.querySelectorAll('.da-dropdown-scope-btn').forEach(b => b.classList.toggle('active', b === el));
  pdfedUpdateSectionIconsVisibility();
  pdfedUpdateRefinePreview();
}

// Highlighted section headings (color badge + divider bar) are SVG-based
// icon art, so they're only offered for the Modern style — the other
// styles (General/Financial/Corporate) are meant to read as plain, classic
// document typography with no icon glyphs in them. Switching away from
// Modern hides the checkbox/hint and force-unchecks it so a badge choice
// made under Modern doesn't silently carry over and still get applied.
// Switching back TO Modern re-checks it by default (its original on-by-
// default state) — otherwise, once you'd ever touched another style first
// (or the modal simply opened on its General default), the box stayed
// unchecked forever and Modern quietly ran with no icons at all.
function pdfedUpdateSectionIconsVisibility() {
  const row = document.getElementById('pdfedRefineSectionIconsRow');
  const hint = document.getElementById('pdfedRefineIconHint');
  const isModern = pdfedRefineState.theme === 'modern';
  if (row) row.style.display = isModern ? '' : 'none';
  if (hint) hint.style.display = isModern ? '' : 'none';
  const cb = document.getElementById('pdfedRefineSectionIcons');
  if (cb) cb.checked = isModern;
}

function pdfedSetRefineAlign(key, el) {
  pdfedRefineState.align = key;
  const group = document.getElementById('pdfedRefineAlignGroup');
  if (group) group.querySelectorAll('.da-dropdown-scope-btn').forEach(b => b.classList.toggle('active', b === el));
  pdfedUpdateRefinePreview();
}

// Repaints the small mock report card at the top of the Refine Report modal
// so it reflects the current theme (font + accent + header tint), logo,
// content alignment, and "highlight section titles" choice the instant any
// of them change. It's a style sample built from fixed placeholder content
// — not a render of the real document — since running the actual refine
// pipeline live on every keystroke would be far too heavy for a preview.
function pdfedUpdateRefinePreview() {
  const box = document.getElementById('pdfedRefinePreview');
  if (!box) return;
  const theme = pdfedResolveRefineTheme(pdfedRefineState);
  const align = pdfedRefineState.align || 'left';
  const sectionIconsOn = pdfedRefineState.theme === 'modern' &&
    !!document.getElementById('pdfedRefineSectionIcons')?.checked;

  box.classList.remove('prp-align-left', 'prp-align-center', 'prp-align-stretch');
  box.classList.add('prp-align-' + align);

  const title = document.getElementById('prpTitle');
  const section = document.getElementById('prpSection');
  const sectionIcon = document.getElementById('prpSectionIcon');
  const divider = document.getElementById('prpDivider');
  const table = document.getElementById('prpTable');
  const para = document.getElementById('prpPara');
  const logo = document.getElementById('prpLogo');
  const header = document.getElementById('prpHeader');
  if (header) {
    header.classList.remove('logo-pos-left', 'logo-pos-center', 'logo-pos-right');
    header.classList.add('logo-pos-' + (pdfedRefineState.logoPosition || 'right'));
    header.classList.remove('text-pos-left', 'text-pos-right');
    header.classList.add('text-pos-' + (pdfedRefineState.headerTextPosition || 'left'));
  }

  if (title) { title.style.fontFamily = theme.font; title.style.color = theme.accent; }
  if (section) { section.style.fontFamily = theme.font; section.style.color = theme.accent; }
  if (para) para.style.fontFamily = theme.bodyFont;
  if (table) {
    table.querySelectorAll('th').forEach(th => {
      th.style.fontFamily = theme.font;
      th.style.background = theme.headerFill;
      th.style.color = theme.accent;
    });
    table.querySelectorAll('td').forEach(td => { td.style.fontFamily = theme.bodyFont; });
  }

  if (divider) {
    divider.style.display = sectionIconsOn ? 'block' : 'none';
    divider.style.background = `linear-gradient(90deg, ${theme.accent}, ${pdfedShadeHex(theme.accent, 0.4)})`;
  }
  if (sectionIcon) {
    if (sectionIconsOn) {
      const badge = pdfedSectionIconBadgeDataUrl('chart', theme.accent, 32);
      if (badge) { sectionIcon.src = badge; sectionIcon.style.display = 'inline-block'; }
      else { sectionIcon.style.display = 'none'; }
    } else {
      sectionIcon.style.display = 'none';
    }
  }

  const hasLogo = !!pdfedRefineState.logoDataUrl && pdfedRefineState.addLogoToHeader !== false;
  if (logo) {
    logo.src = hasLogo ? pdfedRefineState.logoDataUrl : '';
    logo.style.display = hasLogo ? 'inline-block' : 'none';
  }

  const watermark = document.getElementById('prpWatermark');
  const hasWatermark = !!pdfedRefineState.logoDataUrl && !!pdfedRefineState.watermarkEnabled;
  if (watermark) {
    watermark.src = hasWatermark ? pdfedRefineState.logoDataUrl : '';
    watermark.style.display = hasWatermark ? 'block' : 'none';
    watermark.style.opacity = pdfedRefineState.watermarkOpacity != null ? pdfedRefineState.watermarkOpacity : 0.1;
  }

  // Title falls back to the placeholder sample when left blank, so the
  // preview never looks broken/empty — but subheading, contact info, and
  // the footer line only ever show up once the person's actually typed
  // something into them.
  if (title) title.textContent = (pdfedRefineState.headerTitle || '').trim() || 'Report Title';
  const subEl = document.getElementById('prpSubheading');
  if (subEl) {
    const sub = (pdfedRefineState.headerSubheading || '').trim();
    subEl.textContent = sub;
    subEl.style.display = sub ? 'block' : 'none';
    subEl.style.fontFamily = theme.bodyFont;
  }
  const contactEl = document.getElementById('prpContact');
  if (contactEl) {
    const contact = (pdfedRefineState.headerContact || '').trim();
    const address = (pdfedRefineState.headerAddress || '').trim();
    const line = [contact, address].filter(Boolean).join('  ·  ');
    contactEl.textContent = line;
    contactEl.style.display = line ? 'block' : 'none';
    contactEl.style.fontFamily = theme.bodyFont;
  }
  const footerEl = document.getElementById('prpFooterPreview');
  if (footerEl) {
    const contact = (pdfedRefineState.headerContact || '').trim();
    const address = (pdfedRefineState.headerAddress || '').trim();
    const line = [contact, address].filter(Boolean).join('  ·  ');
    const show = !!pdfedRefineState.footerEnabled && !!line;
    footerEl.textContent = line;
    footerEl.style.display = show ? 'block' : 'none';
    footerEl.style.fontFamily = theme.bodyFont;
  }

  // Mandatory margin-to-margin rule under the header, same gradient the
  // real refine pass draws under the logo on every page — always on
  // whenever a logo is present, independent of the "Highlight section
  // titles" toggle above.
  const headerDivider = document.getElementById('prpHeaderDivider');
  if (headerDivider) {
    headerDivider.style.display = hasLogo ? 'block' : 'none';
    headerDivider.style.background = `linear-gradient(90deg, ${theme.accent}, ${pdfedShadeHex(theme.accent, 0.4)})`;
  }
}

// A text box counts as a "heading" if it reads like one (short, one or two
// lines) and already looks styled like one (larger than body copy, or
// bold) — this stays conservative on purpose so a stray bolded word inside
// a paragraph doesn't get pulled out and blown up to title size.
function pdfedTextLooksLikeHeading(t) {
  const txt = String(t.text || '').trim();
  if (!txt) return false;
  const size = t.fontSize || 14;
  const lineish = txt.length <= 90 && txt.split('\n').length <= 2;
  return lineish && (size >= 17 || !!t.bold);
}

// A text box reads as an un-styled list — several short, independent lines
// (a "Highlights" block typed or pasted one fact per line) that never
// actually got turned into a real bulleted list — when most of its lines
// are short and there are several of them. Deliberately conservative: it
// takes 3+ qualifying lines before this fires, and any line that reads long
// enough to be ordinary wrapped prose disqualifies the whole box, so a
// normal paragraph that just happens to contain a line break or two is
// never mistaken for a list.
function pdfedTextLooksLikeList(t) {
  if (t.bullet) return false; // already a real list — leave it alone
  const lines = String(t.text || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  return lines.every(l => l.length > 0 && l.length <= 100);
}

let _pdfedRefineMeasureCtx = null;
function pdfedRefineMeasureCtx() {
  if (!_pdfedRefineMeasureCtx) _pdfedRefineMeasureCtx = document.createElement('canvas').getContext('2d');
  return _pdfedRefineMeasureCtx;
}

// Re-styles one table to the chosen theme (numeric alignment + total-row
// bolding recomputed straight from its own content via daBuildCellStyles,
// then the header row is forced onto the shared theme fill so every table
// in the report announces itself the same way). Font SIZE is deliberately
// no longer decided in here — see pdfedComputeTableFitSize / the Pass 1
// caller below, which now picks one shared size across every table in the
// document rather than letting each table pick its own independently
// (that per-table freedom is exactly what caused two tables in the same
// report to land at visibly different sizes even though both had "auto-fit"
// on).
function pdfedRefineOneTable(item, theme) {
  if (!item.cells || !item.cells.length) return;
  const styles = daBuildCellStyles(item.cells);
  if (styles.length) {
    styles[0].forEach(st => { st.fill = theme.headerFill; st.bold = true; st.color = null; });
  }
  item.cellStyles = styles;
  if (item.rows > 1) item.headerRow = true;
  item.fontFamily = theme.font;

  // Per-column header icons used to be tagged into the table's own header
  // row here. That's deliberately turned off now — icons live next to each
  // section's own title instead (see pdfedApplySectionIcons below), so a
  // report reads as "icon + heading" rather than a row of tiny repeated
  // icons packed inside the table itself.
  item.headerIcons = null;
}

// Returns the largest font size, within a comfortable 8–13px reading range,
// that still lets every cell in this ONE table sit on one line inside its
// own column. Pure — doesn't mutate the table. Called once per table so the
// caller can take the smallest result across every table in scope and apply
// that single shared size everywhere (see Pass 1 below), instead of each
// table independently maxing out its own size.
function pdfedComputeTableFitSize(item, theme) {
  const ctx = pdfedRefineMeasureCtx();
  const fits = (size) => {
    ctx.font = `${size}px ${pdfedFontCss(theme.font)}`;
    for (let r = 0; r < item.rows; r++) {
      for (let c = 0; c < item.cols; c++) {
        const text = String((item.cells[r] && item.cells[r][c]) || '');
        if (!text) continue;
        if (ctx.measureText(text).width + 14 > (item.colWidths[c] || 60)) return false;
      }
    }
    return true;
  };
  let fs = 13;
  while (fs > 8 && !fits(fs)) fs -= 0.5;
  return fs;
}

// Plants a small filled badge icon immediately to the left of each section's
// own title, a soft highlighted band behind the whole badge+heading row, and
// a gradient accent rule along that band's bottom edge — the "highlighted
// heading" premium report look. All three pick up the report's accent/tint
// colors, which are automatically the logo's own extracted color whenever a
// logo is uploaded and "Match report colors to logo" is on (see
// pdfedResolveRefineTheme), so highlighted headings always match the brand.
// Idempotent: re-running Refine Report first strips any badge/band/divider
// this same pass added before, and undoes the heading x-shift, so repeated
// runs never keep nudging the title further right or leaving stale marks
// behind.
function pdfedApplySectionIcons(pages, theme, addIcons, scopeToInsertedOnly) {
  let count = 0;
  const accent = theme.accent || '#0f172a';
  pages.forEach(pg => {
    // Refine is scoped to only the page(s) added after a Make Forms push —
    // a pushed form page never gets section badges of its own.
    if (scopeToInsertedOnly && pg.fromMakeForm) return;
    // Strip any badges/bands/dividers from a previous run before anything
    // else — this also matters for pdfedAutoAlignContent on a *second*
    // refine pass, since a stale mark left in placedImages would otherwise
    // be small enough to get misread as a logo anchor by that function.
    pg.placedImages = (pg.placedImages || []).filter(im => !im._sectionIcon && !im._sectionDivider && !im._sectionBar);
    if (!addIcons) return; // "Highlight section titles" was left off — stripping above still happened
    if (!pg.placedTexts || !pg.placedTexts.length) return;
    const headings = pg.placedTexts.filter(pdfedTextLooksLikeHeading);
    if (!headings.length) return;
    const pageW = pg.width || 800;
    const margin = 36;
    headings.forEach(t => {
      // Every heading on the page is checked against the section-icon rules
      // (PDFED_SECTION_ICON_RULES) — not just the page's single biggest
      // heading. A page commonly carries both an overall document/page title
      // AND one or more section headings underneath it (Cash Flow Analysis,
      // Compliance Checklist, Team, etc.) — those section headings are
      // exactly what the icon rules are meant to match, so gating on "is
      // this the biggest heading on the page" was silently skipping them
      // whenever a bigger title heading was also present. A heading simply
      // gets a badge if its own text matches a rule; one that doesn't match
      // anything is still correctly left unhighlighted.
      // Undo any shift left over from an earlier refine pass so this one
      // starts from the heading's true, unshifted position.
      if (t._sectionIconShift) { t.x = (t.x || 0) - t._sectionIconShift; t._sectionIconShift = 0; }
      const key = pdfedDetectSectionIcon(t.text);
      if (!key) return;
      const fontSize = t.fontSize || 20;
      // A filled badge reads best a touch larger than a bare outline icon
      // did, so it never looks cramped against its own background square.
      const iconSize = Math.max(20, Math.round(fontSize * 1.3));
      const gap = 10;
      const padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
      const lineHeight = fontSize * 1.25;
      const lines = String(t.text || '').split('\n').length;
      const origX = t.x || 0;

      // Divider geometry is resolved from the associated table's own
      // left/right edges (same table pdfedFindAssociatedTable/Pass 5 already
      // lined the heading up under), so the rule reads as belonging to
      // "its" table rather than a generic width that happens to be nearby.
      // Falls back to the heading's own position only when no table is on
      // the page at all.
      const assocTable = pdfedFindAssociatedTable(pg, t);
      const tableX = assocTable ? (assocTable.x || 0) : null;
      const tableW = assocTable ? pdfedTableWidth(assocTable) : 0;
      const innerPadX = 12; // fixed left inset for the badge, independent of the heading's own raw x
      const barPad = 6;
      let bandX = (assocTable && tableW > 0) ? Math.round(tableX) : Math.max(0, Math.round(origX + padX - innerPadX));
      let bandW = (assocTable && tableW > 0) ? Math.round(tableW) : Math.max(60, Math.round(pageW - margin - bandX));
      // Clamp to the page's own content margin so a mismeasured or stale
      // table width can never push the rule past the page edge.
      if (bandX < margin) { bandW -= (margin - bandX); bandX = margin; }
      if (bandX + bandW > pageW - margin) bandW = Math.max(60, pageW - margin - bandX);

      // The badge is anchored from the rule's OWN left edge (not the
      // heading's raw x) with a fixed inset, so it always sits with
      // consistent breathing room — it can never float off to one side.
      const iconX = bandX + innerPadX;
      const iconY = Math.round((t.y || 0) + padY + (lineHeight - iconSize) / 2);
      const rowBottom = (t.y || 0) + padY + lines * lineHeight;
      const bandBottom = Math.round(Math.max(rowBottom, iconY + iconSize) + barPad);

      // Gradient accent rule under the heading row — this is the actual
      // "highlight" (no filled background rectangle behind the text/icon;
      // a plain page background with a crisp accent rule underneath reads
      // as an editorial report, where a big tinted block reads as a UI
      // banner). Same width/x as the table below so it lines up cleanly.
      const ruleH = Math.max(2, Math.round(fontSize * 0.14));
      // The live canvas paints these five item types into fixed, separate DOM
      // layers in a fixed order (borders, images, texts, tables, shapes —
      // see the layer divs around #pdfedPlacedZoomWrap), and CSS only lets a
      // z-index win over a later-in-DOM sibling when it's STRICTLY higher —
      // a tie is resolved by DOM order, which always favors the Tables layer
      // over this Images-layer badge/divider. Basing this z-index off the
      // heading alone (t.zIndex + 1) ignored the table sitting directly
      // underneath it: whenever that table's own z-index was equal to or
      // higher than the heading's, the table silently painted over the thin
      // divider rule on-screen, even though export/thumbnail generation
      // (which doesn't go through those fixed DOM layers) still composited
      // it correctly — hence "shows in export/thumbnail but not live canvas".
      // Anchoring off the higher of the heading's OR its associated table's
      // z-index guarantees the divider/badge always lands strictly above
      // both, everywhere.
      const stackBaseZ = Math.max(t.zIndex || 0, assocTable ? (assocTable.zIndex || 0) : 0);
      pg.placedImages.push({
        id: 'sectiondivider_' + t.id + '_' + Date.now().toString(36),
        dataUrl: pdfedSectionDividerDataUrl(accent, bandW, ruleH),
        x: bandX, y: Math.round(bandBottom - ruleH), w: bandW, h: ruleH,
        zIndex: stackBaseZ + 1, locked: true, _sectionDivider: true,
      });

      // Text is drawn at (t.x + padX) — see pdfedDrawPlacedTextsOnCtx — so
      // solve backwards from where the badge now sits (iconX, rule-anchored)
      // to the t.x that lands the text exactly `gap` past the badge.
      t.x = Math.round(iconX + iconSize + gap - padX);
      t._sectionIconShift = t.x - origX;
      pg.placedImages.push({
        id: 'sectionicon_' + t.id + '_' + Date.now().toString(36),
        dataUrl: pdfedSectionIconBadgeDataUrl(key, accent, iconSize * 2),
        x: iconX, y: iconY, w: iconSize, h: iconSize,
        zIndex: stackBaseZ + 1, locked: true, _sectionIcon: true,
      });
      count++;
    });
  });
  return count;
}

// A relayout (pdfedAutoAlignContent) recomputes every flow item's y — and
// sometimes a heading's x, if content around it changes — but it never
// touches an existing section badge/divider image: those are decorations,
// not flow items (see the _sectionIcon/_sectionDivider guard inside
// pdfedAutoAlignContent), so they only ever get placed once, by
// pdfedApplySectionIcons at Refine Report time. A manual pull/push doesn't
// go through that pass again, so without this, a heading that already had
// a badge from an earlier Refine run stays shifted to its new position
// while its badge+divider stay pinned to the OLD position — which is
// exactly what reads as a badge sitting on top of the heading's own first
// letters after a push/pull moves it. This finds each heading's own badge
// and divider (matched by id, not re-detected) and moves them to match,
// using the exact same geometry pdfedApplySectionIcons uses to place them
// in the first place — it never creates, removes, or re-colors anything,
// so a heading with no badge is left untouched.
function pdfedResyncSectionIconsForPage(pg) {
  if (!pg || !pg.placedTexts || !pg.placedTexts.length || !pg.placedImages || !pg.placedImages.length) return;
  const headings = pg.placedTexts.filter(t => t && t._sectionIconShift);
  if (!headings.length) return;
  const pageW = pg.width || 800;
  const margin = 36;
  headings.forEach(t => {
    const iconPrefix = 'sectionicon_' + t.id + '_';
    const dividerPrefix = 'sectiondivider_' + t.id + '_';
    const icon = pg.placedImages.find(im => im && im._sectionIcon && typeof im.id === 'string' && im.id.indexOf(iconPrefix) === 0);
    const divider = pg.placedImages.find(im => im && im._sectionDivider && typeof im.id === 'string' && im.id.indexOf(dividerPrefix) === 0);
    if (!icon && !divider) return; // no badge left to resync for this heading

    // Recover the heading's true unshifted x (same undo pdfedApplySectionIcons
    // does on a re-run) before recomputing geometry off of it.
    const origX = (t.x || 0) - t._sectionIconShift;
    const fontSize = t.fontSize || 20;
    const iconSize = (icon && icon.w) || Math.max(20, Math.round(fontSize * 1.3));
    const gap = 10;
    const padX = PDFED_PTXT_PAD_X + PDFED_PTXT_BORDER, padY = PDFED_PTXT_PAD_Y + PDFED_PTXT_BORDER;
    const lineHeight = fontSize * 1.25;
    const lines = String(t.text || '').split('\n').length;

    const assocTable = pdfedFindAssociatedTable(pg, t);
    const tableX = assocTable ? (assocTable.x || 0) : null;
    const tableW = assocTable ? pdfedTableWidth(assocTable) : 0;
    const innerPadX = 12;
    const barPad = 6;
    let bandX = (assocTable && tableW > 0) ? Math.round(tableX) : Math.max(0, Math.round(origX + padX - innerPadX));
    let bandW = (assocTable && tableW > 0) ? Math.round(tableW) : Math.max(60, Math.round(pageW - margin - bandX));
    if (bandX < margin) { bandW -= (margin - bandX); bandX = margin; }
    if (bandX + bandW > pageW - margin) bandW = Math.max(60, pageW - margin - bandX);

    const iconX = bandX + innerPadX;
    const iconY = Math.round((t.y || 0) + padY + (lineHeight - iconSize) / 2);
    const rowBottom = (t.y || 0) + padY + lines * lineHeight;
    const ruleH = Math.max(2, Math.round(fontSize * 0.14));
    const bandBottom = Math.round(Math.max(rowBottom, iconY + iconSize) + barPad);

    // Re-anchor the heading's x the same way pdfedApplySectionIcons does —
    // covers the case where the relayout reset it back toward its raw,
    // unshifted position.
    t.x = Math.round(iconX + iconSize + gap - padX);
    t._sectionIconShift = t.x - origX;

    if (icon) { icon.x = iconX; icon.y = iconY; icon.w = iconSize; icon.h = iconSize; }
    if (divider) { divider.x = bandX; divider.y = Math.round(bandBottom - ruleH); divider.w = bandW; divider.h = ruleH; }
  });
}

// A small image reads as a logo/brand mark no matter where it currently
// sits on the page — a report header logo dragged mid-canvas by accident,
// or dropped low during editing, is still a logo, not a content image, and
// belongs pinned in the header on refine. So this is purely a size check;
// it deliberately does NOT require the image to already be near the top —
// that's the whole point of forcing it up there. Thresholds scale with the
// page itself so this works the same on a small canvas as it does on a
// full A4 sheet, not just at one fixed pixel size.
function pdfedIsAnchorImage(img, pageW, pageH) {
  // Charts/maps pushed in from Diagrams & Graphs are content, never a logo
  // or brand mark — no matter how small they end up. Without this guard a
  // small pushed chart passes the pure size check below and gets
  // misread as "the page already has a logo" (silently skipping real logo
  // insertion in pdfedInsertLogoIntoPages) or gets yanked out of the normal
  // content flow and pinned into a header slot like a logo would be.
  if (img.kind === 'chart' || img.kind === 'map') return false;
  const maxW = Math.max(220, pageW * 0.42);
  const maxH = Math.max(170, pageH * 0.22);
  return (img.w || 0) <= maxW && (img.h || 0) <= maxH;
}

// Which of the three natural header slots — left, center, right — the logo
// already reads closest to, going purely off where its center currently
// sits. This is what makes the placement feel "smart": a logo dropped a
// little off-center still lands wherever it was clearly headed, instead of
// every logo defaulting to the same corner regardless of intent.
function pdfedAnchorSlotX(img, pageW, margin) {
  const w = img.w || 0;
  const center = (img.x || 0) + w / 2;
  const slots = {
    left: margin,
    center: Math.round((pageW - w) / 2),
    right: Math.round(pageW - margin - w),
  };
  const dist = {
    left: Math.abs(center - (margin + w / 2)),
    center: Math.abs(center - pageW / 2),
    right: Math.abs(center - (pageW - margin - w / 2)),
  };
  const best = Object.keys(dist).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
  return slots[best];
}

// Same three header slots as pdfedAnchorSlotX above, but for when the person
// has explicitly picked a logo placement (Left / Center / Right) in the
// Refine Report modal rather than leaving it to the "closest to where it
// already sits" guess — the explicit choice always wins.
function pdfedAnchorSlotXForced(img, pageW, margin, slot) {
  const w = img.w || 0;
  if (slot === 'left') return margin;
  if (slot === 'center') return Math.round((pageW - w) / 2);
  return Math.round(pageW - margin - w); // 'right' (and default)
}

// A flowed item's own footprint — a table's is the sum of its row heights/
// column widths (colWidths can change under 'stretch', so width has to be
// read fresh rather than cached). A text box has NO stored height the real
// renderer trusts at all (pdfedPositionPlacedTextEl never sets el.style.
// height — the box always auto-sizes to its content), so item.h is not
// meaningful here; height has to be worked out the same way the browser
// would actually wrap it. Images/shapes just report their own w/h.
function pdfedEstimateTextHeight(item, pageW, margin) {
  const text = String(item.text || '').trim();
  const fontSize = item.fontSize || 14;
  const lineHeight = fontSize * 1.25; // matches .pdfed-ptxt-content's line-height:1.25
  const vPad = PDFED_PTXT_PAD_Y * 2 + PDFED_PTXT_BORDER * 2;
  if (!text) return Math.round(lineHeight + vPad);
  // Same wrap-width rule pdfedPositionPlacedTextEl actually renders with: a
  // fixed item.w if one was ever set, otherwise capped to whatever room is
  // left to the page edge — NOT some arbitrary narrow default. Getting this
  // wrong is what was inflating line counts (and heights) for any ordinary
  // auto-width paragraph.
  const wrapW = item.w
    ? Math.max(20, item.w - PDFED_PTXT_PAD_X * 2 - PDFED_PTXT_BORDER * 2)
    : Math.max(48, (pageW || 800) - (margin || 36) - 12 - PDFED_PTXT_PAD_X * 2 - PDFED_PTXT_BORDER * 2);
  const ctx = pdfedRefineMeasureCtx();
  ctx.font = `${item.bold ? 'bold ' : ''}${fontSize}px ${pdfedFontCss(item.fontFamily || 'Inter')}`;
  let lines = 0;
  text.split('\n').forEach(paragraph => {
    if (!paragraph) { lines += 1; return; }
    let line = '';
    paragraph.split(' ').forEach(word => {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > wrapW) { lines += 1; line = word; }
      else { line = test; }
    });
    if (line) lines += 1;
  });
  return Math.round(Math.max(1, lines) * lineHeight + vPad);
}

function pdfedFlowSize(item, kind, pageW, margin) {
  if (kind === 'table') {
    return {
      w: (item.colWidths || []).reduce((a, b) => a + b, 0),
      h: (item.rowHeights || []).reduce((a, b) => a + b, 0),
    };
  }
  if (kind === 'text') {
    return { w: item.w || 0, h: pdfedEstimateTextHeight(item, pageW, margin) };
  }
  return { w: item.w || 0, h: item.h || 0 };
}

// Straightens a page's *entire* content — tables, headings/paragraphs, and
// real content images (charts, figures, screenshots) — against a shared
// margin (or centers/stretches), then restacks all of it top-to-bottom in
// one shared flow, in whatever reading order it already sits in, with an
// even gap between pieces. This is what stops a chart landing on top of a
// table, or a table landing on top of a heading, after a refine pass.
//
// Small corner logos are deliberately left out of the stack (see
// pdfedIsAnchorImage) and instead snapped into whichever of the three
// natural header slots — left, center, right — they already read closest
// to. Once the logo has its slot, the flow's own starting position is
// pushed clear of it, so a heading or table can never open underneath it.
// Clusters content images that already sit side-by-side (same visual "row")
// into groups, so a deliberately-placed chart pair — like two bar charts
// next to each other with one shared data table underneath — reflows as
// ONE block instead of getting pulled apart into two separate full-width
// stacked images. Two images belong to the same row when their vertical
// centers are close relative to their own height (i.e. placed next to each
// other, not one above the other). Each row is then sorted left-to-right so
// reading order is preserved.
function pdfedGroupImagesIntoRows(images) {
  const sorted = images.slice().sort((a, b) => (a.y || 0) - (b.y || 0));
  const rows = [];
  sorted.forEach(img => {
    const cy = (img.y || 0) + (img.h || 0) / 2;
    const last = rows[rows.length - 1];
    if (last) {
      const refImg = last[0];
      const refCy = (refImg.y || 0) + (refImg.h || 0) / 2;
      const tolerance = Math.min(img.h || 0, refImg.h || 0) * 0.5 || 20;
      const closeEnoughVertically = Math.abs(cy - refCy) <= tolerance;
      // Only actually treat two images as one deliberate row if they're
      // also a similar SHAPE — a wide bar chart and a near-square pie
      // chart happening to sit at a similar height is coincidence, not a
      // deliberate side-by-side pairing. Forcing them into one row
      // normalizes them to a shared height (see pdfedSizeImageRow) and
      // stretches the whole row edge-to-edge, which is exactly what
      // turned a pie chart + a small bar chart into a distorted,
      // unprofessional-looking pair. A row only ever merges shapes that
      // were already reasonably alike to begin with.
      const hA = img.h || 1, hB = refImg.h || 1;
      const heightRatio = Math.max(hA, hB) / Math.min(hA, hB);
      const aspectA = (img.w || 1) / hA, aspectB = (refImg.w || 1) / hB;
      const aspectRatio = Math.max(aspectA, aspectB) / Math.max(0.01, Math.min(aspectA, aspectB));
      const similarShape = heightRatio <= 1.6 && aspectRatio <= 1.8;
      if (closeEnoughVertically && similarShape) { last.push(img); return; }
    }
    rows.push([img]);
  });
  rows.forEach(r => r.sort((a, b) => (a.x || 0) - (b.x || 0)));
  return rows;
}

// Fixed report-header/footer text (Refine Report's title/subheading/
// contact/address block) is pinned where it was placed, on purpose — it's
// masthead/letterhead content, not part of the document's reading flow, and
// must never be picked up by the auto-layout engine, the whitespace crawler,
// or the manual pull-up/push-down arrows as if it were a paragraph or
// heading that can be reflowed, resized, or moved to a different page.
function pdfedIsFlowText(t) { return !(t && (t._reportHeaderText || t._reportFooterText)); }

function pdfedAutoAlignContent(pg, mode, logoPosition, dividerColor) {
  const pc = document.getElementById('pdfedPageCanvas');
  const pageW = pg.width || (pc && pc.width) || 600;
  const pageH = pg.height || (pc && pc.height) || 800;
  const margin = 36;
  // Two gap tiers instead of one flat number: SECTION_GAP is the real
  // visual break between one section's content and the NEXT section's
  // heading — that's the gap that should read clearly. HEADING_GAP is the
  // tight space directly under a heading, before the content it introduces
  // — a heading should hug what it's labeling, not float the same distance
  // from it as it does from the section above. Applying one flat gap
  // everywhere (the old behavior) made every junction look the same
  // regardless of what was actually next to what, which is what read as
  // "uneven" — a heading sat exactly as far from its own table as from the
  // unrelated content above it, so nothing about the spacing signaled which
  // heading belonged to which block.
  const SECTION_GAP = 24;
  const HEADING_GAP = 10;
  // Tight gap between a chart row and the table sitting directly under it —
  // e.g. a pair of comparison charts and the data table they visualize —
  // same idea as HEADING_GAP: that table "belongs to" the row right above
  // it, so it should hug it, while the NEXT chart row + table (a different
  // section) still gets the full SECTION_GAP before it.
  const GROUP_GAP = 14;
  // Gap between two WRAPPED rows of the same chart cluster (see
  // pdfedChunkImageRow above) — tighter than SECTION_GAP so a 6-chart
  // cluster wrapped into two rows of 3 still reads as one block, but not
  // as tight as GROUP_GAP (that's reserved for "this table belongs to the
  // row right above it").
  const WRAP_GAP = 18;
  const MIN_GAP = 6;
  // Never shrink content past this fraction of its original size — beyond
  // this point it's reading as broken, not "fitted", so a page this
  // overloaded needs more pages, not smaller and smaller text. The flow
  // still gets clamped to the page as an absolute last resort below, but
  // this is where "shrink to fit" stops being the right tool for it.
  const MIN_SHRINK = 0.55;
  // A deliberately lower floor than MIN_SHRINK above, used only to rescue a
  // page from the "one small chart/table spills onto its own follow-on
  // page, leaving most of that page blank" outcome. If shrinking everything
  // down to somewhere between MIN_SHRINK and this floor is enough to make
  // the WHOLE page's content fit together, that reads as more professional
  // than a mostly-empty second page — so it's tried first, below, before
  // ever falling back to an actual page split. If even this floor isn't
  // enough, the content is genuinely too much for one page and the normal
  // split still applies, giving the leftover its own proper page.
  const RESCUE_MIN_SHRINK = 0.42;
  const IMG_ROW_GAP = 16; // horizontal gap between images placed in the same row
  const maxContentW = pageW - margin * 2;
  // A visual cluster of charts (see pdfedGroupImagesIntoRows) can be any
  // size — 5, 6+ charts that all happen to sit at the same y all cluster
  // together. Cramming all of them into one row would shrink every chart
  // past the point of being readable and risk overflowing the page width
  // outright, so a cluster wider than this many charts wraps into
  // additional rows instead. The cap itself adapts to how wide the actual
  // charts are (a cluster of narrow charts can fit more side-by-side than
  // a cluster of wide ones) but never goes past 4 — beyond that it reads
  // cramped on an A4-width page regardless of how much room the math says
  // is technically available.
  const MIN_CHART_W = 150;
  function pdfedChunkImageRow(images) {
    const avgW = images.reduce((s, im) => s + (im.w || 100), 0) / images.length;
    let maxPerRow = Math.floor((maxContentW + IMG_ROW_GAP) / (Math.max(avgW * 0.55, MIN_CHART_W) + IMG_ROW_GAP));
    maxPerRow = Math.max(1, Math.min(maxPerRow, 4));
    if (images.length <= maxPerRow) return [images];
    const chunks = [];
    for (let i = 0; i < images.length; i += maxPerRow) chunks.push(images.slice(i, i + maxPerRow));
    return chunks;
  }

  const flow = [];
  const anchors = [];

  (pg.placedTables || []).forEach(item => flow.push({ item, kind: 'table' }));
  (pg.placedTexts || []).forEach(item => { if (pdfedIsFlowText(item)) flow.push({ item, kind: 'text' }); });

  const contentImages = [];
  (pg.placedImages || []).forEach(item => {
    if (item._sectionIcon || item._sectionDivider || item._sectionBar || item._headerDivider || item._watermark) return; // handled separately — never an anchor/flow item
    if (pdfedIsAnchorImage(item, pageW, pageH)) anchors.push(item);
    else contentImages.push(item);
  });
  // Group side-by-side images (a deliberately placed chart cluster) into
  // flow entries; a lone image just becomes a row of one, same as before.
  // A cluster bigger than the row can comfortably hold wraps into several
  // consecutive rows — all tagged with the same wrapGroup id so the gap
  // pass below can hug them together (a WRAP_GAP, not a full SECTION_GAP)
  // and still treat the whole cluster as one section when a table follows.
  let wrapGroupSeq = 0;
  pdfedGroupImagesIntoRows(contentImages).forEach(clusterImages => {
    if (clusterImages.length === 1) { flow.push({ item: clusterImages[0], kind: 'image' }); return; }
    const chunks = pdfedChunkImageRow(clusterImages);
    const wrapGroup = chunks.length > 1 ? ++wrapGroupSeq : null;
    chunks.forEach(rowImages => {
      if (rowImages.length === 1) flow.push({ item: rowImages[0], kind: 'image', wrapGroup });
      else flow.push({ item: rowImages[0], images: rowImages, kind: 'imageRow', wrapGroup });
    });
  });
  // placedShapes/placedBorders are left as-is — mostly page-level decoration
  // (dividers, background panels, frame borders) rather than stackable
  // content, and reflowing them tends to do more harm than good.

  // Smart auto-arrange: snap each logo into its nearest natural header slot
  // (left / center / right), at a consistent, professional offset from the
  // page edge — never wherever it happened to be dropped.
  anchors.forEach(img => {
    img.x = logoPosition ? pdfedAnchorSlotXForced(img, pageW, margin, logoPosition) : pdfedAnchorSlotX(img, pageW, margin);
    img.y = Math.round(margin * 0.6);
  });
  let anchorBottom = anchors.length ? Math.max(...anchors.map(a => a.y + (a.h || 0))) : 0;

  // Mandatory header divider: whenever a logo/header mark sits on the page,
  // a thin margin-to-margin accent rule always runs underneath it — same
  // gradient-rule treatment as the section-title dividers below, just
  // stretched the full content width instead of one table's width, so the
  // header always reads as a finished, professional band rather than a
  // logo floating with nothing to ground it. Regenerated fresh every pass
  // (stripped first) so it never drifts or duplicates on repeated runs.
  pg.placedImages = (pg.placedImages || []).filter(im => !im._headerDivider);
  const HEADER_DIVIDER_GAP = 10;
  const HEADER_DIVIDER_H = 3;
  if (anchors.length && dividerColor) {
    const bandY = anchorBottom + HEADER_DIVIDER_GAP;
    const bandW = pageW - margin * 2;
    pg.placedImages.push({
      id: 'headerdivider_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      dataUrl: pdfedSectionDividerDataUrl(dividerColor, bandW, HEADER_DIVIDER_H),
      x: margin, y: bandY, w: bandW, h: HEADER_DIVIDER_H, zIndex: 998, locked: true, _headerDivider: true,
    });
    anchorBottom = bandY + HEADER_DIVIDER_H;
  }

  if (!flow.length) return [];

  flow.sort((a, b) => (a.item.y || 0) - (b.item.y || 0));

  // pdfedGroupImagesIntoRows above only clusters images that already sit at
  // the same height and read as a similar shape — it deliberately leaves a
  // messily-pasted pair (dropped at different heights, different sizes —
  // e.g. a bar chart dragged in first near the top, a pie chart pasted in
  // later, lower down) as two separate lone images, so it never forces a
  // genuinely unrelated pair into a distorted row. But once everything is
  // sorted into one flow by y, any run of consecutive lone images that's
  // immediately followed by the SAME table — with nothing else (a heading,
  // another table) breaking up the run — unambiguously belongs to that
  // table: there's nothing else on the page between them. That run is
  // merged into a single row here and handed to the same pdfedSizeImageRow
  // treatment a deliberately-placed side-by-side cluster gets below, so a
  // messily-pasted set of charts still comes out of Refine Report as one
  // clean, evenly-matched row sitting above its table.
  {
    const merged = [];
    let i = 0;
    while (i < flow.length) {
      const entry = flow[i];
      if (entry.kind === 'image') {
        const run = [entry.item];
        let j = i + 1;
        while (j < flow.length && flow[j].kind === 'image') { run.push(flow[j].item); j++; }
        const followedByTable = j < flow.length && flow[j].kind === 'table';
        if (run.length > 1 && followedByTable) {
          merged.push({ item: run[0], images: run, kind: 'imageRow' });
          i = j;
          continue;
        }
      }
      merged.push(entry);
      i++;
    }
    flow.length = 0;
    flow.push(...merged);
  }

  // Always start from the same, consistent top position — never from
  // wherever the first item happened to already be sitting. Inheriting the
  // original y0 (the old behavior) is exactly what produced inconsistent
  // top gaps from one refine pass to the next: a page whose content
  // happened to start low kept a big blank gap up top, while a page that
  // started near the margin didn't.
  const startY = Math.max(margin, anchorBottom ? anchorBottom + SECTION_GAP : margin);

  // One gap value per junction between consecutive flow items — the gap
  // AFTER item i, before item i+1. A heading immediately followed by its
  // own content gets the tight HEADING_GAP; two rows wrapped from the same
  // chart cluster get the tighter WRAP_GAP; a chart row (or the last wrap
  // of one) immediately followed by a table gets the tight GROUP_GAP (that
  // table is "for" that row/cluster); every other junction (including the
  // real break into a new section) gets the full SECTION_GAP.
  let gaps = flow.slice(0, -1).map(({ item, kind, wrapGroup }, i) => {
    const next = flow[i + 1];
    if (kind === 'text' && pdfedTextLooksLikeHeading(item)) return HEADING_GAP;
    if ((kind === 'imageRow' || kind === 'image') && next && (next.kind === 'imageRow' || next.kind === 'image')
        && wrapGroup != null && next.wrapGroup === wrapGroup) return WRAP_GAP;
    if ((kind === 'imageRow' || kind === 'image') && next && next.kind === 'table') return GROUP_GAP;
    return SECTION_GAP;
  });

  // A lone chart sitting directly above its own data table gets sized on
  // purpose instead of being left at whatever tiny (or oversized) footprint
  // it happened to arrive at — a chart that visualizes the table right below
  // it is the centerpiece of that section and should read as a prominent,
  // enhanced graphic, not a thumbnail. It's scaled (aspect ratio kept, never
  // distorted) UP to a generous share of the width its table settles on —
  // enhancing a chart that arrived small — then centered over that same
  // table's span so the two visually belong to each other even under
  // 'left'/'stretch' alignment, where every other flow item sits flush at
  // the page margin. The upscale is capped at 1.6x the chart's own natural
  // size so a low-resolution source image is never blown up past the point
  // of visible pixelation; within that ceiling, it's always sized UP toward
  // the target, never shrunk below what it already was. A chart that's part
  // of a side-by-side pair (handled by pdfedSizeImageRow just below, which
  // already fills the row 50/50-ish across the full content width) or that
  // isn't immediately followed by a table is left alone — there's nothing
  // concrete to size it against.
  const CHART_TABLE_WIDTH_TARGET = 0.85; // generous share of the table's width — enhance, don't shrink
  const CHART_MAX_UPSCALE = 1.6; // never blow a chart up past 1.6x its own natural size
  flow.forEach((entry, i) => {
    if (entry.kind !== 'image') return;
    const next = flow[i + 1];
    if (!next || next.kind !== 'table') return;
    const item = entry.item;
    const naturalW = item.w || 0, naturalH = item.h || 0;
    if (!(naturalW > 0) || !(naturalH > 0)) return;
    const tableW = Math.min(pdfedTableWidth(next.item) || maxContentW, maxContentW);
    const desiredW = Math.min(tableW, maxContentW) * CHART_TABLE_WIDTH_TARGET;
    const maxAllowedW = Math.min(maxContentW, naturalW * CHART_MAX_UPSCALE);
    // Never shrink a chart that's already at or above the desired size —
    // only ever grow it toward the target (still bounded by the page and
    // the upscale ceiling above).
    const targetW = Math.max(MIN_CHART_W, naturalW, Math.min(desiredW, maxAllowedW));
    const scale = targetW / naturalW;
    item.w = Math.round(targetW);
    item.h = Math.round(naturalH * scale);
    // Stashed only for the positioning pass below (left/stretch mode) to
    // center this chart over its table instead of flush-left at the
    // margin; deleted again right after it's consumed so it never leaks
    // into the saved page data.
    item._refineChartTableW = tableW;
  });

  // A chart row's natural footprint: normalize every image in the row to a
  // shared height (their average original height) so a side-by-side pair
  // reads as one clean, evenly-matched block instead of two mismatched
  // charts, then uniformly scale the whole row so it fills the page's
  // content width edge-to-edge (capped so it can never blow a low-res chart
  // up past ~1.6x its own size, and never shrunk past 0.4x). This is also
  // what gives two same-shaped charts a clean 50/50 side-by-side split.
  function pdfedSizeImageRow(images, maxContentW) {
    const targetH = images.reduce((s, im) => s + (im.h || 0), 0) / images.length;
    const naturalWidths = images.map(im => targetH * ((im.w || 1) / (im.h || 1)));
    const naturalSumW = naturalWidths.reduce((a, b) => a + b, 0);
    const gapW = IMG_ROW_GAP * (images.length - 1);
    let rowScale = naturalSumW > 0 ? (maxContentW - gapW) / naturalSumW : 1;
    rowScale = Math.max(0.4, Math.min(rowScale, 1.6));
    const widths = naturalWidths.map(w => Math.max(20, Math.round(w * rowScale)));
    const h = Math.max(20, Math.round(targetH * rowScale));
    return { widths, h, w: widths.reduce((a, b) => a + b, 0) + gapW };
  }

  // Measure the flow's natural footprint at the requested gaps *before*
  // placing anything, so a page that doesn't actually fit gets compressed
  // instead of quietly spilling content past the bottom edge.
  let sizes = flow.map(({ item, kind, images }) => {
    if (kind === 'imageRow') {
      const r = pdfedSizeImageRow(images, maxContentW);
      return { w: r.w, h: r.h, _rowWidths: r.widths };
    }
    return pdfedFlowSize(item, kind, pageW, margin);
  });
  const naturalContentH = sizes.reduce((sum, s) => sum + s.h, 0);
  const availableH = Math.max(40, pageH - margin - startY);
  const totalGap = () => gaps.reduce((a, b) => a + b, 0);
  const naturalTotalH = naturalContentH + totalGap();

  if (naturalTotalH > availableH) {
    // Step 1 — tighten the gaps first, proportionally, so a HEADING_GAP/
    // GROUP_GAP junction stays visibly tighter than a SECTION_GAP one even
    // after compression instead of everything collapsing to the same
    // value. Cheapest fix, and the one least likely to be visually noticeable.
    const roomForGaps = availableH - naturalContentH;
    const tg = totalGap();
    if (tg > 0) {
      const gapScale = Math.max(0, Math.min(1, roomForGaps / tg));
      gaps = gaps.map(g => Math.max(MIN_GAP, g * gapScale));
    }

    // Step 2 — if it still doesn't fit even at the minimum gaps, shrink
    // every flowed item's font size (and a table's row heights along with
    // it) by one shared ratio, so the page's actual content — not just its
    // spacing — gets smaller together rather than any one piece getting
    // singled out. This is what guarantees a refine pass can't leave a
    // table or paragraph hanging off the bottom of the canvas.
    const tightTotalH = naturalContentH + totalGap();
    if (tightTotalH > availableH) {
      const rawScale = availableH / tightTotalH;
      // If everything fits together at some scale down to RESCUE_MIN_SHRINK,
      // use exactly that scale — the whole page's content stays as one
      // group instead of splitting off a small tail onto a new, mostly
      // blank page. Only when even that lower floor isn't enough does this
      // fall back to the normal MIN_SHRINK clamp, which leaves genuine
      // overflow for the split logic below to hand onto a fresh page.
      const effectiveFloor = rawScale >= RESCUE_MIN_SHRINK ? RESCUE_MIN_SHRINK : MIN_SHRINK;
      const scale = Math.max(effectiveFloor, Math.min(1, rawScale));
      flow.forEach(({ item, kind, images }) => {
        if (kind === 'table') {
          item.fontSize = Math.max(7, (item.fontSize || 12) * scale);
          if (Array.isArray(item.rowHeights)) item.rowHeights = item.rowHeights.map(h => Math.max(12, h * scale));
        } else if (kind === 'text') {
          item.fontSize = Math.max(9, (item.fontSize || 14) * scale);
        } else if (kind === 'image') {
          const w = (item.w || 0) * scale, h = (item.h || 0) * scale;
          if (w > 0) item.w = w;
          if (h > 0) item.h = h;
        } else if (kind === 'imageRow') {
          images.forEach(im => {
            const w = (im.w || 0) * scale, h = (im.h || 0) * scale;
            if (w > 0) im.w = w;
            if (h > 0) im.h = h;
          });
        }
      });
      // Re-measure against the now-smaller items for the actual stacking
      // pass below — heights above were computed pre-shrink.
      sizes = flow.map(({ item, kind, images }) => {
        if (kind === 'imageRow') {
          const r = pdfedSizeImageRow(images, maxContentW);
          return { w: r.w, h: r.h, _rowWidths: r.widths };
        }
        return pdfedFlowSize(item, kind, pageW, margin);
      });
    }
  }

  // Overflow split: even at the minimum acceptable shrink, some pages
  // genuinely hold more charts/tables than one sheet can show cleanly —
  // e.g. six comparison charts plus a full financial table stacked on a
  // single canvas. Squeezing further would cross MIN_SHRINK into
  // illegible text; letting it spill past the bottom edge is what made a
  // heavily-loaded page look cluttered/overlapping in the first place.
  // Instead, keep everything that fits at a clean, readable size on THIS
  // page, in order, and hand back whatever's left so the caller can carry
  // it onto a fresh page of its own — the same "spill onto extra pages"
  // idea already used when a long data table is pushed into the
  // Workspace, just applied to a full report flow instead of one table.
  let overflowFlow = [];
  {
    const finalTotalH = sizes.reduce((s, sz) => s + sz.h, 0) + gaps.reduce((a, b) => a + b, 0);
    if (finalTotalH > availableH) {
      let acc = 0;
      let cut = flow.length;
      for (let i = 0; i < flow.length; i++) {
        const gapBefore = i > 0 ? (gaps[i - 1] || 0) : 0;
        if (acc + gapBefore + sizes[i].h > availableH) { cut = i; break; }
        acc += gapBefore + sizes[i].h;
      }
      // Never strand a heading alone at the bottom of the page with
      // whatever it introduces pushed to the next one — carry the
      // heading forward with its content instead.
      if (cut > 0 && cut < flow.length) {
        const lastKept = flow[cut - 1];
        if (lastKept.kind === 'text' && pdfedTextLooksLikeHeading(lastKept.item)) cut -= 1;
      }
      // Always keep at least one item on the page (a single oversized
      // chart/table with nothing else) — there's nowhere shorter to put it.
      cut = Math.max(1, cut);
      if (cut < flow.length) {
        overflowFlow = flow.slice(cut);
        flow.length = cut;
        sizes.length = cut;
        gaps.length = Math.max(0, cut - 1);
      }
    }
  }

  let cursorY = startY;
  flow.forEach(({ item, kind, images }, i) => {
    const size = sizes[i];
    if (mode === 'center') {
      item.x = Math.round((pageW - size.w) / 2);
    } else if (kind === 'image' && item._refineChartTableW) {
      // A lone chart sized against its table just above (see
      // CHART_TABLE_WIDTH_FRACTION above) centers over that table's own
      // span instead of sitting flush at the page margin like every other
      // 'left'/'stretch' item — it visually belongs to the table below it,
      // so it should look centered on it, not left-hung above it.
      item.x = margin + Math.round((item._refineChartTableW - size.w) / 2);
    } else {
      // 'left', and 'stretch' for non-table items — stretching an image,
      // chart, or heading would distort/misjudge it, so those always just
      // left-align instead of scaling to width. Table width for 'stretch'
      // is already settled before this runs (see pdfedApplyReportRefinement).
      // A multi-image row is the one exception: it's already been sized to
      // fill the content width edge-to-edge above, so it left-aligns at the
      // margin same as everything else and simply IS full width.
      item.x = margin;
    }
    if (item._refineChartTableW !== undefined) delete item._refineChartTableW;
    // Clearance: the first item in the flow is the one that would open
    // directly under a header logo, since everything after it is pushed
    // down anyway by the normal stacking below. If this item's own
    // horizontal span would pass under any logo's footprint, start it
    // below the logo instead of at the plain top margin.
    if (i === 0 && anchorBottom > cursorY) {
      const itemRight = item.x + size.w;
      const overlapsAnyAnchor = anchors.some(a => itemRight > a.x && item.x < a.x + (a.w || 0));
      if (overlapsAnyAnchor || !size.w) cursorY = anchorBottom + SECTION_GAP;
    }
    item.y = Math.round(cursorY);
    if (kind === 'imageRow') {
      // Lay the row's images left-to-right inside the row's own box, each
      // matched to the shared row height computed above, with a fixed gap
      // between them — this is what keeps the pair reading as one row
      // instead of the flow's single x/y only moving the first image.
      let x = item.x;
      images.forEach((im, k) => {
        im.x = Math.round(x);
        im.y = item.y;
        im.w = size._rowWidths[k];
        im.h = size.h;
        x += size._rowWidths[k] + IMG_ROW_GAP;
      });
    }
    cursorY += size.h + (gaps[i] || 0);
  });

  // Absolute safety net: even after tightening the gap and shrinking
  // everything down to the minimum, an extreme page (far more content than
  // could ever read cleanly on one sheet) could still end past the bottom
  // edge. Rather than let that spill silently off-canvas, pull the whole
  // stack up by the overflow amount — bounded so it never pushes the first
  // item above the top margin/anchor clearance it started at.
  const maxBottom = pageH - margin;
  let overflowBy = 0;
  flow.forEach(({ item, kind, images }, i) => {
    const bottom = item.y + sizes[i].h;
    if (bottom > maxBottom) overflowBy = Math.max(overflowBy, bottom - maxBottom);
  });
  if (overflowBy > 0) {
    const shiftUp = Math.min(overflowBy, startY - margin);
    if (shiftUp > 0) {
      flow.forEach(({ item, kind, images }) => {
        item.y = Math.round(item.y - shiftUp);
        if (kind === 'imageRow') images.forEach(im => { im.y = item.y; });
      });
    }
  }

  // Pull anything that overflowed out of this page's own placed arrays —
  // the caller (pdfedApplyReportRefinement) moves these onto a new page
  // right after this one, so they can't stay listed here too.
  if (overflowFlow.length) {
    const moving = new Set();
    overflowFlow.forEach(f => {
      if (f.kind === 'imageRow') f.images.forEach(im => moving.add(im));
      else moving.add(f.item);
    });
    if (pg.placedTables) pg.placedTables = pg.placedTables.filter(t => !moving.has(t));
    if (pg.placedTexts) pg.placedTexts = pg.placedTexts.filter(t => !moving.has(t));
    if (pg.placedImages) pg.placedImages = pg.placedImages.filter(im => !moving.has(im));
  }

  return overflowFlow;
}

function pdfedTableWidth(t) {
  return (t.colWidths || []).reduce((a, b) => a + b, 0);
}

// A heading "belongs to" whichever table it introduces — the nearest table
// sitting at or below it on the same page. Falls back to the nearest table
// overall (above included) if nothing sits below, so a heading placed under
// its table (a caption-style label) still picks something up.
function pdfedFindAssociatedTable(pg, heading) {
  const tables = pg.placedTables || [];
  if (!tables.length) return null;
  const below = tables.filter(t => (t.y || 0) >= (heading.y || 0) - 10)
                       .sort((a, b) => (a.y || 0) - (b.y || 0));
  if (below.length) return below[0];
  return tables.slice().sort((a, b) =>
    Math.abs((a.y || 0) - (heading.y || 0)) - Math.abs((b.y || 0) - (heading.y || 0))
  )[0];
}

// The actual multi-page pass. Returns a summary used for the confirmation
// toast. `snapshotPages`, if passed, is a deep clone of pdfed.pages taken
// before any change, purely so the caller can wire up a single Ctrl+Z step.
// Builds a fresh, blank page matching a source page's exact size/density/
// background, for content that overflowed off the bottom of that page
// during Refine Report. Also carries forward any header logo (or other
// small anchor image) already on the source page, so a report that spills
// onto extra pages still reads as one consistent, branded document rather
// than the overflow looking like a bare afterthought.
async function pdfedMakeRefineOverflowPage(sourcePg) {
  const pxPerMm = pdfedPageDensity(sourcePg);
  const [mmW, mmH] = sourcePg.pageMM || [210, 297];
  const bg = sourcePg.bgColor || '#ffffff';
  let dataUrl;
  try {
    dataUrl = await pdfedRenderBlankPage('', bg, mmW, mmH);
  } catch (e) {
    console.error('Refine Report: could not create an overflow page', e);
    dataUrl = sourcePg.dataUrl;
  }
  const width = sourcePg.width || Math.round(mmW * pxPerMm);
  const height = sourcePg.height || Math.round(mmH * pxPerMm);
  const pg = {
    type: 'blank',
    dataUrl,
    modified: true,
    edits: {},
    textBlocks: [],
    label: (sourcePg.label || 'Page') + ' (cont.)',
    bgColor: bg,
    pageMM: [mmW, mmH],
    width, height,
    _pxPerMm: pxPerMm,
    placedTables: [],
    placedTexts: [],
    placedImages: [],
  };
  (sourcePg.placedImages || []).forEach(img => {
    if (img._sectionIcon || img._sectionDivider || img._sectionBar || img._headerDivider || img._watermark) return;
    if (!pdfedIsAnchorImage(img, width, height)) return;
    pg.placedImages.push(Object.assign({}, img, {
      id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
      zIndex: pdfedNextZ(pg),
    }));
  });
  return pg;
}

// ── Map Grid Layout (Refine Report) ───────────────────────────────────────
// A map pushed in from Diagrams & Graphs (tagged kind:'map' — see
// dgInsertIntoWorkspace/pdfedBakeImage) is content, not decoration, so it
// gets a different treatment than a logo or a random dropped-in photo:
// every map on the document is pulled out of wherever it landed and
// re-laid out as a uniform grid of passport-photo-sized thumbnails, up to
// PDFED_MAP_GRID_PER_PAGE (6) to a page. More than that spills onto
// additional dedicated map pages, appended at the end of the document —
// the same "make another page rather than crush everything onto one"
// principle Refine Report already uses for overflowing tables/text.
const PDFED_MAP_GRID_COLS = 3;
const PDFED_MAP_GRID_ROWS = 2;
const PDFED_MAP_GRID_PER_PAGE = PDFED_MAP_GRID_COLS * PDFED_MAP_GRID_ROWS; // 6
const PDFED_MAP_PASSPORT_MM = [35, 45]; // standard portrait ID/passport-photo size

// Loads a data: URL just far enough to read its true pixel dimensions —
// used so each map is aspect-fit against its own real bitmap, not against
// whatever w/h it happened to be dragged to when it was first placed
// (which may have been stretched off its native ratio).
function pdfedProbeImageSize(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

// Pulls every map-tagged image off of every page (fully relocating it, not
// duplicating it), then rebuilds it as one or more dedicated grid pages.
// Returns a summary used by the Refine Report toast.
async function pdfedApplyMapGridLayout(pages, scopeToInsertedOnly) {
  const maps = [];
  pages.forEach(pg => {
    // Refine is scoped to only the page(s) added after a Make Forms push —
    // a pushed form page's images (if any) are left exactly as pushed.
    if (scopeToInsertedOnly && pg.fromMakeForm) return;
    if (!pg.placedImages || !pg.placedImages.length) return;
    const keep = [];
    pg.placedImages.forEach(img => {
      if (img.kind === 'map' && !img._sectionIcon && !img._sectionDivider && !img._sectionBar && !img._headerDivider) {
        maps.push(img);
      } else {
        keep.push(img);
      }
    });
    pg.placedImages = keep;
  });
  if (!maps.length) return { mapsLaidOut: 0, mapPagesAdded: 0 };

  // Match the size/density/background of the last real page in the report
  // so the map pages read as part of the same document, not a bare insert.
  const templatePg = pages[pages.length - 1];

  const naturalSizes = await Promise.all(maps.map(m => pdfedProbeImageSize(m.dataUrl)));

  const chunks = [];
  for (let i = 0; i < maps.length; i += PDFED_MAP_GRID_PER_PAGE) {
    chunks.push(maps.slice(i, i + PDFED_MAP_GRID_PER_PAGE).map((m, j) => ({ img: m, natural: naturalSizes[i + j] })));
  }

  let mapPagesAdded = 0;
  for (const chunk of chunks) {
    const mapPg = await pdfedMakeRefineOverflowPage(templatePg);
    mapPg.label = 'Maps';
    // pdfedMakeRefineOverflowPage already carries the header logo (if any)
    // forward onto this page, same as any other overflow page.

    const pxPerMm = mapPg._pxPerMm || pdfedPageDensity(mapPg);
    const pageW = mapPg.width, pageH = mapPg.height;
    const boxW = Math.max(20, Math.round(PDFED_MAP_PASSPORT_MM[0] * pxPerMm));
    const boxH = Math.max(20, Math.round(PDFED_MAP_PASSPORT_MM[1] * pxPerMm));
    const gap = Math.round(10 * pxPerMm);
    const cols = PDFED_MAP_GRID_COLS, rows = PDFED_MAP_GRID_ROWS;
    const gridW = cols * boxW + (cols - 1) * gap;
    const gridH = rows * boxH + (rows - 1) * gap;
    const startX = Math.max(0, Math.round((pageW - gridW) / 2));
    const startY = Math.max(0, Math.round((pageH - gridH) / 2));

    mapPg.placedImages = mapPg.placedImages || [];
    chunk.forEach((entry, idx) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const cellX = startX + col * (boxW + gap);
      const cellY = startY + row * (boxH + gap);
      // Aspect-fit (contain) the map's own bitmap inside the passport-size
      // box — resized, never stretched or cropped — then center it in the box.
      const ratio = entry.natural.w / entry.natural.h || 1;
      const boxRatio = boxW / boxH;
      let fitW = boxW, fitH = boxH;
      if (ratio > boxRatio) { fitW = boxW; fitH = Math.round(boxW / ratio); }
      else { fitH = boxH; fitW = Math.round(boxH * ratio); }
      const x = cellX + Math.round((boxW - fitW) / 2);
      const y = cellY + Math.round((boxH - fitH) / 2);
      mapPg.placedImages.push(Object.assign({}, entry.img, {
        id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
        x, y, w: fitW, h: fitH,
        zIndex: pdfedNextZ(mapPg),
        _refineBaseline: null, // fresh element on a fresh page, nothing to restore from
      }));
    });

    pages.push(mapPg);
    mapPagesAdded++;
  }

  return { mapsLaidOut: maps.length, mapPagesAdded };
}

// ── Page Consolidation (Refine Report) ────────────────────────────────────
// The overflow pass above only ever flows FORWARD: a page too full spills
// its tail onto a fresh page after it. Nothing in that pass ever looks the
// other way — a page with a lot of empty space left under its content, with
// the very next page holding only a small table or a short block, is left
// exactly as-is, because "does page N+1 actually need its own sheet at
// all?" was never asked. This pass asks it: after the overflow pass has
// settled, walk adjacent page pairs and, wherever the next page's whole
// content would cleanly fold into the current page's leftover room, fold it
// in and drop the now-empty page — so a KPI table on its own near-blank
// page slides up onto the report page above it instead of forcing a manual
// cleanup pass every time.
//
// This isn't limited to reports typed/built inside the Workspace. A
// document can arrive here as editable placed items (a typed or AI-built
// report, an annotated PDF, a form page) OR as a flat raster with nothing
// placed on it at all (an imported/scanned PDF page, a photographed
// document, an exported page opened read-only) — those two cases need two
// different ways of measuring "how much real content is here" and "does it
// fit", so this pass branches on which kind of page it's looking at rather
// than assuming one format.
function pdfedClonePlacedArray(arr) {
  return (arr || []).map(item => JSON.parse(JSON.stringify(item)));
}

// Loads a page's own background raster and finds how far down its real
// (non-blank) content actually goes, scanning in the image's native pixel
// space. This is what lets a flat, un-annotated page (nothing in
// placedTables/Texts/Images to measure) still report an honest "here's
// where the whitespace starts" instead of being read as either fully empty
// or fully full.
function pdfedMeasureRasterContentBounds(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let data;
      try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { resolve(null); return; }
      // Only the bottom edge of the content matters here, so scan rows
      // from the bottom up and stop at the first non-blank one — cheap for
      // the common case of a mostly-full page, and never worse than
      // scanning every row once for a fully blank one.
      const isRowBlank = (y) => {
        const rowStart = y * w * 4;
        for (let x = 0; x < w; x++) {
          const i = rowStart + x * 4;
          const a = data[i + 3];
          if (a < 10) continue; // fully transparent — not content
          if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
        }
        return true;
      };
      let contentBottom = 0;
      for (let y = h - 1; y >= 0; y--) {
        if (!isRowBlank(y)) { contentBottom = y + 1; break; }
      }
      resolve({ w, h, contentBottom });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Crops a raster page down to just its real content (top of the page
// through its measured content bottom, plus a small pad) — the piece that
// actually needs to move, not the blank remainder below it.
function pdfedCropRasterTop(dataUrl, bounds) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = bounds.w;
      const h = Math.min(bounds.h, bounds.contentBottom + 12);
      if (w <= 0 || h <= 0) { resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// A raster-only page (no placed items to fold — see the branch in
// pdfedConsolidateUnderfilledPages below) can still be merged: measure how
// much genuine blank space pg has left at its own bottom (from its placed
// flow if it has any, otherwise from its own raster), measure how tall
// next's real content actually is, and — if it fits — paste a crop of that
// content into pg as a plain image and report success so the caller can
// drop next entirely. Returns false without touching either page if it
// doesn't fit or either raster can't be read.
async function pdfedTryMergeRasterPage(pg, next) {
  const margin = 36;
  const gap = 24;
  const pageH = pg.height || 800;
  const pageW = pg.width || 600;

  const pgRealImages = (pg.placedImages || []).filter(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark);
  const pgHasFlow = (pg.placedTables && pg.placedTables.length)
    || (pg.placedTexts && pg.placedTexts.length)
    || pgRealImages.length;

  let pgContentBottom;
  if (pgHasFlow) {
    const bottoms = [margin];
    (pg.placedTables || []).forEach(t => bottoms.push((t.y || 0) + pdfedFlowSize(t, 'table', pageW, margin).h));
    (pg.placedTexts || []).forEach(t => bottoms.push((t.y || 0) + pdfedFlowSize(t, 'text', pageW, margin).h));
    pgRealImages.forEach(im => bottoms.push((im.y || 0) + (im.h || 0)));
    pgContentBottom = Math.max(...bottoms);
  } else {
    const pgBounds = await pdfedMeasureRasterContentBounds(pg.dataUrl);
    pgContentBottom = pgBounds ? pgBounds.contentBottom : margin;
  }

  const nextBounds = await pdfedMeasureRasterContentBounds(next.dataUrl);
  // A genuinely blank/divider page (nothing found, or content only in the
  // first handful of pixel rows) is left alone rather than treated as
  // mergeable — deleting a page the person deliberately left blank as a
  // section break isn't "filling whitespace", it's losing their structure.
  if (!nextBounds || nextBounds.contentBottom < 20) return false;

  const availableH = pageH - margin - pgContentBottom;
  if (nextBounds.contentBottom + gap > availableH) return false;

  const cropDataUrl = await pdfedCropRasterTop(next.dataUrl, nextBounds);
  if (!cropDataUrl) return false;

  pg.placedImages = pg.placedImages || [];
  pg.placedImages.push({
    id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
    dataUrl: cropDataUrl,
    x: margin,
    y: Math.round(pgContentBottom + gap),
    w: pageW - margin * 2,
    h: Math.round(nextBounds.contentBottom * ((pageW - margin * 2) / (nextBounds.w || 1))),
    zIndex: pdfedNextZ(pg),
  });
  return true;
}

async function pdfedConsolidateUnderfilledPages(pages, opts, theme) {
  // Consolidation is meaningless without the same flow/stacking pass that
  // measures whether things fit — only ever runs alongside that pass, never
  // on its own.
  if (!opts.align) return 0;
  const scopeToInsertedOnly = !!opts.scopeToInsertedOnly;
  const inScope = pg => !(scopeToInsertedOnly && pg.fromMakeForm);
  let consolidated = 0;
  let i = 0;
  while (i < pages.length - 1) {
    const pg = pages[i];
    const next = pages[i + 1];
    if (!inScope(pg) || !inScope(next)) { i++; continue; }

    // Only fold pages that are physically the same sheet — a size mismatch
    // (e.g. a landscape map-grid page sitting between portrait report
    // pages) means these were never meant to read as one continuous flow.
    if ((pg.width || 0) !== (next.width || 0) || (pg.height || 0) !== (next.height || 0)) { i++; continue; }

    const nextAllImages = (next.placedImages || []).filter(im =>
      !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark);
    // A repeating page header/logo isn't a reason to block the fold — most
    // multi-page reports carry the exact same masthead on every page, and
    // pg already has its own copy of it. Only the logo itself is dropped
    // from what gets carried over (folding it in too would duplicate the
    // header); everything else next actually contains — tables, text,
    // real content images — still moves.
    const nextRealImages = nextAllImages.filter(im => !pdfedIsAnchorImage(im, next.width || 600, next.height || 800));

    const nextHasFlowContent = (next.placedTables && next.placedTables.length)
      || (next.placedTexts && next.placedTexts.length)
      || nextRealImages.length;

    if (nextHasFlowContent) {
      // Editable content — try the fold entirely on clones first. pg's and
      // next's real arrays stay untouched unless the merged content
      // actually re-flows onto one page with nothing left over.
      // pdfedAutoAlignContent mutates whatever it's given (repositioning,
      // and if needed shrinking fonts/rows to fit), so a failed attempt
      // must never be allowed to leave marks on either page's real content.
      const trialPg = Object.assign({}, pg, {
        placedTables: pdfedClonePlacedArray(pg.placedTables).concat(pdfedClonePlacedArray(next.placedTables)),
        placedTexts: pdfedClonePlacedArray(pg.placedTexts).concat(pdfedClonePlacedArray(next.placedTexts)),
        placedImages: pdfedClonePlacedArray(pg.placedImages).concat(pdfedClonePlacedArray(nextRealImages)),
      });
      const overflow = pdfedAutoAlignContent(trialPg, opts.align, opts.logoPosition, theme.accent) || [];

      if (overflow.length) {
        // Doesn't fit together on one sheet — leave both pages exactly as
        // they were (the clones are simply discarded) and try the next pair.
        i++;
        continue;
      }

      // Fits cleanly — commit the merged, re-flowed layout to pg and drop
      // the now-empty next page. Re-check the SAME index in case the page
      // that's now next also fits in pg's remaining room.
      pg.placedTables = trialPg.placedTables;
      pg.placedTexts = trialPg.placedTexts;
      pg.placedImages = trialPg.placedImages;
      pages.splice(i + 1, 1);
      consolidated++;
      continue;
    }

    // No placed items at all on the next page — a flat, rasterized page
    // (imported/scanned PDF, photographed document, exported page opened
    // read-only) rather than editable content. Nothing to reflow, but it
    // can still be measured off its actual pixels and folded the same way.
    const merged = await pdfedTryMergeRasterPage(pg, next);
    if (!merged) { i++; continue; }
    pages.splice(i + 1, 1);
    consolidated++;
  }
  return consolidated;
}

// ── SARVARC Crawler: page whitespace inspection ────────────────────────
// pdfedAutoAlignContent (below) re-flows every text/table/image fresh
// against whichever page object it's handed — it reads pg.width/pg.height
// live each call (falling back to a sane 600×800 default the same way
// the rest of this file does when a page's own dimensions weren't
// recorded), re-wraps text to that page's own content width, and bounds
// its overflow check against that page's own height. A HEIGHT mismatch
// between two pages was never actually unsafe, and — now that
// pdfedScaleFlowItemsForWidth clamps against the destination's own
// content width — neither is a WIDTH mismatch, however large, or even a
// page missing its width entirely: it just falls back to 600 like every
// other size read in this file already does, rather than refusing to
// move anything. There's nothing left here that needs to block the move
// up front; the fit-test below is what actually decides what fits.

// Scales the width-sensitive fields of a set of tables/texts/images by a
// shared ratio in place. Mirrors exactly what pdfedAutoAlignContent's own
// vertical shrink-to-fit pass already does (column widths + font size
// together for tables, width + font size for text, width/height for
// images) — same mechanism, just triggered by a width difference between
// two pages instead of a height overflow on one page.
//
// maxContentW (optional) is the DESTINATION page's actual content width
// (pageW - margin*2) — after the shared-ratio scale, any item still wider
// than that gets a second, individual clamp down to fit, same floor-
// protected way. This is what makes it safe to allow ANY width gap
// between two pages, no matter how large: the shared ratio gets things in
// the right ballpark, and this clamp is the hard guarantee that nothing
// scaled here can ever run past the destination page's own margin, even
// if the ratio alone wouldn't have been enough.
function pdfedScaleFlowItemsForWidth(tables, texts, images, scale, maxContentW) {
  const noRatioChange = !scale || Math.abs(scale - 1) < 0.01;
  const clampTableRow = (colWidths) => {
    let widths = colWidths.map(w => Math.max(24, noRatioChange ? w : w * scale));
    const totalW = widths.reduce((a, b) => a + b, 0);
    if (maxContentW && totalW > maxContentW) {
      const clamp = maxContentW / totalW;
      widths = widths.map(w => Math.max(24, w * clamp));
    }
    return widths.map(w => Math.round(w));
  };
  (tables || []).forEach(it => {
    let colScale = 1;
    if (Array.isArray(it.colWidths)) {
      const before = it.colWidths.reduce((a, b) => a + b, 0) || 1;
      it.colWidths = clampTableRow(it.colWidths);
      const after = it.colWidths.reduce((a, b) => a + b, 0);
      colScale = after / before; // the REAL scale actually applied, ratio scale + any extra clamp
    }
    if (Array.isArray(it.rowHeights) && colScale !== 1) it.rowHeights = it.rowHeights.map(h => Math.max(12, Math.round(h * colScale)));
    if (it.fontSize && colScale !== 1) it.fontSize = Math.max(7, it.fontSize * colScale);
  });
  (texts || []).forEach(it => {
    if (!it.w) { if (!noRatioChange && it.fontSize) it.fontSize = Math.max(9, it.fontSize * scale); return; }
    let w = Math.max(20, noRatioChange ? it.w : it.w * scale);
    let itemScale = w / it.w;
    if (maxContentW && w > maxContentW) { itemScale = itemScale * (maxContentW / w); w = maxContentW; }
    it.w = Math.round(w);
    if (it.fontSize) it.fontSize = Math.max(9, it.fontSize * itemScale);
  });
  (images || []).forEach(it => {
    if (!it.w) return;
    let w = Math.max(20, noRatioChange ? it.w : it.w * scale);
    const itemScale = w / it.w;
    if (maxContentW && w > maxContentW) { w = maxContentW; }
    it.w = Math.round(w);
    if (it.h) it.h = Math.max(20, Math.round(it.h * itemScale));
  });
}

// Beyond the pure width-ratio scale above, this makes an incoming block of
// pulled/pushed content actually READ like it belongs on the destination
// page: its heading size and body paragraph size are set to match whatever
// size is ALREADY established there, rather than just carrying over its
// source page's own sizing (scaled by a width ratio that's usually ~1
// anyway, since both pages are normally the same page size). Without this,
// a manual pull/push can land a 16px heading next to an 18px one already on
// the page, or 10px body text next to 11px body text — small enough to slip
// past a glance, but exactly the kind of inconsistency that reads as
// unpolished in a finished report. Runs a mode (most common size) over the
// destination's OWN existing content, not an average, so one odd outlier
// text box already on the page can't skew the match target; if the
// destination page has no heading (or no body text) of its own yet, that
// category is left at whatever the width-scale pass already gave it, since
// there's nothing on the page to match to.
function pdfedMatchIncomingFontsToDestination(destPg, incomingTables, incomingTexts) {
  const mode = (nums) => {
    if (!nums.length) return null;
    const counts = new Map();
    nums.forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
    let best = nums[0], bestCount = 0;
    counts.forEach((c, n) => { if (c > bestCount) { bestCount = c; best = n; } });
    return best;
  };

  const destTexts = destPg.placedTexts || [];
  const targetHeadingSize = mode(destTexts.filter(pdfedTextLooksLikeHeading).map(t => t.fontSize).filter(Boolean));
  const targetBodySize = mode(destTexts.filter(t => !pdfedTextLooksLikeHeading(t)).map(t => t.fontSize).filter(Boolean));
  const targetTableSize = mode((destPg.placedTables || []).map(t => t.fontSize).filter(Boolean));

  (incomingTexts || []).forEach(t => {
    if (!t.fontSize) return;
    if (pdfedTextLooksLikeHeading(t)) {
      if (targetHeadingSize) t.fontSize = targetHeadingSize;
    } else if (targetBodySize) {
      t.fontSize = targetBodySize;
    }
  });

  if (targetTableSize) {
    (incomingTables || []).forEach(it => {
      if (!it.fontSize || Math.abs(it.fontSize - targetTableSize) < 0.01) return;
      const ratio = targetTableSize / it.fontSize;
      it.fontSize = targetTableSize;
      // Row heights were sized for the old font size — rescale them by the
      // same ratio so cells don't end up cramped (size went up) or leaving
      // odd extra air (size went down).
      if (Array.isArray(it.rowHeights)) it.rowHeights = it.rowHeights.map(h => Math.max(12, Math.round(h * ratio)));
    });
  }
}

// Reads a page's own flow (tables/texts/real images — the same set
// pdfedAutoAlignContent lays out) top-to-bottom and reports how much
// genuinely empty vertical space sits above the first item and below the
// last one. This is the whitespace a push/pull is actually trying to use;
// surfaced here so callers can give a specific reason before even
// attempting a move, rather than a generic size complaint. Decorative
// anchors/dividers are excluded since they aren't part of the flow.
function pdfedCrawlPageWhitespace(pg) {
  const margin = 36;
  const pageW = (pg && pg.width) || 600;
  const pageH = (pg && pg.height) || 800;
  const items = []
    .concat(pg.placedTables || [])
    .concat((pg.placedTexts || []).filter(pdfedIsFlowText))
    .concat((pg.placedImages || []).filter(im =>
      !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark
      && !pdfedIsAnchorImage(im, pageW, pageH)));
  if (!items.length) return { top: Math.max(0, pageH - margin * 2), bottom: Math.max(0, pageH - margin * 2), empty: true };
  let top = Infinity, bottom = -Infinity;
  items.forEach(it => {
    const y0 = it.y || 0;
    const y1 = y0 + (it.h || 0);
    if (y0 < top) top = y0;
    if (y1 > bottom) bottom = y1;
  });
  return {
    top: Math.max(0, top - margin),
    bottom: Math.max(0, (pageH - margin) - bottom),
    empty: false,
  };
}

// ── Manual per-page whitespace fill ────────────────────────────────────
// The automatic passes above only ever commit when a WHOLE page's content
// fits cleanly elsewhere — deliberately conservative, so Refine Report
// never silently shrinks something past a comfortable size on its own.
// That's still occasionally short of what someone can see with their own
// eyes is possible ("this table would fit if it just moved up a bit").
// These two actions are the manual override, available per page from the
// pages panel regardless of whether Refine Report has ever been run on
// this document: pull the next page's content up (accepting a PARTIAL
// merge — whatever fits moves, the rest stays behind on next), or push
// this page's own bottom-most item down onto the next one.
function pdfedManualRefineDefaults() {
  const theme = pdfedResolveRefineTheme({
    theme: pdfedRefineState.theme,
    useLogoColors: pdfedRefineState.useLogoColors,
    logoAccent: pdfedRefineState.logoAccent,
  });
  return { align: pdfedRefineState.align || 'left', logoPosition: pdfedRefineState.logoPosition || null, theme };
}

// Splits pdfedAutoAlignContent's raw {item, kind[, images]} overflow
// entries back out into placedTables/placedTexts/placedImages arrays, in
// their original order, so they can be reassigned straight onto a page.
function pdfedFlowEntriesToPlacedArrays(entries) {
  const placedTables = [], placedTexts = [], placedImages = [];
  entries.forEach(f => {
    if (f.kind === 'table') placedTables.push(f.item);
    else if (f.kind === 'text') placedTexts.push(f.item);
    else if (f.kind === 'image') placedImages.push(f.item);
    else if (f.kind === 'imageRow') placedImages.push(...f.images);
  });
  return { placedTables, placedTexts, placedImages };
}

async function pdfedRecordManualFillHistory(label, before, idx) {
  if (!before) return;
  const after = JSON.parse(JSON.stringify(pdfed.pages));
  pushAppHistory({
    label,
    undo: async () => {
      pdfed.pages = JSON.parse(JSON.stringify(before));
      await pdfedGoto(Math.min(idx, pdfed.pages.length - 1));
      pdfed.pages.forEach((_, i) => pdfedMarkModified(i));
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      toast(label + ' undone', 'info');
    },
    redo: async () => {
      pdfed.pages = JSON.parse(JSON.stringify(after));
      await pdfedGoto(Math.min(idx, pdfed.pages.length - 1));
      pdfed.pages.forEach((_, i) => pdfedMarkModified(i));
      if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
      toast(label, 'success');
    }
  });
}

// Pushes THIS page's own content UP onto the page above — lives on the page
// the person is actually looking at, instead of requiring them to navigate
// up to the previous page first and use ITS pull-up button to reach the
// same result. "Page N pushes its own content up onto N-1" and "page N-1
// pulls page N's content up onto itself" are exactly the same merge, so
// this just delegates straight to pdfedManualPullNextPageUp on the
// PREVIOUS page's index — same fit-testing, partial-merge, and font-match
// guarantees, just triggered from the other side.
async function pdfedManualPushContentUp(idx) {
  if (idx <= 0) { toast('No page above this one to push into', 'info'); return; }
  await pdfedManualPullNextPageUp(idx - 1);
}

async function pdfedManualPullNextPageUp(idx) {
  const pages = pdfed.pages || [];
  const pg = pages[idx];
  const next = pages[idx + 1];
  if (!pg || !next) { toast('No page below this one to pull up', 'info'); return; }

  const { align, logoPosition, theme } = pdfedManualRefineDefaults();
  const nextAllImages = (next.placedImages || []).filter(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark);
  const nextAnchors = nextAllImages.filter(im => pdfedIsAnchorImage(im, next.width || 600, next.height || 800));
  const nextRealImages = nextAllImages.filter(im => !pdfedIsAnchorImage(im, next.width || 600, next.height || 800));
  // Report header/footer text on "next" is fixed to that page and is never
  // a candidate to pull up — split it out here so it's excluded from every
  // flow/tag/clone step below, then stitched back onto next untouched if
  // next survives as a (partially merged) page.
  const nextOwnHeaderFooterTexts = (next.placedTexts || []).filter(t => !pdfedIsFlowText(t));
  const nextFlowTexts = (next.placedTexts || []).filter(pdfedIsFlowText);
  const hasFlow = (next.placedTables && next.placedTables.length)
    || nextFlowTexts.length
    || nextRealImages.length;

  let before;
  try { before = JSON.parse(JSON.stringify(pdfed.pages)); } catch (e) { before = null; }

  let fullyMerged = false;
  if (!hasFlow) {
    // Raster-only next page (scanned/imported, nothing placed on it) —
    // same crop-and-paste path the automatic pass uses, just triggered
    // directly instead of waiting on the whole-page-fits check.
    const merged = await pdfedTryMergeRasterPage(pg, next);
    if (!merged) {
      const ws = pdfedCrawlPageWhitespace(pg);
      const room = Math.round(ws.bottom);
      toast(room > 4
        ? `Only ~${room}px of empty space left on this page — not enough room for what's below it`
        : "Not enough room on this page for what's below it", 'info');
      return;
    }
    pages.splice(idx + 1, 1);
    fullyMerged = true;
  } else {
    // Tag next's own real items before cloning so a scaled clone can be
    // matched back to its unscaled original below — needed because
    // whatever DOESN'T end up fitting on pg has to stay on next at next's
    // own native size, not carry pg's scale back with it.
    let tagSeq = 0;
    const tagAll = arr => (arr || []).forEach(it => { it._pullTag = 'ul' + (tagSeq++); });
    tagAll(next.placedTables);
    tagAll(nextFlowTexts);
    tagAll(nextRealImages);

    // Cross-width bridge: next's tables/text carry column widths and font
    // sizes sized for next's own width. Scaled here, before the trial, so
    // the fit-test below measures the size the content will actually be
    // once it's living on pg. maxContentW is pg's own content width — the
    // hard clamp that lets this run even when the width gap is large.
    const scale = (pg.width || 600) / (next.width || 600);
    const maxContentW = Math.max(60, (pg.width || 600) - 36 * 2);
    const nextTablesClone = pdfedClonePlacedArray(next.placedTables);
    const nextTextsClone = pdfedClonePlacedArray(nextFlowTexts);
    const nextImagesClone = pdfedClonePlacedArray(nextRealImages);
    pdfedScaleFlowItemsForWidth(nextTablesClone, nextTextsClone, nextImagesClone, scale, maxContentW);
    // Match the incoming headings/body text/table font sizes to whatever's
    // already established on pg (this page, the destination) — see
    // pdfedMatchIncomingFontsToDestination for why this is more than the
    // width-ratio scale above already covers.
    pdfedMatchIncomingFontsToDestination(pg, nextTablesClone, nextTextsClone);
    // Force next's content to sort AFTER all of this page's own content —
    // pdfedAutoAlignContent below orders purely by each item's own y, and
    // next's items still carry their own page's y (usually starting back
    // near the top margin), which would otherwise interleave them above
    // this page's later content instead of following it. The offset is a
    // uniform shift, so next's own internal top-to-bottom order among
    // itself is preserved — only its position relative to pg's content
    // changes, keeping the correct hierarchy across the page boundary.
    const NEXT_Y_OFFSET = 1000000;
    [...nextTablesClone, ...nextTextsClone, ...nextImagesClone].forEach(it => { it.y = (it.y || 0) + NEXT_Y_OFFSET; });
    const trialPg = Object.assign({}, pg, {
      placedTables: pdfedClonePlacedArray(pg.placedTables).concat(nextTablesClone),
      placedTexts: pdfedClonePlacedArray(pg.placedTexts).concat(nextTextsClone),
      placedImages: pdfedClonePlacedArray(pg.placedImages).concat(nextImagesClone),
    });
    const overflow = pdfedAutoAlignContent(trialPg, align, logoPosition, theme.accent) || [];
    pg.placedTables = trialPg.placedTables;
    pg.placedTexts = trialPg.placedTexts;
    pg.placedImages = trialPg.placedImages;

    // Which of next's ORIGINAL headings actually made it onto pg (matched
    // by their _pullTag, the same tag their pg-bound clone still carries).
    const overflowTags = new Set();
    overflow.forEach(f => (f.images ? f.images : [f.item]).forEach(it => { if (it && it._pullTag) overflowTags.add(it._pullTag); }));

    // A heading carries its own section badge+divider (if Refine Report
    // previously added one) along with it when it moves onto pg — badges
    // are excluded from nextRealImages above (they're decorations, not
    // flow content), so without this they'd stay behind on next while
    // their heading moves to pg, leaving an orphaned badge on one page and
    // a bare heading on the other. Matched purely by heading id (never
    // re-detected); exact position/size for pg's own width/font gets
    // recomputed by the resync call below.
    {
      const movedHeadingIds = new Set(
        (next.placedTexts || [])
          .filter(t => t && t._pullTag && !overflowTags.has(t._pullTag))
          .map(t => t.id)
          .filter(Boolean)
      );
      if (movedHeadingIds.size) {
        next.placedImages = (next.placedImages || []).filter(im => {
          if (!im || (!im._sectionIcon && !im._sectionDivider) || typeof im.id !== 'string') return true;
          const belongs = Array.from(movedHeadingIds).some(hid =>
            im.id.indexOf('sectionicon_' + hid + '_') === 0 || im.id.indexOf('sectiondivider_' + hid + '_') === 0);
          if (belongs) { pg.placedImages.push(im); return false; }
          return true;
        });
      }
    }

    // Leave the pulled-in block exactly where pdfedAutoAlignContent above
    // already placed it: stacked directly beneath pg's own existing
    // content with the normal SECTION_GAP, filling the page's empty space
    // instead of being shoved down to sit flush against the bottom margin
    // with a big dead gap in between. This used to re-anchor the pulled
    // group to the bottom edge on purpose; that read as an obviously
    // artificial gap in a finished report rather than a natural, filled
    // page, so it's gone — the only thing this block still needs to do is
    // strip the temporary _pullTag markers now that these items are
    // permanent pg content.
    {
      [...pg.placedTables, ...pg.placedTexts, ...pg.placedImages].forEach(it => { if (it) delete it._pullTag; });
    }
    // pg just got fully relaid out (its own pre-existing content included,
    // not just what was pulled in) — any heading on it that already carried
    // a section badge from an earlier Refine Report run needs that badge
    // moved to match, or it stays pinned to the heading's old position.
    pdfedResyncSectionIconsForPage(pg);

    if (!overflow.length) {
      pages.splice(idx + 1, 1);
      fullyMerged = true;
      // next is being dropped entirely — its now-orphaned tags never
      // get read again, no cleanup needed.
    } else {
      // Partial fit — whatever's left stays behind on next. Matched back
      // to next's own UNSCALED originals by tag (never the scaled clones
      // that went into the trial), so content that stays on next keeps
      // reading at next's own native size, carrying its own header
      // logo/divider back with it so a partial pull doesn't strand its
      // branding, then re-flows from next's own top. (overflowTags was
      // already computed above, right after the trial layout ran.)
      const keepOriginal = arr => (arr || []).filter(it => it._pullTag && overflowTags.has(it._pullTag));
      const stayingTables = keepOriginal(next.placedTables);
      const stayingTexts = keepOriginal(next.placedTexts);
      const stayingImages = keepOriginal(nextRealImages);
      [...stayingTables, ...stayingTexts, ...stayingImages].forEach(it => delete it._pullTag);
      next.placedTables = stayingTables;
      // next's own fixed header/footer text (excluded from the trial
      // entirely) rides back on untouched — it was never a candidate to
      // move, so it's never at risk here regardless of what did or didn't fit.
      next.placedTexts = stayingTexts.concat(nextOwnHeaderFooterTexts);
      next.placedImages = nextAnchors.concat(stayingImages);
      pdfedAutoAlignContent(next, align, logoPosition, theme.accent);
      pdfedResyncSectionIconsForPage(next);
      pdfedMarkModified(idx + 1);
    }
  }
  pdfedMarkModified(idx);

  if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
  await pdfedGoto(idx);
  if (typeof pdfedRefreshSelectionPanel === 'function') pdfedRefreshSelectionPanel();
  await pdfedRecordManualFillHistory('Pull next page up', before, idx);
  toast(fullyMerged ? 'Page merged up' : 'Moved what fits — the rest stayed on the next page', 'success');
}

// Pushes THIS page's own content down onto the next page, landing ABOVE
// next's own content — the direct mirror of pdfedManualPullNextPageUp
// (which pulls the page below UP to sit BENEATH this page's own content).
// Together the two buttons move a whole page's worth of content one step
// in either direction while always keeping the natural above/below
// hierarchy (a page always reads before whatever came after it) and never
// guessing about whitespace: both directions test the real fit first and
// only move however much of the content genuinely has room, leaving the
// rest behind rather than losing it or leaving the source page emptied
// out for no reason.
async function pdfedManualPushLastItemDown(idx) {
  const pages = pdfed.pages || [];
  const pg = pages[idx];
  const next = pages[idx + 1];
  if (!pg || !next) { toast('No page below this one to push into', 'info'); return; }

  const { align, logoPosition, theme } = pdfedManualRefineDefaults();

  const pgRealImages = (pg.placedImages || []).filter(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark
    && !pdfedIsAnchorImage(im, pg.width || 600, pg.height || 800));
  // pg's own report header/footer text is fixed to pg and is never a
  // candidate to push down — split it out here so it's excluded from every
  // tag/dry-run/split step below, then stitched back onto pg untouched.
  const pgOwnHeaderFooterTexts = (pg.placedTexts || []).filter(t => !pdfedIsFlowText(t));
  const pgFlowTexts = (pg.placedTexts || []).filter(pdfedIsFlowText);
  const hasFlow = (pg.placedTables && pg.placedTables.length)
    || pgFlowTexts.length
    || pgRealImages.length;
  if (!hasFlow) { toast('Nothing on this page to push down', 'info'); return; }

  let before;
  try { before = JSON.parse(JSON.stringify(pdfed.pages)); } catch (e) { before = null; }

  // Tag every candidate item on this page with a temporary marker so it
  // can be tracked through a dry-run pass below (which works on deep
  // clones, so identity can't be matched by reference) — stripped again
  // right after, never saved onto the real document.
  let tagSeq = 0;
  const tagAll = arr => (arr || []).forEach(it => { it._pushTag = 'pt' + (tagSeq++); });
  tagAll(pg.placedTables);
  tagAll(pgFlowTexts);
  tagAll(pgRealImages);

  // Dry run: NEXT's own content keeps its natural sort order and goes
  // FIRST in the trial flow, which is what pdfedAutoAlignContent's
  // overflow logic protects — it only ever trims the TAIL of the sorted
  // flow when something doesn't fit. This page's candidate content is
  // forced to sort after it, so only this page's own content can ever
  // land in the returned overflow — next's own content is never at risk
  // of being bumped by an incoming push. Whatever survives is exactly
  // what has genuine room; the "never strand a heading" rule already
  // built into that overflow split keeps a heading together with
  // whatever it introduces on whichever side of the cut it lands.
  // Cross-width bridge: this page's tables/text carry column widths and
  // font sizes sized for pg's own width. Scaled here, before the dry run,
  // so the fit-test measures the size the content will actually be once
  // it's living on next — the "staying" half never gets touched, so
  // whatever doesn't move keeps reading at pg's own native size.
  // maxContentW is next's own content width — the hard clamp against
  // next's real margins, not just the ratio.
  const scale = (next.width || 600) / (pg.width || 600);
  const maxContentW = Math.max(60, (next.width || 600) - 36 * 2);
  const PUSH_Y_OFFSET = 1000000;
  const dryPgTables = pdfedClonePlacedArray(pg.placedTables).map(it => { it.y = (it.y || 0) + PUSH_Y_OFFSET; return it; });
  const dryPgTexts = pdfedClonePlacedArray(pgFlowTexts).map(it => { it.y = (it.y || 0) + PUSH_Y_OFFSET; return it; });
  const dryPgImages = pdfedClonePlacedArray(pgRealImages).map(it => { it.y = (it.y || 0) + PUSH_Y_OFFSET; return it; });
  pdfedScaleFlowItemsForWidth(dryPgTables, dryPgTexts, dryPgImages, scale, maxContentW);
  // Match sizes to next's existing content here too, so the dry-run fit
  // test measures against the SAME sizes the real move will actually use
  // below — matching only in the real pass, after the dry run already
  // measured at the (slightly different) width-scaled size, could let
  // something the dry run approved turn out too tall once font-matched.
  pdfedMatchIncomingFontsToDestination(next, dryPgTables, dryPgTexts);
  const nextRealImagesForDry = (next.placedImages || []).filter(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark);
  const dryTrial = Object.assign({}, next, {
    placedTables: pdfedClonePlacedArray(next.placedTables).concat(dryPgTables),
    placedTexts: pdfedClonePlacedArray(next.placedTexts).concat(dryPgTexts),
    placedImages: pdfedClonePlacedArray(nextRealImagesForDry).concat(dryPgImages),
  });
  const dryOverflow = pdfedAutoAlignContent(dryTrial, align, logoPosition, theme.accent) || [];
  const overflowTags = new Set();
  dryOverflow.forEach(f => {
    (f.images ? f.images : [f.item]).forEach(it => { if (it && it._pushTag) overflowTags.add(it._pushTag); });
  });

  // Untag the real items and split them into "moving" (survived the dry
  // run — has real room on next) vs "staying" (didn't fit, stays behind
  // on this page).
  const splitByTag = arr => {
    const moving = [], staying = [];
    (arr || []).forEach(it => {
      const tag = it._pushTag;
      delete it._pushTag;
      if (tag && overflowTags.has(tag)) staying.push(it); else moving.push(it);
    });
    return { moving, staying };
  };
  const tablesSplit = splitByTag(pg.placedTables);
  const textsSplit = splitByTag(pgFlowTexts);
  const imagesSplit = splitByTag(pgRealImages);

  if (!tablesSplit.moving.length && !textsSplit.moving.length && !imagesSplit.moving.length) {
    const ws = pdfedCrawlPageWhitespace(next);
    const room = Math.round(ws.top);
    toast(room > 4
      ? `Only ~${room}px of empty space at the top of the next page — not enough for anything to move down`
      : 'Not enough room on the next page for anything to move down', 'info');
    return;
  }

  // Commit: remove exactly the moving items from this page (anchors,
  // section decorations, and whatever didn't fit all stay untouched), and
  // reflow whatever's left so it doesn't sit with a gap where the moved
  // content used to be.
  const movingImageSet = new Set(imagesSplit.moving);
  pg.placedTables = tablesSplit.staying;
  // pg's own fixed header/footer text was never a candidate to push down —
  // it rides back on untouched, regardless of what did or didn't fit.
  pg.placedTexts = textsSplit.staying.concat(pgOwnHeaderFooterTexts);
  // A heading carries its own section badge+divider (if Refine Report
  // previously added one) along with it when pushed — pdfedResyncSectionIconsForPage
  // only ever repositions a badge that's still living on the SAME page as
  // its heading; it never re-creates one that got left behind. Move the
  // decoration out of pg and into the set going to next, matched purely by
  // heading id (never re-detected), so a badge stays with its own heading
  // no matter which page that heading ends up on — its exact position/size
  // for next's own width/font gets recomputed by the resync call below.
  const movingHeadingIds = new Set(textsSplit.moving.map(t => t && t.id).filter(Boolean));
  const movingDecor = [];
  pg.placedImages = (pg.placedImages || []).filter(im => {
    if (movingImageSet.has(im)) return false;
    if (movingHeadingIds.size && im && (im._sectionIcon || im._sectionDivider) && typeof im.id === 'string') {
      const belongsToMovingHeading = Array.from(movingHeadingIds).some(hid =>
        im.id.indexOf('sectionicon_' + hid + '_') === 0 || im.id.indexOf('sectiondivider_' + hid + '_') === 0);
      if (belongsToMovingHeading) { movingDecor.push(im); return false; }
    }
    return true;
  });
  const stillHasContent = pg.placedTables.length || pg.placedTexts.length || (pg.placedImages || []).some(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark
    && !pdfedIsAnchorImage(im, pg.width || 600, pg.height || 800));
  if (stillHasContent) { pdfedAutoAlignContent(pg, align, logoPosition, theme.accent); pdfedResyncSectionIconsForPage(pg); }

  // Commit the moving content onto next, forced to sort ABOVE next's own
  // existing content so the hierarchy — this page's content always reads
  // above whatever next already had — holds after the real (not just
  // dry-run) layout pass too. Scaled to next's width now, for real, the
  // same ratio the dry run already proved fits.
  pdfedScaleFlowItemsForWidth(tablesSplit.moving, textsSplit.moving, imagesSplit.moving, scale, maxContentW);
  // Real commit — match the moving content's heading/body/table font
  // sizes to what's already on next (the destination), same as the dry
  // run above.
  pdfedMatchIncomingFontsToDestination(next, tablesSplit.moving, textsSplit.moving);
  {
    const movingTables = tablesSplit.moving.map((it, i) => Object.assign(it, { y: -1000000 + i }));
    const movingTexts = textsSplit.moving.map((it, i) => Object.assign(it, { y: -1000000 + i }));
    const movingImages = imagesSplit.moving.map((it, i) => Object.assign(it, { y: -1000000 + i }));
    next.placedTables = movingTables.concat(next.placedTables || []);
    next.placedTexts = movingTexts.concat(next.placedTexts || []);
    // movingDecor's own x/y are stale (still from pg) — pdfedResyncSectionIconsForPage
    // below recomputes them against next's own width/font once the heading
    // it belongs to has its final position there.
    next.placedImages = movingImages.concat(movingDecor, next.placedImages || []);
  }
  // The dry run already proved this exact combined content (all of next's
  // own + this "moving" subset) fits inside next at the next-first sort
  // order; reordering to moving-first for the real layout shouldn't
  // reintroduce overflow, but if a junction's gap rules tip it over by a
  // hair, don't lose that tail silently — fold it right back onto this
  // page rather than dropping it.
  const realOverflow = pdfedAutoAlignContent(next, align, logoPosition, theme.accent) || [];
  pdfedResyncSectionIconsForPage(next);
  if (realOverflow.length) {
    const { placedTables, placedTexts, placedImages } = pdfedFlowEntriesToPlacedArrays(realOverflow);
    pg.placedTables = (pg.placedTables || []).concat(placedTables);
    pg.placedTexts = (pg.placedTexts || []).concat(placedTexts);
    pg.placedImages = (pg.placedImages || []).concat(placedImages);
    // Any heading folded back onto pg here might still have its badge
    // sitting on next (it was moved over above, before this correction
    // pulled the heading itself back) — bring the badge back with it so
    // it doesn't end up orphaned on the wrong page.
    const foldedBackHeadingIds = new Set(placedTexts.map(t => t && t.id).filter(Boolean));
    if (foldedBackHeadingIds.size) {
      next.placedImages = (next.placedImages || []).filter(im => {
        if (!im || (!im._sectionIcon && !im._sectionDivider) || typeof im.id !== 'string') return true;
        const belongs = Array.from(foldedBackHeadingIds).some(hid =>
          im.id.indexOf('sectionicon_' + hid + '_') === 0 || im.id.indexOf('sectiondivider_' + hid + '_') === 0);
        if (belongs) { pg.placedImages.push(im); return false; }
        return true;
      });
    }
    pdfedAutoAlignContent(pg, align, logoPosition, theme.accent);
    pdfedResyncSectionIconsForPage(pg);
  }

  const pgEmptyNow = !pg.placedTables.length && !pg.placedTexts.length && !(pg.placedImages || []).some(im =>
    !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark
    && !pdfedIsAnchorImage(im, pg.width || 600, pg.height || 800));

  let removedPg = false;
  if (pgEmptyNow) {
    pages.splice(idx, 1);
    removedPg = true;
    pdfedMarkModified(idx);
  } else {
    pdfedMarkModified(idx);
    pdfedMarkModified(idx + 1);
  }

  if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
  await pdfedGoto(Math.min(idx, pages.length - 1));
  if (typeof pdfedRefreshSelectionPanel === 'function') pdfedRefreshSelectionPanel();
  await pdfedRecordManualFillHistory('Push page content down', before, idx);
  toast(removedPg ? 'Page merged down' : 'Moved what fits — the rest stayed on this page', 'success');
}

async function pdfedApplyReportRefinement(opts) {
  const theme = pdfedResolveRefineTheme(opts);
  const pages = pdfed.pages || [];
  const scopeToInsertedOnly = !!opts.scopeToInsertedOnly;
  // Skips any page pushed straight from Make Forms when Refine is scoped —
  // shared by every pass below so a form page is never touched by any of
  // them, while a normal report (no form pages at all) refines every page
  // exactly as it always has.
  const inScope = pg => !(scopeToInsertedOnly && pg.fromMakeForm);
  let headingsSynced = 0, tablesFormatted = 0, bulletsApplied = 0, sectionIconsApplied = 0, bodyFontsSynced = 0, overflowPagesAdded = 0, pagesConsolidated = 0;

  // Maps get pulled out and re-laid out into their own grid page(s) FIRST,
  // before any other pass ever sees them — so the baseline-snapshot pass
  // just below, the auto-align pass, and the overflow-flow pass all treat
  // a map the same as "not here" rather than as a logo/photo to preserve
  // in place.
  const mapGridResult = await pdfedApplyMapGridLayout(pages, scopeToInsertedOnly);
  const mapsLaidOut = mapGridResult.mapsLaidOut;
  const mapPagesAdded = mapGridResult.mapPagesAdded;

  // Pass 0: snapshot-and-restore each table/text/image's true original
  // sizing before anything below touches it. Every pass after this one
  // computes its output purely as a function of these numbers (plus the
  // chosen theme/options) — never off whatever the PREVIOUS refine pass
  // happened to leave behind. Without this, clicking Refine Report 2-3
  // times compounds: e.g. the "shrink to fit" step (Pass 4 below) shrinks
  // a table's rowHeights to stop it overflowing the page, but the very
  // next click's autoFit (Pass 1) re-picks a font size purely off column
  // WIDTH — with no memory of that shrink — so the font creeps back up
  // while the rows it has to sit inside stay squeezed from last time,
  // and it only gets worse (misaligned rows, vanished borders, overlap)
  // the more times it's run. Capturing the baseline once, the first time
  // an item is ever refined, and re-deriving every later pass from that
  // same untouched baseline guarantees the exact same, correct result no
  // matter how many times this runs — true idempotency.
  pages.forEach(pg => {
    if (!inScope(pg)) return;
    (pg.placedTables || []).forEach(item => {
      const structureMatches = item._refineBaseline
        && item._refineBaseline.colWidths.length === (item.colWidths || []).length
        && item._refineBaseline.rowHeights.length === (item.rowHeights || []).length;
      if (!structureMatches) {
        // No usable baseline yet, or the table's row/col count no longer
        // matches one that was captured earlier (e.g. an older saved
        // document, or a structural edit that slipped through some other
        // path) — re-capture from the CURRENT state rather than force a
        // mismatched-length restore, which would corrupt the table.
        item._refineBaseline = {
          colWidths: (item.colWidths || []).slice(),
          rowHeights: (item.rowHeights || []).slice(),
          fontSize: item.fontSize,
        };
      }
      const b = item._refineBaseline;
      item.colWidths = b.colWidths.slice();
      item.rowHeights = b.rowHeights.slice();
      item.fontSize = b.fontSize;
    });
    (pg.placedTexts || []).forEach(item => {
      if (!item._refineBaseline) {
        item._refineBaseline = { fontSize: item.fontSize, w: item.w };
      }
      const b = item._refineBaseline;
      item.fontSize = b.fontSize;
      item.w = b.w;
    });
    (pg.placedImages || []).forEach(item => {
      // Section badges/dividers are fully stripped and regenerated fresh
      // every pass (see pdfedApplySectionIcons) — they never carry drift
      // of their own, so they're deliberately left out of this baseline.
      if (item._sectionIcon || item._sectionDivider || item._sectionBar || item._headerDivider || item._watermark) return;
      if (!item._refineBaseline) {
        item._refineBaseline = { w: item.w, h: item.h };
      }
      const b = item._refineBaseline;
      item.w = b.w;
      item.h = b.h;
    });
  });

  // Pass 1: table styling/autofit first — headings size themselves off each
  // table's real, final font, not a guess.
  //
  // Font size is resolved in two steps so every table in the document lands
  // on the SAME size (matching how Pass 3.6 now locks body paragraphs to one
  // shared size too) instead of each table independently auto-fitting to
  // its own content and drifting apart from its neighbors:
  //   1. Style every table (colors/fonts/header treatment — independent of
  //      size) and, if auto-fit is on, work out the best-fit size for each
  //      table on its own, without applying it yet.
  //   2. Take the SMALLEST of those per-table sizes — the most cramped
  //      table in the report — and apply that one size to every table.
  //      Using the smallest guarantees every table's content still fits on
  //      one line per cell (a size that fit the tightest table always fits
  //      a roomier one too), so consistency never comes at the cost of
  //      overflow.
  const _refineTablesInScope = [];
  pages.forEach(pg => {
    if (!inScope(pg)) return;
    (pg.placedTables || []).forEach(tbl => {
      pdfedRefineOneTable(tbl, theme);
      tablesFormatted++;
      _refineTablesInScope.push(tbl);
    });
  });
  if (opts.autoFit && _refineTablesInScope.length) {
    let sharedTableSize = Math.min(..._refineTablesInScope.map(tbl => pdfedComputeTableFitSize(tbl, theme)));
    _refineTablesInScope.forEach(tbl => { tbl.fontSize = sharedTableSize; });
  }

  // Pass 2: settle every table's (and other placed item's) final width up
  // front — before headings copy that width, and before the flow measures
  // anything against it — so nothing downstream gets sized off a width
  // that's about to change again a few passes later.
  //
  // This now always runs, not just for 'stretch'. Previously a table
  // brought in wider than the page (a full-bleed PDF import, a wide
  // pasted dataset) was only ever resized under 'stretch' — under 'left'
  // or 'center' it was left exactly as wide as it arrived, so it simply
  // hung off the right edge of the canvas after refine. For 'stretch' the
  // width is set to fill the content area exactly, same as before; for
  // 'left'/'center' it's only ever shrunk down to fit — never grown — so
  // a table that already fits is left untouched.
  {
    const pc = document.getElementById('pdfedPageCanvas');
    pages.forEach(pg => {
      if (!inScope(pg)) return;
      const pageW = pg.width || (pc && pc.width) || 600;
      const margin = 36;
      const maxW = Math.max(120, pageW - margin * 2);

      (pg.placedTables || []).forEach(item => {
        const totalW = (item.colWidths || []).reduce((a, b) => a + b, 0);
        if (totalW <= 0) return;
        const targetW = opts.align === 'stretch' ? maxW : Math.min(totalW, maxW);
        if (Math.abs(totalW - targetW) > 1) {
          const ratio = targetW / totalW;
          item.colWidths = item.colWidths.map(w => Math.max(30, Math.round(w * ratio)));
        }
      });

      // Same guarantee for text boxes and images with an explicit stored
      // width — only ever shrink one wider than the page, preserving an
      // image's aspect ratio while doing it.
      (pg.placedTexts || []).forEach(item => {
        if (typeof item.w === 'number' && item.w > maxW) item.w = maxW;
      });
      // The watermark is deliberately sized/centered as a fraction of the
      // full page, not the narrower content-margin width this pass targets
      // — and it re-centers itself fresh on every Refine Report run, so
      // shrinking just its width here (without also recentering x/y) would
      // only leave it looking off-center. Left alone.
      (pg.placedImages || []).forEach(item => {
        if (item._watermark) return;
        if (typeof item.w === 'number' && item.w > maxW) {
          const ratio = maxW / item.w;
          item.w = maxW;
          if (typeof item.h === 'number') item.h = Math.round(item.h * ratio);
        }
      });
    });
  }

  // Pass 3: settle every heading's final font size and width — off its
  // table's now-final width — before anything gets stacked. A heading has
  // to know its own real size before the flow can measure how much room it
  // actually needs; sizing it up *after* stacking is what caused the
  // overlap (the slot it landed in was measured for the old, smaller text).
  pages.forEach(pg => {
    if (!inScope(pg)) return;
    if (!opts.syncHeadings || !pg.placedTexts || !pg.placedTexts.length) return;
    const headings = pg.placedTexts.filter(pdfedTextLooksLikeHeading);
    if (!headings.length) return;
    // The biggest heading already on the page reads as its section title;
    // everything else on that page is treated as a sub-heading. Every
    // heading — title or sub-heading — is fixed at one ideal size (20px)
    // rather than computed off any table's content: scaling off a
    // document-wide average still let title-tier and sub-heading-tier
    // headings differ (and drift between reports), and a report reads most
    // professional when every heading is unmistakably the same size. Only
    // weight/underline still distinguish a title from a sub-heading.
    const PDFED_REFINE_HEADING_SIZE = 20;
    const maxOrigSize = Math.max(...headings.map(h => h.fontSize || 14));
    headings.forEach(t => {
      const assoc = pdfedFindAssociatedTable(pg, t);
      const isTitle = (t.fontSize || 14) >= maxOrigSize - 0.5;
      // Sizes are about to be flattened to one uniform value below, which
      // would erase the only signal (relative size) that Pass 6's section
      // icons rely on to tell a real title from a sub-heading. Stash the
      // determination made here, off the ORIGINAL pre-refine sizes, so that
      // pass can still target just the true title even once every heading
      // reads at the same fixed size.
      t._refineIsTitle = isTitle;
      const size = PDFED_REFINE_HEADING_SIZE;
      t.fontFamily = theme.font;
      t.bold = true;
      t.fontSize = size;
      // Smart underline: a heading that's actually introducing a section —
      // a sub-heading sitting under a bigger document title, or the only
      // heading on the page, doing double duty as that section's own label
      // — gets a clean underline to separate it from whatever sits below
      // it. The one true document masthead (the largest heading on a page
      // that has more than one heading on it) is left alone; at that size
      // it's already reading as a title and doesn't need the extra
      // decoration on top.
      t.underline = !isTitle || headings.length === 1;
      if (assoc) {
        const w = pdfedTableWidth(assoc);
        if (w > 40) t.w = w;
      }
      headingsSynced++;
    });
  });

  // Pass 3.5: smart bullets — a text box that's really just several short,
  // independent lines (a "Highlights" block typed or pasted one fact per
  // line) but was never actually styled as a list reads as a flat wall of
  // text next to a properly bulleted section elsewhere in the same report.
  // This turns exactly those boxes into a real bulleted list — headings are
  // never touched, an ordinary paragraph is never touched, and a box that's
  // already a list is left exactly as it is. Runs before the flow/stacking
  // pass below so the box's new (taller) list height is what actually gets
  // measured, not its old single-paragraph height.
  if (opts.syncHeadings) {
    pages.forEach(pg => {
      if (!inScope(pg)) return;
      (pg.placedTexts || []).forEach(t => {
        if (pdfedTextLooksLikeHeading(t) || !pdfedTextLooksLikeList(t)) return;
        const lines = String(t.text || '').split('\n').map(l => l.trim()).filter(Boolean);
        t.html = '<ul style="margin:0;padding-left:20px">' + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
        t.bullet = true;
        bulletsApplied++;
      });
    });
  }

  // Pass 3.6: body paragraph font — every text box on the page that ISN'T a
  // heading (and isn't a heading-that-just-became-a-heading in Pass 3 above)
  // gets switched to the theme's bodyFont, the professional reading face for
  // that document style (e.g. Times New Roman for Financial, Calibri for
  // Corporate) rather than whatever font it happened to be typed in. This is
  // what a plain "Management Remarks"-style paragraph picks up — headings and
  // tables already get their own font from theme.font elsewhere, so this only
  // ever touches ordinary prose/list boxes, never a title.
  // Runs before Pass 4's flow/stacking so a font swap that changes line count
  // (a different face measures slightly wider/narrower per word) is already
  // reflected in the box's height before anything gets restacked around it.
  //
  // Body paragraphs also get their SIZE normalized here (headings are left
  // completely alone — Pass 3 above already owns heading size). Previously
  // only fontFamily was touched, so a document with paragraphs typed at
  // different original sizes (10px here, 14px pasted in there) kept looking
  // inconsistent even after a refine pass. The fix: read whichever body
  // paragraph comes first in document order, clamp its size into the normal
  // reading range (10–12px), and apply that single size to every other body
  // paragraph in scope — so the whole document's prose reads as one
  // consistent size instead of whatever each box happened to start at.
  if (opts.syncHeadings) {
    const PDFED_BODY_SIZE_MIN = 10, PDFED_BODY_SIZE_MAX = 12;
    let targetBodySize = null;
    pages.forEach(pg => {
      if (!inScope(pg) || targetBodySize != null) return;
      (pg.placedTexts || []).forEach(t => {
        if (targetBodySize != null || pdfedTextLooksLikeHeading(t)) return;
        const firstSize = t.fontSize || 11;
        targetBodySize = Math.min(PDFED_BODY_SIZE_MAX, Math.max(PDFED_BODY_SIZE_MIN, firstSize));
      });
    });
    if (targetBodySize == null) targetBodySize = 11; // no body paragraph found anywhere in scope
    pages.forEach(pg => {
      if (!inScope(pg)) return;
      (pg.placedTexts || []).forEach(t => {
        if (pdfedTextLooksLikeHeading(t)) return;
        t.fontFamily = theme.bodyFont || theme.font;
        t.fontSize = targetBodySize;
        bodyFontsSynced++;
      });
    });
  }

  // Pass 4: now that every table and heading knows its final size, restack
  // the whole page — tables, headings/text, and content images — as one
  // shared flow with no overlaps, and pin any logo to its header slot.
  // A page loaded with more charts/tables than can read cleanly on one
  // sheet even at the smallest acceptable size hands back its overflow;
  // that overflow gets its own fresh page, inserted right after the one it
  // came from, matching size/branding — and is itself re-checked in the
  // next loop turn in case even IT needs to spill further. `pages` is the
  // same array as `pdfed.pages`, so splicing here is what actually grows
  // the document.
  if (opts.align) {
    let pageIdx = 0;
    while (pageIdx < pages.length) {
      const pg = pages[pageIdx];
      if (!inScope(pg)) { pageIdx++; continue; }
      const overflow = pdfedAutoAlignContent(pg, opts.align, opts.logoPosition, theme.accent) || [];
      if (overflow.length) {
        const newPg = await pdfedMakeRefineOverflowPage(pg);
        overflow.forEach(f => {
          if (f.kind === 'table') newPg.placedTables.push(f.item);
          else if (f.kind === 'text') newPg.placedTexts.push(f.item);
          else if (f.kind === 'image') newPg.placedImages.push(f.item);
          else if (f.kind === 'imageRow') newPg.placedImages.push(...f.images);
        });
        pages.splice(pageIdx + 1, 0, newPg);
        overflowPagesAdded++;
      }
      pageIdx++;
    }
  }

  // Pass 4.5: consolidate under-filled pages — the reverse of Pass 4 above.
  // Where a page still has clear room left after its own content, and the
  // very next page's whole content would cleanly re-flow into that room,
  // fold it in and drop the now-empty page. See
  // pdfedConsolidateUnderfilledPages for the full reasoning; this is what
  // stops a short table from sitting alone on a mostly-blank page just
  // because it happened to land there.
  if (opts.align) {
    pagesConsolidated = await pdfedConsolidateUnderfilledPages(pages, opts, theme);
  }

  // Pass 5: re-anchor each heading's x under its associated table's now-
  // final x — stacking may have moved the table; width was already
  // settled in Pass 3, this just keeps the heading lined up over it.
  pages.forEach(pg => {
    if (!inScope(pg)) return;
    if (!opts.syncHeadings || !pg.placedTexts || !pg.placedTexts.length) return;
    pg.placedTexts.filter(pdfedTextLooksLikeHeading).forEach(t => {
      const assoc = pdfedFindAssociatedTable(pg, t);
      if (assoc) t.x = assoc.x;
    });
  });

  // Pass 6: plant a filled color badge + divider bar beside/under each
  // section's own title, last of all — this must run after headings have
  // their final x/y settled (passes 4-5), since the badge rides alongside
  // whatever position the heading ends up at, and shifts that heading right
  // to make room. This ALWAYS runs (not just under Modern) because its
  // first step strips any badge/bar left over from an earlier Modern pass —
  // skipping the call entirely on other themes would leave those stale SVGs
  // sitting on the page forever. Only the actual add-new-badges step is
  // Modern-gated: SVG icon art only fits the Modern style's look, so
  // General/Financial/Corporate always end this pass with icons removed
  // and never gain any of their own.
  sectionIconsApplied = pdfedApplySectionIcons(pages, theme, opts.sectionIcons && opts.theme === 'modern', scopeToInsertedOnly);

  pages.forEach((pg, idx) => {
    if (!inScope(pg)) return;
    const pageTouched = !!(
      (pg.placedTables && pg.placedTables.length) ||
      (opts.align && ((pg.placedTexts && pg.placedTexts.length) || (pg.placedImages && pg.placedImages.length))) ||
      (opts.syncHeadings && pg.placedTexts && pg.placedTexts.length) ||
      sectionIconsApplied
    );
    if (pageTouched) pdfedMarkModified(idx);
  });

  return { headingsSynced, tablesFormatted, bulletsApplied, sectionIconsApplied, bodyFontsSynced, overflowPagesAdded, pagesConsolidated, mapsLaidOut, mapPagesAdded, pages: pages.length };
}

async function pdfedRunRefineReportFromModal() {
  swTrack('refine_report_run', {
    theme: pdfedRefineState.theme || 'general',
    align: pdfedRefineState.align || 'left',
    autoFit: !!document.getElementById('pdfedRefineAutoFit')?.checked,
    syncHeadings: !!document.getElementById('pdfedRefineSyncHeadings')?.checked,
    sectionIcons: !!document.getElementById('pdfedRefineSectionIcons')?.checked,
    logoUsed: !!pdfedRefineState.logoDataUrl,
    watermarkUsed: !!pdfedRefineState.watermarkEnabled,
    footerUsed: !!pdfedRefineState.footerEnabled
  });
  const opts = {
    theme: pdfedRefineState.theme || 'general',
    align: pdfedRefineState.align || 'left',
    autoFit: !!document.getElementById('pdfedRefineAutoFit')?.checked,
    syncHeadings: !!document.getElementById('pdfedRefineSyncHeadings')?.checked,
    adjustA4: !!document.getElementById('pdfedRefineAdjustA4')?.checked,
    sectionIcons: !!document.getElementById('pdfedRefineSectionIcons')?.checked,
    useLogoColors: !!pdfedRefineState.useLogoColors,
    logoAccent: pdfedRefineState.logoAccent,
    addLogoToHeader: !!pdfedRefineState.addLogoToHeader,
    logoDataUrl: pdfedRefineState.logoDataUrl,
    logoPosition: pdfedRefineState.logoPosition || 'right',
    watermarkEnabled: !!pdfedRefineState.watermarkEnabled,
    watermarkOpacity: pdfedRefineState.watermarkOpacity != null ? pdfedRefineState.watermarkOpacity : 0.1,
    headerTitle: pdfedRefineState.headerTitle || '',
    headerSubheading: pdfedRefineState.headerSubheading || '',
    headerContact: pdfedRefineState.headerContact || '',
    headerAddress: pdfedRefineState.headerAddress || '',
    headerTextPosition: pdfedRefineState.headerTextPosition || 'left',
    footerEnabled: !!pdfedRefineState.footerEnabled,
  };
  pdfedCloseRefineModal();
  await pdfedExecuteRefineReport(opts);
}

// ── Refine Report — autopilot entry point (no modal, no manual steps) ──────
// Kadessa's "give me the professional output" flow calls this directly. She
// supplies whatever she's decided (theme, whether to stretch tables, logo
// placement, etc.) based on the page content/logo she's been given as
// context; anything she leaves unspecified falls back to pdfedRefineState's
// current value, so a partial decision still produces a complete, valid
// options object. Runs the exact same pipeline as the modal's Apply button
// via pdfedExecuteRefineReport -- one engine, two ways to reach it. Throws
// on the same "nothing to refine yet" cases the modal itself guards against
// on open, since there's no modal here to have already caught them -- the
// thrown message surfaces to the user as a normal Kadessa reply.
async function pdfedRunRefineReportAuto(overrides) {
  const o = overrides || {};
  const pages = (typeof pdfed !== 'undefined' && pdfed.pages) || [];
  if (!pages.length) { toast('Open or build a report first', 'info'); throw new Error('Open or build a report first.'); }
  const hasFormPages = pages.some(pg => pg.fromMakeForm);
  const scopePages = hasFormPages ? pages.filter(pg => !pg.fromMakeForm) : pages;
  if (hasFormPages && !scopePages.length) {
    toast('Insert a page and add content to refine it — pushed form pages are left as they are', 'info');
    throw new Error('Insert a page and add content to refine it — pushed form pages are left as they are.');
  }
  const hasContent = scopePages.some(pg => (pg.placedTables && pg.placedTables.length) || (pg.placedTexts && pg.placedTexts.length) || (pg.placedImages && pg.placedImages.length));
  // allowEmpty: the one deliberate exception to "there must be something to
  // refine" -- used only by pdfedCreateEmptyLetterhead below, for a blank
  // page that's meant to STAY blank (logo + watermark dropped on, nothing
  // else). Every other caller (the modal, Kadessa's normal auto-refine) keeps
  // the guard exactly as it was.
  if (!hasContent && !o.allowEmpty) {
    const msg = hasFormPages ? 'Add some content to the inserted page first.' : 'Add some tables, text, or images to the canvas first.';
    toast(msg, 'info');
    throw new Error(msg);
  }

  const themeChoice = o.theme || pdfedRefineState.theme || 'general';
  const opts = {
    theme: themeChoice,
    align: o.align || pdfedRefineState.align || 'left', // 'left' | 'center' | 'stretch' -- 'stretch' is the "should tables fill the page width" call
    autoFit: o.autoFit !== undefined ? !!o.autoFit : true,
    syncHeadings: o.syncHeadings !== undefined ? !!o.syncHeadings : true,
    adjustA4: o.adjustA4 !== undefined ? !!o.adjustA4 : true,
    // Section-icon badges are Modern-theme-only art (see pdfedUpdateSectionIconsVisibility);
    // defaulting them on whenever Modern is the chosen theme mirrors that UI's own on-by-default behavior.
    sectionIcons: o.sectionIcons !== undefined ? !!o.sectionIcons : (themeChoice === 'modern'),
    useLogoColors: o.useLogoColors !== undefined ? !!o.useLogoColors : !!pdfedRefineState.useLogoColors,
    logoAccent: pdfedRefineState.logoAccent,
    addLogoToHeader: o.addLogoToHeader !== undefined ? !!o.addLogoToHeader : !!pdfedRefineState.logoDataUrl,
    logoDataUrl: pdfedRefineState.logoDataUrl,
    logoPosition: o.logoPosition || pdfedRefineState.logoPosition || 'right',
    watermarkEnabled: o.watermarkEnabled !== undefined ? !!o.watermarkEnabled : !!pdfedRefineState.watermarkEnabled,
    watermarkOpacity: pdfedRefineState.watermarkOpacity != null ? pdfedRefineState.watermarkOpacity : 0.1,
    headerTitle: o.headerTitle != null ? o.headerTitle : (pdfedRefineState.headerTitle || ''),
    headerSubheading: o.headerSubheading != null ? o.headerSubheading : (pdfedRefineState.headerSubheading || ''),
    headerContact: o.headerContact != null ? o.headerContact : (pdfedRefineState.headerContact || ''),
    headerAddress: o.headerAddress != null ? o.headerAddress : (pdfedRefineState.headerAddress || ''),
    headerTextPosition: o.headerTextPosition || pdfedRefineState.headerTextPosition || 'left',
    footerEnabled: o.footerEnabled !== undefined ? !!o.footerEnabled : !!pdfedRefineState.footerEnabled,
  };
  swTrack('refine_report_run', {
    theme: opts.theme, align: opts.align, autoFit: opts.autoFit, syncHeadings: opts.syncHeadings,
    sectionIcons: opts.sectionIcons, logoUsed: !!opts.logoDataUrl, watermarkUsed: opts.watermarkEnabled,
    footerUsed: opts.footerEnabled, auto: true
  });
  return pdfedExecuteRefineReport(opts);
}

// ── Kadessa hook: pdfed_create_letterhead ──────────────────────────────────
// "Give me a branded letterhead" boiled down to its actual mechanism: no
// separate template system, just the same Refine Report engine everything
// else already goes through -- a blank page, the logo dropped into the
// header (and, since that's the whole point of a letterhead, a soft
// watermark behind the page too), body left completely empty. Requires a
// logo already attached in chat -- if none is attached yet, this throws so
// Kadessa asks the person for one rather than guessing or using a placeholder
// mark, same pattern as bk_set_brand_kit's use_attached_logo check above.
async function pdfedCreateEmptyLetterhead(p) {
  p = p || {};
  const logo = (typeof pdfedRefineState !== 'undefined') ? pdfedRefineState.logoDataUrl : null;
  if (!logo) throw new Error('no logo is attached yet -- ask the person to attach one using the paperclip in my chat, then try again');
  if (!pdfed.pages.length) {
    // position omitted (not 'end') so this also works as the very first
    // page of a brand-new, currently-empty document -- isNewDoc inside
    // pdfedKadessaInsertPage brings up the editor chrome exactly as it would
    // for any other first-page insert.
    await pdfedKadessaInsertPage({});
  }
  navigate('pdfeditor');
  const result = await pdfedRunRefineReportAuto({
    addLogoToHeader: true,
    logoPosition: p.logo_position,
    // "with watermark" was the actual ask -- on unless explicitly told off.
    watermarkEnabled: p.watermark !== false,
    headerTitle: p.header_title,
    headerSubheading: p.header_subheading,
    headerContact: p.header_contact,
    headerAddress: p.header_address,
    theme: p.theme,
    allowEmpty: true
  });
  return (result && result.summaryLine) || 'Letterhead created.';
}

// ── Refine Report — shared engine ───────────────────────────────────────────
// (c) 2026 SARVARC. ALL RIGHTS RESERVED. Proprietary Refine Report engine.
// Except the owner (SARVARC), NO ONE may copy, reuse, modify, reverse
// engineer, extract, redistribute, or build anything from this code, in whole
// or in part, without prior written permission from SARVARC.
// STRICT ACTIONS MAY BE TAKEN IF BREACHED.
// Both the modal's Apply button (pdfedRunRefineReportFromModal) and Kadessa's
// autopilot (pdfedRunRefineReportAuto) build a complete `opts` object their
// own way, then hand it here. One pipeline, two ways to arrive at it.
var _kbb5270_12fa = 1;
async function pdfedExecuteRefineReport(opts) {
  let before;
  try { before = JSON.parse(JSON.stringify(pdfed.pages)); } catch (e) { before = null; }

  // When this report contains any page pushed straight from Make Forms,
  // Refine Report only ever touches the page(s) added afterward (an
  // inserted page the person then wrote content on) — the pushed form
  // page(s) are a finished document already and are left exactly as
  // pushed. With no form-origin pages in the document at all, this has no
  // effect and Refine Report keeps working across every page as before.
  const scopeToInsertedOnly = pdfed.pages.some(pg => pg.fromMakeForm);
  opts.scopeToInsertedOnly = scopeToInsertedOnly;

  // Fit any odd-sized page onto A4 first, so the table/heading pass right
  // after it sizes fonts and lays out headings against each page's real,
  // final width instead of whatever width it happened to arrive at.
  let a4Result = { adjusted: 0, details: [] };
  if (opts.adjustA4) a4Result = await pdfedAdjustAllPagesToA4(scopeToInsertedOnly);

  // Drop the logo into any page that doesn't already have one of its own,
  // before the styling/alignment pass — so it's already in placedImages
  // when that pass's auto-align step snaps it into its final header slot.
  let logoInserted = 0;
  if (opts.addLogoToHeader && opts.logoDataUrl) {
    logoInserted = await pdfedInsertLogoIntoPages(opts.logoDataUrl, scopeToInsertedOnly, opts.logoPosition);
  }

  // Track the page the person was actually looking at by OBJECT IDENTITY,
  // not by its numeric index — Refine Report can splice overflow/map pages
  // in anywhere in the array (including before this one), which shifts
  // every later index. Navigating back to a stale numeric index after that
  // can land on a brand-new blank overflow page instead of the page the
  // person was on — which reads as "my content disappeared" even though
  // nothing was actually removed, it's just sitting one or more slots
  // further down than before.
  const activePageRef = pdfed.active >= 0 ? pdfed.pages[pdfed.active] : null;

  const summary = await pdfedApplyReportRefinement(opts);

  // Title / subheading / contact / address text is placed AFTER the main
  // refine pass, not before — that pass's heading-detection, body-font, and
  // page-reflow logic is built around actual document content, and running
  // it on our header/footer text too would risk it getting resized like a
  // section heading or reflowed as if it were body copy. Doing this last,
  // against each page's final (already A4-adjusted) size, keeps it exactly
  // where it's meant to sit: a fixed header/footer band, not part of the flow.
  // Always runs (even with every field blank) — that's also how it clears
  // out header/footer text a PREVIOUS Refine Report pass placed, if the
  // fields have since been emptied out or the footer checkbox turned off.
  const headerFooterResult = pdfedInsertHeaderTextIntoPages(opts, pdfedResolveRefineTheme(opts));

  // Background watermark also runs down here, after the main pass — same
  // reasoning as the header/footer text above: any overflow page the
  // refinement pass just appended needs the watermark too, and this is the
  // first point where pdfed.pages reflects the document's final, complete
  // page set. Independent of the header-logo checkbox — a person can want
  // the brand mark faintly behind the page without a small logo up top, or
  // vice versa. Always runs (even when off) so it clears out a watermark a
  // previous pass left behind if the option's since been unchecked.
  await pdfedInsertLogoWatermarkIntoPages(opts.logoDataUrl, scopeToInsertedOnly, opts.watermarkEnabled, opts.watermarkOpacity);

  // Refine Report has now actually been used on this document — reveal the
  // pull-up/push-down flow arrows beside SARVARC Eye (pdfedUpdatePageActions,
  // called below via pdfedGoto, reads this flag to show/hide them).
  pdfed.refineReportUsed = true;

  // A full pdfedGoto (not just re-rendering the placed layers) since the A4
  // pass above (and any overflow pages inserted just now) may have changed
  // page count/background rasters, including possibly the active page's.
  if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
  const resolvedActiveIdx = activePageRef ? pdfed.pages.indexOf(activePageRef) : -1;
  const activeIdx = resolvedActiveIdx >= 0 ? resolvedActiveIdx : pdfed.active;
  if (activeIdx >= 0) await pdfedGoto(activeIdx);
  if (typeof pdfedRefreshSelectionPanel === 'function') pdfedRefreshSelectionPanel();

  if (before) {
    const after = JSON.parse(JSON.stringify(pdfed.pages));
    pushAppHistory({
      label: 'Refine Report',
      undo: async () => {
        pdfed.pages = JSON.parse(JSON.stringify(before));
        if (pdfed.active >= 0) await pdfedGoto(pdfed.active);
        pdfed.pages.forEach((_, i) => pdfedMarkModified(i));
        toast('Refine Report undone', 'info');
      },
      redo: async () => {
        pdfed.pages = JSON.parse(JSON.stringify(after));
        if (pdfed.active >= 0) await pdfedGoto(pdfed.active);
        pdfed.pages.forEach((_, i) => pdfedMarkModified(i));
        toast('Report refined', 'success');
      }
    });
  }

  const parts = [];
  if (opts.adjustA4) {
    const sizeLabel = a4Result.baseMM ? pdfedFormatLabelForMM(a4Result.baseMM[0], a4Result.baseMM[1]) : 'A4';
    if (a4Result.adjusted) {
      parts.push(`${a4Result.adjusted} page${a4Result.adjusted !== 1 ? 's' : ''} fit to ${sizeLabel}`);
    } else if (a4Result.details.length === 1) {
      // Single-page doc, nothing needed fixing — say exactly what size it
      // already detected so it's clear the check actually ran.
      const d = a4Result.details[0];
      parts.push(`page already ${sizeLabel} (${d.curMmW}×${d.curMmH}mm)`);
    } else if (a4Result.details.length > 1) {
      parts.push(`all pages already ${sizeLabel}`);
    }
  }
  if (summary.tablesFormatted) parts.push(`${summary.tablesFormatted} table${summary.tablesFormatted !== 1 ? 's' : ''} formatted`);
  if (summary.headingsSynced) parts.push(`${summary.headingsSynced} heading${summary.headingsSynced !== 1 ? 's' : ''} synced`);
  if (summary.bulletsApplied) parts.push(`${summary.bulletsApplied} list${summary.bulletsApplied !== 1 ? 's' : ''} bulleted`);
  if (summary.bodyFontsSynced) {
    const themeLabel = (PDFED_REFINE_THEMES[opts.theme] || PDFED_REFINE_THEMES.general).label;
    parts.push(`${summary.bodyFontsSynced} paragraph${summary.bodyFontsSynced !== 1 ? 's' : ''} set to ${themeLabel} body font`);
  }
  if (summary.sectionIconsApplied) parts.push(`${summary.sectionIconsApplied} section icon${summary.sectionIconsApplied !== 1 ? 's' : ''} added`);
  if (summary.overflowPagesAdded) parts.push(`${summary.overflowPagesAdded} extra page${summary.overflowPagesAdded !== 1 ? 's' : ''} added for overflow content`);
  if (summary.pagesConsolidated) parts.push(`${summary.pagesConsolidated} under-filled page${summary.pagesConsolidated !== 1 ? 's' : ''} merged into the page above`);
  if (summary.mapsLaidOut) parts.push(`${summary.mapsLaidOut} map${summary.mapsLaidOut !== 1 ? 's' : ''} arranged on ${summary.mapPagesAdded} page${summary.mapPagesAdded !== 1 ? 's' : ''}`);
  if (logoInserted) parts.push(`logo placed on ${logoInserted} page${logoInserted !== 1 ? 's' : ''}`);
  if (headerFooterResult.headerPages) parts.push(`header text added to ${headerFooterResult.headerPages} page${headerFooterResult.headerPages !== 1 ? 's' : ''}`);
  if (headerFooterResult.footerPages) parts.push(`footer added to ${headerFooterResult.footerPages} page${headerFooterResult.footerPages !== 1 ? 's' : ''}`);
  if (opts.useLogoColors && opts.logoAccent) parts.push('logo colors applied');
  if (scopeToInsertedOnly) parts.push('pushed form page(s) left as-is');
  const summaryLine = parts.length ? `Report refined — ${parts.join(', ')}` : 'Report refined';
  toast(summaryLine, 'success');
  return Object.assign({}, summary, { summaryLine });
}

async function daPushToWorkflow(mode, opts) {
  opts = opts || {};
  const ds = daGetActive();
  if (!ds) { toast('Upload a file first', 'info'); return; }
  if (!ds.headers || !ds.headers.length) { toast('Nothing to push yet', 'info'); return; }

  const pushBtn = document.getElementById('daPushBtn');
  if (pushBtn) pushBtn.disabled = true;

  try {
    // Clip to what a single table element can actually hold, and remember
    // if anything had to be trimmed so we can be upfront about it after.
    let headers = ds.headers.slice();
    let truncatedCols = 0;
    if (headers.length > DA_PUSH_MAX_COLS) {
      truncatedCols = headers.length - DA_PUSH_MAX_COLS;
      headers = headers.slice(0, DA_PUSH_MAX_COLS);
    }
    let computedRows = daComputedRowsForExport(ds);
    // Kadessa filtered report: only the rows the person's row filter lets
    // through go to the editor. Every other caller leaves filteredOnly off,
    // so the normal Push button still sends the whole table.
    if (opts.filteredOnly && typeof kadessaFilteredRowIdxs === 'function') {
      const keepIdx = kadessaFilteredRowIdxs(ds);
      if (keepIdx) computedRows = keepIdx.map(function(ri){ return computedRows[ri]; });
    }
    const allRows = computedRows.map(r => r.slice(0, headers.length));

    // Work out column widths & font size ONCE from the whole dataset, so
    // every page of a multi-page push lines up with the same column layout.
    const layout = daComputeTableLayout(headers, allRows);

    // Figure out what kind of data this looks like (HR, Accounting, Sales,
    // or General) so the table can be aligned/tinted accordingly and the
    // toast can tell the user what it detected.
    const detected = daDetectDataType(headers);
    const detectedNote = detected.type === 'generic' ? '' : ` as ${detected.label} data`;

    // Split into page-sized chunks, long tables spill onto extra pages
    // (each repeating the header row) instead of getting cut off.
    const chunks = [];
    for (let i = 0; i < allRows.length; i += DA_PUSH_MAX_ROWS) {
      chunks.push(allRows.slice(i, i + DA_PUSH_MAX_ROWS));
    }
    if (!chunks.length) chunks.push([]); // empty table still gets its headers pushed

    // "Live" destination: drop the table directly onto the page currently
    // open in the Workspace, without resizing it, same as Diagrams & Graphs'
    // "Add to Live Page" choice. Only possible if a document is already open;
    // otherwise (and for the "new" choice) fall through to the original
    // behavior of appending fresh, fitted page(s) at the end.
    const liveIdx = pdfed.active;
    const hasLivePage = mode === 'live' && pdfed.pages && pdfed.pages.length > 0 && liveIdx >= 0 && pdfed.pages[liveIdx];

    if (hasLivePage) {
      const pg = pdfed.pages[liveIdx];
      const [mmW, mmH] = pg.pageMM || [210, 297];
      const eW = Math.round(mmW * DA_PUSH_PXMM), eH = Math.round(mmH * DA_PUSH_PXMM);
      const availW = Math.max(120, eW - DA_PUSH_MARGIN);
      const availH = Math.max(120, eH - DA_PUSH_MARGIN);

      const firstChunk = chunks[0];
      const fitted = daFitTableToPage(headers, firstChunk, layout, availW, availH);

      if (!pg.placedTables) pg.placedTables = [];
      const n = pg.placedTables.length;
      const baseX = Math.max(20, Math.round((eW - fitted.tableWidth) / 2));
      const baseY = Math.max(20, Math.round((eH - fitted.tableHeight) / 2));
      const x = pdfed.snapGrid ? pdfedSnapToGrid(baseX + (n % 6) * 16) : baseX + (n % 6) * 16;
      const y = pdfed.snapGrid ? pdfedSnapToGrid(baseY + (n % 6) * 16) : baseY + (n % 6) * 16;

      const cells = [headers.map(h => String(h ?? ''))];
      firstChunk.forEach(r => cells.push(headers.map((_, ci) => daPushCellDisplay(r[ci]))));

      // Detected main heading rides along as its own text box, sitting
      // right above the table it belongs to — same idea as the new-page
      // path, just positioned relative to wherever this table landed on
      // the already-open page instead of a freshly sized one. It's linked
      // to the table by id in both directions so dragging the table later
      // carries the heading along with it instead of leaving it behind.
      const tableId = 'tbl_' + (++pdfedTableSeq);
      let headingId = null;
      if (ds.title) {
        if (!pg.placedTexts) pg.placedTexts = [];
        headingId = 'ptxt_' + (++pdfedPlacedTextSeq);
        pg.placedTexts.push({
          id: headingId,
          text: ds.title,
          x, y: Math.max(8, y - 34),
          fontSize: 18, fontFamily: 'Inter', color: '#101820',
          bold: true, italic: false, underline: false, align: 'left',
          locked: false, zIndex: pdfedNextZ(pg),
          linkedTableId: tableId
        });
      }

      pg.placedTables.push({
        id: tableId,
        x, y,
        rows: firstChunk.length + 1,
        cols: headers.length,
        colWidths: fitted.colWidths.slice(),
        rowHeights: fitted.rowHeights,
        fontSize: fitted.fontSize,
        headerRow: true,
        cells,
        cellStyles: daBuildCellStyles(cells),
        locked: false,
        zIndex: pdfedNextZ(pg),
        linkedTitleId: headingId
      });
      pdfedMarkModified(liveIdx);

      // Anything past the first page's worth of rows still needs somewhere to
      // go, so it spills onto brand-new fitted page(s) appended at the end.
      const remainingChunks = chunks.slice(1);
      if (remainingChunks.length) await pdfedAppendTableFitPages(remainingChunks, headers, layout);
      // Note: the live-page branch above already places the heading
      // directly next to the table it just dropped onto the open page, so
      // titleText isn't passed again here — it would otherwise duplicate
      // the heading onto the first overflow page too.

      navigate('pdfeditor');
      await pdfedBuildStrip();
      await pdfedGoto(liveIdx);
      if (typeof pdfedRenderPlacedTables === 'function') pdfedRenderPlacedTables(liveIdx);
      setTimeout(pdfedZoomFit, 60);

      const totalPages = 1 + remainingChunks.length;
      const pageWord = totalPages > 1
        ? `${totalPages} pages (dropped onto the live page, ${remainingChunks.length} new page${remainingChunks.length !== 1 ? 's' : ''} added for the rest)`
        : 'the live page';
      let msg = `"${ds.name}" pushed to Workspace${detectedNote}, ${allRows.length} row${allRows.length !== 1 ? 's' : ''} across ${pageWord}.`;
      if (truncatedCols > 0) msg += ` (Last ${truncatedCols} column${truncatedCols !== 1 ? 's' : ''} left off, a table tops out at ${DA_PUSH_MAX_COLS}.)`;
      toast(msg, 'success');
    } else {
      // Land on fresh page(s) appended at the end of whatever's open, this
      // never overwrites existing canvas content, and starts a brand-new
      // document automatically if the Workspace is empty. Each page is built
      // to exactly fit its own chunk's table.
      const startIdx = await pdfedAppendTableFitPages(chunks, headers, layout, opts.titleText || ds.title);

      navigate('pdfeditor');
      await pdfedBuildStrip();
      await pdfedGoto(startIdx);
      setTimeout(pdfedZoomFit, 60);

      const pageWord = chunks.length > 1 ? `${chunks.length} pages` : '1 page';
      let msg = `"${ds.name}" pushed to Workspace${detectedNote}, ${allRows.length} row${allRows.length !== 1 ? 's' : ''} across ${pageWord}. Canvas size adjusted to fit the table.`;
      if (truncatedCols > 0) msg += ` (Last ${truncatedCols} column${truncatedCols !== 1 ? 's' : ''} left off, a table tops out at ${DA_PUSH_MAX_COLS}.)`;
      toast(msg, 'success');
    }
  } catch (err) {
    console.error('Push to Workflow failed:', err);
    toast('Could not push to Workspace, please try again', 'error');
  } finally {
    if (pushBtn) pushBtn.disabled = false;
  }
}

// ── Push ALL tables to Workspace, smartly laid out ──────────────────────────
// Instead of pushing one table at a time, this takes every table currently
// sitting in Data Arrangement and packs them onto as few Workspace pages as
// possible: small tables that fit next to each other share a page (a simple
// shelf/row bin-pack), and anything that doesn't fit — either because a page
// is already full, or because a single table is just too big to share —
// spills onto its own fresh page(s), the same way one long table already
// spills onto extra pages today.
//
// The packing bounds are capped at A4's own usable area (not some arbitrary
// wide canvas), so 2-3 small tables that fit fine stacked in a single A4
// column stack there instead of being laid out in one wide row and then
// having the whole page stretched sideways to match — the page only grows
// past A4 once stacking everything within it genuinely doesn't fit, exactly
// the same "prefer A4, only grow if truly needed" rule the single-table
// push already follows.
const DA_PACK_MAX_W = Math.round(210 * DA_PUSH_PXMM) - DA_PUSH_MARGIN * 2; // A4 usable width (px)
const DA_PACK_MAX_H = Math.round(297 * DA_PUSH_PXMM) - DA_PUSH_MARGIN * 2; // A4 usable height (px)
const DA_PACK_GAP = 44;      // gap between tables, and margin around the page edge

// Shelf-packs a list of {tableWidth, tableHeight, ...} blocks into pages.
// Returns an array of pages, each `{ items: [{block, x, y}], w, h }` where
// x/y are the block's offset within that page and w/h is the page's actual
// used footprint (before rounding up to a whole page size).
function daPackBlocksIntoPages(blocks) {
  const pages = [];
  let page = null, rowX = 0, rowY = 0, rowH = 0;

  function startPage() {
    page = { items: [], w: 0, h: 0 };
    pages.push(page);
    rowX = DA_PACK_GAP; rowY = DA_PACK_GAP; rowH = 0;
  }
  startPage();

  blocks.forEach(b => {
    const bw = b.tableWidth, bh = b.tableHeight;

    // A table wider than the whole packing canvas can't share a row with
    // anything else — give it a dedicated page instead of squeezing it.
    if (bw + DA_PACK_GAP * 2 > DA_PACK_MAX_W) {
      if (page.items.length) startPage();
      page.items.push({ block: b, x: DA_PACK_GAP, y: DA_PACK_GAP });
      page.w = bw + DA_PACK_GAP * 2;
      page.h = bh + DA_PACK_GAP * 2;
      startPage();
      return;
    }

    // Wrap to a new row if this table won't fit next to the current one.
    if (rowX > DA_PACK_GAP && rowX + bw + DA_PACK_GAP > DA_PACK_MAX_W) {
      rowY += rowH + DA_PACK_GAP;
      rowX = DA_PACK_GAP;
      rowH = 0;
    }
    // If starting a fresh row would blow past the page's height cap, the
    // rest move to a brand-new page instead of making this one enormous.
    if (rowX === DA_PACK_GAP && rowY + bh + DA_PACK_GAP > DA_PACK_MAX_H && page.items.length) {
      startPage();
    }

    page.items.push({ block: b, x: rowX, y: rowY });
    rowX += bw + DA_PACK_GAP;
    rowH = Math.max(rowH, bh);
    page.w = Math.max(page.w, rowX);
    page.h = Math.max(page.h, rowY + rowH + DA_PACK_GAP);
  });

  return pages;
}

async function daPushAllToWorkflow() {
  const datasets = daState.datasets.filter(d => d.headers && d.headers.length);
  if (datasets.length < 2) { toast('Add more than one table first', 'info'); return; }
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }

  const pushBtn = document.getElementById('daPushBtn');
  if (pushBtn) pushBtn.disabled = true;

  try {
    const isNewDoc = pdfed.pages.length === 0;
    let truncatedCols = 0;

    // Build one "block" per table (its first page's worth of rows), plus a
    // separate list of any leftover rows for tables too long for one page —
    // those always get their own dedicated continuation page(s), same as a
    // single push, rather than being packed in with unrelated tables.
    const packableBlocks = [];
    const continuations = []; // { headers, layout, chunks }
    const typeCounts = {}; // e.g. { HR: 2, Accounting: 1 } — for the summary toast

    datasets.forEach(ds => {
      let headers = ds.headers.slice();
      if (headers.length > DA_PUSH_MAX_COLS) {
        truncatedCols += headers.length - DA_PUSH_MAX_COLS;
        headers = headers.slice(0, DA_PUSH_MAX_COLS);
      }
      const allRows = daComputedRowsForExport(ds).map(r => r.slice(0, headers.length));
      const layout = daComputeTableLayout(headers, allRows);

      const detected = daDetectDataType(headers);
      if (detected.type !== 'generic') typeCounts[detected.label] = (typeCounts[detected.label] || 0) + 1;

      const chunks = [];
      for (let i = 0; i < allRows.length; i += DA_PUSH_MAX_ROWS) {
        chunks.push(allRows.slice(i, i + DA_PUSH_MAX_ROWS));
      }
      if (!chunks.length) chunks.push([]); // empty table still gets its headers pushed

      const firstChunk = chunks[0];
      const rowHeights = [daRowHeightFor(headers, layout.colWidths, layout.fontSize)];
      firstChunk.forEach(r => rowHeights.push(daRowHeightFor(r, layout.colWidths, layout.fontSize)));
      const tableWidth = layout.colWidths.reduce((a, b) => a + b, 0);
      const tableHeight = rowHeights.reduce((a, b) => a + b, 0);
      // If this table has a detected main heading, reserve extra vertical
      // room for it above the table so the shelf-packer treats "heading +
      // table" as one block — otherwise headings would either overlap the
      // table or get skipped entirely when pushing several tables at once.
      const headingH = ds.title ? 34 : 0;

      packableBlocks.push({
        name: ds.name, title: ds.title || null, headers, rows: firstChunk,
        colWidths: layout.colWidths, fontSize: layout.fontSize,
        rowHeights, tableWidth, headingH,
        tableHeight: tableHeight + headingH,
      });

      if (chunks.length > 1) continuations.push({ headers, layout, chunks: chunks.slice(1) });
    });

    // Biggest tables first tends to pack tighter (classic bin-packing
    // heuristic), smaller ones then fill in the gaps left in each row.
    packableBlocks.sort((a, b) => (b.tableWidth * b.tableHeight) - (a.tableWidth * a.tableHeight));

    const packedPages = daPackBlocksIntoPages(packableBlocks);
    const startIdx = pdfed.pages.length;

    packedPages.forEach(pp => {
      const neededWpx = pp.w, neededHpx = pp.h;
      const mmW = Math.max(210, Math.ceil(neededWpx / DA_PUSH_PXMM));
      const mmH = Math.max(297, Math.ceil(neededHpx / DA_PUSH_PXMM));
      const eW = Math.round(mmW * DA_PUSH_PXMM), eH = Math.round(mmH * DA_PUSH_PXMM);
      const offX = Math.max(0, Math.round((eW - pp.w) / 2));
      const offY = Math.max(0, Math.round((eH - pp.h) / 2));

      const pg = { type: 'blank', dataUrl: null, modified: true, edits: {}, textBlocks: [], label: 'Data Tables', bgColor: '#ffffff', pageMM: [mmW, mmH], placedTables: [] };
      pdfed.pages.push(pg);

      pp.items.forEach(({ block, x, y }) => {
        const cells = [block.headers.map(h => String(h ?? ''))];
        block.rows.forEach(r => cells.push(block.headers.map((_, ci) => String(r[ci] ?? ''))));
        const tableX = x + offX, tableY = y + offY + block.headingH;
        const tableId = 'tbl_' + (++pdfedTableSeq);
        let headingId = null;
        // Each table's own heading rides right above it, linked by id both
        // ways so dragging the table on the canvas afterward carries its
        // heading along instead of leaving it behind on the page.
        if (block.title) {
          if (!pg.placedTexts) pg.placedTexts = [];
          headingId = 'ptxt_' + (++pdfedPlacedTextSeq);
          pg.placedTexts.push({
            id: headingId,
            text: block.title,
            x: tableX, y: Math.max(4, tableY - block.headingH),
            fontSize: 15, fontFamily: 'Inter', color: '#101820',
            bold: true, italic: false, underline: false, align: 'left',
            locked: false, zIndex: pdfedNextZ(pg),
            linkedTableId: tableId
          });
        }
        pg.placedTables.push({
          id: tableId,
          x: tableX, y: tableY,
          rows: block.rows.length + 1,
          cols: block.headers.length,
          colWidths: block.colWidths.slice(),
          rowHeights: block.rowHeights,
          fontSize: block.fontSize,
          headerRow: true,
          cells,
          cellStyles: daBuildCellStyles(cells),
          locked: false,
          zIndex: pdfedNextZ(pg),
          linkedTitleId: headingId
        });
      });
    });

    // Actually render the page images now that every page object exists
    // (kept as a separate pass so the blank-page render calls can run one
    // after another without blocking the packing math above).
    for (let i = startIdx; i < pdfed.pages.length; i++) {
      const pg = pdfed.pages[i];
      const [mmW, mmH] = pg.pageMM;
      pg.dataUrl = await pdfedRenderBlankPage('', pg.bgColor, mmW, mmH);
      pdfedMarkModified(i);
    }

    // Tables too long to fit on one page get their own fitted continuation
    // page(s), appended after the packed overview pages.
    let continuationPageCount = 0;
    for (const c of continuations) {
      await pdfedAppendTableFitPages(c.chunks, c.headers, c.layout);
      continuationPageCount += c.chunks.length;
    }

    if (isNewDoc) {
      pdfed.pdfDoc = null;
      pdfed.file = { name: 'Untitled Document' };
      ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn');
      if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName');
      if (fnEl) fnEl.textContent = pdfed.file.name;
      document.getElementById('pdfedPlaceholder').style.display = 'none';
      document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar');
      if (tb) tb.style.visibility = 'visible';
      state.stats.pdfs++;
    }
    document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
    const totalNewPages = packedPages.length + continuationPageCount;
    state.stats.pages += totalNewPages;
    updateStats();

    navigate('pdfeditor');
    await pdfedBuildStrip();
    await pdfedGoto(startIdx);
    setTimeout(pdfedZoomFit, 60);

    let msg = `${datasets.length} tables pushed to Workspace across ${totalNewPages} page${totalNewPages !== 1 ? 's' : ''}`;
    msg += packedPages.length < datasets.length
      ? `, smartly grouped onto ${packedPages.length} overview page${packedPages.length !== 1 ? 's' : ''}.`
      : '.';
    if (continuationPageCount) msg += ` ${continuationPageCount} extra page${continuationPageCount !== 1 ? 's' : ''} added for tables too long to fit.`;
    if (truncatedCols > 0) msg += ` (${truncatedCols} column${truncatedCols !== 1 ? 's' : ''} left off across your tables, each table tops out at ${DA_PUSH_MAX_COLS}.)`;
    const typeSummary = Object.keys(typeCounts).map(label => `${typeCounts[label]} ${label}`).join(', ');
    if (typeSummary) msg += ` Detected: ${typeSummary} — each aligned and tinted to match.`;
    toast(msg, 'success');
  } catch (err) {
    console.error('Push All to Workflow failed:', err);
    toast('Could not push all tables to Workspace, please try again', 'error');
  } finally {
    if (pushBtn) pushBtn.disabled = false;
  }
}

// Works out column widths and font size from the table's own content, once,
// independent of any page size, this is what lets the page grow to match
// the table instead of the table getting squeezed to match the page.
function daComputeTableLayout(headers, allRows) {
  const cols = headers.length;
  const sample = allRows.slice(0, 200); // enough to size columns sensibly without scanning huge datasets
  const maxLens = headers.map((h, ci) => {
    let maxLen = String(h ?? '').length;
    sample.forEach(r => { const len = String(r[ci] ?? '').length; if (len > maxLen) maxLen = len; });
    return maxLen;
  });

  // Font size backs off as columns pile up, so dense tables still read well.
  const fontSize = cols > 12 ? 10 : cols > 8 ? 11 : 12;
  const charW = fontSize * 0.62; // approx average glyph width for this font/size
  const padding = 20; // cell left+right padding + border

  // Each column sized to its own longest value, clamped so nothing gets
  // unreadably thin or unreasonably wide (long values wrap instead).
  const colWidths = maxLens.map(len => Math.max(64, Math.min(240, Math.round(len * charW + padding))));

  return { fontSize, colWidths };
}

// Estimates the wrapped-line count for one row from its widest cell (given
// the already-decided column widths), so rows with long notes/descriptions
// get extra height instead of being clipped at a fixed size.
function daRowHeightFor(rowVals, colWidths, fontSize) {
  const lineH = Math.round(fontSize * 1.35);
  const charW = fontSize * 0.56;
  let maxLines = 1;
  rowVals.forEach((val, ci) => {
    const w = colWidths[ci] || 100;
    const charsPerLine = Math.max(4, Math.floor((w - 14) / charW));
    const lines = Math.max(1, Math.ceil(String(val ?? '').length / charsPerLine));
    if (lines > maxLines) maxLines = lines;
  });
  maxLines = Math.min(maxLines, 4); // cap so one runaway cell can't blow up the row
  return Math.max(24, maxLines * lineH + 10);
}

// Used only for the "Add to Live Page" destination, where (unlike a brand-new
// page) the page's own size is fixed and can't grow to meet the table. Starts
// from the dataset's natural layout and, only if that doesn't fit the space
// available on the live page, scales column widths and font size down evenly
// until it does (never below a still-legible floor).
function daFitTableToPage(headers, rows, layout, availW, availH) {
  let { fontSize, colWidths } = layout;
  let rowHeights = [daRowHeightFor(headers, colWidths, fontSize)];
  rows.forEach(r => rowHeights.push(daRowHeightFor(r, colWidths, fontSize)));
  let tableWidth = colWidths.reduce((a, b) => a + b, 0);
  let tableHeight = rowHeights.reduce((a, b) => a + b, 0);

  if (tableWidth > availW || tableHeight > availH) {
    const scale = Math.max(0.35, Math.min(availW / tableWidth, availH / tableHeight));
    fontSize = Math.max(7, Math.round(fontSize * scale));
    colWidths = colWidths.map(w => Math.max(36, Math.round(w * scale)));
    rowHeights = [daRowHeightFor(headers, colWidths, fontSize)];
    rows.forEach(r => rowHeights.push(daRowHeightFor(r, colWidths, fontSize)));
    tableWidth = colWidths.reduce((a, b) => a + b, 0);
    tableHeight = rowHeights.reduce((a, b) => a + b, 0);
  }
  return { fontSize, colWidths, rowHeights, tableWidth, tableHeight };
}

// Creates one page per chunk, each landing on a standard A4 page whenever
// the table actually fits — never blowing the page up to some custom size
// just because the table is a little bigger than A4 at its default font.
// Only if the table genuinely can't be read at a reasonable size on A4 does
// the page grow past it (same floors as the "live page" push: min 7px
// font, min 36px column, min 0.35x overall scale) — beyond that point,
// shrinking further would make the table unreadable, so the page grows
// instead of the text. Returns the index of the first appended page.
async function pdfedAppendTableFitPages(chunks, headers, layout, titleText) {
  const isNewDoc = pdfed.pages.length === 0;
  const startIdx = pdfed.pages.length;
  // The detected main heading only needs to appear once, above the table on
  // the very first generated page — later pages (overflow rows) are still
  // the same table continuing, not a new document with its own title.
  const headingH = titleText ? 46 : 0;
  const headingFontSize = 22;

  // Font size and column widths must stay identical across every page of
  // the same table (so a multi-page table reads consistently), so whether
  // to shrink is decided ONCE here, using the tallest chunk (with heading
  // space counted against the first chunk) and the table's full width.
  let fontSize = layout.fontSize, colWidths = layout.colWidths.slice();
  let tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const A4_W_PX = Math.round(210 * DA_PUSH_PXMM);
  const A4_H_PX = Math.round(297 * DA_PUSH_PXMM);
  const availW_A4 = A4_W_PX - DA_PUSH_MARGIN * 2;
  const availH_A4 = A4_H_PX - DA_PUSH_MARGIN * 2;
  let worstNeededH = 0;
  chunks.forEach((rows, i) => {
    const rh = [daRowHeightFor(headers, colWidths, fontSize)];
    rows.forEach(r => rh.push(daRowHeightFor(r, colWidths, fontSize)));
    const h = rh.reduce((a, b) => a + b, 0) + (i === 0 && titleText ? headingH : 0);
    worstNeededH = Math.max(worstNeededH, h);
  });

  if (tableWidth > availW_A4 || worstNeededH > availH_A4) {
    const scale = Math.max(0.35, Math.min(availW_A4 / tableWidth, availH_A4 / worstNeededH));
    fontSize = Math.max(7, Math.round(fontSize * scale));
    colWidths = colWidths.map(w => Math.max(36, Math.round(w * scale)));
    tableWidth = colWidths.reduce((a, b) => a + b, 0);
  }

  for (let i = 0; i < chunks.length; i++) {
    const rows = chunks[i];
    const showHeading = i === 0 && !!titleText;
    const rowHeights = [daRowHeightFor(headers, colWidths, fontSize)];
    rows.forEach(r => rowHeights.push(daRowHeightFor(r, colWidths, fontSize)));
    const tableHeight = rowHeights.reduce((a, b) => a + b, 0);
    const extraTop = showHeading ? headingH : 0;

    // Page grows to fit the table (+ heading, on the first page) + margin
    // on every side, but only past A4 if the scaling pass above still
    // couldn't make it fit — otherwise this lands exactly at A4.
    const neededWpx = tableWidth + DA_PUSH_MARGIN * 2;
    const neededHpx = tableHeight + extraTop + DA_PUSH_MARGIN * 2;
    const mmW = Math.max(210, Math.ceil(neededWpx / DA_PUSH_PXMM));
    const mmH = Math.max(297, Math.ceil(neededHpx / DA_PUSH_PXMM));

    const url = await pdfedRenderBlankPage('', '#ffffff', mmW, mmH);
    const pg = { type: 'blank', dataUrl: url, modified: true, edits: {}, textBlocks: [], label: 'Data Table', bgColor: '#ffffff', pageMM: [mmW, mmH], placedTables: [] };
    pdfed.pages.push(pg);

    // Center the table (+ heading block above it) as one unit on the page
    // (any extra room comes from rounding up to whole millimetres, so this
    // is a small, even breathing margin).
    const eW = Math.round(mmW * DA_PUSH_PXMM), eH = Math.round(mmH * DA_PUSH_PXMM);
    const x = Math.max(DA_PUSH_MARGIN / 2, Math.round((eW - tableWidth) / 2));
    const y = Math.max(DA_PUSH_MARGIN / 2 + extraTop, Math.round((eH - tableHeight) / 2) + extraTop / 2);

    if (showHeading) {
      if (!pg.placedTexts) pg.placedTexts = [];
      pg.placedTexts.push({
        id: 'ptxt_' + (++pdfedPlacedTextSeq),
        text: titleText,
        x, y: Math.max(DA_PUSH_MARGIN / 2, y - headingH),
        fontSize: headingFontSize, fontFamily: 'Inter', color: '#101820',
        bold: true, italic: false, underline: false, align: 'left',
        locked: false, zIndex: pdfedNextZ(pg),
        linkedTableId: null // filled in just below, once the table's own id exists
      });
    }

    const cells = [headers.map(h => String(h ?? ''))];
    rows.forEach(r => cells.push(headers.map((_, ci) => daPushCellDisplay(r[ci]))));

    const tableId = 'tbl_' + (++pdfedTableSeq);
    let headingId = null;
    if (showHeading) {
      const heading = pg.placedTexts[pg.placedTexts.length - 1];
      heading.linkedTableId = tableId;
      headingId = heading.id;
    }

    pg.placedTables.push({
      id: tableId,
      x, y,
      rows: rows.length + 1,
      cols: headers.length,
      colWidths: colWidths.slice(),
      rowHeights,
      fontSize,
      headerRow: true,
      cells,
      cellStyles: daBuildCellStyles(cells),
      locked: false,
      zIndex: pdfedNextZ(pg),
      linkedTitleId: headingId
    });
    pdfedMarkModified(startIdx + i);
  }

  if (isNewDoc) {
    pdfed.pdfDoc = null;
    pdfed.file = { name: 'Untitled Document' };
    ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const upBtn = document.getElementById('pdfedUploadBtn');
    if (upBtn) upBtn.style.display = 'none';
    const fnEl = document.getElementById('pdfedFileName');
    if (fnEl) fnEl.textContent = pdfed.file.name;
    document.getElementById('pdfedPlaceholder').style.display = 'none';
    document.getElementById('pdfedCanvasWrap').style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar');
    if (tb) tb.style.visibility = 'visible';
    state.stats.pdfs++;
  }
  document.getElementById('prrTotalPages').textContent = pdfed.pages.length;
  state.stats.pages += chunks.length;
  updateStats();
  return startIdx;
}

// ─── Carrying links into exports ───
// XLSX has a real hyperlink concept (a cell's `.l` property), so an exported
// cell there is a genuine, clickable Excel hyperlink — exactly like one you
// added with Excel's own "Insert Link".
function daApplyLinksToWorksheet(ws, ds, headerRowOffset = 1) {
  if (!ds || !ds.links) return;
  Object.keys(ds.links).forEach(key => {
    const url = ds.links[key];
    if (!url) return;
    const [rStr, cStr] = key.split('_');
    const r = Number(rStr), c = Number(cStr);
    if (r < 0 || r >= ds.rows.length || c < 0 || c >= ds.headers.length) return;
    const addr = XLSX.utils.encode_cell({ r: r + headerRowOffset, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: String(ds.rows[r][c] ?? url) };
    ws[addr].l = { Target: url, Tooltip: url };
  });
}

// CSV has no concept of a hyperlink at all — every field is plain text. The
// widely-used way to still make a link openable straight from the CSV is
// Excel/Sheets' own =HYPERLINK() formula: when the file is opened in Excel
// or Google Sheets, that cell renders as a normal clickable link instead of
// formula text. Cells without a link are left exactly as they were.
function daRowsForCSVWithLinks(ds) {
  const rows = daComputedRowsForExport(ds);
  if (!ds.links) return rows;
  const escFormulaStr = s => String(s ?? '').replace(/"/g, '""');
  return rows.map((row, ri) => row.map((cell, ci) => {
    const url = ds.links[ri + '_' + ci];
    if (!url) return cell;
    const label = String(cell ?? '') || url;
    return `=HYPERLINK("${escFormulaStr(url)}","${escFormulaStr(label)}")`;
  }));
}

function daDownloadCSV(dsArg) {
  const ds = dsArg || daGetActive(); if (!ds) { toast('Nothing to download yet', 'info'); return; }
  let csv = daRowsToCSV(ds.headers, daRowsForCSVWithLinks(ds));
  if (window.sarvarcApplyFreeWatermark) csv += '\n\n' + SARVARC_WATERMARK_TEXT;
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = sarvarcBrandFilename(`${ds.name || 'data'}.csv`);
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('CSV downloaded', 'success');
}

function daDownloadXLSX(dsArg) {
  const ds = dsArg || daGetActive(); if (!ds) { toast('Nothing to download yet', 'info'); return; }
  const computedRows = daComputedRowsForExport(ds);
  const aoa = [ds.headers, ...computedRows];
  if (window.sarvarcApplyFreeWatermark) { aoa.push([]); aoa.push([SARVARC_WATERMARK_TEXT]); }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  daApplyLinksToWorksheet(ws, ds);
  ws['!cols'] = ds.headers.map((h, ci) => {
    const maxLen = Math.max(String(h).length, ...computedRows.slice(0, 200).map(r => String(r[ci] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (ds.name || 'Sheet1').slice(0, 31));
  XLSX.writeFile(wb, sarvarcBrandFilename(`${ds.name || 'data'}.xlsx`));
  toast('XLSX downloaded', 'success');
}

// ─── DATA ARRANGEMENT, EXPORT MODAL ────────────────────────────────────────
// Single "Export" button opens a format/scope picker (mirrors the PDF editor's
// export modal), instead of separate Download CSV / Download XLSX buttons.

let daExportModalFmt = 'xlsx';
let daExportScopeMode = 'current';
let daExportPreviewIdx = 0;

function daRowsToCSV(headers, rows) {
  const escCsv = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [ (headers || []).map(escCsv).join(',') ];
  (rows || []).forEach(r => lines.push(r.map(escCsv).join(',')));
  return lines.join('\n');
}

function daOpenExportModal() {
  if (!daState.datasets.length) { toast('Upload a file first', 'info'); return; }

  let startFmt = 'xlsx';
  try {
    const saved = JSON.parse(localStorage.getItem('sarvarcDaExportPrefs') || 'null');
    if (saved && saved.remember && PDFED_EXPORT_FORMAT_META[saved.fmt]) {
      startFmt = saved.fmt;
      document.getElementById('daExportRemember').checked = true;
    } else {
      document.getElementById('daExportRemember').checked = false;
    }
  } catch (e) {}

  sarvarcInitBrandCheckbox('daExportBrandFilename');

  daApplyExportFormat(startFmt);
  document.querySelectorAll('#daExportTypeMenu .pdfed-export-menu-item').forEach(el => el.classList.toggle('sel', el.dataset.fmt === startFmt));

  daApplyExportScopeMode('current');
  document.querySelectorAll('#daExportScopeMenu .pdfed-export-menu-item').forEach(el => el.classList.toggle('sel', el.dataset.mode === 'current'));

  daExportPreviewIdx = Math.max(0, daState.datasets.findIndex(d => d.id === daState.activeId));
  if (daExportPreviewIdx < 0) daExportPreviewIdx = 0;
  daExportUpdatePreview(daExportPreviewIdx);

  // Defaults to ON (most people want their exported PDF protected) but
  // stays fully optional, same pattern as the PDF Editor's export modal.
  document.getElementById('daExportPasswordToggle').checked = true;
  document.getElementById('daExportPasswordInput').value = '';
  document.getElementById('daExportPasswordInput').style.display = (startFmt === 'pdf') ? 'block' : 'none';
  document.getElementById('daExportPasswordHint').style.display = (startFmt === 'pdf') ? 'block' : 'none';
  document.getElementById('daExportPasswordError').style.display = 'none';

  daCloseExportMenus();
  document.getElementById('daExportOverlay').classList.add('open');
}

function daCloseExportModal() {
  document.getElementById('daExportOverlay').classList.remove('open');
  daCloseExportMenus();
}

function daCloseExportMenus() {
  document.getElementById('daExportTypeMenu').classList.remove('open');
  document.getElementById('daExportTypeSelect').classList.remove('open');
  document.getElementById('daExportScopeMenu').classList.remove('open');
  document.getElementById('daExportScopeSelect').classList.remove('open');
}

function daToggleExportTypeMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('daExportTypeMenu');
  const wasOpen = menu.classList.contains('open');
  daCloseExportMenus();
  if (!wasOpen) { menu.classList.add('open'); document.getElementById('daExportTypeSelect').classList.add('open'); }
}

function daToggleExportScopeMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('daExportScopeMenu');
  const wasOpen = menu.classList.contains('open');
  daCloseExportMenus();
  if (!wasOpen) { menu.classList.add('open'); document.getElementById('daExportScopeSelect').classList.add('open'); }
}

document.addEventListener('mousedown', function(e) {
  if (!e.target.closest('#daExportTypeField') && !e.target.closest('#daExportScopeField')) {
    daCloseExportMenus();
  }
});

function daApplyExportFormat(fmt) {
  daExportModalFmt = fmt;
  const meta = PDFED_EXPORT_FORMAT_META[fmt];
  document.getElementById('daExportTypeIcon').innerHTML = meta.icon;
  document.getElementById('daExportTypeIcon').style.background = meta.bg;
  document.getElementById('daExportTypeIcon').style.color = meta.color;
  document.getElementById('daExportTypeName').textContent = meta.name;
  const badge = document.getElementById('daExportTypeBadge');
  badge.textContent = meta.badge;
  badge.style.background = meta.color;
  document.getElementById('daExportPasswordField').style.display = (fmt === 'pdf') ? 'block' : 'none';
  const linksNote = document.getElementById('daExportLinksNote');
  if (linksNote) linksNote.style.display = (fmt === 'xlsx' || fmt === 'csv') ? 'block' : 'none';
}

function daToggleExportPassword() {
  const on = document.getElementById('daExportPasswordToggle').checked;
  const input = document.getElementById('daExportPasswordInput');
  const hint = document.getElementById('daExportPasswordHint');
  input.style.display = on ? 'block' : 'none';
  hint.style.display = on ? 'block' : 'none';
  if (!on) {
    input.value = '';
    document.getElementById('daExportPasswordError').style.display = 'none';
  } else {
    input.focus();
  }
}

function daExportPasswordChanged() {
  document.getElementById('daExportPasswordError').style.display = 'none';
}

function daExportPickFormat(fmt, el) {
  daApplyExportFormat(fmt);
  document.querySelectorAll('#daExportTypeMenu .pdfed-export-menu-item').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  daCloseExportMenus();
}

function daExportCurrentPreviewDataset() {
  return daState.datasets[daExportPreviewIdx] || daGetActive();
}

function daApplyExportScopeMode(mode) {
  daExportScopeMode = mode;
  const ds = daExportCurrentPreviewDataset();
  document.getElementById('daExportScopeName').textContent = (mode === 'all')
    ? `All tables (${daState.datasets.length})`
    : `Current table${ds ? ', ' + ds.name : ''}`;
  document.getElementById('daExportCurrentRows').textContent = ds ? ds.rows.length : 0;
  document.getElementById('daExportCurrentName').textContent = ds ? ds.name : '—';
  document.getElementById('daExportAllCount').textContent = daState.datasets.length;
}

function daExportPickScope(mode, el) {
  daApplyExportScopeMode(mode);
  document.querySelectorAll('#daExportScopeMenu .pdfed-export-menu-item').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  daCloseExportMenus();
}

function daExportUpdatePreview(idx) {
  const total = daState.datasets.length;
  const wrap = document.getElementById('daExportMiniTableWrap');
  const table = document.getElementById('daExportMiniTable');
  const ds = daState.datasets[idx];

  if (!ds) {
    table.innerHTML = '';
    wrap.innerHTML = '<div class="da-export-mini-table-empty">No table to preview</div>';
  } else {
    if (!wrap.contains(table)) { wrap.innerHTML = ''; wrap.appendChild(table); }
    const cols = ds.headers.slice(0, 6);
    const rows = daComputedRowsForExport(ds).slice(0, 6);
    let html = '<thead><tr>' + cols.map(h => `<th>${daEscHtml(String(h ?? ''))}</th>`).join('') +
      (ds.headers.length > 6 ? '<th>…</th>' : '') + '</tr></thead><tbody>';
    rows.forEach((r, ri) => {
      html += '<tr>' + cols.map((_, ci) => {
        const hasLink = !!(ds.links && ds.links[ri + '_' + ci]);
        return `<td>${hasLink ? '🔗 ' : ''}${daEscHtml(String(r[ci] ?? ''))}</td>`;
      }).join('') +
        (ds.headers.length > 6 ? '<td>…</td>' : '') + '</tr>';
    });
    if (ds.rows.length > 6) html += `<tr><td colspan="${cols.length + (ds.headers.length > 6 ? 1 : 0)}" style="text-align:center;color:#94a3b8">⋯ ${ds.rows.length - 6} more row(s)</td></tr>`;
    html += '</tbody>';
    table.innerHTML = html;
  }

  document.getElementById('daExportPreviewCount').textContent = (total ? (idx + 1) : 0) + ' / ' + total;
  document.getElementById('daExportPreviewLabel').textContent = ds ? ds.name : 'Table —';
  document.getElementById('daExportPrevBtn').disabled = (idx <= 0);
  document.getElementById('daExportNextBtn').disabled = (idx >= total - 1);
}

function daEscHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function daExportPreviewStep(dir) {
  const total = daState.datasets.length;
  const next = daExportPreviewIdx + dir;
  if (next < 0 || next >= total) return;
  daExportPreviewIdx = next;
  daExportUpdatePreview(next);
  // Stepping through tables also updates which one "current table" scope refers to.
  daApplyExportScopeMode(daExportScopeMode);
}

function daBuildCombinedCSV(datasetsArr) {
  const out = datasetsArr.map(ds => `# ${ds.name || 'Table'}\n` + daRowsToCSV(ds.headers, daRowsForCSVWithLinks(ds))).join('\n\n');
  return window.sarvarcApplyFreeWatermark ? (out + '\n\n' + SARVARC_WATERMARK_TEXT) : out;
}

function daDownloadXLSXMulti(datasetsArr, fname) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();
  datasetsArr.forEach(ds => {
    const aoa = [ds.headers, ...daComputedRowsForExport(ds)];
    if (window.sarvarcApplyFreeWatermark) { aoa.push([]); aoa.push([SARVARC_WATERMARK_TEXT]); }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    daApplyLinksToWorksheet(ws, ds);
    let sheetName = (ds.name || 'Sheet').slice(0, 31) || 'Sheet';
    let i = 2;
    while (usedNames.has(sheetName)) { sheetName = (ds.name || 'Sheet').slice(0, 27) + '-' + (i++); }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  XLSX.writeFile(wb, sarvarcBrandFilename(fname));
}

// Truncates text with an ellipsis so it fits a jsPDF column width.
function daTruncateForPdf(pdf, text, maxWidth) {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// Builds a real, paginated jsPDF document out of one or more datasets, no
// html2canvas involved, so it renders as clean vector text/lines rather than
// a screenshot of the dark app UI.
function daBuildPdfDoc(datasetsArr, password) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF(Object.assign({ orientation: 'landscape', unit: 'mm', format: 'a4' }, sarvarcPdfEncryptionOpts(password)));
  const marginX = 12, marginTop = 18, marginBottom = 14;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const usableW = pageW - marginX * 2;
  const rowH = 7, headerRowH = 8;

  datasetsArr.forEach((ds, dsIdx) => {
    if (dsIdx > 0) pdf.addPage();
    let y = marginTop;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(20, 20, 20);
    pdf.text(ds.name || 'Untitled Table', marginX, y - 6);

    const headers = ds.headers && ds.headers.length ? ds.headers : ['Column 1'];
    const rows = daComputedRowsForExport(ds);
    const colCount = headers.length;
    const colW = usableW / colCount;

    function drawHeaderRow(yy) {
      pdf.setFillColor(15, 23, 42);
      pdf.rect(marginX, yy, usableW, headerRowH, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
      headers.forEach((h, ci) => {
        pdf.text(daTruncateForPdf(pdf, String(h ?? ''), colW - 4), marginX + ci * colW + 2, yy + headerRowH - 2.6);
      });
    }

    drawHeaderRow(y);
    y += headerRowH;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(20, 20, 20);

    if (!rows.length) {
      pdf.setFont('helvetica', 'italic'); pdf.setTextColor(120, 120, 120);
      pdf.text('No rows in this table', marginX + 2, y + 5);
    }

    rows.forEach((r, ri) => {
      if (y + rowH > pageH - marginBottom) {
        pdf.addPage();
        y = marginTop;
        drawHeaderRow(y);
        y += headerRowH;
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(20, 20, 20);
      }
      if (ri % 2 === 1) { pdf.setFillColor(245, 247, 250); pdf.rect(marginX, y, usableW, rowH, 'F'); }
      pdf.setDrawColor(220, 224, 230);
      pdf.rect(marginX, y, usableW, rowH);
      for (let ci = 1; ci < colCount; ci++) pdf.line(marginX + ci * colW, y, marginX + ci * colW, y + rowH);
      for (let ci = 0; ci < colCount; ci++) {
        const v = r[ci];
        pdf.text(daTruncateForPdf(pdf, String(v ?? ''), colW - 4), marginX + ci * colW + 2, y + rowH - 2.4);
      }
      y += rowH;
    });
  });

  return pdf;
}

async function daExportPDFFile(datasetsArr, fname, password) {
  if (!window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  try {
    const pdf = daBuildPdfDoc(datasetsArr, password);
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    toast('PDF exported' + (password ? ' (password protected)' : ''), 'success');
  } catch (e) {
    toast('PDF export failed: ' + e.message, 'error');
    console.error(e);
  }
}

// Reuses the PDF editor's generic docx table builder (pdfedBuildDocxTableXml /
// pdfedXmlEscape / pdfedDownloadBlob), which produces a real OOXML .docx via JSZip.
async function daExportDOCXFile(datasetsArr, fname) {
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  try {
    let bodyXml = '';
    datasetsArr.forEach((ds, idx) => {
      if (idx > 0) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      bodyXml += `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${pdfedXmlEscape(ds.name || 'Table')}</w:t></w:r></w:p>`;
      const aoa = [ds.headers || [], ...daComputedRowsForExport(ds)];
      bodyXml += pdfedBuildDocxTableXml(aoa);
      bodyXml += '<w:p/>';
    });
    if (window.sarvarcApplyFreeWatermark) bodyXml += sarvarcDocxWatermarkXml(297, 210);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}` +
      `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    zip.folder('word').file('document.xml', documentXml);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    pdfedDownloadBlob(blob, fname);
    toast('Word document exported', 'success');
  } catch (e) {
    toast('Word export failed: ' + e.message, 'error');
    console.error(e);
  }
}

async function daRunExportFromModal() {
  const ds = daExportCurrentPreviewDataset();
  const datasetsArr = (daExportScopeMode === 'all') ? daState.datasets : (ds ? [ds] : []);
  if (!datasetsArr.length) { toast('Nothing to export yet', 'info'); return; }

  const baseName = (daExportScopeMode === 'all') ? 'sarvarc_data_export' : (ds.name || 'data');

  let exportPassword = null;
  if (daExportModalFmt === 'pdf' && document.getElementById('daExportPasswordToggle').checked) {
    const pw = document.getElementById('daExportPasswordInput').value;
    if (!pw) {
      const perr = document.getElementById('daExportPasswordError');
      perr.textContent = 'Enter a password, or untick password protection';
      perr.style.display = 'block';
      return;
    }
    exportPassword = pw;
  }

  try {
    const remember = document.getElementById('daExportRemember').checked;
    if (remember) localStorage.setItem('sarvarcDaExportPrefs', JSON.stringify({ remember: true, fmt: daExportModalFmt }));
    else localStorage.removeItem('sarvarcDaExportPrefs');
  } catch (e) {}

  daCloseExportModal();

  if (daExportModalFmt === 'csv') {
    if (datasetsArr.length === 1) {
      daDownloadCSV(datasetsArr[0]);
    } else {
      const blob = new Blob(['\uFEFF' + daBuildCombinedCSV(datasetsArr)], { type: 'text/csv;charset=utf-8;' });
      pdfedDownloadBlob(blob, baseName + '.csv');
      toast(`CSV exported (${datasetsArr.length} tables)`, 'success');
    }
  } else if (daExportModalFmt === 'xlsx') {
    if (datasetsArr.length === 1) daDownloadXLSX(datasetsArr[0]);
    else { daDownloadXLSXMulti(datasetsArr, baseName + '.xlsx'); toast(`Excel exported (${datasetsArr.length} sheets)`, 'success'); }
  } else if (daExportModalFmt === 'pdf') {
    await daExportPDFFile(datasetsArr, baseName + '.pdf', exportPassword);
  } else if (daExportModalFmt === 'docx') {
    await daExportDOCXFile(datasetsArr, baseName + '.docx');
  }

  if (typeof state !== 'undefined' && state.stats) { state.stats.exports = (state.stats.exports || 0) + 1; if (typeof updateStats === 'function') updateStats(); }
}
