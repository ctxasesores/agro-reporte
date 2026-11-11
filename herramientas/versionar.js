#!/usr/bin/env node
/* ============================================================
   Context — versionar.js
   ------------------------------------------------------------
   Se corre ANTES de cada commit que toque el front:

       node herramientas/versionar.js           (aplica los cambios)
       node herramientas/versionar.js --check   (solo verifica; sale con 1 si falta algo)

   Qué hace, todo junto y siempre igual:
     1) Cada <script src="…?v=…"> y <link href="…?v=…"> local de los
        HTML del repo pasa a llevar como ?v= la huella de su contenido
        (sha256, 10 caracteres). Solo cambia el ?v= del archivo que cambió,
        así el navegador baja de nuevo nada más que eso.
        Lo mismo con las rutas versionadas dentro del código, como
        `'js/riesgo-productivo.js?v=…'`, que es un módulo que se carga a
        demanda (la ruta se resuelve contra la raíz del repo).
     2) El ?v= del iframe del tambo (buildTamboSrc en js/app.js) pasa a
        ser la huella de Tambo/tambo_integrado_PRODUCCION_v1.html.
     3) SHELL_ASSETS en sw.js se arma con las mismas URLs que pide
        index.html (con su ?v=), más las que sus JS cargan a demanda, para
        que el fallback sin conexión las encuentre tal cual.
     4) Si index.html o sw.js cambiaron desde la última corrida, sube JUNTOS
        el build (version.json y CTX_BUILD en index.html, mismo valor,
        hora de Argentina) y CACHE_VERSION en sw.js (ctx-vN → ctx-vN+1).
        Si no cambió nada, no toca nada: correrlo dos veces da lo mismo.

   Por qué existe: subir esos números a mano es fácil de olvidar, y
   olvidarlo no da error. Da un usuario con una mezcla de versión vieja
   y nueva, o un cartel de «versión nueva» que no se va nunca.

   Lo que NO hace: no sube FIN_VERSION de kpi-financiero.js (esa es una
   decisión sobre el contenido, no sobre el deploy) ni toca archivos que
   no tengan ya un ?v=. Para versionar un archivo nuevo, se lo referencia
   con ?v=0 y se corre este script.

   Sin dependencias: solo Node.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const leer = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const huella = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const huellaArchivo = rel => huella(fs.readFileSync(path.join(RAIZ, rel)));

const cambios = [];          // [rel, contenidoNuevo]
const avisos = [];
const nuevos = new Map();    // rel -> contenido en memoria (para encadenar pasos)
const contenido = rel => nuevos.has(rel) ? nuevos.get(rel) : leer(rel);
const poner = (rel, txt) => { if (txt !== contenido(rel)) nuevos.set(rel, txt); };

/* ---------- 1) ?v= de scripts y estilos locales ---------- */
function htmlDelRepo(dir = '') {
  let out = [];
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'herramientas') continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(htmlDelRepo(rel));
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

