// ─── DATA ARRANGEMENT: SALES PIPELINE PACK ───────────────────────────────────────────────
// One click creates Campaigns, Leads, Quotations, Payments and a Pipeline Summary, already
// connected. The person never picks a key column or builds a link.
//   - Lead ID in Quotations and Payments is a dropdown fed by Leads (Interconnect link).
//   - Name, Company and Balance due come in by themselves (XLOOKUP, via daApplyLink).
//   - Leads counts quotes and adds up quoted, won and paid money (COUNTIF / SUMIF).
//   - Campaigns counts leads, won deals and revenue, then works out cost per lead and return.
//   - Pipeline Summary reads everything above. Nothing on it is typed.
// Only existing building blocks are used (daCreateTableWithColumns, daApplyLink, COUNTIF,
// SUMIF, IF, AND, XLOOKUP), and it works only while the "Interconnect tables" switch is ON, so the engine, undo, live co-editing and saving all work as before.
// Auto columns are stored as formula templates in ds.pipeF ({r} = row number), so rows added
// later get their formulas filled in the same way connected columns already do.

const DA_PIPE_N = 1048576; // whole column; ranges are clamped to the table's real rows

function daPipeRng(t, c) { const L = daColToLetters(c); return "'" + t.name + "'!" + L + '1:' + L + DA_PIPE_N; }

function daPipeSample() {
  return {
    camp: [['C-1', 'Instagram ads', 15000], ['C-2', 'Google ads', 25000], ['C-3', 'Referral', 2000], ['C-4', 'LinkedIn', 12000]],
    leads: [['L-101', 'Meera Shah', 'Shah Interiors', 'C-1'], ['L-102', 'Karan Patel', 'Patel Logistics', 'C-2'], ['L-103', 'Anita Desai', 'Desai Clinic', 'C-3'],
      ['L-104', 'Rohan Mehta', 'Mehta Traders', 'C-1'], ['L-105', 'Sana Khan', 'Khan Studio', 'C-4'], ['L-106', 'Vikram Rao', 'Rao Exports', 'C-2']],
    quo: [['Q-1', 'L-101', 85000, 'Accepted'], ['Q-2', 'L-102', 120000, 'Accepted'], ['Q-3', 'L-102', 30000, 'Sent'], ['Q-4', 'L-104', 60000, 'Rejected'], ['Q-5', 'L-105', 45000, 'Sent']],
    pay: [['P-1', 'L-101', 50000], ['P-2', 'L-102', 40000]]
  };
}

// Fill the typed columns of a table from sample rows, leaving the rest blank.
function daPipeFill(t, data, total) {
  const w = t.headers.length;
  while (t.rows.length < total) t.rows.push(new Array(w).fill(''));
  data.forEach((r, i) => { r.forEach((v, c) => { t.rows[i][c] = v; }); });
}

// Write every auto column of a table once, and remember the templates for new rows.
function daPipeAuto(t, cols) {
  t.pipeF = cols.map(c => ({ col: c.col, tpl: c.tpl }));
  cols.forEach(c => t.rows.forEach((r, ri) => { while (r.length <= c.col) r.push(''); r[c.col] = c.tpl.replace(/\{r\}/g, String(ri + 1)); }));
}

