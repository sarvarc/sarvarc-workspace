// =========================================================
// TEAM NOTES
//   1. Shared notes list  - one list everyone in a live session sees and
//      ticks off. Lives in the live session's shared document, so it only
//      exists while people are connected. Separate from the private
//      "My Notes" list, which stays on your own device.
//   2. Sticky notes       - small notes pinned on a page. They are stored on
//      the page like other placed items (kind 'placedNotes'), so the PDF
//      Editor's live sync carries them to teammates. They are NOT part of
//      the page picture and are never exported.
// Who may change notes follows the same rule as the rest of the live
// session: owners, admins and editors can; viewers and reviewers can read.
// =========================================================
const SARVARC_STICKY_COLORS = ['#FFF3A3', '#CDF2D4', '#CFE6FF', '#FFD9E4', '#E5D8FF'];
let sarvarcTeamNotesMap = null;      // Y.Map while connected to a live session
let sarvarcTeamNotesAttachedAt = 0;
let pdfedStickyHidden = false;       // this person's own "hide notes" view switch
let pdfedStickySaveTimer = null;

function sarvarcTeamNotesEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sarvarcTeamNotesCanEdit() {
  const live = typeof sarvarcCollabIsLive === 'function' && sarvarcCollabIsLive();
  if (!live) return true;
  return typeof sarvarcCollabMayEditNow === 'function' ? !!sarvarcCollabMayEditNow() : false;
}

function sarvarcTeamNotesGuard() {
  if (sarvarcTeamNotesCanEdit()) return true;
  if (typeof toast === 'function') toast('View only: your role cannot change team notes.', 'info');
  return false;
}

function sarvarcTeamNotesMe() {
  const id = window.__sarvarcUid || null;
  const cache = (typeof sarvarcTeamMembersCache !== 'undefined') ? sarvarcTeamMembersCache : {};
  const m = id && cache[id];
  return { id: id, name: (m && (m.full_name || m.email)) || 'A teammate' };
}

// ── 1. Shared notes list ────────────────────────────────────────────────
function sarvarcTeamNotesItems() {
  const out = [];
  if (!sarvarcTeamNotesMap) return out;
  sarvarcTeamNotesMap.forEach((v) => { if (v && typeof v === 'object' && typeof v.text === 'string') out.push(v); });
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

function sarvarcTeamNotesKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); sarvarcTeamNotesAdd(); }
}

function sarvarcTeamNotesAdd() {
  const input = document.getElementById('sarvarcTeamNoteInput');
  if (!input || !sarvarcTeamNotesMap || !sarvarcTeamNotesGuard()) return;
  const text = (input.value || '').trim().slice(0, 500);
  if (!text) return;
  const me = sarvarcTeamNotesMe();
  const id = 'tn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  sarvarcTeamNotesMap.set(id, { id: id, text: text, done: false, ts: Date.now(), by: me.id, byName: me.name });
  input.value = '';
  sarvarcTeamNotesRender();
  input.focus();
}

function sarvarcTeamNotesToggle(id) {
  if (!sarvarcTeamNotesMap || !sarvarcTeamNotesGuard()) return;
  const n = sarvarcTeamNotesMap.get(id);
  if (!n) return;
  sarvarcTeamNotesMap.set(id, Object.assign({}, n, { done: !n.done }));
  sarvarcTeamNotesRender();
}

function sarvarcTeamNotesDelete(id) {
  if (!sarvarcTeamNotesMap || !sarvarcTeamNotesGuard()) return;
  sarvarcTeamNotesMap.delete(id);
  sarvarcTeamNotesRender();
}

function sarvarcTeamNotesClearDone() {
  if (!sarvarcTeamNotesMap || !sarvarcTeamNotesGuard()) return;
  const keys = [];
  sarvarcTeamNotesMap.forEach((v, k) => { if (v && v.done) keys.push(k); });
  const run = () => keys.forEach((k) => sarvarcTeamNotesMap.delete(k));
  if (sarvarcTeamNotesMap.doc) sarvarcTeamNotesMap.doc.transact(run); else run();
  sarvarcTeamNotesRender();
}

function sarvarcTeamNotesRender() {
  const box = document.getElementById('sarvarcTeamNotesBox');
  if (!box) return;
  const live = !!sarvarcTeamNotesMap;
  box.style.display = live ? '' : 'none';
  if (!live) return;
  const listEl = document.getElementById('sarvarcTeamNotesList');
  const footEl = document.getElementById('sarvarcTeamNotesFooter');
  const countEl = document.getElementById('sarvarcTeamNotesCount');
  const inputRow = document.getElementById('sarvarcTeamNotesInputRow');
  if (inputRow) inputRow.style.display = sarvarcTeamNotesCanEdit() ? '' : 'none';
  const list = sarvarcTeamNotesItems();
  const pending = list.filter((n) => !n.done).length;
  if (!list.length) {
    listEl.innerHTML = '<div class="pdfed-notes-empty">No team notes yet.<br>Anything added here is seen by everyone in this live session.</div>';
    footEl.style.display = 'none';
    return;
  }
  listEl.innerHTML = list.map((n) => `
    <div class="pdfed-note-item ${n.done ? 'done' : ''}" data-id="${sarvarcTeamNotesEsc(n.id)}">
      <div class="pdfed-note-check" data-act="toggle"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="pdfed-note-text">${sarvarcTeamNotesEsc(n.text)}<div class="sarvarc-tnote-by">${sarvarcTeamNotesEsc(n.byName || 'A teammate')}</div></div>
      <div class="pdfed-note-del" data-act="delete" title="Delete note"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
    </div>`).join('');
  const done = list.length - pending;
  countEl.textContent = pending === 0 ? 'All caught up, ' + done + ' done' : pending + ' to go · ' + done + ' done';
  footEl.style.display = 'flex';
}

