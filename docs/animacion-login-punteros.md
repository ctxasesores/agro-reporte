# Animación de punteros constructores: CTX AgroCartera

Especificación de la animación tal como está implementada en `ctxasesores/agro-reporte` (16/11/2026: incluye la copia de elementos iguales y el ritmo 0,4939). Vive en el repo como `docs/animacion-login-punteros.md`. Sirve para mantenerla o reconstruirla desde Claude Code. Si este documento y el código no coinciden, manda el código. En ese caso hay que actualizar este documento.

**Archivos**

| Archivo | Rol |
|---|---|
| `js/login-animacion.js` | Toda la lógica: isotipo, punteros, cola de tareas, login, barra lateral, tableros y cierre de sesión |
| `css/login-animacion.css` | Capas, estados ocultos y transiciones CSS (ya multiplicadas por el ritmo) |
| `index.html` | Script mínimo en `<head>` (clase `ctx-anim`), marcas `data-b` del login y aviso de sesión `ctxLoginAnim.sesion()` |
| `js/app.js` | Llama a `salir()`, `panel()` y `desarmarPanel()` en los puntos de entrada y salida |

## 1. Concepto

Ocho puntos de luz ("punteros") construyen la interfaz. Comparten una cola de tareas: cada uno toma un elemento, traza su contorno, lo pinta y pasa al siguiente sin desaparecer. Cuando hay elementos iguales, solo el primero se dibuja: los demás salen de una **copia** que un puntero arrastra desde el original. Antes de que trabajen, el isotipo se arma en el centro y hace de pantalla de carga.

Los punteros:

- arman el login y lo reescriben al cambiar entre **Ingresar** y **Registrarme**;
- al ingresar con éxito lo desarman y se van;
- dibujan la **barra lateral** del panel y cada **tablero** la primera vez que se abre;
- al **cerrar sesión** desarman la barra y el tablero abierto.

## 2. Ritmo global

Todas las duraciones de este documento son **valores base**. En ejecución se multiplican por:

- `RITMO = 0.4939`: el resultado de pedir tres veces "30 % más rápido" y después dos veces "20 % más lento" (0,343 × 1,2 × 1,2). Afecta todos los tweens, las pausas (`pausa(ms)`), el escalonado de arranque y las velocidades de desvanecimiento por frame, que se **dividen** por `RITMO`.
- `ARMADO = 0.7`: un factor extra solo para **dibujar**, que lo hace un 30 % más rápido que borrar. Se aplica a los desplazamientos y tweens dentro de `build()`.

Las transiciones CSS equivalentes ya están multiplicadas en el CSS (por ejemplo, 0,9 s × RITMO = 0,44 s). Si cambia `RITMO`, hay que recalcularlas: logo del login y de la barra 0,44 s, fade de los punteros 0,54 s, opacidad de cada puntero 0,3 s, loader 0,48 s y logo de la barra al cerrar sesión 0,31 s (en el JS).

Para cambiar la velocidad general, tocar solo `RITMO`.

## 3. Activación y respaldo

1. En `<head>`, antes de pintar nada, un script agrega `ctx-anim` a `<html>`, salvo que el usuario tenga `prefers-reduced-motion: reduce`. Si a los 6 s no existe `window.ctxLoginAnim`, quita la clase y el login se ve como siempre.
2. Sin `ctx-anim`, el módulo no hace nada.
3. Con la clase, el CSS oculta con `clip-path: inset(0 100% 0 0)` todo lo que tiene `[data-b]` en `#loginScreen` y deja el logo del encabezado en opacidad 0.
4. El módulo agrega a `<html>`:
   - `ctx-panel`, que oculta la barra lateral hasta dibujarla;
   - `ctx-vista-oculta`, que tapa el tablero activo hasta elegir qué piezas dibujar.
5. **Cualquier error** dentro de la animación termina en `mostrarTodo()`, que muestra todo al instante, quita las capas y apaga los loops. La animación nunca puede dejar la app trabada u oculta.

## 4. Capas

Se crean por JS y se agregan a `<body>`:

