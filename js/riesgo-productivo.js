/* ===== RIESGO PRODUCTIVO: motor + interfaz (Agricultura PRO) ===== */
/* ============================================================
   MOTOR DE RIESGO PRODUCTIVO (Markowitz sobre rindes)
   Trabaja con rindes físicos (qq/ha), sin precios.
   - Métricas individuales por cultivo (media, desvío, CV, P10, CVaR)
   - Shocks relativos (rinde/media - 1) para comparar escalas
   - Matriz de correlación y covarianza
   - Cartera de mínima varianza (inversión de matriz)
   ============================================================ */

// ---- Estadística básica ----
function rpMedia(xs){ var v=xs.filter(function(x){return x!=null&&isFinite(x);}); return v.length? v.reduce(function(a,b){return a+b;},0)/v.length : NaN; }
function rpDesvio(xs){ // desvío muestral (STDEV, n-1)
  var v=xs.filter(function(x){return x!=null&&isFinite(x);});
  if(v.length<2) return NaN;
  var m=rpMedia(v);
  var s=v.reduce(function(a,x){return a+(x-m)*(x-m);},0);
  return Math.sqrt(s/(v.length-1));
}
function rpPercentil(xs, p){ // PERCENTILE.INC
  var v=xs.filter(function(x){return x!=null&&isFinite(x);}).sort(function(a,b){return a-b;});
  if(!v.length) return NaN;
  if(v.length===1) return v[0];
  var idx=p*(v.length-1), lo=Math.floor(idx), hi=Math.ceil(idx);
  if(lo===hi) return v[lo];
  return v[lo]+(v[hi]-v[lo])*(idx-lo);
}
function rpCVaR(xs, p){ // media de los valores <= percentil p (cola inferior)
  var v=xs.filter(function(x){return x!=null&&isFinite(x);});
  if(!v.length) return NaN;
  var umbral=rpPercentil(v,p);
  var cola=v.filter(function(x){return x<=umbral;});
  return cola.length? rpMedia(cola) : umbral;
}
function rpCount(xs){ return xs.filter(function(x){return x!=null&&isFinite(x);}).length; }

// ---- Métricas de riesgo individual por cultivo ----
function rpRiesgoIndividual(serie){
  var m=rpMedia(serie), sd=rpDesvio(serie), n=rpCount(serie);
  var p10=rpPercentil(serie,0.1), cvar=rpCVaR(serie,0.1);
  var vals=serie.filter(function(x){return x!=null&&isFinite(x);});
  var peor= vals.length? Math.min.apply(null,vals)/m-1 : NaN;
  var freqMalas = vals.length? vals.filter(function(x){return x<0.8*m;}).length/n : NaN;
  var cv = (m&&m!==0)? sd/m : NaN;
  var nivel = !isFinite(cv)?'n.a.' : cv<0.25?'Bajo' : cv<0.35?'Medio' : 'Alto';
  return { n:n, mediaQq:m, mediaTn:m/10, desvio:sd, cv:cv, p10:p10, cvar:cvar, peorVsMedia:peor, freqMalas:freqMalas, nivelCV:nivel };
}

// ---- Shock relativo: rinde/media - 1 (por campaña) ----
function rpShocks(serie){
  var m=rpMedia(serie);
  return serie.map(function(x){ return (x!=null&&isFinite(x)&&m)? x/m-1 : null; });
}

// ---- Correlación entre dos series de shocks (solo campañas con dato en ambas) ----
function rpCorrel(a, b){
  var pares=[];
  for(var i=0;i<a.length;i++){ if(a[i]!=null&&isFinite(a[i])&&b[i]!=null&&isFinite(b[i])) pares.push([a[i],b[i]]); }
  if(pares.length<2) return NaN;
  var xa=pares.map(function(p){return p[0];}), xb=pares.map(function(p){return p[1];});
  var ma=rpMedia(xa), mb=rpMedia(xb);
  var num=0, da=0, db=0;
  for(var i=0;i<pares.length;i++){ num+=(xa[i]-ma)*(xb[i]-mb); da+=(xa[i]-ma)*(xa[i]-ma); db+=(xb[i]-mb)*(xb[i]-mb); }
  return (da&&db)? num/Math.sqrt(da*db) : NaN;
}

// ---- Inversión de matriz (Gauss-Jordan) ----
function rpInversa(M){
  var n=M.length;
  var A=M.map(function(row,i){ return row.concat(row.map(function(_,j){return i===j?1:0;})); });
  for(var col=0;col<n;col++){
    // pivote
    var piv=col;
    for(var r=col+1;r<n;r++){ if(Math.abs(A[r][col])>Math.abs(A[piv][col])) piv=r; }
    if(Math.abs(A[piv][col])<1e-12) return null; // singular
    var tmp=A[col]; A[col]=A[piv]; A[piv]=tmp;
    var d=A[col][col];
    for(var k=0;k<2*n;k++) A[col][k]/=d;
    for(var r=0;r<n;r++){ if(r!==col){ var f=A[r][col]; for(var k=0;k<2*n;k++) A[r][k]-=f*A[col][k]; } }
  }
  return A.map(function(row){ return row.slice(n); });
}

// ---- Producto matriz × vector ----
function rpMatVec(M, v){ return M.map(function(row){ return row.reduce(function(a,x,i){return a+x*v[i];},0); }); }

// ---- Cartera de mínima varianza: w = inv(Σ)·1 / (1ᵀ·inv(Σ)·1) ----
function rpMinVarianza(cov){
  var n=cov.length;
  var inv=rpInversa(cov);
  if(!inv) return null;
  var unos=[]; for(var i=0;i<n;i++) unos.push(1);
  var z=rpMatVec(inv, unos);
  var suma=z.reduce(function(a,x){return a+x;},0);
  if(!suma) return null;
  return z.map(function(x){ return x/suma; });
}


// ---- Proyección sobre el símplex {w >= 0, suma w = 1} ----
function rpProyectarSimplex(v){
  var n=v.length, u=v.slice().sort(function(a,b){return b-a;});
  var css=0, rho=-1, theta=0;
  for(var i=0;i<n;i++){
    css+=u[i];
    var t=(css-1)/(i+1);
    if(u[i]-t>0){ rho=i; theta=t; }
  }
  if(rho<0) theta=(v.reduce(function(a,b){return a+b;},0)-1)/n;
  return v.map(function(x){ return Math.max(0, x-theta); });
}

// ---- Mínima varianza SOLO LARGO (0% a 100% por cultivo) ----
// El óptimo sin restricciones puede dar pesos negativos o superiores a 100%
// (matemáticamente válidos, agronómicamente imposibles: no se siembran hectáreas
// negativas). Acá se minimiza w'Σw con w>=0 y suma(w)=1 por descenso proyectado.
function rpMinVarianzaLongOnly(cov){
  var n=cov.length;
  if(!n) return null;
  var w=[], i, j; for(i=0;i<n;i++) w.push(1/n);
  var maxDiag=0; for(i=0;i<n;i++) maxDiag=Math.max(maxDiag, Math.abs(cov[i][i]));
  var lr = maxDiag>0 ? 1/(4*maxDiag) : 0.1;
  for(var it=0; it<4000; it++){
    var grad=[];
    for(i=0;i<n;i++){ var g=0; for(j=0;j<n;j++) g+=2*cov[i][j]*w[j]; grad.push(g); }
    var nw=[]; for(i=0;i<n;i++) nw.push(w[i]-lr*grad[i]);
    nw=rpProyectarSimplex(nw);
    var dif=0; for(i=0;i<n;i++) dif+=Math.abs(nw[i]-w[i]);
    w=nw;
    if(dif<1e-10) break;
  }
  return w;
}

// ---- Riesgo (desvío) de una cartera dado pesos y covarianza ----
function rpRiesgoCartera(pesos, cov){
  var n=pesos.length, s=0;
  for(var i=0;i<n;i++) for(var j=0;j<n;j++) s+=pesos[i]*pesos[j]*cov[i][j];
  return Math.sqrt(Math.max(s,0));
}


// ---- Covarianza por PARES COMPLETOS (solo campañas donde ambos tienen dato) ----
// Estadísticamente correcto: desvío y correlación se miden sobre el MISMO conjunto
// de campañas comunes, evitando mezclar períodos distintos.
function rpParesComunes(a, b){
  var xa=[], xb=[];
  for(var i=0;i<a.length;i++){
    if(a[i]!=null&&isFinite(a[i])&&b[i]!=null&&isFinite(b[i])){ xa.push(a[i]); xb.push(b[i]); }
  }
  return { a:xa, b:xb, n:xa.length };
}
function rpCovar(shocksA, shocksB){
  var par = rpParesComunes(shocksA, shocksB);
  if(par.n < 2) return { cov:NaN, n:par.n };
  var corr = rpCorrel(shocksA, shocksB);           // ya usa pares comunes
  var da = rpDesvio(par.a), db = rpDesvio(par.b);  // desvíos SOBRE las campañas comunes
  return { cov: corr*da*db, n:par.n, corr:corr };
}
// Matriz de covarianza y matriz de conteo de campañas comunes, para un set de series de shocks
function rpMatrizCov(listaShocks){
  var n=listaShocks.length, cov=[], comunes=[];
  for(var i=0;i<n;i++){ cov[i]=[]; comunes[i]=[]; for(var j=0;j<n;j++){
    var r=rpCovar(listaShocks[i], listaShocks[j]);
    cov[i][j]=r.cov; comunes[i][j]=r.n;
  }}
  return { cov:cov, comunes:comunes };
}




/* ============================================================
   RIESGO PRODUCTIVO — Interfaz (pasos 1 y 2)
   1) Carga de rindes históricos: grilla editable + pegar desde Excel
   2) Tabla de riesgo individual por cultivo
   Solo Agricultura PRO. Usa el motor rp* (Markowitz sobre rindes).
   ============================================================ */

/* ============================================================
   PRECARGA DE RINDES POR DEPARTAMENTO / PARTIDO
   ------------------------------------------------------------
   Fuente: estimaciones agrícolas por departamento del Ministerio
   (serie 1990/91 en adelante), empaquetada en un JSON por provincia
   bajo datos/rindes/. Se baja solo la provincia elegida.

   POR QUE 15 CAMPAÑAS POR DEFECTO, Y NO TODA LA SERIE:
   El rinde departamental tiene tendencia tecnológica. Medido sobre
   estos mismos datos, el maíz sube 88 kg/ha por año: tomando las 35
   campañas el CV da 22,0%, y descontando la tendencia, 13,3%. O sea
   que la serie larga INFLA el riesgo medido un 65% y manda al maíz a
   "Alto" cuando en realidad es "Medio/Bajo". En trigo infla 36%.
   Con las últimas 15 campañas esa distorsión desaparece (1% en maíz
   y soja, 10% en trigo) y todavía quedan datos de sobra para el P10.
   Menos de 15 tampoco conviene: con 10 la muestra es tan corta que
   las medidas de cola se vuelven inestables.
   ============================================================ */

/* ============================================================
   MAPA DE CALOR DE RIESGO POR DEPARTAMENTO
   ------------------------------------------------------------
   Mientras no esté la geometría para el mapa real, la misma lectura
   en tabla: los departamentos ordenados por variabilidad, pintados
   con una escala común.

   QUÉ SE PINTA Y POR QUÉ:
   No el rinde. Un mapa de rindes redibuja el suelo y la lluvia, que
   el productor ya conoce. Lo que nadie tiene a mano es el RIESGO: la
   variabilidad del rinde del departamento. Medido sobre esta misma
   base, va de 15% a 33% en soja y de 15% a 36% en maíz — un rango de
   2,2 a 2,5 veces entre el más parejo y el más errático.

   LA ESCALA:
   Divergente azul↔rojo con el gris en la mediana, no verde↔rojo: el
   par verde/rojo es justo el que no distingue un daltónico, y acá el
   color ordena 300 celdas. Los cortes son FIJOS, no relativos a lo que
   estás mirando: así el color significa lo mismo cambiando de cultivo
   o de provincia, y filtrar no repinta lo que quedó. Salen de la
   distribución real medida (p10 ≈ 15%, mediana ≈ 22%, p90 ≈ 34%, casi
   idéntica en soja, maíz y trigo).
   Además cada celda imprime su número: el color nunca es el único canal.
   ============================================================ */

/* ============================================================
   MAPA — el mismo riesgo de la tabla, sobre los departamentos
   ------------------------------------------------------------
   Geometría: IGN vía georef (datos.gob.ar), simplificada con
   topología compartida. Dos niveles de detalle, elegidos por el
   píxel y no por el gusto: a 700 px de ancho, el país entra con un
   píxel ≈ 5 km y una provincia con un píxel ≈ 1 km.

   SVG propio, sin tiles ni librería: funciona sin señal dentro del
   cache del service worker y no depende de que un proveedor de
   mapas siga vivo. Misma escala, mismos cortes y mismos datos que
   la tabla — lo único que cambia es que en vez de filas son
   polígonos.
   ============================================================ */

var MAPA = { cache: {}, vista: 'tabla' };

// El Ministerio todavía usa el código viejo de Chascomús; georef usa el nuevo.
// Verificado: mismo nombre, misma provincia, y Lezama —el partido que se separó
// de Chascomús— coincide en las dos fuentes.
var GEO_ALIAS = { '06217': '06218' };
function geoId(did){ return GEO_ALIAS[did] || did; }

