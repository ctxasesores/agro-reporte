const SUPA_URL = 'https://xilkjtmaruqqodnhwkbp.supabase.co';
const SUPA_KEY = 'sb_publishable_uVUvbAkUy1zgniP0AbhTRQ_0Ku0AuOj';
const APP_URL = 'https://ctxasesores.github.io/agro-reporte/';
const FUNCTIONS_URL = `${SUPA_URL}/functions/v1`;
const TERMS_VERSION = '2026-05-29-v1';
const COLORES_PROD = {'Soja':'#5b9ec9','Maiz':'#3d7aa8','Trigo':'#8bbedd','Girasol':'#2a5f84','Sorgo':'#1e4466','Cebada':'#a8cfe8'};
const PRODUCTOS = ['Soja','Maiz','Trigo','Girasol','Sorgo','Cebada'];

let sb = null;
let currentUser = null;
let currentCliente = null;
let allOps = [];
let precios = {};  // key: "Producto_mes_año" o "Producto_CONT"
// Posiciones de cosecha por campaña para valuar Planes de Siembra.
// Estructura: { "26/27": { "Soja": {mes:5,anio:2027}, ... }, ... }
// Si una campaña no está acá (o el producto no está), el Plan de Siembra se
// valúa por SPOT — comportamiento histórico, protege las campañas viejas.
let posicionesCosecha = {};
let pieChart = null;
let activeSection = 'resumen';
let filterProd = 'todos';
let opsSort = { field:'fecha', dir:'desc' };
let opsGuardadasSort = { field:'fecha', dir:'desc' };
let kpiCampaignFilter = 'todas';
let tagsDisponibles = [];   // ['DFL','AGR',...] — tags del cliente
let activeTagFilter = [];   // tags seleccionados para filtrar (intersección Y)
let currentAuthMode = 'login';
let authListenerReady = false;
let passwordRecoveryMode = false;
// v20260925: access_token de la sesión para Edge Functions que actúan en nombre
// del usuario (agente-agro). Se mantiene al día con onAuthStateChange.
let _ctxAccessToken = '';
let campaignTabs = [];
let activeCampaign = '';
const AGRI_PRO_ONLY_TYPES = ['PAF','FIX','Call','Put'];

// ── INIT ──
function initSupabase() {
  if (!sb) sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  if (!authListenerReady) {
    sb.auth.onAuthStateChange((event, session) => {
      _ctxAccessToken = (event === 'SIGNED_OUT') ? '' : (session?.access_token || _ctxAccessToken);
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryMode = true;
        closeForgotPasswordModal();
        openResetPasswordModal();
      }
    });
    authListenerReady = true;
  }
}

// Headers para agente-agro: mandan el token del usuario, no la clave pública.
// El servidor deriva cliente, código y nivel PRO desde ese token.
async function ctxAuthHeaders() {
  try {
    initSupabase();
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) _ctxAccessToken = data.session.access_token;
  } catch (e) { /* sin sesión: el servidor responde 401 y la UI lo muestra */ }
  return ctxAuthHeadersSync();
}
// ── KPIs · pestañas y tablero financiero (kpi-financiero.js) ──
let kpiTabActiva = 'financiero';
function setKpiTab(tab) {
  kpiTabActiva = tab;
  document.querySelectorAll('#view-kpis .kpi-tab').forEach(b => {
    const on = b.dataset.kpiTab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#view-kpis .kpi-pane').forEach(p => p.classList.toggle('active', p.id === `kpi-pane-${tab}`));
  if (tab === 'financiero') ctxFinMontar();
  if (tab === 'unidades') renderBusinessUnits(true);
}
function ctxFinMontar(forzar) {
  const root = document.getElementById('fin-root');
  if (!root || !currentCliente?.id) return Promise.resolve();
  if (!window.CtxFin) {
    root.innerHTML = '<div class="card" style="padding:18px;font-size:13px;color:var(--gris)">No se pudo cargar el tablero financiero. Tocá Actualizar o recargá la página.</div>';
    return Promise.resolve();
  }
  initSupabase();
  return window.CtxFin.montar(root, {
    sb, clienteId: currentCliente.id, clienteNombre: currentCliente.nombre_empresa || '',
    tema: 'oscuro', puedeEditar: true, forzar: !!forzar
  });
}

// Versión sincrónica (para cierres de página, donde no se puede esperar).
function ctxAuthHeadersSync() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + (_ctxAccessToken || SUPA_KEY)
  };
}

document.addEventListener('keydown', e => {
  const proOpen = document.getElementById('proPanelsOverlay')?.classList.contains('open');
  const docsOpen = document.getElementById('documentationOverlay')?.classList.contains('open');
  const termsOpen = document.getElementById('termsOverlay')?.classList.contains('open');
  if (e.key === 'Escape') {
    closeProPanelsModal();
    closeDocumentationModal();
    closeTermsModal();
    closeForgotPasswordModal();
    closeResetPasswordModal();
    return;
  }
  if (proOpen || docsOpen || termsOpen) return;
  if (e.key !== 'Enter') return;
  if (document.getElementById('resetPasswordOverlay')?.classList.contains('open')) {
    saveNewPassword();
    return;
  }
  if (document.getElementById('forgotPasswordOverlay')?.classList.contains('open')) {
    sendPasswordReset();
    return;
  }
  if (currentAuthMode === 'register') doRegister();
  else doLogin();
});

function switchAuthMode(mode) {
  currentAuthMode = mode === 'register' ? 'register' : 'login';
  const isRegister = currentAuthMode === 'register';
  document.getElementById('tab-login')?.classList.toggle('active', !isRegister);
  document.getElementById('tab-register')?.classList.toggle('active', isRegister);
  document.getElementById('pane-login')?.classList.toggle('active', !isRegister);
  document.getElementById('pane-register')?.classList.toggle('active', isRegister);
  const subtitle = document.getElementById('authSubtitle');
  if (subtitle) {
    subtitle.textContent = isRegister
      ? 'Creá tu cuenta para que podamos habilitarte el panel agrícola, ganadería estándar y futuras versiones premium.'
      : 'Ingresá a tu panel agrícola y a los módulos ganaderos habilitados para tu cuenta.';
  }
  hideAuthMessages();
}

function hideAuthMessages() {
  const errEl = document.getElementById('loginError');
  const okEl  = document.getElementById('loginSuccess');
  if (errEl) errEl.style.display = 'none';
  if (okEl) okEl.style.display = 'none';
}

function slugCodigo(nombre = '') {
  return (nombre || 'CLIENTE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14) || 'CLIENTE';
}

async function doLogin() {
  hideAuthMessages();
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value.trim();
  const btn   = document.getElementById('btnLogin');
  const errEl = document.getElementById('loginError');
  if (!email || !pass) { errEl.textContent='Completá email y contraseña.'; errEl.style.display='block'; return; }
  btn.disabled=true; btn.textContent='Ingresando...';
  initSupabase();
  const {data,error} = await sb.auth.signInWithPassword({email, password:pass});
  btn.disabled=false; btn.textContent='Ingresar';
  if (error) { errEl.textContent='Email o contraseña incorrectos.'; errEl.style.display='block'; return; }
  errEl.style.display='none';
  currentUser = data.user;
  // Animación del login (js/login-animacion.js): desarma la pantalla antes de entrar.
  if (window.ctxLoginAnim) await window.ctxLoginAnim.salir();
  showLoading(true);
  document.getElementById('loginScreen').style.display='none';
  await loadApp();
}

async function doRegister() {
  hideAuthMessages();
  initSupabase();
  const nombre    = document.getElementById('regNombre').value.trim();
  const email     = document.getElementById('regEmail').value.trim();
  const pass      = document.getElementById('regPass').value.trim();
  const campania  = document.getElementById('regCampania').value.trim();
  const acceptedTerms = document.getElementById('regTermsAccepted')?.checked;
  const actividad = 'Agricultura, Ganader\u00eda y Tambo';
  const btn       = document.getElementById('btnRegister');
  const errEl     = document.getElementById('loginError');
  const okEl      = document.getElementById('loginSuccess');
  if (!nombre || !email || !pass) {
    errEl.textContent = 'Complet\u00e1 empresa, email y contrase\u00f1a.';
    errEl.style.display = 'block';
    return;
  }
  if (pass.length < 8) {
    errEl.textContent = 'La contrase\u00f1a debe tener al menos 8 caracteres.';
    errEl.style.display = 'block';
    return;
  }
  if (!acceptedTerms) {
    errEl.textContent = 'Para crear la cuenta ten\u00e9s que aceptar los T\u00e9rminos y Condiciones.';
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Creando cuenta...';
  const codigo = slugCodigo(nombre);
  try {
    // Alta at\u00f3mica v\u00eda Edge Function crear-usuario (Auth + perfil con rollback).
    // El signup directo de Supabase Auth est\u00e1 deshabilitado a prop\u00f3sito:
    // registrar por ac\u00e1 garantiza que la cuenta quede con su perfil comercial.
    const resp = await fetch(SUPA_URL + '/functions/v1/crear-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY
      },
      body: JSON.stringify({
        email,
        password: pass,
        codigo,
        nombre_empresa: nombre,
        campania,
        actividad,
        acceso_agricola: true,  panel_agricola: true,
        acceso_ganaderia: true, panel_ganaderia: true,
        acceso_tambo: true,     panel_tambo: true,
        terminos_aceptados: true,
        terminos_aceptados_at: new Date().toISOString(),
        terminos_version: TERMS_VERSION
      })
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || result.error) {
      const raw = String(result.error || '');
      if (raw === 'EMAIL_DUPLICADO') throw new Error('Ese email ya tiene una cuenta. Ingres\u00e1 o recuper\u00e1 tu contrase\u00f1a.');
      if (raw === 'CODIGO_DUPLICADO') throw new Error('Ya existe una empresa registrada con un nombre muy similar. Escribinos y lo resolvemos.');
      throw new Error(raw || 'No se pudo crear la cuenta.');
    }

    // Cuenta creada: ingresar directo con las credenciales nuevas.
    const { data: loginData, error: loginError } = await sb.auth.signInWithPassword({ email, password: pass });
    if (loginError || !loginData?.user) {
      switchAuthMode('login');
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginPass').value = pass;
      okEl.textContent = 'Tu cuenta fue creada. Ingres\u00e1 con tu email y contrase\u00f1a.';
      okEl.style.display = 'block';
      return;
    }
    currentUser = loginData.user;
    // Animación del login (js/login-animacion.js): desarma la pantalla antes de entrar.
    if (window.ctxLoginAnim) await window.ctxLoginAnim.salir();
    document.getElementById('loginScreen').style.display = 'none';
    showLoading(true);
    await loadApp();
  } catch (error) {
    errEl.textContent = error.message || 'No se pudo crear la cuenta.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear cuenta';
  }
}

let cerrandoSesion = false;
async function logout() {
  if (cerrandoSesion) return;
  cerrandoSesion = true;
  // La sesión se cierra mientras la animación (js/login-animacion.js) desarma la barra lateral.
  const salida = sb ? sb.auth.signOut() : Promise.resolve();
  try { if (window.ctxLoginAnim) await window.ctxLoginAnim.desarmarPanel(); } catch (e) {}
  await salida;
  location.reload();
}

function openForgotPasswordModal() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const input = document.getElementById('forgotEmail');
  if (email && input) input.value = email;
  document.getElementById('forgotPasswordOverlay')?.classList.add('open');
  setAuthMessage('forgotPasswordMessage', '', '');
}

function closeForgotPasswordModal(e) {
  const overlay = document.getElementById('forgotPasswordOverlay');
  if (!e || e.target === overlay) overlay?.classList.remove('open');
}

function openResetPasswordModal() {
  document.getElementById('resetPasswordOverlay')?.classList.add('open');
  setAuthMessage('resetPasswordMessage', '', '');
}

function closeResetPasswordModal(e) {
  const overlay = document.getElementById('resetPasswordOverlay');
  if (!e || e.target === overlay) overlay?.classList.remove('open');
}

function setAuthMessage(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'auth-message' + (type ? ' ' + type : '');
}

async function sendPasswordReset() {
  initSupabase();
  hideAuthMessages();
  const email = document.getElementById('forgotEmail')?.value.trim();
  const btn = document.getElementById('btnForgotPassword');
  if (!email) {
    setAuthMessage('forgotPasswordMessage', 'Ingresá tu email.', 'err');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando...';
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Enviar enlace';
  }
  if (error) {
    setAuthMessage('forgotPasswordMessage', 'No se pudo enviar el email: ' + error.message, 'err');
    return;
  }
  setAuthMessage('forgotPasswordMessage', 'Te enviamos un enlace para restablecer tu contraseña.', 'ok');
  const okEl = document.getElementById('loginSuccess');
  if (okEl) {
    okEl.textContent = 'Revisá tu email para cambiar la contraseña.';
    okEl.style.display = 'block';
  }
}

function isPasswordRecoveryUrl() {
  return (window.location.hash || '').includes('type=recovery') || (window.location.search || '').includes('type=recovery');
}

async function handleRecoveryReturn() {
  initSupabase();
  if (!isPasswordRecoveryUrl()) return false;
  passwordRecoveryMode = true;
  document.getElementById('loginScreen').style.display = 'flex';
  closeForgotPasswordModal();
  openResetPasswordModal();
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    setAuthMessage('resetPasswordMessage', 'El enlace no es válido o ya venció. Solicitá uno nuevo.', 'err');
  }
  return true;
}

async function saveNewPassword() {
  initSupabase();
  const pass = document.getElementById('resetPassword')?.value.trim() || '';
  const confirmPass = document.getElementById('resetPasswordConfirm')?.value.trim() || '';
  const btn = document.getElementById('btnResetPassword');
  if (pass.length < 8) {
    setAuthMessage('resetPasswordMessage', 'La nueva contraseña debe tener al menos 8 caracteres.', 'err');
    return;
  }
  if (pass !== confirmPass) {
    setAuthMessage('resetPasswordMessage', 'Las contraseñas no coinciden.', 'err');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
  }
  const { error } = await sb.auth.updateUser({ password: pass });
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Guardar contraseña';
  }
  if (error) {
    setAuthMessage('resetPasswordMessage', 'No se pudo actualizar la contraseña: ' + error.message, 'err');
    return;
  }
  setAuthMessage('resetPasswordMessage', 'Contraseña actualizada. Ya podés ingresar.', 'ok');
  const okEl = document.getElementById('loginSuccess');
  const errEl = document.getElementById('loginError');
  const passEl = document.getElementById('loginPass');
  if (okEl) {
    okEl.textContent = 'Contraseña actualizada. Ingresá con tu nueva clave.';
    okEl.style.display = 'block';
  }
  if (errEl) errEl.style.display = 'none';
  if (passEl) passEl.value = '';
  await sb.auth.signOut();
  passwordRecoveryMode = false;
  setTimeout(() => {
    closeResetPasswordModal();
    if (window.location.hash || window.location.search) {
      history.replaceState({}, document.title, window.location.pathname);
    }
    window.location.href = APP_URL;
  }, 1000);
}

// ── LOAD APP ──
async function loadApp() {
  initSupabase();
  // Load cliente profile.
  // IMPORTANTE: distinguir "la consulta falló" (token renovándose, señal floja)
  // de "no existe el perfil". Antes cualquier error se tomaba como "sin perfil"
  // y cerraba la sesión → el usuario tenía que volver a loguearse cada vez.
  let cli = null, cliErr = null, sesionVencida = false;
  for (let intento = 0; intento < 2; intento++) {
    const r = await sb.from('clientes').select('*').eq('id', currentUser.id).maybeSingle();
    cli = r.data; cliErr = r.error;
    if (!cliErr) break;
    // Error transitorio: renovamos la sesión y reintentamos una vez.
    try {
      const { error: rErr } = await sb.auth.refreshSession();
      if (rErr) { sesionVencida = true; break; }
    } catch (e) { sesionVencida = true; break; }
  }
  if (sesionVencida) {
    // La sesión realmente venció: volvemos al login sin mensajes alarmantes.
    try { await sb.auth.signOut(); } catch (e) {}
    currentUser = null;
    document.getElementById('loginScreen').style.display = 'flex';
    return;
  }
  if (cliErr) {
    // Falla de conexión: NO cerramos la sesión.
    if (confirm('No pudimos conectar con el servidor para cargar tu cuenta. Revisá tu conexión.\n\n¿Reintentar ahora?')) location.reload();
    return;
  }
  if (!cli) {
    // La consulta anduvo bien y el perfil realmente no existe.
    if (sb) await sb.auth.signOut();
    alert('Tu cuenta existe, pero todavía no tiene perfil comercial habilitado. Contactá a CTX para activar tus paneles.');
    location.reload();
    return;
  }
  currentCliente = cli;
  // El módulo PRO de riesgo productivo se evalúa apenas hay perfil. Si el
  // cliente es PRO y el módulo todavía no está, se baja en este momento.
  ctxCargarRiesgoProductivo();

  // Load operaciones y precios en paralelo
  const [opsRes, preciosRes, cosechaRes] = await Promise.all([
    sb.from('operaciones').select('*')
      .eq('cliente_codigo', cli.codigo)
      .eq('estado','confirmada')
      .order('created_at', {ascending:false}),
    sb.from('precios_mercado').select('*').eq('activo',true).order('updated_at',{ascending:false}),
    sb.from('campania_posiciones_cosecha').select('campania_codigo,producto,mes,anio')
  ]);

  // Normalize product names (remove accents for consistency)
  const normalize = s => {
    if (!s) return s;
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  };
  allOps = (opsRes.data || []).map(op => ({...op, producto: normalize(op.producto)}));
  refreshCampaignState();
  buildPreciosMap(preciosRes.data || []);
  buildPosicionesCosecha(cosechaRes && cosechaRes.data ? cosechaRes.data : []);
  // Load tags — normalizar null a [] siempre
  const rawTags = cli.tags_disponibles;
  // Filtrar tags vacíos o inválidos
  tagsDisponibles = Array.isArray(rawTags) 
    ? rawTags.filter(t => typeof t === 'string' && t.trim().length > 0)
    : [];
  console.log('[CTX Tags] al cargar:', rawTags, '->', tagsDisponibles);
  renderAll();
  renderAccessHub();
  showLoading(false);
  document.getElementById('appShell').style.display='block';
  // Animación (js/login-animacion.js): los punteros dibujan la barra lateral.
  if (window.ctxLoginAnim) window.ctxLoginAnim.panel();
  await refreshBusinessRemoteState();
  switchDashboard('kpis', document.getElementById('nav-kpis'));
  renderTagFilterBar();
  renderTagsFormSelector();
  initFormDefaults();
  cargarOpsGuardadas();
  loadHistoricos();
  renderFlujo();
  renderEvolucion();
  if (!tagsDisponibles.length) {
    setTimeout(() => abrirGestionTags(true), 500);
  }
}

function normText(v) {
  return (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function boolField(...values) {
  return values.some(v => v === true || v === 1 || v === 'true' || v === '1' || v === 'si' || v === 'sí');
}

function getClienteAccessState() {
  const cli = currentCliente || {};
  const actividad = normText(cli.actividad);
  const plan = cli.plan || cli.plan_nombre || cli.plan_comercial || (boolField(cli.acceso_premium, cli.premium_activo) ? 'Premium' : 'Standard');
  const accesoAgricola = boolField(cli.acceso_agricola, cli.panel_agricola, cli.activo) || actividad.includes('agric');
  const accesoGanaderia = boolField(cli.acceso_ganaderia, cli.panel_ganaderia) || actividad.includes('ganader');
  const accesoPremium = boolField(cli.acceso_premium, cli.premium_activo) || normText(plan).includes('premium');
  const estadoPago = cli.estado_pago || cli.pago_estado || (accesoPremium ? 'activo' : 'pendiente');
  const paymentUrl = cli.payment_url || cli.link_pago || cli.checkout_url || '';
  const subscriptionStatus = cli.subscription_status || cli.suscripcion_estado || '';
  const subscriptionId = cli.mp_subscription_id || cli.mp_preapproval_id || '';
  const proPeriodicity = cli.pro_periodicidad || cli.plan_periodicidad || '';
  const proVencimiento = cli.pro_vencimiento || cli.pro_vence_at || cli.premium_vencimiento || '';
  return {
    plan,
    accesoAgricola,
    accesoGanaderia,
    accesoPremium,
    estadoPago,
    paymentUrl,
    subscriptionStatus,
    subscriptionId,
    proPeriodicity,
    proVencimiento
  };
}

function portalCardHtml(cfg) {
  const disabled = !cfg.enabled;
  return `
    <div class="portal-pane-card" data-portal-card="${cfg.key || ''}">
      <div class="portal-badge">${cfg.badge}</div>
      <div class="portal-title">${cfg.title}</div>
      <div class="portal-copy">${cfg.copy}</div>
      <div class="portal-meta">
        <div class="portal-meta-row"><span>Acceso</span><strong style="color:${disabled ? 'var(--gris)' : 'white'}">${disabled ? 'Bloqueado' : 'Habilitado'}</strong></div>
        <div class="portal-meta-row"><span>Plan</span><strong style="color:white">${cfg.plan}</strong></div>
      </div>
      <div class="portal-actions">
        ${cfg.href
          ? `<a class="portal-link${disabled ? ' secondary' : ''}" ${disabled ? 'aria-disabled="true"' : `href="${cfg.href}" target="_blank" rel="noopener noreferrer"`}>${cfg.primaryLabel}</a>`
          : `<button class="portal-link secondary" type="button" onclick="${cfg.onClick || ''}">${cfg.primaryLabel}</button>`
        }
        ${cfg.secondaryLabel ? `<button class="portal-link secondary" type="button" onclick="${cfg.secondaryAction || ''}">${cfg.secondaryLabel}</button>` : ''}
      </div>
    </div>
  `;
}

function switchPortalTab(tab, btn) {
  return;
}

function setPortalExpanded(expanded) {
  return;
}

function togglePortalExpansion() {
  return;
}

function getDashboardMode(producto, state) {
  const cli = currentCliente || {};
  if (producto === 'agricultura') {
    const modo = (cli.agricultura_nivel || cli.agricultura_dashboard || '').toLowerCase();
    return modo === 'pro' ? 'PRO' : 'ESTANDAR';
  }
  if (producto === 'ganaderia') {
    const modo = (cli.ganaderia_nivel || cli.ganaderia_dashboard || '').toLowerCase();
    if (modo === 'pro') return 'PRO';
    if (modo === 'estandar' || modo === 'estándar') return 'ESTANDAR';
    return state.accesoPremium ? 'PRO' : 'ESTANDAR';
  }
  if (producto === 'tambo') {
    const modo = (cli.tambo_nivel || cli.tambo_dashboard || '').toLowerCase();
    if (modo === 'pro') return 'PRO';
    if (modo === 'estandar' || modo === 'estándar') return 'ESTANDAR';
    return 'SIN ACCESO';
  }
  return 'ESTANDAR';
}

function isAgriculturaPro() {
  return getDashboardMode('agricultura', getClienteAccessState()) === 'PRO';
}

// ── Carga a demanda del módulo de riesgo productivo (js/riesgo-productivo.js) ──
// Son ~125 KB que solo usa Agricultura PRO: la sección #sec-riesgo-prod queda
// oculta para el resto. Por eso no va en un <script> fijo: se baja recién
// cuando se sabe que el cliente es PRO. El ?v= lo mantiene herramientas/versionar.js.
const RIESGO_PRODUCTIVO_SRC = 'js/riesgo-productivo.js?v=4a2385b7be';
function ctxCargarRiesgoProductivo() {
  // Ya cargado: solo reevaluar si corresponde mostrarlo.
  if (typeof window.rpAplicarGatePro === 'function') { window.rpAplicarGatePro(); return; }
  if (!isAgriculturaPro() || document.getElementById('ctx-js-riesgo')) return;
  const s = document.createElement('script');
  s.id = 'ctx-js-riesgo';
  s.src = RIESGO_PRODUCTIVO_SRC;
  // Si falla (sin señal y sin caché), se saca el tag para poder reintentar
  // en la próxima carga del perfil. La sección sigue oculta: no queda a medias.
  s.onerror = () => { s.remove(); console.warn('[CTX] No se pudo cargar el módulo de riesgo productivo.'); };
  document.body.appendChild(s);
}

function isProOnlyOperationType(tipo) {
  return AGRI_PRO_ONLY_TYPES.includes(String(tipo || '').trim());
}

function showAgricultureProOnlyPopup(tipo) {
  alert(`La operación "${tipo}" está disponible solo en Agricultura PRO.\n\nLa versión ESTÁNDAR permite cargar Plan de Siembra, Stock, Precio, Futuro y Forward.`);
}

function showCampaignProOnlyPopup() {
  alert('Las campañas múltiples están disponibles solo en Agricultura PRO.\n\nEn Agricultura ESTÁNDAR podés trabajar con una campaña activa y borrar campañas viejas si tu cuenta ya las tenía cargadas.');
}

function normalizeCampaign(value) {
  return String(value || '').trim();
}

function parseCampaignList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\n|]+/);
  const seen = new Set();
  return raw
    .map(normalizeCampaign)
    .filter(Boolean)
    .filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getLegacyCampaign() {
  return normalizeCampaign(currentCliente?.campania || currentCliente?.campaña || 'General') || 'General';
}

