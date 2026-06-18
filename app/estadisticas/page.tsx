import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, ciclosPorMesYAnioDetalle, cicloRealPorVariedad } from '@/lib/estadisticas';
import { calcularDiasPorFase } from '@/lib/lotes';
import type { Lote, Movimiento, Variedad, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import GraficoCiclosMesadas from './GraficoCiclosMesadas';
import GraficoPesaje from './GraficoPesaje';
import GraficoOcupacionHistorial from './GraficoOcupacionHistorial';
import type { MesadaOcupacion, DiaOcupacion } from './GraficoOcupacionHistorial';
export const dynamic = 'force-dynamic';

export default async function EstadisticasPage({ searchParams }: { searchParams: { nave?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const naveFilter = searchParams.nave || 'todas';

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], variedades: Variedad[] = [], ubicaciones: Ubicacion[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, variedades, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Variedad>('Variedades'), readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const varActivas = variedades.filter(v => v.activo === 'SI');

  // Puntos de pesaje testigo: lotes cosechados por paquete con peso_muestra_kg > 0
  const puntosPesaje = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha && Number(l.peso_muestra_kg) > 0 && (l.destino_cosecha === 'paquete' || l.destino_cosecha === 'bandeja'))
    .map(l => ({
      fecha: String(l.fecha_cosecha),
      variedad: l.variedad,
      peso_gr: Math.round(Number(l.peso_muestra_kg) * 1000),
      paquetes: Number(l.unidades_cosechadas) || 0,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  let statsActual: any[] = [], statsPasado: any[] = [], curvas: any[] = [];
  try { statsActual = estadisticasDelMes(lotes, movimientos, hoy); } catch {}
  try {
    const mesPasado = new Date(hoy); mesPasado.setMonth(mesPasado.getMonth() - 1);
    statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado);
  } catch {}
  try {
    const cA = ciclosPorMesYAnioDetalle(lotes, movimientos, anioActual);
    for (const v of varActivas) {
      try {
        const datosActual = Array.from((cA.get(v.variedad) || new Map()).entries())
          .filter(([k]) => typeof k === 'number' && k >= 0 && k < 12) as [number, any][];
        if (datosActual.length > 0) curvas.push({ variedad: v.variedad, datosActual, datosAnterior: [] });
      } catch {}
    }
  } catch {}

  // ── CICLOS POR MESADA ──
  // Para cada mesada: promedio de dias_f1, dias_f2 de cosechados cuyo historial de movimientos
  // incluye esa mesada como ubicacion_destino
  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const cosechados = lotes.filter(l => l.estado === 'cosechado');

  // Mapear id_lote → dias por fase
  const diasPorLote = new Map<string, { f1: number|null; f2: number; total: number; variedad: string; nave: number }>();
  for (const l of cosechados) {
    try {
      const dias = calcularDiasPorFase(l, movimientos);
      if (dias.total < 20) continue;
      // Determinar nave del lote
      const nav = String(l.ubicacion_actual || l.id_lote || '').toLowerCase().includes('n1') ||
                  String(l.ubicacion_actual || '').toLowerCase().includes('nave 1') ? 1 : 2;
      diasPorLote.set(l.id_lote, { f1: dias.fase_1, f2: dias.fase_2, total: dias.total, variedad: l.variedad, nave: nav });
    } catch {}
  }

  // Ciclos por nave (para el gráfico de mesadas usamos los lotes históricos agrupados por nave)
  function ciclosPorNave(naveNum: number | null) {
    const filtrados = [...diasPorLote.values()].filter(d => naveNum === null || d.nave === naveNum);
    const porVariedad = new Map<string, { f1s: number[]; f2s: number[]; totals: number[] }>();
    for (const d of filtrados) {
      const vNorm = String(d.variedad).toLowerCase();
      const key = vNorm.includes('rucula') || vNorm.includes('rúcula') ? 'rucula' : 'lechuga';
      const prev = porVariedad.get(key) || { f1s: [], f2s: [], totals: [] };
      if (d.f1 !== null && d.f1 > 0) prev.f1s.push(d.f1);
      if (d.f2 > 0) prev.f2s.push(d.f2);
      if (d.total > 0) prev.totals.push(d.total);
      porVariedad.set(key, prev);
    }
    return porVariedad;
  }

  // Peso promedio por lote cosechado (gr por paquete)
  const pesoLoteMap = new Map<string, { gr: number; esRucula: boolean }>();
  for (const l of cosechados) {
    const gr = Number(l.peso_muestra_paquete_gr) > 0
      ? Number(l.peso_muestra_paquete_gr)
      : Number(l.peso_muestra_kg) > 0 ? Math.round(Number(l.peso_muestra_kg) * 1000) : 0;
    if (gr > 0) {
      const v = String(l.variedad || '').toLowerCase();
      pesoLoteMap.set(l.id_lote, { gr, esRucula: v.includes('rucula') || v.includes('rúcula') });
    }
  }

  // Ciclos por mesada: usar movimientos de trasplante para saber qué lotes pasaron por cada mesada
  interface CicloMesada {
    nombre: string; nave: number;
    lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number;
    ruculaF2: number; ruculaTotal: number; ruculaN: number;
    pesoGrLechuga: number; pesoGrRucula: number;
  }
  const ciclosMesadas: CicloMesada[] = [];

  for (const mes of mesadas) {
    if (naveFilter !== 'todas' && String(mes.nave) !== naveFilter) continue;

    // Lotes que tuvieron algún movimiento hacia esta mesada
    const lotesEnMesada = new Set(
      movimientos
        .filter(m => m.ubicacion_destino === mes.nombre || m.ubicacion_destino === mes.id_ubicacion)
        .map(m => m.id_lote)
    );

    const lF1: number[] = [], lF2: number[] = [], rF2: number[] = [];
    const pLech: number[] = [], pRuc: number[] = [];
    for (const idLote of lotesEnMesada) {
      const d = diasPorLote.get(String(idLote));
      if (!d) continue;
      const vNorm = d.variedad.toLowerCase();
      const esR = vNorm.includes('rucula') || vNorm.includes('rúcula');
      if (esR) {
        if (d.f2 > 0) rF2.push(d.f2);
      } else {
        if (d.f1 !== null && d.f1 > 0) lF1.push(d.f1);
        if (d.f2 > 0) lF2.push(d.f2);
      }
      const p = pesoLoteMap.get(String(idLote));
      if (p) (p.esRucula ? pRuc : pLech).push(p.gr);
    }

    if (lF1.length + lF2.length + rF2.length === 0) continue;
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

    ciclosMesadas.push({
      nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
      nave: Number(mes.nave),
      lechugaF1: avg(lF1), lechugaF2: avg(lF2),
      lechugaTotal: avg(lF1.map((f,i) => f + (lF2[i]||0))),
      lechugaN: Math.max(lF1.length, lF2.length),
      ruculaF2: avg(rF2), ruculaTotal: avg(rF2), ruculaN: rF2.length,
      pesoGrLechuga: avg(pLech), pesoGrRucula: avg(pRuc),
    });
  }

  // ── HISTORIAL DE OCUPACIÓN (últimos 60 días) ──
  const HIST_DIAS = 60;
  const hoyHist = new Date(); hoyHist.setHours(12, 0, 0, 0);
  const mananaHist = new Date(hoyHist); mananaHist.setDate(mananaHist.getDate() + 1);
  const mananaStr = mananaHist.toISOString().split('T')[0];

  const fechasHist: string[] = [];
  for (let i = HIST_DIAS - 1; i >= 0; i--) {
    const d = new Date(hoyHist); d.setDate(d.getDate() - i);
    fechasHist.push(d.toISOString().split('T')[0]);
  }

  function normF(s: any): string {
    if (!s) return '';
    const str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      const [dd, mm, yyyy] = str.split('/');
      return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    }
    try { return new Date(str).toISOString().split('T')[0]; } catch { return ''; }
  }

  const mesadasHist = ubicaciones
    .filter(u => u.tipo === 'mesada' && u.activo === 'SI')
    .sort((a, b) => (Number(a.nave) - Number(b.nave)) || (Number(a.orden_visual) - Number(b.orden_visual)));

  // Mapa destino → nombre canónico de mesada (por nombre y por id)
  const destAMesada = new Map<string, string>();
  for (const m of mesadasHist) { destAMesada.set(m.nombre, m.nombre); destAMesada.set(m.id_ubicacion, m.nombre); }

  // Índice movimientos por lote
  const movByLote = new Map<string, typeof movimientos>();
  for (const mv of movimientos) {
    if (!movByLote.has(mv.id_lote)) movByLote.set(mv.id_lote, []);
    movByLote.get(mv.id_lote)!.push(mv);
  }

  // Construir mapa (mesada, fecha) → ocupación
  const ocupMap = new Map<string, { loteId: string; cultivo: 'lechuga' | 'rucula' | 'albahaca' }>();

  for (const lote of lotes) {
    const movsLote = (movByLote.get(lote.id_lote) || [])
      .map(mv => ({ ...mv, _f: normF(mv.fecha) }))
      .filter(mv => mv._f)
      .sort((a, b) => a._f.localeCompare(b._f));

    if (!movsLote.length) continue;

    const v = String(lote.variedad || '').toLowerCase();
    const cultivo: 'lechuga' | 'rucula' | 'albahaca' =
      v.includes('rucula') || v.includes('rúcula') ? 'rucula' :
      v.includes('albahaca') ? 'albahaca' : 'lechuga';

    for (let i = 0; i < movsLote.length; i++) {
      const mv = movsLote[i];
      const mesada = destAMesada.get(mv.ubicacion_destino);
      if (!mesada) continue;

      const desde = mv._f;
      let hasta: string;
      if (i + 1 < movsLote.length) {
        hasta = movsLote[i + 1]._f;
      } else if (lote.estado === 'activo') {
        hasta = mananaStr;
      } else {
        const fc = normF(lote.fecha_cosecha || lote.fecha_ult_movimiento);
        if (fc) {
          const d2 = new Date(fc + 'T12:00:00'); d2.setDate(d2.getDate() + 1);
          hasta = d2.toISOString().split('T')[0];
        } else {
          hasta = mananaStr;
        }
      }

      // Marcar cada día de nuestro rango que caiga en [desde, hasta)
      for (const fecha of fechasHist) {
        if (fecha >= desde && fecha < hasta) {
          const key = `${mesada}||${fecha}`;
          if (!ocupMap.has(key)) ocupMap.set(key, { loteId: lote.id_lote, cultivo });
        }
      }
    }
  }

  const ocupacionHistorial: MesadaOcupacion[] = mesadasHist.map(mes => ({
    nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
    nave: Number(mes.nave),
    dias: fechasHist.map(fecha => {
      const ocup = ocupMap.get(`${mes.nombre}||${fecha}`);
      return { fecha, loteId: ocup?.loteId ?? null, cultivo: ocup?.cultivo ?? null } as DiaOcupacion;
    }),
  }));

  const nombre = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">{nombre}</p>

        {/* Historial de ocupación — Nave 1 */}
        <div className="card">
          <p className="card-title">Historial de ocupación — Nave 1</p>
          <p className="card-sub">Cada fila es una mesada · 2 meses · verde = lechuga · naranja = rúcula · violeta = albahaca</p>
          <GraficoOcupacionHistorial mesadas={ocupacionHistorial} fechas={fechasHist} nave={1} />
        </div>

        {/* Historial de ocupación — Nave 2 */}
        <div className="card">
          <p className="card-title">Historial de ocupación — Nave 2</p>
          <p className="card-sub">Cada fila es una mesada · 2 meses · verde = lechuga · naranja = rúcula · violeta = albahaca</p>
          <GraficoOcupacionHistorial mesadas={ocupacionHistorial} fechas={fechasHist} nave={2} />
        </div>

        {/* Evolución mensual */}
        <div className="card">
          <p className="card-title">Evolución de ciclos · {anioActual}</p>
          <p className="card-sub">Días F2 (línea gruesa) y total (línea fina) promedio por mes.</p>
          <GraficoEvolucion curvas={curvas} anioActual={anioActual} anioAnterior={anioAnterior} />
        </div>

        {/* Tabla mes actual */}
        <div className="card">
          <p className="card-title">Producción por variedad — mes actual vs anterior</p>
          {statsActual.length === 0
            ? <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin cosechas este mes.</p>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Variedad</th>
                    <th style={{ textAlign:'right' }}>Cosechado</th>
                    <th style={{ textAlign:'right' }}>vs mes ant.</th>
                    <th style={{ textAlign:'right' }}>Ciclo prom.</th>
                    <th style={{ textAlign:'right' }}>vs mes ant.</th>
                  </tr>
                </thead>
                <tbody>
                  {statsActual.map((s: any) => {
                    const ant = statsPasado.find((x:any) => x.variedad === s.variedad);
                    const dU = ant ? s.unidades - ant.unidades : null;
                    const dC = ant ? s.ciclo_prom - ant.ciclo_prom : null;
                    return (
                      <tr key={s.variedad}>
                        <td>{s.variedad}</td>
                        <td style={{ textAlign:'right', fontWeight:500 }}>{s.unidades?.toLocaleString?.('es-AR')} {s.tipo_unidad}</td>
                        <td style={{ textAlign:'right', color:dU===null?'#9ca3af':dU>=0?'#059669':'#dc2626' }}>
                          {dU===null?'—':(dU>=0?'+':'')+dU}
                        </td>
                        <td style={{ textAlign:'right' }}>{s.ciclo_prom>0?s.ciclo_prom+'d':'—'}</td>
                        <td style={{ textAlign:'right', color:dC===null?'#9ca3af':dC<=0?'#059669':'#dc2626' }}>
                          {dC===null?'—':(dC>0?'+':'')+dC+'d'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>

        {/* Pesaje testigo */}
        <div className="card">
          <p className="card-title">Evolución de pesaje testigo</p>
          <p className="card-sub">Gramos por paquete en cada cosecha · base para conversión KG↔paquetes</p>
          <GraficoPesaje puntos={puntosPesaje} />
        </div>

        {/* Ciclos por mesada */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
            <div>
              <p className="card-title" style={{ margin:'0 0 2px' }}>Ciclos promedio por mesada</p>
              <p className="card-sub" style={{ margin:0 }}>Basado en lotes cosechados · días F1 + F2 sin plantinera</p>
            </div>
            <div style={{ display:'flex', gap:'6px' }}>
              {[['todas','Ambas'],['1','Nave 1'],['2','Nave 2']].map(([v,l]) => (
                <a key={v} href={`/estadisticas${v!=='todas'?`?nave=${v}`:''}`}
                  style={{ padding:'4px 10px', borderRadius:'6px', fontSize:'12px', fontWeight:naveFilter===v?700:400, background:naveFilter===v?'#111827':'#f3f4f6', color:naveFilter===v?'white':'#374151', textDecoration:'none' }}>
                  {l}
                </a>
              ))}
            </div>
          </div>

          {ciclosMesadas.length === 0
            ? <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin datos de mesadas para el filtro seleccionado.</p>
            : <GraficoCiclosMesadas datos={ciclosMesadas} />
          }

          {/* Tabla detallada */}
          {ciclosMesadas.length > 0 && (
            <div style={{ marginTop:'16px', overflowX:'auto' }}>
              <table style={{ fontSize:'12px' }}>
                <thead>
                  <tr>
                    <th>Mesada</th>
                    <th style={{ textAlign:'center' }}>Nave</th>
                    <th style={{ textAlign:'right', color:'#4d7c0f' }}>Lech F1</th>
                    <th style={{ textAlign:'right', color:'#4d7c0f' }}>Lech F2</th>
                    <th style={{ textAlign:'right', color:'#4d7c0f' }}>Lech Total</th>
                    <th style={{ textAlign:'right', color:'#166534' }}>Rúc F2</th>
                    <th style={{ textAlign:'right', color:'#9ca3af', fontSize:'11px' }}>N cosechas</th>
                  </tr>
                </thead>
                <tbody>
                  {ciclosMesadas.map((m, i) => (
                    <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ fontWeight:500 }}>{m.nombre}</td>
                      <td style={{ textAlign:'center' }}>
                        <span style={{ background:m.nave===1?'#881337':'#7c3aed', color:'white', padding:'1px 6px', borderRadius:'3px', fontSize:'10px', fontWeight:700 }}>N{m.nave}</span>
                      </td>
                      <td style={{ textAlign:'right', color:m.lechugaF1>0?'#374151':'#d1d5db' }}>{m.lechugaF1>0?m.lechugaF1+'d':'—'}</td>
                      <td style={{ textAlign:'right', color:m.lechugaF2>0?'#374151':'#d1d5db' }}>{m.lechugaF2>0?m.lechugaF2+'d':'—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:m.lechugaTotal>0?'#4d7c0f':'#d1d5db' }}>{m.lechugaTotal>0?m.lechugaTotal+'d':'—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:m.ruculaF2>0?'#166534':'#d1d5db' }}>{m.ruculaF2>0?m.ruculaF2+'d':'—'}</td>
                      <td style={{ textAlign:'right', color:'#9ca3af' }}>{m.lechugaN+m.ruculaN}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
