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

  // Social links ride along in the kit as kit.social = { instagram, linkedin, whatsapp, x, youtube }.
  // The kit's Website field (above) is used as the website icon, so it is not repeated here.
  var BK_SOCIAL = { stgBkInstagram: 'instagram', stgBkLinkedin: 'linkedin', stgBkWhatsapp: 'whatsapp', stgBkX: 'x', stgBkYoutube: 'youtube' };

  function bkRead() {
    try { return JSON.parse(localStorage.getItem(BK_KEY)) || {}; } catch (e) { return {}; }
  }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }

  // ── Social links: the bar folds into the platform icon once a link is entered ──
  function socItem(key) { return document.querySelector('#stgSoc .stg-soc-item[data-key="' + key + '"]'); }
  function socInput(key) { var it = socItem(key); return it ? it.querySelector('input') : null; }
  // "Use my Brand Kit in" checklist: tick boxes live in js/85 (bkUseGet / bkUseSet); this keeps them and the hint in step.
  window.stgUseSync = function () {
    if (typeof bkToggleRefresh === 'function') bkToggleRefresh();
    var k = bkRead();
    var has = !!(k.logo || k.company || k.tagline || k.address || k.phone || k.email || k.website || k.gst || (k.social && Object.keys(k.social).length));
    var box = $('stgUse'), hint = $('stgUseHint');
    if (box) box.classList.toggle('stg-use-off', !has);
    if (hint) hint.textContent = has ? 'Tick a module and it fills your Brand Kit in for you. Untick it to build for someone else.' : 'Save your Brand Kit first, then these switches turn on.';
  };
  window.stgSocSync = function () {
    document.querySelectorAll('#stgSoc .stg-soc-item').forEach(function (it) {
      var inp = it.querySelector('input'), v = inp ? inp.value.trim() : '';
      it.classList.remove('open');
      it.classList.toggle('set', !!v);
      var chip = it.querySelector('.stg-soc-chip');
      if (chip) chip.title = v ? (chip.getAttribute('aria-label') + ': ' + v + ' (click to edit)') : chip.getAttribute('aria-label');
    });
  };
  window.stgSocOpen = function (key) {
    var it = socItem(key), inp = socInput(key); if (!it || !inp) return;
    it.classList.add('open');
    inp.focus();                                  // right away, so fast typing is not lost
    setTimeout(function () { inp.focus(); inp.select(); }, 60);
  };
  window.stgSocDone = function (key) {
    var it = socItem(key), inp = socInput(key); if (!it || !inp) return;
    inp.value = inp.value.trim();
    it.classList.remove('open');
    it.classList.toggle('set', !!inp.value);
    var chip = it.querySelector('.stg-soc-chip');
    if (chip) chip.title = inp.value ? (chip.getAttribute('aria-label') + ': ' + inp.value + ' (click to edit)') : chip.getAttribute('aria-label');
  };
  window.stgSocKey = function (e, key) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.target.blur(); }
  };
  window.stgSocRemove = function (key) {
    var inp = socInput(key); if (!inp) return;
    inp.value = '';
    stgSocDone(key);
  };

  window.stgBkFill = function () {
    var kit = bkRead();
    Object.keys(BK_FIELDS).forEach(function (id) { var el = $(id); if (el) el.value = kit[BK_FIELDS[id]] || ''; });
    var soc = kit.social || {};
    Object.keys(BK_SOCIAL).forEach(function (id) { var el = $(id); if (el) el.value = soc[BK_SOCIAL[id]] || ''; });
    draftLogo = kit.logo || null;
    stgSocSync();
    stgUseSync();
    stgBkRender();
    var st = $('stgBkStatus');
    if (st) st.textContent = (kit.logo || kit.company || Object.keys(soc).length) ? 'Saved' : '';
    if (typeof bkSessionPanelRefresh === 'function') bkSessionPanelRefresh();
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
    var social = {};
    Object.keys(BK_SOCIAL).forEach(function (id) { var v = val(id); if (v) social[BK_SOCIAL[id]] = v; });
    kit.social = social;
    try { localStorage.setItem(BK_KEY, JSON.stringify(kit)); }
    catch (e) { if (typeof toast === 'function') toast('Could not save, the logo may be too large', 'error'); return; }
    var st = $('stgBkStatus'); if (st) st.textContent = 'Saved';
    stgUseSync();
    if (typeof bkSessionOnKitSaved === 'function') bkSessionOnKitSaved();
    else if (typeof toast === 'function') toast('Brand Kit saved', 'success');
  };

  window.stgBkClear = function () {
    try { localStorage.removeItem(BK_KEY); } catch (e) {}
    stgBkFill();
    if (typeof bkSessionOnKitSaved === 'function') bkSessionOnKitSaved();
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
