// ─────────────────────────────────────────────────────────────────────────
// SMART XLSX EXPORT
// The old pdfedExportXLSX flattened every page — real tables, prose, PDF
// text — into one undifferentiated array of rows and dumped it through
// SheetJS, which shredded ordinary sentences into fake columns wherever a
// line happened to contain one wide gap, and dropped every logo/graphic on
// the floor. This rewrite instead hand-builds a real OOXML .xlsx (the same
// JSZip pattern pdfedExportDOCX already uses) so the export can:
//  - tell real tabular data apart from prose: a run of PDF text rows only
//    counts as a table when several CONSECUTIVE lines share the same
//    column count (pdfedGroupRowsIntoTablesOrParagraphs) — one line with a
//    single wide gap ("Invoice No:      INV-2091") stays one cell instead
//    of being torn into two
//  - keep pg.placedTables exactly as authored, as a real bordered grid
//    with a bold header row
//  - keep pg.placedTexts / prose as unsplit, word-wrapped paragraph cells
//  - extract the letterhead/logo band off each PDF page (same crop +
//    background-matte pipeline the DOCX export uses) and embed it as a
//    real picture anchored above that page's content, and carries over
//    any user-placed images (pg.placedImages) as-is
// ─────────────────────────────────────────────────────────────────────────

function pdfedColLetter(n) {
  let s = '', num = n + 1;
  while (num > 0) { const r = (num - 1) % 26; s = String.fromCharCode(65 + r) + s; num = Math.floor((num - 1) / 26); }
  return s;
}

// A run of 3+ CONSECUTIVE rows sharing the same column count (2+) is
// trusted as a real table; anything shorter collapses back into a single
// unsplit line so a heading or a "Label:   Value" line doesn't get torn
// into a fake grid just because pdfedExtractPdfTextRows found one gap.
function pdfedGroupRowsIntoTablesOrParagraphs(rows) {
  const blocks = [];
  let i = 0;
  while (i < rows.length) {
    const colCount = rows[i].length;
    if (colCount >= 2) {
      let j = i + 1;
      while (j < rows.length && rows[j].length === colCount) j++;
      if (j - i >= 3) {
        blocks.push({ type: 'table', rows: rows.slice(i, j), hasHeader: true });
        i = j;
        continue;
      }
    }
    blocks.push({ type: 'paragraph', text: rows[i].join('   ') });
    i++;
  }
  return blocks;
}

// Reads one page into an ordered list of {type:'image'|'table'|'paragraph'}
// blocks, in the same top-to-bottom reading order the page actually shows.
async function pdfedBuildXlsxPageBlocks(pg, logoMode) {
  const blocks = [];

  if (pg.type === 'pdf') {
    const doc = pg.srcDoc || pdfed.pdfDoc;
    if (!doc) return blocks;
    const RASTER_SCALE = 2;
    const page = await doc.getPage(pg.pageNum);
    const { canvas, ctx, viewport } = await pdfedRasterizePage(page, RASTER_SCALE);
    const rawRows = await pdfedExtractPdfTextRows(pg);

    if (!rawRows.length) {
      // no extractable text layer at all -> scanned page, embed it as-is
      // so the export still looks right even where it can't be re-edited
      blocks.push({ type: 'image', dataUrl: canvas.toDataURL('image/png'), widthPt: canvas.width / RASTER_SCALE, heightPt: canvas.height / RASTER_SCALE });
      return blocks;
    }

    const richRows = await pdfedExtractPdfRichRows(pg, ctx, viewport);
    if (richRows.rows.length) {
      const firstRowMaxSize = Math.max(...richRows.rows[0].items.map(it => it.size));
      const header = pdfedCropHeaderBand(canvas, viewport, richRows.rows[0].y, RASTER_SCALE, firstRowMaxSize);
      if (header) {
        let headerDataUrl = header.dataUrl, headerWidthPt = header.widthPt, headerHeightPt = header.heightPt;
        if (logoMode === 'logo') {
          const cut = await pdfedRemoveBgFromDataUrl(headerDataUrl);
          headerDataUrl = cut.dataUrl;
          if (cut.origWidth && cut.origHeight) {
            headerWidthPt = header.widthPt * (cut.width / cut.origWidth);
            headerHeightPt = header.heightPt * (cut.height / cut.origHeight);
          }
        }
        blocks.push({ type: 'image', dataUrl: headerDataUrl, widthPt: headerWidthPt, heightPt: headerHeightPt });
      }
    }
    blocks.push(...pdfedGroupRowsIntoTablesOrParagraphs(rawRows));
    return blocks;
  }

  // canvas-built page: merge placed images/tables/texts back into one
  // reading-order list by their Y position, same as pdfedExtractPageRows
  const combined = [];
  (pg.placedImages || [])
    // Decorative/masthead marks (section badges, dividers, the header rule,
    // and the background watermark) aren't page content to read back — a
    // spreadsheet export inserting a full-page watermark as a random "image
    // row" wherever its center Y happens to fall would be a visible bug,
    // not a faithful extraction. Same reasoning as the anchor/flow filters
    // used throughout Refine Report.
    .filter(im => !im._sectionIcon && !im._sectionDivider && !im._sectionBar && !im._headerDivider && !im._watermark)
    .forEach(im => combined.push({ y: im.y || 0, block: { type: 'image', dataUrl: im.dataUrl, widthPt: (im.w || 200) / 1.33, heightPt: (im.h || 100) / 1.33 } }));
  (pg.placedTables || []).forEach(t => {
    if (t.cells && t.cells.length) combined.push({ y: t.y || 0, block: { type: 'table', rows: t.cells.map(r => r.map(c => (c == null ? '' : String(c)))), hasHeader: true } });
  });
  (pg.placedTexts || []).forEach(tb => {
    const text = tb.html ? pdfedStripHtmlToText(tb.html) : (tb.text || '');
    text.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, li) => combined.push({ y: (tb.y || 0) + li, block: { type: 'paragraph', text: line } }));
  });
  combined.sort((a, b) => a.y - b.y);
  combined.forEach(c => blocks.push(c.block));
  if (!blocks.length && pg.dataUrl) blocks.push({ type: 'image', dataUrl: pg.dataUrl, widthPt: 595 / 2.83, heightPt: 842 / 2.83 });
  return blocks;
}

