// ─── SMART LINK DETECTION ───
// Deliberately conservative: only recognizes http(s)/www URLs, email
// addresses, and bare domains ending in a real, common TLD, so it doesn't
// mistake things like "e.g." or "3.14" or "Mr. Smith" for a link. Trims
// trailing sentence punctuation ("check example.com." -> "example.com") so
// links don't swallow the period that ends the sentence, and recognizes
// emails as mailto: links rather than half-linking just the domain.
const PDFED_URL_TLDS = 'com|net|org|io|co|edu|gov|mil|info|biz|dev|app|ai|in|us|uk|ca|de|fr|jp|cn|au|nz|xyz|me|shop|store|tech|online|site|ly|to|so|gg|tv|cc|nl|es|it|ru|br|za|ch|se|no|dk|fi|pl|kr|id|sg|ae|hk|tw';
function pdfedDetectUrls(text) {
  if (!text) return [];
  const EMAIL = '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*\\.(?:' + PDFED_URL_TLDS + ')';
  const re = new RegExp(
    '\\b' + EMAIL + '\\b' +
    '|\\b(?:https?:\\/\\/|www\\.)[^\\s<>"\')]+' +
    '|(?<!@)\\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9-]+)*\\.(?:' + PDFED_URL_TLDS + ')(?:\\/[^\\s<>"\')]*)?\\b',
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    let raw = m[0];
    // Trim trailing punctuation that's almost certainly sentence punctuation.
    const trimmed = raw.replace(/[.,;:!?)\]"']+$/, '');
    if (!trimmed || trimmed.length < 4) continue;
    if (/^\d+\.\d+$/.test(trimmed)) continue; // decimals like "3.14"
    if (!/[a-zA-Z]/.test(trimmed)) continue;
    const end = m.index + trimmed.length;
    const isEmail = trimmed.includes('@');
    const normalized = isEmail ? ('mailto:' + trimmed) : (/^https?:\/\//i.test(trimmed) ? trimmed : ('https://' + trimmed));
    out.push({ raw: trimmed, normalized, start: m.index, end });
  }
  return out;
}

// Wraps detected occurrences in <a> tags against the plain-text source,
// preserving everything in between untouched. `occurrences` must be sorted
// ascending and non-overlapping.
function pdfedBuildLinkedHtml(text, occurrences) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '', cursor = 0;
  occurrences.forEach(o => {
    html += esc(text.slice(cursor, o.start));
    html += `<a href="${esc(o.normalized)}" style="color:#0B63F6;text-decoration:underline;cursor:pointer">${esc(text.slice(o.start, o.end))}</a>`;
    cursor = o.end;
  });
  html += esc(text.slice(cursor));
  return html.replace(/\n/g, '<br>');
}

// ─── INSERT LINK MODAL ───
// mode: 'place' (Add Link ribbon tool, dropping a brand-new box at ctx.x/ctx.y)
//    or 'edit'  (link button on an existing/focused text box's toolbar)
const pdfedLinkModalState = { mode: null, ctx: null, groups: [] };

function pdfedOpenLinkModal(mode, ctx) {
  pdfedLinkModalState.mode = mode;
  pdfedLinkModalState.ctx = ctx || null;
  pdfedLinkModalState.groups = [];

  const titleEl = document.getElementById('pdfedLinkModalTitle');
  const detectedPanel = document.getElementById('pdfedLinkDetectedPanel');
  const labelRow = document.getElementById('pdfedLinkManualLabelRow');
  const hint = document.getElementById('pdfedLinkManualHint');
  const urlInput = document.getElementById('pdfedLinkManualUrl');
  const labelInput = document.getElementById('pdfedLinkManualLabel');
  urlInput.value = ''; labelInput.value = '';

  if (mode === 'edit') {
    titleEl.textContent = 'Manage Link';
    labelRow.style.display = 'none'; // editing existing text, no separate display-text field
    const item = pdfedPtxtTb.item;
    const text = item ? (item.text || '') : '';
    const occ = pdfedDetectUrls(text);
    if (occ.length) {
      // Group by normalized URL so the same link repeated in a paragraph
      // shows once, with a single checkbox that applies to every occurrence.
      const byUrl = new Map();
      occ.forEach(o => {
        const key = o.normalized.toLowerCase();
        if (!byUrl.has(key)) byUrl.set(key, { normalized: o.normalized, occurrences: [] });
        byUrl.get(key).occurrences.push(o);
      });
      pdfedLinkModalState.groups = Array.from(byUrl.values());
      const list = document.getElementById('pdfedLinkDetectedList');
      list.innerHTML = '';
      pdfedLinkModalState.groups.forEach((g, gi) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;cursor:pointer;';
        const times = g.occurrences.length > 1 ? ` <span style="opacity:0.6">(${g.occurrences.length}×)</span>` : '';
        row.innerHTML = `<input type="checkbox" checked data-gi="${gi}" style="accent-color:var(--blue);flex-shrink:0;cursor:pointer;">
          <span style="font-size:12px;color:var(--text);word-break:break-all;">${g.normalized.replace(/^https:\/\//, '')}${times}</span>`;
        list.appendChild(row);
      });
      document.getElementById('pdfedLinkDetectedCount').textContent = pdfedLinkModalState.groups.length;
      document.getElementById('pdfedLinkDetectedPlural').textContent = pdfedLinkModalState.groups.length === 1 ? '' : 's';
      detectedPanel.style.display = 'flex';
    } else {
      detectedPanel.style.display = 'none';
    }
    if (item && item.link) { urlInput.value = item.link; hint.style.display = 'block'; hint.textContent = 'This box currently links entirely to the URL above. Saving here replaces it.'; }
    else { hint.style.display = 'none'; }
    document.getElementById('pdfedLinkManualInsertBtn').textContent = 'Link Entire Box';
  } else if (mode === 'selection') {
    titleEl.textContent = 'Link Selection';
    detectedPanel.style.display = 'none';
    labelRow.style.display = 'none'; // linking existing highlighted text, no separate label field
    const preview = ctx.text.length > 60 ? (ctx.text.slice(0, 57) + '…') : ctx.text;
    hint.style.display = 'block';
    hint.textContent = 'Linking just the highlighted text: "' + preview + '"';
    document.getElementById('pdfedLinkManualInsertBtn').textContent = 'Link Selection';
  } else {
    titleEl.textContent = 'Insert Link';
    detectedPanel.style.display = 'none';
    labelRow.style.display = 'flex';
    hint.style.display = 'none';
    document.getElementById('pdfedLinkManualInsertBtn').textContent = 'Insert Link';
  }

  document.getElementById('pdfedLinkModal').style.display = 'flex';
  setTimeout(() => urlInput.focus(), 30);
}

function pdfedCloseLinkModal() {
  document.getElementById('pdfedLinkModal').style.display = 'none';
  if (pdfedLinkModalState.mode === 'place') pdfedSetAnnotTool(null);
  pdfedLinkModalState.mode = null; pdfedLinkModalState.ctx = null; pdfedLinkModalState.groups = [];
}

function pdfedNormalizeUrlInput(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  if (!/^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(url) && !/^mailto:/i.test(url)) url = 'https://' + url;
  return url;
}

// "Apply to Selected" — turns the checked, auto-detected URLs into real
// clickable links within the paragraph, leaving all other text untouched.
function pdfedLinkModalApplyDetected() {
  const item = pdfedPtxtTb.item;
  const idx = pdfedPtxtTb.idx;
  const content = pdfedPtxtTb.content;
  if (!item) { pdfedCloseLinkModal(); return; }
  const checks = document.querySelectorAll('#pdfedLinkDetectedList input[type="checkbox"]:checked');
  const occurrences = [];
  checks.forEach(cb => {
    const g = pdfedLinkModalState.groups[+cb.dataset.gi];
    if (g) occurrences.push(...g.occurrences);
  });
  if (!occurrences.length) { toast('Nothing selected to link', 'info'); return; }
  occurrences.sort((a, b) => a.start - b.start);
  item.html = pdfedBuildLinkedHtml(item.text || '', occurrences);
  delete item.link; // multiple in-paragraph links now, no single whole-box link
  if (content) content.innerHTML = item.html;
  pdfedMarkModified(idx);
  pdfedCloseLinkModal();
  toast(occurrences.length === 1 ? 'Link applied' : occurrences.length + ' links applied', 'success');
}

// Manual entry — either drops a brand-new link box (mode 'place') or turns
// the *entire* focused text box into one link (mode 'edit', blank URL removes it).
function pdfedLinkModalManualInsert() {
  const rawUrl = document.getElementById('pdfedLinkManualUrl').value;

  if (pdfedLinkModalState.mode === 'place') {
    const url = pdfedNormalizeUrlInput(rawUrl);
    if (!url) { toast('Enter a URL first', 'error'); return; }
    const { x, y } = pdfedLinkModalState.ctx;
    const idx = pdfed.active;
    const pg = pdfed.pages[idx];
    if (!pg.placedTexts) pg.placedTexts = [];
    const typedLabel = document.getElementById('pdfedLinkManualLabel').value.trim();
    let label = typedLabel;
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, '') || url; } catch(e) { label = url; } }
    const item = {
      id: 'ptxt_' + (++pdfedPlacedTextSeq),
      text: label, link: url, x, y,
      fontSize: pdfedAnnotState.textSize || 20, fontFamily: 'Inter', color: '#0B63F6',
      bold: false, italic: false, underline: true, align: 'left', locked: false,
      zIndex: pdfedNextZ(pg)
    };
    pg.placedTexts.push(item);
    pdfedMarkModified(idx);
    pdfedRenderPlacedTexts(idx);
    toast('Link added — Ctrl/Cmd-click to open, drag to move', 'success');
    pdfedCloseLinkModal();
    return;
  }

  if (pdfedLinkModalState.mode === 'selection') {
    const url = pdfedNormalizeUrlInput(rawUrl);
    if (!url) { toast('Enter a URL first', 'error'); return; }
    const { item, idx, content } = pdfedPtxtTb;
    const range = pdfedLinkModalState.ctx && pdfedLinkModalState.ctx.range;
    if (!item || !content || !range) { pdfedCloseLinkModal(); return; }
    content.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // Wraps just the selected text in a real <a href>, leaving everything
    // else in the paragraph untouched — same approach Word/Google Docs use.
    // Note: this works cleanly for a plain-text selection; a selection that
    // crosses into an already-colored span can produce nested markup our
    // simple top-level-only export parser won't fully unpack, same edge
    // case as the rest of this rich-text box.
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('createLink', false, url);
    const escapedUrl = url.replace(/"/g, '\\"');
    const anchors = Array.from(content.querySelectorAll('a[href="' + escapedUrl + '"]'));
    anchors.forEach(a => { a.style.color = '#0B63F6'; a.style.textDecoration = 'underline'; a.style.cursor = 'pointer'; });
    item.html = content.innerHTML;
    item.text = content.innerText || content.textContent || '';
    pdfedMarkModified(idx);
    pdfedCloseLinkModal();
    toast('Link applied to selection', 'success');
    return;
  }

  // mode === 'edit': link (or unlink) the whole box
  const { item, idx, content } = pdfedPtxtTb;
  if (!item) { pdfedCloseLinkModal(); return; }
  const url = pdfedNormalizeUrlInput(rawUrl);
  if (!url) {
    delete item.link;
    // Also strip any per-run <a> tags from a prior "apply to selected", so
    // clearing the URL field actually removes every link on this box.
    if (item.html) {
      const tmp = document.createElement('div'); tmp.innerHTML = item.html;
      tmp.querySelectorAll('a').forEach(a => a.replaceWith(document.createTextNode(a.textContent)));
      item.html = tmp.innerHTML;
      if (content) content.innerHTML = item.html;
    }
    toast('Link removed', 'success');
  } else {
    item.link = url;
    // Turn the whole box blue + underlined the instant a link is applied —
    // the same visual cue Word/Canva give — so it's obvious at a glance
    // which text is now a live link instead of looking unchanged.
    item.color = '#0B63F6';
    item.underline = true;
    if (item.html) {
      // Strip any leftover per-run color overrides so nothing stays its old
      // color underneath the new whole-box link styling.
      const tmp = document.createElement('div'); tmp.innerHTML = item.html;
      tmp.querySelectorAll('[style]').forEach(el => { el.style.color = ''; });
      item.html = tmp.innerHTML;
    }
    toast('Link applied — text turned blue, Ctrl/Cmd-click to open', 'success');
  }
  pdfedMarkModified(idx);
  pdfedCloseLinkModal();
  // Full re-render (rather than poking a couple of inline styles) so the new
  // color/underline/cursor state is guaranteed to show immediately, the same
  // path the "place new link" flow already relies on.
  pdfedRenderPlacedTexts(idx);
}