function getOperationCampaign(op) {
  return normalizeCampaign(op?.campania || op?.campaña || getLegacyCampaign());
}

function refreshCampaignState(preferred = activeCampaign) {
  const campaigns = [
    ...parseCampaignList(currentCliente?.campanias),
    ...parseCampaignList(currentCliente?.campania),
    ...allOps.map(op => getOperationCampaign(op)).filter(Boolean)
  ];
  campaignTabs = parseCampaignList(campaigns);
  if (!campaignTabs.length) campaignTabs = [getLegacyCampaign()];
  activeCampaign = campaignTabs.includes(preferred) ? preferred : campaignTabs[0];
}

function renderCampaignTabs() {
  const el = document.getElementById('campaign-tabs');
  const note = document.getElementById('campaign-form-note');
  if (!el) return;
  refreshCampaignState(activeCampaign);
  el.innerHTML = campaignTabs.map(c =>
    `<button class="campaign-tab ${c === activeCampaign ? 'active' : ''}" onclick='setActiveCampaign(${JSON.stringify(c)})'>Campaña ${c}</button>`
  ).join('');
  if (note) note.textContent = `Las operaciones nuevas se guardarán en la campaña ${activeCampaign}. Cambiá la pestaña superior para cargar o ver otra campaña.`;
}

function isMissingFunctionError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('function') || msg.includes('rpc') || msg.includes('schema cache');
}

async function reloadClienteProfile() {
  if (!sb || !currentUser) return currentCliente;
  const {data, error} = await sb.from('clientes').select('*').eq('id', currentUser.id).single();
  if (!error && data) currentCliente = data;
  return currentCliente;
}

async function updateClientCampaignList(nextCampaigns, primaryCampaign) {
  const clean = parseCampaignList(nextCampaigns);
  const primary = normalizeCampaign(primaryCampaign || clean[0] || getLegacyCampaign());
  const payload = {
    campanias: clean,
    campania: primary
  };
  let res = await sb.from('clientes').update(payload).eq('id', currentCliente.id);
  if (res.error && isMissingColumnError(res.error, 'campanias')) {
    res = await sb.from('clientes').update({ campania: primary }).eq('id', currentCliente.id);
  }
  if (res.error) return res;
  currentCliente = { ...currentCliente, ...payload };
  return res;
}

async function addCampaignRemote(campaignName) {
  const res = await sb.rpc('add_agricultura_campaign', { p_campaign: campaignName });
  if (!res.error || !isMissingFunctionError(res.error)) return res;
  const next = parseCampaignList([...campaignTabs, campaignName]);
  if (!isAgriculturaPro() && next.length > 1) {
    return { error: { message: 'Las campañas múltiples están disponibles solo en Agricultura PRO.' } };
  }
  return updateClientCampaignList(next, currentCliente?.campania || next[0]);
}

async function deleteCampaignRemote(campaignName) {
  const res = await sb.rpc('delete_agricultura_campaign', { p_campaign: campaignName });
  if (!res.error || !isMissingFunctionError(res.error)) return res;

  let deleteRes = await sb.from('operaciones')
    .delete()
    .eq('cliente_codigo', currentCliente.codigo)
    .eq('campania', campaignName);
  if (deleteRes.error && !isMissingColumnError(deleteRes.error, 'campania')) return deleteRes;

  if (campaignName === getLegacyCampaign()) {
    const legacyDelete = await sb.from('operaciones')
      .delete()
      .eq('cliente_codigo', currentCliente.codigo)
      .is('campania', null);
    if (legacyDelete.error && !isMissingColumnError(legacyDelete.error, 'campania')) return legacyDelete;
  }

  const next = campaignTabs.filter(c => c !== campaignName);
  return updateClientCampaignList(next, next[0] || getLegacyCampaign());
}

async function addCampaign() {
  refreshCampaignState(activeCampaign);
  if (!isAgriculturaPro() && campaignTabs.length >= 1) {
    showCampaignProOnlyPopup();
    return;
  }

  const campaignName = normalizeCampaign(prompt('Nombre de la nueva campaña. Ejemplo: 26/27'));
  if (!campaignName) return;

  if (campaignTabs.some(c => c.toLowerCase() === campaignName.toLowerCase())) {
    setActiveCampaign(campaignTabs.find(c => c.toLowerCase() === campaignName.toLowerCase()) || campaignName);
    alert('Esa campaña ya existe. Te llevé a la pestaña correspondiente.');
    return;
  }

  const res = await addCampaignRemote(campaignName);
  if (res.error) {
    if (!isAgriculturaPro() && String(res.error.message || '').toLowerCase().includes('pro')) showCampaignProOnlyPopup();
    else alert('No se pudo agregar la campaña: ' + res.error.message);
    return;
  }

  await reloadClienteProfile();
  activeCampaign = campaignName;
  refreshCampaignState(activeCampaign);
  renderAll();
  renderFlujo();
  renderPosicionesChart();
  renderEvolucion();
  cargarOpsGuardadas();
  initFormDefaults();
}

async function deleteActiveCampaign() {
  refreshCampaignState(activeCampaign);
  if (!activeCampaign) return;
  if (campaignTabs.length <= 1) {
    alert('Debe quedar al menos una campaña activa en el reporte. Podés borrar campañas viejas cuando exista otra campaña para dejar como principal.');
    return;
  }

  const msg = `¿Borrar la campaña "${activeCampaign}"?\n\nEsto eliminará todas las operaciones cargadas en esa campaña. Esta acción no se puede deshacer.`;
  if (!confirm(msg)) return;

  const deletedCampaign = activeCampaign;
  const nextCampaign = campaignTabs.find(c => c !== deletedCampaign) || getLegacyCampaign();
  const res = await deleteCampaignRemote(deletedCampaign);
  if (res.error) {
    alert('No se pudo borrar la campaña: ' + res.error.message);
    return;
  }

  await reloadClienteProfile();
  allOps = allOps.filter(op => getOperationCampaign(op) !== deletedCampaign);
  opsCache = opsCache.filter(op => getOperationCampaign(op) !== deletedCampaign);
  activeCampaign = nextCampaign;
  await refreshData();
  refreshCampaignState(activeCampaign);
  renderAll();
  renderFlujo();
  renderPosicionesChart();
  renderEvolucion();
  cargarOpsGuardadas();
  initFormDefaults();
}

function syncAgricultureModeUi() {
  const isPro = isAgriculturaPro();
  ['f-tipo','eop-tipo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
      const base = opt.value || opt.textContent.replace(/\s+\(PRO\)$/,'');
      if (!base) return;
      opt.textContent = isProOnlyOperationType(base) && !isPro ? `${base} (PRO)` : base;
      opt.value = base;
    });
  });
  const flujoTipo = document.getElementById('flujo-tipo');
  if (flujoTipo) {
    Array.from(flujoTipo.options).forEach(opt => {
      if (!opt.value && !opt.textContent) return;
      const base = opt.value || opt.textContent.replace(/\s+\(PRO\)$/,'');
      if (isProOnlyOperationType(base)) {
        opt.disabled = !isPro;
        opt.textContent = !isPro ? `${base} (PRO)` : base;
        opt.value = base;
      }
    });
    if (!isPro && isProOnlyOperationType(flujoTipo.value)) flujoTipo.value = '';
  }
}

function setActiveCampaign(campaign) {
  activeCampaign = normalizeCampaign(campaign) || getLegacyCampaign();
  filterProd = 'todos';
  renderCampaignTabs();
  syncAgricultureModeUi();
  renderAll();
  renderFlujo();
  renderPosicionesChart();
  renderEvolucion();
  cargarOpsGuardadas();
  initFormDefaults();
}

function getCampaignOps(source = allOps) {
  refreshCampaignState(activeCampaign);
  const scoped = activeCampaign
    ? source.filter(op => getOperationCampaign(op) === activeCampaign)
    : source;
  if (isAgriculturaPro()) return scoped;
  return scoped.filter(op => !isProOnlyOperationType(op?.tipo));
}

function stripMissingColumnPayload(payload, columnName) {
  const next = {...payload};
  delete next[columnName];
  return next;
}

function isMissingColumnError(error, columnName) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('column') || msg.includes('schema cache'));
}

async function insertOperacionWithCampaign(payload) {
  const res = await sb.from('operaciones').insert(payload);
  if (res.error && isMissingColumnError(res.error, 'campania')) {
    return sb.from('operaciones').insert(stripMissingColumnPayload(payload, 'campania'));
  }
  return res;
}

async function updateOperacionWithCampaign(payload, id) {
  const res = await sb.from('operaciones').update(payload).eq('id', id);
  if (res.error && isMissingColumnError(res.error, 'campania')) {
    return sb.from('operaciones').update(stripMissingColumnPayload(payload, 'campania')).eq('id', id);
  }
  return res;
}

function setPill(id, enabled, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'account-pill ' + (enabled ? 'ok' : 'off');
}

function updateSidebarProducts(state) {
  const modoAgr = getDashboardMode('agricultura', state);
  const modoGan = getDashboardMode('ganaderia', state);
  const modoTam = getDashboardMode('tambo', state);
  const agrActivo = !!state.accesoAgricola;
  const ganActivo = !!state.accesoGanaderia;
  const tamboActivo = boolField(currentCliente?.acceso_tambo, currentCliente?.panel_tambo) || modoTam !== 'SIN ACCESO';
  document.getElementById('nav-agricultura-sub').textContent = agrActivo ? `Dashboard ${modoAgr.toLowerCase()}` : 'Sin acceso';
  document.getElementById('nav-ganaderia-sub').textContent = ganActivo ? `Dashboard ${modoGan.toLowerCase()}` : 'Sin acceso';
  document.getElementById('nav-tambo-sub').textContent = tamboActivo ? `Dashboard ${modoTam.toLowerCase()}` : 'Sin acceso';
  const navAgr = document.getElementById('nav-agricultura');
  const navGan = document.getElementById('nav-ganaderia');
  const navTambo = document.getElementById('nav-tambo');
  if (navAgr) navAgr.classList.toggle('is-disabled', !agrActivo);
  if (navGan) navGan.classList.toggle('is-disabled', !ganActivo);
  if (navTambo) {
    navTambo.classList.toggle('is-disabled', !tamboActivo);
    navTambo.style.opacity = tamboActivo ? '' : '.55';
  }
  // Mercado: siempre visible, sub-label indica si tiene IA
  const navMercadoSub = document.getElementById('nav-mercado-sub');
  if (navMercadoSub) {
    const esPro = ['agricultura_nivel','ganaderia_nivel','tambo_nivel']
      .some(k => String(currentCliente?.[k] || '').toUpperCase() === 'PRO');
    navMercadoSub.textContent = esPro ? 'Granos · Asesor IA PRO' : 'Granos · Análisis IA';
  }
}

function updateCuentaDashboard(state) {
  const modoAgr = getDashboardMode('agricultura', state);
  const modoGan = getDashboardMode('ganaderia', state);
  const modoTam = getDashboardMode('tambo', state);
  const tamboActivo = boolField(currentCliente?.acceso_tambo, currentCliente?.panel_tambo) || modoTam !== 'SIN ACCESO';
  document.getElementById('cuenta-plan').textContent = state.plan || 'Standard';
  document.getElementById('cuenta-pago').textContent = String(state.estadoPago || 'pendiente').replace(/_/g,' ');
  document.getElementById('cuenta-estado').textContent = currentCliente?.activo ? 'Activa' : 'Pendiente';
  setPill('cuenta-agr-acceso', !!state.accesoAgricola, state.accesoAgricola ? 'Habilitado' : 'Bloqueado');
  setPill('cuenta-gan-acceso', !!state.accesoGanaderia, state.accesoGanaderia ? 'Habilitado' : 'Bloqueado');
  setPill('cuenta-tam-acceso', tamboActivo, tamboActivo ? 'Habilitado' : 'Sin acceso');
  document.getElementById('cuenta-agr-version').textContent = state.accesoAgricola ? modoAgr : '—';
  document.getElementById('cuenta-gan-version').textContent = state.accesoGanaderia ? modoGan : '—';
  document.getElementById('cuenta-tam-version').textContent = tamboActivo ? modoTam : '—';
  fillCuentaControls(state, { modoAgr, modoGan, modoTam, tamboActivo });
}

function fillCuentaControls(state, meta = {}) {
  const modoAgr = meta.modoAgr || getDashboardMode('agricultura', state);
  const modoGan = meta.modoGan || getDashboardMode('ganaderia', state);
  const modoTam = meta.modoTam || getDashboardMode('tambo', state);
  const tamboActivo = meta.tamboActivo ?? (boolField(currentCliente?.acceso_tambo, currentCliente?.panel_tambo) || modoTam !== 'SIN ACCESO');
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setValue('cuenta-plan-select', state.plan || 'Standard');
  setValue('cuenta-pago-select', String(state.estadoPago || 'pendiente').toLowerCase());
  setValue('cuenta-agr-acceso-select', state.accesoAgricola ? 'on' : 'off');
  setValue('cuenta-agr-version-select', modoAgr);
  setValue('cuenta-gan-acceso-select', state.accesoGanaderia ? 'on' : 'off');
  setValue('cuenta-gan-version-select', modoGan);
  setValue('cuenta-tam-acceso-select', tamboActivo ? 'on' : 'off');
  setValue('cuenta-tam-version-select', tamboActivo ? (modoTam === 'SIN ACCESO' ? 'ESTANDAR' : modoTam) : 'ESTANDAR');
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText('cuenta-plan-readonly', state.plan || 'Standard');
  setText('cuenta-pago-readonly', String(state.estadoPago || 'pendiente').replace(/_/g, ' '));
  setText('cuenta-pro-periodicidad', state.proPeriodicity ? String(state.proPeriodicity).replace(/_/g, ' ') : (state.accesoPremium ? 'PRO activo' : '—'));
  setText('cuenta-subscription-status', state.subscriptionStatus ? String(state.subscriptionStatus).replace(/_/g, ' ') : (state.accesoPremium ? 'activo' : '—'));
  setText('cuenta-pro-vencimiento', formatAccountDate(state.proVencimiento));
  setText('cuenta-payment-link', state.paymentUrl ? 'Disponible' : '—');
  setText('cuenta-agr-readonly', state.accesoAgricola ? `Habilitado · ${modoAgr}` : 'Sin acceso');
  setText('cuenta-gan-readonly', state.accesoGanaderia ? `Habilitado · ${modoGan}` : 'Sin acceso');
  setText('cuenta-tam-readonly', tamboActivo ? `Habilitado · ${modoTam}` : 'Sin acceso');
  const isProAccount = isProAccountState(state);
  const upgradeBtn = document.getElementById('btn-account-upgrade');
  if (upgradeBtn) upgradeBtn.style.display = isProAccount ? 'none' : 'inline-flex';
  const cancelBtn = document.getElementById('btn-cancel-subscription');
  if (cancelBtn) cancelBtn.style.display = state.subscriptionId && isProAccount ? 'inline-flex' : 'none';
  syncCuentaProduct('agricultura');
  syncCuentaProduct('ganaderia');
  syncCuentaProduct('tambo');
}

function formatAccountDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isProAccountState(state = getClienteAccessState()) {
  const status = normText(state.subscriptionStatus || state.estadoPago);
  return !!state.accesoPremium || ['authorized', 'autorizada', 'activo', 'active', 'al dia', 'al_dia', 'bonificado'].includes(status);
}

function syncCuentaProduct(producto) {
  const map = {
    agricultura: ['cuenta-agr-acceso-select', 'cuenta-agr-version-select'],
    ganaderia: ['cuenta-gan-acceso-select', 'cuenta-gan-version-select'],
    tambo: ['cuenta-tam-acceso-select', 'cuenta-tam-version-select']
  };
  const [accessId, versionId] = map[producto] || [];
  const access = document.getElementById(accessId);
  const version = document.getElementById(versionId);
  if (!access || !version) return;
  version.disabled = access.value !== 'on';
}

function setCuentaStatus(message, tone = '') {
  const el = document.getElementById('cuenta-save-status');
  if (!el) return;
  el.textContent = message;
  el.className = `account-status-note${tone ? ` ${tone}` : ''}`;
}

function buildGanaderiaSrc(mode) {
  const clienteId = currentCliente?.id || '';
  const clienteNombre = currentCliente?.nombre_empresa || '';
  const userId = currentUser?.id || '';
  const base = mode === 'PRO'
      ? 'Ganaderia/ganaderia_PRO_integrado_PRODUCCION_v2.html'
    : 'Ganaderia/ganaderia_ESTANDAR_integrado_PRODUCCION_v2.html';
  const qs = new URLSearchParams();
  if (clienteId) qs.set('cliente_id', clienteId);
  if (clienteNombre) qs.set('cliente_nombre', clienteNombre);
  if (userId) qs.set('user_id', userId);
  return qs.toString() ? `${base}?${qs.toString()}` : base;
}

function buildTamboSrc(mode) {
  const clienteId = currentCliente?.id || '';
  const clienteNombre = currentCliente?.nombre_empresa || '';
  const userId = currentUser?.id || '';
  const base = 'Tambo/tambo_integrado_PRODUCCION_v1.html';
  const qs = new URLSearchParams();
  qs.set('mode', (mode || 'ESTANDAR').toUpperCase());
  qs.set('v', '28806f3424');   // evita que el navegador sirva un panel de tambo viejo después de un deploy
  if (clienteId) qs.set('cliente_id', clienteId);
  if (clienteNombre) qs.set('cliente_nombre', clienteNombre);
  if (userId) qs.set('user_id', userId);
  return `${base}?${qs.toString()}`;
}

async function saveCuentaConfig() {
  setCuentaStatus('La configuración comercial se gestiona desde administración.', 'warn');
}

function switchDashboard(view, el) {
  const state = getClienteAccessState();
  if (view === 'agricultura' && !state.accesoAgricola) {
    view = 'cuenta';
    el = null;
  }
  if (view === 'ganaderia' && !state.accesoGanaderia) {
    view = 'cuenta';
    el = null;
  }
  if (view === 'tambo') {
    const modoTam = getDashboardMode('tambo', state);
    const tamboActivo = boolField(currentCliente?.acceso_tambo, currentCliente?.panel_tambo) || modoTam !== 'SIN ACCESO';
    if (!tamboActivo) {
      view = 'cuenta';
      el = null;
    }
  }
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  if (view === 'kpis') {
    renderBusinessUnits();
    if (kpiTabActiva === 'financiero') ctxFinMontar();
  }
  if (view === 'ganaderia') {
    const modoGan = getDashboardMode('ganaderia', state);
    const frame = document.getElementById('frame-ganaderia');
    const target = buildGanaderiaSrc(modoGan);
    if (frame && frame.src !== new URL(target, window.location.href).href) frame.src = target;
  }
  if (view === 'tambo') {
    const modoTam = getDashboardMode('tambo', state);
    const frame = document.getElementById('frame-tambo');
    const target = buildTamboSrc(modoTam);
    if (frame && frame.src !== new URL(target, window.location.href).href) frame.src = target;
  }
  if (view === 'mercado') {
    // Panel nativo — sin iframe. KPI y memoria se actualizan via switchDashboard override en el bloque de agente mercado
  }
  updateDashboardActionButtons();
  closeSidebar();
}

function getActiveDashboardName() {
  const active = document.querySelector('.dashboard-view.active');
  return active?.id?.replace('view-', '') || 'kpis';
}

function getActiveDashboardMode() {
  const view = getActiveDashboardName();
  const state = getClienteAccessState();
  if (view === 'agricultura') return getDashboardMode('agricultura', state);
  if (view === 'ganaderia') return getDashboardMode('ganaderia', state);
  if (view === 'tambo') return getDashboardMode('tambo', state);
  return '';
}

function getActiveDashboardLabel() {
  const view = getActiveDashboardName();
  if (view === 'agricultura') return 'Agricultura';
  if (view === 'ganaderia') return 'Ganadería';
  if (view === 'tambo') return 'Tambo';
  if (view === 'mercado') return 'Mercado de Granos';
  if (view === 'kpis') return 'KPIs';
  if (view === 'cuenta') return 'Cuenta';
  return 'Panel';
}

function updateDashboardActionButtons() {
  const proBtn = document.getElementById('btn-dashboard-pro');
  if (!proBtn) return;
  const view = getActiveDashboardName();
  const mode = getActiveDashboardMode();
  const isProAccount = isProAccountState(getClienteAccessState());
  const isStandardPanel = ['agricultura', 'ganaderia', 'tambo'].includes(view) && mode === 'ESTANDAR';
  // El panel Mercado tiene su propio gate interno — no mostrar el botón PRO global
  proBtn.style.display = isStandardPanel && !isProAccount && view !== 'mercado' ? 'inline-flex' : 'none';
}