function daCreatePipelinePack(withExample) {
  if (typeof daCreateTableWithColumns !== 'function') throw new Error('Data Arrangement is not ready');
  // Interconnect is the person's switch. The pack never turns it on; it is only offered while it is on.
  if (!daState.interconnect) throw new Error('switch on "Interconnect tables" first');
  const sample = withExample ? daPipeSample() : { camp: [], leads: [], quo: [], pay: [] };
  const mk = (name, cols, rows, dd) => daCreateTableWithColumns(name, cols, rows, dd);

  const camp = mk('Campaigns', ['Campaign ID', 'Campaign', 'Cost', 'Leads', 'Won deals', 'Won revenue', 'Cost per lead', 'Return %'], 8);
  const leads = mk('Leads', ['Lead ID', 'Name', 'Company', 'Source', 'Stage', 'Quotes', 'Quoted', 'Won', 'Paid', 'Balance due', 'Won deal'], 30);
  const quo = mk('Quotations', ['Quote ID', 'Lead ID', 'Amount', 'Status', 'Won amount'], 40, [{ colIdx: 3, options: ['Sent', 'Accepted', 'Rejected'] }]);
  const pay = mk('Payments', ['Payment ID', 'Lead ID', 'Amount'], 30);
  const sum = mk('Pipeline Summary', ['Metric', 'Value'], 11);

  daPipeFill(camp, sample.camp, 8); daPipeFill(leads, sample.leads, 30); daPipeFill(quo, sample.quo, 40); daPipeFill(pay, sample.pay, 30);

  // Quotations: a quote counts as won money only when its status is Accepted.
  daPipeAuto(quo, [{ col: 4, tpl: '=IF(B{r}="","",IF(D{r}="Accepted",C{r},0))' }]);

  // Leads: counts and money come from Quotations and Payments.
  const QB = daPipeRng(quo, 1), QC = daPipeRng(quo, 2), QE = daPipeRng(quo, 4), PB = daPipeRng(pay, 1), PC = daPipeRng(pay, 2);
  daPipeAuto(leads, [
    { col: 5, tpl: '=IF(A{r}="","",COUNTIF(' + QB + ',A{r}))' },
    { col: 6, tpl: '=IF(A{r}="","",SUMIF(' + QB + ',A{r},' + QC + '))' },
    { col: 7, tpl: '=IF(A{r}="","",SUMIF(' + QB + ',A{r},' + QE + '))' },
    { col: 8, tpl: '=IF(A{r}="","",SUMIF(' + PB + ',A{r},' + PC + '))' },
    { col: 9, tpl: '=IF(A{r}="","",H{r}-I{r})' },
    { col: 10, tpl: '=IF(A{r}="","",IF(H{r}>0,1,0))' },
    { col: 4, tpl: '=IF(A{r}="","",IF(AND(H{r}>0,I{r}>=H{r}),"Paid",IF(H{r}>0,"Won",IF(F{r}>0,"Quoted","New"))))' }
  ]);

  // Campaigns: counts and returns come from Leads.
  const LD = daPipeRng(leads, 3), LH = daPipeRng(leads, 7), LK = daPipeRng(leads, 10);
  daPipeAuto(camp, [
    { col: 3, tpl: '=IF(A{r}="","",COUNTIF(' + LD + ',A{r}))' },
    { col: 4, tpl: '=IF(A{r}="","",SUMIF(' + LD + ',A{r},' + LK + '))' },
    { col: 5, tpl: '=IF(A{r}="","",SUMIF(' + LD + ',A{r},' + LH + '))' },
    { col: 6, tpl: '=IF(A{r}="","",IF(D{r}=0,0,ROUND(C{r}/D{r},0)))' },
    { col: 7, tpl: '=IF(A{r}="","",IF(C{r}=0,0,ROUND((F{r}-C{r})/C{r}*100,0)))' }
  ]);

  // The connections: dropdowns and pulled-in details. Parents first.
  daApplyLink(leads, camp, 3, 0, [1]);   // Source -> Campaign ID, brings the campaign name
  daApplyLink(quo, leads, 1, 0, [1, 2]);  // Lead ID -> Name, Company
  daApplyLink(pay, leads, 1, 0, [1, 9]);  // Lead ID -> Name, Balance due

  // Pipeline Summary: reads the other tabs, nothing typed.
  const LE = daPipeRng(leads, 4), LF = daPipeRng(leads, 5), LI = daPipeRng(leads, 8), LA = daPipeRng(leads, 0), CC = daPipeRng(camp, 2), CH = daPipeRng(camp, 7), CB = daPipeRng(camp, 1);
  const m = [
    ['Total leads', '=COUNTA(' + LA + ')'],
    ['Leads quoted', '=COUNTIF(' + LF + ',">0")'],
    ['Leads won', '=SUM(' + LK + ')'],
    ['Leads fully paid', '=COUNTIF(' + LE + ',"Paid")'],
    ['Lead to won %', '=IF(B1=0,0,ROUND(B3/B1*100,1))'],
    ['Won revenue', '=SUM(' + LH + ')'],
    ['Collected', '=SUM(' + LI + ')'],
    ['Still to collect', '=B6-B7'],
    ['Marketing spend', '=SUM(' + CC + ')'],
    ['Cost per won deal', '=IF(B3=0,0,ROUND(B9/B3,0))'],
    ['Best campaign by return', '=IF(B9=0,"",XLOOKUP(MAX(' + CH + '),' + CH + ',' + CB + ',""))']
  ];
  m.forEach((r, i) => { sum.rows[i][0] = r[0]; sum.rows[i][1] = r[1]; });

  // Kadessa reads these notes as "told" facts, so she knows what each tab is for.
  leads.note = 'Pipeline pack: one row per lead. Stage, quotes and money columns are calculated from Quotations and Payments. Source is a Campaign ID.';
  quo.note = 'Pipeline pack: one row per quotation. Lead ID comes from Leads. Won amount counts only when Status is Accepted.';
  pay.note = 'Pipeline pack: one row per payment received. Lead ID comes from Leads.';
  camp.note = 'Pipeline pack: one row per marketing campaign. Only Cost is typed; leads, won deals, revenue, cost per lead and return come from Leads.';
  sum.note = 'Pipeline pack: calculated overview of the whole pipeline. Nothing here is typed.';

  daState.datasets.forEach(d => { d._calcCache = new Map(); });
  daState.activeId = sum.id;
  daPersist(); daRenderTabs(); daRenderTable();
  if (typeof toast === 'function') toast('Sales pipeline ready: five connected tabs. Type in Leads, Quotations and Payments and everything else updates.', 'success');
  return { leads, quo, pay, camp, sum };
}

