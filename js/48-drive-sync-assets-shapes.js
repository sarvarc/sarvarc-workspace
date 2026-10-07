  // ============== GOOGLE DRIVE SYNC — ASSETS (optional, opt-in, additive) ==
  // Same guarantees as the session sync above: purely a mirror on top of the
  // local IndexedDB 'assets' store, using the signed-in user's own OAuth
  // token, and any failure here is swallowed so the local Assets library
  // (images/logos/signatures in the right panel) always keeps working even
  // offline or logged out. Files live in their own "SARVARC Assets" folder
  // nested inside the same app folder sessions use.
  const SARVARC_ASSETS_FOLDER_NAME = 'SARVARC Assets';
  let sarvarcAssetsDriveFolderId = null;

  async function sarvarcDriveEnsureAssetsFolder() {
    if (sarvarcAssetsDriveFolderId) return sarvarcAssetsDriveFolderId;
    const parentId = await sarvarcDriveEnsureFolder();
    const q = encodeURIComponent(
      `name='${SARVARC_ASSETS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    );
    const listRes = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      sarvarcAssetsDriveFolderId = listData.files[0].id;
      return sarvarcAssetsDriveFolderId;
    }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_ASSETS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!createRes.ok) throw new Error('DRIVE_ASSETS_FOLDER_CREATE_' + createRes.status);
    const createData = await createRes.json();
    sarvarcAssetsDriveFolderId = createData.id;
    return sarvarcAssetsDriveFolderId;
  }

  function sarvarcDataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:(.*?);base64/) || [, 'image/png'])[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Create-or-update one asset (image/logo/signature) as an actual image
  // file in the app's Drive Assets folder — viewable in Drive itself, not
  // just JSON. rec.driveFileId (if already known) updates that same file
  // instead of duplicating it. On success, writes the returned driveFileId
  // back onto the local IndexedDB record so repeat saves stay in place.
  async function sarvarcDriveSaveAsset(rec) {
    const folderId = await sarvarcDriveEnsureAssetsFolder();
    const isUpdate = !!rec.driveFileId;
    const blob = sarvarcDataUrlToBlob(rec.dataUrl);
    const ext = ((blob.type.split('/')[1] || 'png').split('+')[0]) || 'png';
    const metadata = isUpdate
      ? { appProperties: { sarvarcAssetId: rec.id, sarvarcAssetType: rec.type, sarvarcAssetName: rec.name } }
      : { name: rec.id + '.' + ext, parents: [folderId],
          appProperties: { sarvarcAssetId: rec.id, sarvarcAssetType: rec.type, sarvarcAssetName: rec.name } };
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    const url = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${rec.driveFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) throw new Error('DRIVE_ASSET_SAVE_' + res.status);
    const data = await res.json();
    if (!isUpdate && typeof sarvarcAssetPut === 'function') {
      rec.driveFileId = data.id;
      sarvarcAssetPut(rec);
    }
    return data.id;
  }

  async function sarvarcDriveListAssets() {
    const folderId = await sarvarcDriveEnsureAssetsFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,appProperties,modifiedTime)&spaces=drive&pageSize=1000`);
    const data = await res.json();
    return (data.files || []).map(f => ({
      id: (f.appProperties && f.appProperties.sarvarcAssetId) || f.id,
      driveFileId: f.id,
      type: (f.appProperties && f.appProperties.sarvarcAssetType) || 'image',
      name: (f.appProperties && f.appProperties.sarvarcAssetName) || 'Untitled',
      savedAt: new Date(f.modifiedTime).getTime()
    }));
  }

  async function sarvarcDriveLoadAsset(driveFileId) {
    const res = await sarvarcDriveFetch(`files/${driveFileId}?alt=media`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function sarvarcDriveDeleteAsset(driveFileId) {
    await sarvarcDriveFetch(`files/${driveFileId}`, { method: 'DELETE' });
  }

  // Pulls down any Drive asset not already present locally (matched by id) —
  // this is what makes the Assets library "follow the login" the same way
  // Saved Sessions does. Local copies always win; nothing is overwritten.
  async function sarvarcAssetsSyncDown() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const driveAssets = await sarvarcDriveListAssets();
      const ownerEmail = (typeof smGetCurrentAuthEmail === 'function') ? await smGetCurrentAuthEmail() : null;
      let pulledAny = false;
      for (const da of driveAssets) {
        // Raw (un-gated) lookup for the dedupe check — this only asks "is
        // this id already in local storage at all", not "can the current
        // account see it", so it can't be tricked into re-pulling/duplicating
        // a record that's already there under a (theoretically impossible,
        // since ids are unique per creation) different owner.
        const existing = await sarvarcAssetGetRaw(da.id);
        if (existing) continue;
        try {
          const dataUrl = await sarvarcDriveLoadAsset(da.driveFileId);
          await sarvarcAssetPut({
            id: da.id, type: da.type, name: da.name, dataUrl,
            createdAt: da.savedAt, checked: false,
            // Tag with the account whose Drive folder this came from, so it
            // stays scoped to that account locally too — matching how a
            // pulled-down session gets its ownerEmail preserved from Drive.
            ownerEmail: ownerEmail || null,
            driveFileId: da.driveFileId
          });
          pulledAny = true;
        } catch (e) { console.warn('[Drive sync] could not pull asset', da.id, e); }
      }
      if (pulledAny && typeof sarvarcAssetsRenderPanel === 'function') sarvarcAssetsRenderPanel();
    } catch (e) { console.warn('[Drive sync] assets skipped', e); }
  }

  // Companion to sarvarcAssetsSyncDown: pushes up any locally-saved asset
  // that never made it to Drive (e.g. saved while offline or token expired).
  async function sarvarcAssetsSyncUp() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const local = await sarvarcAssetList();
      for (const rec of local) {
        if (rec.driveFileId) continue;
        try { await sarvarcDriveSaveAsset(rec); } catch (e) { /* best-effort, ignore */ }
      }
    } catch (e) { console.warn('[Drive sync] assets up skipped', e); }
  }

  // ============== GOOGLE DRIVE SYNC — MY SHAPES (optional, opt-in, additive) ==
  // Custom Image Reshaper shapes ("My Shapes") follow the signed-in account
  // exactly like the Assets library does: the local IndexedDB copy is the
  // source of truth and always works offline / logged out; this layer is a
  // best-effort MIRROR using the person's own OAuth token, so it can never
  // block or break a local save. Each shape is one tiny JSON file (its path
  // + editable points) in a "SARVARC Shapes" folder nested in the same app
  // folder the sessions and assets use. Local copies always win on sync, and
  // a deleted shape is tracked so it's removed from Drive too and never
  // re-appears on another device.
  const SARVARC_SHAPES_FOLDER_NAME = 'SARVARC Shapes';
  let sarvarcShapesDriveFolderId = null;

  async function sarvarcDriveEnsureShapesFolder() {
    if (sarvarcShapesDriveFolderId) return sarvarcShapesDriveFolderId;
    const parentId = await sarvarcDriveEnsureFolder();
    const q = encodeURIComponent(
      `name='${SARVARC_SHAPES_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    );
    const listRes = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      sarvarcShapesDriveFolderId = listData.files[0].id;
      return sarvarcShapesDriveFolderId;
    }
    const token = await sarvarcDriveGetToken();
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SARVARC_SHAPES_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!createRes.ok) throw new Error('DRIVE_SHAPES_FOLDER_CREATE_' + createRes.status);
    const createData = await createRes.json();
    sarvarcShapesDriveFolderId = createData.id;
    return sarvarcShapesDriveFolderId;
  }

  // Create-or-update one shape as a JSON file. rec.driveFileId (if known)
  // updates the same file instead of duplicating it.
  async function sarvarcDriveSaveShape(rec) {
    const folderId = await sarvarcDriveEnsureShapesFolder();
    const isUpdate = !!rec.driveFileId;
    const payload = { id: rec.id, name: rec.name, d: rec.d, nodes: rec.nodes || null, smooth: rec.smooth, createdAt: rec.createdAt, updatedAt: rec.updatedAt || null };
    const metadata = isUpdate
      ? { appProperties: { sarvarcShapeId: rec.id } }
      : { name: rec.id + '.json', parents: [folderId], appProperties: { sarvarcShapeId: rec.id } };
    const token = await sarvarcDriveGetToken();
    if (!token) throw new Error('NO_DRIVE_TOKEN');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const url = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${rec.driveFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) throw new Error('DRIVE_SHAPE_SAVE_' + res.status);
    const data = await res.json();
    if (!isUpdate) {
      rec.driveFileId = data.id;
      if (typeof rshMyShapesPersist === 'function') await rshMyShapesPersist();
    }
    return data.id;
  }

  async function sarvarcDriveListShapes() {
    const folderId = await sarvarcDriveEnsureShapesFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await sarvarcDriveFetch(`files?q=${q}&fields=files(id,appProperties,modifiedTime)&spaces=drive&pageSize=1000`);
    const data = await res.json();
    return (data.files || []).map(f => ({
      id: (f.appProperties && f.appProperties.sarvarcShapeId) || null,
      driveFileId: f.id
    })).filter(f => f.id);
  }

  async function sarvarcDriveLoadShape(driveFileId) {
    const res = await sarvarcDriveFetch(`files/${driveFileId}?alt=media`);
    return await res.json();
  }

  async function sarvarcDriveDeleteShape(driveFileId) {
    await sarvarcDriveFetch(`files/${driveFileId}`, { method: 'DELETE' });
  }

  // Pulls down any Drive shape not already on this device. Local copies win.
  async function sarvarcShapesSyncDown() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const remote = await sarvarcDriveListShapes();
      await rshMyShapesLoad(true);
      const dead = await rshTombLoad();
      let changed = false;
      for (const rf of remote) {
        if (dead.some(t => t.id === rf.id || (t.driveFileId && t.driveFileId === rf.driveFileId))) continue;
        const local = rshMyShapes.find(s => s.id === rf.id);
        if (local) {
          if (!local.driveFileId) { local.driveFileId = rf.driveFileId; changed = true; }
          continue;
        }
        try {
          const rec = await sarvarcDriveLoadShape(rf.driveFileId);
          if (!rec || !rshShapeIdOk(rec.id) || !rshShapePathOk(rec.d)) continue;
          rshMyShapes.push({
            id: rec.id, name: String(rec.name || 'My Shape').slice(0, 40), d: rec.d,
            nodes: Array.isArray(rec.nodes) ? rec.nodes : null,
            smooth: typeof rec.smooth === 'number' ? rec.smooth : 100,
            createdAt: rec.createdAt || Date.now(), driveFileId: rf.driveFileId
          });
          changed = true;
        } catch (e) { console.warn('[Drive sync] could not pull shape', rf.id, e); }
      }
      if (changed) {
        rshMyShapes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        await rshMyShapesPersist();
        const ov = document.getElementById('reshapeOverlay');
        if (ov && ov.classList.contains('open') && typeof renderReshapeGrid === 'function') renderReshapeGrid();
      }
    } catch (e) { console.warn('[Drive sync] shapes skipped', e); }
  }

  // Pushes up shapes that never reached Drive, and removes deleted ones.
  async function sarvarcShapesSyncUp() {
    try {
      if (!(await sarvarcDriveAvailable())) return;
      const tomb = await rshTombLoad();
      if (tomb.length) {
        const keep = [];
        for (const t of tomb) {
          if (!t.driveFileId) continue;
          try { await sarvarcDriveDeleteShape(t.driveFileId); }
          catch (e) { if (!/_404$/.test(String(e && e.message))) keep.push(t); }
        }
        await rshKvPut('myShapesDeleted', keep);
      }
      await rshMyShapesLoad(true);
      for (const rec of rshMyShapes) {
        if (rec.driveFileId) continue;
        try { await sarvarcDriveSaveShape(rec); } catch (e) { /* best-effort, ignore */ }
      }
    } catch (e) { console.warn('[Drive sync] shapes up skipped', e); }
  }

  let sarvarcAuthMode = 'login'; // 'login' | 'signup'
  let sarvarcAuthBusy = false;
