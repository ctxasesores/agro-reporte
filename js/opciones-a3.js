/* ============================================================================
   OPCIONES AGROPECUARIAS A3 — Motor Black-76
   El subyacente es el FUTURO del mismo vencimiento (no el disponible),
   por eso se usa Black-76 y no Black-Scholes clásico.
   Uso informativo / diagnóstico. No es recomendación de inversión.
   ========================================================================== */
(function () {
  // Feriados AR — verificar contra el calendario oficial de A3 (los puentes
  // turísticos los fija el PEN cada año y no siguen regla fija).
  const FERIADOS_AR = new Set([
    '2026-01-01','2026-02-16','2026-02-17','2026-03-24','2026-04-02','2026-04-03',
    '2026-05-01','2026-05-25','2026-06-15','2026-06-20','2026-07-09','2026-08-17',
    '2026-10-12','2026-11-20','2026-12-08','2026-12-25',
    '2027-01-01','2027-02-08','2027-02-09','2027-03-24','2027-03-26','2027-04-02',
    '2027-05-01','2027-05-25','2027-06-21','2027-06-20','2027-07-09','2027-08-16',
    '2027-10-11','2027-11-22','2027-12-08','2027-12-25',
  ]);
  /* Días no laborables con fines turísticos ("puentes"). La ley 27.399 deja que
     el Ejecutivo fije hasta tres por año, y puede hacerlo como FERIADO —el
     mercado cierra— o como DÍA NO LABORABLE, en cuyo caso cada empleador decide
     y el mercado opera. Para 2026 se fijaron como no laborables, así que NO
     entran en FERIADOS_AR: contarlos como feriado correría los vencimientos un
     día hábil contra el reglamento de A3.

     Se dejan listados igual porque son el candidato número uno a desfasar el
     cálculo si en algún año se decretan como feriado. Si A3 publica que cierra,
     mover la fecha al Set de arriba y listo.

     Control hecho el 02/10/2026: ninguno de los tres cae lo bastante cerca del
     inicio de un mes de entrega como para mover un vencimiento vigente, así que
     la decisión no cambia ningún número de hoy.                              */
  const NO_LABORABLES_AR = ['2026-03-23', '2026-07-10', '2026-12-07'];
  // 2027 todavía no está decretado al 02/10/2026.

  const iso = d => d.toISOString().slice(0,10);
  const esHabil = d => { const w = d.getUTCDay(); return w!==0 && w!==6 && !FERIADOS_AR.has(iso(d)); };

  // Reglamento A3: 5º día hábil anterior al inicio del mes de entrega del futuro.
  function vencimientoOpcion(mes, anio) {
    const d = new Date(Date.UTC(anio, mes-1, 1));
    let h = 0;
    while (h < 5) { d.setUTCDate(d.getUTCDate()-1); if (esHabil(d)) h++; }
    return d;
  }
  const tiempoAlVto = (v, hoy = new Date()) => Math.max((v - hoy) / (365*24*3600*1000), 0);

  // ¿El vencimiento todavía está vigente? (no pasó su fecha de ejercicio)
  // Sin esto aparecían posiciones ya vencidas en el panel de Opciones.
  function opcVtoVigente(v, hoy = new Date()) {
    const m = String(v || '').match(/^(\d{1,2})_(\d{4})$/);
    if (!m) return false;
    return vencimientoOpcion(Number(m[1]), Number(m[2])) > hoy;
  }



  const normPdf = x => Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
  function normCdf(x) {
    const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    const s = x<0?-1:1, z = Math.abs(x)/Math.SQRT2, t = 1/(1+p*z);
    return 0.5*(1 + s*(1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z)));
  }

  function black76(F,K,t,r,sig,tipo) {
    if (!(F>0)||!(K>0)) return null;
    const df = Math.exp(-r*t);
    if (t<=0 || sig<=0) return df * (tipo==='C' ? Math.max(F-K,0) : Math.max(K-F,0));
    const vt = sig*Math.sqrt(t);
    const d1 = (Math.log(F/K) + 0.5*sig*sig*t)/vt, d2 = d1-vt;
    return tipo==='C' ? df*(F*normCdf(d1)-K*normCdf(d2)) : df*(K*normCdf(-d2)-F*normCdf(-d1));
  }

  function griegas(F,K,t,r,sig,tipo) {
    if (!(F>0)||!(K>0)||t<=0||sig<=0) return null;
    const df=Math.exp(-r*t), vt=sig*Math.sqrt(t);
    const d1=(Math.log(F/K)+0.5*sig*sig*t)/vt, nd1=normPdf(d1);
    const precio = black76(F,K,t,r,sig,tipo);
    return {
      delta: tipo==='C' ? df*normCdf(d1) : df*(normCdf(d1)-1),
      gamma: df*nd1/(F*vt),
      vega:  df*F*nd1*Math.sqrt(t)/100,                                  // por 1% de vol
      theta: (r*precio - df*F*nd1*sig/(2*Math.sqrt(t)))/365,             // por día
    };
  }

/* ============================================================
   ANALIZADOR DE ESTRATEGIAS DE OPCIONES (P&L)
   Reusa el motor Black-76 global: black76(F,K,t,r,sig,tipo) y griegas(...).
   Carga manual de patas. P&L al vencimiento + teórico hoy + griegas.
   ============================================================ */
var ESTR = { patas: [], vista: 'venc', chart: null };

function estrNuevoId(){ return 'p'+Date.now()+Math.floor(Math.random()*1000); }

// Prima teórica sugerida con Black-76 (si hay datos), para prellenar.
function estrPrimaTeorica(pata){
  var F = parseFloat(document.getElementById('estr_F').value);
  var dte = parseFloat(document.getElementById('estr_dte').value);
  var vol = parseFloat(document.getElementById('estr_vol').value)/100;
  var r = (typeof tasaUsdUnica==='function') ? ((tasaUsdUnica(dte/365)||{}).r||0) : 0;
  if(!(F>0)||!(pata.strike>0)||!(dte>=0)||!(vol>0)) return null;
  var t = dte/365;
  if(pata.tipo==='F') return null; // futuro no tiene prima
  var pr = black76(F, pata.strike, t, r, vol, pata.tipo);
  return (pr!==null && isFinite(pr)) ? pr : null;
}

function estrAgregarPata(){
  ESTR.patas.push({ id:estrNuevoId(), cant:1, tipo:'C', strike:0, prima:'', primaAuto:true });
  estrRenderPatas(); estrRender();
}
function estrEliminarPata(id){
  ESTR.patas = ESTR.patas.filter(function(p){ return p.id!==id; });
  estrRenderPatas(); estrRender();
}
function estrEditarPata(id, campo, valor){
  var p = ESTR.patas.find(function(x){ return x.id===id; });
  if(!p) return;
  if(campo==='cant'){
    p.cant = parseFloat(valor);   // puede quedar NaN mientras escribe "-"; se resuelve al calcular
  } else if(campo==='strike'){
    p.strikeRaw = valor;          // guardamos el texto crudo
    p.strike = parseFloat(valor)||0;
  } else if(campo==='prima'){
    p.prima = valor;              // texto crudo: permite "4." y decimales a medio escribir
    p.primaAuto = (valor===''||valor===null);
  } else if(campo==='tipo'){
    p.tipo = valor;
    estrRenderPatas();            // cambiar tipo sí reconstruye (habilita/deshabilita campos)
    estrRender();
    return;
  }
  // Para cant/strike/prima NO reconstruimos los inputs → no se pierde el foco.
  estrRender();
}

// Prima efectiva de una pata: override manual o teórica.
function estrPrimaUsada(p){
  if(p.tipo==='F') return 0;
  var manual = parseFloat(p.prima);
  if(!p.primaAuto && p.prima!=='' && p.prima!=null && isFinite(manual)) return manual;
  var t = estrPrimaTeorica(p);
  return t!==null ? t : 0;
}

function estrRenderPatas(){
  var cont = document.getElementById('estr_patas');
  if(!ESTR.patas.length){
    cont.innerHTML = '<div class="estr-vacio">Todavía no cargaste patas. Tocá "+ Agregar pata".</div>';
    return;
  }
  var head = '<div class="estr-pata estr-pata-head"><span>Cant.</span><span>Tipo</span><span>Strike</span><span>Prima</span><span>Teórico</span><span></span></div>';
  var filas = ESTR.patas.map(function(p){
    var teo = estrPrimaTeorica(p);
    var ph = (teo!==null) ? ('teórica '+teo.toFixed(2)) : '—';
    var teoTxt = (p.tipo==='F') ? ('entra '+estrPrecioEntradaFut(p).toFixed(2)) : (teo!==null ? teo.toFixed(2) : '—');
    return '<div class="estr-pata">'
      + '<input type="text" inputmode="numeric" value="'+p.cant+'" title="Positivo=compra, negativo=venta" oninput="estrEditarPata(\''+p.id+'\',\'cant\',this.value)">'
      + '<select onchange="estrEditarPata(\''+p.id+'\',\'tipo\',this.value)">'
        + '<option value="C"'+(p.tipo==='C'?' selected':'')+'>CALL</option>'
        + '<option value="P"'+(p.tipo==='P'?' selected':'')+'>PUT</option>'
        + '<option value="F"'+(p.tipo==='F'?' selected':'')+'>Futuro</option>'
      + '</select>'
      + '<input type="text" inputmode="decimal" value="'+(p.strike||'')+'" oninput="estrEditarPata(\''+p.id+'\',\'strike\',this.value)" placeholder="'+(p.tipo==='F'?'precio entrada (F)':'strike')+'">'
      + '<input type="text" inputmode="decimal" value="'+(p.prima||'')+'" placeholder="'+ph+'" oninput="estrEditarPata(\''+p.id+'\',\'prima\',this.value)"'+(p.tipo==='F'?' disabled':'')+'>'
      + '<div class="estr-teo" data-pid="'+p.id+'" title="Prima teórica Black-76 con el strike y vencimiento actuales">'+teoTxt+'</div>'
      + '<button class="estr-del" onclick="estrEliminarPata(\''+p.id+'\')" title="Eliminar">×</button>'
      + '</div>';
  });
  cont.innerHTML = head + filas.join('');
}

// P&L de UNA pata a un precio del subyacente S, al vencimiento (valor intrínseco).
// Precio de entrada de un futuro: el que el usuario cargue en "strike",
// o el futuro subyacente actual (F) si lo deja vacío.
function estrPrecioEntradaFut(p){
  if(p.strike && p.strike>0) return p.strike;
  var F = parseFloat(document.getElementById('estr_F').value);
  return (F>0) ? F : 0;
}

function estrPayoffVenc(p, S){
  var prima = estrPrimaUsada(p), c = isFinite(p.cant)?p.cant:0;
  if(p.tipo==='F'){ var ent=estrPrecioEntradaFut(p); return c*(S - ent); }  // futuro: entra al precio F (o al que cargues)
  var intr = (p.tipo==='C') ? Math.max(S-p.strike,0) : Math.max(p.strike-S,0);
  // comprado (c>0): pago prima, cobro intrínseco. vendido (c<0): al revés. c ya lleva signo.
  return c*(intr - prima);
}

// P&L teórico HOY de una pata a precio S (revalúa con Black-76 al DTE actual).
function estrPayoffHoy(p, S){
  var prima = estrPrimaUsada(p), c = isFinite(p.cant)?p.cant:0;
  if(p.tipo==='F'){ var entH=estrPrecioEntradaFut(p); return c*(S - entH); }
  // En la vista teórica usamos el DTE del slider (permite ver la curva a distintos
  // momentos de la vida de la opción); si no, el DTE global.
  var slider = document.getElementById('estr_dte_view');
  var dte = (ESTR.vista==='hoy' && slider) ? parseFloat(slider.value)
                                           : parseFloat(document.getElementById('estr_dte').value);
  var vol = parseFloat(document.getElementById('estr_vol').value)/100;
  var r = (typeof tasaUsdUnica==='function') ? ((tasaUsdUnica(dte/365)||{}).r||0) : 0;
  var t = Math.max(dte/365, 0);
  var val = (t>0 && vol>0) ? black76(S, p.strike, t, r, vol, p.tipo)
                           : (p.tipo==='C'?Math.max(S-p.strike,0):Math.max(p.strike-S,0));
  return c*((val||0) - prima);
}

// Rango de precios para el eje X: alrededor de F, cubriendo todos los strikes.
function estrRangoPrecios(){
  var F = parseFloat(document.getElementById('estr_F').value) || 0;
  // Referencias del eje X: strikes de opciones + precios de entrada de futuros + F.
  // (si solo hay futuros, sin esto el gráfico quedaba vacío)
  var refs = [];
  ESTR.patas.forEach(function(p){
    if(p.tipo==='F'){ var ent=estrPrecioEntradaFut(p); if(ent>0) refs.push(ent); }
    else if(p.strike>0){ refs.push(p.strike); }
  });
  if(F>0) refs.push(F);
  if(!refs.length) return null;
  var min = Math.min.apply(null,refs), max = Math.max.apply(null,refs);
  var span = Math.max(max-min, max*0.15, 20);
  var lo = Math.max(0, min - span*0.6), hi = max + span*0.6;
  var N = 60, step = (hi-lo)/N, xs=[];
  for(var i=0;i<=N;i++) xs.push(lo + i*step);
  return xs;
}

// Griegas agregadas de la posición (suma ponderada por cantidad).
function estrGriegasPosicion(){
  var F = parseFloat(document.getElementById('estr_F').value);
  var dte = parseFloat(document.getElementById('estr_dte').value);
  var vol = parseFloat(document.getElementById('estr_vol').value)/100;
  var r = (typeof tasaUsdUnica==='function') ? ((tasaUsdUnica(dte/365)||{}).r||0) : 0;
  var t = dte/365;
  var tot = { delta:0, gamma:0, vega:0, theta:0 };
  if(!(F>0)||!(t>0)||!(vol>0)) return null;
  ESTR.patas.forEach(function(p){
    if(p.tipo==='F'){ tot.delta += p.cant; return; }   // futuro: delta 1 por contrato
    if(!(p.strike>0)) return;
    var g = griegas(F, p.strike, t, r, vol, p.tipo);
    if(!g) return;
    tot.delta += p.cant*g.delta;
    tot.gamma += p.cant*g.gamma;
    tot.vega  += p.cant*g.vega;
    tot.theta += p.cant*g.theta;
  });
  return tot;
}

function estrRender(){
  estrActualizarTeoricos();   // actualiza solo el texto del teórico, sin tocar inputs
  estrRenderResumen();
  estrRenderGrafico();
  estrRenderGriegas();
}

// Actualiza el valor teórico mostrado en cada fila SIN reconstruir los inputs
// (así no se pierde el foco ni el cursor mientras el usuario escribe).
function estrActualizarTeoricos(){
  ESTR.patas.forEach(function(p){
    var celda = document.querySelector('.estr-teo[data-pid="'+p.id+'"]');
    if(!celda) return;
    if(p.tipo==='F'){ celda.textContent = 'entra '+estrPrecioEntradaFut(p).toFixed(2); return; }
    var teo = estrPrimaTeorica(p);
    celda.textContent = (teo!==null) ? teo.toFixed(2) : '—';
  });
}

function estrRenderResumen(){
  var cont = document.getElementById('estr_resumen');
  if(!ESTR.patas.length){ cont.innerHTML=''; return; }
  var xs = estrRangoPrecios();
  var costo = ESTR.patas.reduce(function(a,p){
    if(p.tipo==='F') return a;
    return a + p.cant*estrPrimaUsada(p);   // c>0 compra: costo positivo (débito)
  },0);
  // máx pérdida / ganancia sobre el rango al vencimiento
  var maxP=-Infinity, minP=Infinity, breakevens=[];
  if(xs){
    var prev=null, prevX=null;
    xs.forEach(function(S){
      var pl = ESTR.patas.reduce(function(a,p){return a+estrPayoffVenc(p,S);},0);
      if(pl>maxP) maxP=pl; if(pl<minP) minP=pl;
      if(prev!==null && ((prev<0&&pl>=0)||(prev>0&&pl<=0))){
        var x0 = prevX + (prevX-S)*(prev)/(pl-prev)*-1; // interpolación lineal del cruce por 0
        breakevens.push(x0);
      }
      prev=pl; prevX=S;
    });
  }
  var f2=function(x){ return isFinite(x)? x.toLocaleString('es-AR',{maximumFractionDigits:2}):'—'; };
  cont.innerHTML =
    '<div class="estr-kpi"><span>Costo neto (prima)</span><b class="'+(costo>0?'neg':'pos')+'">'+(costo>0?'-':'+')+f2(Math.abs(costo))+'</b></div>'
   +'<div class="estr-kpi"><span>Máx. ganancia (venc.)</span><b class="pos">'+f2(maxP)+'</b></div>'
   +'<div class="estr-kpi"><span>Máx. pérdida (venc.)</span><b class="neg">'+f2(minP)+'</b></div>'
   +'<div class="estr-kpi"><span>Break-even(s)</span><b>'+(breakevens.length?breakevens.map(function(b){return f2(b);}).join(' · '):'—')+'</b></div>';
}

function estrRenderGriegas(){
  var cont = document.getElementById('estr_griegas');
  var g = estrGriegasPosicion();
  if(!g){ cont.innerHTML=''; return; }
  var f=function(x,d){ return x.toLocaleString('es-AR',{minimumFractionDigits:d,maximumFractionDigits:d}); };
  cont.innerHTML = '<div class="estr-griegas-title">Griegas de la posición</div>'
    +'<div class="estr-griegas-grid">'
    +'<div><span>Delta</span><b>'+f(g.delta,3)+'</b><small>por $1 del futuro</small></div>'
    +'<div><span>Gamma</span><b>'+f(g.gamma,4)+'</b><small>cambio del delta</small></div>'
    +'<div><span>Vega</span><b>'+f(g.vega,3)+'</b><small>por 1% de vol</small></div>'
    +'<div><span>Theta</span><b>'+f(g.theta,3)+'</b><small>por día</small></div>'
    +'</div>';
}

// Dibuja el gráfico de P&L en canvas (sin librerías).
function estrRenderGrafico(){
  var cv = document.getElementById('estr_canvas');
  if(!cv) return;
  var xs = estrRangoPrecios();
  var leyenda = document.getElementById('estr_graf_leyenda');
  if(!xs){ var ctx0=cv.getContext('2d'); ctx0.clearRect(0,0,cv.width,cv.height); if(leyenda) leyenda.innerHTML=''; return; }

  var fn = (ESTR.vista==='hoy') ? estrPayoffHoy : estrPayoffVenc;
  var ys = xs.map(function(S){ return ESTR.patas.reduce(function(a,p){return a+fn(p,S);},0); });

  // dimensionar al ancho real
  var W = cv.clientWidth || cv.parentElement.clientWidth || 600, H = 300;
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  ctx.clearRect(0,0,W,H);
  var padL=52, padR=16, padT=16, padB=32;
  var x0=padL, x1=W-padR, y0=padT, y1=H-padB;

  var xmin=xs[0], xmax=xs[xs.length-1];
  var ymin=Math.min.apply(null,ys), ymax=Math.max.apply(null,ys);
  var pad=(ymax-ymin)*0.1||1; ymin-=pad; ymax+=pad;
  var sx=function(v){ return x0+(v-xmin)/(xmax-xmin)*(x1-x0); };
  var sy=function(v){ return y1-(v-ymin)/(ymax-ymin)*(y1-y0); };

  var css=getComputedStyle(document.documentElement);
  var oro=(css.getPropertyValue('--oro')||'#d4a017').trim();
  var gris=(css.getPropertyValue('--gris')||'#9a9a9a').trim();
  var txt=(css.getPropertyValue('--txt')||'#e8e0d4').trim();

  // grilla + eje Y
  ctx.font='10px sans-serif'; ctx.fillStyle=gris; ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1;
  for(var i=0;i<=4;i++){
    var yv=ymin+(ymax-ymin)*i/4, yy=sy(yv);
    ctx.beginPath(); ctx.moveTo(x0,yy); ctx.lineTo(x1,yy); ctx.stroke();
    ctx.textAlign='right'; ctx.fillText(yv.toLocaleString('es-AR',{maximumFractionDigits:0}), x0-6, yy+3);
  }
  // eje X (algunas marcas)
  ctx.textAlign='center';
  for(var j=0;j<=5;j++){
    var xv=xmin+(xmax-xmin)*j/5, xx=sx(xv);
    ctx.fillText(xv.toLocaleString('es-AR',{maximumFractionDigits:0}), xx, y1+16);
  }
  // línea de P&L = 0
  if(ymin<0&&ymax>0){
    ctx.strokeStyle='rgba(255,255,255,.28)'; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x0,sy(0)); ctx.lineTo(x1,sy(0)); ctx.stroke(); ctx.setLineDash([]);
  }
  // línea vertical en F (precio actual)
  var F=parseFloat(document.getElementById('estr_F').value);
  if(F>=xmin&&F<=xmax){
    ctx.strokeStyle='rgba(212,160,23,.4)'; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(sx(F),y0); ctx.lineTo(sx(F),y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=oro; ctx.textAlign='center'; ctx.fillText('F', sx(F), y0-2);
  }
  // relleno ganancia/pérdida + curva
  ctx.beginPath();
  xs.forEach(function(S,k){ var X=sx(S),Y=sy(ys[k]); k?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
  ctx.strokeStyle=oro; ctx.lineWidth=2.4; ctx.stroke();

  if(leyenda){
    leyenda.innerHTML = (ESTR.vista==='hoy')
      ? 'Curva: P&L teórico si el futuro llega a ese precio <b>hoy</b> (con valor tiempo).'
      : 'Curva: P&L <b>al vencimiento</b> según el precio final del futuro (valor intrínseco).';
  }
}

function estrSetVista(v){
  ESTR.vista=v;
  document.getElementById('estr_gtab_venc').classList.toggle('on', v==='venc');
  document.getElementById('estr_gtab_hoy').classList.toggle('on', v==='hoy');
  var box = document.getElementById('estr_dte_slider');
  if(box){
    box.style.display = (v==='hoy') ? '' : 'none';
    if(v==='hoy') estrSyncDteSlider();
  }
  estrRenderGrafico();
}

// Sincroniza el rango del slider con el DTE global (el máximo = días al vencimiento).
function estrSyncDteSlider(){
  var dteGlobal = parseFloat(document.getElementById('estr_dte').value) || 0;
  var slider = document.getElementById('estr_dte_view');
  var maxLbl = document.getElementById('estr_dte_max');
  if(!slider) return;
  slider.max = Math.max(1, dteGlobal);
  if(parseFloat(slider.value) > dteGlobal) slider.value = dteGlobal;
  document.getElementById('estr_dte_view_val').textContent = slider.value;
  if(maxLbl) maxLbl.textContent = 'Hoy (' + dteGlobal + ')';
}

// Al mover el slider: actualiza la etiqueta y redibuja la curva teórica.
function estrDteView(){
  var slider = document.getElementById('estr_dte_view');
  document.getElementById('estr_dte_view_val').textContent = slider.value;
  estrRenderGrafico();
}


// Precarga F con el precio de mercado del producto elegido, si está disponible.
function estrRefrescar(){
  var prod = document.getElementById('estr_producto').value;
  var F = null;
  if(typeof getPrecioMasCercano==='function') F = getPrecioMasCercano(prod);
  if(F && F>0 && !document.getElementById('estr_F').value) document.getElementById('estr_F').value = F;
  estrRenderPatas(); estrRender();
}

// Init: al abrir el acordeón por primera vez, sembrar una pata y precargar.
var _estrInit=false;
/* ============================================================
   GENERADOR DE EJEMPLOS DE ESTRATEGIAS
   Dado un id de estrategia y F, arma las patas con strikes
   reales de la grilla A3 (o calculados si no cotizan) y las
   carga en el analizador.
   Vive en el mismo IIFE: accede a opcData, SUBY, _opcProd, _opcVto, F.
   ============================================================ */

// Devuelve los strikes REALES que cotizan para el producto/vencimiento actual,
// ordenados. Vacío si no hay datos.
function gexStrikesReales(){
  if(typeof opcData==='undefined' || !opcData.loaded) return [];
  var prod = document.getElementById('estr_producto').value;
  var suby = Object.keys(SUBY).find(function(k){ return SUBY[k]===prod; });
  if(!suby || !_opcVto) return [];
  var set = {};
  opcData.ops.forEach(function(o){
    if(o.subyacente===suby && o.vencimiento===_opcVto && o.strike>0) set[o.strike]=1;
  });
  return Object.keys(set).map(Number).sort(function(a,b){return a-b;});
}

// Strike real más cercano a un objetivo; si no hay grilla, redondea el objetivo.
function gexStrikeCercano(objetivo, reales){
  if(reales && reales.length){
    var best=reales[0], bd=Math.abs(reales[0]-objetivo);
    reales.forEach(function(k){ var d=Math.abs(k-objetivo); if(d<bd){bd=d;best=k;} });
    return best;
  }
  // sin grilla: redondear a múltiplo de 2
  return Math.round(objetivo/2)*2;
}

// Elige un strike a cierto % del futuro, en la dirección indicada, evitando repetir.
function gexStrikePorPct(F, pct, reales, usados){
  var obj = F*(1+pct/100);
  var k = gexStrikeCercano(obj, reales);
  // evitar duplicados: si ya se usó, tomar el siguiente en la dirección
  if(usados && usados.indexOf(k)>=0 && reales.length){
    var idx = reales.indexOf(k);
    var paso = pct>=0 ? 1 : -1;
    var ni = idx+paso;
    if(ni>=0 && ni<reales.length) k = reales[ni];
  }
  return k;
}

// Definición de cada estrategia: función que devuelve las patas.
// pct>0 = OTM para calls / ITM para puts (arriba de F); pct<0 = abajo de F.
var GEX_ESTRATEGIAS = {
  // ── BAJISTA ──
  'comprar_put': function(F,R){ var k=gexStrikeCercano(F,R); return {nombre:'Compra de put (ATM)', patas:[{cant:1,tipo:'P',strike:k}]}; },
  'bear_put_spread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,2,R,u);u.push(k1); var k2=gexStrikePorPct(F,-6,R,u); return {nombre:'Bear put spread', patas:[{cant:1,tipo:'P',strike:k1},{cant:-1,tipo:'P',strike:k2}]}; },
  'vender_call': function(F,R){ var k=gexStrikePorPct(F,4,R,[]); return {nombre:'Venta de call (OTM)', patas:[{cant:-1,tipo:'C',strike:k}]}; },
  'bear_call_spread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,2,R,u);u.push(k1); var k2=gexStrikePorPct(F,8,R,u); return {nombre:'Bear call spread', patas:[{cant:-1,tipo:'C',strike:k1},{cant:1,tipo:'C',strike:k2}]}; },
  'vender_futuro': function(F,R){ return {nombre:'Venta de futuro', patas:[{cant:-1,tipo:'F',strike:F}]}; },
  // ── NEUTRAL ──
  'comprar_straddle': function(F,R){ var k=gexStrikeCercano(F,R); return {nombre:'Compra de straddle (ATM)', patas:[{cant:1,tipo:'C',strike:k},{cant:1,tipo:'P',strike:k}]}; },
  'comprar_strangle': function(F,R){ var kc=gexStrikePorPct(F,5,R,[]); var kp=gexStrikePorPct(F,-5,R,[]); return {nombre:'Compra de strangle', patas:[{cant:1,tipo:'C',strike:kc},{cant:1,tipo:'P',strike:kp}]}; },
  'vender_straddle': function(F,R){ var k=gexStrikeCercano(F,R); return {nombre:'Venta de straddle (ATM)', patas:[{cant:-1,tipo:'C',strike:k},{cant:-1,tipo:'P',strike:k}]}; },
  'vender_strangle': function(F,R){ var kc=gexStrikePorPct(F,5,R,[]); var kp=gexStrikePorPct(F,-5,R,[]); return {nombre:'Venta de strangle', patas:[{cant:-1,tipo:'C',strike:kc},{cant:-1,tipo:'P',strike:kp}]}; },
  'no_operar': function(F,R){ return {nombre:'No operar', patas:[]}; },
  // ── ALCISTA ──
  'comprar_call': function(F,R){ var k=gexStrikeCercano(F,R); return {nombre:'Compra de call (ATM)', patas:[{cant:1,tipo:'C',strike:k}]}; },
  'bull_call_spread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,-2,R,u);u.push(k1); var k2=gexStrikePorPct(F,6,R,u); return {nombre:'Bull call spread', patas:[{cant:1,tipo:'C',strike:k1},{cant:-1,tipo:'C',strike:k2}]}; },
  'vender_put': function(F,R){ var k=gexStrikePorPct(F,-4,R,[]); return {nombre:'Venta de put (OTM)', patas:[{cant:-1,tipo:'P',strike:k}]}; },
  'bull_put_spread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,-2,R,u);u.push(k1); var k2=gexStrikePorPct(F,-8,R,u); return {nombre:'Bull put spread', patas:[{cant:-1,tipo:'P',strike:k1},{cant:1,tipo:'P',strike:k2}]}; },
  'comprar_futuro': function(F,R){ return {nombre:'Compra de futuro', patas:[{cant:1,tipo:'F',strike:F}]}; },
  // ── MARIPOSAS (butterflies) — bajo costo, apuesta a que quede cerca de un nivel ──
  'butterfly_call': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,-6,R,u);u.push(k1); var k2=gexStrikeCercano(F,R);u.push(k2); var k3=gexStrikePorPct(F,6,R,u); return {nombre:'Mariposa con calls', patas:[{cant:1,tipo:'C',strike:k1},{cant:-2,tipo:'C',strike:k2},{cant:1,tipo:'C',strike:k3}]}; },
  'butterfly_put': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,-6,R,u);u.push(k1); var k2=gexStrikeCercano(F,R);u.push(k2); var k3=gexStrikePorPct(F,6,R,u); return {nombre:'Mariposa con puts', patas:[{cant:1,tipo:'P',strike:k1},{cant:-2,tipo:'P',strike:k2},{cant:1,tipo:'P',strike:k3}]}; },
  // ── BACKSPREAD (neutral/low vol, net long options) ──
  'backspread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,-2,R,u);u.push(k1); var k2=gexStrikePorPct(F,5,R,u); return {nombre:'Backspread con calls', patas:[{cant:-1,tipo:'C',strike:k1},{cant:2,tipo:'C',strike:k2}]}; },
  'ratio_spread': function(F,R){ var u=[]; var k1=gexStrikePorPct(F,2,R,u);u.push(k1); var k2=gexStrikePorPct(F,8,R,u); return {nombre:'Ratio spread con calls', patas:[{cant:1,tipo:'C',strike:k1},{cant:-2,tipo:'C',strike:k2}]}; }
};