(function sarvarcTeamNotesWire() {
  const wire = () => {
    const listEl = document.getElementById('sarvarcTeamNotesList');
    if (listEl && !listEl.__tnWired) {
      listEl.__tnWired = true;
      listEl.addEventListener('click', (e) => {
        const act = e.target.closest && e.target.closest('[data-act]');
        const row = e.target.closest && e.target.closest('.pdfed-note-item');
        if (!act || !row) return;
        const id = row.getAttribute('data-id');
        if (act.getAttribute('data-act') === 'toggle') sarvarcTeamNotesToggle(id);
        else if (act.getAttribute('data-act') === 'delete') sarvarcTeamNotesDelete(id);
      });
    }
    pdfedStickyRender(pdfed.active);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();

sarvarcCollabRegisterModule('teamnotes', {
  attach(doc) {
    sarvarcTeamNotesMap = doc.getMap('teamNotes');
    sarvarcTeamNotesAttachedAt = Date.now();
    const map = sarvarcTeamNotesMap;
    map.observe((event, tx) => {
      if (tx.origin !== 'remote') return;
      sarvarcTeamNotesRender();
      if (Date.now() - sarvarcTeamNotesAttachedAt < 6000) return; // the whole list arrives right after joining
      const me = sarvarcTeamNotesMe();
      event.changes.keys.forEach((chg, k) => {
        if (chg.action !== 'add') return;
        const v = map.get(k);
        if (!v || typeof v.text !== 'string' || v.by === me.id) return;
        const t = v.text.length > 40 ? v.text.slice(0, 40) + '…' : v.text;
        if (typeof toast === 'function') toast((v.byName || 'A teammate') + ' added a team note: ' + t, 'info');
      });
    });
    sarvarcTeamNotesRender();
  },
  detach() {
    sarvarcTeamNotesMap = null;
    sarvarcTeamNotesRender();
  }
});

// ── 2. Sticky notes on the page ─────────────────────────────────────────
function pdfedStickySafeColor(c, fallbackKey) {
  if (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  let h = 0;
  String(fallbackKey || '').split('').forEach((ch) => { h = (h * 31 + ch.charCodeAt(0)) | 0; });
  return SARVARC_STICKY_COLORS[Math.abs(h) % SARVARC_STICKY_COLORS.length];
}

function pdfedStickySave() {
  clearTimeout(pdfedStickySaveTimer);
  pdfedStickySaveTimer = setTimeout(() => {
    // pdfedPersist also tells the live session something changed.
    if (typeof pdfedPersist === 'function') { try { pdfedPersist(); } catch (e) { /* ignore */ } }
  }, 150);
}

function pdfedStickyUpdateCount(idx) {
  const el = document.getElementById('pdfedStickyCount');
  const btn = document.getElementById('pdfedStickyToggleBtn');
  const pg = pdfed.pages[idx];
  const n = (pg && pg.placedNotes && pg.placedNotes.length) || 0;
  if (el) el.textContent = n === 0 ? 'No sticky notes on this page' : n + ' sticky note' + (n === 1 ? '' : 's') + ' on this page' + (pdfedStickyHidden ? ' (hidden)' : '');
  if (btn) btn.textContent = pdfedStickyHidden ? 'Show' : 'Hide';
}

function pdfedStickyRender(idx) {
  const layer = document.getElementById('pdfedPlacedNotesLayer');
  if (!layer) return;
  layer.innerHTML = '';
  pdfedStickyUpdateCount(idx);
  const pg = pdfed.pages[idx];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pg || !pc || !pc.width || pdfedStickyHidden) return;
  const canEdit = sarvarcTeamNotesCanEdit();
  (pg.placedNotes || []).forEach((item) => layer.appendChild(pdfedStickyBuild(idx, item, pc, canEdit)));
}

function pdfedStickyBuild(idx, item, pc, canEdit) {
  const el = document.createElement('div');
  el.className = 'sarvarc-sticky' + (item.done ? ' is-done' : '');
  el.dataset.id = item.id;
  el.style.left = (Number(item.x) || 0) + 'px';
  el.style.top = (Number(item.y) || 0) + 'px';
  el.style.width = (Number(item.w) || 200) + 'px';
  el.style.height = (Number(item.h) || 130) + 'px';
  el.style.background = pdfedStickySafeColor(item.color, item.by || item.byName);
  ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));

  const head = document.createElement('div');
  head.className = 'sarvarc-sticky-head';
  const who = document.createElement('span');
  who.className = 'sarvarc-sticky-by';
  who.textContent = item.byName || 'Note';
  head.appendChild(who);
  const mk = (cls, title, label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sarvarc-sticky-btn ' + cls; b.title = title; b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (!sarvarcTeamNotesGuard()) return; fn(); });
    head.appendChild(b);
  };
  mk('', item.done ? 'Mark as not done' : 'Mark as done', '✓', () => { item.done = !item.done; pdfedStickySave(); pdfedStickyRender(idx); });
  mk('is-del', 'Delete note', '×', () => {
    const pg = pdfed.pages[idx];
    if (pg && pg.placedNotes) pg.placedNotes = pg.placedNotes.filter((n) => n !== item && n.id !== item.id);
    pdfedStickySave(); pdfedStickyRender(idx);
  });
  el.appendChild(head);

  const ta = document.createElement('textarea');
  ta.className = 'sarvarc-sticky-text';
  ta.placeholder = canEdit ? 'Write a note…' : '';
  ta.maxLength = 1000;
  ta.readOnly = !canEdit;
  ta.value = item.text || '';
  ta.addEventListener('keydown', (e) => e.stopPropagation()); // so Delete/Backspace/shortcuts never hit the page behind
  ta.addEventListener('input', () => { item.text = ta.value; pdfedStickySave(); });
  ta.addEventListener('blur', () => { if (item.text !== ta.value) { item.text = ta.value; } pdfedStickySave(); });
  el.appendChild(ta);

  head.addEventListener('pointerdown', (e) => {
    if (!canEdit || (e.target.closest && e.target.closest('button'))) return;
    e.preventDefault();
    const rect = pc.getBoundingClientRect();
    const scale = (rect.width / pc.width) || pdfed.zoom || 1;
    const sx = e.clientX, sy = e.clientY, ox = Number(item.x) || 0, oy = Number(item.y) || 0;
    el.classList.add('is-dragging');
    const move = (ev) => {
      item.x = Math.round(Math.min(Math.max(0, ox + (ev.clientX - sx) / scale), Math.max(0, pc.width - 60)));
      item.y = Math.round(Math.min(Math.max(0, oy + (ev.clientY - sy) / scale), Math.max(0, pc.height - 30)));
      el.style.left = item.x + 'px';
      el.style.top = item.y + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      pdfedStickySave();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
  return el;
}

function pdfedStickyAdd() {
  const pg = pdfed.pages[pdfed.active];
  const pc = document.getElementById('pdfedPageCanvas');
  if (!pg || !pc || !pc.width) { if (typeof toast === 'function') toast('Open a page first, then add a sticky note.', 'info'); return; }
  if (!sarvarcTeamNotesGuard()) return;
  if (!pg.placedNotes) pg.placedNotes = [];
  const me = sarvarcTeamNotesMe();
  const n = pg.placedNotes.length % 6;
  const w = 200, h = 130;
  const item = {
    id: 'snote_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    x: Math.max(12, pc.width - w - 24 - n * 18), y: 24 + n * 18, w: w, h: h,
    text: '', done: false, by: me.id, byName: me.name, ts: Date.now(),
    color: pdfedStickySafeColor(null, me.id || me.name)
  };
  pg.placedNotes.push(item);
  pdfedStickyHidden = false;
  pdfedStickyRender(pdfed.active);
  pdfedStickySave();
  const ta = document.querySelector('#pdfedPlacedNotesLayer .sarvarc-sticky[data-id="' + item.id + '"] textarea');
  if (ta) ta.focus();
}

function pdfedStickyToggleVisible() {
  pdfedStickyHidden = !pdfedStickyHidden;
  pdfedStickyRender(pdfed.active);
}

// Draw the notes whenever a page is shown or its placed items are redrawn
// (this is also what makes a teammate's new sticky note appear).
(function pdfedStickyHooks() {
  const g = window.pdfedGoto;
  if (typeof g === 'function' && !g.__stickyWrapped) {
    const wrapped = async function () {
      const r = await g.apply(this, arguments);
      try { pdfedStickyRender(pdfed.active); } catch (e) { /* ignore */ }
      return r;
    };
    wrapped.__stickyWrapped = true;
    window.pdfedGoto = wrapped;
  }
  const a = window.pdfedRenderAllPlaced;
  if (typeof a === 'function' && !a.__stickyWrapped) {
    const wrappedAll = function (idx) {
      const r = a.apply(this, arguments);
      try { pdfedStickyRender(typeof idx === 'number' ? idx : pdfed.active); } catch (e) { /* ignore */ }
      return r;
    };
    wrappedAll.__stickyWrapped = true;
    window.pdfedRenderAllPlaced = wrappedAll;
  }
})();