// One spreadsheet cell: numeric-looking text (not leading-zero, so PIN
// codes/phone numbers stay text) is written as a real number so Excel can
// sum it; everything else is an inline string.
function pdfedXlsxCellXml(ref, value, styleIdx) {
  const s = styleIdx ? ` s="${styleIdx}"` : '';
  const str = (value === undefined || value === null) ? '' : String(value).trim();
  if (str === '') return `<c r="${ref}"${s}/>`;
  const clean = str.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(clean) && !/^-?0\d/.test(clean)) {
    return `<c r="${ref}"${s}><v>${clean}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${pdfedXmlEscape(str)}</t></is></c>`;
}

async function pdfedExportXLSX(indices) {
  if (pdfedLiveBlock(indices)) return;
  if (!pdfed.pages.length) { toast('No PDF loaded', 'error'); return; }
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  showExportOverlay('Exporting Excel…', 'Reading page text…');
  try {
    const pageBlockList = [];
    let skippedPages = 0;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const pg = pdfed.pages[i];
      updateExportProgress((k / indices.length) * 70, `Reading page ${k + 1} of ${indices.length}…`);
      try {
        const blocks = await pdfedBuildXlsxPageBlocks(pg, pdfedExportLogoMode);
        if (blocks.length) pageBlockList.push({ pageLabel: `Page ${k + 1}`, blocks });
        else skippedPages++;
      } catch (pageErr) {
        console.error('XLSX page export failed', pageErr);
        skippedPages++;
      }
    }
    if (!pageBlockList.length) { hideExportOverlay(); toast('No extractable content found on selected pages', 'error'); return; }

    updateExportProgress(80, 'Building spreadsheet…');

    // widest real table found sets the grid width, so prose rows merge
    // across the same span and the whole sheet reads as one consistent grid
    let colCount = 1;
    pageBlockList.forEach(p => p.blocks.forEach(b => { if (b.type === 'table') colCount = Math.max(colCount, b.rows.reduce((m, r) => Math.max(m, r.length), 0)); }));
    colCount = Math.max(2, Math.min(colCount, 14));

    let row = 1, dataRowCount = 0;
    let sheetDataXml = '';
    let mergesXml = '', mergeCount = 0;
    const drawings = [];
    const multiPage = pageBlockList.length > 1;

    pageBlockList.forEach(pageEntry => {
      if (multiPage) {
        sheetDataXml += `<row r="${row}"><c r="A${row}" s="4" t="inlineStr"><is><t xml:space="preserve">${pdfedXmlEscape(pageEntry.pageLabel)}</t></is></c></row>`;
        row++;
      }
      pageEntry.blocks.forEach(b => {
        if (b.type === 'image') {
          const widthPt = Math.max(30, b.widthPt || 200), heightPt = Math.max(14, b.heightPt || 60);
          drawings.push({ row, widthEmu: Math.round(widthPt * 12700), heightEmu: Math.round(heightPt * 12700), dataUrl: b.dataUrl });
          row += Math.max(2, Math.ceil(heightPt / 15)) + 1;
        } else if (b.type === 'table') {
          b.rows.forEach((r, ri) => {
            let cellsXml = '';
            for (let c = 0; c < colCount; c++) {
              cellsXml += pdfedXlsxCellXml(pdfedColLetter(c) + row, r[c], (ri === 0 && b.hasHeader) ? 1 : 2);
            }
            sheetDataXml += `<row r="${row}">${cellsXml}</row>`;
            row++; dataRowCount++;
          });
          row++;
        } else if (b.type === 'paragraph') {
          const ref = 'A' + row;
          sheetDataXml += `<row r="${row}">${pdfedXlsxCellXml(ref, b.text, 3)}</row>`;
          if (colCount > 1) { mergesXml += `<mergeCell ref="${ref}:${pdfedColLetter(colCount - 1)}${row}"/>`; mergeCount++; }
          row++; dataRowCount++;
        }
      });
      row++;
    });

    if (!dataRowCount && !drawings.length) { hideExportOverlay(); toast('No extractable content found on selected pages', 'error'); return; }

    // Free-tier watermark: one small, faint footer row under everything —
    // never overlapping real data, just a trailing line under the sheet.
    if (window.sarvarcApplyFreeWatermark) {
      row++;
      sheetDataXml += `<row r="${row}">${pdfedXlsxCellXml('A' + row, SARVARC_WATERMARK_TEXT, 5)}</row>`;
      row++;
    }

    updateExportProgress(90, 'Packaging file…');

    const lastRow = Math.max(1, row - 1);
    const lastCol = pdfedColLetter(colCount - 1);

    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<dimension ref="A1:${lastCol}${lastRow}"/>` +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<cols><col min="1" max="${colCount}" width="26" customWidth="1"/></cols>` +
      `<sheetData>${sheetDataXml}</sheetData>` +
      (mergesXml ? `<mergeCells count="${mergeCount}">${mergesXml}</mergeCells>` : '') +
      (drawings.length ? `<drawing r:id="rIdDraw1"/>` : '') +
      `</worksheet>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="13"/><color rgb="FF1A1A2E"/><name val="Calibri"/></font>` +
      `<font><i/><sz val="9"/><color rgb="FF9AA5B8"/><name val="Calibri"/></font></fonts>` +
      `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF5"/><bgColor indexed="64"/></patternFill></fill></fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border><left style="thin"><color rgb="FFB9C2D0"/></left><right style="thin"><color rgb="FFB9C2D0"/></right>` +
      `<top style="thin"><color rgb="FFB9C2D0"/></top><bottom style="thin"><color rgb="FFB9C2D0"/></bottom><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="6">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
      `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      (drawings.length ? `<Default Extension="png" ContentType="image/png"/>` : '') +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      (drawings.length ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '') +
      `</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', rootRelsXml);
    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml);
    zip.file('xl/styles.xml', stylesXml);
    zip.file('xl/worksheets/sheet1.xml', sheet1Xml);

    if (drawings.length) {
      updateExportProgress(94, 'Embedding logos and images…');
      const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdDraw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
      const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        drawings.map((d, idx) => `<xdr:oneCellAnchor>` +
          `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.max(0, d.row - 1)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${d.widthEmu}" cy="${d.heightEmu}"/>` +
          `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${idx + 2}" name="Picture ${idx + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip r:embed="rIdImg${idx + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${d.widthEmu}" cy="${d.heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
          `<xdr:clientData/></xdr:oneCellAnchor>`).join('') +
        `</xdr:wsDr>`;
      const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        drawings.map((d, idx) => `<Relationship Id="rIdImg${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${idx + 1}.png"/>`).join('') +
        `</Relationships>`;

      zip.file('xl/worksheets/_rels/sheet1.xml.rels', sheetRelsXml);
      zip.file('xl/drawings/drawing1.xml', drawingXml);
      zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml);
      drawings.forEach((d, idx) => zip.file(`xl/media/image${idx + 1}.png`, d.dataUrl.split(',')[1], { base64: true }));
    }

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fname = (pdfed.file ? pdfed.file.name.replace(/\.pdf$/i, '') : 'export') + '.xlsx';
    pdfedDownloadBlob(blob, fname);
    state.stats.exports++;
    updateStats();
    completeExportOverlay('Excel file exported', { module: 'pdf_editor', format: 'xlsx' });
    toast('Exported ' + dataRowCount + ' row(s)' + (drawings.length ? ` + ${drawings.length} image(s)` : '') + ' to Excel' + (skippedPages ? ` (${skippedPages} page(s) skipped)` : ''), 'success');
  } catch (e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}

function pdfedXmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function pdfedBuildDocxTableXml(rows) {
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  const gridCols = Array.from({ length: colCount }).map(() => '<w:gridCol w:w="2000"/>').join('');
  const trs = rows.map(r => {
    const cells = Array.from({ length: colCount }).map((_, ci) => {
      const val = r[ci] !== undefined ? r[ci] : '';
      return `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${pdfedXmlEscape(val)}</w:t></w:r></w:p></w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
    `</w:tblBorders></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${trs}</w:tbl>`;
}

