import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase } from '@/lib/lotes';
import { calcularCapacidadProductiva, resumenCiclosPorCultivoYNave } from '@/lib/capacidadProductiva';
import { calcularCamara, diferenciaAjustesMes } from '@/lib/camara';
import { calcularDriversMes, calcularUsoTeorico } from '@/lib/usoTeorico';
import { ocupacionPromedioPorNave, type OcupacionHistorialRow } from '@/lib/ocupacion';
import { productividadPorSemana } from '@/lib/productividad';
import { getRegistrosCrossChex, type RegistroCrossChex } from '@/lib/crosschex';
import { evolucionVentaPorArticulo, evolucionVentaPorCliente, evolucionPrecioPromedio } from '@/lib/estadisticasVentas';
import type { Lote, Movimiento, Ubicacion, VentaDia, ClienteVenta, PrecioVenta, VentaHistorica, Articulo, StockMes, StockCamara } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from '../GraficoEvolucion';
import GraficoPesaje from '../GraficoPesaje';
import { GraficoVentaPorArticulo, GraficoVentaPorCliente, GraficoPrecioPromedio } from '@/app/ventas/VentasEvolucionCharts';
export const dynamic = 'force-dynamic';

const esRuculaV = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
const esCrespaV = (v: string) => String(v || '').toLowerCase().includes('crespa');

// Buckets fijos de 30 días (diarios) y 180 días (semanales) — mismo criterio que el
// filtro global de Estadísticas, pero acá el análisis mensual siempre usa estas dos
// ventanas puntuales, no un selector.
function buckets30(hoy: Date) {
  const nBuckets = 30;
  const start = new Date(hoy); start.setDate(start.getDate() - (nBuckets - 1)); start.setHours(0, 0, 0, 0);
  const bucketDe = (f: Date) => { const idx = Math.floor((f.getTime() - start.getTime()) / 86400000); return idx >= 0 && idx < nBuckets ? idx : -1; };
  const labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return `${d.getDate()}/${d.getMonth() + 1}`; });
  return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
}
function buckets180(hoy: Date) {
  const nBuckets = 26;
  const start = new Date(hoy); start.setDate(start.getDate() - 7 * (nBuckets - 1)); start.setHours(0, 0, 0, 0);
  const bucketDe = (f: Date) => { const idx = Math.floor((f.getTime() - start.getTime()) / (7 * 86400000)); return idx >= 0 && idx < nBuckets ? idx : -1; };
  const labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return `${d.getDate()}/${d.getMonth() + 1}`; });
  return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
}
type Buckets = ReturnType<typeof buckets30>;

function evolucionCiclos(lotes: Lote[], movimientos: Movimiento[], b: Buckets) {
  const acc = {
    lechugaCrespa: Array.from({ length: b.nBuckets }, () => [] as number[]),
    lechugaRoble: Array.from({ length: b.nBuckets }, () => [] as number[]),
    rucula: Array.from({ length: b.nBuckets }, () => [] as number[]),
  };
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const idx = b.bucketDe(f); if (idx < 0) continue;
    let f2 = 0; try { f2 = calcularDiasPorFase(l, movimientos).fase_2; } catch {}
    if (f2 <= 0) continue;
    if (esRuculaV(l.variedad)) acc.rucula[idx].push(f2);
    else (esCrespaV(l.variedad) ? acc.lechugaCrespa : acc.lechugaRoble)[idx].push(f2);
  }
  const avgArr = (a: number[][]) => a.map(xs => xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);
  const lechCrespa = avgArr(acc.lechugaCrespa), lechRoble = avgArr(acc.lechugaRoble), ruc = avgArr(acc.rucula);
  return {
    series: [
      { nombre: 'Lechuga Crespa F2', color: '#84cc16', puntos: lechCrespa.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Lechuga Roble F2', color: '#4d7c0f', puntos: lechRoble.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Rúcula F2', color: '#134e4a', puntos: ruc.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ],
    labels: b.labels, hoyIdx: b.hoyIdx,
  };
}

function evolucionPlantasPorPaquete(lotes: Lote[], b: Buckets) {
  const acc: number[][] = Array.from({ length: b.nBuckets }, () => []);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha || !esRuculaV(l.variedad)) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const idx = b.bucketDe(f); if (idx < 0) continue;
    const ppu = Number(l.plantas_por_unidad_real);
    if (!(ppu > 1)) continue;
    acc[idx].push(ppu);
  }
  const serie = acc.map(xs => xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : 0);
  return { series: [{ nombre: 'Rúcula', color: '#134e4a', puntos: serie.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) }], labels: b.labels, hoyIdx: b.hoyIdx };
}

