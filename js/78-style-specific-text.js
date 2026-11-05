/* Style Specific Text · compact bar behaviour (css/43-style-specific-text.css).
   Opens the style tray on focus / typing / pin, shortens the status into a count pill,
   puts the match count on the Apply button, and keeps the "Aa" preview in sync.
   Does not change any teFaf* logic in js/17. */
(function(){
  var $=function(i){return document.getElementById(i)};
  var p=$('teFafPanel'), inp=$('teFafInput'), st=$('teFafStatus'), tx=$('teFafStatusText'),
      lab=$('teFafApplyLabel'), chev=$('teFafChev'), aa=$('teFafAa');
  if(!p||!inp||!st||!tx) return;
  var pinned=false;

  // Sentence mode: widen the right panel (hysteresis so it does not flutter while typing).
  var wide=false;
  function isSentence(q){
    var words=q.split(/\s+/).filter(Boolean).length;
    return wide ? !(words<2&&q.length<=16) : (words>=3||q.length>22);
  }
  function widen(){
    var layout=$('pdfedLayout'); if(!layout) return;
    var on=isSentence(inp.value.trim());
    if(on===wide) return;
    wide=on;
    layout.classList.toggle('faf-wide',on);
    // the canvas is a different size once the panel settles, so re-fit the page (same as the left panel does)
    setTimeout(function(){
      try{ if(typeof pdfed!=='undefined'&&pdfed.active>=0&&typeof pdfedZoomFit==='function') pdfedZoomFit(); }catch(e){}
    },380);
  }
  // Show everything they typed: the field grows line by line (up to 5), then scrolls.
  function grow(){
    inp.style.height='auto';
    var h=Math.min(inp.scrollHeight,100);
    inp.style.height=Math.max(h,28)+'px';
    inp.style.overflowY=inp.scrollHeight>100?'auto':'hidden';
  }
  function sync(){
    widen(); grow();
    var open=pinned||inp.value.trim()||p.contains(document.activeElement);
    p.classList.toggle('open',!!open);
    if(chev) chev.setAttribute('aria-expanded',String(!!open));
  }
  function preview(){
    if(!aa||typeof teFafState==='undefined') return;
    var s=aa.style;
    s.fontWeight=teFafState.bold?'700':'500';
    s.fontStyle=teFafState.italic?'italic':'normal';
    s.fontFamily=teFafState.font||'Georgia, serif';
    s.color=teFafState.color||'#1b2333';
  }
  function status(){
    var t=tx.textContent, m=/^(\d+)\s/.exec(t), n=m?+m[1]:0, next=t;
    if(st.classList.contains('match')&&n){
      next=n===1?'1 match':n+' matches';
      if(lab) lab.textContent='Apply to '+next;
    }else{
      if(lab) lab.textContent='Apply across document';
      if(/^No matches/.test(t)) next='No match';
      else if(/^Scanning/.test(t)) next='Scanning…';
    }
    if(next!==t) tx.textContent=next;
  }

  p.addEventListener('focusin',sync);
  p.addEventListener('focusout',function(){setTimeout(sync,0)});
  inp.addEventListener('input',sync);
  if(window.ResizeObserver) new ResizeObserver(grow).observe(inp); // panel width changed, so lines re-wrap
  inp.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      inp.value=''; pinned=false; grow();
      if(typeof teFafOnInput==='function') teFafOnInput();
      inp.blur(); sync();
    }
  });
  if(chev) chev.addEventListener('click',function(){
    pinned=!pinned;
    if(!pinned&&!inp.value.trim()&&document.activeElement) document.activeElement.blur();
    sync();
  });
  p.addEventListener('click',function(){setTimeout(preview,0)});
  p.addEventListener('change',preview);
  p.addEventListener('input',preview);
  new MutationObserver(status).observe(st,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
  sync(); preview(); status();
})();
