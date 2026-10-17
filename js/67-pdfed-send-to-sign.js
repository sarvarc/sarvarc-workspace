/* ===== PDF EDITOR > SEND FOR SIGNING =====
   One button in the PDF Editor top bar. It takes the document exactly as you see it
   (edits, placed text/images/tables, drawings), turns it into a PDF, drops it into
   Make Forms > Sign Documents and opens it there. From that screen the person does
   the normal steps: Place fields > Sign > Send (publish link).

   Needs: js/65-sign-doc-core.js and js/66-make-forms-sign.js (window.sgdImportDocument).
   No password is applied (signers must be able to open the file), and the same free-plan
   watermark rule as Export is kept.

   Size: Sign Documents accepts files up to 3 MB, so the PDF is built from JPEG pages and,
   only if it is too big, retried a little smaller. Page size and layout never change.
*/

// Attempts, gentlest first. scale shrinks the picture only, not the printed page size.
const PDFED_SIGN_ATTEMPTS = [
  { scale: 1.0, quality: 0.82 },
  { scale: 0.8, quality: 0.70 },
  { scale: 0.65, quality: 0.60 }
];

function pdfedSendSignLoadImage(src) {
  return new Promise(function (res, rej) {
    const im = new Image();
    im.onload = function () { res(im); };
    im.onerror = function () { rej(new Error('Could not read a page picture')); };
    im.src = src;
  });
}

function pdfedSendSignReadDataUrl(blob) {
  return new Promise(function (res, rej) {
    const r = new FileReader();
    r.onload = function () { res(r.result); };
    r.onerror = function () { rej(new Error('Could not read the PDF')); };
    r.readAsDataURL(blob);
  });
}

// Builds one PDF blob at the given picture scale/quality. Returns null when it is clearly over
// the limit already (stops early so a big document does not render every page for nothing).
async function pdfedSendSignBuildPdf(indices, attempt, maxBytes, onPage) {
  const { jsPDF } = window.jspdf;
  let pdf = null;
  let approx = 0;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const pg = pdfed.pages[i];
    if (!pg) continue;
    if (onPage) onPage(k, indices.length);
    // Same flattening Export uses (text edits, placed items, drawings), at editing resolution.
    // A normal PDF page is already drawn at about 2x its size, which is what signing needs.
    const composed = await pdfedComposeThumbHiRes(pg, i, 1);
    if (!composed || !composed.url) continue;
    const img = await pdfedSendSignLoadImage(composed.url);
    const iw = composed.iw || img.naturalWidth;
    const ih = composed.ih || img.naturalHeight;
    const cw = Math.max(1, Math.round(img.naturalWidth * attempt.scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * attempt.scale));
    const can = document.createElement('canvas');
    can.width = cw; can.height = ch;
    const ctx = can.getContext('2d');
    ctx.fillStyle = '#ffffff';            // JPEG has no transparency, so paint the paper first
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    const jpg = can.toDataURL('image/jpeg', attempt.quality);
    can.width = can.height = 1;           // release the big bitmap right away
    approx += jpg.length * 0.75;
    if (approx > maxBytes * 1.2) return null;

    // Printed size comes from the page's real density (same maths as Export).
    const pxPerMm = pg._pxPerMm || 3.7795;
    const wmm = iw / pxPerMm, hmm = ih / pxPerMm;
    const ori = wmm > hmm ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation: ori, unit: 'mm', format: [wmm, hmm] });
    else pdf.addPage([wmm, hmm], ori);
    pdf.addImage(jpg, 'JPEG', 0, 0, wmm, hmm, '', 'FAST');
  }
  if (!pdf) return null;
  if (window.sarvarcApplyFreeWatermark && typeof sarvarcStampPdfWatermark === 'function') {
    sarvarcStampPdfWatermark(pdf);
  }
  return pdf.output('blob');
}

async function pdfedSendToSign() {
  if (!pdfed.pages.length) { toast('Open a PDF first', 'error'); return; }
  if (pdfedLiveBlock()) return;   // live clips cannot live inside a still PDF
  if (typeof window.sgdImportDocument !== 'function' || !window.SarvarcSignDoc) {
    toast('Sign Documents did not load. Please refresh the page.', 'error');
    return;
  }
  // Same preparation Export does, so nothing you were mid-way through is lost.
  pdfedAutoStampPendingGhost();
  await pdfedFinalizePendingCanvasTint();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }

  const maxBytes = window.sgdMaxBytes || 3 * 1024 * 1024;
  const indices = pdfed.pages.map(function (_, i) { return i; });
  showExportOverlay('Sending to Sign Documents…', 'Preparing your document…');
  try {
    let blob = null;
    for (let a = 0; a < PDFED_SIGN_ATTEMPTS.length && !blob; a++) {
      const attempt = PDFED_SIGN_ATTEMPTS[a];
      const label = a === 0 ? 'Rendering page ' : 'Making the file smaller, page ';
      const out = await pdfedSendSignBuildPdf(indices, attempt, maxBytes, function (k, n) {
        updateExportProgress(((a + k / n) / PDFED_SIGN_ATTEMPTS.length) * 85, label + (k + 1) + ' of ' + n + '…');
      });
      if (out && out.size <= maxBytes) blob = out;
    }
    if (!blob) {
      hideExportOverlay();
      toast('This document is too big to send for signing (limit 3 MB). Delete a few pages or remove large images, then try again.', 'error');
      return;
    }

    updateExportProgress(92, 'Opening Sign Documents…');
    const dataUrl = await pdfedSendSignReadDataUrl(blob);
    const base = (pdfed.file && pdfed.file.name ? pdfed.file.name : 'Document').replace(/\.[^.]+$/, '') || 'Document';
    const id = await window.sgdImportDocument({
      title: base, fileName: base + '.pdf', pageCount: indices.length,
      dataUrl: 'data:application/pdf;base64,' + String(dataUrl).split(',')[1]
    });
    hideExportOverlay();
    try { if (typeof swTrack === 'function') swTrack('pdf_send_to_sign', { module: 'pdf_editor' }); } catch (e) { /* ignore */ }

    navigate('makeforms');
    const sec = document.getElementById('sec-makeforms');
    if (sec && sec.classList.contains('active')) {
      await window.sgdOpenDocument(id);
      toast('Place your fields, then open Send to publish the link', 'success');
    } else {
      // Not signed in yet: the sign-in box is showing. The document is already saved in the list.
      toast('Sign in to continue. Your document is waiting under Sign Documents.', 'info');
    }
  } catch (e) {
    hideExportOverlay();
    console.error('[Send for Signing]', e);
    toast('Could not send to Sign Documents: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

// The button follows the Export button: visible exactly when a document is open.
// (Export is shown/hidden from many places, so mirror it instead of editing each one.)
(function () {
  function sync() {
    const ex = document.getElementById('pdfedExportBtn');
    const sg = document.getElementById('pdfedSendSignBtn');
    if (!ex || !sg) return;
    sg.style.display = ex.style.display === 'none' ? 'none' : '';
  }
  function boot() {
    const ex = document.getElementById('pdfedExportBtn');
    if (!ex) return;
    new MutationObserver(sync).observe(ex, { attributes: true, attributeFilter: ['style'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
