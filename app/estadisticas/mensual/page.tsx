import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase } from '@/lib/lotes';
import { calcularCapacidadProductiva, resumenCiclosPorCultivoYNave } from '@/lib/capacidadProductiva';
import { calcularCamara, diferenciaAjustesMes } from '@/lib/camara';
import { calcularDriversMes, calcularUsoTeorico } from '@/lib/usoTeorico';
import { ocupacionPromedioPorNave, type OcupacionHistorialRow } from '@/lib/ocupacion';
import { productividadDeMes, productividadPlantasDeMes } from '@/lib/productividad';
import { ocupacionMensualPorCultivo, eficienciaSiembraCosechaPorMes, plantasPerdidasPorSubocupacion } from '@/lib/kpisOperativos';
import { cicloMesPromedio } from '@/lib/estadisticas';
import { evolucionVentaPorArticulo, evolucionVentaPorCliente, evolucionPrecioPromedio } from '@/lib/estadisticasVentas';
import type { Lote, Movimiento, Ubicacion, VentaDia, ClienteVenta, PrecioVenta, VentaHistorica, Articulo, StockMes, StockCamara, ProductividadDiaria } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from '../GraficoEvolucion';
import GraficoPesaje from '../GraficoPesaje';
import { GraficoVentaPorArticulo, GraficoVentaPorCliente, GraficoPrecioPromedio } from '@/app/ventas/VentasEvolucionCharts';
import CopiarInformeBoton from './CopiarInformeBoton';
export const dynamic = 'force-dynamic';

const esRuculaV = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
const esCrespaV = (v: string) => String(v || '').toLowerCase().includes('crespa');
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Buckets fijos de 30 días (diarios) y 180 días (mensuales — 180 días son ~6 meses,
// semana a semana queda ilegible), anclados al final del período seleccionado (no
// siempre "hoy") — así al elegir un mes pasado, las ventanas cuentan para atrás desde
// el cierre de ESE mes, sin asomar datos de meses posteriores.
function buckets30(hasta: Date) {
  const nBuckets = 30;
  const start = new Date(hasta); start.setDate(start.getDate() - (nBuckets - 1)); start.setHours(0, 0, 0, 0);
  const bucketDe = (f: Date) => { const idx = Math.floor((f.getTime() - start.getTime()) / 86400000); return idx >= 0 && idx < nBuckets ? idx : -1; };
  const labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return `${d.getDate()}/${d.getMonth() + 1}`; });
  return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
}
function buckets180(hasta: Date) {
  const nBuckets = 6; // ~180 días en meses
  const inicioMes0 = hasta.getMonth() - (nBuckets - 1);
  const startYear = hasta.getFullYear() + Math.floor(inicioMes0 / 12);
  const startMonth = ((inicioMes0 % 12) + 12) % 12;
  const bucketDe = (f: Date) => (f.getFullYear() - startYear) * 12 + (f.getMonth() - startMonth);
  const labels = Array.from({ length: nBuckets }, (_, i) => {
    const m = (startMonth + i) % 12, y = startYear + Math.floor((startMonth + i) / 12);
    return `${MESES_CORTO[m]} ${String(y).slice(2)}`;
  });
  // "YYYY-MM" por bucket, para poder armar una fecha sintética ordenable/agrupable en
  // otros cálculos que agregan por este mismo bucket (ver puntosPesaje180).
  const mesesISO = Array.from({ length: nBuckets }, (_, i) => {
    const m = (startMonth + i) % 12, y = startYear + Math.floor((startMonth + i) / 12);
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  });
  return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe, mesesISO };
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