// ─────────────────────────────────────────────────────────────────────────
// RICH DOCX EXPORT
// The old pdfedExportDOCX reused pdfedExtractPageRows(), the same row/cell
// splitter that feeds CSV/XLSX. That's fine for spreadsheets but wrong for
// Word: it throws away font size, bold, color, alignment and any logo/
// graphic on the page, and forces every line of running text into its own
// one-row table (hence the bordered-grid look with no branding).
//
// This block replaces it with a path that:
//  - reads real per-glyph font size + bold/italic from pdf.js text items
//  - samples ink color for each line off a rendered raster of the page
//    (same "sample the pixel, don't guess" trick this file already uses
//    in the OCR text-engine section)
//  - crops the graphic band above the first line of body text (logo /
//    letterhead art) and embeds it as a real image in the .docx
//  - emits ordinary Word paragraphs/runs instead of table rows, so the
//    output reads and edits like a normal document
//  - still emits a real <w:tbl> for content that actually is tabular
//    (pg.placedTables), and now also honors the exact style already
//    stored on pg.placedTexts (color/bold/italic/fontSize/align), since
//    that data exists but was being discarded too
//  - if a page has no extractable text at all (a scanned image), embeds
//    the full page raster instead of a "[Image page]" placeholder, so
//    the export at least looks right even where it can't be text-editable
// ─────────────────────────────────────────────────────────────────────────