const RE_REF = /(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^"?#:]+)\?v=([^"&#]*)(")/g;

// Archivos que se cargan a demanda desde el código (por ejemplo
// `const X_SRC = 'js/modulo.js?v=…'`). La ruta se resuelve contra la página
// que los carga: para un .js es la raíz del repo (lo carga index.html); para
// un .html, su propia carpeta.
const RE_STR = /(['"])((?:js|css)\/[\w.-]+\.(?:js|css))\?v=([^'"&#]*)\1/g;

// La huella usa lo que está en memoria, no lo del disco: si app.js cambia el
// ?v= de un módulo, la huella de app.js tiene que salir de su versión nueva.
const huellaActual = rel => huella(Buffer.from(contenido(rel), 'utf8'));
const esTexto = rel => /\.(js|css|html)$/.test(rel);
const huellaDe = rel => esTexto(rel) ? huellaActual(rel) : huellaArchivo(rel);

function versionarRefs(rel, base) {
  const fijar = (todo, url, armar) => {
    const destino = path.posix.normalize(path.posix.join(base, url));
    if (!fs.existsSync(path.join(RAIZ, destino))) {
      avisos.push(`${rel}: ${url} no existe`);
      return todo;
    }
    return armar(huellaDe(destino));
  };
  let txt = contenido(rel);
  if (rel.endsWith('.html')) {
    txt = txt.replace(RE_REF, (todo, a, url, v, z) => fijar(todo, url, h => `${a}${url}?v=${h}${z}`));
  }
  txt = txt.replace(RE_STR, (todo, q, url) => fijar(todo, url, h => `${q}${url}?v=${h}${q}`));
  poner(rel, txt);
}

const jsLocales = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)
  .concat(['kpi-financiero.js']);

/* ---------- 2) ?v= del iframe del tambo (buildTamboSrc, en js/app.js) ---------- */
const TAMBO = 'Tambo/tambo_integrado_PRODUCCION_v1.html';
const RE_TAMBO = /(qs\.set\('v',\s*')([^']*)('\))/;
function versionarTambo() {
  const rel = ['js/app.js', 'index.html'].find(f => RE_TAMBO.test(contenido(f)));
  if (!rel) { avisos.push("no encontré qs.set('v', …) de buildTamboSrc"); return; }
  poner(rel, contenido(rel).replace(RE_TAMBO, `$1${huellaDe(TAMBO)}$3`));
}

// Se repite hasta que nada cambie: un módulo cambia el ?v= dentro de app.js,
// eso cambia la huella de app.js y por lo tanto su ?v= en index.html.
for (let pasada = 0; pasada < 6; pasada++) {
  const antes = JSON.stringify([...nuevos]);
  versionarTambo();
  for (const js of jsLocales) versionarRefs(js, '');
  for (const html of htmlDelRepo()) versionarRefs(html, path.posix.dirname(html));
  if (JSON.stringify([...nuevos]) === antes) break;
  if (pasada === 5) avisos.push('las referencias no se estabilizaron (¿hay un ciclo?)');
}
const avisosUnicos = () => [...new Set(avisos)];


/* ---------- 3) SHELL_ASSETS de sw.js ---------- */
{
  const idx = contenido('index.html');
  const locales = [];
  idx.replace(RE_REF, (t, a, url, v) => { locales.push(`./${url}?v=${v}`); return t; });
  // Más los que esos JS cargan a demanda (p. ej. riesgo-productivo.js): un
  // usuario PRO sin señal también tiene que poder abrirlos.
  const pedidosJs = locales.map(u => u.slice(2).split('?')[0]).filter(f => f.endsWith('.js'));
  for (const js of ['index.html', ...pedidosJs]) {
    contenido(js).replace(RE_STR, (t, q, url, v) => { locales.push(`./${url}?v=${v}`); return t; });
  }
  const lista = [...new Set(['./', './index.html', ...locales, './icons/icon-192.png', './icons/icon-512.png'])];
  const bloque = 'const SHELL_ASSETS = [\n' + lista.map(u => `  '${u}'`).join(',\n') + '\n];';
  const sw = contenido('sw.js');
  const re = /const SHELL_ASSETS = \[[\s\S]*?\];/;
  if (!re.test(sw)) avisos.push('sw.js: no encontré SHELL_ASSETS');
  else poner('sw.js', sw.replace(re, bloque));
}

/* ---------- 4) build y CACHE_VERSION ---------- */
const RE_BUILD = /(var CTX_BUILD = ')([^']*)(';)/;
const RE_CACHE = /(const CACHE_VERSION = 'ctx-v)(\d+)(';)/;

// La huella del shell ignora los propios números de versión: si no,
// subirlos cambiaría la huella y el script nunca quedaría quieto.
function huellaShell() {
  const idx = contenido('index.html').replace(RE_BUILD, '$1$3');
  const sw = contenido('sw.js').replace(RE_CACHE, '$1$3');
  return huella(idx + '\u0000' + sw);
}

{
  const idx = contenido('index.html');
  const sw = contenido('sw.js');
  const ver = JSON.parse(contenido('version.json'));
  const mBuild = idx.match(RE_BUILD);
  const mCache = sw.match(RE_CACHE);
  if (!mBuild) avisos.push('index.html: no encontré CTX_BUILD');
  if (!mCache) avisos.push('sw.js: no encontré CACHE_VERSION');

  if (mBuild && mCache) {
    const h = huellaShell();
    let build = ver.build;
    if (ver.huella !== h) {
      build = buildAhora();
      // Si ya se corrió en este mismo minuto, el build igual tiene que ser otro
      // (y nunca volver a uno anterior: un usuario con ese build no vería el aviso).
      if (String(ver.build).slice(0, 13) === build) build += '-' + h.slice(0, 4);
      poner('sw.js', sw.replace(RE_CACHE, `$1${Number(mCache[2]) + 1}$3`));
      // `huella` la usa solo este script; la app lee únicamente `build`.
      poner('version.json', `{ "build": "${build}", "huella": "${h}" }\n`);
    }
    poner('index.html', contenido('index.html').replace(RE_BUILD, `$1${build}$3`));
    if (mBuild[2] !== ver.build && ver.huella === h) {
      avisos.push(`CTX_BUILD (${mBuild[2]}) y version.json (${ver.build}) no coincidían: se igualó CTX_BUILD`);
    }
  }
}

function buildAhora() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

/* ---------- salida ---------- */
for (const [rel, txt] of nuevos) cambios.push([rel, txt]);
avisosUnicos().forEach(a => console.warn('AVISO  ' + a));

if (!cambios.length) {
  console.log('Todo al día: ningún número de versión que subir.');
  process.exit(avisos.length ? 1 : 0);
}
if (CHECK) {
  cambios.forEach(([rel]) => console.log('DESACTUALIZADO  ' + rel));
  console.log('\nCorré: node herramientas/versionar.js');
  process.exit(1);
}
for (const [rel, txt] of cambios) {
  fs.writeFileSync(path.join(RAIZ, rel), txt);
  console.log('actualizado  ' + rel);
}
const v = JSON.parse(leer('version.json'));
console.log(`\nbuild ${v.build} · ${leer('sw.js').match(RE_CACHE)[0]}`);
process.exit(avisos.length ? 1 : 0);
