'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { ClienteVenta, PrecioVenta, VentaDia, PedidoFijo } from '@/lib/types';
import { ventasCargadasSemana } from '@/lib/estadisticasVentas';

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

interface LineaCarga { id_control:string; nombre_cliente:string; rucula:number; lechuga_crespa:number; hoja_roble:number; bandeja_rucula:number; albahaca:number; rucula_kg:number; lechuga_kg_crespa:number; lechuga_kg_roble:number }
// Resumen de texto (cantidades por cliente y por producto) para el mensaje de "Cargar ventas".
function resumenCarga(lineas: LineaCarga[]): string {
  const claveProd = [...ALL.map(p=>({key:p.key as keyof LineaCarga & string, label:p.label, u:'u'})), {key:'rucula_kg' as const,label:'Rúcula',u:'kg'}, {key:'lechuga_kg_crespa' as const,label:'Lechuga Crespa',u:'kg'}, {key:'lechuga_kg_roble' as const,label:'Lechuga Roble',u:'kg'}];
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
// lechuga_kg (legacy, sin distinguir variedad) sigue en el shape porque calcStats la
// sigue sumando para no perder historial, aunque esta pantalla ya no la usa.
type SKG = { rucula_kg:number; lechuga_kg:number; lechuga_kg_crespa:number; lechuga_kg_roble:number };
type Stats = { semanaActual:SV; semanaAnterior:SV; mesActual:SV; mesAnterior:SV; kg:{semanaActual:SKG;semanaAnterior:SKG;mesActual:SKG;mesAnterior:SKG} };
interface Fila { id_control:string; nombre_cliente:string; sucursal:string; nombre_display:string; tipo:string; unidad:'paq'|'kg'|'' }
type Ctds = Record<string, Record<PK,string>>;
// Claves KG editables desde esta pantalla — lechuga_kg (legacy, precio único sin variedad)
// ya no se carga acá, solo se preserva lo ya guardado (ver /api/ventas/guardar).
type KGK = 'rucula_kg'|'lechuga_kg_crespa'|'lechuga_kg_roble';
type CKG = Record<string, Record<KGK,string>>;
type Ests = Record<string, Record<PK,'idle'|'saving'|'saved'|'error'>>;
const EQ: Record<PK,string> = { rucula:'',lechuga_crespa:'',hoja_roble:'',bandeja_rucula:'',albahaca:'' };
const EQ_KG: Record<KGK,string> = { rucula_kg:'', lechuga_kg_crespa:'', lechuga_kg_roble:'' };

function mkFilas(cs: ClienteVenta[], freq: Record<string,number>): Fila[] {
  const out: Fila[] = [];
  const ordenMap: Record<string,number> = {};
  for (const c of cs) {
    if (c.activo!=='SI') continue;
    ordenMap[c.id_control] = Number(c.orden) || 0;
    const unidad = c.unidad || 'paq';
    const sucs = c.sucursales ? c.sucursales.split('|').map(s=>s.trim()).filter(Boolean) : [];
    if (!sucs.length) { out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:c.nombre_xubio,nombre_display:c.nombre_display||c.nombre_xubio,tipo:c.tipo_factura,unidad}); }
    else { for (const s of sucs) out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:s,nombre_display:`${c.nombre_display||c.nombre_xubio} · ${s.split(' ').slice(-1)[0]}`,tipo:c.tipo_factura,unidad}); }
  }
  // Orden manual (Admin → Clientes de venta) tiene prioridad si está fijado — más bajo
  // primero. Sin orden fijado (0), cae al criterio de siempre: frecuencia de compra
  // descendente. Un cliente con orden fijado siempre va antes que uno sin fijar.
  return out.sort((a,b)=>{
    const oa=ordenMap[a.id_control]||0, ob=ordenMap[b.id_control]||0;
    if (oa>0 && ob>0) return oa-ob;
    if (oa>0) return -1;
    if (ob>0) return 1;
    return (freq[b.id_control]||0)-(freq[a.id_control]||0);
  });
}