// Genera la estrategia: arma las patas, las carga en ESTR y renderiza.
function gexGenerar(id){
  var F = parseFloat(document.getElementById('estr_F').value);
  if(!(F>0)){ alert('Cargá primero el Futuro subyacente (F) arriba para generar el ejemplo.'); return; }
  var def = GEX_ESTRATEGIAS[id];
  if(!def) return;
  var R = gexStrikesReales();
  var out = def(F, R);
  // convertir a patas del analizador
  ESTR.patas = out.patas.map(function(pt){
    return { id:estrNuevoId(), cant:pt.cant, tipo:pt.tipo, strike:pt.strike||0, prima:'', primaAuto:true };
  });
  if(!ESTR.patas.length){
    // "no operar": limpiar
    ESTR.patas = [];
  }
  estrRenderPatas(); estrRender();
  // feedback: nombre de la estrategia generada
  var fb = document.getElementById('estr_gex_feedback');
  if(fb){
    var origen = R.length ? 'strikes reales de A3' : 'strikes calculados (no hay grilla cargada)';
    fb.textContent = '✓ Generado: ' + out.nombre + ' · ' + origen;
    fb.style.display = 'block';
    setTimeout(function(){ fb.style.display='none'; }, 4000);
  }
  // scroll suave a las patas
  var patas = document.getElementById('estr_patas');
  if(patas && patas.scrollIntoView) patas.scrollIntoView({behavior:'smooth', block:'center'});
}