function openProPanelsModal() {
  setProCheckoutStatus('', '');
  const proTerms = document.getElementById('proTermsAccepted');
  if (proTerms) proTerms.checked = false;
  prefillBillingForm();
  const overlay = document.getElementById('proPanelsOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeProPanelsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('proPanelsOverlay')?.classList.remove('open');
}

function openDocumentationModal() {
  const overlay = document.getElementById('documentationOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeDocumentationModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('documentationOverlay')?.classList.remove('open');
}

function openTermsModal() {
  document.getElementById('termsOverlay')?.classList.add('open');
}

function closeTermsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('termsOverlay')?.classList.remove('open');
}

function getProCheckoutUrl(plan) {
  const cli = currentCliente || {};
  const normalizedPlan = String(plan || '').toLowerCase();
  if (normalizedPlan === 'anual') {
    return cli.checkout_pro_anual_url || cli.link_pago_anual || cli.payment_url_anual || cli.checkout_url_anual || '';
  }
  return cli.checkout_pro_mensual_url || cli.link_pago_mensual || cli.payment_url_mensual || cli.checkout_url_mensual || '';
}

function setProCheckoutStatus(message, type = '') {
  const el = document.getElementById('proCheckoutStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'pro-checkout-status' + (type ? ' ' + type : '');
}

function getProPlanText(plan) {
  return String(plan || 'mensual').toLowerCase() === 'anual'
    ? 'anual de USD 150'
    : 'mensual de USD 15';
}

function cleanBillingDocument(value = '') {
  return String(value || '').replace(/[^\d]/g, '');
}

function prefillBillingForm() {
  const cli = currentCliente || {};
  const setIfEmpty = (id, value) => {
    const el = document.getElementById(id);
    if (el && !el.value && value) el.value = value;
  };
  setIfEmpty('billingRazonSocial', cli.facturacion_razon_social || cli.razon_social || cli.nombre_empresa || '');
  setIfEmpty('billingDocumento', cli.facturacion_documento || cli.cuit || cli.dni || '');
  setIfEmpty('billingEmail', cli.email_facturacion || cli.facturacion_email || cli.email || currentUser?.email || '');
  setIfEmpty('billingDomicilio', cli.facturacion_domicilio || cli.domicilio_fiscal || cli.domicilio || '');
  const iva = document.getElementById('billingCondicionIva');
  if (iva && !iva.value && (cli.facturacion_condicion_iva || cli.condicion_iva)) {
    iva.value = cli.facturacion_condicion_iva || cli.condicion_iva;
  }
}

function getBillingData() {
  return {
    razon_social: document.getElementById('billingRazonSocial')?.value.trim() || '',
    documento: document.getElementById('billingDocumento')?.value.trim() || '',
    documento_limpio: cleanBillingDocument(document.getElementById('billingDocumento')?.value || ''),
    condicion_iva: document.getElementById('billingCondicionIva')?.value || '',
    email_facturacion: document.getElementById('billingEmail')?.value.trim() || '',
    domicilio_fiscal: document.getElementById('billingDomicilio')?.value.trim() || ''
  };
}

function validateBillingData(billing) {
  if (!billing.razon_social) return 'Completá razón social o nombre para facturación.';
  if (!billing.documento_limpio || billing.documento_limpio.length < 7) return 'Completá CUIT o DNI válido para facturación.';
  if (!billing.condicion_iva) return 'Seleccioná la condición frente al IVA.';
  if (!billing.email_facturacion || !billing.email_facturacion.includes('@')) return 'Completá un email válido para enviar la factura.';
  return '';
}

function openProFallbackEmail(plan) {
  const panel = getActiveDashboardLabel();
  const planText = getProPlanText(plan);
  const cliente = currentCliente?.nombre_empresa || currentUser?.email || 'mi cuenta';
  const subject = encodeURIComponent(`Solicitud upgrade PRO ${panel}`);
  const body = encodeURIComponent(`Hola CTX,\n\nQuiero activar Paneles PRO para ${cliente}.\nPanel solicitado: ${panel}\nPlan elegido: ${planText}\n\nNo pude iniciar el checkout automático desde el panel. Quedo atento al link o instrucciones de pago.\n`);
  window.open(`mailto:info@ctxasesores.com?subject=${subject}&body=${body}`, '_blank');
}

async function cancelProSubscription() {
  const state = getClienteAccessState();
  if (!state.subscriptionId) {
    setCuentaStatus('No encontramos una suscripción automática asociada a esta cuenta.', 'warn');
    return;
  }
  const ok = confirm('¿Querés cancelar la suscripción PRO? El acceso puede mantenerse vigente hasta el fin del período ya abonado.');
  if (!ok) return;
  initSupabase();
  setCuentaStatus('Solicitando cancelación en Mercado Pago...', 'warn');
  try {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Necesitás iniciar sesión para cancelar la suscripción.');
    const response = await fetch(`${FUNCTIONS_URL}/cancelar-suscripcion-pro`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPA_KEY
      },
      body: JSON.stringify({ subscription_id: state.subscriptionId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No se pudo cancelar la suscripción.');
    currentCliente = {
      ...currentCliente,
      subscription_status: payload.subscription_status || 'cancelled',
      estado_pago: payload.estado_pago || 'pendiente',
      subscription_cancel_requested_at: new Date().toISOString()
    };
    updateCuentaDashboard(getClienteAccessState());
    updateDashboardActionButtons();
    setCuentaStatus('La cancelación quedó solicitada. Si ya había un período abonado, el acceso puede mantenerse vigente hasta su vencimiento.', 'ok');
  } catch (error) {
    console.warn('No se pudo cancelar la suscripción:', error);
    setCuentaStatus(`No se pudo cancelar la suscripción: ${error.message || error}`, 'err');
  }
}

async function startProCheckout(plan) {
  const normalizedPlan = String(plan || 'mensual').toLowerCase() === 'anual' ? 'anual' : 'mensual';
  const directUrl = getProCheckoutUrl(plan) || getClienteAccessState().paymentUrl;
  const acceptedProTerms = document.getElementById('proTermsAccepted')?.checked;
  if (!acceptedProTerms) {
    setProCheckoutStatus('Antes de continuar al pago tenés que aceptar los Términos y Condiciones.', 'err');
    return;
  }
  const billing = getBillingData();
  const billingError = validateBillingData(billing);
  if (billingError) {
    setProCheckoutStatus(billingError, 'err');
    return;
  }
  if (directUrl) {
    window.open(directUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  initSupabase();
  setProCheckoutStatus('Preparando checkout seguro...', 'ok');
  try {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Necesitás iniciar sesión para comprar PRO.');

    const response = await fetch(`${FUNCTIONS_URL}/crear-checkout-pro`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPA_KEY
      },
      body: JSON.stringify({
        plan: normalizedPlan,
        panel: getActiveDashboardLabel(),
        cliente_id: currentCliente?.id || currentUser?.id || null,
        billing
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorText = typeof payload.error === 'string'
        ? payload.error
        : (payload.message || JSON.stringify(payload).slice(0, 300) || 'No se pudo crear el checkout.');
      throw new Error(errorText);
    }
    const checkoutUrl = payload.init_point || payload.checkout_url || payload.url;
    if (!checkoutUrl) throw new Error('Mercado Pago no devolvió un link de pago.');
    window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
    setProCheckoutStatus('Abrimos Mercado Pago en una nueva ventana. Cuando la suscripción se autorice, PRO se activará automáticamente.', 'ok');
  } catch (error) {
    console.warn('Checkout PRO automático no disponible:', error);
    setProCheckoutStatus(`No se pudo iniciar el pago automático: ${error.message || error}. Si persiste, tocá de nuevo o contactá a CTX.`, 'err');
  }
}

function reloadDashboardFrame(frameId) {
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const currentSrc = frame.getAttribute('src') || frame.src;
  if (!currentSrc) return;
  const url = new URL(currentSrc, window.location.href);
  url.searchParams.set('_refresh', Date.now().toString());
  frame.src = url.href;
}

async function refreshActiveDashboard() {
  const view = getActiveDashboardName();
  const btn = document.getElementById('btn-dashboard-refresh');
  const originalText = btn?.textContent || '↻ Actualizar';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '↻ Actualizando...';
  }
  try {
    if (view === 'kpis') {
      await refreshBusinessRemoteState(true);
      renderBusinessUnits(true);
      if (kpiTabActiva === 'financiero') await ctxFinMontar(true);
    } else if (view === 'agricultura') {
      await refreshData();
    } else if (view === 'ganaderia') {
      reloadDashboardFrame('frame-ganaderia');
    } else if (view === 'tambo') {
      reloadDashboardFrame('frame-tambo');
    } else if (view === 'mercado') {
      // Panel nativo — recargar precios y KPI de cartera
      if (typeof actualizarKpiCartera === 'function') actualizarKpiCartera();
      if (typeof cargarMemoriaMercado === 'function') cargarMemoriaMercado();
    } else {
      await refreshData();
      renderAccessHub();
    }
  } catch (error) {
    console.warn('No se pudo actualizar el dashboard activo', error);
    alert('No se pudo actualizar el dashboard. Probá nuevamente en unos segundos.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function exportActiveDashboardPdf() {
  const view = getActiveDashboardName();
  const frameId = view === 'ganaderia' ? 'frame-ganaderia' : view === 'tambo' ? 'frame-tambo' : '';
  if (frameId) {
    const frame = document.getElementById(frameId);
    try {
      if (frame?.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      }
    } catch (error) {
      console.warn('No se pudo imprimir el dashboard embebido, se imprime la vista principal', error);
    }
  }
  window.print();
}

function renderAccessHub() {
  const state = getClienteAccessState();
  updateSidebarProducts(state);
  updateCuentaDashboard(state);
  const frameGan = document.getElementById('frame-ganaderia');
  if (frameGan) frameGan.src = buildGanaderiaSrc(getDashboardMode('ganaderia', state));
  const frameTam = document.getElementById('frame-tambo');
  if (frameTam) frameTam.src = buildTamboSrc(getDashboardMode('tambo', state));
  updateDashboardActionButtons();
}

function openUpgradeLink() {
  openProPanelsModal();
}

const BUSINESS_UNIT_CONFIG = {
  leche: {
    key: 'leche',
    label: 'Leche',
    source: 'tambo',
    openView: 'tambo',
    emptyCopy: 'Guardá un escenario de tambo para ver margen por litro, sólidos por hectárea y eficiencia alimenticia.'
  },
  cria: {
    key: 'cria',
    label: 'Cría',
    source: 'ganaderia',
    openView: 'ganaderia',
    emptyCopy: 'Activá Cría y guardá un escenario para leer % destete, kg destetados por hectárea y costo por kg.'
  },
  recria: {
    key: 'recria',
    label: 'Recría',
    source: 'ganaderia',
    openView: 'ganaderia',
    emptyCopy: 'Guardá un escenario con recría activa para ver costo por kg ganado, GDP real y margen por cabeza.'
  },
  invernada: {
    key: 'invernada',
    label: 'Invernada',
    source: 'ganaderia',
    openView: 'ganaderia',
    emptyCopy: 'Guardá un escenario con invernada activa para ver margen por cabeza, costo por kg y kilos de carne por hectárea.'
  }
};

let businessDashboardState = { rows: [], scenarios: [] };
let businessRemoteScenarioCache = [];
let businessRemoteScenarioCacheKey = '';
let businessRemoteSelectionsCache = {};
let businessRemoteSelectionsCacheKey = '';
let businessRemoteStatePromise = null;

function getBusinessRemoteCacheKey() {
  return `${currentUser?.id || ''}::${currentCliente?.id || ''}`;
}

function getRemoteBusinessSelections() {
  if (businessRemoteSelectionsCacheKey !== getBusinessRemoteCacheKey()) return {};
  return businessRemoteSelectionsCache || {};
}

function fmtArs(value, decimals = 0) {
  return '$' + Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtMetricValue(metric) {
  if (!metric) return '—';
  const value = Number(metric.valor ?? metric.value ?? 0);
  const unit = metric.unidad || '';
  const hasDecimals = Math.abs(value % 1) > 0.001;
  // Valores por litro en dólares (0,073 USD/L): con 2 decimales se pierde la mitad del dato.
  const decimals = hasDecimals ? (Math.abs(value) < 1 && /\/L$/.test(unit) ? 3 : (Math.abs(value) < 10 ? 2 : 1)) : 0;
  if (unit.startsWith('$')) {
    const suffix = unit.slice(1).trim();
    return fmtArs(value, decimals) + (suffix ? ` ${suffix}` : '');
  }
  if (unit === '%') {
    return value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
  }
  return value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (unit ? ` ${unit}` : '');
}

function fmtScenarioDate(value) {
  if (!value) return 'sin fecha';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'sin fecha';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function numFromScenarioData(record, key, fallback = 0) {
  const raw = record && record[key] !== undefined ? record[key] : fallback;
  const normalized = typeof raw === 'string' ? raw.replace(',', '.') : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}

function pctFromScenarioData(record, key) {
  return numFromScenarioData(record, key, 0) / 100;
}

function roundScenarioValue(value, decimals) {
  const factor = Math.pow(10, decimals || 0);
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildLegacyTamboOutputs(datos = {}) {
  const rodeoTotal = Math.max(numFromScenarioData(datos, 'rodeo_total'), numFromScenarioData(datos, 'vacas_ordene'));
  const vacasOrdene = Math.max(1, numFromScenarioData(datos, 'vacas_ordene'));
  const litrosVaca = Math.max(0, numFromScenarioData(datos, 'litros_vaca') * (1 + pctFromScenarioData(datos, 'sys_litros_adj')));
  const diasMes = Math.max(1, numFromScenarioData(datos, 'dias_mes'));
  const superficie = Math.max(1, numFromScenarioData(datos, 'superficie'));
  const consumoMs = Math.max(0.1, numFromScenarioData(datos, 'consumo_ms') * (1 + pctFromScenarioData(datos, 'sys_ms_adj')));
  const sistema = datos.preset_sistema || 'pastoril';
  const grasa = numFromScenarioData(datos, 'grasa');
  const proteina = numFromScenarioData(datos, 'proteina');
  const solidos = grasa + proteina;
  const merma = pctFromScenarioData(datos, 'merma');
  const litrosBrutosDia = vacasOrdene * litrosVaca;
  const litrosVendiblesMes = litrosBrutosDia * diasMes * (1 - merma);
  const litrosVendiblesAnio = litrosVendiblesMes * 12;
  const litrosHaAnio = litrosVendiblesAnio / superficie;
  const carga = vacasOrdene / superficie;
  const msDia = vacasOrdene * consumoMs;
  const eficiencia = litrosBrutosDia / msDia;
  const solidosKgMes = litrosVendiblesMes * solidos / 100;
  const bonifSolidos = numFromScenarioData(datos, 'bonif_solidos');
  const bonifCalidad = numFromScenarioData(datos, 'bonif_calidad');
  let qualityAdj = 0;
  const pctOrdene = rodeoTotal > 0 ? vacasOrdene / rodeoTotal * 100 : 0;
  if (solidos >= 7.15) qualityAdj += 0.015;
  if (solidos < 6.85) qualityAdj -= 0.02;
  if (pctOrdene < 76) qualityAdj -= 0.01;

  const precioBase = numFromScenarioData(datos, 'precio_base');
  const precioFinal = precioBase * (1 + bonifSolidos + bonifCalidad + qualityAdj);
  const estabuladoFactor = sistema === 'compost_barn' ? 1.04 : sistema === 'free_stall' ? 1.07 : sistema === 'mixto' ? 1.02 : 1;
  const costos = {
    alimentacion: numFromScenarioData(datos, 'c_alim') * estabuladoFactor * (1 + pctFromScenarioData(datos, 'sys_alim_adj')),
    personal: numFromScenarioData(datos, 'c_personal') * (sistema === 'pastoril' ? 1 : 1.03) * (1 + pctFromScenarioData(datos, 'sys_personal_adj')),
    sanidad: numFromScenarioData(datos, 'c_sanidad') * (1 + pctFromScenarioData(datos, 'sys_sanidad_adj')),
    reproduccion: numFromScenarioData(datos, 'c_repro') * (1 + pctFromScenarioData(datos, 'sys_sanidad_adj')),
    energia: numFromScenarioData(datos, 'c_energia') * estabuladoFactor * (1 + pctFromScenarioData(datos, 'sys_energia_adj')),
    estructura: numFromScenarioData(datos, 'c_estructura') * estabuladoFactor * (1 + pctFromScenarioData(datos, 'sys_estructura_adj')),
    recria: numFromScenarioData(datos, 'c_recria'),
    impuestos: numFromScenarioData(datos, 'c_impuestos') + numFromScenarioData(datos, 'sys_cama_efluentes')
  };
  const costoLitro = Object.values(costos).reduce((acc, value) => acc + (Number(value) || 0), 0);
  const ingresoMes = litrosVendiblesMes * precioFinal;
  const egresoMes = litrosVendiblesMes * costoLitro;
  const margenMes = ingresoMes - egresoMes;
  const margenLitro = precioFinal - costoLitro;
  const solidsKgHaAnio = superficie > 0 ? (solidosKgMes * 12) / superficie : 0;
  const marginState = margenLitro >= 25 ? 'verde' : margenLitro >= 0 ? 'amarillo' : 'rojo';

  return {
    version: 'v1-legacy',
    modulo: 'tambo',
    actividades: { leche: true },
    resumen: {
      ingreso_mes: roundScenarioValue(ingresoMes, 0),
      egreso_mes: roundScenarioValue(egresoMes, 0),
      margen_mes: roundScenarioValue(margenMes, 0),
      margen_anio: roundScenarioValue(margenMes * 12, 0)
    },
    unidades: {
      leche: {
        activo: true,
        semaforo: { estado: marginState, regla: 'margen_litro' },
        principal: {
          clave: 'margen_litro',
          valor: roundScenarioValue(margenLitro, 2),
          unidad: '$/L'
        },
        secundarios: [
          {
            clave: 'kg_solidos_ha_anio',
            valor: roundScenarioValue(solidsKgHaAnio, 1),
            unidad: 'kg/ha/anio'
          },
          {
            clave: 'eficiencia_litros_kg_ms',
            valor: roundScenarioValue(eficiencia, 2),
            unidad: 'L/kg MS'
          }
        ],
        kpis: {
          precio_final_litro: roundScenarioValue(precioFinal, 2),
          costo_litro: roundScenarioValue(costoLitro, 2),
          margen_litro: roundScenarioValue(margenLitro, 2),
          litros_vaca_dia: roundScenarioValue(litrosVaca, 2),
          litros_ha_anio: roundScenarioValue(litrosHaAnio, 0),
          solidos_pct: roundScenarioValue(solidos, 2),
          solidos_kg_mes: roundScenarioValue(solidosKgMes, 0),
          solidos_kg_ha_anio: roundScenarioValue(solidsKgHaAnio, 1),
          eficiencia_litros_kg_ms: roundScenarioValue(eficiencia, 2),
          carga_vacas_ha: roundScenarioValue(carga, 2),
          vacas_ordene: roundScenarioValue(vacasOrdene, 0)
        }
      }
    }
  };
}

function normalizeScenarioOutputs(source, item) {
  if (item?.outputs && typeof item.outputs === 'object' && Object.keys(item.outputs).length) {
    return item.outputs;
  }
  // Panel de tambo v2 (datos._v = 2): siempre guarda sus outputs. El respaldo de abajo lee el
  // formato viejo y con datos v2 inventaría números, así que no se usa.
  if (source === 'tambo' && item?.datos?._v === 2) return null;
  if (source === 'tambo' && item?.datos && typeof item.datos === 'object') {
    return buildLegacyTamboOutputs(item.datos);
  }
  return null;
}

function mapRemoteScenarioToBusinessEntry(row) {
  if (!row || typeof row !== 'object') return null;
  const source = row.modulo === 'tambo' ? 'tambo' : 'ganaderia';
  const normalizedOutputs = normalizeScenarioOutputs(source, {
    datos: row.datos || {},
    outputs: row.outputs || {}
  });
  if (!normalizedOutputs) return null;
  return {
    uid: `db::${row.id}`,
    id: row.origen_local_id || row.id,
    scenario_db_id: row.id,
    source,
    modo: row.modo || 'ESTANDAR',
    nombre: row.nombre_escenario || 'Escenario guardado',
    cliente_id: row.cliente_id || currentCliente?.id || '',
    cliente_nombre: currentCliente?.nombre_empresa || '',
    user_id: row.user_id || currentUser?.id || '',
    updated_at: row.updated_at || row.created_at || '',
    datos: row.datos || {},
    actividades: row.actividades || {},
    outputs: normalizedOutputs
  };
}

async function fetchRemoteProductiveScenarios() {
  if (!sb || !currentUser?.id || !currentCliente?.id) return [];
  const { data, error } = await sb
    .from('escenarios_productivos')
    .select('id,user_id,cliente_id,modulo,modo,nombre_escenario,campania,actividades,datos,outputs,origen_local_id,updated_at,created_at,activo')
    .eq('user_id', currentUser.id)
    .eq('cliente_id', currentCliente.id)
    .eq('activo', true)
    .in('modulo', ['tambo', 'cria', 'recria', 'invernada', 'ganaderia_integral'])
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRemoteScenarioToBusinessEntry).filter(Boolean);
}

async function fetchRemoteBusinessSelections() {
  if (!sb || !currentUser?.id || !currentCliente?.id) return {};
  const { data, error } = await sb
    .from('dashboard_producto_links')
    .select('producto_clave, escenario_id, config')
    .eq('user_id', currentUser.id)
    .eq('cliente_id', currentCliente.id)
    .eq('activo', true);
  if (error) throw error;
  return (data || []).reduce((acc, item) => {
    if (!item?.producto_clave) return acc;
    acc[item.producto_clave] = {
      scenario_db_id: item.escenario_id || '',
      scenario_ref_id: item.config && typeof item.config === 'object' ? (item.config.scenario_ref_id || '') : ''
    };
    return acc;
  }, {});
}

function refreshBusinessRemoteState(force = false) {
  const cacheKey = getBusinessRemoteCacheKey();
  if (!cacheKey || !currentUser?.id || !currentCliente?.id || !sb) return Promise.resolve();
  if (
    !force &&
    businessRemoteScenarioCacheKey === cacheKey &&
    businessRemoteSelectionsCacheKey === cacheKey &&
    businessRemoteStatePromise === null
  ) {
    return Promise.resolve();
  }
  if (businessRemoteStatePromise) return businessRemoteStatePromise;
  businessRemoteStatePromise = Promise.all([
    fetchRemoteProductiveScenarios(),
    fetchRemoteBusinessSelections()
  ]).then(([scenarios, selections]) => {
    businessRemoteScenarioCache = scenarios || [];
    businessRemoteScenarioCacheKey = cacheKey;
    businessRemoteSelectionsCache = selections || {};
    businessRemoteSelectionsCacheKey = cacheKey;
  }).catch(error => {
    console.warn('No se pudo sincronizar KPIs con Supabase', error);
    businessRemoteScenarioCache = [];
    businessRemoteScenarioCacheKey = '';
    businessRemoteSelectionsCache = {};
    businessRemoteSelectionsCacheKey = '';
  }).finally(() => {
    businessRemoteStatePromise = null;
    renderBusinessUnits(true);
  });
  return businessRemoteStatePromise;
}

function collectProductiveScenarios() {
  if (businessRemoteScenarioCacheKey !== getBusinessRemoteCacheKey()) return [];
  return Array.isArray(businessRemoteScenarioCache) ? businessRemoteScenarioCache.slice() : [];
}

function getMonthlyScenarioMargin(scenario) {
  if (!scenario?.outputs?.resumen) return 0;
  if (scenario.source === 'tambo') {
    return Number(scenario.outputs.resumen.margen_mes || 0);
  }
  const total = Number(scenario.outputs.resumen.margen_total || 0);
  const periodo = Math.max(1, Number(scenario.datos?.periodo || 12));
  return total / periodo;
}

function buildBusinessRows() {
  const scenarios = collectProductiveScenarios();
  const remoteSelections = getRemoteBusinessSelections();
  const rows = Object.values(BUSINESS_UNIT_CONFIG).map(cfg => {
    const matchingScenarios = scenarios.filter(entry =>
      entry.source === cfg.source &&
      entry.outputs &&
      entry.outputs.unidades &&
      entry.outputs.unidades[cfg.key] &&
      entry.outputs.unidades[cfg.key].activo
    );
    const remoteSelection = remoteSelections[cfg.key] || null;
    let scenario = null;
    if (remoteSelection?.scenario_db_id) {
      scenario = matchingScenarios.find(entry => entry.scenario_db_id === remoteSelection.scenario_db_id) || null;
    }
    if (!scenario && remoteSelection?.scenario_ref_id) {
      scenario = matchingScenarios.find(entry => entry.id === remoteSelection.scenario_ref_id) || null;
    }
    if (!scenario) scenario = matchingScenarios[0];

    if (!scenario) {
      return {
        ...cfg,
        scenario: null,
        state: 'vacio',
        scenarioOptions: matchingScenarios
      };
    }

    const unit = scenario.outputs.unidades[cfg.key] || {};
    return {
      ...cfg,
      scenario,
      scenarioOptions: matchingScenarios,
      selectedScenarioId: remoteSelection?.scenario_ref_id || scenario.id || '',
      unit,
      state: unit.semaforo?.estado || 'vacio'
    };
  });

  businessDashboardState = { rows, scenarios };
  return rows;
}

function renderBusinessSummary(rows) {
  const el = document.getElementById('business-summary-grid');
  if (!el) return;
  const rowsWithScenario = rows.filter(row => row.scenario);
  const uniqueScenarios = [];
  const seen = new Set();
  rowsWithScenario.forEach(row => {
    if (seen.has(row.scenario.uid)) return;
    seen.add(row.scenario.uid);
    uniqueScenarios.push(row.scenario);
  });
  const redCount = rows.filter(row => row.state === 'rojo').length;
  const yellowCount = rows.filter(row => row.state === 'amarillo').length;
  // Cada escenario declara su moneda (tambo v2: outputs.moneda). Sin moneda, pesos.
  // Pesos y dólares no se suman sin convertir: se muestra un total por moneda.
  const marginByCurrency = {};
  uniqueScenarios.forEach(scenario => {
    const cur = String(scenario.outputs?.moneda || 'ARS').toUpperCase() === 'USD' ? 'USD' : 'ARS';
    marginByCurrency[cur] = (marginByCurrency[cur] || 0) + getMonthlyScenarioMargin(scenario);
  });
  const currencies = Object.keys(marginByCurrency).sort();
  const fmtCurrency = (cur, v) => cur === 'USD'
    ? (v < 0 ? '-' : '') + 'USD ' + Math.abs(Number(v) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })
    : fmtArs(v, 0);
  const marginValues = currencies.map(cur => marginByCurrency[cur]);
  const marginTone = !marginValues.length || marginValues.every(v => v >= 0) ? 'is-positive' : (marginValues.every(v => v < 0) ? 'is-negative' : '');
  const latest = uniqueScenarios
    .map(item => item.updated_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  const cards = [
    {
      label: 'Escenarios leídos',
      value: String(uniqueScenarios.length),
      sub: rowsWithScenario.length ? `${rowsWithScenario.length} unidades con KPI activo` : 'Todavía no hay escenarios productivos disponibles'
    },
    {
      label: 'Unidades en rojo',
      value: String(redCount),
      sub: yellowCount ? `${yellowCount} unidades en seguimiento` : 'Sin alertas amarillas en este corte'
    },
    {
      label: 'Margen mensual visible',
      value: currencies.length ? currencies.map(cur => fmtCurrency(cur, marginByCurrency[cur])).join(' · ') : fmtArs(0, 0),
      sub: currencies.length > 1
        ? 'Promedio por mes de cada escenario, sumado por moneda: pesos y dólares no se suman sin convertir'
        : 'Suma deduplicada de escenarios únicos, llevada a equivalente mensual',
      tone: marginTone
    },
    {
      label: 'Última actualización',
      value: latest ? fmtScenarioDate(latest) : 'Sin datos',
      sub: latest ? 'Último escenario guardado leído por este tablero' : 'Guardá un escenario en Tambo o Ganadería para activarlo'
    }
  ];

  el.innerHTML = cards.map(card => `
    <div class="business-summary-card">
      <div class="business-summary-label">${card.label}</div>
      <div class="business-summary-value ${card.tone || ''}">${card.value}</div>
      <div class="business-summary-sub">${card.sub}</div>
    </div>
  `).join('');
}

function statusLabel(state) {
  if (state === 'verde') return 'Defendible';
  if (state === 'amarillo') return 'Seguimiento';
  if (state === 'rojo') return 'En alerta';
  return 'Sin escenario';
}

function scenarioMetaText(row) {
  if (!row.scenario) return '';
  const out = row.scenario.outputs || {};
  const extra = [out.moneda, out.periodo?.rotulo].filter(Boolean).join(' · ');
  return `${row.scenario.nombre} · ${row.scenario.source === 'tambo' ? 'Tambo' : 'Ganadería'} ${String(row.scenario.modo || 'ESTANDAR').toUpperCase()}${extra ? ' · ' + extra : ''} · ${fmtScenarioDate(row.scenario.updated_at)}`;
}

function queueBusinessOpenRequest(row) {
  if (!row?.scenario) return;
  try {
    localStorage.setItem('ctx_unidades_open_request', JSON.stringify({
      source: row.source,
      scenario_id: row.scenario.id,
      cliente_id: currentCliente?.id || '',
      user_id: currentUser?.id || '',
      requested_at: new Date().toISOString()
    }));
  } catch (error) {
    console.warn('No se pudo dejar la apertura pendiente del escenario', error);
  }
}

function openBusinessSource(unitKey) {
  const row = businessDashboardState.rows.find(entry => entry.key === unitKey);
  if (!row) return;
  if (row.scenario) queueBusinessOpenRequest(row);
  const navId = row.openView === 'tambo' ? 'nav-tambo' : 'nav-ganaderia';
  switchDashboard(row.openView, document.getElementById(navId));
}

function getBusinessUnitPriority(unitKey) {
  const order = ['leche', 'cria', 'recria', 'invernada'];
  const idx = order.indexOf(unitKey);
  return idx === -1 ? 99 : (idx + 1) * 10;
}

async function persistBusinessSelectionRemote(unitKey, scenarioId) {
  if (!sb || !currentUser?.id || !currentCliente?.id) return;
  const cfg = BUSINESS_UNIT_CONFIG[unitKey];
  if (!cfg) return;
  const scenario = businessDashboardState.scenarios.find(entry => entry.id === scenarioId && entry.source === cfg.source)
    || businessDashboardState.rows.flatMap(row => row.scenarioOptions || []).find(entry => entry.id === scenarioId && entry.source === cfg.source)
    || null;
  const scenarioDbId = scenario?.scenario_db_id || null;
  try {
    const payload = {
      user_id: currentUser.id,
      cliente_id: currentCliente.id,
      producto_clave: unitKey,
      nombre_visible: cfg.label,
      origen_producto: 'productivo',
      modulo_fuente: scenario?.outputs?.modulo || (cfg.source === 'tambo' ? 'tambo' : unitKey),
      escenario_id: scenarioDbId,
      prioridad: getBusinessUnitPriority(unitKey),
      activo: true,
      config: { scenario_ref_id: scenario?.id || scenarioId || '' }
    };
    const { error } = await sb.from('dashboard_producto_links').upsert(payload, {
      onConflict: 'cliente_id,producto_clave'
    });
    if (error) throw error;
    const nextRemote = {
      ...getRemoteBusinessSelections(),
      [unitKey]: {
        scenario_db_id: scenarioDbId || '',
        scenario_ref_id: scenario?.id || scenarioId || ''
      }
    };
    businessRemoteSelectionsCache = nextRemote;
    businessRemoteSelectionsCacheKey = getBusinessRemoteCacheKey();
  } catch (error) {
    console.warn('No se pudo guardar el vínculo KPI en Supabase', error);
  }
}

function setBusinessScenario(unitKey, scenarioId) {
  const nextRemote = {
    ...getRemoteBusinessSelections(),
    [unitKey]: {
      scenario_db_id: '',
      scenario_ref_id: scenarioId || ''
    }
  };
  businessRemoteSelectionsCache = nextRemote;
  businessRemoteSelectionsCacheKey = getBusinessRemoteCacheKey();
  renderBusinessUnits();
  void persistBusinessSelectionRemote(unitKey, scenarioId);
}

function renderBusinessUnits(skipRemoteRefresh) {
  const grid = document.getElementById('business-units-grid');
  const note = document.getElementById('business-dashboard-note');
  if (!grid) return;
  if (!skipRemoteRefresh) void refreshBusinessRemoteState();
  const rows = buildBusinessRows();
  renderBusinessSummary(rows);
  if (note) {
    note.textContent = 'Lee los escenarios productivos guardados en Supabase para este cliente. Si una fila sigue vacía, todavía no existe un escenario persistido para esa unidad.';
  }
  if (!rows.some(row => row.scenario)) {
    grid.innerHTML = `<div class="business-empty">Todavía no encontramos escenarios productivos listos para este cliente en Supabase. Guardá uno en Tambo o Ganadería y este tablero se va a poblar automáticamente.</div>`;
    return;
  }

  grid.innerHTML = rows.map(row => {
    if (!row.scenario) {
      return `
        <div class="business-unit-card is-empty">
          <div class="business-unit-top">
            <div>
              <div class="business-unit-title">${row.label}</div>
              <div class="business-unit-empty-copy">${row.emptyCopy}</div>
            </div>
            <span class="business-status vacio">${statusLabel('vacio')}</span>
          </div>
          <div class="business-actions">
            <div class="business-actions-copy">Esta unidad queda reservada en el tablero, pero todavía no tiene un escenario guardado para leer.</div>
            <button class="business-btn secondary" type="button" onclick="openBusinessSource('${row.key}')">Abrir panel fuente</button>
          </div>
        </div>
      `;
    }

    const principal = row.unit?.principal || null;
    const secundarios = Array.isArray(row.unit?.secundarios) ? row.unit.secundarios.slice(0, 2) : [];
    while (secundarios.length < 2) secundarios.push(null);

    return `
      <div class="business-unit-card">
        <div class="business-unit-top">
          <div>
            <div class="business-unit-title">${row.label}</div>
            <div class="business-unit-source">${scenarioMetaText(row)}</div>
          </div>
          <div style="display:grid;gap:10px;justify-items:end">
            <span class="business-status ${row.state}">${statusLabel(row.state)}</span>
            <div class="business-selector-wrap">
              <div class="business-selector-label">Escenario fuente</div>
              <select class="business-selector" onchange="setBusinessScenario('${row.key}', this.value)">
                <option value="">Último guardado disponible</option>
                ${row.scenarioOptions.map(option => `
                  <option value="${option.id}" ${row.selectedScenarioId === option.id ? 'selected' : ''}>${option.nombre} · ${String(option.modo || 'ESTANDAR').toUpperCase()} · ${fmtScenarioDate(option.updated_at)}</option>
                `).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="business-kpis">
          <div class="business-kpi main">
            <div class="business-kpi-label">${(principal?.clave || 'kpi_principal').replaceAll('_', ' ')}</div>
            <div class="business-kpi-value">${fmtMetricValue(principal)}</div>
            <div class="business-kpi-sub">KPI principal para leer el negocio en una sola línea.</div>
          </div>
          ${secundarios.map(metric => `
            <div class="business-kpi">
              <div class="business-kpi-label">${metric ? metric.clave.replaceAll('_', ' ') : 'sin dato'}</div>
              <div class="business-kpi-value">${metric ? fmtMetricValue(metric) : '—'}</div>
              <div class="business-kpi-sub">${metric ? 'Indicador explicativo del escenario fuente.' : 'Este escenario todavía no expone un KPI secundario en esta posición.'}</div>
            </div>
          `).join('')}
        </div>
        <div class="business-actions">
          <div class="business-actions-copy">Fuente: ${row.source === 'tambo' ? 'Dashboard Tambo' : 'Dashboard Ganadería'}. El botón abre el panel origen para revisar o recalibrar el escenario.</div>
          <button class="business-btn" type="button" onclick="openBusinessSource('${row.key}')">Ver escenario fuente</button>
        </div>
      </div>
    `;
  }).join('');
}

window.addEventListener('storage', function(event) {
  if (!event.key) return;
  if (event.key === 'ctx_unidades_open_request') {
    renderBusinessUnits();
  }
});

window.addEventListener('focus', function() {
  // Solo re-renderizar si el usuario volvió desde otra pestaña/ventana del navegador,
  // no cuando hace click dentro de la misma página (ej: chat del agente)
  if (currentUser && currentCliente && document.visibilityState === 'visible' && _focusFromExternal) {
    renderBusinessUnits();
  }
  _focusFromExternal = false;
});

// Detectar cuándo la pestaña estuvo oculta (navegó a otra pestaña/ventana)
var _focusFromExternal = false;
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') {
    _focusFromExternal = true;
  }
});

// ── PRECIOS MAP ──
function normalizeStr(s) {
  return s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g,'') : s;
}


// Construye el mapa de posiciones de cosecha por campaña.

// ── Precio de valuación unificado por operación ──
// Centraliza la regla: un Plan de Siembra cuya campaña tiene posición de cosecha
// configurada se valúa con ese contrato; en cualquier otro caso (incl. Plan de
// Siembra sin config) se usa la lógica de mercado/SPOT de siempre.
// Todos los puntos de cálculo deben usar esta función.
function getPrecioValuacionOp(op) {
  if (op && op.tipo === 'Plan de Siembra') {
    const pCos = getPrecioPlanSiembra(op);
    if (pCos !== null && pCos !== undefined) return pCos;
  }
  return getPrecioMercado(op.producto, op.vencimiento);
}

function buildPosicionesCosecha(rows) {
  posicionesCosecha = {};
  (rows || []).forEach(r => {
    const camp = normalizeCampaign(r.campania_codigo);
    const prod = normalizeStr(r.producto);
    if (!camp || !prod) return;
    if (!posicionesCosecha[camp]) posicionesCosecha[camp] = {};
    posicionesCosecha[camp][prod] = { mes: Number(r.mes), anio: Number(r.anio) };
  });
}

// Devuelve la posición de cosecha configurada para una operación (según su
// campaña y producto), o null si no hay → el llamador cae a SPOT.
function getPosicionCosecha(op) {
  const camp = getOperationCampaign(op);
  const prod = normalizeStr(op && op.producto);
  if (!camp || !prod) return null;
  const porCamp = posicionesCosecha[camp];
  if (!porCamp) return null;
  return porCamp[prod] || null;
}

// Precio de valuación para un Plan de Siembra: si su campaña tiene posición de
// cosecha configurada, usa ese contrato de futuro; si no, cae a SPOT (null →
// getPrecioMercado con el vencimiento propio, que para Plan de Siembra es SPOT).
function getPrecioPlanSiembra(op) {
  const pos = getPosicionCosecha(op);
  if (!pos) return null;   // sin config → el llamador usa la lógica SPOT actual
  const prod = normalizeStr(op.producto);
  const exactKey = prod + '_' + pos.mes + '_' + pos.anio;
  if (exactKey in precios) return precios[exactKey];
  // Configurada pero sin precio en la curva: intentamos el más cercano, y si no,
  // devolvemos null para no romper (cae a SPOT).
  return getPrecioMasCercano(prod);
}

function buildPreciosMap(rows) {
  precios = {};
  // rows ordered by updated_at DESC — keep first occurrence per key (newest price)
  rows.forEach(r => {
    const key = normalizeStr(r.producto) + '_' + r.vencimiento;
    if (!(key in precios)) precios[key] = r.precio; // first = newest
  });
}

// Obtener precio de mercado para un producto y fecha de vencimiento
function getPrecioMercado(producto, fechaVto) {
  producto = normalizeStr(producto);
  if (!fechaVto) return null;
  const d = new Date(fechaVto + 'T00:00:00');
  const hoy = new Date();
  const mes = d.getMonth() + 1;
  const anio = d.getFullYear();
  const vencido = d < hoy;

  const exactKey = producto + '_' + mes + '_' + anio;
  const contKey  = producto + '_CONT';

  if (vencido) {
    if (['Soja','Maiz','Trigo'].includes(producto)) {
      return precios[contKey] || precios[exactKey] || getPrecioMasCercano(producto) || null;
    }
    return precios[exactKey] || getPrecioMasCercano(producto) || null;
  }
  return precios[exactKey] || precios[contKey] || getPrecioMasCercano(producto) || null;
}

function getPrecioMasCercano(producto) {
  // Find closest price in precios_mercado for this product
  // Returns price from key with closest month-year to today
  const hoy = new Date();
  const prefijo = normalizeStr(producto) + '_';
  let bestDiff = Infinity;
  let bestPrecio = null;
  Object.entries(precios).forEach(([key, precio]) => {
    if (!key.startsWith(prefijo)) return;
    const part = key.replace(prefijo, '');
    if (part === 'CONT') { bestPrecio = bestPrecio || precio; return; }
    const cols = part.split('_');
    if (cols.length !== 2) return;
    const mes = parseInt(cols[0]);
    const anio = parseInt(cols[1]);
    if (isNaN(mes) || isNaN(anio)) return;
    const fecha = new Date(anio, mes - 1, 1);
    const diff = Math.abs(fecha - hoy);
    if (diff < bestDiff) { bestDiff = diff; bestPrecio = precio; }
  });
  return bestPrecio;
}

function parseVencimientoMercado(vencimiento) {
  if (!vencimiento || vencimiento === 'CONT') return null;
  const raw = String(vencimiento).trim();

  let match = raw.match(/^(\d{1,2})_(\d{4})$/);
  if (match) {
    const mes = parseInt(match[1], 10);
    const anio = parseInt(match[2], 10);
    if (mes >= 1 && mes <= 12) return { mes, anio };
  }

  match = raw.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (match) {
    const anio = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10);
    if (mes >= 1 && mes <= 12) return { mes, anio };
  }

  return null;
}

function isExpiredMonthYear(mes, anio) {
  if (!mes || !anio || isNaN(mes) || isNaN(anio)) return false;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  return anio < currentYear || (anio === currentYear && mes < currentMonth);
}

// ── TAG FILTER ──
function getFilteredOps(options = {}) {
  const allCampaigns = !!options.allCampaigns;
  const requestedCampaign = normalizeCampaign(options.campaign);
  let scopedOps;
  if (requestedCampaign && requestedCampaign !== 'todas') {
    scopedOps = allOps.filter(op => getOperationCampaign(op) === requestedCampaign);
  } else {
    scopedOps = allCampaigns ? allOps : getCampaignOps();
  }
  if (!isAgriculturaPro()) {
    scopedOps = scopedOps.filter(op => !isProOnlyOperationType(op?.tipo));
  }
  if (!activeTagFilter.length) return scopedOps;
  // Intersección Y: op must have ALL active tags
  return scopedOps.filter(op => {
    const opTags = op.tags || [];
    return activeTagFilter.every(t => opTags.includes(t));
  });
}

// ── MOTOR DE CÁLCULO ──
const DERIVADOS_ENTREGABLES = ['Futuro','Call','Put'];

function isDerivadoEntregable(tipo) {
  return DERIVADOS_ENTREGABLES.includes(tipo);
}

function isOperacionEntregada(op) {
  return op?.entregado === true || op?.entregado === 1 || op?.entregado === 'true' || op?.entregado === '1';
}

function isOperacionVencida(op, refDate = new Date()) {
  if (!op?.vencimiento) return false;
  const d = new Date(op.vencimiento + 'T23:59:59');
  const ref = refDate instanceof Date ? refDate : new Date(String(refDate) + 'T23:59:59');
  return !Number.isNaN(d.getTime()) && !Number.isNaN(ref.getTime()) && d < ref;
}

function isEntregaEfectiva(op, refDate = new Date()) {
  return isOperacionEntregada(op) && isDerivadoEntregable(op?.tipo) && isOperacionVencida(op, refDate);
}

function getSignoBase(op) {
  return op?.lado === 'Compra' ? 1 : -1;
}

function getSignoOpcion(op) {
  if (op?.tipo === 'Put') return op?.lado === 'Compra' ? -1 : 1;
  return op?.lado === 'Compra' ? 1 : -1;
}

function isOpcionEjercible(op, pMercado) {
  if (!['Call','Put'].includes(op?.tipo)) return false;
  const pEj = Number(op.precio_ejercicio) || 0;
  if (pMercado === null || !pEj) return false;
  return op.tipo === 'Put' ? pMercado <= pEj : pMercado >= pEj;
}

function getPrecioEntregaDerivado(op) {
  if (!isDerivadoEntregable(op?.tipo)) return null;
  const pOp = Number(op.precio) || 0;
  const pEj = Number(op.precio_ejercicio) || 0;
  if (op.tipo === 'Futuro') return pOp || null;
  if (!pEj) return null;
  // Al entregar una opción, el precio físico netea la prima: compra resta, venta suma.
  return op.lado === 'Compra' ? (pEj - pOp) : (pEj + pOp);
}

function getEstadoDerivado(op) {
  if (!isDerivadoEntregable(op?.tipo)) return '';
  if (isEntregaEfectiva(op)) return 'entregado';
  if (isOperacionVencida(op)) return 'vencido';
  return 'vigente';
}

// Determina el signo L (Long=+1, Short=-1) para delta/precios promedio.
function calcularL(op, pMercado, refDate = new Date()) {
  const tipo = op.tipo;

  if (tipo === 'PAF') return 0;

  if (isEntregaEfectiva(op, refDate)) {
    return tipo === 'Futuro' ? getSignoBase(op) : getSignoOpcion(op);
  }

  // Los derivados vencidos no modifican delta ni precios promedio salvo que se marquen entregados.
  if (isDerivadoEntregable(tipo) && isOperacionVencida(op, refDate)) return 0;

  if (tipo === 'Call') return isOpcionEjercible(op, pMercado) ? getSignoOpcion(op) : 0;
  if (tipo === 'Put')  return isOpcionEjercible(op, pMercado) ? getSignoOpcion(op) : 0;

  return getSignoBase(op);
}

// Precio de mercado "congelado" del vencimiento: contrato EXACTO de
// precios_mercado (deja de actualizarse al vencer = último conocido).
// Si no existe el contrato exacto, cae al más cercano.
function getPrecioCongelado(op) {
  const prod = normalizeStr(op.producto);
  let vm = parseVencimientoMercado(op.vencimiento);
  if (!vm && op.vencimiento) {
    const d = new Date(op.vencimiento + 'T00:00:00');
    if (!isNaN(d.getTime())) vm = { mes: d.getMonth() + 1, anio: d.getFullYear() };
  }
  if (vm) {
    const exactKey = prod + '_' + vm.mes + '_' + vm.anio;
    if (exactKey in precios) return precios[exactKey];
  }
  return getPrecioMasCercano(prod);
}

// Precio para valuar el resultado financiero: congelado si ya venció
// (último precio conocido del contrato), de mercado actual si vigente.
function getPrecioValuacionFin(op, pMercado, refDate = new Date()) {
  return isOperacionVencida(op, refDate) ? getPrecioCongelado(op) : pMercado;
}

function calcularLFinanciero(op, pMercado, refDate = new Date()) {
  const tipo = op.tipo;
  if (!isDerivadoEntregable(tipo) || isEntregaEfectiva(op, refDate)) return 0;
  if (tipo === 'Futuro') return getSignoBase(op);
  // Ejercibilidad evaluada al precio de valuación (congelado si venció).
  const pEval = getPrecioValuacionFin(op, pMercado, refDate);
  return isOpcionEjercible(op, pEval) ? getSignoOpcion(op) : 0;
}

// Determina el precio efectivo para la valuación
function getPrecioEfectivo(op, pMercado, refDate = new Date()) {
  const tipo = op.tipo;
  if (isEntregaEfectiva(op, refDate)) return getPrecioEntregaDerivado(op);
  if (['Plan de Siembra','Stock'].includes(tipo)) return pMercado;
  if (tipo === 'Put' || tipo === 'Call') {
    const pEj = op.precio_ejercicio || 0;
    if (isOpcionEjercible(op, pMercado) && pEj > 0) return pEj;
  }
  return op.precio || 0;
}

// Calcula resultado financiero. Vigente = mark-to-market; vencido no
// entregado = CONGELADO al último precio del contrato; entregado = 0.
function getResultadoFinanciero(op, L, pMercado, refDate = new Date()) {
  const tipo = op.tipo;
  if (!isDerivadoEntregable(tipo)) return 0;
  const lFin = calcularLFinanciero(op, pMercado, refDate);
  if (lFin === 0) return 0;
  const pRef = (tipo === 'Call' || tipo === 'Put')
    ? (op.precio_ejercicio || 0)
    : (op.precio || 0);
  const pVal = getPrecioValuacionFin(op, pMercado, refDate);
  if (pVal === null) return 0;
  return (pVal - pRef) * op.volumen * lFin;
}

function calcularCartera(options = {}) {
  let valorLong = 0, valorShort = 0;
  let resFinLong = 0, resFinShort = 0;

  getFilteredOps(options).forEach(op => {
    const pM = getPrecioValuacionOp(op);
    const L  = calcularL(op, pM);
    const resFin = getResultadoFinanciero(op, L, pM);
    const lFin = calcularLFinanciero(op, pM);
    if (resFin) {
      if (lFin > 0) resFinLong += resFin;
      else          resFinShort += resFin;
    }
    if (L === 0) return;
    const pEf = getPrecioEfectivo(op, pM);
    if (pEf === null) return;
    const val = pEf * op.volumen;
    if (L > 0) valorLong  += val;
    else       valorShort += val;
  });

  const cartera   = valorLong  + resFinLong;
  const realizado = valorShort + resFinShort;
  return { cartera, realizado, pendiente: cartera - realizado };
}

function calcularPorProducto(options = {}) {
  const map = {};
  PRODUCTOS.forEach(p => {
    map[p] = { longVal:0, shortVal:0, longTn:0, shortTn:0,
               pCompra_num:0, pCompra_den:0, pVenta_num:0, pVenta_den:0,
               resFinLong:0, resFinShort:0,            // congelados (vencido no entregado)
               pCompra_num_adj:0, pVenta_num_adj:0,    // numeradores con congelado foldeado
               pMercado:null };
  });

  getFilteredOps(options).forEach(op => {
    const m  = map[op.producto];
    if (!m) return;
    const pM = getPrecioValuacionOp(op);
    if (m.pMercado === null && pM !== null) m.pMercado = pM;
    const L  = calcularL(op, pM);
    if (L !== 0) {
      const pEf = getPrecioEfectivo(op, pM);
      if (pEf === null) return;
      const vol = op.volumen;
      const val = pEf * vol;
      if (L > 0) {
        m.longVal += val; m.longTn += vol;
        m.pCompra_num += val; m.pCompra_den += vol;
      } else {
        m.shortVal += val; m.shortTn += vol;
        m.pVenta_num += val; m.pVenta_den += vol;
      }
    } else if (isDerivadoEntregable(op.tipo) && isOperacionVencida(op) && !isEntregaEfectiva(op)) {
      // Vencido NO entregado: fuera del delta; su resultado congelado se folda al precio.
      const resFin = getResultadoFinanciero(op, 0, pM);
      if (resFin !== 0) {
        if (calcularLFinanciero(op, pM) > 0) m.resFinLong  += resFin;
        else                                 m.resFinShort += resFin;
      }
    }
  });

  // Fold (opción B): un resultado + mejora el precio efectivo del lado.
  //   long:  pCompra_aj = (Σprecio·tn − resCongeladoLong)/tn  (menor costo = mejor)
  //   short: pVenta_aj  = (Σprecio·tn + resCongeladoShort)/tn (mayor venta = mejor)
  // Si no hay toneladas de ese lado, el congelado queda solo en los KPIs.
  PRODUCTOS.forEach(p => {
    const m = map[p];
    m.pCompra_num_adj = m.pCompra_num - (m.pCompra_den > 0 ? m.resFinLong  : 0);
    m.pVenta_num_adj  = m.pVenta_num  + (m.pVenta_den  > 0 ? m.resFinShort : 0);
  });
  return map;
}

// ── RENDER ALL ──
function renderAll() {
  try { if (window.renderOpciones) window.renderOpciones(); } catch(e){}
  try { if (window.mobRender) window.mobRender(); } catch(e){}
  // Sidebar info
  document.getElementById('s-nombre').textContent = currentCliente.nombre_empresa;
  document.getElementById('d-nombre').textContent = currentCliente.nombre_empresa;
  document.getElementById('d-meta').textContent   = `Reporte agrícola · ${getDashboardMode('agricultura', getClienteAccessState())} · Campaña ${activeCampaign || getLegacyCampaign()}`;
  const now = new Date();
  document.getElementById('s-fecha').textContent  = 'Actualizado: ' + now.toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'});
  renderCampaignTabs();

  // KPIs
  const {cartera,realizado,pendiente} = calcularCartera();
  document.getElementById('d-total').textContent     = fmtUSD(cartera);
  document.getElementById('d-realizado').textContent = fmtUSD(realizado);
  document.getElementById('d-pendiente').textContent = fmtUSD(pendiente);

  // Warning if no prices
  const warnEl = document.getElementById('no-precios-warn');
  if (warnEl) warnEl.style.display = Object.keys(precios).length === 0 ? 'block' : 'none';
  // Precios
  renderPrecios();
  // Tabla composición
  renderComposicion();
  renderBusinessUnits();
  // Ops table
  renderOps();
}

function renderPrecios() { renderTasas(); }

let _tasasProd = null;
let _tasasMoneda = 'usd'; // heatmap: 'usd' | 'ars'
let _tasasBanner = 'va';  // banner: 'va' | 'booster'
function _tasasToggleBanner(){ _tasasBanner = (_tasasBanner === 'booster') ? 'va' : 'booster'; refrescarTasas(); }

// ── Datos auxiliares para tasas en pesos y Valor Actual (TAMAR) ──
// DLR (a3_precios), dólar mayorista spot (tipo_de_cambio) y TAMAR (bcra_observaciones).
// Todas con lectura pública, así que se leen con la key publishable.
// Rango plausible de la TAMAR en % nominal anual. Mismo criterio que la guarda
// de la ingesta (edge function actualizar-bcra): ninguna tasa nominal anual
// argentina estuvo jamás por debajo de 0,5%, así que un valor menor es basura
// publicada aguas arriba, no un dato.
const TAMAR_MIN = 0.5, TAMAR_MAX = 500;

let mercadoAux = { dlr: {}, dlrPts: [], tamar: null, tamarFecha: null, tamarSalteo: 0,
                   spot: null, loaded: false, loading: false };

async function cargarMercadoAux() {
  if (mercadoAux.loading || typeof sb === 'undefined') return;
  mercadoAux.loading = true;
  try {
    const [dlrRes, tcRes, serieRes] = await Promise.all([
      sb.from('a3_precios').select('vencimiento,settlement_price,last_price').eq('subyacente','DLR').eq('es_opcion', false),
      sb.from('tipo_de_cambio').select('valor,fecha').order('fecha', { ascending:false }).limit(1),
      sb.from('bcra_series').select('id').eq('codigo','tamar_priv').limit(1),
    ]);
    const dlr = {}, pts = [];
    (dlrRes.data || []).forEach(r => {
      const px = r.settlement_price ?? r.last_price;
      if (px == null || !r.vencimiento) return;
      dlr[r.vencimiento] = Number(px);
      const [mes, anio] = r.vencimiento.split('_').map(Number);
      if (mes && anio) pts.push({ t: new Date(anio, mes-1, 15).getTime(), px: Number(px) });
    });
    pts.sort((a,b) => a.t - b.t);
    mercadoAux.dlr = dlr;
    mercadoAux.dlrPts = pts;
    mercadoAux.spot = tcRes.data?.[0]?.valor != null ? Number(tcRes.data[0].valor) : null;
    const serieId = serieRes.data?.[0]?.id;
    if (serieId) {
      // GUARDA: no se toma la última observación a ciegas, se toma la última
      // PLAUSIBLE. El 16/10/2026 el BCRA publicó TAMAR = 0 y la ingesta lo
      // escribió; como acá se leía `limit(1)`, ese único 0 apagó el descuento
      // del Valor Actual en todo el panel —VA = precio/(1+tamar·d/365) quedó
      // en VA = precio— sin que nada lo avisara. Una tasa nominal anual nunca
      // es 0: eso significa "hoy no hay dato", no "tasa cero".
      const obs = await sb.from('bcra_observaciones').select('valor,fecha')
        .eq('serie_id', serieId).order('fecha', { ascending:false }).limit(30);
      const filas = (obs.data || []).map(r => ({ valor: Number(r.valor), fecha: r.fecha }));
      const i = filas.findIndex(r => isFinite(r.valor) && r.valor >= TAMAR_MIN && r.valor <= TAMAR_MAX);
      mercadoAux.tamar       = i >= 0 ? filas[i].valor / 100 : null;   // % n.a. -> decimal
      mercadoAux.tamarFecha  = i >= 0 ? filas[i].fecha : null;
      mercadoAux.tamarSalteo = i > 0 ? i : 0;      // cuántas observaciones más nuevas se descartaron
      if (i > 0) {
        console.warn('[CTX] TAMAR: se descartaron ' + i + ' observación(es) fuera de rango; '
          + 'se usa la del ' + filas[i].fecha + ' (' + filas[i].valor + '% n.a.)',
          filas.slice(0, i));
      } else if (i < 0 && filas.length) {
        console.warn('[CTX] TAMAR: ninguna de las últimas ' + filas.length
          + ' observaciones es plausible. El Valor Actual no se calcula.');
      }
    }
    mercadoAux.loaded = true;
  } catch (e) { console.warn('mercadoAux:', e); }
  mercadoAux.loading = false;
  if (document.getElementById('d-tasas')) renderTasas();
}

// Interpola el DLR para un (mes, anio): exacto si existe; si no, lineal por fecha entre
// los vencimientos que lo rodean; plano fuera de los extremos. null si no hay curva.
function dlrInterp(mes, anio) {
  const pts = mercadoAux.dlrPts;
  if (!pts || !pts.length) return null;
  const exact = mercadoAux.dlr[`${mes}_${anio}`];
  if (exact != null) return exact;
  const t = new Date(anio, mes-1, 15).getTime();
  if (t <= pts[0].t) return pts[0].px;
  if (t >= pts[pts.length-1].t) return pts[pts.length-1].px;
  for (let i = 0; i < pts.length-1; i++) {
    if (t >= pts[i].t && t <= pts[i+1].t) {
      const f = (t - pts[i].t) / (pts[i+1].t - pts[i].t);
      return pts[i].px + f * (pts[i+1].px - pts[i].px);
    }
  }
  return null;
}

// ── Tasas implícitas: núcleo reutilizable (desktop + móvil) ──
function tasasByProd() {
  const CATEGORIAS_GAN = new Set(['Ternero','Novillo','Vaquillona','Vaca','Toro']);
  const byProd = {};
  Object.entries(precios).forEach(([key, precio]) => {
    const parts = key.split('_');
    const prod  = parts[0];
    if (CATEGORIAS_GAN.has(prod)) return;
    const venc  = parts.slice(1).join('_');
    if (!byProd[prod]) byProd[prod] = {};
    byProd[prod][venc] = precio;
  });
  return byProd;
}
// Solo Soja/Maíz/Trigo se muestran en solapas (los demás granos se calculan pero no se listan).
function tasasProductosVisibles(byProd) {
  const VIS = new Set(['Soja','Maiz','Trigo']);
  return Object.keys(byProd).filter(p => VIS.has(p)).sort();
}

// HTML del contenido (banner V.A. Max + nota TAMAR + tabla + heatmap) para un producto.
function buildTasasContentHTML(vencMap, useTNA, prod) {
  function tasaDirecta(pBase, pFut) { if (!pBase || !pFut || pBase === 0) return null; return (pFut - pBase) / pBase; }
  function mesesEntre(d1, d2) { return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()); }
  function toTNA(tDir, meses) { if (meses <= 0) return null; return tDir * (12 / meses); }
  function fmtTasa(t) { if (t === null || isNaN(t)) return '—'; return (t * 100).toFixed(1) + '%'; }
  function heatColor(t) {
    if (t === null || isNaN(t)) return 'var(--crema-d)';
    const pct = t * 100;
    if (pct < 0)   return 'rgba(217,81,44,0.75)';
    if (pct < 3)   return 'rgba(212,160,23,0.5)';
    if (pct < 8)   return 'rgba(212,160,23,0.75)';
    if (pct < 15)  return 'rgba(30,153,112,0.55)';
    return 'rgba(30,153,112,0.85)';
  }
  function heatTextColor(t) { if (t === null || isNaN(t)) return 'var(--gris)'; return '#fff'; }

  if (!vencMap) return '<div class="empty-state">Sin datos</div>';
  const basePrice = vencMap['CONT'] || null;
  const vencList = Object.entries(vencMap)
    .filter(([v]) => v !== 'CONT')
    .map(([v, p]) => {
      const parsed = parseVencimientoMercado(v);
      if (!parsed) return null;
      const { mes, anio } = parsed;
      return { key:v, mes, anio, precio:p, fecha: new Date(anio, mes-1, 1) };
    })
    .filter(v => v && !isExpiredMonthYear(v.mes, v.anio))
    .sort((a,b) => a.fecha - b.fecha);
  if (!vencList.length) return '<div class="empty-state">Sin vencimientos</div>';

  const today  = new Date();
  const spot   = mercadoAux.spot;
  const tamar  = mercadoAux.tamar;
  const pesoDe = (usd, mes, anio) => { const d = dlrInterp(mes, anio); return (usd != null && d != null) ? usd * d : null; };
  const diasA  = (f) => Math.max(0, Math.round((f - today) / 86400000));
  const vaDe   = (pv, d) => (pv != null && tamar != null) ? pv / (1 + tamar * d / 365) : null;
  const f0     = (n) => n == null ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const pesoBase = spot != null ? basePrice * spot : null;
  let maxVA = null, maxVALabel = null;

  // Cuando hubo que saltear observaciones rotas se muestra de cuándo es el dato
  // que se está usando: un número sin fecha no deja ver que la serie está parada.
  // Y si no hay ninguna válida se dice explícitamente, porque en ese caso la
  // columna de Valor Actual queda en "—" y si no el usuario no sabe por qué.
  const ddmm = (f) => { const p = String(f || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : f; };
  const tamarTxt = tamar != null
    ? `TAMAR <b>${(tamar*100).toFixed(1)}%</b> n.a.` + (
        (mercadoAux.tamarSalteo > 0 && mercadoAux.tamarFecha)
          ? ` <span style="color:#e0a63a" title="El BCRA publicó ${mercadoAux.tamarSalteo} dato(s) más reciente(s) fuera de rango. Se usa el último válido; el Valor Actual se calcula con esta tasa.">(al ${ddmm(mercadoAux.tamarFecha)})</span>`
          : '')
    : (mercadoAux.loaded
        ? `<span style="color:#e0a63a" title="Sin una TAMAR válida no se puede descontar: la columna de Valor Actual queda en —.">TAMAR <b>sin dato válido</b></span>`
        : '');

  const notaAux = `<div class="tasas-nota">${
    tamarTxt
  }${(tamarTxt && spot != null) ? ' · ' : ''}${
    spot != null ? `Dólar mayorista <b>$${f0(spot)}</b>` : ''
  }${!mercadoAux.loaded ? `${(tamarTxt||spot!=null)?' · ':''}<i>cargando dólar / TAMAR…</i>` : ''}</div>`;

  let tableInner = '';
  if (basePrice) {
    tableInner += `<table class="tasas-table">
      <thead><tr>
        <th>Posición</th><th>USD/tn</th><th>$/tn</th>
        <th>${useTNA ? 'TNA USD' : 'Dir. USD'}</th>
        <th>${useTNA ? 'TNA $' : 'Dir. $'}</th>
        <th>VA/tn $</th>
      </tr></thead>
      <tbody>
        <tr><td>Disponible</td>
          <td style="color:var(--oro-l);font-weight:700">$${basePrice}</td>
          <td style="color:var(--oro-l);font-weight:700">${pesoBase != null ? '$'+f0(pesoBase) : '—'}</td>
          <td>—</td><td>—</td><td>—</td></tr>`;
    vencList.forEach(v => {
      const meses = mesesEntre(today, v.fecha);
      const tUsd  = tasaDirecta(basePrice, v.precio);
      const pesoV = pesoDe(v.precio, v.mes, v.anio);
      const tArs  = (pesoBase && pesoV != null) ? tasaDirecta(pesoBase, pesoV) : null;
      const tUsdS = useTNA ? toTNA(tUsd, meses) : tUsd;
      const tArsS = tArs == null ? null : (useTNA ? toTNA(tArs, meses) : tArs);
      const vaV   = vaDe(pesoV, diasA(v.fecha));
      const cU = tUsdS !== null && tUsdS < 0 ? 'var(--rojo)' : tUsdS !== null && tUsdS > 0.05 ? 'var(--verde-l)' : 'var(--texto)';
      const cA = tArsS !== null && tArsS < 0 ? 'var(--rojo)' : tArsS !== null && tArsS > 0.05 ? 'var(--verde-l)' : 'var(--texto)';
      const label = v.mes + '/' + String(v.anio).slice(2);
      if (vaV != null && (maxVA == null || vaV > maxVA)) { maxVA = vaV; maxVALabel = label; }
      tableInner += `<tr>
        <td>${label}</td>
        <td style="color:var(--oro-l);font-weight:700">$${v.precio}</td>
        <td style="color:var(--oro-l);font-weight:700">${pesoV != null ? '$'+f0(pesoV) : '—'}</td>
        <td style="color:${cU};font-weight:700">${fmtTasa(tUsdS)}</td>
        <td style="color:${cA};font-weight:700">${fmtTasa(tArsS)}</td>
        <td>${vaV != null ? '$'+f0(vaV) : '—'}</td>
      </tr>`;
    });
    tableInner += '</tbody></table>';
  } else {
    tableInner += `<table class="tasas-table">
      <thead><tr><th>Posición</th><th>USD/tn</th><th>$/tn</th></tr></thead>
      <tbody>${vencList.map(v => { const pv = pesoDe(v.precio, v.mes, v.anio); return `<tr><td>${v.mes}/${String(v.anio).slice(2)}</td><td style="color:var(--oro-l);font-weight:700">$${v.precio}</td><td style="color:var(--oro-l);font-weight:700">${pv != null ? '$'+f0(pv) : '—'}</td></tr>`; }).join('')}</tbody>
    </table>`;
  }

  const tableHTML = notaAux + '<div class="tasas-scroll">' + tableInner + '</div>';

  // ── Banner: V.A. Máximo ⇄ Booster (se alterna con el cohete) ──
  const ROCKET = '<svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><path fill="#d4a017" d="M33.669,28.079c2.175,0.779,4.568-0.35,5.349-2.524c0.779-2.175-0.35-4.568-2.524-5.349 c-2.175-0.779-4.568,0.35-5.349,2.525C30.365,24.905,31.495,27.298,33.669,28.079z M35.634,22.6 c0.85,0.307,1.292,1.243,0.989,2.095c-0.307,0.85-1.243,1.292-2.095,0.989c-0.85-0.307-1.292-1.243-0.989-2.095 C33.846,22.738,34.783,22.297,35.634,22.6z"/><path fill="#d4a017" d="M25.445,34.175c-0.507-0.487-1.312-0.47-1.799,0.036L13.125,45.167 c-0.487,0.507-0.47,1.312,0.036,1.799c0.507,0.487,1.312,0.47,1.799-0.036l10.522-10.956 C25.968,35.467,25.952,34.662,25.445,34.175z"/><path fill="#d4a017" d="M16.449,35.405c-0.507-0.487-1.312-0.47-1.799,0.036l-4.52,4.706 c-0.487,0.507-0.47,1.312,0.036,1.799c0.507,0.487,1.312,0.47,1.799-0.036l4.52-4.706C16.972,36.697,16.956,35.892,16.449,35.405z"/><path fill="#d4a017" d="M40.904,40.842c-0.163-1.697-0.56-4.125-1.102-6.157c2.047-2.662,4.164-5.571,6.036-8.484 c2.054-3.2,3.81-6.377,4.841-9.245c0.584-1.634,0.942-3.171,0.94-4.61c-0.002-0.719-0.098-1.417-0.323-2.076 c-0.219-0.645-0.57-1.248-1.05-1.757l0.001-0.001l-0.012-0.013l-0.05-0.056l-0.056-0.049c-0.459-0.406-0.989-0.71-1.552-0.911 c-1.419-0.501-2.977-0.395-4.61,0.019c-2.859,0.739-6.077,2.478-9.398,4.657c-3.475,2.286-7.03,5.063-10.202,7.717 c-1.288-0.288-2.719-0.514-4.037-0.665c-0.783-0.089-1.519-0.153-2.155-0.187c-0.64-0.033-1.16-0.042-1.597-0.003 c-0.764,0.071-1.745,0.28-2.803,0.749c-1.055,0.469-2.184,1.206-3.176,2.32c-1.274,1.429-2.897,3.35-3.684,4.287l0,0 c-0.136,0.161-0.242,0.347-0.311,0.54c-0.162,0.452-0.127,0.931,0.061,1.337c0.185,0.407,0.547,0.759,1.01,0.923l0.031,0.011 l6.379,2.158l3.759,3.761c0.497,0.497,1.302,0.497,1.799,0c0.497-0.497,0.497-1.302,0-1.799l-3.056-3.057 c1.51-1.447,4.754-4.492,8.682-7.814c0.227-0.098,0.421-0.259,0.559-0.47c1.471-1.233,3.023-2.493,4.61-3.715 c3.429-2.642,7.014-5.101,10.154-6.691c1.567-0.796,3.024-1.37,4.255-1.654c1.235-0.289,2.216-0.269,2.871-0.028 c0.265,0.096,0.485,0.226,0.686,0.394c0.212,0.231,0.369,0.49,0.483,0.821c0.177,0.513,0.238,1.207,0.139,2.061 c-0.097,0.852-0.351,1.852-0.743,2.944c-0.918,2.566-2.592,5.628-4.587,8.729c-1.856,2.89-3.988,5.821-6.044,8.487 c-0.205,0.145-0.358,0.345-0.447,0.574c-1.101,1.415-2.175,2.754-3.162,3.954c-1.477,1.796-2.766,3.299-3.684,4.351 c-0.226,0.26-0.43,0.491-0.609,0.693l-3.179-2.929c-0.517-0.476-1.322-0.443-1.798,0.074c-0.476,0.517-0.443,1.322,0.074,1.798 l3.911,3.603l2.417,6.286c0.19,0.499,0.598,0.872,1.055,1.032c0.288,0.103,0.603,0.132,0.916,0.075 c0.312-0.056,0.623-0.205,0.87-0.433c0.904-0.825,2.758-2.525,4.134-3.856c1.172-1.134,1.887-2.41,2.3-3.564 c0.344-0.962,0.487-1.839,0.523-2.535C40.993,41.999,40.963,41.48,40.904,40.842z M14.447,28.78l-4.846-1.64 c0.841-0.994,1.977-2.323,2.9-3.359c0.726-0.815,1.539-1.344,2.312-1.688c0.77-0.344,1.502-0.495,2.001-0.54 c0.195-0.02,0.66-0.021,1.227,0.01c1.034,0.054,2.456,0.207,3.841,0.427c-0.467,0.405-0.926,0.806-1.364,1.194 C17.642,25.726,15.432,27.829,14.447,28.78z M36.38,46.707c-0.998,0.965-2.28,2.154-3.238,3.035l-1.836-4.775 c1.046-1.176,3.559-4.045,6.48-7.703c0.123,0.614,0.237,1.233,0.329,1.825c0.114,0.734,0.202,1.423,0.256,1.993 c0.055,0.565,0.072,1.03,0.06,1.225c-0.023,0.454-0.124,1.105-0.376,1.805C37.751,44.959,37.237,45.878,36.38,46.707z"/><path fill="#d4a017" d="M24.605,43.236c-0.507-0.487-1.312-0.47-1.799,0.037l-4.518,4.708 c-0.487,0.507-0.47,1.312,0.037,1.799c0.507,0.487,1.312,0.47,1.799-0.037l4.518-4.708C25.128,44.528,25.112,43.723,24.605,43.236z"/></svg>';
  const bst = (typeof window.calcularBooster === 'function' && prod) ? window.calcularBooster(prod) : null;
  const rocketBtn = `<button class="tasas-rocket${_tasasBanner==='booster'?' on':''}" onclick="_tasasToggleBanner()" title="${_tasasBanner==='booster'?'Ver V.A. Máximo':'Ver Booster'}">${ROCKET}</button>`;
  let vaMaxHTML = '';
  if (_tasasBanner === 'booster' && bst) {
    const pm = String(bst.pos.split('_')[0]).padStart(2,'0'), pa = String(bst.pos.split('_')[1]).slice(2);
    vaMaxHTML = `<div class="tasas-vamax booster">
      ${rocketBtn}
      <div style="flex:1"><div class="t">Booster</div><div class="p">POSICIÓN <b>${pm}/${pa}</b> · CIERRE <b>${f0(bst.cierre)}</b> <span style="color:var(--gris)">· ✕ ${(bst.probCierre*100).toFixed(0)}%</span>${bst.sintetico?' <span style="color:var(--gris)">· sintético</span>':''}</div></div>
      <div class="v">${f0(bst.duplo)}<span class="u">U$S / tn.</span></div>
      <button class="tasas-help" onclick="boosterDetalle('${prod}')" title="Cómo funciona la estrategia">?</button>
    </div>`;
  } else if (maxVA != null) {
    vaMaxHTML = `<div class="tasas-vamax">
      <div style="flex:1"><div class="t">V.A. Max.</div><div class="p">POSICIÓN <b>${maxVALabel}</b></div></div>
      <div class="v">$${f0(maxVA)}</div>
      ${bst ? rocketBtn : ''}
    </div>`;
  }

  const heatVenc = [];
  if (basePrice) heatVenc.push({ key:'CONT', label:'Disp', precioUsd:basePrice, precioArs:pesoBase, fecha:today });
  heatVenc.push(...vencList.map(v => ({ ...v, label: v.mes+'/'+String(v.anio).slice(2), precioUsd:v.precio, precioArs:pesoDe(v.precio, v.mes, v.anio) })));
  const moneda = _tasasMoneda;
  const pxDe = (x) => moneda === 'ars' ? x.precioArs : x.precioUsd;

  let heatHTML = '';
  if (heatVenc.length >= 2) {
    heatHTML = `<div class="heatmap-section">
      <div class="heatmap-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>Tasa implícita entre vencimientos (${useTNA ? 'TNA' : 'Directa'}) — ${moneda === 'ars' ? 'pesos' : 'dólares'}</span>
        <span class="tasas-cur">
          <button class="tasas-cur-btn ${moneda==='usd'?'on':''}" onclick="_tasasMoneda='usd';refrescarTasas()">USD</button>
          <button class="tasas-cur-btn ${moneda==='ars'?'on':''}" onclick="_tasasMoneda='ars';refrescarTasas()">$</button>
        </span>
      </div>
      <div style="overflow-x:auto">
      <table class="heatmap-table">
        <thead><tr>
          <th></th>
          ${heatVenc.map(v => `<th>${v.label}</th>`).join('')}
        </tr></thead>
        <tbody>`;
    heatVenc.forEach((vRow, ri) => {
      heatHTML += `<tr><th style="text-align:left;padding:3px 5px;color:var(--gris);font-size:9px">${vRow.label}</th>`;
      heatVenc.forEach((vCol, ci) => {
        if (ci === ri) {
          heatHTML += `<td class="hm-diag">—</td>`;
        } else if (ci < ri) {
          const pC = pxDe(vCol), pR = pxDe(vRow);
          const tDir  = (pC != null && pR != null) ? tasaDirecta(pC, pR) : null;
          const meses = mesesEntre(vCol.fecha, vRow.fecha);
          const t     = tDir == null ? null : (useTNA ? toTNA(tDir, meses) : tDir);
          heatHTML += `<td style="background:${heatColor(t)};color:${heatTextColor(t)}">${fmtTasa(t)}</td>`;
        } else {
          heatHTML += `<td class="hm-empty"></td>`;
        }
      });
      heatHTML += '</tr>';
    });
    heatHTML += '</tbody></table></div></div>';
  }

  return vaMaxHTML + tableHTML + heatHTML;
}

function renderTasas() {
  const el       = document.getElementById('d-tasas');
  const tabsEl   = document.getElementById('tasas-tabs');
  const useTNA   = document.getElementById('tasas-toggle')?.checked;
  const track    = document.getElementById('tasas-toggle-track');
  const thumb    = document.getElementById('tasas-toggle-thumb');
  if (track) track.style.background = useTNA ? 'var(--oro)' : 'var(--crema-dd)';
  if (thumb) thumb.style.left = useTNA ? '18px' : '2px';
  if (!el || !tabsEl) return;

  if (!Object.keys(precios).length) { el.innerHTML='<div class="empty-state">Sin precios cargados</div>'; return; }
  if (!mercadoAux.loaded && !mercadoAux.loading) cargarMercadoAux();

  const byProd = tasasByProd();
  const prods  = tasasProductosVisibles(byProd);
  if (!_tasasProd || !prods.includes(_tasasProd)) {
    _tasasProd = prods.find(p => p.toLowerCase() === 'soja') || prods[0];
  }
  tabsEl.innerHTML = prods.map(p =>
    `<button class="tasas-tab ${p===_tasasProd?'active':''}" onclick="_tasasProd='${p}';refrescarTasas()">${p}</button>`
  ).join('');
  el.innerHTML = buildTasasContentHTML(byProd[_tasasProd], useTNA, _tasasProd);
}

// Re-render de tasas en la vista activa (desktop y/o móvil).
function refrescarTasas() {
  if (document.getElementById('d-tasas')) renderTasas();
  if (typeof window.mobRenderTasas === 'function' && document.getElementById('mob-tasas')) window.mobRenderTasas();
}

function renderComposicion() {
  const map = calcularPorProducto();
  const labels=[], vals=[], colors=[];

  const buildRowsHTML = (sourceMap, collectChart = false) => PRODUCTOS.map(prod => {
    const m = sourceMap[prod];
    if (!m.longTn && !m.shortTn) return '';
    const neto    = m.longVal - m.shortVal;
    const netoTn  = m.longTn - m.shortTn;
    const delta   = calcDelta(m.longTn, m.shortTn);
    const pCompra = m.pCompra_den ? m.pCompra_num_adj/m.pCompra_den : null;
    const pVenta  = m.pVenta_den  ? m.pVenta_num_adj/m.pVenta_den   : null;
    const pos     = netoTn > 0 ? 'Long' : netoTn < 0 ? 'Short' : 'Neutro';
    const posClass= netoTn > 0 ? 'pos-long' : netoTn < 0 ? 'pos-short' : 'pos-neutro';
    const color   = COLORES_PROD[prod] || '#888';
    if (collectChart) {
      labels.push(prod); vals.push(Math.abs(neto)); colors.push(color);
    }
    return `<tr>
      <td><span class="prod-dot" style="background:${color}"></span>${prod}</td>
      <td>${fmtUSD(m.longVal)}</td>
      <td>${fmtUSD(m.shortVal)}</td>
      <td class="${neto>=0?'neto-pos':'neto-neg'}">${fmtUSD(neto)}</td>
      <td>${fmtTn(m.longTn)}</td>
      <td>${fmtTn(m.shortTn)}</td>
      <td class="${netoTn>=0?'neto-pos':'neto-neg'}">${fmtTn(netoTn)}</td>
      <td>${pCompra?fmtPrecio(pCompra):'—'}</td>
      <td>${pVenta?fmtPrecio(pVenta):'—'}</td>
      <td>${m.pMercado?fmtPrecio(m.pMercado):'—'}</td>
      <td>${delta.toFixed(3)}</td>
      <td><span class="${posClass}">${pos}</span></td>
    </tr>`;
  }).join('');

  const emptyProductRows = '<tr><td colspan="12" class="empty-state">Sin operaciones para el alcance seleccionado</td></tr>';
  const rowsHTML = buildRowsHTML(map, true);
  renderKpiCampaignFilter();
  const kpiOptions = kpiCampaignFilter === 'todas'
    ? { allCampaigns:true }
    : { campaign:kpiCampaignFilter };
  const kpiRowsHTML = buildRowsHTML(calcularPorProducto(kpiOptions), false) || emptyProductRows;

  const compBody = document.getElementById('d-comp-body');
  if (compBody) compBody.innerHTML = rowsHTML;

  const kpiBody = document.getElementById('kpi-comp-body');
  if (kpiBody) kpiBody.innerHTML = kpiRowsHTML;

  // Sunburst
  renderSunburst();
}

function setKpiCampaignFilter(value) {
  const next = normalizeCampaign(value);
  kpiCampaignFilter = next && next !== 'todas' ? next : 'todas';
  renderComposicion();
}

function renderKpiCampaignFilter() {
  const select = document.getElementById('kpi-campaign-select');
  const note = document.getElementById('kpi-campaign-note');
  const title = document.getElementById('kpi-detail-title');
  if (!select && !note && !title) return;

  refreshCampaignState(activeCampaign);
  if (kpiCampaignFilter !== 'todas' && !campaignTabs.includes(kpiCampaignFilter)) {
    kpiCampaignFilter = 'todas';
  }

  if (select) {
    select.innerHTML = '<option value="todas">Todas las campañas</option>' +
      campaignTabs.map(c => `<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)}</option>`).join('');
    select.value = kpiCampaignFilter;
  }

  const label = kpiCampaignFilter === 'todas' ? 'Todas las campañas' : `Campaña ${kpiCampaignFilter}`;
  if (title) title.textContent = `Detalle por producto · ${label}`;
  if (note) {
    note.textContent = kpiCampaignFilter === 'todas'
      ? 'Vista consolidada de todas las campañas.'
      : `Vista limitada a la campaña ${kpiCampaignFilter}.`;
  }
}

function calcDelta(longTn, shortTn) {
  const D = longTn - shortTn;
  if (D > 0 && longTn > 0)  return D / longTn;
  if (D < 0 && shortTn > 0) return D / shortTn;
  if (longTn > 0)  return 1;
  if (shortTn > 0) return -1;
  return 0;
}

function renderPie() { /* stub */ }

// ══ COMPOSICIÓN — DRILL-DOWN DONUT ══
const SB_PALETTES = {
  'Soja':      ['#2a5f84','#3d7aa8','#5b9ec9','#8bbedd','#b8d8ef'],
  'Maiz':      ['#236637','#2e8248','#3aaa60','#5ccc82','#90e8aa'],
  'Trigo':     ['#7a5010','#a87c0e','#d4a017','#f0ca60','#f8e4a0'],
  'Girasol':   ['#7a2222','#a83030','#d94040','#f08080','#f8b0b0'],
  'Sorgo':     ['#3d2880','#5535aa','#7b5bd4','#a98df0','#ccb8f8'],
  'Cebada':    ['#206060','#267a7a','#2ca0a0','#4cc4c4','#88dede'],
  'Realizado': ['#1e4466','#2a5f84','#3d7aa8','#5b9ec9','#8bbedd'],
  'Pendiente': ['#a87c0e','#d4a017','#f0ca60','#f8e4a0','#fcefc0'],
};
const SB_L0_COLORS = {'Soja':'#3d7aa8','Maiz':'#3aaa60','Trigo':'#d4a017','Girasol':'#d94040','Sorgo':'#7b5bd4','Cebada':'#2ca0a0'};
const SB_L1_COLORS = {'Realizado':'#2a5f84','Pendiente':'#d4a017'};

let _sb = null;

// Fixed dimensions — set once, reused always
const SB_W = 380, SB_H = 280, SB_LEGEND_W = 140;
const SB_CHART_SZ = SB_W - SB_LEGEND_W;   // 240
const SB_R  = SB_CHART_SZ / 2 - 8;        // outer radius
const SB_Ri = SB_R * 0.68;                 // inner radius — anillo delgado

function buildLevel0() {
  const items = [];
  PRODUCTOS.forEach(prod => {
    let val = 0;
    getFilteredOps().forEach(op => {
      if (op.producto !== prod) return;
      const pM = getPrecioValuacionOp(op);
      const L  = calcularL(op, pM); if (L === 0) return;
      const pEf = getPrecioEfectivo(op, pM); if (!pEf) return;
      val += Math.abs(pEf * op.volumen);
    });
    if (val > 0) items.push({ name:prod, value:val, hasChildren:true });
  });
  return items;
}
function buildLevel1(prod) {
  const g = {Realizado:0, Pendiente:0};
  getFilteredOps().forEach(op => {
    if (op.producto !== prod) return;
    const pM = getPrecioValuacionOp(op);
    const L  = calcularL(op, pM); if (L === 0) return;
    const pEf = getPrecioEfectivo(op, pM); if (!pEf) return;
    const val = Math.abs(pEf * op.volumen);
    if (L < 0) g.Realizado += val; else g.Pendiente += val;
  });
  return Object.entries(g).filter(([,v])=>v>0)
    .map(([name,value])=>({name,value,hasChildren:true,_prod:prod}));
}
function buildLevel2(prod, slot) {
  const tipos = {};
  getFilteredOps().forEach(op => {
    if (op.producto !== prod) return;
    const pM = getPrecioValuacionOp(op);
    const L  = calcularL(op, pM); if (L === 0) return;
    const pEf = getPrecioEfectivo(op, pM); if (!pEf) return;
    const val    = Math.abs(pEf * op.volumen);
    const opSlot = L < 0 ? 'Realizado' : 'Pendiente';
    if (opSlot !== slot) return;
    tipos[op.tipo||'Otro'] = (tipos[op.tipo||'Otro']||0) + val;
  });
  return Object.entries(tipos).filter(([,v])=>v>0)
    .map(([name,value])=>({name,value,hasChildren:false}));
}
function sbItemColor(item, level, index) {
  if (level === 0) return SB_L0_COLORS[item.name] || '#5b9ec9';
  if (level === 1) return SB_L1_COLORS[item.name] || '#5b9ec9';
  const prod = (_sb && _sb.parentChain[0]) || 'Soja';
  const pal  = SB_PALETTES[prod] || SB_PALETTES['Soja'];
  return pal[index % pal.length];
}

function renderSunburst() {
  // Use requestAnimationFrame to ensure container is laid out
  requestAnimationFrame(() => {
    const container = document.getElementById('sunburst-container');
    if (!container) return;
    const items = buildLevel0();
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">Sin operaciones</div>';
      return;
    }
    _sb = { level:0, parentChain:[] };
    _drawDonut(container, items, 0, [], false);
  });
}

function _drawDonut(container, items, level, parentChain, animate) {
  _sb = { level, parentChain, items };

  // Breadcrumb & back btn
  const crumbs = ['Cartera', ...parentChain];
  const bc  = document.getElementById('sunburst-breadcrumb');
  const btn = document.getElementById('sunburst-back');
  if (bc)  bc.textContent = crumbs.join(' › ');
  if (btn) btn.style.visibility = level > 0 ? 'visible' : 'hidden';

  const total = items.reduce((s,d) => s+d.value, 0);

  // Fixed arc generators
  const arcGen = d3.arc().innerRadius(SB_Ri).outerRadius(SB_R).cornerRadius(3);
  const arcBig = d3.arc().innerRadius(SB_Ri).outerRadius(SB_R + 7).cornerRadius(3);

  const pie = d3.pie().value(d=>d.value).sort(null).padAngle(0.022);
  const pieData = pie(items);

  const CX = SB_CHART_SZ / 2;   // chart centre x
  const CY = SB_H / 2;           // chart centre y

  function buildSVG(container) {
    const svg = d3.select(container).append('svg')
      .attr('width',  SB_W)
      .attr('height', SB_H)
      .attr('viewBox', `0 0 ${SB_W} ${SB_H}`)
      .style('display','block');

    // ── Donut group centred ──
    const g = svg.append('g')
      .attr('transform', `translate(${CX},${CY})`);

    // Center text
    const cName = g.append('text').attr('text-anchor','middle').attr('dy','-0.35em')
      .style('font-size','13px').style('font-weight','700')
      .style('font-family','DM Sans,sans-serif').style('fill','#dce8f5')
      .style('pointer-events','none');
    const cVal = g.append('text').attr('text-anchor','middle').attr('dy','1em')
      .style('font-size','10px')
      .style('font-family','DM Sans,sans-serif').style('fill','#7fa8c4')
      .style('pointer-events','none');
    const cPct = g.append('text').attr('text-anchor','middle').attr('dy','2.3em')
      .style('font-size','9px')
      .style('font-family','DM Sans,sans-serif').style('fill','#4e718a')
      .style('pointer-events','none');

    function resetCenter() {
      cName.text(parentChain.length ? parentChain[parentChain.length-1] : 'Total');
      cVal.text(fmtUSD(total));
      cPct.text('');
    }
    resetCenter();

    // ── Slices — animate in from zero angle ──
    const slices = g.selectAll('path')
      .data(pieData)
      .join('path')
      .attr('fill', (d,i) => sbItemColor(d.data, level, i))
      .attr('fill-opacity', 0.88)
      .attr('stroke', '#0d2035').attr('stroke-width', 1.5)
      .style('cursor', d => d.data.hasChildren ? 'pointer' : 'default');

    // Animate arcs growing from startAngle
    slices.each(function(d) {
      const node = d3.select(this);
      if (animate) {
        const interp = d3.interpolate(
          { startAngle: d.startAngle, endAngle: d.startAngle },
          { startAngle: d.startAngle, endAngle: d.endAngle }
        );
        node.attr('d', arcGen({ startAngle: d.startAngle, endAngle: d.startAngle }))
          .transition().duration(420).ease(d3.easeCubicOut)
          .attrTween('d', () => t => arcGen(interp(t)));
      } else {
        node.attr('d', arcGen(d));
      }
    });

    slices
      .on('mouseover', function(event, d) {
        d3.select(this).raise()
          .transition().duration(100)
          .attr('d', arcBig(d))
          .attr('fill-opacity', 1);
        const pct = total > 0 ? ((d.data.value/total)*100).toFixed(1) : '0';
        cName.text(d.data.name);
        cVal.text(fmtUSD(d.data.value));
        cPct.text(pct + '%');
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .transition().duration(100)
          .attr('d', arcGen(d))
          .attr('fill-opacity', 0.88);
        resetCenter();
      })
      .on('click', function(event, d) {
        if (!d.data.hasChildren) return;
        _drillDown(container, d.data, level, parentChain);
      });

    slices.append('title').text(d => {
      const path = [...parentChain, d.data.name].join(' › ');
      const pct  = total > 0 ? ((d.data.value/total)*100).toFixed(1) : '0';
      return `${path}\n${fmtUSD(d.data.value)} · ${pct}%`;
    });

    // ── Legend ──
    const legendLabels = ['Productos','Resultado','Tipo'];
    const legendG = svg.append('g')
      .attr('transform', `translate(${SB_CHART_SZ + 8}, ${CY - (items.length * 23)/2 + 6})`);

    legendG.append('text').attr('x',0).attr('y',-12)
      .style('font-size','10px').style('font-weight','700')
      .style('text-transform','uppercase').style('letter-spacing','.6px')
      .style('fill','#7fa8c4').style('font-family','DM Sans,sans-serif')
      .text(legendLabels[level] || '');

    items.forEach((item, i) => {
      const pct = total > 0 ? ((item.value/total)*100).toFixed(1) : '0';
      const col = sbItemColor(item, level, i);
      const y   = i * 28;
      legendG.append('rect').attr('x',0).attr('y',y-1)
        .attr('width',11).attr('height',11).attr('rx',2)
        .attr('fill',col).attr('fill-opacity',0.9);
      legendG.append('text').attr('x',13).attr('y',y+8)
        .style('font-size','12px').style('fill','#dce8f5').style('font-weight','600')
        .style('font-family','DM Sans,sans-serif').text(item.name);
      legendG.append('text').attr('x',13).attr('y',y+21)
        .style('font-size','10px').style('fill','#7fa8c4')
        .style('font-family','DM Sans,sans-serif')
        .text(`${pct}%  ${fmtUSD(item.value)}`);
    });

    return svg;
  }

  if (animate) {
    // Cross-fade: fade out old SVG, build new, fade in
    const oldSvg = container.querySelector('svg');
    if (oldSvg) {
      d3.select(oldSvg).transition().duration(180).style('opacity', 0)
        .on('end', function() {
          this.remove();
          buildSVG(container).style('opacity', 0)
            .transition().duration(220).style('opacity', 1);
        });
    } else {
      buildSVG(container).style('opacity', 0)
        .transition().duration(220).style('opacity', 1);
    }
  } else {
    container.innerHTML = '';
    buildSVG(container);
  }
}

function _drillDown(container, item, currentLevel, currentChain) {
  const newLevel = currentLevel + 1;
  const newChain = [...currentChain, item.name];
  let newItems;
  if (newLevel === 1) newItems = buildLevel1(item.name);
  else if (newLevel === 2) newItems = buildLevel2(currentChain[0], item.name);
  if (!newItems || !newItems.length) return;
  _drawDonut(container, newItems, newLevel, newChain, true);
}

function sunburstBack() {
  const container = document.getElementById('sunburst-container');
  if (!container || !_sb || _sb.level === 0) return;
  const newLevel = _sb.level - 1;
  const newChain = _sb.parentChain.slice(0, newLevel);
  let items;
  if (newLevel === 0) items = buildLevel0();
  else if (newLevel === 1) items = buildLevel1(newChain[0]);
  if (!items || !items.length) return;
  _drawDonut(container, items, newLevel, newChain, true);
}

function setOpsSort(field) {
  if (opsSort.field === field) {
    opsSort.dir = opsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    opsSort = { field, dir:'asc' };
  }
  renderOps();
}

function renderOpsSortIndicators() {
  document.querySelectorAll('[data-ops-sort]').forEach(th => {
    const active = opsSort.field === th.dataset.opsSort;
    th.classList.toggle('active', active);
    const ind = th.querySelector('.ops-sort-ind');
    if (ind) {
      ind.textContent = active ? (opsSort.dir === 'asc' ? '▲' : '▼') : '⇅';
      ind.classList.toggle('inactive', !active);
    }
  });
}

function parseOpsSortDate(value) {
  if (!value) return null;
  const str = String(value);
  // Acepta tanto 'YYYY-MM-DD' como un ISO completo
  const d = new Date(str.length <= 10 ? str + 'T00:00:00' : str);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function getOpsSortValue(row, field) {
  const op = row.op;
  if (field === 'fecha') return parseOpsSortDate(op.fecha);
  if (field === 'vencimiento') return parseOpsSortDate(op.vencimiento);
  if (field === 'volumen') return Number(op.volumen || 0);
  if (field === 'precio') return op.precio === null || op.precio === undefined || op.precio === '' ? null : Number(op.precio);
  if (field === 'mercado') return row.pM === null || row.pM === undefined ? null : Number(row.pM);
  if (field === 'resultado') return row.res === null || row.res === undefined ? null : Number(row.res);
  if (field === 'tags') return (op.tags || []).join(' ').toLowerCase();
  if (field === 'observaciones') return (op.observaciones || '').toLowerCase();
  return String(op[field] || '').toLowerCase();
}

function sortOpsRows(rows) {
  if (!opsSort.field) return rows;
  const dir = opsSort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = getOpsSortValue(a, opsSort.field);
    const vb = getOpsSortValue(b, opsSort.field);
    const aEmpty = va === null || va === undefined || va === '';
    const bEmpty = vb === null || vb === undefined || vb === '';
    if (aEmpty && bEmpty) return a.idx - b.idx;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), 'es', { numeric:true, sensitivity:'base' });
    }
    return cmp === 0 ? a.idx - b.idx : cmp * dir;
  });
}