| Capa | z-index | Uso |
|---|---|---|
| `#ctxFx` (canvas, `devicePixelRatio` hasta 2) | 9; 201 sobre el panel | Contornos, guías y ripples |
| `#ctxCursors` | 10; 202 sobre el panel | Los 8 puntos, movidos con `transform: translate()` |
| `#ctxLoader` | 11 | SVG del isotipo, de 120 px, centrado |
| `#ctxPill` | 8 | Pastilla inferior "Verificando credenciales…" |

Ninguna captura clics (`pointer-events: none`). La barra lateral tiene z-index 200, por eso las capas suben a 201 y 202 cuando hay panel.

Las posiciones se leen en cada frame con `getBoundingClientRect()`. Para piezas dentro de iframes del mismo sitio (Ganadería, Tambo) se suma la posición del iframe.

## 5. Intro del isotipo (pantalla de carga)

Usa los 5 paths de `isotipo_sin_fondo.svg` (viewBox 240.3):

- `rosa` y `azul`: los dos 3/4 de círculo;
- `blanca`: la pieza central;
- `qRosa` y `qAzul`: los dos cuartos de círculo.

Los grupos rosa y azul llevan `mix-blend-mode: screen`.

1. **Punto (560 ms):** el SVG arranca a escala `0.06` (unos 7 px) con los dos círculos **totalmente encimados** en el centro del logo. El grupo rosa se corre `(-60, +60)` y el azul `(+60, -60)` en unidades del viewBox. Crece hasta escala 1 con `easeOutBack` y la opacidad sube a 1 en el primer tercio.
2. Pausa de 200 ms.
3. **Separación (560 ms, easeInOut):** los corrimientos van de 1 a 0 y cada círculo queda en su lugar.
4. Pausa de 260 ms.
5. **Giro de los cuartos (760 ms):** los dos cuartos forman un cuadrado con centro en `(120.15, 120.15)`, el centro del logo. Giran juntos con `rotate(a 120.15 120.15)`, de 90° a 0° (hacia la izquierda). Con 90° cada cuarto está dentro de su círculo, que se ve completo. Con 0° quedan en su lugar: el rosa arriba a la izquierda y el azul abajo a la derecha.
6. **Pieza blanca (380 ms):** aparece con un fade.
7. **Espera de carga:** espera a la vez un mínimo de 300 ms, las fuentes (`document.fonts.ready`, como máximo 1,2 s) y la sesión (`ctxLoginAnim.sesion(quien)`). Si la sesión no se resuelve en 15 s, sigue como `'login'`.
8. Según la sesión:
   - **`'login'`:** el isotipo viaja al encabezado (720 ms, FLIP con escala) hasta `#ctxLoginLogo` (52 px). Al llegar se muestra el logo estático sin transición y se quita el loader.
   - **`'app'`** (ya había sesión): el login no se dibuja. El isotipo queda en el centro hasta que el panel avisa que está listo (ver §11).

`index.html` llama a `ctxLoginAnim.sesion('app' | 'login')` en el `load`, después de `getSession()`. También llama con `'login'` en la vuelta de recuperación de contraseña y si hay error.

## 6. Punteros

| Propiedad | Valor |
|---|---|
| Cantidad | 8 |
| Forma | círculo de 7 px, `box-shadow: 0 0 8px 1px <color>aa` |
| Colores | `#d56a9d`, `#7dbaf8`, `#fcfcfc`, `#e3bb4d`, repetidos dos veces |
| Opacidad en reposo / trabajando | 0.14 / 1 (transición de 0,25 s) |
| Posición inicial | fuera de pantalla, arriba a la izquierda: `(-22 - i·5, -26 - i·4)` |
| Reposo (`gather = 'park'`) | grilla de 4×2 abajo a la izquierda: `(26 + col·20, H - 70 + fila·22)`, con deriva seno/coseno de ±4 px |
| Reposo (`gather = 'center'`) | grilla de 4×2 en el centro: `(W/2 - 30 + col·16, H/2 - 14 + fila·18)` |
| Desplazamiento | `clamp(distancia × 0.8, 220, 850)` ms, con easeInOutQuad |

