
(function(){
  /* Showcase: motion finder. Filters chips by name and hides category labels with nothing left. */
  function run(q){
    q = (q||'').trim().toLowerCase();
    ['sppFMotionSeg','sppMotionSeg'].forEach(function(id){
      var seg = document.getElementById(id); if(!seg) return;
      var kids = [].slice.call(seg.children), label = null, shown = 0;
      function flush(){ if(label) label.style.display = (!q || shown) ? '' : 'none'; }
      kids.forEach(function(el){
        if(el.classList.contains('spp-cat')){ flush(); label = el; shown = 0; return; }
        var hit = !q || el.textContent.toLowerCase().indexOf(q) > -1 || (el.getAttribute('data-v')||'').indexOf(q) > -1;
        el.style.display = hit ? '' : 'none'; if(hit) shown++;
      });
      flush();
    });
  }
  document.addEventListener('input', function(e){ if(e.target && e.target.id === 'sppMotionFind') run(e.target.value); });
})();

