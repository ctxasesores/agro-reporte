// ============================================================
//  md-lite.js — Markdown mínimo para los chats de los Asesores IA
//  (Agricultura y Mercado).
//
//  El agente responde con **negritas**, viñetas, títulos ### y tablas
//  simples; hasta ahora el chat sólo entendía negritas y viñetas, y las
//  tablas y títulos llegaban como texto crudo ("| Soja | ... |", "###").
//
//  Soporta: títulos (# a ######), separadores (---), tablas con pipes
//  (con o sin fila de alineación), viñetas (-, *, •) con un nivel de
//  anidado, listas numeradas, **negritas** y `código`.
//  Seguridad: escapa TODO el HTML de entrada antes de dar formato; el
//  texto del modelo nunca se inserta crudo en la página.
//
//  Uso: window.ctxMarkdown(texto) → HTML. Nunca lanza: si algo falla,
//  devuelve el texto escapado con saltos de línea.
// ============================================================
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Formato en línea sobre texto YA escapado.
  function enLinea(s) {
    return s
      .replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  const RE_TITULO    = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const RE_SEPARADOR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_VINETA    = /^(\s*)[-*•]\s+(.*)$/;
  const RE_NUMERO    = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
  const RE_CIFRA     = /^[-+−]?\s?(USD\s?|\$\s?)?[\d.,]+\s?(%|tn|t|pp|USD\/t)?$/i;

  const esFilaTabla = l => /^\s*\|.*\|\s*$/.test(l);
  const esAlineacion = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

  function celdas(l) {
    let t = l.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map(c => c.trim());
  }

  function tabla(filas) {
    let cabecera = null, cuerpo = filas, alin = [];
    if (filas.length >= 2 && esAlineacion(filas[1])) {
      cabecera = celdas(filas[0]);
      alin = celdas(filas[1]).map(c => {
        const izq = c.startsWith(':'), der = c.endsWith(':');
        return izq && der ? 'c' : der ? 'r' : '';
      });
      cuerpo = filas.slice(2);
    }
    const filasCuerpo = cuerpo.filter(f => !esAlineacion(f)).map(celdas);
    // Columna de cifras (todas sus celdas con dato son números) → a la derecha,
    // con su encabezado alineado igual.
    const ncol = Math.max(0, cabecera ? cabecera.length : 0, ...filasCuerpo.map(f => f.length));
    const colCifra = [];
    for (let j = 0; j < ncol; j++) {
      const vals = filasCuerpo.map(f => f[j]).filter(Boolean);
      colCifra[j] = vals.length > 0 && vals.every(v => RE_CIFRA.test(v));
    }
    const clase = j => alin[j] === 'c' ? ' class="md-c"' : (alin[j] === 'r' || colCifra[j]) ? ' class="md-num"' : '';
    let h = '<div class="md-tabla"><table>';
    if (cabecera) {
      h += '<thead><tr>' + cabecera.map((c, j) => `<th${clase(j)}>${enLinea(c)}</th>`).join('') + '</tr></thead>';
    }
    h += '<tbody>' + filasCuerpo
      .map(f => '<tr>' + f.map((c, j) => `<td${clase(j)}>${enLinea(c)}</td>`).join('') + '</tr>')
      .join('') + '</tbody>';
    return h + '</table></div>';
  }

  function item(anidado, marca, txt) {
    return `<div class="md-li${anidado ? ' md-li-2' : ''}"><span class="md-bul">${marca}</span>` +
      `<span class="md-li-t">${enLinea(txt)}</span></div>`;
  }

  function render(texto) {
    const lineas = esc(texto == null ? '' : texto).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let parrafo = [];
    const cerrarParrafo = () => {
      if (parrafo.length) out.push('<p class="md-p">' + parrafo.map(enLinea).join('<br>') + '</p>');
      parrafo = [];
    };

    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      let m;
      if (!l.trim()) { cerrarParrafo(); continue; }
      if ((m = l.match(RE_TITULO))) { cerrarParrafo(); out.push(`<div class="md-h">${enLinea(m[2])}</div>`); continue; }
      if (RE_SEPARADOR.test(l)) { cerrarParrafo(); out.push('<hr class="md-hr">'); continue; }
      if (esFilaTabla(l)) {
        cerrarParrafo();
        const filas = [];
        while (i < lineas.length && esFilaTabla(lineas[i])) filas.push(lineas[i++]);
        i--;
        out.push(tabla(filas));
        continue;
      }
      if ((m = l.match(RE_VINETA))) {
        cerrarParrafo();
        const anidado = m[1].replace(/\t/g, '  ').length >= 2;
        out.push(item(anidado, anidado ? '◦' : '•', m[2]));
        continue;
      }
      if ((m = l.match(RE_NUMERO))) {
        cerrarParrafo();
        out.push(item(m[1].replace(/\t/g, '  ').length >= 2, m[2] + '.', m[3]));
        continue;
      }
      parrafo.push(l.trim());
    }
    cerrarParrafo();
    return out.join('');
  }

  window.ctxMarkdown = function (texto) {
    try {
      return render(texto);
    } catch (e) {
      console.warn('[md-lite]', e);
      return esc(texto == null ? '' : texto).replace(/\n/g, '<br>');
    }
  };
})();
