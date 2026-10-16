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
const WSF_DAILY_LIMIT = 5;                       // builds per person per day
const WSF_USAGE_KEY = 'sarvarcWorkstyleUsage_v1';  // account-scoped by the shim in js/03
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

// ─── 2. THE FILL FOR WHEN THE ENGINE CANNOT BE REACHED ───────────────────────
// No AI here, only simple rules that read the shape of the reference's slots:
//   - lines that look like rows (tabs, | or several commas) go to the first table
//   - email, phone and web lines go to slots whose sample words are contact details
//   - short heading-like lines go to title / heading / subheading slots
//   - the lines after a heading go to the body slot that follows it
//   - the footer slot gets a footer-like line (copyright, page, thanks) if there is one
// It cannot judge meaning, so the result is still marked "check it" in the message.
function wsfSplitRow(line) {
  if (line.indexOf('\t') !== -1) return line.split('\t').map(function (x) { return x.trim(); });
  if (line.indexOf('|') !== -1) return line.split('|').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return !(x === '' && (i === 0 || i === a.length - 1)); });
  if (line.indexOf(',') !== -1) return line.split(',').map(function (x) { return x.trim(); });
  return [line];
}

const WSF_RE_EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const WSF_RE_PHONE = /(\+?\d[\d\s\-().]{7,}\d)/;
const WSF_RE_WEB = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|in|co|org|net|io|app)\b/i;
const WSF_RE_FOOTER = /(©|\(c\)|copyright|all rights|thank you|thanks|page\s*\d|terms|powered by)/i;

function wsfIsContact(t) { return WSF_RE_EMAIL.test(t) || WSF_RE_PHONE.test(t) || WSF_RE_WEB.test(t); }

// A heading-like line is short, has no closing full stop, and is not a row or a contact line.
function wsfIsHeading(t) {
  if (!t || t.length > 60) return false;
  if (/[.!?]$/.test(t)) return false;
  if (wsfIsContact(t)) return false;
  if (wsfSplitRow(t).length > 1 && t.indexOf(',') === -1) return false;
  return true;
}

function wsfLocalFill(slots, content) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const tableSlots = slots.filter(function (s) { return s.kind === 'table'; });
  const fills = [];

  // 1. The longest run of consecutive lines that split into the same number (2 or more) of cells.
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

  // 2. Pull out contact lines and footer lines for the slots that look like them.
  const textSlots = slots.filter(function (s) { return s.kind === 'text'; });
  const contactSlots = textSlots.filter(function (s) { return s.role !== 'footer' && wsfIsContact(s.sample || ''); });
  const footerSlots = textSlots.filter(function (s) { return s.role === 'footer'; });
  const contactLines = contactSlots.length ? rest.filter(wsfIsContact) : [];
  rest = rest.filter(function (l) { return contactLines.indexOf(l) === -1; });
  const footerLines = footerSlots.length ? rest.filter(function (l) { return WSF_RE_FOOTER.test(l) && l.length < 100; }) : [];
  rest = rest.filter(function (l) { return footerLines.indexOf(l) === -1; });

  const used = {};
  contactSlots.forEach(function (s, k) {
    if (!contactLines.length) return;
    const take = (k === contactSlots.length - 1) ? contactLines.splice(0) : contactLines.splice(0, Math.max(1, s.lines));
    fills.push({ id: s.id, text: take.join('\n') }); used[s.id] = 1;
  });
  footerSlots.forEach(function (s, k) {
    if (!footerLines.length) return;
    const take = (k === footerSlots.length - 1) ? footerLines.splice(0) : footerLines.splice(0, Math.max(1, s.lines));
    fills.push({ id: s.id, text: take.join('\n') }); used[s.id] = 1;
  });

  // 3. Headings and body in reading order.
  const flow = textSlots.filter(function (s) { return !used[s.id]; });
  const isHeadRole = function (r) { return r === 'title' || r === 'heading' || r === 'subheading'; };
  const lastBody = (function () { for (let i = flow.length - 1; i >= 0; i--) if (!isHeadRole(flow[i].role)) return flow[i].id; return null; })();
  let at = 0;
  flow.forEach(function (s) {
    if (at >= rest.length) return;
    if (isHeadRole(s.role)) {
      // a heading slot takes one line, a multi-line one (a title over two lines) takes up to its own count
      const want = Math.max(1, s.lines);
      const take = [];
      while (take.length < want && at < rest.length && (take.length === 0 || wsfIsHeading(rest[at]))) { take.push(rest[at]); at++; }
      fills.push({ id: s.id, text: take.join('\n') });
      return;
    }
    // a body slot takes lines until the next heading-like line, but never fewer than one
    const isLast = s.id === lastBody;
    let take = [];
    if (isLast) { take = rest.slice(at); at = rest.length; }
    else {
      const cap = Math.max(s.lines * 3, 3);
      while (at < rest.length && take.length < cap && (take.length < s.lines || !wsfIsHeading(rest[at]))) { take.push(rest[at]); at++; }
    }
    if (take.length) fills.push({ id: s.id, text: take.join('\n') });
  });

  // 4. Anything still unplaced goes after the last body slot's text so no words are lost.
  if (at < rest.length && lastBody) {
    const f = fills.filter(function (x) { return x.id === lastBody; })[0];
    const more = rest.slice(at).join('\n');
    if (f) f.text += '\n' + more; else fills.push({ id: lastBody, text: more });
  }
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