function renderOps() {
  const filtered = getFilteredOps();
  const ops = filterProd === 'todos' ? filtered : filtered.filter(o => o.producto === filterProd);
  // Filters
  const prods = ['todos', ...new Set(getCampaignOps().map(o=>o.producto))];
  document.getElementById('d-filters').innerHTML = prods.map(p =>
    `<button class="filter-btn ${filterProd===p?'active':''}" onclick="setFilter('${p}')">${p==='todos'?'Todos':p}</button>`
  ).join('');
  renderOpsSortIndicators();

  const tbody = document.getElementById('d-ops-body');
  if (!ops.length) { tbody.innerHTML=`<tr><td colspan="12" class="empty-state">Sin operaciones confirmadas en la campaña ${activeCampaign || getLegacyCampaign()}</td></tr>`; return; }

  const rows = sortOpsRows(ops.map((op, idx) => {
    const pM  = getPrecioValuacionOp(op);
    const L   = calcularL(op, pM);
    const pEf = getPrecioEfectivo(op, pM);
    const res = getResultadoFinanciero(op, L, pM);
    return { op, idx, pM, L, pEf, res };
  }));

  tbody.innerHTML = rows.map(row => {
    const {op, pM, L, res} = row;
    const fVto = op.vencimiento ? new Date(op.vencimiento+'T00:00:00').toLocaleDateString('es-AR',{month:'short',year:'numeric'}) : '—';
    const fOp  = op.fecha ? new Date(op.fecha+'T00:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
    const ladoClass = op.lado==='Compra'?'pill-compra':'pill-venta';
    const ignorada  = L===0 && !res;
    const estadoDer = getEstadoDerivado(op);
    const estadoHtml = estadoDer === 'entregado'
      ? '<span class="badge-conf">Entregado</span>'
      : estadoDer === 'vencido'
        ? '<span class="badge-pend">Vencido</span>'
        : `<span class="${op.estado==='confirmada'?'badge-conf':'badge-pend'}">${op.estado==='confirmada'?'Confirmada':'Pendiente'}</span>`;
    return `<tr style="${ignorada?'opacity:.45':''}">
      <td style="color:var(--gris-l);font-size:12px">${fOp}</td>
      <td style="font-weight:600">${op.producto}</td>
      <td>${op.tipo}</td>
      <td><span class="pill ${ladoClass}">${op.lado}</span></td>
      <td>${fmtTn(op.volumen)}</td>
      <td>${op.precio?fmtPrecio(op.precio):'—'}</td>
      <td>${pM?fmtPrecio(pM):'—'}</td>
      <td>${fVto}</td>
      <td class="${res>0?'resultado-pos':res<0?'resultado-neg':''}">${res?fmtUSD(res):'—'}</td>
      <td>${(op.tags||[]).map(t=>`<span class="tag-pill tag-op">${t}</span>`).join(' ')||'—'}</td>
      <td>${estadoHtml}</td>
      <td style="font-size:11px;color:var(--gris);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${op.observaciones||''}">${op.observaciones||'—'}</td>
    </tr>`;
  }).join('');
}

function setFilter(prod) { filterProd=prod; renderOps(); }

// ── FORMULARIO NUEVA OP ──
function onTipoChange() {
  const tipo = document.getElementById('f-tipo').value;
  if (!isAgriculturaPro() && isProOnlyOperationType(tipo)) {
    document.getElementById('f-tipo').value = '';
    document.getElementById('grp-ejercicio').style.display = 'none';
    showAgricultureProOnlyPopup(tipo);
    return;
  }
  document.getElementById('grp-ejercicio').style.display = ['Call','Put'].includes(tipo)?'flex':'none';
}

function onEditTipoChange() {
  const tipoEl = document.getElementById('eop-tipo');
  const tipo = tipoEl?.value;
  if (!isAgriculturaPro() && isProOnlyOperationType(tipo)) {
    if (tipoEl) tipoEl.value = '';
    showAgricultureProOnlyPopup(tipo);
  }
  syncEditEntregaControl();
}

function resetForm() {
  ['f-producto','f-tipo','f-lado'].forEach(id => document.getElementById(id).value='');
  ['f-volumen','f-precio','f-vencimiento','f-ejercicio','f-obs'].forEach(id => document.getElementById(id).value='');
  document.getElementById('grp-ejercicio').style.display='none';
  // Deselect all tags
  document.querySelectorAll('#f-tags-selector .tag-selector-item').forEach(el => el.classList.remove('selected'));
  showToast('','');
  initFormDefaults();
}

function initFormDefaults() {
  const el = document.getElementById('f-fecha');
  if (el) el.value = new Date().toISOString().split('T')[0];
  // Poblar selector de producto con lista fija (no depender de allOps)
  const selectProducto = document.getElementById('f-producto');
  if (selectProducto) {
    selectProducto.innerHTML = '<option value="">Seleccioná...</option>' +
      PRODUCTOS.map(p => `<option value="${p}">${p}</option>`).join('');
  }
  const note = document.getElementById('campaign-form-note');
  if (note) note.textContent = `Las operaciones nuevas se guardarán en la campaña ${activeCampaign || getLegacyCampaign()}. Cambiá la pestaña superior para cargar o ver otra campaña.`;
}

function showToast(msg,type) {
  const el=document.getElementById('f-toast');
  if(!el) return;
  el.textContent=msg; el.className='form-toast'+(type?' '+type:'');
  el.style.display=msg?'block':'none';
}

async function guardarOperacion() {
  const producto    = document.getElementById('f-producto').value;
  const tipo        = document.getElementById('f-tipo').value;
  const lado        = document.getElementById('f-lado').value;
  const fecha       = document.getElementById('f-fecha').value;
  const volumen     = parseFloat(document.getElementById('f-volumen').value);
  const precio      = parseFloat(document.getElementById('f-precio').value)||0;
  const vencimiento = document.getElementById('f-vencimiento').value;
  const ejercicio   = parseFloat(document.getElementById('f-ejercicio').value)||0;
  const obs         = document.getElementById('f-obs').value.trim();
  
  // Tags seleccionados
  const selectedTags = Array.from(document.querySelectorAll('#f-tags-selector .tag-selector-item.selected')).map(el => el.dataset.tag);
  
  // Validaciones básicas
  if (!producto||!tipo||!lado||!fecha) { showToast('Completá los campos: Producto, Tipo, Lado y Fecha.','err'); return; }
  if (!isAgriculturaPro() && isProOnlyOperationType(tipo)) {
    showAgricultureProOnlyPopup(tipo);
    return;
  }
  if (isNaN(volumen)||volumen<=0) { showToast('El volumen debe ser mayor a 0.','err'); return; }
  if (!selectedTags.length) { showToast('Seleccioná al menos un tag.','err'); return; }
  
  // Vencimiento obligatorio para derivados
  const requireVencimiento = ['Call','Put','Forward','Futuro'].includes(tipo);
  if (requireVencimiento && !vencimiento) { 
    showToast('Vencimiento es obligatorio para ' + tipo,'err'); 
    return; 
  }
  
  // Precio de ejercicio obligatorio para opciones
  if (['Call','Put'].includes(tipo) && !ejercicio) {
    showToast('Precio de ejercicio es obligatorio para opciones','err');
    return;
  }
  
  const btn=document.getElementById('btn-guardar');
  btn.disabled=true; btn.textContent='Guardando...';
  const {error} = await insertOperacionWithCampaign({
    cliente_codigo:currentCliente.codigo, producto, tipo, lado, fecha,
    volumen, precio, vencimiento: vencimiento || null, precio_ejercicio:ejercicio, observaciones:obs, estado:'confirmada',
    tags: selectedTags,
    campania: activeCampaign || getLegacyCampaign()
  });
  btn.disabled=false; btn.textContent='Guardar operación';
  if (error) { showToast('Error: '+error.message,'err'); return; }
  showToast('✓ Operación guardada.','ok');
  resetForm();
  await refreshData();
  await cargarOpsGuardadas();
  renderFlujo();
  // Re-render tag selector so it's ready for next op
  renderTagsFormSelector();
}

async function cargarOpsGuardadas() {
  if (!sb||!currentCliente) return;
  await cargarOpsGuardadasConCache();
  renderOpsGuardadas();
}

function setOpsGuardadasSort(field) {
  if (opsGuardadasSort.field === field) {
    opsGuardadasSort.dir = opsGuardadasSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    opsGuardadasSort = { field, dir:'asc' };
  }
  renderOpsGuardadas();
}

function renderEntregaAction(idx, op) {
  if (!isDerivadoEntregable(op?.tipo)) return '<span style="color:var(--gris);font-size:11px">—</span>';
  if (!isOperacionVencida(op)) return '<span class="badge-pend">Vigente</span>';
  if (isOperacionEntregada(op)) {
    return '<button onclick="toggleEntregaOp('+idx+',false)" style="padding:4px 9px;border-radius:999px;border:1px solid rgba(30,153,112,.35);background:rgba(30,153,112,.13);color:var(--verde-l);font-size:11px;font-weight:700;cursor:pointer">Entregado</button>';
  }
  return '<button onclick="toggleEntregaOp('+idx+',true)" style="padding:4px 9px;border-radius:999px;border:1px solid rgba(212,160,23,.45);background:rgba(212,160,23,.13);color:var(--oro-l);font-size:11px;font-weight:700;cursor:pointer">Marcar entrega</button>';
}

async function toggleEntregaOp(idx, entregado) {
  const op = opsCache[parseInt(idx)];
  if (!op || !isDerivadoEntregable(op.tipo) || !isOperacionVencida(op)) return;
  if (entregado) {
    const precioEntrega = getPrecioEntregaDerivado({...op, entregado:true});
    const msg = 'Marcar como ENTREGADO computa esta operación como una operación a precio'
      + (precioEntrega ? ' de '+fmtPrecio(precioEntrega)+'/tn' : '')
      + ' y deja de contar su resultado financiero separado. ¿Continuar?';
    if (!confirm(msg)) return;
  }
  const {error} = await updateOperacionWithCampaign({
    entregado: !!entregado,
    updated_at: new Date().toISOString()
  }, op.id);
  if (error) {
    const extra = isMissingColumnError(error, 'entregado')
      ? '\n\nAntes ejecutá en Supabase: ALTER TABLE public.operaciones ADD COLUMN IF NOT EXISTS entregado boolean NOT NULL DEFAULT false;'
      : '';
    alert('Error al actualizar entrega: ' + error.message + extra);
    return;
  }
  await refreshData();
  await cargarOpsGuardadas();
  renderFlujo();
}

// Reusa getOpsSortValue (los items son {op, idx}). Solo se ordena por
// columnas presentes en esta tabla (fecha/producto/tipo/lado/volumen/
// precio/vencimiento), así que nunca toca pM/res.
function sortOpsGuardadasRows(items) {
  if (!opsGuardadasSort.field) return items;
  const dir = opsGuardadasSort.dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = getOpsSortValue(a, opsGuardadasSort.field);
    const vb = getOpsSortValue(b, opsGuardadasSort.field);
    const aEmpty = va === null || va === undefined || va === '';
    const bEmpty = vb === null || vb === undefined || vb === '';
    if (aEmpty && bEmpty) return a.idx - b.idx;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const cmp = (typeof va === 'number' && typeof vb === 'number')
      ? va - vb
      : String(va).localeCompare(String(vb), 'es', { numeric:true, sensitivity:'base' });
    return cmp === 0 ? a.idx - b.idx : cmp * dir;
  });
}