// Turns the cropped header/letterhead band into a transparent-background
// PNG, for the "Logo detected, extract and remove background" export option.
// This is a small multi-pass matting pipeline, not a single color-key:
//
//  1. ROBUST BACKGROUND ESTIMATE — samples pixels all along the crop's four
//     edges (not just the four corners, which can land on a stray rule line
//     or a logo that happens to touch one corner) and histogram-buckets
//     them; the most populous bucket is the true page background even when
//     part of the logo touches an edge.
//  2. ADAPTIVE TOLERANCE — measures how tightly those border samples
//     cluster around the estimated background to pick a tolerance, instead
//     of one fixed number for every scan/photo/PDF-render alike.
//  3. BORDER-CONNECTED FLOOD FILL — clears background pixels reachable from
//     the crop's edge, with a soft (squared) alpha falloff near the
//     tolerance boundary so the cutout edge isn't jagged.
//  4. ENCLOSED-HOLE PASS — letterforms like "O", "A", "e" trap a pocket of
//     background color that never touches the border, so pass 3 alone
//     leaves it opaque. This finds small isolated regions that still match
//     the background color and clears those too, without touching large
//     interior areas (which are almost certainly real logo artwork, not a
//     trapped hole).
//  5. EDGE DEFRINGING — partially-transparent edge pixels get their color
//     unpremultiplied against the background, stripping the light "halo"
//     they'd otherwise carry when the logo is composited onto a
//     differently-colored page in Word.
//  6. TIGHT TRIM — crops the canvas down to the actual opaque-pixel bounding
//     box (plus a small margin) so the exported logo isn't sitting in a
//     big empty rectangle.
async function pdfedRemoveBgFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.width, h = img.height;
        if (!w || !h) { resolve({ dataUrl, width: w, height: h }); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // ── 1. Robust background color via border histogram ──
        const buckets = new Map();
        function bucketKey(r, g, b) { return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); }
        function sample(x, y) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const key = bucketKey(r, g, b);
          let e = buckets.get(key);
          if (!e) { e = { r: 0, g: 0, b: 0, n: 0 }; buckets.set(key, e); }
          e.r += r; e.g += g; e.b += b; e.n++;
        }
        const step = Math.max(1, Math.round(Math.max(w, h) / 200));
        for (let x = 0; x < w; x += step) { sample(x, 0); sample(x, h - 1); }
        for (let y = 0; y < h; y += step) { sample(0, y); sample(w - 1, y); }
        let best = null;
        for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
        const bg = best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];

        function dist(i) {
          const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
          return Math.sqrt(dr * dr + dg * dg + db * db);
        }

        // ── 2. Adaptive tolerance from border-sample spread ──
        let varSum = 0, varN = 0;
        for (const e of buckets.values()) {
          const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
          const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);
          if (d < 60) { varSum += d * d * e.n; varN += e.n; }
        }
        const stdev = varN ? Math.sqrt(varSum / varN) : 4;
        const tolerance = Math.max(20, Math.min(58, stdev * 6 + 20));

        // ── 3. Border-connected flood fill with soft edge falloff ──
        const visited = new Uint8Array(w * h);
        const queue = new Int32Array(w * h);
        let qHead = 0, qTail = 0;
        function seed(x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return;
          const idx = y * w + x;
          if (visited[idx]) return;
          visited[idx] = 1;
          if (dist(idx * 4) <= tolerance) queue[qTail++] = idx;
        }
        for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
        for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
        while (qHead < qTail) {
          const idx = queue[qHead++];
          const x = idx % w, y = (idx / w) | 0;
          const i = idx * 4;
          const d = dist(i);
          const a = Math.max(0, Math.min(1, d / tolerance));
          data[i + 3] = Math.round(data[i + 3] * a * a);
          if (x + 1 < w) seed(x + 1, y);
          if (x - 1 >= 0) seed(x - 1, y);
          if (y + 1 < h) seed(x, y + 1);
          if (y - 1 >= 0) seed(x, y - 1);
        }

        // ── 4. Clear small enclosed background pockets (holes in letterforms) ──
        const areaLimit = w * h * 0.06;
        const holeTol = tolerance * 0.85;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (visited[idx]) continue;
            const i0 = idx * 4;
            if (dist(i0) > holeTol) { visited[idx] = 1; continue; }
            const stack = [idx];
            const region = [idx];
            visited[idx] = 1;
            let touchesBorder = false;
            let overflow = false;
            while (stack.length) {
              const cur = stack.pop();
              const cx = cur % w, cy = (cur / w) | 0;
              if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchesBorder = true;
              const neigh = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
              for (const [nx, ny] of neigh) {
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nidx = ny * w + nx;
                if (visited[nidx]) continue;
                const ni = nidx * 4;
                if (dist(ni) <= holeTol) { visited[nidx] = 1; stack.push(nidx); region.push(nidx); }
              }
              if (region.length > areaLimit) { overflow = true; break; }
            }
            if (!touchesBorder && !overflow) {
              for (const ridx of region) {
                const ri = ridx * 4;
                const d = dist(ri);
                const a = Math.max(0, Math.min(1, d / tolerance));
                data[ri + 3] = Math.round(data[ri + 3] * a * a);
              }
            }
          }
        }

        // ── 5. Defringe: strip background-tinted halo on partial-alpha edges ──
        for (let idx = 0; idx < w * h; idx++) {
          const i = idx * 4;
          const a = data[i + 3];
          if (a > 0 && a < 250) {
            const af = a / 255;
            data[i]     = Math.max(0, Math.min(255, Math.round((data[i]     - bg[0] * (1 - af)) / af)));
            data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - bg[1] * (1 - af)) / af)));
            data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - bg[2] * (1 - af)) / af)));
          }
        }

        ctx.putImageData(imgData, 0, 0);

        // ── 6. Trim to the opaque bounding box ──
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 12) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < minX || maxY < minY) { resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h, origWidth: w, origHeight: h }); return; }
        const pad = Math.round(Math.max(w, h) * 0.015);
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
        const outW = maxX - minX + 1, outH = maxY - minY + 1;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW; outCanvas.height = outH;
        outCanvas.getContext('2d').drawImage(canvas, minX, minY, outW, outH, 0, 0, outW, outH);
        resolve({ dataUrl: outCanvas.toDataURL('image/png'), width: outW, height: outH, origWidth: w, origHeight: h });
      } catch (e) {
        console.error('Logo background removal failed, using original crop', e);
        resolve({ dataUrl, width: img.width, height: img.height, origWidth: img.width, origHeight: img.height });
      }
    };
    img.onerror = () => resolve({ dataUrl, width: 0, height: 0, origWidth: 0, origHeight: 0 }); // fall back to the plain crop if anything goes wrong
    img.src = dataUrl;
  });
}

