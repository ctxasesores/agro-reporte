/* ============================================================
   CTX AgroCartera — KPIs · Tablero financiero
   kpi-financiero.js  (lo usan index.html y admin.html)

   Qué hace:
   - Motor de cálculo de los indicadores financieros (calce de moneda,
     intereses y servicio de deuda, flujo sostenible, reposición de
     capital, caja mensual y pico de financiamiento).
   - Tablero (tiles con semáforo, gráfico de flujo y caja, tablas).
   - Editor de carga: flujo mensual rubro × moneda, bienes de uso y
     configuración del ejercicio. Guarda con la RPC fin_guardar().

   Uso:
     CtxFin.montar(elemento, { sb, clienteId, clienteNombre,
                               tema: 'oscuro' | 'claro', puedeEditar })
     CtxFin.recargar(elemento)

   Todos los cálculos se hacen en ARS (cada mes a su tipo de cambio).
   La vista en USD divide cada mes por su propio tipo de cambio.
   Los umbrales viven en UMBRALES: cambiar un número ahí cambia el
   semáforo en todo el tablero.
   ============================================================ */
(function (global) {
  'use strict';

  const FIN_VERSION = '2026-09-28.1';

  /* ───────────── Estructura de carga ───────────── */
  const RUBROS = [
    { clave: 'venta',         nombre: 'Ventas',                  grupo: 'Operación', monedas: ['ARS', 'USD', 'DL'] },
    { clave: 'costo_directo', nombre: 'Costos directos',         grupo: 'Operación', monedas: ['ARS', 'USD', 'DL'] },
    { clave: 'estructura',    nombre: 'Gastos de estructura',    grupo: 'Operación', monedas: ['ARS', 'USD'] },
    { clave: 'interes',       nombre: 'Intereses',               grupo: 'Deuda',     monedas: ['ARS', 'USD', 'DL'] },
    { clave: 'capital',       nombre: 'Amortización de capital', grupo: 'Deuda',     monedas: ['ARS', 'USD', 'DL'] },
    { clave: 'impuesto',      nombre: 'Impuestos pagados',       grupo: 'Impuestos, inversión y retiros', monedas: ['ARS'] },
    { clave: 'capex_mant',    nombre: 'Capex de mantenimiento',  grupo: 'Impuestos, inversión y retiros', monedas: ['ARS', 'USD'] },
    { clave: 'capex_crec',    nombre: 'Capex de crecimiento',    grupo: 'Impuestos, inversión y retiros', monedas: ['ARS', 'USD'] },
    { clave: 'retiro',        nombre: 'Retiros',                 grupo: 'Impuestos, inversión y retiros', monedas: ['ARS', 'USD'] },
  ];
  const MONEDAS = ['ARS', 'USD', 'DL'];
  const NOMBRE_MONEDA = { ARS: 'ARS', USD: 'USD', DL: 'Dólar link' };
  const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ───────────── Umbrales (única fuente de verdad) ─────────────
     tipo 'menor': verde si valor <= verde, amarillo si <= amarillo, si no rojo.
     tipo 'mayor': verde si valor >= verde, amarillo si >= amarillo, si no rojo. */
  const UMBRALES = {
    caja_min:    { nombre: 'Caja mínima del período', corto: 'Caja mínima',
                   regla: 'Verde si nunca baja de un mes de egresos · amarillo si queda positiva pero por debajo · rojo si queda negativa algún mes',
                   que: 'El punto más bajo de la caja acumulada. Si es negativo, ese monto es la necesidad máxima de financiamiento.' },
    meses_neg:   { nombre: 'Meses con flujo negativo', corto: 'Meses con flujo negativo', tipo: 'menor', verde: 0, amarillo: 2,
                   regla: 'Verde 0 · amarillo 1 a 2 · rojo 3 o más',
                   que: 'Meses en los que el flujo después de deuda e inversión es negativo.' },
    serv_fs:     { nombre: 'Servicio de deuda / flujo sostenible', corto: 'Deuda / flujo sostenible', tipo: 'menor', verde: 0.70, amarillo: 1.00,
                   regla: 'Verde hasta 70% · amarillo 70% a 100% · rojo más de 100%',
                   que: 'Cuánto del flujo que queda después de impuestos, reposición y retiros se va en pagar deuda (capital + intereses).' },
    calce_dol:   { nombre: 'Calce dolarizado (USD + dólar link)', corto: 'Calce dolarizado', tipo: 'calce', rojo: 0.80, techo: 1.20,
                   regla: 'Rojo menos de 0,8x · verde 0,8x a 1,2x · más de 1,2x es informativo (largo en USD)',
                   que: '% de ventas dolarizadas dividido % de costos directos dolarizados. Menos de 1 = una devaluación sube más los costos que las ventas.' },
    int_rb:      { nombre: 'Intereses / resultado bruto', corto: 'Intereses / resultado bruto', tipo: 'menor', verde: 0.10, amarillo: 0.25,
                   regla: 'Verde hasta 10% · amarillo 10% a 25% · rojo más de 25%',
                   que: 'Cuánto del margen productivo consume el costo financiero.' },
    int_ebit:    { nombre: 'Intereses / resultado operativo (EBIT)', corto: 'Intereses / EBIT', tipo: 'menor', verde: 0.20, amarillo: 0.45,
                   regla: 'Verde hasta 20% · amarillo 20% a 45% · rojo más de 45%',
                   que: 'Peso de los intereses sobre el resultado operativo, antes de intereses e impuestos.' },
    serv_rb:     { nombre: 'Servicio de deuda / resultado bruto', corto: 'Servicio / resultado bruto', tipo: 'menor', verde: 0.30, amarillo: 0.60,
                   regla: 'Verde hasta 30% · amarillo 30% a 60% · rojo más de 60%',
                   que: 'Si el margen productivo alcanza para pagar capital e intereses del período.' },
    serv_ebit:   { nombre: 'Servicio de deuda / resultado operativo (EBIT)', corto: 'Servicio / EBIT', tipo: 'menor', verde: 0.50, amarillo: 0.80,
                   regla: 'Verde hasta 50% · amarillo 50% a 80% · rojo más de 80% o EBIT negativo',
                   que: 'La prueba exigente de capacidad de pago: deuda contra resultado después de estructura y depreciación.' },
    serv_ebitda: { nombre: 'Servicio de deuda / EBITDA', corto: 'Servicio / EBITDA', tipo: 'menor', verde: 0.35, amarillo: 0.65,
                   regla: 'Verde hasta 35% · amarillo 35% a 65% · rojo más de 65%',
                   que: 'Deuda contra la caja operativa antes de reposición de capital.' },
    capex_dep:   { nombre: 'Capex de mantenimiento / depreciación', corto: 'Capex mant. / depreciación', tipo: 'mayor', verde: 1.00, amarillo: 0.70,
                   regla: 'Verde 100% o más · amarillo 70% a 100% · rojo menos de 70%',
                   que: 'Si se repone el capital que se consume por uso. Menos de 100% puede indicar descapitalización.' },
  };

  const ETIQUETA_ESTADO = { verde: 'Cómodo', amarillo: 'Atención', rojo: 'Riesgo', info: 'Informativo', na: 'Sin dato' };

  /* ───────────── Utilidades de fecha ───────────── */
  function primerDiaMes(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-01` : null;
  }
  function sumarMeses(periodo, n) {
    const [a, m] = periodo.split('-').map(Number);
    const t = a * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
  }
  function mesesDelEjercicio(inicio, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(sumarMeses(inicio, i));
    return out;
  }
  function etiquetaMes(periodo, largo) {
    const [a, m] = periodo.split('-').map(Number);
    return largo ? `${MESES_LARGOS[m - 1]} ${a}` : `${MESES_CORTOS[m - 1]} ${String(a).slice(2)}`;
  }
  /** Inicio por defecto: el último julio (ejercicio agrícola jul–jun). */
  function inicioPorDefecto() {
    const d = new Date();
    const anio = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return `${anio}-07-01`;
  }

  /* ───────────── Motor ───────────── */
  function normalizarConfig(c) {
    c = c || {};
    const meses = Math.min(24, Math.max(1, parseInt(c.meses, 10) || 12));
    return {
      inicio: primerDiaMes(c.inicio) || inicioPorDefecto(),
      meses,
      caja_inicial: Number(c.caja_inicial) || 0,
      caja_inicial_moneda: c.caja_inicial_moneda === 'USD' ? 'USD' : 'ARS',
      tasa_ganancias: c.tasa_ganancias == null || c.tasa_ganancias === '' ? 0.30 : Math.min(1, Math.max(0, Number(c.tasa_ganancias))),
      escala: [1, 1000, 1000000].includes(Number(c.escala)) ? Number(c.escala) : 1,
    };
  }

  function depreciacionMensual(bien) {
    const origen = Number(bien.valor_origen) || 0;
    const residual = Number(bien.valor_residual) || 0;
    const vida = Number(bien.vida_util_anios) || 0;
    if (vida <= 0 || origen <= residual) return 0;
    return (origen - residual) / vida / 12;
  }
  function bienActivoEn(bien, periodo) {
    const alta = primerDiaMes(bien.fecha_alta);
    if (!alta) return true;
    if (periodo < alta) return false;
    const vidaMeses = Math.round((Number(bien.vida_util_anios) || 0) * 12);
    return periodo < sumarMeses(alta, vidaMeses);
  }

  const vacioMon = () => ({ ARS: 0, USD: 0, DL: 0 });
  const totalMon = o => o.ARS + o.USD + o.DL;

  /* ───────────── Curva de tipo de cambio ─────────────
     Qué tipo de cambio pesifica / dolariza cada mes, si el usuario no cargó uno:
     - Meses cerrados: promedio del oficial (Com. A3500, tabla tipo_de_cambio) de ese mes.
     - Mes en curso y siguientes: ajuste del dólar futuro (DLR, A3) del contrato de ese mes.
       Los meses sin contrato se interpolan entre contratos (log-lineal, a fin de mes).
       Después del último contrato se proyecta con la tasa implícita spot → último contrato.
     Cada mes lleva su fuente para mostrarla en el tablero y en el editor. */
  const DIA_MS = 86400000;
  const fechaUTC = iso => { const [a, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(a, m - 1, d); };
  const finDeMes = periodo => { const [a, m] = periodo.split('-').map(Number); return Date.UTC(a, m, 0); };
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const vencimientoAPeriodo = v => {
    const m = String(v || '').match(/^(\d{1,2})_(\d{4})$/);
    return m ? `${m[2]}-${String(m[1]).padStart(2, '0')}-01` : null;
  };

  /**
   * curva = { oficial: [{fecha, valor}], dlr: [{vencimiento, precio, fecha}] }
   * Devuelve { porMes: {periodo: {tc, fuente}}, meta } o null si no hay datos.
   */
  function construirCurvaTc(periodos, curva, hoy) {
    if (!curva) return null;
    hoy = (hoy || hoyISO()).slice(0, 10);
    const mesHoy = primerDiaMes(hoy);
    const oficial = (curva.oficial || [])
      .map(o => ({ fecha: String(o.fecha).slice(0, 10), valor: Number(o.valor) }))
      .filter(o => o.valor > 0 && o.fecha <= hoy)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const spot = oficial.length ? oficial[oficial.length - 1] : null;
    const promedios = {};
    oficial.forEach(o => {
      const p = primerDiaMes(o.fecha);
      (promedios[p] = promedios[p] || []).push(o.valor);
    });
    Object.keys(promedios).forEach(p => { const v = promedios[p]; promedios[p] = v.reduce((a, b) => a + b, 0) / v.length; });

    // Contratos vigentes (mes actual en adelante), un precio por mes.
    const porPeriodo = {};
    (curva.dlr || []).forEach(c => {
      const p = vencimientoAPeriodo(c.vencimiento);
      const precio = Number(c.precio);
      if (!p || p < mesHoy || !(precio > 0)) return;
      porPeriodo[p] = { precio, fecha: c.fecha ? String(c.fecha).slice(0, 10) : null };
    });
    const contratos = Object.keys(porPeriodo).sort().map(p => ({ periodo: p, t: finDeMes(p), F: porPeriodo[p].precio, fecha: porPeriodo[p].fecha }));
    const puntos = (spot ? [{ t: fechaUTC(spot.fecha), F: spot.valor }] : []).concat(contratos);
    const ultimo = contratos[contratos.length - 1];
    const tasaDiaria = spot && ultimo && ultimo.t > fechaUTC(spot.fecha)
      ? Math.log(ultimo.F / spot.valor) / ((ultimo.t - fechaUTC(spot.fecha)) / DIA_MS) : null;

    const promediosOrd = Object.keys(promedios).sort();
    const porMes = {};
    periodos.forEach(p => {
      if (p < mesHoy) {
        if (promedios[p]) { porMes[p] = { tc: promedios[p], fuente: 'oficial' }; return; }
        const cercano = promediosOrd.find(k => k > p) || promediosOrd[promediosOrd.length - 1];
        if (cercano) { porMes[p] = { tc: promedios[cercano], fuente: 'estimado' }; return; }
        if (spot) { porMes[p] = { tc: spot.valor, fuente: 'estimado' }; }
        return;
      }
      if (porPeriodo[p]) { porMes[p] = { tc: porPeriodo[p].precio, fuente: 'dlr' }; return; }
      if (!puntos.length) return;
      const t = finDeMes(p);
      let antes = null, despues = null;
      puntos.forEach(pt => {
        if (pt.t <= t && (!antes || pt.t > antes.t)) antes = pt;
        if (pt.t >= t && (!despues || pt.t < despues.t)) despues = pt;
      });
      if (antes && despues && despues.t > antes.t) {
        const w = (t - antes.t) / (despues.t - antes.t);
        porMes[p] = { tc: Math.exp(Math.log(antes.F) * (1 - w) + Math.log(despues.F) * w), fuente: contratos.length ? 'interpolado' : 'ultimo' };
      } else if (antes && tasaDiaria != null && contratos.length) {
        porMes[p] = { tc: antes.F * Math.exp(tasaDiaria * ((t - antes.t) / DIA_MS)), fuente: 'extrapolado' };
      } else if (antes || despues) {
        porMes[p] = { tc: (antes || despues).F, fuente: 'ultimo' };
      }
    });

    let meta = { spot: spot ? spot.valor : null, spotFecha: spot ? spot.fecha : null, contratos: contratos.length };
    if (ultimo && spot && tasaDiaria != null) {
      const dias = (ultimo.t - fechaUTC(spot.fecha)) / DIA_MS;
      const ratio = ultimo.F / spot.valor;
      meta = {
        ...meta,
        ultimoContrato: ultimo.periodo,
        ajusteFecha: contratos.map(c => c.fecha).filter(Boolean).sort().pop() || null,
        tnaImplicita: (ratio - 1) * 365 / dias,
        teaImplicita: Math.pow(ratio, 365 / dias) - 1,
      };
    }
    return { porMes, meta };
  }

  const NOMBRE_FUENTE_TC = {
    manual: 'cargado', oficial: 'oficial', dlr: 'futuro', interpolado: 'futuro*',
    extrapolado: 'proyectado', ultimo: 'último', estimado: 'estimado',
  };
  const AYUDA_FUENTE_TC = {
    manual: 'Tipo de cambio cargado a mano',
    oficial: 'Promedio del oficial (A3500) del mes',
    dlr: 'Ajuste del dólar futuro (DLR) de ese mes',
    interpolado: 'Interpolado entre contratos de dólar futuro',
    extrapolado: 'Proyectado con la tasa implícita del dólar futuro',
    ultimo: 'Último tipo de cambio conocido',
    estimado: 'Sin dato del mes: se usa el más cercano',
  };

  /**
   * datos = { config, tipoCambio: {periodo: tc}, lineas: [{periodo, rubro, moneda, monto}],
   *           bienes: [...], tcDefault }
   */
  function calcular(datos) {
    datos = datos || {};
    const cfg = normalizarConfig(datos.config);
    const periodos = mesesDelEjercicio(cfg.inicio, cfg.meses);
    const enRango = new Set(periodos);
    const tcMap = datos.tipoCambio || {};
    const bienes = (datos.bienes || []).filter(b => b && depreciacionMensual(b) > 0);
    const avisos = [];

    // Tipo de cambio por mes: el cargado a mano manda; si no, la curva
    // (oficial para meses cerrados, dólar futuro para los que vienen);
    // sin curva, el último conocido o el default.
    const curvaTc = construirCurvaTc(periodos, datos.curva, datos.hoy);
    const explicitos = periodos.map(p => Number(tcMap[p]) > 0 ? Number(tcMap[p]) : null);
    const primero = explicitos.find(v => v != null) || (Number(datos.tcDefault) > 0 ? Number(datos.tcDefault) : null);
    let previo = null;
    let sinTc = false;
    const tcs = explicitos.map((v, i) => {
      if (v != null) { previo = v; return { tc: v, fuente: 'manual' }; }
      const c = curvaTc && curvaTc.porMes[periodos[i]];
      if (c && c.tc > 0) return { tc: c.tc, fuente: c.fuente };
      const t = previo || primero;
      if (!t) { sinTc = true; return { tc: 1, fuente: 'estimado' }; }
      return { tc: t, fuente: 'ultimo' };
    });

    // Índice de líneas del ejercicio
    const idx = {};
    let lineasEnRango = 0;
    (datos.lineas || []).forEach(l => {
      const p = primerDiaMes(l.periodo);
      if (!enRango.has(p)) return;
      const monto = Number(l.monto) || 0;
      if (!monto) return;
      lineasEnRango++;
      idx[p] = idx[p] || {};
      idx[p][l.rubro] = idx[p][l.rubro] || vacioMon();
      if (MONEDAS.includes(l.moneda)) idx[p][l.rubro][l.moneda] += monto;
    });

    const meses = periodos.map((p, i) => {
      const tc = tcs[i].tc;
      const orig = r => (idx[p] && idx[p][r]) || vacioMon();
      const enArs = r => { const o = orig(r); return { ARS: o.ARS, USD: o.USD * tc, DL: o.DL * tc }; };
      const ventas = enArs('venta'), costos = enArs('costo_directo'), estructura = enArs('estructura');
      const interes = enArs('interes'), capital = enArs('capital');
      const dep = bienes.reduce((acc, b) => {
        if (!bienActivoEn(b, p)) return acc;
        const d = depreciacionMensual(b);
        return acc + (b.moneda === 'ARS' ? d : d * tc);
      }, 0);
      const m = {
        periodo: p, etiqueta: etiquetaMes(p), tc, tcFuente: tcs[i].fuente,
        tcEstimado: ['ultimo', 'estimado', 'extrapolado'].includes(tcs[i].fuente),
        conDatos: !!idx[p],
        ventasMon: ventas, costosMon: costos, estructuraMon: estructura,
        servicioMon: { ARS: interes.ARS + capital.ARS, USD: interes.USD + capital.USD, DL: interes.DL + capital.DL },
        ventas: totalMon(ventas), costos: totalMon(costos), estructura: totalMon(estructura),
        intereses: totalMon(interes), capital: totalMon(capital),
        impuestosCargados: totalMon(enArs('impuesto')),
        capexMant: totalMon(enArs('capex_mant')), capexCrec: totalMon(enArs('capex_crec')), retiros: totalMon(enArs('retiro')),
        dep,
      };
      m.rb = m.ventas - m.costos;
      m.ebitda = m.rb - m.estructura;
      m.ebit = m.ebitda - m.dep;
      m.rai = m.ebit - m.intereses;
      m.servicio = m.intereses + m.capital;
      return m;
    });

    // Impuestos: cargados, o estimados sobre el resultado anual.
    const raiAnual = meses.reduce((a, m) => a + m.rai, 0);
    const impuestoCargado = meses.some(m => m.impuestosCargados !== 0);
    const impuestoEstimadoTotal = impuestoCargado ? 0 : Math.max(0, raiAnual) * cfg.tasa_ganancias;
    meses.forEach(m => {
      m.impuestos = impuestoCargado ? m.impuestosCargados : impuestoEstimadoTotal / meses.length;
      m.fs = m.ebitda - m.impuestos - m.capexMant - m.retiros;
      m.post = m.fs - m.servicio - m.capexCrec;
    });

    // Caja acumulada (ARS y USD por separado, cada una en su moneda)
    const tc0 = meses[0].tc;
    const cajaIniArs = cfg.caja_inicial_moneda === 'USD' ? cfg.caja_inicial * tc0 : cfg.caja_inicial;
    const cajaIniUsd = cfg.caja_inicial_moneda === 'USD' ? cfg.caja_inicial : cfg.caja_inicial / tc0;
    let cajaA = cajaIniArs, cajaU = cajaIniUsd;
    meses.forEach(m => {
      cajaA += m.post; cajaU += m.post / m.tc;
      m.caja = cajaA; m.cajaUsd = cajaU;
    });

    // Totales del período
    const CAMPOS = ['ventas', 'costos', 'estructura', 'rb', 'ebitda', 'dep', 'ebit', 'intereses', 'capital', 'rai',
                    'impuestos', 'servicio', 'capexMant', 'capexCrec', 'retiros', 'fs', 'post'];
    const anual = {};
    const anualUsd = {};
    CAMPOS.forEach(f => {
      anual[f] = meses.reduce((a, m) => a + m[f], 0);
      anualUsd[f] = meses.reduce((a, m) => a + m[f] / m.tc, 0);
    });
    const sumMon = (campo, enUsd) => {
      const o = vacioMon();
      meses.forEach(m => MONEDAS.forEach(k => { o[k] += enUsd ? m[campo][k] / m.tc : m[campo][k]; }));
      return o;
    };

    // Calce por moneda
    const V = sumMon('ventasMon'), C = sumMon('costosMon'), E = sumMon('estructuraMon'), S = sumMon('servicioMon');
    const Vu = sumMon('ventasMon', true), Cu = sumMon('costosMon', true), Eu = sumMon('estructuraMon', true), Su = sumMon('servicioMon', true);
    const vTot = totalMon(V), cTot = totalMon(C);
    const filaMoneda = (clave, nombre, pick) => {
      const v = pick(V), c = pick(C), e = pick(E), s = pick(S);
      const pv = vTot > 0 ? v / vTot : null;
      const pc = cTot > 0 ? c / cTot : null;
      return {
        clave, nombre, pctVentas: pv, pctCostos: pc,
        calce: pv != null && pc ? pv / pc : null,
        exposicion: { ARS: v - c - e, USD: pick(Vu) - pick(Cu) - pick(Eu) },
        exposicionPostDeuda: { ARS: v - c - e - s, USD: pick(Vu) - pick(Cu) - pick(Eu) - pick(Su) },
      };
    };
    const moneda = [
      filaMoneda('ARS', 'ARS', o => o.ARS),
      filaMoneda('USD', 'USD', o => o.USD),
      filaMoneda('DL', 'Dólar link', o => o.DL),
      filaMoneda('DOL', 'Dolarizado', o => o.USD + o.DL),
    ];

    // Indicadores
    const ind = {};
    const deuda = (clave, num, den) => {
      if (num <= 0) return evaluar(clave, 0, { sinDeuda: true });
      if (den <= 0) return evaluar(clave, null, { denominadorNegativo: true });
      return evaluar(clave, num / den);
    };
    ind.int_rb = deuda('int_rb', anual.intereses, anual.rb);
    ind.int_ebit = deuda('int_ebit', anual.intereses, anual.ebit);
    ind.serv_rb = deuda('serv_rb', anual.servicio, anual.rb);
    ind.serv_ebit = deuda('serv_ebit', anual.servicio, anual.ebit);
    ind.serv_ebitda = deuda('serv_ebitda', anual.servicio, anual.ebitda);
    ind.serv_fs = deuda('serv_fs', anual.servicio, anual.fs);
    ind.capex_dep = anual.dep > 0 ? evaluar('capex_dep', anual.capexMant / anual.dep) : evaluar('capex_dep', null, { sinBienes: true });
    ind.capex_total_dep = { valor: anual.dep > 0 ? (anual.capexMant + anual.capexCrec) / anual.dep : null, estado: anual.dep > 0 ? 'info' : 'na', lectura: anual.dep > 0 ? ((anual.capexMant + anual.capexCrec) / anual.dep >= 1 ? 'Repone y expande' : 'Por debajo del desgaste') : 'Sin bienes de uso' };
    ind.dep_ebitda = { valor: anual.ebitda > 0 && anual.dep > 0 ? anual.dep / anual.ebitda : null, estado: anual.ebitda > 0 && anual.dep > 0 ? 'info' : 'na', lectura: anual.ebitda > 0 ? 'Intensidad de capital' : 'EBITDA negativo' };
    const dol = moneda[3];
    ind.calce_dol = evaluar('calce_dol', dol.calce, { sinCostos: !(dol.pctCostos > 0) });
    const mesesNeg = meses.filter(m => m.post < 0).length;
    ind.meses_neg = evaluar('meses_neg', mesesNeg);

    // Caja mínima y colchón
    let minimo = meses[0];
    meses.forEach(m => { if (m.caja < minimo.caja) minimo = m; });
    const egresosMes = (anual.costos + anual.estructura + anual.intereses + anual.capital + anual.impuestos +
                        anual.capexMant + anual.capexCrec + anual.retiros) / meses.length;
    let estadoCaja = 'verde', lecturaCaja = 'Con colchón';
    if (minimo.caja < 0) { estadoCaja = 'rojo'; lecturaCaja = 'Necesita financiamiento'; }
    else if (minimo.caja < egresosMes) { estadoCaja = 'amarillo'; lecturaCaja = 'Colchón justo'; }
    ind.caja_min = { valor: minimo.caja, estado: estadoCaja, lectura: lecturaCaja };
    const caja = {
      inicialArs: cajaIniArs, inicialUsd: cajaIniUsd,
      minima: minimo.caja, minimaUsd: minimo.cajaUsd, mesMinimo: minimo.periodo,
      final: meses[meses.length - 1].caja, finalUsd: meses[meses.length - 1].cajaUsd,
      necesidad: minimo.caja < 0 ? -minimo.caja : 0, necesidadUsd: minimo.cajaUsd < 0 ? -minimo.cajaUsd : 0,
      egresosMes,
    };

    // Acción del mes
    const rojoServ = UMBRALES.serv_ebitda.amarillo;
    meses.forEach(m => {
      if (m.caja < 0) m.accion = { estado: 'rojo', texto: 'Cubrir déficit de caja' };
      else if (m.post < 0) m.accion = { estado: 'amarillo', texto: 'Usar caja acumulada' };
      else if (m.servicio > 0 && m.ebitda > 0 && m.servicio / m.ebitda > rojoServ) m.accion = { estado: 'amarillo', texto: 'Revisar vencimientos' };
      else m.accion = { estado: 'verde', texto: 'Monitorear' };
    });

    // Avisos
    const vacio = lineasEnRango === 0 && bienes.length === 0;
    if (!vacio) {
      if (!impuestoCargado) {
        if (impuestoEstimadoTotal > 0) avisos.push({ clave: 'imp', texto: `Impuestos estimados: ${Math.round(cfg.tasa_ganancias * 100)}% del resultado antes de impuestos del período, repartido en ${meses.length} meses. Cargá los impuestos pagados para usar los reales.` });
        else avisos.push({ clave: 'imp', texto: 'Sin impuestos: no hay impuestos cargados y el resultado antes de impuestos del período no es positivo.' });
      }
      if (sinTc) avisos.push({ clave: 'tc', grave: true, texto: 'Falta el tipo de cambio: cargalo en el editor. Mientras tanto los montos en USD no se convierten bien.' });
      else avisos.push({ clave: 'tc', texto: resumenTc(meses, curvaTc) });
      const meta = curvaTc && curvaTc.meta;
      if (meta && meta.ajusteFecha && (fechaUTC(datos.hoy || hoyISO()) - fechaUTC(meta.ajusteFecha)) / DIA_MS > 7) {
        avisos.push({ clave: 'tc-viejo', grave: true, texto: `El dólar futuro no se actualiza desde el ${fmtFechaCorta(meta.ajusteFecha)}: revisá la sincronización de A3.` });
      }
      if (!bienes.length) avisos.push({ clave: 'dep', texto: 'Sin bienes de uso: la depreciación es cero y no se mide la reposición de capital.' });
      const sinDatos = meses.filter(m => !m.conDatos).length;
      if (sinDatos) avisos.push({ clave: 'meses', texto: `${sinDatos} ${sinDatos === 1 ? 'mes' : 'meses'} del ejercicio sin datos cargados.` });
    }

    return {
      version: FIN_VERSION, config: cfg, periodos, meses, anual, anualUsd, moneda, curvaTc,
      indicadores: ind, caja, avisos, vacio, impuestoCargado, impuestoEstimadoTotal,
      bienesConDep: bienes.length,
    };
  }

  function fmtFechaCorta(iso) { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a.slice(2)}`; }

  /** "Tipo de cambio: jul–ago oficial (promedio BCRA); sep–abr dólar futuro A3 …" */
  function resumenTc(meses, curvaTc) {
    const tramos = [];
    meses.forEach(m => {
      const f = m.tcFuente === 'interpolado' ? 'dlr' : m.tcFuente;
      const u = tramos[tramos.length - 1];
      if (u && u.f === f) u.hasta = m; else tramos.push({ f, desde: m, hasta: m });
    });
    const rango = t => t.desde === t.hasta ? t.desde.etiqueta : `${t.desde.etiqueta} a ${t.hasta.etiqueta}`;
    const meta = curvaTc && curvaTc.meta;
    const txt = {
      manual: 'cargado a mano',
      oficial: 'promedio del oficial (A3500)',
      dlr: `dólar futuro A3${meta && meta.ajusteFecha ? ` (ajuste del ${fmtFechaCorta(meta.ajusteFecha)})` : ''}`,
      extrapolado: `proyectado con la tasa implícita del dólar futuro${meta && meta.tnaImplicita != null ? ` (${fmtPct(meta.tnaImplicita)} TNA)` : ''}`,
      ultimo: 'último conocido',
      estimado: 'estimado con el dato más cercano',
    };
    return 'Tipo de cambio: ' + tramos.map(t => `${rango(t)} ${txt[t.f] || t.f}`).join('; ') + '.';
  }

  function evaluar(clave, valor, flags) {
    flags = flags || {};
    const u = UMBRALES[clave];
    if (flags.sinDeuda) return { valor: 0, estado: 'verde', lectura: 'Sin deuda en el período' };
    if (flags.denominadorNegativo) return { valor: null, estado: 'rojo', lectura: 'El resultado es negativo: no cubre la deuda' };
    if (flags.sinBienes) return { valor: null, estado: 'na', lectura: 'Sin bienes de uso cargados' };
    if (clave === 'calce_dol') {
      if (valor == null) return { valor: null, estado: 'na', lectura: flags.sinCostos ? 'Sin costos dolarizados' : 'Sin ventas cargadas' };
      if (valor < u.rojo) return { valor, estado: 'rojo', lectura: 'Corto en USD' };
      if (valor <= u.techo) return { valor, estado: 'verde', lectura: 'Calzado' };
      return { valor, estado: 'info', lectura: 'Largo en USD' };
    }
    if (valor == null || !isFinite(valor)) return { valor: null, estado: 'na', lectura: 'Sin dato' };
    let estado;
    if (u.tipo === 'mayor') estado = valor >= u.verde ? 'verde' : valor >= u.amarillo ? 'amarillo' : 'rojo';
    else estado = valor <= u.verde ? 'verde' : valor <= u.amarillo ? 'amarillo' : 'rojo';
    let lectura = ETIQUETA_ESTADO[estado];
    if (clave === 'capex_dep') lectura = { verde: 'Reposición completa', amarillo: 'Reposición parcial', rojo: 'Descapitalización' }[estado];
    if (clave === 'meses_neg') lectura = { verde: 'Sin meses negativos', amarillo: 'Revisar meses puntuales', rojo: 'Requiere plan de caja' }[estado];
    if (clave === 'serv_fs' && estado === 'rojo') lectura = 'La deuda supera el flujo sostenible';
    return { valor, estado, lectura };
  }

  /* ───────────── Formato ───────────── */
  const nf = (d) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtMonto(v, moneda) {
    if (v == null || !isFinite(v)) return '—';
    const s = v < 0 ? '−' : '';
    const a = Math.abs(v);
    let txt;
    if (a >= 1e9) txt = nf(a >= 1e11 ? 0 : 1).format(a / 1e9) + ' mil M';
    else if (a >= 1e6) txt = nf(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2).format(a / 1e6) + ' M';
    else if (a >= 1e4) txt = nf(0).format(a / 1e3) + ' mil';
    else if (a >= 1e3) txt = nf(1).format(a / 1e3) + ' mil';
    else txt = nf(0).format(a);
    return moneda ? `${s}${moneda} ${txt}` : `${s}${txt}`;
  }
  /** Eje del gráfico: sin ceros de más ("2 M", "-1,5 M", "500 mil"). */
  function fmtEje(v) {
    const s = v < 0 ? '−' : '';
    const a = Math.abs(v);
    const f = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
    if (a >= 1e9) return s + f.format(a / 1e9) + ' mil M';
    if (a >= 1e6) return s + f.format(a / 1e6) + ' M';
    if (a >= 1e3) return s + f.format(a / 1e3) + ' mil';
    return s + f.format(a);
  }
  function fmtPct(v) { return v == null || !isFinite(v) ? '—' : nf(Math.abs(v) >= 10 ? 0 : 1).format(v * 100) + '%'; }
  function fmtX(v) { return v == null || !isFinite(v) ? '—' : nf(2).format(v) + 'x'; }
  function fmtNumEditor(v) {
    if (v == null || v === '' || !isFinite(v)) return '';
    return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(v);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Lee un número escrito o pegado: "1.234,5", "1234.5", "(300)", "USD 45", "-12". */
  function parseNumero(txt) {
    if (txt == null) return null;
    let s = String(txt).trim();
    if (!s || s === '-' || s === '—') return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[^\d.,\-−]/g, '').replace('−', '-');
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (!s) return null;
    const puntos = (s.match(/\./g) || []).length;
    const comas = (s.match(/,/g) || []).length;
    if (puntos && comas) {
      const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      const mil = dec === ',' ? '.' : ',';
      s = s.split(mil).join('').replace(dec, '.');
    } else if (comas) {
      s = comas > 1 ? s.split(',').join('') : s.replace(',', '.');
    } else if (puntos) {
      if (puntos > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.split('.').join('');
    }
    const n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  /* ───────────── Caso de ejemplo (plantilla, 1.000 ha región núcleo) ───────────── */
  function datosEjemplo() {
    const TC = 1450, M = 1e6;
    const inicio = '2026-07-01';
    const P = mesesDelEjercicio(inicio, 12);
    // Plantilla en ARS millones equivalentes; USD y dólar link se pasan a USD con TC 1.450.
    const serie = {
      'venta|ARS': [25, 18, 22, 20, 25, 30, 18, 20, 35, 45, 38, 30],
      'venta|USD': [0, 0, 0, 0, 250, 320, 180, 420, 1200, 1800, 1500, 700],
      'venta|DL': [50, 90, 120, 100, 180, 200, 150, 120, 80, 60, 40, 30],
      'costo_directo|ARS': [95, 110, 120, 130, 115, 100, 90, 85, 90, 105, 110, 100],
      'costo_directo|USD': [410, 520, 350, 250, 180, 120, 150, 100, 75, 60, 50, 45],
      'costo_directo|DL': [100, 150, 300, 260, 120, 80, 70, 50, 40, 30, 25, 20],
      'estructura|ARS': [12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 14, 14],  // agregado: en la plantilla quedaba en 0
      'interes|ARS': [18, 16, 15, 14, 13, 12, 10, 9, 8, 7, 6, 5],
      'capital|ARS': [0, 50, 0, 0, 80, 0, 0, 120, 0, 0, 0, 150],
      'interes|USD': [8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3],
      'capital|USD': [0, 0, 40, 0, 0, 40, 0, 0, 40, 0, 0, 40],
      'interes|DL': [4, 5, 6, 7, 6, 5, 3, 2, 2, 1, 1, 1],
      'capital|DL': [0, 0, 0, 60, 120, 0, 0, 0, 0, 0, 0, 0],
      'capex_mant|ARS': [8, 8, 10, 12, 12, 8, 8, 7, 6, 6, 6, 6],
      'capex_crec|USD': [0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0],
      'retiro|ARS': [18, 18, 18, 20, 20, 22, 22, 22, 24, 24, 24, 24],
    };
    const lineas = [];
    Object.entries(serie).forEach(([k, vals]) => {
      const [rubro, moneda] = k.split('|');
      vals.forEach((v, i) => {
        if (!v) return;
        const monto = moneda === 'ARS' ? v * M : Math.round(v * M / TC);
        lineas.push({ periodo: P[i], rubro, moneda, monto });
      });
    });
    const tipoCambio = {};
    P.forEach(p => { tipoCambio[p] = TC; });
    const usd = v => Math.round(v * M / TC / 100) * 100;
    const bienes = [
      { id: 'ej-1', nombre: 'Tractor principal', categoria: 'Maquinaria', moneda: 'USD', valor_origen: usd(120), valor_residual: usd(12), vida_util_anios: 8 },
      { id: 'ej-2', nombre: 'Cosechadora', categoria: 'Maquinaria', moneda: 'USD', valor_origen: usd(310), valor_residual: usd(31), vida_util_anios: 10 },
      { id: 'ej-3', nombre: 'Pulverizadora', categoria: 'Maquinaria', moneda: 'USD', valor_origen: usd(95), valor_residual: usd(10), vida_util_anios: 8 },
      { id: 'ej-4', nombre: 'Silos e infraestructura', categoria: 'Infraestructura', moneda: 'USD', valor_origen: usd(80), valor_residual: 0, vida_util_anios: 15 },
      { id: 'ej-5', nombre: 'Camioneta y utilitarios', categoria: 'Rodados', moneda: 'USD', valor_origen: usd(45), valor_residual: usd(5), vida_util_anios: 5 },
    ];
    return {
      config: { inicio, meses: 12, caja_inicial: 120 * M, caja_inicial_moneda: 'ARS', tasa_ganancias: 0.30, escala: 1000000 },
      tipoCambio, lineas, bienes, tcDefault: TC,
    };
  }

  /* ───────────── Acceso a datos ───────────── */
  async function cargarDatos(sb, clienteId) {
    const desde = new Date(Date.now() - 800 * DIA_MS).toISOString().slice(0, 10);
    const [cfg, per, lin, bie, tc, dlr] = await Promise.all([
      sb.from('fin_config').select('*').eq('cliente_id', clienteId).maybeSingle(),
      sb.from('fin_periodos').select('periodo,tipo_cambio').eq('cliente_id', clienteId),
      sb.from('fin_lineas').select('periodo,rubro,moneda,monto').eq('cliente_id', clienteId),
      sb.from('fin_bienes_uso').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: true }),
      sb.from('tipo_de_cambio').select('fecha,valor').gte('fecha', desde).order('fecha', { ascending: true }),
      sb.from('a3_precios').select('vencimiento,settlement_price,last_price,settlement_date,last_date')
        .eq('subyacente', 'DLR').eq('es_opcion', false),
    ]);
    const err = [cfg, per, lin, bie].find(r => r && r.error);
    if (err) throw err.error;
    const tipoCambio = {};
    (per.data || []).forEach(r => { if (r.tipo_cambio != null) tipoCambio[primerDiaMes(r.periodo)] = Number(r.tipo_cambio); });
    return {
      config: cfg.data || null,
      tipoCambio,
      lineas: (lin.data || []).map(r => ({ periodo: primerDiaMes(r.periodo), rubro: r.rubro, moneda: r.moneda, monto: Number(r.monto) })),
      bienes: (bie.data || []).map(b => ({ ...b, valor_origen: Number(b.valor_origen), valor_residual: Number(b.valor_residual), vida_util_anios: Number(b.vida_util_anios) })),
      tcDefault: tc && tc.data && tc.data.length ? Number(tc.data[tc.data.length - 1].valor) : null,
      tcDefaultFecha: tc && tc.data && tc.data.length ? tc.data[tc.data.length - 1].fecha : null,
      // Si falla la lectura de la curva, el tablero sigue con el último oficial.
      curva: {
        oficial: (tc && tc.data) || [],
        dlr: ((dlr && dlr.data) || []).map(c => ({
          vencimiento: c.vencimiento,
          precio: c.settlement_price != null ? Number(c.settlement_price) : (c.last_price != null ? Number(c.last_price) : null),
          fecha: c.settlement_price != null ? c.settlement_date : c.last_date,
        })),
      },
    };
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function guardarDatos(sb, clienteId, borrador) {
    const cfg = normalizarConfig(borrador.config);
    const periodos = mesesDelEjercicio(cfg.inicio, cfg.meses);
    const rango = new Set(periodos);
    const lineas = [];
    Object.entries(borrador.lineas).forEach(([k, monto]) => {
      const [periodo, rubro, moneda] = k.split('|');
      if (!rango.has(periodo) || !monto) return;
      lineas.push({ periodo, rubro, moneda, monto });
    });
    const bienes = borrador.bienes
      .filter(b => String(b.nombre || '').trim() && Number(b.valor_origen) > 0 && Number(b.vida_util_anios) > 0)
      .map(b => ({
        id: /^[0-9a-f-]{36}$/i.test(b.id || '') ? b.id : uuid(),
        nombre: String(b.nombre).trim(), categoria: b.categoria || '', moneda: b.moneda === 'ARS' ? 'ARS' : 'USD',
        valor_origen: Number(b.valor_origen), valor_residual: Math.min(Number(b.valor_residual) || 0, Number(b.valor_origen)),
        vida_util_anios: Number(b.vida_util_anios), fecha_alta: primerDiaMes(b.fecha_alta) || '',
      }));
    const { data, error } = await sb.rpc('fin_guardar', {
      p_cliente_id: clienteId,
      p_config: cfg,
      p_periodos: periodos.map(p => ({ periodo: p, tipo_cambio: Number(borrador.tc[p]) > 0 ? Number(borrador.tc[p]) : null })),
      p_lineas: lineas,
      p_bienes: bienes,
    });
    if (error) throw error;
    return data;
  }

  /* ───────────── Estilos ───────────── */
  const CSS = `
.fin-root{--fin-bg:transparent;--fin-card:#1a3349;--fin-card2:#132d46;--fin-borde:rgba(255,255,255,.09);--fin-borde2:rgba(255,255,255,.16);
  --fin-texto:#dce8f5;--fin-texto2:#a3b8cc;--fin-muted:#7fa8c4;--fin-acento:#d4a017;--fin-acento-t:#132d46;
  --fin-verde:#2ab88a;--fin-amarillo:#e0b02a;--fin-rojo:#ef6f4c;--fin-info:#6fa8dc;
  --fin-pos:#3b8fd9;--fin-neg:#e0572d;--fin-linea:#dce8f5;--fin-grid:rgba(255,255,255,.07);
  --fin-sombra:0 2px 20px rgba(0,0,0,.35);--fin-radio:10px;--fin-input:#0d2035;
  color:var(--fin-texto);font-family:inherit;display:block}
.fin-root.fin-claro{--fin-card:#ffffff;--fin-card2:#faf8f4;--fin-borde:#f0ebe3;--fin-borde2:#e5dfd6;--fin-texto:#1c1a18;--fin-texto2:#5c554d;
  --fin-muted:#7a7268;--fin-acento:#c8a96e;--fin-acento-t:#1c1a18;--fin-verde:#2e7d52;--fin-amarillo:#a8740a;--fin-rojo:#c0391b;--fin-info:#2f6fb0;
  --fin-pos:#2f7fcf;--fin-neg:#d4552b;--fin-linea:#1c1a18;--fin-grid:rgba(0,0,0,.07);--fin-sombra:0 2px 12px rgba(0,0,0,.06);--fin-input:#ffffff}
.fin-root *{box-sizing:border-box}
.fin-head{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}
.fin-eyebrow{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--fin-muted)}
.fin-title{font-size:20px;font-weight:600;margin-top:2px}
.fin-sub{font-size:12px;color:var(--fin-texto2);margin-top:3px;line-height:1.45}
.fin-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fin-seg{display:inline-flex;border:1px solid var(--fin-borde2);border-radius:8px;overflow:hidden}
.fin-seg button{background:transparent;border:0;color:var(--fin-texto2);font:inherit;font-size:12px;font-weight:600;padding:7px 12px;cursor:pointer;min-height:34px}
.fin-seg button[aria-pressed="true"]{background:var(--fin-card2);color:var(--fin-texto)}
.fin-btn{font:inherit;font-size:13px;font-weight:600;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid var(--fin-borde2);background:transparent;color:var(--fin-texto);min-height:36px}
.fin-btn:hover{border-color:var(--fin-acento)}
.fin-btn-primary{background:var(--fin-acento);border-color:var(--fin-acento);color:var(--fin-acento-t)}
.fin-btn-primary:hover{filter:brightness(1.06)}
.fin-btn:disabled{opacity:.55;cursor:default}
.fin-btn-link{background:none;border:0;color:var(--fin-acento);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:4px 0}
.fin-banner{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:rgba(212,160,23,.1);border:1px solid rgba(212,160,23,.35);border-radius:var(--fin-radio);padding:10px 14px;margin-bottom:12px;font-size:13px;line-height:1.45}
.fin-claro .fin-banner{background:#fbf5e8;border-color:#e8d9b8}
.fin-avisos{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.fin-aviso{font-size:12px;color:var(--fin-texto2);line-height:1.45;padding-left:14px;position:relative}
.fin-aviso:before{content:"";position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:50%;background:var(--fin-muted)}
.fin-aviso.grave{color:var(--fin-texto)}.fin-aviso.grave:before{background:var(--fin-rojo)}
.fin-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.fin-card{background:var(--fin-card);border:1px solid var(--fin-borde);border-radius:var(--fin-radio);box-shadow:var(--fin-sombra);padding:14px 16px;min-width:0}
.fin-tile-label{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--fin-muted);line-height:1.35}
.fin-tile-valor{font-size:26px;font-weight:600;margin:6px 0 4px;letter-spacing:-.3px;line-height:1.15}
.fin-tile-sub{font-size:12px;color:var(--fin-texto2);line-height:1.45;margin-top:6px}
.fin-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--fin-texto);border-radius:99px;padding:3px 9px 3px 7px;background:var(--fin-card2);border:1px solid var(--fin-borde);white-space:nowrap}
.fin-badge i{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.fin-badge.verde i{background:var(--fin-verde)}.fin-badge.amarillo i{background:var(--fin-amarillo)}.fin-badge.rojo i{background:var(--fin-rojo)}
.fin-badge.info i{background:var(--fin-info)}.fin-badge.na i{background:transparent;border:1px solid var(--fin-muted)}
.fin-card h3{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--fin-muted);margin:0 0 10px}
.fin-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.fin-card-head h3{margin:0}
.fin-leyenda{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--fin-texto2)}
.fin-leyenda span{display:inline-flex;align-items:center;gap:6px}
.fin-leyenda i{display:inline-block;width:10px;height:10px;border-radius:2px}
.fin-leyenda i.linea{height:2px;width:14px;border-radius:1px}
.fin-chart{position:relative;height:280px}
.fin-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px;align-items:start}
.fin-unidad{font-size:11px;color:var(--fin-muted)}
.fin-desliza{display:none;font-size:11px;color:var(--fin-muted);text-align:center;margin-bottom:6px}
.fin-solo-angosto{display:none}
.fin-mon-lista{display:none;flex-direction:column}
.fin-mon-item{padding:9px 0;border-top:1px solid var(--fin-borde)}
.fin-mon-item:first-child{border-top:0}
.fin-mon-item.fuerte .fin-mon-nombre{font-weight:700}
.fin-mon-nombre{display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:600}
.fin-mon-nombre span:last-child{font-variant-numeric:tabular-nums}
.fin-mon-det{font-size:12px;color:var(--fin-texto2);margin-top:3px;line-height:1.45}
.fin-mon-card{container-type:inline-size}
@container (max-width:600px){
  .fin-mon-card .fin-solo-ancho{display:none}
  .fin-mon-card .fin-mon-lista{display:flex}
}
.fin-filas{display:flex;flex-direction:column}
.fin-fila{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--fin-borde);font-size:13px}
.fin-fila:first-child{border-top:0}
.fin-fila-nombre{color:var(--fin-texto);line-height:1.35}
.fin-fila-nombre small{display:block;color:var(--fin-muted);font-size:11px;margin-top:2px}
.fin-fila-valor{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;min-width:62px}
.fin-nota{font-size:12px;color:var(--fin-texto2);margin-top:10px;line-height:1.5}
.fin-tabla-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.fin-tabla{width:100%;border-collapse:collapse;font-size:12.5px}
.fin-tabla th{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--fin-muted);text-align:right;padding:6px 8px;border-bottom:1px solid var(--fin-borde2);white-space:nowrap}
.fin-tabla th:first-child,.fin-tabla td:first-child{text-align:left}
.fin-tabla td{padding:8px;border-bottom:1px solid var(--fin-borde);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.fin-tabla tr.fuerte td{font-weight:600}
.fin-tabla td.neg{color:var(--fin-rojo)}
.fin-cascada{display:flex;flex-direction:column;font-size:13px}
.fin-cascada .sub{font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--fin-muted);margin:12px 0 4px}
.fin-cascada .sub:first-child{margin-top:0}
.fin-cascada .l{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--fin-borde)}
.fin-cascada .l span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
.fin-cascada .l.t{font-weight:600}
.fin-cascada .l.menos span:first-child{padding-left:12px;color:var(--fin-texto2)}
.fin-tag{font-size:10px;font-weight:700;color:var(--fin-muted);border:1px solid var(--fin-borde2);border-radius:4px;padding:0 4px;margin-left:6px;vertical-align:1px}
.fin-dic{margin-top:12px}
.fin-dic summary{cursor:pointer;font-size:13px;font-weight:600;list-style:none}
.fin-dic summary::-webkit-details-marker{display:none}
.fin-dic summary:before{content:"▸ ";color:var(--fin-muted)}
.fin-dic[open] summary:before{content:"▾ "}
.fin-dic .fin-tabla td{white-space:normal;text-align:left;vertical-align:top;line-height:1.45}
.fin-vacio{text-align:center;padding:36px 20px}
.fin-vacio h3{font-size:17px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--fin-texto);margin:0 0 8px}
.fin-vacio p{font-size:13px;color:var(--fin-texto2);max-width:520px;margin:0 auto 18px;line-height:1.55}
.fin-vacio .fin-actions{justify-content:center}
.fin-cargando{font-size:13px;color:var(--fin-texto2);padding:30px 4px}
.fin-error{font-size:13px;color:var(--fin-rojo);padding:14px 0}
/* Editor */
.fin-modal{position:fixed;inset:0;z-index:2000;background:rgba(8,20,34,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.fin-claro.fin-modal{background:rgba(28,26,24,.45)}
.fin-modal-box{background:var(--fin-card);color:var(--fin-texto);border:1px solid var(--fin-borde2);border-radius:14px;width:min(1180px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.fin-modal-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px 0}
.fin-modal-top h2{font-size:17px;font-weight:600;margin:0}
.fin-cerrar{background:none;border:0;color:var(--fin-texto2);font-size:24px;line-height:1;cursor:pointer;padding:0 4px;min-width:36px;min-height:36px}
.fin-ed-tabs{display:flex;gap:4px;padding:12px 18px 0;border-bottom:1px solid var(--fin-borde2);overflow-x:auto}
.fin-ed-tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--fin-texto2);font:inherit;font-size:13px;font-weight:600;padding:8px 10px;cursor:pointer;white-space:nowrap}
.fin-ed-tabs button[aria-selected="true"]{color:var(--fin-texto);border-bottom-color:var(--fin-acento)}
.fin-modal-body{padding:14px 18px;overflow:auto;flex:1;min-height:0}
.fin-modal-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--fin-borde2)}
.fin-estado{font-size:12px;color:var(--fin-texto2)}.fin-estado.err{color:var(--fin-rojo)}.fin-estado.ok{color:var(--fin-verde)}
.fin-ayuda{font-size:12px;color:var(--fin-texto2);line-height:1.5;margin-bottom:10px}
.fin-grilla-wrap{overflow:auto;border:1px solid var(--fin-borde);border-radius:8px;max-height:calc(100vh - 290px)}
.fin-grilla{border-collapse:separate;border-spacing:0;font-size:12px}
.fin-grilla th,.fin-grilla td{border-bottom:1px solid var(--fin-borde);padding:0}
.fin-grilla thead th{position:sticky;top:0;background:var(--fin-card2);z-index:2;font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--fin-muted);padding:7px 6px;text-align:right;white-space:nowrap}
.fin-grilla .rot{position:sticky;left:0;background:var(--fin-card);z-index:1;text-align:left;padding:6px 10px;white-space:nowrap;min-width:190px;font-weight:500}
.fin-grilla thead .rot{z-index:3;background:var(--fin-card2)}
.fin-grilla .rot small{color:var(--fin-muted);font-weight:600;margin-left:4px}
.fin-grilla tr.grupo td{background:var(--fin-card2);font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--fin-muted);padding:6px 10px}
.fin-grilla tr.grupo td.rot{background:var(--fin-card2)}
.fin-grilla input{width:92px;background:transparent;border:0;color:var(--fin-texto);font:inherit;font-size:12.5px;text-align:right;padding:7px 6px;font-variant-numeric:tabular-nums}
.fin-grilla input:focus{outline:2px solid var(--fin-acento);outline-offset:-2px;background:var(--fin-input)}
.fin-grilla input::placeholder{color:var(--fin-muted);opacity:.6}
.fin-grilla tbody td + td{border-left:1px solid var(--fin-borde)}
.fin-grilla input:hover{background:rgba(127,168,196,.07)}
.fin-grilla tr.fin-fuente-tc td{font-size:10.5px;color:var(--fin-muted);text-align:right;padding:3px 8px 6px;white-space:nowrap}
.fin-grilla tr.fin-fuente-tc td.rot{font-size:11px;font-weight:500;text-align:left}
.fin-tc-ayuda{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--fin-card2);border:1px solid var(--fin-borde);border-radius:8px;padding:8px 10px}
.fin-tc-ayuda .fin-btn{min-height:32px;padding:6px 10px;font-size:12px}
.fin-grilla td.tot{padding:6px 8px;text-align:right;color:var(--fin-texto2);font-variant-numeric:tabular-nums;white-space:nowrap}
.fin-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:760px}
.fin-campo label{display:block;font-size:12px;font-weight:600;color:var(--fin-texto2);margin-bottom:5px}
.fin-campo small{display:block;font-size:11px;color:var(--fin-muted);margin-top:4px;line-height:1.4}
.fin-in{width:100%;background:var(--fin-input);border:1px solid var(--fin-borde2);border-radius:8px;color:var(--fin-texto);font:inherit;font-size:13px;padding:8px 10px;min-height:38px}
.fin-in:focus{outline:2px solid var(--fin-acento);outline-offset:0}
.fin-par{display:flex;gap:6px}.fin-par .fin-in:first-child{flex:1}.fin-par select.fin-in{width:auto}
.fin-bienes td{padding:4px}
.fin-bienes .fin-in{min-height:34px;padding:6px 8px;font-size:12.5px}
.fin-bienes td.num .fin-in{text-align:right;width:120px}
.fin-quitar{background:none;border:0;color:var(--fin-muted);font-size:18px;cursor:pointer;min-width:32px;min-height:32px}
.fin-quitar:hover{color:var(--fin-rojo)}
@media (max-width:1100px){.fin-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){
  .fin-grid2{grid-template-columns:1fr}
  .fin-tile-valor{font-size:22px}
  .fin-chart{height:240px}
  .fin-modal{padding:0}
  .fin-modal-box{max-height:100vh;height:100%;border-radius:0}
  .fin-grilla-wrap{max-height:none}
  .fin-grilla .rot{min-width:150px}
  .fin-solo-ancho{display:none}
  .fin-solo-angosto.fin-mon-lista{display:flex}
  .fin-desliza{display:block}
}
@media (max-width:480px){
  .fin-fila{grid-template-columns:1fr auto}
  .fin-fila > div:last-child{grid-column:1 / -1}
}
@media (max-width:420px){.fin-tiles{grid-template-columns:1fr}}
@media print{.fin-actions,.fin-modal,.fin-banner .fin-btn{display:none!important}.fin-card{box-shadow:none}}
`;
  function inyectarCss() {
    if (document.getElementById('fin-estilos')) return;
    const st = document.createElement('style');
    st.id = 'fin-estilos';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function cargarChartJs() {
    if (global.Chart) return Promise.resolve(global.Chart);
    if (cargarChartJs._p) return cargarChartJs._p;
    cargarChartJs._p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = () => res(global.Chart);
      s.onerror = () => rej(new Error('No se pudo cargar Chart.js'));
      document.head.appendChild(s);
    });
    return cargarChartJs._p;
  }

  /* ───────────── Tablero ───────────── */
  const estados = new WeakMap();

  function badge(e, texto) {
    const est = e || 'na';
    return `<span class="fin-badge ${est}"><i aria-hidden="true"></i>${esc(texto || ETIQUETA_ESTADO[est])}</span>`;
  }

  function valorInd(clave, i) {
    if (!i) return '—';
    if (clave === 'calce_dol') return fmtX(i.valor);
    if (clave === 'meses_neg') return i.valor == null ? '—' : String(i.valor);
    return fmtPct(i.valor);
  }

  function render(st) {
    const root = st.root;
    if (st.cargando) { root.innerHTML = '<div class="fin-cargando">Cargando datos financieros…</div>'; return; }
    if (st.error) {
      root.innerHTML = `<div class="fin-card"><div class="fin-error">No se pudieron leer los datos financieros: ${esc(st.error)}</div>
        <button class="fin-btn" data-accion="reintentar">Reintentar</button></div>`;
      return;
    }
    const datos = st.modoEjemplo ? datosEjemplo() : st.datos;
    const r = calcular(datos);
    st.resultado = r;

    if (r.vacio && !st.modoEjemplo) {
      root.innerHTML = `
        <div class="fin-card fin-vacio">
          <div class="fin-eyebrow">Tablero financiero</div>
          <h3>Todavía no hay datos financieros cargados</h3>
          <p>Con el flujo mensual (ventas y costos por moneda, deuda, impuestos, inversiones y retiros) y los bienes de uso, este tablero calcula
             calce de moneda, peso de la deuda, flujo sostenible, reposición de capital y los meses de tensión de caja.</p>
          <div class="fin-actions">
            ${st.opts.puedeEditar ? '<button class="fin-btn fin-btn-primary" data-accion="editar">Cargar datos</button>' : ''}
            <button class="fin-btn" data-accion="ejemplo">Ver un ejemplo</button>
          </div>
        </div>`;
      return;
    }

    const M = st.moneda;
    const usd = M === 'USD';
    const mon = v => fmtMonto(v, M);
    const aM = (ars, usdV) => usd ? usdV : ars;
    const ind = r.indicadores;
    const cfg = r.config;
    const primero = r.meses[0], ultimo = r.meses[r.meses.length - 1];
    const titulo = `${etiquetaMes(primero.periodo)} – ${etiquetaMes(ultimo.periodo)}`;
    const au = r.anualUsd, an = r.anual;
    const A = f => aM(an[f], au[f]);

    const tiles = [
      {
        label: UMBRALES.caja_min.nombre, ind: ind.caja_min,
        valor: mon(aM(r.caja.minima, r.caja.minimaUsd)),
        sub: r.caja.necesidad > 0
          ? `En ${etiquetaMes(r.caja.mesMinimo, true)}. Necesidad máxima de financiamiento: <b>${mon(aM(r.caja.necesidad, r.caja.necesidadUsd))}</b>.`
          : `En ${etiquetaMes(r.caja.mesMinimo, true)}. Caja al cierre: ${mon(aM(r.caja.final, r.caja.finalUsd))}.`,
      },
      {
        label: UMBRALES.meses_neg.nombre, ind: ind.meses_neg,
        valor: `${ind.meses_neg.valor} de ${r.meses.length}`,
        sub: 'Meses con flujo negativo después de pagar deuda e inversiones.',
      },
      {
        label: UMBRALES.serv_fs.nombre, ind: ind.serv_fs,
        valor: ind.serv_fs.valor == null ? '—' : fmtPct(ind.serv_fs.valor),
        sub: `Servicio de deuda ${mon(A('servicio'))} contra un flujo sostenible de ${mon(A('fs'))}.`,
      },
      {
        label: UMBRALES.calce_dol.nombre, ind: ind.calce_dol,
        valor: fmtX(ind.calce_dol.valor),
        sub: r.moneda[3].pctVentas != null
          ? `Ventas dolarizadas ${fmtPct(r.moneda[3].pctVentas)} · costos directos dolarizados ${fmtPct(r.moneda[3].pctCostos)}.`
          : 'Sin ventas cargadas.',
      },
    ];

    const filaInd = (clave, extra) => {
      const i = ind[clave];
      return `<div class="fin-fila">
        <div class="fin-fila-nombre">${esc(UMBRALES[clave] ? UMBRALES[clave].nombre : extra.nombre)}${extra && extra.nota ? `<small>${esc(extra.nota)}</small>` : ''}</div>
        <div class="fin-fila-valor">${valorInd(clave, i)}</div>
        <div>${badge(i.estado, i.lectura)}</div>
      </div>`;
    };
    const filaInfo = (nombre, valor, i, nota) => `<div class="fin-fila">
        <div class="fin-fila-nombre">${esc(nombre)}${nota ? `<small>${esc(nota)}</small>` : ''}</div>
        <div class="fin-fila-valor">${valor}</div>
        <div>${badge(i.estado, i.lectura)}</div>
      </div>`;

    const num = v => fmtMonto(v, '');
    const tablaMoneda = `
      <div class="fin-tabla-wrap fin-solo-ancho"><table class="fin-tabla">
        <thead><tr><th>Moneda</th><th>% ventas</th><th>% costos</th><th>Calce</th><th>Exposición</th><th>Tras deuda</th></tr></thead>
        <tbody>${r.moneda.map(f => `
          <tr class="${f.clave === 'DOL' ? 'fuerte' : ''}">
            <td>${esc(f.nombre)}</td><td>${fmtPct(f.pctVentas)}</td><td>${fmtPct(f.pctCostos)}</td><td>${fmtX(f.calce)}</td>
            <td class="${f.exposicion[M] < 0 ? 'neg' : ''}">${num(f.exposicion[M])}</td>
            <td class="${f.exposicionPostDeuda[M] < 0 ? 'neg' : ''}">${num(f.exposicionPostDeuda[M])}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="fin-solo-angosto fin-mon-lista">${r.moneda.map(f => `
        <div class="fin-mon-item ${f.clave === 'DOL' ? 'fuerte' : ''}">
          <div class="fin-mon-nombre"><span>${esc(f.nombre)}</span><span>${fmtX(f.calce)}</span></div>
          <div class="fin-mon-det">Ventas ${fmtPct(f.pctVentas)} · costos ${fmtPct(f.pctCostos)}</div>
          <div class="fin-mon-det">Exposición ${mon(f.exposicion[M])} · tras deuda ${mon(f.exposicionPostDeuda[M])}</div>
        </div>`).join('')}</div>
      <div class="fin-nota">Exposición = ventas − costos directos − estructura en esa moneda. "Tras deuda" también resta capital e intereses en esa moneda.
      El semáforo mira el dolarizado (USD + dólar link): el dólar link se cancela en pesos pero sigue al oficial.</div>`;

    const l = (txt, v, cls, tag) => `<div class="l ${cls || ''}"><span>${txt}${tag ? `<span class="fin-tag">${tag}</span>` : ''}</span><span>${mon(v)}</span></div>`;
    const cascada = `
      <div class="fin-cascada">
        <div class="sub">Resultado</div>
        ${l('Ventas', A('ventas'))}
        ${l('Costos directos', -A('costos'), 'menos')}
        ${l('Resultado bruto', A('rb'), 't')}
        ${l('Gastos de estructura', -A('estructura'), 'menos')}
        ${l('EBITDA', A('ebitda'), 't')}
        ${l('Depreciación', -A('dep'), 'menos')}
        ${l('Resultado operativo (EBIT)', A('ebit'), 't')}
        ${l('Intereses', -A('intereses'), 'menos')}
        ${l('Resultado antes de impuestos', A('rai'), 't')}
        <div class="sub">Caja</div>
        ${l('EBITDA', A('ebitda'))}
        ${l('Impuestos', -A('impuestos'), 'menos', r.impuestoCargado ? '' : 'ESTIMADO')}
        ${l('Capex de mantenimiento', -A('capexMant'), 'menos')}
        ${l('Retiros', -A('retiros'), 'menos')}
        ${l('Flujo sostenible', A('fs'), 't')}
        ${l('Servicio de deuda', -A('servicio'), 'menos')}
        ${l('Capex de crecimiento', -A('capexCrec'), 'menos')}
        ${l('Flujo después de deuda e inversión', A('post'), 't')}
      </div>`;

    const tablaMeses = `
      <div class="fin-desliza">← Deslizá para ver todas las columnas →</div>
      <div class="fin-tabla-wrap"><table class="fin-tabla">
        <thead><tr><th>Mes</th><th>Tipo de cambio</th><th>Ventas</th><th>Resultado bruto</th><th>EBITDA</th><th>Servicio de deuda</th><th>Flujo después de deuda</th><th>Caja acumulada</th><th>Acción</th></tr></thead>
        <tbody>${r.meses.map(m => {
          const d = f => usd ? m[f] / m.tc : m[f];
          const caja = usd ? m.cajaUsd : m.caja;
          return `<tr>
            <td>${esc(m.etiqueta)}</td>
            <td title="${esc(AYUDA_FUENTE_TC[m.tcFuente] || '')}">${nf(0).format(m.tc)}<span class="fin-tag">${esc(NOMBRE_FUENTE_TC[m.tcFuente] || '')}</span></td>
            <td>${num(d('ventas'))}</td><td class="${m.rb < 0 ? 'neg' : ''}">${num(d('rb'))}</td>
            <td class="${m.ebitda < 0 ? 'neg' : ''}">${num(d('ebitda'))}</td><td>${num(d('servicio'))}</td>
            <td class="${m.post < 0 ? 'neg' : ''}">${num(d('post'))}</td><td class="${caja < 0 ? 'neg' : ''}">${num(caja)}</td>
            <td style="text-align:left">${badge(m.accion.estado, m.accion.texto)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;

    const dicc = Object.entries(UMBRALES).map(([k, u]) => `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.que)}</td><td>${esc(u.regla)}</td></tr>`).join('');

    root.innerHTML = `
      <div class="fin-head">
        <div>
          <div class="fin-eyebrow">Tablero financiero${st.opts.clienteNombre && !st.modoEjemplo ? ' · ' + esc(st.opts.clienteNombre) : ''}</div>
          <div class="fin-title">${esc(titulo)}</div>
          <div class="fin-sub">${r.meses.length} meses · montos en ${usd ? 'USD equivalentes al tipo de cambio de cada mes' : 'pesos (ARS), con USD y dólar link al tipo de cambio de cada mes'}</div>
        </div>
        <div class="fin-actions">
          <div class="fin-seg" role="group" aria-label="Moneda de los montos">
            <button type="button" data-moneda="USD" aria-pressed="${usd}">USD</button>
            <button type="button" data-moneda="ARS" aria-pressed="${!usd}">ARS</button>
          </div>
          ${st.opts.puedeEditar && !st.modoEjemplo ? '<button class="fin-btn fin-btn-primary" data-accion="editar">Cargar datos</button>' : ''}
        </div>
      </div>
      ${st.modoEjemplo ? `<div class="fin-banner"><span><b>Caso de ejemplo:</b> empresa agrícola de 1.000 ha en región núcleo (la plantilla de indicadores, con gastos de estructura cargados). No son tus datos.</span>
        <button class="fin-btn" data-accion="salir-ejemplo">Salir del ejemplo</button></div>` : ''}
      ${r.avisos.length ? `<div class="fin-avisos">${r.avisos.map(a => `<div class="fin-aviso ${a.grave ? 'grave' : ''}">${esc(a.texto)}</div>`).join('')}</div>` : ''}
      <div class="fin-tiles">
        ${tiles.map(t => `<div class="fin-card">
          <div class="fin-tile-label">${esc(t.label)}</div>
          <div class="fin-tile-valor">${t.valor}</div>
          ${badge(t.ind.estado, t.ind.lectura)}
          <div class="fin-tile-sub">${t.sub}</div>
        </div>`).join('')}
      </div>
      <div class="fin-card">
        <div class="fin-card-head">
          <h3>Flujo y caja mes a mes</h3>
          <div class="fin-leyenda" aria-hidden="true">
            <span><i style="background:var(--fin-pos)"></i>Flujo positivo</span>
            <span><i style="background:var(--fin-neg)"></i>Flujo negativo</span>
            <span><i class="linea" style="background:var(--fin-linea)"></i>Caja acumulada</span>
          </div>
        </div>
        <div class="fin-chart"><canvas role="img" aria-label="Flujo después de deuda e inversión por mes y caja acumulada. El detalle está en la tabla Mes a mes."></canvas></div>
      </div>
      <div class="fin-grid2">
        <div class="fin-card">
          <h3>Deuda</h3>
          <div class="fin-filas">
            ${filaInd('int_rb')}${filaInd('int_ebit')}${filaInd('serv_rb')}${filaInd('serv_ebit')}${filaInd('serv_ebitda')}${filaInd('serv_fs')}
          </div>
          <div class="fin-nota">Servicio del período: ${mon(A('servicio'))} (intereses ${mon(A('intereses'))} + capital ${mon(A('capital'))}).</div>
        </div>
        <div class="fin-card fin-mon-card"><div class="fin-card-head"><h3>Moneda</h3><span class="fin-unidad">Montos en ${M}</span></div>${tablaMoneda}</div>
      </div>
      <div class="fin-grid2">
        <div class="fin-card">
          <h3>Capital</h3>
          <div class="fin-filas">
            ${filaInd('capex_dep')}
            ${filaInfo('Capex total / depreciación', fmtPct(ind.capex_total_dep.valor), ind.capex_total_dep, 'Mantenimiento + crecimiento')}
            ${filaInfo('Depreciación / EBITDA', fmtPct(ind.dep_ebitda.valor), ind.dep_ebitda, 'Cuánto de la caja operativa haría falta reservar para reponer')}
          </div>
          <div class="fin-nota">Depreciación del período ${mon(A('dep'))} (${r.bienesConDep} ${r.bienesConDep === 1 ? 'bien' : 'bienes'} de uso). Capex de mantenimiento ${mon(A('capexMant'))} · de crecimiento ${mon(A('capexCrec'))}.</div>
        </div>
        <div class="fin-card"><h3>Resultado y caja del período</h3>${cascada}</div>
      </div>
      <div class="fin-card" style="margin-top:12px"><div class="fin-card-head"><h3>Mes a mes</h3><span class="fin-unidad">Montos en ${M}</span></div>${tablaMeses}</div>
      <details class="fin-card fin-dic">
        <summary>Cómo se calcula cada indicador y qué umbrales usa</summary>
        <div class="fin-tabla-wrap" style="margin-top:10px"><table class="fin-tabla">
          <thead><tr><th>Indicador</th><th>Qué mide</th><th>Semáforo</th></tr></thead>
          <tbody>${dicc}</tbody></table></div>
        <div class="fin-nota">Resultado bruto = ventas − costos directos. EBITDA = resultado bruto − gastos de estructura. EBIT = EBITDA − depreciación.
        Flujo sostenible = EBITDA − impuestos − capex de mantenimiento − retiros. Servicio de deuda = intereses + amortización de capital.
        Si no hay impuestos cargados se estiman con la tasa del ejercicio (${Math.round(cfg.tasa_ganancias * 100)}%) sobre el resultado anual antes de impuestos.
        Umbrales versión ${FIN_VERSION}.</div>
      </details>`;

    dibujarGrafico(st, r);
  }

  function dibujarGrafico(st, r) {
    const canvas = st.root.querySelector('.fin-chart canvas');
    if (!canvas) return;
    if (st.chart) { try { st.chart.destroy(); } catch (e) { /* nada */ } st.chart = null; }
    const token = (st.chartToken = (st.chartToken || 0) + 1);
    cargarChartJs().then(Chart => {
      if (token !== st.chartToken || !canvas.isConnected) return;
      const cs = getComputedStyle(st.root);
      const col = n => cs.getPropertyValue(n).trim();
      const usd = st.moneda === 'USD';
      const flujo = r.meses.map(m => usd ? m.post / m.tc : m.post);
      const caja = r.meses.map(m => usd ? m.cajaUsd : m.caja);
      const M = st.moneda;
      st.chart = new Chart(canvas.getContext('2d'), {
        data: {
          labels: r.meses.map(m => m.etiqueta),
          datasets: [
            { type: 'line', label: 'Caja acumulada', data: caja, borderColor: col('--fin-linea'), backgroundColor: col('--fin-linea'),
              borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: col('--fin-card'), pointBorderWidth: 2, tension: 0, order: 0 },
            { type: 'bar', label: 'Flujo después de deuda e inversión', data: flujo,
              backgroundColor: flujo.map(v => v < 0 ? col('--fin-neg') : col('--fin-pos')),
              borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34, categoryPercentage: 0.8, barPercentage: 0.85, order: 1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: items => items.length ? etiquetaMes(r.meses[items[0].dataIndex].periodo, true) : '',
                label: c => `${c.dataset.label}: ${fmtMonto(c.parsed.y, M)}`,
              },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { color: col('--fin-grid') }, ticks: { color: col('--fin-muted'), font: { size: 11 } } },
            y: {
              grid: { color: c => c.tick && c.tick.value === 0 ? col('--fin-borde2') : col('--fin-grid'), lineWidth: c => c.tick && c.tick.value === 0 ? 1.5 : 1 },
              border: { display: false },
              ticks: { color: col('--fin-muted'), font: { size: 11 }, maxTicksLimit: 6, callback: v => fmtEje(v) },
            },
          },
        },
      });
    }).catch(() => {
      const wrap = st.root.querySelector('.fin-chart');
      if (wrap) wrap.innerHTML = '<div class="fin-nota">No se pudo cargar el gráfico. Los valores están en la tabla Mes a mes.</div>';
    });
  }

  /* ───────────── Editor ───────────── */
  function nuevoBorrador(datos) {
    const cfg = normalizarConfig(datos && datos.config);
    const lineas = {};
    (datos && datos.lineas || []).forEach(l => {
      const k = `${l.periodo}|${l.rubro}|${l.moneda}`;
      lineas[k] = (lineas[k] || 0) + (Number(l.monto) || 0);
    });
    return {
      config: cfg,
      tc: { ...(datos && datos.tipoCambio || {}) },
      lineas,
      bienes: (datos && datos.bienes || []).map(b => ({ ...b, fecha_alta: b.fecha_alta ? String(b.fecha_alta).slice(0, 7) : '' })),
    };
  }

  function abrirEditor(st) {
    cerrarEditor(st);
    const b = nuevoBorrador(st.datos);
    const ed = { b, pestaña: 'flujo', sucio: false, confirmarCierre: false, guardando: false };
    st.editor = ed;
    const modal = document.createElement('div');
    modal.className = `fin-root fin-modal ${st.opts.tema === 'claro' ? 'fin-claro' : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'fin-ed-titulo');
    document.body.appendChild(modal);
    ed.modal = modal;
    ed.previoFoco = document.activeElement;
    pintarEditor(st);
    modal.addEventListener('click', e => onClickEditor(st, e));
    modal.addEventListener('input', e => onInputEditor(st, e));
    modal.addEventListener('change', e => onChangeEditor(st, e));
    modal.addEventListener('paste', e => onPasteEditor(st, e));
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); intentarCerrar(st); }
      if (e.key === 'Enter' && e.target.matches('.fin-grilla input')) { e.preventDefault(); moverFoco(st, e.target, e.shiftKey ? -1 : 1, 0); }
    });
    const primero = modal.querySelector('.fin-grilla input, .fin-in');
    if (primero) primero.focus();
  }

  function cerrarEditor(st) {
    if (st.editor && st.editor.modal) {
      st.editor.modal.remove();
      if (st.editor.previoFoco && st.editor.previoFoco.focus) { try { st.editor.previoFoco.focus(); } catch (e) { /* nada */ } }
    }
    st.editor = null;
  }

  function intentarCerrar(st) {
    const ed = st.editor;
    if (!ed) return;
    if (ed.sucio && !ed.confirmarCierre) {
      ed.confirmarCierre = true;
      estadoEditor(st, 'Tenés cambios sin guardar. Tocá cerrar otra vez para descartarlos.', 'err');
      return;
    }
    cerrarEditor(st);
  }

  function estadoEditor(st, texto, cls) {
    const el = st.editor && st.editor.modal.querySelector('.fin-estado');
    if (el) { el.textContent = texto || ''; el.className = 'fin-estado ' + (cls || ''); }
  }

  function pintarEditor(st) {
    const ed = st.editor, b = ed.b, cfg = normalizarConfig(b.config);
    const periodos = mesesDelEjercicio(cfg.inicio, cfg.meses);
    const esc_ = cfg.escala;
    const unidad = { 1: 'unidades', 1000: 'miles', 1000000: 'millones' }[esc_];
    const tcPh = st.datos && st.datos.tcDefault ? fmtNumEditor(st.datos.tcDefault) : '';
    const curvaEd = construirCurvaTc(periodos, st.datos && st.datos.curva, st.datos && st.datos.hoy);
    ed.curva = curvaEd;
    const tcAuto = p => curvaEd && curvaEd.porMes[p] ? curvaEd.porMes[p] : null;
    const tabs = [['flujo', 'Flujo mensual'], ['bienes', 'Bienes de uso'], ['ejercicio', 'Ejercicio']];
    let cuerpo = '';

    if (ed.pestaña === 'flujo') {
      let grupoActual = '';
      let filas = `<tr><td class="rot">Tipo de cambio <small>ARS por USD</small></td>${periodos.map((p, j) => {
        const a = tcAuto(p);
        const ph = a ? fmtNumEditor(Math.round(a.tc * 100) / 100) : tcPh;
        return `<td><input inputmode="decimal" data-fila="0" data-col="${j}" data-tc="${p}" value="${esc(fmtNumEditor(b.tc[p]))}" placeholder="${esc(ph)}" title="${esc(a ? AYUDA_FUENTE_TC[a.fuente] : 'Último oficial conocido')}" aria-label="Tipo de cambio ${etiquetaMes(p, true)}"></td>`;
      }).join('')}<td class="tot"></td></tr>
      <tr class="fin-fuente-tc"><td class="rot">Si queda vacío, usa</td>${periodos.map(p => {
        const a = tcAuto(p);
        return `<td data-fuente-tc="${p}">${b.tc[p] ? 'cargado' : esc(a ? NOMBRE_FUENTE_TC[a.fuente] : 'último')}</td>`;
      }).join('')}<td></td></tr>`;
      let fila = 1;
      RUBROS.forEach(r => {
        if (r.grupo !== grupoActual) {
          grupoActual = r.grupo;
          filas += `<tr class="grupo"><td class="rot">${esc(r.grupo)}</td><td colspan="${periodos.length + 1}"></td></tr>`;
        }
        r.monedas.forEach(m => {
          let total = 0;
          const celdas = periodos.map((p, j) => {
            const v = b.lineas[`${p}|${r.clave}|${m}`];
            if (v) total += v;
            return `<td><input inputmode="decimal" data-fila="${fila}" data-col="${j}" data-k="${p}|${r.clave}|${m}" value="${esc(v ? fmtNumEditor(v / esc_) : '')}" aria-label="${esc(r.nombre)} ${esc(NOMBRE_MONEDA[m])} ${etiquetaMes(p, true)}"></td>`;
          }).join('');
          filas += `<tr><td class="rot">${esc(r.nombre)} <small>${esc(NOMBRE_MONEDA[m])}</small></td>${celdas}<td class="tot" data-tot="${r.clave}|${m}">${total ? fmtNumEditor(total / esc_) : ''}</td></tr>`;
          fila++;
        });
      });
      cuerpo = `
        <div class="fin-ayuda">Montos en <b>${unidad}</b> de cada moneda (se cambia en la pestaña Ejercicio). USD y dólar link se cargan en dólares; el tablero los pasa a pesos con el tipo de cambio de cada mes.
        Podés pegar un bloque copiado de Excel: hacé clic en la primera celda y pegá (Ctrl+V / Cmd+V).</div>
        <div class="fin-ayuda fin-tc-ayuda">
          <span><b>Tipo de cambio automático:</b> meses cerrados con el promedio del oficial (A3500) y los que vienen con el dólar futuro de A3${curvaEd && curvaEd.meta && curvaEd.meta.ajusteFecha ? ` (ajuste del ${fmtFechaCorta(curvaEd.meta.ajusteFecha)})` : ''}.
          Se actualiza solo cada día. Si escribís un valor, manda el tuyo.</span>
          <span class="fin-actions">
            <button class="fin-btn" data-accion="fijar-tc" title="Copia los valores automáticos de hoy como cargados, para que no cambien">Fijar los de hoy</button>
            <button class="fin-btn" data-accion="auto-tc" title="Borra los cargados y vuelve al automático">Volver al automático</button>
          </span>
        </div>
        <div class="fin-grilla-wrap"><table class="fin-grilla">
          <thead><tr><th class="rot">Rubro</th>${periodos.map(p => `<th>${etiquetaMes(p)}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>${filas}</tbody></table></div>`;
    } else if (ed.pestaña === 'bienes') {
      const filasB = b.bienes.map((x, i) => {
        const dep = depreciacionMensual(x) * 12;
        return `<tr data-bien="${i}">
          <td><input class="fin-in" data-b="nombre" value="${esc(x.nombre || '')}" placeholder="Ej: Cosechadora" aria-label="Nombre"></td>
          <td><input class="fin-in" data-b="categoria" value="${esc(x.categoria || '')}" placeholder="Maquinaria" aria-label="Categoría"></td>
          <td><select class="fin-in" data-b="moneda" aria-label="Moneda"><option value="USD" ${x.moneda !== 'ARS' ? 'selected' : ''}>USD</option><option value="ARS" ${x.moneda === 'ARS' ? 'selected' : ''}>ARS</option></select></td>
          <td class="num"><input class="fin-in" inputmode="decimal" data-b="valor_origen" value="${esc(fmtNumEditor(x.valor_origen))}" aria-label="Valor de origen"></td>
          <td class="num"><input class="fin-in" inputmode="decimal" data-b="valor_residual" value="${esc(fmtNumEditor(x.valor_residual))}" aria-label="Valor residual"></td>
          <td class="num"><input class="fin-in" inputmode="decimal" data-b="vida_util_anios" value="${esc(fmtNumEditor(x.vida_util_anios))}" aria-label="Vida útil en años" style="width:80px"></td>
          <td><input class="fin-in" type="month" data-b="fecha_alta" value="${esc(x.fecha_alta || '')}" aria-label="Mes de alta"></td>
          <td style="text-align:right;white-space:nowrap;padding:0 8px;font-variant-numeric:tabular-nums" data-dep="${i}">${dep ? fmtMonto(dep, x.moneda === 'ARS' ? 'ARS' : 'USD') : '—'}</td>
          <td><button class="fin-quitar" data-accion="quitar-bien" data-i="${i}" aria-label="Quitar ${esc(x.nombre || 'bien')}">×</button></td>
        </tr>`;
      }).join('');
      cuerpo = `
        <div class="fin-ayuda">Depreciación lineal: (valor de origen − residual) / vida útil. Si cargás el mes de alta, deprecia desde ese mes hasta cumplir la vida útil; si lo dejás vacío, deprecia todo el ejercicio.
        Conviene cargar el valor de reposición en USD para que la depreciación refleje lo que cuesta reponer el bien.</div>
        <div class="fin-tabla-wrap"><table class="fin-tabla fin-bienes">
          <thead><tr><th>Bien</th><th>Categoría</th><th>Moneda</th><th>Valor origen</th><th>Residual</th><th>Vida (años)</th><th>Alta</th><th>Dep. anual</th><th></th></tr></thead>
          <tbody>${filasB || `<tr><td colspan="9" style="text-align:left;color:var(--fin-muted);padding:14px 8px">Todavía no hay bienes de uso cargados.</td></tr>`}</tbody>
        </table></div>
        <button class="fin-btn" style="margin-top:10px" data-accion="agregar-bien">+ Agregar bien</button>`;
    } else {
      const inicioMes = cfg.inicio.slice(0, 7);
      cuerpo = `
        <div class="fin-form">
          <div class="fin-campo"><label for="fin-cfg-inicio">Primer mes del ejercicio</label>
            <input class="fin-in" id="fin-cfg-inicio" type="month" data-cfg="inicio" value="${esc(inicioMes)}">
            <small>El tablero mira este mes y los siguientes.</small></div>
          <div class="fin-campo"><label for="fin-cfg-meses">Meses</label>
            <select class="fin-in" id="fin-cfg-meses" data-cfg="meses">${[6, 12, 18, 24].map(n => `<option value="${n}" ${cfg.meses === n ? 'selected' : ''}>${n} meses</option>`).join('')}</select>
            <small>Lo cargado fuera del período se conserva.</small></div>
          <div class="fin-campo"><label for="fin-cfg-caja">Caja al inicio del ejercicio</label>
            <div class="fin-par"><input class="fin-in" id="fin-cfg-caja" inputmode="decimal" data-cfg="caja_inicial" value="${esc(fmtNumEditor(cfg.caja_inicial / esc_))}">
            <select class="fin-in" data-cfg="caja_inicial_moneda" aria-label="Moneda de la caja inicial"><option value="ARS" ${cfg.caja_inicial_moneda === 'ARS' ? 'selected' : ''}>ARS</option><option value="USD" ${cfg.caja_inicial_moneda === 'USD' ? 'selected' : ''}>USD</option></select></div>
            <small>En ${unidad}. Saldo disponible en bancos y caja.</small></div>
          <div class="fin-campo"><label for="fin-cfg-tasa">Tasa de impuesto a las ganancias</label>
            <input class="fin-in" id="fin-cfg-tasa" inputmode="decimal" data-cfg="tasa_ganancias" value="${esc(fmtNumEditor(cfg.tasa_ganancias * 100))}">
            <small>En %. Se usa solo si no cargás los impuestos pagados.</small></div>
          <div class="fin-campo"><label for="fin-cfg-escala">Unidad de carga</label>
            <select class="fin-in" id="fin-cfg-escala" data-cfg="escala">
              <option value="1" ${esc_ === 1 ? 'selected' : ''}>Unidades</option>
              <option value="1000" ${esc_ === 1000 ? 'selected' : ''}>Miles</option>
              <option value="1000000" ${esc_ === 1000000 ? 'selected' : ''}>Millones</option></select>
            <small>Cómo escribís los montos en la grilla. Lo guardado no cambia.</small></div>
        </div>`;
    }

    ed.modal.innerHTML = `
      <div class="fin-modal-box">
        <div class="fin-modal-top">
          <div><h2 id="fin-ed-titulo">Cargar datos financieros</h2>
            <div class="fin-sub">${esc(st.opts.clienteNombre || '')} · ${esc(etiquetaMes(periodos[0], true))} a ${esc(etiquetaMes(periodos[periodos.length - 1], true))}</div></div>
          <button class="fin-cerrar" data-accion="cerrar" aria-label="Cerrar">×</button>
        </div>
        <div class="fin-ed-tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" aria-selected="${ed.pestaña === k}" data-pestaña="${k}">${t}</button>`).join('')}</div>
        <div class="fin-modal-body">${cuerpo}</div>
        <div class="fin-modal-foot">
          <div class="fin-estado" aria-live="polite"></div>
          <div class="fin-actions">
            <button class="fin-btn" data-accion="cerrar">Cancelar</button>
            <button class="fin-btn fin-btn-primary" data-accion="guardar">Guardar</button>
          </div>
        </div>
      </div>`;
  }

  function marcarSucio(st) { st.editor.sucio = true; st.editor.confirmarCierre = false; estadoEditor(st, ''); }

  function leerCelda(st, input) {
    const ed = st.editor, escala = normalizarConfig(ed.b.config).escala;
    const n = parseNumero(input.value);
    if (input.dataset.tc) {
      if (n != null && n > 0) ed.b.tc[input.dataset.tc] = n; else delete ed.b.tc[input.dataset.tc];
      const celda = ed.modal.querySelector(`[data-fuente-tc="${input.dataset.tc}"]`);
      if (celda) {
        const a = ed.curva && ed.curva.porMes[input.dataset.tc];
        celda.textContent = ed.b.tc[input.dataset.tc] ? 'cargado' : (a ? NOMBRE_FUENTE_TC[a.fuente] : 'último');
      }
    } else if (input.dataset.k) {
      if (n != null && n !== 0) ed.b.lineas[input.dataset.k] = n * escala; else delete ed.b.lineas[input.dataset.k];
      actualizarTotal(st, input.dataset.k);
    }
  }

  function actualizarTotal(st, k) {
    const [, rubro, moneda] = k.split('|');
    const ed = st.editor, cfg = normalizarConfig(ed.b.config);
    const tot = mesesDelEjercicio(cfg.inicio, cfg.meses).reduce((a, p) => a + (ed.b.lineas[`${p}|${rubro}|${moneda}`] || 0), 0);
    const td = ed.modal.querySelector(`[data-tot="${rubro}|${moneda}"]`);
    if (td) td.textContent = tot ? fmtNumEditor(tot / cfg.escala) : '';
  }

  function onInputEditor(st, e) {
    const t = e.target;
    if (t.matches('.fin-grilla input')) { leerCelda(st, t); marcarSucio(st); }
  }

  function onChangeEditor(st, e) {
    const t = e.target, ed = st.editor;
    if (t.matches('.fin-grilla input')) {
      leerCelda(st, t);
      const n = parseNumero(t.value);
      t.value = n == null || n === 0 ? '' : fmtNumEditor(n);
      return;
    }
    if (t.dataset.cfg) {
      const c = ed.b.config, escala = normalizarConfig(c).escala;
      const k = t.dataset.cfg;
      if (k === 'inicio') c.inicio = t.value ? `${t.value}-01` : c.inicio;
      else if (k === 'meses') c.meses = parseInt(t.value, 10) || 12;
      else if (k === 'caja_inicial') c.caja_inicial = (parseNumero(t.value) || 0) * escala;
      else if (k === 'caja_inicial_moneda') c.caja_inicial_moneda = t.value;
      else if (k === 'tasa_ganancias') { const n = parseNumero(t.value); c.tasa_ganancias = n == null ? 0.30 : Math.min(100, Math.max(0, n)) / 100; }
      else if (k === 'escala') c.escala = Number(t.value);
      marcarSucio(st);
      if (k === 'inicio' || k === 'meses' || k === 'escala') { pintarEditor(st); estadoEditor(st, ''); }
      return;
    }
    if (t.dataset.b) {
      const tr = t.closest('tr[data-bien]');
      const bien = ed.b.bienes[Number(tr.dataset.bien)];
      const k = t.dataset.b;
      if (['valor_origen', 'valor_residual', 'vida_util_anios'].includes(k)) {
        const n = parseNumero(t.value);
        bien[k] = n == null ? null : Math.max(0, n);
        t.value = fmtNumEditor(bien[k]);
      } else bien[k] = t.value;
      const dep = depreciacionMensual(bien) * 12;
      const td = ed.modal.querySelector(`[data-dep="${tr.dataset.bien}"]`);
      if (td) td.textContent = dep ? fmtMonto(dep, bien.moneda === 'ARS' ? 'ARS' : 'USD') : '—';
      marcarSucio(st);
    }
  }

  function moverFoco(st, input, dFila, dCol) {
    const f = Number(input.dataset.fila) + dFila, c = Number(input.dataset.col) + dCol;
    const sig = st.editor.modal.querySelector(`.fin-grilla input[data-fila="${f}"][data-col="${c}"]`);
    if (sig) { sig.focus(); sig.select(); }
  }

  function onPasteEditor(st, e) {
    const t = e.target;
    if (!t.matches || !t.matches('.fin-grilla input')) return;
    const txt = (e.clipboardData || global.clipboardData).getData('text');
    if (!txt || (!txt.includes('\t') && !txt.includes('\n'))) return;
    e.preventDefault();
    const filas = txt.replace(/\r/g, '').split('\n').filter((r, i, arr) => r.trim() !== '' || i < arr.length - 1);
    const f0 = Number(t.dataset.fila), c0 = Number(t.dataset.col);
    let escritas = 0, df = 0;
    filas.forEach(linea => {
      let celdas = linea.split('\t');
      while (celdas.length && parseNumero(celdas[0]) == null && celdas[0].trim() !== '') celdas.shift(); // etiquetas al inicio
      if (!celdas.length) return;
      celdas.forEach((cel, dc) => {
        const inp = st.editor.modal.querySelector(`.fin-grilla input[data-fila="${f0 + df}"][data-col="${c0 + dc}"]`);
        if (!inp) return;
        const n = parseNumero(cel);
        inp.value = n == null || n === 0 ? '' : fmtNumEditor(n);
        leerCelda(st, inp);
        escritas++;
      });
      df++;
    });
    marcarSucio(st);
    estadoEditor(st, `Pegaste ${escritas} ${escritas === 1 ? 'celda' : 'celdas'}. Revisá y guardá.`, 'ok');
  }

  async function onClickEditor(st, e) {
    const ed = st.editor;
    if (e.target === ed.modal) { intentarCerrar(st); return; }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.pestaña) { ed.pestaña = btn.dataset.pestaña; pintarEditor(st); return; }
    const acc = btn.dataset.accion;
    if (acc === 'cerrar') intentarCerrar(st);
    else if (acc === 'agregar-bien') {
      ed.b.bienes.push({ id: '', nombre: '', categoria: '', moneda: 'USD', valor_origen: null, valor_residual: 0, vida_util_anios: null, fecha_alta: '' });
      marcarSucio(st); pintarEditor(st);
      const ult = ed.modal.querySelectorAll('tr[data-bien] input[data-b="nombre"]');
      if (ult.length) ult[ult.length - 1].focus();
    } else if (acc === 'quitar-bien') {
      ed.b.bienes.splice(Number(btn.dataset.i), 1); marcarSucio(st); pintarEditor(st);
    } else if (acc === 'fijar-tc') {
      const cfg = normalizarConfig(ed.b.config);
      let n = 0;
      mesesDelEjercicio(cfg.inicio, cfg.meses).forEach(p => {
        const a = ed.curva && ed.curva.porMes[p];
        if (a && a.tc > 0 && !(ed.b.tc[p] > 0)) { ed.b.tc[p] = Math.round(a.tc * 100) / 100; n++; }
      });
      marcarSucio(st); pintarEditor(st);
      estadoEditor(st, n ? `Fijaste ${n} tipos de cambio. Guardá para que queden.` : 'No había tipos de cambio automáticos para fijar.', n ? 'ok' : '');
    } else if (acc === 'auto-tc') {
      const n = Object.keys(ed.b.tc).length;
      ed.b.tc = {};
      marcarSucio(st); pintarEditor(st);
      estadoEditor(st, n ? 'Tipo de cambio en automático. Guardá para que quede.' : 'Ya estaba en automático.', n ? 'ok' : '');
    } else if (acc === 'guardar') {
      await guardarEditor(st);
    }
  }

  async function guardarEditor(st) {
    const ed = st.editor;
    if (ed.guardando) return;
    // Validar bienes incompletos
    const incompletos = ed.b.bienes.filter(x => String(x.nombre || '').trim() && !(Number(x.valor_origen) > 0 && Number(x.vida_util_anios) > 0));
    if (incompletos.length) {
      ed.pestaña = 'bienes'; pintarEditor(st);
      estadoEditor(st, `Falta valor de origen o vida útil en: ${incompletos.map(x => x.nombre).join(', ')}.`, 'err');
      return;
    }
    ed.guardando = true;
    const btn = ed.modal.querySelector('[data-accion="guardar"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    estadoEditor(st, '');
    try {
      await guardarDatos(st.opts.sb, st.opts.clienteId, ed.b);
      st.datos = await cargarDatos(st.opts.sb, st.opts.clienteId);
      st.modoEjemplo = false;
      cerrarEditor(st);
      render(st);
      if (typeof st.opts.onGuardado === 'function') st.opts.onGuardado(st.resultado);
    } catch (err) {
      ed.guardando = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
      estadoEditor(st, 'No se pudo guardar: ' + (err && err.message ? err.message : String(err)), 'err');
    }
  }

  /* ───────────── Montaje ───────────── */
  function onClickTablero(st, e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.moneda) { st.moneda = b.dataset.moneda; render(st); return; }
    const acc = b.dataset.accion;
    if (acc === 'editar') abrirEditor(st);
    else if (acc === 'ejemplo') { st.modoEjemplo = true; render(st); }
    else if (acc === 'salir-ejemplo') { st.modoEjemplo = false; render(st); }
    else if (acc === 'reintentar') recargar(st.root);
  }

  async function montar(root, opts) {
    if (!root) return null;
    inyectarCss();
    opts = opts || {};
    let st = estados.get(root);
    const mismo = st && st.opts.clienteId === opts.clienteId && !opts.forzar;
    if (!st) {
      st = { root, moneda: 'USD', modoEjemplo: false };
      estados.set(root, st);
      root.addEventListener('click', e => onClickTablero(st, e));
    }
    st.opts = { puedeEditar: true, tema: 'oscuro', ...opts };
    root.classList.add('fin-root');
    root.classList.toggle('fin-claro', st.opts.tema === 'claro');
    if (mismo && st.datos) { render(st); return st; }
    st.modoEjemplo = false;
    st.cargando = true; st.error = null; render(st);
    try {
      if (!opts.sb || !opts.clienteId) throw new Error('Falta la sesión o el cliente.');
      st.datos = await cargarDatos(opts.sb, opts.clienteId);
      st.cargando = false; render(st);
    } catch (err) {
      st.cargando = false;
      st.error = err && err.message ? err.message : String(err);
      render(st);
    }
    return st;
  }

  function recargar(root) {
    const st = estados.get(root);
    if (!st) return Promise.resolve(null);
    return montar(root, { ...st.opts, forzar: true });
  }

  const api = {
    version: FIN_VERSION, montar, recargar, calcular, evaluar, datosEjemplo, parseNumero,
    fmtMonto, fmtPct, fmtX, UMBRALES, RUBROS, mesesDelEjercicio,
  };
  global.CtxFin = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
