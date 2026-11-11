
/* ═══════════════ APP MÓVIL — AGRICULTURA ═══════════════
   Reusa las funciones reales del panel: buildLevel0/1/2, getFilteredOps,
   calcularL, getPrecioMercado, getPrecioEfectivo, abrirEditarOp, eliminarOp.
   Regla: LONG = Pendiente = delta>0 · SHORT = Realizado = delta<0
   (se filtra por SIGNO DE DELTA, no por lado: una venta de PUT queda en LONG) */
(function(){
  const MOB_BP = 768;
  let mob = {level:0, prod:null, slot:null, tipo:null};
  let _mobTasasProd = null, _mobTasasTNA = false;

  const isMob = () => window.innerWidth <= MOB_BP;
  const usd = v => v>=1e6 ? (v/1e6).toFixed(2)+'M' : Math.round(v/1e3)+'k';
  const usdFull = v => 'USD ' + (Math.abs(v)>=1e6 ? (v/1e6).toFixed(2)+'M' : Math.round(v/1e3)+'k');
  const esc = t => String(t==null?'':t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  function segColor(item, level, i){
    try { return sbItemColor(item, level, i); } catch(e){ return '#5b9ec9'; }
  }

  /* ── Dona con arcos precisos (mismo criterio que el reporte) ── */
  function arcPath(cx,cy,rOut,rIn,a0,a1){
    const p=(r,a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)];
    if(a1-a0 >= 2*Math.PI-1e-6){
      return `M${cx-rOut},${cy}A${rOut},${rOut} 0 1 1 ${cx+rOut},${cy}A${rOut},${rOut} 0 1 1 ${cx-rOut},${cy}Z`
           + `M${cx-rIn},${cy}A${rIn},${rIn} 0 1 0 ${cx+rIn},${cy}A${rIn},${rIn} 0 1 0 ${cx-rIn},${cy}Z`;
    }
    const big=(a1-a0)>Math.PI?1:0;
    const [x0,y0]=p(rOut,a0),[x1,y1]=p(rOut,a1),[x2,y2]=p(rIn,a1),[x3,y3]=p(rIn,a0);
    return `M${x0},${y0}A${rOut},${rOut} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${rIn},${rIn} 0 ${big} 0 ${x3},${y3}Z`;
  }

  function drawDonut(items, level, centerVal, centerLab, onTap, activeName){
    const cx=100,cy=100,rOut=88,rIn=60,pad=0.018;
    const tot=items.reduce((s,i)=>s+i.value,0)||1;
    let a=-Math.PI/2, arcs='';
    items.forEach((it,i)=>{
      const sweep=(it.value/tot)*2*Math.PI, solo=items.length===1;
      const a0=a+(solo?0:pad/2), a1=a+sweep-(solo?0:pad/2);
      const dim = activeName && activeName!==it.name ? ' opacity=".4"' : '';
      arcs+=`<path class="seg" data-i="${i}"${dim} fill-rule="evenodd" d="${arcPath(cx,cy,rOut,rIn,a0,Math.max(a1,a0+0.001))}" fill="${segColor(it,level,i)}"/>`;
      a+=sweep;
    });
    const d=document.getElementById('mob-donut');
    d.innerHTML=`<svg viewBox="0 0 200 200">${arcs}
      <text x="100" y="98" text-anchor="middle" fill="#e8c45a" font-size="30" font-weight="700">${centerVal}</text>
      <text x="100" y="116" text-anchor="middle" fill="#a3b2c1" font-size="8.5" letter-spacing="1.2">USD · ${centerLab}</text></svg>`;
    d.querySelectorAll('.seg').forEach(el=>el.onclick=()=>onTap(items[+el.dataset.i]));

    document.getElementById('mob-legend').innerHTML = items.map((it,i)=>
      `<div class="mob-lgi" data-i="${i}"><span class="mob-sw" style="background:${segColor(it,level,i)}"></span>
        <div><div class="n">${esc(it.name)}</div><div class="p">${(it.value/tot*100).toFixed(1)}%</div></div></div>`).join('');
    document.getElementById('mob-legend').querySelectorAll('.mob-lgi').forEach(el=>el.onclick=()=>onTap(items[+el.dataset.i]));
  }

  /* ── Operaciones (mismos criterios que el panel) ── */
  function opsFiltradas(){
    let rows = getFilteredOps().map(op=>{
      const pM = getPrecioValuacionOp(op);
      const L  = calcularL(op, pM);
      return {op, pM, L};
    }).filter(r => r.L !== 0);
    if(mob.prod) rows = rows.filter(r=>r.op.producto===mob.prod);          // 1) producto
    if(mob.slot) rows = rows.filter(r=> mob.slot==='Pendiente' ? r.L>0 : r.L<0); // 2) delta
    if(mob.tipo) rows = rows.filter(r=>(r.op.tipo||'Otro')===mob.tipo);    // 3) tipo
    return rows;
  }

  function idxEnCache(op){
    try { return (opsCache||[]).findIndex(o=>o.id===op.id); } catch(e){ return -1; }
  }

  function renderOps(){
    const rows = opsFiltradas();
    document.getElementById('mob-ops-title').textContent =
      ['Operaciones',mob.prod,mob.slot,mob.tipo].filter(Boolean).join(' · ');
    const b=document.getElementById('mob-ops-body');
    if(!rows.length){ b.innerHTML='<tr><td colspan="12" style="padding:0"><div class="mob-empty">Sin operaciones para este filtro</div></td></tr>'; return; }
    b.innerHTML = rows.map(({op,pM,L})=>{
      const idx = idxEnCache(op);
      const fOp = op.fecha ? new Date(op.fecha+'T00:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
      const fVto= op.vencimiento ? new Date(op.vencimiento+'T00:00:00').toLocaleDateString('es-AR',{month:'short',year:'numeric'}) : '—';
      const tags=(op.tags||[]).map(t=>`<span style="display:inline-block;padding:3px 9px;border-radius:20px;border:1px solid rgba(212,160,23,.4);color:#e8c45a;font-size:11px;font-weight:700;margin-right:4px">${esc(t)}</span>`).join('');
      const ladoC = op.lado==='Compra' ? 'background:rgba(30,153,112,.16);color:#7fe3b6' : 'background:rgba(212,160,23,.14);color:#e8c45a';
      const acc = idx>=0
        ? `<button onclick="abrirEditarOp(${idx})" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.09);background:transparent;color:#e8e0d4;font-size:13px;cursor:pointer">✎ Editar</button>
           <button onclick="eliminarOp(${idx})" style="padding:7px 12px;border-radius:8px;border:none;background:rgba(217,81,44,.15);color:#f0a58f;font-size:14px;cursor:pointer;margin-left:6px">✕</button>`
        : '—';
      return `<tr>
        <td style="color:#a3b2c1">${fOp}</td><td>${esc(op.producto)}</td><td>${esc(op.tipo||'—')}</td>
        <td><span style="display:inline-block;padding:4px 10px;border-radius:7px;font-size:12px;font-weight:600;${ladoC}">${esc(op.lado||'—')}</span></td>
        <td>${op.volumen!=null?Number(op.volumen).toLocaleString('es-AR'):'—'}</td>
        <td>${op.precio?'$'+Number(op.precio).toFixed(2):'—'}</td>
        <td>${pM?'$'+Number(pM).toFixed(2):'—'}</td>
        <td>${fVto}</td>
        <td style="color:${L<0?'#f0856a':'#a3b2c1'}">${L!==0?(L>0?'Long':'Short'):'—'}</td>
        <td>${tags}</td><td style="color:#7fe3b6;font-size:13px">${esc(op.estado||'Confirmada')}</td>
        <td style="white-space:nowrap">${acc}</td></tr>`;
    }).join('');
  }

  /* ── Long / Short / Neto (toneladas), por producto ── */
  function renderLSN(prod){
    let long=0, short=0, pL_n=0,pL_d=0, pS_n=0,pS_d=0;
    getFilteredOps().forEach(op=>{
      if(op.producto!==prod) return;
      const pM=getPrecioValuacionOp(op);
      const L=calcularL(op,pM); if(L===0) return;
      const v=Number(op.volumen)||0, pr=Number(op.precio)||0;
      if(L>0){ long+=v; if(pr){pL_n+=pr*v; pL_d+=v;} } else { short+=v; if(pr){pS_n+=pr*v; pS_d+=v;} }
    });
    const neto=long-short, f=n=>Math.round(n).toLocaleString('es-AR');
    const pr=(n,d)=>d?('$'+(n/d).toFixed(2)):'—';
    document.getElementById('mob-lsn-cols').innerHTML=
      `<div class="h">Long</div><div class="h">Short</div><div class="h">Neto</div>
       <div class="tn">${f(long)}</div><div class="tn">${f(short)}</div><div class="tn">${f(neto)}</div>
       <div class="pr">${pr(pL_n,pL_d)}</div><div class="pr">${pr(pS_n,pS_d)}</div><div class="pr">${long+short?(neto/(long+short)).toFixed(3):'—'}</div>`;
    document.getElementById('mob-lsn-badge').textContent = neto>=0?'Long':'Short';
  }

  /* ── Render principal ── */
  function render(){
    if(!isMob()) return;
    const t=document.getElementById('mob-title'), back=document.getElementById('mob-back'), hint=document.getElementById('mob-hint');
    if(!t) return;
    try{
      const who=document.getElementById('mob-who');
      if(who) who.textContent = (currentCliente && currentCliente.nombre_empresa) || '—';
      const c = calcularCartera();
      document.getElementById('mob-real').textContent = usdFull(c.realizado);
      document.getElementById('mob-pend').textContent = usdFull(c.pendiente);
    }catch(e){}

    back.style.display = mob.level>0 ? 'block':'none';
    document.getElementById('mob-lsn-box').style.display = mob.level>=1?'block':'none';
    document.getElementById('mob-tasas-box').style.display = mob.level>=1?'block':'none';
    document.getElementById('mob-ops-box').style.display = mob.level>=1?'block':'none';
    if(mob.level>=1) mobRenderTasas();

    if(mob.level===0){
      const items=buildLevel0(), tot=items.reduce((s,i)=>s+i.value,0);
      t.textContent='Cartera';
      drawDonut(items,0,usd(tot),'VALOR TOTAL', it=>{mob={level:1,prod:it.name,slot:null,tipo:null};_mobTasasProd=it.name;render();});
      hint.textContent='Tocá un producto en la dona para filtrar';
    } else if(mob.level===1){
      const items=buildLevel1(mob.prod), tot=items.reduce((s,i)=>s+i.value,0);
      t.innerHTML=`<span class="mob-crumb">Cartera › </span>${esc(mob.prod)}`;
      drawDonut(items,1,usd(tot),'LONG + SHORT', it=>{mob={...mob,level:2,slot:it.name,tipo:null};render();});
      hint.textContent='Tocá Realizado o Pendiente en la dona para ver los tipos de operación';
      renderLSN(mob.prod); renderOps();
    } else {
      const items=buildLevel2(mob.prod,mob.slot), tot=items.reduce((s,i)=>s+i.value,0);
      t.innerHTML=`<span class="mob-crumb">${esc(mob.prod)} › </span>${esc(mob.slot)}`;
      drawDonut(items,2,usd(tot), mob.slot==='Pendiente'?'LONG':'SHORT',
        it=>{mob={...mob,tipo: mob.tipo===it.name?null:it.name};render();}, mob.tipo);
      hint.textContent = mob.tipo ? `Filtrando por: ${mob.tipo}. Tocá de nuevo para quitar el filtro.`
                                  : 'Tocá un tipo de operación para filtrar la tabla';
      renderLSN(mob.prod); renderOps();
    }
  }

  window.mobBack=function(){
    if(mob.level===2){ if(mob.tipo) mob.tipo=null; else mob={level:1,prod:mob.prod,slot:null,tipo:null}; }
    else if(mob.level===1){ mob={level:0,prod:null,slot:null,tipo:null}; }
    render();
  };
  window.mobOpenMenu=()=>document.getElementById('mob-ov-menu').classList.add('on');
  window.mobCloseMenu=()=>document.getElementById('mob-ov-menu').classList.remove('on');

  /* Mueve el DOM real (no lo duplica): conserva IDs y handlers */
  window.mobSheet=function(kind){
    mobCloseMenu();
    const body=document.getElementById('mob-sheet-body'), ttl=document.getElementById('mob-sheet-t');
    body.innerHTML='';
    if(kind==='nueva'){
      ttl.textContent='Nueva operación';
      const form=document.getElementById('acc-nueva');
      if(form){ form.dataset.mobHome=form.dataset.mobHome||'1'; form.style.display='block'; body.appendChild(form); }
    } else {
      ttl.textContent='Gestionar campañas';
      const tabs=document.getElementById('campaign-tabs');
      if(tabs) body.appendChild(tabs);
      const acts=document.createElement('div');
      acts.style.cssText='display:flex;gap:10px;margin-top:18px;flex-wrap:wrap';
      acts.innerHTML='<button class="mob-volver" onclick="addCampaign()">+ Agregar campaña</button>'
        +'<button class="mob-volver" style="border-color:rgba(217,81,44,.5);color:#f0a58f;background:rgba(217,81,44,.08)" onclick="deleteActiveCampaign()">Borrar campaña</button>';
      body.appendChild(acts);
    }
    document.getElementById('mob-ov-sheet').classList.add('on');
  };
  window.mobCloseSheet=function(){ document.getElementById('mob-ov-sheet').classList.remove('on'); render(); };

  window.mobOpenAI=function(){
    const body=document.getElementById('mob-ai-body');
    const sec=document.getElementById('sec-asesor-ia');
    if(sec && sec.parentElement!==body){ sec.style.display='block'; body.appendChild(sec); }
    document.getElementById('mob-ov-ai').classList.add('on');
    document.getElementById('mob-ai-ico').classList.add('on');
  };
  window.mobCloseAI=function(){
    document.getElementById('mob-ov-ai').classList.remove('on');
    document.getElementById('mob-ai-ico').classList.remove('on');
  };

  function sync(){
    const view=document.getElementById('view-agricultura');
    if(!view) return;
    view.classList.toggle('mob-on', isMob());
    document.body.classList.toggle('mob-active', isMob());
    if(isMob()) render();
  }
  function mobRenderTasas(){
    const tabsEl = document.getElementById('mob-tasas-tabs');
    const el = document.getElementById('mob-tasas');
    if(!tabsEl || !el) return;
    if(typeof precios === 'undefined' || !Object.keys(precios).length){ tabsEl.innerHTML=''; el.innerHTML='<div style="color:var(--mgris-d);font-size:13px;padding:6px 2px">Sin precios cargados</div>'; return; }
    if(!mercadoAux.loaded && !mercadoAux.loading) cargarMercadoAux();
    const byProd = tasasByProd();
    const prods = tasasProductosVisibles(byProd);
    if(!prods.length){ tabsEl.innerHTML=''; el.innerHTML=''; return; }
    if(!_mobTasasProd || !prods.includes(_mobTasasProd)){
      _mobTasasProd = (mob.prod && prods.includes(mob.prod)) ? mob.prod : (prods.find(p=>p.toLowerCase()==='soja') || prods[0]);
    }
    tabsEl.innerHTML = prods.map(p=>`<button class="mob-tasas-tab ${p===_mobTasasProd?'active':''}" onclick="window._mobSetTasasProd('${p}')">${p}</button>`).join('')
      + `<button class="mob-tasas-tgl" onclick="window._mobToggleTasasTNA()">${_mobTasasTNA?'TNA':'Directa'}</button>`;
    el.innerHTML = buildTasasContentHTML(byProd[_mobTasasProd], _mobTasasTNA, _mobTasasProd);
  }
  window._mobSetTasasProd = function(p){ _mobTasasProd = p; mobRenderTasas(); };
  window._mobToggleTasasTNA = function(){ _mobTasasTNA = !_mobTasasTNA; mobRenderTasas(); };
  window.mobRenderTasas = mobRenderTasas;
  window.mobRender=render;
  window.addEventListener('resize', sync);
  document.addEventListener('DOMContentLoaded', sync);
  setTimeout(sync, 800);
})();

