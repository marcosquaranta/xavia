'use client';
import { useState, useEffect, useRef } from 'react';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';

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
type PK = 'rucula'|'lechuga_crespa'|'hoja_roble'|'bandeja_rucula'|'albahaca';
type SV = { rucula:number; lechuga_crespa:number; hoja_roble:number };
type Stats = { semanaActual:SV; semanaAnterior:SV; mesActual:SV; mesAnterior:SV };
interface Fila { id_control:string; nombre_cliente:string; sucursal:string; nombre_display:string; tipo:string }
type Ctds = Record<string, Record<PK,string>>;
type Ests = Record<string, Record<PK,'idle'|'saving'|'saved'|'error'>>;
const EQ: Record<PK,string> = { rucula:'',lechuga_crespa:'',hoja_roble:'',bandeja_rucula:'',albahaca:'' };

function mkFilas(cs: ClienteVenta[], freq: Record<string,number>): Fila[] {
  const out: Fila[] = [];
  for (const c of cs) {
    if (c.activo!=='SI') continue;
    const sucs = c.sucursales ? c.sucursales.split('|').map(s=>s.trim()).filter(Boolean) : [];
    if (!sucs.length) { out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:c.nombre_xubio,nombre_display:c.nombre_display||c.nombre_xubio,tipo:c.tipo_factura}); }
    else { for (const s of sucs) out.push({id_control:c.id_control,nombre_cliente:c.nombre_xubio,sucursal:s,nombre_display:`${c.nombre_display||c.nombre_xubio} · ${s.split(' ').slice(-1)[0]}`,tipo:c.tipo_factura}); }
  }
  return out.sort((a,b)=>(freq[b.id_control]||0)-(freq[a.id_control]||0));
}
function pct(a:number,b:number){if(!b)return null;return Math.round(((a-b)/b)*100);}

