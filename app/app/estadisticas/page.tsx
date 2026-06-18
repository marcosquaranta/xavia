import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, ciclosPorMesYAnio } from '@/lib/estadisticas';
import { calcularDiasPorFase } from '@/lib/lotes';
import type { Lote, Movimiento, Variedad, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import SelectorVariedad from './SelectorVariedad';
import GraficoCiclosMesadas from './GraficoCiclosMesadas';
import GraficoOcupacionHistorial from './GraficoOcupacionHistorial';
import type { MesadaOcupacion, DiaOcupacion } from './GraficoOcupacionHistorial';
export const dynamic = 'force-dynamic';

export default async function EstadisticasPage({ searchParams }: { searchParams: { variedad?: string; nave?: string } }) {
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
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return <><Header user={user} current="estadisticas" /><div className="container"><div className="alert-box error">{err}</div></div></>;

  const hoy = new Date();
  const mesPasado = new Date(hoy); mesPasado.setMonth(mesPasado.getMonth() - 1);
  const varActivas = variedades.filter(v => v.activo === 'SI');
  const varSel = searchParams.variedad || varActivas[0]?.variedad || 'Lechuga Crespa';

  let statsActual: any[] = [], statsPasado: any[] = [];
  let datosActual: [number, number][] = [], datosAnterior: [number, number][] = [];
  try { statsActual = estadisticasDelMes(lotes, movimientos, hoy); statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado); } catch {}
  try {
    const anioA = hoy.getFullYear(); const anioAnt = anioA - 1;
    const cA = ciclosPorMesYAnio(lotes, movimientos, anioA); const cAnt = ciclosPorMesYAnio(lotes, movimientos, anioAnt);
    datosActual  = Array.from((cA.get(varSel)   || new Map()).entries()).filter(([k]) => k < 12) as [number, number][];
    datosAnterior= Array.from((cAnt.get(varSel) || new Map()).entries()).filter(([k]) => k < 12) as [number, number][];
  } catch {}

  const anioActual  = hoy.getFullYear();
  const anioAnterior= anioActual - 1;
  const nombreMes   = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  // ── CICLOS POR MESADA ──
  const mesadas   = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const cosechados= lotes.filter(l => l.estado === 'cosechado');

  const diasPorLote = new Map<string, { f1: number|null; f2: number; total: number; variedad: string }>();
  for (const l of cosechados) {
    try {
      const dias = calcularDiasPorFase(l, movimientos);
      if (dias.total < 20) continue;
      diasPorLote.set(l.id_lote, { f1: dias.fase_1, f2: dias.fase_2, total: dias.total, variedad: l.variedad });
    } catch {}
  }

  // Peso promedio por lote (gr/paquete)
  const pesoLoteMap = new Map<string, { gr: number; esRucula: boolean }>();
  for (const l of cosechados) {
    const gr = Number(l.peso_muestra_kg) > 0 ? Math.round(Number(l.peso_muestra_kg) * 1000) : 0;
    if (gr > 0) {
      const v = String(l.variedad || '').toLowerCase();
      pesoLoteMap.set(l.id_lote, { gr, esRucula: v.includes('rucula') || v.includes('rúcula') });
    }
  }

  interface CicloMesada {
    nombre: string; nave: number;
    lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number;
    ruculaF2: number; ruculaTotal: number; ruculaN: number;
    pesoGrLechuga: number; pesoGrRucula: number;
  }
  const ciclosMesadas: CicloMesada[] = [];
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length) : 0;

  for (const mes of mesadas) {
    if (naveFilter !== 'todas' && String(mes.nave) !== naveFilter) continue;

    const lotesEnMesada = new Set(
      movimientos
        .filter(m => m.ubicacion_destino === mes.nombre || m.ubicacion_destino === mes.id_ubicacion)
        .map(m => m.id_lote)
    );

    const lF1: number[] = [], lF2: number[] = [], rF2: number[] = [];
    const pLech: number[] = [], pRuc: number[] = [];

    for (const idLote of lotesEnMesada) {
      const d = diasPorLote.get(String(idLote));
      if (d) {
        const vNorm = d.variedad.toLowerCase();
        const esR = vNorm.includes('rucula') || vNorm.includes('rúcula');
        if (esR) { if (d.f2 > 0) rF2.push(d.f2); }
        else {
          if (d.f1 !== null && d.f1 > 0) lF1.push(d.f1);
          if (d.f2 > 0) lF2.push(d.f2);
        }
      }
      const p = pesoLoteMap.get(String(idLote));
      if (p) (p.esRucula ? pRuc : pLech).push(p.gr);
    }

    if (lF1.length + lF2.length + rF2.length === 0) continue;

    ciclosMesadas.push({
      nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
      nave: Number(mes.nave),
      lechugaF1: avg(lF1), lechugaF2: avg(lF2),
      lechugaTotal: avg(lF1.map((f, i) => f + (lF2[i] || 0))),
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

  const destAMesada = new Map<string, string>();
  for (const m of mesadasHist) { destAMesada.set(m.nombre, m.nombre); destAMesada.set(m.id_ubicacion, m.nombre); }

  const movByLote = new Map<string, Movimiento[]>();
  for (const mv of movimientos) {
    if (!movByLote.has(mv.id_lote)) movByLote.set(mv.id_lote, []);
    movByLote.get(mv.id_lote)!.push(mv);
  }

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

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">Vista agregada · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</p>

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

        {/* Ciclos por mesada */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
            <div>
              <p className="card-title" style={{ margin:'0 0 2px' }}>Ciclos promedio por mesada</p>
              <p className="card-sub" style={{ margin:0 }}>Lotes cosechados · días F1+F2 · punto naranja = peso promedio gr/paq</p>
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
            ? <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin datos de mesadas.</p>
            : <GraficoCiclosMesadas datos={ciclosMesadas} />
          }
        </div>

        {/* Evolución de ciclos */}
        <div className="card">
          <p className="card-title">Evolución de ciclos · {anioActual} vs {anioAnterior}</p>
          <p className="card-sub">Días promedio de ciclo total por mes.</p>
          <SelectorVariedad variedades={varActivas.map(v => v.variedad)} seleccionada={varSel} />
          <GraficoEvolucion datosActual={datosActual} datosAnterior={datosAnterior} anioActual={anioActual} anioAnterior={anioAnterior} />
        </div>

        {/* Producción por variedad */}
        <div className="card">
          <p className="card-title">Ciclo y producción por variedad — mes actual vs anterior</p>
          {statsActual.length === 0
            ? <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>No hay cosechas registradas este mes todavía.</p>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Variedad</th>
                    <th style={{ textAlign:'right' }}>Cosechado</th>
                    <th style={{ textAlign:'right' }}>vs mes ant.</th>
                    <th style={{ textAlign:'right' }}>Ciclo prom.</th>
                    <th style={{ textAlign:'right' }}>vs mes ant.</th>
                    <th style={{ textAlign:'right' }}>Rend. (kg/u)</th>
                  </tr>
                </thead>
                <tbody>
                  {statsActual.map((s: any) => {
                    const ant = statsPasado.find((x: any) => x.variedad === s.variedad);
                    const dC  = ant ? Math.round(((s.cosechado - ant.cosechado) / Math.max(1, ant.cosechado)) * 100) : 0;
                    const dCi = ant ? s.ciclo_promedio - ant.ciclo_promedio : 0;
                    return (
                      <tr key={s.variedad}>
                        <td>{s.variedad}</td>
                        <td style={{ textAlign:'right' }}>{s.cosechado.toLocaleString('es-AR')}</td>
                        <td style={{ textAlign:'right', color: dC>0?'#059669':dC<0?'#dc2626':'#6b7280' }}>{ant?(dC>=0?'↑':'↓')+' '+Math.abs(dC)+'%':'—'}</td>
                        <td style={{ textAlign:'right' }}>{s.ciclo_promedio} d</td>
                        <td style={{ textAlign:'right', color: dCi<0?'#059669':dCi>0?'#dc2626':'#6b7280' }}>{ant?(dCi>0?'↑':dCi<0?'↓':'→')+' '+Math.abs(dCi)+' d':'—'}</td>
                        <td style={{ textAlign:'right' }}>{typeof s.rendimiento_kg_por_unidad==='number'?s.rendimiento_kg_por_unidad.toFixed(3):'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </>
  );
}