function renderOpsGuardadas() {
  const wrap = document.getElementById('ops-guardadas-wrap');
  if (!wrap) return;
  const data = opsCache || [];
  if (!data.length) {
    wrap.innerHTML='<div class="card empty-state">Todavía no hay operaciones cargadas.</div>';
    return;
  }
  // idx = posición en opsCache (la usan Editar/Eliminar) — se preserva al ordenar.
  const items = data
    .map((op, idx) => ({op, idx}))
    .filter(item => getOperationCampaign(item.op) === activeCampaign)
    .filter(item => isAgriculturaPro() || !isProOnlyOperationType(item.op?.tipo));
  if (!items.length) {
    wrap.innerHTML=`<div class="card empty-state">Todavía no hay operaciones cargadas en la campaña ${activeCampaign}.</div>`;
    return;
  }
  const rows = sortOpsGuardadasRows(items).map(({op, idx}) => {
    const fOp  = new Date(op.fecha+'T00:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'});
    const fVto = op.vencimiento ? new Date(op.vencimiento+'T00:00:00').toLocaleDateString('es-AR',{month:'short',year:'numeric'}) : '—';
    const lc   = op.lado==='Compra'?'pill-compra':'pill-venta';
    const btnEditar = '<button onclick="abrirEditarOp('+idx+')" style="padding:4px 10px;border-radius:6px;border:1px solid var(--crema-dd);background:var(--crema-d);color:var(--texto);font-size:11px;cursor:pointer;margin-right:4px">✎ Editar</button>';
    const btnElim   = '<button onclick="eliminarOp('+idx+')" style="padding:4px 10px;border-radius:6px;border:none;background:#fee2e2;color:#991b1b;font-size:11px;cursor:pointer">✕</button>';
    const entrega   = renderEntregaAction(idx, op);
    return '<tr>'
      +'<td style="color:var(--gris);font-size:12px">'+fOp+'</td>'
      +'<td style="font-weight:600">'+op.producto+'</td>'
      +'<td>'+op.tipo+'</td>'
      +'<td><span class="pill '+lc+'">'+op.lado+'</span></td>'
      +'<td>'+Number(op.volumen).toLocaleString('es-AR')+' tn</td>'
      +'<td style="font-weight:600;color:var(--verde)">'+(op.precio>0?'$'+Number(op.precio).toFixed(1)+'/tn':'—')+'</td>'
      +'<td>'+fVto+'</td>'
      +'<td>'+entrega+'</td>'
      +'<td style="white-space:nowrap">'+btnEditar+btnElim+'</td>'
      +'</tr>';
  }).join('');
  const cols = [['fecha','Fecha'],['producto','Producto'],['tipo','Tipo'],['lado','Lado'],['volumen','Volumen'],['precio','Precio'],['vencimiento','Vto.']];
  const thHtml = cols.map(([f,label]) => {
    const active = opsGuardadasSort.field === f;
    const ind = active ? (opsGuardadasSort.dir==='asc'?'▲':'▼') : '⇅';
    return '<th class="sortable'+(active?' active':'')+'" onclick="setOpsGuardadasSort(\''+f+'\')">'+label
      +' <span class="ops-sort-ind'+(active?'':' inactive')+'">'+ind+'</span></th>';
  }).join('') + '<th>Entrega</th><th>Acciones</th>';
  wrap.innerHTML = '<div class="card ops-table-wrap"><table class="ops-table">'
    +'<thead><tr>'+thHtml+'</tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>';
}