function estrToggleGuia(){
  var body = document.getElementById('estr-guia-body');
  var ico = document.getElementById('estr-guia-ico');
  if(!body) return;
  var abierto = body.style.display !== 'none';
  body.style.display = abierto ? 'none' : 'block';
  if(ico) ico.textContent = abierto ? '▼' : '▲';
}


function estrInitSiHaceFalta(){
  if(_estrInit) return; _estrInit=true;
  estrRefrescar();
  if(!ESTR.patas.length) estrAgregarPata();
}


  // Volatilidad implícita por bisección (robusta en los extremos del smile).
  function volImplicita(prima,F,K,t,r,tipo) {
    if (!(prima>0)||!(F>0)||!(K>0)||t<=0) return null;
    const df=Math.exp(-r*t), tol=1e-6;
    const intr = df*(tipo==='C'?Math.max(F-K,0):Math.max(K-F,0));
    const max  = df*(tipo==='C'?F:K);
    if (prima < intr-tol || prima > max+tol) return null;   // fuera de no-arbitraje
    let lo=1e-6, hi=5.0;
    if (black76(F,K,t,r,hi,tipo) < prima) return null;
    for (let i=0;i<100;i++){
      const m=0.5*(lo+hi), px=black76(F,K,t,r,m,tipo);
      if (Math.abs(px-prima)<tol) return m;
      if (px<prima) lo=m; else hi=m;
    }
    return 0.5*(lo+hi);
  }

  // Volatilidad histórica anualizada por (producto, posición), desde histData
  // (la serie de precios_historicos que ya carga el panel). Se usa como fallback
  // cuando el mercado no operó la opción y no hay prima válida.
  let volHistCache = null;
  window._volHistCacheReset = function () { volHistCache = null; };
  function volHistDe(producto, posicion) {
    if (volHistCache === null) {
      if (typeof histData === 'undefined' || !histData.length) return null;
      const g = {};
      histData.forEach(r => {
        if (r.precio == null || Number(r.precio) <= 0) return;
        const k = r.producto + '|' + r.posicion;
        (g[k] = g[k] || []).push({ f: r.fecha, p: Number(r.precio) });
      });
      volHistCache = {};
      Object.entries(g).forEach(([k, arr]) => {
        arr.sort((a,b) => a.f < b.f ? -1 : 1);
        const px = arr.slice(-120).map(x => x.p);      // últimas ~120 ruedas
        if (px.length < 25) return;
        const lr = [];
        for (let i=1;i<px.length;i++) lr.push(Math.log(px[i]/px[i-1]));
        const m = lr.reduce((a,b)=>a+b,0)/lr.length;
        const v = lr.reduce((a,b)=>a+(b-m)**2,0)/(lr.length-1);
        volHistCache[k] = Math.sqrt(v*252);
      });
    }
    const exact = volHistCache[producto+'|'+posicion];
    if (exact != null) return exact;
    // Fallback: promedio de las posiciones del mismo producto
    const vs = Object.entries(volHistCache)
      .filter(([k]) => k.startsWith(producto+'|')).map(([,v]) => v);
    return vs.length ? vs.reduce((a,b)=>a+b,0)/vs.length : null;
  }

  // Tasa USD única para todas las posiciones: la MÁS ALTA de la paridad
  // TAMAR/DLR entre todos los meses de la curva. Evita tasas negativas
  // (inconsistentes) y mantiene un criterio uniforme entre vencimientos.
  /* Tasa en dólares implícita en la paridad TAMAR / dólar futuro.
     r = ((1 + TAMAR·t)·spot/forward − 1)/t   — colocar pesos a TAMAR y comprar
     dólares a futuro equivale a colocar dólares a esta tasa.

     Dos cosas que antes estaban mal y se corrigieron (auditoría 02/10/2026):

     1) Se tomaba el MÁXIMO de la curva, no el plazo que correspondía. Una
        opción a 85 días se descontaba con la paridad de un futuro a 18 meses
        solo porque esa daba más alta. Ahora se interpola en el plazo de cada
        instrumento y se extrapola plana en las puntas, que es lo que hace
        cualquier curva cuando se le pide afuera del rango observado.

     2) El piso en cero se aplicaba sin dejar rastro. Se conserva —a propósito,
        ver abajo— pero ahora `rCruda` devuelve el valor sin pisar, para que el
        panel y la auditoría puedan mostrar el régimen real.

     POR QUÉ SE CONSERVA EL PISO. Hoy todas las paridades dan negativas: el
     mercado implica una devaluación por encima de la TAMAR, que es un régimen
     real y no un error de datos. Pero una r negativa hace df = exp(−r·t) > 1,
     y eso infla el valor intrínseco descontado contra el que `bstSanear` filtra:
     aflojaría justo el control que nos protege de los ajustes viejos de A3.
     Entre equivocarse por descontar de menos (df = 1, efecto de 2-3% sobre
     primas a seis meses) y aflojar el filtro de no-arbitraje, preferimos lo
     primero. Si el régimen se vuelve estructural, la decisión se revisa con el
     dato a la vista en vez de a ciegas.                                      */
  function tasaUsdUnica(tAnios) {
    const vacio = { r:0, rCruda:null, mes:null, pisada:false, puntos:0 };
    if (!mercadoAux.loaded || mercadoAux.tamar == null || !mercadoAux.spot) return vacio;
    const hoy = Date.now();
    const pts = [];
    (mercadoAux.dlrPts || []).forEach(p => {
      const t = (p.t - hoy) / (365*24*3600*1000);
      if (t <= 0.02) return;                       // descarta lo casi vencido (ruido)
      if (!(p.px > 0)) return;
      pts.push({ t: t, ms: p.t, r: ((1 + mercadoAux.tamar * t) * mercadoAux.spot / p.px - 1) / t });
    });
    if (!pts.length) return vacio;
    pts.sort((a, b) => a.t - b.t);

    let cruda, usado;
    if (tAnios != null && isFinite(tAnios) && tAnios > 0) {
      if (tAnios <= pts[0].t)                      { cruda = pts[0].r;              usado = pts[0]; }
      else if (tAnios >= pts[pts.length-1].t)      { cruda = pts[pts.length-1].r;   usado = pts[pts.length-1]; }
      else {
        let i = 0; while (i < pts.length-1 && pts[i+1].t < tAnios) i++;
        const a = pts[i], b = pts[i+1];
        const w = (tAnios - a.t) / (b.t - a.t);
        cruda = a.r + w * (b.r - a.r);
        usado = (w < 0.5) ? a : b;                 // solo para etiquetar el mes
      }
    } else {
      // Sin plazo: se usa el punto más cercano a seis meses, que es el centro
      // de gravedad de lo que opera el panel. Antes era el máximo de la curva,
      // que no corresponde a ningún instrumento.
      usado = pts.reduce((m, p) => Math.abs(p.t - 0.5) < Math.abs(m.t - 0.5) ? p : m, pts[0]);
      cruda = usado.r;
    }
    const d = usado && usado.ms ? new Date(usado.ms) : null;
    return {
      r: Math.max(0, cruda), rCruda: cruda, pisada: cruda < 0, puntos: pts.length,
      mes: d ? (d.getMonth()+1)+'/'+String(d.getFullYear()).slice(2) : null,
    };
  }

  // ───────────────────────────── Datos ─────────────────────────────
  const SUBY = { 'SOJ.ROS':'Soja', 'MAI.ROS':'Maiz', 'TRI.ROS':'Trigo' };
  let opcData = { loaded:false, loading:false, ops:[], fut:{} };
  let _opcProd = null, _opcVto = null;

  async function cargarOpciones() {
    if (opcData.loading || typeof sb === 'undefined') return;
    opcData.loading = true;
    try {
      const { data } = await sb.from('a3_precios')
        .select('symbol,subyacente,vencimiento,es_opcion,tipo_opcion,strike,settlement_price,last_price,volumen,open_interest')
        .in('subyacente', Object.keys(SUBY));
      const fut = {}, ops = [];
      (data||[]).forEach(r => {
        if (r.es_opcion) { if (r.strike != null) ops.push(r); }
        else { const px = r.settlement_price ?? r.last_price; if (px != null) fut[r.subyacente+'|'+r.vencimiento] = Number(px); }
      });
      opcData.ops = ops; opcData.fut = fut; opcData.loaded = true;
    } catch(e) { console.warn('opciones:', e); }
    opcData.loading = false;
    renderOpciones();
    // El Booster vive en la sección de Tasas: hay que refrescarla también,
    // si no el cohete no aparece hasta que el usuario toca una solapa.
    try { if (typeof refrescarTasas === 'function') refrescarTasas(); } catch (e) {}
  }

  function renderOpciones() {
    const tabsEl = document.getElementById('opc-tabs');
    const infoEl = document.getElementById('opc-info');
    const bodyEl = document.getElementById('opc-body');
    if (!tabsEl || !bodyEl) return;

    if (!opcData.loaded) {
      // Solo disparamos la carga una vez: si falla, no reintentamos en bucle
      // (cargarOpciones llama a renderOpciones al terminar → sería recursión infinita).
      if (!opcData.loading && !opcData.intentada) { opcData.intentada = true; cargarOpciones(); }
      infoEl.innerHTML = (opcData.intentada && !opcData.loading)
        ? '<i>No se pudieron cargar las opciones.</i>'
        : '<i>Cargando opciones…</i>';
      bodyEl.innerHTML = ''; return;
    }
    if (!opcData.ops.length) {
      tabsEl.innerHTML=''; infoEl.innerHTML=''; 
      bodyEl.innerHTML = '<div class="empty-state">Sin opciones disponibles</div>'; return;
    }

    // Productos con opciones
    const opsVigentes = opcData.ops.filter(o => opcVtoVigente(o.vencimiento));
    const prods = [...new Set(opsVigentes.map(o => SUBY[o.subyacente]).filter(Boolean))].sort();
    if (!prods.length) {
      tabsEl.innerHTML = ''; infoEl.innerHTML = '';
      bodyEl.innerHTML = '<div class="empty-state">No hay opciones con vencimientos vigentes.</div>';
      return;
    }
    if (!_opcProd || !prods.includes(_opcProd)) _opcProd = prods.includes('Soja') ? 'Soja' : prods[0];
    const subyDe = p => Object.keys(SUBY).find(k => SUBY[k] === p);
    const suby = subyDe(_opcProd);

    // Vencimientos de ese producto, ordenados
    const vtos = [...new Set(opsVigentes.filter(o=>o.subyacente===suby).map(o=>o.vencimiento))]
      .sort((a,b)=>{const[ma,aa]=a.split('_').map(Number),[mb,ab]=b.split('_').map(Number);return (aa-ab)||(ma-mb);});
    if (!_opcVto || !vtos.includes(_opcVto)) _opcVto = vtos[0];

    tabsEl.innerHTML =
      prods.map(p=>`<button class="tasas-tab ${p===_opcProd?'active':''}" onclick="window._opcSetProd('${p}')">${p}</button>`).join('')
      + '<span style="width:14px"></span>'
      + vtos.map(v=>{const[m,a]=v.split('_');return `<button class="tasas-tab ${v===_opcVto?'active':''}" style="font-size:11px;padding:5px 10px" onclick="window._opcSetVto('${v}')">${m}/${String(a).slice(2)}</button>`;}).join('');

    // Insumos del modelo
    const [mes, anio] = _opcVto.split('_').map(Number);
    const F   = opcData.fut[suby+'|'+_opcVto];
    const vto = vencimientoOpcion(mes, anio);
    const t   = tiempoAlVto(vto);
    const tasaInfo = tasaUsdUnica(t);
    const r = tasaInfo.r;
    const fVto = vto.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});

    if (F == null) {
      infoEl.innerHTML = `Vence <b>${fVto}</b> · <i>sin precio del futuro subyacente: no se puede valuar</i>`;
      bodyEl.innerHTML = '<div class="empty-state">Falta el futuro subyacente</div>'; return;
    }
    infoEl.innerHTML = `Futuro <b>$${F}</b> · vence <b>${fVto}</b> · ${(t*365).toFixed(0)} días `
      + `· tasa USD <b>${(r*100).toFixed(2)}%</b> <span style="opacity:.65">(paridad TAMAR/DLR al plazo de la opción`
      + `${tasaInfo.mes ? ', interpolada sobre ' + tasaInfo.mes : ''})</span>`
      + (tasaInfo.pisada
          ? ` <span style="color:#e0a63a" title="La paridad implica una devaluación por encima de la TAMAR. Se descuenta con 0% a propósito: una tasa negativa inflaría el valor intrínseco y aflojaría el filtro de no-arbitraje.">⚠ paridad real ${(tasaInfo.rCruda*100).toFixed(2)}%, se usa 0%</span>`
          : '');

    const rows = opsVigentes.filter(o => o.subyacente===suby && o.vencimiento===_opcVto)
      .map(o => ({...o, strike:Number(o.strike), prima: o.settlement_price ?? o.last_price}))
      .sort((a,b) => (a.tipo_opcion===b.tipo_opcion ? a.strike-b.strike : (a.tipo_opcion==='C'?-1:1)));

    // ── Saneamiento de no-arbitraje (el mismo que usa el Booster) ──
    // Los ajustes de A3 traen series viejas que violan no-arbitraje: primas por
    // debajo del intrínseco y cadenas no monótonas. Acá NO se ocultan, porque el
    // panel existe para mostrar lo que publica el mercado: se marcan, y la prima
    // marcada no se usa para despejar volatilidad implícita (una prima imposible
    // da una vol imposible, y de ahí salen griegas de fantasía).
    const dfOpc = Math.exp(-r * t);
    const violan = new Set();
    ['C','P'].forEach(tp => {
      const chain = rows.filter(o => o.tipo_opcion === tp)
        .map(o => ({ strike: o.strike, prima: (o.prima != null ? Number(o.prima) : null) }));
      // Tolerancia de tick: una prima de 0,30 contra una de 0,20 no es una
      // oportunidad de arbitraje, es el mínimo movimiento de precio.
      const tolTick = ult => Math.max(0.05 * ult, 0.25);
      bstSanear(chain, F, tp, dfOpc, tolTick).forEach(it => {
        if (it.descartada) violan.add(tp + '|' + it.strike);
      });
    });

    const f2 = n => n==null ? '—' : Number(n).toFixed(2);
    let html = `<table class="tasas-table" style="min-width:640px">
      <thead><tr><th>Tipo</th><th>Strike</th><th>Prima</th><th>Volatilidad</th><th>Teórico</th>
      <th>Delta</th><th>Gamma</th><th>Vega</th><th>Theta/día</th></tr></thead><tbody>`;
    let conHist = 0, conViol = 0;
    const vh = volHistDe(_opcProd, _opcVto);   // vol histórica del futuro subyacente
    rows.forEach(o => {
      const tipoTxt = o.tipo_opcion==='C' ? 'Call' : 'Put';
      const prima = o.prima != null ? Number(o.prima) : null;
      const viola = violan.has(o.tipo_opcion + '|' + o.strike);
      if (viola) conViol++;
      // Volatilidad implícita si el mercado operó y la prima es coherente;
      // si no, se valúa con la volatilidad HISTÓRICA del futuro.
      const iv = (prima != null && !viola) ? volImplicita(prima, F, o.strike, t, r, o.tipo_opcion) : null;
      const sigma = iv != null ? iv : vh;
      const esHist = (iv == null && sigma != null);
      if (esHist) conHist++;
      const g  = sigma != null ? griegas(F, o.strike, t, r, sigma, o.tipo_opcion) : null;
      const px = sigma != null ? black76(F, o.strike, t, r, sigma, o.tipo_opcion) : null;
      const itm = (o.tipo_opcion==='C' ? F > o.strike : F < o.strike);
      const volTxt = sigma == null ? '—'
        : esHist
          ? `<span style="color:var(--gris)" title="Sin prima operada: volatilidad histórica del futuro">${(sigma*100).toFixed(1)}% <span style="font-size:9px">hist</span></span>`
          : `${(sigma*100).toFixed(1)}%`;
      html += `<tr>
        <td style="color:${o.tipo_opcion==='C'?'var(--verde-l)':'var(--oro-l)'};font-weight:700">${tipoTxt}</td>
        <td style="font-weight:${itm?'700':'400'}">${o.strike}${itm?' <span style="font-size:9px;opacity:.6">ITM</span>':''}</td>
        <td style="color:${viola?'#e0714f':'var(--oro-l)'};font-weight:700"${viola?` title="Este ajuste de A3 viola no-arbitraje: o está por debajo del valor intrínseco, o rompe la monotonía de la cadena. No se usa para calcular volatilidad ni griegas."`:''}>${prima!=null?(viola?`<s style="opacity:.8">$${f2(prima)}</s> <span style="font-size:9px">⚠</span>`:'$'+f2(prima)):'—'}</td>
        <td style="font-weight:700">${volTxt}</td>
        <td style="color:${esHist?'var(--gris)':'var(--texto)'};font-weight:${esHist?'400':'700'}">${px!=null?'$'+f2(px):'—'}</td>
        <td>${g?g.delta.toFixed(3):'—'}</td>
        <td>${g?g.gamma.toFixed(4):'—'}</td>
        <td>${g?g.vega.toFixed(3):'—'}</td>
        <td>${g?g.theta.toFixed(4):'—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    if (conViol) html += `<div class="tasas-nota" style="margin-top:10px;border-left:2px solid #e0714f;padding-left:9px">`
      + `<b>${conViol}</b> ajuste(s) de A3 <b>violan no-arbitraje</b> y están tachados: la prima queda por debajo del valor `
      + `intrínseco descontado, o rompe la monotonía de la cadena (un call no puede valer más caro cuanto más alto el strike, `
      + `ni un put más barato). Suele ser un ajuste viejo de una serie que no operó. `
      + `Esas primas <b>no se usan</b> para despejar volatilidad ni griegas —se valúan con la histórica— y el Booster las descarta igual.</div>`;
    if (conHist) html += `<div class="tasas-nota" style="margin-top:10px">`
      + `<b>${conHist}</b> opción(es) sin prima operada (o con prima descartada): `
      + `se valúan con la <b>volatilidad histórica</b> del futuro`
      + `${vh!=null ? ' ('+(vh*100).toFixed(1)+'% anual, últimas 120 ruedas)' : ''}. `
      + `Se muestran en gris para distinguirlas de las que sí tienen precio de mercado.</div>`;
    bodyEl.innerHTML = html;
  }

  // ══════════════════ BOOSTER ══════════════════
  // Lanzamiento (venta) de un CALL y un PUT sobre la posición de COSECHA.
  // Las primas cobradas son el "plus" sobre el futuro.
  //   R1  DUPLO = Kc > F  ·  CIERRE = Kp < F
  //   R2  las primas deben financiar el DUPLO:  F + primaC + primaP > Kc
  //   R3  el CIERRE no puede ser demasiado probable:  P(✕) <= BST_TOPE_PX
  // Entre los pares válidos se elige el DUPLO más alto; a igual DUPLO, el de
  // CIERRE más bajo (menor excedente).
  //
  // POR QUÉ EXISTE R3 (auditoría 30/09/2026):
  // Con la regla anterior — simetría (Kc-F) >= (F-Kp) más "DUPLO más alto
  // posible" — la selección era una solución de esquina. La prima del PUT se
  // maximiza cuando Kp se acerca a F, y un DUPLO más alto se financia con más
  // prima: el óptimo empujaba el CIERRE contra el forward. Con datos reales de
  // A3 daba CIERRE a 1,9% del futuro en soja y P(✕) de 30% a 41% en los tres
  // productos. El diagrama vende el escenario ✕ como la rama remota; no lo era.
  // La simetría nunca era la restricción activa (quedaba con holgura), así que
  // se reemplazó por un tope directo sobre la probabilidad del escenario malo.
  // Sobre la frontera eficiente, un escalón de DUPLO (4 USD) compra una caída
  // de P(✕) del ~40% al 6-24%: es el punto que domina y es el que R3 elige.
  //
  // Uso informativo. No es recomendación de inversión.
  const MES_COSECHA = { Soja: 5, Trigo: 1, Maiz: 4 };   // mayo / enero / abril

  // Tope de probabilidad del escenario ✕ (terminar debajo del CIERRE, con el
  // volumen comprometido sin precio fijado). Es el único parámetro de apetencia
  // de riesgo del Booster: cambiarlo acá cambia la selección en todo el panel.
  //
  // CALIBRACIÓN (curva del 29/09/2026). Las fronteras eficientes dan estos
  // P(✕) por producto:  soja 49/31/3/2%  ·  maíz 51/16/2%  ·  trigo 47/24/4%.
  // Con 25% la selección es soja 3%, maíz 16%, trigo 24%: en los tres casos se
  // ceden a lo sumo dos escalones de DUPLO (8 USD) contra el máximo, y a cambio
  // el escenario malo deja de ser una moneda al aire. Trigo queda a un punto
  // del tope, así que un movimiento de mercado puede bajarlo un escalón más;
  // la tabla de frontera del modal hace visible ese salto en vez de dejarlo
  // como un cambio inexplicable.
  const BST_TOPE_PX = 0.25;
  // El productor VENDE las dos opciones: cobra bid, no ajuste. Sin este
  // descuento el panel publica un DUPLO que en la mesa no se cierra.
  const BST_HAIRCUT = 0.07;

  function posicionCosecha(prod) {
    const mes = MES_COSECHA[prod];
    const suby = Object.keys(SUBY).find(k => SUBY[k] === prod);
    if (!mes || !suby) return null;
    const hoy = Date.now();
    // Los vencimientos salen de los FUTUROS, no de las opciones: el Booster es
    // OTC y su escalera puede ser entera sintética, así que alcanza con que
    // exista el futuro de la posición de cosecha.
    return [...new Set(Object.keys(opcData.fut)
        .filter(k => k.startsWith(suby + '|'))
        .map(k => k.split('|')[1]))]
      .filter(v => /^\d{1,2}_\d{4}$/.test(v) && +v.split('_')[0] === mes)
      .map(v => { const [m,a] = v.split('_').map(Number); return { v, t: vencimientoOpcion(m,a).getTime() }; })
      .filter(x => x.t > hoy)
      .sort((a,b) => a.t - b.t)
      .map(x => x.v)[0] || null;
  }

  // Probabilidad (risk-neutral, Black-76) de terminar debajo de K: el escenario ✕.
  function bstProbBajo(F, K, t, sig) {
    if (!(F > 0) || !(K > 0) || !(t > 0) || !(sig > 0)) return null;
    const d2 = (Math.log(F / K) - 0.5 * sig * sig * t) / (sig * Math.sqrt(t));
    return normCdf(-d2);
  }

  // ── Saneamiento de los ajustes de A3 ──
  // Los settlement de series ilíquidas vienen viejos y violan no-arbitraje. En
  // las tres cadenas de cosecha del 29/09/2026 había 31 violaciones: calls por
  // debajo de su valor intrínseco (soja C328 a 9,40 con intrínseco 30,70),
  // calls que crecen con el strike y puts que decrecen. Una prima así entra al
  // optimizador como plata gratis. Se descarta toda la que no pase:
  //   · prima >= valor intrínseco descontado
  //   · monotonía: el call decrece con el strike, el put crece
  // Lo descartado no se pierde: cae a prima teórica como un strike sintético.
  // `tolMono(ultimaAceptada)` da el margen que se le perdona a la monotonía.
  // El Booster no perdona nada (default): está eligiendo con qué valuar y una
  // prima dudosa se reemplaza por modelo sin costo. El panel de Opciones sí
  // perdona el ruido de tick, porque ahí la marca es un aviso al usuario y
  // gritar por 0,10 sobre una prima de 0,20 enseña a ignorar el aviso.
  function bstSanear(items, F, tipo, df, tolMono) {
    const tol = tolMono || (() => 1e-9);
    const malos = new Set();
    // 1) prima por debajo del valor intrínseco descontado
    items.forEach(it => {
      if (it.prima == null) return;
      const intr = df * Math.max(tipo === 'C' ? F - it.strike : it.strike - F, 0);
      if (it.prima < intr - 1e-9) malos.add(it.strike);
    });
    // 2) monotonía, recorriendo en el sentido en que la prima debe DECRECER
    //    (call: strike creciente · put: strike decreciente). Se compara contra
    //    la última aceptada, así una sola prima vieja no arrastra a las que siguen.
    const orden = items.filter(it => it.prima != null && !malos.has(it.strike))
      .sort((a, b) => tipo === 'C' ? a.strike - b.strike : b.strike - a.strike);
    let ult = null;
    orden.forEach(it => {
      if (ult != null && it.prima > ult + tol(ult)) { malos.add(it.strike); return; }
      ult = it.prima;
    });
    return items.map(it => (it.prima != null && malos.has(it.strike))
      ? { ...it, prima: null, descartada: true } : it);
  }

  window.calcularBooster = function (prod) {
    // El guard `intentada` evita el loop: si a3_precios falla, cargarOpciones()
    // termina con loaded:false y llama a refrescarTasas(), que vuelve a entrar
    // acá. Sin esto se reconsulta indefinidamente (justo sin señal en el campo).
    if (!opcData.loaded) {
      if (!opcData.loading && !opcData.intentada) { opcData.intentada = true; cargarOpciones(); }
      return null;
    }
    const pos = posicionCosecha(prod);
    if (!pos) return null;
    const suby = Object.keys(SUBY).find(k => SUBY[k] === prod);
    const F = opcData.fut[suby + '|' + pos];
    if (!(F > 0)) return null;

    const [mes, anio] = pos.split('_').map(Number);
    const vto = vencimientoOpcion(mes, anio);
    const t = tiempoAlVto(vto);
    if (t <= 0) return null;
    const tasaInfo = tasaUsdUnica(t);
    const r = tasaInfo.r;
    const df = Math.exp(-r * t);

    // ── Escalera de strikes de 4 en 4 dólares ──
    // El Booster es OTC: puede pactarse en strikes que A3 no lista. Se completa
    // la escalera (±18% del futuro) y se valúa todo con el mismo modelo.
    // Los strikes listados de SOJ/MAI/TRI.ROS son todos múltiplos de 4, así que
    // la escalera coincide con la grilla real del mercado.
    const PASO = 4;
    const esc_lo = Math.floor((F * 0.82) / PASO) * PASO;
    const esc_hi = Math.ceil((F * 1.18) / PASO) * PASO;
    function escalera(listados) {
      const m = new Map();
      listados.forEach(o => {
        const k = Number(o.strike);
        const mkt = o.settlement_price ?? o.last_price;
        const prima = (mkt != null && Number(mkt) > 0) ? Number(mkt) : null;
        // Si A3 trae más de una fila para el mismo strike, gana la que TIENE
        // precio: antes la última sobreescribía a la primera y podía borrarlo.
        const ya = m.get(k);
        if (ya && ya.prima != null && prima == null) return;
        m.set(k, { strike: k, prima, listado: true });
      });
      for (let k = esc_lo; k <= esc_hi; k += PASO) if (!m.has(k)) m.set(k, { strike: k, prima: null, listado: false });
      return [...m.values()].sort((a, b) => a.strike - b.strike);
    }

    let calls = escalera(opcData.ops.filter(o => o.subyacente===suby && o.vencimiento===pos && o.tipo_opcion==='C'));
    let puts  = escalera(opcData.ops.filter(o => o.subyacente===suby && o.vencimiento===pos && o.tipo_opcion==='P'));
    calls = bstSanear(calls, F, 'C', df);
    puts  = bstSanear(puts,  F, 'P', df);
    const descartadas = calls.filter(x => x.descartada).length + puts.filter(x => x.descartada).length;

    // ── Base de valuación ÚNICA ──
    // Antes se mezclaban dos escalas: precio de mercado para el strike listado y
    // Black-76 a volatilidad histórica para el sintético. Con datos reales la
    // histórica está 25-40% por debajo de la implícita (soja 9,7% vs 13,3% en
    // puts), así que los sintéticos salían sistemáticamente más baratos y el
    // optimizador prefería las patas listadas: dos monedas en la misma suma.
    // Ahora se estima UNA volatilidad por tipo —la mediana de las implícitas
    // OTM que pasaron el saneamiento, que es donde el mercado realmente opera—
    // y se valúan TODAS las patas con ella. Si no hay implícitas usables se cae
    // a la volatilidad histórica del futuro.
    const volDe = (items, tipo) => {
      const ivs = items
        .filter(it => it.prima != null && (tipo === 'C' ? it.strike > F : it.strike < F))
        .map(it => volImplicita(it.prima, F, it.strike, t, r, tipo))
        .filter(v => v != null && v > 0)
        .sort((a, b) => a - b);
      return ivs.length ? ivs[Math.floor(ivs.length / 2)] : null;
    };
    const vh = volHistDe(prod, pos);
    // Plausibilidad de la volatilidad ajustada. Una serie ilíquida cotizada
    // casi en cero pasa el saneamiento (no viola el intrínseco ni la monotonía)
    // pero implica una volatilidad absurda: en una prueba, puts a 0,10 daban
    // 2,3% anual y un P(✕) de 1%. El riesgo de equivocarse acá es asimétrico
    // —una vol demasiado BAJA subestima la probabilidad del escenario malo, que
    // es justo la métrica que gobierna la selección— así que:
    //   · si la implícita queda por debajo de la mitad de la histórica, no se
    //     cree y se usa la histórica;
    //   · si queda por encima, se conserva (distribución más ancha = más
    //     prudente), con un techo absoluto para que un dato roto no explote.
    const VOL_PISO_ABS = 0.03, VOL_TECHO_ABS = 1.50;
    const volUsable = (iv) => {
      if (iv == null || !(iv > 0)) return null;
      if (vh > 0 && iv < 0.5 * vh) return null;        // implausiblemente baja
      if (iv < VOL_PISO_ABS || iv > VOL_TECHO_ABS) return null;
      return iv;
    };
    const ivC = volUsable(volDe(calls, 'C'));
    const ivP = volUsable(volDe(puts,  'P'));
    const volC = ivC ?? vh;
    const volP = ivP ?? vh;
    if (!(volC > 0) || !(volP > 0)) return null;
    const baseC = ivC != null ? 'iv' : 'hist';
    const baseP = ivP != null ? 'iv' : 'hist';

    // Prima NETA de venta: el productor cobra bid, no ajuste.
    const primaDe = (K, tipo) => {
      const px = black76(F, K, t, r, tipo === 'C' ? volC : volP, tipo);
      if (!(px > 0)) return null;
      const neta = px * (1 - BST_HAIRCUT);
      return neta > 0.01 ? neta : null;
    };

    // ── Selección ──
    // Para cada CIERRE candidato se busca el DUPLO más alto que las primas
    // financian. Se descartan los CIERRE cuyo P(✕) pasa el tope (R3).
    const strikes = [];
    for (let k = esc_lo; k <= esc_hi; k += PASO) strikes.push(k);
    const listadoC = new Set(calls.filter(x => x.listado).map(x => x.strike));
    const listadoP = new Set(puts.filter(x => x.listado).map(x => x.strike));

    const candidatos = [];
    strikes.filter(Kp => Kp < F).forEach(Kp => {
      const px = bstProbBajo(F, Kp, t, volP);
      if (px == null) return;
      const pp = primaDe(Kp, 'P');
      if (pp == null) return;
      let top = null;
      strikes.filter(Kc => Kc > F).forEach(Kc => {
        const pc = primaDe(Kc, 'C');
        if (pc == null) return;
        const excedente = (F + pc + pp) - Kc;
        if (!(excedente > 0)) return;                       // R2
        if (!top || Kc > top.duplo) top = { duplo: Kc, primaC: pc, excedente };
      });
      if (top) candidatos.push({ cierre: Kp, probCierre: px, primaP: pp, ...top,
                                 plus: top.primaC + pp });
    });
    if (!candidatos.length) return null;

    // Frontera eficiente: pares que no están dominados (ninguno ofrece a la vez
    // más DUPLO y menos riesgo). Es lo que se muestra en el modal de detalle.
    const frontera = [];
    candidatos.slice()
      .sort((a, b) => (b.duplo - a.duplo) || (a.probCierre - b.probCierre))
      .forEach(c => {
        if (!frontera.length || c.probCierre < frontera[frontera.length - 1].probCierre - 1e-9)
          frontera.push(c);
      });

    // R3 + R4: el DUPLO más alto que respeta el tope de P(✕); a igual DUPLO,
    // el CIERRE más bajo (que es el de menor excedente).
    let mejor = null;
    candidatos.forEach(c => {
      if (c.probCierre > BST_TOPE_PX) return;               // R3
      if (!mejor || c.duplo > mejor.duplo ||
          (c.duplo === mejor.duplo && c.excedente < mejor.excedente)) mejor = c;
    });
    // Si el tope deja todo afuera se devuelve el de menor riesgo, marcado: es
    // mejor mostrar el par más defensivo que no mostrar nada.
    const topeVacio = !mejor;
    if (!mejor) mejor = candidatos.reduce((a, b) => b.probCierre < a.probCierre ? b : a);

    return {
      duplo: mejor.duplo, cierre: mejor.cierre, plus: mejor.plus,
      primaC: { v: mejor.primaC, strike: mejor.duplo,  src: listadoC.has(mejor.duplo)  ? 'list' : 'sint' },
      primaP: { v: mejor.primaP, strike: mejor.cierre, src: listadoP.has(mejor.cierre) ? 'list' : 'sint' },
      F, pos, vto, t, r, prod,
      excedente: mejor.excedente,
      probCierre: mejor.probCierre,
      volC, volP, baseC, baseP, vh, haircut: BST_HAIRCUT, topePx: BST_TOPE_PX,
      tasaCruda: tasaInfo.rCruda, tasaPisada: tasaInfo.pisada,
      dias: Math.round(t * 365),
      frontera: frontera.map(c => ({ duplo: c.duplo, cierre: c.cierre,
                                     probCierre: c.probCierre, excedente: c.excedente,
                                     elegido: c.cierre === mejor.cierre })),
      descartadas, topeVacio,
      // El DUPLO topeado por el borde de la escalera no es un máximo económico
      // sino del rango de búsqueda: hay que avisarlo.
      topeEscalera: mejor.duplo === esc_hi,
      sintetico: !listadoC.has(mejor.duplo) || !listadoP.has(mejor.cierre),
    };
  };
  // Diagrama animado de la estrategia (recorrido del precio + bifurcación x1/x2)
  // Curvas reales de la animación original (Booster 2026), revertidas para que se
  // dibujen en el sentido del tiempo. Las tres arrancan en el FORWARD (383,192.7).
  //   ✕  el precio cae hasta el CIERRE      · termina en (510.45, 260.81)
  //   x1 el precio queda debajo del DUPLO   · termina en (589.8, 170.31)
  //   x2 el precio supera el DUPLO          · termina en (589.79, 95.21)
  const BST_CURVAS = {
    x0: "M 383.35,192.67 C 397.39,192.67 408.77,204.05 408.77,218.09 L 408.77,225.32 C 408.77,239.36 420.15,250.74 434.19,250.74 L 434.19,250.74 C 448.23,250.74 459.61,239.36 459.61,225.32 L 459.61,147.65 C 459.61,133.61 470.99,122.23 485.03,122.23 L 485.03,122.23 C 499.07,122.23 510.45,133.61 510.45,147.65 L 510.45,260.81",
    x1: "M 383.35,192.67 C 397.39,192.67 408.77,204.05 408.77,218.09 L 408.77,225.32 C 408.77,239.36 420.15,250.74 434.19,250.74 L 434.19,250.74 C 448.23,250.74 459.61,239.36 459.61,225.32 L 459.61,147.65 C 459.61,133.61 470.99,122.23 485.03,122.23 L 485.03,122.23 C 499.07,122.23 510.45,133.61 510.45,147.65 L 510.45,205.72 C 510.45,219.76 521.83,231.14 535.87,231.14 L 535.87,231.14 C 549.91,231.14 561.29,219.76 561.29,205.72 L 561.29,193.62 C 562.39,180.6 573.29,170.36 586.6,170.36 L 589.8,170.31",
    x2: "M 383.35,192.66 C 397.39,192.66 408.77,204.04 408.77,218.08 L 408.77,225.31 C 408.77,239.35 420.15,250.73 434.19,250.73 L 434.19,250.73 C 448.23,250.73 459.61,239.35 459.61,225.31 L 459.61,147.64 C 459.61,133.6 470.99,122.22 485.03,122.22 L 485.03,122.22 C 499.07,122.22 510.45,133.6 510.45,147.64 L 510.45,205.71 C 510.45,219.75 521.83,231.13 535.87,231.13 L 535.87,231.13 C 549.91,231.13 561.29,219.75 561.29,205.71 L 561.29,120.62 C 561.29,119.9 561.34,119.18 561.4,118.47 C 562.5,105.45 573.4,95.21 586.71,95.21 L 589.79,95.21",
  };

  function bstDiagrama(b) {
    const f1 = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits:1 });
    // Geometría original de la animación Booster 2026 (frames 18/19/20), usada tal cual.
    // Los paths están trazados de derecha a izquierda; se animan con dashoffset
    // negativo para que se dibujen en el sentido del tiempo (izquierda → derecha).
    // Niveles: DUPLO y=138.09 · FORWARD y=192.68 · CIERRE y=260.81 · eje x 383→627.
    const ACTO1 = 'M 383.34,192.67 C 397.38,192.67 408.76,204.05 408.76,218.09 L 408.76,225.32 C 408.76,239.36 420.14,250.74 434.18,250.74 L 434.18,250.74 C 448.22,250.74 459.60,239.35 459.60,225.32 L 459.60,147.65 C 459.60,133.61 470.98,122.23 485.03,122.23 L 485.03,122.23 C 499.07,122.23 510.45,133.61 510.45,147.65 L 510.45,260.81';
    const ACTO2 = 'M 383.34,192.67 C 397.38,192.67 408.76,204.05 408.76,218.09 L 408.76,225.32 C 408.76,239.36 420.14,250.74 434.18,250.74 L 434.18,250.74 C 448.22,250.74 459.60,239.35 459.60,225.32 L 459.60,147.64 C 459.60,133.60 470.98,122.22 485.03,122.22 L 485.03,122.22 C 499.07,122.22 510.45,133.60 510.45,147.64 L 510.45,205.71 C 510.45,219.76 521.83,231.14 535.87,231.14 L 535.87,231.14 C 549.91,231.14 561.29,219.76 561.29,205.72 L 561.29,193.46 L 561.29,193.62 C 562.38,180.60 573.29,170.36 586.59,170.36 L 586.59,170.36 L 586.59,170.36 L 589.8,170.31';
    const ACTO3 = 'M 383.34,192.66 C 397.38,192.66 408.76,204.04 408.76,218.08 L 408.76,225.31 C 408.76,239.35 420.14,250.73 434.18,250.73 L 434.18,250.73 C 448.22,250.73 459.60,239.35 459.60,225.31 L 459.60,147.64 C 459.60,133.6 470.98,122.21 485.03,122.21 L 485.03,122.21 C 499.07,122.21 510.45,133.6 510.45,147.64 L 510.45,205.70 C 510.45,219.75 521.83,231.13 535.87,231.13 L 535.87,231.13 C 549.91,231.13 561.29,219.75 561.29,205.71 L 561.29,193.45 L 561.29,193.61 L 561.29,120.62 C 561.29,119.9 561.34,119.17 561.4,118.47 C 562.49,105.44 573.4,95.21 586.70,95.21 L 589.79,95.21';
    return `<div class="bstd-wrap">
      <svg viewBox="286 58 372 268" class="bstd">
        <g class="bstd-lines">
          <line x1="383.4" y1="138.09" x2="626.79" y2="138.09" class="bstd-l duplo"/>
          <line x1="383.4" y1="192.68" x2="626.79" y2="192.68" class="bstd-l"/>
          <line x1="383.4" y1="260.81" x2="626.79" y2="260.81" class="bstd-l"/>
          <text x="374" y="134" class="bstd-lab duplo">DUPLO</text>
          <text x="374" y="189" class="bstd-lab">FORWARD</text>
          <text x="374" y="257" class="bstd-lab">CIERRE</text>
          <text x="374" y="148" class="bstd-val duplo">${f1(b.duplo)}</text>
          <text x="374" y="203" class="bstd-val">${f1(b.F)}</text>
          <text x="374" y="271" class="bstd-val">${f1(b.cierre)}</text>
        </g>
        <circle cx="383.4" cy="192.68" r="5.4" class="bstd-dot0"/>

        <!-- ACTO 1 · el precio cae hasta el CIERRE -->
        <g class="bstd-acto" data-acto="1">
          <path class="bstd-curva" d="${ACTO1}"/>
          <polygon class="bstd-cruz" points="516.78 264.89 512.33 260.43 516.78 255.97 514.91 254.1 510.45 258.56 505.99 254.1 504.12 255.97 508.57 260.43 504.12 264.89 505.99 266.76 510.45 262.31 514.91 266.76 516.78 264.89"/>
          <g class="bstd-dur">
            <path d="M385.09,300.92v4.06c0,2.82,2.28,5.1,5.1,5.1h117.7c2.82,0,5.1-2.28,5.1-5.1v-4.06"/>
            <text x="449" y="322">DURACIÓN AL CIERRE</text>
          </g>
        </g>

        <!-- ACTO 2 · el precio queda por debajo del DUPLO (x1) -->
        <g class="bstd-acto" data-acto="2">
          <path class="bstd-curva" d="${ACTO2}"/>
          <circle class="bstd-dotf" cx="589.8" cy="170.31" r="5.4"/>
          <path class="bstd-brazo" d="M589.8,170.31l25.01-.1c2.82,0,5.1-2.16,5.1-4.98l-.12-22.19"/>
          <g class="bstd-burb"><circle cx="603.24" cy="153.18" r="9.55"/><text x="603.24" y="156.6">x1</text></g>
          <path class="bstd-flecha" d="M619.78,133.5l-4.2,-6.4h8.4z"/>
          <g class="bstd-dur">
            <path d="M385.09,300.92v4.06c0,2.82,2.28,5.1,5.1,5.1h194.09c2.82,0,5.1-2.28,5.1-5.1v-4.06"/>
            <text x="487" y="322">DURACIÓN A LA EXPIRACIÓN DE LA ESTRATEGIA</text>
          </g>
        </g>

        <!-- ACTO 3 · el precio supera el DUPLO (x2) -->
        <g class="bstd-acto" data-acto="3">
          <path class="bstd-curva" d="${ACTO3}"/>
          <circle class="bstd-dotf" cx="589.79" cy="95.21" r="5.4"/>
          <path class="bstd-brazo" d="M589.69,95.21h24.98c2.82,0,5.1,2.28,5.1,5.1v32.79"/>
          <g class="bstd-burb"><circle cx="603.31" cy="77.94" r="9.55"/><text x="603.31" y="81.4">x2</text></g>
          <path class="bstd-flecha" d="M619.78,133.5l-4.2,-6.4h8.4z"/>
          <g class="bstd-dur">
            <path d="M385.09,300.92v4.06c0,2.82,2.28,5.1,5.1,5.1h194.09c2.82,0,5.1-2.28,5.1-5.1v-4.06"/>
            <text x="487" y="322">DURACIÓN A LA EXPIRACIÓN DE LA ESTRATEGIA</text>
          </g>
        </g>
      </svg>
      <div class="bstd-pasos">
        <span class="bstd-paso" data-p="1">Cierre</span>
        <span class="bstd-paso" data-p="2">x1</span>
        <span class="bstd-paso" data-p="3">x2</span>
      </div>
      <button class="bstd-replay" onclick="bstReplay(this)" title="Volver a ver">↻ Repetir</button>
    </div>`;
  }

  // Secuencia de 3 actos: se dibuja cada escenario, se sostiene 5 s y pasa al siguiente.
  const BSTD_DIBUJO = 2600, BSTD_PAUSA = 5000;
  function bstdAnimar(wrap) {
    if (!wrap) return;
    clearTimeout(wrap._t);
    const actos = [...wrap.querySelectorAll('.bstd-acto')];
    const pasos = [...wrap.querySelectorAll('.bstd-paso')];
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    actos.forEach(g => {
      g.classList.remove('on');
      const p = g.querySelector('.bstd-curva');
      const L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.transition = 'none';
      p.style.strokeDashoffset = L;    // oculto; al ir a 0 se dibuja de izquierda a derecha
    });
    wrap.getBoundingClientRect();       // fuerza el commit del estado inicial

    if (reduce) { actos.forEach((g,i) => { if (i===actos.length-1) g.classList.add('on'); }); return; }

    const mostrar = (i) => {
      actos.forEach((g, k) => g.classList.toggle('on', k === i));
      pasos.forEach((s, k) => s.classList.toggle('on', k === i));
      const p = actos[i].querySelector('.bstd-curva');
      const L = p.getTotalLength();
      requestAnimationFrame(() => {
        p.style.transition = `stroke-dashoffset ${BSTD_DIBUJO}ms cubic-bezier(.45,.05,.55,.95)`;
        p.style.strokeDashoffset = 0;
      });
      if (i < actos.length - 1)
        wrap._t = setTimeout(() => mostrar(i + 1), BSTD_DIBUJO + BSTD_PAUSA);
    };
    mostrar(0);
  }

  window.bstReplay = function (btn) { bstdAnimar(btn.closest('.bstd-wrap')); };
  window.bstdAnimar = bstdAnimar;

  window.boosterDebug = function (prod) {
    const est = {
      producto: prod,
      opciones_cargadas: opcData.loaded,
      opciones_en_memoria: opcData.ops.length,
      serie_historica: (typeof histData !== 'undefined' ? histData.length : 0),
      posicion_cosecha: posicionCosecha(prod),
    };
    if (est.posicion_cosecha) {
      const suby = Object.keys(SUBY).find(k => SUBY[k] === prod);
      est.futuro = opcData.fut[suby + '|' + est.posicion_cosecha] ?? null;
      est.vol_historica = volHistDe(prod, est.posicion_cosecha);
      est.tasa_usd = tasaUsdUnica().r;
    }
    est.resultado = window.calcularBooster(prod);
    console.log('[booster]', est);
    return est;
  };

  window.boosterAuditoria = function (prod) {
    const b = window.calcularBooster(prod);
    if (!b) return null;
    const r4 = n => Math.round(n * 10000) / 10000;
    return {
      calculado_en: new Date().toISOString(),
      producto: prod,
      posicion: b.pos,
      expiracion: b.vto.toISOString().slice(0, 10),
      dias: b.dias,
      insumos: {
        futuro: r4(b.F), tasa_usd: r4(b.r), modelo: 'black76', paso_strike: 4,
        // Paridad TAMAR/DLR al plazo de la opción, antes del piso en cero. Si
        // `tasa_pisada` es true, el descuento se hizo con 0% a propósito.
        tasa_usd_cruda: b.tasaCruda != null ? r4(b.tasaCruda) : null,
        tasa_pisada: !!b.tasaPisada,
        vol_call: r4(b.volC), base_vol_call: b.baseC,     // iv = implícita de mercado · hist = histórica
        vol_put:  r4(b.volP), base_vol_put:  b.baseP,
        vol_historica: b.vh != null ? r4(b.vh) : null,
        haircut_venta: b.haircut, tope_prob_cierre: b.topePx,
        primas_descartadas: b.descartadas,               // ajustes de A3 que violaban no-arbitraje
      },
      call: { strike: b.duplo,  prima: r4(b.primaC.v), strike_listado: b.primaC.src === 'list' },
      put:  { strike: b.cierre, prima: r4(b.primaP.v), strike_listado: b.primaP.src === 'list' },
      resultado: {
        duplo: b.duplo, cierre: b.cierre, plus: r4(b.plus),
        futuro_mas_plus: r4(b.F + b.plus),
        excedente: r4(b.excedente),
        prob_cierre: r4(b.probCierre),
        duplo_sobre_futuro: r4(b.duplo / b.F - 1),
        cierre_bajo_futuro: r4(b.cierre / b.F - 1),
        tope_escalera: b.topeEscalera,
        tope_sin_candidatos: b.topeVacio,
      },
      frontera: b.frontera.map(x => ({
        duplo: x.duplo, cierre: x.cierre,
        prob_cierre: r4(x.probCierre), excedente: r4(x.excedente), elegido: x.elegido,
      })),
    };
  };

  // Tabla de la frontera eficiente. Son los únicos pares que tiene sentido
  // comparar: para cada CIERRE, el DUPLO más alto que las primas financian,
  // quedándose solo con los que no están dominados. Se muestra para que el
  // productor vea el canje —cuánto DUPLO cuesta bajar el riesgo del ✕— sin
  // tener que operar ningún control: el panel diagnostica, no ejecuta.
  function bstFronteraHTML(b, f1, pct) {
    if (!b.frontera || b.frontera.length < 2) return '';
    const filas = b.frontera.map(x => `<tr class="${x.elegido ? 'on' : ''}">
        <td>${x.elegido ? 'Elegido' : ''}</td>
        <td>${f1(x.duplo)}</td>
        <td>+${((x.duplo / b.F - 1) * 100).toLocaleString('es-AR', { maximumFractionDigits:1 })}%</td>
        <td>${f1(x.cierre)}</td>
        <td>${pct(x.probCierre)}</td>
      </tr>`).join('');
    return `<div class="bst-fr">
      <div class="bst-fr-t">Alternativas de la posición</div>
      <table>
        <thead><tr><th></th><th>Duplo</th><th>Sobre fut.</th><th>Cierre</th><th>Prob. ✕</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="bst-fr-n">Un DUPLO más alto siempre se paga con un CIERRE más cerca del futuro, o sea con
      más probabilidad de quedar comprometido sin precio. Se destaca la combinación que mantiene esa
      probabilidad por debajo del ${pct(b.topePx)}.</div>
    </div>`;
  }

  /* Registro de la valuación ────────────────────────────────────────────────
     Se guarda lo que el panel le mostró al productor, con sus insumos. Es
     trazabilidad de asesoramiento: si dentro de seis meses pregunta por qué tal
     día le marcamos DUPLO 368 y CIERRE 296, la respuesta tiene que estar
     guardada y no reconstruida con los precios de hoy.

     Se escribe al abrir el detalle —un acto explícito del productor—, no en
     cada render del banner. Una fila por producto, posición y día: el upsert
     pisa la del día, que es la que vale.

     Nunca puede romper el panel: si la tabla no está migrada todavía o el
     cliente no está identificado, se sale en silencio. Un registro de auditoría
     que tira abajo la pantalla que audita no sirve para nada.                */
  const _bstRegistradas = new Set();
  function bstRegistrar(prod) {
    try {
      if (typeof sb === 'undefined' || !sb) return;
      const cli = (typeof currentCliente !== 'undefined' && currentCliente) ? currentCliente.id : null;
      if (!cli) return;
      const a = window.boosterAuditoria(prod);
      if (!a) return;
      const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' });
      const clave = cli + '|' + prod + '|' + a.posicion + '|' + dia;
      if (_bstRegistradas.has(clave)) return;      // ya se escribió en esta sesión
      _bstRegistradas.add(clave);
      const i = a.insumos, res = a.resultado;
      sb.from('booster_valuaciones').upsert({
        cliente_id: cli, dia: dia,
        producto: a.producto, posicion: a.posicion,
        expiracion: a.expiracion, dias: a.dias,
        futuro: i.futuro, tasa_usd: i.tasa_usd,
        vol_call: i.vol_call, vol_put: i.vol_put,
        base_vol_call: i.base_vol_call, base_vol_put: i.base_vol_put,
        vol_historica: i.vol_historica, primas_descartadas: i.primas_descartadas,
        duplo: res.duplo, cierre: res.cierre, plus: res.plus,
        excedente: res.excedente, prob_cierre: res.prob_cierre,
        tope_escalera: res.tope_escalera,
        auditoria: a,
      }, { onConflict: 'cliente_id,producto,posicion,dia' })
        .then(function (r) {
          // Si la tabla todavía no existe, se desactiva para lo que queda de
          // sesión en vez de reintentar en cada apertura.
          if (r && r.error) _bstRegistroOff = true;
        }, function () { _bstRegistroOff = true; });
    } catch (e) { /* el registro nunca interrumpe el panel */ }
  }
  let _bstRegistroOff = false;

  window.boosterDetalle = function (prod) {
    const b = window.calcularBooster(prod);
    if (!b) return;
    if (!_bstRegistroOff) bstRegistrar(prod);
    const f1 = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits:1 });
    const fecha = d => d.toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'});
    const pct = n => (n * 100).toLocaleString('es-AR', { maximumFractionDigits:0 }) + '%';
    const pct1 = n => (n * 100).toLocaleString('es-AR', { maximumFractionDigits:1 }) + '%';
    const ov = document.createElement('div');
    ov.className = 'bst-ov';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = `<div class="bst-card">
      <h3>Booster</h3>
      <div style="font-size:12px;color:var(--gris);margin-bottom:16px">Análisis informativo de escenarios — no es recomendación de inversión.</div>
      <div class="bst-row"><span>Posición</span><b>${prod} ${b.pos.split('_')[0]}/${b.pos.split('_')[1]}</b></div>
      <div class="bst-row"><span>Inicio</span><b>${fecha(new Date())}</b></div>
      <div class="bst-row"><span>Expiración de la estrategia</span><b>${fecha(b.vto)}</b></div>
      <div class="bst-row"><span>Días</span><b>${b.dias}</b></div>
      <div class="bst-row"><span>Futuro subyacente</span><b>${f1(b.F)} U$S/tn</b></div>
      <div class="bst-row"><span>Volatilidad usada</span><b>${pct1(b.volC)} call · ${pct1(b.volP)} put</b></div>
      <div class="tasas-nota" style="margin:10px 0 0">
        Las primas se valúan con <b>Black-76</b> sobre la volatilidad ${b.baseC==='iv'?'<b>implícita del mercado</b> de la posición':'histórica del futuro'},
        con un descuento de venta del ${pct(b.haircut)} (el productor cobra la punta compradora, no el ajuste).
        ${b.descartadas ? '<br>Se descartaron <b>'+b.descartadas+'</b> primas de A3 por quedar debajo del valor intrínseco o romper la progresión de la cadena.' : ''}
        ${b.sintetico ? '<br>Operación <b>OTC</b>: al menos uno de los strikes no cotiza en A3.' : ''}
        ${b.topeEscalera ? '<br><b>Atención:</b> el DUPLO quedó en el borde de la escalera de strikes (±18% del futuro); podría haber uno más alto fuera de ese rango.' : ''}
      </div>
      <div class="bst-big">
        <div><span>Duplo</span><b>${f1(b.duplo)}</b><small>U$S / tn.</small></div>
        <div><span>Cierre</span><b>${f1(b.cierre)}</b><small>U$S / tn.</small></div>
      </div>
      <div class="bst-row"><span>DUPLO sobre el futuro</span><b>+${pct1(b.duplo/b.F-1)}</b></div>
      <div class="bst-row"><span>Plus cobrado (primas netas)</span><b>${f1(b.plus)} U$S/tn</b></div>
      <div class="bst-row"><span>Excedente sobre el DUPLO</span><b>${f1(b.excedente)} U$S/tn</b></div>
      <div class="bst-row"><span>Probabilidad del escenario ✕</span><b style="color:${b.probCierre>b.topePx?'var(--rojo)':'var(--texto)'}">${pct(b.probCierre)}</b></div>
      ${b.topeVacio ? '<div class="tasas-nota" style="margin:10px 0 0;color:var(--oro-l)">Ninguna combinación de la posición queda por debajo del tope de '+pct(b.topePx)+' para el escenario ✕. Se muestra la más defensiva disponible.</div>' : ''}
      ${bstDiagrama(b)}
      ${bstFronteraHTML(b, f1, pct)}
      <p style="font-size:14px;line-height:1.6;margin:18px 0 8px">El día de contratación el precio cerrado es sensiblemente superior a los valores del forward. Ese precio contratado es el <b>DUPLO</b>. El volumen contratado dependerá del precio de la posición el día de expiración.</p>
      <div class="bst-esc"><i>✕</i><div>Si el precio baja hasta el <b>CIERRE</b>, el volumen es el pactado originalmente y queda comprometido <b>sin precio fijado</b>.</div></div>
      <div class="bst-esc"><i>x1</i><div>Si el precio está por debajo del <b>DUPLO</b>, el volumen es el pactado originalmente al precio del DUPLO.</div></div>
      <div class="bst-esc"><i>x2</i><div>Si el precio está por encima del <b>DUPLO</b>, el volumen a entregar <b>se duplica</b> al precio del DUPLO.</div></div>
      <div style="text-align:right;margin-top:20px"><button onclick="this.closest('.bst-ov').remove()" style="background:var(--oro);border:none;color:#0f2740;font-size:15px;font-weight:700;padding:12px 22px;border-radius:12px;cursor:pointer">Cerrar</button></div>
    </div>`;
    document.body.appendChild(ov);
    // arranca la secuencia una vez montado en el DOM (getTotalLength necesita layout)
    requestAnimationFrame(() => bstdAnimar(ov.querySelector('.bstd-wrap')));
  };


  // Futuros VIGENTES de un producto, con su precio, volatilidad histórica anual
  // y el tiempo al vencimiento en años. Lo consume el módulo de riesgo productivo.
  window.ctxFuturosVigentes = function (producto) {
    try {
      if (typeof opcData === 'undefined' || !opcData.loaded) return [];
      const suby = Object.keys(SUBY).find(k => SUBY[k] === producto);
      if (!suby) return [];
      const vtos = [...new Set(
        Object.keys(opcData.fut)
          .filter(k => k.indexOf(suby + '|') === 0)
          .map(k => k.split('|')[1])
      )].filter(v => opcVtoVigente(v));
      const MES = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      return vtos.map(v => {
        const [m, a] = v.split('_').map(Number);
        const t = tiempoAlVto(vencimientoOpcion(m, a));
        return {
          vto: v,
          label: MES[m] + '-' + String(a).slice(2),
          precio: opcData.fut[suby + '|' + v],
          volAnual: volHistDe(producto, v),
          anios: t
        };
      }).filter(x => x.precio != null && x.precio > 0)
        .sort((x, y) => x.anios - y.anios);
    } catch (e) { return []; }
  };

  window._opcSetProd = p => { _opcProd = p; _opcVto = null; renderOpciones(); };
  window._opcSetVto  = v => { _opcVto = v; renderOpciones(); };
  window.renderOpciones = renderOpciones;

  // ── Exponer el analizador de estrategias (llamado desde onclick del HTML) ──
  window.estrAgregarPata = estrAgregarPata;
  window.estrEliminarPata = estrEliminarPata;
  window.estrEditarPata = estrEditarPata;
  window.estrRender = estrRender;
  window.estrRenderPatas = estrRenderPatas;
  window.estrSetVista = estrSetVista;
  window.estrRefrescar = estrRefrescar;
  window.estrInitSiHaceFalta = estrInitSiHaceFalta;
  window.estrToggleGuia = estrToggleGuia;
  window.gexGenerar = gexGenerar;
  window.estrDteView = estrDteView;
})();
