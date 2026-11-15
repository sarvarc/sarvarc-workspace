/* Collapsible field palette: one "+ Add question" bar instead of a tall picker */
function mfTogglePalette(force){
  var row=document.getElementById('mfAddFieldRow'); if(!row) return;
  var collapsed = (typeof force==='boolean') ? !force : !row.classList.contains('mf-collapsed');
  row.classList.toggle('mf-collapsed', collapsed);
  var b=document.getElementById('mfAddToggle'); if(b) b.setAttribute('aria-expanded', String(!collapsed));
}
document.addEventListener('click', function(e){
  var body=document.getElementById('mfPickBody'); if(!body) return;
  if(body.contains(e.target) && e.target.closest('button')) setTimeout(function(){ mfTogglePalette(false); },0);
  else if(!e.target.closest('#mfAddFieldRow')) mfTogglePalette(false);
});
document.addEventListener('keydown', function(e){ if(e.key==='Escape') mfTogglePalette(false); });
