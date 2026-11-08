// ─── SETTINGS PAGE (sidebar > Info > Settings) ───
// Theme switch, account row, help links. The profile/password popup in the
// top bar menu is separate and still works (sarvarcSettingsOpenModal).
(function () {
  function $(id) { return document.getElementById(id); }

  function stgSyncTheme() {
    var dark = document.documentElement.dataset.theme === 'dark';
    var l = $('stgThemeLight'), d = $('stgThemeDark');
    if (l) l.classList.toggle('on', !dark);
    if (d) d.classList.toggle('on', dark);
  }

  // Uses the app's own toggleTheme() so logo, canvas and storage stay in step.
  window.stgSetTheme = function (mode) {
    var dark = document.documentElement.dataset.theme === 'dark';
    if ((mode === 'dark') !== dark && typeof toggleTheme === 'function') toggleTheme();
    stgSyncTheme();
  };

  function stgSyncAccount() {
    var t = $('stgAccTitle'), d = $('stgAccDesc'), a = $('stgAccActions');
    if (!t || !d || !a) return;
    var signedIn = !!window.__sarvarcSignedIn;
    if (signedIn) {
      var lbl = $('sarvarcAuthNavLabel');
      var name = (lbl && lbl.textContent || '').trim();
      t.textContent = name && name !== 'Log In' ? name : 'Logged in';
      d.textContent = 'Your Forms, Saved Sessions and Teams are available.';
      a.innerHTML =
        '<button type="button" class="stg-btn" onclick="sarvarcSettingsOpenModal()">Edit profile</button>' +
        '<button type="button" class="stg-btn" onclick="sarvarcAuthLogOut()">Log out</button>';
    } else {
      t.textContent = 'Not logged in';
      d.textContent = 'Log in to use Forms, Saved Sessions and Teams.';
      a.innerHTML = '<button type="button" class="stg-btn stg-btn-primary" onclick="sarvarcAuthNavClick()">Log in</button>';
    }
  }


  // ── Tabs ──
  window.stgTab = function (name) {
    var brand = name === 'brand';
    var g = $('stgPaneGeneral'), b = $('stgPaneBrand');
    if (g) g.style.display = brand ? 'none' : '';
    if (b) b.style.display = brand ? '' : 'none';
    var tg = $('stgTabGeneral'), tb = $('stgTabBrand');
    if (tg) tg.classList.toggle('on', !brand);
    if (tb) tb.classList.toggle('on', brand);
    if (brand) stgBkFill();
  };

  // Brand Kit: the one and only kit. Saved under sarvarc_brand_kit_v1 (bkLoad and bkSave in js/06 read it).
  var BK_KEY = 'sarvarc_brand_kit_v1';
  var draftLogo = null;
  var BK_FIELDS = { stgBkName: 'company', stgBkSlogan: 'tagline', stgBkAddress: 'address', stgBkPhone: 'phone', stgBkEmail: 'email', stgBkWeb: 'website', stgBkGst: 'gst' };

  function bkRead() {
    try { return JSON.parse(localStorage.getItem(BK_KEY)) || {}; } catch (e) { return {}; }
  }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }

  window.stgBkFill = function () {
    var kit = bkRead();
    Object.keys(BK_FIELDS).forEach(function (id) { var el = $(id); if (el) el.value = kit[BK_FIELDS[id]] || ''; });
    draftLogo = kit.logo || null;
    stgBkRender();
    var st = $('stgBkStatus');
    if (st) st.textContent = (kit.logo || kit.company) ? 'Saved' : '';
  };

  window.stgBkRender = function () {
    var img = $('stgBkLogoImg'), empty = $('stgBkLogoEmpty'), pv = $('stgPvLogo');
    if (img) { img.style.display = draftLogo ? '' : 'none'; if (draftLogo) img.src = draftLogo; }
    if (empty) empty.style.display = draftLogo ? 'none' : '';
    if (pv) { pv.style.display = draftLogo ? '' : 'none'; if (draftLogo) pv.src = draftLogo; }
    var n = $('stgPvName'), sl = $('stgPvSlogan'), f = $('stgPvFoot');
    if (n) n.textContent = val('stgBkName') || 'Your Business Name';
    if (sl) sl.textContent = val('stgBkSlogan') || 'Your slogan goes here';
    if (f) {
      var line2 = [val('stgBkPhone'), val('stgBkEmail'), val('stgBkWeb')].filter(Boolean).join('  |  ');
      var gst = val('stgBkGst') ? 'GST: ' + val('stgBkGst') : '';
      f.textContent = [val('stgBkAddress'), line2, gst].filter(Boolean).join('\n');
    }
  };

  // Shrinks big logos so the saved kit stays small.
  window.stgBkLogo = function (file) {
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      var im = new Image();
      im.onload = function () {
        var max = 600, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        draftLogo = c.toDataURL('image/png');
        stgBkRender();
      };
      im.onerror = function () { if (typeof toast === 'function') toast('Could not read that image', 'error'); };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  window.stgBkRemoveLogo = function () { draftLogo = null; stgBkRender(); };

  window.stgBkSave = function () {
    var kit = bkRead();
    Object.keys(BK_FIELDS).forEach(function (id) { kit[BK_FIELDS[id]] = val(id); });
    kit.logo = draftLogo;
    try { localStorage.setItem(BK_KEY, JSON.stringify(kit)); }
    catch (e) { if (typeof toast === 'function') toast('Could not save, the logo may be too large', 'error'); return; }
    var st = $('stgBkStatus'); if (st) st.textContent = 'Saved';
    if (typeof toast === 'function') toast('Brand Kit saved', 'success');
  };

  window.stgBkClear = function () {
    try { localStorage.removeItem(BK_KEY); } catch (e) {}
    stgBkFill();
    if (typeof toast === 'function') toast('Brand Kit cleared', 'info');
  };

  // Drag and drop a logo onto the square.
  var drop = $('stgBkDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) stgBkLogo(f); });
  }

  window.stgOnEnter = function () {
    stgSyncTheme(); stgSyncAccount();
    var b = $('stgPaneBrand'); if (b && b.style.display !== 'none') stgBkFill();
  };

  // Keep the page right when theme or login changes from somewhere else
  // (top bar toggle, login popup).
  new MutationObserver(stgSyncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  var lbl = $('sarvarcAuthNavLabel');
  if (lbl) new MutationObserver(stgSyncAccount).observe(lbl, { childList: true, characterData: true, subtree: true });
  stgSyncTheme();
  stgSyncAccount();
})();
