// ─────────────────────────────────────────────────────────────────────────────
// ── MAKE FORMS ── build editable form templates, fill, print, or export as PDF
// ─────────────────────────────────────────────────────────────────────────────
(function(){

const MF_STORAGE_KEY = 'sarvarcForms';
// ─── PUBLISH REGISTRY (session-proof) ───
// Loading a saved Session wholesale-replaces MF_STORAGE_KEY with whatever
// was captured at save time — including, previously, publishedId/shareSlug.
// That meant reopening an old session could make an already-live form look
// unpublished again, even though the real Supabase row was still active and
// still collecting. This registry is a SEPARATE localStorage key, deliberately
// left out of SM_MODULE_STORAGE, so Sessions never touches it. It's the one
// durable record of "this form id maps to this live publishedId" and survives
// every session load/restore. mfLoad() reconciles the two on every boot.
const MF_PUBLISH_REGISTRY_KEY = 'sarvarcFormsPublishRegistry';
function mfGetPublishRegistry() {
  try { return JSON.parse(localStorage.getItem(MF_PUBLISH_REGISTRY_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function mfRegisterPublish(formId, info) {
  const reg = mfGetPublishRegistry();
  reg[formId] = { publishedId: info.publishedId, shareSlug: info.shareSlug, publishedAt: info.publishedAt || Date.now() };
  try { localStorage.setItem(MF_PUBLISH_REGISTRY_KEY, JSON.stringify(reg)); } catch (e) {}
}
function mfLookupPublish(formId) {
  return mfGetPublishRegistry()[formId] || null;
}
let mfMemForms = null; // in-memory fallback if localStorage is unavailable
let mfState = { forms: [], currentId: null };
// Fill & Responses mode: which tab is active, the field values currently
// showing in the live preview (keyed by field id), and which saved response
// (if any) those values belong to. null activeResponseId = an unsaved draft.
let mfMode = 'design';
let mfDraftValues = {};
let mfActiveResponseId = null;

function mfUid(prefix){ return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function mfLoad() {
  if (mfMemForms) { mfState.forms = mfMemForms; return; }
  try {
    const raw = localStorage.getItem(MF_STORAGE_KEY);
    mfState.forms = raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.warn('[Make Forms] localStorage unavailable, using in-memory only', e);
    mfState.forms = [];
    mfMemForms = mfState.forms;
  }
}
// Attachment files used to be stored inline as base64 dataUrls right inside
// mfState.forms → localStorage['sarvarcForms']. A single form with a few
// MB of PDFs/images pushed that one localStorage key past the browser's
// origin quota (typically 5-10MB total, shared with every other saved
// form). The write would then throw QuotaExceededError, which mfPersist()
// only logged to the console — so the attachment stayed visible for the
// rest of that tab's life (it was still sitting in memory) but was never
// actually written to disk. Reopen the app (new day, new login, a Saved
// Session reload) and it's gone, because the load path only ever sees what
// made it into localStorage. See mfPersist() below.
//
// Fix: attachment binary data now lives in IndexedDB (via idbKvGet/Set,
// same store already used for the Workspace document, Extract and Redact —
// see idbKvOpen above), which has a far larger quota. localStorage keeps
// only small metadata (id/name/size/type) per file. mfAttachBlobs is the
// in-memory {fileId: dataUrl} cache, loaded once at boot by
// mfLoadAttachmentBlobs() (called right after mfLoad(), see bottom of this
// module) and also swept into every Saved Session (see SM_MODULE_STORAGE's
// makeforms.idb entry) so attachments now survive a Session save/reload too.
const MF_ATTACH_STORAGE_KEY = 'sarvarcFormsAttachments';
let mfAttachBlobs = {};
let mfAttachBlobsLoaded = false;

async function mfLoadAttachmentBlobs() {
  try { mfAttachBlobs = (await idbKvGet(MF_ATTACH_STORAGE_KEY)) || {}; }
  catch (e) { console.warn('[Make Forms] could not load attachment files from IndexedDB', e); mfAttachBlobs = {}; }
  mfAttachBlobsLoaded = true;
  // One-time migration: any file still carrying its old inline dataUrl
  // (saved before this fix, or restored from an old Session/export) gets
  // its data moved into mfAttachBlobs and stripped out of mfState.forms,
  // so it stops re-bloating localStorage on every future edit.
  let migrated = false;
  (mfState.forms || []).forEach(function (f) {
    (f.attachmentFolders || []).forEach(function (folder) {
      (folder.files || []).forEach(function (file) {
        if (file.dataUrl) {
          mfAttachBlobs[file.id] = file.dataUrl;
          delete file.dataUrl;
          migrated = true;
        }
      });
    });
  });
  if (migrated) {
    try { await idbKvSet(MF_ATTACH_STORAGE_KEY, mfAttachBlobs); } catch (e) {}
    mfMemForms = mfState.forms;
    try { localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(mfState.forms)); } catch (e) {}
    if (document.getElementById('mfFillAttachList') || document.getElementById('mfAttachList')) mfRenderAttachments();
  }
}

async function mfPersistAttachmentBlobs() {
  try { await idbKvSet(MF_ATTACH_STORAGE_KEY, mfAttachBlobs); }
  catch (e) {
    console.warn('[Make Forms] could not persist attachment files to IndexedDB', e);
    if (typeof toast === 'function') toast('Could not save that attachment — your browser storage may be full', 'error');
  }
}

function mfPersist() {
  if (typeof mfHistory !== 'undefined') mfHistory.checkpoint();
  mfMemForms = mfState.forms; // always keep in-memory mirror in sync
  try { localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(mfState.forms)); }
  catch(e) {
    console.warn('[Make Forms] could not persist to localStorage', e);
    if (typeof toast === 'function') toast('Could not save your form — your browser storage may be full', 'error');
  }
  mfCollabPush();
}

// Runs once right after mfLoad() (fresh boot, and therefore also right after
// a Session's forced page reload). For every form that's currently missing
// its publish link locally, checks the session-proof registry: if this form
// id was published before, reattach publishedId/shareSlug/publishedAt so the
// editor shows it as live again instead of "Publish", then kick off a silent
// sync so any response collected while the link was locally lost shows up
// immediately — the person shouldn't have to notice anything went wrong.
async function mfReconcilePublishState() {
  let relinkedAny = false;
  mfState.forms.forEach(function (f) {
    if (f.publishedId) return; // already linked, nothing to reconcile
    const reg = mfLookupPublish(f.id);
    if (!reg || !reg.publishedId) return;
    f.publishedId = reg.publishedId;
    f.shareSlug = reg.shareSlug;
    f.publishedAt = reg.publishedAt;
    if (reg.expiresAt !== undefined) f.expiresAt = reg.expiresAt;
    relinkedAny = true;
  });
  if (relinkedAny) {
    mfPersist();
    if (typeof mfRenderFormsGrid === 'function') mfRenderFormsGrid();
  }
  // Pull in anything collected server-side for every published form, not
  // just whichever one happens to be open — a form doesn't have to be on
  // screen for its responses to matter.
  for (const f of mfState.forms) {
    if (f.publishedId) {
      try { await mfSyncPublishedResponses({ silent: true, form: f }); } catch (e) {}
    }
  }
}

// ─── LIVE CO-EDITING (see sarvarcCollabRegisterModule / core engine) ───
// Each form is one entry in a shared Y.Map, keyed by form.id. Whichever
// teammate last touched a given form wins for that form (Yjs "last write
// wins" per key) — two people editing DIFFERENT forms never conflict.
// Two people editing the very SAME form at the very same instant still
// resolves to whoever's edit lands last, same as most form builders;
// true per-keystroke merge inside one field is a further step (binding
// the title/description inputs to Y.Text) that isn't wired up yet.
let mfCollabMap = null;
let mfCollabApplyingRemote = false; // guards against remote refresh re-touching a form the user is actively typing in

function mfCollabPush() {
  if (!mfCollabMap || mfCollabApplyingRemote) return;
  const doc = mfCollabMap.doc;
  doc.transact(() => {
    const liveIds = new Set(mfState.forms.map(f => f.id));
    // Remove forms that were deleted locally.
    mfCollabMap.forEach((_v, k) => { if (!liveIds.has(k)) mfCollabMap.delete(k); });
    mfState.forms.forEach(f => mfCollabMap.set(f.id, f));
  });
}

function mfCollabReconcileFromY(changedIds) {
  mfCollabApplyingRemote = true;
  try {
    const yIds = new Set();
    mfCollabMap.forEach((v, k) => { yIds.add(k); });
    // Keep local ordering for forms we already know about, append any new
    // ones, drop any that were removed remotely.
    const byId = {};
    mfCollabMap.forEach((v, k) => { byId[k] = v; });
    const kept = mfState.forms.filter(f => yIds.has(f.id)).map(f => byId[f.id]);
    const existingIds = new Set(mfState.forms.map(f => f.id));
    const added = Array.from(yIds).filter(id => !existingIds.has(id)).map(id => byId[id]);
    mfState.forms = kept.concat(added);
    mfMemForms = mfState.forms;
    try { localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(mfState.forms)); } catch (e) {}

    // Refresh whatever's currently on screen. If the form the user has
    // open got changed remotely, refresh its editor — but never stomp an
    // input the user is actively typing in right now.
    if (document.getElementById('mfGalleryView') && document.getElementById('mfGalleryView').style.display !== 'none') {
      if (typeof mfRenderFormsGrid === 'function') mfRenderFormsGrid();
    }
    const cur = mfGetCurrentForm();
    if (cur && changedIds.has(cur.id)) {
      const active = document.activeElement;
      const activeId = active && active.id;
      const fieldListEl = document.getElementById('mfFieldList');
      const typingTitleOrDesc = activeId === 'mfFormTitleInput' || activeId === 'mfFormDescInput';
      const typingInFieldList = fieldListEl && active && fieldListEl.contains(active);
      // Full re-renders below rebuild DOM from scratch (innerHTML), which
      // would yank focus/cursor out of whatever the user is mid-typing in.
      // Skip that specific refresh rather than fight their keystrokes —
      // the next change (remote or local) catches it back up.
      if (!typingTitleOrDesc && typeof mfRenderPreview === 'function') mfRenderPreview();
      if (!typingInFieldList && typeof mfRenderFieldList === 'function') mfRenderFieldList();
    }
  } finally {
    mfCollabApplyingRemote = false;
  }
}

sarvarcCollabRegisterModule('makeforms', {
  attach(doc, awareness) {
    mfCollabMap = doc.getMap('mfForms');
    // First one in seeds the shared doc from whatever's already saved
    // locally, so opening a live project with existing forms doesn't
    // start everyone from empty.
    if (mfCollabMap.size === 0 && mfState.forms.length) {
      doc.transact(() => { mfState.forms.forEach(f => mfCollabMap.set(f.id, f)); });
    } else {
      mfCollabReconcileFromY(new Set(Array.from(mfCollabMap.keys())));
    }
    mfCollabMap.observe((event, tx) => {
      if (tx.origin !== 'remote') return; // our own local pushes already reflect in mfState directly
      mfCollabReconcileFromY(new Set(Array.from(event.changes.keys.keys())));
    });
  },
  detach() { mfCollabMap = null; }
});

// ─── FIELD DEFAULTS ───
function mfNewField(type) {
  const base = { id: mfUid('fld'), type, label: '', required: false };
  switch(type) {
    case 'text':      return { ...base, label: 'Text Field' };
    case 'paragraph': return { ...base, label: 'Paragraph' };
    case 'number':    return { ...base, label: 'Number' };
    case 'date':      return { ...base, label: 'Date' };
    case 'checkbox':  return { ...base, label: 'Checkbox option' };
    case 'mcq':       return { ...base, label: 'Multiple Choice Question', options: ['Option 1', 'Option 2', 'Option 3'] };
    case 'select':    return { ...base, label: 'Dropdown', options: ['Option 1', 'Option 2'] };
    case 'heading':   return { ...base, label: 'Section Heading' };
    case 'signature': return { ...base, label: 'Signature' };
    default:          return { ...base, label: 'Field' };
  }
}
const MF_TYPE_NAMES = { text:'Text', paragraph:'Paragraph', number:'Number', date:'Date', checkbox:'Checkbox', mcq:'MCQ', select:'Dropdown', heading:'Section', signature:'Signature' };
const MF_ACCENT_PRESETS = ['#0073E6', '#00C2FF', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#1a1a1a'];
const MF_LOGO_MAX_DIM = 240; // px, longest side after resize
const MF_BANNER_MAX_DIM = 1000; // px, longest side after resize — a full-width header backdrop needs more resolution than a small logo

// ─── TEMPLATES ───
// Every template below carries a `category` used to group the picker, and
// every field's `required` flag reflects what that document genuinely can't
// be processed without in real practice (e.g. a GSTIN on a tax invoice, a
// discharge diagnosis, an interviewer's recommendation) — not just the
// first few fields marked required by default. Optional context fields are
// deliberately left unrequired so the form stays fast to fill.
const MF_ICONS = {
  blank:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  invoice:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  receipt:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>',
  wallet:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-4a2 2 0 0 1 0-4h4Z"/></svg>',
  card:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  userCheck: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
  userPlus:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  calendar:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  logOut:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  trending:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  heart:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  clipCheck: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><polyline points="9 14 11 16 15 12"/></svg>',
  shield:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  clock:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  briefcase: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  clipList:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>',
  phoneCall: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>',
  checkCirc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  smile:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  users:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
};
const MF_CATEGORIES = {
  general: 'General',
  finance: "CA / Finance & Billing",
  hr: 'Human Resources',
  health: 'Hospitals & Healthcare',
  recruit: 'Recruitment & Hiring',
};
const MF_TEMPLATES = {
  blank: {
    name: 'Blank Form', desc: 'An open canvas with logo, description, and details ready to fill in.',
    category: 'general', icon: MF_ICONS.blank,
    build: () => ({ title: 'Untitled Form', desc: '', fields: [
      { ...mfNewField('paragraph'), label: 'Details' },
    ]})
  },

  // ── CA / FINANCE & BILLING ──────────────────────────────────────────
  gstInvoice: {
    name: 'GST Tax Invoice', desc: 'Fully itemized, GST-compliant invoice with GSTIN, HSN/SAC, and tax breakup.',
    category: 'finance', icon: MF_ICONS.invoice,
    build: () => ({ title: 'Tax Invoice', desc: 'This is a computer-generated tax invoice issued under GST rules.', fields: [
      { ...mfNewField('text'), label: 'Invoice Number', required: true },
      { ...mfNewField('date'), label: 'Invoice Date', required: true },
      { ...mfNewField('date'), label: 'Due Date' },
      { ...mfNewField('heading'), label: 'Seller Details' },
      { ...mfNewField('text'), label: 'Company / Firm Name', required: true },
      { ...mfNewField('text'), label: 'GSTIN', required: true },
      { ...mfNewField('paragraph'), label: 'Registered Address', required: true },
      { ...mfNewField('heading'), label: 'Buyer Details' },
      { ...mfNewField('text'), label: 'Client / Company Name', required: true },
      { ...mfNewField('text'), label: 'Client GSTIN' },
      { ...mfNewField('paragraph'), label: 'Billing Address', required: true },
      { ...mfNewField('heading'), label: 'Item / Service Details' },
      { ...mfNewField('paragraph'), label: 'Description of Goods / Services', required: true },
      { ...mfNewField('text'), label: 'HSN / SAC Code' },
      { ...mfNewField('number'), label: 'Quantity' },
      { ...mfNewField('number'), label: 'Rate per Unit' },
      { ...mfNewField('number'), label: 'Taxable Value', required: true },
      { ...mfNewField('select'), label: 'GST Rate', options: ['0%','5%','12%','18%','28%'] },
      { ...mfNewField('number'), label: 'CGST Amount' },
      { ...mfNewField('number'), label: 'SGST Amount' },
      { ...mfNewField('number'), label: 'IGST Amount' },
      { ...mfNewField('number'), label: 'Total Invoice Amount', required: true },
      { ...mfNewField('heading'), label: 'Payment' },
      { ...mfNewField('select'), label: 'Payment Terms', options: ['Due on Receipt','Net 7','Net 15','Net 30','Net 45'] },
      { ...mfNewField('text'), label: 'Bank Account / IFSC for Payment' },
      { ...mfNewField('signature'), label: 'Authorized Signatory' },
    ]})
  },
  expenseClaim: {
    name: 'Expense Reimbursement Claim', desc: 'Employee expense claim with category, amount, and multi-level approval.',
    category: 'finance', icon: MF_ICONS.card,
    build: () => ({ title: 'Expense Reimbursement Claim', desc: '', fields: [
      { ...mfNewField('text'), label: 'Employee Name', required: true },
      { ...mfNewField('text'), label: 'Employee ID', required: true },
      { ...mfNewField('text'), label: 'Department' },
      { ...mfNewField('date'), label: 'Claim Period From', required: true },
      { ...mfNewField('date'), label: 'Claim Period To', required: true },
      { ...mfNewField('heading'), label: 'Expense Details' },
      { ...mfNewField('select'), label: 'Expense Category', options: ['Travel','Food & Entertainment','Accommodation','Office Supplies','Client Expense','Other'] },
      { ...mfNewField('paragraph'), label: 'Description of Expense', required: true },
      { ...mfNewField('number'), label: 'Amount Claimed', required: true },
      { ...mfNewField('checkbox'), label: 'Original bill / receipt attached', required: true },
      { ...mfNewField('heading'), label: 'Approval' },
      { ...mfNewField('signature'), label: 'Employee Signature', required: true },
      { ...mfNewField('signature'), label: 'Manager Approval' },
      { ...mfNewField('signature'), label: 'Finance / Accounts Approval' },
    ]})
  },
  kycOnboarding: {
    name: 'Client Onboarding / KYC Form', desc: 'PAN, GSTIN, and bank-detail collection for new client onboarding.',
    category: 'finance', icon: MF_ICONS.userCheck,
    build: () => ({ title: 'Client Onboarding & KYC Form', desc: 'Please provide accurate details, this information will be used for invoicing and compliance records.', fields: [
      { ...mfNewField('heading'), label: 'Client Information' },
      { ...mfNewField('text'), label: 'Full Name / Company Name', required: true },
      { ...mfNewField('text'), label: 'PAN Number', required: true },
      { ...mfNewField('text'), label: 'GSTIN (if applicable)' },
      { ...mfNewField('paragraph'), label: 'Registered Address', required: true },
      { ...mfNewField('text'), label: 'Contact Person', required: true },
      { ...mfNewField('text'), label: 'Email', required: true },
      { ...mfNewField('text'), label: 'Phone', required: true },
      { ...mfNewField('heading'), label: 'Business Details' },
      { ...mfNewField('text'), label: 'Nature of Business' },
      { ...mfNewField('select'), label: 'Annual Turnover (approx.)', options: ['Below ₹20L','₹20L – ₹1Cr','₹1Cr – ₹5Cr','Above ₹5Cr'] },
      { ...mfNewField('text'), label: 'Bank Name' },
      { ...mfNewField('text'), label: 'Account Number' },
      { ...mfNewField('text'), label: 'IFSC Code' },
      { ...mfNewField('heading'), label: 'Declaration' },
      { ...mfNewField('checkbox'), label: 'I declare the information provided above is true and accurate', required: true },
      { ...mfNewField('signature'), label: 'Signature', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },
  paymentVoucher: {
    name: 'Payment Voucher', desc: 'Internal record for any outgoing payment, with approval and receipt sign-off.',
    category: 'finance', icon: MF_ICONS.wallet,
    build: () => ({ title: 'Payment Voucher', desc: '', fields: [
      { ...mfNewField('text'), label: 'Voucher No.', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
      { ...mfNewField('text'), label: 'Paid To', required: true },
      { ...mfNewField('number'), label: 'Amount (₹)', required: true },
      { ...mfNewField('text'), label: 'Amount in Words' },
      { ...mfNewField('select'), label: 'Payment Mode', options: ['Cash','Cheque','Bank Transfer','UPI'] },
      { ...mfNewField('text'), label: 'Cheque / Transaction Reference No.' },
      { ...mfNewField('paragraph'), label: 'Purpose of Payment', required: true },
      { ...mfNewField('signature'), label: 'Approved By', required: true },
      { ...mfNewField('signature'), label: 'Received By' },
    ]})
  },
  receipt: {
    name: 'Payment Receipt', desc: 'Acknowledge a payment received from a customer.',
    category: 'finance', icon: MF_ICONS.receipt,
    build: () => ({ title: 'Payment Receipt', desc: '', fields: [
      { ...mfNewField('text'), label: 'Receipt No.', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
      { ...mfNewField('text'), label: 'Received From', required: true },
      { ...mfNewField('number'), label: 'Amount Received', required: true },
      { ...mfNewField('paragraph'), label: 'Payment For' },
      { ...mfNewField('select'), label: 'Payment Mode', options: ['Cash','Card','Bank Transfer','UPI','Cheque'] },
      { ...mfNewField('signature'), label: 'Received By', required: true },
    ]})
  },

  // ── HUMAN RESOURCES ──────────────────────────────────────────────────
  onboarding: {
    name: 'Employee Onboarding Form', desc: 'New-hire personal, employment, and statutory details in one place.',
    category: 'hr', icon: MF_ICONS.userPlus,
    build: () => ({ title: 'Employee Onboarding Form', desc: '', fields: [
      { ...mfNewField('heading'), label: 'Personal Details' },
      { ...mfNewField('text'), label: 'Full Name', required: true },
      { ...mfNewField('date'), label: 'Date of Birth', required: true },
      { ...mfNewField('select'), label: 'Gender', options: ['Male','Female','Other','Prefer not to say'] },
      { ...mfNewField('text'), label: 'Personal Email', required: true },
      { ...mfNewField('text'), label: 'Phone', required: true },
      { ...mfNewField('text'), label: 'Emergency Contact Name', required: true },
      { ...mfNewField('text'), label: 'Emergency Contact Phone', required: true },
      { ...mfNewField('heading'), label: 'Employment Details' },
      { ...mfNewField('text'), label: 'Employee ID' },
      { ...mfNewField('text'), label: 'Designation', required: true },
      { ...mfNewField('text'), label: 'Department', required: true },
      { ...mfNewField('text'), label: 'Reporting Manager', required: true },
      { ...mfNewField('date'), label: 'Date of Joining', required: true },
      { ...mfNewField('select'), label: 'Employment Type', options: ['Full-time','Part-time','Contract','Intern'] },
      { ...mfNewField('heading'), label: 'Bank & Statutory Details' },
      { ...mfNewField('text'), label: 'Bank Account Number' },
      { ...mfNewField('text'), label: 'IFSC Code' },
      { ...mfNewField('text'), label: 'PAN Number', required: true },
      { ...mfNewField('text'), label: 'Aadhaar Number' },
      { ...mfNewField('heading'), label: 'Acknowledgement' },
      { ...mfNewField('checkbox'), label: 'I have received and reviewed the employee handbook', required: true },
      { ...mfNewField('signature'), label: 'Employee Signature', required: true },
    ]})
  },
  leave: {
    name: 'Leave Application', desc: 'Employee time-off request with approval line.',
    category: 'hr', icon: MF_ICONS.calendar,
    build: () => ({ title: 'Leave Application', desc: '', fields: [
      { ...mfNewField('text'), label: 'Employee Name', required: true },
      { ...mfNewField('text'), label: 'Employee ID', required: true },
      { ...mfNewField('text'), label: 'Department', required: true },
      { ...mfNewField('select'), label: 'Leave Type', options: ['Sick Leave','Casual Leave','Earned Leave','Unpaid Leave'] },
      { ...mfNewField('date'), label: 'From Date', required: true },
      { ...mfNewField('date'), label: 'To Date', required: true },
      { ...mfNewField('paragraph'), label: 'Reason', required: true },
      { ...mfNewField('signature'), label: 'Employee Signature', required: true },
      { ...mfNewField('signature'), label: 'Approved By' },
    ]})
  },
  exitInterview: {
    name: 'Exit Interview / Resignation Form', desc: 'Separation details, asset return, and offboarding checklist.',
    category: 'hr', icon: MF_ICONS.logOut,
    build: () => ({ title: 'Exit Interview & Resignation Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Employee Name', required: true },
      { ...mfNewField('text'), label: 'Employee ID', required: true },
      { ...mfNewField('text'), label: 'Department' },
      { ...mfNewField('text'), label: 'Designation' },
      { ...mfNewField('date'), label: 'Date of Joining' },
      { ...mfNewField('date'), label: 'Last Working Day', required: true },
      { ...mfNewField('select'), label: 'Reason for Leaving', options: ['Better Opportunity','Higher Studies','Relocation','Personal Reasons','Compensation','Other'] },
      { ...mfNewField('paragraph'), label: 'Additional Comments' },
      { ...mfNewField('checkbox'), label: 'All company assets have been returned', required: true },
      { ...mfNewField('checkbox'), label: 'Knowledge transfer / handover completed', required: true },
      { ...mfNewField('paragraph'), label: 'Feedback on Your Experience' },
      { ...mfNewField('signature'), label: 'Employee Signature', required: true },
      { ...mfNewField('signature'), label: 'HR Signature' },
    ]})
  },
  appraisal: {
    name: 'Performance Appraisal Form', desc: 'Structured rating scale, strengths, goals, and manager sign-off.',
    category: 'hr', icon: MF_ICONS.trending,
    build: () => ({ title: 'Performance Appraisal Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Employee Name', required: true },
      { ...mfNewField('text'), label: 'Employee ID' },
      { ...mfNewField('text'), label: 'Department' },
      { ...mfNewField('text'), label: 'Designation' },
      { ...mfNewField('text'), label: 'Appraisal Period', required: true },
      { ...mfNewField('text'), label: 'Reviewer / Manager Name', required: true },
      { ...mfNewField('heading'), label: 'Ratings' },
      { ...mfNewField('select'), label: 'Job Knowledge', options: ['Excellent','Good','Average','Needs Improvement'] },
      { ...mfNewField('select'), label: 'Quality of Work', options: ['Excellent','Good','Average','Needs Improvement'] },
      { ...mfNewField('select'), label: 'Communication Skills', options: ['Excellent','Good','Average','Needs Improvement'] },
      { ...mfNewField('select'), label: 'Teamwork & Collaboration', options: ['Excellent','Good','Average','Needs Improvement'] },
      { ...mfNewField('heading'), label: 'Comments' },
      { ...mfNewField('paragraph'), label: 'Key Strengths' },
      { ...mfNewField('paragraph'), label: 'Areas for Improvement' },
      { ...mfNewField('paragraph'), label: 'Goals for Next Period' },
      { ...mfNewField('signature'), label: 'Employee Signature' },
      { ...mfNewField('signature'), label: 'Manager Signature', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },

  // ── HOSPITALS & HEALTHCARE ───────────────────────────────────────────
  intake: {
    name: 'Patient Intake', desc: 'New-patient details, medical history, and treatment consent.',
    category: 'health', icon: MF_ICONS.heart,
    build: () => ({ title: 'Patient Intake Form', desc: '', fields: [
      { ...mfNewField('heading'), label: 'Patient Information' },
      { ...mfNewField('text'), label: 'Full Name', required: true },
      { ...mfNewField('date'), label: 'Date of Birth', required: true },
      { ...mfNewField('select'), label: 'Gender', options: ['Male','Female','Other'] },
      { ...mfNewField('text'), label: 'Phone', required: true },
      { ...mfNewField('paragraph'), label: 'Address' },
      { ...mfNewField('heading'), label: 'Medical History' },
      { ...mfNewField('paragraph'), label: 'Known Allergies' },
      { ...mfNewField('paragraph'), label: 'Current Medications' },
      { ...mfNewField('paragraph'), label: 'Existing Conditions' },
      { ...mfNewField('checkbox'), label: 'I consent to treatment', required: true },
      { ...mfNewField('signature'), label: 'Patient / Guardian Signature', required: true },
    ]})
  },
  dischargeSummary: {
    name: 'Patient Discharge Summary', desc: 'Diagnosis, treatment given, and follow-up instructions on release.',
    category: 'health', icon: MF_ICONS.clipCheck,
    build: () => ({ title: 'Patient Discharge Summary', desc: '', fields: [
      { ...mfNewField('text'), label: 'Patient Name', required: true },
      { ...mfNewField('text'), label: 'Patient ID / MRN', required: true },
      { ...mfNewField('number'), label: 'Age' },
      { ...mfNewField('select'), label: 'Gender', options: ['Male','Female','Other'] },
      { ...mfNewField('date'), label: 'Admission Date', required: true },
      { ...mfNewField('date'), label: 'Discharge Date', required: true },
      { ...mfNewField('text'), label: 'Attending Doctor', required: true },
      { ...mfNewField('heading'), label: 'Diagnosis' },
      { ...mfNewField('text'), label: 'Primary Diagnosis', required: true },
      { ...mfNewField('paragraph'), label: 'Secondary Diagnosis' },
      { ...mfNewField('heading'), label: 'Treatment Summary' },
      { ...mfNewField('paragraph'), label: 'Treatment Given', required: true },
      { ...mfNewField('paragraph'), label: 'Medications Prescribed', required: true },
      { ...mfNewField('paragraph'), label: 'Follow-up Instructions', required: true },
      { ...mfNewField('date'), label: 'Next Appointment Date' },
      { ...mfNewField('signature'), label: "Doctor's Signature", required: true },
    ]})
  },
  medicalConsent: {
    name: 'Medical History & Consent Form', desc: 'Full history intake plus treatment and records-sharing consent.',
    category: 'health', icon: MF_ICONS.shield,
    build: () => ({ title: 'Medical History & Consent Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Patient Name', required: true },
      { ...mfNewField('date'), label: 'Date of Birth', required: true },
      { ...mfNewField('heading'), label: 'Medical History' },
      { ...mfNewField('paragraph'), label: 'Known Allergies' },
      { ...mfNewField('paragraph'), label: 'Current Medications' },
      { ...mfNewField('paragraph'), label: 'Past Surgeries' },
      { ...mfNewField('paragraph'), label: 'Chronic Conditions' },
      { ...mfNewField('paragraph'), label: 'Family Medical History' },
      { ...mfNewField('heading'), label: 'Consent' },
      { ...mfNewField('checkbox'), label: 'I consent to examination and treatment', required: true },
      { ...mfNewField('checkbox'), label: 'I consent to share records with my insurance provider' },
      { ...mfNewField('signature'), label: 'Patient / Guardian Signature', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },
  appointmentRequest: {
    name: 'Appointment Request Form', desc: 'Patient-facing form to request a visit with preferred date and doctor.',
    category: 'health', icon: MF_ICONS.clock,
    build: () => ({ title: 'Appointment Request Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Patient Name', required: true },
      { ...mfNewField('text'), label: 'Phone', required: true },
      { ...mfNewField('text'), label: 'Email' },
      { ...mfNewField('date'), label: 'Date of Birth' },
      { ...mfNewField('text'), label: 'Preferred Doctor / Department' },
      { ...mfNewField('date'), label: 'Preferred Date', required: true },
      { ...mfNewField('select'), label: 'Preferred Time', options: ['Morning','Afternoon','Evening'] },
      { ...mfNewField('paragraph'), label: 'Reason for Visit', required: true },
      { ...mfNewField('text'), label: 'Insurance Provider' },
      { ...mfNewField('text'), label: 'Policy Number' },
    ]})
  },

  // ── RECRUITMENT & HIRING ─────────────────────────────────────────────
  jobapp: {
    name: 'Job Application', desc: 'Collect candidate info, role, and experience.',
    category: 'recruit', icon: MF_ICONS.briefcase,
    build: () => ({ title: 'Job Application Form', desc: '', fields: [
      { ...mfNewField('heading'), label: 'Personal Information' },
      { ...mfNewField('text'), label: 'Full Name', required: true },
      { ...mfNewField('text'), label: 'Email', required: true },
      { ...mfNewField('text'), label: 'Phone', required: true },
      { ...mfNewField('paragraph'), label: 'Address' },
      { ...mfNewField('heading'), label: 'Position' },
      { ...mfNewField('text'), label: 'Position Applied For', required: true },
      { ...mfNewField('number'), label: 'Expected Salary' },
      { ...mfNewField('date'), label: 'Availability Date' },
      { ...mfNewField('heading'), label: 'Experience' },
      { ...mfNewField('text'), label: 'Previous Employer' },
      { ...mfNewField('number'), label: 'Years of Experience' },
      { ...mfNewField('paragraph'), label: 'Relevant Skills' },
      { ...mfNewField('signature'), label: 'Applicant Signature', required: true },
    ]})
  },
  interviewEval: {
    name: 'Candidate Interview Evaluation', desc: 'Structured scorecard for interviewers with a clear recommendation.',
    category: 'recruit', icon: MF_ICONS.clipList,
    build: () => ({ title: 'Candidate Interview Evaluation Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Candidate Name', required: true },
      { ...mfNewField('text'), label: 'Position Applied For', required: true },
      { ...mfNewField('date'), label: 'Interview Date', required: true },
      { ...mfNewField('text'), label: 'Interviewer Name', required: true },
      { ...mfNewField('heading'), label: 'Evaluation' },
      { ...mfNewField('select'), label: 'Technical Skills', options: ['Excellent','Good','Average','Poor'] },
      { ...mfNewField('select'), label: 'Communication Skills', options: ['Excellent','Good','Average','Poor'] },
      { ...mfNewField('select'), label: 'Problem Solving', options: ['Excellent','Good','Average','Poor'] },
      { ...mfNewField('select'), label: 'Culture Fit', options: ['Excellent','Good','Average','Poor'] },
      { ...mfNewField('paragraph'), label: 'Strengths' },
      { ...mfNewField('paragraph'), label: 'Concerns' },
      { ...mfNewField('select'), label: 'Overall Recommendation', options: ['Strongly Recommend','Recommend','Neutral','Do Not Recommend'] },
      { ...mfNewField('signature'), label: 'Interviewer Signature', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },
  referenceCheck: {
    name: 'Reference Check Form', desc: "Verify a candidate's work history directly with a former employer.",
    category: 'recruit', icon: MF_ICONS.phoneCall,
    build: () => ({ title: 'Reference Check Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Candidate Name', required: true },
      { ...mfNewField('text'), label: 'Position Applied For' },
      { ...mfNewField('text'), label: 'Reference Name', required: true },
      { ...mfNewField('text'), label: 'Reference Company' },
      { ...mfNewField('text'), label: 'Reference Designation' },
      { ...mfNewField('text'), label: 'Reference Phone', required: true },
      { ...mfNewField('text'), label: 'Relationship to Candidate', required: true },
      { ...mfNewField('heading'), label: 'Reference Questions' },
      { ...mfNewField('text'), label: 'How long have you known the candidate?' },
      { ...mfNewField('paragraph'), label: "Candidate's Key Strengths" },
      { ...mfNewField('paragraph'), label: 'Areas for Improvement' },
      { ...mfNewField('select'), label: 'Would you rehire this candidate?', options: ['Yes','No','Maybe'] },
      { ...mfNewField('text'), label: 'Checked By', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },
  offerAcceptance: {
    name: 'Offer Acceptance Form', desc: "Candidate's formal acceptance of role, joining date, and terms.",
    category: 'recruit', icon: MF_ICONS.checkCirc,
    build: () => ({ title: 'Offer Acceptance Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Candidate Name', required: true },
      { ...mfNewField('text'), label: 'Position Offered', required: true },
      { ...mfNewField('text'), label: 'Department' },
      { ...mfNewField('date'), label: 'Proposed Joining Date', required: true },
      { ...mfNewField('text'), label: 'Annual CTC / Salary' },
      { ...mfNewField('heading'), label: 'Terms' },
      { ...mfNewField('checkbox'), label: 'I accept the terms of employment as outlined in the offer letter', required: true },
      { ...mfNewField('checkbox'), label: 'I confirm all documents submitted are authentic', required: true },
      { ...mfNewField('signature'), label: 'Candidate Signature', required: true },
      { ...mfNewField('date'), label: 'Date', required: true },
    ]})
  },

  // ── GENERAL ───────────────────────────────────────────────────────────
  feedback: {
    name: 'Feedback Form', desc: 'Gather ratings and open-ended feedback.',
    category: 'general', icon: MF_ICONS.smile,
    build: () => ({ title: 'Feedback Form', desc: '', fields: [
      { ...mfNewField('text'), label: 'Name (optional)' },
      { ...mfNewField('date'), label: 'Date' },
      { ...mfNewField('select'), label: 'Overall Rating', options: ['Excellent','Good','Average','Poor'] },
      { ...mfNewField('paragraph'), label: 'What did you like?' },
      { ...mfNewField('paragraph'), label: 'What can we improve?' },
      { ...mfNewField('checkbox'), label: "I'd like to be contacted about this feedback" },
    ]})
  },
  registration: {
    name: 'Registration Form', desc: 'Sign people up for an event or program.',
    category: 'general', icon: MF_ICONS.users,
    build: () => ({ title: 'Registration Form', desc: '', fields: [
      { ...mfNewField('heading'), label: 'Registration Details' },
      { ...mfNewField('text'), label: 'Full Name', required: true },
      { ...mfNewField('text'), label: 'Email', required: true },
      { ...mfNewField('text'), label: 'Phone' },
      { ...mfNewField('text'), label: 'Event / Program', required: true },
      { ...mfNewField('date'), label: 'Date of Birth' },
      { ...mfNewField('checkbox'), label: 'I agree to the terms and conditions', required: true },
      { ...mfNewField('signature'), label: 'Signature' },
    ]})
  },
};

// ─── GALLERY: TEMPLATE GRID ───
// Templates are grouped by profession/category (CA & Finance, HR, Hospitals,
// Recruitment, General) with a pill filter row, so someone who only cares
// about, say, HR paperwork isn't scrolling past a dozen unrelated cards.
let mfTemplateFilter = 'all';
function mfSetTemplateFilter(cat) {
  mfTemplateFilter = cat;
  mfRenderTemplateGrid();
}
function mfRenderTemplateGrid() {
  const grid = document.getElementById('mfTemplateGrid');
  const filterHost = document.getElementById('mfTemplateFilters');
  if (!grid) return;

  const catsPresent = [];
  Object.keys(MF_TEMPLATES).forEach(key => {
    const cat = MF_TEMPLATES[key].category || 'general';
    if (!catsPresent.includes(cat)) catsPresent.push(cat);
  });

  if (filterHost) {
    const pills = ['all', ...catsPresent].map(cat => {
      const label = cat === 'all' ? 'All Templates' : (MF_CATEGORIES[cat] || cat);
      const active = mfTemplateFilter === cat ? ' active' : '';
      return `<button class="mf-tpl-filter-pill${active}" onclick="mfSetTemplateFilter('${cat}')">${mfEsc(label)}</button>`;
    }).join('');
    filterHost.innerHTML = pills;
  }

  const byCat = {};
  Object.keys(MF_TEMPLATES).forEach(key => {
    const t = MF_TEMPLATES[key];
    const cat = t.category || 'general';
    if (mfTemplateFilter !== 'all' && mfTemplateFilter !== cat) return;
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(key);
  });

  const orderedCats = Object.keys(MF_CATEGORIES).filter(c => byCat[c]);
  grid.innerHTML = orderedCats.map(cat => `
    <div class="mf-tpl-category">
      ${mfTemplateFilter === 'all' ? `<div class="mf-tpl-category-label">${mfEsc(MF_CATEGORIES[cat] || cat)}</div>` : ''}
      <div class="mf-tpl-category-grid">
        ${byCat[cat].map(key => {
          const t = MF_TEMPLATES[key];
          return `<div class="mf-template-card" onclick="mfCreateFromTemplate('${key}')">
            <div class="mf-template-icon">${t.icon}</div>
            <h4>${mfEsc(t.name)}</h4>
            <p>${mfEsc(t.desc)}</p>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('') || '<div class="mf-tpl-empty">No templates in this category yet.</div>';
}

function mfToggleTemplatePicker() {
  const el = document.getElementById('mfTemplatePicker');
  if (!el) return;
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}

// ─── GALLERY: MY FORMS GRID ───
function mfRenderFormsGrid() {
  const grid = document.getElementById('mfFormsGrid');
  const empty = document.getElementById('mfFormsEmpty');
  const count = document.getElementById('mfFormCount');
  if (!grid) return;
  count.textContent = mfState.forms.length + ' form' + (mfState.forms.length !== 1 ? 's' : '');
  if (mfState.forms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  const sorted = [...mfState.forms].sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  grid.innerHTML = sorted.map(f => {
    const dt = f.updatedAt ? new Date(f.updatedAt).toLocaleDateString(undefined, {month:'short', day:'numeric'}) : '';
    const isCanvas = f.kind === 'canvas';
    const metaText = isCanvas
      ? (f.pages||[]).length + ' page' + ((f.pages||[]).length !== 1 ? 's' : '') + ' · ' + (f.pages||[]).reduce((n,p) => n + ((p.boxes||[]).length), 0) + ' box' + ((f.pages||[]).reduce((n,p) => n + ((p.boxes||[]).length), 0) !== 1 ? 'es' : '')
      : f.fields.length + ' field' + (f.fields.length !== 1 ? 's' : '');
    return `<div class="mf-form-card" onclick="mfOpenEditor('${f.id}')">
      ${isCanvas ? '<span class="mf-form-tag">Canvas</span>' : ''}
      <h4>${mfEsc(f.title || 'Untitled Form')}</h4>
      <div class="mf-form-meta">${metaText}${dt ? ' · edited ' + dt : ''}</div>
      <div class="mf-form-actions" onclick="event.stopPropagation()">
        <button onclick="mfOpenEditor('${f.id}')">Edit</button>
        <button onclick="mfDuplicateForm('${f.id}')">Duplicate</button>
        <button class="mf-danger" onclick="mfDeleteForm('${f.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function mfEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── CREATE / DUPLICATE / DELETE ───
function mfCreateFromTemplate(key) {
  const tpl = MF_TEMPLATES[key];
  if (!tpl) return;
  // Kadessa can trigger this from ANY panel now (see KADESSA_ACTIONS.mf_create_form /
  // mf_create_from_template) -- previously this function only ever touched
  // Make Forms' own internal gallery/editor toggle (mfOpenEditor), never the
  // top-level section switcher. That meant a form created while the user was
  // looking at, say, PDF Editor was built correctly in mfState and persisted,
  // but the user never saw it: they were still staring at PDF Editor, and the
  // Make Forms section (with the new form's editor inside it) stayed hidden.
  // From the outside this looked exactly like "Kadessa just navigates, she
  // doesn't actually create the form" -- the form WAS created, it just opened
  // in a section nobody was looking at. Switching the section here, before
  // building the form, fixes that regardless of which panel the request
  // originated from. Guarded by an "already there" check so the normal
  // click-a-template-card path (already inside Make Forms) doesn't pay for a
  // redundant navigate() call.
  if (typeof unifiedActiveSection === 'function' && typeof navigate === 'function' && unifiedActiveSection() !== 'makeforms') {
    navigate('makeforms');
  }
  const built = tpl.build();
  const form = {
    id: mfUid('form'),
    title: built.title,
    desc: built.desc || '',
    fields: built.fields.map(f => ({ ...f, id: f.id || mfUid('fld') })),
    logoDataUrl: null,
    accentColor: built.accentColor || '#0073E6',
    watermarkOn: true,
    watermarkOpacity: 8,
    bannerImageDataUrl: null,
    bannerImageOpacity: 15,
    socialLinks: {},
    expiryMode: 'never',
    expiryValue: 1,
    expiryUnit: 'days',
    activeLang: 'original',
    translations: {},
    updatedAt: Date.now()
  };
  mfState.forms.push(form);
  mfPersist();
  document.getElementById('mfTemplatePicker').style.display = 'none';
  mfOpenEditor(form.id);
  toast(key === 'blank' ? 'New form ready, add your logo and details' : 'New form created from "' + tpl.name + '"', 'success');
}

function mfStartBlank() {
  mfCreateFromTemplate('blank');
}

function mfDuplicateForm(id) {
  const f = mfState.forms.find(x => x.id === id);
  if (!f) return;
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = mfUid('form');
  copy.title = (f.title || 'Untitled Form') + ' (Copy)';
  copy.fields = copy.fields.map(fl => ({ ...fl, id: mfUid('fld') }));
  copy.updatedAt = Date.now();
  // A duplicate is a fresh, unpublished form — it must NOT inherit the
  // original's live link. Left as-is, both forms would point at the same
  // publishedId, and syncing/relinking either one would get confused about
  // which local copy the online responses actually belong to. Expiry state
  // is tied to that same publish, so it resets together with it.
  delete copy.publishedId;
  delete copy.shareSlug;
  delete copy.publishedAt;
  copy.expiresAt = null;
  copy.expiryAppliedMode = undefined;
  copy.expiryAppliedValue = undefined;
  copy.expiryAppliedUnit = undefined;
  mfState.forms.push(copy);
  mfPersist();
  mfRenderFormsGrid();
  toast('Form duplicated', 'success');
}
function mfDuplicateCurrent() {
  if (!mfState.currentId) return;
  const f = mfState.forms.find(x => x.id === mfState.currentId);
  if (!f) return;
  mfDuplicateForm(f.id);
  mfBackToGallery();
}

function mfDeleteForm(id) {
  const f = mfState.forms.find(x => x.id === id);
  if (!f) return;
  if (!confirm('Delete "' + (f.title || 'Untitled Form') + '"? This cannot be undone.')) return;
  mfState.forms = mfState.forms.filter(x => x.id !== id);
  mfPersist();
  if (mfState.currentId === id) { mfBackToGallery(); }
  else { mfRenderFormsGrid(); }
  toast('Form deleted', 'info');
}

// ─── EDITOR ───
function mfGetCurrentForm() { return mfState.forms.find(f => f.id === mfState.currentId); }

function mfOpenEditor(id) {
  mfStopAutoSync();
  const f = mfState.forms.find(x => x.id === id);
  if (!f) return;
  if (f.kind === 'canvas') { mfcOpenEditor(id); return; }
  // Old forms saved before the translation/social-links features existed
  // won't have these yet — default them in place so every other function
  // can assume they exist.
  if (f.activeLang == null) f.activeLang = 'original';
  if (f.translations == null) f.translations = {};
  if (f.socialLinks == null) f.socialLinks = {};
  if (f.attachmentFolders == null) f.attachmentFolders = [];
  if (f.expiryMode == null) f.expiryMode = 'never';
  if (f.expiryValue == null) f.expiryValue = 1;
  if (f.expiryUnit == null) f.expiryUnit = 'days';
  mfState.currentId = id;
  mfMode = 'design';
  mfActiveResponseId = null;
  mfDraftValues = {};
  document.getElementById('mfGalleryView').style.display = 'none';
  document.getElementById('mfEditorView').style.display = 'block';
  document.getElementById('mfFormTitleInput').value = f.title || '';
  document.getElementById('mfFormDescInput').value = f.desc || '';
  // Reset to the Design tab and make sure the preview panel lives back in
  // its off-screen home, in case a previously-open form was left mid-Fill.
  const tabD = document.getElementById('mfTabDesign'), tabF = document.getElementById('mfTabFill');
  if (tabD) tabD.classList.add('active');
  if (tabF) tabF.classList.remove('active');
  const bodyD = document.getElementById('mfEditorBodyDesign'), bodyF = document.getElementById('mfEditorBodyFill');
  if (bodyD) bodyD.style.display = 'grid';
  if (bodyF) bodyF.style.display = 'none';
  const panel = document.getElementById('mfPreviewPanel'), designSlot = document.getElementById('mfDesignPreviewSlot');
  if (panel && designSlot) { panel.classList.add('mf-preview-visible'); designSlot.appendChild(panel); }
  mfRenderFieldList();
  mfRenderLogoThumb();
  mfRenderAccentSwatches();
  mfRenderWatermarkControls();
  mfRenderSocialLinks();
  mfRenderAttachments();
  mfRenderPreview();
  mfUpdateFillStatus();
  mfRenderResponsesList();
  mfRenderExpiryControls();
  mfStartExpiryClock();
}

function mfBackToGallery() {
  mfStopAutoSync();
  mfStopExpiryClock();
  mfState.currentId = null;
  const gv = document.getElementById('mfGalleryView');
  const ev = document.getElementById('mfEditorView');
  const cv = document.getElementById('mfcView');
  if (gv) gv.style.display = 'block';
  if (ev) ev.style.display = 'none';
  if (cv) cv.style.display = 'none';
  mfRenderTemplateGrid();
  mfRenderFormsGrid();
}

function mfTouch(f) { f.updatedAt = Date.now(); mfPersist(); }

function mfUpdateTitle(val) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.title = val; mfTouch(f); mfRenderPreview();
}
function mfUpdateDesc(val) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.desc = val; mfTouch(f); mfRenderPreview();
}

// ─── FORM EXPIRATION ───
// A form can be set to 'never' expire, or 'timed' — accept responses for a
// set duration then automatically stop, without the owner having to
// remember to manually unpublish it. The actual cutoff timestamp
// (f.expiresAt) is computed once, at publish time (see mfPublishForm),
// from real calendar arithmetic (setMonth/setFullYear, not a fixed ms
// approximation) so "3 months" and "1 year" land on the real corresponding
// calendar date rather than a rough 30/365-day estimate. Enforcement of the
// cutoff happens server-side in the Worker — this local state only decides
// WHAT to compute and lets the owner see/manage it from the editor.
function mfComputeExpiresAt(fromTs, value, unit) {
  const d = new Date(fromTs);
  const n = Math.max(1, Math.round(Number(value) || 1));
  switch (unit) {
    case 'minutes': d.setMinutes(d.getMinutes() + n); break;
    case 'hours':   d.setHours(d.getHours() + n); break;
    case 'days':    d.setDate(d.getDate() + n); break;
    case 'months':  d.setMonth(d.getMonth() + n); break;
    case 'years':   d.setFullYear(d.getFullYear() + n); break;
    default:        d.setDate(d.getDate() + n);
  }
  return d.getTime();
}

function mfSetExpiryMode(mode) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.expiryMode = mode;
  if (mode === 'never') f.expiresAt = null;
  mfTouch(f);
  mfRenderExpiryControls();
}
function mfSetExpiryValue(val) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.expiryValue = val === '' ? '' : Math.max(1, Math.round(Number(val) || 1));
  mfTouch(f);
  mfRenderExpiryControls();
}
function mfSetExpiryUnit(unit) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.expiryUnit = unit;
  mfTouch(f);
  mfRenderExpiryControls();
}

function mfExpiryStatusText(f) {
  if (!f.expiryMode || f.expiryMode === 'never') return 'This form never expires.';
  if (!f.publishedId) return 'Timer starts once you publish.';
  if (!f.expiresAt) return 'Will start accepting responses once published.';
  const now = Date.now();
  if (now >= f.expiresAt) return 'Expired on ' + new Date(f.expiresAt).toLocaleString() + ' — no longer accepting responses.';
  const diffMs = f.expiresAt - now;
  const mins = Math.round(diffMs / 60000);
  let label;
  if (mins < 60) label = mins + ' minute' + (mins === 1 ? '' : 's');
  else if (mins < 1440) label = Math.round(mins / 60) + ' hour' + (Math.round(mins / 60) === 1 ? '' : 's');
  else label = Math.round(mins / 1440) + ' day' + (Math.round(mins / 1440) === 1 ? '' : 's');
  return 'Expires in ' + label + ' (' + new Date(f.expiresAt).toLocaleString() + ').';
}

function mfRenderExpiryControls() {
  const f = mfGetCurrentForm(); if (!f) return;
  const modeNever = document.getElementById('mfExpiryModeNever');
  const modeTimed = document.getElementById('mfExpiryModeTimed');
  const valueInput = document.getElementById('mfExpiryValue');
  const unitSelect = document.getElementById('mfExpiryUnit');
  const status = document.getElementById('mfExpiryStatus');
  const renewBtn = document.getElementById('mfExpiryRenewBtn');
  if (!modeNever) return;
  const mode = f.expiryMode || 'never';
  modeNever.checked = mode === 'never';
  modeTimed.checked = mode === 'timed';
  if (valueInput) { valueInput.value = f.expiryValue == null ? 1 : f.expiryValue; valueInput.disabled = mode !== 'timed'; }
  if (unitSelect) { unitSelect.value = f.expiryUnit || 'days'; unitSelect.disabled = mode !== 'timed'; }
  if (status) status.textContent = mfExpiryStatusText(f);
  const isExpired = mode === 'timed' && f.expiresAt && Date.now() >= f.expiresAt;
  if (renewBtn) renewBtn.style.display = isExpired ? 'inline-flex' : 'none';
}

// Keeps the "Expires in Xh" line honest without needing a page reload —
// mirrors the existing mfAutoSyncTickTimer pattern used for sync status.
let mfExpiryClockTimer = null;
function mfStartExpiryClock() {
  mfStopExpiryClock();
  mfExpiryClockTimer = setInterval(function () {
    if (document.getElementById('mfExpiryRow') && mfMode === 'design') mfRenderExpiryControls();
  }, 30000);
}
function mfStopExpiryClock() {
  if (mfExpiryClockTimer) { clearInterval(mfExpiryClockTimer); mfExpiryClockTimer = null; }
}

// Lets the owner reactivate an already-expired form without changing its
// duration setting — re-arms the same "3 days" (etc.) starting from right
// now, and pushes just that one field to Supabase rather than a full
// republish, since nothing else about the form changed.
async function mfRenewFormExpiry() {
  const f = mfGetCurrentForm(); if (!f || !f.publishedId) return;
  const newExpiresAt = mfComputeExpiresAt(Date.now(), f.expiryValue || 1, f.expiryUnit || 'days');
  try {
    const { error } = await sarvarcSupabase
      .from('forms')
      .update({ expires_at: new Date(newExpiresAt).toISOString(), status: 'active' })
      .eq('id', f.publishedId);
    if (error) throw error;
    f.expiresAt = newExpiresAt;
    f.expiryAppliedMode = f.expiryMode;
    f.expiryAppliedValue = f.expiryValue;
    f.expiryAppliedUnit = f.expiryUnit;
    mfPersist();
    mfRegisterPublish(f.id, { publishedId: f.publishedId, shareSlug: f.shareSlug, publishedAt: f.publishedAt, expiresAt: f.expiresAt });
    mfRenderExpiryControls();
    toast('Form renewed — accepting responses again', 'success');
  } catch (err) {
    toast('Could not renew: ' + (err.message || 'unknown error'), 'error');
  }
}
window.mfSetExpiryMode = mfSetExpiryMode;
window.mfSetExpiryValue = mfSetExpiryValue;
window.mfSetExpiryUnit = mfSetExpiryUnit;
window.mfRenewFormExpiry = mfRenewFormExpiry;

function mfAddField(type) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.fields.push(mfNewField(type));
  mfTouch(f);
  mfRenderFieldList();
  mfRenderPreview();
  const list = document.getElementById('mfFieldList');
  if (list) list.scrollTop = list.scrollHeight;
}
function mfRemoveField(fieldId) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.fields = f.fields.filter(fl => fl.id !== fieldId);
  mfTouch(f);
  mfRenderFieldList();
  mfRenderPreview();
}
function mfMoveField(fieldId, dir) {
  const f = mfGetCurrentForm(); if (!f) return;
  const i = f.fields.findIndex(fl => fl.id === fieldId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= f.fields.length) return;
  [f.fields[i], f.fields[j]] = [f.fields[j], f.fields[i]];
  mfTouch(f);
  mfRenderFieldList();
  mfRenderPreview();
}
function mfUpdateFieldProp(fieldId, prop, val) {
  const f = mfGetCurrentForm(); if (!f) return;
  const fl = f.fields.find(x => x.id === fieldId); if (!fl) return;
  fl[prop] = val;
  mfTouch(f);
  mfRenderPreview();
}
function mfUpdateFieldOptions(fieldId, val) {
  const f = mfGetCurrentForm(); if (!f) return;
  const fl = f.fields.find(x => x.id === fieldId); if (!fl) return;
  fl.options = val.split(',').map(s => s.trim()).filter(Boolean);
  if (fl.options.length === 0) fl.options = ['Option 1'];
  mfTouch(f);
  mfRenderPreview();
}
function mfToggleFieldRequired(fieldId, checked) {
  mfUpdateFieldProp(fieldId, 'required', !!checked);
}

function mfRenderFieldList() {
  const f = mfGetCurrentForm();
  const wrap = document.getElementById('mfFieldList');
  if (!f || !wrap) return;
  if (f.fields.length === 0) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--text3);text-align:center;padding:20px 0">No fields yet, add one below.</div>';
    return;
  }
  wrap.innerHTML = f.fields.map((fl, idx) => {
    const needsOptions = fl.type === 'select' || fl.type === 'mcq';
    const canRequire = fl.type !== 'heading';
    return `<div class="mf-field-item">
      <div class="mf-field-item-head">
        <span class="mf-field-type-tag">${MF_TYPE_NAMES[fl.type] || fl.type}</span>
        <input type="text" class="mf-field-input" value="${mfEsc(fl.label)}" placeholder="Field label"
          oninput="mfUpdateFieldProp('${fl.id}','label',this.value)">
        <div class="mf-field-btns">
          <button onclick="mfMoveField('${fl.id}',-1)" title="Move up" ${idx===0?'disabled':''}>↑</button>
          <button onclick="mfMoveField('${fl.id}',1)" title="Move down" ${idx===f.fields.length-1?'disabled':''}>↓</button>
          <button class="mf-danger" onclick="mfRemoveField('${fl.id}')" title="Remove">✕</button>
        </div>
      </div>
      ${needsOptions ? `<div class="mf-field-row2">
        <input type="text" class="mf-field-input" style="flex:1" value="${mfEsc((fl.options||[]).join(', '))}"
          placeholder="Options, comma separated" oninput="mfUpdateFieldOptions('${fl.id}',this.value)">
      </div>` : ''}
      ${fl.type === 'signature' ? `<div class="mf-field-row2"><span style="font-size:10.5px;color:var(--text3)">Signers can draw, type, or upload an image or PDF.</span></div>` : ''}
      ${canRequire ? `<div class="mf-field-row2">
        <label><input type="checkbox" ${fl.required?'checked':''} onchange="mfToggleFieldRequired('${fl.id}',this.checked)"> Required</label>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ─── BRANDING: LOGO ───
function mfRenderLogoThumb() {
  const f = mfGetCurrentForm();
  const thumb = document.getElementById('mfLogoThumb');
  const removeBtn = document.getElementById('mfLogoRemoveBtn');
  if (!f || !thumb) return;
  if (f.logoDataUrl) {
    thumb.innerHTML = `<img src="${f.logoDataUrl}" alt="Logo">`;
    if (removeBtn) removeBtn.style.display = 'inline-block';
  } else {
    thumb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    if (removeBtn) removeBtn.style.display = 'none';
  }
  const wmRow = document.getElementById('mfWatermarkRow');
  if (wmRow) wmRow.style.display = f.logoDataUrl ? 'flex' : 'none';
}

// ─── BRANDING: WATERMARK ───
function mfRenderWatermarkControls() {
  const f = mfGetCurrentForm();
  const toggle = document.getElementById('mfWatermarkToggle');
  const slider = document.getElementById('mfWatermarkOpacity');
  const val = document.getElementById('mfWatermarkOpacityVal');
  const wmRow = document.getElementById('mfWatermarkRow');
  if (!f || !toggle || !slider) return;
  const opacity = f.watermarkOpacity == null ? 8 : f.watermarkOpacity;
  toggle.checked = f.watermarkOn !== false;
  slider.value = opacity;
  if (val) val.textContent = opacity + '%';
  if (wmRow) wmRow.style.display = f.logoDataUrl ? 'flex' : 'none';
  // Keep the separate Banner Image controls in sync everywhere the logo
  // watermark controls are refreshed (opening a form, switching forms,
  // applying an asset) rather than needing a second call wired in at
  // every one of those call sites.
  if (typeof mfRenderBannerControls === 'function') mfRenderBannerControls();
}

function mfToggleWatermark(checked) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.watermarkOn = !!checked;
  mfTouch(f);
  mfRenderPreview();
}

function mfSetWatermarkOpacity(val) {
  const f = mfGetCurrentForm(); if (!f) return;
  const n = Math.min(10, Math.max(5, Number(val) || 8));
  f.watermarkOpacity = n;
  const label = document.getElementById('mfWatermarkOpacityVal');
  if (label) label.textContent = n + '%';
  mfTouch(f);
  mfRenderPreview();
}

// ─── LANGUAGE / TRANSLATION ───
// Translates the whole form (title, description, field labels, dropdown
// options) into another language using the same free MyMemory Translation
// API the PDF Editor's "Translate" tool already uses (sarvarcTranslateText,
// defined further down). The original text is never overwritten — it's
// cached per-language on f.translations and f.activeLang just picks which
// one the Live Preview / Export PDF / Push to Workspace currently render,
// so switching back to "Original" always gets the exact source text back.
const MF_LANG_NAMES = {
  hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', ta: 'Tamil', te: 'Telugu',
  bn: 'Bengali', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
  ar: 'Arabic', zh: 'Chinese', ja: 'Japanese'
};
// Each translation flow gets its OWN busy flag. These used to share a
// single global (mfLangTranslating), which meant a canvas-form translation
// in progress would make the field-based Make Forms Translate button think
// IT was already busy (and silently refuse to run — "Already translating,
// please wait"), and vice versa. Two independent flows, two independent
// flags — one feature can never block the other.
let mfFormLangBusy = false;   // field-based Make Forms (mfSwitchFormLanguage)
let mfCanvasLangBusy = false; // canvas Make Forms (mfcSwitchLanguage)

// ─── LANGUAGE / TRANSLATION — CANVAS FORMS ───
// Same idea as the field-based form's language switcher above, adapted to
// the canvas builder's free-form text boxes. Selecting a language in the
// dropdown does NOT fire a translation by itself — the dropdown only stages
// the target language. Translation only runs when "Translate" (or
// "Re-translate") is actually clicked, so it can never be skipped by
// accident right before Export PDF / Push to Workspace / Print, all of
// which rasterize the same #mfcPages DOM that mfcRenderPages() just drew.
function mfcRenderLangControls() {
  const f = mfcGetForm();
  const sel = document.getElementById('mfcLangSelect');
  const translateBtn = document.getElementById('mfcTranslateBtn');
  const retBtn = document.getElementById('mfcRetranslateBtn');
  const saveBtn = document.getElementById('mfcSaveNewBtn');
  const status = document.getElementById('mfcLangStatus');
  if (!f || !sel) return;
  sel.value = f.activeLang || 'original';
  const isTranslated = (f.activeLang && f.activeLang !== 'original');
  if (translateBtn) translateBtn.disabled = !!mfCanvasLangBusy;
  if (retBtn) retBtn.style.display = isTranslated ? 'inline-block' : 'none';
  if (saveBtn) saveBtn.style.display = isTranslated ? 'inline-block' : 'none';
  if (status && !mfCanvasLangBusy) {
    status.className = 'mf-lang-status';
    status.textContent = isTranslated
      ? `Showing ${MF_LANG_NAMES[f.activeLang] || f.activeLang} translation — text boxes are read-only, switch to "Original" to edit`
      : '';
  }
}

// Walks every text box across every page and returns a flat list the
// caller can translate one string at a time, keyed by box id.
function mfcCollectTranslatableStrings(f) {
  const items = [];
  (f.pages || []).forEach(pg => (pg.boxes || []).forEach(b => {
    if (b.text && b.text.trim()) items.push({ id: b.id, text: b.text });
  }));
  return items;
}

// Called by the dropdown's onchange — selecting any language, including
// "Original", immediately triggers the switch (and the translation, for a
// language not yet cached). This is the "pick a language and it just
// translates itself" behavior; the separate Translate/Re-translate buttons
// stay around purely as an explicit retry if a translation ever partially
// fails.
function mfcLangSelectChanged(val) {
  mfcSwitchLanguage(val);
}
function mfcTranslateClick() {
  const sel = document.getElementById('mfcLangSelect');
  if (!sel) return;
  mfcSwitchLanguage(sel.value, true);
}

async function mfcSwitchLanguage(lang, force) {
  const f = mfcGetForm(); if (!f) return;
  if (f.activeLang == null) f.activeLang = 'original';
  if (f.translations == null) f.translations = {};
  const sel = document.getElementById('mfcLangSelect');
  if (lang === 'original') {
    f.activeLang = 'original';
    mfTouch(f);
    mfcRenderLangControls();
    mfcRenderPages();
    return;
  }
  if (!force && f.translations[lang]) {
    // Already translated once — just switch to the cached version, no
    // network calls needed.
    f.activeLang = lang;
    mfTouch(f);
    mfcRenderLangControls();
    mfcRenderPages();
    return;
  }
  if (mfCanvasLangBusy) { toast('Already translating — please wait for it to finish', 'info'); if (sel) sel.value = f.activeLang || 'original'; return; }
  const langName = MF_LANG_NAMES[lang] || lang;
  // Selecting the language IS the opt-in — translate immediately instead of
  // pausing on a second confirm dialog, which could otherwise leave this
  // stuck forever if that dialog's promise never resolved for any reason
  // (looks exactly like "nothing happens": dropdown shows the new language,
  // canvas silently stays in English).
  mfCanvasLangBusy = true;
  const status = document.getElementById('mfcLangStatus');
  if (status) { status.className = 'mf-lang-status mf-lang-busy'; status.textContent = `Translating into ${langName}…`; }
  const translateBtn = document.getElementById('mfcTranslateBtn');
  if (translateBtn) translateBtn.disabled = true;
  toast(`Translating canvas form into ${langName}…`, 'info');
  const items = mfcCollectTranslatableStrings(f);
  const result = {};
  let okCount = 0, errCount = 0;
  for (const item of items) {
    let translated = item.text;
    try {
      translated = await sarvarcTranslateText(item.text, lang);
      okCount++;
    } catch (e) {
      errCount++; // fall back to original text for this one box
      console.error('mfcSwitchLanguage: failed to translate box "' + item.id + '":', e);
    }
    result[item.id] = translated;
    await new Promise(r => setTimeout(r, 350)); // stay well within the free API's rate limit
  }
  f.translations[lang] = result;
  mfCanvasLangBusy = false;
  if (translateBtn) translateBtn.disabled = false;
  // A total failure (every single string fell back to its original text)
  // would otherwise leave the canvas looking untouched with no visible sign
  // anything went wrong — back the switcher out to Original instead.
  const totalFailure = items.length > 0 && okCount === 0;
  if (totalFailure) {
    f.activeLang = 'original';
    mfTouch(f);
    mfcRenderLangControls();
    mfcRenderPages();
    if (status) { status.className = 'mf-lang-status mf-lang-error'; status.textContent = `Couldn't reach the translation service — nothing was translated`; }
    if (sel) sel.value = 'original';
    toast(`Translation into ${langName} failed — the free translation service didn't respond usefully (likely today's free quota, or no internet access right now). Try again in a bit.`, 'error');
    return;
  }
  f.activeLang = lang;
  mfTouch(f);
  mfcRenderLangControls();
  mfcRenderPages();
  if (errCount) {
    if (status) { status.className = 'mf-lang-status mf-lang-error'; status.textContent = `Translated ${okCount}, ${errCount} kept original (retry with Re-translate)`; }
    toast(`Translated into ${langName} — ${errCount} string(s) kept their original text, try Re-translate`, 'error');
  } else {
    toast(`Canvas form translated into ${langName}`, 'success');
  }
}

// Bakes the currently-active translation into a brand-new, independent
// canvas form (its own id, its own boxes set to the translated text, no
// lingering translations cache) so it can be edited and exported on its
// own without touching the source-language form.
function mfcSaveTranslationAsNewForm() {
  const f = mfcGetForm();
  if (!f || !f.activeLang || f.activeLang === 'original') { toast('Select a translated language first', 'error'); return; }
  const tr = f.translations && f.translations[f.activeLang];
  if (!tr) { toast('No translation cached for this language yet', 'error'); return; }
  const langName = MF_LANG_NAMES[f.activeLang] || f.activeLang;
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = mfUid('form');
  copy.title = (f.title || 'Untitled Canvas Form') + ` (${langName})`;
  copy.pages = copy.pages.map(pg => ({
    ...pg,
    id: mfUid('pg'),
    boxes: (pg.boxes || []).map(b => {
      const nb = { ...b, id: mfUid('box') };
      if (tr[b.id] != null) nb.text = tr[b.id];
      return nb;
    })
  }));
  copy.activeLang = 'original';
  copy.translations = {};
  copy.updatedAt = Date.now();
  mfState.forms.push(copy);
  mfPersist();
  toast(`Saved as new form: "${copy.title}"`, 'success');
  mfcOpenEditor(copy.id);
}

function mfHandleLogoUpload(input) {
  const f = mfGetCurrentForm();
  const file = input.files && input.files[0];
  if (!f || !file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MF_LOGO_MAX_DIM / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      f.logoDataUrl = c.toDataURL('image/png');
      if (f.watermarkOn == null) f.watermarkOn = true;
      if (f.watermarkOpacity == null) f.watermarkOpacity = 8;
      // Auto-store in the Assets library (right panel) so this logo can be
      // reused on other forms/documents without re-uploading the file.
      if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('logo', f.logoDataUrl, file.name);

      // Auto-theme the form to the logo's own brand color — same extraction
      // Refine Report uses for headings/tables — so the accent divider,
      // section headings, field focus rings, and checkboxes pick up the
      // company's actual brand color instead of the generic default blue.
      let brandColors = [];
      try { brandColors = await pdfedExtractLogoColors(f.logoDataUrl); } catch (err) { console.error('Logo color extraction failed', err); }
      if (brandColors.length) f.accentColor = brandColors[0];

      mfTouch(f);
      mfRenderLogoThumb();
      mfRenderWatermarkControls();
      mfRenderAccentSwatches();
      mfRenderPreview();
      toast(brandColors.length
        ? 'Logo added — theme color matched to your brand automatically'
        : 'Logo added, placed as a centered watermark automatically', 'success');
    };
    img.onerror = () => toast('Could not read that image', 'error');
    img.src = e.target.result;
  };
  reader.onerror = () => toast('Could not read that file', 'error');
  reader.readAsDataURL(file);
  input.value = '';
}

// Same processing as mfHandleLogoUpload above, but takes an already-decoded
// image data URL directly instead of reading a <input type=file> -- this is
// what lets Kadessa apply a logo the person attached in chat (see
// kadessaPendingAttachments in the KADESSA ASSISTANT MODULE) without needing a
// fake file input round trip. Returns a promise so the caller can report
// whether a brand color was actually picked up.
function mfSetLogoFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const f = mfGetCurrentForm();
    if (!f) { reject(new Error('no form open')); return; }
    const img = new Image();
    img.onload = async () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MF_LOGO_MAX_DIM / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      f.logoDataUrl = c.toDataURL('image/png');
      if (f.watermarkOn == null) f.watermarkOn = true;
      if (f.watermarkOpacity == null) f.watermarkOpacity = 8;
      if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('logo', f.logoDataUrl, 'logo.png');
      let brandColors = [];
      try { brandColors = await pdfedExtractLogoColors(f.logoDataUrl); } catch (err) { console.error('Logo color extraction failed', err); }
      if (brandColors.length) f.accentColor = brandColors[0];
      mfTouch(f);
      mfRenderLogoThumb();
      mfRenderWatermarkControls();
      mfRenderAccentSwatches();
      mfRenderPreview();
      resolve({ brandColorApplied: brandColors.length > 0 });
    };
    img.onerror = () => reject(new Error('could not read that image'));
    img.src = dataUrl;
  });
}

function mfRemoveLogo() {
  const f = mfGetCurrentForm(); if (!f) return;
  f.logoDataUrl = null;
  mfTouch(f);
  mfRenderLogoThumb();
  mfRenderWatermarkControls();
  mfRenderPreview();
}

// ─── BRANDING: FESTIVE / BANNER IMAGE ───
// Separate from the logo watermark above — this lets the form owner drop in
// ANY picture (a Diwali/Christmas graphic, a company campaign banner, a
// one-off announcement image) that shows up faint, full-bleed, behind the
// header card only. Independent toggle/opacity from the logo watermark, so
// both can be used together or on their own.
function mfRenderBannerThumb() {
  const f = mfGetCurrentForm();
  const thumb = document.getElementById('mfBannerThumb');
  const removeBtn = document.getElementById('mfBannerRemoveBtn');
  if (!f || !thumb) return;
  if (f.bannerImageDataUrl) {
    thumb.innerHTML = `<img src="${f.bannerImageDataUrl}" alt="Banner">`;
    if (removeBtn) removeBtn.style.display = 'inline-block';
  } else {
    thumb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    if (removeBtn) removeBtn.style.display = 'none';
  }
  const row = document.getElementById('mfBannerRow');
  if (row) row.style.display = f.bannerImageDataUrl ? 'flex' : 'none';
}

function mfRenderBannerControls() {
  const f = mfGetCurrentForm();
  const slider = document.getElementById('mfBannerOpacity');
  const val = document.getElementById('mfBannerOpacityVal');
  if (!f || !slider) { mfRenderBannerThumb(); return; }
  const opacity = f.bannerImageOpacity == null ? 15 : f.bannerImageOpacity;
  slider.value = opacity;
  if (val) val.textContent = opacity + '%';
  mfRenderBannerThumb();
}

function mfHandleBannerUpload(input) {
  const f = mfGetCurrentForm();
  const file = input.files && input.files[0];
  if (!f || !file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MF_BANNER_MAX_DIM / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      f.bannerImageDataUrl = c.toDataURL('image/jpeg', 0.9);
      if (f.bannerImageOpacity == null) f.bannerImageOpacity = 15;
      // Auto-store in the Assets library so this same festival/campaign
      // image can be reused on other forms without re-uploading the file.
      if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('banner', f.bannerImageDataUrl, file.name);
      mfTouch(f);
      mfRenderBannerControls();
      mfRenderPreview();
      toast('Header background image added', 'success');
    };
    img.onerror = () => toast('Could not read that image', 'error');
    img.src = e.target.result;
  };
  reader.onerror = () => toast('Could not read that file', 'error');
  reader.readAsDataURL(file);
  input.value = '';
}

// dataUrl-based counterpart to mfHandleBannerUpload, mirroring the
// mfSetLogoFromDataUrl pattern above -- lets Kadessa apply a header banner
// image from something the person attached in chat.
function mfSetBannerFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const f = mfGetCurrentForm();
    if (!f) { reject(new Error('no form open')); return; }
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MF_BANNER_MAX_DIM / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      f.bannerImageDataUrl = c.toDataURL('image/jpeg', 0.9);
      if (f.bannerImageOpacity == null) f.bannerImageOpacity = 15;
      if (typeof sarvarcAssetSave === 'function') sarvarcAssetSave('banner', f.bannerImageDataUrl, 'banner.jpg');
      mfTouch(f);
      mfRenderBannerControls();
      mfRenderPreview();
      resolve();
    };
    img.onerror = () => reject(new Error('could not read that image'));
    img.src = dataUrl;
  });
}

function mfRemoveBanner() {
  const f = mfGetCurrentForm(); if (!f) return;
  f.bannerImageDataUrl = null;
  mfTouch(f);
  mfRenderBannerControls();
  mfRenderPreview();
}

function mfSetBannerOpacity(val) {
  const f = mfGetCurrentForm(); if (!f) return;
  const n = Math.min(40, Math.max(5, Number(val) || 15));
  f.bannerImageOpacity = n;
  const label = document.getElementById('mfBannerOpacityVal');
  if (label) label.textContent = n + '%';
  mfTouch(f);
  mfRenderPreview();
}

// ─── ATTACHMENTS: named folders of files that travel with the form ───
// Lives on f.attachmentFolders — [{ id, name, files:[{ id, name, size,
// type, addedAt }] }]. Metadata only: the actual file bytes live in
// mfAttachBlobs / IndexedDB (see mfLoadAttachmentBlobs/mfPersistAttachmentBlobs
// near mfLoad() above), keyed by file.id, and get stitched back in when
// publishing (see mfPublishForm). Opening a file NEVER navigates the
// current tab: mfOpenAttachmentFile converts the stored data URL to a blob
// URL and window.open()s that in a new tab, so whatever the person has
// already typed into the form (design preview or Fill & Responses draft)
// is completely untouched.
const MF_ATTACH_MAX_FILE_MB = 8; // sanity cap on a single upload — the actual bytes now live in IndexedDB (mfAttachBlobs), not localStorage, so this is generous headroom rather than a hard quota wall

function mfEnsureAttachmentFolders(f) {
  if (!f.attachmentFolders) f.attachmentFolders = [];
  return f.attachmentFolders;
}

function mfAddAttachmentFolder() {
  const f = mfGetCurrentForm(); if (!f) return;
  const name = window.prompt('Folder name (e.g. "Brochure", "Price List")', '');
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) { toast('Folder needs a name', 'error'); return; }
  mfEnsureAttachmentFolders(f).push({ id: mfUid('afold'), name: trimmed, files: [] });
  mfTouch(f);
  mfRenderAttachments();
  toast(`Folder "${trimmed}" added`, 'success');
}

// Real modal version: used by the "+ New Folder" button instead of
// mfAddAttachmentFolder/window.prompt above, specifically so the "Create &
// Choose Files" click is itself the user gesture — that lets the browser's
// native file picker open reliably right after, which chaining input.click()
// after a window.prompt() dialog does not reliably do.
function mfOpenNewFolderModal() {
  const f = mfGetCurrentForm(); if (!f) return;
  const input = document.getElementById('mfNewFolderNameInput');
  if (input) input.value = '';
  document.getElementById('mfNewFolderModalOverlay').classList.add('open');
  setTimeout(() => input && input.focus(), 50);
}

function mfCloseNewFolderModal() {
  const el = document.getElementById('mfNewFolderModalOverlay');
  if (el) el.classList.remove('open');
}

function mfConfirmNewFolder() {
  const f = mfGetCurrentForm(); if (!f) return;
  const input = document.getElementById('mfNewFolderNameInput');
  const trimmed = (input ? input.value : '').trim();
  if (!trimmed) { toast('Folder needs a name', 'error'); return; }
  const folder = { id: mfUid('afold'), name: trimmed, files: [] };
  mfEnsureAttachmentFolders(f).push(folder);
  mfTouch(f);
  mfRenderAttachments();
  mfCloseNewFolderModal();
  toast(`Folder "${trimmed}" added`, 'success');
  mfAttachFileInputClick(folder.id);
}

function mfRenameAttachmentFolder(folderId) {
  const f = mfGetCurrentForm(); if (!f) return;
  const folder = mfEnsureAttachmentFolders(f).find(x => x.id === folderId);
  if (!folder) return;
  const name = window.prompt('Rename folder', folder.name);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  folder.name = trimmed;
  mfTouch(f);
  mfRenderAttachments();
}

function mfDeleteAttachmentFolder(folderId) {
  const f = mfGetCurrentForm(); if (!f) return;
  const folders = mfEnsureAttachmentFolders(f);
  const folder = folders.find(x => x.id === folderId);
  if (!folder) return;
  const count = (folder.files || []).length;
  if (!window.confirm(`Delete folder "${folder.name}"${count ? ` and its ${count} file${count > 1 ? 's' : ''}` : ''}?`)) return;
  (folder.files || []).forEach(file => { delete mfAttachBlobs[file.id]; });
  f.attachmentFolders = folders.filter(x => x.id !== folderId);
  mfTouch(f);
  mfPersistAttachmentBlobs();
  mfRenderAttachments();
}

// The design panel has exactly one hidden <input>; clicking a folder's
// upload button just remembers which folder to file the picked files under.
let mfAttachUploadTargetFolder = null;
function mfAttachFileInputClick(folderId) {
  mfAttachUploadTargetFolder = folderId;
  const input = document.getElementById('mfAttachFileInput');
  if (input) input.click();
}

function mfHandleAttachmentUpload(input) {
  const f = mfGetCurrentForm();
  const folder = f && mfEnsureAttachmentFolders(f).find(x => x.id === mfAttachUploadTargetFolder);
  const files = input.files ? Array.from(input.files) : [];
  if (!f || !folder || !files.length) { input.value = ''; return; }
  let pending = files.length, added = 0, skipped = 0;
  const finish = () => {
    if (--pending > 0) return;
    if (added) { mfTouch(f); mfPersistAttachmentBlobs(); mfRenderAttachments(); }
    if (added && !skipped) toast(`${added} file${added > 1 ? 's' : ''} attached to "${folder.name}"`, 'success');
    else if (added && skipped) toast(`${added} attached, ${skipped} skipped (over ${MF_ATTACH_MAX_FILE_MB}MB)`, 'info');
    else if (skipped) toast(`File too large — ${MF_ATTACH_MAX_FILE_MB}MB limit per file`, 'error');
  };
  files.forEach(file => {
    if (file.size > MF_ATTACH_MAX_FILE_MB * 1024 * 1024) { skipped++; finish(); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const id = mfUid('afile');
      // Binary data goes to the IndexedDB cache (mfPersistAttachmentBlobs,
      // called once below in finish()), not into the form object itself —
      // that's what keeps this out of the size-limited localStorage write.
      mfAttachBlobs[id] = e.target.result;
      folder.files.push({
        id: id, name: file.name, size: file.size,
        type: file.type || 'application/octet-stream',
        addedAt: Date.now()
      });
      added++; finish();
    };
    reader.onerror = () => { skipped++; finish(); };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function mfRemoveAttachmentFile(folderId, fileId) {
  const f = mfGetCurrentForm(); if (!f) return;
  const folder = mfEnsureAttachmentFolders(f).find(x => x.id === folderId);
  if (!folder) return;
  folder.files = (folder.files || []).filter(x => x.id !== fileId);
  delete mfAttachBlobs[fileId];
  mfTouch(f);
  mfPersistAttachmentBlobs();
  mfRenderAttachments();
}

function mfAttachFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function mfDataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma), base64 = dataUrl.slice(comma + 1);
  const mimeMatch = /data:(.*?);base64/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Hassle-free, one click: opens the file in a brand-new tab off a blob URL.
// The current tab never navigates or reloads, so a respondent's in-progress
// answers (and an owner's in-progress design/edits) are never at risk.
async function mfOpenAttachmentFile(folderId, fileId) {
  const f = mfGetCurrentForm(); if (!f) return;
  const folder = mfEnsureAttachmentFolders(f).find(x => x.id === folderId);
  const file = folder && folder.files.find(x => x.id === fileId);
  if (!file) return;
  try {
    // file.dataUrl only exists on attachments saved before the IndexedDB
    // migration (mfLoadAttachmentBlobs) got a chance to run; everything
    // else lives in mfAttachBlobs, keyed by file.id.
    let dataUrl = file.dataUrl || mfAttachBlobs[fileId];
    if (!dataUrl && !mfAttachBlobsLoaded) {
      // Boot's blob-cache load hasn't finished yet — go straight to
      // IndexedDB rather than telling the person the file is missing.
      try { dataUrl = await idbKvGet(MF_ATTACH_STORAGE_KEY).then(m => m && m[fileId]); } catch (e) {}
    }
    if (!dataUrl) { toast('Could not find that file — it may not have finished saving', 'error'); return; }
    const url = URL.createObjectURL(mfDataUrlToBlob(dataUrl));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    console.error('[Make Forms] could not open attachment', e);
    toast('Could not open that file', 'error');
  }
}

function mfAttachFolderMarkup(folder, readonly) {
  const filesHtml = (folder.files || []).length
    ? `<div class="mf-attach-file-list">${folder.files.map(file => `
        <div class="mf-attach-file">
          <span class="mf-attach-file-name" title="${mfEsc(file.name)}" onclick="mfOpenAttachmentFile('${folder.id}','${file.id}')">${mfEsc(file.name)}</span>
          <span class="mf-attach-file-size">${mfAttachFileSize(file.size)}</span>
          ${readonly ? '' : `<button class="mf-attach-icon-btn mf-attach-del" title="Remove file" onclick="mfRemoveAttachmentFile('${folder.id}','${file.id}')">×</button>`}
        </div>`).join('')}</div>`
    : `<div class="mf-attach-empty">No files yet</div>`;
  return `
    <div class="mf-attach-folder">
      <div class="mf-attach-folder-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
        ${readonly
          ? `<span class="mf-attach-folder-name" style="cursor:default">${mfEsc(folder.name)}</span>`
          : `<span class="mf-attach-folder-name" title="Click to rename" onclick="mfRenameAttachmentFolder('${folder.id}')">${mfEsc(folder.name)}</span>`}
        <span class="mf-attach-folder-count">${(folder.files || []).length}</span>
        ${readonly ? '' : `
          <button class="mf-attach-icon-btn" title="Upload files to this folder" onclick="mfAttachFileInputClick('${folder.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg></button>
          <button class="mf-attach-icon-btn mf-attach-del" title="Delete folder" onclick="mfDeleteAttachmentFolder('${folder.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>`}
      </div>
      ${filesHtml}
    </div>`;
}

// Renders both copies at once: the editable list in the Design tab and the
// read-only mirror shown to the right of the form in Fill & Responses
// (standing in for what a respondent sees on the published live form).
function mfRenderAttachments() {
  const f = mfGetCurrentForm();
  const folders = f ? mfEnsureAttachmentFolders(f) : [];

  const designWrap = document.getElementById('mfAttachFolders');
  if (designWrap) {
    designWrap.innerHTML = folders.length
      ? folders.map(folder => mfAttachFolderMarkup(folder, false)).join('')
      : `<div class="mf-attach-empty">No folders yet — add one to start attaching files</div>`;
  }

  const fillWrap = document.getElementById('mfFillAttachFolders');
  if (fillWrap) {
    fillWrap.innerHTML = folders.length
      ? folders.map(folder => mfAttachFolderMarkup(folder, true)).join('')
      : `<div class="mf-fill-attach-empty">No attachments on this form yet.</div>`;
  }
}

// ─── BRANDING: ACCENT COLOR ───
function mfRenderAccentSwatches() {
  const f = mfGetCurrentForm();
  const wrap = document.getElementById('mfAccentSwatches');
  if (!f || !wrap) return;
  const current = f.accentColor || '#0073E6';
  wrap.innerHTML = MF_ACCENT_PRESETS.map(c =>
    `<div class="mf-swatch${c.toLowerCase()===current.toLowerCase()?' active':''}" style="background:${c}" title="${c}" onclick="mfSetAccentColor('${c}')"></div>`
  ).join('') + `<input type="color" class="mf-swatch-custom" value="${current}" title="Custom color" onchange="mfSetAccentColor(this.value)">`;
}

function mfSetAccentColor(hex) {
  const f = mfGetCurrentForm(); if (!f) return;
  f.accentColor = hex;
  mfTouch(f);
  mfRenderAccentSwatches();
  mfRenderPreview();
}

// ─── BRANDING: SOCIAL LINKS ───
// Owner-added company/personal social links — same 5-platform set the
// published respondent page (socialLinksHtml) already knows how to render
// as an icon row. Stored on f.socialLinks = { instagram, linkedin,
// whatsapp, x, website }, all optional, and carried into the publish
// payload as social_links so they show up for respondents on the live form.
const MF_SOCIAL_FIELD_MAP = {
  instagram: 'mfSocialInstagram',
  linkedin: 'mfSocialLinkedin',
  whatsapp: 'mfSocialWhatsapp',
  x: 'mfSocialX',
  youtube: 'mfSocialYoutube',
  website: 'mfSocialWebsite',
};

function mfRenderSocialLinks() {
  const f = mfGetCurrentForm();
  if (!f) return;
  const links = f.socialLinks || {};
  Object.keys(MF_SOCIAL_FIELD_MAP).forEach(key => {
    const input = document.getElementById(MF_SOCIAL_FIELD_MAP[key]);
    if (input) input.value = links[key] || '';
  });
}

function mfSetSocialLink(key, value) {
  const f = mfGetCurrentForm(); if (!f) return;
  if (!f.socialLinks) f.socialLinks = {};
  const trimmed = (value || '').trim();
  if (trimmed) f.socialLinks[key] = trimmed;
  else delete f.socialLinks[key];
  mfTouch(f);
}

// Converts "#rgb" / "#rrggbb" to an "r, g, b" string for rgba(var(...), alpha).
// Returns null for anything unparseable so callers can fall back safely.
function hexToRgbStr(hex) {
  if (!hex) return null;
  const m = String(hex).trim().match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

// Mixes hex1 (pct%) with hex2 ((100-pct)%) and returns a plain "#rrggbb"
// string. This replaces CSS color-mix(in srgb, ...) throughout the preview
// styles: html2canvas-based exporters (PDF export, Push to Workspace) run
// their own CSS parser that doesn't support that CSS Color 4 function and
// fail with "Attempting to parse an unsupported color function" if it's
// present anywhere in the styles applied to the captured element, so every
// accent tint is precomputed here in JS instead and exposed as a plain hex
// custom property.
function mixHex(hex1, pct, hex2) {
  const c1 = hexToRgbStr(hex1), c2 = hexToRgbStr(hex2);
  if (!c1 || !c2) return hex1;
  const [r1, g1, b1] = c1.split(',').map(Number);
  const [r2, g2, b2] = c2.split(',').map(Number);
  const t = pct / 100;
  const mix = (a, b) => Math.round(a * t + b * (1 - t));
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r1, r2))}${toHex(mix(g1, g2))}${toHex(mix(b1, b2))}`;
}

// ─── LIVE PREVIEW (real fillable inputs) ───
function mfRenderPreview() {
  const f = mfGetCurrentForm();
  const page = document.getElementById('mfPreviewPage');
  if (!f || !page) return;
  const vals = (typeof mfDraftValues !== 'undefined' && mfDraftValues) || {};
  const mfAccentHex = f.accentColor || '#0073E6';
  page.style.setProperty('--mf-accent', mfAccentHex);
  const mfAccentRgb = hexToRgbStr(mfAccentHex);
  if (mfAccentRgb) page.style.setProperty('--mf-accent-rgb', mfAccentRgb);
  page.style.setProperty('--mf-accent-topbar', mixHex(mfAccentHex, 45, '#8B5CF6'));
  page.style.setProperty('--mf-accent-header-border', mixHex(mfAccentHex, 18, '#e6e9ee'));
  page.style.setProperty('--mf-accent-header-bg', mixHex(mfAccentHex, 7, '#ffffff'));
  page.style.setProperty('--mf-accent-heading-bg', mixHex(mfAccentHex, 7, '#f7f9fb'));
  page.style.setProperty('--mf-accent-field-hover-border', mixHex(mfAccentHex, 40, '#e3e7ed'));
  page.style.setProperty('--mf-accent-mcq-hover-bg', mixHex(mfAccentHex, 6, '#ffffff'));
  page.style.setProperty('--mf-accent-mcq-hover-border', mixHex(mfAccentHex, 18, '#e3e7ed'));
  // If a translated language is active, render its cached strings instead
  // of the original title/description/field labels/options — this is what
  // makes the Live Preview, Export PDF, and Push to Workspace all show the
  // translated form, since all three ultimately capture this same element.
  // The underlying f.title / f.fields are never touched, so switching back
  // to "Original" (or editing on the left, which always edits the source
  // language) is never destructive.
  const tr = (f.activeLang && f.activeLang !== 'original' && f.translations) ? f.translations[f.activeLang] : null;
  const displayTitle = (tr && tr.title) ? tr.title : (f.title || 'Untitled Form');
  const displayDesc = (tr && tr.desc != null) ? tr.desc : f.desc;
  // The watermark is no longer baked in once here — with a multi-page form
  // the whole point is one centered logo PER A4 sheet, not one centered on
  // the entire (much taller) scrollable content. mfUpdatePreviewPagination(),
  // called at the end of this function, knows the real per-page height once
  // pagination is measured, so it owns populating #mfPvWatermarks with one
  // <img> per page, each centered on its own sheet. This container is just
  // the empty slot it fills in.
  const watermarkHtml = '<div class="mf-pv-watermarks" id="mfPvWatermarks"></div>';
  let html = '';
  const bannerImgHtml = f.bannerImageDataUrl
    ? `<img class="mf-pv-banner-img" src="${f.bannerImageDataUrl}" alt="" style="opacity:${(f.bannerImageOpacity == null ? 15 : f.bannerImageOpacity) / 100}">`
    : '';
  if (f.logoDataUrl || f.bannerImageDataUrl) {
    const logoImgHtml = f.logoDataUrl ? `<img class="mf-pv-logo" src="${f.logoDataUrl}" alt="Logo">` : '';
    html += `<div class="mf-pv-header">${bannerImgHtml}<div class="mf-pv-header-fg">${logoImgHtml}<div class="mf-pv-header-text"><h1>${mfEsc(displayTitle)}</h1></div></div></div>`;
  } else {
    html += `<h1>${mfEsc(displayTitle)}</h1>`;
  }
  if (displayDesc) html += `<div class="mf-pv-desc">${mfEsc(displayDesc)}</div>`;
  if (f.fields.length === 0) {
    html += '<div style="font-size:12px;color:#999;padding:20px 0;text-align:center">Add fields on the left to see them appear here.</div>';
  }
  f.fields.forEach(fl => {
    const fov = tr && tr.fields && tr.fields[fl.id];
    const label = (fov && fov.label) ? fov.label : fl.label;
    const options = (fl.options || []).map((o, i) => (fov && fov.options && fov.options[i] != null) ? fov.options[i] : o);
    const req = fl.required ? '<span class="mf-pv-req">*</span>' : '';
    const id = 'mfin_' + fl.id;
    const v = vals[fl.id];
    switch(fl.type) {
      case 'heading':
        html += `<div class="mf-pv-heading">${mfEsc(label)}</div>`;
        break;
      case 'text':
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}${req}</label><input type="text" id="${id}" data-fid="${fl.id}" class="mf-pv-input" value="${mfEsc(v||'')}"></div>`;
        break;
      case 'number':
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}${req}</label><input type="number" id="${id}" data-fid="${fl.id}" class="mf-pv-input" value="${mfEsc(v||'')}"></div>`;
        break;
      case 'date':
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}${req}</label><input type="date" id="${id}" data-fid="${fl.id}" class="mf-pv-input" value="${mfEsc(v||'')}"></div>`;
        break;
      case 'paragraph':
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}${req}</label><textarea id="${id}" data-fid="${fl.id}" class="mf-pv-textarea" rows="3">${mfEsc(v||'')}</textarea></div>`;
        break;
      case 'select':
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}${req}</label><select id="${id}" data-fid="${fl.id}" class="mf-pv-select-real">` +
          options.map((o, i) => `<option ${(fl.options||[])[i]===v?'selected':''}>${mfEsc(o)}</option>`).join('') + `</select></div>`;
        break;
      case 'checkbox':
        html += `<div class="mf-pv-field mf-pv-check"><input type="checkbox" id="${id}" data-fid="${fl.id}" ${v?'checked':''}><label for="${id}">${mfEsc(label)}${req}</label></div>`;
        break;
      case 'mcq':
        html += `<div class="mf-pv-field mf-pv-mcq"><label>${mfEsc(label)}${req}</label><div class="mf-pv-mcq-opts">` +
          options.map((o, i) => {
            const optVal = (fl.options || [])[i];
            const oid = id + '_' + i;
            return `<label class="mf-pv-mcq-opt" for="${oid}"><input type="radio" id="${oid}" name="${id}" data-fid="${fl.id}" value="${mfEsc(optVal)}" ${optVal === v ? 'checked' : ''}><span>${mfEsc(o)}</span></label>`;
          }).join('') + `</div></div>`;
        break;
      case 'signature': {
        // Signed value (drawn / typed / uploaded image or PDF) or a blank line.
        // The blank line stays exactly as designed; the "click to sign" hint and
        // the Change/Clear tools carry data-html2canvas-ignore so exports stay clean.
        const sv = (typeof SarvarcSign !== 'undefined') ? SarvarcSign.parse(v) : null;
        const live = (typeof mfMode !== 'undefined' && mfMode === 'fill');
        if (sv && (sv.image || sv.file)) {
          const imgOk = sv.image && /^data:image\//.test(sv.image);
          const tools = live
            ? `<div class="mf-pv-sig-tools" data-html2canvas-ignore="true"><button type="button" onclick="mfSigOpen('${fl.id}')">Change</button><button type="button" onclick="mfSigClear('${fl.id}')">Clear</button>${sv.file ? `<button type="button" onclick="mfSigDownloadDraft('${fl.id}')">Download PDF</button>` : ''}</div>`
            : '';
          html += `<div class="mf-pv-field"><div class="mf-pv-sig-signed">${imgOk ? `<img src="${sv.image}" alt="Signature">` : `<span class="mf-pv-sig-file-only">Signature file: ${mfEsc(sv.file ? sv.file.name : '')}</span>`}</div><div class="mf-pv-sig-label">${mfEsc(label)}${req}</div>${tools}</div>`;
        } else if (live) {
          html += `<div class="mf-pv-field"><div class="mf-pv-sig mf-pv-sig-live" onclick="mfSigOpen('${fl.id}')" role="button" tabindex="0"><span class="mf-pv-sig-hint" data-html2canvas-ignore="true">Click to sign: draw, type, or upload an image / PDF</span></div><div class="mf-pv-sig-label">${mfEsc(label)}${req}</div></div>`;
        } else {
          html += `<div class="mf-pv-field"><div class="mf-pv-sig"></div><div class="mf-pv-sig-label">${mfEsc(label)}${req}</div></div>`;
        }
        break;
      }
      default:
        html += `<div class="mf-pv-field"><label>${mfEsc(label)}</label><input type="text" id="${id}" data-fid="${fl.id}" class="mf-pv-input" value="${mfEsc(v||'')}"></div>`;
    }
  });
  page.innerHTML = watermarkHtml + `<div class="mf-pv-content">${html}</div>`;
  mfUpdatePreviewPagination();
}

// Shared A4 page margins for every paginated form surface — the live
// Design-mode preview, Export PDF, and Push to Workspace all reserve
// exactly these margins, so what's shown while building the form is a
// true WYSIWYG match for what actually gets produced. Page 1 keeps its
// own designed top padding (logo/title) as part of its content, so it
// only needs the bottom margin reserved for the footer; every page after
// that reserves both a top margin and a bottom margin.
const MF_PAGE_TOP_MARGIN_MM = 16;
const MF_PAGE_BOTTOM_MARGIN_MM = 14;

// Keeps the Live Preview an accurate, WYSIWYG match for what Export PDF /
// Push to Workspace / Print actually produce. Rather than a dashed line
// drawn over one continuous scroll, this actually paginates the preview:
// it measures every field row / heading's natural position, runs them
// through the exact same smart-break engine Export PDF and Push to
// Workspace use, then inserts a real blank spacer into the DOM at each
// break so the field after it visually starts at the top of the next A4
// sheet, with a genuine top margin — not just "whatever didn't fit". This
// is what lets you see, while still designing the form, exactly how many
// pages it will come out as and where each one begins, before you ever
// push it to the Workspace canvas.
function mfUpdatePreviewPagination() {
  const page = document.getElementById('mfPreviewPage');
  const breaksHost = document.getElementById('mfPreviewPageBreaks');
  const sizeLabel = document.getElementById('mfDesignPreviewSize');
  if (!page) return;
  // Strip spacers from any previous pass before re-measuring — otherwise a
  // resize-triggered re-run would measure its own previously-inserted
  // padding and the page would grow a little more every time it's called.
  page.querySelectorAll('.mf-pv-pagespacer').forEach(el => el.remove());
  const pageRect = page.getBoundingClientRect();
  const pageW = pageRect.width;
  if (!pageW) return;
  const sheetH = pageW * (297 / 210); // one true A4 sheet, in on-screen px
  const topMarginPx = sheetH * (MF_PAGE_TOP_MARGIN_MM / 297);
  const bottomMarginPx = sheetH * (MF_PAGE_BOTTOM_MARGIN_MM / 297);

  const blocks = [];
  page.querySelectorAll('.mf-pv-field, .mf-pv-heading').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    blocks.push({ el, top: r.top - pageRect.top, bottom: r.bottom - pageRect.top, isHeading: el.classList.contains('mf-pv-heading') });
  });
  blocks.sort((a, b) => a.top - b.top);

  // page.scrollHeight isn't safe to use here: .mf-preview-page keeps a
  // minimum one-sheet-tall shape via aspect-ratio even when the real
  // content is much shorter (so a 2-field form still looks like a full
  // page), and scrollHeight reports that floor, not the actual content
  // height. Using it directly made short forms with room to spare get
  // told they need a phantom second page. The true content height is
  // just how far down the last real field/heading actually reaches.
  const naturalHeight = blocks.length ? Math.max(...blocks.map(b => b.bottom)) : page.scrollHeight;
  const naturalBreaks = mfComputeSmartBreaks(naturalHeight, sheetH - bottomMarginPx, sheetH - topMarginPx - bottomMarginPx, blocks);
  const totalPages = naturalBreaks.length - 1;

  // Turn each natural break into a real blank spacer in the DOM flow, so
  // the field after it actually starts at the top of the next sheet.
  // Breaks were measured against the natural (pre-spacer) layout, so each
  // spacer's size accounts for whatever spacers were already inserted
  // above it — no re-measuring needed as we go.
  let insertedSoFar = 0;
  for (let i = 1; i < totalPages; i++) {
    const naturalPos = naturalBreaks[i];
    const targetPos = i * sheetH + topMarginPx;
    const gap = Math.max(0, Math.round(targetPos - (naturalPos + insertedSoFar)));
    const atBlock = blocks.find(b => Math.abs(b.top - naturalPos) < 1) || blocks.find(b => b.top >= naturalPos);
    const spacer = document.createElement('div');
    spacer.className = 'mf-pv-pagespacer';
    spacer.style.height = gap + 'px';
    spacer.innerHTML = `<span class="mf-pv-pagespacer-seam"></span><span class="mf-pv-pagespacer-label">Page ${i + 1} of ${totalPages}</span>`;
    if (atBlock && atBlock.el && atBlock.el.parentNode) {
      atBlock.el.parentNode.insertBefore(spacer, atBlock.el);
    } else {
      page.appendChild(spacer);
    }
    insertedSoFar += gap;
  }

  // One centered logo watermark PER A4 sheet, not one for the whole
  // (much taller, multi-sheet) scrollable content. Now that pagination is
  // measured, sheetH is the true on-screen height of a single page, so page
  // i's vertical center is simply i*sheetH + sheetH/2 in the same
  // coordinate space the pagespacers above were just inserted into.
  const wmHost = document.getElementById('mfPvWatermarks');
  if (wmHost) {
    const f2 = (typeof mfGetCurrentForm === 'function') ? mfGetCurrentForm() : null;
    if (f2 && f2.logoDataUrl && f2.watermarkOn !== false) {
      const op = Math.min(10, Math.max(5, f2.watermarkOpacity == null ? 8 : f2.watermarkOpacity)) / 100;
      let wmHtml = '';
      for (let i = 0; i < totalPages; i++) {
        const centerY = Math.round(i * sheetH + sheetH / 2);
        wmHtml += `<img class="mf-pv-watermark" src="${f2.logoDataUrl}" alt="" style="top:${centerY}px;opacity:${op}">`;
      }
      wmHost.innerHTML = wmHtml;
    } else {
      wmHost.innerHTML = '';
    }
  }

  if (sizeLabel) {
    sizeLabel.textContent = totalPages > 1
      ? `A4 · ${totalPages} pages`
      : 'A4 · 210 × 297 mm';
  }
  // Faint sheet-boundary guides across the now-real page gaps — a light
  // finishing touch on top of the actual spacers above, not the only thing
  // marking a page break anymore.
  if (breaksHost) {
    if (totalPages <= 1) {
      breaksHost.innerHTML = '';
    } else {
      let html = '';
      for (let i = 1; i < totalPages; i++) {
        html += `<div class="mf-pv-pagebreak" style="top:${Math.round(i * sheetH)}px"></div>`;
      }
      breaksHost.innerHTML = html;
    }
  }
}

// ─── FILL & RESPONSES ───
var _k3df1e9_3a1f = 1;
function mfGetResponses(f) {
  if (!f.responses) f.responses = [];
  return f.responses;
}

// ─── PUBLISH TO PUBLIC LINK ───
// Publishing writes/updates a row in the Supabase `forms` table (owned by
// the logged-in user via RLS) and shows a public link that points at the
// standalone respondent page (sarvarc-forms.pages.dev), which itself talks
// to a small Cloudflare Worker for reading the form + accepting submissions.
// Syncing pulls new rows from `form_responses` (written by that Worker)
// into this form's local .responses array, tagged source:'online' so they
// sit alongside hand-filled/local ones without duplicating on repeat sync.
const SARVARC_FORMS_PUBLIC_BASE_URL = 'https://sarvarc-forms.pages.dev';

function mfSlug() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

// Publishing talks to Supabase over the network, so it can genuinely sit
// for a second or two — long enough that a person watching a frozen
// "Publishing…" button label has no way to tell "almost done" from
// "stuck". We reuse the same premium export-overlay (3D drifting sheet +
// progress bar) already shown during PDF/Word/ZIP exports elsewhere in the
// app, staged across the real steps of the publish flow (validate →
// package branding/attachments → save your form → mint the public
// link) so the wait always reads as forward progress, never a stall.
const mfWait = (ms) => new Promise(r => setTimeout(r, ms));

async function mfPublishForm() {
  const f = mfGetCurrentForm();
  if (!f) return;
  // Guard against a stale local state (e.g. an old Session snapshot was
  // just loaded and wiped f.publishedId) making Publish think this form has
  // never gone live before. If the session-proof registry remembers a link
  // for this form id, reattach it here first — that turns this call into an
  // UPDATE of the real existing row instead of an INSERT that would create
  // a second, duplicate public link for the same form.
  if (!f.publishedId) {
    const reg = mfLookupPublish(f.id);
    if (reg && reg.publishedId) {
      f.publishedId = reg.publishedId;
      f.shareSlug = reg.shareSlug;
      f.publishedAt = reg.publishedAt;
      if (reg.expiresAt !== undefined) f.expiresAt = reg.expiresAt;
    }
  }
  const btn = document.getElementById('mfPublishBtn');
  const label = document.getElementById('mfPublishBtnLabel');
  const isUpdate = !!f.publishedId;
  if (btn) btn.disabled = true;
  if (label) label.textContent = isUpdate ? 'Updating…' : 'Publishing…';
  showExportOverlay(
    isUpdate ? 'Updating your form…' : 'Publishing your form…',
    'Preparing form data…'
  );
  try {
    updateExportProgress(10, 'Preparing form data…');
    const { data: { user } } = await sarvarcSupabase.auth.getUser();
    if (!user) { hideExportOverlay(); toast('Please log in first to publish a form', 'error'); return; }

    const hasAssets = !!(f.logoDataUrl || f.bannerImageDataUrl || (f.attachmentFolders && f.attachmentFolders.length));
    await mfWait(220);
    updateExportProgress(30, hasAssets ? 'Packaging branding & attachments…' : 'Validating fields…');

    // Expiration: compute a fresh cutoff only the first time this form goes
    // live, or when the owner has actually changed the mode/value/unit since
    // it was last computed. Without this check, hitting "Update Link" for a
    // routine edit (fixing a typo, adding a field) would quietly push an
    // already-running countdown back out to full length every single time —
    // which defeats the point of setting a fixed expiry in the first place.
    const expiryMode = f.expiryMode || 'never';
    const expirySettingsChanged =
      f.expiryAppliedMode !== expiryMode ||
      f.expiryAppliedValue !== f.expiryValue ||
      f.expiryAppliedUnit !== f.expiryUnit;
    if (expiryMode === 'timed') {
      if (!f.expiresAt || expirySettingsChanged) {
        f.expiresAt = mfComputeExpiresAt(Date.now(), f.expiryValue || 1, f.expiryUnit || 'days');
      }
    } else {
      f.expiresAt = null;
    }
    f.expiryAppliedMode = expiryMode;
    f.expiryAppliedValue = f.expiryValue;
    f.expiryAppliedUnit = f.expiryUnit;

    const payload = {
      owner_id: user.id,
      title: f.title || 'Untitled Form',
      description: f.desc || '',
      fields: f.fields || [],
      require_identity: !!f.requireIdentity,
      status: 'active',
      // null = never expires. A timestamptz the Worker compares against on
      // every read/submit — see handleGetForm/handleSubmit.
      expires_at: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
      // Branding/appearance — everything filled in while building the form
      // (logo, watermark, accent color) must carry over to the published,
      // publicly-shared version, not just live locally in the editor.
      logo_data_url: f.logoDataUrl || null,
      watermark_on: f.logoDataUrl ? (f.watermarkOn !== false) : false,
      watermark_opacity: f.watermarkOpacity == null ? 8 : f.watermarkOpacity,
      // Separate festive/banner image — any picture the owner uploads
      // (festival graphic, campaign banner) shown faint behind the header
      // on the published form, independent of the logo watermark above.
      banner_image_data_url: f.bannerImageDataUrl || null,
      banner_image_opacity: f.bannerImageOpacity == null ? 15 : f.bannerImageOpacity,
      accent_color: f.accentColor || '#0073E6',
      // Owner-added company/personal social links — rendered as an icon row
      // on the published form (see socialLinksHtml on the respondent page).
      social_links: f.socialLinks || {},
      // Named folders of files (brochures, price lists, T&Cs, ...) the
      // respondent can open right on the live form — see the Attachments
      // block in the Design tab, beside Header Background Image.
      // f.attachmentFolders only holds file METADATA now (see
      // mfLoadAttachmentBlobs) — the actual bytes live in mfAttachBlobs, so
      // they're stitched back on here for the published copy, which does
      // need the real data to serve to respondents.
      attachment_folders: (f.attachmentFolders || []).map(folder => Object.assign({}, folder, {
        files: (folder.files || []).map(file => Object.assign({}, file, {
          dataUrl: file.dataUrl || mfAttachBlobs[file.id] || null
        }))
      })),
    };

    await mfWait(200);
    updateExportProgress(55, 'Applying appearance & branding…');
    await mfWait(180);
    updateExportProgress(72, isUpdate ? 'Saving your changes…' : 'Making your form live…');

    let row;
    if (f.publishedId) {
      const { data, error } = await sarvarcSupabase
        .from('forms').update(payload).eq('id', f.publishedId)
        .select('id, share_slug').single();
      if (error) throw error;
      row = data;
    } else {
      payload.share_slug = mfSlug();
      const { data, error } = await sarvarcSupabase
        .from('forms').insert(payload)
        .select('id, share_slug').single();
      if (error) throw error;
      row = data;
    }

    updateExportProgress(92, 'Generating your public link…');
    await mfWait(150);

    f.publishedId = row.id;
    f.shareSlug = row.share_slug;
    f.publishedAt = Date.now();
    mfPersist();
    // Record the link somewhere Sessions can never overwrite, so a future
    // "load an older session" can always find its way back to this exact
    // live row instead of showing the form as unpublished. expiresAt rides
    // along so a session-proof reconnect also restores the correct countdown.
    mfRegisterPublish(f.id, { publishedId: f.publishedId, shareSlug: f.shareSlug, publishedAt: f.publishedAt, expiresAt: f.expiresAt || null });
    mfRenderExpiryControls();

    const link = `${SARVARC_FORMS_PUBLIC_BASE_URL}/?f=${row.share_slug}`;
    completeExportOverlay(isUpdate ? 'Link updated!' : 'Form published!', { module: 'make-forms', format: 'publish' });
    try { await navigator.clipboard.writeText(link); toast('Form published! Link copied to clipboard', 'success'); }
    catch(e) { toast('Form published!', 'success'); }
    window.prompt('Your public form link (already copied if your browser allows it):', link);
  } catch (err) {
    console.error('[Make Forms] publish failed', err);
    hideExportOverlay();
    toast('Could not publish form: ' + (err.message || 'unknown error, check the "forms" table exists'), 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = f.publishedId ? 'Update Link' : 'Publish';
  }
}

async function mfUnpublishForm() {
  const f = mfGetCurrentForm();
  if (!f || !f.publishedId) { toast('This form has not been published yet', 'info'); return; }
  try {
    const { error } = await sarvarcSupabase.from('forms').update({ status: 'paused' }).eq('id', f.publishedId);
    if (error) throw error;
    toast('Form is no longer accepting public responses', 'success');
  } catch (err) {
    toast('Could not unpublish: ' + (err.message || 'unknown error'), 'error');
  }
}

// silent=true is used by the background auto-sync poller: it still pulls in
// new rows and updates the list, but skips the button spinner text and the
// "no new responses" toast so it doesn't interrupt whatever the user's doing.
// Manual clicks on the button always run with silent=false so there's still
// clear feedback that something happened.
let mfAutoSyncTimer = null;
let mfAutoSyncTickTimer = null;
let mfLastSyncedAt = null;

async function mfSyncPublishedResponses(opts) {
  const silent = !!(opts && opts.silent);
  // Background reconciliation (mfReconcilePublishState) needs to sync a
  // specific form that may not be the one currently open in the editor —
  // pass it explicitly via opts.form; manual/auto-sync clicks keep working
  // off whatever's on screen.
  const f = (opts && opts.form) || mfGetCurrentForm();
  if (!f) return;
  const isCurrent = f === mfGetCurrentForm();
  if (!f.publishedId) {
    if (!silent) toast('Publish this form first to collect online responses', 'info');
    return;
  }
  const btn = isCurrent ? document.getElementById('mfSyncBtn') : null;
  if (!silent && btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  try {
    const { data: rows, error } = await sarvarcSupabase
      .from('form_responses')
      .select('id, answers, respondent_name, respondent_email, submitted_at')
      .eq('form_id', f.publishedId)
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    const existing = mfGetResponses(f);
    const existingRemoteIds = new Set(existing.filter(r => r.remoteId).map(r => r.remoteId));
    let added = 0;
    for (const row of (rows || [])) {
      if (existingRemoteIds.has(row.id)) continue;
      existing.push({
        id: mfUid('resp'),
        remoteId: row.id,
        values: await mfSigSlimAnswers(f, row.answers),
        respondentName: row.respondent_name || '',
        respondentEmail: row.respondent_email || '',
        createdAt: new Date(row.submitted_at).getTime(),
        updatedAt: new Date(row.submitted_at).getTime(),
        source: 'online',
      });
      added++;
    }
    mfLastSyncedAt = Date.now();
    if (added) {
      mfPersist();
      if (isCurrent) mfRenderResponsesList();
      // A quiet toast even in silent/background mode is fine — it's the
      // "no new responses" case that would get noisy on a 15s timer. Name
      // the form when it's not the one on screen, so a background catch-up
      // (e.g. right after reopening a stale session) doesn't read as if the
      // currently open form suddenly got new responses.
      toast(isCurrent
        ? `${added} new online response${added > 1 ? 's' : ''} came in`
        : `${added} new response${added > 1 ? 's' : ''} came in for "${f.title || 'Untitled Form'}"`,
        'success');
    } else {
      if (isCurrent) mfRenderSyncStatus();
      if (!silent) toast('No new responses yet', 'success');
    }
  } catch (err) {
    console.error('[Make Forms] sync failed', err);
    if (!silent) toast('Could not sync responses: ' + (err.message || 'unknown error'), 'error');
  } finally {
    if (!silent && btn) { btn.disabled = false; btn.textContent = 'Refresh now'; }
  }
}

function mfRenderSyncStatus() {
  const el = document.getElementById('mfSyncStatus');
  if (!el) return;
  const f = mfGetCurrentForm();
  if (!f || !f.publishedId) { el.textContent = ''; return; }
  el.textContent = mfLastSyncedAt
    ? `Live · checked ${mfTimeAgo(mfLastSyncedAt)}`
    : 'Live · checking…';
}

function mfTimeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

// Polls quietly every 15s while the Fill/Responses tab is open on a
// published form, so new submissions show up without a manual click.
// Stopped whenever we leave that tab or close the form editor entirely.
function mfStartAutoSync() {
  mfStopAutoSync();
  const f = mfGetCurrentForm();
  if (!f || !f.publishedId) return;
  mfSyncPublishedResponses({ silent: true });
  mfAutoSyncTimer = setInterval(() => {
    mfSyncPublishedResponses({ silent: true });
    mfRenderSyncStatus();
  }, 15000);
  // Keep the "checked Xs ago" label ticking even between actual syncs.
  mfAutoSyncTickTimer = setInterval(mfRenderSyncStatus, 5000);
  mfRenderSyncStatus();
}
function mfStopAutoSync() {
  if (mfAutoSyncTimer) { clearInterval(mfAutoSyncTimer); mfAutoSyncTimer = null; }
  if (mfAutoSyncTickTimer) { clearInterval(mfAutoSyncTickTimer); mfAutoSyncTickTimer = null; }
}
window.mfPublishForm = mfPublishForm;
window.mfUnpublishForm = mfUnpublishForm;
window.mfSyncPublishedResponses = mfSyncPublishedResponses;

// Moves the one real preview-panel node between its off-screen Design home
// and the visible Fill-mode slot, rather than keeping two copies in sync.
function mfSwitchMode(mode) {
  const f = mfGetCurrentForm(); if (!f) return;
  mfMode = mode;
  const tabD = document.getElementById('mfTabDesign'), tabF = document.getElementById('mfTabFill');
  if (tabD) tabD.classList.toggle('active', mode === 'design');
  if (tabF) tabF.classList.toggle('active', mode === 'fill');
  const bodyD = document.getElementById('mfEditorBodyDesign'), bodyF = document.getElementById('mfEditorBodyFill');
  if (bodyD) bodyD.style.display = mode === 'design' ? 'grid' : 'none';
  if (bodyF) bodyF.style.display = mode === 'fill' ? 'grid' : 'none';
  const panel = document.getElementById('mfPreviewPanel');
  const fillSlot = document.getElementById('mfFillPreviewSlot');
  const designSlot = document.getElementById('mfDesignPreviewSlot');
  const holder = document.getElementById('mfPreviewOffscreenHolder');
  if (panel && fillSlot && designSlot && holder) {
    if (mode === 'fill') { panel.classList.add('mf-preview-visible'); fillSlot.appendChild(panel); }
    else if (mode === 'design') { panel.classList.add('mf-preview-visible'); designSlot.appendChild(panel); }
    else { panel.classList.remove('mf-preview-visible'); holder.appendChild(panel); }
  }
  if (mode === 'fill') { mfRenderResponsesList(); mfStartAutoSync(); }
  else { mfStopAutoSync(); }
  mfRenderPreview();
  // The preview panel's effective on-screen width can change when it moves
  // between slots (design vs fill columns have different widths), which
  // changes where real A4 page breaks land — re-measure once the browser
  // has actually laid out the panel in its new home.
  requestAnimationFrame(mfUpdatePreviewPagination);
}
window.addEventListener('resize', () => {
  if (typeof mfUpdatePreviewPagination === 'function' && document.getElementById('mfPreviewPage')) {
    mfUpdatePreviewPagination();
  }
});

function mfUpdateFillStatus() {
  const el = document.getElementById('mfFillStatus');
  const btn = document.getElementById('mfSaveRespBtn');
  if (!el) return;
  if (mfActiveResponseId) {
    el.innerHTML = '<span class="mf-fill-status-dot"></span>Editing a saved response';
    el.classList.add('mf-editing');
    if (btn) btn.textContent = 'Update Response';
  } else {
    el.innerHTML = '<span class="mf-fill-status-dot"></span>New response';
    el.classList.remove('mf-editing');
    if (btn) btn.textContent = 'Save Response';
  }
}

function mfNewResponseDraft() {
  mfActiveResponseId = null;
  mfDraftValues = {};
  mfRenderPreview();
  mfUpdateFillStatus();
  mfRenderResponsesList();
}
function mfClearDraft() { mfNewResponseDraft(); }

function mfLoadResponse(id) {
  const f = mfGetCurrentForm(); if (!f) return;
  const r = mfGetResponses(f).find(x => x.id === id);
  if (!r) return;
  mfActiveResponseId = id;
  mfDraftValues = { ...r.values };
  mfRenderPreview();
  mfUpdateFillStatus();
  mfRenderResponsesList();
}

// Reads whatever is currently typed into the live preview inputs, keyed by
// field id — the source of truth while filling is the DOM itself, not a
// shadow copy, so nothing needs to sync on every keystroke.
function mfCollectDraftFromDOM() {
  const f = mfGetCurrentForm(); if (!f) return {};
  const values = {};
  f.fields.forEach(fl => {
    if (fl.type === 'heading') return;
    // Signatures aren't DOM inputs: their value lives in the draft itself.
    if (fl.type === 'signature') { values[fl.id] = (mfDraftValues && mfDraftValues[fl.id]) || ''; return; }
    if (fl.type === 'mcq') {
      const checked = document.querySelector('input[name="mfin_' + fl.id + '"]:checked');
      values[fl.id] = checked ? checked.value : '';
      return;
    }
    const el = document.getElementById('mfin_' + fl.id);
    if (!el) return;
    values[fl.id] = (fl.type === 'checkbox') ? !!el.checked : el.value;
  });
  return values;
}

function mfSaveResponse() {
  const f = mfGetCurrentForm(); if (!f) return;
  const values = mfCollectDraftFromDOM();
  const hasAny = Object.values(values).some(v => v !== '' && v !== false);
  if (!hasAny) { toast('Fill in at least one field first', 'info'); return; }
  const responses = mfGetResponses(f);
  const now = Date.now();
  if (mfActiveResponseId) {
    const r = responses.find(x => x.id === mfActiveResponseId);
    if (r) { r.values = values; r.updatedAt = now; }
  } else {
    const r = { id: mfUid('resp'), createdAt: now, updatedAt: now, values };
    responses.push(r);
    mfActiveResponseId = r.id;
  }
  mfDraftValues = { ...values };
  mfTouch(f);
  mfUpdateFillStatus();
  mfRenderResponsesList();
  toast('Response saved', 'success');
}

function mfDeleteResponse(id, ev) {
  if (ev) ev.stopPropagation();
  const f = mfGetCurrentForm(); if (!f) return;
  if (!confirm('Delete this response? This cannot be undone.')) return;
  const gone = mfGetResponses(f).find(x => x.id === id);
  if (gone && typeof SarvarcSign !== 'undefined') mfSigCleanupResponse(f, gone);
  f.responses = mfGetResponses(f).filter(x => x.id !== id);
  if (mfActiveResponseId === id) {
    mfActiveResponseId = null;
    mfDraftValues = {};
    mfRenderPreview();
    mfUpdateFillStatus();
  }
  mfTouch(f);
  mfRenderResponsesList();
  toast('Response deleted', 'info');
}

// ─── SIGNATURES: draw / type / upload an image or PDF ───
// The signing UI is the shared SarvarcSign engine (added at the end of this file),
// the same one the public form page uses, so filling a form here and filling it
// online feel identical. A signature answer is a JSON string (small signature
// image + optional original PDF). Because responses live in localStorage, which
// is small, any original PDF is moved into IndexedDB and the response keeps only
// a reference to it (see mfSigSlim). Online responses can always re-fetch the PDF.
const MF_SIG_DB = 'sarvarc_mf_sigfiles';
function mfSigDbOpen() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(MF_SIG_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function mfSigFilePut(key, dataUrl) {
  const db = await mfSigDbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(dataUrl, key);
    tx.oncomplete = () => { db.close(); res(true); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
async function mfSigFileGet(key) {
  const db = await mfSigDbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction('files', 'readonly').objectStore('files').get(key);
    rq.onsuccess = () => { db.close(); res(rq.result || null); };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}
async function mfSigFileDel(key) {
  try {
    const db = await mfSigDbOpen();
    await new Promise((res) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(key);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); res(); };
    });
  } catch (e) { /* nothing to clean up */ }
}

// Moves an inline original PDF into IndexedDB and returns the slim JSON answer.
async function mfSigSlim(raw) {
  if (typeof SarvarcSign === 'undefined') return (typeof raw === 'string') ? raw : '';
  const v = SarvarcSign.parse(raw);
  if (!v) return (typeof raw === 'string') ? raw : '';
  if (v.file && v.file.dataUrl) {
    const key = mfUid('sigf');
    let stored = false;
    try { await mfSigFilePut(key, v.file.dataUrl); stored = true; }
    catch (e) { console.warn('[Make Forms] could not cache signature PDF locally', e); }
    v.file = { name: v.file.name, type: v.file.type, size: v.file.size, key: stored ? key : null };
  }
  return SarvarcSign.toAnswer(v);
}
async function mfSigSlimAnswers(f, answers) {
  const out = Object.assign({}, answers || {});
  for (const fl of (f.fields || [])) {
    if (fl.type === 'signature' && out[fl.id]) out[fl.id] = await mfSigSlim(out[fl.id]);
  }
  return out;
}
function mfSigCleanupResponse(f, r) {
  (f.fields || []).forEach(fl => {
    if (fl.type !== 'signature') return;
    const sv = SarvarcSign.parse(r.values && r.values[fl.id]);
    if (sv && sv.file && sv.file.key) mfSigFileDel(sv.file.key);
  });
}
function mfRespSigInfo(f, r) {
  let signed = 0, pdf = 0;
  if (typeof SarvarcSign === 'undefined') return { signed, pdf };
  (f.fields || []).forEach(fl => {
    if (fl.type !== 'signature') return;
    const sv = SarvarcSign.parse(r.values && r.values[fl.id]);
    if (sv) { signed++; if (sv.file) pdf++; }
  });
  return { signed, pdf };
}

function mfSigOpen(fid) {
  if (mfMode !== 'fill') return; // design mode preview stays a plain, printable blank
  const f = mfGetCurrentForm(); if (!f) return;
  const fl = f.fields.find(x => x.id === fid); if (!fl) return;
  if (typeof SarvarcSign === 'undefined') { toast('Signature tool did not load. Please refresh the page.', 'error'); return; }
  SarvarcSign.open({
    title: fl.label || 'Add your signature',
    accent: f.accentColor || '#0073E6',
    onDone: async (val) => {
      const slim = await mfSigSlim(SarvarcSign.toAnswer(val));
      const cur = mfCollectDraftFromDOM(); // keep whatever else is typed so re-rendering doesn't wipe it
      cur[fid] = slim;
      mfDraftValues = cur;
      mfRenderPreview();
    }
  });
}
function mfSigClear(fid) {
  const cur = mfCollectDraftFromDOM();
  cur[fid] = '';
  mfDraftValues = cur;
  mfRenderPreview();
}

// Original PDF: this device first (IndexedDB), then the copy stored online.
async function mfSigFileDataUrl(resp, fid) {
  const v = SarvarcSign.parse(resp.values && resp.values[fid]);
  if (!v || !v.file) return null;
  if (v.file.dataUrl) return v.file.dataUrl;
  if (v.file.key) {
    try { const d = await mfSigFileGet(v.file.key); if (d) return d; } catch (e) { /* try online */ }
  }
  if (resp.remoteId && typeof sarvarcSupabase !== 'undefined') {
    try {
      const { data, error } = await sarvarcSupabase.from('form_responses').select('answers').eq('id', resp.remoteId).single();
      if (error) throw error;
      const rv = SarvarcSign.parse(data && data.answers && data.answers[fid]);
      if (rv && rv.file && rv.file.dataUrl) {
        if (v.file.key) { try { await mfSigFilePut(v.file.key, rv.file.dataUrl); } catch (e) { /* cache is optional */ } }
        return rv.file.dataUrl;
      }
    } catch (e) { console.warn('[Make Forms] could not fetch signature PDF online', e); }
  }
  return null;
}
async function mfSigDownloadFile(resp, fid) {
  const v = SarvarcSign.parse(resp.values && resp.values[fid]);
  if (!v || !v.file) return;
  const dataUrl = await mfSigFileDataUrl(resp, fid);
  if (!dataUrl) { toast('The original PDF is not available right now', 'error'); return; }
  const url = URL.createObjectURL(mfDataUrlToBlob(dataUrl));
  const a = document.createElement('a');
  a.href = url;
  a.download = v.file.name || 'signature.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function mfSigDownloadDraft(fid) {
  const f = mfGetCurrentForm(); if (!f) return;
  const active = mfActiveResponseId ? mfGetResponses(f).find(x => x.id === mfActiveResponseId) : null;
  mfSigDownloadFile({ values: mfDraftValues, remoteId: active && active.remoteId }, fid);
}
async function mfSigDownloadResponse(id, ev) {
  if (ev) ev.stopPropagation();
  const f = mfGetCurrentForm(); if (!f) return;
  const r = mfGetResponses(f).find(x => x.id === id); if (!r) return;
  for (const fl of f.fields) {
    if (fl.type === 'signature') await mfSigDownloadFile(r, fl.id);
  }
}

function mfResponseSummary(f, r) {
  const parts = [];
  for (const fl of f.fields) {
    if (fl.type === 'heading' || fl.type === 'signature' || fl.type === 'checkbox') continue;
    const v = r.values[fl.id];
    if (v) { parts.push(String(v)); if (parts.length === 2) break; }
  }
  return parts.length ? parts.join(' · ') : 'Untitled response';
}

function mfRenderResponsesList() {
  const f = mfGetCurrentForm(); if (!f) return;
  const responses = mfGetResponses(f).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const list = document.getElementById('mfRespList');
  const empty = document.getElementById('mfRespEmpty');
  const count = document.getElementById('mfRespCount');
  const badge = document.getElementById('mfRespBadge');
  if (!list) return;
  if (count) count.textContent = responses.length + ' saved';
  if (badge) { badge.style.display = responses.length ? 'inline-block' : 'none'; badge.textContent = responses.length; }
  mfRenderSyncStatus();
  if (!responses.length) { list.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  list.innerHTML = responses.map(r => { const sg = mfRespSigInfo(f, r); return `
    <div class="mf-resp-item ${r.id === mfActiveResponseId ? 'active' : ''}" onclick="mfLoadResponse('${r.id}')">
      <div class="mf-resp-item-title">${mfEsc(mfResponseSummary(f, r))}</div>
      <div class="mf-resp-item-meta">${new Date(r.updatedAt).toLocaleString()}${sg.signed ? ' · Signed' : ''}${sg.pdf ? ' · PDF attached' : ''}</div>
      <div class="mf-resp-item-btns">
        <button onclick="event.stopPropagation();mfLoadResponse('${r.id}')">Edit</button>
        ${sg.pdf ? `<button onclick="mfSigDownloadResponse('${r.id}', event)">Get PDF</button>` : ''}
        <button onclick="sarvarcGateExport(function(){mfExportSingleResponsePDF('${r.id}', event)})">PDF</button>
        <button class="mf-danger" onclick="mfDeleteResponse('${r.id}', event)">Delete</button>
      </div>
    </div>
  `; }).join('');
}

async function mfRasterizePreviewCanvas() {
  const page = document.getElementById('mfPreviewPage');
  return await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
}

async function mfExportSingleResponsePDF(id, ev) {
  if (ev) ev.stopPropagation();
  const f = mfGetCurrentForm(); if (!f) return;
  const r = mfGetResponses(f).find(x => x.id === id); if (!r) return;
  if (typeof html2canvas === 'undefined' || !window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  const password = await sarvarcAskExportPassword('Export Response as PDF');
  if (password === undefined) return; // cancelled
  const savedDraft = mfDraftValues, savedActive = mfActiveResponseId;
  toast('Preparing PDF…', 'info');
  try {
    mfDraftValues = { ...r.values };
    mfRenderPreview();
    await new Promise(res => setTimeout(res, 30));
    // Reuses the same true-A4 capture + smart-break pagination that the
    // main Export PDF button uses, instead of screenshotting the whole
    // (possibly multi-sheet) preview as one oversized custom page.
    const result = await mfRasterizeFormPageCanvases();
    if (!result) return;
    const { slices, mmW, mmH } = result;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF(Object.assign({ orientation: 'portrait', unit: 'mm', format: [mmW, mmH] }, sarvarcPdfEncryptionOpts(password)));
    slices.forEach((slice, i) => {
      if (i > 0) pdf.addPage([mmW, mmH], 'portrait');
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, mmW, mmH, '', 'FAST');
    });
    const fname = (f.title || 'form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_response.pdf';
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    toast('Response exported as PDF' + (password ? ' (password protected)' : '') + (slices.length > 1 ? ` · ${slices.length} pages` : ''), 'success');
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfDraftValues = savedDraft; mfActiveResponseId = savedActive;
    mfRenderPreview();
  }
}

async function mfExportAllResponsesPDF() {
  const f = mfGetCurrentForm(); if (!f) return;
  const responses = mfGetResponses(f).slice().sort((a, b) => a.createdAt - b.createdAt);
  if (!responses.length) { toast('No saved responses yet', 'info'); return; }
  if (typeof html2canvas === 'undefined' || !window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  const password = await sarvarcAskExportPassword('Export All Responses as PDF');
  if (password === undefined) return; // cancelled
  toast(`Preparing PDF for ${responses.length} response${responses.length > 1 ? 's' : ''}…`, 'info');
  const savedDraft = mfDraftValues, savedActive = mfActiveResponseId;
  try {
    const { jsPDF } = window.jspdf;
    let pdf = null;
    for (let i = 0; i < responses.length; i++) {
      mfDraftValues = { ...responses[i].values };
      mfRenderPreview();
      await new Promise(res => setTimeout(res, 30));
      // Each response can itself span multiple real A4 sheets — reuse the
      // same slicer the main Export PDF button uses so every sheet, for
      // every response, comes out as a proper full A4 page with nothing
      // cut off, instead of one oversized custom page per response.
      const result = await mfRasterizeFormPageCanvases();
      if (!result) continue;
      const { slices, mmW, mmH } = result;
      slices.forEach((slice) => {
        if (!pdf) pdf = new jsPDF(Object.assign({ orientation: 'portrait', unit: 'mm', format: [mmW, mmH] }, sarvarcPdfEncryptionOpts(password)));
        else pdf.addPage([mmW, mmH], 'portrait');
        pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, mmW, mmH, '', 'FAST');
      });
    }
    if (!pdf) { toast('Nothing to export', 'error'); return; }
    const fname = (f.title || 'form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_responses.pdf';
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    toast(`Exported ${responses.length} response${responses.length > 1 ? 's' : ''} as one PDF` + (password ? ' (password protected)' : ''), 'success');
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfDraftValues = savedDraft; mfActiveResponseId = savedActive;
    mfRenderPreview();
  }
}

// ─── EXPORT RESPONSES → DATA ARRANGEMENT ───
// daAddDataset/daWorkspaceRefreshVisibility/daRenderTabs/daRenderTable and
// daState all live at global scope (defined outside any IIFE), same call
// pattern Data Arrangement itself uses after ingesting a file.
//
// Build 245: takes an OPTIONAL target so Kadessa can send a specific form's
// responses (not just whichever form happens to be open). `target` may be a
// form id string or a form object; the manual button calls this with no
// arguments (sarvarcGateExport calls actionFn()), so it still exports the
// open form exactly as before. opts.noNavigate / opts.silent let a batch
// export (several forms in one Kadessa turn) switch panels and toast ONCE at
// the end instead of once per form. Returns the number of rows sent (0 if
// nothing was exported).

// One place that names the DA table for a form, so the export and Kadessa's
// "already sent to Data Arrangement" flag can never drift apart.
function mfDaBaseName(f) { return `${f.title || 'Form'} — Responses`; }

// If a table with this name is already in Data Arrangement, add " (2)",
// " (3)"... so re-exporting a form never leaves two identical tabs.
function mfDaUniqueName(base) {
  const taken = new Set(((typeof daState !== 'undefined' && daState.datasets) ? daState.datasets : []).map(d => d.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

function mfExportResponsesToDA(target, opts) {
  opts = opts || {};
  const f = (typeof target === 'string')
    ? mfState.forms.find(x => x.id === target)
    : (target && typeof target === 'object' && Array.isArray(target.fields) ? target : mfGetCurrentForm());
  if (!f) return 0;
  const responses = mfGetResponses(f).slice().sort((a, b) => a.createdAt - b.createdAt);
  if (!responses.length) { if (!opts.silent) toast('No saved responses yet', 'info'); return 0; }
  const dataFields = f.fields.filter(fl => fl.type !== 'heading' && fl.type !== 'signature');
  if (!dataFields.length) { if (!opts.silent) toast('This form has no fillable fields to export', 'info'); return 0; }
  if (typeof daAddDataset !== 'function') { toast('Data Arrangement is unavailable right now', 'error'); return 0; }
  const headers = dataFields.map(fl => fl.label || 'Field');
  const rows = responses.map(r => dataFields.map(fl => {
    const v = r.values[fl.id];
    if (fl.type === 'checkbox') return v ? 'Yes' : 'No';
    return v == null ? '' : String(v);
  }));
  daAddDataset(mfDaUniqueName(mfDaBaseName(f)), [headers, ...rows]);
  if (!opts.noNavigate) {
    if (typeof daWorkspaceRefreshVisibility === 'function') daWorkspaceRefreshVisibility();
    if (typeof daRenderTabs === 'function') daRenderTabs();
    if (typeof daRenderTable === 'function') daRenderTable();
    navigate('dataarrange');
  }
  if (!opts.silent) toast(`${responses.length} response${responses.length > 1 ? 's' : ''} sent to Data Arrangement`, 'success');
  return responses.length;
}

// Build 245: works out WHICH form Kadessa means. Order of trust:
//   1. formId (exact, comes straight from context.forms)
//   2. formTitle (matched loosely: exact > contains, case/punctuation
//      insensitive). If it matches more than one form, or none, this THROWS
//      with a plain message naming the candidates, so Kadessa asks the person
//      which one instead of exporting the wrong table.
//   3. nothing named -> the form open in the editor right now.
// Canvas forms (free-layout, no fillable fields) never hold field responses,
// so they are only ever matched by an explicit id, and then rejected clearly.
function mfKadessaResolveForm(p) {
  p = p || {};
  const all = (typeof mfState !== 'undefined' && mfState.forms) ? mfState.forms : [];
  const label = f => '"' + (f.title || 'Untitled Form') + '" (' + mfGetResponses(f).length + ' response' + (mfGetResponses(f).length === 1 ? '' : 's') + ')';
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let f = null;

  if (p.formId) {
    f = all.find(x => x.id === p.formId) || null;
    if (!f) throw new Error("that form doesn't exist anymore, it may have been deleted");
  } else if (p.formTitle) {
    const q = norm(p.formTitle);
    const pool = all.filter(x => x.kind !== 'canvas');
    let hits = pool.filter(x => norm(x.title || 'Untitled Form') === q);
    if (!hits.length) hits = pool.filter(x => { const t = norm(x.title || 'Untitled Form'); return q && (t.includes(q) || q.includes(t)); });
    if (hits.length > 1) throw new Error('more than one form fits "' + p.formTitle + '": ' + hits.map(label).join(', ') + '. Ask which one they mean');
    if (!hits.length) throw new Error('no form matches "' + p.formTitle + '". Forms available: ' + (pool.length ? pool.map(label).join(', ') : 'none yet'));
    f = hits[0];
  } else {
    f = mfGetCurrentForm() || null;
    if (!f) {
      const withData = all.filter(x => x.kind !== 'canvas' && mfGetResponses(x).length);
      throw new Error(withData.length > 1
        ? 'no form is open and several have responses: ' + withData.map(label).join(', ') + '. Ask which one they mean'
        : 'no form is open, so tell me which form you mean');
    }
  }
  if (f.kind === 'canvas') throw new Error('"' + (f.title || 'Untitled Canvas Form') + '" is a canvas form, so it has no fillable fields or responses to send');
  return f;
}

// Build 245: compact list of every form in the session for Kadessa's context.
// Titles, ids, counts and field LABELS only -- never the answers people
// submitted -- so it stays inside the same privacy line the rest of the Make
// Forms context already keeps. Newest-touched first, capped so a big gallery
// can't balloon the request.
function mfFormsOverviewForKadessa() {
  if (typeof mfState === 'undefined' || !mfState.forms || !mfState.forms.length) return [];
  const dsNames = ((typeof daState !== 'undefined' && daState.datasets) ? daState.datasets : []).map(d => d.name);
  return mfState.forms.slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 25)
    .map(f => {
      const isCanvas = f.kind === 'canvas';
      const responses = isCanvas ? [] : mfGetResponses(f);
      const dataFields = isCanvas ? [] : (f.fields || []).filter(fl => fl.type !== 'heading' && fl.type !== 'signature');
      const last = responses.reduce((m, r) => Math.max(m, r.createdAt || 0), 0);
      const base = mfDaBaseName(f);
      return {
        formId: f.id,
        title: f.title || 'Untitled Form',
        formType: isCanvas ? 'canvas' : 'fields',
        isOpenNow: f.id === mfState.currentId,
        isPublished: !!f.publishedId,
        responseCount: responses.length,
        lastResponseAt: last ? new Date(last).toISOString() : null,
        fieldLabels: dataFields.slice(0, 12).map(fl => fl.label || 'Field'),
        alreadyInDataArrangement: dsNames.some(n => n === base || n.indexOf(base + ' (') === 0),
        canSendToDataArrangement: !isCanvas && dataFields.length > 0 && (responses.length > 0 || !!f.publishedId)
      };
    });
}
window.mfKadessaResolveForm = mfKadessaResolveForm;
window.mfFormsOverviewForKadessa = mfFormsOverviewForKadessa;

// ─── MAIL MERGE: BULK-IMPORT RESPONSES FROM A DATA ARRANGEMENT TABLE ───
function mfOpenMergeModal() {
  const f = mfGetCurrentForm(); if (!f) return;
  const datasets = (typeof daState !== 'undefined' && daState.datasets) ? daState.datasets : [];
  if (!datasets.length) { toast('No Data Arrangement tables yet, upload a file or create a blank table there first', 'info'); return; }
  const sel = document.getElementById('mfMergeDatasetSelect');
  sel.innerHTML = datasets.map(d => `<option value="${d.id}">${mfEsc(d.name)}</option>`).join('');
  document.getElementById('mfMergeModalOverlay').classList.add('open');
  mfRenderMergeMapping();
}
function mfCloseMergeModal() {
  const el = document.getElementById('mfMergeModalOverlay');
  if (el) el.classList.remove('open');
}
function mfRenderMergeMapping() {
  const f = mfGetCurrentForm(); if (!f) return;
  const sel = document.getElementById('mfMergeDatasetSelect');
  const ds = (typeof daState !== 'undefined') ? daState.datasets.find(d => d.id === sel.value) : null;
  const wrap = document.getElementById('mfMergeMappingWrap');
  if (!wrap) return;
  if (!ds) { wrap.innerHTML = ''; return; }
  const dataFields = f.fields.filter(fl => fl.type !== 'heading' && fl.type !== 'signature');
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  wrap.innerHTML = dataFields.map(fl => {
    const flNorm = norm(fl.label);
    let bestIdx = -1;
    ds.headers.forEach((h, i) => {
      if (bestIdx === -1 && flNorm && (norm(h) === flNorm || norm(h).includes(flNorm) || flNorm.includes(norm(h)))) bestIdx = i;
    });
    const options = ['<option value="-1">— Leave blank —</option>'].concat(
      ds.headers.map((h, i) => `<option value="${i}" ${i === bestIdx ? 'selected' : ''}>${mfEsc(h)}</option>`)
    );
    return `<div class="mf-merge-map-row"><span title="${mfEsc(fl.label)}">${mfEsc(fl.label)}</span><select class="mf-field-select" data-merge-field="${fl.id}" data-merge-type="${fl.type}">${options.join('')}</select></div>`;
  }).join('');
}
function mfConfirmMergeImport() {
  const f = mfGetCurrentForm(); if (!f) return;
  const sel = document.getElementById('mfMergeDatasetSelect');
  const ds = (typeof daState !== 'undefined') ? daState.datasets.find(d => d.id === sel.value) : null;
  if (!ds) { toast('Pick a table first', 'error'); return; }
  const selects = Array.from(document.querySelectorAll('#mfMergeMappingWrap select'));
  const mapping = selects.map(s => ({ fieldId: s.dataset.mergeField, type: s.dataset.mergeType, colIdx: parseInt(s.value, 10) }));
  if (mapping.every(m => m.colIdx === -1)) { toast('Map at least one column first', 'info'); return; }
  const responses = mfGetResponses(f);
  const now = Date.now();
  let imported = 0;
  ds.rows.forEach((row, i) => {
    const values = {};
    let any = false;
    mapping.forEach(m => {
      if (m.colIdx === -1) return;
      let v = row[m.colIdx];
      v = v == null ? '' : String(v);
      if (m.type === 'checkbox') v = /^(y|yes|true|1)$/i.test(v.trim());
      values[m.fieldId] = v;
      if (v) any = true;
    });
    if (!any) return;
    responses.push({ id: mfUid('resp'), createdAt: now + i, updatedAt: now + i, values, source: 'mailmerge' });
    imported++;
  });
  mfTouch(f);
  mfCloseMergeModal();
  mfRenderResponsesList();
  toast(`Imported ${imported} row${imported !== 1 ? 's' : ''} as response${imported !== 1 ? 's' : ''}`, 'success');
}

// ─── SMART PAGE BREAKS ───
// A naive paginator slices the rasterized form at a blind fixed pixel
// interval (one A4 height at a time), with zero awareness of what's
// actually sitting on that boundary — so a field row or section heading
// that happens to straddle the 297mm mark gets guillotined across two
// pages. This collects every field row (.mf-pv-field) and section heading
// (.mf-pv-heading) as an "unbreakable" block first, then nudges each page
// break up into the whitespace just above the nearest block instead of
// cutting through it. It also refuses to strand a heading alone at the
// very bottom of a page with its fields pushed onto the next one.
//
// Every page also reserves real margin — not just wherever content happens
// to stop. Page 1 keeps its own designed top padding (logo/title area) as
// part of its content, so it only needs a bottom margin reserved for the
// footer. Every continuation page reserves both a top margin (so it isn't
// flush against the sheet edge) and a bottom margin, matching how a real
// multi-page document is laid out. The exact same constants and break
// engine drive the live Design-mode preview, Export PDF, and Push to
// Workspace, so what's on screen while building the form is a true
// WYSIWYG match for what actually gets produced.
function mfCollectUnbreakableBlocks(page, pageRect, scale) {
  const blocks = [];
  page.querySelectorAll('.mf-pv-field, .mf-pv-heading').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    blocks.push({
      el,
      top: (r.top - pageRect.top) * scale,
      bottom: (r.bottom - pageRect.top) * scale,
      isHeading: el.classList.contains('mf-pv-heading')
    });
  });
  blocks.sort((a, b) => a.top - b.top);
  return blocks;
}

// firstBudget is the usable height of page 1 (sheet height minus only the
// bottom margin); restBudget is the usable height of every page after that
// (sheet height minus top margin AND bottom margin).
function mfComputeSmartBreaks(canvasHeightPx, firstBudget, restBudget, blocks) {
  const breaks = [0];
  let cursor = 0;
  let budget = firstBudget;
  while (cursor < canvasHeightPx - 1) {
    let next = Math.min(cursor + budget, canvasHeightPx);
    // Never let a single nudge shrink a page below this — guards against a
    // pathological run of oversized blocks collapsing pages down to nothing.
    const MIN_PAGE = budget * 0.3;
    // How close to the boundary a heading needs to be to count as "stranded"
    // alone at the bottom of a page, scaled to the current page budget so it
    // behaves the same whether we're measuring on-screen px or raster px.
    const strandedZone = budget * 0.03;
    if (next < canvasHeightPx - 1) {
      // Never cut through the middle of a field row or heading.
      const cutting = blocks.filter(b => b.top < next - 1 && b.bottom > next + 1);
      if (cutting.length) {
        const minTop = Math.min(...cutting.map(b => b.top));
        if (minTop - cursor > MIN_PAGE) next = minTop;
        // else: a single block is taller than a whole page — unavoidable,
        // leave the hard cut in place rather than producing a near-empty page.
      }
      // Don't strand a section heading alone at the bottom of a page —
      // pull it down onto the next page along with its first field.
      const stranded = blocks.find(b => b.isHeading && b.bottom <= next && b.bottom > next - strandedZone);
      if (stranded && stranded.top - cursor > MIN_PAGE) next = stranded.top;
    }
    breaks.push(next);
    cursor = next;
    budget = restBudget;
  }
  return breaks;
}

// Export PDF / Push to Workspace both rasterize #mfPreviewPage directly, and
// both compute their own page breaks fresh against the natural, unpadded
// content flow — but the live preview leaves real .mf-pv-pagespacer blanks
// (with "Page N of M" pills) sitting inside that same element between
// renders. Captured as-is, those pills get baked straight into the output
// and the blank gaps get double-counted by the break math on top of that.
// Stripping them right before capture guarantees a clean natural-flow
// source; mfUpdatePreviewPagination() in each function's `finally` block
// already re-inserts fresh spacers afterward, so nothing needs restoring.
function mfStripPreviewSpacers(page) {
  page.querySelectorAll('.mf-pv-pagespacer').forEach(el => el.remove());
  // Also strip the live preview's per-page watermark <img>s — they're
  // positioned for the on-screen preview's (smaller, CSS-proxy) width, not
  // the true 210mm capture width Export PDF / Push to Workspace resize to
  // right before rasterizing, so their baked-in top offsets would land in
  // the wrong place once that resize happens. Both callers draw the
  // watermark fresh onto each already-sliced output canvas instead — see
  // mfDrawWatermarkOnSlice() — which is correct by construction because it
  // uses that slice's own real pixel dimensions, not a leftover DOM position.
  page.querySelectorAll('.mf-pv-watermark').forEach(el => el.remove());
}

// Draws one centered, dead-center logo watermark onto a single already-
// sliced A4 page canvas — used by both Export PDF and Push to Workspace so
// a multi-page form gets the logo centered on EVERY page, not just once
// somewhere in the middle of the whole stacked document.
function mfDrawWatermarkOnSlice(ctx, logoImg, canvasW, canvasH, opacity) {
  if (!logoImg || !logoImg.naturalWidth || !logoImg.naturalHeight) return;
  const maxW = canvasW * 0.58, maxH = canvasH * 0.58;
  const ratio = Math.min(maxW / logoImg.naturalWidth, maxH / logoImg.naturalHeight);
  const w = logoImg.naturalWidth * ratio, h = logoImg.naturalHeight * ratio;
  const x = (canvasW - w) / 2, y = (canvasH - h) / 2;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(logoImg, x, y, w, h);
  ctx.restore();
}

function mfLoadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ─── PRINT / EXPORT ───
function mfPrintForm() {
  const f = mfGetCurrentForm();
  if (!f) { toast('Open a form first', 'error'); return; }
  if (mfFormLangBusy) { toast('Still translating — wait for it to finish so the printed copy matches', 'info'); return; }
  window.print();
}

// ─── EXPORT DROPDOWN (PDF / Word / Image, chosen from the toolbar button) ───
function mfToggleExportDropdown(e) {
  if (e) e.stopPropagation();
  const btn = document.getElementById('mfExportBtn');
  if (!btn) return;
  const dd = document.getElementById('mfExportDropdown');
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
  const dd = document.getElementById('mfExportDropdown');
  const btn = document.getElementById('mfExportBtn');
  if (dd && dd.classList.contains('open') && !dd.contains(e.target) && (!btn || !btn.contains(e.target))) {
    dd.classList.remove('open');
  }
});
function mfExportAs(fmt) {
  const dd = document.getElementById('mfExportDropdown');
  if (dd) dd.classList.remove('open');
  if (fmt === 'pdf') mfExportPDF();
  else if (fmt === 'docx') mfExportDOCX();
  else if (fmt === 'image') mfExportImages();
}

// Shared rasterizer for Word/Image export: reuses the exact same true-A4
// resize, html2canvas capture, smart-break pagination, and per-page
// watermark/footer baking that mfExportPDF already does — just returns the
// finished page canvases instead of feeding them into a jsPDF doc, so PDF,
// Word, and Image export all produce pixel-identical pages.
async function mfRasterizeFormPageCanvases() {
  const f = mfGetCurrentForm();
  const page = document.getElementById('mfPreviewPage');
  if (!f || !page) { toast('Open a form first', 'error'); return null; }
  if (mfFormLangBusy) { toast('Still translating — wait for it to finish so the exported file matches', 'info'); return null; }
  if (typeof html2canvas === 'undefined') { toast('Export is unavailable right now', 'error'); return null; }
  const A4_W_MM = 210, A4_H_MM = 297, PXMM = 3.7795, CAPTURE_SCALE = 2;
  const trueWidthPx = Math.round(A4_W_MM * PXMM);
  const stack = page.parentElement;
  const prev = { width: page.style.width, maxWidth: page.style.maxWidth, height: page.style.height, overflowY: page.style.overflowY, aspectRatio: page.style.aspectRatio };
  const prevStack = stack ? { maxWidth: stack.style.maxWidth, flex: stack.style.flex, flexShrink: stack.style.flexShrink } : null;
  page.style.width = trueWidthPx + 'px'; page.style.maxWidth = 'none';
  page.style.height = 'auto'; page.style.overflowY = 'visible'; page.style.aspectRatio = 'auto';
  if (stack) { stack.style.maxWidth = 'none'; stack.style.flex = 'none'; stack.style.flexShrink = '0'; }
  mfStripPreviewSpacers(page);
  try {
    const pageRect = page.getBoundingClientRect();
    const canvas = await html2canvas(page, { scale: CAPTURE_SCALE, backgroundColor: '#ffffff', useCORS: true });
    const pxPerMm = canvas.width / A4_W_MM;
    const pageHeightPx = Math.round(A4_H_MM * pxPerMm);
    const topMarginPx = Math.round(MF_PAGE_TOP_MARGIN_MM * pxPerMm);
    const bottomMarginPx = Math.round(MF_PAGE_BOTTOM_MARGIN_MM * pxPerMm);
    const scale = canvas.width / pageRect.width;
    const blocks = mfCollectUnbreakableBlocks(page, pageRect, scale);
    const breaks = mfComputeSmartBreaks(canvas.height, pageHeightPx - bottomMarginPx, pageHeightPx - topMarginPx - bottomMarginPx, blocks);
    const totalPages = breaks.length - 1;
    let wmImg = null, wmOpacity = 0;
    if (f.logoDataUrl && f.watermarkOn !== false) {
      wmOpacity = Math.min(10, Math.max(5, f.watermarkOpacity == null ? 8 : f.watermarkOpacity)) / 100;
      try { wmImg = await mfLoadImageEl(f.logoDataUrl); } catch (e) { wmImg = null; }
    }
    const slices = [];
    for (let i = 0; i < totalPages; i++) {
      const sliceTop = breaks[i], sliceBottom = breaks[i + 1];
      const sliceH = sliceBottom - sliceTop;
      const destY = i === 0 ? 0 : topMarginPx;
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = pageHeightPx;
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceH, 0, destY, canvas.width, sliceH);
      if (wmImg) mfDrawWatermarkOnSlice(sctx, wmImg, slice.width, slice.height, wmOpacity);
      if (totalPages > 1) {
        sctx.font = `${Math.round(8 * 0.3528 * pxPerMm)}px Inter, Arial, sans-serif`;
        sctx.fillStyle = '#96a0b1';
        sctx.textAlign = 'right';
        sctx.fillText(`Page ${i + 1} of ${totalPages}`, slice.width - Math.round(12 * pxPerMm), slice.height - Math.round(8 * pxPerMm));
      }
      slices.push(slice);
    }
    return { slices, mmW: A4_W_MM, mmH: A4_H_MM };
  } finally {
    Object.assign(page.style, prev);
    if (stack && prevStack) Object.assign(stack.style, prevStack);
    mfUpdatePreviewPagination();
  }
}

// ─── EDITABLE WORD FIELDS (shared by field-based Make Forms + Canvas Form) ───
// Word .docx exports used to bake the whole form into one flat picture, so
// nothing in the downloaded file could actually be typed into. These build
// real, natively-editable Word text boxes instead — the classic <w:pict>/
// <v:shape> "legacy" textbox format Word itself has always used for
// absolutely-positioned text, so it opens with no repair prompt in any
// version of Word (unlike the newer DrawingML wps:wsp shape, which needs an
// mc:AlternateContent wrapper to be safe across versions). Positioned in
// points, relative to the physical page, so a box lands exactly where the
// field sits in the live preview/canvas.
function mfXmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
let mfDocxShapeIdCounter = 1;
function mfDocxTextboxXml(opts) {
  const id = mfDocxShapeIdCounter++;
  const leftPt = Math.round(opts.xMm * 2.83465 * 100) / 100;
  const topPt = Math.round(opts.yMm * 2.83465 * 100) / 100;
  const wPt = Math.round(Math.max(opts.wMm, 4) * 2.83465 * 100) / 100;
  const hPt = Math.round(Math.max(opts.hMm, 3) * 2.83465 * 100) / 100;
  const halfPt = Math.max(2, Math.round((opts.fontSizePt || 11) * 2));
  const color = (opts.color || '#1A1A2E').replace('#', '').toUpperCase();
  const align = { left: 'left', center: 'center', right: 'right', justify: 'both' }[opts.align] || 'left';
  const rPr = `<w:rFonts w:ascii="${mfXmlEsc(opts.fontFamily || 'Calibri')}" w:hAnsi="${mfXmlEsc(opts.fontFamily || 'Calibri')}"/><w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/><w:color w:val="${color}"/>` +
    (opts.bold ? '<w:b/>' : '') + (opts.italic ? '<w:i/>' : '') + (opts.underline ? '<w:u w:val="single"/>' : '');
  const lines = String(opts.text || '').split('\n');
  const bodyPs = (lines.length ? lines : ['']).map(line =>
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="${align}"/></w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${mfXmlEsc(line)}</w:t></w:r></w:p>`
  ).join('');
  const fillAttr = (opts.background && opts.background !== 'transparent') ? `filled="t" fillcolor="#${opts.background.replace('#', '').toUpperCase()}"` : 'filled="f"';
  const strokeAttr = opts.border ? 'stroked="t" strokecolor="#8C8C8C" strokeweight=".5pt"' : 'stroked="f"';
  return `<w:p><w:r><w:pict><v:shape id="mfShape${id}" o:spt="202" type="#_x0000_t202" ` +
    `style="position:absolute;left:${leftPt}pt;top:${topPt}pt;width:${wPt}pt;height:${hPt}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;z-index:${id}" ` +
    `${fillAttr} ${strokeAttr}>` +
    `<v:textbox inset="1pt,0.5pt,1pt,0.5pt"><w:txbxContent>${bodyPs}</w:txbxContent></v:textbox>` +
    `</v:shape></w:pict></w:r></w:p>`;
}
// Free-tier watermark for native vector .docx exports (no rasterized image
// to stamp on to, so this drops a small, faint text box in the bottom-right
// corner of the page instead — sits in the margin, doesn't overlap content —
// same "Made Using SARVARC Workspace" message as the canvas/PDF stamps, just
// expressed as a VML shape).
function sarvarcDocxWatermarkXml(mmW, mmH) {
  const id = mfDocxShapeIdCounter++;
  const boxWPt = 170, boxHPt = 14;
  const rightPt = Math.round(mmW * 2.83465) - boxWPt - 10;
  const bottomPt = Math.round(mmH * 2.83465) - boxHPt - 8;
  return `<w:p><w:r><w:pict><v:shape id="mfWmShape${id}" o:spt="202" type="#_x0000_t202" ` +
    `style="position:absolute;left:${rightPt}pt;top:${bottomPt}pt;width:${boxWPt}pt;height:${boxHPt}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;z-index:${id}" filled="f" stroked="f">` +
    `<v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="14"/><w:color w:val="8C96A8"/></w:rPr><w:t xml:space="preserve">Made Using SARVARC Workspace</w:t></w:r></w:p></w:txbxContent></v:textbox>` +
    `</v:shape></w:pict></w:r></w:p>`;
}
// Root namespaces for any docx body that embeds mfDocxTextboxXml() shapes —
// adds xmlns:v/xmlns:o (VML + Office) on top of the standard w/r/wp set.
const MF_DOCX_ROOT_NAMESPACES = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"`;

// Same rasterization mfRasterizeFormPageCanvases() does, but also captures
// every fillable target's position/size (the same targets Push to Workspace
// collects) and maps each one into its page slice's own mm coordinates, so
// the Word export can lay a real, empty, natively-editable text box exactly
// on top of each blank input/textarea/checkbox/MCQ bubble/signature line in
// the flattened background image.
async function mfRasterizeFormPageCanvasesWithFields() {
  const f = mfGetCurrentForm();
  const page = document.getElementById('mfPreviewPage');
  if (!f || !page) { toast('Open a form first', 'error'); return null; }
  if (mfFormLangBusy) { toast('Still translating — wait for it to finish so the exported file matches', 'info'); return null; }
  if (typeof html2canvas === 'undefined') { toast('Export is unavailable right now', 'error'); return null; }
  const A4_W_MM = 210, A4_H_MM = 297, PXMM = 3.7795, CAPTURE_SCALE = 2;
  const trueWidthPx = Math.round(A4_W_MM * PXMM);
  const stack = page.parentElement;
  const prev = { width: page.style.width, maxWidth: page.style.maxWidth, height: page.style.height, overflowY: page.style.overflowY, aspectRatio: page.style.aspectRatio };
  const prevStack = stack ? { maxWidth: stack.style.maxWidth, flex: stack.style.flex, flexShrink: stack.style.flexShrink } : null;
  page.style.width = trueWidthPx + 'px'; page.style.maxWidth = 'none';
  page.style.height = 'auto'; page.style.overflowY = 'visible'; page.style.aspectRatio = 'auto';
  if (stack) { stack.style.maxWidth = 'none'; stack.style.flex = 'none'; stack.style.flexShrink = '0'; }
  mfStripPreviewSpacers(page);
  try {
    const pageRect = page.getBoundingClientRect();
    const cssPxPerMm = pageRect.width / A4_W_MM;

    const targets = [];
    page.querySelectorAll('.mf-pv-field').forEach(fieldEl => {
      const mcqOpts = fieldEl.querySelectorAll('.mf-pv-mcq-opt input');
      if (mcqOpts.length) {
        const cs = window.getComputedStyle(fieldEl);
        const fontSize = parseFloat(cs.fontSize) || 12;
        mcqOpts.forEach(opt => {
          const r = opt.getBoundingClientRect();
          if (!r.width || !r.height) return;
          targets.push({ x: r.left - pageRect.left, y: r.top - pageRect.top - 1, w: Math.max(16, r.width + 4), h: Math.max(14, r.height + 2), fontSize });
        });
        return;
      }
      const checkInput = fieldEl.classList.contains('mf-pv-check') ? fieldEl.querySelector('input[type="checkbox"]') : null;
      if (checkInput) {
        const r = checkInput.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const cs = window.getComputedStyle(fieldEl);
        targets.push({ x: r.left - pageRect.left, y: r.top - pageRect.top - 1, w: Math.max(16, r.width + 4), h: Math.max(14, r.height + 2), fontSize: parseFloat(cs.fontSize) || 12 });
        return;
      }
      const input = fieldEl.querySelector('.mf-pv-input, .mf-pv-textarea, .mf-pv-select-real');
      const sig = fieldEl.querySelector('.mf-pv-sig');
      const target = input || sig;
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cs = window.getComputedStyle(input || fieldEl);
      targets.push({
        x: r.left - pageRect.left + 6,
        y: r.top - pageRect.top + (sig ? -18 : 4),
        w: Math.max(20, r.width - 12),
        h: Math.max(14, sig ? r.height + 14 : r.height - 6),
        fontSize: parseFloat(cs.fontSize) || 12
      });
    });

    const canvas = await html2canvas(page, { scale: CAPTURE_SCALE, backgroundColor: '#ffffff', useCORS: true });
    const pxPerMm = canvas.width / A4_W_MM;
    const pageHeightPx = Math.round(A4_H_MM * pxPerMm);
    const topMarginPx = Math.round(MF_PAGE_TOP_MARGIN_MM * pxPerMm);
    const bottomMarginPx = Math.round(MF_PAGE_BOTTOM_MARGIN_MM * pxPerMm);
    const scale = canvas.width / pageRect.width;
    const blocks = mfCollectUnbreakableBlocks(page, pageRect, scale);
    const breaks = mfComputeSmartBreaks(canvas.height, pageHeightPx - bottomMarginPx, pageHeightPx - topMarginPx - bottomMarginPx, blocks);
    const totalPages = breaks.length - 1;
    let wmImg = null, wmOpacity = 0;
    if (f.logoDataUrl && f.watermarkOn !== false) {
      wmOpacity = Math.min(10, Math.max(5, f.watermarkOpacity == null ? 8 : f.watermarkOpacity)) / 100;
      try { wmImg = await mfLoadImageEl(f.logoDataUrl); } catch (e) { wmImg = null; }
    }

    const perPageFields = Array.from({ length: totalPages }, () => []);
    targets.forEach(t => {
      const yFull = t.y * scale;
      let pageIdx = breaks.findIndex((b, idx) => idx < totalPages && yFull >= b && yFull < breaks[idx + 1]);
      if (pageIdx === -1) pageIdx = totalPages - 1;
      const destY = pageIdx === 0 ? 0 : topMarginPx;
      const yLocalPx = (yFull - breaks[pageIdx]) + destY;
      perPageFields[pageIdx].push({
        xMm: t.x / cssPxPerMm,
        yMm: yLocalPx / pxPerMm,
        wMm: t.w / cssPxPerMm,
        hMm: t.h / cssPxPerMm,
        fontSizePt: Math.max(8, (t.fontSize / cssPxPerMm) * 2.83465)
      });
    });

    const slices = [];
    for (let i = 0; i < totalPages; i++) {
      const sliceTop = breaks[i], sliceBottom = breaks[i + 1];
      const sliceH = sliceBottom - sliceTop;
      const destY = i === 0 ? 0 : topMarginPx;
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = pageHeightPx;
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceH, 0, destY, canvas.width, sliceH);
      if (wmImg) mfDrawWatermarkOnSlice(sctx, wmImg, slice.width, slice.height, wmOpacity);
      if (totalPages > 1) {
        sctx.font = `${Math.round(8 * 0.3528 * pxPerMm)}px Inter, Arial, sans-serif`;
        sctx.fillStyle = '#96a0b1';
        sctx.textAlign = 'right';
        sctx.fillText(`Page ${i + 1} of ${totalPages}`, slice.width - Math.round(12 * pxPerMm), slice.height - Math.round(8 * pxPerMm));
      }
      slices.push(slice);
    }
    return { slices, mmW: A4_W_MM, mmH: A4_H_MM, perPageFields };
  } finally {
    Object.assign(page.style, prev);
    if (stack && prevStack) Object.assign(stack.style, prevStack);
    mfUpdatePreviewPagination();
  }
}

// Embeds every rasterized page as a picture in a .docx — same OOXML
// plumbing (pdfedAddImageRun + the docx zip skeleton) Redaction's Word
// export already uses for labels/headings/logo, since those stay baked
// into pixels — but every fillable input, textarea, dropdown, checkbox,
// MCQ bubble, and signature line gets a real, empty, natively-editable
// Word text box laid on top of it (mfDocxTextboxXml), so recipients can
// open the .docx in Word and click straight into a field to type an
// answer, same as Push to Workspace already lets them do in the PDF editor.
// Guards + progress UI mirror the rest of the app (Workspace, Redaction):
// mfExportBusy blocks a second export from starting mid-flight — same
// double-click guard mfPushToWorkspace uses — and showExportOverlay/
// updateExportProgress/completeExportOverlay give the same full-screen
// progress feedback instead of a bare toast.
let mfExportBusy = false;
async function mfExportDOCX() {
  const f = mfGetCurrentForm();
  if (!f) { toast('Open a form first', 'error'); return; }
  if (mfExportBusy) return; // guard against double-clicks starting two exports at once
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  mfExportBusy = true;
  showExportOverlay('Exporting Word…', 'Rendering pages…');
  try {
    const result = await mfRasterizeFormPageCanvasesWithFields();
    if (!result) { hideExportOverlay(); return; }
    const { slices, mmW, mmH, perPageFields } = result;
    if (window.sarvarcApplyFreeWatermark) slices.forEach(s => sarvarcStampCanvasWatermark(s));
    const PAGE_W_TWIPS = 11906, PAGE_H_TWIPS = 16838, MARGIN_TWIPS = 720;
    const contentWidthEmu = (PAGE_W_TWIPS - MARGIN_TWIPS * 2) * 635;
    const images = { list: [] };
    let bodyXml = '';
    let fieldCount = 0;
    slices.forEach((slice, i) => {
      updateExportProgress((i / slices.length) * 80, `Embedding page ${i + 1} of ${slices.length}…`);
      if (i > 0) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      const dataUrl = slice.toDataURL('image/png');
      const wPt = mmW * 2.83465, hPt = mmH * 2.83465;
      bodyXml += pdfedAddImageRun(images, dataUrl, wPt, hPt, contentWidthEmu);
      (perPageFields[i] || []).forEach(field => {
        fieldCount++;
        bodyXml += mfDocxTextboxXml({
          xMm: field.xMm, yMm: field.yMm, wMm: field.wMm, hMm: field.hMm,
          fontSizePt: field.fontSizePt, fontFamily: 'Calibri', color: '#1A1A2E',
          align: 'left', text: '', border: false, background: 'transparent'
        });
      });
    });
    updateExportProgress(88, 'Building document…');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${MF_DOCX_ROOT_NAMESPACES}><w:body>${bodyXml}` +
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
    const fname = (f.title || 'form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.docx';
    pdfedDownloadBlob(blob, sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay('Word document exported', { module: 'make_forms', format: 'docx' });
    toast(fieldCount ? `Form exported as Word document — ${fieldCount} field${fieldCount === 1 ? '' : 's'} ready to fill in` : 'Form exported as Word document', 'success');
  } catch (e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfExportBusy = false;
  }
}

// Saves each page as a PNG — a plain single download for a one-page form,
// or a ZIP bundle for a multi-page one, matching Redaction's image export.
async function mfExportImages() {
  const f = mfGetCurrentForm();
  if (!f) { toast('Open a form first', 'error'); return; }
  if (mfExportBusy) return; // guard against double-clicks starting two exports at once
  mfExportBusy = true;
  showExportOverlay('Exporting images…', 'Rendering pages…');
  try {
    const result = await mfRasterizeFormPageCanvases();
    if (!result) { hideExportOverlay(); return; }
    const { slices } = result;
    if (window.sarvarcApplyFreeWatermark) slices.forEach(s => sarvarcStampCanvasWatermark(s));
    const base = (f.title || 'form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'form';
    if (slices.length === 1) {
      updateExportProgress(50, 'Rendering page…');
      const blob = await new Promise(res => slices[0].toBlob(res, 'image/png'));
      updateExportProgress(95, 'Saving file…');
      pdfedDownloadBlob(blob, sarvarcBrandFilename(base + '.png'));
      completeExportOverlay('1 page exported', { module: 'make_forms', format: 'image' });
      toast('Form exported as image', 'success');
    } else {
      if (typeof JSZip === 'undefined') { hideExportOverlay(); toast('Zip engine failed to load, check your connection', 'error'); return; }
      const zip = new JSZip();
      slices.forEach((slice, i) => {
        updateExportProgress((i / slices.length) * 80, `Packing page ${i + 1} of ${slices.length}…`);
        const dataUrl = slice.toDataURL('image/png');
        zip.file(base + '-page' + (i + 1) + '.png', dataUrl.split(',')[1], { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        updateExportProgress(80 + metadata.percent * 0.18, `Compressing… ${Math.round(metadata.percent)}%`);
      });
      pdfedDownloadBlob(blob, sarvarcBrandFilename(base + '-pages.zip'));
      completeExportOverlay(slices.length + ' pages exported', { module: 'make_forms', format: 'image' });
      toast('Exported ' + slices.length + ' images', 'success');
    }
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
  } catch (e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfExportBusy = false;
  }
}

async function mfExportPDF() {
  const f = mfGetCurrentForm();
  const page = document.getElementById('mfPreviewPage');
  if (!f || !page) { toast('Open a form first', 'error'); return; }
  if (mfFormLangBusy) { toast('Still translating — wait for it to finish so the exported PDF matches', 'info'); return; }
  if (typeof html2canvas === 'undefined' || !window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  if (mfExportBusy) return; // guard against double-clicks starting two exports at once
  const password = await sarvarcAskExportPassword('Export Form as PDF');
  if (password === undefined) return; // cancelled
  mfExportBusy = true;
  showExportOverlay('Exporting your PDF…', 'Preparing page…');
  // The on-screen preview column is a scaled-down CSS proxy (max-width:420px),
  // not physically 210mm. For an accurate strict-A4 capture, temporarily
  // render the page at its true 210mm pixel width with natural (unclipped)
  // height, then slice that capture into real 210×297mm A4 PDF pages below.
  const A4_W_MM = 210, A4_H_MM = 297, PXMM = 3.7795, CAPTURE_SCALE = 2;
  const trueWidthPx = Math.round(A4_W_MM * PXMM);
  const stack = page.parentElement; // .mf-preview-page-stack — the actual flex child now
  const prev = { width: page.style.width, maxWidth: page.style.maxWidth, height: page.style.height, overflowY: page.style.overflowY, aspectRatio: page.style.aspectRatio };
  const prevStack = stack ? { maxWidth: stack.style.maxWidth, flex: stack.style.flex, flexShrink: stack.style.flexShrink } : null;
  page.style.width = trueWidthPx + 'px'; page.style.maxWidth = 'none';
  page.style.height = 'auto'; page.style.overflowY = 'visible'; page.style.aspectRatio = 'auto';
  // Pin against the flex container (.mf-preview-scroll) shrinking our forced
  // width back down — flex-shrink defaults to 1, and the stack wrapper (not
  // the page itself) is the actual flex child — so the capture really is
  // 210mm wide, not silently squeezed narrower.
  if (stack) { stack.style.maxWidth = 'none'; stack.style.flex = 'none'; stack.style.flexShrink = '0'; }
  mfStripPreviewSpacers(page);
  try {
    const pageRect = page.getBoundingClientRect();
    const canvas = await html2canvas(page, { scale: CAPTURE_SCALE, backgroundColor: '#ffffff', useCORS: true });
    const { jsPDF } = window.jspdf;
    // Derive px-per-mm from the actual captured width rather than assuming
    // it landed exactly at trueWidthPx*CAPTURE_SCALE.
    const pxPerMm = canvas.width / A4_W_MM;
    const pageHeightPx = Math.round(A4_H_MM * pxPerMm);
    const topMarginPx = Math.round(MF_PAGE_TOP_MARGIN_MM * pxPerMm);
    const bottomMarginPx = Math.round(MF_PAGE_BOTTOM_MARGIN_MM * pxPerMm);
    const scale = canvas.width / pageRect.width;
    const blocks = mfCollectUnbreakableBlocks(page, pageRect, scale);
    const breaks = mfComputeSmartBreaks(canvas.height, pageHeightPx - bottomMarginPx, pageHeightPx - topMarginPx - bottomMarginPx, blocks);
    const totalPages = breaks.length - 1;

    // Load the logo once (if a watermark should appear) so it can be drawn
    // fresh onto every page slice below — dead center on each individual
    // A4 sheet, matching what the live preview now shows per page.
    let wmImg = null, wmOpacity = 0;
    if (f.logoDataUrl && f.watermarkOn !== false) {
      wmOpacity = Math.min(10, Math.max(5, f.watermarkOpacity == null ? 8 : f.watermarkOpacity)) / 100;
      try { wmImg = await mfLoadImageEl(f.logoDataUrl); } catch (e) { wmImg = null; }
    }

    const pdf = new jsPDF(Object.assign({ orientation: 'portrait', unit: 'mm', format: [A4_W_MM, A4_H_MM] }, sarvarcPdfEncryptionOpts(password)));
    for (let i = 0; i < totalPages; i++) {
      updateExportProgress((i / totalPages) * 90, totalPages > 1 ? `Rendering page ${i + 1} of ${totalPages}…` : 'Rendering page…');
      if (i > 0) pdf.addPage([A4_W_MM, A4_H_MM], 'portrait');
      const sliceTop = breaks[i], sliceBottom = breaks[i + 1];
      const sliceH = sliceBottom - sliceTop;
      const destY = i === 0 ? 0 : topMarginPx; // page 1 already has its own top padding baked in
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = pageHeightPx;
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceH, 0, destY, canvas.width, sliceH);
      if (wmImg) mfDrawWatermarkOnSlice(sctx, wmImg, slice.width, slice.height, wmOpacity);
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, A4_W_MM, A4_H_MM, '', 'FAST');
      if (totalPages > 1) {
        pdf.setFontSize(8);
        pdf.setTextColor(150, 156, 168);
        pdf.text(`Page ${i + 1} of ${totalPages}`, A4_W_MM - 12, A4_H_MM - 8, { align: 'right' });
      }
    }
    updateExportProgress(95, 'Saving file…');
    const fname = (f.title || 'form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.pdf';
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay(totalPages + (totalPages > 1 ? ' pages exported' : ' page exported'), { module: 'make_forms', format: 'pdf' });
    toast('Form exported as PDF' + (password ? ' (password protected)' : ''), 'success');
  } catch(e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    Object.assign(page.style, prev);
    if (stack && prevStack) Object.assign(stack.style, prevStack);
    mfUpdatePreviewPagination();
    mfExportBusy = false;
  }
}

// ─── PUSH TO WORKSPACE (PDF Editor) ───
// Bakes the logo, watermark, title, description, headings, and field labels
// exactly as they appear in the live preview into a page background, then
// lays a real, editable text box (its own font, size, color, fully
// adjustable in the PDF Editor) on top of every fillable input, textarea,
// dropdown, and signature line, so the person can actually type real answers
// with real fonts instead of being stuck with the Make Forms layout.
let mfPushInFlight = false;
async function mfPushToWorkspace() {
  if (mfPushInFlight) return; // guard against double-clicks starting two pushes at once
  const f = mfGetCurrentForm();
  const page = document.getElementById('mfPreviewPage');
  if (!f || !page) { toast('Open a form first', 'error'); return; }
  // Guard against pushing a half-translated form: a translation in flight
  // hasn't updated the preview yet (mfRenderPreview only re-renders once
  // every string is back), so capturing right now would silently push
  // whatever language was showing BEFORE the translate click — not the one
  // the person just asked for. Block and let them retry once it's done.
  if (mfFormLangBusy) { toast('Still translating — wait for it to finish so the pushed page matches', 'info'); return; }
  if (typeof html2canvas === 'undefined') { toast('Push to Workspace is unavailable right now', 'error'); return; }
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }
  mfPushInFlight = true;
  const pushBtn = document.getElementById('mfPushBtn');
  if (pushBtn) sarvarcAnimatedPush(pushBtn, 'navIcon-workspace');
  const btnPrevHtml = pushBtn ? pushBtn.innerHTML : null;
  if (pushBtn) { pushBtn.disabled = true; pushBtn.innerHTML = '<span class="mf-btn-spinner"></span>Pushing…'; }
  toast('Pushing form to Workspace…', 'info');
  // Resizing the preview to its true A4 pixel width for an accurate capture
  // (below) would otherwise cause a visible resize flash in front of the
  // user. Cover the on-screen preview column with a plain overlay for the
  // duration of the push instead of moving the panel out of the DOM — an
  // earlier version relocated it into the tiny 1x1px off-screen holder,
  // but that starved the real A4-proportioned resize of a proper layout
  // context and produced badly distorted (way-too-tall) pages. The panel
  // now stays exactly where it already lives (same in-place approach
  // Export PDF uses, which is known to size pages correctly); the overlay
  // is purely a visual mask, so it can't affect the capture at all.
  const scrollHost = page.closest('.mf-preview-scroll') || page.parentElement;
  const hostRect = scrollHost ? scrollHost.getBoundingClientRect() : null;
  let pushOverlay = null;
  if (hostRect && hostRect.width > 2 && hostRect.height > 2) {
    pushOverlay = document.createElement('div');
    pushOverlay.style.cssText = `position:fixed;left:${hostRect.left}px;top:${hostRect.top}px;width:${hostRect.width}px;height:${hostRect.height}px;background:var(--bg3,#f4f6f9);z-index:10000;display:flex;align-items:center;justify-content:center;border-radius:8px;`;
    pushOverlay.innerHTML = '<span class="mf-btn-spinner" style="width:22px;height:22px;border-color:rgba(0,0,0,0.12);border-top-color:var(--blue,#0073E6);"></span>';
    document.body.appendChild(pushOverlay);
  }
  // Always land on real 210×297mm A4 page(s) in the Workspace — the same
  // standard Refine Report standardizes every page to — instead of one
  // oversized page that merely happens to be 210mm wide. The on-screen
  // preview column is a scaled-down CSS proxy (max-width:420px), not
  // physically 210mm, so force it to its true A4 pixel width (exactly what
  // Export PDF does for an accurate capture) with natural unclipped height,
  // then slice that capture into real A4 pages below — long forms spill
  // onto additional A4 pages instead of one tall non-standard sheet.
  const A4_W_MM = 210, A4_H_MM = 297, PXMM = 3.7795, CAPTURE_SCALE = 2;
  const trueWidthPx = Math.round(A4_W_MM * PXMM);
  const stack = page.parentElement; // .mf-preview-page-stack — the actual flex child now
  const prev = { width: page.style.width, maxWidth: page.style.maxWidth, height: page.style.height, overflowY: page.style.overflowY, aspectRatio: page.style.aspectRatio };
  const prevStack = stack ? { maxWidth: stack.style.maxWidth, flex: stack.style.flex, flexShrink: stack.style.flexShrink } : null;
  page.style.width = trueWidthPx + 'px'; page.style.maxWidth = 'none';
  page.style.height = 'auto'; page.style.overflowY = 'visible'; page.style.aspectRatio = 'auto';
  // The preview panel sits inside a flex container (.mf-preview-scroll), which
  // is free to shrink our forced width back down to fit the available column
  // — flex-shrink defaults to 1, and the stack wrapper (not the page itself)
  // is the actual flex child. Pin it so the capture is really 210mm wide,
  // not silently squeezed narrower (which is what was producing badly
  // distorted, way-too-tall pages: the A4 height below was being computed
  // for a 210mm-wide capture that, in practice, wasn't actually that wide).
  if (stack) { stack.style.maxWidth = 'none'; stack.style.flex = 'none'; stack.style.flexShrink = '0'; }
  mfStripPreviewSpacers(page);
  try {
    const pageRect = page.getBoundingClientRect();

    // Capture every fillable target's position/size BEFORE rasterizing, while
    // the live preview DOM is still on screen — inputs, textareas, dropdowns,
    // signature lines, checkboxes, and every individual MCQ option bubble.
    // Checkbox/MCQ bubbles each get their own small editable box sitting
    // right on the bubble, so once pushed the person can click into the
    // Workspace and type a mark (e.g. "X") on any option line — nothing is
    // left as a flattened, unmarkable image.
    const targets = [];
    page.querySelectorAll('.mf-pv-field').forEach(fieldEl => {
      const mcqOpts = fieldEl.querySelectorAll('.mf-pv-mcq-opt input');
      if (mcqOpts.length) {
        const cs = window.getComputedStyle(fieldEl);
        const fontSize = parseFloat(cs.fontSize) || 12;
        mcqOpts.forEach(opt => {
          const r = opt.getBoundingClientRect();
          if (!r.width || !r.height) return;
          targets.push({
            x: r.left - pageRect.left,
            y: r.top - pageRect.top - 1,
            w: Math.max(16, r.width + 4),
            fontSize
          });
        });
        return;
      }
      const checkInput = fieldEl.classList.contains('mf-pv-check') ? fieldEl.querySelector('input[type="checkbox"]') : null;
      if (checkInput) {
        const r = checkInput.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const cs = window.getComputedStyle(fieldEl);
        targets.push({
          x: r.left - pageRect.left,
          y: r.top - pageRect.top - 1,
          w: Math.max(16, r.width + 4),
          fontSize: parseFloat(cs.fontSize) || 12
        });
        return;
      }
      const input = fieldEl.querySelector('.mf-pv-input, .mf-pv-textarea, .mf-pv-select-real');
      const sig = fieldEl.querySelector('.mf-pv-sig');
      const target = input || sig;
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cs = window.getComputedStyle(input || fieldEl);
      targets.push({
        x: r.left - pageRect.left + 6,
        y: r.top - pageRect.top + (sig ? -18 : 4),
        w: Math.max(20, r.width - 12),
        fontSize: parseFloat(cs.fontSize) || 12
      });
    });

    // Rasterize the form exactly as Export PDF does, so the background matches 1:1.
    const canvas = await html2canvas(page, { scale: CAPTURE_SCALE, backgroundColor: '#ffffff', useCORS: true });
    const eW = canvas.width;
    // Derive px-per-mm from the ACTUAL captured width rather than assuming
    // it landed exactly at trueWidthPx*CAPTURE_SCALE — this is what keeps
    // the output page a real A4 rectangle even if the flex-shrink guard
    // above still ended up slightly off, instead of baking in whatever
    // mismatch that produced.
    const pxPerMm = eW / A4_W_MM;
    const pageHeightPx = Math.round(A4_H_MM * pxPerMm);
    const topMarginPx = Math.round(MF_PAGE_TOP_MARGIN_MM * pxPerMm);
    const bottomMarginPx = Math.round(MF_PAGE_BOTTOM_MARGIN_MM * pxPerMm);
    const scale = eW / pageRect.width;

    // Smart pagination: never let a page break fall inside a field row or a
    // section heading, and always reserve a real top margin on continuation
    // pages plus a bottom margin for breathing room / the footer on every
    // page — the same budget the live Design-mode preview and Export PDF
    // both use, so this always matches what was already shown before pushing.
    const blocks = mfCollectUnbreakableBlocks(page, pageRect, scale);
    const breaks = mfComputeSmartBreaks(canvas.height, pageHeightPx - bottomMarginPx, pageHeightPx - topMarginPx - bottomMarginPx, blocks);
    const totalPages = breaks.length - 1;

    // Load the logo once (if a watermark should appear) so it can be drawn
    // fresh onto every page slice below — dead center on each individual
    // A4 sheet, matching what the live preview now shows per page.
    let wmImg = null, wmOpacity = 0;
    if (f.logoDataUrl && f.watermarkOn !== false) {
      wmOpacity = Math.min(10, Math.max(5, f.watermarkOpacity == null ? 8 : f.watermarkOpacity)) / 100;
      try { wmImg = await mfLoadImageEl(f.logoDataUrl); } catch (e) { wmImg = null; }
    }

    // Map each target from on-screen preview pixels into the captured raster's
    // pixel space, then bucket it onto whichever smart-break slice it falls on.
    const perPageTexts = Array.from({ length: totalPages }, () => []);
    targets.forEach((t, i) => {
      const yFull = t.y * scale;
      let pageIdx = breaks.findIndex((b, idx) => idx < totalPages && yFull >= b && yFull < breaks[idx + 1]);
      if (pageIdx === -1) pageIdx = totalPages - 1;
      const destY = pageIdx === 0 ? 0 : topMarginPx;
      perPageTexts[pageIdx].push({
        id: 'ptxt_mf_' + Date.now() + '_' + i,
        text: '',
        x: Math.round(t.x * scale),
        y: Math.round(yFull - breaks[pageIdx]) + destY,
        w: Math.round(t.w * scale),
        fontSize: Math.max(11, Math.round(t.fontSize * scale)),
        fontFamily: 'Inter',
        color: '#101820',
        bold: false, italic: false, underline: false, align: 'left',
        locked: false, zIndex: i + 1
      });
    });

    const isNewDoc = pdfed.pages.length === 0;
    const at = pdfed.pages.length;
    for (let i = 0; i < totalPages; i++) {
      const sliceTop = breaks[i], sliceBottom = breaks[i + 1];
      const sliceH = sliceBottom - sliceTop;
      const destY = i === 0 ? 0 : topMarginPx; // page 1 already has its own top padding baked in
      const out = document.createElement('canvas');
      out.width = eW; out.height = pageHeightPx;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, eW, pageHeightPx);
      octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvas, 0, sliceTop, eW, sliceH, 0, destY, eW, sliceH);
      if (wmImg) mfDrawWatermarkOnSlice(octx, wmImg, eW, pageHeightPx, wmOpacity);
      // Bake in a quiet "Page X of Y" footer on multi-page forms, matching
      // what a client would expect from a real paginated document. It sits
      // inside the reserved bottom margin, never against live content.
      if (totalPages > 1) {
        const fontPx = Math.round(8 * 0.3528 * pxPerMm);
        octx.font = `${fontPx}px Inter, Arial, sans-serif`;
        octx.fillStyle = '#96a0b1';
        octx.textAlign = 'right';
        octx.fillText(`Page ${i + 1} of ${totalPages}`, eW - Math.round(12 * pxPerMm), pageHeightPx - Math.round(8 * pxPerMm));
      }
      const dataUrl = out.toDataURL('image/png');
      pdfed.pages.push({
        type: 'blank', dataUrl, modified: true, edits: {}, textBlocks: [],
        placedTexts: perPageTexts[i],
        label: (f.title || 'Form') + (totalPages > 1 ? ` (${i + 1}/${totalPages})` : ''),
        // Marks this page as having come straight from a Make Forms push —
        // Refine Report reads this to leave pushed form pages exactly as
        // pushed and only ever restyle pages the person added afterward.
        fromMakeForm: true,
        // Record the density this page was ACTUALLY rasterized at (html2canvas
        // scale:2 above → ~7.56 px/mm, not the 3.7795 px/mm default other page
        // types use). Without this, pdfedExport() falls back to 3.7795 when
        // computing this page's physical mm size from its pixel dimensions,
        // which silently doubles it to ~420×594mm — a real A4 page next to a
        // "fake" oversized one, even though both are tagged pageMM [210,297].
        _pxPerMm: pxPerMm,
        bgColor: '#ffffff', pageMM: [A4_W_MM, A4_H_MM]
      });
      if (state && state.stats) state.stats.pages++;
    }

    if (isNewDoc) {
      pdfed.pdfDoc = null;
      pdfed.file = { name: f.title || 'Untitled Form' };
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
      if (state && state.stats) state.stats.pdfs++;
    }

    if (typeof updateStats === 'function') updateStats();

    navigate('pdfeditor');
    if (typeof pdfedBuildStrip === 'function') await pdfedBuildStrip();
    if (typeof pdfedGoto === 'function') await pdfedGoto(at);
    if (isNewDoc && typeof pdfedZoomFit === 'function') setTimeout(pdfedZoomFit, 50);
    if (isNewDoc && typeof pdfedScheduleAutoCollapse === 'function') pdfedScheduleAutoCollapse();

    toast(totalPages > 1
      ? `Form pushed to Workspace as ${totalPages} A4 pages, click any field to type`
      : 'Form pushed to Workspace, click any field to type, with full font controls', 'success');
  } catch (err) {
    console.error(err);
    toast('Could not push to Workspace: ' + err.message, 'error');
  } finally {
    Object.assign(page.style, prev);
    if (stack && prevStack) Object.assign(stack.style, prevStack);
    mfUpdatePreviewPagination();
    if (pushOverlay && pushOverlay.parentNode) pushOverlay.parentNode.removeChild(pushOverlay);
    if (pushBtn) { pushBtn.disabled = false; pushBtn.innerHTML = btnPrevHtml; }
    mfPushInFlight = false;
  }
}

// ─── CANVAS MODE: free-placement fillable text boxes on a blank A4 page ───
const MFC_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
let mfc = { formId: null, zoom: 1, selectedId: null, activePage: 0 };

function mfcGetForm() { return mfState.forms.find(f => f.id === mfc.formId); }
function mfcPageDims(f) {
  let [w, h] = MFC_SIZES[f.pageSize] || MFC_SIZES.A4;
  if (f.orientation === 'landscape') { const t = w; w = h; h = t; }
  return [w, h];
}
function mfcFindBox(f, id) {
  for (const pg of (f.pages || [])) { const b = (pg.boxes || []).find(b => b.id === id); if (b) return b; }
  return null;
}
function mfcFindBoxPage(f, id) {
  for (let i = 0; i < (f.pages || []).length; i++) { if ((f.pages[i].boxes || []).find(b => b.id === id)) return i; }
  return -1;
}
function mfcSelBox() { if (!mfc.selectedId) return null; const f = mfcGetForm(); return f ? mfcFindBox(f, mfc.selectedId) : null; }

// ─── create / open / close ───
function mfcCreateForm() {
  const form = {
    id: mfUid('form'), kind: 'canvas', title: 'Untitled Canvas Form',
    fields: [], pageSize: 'A4', orientation: 'portrait',
    showGrid: true, gridSize: 5,
    pages: [{ id: mfUid('pg'), boxes: [] }],
    activeLang: 'original', translations: {},
    updatedAt: Date.now()
  };
  mfState.forms.push(form);
  mfPersist();
  return form;
}
function mfStartCanvas() {
  const form = mfcCreateForm();
  mfcOpenEditor(form.id);
  toast('Blank canvas ready, add text boxes anywhere on the page', 'success');
}

function mfcOpenEditor(id) {
  const f = mfState.forms.find(x => x.id === id);
  if (!f) return;
  // Canvas forms saved before the translate feature existed won't have
  // these yet — default them in place so every other function can assume
  // they exist (mirrors the same guard mfOpenEditor does for field forms).
  if (f.activeLang == null) f.activeLang = 'original';
  if (f.translations == null) f.translations = {};
  mfState.currentId = id;
  mfc.formId = id; mfc.zoom = 1; mfc.selectedId = null; mfc.activePage = 0;
  const gv = document.getElementById('mfGalleryView');
  const ev = document.getElementById('mfEditorView');
  const cv = document.getElementById('mfcView');
  if (gv) gv.style.display = 'none';
  if (ev) ev.style.display = 'none';
  if (cv) cv.style.display = 'block';
  document.getElementById('mfcTitleInput').value = f.title || '';
  document.getElementById('mfcPageSizeSelect').value = f.pageSize || 'A4';
  document.getElementById('mfcPages').style.setProperty('--mfc-zoom', '1');
  mfcRenderLangControls();
  mfcRenderPages();
  mfcUpdateZoomLabel();
  mfcSyncToolbar();
  mfcSyncGridToolbar();
}
function mfcBackToGallery() {
  mfState.currentId = null; mfc.formId = null; mfc.selectedId = null;
  const gv = document.getElementById('mfGalleryView');
  const cv = document.getElementById('mfcView');
  if (cv) cv.style.display = 'none';
  if (gv) gv.style.display = 'block';
  mfRenderTemplateGrid();
  mfRenderFormsGrid();
}
function mfcUpdateTitle(val) {
  const f = mfcGetForm(); if (!f) return;
  f.title = val; mfTouch(f);
}

// ─── rendering ───
function mfcGridBg(f) {
  if (f.showGrid === false) return '';
  const g = f.gridSize || 5;
  const maj = g * 5;
  return `background-image:linear-gradient(rgba(0,115,230,0.30) 1px,transparent 1px),linear-gradient(90deg,rgba(0,115,230,0.30) 1px,transparent 1px),linear-gradient(rgba(0,115,230,0.13) 1px,transparent 1px),linear-gradient(90deg,rgba(0,115,230,0.13) 1px,transparent 1px);background-size:calc(${maj}mm * var(--mfc-zoom)) calc(${maj}mm * var(--mfc-zoom)),calc(${maj}mm * var(--mfc-zoom)) calc(${maj}mm * var(--mfc-zoom)),calc(${g}mm * var(--mfc-zoom)) calc(${g}mm * var(--mfc-zoom)),calc(${g}mm * var(--mfc-zoom)) calc(${g}mm * var(--mfc-zoom));`;
}
function mfcSnap(f, val) {
  if (f.showGrid === false) return val;
  const g = f.gridSize || 5;
  return Math.round(val / g) * g;
}
function mfcRenderPages(opts) {
  opts = opts || {};
  const f = mfcGetForm(); if (!f) return;
  const [w, h] = mfcPageDims(f);
  const wrap = document.getElementById('mfcPages');
  if (!wrap) return;
  const gridCss = opts.noGrid ? '' : mfcGridBg(f);
  // If a translated language is active, render its cached per-box text
  // instead of the original — this is what makes Export PDF, Print, and
  // Push to Workspace all show the translated form, since all three
  // rasterize this exact DOM. The underlying box.text is never touched,
  // so switching back to "Original" (or editing while on Original) is
  // never destructive.
  const tr = (f.activeLang && f.activeLang !== 'original' && f.translations) ? f.translations[f.activeLang] : null;
  wrap.innerHTML = f.pages.map((pg, pIdx) => {
    const boxesHtml = (pg.boxes || []).map(b => {
      const trText = tr ? (tr[b.id] != null ? tr[b.id] : (b.text || '')) : null;
      return mfcBoxHtml(b, b.id === mfc.selectedId, trText);
    }).join('');
    return `<div class="mfc-page-wrap">
      <div class="mfc-page-bar"><span>Page ${pIdx + 1} of ${f.pages.length}</span>${f.pages.length > 1 ? `<button onclick="mfcDeletePage(${pIdx})" title="Delete page">✕</button>` : ''}</div>
      <div class="mfc-page" data-page-idx="${pIdx}" style="width:calc(${w}mm * var(--mfc-zoom));height:calc(${h}mm * var(--mfc-zoom));${gridCss}" onmousedown="mfcPageMouseDown(event, ${pIdx})">${boxesHtml}</div>
    </div>`;
  }).join('');
}
// trText: null when the Original language is showing (box stays editable
// and reflects b.text live); a string when a translated language is active
// (box becomes read-only so typing can never land on the wrong language —
// switch back to Original on the language row to edit the source text).
function mfcBoxHtml(b, selected, trText) {
  const style = `left:calc(${b.x}mm * var(--mfc-zoom));top:calc(${b.y}mm * var(--mfc-zoom));width:calc(${b.w}mm * var(--mfc-zoom));height:calc(${b.h}mm * var(--mfc-zoom));border:${b.border ? '1px dashed rgba(0,0,0,0.35)' : 'none'};background:${b.background || 'transparent'};`;
  const innerStyle = `font-size:calc(${b.fontSize}pt * var(--mfc-zoom));font-family:'${b.fontFamily || 'Inter'}',sans-serif;font-weight:${b.bold ? 700 : 400};font-style:${b.italic ? 'italic' : 'normal'};text-decoration:${b.underline ? 'underline' : 'none'};text-align:${b.align || 'left'};color:${b.color || '#1a1a1a'};`;
  const isTranslated = trText != null;
  const displayText = isTranslated ? trText : (b.text || '');
  return `<div class="mfc-box${selected ? ' selected' : ''}" data-id="${b.id}" onmousedown="mfcSelectBox('${b.id}')" style="${style}">
    <div class="mfc-box-drag" onmousedown="mfcStartDrag(event,'${b.id}')" title="Drag to move"></div>
    <div class="mfc-box-inner" contenteditable="${isTranslated ? 'false' : 'true'}" data-ph="Text box" style="${innerStyle}${isTranslated ? 'cursor:default;' : ''}" ${isTranslated ? '' : `oninput="mfcBoxInput('${b.id}', this)"`} title="${isTranslated ? 'Translated text is read-only — switch to Original to edit' : ''}">${mfEsc(displayText)}</div>
    <div class="mfc-handle nw" onmousedown="mfcStartResize(event,'${b.id}','nw')"></div>
    <div class="mfc-handle ne" onmousedown="mfcStartResize(event,'${b.id}','ne')"></div>
    <div class="mfc-handle sw" onmousedown="mfcStartResize(event,'${b.id}','sw')"></div>
    <div class="mfc-handle se" onmousedown="mfcStartResize(event,'${b.id}','se')"></div>
  </div>`;
}
function mfcApplyBoxPosition(box) {
  const el = document.querySelector(`.mfc-box[data-id="${box.id}"]`);
  if (!el) return;
  el.style.left = `calc(${box.x}mm * var(--mfc-zoom))`;
  el.style.top = `calc(${box.y}mm * var(--mfc-zoom))`;
  el.style.width = `calc(${box.w}mm * var(--mfc-zoom))`;
  el.style.height = `calc(${box.h}mm * var(--mfc-zoom))`;
}
function mfcRestyleBox(box) {
  const el = document.querySelector(`.mfc-box[data-id="${box.id}"]`); if (!el) return;
  el.style.border = box.border ? '1px dashed rgba(0,0,0,0.35)' : 'none';
  const inner = el.querySelector('.mfc-box-inner');
  if (inner) {
    inner.style.fontSize = `calc(${box.fontSize}pt * var(--mfc-zoom))`;
    inner.style.fontWeight = box.bold ? '700' : '400';
    inner.style.fontStyle = box.italic ? 'italic' : 'normal';
    inner.style.textDecoration = box.underline ? 'underline' : 'none';
    inner.style.textAlign = box.align || 'left';
    inner.style.color = box.color || '#1a1a1a';
    inner.style.fontFamily = `'${box.fontFamily || 'Inter'}', sans-serif`;
  }
}

function mfcSetFont(value) {
  const box = mfcSelBox(); if (!box) return;
  sarvarcLoadFont(value);
  box.fontFamily = value;
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
  mfcSyncToolbar();
}

// ─── selection / editing ───
function mfcSelectBox(id) {
  mfc.selectedId = id;
  document.querySelectorAll('.mfc-box.selected').forEach(n => n.classList.remove('selected'));
  const el = document.querySelector(`.mfc-box[data-id="${id}"]`);
  if (el) el.classList.add('selected');
  mfcSyncToolbar();
}
function mfcPageMouseDown(e, pageIdx) {
  mfc.activePage = pageIdx;
  if (e.target.classList.contains('mfc-page')) {
    mfc.selectedId = null;
    document.querySelectorAll('.mfc-box.selected').forEach(n => n.classList.remove('selected'));
    mfcSyncToolbar();
  }
}
function mfcBoxInput(id, el) {
  const f = mfcGetForm(); if (!f) return;
  // Defensive: the box is only made contenteditable when Original is
  // showing (see mfcBoxHtml), but guard here too in case anything ever
  // renders it editable while a translated language is active — typing
  // must never silently land on box.text while a translation is on screen.
  if (f.activeLang && f.activeLang !== 'original') return;
  const box = mfcFindBox(f, id); if (!box) return;
  box.text = el.innerText;
  mfTouch(f);
}

// ─── add / duplicate / delete box ───
function mfcAddTextBox() {
  const f = mfcGetForm(); if (!f) return;
  const pIdx = Math.min(mfc.activePage || 0, f.pages.length - 1);
  const pg = f.pages[pIdx]; if (!pg) return;
  const n = pg.boxes.length;
  const box = {
    id: mfUid('box'), x: 15 + (n % 5) * 8, y: 15 + (n % 8) * 10, w: 70, h: 14,
    text: '', fontSize: 12, fontFamily: 'Inter', bold: false, italic: false, underline: false,
    align: 'left', color: '#1a1a1a', border: true, background: 'transparent'
  };
  pg.boxes.push(box);
  mfTouch(f);
  mfc.selectedId = box.id;
  mfcRenderPages();
  mfcSyncToolbar();
  setTimeout(() => {
    const el = document.querySelector(`.mfc-box[data-id="${box.id}"] .mfc-box-inner`);
    if (el) el.focus();
  }, 30);
}
function mfcDuplicateBox() {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  const f = mfcGetForm(); const pIdx = mfcFindBoxPage(f, box.id); const pg = f.pages[pIdx];
  const copy = { ...box, id: mfUid('box'), x: box.x + 8, y: box.y + 8 };
  pg.boxes.push(copy);
  mfTouch(f);
  mfc.selectedId = copy.id;
  mfcRenderPages();
  mfcSyncToolbar();
}
function mfcDeleteBox() {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  const f = mfcGetForm(); const pIdx = mfcFindBoxPage(f, box.id); const pg = f.pages[pIdx];
  pg.boxes = pg.boxes.filter(b => b.id !== box.id);
  mfc.selectedId = null;
  mfTouch(f);
  mfcRenderPages();
  mfcSyncToolbar();
}

// ─── drag / resize ───
function mfcStartDrag(e, id) {
  e.preventDefault(); e.stopPropagation();
  mfcSelectBox(id);
  const f = mfcGetForm(); const box = mfcFindBox(f, id); if (!box) return;
  const pageIdx = mfcFindBoxPage(f, id);
  const pageEl = document.querySelector(`.mfc-page[data-page-idx="${pageIdx}"]`); if (!pageEl) return;
  const [pageW, pageH] = mfcPageDims(f);
  const rect = pageEl.getBoundingClientRect();
  const pxPerMm = rect.width / pageW;
  const startX = e.clientX, startY = e.clientY;
  const origX = box.x, origY = box.y;
  function onMove(ev) {
    const dx = (ev.clientX - startX) / pxPerMm, dy = (ev.clientY - startY) / pxPerMm;
    const nx = mfcSnap(f, origX + dx), ny = mfcSnap(f, origY + dy);
    box.x = Math.max(0, Math.min(pageW - box.w, nx));
    box.y = Math.max(0, Math.min(pageH - box.h, ny));
    mfcApplyBoxPosition(box);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    mfTouch(f);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function mfcStartResize(e, id, corner) {
  e.preventDefault(); e.stopPropagation();
  mfcSelectBox(id);
  const f = mfcGetForm(); const box = mfcFindBox(f, id); if (!box) return;
  const pageIdx = mfcFindBoxPage(f, id);
  const pageEl = document.querySelector(`.mfc-page[data-page-idx="${pageIdx}"]`); if (!pageEl) return;
  const [pageW, pageH] = mfcPageDims(f);
  const rect = pageEl.getBoundingClientRect();
  const pxPerMm = rect.width / pageW;
  const startX = e.clientX, startY = e.clientY;
  const o = { x: box.x, y: box.y, w: box.w, h: box.h };
  function onMove(ev) {
    const dx = (ev.clientX - startX) / pxPerMm, dy = (ev.clientY - startY) / pxPerMm;
    let { x, y, w, h } = o;
    if (corner.includes('e')) w = mfcSnap(f, Math.max(15, o.w + dx));
    if (corner.includes('s')) h = mfcSnap(f, Math.max(8, o.h + dy));
    if (corner.includes('w')) { w = mfcSnap(f, Math.max(15, o.w - dx)); x = o.x + (o.w - w); }
    if (corner.includes('n')) { h = mfcSnap(f, Math.max(8, o.h - dy)); y = o.y + (o.h - h); }
    x = Math.max(0, Math.min(x, pageW - w));
    y = Math.max(0, Math.min(y, pageH - h));
    box.x = x; box.y = y; box.w = w; box.h = h;
    mfcApplyBoxPosition(box);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    mfTouch(f);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
document.addEventListener('keydown', function (e) {
  const view = document.getElementById('mfcView');
  if (!view || view.style.display === 'none') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && mfc.selectedId &&
      document.activeElement && !document.activeElement.classList.contains('mfc-box-inner')) {
    e.preventDefault();
    mfcDeleteBox();
  }
});

// ─── style toolbar actions ───
function mfcToggleStyle(prop) {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  box[prop] = !box[prop];
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
  mfcSyncToolbar();
}
function mfcAlign(v) {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  box.align = v;
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
}
function mfcFontStep(delta) {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  box.fontSize = Math.max(6, Math.min(96, (box.fontSize || 12) + delta));
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
  mfcSyncToolbar();
}
function mfcSetColor(v) {
  const box = mfcSelBox(); if (!box) return;
  box.color = v;
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
}
function mfcToggleBorder() {
  const box = mfcSelBox(); if (!box) { toast('Select a text box first', 'info'); return; }
  box.border = !box.border;
  mfTouch(mfcGetForm());
  mfcRestyleBox(box);
  mfcSyncToolbar();
}
function mfcSyncToolbar() {
  const box = mfcSelBox();
  const b = document.getElementById('mfcBtnBold'), i = document.getElementById('mfcBtnItalic'),
        u = document.getElementById('mfcBtnUnderline'), bd = document.getElementById('mfcBtnBorder');
  const fs = document.getElementById('mfcFontSizeVal'), col = document.getElementById('mfcColorInput');
  if (box) {
    if (b) b.classList.toggle('active', !!box.bold);
    if (i) i.classList.toggle('active', !!box.italic);
    if (u) u.classList.toggle('active', !!box.underline);
    if (bd) bd.classList.toggle('active', !!box.border);
    if (fs) fs.textContent = box.fontSize;
    if (col) col.value = box.color || '#1a1a1a';
    const fb = document.getElementById('mfcFontBtn');
    if (fb) fb.textContent = (box.fontFamily || 'Inter').split(',')[0].replace(/['"]/g, '');
  } else {
    [b, i, u, bd].forEach(x => x && x.classList.remove('active'));
    if (fs) fs.textContent = '12';
    const fb = document.getElementById('mfcFontBtn');
    if (fb) fb.textContent = 'Inter';
  }
}

// ─── grid ───
function mfcToggleGrid() {
  const f = mfcGetForm(); if (!f) return;
  f.showGrid = f.showGrid === false ? true : false;
  mfTouch(f);
  mfcRenderPages();
  mfcSyncGridToolbar();
}
function mfcSetGridSize(v) {
  const f = mfcGetForm(); if (!f) return;
  f.gridSize = parseFloat(v) || 5;
  mfTouch(f);
  mfcRenderPages();
}
function mfcSyncGridToolbar() {
  const f = mfcGetForm(); if (!f) return;
  const btn = document.getElementById('mfcBtnGrid');
  const sel = document.getElementById('mfcGridSizeSelect');
  if (btn) btn.classList.toggle('active', f.showGrid !== false);
  if (sel) sel.value = String(f.gridSize || 5);
}

// ─── page management ───
function mfcAddPage() {
  const f = mfcGetForm(); if (!f) return;
  f.pages.push({ id: mfUid('pg'), boxes: [] });
  mfc.activePage = f.pages.length - 1;
  mfTouch(f);
  mfcRenderPages();
  toast('Page added', 'success');
}
function mfcDeletePage(idx) {
  const f = mfcGetForm(); if (!f) return;
  if (f.pages.length <= 1) { toast('A form needs at least one page', 'error'); return; }
  if (!confirm('Delete this page and everything on it?')) return;
  f.pages.splice(idx, 1);
  mfc.selectedId = null;
  mfc.activePage = 0;
  mfTouch(f);
  mfcRenderPages();
}
function mfcSetPageSize(v) {
  const f = mfcGetForm(); if (!f) return;
  f.pageSize = v;
  mfTouch(f);
  mfcRenderPages();
}
function mfcToggleOrientation() {
  const f = mfcGetForm(); if (!f) return;
  f.orientation = f.orientation === 'landscape' ? 'portrait' : 'landscape';
  mfTouch(f);
  mfcRenderPages();
}

// ─── zoom ───
function mfcZoom(delta) {
  mfc.zoom = Math.max(0.4, Math.min(2, +(mfc.zoom + delta).toFixed(2)));
  const wrap = document.getElementById('mfcPages');
  if (wrap) wrap.style.setProperty('--mfc-zoom', mfc.zoom);
  mfcUpdateZoomLabel();
}
function mfcUpdateZoomLabel() {
  const el = document.getElementById('mfcZoomVal');
  if (el) el.textContent = Math.round(mfc.zoom * 100) + '%';
}

// ─── print / export ───
function mfcPrint() {
  const f = mfcGetForm(); if (!f) { toast('Open a form first', 'error'); return; }
  if (mfCanvasLangBusy) { toast('Still translating — wait for it to finish so the printed copy matches', 'info'); return; }
  document.body.classList.add('mfc-printing');
  const cleanup = () => document.body.classList.remove('mfc-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => { window.print(); }, 30);
}
// ─── EXPORT DROPDOWN (Canvas Form) ───
function mfcToggleExportDropdown(e) {
  if (e) e.stopPropagation();
  const btn = document.getElementById('mfcExportBtn');
  if (!btn) return;
  const dd = document.getElementById('mfcExportDropdown');
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
  const dd = document.getElementById('mfcExportDropdown');
  const btn = document.getElementById('mfcExportBtn');
  if (dd && dd.classList.contains('open') && !dd.contains(e.target) && (!btn || !btn.contains(e.target))) {
    dd.classList.remove('open');
  }
});
function mfcExportAs(fmt) {
  const dd = document.getElementById('mfcExportDropdown');
  if (dd) dd.classList.remove('open');
  if (fmt === 'pdf') mfcExportPDF();
  else if (fmt === 'docx') mfcExportDOCX();
  else if (fmt === 'image') mfcExportImages();
}

// Canvas Form pages are nothing but placed text boxes (no logo/background/
// baked layout like the field-based form has), so instead of flattening
// the page into one picture and losing all of it, this builds the .docx
// straight from each box's x/y/w/h/font/color/border/text — every box
// becomes a real, natively-editable Word text box (mfDocxTextboxXml) sitting
// at the exact same position and styling it has on the canvas. No
// rasterization, no image relationships needed: the whole export is vector,
// so text stays sharp at any zoom and every box is directly typeable.
let mfcExportBusy = false;
async function mfcExportDOCX() {
  const f = mfcGetForm(); if (!f) { toast('Open a form first', 'error'); return; }
  if (mfCanvasLangBusy) { toast('Still translating — wait for it to finish so the exported file matches', 'info'); return; }
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  if (mfcExportBusy) return; // guard against double-clicks starting two exports at once
  mfcExportBusy = true;
  showExportOverlay('Exporting Word…', 'Placing text boxes…');
  try {
    const [mmW, mmH] = mfcPageDims(f);
    const pages = f.pages || [];
    if (!pages.length || !pages.some(pg => (pg.boxes || []).length)) { hideExportOverlay(); toast('Nothing to export yet', 'info'); return; }
    const tr = (f.activeLang && f.activeLang !== 'original' && f.translations) ? f.translations[f.activeLang] : null;
    const PAGE_W_TWIPS = Math.round(mmW * 56.6929), PAGE_H_TWIPS = Math.round(mmH * 56.6929), MARGIN_TWIPS = 0;
    let bodyXml = '';
    let boxCount = 0;
    pages.forEach((pg, i) => {
      updateExportProgress((i / pages.length) * 90, `Placing page ${i + 1} of ${pages.length}…`);
      if (i > 0) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      (pg.boxes || []).forEach(b => {
        boxCount++;
        const text = tr ? (tr[b.id] != null ? tr[b.id] : (b.text || '')) : (b.text || '');
        bodyXml += mfDocxTextboxXml({
          xMm: b.x, yMm: b.y, wMm: b.w, hMm: b.h,
          fontSizePt: b.fontSize || 12, fontFamily: b.fontFamily || 'Calibri',
          color: b.color || '#1a1a1a', align: b.align || 'left',
          bold: !!b.bold, italic: !!b.italic, underline: !!b.underline,
          border: !!b.border, background: b.background,
          text
        });
      });
      if (window.sarvarcApplyFreeWatermark) bodyXml += sarvarcDocxWatermarkXml(mmW, mmH);
    });
    updateExportProgress(92, 'Building document…');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${MF_DOCX_ROOT_NAMESPACES}><w:body>${bodyXml}` +
      `<w:sectPr><w:pgSz w:w="${PAGE_W_TWIPS}" w:h="${PAGE_H_TWIPS}"/>` +
      `<w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" w:left="${MARGIN_TWIPS}"/></w:sectPr></w:body></w:document>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    zip.folder('word').file('document.xml', documentXml);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const fname = (f.title || 'canvas_form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.docx';
    pdfedDownloadBlob(blob, sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay('Word document exported', { module: 'make_forms_canvas', format: 'docx' });
    toast(`Form exported as Word document — ${boxCount} box${boxCount === 1 ? '' : 'es'} ready to edit`, 'success');
  } catch (e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfcExportBusy = false;
  }
}

// Saves each canvas page as a PNG — a plain single download for a one-page
// form, or a ZIP bundle for a multi-page one.
async function mfcExportImages() {
  const f = mfcGetForm(); if (!f) { toast('Open a form first', 'error'); return; }
  if (mfCanvasLangBusy) { toast('Still translating — wait for it to finish so the exported file matches', 'info'); return; }
  if (typeof html2canvas === 'undefined') { toast('Export is unavailable right now', 'error'); return; }
  if (mfcExportBusy) return; // guard against double-clicks starting two exports at once
  mfcExportBusy = true;
  showExportOverlay('Exporting images…', 'Rendering pages…');
  try {
    // mfcRasterizePages now returns {dataUrl, w, h} per shot (needed by the
    // push-to-Workspace path to record accurate page density) — this export
    // path only ever needs the images themselves, so unwrap to plain
    // dataUrl strings right away and leave everything below unchanged.
    let shots = (await mfcRasterizePages(f)).map(s => s.dataUrl);
    if (!shots.length) { hideExportOverlay(); toast('Nothing to export yet', 'info'); return; }
    if (window.sarvarcApplyFreeWatermark) shots = await Promise.all(shots.map(sarvarcStampDataUrlWatermark));
    const base = (f.title || 'canvas_form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'canvas_form';
    if (shots.length === 1) {
      updateExportProgress(50, 'Rendering page…');
      const res = await fetch(shots[0]);
      const blob = await res.blob();
      updateExportProgress(95, 'Saving file…');
      pdfedDownloadBlob(blob, sarvarcBrandFilename(base + '.png'));
      completeExportOverlay('1 page exported', { module: 'make_forms_canvas', format: 'image' });
      toast('Form exported as image', 'success');
    } else {
      if (typeof JSZip === 'undefined') { hideExportOverlay(); toast('Zip engine failed to load, check your connection', 'error'); return; }
      const zip = new JSZip();
      shots.forEach((dataUrl, i) => {
        updateExportProgress((i / shots.length) * 80, `Packing page ${i + 1} of ${shots.length}…`);
        zip.file(base + '-page' + (i + 1) + '.png', dataUrl.split(',')[1], { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        updateExportProgress(80 + metadata.percent * 0.18, `Compressing… ${Math.round(metadata.percent)}%`);
      });
      pdfedDownloadBlob(blob, sarvarcBrandFilename(base + '-pages.zip'));
      completeExportOverlay(shots.length + ' pages exported', { module: 'make_forms_canvas', format: 'image' });
      toast('Exported ' + shots.length + ' images', 'success');
    }
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
  } catch (e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfcExportBusy = false;
  }
}

async function mfcExportPDF() {
  const f = mfcGetForm(); if (!f) { toast('Open a form first', 'error'); return; }
  if (mfCanvasLangBusy) { toast('Still translating — wait for it to finish so the exported PDF matches', 'info'); return; }
  if (typeof html2canvas === 'undefined' || !window.jspdf) { toast('PDF export is unavailable right now', 'error'); return; }
  if (mfcExportBusy) return; // guard against double-clicks starting two exports at once
  const password = await sarvarcAskExportPassword('Export Form as PDF');
  if (password === undefined) return; // cancelled
  mfcExportBusy = true;
  showExportOverlay('Exporting your PDF…', 'Preparing page…');
  const prevZoom = mfc.zoom, prevSel = mfc.selectedId;
  mfc.zoom = 1; mfc.selectedId = null;
  const wrap = document.getElementById('mfcPages');
  if (wrap) wrap.style.setProperty('--mfc-zoom', '1');
  mfcRenderPages({ noGrid: true });
  await new Promise(r => setTimeout(r, 60));
  try {
    const { jsPDF } = window.jspdf;
    const [mmW, mmH] = mfcPageDims(f);
    const pageEls = document.querySelectorAll('#mfcPages .mfc-page');
    let pdf = null;
    for (let i = 0; i < pageEls.length; i++) {
      updateExportProgress((i / pageEls.length) * 90, pageEls.length > 1 ? `Rendering page ${i + 1} of ${pageEls.length}…` : 'Rendering page…');
      const canvas = await html2canvas(pageEls[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const img = canvas.toDataURL('image/png');
      if (!pdf) pdf = new jsPDF(Object.assign({ orientation: mmW > mmH ? 'landscape' : 'portrait', unit: 'mm', format: [mmW, mmH] }, sarvarcPdfEncryptionOpts(password)));
      else pdf.addPage([mmW, mmH], mmW > mmH ? 'landscape' : 'portrait');
      pdf.addImage(img, 'PNG', 0, 0, mmW, mmH, '', 'FAST');
    }
    updateExportProgress(95, 'Saving file…');
    const fname = (f.title || 'canvas_form').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.pdf';
    if (window.sarvarcApplyFreeWatermark) sarvarcStampPdfWatermark(pdf);
    pdf.save(sarvarcBrandFilename(fname));
    if (state && state.stats) { state.stats.exports++; if (typeof updateStats === 'function') updateStats(); }
    completeExportOverlay(pageEls.length + (pageEls.length > 1 ? ' pages exported' : ' page exported'), { module: 'make_forms_canvas', format: 'pdf' });
    toast('Form exported as PDF' + (password ? ' (password protected)' : ''), 'success');
  } catch (e) {
    console.error(e);
    hideExportOverlay();
    toast('Export failed: ' + e.message, 'error');
  } finally {
    mfc.zoom = prevZoom; mfc.selectedId = prevSel;
    if (wrap) wrap.style.setProperty('--mfc-zoom', prevZoom);
    mfcRenderPages();
    mfcUpdateZoomLabel();
    mfcSyncToolbar();
    mfcExportBusy = false;
  }
}

// ── Push-to-Workspace: destination choice modal (Canvas Form) ──
// Mirrors the Data Arrangement pattern: ask whether the canvas form should
// land as brand-new page(s) in the Workspace, or be dropped onto the page
// currently open there.
function mfcOpenPushChoiceModal() {
  const f = mfcGetForm();
  if (!f) { toast('Open a form first', 'error'); return; }
  if (!f.pages || !f.pages.length) { toast('Nothing to push yet', 'info'); return; }
  // Guard against pushing a half-translated canvas: a translation in flight
  // hasn't re-rendered #mfcPages yet, so rasterizing right now would push
  // whatever language was on screen BEFORE Translate was clicked, not the
  // one just requested. Block and let them retry once it's done.
  if (mfCanvasLangBusy) { toast('Still translating — wait for it to finish so the pushed page matches', 'info'); return; }
  if (typeof html2canvas === 'undefined') { toast('Push to Workspace is unavailable right now', 'error'); return; }
  if (typeof pdfed === 'undefined' || typeof navigate !== 'function') { toast('Workspace editor is unavailable right now', 'error'); return; }
  const overlay = document.getElementById('mfcPushChoiceOverlay');
  if (overlay) overlay.classList.add('open');
}
function mfcClosePushChoice() {
  const overlay = document.getElementById('mfcPushChoiceOverlay');
  if (overlay) overlay.classList.remove('open');
}
function mfcConfirmPushChoice(mode, cardEl) {
  if (cardEl) sarvarcAnimatedPush(cardEl, 'navIcon-workspace');
  mfcClosePushChoice();
  mfcPushToWorkspace(mode);
}

const MFC_PUSH_PXMM = 3.7795;   // same canvas px-per-mm density placed items already live in
const MFC_PUSH_MARGIN = 60;     // margin around the form when dropped onto a live page

// Rasterizes every canvas page at full quality, same as Export PDF does, so
// what lands in the Workspace matches the live canvas 1:1.
// Returns {dataUrl, w, h} per page (w/h = the ACTUAL captured pixel
// dimensions) instead of a bare dataUrl string — html2canvas's scale:2 here
// means each shot is captured at roughly double the page's on-screen CSS
// density, and callers need those real pixel dims (not an assumed density)
// to record an accurate _pxPerMm on any brand-new page built from a shot.
// Without this, a canvas form pushed as new page(s) would silently land at
// ~2x true size in both the editor and the exported PDF — the same bug
// mfPushToWorkspace (Make Forms) had before its _pxPerMm fix.
async function mfcRasterizePages(f) {
  const prevZoom = mfc.zoom, prevSel = mfc.selectedId;
  mfc.zoom = 1; mfc.selectedId = null;
  const wrap = document.getElementById('mfcPages');
  if (wrap) wrap.style.setProperty('--mfc-zoom', '1');
  mfcRenderPages({ noGrid: true });
  await new Promise(r => setTimeout(r, 60));
  const pageEls = document.querySelectorAll('#mfcPages .mfc-page');
  const shots = [];
  for (let i = 0; i < pageEls.length; i++) {
    const canvas = await html2canvas(pageEls[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    shots.push({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
  }
  mfc.zoom = prevZoom; mfc.selectedId = prevSel;
  if (wrap) wrap.style.setProperty('--mfc-zoom', prevZoom);
  mfcRenderPages();
  mfcUpdateZoomLabel();
  mfcSyncToolbar();
  return shots;
}

// Builds a brand-new blank Workspace page sized to match one canvas page,
// with that page's rasterized content baked straight into the background
// (same idea as pdfedAppendTableFitPages does for tables, one page per chunk).
// pxPerMm MUST be the density the dataUrl was actually captured at (from
// mfcRasterizePages' shot.w / mmW) — not assumed — so pdfedExport and the
// live editor's zoom (both of which read pg._pxPerMm) size this page
// correctly instead of defaulting to the wrong density.
function mfcMakeFittedPage(dataUrl, mmW, mmH, label, pxPerMm) {
  return {
    type: 'blank', dataUrl, modified: true, edits: {}, textBlocks: [],
    placedTexts: [], placedImages: [], label: label || 'Canvas Form',
    bgColor: '#ffffff', pageMM: [mmW, mmH],
    // Marks this page as having come straight from a Make Forms push — see
    // the matching flag in mfPushToWorkspace for why Refine Report cares.
    fromMakeForm: true,
    _pxPerMm: pxPerMm || MFC_PUSH_PXMM
  };
}

async function mfcPushToWorkspace(mode) {
  const f = mfcGetForm();
  if (!f) { toast('Open a form first', 'error'); return; }
  if (!f.pages || !f.pages.length) { toast('Nothing to push yet', 'info'); return; }

  const pushBtn = document.getElementById('mfcPushBtn');
  if (pushBtn) pushBtn.disabled = true;
  toast('Pushing form to Workspace…', 'info');

  try {
    const [mmW, mmH] = mfcPageDims(f);
    const shots = await mfcRasterizePages(f);
    if (!shots.length) { toast('Nothing to push yet', 'info'); return; }

    const noWorkspaceYet = !pdfed.pages || pdfed.pages.length === 0;
    if (noWorkspaceYet) {
      pdfed.pages = [];
      pdfed.pdfDoc = null;
      pdfed.file = { name: f.title || 'Untitled Canvas Form' };
      ['pdfedExportBtn', 'pdfedRefineBtn', 'pdfedExportBtn2', 'pdfedCloseBtn', 'pdfedPageInfoPill'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      const upBtn = document.getElementById('pdfedUploadBtn'); if (upBtn) upBtn.style.display = 'none';
      const fnEl = document.getElementById('pdfedFileName'); if (fnEl) fnEl.textContent = pdfed.file.name;
      const ph = document.getElementById('pdfedPlaceholder'); if (ph) ph.style.display = 'none';
      const cw = document.getElementById('pdfedCanvasWrap'); if (cw) cw.style.display = 'inline-block';
      const tb = document.getElementById('pdfedToolbar'); if (tb) tb.style.visibility = 'visible';
      if (state && state.stats) state.stats.pdfs++;
    }

    // "Live" destination: drop the first canvas page directly onto the page
    // currently open in the Workspace, same as Data Arrangement's "Add to
    // Live Page" choice. Only possible if a document is already open;
    // otherwise fall through to the "new" behavior below.
    const liveIdx = pdfed.active;
    const hasLivePage = mode === 'live' && !noWorkspaceYet && pdfed.pages.length > 0 && liveIdx >= 0 && pdfed.pages[liveIdx];

    if (hasLivePage) {
      const pg = pdfed.pages[liveIdx];
      const [pageMmW, pageMmH] = pg.pageMM || [210, 297];
      const eW = Math.round(pageMmW * MFC_PUSH_PXMM), eH = Math.round(pageMmH * MFC_PUSH_PXMM);
      const availW = Math.max(120, eW - MFC_PUSH_MARGIN);
      const availH = Math.max(120, eH - MFC_PUSH_MARGIN);

      // Fit the first canvas page into the space available on the live page,
      // preserving its own aspect ratio (mirrors daFitTableToPage's role).
      const aspect = mmH / mmW;
      let w = availW, h = w * aspect;
      if (h > availH) { h = availH; w = h / aspect; }

      if (!pg.placedImages) pg.placedImages = [];
      const n = pg.placedImages.length;
      const baseX = Math.max(20, Math.round((eW - w) / 2));
      const baseY = Math.max(20, Math.round((eH - h) / 2));
      const x = pdfed.snapGrid ? pdfedSnapToGrid(baseX + (n % 6) * 16) : baseX + (n % 6) * 16;
      const y = pdfed.snapGrid ? pdfedSnapToGrid(baseY + (n % 6) * 16) : baseY + (n % 6) * 16;

      pg.placedImages.push({
        id: 'pimg_mfc_' + Date.now(),
        dataUrl: shots[0].dataUrl, x, y, w, h,
        locked: false,
        zIndex: pdfedNextZ(pg)
      });
      pdfedMarkModified(liveIdx);

      // Any remaining canvas pages spill onto brand-new fitted page(s)
      // appended at the end, each sized to match the canvas's own page size.
      const remaining = shots.slice(1);
      remaining.forEach(shot => {
        pdfed.pages.push(mfcMakeFittedPage(shot.dataUrl, mmW, mmH, f.title, shot.w / mmW));
        if (state && state.stats) state.stats.pages++;
      });
      if (typeof updateStats === 'function') updateStats();

      navigate('pdfeditor');
      await pdfedBuildStrip();
      await pdfedGoto(liveIdx);
      if (typeof pdfedRenderPlacedImages === 'function') pdfedRenderPlacedImages(liveIdx);
      setTimeout(pdfedZoomFit, 60);

      const totalPages = shots.length;
      const pageWord = totalPages > 1
        ? `${totalPages} pages (dropped onto the live page, ${remaining.length} new page${remaining.length !== 1 ? 's' : ''} added for the rest)`
        : 'the live page';
      toast(`"${f.title || 'Canvas form'}" pushed to Workspace, ${pageWord}.`, 'success');
    } else {
      // Land on fresh page(s) appended at the end, sized to exactly match
      // the canvas's own page dimensions, one Workspace page per canvas page.
      let firstNewIdx = -1;
      shots.forEach(shot => {
        pdfed.pages.push(mfcMakeFittedPage(shot.dataUrl, mmW, mmH, f.title, shot.w / mmW));
        if (firstNewIdx === -1) firstNewIdx = pdfed.pages.length - 1;
        if (state && state.stats) state.stats.pages++;
      });
      if (typeof updateStats === 'function') updateStats();

      navigate('pdfeditor');
      await pdfedBuildStrip();
      await pdfedGoto(firstNewIdx);
      setTimeout(pdfedZoomFit, 60);

      const pageWord = shots.length > 1 ? `${shots.length} pages` : '1 page';
      toast(`"${f.title || 'Canvas form'}" pushed to Workspace, ${pageWord}. Canvas size adjusted to fit the form.`, 'success');
    }
  } catch (err) {
    console.error('Push to Workspace failed:', err);
    toast('Could not push to Workspace, please try again', 'error');
  } finally {
    if (pushBtn) pushBtn.disabled = false;
  }
}

// expose the functions this section's inline HTML calls
window.mfToggleTemplatePicker = mfToggleTemplatePicker;
window.mfCreateFromTemplate = mfCreateFromTemplate;
window.MF_TEMPLATES = MF_TEMPLATES;
window.mfState = mfState;
window.mfGetResponses = mfGetResponses;
window.SARVARC_FORMS_PUBLIC_BASE_URL = SARVARC_FORMS_PUBLIC_BASE_URL;
window.mfGetCurrentForm = mfGetCurrentForm;
window.mfNewField = mfNewField;
window.mfRenderFieldList = mfRenderFieldList;
window.mfRenderPreview = mfRenderPreview;
window.mfTouch = mfTouch;
window.mfSetLogoFromDataUrl = mfSetLogoFromDataUrl;
window.mfSetBannerFromDataUrl = mfSetBannerFromDataUrl;
window.mfRenderSocialLinks = mfRenderSocialLinks;
window.mfDuplicateForm = mfDuplicateForm;
window.mfDuplicateCurrent = mfDuplicateCurrent;
window.mfDeleteForm = mfDeleteForm;
window.mfOpenEditor = mfOpenEditor;
window.mfBackToGallery = mfBackToGallery;
window.mfUpdateTitle = mfUpdateTitle;
window.mfUpdateDesc = mfUpdateDesc;
window.mfAddField = mfAddField;
window.mfRemoveField = mfRemoveField;
window.mfMoveField = mfMoveField;
window.mfUpdateFieldProp = mfUpdateFieldProp;
window.mfUpdateFieldOptions = mfUpdateFieldOptions;
window.mfToggleFieldRequired = mfToggleFieldRequired;
window.mfHandleLogoUpload = mfHandleLogoUpload;
window.mfRemoveLogo = mfRemoveLogo;
window.mfSetAccentColor = mfSetAccentColor;
window.mfSetSocialLink = mfSetSocialLink;
window.mfStartBlank = mfStartBlank;
window.mfToggleWatermark = mfToggleWatermark;
window.mfSetWatermarkOpacity = mfSetWatermarkOpacity;
window.mfHandleBannerUpload = mfHandleBannerUpload;
window.mfRemoveBanner = mfRemoveBanner;
window.mfSetBannerOpacity = mfSetBannerOpacity;
window.mfPrintForm = mfPrintForm;
window.mfExportPDF = mfExportPDF;
window.mfExportDOCX = mfExportDOCX;
window.mfExportImages = mfExportImages;
window.mfToggleExportDropdown = mfToggleExportDropdown;
window.mfExportAs = mfExportAs;
window.mfAddAttachmentFolder = mfAddAttachmentFolder;
window.mfOpenNewFolderModal = mfOpenNewFolderModal;
window.mfCloseNewFolderModal = mfCloseNewFolderModal;
window.mfConfirmNewFolder = mfConfirmNewFolder;
window.mfRenameAttachmentFolder = mfRenameAttachmentFolder;
window.mfDeleteAttachmentFolder = mfDeleteAttachmentFolder;
window.mfAttachFileInputClick = mfAttachFileInputClick;
window.mfHandleAttachmentUpload = mfHandleAttachmentUpload;
window.mfRemoveAttachmentFile = mfRemoveAttachmentFile;
window.mfOpenAttachmentFile = mfOpenAttachmentFile;
window.mfPushToWorkspace = mfPushToWorkspace;
window.mfSwitchMode = mfSwitchMode;
window.mfNewResponseDraft = mfNewResponseDraft;
window.mfClearDraft = mfClearDraft;
window.mfLoadResponse = mfLoadResponse;
window.mfSaveResponse = mfSaveResponse;
window.mfSigOpen = mfSigOpen;
window.mfSigClear = mfSigClear;
window.mfSigDownloadDraft = mfSigDownloadDraft;
window.mfSigDownloadResponse = mfSigDownloadResponse;
window.mfDeleteResponse = mfDeleteResponse;
window.mfExportSingleResponsePDF = mfExportSingleResponsePDF;
window.mfExportAllResponsesPDF = mfExportAllResponsesPDF;
window.mfExportResponsesToDA = mfExportResponsesToDA;
window.mfOpenMergeModal = mfOpenMergeModal;
window.mfCloseMergeModal = mfCloseMergeModal;
window.mfRenderMergeMapping = mfRenderMergeMapping;
window.mfConfirmMergeImport = mfConfirmMergeImport;
window.mfStartCanvas = mfStartCanvas;
window.mfcOpenEditor = mfcOpenEditor;
window.mfcBackToGallery = mfcBackToGallery;
window.mfcUpdateTitle = mfcUpdateTitle;
window.mfcAddTextBox = mfcAddTextBox;
window.mfcDuplicateBox = mfcDuplicateBox;
window.mfcDeleteBox = mfcDeleteBox;
window.mfcSelectBox = mfcSelectBox;
window.mfcPageMouseDown = mfcPageMouseDown;
window.mfcBoxInput = mfcBoxInput;
window.mfcStartDrag = mfcStartDrag;
window.mfcStartResize = mfcStartResize;
window.mfcToggleStyle = mfcToggleStyle;
window.mfcAlign = mfcAlign;
window.mfcFontStep = mfcFontStep;
window.mfcSetColor = mfcSetColor;
window.mfcToggleBorder = mfcToggleBorder;
window.mfcAddPage = mfcAddPage;
window.mfcDeletePage = mfcDeletePage;
window.mfcSetPageSize = mfcSetPageSize;
window.mfcToggleOrientation = mfcToggleOrientation;
window.mfcToggleGrid = mfcToggleGrid;
window.mfcSetGridSize = mfcSetGridSize;
window.mfcZoom = mfcZoom;
window.mfcPrint = mfcPrint;
window.mfcExportPDF = mfcExportPDF;
window.mfcExportDOCX = mfcExportDOCX;
window.mfcExportImages = mfcExportImages;
window.mfcToggleExportDropdown = mfcToggleExportDropdown;
window.mfcExportAs = mfcExportAs;
window.mfcOpenPushChoiceModal = mfcOpenPushChoiceModal;
window.mfcClosePushChoice = mfcClosePushChoice;
window.mfcConfirmPushChoice = mfcConfirmPushChoice;
window.mfcPushToWorkspace = mfcPushToWorkspace;


// init
mfLoad();
mfLoadAttachmentBlobs(); // async — fills in mfAttachBlobs from IndexedDB shortly after boot
mfRenderTemplateGrid();
mfRenderFormsGrid();
// Fire-and-forget: reattaches any form's publish link that a just-loaded
// Session snapshot left disconnected, then silently pulls in whatever
// responses were collected on the server in the meantime. Runs on every
// normal page boot too (harmless no-op when nothing's disconnected), which
// is exactly what fires right after Sessions' own location.reload().
if (typeof mfReconcilePublishState === 'function') mfReconcilePublishState();

window.mfReconcilePublishState = mfReconcilePublishState;

})();
