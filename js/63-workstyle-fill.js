// ─── WORKSTYLE: REFERENCE + MY CONTENT -> SAME LOOK, NEW WORDS ───────────────
// The person gives two things: a reference (a PDF, or the document open in the
// editor) and their own content (typed, pasted or attached as a text file).
// Kadessa's engine reads BOTH together: the reference tells her what every part
// of the page is for and how it is written (a name, a tagline, a list of items,
// a contact line, a footer), the content tells her what to put there. She then
// builds the same format with the new content, live in the editor (js/62).
//
// Nothing here knows about menus, invoices or any other kind of document. The
// reference is the only template: its parts become "slots", each with its own
// sample words, and the engine fills the slots.
//
//   wsfBlueprint(style)            the slots of a reference, with sample words
//   wsfAsk(blueprint, content)     the engine (Worker mode workstyle_fill); if it
//                                  cannot be reached, a plain line-by-line fill
//   wstyleBuildFromContent(...)    the whole thing: reference + content -> pages
//
// Privacy: the reference's words and the content are sent to Kadessa's engine
// only when the person presses Build, only for that one request, and nothing is
// stored there. The panel says so.

const WSF_MAX_CONTENT = 24000;
const WSF_SAMPLE_CHARS = 400;

function wsfClean(v) { return String(v == null ? '' : v).replace(/\s+$/g, ''); }

// ─── 1. THE REFERENCE AS SLOTS ───────────────────────────────────────────────
// Slot ids are "p<page>s<index>", the same ids the build plan (js/62) answers to.
function wsfBlueprint(style) {
  const slots = [];
  (style.pages || []).forEach(function (sp, pi) {
    (sp.items || []).forEach(function (it, si) {
      const id = 'p' + (pi + 1) + 's' + si;
      if (it.kind === 'text') {
        const t = wsfClean(it.text);
        if (!t.trim()) return;
        slots.push({ id: id, role: it.role, kind: 'text', sample: t.slice(0, WSF_SAMPLE_CHARS), lines: t.split('\n').length });
      } else if (it.kind === 'table') {
        const cells = Array.isArray(it.cells) ? it.cells : [];
        if (!cells.length) return;
        const hasHead = !!it.headerRow;
        slots.push({ id: id, role: 'table', kind: 'table', cols: it.cols || (cells[0] || []).length,
          headers: hasHead ? (cells[0] || []).map(wsfClean) : [],
          sampleRows: cells.slice(hasHead ? 1 : 0, (hasHead ? 1 : 0) + 3).map(function (r) { return (r || []).map(wsfClean); }) });
      }
      // image slots carry no words, they are placed as they are
    });
  });
  return slots;
}

// ─── 2. A PLAIN FILL FOR WHEN THE ENGINE CANNOT BE REACHED ───────────────────
// Not smart: it splits the content into lines and hands them to the slots in order.
// Lines that look like rows (tabs, | or several commas) go to the first table.
function wsfSplitRow(line) {
  if (line.indexOf('\t') !== -1) return line.split('\t').map(function (x) { return x.trim(); });
  if (line.indexOf('|') !== -1) return line.split('|').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return !(x === '' && (i === 0 || i === a.length - 1)); });
  if (line.indexOf(',') !== -1) return line.split(',').map(function (x) { return x.trim(); });
  return [line];
}

function wsfLocalFill(slots, content) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const tableSlots = slots.filter(function (s) { return s.kind === 'table'; });
  const textSlots = slots.filter(function (s) { return s.kind === 'text'; });
  const fills = [];

  // Longest run of consecutive lines that split into the same number (2 or more) of cells.
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const n = wsfSplitRow(lines[i]).length;
    if (n < 2) continue;
    let j = i;
    while (j + 1 < lines.length && wsfSplitRow(lines[j + 1]).length === n) j++;
    const len = j - i + 1;
    const commaOnly = lines[i].indexOf('\t') === -1 && lines[i].indexOf('|') === -1;
    if (len >= (commaOnly ? 3 : 2) && (!best || len > best.len)) best = { from: i, to: j, len: len };
    i = j;
  }
  let rest = lines;
  if (best && tableSlots.length) {
    const rows = lines.slice(best.from, best.to + 1).map(wsfSplitRow);
    const t = tableSlots[0];
    const out = { id: t.id, rows: rows };
    if (t.headers && t.headers.length) { out.headers = rows[0]; out.rows = rows.slice(1); }
    fills.push(out);
    rest = lines.slice(0, best.from).concat(lines.slice(best.to + 1));
  }

  let at = 0;
  textSlots.forEach(function (s, k) {
    if (at >= rest.length) return;
    const last = k === textSlots.length - 1;
    const take = last ? rest.length - at : Math.max(1, Math.min(s.lines, rest.length - at));
    fills.push({ id: s.id, text: rest.slice(at, at + take).join('\n') });
    at += take;
  });
  return fills;
}

// ─── 3. ASK THE ENGINE ───────────────────────────────────────────────────────
// Returns { fills, note, via: 'kadessa' | 'basic', why? }. Never throws for a network or
// service problem, it falls back to the plain fill and says so. It does throw when the
// person has used up today's messages, because a plain fill would hide that.
async function wsfAsk(slots, content) {
  const call = (typeof window !== 'undefined') ? window.kadessaWorkstyleFillCall : null;
  if (typeof call !== 'function') {
    return { fills: wsfLocalFill(slots, content), note: '', via: 'basic', why: 'Kadessa is not ready yet' };
  }
  try {
    const r = await call(slots, content);
    const fills = Array.isArray(r && r.fills) ? r.fills : [];
    if (!fills.length) throw new Error('she found nothing in your content to put into this reference');
    return { fills: fills, note: String((r && r.note) || ''), via: 'kadessa' };
  } catch (e) {
    if (e && e.limit) throw e;
    return { fills: wsfLocalFill(slots, content), note: '', via: 'basic', why: (e && e.message) ? String(e.message) : 'the engine could not be reached' };
  }
}

// ─── 4. THE WHOLE THING ──────────────────────────────────────────────────────
// ref: { styleId } for a saved reference. content: the person's words.
async function wstyleBuildFromContent(styleId, content, opts) {
  opts = opts || {};
  const style = wstyleGet(styleId);
  if (!style) throw new Error('that reference is no longer saved, add it again');
  const text = String(content || '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('add your content first, type or paste it, or attach a text file');
  if (text.length > WSF_MAX_CONTENT) throw new Error('that is more than I can place in one go (' + WSF_MAX_CONTENT + ' characters). Split it and build in parts');
  const slots = wsfBlueprint(style);
  if (!slots.length) throw new Error('the reference has no text or tables to fill, so there is nothing to build from');

  if (typeof opts.onStage === 'function') opts.onStage('Kadessa is reading your reference and your content…');
  const ans = await wsfAsk(slots, text);
  if (typeof opts.onStage === 'function') opts.onStage('Building in the editor…');
  const r = await wstyleBuild(style.id, { fill: ans.fills });
  const via = ans.via === 'basic'
    ? ' Kadessa\'s engine could not be reached (' + ans.why + '), so your lines were placed in order without matching them to the reference. Check the result.'
    : '';
  return { say: r.say + via + (ans.note ? ' ' + ans.note : ''), via: ans.via, skipped: r.skipped };
}