async function cargarOpsGuardadasConCache() {
  if (!sb || !currentCliente) return [];
  const {data} = await sb.from('operaciones').select('*')
    .eq('cliente_codigo', currentCliente.codigo)
    .order('created_at', {ascending:false}).limit(500);
  // Ensure tags field is always an array
  opsCache = (data || []).map(op => ({...op, tags: Array.isArray(op.tags) ? op.tags : (op.tags ? [op.tags] : ['DFL'])}));
  return opsCache;
}

function getEditOperacionDraft() {
  return {
    tipo: document.getElementById('eop-tipo')?.value || '',
    lado: document.getElementById('eop-lado')?.value || '',
    vencimiento: document.getElementById('eop-vencimiento')?.value || '',
    precio: parseFloat(document.getElementById('eop-precio')?.value) || 0,
    precio_ejercicio: parseFloat(document.getElementById('eop-ejercicio')?.value) || 0,
    entregado: document.getElementById('eop-entregado')?.checked || false
  };
}

function syncEditEntregaControl(op = getEditOperacionDraft()) {
  const grp = document.getElementById('grp-eop-entregado');
  const chk = document.getElementById('eop-entregado');
  const preview = document.getElementById('eop-entrega-preview');
  if (!grp || !chk) return;
  const visible = isDerivadoEntregable(op.tipo) && isOperacionVencida(op);
  grp.style.display = visible ? 'block' : 'none';
  if (!visible) {
    chk.checked = false;
    if (preview) preview.textContent = '';
    return;
  }
  chk.checked = isOperacionEntregada(op);
  if (preview) {
    const precioEntrega = getPrecioEntregaDerivado({...op, entregado:true});
    preview.textContent = precioEntrega
      ? 'Al entregarse computa como operación a precio de '+fmtPrecio(precioEntrega)+'/tn y elimina el resultado financiero separado.'
      : 'Al entregarse elimina el resultado financiero separado y computa como operación a precio.';
  }
}