function pdfedRgbToHex(r, g, b) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return (h(r) + h(g) + h(b)).toUpperCase();
}

// Renders a pdf.js page to an offscreen canvas at a fixed points-per-pixel
// scale, returning both the canvas (for pixel sampling) and the viewport
// (for converting PDF-space coordinates into canvas pixel coordinates).
async function pdfedRasterizePage(pdfPage, scale) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, viewport };
}

// Samples the ink color across a small grid over the glyph's box and keeps
// the DARKEST pixel found, rather than the first "not-quite-white" one.
// A single fixed offset (the old approach) too easily lands on an anti-
// aliased glyph edge or, on templates with a faint dot-grid background,
// on one of those dots — both read back as a light gray and make that run
// look "faded" next to a run that happened to sample true black. Scanning
// a grid and keeping the minimum-brightness hit is far more robust, and if
// nothing meaningfully dark turns up we default to black (body text is
// essentially never actually gray) instead of keeping a washed-out guess.
function pdfedSampleInkColor(ctx, viewport, item, fontSizePt) {
  const w = item.w || fontSizePt * 0.5;
  const xFracs = [0.1, 0.22, 0.35, 0.5, 0.65, 0.78, 0.9];
  const yFracs = [0.22, 0.38, 0.52];
  let best = null, bestBrightness = Infinity;
  for (const yf of yFracs) {
    for (const xf of xFracs) {
      const px = item.transform[4] + w * xf;
      const py = item.transform[5] + fontSizePt * yf;
      const [cx, cy] = viewport.convertToViewportPoint(px, py);
      const x = Math.round(cx), y = Math.round(cy);
      if (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) continue;
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      const brightness = r + g + b;
      if (brightness < bestBrightness) { bestBrightness = brightness; best = [r, g, b]; }
    }
  }
  if (!best || bestBrightness > 660) return '000000'; // nothing dark enough found -> assume plain black body text
  return pdfedRgbToHex(best[0], best[1], best[2]);
}

