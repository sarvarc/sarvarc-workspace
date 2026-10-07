/* Some embedded browsers ship a console without every method. Fill the gaps so a log call can never break a feature. */
(function(){ try {
  var c = window.console = window.console || {}, noop = function(){};
  ['log','info','warn','error','debug','trace','table','group','groupEnd','time','timeEnd'].forEach(function(m){
    if (typeof c[m] !== 'function') c[m] = (typeof c.log === 'function' && m !== 'log') ? function(){ try { c.log.apply(c, arguments); } catch(e){} } : noop;
  });
} catch(e){} })();