function mapaGeo(clave){
  if(MAPA.cache[clave]) return Promise.resolve(MAPA.cache[clave]);
  return fetch('/agro-reporte/datos/geo/' + clave + '.json', { cache:'force-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){ if(j) MAPA.cache[clave] = j; return j; });
}

function hmVista(v){
  MAPA.vista = v;
  var t = document.getElementById('hm_tab_tabla'), m = document.getElementById('hm_tab_mapa');
  if(t) t.className = (v === 'tabla' ? 'on' : '');
  if(m) m.className = (v === 'mapa' ? 'on' : '');
  hmRender();
}

/* ---------- Proyección ---------- */
// Equirectangular con corrección por latitud. Argentina es mucho más larga de
// norte a sur que de este a oeste: sin el coseno, el país sale aplastado.
function mapaProyector(feats, ancho, altoMax){
  var lo0 = 180, lo1 = -180, la0 = 90, la1 = -90;
  feats.forEach(function(f){
    mapaAnillos(f).forEach(function(r){
      r.forEach(function(p){
        if(p[0] < lo0) lo0 = p[0]; if(p[0] > lo1) lo1 = p[0];
        if(p[1] < la0) la0 = p[1]; if(p[1] > la1) la1 = p[1];
      });
    });
  });
  var k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
  var x0 = lo0 * k, x1 = lo1 * k, y0 = -la1, y1 = -la0;
  var esc = Math.min(ancho / (x1 - x0), altoMax / (y1 - y0));
  var dx = (ancho - (x1 - x0) * esc) / 2;
  return {
    w: ancho, h: (y1 - y0) * esc,
    px: function(p){ return [ (p[0]*k - x0)*esc + dx, (-p[1] - y0)*esc ]; }
  };
}
function mapaAnillos(f){
  var g = f.geometry;
  if(!g) return [];
  return g.type === 'Polygon' ? g.coordinates
       : g.coordinates.reduce(function(a, p){ return a.concat(p); }, []);
}
function mapaPath(f, pr){
  var g = f.geometry; if(!g) return '';
  var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  var d = '';
  polys.forEach(function(poly){
    poly.forEach(function(r){
      for(var i = 0; i < r.length; i++){
        var q = pr.px(r[i]);
        d += (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1);
      }
      d += 'Z';
    });
  });
  return d;
}

/* ---------- Render ---------- */
function mapaRender(box, filas, cult, nCamp, pid){
  var porId = {};
  filas.forEach(function(f){ porId[geoId(f.did)] = f; });
  var clave = pid || 'pais';

  box.innerHTML = '<div class="hm-cargando">Dibujando el mapa…</div>';
  mapaGeo(clave).then(function(geo){
    if(!geo){ box.innerHTML = '<div class="rp-vacio">No se pudo traer la geometría.</div>'; return; }
    var ancho = Math.max(320, Math.min(760, (box.clientWidth || 700) - 4));
    // El encuadre se calcula SOLO con los departamentos que tienen dato. Si se
    // usaran todos, la Antártida y las islas del Atlántico Sur estiran el mapa
    // y el área agrícola queda del tamaño de una estampilla. Lo que caiga fuera
    // del encuadre se dibuja igual y lo recorta el viewBox.
    var marco = geo.features.filter(function(f){ return porId[f.properties.id]; });
    if(marco.length < 3) marco = geo.features;
    var pr = mapaProyector(marco, ancho, pid ? 620 : 900);
    var elegido = document.getElementById('rpz_dep') ? geoId(document.getElementById('rpz_dep').value) : '';

    var conDato = 0, paths = '';
    geo.features.forEach(function(f){
      var id = f.properties.id, d = porId[id];
      var nom = f.properties.n || (d ? d.dep : id);
      var fill, titulo;
      if(d){
        conDato++;
        var b = hmBanda(d.cv);
        fill = b.c;
        titulo = nom + ' · ' + b.n + ' · ' + rpFmt(d.cv*100,1) + '% de variabilidad · '
               + rpFmt(d.media/100,1) + ' qq/ha de media en ' + d.n + ' campañas';
      } else {
        fill = 'rgba(255,255,255,.055)';
        titulo = nom + ' · sin datos de ' + cult;
      }
      paths += '<path d="' + mapaPath(f, pr) + '" fill="' + fill + '" fill-rule="evenodd"'
            +  (id === elegido ? ' class="mp-mio"' : '')
            +  '><title>' + titulo + '</title></path>';
    });

    var h = '<div class="mp-wrap"><svg viewBox="0 0 ' + pr.w + ' ' + pr.h.toFixed(0) + '" '
          + 'width="100%" preserveAspectRatio="xMidYMid meet" class="mp-svg">'
          + 'style="overflow:hidden">'
          + '<g stroke="rgba(13,32,53,.75)" stroke-width="0.4">' + paths + '</g></svg></div>';
    h += '<div class="rp-glosario">' + conDato + ' de ' + geo.features.length
      +  ' departamentos tienen 8 o más campañas de <b>' + cult + '</b> en las últimas ' + nCamp
      +  '; los grises no. Pasá el mouse por encima para ver el número de cada uno. '
      +  'Son promedios del departamento: tu lote varía más que esto.</div>';
    box.insertAdjacentHTML('beforeend', h);
    box.querySelector('.hm-cargando').remove();
  });
}


var HM = { cache: {}, cargando: false };

// Cortes fijos de variabilidad y su paso de color. Brazo frío = más parejo que
// la mediana, brazo cálido = más errático. El centro recede contra el fondo.
/* Paleta de riesgo. Reemplaza a la divergente azul<->naranja, que tenia tres
   bandas por debajo de 2:1 contra el fondo de las tarjetas y se empastaba.

   POR QUE NO VERDE<->ROJO PURO: es el par que no distingue una persona con
   deficiencia rojo-verde (~8% de los hombres), y aca el color ordena ~300
   departamentos. Simulado con Vienot-Brettel-Mollon, una rampa verde->rojo de
   7 bandas colapsa a un campo de oliva con dE2000 de 3,2 entre bandas
   contiguas: ilegible. Por eso el extremo bueno arranca en AZUL y VERDE
   AZULADO, que conservan el eje azul-amarillo, el unico que sobrevive.

   MEDIDO sobre el fondo #1a3349: ninguna banda baja de 3:1, dE2000 minimo
   entre contiguas 15,7 en vision normal y 6,9 en el peor caso daltonico.

   EL EXTREMO ES EL MAS LUMINOSO, no el mas oscuro: sobre un panel oscuro la
   convencion se invierte. Un granate (#7E0E08) medido daba 1,21:1 — se hundia
   justo en la banda que tiene que gritar.

   Texto oscuro en todas; en Extremo, negro puro: #0d2035 sobre ese rojo da
   4,30:1 y no alcanza el 4,5:1 que pide un texto chico, el negro da 5,44:1. */
var HM_BANDAS = [
  { max: 0.15, c:'#3ba5ff', t:'#0d2035', n:'Muy estable' },
  { max: 0.19, c:'#00b5b0', t:'#0d2035', n:'Estable' },
  { max: 0.22, c:'#89fa9e', t:'#0d2035', n:'Algo más parejo' },
  { max: 0.26, c:'#f0fa73', t:'#0d2035', n:'En la media' },
  { max: 0.31, c:'#ffab00', t:'#0d2035', n:'Inestable' },
  { max: 0.38, c:'#ff7a33', t:'#0d2035', n:'Muy inestable' },
  { max: 99,   c:'#fa2e23', t:'#000000', n:'Extremo' }
];
function hmBanda(cv){
  for(var i = 0; i < HM_BANDAS.length; i++) if(cv < HM_BANDAS[i].max) return HM_BANDAS[i];
  return HM_BANDAS[HM_BANDAS.length - 1];
}

/* ---------- Estadística ---------- */
function hmMedia(xs){ return xs.reduce(function(a,b){ return a+b; }, 0) / xs.length; }
function hmCV(xs){
  if(xs.length < 8) return null;
  var m = hmMedia(xs);
  if(!m) return null;
  var s = xs.reduce(function(a,x){ return a + (x-m)*(x-m); }, 0) / (xs.length - 1);
  return Math.sqrt(s) / m;
}

/* ---------- Datos ---------- */
// Una provincia se baja una sola vez por sesión.
function hmProvincia(pid){
  if(HM.cache[pid]) return Promise.resolve(HM.cache[pid]);
  return fetch('/agro-reporte/datos/rindes/' + pid + '.json', { cache:'force-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){ if(j) HM.cache[pid] = j; return j; });
}

function hmInit(){
  var sel = document.getElementById('hm_prov');
  if(!sel || !RPZ.index || sel.dataset.listo) return;
  var h = '<option value="">Todo el país</option>';
  RPZ.index.provincias.forEach(function(p){ h += '<option value="' + p.id + '">' + p.n + '</option>'; });
  sel.innerHTML = h;
  sel.dataset.listo = '1';
  // El cultivo sale del catálogo nacional, no de una provincia suelta.
  var sc = document.getElementById('hm_cult');
  if(sc && !sc.dataset.listo){
    ['Soja 1ra','Maíz','Trigo','Girasol','Sorgo','Soja 2da','Cebada cervecera','Avena','Centeno','Maní','Sorgo']
      .filter(function(v,i,a){ return a.indexOf(v) === i; })
      .forEach(function(c){ sc.innerHTML += '<option value="' + c + '">' + c + '</option>'; });
    sc.dataset.listo = '1';
  }
}

function hmRender(){
  var box = document.getElementById('hm_body');
  if(!box) return;
  hmInit();
  var cult = document.getElementById('hm_cult').value;
  var pid  = document.getElementById('hm_prov').value;
  var nCamp = parseInt(document.getElementById('hm_camp').value, 10) || 15;
  var ids = pid ? [pid] : RPZ.index.provincias.map(function(p){ return p.id; });

  box.innerHTML = '<div class="hm-cargando">Calculando…</div>';
  HM.cargando = true;
  Promise.all(ids.map(hmProvincia)).then(function(provs){
    HM.cargando = false;
    var filas = [];
    provs.filter(Boolean).forEach(function(j){
      var ci = j.c.indexOf(cult);
      if(ci < 0) return;
      var desde = Math.max(0, j.k.length - nCamp);
      Object.keys(j.d).forEach(function(did){
        var s = j.d[did].s[String(ci)];
        if(!s) return;
        var serie = s.slice(desde).filter(function(x){ return x > 0; });
        var cv = hmCV(serie);
        if(cv == null) return;
        // "sin definir" es el cajón de sastre del Ministerio para la producción
        // que no se asignó a ningún departamento: no es un lugar y no se mapea.
        if(/^sin definir$/i.test((j.d[did].n || '').trim())) return;
        var media = hmMedia(serie);
        var peor = Math.min.apply(null, serie);
        filas.push({ prov:j.p, dep:j.d[did].n, did:did, n:serie.length,
                     cv:cv, media:media, peor: peor/media - 1 });
      });
    });

    if(!filas.length){
      box.innerHTML = '<div class="rp-vacio">No hay departamentos con al menos 8 campañas de ' + cult
        + ' en la ventana elegida.</div>';
      return;
    }
    filas.sort(function(a,b){ return a.cv - b.cv; });
    var cvs = filas.map(function(f){ return f.cv; }).sort(function(a,b){ return a-b; });
    var mediana = cvs[Math.floor(cvs.length/2)];
    var elegido = (RPZ.prov && document.getElementById('rpz_dep')) ? document.getElementById('rpz_dep').value : '';

    var h = '<div class="hm-resumen">' + filas.length + ' departamentos con 8 o más campañas de <b>' + cult
      + '</b> en las últimas ' + nCamp + '. Variabilidad mediana <b>' + rpFmt(mediana*100,1) + '%</b>, '
      + 'del <b>' + rpFmt(cvs[0]*100,1) + '%</b> al <b>' + rpFmt(cvs[cvs.length-1]*100,1) + '%</b>.</div>';

    // Leyenda: el color nunca va solo, y acá dice qué significa cada paso.
    h += '<div class="hm-leyenda"><span class="k">Variabilidad del rinde</span>';
    HM_BANDAS.forEach(function(b, i){
      var desde = i === 0 ? 0 : HM_BANDAS[i-1].max;
      h += '<span class="hm-chip" style="background:' + b.c + ';color:' + b.t + '">'
        +  b.n + ' <small>' + (i === 0 ? '<' + Math.round(b.max*100)
             : (i === HM_BANDAS.length-1 ? '≥' + Math.round(desde*100)
                : Math.round(desde*100) + '–' + Math.round(b.max*100))) + '%</small></span>';
    });
    h += '</div>';

    if(MAPA.vista === 'mapa'){
      box.innerHTML = h;
      var cont = document.createElement('div');
      box.appendChild(cont);
      mapaRender(cont, filas, cult, nCamp, pid);
      return;
    }

    h += '<div class="hm-wrap"><table class="hm-tabla"><thead><tr>'
      +  '<th class="hm-rank">#</th><th>Departamento</th><th>Provincia</th>'
      +  '<th>Campañas</th><th>Rinde medio<br><small>qq/ha</small></th>'
      +  '<th>Peor campaña<br><small>vs su media</small></th>'
      +  '<th class="hm-cv">Variabilidad</th></tr></thead><tbody>';
    filas.forEach(function(f, i){
      var b = hmBanda(f.cv);
      var mio = (f.did === elegido) ? ' hm-mio' : '';
      h += '<tr class="' + mio + '">'
        +  '<td class="hm-rank">' + (i+1) + '</td>'
        +  '<td class="hm-dep">' + f.dep + (mio ? '<span class="hm-tag">tu zona</span>' : '') + '</td>'
        +  '<td class="hm-prov">' + f.prov + '</td>'
        +  '<td>' + f.n + '</td>'
        +  '<td>' + rpFmt(f.media/100, 1) + '</td>'
        +  '<td class="' + (f.peor < -0.4 ? 'rp-neg' : '') + '">' + rpFmt(f.peor*100, 0) + '%</td>'
        +  '<td class="hm-cv"><span class="hm-celda" style="background:' + b.c + ';color:' + b.t + '"'
        +     ' title="' + f.dep + ' · ' + b.n + ' · ' + rpFmt(f.cv*100,1) + '% de variabilidad sobre '
        +     f.n + ' campañas">' + rpFmt(f.cv*100, 1) + '%</span></td>'
        +  '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="rp-glosario">Ordenado del más parejo al más errático. <b>Variabilidad</b> es el desvío '
      + 'del rinde sobre su propia media: no mide si rinde mucho, mide si rinde parecido todos los años. '
      + 'Los cortes de color son fijos, así que el mismo color significa lo mismo cambiando de cultivo o de '
      + 'provincia. Son promedios del departamento: tu lote varía más que esto.</div>';
    box.innerHTML = h;
  }).catch(function(){
    HM.cargando = false;
    box.innerHTML = '<div class="rp-vacio">No se pudieron traer los datos de rindes.</div>';
  });
}


var RPZ = { index: null, prov: null, cargando: false };

function rpzEl(id){ return document.getElementById(id); }

function rpzEstado(msg, tipo){
  var el = rpzEl('rpz_estado');
  if(!el) return;
  el.textContent = msg || '';
  el.className = 'rp-fb' + (tipo ? ' rp-fb-' + tipo : '');
  el.style.display = msg ? '' : 'none';
}

// Catálogo de provincias. Se pide una sola vez, al abrir el módulo.
function rpzInit(){
  if(RPZ.index || RPZ.cargando) return;
  RPZ.cargando = true;
  fetch('/agro-reporte/datos/rindes/index.json', { cache: 'force-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      RPZ.cargando = false;
      if(!j || !j.provincias) { rpzEstado('No se pudo leer el catálogo de provincias.', 'err'); return; }
      RPZ.index = j;
      if(typeof hmInit === 'function') hmInit();
      var sel = rpzEl('rpz_prov');
      if(!sel) return;
      var h = '<option value="">Elegí la provincia…</option>';
      j.provincias.forEach(function(p){
        h += '<option value="' + p.id + '">' + p.n + ' (' + p.deps + ')</option>';
      });
      sel.innerHTML = h;
      sel.disabled = false;
    })
    .catch(function(){
      RPZ.cargando = false;
      rpzEstado('Sin conexión: no se pudieron traer los rindes de referencia.', 'err');
    });
}

function rpzCambioProvincia(){
  var pid = rpzEl('rpz_prov').value;
  var selD = rpzEl('rpz_dep');
  selD.innerHTML = '<option value="">—</option>';
  selD.disabled = true;
  rpzEl('rpz_btn').disabled = true;
  RPZ.prov = null;
  if(!pid) { rpzEstado('', ''); return; }
  rpzEstado('Trayendo los departamentos…', '');
  fetch('/agro-reporte/datos/rindes/' + pid + '.json', { cache: 'force-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(!j){ rpzEstado('No se pudo leer la provincia.', 'err'); return; }
      RPZ.prov = j;
      var deps = Object.keys(j.d).map(function(k){ return { id:k, n:j.d[k].n }; });
      deps.sort(function(a,b){ return a.n.localeCompare(b.n, 'es'); });
      var h = '<option value="">Elegí el departamento o partido…</option>';
      deps.forEach(function(d){ h += '<option value="' + d.id + '">' + d.n + '</option>'; });
      selD.innerHTML = h;
      selD.disabled = false;
      rpzEstado('', '');
    })
    .catch(function(){ rpzEstado('Sin conexión: no se pudo traer la provincia.', 'err'); });
}

function rpzCambioDepto(){
  var hay = !!rpzEl('rpz_dep').value && !!RPZ.prov;
  rpzEl('rpz_btn').disabled = !hay;
  if(hay) rpzVistaPrevia();
  else rpzEstado('', '');
}

// Qué cultivos tiene ese departamento en la ventana elegida, y con cuántas
// campañas cada uno. Se precargan los que tienen al menos 5.
function rpzCultivosDisponibles(){
  var j = RPZ.prov, did = rpzEl('rpz_dep').value;
  if(!j || !j.d[did]) return null;
  var n = parseInt(rpzEl('rpz_camp').value, 10) || 15;
  var desde = Math.max(0, j.k.length - n);
  var camps = j.k.slice(desde);
  var s = j.d[did].s;
  var out = [];
  Object.keys(s).forEach(function(ci){
    var serie = s[ci].slice(desde);
    var con = serie.filter(function(x){ return x > 0; }).length;
    if(con >= 5) out.push({ nombre: j.c[parseInt(ci, 10)], serie: serie, n: con });
  });
  // El catálogo j.c ya viene en orden de importancia; se respeta y se corta en 8
  // columnas, que es lo que entra sin que la grilla se vuelva ilegible.
  out.sort(function(a, b){ return j.c.indexOf(a.nombre) - j.c.indexOf(b.nombre); });
  return { camps: camps, cultivos: out.slice(0, 8), descartados: Math.max(0, out.length - 8) };
}

function rpzVistaPrevia(){
  var d = rpzCultivosDisponibles();
  if(!d){ rpzEstado('', ''); return; }
  if(!d.cultivos.length){
    rpzEstado('Ese departamento no tiene ningún cultivo con al menos 5 campañas en la ventana elegida.', 'err');
    return;
  }
  rpzEstado('Va a cargar ' + d.cultivos.length + ' cultivos × ' + d.camps.length + ' campañas: '
    + d.cultivos.map(function(c){ return c.nombre + ' (' + c.n + ')'; }).join(', ')
    + (d.descartados ? '. Quedan afuera ' + d.descartados + ' cultivos menores.' : '.'), 'ok');
}

function rpzPrecargar(){
  var d = rpzCultivosDisponibles();
  if(!d || !d.cultivos.length) return;
  var dep = RPZ.prov.d[rpzEl('rpz_dep').value].n;
  if(RP.filas.some(function(f){ return f.v.some(function(x){ return x != null; }); })){
    if(!confirm('Esto reemplaza los rindes que tengas cargados en la grilla.\n\n¿Seguir?')) return;
  }

  RP.cultivos = d.cultivos.map(function(c){ return c.nombre; });
  RP.filas = d.camps.map(function(camp, i){
    return {
      camp: camp.slice(2, 4) + '/' + camp.slice(7, 9),          // 2010/2011 → 10/11
      v: d.cultivos.map(function(c){
        var kg = c.serie[i];
        return kg > 0 ? Math.round(kg / 10) / 10 : null;        // kg/ha → qq/ha, 1 decimal
      })
    };
  });
  RP.filas.reverse();        // la grilla va de la campaña más nueva a la más vieja

  rpRenderGrilla();
  rpRenderTodo();
  rpzEstado('Cargados los rindes de ' + dep + ' (' + RPZ.prov.p + '): '
    + RP.cultivos.length + ' cultivos × ' + RP.filas.length + ' campañas. '
    + 'Son promedios del departamento, no de tu campo: editá las celdas con tus números donde los tengas.', 'ok');
  var av = rpzEl('rpz_aviso');
  if(av) av.style.display = '';
}


var RP = {
  cultivos: ['Soja de primera','Soja de segunda','Maíz temprano','Maíz de segunda','Trigo'],
  filas: [],          // [{camp:'23/24', v:[null,...]}]
  init: false,
  localId: null,      // vínculo con el análisis guardado que se está editando
  // Nombre con el que se guardó o cargó ese análisis. Es lo que distingue
  // "actualizar el que estoy editando" de "crear una variante": si el usuario
  // cambia el nombre, guardar NO renombra el anterior, crea uno nuevo.
  // Antes, cualquier guardado posterior renombraba la fila vinculada y el
  // análisis previo desaparecía de la lista — por eso parecía que no se podían
  // guardar más de tres.
  localNombre: ''
};

function rpNuevaFila(camp){
  return { camp: camp || '', v: RP.cultivos.map(function(){ return null; }) };
}

// Siembra la grilla con algunas campañas vacías para arrancar.
function rpSembrarFilas(n){
  var hoy = new Date().getFullYear();
  RP.filas = [];
  for(var i=n-1;i>=0;i--){
    var a = hoy - 1 - i;
    var camp = String(a).slice(2) + '/' + String(a+1).slice(2);
    RP.filas.push(rpNuevaFila(camp));
  }
}

/* ---------- Render de la grilla de carga ---------- */
function rpRenderGrilla(){
  var cont = document.getElementById('rp_grilla');
  if(!cont) return;
  var h = '<table class="rp-tabla"><thead><tr>';
  h += '<th class="rp-th-camp">Campaña</th>';
  RP.cultivos.forEach(function(c,i){
    h += '<th><div class="rp-th-cult">'
      +  '<input class="rp-cult-nom" list="rp_cultivos_ar" value="'+String(c).replace(/"/g,'&quot;')+'" oninput="rpRenombrarCultivo('+i+',this.value)" title="Editá el nombre del cultivo">'
      +  '<button class="rp-x" onclick="rpQuitarCultivo('+i+')" title="Quitar cultivo">×</button>'
      +  '</div></th>';
  });
  h += '<th class="rp-th-acc"></th></tr></thead><tbody>';
  RP.filas.forEach(function(f,fi){
    h += '<tr><td><input class="rp-camp" value="'+String(f.camp).replace(/"/g,'&quot;')+'" oninput="rpEditarCamp('+fi+',this.value)" placeholder="23/24"></td>';
    RP.cultivos.forEach(function(_,ci){
      var val = (f.v[ci]==null) ? '' : f.v[ci];
      h += '<td><input class="rp-val" inputmode="decimal" value="'+val+'" oninput="rpEditarVal('+fi+','+ci+',this.value)" placeholder="—"></td>';
    });
    h += '<td class="rp-td-acc"><button class="rp-x" onclick="rpQuitarFila('+fi+')" title="Quitar campaña">×</button></td></tr>';
  });
  h += '</tbody></table>';
  cont.innerHTML = h;
}

/* ---------- Edición ---------- */
function rpEditarCamp(fi, val){ if(RP.filas[fi]) RP.filas[fi].camp = val; }
function rpEditarVal(fi, ci, val){
  if(!RP.filas[fi]) return;
  var t = String(val).trim().replace(',','.');
  var n = (t==='') ? null : parseFloat(t);
  RP.filas[fi].v[ci] = (n!=null && isFinite(n)) ? n : null;
  rpRenderTodo();              // recalcula sin redibujar la grilla (no pierde el foco)
}
function rpRenombrarCultivo(i, val){
  RP.cultivos[i] = val;
  rpRenderTodo();
}
function rpQuitarCultivo(i){
  if(RP.cultivos.length<=1){ alert('Tiene que quedar al menos un cultivo.'); return; }
  RP.cultivos.splice(i,1);
  RP.filas.forEach(function(f){ f.v.splice(i,1); });
  rpRenderGrilla(); rpRenderTodo();
}
function rpAgregarCultivo(){
  RP.cultivos.push('');
  RP.filas.forEach(function(f){ f.v.push(null); });
  rpRenderGrilla(); rpRenderTodo();
}
function rpAgregarFila(){
  // continúa la serie hacia atrás si se puede
  var ult = RP.filas.length ? RP.filas[0].camp : '';
  var m = String(ult).match(/^(\d{2})\/(\d{2})$/);
  var nueva = '';
  if(m){ var a=Number(m[1])-1; nueva = String((a+100)%100).padStart(2,'0')+'/'+String((a+1+100)%100).padStart(2,'0'); }
  RP.filas.unshift(rpNuevaFila(nueva));
  rpRenderGrilla(); rpRenderTodo();
}
function rpQuitarFila(fi){
  RP.filas.splice(fi,1);
  rpRenderGrilla(); rpRenderTodo();
}

/* ---------- Pegar desde Excel ---------- */
// Acepta un bloque TSV/CSV. Primera columna = campaña; el resto, rindes.
// Si la primera fila trae texto no numérico en las columnas de datos, se toma como encabezado.
function rpPegarDesdeTexto(texto){
  var lineas = String(texto).replace(/\r/g,'').split('\n').filter(function(l){ return l.trim()!==''; });
  if(!lineas.length) return { ok:false, msg:'No hay datos para pegar.' };
  var sep = lineas[0].indexOf('\t')>=0 ? '\t' : (lineas[0].indexOf(';')>=0 ? ';' : ',');
  var tabla = lineas.map(function(l){ return l.split(sep).map(function(c){ return c.trim(); }); });

  // ¿la primera fila es encabezado? (sus celdas de datos no son números)
  var prim = tabla[0].slice(1);
  var esHeader = prim.length && prim.every(function(c){ return c!=='' && !isFinite(parseFloat(c.replace(',','.'))); });
  var cabecera = esHeader ? tabla.shift() : null;

  if(!tabla.length) return { ok:false, msg:'Solo se encontró el encabezado.' };

  // cultivos: los del encabezado si vino, si no se mantienen los actuales (ajustando cantidad)
  var nCols = Math.max.apply(null, tabla.map(function(r){ return r.length-1; }));
  if(cabecera){
    RP.cultivos = cabecera.slice(1, nCols+1).map(function(c,i){ return c || ('Cultivo '+(i+1)); });
  } else {
    while(RP.cultivos.length < nCols) RP.cultivos.push('Cultivo '+(RP.cultivos.length+1));
    RP.cultivos = RP.cultivos.slice(0, Math.max(nCols,1));
  }

  RP.filas = tabla.map(function(r){
    var f = { camp: r[0]||'', v: [] };
    for(var i=0;i<RP.cultivos.length;i++){
      var c = (r[i+1]||'').replace(',','.');
      var n = (c==='') ? null : parseFloat(c);
      f.v.push((n!=null && isFinite(n)) ? n : null);
    }
    return f;
  });
  rpRenderGrilla(); rpRenderTodo();
  return { ok:true, msg:'Se cargaron '+RP.filas.length+' campañas y '+RP.cultivos.length+' cultivos.' };
}

function rpAbrirPegar(){
  var box = document.getElementById('rp_pegar_box');
  if(box) box.style.display = (box.style.display==='none') ? 'block' : 'none';
}
function rpProcesarPegado(){
  var ta = document.getElementById('rp_pegar_ta');
  if(!ta) return;
  var r = rpPegarDesdeTexto(ta.value);
  var fb = document.getElementById('rp_pegar_fb');
  if(fb){ fb.textContent = r.msg; fb.className = 'rp-fb ' + (r.ok?'ok':'err'); fb.style.display='block'; }
  if(r.ok){ ta.value=''; setTimeout(function(){ var b=document.getElementById('rp_pegar_box'); if(b) b.style.display='none'; }, 1200); }
}

/* ============================================================
   PASO 2 — Tabla de riesgo individual por cultivo
   ============================================================ */

// Serie de rindes de un cultivo (por índice de columna), en orden de campaña.
function rpSerie(ci){
  return RP.filas.map(function(f){ return f.v[ci]; });
}

function rpFmt(x, dec){
  if(x==null || !isFinite(x)) return '—';
  return Number(x).toLocaleString('es-AR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
}

function rpRenderRiesgo(){
  var cont = document.getElementById('rp_riesgo');
  if(!cont) return;

  var conDato = RP.cultivos.map(function(c,i){
    return { nombre:c, i:i, serie:rpSerie(i), n:rpCount(rpSerie(i)) };
  });
  var validos = conDato.filter(function(x){ return x.n>=2; });

  if(!validos.length){
    cont.innerHTML = '<div class="rp-vacio">Cargá al menos 2 campañas con rinde para ver el análisis de riesgo.</div>';
    return;
  }

  var h = '<div class="rp-sub">Riesgo individual por cultivo</div>';
  h += '<div class="rp-tabla-wrap"><table class="rp-tabla rp-tabla-riesgo"><thead><tr>'
    +  '<th>Cultivo</th><th>Campañas</th><th>Media<br><small>qq/ha</small></th><th>Media<br><small>tn/ha</small></th>'
    +  '<th>Desvío<br><small>qq/ha</small></th><th>Variabilidad<br><small>CV</small></th>'
    +  '<th>P10<br><small>qq/ha</small></th><th>CVaR 10%<br><small>qq/ha</small></th>'
    +  '<th>Peor campaña<br><small>vs media</small></th><th>Campañas malas<br><small>&lt;80% media</small></th><th>Riesgo</th>'
    +  '</tr></thead><tbody>';

  conDato.forEach(function(x){
    if(x.n<2){
      h += '<tr class="rp-sin"><td>'+x.nombre+'</td><td>'+x.n+'</td>'
        +  '<td colspan="9" class="rp-sin-txt">Necesita al menos 2 campañas con dato</td></tr>';
      return;
    }
    var r = rpRiesgoIndividual(x.serie);
    var clase = r.nivelCV==='Bajo' ? 'rp-bajo' : (r.nivelCV==='Medio' ? 'rp-medio' : 'rp-alto');
    h += '<tr>'
      + '<td class="rp-nom">'+x.nombre+'</td>'
      + '<td>'+r.n+'</td>'
      + '<td>'+rpFmt(r.mediaQq,1)+'</td>'
      + '<td>'+rpFmt(r.mediaTn,2)+'</td>'
      + '<td>'+rpFmt(r.desvio,1)+'</td>'
      + '<td>'+rpFmt(r.cv*100,1)+'%</td>'
      + '<td>'+rpFmt(r.p10,1)+'</td>'
      + '<td>'+rpFmt(r.cvar,1)+'</td>'
      + '<td class="'+(r.peorVsMedia<-0.5?'rp-neg':'')+'">'+rpFmt(r.peorVsMedia*100,0)+'%</td>'
      + '<td>'+rpFmt(r.freqMalas*100,0)+'%</td>'
      + '<td><span class="rp-chip '+clase+'">'+r.nivelCV+'</span></td>'
      + '</tr>';
  });
  h += '</tbody></table></div>';

  // Avisos de robustez
  var avisos = [];
  var pocos = conDato.filter(function(x){ return x.n>0 && x.n<10; });
  if(pocos.length){
    avisos.push('Con pocas campañas las estimaciones son poco robustas: '
      + pocos.map(function(x){ return x.nombre+' ('+x.n+')'; }).join(', ')
      + '. Cargá más años para mejorar el análisis.');
  }
  var sinDato = conDato.filter(function(x){ return x.n===0; });
  if(sinDato.length){
    avisos.push('Sin datos cargados: ' + sinDato.map(function(x){ return x.nombre; }).join(', ') + '.');
  }
  var maxN = Math.max.apply(null, conDato.map(function(x){ return x.n; }));
  if(maxN>0 && maxN<15){
    avisos.push('Tenés '+maxN+' campañas como máximo. Con 15 o más, las medidas de riesgo de cola (P10, CVaR) ganan precisión.');
  }
  if(avisos.length){
    h += '<div class="rp-avisos">' + avisos.map(function(a){ return '<div class="rp-aviso">⚠ '+a+'</div>'; }).join('') + '</div>';
  }

  // Glosario corto
  h += '<div class="rp-glosario">'
    + '<b>Cómo leerlo.</b> <b>CV</b> (coeficiente de variación): cuánto varía el rinde respecto de su media; más alto, más incierto. '
    + '<b>P10</b>: el rinde que solo se perfora en 1 de cada 10 campañas. '
    + '<b>CVaR 10%</b>: el rinde promedio de ese 10% de peores campañas. '
    + 'Referencia de riesgo por CV: bajo &lt;25%, medio 25–35%, alto &gt;35%.'
    + '</div>';

  cont.innerHTML = h;
}

/* ---------- Apertura del módulo ---------- */
function rpInitSiHaceFalta(){
  if(typeof rpzInit === 'function') rpzInit();   // catálogo de provincias (una sola vez)
  if(RP.init) return; RP.init = true;
  if(!RP.filas.length) rpSembrarFilas(10);
  rpRenderGrilla();
  rpRenderTodo();
  if(typeof rpListar==='function') rpListar();
}
function abrirRiesgoProductivo(){
  var cont = document.getElementById('rp-contenido');
  if(!cont) return;
  FloatWin.abrir('riesgo-productivo', {
    titulo: 'Análisis estadístico de riesgo productivo',
    contenidoEl: cont, ancho: 900, alto: 640
  });
  rpInitSiHaceFalta();
}



/* ============================================================
   PASO 3 — Matriz de correlaciones (pares completos + avisos)
   ============================================================ */

// Cultivos con datos suficientes para el análisis conjunto.
function rpCultivosValidos(){
  return RP.cultivos.map(function(c,i){
    return { nombre:c, i:i, serie:rpSerie(i), n:rpCount(rpSerie(i)) };
  }).filter(function(x){ return x.n>=3; });
}

// Shocks de cada cultivo válido (rinde/media - 1).
function rpShocksValidos(){
  return rpCultivosValidos().map(function(x){ return { nombre:x.nombre, s:rpShocks(x.serie) }; });
}

function rpRenderCorrelaciones(){
  var cont = document.getElementById('rp_correl');
  if(!cont) return;
  var vs = rpShocksValidos();
  if(vs.length<2){
    cont.innerHTML = '<div class="rp-vacio">Se necesitan al menos 2 cultivos con 3 o más campañas para medir cómo se relacionan entre sí.</div>';
    return;
  }
  var mat = rpMatrizCov(vs.map(function(v){ return v.s; }));

  var h = '<div class="rp-sub">¿Los cultivos fallan juntos?</div>';
  h += '<p class="rp-expl">La correlación muestra si dos cultivos tienen años buenos y malos <b>al mismo tiempo</b>. '
    +  'Cerca de <b>+1</b>: se mueven juntos (no diversifican). Cerca de <b>0</b> o negativo: cuando uno falla el otro puede compensar (diversifica).</p>';
  h += '<div class="rp-tabla-wrap"><table class="rp-tabla rp-matriz"><thead><tr><th></th>';
  vs.forEach(function(v){ h += '<th>'+v.nombre+'</th>'; });
  h += '</tr></thead><tbody>';
  vs.forEach(function(va,i){
    h += '<tr><th class="rp-nom">'+va.nombre+'</th>';
    vs.forEach(function(vb,j){
      if(i===j){ h += '<td class="rp-diag">—</td>'; return; }
      var corr = rpCorrel(va.s, vb.s);
      var n = mat.comunes[i][j];
      var cls = !isFinite(corr) ? '' : (corr>0.6 ? 'rp-corr-alta' : (corr<0.2 ? 'rp-corr-baja' : 'rp-corr-media'));
      var pocos = n<10 ? ' rp-corr-pocos' : '';
      h += '<td class="'+cls+pocos+'" title="'+n+' campañas comparables">'
        +  (isFinite(corr)? rpFmt(corr,2) : '—')
        +  '<small>'+n+' camp.</small></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // Avisos por pares con pocas campañas comunes
  var flojos = [];
  for(var i=0;i<vs.length;i++) for(var j=i+1;j<vs.length;j++){
    if(mat.comunes[i][j] < 10) flojos.push(vs[i].nombre+' vs '+vs[j].nombre+' ('+mat.comunes[i][j]+')');
  }
  if(flojos.length){
    h += '<div class="rp-avisos"><div class="rp-aviso">⚠ Pocas campañas comparables en: '+flojos.join(', ')
      +  '. La relación entre esos cultivos es poco confiable; cargá más años en común para mejorarla.</div></div>';
  }
  h += '<div class="rp-glosario"><b>Leé el color:</b> <span class="rp-chip rp-corr-alta">alta</span> se mueven juntos · '
    +  '<span class="rp-chip rp-corr-media">media</span> relación parcial · '
    +  '<span class="rp-chip rp-corr-baja">baja</span> diversifican bien. El número chico es cuántas campañas se pudieron comparar.</div>';
  cont.innerHTML = h;
}

/* ============================================================
   PASO 4 — Optimizador: cartera de mínima varianza
   ============================================================ */
function rpCalcularOptimo(){
  var vs = rpShocksValidos();
  if(vs.length<2) return null;
  var mat = rpMatrizCov(vs.map(function(v){ return v.s; }));
  // si alguna covarianza no es finita, no se puede optimizar
  for(var i=0;i<mat.cov.length;i++) for(var j=0;j<mat.cov.length;j++){ if(!isFinite(mat.cov[i][j])) return null; }
  var pesos = rpMinVarianzaLongOnly(mat.cov);   // 0%-100% por cultivo
  if(!pesos) return null;
  return { nombres: vs.map(function(v){ return v.nombre; }), pesos: pesos, cov: mat.cov,
           riesgo: rpRiesgoCartera(pesos, mat.cov), comunes: mat.comunes };
}

function rpRenderOptimo(){
  var cont = document.getElementById('rp_optimo');
  if(!cont) return;
  var o = rpCalcularOptimo();
  if(!o){
    cont.innerHTML = '<div class="rp-vacio">Se necesitan al menos 2 cultivos con campañas en común para calcular la combinación de menor riesgo.</div>';
    return;
  }
  RP.optimo = o;   // guardado para comparar con el planteo del usuario

  var h = '<div class="rp-sub">Combinación de menor riesgo</div>';
  h += '<p class="rp-expl">Esta es la distribución de hectáreas que <b>menos variabilidad de rinde</b> habría tenido según tu historia, '
    +  'con cada cultivo entre 0% y 100%. Es un resultado estadístico: no considera rotación, precios, contratos ni límites agronómicos.</p>';
  h += '<div class="rp-opt-grid">';
  o.nombres.forEach(function(n,i){
    var pct = o.pesos[i]*100;
    var ancho = Math.max(0, Math.min(100, pct));
    h += '<div class="rp-opt-row">'
      +  '<span class="rp-opt-nom">'+n+'</span>'
      +  '<div class="rp-opt-bar"><div class="rp-opt-fill'+(pct<0?' rp-opt-neg':'')+'" style="width:'+Math.abs(ancho)+'%"></div></div>'
      +  '<span class="rp-opt-pct'+(pct<0?' rp-neg':'')+'">'+rpFmt(pct,1)+'%</span>'
      +  '</div>';
  });
  h += '</div>';
  h += '<div class="rp-opt-resumen">Variabilidad de la cartera óptima: <b>'+rpFmt(o.riesgo*100,1)+'%</b> '
    +  '<small>(desvío del rinde conjunto respecto de su media)</small></div>';
  // Si el modelo concentra casi todo en un cultivo, conviene explicar por qué.
  var maxPeso = Math.max.apply(null, o.pesos);
  var iMax = o.pesos.indexOf(maxPeso);
  var enCero = o.pesos.filter(function(w){ return w < 0.005; }).length;
  if(maxPeso > 0.85){
    h += '<div class="rp-avisos"><div class="rp-aviso">⚠ El modelo concentra casi todo en <b>'+o.nombres[iMax]+'</b>. '
      +  'Eso suele pasar cuando tus cultivos tienen años buenos y malos muy parecidos (mirá la tabla de arriba): si todos fallan juntos, '
      +  'repartir hectáreas no baja el riesgo y el modelo elige el más estable. '
      +  '<b>No lo tomes como una recomendación de sembrar un solo cultivo</b>: la rotación, los precios y los contratos pesan igual o más.</div></div>';
  } else if(enCero){
    h += '<div class="rp-avisos"><div class="rp-aviso">⚠ Algunos cultivos quedan en 0%: según tu historia no ayudan a bajar la variabilidad del conjunto. '
      +  'Puede que igual convengan por precio, rotación o logística.</div></div>';
  }
  cont.innerHTML = h;
}

/* ============================================================
   PASO 5 — Simulador de planteo (hectáreas del usuario)
   ============================================================ */

// ── Doble cultivo: el cultivo de invierno comparte lote con uno de verano ──
// (trigo/cebada + soja o maíz de segunda). Sin esto se contarían dos veces
// las mismas hectáreas: 100 soja 1ª + 100 soja 2ª + 100 trigo son 200 ha, no 300.
var RP_INVIERNO = ['trigo','cebada','avena','centeno','colza','canola','arveja','garbanzo','vicia'];
var RP_SEGUNDA  = ['segunda','2a','2ª','2da'];

function rpEsInvierno(nombre){
  var n = String(nombre||'').toLowerCase();
  return RP_INVIERNO.some(function(c){ return n.indexOf(c)>=0; });
}
function rpEsDeSegunda(nombre){
  var n = String(nombre||'').toLowerCase();
  return RP_SEGUNDA.some(function(c){ return n.indexOf(c)>=0; });
}
// Sugiere sobre qué cultivo de invierno va un cultivo de segunda.
// La soja y el maíz DE SEGUNDA se siembran sobre el trigo (o cebada) ya cosechado.
// Ojo: "maíz tardío" NO es maíz de segunda — ese va en lote propio.
function rpSocioSugerido(nombreSegunda){
  var inv = RP.cultivos.filter(function(c){ return rpEsInvierno(c); });
  var trigo = inv.find(function(c){ return String(c).toLowerCase().indexOf('trigo')>=0; });
  return trigo || (inv.length ? inv[0] : '');
}

// Superficie física: descuenta las hectáreas compartidas por doble cultivo.
// `soloEstos` limita la cuenta a un subconjunto de cultivos, para los paneles
// que no trabajan con el planteo entero (el resultado económico y el stress
// test climático dejan afuera a los cultivos sin costo, sin futuro o sin serie).
// Un solape solo se descuenta si los DOS cultivos del par entraron al cálculo.
function rpSuperficie(soloEstos){
  var has = RP.has || {}, doble = RP.doble || {};
  var nombres = soloEstos ? RP.cultivos.filter(function(n){ return soloEstos.indexOf(n)>=0; })
                          : RP.cultivos;
  var sembrado = nombres.reduce(function(a,n){ return a + (has[n]||0); }, 0);
  var restante = {};
  nombres.forEach(function(n){ restante[n] = has[n]||0; });
  var solape = 0, pares = [];
  // doble[cultivoDeSegunda] = cultivo de invierno sobre cuyo lote se siembra.
  nombres.forEach(function(seg){
    var inv = doble[seg];
    if(!inv || inv===seg || !(has[seg]>0)) return;
    if(nombres.indexOf(inv) < 0) return;        // el socio quedó fuera del subconjunto
    var comp = Math.min(has[seg], restante[inv]||0);   // ha realmente compartidas
    if(comp>0){ solape += comp; restante[inv] -= comp; pares.push({segunda:seg, invierno:inv, ha:comp}); }
  });
  return { sembrado: sembrado, fisica: sembrado - solape, solape: solape, pares: pares };
}

function rpRenderPlanteoInputs(){
  var cont = document.getElementById('rp_planteo_inputs');
  if(!cont) return;
  var vs = rpCultivosValidos();
  if(!vs.length){ cont.innerHTML='<div class="rp-vacio">Cargá rindes para poder simular un planteo.</div>'; return; }
  if(!RP.has) RP.has = {};
  if(!RP.doble) RP.doble = {};
  // Sugerencia automática: trigo/cebada suelen compartir lote con la soja de segunda.
  if(!RP.dobleSugerido){
    RP.dobleSugerido = true;
    vs.forEach(function(v){
      if(rpEsDeSegunda(v.nombre) && !rpEsInvierno(v.nombre) && RP.doble[v.nombre]===undefined){
        var socio = rpSocioSugerido(v.nombre);
        if(socio) RP.doble[v.nombre] = socio;
      }
    });
  }
  var h = '<div class="rp-has-grid">';
  vs.forEach(function(v){
    var val = (RP.has[v.nombre]!=null) ? RP.has[v.nombre] : '';
    var esSeg = rpEsDeSegunda(v.nombre) && !rpEsInvierno(v.nombre);
    h += '<div class="estr-field rp-has-item"><label>'+v.nombre+' <small>(ha)</small></label>'
      +  '<input type="text" inputmode="decimal" value="'+val+'" oninput="rpEditarHas('+JSON.stringify(v.nombre).replace(/"/g,'&quot;')+',this.value)" placeholder="0">';
    if(esSeg){
      var actual = RP.doble[v.nombre] || '';
      var inviernos = RP.cultivos.filter(function(c){ return rpEsInvierno(c); });
      if(inviernos.length){
        var opts = '<option value="">Lote propio</option>';
        inviernos.forEach(function(c){
          opts += '<option value="'+String(c).replace(/"/g,'&quot;')+'"'+(c===actual?' selected':'')+'>Sobre '+c+'</option>';
        });
        h += '<select class="rp-doble-sel" onchange="rpEditarDoble('+JSON.stringify(v.nombre).replace(/"/g,'&quot;')+',this.value)" title="Se siembra sobre el lote del cultivo de invierno ya cosechado">'+opts+'</select>';
      }
    }
    h += '</div>';
  });
  h += '</div>';
  cont.innerHTML = h;
}
function rpEditarDoble(nombre, socio){
  if(!RP.doble) RP.doble = {};
  if(socio) RP.doble[nombre] = socio; else delete RP.doble[nombre];
  rpRenderPlanteoResultado();
}

function rpEditarHas(nombre, val){
  if(!RP.has) RP.has = {};
  var t = String(val).trim().replace(',','.');
  var n = (t==='') ? null : parseFloat(t);
  RP.has[nombre] = (n!=null && isFinite(n) && n>=0) ? n : null;
  rpRenderPlanteoResultado();
  rpActualizarResultado();
  if(typeof rpRenderEnso==='function') rpRenderEnso();   // el stress test usa las hectáreas
}

function rpRenderPlanteoResultado(){
  var cont = document.getElementById('rp_planteo_res');
  if(!cont) return;
  var o = RP.optimo || rpCalcularOptimo();
  if(!o){ cont.innerHTML=''; return; }
  var has = RP.has || {};
  var total = o.nombres.reduce(function(a,n){ return a + (has[n]||0); }, 0);
  if(!(total>0)){
    cont.innerHTML = '<div class="rp-vacio">Cargá las hectáreas de cada cultivo para ver el riesgo de tu planteo.</div>';
    return;
  }
  var sup = rpSuperficie();
  var w = o.nombres.map(function(n){ return (has[n]||0)/total; });
  var riesgoPlanteo = rpRiesgoCartera(w, o.cov);
  var desvio = riesgoPlanteo - o.riesgo;
  var desvioRel = o.riesgo>0 ? desvio/o.riesgo*100 : 0;

  // Serie de shocks de la cartera (campañas donde TODOS los cultivos con peso tienen dato)
  var vs = rpShocksValidos();
  var serieCartera = [];
  var nCamp = RP.filas.length;
  for(var k=0;k<nCamp;k++){
    var acum=0, completo=true;
    o.nombres.forEach(function(n,i){
      if(w[i]<=0) return;
      var v = vs.find(function(x){ return x.nombre===n; });
      var sh = v ? v.s[k] : null;
      if(sh==null || !isFinite(sh)) completo=false; else acum += w[i]*sh;
    });
    if(completo) serieCartera.push(acum);
  }
  var p10 = serieCartera.length>=3 ? rpPercentil(serieCartera,0.1) : null;
  var cvar = serieCartera.length>=3 ? rpCVaR(serieCartera,0.1) : null;

  var h = '<div class="rp-kpis">';
  if(sup.solape>0){
    h += '<div class="rp-kpi"><span>Superficie del campo</span><b>'+rpFmt(sup.fisica,0)+' ha</b>'
      +  '<small>'+rpFmt(sup.sembrado,0)+' ha sembradas · '+rpFmt(sup.solape,0)+' en doble cultivo</small></div>';
  } else {
    h += '<div class="rp-kpi"><span>Superficie total</span><b>'+rpFmt(total,0)+' ha</b></div>';
  }
  h += '<div class="rp-kpi"><span>Variabilidad de tu planteo</span><b>'+rpFmt(riesgoPlanteo*100,1)+'%</b></div>';
  h += '<div class="rp-kpi"><span>Mínima posible</span><b>'+rpFmt(o.riesgo*100,1)+'%</b></div>';
  var clsD = desvioRel<=5 ? 'rp-ok' : (desvioRel<=20 ? 'rp-warn' : 'rp-bad');
  h += '<div class="rp-kpi"><span>Exceso de riesgo</span><b class="'+clsD+'">'+(desvioRel>=0?'+':'')+rpFmt(desvioRel,0)+'%</b></div>';
  h += '</div>';

  if(p10!=null){
    h += '<div class="rp-kpis">';
    h += '<div class="rp-kpi"><span>Campaña mala (P10)</span><b class="rp-neg">'+rpFmt(p10*100,0)+'%</b><small>vs rinde medio</small></div>';
    h += '<div class="rp-kpi"><span>Promedio del 10% peor</span><b class="rp-neg">'+rpFmt(cvar*100,0)+'%</b><small>vs rinde medio</small></div>';
    h += '<div class="rp-kpi"><span>Campañas comparables</span><b>'+serieCartera.length+'</b></div>';
    h += '</div>';
  }

  // Comparación planteo vs óptimo
  h += '<div class="rp-sub" style="margin-top:16px">Tu planteo vs la combinación de menor riesgo</div>';
  h += '<div class="rp-tabla-wrap"><table class="rp-tabla"><thead><tr><th>Cultivo</th><th>Tus ha</th><th>Tu %</th><th>% óptimo</th><th>Diferencia</th></tr></thead><tbody>';
  o.nombres.forEach(function(n,i){
    var ha = has[n]||0, pw = w[i]*100, po = o.pesos[i]*100, dif = pw-po;
    h += '<tr><td class="rp-nom">'+n+'</td><td>'+rpFmt(ha,0)+'</td><td>'+rpFmt(pw,1)+'%</td>'
      +  '<td>'+rpFmt(po,1)+'%</td>'
      +  '<td class="'+(Math.abs(dif)>15?'rp-warn':'')+'">'+(dif>=0?'+':'')+rpFmt(dif,1)+'%</td></tr>';
  });
  h += '</tbody></table></div>';
  if(sup.pares.length){
    h += '<div class="rp-doble-info"><b>Doble cultivo:</b> '
      +  sup.pares.map(function(p){ return p.segunda+' sobre las mismas '+rpFmt(p.ha,0)+' ha de '+p.invierno; }).join(' · ')
      +  '. Por eso la superficie del campo ('+rpFmt(sup.fisica,0)+' ha) es menor que la sembrada ('+rpFmt(sup.sembrado,0)+' ha).</div>';
  }
  h += '<p class="rp-expl" style="margin-top:10px">Los porcentajes se calculan sobre las <b>hectáreas sembradas</b>, porque cada cultivo aporta su propio rinde al resultado. '
    +  'La <b>superficie del campo</b> es la física: la soja o el maíz de segunda se siembran sobre el lote del trigo ya cosechado, así que esas hectáreas se cuentan una sola vez. '
    +  'Un exceso de riesgo chico (menos de 5%) significa que tu planteo ya está bien diversificado. '
    +  'Recordá que el óptimo es sólo estadístico: la rotación, los contratos y el precio también mandan.</p>';
  cont.innerHTML = h;
}

/* ============================================================
   PASO 6 — Persistencia en Supabase
   Reusa escenarios_productivos con modulo='agricultura_riesgo'.
   RLS: cada cliente ve y edita solo lo suyo (auth.uid() = user_id).
   ============================================================ */

function rpDatosParaGuardar(){
  return {
    version: 1,
    cultivos: RP.cultivos.slice(),
    filas: RP.filas.map(function(f){ return { camp:f.camp, v:f.v.slice() }; }),
    has: RP.has || {},
    doble: RP.doble || {},
    costo: RP.costo || {},
    fut: RP.fut || {}
  };
}

function rpRestaurarDatos(d){
  if(!d) return;
  if(Array.isArray(d.cultivos) && d.cultivos.length) RP.cultivos = d.cultivos.slice();
  if(Array.isArray(d.filas)) RP.filas = d.filas.map(function(f){ return { camp:f.camp||'', v:(f.v||[]).slice() }; });
  RP.has = d.has || {};
  RP.doble = d.doble || {};
  RP.costo = d.costo || {};
  RP.fut = d.fut || {};
  // asegurar consistencia de anchos
  RP.filas.forEach(function(f){
    while(f.v.length < RP.cultivos.length) f.v.push(null);
    f.v = f.v.slice(0, RP.cultivos.length);
  });
  rpRenderGrilla(); rpRenderTodo();
}

function rpEstado(msg, tipo){
  var el = document.getElementById('rp_estado');
  if(!el) return;
  el.textContent = msg;
  el.className = 'rp-fb ' + (tipo||'ok');
  el.style.display = msg ? 'block' : 'none';
  if(msg) setTimeout(function(){ el.style.display='none'; }, 4000);
}

// ── VÍNCULO CON EL ANÁLISIS GUARDADO ──
// Tres estados, visibles para el usuario:
//   · sin vínculo             → "Guardar" crea un análisis nuevo
//   · vinculado, mismo nombre → "Guardar" actualiza ese análisis
//   · vinculado, nombre distinto → "Guardar" crea uno nuevo y deja intacto el
//     anterior; para renombrar de verdad está el botón "Renombrar"
function rpEstadoVinculo(){
  var el = document.getElementById('rp_nombre');
  var nombre = (el && el.value || '').trim();
  if(!RP.localId) return { tipo:'nuevo', nombre:nombre };
  if(nombre && nombre !== RP.localNombre) return { tipo:'renombrado', nombre:nombre, anterior:RP.localNombre };
  return { tipo:'vinculado', nombre:nombre || RP.localNombre };
}

function rpActualizarVinculoUI(){
  var el = document.getElementById('rp_vinculo');
  var btn = document.getElementById('rp_btn_renombrar');
  var v = rpEstadoVinculo();
  if(btn) btn.style.display = (v.tipo === 'renombrado') ? '' : 'none';
  if(!el) return;
  var repetido = '';
  if(v.tipo !== 'vinculado' && v.nombre){
    var otros = (RP.guardados||[]).filter(function(it){
      return String(it.origen_local_id||'') !== String(RP.localId||'')
          && String(it.nombre_escenario||'').trim() === v.nombre;
    });
    if(otros.length) repetido = ' Ojo: ya tenés otro análisis llamado así.';
  }
  if(v.tipo === 'nuevo'){
    el.textContent = 'Análisis nuevo: al guardar se crea uno aparte.' + repetido;
  } else if(v.tipo === 'renombrado'){
    el.textContent = 'Cambiaste el nombre: al guardar se crea un análisis nuevo y «' + v.anterior + '» queda intacto.' + repetido;
  } else {
    el.textContent = 'Editando «' + v.nombre + '»: al guardar se actualiza ese análisis.';
  }
}

async function rpGuardar(){
  var nombreEl = document.getElementById('rp_nombre');
  var nombre = (nombreEl && nombreEl.value || '').trim();
  if(!nombre){ rpEstado('Poné un nombre al análisis antes de guardar.','err'); if(nombreEl) nombreEl.focus(); return; }
  if(typeof sb==='undefined' || !sb){ rpEstado('Sin conexión para guardar.','err'); return; }

  var v = rpEstadoVinculo();
  // Un nombre distinto del vinculado significa variante nueva, no renombre.
  var creaNuevo = (v.tipo !== 'vinculado');

  try{
    var u = await sb.auth.getUser();
    var uid = u && u.data && u.data.user && u.data.user.id;
    if(!uid){ rpEstado('Tenés que estar logueado para guardar.','err'); return; }
    var cliId = (typeof currentClienteId!=='undefined' && currentClienteId) ? currentClienteId : uid;

    var localId = creaNuevo ? ('rp_' + Date.now()) : RP.localId;
    var payload = {
      user_id: uid, cliente_id: cliId,
      modulo: 'agricultura_riesgo', modo: 'PRO',
      nombre_escenario: nombre,
      actividades: {}, escenarios: {},
      datos: rpDatosParaGuardar(),
      outputs: rpOutputsResumen(),
      fuente: 'dashboard',
      origen_local_id: localId,
      activo: true
      // updated_at NO se manda: lo pone el trigger set_updated_at_timestamp en
      // los UPDATE y el default de la tabla en los INSERT. Mandarlo desde el
      // cliente dejaba filas con updated_at anterior a created_at, y la lista
      // ordena por updated_at.
    };

    var res;
    if(creaNuevo){
      res = await sb.from('escenarios_productivos').insert(payload);
    } else {
      var ex = await sb.from('escenarios_productivos').select('id')
        .eq('user_id', uid).eq('modulo','agricultura_riesgo')
        .eq('origen_local_id', localId).maybeSingle();
      if(ex.data && ex.data.id){
        res = await sb.from('escenarios_productivos').update(payload).eq('id', ex.data.id);
      } else {
        // El vínculo apuntaba a algo que ya no está (lo borraron desde otra
        // pestaña): se inserta en vez de perder el guardado.
        res = await sb.from('escenarios_productivos').insert(payload);
      }
    }
    if(res.error) throw res.error;
    RP.localId = localId;
    RP.localNombre = nombre;
    rpEstado(creaNuevo
      ? ('Análisis nuevo guardado: '+nombre+(v.tipo==='renombrado' ? ' · «'+v.anterior+'» quedó intacto' : ''))
      : ('Actualizado: '+nombre), 'ok');
    await rpListar();
    rpActualizarVinculoUI();
  }catch(e){ rpEstado('No se pudo guardar: '+(e.message||e),'err'); }
}

// Renombrar el análisis vinculado, en lugar de crear una variante.
async function rpRenombrar(){
  var nombreEl = document.getElementById('rp_nombre');
  var nombre = (nombreEl && nombreEl.value || '').trim();
  if(!RP.localId){ rpEstado('No hay un análisis guardado vinculado.','err'); return; }
  if(!nombre){ rpEstado('Poné un nombre al análisis.','err'); return; }
  if(nombre === RP.localNombre){ rpEstado('El nombre no cambió.','err'); return; }
  if(!confirm('¿Renombrar «'+RP.localNombre+'» a «'+nombre+'»?\n\nNo se crea un análisis nuevo: se le cambia el nombre al que estás editando.')) return;
  if(typeof sb==='undefined' || !sb){ rpEstado('Sin conexión para guardar.','err'); return; }
  try{
    var u = await sb.auth.getUser();
    var uid = u && u.data && u.data.user && u.data.user.id;
    if(!uid){ rpEstado('Tenés que estar logueado para guardar.','err'); return; }
    var res = await sb.from('escenarios_productivos')
      .update({ nombre_escenario: nombre, datos: rpDatosParaGuardar(), outputs: rpOutputsResumen() })
      .eq('user_id', uid).eq('modulo','agricultura_riesgo').eq('origen_local_id', RP.localId);
    if(res.error) throw res.error;
    RP.localNombre = nombre;
    rpEstado('Renombrado: '+nombre,'ok');
    await rpListar();
    rpActualizarVinculoUI();
  }catch(e){ rpEstado('No se pudo renombrar: '+(e.message||e),'err'); }
}

async function rpListar(){
  var sel = document.getElementById('rp_guardados');
  if(!sel || typeof sb==='undefined' || !sb) return;
  try{
    var u = await sb.auth.getUser();
    var uid = u && u.data && u.data.user && u.data.user.id;
    if(!uid) return;
    var res = await sb.from('escenarios_productivos')
      .select('id,nombre_escenario,origen_local_id,updated_at')
      .eq('user_id', uid).eq('modulo','agricultura_riesgo').eq('activo',true)
      .order('updated_at',{ascending:false});
    if(res.error) throw res.error;
    var items = res.data||[];
    RP.guardados = items;
    sel.innerHTML = '<option value="">— Análisis guardados ('+items.length+') —</option>'
      + items.map(function(it){
          var f = new Date(it.updated_at).toLocaleDateString('es-AR');
          return '<option value="'+it.id+'">'+(it.nombre_escenario||'(sin nombre)')+' · '+f+'</option>';
        }).join('');
    rpActualizarVinculoUI();
  }catch(e){ /* silencioso: la lista es secundaria */ }
}

async function rpCargar(id){
  if(!id || typeof sb==='undefined' || !sb) return;
  try{
    var res = await sb.from('escenarios_productivos').select('*').eq('id', id).maybeSingle();
    if(res.error) throw res.error;
    if(!res.data){ rpEstado('No se encontró el análisis.','err'); return; }
    RP.localId = res.data.origen_local_id || null;
    // El nombre vinculado sale del análisis cargado, no de lo que haya quedado
    // escrito en el campo: si no, el primer "Guardar" posterior lo renombraría.
    RP.localNombre = String(res.data.nombre_escenario || '').trim();
    var n = document.getElementById('rp_nombre');
    if(n) n.value = RP.localNombre;
    rpRestaurarDatos(res.data.datos || {});
    rpActualizarVinculoUI();
    rpEstado('Cargado: '+(res.data.nombre_escenario||''),'ok');
  }catch(e){ rpEstado('No se pudo cargar: '+(e.message||e),'err'); }
}

async function rpEliminar(){
  var sel = document.getElementById('rp_guardados');
  var id = sel && sel.value;
  if(!id){ rpEstado('Elegí un análisis guardado para eliminar.','err'); return; }
  var it = (RP.guardados||[]).find(function(x){ return String(x.id)===String(id); });
  if(!confirm('¿Eliminar "'+(it? it.nombre_escenario : '')+'"?')) return;
  try{
    var res = await sb.from('escenarios_productivos').delete().eq('id', id);
    if(res.error) throw res.error;
    // Si se borró el que estaba vinculado, el formulario queda desvinculado:
    // el próximo guardado tiene que crear uno nuevo, no fallar.
    if(it && String(it.origen_local_id||'') === String(RP.localId||'')){
      RP.localId = null; RP.localNombre = '';
    }
    rpEstado('Eliminado.','ok');
    sel.value=''; await rpListar(); rpActualizarVinculoUI();
  }catch(e){ rpEstado('No se pudo eliminar: '+(e.message||e),'err'); }
}

function rpNuevo(){
  RP.localId = null;
  RP.localNombre = '';
  var n = document.getElementById('rp_nombre'); if(n) n.value='';
  var sel = document.getElementById('rp_guardados'); if(sel) sel.value='';
  rpActualizarVinculoUI();
  rpEstado('Análisis nuevo: al guardar se crea uno aparte.','ok');
}

// Resumen que se guarda junto a los datos (para consultas rápidas sin recalcular).
function rpOutputsResumen(){
  var o = RP.optimo || rpCalcularOptimo();
  var out = { cultivos: RP.cultivos.length, campanias: RP.filas.length };
  if(o){
    out.riesgo_optimo = o.riesgo;
    out.pesos_optimos = {};
    o.nombres.forEach(function(n,i){ out.pesos_optimos[n] = o.pesos[i]; });
  }
  return out;
}

/* ---------- Render conjunto ---------- */
/* ============================================================
   CAPA CONDICIONAL POR CLIMA (ENSO)
   ------------------------------------------------------------
   Complementa el modelo histórico; no lo reemplaza. Responde cuánto
   se corre el rinde de cada cultivo según el estado del Pacífico, y
   qué le pasa al planteo cargado si la campaña viene Niña.

   POR QUÉ UNA REGRESIÓN Y NO TRES GRUPOS (evaluación del 01/10/2026):
   Partir las campañas en Niño/Niña/Neutro deja 4 o 5 por grupo con las
   series que maneja el panel (mediana 12-14 campañas) y el efecto deja
   de ser medible: por simulación, con 14 campañas y un efecto real del
   15%, la comparación de medias lo detecta el 9% de las veces y la
   regresión sobre el ONI continuo el 93%. Diez veces más. La regresión
   usa TODAS las campañas y estima un parámetro en lugar de tres medias.

   LO QUE DELIBERADAMENTE NO SE CALCULA, y por qué:
   · correlaciones por evento   — con 5 campañas Niña, una correlación
     real de 0,50 se estima con un IC de [-0,46 , 0,94];
   · optimización por evento    — el peso de mínima varianza de dos
     cultivos con esa submuestra tiene un error de ±51 puntos;
   · CVaR/P10/mínimo por evento — con 5 campañas el percentil 10 cae
     debajo de la observación más baja: se extrapola, no se mide;
   · corte por ambiente         — divide la muestra otra vez.

   SUPUESTOS: el modelo es lineal en el índice, así que Niña y Niño salen
   simétricos (una sequía probablemente pegue más fuerte de lo que ayuda
   un año húmedo, y eso no se captura). El efecto de cada cultivo se
   encoge hacia el promedio de los cultivos en proporción a su propia
   precisión, para que uno con pocos datos no muestre una sensibilidad
   espectacular que es ruido. Desde 20 campañas la regresión incluye la
   campaña como segundo regresor: el rinde sube por tecnología y eso no
   es clima, así que el efecto que se informa es "a igualdad de año".
   ============================================================ */

// Índices climáticos por campaña, en cuatro ventanas trimestrales cada uno.
// Valores de los archivos oni.ascii.txt y RONI.ascii.txt del Climate Prediction
// Center (NOAA). La campaña YY/YY+1 toma SON y NDJ del año YY, y DJF y JFM del
// año YY+1.
//
//   ONI   anomalía de temperatura del Pacífico central (Niño 3.4). Índice
//         estándar y base del listado oficial de episodios.
//   RONI  el mismo Niño 3.4 menos la anomalía media de todo el trópico,
//         ajustado por varianza. Separa mejor "Pacífico cálido" de "planeta
//         cálido", pero deriva -0,25 por década en esta serie, y por eso el
//         panel controla la tendencia antes de interpretar cualquiera de los
//         dos. No tiene listado oficial de episodios.
//
// El `evento` sale de la lista oficial de episodios de NOAA, que aplica un
// criterio de PERSISTENCIA sobre el pico y por eso puede no coincidir con el
// valor puntual de DJF: 16/17 figura Niña con un DJF de -0,08 porque el
// episodio sí persistió. Esa diferencia no afecta el cálculo — la regresión
// usa el VALOR del ONI, no la etiqueta, que solo colorea la tira.
//
// La serie viva está en la tabla `enso_oni` de Supabase y se administra desde
// el panel de admin (Índice climático ENSO). Esto de abajo es el RESPALDO que
// se usa si la consulta falla o todavía no cargó: así el análisis no queda en
// blanco por un problema de red. rpCargarOni() la reemplaza al arrancar.
// campaña: [ONI DJF, evento, ONI SON, ONI NDJ, ONI JFM, RONI DJF, RONI SON, RONI NDJ, RONI JFM]
// Las cuatro ventanas de los dos índices están completas desde el 90/91, así
// que ningún cultivo tiene que caer a DJF por falta de dato.
var RP_ONI = {
  '90/91':[0.35,'Neutro',0.27,0.34,0.26,0.57,0.27,0.43,0.53],
  '91/92':[1.54,'Niño',0.83,1.43,1.50,2.12,1.20,1.97,2.08],
  '92/93':[0.13,'Neutro',-0.22,-0.05,0.31,0.55,0.10,0.35,0.70],
  '93/94':[0.07,'Neutro',0.20,0.19,0.00,0.33,0.46,0.42,0.24],
  '94/95':[0.88,'Niño',0.66,0.97,0.65,1.17,0.97,1.28,0.86],
  '95/96':[-0.88,'Niña',-0.97,-1.01,-0.70,-0.87,-0.93,-0.99,-0.75],
  '96/97':[-0.41,'Neutro',-0.33,-0.41,-0.26,-0.21,-0.25,-0.29,-0.03],
  '97/98':[2.22,'Niño',2.24,2.37,1.91,2.13,2.22,2.28,1.82],
  '98/99':[-1.51,'Niña',-1.12,-1.47,-1.25,-1.56,-1.33,-1.61,-1.28],
  '99/00':[-1.47,'Niña',-1.13,-1.53,-1.26,-1.50,-1.06,-1.56,-1.31],
  '00/01':[-0.76,'Niña',-0.54,-0.78,-0.54,-0.79,-0.55,-0.82,-0.62],
  '01/02':[-0.15,'Neutro',-0.26,-0.32,0.07,-0.16,-0.18,-0.32,0.01],
  '02/03':[0.90,'Niño',0.99,1.08,0.59,0.85,1.18,1.13,0.47],
  '03/04':[0.34,'Neutro',0.23,0.29,0.27,0.23,0.17,0.22,0.12],
  '04/05':[0.62,'Niño',0.61,0.71,0.55,0.54,0.70,0.69,0.40],
  '05/06':[-0.86,'Niña',-0.27,-0.82,-0.80,-0.90,-0.18,-0.81,-0.87],
  '06/07':[0.62,'Niño',0.71,0.88,0.19,0.60,0.73,0.89,0.16],
  '07/08':[-1.76,'Niña',-1.38,-1.72,-1.61,-1.73,-1.33,-1.65,-1.62],
  '08/09':[-0.89,'Niña',-0.36,-0.79,-0.84,-0.96,-0.38,-0.86,-0.92],
  '09/10':[1.47,'Niño',0.92,1.50,1.21,1.44,0.86,1.50,1.11],
  '10/11':[-1.29,'Niña',-1.54,-1.48,-1.06,-1.42,-1.61,-1.55,-1.21],
  '11/12':[-0.71,'Niña',-0.94,-0.92,-0.56,-0.77,-0.91,-0.96,-0.60],
  '12/13':[-0.24,'Neutro',0.28,-0.03,-0.28,-0.55,0.21,-0.27,-0.57],
  '13/14':[-0.24,'Neutro',-0.14,-0.11,-0.21,-0.43,-0.22,-0.27,-0.38],
  '14/15':[0.73,'Niño',0.51,0.80,0.65,0.54,0.35,0.62,0.47],
  '15/16':[2.50,'Niño',2.28,2.59,2.21,2.14,2.03,2.25,1.81],
  '16/17':[-0.08,'Niña',-0.51,-0.37,0.08,-0.60,-0.96,-0.89,-0.44],
  '17/18':[-0.71,'Niña',-0.44,-0.76,-0.67,-1.08,-0.82,-1.14,-1.04],
  '18/19':[0.99,'Niño',0.82,1.05,0.94,0.68,0.62,0.78,0.64],
  '19/20':[0.71,'Niño',0.51,0.75,0.66,0.14,0.15,0.22,0.10],
  '20/21':[-0.99,'Niña',-1.00,-1.06,-0.85,-1.32,-1.37,-1.39,-1.18],
  '21/22':[-0.76,'Niña',-0.77,-0.83,-0.68,-1.18,-1.08,-1.22,-1.13],
  '22/23':[-0.55,'Niña',-0.89,-0.70,-0.33,-0.86,-1.10,-0.99,-0.68],
  '23/24':[1.84,'Niño',1.74,1.99,1.53,1.13,1.30,1.40,0.78],
  '24/25':[-0.46,'Neutro',-0.19,-0.43,-0.22,-1.10,-0.76,-1.05,-0.85],
  '25/26':[-0.39,'Neutro',-0.57,-0.60,-0.21,-0.91,-0.93,-1.04,-0.76]
};

// Índice activo. El ONI es el que manda por defecto y hay una razón medida:
// el RONI deriva −0,25 por década en las cuatro ventanas (el ONI, nada), y
// una serie larga regresada contra un índice que deriva confunde la tendencia
// tecnológica del rinde con un efecto climático. Ver RP_INDICE_NOTA.
var RP_INDICE = 'oni';
var RP_INDICE_NOMBRE = { oni:'ONI', roni:'RONI' };
function rpSetIndice(v){
  if(v!==RP_INDICE){ RP_INDICE = v; if(typeof rpRenderEnso==='function') rpRenderEnso(); }
}
// Umbral de clasificación cuando el índice es el RONI: el listado de episodios
// de la NOAA está definido sobre el ONI, no sobre el RONI, así que no se puede
// reusar la etiqueta oficial. Se clasifica por umbral ±0,5 en la ventana DJF y
// el panel lo dice. La regresión no usa la etiqueta, usa el valor.
function rpEventoDe(v){
  if(v==null || !isFinite(v)) return 's/d';
  return v >= 0.5 ? 'Niño' : (v <= -0.5 ? 'Niña' : 'Neutro');
}

// Año de siembra de una campaña 'YY/YY'. Hace falta para el control de
// tendencia: el orden de las filas de la grilla no sirve como reloj, porque el
// cliente puede cargarlas desordenadas o salteadas. 90..99 son los noventa;
// 00..89, los dos mil.
function rpAnioCamp(clave){
  var m = String(clave||'').match(/^(\d{2})\//);
  if(!m) return null;
  var yy = Number(m[1]);
  return yy >= 90 ? 1900+yy : 2000+yy;
}

// Pronóstico de la campaña que viene. Se llena desde enso_oni (fila marcada
// es_pronostico) y alimenta un escenario aparte del stress test. Nunca entra
// a la regresión histórica: es un valor previsto, no observado.
var RP_ONI_PRONOSTICO = null;

// Ventana estacional que usa cada cultivo, según su período crítico.
//   SON  set-oct-nov   espigazón y llenado del trigo
//   NDJ  nov-dic-ene   floración del maíz temprano
//   DJF  dic-ene-feb   floración y llenado de la soja de primera
//   JFM  ene-feb-mar   floración de los cultivos de segunda
// Medir el trigo con DJF es medirlo con el clima de un momento en que ya está
// cosechado, y por eso su respuesta puede salir "no concluyente" aunque exista.
function rpVentanaCultivo(nombre){
  var n = String(nombre||'').toLowerCase();
  if(n.indexOf('segunda')>=0 || n.indexOf('2da')>=0 || n.indexOf('tardi')>=0) return 'jfm';
  if(n.indexOf('trigo')>=0 || n.indexOf('cebada')>=0 || n.indexOf('avena')>=0
     || n.indexOf('centeno')>=0 || n.indexOf('colza')>=0 || n.indexOf('canola')>=0) return 'son';
  if(n.indexOf('maíz')>=0 || n.indexOf('maiz')>=0)   return 'ndj';
  return 'djf';   // soja de primera, girasol, sorgo y cualquier otro
}
var RP_VENTANA_NOMBRE = { son:'set-nov', ndj:'nov-ene', djf:'dic-feb', jfm:'ene-mar' };

// Trae la serie viva de enso_oni. Si falla, queda la tabla de respaldo.
// Se pide una sola vez por sesión; el admin es quien la mantiene.
var _rpOniPedida = false;
async function rpCargarOni(){
  if(_rpOniPedida || typeof sb==='undefined' || !sb) return;
  _rpOniPedida = true;
  try{
    var res = await sb.from('enso_oni')
      .select('campania,oni,son,ndj,jfm,roni,roni_son,roni_ndj,roni_jfm,evento,es_pronostico,pronostico_fecha,pronostico_fuente');
    if(res.error || !res.data || !res.data.length) return;   // se conserva el respaldo
    var tabla = {}, pron = null;
    res.data.forEach(function(r){
      var k = rpNormCamp(r.campania);
      if(!k) return;
      var num = function(v){ return (v==null) ? null : Number(v); };
      if(r.es_pronostico){
        pron = { camp:k, evento:r.evento, fecha:r.pronostico_fecha, fuente:r.pronostico_fuente,
                 oni:  { djf:num(r.oni),  son:num(r.son),      ndj:num(r.ndj),      jfm:num(r.jfm) },
                 roni: { djf:num(r.roni), son:num(r.roni_son), ndj:num(r.roni_ndj), jfm:num(r.roni_jfm) } };
        return;                       // fuera de la serie histórica
      }
      tabla[k] = [num(r.oni), r.evento, num(r.son), num(r.ndj), num(r.jfm),
                  num(r.roni), num(r.roni_son), num(r.roni_ndj), num(r.roni_jfm)];
    });
    if(Object.keys(tabla).length) RP_ONI = tabla;
    RP_ONI_PRONOSTICO = pron;
    if(typeof rpRenderEnso === 'function') rpRenderEnso();
  }catch(e){ /* queda el respaldo embebido */ }
}

// Normaliza la etiqueta de campaña a 'YY/YY'. Acepta las formas que usan los
// clientes: 12/13 · 14-15 · '91/92 · 2012/2013 · 2012/13.
function rpNormCamp(s){
  var m = String(s==null?'':s).match(/(\d{2,4})\s*[\/\-]\s*(\d{2,4})/);
  if(!m) return null;
  var a = m[1].slice(-2), b = m[2].slice(-2);
  return a + '/' + b;
}

// Serie ENSO alineada con RP.filas, resuelta contra el índice activo.
// `oni` es el DJF del índice elegido —el valor de referencia de la campaña y el
// que colorea la tira— y `v` trae las cuatro ventanas para que cada cultivo use
// la suya. `ev` es la etiqueta: con ONI es la del listado de episodios de la
// NOAA; con RONI, que no tiene listado oficial, sale del umbral ±0,5.
function rpEnsoSerie(){
  var roni = (RP_INDICE === 'roni');
  return RP.filas.map(function(f){
    var k = rpNormCamp(f.camp);
    var e = k ? RP_ONI[k] : null;
    var n = function(j){ return (e && e[j]!=null && isFinite(e[j])) ? e[j] : null; };
    var v = roni ? { djf:n(5), son:n(6), ndj:n(7), jfm:n(8) }
                 : { djf:n(0), son:n(2), ndj:n(3), jfm:n(4) };
    return {
      camp:f.camp, clave:k,
      oni: v.djf,
      ev:  roni ? rpEventoDe(v.djf) : (e ? e[1] : 's/d'),
      v:   v
    };
  });
}

// Elige la ventana que va a usar un cultivo. Prefiere la de su período
// crítico, pero solo si está cargada en TODAS las campañas que tienen rinde:
// mezclar ventanas entre campañas sería regresar contra un regresor que
// cambia de significado a mitad de la serie. Si no alcanza, cae a DJF, que
// es la que está completa desde el 90/91.
function rpVentanaUsada(enso, idx, serie, pref){
  if(pref === 'djf') return 'djf';
  var completa = idx.every(function(i){
    var hayRinde = (serie[i] != null && isFinite(serie[i]));
    return !hayRinde || enso[i].v[pref] != null;
  });
  return completa ? pref : 'djf';
}

// Mínimos cuadrados con varios regresores. Devuelve los coeficientes y sus
// errores estándar. Se resuelve por eliminación sobre las ecuaciones normales:
// con dos o tres columnas eso es exacto de sobra y no hace falta traer una
// librería al bundle.
function rpOls(X, y){
  var n = y.length, p = X[0].length, i, a, b, r, c;
  var A = [], bv = [];
  for(a=0;a<p;a++){
    A.push([]);
    for(b=0;b<p;b++){ var s=0; for(i=0;i<n;i++) s += X[i][a]*X[i][b]; A[a].push(s); }
    var sb=0; for(i=0;i<n;i++) sb += X[i][a]*y[i]; bv.push(sb);
  }
  // [A | I | bv] → [I | A⁻¹ | beta]
  var M = [];
  for(a=0;a<p;a++){
    var fila = A[a].slice();
    for(b=0;b<p;b++) fila.push(a===b?1:0);
    fila.push(bv[a]);
    M.push(fila);
  }
  var W = 2*p+1;
  for(i=0;i<p;i++){
    var piv = i;
    for(r=i+1;r<p;r++) if(Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if(Math.abs(M[piv][i]) < 1e-12) return null;      // regresores colineales
    var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
    var d = M[i][i];
    for(c=i;c<W;c++) M[i][c] /= d;
    for(r=0;r<p;r++){
      if(r===i) continue;
      var f = M[r][i];
      if(!f) continue;
      for(c=i;c<W;c++) M[r][c] -= f*M[i][c];
    }
  }
  var beta = [], inv = [];
  for(a=0;a<p;a++){
    beta.push(M[a][2*p]);
    inv.push(M[a].slice(p, 2*p));      // fila completa de (X'X)⁻¹
  }
  var sse = 0;
  for(i=0;i<n;i++){
    var pred = 0;
    for(a=0;a<p;a++) pred += X[i][a]*beta[a];
    sse += (y[i]-pred)*(y[i]-pred);
  }
  if(n <= p) return null;
  var s2 = sse/(n-p);
  var se = [];
  for(a=0;a<p;a++) se.push(Math.sqrt(Math.max(s2*inv[a][a], 0)));
  return { beta:beta, se:se, inv:inv, n:n, p:p, s2:s2 };
}

// Error estándar de una combinación lineal de coeficientes, c'β.
// Hace falta para comparar dos pendientes del mismo ajuste: la varianza de la
// diferencia NO es la suma de varianzas, porque los dos coeficientes están
// correlacionados y ignorar la covarianza infla o desinfla el test.
function rpSeContraste(fit, c){
  if(!fit || !fit.inv) return NaN;
  var v = 0;
  for(var a=0;a<c.length;a++)
    for(var b=0;b<c.length;b++)
      v += c[a]*c[b]*fit.inv[a][b];
  return Math.sqrt(Math.max(fit.s2*v, 0));
}

// Desde cuántas campañas conviene controlar la tendencia. Con series cortas la
// tendencia no se identifica y el control solo cuesta potencia; con series
// largas, no controlarla es lo que rompe el cálculo.
var RP_ENSO_MIN_TEND = 20;

// Desde cuántas campañas se prueba el modelo ASIMÉTRICO, con una pendiente
// para el lado Niña y otra para el lado Niño. Por debajo de esto no se intenta:
// con 13 campañas el error de cada punta casi se duplica (de ±4,4 a ±8,7 puntos)
// porque una sola campaña extrema carga toda la información de su lado, y una
// asimetría grande se detecta menos de una vez de cada cinco. Con 35 campañas
// la detección sube al 63% en el caso extremo y ahí sí paga el costo.
// Además se exigen campañas suficientes de cada lado: una serie de 35 con 30
// Niñas y 5 Niños tiene el largo pero no el balance.
var RP_ENSO_MIN_ASIM = 30;
var RP_ENSO_MIN_LADO = 10;

// Regresión del shock relativo sobre el índice climático, por cultivo, con
// encogimiento. Devuelve null si no hay suficientes campañas con dato.
//
// Cuando la serie es larga se agrega la campaña como segundo regresor. El
// motivo es concreto: el rinde sube por mejora tecnológica unos puntos por
// década, y si el índice también se mueve en el tiempo, la regresión simple le
// atribuye al clima una parte de esa mejora. Medido por simulación sobre un
// cultivo con tendencia tecnológica y SIN efecto climático real, la regresión
// simple contra el RONI y 35 campañas marca efecto "firme" entre el 9% y el
// 12% de las veces cuando debería marcarlo el 5%; con la campaña dentro del
// modelo baja al 5% y, además, la potencia sube (con el ONI y 35 campañas,
// del 99% al 100%; con el RONI, del 92% al 99,8%). El control no es un lujo
// estadístico: es lo que hace que los dos índices se puedan usar.
function rpEnsoRegresion(){
  var enso = rpEnsoSerie();
  var idx = [];                         // índices de filas con índice conocido
  enso.forEach(function(e,i){ if(e.oni!=null) idx.push(i); });
  if(idx.length < 6) return null;
  var oni = idx.map(function(i){ return enso[i].oni; });
  var mo = rpMedia(oni);
  var sxx = oni.reduce(function(s,o){ return s + (o-mo)*(o-mo); }, 0);
  if(!(sxx > 0)) return null;           // sin variación del índice no hay nada que estimar

  var conTend = idx.length >= RP_ENSO_MIN_TEND;
  var out = [], tendencias = [];
  rpCultivosValidos().forEach(function(c){
    var sh = rpShocks(c.serie);
    // Cada cultivo se mide con la ventana de su período crítico.
    var vent = rpVentanaUsada(enso, idx, c.serie, rpVentanaCultivo(c.nombre));
    var xs=[], ys=[], ts=[], sinAnio=false;
    idx.forEach(function(i){
      var x = enso[i].v[vent];
      if(x!=null && sh[i]!=null && isFinite(sh[i])){
        var a = rpAnioCamp(enso[i].clave);
        if(a==null) sinAnio = true;
        xs.push(x); ys.push(sh[i]); ts.push(a);
      }
    });
    if(xs.length < 5) return;           // muy pocas campañas para este cultivo
    var mx = rpMedia(xs);
    var sxxC = xs.reduce(function(s,x){ return s+(x-mx)*(x-mx); }, 0);
    if(!(sxxC > 0)) return;

    // La campaña entra centrada y en décadas, para que el coeficiente de
    // tendencia se lea como "puntos de rinde por década". Si alguna etiqueta no
    // da año, no se controla la tendencia en ese cultivo: mejor sin control que
    // con un reloj inventado.
    var mt = rpMedia(ts);
    var usaTend = conTend && !sinAnio && xs.length >= RP_ENSO_MIN_TEND;
    var X = xs.map(function(x,k){
      return usaTend ? [1, x, (ts[k]-mt)/10] : [1, x];
    });
    var fit = rpOls(X, ys);
    if(!fit && usaTend){                // colineal: se cae a la simple
      usaTend = false;
      X = xs.map(function(x){ return [1, x]; });
      fit = rpOls(X, ys);
    }
    if(!fit) return;

    var b = fit.beta[1], seB = fit.se[1];

    /* ── Modelo asimétrico (bisagra en cero) ──────────────────────────────
       shock = a + bNiña·min(x,0) + bNiño·max(x,0) [+ tendencia]
       Una sequía suele pegar más fuerte de lo que ayuda un año húmedo, así que
       el supuesto lineal probablemente sea falso. Lo que no se puede es
       estimarlo con cualquier serie: hace falta largo Y balance entre lados.
       Se calcula aparte y solo se muestra si la diferencia entre las dos
       pendientes resiste un test; si no, el panel sigue informando el modelo
       simétrico y dice que se probó.                                        */
    var asim = null;
    var nNeg = xs.filter(function(x){ return x < 0; }).length;
    var nPos = xs.length - nNeg;
    if(xs.length >= RP_ENSO_MIN_ASIM && nNeg >= RP_ENSO_MIN_LADO && nPos >= RP_ENSO_MIN_LADO){
      var Xa = xs.map(function(x,k){
        var fila = [1, Math.min(x,0), Math.max(x,0)];
        if(usaTend) fila.push((ts[k]-mt)/10);
        return fila;
      });
      var fa = rpOls(Xa, ys);
      if(fa){
        var bNeg = fa.beta[1], bPos = fa.beta[2];
        var seDif = rpSeContraste(fa, usaTend ? [0,1,-1,0] : [0,1,-1]);
        var tDif  = (isFinite(seDif) && seDif > 0) ? (bNeg - bPos)/seDif : NaN;
        asim = {
          bNeg: bNeg, bPos: bPos, seNeg: fa.se[1], sePos: fa.se[2],
          nNeg: nNeg, nPos: nPos,
          // efecto a índice −1 y a índice +1, en shock de rinde
          efNina: -bNeg, efNino: bPos,
          seDif: seDif, tDif: tDif,
          distinta: isFinite(tDif) && Math.abs(tDif) > 1.96
        };
      }
    }

    out.push({
      asim: asim,
      nombre:c.nombre, i:c.i,
      // La grilla se carga en qq/ha; acá se pasa a tn/ha porque el stress test
      // y la columna de media se muestran en toneladas.
      media: rpMedia(c.serie.filter(function(x){return x!=null&&isFinite(x);}))/10,
      ventana: vent, ventanaPref: rpVentanaCultivo(c.nombre),
      n:xs.length, b:b, seB:seB, t:(isFinite(seB)&&seB>0)? b/seB : NaN,
      lo: b - 1.96*seB, hi: b + 1.96*seB,
      firme: isFinite(seB) && seB>0 && Math.abs(b/seB) > 1.96,
      conTend: usaTend,
      bTend:  usaTend ? fit.beta[2] : null,
      seTend: usaTend ? fit.se[2]   : null,
      tendFirme: usaTend && fit.se[2] > 0 && Math.abs(fit.beta[2]/fit.se[2]) > 1.96
    });
    if(usaTend) tendencias.push(fit.beta[2]);
  });
  if(!out.length) return null;

  // Encogimiento hacia el efecto común (James-Stein): varianza entre cultivos
  // descontando el error de medición. Si el ruido explica toda la dispersión,
  // todos los cultivos colapsan al promedio.
  var bs = out.map(function(o){ return o.b; });
  var bProm = rpMedia(bs);
  var varObs = out.length>1 ? bs.reduce(function(s,x){ return s+(x-bProm)*(x-bProm); },0)/(out.length-1) : 0;
  var varErr = rpMedia(out.map(function(o){ return isFinite(o.seB)? o.seB*o.seB : 0; }));
  var varEntre = Math.max(0, varObs - varErr);
  out.forEach(function(o){
    var w = (varEntre>0 && isFinite(o.seB)) ? varEntre/(varEntre + o.seB*o.seB) : 0;
    o.peso = w;
    o.bEnc = w*o.b + (1-w)*bProm;
  });
  return { cultivos:out, enso:enso, nConOni:idx.length, bProm:bProm,
           indice:RP_INDICE, conTend:out.some(function(o){ return o.conTend; }),
           tendProm: tendencias.length ? rpMedia(tendencias) : null,
           asimProbada: out.some(function(o){ return o.asim; }),
           asimDetectada: out.some(function(o){ return o.asim && o.asim.distinta; }) };
}

// Producción del planteo cargado bajo un ONI dado (tn), y la peor campaña real.
function rpEnsoStress(reg){
  var has = RP.has || {};
  var usados = reg.cultivos.filter(function(c){ return (has[c.nombre]||0) > 0; });
  if(!usados.length) return null;
  var haTot = usados.reduce(function(s,c){ return s + has[c.nombre]; }, 0);
  var base  = usados.reduce(function(s,c){ return s + has[c.nombre]*c.media; }, 0);
  var bajo  = function(oni){
    return usados.reduce(function(s,c){ return s + has[c.nombre]*c.media*(1 + c.bEnc*oni); }, 0);
  };
  // Peor campaña observada: solo las que tienen dato en todos los cultivos sembrados
  var peor = null;
  RP.filas.forEach(function(f, i){
    var tn = 0, completo = true;
    usados.forEach(function(c){
      var v = f.v[c.i];
      if(v==null || !isFinite(v)) { completo = false; return; }
      tn += has[c.nombre]*v/10;      // qq/ha → tn/ha
    });
    if(completo && (!peor || tn < peor.tn)) peor = { camp:f.camp, tn:tn };
  });
  return { haTot:haTot, base:base, bajo:bajo, peor:peor, usados:usados,
           sup: rpSuperficie(usados.map(function(c){ return c.nombre; })) };
}

function rpRenderEnso(){
  var cont = document.getElementById('rp_enso');
  if(!cont) return;
  var reg = rpEnsoRegresion();
  if(!reg){
    var enso0 = rpEnsoSerie();
    var reconocidas = enso0.filter(function(e){ return e.oni!=null; }).length;
    cont.innerHTML = '<div class="rp-sub">Análisis condicional por clima · ENSO</div>'
      + '<div class="rp-vacio">'
      + (reconocidas===0
          ? 'No se pudo reconocer ninguna campaña contra la tabla de índices climáticos. Revisá que las etiquetas tengan la forma 23/24 o 2023/24.'
          : 'Se necesitan al menos 6 campañas con índice climático conocido (hay '+reconocidas+') y 5 por cultivo.')
      + '</div>';
    return;
  }

  var pc = function(x,d){ return (x>=0?'+':'−') + rpFmt(Math.abs(x*100), d==null?1:d) + '%'; };
  var DOM = 0.25;                                   // dominio de la barra: ±25%
  var pos = function(v){ return Math.max(0, Math.min(100, (v+DOM)/(2*DOM)*100)); };

  var IX = RP_INDICE_NOMBRE[reg.indice];            // ONI o RONI, para los textos

  var h = '<div class="rp-sub">Análisis condicional por clima · ENSO</div>';
  h += '<p class="rp-expl">El modelo histórico sigue siendo el que manda: usa todas las campañas y es el que alimenta la combinación de menor riesgo. '
    +  'Esta capa le agrega una pregunta: <b>cuánto se corre el rinde de cada cultivo según el estado del Pacífico</b>, y qué le pasa a tu planteo si la campaña viene Niña.</p>';

  // ── selector de índice ──
  h += '<div class="rp-enso-sel">'
    +  '<span class="k">Índice</span>'
    +  '<button type="button" class="'+(reg.indice==='oni'?'on':'')+'" onclick="rpSetIndice(\'oni\')">ONI</button>'
    +  '<button type="button" class="'+(reg.indice==='roni'?'on':'')+'" onclick="rpSetIndice(\'roni\')">RONI</button>'
    +  '<span class="n">'
    +  (reg.indice==='oni'
        ? 'Anomalía de temperatura del Pacífico central (Niño 3.4). Es el índice estándar y el que define el listado de episodios de la NOAA.'
        : 'Igual que el ONI pero descontándole el calentamiento promedio de todo el trópico, para que un Pacífico apenas más cálido que el resto no cuente como Niño.')
    +  '</span></div>';

  // ── tira de campañas ──
  h += '<div class="rp-enso-tira-wrap"><div class="rp-enso-tira">';
  reg.enso.forEach(function(e){
    var cls = e.ev==='Niño'?'nino':e.ev==='Niña'?'nina':e.ev==='Neutro'?'neutro':'sd';
    h += '<div class="rp-enso-camp '+cls+'">'
      +  '<div class="et">'+e.camp+'</div>'
      +  '<div class="oni">'+(e.oni==null?'—':(e.oni>0?'+':'')+rpFmt(e.oni,1))+'</div>'
      +  '<div class="ev">'+e.ev+'</div></div>';
  });
  h += '</div></div>';
  h += '<div class="rp-enso-leyenda">'
    +  '<span><i class="nino"></i>Niño · Pacífico cálido</span>'
    +  '<span><i class="neutro"></i>Neutro</span>'
    +  '<span><i class="nina"></i>Niña · Pacífico frío</span>'
    +  '<span><i class="sd"></i>Sin dato</span></div>';
  h += '<p class="rp-expl">El número es el <b>índice '+IX+'</b> de diciembre-enero-febrero, la ventana que cubre floración y llenado de los cultivos de verano. '
    +  'Se resuelve solo desde la etiqueta de la campaña; no hay nada que clasificar a mano. Las campañas sin dato quedan fuera del cálculo. '
    +  (reg.indice==='oni'
        ? 'La etiqueta Niño/Niña es la del <b>listado oficial de episodios</b> de la NOAA, que pide cinco trimestres encadenados por encima de ±0,5: por eso alguna campaña puede figurar Niña con un DJF de −0,08, porque el episodio sí persistió.'
        : 'La NOAA no publica un listado de episodios para el RONI, así que acá la etiqueta sale del <b>umbral ±0,5 sobre el propio RONI</b> y no es comparable con la clasificación oficial. El cálculo no la usa: la regresión va contra el valor, no contra la etiqueta.')
    +  '</p>';

  // ── sensibilidad por cultivo ──
  h += '<div class="rp-sub" style="margin-top:20px">Sensibilidad de cada cultivo</div>';
  h += '<div class="rp-tabla-wrap"><table class="rp-tabla rp-tabla-riesgo"><thead><tr>'
    +  '<th style="text-align:left">Cultivo</th>'
    +  '<th>Media<small>tn/ha</small></th>'
    +  '<th>Ventana<small>período crítico</small></th>'
    +  '<th>Campañas<small>con dato</small></th>'
    +  '<th>Niña típica<small>'+IX+' −1</small></th>'
    +  '<th>Niño típico<small>'+IX+' +1</small></th>'
    +  '<th style="min-width:190px">Intervalo 95% · Niña<small>−25% · 0 · +25%</small></th>'
    +  '<th>Evidencia</th></tr></thead><tbody>';
  reg.cultivos.forEach(function(c){
    // efecto a ONI −1: el encogido para mostrar, el crudo para el intervalo
    var ef = -c.bEnc, lo = -c.hi, hi = -c.lo;
    var izq = Math.min(pos(lo), pos(hi)), der = Math.max(pos(lo), pos(hi));
    var ttl = c.nombre+': '+pc(ef)+' a '+IX+' −1 · intervalo '+pc(lo)+' a '+pc(hi)+' · '+c.n+' campañas'
            + (c.conTend ? ' · neto de una tendencia de '+pc(c.bTend)+' por década' : '');
    h += '<tr class="'+(c.firme?'':'rp-enso-flojo')+'">'
      +  '<td class="rp-nom">'+c.nombre+'</td>'
      +  '<td>'+rpFmt(c.media,1)+'</td>'
      +  '<td'+(c.ventana!==c.ventanaPref
            ? ' title="Su período crítico es '+RP_VENTANA_NOMBRE[c.ventanaPref]+', pero esa ventana no está cargada en todas las campañas con rinde, así que se usa dic-feb para no mezclar."'
            : '')+'>'
      +  RP_VENTANA_NOMBRE[c.ventana]
      +  (c.ventana!==c.ventanaPref ? ' <span style="color:var(--gris-l)">*</span>' : '')
      +  '</td>'
      +  '<td>'+c.n+'</td>'
      // Si el modelo asimétrico detectó que las dos puntas son distintas, se
      // muestran por separado: ahí el espejo deja de ser una simplificación
      // razonable y pasa a ser una afirmación falsa sobre estos datos.
      +  '<td style="font-weight:700">'
         + (c.asim && c.asim.distinta ? pc(c.asim.efNina)+' <span style="color:var(--oro-l)" title="Estimada por separado: con esta serie la respuesta a Niña y a Niño son distintas.">†</span>'
            : (c.firme?pc(ef):'—'))
      +  '</td>'
      // El modelo es lineal en el ONI, así que el efecto de un Niño típico es
      // el espejo exacto del de una Niña. Se muestra igual porque el productor
      // piensa en años, no en pendientes; la nota de abajo aclara que es
      // simétrico por construcción y no una segunda medición.
      +  '<td style="font-weight:700">'
         + (c.asim && c.asim.distinta ? pc(c.asim.efNino)+' <span style="color:var(--oro-l)">†</span>'
            : (c.firme?pc(-ef):'—'))
      +  '</td>'
      +  '<td><div class="rp-enso-bar" title="'+ttl+'">'
        +  '<span class="tick" style="left:0"></span><span class="tick" style="left:25%"></span>'
        +  '<span class="tick" style="left:75%"></span><span class="tick" style="left:calc(100% - 1px)"></span>'
        +  '<span class="eje"></span>'
        +  '<span class="ic" style="left:'+izq+'%;width:'+(der-izq)+'%"></span>'
        +  '<span class="tope" style="left:'+izq+'%"></span><span class="tope" style="left:'+der+'%"></span>'
        +  '<span class="pt" style="left:'+pos(ef)+'%"></span>'
      +  '</div></td>'
      +  '<td>'+(c.firme ? '<span class="rp-enso-chip firme">Firme</span>'
                         : '<span class="rp-enso-chip">No concluyente</span>')+'</td>'
      +  '</tr>';
  });
  h += '</tbody></table></div>';
  h += '<p class="rp-expl">El efecto se estima con una regresión del shock de rinde sobre el valor del '+IX+', usando las '+reg.nConOni+' campañas con dato. '
    +  'No se parten las campañas en tres grupos: con series de este largo quedarían 4 o 5 por grupo y el efecto dejaría de ser medible. '
    +  'El punto es la estimación y la línea el intervalo de confianza; <b>cuando cruza el cero el panel lo dice</b> en lugar de mostrar un número que no se sostiene.</p>';

  // ── control de tendencia ──
  if(reg.conTend){
    h += '<p class="rp-expl"><b>El efecto está medido neto de la tendencia de la serie.</b> '
      +  'Con '+reg.nConOni+' campañas el rinde no es plano: sube por mejora genética y de manejo'
      +  (reg.tendProm!=null ? ' —acá, alrededor de <b>'+pc(reg.tendProm)+' por década</b> en promedio de los cultivos—' : '')
      +  ' y esa suba no es clima. Si el índice también se corre con los años, una regresión simple le atribuye al Pacífico una parte de la mejora tecnológica. '
      +  'Por eso la campaña entra como segundo regresor y lo que se muestra es el efecto climático <b>a igualdad de año</b>. '
      +  'Sobre un cultivo simulado con tendencia tecnológica y sin ningún efecto climático real, la regresión sin este control marca efecto «firme» hasta en 1 de cada 8 casos; con el control, en 1 de cada 20, que es lo que corresponde. '
      +  'Y no se paga con precisión: controlando la tendencia el efecto verdadero se detecta <b>más</b> seguido, no menos.</p>';
  } else {
    h += '<p class="rp-expl">Con '+reg.nConOni+' campañas <b>no se controla la tendencia de la serie</b>: por debajo de '+RP_ENSO_MIN_TEND+' campañas la tendencia y el clima no se pueden separar con confianza y meterla al modelo solo resta precisión. '
      +  'La contrapartida es que si el rinde de la serie viene subiendo por mejora tecnológica, parte de esa suba puede quedar mezclada con el efecto climático. '
      +  'Con '+RP_ENSO_MIN_TEND+' campañas o más el panel la separa solo.</p>';
  }

  h += '<p class="rp-expl">Cada cultivo se mide con la ventana de su <b>período crítico</b>, no con una sola para todos: '
    +  'el trigo define rendimiento en set-nov y para esa fecha el verano todavía no pasó, mientras que un cultivo de segunda florece en feb-mar. '
    +  'Medirlos a todos con la misma ventana es medir a varios con el clima de un momento que no vivieron. '
    +  'Las cuatro ventanas están cargadas desde el 90/91 para los dos índices; un asterisco significa que en esta serie esa ventana no está disponible en todas las campañas con rinde y se usó dic-feb, para no mezclar ventanas dentro de la misma serie.</p>';
  // ── asimetría Niña / Niño ──
  if(reg.asimDetectada){
    var asims = reg.cultivos.filter(function(c){ return c.asim && c.asim.distinta; });
    h += '<p class="rp-expl"><b>Las dos puntas se midieron por separado y salieron distintas.</b> '
      +  'Con '+reg.nConOni+' campañas ya hay datos para estimar una pendiente para el lado Niña y otra para el lado Niño en vez de suponerlas espejo. '
      +  'Donde la diferencia resiste el test, la tabla muestra cada punta con su propio número y lo marca con †: '
      +  asims.map(function(c){
           return '<b>'+c.nombre+'</b> '+pc(c.asim.efNina)+' con Niña contra '+pc(c.asim.efNino)+' con Niño';
         }).join(' · ')
      +  '. En los demás cultivos se probó la asimetría y no se distingue del ruido, así que siguen con el modelo simétrico.</p>';
  } else if(reg.asimProbada){
    h += '<p class="rp-expl">Las columnas de Niña y Niño son <b>espejo una de la otra</b>: el modelo supone que el efecto crece parejo con el '+IX+'. '
      +  'Con '+reg.nConOni+' campañas el panel <b>probó estimarlas por separado</b> —una pendiente para cada lado— y la diferencia no se distingue del ruido en ningún cultivo, '
      +  'así que informa la versión simétrica, que es más precisa. Probablemente la asimetría exista igual: una sequía suele pegar más fuerte de lo que ayuda un año húmedo, '
      +  'pero con estos datos no se puede afirmar cuánto.</p>';
  } else {
    h += '<p class="rp-expl">Las columnas de Niña y Niño son <b>espejo una de la otra por construcción</b>: el modelo supone que el efecto crece parejo con el '+IX+', así que lo que una Niña saca, un Niño lo pone. '
      +  'Probablemente la realidad sea asimétrica —una sequía suele pegar más fuerte de lo que ayuda un año húmedo— pero medir las dos puntas por separado necesita más campañas de las que hay: '
      +  'con una serie de este largo, aun una asimetría grande se detecta menos de una vez de cada cinco, y el error de cada punta se duplica. '
      +  'Desde '+RP_ENSO_MIN_ASIM+' campañas, con al menos '+RP_ENSO_MIN_LADO+' de cada lado, el panel las estima solo.</p>';
  }

  // ── stress test del planteo ──
  var st = rpEnsoStress(reg);
  h += '<div class="rp-sub" style="margin-top:20px">Qué le pasa a tu planteo</div>';
  if(!st){
    h += '<div class="rp-vacio">Cargá las hectáreas en «Simulá tu planteo» para ver el efecto del clima sobre tu propia combinación.</div>';
  } else {
    var escenarios = [
      ['Niña típica', -1], ['Neutro', 0], ['Niño típico', 1]
    ];
    h += '<div class="rp-enso-kpis">';
    escenarios.forEach(function(e){
      var tn = st.bajo(e[1]), dif = tn/st.base - 1;
      var cls = Math.abs(dif)<0.0005 ? 'cero' : (dif<0 ? 'baja' : 'sube');
      h += '<div class="rp-enso-kpi"><div class="k">'+e[0]+'</div>'
        +  '<div class="v">'+rpFmt(tn,0)+'<small>tn</small></div>'
        +  '<div class="d '+cls+'">'+pc(dif)+' vs media histórica</div></div>';
    });
    if(st.peor){
      var difP = st.peor.tn/st.base - 1;
      h += '<div class="rp-enso-kpi peor"><div class="k">Peor campaña ('+st.peor.camp+')</div>'
        +  '<div class="v">'+rpFmt(st.peor.tn,0)+'<small>tn</small></div>'
        +  '<div class="d baja">'+pc(difP)+' vs media histórica</div></div>';
    }
    h += '</div>';

    // Escenario de pronóstico: la campaña que se está decidiendo todavía no
    // tiene ONI observado, y es justo la que importa. Va separado y marcado,
    // porque descansa en una previsión y no en la serie.
    var pr = RP_ONI_PRONOSTICO;
    // El pronóstico puede estar publicado en un índice y no en el otro. Si falta
    // el del índice activo se usa el que haya y se avisa, en lugar de ocultar
    // la campaña que justamente se está decidiendo.
    var prV = null, prIX = IX, prPrestado = false;
    if(pr){
      if(pr[reg.indice] && pr[reg.indice].djf != null){ prV = pr[reg.indice]; }
      else if(pr.oni && pr.oni.djf != null){ prV = pr.oni;  prIX = 'ONI';  prPrestado = true; }
      else if(pr.roni && pr.roni.djf != null){ prV = pr.roni; prIX = 'RONI'; prPrestado = true; }
    }
    if(pr && prV){
      // cada cultivo entra con el valor de SU ventana en el pronóstico
      var tnPr = st.usados.reduce(function(s,c){
        var x = prV[c.ventana];
        if(x==null) x = prV.djf;
        return s + (RP.has[c.nombre]||0)*c.media*(1 + c.bEnc*x);
      }, 0);
      var difPr = tnPr/st.base - 1;
      var clsPr = Math.abs(difPr)<0.0005 ? 'cero' : (difPr<0 ? 'baja' : 'sube');
      var fecha = pr.fecha ? new Date(pr.fecha+'T12:00:00Z').toLocaleDateString('es-AR') : null;
      var dias  = pr.fecha ? Math.round((Date.now()-new Date(pr.fecha+'T12:00:00Z').getTime())/86400000) : null;
      h += '<div class="rp-enso-pron">'
        +  '<div class="rp-enso-pron-k">Campaña '+pr.camp+' · según pronóstico</div>'
        +  '<div class="rp-enso-pron-fila">'
        +  '<div class="rp-enso-pron-v '+clsPr+'">'+rpFmt(tnPr,0)+'<small>tn</small></div>'
        +  '<div class="rp-enso-pron-d"><b>'+pc(difPr)+'</b> contra la media histórica de tu planteo<br>'
        +  prIX+' previsto '+(prV.djf>=0?'+':'')+rpFmt(prV.djf,1)+' · '+(pr.evento||'')
        +  '</div></div>'
        +  '<div class="rp-enso-pron-n">Esto <b>no es una campaña observada</b>: sale de un pronóstico'
        +  (pr.fuente ? ' de '+pr.fuente : '')
        +  (fecha ? ' con fecha '+fecha : '')
        +  (dias!=null && dias>45 ? ' <b class="rp-bad">— tiene '+dias+' días, conviene actualizarlo</b>' : '')
        +  '. Los pronósticos de ENSO cambian mes a mes y el de la campaña entrante es el que más se mueve.'
        +  (prPrestado
             ? ' <b>El pronóstico cargado está en '+prIX+' y la sensibilidad de arriba está medida en '+IX+'</b>, '
               + 'así que este escenario mezcla dos escalas y hay que leerlo como un orden de magnitud. '
               + 'Cargando el pronóstico en '+IX+' desde el panel de administración, el número queda consistente.'
             : '')
        +  '</div>'
        +  '</div>';
    }
    h += '<p class="rp-expl">Sobre las <b>'+rpFmt(st.haTot,0)+' ha sembradas</b> de tu planteo'
      +  (st.sup && st.sup.solape>0
           ? ', que son <b>'+rpFmt(st.sup.fisica,0)+' ha de campo</b> porque '
             + st.sup.pares.map(function(p){ return p.segunda+' va sobre el lote de '+p.invierno; }).join(' y ')
             + '. Las toneladas se cuentan sobre lo sembrado, que es lo que se cosecha'
           : '')
      +  '. El panel evalúa la asignación que vos elegiste; no propone una cartera climática. '
      +  'Medir un planteo fijo necesita muchos menos datos que optimizar uno, y es lo único que una serie de este largo sustenta.</p>';
  }

  // ── método ──
  h += '<div class="rp-enso-met">'
    +  '<div class="t">Lo que este cálculo no muestra, y por qué</div>'
    +  '<ul>'
    +  '<li><b>Correlaciones por evento.</b> Con 5 campañas Niña, una correlación real de 0,50 se estima con un intervalo de −0,46 a 0,94: no responde si los cultivos fallan juntos, lo simula.</li>'
    +  '<li><b>Cartera óptima por evento.</b> El peso de mínima varianza de dos cultivos con esa submuestra tiene un error de ±51 puntos porcentuales.</li>'
    +  '<li><b>CVaR 10%, P10 y mínimo por evento.</b> Con 5 campañas el percentil 10 cae debajo de la observación más baja: se extrapola en vez de medirse.</li>'
    +  '<li><b>Corte por ambiente.</b> Divide la muestra otra vez y deja celdas de una o dos campañas.</li>'
    +  '</ul>'
    +  '<p>Dos supuestos: el modelo es <b>lineal en el '+IX+'</b>, así que Niña y Niño salen simétricos aunque una sequía probablemente pegue más fuerte de lo que ayuda un año húmedo. '
    +  'Y el efecto de cada cultivo está <b>encogido hacia el promedio</b> de los cultivos en proporción a su precisión, para que uno con pocos datos no muestre una sensibilidad que es ruido.</p>'
    +  '<p><b>Por qué el ONI está por defecto y no el RONI.</b> El RONI es conceptualmente mejor: le descuenta al Pacífico el calentamiento del resto del trópico, '
    +  'y con eso campañas como la 24/25 o la 25/26 pasan de Neutro a Niña, que es más parecido a lo que se vivió en el lote. '
    +  'El problema es medible: en esta serie el RONI <b>deriva unos −0,25 por década</b> en las cuatro ventanas, mientras que el ONI no muestra ninguna deriva. '
    +  'Un regresor que deriva contra un rinde que sube por tecnología produce efectos climáticos que no existen. '
    +  'Con el control de tendencia activado ese problema desaparece y los dos índices quedan parejos, así que el selector es una elección real y no una trampa; '
    +  'el ONI queda por defecto porque es el que define la clasificación oficial de episodios y el que usa el resto de la cadena. '
    +  'Mirar los dos y comparar es mejor que elegir uno a ciegas: si el efecto aparece con ambos, es más creíble que si aparece solo con uno.</p>'
    +  '</div>';

  cont.innerHTML = h;
}

function rpRenderTodo(){
  rpRenderRiesgo();
  rpRenderCorrelaciones();
  rpRenderOptimo();
  rpRenderPlanteoInputs();
  rpRenderPlanteoResultado();
  rpRenderCostos();
  rpRenderEnso();
  rpCargarOni();        // trae la serie viva y, si cambia algo, repinta
}


/* ============================================================
   COSTOS POR CULTIVO Y PRECIO DE INDIFERENCIA
   - costo (USD/ha) ÷ P10 (tn/ha) = precio que hay que obtener
     para cubrir el costo en una campaña mala.
   - Se compara contra el futuro elegido y contra ese futuro
     castigado por su volatilidad escalada al plazo (√t).
   ============================================================ */

function rpProductoFuturo(nombreCultivo){
  var n = String(nombreCultivo||'').toLowerCase();
  if(n.indexOf('soja')>=0)  return 'Soja';
  if(n.indexOf('maiz')>=0 || n.indexOf('maíz')>=0) return 'Maiz';
  if(n.indexOf('trigo')>=0) return 'Trigo';
  return null;   // el resto no tiene futuro en A3
}

function rpEditarCosto(nombre, val){
  if(!RP.costo) RP.costo = {};
  var t = String(val).trim().replace(',','.');
  var n = (t==='') ? null : parseFloat(t);
  RP.costo[nombre] = (n!=null && isFinite(n) && n>=0) ? n : null;
  rpActualizarSalidaCosto(nombre);   // no reconstruye los inputs → no se pierde el foco
  rpActualizarResultado();
}
function rpEditarFuturo(nombre, vto){
  if(!RP.fut) RP.fut = {};
  if(vto) RP.fut[nombre] = vto; else delete RP.fut[nombre];
  rpActualizarSalidaCosto(nombre);
  rpActualizarResultado();
}

// Datos del cuadro de precios para un cultivo.
function rpPrecioCultivo(nombre, ci){
  var costo = (RP.costo||{})[nombre];
  var serie = rpSerie(ci);
  if(rpCount(serie) < 2) return null;
  var r = rpRiesgoIndividual(serie);
  var p10tn = r.p10/10;                       // qq/ha → tn/ha
  var mediaTn = r.mediaTn;
  if(!(p10tn>0)) return null;
  var out = { nombre:nombre, p10tn:p10tn, mediaTn:mediaTn, costo:costo };
  // Precio de indiferencia: el costo dividido por el rinde da los USD/tn que
  // hay que conseguir para cubrirlo. Con el P10 es el precio que hace falta en
  // una campaña mala; con la media, el de una campaña normal. La diferencia
  // entre los dos es, en la práctica, el colchón que da un buen año.
  out.precioCosto      = (costo>0) ? costo/p10tn  : null;   // campaña mala
  out.precioCostoMedia = (costo>0 && mediaTn>0) ? costo/mediaTn : null;

  var prod = rpProductoFuturo(nombre);
  out.producto = prod;
  if(prod && typeof ctxFuturosVigentes==='function'){
    out.futuros = ctxFuturosVigentes(prod);
    var elegido = (RP.fut||{})[nombre];
    out.fut = out.futuros.find(function(f){ return f.vto===elegido; }) || null;
    if(out.fut){
      out.precioFut = out.fut.precio;
      // volatilidad escalada al plazo: σ·√t (10% anual a 6 meses ≈ 7,07%)
      if(out.fut.volAnual!=null && out.fut.anios>0){
        out.volEscalada = out.fut.volAnual*Math.sqrt(out.fut.anios);
        out.precioFutVol = out.precioFut*(1-out.volEscalada);
      }
    }
  }
  return out;
}

/* ---------- Resultado del planteo en el escenario adverso ----------
   Junta las tres piezas que ya se calculan por cultivo y las lleva al nivel
   de la campaña entera:

     margen por tonelada = futuro castigado por su volatilidad − costo ÷ P10
     toneladas           = P10 (tn/ha) × hectáreas sembradas del cultivo
     aporte del cultivo  = margen por tonelada × toneladas
     resultado           = suma de los aportes

   Es lo que queda arriba (o abajo) del costo si la campaña sale mala por los
   dos lados a la vez: rinde de P10 y precio castigado por la volatilidad del
   futuro al plazo que falta. Equivale a  Σ ha × (precio castigado × P10 − costo),
   porque el precio de indiferencia por el P10 devuelve el costo por hectárea.

   Solo entran los cultivos que tienen las tres cosas: hectáreas, costo y un
   futuro elegido. Los que faltan se informan, no se asumen en cero.           */
function rpResultadoPlanteo(){
  var has = RP.has || {};
  var vs = rpCultivosValidos();
  var filas = [], faltan = [];
  vs.forEach(function(v){
    var ha = has[v.nombre] || 0;
    if(!(ha > 0)) return;                       // no sembrado: no participa
    var d = rpPrecioCultivo(v.nombre, v.i);
    if(!d){ faltan.push({ nombre:v.nombre, motivo:'sin serie suficiente' }); return; }
    if(d.precioCosto == null){ faltan.push({ nombre:v.nombre, motivo:'falta el costo' }); return; }
    if(d.precioFutVol == null){
      faltan.push({ nombre:v.nombre, motivo: d.producto ? 'falta elegir el futuro' : 'sin futuro de referencia' });
      return;
    }
    var tn = d.p10tn * ha;
    var margenTn = d.precioFutVol - d.precioCosto;
    filas.push({
      nombre: v.nombre, ha: ha, p10tn: d.p10tn, tn: tn,
      precioCosto: d.precioCosto, precioFutVol: d.precioFutVol,
      margenTn: margenTn, aporte: margenTn * tn,
      vto: d.fut ? d.fut.label : ''
    });
  });
  if(!filas.length) return { filas:filas, faltan:faltan, total:null, tnTotal:0, haTotal:0, sup:null };
  // El RESULTADO suma bien las hectáreas repetidas: si sobre el mismo lote va
  // trigo y después soja de segunda, se cobran los dos rindes y se pagan los dos
  // costos. Lo que no se puede decir es que el campo tenga esas hectáreas. Por eso
  // el dinero se calcula sobre lo sembrado y la superficie se informa física.
  return {
    filas: filas, faltan: faltan,
    total:   filas.reduce(function(s,f){ return s + f.aporte; }, 0),
    tnTotal: filas.reduce(function(s,f){ return s + f.tn; }, 0),
    haTotal: filas.reduce(function(s,f){ return s + f.ha; }, 0),
    sup:     rpSuperficie(filas.map(function(f){ return f.nombre; }))
  };
}

function rpRenderResultadoPlanteo(){
  var r = rpResultadoPlanteo();
  var h = '<div class="rp-res">';
  if(r.total == null){
    h += '<div class="rp-res-k">Resultado del planteo en una campaña mala</div>'
      +  '<div class="rp-res-vacio">Para calcularlo hace falta, en al menos un cultivo: '
      +  '<b>hectáreas</b> en «Simulá tu planteo», <b>costo por hectárea</b> y un <b>futuro de referencia</b> elegido.</div>';
    if(r.faltan.length){
      h += '<div class="rp-res-faltan">Falta: '
        + r.faltan.map(function(f){ return f.nombre+' ('+f.motivo+')'; }).join(' · ') + '</div>';
    }
    return h + '</div>';
  }
  var neg = r.total < 0;
  h += '<div class="rp-res-k">Resultado del planteo en una campaña mala</div>'
    +  '<div class="rp-res-v '+(neg?'neg':'pos')+'">'
    +  (neg ? '−' : '+') + ' US$ ' + rpFmt(Math.abs(r.total), 0) + '</div>'
    +  '<div class="rp-res-d">'
    +  (neg ? 'Es lo que te falta para cubrir el costo' : 'Es lo que queda por encima del costo')
    +  ' si el rinde sale en el P10 y el precio se castiga por la volatilidad del futuro.</div>';

  var hayDoble = r.sup && r.sup.solape > 0;
  h += '<div class="rp-res-sub">'
    +  (hayDoble
         ? rpFmt(r.sup.fisica,0) + ' ha de campo · ' + rpFmt(r.haTotal,0) + ' ha sembradas'
         : rpFmt(r.haTotal,0) + ' ha')
    +  ' · ' + rpFmt(r.tnTotal,0)
    +  ' tn con rinde de campaña mala · ' + rpFmt(r.total/r.tnTotal,1) + ' USD/tn promedio</div>';
  if(hayDoble){
    h += '<div class="rp-doble-info"><b>Doble cultivo:</b> '
      +  r.sup.pares.map(function(p){ return p.segunda+' sobre las mismas '+rpFmt(p.ha,0)+' ha de '+p.invierno; }).join(' · ')
      +  '. El resultado en dólares <b>sí</b> suma las dos cosechas, porque sobre ese lote se levantan los dos cultivos y se pagan los dos costos; '
      +  'lo que no se duplica es el campo, y por eso la superficie física ('+rpFmt(r.sup.fisica,0)+' ha) va separada de la sembrada ('+rpFmt(r.sup.sembrado,0)+' ha).</div>';
  }

  h += '<div class="rp-tabla-wrap"><table class="rp-tabla rp-tabla-riesgo"><thead><tr>'
    +  '<th style="text-align:left">Cultivo</th><th>ha</th>'
    +  '<th>P10<small>tn/ha</small></th><th>Toneladas<small>P10 × ha</small></th>'
    +  '<th>Costo ÷ P10<small>USD/tn</small></th><th>Futuro castigado<small>USD/tn</small></th>'
    +  '<th>Margen<small>USD/tn</small></th><th>Aporte<small>USD</small></th></tr></thead><tbody>';
  r.filas.forEach(function(f){
    var cls = f.margenTn >= 0 ? 'rp-ok' : 'rp-bad';
    h += '<tr><td class="rp-nom">'+f.nombre+'</td>'
      +  '<td>'+rpFmt(f.ha,0)+'</td>'
      +  '<td>'+rpFmt(f.p10tn,2)+'</td>'
      +  '<td>'+rpFmt(f.tn,0)+'</td>'
      +  '<td>'+rpFmt(f.precioCosto,0)+'</td>'
      +  '<td>'+rpFmt(f.precioFutVol,0)+'</td>'
      +  '<td class="'+cls+'" style="font-weight:700">'+(f.margenTn>=0?'+':'−')+rpFmt(Math.abs(f.margenTn),0)+'</td>'
      +  '<td class="'+cls+'" style="font-weight:700">'+(f.aporte>=0?'+':'−')+rpFmt(Math.abs(f.aporte),0)+'</td></tr>';
  });
  h += '</tbody></table></div>';
  if(r.faltan.length){
    h += '<div class="rp-res-faltan">Quedaron afuera: '
      + r.faltan.map(function(f){ return f.nombre+' ('+f.motivo+')'; }).join(' · ')
      + '. El total de arriba no los incluye.</div>';
  }
  return h + '</div>';
}

/* ---------- Gráfico simple (SVG, barras horizontales) ---------- */
function rpGraficoPrecios(d){
  var barras = [];
  if(d.precioCosto!=null)      barras.push({ lbl:'Costo ÷ P10', val:d.precioCosto, cls:'rp-b-costo' });
  if(d.precioCostoMedia!=null) barras.push({ lbl:'Costo ÷ rinde medio', val:d.precioCostoMedia, cls:'rp-b-costo-med' });
  if(d.precioFut!=null)     barras.push({ lbl:'Futuro '+d.fut.label, val:d.precioFut, cls:'rp-b-fut' });
  if(d.precioFutVol!=null)  barras.push({ lbl:'Futuro − volatilidad', val:d.precioFutVol, cls:'rp-b-vol' });
  if(barras.length<2) return '';

  var max = Math.max.apply(null, barras.map(function(b){ return b.val; }))*1.12;
  var W=440, alto=26, gap=12, H=barras.length*(alto+gap)+10, xLbl=142, x0=xLbl+8, x1=W-58;
  var esc = function(v){ return x0 + (v/max)*(x1-x0); };

  var svg = '<svg viewBox="0 0 '+W+' '+H+'" class="rp-graf">';
  barras.forEach(function(b,i){
    var y = i*(alto+gap)+6;
    svg += '<text x="'+xLbl+'" y="'+(y+alto*0.68)+'" class="rp-g-lbl">'+b.lbl+'</text>';
    svg += '<rect x="'+x0+'" y="'+y+'" width="'+Math.max(2,esc(b.val)-x0)+'" height="'+alto+'" rx="4" class="'+b.cls+'"/>';
    svg += '<text x="'+(esc(b.val)+6)+'" y="'+(y+alto*0.68)+'" class="rp-g-val">'+rpFmt(b.val,0)+'</text>';
  });
  // línea del costo como referencia vertical
  if(d.precioCosto!=null && barras.length>1){
    var xc = esc(d.precioCosto);
    svg += '<line x1="'+xc+'" y1="0" x2="'+xc+'" y2="'+H+'" class="rp-g-ref"/>';
  }
  svg += '</svg>';
  return svg;
}

// Parte calculada de la tarjeta de costo (precio, gráfico y lectura).
// Separada del render completo para poder actualizarla sin tocar los inputs.
function rpCostoSalida(d){
  if(!d || d.precioCosto==null) return '';
  var h = '<div class="rp-precio-linea">Necesitás <b>'+rpFmt(d.precioCosto,0)+' USD/tn</b> para cubrir el costo con un rinde de campaña mala (P10).</div>';
  if(d.precioCostoMedia!=null){
    h += '<div class="rp-precio-linea media">Con un rinde medio de '+rpFmt(d.mediaTn,2)+' tn/ha te alcanza con '
      +  '<b>'+rpFmt(d.precioCostoMedia,0)+' USD/tn</b>.</div>';
  }
  var g = rpGraficoPrecios(d);
  if(g){
    h += g;
    if(d.precioFutVol!=null){
      var margen = d.precioFutVol - d.precioCosto;
      var cls = margen>=0 ? 'rp-ok' : 'rp-bad';
      h += '<div class="rp-precio-lectura">Con el futuro castigado por su volatilidad ('
        +  rpFmt(d.volEscalada*100,1)+'% a '+rpFmt(d.fut.anios*12,0)+' meses) quedarías '
        +  '<b class="'+cls+'">'+(margen>=0?'+':'')+rpFmt(margen,0)+' USD/tn</b> '
        +  (margen>=0 ? 'por encima del costo.' : 'por debajo del costo.')+'</div>';
    }
  }
  return h;
}

// Repinta solo el número grande. Va aparte para poder llamarlo desde los
// tres lugares que lo afectan (costo, futuro y hectáreas) sin reconstruir
// ningún input: reconstruirlos haría perder el foco mientras se tipea.
function rpActualizarResultado(){
  var el = document.getElementById('rp_resultado');
  if(el) el.innerHTML = rpRenderResultadoPlanteo();
}

// Actualiza solo el resultado de un cultivo, sin redibujar sus inputs.
function rpActualizarSalidaCosto(nombre){
  var vs = rpCultivosValidos();
  var v = vs.find(function(x){ return x.nombre===nombre; });
  if(!v) return;
  var cont = document.querySelector('.rp-costo-out[data-cultivo="'+String(nombre).replace(/"/g,'\\"')+'"]');
  if(!cont) return;
  cont.innerHTML = rpCostoSalida(rpPrecioCultivo(nombre, v.i));
}

function rpRenderCostos(){
  var cont = document.getElementById('rp_costos');
  if(!cont) return;
  var vs = rpCultivosValidos();
  if(!vs.length){ cont.innerHTML=''; return; }

  var h = '<div class="rp-sub">Costos y precio necesario</div>';
  h += '<p class="rp-expl">Cargá el costo de producción por hectárea de cada cultivo. '
    +  'Dividido por el <b>P10</b> (el rinde de una campaña mala) da el <b>precio que necesitás obtener</b> para cubrirlo aun en un año flojo. '
    +  'En soja, maíz y trigo podés compararlo contra un futuro vigente.</p>';
  h += '<div class="rp-aviso-costo">El costo debería incluir lo necesario para desarrollar cada cultivo, '
    +  'pero no necesariamente los costos asociados a la comercialización.</div>';
  // El resultado de la campaña entera va primero: es la conclusión de todo lo
  // que viene abajo, y es lo que el productor mira.
  h += '<div id="rp_resultado">'+rpRenderResultadoPlanteo()+'</div>';

  vs.forEach(function(v){
    var d = rpPrecioCultivo(v.nombre, v.i);
    if(!d) return;
    var costoVal = (d.costo!=null) ? d.costo : '';
    h += '<div class="rp-costo-card">';
    h += '<div class="rp-costo-head">'
      +  '<span class="rp-costo-nom">'+v.nombre+'</span>'
      +  '<span class="rp-costo-p10">P10: '+rpFmt(d.p10tn,2)+' tn/ha</span>'
      +  '</div>';
    h += '<div class="rp-costo-inputs">';
    h += '<div class="estr-field"><label>Costo <small>(USD/ha)</small></label>'
      +  '<input type="text" inputmode="decimal" value="'+costoVal+'" placeholder="0" '
      +  'oninput="rpEditarCosto('+JSON.stringify(v.nombre).replace(/"/g,'&quot;')+',this.value)"></div>';
    if(d.producto && d.futuros && d.futuros.length){
      var sel = (RP.fut||{})[v.nombre] || '';
      var opts = '<option value="">— Elegí un futuro —</option>' + d.futuros.map(function(f){
        return '<option value="'+f.vto+'"'+(f.vto===sel?' selected':'')+'>'+f.label+' · '+rpFmt(f.precio,0)+' USD/tn</option>';
      }).join('');
      h += '<div class="estr-field"><label>Futuro de referencia <small>('+d.producto+')</small></label>'
        +  '<select onchange="rpEditarFuturo('+JSON.stringify(v.nombre).replace(/"/g,'&quot;')+',this.value)">'+opts+'</select></div>';
    } else if(d.producto){
      h += '<div class="estr-field"><label>Futuro de referencia</label>'
        +  '<div class="rp-sin-fut">Sin futuros vigentes cargados</div></div>';
    }
    h += '</div>';

    // La parte calculada va en su propio contenedor: así se actualiza sola
    // sin reconstruir los inputs (si no, se pierde el foco al escribir).
    h += '<div class="rp-costo-out" data-cultivo="'+String(v.nombre).replace(/"/g,'&quot;')+'">'
      +  rpCostoSalida(d) + '</div>';
    h += '</div>';
  });
  cont.innerHTML = h;
}

// Muestra la sección solo si el cliente tiene Agricultura PRO.
function rpAplicarGatePro(){
  var sec = document.getElementById('sec-riesgo-prod');
  if(!sec) return false;
  // Si el perfil del cliente todavía no cargó, NO decidimos: devolvemos false
  // para reintentar. Antes se evaluaba una sola vez a los 1,2 s y, si la carga
  // demoraba, el módulo quedaba oculto aunque el cliente fuera PRO.
  if (typeof currentCliente === 'undefined' || !currentCliente) return false;
  var pro = (typeof isAgriculturaPro === 'function') ? isAgriculturaPro() : false;
  sec.style.display = pro ? '' : 'none';
  return true;
}
window.rpAplicarGatePro = rpAplicarGatePro;

// Reintenta hasta que el perfil esté disponible (máximo ~30 s).
function rpVigilarGatePro(){
  var intentos = 0;
  var iv = setInterval(function(){
    intentos++;
    if (rpAplicarGatePro() || intentos > 60) clearInterval(iv);
  }, 500);
}
document.addEventListener('DOMContentLoaded', rpVigilarGatePro);
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'visible') rpAplicarGatePro();
});