**Arranque escalonado (`stagger`):** el orden es aleatorio. A cada puntero se le asigna `wakeAt`: con 30 % de probabilidad sale 40–130 ms después del anterior y, si no, 200–950 ms después (× RITMO). Antes de su `wakeAt` no toma tareas. El desplazamiento de reposo se interrumpe si aparece una tarea o si cambia `wakeAt`.

**Generación (`gen`):** cada vez que se reactivan los punteros, `gen` aumenta. Un puntero de una generación vieja deja de trabajar, así un armado cortado (por ejemplo, al cerrar sesión a mitad de camino) no sigue dibujando.

## 7. Dibujar y borrar

### Colores (`finalColor`)
En orden de prioridad:

1. `data-c` en el elemento, que fija el color del trazo;
2. botón `.btn-primary` con fondo visible: su fondo (dorado);
3. borde visible: el color del borde;
4. fondo visible: el color de fondo;
5. si no, el color del texto.

Siempre se usa el **tono pleno**: se descarta la transparencia del estilo de la app para que el trazo se vea.

### Dibujar un recuadro (`data-b="box"`)
Todo va de arriba a la izquierda hacia abajo a la derecha.

1. El puntero va al vértice superior izquierdo.
2. **Contorno (`clamp(diagonal × 1.5, 380, 1000)` ms, easeInOut):** el puntero arrastra en diagonal hasta el vértice inferior derecho, como una selección. El rectángulo crece desde arriba a la izquierda.
3. Mientras tanto se ven las **guías de construcción** de sus 4 vértices: desde cada uno, una línea horizontal y una vertical hasta el borde de la página, hacia afuera.
4. El puntero vuelve al vértice superior izquierdo.
5. **Relleno (`clamp(ancho × 1.6, 420, 800)` ms):** barrido diagonal que revela la región `x/w + y/h ≤ s`, con `s` de 0 a 2, mediante `clip-path: polygon(...)` con 4 px de margen. El puntero zigzaguea sobre el frente diagonal (9 medias ondas, amplitud ±45 %).
6. Contorno y guías se desvanecen.

### Dibujar un texto (`data-b="text"`)
Sin contorno ni guías de construcción. Solo el barrido diagonal (`clamp(ancho × 2.2, 260, 850)` ms) con el puntero en el centro del frente.

### Borrar (camino inverso)
- El puntero va al vértice inferior derecho y el barrido retrocede (`s` de 2 a 0) en `clamp(ancho × 1.2, 240, 650)` ms, con zigzag de 7 medias ondas en los recuadros.
- En los recuadros, después aparece el contorno y el puntero lo **encoge** hasta el vértice superior izquierdo (`clamp(diagonal × 1.1, 300, 800)` ms).
- **Al borrar no hay guías:** ni las de construcción ni la cruz del puntero (`borrando = true`).

### Trazos (canvas)

| Trazo | Grosor | Color | Opacidad | Desvanecido por frame |
|---|---|---|---|---|
| Contorno | 1,5 px, sólido | color final | 1 | −0,03 / RITMO |
| Guías de construcción | 2 px, sólidas | color final | 0,85 | −0,045 / RITMO (más rápido que el contorno) |
| Cruz del puntero (horizontal y vertical a toda la página) | **0,5 px**, sólida | color del puntero | 0,7 | rampa +0,12 / −0,06 por frame (/ RITMO). Solo mientras dibuja |
| Ripple de clic | 2 px | `#e3bb4d` | 1 | radio +1,4 y opacidad −0,04 por frame (/ RITMO) |

## 7 bis. Copiar elementos iguales

**Gemelos:** dos recuadros (`data-b="box"`) de la misma tanda son gemelos si tienen la misma etiqueta, las mismas clases y el mismo tamaño (±3 px, más de 8 px de lado), y ninguno contiene al otro.

- Las **clases de estado no cuentan**: `active`, `on`, `open`, `collapsed`, `busy` y `ctx-*`. Así una pestaña o un ítem del menú activo sigue siendo gemelo de los demás.
- Dentro de cada tanda, en orden de lectura, cada gemelo se asigna al **primer gemelo anterior que no es copia**: el original de su grupo. Ese original se dibuja normal y todos los demás del grupo salen de una copia suya.
- Los textos nunca se copian.

**Ejemplos en la app:**