function abrirEditarOp(idx) {
  const op = opsCache[parseInt(idx)];
  if (!op) return;
  
  // Poblar productos con lista fija
  const selectProducto = document.getElementById('eop-producto');
  selectProducto.innerHTML = PRODUCTOS.map(p => `<option value="${p}">${p}</option>`).join('');
  
  document.getElementById('eop-id').value         = op.id;
  document.getElementById('eop-producto').value   = op.producto;
  document.getElementById('eop-tipo').value        = op.tipo;
  document.getElementById('eop-lado').value        = op.lado;
  document.getElementById('eop-fecha').value       = op.fecha;
  document.getElementById('eop-volumen').value     = op.volumen;
  document.getElementById('eop-precio').value      = op.precio || '';
  document.getElementById('eop-vencimiento').value = op.vencimiento;
  document.getElementById('eop-ejercicio').value   = op.precio_ejercicio || '';
  document.getElementById('eop-obs').value         = op.observaciones || '';
  syncEditEntregaControl(op);
  // Get tags: try allOps first (has normalized data), fallback to opsCache
  const opFull = allOps.find(o => String(o.id) === String(op.id));
  const opTags = (opFull ? opFull.tags : op.tags) || ['DFL'];
  abrirEditarOpTags({...op, tags: Array.isArray(opTags) ? opTags : ['DFL']});
  const modal = document.getElementById('editOpModal');
  modal.style.display = 'flex';
}

function cerrarEditarOp() {
  document.getElementById('editOpModal').style.display = 'none';
}

async function guardarEditOp() {
  const id = document.getElementById('eop-id').value;
  const producto = document.getElementById('eop-producto').value;
  const tipo = document.getElementById('eop-tipo').value;
  const lado = document.getElementById('eop-lado').value;
  const fecha = document.getElementById('eop-fecha').value;
  const volumen = parseFloat(document.getElementById('eop-volumen').value);
  const vencimiento = document.getElementById('eop-vencimiento').value;
  const precio = parseFloat(document.getElementById('eop-precio').value) || 0;
  const ejercicio = parseFloat(document.getElementById('eop-ejercicio').value) || 0;
  
  // Validaciones
  if (!producto) { alert('Selecciona un producto'); return; }
  if (!tipo) { alert('Selecciona un tipo de operación'); return; }
  if (!isAgriculturaPro() && isProOnlyOperationType(tipo)) {
    showAgricultureProOnlyPopup(tipo);
    return;
  }
  if (!lado) { alert('Selecciona un lado (Compra/Venta)'); return; }
  if (!fecha) { alert('Selecciona una fecha de operación'); return; }
  if (!volumen || volumen <= 0) { alert('Ingresa un volumen válido (mayor a 0)'); return; }
  
  // Vencimiento obligatorio para derivados
  const requireVencimiento = ['Call','Put','Forward','Futuro'].includes(tipo);
  if (requireVencimiento && !vencimiento) { 
    alert('Vencimiento es obligatorio para ' + tipo); 
    return; 
  }
  
  // Precio de ejercicio obligatorio para opciones
  if (['Call','Put'].includes(tipo) && !ejercicio) {
    alert('Precio de ejercicio es obligatorio para opciones');
    return;
  }
  
  const editTags = Array.from(document.querySelectorAll('#eop-tags-selector .tag-selector-item.selected')).map(el => el.dataset.tag);
  const payload = {
    producto:         producto,
    tipo:             tipo,
    lado:             lado,
    fecha:            fecha,
    volumen:          volumen,
    precio:           precio,
    vencimiento:      vencimiento || null,
    precio_ejercicio: ejercicio,
    observaciones:    document.getElementById('eop-obs').value,
    tags:             editTags.length ? editTags : ['DFL'],
    campania:         activeCampaign || getLegacyCampaign(),
    updated_at:       new Date().toISOString()
  };
  payload.entregado = !!document.getElementById('eop-entregado')?.checked;
  const {error} = await updateOperacionWithCampaign(payload, id);
  if (error) {
    const extra = isMissingColumnError(error, 'entregado')
      ? '\n\nAntes ejecutá en Supabase: ALTER TABLE public.operaciones ADD COLUMN IF NOT EXISTS entregado boolean NOT NULL DEFAULT false;'
      : '';
    alert('Error al guardar: ' + error.message + extra);
    return;
  }
  cerrarEditarOp();
  await refreshData();
  await cargarOpsGuardadas();
  renderFlujo();
  renderTagsFormSelector();
}

async function eliminarOp(idx) {
  const op = opsCache[parseInt(idx)];
  if (!op) return;
  if (!confirm('¿Eliminar esta operación? Esta acción no se puede deshacer.')) return;
  const {error} = await sb.from('operaciones').delete().eq('id', op.id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  await refreshData();
  await cargarOpsGuardadas();
  renderFlujo();
}

// ── REFRESH ──
async function refreshData() {
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.textContent = '↻ Actualizando...'; btn.disabled = true; }
  const [opsRes, preciosRes, cliRes] = await Promise.all([
    sb.from('operaciones').select('*')
      .eq('cliente_codigo', currentCliente.codigo)
      .eq('estado','confirmada')
      .order('created_at', {ascending:false}),
    sb.from('precios_mercado').select('*').eq('activo',true).order('updated_at',{ascending:false}),
    sb.from('clientes').select('*').eq('id', currentUser.id).single()
  ]);
  if (cliRes.data) {
    currentCliente = cliRes.data;
    // Solo actualizar tagsDisponibles desde DB si no tenemos tags en memoria
    // (evita que un null de Supabase pise tags recién guardados)
    const dbTags = Array.isArray(cliRes.data.tags_disponibles)
      ? cliRes.data.tags_disponibles.filter(t => typeof t === 'string' && t.trim().length > 0)
      : [];
    if (dbTags.length > 0) {
      tagsDisponibles = dbTags;
    }
    // Si dbTags está vacío pero tagsDisponibles ya tiene datos, los conservamos
  }
  const normalize = s => {
    if (!s) return s;
    return s.normalize('NFD').replace(/[̀-ͯ]/g,'');
  };
  allOps = (opsRes.data || []).map(op => ({...op, producto: normalize(op.producto)}));
  refreshCampaignState(activeCampaign);
  buildPreciosMap(preciosRes.data || []);
  renderTagFilterBar();
  renderTagsFormSelector();
  renderAll();
  renderFlujo();
  renderPosicionesChart();
  renderEvolucion();
  await cargarOpsGuardadas();
  if (btn) { btn.textContent = '↻ Actualizar datos'; btn.disabled = false; }
}

// ── UTILS ──
function showLoading(s) {
  document.getElementById('loadingScreen').style.display = s?'flex':'none';
}
function toggleSeccion(secId, iconId) {
  const sec = document.getElementById(secId);
  if (!sec) return;
  const icon = document.getElementById(iconId);
  const hijos = Array.prototype.slice.call(sec.children).slice(1);   // todo menos el título
  const estabaOculto = hijos.length > 0 && hijos[0].dataset.ctxOculto === '1';
  hijos.forEach(function (el) {
    if (estabaOculto) { el.style.display = el.dataset.ctxDisplay || ''; delete el.dataset.ctxOculto; }
    else { el.dataset.ctxDisplay = el.style.display || ''; el.style.display = 'none'; el.dataset.ctxOculto = '1'; }
  });
  if (icon) icon.style.transform = estabaOculto ? '' : 'rotate(180deg)';
}


// Operaciones y Opciones arrancan plegadas: el panel abre más liviano y el
// usuario despliega lo que necesita. Se hace una sola vez, al cargar.
function ctxPlegarSeccionesIniciales(){
  ['operaciones','opciones'].forEach(function(nombre){
    var sec = document.getElementById('sec-' + nombre);
    if (!sec || sec.dataset.ctxPlegadoInicial === '1') return;
    sec.dataset.ctxPlegadoInicial = '1';
    toggleSeccion('sec-' + nombre, 'icon-' + nombre);
  });
}
document.addEventListener('DOMContentLoaded', function(){ setTimeout(ctxPlegarSeccionesIniciales, 100); });

function toggleAcc(id, iconId) {
  const el   = document.getElementById(id);
  const icon = document.getElementById(iconId);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (icon) icon.style.transform = open ? 'rotate(180deg)' : '';
}

function fmtUSD(n) {
  const abs = Math.abs(n);
  const sign = n<0?'-':'';
  if(abs>=1000000) return sign+'USD '+( abs/1000000).toFixed(2)+'M';
  if(abs>=1000)    return sign+'USD '+(abs/1000).toFixed(1)+'k';
  return sign+'USD '+abs.toLocaleString('es-AR',{minimumFractionDigits:0,maximumFractionDigits:0});
}
function fmtTn(n) { return n?Number(n).toLocaleString('es-AR'):'0'; }
function fmtPrecio(n) { return n?'$'+Number(n).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}
function escapeHtmlAttr(value) {
  return escapeHtml(value);
}


// ══ SISTEMA DE TAGS ══

function renderTagFilterBar() {
  const el = document.getElementById('hero-tag-filters');
  if (!el) return;
  // Always sync from currentCliente as source of truth
  if (currentCliente?.tags_disponibles?.length && !tagsDisponibles.length) {
    tagsDisponibles = [...currentCliente.tags_disponibles];
  }
  if (!tagsDisponibles.length) {
    el.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,.25);font-style:italic">sin tags — configurá uno para filtrar</span>';
    return;
  }
  el.innerHTML = tagsDisponibles.map(t => {
    const isActive = activeTagFilter.includes(t);
    return `<button class="tag-pill${isActive?' active':''}" onclick="toggleTagFilter('${t}')">${t}</button>`;
  }).join('');
}

function toggleTagFilter(tag) {
  const idx = activeTagFilter.indexOf(tag);
  if (idx >= 0) activeTagFilter.splice(idx, 1);
  else          activeTagFilter.push(tag);
  renderTagFilterBar();
  renderAll();
  renderFlujo();
  renderPosicionesChart();
  renderEvolucion();
}

function renderTagsFormSelector() {
  const el = document.getElementById('f-tags-selector');
  if (!el) return;
  // Sync from currentCliente if tagsDisponibles is empty
  if (currentCliente?.tags_disponibles?.length && !tagsDisponibles.length) {
    tagsDisponibles = [...currentCliente.tags_disponibles];
  }
  el.innerHTML = tagsDisponibles.length
    ? tagsDisponibles.map(t =>
        `<span class="tag-selector-item" data-tag="${t}" onclick="toggleTagFormItem(this)">${t}</span>`
      ).join('')
    : '<span style="font-size:11px;color:var(--gris-l)">Sin tags — creá uno con ⚙ gestionar</span>';
}

function toggleTagFormItem(el) {
  const items = document.querySelectorAll('#f-tags-selector .tag-selector-item.selected');
  if (!el.classList.contains('selected') && items.length >= 10) return;
  el.classList.toggle('selected');
}

// ── MODAL GESTIÓN DE TAGS ──
function abrirGestionTags(obligatorio = false) {
  const existing = document.getElementById('modal-tags');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-tags';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${obligatorio ? '⚡ Configurá tus tags antes de continuar' : '⚙ Gestionar tags'}</div>
      <div class="modal-sub">${obligatorio
        ? 'Los tags te permiten segmentar y filtrar tu cartera. Creá al menos uno (3 letras mayúsculas) para poder cargar operaciones.'
        : 'Administrá tus tags de cartera. Cada operación debe tener al menos uno. Máx. 10 tags por cartera.'
      }</div>
      <div class="tag-input-row">
        <input type="text" id="nuevo-tag-input" class="tag-input" maxlength="3" placeholder="DFL" 
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,'')"
          onkeydown="if(event.key==='Enter')agregarTag()">
        <button onclick="agregarTag()" style="padding:9px 16px;background:var(--oro);color:var(--negro-b);border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">+ Agregar</button>
      </div>
      <div id="tags-actuales" class="tag-current"></div>
      <div id="tag-modal-error" style="font-size:11px;color:var(--rojo);margin-top:8px;display:none"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        ${obligatorio ? '' : '<button onclick="cerrarModalTags()" style="padding:10px 18px;background:transparent;border:1px solid var(--crema-dd);color:var(--gris);border-radius:8px;cursor:pointer;font-family:sans-serif">Cancelar</button>'}
        <button onclick="guardarTags(${obligatorio})" style="padding:10px 22px;background:var(--oro);color:var(--negro-b);border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:sans-serif">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderTagsActualesModal();
  // Focus input
  setTimeout(() => document.getElementById('nuevo-tag-input')?.focus(), 100);
}

function renderTagsActualesModal() {
  const el = document.getElementById('tags-actuales');
  if (!el) return;
  const temp = window._tempTags || [...tagsDisponibles];
  window._tempTags = temp;
  el.innerHTML = temp.length
    ? temp.map((t,i) => `<span class="tag-remove" onclick="eliminarTagTemp(${i})">${t} ✕</span>`).join('')
    : '<span style="font-size:11px;color:var(--gris-l)">Sin tags aún</span>';
}

function agregarTag() {
  const input = document.getElementById('nuevo-tag-input');
  const errEl = document.getElementById('tag-modal-error');
  const val   = (input?.value || '').toUpperCase().trim();
  const temp  = window._tempTags || [...tagsDisponibles];
  if (val.length !== 3) { errEl.textContent='El tag debe tener exactamente 3 letras.'; errEl.style.display='block'; return; }
  if (temp.includes(val)) { errEl.textContent='Ese tag ya existe.'; errEl.style.display='block'; return; }
  if (temp.length >= 10) { errEl.textContent='Máximo 10 tags por cartera.'; errEl.style.display='block'; return; }
  errEl.style.display='none';
  temp.push(val);
  window._tempTags = temp;
  if (input) input.value = '';
  renderTagsActualesModal();
}

function eliminarTagTemp(idx) {
  const temp = window._tempTags || [...tagsDisponibles];
  temp.splice(idx, 1);
  window._tempTags = temp;
  renderTagsActualesModal();
}

async function guardarTags(obligatorio = false) {
  const errEl = document.getElementById('tag-modal-error');
  const temp  = window._tempTags || [];
  if (obligatorio && !temp.length) {
    errEl.textContent = 'Necesitás al menos un tag para continuar.';
    errEl.style.display = 'block';
    return;
  }
  const { error } = await sb.from('clientes')
    .update({ tags_disponibles: temp })
    .eq('id', currentUser.id);
  if (error) { errEl.textContent = 'Error al guardar: ' + error.message; errEl.style.display='block'; return; }
  // Update in memory immediately — filter invalid tags
  const cleanTags = temp.filter(t => typeof t === 'string' && t.trim().length > 0);
  tagsDisponibles = [...cleanTags];
  if (currentCliente) currentCliente.tags_disponibles = [...cleanTags];
  window._tempTags = null;
  cerrarModalTags();
  renderTagFilterBar();
  renderTagsFormSelector();
}

function cerrarModalTags() {
  window._tempTags = null;
  const modal = document.getElementById('modal-tags');
  if (modal) modal.remove();
}

// ── EDIT OP: include tags ──
function abrirEditarOpTags(op) {
  const el = document.getElementById('eop-tags-selector');
  if (!el) return;
  const opTags = Array.isArray(op.tags) ? op.tags : ['DFL'];
  // Always wipe and re-render to avoid stale state from previous modal open
  el.innerHTML = '';
  if (!tagsDisponibles.length) {
    el.innerHTML = '<span style="font-size:11px;color:var(--gris-l)">Sin tags configurados</span>';
    return;
  }
  el.innerHTML = tagsDisponibles.map(t =>
    `<span class="tag-selector-item${opTags.includes(t)?' selected':''}" data-tag="${t}" onclick="toggleTagFormItem(this)">${t}</span>`
  ).join('');
}

