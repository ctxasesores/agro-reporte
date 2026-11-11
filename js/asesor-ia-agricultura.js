(function () {
  // Reutiliza los globals existentes de index.html
  const FN_URL = (typeof FUNCTIONS_URL !== 'undefined' && FUNCTIONS_URL)
    ? FUNCTIONS_URL.replace(/\/$/, '') + '/agente-agro'
    : 'https://xilkjtmaruqqodnhwkbp.supabase.co/functions/v1/agente-agro';
  const SB_ANON = (typeof SUPA_KEY !== 'undefined') ? SUPA_KEY : '';

  // Solo cuentas PRO de agricultura
  const SOLO_PRO = true;

  const historial = [];

  function esPro() {
    return typeof currentCliente !== 'undefined' && currentCliente &&
      currentCliente.agricultura_nivel === 'PRO';
  }

  function asesorNum(v, fallback = 0) {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function asesorRound(v, dec = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const f = Math.pow(10, dec);
    return Math.round(n * f) / f;
  }

  function asesorMonthKey(dateStr) {
    if (!dateStr) return null;
    const raw = String(dateStr).trim();
    if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function asesorMonthsBetween(fromDate, toYear, toMonth) {
    const from = fromDate instanceof Date ? fromDate : new Date();
    const diff = (toYear - from.getFullYear()) * 12 + (toMonth - (from.getMonth() + 1));
    return Math.max(1, diff);
  }

  function asesorOps() {
    try {
      if (typeof getFilteredOps === 'function') return getFilteredOps();
      return (typeof allOps !== 'undefined' && Array.isArray(allOps)) ? allOps : [];
    } catch (e) {
      return [];
    }
  }

  function asesorPrecioProm(num, den) {
    const d = asesorNum(den);
    if (!d) return null;
    return asesorRound(asesorNum(num) / d, 2);
  }

  function buildProductoTradingRows() {
    if (typeof calcularPorProducto !== 'function') return [];
    const map = calcularPorProducto();
    const baseRows = Object.entries(map)
      .filter(([, v]) => asesorNum(v.longTn) || asesorNum(v.shortTn) || v.pMercado != null)
      .map(([producto, v]) => {
        const longTn = asesorNum(v.longTn);
        const shortTn = asesorNum(v.shortTn);
        const netoTn = longTn - shortTn;
        const brutoTn = longTn + shortTn;
        const longUsd = asesorNum(v.longVal) + asesorNum(v.resFinLong);
        const shortUsd = asesorNum(v.shortVal) + asesorNum(v.resFinShort);
        const netoUsd = longUsd - shortUsd;
        const pCompra = asesorPrecioProm(v.pCompra_num_adj, v.pCompra_den);
        const pVenta = asesorPrecioProm(v.pVenta_num_adj, v.pVenta_den);
        const pMercado = v.pMercado != null ? asesorRound(v.pMercado, 2) : null;
        return {
          producto,
          long_tn: asesorRound(longTn, 0),
          short_tn: asesorRound(shortTn, 0),
          neto_tn: asesorRound(netoTn, 0),
          delta_sobre_bruto_pct: brutoTn ? asesorRound((netoTn / brutoTn) * 100, 1) : null,
          delta_sobre_long_pct: longTn ? asesorRound((netoTn / longTn) * 100, 1) : null,
          long_usd: Math.round(longUsd),
          short_usd: Math.round(shortUsd),
          neto_usd: Math.round(netoUsd),
          precio_prom_compra: pCompra,
          precio_prom_venta: pVenta,
          precio_mercado: pMercado,
          brecha_compra_vs_mercado: (pCompra != null && pMercado != null) ? asesorRound(pMercado - pCompra, 2) : null,
          brecha_venta_vs_mercado: (pVenta != null && pMercado != null) ? asesorRound(pVenta - pMercado, 2) : null,
        };
      });

    const totalAbsUsd = baseRows.reduce((acc, r) => acc + Math.abs(r.neto_usd || 0), 0);
    return baseRows.map(r => ({
      ...r,
      concentracion_neta_pct: totalAbsUsd ? asesorRound((Math.abs(r.neto_usd || 0) / totalAbsUsd) * 100, 1) : null,
    }));
  }

  function buildDerivadosTradingResumen(ops) {
    const resumen = {
      total: 0,
      vigentes: 0,
      vencidos_no_entregados: 0,
      entregados: 0,
      por_tipo: {},
      por_producto: {},
      detalle_relevante: [],
      resultado_financiero_estimado_usd: 0,
    };
    ops.forEach(op => {
      if (typeof isDerivadoEntregable !== 'function' || !isDerivadoEntregable(op?.tipo)) return;
      resumen.total += 1;
      const estado = (typeof getEstadoDerivado === 'function') ? getEstadoDerivado(op) : '';
      const pMercado = (typeof getPrecioMercado === 'function') ? getPrecioValuacionOp(op) : null;
      const ejercible = (typeof isOpcionEjercible === 'function') ? isOpcionEjercible(op, pMercado) : false;
      const resFin = (typeof getResultadoFinanciero === 'function') ? getResultadoFinanciero(op, 0, pMercado) : 0;
      const tipoKey = op.tipo || 'Sin tipo';
      const prodKey = op.producto || 'Sin producto';

      if (estado === 'entregado') resumen.entregados += 1;
      else if (estado === 'vencido') resumen.vencidos_no_entregados += 1;
      else resumen.vigentes += 1;

      resumen.resultado_financiero_estimado_usd += asesorNum(resFin);
      resumen.por_tipo[tipoKey] = resumen.por_tipo[tipoKey] || { operaciones: 0, volumen_tn: 0 };
      resumen.por_tipo[tipoKey].operaciones += 1;
      resumen.por_tipo[tipoKey].volumen_tn += asesorNum(op.volumen);
      resumen.por_producto[prodKey] = resumen.por_producto[prodKey] || { operaciones: 0, volumen_tn: 0 };
      resumen.por_producto[prodKey].operaciones += 1;
      resumen.por_producto[prodKey].volumen_tn += asesorNum(op.volumen);

      if (estado === 'vencido' || ejercible) {
        resumen.detalle_relevante.push({
          producto: op.producto,
          tipo: op.tipo,
          lado: op.lado,
          volumen_tn: asesorRound(op.volumen, 0),
          vencimiento: op.vencimiento,
          estado,
          ejercible,
          precio_operado: asesorRound(op.precio, 2),
          precio_ejercicio: op.precio_ejercicio != null ? asesorRound(op.precio_ejercicio, 2) : null,
          precio_mercado: pMercado != null ? asesorRound(pMercado, 2) : null,
          resultado_financiero_usd: Math.round(asesorNum(resFin)),
        });
      }
    });
    Object.values(resumen.por_tipo).forEach(v => { v.volumen_tn = asesorRound(v.volumen_tn, 0); });
    Object.values(resumen.por_producto).forEach(v => { v.volumen_tn = asesorRound(v.volumen_tn, 0); });
    resumen.resultado_financiero_estimado_usd = Math.round(resumen.resultado_financiero_estimado_usd);
    resumen.detalle_relevante = resumen.detalle_relevante.slice(0, 12);
    return resumen;
  }

  function buildFlujoTradingResumen(ops) {
    const porMes = {};
    ops.forEach(op => {
      if (typeof calcularFlujoPorOp !== 'function') return;
      const f = calcularFlujoPorOp(op);
      if (!f) return;
      porMes[f.mes] = porMes[f.mes] || { ingreso: 0, egreso: 0, items: 0 };
      porMes[f.mes].ingreso += asesorNum(f.ingreso);
      porMes[f.mes].egreso += asesorNum(f.egreso);
      porMes[f.mes].items += 1;
    });
    const meses = Object.entries(porMes).sort(([a], [b]) => a.localeCompare(b)).map(([mes, v]) => ({
      mes,
      ingreso_usd: Math.round(v.ingreso),
      egreso_usd: Math.round(v.egreso),
      neto_usd: Math.round(v.ingreso - v.egreso),
      operaciones: v.items,
    }));
    return {
      criterio: 'Flujo futuro por vencimiento; las operaciones vencidas se conservan en resultado financiero, no en flujo proyectado.',
      meses: meses.slice(0, 18),
      total_ingresos_usd: meses.reduce((acc, m) => acc + m.ingreso_usd, 0),
      total_egresos_usd: meses.reduce((acc, m) => acc + m.egreso_usd, 0),
      meses_negativos: meses.filter(m => m.neto_usd < 0).slice(0, 8),
    };
  }

  function buildTasasImplicitasResumen(maxItems = 14) {
    if (typeof precios === 'undefined' || !precios) return [];
    const cont = {};
    const futuros = [];
    Object.entries(precios).forEach(([key, precio]) => {
      const n = asesorNum(precio, null);
      if (n == null) return;
      const contMatch = String(key).match(/^(.+)_CONT$/);
      if (contMatch) {
        cont[contMatch[1]] = n;
        return;
      }
      const match = String(key).match(/^(.+)_(\d{1,2})_(\d{4})$/);
      if (!match) return;
      const producto = match[1];
      const mes = parseInt(match[2], 10);
      const anio = parseInt(match[3], 10);
      if (typeof isExpiredMonthYear === 'function' && isExpiredMonthYear(mes, anio)) return;
      futuros.push({ producto, mes, anio, precio: n });
    });
    const hoy = new Date();
    return futuros
      .filter(f => cont[f.producto])
      .map(f => {
        const meses = asesorMonthsBetween(hoy, f.anio, f.mes);
        const directa = ((f.precio / cont[f.producto]) - 1) * 100;
        return {
          producto: f.producto,
          vencimiento: f.anio + '-' + String(f.mes).padStart(2, '0'),
          meses,
          precio_disponible: asesorRound(cont[f.producto], 2),
          precio_futuro: asesorRound(f.precio, 2),
          tasa_directa_pct: asesorRound(directa, 2),
          tna_pct: asesorRound(directa * (12 / meses), 2),
        };
      })
      .sort((a, b) => a.producto.localeCompare(b.producto) || a.vencimiento.localeCompare(b.vencimiento))
      .slice(0, maxItems);
  }

  function buildTradingDiagnostics() {
    const ops = asesorOps();
    const porProducto = buildProductoTradingRows();
    const derivados = buildDerivadosTradingResumen(ops);
    const flujo = buildFlujoTradingResumen(ops);
    const tasas = buildTasasImplicitasResumen();
    const alertas = [];

    if (derivados.vencidos_no_entregados > 0) {
      alertas.push('Hay derivados vencidos no entregados: conservan resultado financiero, pero no modifican delta ni precios promedio de posición.');
    }
    porProducto
      .filter(r => r.concentracion_neta_pct != null && r.concentracion_neta_pct >= 45)
      .forEach(r => alertas.push(`${r.producto}: concentración neta alta (${r.concentracion_neta_pct}% de la exposición neta).`));
    porProducto
      .filter(r => (r.long_tn || r.short_tn) && r.precio_mercado == null)
      .forEach(r => alertas.push(`${r.producto}: falta precio de mercado para completar brechas y valuación.`));
    if (flujo.meses_negativos.length) {
      alertas.push(`Flujo proyectado negativo en ${flujo.meses_negativos.length} mes(es); revisar timing de ingresos y egresos.`);
    }
    const tasasNegativas = tasas.filter(t => t.tasa_directa_pct != null && t.tasa_directa_pct < 0);
    if (tasasNegativas.length) {
      alertas.push('Hay tasas implícitas negativas en algunos vencimientos; revisar carry y conveniencia financiera.');
    }

    return {
      modelo: 'D4 + Delta + Flujo',
      alcance: 'Diagnóstico informativo para discusión comercial; no constituye recomendación de inversión ni instrucción de operación.',
      fecha_calculo: new Date().toISOString(),
      campania: (typeof activeCampaign !== 'undefined' && activeCampaign) ? activeCampaign : (typeof getLegacyCampaign === 'function' ? getLegacyCampaign() : null),
      dimensiones_d4: {
        precio: 'Brecha contra mercado, tasas implícitas, precio promedio y vencimientos.',
        financiera: 'Flujo proyectado, resultado financiero de derivados y carry.',
        logistica: 'Vencimientos, entregas y concentración por producto.',
        impositiva: 'No modelada automáticamente; el agente debe pedir datos antes de inferir impacto fiscal.',
      },
      resumen_operativo: {
        operaciones_confirmadas: ops.length,
        productos_con_posicion: porProducto.length,
        derivados_total: derivados.total,
        derivados_vencidos_no_entregados: derivados.vencidos_no_entregados,
      },
      por_producto: porProducto,
      concentracion_top: porProducto
        .slice()
        .sort((a, b) => (b.concentracion_neta_pct || 0) - (a.concentracion_neta_pct || 0))
        .slice(0, 5),
      derivados,
      flujo,
      tasas_implicitas: tasas,
      alertas,
    };
  }

  function construirContexto() {
    const ctx = { panel: 'agricultura' };
    try {
      if (typeof calcularCartera === 'function') {
        const c = calcularCartera();
        ctx.cartera = {
          valor_total_usd: Math.round(c.cartera),
          realizado_usd: Math.round(c.realizado),
          pendiente_usd: Math.round(c.pendiente),
        };
      }
      if (typeof calcularPorProducto === 'function') {
        const m = calcularPorProducto();
        ctx.por_producto = Object.entries(m)
          .filter(([, v]) => v.longTn || v.shortTn || v.pMercado != null)
          .map(([prod, v]) => ({
            producto: prod,
            tn_compradas: Math.round(v.longTn || 0),
            tn_vendidas: Math.round(v.shortTn || 0),
                precio_prom_compra: v.pCompra_den ? +(v.pCompra_num_adj / v.pCompra_den).toFixed(2) : null,
                precio_prom_venta: v.pVenta_den ? +(v.pVenta_num_adj / v.pVenta_den).toFixed(2) : null,
                precio_mercado: v.pMercado != null ? +Number(v.pMercado).toFixed(2) : null,
                tn_netas: Math.round((v.longTn || 0) - (v.shortTn || 0)),
                delta_sobre_bruto_pct: ((v.longTn || 0) + (v.shortTn || 0)) ? +((((v.longTn || 0) - (v.shortTn || 0)) / ((v.longTn || 0) + (v.shortTn || 0))) * 100).toFixed(1) : null,
              }));
      }
      if (typeof currentCliente !== 'undefined' && currentCliente) {
        ctx.cliente = {
          empresa: currentCliente.nombre_empresa,
          campania: (typeof activeCampaign !== 'undefined' && activeCampaign) ? activeCampaign : currentCliente.campania,
          nivel: currentCliente.agricultura_nivel || 'ESTANDAR',
        };
      }
      ctx.trading_diagnostics = buildTradingDiagnostics();
    } catch (e) { console.warn('contexto asesor:', e); }
    return ctx;
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function fmt(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[-•]\s+/gm, '• ')
      .replace(/\n/g, '<br>');
  }
  function addMsg(role, html) {
    const chat = document.getElementById('asesor-chat');
    if (!chat) return null;
    const div = document.createElement('div');
    div.className = role === 'user' ? 'asesor-msg-user' : 'asesor-msg-ia';
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  window.asesorEnviar = async function (textoFijo) {
    const input = document.getElementById('asesor-input');
    const mensaje = (textoFijo != null ? textoFijo : (input ? input.value : '')).trim();
    if (!mensaje) return;

    if (SOLO_PRO && !esPro()) {
      addMsg('ia', 'El Asesor IA está disponible para cuentas <b>PRO</b>. Consultá con CTX para habilitarlo.');
      if (textoFijo == null && input) input.value = '';
      return;
    }

    if (textoFijo == null && input) input.value = '';
    addMsg('user', esc(mensaje));
    historial.push({ role: 'user', content: mensaje });

    const sendBtn = document.getElementById('asesor-send');
    if (sendBtn) sendBtn.disabled = true;
    const typing = addMsg('ia', '<span class="asesor-typing"><span></span><span></span><span></span></span>');

    try {
      const resp = await fetch(FN_URL, {
        method: 'POST',
        headers: await ctxAuthHeaders(),
        body: JSON.stringify({
          panel: 'agricultura',
          mensaje,
          contexto: construirContexto(),
          historial: historial.slice(0, -1),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        if (typing) typing.innerHTML = 'Hubo un problema al generar el análisis. ' +
          (data.error ? esc(data.error) : '') + ' Probá de nuevo en un momento.';
        return;
      }
      if (typing) typing.innerHTML = fmt(data.texto || 'Sin respuesta.');
      historial.push({ role: 'assistant', content: data.texto || '' });
    } catch (e) {
      if (typing) typing.innerHTML = 'No pude conectar con el asesor. Revisá tu conexión e intentá de nuevo.';
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  };
})();