// Groups raw pdf.js text items into visual rows/lines (same y-tolerance
// grouping pdfedExtractPdfTextRows uses) but keeps per-item style instead
// of collapsing everything to plain strings.
async function pdfedExtractPdfRichRows(pg, ctx, viewport) {
  const doc = pg.srcDoc || pdfed.pdfDoc;
  const page = await doc.getPage(pg.pageNum);
  const tc = await page.getTextContent();
  const items = tc.items
    .map(it => {
      const fontInfo = tc.styles && tc.styles[it.fontName] ? tc.styles[it.fontName] : {};
      const fontLabel = (it.fontName || '') + ' ' + (fontInfo.fontFamily || '');
      return {
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || Math.abs(it.transform[0]) * Math.max(1, it.str.length) * 0.5,
        size: Math.hypot(it.transform[2], it.transform[3]) || 10,
        bold: /bold/i.test(fontLabel),
        italic: /italic|oblique/i.test(fontLabel),
        transform: it.transform,
      };
    })
    .filter(it => it.str.trim() !== '');
  if (!items.length) return { rows: [], pageWidthPt: viewport.width / viewport.scale, pageHeightPt: viewport.height / viewport.scale };

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  const rowTol = 3;
  for (const it of items) {
    let row = rows.find(r => Math.abs(r.y - it.y) <= rowTol);
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach(row => {
    row.items.sort((a, b) => a.x - b.x);
    row.minX = row.items[0].x;
    const last = row.items[row.items.length - 1];
    row.maxX = last.x + (last.w || last.size);
    row.items.forEach(it => { it.color = pdfedSampleInkColor(ctx, viewport, it, it.size); });
  });
  return { rows, pageWidthPt: viewport.width / viewport.scale, pageHeightPt: viewport.height / viewport.scale };
}

// Crops the band above the first line of body text (where a logo or
// letterhead graphic usually lives) and returns it as a PNG data URL plus
// its size in points. Returns null if there's no meaningful band (body
// text starts right at the top margin).
//
// firstRowFontSize matters: a text baseline sits BELOW most of the glyph
// (the ascender rises up to ~0.8-0.9x the font size above it). The old
// version cropped only 4pt above the baseline, which cut straight through
// the ascenders of the first line — baking a partial, blurry copy of that
// line into the header image while the same line was then drawn again,
// cleanly, as real text right underneath (the "duplicated logo" ghosting).
function pdfedCropHeaderBand(canvas, viewport, firstRowY, scale, firstRowFontSize) {
  const ascentPad = Math.max(6, (firstRowFontSize || 12) * 0.9);
  const bottomPx = Math.max(0, Math.round(viewport.convertToViewportPoint(0, firstRowY + ascentPad)[1]));
  const minBandPx = 28 * scale; // ignore trivial top margins with nothing in them
  if (bottomPx < minBandPx) return null;
  const cap = Math.round(viewport.height * 0.4); // never grab more than ~40% of the page
  const h = Math.min(bottomPx, cap);
  const crop = document.createElement('canvas');
  crop.width = canvas.width;
  crop.height = h;
  crop.getContext('2d').drawImage(canvas, 0, 0, canvas.width, h, 0, 0, canvas.width, h);
  return {
    dataUrl: crop.toDataURL('image/png'),
    widthPt: canvas.width / scale,
    heightPt: h / scale,
  };
}

// Builds the <w:drawing> XML for one inline image and registers it for
// the zip's media/rels/content-types. `images` is the shared accumulator
// passed in from pdfedExportDOCX; `maxWidthEmu` clamps oversized images to
// the page's content width.
// Registers an external hyperlink relationship for the DOCX package and
// returns its rId. Uses its own 'rIdLink' prefix/counter (images.hyperlinks)
// so IDs never collide with the 'rIdImg' ones images use.
function pdfedAddHyperlinkRel(images, url) {
  if (!images.hyperlinks) images.hyperlinks = [];
  const rId = 'rIdLink' + (images.hyperlinks.length + 1);
  images.hyperlinks.push({ rId, url });
  return rId;
}

function pdfedAddImageRun(images, dataUrl, widthPt, heightPt, maxWidthEmu) {
  const rId = 'rIdImg' + (images.list.length + 1);
  const base64 = dataUrl.split(',')[1];
  let widthEmu = Math.round(widthPt * 12700);
  let heightEmu = Math.round(heightPt * 12700);
  if (widthEmu > maxWidthEmu) {
    const ratio = maxWidthEmu / widthEmu;
    widthEmu = Math.round(widthEmu * ratio);
    heightEmu = Math.round(heightEmu * ratio);
  }
  images.list.push({ rId, base64, ext: 'png' });
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:docPr id="${images.list.length}" name="Picture ${images.list.length}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${images.list.length}" name="Picture ${images.list.length}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// Turns one page's rich rows into paragraph/run XML: bold, italic, color,
// size and left/center/right alignment all come from real per-item data
// instead of being flattened into table cells.
function pdfedBuildDocxParagraphsXml(rows, pageWidthPt) {
  if (!rows.length) return '';
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i - 1].y - rows[i].y);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;

  // IMPORTANT: every continuation line used to open its own <w:p>, and every
  // <w:p> in Word inherits the built-in Normal style's default "space after"
  // (since this document never defines its own styles.xml). Stacking one of
  // those on every single line — not just real paragraph breaks — added up
  // to noticeably more vertical height than the original tightly-spaced PDF,
  // which is what pushed a one-page letter onto two pages. Fix: accumulate
  // all lines of one real paragraph into a SINGLE <w:p> (soft <w:br/>
  // between them), and explicitly zero out spacing/line-height on every
  // paragraph so Word can't quietly pad it further.
  let xml = '';
  let currentRunsXml = '';
  let currentAlign = 'left';
  let paraOpen = false;

  function flush() {
    if (!paraOpen) return;
    const jc = currentAlign === 'left' ? '' : `<w:jc w:val="${currentAlign}"/>`;
    xml += `<w:p><w:pPr>${jc}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${currentRunsXml}</w:p>`;
    currentRunsXml = '';
    paraOpen = false;
  }

  rows.forEach((row, ri) => {
    const rowCenter = (row.minX + row.maxX) / 2;
    const pageCenter = pageWidthPt / 2;
    let align = 'left';
    if (Math.abs(rowCenter - pageCenter) < 18 && row.minX > pageWidthPt * 0.15) align = 'center';
    else if (row.maxX > pageWidthPt * 0.82 && row.minX > pageWidthPt * 0.4) align = 'right';

    const gapBefore = ri === 0 ? 0 : rows[ri - 1].y - row.y;
    // only a genuinely larger gap (a real blank line in the source) starts
    // a new paragraph now; normal line-to-line wrapping stays inside one
    const isBlankLineBreak = ri > 0 && gapBefore > medianGap * 1.9;
    const isNewParagraph = ri === 0 || isBlankLineBreak || align !== currentAlign;

    const widths = row.items.map(it => it.w).filter(w => w > 0).sort((a, b) => a - b);
    const medianW = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
    const gapThreshold = Math.max(9, medianW * 2.2);

    let runsXml = '';
    let lastEndX = null;
    row.items.forEach(it => {
      if (lastEndX !== null && (it.x - lastEndX) > gapThreshold) runsXml += '<w:r><w:tab/></w:r>';
      const rPr = `<w:rPr>${it.bold ? '<w:b/>' : ''}${it.italic ? '<w:i/>' : ''}` +
        `<w:color w:val="${it.color}"/><w:sz w:val="${Math.max(12, Math.round(it.size * 2))}"/></w:rPr>`;
      runsXml += `<w:r>${rPr}<w:t xml:space="preserve">${pdfedXmlEscape(it.str)}</w:t></w:r>`;
      lastEndX = it.x + (it.w || it.size);
    });

    if (isNewParagraph) {
      flush();
      currentAlign = align;
      currentRunsXml = runsXml;
      paraOpen = true;
      if (isBlankLineBreak) xml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>'; // preserve exactly one visible blank line, not accumulating spacing
    } else {
      currentRunsXml += '<w:r><w:br/></w:r>' + runsXml;
    }
  });
  flush();
  return xml;
}