// ── SIDEBAR COLLAPSE ──
function toggleCollapse() {
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('btn-collapse');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  btn.textContent   = isCollapsed ? '›' : '‹';
  btn.title         = isCollapsed ? 'Expandir menú' : 'Colapsar menú';
  // Toggle logout icon vs text
  const lbl = sidebar.querySelector('.btn-logout .nav-label');
  const ico = sidebar.querySelector('.btn-logout .logout-icon');
  if (lbl) lbl.style.display = isCollapsed ? 'none' : '';
  if (ico) ico.style.display = isCollapsed ? 'inline' : 'none';
  // Resize charts after CSS transition (250ms)
  setTimeout(() => {
    try { if (_evolucionChartHero) _evolucionChartHero.resize(); } catch(e) {}
    try { if (evolucionChart)      evolucionChart.resize();      } catch(e) {}
    try { if (posicionesChart)     posicionesChart.resize();     } catch(e) {}
    try { if (flujoChart)          flujoChart.resize();          } catch(e) {}
  }, 280);
}

// ── NAVEGACIÓN ──
function navTo(section, el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  const map = {
    'resumen':     'sec-resumen',
    'paneles':     'sec-portal',
    'precios':     'sec-precios',
    'composicion': 'sec-composicion',
    'operaciones': 'sec-operaciones',
    'flujo':       'sec-flujo',
  };
  const target = document.getElementById(map[section]);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  closeSidebar();
}
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ══ GRÁFICO POSICIONES ══
let posicionesChart = null;
let histData = [];
let chartPeriod = '6M';

async function loadHistoricos() {
  // Load all historical data in batches to bypass Supabase 1000-row default limit
  let allData = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const {data, error} = await sb.from('precios_historicos')
      .select('*')
      .order('fecha', {ascending: true})
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break; // last batch
    from += batchSize;
  }
  histData = allData;
  actualizarFiltroPos();
  renderPosicionesChart();
  renderEvolucion();
  // El Booster valúa strikes sin prima con la volatilidad histórica que sale de
  // histData: hasta que la serie no está, no puede calcularse. Se refresca Tasas
  // para que el cohete aparezca apenas los datos están disponibles.
  try { if (typeof _volHistCacheReset === 'function') _volHistCacheReset(); } catch (e) {}
  try { if (typeof refrescarTasas === 'function') refrescarTasas(); } catch (e) {}
}

function actualizarFiltroPos() {
  const prod = document.getElementById('chart-prod').value;
  const sel  = document.getElementById('chart-pos');
  const current = sel.value;
  // Get unique posiciones for selected product
  const posiciones = [...new Set(
    histData
      .filter(r => !prod || r.producto === prod)
      .map(r => r.posicion)
  )].sort();
  sel.innerHTML = '<option value="">Todos los vencimientos</option>'
    + posiciones.map(p => '<option value="'+p+'">'+p+'</option>').join('');
  if (posiciones.includes(current)) sel.value = current;
}

const SLIDER_PERIODS = ['1M', '3M', '6M', '1Y', 'ALL'];
const SLIDER_LABELS  = ['1 mes', '3 meses', '6 meses', '1 año', 'Todo'];

function onSliderChange(val) {
  const idx = parseInt(val) - 1;
  chartPeriod = SLIDER_PERIODS[idx];
  const label = document.getElementById('chart-period-label');
  if (label) label.textContent = SLIDER_LABELS[idx];
  renderPosicionesChart();
}

function getDateRange() {
  const now = new Date();
  const from = new Date(now);
  if      (chartPeriod === '1M')  from.setMonth(from.getMonth()-1);
  else if (chartPeriod === '3M')  from.setMonth(from.getMonth()-3);
  else if (chartPeriod === '6M')  from.setMonth(from.getMonth()-6);
  else if (chartPeriod === '1Y')  from.setFullYear(from.getFullYear()-1);
  else return null; // ALL
  return from.toISOString().split('T')[0];
}

function renderPosicionesChart() {
  const prod     = document.getElementById('chart-prod').value;
  const pos      = document.getElementById('chart-pos').value;
  const fromDate = getDateRange();

  actualizarFiltroPos();

  // Filter historicos for the line
  let lineData = histData.filter(r => {
    if (prod && normalizeStr(r.producto) !== normalizeStr(prod)) return false;
    if (fromDate && r.fecha < fromDate) return false;
    // When product selected: use chosen posicion or CONT
    if (prod) {
      const useCont = !pos || pos === 'CONT';
      if (useCont && r.posicion !== 'CONT') return false;
      if (!useCont && r.posicion !== pos) return false;
    } else {
      // No product: show only CONT for all products (scatter points)
      if (r.posicion !== 'CONT') return false;
    }
    return true;
  });

  // Filter operations for bubbles
  let ops = getFilteredOps().filter(op => {
    if (prod && op.producto !== prod) return false;
    if (fromDate && op.fecha < fromDate) return false;
    return true;
  });

  const emptyEl = document.getElementById('pos-chart-empty');
  if (!lineData.length && !ops.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (posicionesChart) { posicionesChart.destroy(); posicionesChart = null; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Build line dataset
  const linePoints = lineData.map(r => ({x: r.fecha, y: r.precio}));

  // Build bubble datasets: compra, venta, opciones
  const maxVol = Math.max(...ops.map(o => o.volumen), 1);
  const toRadius = vol => Math.max(6, Math.min(30, (vol / maxVol) * 30));

  const bubbleCompra  = [];
  const bubbleVenta   = [];
  const bubbleOpcEj   = [];

  ops.forEach(op => {
    const pM = getPrecioValuacionOp(op);
    const L  = calcularL(op, pM);
    if (L === 0) return; // PAF o no ejercible
    const entregado = isEntregaEfectiva(op);
    // For active options: show strike price. Delivered options behave as physical price ops.
    const esOpcion = (op.tipo === 'Call' || op.tipo === 'Put') && !entregado;
    const yPrecio = entregado
      ? getPrecioEfectivo(op, pM)
      : esOpcion
      ? (op.precio_ejercicio || op.precio)
      : (getPrecioEfectivo(op, pM) || op.precio);
    if (!yPrecio || !op.fecha) return;
    const punto = { x: op.fecha, y: yPrecio, r: toRadius(op.volumen), op };
    if (esOpcion) bubbleOpcEj.push(punto);
    else if (L > 0) bubbleCompra.push(punto);
    else bubbleVenta.push(punto);
  });

  // Build line and scatter datasets for historical prices
  // If product selected: one smooth line. If no product: scatter points per product
  const PROD_COLORS = {
    'Soja':'#d56a9d','Maiz':'#7dbaf8','Trigo':'#c8a96e',
    'Girasol':'#f97066','Sorgo':'#888','Cebada':'#4aab76'
  };

  // Always scatter — group by producto
  const byProdHist = {};
  lineData.forEach(r => {
    if (!byProdHist[r.producto]) byProdHist[r.producto] = [];
    byProdHist[r.producto].push({x:r.fecha, y:r.precio});
  });
  const histDatasets = Object.entries(byProdHist).map(([p, pts]) => {
    const col = PROD_COLORS[p] || '#888';
    return {
      type: 'scatter',
      label: p,
      data: pts,
      backgroundColor: col + 'aa',
      borderColor: col,
      borderWidth: 0,
      pointRadius: 2.5,
      pointHoverRadius: 5,
      parsing: {xAxisKey:'x', yAxisKey:'y'}
    };
  });

  const datasets = [
    ...histDatasets,
    {
      type: 'bubble',
      label: 'Compra (Long)',
      data: bubbleCompra,
      backgroundColor: 'rgba(91,158,201,0.6)',
      borderColor: '#5b9ec9',
      borderWidth: 1.5,
      parsing: {xAxisKey:'x', yAxisKey:'y', rAxisKey:'r'}
    },
    {
      type: 'bubble',
      label: 'Venta (Short)',
      data: bubbleVenta,
      backgroundColor: 'rgba(217,81,44,0.55)',
      borderColor: '#d9512c',
      borderWidth: 1.5,
      parsing: {xAxisKey:'x', yAxisKey:'y', rAxisKey:'r'}
    },
    {
      type: 'bubble',
      label: 'Opción ejercible',
      data: bubbleOpcEj,
      backgroundColor: 'rgba(91,158,201,0.2)',
      borderColor: '#5b9ec9',
      borderWidth: 2,
      borderDash: [4,4],
      parsing: {xAxisKey:'x', yAxisKey:'y', rAxisKey:'r'}
    }
  ];

  const ctx = document.getElementById('posicionesChart').getContext('2d');
  if (posicionesChart) posicionesChart.destroy();

  posicionesChart = new Chart(ctx, {
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          min: fromDate || undefined,
          max: new Date().toISOString().split('T')[0],
          time: { unit: chartPeriod === '1M' ? 'day' : 'month', displayFormats: { day:'d MMM', month:'MMM yy' } },
          grid: { color: 'rgba(255,255,255,.07)' },
          ticks: { font:{ size:11 }, color:'#7fa8c4' }
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,.07)' },
          ticks: { font:{ size:11 }, color:'#7fa8c4', callback: v => '$'+v }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => {
              const d = ctx[0];
              if (d.dataset.type === 'bubble' && d.raw.op) {
                const op = d.raw.op;
                return op.producto+' — '+op.tipo+' '+op.lado;
              }
              return 'Precio continuo';
            },
            label: ctx => {
              if (ctx.dataset.type === 'bubble' && ctx.raw.op) {
                const op = ctx.raw.op;
                return [
                  'Fecha: '+op.fecha,
                  'Precio: $'+Number(ctx.raw.y).toFixed(2)+'/tn',
                  'Volumen: '+Number(op.volumen).toLocaleString('es-AR')+' tn'
                ];
              }
              return 'Precio: $'+Number(ctx.raw.y).toFixed(2);
            }
          }
        }
      }
    }
  });
}


// ══ FLUJO DE FONDOS ══
let flujoChart = null;

function calcularFlujoPorOp(op) {
  // Returns {mes: 'YYYY-MM', ingreso: N, egreso: N, detalle: string}
  // Only for: Precio, FIX, Forward, Futuro, Call, Put
  const tipo = op.tipo;
  const lado = op.lado;
  const vol  = Number(op.volumen);
  const pOp  = Number(op.precio) || 0;
  const pEj  = Number(op.precio_ejercicio) || 0;
  const pM   = getPrecioValuacionOp(op) || 0;

  if (!op.vencimiento) return null;
  const vto  = op.vencimiento.substring(0, 7); // YYYY-MM
  const hoy  = new Date().toISOString().substring(0, 7);
  if (vto < hoy) return null; // solo meses futuros

  let ingreso = 0, egreso = 0, detalle = '';

  if (['Precio','FIX','Forward'].includes(tipo)) {
    const monto = pOp * vol;
    if (lado === 'Venta')  { ingreso = monto; detalle = 'Venta a $'+pOp.toFixed(0)+'/tn'; }
    else                   { egreso  = monto; detalle = 'Compra a $'+pOp.toFixed(0)+'/tn'; }
  }
  else if (tipo === 'Futuro') {
    let resultado;
    if (lado === 'Venta')  resultado = (pOp - pM) * vol;
    else                   resultado = (pM  - pOp) * vol;
    if (resultado >= 0) { ingreso = resultado; }
    else                { egreso  = Math.abs(resultado); }
    detalle = 'Futuro '+lado+' $'+pOp.toFixed(0)+' | mdo $'+pM.toFixed(0);
  }
  else if (tipo === 'Put') {
    const prima = pOp * vol;
    const ejercible = pM > 0 && pM <= pEj;
    if (lado === 'Compra') {
      egreso = prima; // prima siempre es egreso si compra
      if (ejercible) {
        const res = (pEj - pM) * vol;
        if (res >= 0) ingreso += res; else egreso += Math.abs(res);
      }
      detalle = 'PUT Compra prima $'+pOp.toFixed(0)+(ejercible?' + ejercido':'');
    } else { // Venta
      ingreso = prima;
      if (ejercible) {
        const res = (pM - pEj) * vol;
        if (res >= 0) ingreso += res; else egreso += Math.abs(res);
      }
      detalle = 'PUT Venta prima $'+pOp.toFixed(0)+(ejercible?' + ejercido':'');
    }
  }
  else if (tipo === 'Call') {
    const prima = pOp * vol;
    const ejercible = pM > 0 && pM >= pEj;
    if (lado === 'Compra') {
      egreso = prima;
      if (ejercible) {
        const res = (pM - pEj) * vol;
        if (res >= 0) ingreso += res; else egreso += Math.abs(res);
      }
      detalle = 'CALL Compra prima $'+pOp.toFixed(0)+(ejercible?' + ejercido':'');
    } else { // Venta
      ingreso = prima;
      if (ejercible) {
        const res = (pEj - pM) * vol;
        if (res >= 0) ingreso += res; else egreso += Math.abs(res);
      }
      detalle = 'CALL Venta prima $'+pOp.toFixed(0)+(ejercible?' + ejercido':'');
    }
  }
  else return null; // Plan de Siembra, Stock, PAF no generan flujo

  return { mes: vto, ingreso, egreso, detalle, op };
}

function renderFlujo() {
  const filtProd = document.getElementById('flujo-prod')?.value || '';
  const filtTipo = document.getElementById('flujo-tipo')?.value || '';

  // Filter ops
  let ops = getFilteredOps().filter(op => {
    if (filtProd && op.producto !== filtProd) return false;
    if (filtTipo && op.tipo !== filtTipo) return false;
    return true;
  });

  // Calculate flows per op
  const flujos = ops.map(calcularFlujoPorOp).filter(Boolean);

  // Group by month
  const hoy = new Date().toISOString().substring(0,7);
  const maxMes = getCampaignOps()
    .map(o => o.vencimiento ? o.vencimiento.substring(0,7) : '')
    .filter(m => m >= hoy)
    .sort().pop() || hoy;

  // Build month range (string comparison avoids timezone issues)
  const meses = [];
  let cur = new Date(hoy + '-02');
  const fin = new Date(maxMes + '-02');
  while (cur.toISOString().substring(0,7) <= maxMes) {
    meses.push(cur.toISOString().substring(0,7));
    cur.setMonth(cur.getMonth() + 1);
  }

  // Aggregate
  const porMes = {};
  meses.forEach(m => { porMes[m] = {ingreso:0, egreso:0, items:[]}; });
  flujos.forEach(f => {
    if (!porMes[f.mes]) porMes[f.mes] = {ingreso:0, egreso:0, items:[]};
    porMes[f.mes].ingreso += f.ingreso;
    porMes[f.mes].egreso  += f.egreso;
    porMes[f.mes].items.push(f);
  });

  // ── Chart ──
  const labels = meses.map(m => {
    const d = new Date(m+'-15');
    return d.toLocaleDateString('es-AR',{month:'short',year:'2-digit'});
  });
  const ingresos = meses.map(m => porMes[m]?.ingreso || 0);
  const egresos  = meses.map(m => -(porMes[m]?.egreso  || 0));
  const netos    = meses.map(m => (porMes[m]?.ingreso||0) - (porMes[m]?.egreso||0));

  const ctx = document.getElementById('flujoChart')?.getContext('2d');
  if (!ctx) return;
  if (flujoChart) flujoChart.destroy();

  flujoChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Ingresos',
          data: ingresos,
          backgroundColor: 'rgba(30,153,112,0.65)',
          borderColor: '#1e9970', borderWidth: 1, borderRadius: 3,
          order: 2
        },
        {
          type: 'bar', label: 'Egresos',
          data: egresos,
          backgroundColor: 'rgba(217,81,44,0.6)',
          borderColor: '#d9512c', borderWidth: 1, borderRadius: 3,
          order: 2
        },
        {
          type: 'line', label: 'Neto',
          data: netos,
          borderColor: '#d4a017',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#d4a017',
          tension: 0.3,
          fill: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { color:'rgba(255,255,255,.07)' },
          ticks: { font:{size:10}, color:'#7fa8c4' }
        },
        y: {
          stacked: true,
          grid: { color:'rgba(255,255,255,.07)' },
          ticks: {
            font: {size:11}, color:'#7fa8c4',
            callback: v => {
              const abs = Math.abs(v);
              const sign = v < 0 ? '-' : '';
              if (abs >= 1000000) return sign+'$'+(abs/1000000).toFixed(1)+'M';
              if (abs >= 1000)    return sign+'$'+(abs/1000).toFixed(0)+'k';
              return sign+'$'+abs;
            }
          }
        }
      },
      plugins: {
        legend: { position:'top', labels:{ font:{size:11}, boxWidth:12, padding:12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = Math.abs(ctx.raw);
              const label = ctx.dataset.label;
              if (v >= 1000000) return ' '+label+': $'+(v/1000000).toFixed(2)+'M';
              if (v >= 1000)    return ' '+label+': $'+(v/1000).toFixed(1)+'k';
              return ' '+label+': $'+v.toLocaleString('es-AR');
            }
          }
        }
      }
    }
  });

  // ── Table ──
  const tbody = document.getElementById('flujo-tbody');
  if (!tbody) return;

  let totalIng = 0, totalEgr = 0;
  const rows = meses.map(m => {
    const ing = porMes[m]?.ingreso || 0;
    const egr = porMes[m]?.egreso  || 0;
    const net = ing - egr;
    if (!ing && !egr) return '';
    totalIng += ing; totalEgr += egr;
    const d = new Date(m+'-15');
    const mes = d.toLocaleDateString('es-AR',{month:'long',year:'numeric'});
    const items = (porMes[m]?.items||[]).map(f =>
      f.op.producto+' '+f.op.tipo+' ('+f.detalle+')'
    ).join(' · ');
    return '<tr>'
      +'<td>'+mes.charAt(0).toUpperCase()+mes.slice(1)+'</td>'
      +'<td class="flujo-ingreso">'+(ing?fmtUSD(ing):'—')+'</td>'
      +'<td class="flujo-egreso">' +(egr?fmtUSD(egr):'—')+'</td>'
      +'<td class="'+(net>=0?'flujo-neto-pos':'flujo-neto-neg')+'">'+fmtUSD(net)+'</td>'
      +'<td style="font-size:11px;color:var(--gris-l);max-width:280px;white-space:normal">'+items+'</td>'
      +'</tr>';
  }).join('');

  const totalNet = totalIng - totalEgr;
  tbody.innerHTML = rows
    + '<tr>'
    + '<td>TOTAL</td>'
    + '<td class="flujo-ingreso">'+fmtUSD(totalIng)+'</td>'
    + '<td class="flujo-egreso">'+fmtUSD(totalEgr)+'</td>'
    + '<td class="'+(totalNet>=0?'flujo-neto-pos':'flujo-neto-neg')+'">'+fmtUSD(totalNet)+'</td>'
    + '<td></td>'
    + '</tr>';
}


// ══ EVOLUCIÓN DE LA CARTERA ══
let evolucionChart = null;

function renderEvolucion() {
  const filtProd = document.getElementById('evol-prod')?.value
    || document.getElementById('evol-prod-hero')?.value || '';
  const emptyEl  = document.getElementById('evol-empty');

  if (!histData.length || !getCampaignOps().length) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (evolucionChart) { evolucionChart.destroy(); evolucionChart = null; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const ops = filtProd ? getFilteredOps().filter(o => normalizeStr(o.producto) === normalizeStr(filtProd)) : getFilteredOps();
  if (!ops.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (evolucionChart) { evolucionChart.destroy(); evolucionChart = null; }
    return;
  }

  const today      = new Date().toISOString().split('T')[0];
  const firstOpDate = ops.map(o => o.fecha).filter(Boolean).sort()[0];
  if (!firstOpDate) return;

  // Monthly points
  const puntosUniq = [];
  let cur = new Date(firstOpDate + 'T12:00:00');
  cur.setDate(1);
  const fin = new Date(today + 'T12:00:00');
  while (cur <= fin) {
    const lastDay = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
    puntosUniq.push(lastDay > fin ? today : lastDay.toISOString().split('T')[0]);
    cur.setMonth(cur.getMonth() + 1);
  }

  // Build hist price map: prod|posicion -> [{fecha, precio}] sorted
  const precioHistMap = {};
  histData.forEach(r => {
    const key = normalizeStr(r.producto) + '|' + r.posicion;
    if (!precioHistMap[key]) precioHistMap[key] = [];
    precioHistMap[key].push({ fecha: r.fecha, precio: r.precio });
  });
  Object.values(precioHistMap).forEach(arr => arr.sort((a,b) => a.fecha.localeCompare(b.fecha)));

  function getPrecioHist(producto, vencimiento, fecha) {
    const prod = normalizeStr(producto);
    const d    = new Date(vencimiento + 'T12:00:00');
    const fd   = new Date(fecha + 'T12:00:00');
    const mes  = d.getMonth() + 1;
    const anio = d.getFullYear();
    const posKey = d < fd ? 'CONT' : mes + '_' + anio;
    for (const tryPos of [posKey, 'CONT']) {
      const arr = precioHistMap[prod + '|' + tryPos];
      if (!arr) continue;
      let best = null;
      for (const p of arr) { if (p.fecha <= fecha) best = p.precio; else break; }
      if (best !== null) return best;
    }
    for (const [k, arr] of Object.entries(precioHistMap)) {
      if (!k.startsWith(prod + '|')) continue;
      let best = null;
      for (const p of arr) { if (p.fecha <= fecha) best = p.precio; else break; }
      if (best !== null) return best;
    }
    return null;
  }

  const labels = [], realizadoSeries = [], pendienteSeries = [];

  for (const fecha of puntosUniq) {
    const opsActivas = ops.filter(o => o.fecha && o.fecha <= fecha);
    if (!opsActivas.length) continue;
    let realizado = 0, pendiente = 0;
    opsActivas.forEach(op => {
      const pM = getPrecioHist(op.producto, op.vencimiento, fecha);
      if (pM === null) return;
      const refDate = new Date(fecha + 'T23:59:59');
      const L = calcularL(op, pM, refDate);
      const resFin = getResultadoFinanciero(op, L, pM, refDate);
      const lFin = calcularLFinanciero(op, pM, refDate);
      if (resFin) {
        if (lFin > 0) pendiente += resFin;
        else          realizado += resFin;
      }
      if (L === 0) return;
      const pEf = getPrecioEfectivo(op, pM, refDate);
      if (pEf === null) return;
      const val = pEf * Number(op.volumen);
      if (L > 0) pendiente += val;
      else       realizado += val;
    });
    if (realizado === 0 && pendiente === 0) continue;
    const d2 = new Date(fecha + 'T12:00:00Z');
    labels.push(d2.toLocaleDateString('es-AR',{month:'short',year:'2-digit'}));
    realizadoSeries.push(Math.round(realizado));
    pendienteSeries.push(Math.round(pendiente));
  }

  if (!labels.length) { if (emptyEl) emptyEl.style.display='block'; return; }

  function buildChart(canvasId, compact, existingChart) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      if (existingChart) existingChart.destroy();
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (existingChart) existingChart.destroy();
      return null;
    }
    try {
      if (existingChart) existingChart.destroy();
      return new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Realizado',  data:realizadoSeries,  backgroundColor:'rgba(30,153,112,0.75)',  borderColor:'#1e9970', borderWidth:1, borderRadius:2, stack:'c' },
        { label:'Pendiente',  data:pendienteSeries,  backgroundColor:'rgba(212,160,23,0.75)',  borderColor:'#d4a017', borderWidth:1, borderRadius:2, stack:'c' }
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{
          x:{
            stacked:true,
            grid:{display:false},
            ticks:{
              font:{size:compact?8:10},
              color:compact?'rgba(255,255,255,.4)':'#7fa8c4',
              maxRotation:45,
              maxTicksLimit:compact?6:20
            }
          },
          y:{
            stacked:true,
            grid:{color:'rgba(255,255,255,.07)'},
            ticks:{
              font:{size:compact?9:11},
              color:compact?'rgba(255,255,255,.4)':'#7fa8c4',
              maxTicksLimit:5,
              callback:v=>{
                if(v>=1000000) return '$'+(v/1000000).toFixed(1)+'M';
                if(v>=1000) return '$'+(v/1000).toFixed(0)+'k';
                return '$'+v;
              }
            }
          }
        },
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{
            title:ctx=>'Mes: '+ctx[0].label,
            label:ctx=>' '+ctx.dataset.label+': '+fmtUSD(ctx.raw),
            footer:items=>{ const t=items.reduce((s,i)=>s+i.raw,0); return 'Total: '+fmtUSD(t); }
          }}
        }
      }
    });
    } catch (error) {
      console.error(`[buildChart] Error creando gráfico "${canvasId}":`, error);
      return null;
    }
  }

  window._evolucionChartHero = buildChart('evolucionChartHero', true,  window._evolucionChartHero);
  evolucionChart              = buildChart('evolucionChart',     false, evolucionChart);
}