export default function VentasManager({clientes,precios,frecuencias,stats,pedidosFijos,initialFecha}:{clientes:ClienteVenta[];precios:PrecioVenta[];frecuencias:Record<string,number>;stats:Stats;pedidosFijos:PedidoFijo[];initialFecha?:string}) {
  const hoy = new Date().toISOString().split('T')[0];
  const [fecha,setFecha]=useState(initialFecha || hoy);
  const [fc,setFc]=useState<Record<string,string>>({});
  const [ctds,setCtds]=useState<Ctds>({});
  const [ests,setEsts]=useState<Ests>({});
  const [disp,setDisp]=useState<Record<PK,string>>({rucula:'',lechuga_crespa:'',hoja_roble:'',bandeja_rucula:'',albahaca:''});
  const [extras,setExtras]=useState(false);
  const [loading,setLoading]=useState(false);
  const [exp,setExp]=useState(false);
  const [msg,setMsg]=useState<{t:'ok'|'err';s:string}|null>(null);
  const [showP,setShowP]=useState(false);
  const [showPreExport,setShowPreExport]=useState(false);
  const [correlaA,setCorrelaA]=useState<string>('');
  const [correlaB,setCorrelaB]=useState<string>('');
  const [enviarEmail,setEnviarEmail]=useState(true);
  const [limpiando,setLimpiando]=useState(false);
  const [stockCamara,setStockCamara]=useState<{rucula:{stockActual:number;diasPromedio:number};lechuga_crespa:{stockActual:number;diasPromedio:number};lechuga_roble:{stockActual:number;diasPromedio:number};factorGrPaq:{rucula:number;lechuga_crespa:number;lechuga_roble:number}}|null>(null);
  const [ctdsKg,setCtdsKg]=useState<CKG>({});
  const [ventas7,setVentas7]=useState<VentaDia[]>([]);
  const [facturadasHoy,setFacturadasHoy]=useState<VentaDia[]>([]);
  const [ventasSemana,setVentasSemana]=useState<VentaDia[]>([]);
  // Ventas ya cargadas (facturadas o no) para hoy/mañana/pasado — a diferencia del resto
  // de esta pantalla (que carga día por día), esto mira 3 días para adelante porque las
  // ventas se cargan con un día de anticipación, para la fecha de entrega correcta.
  const [ventasComprometidas,setVentasComprometidas]=useState<VentaDia[]>([]);
  const [verDetalleComprometido,setVerDetalleComprometido]=useState(false);
  // Cosecha prevista — a pedido explícito, NO se calcula sola: campo libre para cargar a
  // mano si se la quiere contemplar en "disponible para venta" ese día en particular.
  const [cosechaManual,setCosechaManual]=useState<Record<'rucula'|'lechuga_crespa'|'lechuga_roble',string>>({rucula:'',lechuga_crespa:'',lechuga_roble:''});
  // Celdas pre-cargadas desde un Pedido fijo (todavía no tocadas por el usuario) — se
  // marcan distinto para dejar en claro que es una sugerencia, no algo ya guardado.
  const [prefijo,setPrefijo]=useState<Set<string>>(new Set());
  const ctdsKgLive=useRef<CKG>({});
  // Referencias directas a los inputs KG del DOM — fuente de verdad para saveKg
  const kgInputRefs=useRef<Record<string,Record<KGK,HTMLInputElement|null>>>({});
  type EstKG = Record<string,Record<KGK,'idle'|'saving'|'saved'|'error'>>;
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
    fetch('/api/stocks/camara').then(r=>r.json()).then(j=>{ if(j.rucula&&j.lechuga_crespa&&j.lechuga_roble) setStockCamara(j); }).catch(()=>{});
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

  useEffect(()=>{
    setLoading(true);setMsg(null);
    fetch(`/api/ventas/fecha?fecha=${fecha}`).then(r=>r.json()).then((data:VentaDia[])=>{
      const c:Ctds={}; const ckg:CKG={};
      for(const v of data){
        const key=`${v.id_control}__${v.sucursal}`;
        c[key]={rucula:String(v.rucula||''),lechuga_crespa:String(v.lechuga_crespa||''),hoja_roble:String(v.hoja_roble||''),bandeja_rucula:String(v.bandeja_rucula||''),albahaca:String(v.albahaca||'')};
        ckg[key]={rucula_kg:String(v.rucula_kg||''),lechuga_kg_crespa:String(v.lechuga_kg_crespa||''),lechuga_kg_roble:String(v.lechuga_kg_roble||'')};
      }
      // Pedidos fijos de ese día de la semana: pre-cargan solo lo que todavía no tiene
      // nada guardado — nunca pisan una carga ya existente. Quedan editables y marcados
      // aparte (ver `prefijo`) hasta que se guarden como cualquier otra celda.
      const diaSemana = new Date(fecha+'T12:00:00').getDay();
      const nuevoPrefijo = new Set<string>();
      for (const pf of pedidosFijos) {
        if (Number(pf.dia_semana) !== diaSemana) continue;
        const key = `${pf.id_control}__${pf.sucursal}`;
        if (c[key]) continue;
        const vals = {...EQ};
        let tieneAlgo = false;
        for (const k of ['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca'] as PK[]) {
          const n = Number((pf as any)[k]) || 0;
          if (n > 0) { vals[k] = String(n); tieneAlgo = true; nuevoPrefijo.add(`${key}__${k}`); }
        }
        if (tieneAlgo) c[key] = vals;
      }
      ctdsKgLive.current = ckg;
      setCtds(c); setCtdsKg(ckg); setEsts({}); setEstsKg({}); setPrefijo(nuevoPrefijo);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[fecha,pedidosFijos]);

  // Ventas del mismo día de la semana pasada (para la comparación por cliente) — se
  // recalcula según la fecha seleccionada, no según "hoy" (si no, la comparación quedaba
  // pegada a la semana pasada de hoy aunque estés viendo otro día).
  useEffect(()=>{
    const d=new Date(fecha+'T12:00:00'); d.setDate(d.getDate()-7);
    const fecha7=d.toISOString().split('T')[0];
    fetch(`/api/ventas/fecha?fecha=${fecha7}`).then(r=>r.json()).then(setVentas7).catch(()=>setVentas7([]));
  },[fecha]);

  // Ventas ya facturadas (exportadas) de la fecha seleccionada — para avisar de posibles
  // duplicados, ya que el fetch de arriba solo trae lo NO facturado todavía.
  useEffect(()=>{
    fetch(`/api/ventas/fecha?fecha=${fecha}&facturadas=1`).then(r=>r.json()).then(setFacturadasHoy).catch(()=>setFacturadasHoy([]));
  },[fecha]);

  // Ventas cargadas de la semana en curso (lunes → hoy, según la fecha real de hoy — no
  // la fecha seleccionada en el selector), para el recuadro "Ventas de esta semana".
  function cargarVentasSemana(){
    const hoy=new Date();
    const dow=hoy.getDay();
    const lunes=new Date(hoy); lunes.setDate(hoy.getDate()-(dow===0?6:dow-1));
    const f=(d:Date)=>d.toISOString().split('T')[0];
    fetch(`/api/ventas/fecha?desde=${f(lunes)}&hasta=${f(hoy)}`).then(r=>r.json()).then(setVentasSemana).catch(()=>setVentasSemana([]));
  }
  useEffect(()=>{ cargarVentasSemana(); },[]);

  // Ventas comprometidas hoy/mañana/pasado (real, no proyectado por pedido fijo) — se
  // cargan con hasta 1 día de anticipación, así que mirando 3 días adelante ya se ve lo
  // que efectivamente está anotado, no solo una estimación. Se toma la fecha REAL de hoy
  // (no la `fecha` seleccionada arriba, que es para cargar un día puntual).
  useEffect(()=>{
    const hoyReal=new Date();
    const f=(d:Date)=>d.toISOString().split('T')[0];
    const hasta=new Date(hoyReal); hasta.setDate(hasta.getDate()+2);
    fetch(`/api/ventas/fecha?desde=${f(hoyReal)}&hasta=${f(hasta)}`).then(r=>r.json())
      .then((data:VentaDia[])=>setVentasComprometidas(data.filter(v=>!v.exportado||v.exportado==='')))
      .catch(()=>setVentasComprometidas([]));
  },[]);

  function onChange(f:Fila,k:PK,v:string){
    setCtds(p=>({...p,[`${f.id_control}__${f.sucursal}`]:{...(p[`${f.id_control}__${f.sucursal}`]||EQ),[k]:v}}));
    se(f.id_control,f.sucursal,k,'idle');
    const pk=`${f.id_control}__${f.sucursal}__${k}`;
    if(prefijo.has(pk)) setPrefijo(prev=>{const n=new Set(prev);n.delete(pk);return n;});
  }
  function onBlur(f:Fila,k:PK){const tk=`${f.id_control}__${f.sucursal}__${k}`;clearTimeout(tmrs.current[tk]);tmrs.current[tk]=setTimeout(()=>save(f,k),400);}
  async function save(f:Fila,k:PK){
    if(q(f.id_control,f.sucursal,k)==='')return;
    se(f.id_control,f.sucursal,k,'saving');
    try{
      const r=await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:null,lineas:[{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0}]})});
      if(!r.ok)throw new Error();
      se(f.id_control,f.sucursal,k,'saved');setTimeout(()=>se(f.id_control,f.sucursal,k,'idle'),2000);
      cargarVentasSemana();
    }catch{se(f.id_control,f.sucursal,k,'error');}
  }
  const KGK_ALL: KGK[] = ['rucula_kg','lechuga_kg_crespa','lechuga_kg_roble'];
  function qKg(id:string,suc:string,k:KGK){return ctdsKg[`${id}__${suc}`]?.[k]||'';}
  function seKg(id:string,suc:string,k:KGK,v:'idle'|'saving'|'saved'|'error'){
    setEstsKg(p=>({...p,[`${id}__${suc}`]:{...(p[`${id}__${suc}`]||{rucula_kg:'idle',lechuga_kg_crespa:'idle',lechuga_kg_roble:'idle'}),[k]:v}}));
  }
  function onChangeKg(f:Fila,k:KGK,v:string){
    setCtdsKg(p=>{const next={...p,[`${f.id_control}__${f.sucursal}`]:{...(p[`${f.id_control}__${f.sucursal}`]||EQ_KG),[k]:v}};ctdsKgLive.current=next;return next;});
    seKg(f.id_control,f.sucursal,k,'idle');
  }
  async function saveKg(f:Fila){
    const domRefs=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];
    // Leer del DOM directamente — es la fuente más confiable (sin closures ni batching de React)
    const rkg=Number(domRefs?.rucula_kg?.value)||0;
    const lkgC=Number(domRefs?.lechuga_kg_crespa?.value)||0;
    const lkgR=Number(domRefs?.lechuga_kg_roble?.value)||0;
    KGK_ALL.forEach(k=>seKg(f.id_control,f.sucursal,k,'saving'));
    try{
      const r=await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:null,lineas:[{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:rkg,lechuga_kg_crespa:lkgC,lechuga_kg_roble:lkgR}]})});
      if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error((j as any).error||'Error');};
      KGK_ALL.forEach(k=>{seKg(f.id_control,f.sucursal,k,'saved');setTimeout(()=>seKg(f.id_control,f.sucursal,k,'idle'),2000);});
      cargarVentasSemana();
    }catch(err:any){
      KGK_ALL.forEach(k=>seKg(f.id_control,f.sucursal,k,'error'));
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
        ...filasNormales.map(f=>({id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0,rucula_kg:0,lechuga_kg_crespa:0,lechuga_kg_roble:0})),
        ...filasKg.map(f=>{const dr=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];return{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:Number(dr?.rucula_kg?.value)||0,lechuga_kg_crespa:Number(dr?.lechuga_kg_crespa?.value)||0,lechuga_kg_roble:Number(dr?.lechuga_kg_roble?.value)||0};}),
      ].filter(l=>l.rucula>0||l.lechuga_crespa>0||l.hoja_roble>0||l.bandeja_rucula>0||l.albahaca>0||l.rucula_kg>0||l.lechuga_kg_crespa>0||l.lechuga_kg_roble>0);
      const flushR = await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:null,lineas:todasLineas})});
      if(!flushR.ok){const j=await flushR.json().catch(()=>({}));throw new Error((j as any).error||'Error al guardar ventas');}
      const r=await fetch('/api/ventas/cargar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      const nEmit=(j.emitidas||[]).length, nErr=(j.errores||[]).length;
      // Antes solo se mostraba la cantidad de errores ("revisá en Facturación") sin el
      // detalle — y esa página no guarda el error en ningún lado, solo lo muestra al
      // momento de reintentar ahí. Mostrar el mensaje real acá evita ese callejón sin salida.
      const detalleErrores = (j.errores||[]).map((e:any)=>`• ${e.cliente}: ${e.error}`).join('\n');
      const txt = nEmit>0
        ? `✓ Facturas cargadas OK\n${resumenCarga(todasLineas)}${nErr>0?`\n\n⚠ ${nErr} con error:\n${detalleErrores}`:''}`
        : nErr>0 ? `No se pudo emitir ninguna (${nErr} con error):\n${detalleErrores}` : `${j.clientes} cliente(s) cargados.`;
      setMsg({t: nErr>0 && nEmit===0 ? 'err' : 'ok', s: txt});
      setCtds({});setEsts({});setCtdsKg({});ctdsKgLive.current={};setFc({});
      cargarVentasSemana();
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
        ...filasNormales.map(f=>({id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0,rucula_kg:0,lechuga_kg_crespa:0,lechuga_kg_roble:0})),
        ...filasKg.map(f=>{const dr=kgInputRefs.current[`${f.id_control}__${f.sucursal}`];return{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0,rucula_kg:Number(dr?.rucula_kg?.value)||0,lechuga_kg_crespa:Number(dr?.lechuga_kg_crespa?.value)||0,lechuga_kg_roble:Number(dr?.lechuga_kg_roble?.value)||0};}),
      // Solo enviar líneas con al menos una cantidad > 0
      ].filter(l=>l.rucula>0||l.lechuga_crespa>0||l.hoja_roble>0||l.bandeja_rucula>0||l.albahaca>0||l.rucula_kg>0||l.lechuga_kg_crespa>0||l.lechuga_kg_roble>0);
      const flushR = await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,id_exportacion:null,lineas:todasLineas})});
      if(!flushR.ok){const j=await flushR.json().catch(()=>({}));throw new Error((j as any).error||'Error al guardar ventas');}
      const r=await fetch('/api/ventas/exportar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,fechasCliente:fc,correlaA:Number(correlaA),correlaB:Number(correlaB),enviarEmail})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      const bytes=Uint8Array.from(atob(j.file),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes]));
      const a=document.createElement('a');a.href=url;a.download=j.filename;a.click();URL.revokeObjectURL(url);
      const emailTxt = j.emailOk ? ' · Email ✓' : enviarEmail ? ` · Email falló: ${j.emailError||'error'}` : '';
      setMsg({t:'ok',s:`${j.facturas} facturas · A→${j.lastA} · B→${j.lastB}${emailTxt}`});
      setCorrelaA(String(j.lastA+1)); setCorrelaB(String(j.lastB+1));
      // Limpiar estado local (la hoja conserva los valores como registro histórico)
      setCtds({});setEsts({});setCtdsKg({});ctdsKgLive.current={};setFc({});
      cargarVentasSemana();
    }catch(err:any){setMsg({t:'err',s:err.message});}
    setExp(false);
  }

  const filasNormales = filas.filter(f=>f.unidad!=='kg');
  const filasKg = filas.filter(f=>f.unidad==='kg');
  const tots:Record<PK,number>={rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0};
  for(const f of filasNormales)for(const p of ALL)tots[p.key]+=Number(q(f.id_control,f.sucursal,p.key))||0;
  const totsKg={rucula_kg:0,lechuga_kg_crespa:0,lechuga_kg_roble:0};
  for(const f of filasKg)for(const k of KGK_ALL) totsKg[k]+=Number(qKg(f.id_control,f.sucursal,k))||0;
  const hayV=Object.values(tots).some(v=>v>0)||Object.values(totsKg).some(v=>v>0);
  const diasSemana = ventasCargadasSemana(ventasSemana, clientes);

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

  // Lo ya facturado (exportado) hoy para un cliente — el fetch normal de la fecha solo
  // trae lo NO facturado, así que esto es lo único que muestra que ya se cargó algo.
  const PK_ALL: PK[] = ['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca'];
  function facturadoDe(id_control:string, sucursal:string): { sum: Record<PK,number>; total: number } | null {
    const rows = facturadasHoy.filter(v=>String(v.id_control)===String(id_control)&&v.sucursal===sucursal);
    if(!rows.length) return null;
    const sum = {rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0} as Record<PK,number>;
    for(const r of rows) for(const k of PK_ALL) sum[k]+=Number((r as any)[k])||0;
    const total = PK_ALL.reduce((a,k)=>a+sum[k],0);
    return total>0 ? { sum, total } : null;
  }
  // ¿Lo que hay tipeado ahora coincide exactamente con lo que ya se facturó hoy para este cliente?
  function esPosibleDuplicado(id_control:string, sucursal:string): boolean {
    const fact = facturadoDe(id_control,sucursal);
    if(!fact) return false;
    const hoyT = totalHoy(id_control,sucursal);
    if(hoyT<=0) return false;
    return PK_ALL.every(k=>(Number(q(id_control,sucursal,k))||0)===fact.sum[k]);
  }

  // Venta comprometida REAL hoy/mañana/pasado (no una proyección por pedido fijo) —
  // suma lo que ya está cargado en Ventas para esos 3 días, esté facturado o no, por
  // cultivo. hoja_roble (campo de Ventas) mapea a la clave 'lechuga_roble' del stock
  // en cámara. `ventasComprometidas` es un snapshot que se trae del server una sola vez
  // al entrar a la pantalla — para el día que se está cargando AHORA (el de `fecha`, si
  // cae dentro de la ventana de 3 días) se descarta ese snapshot y se suma en vivo desde
  // `ctds` en su lugar: así "Disp. para venta" se actualiza al toque con cada celda que
  // se toca (y también contempla lo pre-cargado de un Pedido fijo, que ya vive en `ctds`
  // desde que se hidrata más arriba), en vez de quedar pegado al valor de cuando se
  // entró a la pantalla hasta recargar la página.
  const DIAS_COMPROMETIDO = 3;
  function comprometidoPorCultivo(): Record<'rucula'|'lechuga_crespa'|'lechuga_roble', number> {
    const acc = { rucula: 0, lechuga_crespa: 0, lechuga_roble: 0 };
    const hoyReal = new Date();
    const f = (d: Date) => d.toISOString().split('T')[0];
    const desdeVentana = f(hoyReal);
    const hastaD = new Date(hoyReal); hastaD.setDate(hastaD.getDate() + 2);
    const hastaVentana = f(hastaD);
    const fechaEnVentana = fecha >= desdeVentana && fecha <= hastaVentana;

    for (const v of ventasComprometidas) {
      const vFecha = String(v.fecha || '').split(/[T ]/)[0];
      if (fechaEnVentana && vFecha === fecha) continue; // ese día se reemplaza por el vivo de abajo
      acc.rucula += Number(v.rucula) || 0;
      acc.lechuga_crespa += Number(v.lechuga_crespa) || 0;
      acc.lechuga_roble += Number(v.hoja_roble) || 0;
    }
    if (fechaEnVentana) {
      for (const fl of filas) {
        const vals = ctds[`${fl.id_control}__${fl.sucursal}`]; if (!vals) continue;
        acc.rucula += Number(vals.rucula) || 0;
        acc.lechuga_crespa += Number(vals.lechuga_crespa) || 0;
        acc.lechuga_roble += Number(vals.hoja_roble) || 0;
      }
    }
    return acc;
  }
  const comprometido = comprometidoPorCultivo();

  // Detalle por cliente (y fecha) de lo comprometido — para poder chequear a quién se le
  // debe qué, no solo el número total. Mismo criterio que comprometidoPorCultivo(): el
  // día que se está cargando ahora (si cae en la ventana) sale de `ctds` en vivo, no del
  // snapshot del server, para que el detalle nunca desentone con el total de arriba.
  interface DetalleComprometidoCliente { nombre: string; fecha: string; rucula: number; lechuga_crespa: number; lechuga_roble: number; total: number }
  function detalleComprometidoPorCliente(): DetalleComprometidoCliente[] {
    const hoyReal = new Date();
    const f = (d: Date) => d.toISOString().split('T')[0];
    const desdeVentana = f(hoyReal);
    const hastaD = new Date(hoyReal); hastaD.setDate(hastaD.getDate() + 2);
    const hastaVentana = f(hastaD);
    const fechaEnVentana = fecha >= desdeVentana && fecha <= hastaVentana;

    const map = new Map<string, DetalleComprometidoCliente>();
    function acumular(id_control: string, nombre_cliente: string, sucursal: string, fechaLinea: string, rucula: number, lechuga_crespa: number, lechuga_roble: number) {
      const total = rucula + lechuga_crespa + lechuga_roble;
      if (total <= 0) return;
      const key = `${id_control}__${sucursal}__${fechaLinea}`;
      const ex = map.get(key);
      if (ex) { ex.rucula += rucula; ex.lechuga_crespa += lechuga_crespa; ex.lechuga_roble += lechuga_roble; ex.total += total; }
      else map.set(key, { nombre: sucursal && sucursal !== nombre_cliente ? `${nombre_cliente} · ${sucursal}` : nombre_cliente, fecha: fechaLinea, rucula, lechuga_crespa, lechuga_roble, total });
    }
    for (const v of ventasComprometidas) {
      const vFecha = String(v.fecha || '').split(/[T ]/)[0];
      if (fechaEnVentana && vFecha === fecha) continue;
      acumular(v.id_control, v.nombre_cliente, v.sucursal, v.fecha, Number(v.rucula) || 0, Number(v.lechuga_crespa) || 0, Number(v.hoja_roble) || 0);
    }
    if (fechaEnVentana) {
      for (const fl of filas) {
        const vals = ctds[`${fl.id_control}__${fl.sucursal}`]; if (!vals) continue;
        acumular(fl.id_control, fl.nombre_cliente, fl.sucursal, fecha, Number(vals.rucula) || 0, Number(vals.lechuga_crespa) || 0, Number(vals.hoja_roble) || 0);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.fecha === b.fecha ? b.total - a.total : a.fecha.localeCompare(b.fecha));
  }
  const detalleComprometido = detalleComprometidoPorCliente();
  const hoyDiff0 = new Date().toISOString().split('T')[0];
  function etiquetaDia(f: string): string {
    if (f === hoyDiff0) return 'Hoy';
    const d = new Date(hoyDiff0 + 'T12:00:00'); d.setDate(d.getDate() + 1);
    if (f === d.toISOString().split('T')[0]) return 'Mañana';
    return 'Pasado';
  }

  return (
    <div>
      {/* Stock disponible — cerca de donde se carga, para chequear de un vistazo antes de cargar */}
      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'8px 14px',marginBottom:'12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px',flexWrap:'wrap',gap:'6px'}}>
          <p style={{margin:0,fontSize:'12px',fontWeight:700,color:'#166534'}}>🥬 Stock actual − Ventas comprometidas (hoy/mañana/pasado), por cultivo</p>
          {detalleComprometido.length > 0 && (
            <button onClick={()=>setVerDetalleComprometido(v=>!v)} style={{background:'none',border:'none',color:'#166534',fontSize:'11px',fontWeight:600,cursor:'pointer',padding:0,textDecoration:'underline'}}>
              {verDetalleComprometido ? 'Ocultar detalle por cliente' : 'Ver detalle por cliente'}
            </button>
          )}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))',gap:'10px'}}>
          {(['rucula','lechuga_crespa','lechuga_roble'] as const).map(cultivo=>{
            const sc = stockCamara?.[cultivo]?.stockActual ?? 0;
            const comp = comprometido[cultivo] ?? 0;
            const manual = Number(cosechaManual[cultivo]) || 0;
            const disponibleParaVenta = sc - comp + manual;
            const label  = cultivo==='rucula'?'Rúcula':cultivo==='lechuga_crespa'?'Lechuga Crespa':'Lechuga Roble';
            const color  = cultivo==='rucula'?'#b45309':cultivo==='lechuga_crespa'?'#4d7c0f':'#166534';
            const bg     = cultivo==='rucula'?'#fffbeb':cultivo==='lechuga_crespa'?'#f7fee7':'#f0fdf4';
            const border = cultivo==='rucula'?'#fde68a':cultivo==='lechuga_crespa'?'#d9f99d':'#bbf7d0';
            return (
              <div key={cultivo} style={{background:bg,border:`1px solid ${border}`,borderRadius:'8px',padding:'8px 12px',display:'flex',flexDirection:'column',gap:'4px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                  <span style={{fontSize:'12px',fontWeight:700,color}}>{label}</span>
                  <span style={{fontSize:'11px',color:'#6b7280'}}>
                    Disp. para venta: <strong style={{fontSize:'15px',color: disponibleParaVenta<0?'#dc2626':'#111827'}}>{disponibleParaVenta} u</strong>
                  </span>
                </div>
                <div style={{display:'flex',gap:'12px',alignItems:'baseline',flexWrap:'wrap'}}>
                  <span style={{fontSize:'10.5px',color:'#6b7280'}}>Stock actual: <strong style={{color:'#111827'}}>{sc}</strong></span>
                  <span style={{fontSize:'10.5px',color:'#6b7280'}}>− Comprometido {DIAS_COMPROMETIDO}d: <strong style={{color:'#111827'}}>{comp}</strong></span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'2px'}}>
                  <span style={{fontSize:'10.5px',color:'#6b7280'}}>+ Cosecha prevista (manual):</span>
                  <input type="number" value={cosechaManual[cultivo]} onChange={ev=>setCosechaManual(p=>({...p,[cultivo]:ev.target.value}))}
                    placeholder="0" style={{width:'70px',fontSize:'11px',padding:'2px 5px'}} />
                </div>
              </div>
            );
          })}
        </div>
        {verDetalleComprometido && detalleComprometido.length > 0 && (
          <div style={{marginTop:'10px',paddingTop:'10px',borderTop:'1px solid #bbf7d0',overflowX:'auto'}}>
            <table style={{fontSize:'11.5px',width:'100%'}}>
              <thead><tr>
                <th style={{textAlign:'left'}}>Día</th>
                <th style={{textAlign:'left'}}>Cliente</th>
                <th style={{textAlign:'right'}}>Rúcula</th>
                <th style={{textAlign:'right'}}>Crespa</th>
                <th style={{textAlign:'right'}}>Roble</th>
                <th style={{textAlign:'right'}}>Total</th>
              </tr></thead>
              <tbody>
                {detalleComprometido.map((d,i)=>(
                  <tr key={i} style={{borderTop:'1px solid #ecfdf5'}}>
                    <td style={{color:'#6b7280'}}>{etiquetaDia(d.fecha)}</td>
                    <td style={{fontWeight:500}}>{d.nombre}</td>
                    <td style={{textAlign:'right'}}>{d.rucula || '—'}</td>
                    <td style={{textAlign:'right'}}>{d.lechuga_crespa || '—'}</td>
                    <td style={{textAlign:'right'}}>{d.lechuga_roble || '—'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Controles */}
      <div style={{display:'flex',gap:'10px',alignItems:'flex-end',flexWrap:'wrap',marginBottom:'8px'}}>
        <div>
          <label style={{fontSize:'10px',color:'#6b7280',display:'block',marginBottom:'2px'}}>FECHA FACTURACIÓN</label>
          <input type="date" value={fecha} onChange={ev=>setFecha(ev.target.value)} style={{fontSize:'14px',fontWeight:600,border:'1px solid #e5e7eb',borderRadius:'7px',padding:'6px 10px'}}/>
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
        <Link href="/ventas/historial"
          style={{background:'white',color:'#6b7280',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'8px 12px',fontWeight:600,fontSize:'12px',textDecoration:'none',display:'flex',alignItems:'center',gap:'4px',marginTop:'14px'}}>
          📊 Historial de facturación →
        </Link>
      </div>


      {/* Panel pre-exportación */}
      {showPreExport && (
        <div style={{background:'#eff6ff',border:'2px solid #3b82f6',borderRadius:'10px',padding:'16px',marginBottom:'12px'}}>
          <p style={{margin:'0 0 12px',fontSize:'13px',fontWeight:700,color:'#1d4ed8'}}>📋 Confirmar exportación — {fecha}</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'12px',marginBottom:'12px'}}>
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

      {/* Ya facturado hoy — para no volver a cargarlo por duplicado */}
      {(()=>{
        const KG_ALL = ['rucula_kg','lechuga_kg','lechuga_kg_crespa','lechuga_kg_roble'] as const;
        const porCliente = new Map<string,{nombre:string;totalPaq:number;totalKg:number}>();
        for(const v of facturadasHoy){
          const totalPaq = PK_ALL.reduce((a,k)=>a+(Number((v as any)[k])||0),0);
          const totalKg = KG_ALL.reduce((a,k)=>a+(Number((v as any)[k])||0),0);
          if(totalPaq<=0 && totalKg<=0) continue;
          const key = `${v.id_control}__${v.sucursal}`;
          const fila = filas.find(f=>f.id_control===v.id_control&&f.sucursal===v.sucursal);
          const nombre = fila?.nombre_display || v.nombre_cliente || v.id_control;
          const prev = porCliente.get(key);
          porCliente.set(key,{nombre,totalPaq:(prev?.totalPaq||0)+totalPaq,totalKg:(prev?.totalKg||0)+totalKg});
        }
        const items = Array.from(porCliente.values()).sort((a,b)=>(b.totalPaq+b.totalKg)-(a.totalPaq+a.totalKg));
        if(!items.length) return null;
        return (
          <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'8px',padding:'8px 14px',marginBottom:'12px'}}>
            <p style={{margin:'0 0 6px',fontSize:'12px',fontWeight:700,color:'#92400e'}}>⚠️ Ya facturado hoy — evitá cargarlo de nuevo</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
              {items.map(it=>(
                <span key={it.nombre} style={{fontSize:'11px',background:'white',border:'1px solid #fde68a',borderRadius:'5px',padding:'3px 8px',color:'#92400e'}}>
                  {it.nombre}: {it.totalPaq>0&&<strong>{it.totalPaq} u</strong>}{it.totalPaq>0&&it.totalKg>0&&' · '}{it.totalKg>0&&<strong>{it.totalKg.toFixed(1)} kg</strong>}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

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
                const dup=esPosibleDuplicado(f.id_control,f.sucursal);
                const tienePrefijo=(prods as any[]).some((p:any)=>prefijo.has(`${f.id_control}__${f.sucursal}__${p.key}`));
                return(
                  <tr key={`${f.id_control}__${f.sucursal}`} style={{background:dup?'#fef2f2':act?'#f0fdf4':(i%2===0?'white':'#fafafa'),borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'6px 12px'}}>
                      <span style={{fontWeight:act?600:400}}>{f.nombre_display}</span>
                      <span style={{marginLeft:'4px',fontSize:'10px',background:f.tipo==='A'?'#dbeafe':'#fef9c3',color:f.tipo==='A'?'#1e40af':'#92400e',padding:'1px 4px',borderRadius:'3px',fontWeight:600}}>F{f.tipo}</span>
                      {tienePrefijo && (
                        <span title="Pre-cargado desde un pedido fijo — revisá y confirmá" style={{marginLeft:'6px',fontSize:'10px',background:'#fef3c7',color:'#92400e',padding:'1px 6px',borderRadius:'3px',fontWeight:700}}>
                          📌 pedido fijo
                        </span>
                      )}
                      {dup && (
                        <span title="Estos mismos valores ya están facturados hoy para este cliente" style={{marginLeft:'6px',fontSize:'10px',background:'#fee2e2',color:'#dc2626',padding:'1px 6px',borderRadius:'3px',fontWeight:700}}>
                          ⚠ posible duplicado
                        </span>
                      )}
                    </td>
                    {(prods as any[]).map((p:any)=>{
                      const est=e(f.id_control,f.sucursal,p.key);const val=q(f.id_control,f.sucursal,p.key);
                      const esPrefijo=prefijo.has(`${f.id_control}__${f.sucursal}__${p.key}`);
                      return(
                        <td key={p.key} style={{padding:'3px 4px'}}>
                          <input type="number" min={0} value={val} placeholder="—"
                            title={esPrefijo?'Pre-cargado desde un pedido fijo — revisá y confirmá':undefined}
                            onChange={ev=>onChange(f,p.key,ev.target.value)} onBlur={()=>onBlur(f,p.key)}
                            style={{width:'100%',textAlign:'center',fontSize:'15px',fontWeight:700,
                              border:`2px solid ${est==='saving'?'#fbbf24':est==='saved'?'#86efac':est==='error'?'#fca5a5':esPrefijo?'#f59e0b':Number(val)>0?'#86efac':'#e5e7eb'}`,
                              borderRadius:'6px',padding:'5px 4px',background:esPrefijo?'#fffbeb':Number(val)>0?'#f0fdf4':'white',color:esPrefijo?'#92400e':Number(val)>0?'#166534':'#9ca3af',outline:'none'}}/>
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
                  <th style={{textAlign:'center',padding:'8px 10px',color:'#4d7c0f',fontWeight:700,minWidth:'110px'}}>Lechuga Crespa KG</th>
                  <th style={{textAlign:'center',padding:'8px 10px',color:'#65a30d',fontWeight:700,minWidth:'110px'}}>Lechuga Roble KG</th>
                  <th style={{textAlign:'right',padding:'8px 10px',color:'#92400e',fontWeight:700,minWidth:'90px'}}>Total KG</th>
                  <th style={{textAlign:'center',padding:'8px 6px',color:'#9ca3af',minWidth:'92px',fontSize:'10px'}}>Fecha fact.</th>
                </tr>
              </thead>
              <tbody>
                {filasKg.map((f,i)=>{
                  const rkg=Number(qKg(f.id_control,f.sucursal,'rucula_kg'))||0;
                  const lkgC=Number(qKg(f.id_control,f.sucursal,'lechuga_kg_crespa'))||0;
                  const lkgR=Number(qKg(f.id_control,f.sucursal,'lechuga_kg_roble'))||0;
                  const act=rkg>0||lkgC>0||lkgR>0;
                  return(
                    <tr key={`${f.id_control}__${f.sucursal}`} style={{background:act?'#fffbeb':(i%2===0?'white':'#fafafa'),borderBottom:'1px solid #fef3c7'}}>
                      <td style={{padding:'6px 12px'}}>
                        <span style={{fontWeight:act?600:400}}>{f.nombre_display}</span>
                        <span style={{marginLeft:'4px',fontSize:'10px',background:f.tipo==='A'?'#dbeafe':'#fef9c3',color:f.tipo==='A'?'#1e40af':'#92400e',padding:'1px 4px',borderRadius:'3px',fontWeight:600}}>F{f.tipo}</span>
                      </td>
                      {KGK_ALL.map(k=>{
                        const val=qKg(f.id_control,f.sucursal,k);
                        const estKg=estsKg[`${f.id_control}__${f.sucursal}`]?.[k]||'idle';
                        const bdrCol=estKg==='saved'?'#22c55e':estKg==='error'?'#ef4444':Number(val)>0?'#fbbf24':'#e5e7eb';
                        return(
                          <td key={k} style={{padding:'3px 8px',textAlign:'center'}}>
                            <div style={{position:'relative',display:'inline-block'}}>
                              <input type="number" min={0} step={0.1} value={val} placeholder="0"
                                ref={el=>{if(!kgInputRefs.current[`${f.id_control}__${f.sucursal}`])kgInputRefs.current[`${f.id_control}__${f.sucursal}`]={rucula_kg:null,lechuga_kg_crespa:null,lechuga_kg_roble:null};kgInputRefs.current[`${f.id_control}__${f.sucursal}`][k]=el;}}
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
                          {act?(rkg+lkgC+lkgR).toFixed(1)+' kg':'—'}
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
                  <td style={{textAlign:'center',padding:'8px',fontSize:'15px',fontWeight:800,color:totsKg.lechuga_kg_crespa>0?'#4d7c0f':'#d1d5db'}}>{totsKg.lechuga_kg_crespa>0?totsKg.lechuga_kg_crespa.toFixed(1)+' kg':'—'}</td>
                  <td style={{textAlign:'center',padding:'8px',fontSize:'15px',fontWeight:800,color:totsKg.lechuga_kg_roble>0?'#65a30d':'#d1d5db'}}>{totsKg.lechuga_kg_roble>0?totsKg.lechuga_kg_roble.toFixed(1)+' kg':'—'}</td>
                  <td style={{textAlign:'right',padding:'8px 10px',fontSize:'16px',fontWeight:800,color:'#92400e'}}>{(totsKg.rucula_kg+totsKg.lechuga_kg_crespa+totsKg.lechuga_kg_roble).toFixed(1)} kg</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Resumen del día (en paquetes / unidades) ── */}
        {hayV&&(()=>{
          const fR = stockCamara?.factorGrPaq?.rucula || 210;
          const fLCrespa = stockCamara?.factorGrPaq?.lechuga_crespa || 330;
          const fLRoble = stockCamara?.factorGrPaq?.lechuga_roble || 330;
          const lecPaq = tots.lechuga_crespa+tots.hoja_roble;
          const rKgPaq = Math.round(totsKg.rucula_kg*1000/fR);  // KG cajón → paq equivalentes
          const lKgPaqCrespa = Math.round(totsKg.lechuga_kg_crespa*1000/fLCrespa);
          const lKgPaqRoble = Math.round(totsKg.lechuga_kg_roble*1000/fLRoble);
          const lKgPaq = lKgPaqCrespa + lKgPaqRoble;
          const rTotPaq = tots.rucula + rKgPaq;
          const lTotPaq = lecPaq + lKgPaq;
          return(
          <div style={{marginTop:'12px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'10px 14px'}}>
            <p style={{margin:'0 0 8px',fontSize:'12px',fontWeight:700,color:'#374151'}}>📊 Resumen del día</p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'8px',alignItems:'start'}}>
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
                {totsKg.lechuga_kg_crespa>0&&<p style={{margin:'0 0 1px',fontSize:'12px',color:'#92400e'}}>{totsKg.lechuga_kg_crespa.toFixed(1)} kg crespa <span style={{color:'#9ca3af'}}>→ {lKgPaqCrespa} paq</span></p>}
                {totsKg.lechuga_kg_roble>0&&<p style={{margin:'0 0 1px',fontSize:'12px',color:'#92400e'}}>{totsKg.lechuga_kg_roble.toFixed(1)} kg roble <span style={{color:'#9ca3af'}}>→ {lKgPaqRoble} paq</span></p>}
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

        {/* ── Ventas cargadas de la semana en curso, por día y cliente ── */}
        {diasSemana.length>0 && (
          <div style={{marginTop:'12px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'10px 14px'}}>
            <p style={{margin:'0 0 8px',fontSize:'12px',fontWeight:700,color:'#374151'}}>📅 Ventas cargadas esta semana</p>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {diasSemana.map(dia=>(
                <div key={dia.fecha} style={{background:'white',border:'1px solid #e5e7eb',borderRadius:'7px',padding:'8px 10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'5px'}}>
                    <span style={{fontSize:'12px',fontWeight:700,color:'#111827'}}>{dia.label}{dia.fecha===hoy?' · hoy':''}</span>
                    <span style={{fontSize:'11px',color:'#6b7280'}}>
                      {dia.totalPaqDia>0&&<strong style={{color:'#374151'}}>{dia.totalPaqDia} paq</strong>}
                      {dia.totalPaqDia>0&&dia.totalKgDia>0&&' · '}
                      {dia.totalKgDia>0&&<strong style={{color:'#374151'}}>{dia.totalKgDia.toFixed(1)} kg</strong>}
                    </span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                    {dia.clientes.map(c=>(
                      <div key={c.nombre} style={{display:'flex',justifyContent:'space-between',fontSize:'11.5px',color:'#4b5563'}}>
                        <span>{c.nombre}</span>
                        <span style={{color:'#9ca3af'}}>
                          {c.totalPaq>0&&`${c.totalPaq} paq`}
                          {c.totalPaq>0&&c.totalKg>0&&' · '}
                          {c.totalKg>0&&`${c.totalKg.toFixed(1)} kg`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