async function pdfedExportDOCX(indices) {
  if (pdfedLiveBlock(indices)) return;
  if (!pdfed.pages.length) { toast('No PDF loaded', 'error'); return; }
  if (typeof JSZip === 'undefined') { toast('Zip engine failed to load, check your connection', 'error'); return; }
  showExportOverlay('Exporting Word…', 'Reading page text…');
  const RASTER_SCALE = 2; // px-per-pt used for color sampling + cropped images
  const PAGE_W_TWIPS = 11906, PAGE_H_TWIPS = 16838, MARGIN_TWIPS = 1080;
  const contentWidthEmu = (PAGE_W_TWIPS - MARGIN_TWIPS * 2) * 635;
  const images = { list: [] };
  let logoExtracted = false;
  try {
    let bodyXml = '';
    let skippedPages = 0;
    let anyContent = false;

    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const pg = pdfed.pages[i];
      updateExportProgress((k / indices.length) * 85, `Reading page ${k + 1} of ${indices.length}…`);
      if (k > 0) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (window.sarvarcApplyFreeWatermark) bodyXml += sarvarcDocxWatermarkXml(210, 297);

      try {
        if (pg.type === 'pdf') {
          const doc = pg.srcDoc || pdfed.pdfDoc;
          const page = await doc.getPage(pg.pageNum);
          const { canvas, ctx, viewport } = await pdfedRasterizePage(page, RASTER_SCALE);
          const { rows, pageWidthPt } = await pdfedExtractPdfRichRows(pg, ctx, viewport);

          if (!rows.length) {
            // no extractable text layer at all -> likely a scanned image page;
            // embed the whole page as-is so at least the appearance survives
            skippedPages++;
            bodyXml += pdfedAddImageRun(images, canvas.toDataURL('image/png'), canvas.width / RASTER_SCALE, canvas.height / RASTER_SCALE, contentWidthEmu);
            anyContent = true;
            continue;
          }

          const firstRowMaxSize = Math.max(...rows[0].items.map(it => it.size));
          const header = pdfedCropHeaderBand(canvas, viewport, rows[0].y, RASTER_SCALE, firstRowMaxSize);
          if (header) {
            let headerDataUrl = header.dataUrl;
            let headerWidthPt = header.widthPt, headerHeightPt = header.heightPt;
            if (pdfedExportLogoMode === 'logo') {
              updateExportProgress((k / indices.length) * 85, `Extracting logo (page ${k + 1})…`);
              const cut = await pdfedRemoveBgFromDataUrl(headerDataUrl);
              headerDataUrl = cut.dataUrl;
              if (cut.origWidth && cut.origHeight) {
                headerWidthPt = header.widthPt * (cut.width / cut.origWidth);
                headerHeightPt = header.heightPt * (cut.height / cut.origHeight);
              }
              logoExtracted = true;
            }
            bodyXml += pdfedAddImageRun(images, headerDataUrl, headerWidthPt, headerHeightPt, contentWidthEmu);
          }
          bodyXml += pdfedBuildDocxParagraphsXml(rows, pageWidthPt);
          anyContent = true;
        } else if (pg.placedTables && pg.placedTables.length) {
          pg.placedTables.forEach(t => {
            if (t.cells && t.cells.length) {
              bodyXml += pdfedBuildDocxTableXml(t.cells.map(r => r.map(c => (c == null ? '' : String(c)))));
              bodyXml += '<w:p/>';
              anyContent = true;
            }
          });
        } else if (pg.placedTexts && pg.placedTexts.length) {
          // style already lives on each item, no need to sample/guess it
          pg.placedTexts.forEach(tb => {
            const align = tb.align === 'center' || tb.align === 'right' ? tb.align : 'left';
            const jc = align === 'left' ? '' : `<w:jc w:val="${align}"/>`;
            const baseSz = Math.max(12, Math.round((tb.fontSize || 14) * 1.5));
            const baseHex = (tb.color || '#000000').replace('#', '').toUpperCase();

            // Parse into per-run lines (same parser export/on-screen rendering
            // already use) instead of pdfedStripHtmlToText, so any <a href>
            // markup from "Apply to Selected" survives as real run-level
            // link data rather than being thrown away as plain text.
            const lines = tb.html
              ? pdfedParseRichLines(tb.html)
              : (tb.text || '').split('\n').map(t => [{ text: t, color: null, link: null }]);

            lines.forEach(runs => {
              let runsXml = '';
              runs.forEach(r => {
                if (!r.text) return;
                // Per-word link wins; otherwise the whole box's own link (if
                // any) applies to every run in it.
                const url = r.link || tb.link;
                const runHex = url
                  ? '0563C1' // Word's standard hyperlink blue
                  : (r.color ? pdfedToHexColor(r.color).replace('#', '').toUpperCase() : baseHex);
                const rBold = r.bold != null ? r.bold : tb.bold;
                const rItalic = r.italic != null ? r.italic : tb.italic;
                const rUnderline = r.underline != null ? r.underline : tb.underline;
                const rPr = `<w:rPr>${rBold ? '<w:b/>' : ''}${rItalic ? '<w:i/>' : ''}${(rUnderline || url) ? '<w:u w:val="single"/>' : ''}` +
                  `<w:color w:val="${runHex}"/><w:sz w:val="${baseSz}"/></w:rPr>`;
                const runXml = `<w:r>${rPr}<w:t xml:space="preserve">${pdfedXmlEscape(r.text)}</w:t></w:r>`;
                // Real Word hyperlink field — clickable and Ctrl-clickable in
                // Word/Google Docs, not just blue underlined text.
                runsXml += url
                  ? `<w:hyperlink r:id="${pdfedAddHyperlinkRel(images, url)}" w:history="1">${runXml}</w:hyperlink>`
                  : runXml;
              });
              if (!runsXml) runsXml = '<w:r><w:t xml:space="preserve"></w:t></w:r>';
              bodyXml += `<w:p><w:pPr>${jc}</w:pPr>${runsXml}</w:p>`;
            });
            anyContent = true;
          });
        } else if (pg.dataUrl) {
          // blank/image page with no structured content, embed as-is
          bodyXml += pdfedAddImageRun(images, pg.dataUrl, 595 / 2.83, 842 / 2.83, contentWidthEmu);
          anyContent = true;
        } else {
          bodyXml += '<w:p><w:r><w:t xml:space="preserve">[Blank page]</w:t></w:r></w:p>';
        }
      } catch (pageErr) {
        console.error('Page export failed, falling back to plain text', pageErr);
        const rows = await pdfedExtractPageRows(pg);
        if (rows && rows.length) { bodyXml += pdfedBuildDocxTableXml(rows); anyContent = true; }
        else skippedPages++;
      }
    }

    if (!anyContent) {
      hideExportOverlay();
      toast('No extractable content found on selected pages', 'error');
      return;
    }

    updateExportProgress(90, 'Building document…');

    const rootNamespaces = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${rootNamespaces}><w:body>${bodyXml}` +
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

    const hyperlinkRels = images.hyperlinks || [];
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      images.list.map(img => `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.rId}.${img.ext}"/>`).join('') +
      hyperlinkRels.map(h => `<Relationship Id="${h.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${pdfedXmlEscape(h.url)}" TargetMode="External"/>`).join('') +
      `</Relationships>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    const wordFolder = zip.folder('word');
    wordFolder.file('document.xml', documentXml);
    if (images.list.length || hyperlinkRels.length) {
      wordFolder.folder('_rels').file('document.xml.rels', docRels);
      if (images.list.length) {
        const media = wordFolder.folder('media');
        images.list.forEach(img => media.file(`${img.rId}.${img.ext}`, img.base64, { base64: true }));
      }
    }

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const fname = (pdfed.file ? pdfed.file.name.replace(/\.pdf$/i, '') : 'export') + '.docx';
    pdfedDownloadBlob(blob, fname);
    state.stats.exports++;
    updateStats();
    completeExportOverlay('Word document exported', { module: 'pdf_editor', format: 'docx' });
    const logoNote = logoExtracted ? ', logo extracted with background removed' : '';
    toast('Exported to Word' + logoNote + (skippedPages ? ` (${skippedPages} page(s) embedded as image, no text layer)` : ''), 'success');
  } catch (e) {
    hideExportOverlay();
    toast('Export error: ' + e.message, 'error');
    console.error(e);
  }
}
// After a successful export, if this file came from a batch queue and
// auto-continue is on, automatically move on to the next pending file —
// that's the "logical, smart" part of batch upload: export → next → export…
function pdfedQueueAutoContinueAfter() {
  if (!pdfedQueue.items.length || !pdfedQueue.autoAdvance) return;
  const hasNext = pdfedQueue.items.some(it => it.status === 'pending');
  if (!hasNext) { pdfedQueueAdvance(); return; }
  setTimeout(() => pdfedQueueAdvance(), 1100);
}