function pdfedPlaceTextLabel(x, y) {
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) { toast('No page loaded', 'error'); return; }
  const pg = pdfed.pages[idx];
  if (!pg.placedTexts) pg.placedTexts = [];
  // Its own dedicated size (not the pen/highlighter "Stroke Size" the old
  // formula quietly borrowed from), and a readable dark default color until
  // the person has actually picked one, so the first text box someone adds
  // isn't invisible-on-white draw-tool yellow.
  const fontSize = pdfedAnnotState.textSize || 20;
  const color = pdfedAnnotState.colorTouched ? (pdfedAnnotState.color || '#101820') : '#101820';
  if (pdfed.snapGrid) { x = pdfedSnapToGrid(x); y = pdfedSnapToGrid(y); }
  const item = {
    id: 'ptxt_' + (++pdfedPlacedTextSeq),
    text: 'Double-click to edit',
    x, y,
    fontSize,
    fontFamily: 'Inter',
    color,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    locked: false,
    zIndex: pdfedNextZ(pg)
  };
  pg.placedTexts.push(item);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Text added, drag to move, double-click to edit', 'success');
  // Auto-switch off the add-text tool so the next click doesn't drop another box,
  // and immediately focus the new box for typing.
  pdfedSetAnnotTool(null);
  requestAnimationFrame(() => {
    const el = document.querySelector(`.pdfed-placed-text[data-id="${item.id}"] .pdfed-ptxt-content`);
    if (el) { el.focus(); document.execCommand && pdfedSelectAllText(el); }
  });

  pushAppHistory({
    label: 'Add text',
    undo: () => {
      const i = pg.placedTexts.indexOf(item);
      if (i > -1) pg.placedTexts.splice(i, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Text add undone', 'info');
    },
    redo: () => {
      if (pg.placedTexts.indexOf(item) === -1) pg.placedTexts.push(item);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
    }
  });
}

