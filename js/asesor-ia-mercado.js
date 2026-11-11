(function () {
  const FN_URL = (typeof FUNCTIONS_URL !== 'undefined' && FUNCTIONS_URL)
    ? FUNCTIONS_URL.replace(/\/$/, '') + '/agente-agro'
    : 'https://xilkjtmaruqqodnhwkbp.supabase.co/functions/v1/agente-agro';
  const SB_ANON = (typeof SUPA_KEY !== 'undefined') ? SUPA_KEY : '';

  const historialMercado = [];

  // ── PRO check: cualquier panel PRO da acceso ──────────────
  function esMercadoPro() {
    if (typeof currentCliente === 'undefined' || !currentCliente) return false;
    return ['agricultura_nivel','ganaderia_nivel','tambo_nivel'].some(
      k => String(currentCliente[k] || '').toUpperCase() === 'PRO'
    );
  }

  // ── Contexto rico: cartera + mercado ─────────────────────
  function construirContextoMercado() {
    const ctx = { dominio: 'mercado' };
    try {
      // Cartera del cliente (mismo cálculo que Agricultura)
      if (typeof calcularCartera === 'function') {
        const c = calcularCartera();
        ctx.cartera = {
          valor_total_usd: Math.round(c.cartera),
          realizado_usd:   Math.round(c.realizado),
          pendiente_usd:   Math.round(c.pendiente),
        };
      }
      if (typeof calcularPorProducto === 'function') {
        const m = calcularPorProducto();
        ctx.por_producto = Object.entries(m)
          .filter(([, v]) => v.longTn || v.shortTn || v.pMercado != null)
          .map(([prod, v]) => ({
            producto: prod,
            tn_compradas:       Math.round(v.longTn  || 0),
            tn_vendidas:        Math.round(v.shortTn || 0),
            precio_prom_compra: v.pCompra_den ? +(v.pCompra_num_adj / v.pCompra_den).toFixed(2) : null,
            precio_prom_venta:  v.pVenta_den  ? +(v.pVenta_num_adj  / v.pVenta_den).toFixed(2)  : null,
            precio_mercado:     v.pMercado != null ? +Number(v.pMercado).toFixed(2) : null,
          }));
      }
      if (typeof currentCliente !== 'undefined' && currentCliente) {
        ctx.cliente = {
          empresa:   currentCliente.nombre_empresa,
          campania:  (typeof activeCampaign !== 'undefined' && activeCampaign) || currentCliente.campania,
          nivel_agr: currentCliente.agricultura_nivel || 'ESTANDAR',
        };
      }
    } catch (e) { console.warn('[mercado ctx]', e); }
    return ctx;
  }

  // ── Helpers de UI ─────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  }
  function fmt(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[-•]\s+/gm, '• ')
      .replace(/\n/g, '<br>');
  }
  function addMsgMercado(role, html) {
    const chat = document.getElementById('mercado-asesor-chat');
    if (!chat) return null;
    const div = document.createElement('div');
    div.className = role === 'user' ? 'mercado-msg-user' : 'mercado-msg-ia';
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  // ── Actualizar KPI de cartera en Panorama ─────────────────
  function actualizarKpiCartera() {
    try {
      if (typeof calcularCartera !== 'function') return;
      const c = calcularCartera();
      const kpiEl  = document.getElementById('mercado-kpi-cartera');
      const pendEl = document.getElementById('mercado-kpi-pendiente');
      const fmt2   = v => v >= 1000 ? 'USD ' + Math.round(v/1000) + 'k' : 'USD ' + Math.round(v);
      if (kpiEl)  kpiEl.textContent  = fmt2(c.cartera);
      if (pendEl) pendEl.textContent = 'Pendiente: ' + fmt2(c.pendiente);
    } catch(e) {}
  }

  // ── Evaluar acceso al abrir el tab Asesor IA ──────────────
  function evaluarAccesoMercado() {
    const gate = document.getElementById('mercado-pro-gate');
    const chat = document.getElementById('mercado-chat-wrap');
    if (!gate || !chat) return;
    if (esMercadoPro()) {
      gate.style.display = 'none';
      chat.style.display = 'block';
    } else {
      gate.style.display = 'block';
      chat.style.display = 'none';
    }
  }

  // ── Tab switcher ──────────────────────────────────────────
  window.mercadoSwitchTab = function(btn, tabId) {
    document.querySelectorAll('.mercado-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['mercado-tab-panorama','mercado-tab-variables','mercado-tab-framework','mercado-tab-agente']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === tabId ? 'block' : 'none';
      });
    if (tabId === 'mercado-tab-agente') evaluarAccesoMercado();
    if (tabId === 'mercado-tab-panorama') actualizarKpiCartera();
  };

  // ── Accordion helper ──────────────────────────────────────
  window.mercadoToggle = function(id, iconId) {
    const el   = document.getElementById(id);
    const icon = document.getElementById(iconId);
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
  };

  // ── Enviar mensaje al agente ──────────────────────────────
  window.mercadoAsesorEnviar = async function(textoFijo) {
    const input   = document.getElementById('mercado-asesor-input');
    const sendBtn = document.getElementById('mercado-asesor-send');
    const mensaje = (textoFijo != null ? textoFijo : (input ? input.value : '')).trim();
    if (!mensaje) return;

    if (!esMercadoPro()) {
      addMsgMercado('ia', 'El Asesor de Mercado está disponible para cuentas <b>PRO</b>. Consultá con CTX para habilitarlo.');
      return;
    }

    if (textoFijo == null && input) input.value = '';
    addMsgMercado('user', esc(mensaje));
    historialMercado.push({ role: 'user', content: mensaje });

    if (sendBtn) sendBtn.disabled = true;
    const typing = addMsgMercado('ia', '<span class="asesor-typing"><span></span><span></span><span></span></span>');

    const ctx = construirContextoMercado();
    // Inyectamos el contexto de cartera en el primer mensaje de cada sesión
    const mensajeConCtx = historialMercado.length === 1
      ? `CONTEXTO DE MI CARTERA (usá estos datos para el análisis):\n${JSON.stringify(ctx, null, 2)}\n\nMi consulta: ${mensaje}`
      : mensaje;

    // Reconstruir historial con contexto en primer turno
    const mensajesApi = historialMercado.slice(0, -1).map((m, i) =>
      i === 0 && m.role === 'user'
        ? { role: 'user', content: `CONTEXTO DE MI CARTERA:\n${JSON.stringify(ctx, null, 2)}\n\n${m.content}` }
        : m
    );
    mensajesApi.push({ role: 'user', content: mensajeConCtx });

    try {
      const resp = await fetch(FN_URL, {
        method: 'POST',
        headers: await ctxAuthHeaders(),
        body: JSON.stringify({
          dominio: 'mercado',
          messages: mensajesApi,
          cliente_id: (typeof currentCliente !== 'undefined' && currentCliente?.id) ? currentCliente.id : undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        if (typing) typing.innerHTML = 'Hubo un problema al generar el análisis. ' +
          (data.error ? esc(data.error) : '') + ' Probá de nuevo en un momento.';
        return;
      }
      const respText = data.texto || data.content?.[0]?.text || 'Sin respuesta.';
      if (typing) typing.innerHTML = fmt(respText);
      historialMercado.push({ role: 'assistant', content: respText });
    } catch (e) {
      if (typing) typing.innerHTML = 'No pude conectar con el asesor. Revisá tu conexión e intentá de nuevo.';
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  };

  // ── Actualizar KPI cuando se navega a view-mercado ────────
  const origSwitch = window.switchDashboard;
  if (typeof origSwitch === 'function') {
    window.switchDashboard = function(view, el) {
      // Si salimos de mercado con historial, curar la sesión
      if (window._mercadoViewActivo && view !== 'mercado' && historialMercado.length >= 2) {
        curarSesionMercado();
      }
      window._mercadoViewActivo = (view === 'mercado');
      origSwitch(view, el);
      if (view === 'mercado') {
        setTimeout(actualizarKpiCartera, 100);
        setTimeout(cargarMemoriaMercado, 200);
        setTimeout(cargarInsightsMercadoIndex, 50);
      }
    };
  }

  // ── Cargar memoria de sesiones anteriores ─────────────────
  async function cargarMemoriaMercado() {
    try {
      if (typeof currentCliente === 'undefined' || !currentCliente?.id) return;
      const resp = await fetch(FN_URL, {
        method: 'POST',
        headers: await ctxAuthHeaders(),
        body: JSON.stringify({
          dominio: 'leer_memoria',
          panel: 'mercado',
          cliente_id: currentCliente.id,
        }),
      });
      const data = await resp.json();
      if (data?.memoria?.raw_summary) {
        window._mercadoMemoria = data.memoria;
        // Mostrar indicador visual de que hay contexto previo
        const chat = document.getElementById('mercado-asesor-chat');
        if (chat) {
          const badge = document.createElement('div');
          badge.style.cssText = 'font-size:11px;color:var(--gris);background:rgba(212,160,23,.08);border:1px solid rgba(212,160,23,.15);border-radius:6px;padding:6px 10px;margin-bottom:4px;text-align:center';
          badge.innerHTML = '✦ Retomamos donde lo dejamos — tengo contexto de tu última sesión';
          chat.insertBefore(badge, chat.firstChild);
        }
      }
    } catch(e) { console.warn('[memoria mercado]', e); }
  }

  // ── Curar sesión al salir ──────────────────────────────────
  async function curarSesionMercado() {
    try {
      if (typeof currentCliente === 'undefined' || !currentCliente?.id) return;
      if (historialMercado.length < 2) return;
      fetch(FN_URL, {
        method: 'POST',
        keepalive: true, // que el pedido sobreviva al cierre de la pestaña
        headers: ctxAuthHeadersSync(),
        body: JSON.stringify({
          dominio: 'curador',
          panel: 'mercado',
          cliente_id: currentCliente.id,
          historial_chat: historialMercado,
        }),
      }).catch(e => console.warn('[curador]', e));
    } catch(e) {}
  }

  // ── Insights clave (dinámico) ─────────────────────────────
  // Mismo dominio insights_mercado que usa mercado_granos.html, adaptado a
  // las variables CSS y los ids del bloque "Mercado Framework" de index.html
  // (var(--texto) en vez de var(--txt), contenedor #m-insights / #m-insights-sub).
  const INSIGHT_STYLES_IDX = {
    especulativo: { borde: 'var(--oro-l)', fondo: 'rgba(212,160,23,.05)',  icono: '⚠' },
    alcista:      { borde: '#2ab88a',      fondo: 'rgba(30,153,112,.05)', icono: '↑' },
    bajista:      { borde: '#f0856a',      fondo: 'rgba(217,81,44,.05)',  icono: '↓' },
    regional:     { borde: 'var(--gris)',  fondo: 'rgba(127,168,196,.05)', icono: '📍' },
    neutral:      { borde: 'var(--gris)',  fondo: 'rgba(127,168,196,.05)', icono: '•' },
  };

  function escapeHtmlIdx(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderInsightCardIdx(insight) {
    const style = INSIGHT_STYLES_IDX[insight.tipo] || INSIGHT_STYLES_IDX.neutral;
    const atribucion = [insight.fuente, insight.fecha].filter(Boolean).join(' · ');
    return '<div style="border-left:3px solid ' + style.borde + ';padding:9px 12px;background:' + style.fondo + ';border-radius:0 6px 6px 0">'
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:' + style.borde + ';margin-bottom:4px">'
      + style.icono + ' ' + escapeHtmlIdx(insight.titulo) + '</div>'
      + '<div style="font-size:12px;line-height:1.6;color:var(--texto)">' + escapeHtmlIdx(insight.texto) + '</div>'
      + (atribucion ? '<div style="font-size:10px;color:var(--gris);margin-top:6px">' + escapeHtmlIdx(atribucion) + '</div>' : '')
      + '</div>';
  }

  let _insightsMercadoCargados = false;
  async function cargarInsightsMercadoIndex() {
    const container = document.getElementById('m-insights');
    const sub       = document.getElementById('m-insights-sub');
    if (!container) return;
    if (_insightsMercadoCargados) return; // evitar refetch en cada cambio de tab
    _insightsMercadoCargados = true;

    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: await ctxAuthHeaders(),
        body: JSON.stringify({ dominio: 'insights_mercado' }),
      });
      const data = await res.json();
      const insights = Array.isArray(data?.insights) ? data.insights : [];

      if (!insights.length) {
        container.innerHTML = '<div style="font-size:12px;color:var(--gris);padding:8px 0">Sin insights disponibles por el momento.</div>';
        if (sub) sub.textContent = 'Sin datos frescos de las fuentes de mercado';
        return;
      }

      container.innerHTML = insights.map(renderInsightCardIdx).join('');

      if (sub) {
        const fuentes = [];
        insights.forEach(i => { if (i.fuente && !fuentes.includes(i.fuente)) fuentes.push(i.fuente); });
        sub.textContent = fuentes.length ? fuentes.join(' · ') : 'Generado a partir del contexto de mercado';
      }
    } catch (e) {
      _insightsMercadoCargados = false; // permitir reintento si falló
      container.innerHTML = '<div style="font-size:12px;color:var(--gris);padding:8px 0">No se pudieron cargar los insights en este momento.</div>';
      if (sub) sub.textContent = '';
      console.warn('[insights mercado]', e);
    }
  }

  // Curar también al cerrar/recargar la página
  window.addEventListener('beforeunload', () => {
    if (window._mercadoViewActivo && historialMercado.length >= 2) {
      curarSesionMercado();
    }
  });

})();