| Lugar | Original | Copias |
|---|---|---|
| Login | pestaña Ingresar, campo Email | pestaña Registrarme, campo Contraseña |
| Registrarme | campo Empresa | Email, Contraseña, Campaña |
| Barra lateral | ítem KPIs, botón Cuenta | los otros 4 ítems, Cerrar sesión |
| Tableros | la primera tarjeta de cada fila | las tarjetas del mismo tamaño (KPIs, valores de Mercado, tarjetas grandes) |

### Copiar (`copiar`, al armar)
1. El puntero va al **centro** del original (desplazamiento × ARMADO) y deja un anillo de "agarre" (2 px, opacidad 0,8, color del puntero).
2. Aparece un **fantasma**: la caja del gemelo destino, con su fondo (si es visible), su contorno (1,5 px, color final) y su radio de borde. Se usan los colores del **destino**, así al soltarlo coincide con lo que aparece; por ejemplo, una pestaña inactiva copiada de la activa.
3. Pausa de 140 ms.
4. **Arrastre** (`clamp(distancia × 1.3, 480, 1000)` ms × ARMADO, easeInOut): el fantasma viaja desde el original hasta el lugar del destino, interpolando posición y tamaño, con el puntero en su centro. Lleva las **guías de sus 4 vértices** hasta el borde de la página (2 px, 0,85), igual que un contorno en construcción. La cruz del puntero también se ve, porque está trabajando.
5. **Soltar:** otro anillo en el destino y el destino aparece con un **barrido diagonal rápido** (260 ms × ARMADO), con el puntero en el centro del frente. El contenido real (texto, números) aparece con ese barrido.
6. El fantasma se desvanece (opacidad −0,06 / RITMO y guías −0,07 / RITMO por frame).

La copia **espera a que el original esté terminado** (dependencia en la cola) y también respeta la ventana de 3 punteros y la regla del contenedor (§8).

### Devolver (`devolver`, al desarmar)
Es el gesto inverso y, como todo lo que se borra, **sin guías** (ni del fantasma ni la cruz del puntero).

1. El puntero va al centro de la copia y deja el anillo de agarre.
2. La copia se esconde con el barrido inverso (220 ms) y queda su fantasma.
3. El fantasma se arrastra de vuelta (`clamp(distancia × 1.2, 420, 900)` ms) hasta **fundirse con el original**. Anillo en el original y fade del fantasma.

### Desarmar una tanda (`desarmarTanda`)
Se usa en el cambio Ingresar ⇄ Registrarme, en la salida del login y en el cierre de sesión (barra lateral y bloques del tablero).

- Todas las copias vuelven a su original **en paralelo**.
- Cada original se borra recién **cuando volvieron todas sus copias**.
- Lo que no es gemelo se borra como siempre, de abajo hacia arriba.

## 8. Orden de armado (`enOrden`)

- Las piezas se ordenan **en orden de lectura**: de arriba a abajo y, dentro de la misma fila (tolerancia de 4 px), de izquierda a derecha.
- Hay **como máximo 3 punteros dibujando a la vez** (`EN_PARALELO = 3`). La pieza `i` arranca cuando termina la `i − 3`, así siempre arrancan en orden.
- Una pieza dentro de otra de la lista (los campos dentro de la tarjeta) espera a que su contenedor termine, porque hasta entonces el contenedor la tapa.
- Una cadena nueva puede continuar a otra que ya está en marcha (parámetro `previos`), por ejemplo un tablero que sigue a la barra lateral. Así nunca se pasa de 3 a la vez.
- Si la pieza es copia de un gemelo, además espera a que el original esté terminado, y `fn` recibe ese original como tercer argumento (`fn(c, n, origen)`).
- **Borrar es siempre en paralelo**, con todos los punteros disponibles (las copias primero, ver §7 bis).

## 9. Login

**Piezas marcadas en `index.html`:**

- Encabezado: `#ctxLoginWord` (texto), `#ctxLoginBadge` (recuadro) y la tarjeta `.login-card` (recuadro).
- Pestañas y `#authSubtitle`.
- Panel Ingresar: labels, inputs, `#btnLogin`, "Quiero crear mi cuenta" y "Olvidé mi contraseña".
- Panel Registrarme: labels, inputs (empresa, email, contraseña, campaña), el recuadro de términos y `#btnRegister`.
- El logo `#ctxLoginLogo` **no** lo dibujan los punteros: llega desde la intro.