// Unidades vendidas por cliente en el mes seleccionado, con variación % vs. el mes
// anterior y % que representa sobre el total vendido ese mes — para el cuadro que
// acompaña a "Evolución de precio promedio".
const PROD_KEYS_CLI = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;
function totalVenta(v: VentaDia): number { return PROD_KEYS_CLI.reduce((a, k) => a + (Number((v as any)[k]) || 0), 0); }
function sumaPorClienteEnMes(ventas: VentaDia[], anio: number, mes: number): Map<string, number> {
  const mk = `${anio}-${String(mes).padStart(2, '0')}`;
  const map = new Map<string, number>();
  for (const v of ventas) {
    if (String(v.fecha || '').slice(0, 7) !== mk) continue;
    const t = totalVenta(v); if (t <= 0) continue;
    map.set(v.id_control, (map.get(v.id_control) || 0) + t);
  }
  return map;
}
function clientesMesConVariacion(ventas: VentaDia[], clientes: ClienteVenta[], anio: number, mes: number, topN = 8) {
  let mesPrev = mes - 1, anioPrev = anio; if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
  const actual = sumaPorClienteEnMes(ventas, anio, mes);
  const pasado = sumaPorClienteEnMes(ventas, anioPrev, mesPrev);
  const nombreMap = new Map(clientes.map(c => [c.id_control, c.nombre_display || c.nombre_xubio || c.id_control]));
  const totalMes = Array.from(actual.values()).reduce((a, b) => a + b, 0);
  const filas = Array.from(actual.entries()).map(([id_control, total]) => {
    const prev = pasado.get(id_control) || 0;
    const variacionPct = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null;
    const pctTotal = totalMes > 0 ? Math.round((total / totalMes) * 100) : 0;
    return { id_control, nombre: nombreMap.get(id_control) || id_control, total, variacionPct, pctTotal };
  }).sort((a, b) => b.total - a.total).slice(0, topN);
  return { filas, totalMes };
}

