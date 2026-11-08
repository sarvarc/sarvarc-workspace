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

  window.stgOnEnter = function () { stgSyncTheme(); stgSyncAccount(); };

  // Keep the page right when theme or login changes from somewhere else
  // (top bar toggle, login popup).
  new MutationObserver(stgSyncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  var lbl = $('sarvarcAuthNavLabel');
  if (lbl) new MutationObserver(stgSyncAccount).observe(lbl, { childList: true, characterData: true, subtree: true });
  stgSyncTheme();
  stgSyncAccount();
})();
