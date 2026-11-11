/* ============================================================
   VENTANA FLOTANTE MANIPULABLE (CTX)
   - Desktop: arrastrable (por la barra de título) y redimensionable
     (esquina inferior derecha). Minimizar / cerrar.
   - Móvil: pantalla completa (sin arrastrar/redimensionar).
   Reutilizable: envuelve cualquier contenido existente del DOM.
   ============================================================ */
var FloatWin = (function(){
  var abiertas = {};   // id -> elemento ventana
  var zTop = 1000;

  function esMovil(){ return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; }

  // Abre (o trae al frente) una ventana con un id lógico.
  // opts: { titulo, contenidoEl (nodo a mover dentro), ancho, alto }
  function abrir(id, opts){
    opts = opts || {};
    if(abiertas[id]){ traerAlFrente(abiertas[id]); return abiertas[id]; }

    var movil = esMovil();
    var win = document.createElement('div');
    win.className = 'fw' + (movil ? ' fw-movil' : '');
    win.dataset.fwid = id;
    win.style.zIndex = (++zTop);

    var w = opts.ancho || 720, h = opts.alto || 560;
    if(!movil){
      // centrar con leve offset por cada ventana abierta
      var off = Object.keys(abiertas).length * 24;
      win.style.width = w + 'px';
      win.style.height = h + 'px';
      win.style.left = Math.max(10, (window.innerWidth - w)/2 + off) + 'px';
      win.style.top = Math.max(10, (window.innerHeight - h)/2 + off) + 'px';
    }

    win.innerHTML =
      '<div class="fw-bar">' +
        '<span class="fw-title">'+(opts.titulo||'')+'</span>' +
        '<div class="fw-actions">' +
          '<button class="fw-min" title="Minimizar">–</button>' +
          '<button class="fw-close" title="Cerrar">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="fw-body"></div>' +
      (movil ? '' : '<div class="fw-resize" title="Redimensionar"></div>');

    document.body.appendChild(win);
    var body = win.querySelector('.fw-body');

    // mover el contenido real adentro (y recordar de dónde vino para devolverlo)
    if(opts.contenidoEl){
      win._origen = opts.contenidoEl.parentNode;
      win._origenNext = opts.contenidoEl.nextSibling;
      win._contenido = opts.contenidoEl;
      body.appendChild(opts.contenidoEl);
      opts.contenidoEl.style.display = '';
    }

    // ---- interacciones ----
    win.addEventListener('mousedown', function(){ traerAlFrente(win); });
    win.querySelector('.fw-close').addEventListener('click', function(e){ e.stopPropagation(); cerrar(id); });
    win.querySelector('.fw-min').addEventListener('click', function(e){ e.stopPropagation(); win.classList.toggle('fw-mini'); });

    if(!movil){
      _hacerArrastrable(win, win.querySelector('.fw-bar'));
      _hacerRedimensionable(win, win.querySelector('.fw-resize'));
    }

    abiertas[id] = win;
    return win;
  }

  function traerAlFrente(win){ win.style.zIndex = (++zTop); }

  function cerrar(id){
    var win = abiertas[id];
    if(!win) return;
    // devolver el contenido a su lugar original (para no perderlo)
    if(win._contenido && win._origen){
      win._contenido.style.display = 'none';
      if(win._origenNext) win._origen.insertBefore(win._contenido, win._origenNext);
      else win._origen.appendChild(win._contenido);
    }
    win.remove();
    delete abiertas[id];
  }

  function estaAbierta(id){ return !!abiertas[id]; }

  // ---- Arrastre por la barra de título ----
  function _hacerArrastrable(win, handle){
    var sx, sy, ox, oy, drag=false;
    handle.addEventListener('mousedown', function(e){
      if(e.target.closest('.fw-actions')) return;
      drag=true; sx=e.clientX; sy=e.clientY;
      ox=parseInt(win.style.left,10); oy=parseInt(win.style.top,10);
      document.body.style.userSelect='none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function(e){
      if(!drag) return;
      var nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
      // mantener dentro de la ventana visible
      nx=Math.max(-win.offsetWidth+80, Math.min(nx, window.innerWidth-80));
      ny=Math.max(0, Math.min(ny, window.innerHeight-40));
      win.style.left=nx+'px'; win.style.top=ny+'px';
    });
    window.addEventListener('mouseup', function(){ drag=false; document.body.style.userSelect=''; });
  }

  // ---- Redimensionar desde la esquina ----
  function _hacerRedimensionable(win, handle){
    var sx, sy, ow, oh, rz=false;
    handle.addEventListener('mousedown', function(e){
      rz=true; sx=e.clientX; sy=e.clientY; ow=win.offsetWidth; oh=win.offsetHeight;
      document.body.style.userSelect='none'; e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', function(e){
      if(!rz) return;
      win.style.width = Math.max(340, ow+(e.clientX-sx))+'px';
      win.style.height = Math.max(240, oh+(e.clientY-sy))+'px';
    });
    window.addEventListener('mouseup', function(){ rz=false; document.body.style.userSelect=''; });
  }

  return { abrir:abrir, cerrar:cerrar, estaAbierta:estaAbierta, traerAlFrente:traerAlFrente };
})();


function abrirAnalizadorOpciones(){
  var cont = document.getElementById('estr-contenido');
  if(!cont) return;
  FloatWin.abrir('analizador-opciones', { titulo:'Analizador de estrategias de opciones', contenidoEl:cont, ancho:780, alto:620 });
  if(typeof estrInitSiHaceFalta==='function') estrInitSiHaceFalta();
}
