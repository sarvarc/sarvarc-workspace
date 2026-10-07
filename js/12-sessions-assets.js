// ─── PDF EDITOR ───────────────────────────────────────────────

// Patch navigate to support pdfeditor tab
const _navOrig = navigate;
navigate = function(sec) {
  _navOrig(sec);
  if (sec === 'pdfeditor') {
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.textContent.trim().toLowerCase().includes('workspace')) n.classList.add('active');
    });
  }
};

// ─── STATE ───
const pdfed = {
  pdfDoc: null, file: null,
  pages: [],        // {type:'pdf'|'blank'|'image', pageNum?, dataUrl, modified, edits:{filters?}, label}
  active: -1,
  zoom: 1.0,
  cropActive: false,
  cropBox: {x:40, y:40, w:200, h:200},
  cDrag: false, cResize: false, cDir: null,
  cStartMouse: {x:0,y:0}, cStartBox: null,
  insertAfterIdx: -1,
  insertType: 'blank',
  insertBgColor: '#ffffff',
  insertImgUrl: null,
  insertFormat: 'a4',
  insertOrientation: 'portrait',
  insertCustomW: 210,
  insertCustomH: 297,
  insertUnit: 'mm',
  snapGrid: true, // Canva-style grid-to-grid snapping for placed text/images
  autoCollapseTimer: null,
  leftManuallyToggled: false,
  rightManuallyToggled: false,
  // Pull-up/push-down (the flow arrows beside SARVARC Eye) stay hidden until
  // the person actually runs Refine Report at least once on this document —
  // they're a manual, one-page version of what Refine Report does, so they
  // shouldn't show up before that feature has been used.
  refineReportUsed: false,
};

