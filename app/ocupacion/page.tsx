import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, appendRows } from '@/lib/sheets';
import { tubosPorMesada } from '@/lib/ocupacion';
import type { Lote, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import GraficoOcupacionHistorial from '@/app/estadisticas/GraficoOcupacionHistorial';
import type { MesadaOcupacion, DiaOcupacion } from '@/app/estadisticas/GraficoOcupacionHistorial';
export const dynamic = 'force-dynamic';

interface OcupHistRow { fecha: string; mesada: string; nave: string; tubos_totales: string; tubos_ocupados: string; pct: string; }

export default async function OcupacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], ubicaciones: Ubicacion[] = [];
  let ocupHistRows: OcupHistRow[] = [];
  try {
    [lotes, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch {}

  // Leer historial de ocupación (hoja puede no existir aún)
  try { ocupHistRows = await readSheet<OcupHistRow>('OcupacionHistorial'); } catch {}

  // Registrar snapshot de hoy si el cron aún no lo hizo (fallback al abrir la página)
  const hoyStr = new Date().toISOString().split('T')[0];
  if (!ocupHistRows.some(r => r.fecha === hoyStr) && lotes.length > 0 && ubicaciones.length > 0) {
    try {
      const resumen = tubosPorMesada(ubicaciones, lotes);
      const newRows: any[][] = resumen.flatMap(nave =>
        nave.mesadas.filter(m => m.sector_fase !== 'fase_1').map(m => [hoyStr, m.nombre, m.nave, m.tubos_totales, m.tubos_ocupados, m.ocupacion_pct])
      );
      if (newRows.length) {
        await appendRows('OcupacionHistorial', newRows);
        for (const r of newRows)
          ocupHistRows.push({ fecha: r[0], mesada: r[1], nave: String(r[2]), tubos_totales: String(r[3]), tubos_ocupados: String(r[4]), pct: String(r[5]) });
      }
    } catch {}
  }

  // Construir datos del gráfico histórico (últimos 90 días)
  const HIST_DIAS = 90;
  const fechasHist: string[] = [];
  for (let i = HIST_DIAS - 1; i >= 0; i--) {
    const d = new Date(hoyStr + 'T12:00:00'); d.setDate(d.getDate() - i);
    fechasHist.push(d.toISOString().split('T')[0]);
  }
  const pctMap = new Map<string, number>();
  for (const r of ocupHistRows) {
    if (r.fecha && r.mesada) pctMap.set(`${r.mesada}||${r.fecha}`, Number(r.pct) || 0);
  }
  function cultivoMesada(nombre: string): 'lechuga' | 'rucula' | 'albahaca' | null {
    const n = nombre.toLowerCase();
    if (n.includes('rucula') || n.includes('rúcula')) return 'rucula';
    if (n.includes('albahaca')) return 'albahaca';
    if (n.includes('lechuga')) return 'lechuga';
    return null;
  }
  const mesadasOrdenadas = ubicaciones
    .filter(u => u.tipo === 'mesada' && u.activo === 'SI' && u.sector_fase !== 'fase_1')
    .sort((a, b) => (Number(a.nave) - Number(b.nave)) || (Number(a.orden_visual) - Number(b.orden_visual)));
  const ocupacionHistorial: MesadaOcupacion[] = mesadasOrdenadas.map(mes => ({
    nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
    nave: Number(mes.nave),
    dias: fechasHist.map(fecha => {
      const pct = pctMap.get(`${mes.nombre}||${fecha}`) ?? -1;
      return { fecha, loteId: null, cultivo: pct > 0 ? cultivoMesada(mes.nombre) : null, pct: pct >= 0 ? pct : 0 } as DiaOcupacion;
    }),
  }));

  const tubosPorNave = tubosPorMesada(ubicaciones, lotes);

  const tubosTotalGlobal = tubosPorNave.reduce((a: number, n: any) =>
    a + n.mesadas.filter((m: any) => m.sector_fase !== 'fase_1').reduce((s: number, m: any) => s + m.tubos_totales, 0), 0);
  const tubosOcupGlobal = tubosPorNave.reduce((a: number, n: any) =>
    a + n.mesadas.filter((m: any) => m.sector_fase !== 'fase_1').reduce((s: number, m: any) => s + m.tubos_ocupados, 0), 0);
  const ocPct = tubosTotalGlobal > 0 ? Math.round((tubosOcupGlobal / tubosTotalGlobal) * 100) : 0;

  function colorOc(pct: number) {
    return pct >= 75 ? '#059669' : pct >= 40 ? '#d97706' : '#9ca3af';
  }

  const ocupacionPorNave = tubosPorNave.map((n: any) => {
    const f2 = n.mesadas.filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round((ocu / tot) * 100) : 0 };
  });

  return (
    <>
      <Header user={user} current="ocupacion" />
      <div className="container">
        <h1 className="page-title">Ocupación</h1>
        <p className="page-subtitle">Tubos ocupados vs disponibles por mesada y por nave</p>

        {/* ===== SECCIÓN 1: OCUPACIÓN ACTUAL ===== */}
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px', color: '#374151' }}>
          Ocupación actual
        </h2>

        {/* KPIs grandes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: '#111827', borderRadius: '10px', padding: '18px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>Ocupación global</p>
            <p style={{ margin: '0 0 4px', fontSize: '36px', fontWeight: 800, color: 'white' }}>{ocPct}%</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>{tubosOcupGlobal.toLocaleString('es-AR')} / {tubosTotalGlobal.toLocaleString('es-AR')} tubos</p>
          </div>
          {ocupacionPorNave.map((n) => (
            <div key={n.nave} style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: `3px solid ${n.nave === 1 ? '#881337' : '#7c3aed'}`, borderRadius: '10px', padding: '18px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>
                <span style={{ background: n.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 7px', borderRadius: '4px', fontSize: '10px', marginRight: '6px' }}>N{n.nave}</span>
                Ocupación
              </p>
              <p style={{ margin: '0 0 4px', fontSize: '36px', fontWeight: 800, color: colorOc(n.pct) }}>{n.pct}%</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>mesadas F2</p>
            </div>
          ))}
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '18px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>Tubos libres</p>
            <p style={{ margin: '0 0 4px', fontSize: '36px', fontWeight: 800, color: '#059669' }}>{(tubosTotalGlobal - tubosOcupGlobal).toLocaleString('es-AR')}</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>disponibles</p>
          </div>
        </div>

        {/* Tabla de tubos por nave */}
        {tubosPorNave.map((nave: any) => (
          <div key={nave.nave} className="card" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ background: nave.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '2px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>
                  NAVE {nave.nave}
                </span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {nave.mesadas.filter((m:any)=>m.sector_fase!=='fase_1').reduce((s:number,m:any)=>s+m.tubos_ocupados,0).toLocaleString('es-AR')} / {nave.mesadas.filter((m:any)=>m.sector_fase!=='fase_1').reduce((s:number,m:any)=>s+m.tubos_totales,0).toLocaleString('es-AR')} tubos
                </span>
              </div>
              <div style={{ width: '100px', height: '5px', background: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: (() => { const f2=nave.mesadas.filter((m:any)=>m.sector_fase!=='fase_1'); const tot=f2.reduce((s:number,m:any)=>s+m.tubos_totales,0); const ocu=f2.reduce((s:number,m:any)=>s+m.tubos_ocupados,0); return Math.min(100,tot>0?Math.round(ocu/tot*100):0); })()+'%', height: '100%', background: nave.nave === 1 ? '#881337' : '#7c3aed' }} />
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Mesada</th>
                  <th style={{ textAlign: 'right' }}>Tubos totales</th>
                  <th style={{ textAlign: 'right' }}>Ocupados</th>
                  <th style={{ textAlign: 'right' }}>Libres</th>
                  <th style={{ textAlign: 'right' }}>Uso</th>
                  <th style={{ textAlign: 'right' }}>Lotes</th>
                </tr>
              </thead>
              <tbody>
                {nave.mesadas.filter((m: any) => m.sector_fase !== 'fase_1').map((m: any) => (
                  <tr key={m.id_ubicacion}>
                    <td style={{ fontWeight: 500, fontSize: '13px' }}>
                      <Link
                        href={`/cultivos?nave=${m.nave}&mesada=${encodeURIComponent(m.nombre)}`}
                        style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dashed #d1d5db' }}
                        title={`Ver lotes activos en ${m.nombre}`}
                      >
                        {m.nombre.replace(/^Nave \d+ - /, '')}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right' }}>{m.tubos_totales.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{m.tubos_ocupados.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', color: m.tubos_libres > 0 ? '#059669' : '#9ca3af', fontWeight: 500 }}>
                      {m.tubos_libres.toLocaleString('es-AR')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                        <div style={{ width: '50px', height: '4px', background: '#f3f4f6', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: Math.min(100, m.ocupacion_pct) + '%', height: '100%', background: colorOc(m.ocupacion_pct) }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: colorOc(m.ocupacion_pct), minWidth: '30px', textAlign: 'right' }}>
                          {m.ocupacion_pct}%
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', color: '#9ca3af', fontSize: '12px' }}>{m.lotes_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* ===== SECCIÓN 2: HISTORIAL DE OCUPACIÓN ===== */}
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '24px 0 12px', color: '#374151' }}>
          Historial de ocupación
        </h2>
        <p style={{ fontSize: '12px', color: '#6b7280', margin: '-8px 0 14px' }}>
          % de tubos/agujeros ocupados por mesada · últimos 3 meses
        </p>
        <div className="card" style={{ marginBottom: '14px' }}>
          <GraficoOcupacionHistorial mesadas={ocupacionHistorial} fechas={fechasHist} nave={1} />
        </div>
        <div className="card" style={{ marginBottom: '14px' }}>
          <GraficoOcupacionHistorial mesadas={ocupacionHistorial} fechas={fechasHist} nave={2} />
        </div>

      </div>
    </>
  );
}
