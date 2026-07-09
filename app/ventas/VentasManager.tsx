'use client';
import { useState, useEffect, useRef } from 'react';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import type { EstimacionCosechaCercana } from '@/lib/planificacionServer';

const PP = [
  { key:'rucula',         xubio:'Rucula Hidropónica',                     label:'Rúcula',     color:'#166534' },
  { key:'lechuga_crespa', xubio:'Lechuga Crespa Hidropónica',             label:'Crespa',     color:'#4d7c0f' },
  { key:'hoja_roble',     xubio:'Lechuga Hoja de Roble Verde Hidropónica',label:'Hoja Roble', color:'#65a30d' },
] as const;
const PE = [
  { key:'bandeja_rucula', xubio:'Rucula Bandeja',      label:'Bandeja', color:'#14532d' },
  { key:'albahaca',       xubio:'Albahaca Hidropónica',label:'Albahaca',color:'#047857' },
] as const;
const ALL = [...PP,...PE];

interface LineaCarga { id_control:string; nombre_cliente:string; rucula:number; lechuga_crespa:number; hoja_roble:number; bandeja_rucula:number; albahaca:number; rucula_kg:number; lechuga_kg:number }
// Resumen de texto (cantidades por cliente y por producto) para el mensaje de "Cargar ventas".
function resumenCarga(lineas: LineaCarga[]): string {
  const claveProd = [...ALL.map(p=>({key:p.key as keyof LineaCarga & string, label:p.label, u:'u'})), {key:'rucula_kg' as const,label:'Rúcula',u:'kg'}, {key:'lechuga_kg' as const,label:'Lechuga',u:'kg'}];
  const porCliente = new Map<string, number>();
  const porProducto = new Map<string, number>();
  for (const l of lineas) {
    let totalLinea = 0;
    for (const p of claveProd) {
      const v = Number((l as any)[p.key]) || 0;
      if (v <= 0) continue;
      totalLinea += v;
      porProducto.set(`${p.label} (${p.u})`, (porProducto.get(`${p.label} (${p.u})`) || 0) + v);
    }
    if (totalLinea > 0) porCliente.set(l.nombre_cliente, (porCliente.get(l.nombre_cliente) || 0) + totalLinea);
  }
  const fmt = (n:number) => n.toLocaleString('es-AR');
  const lineasCliente = Array.from(porCliente.entries()).sort((a,b)=>b[1]-a[1]).map(([c,t])=>`· ${c}: ${fmt(t)} u`).join('\n');
  const lineasProducto = Array.from(porProducto.entries()).sort((a,b)=>b[1]-a[1]).map(([p,t])=>`· ${p}: ${fmt(t)}`).join('\n');
  return `\nPor cliente:\n${lineasCliente}\n\nPor producto:\n${lineasProducto}`;
}
type PK = 'rucula'|'lechuga_crespa'|'hoja_roble'|'bandeja_rucula'|'albahaca';
type SV = { rucula:number; lechuga_crespa:number; hoja_roble:number };
type SKG = { rucula_kg:number; lechuga_kg:number };
type Stats = { semanaActual:SV; semanaAnterior:SV; mesActual:SV; mesAnterior:SV; kg:{semanaActual:SKG;semanaAnterior:SKG;mesActual:SKG;mesAnterior:SKG} };
interface Fila { id_control:string; nombre_cliente:string; sucursal:string; nombre_display:string; tipo:string; unidad:'paq'|'kg'|'' }
type Ctds = Record<string, Record<PK,string>>;
type CKG = Record<string, {rucula_kg:string; lechuga_kg:string}>;
type Ests = Record<string, Record<PK,'idle'|'saving'|'saved'|'error'>>;
const EQ: Record<PK,string> = { rucula:'',lechuga_crespa:'',hoja_roble:'',bandeja_rucula:'',albahaca:'' };

function mkFilas(cs: ClienteVenta[], freq: Record<string,number>): Fila[] {
  const out: Fila[] = [];
  for (const c of cs) {
    if (c.activo!=='SI') continue;
    const unidad = c.unidad || 'paq';
    const sucs = c.sucursales ? c.sucursales.split('|').map(s=>s.trim()).filter(Boolean) : [];
    if (!sucs.length) { out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:c.nombre_xubio,nombre_display:c.nombre_display||c.nombre_xubio,tipo:c.tipo_factura,unidad}); }
    else { for (const s of sucs) out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:s,nombre_display:`${c.nombre_display||c.nombre_xubio} · ${s.split(' ').slice(-1)[0]}`,tipo:c.tipo_factura,unidad}); }
  }
  return out.sort((a,b)=>(freq[b.id_control]||0)-(freq[a.id_control]||0));
}