function pdfedSelectAllText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Drops the text caret at the exact screen point of a click, the same
// primitive every real text editor uses when you click into existing
// content. Chrome/Safari/Edge expose caretRangeFromPoint; Firefox exposes
// the near-identical caretPositionFromPoint. Returns false (caller falls
// back to select-all) only on something old enough to have neither.
function pdfedPlaceCaretAtPoint(x, y) {
  try {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (e) { return false; }
}

// ── Floating font-formatting toolbar (family / size / B / I / U) for placed text ──
const pdfedPtxtTb = { item: null, idx: -1, content: null, el: null };

// Maps a stored family value (which may already be a full CSS font-family stack,
// e.g. "'Times New Roman', Times, serif") to a safe CSS value with Inter fallback.
function pdfedFontCss(fam) {
  if (!fam) return "'Inter', sans-serif";
  return fam.includes(',') ? fam : `'${fam}', 'Inter', sans-serif`;
}

/* ============================================================
   SARVARC Fonts Engine — shared app-wide font picker.
   - Curated "Popular" shortlist shown by default.
   - Searchable library (200+ real Google Font family names).
   - Selected fonts are loaded on demand via the Google Fonts
     CSS2 endpoint (no API key required, matches the <link>
     preconnect already set up in <head>).
   Used by: PDF Editor placed text, Signature (type mode),
   Make Forms text boxes, Diagrams & Graphs text labels.
   ============================================================ */
const SARVARC_POPULAR_FONTS = [
  'Inter','Roboto','Open Sans','Lato','Montserrat','Poppins','Nunito','Raleway','Ubuntu',
  'Work Sans','DM Sans','Manrope','Source Sans Pro','Rubik','Karla','Quicksand',
  'Playfair Display','Merriweather','Lora','Oswald','Bebas Neue','Space Grotesk',
  'Courier Prime','Source Code Pro','JetBrains Mono','Arial','Helvetica Neue',
  'Times New Roman','Georgia','Verdana'
];

const SARVARC_FONT_LIBRARY = Array.from(new Set([
  ...SARVARC_POPULAR_FONTS,
  // Sans-serif
  'Nunito Sans','Heebo','Hind','Titillium Web','Assistant','Overpass','Archivo',
  'IBM Plex Sans','Red Hat Display','Sora','Outfit','Lexend','Epilogue','Jost',
  'Public Sans','Figtree','Plus Jakarta Sans','Urbanist','Be Vietnam Pro','Exo 2',
  'Saira','Chivo','Catamaran','Varela Round','Comfortaa','Zilla Slab','Prompt',
  'Kanit','Maven Pro','Signika','Asap','Oxygen','Dosis','Questrial','Krub',
  'Baloo 2','Anton','Fjalla One','Staatliches','Archivo Black','Mulish',
  'Roboto Condensed','Roboto Flex','Open Sans Condensed','PT Sans Caption',
  'Rajdhani','Teko','Khand','Cabin Condensed','Yanone Kaffeesatz','Francois One',
  'Mukta','Mukta Vaani','Baloo Bhai 2','Baloo Tamma 2','Hind Siliguri','Hind Madurai',
  'Albert Sans','Onest','Instrument Sans','Geologica','Schibsted Grotesk',
  'Bricolage Grotesque','Hanken Grotesk','Familjen Grotesk','Unbounded','Syne',
  'Darker Grotesque','Wix Madefor Text','Wix Madefor Display','Josefin Slab',
  'Alata','Actor','Adamina','Advent Pro','Aleo','Alegreya Sans','Alegreya Sans SC',
  'Antic','Antic Slab','Arimo','Armata','Arsenal','Aubrey','Baumans','Bayon',
  'Belleza','Bitter','Cairo','Catamaran','Chakra Petra','Comme','Days One',
  'Domine','Eczar','Electrolize','Encode Sans','Faustina','Frank Ruhl Libre',
  'Gothic A1','Gudea','Harmattan','Hepta Slab','Josefin Sans','Judson','Kalam',
  'Kdam Thmor Pro','Khula','Kumbh Sans','Lexend Deca','Libre Franklin',
  'M PLUS 1p','M PLUS Rounded 1c','Mada','Manuale','Martel','Michroma',
  'Molengo','Montserrat Alternates','Muli','Neuton','Numans','Nunito',
  'Orbitron','Padauk','Paytone One','Petrona','Piazzolla','Pridi','Puritan',
  'Quattrocento','Quattrocento Sans','Rambla','Ranga','Ropa Sans','Rosario',
  'Rubik Mono One','Ruda','Saira Condensed','Saira Extra Condensed',
  'Sarabun','Sarala','Sawarabi Gothic','Shanti','Simonetta','Six Caps',
  'Spartan','Spline Sans','Suez One','Sumana','Suranna','Syne Tactile',
  'Tenor Sans','Tomorrow','Trirong','Vollkorn SC','Voltaire','Yaldevi',
  'Yellowtail','Zen Kaku Gothic New','Zilla Slab Highlight',
  // Serif
  'PT Serif','Crimson Text','Libre Baskerville','EB Garamond','Cormorant Garamond',
  'Bitter','Source Serif Pro','Noto Serif','Domine','Vollkorn','Rokkitt','Alegreya',
  'Spectral','Cardo','Arvo','Bree Serif','Cormorant','Frank Ruhl Libre',
  'IBM Plex Serif','Newsreader','Literata','Fraunces','Gelasio','Glegoo',
  'Gilda Display','Kreon','Lusitana','Lustria','Marcellus','Marcellus SC',
  'Mate','Mate SC','Noticia Text','Rasa','Rosarivo','Solway','Tinos',
  'Volkhov','Vesper Libre','Coustard','Bentham','Caudex','Fanwood Text',
  'Halant','Kadwa','Kameron','Milonga','Radley','Sumana','Trocchi','Trykker',
  'Cinzel','Cinzel Decorative','Julius Sans One','Cormorant Infant',
  'Cormorant SC','Cormorant Upright','Cormorant Unicase','Crete Round',
  'DM Serif Display','DM Serif Text','Bevan','Sanchez','Judson','Faustina',
  'STIX Two Text',
  // Display / decorative
  'Abril Fatface','Lobster','Pacifico','Righteous','Fredoka','Passion One','Bangers',
  'Alfa Slab One','Bungee','Bungee Inline','Bungee Shade','Monoton',
  'Permanent Marker','Amatic SC','Caveat','Shadows Into Light',
  'Shadows Into Light Two','Great Vibes','Satisfy','Dancing Script',
  'Kaushan Script','Sacramento','Yellowtail','Courgette','Parisienne',
  'Handlee','Indie Flower','Patrick Hand','Gochi Hand','Homemade Apple',
  'Marck Script','Allura','Chewy','Creepster','Fascinate',
  'Fredericka the Great','Kranky','Lacquer','Luckiest Guy','Nosifer',
  'Rock Salt','Rye','Sancreek','Special Elite','Vast Shadow','Wallpoet',
  'Neucha','Gaegu','Gamja Flower','Gloria Hallelujah','Just Another Hand',
  'Reenie Beanie','Architects Daughter','Coming Soon','Covered By Your Grace',
  'Crafty Girls','Delius','Give You Glory','Loved by the King','Mali',
  'Nanum Pen Script','Neonderthaw','Pangolin','Rancho','Redressed',
  'Schoolbell','Walter Turncoat','Zeyada','Marcellus',
  // Monospace
  'Roboto Mono','Fira Code','Fira Mono','Space Mono','IBM Plex Mono',
  'Inconsolata','Ubuntu Mono','PT Mono','DM Mono','Overpass Mono',
  'Cutive Mono','Anonymous Pro','Nova Mono','VT323','Azeret Mono',
  'Major Mono Display','Martian Mono','Red Hat Mono','Spline Sans Mono',
  'Syne Mono',
  // Noto family (broad script coverage, popular for multi-language docs)
  'Noto Sans','Noto Sans JP','Noto Sans KR','Noto Sans SC','Noto Sans TC',
  'Noto Sans Arabic','Noto Sans Devanagari','Noto Serif JP','Noto Serif KR',
  'Noto Color Emoji'
]));

const SARVARC_SYSTEM_FONTS = new Set([
  'Arial','Helvetica Neue','Helvetica','Times New Roman','Georgia','Verdana','Tahoma',
  'Trebuchet MS','Segoe UI','Courier New','cursive','serif','sans-serif','monospace'
]);

// Full live catalog (~1,900 families), fetched once from a static, key-free,
// rate-limit-free CDN mirror of the current Google Fonts list. Falls back to
// the bundled SARVARC_FONT_LIBRARY above if the network request fails (e.g.
// offline use, or a locked-down network that blocks the CDN).
let sarvarcFullFontList = null;
let sarvarcFullFontListPromise = null;
function sarvarcFetchFullFontList() {
  if (sarvarcFullFontList || sarvarcFullFontListPromise) return sarvarcFullFontListPromise;
  sarvarcFullFontListPromise = fetch('https://cdn.jsdelivr.net/gh/hasinhayder/google-fonts/fonts.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('bad response')))
    .then(data => {
      if (Array.isArray(data.fonts) && data.fonts.length) {
        sarvarcFullFontList = data.fonts;
        if (sarvarcFontPickerEl) {
          const search = sarvarcFontPickerEl.querySelector('.sarvarc-font-search');
          if (search && sarvarcFontPickerRenderList) sarvarcFontPickerRenderList(search.value);
        }
      }
    })
    .catch(() => { /* silent — bundled SARVARC_FONT_LIBRARY remains the fallback */ });
  return sarvarcFullFontListPromise;
}
let sarvarcFontPickerRenderList = null;

const sarvarcLoadedFonts = new Set();
function sarvarcLoadFont(family) {
  if (!family || SARVARC_SYSTEM_FONTS.has(family) || sarvarcLoadedFonts.has(family)) return;
  sarvarcLoadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') +
    ':ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap';
  document.head.appendChild(link);
}

let sarvarcFontPickerEl = null;
function sarvarcFontPickerOutsideClick(e) {
  if (sarvarcFontPickerEl && !sarvarcFontPickerEl.contains(e.target)) sarvarcCloseFontPicker();
}
function sarvarcCloseFontPicker() {
  if (!sarvarcFontPickerEl) return;
  sarvarcFontPickerEl.remove();
  sarvarcFontPickerEl = null;
  sarvarcFontPickerRenderList = null;
  document.removeEventListener('mousedown', sarvarcFontPickerOutsideClick, true);
}
function sarvarcOpenFontPicker(triggerEl, currentValue, onSelect) {
  sarvarcCloseFontPicker();
  const rect = triggerEl.getBoundingClientRect();
  const panelW = 230, panelH = 320;
  const top = Math.min(rect.bottom + 6, window.innerHeight - panelH - 8);
  const left = Math.min(rect.left, window.innerWidth - panelW - 8);
  const panel = document.createElement('div');
  panel.className = 'sarvarc-font-picker';
  panel.style.cssText = `position:fixed;top:${Math.max(4, top)}px;left:${Math.max(4, left)}px;width:${panelW}px;max-height:${panelH}px;background:var(--bg2,#131a2a);border:1px solid var(--border,#26324a);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.45);z-index:9999;display:flex;flex-direction:column;overflow:hidden;font-family:'Inter',sans-serif;`;
  panel.innerHTML = `
    <div style="padding:8px;border-bottom:1px solid var(--border,#26324a);flex-shrink:0;">
      <input type="text" placeholder="Search fonts…" class="sarvarc-font-search" style="width:100%;box-sizing:border-box;background:var(--bg3,#1a2338);border:1px solid var(--border,#26324a);color:var(--text,#e8edf5);border-radius:6px;padding:6px 8px;font-size:12px;outline:none;">
    </div>
    <div class="sarvarc-font-list" style="overflow-y:auto;flex:1;padding:4px;"></div>
  `;
  document.body.appendChild(panel);
  sarvarcFontPickerEl = panel;
  const searchInput = panel.querySelector('.sarvarc-font-search');
  const listEl = panel.querySelector('.sarvarc-font-list');

  function renderList(query) {
    const q = (query || '').trim().toLowerCase();
    listEl.innerHTML = '';
    let names;
    if (!q) {
      const label = document.createElement('div');
      label.textContent = 'Popular';
      label.style.cssText = 'font-size:10px;color:var(--text3,#8291ab);text-transform:uppercase;letter-spacing:.5px;padding:6px 8px 4px;';
      listEl.appendChild(label);
      names = SARVARC_POPULAR_FONTS;
    } else {
      const source = sarvarcFullFontList || SARVARC_FONT_LIBRARY;
      names = source.filter(f => f.toLowerCase().includes(q)).slice(0, 100);
      if (!names.length) {
        listEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3,#8291ab)">No fonts found</div>';
      }
    }
    names.forEach(name => {
      const row = document.createElement('div');
      row.textContent = name;
      const isActive = currentValue && (currentValue === name || currentValue.startsWith("'" + name + "'") || currentValue.startsWith(name + ','));
      row.style.cssText = `padding:7px 10px;font-size:13px;color:${isActive ? 'var(--blue,#0B63F6)' : 'var(--text,#e8edf5)'};font-weight:${isActive ? '700' : '400'};cursor:pointer;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      row.onmouseenter = () => { row.style.background = 'var(--bg3,#1a2338)'; sarvarcLoadFont(name); row.style.fontFamily = `'${name}', sans-serif`; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.onmousedown = (e) => {
        e.preventDefault(); e.stopPropagation();
        sarvarcLoadFont(name);
        onSelect(name);
        sarvarcCloseFontPicker();
      };
      listEl.appendChild(row);
    });
  }
  renderList('');
  sarvarcFontPickerRenderList = renderList;
  sarvarcFetchFullFontList();
  searchInput.addEventListener('input', () => renderList(searchInput.value));
  searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') sarvarcCloseFontPicker(); e.stopPropagation(); });
  searchInput.focus();
  setTimeout(() => document.addEventListener('mousedown', sarvarcFontPickerOutsideClick, true), 0);
}

function pdfedShowPtxtToolbar(item, idx, content, el) {
  if (pdfedPtxtTb.el && pdfedPtxtTb.el !== el) {
    pdfedPtxtTb.el.classList.remove('selected', 'editing');
  }
  pdfedPtxtTb.item = item; pdfedPtxtTb.idx = idx; pdfedPtxtTb.content = content; pdfedPtxtTb.el = el;
  el.classList.add('selected');
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (!tb) return;
  { const fb = document.getElementById('pdfedPtxtFontBtn'); if (fb) fb.textContent = (item.fontFamily || 'Inter').split(',')[0].replace(/['"]/g, ''); }
  document.getElementById('pdfedPtxtSizeInput').value = Math.round(item.fontSize || 18);
  document.getElementById('pdfedPtxtBoldBtn').classList.toggle('active', !!item.bold);
  document.getElementById('pdfedPtxtItalicBtn').classList.toggle('active', !!item.italic);
  document.getElementById('pdfedPtxtUnderlineBtn').classList.toggle('active', !!item.underline);
  const bulletBtn = document.getElementById('pdfedPtxtBulletBtn');
  if (bulletBtn) bulletBtn.classList.toggle('active', !!item.bullet);
  const linkBtn = document.getElementById('pdfedPtxtLinkBtn');
  if (linkBtn) linkBtn.classList.toggle('active', !!item.link);
  pdfedUpdatePtxtAlignButtons(item);
  const colorInput = document.getElementById('pdfedPtxtColorInput');
  if (colorInput) colorInput.value = pdfedToHexColor(item.color || '#ffffff');
  const gradBtn = document.getElementById('pdfedPtxtGradientBtn');
  if (gradBtn) gradBtn.classList.toggle('active', !!item.gradient);
  const opacityInput = document.getElementById('pdfedPtxtOpacityInput');
  const opacityVal = document.getElementById('pdfedPtxtOpacityVal');
  const pct = Math.round(pdfedGetOpacity(item) * 100);
  if (opacityInput) opacityInput.value = pct;
  if (opacityVal) opacityVal.textContent = pct + '%';
  pdfedPtxtTb._savedRange = null;
  tb.style.display = 'flex';
  pdfedPositionPtxtToolbar();
}

// Any placed object, text, image, or table, may go without an explicit
// `opacity` (older items, or ones never touched by this control), so every
// read goes through this helper instead of assuming item.opacity exists.
function pdfedGetOpacity(item) {
  return (item && item.opacity != null) ? item.opacity : 1;
}

// ── Selection details (right panel) ─────────────────────────────────────
// Rather than hooking every individual select/deselect call site scattered
// across the text/table/image/OCR code paths, this reads whatever DOM
// element currently carries the `.selected` class (each one already gets/
// loses that class from its own existing logic) and looks up the matching
// data item on the active page. A MutationObserver (set up below) calls
// pdfedRefreshSelectionPanel() whenever that class changes anywhere on the
// canvas, so the panel always reflects the true current selection.
function pdfedGetSelectedInfo() {
  const idx = (typeof pdfed !== 'undefined') ? pdfed.active : -1;
  const pg = (idx >= 0 && pdfed.pages) ? pdfed.pages[idx] : null;

  // OCR text block being edited via the Text Editor tool
  if (typeof teState !== 'undefined' && teState.focusedBlock) {
    const b = teState.focusedBlock;
    return {
      type: 'OCR Text',
      rows: [
        ['Position', Math.round(b.x) + ', ' + Math.round(b.y)],
        ['Font', (b.fontFamily || '').split(',')[0].replace(/['"]/g, '') + ' · ' + Math.round(b.fontSize) + 'px'],
        ['Style', [b.bold ? 'Bold' : null, b.italic ? 'Italic' : null].filter(Boolean).join(', ') || 'Regular'],
        ['Locked', b.locked ? 'Yes' : 'No']
      ],
      preview: b.origText
    };
  }

  {
    const total = pdfedSelected.size + pdfedSelectedImgs.size + pdfedSelectedTables.size;
    if (total >= 2) {
      return {
        type: 'Multiple Items',
        rows: [['Selected', total + ' items on this page']],
        preview: null
      };
    }
  }

  const textEl = pg && document.querySelector('.pdfed-placed-text.selected');
  if (textEl) {
    const item = (pg.placedTexts || []).find(i => i.id === textEl.dataset.id);
    if (item) return {
      type: 'Text Box',
      rows: [
        ['Position', Math.round(item.x) + ', ' + Math.round(item.y)],
        ['Font', (item.fontFamily || 'Inter') + ' · ' + Math.round(item.fontSize) + 'px'],
        ['Style', [item.bold ? 'Bold' : null, item.italic ? 'Italic' : null, item.underline ? 'Underline' : null].filter(Boolean).join(', ') || 'Regular'],
        ['Opacity', Math.round(pdfedGetOpacity(item) * 100) + '%'],
        ['Locked', item.locked ? 'Yes' : 'No']
      ],
      preview: item.text
    };
  }

  const tableEl = pg && document.querySelector('.pdfed-placed-table.selected');
  if (tableEl) {
    const item = (pg.placedTables || []).find(i => i.id === tableEl.dataset.id);
    if (item) {
      const w = (item.colWidths || []).reduce((a, b) => a + b, 0);
      const h = (item.rowHeights || []).reduce((a, b) => a + b, 0);
      return {
        type: 'Table',
        rows: [
          ['Position', Math.round(item.x) + ', ' + Math.round(item.y)],
          ['Grid', (item.colWidths || []).length + ' cols × ' + (item.rowHeights || []).length + ' rows'],
          ['Size', Math.round(w) + ' × ' + Math.round(h) + ' px'],
          ['Locked', item.locked ? 'Yes' : 'No']
        ]
      };
    }
  }

  const imgEl = pg && document.querySelector('.pdfed-placed-img.selected');
  if (imgEl) {
    const item = (pg.placedImages || []).find(i => i.id === imgEl.dataset.id);
    if (item) return {
      type: 'Image',
      rows: [
        ['Position', Math.round(item.x) + ', ' + Math.round(item.y)],
        ['Size', Math.round(item.w) + ' × ' + Math.round(item.h) + ' px'],
        ['Opacity', Math.round(pdfedGetOpacity(item) * 100) + '%'],
        ['Locked', item.locked ? 'Yes' : 'No']
      ]
    };
  }

  return null;
}

function pdfedRefreshSelectionPanel() {
  const body = document.getElementById('pdfedSelectionBody');
  if (typeof pdfedRefreshDesignPanel === 'function') pdfedRefreshDesignPanel();
  if (!body) return;
  const info = pdfedGetSelectedInfo();
  if (!info) {
    body.innerHTML = '<div style="text-align:center;padding:14px 6px;color:var(--text3);font-size:11px;line-height:1.6">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;margin-bottom:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg><br>' +
      'Nothing selected<br>Click a text box, image, or table on the page</div>';
    return;
  }
  let html = '<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:5px">' +
    '<span style="width:6px;height:6px;border-radius:50%;background:var(--blue);display:inline-block;flex-shrink:0"></span>' + info.type + '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  info.rows.forEach(r => {
    html += '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px">' +
      '<span style="color:var(--text2);flex-shrink:0">' + r[0] + '</span>' +
      '<span style="color:var(--text);font-weight:600;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r[1] + '</span></div>';
  });
  html += '</div>';
  if (info.preview) {
    const p = String(info.preview).slice(0, 80).replace(/</g, '&lt;');
    html += '<div style="margin-top:9px;padding:7px 8px;background:var(--bg3);border-radius:6px;font-size:10.5px;color:var(--text2);line-height:1.5;max-height:54px;overflow:hidden">' + p + '</div>';
  }
  body.innerHTML = html;
}

// Watches every place selection state can change (placed text/table/image,
// OCR text-editor blocks) instead of hooking each individual select/deselect
// call site, far less fragile against future edits to those tools.
(function pdfedInitSelectionWatcher() {
  let scheduled = false;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; pdfedRefreshSelectionPanel(); });
  };
  const attachObserver = () => {
    const target = document.getElementById('pdfedCanvasWrap') || document.getElementById('sec-pdfeditor');
    if (!target) return;
    const mo = new MutationObserver(scheduleRefresh);
    mo.observe(target, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObserver);
  } else {
    attachObserver();
  }
  // Tables and images never had an explicit "click away to deselect" before —
  // clear their selected state whenever the click lands outside any placed
  // object / OCR block, so the panel correctly falls back to "Nothing selected".
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#pdfedRightPanel')) return; // interacting with a sidebar panel (Design presets, Apply Fade, sliders, etc.) must never clear the current selection
    if (!e.target.closest('.pdfed-placed-text, .pdfed-placed-table, .pdfed-placed-img, .pdfed-text-block')) {
      document.querySelectorAll('.pdfed-placed-table.selected, .pdfed-placed-img.selected').forEach(n => n.classList.remove('selected'));
      if (typeof pdfedSelectedTables !== 'undefined') pdfedSelectedTables.clear();
      if (typeof pdfedSelectedImgs !== 'undefined') pdfedSelectedImgs.clear();
    }
    scheduleRefresh();
  }, true);
})();

function pdfedPositionPtxtToolbar() {
  const tb = document.getElementById('pdfedPtxtToolbar');
  const el = pdfedPtxtTb.el;
  if (!tb || !el || tb.style.display === 'none') return;
  const layer = document.getElementById('pdfedPlacedTextsLayer');
  const layerRect = layer.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  let top = (elRect.top - layerRect.top) - tb.offsetHeight - 8;
  if (top < 0) top = (elRect.bottom - layerRect.top) + 8; // flip below if no room above
  // Clamp against the bottom edge too — on a small/square page (or any time
  // the box sits near the bottom), flipping below can still push the
  // toolbar past the visible page. Without this it rendered mostly
  // off-canvas, which looked like a broken/shrunken toolbar even though it
  // was actually full size.
  const maxTop = layerRect.height - tb.offsetHeight - 4;
  if (top > maxTop) top = Math.max(4, maxTop);
  if (top < 4) top = 4;
  let left = (elRect.left - layerRect.left);
  // IMPORTANT: layerRect is the layer's real ON-SCREEN size (post zoom
  // scale), while layer.clientWidth is its RAW, unscaled canvas-px size (the
  // layer is scaled as a whole via CSS transform to match zoom — see
  // pdfedSyncPlacedTextsZoom). `left` above is in on-screen pixels, so it
  // must be clamped against the on-screen width (layerRect.width), not the
  // raw clientWidth. Mixing the two — as before — meant that on any page
  // whose zoom-to-fit lands away from 100% (small/square canvases in
  // particular), the comparison mixed units, letting the toolbar land mostly
  // or entirely outside the visible page instead of snapping back in
  // bounds. That's what showed up as a "shrunken"/barely-visible toolbar.
  const maxLeft = layerRect.width - tb.offsetWidth - 4;
  if (left > maxLeft) left = Math.max(4, maxLeft);
  if (left < 4) left = 4;
  tb.style.top = top + 'px';
  tb.style.left = left + 'px';
}

function pdfedMaybeHidePtxtToolbar() {
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (!tb) return;
  if (document.activeElement === document.getElementById('pdfedPtxtFontBtn') ||
      document.activeElement === document.getElementById('pdfedPtxtSizeInput') ||
      document.activeElement === document.getElementById('pdfedPtxtColorInput') ||
      (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('sarvarc-font-search')) ||
      sarvarcFontPickerEl) return;
  // The gradient popover's own controls (From/To color pickers, angle slider,
  // preset/remove buttons) all live outside the placed-text box itself, so
  // interacting with any of them blurs `content` just like the checks above —
  // without this guard, a 120ms-later cleanup here would wipe pdfedPtxtTb
  // (and hide the toolbar) out from under the user mid-pick, silently
  // breaking every gradient control including "Remove gradient".
  const gradPop = document.getElementById('pdfedPtxtGradPopover');
  if (gradPop && (gradPop.classList.contains('show') || (document.activeElement && gradPop.contains(document.activeElement)))) return;
  // The Insert/Manage Link modal steals focus into its URL field the instant
  // it opens (so the user can start typing right away), which blurs the text
  // box and would otherwise let this 120ms cleanup timer wipe pdfedPtxtTb
  // before the user finishes typing a URL and clicks Insert/Link Selection —
  // silently breaking every link action with no error shown. Native color
  // pickers have the same issue (input keeps focus while the OS swatch is
  // open, often for way longer than 120ms), guarded above. Skip clearing
  // state while the link modal is open.
  const linkModal = document.getElementById('pdfedLinkModal');
  if (linkModal && linkModal.style.display !== 'none') return;
  if (pdfedPtxtTb.el) pdfedPtxtTb.el.classList.remove('selected', 'editing');
  tb.style.display = 'none';
  pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  pdfedUpdatePtxtAlignButtons(null);
}

// Deselects whatever placed-text box is currently selected/being edited —
// saves any in-progress edit, hides the floating toolbar and its resize
// handles, and drops back to the box's clean, chrome-free look so the user can
// see exactly how the text will render.
function pdfedDeselectAllPlacedTexts() {
  const { content } = pdfedPtxtTb;
  if (content && document.activeElement === content) content.blur();
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (tb) tb.style.display = 'none';
  pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  pdfedUpdatePtxtAlignButtons(null);
  document.querySelectorAll('.pdfed-placed-text.editing').forEach(n => n.classList.remove('editing'));
  pdfedClearMultiSelection();
}

// ── "Select All" for every placed element (text boxes, images, tables) on
// the current page — Ctrl+A, mirroring the Diagrams & Graphs module's ribbon
// Select All. No preconditions: clicking it just selects whatever is on the
// page (nothing to select simply means nothing gets the .selected class).
// pdfedSelected / pdfedSelectedImgs / pdfedSelectedTables hold the ids of
// whatever's currently multi-selected. While 2+ things are selected, the
// single-item font/color toolbar hides (it can't edit many at once), Align
// buttons apply to every selected text box, and Delete/Backspace removes
// everything selected together.
let pdfedSelected = new Set();
let pdfedSelectedImgs = new Set();
let pdfedSelectedTables = new Set();

function pdfedSelectAllPlacedTexts() {
  const idx = (typeof pdfed !== 'undefined') ? pdfed.active : -1;
  const pg = (idx >= 0 && pdfed.pages) ? pdfed.pages[idx] : null;

  pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (tb) tb.style.display = 'none';

  pdfedSelected = new Set(((pg && pg.placedTexts) || []).map(t => t.id));
  pdfedSelectedImgs = new Set(((pg && pg.placedImages) || []).map(t => t.id));
  pdfedSelectedTables = new Set(((pg && pg.placedTables) || []).map(t => t.id));

  document.querySelectorAll('#pdfedPlacedTextsLayer .pdfed-placed-text').forEach(n => {
    n.classList.toggle('selected', pdfedSelected.has(n.dataset.id));
  });
  document.querySelectorAll('#pdfedPlacedImagesLayer .pdfed-placed-img').forEach(n => {
    n.classList.toggle('selected', pdfedSelectedImgs.has(n.dataset.id));
  });
  document.querySelectorAll('#pdfedPlacedTablesLayer .pdfed-placed-table').forEach(n => {
    n.classList.toggle('selected', pdfedSelectedTables.has(n.dataset.id));
  });
  // Shapes/borders only ever support a single active selection each (see
  // their own click handlers), so Select All simply marks every one of them
  // too — it just can't track them in a Set the way text/image/table do.
  document.querySelectorAll('#pdfedPlacedShapesLayer .pdfed-placed-shape').forEach(n => n.classList.add('selected'));
  document.querySelectorAll('#pdfedPlacedBordersLayer .pdfed-placed-border').forEach(n => n.classList.add('selected'));

  const total = pdfedSelected.size + pdfedSelectedImgs.size + pdfedSelectedTables.size
    + document.querySelectorAll('#pdfedPlacedShapesLayer .pdfed-placed-shape').length
    + document.querySelectorAll('#pdfedPlacedBordersLayer .pdfed-placed-border').length;
  if (total) toast('Selected ' + total + (total === 1 ? ' item' : ' items') + ' on this page', 'info');
}

function pdfedHasMultiSelection() {
  return (pdfedSelected.size + pdfedSelectedImgs.size + pdfedSelectedTables.size) > 0;
}

function pdfedClearMultiSelection() {
  pdfedSelected.clear();
  pdfedSelectedImgs.clear();
  pdfedSelectedTables.clear();
  document.querySelectorAll('.pdfed-placed-text.selected, .pdfed-placed-img.selected, .pdfed-placed-table.selected, .pdfed-placed-shape.selected, .pdfed-placed-border.selected').forEach(n => n.classList.remove('selected'));
}

// Which page-array key and re-render function each kind of placed item uses.
// Shared by the selection/delete/nudge helpers below so every one of them
// (text, image, table, shape, border) is handled the exact same way instead
// of five near-duplicate code paths.
const PDFED_KIND_LIST_KEY = { text: 'placedTexts', image: 'placedImages', table: 'placedTables', shape: 'placedShapes', border: 'placedBorders' };
function pdfedRenderKind(kind, idx) {
  if (kind === 'text') pdfedRenderPlacedTexts(idx);
  else if (kind === 'image') { pdfedRenderPlacedImages(idx); pdfedRenderPlacedTexts(idx); }
  else if (kind === 'table') pdfedRenderPlacedTables(idx);
  else if (kind === 'shape') pdfedRenderPlacedShapes(idx);
  else if (kind === 'border') pdfedRenderPlacedBorders(idx);
}

// Gathers every placed item currently selected on the active page, across
// all five kinds, from whichever source actually holds the selection right
// now: the deliberate multi-select Sets (populated by a marquee drag or
// Ctrl+A) AND the plain `.selected` class every single click already
// applies. Combining both means "select one image" and "marquee-select six
// things" are handled by the exact same code path below instead of the
// single-item case needing its own separate delete/move logic.
function pdfedGetActiveSelection() {
  const idx = (typeof pdfed !== 'undefined') ? pdfed.active : -1;
  const pg = (idx >= 0 && pdfed.pages) ? pdfed.pages[idx] : null;
  const items = [];
  if (!pg) return { idx, pg, items };
  const seen = new Set();
  const add = (kind, item) => {
    if (!item || seen.has(item)) return;
    seen.add(item);
    items.push({ kind, item });
  };
  const bySet = (kind, set, list) => { if (set) (list || []).forEach(it => { if (set.has(it.id)) add(kind, it); }); };
  bySet('text', pdfedSelected, pg.placedTexts);
  bySet('image', pdfedSelectedImgs, pg.placedImages);
  bySet('table', pdfedSelectedTables, pg.placedTables);
  const byDom = (kind, selector, list) => {
    document.querySelectorAll(selector).forEach(n => {
      if (!n.classList.contains('selected')) return;
      const it = (list || []).find(x => x.id === n.dataset.id);
      if (it) add(kind, it);
    });
  };
  byDom('text', '#pdfedPlacedTextsLayer .pdfed-placed-text.selected', pg.placedTexts);
  byDom('image', '#pdfedPlacedImagesLayer .pdfed-placed-img.selected', pg.placedImages);
  byDom('table', '#pdfedPlacedTablesLayer .pdfed-placed-table.selected', pg.placedTables);
  byDom('shape', '#pdfedPlacedShapesLayer .pdfed-placed-shape.selected', pg.placedShapes);
  byDom('border', '#pdfedPlacedBordersLayer .pdfed-placed-border.selected', pg.placedBorders);
  return { idx, pg, items };
}

// Re-applies the `.selected` class after a re-render (which always rebuilds
// fresh DOM nodes with no class on them) so a selection survives its own
// delete-undo or a burst of arrow-key nudges instead of vanishing after the
// very first change.
function pdfedReapplySelectedClass(ids) {
  if (!ids || !ids.length) return;
  const idSet = new Set(ids);
  document.querySelectorAll(
    '#pdfedPlacedTextsLayer .pdfed-placed-text, #pdfedPlacedImagesLayer .pdfed-placed-img, ' +
    '#pdfedPlacedTablesLayer .pdfed-placed-table, #pdfedPlacedShapesLayer .pdfed-placed-shape, ' +
    '#pdfedPlacedBordersLayer .pdfed-placed-border'
  ).forEach(n => { if (idSet.has(n.dataset.id)) n.classList.add('selected'); });
  // pdfedRenderPlacedTexts always clears this Set on rebuild — put back
  // whichever of the reselected ids were text boxes so Ctrl+A / marquee
  // bookkeeping and the next pdfedGetActiveSelection() stay consistent.
  ids.forEach(id => { if (document.querySelector('#pdfedPlacedTextsLayer .pdfed-placed-text[data-id="' + id + '"]')) pdfedSelected.add(id); });
}

// Deletes every currently-selected placed item (text/image/table/shape/
// border) in one action — whether that's a single item selected by a plain
// click, or many selected via marquee/Ctrl+A. Locked items are left alone
// (same as their individual delete badges refusing to delete while locked).
// Fully undoable: Ctrl+Z restores every removed item to its exact original
// position in its original list; Ctrl+Y/Ctrl+Shift+Z redoes the delete.
function pdfedDeleteSelectedPlacedItems() {
  const { idx, pg, items } = pdfedGetActiveSelection();
  if (!pg) return false;
  const removable = items.filter(o => !o.item.locked);
  if (!removable.length) return false;

  const removed = removable.map(o => {
    const key = PDFED_KIND_LIST_KEY[o.kind];
    const list = pg[key] || [];
    return { kind: o.kind, key, index: list.indexOf(o.item), item: o.item };
  }).filter(r => r.index !== -1);
  if (!removed.length) return false;

  const kindsOf = (list) => { const s = new Set(); list.forEach(r => s.add(r.kind)); return s; };

  const doRemove = () => {
    removed.forEach(r => {
      const list = pg[r.key];
      if (!list) return;
      const at = list.indexOf(r.item);
      if (at !== -1) list.splice(at, 1);
    });
    pdfedClearMultiSelection();
    pdfedMarkModified(idx);
    kindsOf(removed).forEach(k => pdfedRenderKind(k, idx));
  };

  doRemove();
  const count = removed.length;
  toast('Deleted ' + count + (count === 1 ? ' item' : ' items'), 'success');

  pushAppHistory({
    label: 'Delete',
    undo: () => {
      // Restore lowest original index first so earlier splices don't shift
      // where the next one needs to land.
      [...removed].sort((a, b) => a.index - b.index).forEach(r => {
        if (!pg[r.key]) pg[r.key] = [];
        pg[r.key].splice(Math.min(r.index, pg[r.key].length), 0, r.item);
      });
      pdfedMarkModified(idx);
      kindsOf(removed).forEach(k => pdfedRenderKind(k, idx));
      pdfedReapplySelectedClass(removed.map(r => r.item.id));
      toast('Delete undone', 'info');
    },
    redo: () => {
      doRemove();
      toast('Deleted ' + count + (count === 1 ? ' item' : ' items'), 'success');
    }
  });
  return true;
}

// Backward-compatible name (still wired to the ribbon's Select All + used
// elsewhere) — now just delegates to the unified version above so single AND
// multi selections are both deletable through one code path.
function pdfedDeleteSelectedPlacedTexts() { return pdfedDeleteSelectedPlacedItems(); }

// ── Cross-page Copy / Cut / Paste (Ctrl+C / Ctrl+X / Ctrl+V) ──────────────
// A separate, app-internal clipboard for placed text/image/table objects —
// distinct from the OS clipboard the paste listener further below reads
// from. This is what makes "copy on page 1, switch to page 4, paste" work:
// selected objects are deep-cloned into pdfedInternalClipboard on Ctrl+C,
// and a later Ctrl+V — on ANY page of the document, at any time — drops
// fresh copies onto whichever page is active at that moment, styling and
// content untouched. Every placed kind travels through it — text, image,
// table, shape, and border.
let pdfedInternalClipboard = [];
let pdfedClipboardPasteCount = 0;

function pdfedCopySelectedToClipboard() {
  const { items } = pdfedGetActiveSelection();
  const copyable = items; // every kind is copyable: text, image, table, shape, border
  if (!copyable.length) return false;
  pdfedInternalClipboard = copyable.map(o => {
    const data = JSON.parse(JSON.stringify(o.item));
    delete data.id;
    return { kind: o.kind, data };
  });
  pdfedClipboardPasteCount = 0;
  const n = pdfedInternalClipboard.length;
  toast('Copied ' + n + (n === 1 ? ' item' : ' items') + ' — switch page and press Ctrl+V to paste', 'info');
  return true;
}

function pdfedCutSelectedToClipboard() {
  if (!pdfedCopySelectedToClipboard()) return false;
  pdfedDeleteSelectedPlacedItems();
  return true;
}

// Drops whatever's on pdfedInternalClipboard onto the currently active page.
// Repeated Ctrl+V presses on the same page cascade the offset (same idea as
// the Diagrams & Graphs module's own text clipboard) so pastes don't stack
// exactly on top of each other.
function pdfedPasteFromInternalClipboard() {
  if (!pdfedInternalClipboard.length) return false;
  const idx = pdfed.active;
  const pg = (idx >= 0 && pdfed.pages) ? pdfed.pages[idx] : null;
  if (!pg) return false;

  pdfedClipboardPasteCount++;
  const offset = 20 * pdfedClipboardPasteCount;
  const created = []; // { kind, key, item }

  pdfedInternalClipboard.forEach(entry => {
    const clone = JSON.parse(JSON.stringify(entry.data));
    clone.x = (clone.x || 0) + offset;
    clone.y = (clone.y || 0) + offset;
    clone.locked = false;
    let key;
    if (entry.kind === 'text') { clone.id = 'ptxt_' + (++pdfedPlacedTextSeq); key = 'placedTexts'; }
    else if (entry.kind === 'image') { clone.id = 'pimg_' + (++pdfedAnnotState.placedImgSeq); key = 'placedImages'; }
    else if (entry.kind === 'table') { clone.id = 'tbl_' + (++pdfedTableSeq); key = 'placedTables'; }
    else if (entry.kind === 'shape') { clone.id = 'pshp_' + (++pdfedPlacedShapeSeq); key = 'placedShapes'; }
    else { clone.id = 'pbrd_' + (++pdfedBorderSeq); key = 'placedBorders'; }
    clone.zIndex = pdfedNextZ(pg);
    if (!pg[key]) pg[key] = [];
    pg[key].push(clone);
    created.push({ kind: entry.kind, key, item: clone });
  });

  pdfedMarkModified(idx);
  const kinds = new Set(created.map(c => c.kind));
  kinds.forEach(k => pdfedRenderKind(k, idx));
  pdfedClearMultiSelection();
  created.forEach(c => {
    if (c.kind === 'text') pdfedSelected.add(c.item.id);
    else if (c.kind === 'image') pdfedSelectedImgs.add(c.item.id);
    else if (c.kind === 'table') pdfedSelectedTables.add(c.item.id);
    // shapes/borders track selection purely via the .selected DOM class,
    // which pdfedReapplySelectedClass (below) already applies for every kind.
  });
  pdfedReapplySelectedClass(created.map(c => c.item.id));
  const n = created.length;
  toast('Pasted ' + n + (n === 1 ? ' item' : ' items'), 'success');

  pushAppHistory({
    label: 'Paste',
    undo: () => {
      created.forEach(c => {
        const list = pg[c.key];
        if (!list) return;
        const at = list.indexOf(c.item);
        if (at !== -1) list.splice(at, 1);
      });
      pdfedMarkModified(idx);
      kinds.forEach(k => pdfedRenderKind(k, idx));
      pdfedClearMultiSelection();
      toast('Paste undone', 'info');
    },
    redo: () => {
      created.forEach(c => {
        if (!pg[c.key]) pg[c.key] = [];
        if (pg[c.key].indexOf(c.item) === -1) pg[c.key].push(c.item);
      });
      pdfedMarkModified(idx);
      kinds.forEach(k => pdfedRenderKind(k, idx));
    }
  });
  return true;
}

// Arrow-key nudge: moves every currently-selected, unlocked placed item by
// (dx, dy) canvas-px. Consecutive presses within a short window (a "burst",
// same idea as a mouse drag) are coalesced into a single undo step so
// Ctrl+Z undoes the whole nudge back to where the burst started, not one
// single pixel at a time.
let pdfedNudgeBurst = null;
function pdfedNudgeSelection(dx, dy) {
  const { idx, items } = pdfedGetActiveSelection();
  const movable = items.filter(o => !o.item.locked);
  if (!movable.length) return false;

  if (!pdfedNudgeBurst || pdfedNudgeBurst.idx !== idx) {
    pdfedNudgeBurst = {
      idx,
      snaps: movable.map(o => ({ item: o.item, startX: o.item.x, startY: o.item.y })),
      kinds: new Set(movable.map(o => o.kind)),
      timer: null
    };
  } else {
    // A later press may have a slightly different selection than the first
    // one in this burst (e.g. selection grew) — fold in any newly-moving
    // items without losing the original start position already recorded.
    const already = new Set(pdfedNudgeBurst.snaps.map(s => s.item));
    movable.forEach(o => {
      if (!already.has(o.item)) pdfedNudgeBurst.snaps.push({ item: o.item, startX: o.item.x, startY: o.item.y });
      pdfedNudgeBurst.kinds.add(o.kind);
    });
  }

  movable.forEach(o => { o.item.x = (o.item.x || 0) + dx; o.item.y = (o.item.y || 0) + dy; });
  pdfedMarkModified(idx);
  pdfedNudgeBurst.kinds.forEach(k => pdfedRenderKind(k, idx));
  pdfedReapplySelectedClass(movable.map(o => o.item.id));

  clearTimeout(pdfedNudgeBurst.timer);
  pdfedNudgeBurst.timer = setTimeout(pdfedCommitNudgeBurst, 500);
  return true;
}

function pdfedCommitNudgeBurst() {
  const burst = pdfedNudgeBurst;
  pdfedNudgeBurst = null;
  if (!burst || !burst.snaps.length) return;
  const idx = burst.idx, kinds = burst.kinds;
  const starts = burst.snaps.map(s => ({ item: s.item, x: s.startX, y: s.startY }));
  const ends = burst.snaps.map(s => ({ item: s.item, x: s.item.x, y: s.item.y }));
  pushAppHistory({
    label: 'Move',
    undo: () => {
      starts.forEach(s => { s.item.x = s.x; s.item.y = s.y; });
      pdfedMarkModified(idx);
      kinds.forEach(k => pdfedRenderKind(k, idx));
      pdfedReapplySelectedClass(starts.map(s => s.item.id));
    },
    redo: () => {
      ends.forEach(s => { s.item.x = s.x; s.item.y = s.y; });
      pdfedMarkModified(idx);
      kinds.forEach(k => pdfedRenderKind(k, idx));
      pdfedReapplySelectedClass(ends.map(s => s.item.id));
    }
  });
}

document.addEventListener('keydown', function (e) {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap || wrap.style.display === 'none' || wrap.offsetParent === null) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    pdfedSelectAllPlacedTexts();
  } else if (mod && e.key.toLowerCase() === 'c' && pdfedGetActiveSelection().items.length >= 1) {
    if (pdfedCopySelectedToClipboard()) e.preventDefault();
  } else if (mod && e.key.toLowerCase() === 'x' && pdfedGetActiveSelection().items.length >= 1) {
    if (pdfedCutSelectedToClipboard()) e.preventDefault();
  } else if (mod && e.key.toLowerCase() === 'v' && pdfedInternalClipboard.length) {
    // Internal clipboard takes priority over the OS-clipboard paste
    // listener below — preventDefault here stops that native 'paste' event
    // from firing at all, so this never double-pastes.
    e.preventDefault();
    pdfedPasteFromInternalClipboard();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && pdfedGetActiveSelection().items.length >= 1) {
    e.preventDefault();
    pdfedDeleteSelectedPlacedItems();
  } else if (e.key === 'Escape' && pdfedHasMultiSelection()) {
    pdfedDeselectAllPlacedTexts();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!pdfedGetActiveSelection().items.length) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === 'ArrowLeft') dx = -step;
    else dx = step;
    pdfedNudgeSelection(dx, dy);
  }
});

// Remembers the last spot the person clicked on the page canvas (in raw
// canvas-px, same coordinate space as every placed item's x/y), purely so a
// Ctrl/Cmd+V paste below has somewhere sensible to land instead of always
// dropping in the same corner. Capture phase so it's recorded even when a
// placed box's own mousedown handler stops the event from bubbling further.
let pdfedLastCanvasPos = null;
document.addEventListener('mousedown', function (e) {
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap || wrap.style.display === 'none' || wrap.offsetParent === null) return;
  if (e.target === wrap || e.target.id === 'pdfedPageCanvas' ||
      e.target.closest('.pdfed-placed-text, .pdfed-placed-img, .pdfed-placed-table')) {
    pdfedLastCanvasPos = pdfedCtxCanvasPos(e);
  }
}, true);

// ── Paste anywhere on the canvas (Ctrl/Cmd+V) ──────────────────────────────
// Drops whatever's on the clipboard straight onto the page as a new, fully
// editable object — an image, a table (from a spreadsheet or a plain
// tab-separated copy), or plain text — the same way a bare paste behaves on
// a Canva/Figma/PowerPoint canvas. Only kicks in when focus ISN'T already
// inside a text box, input, or textarea; a paste while actually editing a
// text box keeps using that box's own paste handler (which normalizes
// pasted text into it, see pdfedRenderPlacedTexts), and a paste into any
// other form field on the page is left completely alone.
document.addEventListener('paste', async function (e) {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const wrap = document.getElementById('pdfedCanvasWrap');
  if (!wrap || wrap.style.display === 'none' || wrap.offsetParent === null) return;
  const idx = pdfed.active;
  if (idx < 0 || !pdfed.pages[idx]) return;
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return;

  const pc = document.getElementById('pdfedPageCanvas');
  const pos = pdfedLastCanvasPos || { x: Math.round(((pc && pc.width) || 600) / 2), y: Math.round(((pc && pc.height) || 800) / 2) };

  // 1) An actual image on the clipboard (screenshot, copied photo, an image
  // copied from another tab/app) takes priority over any text that might be
  // riding along with it.
  const imgFile = Array.from(cd.items || []).find(it => it.kind === 'file' && it.type && it.type.startsWith('image/'));
  if (imgFile) {
    e.preventDefault();
    const file = imgFile.getAsFile();
    if (!file) return;
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
    pdfedPastePlacedImage(dataUrl, pos.x, pos.y);
    return;
  }

  // 2) Tabular data — a real <table> (Excel/Sheets/Word all put one on the
  // clipboard alongside plain text) or tab-separated plain text — becomes a
  // live, editable table instead of a wall of tab characters dumped into a
  // text box.
  const html = cd.getData('text/html');
  const plain = cd.getData('text/plain');
  let rowsData = null;
  if (html && /<table[\s>]/i.test(html)) {
    rowsData = pdfedParseHtmlTableClipboard(html);
  } else if (plain && plain.trim() && typeof daSplitDelimitedText === 'function') {
    rowsData = daSplitDelimitedText(plain);
  }
  if (rowsData && rowsData.length && rowsData.some(r => r.length > 1)) {
    e.preventDefault();
    pdfedPasteTableFromRows(rowsData, pos.x, pos.y);
    return;
  }

  // 3) Plain text, the common case — becomes a new text box with the pasted
  // content, keeping every line break exactly as copied.
  if (plain) {
    e.preventDefault();
    pdfedPastePlacedText(plain, pos.x, pos.y);
  }
});

// Places a pasted image centered on `cx,cy` (raw canvas-px), sized to the
// same 35%-of-page-width default the file-picker's Insert Image ghost uses,
// but landing already-stamped and editable instead of requiring an extra
// drag-then-Stamp step — matching how a paste should feel.
function pdfedPastePlacedImage(dataUrl, cx, cy) {
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg) return;
  if (!pg.placedImages) pg.placedImages = [];
  const pc = document.getElementById('pdfedPageCanvas');
  const defaultW = Math.round(((pc && pc.width) || 1000) * 0.35);
  const probe = new Image();
  probe.onload = () => {
    const h = probe.naturalWidth ? Math.round(defaultW * (probe.naturalHeight / probe.naturalWidth)) : defaultW;
    const item = {
      id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
      dataUrl,
      x: Math.round(cx - defaultW / 2),
      y: Math.round(cy - h / 2),
      w: defaultW, h,
      locked: false,
      zIndex: pdfedNextZ(pg)
    };
    pg.placedImages.push(item);
    pdfedMarkModified(idx);
    pdfedRenderPlacedImages(idx);
    pdfedRenderPlacedTexts(idx);
    toast('Image pasted, drag to move, then lock it in place', 'success');

    pushAppHistory({
      label: 'Paste image',
      undo: () => {
        const i = pg.placedImages.indexOf(item);
        if (i > -1) pg.placedImages.splice(i, 1);
        pdfedMarkModified(idx);
        pdfedRenderPlacedImages(idx);
        toast('Image paste undone', 'info');
      },
      redo: () => {
        if (pg.placedImages.indexOf(item) === -1) pg.placedImages.push(item);
        pdfedMarkModified(idx);
        pdfedRenderPlacedImages(idx);
      }
    });
  };
  probe.src = dataUrl;
}

// Places pasted plain text as a new, immediately editable text box centered
// on `cx,cy`, keeping the same defaults (size/color) Add Text uses so a
// pasted box looks consistent with a typed one.
function pdfedPastePlacedText(text, cx, cy) {
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg) return;
  if (!pg.placedTexts) pg.placedTexts = [];
  const fontSize = pdfedAnnotState.textSize || 20;
  const color = pdfedAnnotState.colorTouched ? (pdfedAnnotState.color || '#101820') : '#101820';
  const item = {
    id: 'ptxt_' + (++pdfedPlacedTextSeq),
    text: text.replace(/\r\n/g, '\n'),
    x: Math.round(cx - 80), y: Math.round(cy - 12),
    fontSize, fontFamily: 'Inter', color,
    bold: false, italic: false, underline: false, align: 'left',
    locked: false, zIndex: pdfedNextZ(pg)
  };
  pg.placedTexts.push(item);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTexts(idx);
  toast('Text pasted, drag to move, double-click to edit', 'success');

  pushAppHistory({
    label: 'Paste text',
    undo: () => {
      const i = pg.placedTexts.indexOf(item);
      if (i > -1) pg.placedTexts.splice(i, 1);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
      toast('Text paste undone', 'info');
    },
    redo: () => {
      if (pg.placedTexts.indexOf(item) === -1) pg.placedTexts.push(item);
      pdfedMarkModified(idx);
      pdfedRenderPlacedTexts(idx);
    }
  });
}

// Turns clipboard <table> HTML (Excel/Sheets/Word, or any styled web table,
// all include one when you copy a cell range) into a plain rows-of-strings
// array, cell text only.
//
// Colspan/rowspan-aware: a naive "one array slot per <th>/<td> found" read
// breaks the moment ANY cell spans more than one column — a combined header
// ("Amount" over two sub-columns), a hidden icon/status cell with no
// counterpart in the header row, a rowspan'd category label — because every
// column after that cell silently shifts one slot for the rest of that row.
// This walks each cell's actual colspan/rowspan and places it at its real
// grid column instead of just the next free array index.
// Reads a cell's flex/grid CSS `order` (inline style only — a detached,
// unattached-to-document fragment like our clipboard `tmp` div never
// resolves stylesheet rules, only inline ones). Browsers that write a
// "computed style" clipboard fragment (Chrome/Edge do this on copy, to
// preserve how the source page actually looked) bake that order value in
// as an inline style even when the original page set it via a class. A
// table that visually reorders its columns with CSS `order` — a frozen/
// pinned first column being the most common reason to do this — keeps its
// <td>s in their original, UNREORDERED position in the DOM, so reading
// cells in plain child order silently scrambles which value lands under
// which header. Falls back to DOM position (a no-op) when no explicit
// order is set, which is the case for every ordinary table.
function pdfedCellVisualOrder(cell, domIndex) {
  const styleOrder = cell.style && cell.style.order;
  const n = styleOrder !== undefined && styleOrder !== '' ? parseInt(styleOrder, 10) : NaN;
  return Number.isFinite(n) ? n : domIndex;
}

// A single cell that bundles a text label together with one or more
// trailing numeric values — e.g. "Solar Panel 18,500 2,22,000" — happens
// when a source page renders several logically separate columns (name,
// unit price, total) as inner flex/grid children of ONE <td> with no
// text-level separator between them, so their combined textContent reads
// as a single run-together cell instead of three. Peels whitespace-
// separated, digit-led tokens off the END of the text, one per still-
// missing column, so numbers land in their own cells instead of glued
// onto the name. Works for plain integers, decimals, and comma-grouped
// numbers (Western "12,345" or Indian "2,22,000" grouping) since it only
// requires the token to be made up of digits/commas/dots — it doesn't
// validate grouping shape.
function pdfedSplitTrailingNumbers(text, countNeeded) {
  if (countNeeded <= 0) return null;
  const tokenRe = /(\S*\d)\s*$/;
  let rest = String(text || '');
  const nums = [];
  while (nums.length < countNeeded) {
    const m = tokenRe.exec(rest.replace(/\s+$/, ''));
    if (!m || !/^[\d.,]+$/.test(m[1])) break;
    nums.unshift(m[1]);
    rest = rest.slice(0, m.index).trim();
  }
  if (!nums.length) return null;
  return [rest, ...nums];
}

function pdfedParseHtmlTableClipboard(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const table = tmp.querySelector('table');
  if (!table) return null;

  const trs = Array.from(table.querySelectorAll('tr'));
  if (!trs.length) return null;
  const grid = [];
  const rowspanCarry = []; // { col, text, remaining }
  trs.forEach((tr, rIdx) => {
    if (!grid[rIdx]) grid[rIdx] = [];
    let col = 0;
    rowspanCarry.forEach(c => {
      if (c.remaining > 0) {
        while (grid[rIdx][col] !== undefined) col++;
        grid[rIdx][col] = c.text;
        col++;
        c.remaining--;
      }
    });
    const rawCells = Array.from(tr.children).filter(el => el.tagName === 'TH' || el.tagName === 'TD');
    // Re-sort into visual order (see pdfedCellVisualOrder) before walking —
    // only actually changes anything when the source explicitly set a
    // flex/grid `order` style that differs from DOM position; every normal
    // table's cells are already in ascending order and this is a no-op.
    const orderedCells = rawCells
      .map((cell, i) => ({ cell, order: pdfedCellVisualOrder(cell, i) }))
      .sort((a, b) => a.order - b.order)
      .map(x => x.cell);
    orderedCells.forEach(cell => {
      while (grid[rIdx][col] !== undefined) col++;
      const text = (cell.textContent || '').trim();
      const colSpan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
      const rowSpan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
      for (let s = 0; s < colSpan; s++) grid[rIdx][col + s] = s === 0 ? text : '';
      if (rowSpan > 1) rowspanCarry.push({ col, text: '', remaining: rowSpan - 1 });
      col += colSpan;
    });
  });

  let rows = grid.map(r => {
    const row = [];
    for (let i = 0; i < r.length; i++) row.push(r[i] === undefined ? '' : r[i]);
    return row;
  }).filter(r => r.length);
  if (!rows.length) return null;

  // Safety net for the two failure shapes colspan-awareness alone can't
  // catch, because the source markup itself doesn't expose them as spans:
  //   - a data row with an extra, genuinely-empty cell the header has no
  //     counterpart for (a hidden icon/status column baked into every body
  //     row but never given its own header) — drop empty cells until the
  //     row lines up with the header instead of leaving everything after
  //     that phantom cell shifted one slot right.
  //   - a data row one cell short because a UI renders two logically
  //     separate values (typically Debit/Credit amounts) inside a single
  //     <td> via inner elements with no text-level separator, so their
  //     combined textContent reads as one run-together cell — split it
  //     back into two so the row matches the header instead of merging
  //     two real columns into one.
  const headerLen = rows[0].length;
  const moneyPairRe = /^(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})$/;

  // Figure out, once and up front, whether one specific column position is
  // blank across every over-length data row. That's the real signature of
  // a hidden spacer/icon column baked into the source markup with no
  // header counterpart — it's empty everywhere because it's genuinely not
  // a data column. A per-row "just delete the first empty cell I find"
  // guess is only safe when it happens to land on that same phantom column
  // every time; if a particular row's genuinely-empty cell is a real field
  // that just happens to be blank (an unset Employees count, a blank
  // Notes entry), deleting it removes real data and shifts everything
  // after it one slot left, corrupting the rest of that row. Cross-
  // checking against every over-length row first lets us target the
  // actual phantom column with confirmation instead of guessing per row.
  const overLenRowIdx = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length > headerLen) overLenRowIdx.push(i);
  }
  let phantomCol = -1;
  if (overLenRowIdx.length) {
    const maxLen = Math.max(...overLenRowIdx.map(i => rows[i].length));
    for (let c = 0; c < maxLen; c++) {
      if (overLenRowIdx.every(i => !String(rows[i][c] ?? '').trim())) { phantomCol = c; break; }
    }
  }

  for (let i = 1; i < rows.length; i++) {
    // Always split any cell holding two run-together amounts first, before
    // even looking at the row's overall length — a real column should
    // never contain two decimal amounts joined by whitespace. Checking
    // length first would miss this whenever a hidden empty cell elsewhere
    // in the same row happens to cancel it out by count (row already
    // "matches" the header length even though it's wrong in two places).
    for (let j = 0; j < rows[i].length; j++) {
      const m = moneyPairRe.exec(String(rows[i][j] || '').trim());
      if (m) { rows[i].splice(j, 1, m[1], m[2]); break; }
    }
    // Then reconcile any remaining excess length by dropping the confirmed
    // phantom column identified above, if this row actually has a blank
    // cell there. Only fall back to "first empty cell in this row" when no
    // consistent phantom column could be identified across all over-length
    // rows — that fallback is an unconfirmed guess, so it's a last resort,
    // not the default path.
    while (rows[i].length > headerLen) {
      let emptyIdx = -1;
      if (phantomCol !== -1 && phantomCol < rows[i].length && !String(rows[i][phantomCol] ?? '').trim()) {
        emptyIdx = phantomCol;
      } else {
        emptyIdx = rows[i].findIndex(c => !String(c ?? '').trim());
      }
      if (emptyIdx === -1) break;
      rows[i].splice(emptyIdx, 1);
    }
    // A row SHORTER than the header (the mirror image of the excess-length
    // case above) means some cell is carrying more than one column's worth
    // of text glued together — e.g. a "Product" cell whose source <td> also
    // rendered Unit Price and Total Sales as inner children with no
    // separator, so it reads as "Solar Panel 18,500 2,22,000" instead of
    // three cells. Find the cell missing the most trailing numeric tokens
    // it needs to supply and peel them off the end, one per missing
    // column, until the row lines up with the header.
    if (rows[i].length < headerLen) {
      let deficit = headerLen - rows[i].length;
      let bestIdx = -1, bestSplit = null;
      for (let j = 0; j < rows[i].length; j++) {
        const split = pdfedSplitTrailingNumbers(rows[i][j], deficit);
        if (split && (!bestSplit || split.length > bestSplit.length)) { bestIdx = j; bestSplit = split; }
      }
      if (bestIdx !== -1) rows[i].splice(bestIdx, 1, ...bestSplit);
    }
  }

  if (!pdfedGridLooksLikeRealTable(rows)) return null;
  return rows;
}

// Sanity-checks a parsed clipboard grid before we commit to rendering it as
// a table. Word/Outlook/Google Docs and plenty of websites routinely wrap
// plain paragraphs in a <table> purely for layout (indentation, spacer
// columns, a bullet glyph living in its own cell) — the mere presence of a
// <table> tag in the clipboard HTML, which is all the caller checked
// before reaching here, isn't proof the person actually copied tabular
// data. This catches the two shapes that were fooling that check and
// turning an ordinary paragraph paste into a table:
//   - spacer columns that are blank in every single row, which collapse
//     the "real" content down to one column once ignored
//   - one cell holding a long run of prose (several sentences) that makes
//     up almost all the text on the clipboard, with the other cell(s) just
//     a bullet, a number, or blank padding around it
// Either shape means what got copied was really a paragraph, not a table,
// so the caller falls back to placing it as a normal text box instead.
function pdfedGridLooksLikeRealTable(rows) {
  if (!rows || !rows.length) return false;
  const maxCols = Math.max(...rows.map(r => r.length));
  if (maxCols < 2) return false;

  const realCols = [];
  for (let c = 0; c < maxCols; c++) {
    if (rows.some(r => String(r[c] ?? '').trim())) realCols.push(c);
  }
  if (realCols.length < 2) return false;

  const allText = [];
  rows.forEach(r => realCols.forEach(c => {
    const t = String(r[c] ?? '').trim();
    if (t) allText.push(t);
  }));
  if (!allText.length) return false;
  const totalLen = allText.reduce((s, t) => s + t.length, 0);
  const longest = allText.reduce((a, b) => a.length > b.length ? a : b);
  const sentenceEnders = (longest.match(/[.!?]\s/g) || []).length;
  if (longest.length > 120 && longest.length > totalLen * 0.7 && sentenceEnders >= 2) return false;

  return true;
}

// Builds a new placed table from parsed clipboard rows, same shape as
// pdfedInsertTable's own item model, sized/positioned to be centered on
// `cx,cy` and ready to drag/type into immediately, exactly like a table
// added from the toolbar.
function pdfedPasteTableFromRows(rowsData, cx, cy) {
  const idx = pdfed.active;
  const pg = pdfed.pages[idx];
  if (!pg) return;
  if (!pg.placedTables) pg.placedTables = [];
  const rows = Math.max(1, Math.min(60, rowsData.length));
  const cols = Math.max(1, Math.min(20, rowsData.reduce((m, r) => Math.max(m, r.length), 1)));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push((rowsData[r][c] || '').toString());
    cells.push(row);
  }
  const pc = document.getElementById('pdfedPageCanvas');
  const pageW = (pc && pc.width) || 600;
  const colW = Math.max(60, Math.min(140, Math.floor((pageW * 0.8) / cols)));
  const rowH = 30;
  const w = colW * cols, h = rowH * rows;
  const item = {
    id: 'tbl_' + (++pdfedTableSeq),
    x: Math.round(cx - w / 2), y: Math.round(cy - h / 2),
    rows, cols,
    colWidths: new Array(cols).fill(colW),
    rowHeights: new Array(rows).fill(rowH),
    fontSize: 12,
    headerRow: false,
    cells,
    locked: false,
    zIndex: pdfedNextZ(pg)
  };
  pg.placedTables.push(item);
  pdfedMarkModified(idx);
  pdfedRenderPlacedTables(idx);
  toast(`${rows} x ${cols} table pasted, drag to move, click a cell to type`, 'success');
}


// Click/tap anywhere outside a placed-text box (or its floating toolbar) —
// blank canvas, another element, the sidebar, another tool, deselects it.
document.addEventListener('mousedown', function(e) {
  if (!pdfedPtxtTb.item && !pdfedHasMultiSelection()) return;
  if (e.target.closest('.pdfed-placed-text, .pdfed-placed-img, .pdfed-placed-table')) return; // let that box's own handler manage selection
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (tb && tb.contains(e.target)) return;
  // The Insert/Manage Link modal isn't part of the toolbar DOM-wise, but a
  // click on its Insert/Link Selection/Apply buttons must not clear the
  // selection either — mousedown fires before that button's own click, so
  // without this the link modal would wipe pdfedPtxtTb the instant you hit
  // Insert, and the link would silently never get applied.
  if (e.target.closest('#pdfedLinkModal')) return;
  // Ribbon alignment buttons act ON the current selection, so clicking them
  // must not clear it first (mousedown fires before the button's own click).
  if (e.target.closest('#pdfedRbnAlignLeftBtn, #pdfedRbnAlignCenterBtn, #pdfedRbnAlignRightBtn, #pdfedRbnSelectAllBtn')) return;
  // Same reasoning for the Design panel: Apply Fade / preset buttons / the
  // strength slider / Merge at Shared Edge all act ON the current image
  // selection (Cinematic Merge specifically needs its 2 selected images to
  // still be selected when its own button is clicked), so this must not
  // clear the selection first.
  if (e.target.closest('#pdfedRightPanel')) return;
  pdfedDeselectAllPlacedTexts();
});

// ── Canva-style click-and-drag marquee (rubber-band) selection ──
// Click empty page space — not on a placed box, the floating toolbar, crop
// handles, or while another tool (draw/highlight/shapes/image-insert) is
// active — and drag: draws a translucent rectangle and, on release, selects
// every placed text box / image / table whose on-screen box overlaps it,
// just like Canva/PowerPoint/Figma marquee select. A plain click with no
// real drag is left alone, so it still just deselects everything as before.
(function pdfedInitMarqueeSelect() {
  let active = false, moved = false;
  let startClientX = 0, startClientY = 0;
  let wrapEl = null, boxEl = null;

  function isBlocked(wrap) {
    if (/\bannot-mode-\w+/.test(wrap.className)) return true; // draw/highlight/shape/eraser/etc tool active
    const crop = document.getElementById('pdfedCropBox');
    if (crop && crop.classList.contains('active')) return true;
    const hl = document.getElementById('pdfedTextHlLayer');
    if (hl && hl.classList.contains('active')) return true;
    if (typeof pdfedAnnotState !== 'undefined' && pdfedAnnotState.imgInsertActive) return true;
    return false;
  }

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    const wrap = document.getElementById('pdfedCanvasWrap');
    if (!wrap || wrap.style.display === 'none') return;
    // Only a bare click on the page canvas itself (or the wrap's own
    // background) counts as "empty space" — every other overlay (placed
    // boxes, toolbars, crop handles, drawing layers) sits on top with its
    // own pointer-events and would be the real e.target whenever active.
    if (e.target !== wrap && e.target.id !== 'pdfedPageCanvas') return;
    if (isBlocked(wrap)) return;

    active = true; moved = false;
    wrapEl = wrap;
    boxEl = document.getElementById('pdfedMarqueeBox');
    if (!boxEl) { active = false; return; }
    const r = wrap.getBoundingClientRect();
    startClientX = e.clientX; startClientY = e.clientY;
    boxEl.style.left = (startClientX - r.left) + 'px';
    boxEl.style.top = (startClientY - r.top) + 'px';
    boxEl.style.width = '0px';
    boxEl.style.height = '0px';
  });

  document.addEventListener('mousemove', function(e) {
    if (!active || !wrapEl || !boxEl) return;
    const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const r = wrapEl.getBoundingClientRect();
    const x1 = Math.min(startClientX, e.clientX), x2 = Math.max(startClientX, e.clientX);
    const y1 = Math.min(startClientY, e.clientY), y2 = Math.max(startClientY, e.clientY);
    boxEl.style.display = 'block';
    boxEl.style.left = (x1 - r.left) + 'px';
    boxEl.style.top = (y1 - r.top) + 'px';
    boxEl.style.width = (x2 - x1) + 'px';
    boxEl.style.height = (y2 - y1) + 'px';
  });

  document.addEventListener('mouseup', function(e) {
    if (!active) return;
    active = false;
    if (boxEl) boxEl.style.display = 'none';
    const didMove = moved;
    const sx = startClientX, sy = startClientY;
    wrapEl = null; boxEl = null;
    if (!didMove) return;
    pdfedApplyMarqueeSelection({
      left: Math.min(sx, e.clientX), right: Math.max(sx, e.clientX),
      top: Math.min(sy, e.clientY), bottom: Math.max(sy, e.clientY)
    });
  });
})();

function pdfedRectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Selects every placed text/image/table box on the current page whose
// screen rect overlaps the dragged marquee rect. Both rects are compared in
// client/viewport coordinates via getBoundingClientRect(), so this works
// correctly no matter the current zoom level without any extra math.
function pdfedApplyMarqueeSelection(marqueeRect) {
  pdfedSelected = new Set();
  pdfedSelectedImgs = new Set();
  pdfedSelectedTables = new Set();

  const collect = (selector, set) => {
    document.querySelectorAll(selector).forEach(n => {
      if (pdfedRectsIntersect(marqueeRect, n.getBoundingClientRect())) {
        set.add(n.dataset.id);
        n.classList.add('selected');
      } else {
        n.classList.remove('selected');
      }
    });
  };
  collect('#pdfedPlacedTextsLayer .pdfed-placed-text', pdfedSelected);
  collect('#pdfedPlacedImagesLayer .pdfed-placed-img', pdfedSelectedImgs);
  collect('#pdfedPlacedTablesLayer .pdfed-placed-table', pdfedSelectedTables);

  // Multi-selecting always shows the shared toolbar/alignment state, never
  // the single-item font/color toolbar (it can't edit many boxes at once).
  pdfedPtxtTb.item = null; pdfedPtxtTb.idx = -1; pdfedPtxtTb.content = null; pdfedPtxtTb.el = null;
  const tb = document.getElementById('pdfedPtxtToolbar');
  if (tb) tb.style.display = 'none';

  const total = pdfedSelected.size + pdfedSelectedImgs.size + pdfedSelectedTables.size;
  if (total) toast('Selected ' + total + (total === 1 ? ' item' : ' items'), 'info');
}

function pdfedPtxtSetFont(value) {
  const { item, idx, content } = pdfedPtxtTb;
  if (!item) return;
  sarvarcLoadFont(value);
  item.fontFamily = value;
  if (content) content.style.fontFamily = pdfedFontCss(value);
  const fb = document.getElementById('pdfedPtxtFontBtn');
  if (fb) fb.textContent = value.split(',')[0].replace(/['"]/g, '');
  pdfedMarkModified(idx);
}

function pdfedPtxtSetSize(value) {
  const { item, idx, content, el } = pdfedPtxtTb;
  if (!item) return;
  const v = Math.max(6, Math.min(300, parseInt(value, 10) || item.fontSize));
  item.fontSize = v;
  // Use the raw canvas-px value directly, matching every other place that
  // sets this style (initial render, drag-resize handles). The whole
  // placed-text layer is already scaled once as a unit for zoom via a CSS
  // transform (pdfedSyncPlacedTextsZoom), so multiplying by displayScale
  // here on top of that was double-scaling the live preview — the text
  // looked one size while editing, then visibly jumped bigger the moment
  // the box was deselected or locked and re-rendered at the true size.
  if (content) content.style.fontSize = v + 'px';
  if (el) pdfedPositionPtxtToolbar();
  pdfedMarkModified(idx);
}

function pdfedPtxtSetOpacity(value) {
  const { item, idx, content } = pdfedPtxtTb;
  if (!item) return;
  const v = Math.max(0.1, Math.min(1, parseInt(value, 10) / 100));
  item.opacity = v;
  if (content) content.style.opacity = v;
  const opacityVal = document.getElementById('pdfedPtxtOpacityVal');
  if (opacityVal) opacityVal.textContent = Math.round(v * 100) + '%';
  pdfedMarkModified(idx);
}

// Attaches, edits, or removes a hyperlink on the currently focused text box.
// If the user has actually highlighted some text first, that's a much
// stronger signal than "manage the whole box" — Word/Canva both treat a
// selection + the link button as "link just this", so that takes priority.
// With nothing highlighted, falls back to the smart Manage Link modal:
// auto-detects any http(s)/www/bare-domain URLs already typed in the
// paragraph and offers to turn them into real clickable links (individually,
// via checkboxes), plus a manual field to link the whole box.
function pdfedPtxtEditLink() {
  if (!pdfedPtxtTb.item) return;
  const content = pdfedPtxtTb.content;
  const sel = window.getSelection();
  if (content && sel && sel.rangeCount && !sel.isCollapsed &&
      content.contains(sel.anchorNode) && content.contains(sel.focusNode)) {
    const text = sel.toString();
    if (text.trim()) {
      // Clone the range now — opening the modal moves focus to the URL
      // input, which collapses the live selection, so we need our own copy
      // to restore and act on when the user hits "Link Selection".
      const range = sel.getRangeAt(0).cloneRange();
      pdfedOpenLinkModal('selection', { range, text });
      return;
    }
  }
  pdfedOpenLinkModal('edit');
}

function pdfedPtxtToggleStyle(prop) {
  const { item, idx, content } = pdfedPtxtTb;
  if (!item) return;
  item[prop] = !item[prop];
  if (content) {
    if (prop === 'bold') content.style.fontWeight = item.bold ? '700' : '400';
    if (prop === 'italic') content.style.fontStyle = item.italic ? 'italic' : 'normal';
    if (prop === 'underline') content.style.textDecoration = item.underline ? 'underline' : 'none';
  }
  const btnMap = { bold: 'pdfedPtxtBoldBtn', italic: 'pdfedPtxtItalicBtn', underline: 'pdfedPtxtUnderlineBtn' };
  const btn = document.getElementById(btnMap[prop]);
  if (btn) btn.classList.toggle('active', !!item[prop]);
  pdfedMarkModified(idx);
}

// Toggles a bulleted list on the selected placed-text box. Uses the browser's
// native list command so existing multi-line / multi-color selections split
// into bullets exactly where a real editor would, and typing/Enter/Backspace
// inside the list keeps working the normal way afterward.
function pdfedPtxtToggleBullet() {
  const { item, idx, content, el } = pdfedPtxtTb;
  if (!item || !content) { toast('Select a text box on the page first', 'info'); return; }
  content.focus();
  const sel = window.getSelection();
  // With nothing selected (cursor just parked in the box), apply the toggle
  // to the whole box's text, that's the expected "make this box a list" behavior.
  if (!sel.rangeCount || sel.isCollapsed || !content.contains(sel.anchorNode)) {
    pdfedSelectAllText(content);
  }
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('insertUnorderedList', false, null);
  item.bullet = !!content.querySelector('ul');
  item.html = content.innerHTML;
  item.text = content.innerText || content.textContent || '';
  const btn = document.getElementById('pdfedPtxtBulletBtn');
  if (btn) btn.classList.toggle('active', item.bullet);
  pdfedMarkModified(idx);
  if (el) pdfedPositionPtxtToolbar();
}

// Syncs both the floating per-box toolbar's align buttons and the always-visible
// ribbon align buttons (Edit group) to whichever placed-text box is selected.
function pdfedUpdatePtxtAlignButtons(item) {
  const align = (item && item.align) || 'left';
  const map = {
    left:   ['pdfedPtxtAlignLeftBtn',   'pdfedRbnAlignLeftBtn'],
    center: ['pdfedPtxtAlignCenterBtn', 'pdfedRbnAlignCenterBtn'],
    right:  ['pdfedPtxtAlignRightBtn',  'pdfedRbnAlignRightBtn']
  };
  Object.keys(map).forEach(key => {
    map[key].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', key === align);
    });
  });
}

function pdfedPtxtSetAlign(align) {
  if (pdfedSelected.size >= 2) {
    const idx = (typeof pdfed !== 'undefined') ? pdfed.active : -1;
    const pg = (idx >= 0 && pdfed.pages) ? pdfed.pages[idx] : null;
    const list = (pg && pg.placedTexts) || [];
    const pc = document.getElementById('pdfedPageCanvas');
    const pageW = pc && pc.width ? pc.width : 0;
    const margin = 16;
    list.filter(t => pdfedSelected.has(t.id)).forEach(item => {
      item.align = align;
      const el = document.querySelector('.pdfed-placed-text[data-id="' + item.id + '"]');
      const content = el && el.querySelector('.pdfed-ptxt-content');
      if (content) content.style.textAlign = align;
      const w = el ? el.offsetWidth : 0;
      if (pageW && el) {
        let newX = item.x;
        if (align === 'left') newX = margin;
        else if (align === 'center') newX = Math.round((pageW - w) / 2);
        else if (align === 'right') newX = pageW - w - margin;
        item.x = Math.max(0, newX);
        pdfedPositionPlacedTextEl(el, item);
      }
    });
    pdfedUpdatePtxtAlignButtons({ align });
    if (idx >= 0) pdfedMarkModified(idx);
    return;
  }
  const { item, idx, content, el } = pdfedPtxtTb;
  if (!item) {
    toast('Select a text box on the page first', 'info');
    return;
  }
  item.align = align;
  if (content) content.style.textAlign = align;

  // Canva-style: alignment repositions the whole box relative to the page
  // width, not just the text within a shrink-wrapped box (which has no
  // visible effect for single-line labels, the overwhelmingly common case).
  const pc = document.getElementById('pdfedPageCanvas');
  const pageW = pc && pc.width ? pc.width : 0;
  const margin = 16;
  const w = el ? el.offsetWidth : 0;
  if (pageW && el) {
    let newX = item.x;
    if (align === 'left') newX = margin;
    else if (align === 'center') newX = Math.round((pageW - w) / 2);
    else if (align === 'right') newX = pageW - w - margin;
    item.x = Math.max(0, newX);
    pdfedPositionPlacedTextEl(el, item);
    pdfedPositionPtxtToolbar();
  }

  pdfedUpdatePtxtAlignButtons(item);
  pdfedMarkModified(idx);
}

// Converts any CSS color (named, rgb(), hex) to a #rrggbb string for the native
// <input type=color> swatch, which only accepts that exact format.
function pdfedToHexColor(c) {
  if (!c) return '#ffffff';
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    const toHex = n => ('0' + parseInt(n, 10).toString(16)).slice(-2);
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }
  const tmp = document.createElement('div');
  tmp.style.color = c;
  document.body.appendChild(tmp);
  const computed = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m2 = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m2) {
    const toHex = n => ('0' + parseInt(n, 10).toString(16)).slice(-2);
    return '#' + toHex(m2[1]) + toHex(m2[2]) + toHex(m2[3]);
  }
  return '#ffffff';
}

// Captures the user's current text selection inside the placed-text box BEFORE
// the native color-swatch input steals focus (which would otherwise collapse it).
function pdfedPtxtCaptureSelection(e) {
  e.stopPropagation();
  const { content } = pdfedPtxtTb;
  const sel = window.getSelection();
  if (content && sel.rangeCount > 0 && !sel.isCollapsed && content.contains(sel.anchorNode) && content.contains(sel.focusNode)) {
    pdfedPtxtTb._savedRange = sel.getRangeAt(0).cloneRange();
  } else {
    pdfedPtxtTb._savedRange = null;
  }
}

// Applies a color: if text was selected, ONLY that selection is recolored
// (via a styled <span>, like a real rich-text editor); with no selection, it
// sets the whole box's base/default color instead (legacy single-color mode).
function pdfedPtxtApplyColor(hex) {
  const { item, idx, content } = pdfedPtxtTb;
  if (!item || !content) return;
  const savedRange = pdfedPtxtTb._savedRange;
  if (savedRange && !savedRange.collapsed) {
    content.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, hex);
    item.html = content.innerHTML;
    item.text = content.innerText || content.textContent || '';
    if (sel.rangeCount > 0) pdfedPtxtTb._savedRange = sel.getRangeAt(0).cloneRange();
  } else {
    item.color = hex;
    // Picking a plain solid color is a deliberate override of any gradient
    // fill this box may have had — clear it so the two controls don't fight
    // (the gradient popover's own "Remove gradient" button does the same).
    if (item.gradient) { item.gradient = null; pdfedApplyPtxtGradientDom(content, null); }
    content.style.color = hex;
    if (item.html) {
      // Re-sync html/text in case the box already had rich spans, so the
      // un-spanned (default-colored) runs visually pick up the new base color.
      item.html = content.innerHTML;
    }
  }
  pdfedMarkModified(idx);
}

// ── Text gradient fill ──────────────────────────────────────────────────
// A placed-text box's fill can be a flat color (item.color, handled above)
// OR a two-stop gradient (item.gradient = {color1,color2,angle}), applied to
// the WHOLE box rather than a partial selection — same "whole object" scope
// as the existing Canvas recolor/gradient panel, just applied to a text
// box's glyphs instead of the page's pixels. On screen this is a plain CSS
// background-clip:text trick; at export time pdfedDrawPlacedTextsOnCtx below
// builds the equivalent canvas gradient with the shared pdfedGradientLine()
// helper so the baked PNG/PDF/DOCX matches exactly what was on screen.
const pdfedPtxtGradState = { angle: 90, item: null, idx: -1, content: null };

function pdfedPtxtGradCss(color1, color2, angle) {
  return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
}

// Applies (or clears, when gradient is null) the live on-screen gradient
// style directly to a placed-text box's editable content element.
function pdfedApplyPtxtGradientDom(content, gradient) {
  if (!content) return;
  if (gradient) {
    content.style.backgroundImage = pdfedPtxtGradCss(gradient.color1, gradient.color2, gradient.angle);
    content.style.webkitBackgroundClip = 'text';
    content.style.backgroundClip = 'text';
    content.style.color = 'transparent';
    content.style.webkitTextFillColor = 'transparent';
  } else {
    content.style.backgroundImage = '';
    content.style.webkitBackgroundClip = '';
    content.style.backgroundClip = '';
    content.style.webkitTextFillColor = '';
    // color gets restored by the caller (it knows the box's item.color)
  }
}

function pdfedOpenPtxtGradientPopover(ev) {
  ev.stopPropagation();
  const { item } = pdfedPtxtTb;
  if (!item) return;
  const pop = document.getElementById('pdfedPtxtGradPopover');
  const btn = document.getElementById('pdfedPtxtGradientBtn');
  if (!pop || !btn) return;
  const g = item.gradient || { color1: '#00C2FF', color2: '#7C3AED', angle: pdfedPtxtGradState.angle };
  pdfedPtxtGradState.angle = g.angle;
  pdfedPtxtGradState.item = item;
  pdfedPtxtGradState.idx = pdfedPtxtTb.idx;
  pdfedPtxtGradState.content = pdfedPtxtTb.content;
  document.getElementById('pdfedPtxtGradFromInput').value = pdfedToHexColor(g.color1);
  document.getElementById('pdfedPtxtGradToInput').value = pdfedToHexColor(g.color2);
  const slider = document.getElementById('pdfedPtxtGradAngleSlider');
  if (slider) slider.value = g.angle;
  pdfedPtxtGradRefreshPreview();
  const rect = btn.getBoundingClientRect();
  const popW = 190;
  let left = rect.left + rect.width / 2 - popW / 2;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (left < 8) left = 8;
  let top = rect.bottom + 8;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.classList.add('show');
}

function pdfedCloseGradientPopover() {
  const pop = document.getElementById('pdfedPtxtGradPopover');
  if (pop) pop.classList.remove('show');
  pdfedPtxtGradState.item = null; pdfedPtxtGradState.idx = -1; pdfedPtxtGradState.content = null;
}

function pdfedPtxtGradRefreshPreview() {
  const preview = document.getElementById('pdfedPtxtGradPreview');
  const c1 = document.getElementById('pdfedPtxtGradFromInput').value;
  const c2 = document.getElementById('pdfedPtxtGradToInput').value;
  const angle = pdfedPtxtGradState.angle;
  if (preview) preview.style.background = pdfedPtxtGradCss(c1, c2, angle);
  const label = document.getElementById('pdfedPtxtGradAngleVal');
  if (label) label.textContent = Math.round(angle);
  const slider = document.getElementById('pdfedPtxtGradAngleSlider');
  if (slider && Number(slider.value) !== angle) slider.value = angle;
  // Presets (→ ↓ ↘ ↙) light up only when the angle matches one exactly —
  // dragging the slider to some in-between value simply leaves all four
  // unlit, same "free choice vs. quick preset" pattern as the Canvas panel.
  document.querySelectorAll('.pdfed-ptxt-grad-angles button').forEach(b => b.classList.remove('active'));
  const presetMap = { 90: 0, 180: 1, 135: 2, 45: 3 };
  const btns = document.querySelectorAll('.pdfed-ptxt-grad-angles button');
  if (presetMap[angle] != null && btns[presetMap[angle]]) btns[presetMap[angle]].classList.add('active');
}

function pdfedSetPtxtGradientAngle(deg) {
  pdfedPtxtGradState.angle = Math.max(0, Math.min(360, parseInt(deg, 10) || 0));
  pdfedPtxtGradRefreshPreview();
  pdfedApplyPtxtGradient();
}

// Reads the two color pickers + current angle, writes them onto the
// currently-selected placed-text box, and updates both the on-screen box
// and the toolbar's own gradient button (active state) immediately.
function pdfedApplyPtxtGradient() {
  const item = pdfedPtxtGradState.item || pdfedPtxtTb.item;
  const idx = (pdfedPtxtGradState.item ? pdfedPtxtGradState.idx : pdfedPtxtTb.idx);
  const content = pdfedPtxtGradState.content || pdfedPtxtTb.content;
  if (!item || !content) return;
  const color1 = document.getElementById('pdfedPtxtGradFromInput').value;
  const color2 = document.getElementById('pdfedPtxtGradToInput').value;
  const angle = pdfedPtxtGradState.angle;
  item.gradient = { color1, color2, angle };
  pdfedApplyPtxtGradientDom(content, item.gradient);
  const gradBtn = document.getElementById('pdfedPtxtGradientBtn');
  if (gradBtn) gradBtn.classList.add('active');
  pdfedPtxtGradRefreshPreview();
  pdfedMarkModified(idx);
}

function pdfedRemovePtxtGradient() {
  const item = pdfedPtxtGradState.item || pdfedPtxtTb.item;
  const idx = (pdfedPtxtGradState.item ? pdfedPtxtGradState.idx : pdfedPtxtTb.idx);
  const content = pdfedPtxtGradState.content || pdfedPtxtTb.content;
  if (item) {
    item.gradient = null;
    if (content) {
      pdfedApplyPtxtGradientDom(content, null);
      content.style.color = item.color || '#ffffff';
    }
    pdfedMarkModified(idx);
  }
  const gradBtn = document.getElementById('pdfedPtxtGradientBtn');
  if (gradBtn) gradBtn.classList.remove('active');
  pdfedCloseGradientPopover();
}

// Click anywhere outside the gradient popover (or its trigger button) closes it.
document.addEventListener('mousedown', (e) => {
  const pop = document.getElementById('pdfedPtxtGradPopover');
  if (!pop || !pop.classList.contains('show')) return;
  if (e.target.closest('#pdfedPtxtGradPopover') || e.target.closest('#pdfedPtxtGradientBtn')) return;
  pdfedCloseGradientPopover();
});