### Armado inicial
Después del viaje del isotipo:

1. `stagger()`.
2. Se arman en orden la palabra, el badge, la tarjeta y todo lo visible dentro de la tarjeta (`enOrden`).
3. La tarjeta queda bloqueada (`.ctx-locked`, `pointer-events: none`) hasta terminar.

Al terminar, los punteros se agrupan abajo a la izquierda.

Si la URL pide registro (`#registro`), la pestaña Registrarme ya viene activa y se arma ese panel.

### Ingresar ⇄ Registrarme
`window.switchAuthMode` se envuelve.

1. Bloquea la tarjeta, oculta los mensajes, marca la pestaña nueva y deja un ripple sobre ella.
2. Desarma el subtítulo y lo visible del panel actual (`desarmarTanda`).
3. Llama al `switchAuthMode` original, que cambia de panel.
4. Oculta el subtítulo y el panel nuevo y los dibuja en orden.

Casos especiales:

- Si se pide otro cambio mientras se arma o se cambia, queda **pendiente** y se ejecuta al terminar.
- Si se pide durante un envío (por ejemplo, la cuenta se creó pero el ingreso automático falló y `app.js` vuelve a Ingresar), el cambio es **instantáneo**, sin animación.

### Enviar (`doLogin` / `doRegister`)
Se envuelven. La autenticación sigue siendo la original de `app.js`.

- Durante la intro, el armado, un cambio de modo, un envío o la salida, no se envía nada (tampoco con Enter).
- Si está listo: bloquea la tarjeta y deja un ripple en el botón. La pastilla ("Verificando credenciales…" o "Creando tu cuenta…") aparece recién a los 150 ms, así un error de validación inmediato no la muestra.
- **Si el ingreso falla, no se desarma nada.** Se oculta la pastilla, se desbloquea la tarjeta y el error queda a la vista como siempre.
- **Si funciona**, `app.js` llama `await ctxLoginAnim.salir()` antes de ocultar el login.

### Salida (`salir`)
1. Se desarman los hijos visibles de la tarjeta (`desarmarTanda`): las copias vuelven a su original y después se borra el resto.
2. Después se borra la tarjeta.
3. Después, el badge y la palabra.
4. Se oculta la pastilla y los punteros se agrupan en el centro (pausa de 1300 ms).
5. Fade del logo del encabezado y fade de los punteros (opacidad del contenedor). Pausa de 1200 ms.
6. Vuelve `salir()`, `app.js` oculta el login y carga la app. Por debajo se deja el login completo, por si vuelve a mostrarse (sesión vencida), y se pasa a esperar el panel.

## 10. Barra lateral (carga inicial del panel)

- `app.js` llama a `ctxLoginAnim.panel()` cuando muestra `#appShell`.
- Se espera ese aviso. Si no llega en 30 s, o si el login vuelve a verse, se muestra todo sin animación.
- **En celular** (barra oculta o fuera de pantalla: ancho o alto < 40 px, o borde derecho < 40 px) no se dibuja nada.

Pasos:

1. El loader (si seguía, en el caso de sesión ya iniciada) se desvanece. Los punteros vuelven a reposo abajo a la izquierda. Con sesión ya iniciada, entran desde afuera con `stagger()`. Si se viene del login, ya están en pantalla.
2. Se dibuja primero `#sidebar` (recuadro). Al terminar aparece el logo de la barra (`.brand-row > svg`) con un fade. Después se dibujan sus `[data-b]` visibles, en orden.
3. Si mientras tanto se abrió un tablero (KPIs al entrar), sus piezas se dibujan **a continuación**, con los mismos punteros (ver §11).
4. Al terminar: pausa de 500 ms, fade de los punteros, pausa de 1100 ms y `mostrarTodo()`.

## 11. Tableros

- Vistas animadas: `agricultura`, `kpis`, `ganaderia`, `tambo` y `mercado`.
- Solo la **primera vez que se abre cada una en la sesión** y solo en pantallas de **más de 900 px**.
- `switchDashboard` se envuelve. Antes de mostrar una vista nueva se pone `ctx-vista-oculta`, para que no se vea un instante antes de dibujarse.