export default function VentasManager({clientes,precios,frecuencias,stats,ventas7,estimCosecha}:{clientes:ClienteVenta[];precios:PrecioVenta[];frecuencias:Record<string,number>;stats:Stats;ventas7:VentaDia[];estimCosecha:EstimacionCosechaCercana}) {
  const hoy = new Date().toISOString().split('T')[0];
  const [fecha,setFecha]=useState(hoy);
  const [showExpSelector,setShowExpSelector]=useState(false);
  const [fc,setFc]=useState<Record<string,string>>({});
  const [ctds,setCtds]=useState<Ctds>({});
  const [ests,setEsts]=useState<Ests>({});
  const [disp,setDisp]=useState<Record<PK,string>>({rucula:'',lechuga_crespa:'',hoja_roble:'',bandeja_rucula:'',albahaca:''});
  const [extras,setExtras]=useState(false);
  const [loading,setLoading]=useState(false);
  const [exp,setExp]=useState(false);
  const [msg,setMsg]=useState<{t:'ok'|'err';s:string}|null>(null);
  const [showP,setShowP]=useState(false);
  const [showHistorial,setShowHistorial]=useState(false);
  const [showPreExport,setShowPreExport]=useState(false);
  const [correlaA,setCorrelaA]=useState<string>('');
  const [correlaB,setCorrelaB]=useState<string>('');
  const [enviarEmail,setEnviarEmail]=useState(true);
  const [historial,setHistorial]=useState<{exportaciones:any[];pendientes:any[]}>({exportaciones:[],pendientes:[]});
  const [loadHist,setLoadHist]=useState(false);
  const [currentExportId,setCurrentExportId]=useState<string|null>(null);
  const [limpiando,setLimpiando]=useState(false);
  const [stockCamara,setStockCamara]=useState<{rucula:{stockActual:number;diasPromedio:number};lechuga:{stockActual:number;diasPromedio:number};factorGrPaq:{rucula:number;lechuga:number}}|null>(null);
  const [ctdsKg,setCtdsKg]=useState<CKG>({});
  const [fechaExportada,setFechaExportada]=useState(false);
  const ctdsKgLive=useRef<CKG>({});
  // Referencias directas a los inputs KG del DOM — fuente de verdad para saveKg
  const kgInputRefs=useRef<Record<string,{rucula_kg:HTMLInputElement|null;lechuga_kg:HTMLInputElement|null}>>({});
  type EstKG = Record<string,{rucula_kg:'idle'|'saving'|'saved'|'error';lechuga_kg:'idle'|'saving'|'saved'|'error'}>;
  const [estsKg,setEstsKg]=useState<EstKG>({});
  const tmrs=useRef<Record<string,ReturnType<typeof setTimeout>>>({});

  const prods = extras ? ALL : PP;
  const filas = mkFilas(clientes,frecuencias);

  function pr(id:string,suc:string,k:PK){const r=precios.find(p=>String(p.id_control)===String(id)&&p.sucursal_obs===suc);return r?Number((r as any)[k]||0):0;}
  function q(id:string,suc:string,k:PK){return ctds[`${id}__${suc}`]?.[k]||'';}
  function e(id:string,suc:string,k:PK){return ests[`${id}__${suc}`]?.[k]||'idle';}
  function se(id:string,suc:string,k:PK,v:'idle'|'saving'|'saved'|'error'){
    setEsts(p=>({...p,[`${id}__${suc}`]:{...(p[`${id}__${suc}`]||{}),[k]:v}as any}));
  }

  // Cargar stock en cámara
  useEffect(()=>{
    fetch('/api/stocks/camara').then(r=>r.json()).then(j=>{ if(j.rucula&&j.lechuga) setStockCamara(j); }).catch(()=>{});
  },[]);

  // Cargar correlativo actual al iniciar
  useEffect(()=>{
    fetch('/api/ventas/historial').then(r=>r.json()).then(j=>{
      if(j.lastA) setCorrelaA(String(j.lastA+1));
      if(j.lastB) setCorrelaB(String(j.lastB+1));
    }).catch(()=>{});
  },[]);

  async function limpiarDia(todo=false){
    const msg2 = todo ? '¿Limpiar TODAS las ventas de la hoja? Esto no se puede deshacer.' : `¿Limpiar todas las ventas del ${fecha}?`;
    if(!confirm(msg2)) return;
    setLimpiando(true);
    try{
      await fetch('/api/ventas/limpiar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,limpiarTodo:todo})});
      setCtds({}); setEsts({});
      setMsg({t:'ok',s:todo?'Hoja limpiada':'Día limpiado'});
    }catch(e:any){setMsg({t:'err',s:e.message});}
    setLimpiando(false);
  }

  function cargarHistorial(){
    setLoadHist(true);
    fetch('/api/ventas/historial').then(r=>r.json()).then(j=>{
      setHistorial({exportaciones:j.exportaciones||[],pendientes:j.pendientes||[]});
      if(j.lastA) setCorrelaA(String(j.lastA+1));
      if(j.lastB) setCorrelaB(String(j.lastB+1));
    }).catch(()=>{}).finally(()=>setLoadHist(false));
  }

  function cargarExportacion(idExp:string, fechaExp:string){
    setCurrentExportId(idExp);
    setFecha(fechaExp);
    setShowHistorial(false);
    setLoading(true);setMsg(null);
    fetch(`/api/ventas/fecha?id_exportacion=${idExp}`).then(r=>r.json()).then((data:VentaDia[])=>{
      const c:Ctds={}; const ckg:CKG={};
      for(const v of data){
        const key=`${v.id_control}__${v.sucursal}`;
        c[key]={rucula:String(v.rucula||''),lechuga_crespa:String(v.lechuga_crespa||''),hoja_roble:String(v.hoja_roble||''),bandeja_rucula:String(v.bandeja_rucula||''),albahaca:String(v.albahaca||'')};
        ckg[key]={rucula_kg:String(v.rucula_kg||''),lechuga_kg:String(v.lechuga_kg||'')};
      }
      ctdsKgLive.current=ckg;
      setFechaExportada(true);
      setCtds(c);setCtdsKg(ckg);setEsts({});setEstsKg({});
    }).catch(()=>{}).finally(()=>setLoading(false));
  }

  useEffect(()=>{
    if(currentExportId) return; // Si estamos editando una exportación, no recargar por fecha
    setLoading(true);setMsg(null);
    fetch(`/api/ventas/fecha?fecha=${fecha}`).then(r=>r.json()).then((data:VentaDia[])=>{
      const c:Ctds={}; const ckg:CKG={};
      for(const v of data){
        const key=`${v.id_control}__${v.sucursal}`;
        c[key]={rucula:String(v.rucula||''),lechuga_crespa:String(v.lechuga_crespa||''),hoja_roble:String(v.hoja_roble||''),bandeja_rucula:String(v.bandeja_rucula||''),albahaca:String(v.albahaca||'')};
        ckg[key]={rucula_kg:String(v.rucula_kg||''),lechuga_kg:String(v.lechuga_kg||'')};
      }
      ctdsKgLive.current = ckg;
      setFechaExportada(false);
      setCurrentExportId(null);
      setCtds(c); setCtdsKg(ckg); setEsts({}); setEstsKg({});
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[fecha]);

  function onChange(f:Fila,k:PK,v:string){
    setCtds(p=>({...p,[`${f.id_control}__${f.sucursal}`]:{...(p[`${f.id_control}__${f.sucursal}`]||EQ),[k]:v}}));
    se(f.id_control,f.sucursal,k,'idle');
  }
  function onBlur(f:Fila,k:PK){const tk=`${f.id_control}__${f.sucursal}__${k}`;clearTimeout(tmrs.current[tk]);tmrs.current[tk]=setTimeout(()=>save(f,k),400);}
  async function save(f:Fila,k:PK){
    if(q(f.id_control,f.sucursal,k)==='')return;
    se(f.id_control,f.sucursal,k,'saving');
    try{
      const r=await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:currentExportId,lineas:[{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0}]})});
      if(!r.ok)throw new Error();
      se(f.id_control,f.sucursal,k,'saved');setTimeout(()=>se(f.id_control,f.sucursal,k,'idle'),2000);
    }catch{se(f.id_control,f.sucursal,k,'error');}
  }
  function qKg(id:string,suc:string,k:'rucula_kg'|'lechuga_kg'){return ctdsKg[`${id}__${suc}`]?.[k]||'';}
  function seKg(id:string,suc:string,k:'rucula_kg'|'lechuga_kg',v:'idle'|'saving'|'saved'|'error'){
    setEstsKg(p=>({...p,[`${id}__${suc}`]:{...(p[`${id}__${suc}`]||{rucula_kg:'idle',lechuga_kg:'idle'}),[k]:v}}));
  }
  function onChangeKg(f:Fila,k:'rucula_kg'|'lechuga_kg',v:string){
    setCtdsKg(p=>{const next={...p,[`${f.id_control}__${f.sucursal}`]:{...(p[`${f.id_control}__${f.sucursal}`]||{rucula_kg:'',lechuga_kg:''}),[k]:v}};ctdsKgLive.current=next;return next;});
    seKg(f.id_control,f.sucursal,k,'idle');
  }
  async function saveKg(f:Fila){
    const domRefs=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];
    // Leer del DOM directamente — es la fuente más confiable (sin closures ni batching de React)
    const rkg=Number(domRefs?.rucula_kg?.value)||0;
    const lkg=Number(domRefs?.lechuga_kg?.value)||0;
    (['rucula_kg','lechuga_kg'] as const).forEach(k=>seKg(f.id_control,f.sucursal,k,'saving'));
    try{
      const r=await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:currentExportId,lineas:[{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:rkg,lechuga_kg:lkg}]})});
      if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error((j as any).error||'Error');};
      (['rucula_kg','lechuga_kg'] as const).forEach(k=>{seKg(f.id_control,f.sucursal,k,'saved');setTimeout(()=>seKg(f.id_control,f.sucursal,k,'idle'),2000);});
    }catch(err:any){
      (['rucula_kg','lechuga_kg'] as const).forEach(k=>seKg(f.id_control,f.sucursal,k,'error'));
      setMsg({t:'err',s:`Error al guardar KG de ${f.nombre_display}: ${err.message}`});
    }
  }
  async function cargarVentas(){
    setExp(true);setMsg(null);
    try{
      setShowPreExport(false);
      Object.values(tmrs.current).forEach(t=>clearTimeout(t));
      // Flush de todas las cantidades cargadas (igual que en exportar)
      const todasLineas = [
        ...filasNormales.map(f=>({id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0,rucula_kg:0,lechuga_kg:0})),
        ...filasKg.map(f=>{const dr=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];return{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:Number(dr?.rucula_kg?.value)||0,lechuga_kg:Number(dr?.lechuga_kg?.value)||0};}),
      ].filter(l=>l.rucula>0||l.lechuga_crespa>0||l.hoja_roble>0||l.bandeja_rucula>0||l.albahaca>0||l.rucula_kg>0||l.lechuga_kg>0);
      const flushR = await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:null,lineas:todasLineas})});
      if(!flushR.ok){const j=await flushR.json().catch(()=>({}));throw new Error((j as any).error||'Error al guardar ventas');}
      const r=await fetch('/api/ventas/cargar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      const nEmit=(j.emitidas||[]).length, nErr=(j.errores||[]).length;
      const txt = nEmit>0
        ? `✓ Facturas cargadas OK\n${resumenCarga(todasLineas)}${nErr>0?`\n\n⚠ ${nErr} con error — revisalas en Facturación.`:''}`
        : nErr>0 ? `No se pudo emitir ninguna (${nErr} con error) — revisá en Facturación.` : `${j.clientes} cliente(s) cargados.`;
      setMsg({t: nErr>0 && nEmit===0 ? 'err' : 'ok', s: txt});
      setCtds({});setEsts({});setCtdsKg({});ctdsKgLive.current={};setFc({});
    }catch(err:any){setMsg({t:'err',s:err.message});}
    setExp(false);
  }
  async function exportar(){
    setExp(true);setMsg(null);
    try{
      setShowPreExport(false);
      // Cancelar timers pendientes y guardar TODO en UN solo request antes de exportar
      Object.values(tmrs.current).forEach(t=>clearTimeout(t));
      const todasLineas = [
        ...filasNormales.map(f=>({id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0,rucula_kg:0,lechuga_kg:0})),
        ...filasKg.map(f=>{const dr=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];return{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:Number(dr?.rucula_kg?.value)||0,lechuga_kg:Number(dr?.lechuga_kg?.value)||0};}),
      // Solo enviar líneas con al menos una cantidad > 0
      ].filter(l=>l.rucula>0||l.lechuga_crespa>0||l.hoja_roble>0||l.bandeja_rucula>0||l.albahaca>0||l.rucula_kg>0||l.lechuga_kg>0);
      const flushR = await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:currentExportId,lineas:todasLineas})});
      if(!flushR.ok){const j=await flushR.json().catch(()=>({}));throw new Error((j as any).error||'Error al guardar ventas');}
      const r=await fetch('/api/ventas/exportar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,fechasCliente:fc,correlaA:Number(correlaA),correlaB:Number(correlaB),enviarEmail,...(currentExportId?{id_exportacion:currentExportId}:{})})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      const bytes=Uint8Array.from(atob(j.file),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes]));
      const a=document.createElement('a');a.href=url;a.download=j.filename;a.click();URL.revokeObjectURL(url);
      const emailTxt = j.emailOk ? ' · Email ✓' : enviarEmail ? ` · Email falló: ${j.emailError||'error'}` : '';
      setMsg({t:'ok',s:`${j.facturas} facturas · A→${j.lastA} · B→${j.lastB}${emailTxt}`});
      setCorrelaA(String(j.lastA+1)); setCorrelaB(String(j.lastB+1));
      // Limpiar estado local (la hoja conserva los valores como registro histórico)
      setCtds({});setEsts({});setCtdsKg({});ctdsKgLive.current={};setFc({});
      setCurrentExportId(null);setFechaExportada(false);
    }catch(err:any){setMsg({t:'err',s:err.message});}
    setExp(false);
  }

  const filasNormales = filas.filter(f=>f.unidad!=='kg');
  const filasKg = filas.filter(f=>f.unidad==='kg');
  const tots:Record<PK,number>={rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0};
  for(const f of filasNormales)for(const p of ALL)tots[p.key]+=Number(q(f.id_control,f.sucursal,p.key))||0;
  const totsKg={rucula_kg:0,lechuga_kg:0};
  for(const f of filasKg){totsKg.rucula_kg+=Number(qKg(f.id_control,f.sucursal,'rucula_kg'))||0;totsKg.lechuga_kg+=Number(qKg(f.id_control,f.sucursal,'lechuga_kg'))||0;}
  const hayV=Object.values(tots).some(v=>v>0)||totsKg.rucula_kg>0||totsKg.lechuga_kg>0;

  // Total por cliente hace 7 días (para comparación)
  function total7d(id_control:string, sucursal:string): number {
    const v = ventas7.find(v=>String(v.id_control)===String(id_control)&&v.sucursal===sucursal);
    if(!v) return 0;
    return (['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca'] as PK[])
      .reduce((acc,k)=>acc+Number((v as any)[k]||0),0);
  }
  function totalHoy(id_control:string, sucursal:string): number {
    return (prods as any[]).reduce((acc:number,p:any)=>acc+Number(q(id_control,sucursal,p.key))||0, 0);
  }
  const totalHoyGlobal = filas.reduce((acc,f)=>acc+totalHoy(f.id_control,f.sucursal),0);
  const total7dGlobal = ventas7.reduce((acc,v)=>acc+(['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca'] as PK[]).reduce((a,k)=>a+Number((v as any)[k]||0),0),0);

  return (
    <div>
      {/* Stock disponible hoy (unidades) */}
      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'8px 14px',marginBottom:'12px'}}>
        <p style={{margin:'0 0 8px',fontSize:'12px',fontWeight:700,color:'#166534'}}>🥬 Disponible para vender hoy</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          {(['rucula','lechuga'] as const).map(cultivo=>{
            const sc = stockCamara?.[cultivo]?.stockActual ?? 0;
            const estCosecha = estimCosecha?.[cultivo] ?? 0;
            const label  = cultivo==='rucula'?'Rúcula':'Lechuga';
            const color  = cultivo==='rucula'?'#b45309':'#166534';
            const bg     = cultivo==='rucula'?'#fffbeb':'#f0fdf4';
            const border = cultivo==='rucula'?'#fde68a':'#bbf7d0';
            return (
              <div key={cultivo} style={{background:bg,border:`1px solid ${border}`,borderRadius:'8px',padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                <span style={{fontSize:'12px',fontWeight:700,color}}>{label}</span>
                <div style={{display:'flex',gap:'14px',alignItems:'baseline'}}>
                  <span style={{fontSize:'11px',color:'#6b7280'}}>Stock al día: <strong style={{fontSize:'15px',color:'#111827'}}>{sc} u</strong></span>
                  <span style={{fontSize:'11px',color:'#6b7280'}}>Cosecha hoy/mañana: <strong style={{fontSize:'15px',color:'#111827'}}>{estCosecha} u</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controles */}
      <div style={{display:'flex',gap:'10px',alignItems:'flex-end',flexWrap:'wrap',marginBottom:'8px'}}>
        <div>
          <label style={{fontSize:'10px',color:'#6b7280',display:'block',marginBottom:'2px'}}>FECHA FACTURACIÓN</label>
          <input type="date" value={fecha} onChange={ev=>setFecha(ev.target.value)} style={{fontSize:'14px',fontWeight:600,border:'1px solid #e5e7eb',borderRadius:'7px',padding:'6px 10px'}}/>
        </div>
        {/* Selector de exportaciones anteriores */}
        <div style={{position:'relative'}}>
          <button onClick={()=>{if(!showExpSelector){cargarHistorial();}setShowExpSelector(p=>!p);}}
            style={{background:currentExportId?'#dbeafe':'white',border:`1px solid ${currentExportId?'#93c5fd':'#e5e7eb'}`,borderRadius:'7px',padding:'6px 10px',fontSize:'12px',cursor:'pointer',color:currentExportId?'#1e40af':'#6b7280',fontWeight:currentExportId?700:400,marginTop:'14px',whiteSpace:'nowrap'}}>
            {currentExportId?`📋 ${currentExportId}`:'📋 Exportaciones'}
          </button>
          {showExpSelector&&(
            <div style={{position:'absolute',top:'100%',left:0,zIndex:100,background:'white',border:'1px solid #e5e7eb',borderRadius:'8px',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',minWidth:'300px',maxHeight:'280px',overflowY:'auto',marginTop:'4px'}}>
              {loadHist?<p style={{padding:'12px',fontSize:'12px',color:'#9ca3af'}}>Cargando…</p>:(
                <>
                  <div style={{padding:'8px',borderBottom:'1px solid #f3f4f6'}}>
                    <button onClick={()=>{setCurrentExportId(null);setFechaExportada(false);setShowExpSelector(false);}}
                      style={{width:'100%',textAlign:'left',background:!currentExportId?'#eff6ff':'none',border:'none',borderRadius:'5px',padding:'5px 8px',fontSize:'12px',cursor:'pointer',color:'#374151',fontWeight:!currentExportId?700:400}}>
                      ✏️ Nueva sesión (pendientes)
                    </button>
                  </div>
                  {historial.exportaciones.length===0?<p style={{padding:'12px',fontSize:'12px',color:'#9ca3af'}}>Sin exportaciones previas</p>:(
                    historial.exportaciones.map((h:any)=>(
                      <button key={h.id_exportacion} onClick={()=>{cargarExportacion(h.id_exportacion,h.fecha);setShowExpSelector(false);}}
                        style={{width:'100%',textAlign:'left',background:h.id_exportacion===currentExportId?'#dbeafe':'none',border:'none',borderBottom:'1px solid #f9fafb',padding:'7px 10px',fontSize:'12px',cursor:'pointer',color:'#374151',display:'block'}}>
                        <div style={{display:'flex',alignItems:'baseline',gap:'6px'}}>
                          <span style={{fontFamily:'monospace',color:'#1e40af',fontWeight:600}}>{h.id_exportacion}</span>
                          <span style={{color:'#9ca3af',fontSize:'11px'}}>{h.fecha} · {h.facturas ?? h.clientes ?? 0} fact.</span>
                        </div>
                        {h.clientesNombres?.length>0 && (
                          <div style={{fontSize:'10px',color:'#6b7280',marginTop:'2px',lineHeight:'1.4'}}>
                            {h.clientesNombres.join(' · ')}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'#6b7280',cursor:'pointer',userSelect:'none',marginBottom:'2px'}}>
          <input type="checkbox" checked={extras} onChange={ev=>setExtras(ev.target.checked)}/> Bandeja + Albahaca
        </label>
        <button onClick={()=>limpiarDia(false)} disabled={limpiando}
          style={{background:'none',border:'1px solid #fca5a5',borderRadius:'8px',padding:'8px 12px',fontWeight:600,fontSize:'12px',cursor:'pointer',color:'#dc2626',marginTop:'14px'}}>
          🗑 Limpiar día
        </button>
        <button onClick={()=>{ if(hayV&&!exp) setShowPreExport(true); }} disabled={!hayV||exp} title="Descargar Excel de respaldo"
          style={{background:'white',color:hayV?'#6b7280':'#d1d5db',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'8px 12px',fontWeight:600,fontSize:'12px',cursor:hayV&&!exp?'pointer':'not-allowed',marginLeft:'auto',display:'flex',alignItems:'center',gap:'4px'}}>
          <span>⬇</span>Excel
        </button>
        <button onClick={()=>{ if(hayV&&!exp) cargarVentas(); }} disabled={!hayV||exp}
          style={{background:hayV&&!exp?'#1d4ed8':'#e5e7eb',color:hayV&&!exp?'white':'#9ca3af',border:'none',borderRadius:'8px',padding:'8px 18px',fontWeight:700,fontSize:'13px',cursor:hayV&&!exp?'pointer':'not-allowed',display:'flex',alignItems:'center',gap:'5px'}}>
          <span>📥</span>{exp?'Cargando…':'Cargar ventas'}
        </button>
      </div>
      {/* Click outside para cerrar selector */}
      {showExpSelector&&<div style={{position:'fixed',inset:0,zIndex:99}} onClick={()=>setShowExpSelector(false)}/>}

      {/* Banner exportación cargada */}
      {currentExportId&&(
        <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'8px',padding:'8px 14px',marginBottom:'8px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
          <span style={{fontSize:'13px',color:'#1e40af',fontWeight:600}}>📋 Editando exportación {currentExportId}</span>
          <span style={{fontSize:'12px',color:'#3b82f6'}}>Modificá los valores y volvé a exportar.</span>
          <button onClick={()=>{setCurrentExportId(null);setFechaExportada(false);setCtds({});setCtdsKg({});ctdsKgLive.current={};}}
            style={{marginLeft:'auto',background:'none',border:'1px solid #bfdbfe',borderRadius:'5px',padding:'2px 8px',fontSize:'11px',cursor:'pointer',color:'#1e40af'}}>
            × Cerrar
          </button>
        </div>
      )}

      {/* Panel pre-exportación */}
      {showPreExport && (
        <div style={{background:'#eff6ff',border:'2px solid #3b82f6',borderRadius:'10px',padding:'16px',marginBottom:'12px'}}>
          <p style={{margin:'0 0 12px',fontSize:'13px',fontWeight:700,color:'#1d4ed8'}}>📋 Confirmar exportación — {fecha}</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div>
              <label style={{fontSize:'11px',color:'#6b7280',display:'block',marginBottom:'3px'}}>PRÓXIMA FACTURA A</label>
              <input type="number" value={correlaA} onChange={ev=>setCorrelaA(ev.target.value)}
                style={{width:'100%',fontSize:'16px',fontWeight:700,border:'2px solid #93c5fd',borderRadius:'7px',padding:'7px 10px',color:'#1e40af'}}/>
            </div>
            <div>
              <label style={{fontSize:'11px',color:'#6b7280',display:'block',marginBottom:'3px'}}>PRÓXIMA FACTURA B</label>
              <input type="number" value={correlaB} onChange={ev=>setCorrelaB(ev.target.value)}
                style={{width:'100%',fontSize:'16px',fontWeight:700,border:'2px solid #93c5fd',borderRadius:'7px',padding:'7px 10px',color:'#1e40af'}}/>
            </div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px',cursor:'pointer',marginBottom:'14px',color:'#374151'}}>
            <input type="checkbox" checked={enviarEmail} onChange={ev=>setEnviarEmail(ev.target.checked)} style={{width:'16px',height:'16px'}}/>
            Enviar por email a administracion@xavia.com.ar
          </label>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={exportar} disabled={exp}
              style={{background:'#1d4ed8',color:'white',border:'none',borderRadius:'8px',padding:'9px 20px',fontWeight:700,fontSize:'13px',cursor:'pointer',flex:1}}>
              {exp?'Generando…':'✓ Generar Excel'}
            </button>
            <button onClick={()=>setShowPreExport(false)}
              style={{background:'white',color:'#6b7280',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',cursor:'pointer'}}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {msg&&<div style={{padding:'9px 14px',borderRadius:'7px',marginBottom:'10px',fontSize:'12px',whiteSpace:'pre-line',background:msg.t==='ok'?'#f0fdf4':'#fef2f2',border:`1px solid ${msg.t==='ok'?'#86efac':'#fca5a5'}`,color:msg.t==='ok'?'#166534':'#dc2626'}}>{msg.s}</div>}

      {/* Tabla */}
      {loading?<div style={{textAlign:'center',padding:'24px',color:'#9ca3af'}}>Cargando…</div>:(
        <div style={{overflowX:'auto',marginBottom:'4px'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#f8fafc',borderBottom:'2px solid #e5e7eb'}}>
                <th style={{textAlign:'left',padding:'9px 12px',minWidth:'150px'}}>Cliente</th>
                {(prods as any[]).map((p:any)=><th key={p.key} style={{textAlign:'center',padding:'9px 6px',color:p.color,fontWeight:700,minWidth:'82px'}}>{p.label}</th>)}
                <th style={{textAlign:'right',padding:'9px 8px',color:'#374151',fontWeight:700,minWidth:'80px'}}>Total</th>
                <th style={{textAlign:'center',padding:'9px 6px',color:'#9ca3af',minWidth:'92px',fontSize:'10px'}}>Fecha fact.</th>
              </tr>
            </thead>
            <tbody>
              {filasNormales.map((f,i)=>{
                const act=(prods as any[]).some((p:any)=>Number(q(f.id_control,f.sucursal,p.key))>0);
                return(
                  <tr key={`${f.id_control}__${f.sucursal}`} style={{background:act?'#f0fdf4':(i%2===0?'white':'#fafafa'),borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'6px 12px'}}>
                      <span style={{fontWeight:act?600:400}}>{f.nombre_display}</span>
                      <span style={{marginLeft:'4px',fontSize:'10px',background:f.tipo==='A'?'#dbeafe':'#fef9c3',color:f.tipo==='A'?'#1e40af':'#92400e',padding:'1px 4px',borderRadius:'3px',fontWeight:600}}>F{f.tipo}</span>
                    </td>
                    {(prods as any[]).map((p:any)=>{
                      const est=e(f.id_control,f.sucursal,p.key);const val=q(f.id_control,f.sucursal,p.key);
                      return(
                        <td key={p.key} style={{padding:'3px 4px'}}>
                          <input type="number" min={0} value={val} placeholder="—"
                            onChange={ev=>onChange(f,p.key,ev.target.value)} onBlur={()=>onBlur(f,p.key)}
                            style={{width:'100%',textAlign:'center',fontSize:'15px',fontWeight:700,
                              border:`2px solid ${est==='saving'?'#fbbf24':est==='saved'?'#86efac':est==='error'?'#fca5a5':Number(val)>0?'#86efac':'#e5e7eb'}`,
                              borderRadius:'6px',padding:'5px 4px',background:Number(val)>0?'#f0fdf4':'white',color:Number(val)>0?'#166534':'#9ca3af',outline:'none'}}/>
                        </td>
                      );
                    })}
                    {(()=>{
                      const hoyT=totalHoy(f.id_control,f.sucursal);
                      const antT=total7d(f.id_control,f.sucursal);
                      const delta=antT>0?Math.round(((hoyT-antT)/antT)*100):null;
                      return(
                        <td style={{padding:'4px 8px',textAlign:'right'}}>
                          <p style={{margin:'0 0 1px',fontSize:'15px',fontWeight:800,color:hoyT>0?'#166534':'#d1d5db'}}>{hoyT>0?hoyT:'—'}</p>
                          {delta!==null&&<p style={{margin:0,fontSize:'9px',fontWeight:700,color:delta>=0?'#059669':'#dc2626'}}>{delta>=0?'↑':'↓'}{Math.abs(delta)}%</p>}
                          {antT>0&&delta===null&&<p style={{margin:0,fontSize:'9px',color:'#9ca3af'}}>ant:{antT}</p>}
                        </td>
                      );
                    })()}
                    <td style={{padding:'3px 5px'}}>
                      <input type="date" value={fc[f.id_control]||fecha} onChange={ev=>setFc(p=>({...p,[f.id_control]:ev.target.value}))}
                        style={{width:'100%',fontSize:'10px',border:`1px solid ${fc[f.id_control]&&fc[f.id_control]!==fecha?'#fbbf24':'#e5e7eb'}`,borderRadius:'5px',padding:'4px 3px',background:fc[f.id_control]&&fc[f.id_control]!==fecha?'#fffbeb':'white',color:fc[f.id_control]&&fc[f.id_control]!==fecha?'#92400e':'#9ca3af'}}/>
                    </td>
                  </tr>
                );
              })}
              {/* Total paquetes */}
              <tr style={{background:'#f0fdf4',borderTop:'2px solid #86efac'}}>
                <td style={{padding:'8px 12px',fontSize:'12px',fontWeight:700,color:'#166534'}}>Total paquetes</td>
                {(prods as any[]).map((p:any)=>(
                  <td key={p.key} style={{textAlign:'center',padding:'8px 4px',fontSize:'15px',fontWeight:800,color:tots[p.key as PK]>0?'#166534':'#d1d5db'}}>
                    {tots[p.key as PK]>0?tots[p.key as PK].toLocaleString('es-AR'):'—'}
                  </td>
                ))}
                <td/>
              </tr>
              {/* Restantes */}
              {(prods as any[]).some((p:any)=>Number(disp[p.key as PK])>0)&&(
                <tr style={{background:'#fafafa',borderTop:'1px dashed #e5e7eb'}}>
                  <td style={{padding:'7px 12px',fontSize:'12px',color:'#6b7280'}}>Restantes</td>
                  {(prods as any[]).map((p:any)=>{const d=Number(disp[p.key as PK])||0;const r=d-tots[p.key as PK];
                    if(!d)return <td key={p.key} style={{textAlign:'center',color:'#d1d5db',fontSize:'13px'}}>—</td>;
                    return <td key={p.key} style={{textAlign:'center',padding:'7px 4px',fontSize:'15px',fontWeight:700,color:r<0?'#dc2626':r===0?'#6b7280':'#059669'}}>{r.toLocaleString('es-AR')}</td>;})}
                  <td/>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Sección KG ── */}
        {filasKg.length>0&&(
          <div style={{marginTop:'16px',border:'1px solid #fde68a',borderRadius:'8px',overflow:'hidden'}}>
            <div style={{background:'#fffbeb',padding:'8px 14px',borderBottom:'1px solid #fde68a',display:'flex',alignItems:'center',gap:'8px'}}>
              <span style={{fontSize:'13px',fontWeight:700,color:'#92400e'}}>📫 Venta por KG</span>
              <span style={{fontSize:'11px',color:'#b45309'}}>Cajones · no descuenta paquetes</span>
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fef3c7',borderBottom:'1px solid #fde68a'}}>
                  <th style={{textAlign:'left',padding:'8px 12px',minWidth:'150px'}}>Cliente</th>
                  <th style={{textAlign:'center',padding:'8px 10px',color:'#166534',fontWeight:700,minWidth:'110px'}}>Rúcula KG</th>
                  <th style={{textAlign:'center',padding:'8px 10px',color:'#4d7c0f',fontWeight:700,minWidth:'110px'}}>Lechuga KG</th>
                  <th style={{textAlign:'right',padding:'8px 10px',color:'#92400e',fontWeight:700,minWidth:'90px'}}>Total KG</th>
                  <th style={{textAlign:'center',padding:'8px 6px',color:'#9ca3af',minWidth:'92px',fontSize:'10px'}}>Fecha fact.</th>
                </tr>
              </thead>
              <tbody>
                {filasKg.map((f,i)=>{
                  const rkg=Number(qKg(f.id_control,f.sucursal,'rucula_kg'))||0;
                  const lkg=Number(qKg(f.id_control,f.sucursal,'lechuga_kg'))||0;
                  const act=rkg>0||lkg>0;
                  return(
                    <tr key={`${f.id_control}__${f.sucursal}`} style={{background:act?'#fffbeb':(i%2===0?'white':'#fafafa'),borderBottom:'1px solid #fef3c7'}}>
                      <td style={{padding:'6px 12px'}}>
                        <span style={{fontWeight:act?600:400}}>{f.nombre_display}</span>
                        <span style={{marginLeft:'4px',fontSize:'10px',background:f.tipo==='A'?'#dbeafe':'#fef9c3',color:f.tipo==='A'?'#1e40af':'#92400e',padding:'1px 4px',borderRadius:'3px',fontWeight:600}}>F{f.tipo}</span>
                      </td>
                      {(['rucula_kg','lechuga_kg'] as const).map(k=>{
                        const val=qKg(f.id_control,f.sucursal,k);
                        const estKg=estsKg[`${f.id_control}__${f.sucursal}`]?.[k]||'idle';
                        const bdrCol=estKg==='saved'?'#22c55e':estKg==='error'?'#ef4444':Number(val)>0?'#fbbf24':'#e5e7eb';
                        return(
                          <td key={k} style={{padding:'3px 8px',textAlign:'center'}}>
                            <div style={{position:'relative',display:'inline-block'}}>
                              <input type="number" min={0} step={0.1} value={val} placeholder="0"
                                ref={el=>{if(!kgInputRefs.current[`${f.id_control}__${f.sucursal}`])kgInputRefs.current[`${f.id_control}__${f.sucursal}`]={rucula_kg:null,lechuga_kg:null};kgInputRefs.current[`${f.id_control}__${f.sucursal}`][k]=el;}}
                                onChange={ev=>onChangeKg(f,k,ev.target.value)} onBlur={()=>saveKg(f)}
                                style={{width:'90px',textAlign:'center',fontSize:'15px',fontWeight:700,
                                  border:`2px solid ${bdrCol}`,
                                  borderRadius:'6px',padding:'5px 4px',
                                  background:Number(val)>0?'#fffbeb':'white',
                                  color:Number(val)>0?'#92400e':'#9ca3af',outline:'none'}}/>
                              {estKg==='saving'&&<span style={{position:'absolute',right:'4px',top:'50%',transform:'translateY(-50%)',fontSize:'9px',color:'#9ca3af'}}>⏳</span>}
                              {estKg==='saved'&&<span style={{position:'absolute',right:'4px',top:'50%',transform:'translateY(-50%)',fontSize:'9px',color:'#22c55e'}}>✓</span>}
                              {estKg==='error'&&<span style={{position:'absolute',right:'4px',top:'50%',transform:'translateY(-50%)',fontSize:'9px',color:'#ef4444'}}>✗</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{padding:'4px 10px',textAlign:'right'}}>
                        <p style={{margin:0,fontSize:'15px',fontWeight:800,color:act?'#92400e':'#d1d5db'}}>
                          {act?(rkg+lkg).toFixed(1)+' kg':'—'}
                        </p>
                      </td>
                      <td style={{padding:'3px 5px'}}>
                        <input type="date" value={fc[f.id_control]||fecha} onChange={ev=>setFc(p=>({...p,[f.id_control]:ev.target.value}))}
                          style={{width:'100%',fontSize:'10px',border:`1px solid ${fc[f.id_control]&&fc[f.id_control]!==fecha?'#fbbf24':'#e5e7eb'}`,borderRadius:'5px',padding:'4px 3px',background:fc[f.id_control]&&fc[f.id_control]!==fecha?'#fffbeb':'white',color:fc[f.id_control]&&fc[f.id_control]!==fecha?'#92400e':'#9ca3af'}}/>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{background:'#fef3c7',borderTop:'2px solid #fbbf24'}}>
                  <td style={{padding:'8px 12px',fontSize:'12px',fontWeight:700,color:'#92400e'}}>Total KG</td>
                  <td style={{textAlign:'center',padding:'8px',fontSize:'15px',fontWeight:800,color:totsKg.rucula_kg>0?'#166534':'#d1d5db'}}>{totsKg.rucula_kg>0?totsKg.rucula_kg.toFixed(1)+' kg':'—'}</td>
                  <td style={{textAlign:'center',padding:'8px',fontSize:'15px',fontWeight:800,color:totsKg.lechuga_kg>0?'#4d7c0f':'#d1d5db'}}>{totsKg.lechuga_kg>0?totsKg.lechuga_kg.toFixed(1)+' kg':'—'}</td>
                  <td style={{textAlign:'right',padding:'8px 10px',fontSize:'16px',fontWeight:800,color:'#92400e'}}>{(totsKg.rucula_kg+totsKg.lechuga_kg).toFixed(1)} kg</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Resumen del día (en paquetes / unidades) ── */}
        {hayV&&(()=>{
          const fR = stockCamara?.factorGrPaq?.rucula  || 210;
          const fL = stockCamara?.factorGrPaq?.lechuga || 330;
          const lecPaq = tots.lechuga_crespa+tots.hoja_roble;
          const rKgPaq = Math.round(totsKg.rucula_kg*1000/fR);  // KG cajón → paq equivalentes
          const lKgPaq = Math.round(totsKg.lechuga_kg*1000/fL);
          const rTotPaq = tots.rucula + rKgPaq;
          const lTotPaq = lecPaq + lKgPaq;
          return(
          <div style={{marginTop:'12px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'10px 14px'}}>
            <p style={{margin:'0 0 8px',fontSize:'12px',fontWeight:700,color:'#374151'}}>📊 Resumen del día</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:'8px',alignItems:'start'}}>
              {/* Rúcula */}
              <div style={{background:'white',border:'1px solid #e5e7eb',borderTop:'2px solid #166534',borderRadius:'7px',padding:'8px 10px'}}>
                <p style={{margin:'0 0 4px',fontSize:'10px',fontWeight:700,color:'#166534',textTransform:'uppercase'}}>Rúcula</p>
                {tots.rucula>0&&<p style={{margin:'0 0 1px',fontSize:'13px',color:'#374151'}}><strong>{tots.rucula}</strong> paq</p>}
                {totsKg.rucula_kg>0&&<p style={{margin:'0 0 1px',fontSize:'12px',color:'#92400e'}}>{totsKg.rucula_kg.toFixed(1)} kg cajón <span style={{color:'#9ca3af'}}>→ {rKgPaq} paq</span></p>}
                <p style={{margin:'4px 0 0',fontSize:'15px',fontWeight:800,color:'#166534',borderTop:'1px solid #e5e7eb',paddingTop:'4px'}}>{rTotPaq} paq total</p>
              </div>
              {/* Lechuga */}
              <div style={{background:'white',border:'1px solid #e5e7eb',borderTop:'2px solid #4d7c0f',borderRadius:'7px',padding:'8px 10px'}}>
                <p style={{margin:'0 0 4px',fontSize:'10px',fontWeight:700,color:'#4d7c0f',textTransform:'uppercase'}}>Lechuga</p>
                {lecPaq>0&&<p style={{margin:'0 0 1px',fontSize:'13px',color:'#374151'}}><strong>{lecPaq}</strong> paq</p>}
                {tots.lechuga_crespa>0&&tots.hoja_roble>0&&<p style={{margin:'0 0 1px',fontSize:'10px',color:'#9ca3af'}}>{tots.lechuga_crespa} crespa · {tots.hoja_roble} roble</p>}
                {totsKg.lechuga_kg>0&&<p style={{margin:'0 0 1px',fontSize:'12px',color:'#92400e'}}>{totsKg.lechuga_kg.toFixed(1)} kg cajón <span style={{color:'#9ca3af'}}>→ {lKgPaq} paq</span></p>}
                <p style={{margin:'4px 0 0',fontSize:'15px',fontWeight:800,color:'#4d7c0f',borderTop:'1px solid #e5e7eb',paddingTop:'4px'}}>{lTotPaq} paq total</p>
              </div>
              {/* Total consolidado */}
              <div style={{background:'#111827',borderRadius:'7px',padding:'8px 12px',textAlign:'center',minWidth:'80px'}}>
                <p style={{margin:'0 0 2px',fontSize:'9px',color:'#9ca3af',textTransform:'uppercase'}}>Total día</p>
                <p style={{margin:0,fontSize:'20px',fontWeight:800,color:'white',lineHeight:1}}>{rTotPaq+lTotPaq}</p>
                <p style={{margin:'2px 0 0',fontSize:'10px',color:'#6b7280'}}>paq</p>
              </div>
            </div>
          </div>
          );
        })()}



      {/* Historial de exportaciones */}
      <div style={{marginTop:'14px',borderTop:'1px solid #f3f4f6',paddingTop:'10px'}}>
        <button onClick={()=>{ if(!showHistorial){cargarHistorial();} setShowHistorial(!showHistorial); }}
          style={{background:'none',border:'1px solid #e5e7eb',borderRadius:'6px',padding:'4px 12px',fontSize:'11px',cursor:'pointer',color:'#6b7280'}}>
          {showHistorial?'▲ Ocultar pendientes':'▼ Ver sesiones sin exportar'}
        </button>
        {showHistorial && (
          <div style={{marginBottom:'8px',textAlign:'right'}}>
            <button onClick={()=>limpiarDia(true)} disabled={limpiando} style={{background:'none',border:'1px solid #fca5a5',borderRadius:'6px',padding:'3px 10px',fontSize:'11px',cursor:'pointer',color:'#dc2626'}}>
              🗑 Limpiar toda la hoja
            </button>
          </div>
        )}
        {showHistorial && (
          <div style={{marginTop:'10px'}}>
            {loadHist ? <p style={{color:'#9ca3af',fontSize:'12px'}}>Cargando…</p> : historial.pendientes.length===0 ? <p style={{color:'#9ca3af',fontSize:'12px'}}>Sin sesiones pendientes.</p> : (
              <table style={{fontSize:'12px',width:'100%'}}>
                <thead><tr style={{background:'#fefce8',borderBottom:'1px solid #fde68a'}}>
                  <th style={{textAlign:'left',padding:'5px 8px'}}>Fecha</th>
                  <th style={{textAlign:'right',padding:'5px 6px'}}>Rúcula</th>
                  <th style={{textAlign:'right',padding:'5px 6px'}}>Lechuga</th>
                  <th style={{textAlign:'right',padding:'5px 6px'}}>R. kg</th>
                  <th style={{textAlign:'right',padding:'5px 6px'}}>L. kg</th>
                  <th style={{padding:'5px 6px'}}></th>
                </tr></thead>
                <tbody>
                  {historial.pendientes.map((h:any)=>(
                    <tr key={h.fecha} style={{borderBottom:'1px solid #f3f4f6',background:h.fecha===fecha?'#fef9c3':'white'}}>
                      <td style={{padding:'5px 8px',fontWeight:600,whiteSpace:'nowrap'}}>{h.fecha}</td>
                      <td style={{textAlign:'right',padding:'5px 6px',color:'#166534'}}>{h.rucula>0?h.rucula:'—'}</td>
                      <td style={{textAlign:'right',padding:'5px 6px',color:'#4d7c0f'}}>{h.lechuga>0?h.lechuga:'—'}</td>
                      <td style={{textAlign:'right',padding:'5px 6px',color:'#92400e'}}>{h.rucula_kg>0?h.rucula_kg.toFixed(1)+' kg':'—'}</td>
                      <td style={{textAlign:'right',padding:'5px 6px',color:'#b45309'}}>{h.lechuga_kg>0?h.lechuga_kg.toFixed(1)+' kg':'—'}</td>
                      <td style={{padding:'5px 6px'}}>
                        <button onClick={()=>{setFecha(h.fecha);setShowHistorial(false);}}
                          style={{background:'none',border:'1px solid #e5e7eb',borderRadius:'5px',padding:'2px 8px',fontSize:'11px',cursor:'pointer',color:'#374151'}}>
                          Ir →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Precios */}
      <div style={{marginTop:'14px',borderTop:'1px solid #f3f4f6',paddingTop:'10px'}}>
        <button onClick={()=>setShowP(!showP)} style={{background:'none',border:'1px solid #e5e7eb',borderRadius:'6px',padding:'4px 12px',fontSize:'11px',cursor:'pointer',color:'#6b7280'}}>
          {showP?'▲ Ocultar precios':'▼ Ver precios vigentes'}
        </button>
        {showP&&(
          <div style={{marginTop:'10px',overflowX:'auto'}}>
            <p style={{fontSize:'11px',color:'#9ca3af',marginBottom:'6px'}}>Para modificar, editá la hoja <strong>Precios</strong> en Google Sheets.</p>
            <table style={{fontSize:'11px'}}>
              <thead><tr style={{background:'#f8fafc'}}>
                <th style={{textAlign:'left',padding:'5px 10px'}}>Cliente</th>
                {ALL.map(p=><th key={p.key} style={{textAlign:'right',padding:'5px 10px',color:p.color}}>{p.label}</th>)}
              </tr></thead>
              <tbody>{precios.map((p,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #f3f4f6'}}>
                  <td style={{padding:'4px 10px'}}>{p.sucursal_obs}</td>
                  {ALL.map(prod=><td key={prod.key} style={{textAlign:'right',padding:'4px 10px',color:Number((p as any)[prod.key])>0?'#374151':'#d1d5db'}}>{Number((p as any)[prod.key])>0?`$${Number((p as any)[prod.key]).toLocaleString('es-AR')}`:'—'}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
