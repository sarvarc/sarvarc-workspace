// ─── PDF EDITOR: GRAPHICS (SVG art), SHAPE FILL AND GRADIENT ────────────────
// One small panel ("Graphics" in the ribbon):
//   1. Fill for shapes: None / Solid / Gradient (+ angle, outline on/off).
//      Applies to new shapes and to the shape that is currently selected.
//   2. Built-in art library (original, drawn in code). Pick art, it takes the
//      current Colour 1 / Colour 2 / gradient, and is placed as a normal image
//      object (move, resize, rotate, opacity, lock, export all just work).
//   3. Upload your own SVG (cleaned first: scripts and outside links removed).
// Art is rasterised to a sharp PNG (up to 1400 px) when placed.

(function () {
  const gfx = { mode: 'none', c1: '#FF6B35', c2: '#7C3AED', angle: 45, outline: true, brand: true };
  window.pdfedGfx = gfx;

  function starPts(n, r1, r2, cx, cy) {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r2 : r1;
      p.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1));
    }
    return p.join(' ');
  }
  const petals = [0, 60, 120, 180, 240, 300].map(function (a) {
    return '<ellipse cx="50" cy="28" rx="11" ry="20" fill="{A}" opacity=".92" transform="rotate(' + a + ' 50 50)"/>';
  }).join('');

  // Tokens: {A} main colour or gradient, {B} second colour, {S} skin, {D} dark, {W} white
  const ART = [
    { cat: 'People', id: 'dancing-woman', name: 'Dancing woman', vb: '0 0 100 120', svg:
      '<g stroke-linecap="round" stroke-linejoin="round" fill="none">' +
      '<path d="M56 33 C66 28 72 18 75 8" stroke="{S}" stroke-width="5"/>' +
      '<path d="M44 33 C34 37 26 45 19 49" stroke="{S}" stroke-width="5"/>' +
      '<path d="M46 80 L43 108" stroke="{S}" stroke-width="5"/>' +
      '<path d="M55 80 C61 91 70 95 76 103" stroke="{S}" stroke-width="5"/></g>' +
      '<circle cx="50" cy="21" r="9" fill="{S}"/>' +
      '<path d="M40 19 C39 8 61 7 60 19 C57 13 44 13 40 19Z" fill="{D}"/>' +
      '<path d="M59 15 C73 11 78 25 70 32 C71 23 65 20 59 20Z" fill="{D}"/>' +
      '<path d="M44 30 L56 30 L58 50 L42 50Z" fill="{A}"/>' +
      '<path d="M42 50 L58 50 C70 62 80 70 88 76 C70 84 30 84 12 76 C20 70 30 62 42 50Z" fill="{A}"/>' +
      '<path d="M12 76 C30 84 70 84 88 76 L90 81 C70 90 30 90 10 81Z" fill="{B}"/>' +
      '<ellipse cx="42" cy="110" rx="5" ry="2.5" fill="{B}"/>' +
      '<ellipse cx="77" cy="105" rx="5" ry="2.5" fill="{B}" transform="rotate(30 77 105)"/>' },
    { cat: 'People', id: 'dancing-man', name: 'Dancing man', vb: '0 0 100 120', svg:
      '<g stroke-linecap="round" stroke-linejoin="round" fill="none">' +
      '<path d="M58 34 C68 28 76 20 80 10" stroke="{S}" stroke-width="5"/>' +
      '<path d="M42 34 C36 46 34 56 38 64" stroke="{S}" stroke-width="5"/>' +
      '<path d="M45 70 L34 96 L28 110" stroke="{D}" stroke-width="8"/>' +
      '<path d="M55 70 L61 92 L59 110" stroke="{D}" stroke-width="8"/></g>' +
      '<circle cx="50" cy="21" r="9" fill="{S}"/>' +
      '<path d="M40 20 C38 8 62 8 60 20 C56 14 44 14 40 20Z" fill="{D}"/>' +
      '<path d="M42 30 L58 30 L60 68 L40 68Z" fill="{A}"/>' +
      '<rect x="40" y="64" width="20" height="9" rx="2" fill="{D}"/>' +
      '<ellipse cx="25" cy="112" rx="7" ry="3" fill="{B}"/><ellipse cx="60" cy="112" rx="7" ry="3" fill="{B}"/>' },
    { cat: 'Social', id: 'instagram', name: 'Instagram', vb: '0 0 100 100', brand: 'ig', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><rect x="24" y="24" width="52" height="52" rx="15" fill="none" stroke="{W}" stroke-width="6"/><circle cx="50" cy="50" r="12" fill="none" stroke="{W}" stroke-width="6"/><circle cx="66" cy="34" r="3.8" fill="{W}"/>' },
    { cat: 'Social', id: 'facebook', name: 'Facebook', vb: '0 0 100 100', brand: '#1877F2', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M54 82 V54 H64 L66 43 H54 V37 C54 33 56 31 60 31 H67 V21 C65 21 61 20 57 20 C48 20 43 26 43 35 V43 H34 V54 H43 V82Z" fill="{W}"/>' },
    { cat: 'Social', id: 'linkedin', name: 'LinkedIn', vb: '0 0 100 100', brand: '#0A66C2', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><circle cx="32" cy="29" r="6" fill="{W}"/><rect x="26.5" y="40" width="11" height="36" fill="{W}"/><path d="M44 40 H54.5 V45 C57 41 61 39 66 39 C75 39 79 44 79 54 V76 H68 V56 C68 51 66 49 62 49 C58 49 55 52 55 57 V76 H44Z" fill="{W}"/>' },
    { cat: 'Social', id: 'x', name: 'X', vb: '0 0 100 100', brand: '#000000', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M28 26 L72 74" stroke="{W}" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M71 26 L29 74" stroke="{W}" stroke-width="4" stroke-linecap="round" fill="none"/>' },
    { cat: 'Social', id: 'youtube', name: 'YouTube', vb: '0 0 100 100', brand: '#FF0000', svg:
      '<rect x="4" y="22" width="92" height="56" rx="18" fill="{A}"/><path d="M42 36 L66 50 L42 64Z" fill="{W}"/>' },
    { cat: 'Social', id: 'whatsapp', name: 'WhatsApp', vb: '0 0 100 100', brand: '#25D366', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M50 20 C33 20 20 33 20 50 C20 56 22 61 24 66 L20 80 L35 76 C39 78 44 80 50 80 C67 80 80 67 80 50 C80 33 67 20 50 20Z" fill="none" stroke="{W}" stroke-width="5" stroke-linejoin="round"/><path d="M40 38 C38 42 41 49 47 55 C53 61 59 63 62 61 L64 57 L58 53 L55 55 C52 54 47 50 45 46 L47 43 L43 36Z" fill="{W}"/>' },
    { cat: 'Social', id: 'telegram', name: 'Telegram', vb: '0 0 100 100', brand: '#229ED9', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M22 49 L76 28 C79 27 81 29 80 32 L71 72 C70 75 68 76 65 74 L52 65 L45 72 C44 73 43 73 43 71 L44 61 L68 40 L36 57 L24 53 C21 52 21 50 22 49Z" fill="{W}"/>' },
    { cat: 'Contact', id: 'email', name: 'Email', vb: '0 0 100 100', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><rect x="22" y="30" width="56" height="40" rx="6" fill="none" stroke="{W}" stroke-width="5"/><path d="M24 34 L50 55 L76 34" stroke="{W}" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>' },
    { cat: 'Contact', id: 'phone', name: 'Phone', vb: '0 0 100 100', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M34 24 L44 24 L48 38 L42 44 C46 54 52 60 62 64 L68 58 L80 62 L80 72 C80 76 77 78 74 78 C49 76 24 51 22 26 C22 25 24 24 26 24Z" fill="{W}"/>' },
    { cat: 'Contact', id: 'website', name: 'Website', vb: '0 0 100 100', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><circle cx="50" cy="50" r="26" fill="none" stroke="{W}" stroke-width="5"/><ellipse cx="50" cy="50" rx="11" ry="26" fill="none" stroke="{W}" stroke-width="4"/><path d="M24 50 H76" stroke="{W}" stroke-width="4"/>' },
    { cat: 'Contact', id: 'location', name: 'Location', vb: '0 0 100 100', svg:
      '<rect x="4" y="4" width="92" height="92" rx="22" fill="{A}"/><path d="M50 20 C38 20 30 29 30 40 C30 55 50 80 50 80 C50 80 70 55 70 40 C70 29 62 20 50 20Z" fill="{W}"/><circle cx="50" cy="40" r="8" fill="{A}"/>' },
    { cat: 'Shapes', id: 'heart', name: 'Heart', vb: '0 0 100 100', svg:
      '<path d="M50 88 C10 58 6 30 26 20 C38 14 48 22 50 30 C52 22 62 14 74 20 C94 30 90 58 50 88Z" fill="{A}"/>' +
      '<path d="M24 34 C26 28 32 25 37 27" stroke="{W}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/>' },
    { cat: 'Shapes', id: 'starburst', name: 'Starburst', vb: '0 0 100 100', svg:
      '<polygon points="' + starPts(14, 48, 38, 50, 50) + '" fill="{A}"/>' +
      '<circle cx="50" cy="50" r="28" fill="none" stroke="{W}" stroke-width="3" stroke-dasharray="3 4"/>' +
      '<circle cx="50" cy="50" r="20" fill="{B}"/>' },
    { cat: 'Shapes', id: 'check-badge', name: 'Check badge', vb: '0 0 100 100', svg:
      '<polygon points="' + starPts(12, 48, 40, 50, 50) + '" fill="{A}"/>' +
      '<circle cx="50" cy="50" r="30" fill="{B}"/>' +
      '<path d="M36 51 L46 61 L66 39" stroke="{W}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    { cat: 'Shapes', id: 'blob', name: 'Blob', vb: '0 0 100 100', svg:
      '<path d="M62 8 C82 12 96 34 90 56 C84 78 62 94 40 90 C18 86 6 64 12 42 C18 20 42 4 62 8Z" fill="{A}"/>' },
    { cat: 'Shapes', id: 'waves', name: 'Waves', vb: '0 0 200 100', svg:
      '<path d="M0 50 C30 20 60 20 100 50 C140 80 170 80 200 50 L200 100 L0 100Z" fill="{A}"/>' +
      '<path d="M0 72 C30 47 70 47 100 72 C130 97 170 97 200 72 L200 100 L0 100Z" fill="{B}" opacity=".85"/>' },
    { cat: 'Shapes', id: 'ribbon', name: 'Ribbon banner', vb: '0 0 140 60', svg:
      '<path d="M0 10 H28 L36 30 L28 50 H0 L8 30Z" fill="{B}"/>' +
      '<path d="M140 10 H112 L104 30 L112 50 H140 L132 30Z" fill="{B}"/>' +
      '<rect x="24" y="4" width="92" height="44" fill="{A}"/>' },
    { cat: 'Shapes', id: 'sparkles', name: 'Sparkles', vb: '0 0 100 100', svg:
      '<path d="M50 6 C52 34 66 48 94 50 C66 52 52 66 50 94 C48 66 34 52 6 50 C34 48 48 34 50 6Z" fill="{A}"/>' +
      '<g transform="translate(74 2) scale(.22)"><path d="M50 6 C52 34 66 48 94 50 C66 52 52 66 50 94 C48 66 34 52 6 50 C34 48 48 34 50 6Z" fill="{B}"/></g>' +
      '<g transform="translate(4 70) scale(.22)"><path d="M50 6 C52 34 66 48 94 50 C66 52 52 66 50 94 C48 66 34 52 6 50 C34 48 48 34 50 6Z" fill="{B}"/></g>' },
    { cat: 'Shapes', id: 'swoosh-arrow', name: 'Swoosh arrow', vb: '0 0 140 80', svg:
      '<path d="M8 62 C40 72 90 62 110 30" stroke="{A}" stroke-width="8" fill="none" stroke-linecap="round"/>' +
      '<polygon points="121,16 118,37 102,25" fill="{A}"/>' },
    { cat: 'Shapes', id: 'confetti', name: 'Confetti', vb: '0 0 120 100', svg:
      '<circle cx="14" cy="16" r="5" fill="{A}"/><circle cx="96" cy="14" r="4" fill="{B}"/><circle cx="60" cy="84" r="5" fill="{A}"/>' +
      '<rect x="34" y="8" width="10" height="5" fill="{B}" transform="rotate(30 39 10)"/><rect x="84" y="52" width="10" height="5" fill="{A}" transform="rotate(-25 89 54)"/>' +
      '<rect x="12" y="62" width="10" height="5" fill="{A}" transform="rotate(50 17 64)"/><rect x="100" y="84" width="10" height="5" fill="{B}" transform="rotate(15 105 86)"/>' +
      '<polygon points="60,28 66,40 54,40" fill="{B}"/><polygon points="28,44 34,56 22,56" fill="{A}"/><polygon points="104,30 110,42 98,42" fill="{A}"/>' },
    { cat: 'Nature', id: 'sun', name: 'Sun', vb: '0 0 100 100', svg:
      '<polygon points="' + starPts(14, 48, 34, 50, 50) + '" fill="{B}"/><circle cx="50" cy="50" r="26" fill="{A}"/>' },
    { cat: 'Nature', id: 'flower', name: 'Flower', vb: '0 0 100 100', svg:
      petals + '<circle cx="50" cy="50" r="12" fill="{B}"/>' },
    { cat: 'Nature', id: 'plant', name: 'Plant', vb: '0 0 100 100', svg:
      '<path d="M50 70 C20 66 14 36 24 18 C48 22 60 46 50 70Z" fill="{A}"/>' +
      '<path d="M50 70 C80 66 86 36 76 18 C52 22 40 46 50 70Z" fill="{B}"/>' +
      '<path d="M32 70 H68 L62 94 H38Z" fill="{D}"/>' },
    { cat: 'Business', id: 'solar-panel', name: 'Solar panel', vb: '0 0 120 100', svg:
      '<circle cx="18" cy="16" r="9" fill="{B}"/>' +
      '<path d="M20 30 L100 30 L112 74 L8 74Z" fill="{A}"/>' +
      '<path d="M40 30 L34 74 M60 30 L60 74 M80 30 L86 74 M17 41 L103 41 M11 63 L109 63" stroke="{W}" stroke-width="2" fill="none"/>' +
      '<rect x="56" y="74" width="8" height="16" fill="{D}"/><rect x="38" y="88" width="44" height="6" rx="3" fill="{D}"/>' },
    { cat: 'Business', id: 'house', name: 'House', vb: '0 0 100 100', svg:
      '<rect x="68" y="18" width="9" height="20" fill="{D}"/>' +
      '<path d="M8 48 L50 14 L92 48Z" fill="{B}"/><rect x="18" y="46" width="64" height="40" fill="{A}"/>' +
      '<rect x="42" y="60" width="16" height="26" rx="2" fill="{W}"/>' +
      '<rect x="24" y="54" width="12" height="12" fill="{W}" opacity=".85"/><rect x="64" y="54" width="12" height="12" fill="{W}" opacity=".85"/>' },
    { cat: 'Business', id: 'car', name: 'Car', vb: '0 0 140 70', svg:
      '<path d="M8 46 L12 34 C14 30 18 28 24 27 L44 14 C48 11 52 10 58 10 L88 10 C94 10 98 12 102 16 L114 28 C122 29 130 32 132 40 L132 50 L8 50Z" fill="{A}"/>' +
      '<path d="M48 17 L58 13 L66 13 L66 27 L38 27Z" fill="{W}" opacity=".85"/><path d="M72 13 L90 13 L104 27 L72 27Z" fill="{W}" opacity=".85"/>' +
      '<circle cx="36" cy="52" r="11" fill="{D}"/><circle cx="36" cy="52" r="5" fill="{W}"/>' +
      '<circle cx="106" cy="52" r="11" fill="{D}"/><circle cx="106" cy="52" r="5" fill="{W}"/>' },
    { cat: 'Business', id: 'droplet', name: 'Skincare drop', vb: '0 0 80 100', svg:
      '<path d="M40 6 C40 6 8 44 8 64 C8 82 22 94 40 94 C58 94 72 82 72 64 C72 44 40 6 40 6Z" fill="{A}"/>' +
      '<path d="M24 62 C24 72 30 80 38 82" stroke="{W}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>' },
    { cat: 'Business', id: 'laptop', name: 'Laptop', vb: '0 0 120 90', svg:
      '<rect x="18" y="8" width="84" height="54" rx="5" fill="{D}"/><rect x="23" y="13" width="74" height="44" rx="2" fill="{A}"/>' +
      '<path d="M50 28 L40 35 L50 42 M70 28 L80 35 L70 42" stroke="{W}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M6 66 L114 66 L108 78 C107 80 105 81 103 81 L17 81 C15 81 13 80 12 78Z" fill="{B}"/>' },
    { cat: 'Business', id: 'hard-hat', name: 'Hard hat', vb: '0 0 100 80', svg:
      '<path d="M12 56 C12 28 30 12 50 12 C70 12 88 28 88 56Z" fill="{A}"/>' +
      '<rect x="44" y="10" width="12" height="30" rx="4" fill="{B}"/><rect x="4" y="54" width="92" height="12" rx="6" fill="{B}"/>' },
    { cat: 'Business', id: 'rocket', name: 'Rocket', vb: '0 0 80 120', svg:
      '<path d="M24 62 L8 88 L24 80Z" fill="{B}"/><path d="M56 62 L72 88 L56 80Z" fill="{B}"/>' +
      '<path d="M30 82 C34 100 40 114 40 114 C40 114 46 100 50 82Z" fill="{B}" opacity=".9"/>' +
      '<path d="M40 6 C58 22 60 52 56 80 L24 80 C20 52 22 22 40 6Z" fill="{A}"/>' +
      '<circle cx="40" cy="44" r="9" fill="{W}"/><circle cx="40" cy="44" r="5" fill="{B}"/>' },
    { cat: 'Business', id: 'speech', name: 'Speech bubble', vb: '0 0 100 90', svg:
      '<path d="M16 8 H84 C90 8 94 12 94 18 V56 C94 62 90 66 84 66 H46 L24 84 L28 66 H16 C10 66 6 62 6 56 V18 C6 12 10 8 16 8Z" fill="{A}"/>' +
      '<circle cx="30" cy="37" r="5" fill="{W}"/><circle cx="50" cy="37" r="5" fill="{W}"/><circle cx="70" cy="37" r="5" fill="{W}"/>' },
    { cat: 'Business', id: 'music', name: 'Music note', vb: '0 0 80 100', svg:
      '<path d="M28 16 L66 8 V22 L28 30Z" fill="{B}"/>' +
      '<path d="M28 74 V16 L66 8 V62" stroke="{A}" stroke-width="6" fill="none" stroke-linejoin="round"/>' +
      '<ellipse cx="20" cy="76" rx="12" ry="9" fill="{A}"/><ellipse cx="58" cy="64" rx="12" ry="9" fill="{A}"/>' }
  ];
  window.PDFED_GFX_ART = ART;

  // ── helpers ──────────────────────────────────────────────────────────────
  const HEX = /^#[0-9a-fA-F]{6}$/;
  function validHex(v, fb) { return HEX.test(v || '') ? v : fb; }

  window.pdfedGfxFillSnapshot = function () {
    if (gfx.mode === 'none') return null;
    return { mode: gfx.mode, c1: gfx.c1, c2: gfx.c2, angle: gfx.angle, outline: gfx.outline };
  };

  function gradDef(uid) {
    const a = gfx.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const f = function (n) { return n.toFixed(3); };
    return '<linearGradient id="' + uid + '" x1="' + f(.5 - .5 * c) + '" y1="' + f(.5 - .5 * s) +
      '" x2="' + f(.5 + .5 * c) + '" y2="' + f(.5 + .5 * s) + '"><stop offset="0" stop-color="' + gfx.c1 +
      '"/><stop offset="1" stop-color="' + gfx.c2 + '"/></linearGradient>';
  }

  function artSvg(art, uid) {
    const grad = gfx.mode === 'gradient';
    let main = grad ? 'url(#' + uid + ')' : gfx.c1, defs = grad ? gradDef(uid) : '';
    if (art.brand && gfx.brand) {
      if (art.brand === 'ig') {
        defs = '<linearGradient id="' + uid + 'b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#F9CE34"/><stop offset=".5" stop-color="#EE2A7B"/><stop offset="1" stop-color="#6228D7"/></linearGradient>';
        main = 'url(#' + uid + 'b)';
      } else { main = art.brand; defs = ''; }
    }
    const body = art.svg.replace(/\{A\}/g, main).replace(/\{B\}/g, gfx.c2)
      .replace(/\{S\}/g, '#F1C7A4').replace(/\{D\}/g, '#2B2B3A').replace(/\{W\}/g, '#FFFFFF');
    const p = art.vb.split(' ').map(Number);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + art.vb + '" width="' + p[2] + '" height="' + p[3] + '">' +
      (defs ? '<defs>' + defs + '</defs>' : '') + body + '</svg>';
  }

  // Clean an uploaded SVG. Returns the cleaned SVG text, or null if unusable.
  function sanitizeSvg(text) {
    if (!text || text.length > 2 * 1024 * 1024) return null;
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (e) { return null; }
    if (doc.querySelector('parsererror')) return null;
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
    doc.querySelectorAll('script,foreignObject,iframe,object,embed,audio,video,animate,set').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('style').forEach(function (st) {
      st.textContent = (st.textContent || '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#|data:image)[^)]*\)/gi, 'none');
    });
    doc.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        const n = a.name.toLowerCase(), v = (a.value || '').trim().toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href') && v.charAt(0) !== '#' && v.indexOf('data:image/') !== 0) el.removeAttribute(a.name);
        else if (v.indexOf('javascript:') !== -1) el.removeAttribute(a.name);
        else if (/url\(\s*['"]?(?!#|data:image)/i.test(v)) el.removeAttribute(a.name);
      });
    });
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(root);
  }

  function svgSize(svgText) {
    const m = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/.exec(svgText);
    if (m && +m[3] > 0 && +m[4] > 0) return { w: +m[3], h: +m[4] };
    const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(svgText), h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(svgText);
    if (w && h && +w[1] > 0 && +h[1] > 0) return { w: +w[1], h: +h[1] };
    return { w: 100, h: 100 };
  }

  function svgToPng(svgText, maxPx) {
    return new Promise(function (resolve, reject) {
      const sz = svgSize(svgText);
      const k = maxPx / Math.max(sz.w, sz.h);
      const cw = Math.max(2, Math.round(sz.w * k)), ch = Math.max(2, Math.round(sz.h * k));
      // force an explicit pixel size so every browser rasterises at full size
      let txt = svgText.replace(/<svg\b([^>]*)>/, function (m0, attrs) {
        attrs = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/g, '');
        return '<svg' + attrs + ' width="' + cw + '" height="' + ch + '">';
      });
      if (!/viewBox/i.test(txt)) txt = txt.replace('<svg', '<svg viewBox="0 0 ' + sz.w + ' ' + sz.h + '"');
      const img = new Image();
      img.onload = function () {
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        resolve({ dataUrl: c.toDataURL('image/png'), aspect: sz.w / sz.h });
      };
      img.onerror = function () { reject(new Error('SVG could not be drawn')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
    });
  }

  async function placeSvg(svgText) {
    const idx = pdfed.active, pg = pdfed.pages[idx];
    const pc = document.getElementById('pdfedPageCanvas');
    if (!pg || !pc || !pc.width) { toast('Open a page first', 'info'); return; }
    let r;
    try { r = await svgToPng(svgText, 1400); } catch (e) { toast('That SVG could not be drawn', 'error'); return; }
    const w = Math.round(pc.width * 0.3), h = Math.round(w / r.aspect);
    if (!pg.placedImages) pg.placedImages = [];
    pg.placedImages.push({
      id: 'pimg_' + (++pdfedAnnotState.placedImgSeq),
      dataUrl: r.dataUrl,
      x: Math.round((pc.width - w) / 2), y: Math.round((pc.height - h) / 2), w: w, h: h,
      locked: false, zIndex: pdfedNextZ(pg), kind: 'image'
    });
    pdfedMarkModified(idx);
    pdfedRenderPlacedImages(idx);
    pdfedRenderPlacedTexts(idx);
    toast('Graphic added. Drag to move, resize from the corners.', 'success');
  }

  // ── panel ────────────────────────────────────────────────────────────────
  function previewCss() {
    if (gfx.mode === 'gradient') return 'linear-gradient(' + (gfx.angle + 90) + 'deg,' + gfx.c1 + ',' + gfx.c2 + ')';
    return gfx.c1;
  }

  function renderGrid() {
    const grid = document.getElementById('pdfedGfxGrid');
    if (!grid) return;
    let html = '', lastCat = '';
    ART.forEach(function (art, i) {
      if (art.cat !== lastCat) {
        lastCat = art.cat;
        html += '<div style="grid-column:1/-1;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.8px;font-weight:700;margin-top:' + (i ? 8 : 0) + 'px">' + art.cat + '</div>';
      }
      html += '<button type="button" title="' + art.name + '" onclick="pdfedGfxAddArt(' + i + ')" ' +
        'style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;aspect-ratio:1">' +
        '<span style="display:block;width:100%;height:100%">' + artSvg(art, 'gfxT' + i).replace('<svg ', '<svg style="width:100%;height:100%" ') + '</span></button>';
    });
    grid.innerHTML = html;
  }

  function syncPanel() {
    ['none', 'solid', 'gradient'].forEach(function (m) {
      const b = document.getElementById('pdfedGfxMode-' + m);
      if (b) b.style.cssText = b.style.cssText.replace(/outline:[^;]*;?/, '') + (gfx.mode === m ? ';outline:2px solid var(--blue)' : '');
    });
    const set = function (id, v) { const e = document.getElementById(id); if (e) e.value = v; };
    set('pdfedGfxC1', gfx.c1); set('pdfedGfxC2', gfx.c2); set('pdfedGfxAngle', gfx.angle);
    const av = document.getElementById('pdfedGfxAngleVal'); if (av) av.textContent = gfx.angle + '\u00B0';
    const pv = document.getElementById('pdfedGfxPreview'); if (pv) pv.style.background = previewCss();
    const ol = document.getElementById('pdfedGfxOutline'); if (ol) ol.checked = !!gfx.outline;
    const br = document.getElementById('pdfedGfxBrand'); if (br) br.checked = !!gfx.brand;
    const c2row = document.getElementById('pdfedGfxC2Row'); if (c2row) c2row.style.opacity = gfx.mode === 'gradient' || true ? '1' : '.5';
  }

  function applyToSelectedShape() {
    const el = document.querySelector('#pdfedPlacedShapesLayer .pdfed-placed-shape.selected');
    if (!el) return;
    const idx = pdfed.active, pg = pdfed.pages[idx];
    const item = pg && (pg.placedShapes || []).find(function (i) { return i.id === el.dataset.id; });
    if (!item || item.tool === 'line' || item.tool === 'arrow' || item.tool === 'dblarrow') return;
    item.fill = window.pdfedGfxFillSnapshot();
    const cv = el.querySelector('canvas');
    if (cv) pdfedRedrawShapeCanvas(cv, item);
    pdfedMarkModified(idx);
  }

  window.pdfedGfxSetMode = function (m) { gfx.mode = m; syncPanel(); renderGrid(); applyToSelectedShape(); };
  window.pdfedGfxSetColor = function (which, v) {
    if (!HEX.test(v)) return;
    gfx[which] = v; syncPanel(); renderGrid(); applyToSelectedShape();
  };
  window.pdfedGfxSetAngle = function (v) { gfx.angle = Math.max(0, Math.min(360, +v || 0)); syncPanel(); renderGrid(); applyToSelectedShape(); };
  window.pdfedGfxSetOutline = function (on) { gfx.outline = !!on; applyToSelectedShape(); };
  window.pdfedGfxSetBrand = function (on) { gfx.brand = !!on; renderGrid(); };
  window.pdfedGfxAddArt = function (i) { if (ART[i]) placeSvg(artSvg(ART[i], 'gfxP' + Date.now())); };
  window.pdfedGfxUploadSvg = function (input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!/svg/i.test(f.type) && !/\.svg$/i.test(f.name)) { toast('Please choose an .svg file', 'info'); return; }
    const rd = new FileReader();
    rd.onload = function () {
      const clean = sanitizeSvg(String(rd.result || ''));
      if (!clean) { toast('That SVG file could not be read', 'error'); return; }
      placeSvg(clean);
    };
    rd.readAsText(f);
  };
  window.pdfedGfxSanitizeSvg = sanitizeSvg;

  window.pdfedToggleGfxPanel = function () {
    const panel = document.getElementById('pdfedGfxPanel');
    const trigger = document.getElementById('pdfedGfxTrigger');
    if (!panel || !trigger) return;
    ['pdfedColorPanel', 'pdfedBorderPanel'].forEach(function (id) {
      const o = document.getElementById(id); if (o) o.classList.remove('open');
    });
    const isOpen = panel.classList.toggle('open');
    if (!isOpen) return;
    const rect = trigger.getBoundingClientRect(), pw = 264;
    let left = rect.left + rect.width / 2 - pw / 2;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = left + 'px';
    panel.style.maxHeight = (window.innerHeight - rect.bottom - 20) + 'px';
    syncPanel(); renderGrid();
  };

  document.addEventListener('click', function (e) {
    const panel = document.getElementById('pdfedGfxPanel');
    if (!panel || !panel.classList.contains('open')) return;
    const wrap = document.getElementById('pdfedGfxWrap');
    if (wrap && !wrap.contains(e.target)) panel.classList.remove('open');
  });
})();
