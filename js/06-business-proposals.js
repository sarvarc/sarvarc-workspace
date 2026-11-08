// BRAND KIT STORAGE + KADESSA REPORT HELPERS
// The old Business Proposals module (generic skins, the template picker and the
// proposal canvas builder) was removed on 2026-11-08. This file name is kept so the
// load order and numbering do not change. What is left:
//   1. bkLoad / bkSave: the saved Brand Kit. It is edited ONLY in Settings > Brand Kit (js/84).
//   2. Kadessa helpers that turn a Word/PDF report in Data Arrangement into pages.

// ── BRAND KIT ─────────────────────────────────────────────────────────
// One saved identity (logo, company name, slogan, address, phone, email, website, GST)
// that Workstyle and the slide templates can fill in for the user (see js/85).
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