// Rows added later: fill any empty auto cell from its template.
function daPipeHeal() {
  let changed = false;
  daState.datasets.forEach(ds => (ds.pipeF || []).forEach(f => ds.rows.forEach((r, ri) => {
    if (String(r[f.col] == null ? '' : r[f.col]) === '') { while (r.length <= f.col) r.push(''); r[f.col] = f.tpl.replace(/\{r\}/g, String(ri + 1)); changed = true; }
  })));
  if (changed) daPersist();
}
const _daRenderTablePipe = daRenderTable;
daRenderTable = function () {
  if (daState.interconnect) { try { daPipeHeal(); } catch (e) { console.warn('[Pipeline] row fill failed', e); } }
  return _daRenderTablePipe.apply(this, arguments);
};

// Button next to the Interconnect switch. It is shown only while the switch is ON (like Connect columns).
function daPipeDialog() {
  const ov = document.createElement('div'); ov.className = 'da-xdlg';
  ov.innerHTML = '<div><b>Sales pipeline</b><span style="color:var(--text2)">Creates Campaigns, Leads, Quotations, Payments and a Pipeline Summary, already connected. You only type in the white columns.</span>' +
    '<div class="row"><button type="button" data-k="no">Cancel</button><button type="button" data-k="empty">Start empty</button><button type="button" data-k="ex" style="background:var(--blue);color:#fff;border:0">With example data</button></div></div>';
  ov.querySelectorAll('button').forEach(b => { b.style.cssText += 'font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--border);cursor:pointer;' + (b.dataset.k === 'ex' ? 'background:var(--blue);color:#fff;border:0;' : 'background:var(--surface2);color:var(--text);'); });
  ov.onclick = (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (e.target === ov || k === 'no') { ov.remove(); return; }
    if (k) { ov.remove(); try { daCreatePipelinePack(k === 'ex'); } catch (err) { if (typeof toast === 'function') toast('Could not create the pipeline: ' + err.message, 'error'); } }
  };
  document.body.appendChild(ov);
}
const _daRenderTabsPipe = daRenderTabs;
daRenderTabs = function () {
  _daRenderTabsPipe.apply(this, arguments);
  const box = document.querySelector('#daTabs .da-xsw');
  const old = box && box.querySelector('.da-pipe');
  if (old && !daState.interconnect) old.remove();
  if (box && daState.interconnect && !old) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'da-pipe'; b.textContent = 'Sales pipeline\u2026';
    b.title = 'Create five connected tabs: Campaigns, Leads, Quotations, Payments, Pipeline Summary'; b.onclick = daPipeDialog; box.insertBefore(b, box.firstChild);
  }
};