function evolucionDescartes(lotes: Lote[], b: Buckets) {
  const accCrespa: number[] = Array.from({ length: b.nBuckets }, () => 0);
  const accRoble: number[] = Array.from({ length: b.nBuckets }, () => 0);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha || esRuculaV(l.variedad)) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const idx = b.bucketDe(f); if (idx < 0) continue;
    const desc = Number(l.descarte_reportado) || 0;
    if (desc <= 0) continue;
    (esCrespaV(l.variedad) ? accCrespa : accRoble)[idx] += desc;
  }
  return {
    series: [
      { nombre: 'Lechuga Crespa', color: '#84cc16', puntos: accCrespa.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Lechuga Roble', color: '#4d7c0f', puntos: accRoble.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ],
    labels: b.labels, hoyIdx: b.hoyIdx,
  };
}

const cardStyle: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', marginBottom: '14px' };
const tituloSeccion: React.CSSProperties = { fontSize: '16px', fontWeight: 800, margin: '28px 0 12px', color: '#111827', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' };
const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

export default async function AnalisisMensualPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let ventas: VentaDia[] = [], clientes: ClienteVenta[] = [], precios: PrecioVenta[] = [], historicas: VentaHistorica[] = [];
  let articulos: Articulo[] = [], stocks: StockMes[] = [], registrosCamara: StockCamara[] = [];
  let ocupHistRows: OcupacionHistorialRow[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones, ventas, clientes, precios, historicas, articulos, stocks, registrosCamara] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
      readSheet<VentaDia>('Ventas'), readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<PrecioVenta>('Precios').catch(() => []), readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
      readSheet<Articulo>('Articulos'), readSheet<StockMes>('Stocks'),
      readSheet<StockCamara>('StockCamara').catch(() => []),
    ]);
    ocupHistRows = await readSheet<OcupacionHistorialRow>('OcupacionHistorial').catch(() => []);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const b30 = buckets30(hoy), b180 = buckets180(hoy);

  // ── 1. VENTAS ──
  const evolArticulo = evolucionVentaPorArticulo(ventas, 12, historicas);
  const evolClienteMensual = evolucionVentaPorCliente(ventas, clientes, 6, 6);
  const evolPrecio = evolucionPrecioPromedio(ventas, precios, clientes, 12);

  // ── 2. PRODUCCIÓN ──
  const evoCiclos30 = evolucionCiclos(lotes, movimientos, b30);
  const evoCiclos180 = evolucionCiclos(lotes, movimientos, b180);
  const evoPlantasPaq30 = evolucionPlantasPorPaquete(lotes, b30);
  const evoDescartes30 = evolucionDescartes(lotes, b30);

  // Pesaje testigo — últimos 180 días (sin buckets, son puntos individuales de cosecha)
  const hace180 = new Date(hoy); hace180.setDate(hace180.getDate() - 180);
  const puntosPesaje180 = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha && (Number(l.peso_muestra_paquete_gr) > 0 || Number(l.peso_muestra_kg) > 0))
    .filter(l => { const f = new Date(String(l.fecha_cosecha) + 'T12:00:00'); return !isNaN(f.getTime()) && f >= hace180; })
    .map(l => ({
      fecha: String(l.fecha_cosecha), variedad: l.variedad,
      peso_gr: Number(l.peso_muestra_paquete_gr) > 0 ? Number(l.peso_muestra_paquete_gr) : Math.round(Number(l.peso_muestra_kg) * 1000),
      paquetes: Number(l.unidades_cosechadas) || 0,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Productividad semanal — últimas 12 semanas, un solo fetch a CrossChex para todo el rango.
  let productividadSemanal: ReturnType<typeof productividadPorSemana> = [];
  try {
    const NSEM = 12;
    const desde = new Date(hoy); desde.setDate(desde.getDate() - 7 * NSEM);
    const pad = (n: number) => String(n).padStart(2, '0');
    const isoDesde = `${desde.getFullYear()}-${pad(desde.getMonth() + 1)}-${pad(desde.getDate())}T00:00:00-03:00`;
    const isoHasta = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}T23:59:59-03:00`;
    const registros: RegistroCrossChex[] = await getRegistrosCrossChex(isoDesde, isoHasta);
    productividadSemanal = productividadPorSemana(lotes, registros, NSEM);
  } catch {}
  const evoProductividad = {
    series: [{ nombre: 'Paquetes/hora-hombre', color: '#2563eb', puntos: productividadSemanal.map((p, i) => [i, p.productividad ?? 0] as [number, number]).filter(p => p[1] > 0) }],
    labels: productividadSemanal.map(p => p.semanaLabel), hoyIdx: productividadSemanal.length - 1,
  };

  // Ciclos promedio por mesada — solo resumen por cultivo y nave (año actual)
  const capProd = calcularCapacidadProductiva(lotes, movimientos, ubicaciones, 'anio', 'todas');
  const resumenCiclos = resumenCiclosPorCultivoYNave(capProd.ciclosMesadas);

  // Ocupación promedio últimos 30 días por nave
  const ocupacionProm30 = ocupacionPromedioPorNave(ocupHistRows, 30);

  // ── 3. STOCKS ──
  const camaraRucula = calcularCamara('rucula', registrosCamara, lotes, ventas);
  const camaraLechugaCrespa = calcularCamara('lechuga_crespa', registrosCamara, lotes, ventas);
  const camaraLechugaRoble = calcularCamara('lechuga_roble', registrosCamara, lotes, ventas);
  const faltanteRucula = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventas, hoy);
  const faltanteCrespa = diferenciaAjustesMes('lechuga_crespa', registrosCamara, lotes, ventas, hoy);
  const faltanteRoble = diferenciaAjustesMes('lechuga_roble', registrosCamara, lotes, ventas, hoy);
  const faltantesStock = [
    { label: 'Rúcula', color: '#134e4a', actual: camaraRucula.stockActual, ajusteMes: faltanteRucula.acumulado },
    { label: 'Lechuga Crespa', color: '#84cc16', actual: camaraLechugaCrespa.stockActual, ajusteMes: faltanteCrespa.acumulado },
    { label: 'Lechuga Roble', color: '#4d7c0f', actual: camaraLechugaRoble.stockActual, ajusteMes: faltanteRoble.acumulado },
  ];

  // Uso real vs. uso teórico — Bolsas (Packaging), Semillas y Espuma Fenólica
  const driversActual = calcularDriversMes(lotes, ventas, precios, clientes, hoy.getFullYear(), hoy.getMonth() + 1);
  const catMatch = (cat: string, kw: string) => String(cat || '').toLowerCase().includes(kw);
  const gruposUso = [
    { titulo: 'Bolsas (Packaging)', kw: 'packaging' },
    { titulo: 'Semillas', kw: 'semilla' },
    { titulo: 'Espuma Fenólica', kw: 'espuma' },
  ].map(({ titulo, kw }) => {
    const arts = articulos.filter(a => a.activo === 'SI' && catMatch(a.categoria, kw));
    const filas = arts.map(art => {
      const stockRow = stocks.find(s => s.id_articulo === art.id_articulo && String(s.anio) === String(hoy.getFullYear()) && String(s.mes) === String(hoy.getMonth() + 1));
      const usoReal = stockRow ? Number(stockRow.uso_calculado) || 0 : null;
      const usoTeorico = art.formula_uso ? calcularUsoTeorico(art.formula_uso, Number(art.factor_uso) || 0, driversActual) : null;
      const diff = usoReal !== null && usoTeorico !== null ? usoReal - usoTeorico : null;
      return { articulo: art.articulo, unidad: art.unidad_medida, usoReal, usoTeorico, diff };
    }).filter(f => f.usoReal !== null || f.usoTeorico !== null);
    return { titulo, filas };
  }).filter(g => g.filas.length > 0);

  const nombre = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Análisis mensual</h1>
            <p className="page-subtitle">{nombre} · pensado para ver acá y copiar/pegar en un mail</p>
          </div>
          <Link href="/estadisticas" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>← Volver a Estadísticas</Link>
        </div>

        {/* ══ 1. VENTAS ══ */}
        <h2 style={tituloSeccion}>1. Ventas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <GraficoVentaPorArticulo datos={evolArticulo} />
          <GraficoVentaPorCliente mensual={evolClienteMensual} ocultarToggle />
        </div>
        <GraficoPrecioPromedio datos={evolPrecio} />

        {/* ══ 2. PRODUCCIÓN ══ */}
        <h2 style={tituloSeccion}>2. Producción</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Evolución de ciclo — últimos 30 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Días F2 promedio, por día</p>
            <GraficoEvolucion series={evoCiclos30.series} labels={evoCiclos30.labels} hoyIdx={evoCiclos30.hoyIdx} />
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Evolución de ciclo — últimos 180 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Días F2 promedio, por semana</p>
            <GraficoEvolucion series={evoCiclos180.series} labels={evoCiclos180.labels} hoyIdx={evoCiclos180.hoyIdx} />
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Productividad — paquetes / hora-hombre</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Por semana · últimas 12 semanas</p>
            {evoProductividad.series[0].puntos.length > 0
              ? <GraficoEvolucion series={evoProductividad.series} labels={evoProductividad.labels} hoyIdx={evoProductividad.hoyIdx} unidad=" paq/h" />
              : <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin datos de CrossChex disponibles para este período.</p>}
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Evolución de pesaje testigo — últimos 180 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Gramos por paquete</p>
            <GraficoPesaje puntos={puntosPesaje180} />
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Plantas por paquete — últimos 30 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Rúcula · promedio</p>
            <GraficoEvolucion series={evoPlantasPaq30.series} labels={evoPlantasPaq30.labels} hoyIdx={evoPlantasPaq30.hoyIdx} unidad=" pl/paq" yMin={1} yMax={4} />
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Descartes Lechuga — últimos 30 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Plantas de diferencia entre lo estimado y lo cosechado</p>
            <GraficoEvolucion series={evoDescartes30.series} labels={evoDescartes30.labels} hoyIdx={evoDescartes30.hoyIdx} unidad=" pl" />
          </div>
        </div>

        <div style={cardStyle}>
          <p className="card-title" style={{ margin: '0 0 10px' }}>Ciclos promedio por mesada — resumen por cultivo y nave</p>
          {resumenCiclos.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin datos de cosechas registradas.</p>
          ) : resumenCiclos.map(rc => (
            <div key={rc.cultivo} style={{ marginBottom: '14px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 700, color: rc.cultivo === 'Lechuga' ? '#4d7c0f' : '#166534' }}>
                {rc.cultivo === 'Lechuga' ? '🥬' : '🌿'} {rc.cultivo}
              </p>
              <table style={{ fontSize: '12px', width: '100%', maxWidth: '560px' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Nave</th>
                  {rc.cultivo === 'Lechuga' && <th style={{ textAlign: 'right' }}>F1 prom.</th>}
                  <th style={{ textAlign: 'right' }}>Ciclo F2 prom.</th>
                  <th style={{ textAlign: 'right' }}>Días totales</th>
                  <th style={{ textAlign: 'right' }}>Plantas/paq.</th>
                  <th style={{ textAlign: 'right' }}>Peso prom.</th>
                  <th style={{ textAlign: 'right', color: '#9ca3af' }}>N cosechas</th>
                </tr></thead>
                <tbody>
                  {rc.porNave.map(n => (
                    <tr key={n.nave} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td><span style={{ background: n.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>N{n.nave}</span></td>
                      {rc.cultivo === 'Lechuga' && <td style={{ textAlign: 'right' }}>{n.f1 > 0 ? n.f1 + 'd' : '—'}</td>}
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{n.f2 > 0 ? n.f2 + 'd' : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{n.total > 0 ? n.total + 'd' : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{n.plantasPorPaq > 0 ? n.plantasPorPaq : '—'}</td>
                      <td style={{ textAlign: 'right', color: '#ea580c' }}>{n.peso > 0 ? n.peso + 'g' : '—'}</td>
                      <td style={{ textAlign: 'right', color: '#9ca3af' }}>{n.n}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td>Total {rc.cultivo}</td>
                    {rc.cultivo === 'Lechuga' && <td style={{ textAlign: 'right' }}>{rc.total.f1 > 0 ? rc.total.f1 + 'd' : '—'}</td>}
                    <td style={{ textAlign: 'right' }}>{rc.total.f2 > 0 ? rc.total.f2 + 'd' : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{rc.total.total > 0 ? rc.total.total + 'd' : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{rc.total.plantasPorPaq > 0 ? rc.total.plantasPorPaq : '—'}</td>
                    <td style={{ textAlign: 'right', color: '#ea580c' }}>{rc.total.peso > 0 ? rc.total.peso + 'g' : '—'}</td>
                    <td style={{ textAlign: 'right', color: '#9ca3af' }}>{rc.total.n}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <p className="card-title" style={{ margin: '0 0 10px' }}>Historial de ocupación — promedio últimos 30 días por nave</p>
          {ocupacionProm30.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin historial de ocupación registrado todavía.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              {ocupacionProm30.map(n => (
                <div key={n.nave} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: `3px solid ${n.nave === 1 ? '#881337' : '#7c3aed'}`, borderRadius: '8px', padding: '14px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Nave {n.nave}</p>
                  <p style={{ margin: 0, fontSize: '30px', fontWeight: 800, color: '#111827' }}>{n.pctPromedio}%</p>
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#9ca3af' }}>{n.diasConDato} días con dato</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ══ 3. STOCKS ══ */}
        <h2 style={tituloSeccion}>3. Stocks</h2>
        <div style={cardStyle}>
          <p className="card-title" style={{ margin: '0 0 10px' }}>Faltante de stock de plantas por cultivo — {nombre}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            {faltantesStock.map(c => (
              <div key={c.label} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: `3px solid ${c.color}`, borderRadius: '8px', padding: '14px' }}>
                <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: c.color, textTransform: 'uppercase' }}>{c.label}</p>
                <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>Stock actual: <strong style={{ color: '#111827' }}>{c.actual} paq</strong></p>
                <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 800, color: c.ajusteMes < 0 ? '#dc2626' : c.ajusteMes > 0 ? '#059669' : '#9ca3af' }}>
                  {c.ajusteMes >= 0 ? '+' : ''}{c.ajusteMes} paq
                </p>
                <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>diferencia acumulada del mes</p>
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <p className="card-title" style={{ margin: '0 0 10px' }}>Uso real vs. uso teórico — {nombre}</p>
          {gruposUso.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin artículos con datos este mes en estas categorías.</p>
          ) : gruposUso.map(g => (
            <div key={g.titulo} style={{ marginBottom: '14px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 700, color: '#374151' }}>{g.titulo}</p>
              <table style={{ fontSize: '12px', width: '100%', maxWidth: '560px' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Artículo</th>
                  <th style={{ textAlign: 'right' }}>Uso real</th>
                  <th style={{ textAlign: 'right' }}>Uso teórico</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                </tr></thead>
                <tbody>
                  {g.filas.map(f => (
                    <tr key={f.articulo} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td>{f.articulo} <span style={{ color: '#9ca3af', fontSize: '10px' }}>{f.unidad}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>{f.usoReal !== null ? fmt(f.usoReal) : '—'}</td>
                      <td style={{ textAlign: 'right', color: '#6b7280' }}>{f.usoTeorico !== null ? fmt(f.usoTeorico) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: f.diff === null ? '#9ca3af' : f.diff > 0 ? '#dc2626' : '#059669' }}>
                        {f.diff !== null ? `${f.diff > 0 ? '+' : ''}${fmt(f.diff)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