**Antes de elegir las piezas:**

1. Si la vista es un iframe (Ganadería, Tambo), se espera a que cargue la URL correcta y tenga `.report-hero`, como máximo 8 s. Si no, se muestra sin animación.
2. Se espera a que la vista quede quieta: 250 ms sin mutaciones del DOM, como máximo 2,5 s.

**Piezas:** las que están visibles en pantalla al abrir (no se dibuja lo de más abajo).

- Página principal: `.hero`, los hijos del hero (menos `.kpis`), `.kpi-card` y `.kpi-chart-col` del hero, `.kpi-tab-bar`, `[class*="card"]`, `[class*="banner"]` y `.section-title`.
- Mercado, además: el primer bloque de `.page-body`, `#mercado-tab-bar` y las tarjetas de `#mercado-kpis-row`.
- Iframes: `.report-hero`, los hijos de `.report-headline`, `.report-actions`, `.save-row`, `.hero-notas`, `.esc-bar`, `.mt-barra` y `[class*="card"]`.
- Se excluye lo que está dentro de `.resbar` y, en los iframes, lo que ya tiene `data-b` (Tambo lo usa para otra cosa).
- Solo se dibujan las piezas **de más afuera**: lo de adentro aparece con su bloque. La excepción son los **contenedores** (`.hero`, `.report-hero`): se dibuja su franja y después cada pieza suya. Su trazo es siempre `#7dbaf8` (`data-c`).
- A cada pieza se le asigna `data-b`: `box` si tiene borde, fondo o imagen de fondo; si no, `text`.
- Los gráficos Chart.js de cada pieza se reinician (`reset`) al taparla y se animan (`update`) al terminar de dibujarla.

**Cuándo se dibujan:**

- Si la barra lateral todavía se está dibujando, la vista se suma a esa cadena.
- Si la barra está por arrancar (intro o esperando el panel), se espera hasta 8 s.
- Si la barra ya está terminando, se espera y se dibuja aparte: se reactivan los punteros, se dibuja, pausa de 400 ms, fade, pausa de 800 ms y `mostrarTodo()`.
- Si se cambia de tablero a mitad de un dibujo, se corta y se muestra todo.

## 12. Cerrar sesión (`desarmarPanel`)

`app.js` arranca `signOut()` y, en paralelo, espera `ctxLoginAnim.desarmarPanel()`. Después recarga la página.

- En celular (barra no visible) no se anima.
- Si la barra todavía se estaba armando, se corta: se detienen los punteros y solo se desarma lo ya dibujado (lo que tiene `clip-path: none`).

Pasos:

1. Se toman las piezas del tablero abierto (si es de más de 900 px y está a la vista) **antes** de reactivar.
2. Se reactivan los punteros: nueva generación, z-index sobre la barra y entrada desde afuera con `stagger()`.
3. Se desarman a la vez (`desarmarTanda`, las copias vuelven primero a su original):
   - las piezas de la barra;
   - los bloques del tablero, sin contar los contenedores.
4. Fade del logo de la barra (0,26 s).
5. Se borran el recuadro `#sidebar` y los contenedores del tablero (la franja del encabezado).
6. Los punteros se agrupan en el centro (pausa de 600 ms), se desvanecen (pausa de 600 ms) y `app.js` recarga.

## 13. API (`window.ctxLoginAnim`)

| Método | Quién lo llama | Para qué |
|---|---|---|
| `sesion('app' \| 'login')` | `index.html`, en el `load` | Resuelve la espera de la intro |
| `salir()` → Promise | `doLogin` y `doRegister` en `app.js`, solo en el camino de éxito | Desarma el login antes de entrar |
| `panel()` | `loadApp()` en `app.js`, al mostrar `#appShell` | Arranca el dibujo de la barra lateral |
| `desarmarPanel()` → Promise | `logout()` en `app.js` | Desarma la barra y el tablero antes de recargar |
| `activa()` | (consulta) | `true` mientras la animación está viva |