// ─── DAILY LIMIT: 5 builds a day ─────────────────────────────────────────────
// Counted on this device per account (the day changes at local midnight). The Worker counts the same
// 5 a day for signed-in people (kadessa-backend/worker.js, supabase/06-workstyle-usage.sql), so clearing
// browser data does not give extra builds when the engine is used.
function wsfToday() {
  try { return new Date().toLocaleDateString('en-CA'); } catch (e) { return new Date().toISOString().slice(0, 10); }
}
function wsfUsageRead() {
  try {
    const u = JSON.parse(localStorage.getItem(WSF_USAGE_KEY) || 'null');
    if (u && u.day === wsfToday() && Number(u.n) >= 0) return { day: u.day, n: Number(u.n) };
  } catch (e) { /* fall through */ }
  return { day: wsfToday(), n: 0 };
}
function wsfBuildsLeft() { return Math.max(0, WSF_DAILY_LIMIT - wsfUsageRead().n); }
function wsfCountBuild() {
  const u = wsfUsageRead();
  u.n += 1;
  try { localStorage.setItem(WSF_USAGE_KEY, JSON.stringify(u)); } catch (e) { /* no room: the Worker still counts */ }
  return Math.max(0, WSF_DAILY_LIMIT - u.n);
}
function wsfLimitMessage() {
  return 'You have used all ' + WSF_DAILY_LIMIT + ' Workstyle builds for today. It opens again tomorrow';
}

// ─── 4. THE WHOLE THING ──────────────────────────────────────────────────────
// ref: { styleId } for a saved reference. content: the person's words.
async function wstyleBuildFromContent(styleId, content, opts) {
  opts = opts || {};
  if (wsfBuildsLeft() <= 0) { const le = new Error(wsfLimitMessage()); le.limit = true; throw le; }
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
    ? ' Kadessa\'s engine could not be reached (' + ans.why + '), so your lines were matched to the reference by simple rules (headings, contact lines, footer, rows) and not by meaning. Check the result.'
    : '';
  const left = (r.left === null || r.left === undefined) ? wsfBuildsLeft() : r.left;   // counted inside wstyleBuild (js/62)
  const leftSay = ' ' + left + ' of ' + WSF_DAILY_LIMIT + ' Workstyle builds left today.';
  return { say: r.say + via + (ans.note ? ' ' + ans.note : '') + leftSay, via: ans.via, skipped: r.skipped, left: left };
}
