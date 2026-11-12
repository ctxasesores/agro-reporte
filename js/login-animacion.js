/* ============================================================
   Context — animación del login (punteros constructores)
   ------------------------------------------------------------
   Ocho puntos de luz ("punteros") arman la pantalla de login: cada
   uno toma un elemento de una cola compartida, traza su contorno y lo
   pinta con un barrido diagonal. Al cambiar entre Ingresar y
   Registrarme reescriben lo que cambia. Al ingresar con éxito desarman
   todo, se juntan en el centro y se desvanecen antes de entrar al panel.

   Antes, el isotipo se arma en el centro y hace de pantalla de carga
   mientras la app resuelve si ya hay sesión. Si la hay, el login no se
   dibuja: el isotipo se queda hasta que el panel está listo.

   Panel lateral: en la carga inicial del panel (después de ingresar, o
   al entrar con la sesión ya iniciada) los mismos punteros dibujan la
   barra lateral (#sidebar y sus [data-b]). app.js avisa con
   ctxLoginAnim.panel() cuando muestra el panel. Si no llega ese aviso,
   o el login vuelve a verse (sesión vencida, error), se muestra todo
   sin animación. En celular la barra está escondida: no se dibuja.

   Cerrar sesión: app.js llama a ctxLoginAnim.desarmarPanel() antes de
   recargar. Los punteros vuelven a entrar, desarman la barra lateral
   (al revés de como la armaron), se juntan en el centro y se van.

   Referencia: el prototipo aprobado (login-punteros-prototipo.html) y
   su documento de especificación. Valores y tiempos salen de ahí.

   QUÉ NO HACE:
   - No toca la autenticación. doLogin y doRegister siguen siendo los
     de app.js; acá solo se envuelven para bloquear la tarjeta y mostrar
     la pastilla mientras corren. En el camino de éxito, app.js llama a
     ctxLoginAnim.salir() y espera el desarmado antes de ocultar el login.
   - Si el login falla, no desarma nada: la tarjeta se desbloquea y el
     error se muestra como siempre.
   - Con prefers-reduced-motion no se crea nada (el <head> ni siquiera
     pone la clase ctx-anim) y el login se ve como antes.

   Elementos dibujables: los que tienen data-b="box" (recuadros) o
   data-b="text" (textos) en index.html. Los IDs no cambian.
   ============================================================ */