const cardStyle: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', marginBottom: '14px' };
const tituloSeccion: React.CSSProperties = { fontSize: '16px', fontWeight: 800, margin: '28px 0 12px', color: '#111827', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' };
const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

export default async function AnalisisMensualPage({ searchParams }: { searchParams: { anio?: string; mes?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let ventas: VentaDia[] = [], clientes: ClienteVenta[] = [], precios: PrecioVenta[] = [], historicas: VentaHistorica[] = [];
  let articulos: Articulo[] = [], stocks: StockMes[] = [], registrosCamara: StockCamara[] = [];
  let ocupHistRows: OcupacionHistorialRow[] = [];
  let productividadCache: ProductividadDiaria[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones, ventas, clientes, precios, historicas, articulos, stocks, registrosCamara, productividadCache] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
      readSheet<VentaDia>('Ventas'), readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<PrecioVenta>('Precios').catch(() => []), readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
      readSheet<Articulo>('Articulos'), readSheet<StockMes>('Stocks'),
      readSheet<StockCamara>('StockCamara').catch(() => []),
      readSheet<ProductividadDiaria>('ProductividadDiaria').catch(() => []),
    ]);
    ocupHistRows = await readSheet<OcupacionHistorialRow>('OcupacionHistorial').catch(() => []);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  // ── Mes seleccionado — por defecto el actual. Si se elige un mes pasado, todo el
  // análisis (ventanas de 30/180 días, ventas, stocks) se calcula "hasta el cierre de
  // ese mes", sin mostrar nada de meses posteriores. ──
  const hoy = new Date();
  const anioSel = Number(searchParams.anio) || hoy.getFullYear();
  const mesSel = Number(searchParams.mes) || (hoy.getMonth() + 1);
  const esMesActual = anioSel === hoy.getFullYear() && mesSel === (hoy.getMonth() + 1);
  const finMesSel = new Date(anioSel, mesSel, 0, 23, 59, 59);
  const refDate = esMesActual ? hoy : finMesSel;

  let mesAnteriorNav = mesSel - 1, anioAnteriorNav = anioSel;
  if (mesAnteriorNav === 0) { mesAnteriorNav = 12; anioAnteriorNav--; }
  let mesSiguienteNav = mesSel + 1, anioSiguienteNav = anioSel;
  if (mesSiguienteNav === 13) { mesSiguienteNav = 1; anioSiguienteNav++; }
  const haySiguiente = anioSiguienteNav < hoy.getFullYear() || (anioSiguienteNav === hoy.getFullYear() && mesSiguienteNav <= hoy.getMonth() + 1);
  const hrefMes = (a: number, m: number) => `/estadisticas/mensual?anio=${a}&mes=${m}`;

  const nombre = `${MESES_LARGO[mesSel - 1]} ${anioSel}`.replace(/^./, c => c.toUpperCase());

  // Lotes/ventas "hasta el cierre del mes seleccionado" — se filtran acá una sola vez y
  // se reutilizan en todos los cálculos de abajo, así ningún gráfico se asoma a datos de
  // meses posteriores al elegido.
  const lotesRep = lotes.filter(l => l.estado !== 'cosechado' || !l.fecha_cosecha || (() => {
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00'); return isNaN(f.getTime()) || f <= refDate;
  })());
  const ventasRep = ventas.filter(v => {
    const f = new Date(String(v.fecha || '').split(/[T ]/)[0] + 'T12:00:00');
    return isNaN(f.getTime()) || f <= refDate;
  });

  const b30 = buckets30(refDate), b180 = buckets180(refDate);

  // ── 1. VENTAS ──
  const evolArticulo = evolucionVentaPorArticulo(ventasRep, 12, historicas);
  const evolClienteMensual = evolucionVentaPorCliente(ventasRep, clientes, 6, 6);
  const evolPrecio = evolucionPrecioPromedio(ventasRep, precios, clientes, 12);
  const clientesMes = clientesMesConVariacion(ventas, clientes, anioSel, mesSel, 8);

  // ── 2. PRODUCCIÓN ──
  const evoCiclos30 = evolucionCiclos(lotesRep, movimientos, b30);
  const evoCiclos180 = evolucionCiclos(lotesRep, movimientos, b180);
  const evoPlantasPaq30 = evolucionPlantasPorPaquete(lotesRep, b30);
  const evoDescartes30 = evolucionDescartes(lotesRep, b30);

  // Pesaje testigo — últimos 180 días hasta el cierre del mes elegido, agregado POR MES
  // (b180 arma 6 buckets mensuales) — antes era un punto por cosecha individual, que con
  // 180 días de datos quedaba ilegible; ahora es un promedio por mes y cultivo. La fecha
  // sintética de cada punto es "YYYY-MM" (mesesISO del bucket), no una cosecha real — así
  // GraficoPesaje (que agrupa/ordena por fecha exacta) colapsa cada bucket a un único punto.
  const puntosPesaje180 = (() => {
    const esRuculaPeso = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
    const acc = new Map<string, number[]>(); // key = `${bucketIdx}|${cultivo}`
    for (const l of lotesRep) {
      if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
      if (!(Number(l.peso_muestra_paquete_gr) > 0 || Number(l.peso_muestra_kg) > 0)) continue;
      const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
      if (isNaN(f.getTime())) continue;
      const idx = b180.bucketDe(f);
      if (idx < 0 || idx >= b180.nBuckets) continue;
      const cultivo = esRuculaPeso(l.variedad) ? 'rucula' : 'lechuga';
      const peso = Number(l.peso_muestra_paquete_gr) > 0 ? Number(l.peso_muestra_paquete_gr) : Math.round(Number(l.peso_muestra_kg) * 1000);
      const key = `${idx}|${cultivo}`;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key)!.push(peso);
    }
    const out: { fecha: string; variedad: string; peso_gr: number; paquetes: number }[] = [];
    for (const [key, pesos] of acc) {
      const [idxStr, cultivo] = key.split('|');
      const idx = Number(idxStr);
      out.push({
        fecha: b180.mesesISO[idx],
        variedad: cultivo === 'rucula' ? 'Rúcula' : 'Lechuga',
        peso_gr: Math.round(pesos.reduce((a, b) => a + b, 0) / pesos.length),
        paquetes: 0,
      });
    }
    return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  })();

  // Productividad por mes — últimos 12 meses hasta el cierre del mes elegido, sumada desde
  // la caché diaria ProductividadDiaria (ver lib/types.ts) en vez de pedirle a CrossChex en
  // vivo acá — CrossChex limita a 1 pedido cada 15 segundos, no da para pedirle 12 meses en
  // cada carga de esta página. La caché la carga /api/cron/productividad-diaria por día.
  const NMESES = 12;
  const mesesProd: { anio: number; mes: number; diaHasta?: number }[] = [];
  for (let i = NMESES - 1; i >= 0; i--) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    const esUltimoMes = d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth();
    mesesProd.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, diaHasta: esUltimoMes ? refDate.getDate() : undefined });
  }
  const productividadMensualRep = mesesProd.map(({ anio, mes, diaHasta }) => productividadDeMes(lotesRep, productividadCache, anio, mes, diaHasta));
  const productividadPlantasMensualRep = mesesProd.map(({ anio, mes, diaHasta }) => productividadPlantasDeMes(lotesRep, productividadCache, anio, mes, diaHasta));
  const evoProductividad = {
    series: [{ nombre: 'Paquetes/hora-hombre', color: '#2563eb', puntos: productividadMensualRep.map((p, i) => [i, p.productividad ?? 0] as [number, number]).filter(p => p[1] > 0) }],
    labels: productividadMensualRep.map(p => p.label), hoyIdx: productividadMensualRep.length - 1,
  };
  const evoProductividadPlantasRep = {
    series: [{ nombre: 'Plantas/hora-persona', color: '#7c3aed', puntos: productividadPlantasMensualRep.map((p, i) => [i, p.productividad ?? 0] as [number, number]).filter(p => p[1] > 0) }],
    labels: productividadPlantasMensualRep.map(p => p.label), hoyIdx: productividadPlantasMensualRep.length - 1,
  };
  const productividadPlantasUltimoMesRep = [...productividadPlantasMensualRep].reverse().find((p) => p.productividad !== null) ?? null;

  // ── KPI 1: Ocupación de posiciones — promedio mensual por cultivo, hasta el cierre del mes elegido ──
  const ocupacionMensualRep = ocupacionMensualPorCultivo(ocupHistRows, ubicaciones, 6, refDate);
  // Plantas perdidas por subocupación este mes — traduce tubos vacíos-día a plantas
  // usando el ciclo F2 ACTUAL del mes elegido como referencia (no un promedio fijo ni
  // un default): un tubo vacío durante todo un ciclo es una cosecha completa perdida.
  // Si el mes no tuvo ninguna cosecha de un cultivo (no hay ciclo real para ese mes),
  // cae a un ciclo de referencia razonable (35d rúcula / 40d lechuga) para no dejar el
  // cálculo en cero solo por falta de dato del ciclo.
  const cicloActualMesRep = cicloMesPromedio(lotesRep, movimientos, refDate);
  const finMesSelStr = new Date(anioSel, mesSel, 0);
  const plantasPerdidasSubocupacionMes = plantasPerdidasPorSubocupacion(
    ocupHistRows, ubicaciones,
    `${anioSel}-${String(mesSel).padStart(2, '0')}-01`,
    `${anioSel}-${String(mesSel).padStart(2, '0')}-${String(finMesSelStr.getDate()).padStart(2, '0')}`,
    cicloActualMesRep.rucula || 35, cicloActualMesRep.lechuga || 40,
  );
  const ocupacionUltimoMesRep = [...ocupacionMensualRep].reverse().find((m) => m.total.pct !== null) ?? null;
  const evoOcupacionCultivoRep = {
    series: [
      { nombre: 'Rúcula', color: '#134e4a', puntos: ocupacionMensualRep.map((m, i) => [i, m.rucula.pct] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) },
      { nombre: 'Lechuga', color: '#84cc16', puntos: ocupacionMensualRep.map((m, i) => [i, m.lechuga.pct] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) },
    ],
    labels: ocupacionMensualRep.map((m) => m.label), hoyIdx: ocupacionMensualRep.length - 1,
  };

  // ── KPI 2: Eficiencia Siembra → Cosecha — promedio mensual por cultivo, hasta el cierre del mes elegido ──
  const eficienciaMensualRep = eficienciaSiembraCosechaPorMes(lotesRep, 6, refDate);
  const eficienciaUltimoMesRep = (() => {
    for (let i = eficienciaMensualRep.length - 1; i >= 0; i--) {
      const m = eficienciaMensualRep[i];
      const vivaTot = m.rucula.viva + m.lechuga_crespa.viva + m.lechuga_roble.viva;
      const descarteTot = m.rucula.descarte + m.lechuga_crespa.descarte + m.lechuga_roble.descarte;
      const base = vivaTot + descarteTot;
      if (base > 0) return { mes: m, pctGlobal: Math.round((vivaTot / base) * 1000) / 10 };
    }
    return null;
  })();
  const evoEficienciaCultivoRep = {
    series: [
      { nombre: 'Rúcula', color: '#134e4a', puntos: eficienciaMensualRep.map((m, i) => [i, m.rucula.pct] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) },
      { nombre: 'Lechuga Crespa', color: '#84cc16', puntos: eficienciaMensualRep.map((m, i) => [i, m.lechuga_crespa.pct] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) },
      { nombre: 'Lechuga Roble', color: '#4d7c0f', puntos: eficienciaMensualRep.map((m, i) => [i, m.lechuga_roble.pct] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) },
    ],
    labels: eficienciaMensualRep.map((m) => m.label), hoyIdx: eficienciaMensualRep.length - 1,
  };

  // Ciclos promedio por mesada — solo resumen por cultivo y nave (año del mes elegido)
  const capProd = calcularCapacidadProductiva(lotesRep, movimientos, ubicaciones, 'anio', 'todas');
  const resumenCiclos = resumenCiclosPorCultivoYNave(capProd.ciclosMesadas);

  // Ocupación promedio 30 días por nave — sobre el historial diario (siempre relativo a
  // hoy: es un snapshot físico, no tiene sentido "rebobinarlo" a un mes viejo)
  const ocupacionProm30 = ocupacionPromedioPorNave(ocupHistRows, 30);

  // ── 3. STOCKS ──
  const camaraRucula = calcularCamara('rucula', registrosCamara, lotes, ventas);
  const camaraLechugaCrespa = calcularCamara('lechuga_crespa', registrosCamara, lotes, ventas);
  const camaraLechugaRoble = calcularCamara('lechuga_roble', registrosCamara, lotes, ventas);
  const faltanteRucula = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventas, refDate);
  const faltanteCrespa = diferenciaAjustesMes('lechuga_crespa', registrosCamara, lotes, ventas, refDate);
  const faltanteRoble = diferenciaAjustesMes('lechuga_roble', registrosCamara, lotes, ventas, refDate);
  const faltantesStock = [
    { label: 'Rúcula', color: '#134e4a', actual: camaraRucula.stockActual, ajusteMes: faltanteRucula.acumulado },
    { label: 'Lechuga Crespa', color: '#84cc16', actual: camaraLechugaCrespa.stockActual, ajusteMes: faltanteCrespa.acumulado },
    { label: 'Lechuga Roble', color: '#4d7c0f', actual: camaraLechugaRoble.stockActual, ajusteMes: faltanteRoble.acumulado },
  ];

  // Uso real vs. uso teórico — Bolsas (Packaging), Semillas y Espuma Fenólica, del MES
  // SELECCIONADO: toma el stock_inicial/compras/stock_final de esa fila puntual de
  // Stocks (anio/mes elegidos), no siempre el mes en curso.
  const driversMesSel = calcularDriversMes(lotes, ventas, precios, clientes, anioSel, mesSel);
  const catMatch = (cat: string, kw: string) => String(cat || '').toLowerCase().includes(kw);
  const gruposUso = [
    { titulo: 'Bolsas (Packaging)', kw: 'packaging' },
    { titulo: 'Semillas', kw: 'semilla' },
    { titulo: 'Espuma Fenólica', kw: 'espuma' },
  ].map(({ titulo, kw }) => {
    const arts = articulos.filter(a => a.activo === 'SI' && catMatch(a.categoria, kw));
    const filas = arts.map(art => {
      const stockRow = stocks.find(s => s.id_articulo === art.id_articulo && String(s.anio) === String(anioSel) && String(s.mes) === String(mesSel));
      const usoReal = stockRow ? Number(stockRow.uso_calculado) || 0 : null;
      const usoTeorico = art.formula_uso ? calcularUsoTeorico(art.formula_uso, Number(art.factor_uso) || 0, driversMesSel) : null;
      const diff = usoReal !== null && usoTeorico !== null ? usoReal - usoTeorico : null;
      return {
        articulo: art.articulo, unidad: art.unidad_medida, usoReal, usoTeorico, diff,
        detalle: stockRow ? `ini ${fmt(Number(stockRow.stock_inicial) || 0)} + compras ${fmt(Number(stockRow.compras) || 0)} − final ${fmt(Number(stockRow.stock_final) || 0)}` : null,
      };
    }).filter(f => f.usoReal !== null || f.usoTeorico !== null);
    return { titulo, filas };
  }).filter(g => g.filas.length > 0);

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Análisis mensual</h1>
            <p className="page-subtitle">pensado para ver acá y copiar/pegar en un mail</p>
          </div>
          <Link href="/estadisticas" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>← Volver a Estadísticas</Link>
        </div>

        {/* Selector de mes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0 4px' }}>
          <Link href={hrefMes(anioAnteriorNav, mesAnteriorNav)} className="btn secondary" style={{ fontSize: '13px', padding: '5px 12px' }}>‹ Mes anterior</Link>
          <span style={{ fontSize: '15px', fontWeight: 800, color: '#111827', minWidth: '160px', textAlign: 'center' }}>{nombre}</span>
          {haySiguiente
            ? <Link href={hrefMes(anioSiguienteNav, mesSiguienteNav)} className="btn secondary" style={{ fontSize: '13px', padding: '5px 12px' }}>Mes siguiente ›</Link>
            : <span className="btn secondary" style={{ fontSize: '13px', padding: '5px 12px', opacity: 0.4, cursor: 'not-allowed' }}>Mes siguiente ›</span>}
          {!esMesActual && <span style={{ fontSize: '11px', color: '#9ca3af' }}>(mes cerrado — no incluye datos posteriores)</span>}
        </div>

        <CopiarInformeBoton contenedorId="informe-contenido" />

        {/* Todo lo de acá para abajo es lo que copia el botón de arriba — ver
            CopiarInformeBoton: clona este div, convierte los gráficos SVG a imagen PNG
            (los mails no renderizan SVG de forma confiable) y lo manda al portapapeles
            como HTML enriquecido, para pegar directo en Gmail/Outlook con Ctrl+V. */}
        <div id="informe-contenido">

        {/* ══ INDICADORES OPERATIVOS MARCE — mismos 3 KPIs que en Estadísticas, acá
            recalculados hasta el cierre del mes elegido ══ */}
        <div style={{ background: 'linear-gradient(135deg, #1e293b, #0f172a)', borderRadius: '14px', padding: '20px 20px 22px', margin: '14px 0 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px' }}>KPIs de gestión — {nombre}</p>
              <h2 style={{ margin: '2px 0 0', fontSize: '22px', fontWeight: 900, color: 'white' }}>Indicadores Operativos Marce</h2>
            </div>
            <Link href="/produccion/puesto" style={{ fontSize: '12px', color: '#e2e8f0', textDecoration: 'underline', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Ver descripción completa del puesto →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div style={{ ...cardStyle, margin: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: '12.5px', fontWeight: 700 }}>1. Ocupación de posiciones</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>Objetivo: 95% promedio mensual, por cultivo</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                <strong style={{ fontSize: '28px', color: ocupacionUltimoMesRep?.total.pct !== null && ocupacionUltimoMesRep?.total.pct !== undefined ? (ocupacionUltimoMesRep.total.pct >= 95 ? '#059669' : '#d97706') : '#9ca3af' }}>
                  {ocupacionUltimoMesRep?.total.pct !== null && ocupacionUltimoMesRep?.total.pct !== undefined ? `${ocupacionUltimoMesRep.total.pct}%` : '—'}
                </strong>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>{ocupacionUltimoMesRep?.label ?? 'sin datos'}</span>
              </div>
              {ocupacionUltimoMesRep && (
                <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280' }}>
                  Rúcula {ocupacionUltimoMesRep.rucula.pct ?? '—'}% · Lechuga {ocupacionUltimoMesRep.lechuga.pct ?? '—'}%
                </p>
              )}
              {plantasPerdidasSubocupacionMes.total > 0 && (
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#b45309' }} title="Tubos vacíos del mes convertidos a plantas, usando el ciclo F2 actual de este mes como referencia — un tubo vacío durante todo un ciclo es una cosecha completa que no se hizo">
                  🌱 ~<strong>{plantasPerdidasSubocupacionMes.total.toLocaleString('es-AR')}</strong> plantas perdidas por subocupación este mes (Rúcula {plantasPerdidasSubocupacionMes.rucula.toLocaleString('es-AR')} · Lechuga {plantasPerdidasSubocupacionMes.lechuga.toLocaleString('es-AR')})
                </p>
              )}
              {evoOcupacionCultivoRep.series.some((s) => s.puntos.length > 0)
                ? <GraficoEvolucion series={evoOcupacionCultivoRep.series} labels={evoOcupacionCultivoRep.labels} hoyIdx={evoOcupacionCultivoRep.hoyIdx} unidad="%" yMin={0} yMax={100} />
                : <p style={{ color: '#9ca3af', fontSize: '12px', textAlign: 'center', padding: '16px' }}>Sin histórico de ocupación todavía.</p>}
              <Link href="/ocupacion" style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', fontWeight: 600, display: 'inline-block', marginTop: '8px' }}>Ver detalle en Ocupación →</Link>
            </div>

            <div style={{ ...cardStyle, margin: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: '12.5px', fontWeight: 700 }}>2. Eficiencia Siembra → Cosecha</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>% que llega vivo a cosecha, según descarte de las 3 etapas — sin ventas ni cámara. Sin objetivo fijado aún</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                <strong style={{ fontSize: '28px', color: '#111827' }}>{eficienciaUltimoMesRep ? `${eficienciaUltimoMesRep.pctGlobal}%` : '—'}</strong>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>{eficienciaUltimoMesRep?.mes.label ?? 'sin datos'}</span>
              </div>
              {eficienciaUltimoMesRep && (
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280' }}>
                  Rúcula {eficienciaUltimoMesRep.mes.rucula.pct ?? '—'}% · Crespa {eficienciaUltimoMesRep.mes.lechuga_crespa.pct ?? '—'}% · Roble {eficienciaUltimoMesRep.mes.lechuga_roble.pct ?? '—'}%
                </p>
              )}
              {evoEficienciaCultivoRep.series.some((s) => s.puntos.length > 0)
                ? <GraficoEvolucion series={evoEficienciaCultivoRep.series} labels={evoEficienciaCultivoRep.labels} hoyIdx={evoEficienciaCultivoRep.hoyIdx} unidad="%" yMin={0} yMax={100} />
                : <p style={{ color: '#9ca3af', fontSize: '12px', textAlign: 'center', padding: '16px' }}>Sin lotes cosechados en el período.</p>}
              <Link href="/estadisticas#descarte-por-fase" style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', fontWeight: 600, display: 'inline-block', marginTop: '8px' }}>Ver desglose de descarte por fase →</Link>
            </div>

            <div style={{ ...cardStyle, margin: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: '12.5px', fontWeight: 700 }}>3. Productividad de empleados</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>Plantas cosechadas al mes por hora-persona total. En medición — sin objetivo aún</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                <strong style={{ fontSize: '28px', color: '#111827' }}>{productividadPlantasUltimoMesRep ? productividadPlantasUltimoMesRep.productividad!.toLocaleString('es-AR') : '—'}</strong>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>pl/h · {productividadPlantasUltimoMesRep?.label ?? 'sin datos'}</span>
              </div>
              {evoProductividadPlantasRep.series[0].puntos.length > 0
                ? <GraficoEvolucion series={evoProductividadPlantasRep.series} labels={evoProductividadPlantasRep.labels} hoyIdx={evoProductividadPlantasRep.hoyIdx} unidad=" pl/h" />
                : <p style={{ color: '#9ca3af', fontSize: '12px', textAlign: 'center', padding: '16px' }}>Sin datos de CrossChex disponibles.</p>}
              <a href="#productividad-paq" style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', fontWeight: 600, display: 'inline-block', marginTop: '8px' }}>Ver evolución en paquetes/hora ↓</a>
            </div>
          </div>
        </div>

        {/* ══ 1. VENTAS ══ */}
        <h2 style={tituloSeccion}>1. Ventas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <GraficoVentaPorArticulo datos={evolArticulo} />
          <GraficoVentaPorCliente mensual={evolClienteMensual} ocultarToggle />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <GraficoPrecioPromedio datos={evolPrecio} />
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Venta por cliente — {nombre}</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Unidades del mes · variación vs. mes anterior · % del total</p>
            {clientesMes.filas.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin ventas cargadas este mes.</p>
            ) : (
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Unidades</th>
                  <th style={{ textAlign: 'right' }}>% vs. mes ant.</th>
                  <th style={{ textAlign: 'right' }}>% del total</th>
                </tr></thead>
                <tbody>
                  {clientesMes.filas.map(c => (
                    <tr key={c.id_control} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td>{c.nombre}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(c.total)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: c.variacionPct === null ? '#9ca3af' : c.variacionPct >= 0 ? '#059669' : '#dc2626' }}>
                        {c.variacionPct !== null ? `${c.variacionPct >= 0 ? '↑' : '↓'} ${Math.abs(c.variacionPct)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#6b7280' }}>{c.pctTotal}%</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right' }}>{fmt(clientesMes.totalMes)}</td>
                    <td></td><td style={{ textAlign: 'right' }}>100%</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

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
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Días F2 promedio, por mes</p>
            <GraficoEvolucion series={evoCiclos180.series} labels={evoCiclos180.labels} hoyIdx={evoCiclos180.hoyIdx} />
          </div>
          <div id="productividad-paq" style={{ ...cardStyle, scrollMarginTop: '16px' }}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Productividad — paquetes / hora-hombre</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Por mes · últimos 12 meses</p>
            {evoProductividad.series[0].puntos.length > 0
              ? <GraficoEvolucion series={evoProductividad.series} labels={evoProductividad.labels} hoyIdx={evoProductividad.hoyIdx} unidad=" paq/h" />
              : <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin datos de CrossChex disponibles para este período.</p>}
          </div>
          <div style={cardStyle}>
            <p className="card-title" style={{ margin: '0 0 2px' }}>Evolución de pesaje testigo — últimos 180 días</p>
            <p className="card-sub" style={{ margin: '0 0 10px' }}>Gramos por paquete, por mes</p>
            <GraficoPesaje puntos={puntosPesaje180} labelFn={(f) => { const [y, m] = f.split('-').map(Number); return `${MESES_CORTO[m - 1]} ${String(y).slice(2)}`; }} />
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
                <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>diferencia acumulada de {nombre.toLowerCase()}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <p className="card-title" style={{ margin: '0 0 10px' }}>Uso real vs. uso teórico — {nombre}</p>
          {gruposUso.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin artículos con datos cargados este mes en estas categorías.</p>
          ) : gruposUso.map(g => (
            <div key={g.titulo} style={{ marginBottom: '14px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 700, color: '#374151' }}>{g.titulo}</p>
              <table style={{ fontSize: '12px', width: '100%', maxWidth: '640px' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Artículo</th>
                  <th style={{ textAlign: 'right' }}>Uso real</th>
                  <th style={{ textAlign: 'right' }}>Uso teórico</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                </tr></thead>
                <tbody>
                  {g.filas.map(f => (
                    <tr key={f.articulo} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td>{f.articulo} <span style={{ color: '#9ca3af', fontSize: '10px' }}>{f.unidad}</span>
                        {f.detalle && <div style={{ fontSize: '10px', color: '#9ca3af' }}>{f.detalle}</div>}
                      </td>
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

        </div>{/* /#informe-contenido */}
      </div>
    </>
  );
}
