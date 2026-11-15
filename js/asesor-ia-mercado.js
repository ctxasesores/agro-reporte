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
        setTimeout(cargarPanoramaMercado, 20);
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
  // Dominio insights_mercado de agente-agro, renderizado en el bloque
  // "Mercado" nativo de index.html (contenedor #m-insights / #m-insights-sub).
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
      const data = await res.json().catch(() => ({}));
      const insights = Array.isArray(data?.insights) ? data.insights : [];

      if (!insights.length) {
        // Distinguir "la IA no está disponible" de "no hay datos": antes se
        // mostraba "sin datos frescos" también cuando la API de Anthropic
        // devolvía 400/502, y el productor leía que el mercado no tenía novedades.
        let msg = 'Sin insights disponibles por el momento.', subTxt = 'Sin datos frescos de las fuentes de mercado';
        if (res.status === 401 || data?.code === 'NO_AUTH') {
          msg = 'Iniciá sesión para ver los insights.'; subTxt = 'Sesión requerida';
        } else if (res.status === 502 || data?.error === 'ia_no_disponible') {
          msg = 'El generador de insights (IA) no está disponible en este momento. Las señales de la izquierda se calculan sin IA y siguen al día.';
          subTxt = 'IA no disponible · señales vigentes';
          _insightsMercadoCargados = false; // reintentar la próxima vez que se abra el panel
        } else if (data?.error === 'sin_fuentes') {
          msg = 'No hay fuentes frescas (últimos 10 días) para generar insights.'; subTxt = 'Sin fuentes frescas';
        }
        container.innerHTML = '<div style="font-size:12px;color:var(--gris);padding:8px 0">' + escapeHtmlIdx(msg) + '</div>';
        if (sub) sub.textContent = subTxt;
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

  // ── Panorama dinámico: señales cuantificadas + régimen + KPIs ─────
  // Lee `mercado_senales` (la escribe ctx-data-pipeline: WASDE, Crop
  // Progress, Bolsacer, CFTC, VIX/DXY/BRL/WTI) y precios_mercado. Reemplaza
  // los KPIs y la tabla de señales que estaban fijos en el HTML desde mayo
  // ("Soja Chicago ~430", "Régimen especulativo", "Fundamentos alcistas").
  const PILL = {
    alcista:    ['m-pill-bull',    'ALCISTA'],
    bajista:    ['m-pill-bear',    'BAJISTA'],
    monitorear: ['m-pill-watch',   'MONITOREAR'],
    neutral:    ['m-pill-neutral', 'NEUTRAL'],
    sin_dato:   ['m-pill-neutral', 'SIN DATO'],
  };
  const ORDEN_GRUPO = { macro: 0, fundamentos: 1, oferta: 2, especulativo: 3 };
  const NOMBRE_CULTIVO = { Soja: 'Soja', Maiz: 'Maíz', Trigo: 'Trigo', Girasol: 'Girasol', Complejo: 'Complejo soja' };

  const fmtAR = (n, dec = 1) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  function fmtFechaCorta(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}` : '';
  }
  function diasDesde(iso) {
    const t = iso ? new Date(iso).getTime() : NaN;
    return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : Infinity;
  }
  function pillHtml(senal, fechaDato) {
    const [cls, txt] = PILL[senal] || PILL.neutral;
    const viejo = diasDesde(fechaDato) > 45 ? ' <span class="m-pill-neutral" title="Dato de más de 45 días">viejo</span>' : '';
    return `<span class="${cls}">${txt}</span>${viejo}`;
  }
  function filaSenal(sn, conCultivo) {
    const detalle = String(sn.detalle || '');
    const corto = detalle.length > 140 ? detalle.slice(0, 137) + '…' : detalle;
    const fuente = `${escapeHtmlIdx(sn.fuente || '')}${sn.fecha_dato ? ' · ' + fmtFechaCorta(sn.fecha_dato) : ''}`;
    const variable = `<div style="font-weight:600;color:var(--texto)">${escapeHtmlIdx(sn.etiqueta || sn.clave)}</div>`
      + (corto ? `<div style="font-size:10.5px;color:var(--gris);line-height:1.45;margin-top:2px" title="${escapeHtmlIdx(detalle)}">${escapeHtmlIdx(corto)}</div>` : '');
    const medio = conCultivo
      ? `<td style="white-space:nowrap">${escapeHtmlIdx(NOMBRE_CULTIVO[sn.cultivo] || sn.cultivo || '—')}<div style="font-size:10px;color:var(--gris)">${fuente}</div></td>`
      : `<td style="font-size:11px;color:var(--gris);white-space:nowrap">${fuente}</td>`;
    return `<tr><td>${variable}</td>${medio}<td style="white-space:nowrap">${pillHtml(sn.senal, sn.fecha_dato)}</td></tr>`;
  }
  function ordenarSenales(senales) {
    return senales.slice().sort((a, b) =>
      (a.clave === 'regimen_macro' ? -1 : 0) - (b.clave === 'regimen_macro' ? -1 : 0)
      || (ORDEN_GRUPO[a.grupo] ?? 9) - (ORDEN_GRUPO[b.grupo] ?? 9)
      || String(a.cultivo || 'zz').localeCompare(String(b.cultivo || 'zz'))
      || String(a.clave).localeCompare(String(b.clave)));
  }

  function pintarRegimen(reg) {
    const d = (reg && reg.datos) || {};
    const tipo = !reg || reg.senal === 'sin_dato' ? null : (d.regimen || (reg.senal === 'monitorear' ? 'riesgo_off' : 'fundamentos'));
    const estilos = {
      fundamentos: { bg: 'rgba(30,153,112,.18)', bd: 'rgba(30,153,112,.4)', color: '#2ab88a', label: 'Fundamentos' },
      riesgo_off:  { bg: 'rgba(217,81,44,.18)',  bd: 'rgba(217,81,44,.4)',  color: '#f0856a', label: 'Riesgo-off' },
      dolar:       { bg: 'rgba(212,160,23,.18)', bd: 'rgba(212,160,23,.4)', color: 'var(--oro-l)', label: 'Dólar' },
      sin_dato:    { bg: 'rgba(255,255,255,.06)', bd: 'rgba(255,255,255,.14)', color: 'var(--gris)', label: 'Sin dato' },
    };
    const e = estilos[tipo] || estilos.sin_dato;
    const vix = d.vix_ultimo != null ? `VIX ${fmtAR(d.vix_ultimo)}` : '';
    const dxy = d.dxy_var20 != null ? `DXY ${d.dxy_var20 >= 0 ? '+' : ''}${fmtAR(d.dxy_var20)}% en 20 ruedas` : '';
    const sub = [vix, dxy].filter(Boolean).join(' · ') || (reg ? 'sin detalle' : 'el pipeline macro todavía no corrió');
    for (const [badgeId, dotId, labelId] of [['mercado-regime-badge','mercado-regime-dot','mercado-regime-label'], ['mercado-regime-chat-badge','mercado-regime-chat-dot','mercado-regime-chat-label']]) {
      const badge = document.getElementById(badgeId), dot = document.getElementById(dotId), label = document.getElementById(labelId);
      if (!badge) continue;
      badge.style.background = e.bg; badge.style.borderColor = e.bd; badge.style.color = e.color;
      badge.title = reg && reg.detalle ? reg.detalle : 'Régimen macro: sin dato';
      if (dot) { dot.style.background = e.color; dot.style.animation = tipo && tipo !== 'fundamentos' && tipo !== 'sin_dato' ? 'asesorBlink 2s infinite' : 'none'; }
      if (label) label.textContent = `Régimen: ${e.label}`;
    }
    const kpi = document.getElementById('mercado-kpi-regimen'), kpiSub = document.getElementById('mercado-kpi-regimen-sub');
    if (kpi) { kpi.textContent = e.label; kpi.style.color = e.color; }
    if (kpiSub) kpiSub.textContent = sub + (reg && reg.fecha_dato ? ` · ${fmtFechaCorta(reg.fecha_dato)}` : '');
  }

  function pintarFundamentos(senales) {
    const kpi = document.getElementById('mercado-kpi-fund'), sub = document.getElementById('mercado-kpi-fund-sub');
    if (!kpi) return;
    const w = senales.filter(s => String(s.clave).startsWith('wasde_'));
    if (!w.length) { kpi.textContent = 'Sin dato'; kpi.style.color = 'var(--gris)'; if (sub) sub.textContent = 'El pipeline WASDE todavía no corrió'; return; }
    const n = { alcista: 0, bajista: 0, neutral: 0, sin_dato: 0 };
    w.forEach(s => { n[s.senal] = (n[s.senal] || 0) + 1; });
    let txt = 'Mixtos', color = 'var(--oro-l)';
    if (n.alcista >= 2 && !n.bajista) { txt = `Alcistas ${n.alcista}/${w.length}`; color = '#2ab88a'; }
    else if (n.bajista >= 2 && !n.alcista) { txt = `Bajistas ${n.bajista}/${w.length}`; color = '#f0856a'; }
    else if (n.neutral === w.length) { txt = 'Neutrales'; color = 'var(--gris)'; }
    else txt = `Alc ${n.alcista} · Baj ${n.bajista} · Neu ${n.neutral}`;
    kpi.textContent = txt; kpi.style.color = color;
    const soja = w.find(s => s.cultivo === 'Soja');
    const d = (soja && soja.datos) || {};
    if (sub) sub.textContent = (d.ratio_proj != null && d.ratio_base != null)
      ? `Soja stocks/uso ${fmtAR(d.ratio_proj)}% vs ${fmtAR(d.ratio_base)}% campaña anterior · ${fmtFechaCorta(soja.fecha_dato)}`
      : `${w.length} cultivos · ${fmtFechaCorta(w[0].fecha_dato)}`;
  }

  function pintarSoja(precios, stats) {
    const kpi = document.getElementById('mercado-kpi-soja'), sub = document.getElementById('mercado-kpi-soja-sub');
    if (!kpi) return;
    const p = (precios || []).find(r => String(r.producto).replace('Maíz','Maiz') === 'Soja');
    if (!p) { kpi.textContent = '—'; if (sub) sub.textContent = 'Sin precio disponible'; return; }
    kpi.textContent = 'USD ' + fmtAR(p.precio, 2);
    const st = (stats || []).find(r => String(r.producto) === 'Soja');
    const partes = ['MATba disponible'];
    if (st && st.percentil != null) partes.push(`percentil 90d ${Math.round(Number(st.percentil))}%`);
    if (st && st.var_vs_avg_pct != null) partes.push(`${Number(st.var_vs_avg_pct) >= 0 ? '+' : ''}${fmtAR(st.var_vs_avg_pct)}% vs promedio 90d`);
    if (p.updated_at) partes.push(fmtFechaCorta(p.updated_at));
    if (sub) sub.textContent = partes.join(' · ');
  }

  function pintarTablas(senales) {
    const orden = ordenarSenales(senales);
    const tb = document.getElementById('m-senales-tbody');
    if (tb) {
      tb.innerHTML = orden.length
        ? orden.map(sn => filaSenal(sn, true)).join('')
        : '<tr><td colspan="3" style="color:var(--gris)">Todavía no hay señales calculadas (el pipeline no corrió).</td></tr>';
      const sub = document.getElementById('m-senales-sub');
      if (sub && orden.length) {
        const ult = orden.map(s => s.updated_at).filter(Boolean).sort().pop();
        sub.textContent = `${orden.length} señales calculadas por el pipeline de datos · última actualización ${fmtFechaCorta(ult)}`;
      }
    }
    document.querySelectorAll('tbody[data-grupos]').forEach(tbody => {
      const grupos = String(tbody.dataset.grupos).split(',');
      const filas = orden.filter(s => grupos.includes(s.grupo));
      tbody.innerHTML = filas.length
        ? filas.map(sn => filaSenal(sn, false)).join('')
        : '<tr><td colspan="3" style="color:var(--gris)">Sin señales para esta capa todavía.</td></tr>';
    });
  }

  let _panoramaCargandose = false;
  async function cargarPanoramaMercado() {
    if (_panoramaCargandose) return;
    if (typeof sb === 'undefined' || !sb) return;
    _panoramaCargandose = true;
    try {
      const [senRes, precRes, statRes] = await Promise.all([
        sb.from('mercado_senales').select('clave,grupo,cultivo,etiqueta,fuente,senal,valor,unidad,detalle,datos,fecha_dato,updated_at'),
        sb.from('precios_mercado').select('producto,precio,updated_at').eq('activo', true).eq('vencimiento', 'CONT'),
        sb.from('v_precios_estadisticas').select('producto,vencimiento,percentil,var_vs_avg_pct').eq('vencimiento', 'CONT'),
      ]);
      if (senRes.error) console.warn('[panorama mercado] señales', senRes.error);
      const senales = Array.isArray(senRes.data) ? senRes.data : [];
      pintarRegimen(senales.find(s => s.clave === 'regimen_macro') || null);
      pintarFundamentos(senales);
      pintarSoja(precRes.data, statRes.error ? [] : statRes.data);
      pintarTablas(senales);
    } catch (e) {
      console.warn('[panorama mercado]', e);
      const tb = document.getElementById('m-senales-tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="3" style="color:var(--gris)">No se pudieron cargar las señales.</td></tr>';
    } finally { _panoramaCargandose = false; }
  }
  window.cargarPanoramaMercado = cargarPanoramaMercado;

  // Curar también al cerrar/recargar la página
  window.addEventListener('beforeunload', () => {
    if (window._mercadoViewActivo && historialMercado.length >= 2) {
      curarSesionMercado();
    }
  });

})();
