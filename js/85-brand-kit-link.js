// BRAND KIT LINK (2026-11-08)
// Connects the Brand Kit (Settings > Brand Kit, stored under sarvarc_brand_kit_v1) to
//   - Workstyle: logo, plus contact details in empty contact slots
//   - Slide Templates: company, tagline, contact lines in quotation, invoice and proposal templates
// Each place has its own tick box ("Use my Brand Kit") so people who build documents for someone else
// can switch it off. The tick is remembered per place under sarvarc_brand_use_v1 and is ON by default.
(function () {
  'use strict';
  var KEY = 'sarvarc_brand_kit_v1';
  var USE_KEY = 'sarvarc_brand_use_v1';

  function kitRead() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function hasKit(k) { k = k || kitRead(); return !!(k.logo || k.company || k.tagline || k.address || k.phone || k.email || k.website || k.gst); }
  function prefs() { try { return JSON.parse(localStorage.getItem(USE_KEY)) || {}; } catch (e) { return {}; } }

  // scope: 'workstyle' | 'templates'. Default is ON.
  window.bkUseGet = function (scope) { return prefs()[scope] !== false; };
  window.bkUseSet = function (scope, on) {
    var p = prefs(); p[scope] = !!on;
    try { localStorage.setItem(USE_KEY, JSON.stringify(p)); } catch (e) {}
    bkToggleRefresh();
  };
  // true only when the person ticked it AND a kit exists
  window.bkActive = function (scope) { return window.bkUseGet(scope) && hasKit(); };

  window.bkOpenSettings = function () {
    try { if (typeof navigate === 'function') navigate('settings'); if (typeof stgTab === 'function') stgTab('brand'); } catch (e) {}
  };

  // Keeps every tick box (data-bk-scope="...") in step with the saved choice, and says so when no kit exists yet.
  window.bkToggleRefresh = function () {
    var kit = hasKit();
    Array.prototype.forEach.call(document.querySelectorAll('input[data-bk-scope]'), function (cb) {
      var scope = cb.getAttribute('data-bk-scope');
      cb.checked = window.bkUseGet(scope);
      cb.disabled = !kit;
      var row = cb.closest('.bk-use');
      if (row) {
        row.classList.toggle('bk-off', !kit);
        var hint = row.querySelector('.bk-use-hint');
        if (hint) hint.innerHTML = kit ? '' : 'Not set up yet. <a href="#" onclick="bkOpenSettings();return false">Open Settings, Brand Kit</a>';
      }
    });
  };
  window.bkToggleHtml = function (scope, label) {
    return '<label class="bk-use"><input type="checkbox" data-bk-scope="' + scope + '" onchange="bkUseSet(\'' + scope + '\',this.checked)">' +
      '<span class="bk-use-txt"><b>Use my Brand Kit</b><i>' + label + '</i><span class="bk-use-hint"></span></span></label>';
  };

  // ── WORKSTYLE ──────────────────────────────────────────────────────────────
  // Contact slots the AI left empty get the kit's contact details. Anything the person's own content already filled is left alone.
  window.bkWorkstyleFills = function (slots, fills) {
    if (!window.bkActive('workstyle')) return fills;
    var k = kitRead();
    var site = String(k.website || '').replace(/^\s*https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    var line1 = [k.phone, k.email, site].filter(Boolean).join(' · ');
    var addr = k.address || '';
    if (!line1 && !addr) return fills;
    var done = {};
    (fills || []).forEach(function (f) { if (f && f.id && ((f.text && String(f.text).trim()) || f.rows)) done[f.id] = 1; });
    var isContact = (typeof wsfIsContact === 'function') ? wsfIsContact : function () { return false; };
    var out = (fills || []).slice();
    (slots || []).forEach(function (s) {
      if (s.kind !== 'text' || done[s.id] || !isContact(s.sample || '')) return;
      var text = (s.lines >= 2 && addr) ? [line1, addr].filter(Boolean).join('\n') : [line1, addr].filter(Boolean).join(' · ');
      out = out.filter(function (f) { return f.id !== s.id; });
      out.push({ id: s.id, text: text });
    });
    return out;
  };

  // ── SLIDE TEMPLATES ────────────────────────────────────────────────────────
  // Rules: [slideIndex, textIndex, spec]. spec.lines is a list of lines, each a list of parts joined by " · ".
  // A part is dropped when a {field} inside it is empty. spec.keep = how many original lines stay on top.
  // spec.upper = capitals. spec.blank = remove the box when the kit has nothing for it (so a made-up number never stays).
  // Fields: company, tagline, address, phone, email, website, site (website without https://www.), gst.
  var C = { lines: [['{company}']] };
  var CU = { lines: [['{company}']], upper: 1 };
  var T = { lines: [['{tagline}']] };
  var TU = { lines: [['{tagline}']], upper: 1 };
  function one(f) { return { lines: [['{' + f + '}']], blank: 1 }; }
  var REAL_FOOT = [[0, 66, one('phone')], [0, 67, one('email')], [0, 68, one('site')], [0, 69, one('address')]];
  var RULES = {
    'quotation-elegant': [[0, 0, CU], [0, 1, TU],
      [0, 9, { lines: [['{company}'], ['{phone}', '{email}']] }],
      [0, 75, { lines: [['{company}', 'Authorised signatory']] }],
      [0, 77, { lines: [['{phone}', '{email}', '{site}', '{address}']], blank: 1 }]],
    'quotation-solar-technical': [[0, 0, C], [0, 1, TU], [0, 80, { lines: [['{company}', 'GST {gst}']] }],
      [1, 0, { lines: [['{company}', 'Quotation SQ-2026-0211']] }],
      [1, 90, { lines: [['For {company}', 'Authorised signatory']] }],
      [1, 92, { lines: [['{phone}', '{email}', '{address}']], blank: 1 }]],
    'quotation-solar-proposal': [[0, 2, { lines: [['{company}', 'GST {gst}']] }],
      [0, 41, { lines: [['{company}', '{address}', '{phone}', '{email}', '{site}']], blank: 1 }]],
    'quotation-outsourcing': [[0, 1, C], [0, 2, TU],
      [0, 10, { keep: 1, lines: [['{phone}', '{email}']] }],
      [0, 76, { lines: [['For {company}', 'Authorised signatory']] }],
      [0, 78, one('phone')], [0, 79, one('email')], [0, 80, one('site')], [0, 81, one('address')]],
    'quotation-real-estate': [[0, 1, CU], [0, 2, TU], [0, 10, { keep: 1, lines: [['{phone}', '{email}']] }]].concat(REAL_FOOT),
    'quotation-property-landscape': [[0, 3, C], [0, 10, { keep: 1, lines: [['{phone}', '{email}']] }],
      [0, 72, one('phone')], [0, 73, one('email')], [0, 74, one('site')], [0, 75, one('address')]],
    'quotation-property-noir': [[0, 3, CU], [0, 4, TU], [0, 19, { keep: 1, lines: [['{phone}'], ['{email}']] }],
      [0, 82, one('phone')], [0, 83, one('email')], [0, 84, one('site')], [0, 85, one('address')]],
    'invoice-agency-india': [[0, 0, { lines: [['{company}.']] }], [0, 1, T], [0, 9, C],
      [0, 10, { lines: [['{email}', '{phone}'], ['{address}'], ['GSTIN {gst}']] }], [0, 60, { lines: [['{site}']], upper: 1, blank: 1 }]],
    'invoice-agency-global': [[0, 0, { lines: [['{company}.']] }], [0, 1, T], [0, 9, C],
      [0, 10, { lines: [['{email}', '{phone}'], ['{address}'], ['Tax ID: {gst}']] }], [0, 60, { lines: [['{site}']], upper: 1, blank: 1 }]],
    'invoice-agency-calm': [[0, 1, C], [0, 2, T], [0, 10, C],
      [0, 11, { lines: [['{email}', '{phone}'], ['{address}'], ['Tax ID: {gst}']] }]]
  };
  // Proposal templates use a placeholder word instead of a sample name: replace it everywhere.
  var TOKENS = { 'proposal-vector': { '[Agency Name]': 'company' }, 'proposal-premium': { '[Agency Name]': 'company' } };

  window.bkTemplateHasMap = function (id) { return !!(RULES[id] || TOKENS[id]); };

  function fields(k) {
    var site = String(k.website || '').replace(/^\s*https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return { company: k.company || '', tagline: k.tagline || '', address: k.address || '', phone: k.phone || '', email: k.email || '', website: k.website || '', site: site, gst: k.gst || '' };
  }
  function fill(part, f) {
    var ok = true;
    var s = part.replace(/\{(\w+)\}/g, function (m, key) { if (!f[key]) ok = false; return f[key] || ''; });
    return ok ? s : '';
  }
  function build(spec, f, original) {
    var lines = spec.lines.map(function (parts) { return parts.map(function (p) { return fill(p, f); }).filter(Boolean).join(' · '); }).filter(Boolean);
    if (!lines.length) return null;
    var kept = spec.keep ? String(original || '').split('\n').slice(0, spec.keep) : [];
    var text = kept.concat(lines).join('\n');
    return spec.upper ? text.toUpperCase() : text;
  }

  // Returns the texts for one slide with the kit applied (a fresh array, the template data is never changed).
  window.bkApplyToSlide = function (tplId, slideIdx, texts) {
    if (!window.bkActive('templates') || !window.bkTemplateHasMap(tplId)) return texts;
    var f = fields(kitRead());
    var out = texts.map(function (x) { return x; });
    var drop = {};
    (RULES[tplId] || []).forEach(function (r) {
      if (r[0] !== slideIdx) return;
      var x = out[r[1]]; if (!x) return;
      var text = build(r[2], f, x.text);
      if (text == null) { if (r[2].blank) drop[r[1]] = 1; return; }
      out[r[1]] = Object.assign({}, x, { text: text, html: null });
    });
    var tok = TOKENS[tplId];
    if (tok) out = out.map(function (x) {
      var t = x.text, changed = false;
      Object.keys(tok).forEach(function (token) {
        var v = f[tok[token]];
        if (v && t.indexOf(token) !== -1) { t = t.split(token).join(v); changed = true; }
      });
      return changed ? Object.assign({}, x, { text: t, html: null }) : x;
    });
    return out.filter(function (x, i) { return !drop[i]; });
  };

  document.addEventListener('DOMContentLoaded', bkToggleRefresh);
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === USE_KEY) bkToggleRefresh(); });
})();