// ─── Generic small IndexedDB key/value helper ───
// The Workspace document (rendered page images, placed text/images/tables,
// annotations) can easily run well past localStorage's ~5-10MB quota, so it
// lives in IndexedDB instead. Still entirely on-device — nothing here is ever
// uploaded anywhere, this just survives a refresh instead of only living in memory.
//
// Account-scoped: unlike localStorage (namespaced by the shim at the very
// top of <head>), IndexedDB databases are looked up by name directly, so
// the current signed-in id is baked into the database name itself. Without
// this, Sessions and the Assets Library — which both live here, and both
// mirror to Google Drive — stayed visible to the next person who signed in
// on the same browser, exactly like the old unscoped localStorage keys did.
function idbKvOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const dbName = 'sarvarcKV__' + (window.__sarvarcUid || 'guest');
    // v3 adds an 'assets' store (see Assets Library below) on top of the v2
    // 'sessions' store — bumping the version runs onupgradeneeded once, which
    // adds whatever's missing without touching anything already saved.
    const req = indexedDB.open(dbName, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Assets Library ─────────────────────────────────────────────────────
// A single, permanent local library of every image, logo, and signature the
// person has ever uploaded, so they never have to dig up the same file
// twice. Every upload point across the app (Insert Image, Add Logo, Add
// Signature) writes here automatically — nothing new for the person to do.
// Lives in IndexedDB (see idbKvOpen above) alongside sessions, and mirrors
// to the same opt-in Google Drive layer used for sessions (see GOOGLE DRIVE
// SYNC — ASSETS, further down) so it follows a signed-in account across PCs.
var _ka5d552_514b = 1;
function sarvarcAssetUid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function sarvarcAssetSave(type, dataUrl, name) {
  if (!dataUrl) return null;
  try {
    const db = await idbKvOpen();
    // Tagged with whoever is signed in right now, exactly like sessions
    // (see smSaveSession's ownerEmail) — without this, every asset lives in
    // one shared local IndexedDB store with no account boundary at all, so
    // signing out and having a different person sign in on the same browser
    // would show them everything the previous account ever uploaded.
    const ownerEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
    const rec = {
      id: sarvarcAssetUid('asset'),
      type, // 'image' | 'logo' | 'signature'
      name: name || (type.charAt(0).toUpperCase() + type.slice(1) + ' — ' + new Date().toLocaleDateString()),
      dataUrl,
      createdAt: Date.now(),
      checked: false, // currently only meaningful for signatures — behavior TBD
      ownerEmail: ownerEmail || null,
      driveFileId: null,
      folderId: null // unfiled by default — see sarvarcAssetMoveToFolder to assign a client folder
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    sarvarcAssetsRenderPanel();
    // Best-effort mirror to Drive — never blocks the local save, silently
    // no-ops if the person isn't signed in with Google / hasn't granted Drive.
    if (typeof sarvarcDriveSaveAsset === 'function') sarvarcDriveSaveAsset(rec).catch(() => {});
    return rec;
  } catch (e) { console.warn('[Assets] could not save', e); return null; }
}

// Same ownership rule as smCheckSessionAccess: an asset with no ownerEmail
// was created while signed out and is a local/guest asset — always visible.
// An asset WITH an ownerEmail is only visible while that exact account is
// the one currently signed in.
async function sarvarcAssetAccessOk(rec) {
  if (!rec || !rec.ownerEmail) return true;
  const current = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
  return !!(current && current.toLowerCase() === String(rec.ownerEmail).toLowerCase());
}

async function sarvarcAssetList(type) {
  try {
    const db = await idbKvOpen();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const currentEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
    const visible = all.filter(a => !a.ownerEmail ||
      (currentEmail && currentEmail.toLowerCase() === String(a.ownerEmail).toLowerCase()));
    return type ? visible.filter(a => a.type === type) : visible;
  } catch (e) { return []; }
}

// Raw fetch, deliberately WITHOUT the ownership filter above — used only by
// internal plumbing (Drive sync's "do we already have this one locally?"
// dedupe check) that needs to see every local record regardless of which
// account it's tagged to, not just what the current account is allowed to
// see. UI-facing lookups should keep going through sarvarcAssetGet below.
async function sarvarcAssetGetRaw(id) {
  try {
    const db = await idbKvOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

// Public-facing lookup: same as sarvarcAssetGetRaw but fails closed (returns
// null) if the record belongs to a different signed-in account than the one
// currently active — a "suspenders" backstop alongside the panel already
// only ever rendering ids the current account is allowed to see, in case
// something ever calls this with an id from elsewhere (stale tab, etc.).
async function sarvarcAssetGet(id) {
  const rec = await sarvarcAssetGetRaw(id);
  if (!(await sarvarcAssetAccessOk(rec))) return null;
  return rec;
}

async function sarvarcAssetPut(rec) {
  try {
    const db = await idbKvOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('[Assets] could not update', e); }
}

async function sarvarcAssetDelete(id) {
  try {
    const rec = await sarvarcAssetGet(id);
    const db = await idbKvOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    sarvarcAssetsRenderPanel();
    if (rec && rec.driveFileId && typeof sarvarcDriveDeleteAsset === 'function') {
      sarvarcDriveDeleteAsset(rec.driveFileId).catch(() => {});
    }
  } catch (e) { console.warn('[Assets] could not delete', e); }
}

// Checkbox is currently shown only on signature tiles — what it should
// actually control (default signature, bulk-select, per-item Drive sync…)
// is still being decided, so for now it just persists its own on/off state.
async function sarvarcAssetToggleChecked(id, checked) {
  const rec = await sarvarcAssetGet(id);
  if (!rec) return;
  rec.checked = checked;
  await sarvarcAssetPut(rec);
}

// ── SARVARC PROMPT/CONFIRM MODAL ────────────────────────────────────────
// Themed stand-in for window.prompt()/window.confirm(), used by the client
// folder flows just below (create, rename, delete) so the person never sees
// the browser's own unstyled "This page says" dialog. Resolves a Promise —
// the string typed in (or null if cancelled) for a prompt, true/false for a
// confirm — so every call site just does `const x = await sarvarcModalPrompt(...)`
// exactly like it would with window.prompt, no callback plumbing needed.
let sarvarcModalResolve = null;
let sarvarcModalIsPrompt = false;

function sarvarcModalOpen(opts) {
  return new Promise(resolve => {
    const overlay  = document.getElementById('sarvarcModalOverlay');
    const titleEl  = document.getElementById('sarvarcModalTitle');
    const msgEl    = document.getElementById('sarvarcModalMessage');
    const inputEl  = document.getElementById('sarvarcModalInput');
    const okBtn    = document.getElementById('sarvarcModalOkBtn');
    const cancelBtn = document.getElementById('sarvarcModalCancelBtn');
    if (!overlay || !titleEl || !msgEl || !inputEl || !okBtn || !cancelBtn) { resolve(opts.isPrompt ? null : false); return; }

    sarvarcModalResolve = resolve;
    sarvarcModalIsPrompt = !!opts.isPrompt;

    titleEl.textContent = opts.title || '';
    if (opts.message) { msgEl.textContent = opts.message; msgEl.style.display = 'block'; }
    else { msgEl.style.display = 'none'; }
    if (opts.isPrompt) {
      inputEl.style.display = 'block';
      inputEl.placeholder = opts.placeholder || '';
      inputEl.value = opts.defaultValue || '';
    } else {
      inputEl.style.display = 'none';
    }
    okBtn.textContent = opts.okText || 'OK';
    okBtn.classList.toggle('danger', !!opts.danger);
    cancelBtn.textContent = opts.cancelText || 'Cancel';

    overlay.classList.add('open');
    if (opts.isPrompt) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);

    const onKey = (e) => {
      if (e.key === 'Escape') sarvarcModalCancel();
      else if (e.key === 'Enter' && sarvarcModalIsPrompt) sarvarcModalOk();
    };
    overlay._sarvarcKeyHandler = onKey;
    document.addEventListener('keydown', onKey);
  });
}

function sarvarcModalClose() {
  const overlay = document.getElementById('sarvarcModalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    if (overlay._sarvarcKeyHandler) { document.removeEventListener('keydown', overlay._sarvarcKeyHandler); overlay._sarvarcKeyHandler = null; }
  }
  sarvarcModalResolve = null;
}

function sarvarcModalOk() {
  const inputEl = document.getElementById('sarvarcModalInput');
  const value = sarvarcModalIsPrompt ? (((inputEl && inputEl.value) || '').trim() || null) : true;
  const resolve = sarvarcModalResolve;
  sarvarcModalClose();
  if (resolve) resolve(value);
}

function sarvarcModalCancel() {
  const value = sarvarcModalIsPrompt ? null : false;
  const resolve = sarvarcModalResolve;
  sarvarcModalClose();
  if (resolve) resolve(value);
}

function sarvarcModalPrompt(title, placeholder, defaultValue) {
  return sarvarcModalOpen({ title, isPrompt: true, placeholder, defaultValue, okText: 'Create', cancelText: 'Cancel' });
}

function sarvarcModalConfirm(title, message, okText) {
  return sarvarcModalOpen({ title, message, isPrompt: false, okText: okText || 'Delete', cancelText: 'Cancel', danger: true });
}

// ── CLIENT FOLDERS ──────────────────────────────────────────────────────
// Lets a freelancer/agency juggling several clients (Prayag, Ajay, Vijay…)
// keep each client's logos/signatures/images visually separated inside the
// one shared Assets library, instead of scrolling past everyone else's
// files to find the right one. Folders themselves are lightweight metadata
// (id/name/owner) — small enough that localStorage is the right store for
// them, same as sarvarcTheme/sarvarcLastSection elsewhere in the app; the
// actual asset binary data stays in IndexedDB exactly as before. An asset
// is filed into a folder by adding one field (folderId) to its existing
// record via sarvarcAssetPut, so this needed no IndexedDB schema change at
// all — a record with an extra property is still a perfectly valid record.
const SARVARC_ASSET_FOLDERS_KEY = 'sarvarc_asset_folders_v1';

function sarvarcAssetFolderListRaw() {
  try { return JSON.parse(localStorage.getItem(SARVARC_ASSET_FOLDERS_KEY) || '[]'); }
  catch (e) { return []; }
}
function sarvarcAssetFolderSaveRaw(list) {
  try { localStorage.setItem(SARVARC_ASSET_FOLDERS_KEY, JSON.stringify(list)); } catch (e) {}
}

// Same ownership rule as assets themselves (sarvarcAssetAccessOk): a folder
// created while signed out has no ownerEmail and is always visible; one
// created while signed in only shows up again under that same account.
async function sarvarcAssetFolderList() {
  const all = sarvarcAssetFolderListRaw();
  const currentEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
  return all.filter(f => !f.ownerEmail || (currentEmail && currentEmail.toLowerCase() === String(f.ownerEmail).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function sarvarcAssetFolderCreate(name) {
  name = (name || '').trim();
  if (!name) return null;
  const ownerEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
  const all = sarvarcAssetFolderListRaw();
  // Reuse an existing folder with the same name (case-insensitive, same
  // owner scope) instead of creating a confusing duplicate "Prayag" chip.
  const dup = all.find(f => f.name.toLowerCase() === name.toLowerCase() && (f.ownerEmail || null) === (ownerEmail || null));
  if (dup) return dup;
  const folder = { id: sarvarcAssetUid('afolder'), name, createdAt: Date.now(), ownerEmail: ownerEmail || null };
  all.push(folder);
  sarvarcAssetFolderSaveRaw(all);
  return folder;
}

async function sarvarcAssetFolderRename(id, newName) {
  newName = (newName || '').trim();
  if (!newName) return;
  const all = sarvarcAssetFolderListRaw();
  const f = all.find(x => x.id === id);
  if (!f) return;
  f.name = newName;
  sarvarcAssetFolderSaveRaw(all);
  sarvarcAssetsRenderPanel();
}

// Deleting a folder never deletes the assets inside it — they just fall
// back to "All"/unfiled, exactly like removing a label rather than
// shredding the files underneath it.
async function sarvarcAssetFolderDelete(id) {
  const all = sarvarcAssetFolderListRaw().filter(f => f.id !== id);
  sarvarcAssetFolderSaveRaw(all);
  const items = await sarvarcAssetList();
  for (const a of items) {
    if (a.folderId === id) { a.folderId = null; await sarvarcAssetPut(a); }
  }
  if (sarvarcAssetsActiveFolder === id) sarvarcAssetsActiveFolder = null;
  sarvarcAssetsRenderPanel();
}

async function sarvarcAssetMoveToFolder(id, folderId) {
  const rec = await sarvarcAssetGet(id);
  if (!rec) return;
  rec.folderId = folderId || null;
  await sarvarcAssetPut(rec);
  sarvarcAssetsRenderPanel();
  if (typeof toast === 'function') {
    if (folderId) {
      const folders = await sarvarcAssetFolderList();
      const f = folders.find(x => x.id === folderId);
      toast(f ? `Moved to "${f.name}"` : 'Moved to folder', 'success');
    } else {
      toast('Removed from folder', 'info');
    }
  }
}

// Right-click menu opened FROM an asset tile — lets the person file that
// one asset into any existing client folder, spin up a brand-new folder on
// the spot, or clear its folder back to unfiled. Reuses the same
// pdfedOpenCtxMenu system the canvas's own right-click menus use (see the
// "PLACED IMAGE" menu), so this reads as one consistent app-wide pattern
// rather than a bolted-on second context-menu implementation.
async function sarvarcAssetContextMenu(e, id) {
  e.preventDefault(); e.stopPropagation();
  const rec = await sarvarcAssetGet(id);
  if (!rec) return;
  const folders = await sarvarcAssetFolderList();
  const items = [];
  items.push({ type: 'label', label: 'ADD TO CLIENT FOLDER' });
  if (!folders.length) {
    items.push({ id: 'noop', label: 'No client folders yet', disabled: true });
  } else {
    folders.forEach(f => {
      items.push({
        id: 'folder_' + f.id,
        label: f.name + (rec.folderId === f.id ? '  ✓' : ''),
        icon: 'folder',
        onClick: () => sarvarcAssetMoveToFolder(id, f.id)
      });
    });
  }
  items.push({ type: 'sep' });
  items.push({ id: 'newFolder', label: 'New client folder…', icon: 'plus', onClick: () => sarvarcAssetPromptNewFolder(id) });
  if (rec.folderId) {
    items.push({ type: 'sep' });
    items.push({ id: 'removeFolder', label: 'Remove from folder', icon: 'clear', danger: true, onClick: () => sarvarcAssetMoveToFolder(id, null) });
  }
  pdfedOpenCtxMenu(e.clientX, e.clientY, items);
}

// Right-click menu opened FROM a folder chip itself (in the row above the
// grid) — rename or delete the folder, independent of any one asset.
function sarvarcAssetFolderChipCtxMenu(e, folderId) {
  e.preventDefault(); e.stopPropagation();
  pdfedOpenCtxMenu(e.clientX, e.clientY, [
    { id: 'rename', label: 'Rename folder', icon: 'draw', onClick: () => sarvarcAssetFolderPromptRename(folderId) },
    { type: 'sep' },
    { id: 'delete', label: 'Delete folder', icon: 'trash', danger: true, onClick: () => sarvarcAssetFolderConfirmDelete(folderId) }
  ]);
}

function sarvarcAssetPromptNewFolder(assetIdToAssign) {
  sarvarcModalPrompt('New Client Folder', "Enter client's name", '').then(name => {
    if (!name) return;
    sarvarcAssetFolderCreate(name).then(folder => {
      if (folder && assetIdToAssign) sarvarcAssetMoveToFolder(assetIdToAssign, folder.id);
      else sarvarcAssetsRenderPanel();
    });
  });
}

async function sarvarcAssetFolderPromptRename(folderId) {
  const folders = await sarvarcAssetFolderList();
  const f = folders.find(x => x.id === folderId);
  const name = await sarvarcModalPrompt('Rename Client Folder', "Enter client's name", f ? f.name : '');
  if (!name) return;
  sarvarcAssetFolderRename(folderId, name);
}

async function sarvarcAssetFolderConfirmDelete(folderId) {
  const folders = await sarvarcAssetFolderList();
  const f = folders.find(x => x.id === folderId);
  const ok = await sarvarcModalConfirm('Delete Client Folder', `Delete "${f ? f.name : 'this folder'}"? Assets inside it are kept — they just move back to "All".`, 'Delete');
  if (!ok) return;
  sarvarcAssetFolderDelete(folderId);
}

// Which folder the grid is currently filtered to — null means "All"
// (every asset of the active type, regardless of folder).
let sarvarcAssetsActiveFolder = null;

function sarvarcAssetsSelectFolder(folderId) {
  sarvarcAssetsActiveFolder = folderId || null;
  sarvarcAssetsRenderPanel();
}

// Renders the "All" + per-client chip row above the grid. Rebuilt every
// time the panel renders so a folder created/renamed/deleted elsewhere is
// always reflected immediately.
async function sarvarcAssetFoldersRenderChips() {
  const row = document.getElementById('sarvarcAssetFoldersRow');
  if (!row) return;
  const folders = await sarvarcAssetFolderList();
  let html = `<div class="sarvarc-asset-folder-chip ${!sarvarcAssetsActiveFolder ? 'active' : ''}" onclick="sarvarcAssetsSelectFolder(null)">All</div>`;
  folders.forEach(f => {
    const active = sarvarcAssetsActiveFolder === f.id;
    const safeName = String(f.name || '').replace(/</g, '&lt;').replace(/'/g, '&#39;');
    html += `<div class="sarvarc-asset-folder-chip ${active ? 'active' : ''}" data-folder-id="${f.id}" onclick="sarvarcAssetsSelectFolder('${f.id}')" oncontextmenu="sarvarcAssetFolderChipCtxMenu(event,'${f.id}');return false;" title="${safeName} — right-click to rename or delete">${pdfedCtxIcon('folder')}${safeName}</div>`;
  });
  html += `<div class="sarvarc-asset-folder-chip sarvarc-asset-folder-add" onclick="sarvarcAssetPromptNewFolder(null)" title="Create a new client folder">${pdfedCtxIcon('plus')}New folder</div>`;
  row.innerHTML = html;
}

let sarvarcAssetsActiveTab = 'image';

function sarvarcAssetsShowTab(type) {
  sarvarcAssetsActiveTab = type;
  ['image', 'logo', 'signature'].forEach(t => {
    const btn = document.getElementById('sarvarcAssetsTab_' + t);
    if (btn) btn.classList.toggle('active', t === type);
  });
  sarvarcAssetsRenderPanel();
}

async function sarvarcAssetsRenderPanel() {
  const grid = document.getElementById('sarvarcAssetsGrid');
  if (!grid) return; // panel not open / not in this view
  sarvarcAssetFoldersRenderChips();
  let items = await sarvarcAssetList(sarvarcAssetsActiveTab);
  // Folder filter layers on top of the existing type filter — "All"
  // (sarvarcAssetsActiveFolder === null) still shows every asset of this
  // type regardless of which client it's filed under, exactly like before
  // folders existed at all.
  if (sarvarcAssetsActiveFolder) items = items.filter(a => a.folderId === sarvarcAssetsActiveFolder);
  if (!items.length) {
    const label = sarvarcAssetsActiveTab === 'image' ? 'images' : sarvarcAssetsActiveTab + 's';
    const folders = await sarvarcAssetFolderList();
    const activeFolderName = sarvarcAssetsActiveFolder ? (folders.find(f => f.id === sarvarcAssetsActiveFolder) || {}).name : null;
    grid.innerHTML = activeFolderName
      ? `<div style="grid-column:1/-1;text-align:center;padding:18px 8px;color:var(--text3);font-size:11px;line-height:1.6">
          No ${label} in "${activeFolderName}" yet<br>Right-click an asset under "All" and choose this folder
        </div>`
      : `<div style="grid-column:1/-1;text-align:center;padding:18px 8px;color:var(--text3);font-size:11px;line-height:1.6">
          No ${label} saved yet<br>They'll land here automatically the next time you upload one
        </div>`;
    return;
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  grid.innerHTML = items.map(a => `
    <div class="sarvarc-asset-tile" title="${(a.name || '').replace(/"/g, '&quot;')}" oncontextmenu="sarvarcAssetContextMenu(event,'${a.id}');return false;">
      ${a.type === 'signature' ? `<label class="sarvarc-asset-check" onclick="event.stopPropagation()" title="Checkbox — behavior coming soon">
        <input type="checkbox" ${a.checked ? 'checked' : ''} onchange="sarvarcAssetToggleChecked('${a.id}', this.checked)">
      </label>` : ''}
      <img src="${a.dataUrl}" alt="${(a.name || '').replace(/"/g, '&quot;')}" onclick="sarvarcAssetUse('${a.id}')">
      <button type="button" class="sarvarc-asset-del" title="Delete" onclick="event.stopPropagation(); sarvarcAssetDelete('${a.id}')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

// Reuses an asset from the library — routed to whichever placement pipeline
// already handles that asset type, so drag/resize/stamp/lock/export all work
// exactly the same as a fresh upload would.
async function sarvarcAssetUse(id) {
  const rec = await sarvarcAssetGet(id);
  if (!rec) return;
  if (rec.type === 'logo' && typeof mfGetCurrentForm === 'function') {
    const f = mfGetCurrentForm();
    if (f) {
      f.logoDataUrl = rec.dataUrl;
      if (f.watermarkOn == null) f.watermarkOn = true;
      if (f.watermarkOpacity == null) f.watermarkOpacity = 8;
      mfTouch(f);
      if (typeof mfRenderLogoThumb === 'function') mfRenderLogoThumb();
      if (typeof mfRenderWatermarkControls === 'function') mfRenderWatermarkControls();
      if (typeof mfRenderAccentSwatches === 'function') mfRenderAccentSwatches();
      if (typeof mfRenderPreview === 'function') mfRenderPreview();
      if (typeof toast === 'function') toast('Logo applied from Assets', 'success');
      return;
    }
  }
  if (rec.type === 'signature' && typeof pdfedActivateImgGhost === 'function') {
    // Tag the ghost 'signature' (see pdfedActivateImgGhost) so the placed
    // image on canvas keeps its identity — otherwise re-sending it to a
    // client folder later would fall back to Images instead of Signatures.
    pdfedActivateImgGhost(rec.dataUrl, 'signature');
    if (typeof toast === 'function') toast('Position your signature, then click Stamp to place it', 'info');
    return;
  }
  // Plain image: drop onto the open page, or open it as its own page.
  if (typeof pdfed !== 'undefined' && pdfed.active >= 0 && pdfed.pages[pdfed.active] && typeof pdfedActivateImgGhost === 'function') {
    pdfedActivateImgGhost(rec.dataUrl);
  } else if (typeof pdfedOpenImageAsPage === 'function') {
    pdfedOpenImageAsPage(rec.dataUrl, null);
  }
}

// ─── Saved Sessions manager ───────────────────────────────────────────────
// A "session" is a named, on-demand snapshot of everything this browser has
// already been silently autosaving per module (Workspace document, Data
// Arrangement tables, Make Forms, Diagrams & Graphs, plus preferences).
//
// Important, honest framing for anyone reading this code: there is no server
// here and no IP-based user tracking. All of this lives in the visitor's own
// browser via localStorage + IndexedDB, which is actually a more reliable and
// private way to keep "this person's work" attached to them than an IP
// address ever could be (IPs are shared, change constantly, and don't
// identify a browser/device at all). A session is just a labelled bundle of
// that same on-device storage, so someone can save a checkpoint on purpose
// and load it back later — and it's kept until they delete it themselves.

// Bumped whenever the shape of a session's {ls, idb} snapshot changes in a
// way that future load logic needs to know about. Older saved sessions
// (created before this field existed) come back from IndexedDB with
// schemaVersion === undefined, which smLoadSession treats as "legacy" —
// still loaded, just logged, so nothing silently breaks on the day the
// format actually does change.
const SM_SNAPSHOT_SCHEMA_VERSION = 1;

// Lets other tabs on the same origin know a session was saved/updated/
// deleted/loaded, so a second open tab doesn't keep working against data
// that's stale or has been wiped out from under it. BroadcastChannel never
// delivers messages back to the tab that sent them, so this is safe to fire
// unconditionally after every write. Falls back to doing nothing on
// browsers without BroadcastChannel — multi-tab notices are a nicety, not
// a hard requirement.
const smSessionChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('sarvarcSessions_v1') : null;
function smNotifyOtherTabs(kind, id) {
  if (!smSessionChannel) return;
  try { smSessionChannel.postMessage({ kind: kind, id: id, at: Date.now() }); } catch (e) {}
}
if (smSessionChannel) {
  smSessionChannel.onmessage = function (ev) {
    const kind = ev && ev.data && ev.data.kind;
    if (!kind) return;
    if (typeof toast === 'function') {
      const msg = kind === 'delete'
        ? 'A saved session was deleted in another tab.'
        : 'Your saved sessions changed in another tab.';
      toast(msg, 'info');
    }
    // Only the Saved Sessions list needs a live refresh here — we deliberately
    // do NOT auto-reload the whole page from a background tab, since that
    // would blow away anything the person is actively typing in this one.
    if (document.getElementById('smSessionList')) smRenderList();
  };
}

// Best-effort check of how close this origin is to its storage quota.
// Returns a warning string if it's worth surfacing to the user before a
// save, or null if there's nothing to say (either plenty of room, or the
// browser doesn't support the Storage API's estimate() call).
async function smStorageHeadroomWarning() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const est = await navigator.storage.estimate();
    if (!est || !est.quota) return null;
    const pct = est.usage / est.quota;
    if (pct >= 0.9) {
      return 'Browser storage is about ' + Math.round(pct * 100) + '% full. Saving may fail — consider deleting an old session first.';
    }
    return null;
  } catch (e) { return null; }
}

// ─── Session ↔ live-data linkage ────────────────────────────────────────
// Whenever a module's live data is loaded FROM a saved session, or a saved
// session is created FROM the current live data (Save Your Workflow), that
// module is considered "linked" to that exact session id. If that specific
// session is later deleted, the linked module's live data is cleared right
// along with it (the log and the data attached to it disappear together).
// A module keeps its link only until it's re-linked to a different session
// (loading/saving again) — deleting an old, no-longer-linked session never
// touches whatever the person is currently working on.
const SM_ACTIVE_LINK_KEY = 'sarvarcActiveSessionLinks_v1';

function smGetActiveLinks() {
  try { return JSON.parse(localStorage.getItem(SM_ACTIVE_LINK_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

function smSetActiveLinks(map) {
  try { localStorage.setItem(SM_ACTIVE_LINK_KEY, JSON.stringify(map)); }
  catch (e) { console.warn('[Sessions] could not persist active session links', e); }
}

// Marks the given modules as now linked to sessionId (called right after a
// successful load or save so live data knows which session it "belongs" to).
function smMarkModulesLinked(moduleKeys, sessionId) {
  if (!moduleKeys || !moduleKeys.length) return;
  const map = smGetActiveLinks();
  moduleKeys.forEach(function (mk) { map[mk] = sessionId; });
  smSetActiveLinks(map);
}

// If any modules are currently linked to sessionId, wipes their live
// ls/idb storage and un-links them. Returns true if anything was cleared,
// so the caller knows whether a page reload is needed to reflect it.
async function smClearModulesLinkedTo(sessionId) {
  const map = smGetActiveLinks();
  const toClear = Object.keys(map).filter(function (mk) { return map[mk] === sessionId; });
  if (!toClear.length) return false;

  let lsKeys = [], idbKeys = [];
  toClear.forEach(function (mk) {
    const s = SM_MODULE_STORAGE[mk];
    if (!s) return;
    if (s.ls) lsKeys = lsKeys.concat(s.ls);
    if (s.idb) idbKeys = idbKeys.concat(s.idb);
  });

  lsKeys.forEach(function (k) { localStorage.removeItem(k); });

  if (idbKeys.length) {
    const db = await idbKvOpen();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      idbKeys.forEach(function (k) { store.delete(k); });
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  toClear.forEach(function (mk) { delete map[mk]; });
  smSetActiveLinks(map);
  return true;
}

// Only the keys declared in SM_MODULE_STORAGE belong to a session snapshot.
// Scanning by prefix alone would also sweep up unrelated 'sarvarc*' keys that
// happen to share the prefix but aren't module data — e.g. sarvarcLastSection
// (which page was open) or sarvarcExportPrefs / sarvarcDaExportPrefs
// (remembered export format) — none of which any module's load path ever
// reads back. Keeping them out of every save/export keeps sessions smaller
// and keeps their content matching exactly what the module pills claim.
function smAllModuleLsKeys() {
  const out = [];
  Object.keys(SM_MODULE_STORAGE).forEach(function (mk) {
    const s = SM_MODULE_STORAGE[mk];
    if (s && s.ls) out.push.apply(out, s.ls);
  });
  return out;
}

function smCaptureLocalStorage() {
  const out = {};
  smAllModuleLsKeys().forEach(function (k) {
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  });
  return out;
}

function smCaptureIdbKv() {
  return idbKvOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const out = {};
      (keysReq.result || []).forEach((k, i) => { out[k] = (valsReq.result || [])[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function smDefaultName() {
  const d = new Date();
  return 'Session – ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ─── Session ownership / lock ───────────────────────────────────────────────
// Every session is now tagged with the email of whoever was signed in with
// Google at the moment it was first saved (ownerEmail). A session with no
// ownerEmail was created while signed out and was never mirrored to anyone's
// Drive — it stays a local/guest session and is never locked. A session that
// DOES have an ownerEmail can only be loaded, edited, exported, renamed, or
// deleted while that exact same email is the one currently signed in. This
// is what keeps a saved project from being opened/edited/downloaded by
// whoever happens to be sitting at this browser after the owner signs out.
async function smGetCurrentAuthEmail() {
  try {
    const { data: { user } } = await sarvarcSupabase.auth.getUser();
    return (user && user.email) || null;
  } catch (e) { return null; }
}

// Returns { ok: true } if the current session is usable, or
// { ok: false, ownerEmail, current } if it's locked to a different/no
// account. `current` (the email actually signed in right now, or null) lets
// smShowLockedMessage tell "not logged in" apart from "logged in as the
// wrong person" and word the message accordingly.
async function smCheckSessionAccess(rec) {
  if (!rec || !rec.ownerEmail) return { ok: true };
  const current = await smGetCurrentAuthEmail();
  if (current && current.toLowerCase() === String(rec.ownerEmail).toLowerCase()) return { ok: true };
  return { ok: false, ownerEmail: rec.ownerEmail, current: current || null };
}

// Shown any time a locked session is touched — whether the click came from
// a disabled row (belt) or straight through to a core function (suspenders,
// e.g. a stale second tab). Opens the sign-in modal directly so the person
// can act on the message immediately instead of hunting for the login button.
// `arg` is normally the `access` object from smCheckSessionAccess ({ ownerEmail,
// current }). The two disabled-row click handlers in the rendered list don't
// have that object handy — they only know the session's ownerEmail — so `arg`
// may also be passed as a plain ownerEmail string, in which case the current
// signed-in email (if any) is looked up here before wording the message.
async function smShowLockedMessage(arg) {
  let ownerEmail = null, current = null;
  if (arg && typeof arg === 'object') { ownerEmail = arg.ownerEmail || null; current = arg.current || null; }
  else if (typeof arg === 'string') { ownerEmail = arg; current = await smGetCurrentAuthEmail(); }

  let msg = 'This file is locked. Please log in with the email address you used to edit it.';
  if (current && ownerEmail) {
    msg = 'This file was not edited by you. It belongs to a different SARVARC account (' +
      smMaskEmail(ownerEmail) + ') and can\'t be opened or edited from this one.';
  }
  if (typeof toast === 'function') toast(msg, 'error'); else alert(msg);
  if (typeof sarvarcAuthOpenModal === 'function') sarvarcAuthOpenModal('login');
}

// Masks an email for display on a locked row without fully exposing it on a
// shared/public browser, e.g. "prayag@gmail.com" -> "pr***g@gmail.com".
function smMaskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s;
  const user = s.slice(0, at), domain = s.slice(at);
  if (user.length <= 3) return user[0] + '***' + domain;
  return user.slice(0, 2) + '***' + user.slice(-1) + domain;
}

// Which modules currently have data, using the exact same per-module
// `check` functions that already power the module pills further down in
// each row — keeps "what counts as present" defined in exactly one place.
function smPresentModules(snapshot) {
  return SM_MODULE_MANIFEST.filter(function (m) { return m.check(snapshot || {}).present; }).map(function (m) { return m.key; });
}

// Used only as a background behind a short label when a module has no real
// preview image available (Data Arrangement and Make Forms today — both
// are DOM-rendered rather than canvas-based, and that DOM only exists while
// their own section tab is the one currently open, so it can't reliably be
// captured at save time from a different tab).
const SM_MODULE_TILE_COLOR = {
  workspace: '#2f6fed', dataarrange: '#1f9d63', makeforms: '#8b5cf6',
  diagrams: '#e08a2c', extract: '#00b3c6', redact: '#e0473f'
};
const SM_MODULE_TILE_LABEL = {
  workspace: 'PDF', dataarrange: 'TABLE', makeforms: 'FORM',
  diagrams: 'CHART', extract: 'IMAGE', redact: 'REDACT'
};

// Synthesizes a small preview of a table straight from its real headers and
// rows — used for Data Arrangement, which renders into the DOM rather than
// a canvas, so there's nothing to screenshot from a tab that isn't
// currently open. Drawing it fresh from the actual data (not a generic
// icon) means the collage tile still shows real column names/values.
function smBuildTableTileCanvas(w, h, headers, rows) {
  const can = document.createElement('canvas');
  can.width = w; can.height = h;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const cols = Math.max(1, Math.min(headers.length || 1, 5));
  const headerH = Math.round(h * 0.16);
  const displayRows = rows.slice(0, 6);
  const rowH = Math.round((h - headerH) / Math.max(1, displayRows.length || 1));
  const colW = w / cols;

  ctx.fillStyle = SM_MODULE_TILE_COLOR.dataarrange;
  ctx.fillRect(0, 0, w, headerH);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 ' + Math.max(9, Math.round(headerH * 0.5)) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < cols; c++) {
    ctx.fillText(String(headers[c] == null ? '' : headers[c]).slice(0, 12), c * colW + 6, headerH / 2, colW - 10);
  }

  ctx.font = Math.max(8, Math.round(rowH * 0.42)) + 'px sans-serif';
  displayRows.forEach((row, r) => {
    const y = headerH + r * rowH;
    ctx.fillStyle = r % 2 === 0 ? '#f4f6f8' : '#ffffff';
    ctx.fillRect(0, y, w, rowH);
    ctx.fillStyle = '#333333';
    for (let c = 0; c < cols; c++) {
      const val = row && row[c];
      ctx.fillText(String(val == null ? '' : val).slice(0, 12), c * colW + 6, y + rowH / 2, colW - 10);
    }
  });

  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(c * colW, 0); ctx.lineTo(c * colW, h); ctx.stroke(); }
  return can.toDataURL('image/jpeg', 0.85);
}

// Same idea for Make Forms — draws the real form title plus one bar per
// field (labelled with that field's actual label), instead of a generic
// icon, from the form's stored JSON rather than its DOM preview.
function smBuildFormTileCanvas(w, h, title, fields) {
  const can = document.createElement('canvas');
  can.width = w; can.height = h;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = SM_MODULE_TILE_COLOR.makeforms;
  const titleH = Math.round(h * 0.16);
  ctx.fillRect(0, 0, w, titleH);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 ' + Math.max(10, Math.round(titleH * 0.42)) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(title || 'Form').slice(0, 30), 10, titleH / 2, w - 20);

  const pad = 12, gap = 8;
  const rows = fields.slice(0, 6);
  const rowH = Math.max(18, Math.round((h - titleH - pad * 2 - gap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length || 1)));
  ctx.font = Math.max(8, Math.round(rowH * 0.4)) + 'px sans-serif';
  rows.forEach((f, i) => {
    const y = titleH + pad + i * (rowH + gap);
    ctx.fillStyle = 'rgba(139,92,246,0.10)';
    ctx.fillRect(pad, y, w - pad * 2, rowH);
    ctx.strokeStyle = 'rgba(139,92,246,0.35)';
    ctx.strokeRect(pad, y, w - pad * 2, rowH);
    ctx.fillStyle = '#4c1d95';
    ctx.fillText(String((f && f.label) || 'Field ' + (i + 1)).slice(0, 26), pad + 8, y + rowH / 2, w - pad * 2 - 16);
  });
  if (fields.length > rows.length) {
    ctx.fillStyle = '#8b5cf6';
    ctx.font = '600 ' + Math.max(9, Math.round(rowH * 0.4)) + 'px sans-serif';
    ctx.fillText('+' + (fields.length - rows.length) + ' more fields', pad + 4, h - 12);
  }
  return can.toDataURL('image/jpeg', 0.85);
}

// Best-effort real preview image for one module, read straight from
// whatever's already live in memory for it — this is why it works
// regardless of which section tab happens to be open when the person hits
// save. Canvas-backed modules (PDF Editor pages, Diagrams' chart canvas,
// Redact's per-page canvases) keep their drawn bitmap even while their
// section is hidden, so those capture reliably. Data Arrangement and Make
// Forms build their live preview straight into the DOM instead, and that
// DOM is only laid out while their tab is active — so instead of risking a
// blank capture, those two are synthesized fresh from their real stored
// data (headers/rows, form title/fields) via the canvas builders above.
async function smModuleTileImage(key) {
  try {
    if (key === 'workspace' && typeof pdfed !== 'undefined' && pdfed.pages && pdfed.pages.length) {
      const idx = (typeof pdfed.active === 'number' && pdfed.pages[pdfed.active]) ? pdfed.active : 0;
      return await pdfedComposeThumb(pdfed.pages[idx], idx);
    }
    if (key === 'extract' && typeof state !== 'undefined' && state.extractedImages && state.extractedImages.length) {
      return state.extractedImages[0].dataUrl || null;
    }
    if (key === 'redact' && typeof rdxState !== 'undefined' && rdxState.docs && rdxState.docs.length) {
      const pg = rdxState.docs[0].pages && rdxState.docs[0].pages[0];
      if (pg && pg.canvas) return pg.canvas.toDataURL('image/jpeg', 0.8);
    }
    if (key === 'diagrams') {
      const cv = document.getElementById('dgCanvas');
      if (cv && cv.width && cv.height) return cv.toDataURL('image/jpeg', 0.8);
    }
    if (key === 'dataarrange' && typeof daState !== 'undefined' && daState.datasets && daState.datasets.length) {
      const ds = (daState.activeId && daState.datasets.find(d => d.id === daState.activeId)) || daState.datasets[0];
      if (ds && ds.headers && ds.headers.length) return smBuildTableTileCanvas(320, 240, ds.headers, ds.rows || []);
    }
    if (key === 'makeforms') {
      const parsed = smSafeParse(localStorage.getItem('sarvarcForms'));
      const forms = Array.isArray(parsed) ? parsed : [];
      if (forms.length && forms[0] && Array.isArray(forms[0].fields)) {
        return smBuildFormTileCanvas(320, 240, forms[0].title, forms[0].fields);
      }
    }
  } catch (e) { console.warn('[Sessions] tile capture skipped for', key, e); }
  return null;
}

// Draws one module's tile — its real preview image if smModuleTileImage
// found one, otherwise a flat colour rectangle with a short label — into
// (ctx) at (x, y, w, h). Images are cover-cropped so every tile fills its
// slot cleanly regardless of the source's own aspect ratio.
async function smDrawTile(ctx, key, x, y, w, h) {
  const url = await smModuleTileImage(key);
  if (url) {
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      const ir = img.naturalWidth / img.naturalHeight, tr = w / h;
      let sx, sy, sw, sh;
      if (ir > tr) { sh = img.naturalHeight; sw = sh * tr; sx = (img.naturalWidth - sw) / 2; sy = 0; }
      else { sw = img.naturalWidth; sh = sw / tr; sx = 0; sy = (img.naturalHeight - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      return;
    } catch (e) { /* image failed to decode — fall through to placeholder */ }
  }
  ctx.fillStyle = SM_MODULE_TILE_COLOR[key] || '#666';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 ' + Math.max(11, Math.round(h * 0.16)) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SM_MODULE_TILE_LABEL[key] || key, x + w / 2, y + h / 2);
}

// Builds the Saved Sessions list thumbnail for one session. A session with
// data in only one module gets a full-frame preview of that module; a
// session spanning several modules gets a collage, so the row shows
// everything that's actually in that checkpoint at a glance instead of
// just whichever module happened to be open when it was saved.
async function smComposeThumbnail(presentModules) {
  if (!presentModules.length) return null;
  const W = 320, H = 240;
  const can = document.createElement('canvas');
  can.width = W; can.height = H;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#e9edf2';
  ctx.fillRect(0, 0, W, H);

  const mods = presentModules.slice(0, 4);
  if (mods.length === 1) {
    await smDrawTile(ctx, mods[0], 0, 0, W, H);
  } else if (mods.length === 2) {
    await smDrawTile(ctx, mods[0], 0, 0, W / 2 - 1, H);
    await smDrawTile(ctx, mods[1], W / 2 + 1, 0, W / 2 - 1, H);
  } else if (mods.length === 3) {
    await smDrawTile(ctx, mods[0], 0, 0, W / 2 - 1, H);
    await smDrawTile(ctx, mods[1], W / 2 + 1, 0, W / 2 - 1, H / 2 - 1);
    await smDrawTile(ctx, mods[2], W / 2 + 1, H / 2 + 1, W / 2 - 1, H / 2 - 1);
  } else {
    await smDrawTile(ctx, mods[0], 0, 0, W / 2 - 1, H / 2 - 1);
    await smDrawTile(ctx, mods[1], W / 2 + 1, 0, W / 2 - 1, H / 2 - 1);
    await smDrawTile(ctx, mods[2], 0, H / 2 + 1, W / 2 - 1, H / 2 - 1);
    await smDrawTile(ctx, mods[3], W / 2 + 1, H / 2 + 1, W / 2 - 1, H / 2 - 1);
  }

  if (presentModules.length > 4) {
    const extra = presentModules.length - 4, bw = 34, bh = 20;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(W - bw - 6, H - bh - 6, bw, bh, 4); ctx.fill(); }
    else { ctx.fillRect(W - bw - 6, H - bh - 6, bw, bh); }
    ctx.fillStyle = '#fff';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + extra, W - bw / 2 - 6, H - bh / 2 - 6);
  }

  return can.toDataURL('image/jpeg', 0.78);
}

// RFC4122 v4 UUID — used wherever an id needs to satisfy a Postgres `uuid`
// column (e.g. team_projects.id below). Regular local-only session ids stay
// on the lighter 'sess_...' format since Supabase never sees those.
function sarvarcGenUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// `forcedId`, when passed, is used as-is instead of generating a
// 'sess_...' id — needed by sarvarcTeamProjectSave() below, which must hand
// this same id to Supabase's `team_projects.id` (a `uuid` column) and so
// needs a real UUID from the moment the session is first created, not a
// second id bolted on afterwards (that would leave two IndexedDB/Drive
// copies of the same save under two different ids).
async function smSaveSession(name, forcedId) {
  const [ls, idb, ownerEmail] = await Promise.all([smCaptureLocalStorage(), smCaptureIdbKv(), smGetCurrentAuthEmail()]);
  const snapshot = { ls, idb };
  const thumb = await smComposeThumbnail(smPresentModules(snapshot));
  let size = 0;
  try { size = JSON.stringify(snapshot).length; } catch (e) {}
  const rec = {
    id: forcedId || ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    name: (name || '').trim() || smDefaultName(),
    savedAt: Date.now(),
    size,
    schemaVersion: SM_SNAPSHOT_SCHEMA_VERSION,
    ownerEmail: ownerEmail || null,
    thumb: thumb || null,
    snapshot
  };
  const db = await idbKvOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  smNotifyOtherTabs('save', rec.id);
  // Best-effort mirror to Google Drive (see GOOGLE DRIVE SYNC block near the
  // auth code). Fire-and-forget: if this fails or the user isn't Drive-
  // connected, the local save above already succeeded and is unaffected.
  try {
    if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
      const driveFileId = await sarvarcDriveSaveSession(rec);
      rec.driveFileId = driveFileId;
      const db2 = await idbKvOpen();
      await new Promise((resolve) => {
        const tx = db2.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => resolve();
      });
    }
  } catch (e) {
    console.warn('[Sessions] Drive mirror save skipped', e);
    if (ownerEmail && typeof toast === 'function') {
      toast('Saved on this device. Couldn\u2019t sync to your account yet \u2014 it\u2019ll retry next time you sign in.', 'info');
    }
  }
  return rec;
}

// Re-captures current live storage into an EXISTING session record, keeping
// its id and name but refreshing savedAt/size/snapshot. Used by "Save Your
// Workflow" when every module is already linked to the same session, so
// re-saving updates that checkpoint in place instead of piling up a new,
// near-duplicate session every time the button is clicked. Returns null if
// the session no longer exists (e.g. it was deleted in another tab).
async function smUpdateSessionSnapshot(id) {
  const db = await idbKvOpen();
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!existing) return null;
  const access = await smCheckSessionAccess(existing);
  if (!access.ok) { smShowLockedMessage(access); return null; }

  const [ls, idb] = await Promise.all([smCaptureLocalStorage(), smCaptureIdbKv()]);
  const snapshot = { ls, idb };
  const presentModules = smPresentModules(snapshot);
  const thumb = await smComposeThumbnail(presentModules);
  let size = 0;
  try { size = JSON.stringify(snapshot).length; } catch (e) {}
  const rec = Object.assign({}, existing, {
    savedAt: Date.now(),
    size,
    schemaVersion: SM_SNAPSHOT_SCHEMA_VERSION,
    // Keep the previous thumbnail if this checkpoint had nothing in any
    // module to build a preview from, rather than blanking out a thumbnail
    // that was already there.
    thumb: thumb || existing.thumb || null,
    snapshot
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  smNotifyOtherTabs('update', id);
  // Best-effort mirror of the refreshed name/content to Drive (see GOOGLE
  // DRIVE SYNC block near the auth code). Without this, re-saving an
  // already-linked session via "Save Your Workflow" would only update the
  // local copy — the Drive copy would stay frozen at whatever it was when
  // the session was first created, including its original name. Fire-and-
  // forget — any failure leaves the local update above completely unaffected.
  try {
    if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
      const driveFileId = await sarvarcDriveSaveSession(rec);
      if (!rec.driveFileId) {
        rec.driveFileId = driveFileId;
        const db2 = await idbKvOpen();
        await new Promise((resolve2) => {
          const tx2 = db2.transaction('sessions', 'readwrite');
          tx2.objectStore('sessions').put(rec);
          tx2.oncomplete = resolve2;
          tx2.onerror = () => resolve2();
        });
      }
    }
  } catch (e) {
    console.warn('[Sessions] Drive mirror update skipped', e);
    if (existing.ownerEmail && typeof toast === 'function') {
      toast('Saved on this device. Couldn\u2019t sync to your account yet \u2014 it\u2019ll retry next time you sign in.', 'info');
    }
  }
  return rec;
}

// Fetches a single session record (used to check "does this still exist"
// before deciding to update vs. create-new, and for export).
async function smGetSession(id) {
  const db = await idbKvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function smListSessions() {
  const db = await idbKvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.savedAt - a.savedAt));
    req.onerror = () => reject(req.error);
  });
}

async function smRenameSession(id, newName) {
  const db = await idbKvOpen();
  const existingRec = await new Promise((resolve) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  const access = await smCheckSessionAccess(existingRec);
  if (!access.ok) { smShowLockedMessage(access); smRenderList(); return null; }
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const getReq = store.get(id);
    let updated = null;
    getReq.onsuccess = () => {
      const r = getReq.result;
      if (r) { r.name = newName.trim() || r.name; store.put(r); updated = r; }
    };
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
  });
  // Best-effort mirror of the new name to Drive (see GOOGLE DRIVE SYNC block
  // near the auth code). Without this, a rename made here never reaches the
  // Drive copy, so pulling this session down on another device restores the
  // OLD name. Fire-and-forget — any failure leaves the local rename above
  // (already saved) completely unaffected.
  if (rec) {
    try {
      if (typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
        const driveFileId = await sarvarcDriveSaveSession(rec);
        if (!rec.driveFileId) {
          rec.driveFileId = driveFileId;
          const db2 = await idbKvOpen();
          await new Promise((resolve2) => {
            const tx2 = db2.transaction('sessions', 'readwrite');
            tx2.objectStore('sessions').put(rec);
            tx2.oncomplete = resolve2;
            tx2.onerror = () => resolve2();
          });
        }
      }
    } catch (e) { console.warn('[Sessions] Drive mirror rename skipped', e); }
  }
  return rec;
}

async function smDeleteSession(id) {
  {
    const db0 = await idbKvOpen();
    const rec0 = await new Promise((resolve) => {
      const tx = db0.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    const access = await smCheckSessionAccess(rec0);
    if (!access.ok) { smShowLockedMessage(access); throw new Error('LOCKED'); }
  }
  // Clear whatever live module data is currently linked to this exact
  // session BEFORE removing the session record itself — i.e. whatever was
  // loaded from it, or saved as it, and hasn't since been re-linked to a
  // different session. Doing this first (and aborting if it throws) avoids
  // a half-finished delete where the session record is gone but the active-
  // link map still points at an id that no longer exists anywhere, which
  // would leave that live data permanently "linked" to nothing.
  let clearedLiveData = false;
  try {
    clearedLiveData = await smClearModulesLinkedTo(id);
  } catch (e) {
    console.warn('[Sessions] could not clear linked live data — aborting delete so nothing is left inconsistent', e);
    throw e;
  }

  const db = await idbKvOpen();
  const existingRec = await new Promise((resolve) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  // Best-effort: also remove the mirrored copy from Drive, if one exists.
  try {
    if (existingRec && existingRec.driveFileId && typeof sarvarcDriveAvailable === 'function' && await sarvarcDriveAvailable()) {
      await sarvarcDriveDeleteSession(existingRec.driveFileId);
    }
  } catch (e) { console.warn('[Sessions] Drive mirror delete skipped', e); }
  smNotifyOtherTabs('delete', id);
  // Returns true if any live data was cleared, so the caller knows a reload
  // is needed to reflect it.
  return clearedLiveData;
}

// moduleKeys: array of SM_MODULE_MANIFEST keys to restore (e.g. ['makeforms',
// 'diagrams']), taken straight from whichever pills were checked when Load
// was clicked. Only the ls/idb keys belonging to those modules are touched —
// everything else already in this browser (including other modules' current
// work) is left exactly as it was.
async function smLoadSession(id, moduleKeys, absentModuleKeys) {
  const db = await idbKvOpen();
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!rec) { if (typeof toast === 'function') toast('That session could not be found.', 'error'); return; }
  const access = await smCheckSessionAccess(rec);
  if (!access.ok) { smShowLockedMessage(access); return; }

  // Loading anything other than the currently-live team project (e.g. a
  // personal saved session) means we're leaving that live room — clear the
  // flags so the post-reload auto-reconnect doesn't rejoin a room this
  // load wasn't for. (sarvarcTeamProjectOpen sets these flags itself right
  // before calling this function, so that call is unaffected.)
  const liveSessionId = localStorage.getItem('sarvarcLiveCollabSessionId');
  if (liveSessionId && liveSessionId !== id) {
    localStorage.removeItem('sarvarcLiveCollabTeamProjectId');
    localStorage.removeItem('sarvarcLiveCollabTeamId');
    localStorage.removeItem('sarvarcLiveCollabSessionId');
  }

  if (rec.schemaVersion !== SM_SNAPSHOT_SCHEMA_VERSION) {
    // Not fatal — the {ls, idb} shape hasn't changed since this field was
    // introduced, so legacy (undefined) and current versions load the same
    // way today. This is here so that the day the snapshot format *does*
    // change, there's already a place to branch on rec.schemaVersion instead
    // of silently misreading old sessions.
    console.warn('[Sessions] loading a session saved with schemaVersion=' + rec.schemaVersion + ' (current is ' + SM_SNAPSHOT_SCHEMA_VERSION + ')');
  }

  const keys = (moduleKeys && moduleKeys.length) ? moduleKeys : Object.keys(SM_MODULE_STORAGE);
  let lsKeys = [], idbKeys = [];
  keys.forEach(function (mk) {
    const map = SM_MODULE_STORAGE[mk];
    if (!map) return;
    if (map.ls) lsKeys = lsKeys.concat(map.ls);
    if (map.idb) idbKeys = idbKeys.concat(map.idb);
  });

  // Modules that had NO data in this session at all (disabled pills, passed
  // in as absentModuleKeys) must be wiped too — not left as whatever a
  // previously-loaded session put there. This is different from a PRESENT
  // module the person manually unchecked (in `keys`'s complement), which is
  // intentionally left alone. Without this, reopening an older, sparser
  // session after a fuller one leaves the fuller session's modules "stuck"
  // on screen even though this session never had that data.
  const absentKeys = (absentModuleKeys && absentModuleKeys.length) ? absentModuleKeys : [];
  let absentLsKeys = [], absentIdbKeys = [];
  absentKeys.forEach(function (mk) {
    const map = SM_MODULE_STORAGE[mk];
    if (!map) return;
    if (map.ls) absentLsKeys = absentLsKeys.concat(map.ls);
    if (map.idb) absentIdbKeys = absentIdbKeys.concat(map.idb);
  });

  lsKeys.forEach(function (k) {
    localStorage.removeItem(k);
    if (rec.snapshot.ls && rec.snapshot.ls[k] !== undefined) localStorage.setItem(k, rec.snapshot.ls[k]);
  });
  absentLsKeys.forEach(function (k) { localStorage.removeItem(k); });

  if (idbKeys.length || absentIdbKeys.length) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      idbKeys.forEach(function (k) {
        store.delete(k);
        if (rec.snapshot.idb && rec.snapshot.idb[k] !== undefined) store.put(rec.snapshot.idb[k], k);
      });
      absentIdbKeys.forEach(function (k) { store.delete(k); });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // These modules' live data now matches this exact session — link them so
  // that if this session is deleted later, this live data goes with it.
  smMarkModulesLinked(keys, id);
  // Absent modules are now empty and don't belong to any session's data —
  // unlink them so deleting some other session later doesn't try to clear
  // them again under a stale link.
  if (absentKeys.length) {
    const map = smGetActiveLinks();
    absentKeys.forEach(function (mk) { delete map[mk]; });
    smSetActiveLinks(map);
  }
  smNotifyOtherTabs('load', id);

  if (typeof toast === 'function') toast('Loading "' + rec.name + '"…', 'success');
  // A reload is the safest way to bring the affected modules back in sync
  // with the restored storage — each of them already self-restores from
  // localStorage/IndexedDB on startup, so this reuses that exact same,
  // already-tested path instead of re-implementing per-module refresh logic.
  setTimeout(() => location.reload(), 500);
}

function smFormatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Export / Import ────────────────────────────────────────────────────
// Everything about Saved Sessions lives only in this one browser (see the
// framing comment at the top of this manager) — there is no account, no
// server, and no sync. That's good for privacy, but it also means clearing
// site data, switching browsers, or moving to a new device wipes every
// saved session with no way to get it back. Export/import gives people a
// real on-disk backup and a way to carry a session to another browser.
function smSanitizeFileNamePart(s) {
  return String(s || 'session').replace(/[^a-z0-9\-_ ]/gi, '').trim().slice(0, 60) || 'session';
}

async function smExportSession(id) {
  try {
    const rec = await smGetSession(id);
    if (!rec) { if (typeof toast === 'function') toast('That session could not be found.', 'error'); return; }
    const access = await smCheckSessionAccess(rec);
    if (!access.ok) { smShowLockedMessage(access); return; }
    const payload = {
      sarvarcSessionExport: true,
      exportedAt: Date.now(),
      schemaVersion: (typeof rec.schemaVersion === 'number') ? rec.schemaVersion : SM_SNAPSHOT_SCHEMA_VERSION,
      name: rec.name,
      savedAt: rec.savedAt,
      size: rec.size,
      snapshot: rec.snapshot
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sarvarcBrandFilename(smSanitizeFileNamePart(rec.name) + '.sarvarcsession.json');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    if (typeof toast === 'function') toast('Exported "' + rec.name + '".', 'success');
  } catch (e) {
    console.warn('[Sessions] export failed', e);
    if (typeof toast === 'function') toast('Could not export that session.', 'error');
  }
}

// Reads a .sarvarcsession.json file (from smExportSession, possibly from a
// different browser/device) and stores it as a brand-new session here —
// never overwrites an existing one, even if a same-named session exists,
// so a bad import can't silently clobber real data.
async function smImportSessionFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || !payload.snapshot || typeof payload.snapshot !== 'object') {
      throw new Error('Not a recognizable session export file.');
    }
    const rec = {
      id: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: (String(payload.name || '').trim() || smDefaultName()) + ' (imported)',
      savedAt: Date.now(),
      size: (function () { try { return JSON.stringify(payload.snapshot).length; } catch (e) { return payload.size || 0; } })(),
      schemaVersion: (typeof payload.schemaVersion === 'number') ? payload.schemaVersion : 0,
      snapshot: payload.snapshot
    };
    if (rec.schemaVersion !== SM_SNAPSHOT_SCHEMA_VERSION) {
      console.warn('[Sessions] importing a file with schemaVersion=' + rec.schemaVersion + ' (current is ' + SM_SNAPSHOT_SCHEMA_VERSION + ')');
    }
    const db = await idbKvOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    smNotifyOtherTabs('save', rec.id);
    if (typeof toast === 'function') toast('Imported "' + rec.name + '".', 'success');
    if (document.getElementById('smSessionList')) smRenderList();
  } catch (e) {
    console.warn('[Sessions] import failed', e);
    if (typeof toast === 'function') toast('Could not import that file — it may not be a valid session export.', 'error');
  }
}

function smOnImportFileChosen(input) {
  const file = input && input.files && input.files[0];
  if (file) smImportSessionFile(file);
  if (input) input.value = '';
}
window.smExportSession = smExportSession;
window.smOnImportFileChosen = smOnImportFileChosen;

// ─── Share as a .SW file ───────────────────────────────────────────────────
// A ".sw" (SARVARC Workspace) file is this session's entire snapshot packed
// into one small binary file with a recognizable header, instead of a
// pasteable text code. Still fully on-device — this is just a download +
// upload, exactly like Export/Import above, just under SARVARC's own
// extension and file "signature" so a .sw only ever opens back up in
// SARVARC itself (any other file dropped in with a .sw extension, or a
// renamed unrelated file, gets rejected instead of silently misread).

// 9-byte ASCII signature every .sw file must start with.
const SM_SW_MAGIC = 'SARVARCSW';
const SM_SW_FORMAT_VERSION = 1;

// Compress with gzip when the browser supports the Compression Streams API
// (all current Chrome/Edge/Firefox/Safari). Falls back to storing raw
// (uncompressed) JSON bytes on anything older — the file is just bigger.
async function smGzipCompress(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const enc = new TextEncoder().encode(str);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(enc);
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}
async function smGzipDecompress(bytes) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}

// Builds the raw bytes of a .sw file: magic signature, format version,
// a compression flag, then the (optionally gzipped) JSON payload — the
// same {name, savedAt, schemaVersion, snapshot} shape the .json export uses.
async function smBuildSWBytes(rec) {
  const payload = {
    sarvarcSessionExport: true,
    exportedAt: Date.now(),
    schemaVersion: (typeof rec.schemaVersion === 'number') ? rec.schemaVersion : SM_SNAPSHOT_SCHEMA_VERSION,
    // Carried through so a .sw shared for a TEAM project can be re-imported
    // under the SAME id the team knows it by (team_projects.id / the id
    // sarvarcTeamProjectOpen looks up with smGetSession(projectId)).
    // Without this, every .sw import minted a fresh random id, so the
    // Team modal could never recognize "you already have this one" no
    // matter how many times you imported the file — see smImportSWFile.
    id: rec.id,
    teamId: rec.teamId || null,
    teamName: rec.teamName || null,
    pushedByName: rec.pushedByName || null,
    name: rec.name,
    savedAt: rec.savedAt,
    size: rec.size,
    snapshot: rec.snapshot
  };
  const json = JSON.stringify(payload);
  let payloadBytes = null, compressed = false;
  try {
    const gz = await smGzipCompress(json);
    if (gz) { payloadBytes = gz; compressed = true; }
  } catch (e) { console.warn('[Sessions] gzip compression unavailable, saving .sw uncompressed', e); }
  if (!payloadBytes) { payloadBytes = new TextEncoder().encode(json); compressed = false; }

  const magicBytes = new TextEncoder().encode(SM_SW_MAGIC);
  const out = new Uint8Array(magicBytes.length + 2 + payloadBytes.length);
  out.set(magicBytes, 0);
  out[magicBytes.length] = SM_SW_FORMAT_VERSION;
  out[magicBytes.length + 1] = compressed ? 1 : 0;
  out.set(payloadBytes, magicBytes.length + 2);
  return out;
}

// Reverses smBuildSWBytes. Throws a friendly Error on anything that isn't a
// genuine, complete .sw file — wrong signature, truncated download, or a
// file that just happens to have a .sw extension but isn't one of ours.
async function smParseSWBytes(bytes) {
  const magicLen = SM_SW_MAGIC.length;
  if (!bytes || bytes.length < magicLen + 2) {
    throw new Error('This file is too small to be a valid SARVARC Workspace (.sw) file.');
  }
  const magic = new TextDecoder().decode(bytes.slice(0, magicLen));
  if (magic !== SM_SW_MAGIC) {
    throw new Error('This isn\'t a SARVARC Workspace (.sw) file — it may have been renamed or created by something else.');
  }
  const compressedFlag = bytes[magicLen + 1];
  const payloadBytes = bytes.slice(magicLen + 2);
  let json;
  try {
    json = compressedFlag === 1 ? await smGzipDecompress(payloadBytes) : new TextDecoder().decode(payloadBytes);
  } catch (e) {
    throw new Error('This .sw file looks corrupted or incomplete — try saving/sending it again.');
  }
  let payload;
  try { payload = JSON.parse(json); } catch (e) { throw new Error('This .sw file looks corrupted or incomplete — try saving/sending it again.'); }
  if (!payload || typeof payload !== 'object' || !payload.snapshot || typeof payload.snapshot !== 'object') {
    throw new Error('This .sw file did not contain a valid SARVARC project.');
  }
  return payload;
}

// Builds and downloads a .sw file for one saved session — the "Share"
// button on each session row.
async function smExportSW(id) {
  try {
    const rec = await smGetSession(id);
    if (!rec) { if (typeof toast === 'function') toast('That session could not be found.', 'error'); return; }
    const access = await smCheckSessionAccess(rec);
    if (!access.ok) { smShowLockedMessage(access); return; }
    const bytes = await smBuildSWBytes(rec);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sarvarcBrandFilename(smSanitizeFileNamePart(rec.name) + '.sw');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    if (typeof toast === 'function') toast('Saved "' + rec.name + '.sw" — send that file to the other PC.', 'success');
  } catch (e) {
    console.warn('[Sessions] .sw export failed', e);
    if (typeof toast === 'function') toast('Could not create a .sw file for this session.', 'error');
  }
}

// Reads a .sw file (from smExportSW, possibly from a different browser or
// PC) and stores it as a brand-new session here — never overwrites an
// existing one, exactly like importing a .json export does.
async function smImportSWFile(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const payload = await smParseSWBytes(new Uint8Array(buf));

    // If this .sw carries the id it was originally saved under (every file
    // exported after this fix does — see smBuildSWBytes), reuse that exact
    // id instead of minting a new random one, PROVIDED nothing already
    // occupies it locally. This is what lets a manually-shared TEAM project
    // land under the same id the team modal looks it up by
    // (sarvarcTeamProjectOpen / sarvarcTeamProjectsLoad's smGetSession(p.id)
    // check), so it correctly shows "Open" instead of endlessly asking the
    // team / offering "Sync & Open" again after you already have it.
    // Older .sw files with no `id` field, or a rare genuine collision, fall
    // back to the old behavior of a fresh random id.
    let id = null;
    if (payload.id && typeof payload.id === 'string') {
      const existing = (typeof smGetSession === 'function') ? await smGetSession(payload.id) : null;
      if (!existing) id = payload.id;
    }
    if (!id) id = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    const rec = {
      id,
      name: (String(payload.name || '').trim() || smDefaultName()) + ' (shared)',
      savedAt: Date.now(),
      size: (function () { try { return JSON.stringify(payload.snapshot).length; } catch (e) { return payload.size || 0; } })(),
      schemaVersion: (typeof payload.schemaVersion === 'number') ? payload.schemaVersion : 0,
      snapshot: payload.snapshot
    };
    // Re-attach team metadata (if this .sw came from a team project) so it
    // shows the same "shared" badge / "Last saved by ..." label a live
    // team-sync would have given it.
    if (payload.teamId) { rec.teamId = payload.teamId; rec.teamName = payload.teamName || null; rec.pushedByName = payload.pushedByName || null; }
    const db = await idbKvOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    smNotifyOtherTabs('save', rec.id);
    if (typeof toast === 'function') toast('Project received — saved as "' + rec.name + '" in your Saved Sessions.', 'success');
    if (document.getElementById('smSessionList')) smRenderList();
    if (payload.teamId && document.getElementById('sarvarcTeamProjectsList') && typeof sarvarcTeamProjectsLoad === 'function') {
      sarvarcTeamProjectsLoad(payload.teamId);
    }
  } catch (e) {
    console.warn('[Sessions] .sw import failed', e);
    if (typeof toast === 'function') toast(e && e.message ? e.message : 'Could not load that .sw file.', 'error');
  }
}

function smOnSWFileChosen(input) {
  const file = input && input.files && input.files[0];
  if (file) smImportSWFile(file);
  if (input) input.value = '';
}

window.smExportSW = smExportSW;
window.smOnSWFileChosen = smOnSWFileChosen;

// ─── Per-module content detection ───
// Looks inside a saved snapshot and reports, per module, whether that
// session actually has data for it — and how much — so the session list can
// show a real row breakdown (Workspace, Data Arrangement, Make Forms,
// Diagrams & Graphs, Extraction) instead of just a name and a date.
function smSafeParse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

const SM_MODULE_MANIFEST = [
  {
    key: 'workspace', label: 'Workspace (Editor)',
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    check: function (snap) {
      const d = snap.idb && snap.idb['workspaceDoc_v1'];
      const n = d && Array.isArray(d.pages) ? d.pages.length : 0;
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' page' : ' pages')) : 'no data' };
    }
  },
  {
    key: 'dataarrange', label: 'Data Arrangement',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    check: function (snap) {
      const parsed = smSafeParse(snap.ls && snap.ls['sarvarcDaState_v1']);
      const n = parsed && Array.isArray(parsed.datasets) ? parsed.datasets.length : 0;
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' table' : ' tables')) : 'no data' };
    }
  },
  {
    key: 'makeforms', label: 'Make Forms',
    icon: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
    check: function (snap) {
      const parsed = smSafeParse(snap.ls && snap.ls['sarvarcForms']);
      const n = Array.isArray(parsed) ? parsed.length : 0;
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' form' : ' forms')) : 'no data' };
    }
  },
  {
    key: 'diagrams', label: 'Diagrams & Graphs',
    icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    check: function (snap) {
      const hist = smSafeParse(snap.ls && snap.ls['sarvarcDgHistory_v1']);
      const histN = Array.isArray(hist) ? hist.length : 0;
      const cur = smSafeParse(snap.ls && snap.ls['sarvarcDgState_v1']);
      const hasCurrent = !!(cur && Array.isArray(cur.rows) && cur.rows.length);
      const n = histN + (hasCurrent ? 1 : 0);
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' chart' : ' charts')) : 'no data' };
    }
  },
  {
    key: 'extract', label: 'Extraction',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    check: function (snap) {
      const d = snap.idb && snap.idb['sarvarcExtractState_v1'];
      const n = d && Array.isArray(d.images) ? d.images.length : 0;
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' image' : ' images')) : 'no data' };
    }
  },
  {
    key: 'redact', label: 'Redact PII',
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/>',
    check: function (snap) {
      const d = snap.idb && snap.idb['sarvarcRedactState_v1'];
      const n = d && Array.isArray(d.docs) ? d.docs.length : 0;
      return { present: n > 0, detail: n > 0 ? (n + (n === 1 ? ' document' : ' documents')) : 'no data' };
    }
  }
];

// Which underlying storage keys belong to each module — lets a "Load" click
// touch only the ls/idb keys for the modules that are actually checked,
// instead of wiping every sarvarc* key in the browser.
const SM_MODULE_STORAGE = {
  workspace:   { idb: ['workspaceDoc_v1'] },
  dataarrange: { ls:  ['sarvarcDaState_v1'] },
  makeforms:   { ls:  ['sarvarcForms'], idb: ['sarvarcFormsAttachments'] },
  diagrams:    { ls:  ['sarvarcDgHistory_v1', 'sarvarcDgState_v1', 'sarvarcDgFlowState_v1'] },
  extract:     { idb: ['sarvarcExtractState_v1'] },
  redact:      { idb: ['sarvarcRedactState_v1'] }
};

// One checkbox pill per module. Ticked by default when the module has data
// in this session; greyed out and unclickable when it doesn't. The tick
// state read straight off these inputs at "Load Selected" time — no
// separate JS state to keep in sync.
function smModuleChecksHtml(sessionId, snapshot) {
  return SM_MODULE_MANIFEST.map(function (m) {
    const r = m.check(snapshot || {});
    const cls = 'sm-mod-check ' + (r.present ? 'has-data checked' : 'empty');
    const shortLabel = m.label.replace(' (Editor)', '');
    return '<label class="' + cls + '" title="' + m.label + ': ' + r.detail + '">' +
      '<input type="checkbox" class="sm-mod-input" data-mod="' + m.key + '" ' +
        (r.present ? 'checked' : 'disabled') +
        ' onchange="smOnModuleCheckChange(this)">' +
      '<span class="chk-box"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
      '<span>' + shortLabel + '</span>' +
      '<span class="sm-mod-detail">' + r.detail + '</span>' +
    '</label>';
  }).join('');
}

// Keeps the pill's own "checked" class (used for its background colour) in
// sync with its checkbox — the checkbox itself is visually hidden.
function smOnModuleCheckChange(input) {
  input.closest('.sm-mod-check').classList.toggle('checked', input.checked);
  const row = input.closest('.sm-session-row');
  if (row) smUpdateLoadButton(row);
}

function smUpdateLoadButton(row) {
  const btn = row.querySelector('.sm-session-load-btn');
  if (!btn) return;
  const n = row.querySelectorAll('.sm-mod-input:checked').length;
  btn.disabled = n === 0;
  btn.querySelector('.sm-load-label').textContent = n === 0 ? 'Load' : (n === row.querySelectorAll('.sm-mod-input:not(:disabled)').length ? 'Load all' : 'Load ' + n);
}

async function smRenderList() {
  const listEl = document.getElementById('smSessionList');
  if (!listEl) return;
  let sessions = [];
  try { sessions = await smListSessions(); }
  catch (e) { console.warn('[Sessions] could not list sessions', e); }

  // Resolved once per render so every row checks against the same signed-in
  // state instead of racing separate auth calls per row.
  const currentEmail = await smGetCurrentAuthEmail();

  // Ownership filter: a session with no ownerEmail is a local/guest file and
  // always shows. A session WITH an ownerEmail only shows when the currently
  // signed-in email matches it — signed out, or signed in as someone else,
  // and it simply isn't in the list at all (not shown-but-locked). This is
  // what makes files "disappear" on logout and "reappear" on login: nothing
  // is deleted, the row is just filtered out of this render until the
  // signed-in email matches again. smCheckSessionAccess (called on save/
  // open/rename/delete) remains the backstop against any path that isn't
  // this list — e.g. a save already in flight when a logout happens.
  sessions = sessions.filter(s => !s.ownerEmail ||
    (currentEmail && currentEmail.toLowerCase() === String(s.ownerEmail).toLowerCase()));

  if (!sessions.length) {
    // A signed-in account may have sessions sitting on Drive that just
    // haven't finished pulling down yet (2-3s round trip) — show that
    // explicitly instead of "No saved sessions yet", so it reads as "still
    // checking" rather than "your files are gone".
    if (window.sarvarcDriveSyncPending) {
      listEl.innerHTML = '<div class="sm-session-empty">' +
        '<span class="sm-drive-sync-ring"></span>' +
        '<span class="sm-drive-sync-label">Loading Your Files</span>' +
      '</div>';
      return;
    }
    listEl.innerHTML = '<div class="sm-session-empty">' +
      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>' +
      'No saved sessions yet. Use the Save Your Workflow button in the top bar to create your first one.' +
    '</div>';
    return;
  }
  const countLabel = sessions.length === 1 ? '1 saved session' : sessions.length + ' saved sessions';
  listEl.innerHTML = '<div class="sm-session-count">' + countLabel + '</div>' + sessions.map(s => {
    const dt = new Date(s.savedAt);
    const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const safeName = String(s.name).replace(/"/g, '&quot;');
    const searchName = String(s.name).toLowerCase().replace(/"/g, '&quot;');
    const isLocked = !!(s.ownerEmail && (!currentEmail || currentEmail.toLowerCase() !== String(s.ownerEmail).toLowerCase()));

    const lockBadge = isLocked
      ? '<span class="sm-lock-badge" title="Locked to ' + smMaskEmail(s.ownerEmail).replace(/"/g, '&quot;') + '">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
          'Locked' +
        '</span>'
      : '';
    // Team Projects: pushed to/from a team, synced to this device's own
    // Drive (see sarvarcTeamProjectSave / sarvarcTeamHandleProjectPush) —
    // shown with a small badge so they're distinguishable from purely
    // personal sessions at a glance, even in the "All" view.
    const teamBadge = s.teamId
      ? '<span class="sm-team-badge" title="' + (s.pushedByName ? ('Shared by ' + String(s.pushedByName).replace(/"/g, '&quot;')) : 'Shared with your team') + '">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
          (String(s.teamName || 'Team').replace(/</g, '&lt;')) +
        '</span>'
      : '';

    const actionsHtml = isLocked
      ? '<div class="sm-session-actions">' +
          '<button class="sm-session-unlock-btn" onclick="smShowLockedMessage(\'' + String(s.ownerEmail).replace(/'/g, "\\'") + '\')">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
            '<span>Log in to unlock</span>' +
          '</button>' +
        '</div>'
      : '<div class="sm-session-actions">' +
          '<button class="sm-session-btn sm-session-load-btn" onclick="smOnLoadClick(\'' + s.id + '\', \'' + safeName + '\')">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
            '<span class="sm-load-label">Load all</span>' +
          '</button>' +
          '<button class="sm-session-btn icon-only" title="Save this project as a .sw file to share with another PC" onclick="smExportSW(\'' + s.id + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg></button>' +
          '<button class="sm-session-btn icon-only" title="Export session to a file (for backup or another browser)" onclick="smExportSession(\'' + s.id + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>' +
          '<button class="sm-session-btn danger icon-only" title="Delete session" onclick="smOnDeleteClick(\'' + s.id + '\', \'' + safeName + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</div>';

    const thumbInner = s.thumb
      ? '<img src="' + s.thumb + '" alt="" loading="lazy">'
      : (isLocked
          ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
          : '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>');
    const thumbColorStyle = s.thumb ? '' : ' style="color:var(--text3)"';

    return '<div class="sm-session-row' + (isLocked ? ' sm-session-locked' : '') + '" data-id="' + s.id + '" data-name="' + searchName + '" data-team="' + (s.teamId ? '1' : '0') + '">' +
        '<div class="sm-session-thumb"' + thumbColorStyle + '>' + thumbInner + '</div>' +
        (isLocked
          ? '<span class="sm-session-name" style="cursor:not-allowed" onclick="smShowLockedMessage(\'' + String(s.ownerEmail).replace(/'/g, "\\'") + '\')">' + safeName + '</span>'
          : '<input class="sm-session-name" value="' + safeName + '" onchange="smOnRenameInput(\'' + s.id + '\', this.value)" title="Click to rename">') +
        lockBadge + teamBadge +
        '<div class="sm-session-meta">' + dateStr + ', ' + timeStr + ' · ' + smFormatBytes(s.size) + '</div>' +
        '<div class="sm-session-divider"></div>' +
        '<div class="sm-mod-row">' + smModuleChecksHtml(s.id, s.snapshot) + '</div>' +
        actionsHtml +
    '</div>';
  }).join('');
  smApplyFilter();
}

// ─── Search / filter saved sessions by name ────────────────────────────────
let smSearchQuery = '';
function smFilterSessions(value) {
  smSearchQuery = (value || '').trim().toLowerCase();
  smApplyFilter();
}

// ─── All / Team Projects scope toggle ──────────────────────────────────────
// 'all' shows every saved session; 'team' narrows to just the ones pushed
// to/from a team (data-team="1" — see smRenderList's teamBadge). Purely a
// client-side view filter — doesn't change what's actually stored anywhere.
let smSessionsScope = 'all';
function smSetSessionsScope(scope) {
  smSessionsScope = scope;
  const allBtn = document.getElementById('smScopeAllBtn');
  const teamBtn = document.getElementById('smScopeTeamBtn');
  if (allBtn) allBtn.classList.toggle('active', scope === 'all');
  if (teamBtn) teamBtn.classList.toggle('active', scope === 'team');
  smApplyFilter();
}

function smApplyFilter() {
  const listEl = document.getElementById('smSessionList');
  if (!listEl) return;
  const rows = listEl.querySelectorAll('.sm-session-row');
  let visibleCount = 0;
  rows.forEach(function (row) {
    const searchMatch = !smSearchQuery || (row.dataset.name || '').indexOf(smSearchQuery) !== -1;
    const scopeMatch = smSessionsScope !== 'team' || row.dataset.team === '1';
    const match = searchMatch && scopeMatch;
    row.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  let noMatchEl = listEl.querySelector('.sm-session-no-match');
  if (rows.length && visibleCount === 0) {
    if (!noMatchEl) {
      noMatchEl = document.createElement('div');
      noMatchEl.className = 'sm-session-no-match';
      noMatchEl.style.cssText = 'padding:26px 16px;text-align:center;color:var(--text3);font-size:12.5px';
      listEl.appendChild(noMatchEl);
    }
    noMatchEl.textContent = smSearchQuery
      ? 'No saved sessions match "' + smSearchQuery + '".'
      : 'No Team Projects yet — push one from a team\'s "Save current work to team" button.';
  } else if (noMatchEl) {
    noMatchEl.remove();
  }
}
window.smSetSessionsScope = smSetSessionsScope;

// ─── Drive refresh — manual (drag/button) + automatic (polling) ───────────
// sarvarcDriveSyncDown() (defined later in the Google Drive Sync script)
// already runs once automatically right after sign-in. Everything here is
// extra chances to re-run that exact same pull, for the case a session was
// saved to Drive from another device/tab a few seconds (or minutes) after
// login and so wasn't there yet for that first automatic pass:
//   - smManualRefresh(): dragging down or tapping the refresh icon.
//   - smOnEnterSavedSessions(): one quiet check whenever this page opens,
//     plus starts a background poll while the person stays on it.
//   - the poll + the tab-visibility listener below keep checking every
//     little while so a delayed file can appear on its own, with no action
//     needed — the auto passes stay quiet unless they actually find
//     something new, so they never nag if there's nothing to report.
let smSessionsRefreshing = false;
let smSessionsPollTimer = null;
const SM_AUTO_POLL_MS = 20000; // how often to silently re-check while the page is open

function smCountSessionRows() {
  const listEl = document.getElementById('smSessionList');
  return listEl ? listEl.querySelectorAll('.sm-session-row').length : 0;
}

// Shared core for both the manual and automatic paths. silent=true skips
// the "Checking…"/"Up to date" chatter and only surfaces the strip when new
// sessions actually showed up — so background polling stays invisible
// unless there's real news.
async function smRunDriveRefresh(opts) {
  opts = opts || {};
  if (smSessionsRefreshing) return;
  smSessionsRefreshing = true;
  const btn = document.getElementById('smManualRefreshBtn');
  if (btn) { btn.classList.add('sm-refreshing'); if (!opts.silent) btn.disabled = true; }
  if (!opts.silent) smPtrSetState('refreshing');
  try {
    const available = (typeof sarvarcDriveAvailable === 'function') ? await sarvarcDriveAvailable() : false;
    if (!available) {
      if (!opts.silent) smPtrSetState('signedout');
      return;
    }
    const before = smCountSessionRows();
    // A manual trigger (drag/button, opts.silent falsy) forces a full Drive
    // listing rather than the delta cursor — a deliberate reconcile safety
    // net the person can always fall back on. Background/auto passes
    // (poll, tab-focus, opts.silent true) stay on the efficient delta path.
    if (typeof sarvarcDriveSyncDown === 'function') await sarvarcDriveSyncDown({ forceFull: !opts.silent });
    if (!opts.silent && typeof sarvarcShapesSyncDown === 'function') sarvarcShapesSyncDown();
    const gained = Math.max(0, smCountSessionRows() - before);
    if (gained > 0) {
      smPtrSetState('found', gained);
    } else if (!opts.silent) {
      smPtrSetState('done');
    }
  } catch (e) {
    console.warn('[Sessions] Drive refresh failed', e);
    if (!opts.silent) smPtrSetState('error');
  } finally {
    smSessionsRefreshing = false;
    if (btn) { btn.classList.remove('sm-refreshing'); btn.disabled = false; }
    setTimeout(smPtrCollapse, opts.silent ? 1600 : 1200);
  }
}

function smManualRefresh() {
  return smRunDriveRefresh({ silent: false });
}

// Called from navigate() every time the Saved Sessions page opens: one
// immediate quiet check (catches a file that landed while the person was
// elsewhere in the app), then a recurring quiet check every
// SM_AUTO_POLL_MS while they stay on this page. smStopAutoPoll() below
// clears it the moment they navigate away, so nothing polls in the
// background once the list isn't even visible.
function smOnEnterSavedSessions() {
  smRunDriveRefresh({ silent: true });
  smStopAutoPoll();
  smSessionsPollTimer = setInterval(function () {
    if (document.hidden) return; // tab not visible — wait for the visibility listener instead
    smRunDriveRefresh({ silent: true });
  }, SM_AUTO_POLL_MS);
}

function smStopAutoPoll() {
  if (smSessionsPollTimer) { clearInterval(smSessionsPollTimer); smSessionsPollTimer = null; }
}

// Coming back to a backgrounded tab is a common way a "late" Drive file
// finally gets noticed — re-check right away instead of waiting for the
// next poll tick.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    const sec = document.getElementById('sec-savedsessions');
    if (sec && sec.classList.contains('active')) smRunDriveRefresh({ silent: true });
  }
});

function smPtrSetState(state, count) {
  const ptr = document.getElementById('smPtr');
  const label = document.getElementById('smPtrLabel');
  if (!ptr || !label) return;
  ptr.classList.remove('sm-ptr-armed', 'sm-ptr-refreshing', 'sm-ptr-done');
  ptr.classList.add('sm-ptr-animate');
  if (state === 'refreshing') {
    ptr.style.setProperty('--sm-ptr-h', '40px');
    ptr.classList.add('sm-ptr-refreshing');
    label.textContent = 'Checking Drive…';
  } else if (state === 'found') {
    ptr.style.setProperty('--sm-ptr-h', '40px');
    ptr.classList.add('sm-ptr-done');
    label.textContent = count === 1 ? '1 file just arrived from Drive' : count + ' files just arrived from Drive';
  } else if (state === 'done') {
    ptr.style.setProperty('--sm-ptr-h', '40px');
    ptr.classList.add('sm-ptr-done');
    label.textContent = 'Up to date';
  } else if (state === 'signedout') {
    ptr.style.setProperty('--sm-ptr-h', '40px');
    ptr.classList.add('sm-ptr-done');
    label.textContent = 'Sign in with Google to sync';
  } else if (state === 'error') {
    ptr.style.setProperty('--sm-ptr-h', '40px');
    ptr.classList.add('sm-ptr-done');
    label.textContent = "Couldn't reach Drive — try again";
  }
}

function smPtrCollapse() {
  const ptr = document.getElementById('smPtr');
  if (!ptr) return;
  ptr.classList.add('sm-ptr-animate');
  ptr.classList.remove('sm-ptr-armed', 'sm-ptr-refreshing', 'sm-ptr-done');
  ptr.style.setProperty('--sm-ptr-h', '0px');
}

// ─── Always-on Drive connection status panel ───────────────────────────────
// window.sarvarcDriveStatus is the single source of truth: { state, lastSyncedAt }.
// sarvarcSetDriveStatus() (called from the Drive sync functions later in the
// file, plus from smUpdateDriveStatusUI() below) is the only writer; this
// section just renders whatever it's holding. lastSyncedAt is persisted to
// localStorage so "last synced 12m ago" survives a reload instead of
// resetting to "never" every time the page opens.
window.sarvarcDriveStatus = window.sarvarcDriveStatus || { state: 'checking', lastSyncedAt: null };
(function smInitDriveStatusFromStorage() {
  try {
    const raw = localStorage.getItem('sarvarcDriveLastSyncedAt');
    const ts = raw ? parseInt(raw, 10) : NaN;
    if (!isNaN(ts)) window.sarvarcDriveStatus.lastSyncedAt = ts;
  } catch (e) { /* localStorage unavailable — falls back to "never synced" this session */ }
})();

function sarvarcSetDriveStatus(state) {
  window.sarvarcDriveStatus.state = state;
  if (state === 'connected') {
    // 'connected' is only ever set right after a real pull actually
    // completed (see sarvarcDriveSyncDown/sarvarcDriveSyncDownHard) — so
    // this timestamp genuinely reflects "last time we checked Drive",
    // not just "last time we confirmed a token exists".
    window.sarvarcDriveStatus.lastSyncedAt = Date.now();
    try { localStorage.setItem('sarvarcDriveLastSyncedAt', String(window.sarvarcDriveStatus.lastSyncedAt)); } catch (e) {}
  }
  if (typeof smRenderDriveStatusPanel === 'function') smRenderDriveStatusPanel();
}

function smFormatRelativeTime(ms) {
  if (!ms) return null;
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.round(sec / 60);
  if (min < 60) return min + (min === 1 ? ' min ago' : ' min ago');
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
  const day = Math.round(hr / 24);
  return day + (day === 1 ? ' day ago' : ' days ago');
}

function smRenderDriveStatusPanel() {
  const panel = document.getElementById('smDriveStatusPanel');
  const text = document.getElementById('smDriveStatusText');
  const sub = document.getElementById('smDriveStatusSub');
  if (!panel || !text || !sub) return;
  const status = window.sarvarcDriveStatus || { state: 'checking', lastSyncedAt: null };
  panel.dataset.state = status.state;
  const labels = {
    checking: 'Checking connection…',
    syncing: 'Syncing with Drive…',
    connected: 'Connected to Drive',
    token_ok: 'Connected to Drive',
    offline: 'Offline',
    not_connected: 'Not connected',
    error: 'Sync error'
  };
  text.textContent = labels[status.state] || 'Checking connection…';
  const agoText = smFormatRelativeTime(status.lastSyncedAt);
  if (status.state === 'syncing') {
    sub.textContent = agoText ? 'Last synced ' + agoText : 'First sync in progress';
  } else if (status.state === 'offline') {
    sub.textContent = agoText ? 'Last synced ' + agoText + ' — will resume when back online' : 'Will sync once back online';
  } else if (status.state === 'not_connected') {
    sub.textContent = 'Sign in with Google to sync sessions across devices';
  } else if (status.state === 'error') {
    sub.textContent = (agoText ? 'Last synced ' + agoText + ' — ' : '') + 'retrying automatically';
  } else if (agoText) {
    sub.textContent = 'Last synced ' + agoText;
  } else {
    sub.textContent = status.state === 'checking' ? '—' : 'No sync yet';
  }
}

// A lightweight check (no data pull) — just "is there a usable Drive token
// right now" — used to paint the resting state on load, after sign-in/out,
// and when connectivity changes. The heavier, actual-data sync functions
// (sarvarcDriveSyncDown / sarvarcDriveSyncDownHard) set 'syncing'/'connected'/
// 'error' themselves around the real pull.
async function smUpdateDriveStatusUI() {
  if (!navigator.onLine) { sarvarcSetDriveStatus('offline'); return; }
  try {
    // 'token_ok', not 'connected' — this only confirms a usable token
    // exists, not that a sync round-trip actually happened. Reusing
    // 'connected' here used to stamp a fresh "last synced just now" purely
    // from a token check, which could read as a completed sync when none
    // had actually run yet.
    const available = (typeof sarvarcDriveAvailable === 'function') ? await sarvarcDriveAvailable() : false;
    sarvarcSetDriveStatus(available ? 'token_ok' : 'not_connected');
  } catch (e) { sarvarcSetDriveStatus('not_connected'); }
}

window.addEventListener('online', function () { smUpdateDriveStatusUI(); });
window.addEventListener('offline', function () { sarvarcSetDriveStatus('offline'); });

// Refreshes the "X ago" text on its own even when nothing new has synced,
// so "2 min ago" doesn't silently go stale into "2 hours ago" without the
// panel ever re-rendering.
setInterval(function () {
  if (typeof smRenderDriveStatusPanel === 'function') smRenderDriveStatusPanel();
}, 30000);

// Paint an initial state as soon as this script runs, then resolve the
// real one once auth/token state is known.
smRenderDriveStatusPanel();
smUpdateDriveStatusUI();

// Pointer-based drag ("pull to refresh"), scoped to the Saved Sessions page
// only, and only armed when the person starts dragging from the very top of
// the scrolled content (scrollTop <= 0) — so it never fights normal list
// scrolling, session-name renaming, or any other drag interaction on this
// page. Uses Pointer Events so mouse-drag and touch-drag both work the same
// way, matching the pointerdown/pointermove usage already elsewhere in
// this file.
(function smInitSessionsPullToRefresh() {
  const PTR_MAX = 90;      // px of visible drag before the pull maxes out
  const PTR_THRESHOLD = 62; // px of drag needed to arm a release-to-refresh

  let scrollEl = null;
  let dragging = false;
  let armed = false;
  let startY = 0;
  let ptr = null;

  function getScrollEl() {
    return document.querySelector('.main');
  }

  function sectionActive() {
    const sec = document.getElementById('sec-savedsessions');
    return !!(sec && sec.classList.contains('active'));
  }

  function onPointerDown(e) {
    if (!sectionActive() || smSessionsRefreshing) return;
    // Ignore drags starting on anything interactive (inputs, buttons,
    // rename fields, checkboxes) so the gesture never hijacks normal
    // clicks/edits on the session rows.
    if (e.target.closest('input, button, textarea, select, a, .sm-session-name')) return;
    scrollEl = getScrollEl();
    if (!scrollEl || scrollEl.scrollTop > 0) return;
    dragging = true;
    armed = false;
    startY = e.clientY;
    ptr = document.getElementById('smPtr');
    if (ptr) ptr.classList.remove('sm-ptr-animate');
  }

  function onPointerMove(e) {
    if (!dragging || !ptr) return;
    const dy = e.clientY - startY;
    if (dy <= 0) { ptr.style.setProperty('--sm-ptr-h', '0px'); armed = false; ptr.classList.remove('sm-ptr-armed'); return; }
    // Prevent the page from also scrolling while actively pulling.
    if (e.cancelable) e.preventDefault();
    const dampened = Math.min(PTR_MAX, dy * 0.55);
    ptr.style.setProperty('--sm-ptr-h', dampened + 'px');
    const shouldArm = dampened >= PTR_THRESHOLD * 0.55;
    if (shouldArm !== armed) {
      armed = shouldArm;
      ptr.classList.toggle('sm-ptr-armed', armed);
      const label = document.getElementById('smPtrLabel');
      if (label) label.textContent = armed ? 'Release to refresh' : 'Pull down to check Drive';
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if (armed) {
      smManualRefresh();
    } else {
      smPtrCollapse();
    }
    armed = false;
  }

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  document.addEventListener('pointercancel', onPointerUp, { passive: true });
})();

function smOnRenameInput(id, value) {
  smRenameSession(id, value).catch(e => console.warn('[Sessions] rename failed', e));
}

function smOnLoadClick(id, name) {
  const row = document.querySelector('.sm-session-row[data-id="' + id + '"]');
  const checked = row ? Array.from(row.querySelectorAll('.sm-mod-input:checked')).map(cb => cb.dataset.mod) : [];
  if (!checked.length) { if (typeof toast === 'function') toast('Select at least one item to load.', 'error'); return; }

  // Modules with a DISABLED checkbox had no data in this session at all — as
  // opposed to a present module the person manually unchecked, which should
  // stay untouched. Those disabled/absent ones must be cleared on load too,
  // otherwise leftover data from a previously-loaded session lingers even
  // though this session never had anything there (see smLoadSession).
  const absent = row ? Array.from(row.querySelectorAll('.sm-mod-input:disabled')).map(cb => cb.dataset.mod) : [];

  const totalAvailable = row ? row.querySelectorAll('.sm-mod-input:not(:disabled)').length : checked.length;
  const what = checked.length === totalAvailable
    ? 'everything'
    : checked.length + ' selected item' + (checked.length > 1 ? 's' : '');
  const absentNote = absent.length
    ? ' Modules with no data in this session (' + absent.length + ') will be cleared to match it.'
    : '';
  if (!confirm('Load ' + what + ' from "' + name + '"? This replaces the matching current work with what was saved in this session.' + absentNote)) return;
  smLoadSession(id, checked, absent);
}

async function smOnDeleteClick(id, name) {
  const isLinked = Object.values(smGetActiveLinks()).indexOf(id) !== -1;
  const warning = isLinked
    ? 'Delete "' + name + '"? This cannot be undone — and since your current work in at least one module was loaded from (or saved as) this session, that live data will be cleared too.'
    : 'Delete "' + name + '"? This cannot be undone.';
  if (!confirm(warning)) return;
  try {
    const clearedLiveData = await smDeleteSession(id);
    smRenderList();
    if (typeof toast === 'function') toast('Session deleted.', 'info');
    if (clearedLiveData) {
      // Modules read their data from localStorage/IndexedDB on startup, so
      // reload to bring their on-screen state back in sync with what was
      // just cleared — same approach smLoadSession already uses.
      setTimeout(() => location.reload(), 500);
    }
  }
  catch (e) {
    if (e && e.message === 'LOCKED') return; // smShowLockedMessage() already told the user
    console.warn('[Sessions] delete failed', e);
    if (typeof toast === 'function') toast('Could not delete "' + name + '" — nothing was removed. Try again.', 'error');
  }
}

// Opens the Saved Sessions page (a real section like every other module —
// not a popup) via the app's existing navigate() router.
function smOpenSessionsPage() {
  if (typeof navigate === 'function') navigate('savedsessions');
  smRenderList();
}

// Quick-save button used inside each module's own toolbar: jumps straight to
// the Saved Sessions page — saving itself now happens via the single "Save
// Your Workflow" button in the top bar, kept here only for any old callers.
function smQuickSave() {
  smOpenSessionsPage();
}

// ─── Single workspace-wide "Save Your Workflow" button (top nav) ──────────
// Captures everything — Workspace document, Extraction, Data Arrangement,
// Make Forms, Diagrams & Graphs, and Redact PII — into one named session in
// one click, no navigating away and no typing a name required. If the person
// is already on the Saved Sessions page, the list refreshes in place so
// the new entry shows up immediately.
async function smSaveWorkflow() {
  // Saving (locally to Saved Sessions, and to Google Drive) is one of the
  // two account-only features — no free tier. If the gate shows the signup
  // prompt, it also queues this exact call to fire automatically the
  // moment login succeeds, so nobody has to click Save twice.
  if (typeof sarvarcGateSave === 'function' && !(await sarvarcGateSave(smSaveWorkflow))) return;
  const btn = document.getElementById('saveWorkflowBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  }
  try {
    const headroomWarning = await smStorageHeadroomWarning();
    if (headroomWarning && typeof toast === 'function') toast(headroomWarning, 'error');

    // If every module is currently linked to the SAME existing session (the
    // normal case right after a prior "Save Your Workflow" or a full Load),
    // re-saving updates that session in place instead of creating a new,
    // near-duplicate one every click. Anything else — first-ever save, a
    // fresh project, or modules linked to different sessions — creates a
    // new session as before, since there's no single obvious one to update.
    const allModuleKeys = Object.keys(SM_MODULE_STORAGE);
    const links = smGetActiveLinks();
    const linkedIds = allModuleKeys.map(function (mk) { return links[mk]; });
    const candidateId = linkedIds[0];
    const allLinkedToSame = !!candidateId && linkedIds.every(function (lid) { return lid === candidateId; });

    let rec = null;
    let updated = false;
    if (allLinkedToSame) {
      rec = await smUpdateSessionSnapshot(candidateId);
      updated = !!rec;
    }
    if (!rec) {
      rec = await smSaveSession(smDefaultName());
    }

    // The live data across every module now matches this session exactly —
    // link them all, so if this session is later deleted, this live data is
    // understood to belong to it.
    smMarkModulesLinked(allModuleKeys, rec.id);
    if (typeof toast === 'function') {
      toast((updated ? 'Updated saved session "' : 'Workflow saved as "') + rec.name + '".', 'success');
    }
    if (document.getElementById('smSessionList')) smRenderList();
    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 1400);
    }
  } catch (e) {
    console.warn('[Sessions] workflow save failed', e);
    if (typeof toast === 'function') toast('Could not save your workflow — your browser storage may be unavailable or full.', 'error');
    if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
  }
}
window.smSaveWorkflow = smSaveWorkflow;

// ─── "New Project" button (top nav) ─────────────────────────────────────
// Clears the CURRENT live work across every module — Workspace document,
// Extraction, Data Arrangement, Make Forms, Diagrams & Graphs — so the
// person can start with a clean slate. Asks for confirmation first since
// this discards anything not already saved as a session. Saved Sessions
// themselves are never touched by this — it only resets what's currently
// on screen, the same live storage smClearModulesLinkedTo() already knows
// how to wipe.
// Shared low-level clear: wipes every module's localStorage + IndexedDB keys
// and drops the active-session links, with no confirm dialog and no button
// UI of its own. Used by smNewProject() (user-initiated, asks first) and by
// sarvarcAutoClearOwnedContent() (system-initiated on account switch, asks
// no one — see that function for why). Kept as one implementation so the
// two never drift on which keys/modules actually count as "current work."
async function smClearAllModuleStorageSilently() {
  const allModuleKeys = Object.keys(SM_MODULE_STORAGE);
  let lsKeys = [], idbKeys = [];
  allModuleKeys.forEach(function (mk) {
    const s = SM_MODULE_STORAGE[mk];
    if (!s) return;
    if (s.ls) lsKeys = lsKeys.concat(s.ls);
    if (s.idb) idbKeys = idbKeys.concat(s.idb);
  });

  lsKeys.forEach(function (k) { localStorage.removeItem(k); });

  if (idbKeys.length) {
    const db = await idbKvOpen();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      idbKeys.forEach(function (k) { store.delete(k); });
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  // None of these modules are linked to any saved session anymore — this
  // is a fresh, unsaved project.
  const map = smGetActiveLinks();
  allModuleKeys.forEach(function (mk) { delete map[mk]; });
  smSetActiveLinks(map);
}
window.smClearAllModuleStorageSilently = smClearAllModuleStorageSilently;

async function smNewProject() {
  const proceed = confirm(
    'Start a new project?\n\n' +
    'This clears your current work in every module — Workspace document, Extraction, Data Arrangement, Make Forms, Diagrams & Graphs, and Redact PII — in this browser.\n\n' +
    'Your saved sessions are not affected, but anything not already saved will be lost. Use "Save Your Workflow" first if you want to keep it.'
  );
  if (!proceed) return;

  const btn = document.getElementById('newProjectBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>Clearing…</span>';
  }

  try {
    await smClearAllModuleStorageSilently();
    if (typeof toast === 'function') toast('Started a new project.', 'success');
    setTimeout(() => location.reload(), 400);
  } catch (e) {
    console.warn('[New Project] could not clear current work', e);
    if (typeof toast === 'function') toast('Could not start a new project — your browser storage may be unavailable.', 'error');
    if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
  }
}
window.smNewProject = smNewProject;

window.smOpenSessionsPage = smOpenSessionsPage;
window.smQuickSave = smQuickSave;
window.smFilterSessions = smFilterSessions;
window.smOnRenameInput = smOnRenameInput;
window.smOnLoadClick = smOnLoadClick;
window.smOnDeleteClick = smOnDeleteClick;
async function idbKvSet(key, value) {
  const db = await idbKvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbKvGet(key) {
  const db = await idbKvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbKvDelete(key) {
  const db = await idbKvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Workspace document persistence (save + restore) ───
const PDFED_STORAGE_KEY = 'workspaceDoc_v1';
let pdfedPersistTimer = null;
let pdfedPersisting = false;
function pdfedPersist() {
  clearTimeout(pdfedPersistTimer);
  pdfedPersistTimer = setTimeout(async () => {
    if (pdfedPersisting) { pdfedPersist(); return; } // a save is already running — try again shortly
    pdfedPersisting = true;
    try {
      if (!pdfed.pages.length) {
        await idbKvDelete(PDFED_STORAGE_KEY);
        return;
      }
      // Bake any not-yet-rendered PDF pages into a raster now, so the saved
      // snapshot is fully self-contained and never needs the original file
      // (or a live pdf.js document) again to be shown after a reload.
      //
      // Also fully extract every page's real text blocks (font, color,
      // position — the same output "Edit Text" produces) while the live
      // PDF document is still around. Both the Style Specific Text preview
      // count AND "Apply across document" fall back to reading pdfed.pdfDoc
      // directly for any page nobody has opened in Edit Text yet, and that
      // PDF document object doesn't survive a reload. Without doing this
      // extraction now, those pages would show as searchable (once counted)
      // but silently fail to actually change when Apply runs, because the
      // extraction they need can no longer reach a live PDF. Baking real
      // blocks up front means every page is already in the same state as
      // an edited one, so nothing after a reload ever needs pdfed.pdfDoc.
      for (const pg of pdfed.pages) {
        try { await pdfedPageUrlBase(pg); } catch (e) { /* leave dataUrl as-is; restore just skips this page's image */ }
        if (pg.type === 'pdf' && (!pg.textBlocks || !pg.textBlocks.length)) {
          try {
            const blocks = await teFafExtractRealBlocks(pg);
            if (blocks.length) { pg.textBlocks = blocks; pg._teFafGeom = null; }
          } catch (e) { /* leave textBlocks unset; this page just won't be searchable/editable after reload */ }
        }
      }
      await idbKvSet(PDFED_STORAGE_KEY, {
        pages: pdfed.pages,
        active: pdfed.active,
        zoom: pdfed.zoom,
        fileName: pdfed.file ? pdfed.file.name : null,
        savedAt: Date.now()
      });
    } catch (e) {
      console.warn('[Workspace] could not persist document to IndexedDB', e);
    } finally {
      pdfedPersisting = false;
    }
  }, 500);
}

async function pdfedRestore() {
  let saved;
  try { saved = await idbKvGet(PDFED_STORAGE_KEY); }
  catch (e) { console.warn('[Workspace] could not read saved document', e); return; }
  if (!saved || !Array.isArray(saved.pages) || !saved.pages.length) return;
  try {
    pdfed.pdfDoc = null;
    pdfed.file = { name: saved.fileName || 'Untitled Document' };
    pdfed.pages = saved.pages;
    pdfed.active = -1;
    pdfed.zoom = saved.zoom || 1.0;

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
    const wrap = document.getElementById('pdfedCanvasWrap');
    if (wrap) wrap.style.display = 'inline-block';
    const tb = document.getElementById('pdfedToolbar');
    if (tb) tb.style.visibility = 'visible';

    await pdfedBuildStrip();
    const gotoIdx = Math.min(Math.max(saved.active, 0), pdfed.pages.length - 1);
    await pdfedGoto(gotoIdx);
    setTimeout(() => { if (typeof pdfedZoomFit === 'function') pdfedZoomFit(); }, 50);
    if (typeof toast === 'function') {
      toast('Restored your last document (' + pdfed.pages.length + ' page' + (pdfed.pages.length !== 1 ? 's' : '') + ')', 'info');
    }
  } catch (e) {
    console.warn('[Workspace] could not restore saved document', e);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { pdfedRestore(); });
} else {
  pdfedRestore();
}

// ─── Extraction module persistence (save + restore) ───
// Mirrors the Workspace document pattern above: extracted images (data URLs)
// can be large, so they live in IndexedDB rather than localStorage. On-device
// only, same as everything else — this just lets the extracted gallery
// survive a refresh/reopen and be captured in a Saved Session.
const EXTRACT_STORAGE_KEY = 'sarvarcExtractState_v1';
let extractPersistTimer = null;
function extractPersist() {
  clearTimeout(extractPersistTimer);
  extractPersistTimer = setTimeout(async () => {
    try {
      if (!state.extractedImages || !state.extractedImages.length) {
        await idbKvDelete(EXTRACT_STORAGE_KEY);
        return;
      }
      await idbKvSet(EXTRACT_STORAGE_KEY, {
        images: state.extractedImages,
        savedAt: Date.now()
      });
    } catch (e) { console.warn('[Extraction] could not persist gallery to IndexedDB', e); }
  }, 500);
}
async function extractRestore() {
  let saved;
  try { saved = await idbKvGet(EXTRACT_STORAGE_KEY); }
  catch (e) { console.warn('[Extraction] could not read saved gallery', e); return; }
  if (!saved || !Array.isArray(saved.images) || !saved.images.length) return;
  try {
    state.extractedImages = saved.images;
    state.stats.imgs += state.extractedImages.length;
    if (typeof updateStats === 'function') updateStats();
    const emptyEl = document.getElementById('emptyState');
    if (emptyEl) emptyEl.style.display = 'none';
    if (typeof renderGallery === 'function') renderGallery();
    const badge = document.getElementById('imgCountBadge');
    if (badge) { badge.style.display = 'inline-block'; badge.textContent = state.extractedImages.length; }
    if (typeof collapseUploadArea === 'function') collapseUploadArea();
    if (typeof refreshSidebarFolder === 'function') refreshSidebarFolder();
  } catch (e) {
    console.warn('[Extraction] could not restore gallery', e);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { extractRestore(); });
} else {
  extractRestore();
}

// ─── Redact PII persistence (save + restore) ───
// Same pattern again: the redaction batch queue (rdxState.docs) holds one
// live <canvas> per page, which — like the Workspace document and the
// Extraction gallery — is too big for localStorage and can't be structured-
// cloned into IndexedDB as-is. So each page is flattened to a PNG data URL
// on the way in and rebuilt into a real canvas on the way back out. This is
// what lets an in-progress redaction batch (uploads, OCR detections, applied
// masks, mask style, the audit log) survive a refresh/reopen, and be picked
// up by "Save Your Workflow" / Saved Sessions exactly like every other module.
const RDX_STORAGE_KEY = 'sarvarcRedactState_v1';
let rdxPersistTimer = null;
let rdxPersisting = false;

// { canvas, width, height, mmW, mmH } -> { dataUrl, width, height, mmW, mmH }
function rdxPageToStorable(pg) {
  return { dataUrl: pg.canvas.toDataURL('image/png'), width: pg.width, height: pg.height, mmW: pg.mmW, mmH: pg.mmH };
}

// { dataUrl, width, height, mmW, mmH } -> { canvas, width, height, mmW, mmH }
function rdxStorableToPage(sp) {
  return rdxLoadImageEl(sp.dataUrl).then(img => {
    const canvas = document.createElement('canvas');
    canvas.width = sp.width;
    canvas.height = sp.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { canvas, width: sp.width, height: sp.height, mmW: sp.mmW, mmH: sp.mmH };
  });
}

function rdxPersist() {
  if (typeof rdxHistory !== 'undefined') rdxHistory.checkpoint();
  clearTimeout(rdxPersistTimer);
  rdxPersistTimer = setTimeout(async () => {
    if (rdxPersisting) { rdxPersist(); return; } // a save is already running — try again shortly
    rdxPersisting = true;
    try {
      // Snapshot whatever's currently the active/working doc back into
      // rdxState.docs first, so the saved batch always matches what's on screen.
      if (typeof rdxCaptureActiveDoc === 'function') rdxCaptureActiveDoc();
      if (!rdxState.docs.length) {
        await idbKvDelete(RDX_STORAGE_KEY);
        return;
      }
      const docs = rdxState.docs.map(doc => ({
        fileName: doc.fileName,
        fileType: doc.fileType,
        pages: doc.pages.map(rdxPageToStorable),
        detections: doc.detections,
        currentPage: doc.currentPage,
        nextId: doc.nextId,
        scanned: doc.scanned,
        exportEnabled: doc.exportEnabled,
        docType: doc.docType || null,
        docTypeLabel: doc.docTypeLabel || null
      }));
      await idbKvSet(RDX_STORAGE_KEY, {
        docs,
        activeDoc: rdxState.activeDoc,
        maskStyle: rdxState.maskStyle,
        auditLog: rdxState.auditLog || [],
        savedAt: Date.now()
      });
    } catch (e) {
      console.warn('[Redact] could not persist batch to IndexedDB', e);
    } finally {
      rdxPersisting = false;
    }
  }, 500);
}

async function rdxRestore() {
  let saved;
  try { saved = await idbKvGet(RDX_STORAGE_KEY); }
  catch (e) { console.warn('[Redact] could not read saved batch', e); return; }
  if (!saved || !Array.isArray(saved.docs) || !saved.docs.length) return;
  try {
    const docs = await Promise.all(saved.docs.map(async d => ({
      fileName: d.fileName,
      fileType: d.fileType,
      pages: await Promise.all((d.pages || []).map(rdxStorableToPage)),
      detections: d.detections || [],
      currentPage: d.currentPage || 0,
      nextId: d.nextId || 1,
      scanned: !!d.scanned,
      exportEnabled: !!d.exportEnabled,
      docType: d.docType || null,
      docTypeLabel: d.docTypeLabel || null
    })));
    rdxState.docs = docs;
    rdxState.maskStyle = saved.maskStyle || 'black';
    rdxState.auditLog = saved.auditLog || [];
    const maskSel = document.getElementById('rdxMaskStyle');
    if (maskSel) maskSel.value = rdxState.maskStyle;
    const activeIdx = Math.min(Math.max(saved.activeDoc || 0, 0), docs.length - 1);
    rdxState.activeDoc = activeIdx;
    rdxApplyDocToWorking(docs[activeIdx]);
    rdxShowWorkspace();
    const nav = document.getElementById('rdxPageNav');
    if (nav) nav.style.display = rdxState.pages.length > 1 ? 'flex' : 'none';
    rdxRenderPage();
    rdxRenderThumbs();
    rdxRenderSidebarList();
    rdxRenderDocQueue();
    const exportBtn = document.getElementById('rdxExportBtn');
    if (exportBtn) exportBtn.disabled = !rdxState.exportEnabled;
    if (typeof toast === 'function') {
      toast('Restored your last redaction batch (' + docs.length + ' document' + (docs.length !== 1 ? 's' : '') + ')', 'info');
    }
  } catch (e) {
    console.warn('[Redact] could not restore saved batch', e);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { rdxRestore(); });
} else {
  rdxRestore();
}

// Raw canvas-px size of one grid cell used for grid-to-grid snapping/overlay.
const PDFED_GRID_SIZE = 20;

// Standard page sizes in mm (portrait orientation, w x h)
const PDFED_FORMAT_MM = {
  a4:     [210, 297],
  a3:     [297, 420],
  a5:     [148, 210],
  legal:  [215.9, 355.6],
};