El módulo envuelve `switchAuthMode`, `doLogin`, `doRegister` y `switchDashboard` en `DOMContentLoaded`. Si faltan `switchAuthMode` o `doLogin`, se muestra todo sin animación.

## 14. Tabla de tiempos base

Todos los tiempos se multiplican por `RITMO` (0,4939). Los marcados con † se multiplican también por `ARMADO` (0,7).

| Acción | Duración base |
|---|---|
| Desplazamiento de un puntero | `clamp(distancia × 0.8, 220, 850)` ms († dentro de `build`) |
| Arrastre del contorno † | `clamp(diagonal × 1.5, 380, 1000)` ms |
| Relleno de un recuadro † | `clamp(ancho × 1.6, 420, 800)` ms |
| Revelado de un texto † | `clamp(ancho × 2.2, 260, 850)` ms |
| Borrado | `clamp(ancho × 1.2, 240, 650)` ms |
| Encogido del contorno | `clamp(diagonal × 1.1, 300, 800)` ms |
| Intro: punto → tamaño / pausa / separación / pausa / giro / blanca / viaje | 560 / 200 / 560 / 260 / 760 / 380 / 720 ms |
| Salida del login: agrupar en el centro / fade | 1300 / 1200 ms |
| Barra lateral: pausa final / fade | 500 / 1100 ms |
| Tablero suelto: pausa final / fade | 400 / 800 ms |
| Cerrar sesión: agrupar / fade | 600 / 600 ms |
| Copiar: pausa al agarrar / arrastre † / aparición del destino † | 140 / `clamp(distancia × 1.3, 480, 1000)` / 260 ms |
| Devolver: esconder la copia / arrastre de vuelta | 220 / `clamp(distancia × 1.2, 420, 900)` ms |
| Pastilla: demora antes de aparecer | 150 ms (sin ritmo) |

## 15. Verificación

- **Carga sin sesión:** el isotipo se arma desde un punto, se separa, giran los cuartos, aparece la pieza blanca y viaja al encabezado sin salto. Los punteros salen de a uno o de a dos desde arriba a la izquierda y dibujan en orden de lectura, con no más de 3 a la vez. Terminan agrupados abajo a la izquierda, casi invisibles.
- **Carga con sesión:** el login no aparece. El isotipo queda en el centro hasta que se dibuja la barra lateral, y KPIs a continuación.
- **Copias:** Registrarme sale copiada de Ingresar; Contraseña, de Email; en Registrarme, los tres campos siguientes, de Empresa; en la barra, cuatro ítems del menú y Cerrar sesión; en los tableros, las tarjetas iguales. Cada copia espera a su original, el fantasma lleva guías y al soltarlo coincide con el elemento real. Al desarmar, las copias vuelven sin guías antes de que se borre el original.
- **Cambio de modo:** alternar Ingresar y Registrarme varias veces seguidas no deja piezas a medio dibujar ni contornos colgados. Los cambios pedidos durante el armado se aplican al final.
- **Login fallido:** no desarma nada, muestra el error y la tarjeta queda usable.
- **Login correcto:** desarma, agrupa en el centro, desvanece y recién después entra al panel.
- **Registro con ingreso automático fallido:** vuelve a Ingresar al instante, con los datos cargados.
- **Tableros:** cada uno se dibuja solo la primera vez. Los gráficos se animan al terminar su pieza. En pantallas de 900 px o menos no se anima.
- **Cerrar sesión:** desarma la barra y el tablero abierto, de abajo hacia arriba, y la franja del encabezado al final. Funciona también a mitad de un armado.
- **Celular (unos 390 px):** el login se anima; la barra y los tableros no. No hay scroll horizontal.
- **`prefers-reduced-motion`:** no aparece ninguna animación.

## 16. Pendientes conocidos

- En el logo del encabezado del login, `qAzul` tiene `stroke="#7dbaf8" stroke-width="3"` para tapar una línea fina en la unión con la pieza blanca. En el SVG del loader (`#ctxWb`) falta ese trazo, así que durante la intro la línea puede verse.
- El prototipo para probar cambios (página con el login, la barra, KPIs de ejemplo y Mercado reales, y Supabase simulado) está publicado como artifact "Animación CTX"; no forma parte del repo.