export default function VentasManager({clientes,precios,frecuencias,stats}:{clientes:ClienteVenta[];precios:PrecioVenta[];frecuencias:Record<string,number>;stats:Stats}) {
  const hoy = new Date().toISOString().split('T')[0];
  const [fecha,setFecha]=useState(hoy);
  const [ff,setFf]=useState(hoy);
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
  const [historial,setHistorial]=useState<any[]>([]);
  const [loadHist,setLoadHist]=useState(false);
  const tmrs=useRef<Record<string,ReturnType<typeof setTimeout>>>({});

  const prods = extras ? ALL : PP;
  const filas = mkFilas(clientes,frecuencias);

  function pr(id:string,suc:string,k:PK){const r=precios.find(p=>String(p.id_control)===String(id)&&p.sucursal_obs===suc);return r?Number((r as any)[k]||0):0;}
  function q(id:string,suc:string,k:PK){return ctds[`${id}__${suc}`]?.[k]||'';}
  function e(id:string,suc:string,k:PK){return ests[`${id}__${suc}`]?.[k]||'idle';}
  function se(id:string,suc:string,k:PK,v:'idle'|'saving'|'saved'|'error'){
    setEsts(p=>({...p,[`${id}__${suc}`]:{...(p[`${id}__${suc}`]||{}),[k]:v}as any}));
  }

  // Cargar correlativo actual al iniciar
  useEffect(()=>{
    fetch('/api/ventas/historial').then(r=>r.json()).then(j=>{
      if(j.lastA) setCorrelaA(String(j.lastA+1));
      if(j.lastB) setCorrelaB(String(j.lastB+1));
    }).catch(()=>{});
  },[]);

  function cargarHistorial(){
    setLoadHist(true);
    fetch('/api/ventas/historial').then(r=>r.json()).then(j=>{
      setHistorial(j.fechas||[]);
      if(j.lastA) setCorrelaA(String(j.lastA+1));
      if(j.lastB) setCorrelaB(String(j.lastB+1));
    }).catch(()=>{}).finally(()=>setLoadHist(false));
  }

  useEffect(()=>{
    setLoading(true);setMsg(null);
    fetch(`/api/ventas/fecha?fecha=${fecha}`).then(r=>r.json()).then((data:VentaDia[])=>{
      const c:Ctds={};
      for(const v of data){c[`${v.id_control}__${v.sucursal}`]={rucula:String(v.rucula||''),lechuga_crespa:String(v.lechuga_crespa||''),hoja_roble:String(v.hoja_roble||''),bandeja_rucula:String(v.bandeja_rucula||''),albahaca:String(v.albahaca||'')};}
      setCtds(c);setEsts({});
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
      const r=await fetch('/api/ventas/guardar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,lineas:[{id_control:f.id_control,nombre_cliente:f.nombre_cliente,sucursal:f.sucursal,rucula:Number(q(f.id_control,f.sucursal,'rucula'))||0,lechuga_crespa:Number(q(f.id_control,f.sucursal,'lechuga_crespa'))||0,hoja_roble:Number(q(f.id_control,f.sucursal,'hoja_roble'))||0,bandeja_rucula:Number(q(f.id_control,f.sucursal,'bandeja_rucula'))||0,albahaca:Number(q(f.id_control,f.sucursal,'albahaca'))||0}]})});
      if(!r.ok)throw new Error();
      se(f.id_control,f.sucursal,k,'saved');setTimeout(()=>se(f.id_control,f.sucursal,k,'idle'),2000);
    }catch{se(f.id_control,f.sucursal,k,'error');}
  }
  async function exportar(){
    setExp(true);setMsg(null);
    try{
      setShowPreExport(false);
      const r=await fetch('/api/ventas/exportar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha,fechaFactura:ff,fechasCliente:fc,correlaA:Number(correlaA)-1,correlaB:Number(correlaB)-1,enviarEmail})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      const bytes=Uint8Array.from(atob(j.file),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes]));
      const a=document.createElement('a');a.href=url;a.download=j.filename;a.click();URL.revokeObjectURL(url);
      const emailTxt = j.emailOk ? ' · Email ✓' : enviarEmail ? ` · Email falló: ${j.emailError||'error'}` : '';
      setMsg({t:'ok',s:`${j.facturas} facturas · A→${j.lastA} · B→${j.lastB}${emailTxt}`});
      setCorrelaA(String(j.lastA+1)); setCorrelaB(String(j.lastB+1));
      setCtds({});setEsts({});setFc({});
    }catch(err:any){setMsg({t:'err',s:err.message});}
    setExp(false);
  }

  const tots:Record<PK,number>={rucula:0,lechuga_crespa:0,hoja_roble:0,bandeja_rucula:0,albahaca:0};
  for(const f of filas)for(const p of ALL)tots[p.key]+=Number(q(f.id_control,f.sucursal,p.key))||0;
  const hayV=Object.values(tots).some(v=>v>0);

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',marginBottom:'14px'}}>
        {PP.map(p=>{
          const k=p.key as keyof SV;const sa=stats.semanaActual[k];const sant=stats.semanaAnterior[k];const ma=stats.mesActual[k];const mant=stats.mesAnterior[k];
          const ps=pct(sa,sant);const pm=pct(ma,mant);const u=p.key==='rucula'?'paq':'pl';
          return(
            <div key={p.key} style={{background:'white',border:'1px solid #e5e7eb',borderTop:`3px solid ${p.color}`,borderRadius:'8px',padding:'10px 12px'}}>
              <p style={{margin:'0 0 7px',fontSize:'11px',fontWeight:700,color:p.color,textTransform:'uppercase'}}>{p.label}</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px'}}>
                <div>
                  <p style={{margin:'0 0 1px',fontSize:'9px',color:'#9ca3af'}}>SEMANA</p>
                  <p style={{margin:'0 0 1px',fontSize:'15px',fontWeight:700,color:'#111827'}}>{sa.toLocaleString('es-AR')} <span style={{fontSize:'9px',color:'#9ca3af'}}>{u}</span></p>
                  {ps!==null&&<p style={{margin:0,fontSize:'10px',fontWeight:600,color:ps>=0?'#059669':'#dc2626'}}>{ps>=0?'↑':'↓'}{Math.abs(ps)}%</p>}
                </div>
                <div>
                  <p style={{margin:'0 0 1px',fontSize:'9px',color:'#9ca3af'}}>MES</p>
                  <p style={{margin:'0 0 1px',fontSize:'15px',fontWeight:700,color:'#111827'}}>{ma.toLocaleString('es-AR')} <span style={{fontSize:'9px',color:'#9ca3af'}}>{u}</span></p>
                  {pm!==null&&<p style={{margin:0,fontSize:'10px',fontWeight:600,color:pm>=0?'#059669':'#dc2626'}}>{pm>=0?'↑':'↓'}{Math.abs(pm)}%</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disponibles */}
      <div style={{background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'10px 14px',marginBottom:'12px'}}>
        <p style={{margin:'0 0 8px',fontSize:'12px',fontWeight:700,color:'#374151'}}>📦 Disponibles hoy</p>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',alignItems:'center'}}>
          {(prods as any[]).map((p:any)=>(
            <div key={p.key} style={{display:'flex',alignItems:'center',gap:'5px'}}>
              <label style={{fontSize:'11px',color:p.color,fontWeight:600}}>{p.label}</label>
              <input type="number" min={0} value={disp[p.key as PK]} placeholder="—" onChange={ev=>setDisp(prev=>({...prev,[p.key]:ev.target.value}))}
                style={{width:'65px',textAlign:'center',fontSize:'14px',fontWeight:600,border:'1px solid #d1d5db',borderRadius:'6px',padding:'4px 4px',background:'white'}}/>
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div style={{display:'flex',gap:'10px',alignItems:'flex-end',flexWrap:'wrap',marginBottom:'10px'}}>
        <div>
          <label style={{fontSize:'10px',color:'#6b7280',display:'block',marginBottom:'2px'}}>FECHA VENTA</label>
          <input type="date" value={fecha} onChange={ev=>setFecha(ev.target.value)} style={{fontSize:'14px',fontWeight:600,border:'1px solid #e5e7eb',borderRadius:'7px',padding:'6px 10px'}}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'#6b7280',cursor:'pointer',userSelect:'none',marginBottom:'2px'}}>
          <input type="checkbox" checked={extras} onChange={ev=>setExtras(ev.target.checked)}/> Bandeja + Albahaca
        </label>
        <button onClick={()=>{ if(hayV) setShowPreExport(true); }} disabled={!hayV}
          style={{background:hayV?'#1d4ed8':'#e5e7eb',color:hayV?'white':'#9ca3af',border:'none',borderRadius:'8px',padding:'8px 18px',fontWeight:700,fontSize:'13px',cursor:hayV?'pointer':'not-allowed',marginLeft:'auto',display:'flex',alignItems:'center',gap:'5px'}}>
          <span>📤</span>Exportar Xubio
        </button>
      </div>

      {/* Fecha facturación */}
      <div style={{background:'#fffbeb',border:'1px solid #fde047',borderRadius:'7px',padding:'7px 14px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
        <span style={{fontSize:'11px',fontWeight:600,color:'#92400e'}}>📅 Fecha facturación</span>
        <input type="date" value={ff} onChange={ev=>setFf(ev.target.value)} style={{fontSize:'12px',fontWeight:600,border:'1px solid #fde047',borderRadius:'5px',padding:'3px 8px',color:'#713f12'}}/>
        <span style={{fontSize:'10px',color:'#92400e'}}>Cambiable por cliente ↓</span>
      </div>

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

      {msg&&<div style={{padding:'9px 14px',borderRadius:'7px',marginBottom:'10px',fontSize:'12px',background:msg.t==='ok'?'#f0fdf4':'#fef2f2',border:`1px solid ${msg.t==='ok'?'#86efac':'#fca5a5'}`,color:msg.t==='ok'?'#166534':'#dc2626'}}>{msg.s}</div>}

      {/* Tabla */}
      {loading?<div style={{textAlign:'center',padding:'24px',color:'#9ca3af'}}>Cargando…</div>:(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#f8fafc',borderBottom:'2px solid #e5e7eb'}}>
                <th style={{textAlign:'left',padding:'9px 12px',minWidth:'150px'}}>Cliente</th>
                {(prods as any[]).map((p:any)=><th key={p.key} style={{textAlign:'center',padding:'9px 6px',color:p.color,fontWeight:700,minWidth:'82px'}}>{p.label}</th>)}
                <th style={{textAlign:'center',padding:'9px 6px',color:'#9ca3af',minWidth:'92px',fontSize:'10px'}}>Fecha fact.</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f,i)=>{
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
                    <td style={{padding:'3px 5px'}}>
                      <input type="date" value={fc[f.id_control]||ff} onChange={ev=>setFc(p=>({...p,[f.id_control]:ev.target.value}))}
                        style={{width:'100%',fontSize:'10px',border:`1px solid ${fc[f.id_control]&&fc[f.id_control]!==ff?'#fbbf24':'#e5e7eb'}`,borderRadius:'5px',padding:'4px 3px',background:fc[f.id_control]&&fc[f.id_control]!==ff?'#fffbeb':'white',color:fc[f.id_control]&&fc[f.id_control]!==ff?'#92400e':'#9ca3af'}}/>
                    </td>
                  </tr>
                );
              })}
              {/* Total vendido */}
              <tr style={{background:'#f0fdf4',borderTop:'2px solid #86efac'}}>
                <td style={{padding:'8px 12px',fontSize:'12px',fontWeight:700,color:'#166534'}}>Total vendido</td>
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

      {/* Historial de exportaciones */}
      <div style={{marginTop:'14px',borderTop:'1px solid #f3f4f6',paddingTop:'10px'}}>
        <button onClick={()=>{ if(!showHistorial){cargarHistorial();} setShowHistorial(!showHistorial); }}
          style={{background:'none',border:'1px solid #e5e7eb',borderRadius:'6px',padding:'4px 12px',fontSize:'11px',cursor:'pointer',color:'#6b7280'}}>
          {showHistorial?'▲ Ocultar historial':'▼ Ver historial de ventas guardadas'}
        </button>
        {showHistorial && (
          <div style={{marginTop:'10px'}}>
            {loadHist ? <p style={{color:'#9ca3af',fontSize:'12px'}}>Cargando…</p> : historial.length === 0 ? <p style={{color:'#9ca3af',fontSize:'12px'}}>Sin datos.</p> : (
              <table style={{fontSize:'12px',width:'100%'}}>
                <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e5e7eb'}}>
                  <th style={{textAlign:'left',padding:'6px 10px'}}>Fecha</th>
                  <th style={{textAlign:'right',padding:'6px 8px'}}>Clientes</th>
                  <th style={{textAlign:'right',padding:'6px 8px'}}>Rúcula</th>
                  <th style={{textAlign:'right',padding:'6px 8px'}}>Lechuga</th>
                  <th style={{textAlign:'center',padding:'6px 8px'}}>Estado</th>
                  <th style={{padding:'6px 8px'}}></th>
                </tr></thead>
                <tbody>
                  {historial.map((h:any)=>(
                    <tr key={h.fecha} style={{borderBottom:'1px solid #f3f4f6',background:h.fecha===fecha?'#eff6ff':'white'}}>
                      <td style={{padding:'6px 10px',fontWeight:600}}>{h.fecha}</td>
                      <td style={{textAlign:'right',padding:'6px 8px',color:'#6b7280'}}>{h.clientes}</td>
                      <td style={{textAlign:'right',padding:'6px 8px',color:'#166534'}}>{h.rucula>0?h.rucula:'—'}</td>
                      <td style={{textAlign:'right',padding:'6px 8px',color:'#4d7c0f'}}>{h.lechuga>0?h.lechuga:'—'}</td>
                      <td style={{textAlign:'center',padding:'6px 8px'}}>
                        <span style={{fontSize:'10px',background:h.exportado?'#dcfce7':'#fef9c3',color:h.exportado?'#166534':'#92400e',padding:'1px 6px',borderRadius:'4px',fontWeight:600}}>
                          {h.exportado?'Exportado':'Pendiente'}
                        </span>
                      </td>
                      <td style={{padding:'6px 8px'}}>
                        <button onClick={()=>setFecha(h.fecha)} style={{background:'none',border:'1px solid #e5e7eb',borderRadius:'5px',padding:'2px 8px',fontSize:'11px',cursor:'pointer',color:'#374151'}}>
                          Ir a esta fecha
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