(function () {
  'use strict';

  const raiz = document.documentElement;
  // Sin la clase (movimiento reducido, o el <head> no la puso) no hay animación.
  if (!raiz.classList.contains('ctx-anim')) return;

  raiz.classList.add('ctx-panel');   // oculta la barra lateral hasta que se dibuja
  const $ = id => document.getElementById(id);
  const HIDDEN = 'inset(0 100% 0 0)';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* Ritmo de toda la animación: duraciones de la especificación × RITMO.
     0.49 = 0,7 × 0,7: dos veces un 30 % más rápida. Lo usan todos los
     tweens, las pausas de la coreografía, el escalonado de los punteros y
     los desvanecidos por frame, en el login y en la barra lateral (las
     transiciones CSS equivalentes están en css/login-animacion.css). */
  const RITMO = 0.49;
  const pausa = ms => sleep(ms * RITMO);
  const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const easeOutBack = p => 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rect = e => e.getBoundingClientRect();
  const visible = e => !!(e && e.offsetParent !== null);

  // Paths del isotipo (isotipo_sin_fondo.svg, viewBox 240.3).
  const ISO = {
    rosa:  'M240.3,60.08c0-33.18-26.9-60.08-60.08-60.08s-60.08,26.9-60.08,60.08h60.08v60.08c33.18,0,60.08-26.9,60.08-60.08Z',
    azul:  'M60.08,120.15C26.9,120.15,0,147.05,0,180.23s26.9,60.08,60.08,60.08,60.08-26.9,60.08-60.08h-60.08v-60.08Z',
    blanca:'M180.23,120.15v-60.08h-60.08c0,33.18-26.9,60.08-60.08,60.08v60.08h60.08c0-33.18,26.9-60.08,60.08-60.08Z',
    qRosa: 'M60.08,120.15c33.18,0,60.08-26.9,60.08-60.08h0s-60.08,0-60.08,0v60.08Z',
    qAzul: 'M120.15,180.23h60.08v-60.08c-33.18,0-60.08,26.9-60.08,60.08Z'
  };

  /* ---------- estado ----------
     intro → armando → listo ⇄ cambiando / enviando → saliendo → fin
     'fin' también es el estado después de abortar (hay sesión, error). */
  let estado = 'intro';
  let vivo = true;            // apaga loops de punteros y canvas
  let pendiente = null;       // cambio de modo pedido mientras se trabajaba
  let originales = {};        // switchAuthMode / doLogin / doRegister de app.js
  let resolverSesion;
  const sesion = new Promise(r => { resolverSesion = r; });

  /* ---------- capas ---------- */
  const cv = document.createElement('canvas'); cv.id = 'ctxFx'; cv.setAttribute('aria-hidden', 'true');
  const capaCur = document.createElement('div'); capaCur.id = 'ctxCursors'; capaCur.setAttribute('aria-hidden', 'true');
  const pill = document.createElement('div'); pill.id = 'ctxPill'; pill.setAttribute('aria-live', 'polite');
  pill.innerHTML = '<span id="ctxPillText">Verificando credenciales…</span><span class="ctx-bar"></span>';
  const loader = document.createElement('div'); loader.id = 'ctxLoader'; loader.setAttribute('role', 'status'); loader.setAttribute('aria-label', 'Cargando');
  loader.innerHTML =
    '<svg id="ctxLsvg" viewBox="0 0 240.3 240.3">' +
      '<path id="ctxLw" fill="#fcfcfc" opacity="0" d="' + ISO.blanca + '"/>' +
      '<g id="ctxGp"><path fill="#d56a9d" d="' + ISO.rosa + '"/><path id="ctxWp" fill="#d56a9d" d="' + ISO.qRosa + '"/></g>' +
      '<g id="ctxGb"><path fill="#7dbaf8" d="' + ISO.azul + '"/><path id="ctxWb" fill="#7dbaf8" d="' + ISO.qAzul + '"/></g>' +
    '</svg>';
  document.body.append(cv, capaCur, loader, pill);

  const ctx = cv.getContext('2d');
  let W = 0, H = 0;
  function resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  addEventListener('resize', resize); resize();

  /* ---------- canvas: contornos, guías y ripples ---------- */
  const outlines = [], ripples = [];
  // Contorno que crece como una selección, de arriba-izquierda a abajo-derecha,
  // con las guías de sus 4 vértices hasta el borde de la página.
  function drawOutline(o) {
    if (o.t <= 0) return;
    const r = rect(o.el), x0 = r.left, y0 = r.top, x1 = x0 + r.width * o.t, y1 = y0 + r.height * o.t;
    ctx.globalAlpha = Math.max(0, o.a); ctx.strokeStyle = o.color; ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = Math.max(0, o.ga) * 0.85; ctx.lineWidth = 2;
    ctx.beginPath();
    [[0, y0, x0, y0], [x0, 0, x0, y0],
     [x1, y0, W, y0], [x1, 0, x1, y0],
     [x1, y1, W, y1], [x1, y1, x1, H],
     [0, y1, x0, y1], [x0, y1, x0, H]].forEach(([a, b, c, d]) => { ctx.moveTo(a, b); ctx.lineTo(c, d); });
    ctx.stroke();
  }
  function frame() {
    if (!vivo) { ctx.clearRect(0, 0, W, H); return; }
    ctx.clearRect(0, 0, W, H);
    for (let i = outlines.length - 1; i >= 0; i--) {
      const o = outlines[i]; if (o.fading) { o.a -= 0.03 / RITMO; o.ga -= 0.045 / RITMO; }
      if (o.a <= 0 && o.ga <= 0) { outlines.splice(i, 1); continue; }
      drawOutline(o);
    }
    ctx.lineWidth = 0.5;   // guías de los punteros: medio pixel
    for (const c of cursors) {
      // La cruz del puntero se ve solo mientras dibuja; al borrar no lleva guías.
      c.ga = clamp((c.ga || 0) + (c.busy && !c.borrando ? 0.12 : -0.06) / RITMO, 0, 1);
      if (c.ga <= 0) continue;
      ctx.globalAlpha = c.ga * 0.7; ctx.strokeStyle = c.color;
      ctx.beginPath(); ctx.moveTo(0, c.y); ctx.lineTo(W, c.y); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, H); ctx.stroke();
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.r += 1.4 / RITMO; r.a -= 0.04 / RITMO;
      if (r.a <= 0) { ripples.splice(i, 1); continue; }
      ctx.globalAlpha = r.a; ctx.strokeStyle = r.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  function tween(dur, fn, stop) {
    return new Promise(res => {
      const t0 = performance.now(), d = dur * RITMO;
      const f = now => {
        if (!vivo || (stop && stop())) return res(false);
        const p = Math.min(1, (now - t0) / d); fn(p);
        p < 1 ? requestAnimationFrame(f) : res(true);
      };
      requestAnimationFrame(f);
    });
  }

  /* ---------- cola de tareas compartida ---------- */
  let jobs = [];
  function job(fn, deps = []) { const j = { fn, deps, state: 'pending' }; jobs.push(j); return j; }
  const ready = () => jobs.find(j => j.state === 'pending' && j.deps.every(d => d.state === 'done'));
  const allDone = list => new Promise(res => {
    const f = () => (!vivo || list.every(j => j.state === 'done')) ? (jobs = jobs.filter(j => j.state !== 'done'), res()) : setTimeout(f, 50);
    f();
  });

  /* ---------- punteros ---------- */
  const COLORS = ['#d56a9d', '#7dbaf8', '#fcfcfc', '#e3bb4d', '#d56a9d', '#7dbaf8', '#fcfcfc', '#e3bb4d'];
  let gather = 'park';
  class Cursor {
    constructor(color, i) {
      this.color = color; this.i = i; this.wakeAt = Infinity;
      this.node = document.createElement('div'); this.node.className = 'ctx-cur';
      this.node.style.background = color; this.node.style.boxShadow = `0 0 8px 1px ${color}aa`;
      capaCur.appendChild(this.node);
      const o = this.offscreen(); this.set(o.x, o.y);
    }
    offscreen() { return { x: -22 - this.i * 5, y: -26 - this.i * 4 }; }
    set(x, y) { this.x = x; this.y = y; this.node.style.transform = `translate(${x}px,${y}px)`; }
    go(target, stop) {
      const sx = this.x, sy = this.y, t = target();
      const dur = clamp(Math.hypot(t.x - sx, t.y - sy) * 0.8, 220, 850);
      return tween(dur, p => { const tt = target(), e = ease(p); this.set(sx + (tt.x - sx) * e, sy + (tt.y - sy) * e); }, stop);
    }
    home() {
      const t = performance.now() * 0.0007 + this.i, col = this.i % 4, row = this.i >> 2;
      if (gather === 'center') return { x: W / 2 - 30 + col * 16 + Math.sin(t) * 4, y: H / 2 - 14 + row * 18 + Math.cos(t) * 4 };
      return { x: 26 + col * 20 + Math.sin(t) * 4, y: H - 70 + row * 22 + Math.cos(t * 1.2) * 4 };
    }
    async run() {
      while (vivo) {
        const now = performance.now();
        if (now < this.wakeAt) { await sleep(Math.min(this.wakeAt - now, 100)); continue; }
        const j = ready();
        if (j) {
          j.state = 'running'; this.busy = true; this.node.classList.add('busy');
          try { await j.fn(this); } catch (e) { console.warn('[login-animacion]', e); }
          j.state = 'done'; this.busy = false; this.node.classList.remove('busy');
          continue;
        }
        const h = this.home();
        await this.go(() => h, () => !!ready() || performance.now() < this.wakeAt);
        if (!ready()) await pausa(120 + Math.random() * 260);
      }
    }
  }
  let cursors = [];
  // Arranque escalonado e irregular: algunos salen casi juntos, otros se demoran.
  function stagger() {
    const order = cursors.map((_, i) => i).sort(() => Math.random() - 0.5);
    let d = 0; const now = performance.now();
    order.forEach(i => { cursors[i].wakeAt = now + d; d += (Math.random() < 0.3 ? 40 + Math.random() * 90 : 200 + Math.random() * 750) * RITMO; });
  }

  /* ---------- color final de cada elemento ----------
     Borde visible → color del borde (salvo el botón primario: su fondo dorado).
     Sin borde → fondo. Sin fondo → color del texto. La transparencia del
     estilo de la app se ignora: el trazo usa el tono pleno para que se vea. */
  const partes = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; return m[1].split(',').map(s => parseFloat(s)); };
  const alphaOf = c => { const v = partes(c); return !v ? 1 : (v.length > 3 ? v[3] : 1); };
  const pleno = c => { const v = partes(c); return v ? `rgb(${v[0]},${v[1]},${v[2]})` : c; };
  function finalColor(e) {
    if (e.dataset.c) return e.dataset.c;   // color de trazo fijado en el HTML
    const cs = getComputedStyle(e);
    if (e.classList.contains('btn-primary') && alphaOf(cs.backgroundColor) > 0.5) return pleno(cs.backgroundColor);
    if (parseFloat(cs.borderTopWidth) > 0 && alphaOf(cs.borderTopColor) > 0.05) return pleno(cs.borderTopColor);
    if (alphaOf(cs.backgroundColor) > 0.05) return pleno(cs.backgroundColor);
    return pleno(cs.color);
  }

  /* ---------- dibujar y borrar ---------- */
  // Barrido diagonal: se revela la región x/w + y/h <= s (s de 0 a 2).
  function diag(s) {
    const pct = v => (v * 100).toFixed(2) + '%';
    if (s <= 0) return 'polygon(0 0, 0 0, 0 0)';
    if (s <= 1) return `polygon(-4px -4px, ${pct(s)} -4px, -4px ${pct(s)})`;
    const k = s - 1;
    return `polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 4px) ${pct(k)}, ${pct(k)} calc(100% + 4px), -4px calc(100% + 4px))`;
  }
  function front(rr, s, q) {
    const w = rr.width, h = rr.height; let A, B;
    if (s <= 1) { A = [s * w, 0]; B = [0, s * h]; } else { const k = s - 1; A = [w, k * h]; B = [k * w, h]; }
    return [rr.left + A[0] + (B[0] - A[0]) * q, rr.top + A[1] + (B[1] - A[1]) * q];
  }
  const kindOf = e => e.getAttribute('data-b') === 'box' ? 'box' : 'text';

  async function build(c, e) {
    const kind = kindOf(e), r = () => rect(e);
    await c.go(() => ({ x: r().left, y: r().top }));
    let o = null;
    if (kind === 'box') {
      o = { el: e, t: 0, a: 1, ga: 1, color: finalColor(e) }; outlines.push(o);
      const rr = r();
      await tween(clamp(Math.hypot(rr.width, rr.height) * 1.5, 380, 1000), p => {
        o.t = ease(p); const q = r(); c.set(q.left + q.width * o.t, q.top + q.height * o.t);
      });
      await c.go(() => ({ x: r().left, y: r().top }));
    }
    const w = r().width;
    await tween(kind === 'box' ? clamp(w * 1.6, 420, 800) : clamp(w * 2.2, 260, 850), p => {
      const sv = p * 2;
      e.style.clipPath = diag(sv);
      c.set(...front(r(), sv, kind === 'box' ? 0.5 + 0.45 * Math.sin(p * Math.PI * 9) : 0.5));
    });
    e.style.clipPath = 'none';
    if (o) o.fading = true;
  }
  // Borrar no muestra guías (ni la cruz del puntero ni las de construcción
  // del recuadro): solo el barrido inverso y el contorno que se encoge.
  async function erase(c, e) {
    c.borrando = true;
    try { await eraseSinGuias(c, e); } finally { c.borrando = false; }
  }
  async function eraseSinGuias(c, e) {
    const kind = kindOf(e), r = () => rect(e);
    await c.go(() => ({ x: r().right, y: r().bottom }));
    await tween(clamp(r().width * 1.2, 240, 650), p => {
      const sv = 2 - p * 2;
      e.style.clipPath = diag(sv);
      c.set(...front(r(), sv, kind === 'box' ? 0.5 + 0.45 * Math.sin(p * Math.PI * 7) : 0.5));
    });
    e.style.clipPath = HIDDEN;
    if (kind === 'box') {
      const o = { el: e, t: 1, a: 1, ga: 0, color: finalColor(e) }; outlines.push(o);
      await c.go(() => ({ x: r().right, y: r().bottom }));
      const rr = r();
      await tween(clamp(Math.hypot(rr.width, rr.height) * 1.1, 300, 800), p => {
        o.t = 1 - ease(p); const q = r(); c.set(q.left + q.width * o.t, q.top + q.height * o.t);
      });
      o.fading = true;
    }
  }

  /* ---------- elementos de la pantalla ---------- */
  const el = {
    screen: $('loginScreen'), logo: $('ctxLoginLogo'), word: $('ctxLoginWord'), badge: $('ctxLoginBadge'),
    card: document.querySelector('#loginScreen .login-card')
  };
  // Lo dibujable dentro de la tarjeta que hoy se ve (pestañas, subtítulo y el pane activo), en orden.
  const hijosVisibles = () => [...el.card.querySelectorAll('[data-b]')].filter(visible);
  const dePane = pane => [...pane.querySelectorAll('[data-b]')];
  const paneActivo = () => el.card.querySelector('.auth-pane.active');
  const centro = e => { const r = rect(e); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const lock = v => el.card && el.card.classList.toggle('ctx-locked', v);
  const ripple = e => { if (e) ripples.push({ ...centro(e), r: 4, a: 1, color: '#e3bb4d' }); };

  // Deja el login completo y quieto (por si vuelve a mostrarse), sin apagar
  // los punteros: todavía pueden dibujar el panel.
  function revelarLogin() {
    document.querySelectorAll('#loginScreen [data-b]').forEach(n => { n.style.clipPath = 'none'; });
    if (el.logo) { el.logo.style.transition = 'none'; el.logo.classList.add('in'); }
    raiz.classList.remove('ctx-anim');
    lock(false);
    pill.classList.remove('on');
  }
  function revelarPanel() {
    raiz.classList.remove('ctx-panel');
    document.querySelectorAll('#sidebar, #sidebar [data-b]').forEach(n => { n.style.clipPath = ''; });
  }
  let tLimpieza = null;
  // Muestra todo de inmediato y apaga la animación (error, fin).
  function mostrarTodo() {
    vivo = false; estado = 'fin';
    revelarLogin();
    revelarPanel();
    loader.classList.add('fuera');
    capaCur.classList.add('gone');
    tLimpieza = setTimeout(() => { cv.remove(); capaCur.remove(); loader.remove(); pill.remove(); }, 450);
  }

  /* ---------- intro del isotipo (hace de pantalla de carga) ---------- */
  async function intro() {
    const sv = $('ctxLsvg'), gp = $('ctxGp'), gb = $('ctxGb'), wp = $('ctxWp'), wb = $('ctxWb'), lw = $('ctxLw');
    /* Los dos cuartos de círculo forman un cuadrado: va del centro del círculo
       azul (60, 180) al del rosa (180, 60), con centro en (120.15, 120.15), que
       es el centro del logo. Con el cuadrado girado +90°, cada cuarto queda
       dentro de su círculo (los círculos se ven completos). El cuadrado entero
       gira de 90° a 0° hacia la izquierda, y así los dos cuartos viajan juntos
       a su lugar: el rosa arriba a la izquierda y el azul abajo a la derecha. */
    const C = 120.15;
    const place = (k, a) => {
      gp.setAttribute('transform', `translate(${-40 * k} ${40 * k})`);
      gb.setAttribute('transform', `translate(${40 * k} ${-40 * k})`);
      wp.setAttribute('transform', `rotate(${a} ${C} ${C})`);
      wb.setAttribute('transform', `rotate(${a} ${C} ${C})`);
    };
    place(1, 90);
    sv.style.transformOrigin = '50% 50%';
    await tween(480, p => { sv.style.opacity = Math.min(1, p * 1.6); sv.style.transform = `scale(${0.55 + 0.45 * easeOutBack(p)})`; });
    await tween(560, p => place(1 - ease(p), 90));
    await pausa(260);
    await tween(760, p => place(0, 90 * (1 - ease(p))));
    await tween(380, p => lw.setAttribute('opacity', p));
    // Hace de pantalla de carga: espera las fuentes (para medir anchos finales)
    // y a que la app resuelva si ya hay sesión.
    const fuentes = document.fonts ? Promise.race([document.fonts.ready, sleep(1200)]) : null;
    const quien = await Promise.race([Promise.all([sleep(300), fuentes, sesion]).then(r => r[2]), sleep(15000).then(() => 'login')]);
    return quien;
  }
  async function viajarAlEncabezado() {
    const sv = $('ctxLsvg');
    sv.style.transformOrigin = '0 0'; sv.style.transform = '';
    const a = rect(sv), b = rect(el.logo), dx = b.left - a.left, dy = b.top - a.top, sc = b.width / a.width;
    await tween(720, p => { const e = ease(p); sv.style.transform = `translate(${dx * e}px,${dy * e}px) scale(${1 + (sc - 1) * e})`; });
    el.logo.style.transition = 'none'; el.logo.classList.add('in'); void el.logo.offsetWidth; el.logo.style.transition = '';
    loader.remove();
  }

  /* ---------- armado inicial ---------- */
  async function armar() {
    estado = 'armando'; lock(true);
    const top = [job(c => build(c, el.word)), job(c => build(c, el.badge))];
    const jc = job(c => build(c, el.card));
    const kids = hijosVisibles().map(n => job(c => build(c, n), [jc]));
    await allDone([...top, jc, ...kids]);
    if (!vivo) return;
    estado = 'listo'; lock(false);
    procesarPendiente();
  }

  /* ---------- Ingresar ⇄ Registrarme ---------- */
  function marcarPestanas(modo) {
    const reg = modo === 'register';
    $('tab-login')?.classList.toggle('active', !reg);
    $('tab-register')?.classList.toggle('active', reg);
  }
  async function cambiarModo(modo) {
    const actual = (typeof currentAuthMode !== 'undefined') ? currentAuthMode : 'login';
    if (modo === actual) return originales.switchAuthMode(modo);
    estado = 'cambiando'; lock(true);
    if (typeof hideAuthMessages === 'function') hideAuthMessages();
    marcarPestanas(modo);
    ripple(modo === 'register' ? $('tab-register') : $('tab-login'));
    // Se borra el subtítulo y lo que se ve del pane actual; recién después se
    // cambia de pane (lo hace el switchAuthMode original) y se dibuja el nuevo.
    const sub = $('authSubtitle');
    const salen = [sub, ...dePane(paneActivo()).filter(visible)].map(n => job(c => erase(c, n)));
    await allDone(salen);
    if (!vivo) return;
    originales.switchAuthMode(modo);
    const nuevos = [sub, ...dePane(paneActivo())];
    nuevos.forEach(n => { n.style.clipPath = HIDDEN; });
    await allDone(nuevos.filter(visible).map(n => job(c => build(c, n))));
    if (!vivo) return;
    estado = 'listo'; lock(false);
    procesarPendiente();
  }
  function procesarPendiente() {
    if (pendiente == null || estado !== 'listo') return;
    const m = pendiente; pendiente = null; cambiarModo(m);
  }
  // Cambio sin animación (por ejemplo, el alta creó la cuenta pero el ingreso
  // automático falló y app.js vuelve a «Ingresar» con los datos cargados).
  function cambiarAlInstante(modo) {
    originales.switchAuthMode(modo);
    el.card.querySelectorAll('[data-b]').forEach(n => { n.style.clipPath = 'none'; });
  }

  /* ---------- enviar (Ingresar / Crear cuenta) ---------- */
  function envolverEnvio(nombre, textoPill) {
    const original = originales[nombre];
    return async function () {
      // Durante el armado o un cambio de modo la tarjeta está bloqueada
      // (también para Enter): no se envía nada a medio dibujar.
      if (estado === 'intro' || estado === 'armando' || estado === 'cambiando' || estado === 'enviando' || estado === 'saliendo') return;
      if (estado !== 'listo') return original.apply(this, arguments);
      estado = 'enviando'; lock(true);
      ripple(nombre === 'doLogin' ? $('btnLogin') : $('btnRegister'));
      $('ctxPillText').textContent = textoPill;
      // La pastilla espera un instante: un error de validación (campo vacío)
      // vuelve enseguida y no tiene sentido mostrarla.
      const tPill = setTimeout(() => pill.classList.add('on'), 150);
      try {
        return await original.apply(this, arguments);
      } finally {
        clearTimeout(tPill);
        // Si salir() no se llamó, el ingreso no prosperó: se desbloquea y el
        // error queda a la vista como siempre. Nada se desarma.
        if (estado === 'enviando') {
          pill.classList.remove('on');
          estado = 'listo'; lock(false);
          procesarPendiente();
        }
      }
    };
  }

  /* ---------- salida: desarmar y recién después entrar al panel ---------- */
  async function salir() {
    if (!vivo || estado === 'fin') return;
    estado = 'saliendo'; lock(true);
    const kids = hijosVisibles().reverse().map(n => job(c => erase(c, n)));
    const jc = job(c => erase(c, el.card), kids);
    const top = [el.badge, el.word].map(n => job(c => erase(c, n), [jc]));
    await allDone([...kids, jc, ...top]);
    pill.classList.remove('on');
    gather = 'center';
    await pausa(1300);
    el.logo.classList.remove('in');
    capaCur.classList.add('gone');
    await pausa(1200);
    // app.js oculta el login apenas esto termina. Se deja todo visible por
    // debajo: si el login vuelve a mostrarse (sesión vencida), se ve completo.
    setTimeout(() => { revelarLogin(); esperarPanel(true); }, 0);
  }

  /* ---------- panel lateral (carga inicial) ---------- */
  let panelAvisado = false;
  // Espera el aviso de app.js. Si el login vuelve a verse o el aviso no llega,
  // se muestra todo sin animación.
  async function esperarPanel(desdeLogin) {
    estado = 'panel';
    const t0 = performance.now();
    const ok = await new Promise(res => {
      const f = () => {
        if (!vivo) return res(false);
        if (panelAvisado) return res(true);
        if (visible(el.screen) || performance.now() - t0 > 30000) return res(false);
        setTimeout(f, 120);
      };
      f();
    });
    if (!ok) { mostrarTodo(); return; }
    await armarPanel(desdeLogin);
  }
  async function armarPanel(desdeLogin) {
    const sb = $('sidebar');
    const r = sb && rect(sb);
    // En celular la barra está fuera de pantalla (o el panel no se ve): nada que dibujar.
    // (La barra es position:fixed: offsetParent no sirve, se mira el tamaño en pantalla.)
    if (!sb || getComputedStyle(sb).display === 'none' || r.right < 40 || r.width < 40 || r.height < 40) { mostrarTodo(); return; }
    loader.classList.add('fuera');
    setTimeout(() => loader.remove(), 450);
    gather = 'park';
    capaCur.classList.remove('gone');
    if (!desdeLogin) stagger();   // con sesión ya iniciada entran desde afuera de la pantalla
    const logo = sb.querySelector('.brand-row > svg');
    const piezas = [...sb.querySelectorAll('[data-b]')].filter(n => visible(n) && rect(n).width > 2);
    const jc = job(c => build(c, sb));
    const kids = piezas.map(n => job(c => build(c, n), [jc]));
    await allDone([jc]);
    if (logo) logo.classList.add('ctx-in');
    await allDone(kids);
    if (!vivo) return;
    await pausa(500);
    capaCur.classList.add('gone');
    await pausa(1100);
    mostrarTodo();
  }

  /* ---------- cerrar sesión: desarmar la barra lateral ---------- */
  // Vuelve a poner las capas y los punteros (al terminar el armado se quitan).
  function reactivar() {
    clearTimeout(tLimpieza);
    vivo = true; estado = 'desarmando';
    outlines.length = 0; ripples.length = 0; jobs = [];
    capaCur.innerHTML = ''; capaCur.classList.remove('gone');
    // Por encima de la barra lateral (z-index 200).
    cv.style.zIndex = '201'; capaCur.style.zIndex = '202';
    document.body.append(cv, capaCur);
    resize();
    gather = 'park';
    cursors = COLORS.map((col, i) => new Cursor(col, i));
    requestAnimationFrame(frame);
    cursors.forEach(c => c.run());
    stagger();
  }
  let desarmando = false;
  async function desarmarPanel() {
    // Si todavía se está armando, o ya se está desarmando, no se hace nada.
    if (vivo || desarmando) return;
    const sb = $('sidebar');
    const r = sb && rect(sb);
    if (!sb || getComputedStyle(sb).display === 'none' || r.right < 40 || r.width < 40 || r.height < 40) return;
    desarmando = true;
    try {
      reactivar();
      const logo = sb.querySelector('.brand-row > svg');
      const piezas = [...sb.querySelectorAll('[data-b]')].filter(n => visible(n) && rect(n).width > 2).reverse();
      const kids = piezas.map(n => job(c => erase(c, n)));
      const jc = job(c => erase(c, sb), kids);
      await allDone(kids);
      if (logo) { logo.style.transition = 'opacity .32s ease'; logo.style.opacity = '0'; }
      await allDone([jc]);
      gather = 'center';
      await pausa(600);
      capaCur.classList.add('gone');
      await pausa(600);
    } catch (e) {
      console.warn('[login-animacion] cierre sin animación:', e);
    }
  }

  /* ---------- API para app.js e index.html ---------- */
  window.ctxLoginAnim = {
    // index.html avisa cómo se resolvió la sesión: 'app' (ya había sesión,
    // no se dibuja nada) o 'login' (hay que mostrar el login).
    sesion(quien) { resolverSesion(quien === 'app' ? 'app' : 'login'); },
    salir,
    // app.js avisa que mostró el panel: se dibuja la barra lateral.
    panel() { panelAvisado = true; },
    // app.js la espera antes de recargar al cerrar sesión.
    desarmarPanel,
    activa: () => vivo
  };

  /* ---------- arranque ---------- */
  async function arrancar() {
    try {
      cursors = COLORS.map((col, i) => new Cursor(col, i));
      requestAnimationFrame(frame);
      cursors.forEach(c => c.run());
      const quien = await intro();
      if (quien === 'app') { revelarLogin(); await esperarPanel(false); return; }
      if (!visible(el.screen)) { mostrarTodo(); return; }
      await viajarAlEncabezado();
      if (!vivo) return;
      stagger();
      await armar();
    } catch (e) {
      console.warn('[login-animacion] se muestra el login sin animación:', e);
      mostrarTodo();
    }
  }

  // Las funciones de app.js existen recién cuando terminaron de cargar los scripts.
  document.addEventListener('DOMContentLoaded', () => {
    originales = { switchAuthMode: window.switchAuthMode, doLogin: window.doLogin, doRegister: window.doRegister };
    if (typeof originales.switchAuthMode !== 'function' || typeof originales.doLogin !== 'function') { mostrarTodo(); return; }
    window.switchAuthMode = function (modo) {
      const m = modo === 'register' ? 'register' : 'login';
      if (!vivo || estado === 'intro' || estado === 'fin' || estado === 'saliendo' || estado === 'panel') return originales.switchAuthMode(m);
      if (estado === 'enviando') return cambiarAlInstante(m);
      if (estado === 'armando' || estado === 'cambiando') { pendiente = m; marcarPestanas(m); return; }
      cambiarModo(m);
    };
    window.doLogin = envolverEnvio('doLogin', 'Verificando credenciales…');
    if (typeof originales.doRegister === 'function') window.doRegister = envolverEnvio('doRegister', 'Creando tu cuenta…');
  });

  arrancar();
})();
