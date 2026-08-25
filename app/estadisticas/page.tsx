import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase } from '@/lib/lotes';
import { calcularCapacidad, diasCicloDefault } from '@/lib/planificacionServer';
import { calcularPlan, repartoHelpers, parseReparto, REPARTO_DEFAULT, DIA_SIEMBRA, CUB, planchas } from '@/lib/planificacion';
import { calcularCapacidadProductiva } from '@/lib/capacidadProductiva';
import { productividadDeMes, productividadPlantasDeMes } from '@/lib/productividad';
import { obtenerTemperaturasRosario, temperaturaPromedioPorMes } from '@/lib/clima';
import { kmPorSemana, VEHICULO_PARTNER } from '@/lib/kilometraje';
import { descartePorFaseMes, resumenDescartePorCultivo, type CultivoDescarte } from '@/lib/descarte';
import { ocupacionMensualPorCultivo, eficienciaSiembraCosechaPorMes, type EficienciaMesCultivo } from '@/lib/kpisOperativos';
import { perdidasPorMes } from '@/lib/perdidas';
import { cicloMesPromedio } from '@/lib/estadisticas';
import type { OcupacionHistorialRow } from '@/lib/ocupacion';
import type { Lote, Movimiento, Ubicacion, KilometrajeVehiculo, StockCamara, ProductividadDiaria, VentaDia } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import GraficoCiclosMesadas from './GraficoCiclosMesadas';
import GraficoPesaje from './GraficoPesaje';
import GraficoBarrasApiladas from '@/components/GraficoBarrasApiladas';
export const dynamic = 'force-dynamic';

type PeriodoGlobal = 'd30' | 'd180' | 'anio' | 'historico';

export default async function EstadisticasPage({ searchParams }: { searchParams: { nave?: string; periodo?: string; perdidas?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const naveFilter = searchParams.nave || 'todas';
  const periodo = (['d30', 'd180', 'anio', 'historico'].includes(searchParams.periodo || '') ? searchParams.periodo : 'anio') as PeriodoGlobal;
  // Ventana de "Pérdidas totales" — propia, independiente del filtro global de arriba (que
  // no aplica a los indicadores fijos por mes) y de los 12 meses fijos de "Descarte por
  // fase". Por defecto 3 meses (a pedido explícito), con opción de ampliar a 6 o 12 ahí
  // mismo, sin tocar nada más de la página.
  const perdidasMesesRaw = Number(searchParams.perdidas);
  const perdidasMeses = ([3, 6, 12].includes(perdidasMesesRaw) ? perdidasMesesRaw : 3) as 3 | 6 | 12;

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  let registrosKm: KilometrajeVehiculo[] = [];
  let ocupacionHistorial: OcupacionHistorialRow[] = [];
  let registrosCamara: StockCamara[] = [];
  let productividadCache: ProductividadDiaria[] = [];
  let ventas: VentaDia[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones, configRows, registrosKm, ocupacionHistorial, registrosCamara, productividadCache, ventas] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<KilometrajeVehiculo>('Kilometraje').catch(() => []),
      readSheet<OcupacionHistorialRow>('OcupacionHistorial').catch(() => []),
      readSheet<StockCamara>('StockCamara').catch(() => []),
      readSheet<ProductividadDiaria>('ProductividadDiaria').catch(() => []),
      readSheet<VentaDia>('Ventas').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  // Productividad por mes (últimos 12 meses) = paquetes cosechados ÷ horas-hombre reales,
  // sumadas desde la caché diaria ProductividadDiaria (ver lib/types.ts) en vez de pedirle
  // a CrossChex en vivo acá — CrossChex limita a 1 pedido cada 15 segundos, así que pedirle
  // 12 meses en cada carga de esta página (aunque sea de a uno) tardaría varios minutos.
  // La caché la carga /api/cron/productividad-diaria una vez por día; meses de antes de que
  // esa caché exista simplemente no tienen datos todavía (se van completando solos).
  const NMESES_PROD = 12;
  const mesesProd: { anio: number; mes: number; diaHasta?: number }[] = [];
  for (let i = NMESES_PROD - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const esMesActual = d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
    mesesProd.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, diaHasta: esMesActual ? hoy.getDate() : undefined });
  }
  const productividadMensual = mesesProd.map(({ anio, mes, diaHasta }) => productividadDeMes(lotes, productividadCache, anio, mes, diaHasta));
  const productividadPlantasMensual = mesesProd.map(({ anio, mes, diaHasta }) => productividadPlantasDeMes(lotes, productividadCache, anio, mes, diaHasta));
  const evoProductividadMensual = {
    series: [{ nombre: 'Paquetes/hora-hombre', color: '#2563eb', puntos: productividadMensual.map((p, i) => [i, p.productividad ?? 0] as [number, number]).filter(p => p[1] > 0) }],
    labels: productividadMensual.map(p => p.label), hoyIdx: productividadMensual.length - 1,
  };
  const evoProductividadPlantas = {
    series: [{ nombre: 'Plantas/hora-persona', color: '#7c3aed', puntos: productividadPlantasMensual.map((p, i) => [i, p.productividad ?? 0] as [number, number]).filter(p => p[1] > 0) }],
    labels: productividadPlantasMensual.map(p => p.label), hoyIdx: productividadPlantasMensual.length - 1,
  };
  const productividadPlantasUltimoMes = [...productividadPlantasMensual].reverse().find((p) => p.productividad !== null) ?? null;

  // ── KPI 1: Ocupación de posiciones — promedio mensual, por cultivo (últimos 6 meses) ──
  const ocupacionMensual = ocupacionMensualPorCultivo(ocupacionHistorial, ubicaciones, 6);
  const ocupacionUltimoMes = [...ocupacionMensual].reverse().find((m) => m.total.pct !== null) ?? null;

  // ── KPI 2: Eficiencia Siembra → Cosecha — promedio mensual, por cultivo (últimos 6 meses) ──
  const eficienciaMensual = eficienciaSiembraCosechaPorMes(lotes, 6);
  function eficienciaGlobalDeMes(m: EficienciaMesCultivo): number | null {
    const vivaTot = m.rucula.viva + m.lechuga_crespa.viva + m.lechuga_roble.viva;
    const descarteTot = m.rucula.descarte + m.lechuga_crespa.descarte + m.lechuga_roble.descarte;
    const base = vivaTot + descarteTot;
    return base > 0 ? Math.round((vivaTot / base) * 1000) / 10 : null;
  }
  const eficienciaGlobalMensual = eficienciaMensual.map(eficienciaGlobalDeMes);
  const eficienciaUltimoMes = (() => {
    for (let i = eficienciaMensual.length - 1; i >= 0; i--) {
      const pctGlobal = eficienciaGlobalMensual[i];
      if (pctGlobal !== null) return { mes: eficienciaMensual[i], pctGlobal };
    }
    return null;
  })();
  // Promedio / mejor / peor mes del período mostrado — el detalle que se agrega debajo de
  // cada gráfico de Indicadores Marce, a pedido explícito (antes solo se veía la curva).
  function detalleMinMaxProm(valores: (number | null)[], unidad: string): string {
    const vals = valores.filter((v): v is number => v !== null);
    if (!vals.length) return 'Sin datos en el período.';
    const prom = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const max = Math.max(...vals), min = Math.min(...vals);
    return `Promedio del período: ${prom}${unidad} · mejor: ${max}${unidad} · peor: ${min}${unidad}`;
  }

  // Gráficos "mes a mes" de los 3 KPIs operativos, para la sección destacada de más abajo.
  const puntosPct = (arr: (number | null)[]) => arr.map((v, i) => [i, v] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null);
  const evoOcupacionCultivo = {
    series: [
      { nombre: 'Rúcula', color: '#134e4a', puntos: puntosPct(ocupacionMensual.map((m) => m.rucula.pct)) },
      { nombre: 'Lechuga', color: '#84cc16', puntos: puntosPct(ocupacionMensual.map((m) => m.lechuga.pct)) },
    ],
    labels: ocupacionMensual.map((m) => m.label), hoyIdx: ocupacionMensual.length - 1,
  };
  const evoEficienciaCultivo = {
    series: [
      { nombre: 'Rúcula', color: '#134e4a', puntos: puntosPct(eficienciaMensual.map((m) => m.rucula.pct)) },
      { nombre: 'Lechuga Crespa', color: '#84cc16', puntos: puntosPct(eficienciaMensual.map((m) => m.lechuga_crespa.pct)) },
      { nombre: 'Lechuga Roble', color: '#4d7c0f', puntos: puntosPct(eficienciaMensual.map((m) => m.lechuga_roble.pct)) },
    ],
    labels: eficienciaMensual.map((m) => m.label), hoyIdx: eficienciaMensual.length - 1,
  };

  const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const esRuculaV = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
  const esCrespaV = (v: string) => String(v).toLowerCase().includes('crespa');

  // ── Clima (Rosario) vs. ciclos promedio, por mes — últimos 12 meses ── temperatura de
  // Open-Meteo (API pública, sin key) en el eje derecho, ciclo F2 de lechuga (combinada,
  // sin desglose crespa/roble acá) y rúcula en el izquierdo. Si el servicio de clima
  // falla, el gráfico se muestra igual sin la línea de temperatura.
  const NMESES_CLIMA = 12;
  const mesesClimaLabels: string[] = [];
  const mesesClimaKeys: string[] = [];
  for (let i = NMESES_CLIMA - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    mesesClimaLabels.push(`${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
    mesesClimaKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const accCicloLechuga: number[][] = Array.from({ length: NMESES_CLIMA }, () => []);
  const accCicloRucula: number[][] = Array.from({ length: NMESES_CLIMA }, () => []);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    const mk = String(l.fecha_cosecha).slice(0, 7);
    const idx = mesesClimaKeys.indexOf(mk); if (idx < 0) continue;
    let f2 = 0; try { f2 = calcularDiasPorFase(l, movimientos).fase_2; } catch {}
    if (f2 <= 0) continue;
    (esRuculaV(l.variedad) ? accCicloRucula : accCicloLechuga)[idx].push(f2);
  }
  const avgArrClima = (a: number[][]) => a.map(xs => xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);
  const cicloLechugaMensual = avgArrClima(accCicloLechuga);
  const cicloRuculaMensual = avgArrClima(accCicloRucula);

  let temperaturaMensual: (number | null)[] = mesesClimaKeys.map(() => null);
  try {
    const desdeClima = `${mesesClimaKeys[0]}-01`;
    const hastaClimaDate = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    const hastaClima = hastaClimaDate < hoy ? hastaClimaDate.toISOString().slice(0, 10) : hoy.toISOString().slice(0, 10);
    const diasTemp = await obtenerTemperaturasRosario(desdeClima, hastaClima);
    const promPorMes = temperaturaPromedioPorMes(diasTemp);
    temperaturaMensual = mesesClimaKeys.map(mk => promPorMes.get(mk) ?? null);
  } catch {}

  const evoClimaCiclos = {
    series: [
      { nombre: 'Lechuga F2', color: '#84cc16', puntos: cicloLechugaMensual.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Rúcula F2', color: '#134e4a', puntos: cicloRuculaMensual.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ],
    tempSeries: [{ nombre: 'Temp. Rosario', color: '#ea580c', puntos: temperaturaMensual.map((v, i) => [i, v] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null) }],
    labels: mesesClimaLabels, hoyIdx: NMESES_CLIMA - 1,
  };

  // ── Kilometraje semanal del Partner — diferencia entre lecturas de odómetro
  // consecutivas (se cargan los viernes desde el Panel), no semanas calendario forzadas.
  const puntosKm = kmPorSemana(registrosKm, VEHICULO_PARTNER, 12).filter(p => p.kmSemana !== null);
  const evoKmSemana = {
    series: [{ nombre: 'Km recorridos', color: '#0891b2', puntos: puntosKm.map((p, i) => [i, p.kmSemana as number] as [number, number]) }],
    labels: puntosKm.map(p => p.label), hoyIdx: puntosKm.length - 1,
  };

  // ── Descarte por fase (columna apilada), por mes — últimos 12 meses, indicador fijo,
  // no cambia con el filtro de arriba (igual criterio que Productividad/Clima/Km). Un
  // gráfico por cultivo, cada columna dividida en Plantín→F1, F1→F2, F2→Cosecha y Cámara
  // (descarte explícito cargado al registrar un ajuste de stock — ver AjusteStockCard).
  // OJO: Cámara NO entra en el KPI "Eficiencia Siembra → Cosecha" de más arriba — ese
  // queda acotado a producción (siembra→cosecha), sin cámara ni ventas, a pedido explícito.
  const NMESES_DESCARTE = 12;
  const mesesDescarte = descartePorFaseMes(lotes, movimientos, registrosCamara, NMESES_DESCARTE);
  const resumenDescarte = resumenDescartePorCultivo(mesesDescarte);
  const COLOR_FASE = { plantinF1: '#fbbf24', f1F2: '#f97316', f2Cosecha: '#dc2626', camara: '#7c3aed' };
  const labelsDescarteMeses = mesesDescarte.map(m => m.label);
  function serieDescarte(cultivo: CultivoDescarte) {
    return [
      { nombre: 'Plantín→F1', color: COLOR_FASE.plantinF1, valores: mesesDescarte.map(m => m[cultivo].plantinF1) },
      { nombre: 'F1→F2', color: COLOR_FASE.f1F2, valores: mesesDescarte.map(m => m[cultivo].f1F2) },
      { nombre: 'F2→Cosecha', color: COLOR_FASE.f2Cosecha, valores: mesesDescarte.map(m => m[cultivo].f2Cosecha) },
      { nombre: 'Cámara', color: COLOR_FASE.camara, valores: mesesDescarte.map(m => m[cultivo].camara) },
    ];
  }
  const CULTIVO_LABEL: Record<CultivoDescarte, string> = { rucula: 'Rúcula', lechuga_crespa: 'Lechuga Crespa', lechuga_roble: 'Lechuga Hoja de Roble' };

  // ── Pérdidas totales por mes — junta Descarte (solo F2→Cosecha) + Faltante de stock +
  // Subocupación en una sola cuenta, todas reconvertidas a plantas para poder sumarlas y
  // compararlas entre sí. Ventana propia (perdidasMeses, selector arriba del gráfico) — no
  // depende del filtro global ni de los 12 meses fijos de "Descarte por fase".
  const mesesPerdidas = perdidasPorMes(lotes, movimientos, registrosCamara, ventas, ubicaciones, ocupacionHistorial, perdidasMeses);
  const COLOR_PERDIDA = { descarte: '#dc2626', faltanteStock: '#2563eb', subocupacion: '#d97706' };
  const seriePerdidas = [
    { nombre: 'Descarte (F2→Cosecha)', color: COLOR_PERDIDA.descarte, valores: mesesPerdidas.map(m => m.descarte) },
    { nombre: 'Faltante de stock', color: COLOR_PERDIDA.faltanteStock, valores: mesesPerdidas.map(m => m.faltanteStock) },
    { nombre: 'Subocupación', color: COLOR_PERDIDA.subocupacion, valores: mesesPerdidas.map(m => m.subocupacion) },
  ];
  const perdidasUltimoMes = [...mesesPerdidas].reverse().find(m => m.total > 0) ?? null;
  // Último mes con datos de cada componente por separado, para el cuadro de detalle de
  // cálculo (subocupación en particular casi siempre tiene datos aunque los otros dos den 0).
  const perdidasDetalleMes = [...mesesPerdidas].reverse()[0] ?? null;
  const cicloDetalleMes = cicloMesPromedio(lotes, movimientos, hoy);

  // Fecha desde la que arranca el filtro global elegido — null = histórico, sin límite.
  function desdeDePeriodo(p: PeriodoGlobal): Date | null {
    if (p === 'd30') { const d = new Date(hoy); d.setDate(d.getDate() - 30); return d; }
    if (p === 'd180') { const d = new Date(hoy); d.setDate(d.getDate() - 180); return d; }
    if (p === 'anio') return new Date(hoy.getFullYear(), 0, 1);
    return null;
  }
  const desdeFiltro = desdeDePeriodo(periodo);

  // Buckets del eje X compartidos por los 3 gráficos de evolución de abajo, según el
  // filtro global elegido: días (30d), meses (180d en adelante — 180 días ya son ~6
  // meses, semana a semana queda ilegible), meses del año actual (Año actual), o meses
  // desde la cosecha más vieja registrada hasta hoy (Histórico). A partir de 180 días
  // el eje X SIEMPRE es por mes, nunca por semana — mismo criterio en todos los gráficos
  // que comparten estos buckets.
  function construirBuckets(p: PeriodoGlobal): { nBuckets: number; labels: string[]; hoyIdx: number; bucketDe: (f: Date) => number } {
    const ahora = hoy;
    if (p === 'd30') {
      const nBuckets = 30;
      const start = new Date(ahora); start.setDate(start.getDate() - (nBuckets - 1)); start.setHours(0, 0, 0, 0);
      const bucketDe = (f: Date) => { const idx = Math.floor((f.getTime() - start.getTime()) / 86400000); return idx >= 0 && idx < nBuckets ? idx : -1; };
      const labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return `${d.getDate()}/${d.getMonth() + 1}`; });
      return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
    }
    if (p === 'd180') {
      const nBuckets = 6; // ~180 días en meses
      const inicioMes0 = ahora.getMonth() - (nBuckets - 1);
      const startYear = ahora.getFullYear() + Math.floor(inicioMes0 / 12);
      const startMonth = ((inicioMes0 % 12) + 12) % 12;
      const bucketDe = (f: Date) => (f.getFullYear() - startYear) * 12 + (f.getMonth() - startMonth);
      const labels = Array.from({ length: nBuckets }, (_, i) => {
        const m = (startMonth + i) % 12, y = startYear + Math.floor((startMonth + i) / 12);
        return `${MESES_CORTO[m]} ${String(y).slice(2)}`;
      });
      return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
    }
    if (p === 'anio') {
      const nBuckets = 12;
      const bucketDe = (f: Date) => f.getFullYear() === ahora.getFullYear() ? f.getMonth() : -1;
      return { nBuckets, labels: [...MESES_CORTO], hoyIdx: ahora.getMonth(), bucketDe };
    }
    // historico: un bucket por mes, desde la cosecha más vieja registrada hasta hoy
    const fechas = lotes
      .filter(l => l.estado === 'cosechado' && l.fecha_cosecha)
      .map(l => new Date(String(l.fecha_cosecha) + 'T12:00:00'))
      .filter(d => !isNaN(d.getTime()));
    if (!fechas.length) {
      const bucketDe = (f: Date) => f.getFullYear() === ahora.getFullYear() ? f.getMonth() : -1;
      return { nBuckets: 12, labels: [...MESES_CORTO], hoyIdx: ahora.getMonth(), bucketDe };
    }
    const minFecha = new Date(Math.min(...fechas.map(d => d.getTime())));
    const startYear = minFecha.getFullYear(), startMonth = minFecha.getMonth();
    const nBuckets = (ahora.getFullYear() - startYear) * 12 + (ahora.getMonth() - startMonth) + 1;
    const bucketDe = (f: Date) => (f.getFullYear() - startYear) * 12 + (f.getMonth() - startMonth);
    const labels = Array.from({ length: nBuckets }, (_, i) => {
      const m = (startMonth + i) % 12, y = startYear + Math.floor((startMonth + i) / 12);
      return `${MESES_CORTO[m]} ${String(y).slice(2)}`;
    });
    return { nBuckets, labels, hoyIdx: nBuckets - 1, bucketDe };
  }
  const buckets = construirBuckets(periodo);

  // Puntos de pesaje testigo: lotes cosechados con peso registrado, respetando el filtro global.
  const puntosPesaje = lotes
    .filter(l => {
      if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
      if (!(Number(l.peso_muestra_paquete_gr) > 0 || Number(l.peso_muestra_kg) > 0)) return false;
      if (desdeFiltro) {
        const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
        if (isNaN(f.getTime()) || f < desdeFiltro) return false;
      }
      return true;
    })
    .map(l => ({
      fecha: String(l.fecha_cosecha),
      variedad: l.variedad,
      peso_gr: Number(l.peso_muestra_paquete_gr) > 0
        ? Number(l.peso_muestra_paquete_gr)
        : Math.round(Number(l.peso_muestra_kg) * 1000),
      paquetes: Number(l.unidades_cosechadas) || 0,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // ── EVOLUCIÓN DE CICLOS (F2 promedio) ── lechuga desglosada en Crespa/Roble, más rúcula,
  // sobre los buckets del filtro global.
  const acc = {
    lechugaCrespa: Array.from({ length: buckets.nBuckets }, () => [] as number[]),
    lechugaRoble: Array.from({ length: buckets.nBuckets }, () => [] as number[]),
    rucula: Array.from({ length: buckets.nBuckets }, () => [] as number[]),
  };
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const b = buckets.bucketDe(f); if (b < 0) continue;
    let f2 = 0; try { f2 = calcularDiasPorFase(l, movimientos).fase_2; } catch {}
    if (f2 <= 0) continue;
    if (esRuculaV(l.variedad)) acc.rucula[b].push(f2);
    else (esCrespaV(l.variedad) ? acc.lechugaCrespa : acc.lechugaRoble)[b].push(f2);
  }
  const avgArr = (a: number[][]) => a.map(xs => xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);
  const lechCrespa = avgArr(acc.lechugaCrespa), lechRoble = avgArr(acc.lechugaRoble), ruc = avgArr(acc.rucula);
  const evo = {
    series: [
      { nombre: 'Lechuga Crespa F2', color: '#84cc16', puntos: lechCrespa.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Lechuga Roble F2', color: '#4d7c0f', puntos: lechRoble.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Rúcula F2', color: '#134e4a', puntos: ruc.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ],
    labels: buckets.labels, hoyIdx: buckets.hoyIdx,
  };

  // ── EVOLUCIÓN DE PLANTAS POR PAQUETE (rúcula) ──
  const accPlantasPaq: number[][] = Array.from({ length: buckets.nBuckets }, () => []);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha || !esRuculaV(l.variedad)) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const b = buckets.bucketDe(f); if (b < 0) continue;
    const ppu = Number(l.plantas_por_unidad_real);
    if (!(ppu > 1)) continue; // 1 = sin dato real cargado
    accPlantasPaq[b].push(ppu);
  }
  const plantasPaqSerie = accPlantasPaq.map(xs => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const evoPlantasPaq = {
    series: [{ nombre: 'Rúcula', color: '#134e4a', puntos: plantasPaqSerie.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) }],
    labels: buckets.labels, hoyIdx: buckets.hoyIdx,
  };

  // ── DESCARTE POR MES, LECHUGA (desglosado Crespa/Roble) ── descarte_reportado es la
  // diferencia entre lo estimado (al sembrar/trasplantar) y lo realmente cosechado —
  // agrupa cualquier fase donde se haya perdido (plantinera, F1 o F2), no hay desglose
  // por etapa hoy. Solo lechuga: en rúcula el descarte no se declara acá (ver nota en
  // Lote.descarte_reportado).
  const accDescarteCrespa: number[] = Array.from({ length: buckets.nBuckets }, () => 0);
  const accDescarteRoble: number[] = Array.from({ length: buckets.nBuckets }, () => 0);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha || esRuculaV(l.variedad)) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime())) continue;
    const b = buckets.bucketDe(f); if (b < 0) continue;
    const desc = Number(l.descarte_reportado) || 0;
    if (desc <= 0) continue;
    (esCrespaV(l.variedad) ? accDescarteCrespa : accDescarteRoble)[b] += desc;
  }
  const evoDescarte = {
    series: [
      { nombre: 'Lechuga Crespa', color: '#84cc16', puntos: accDescarteCrespa.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Lechuga Roble', color: '#4d7c0f', puntos: accDescarteRoble.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ],
    labels: buckets.labels, hoyIdx: buckets.hoyIdx,
  };

  // ── SIEMBRA DEL MES: real (lotes sembrados) vs. lo que el plan indica ──
  let siembraRealRucPl = 0, siembraRealLecPl = 0, siembraPlanRucPl = 0, siembraPlanLecPl = 0;
  try {
    const naves = calcularCapacidad(ubicaciones);
    const plan = calcularPlan(naves, diasCicloDefault(lotes, movimientos));
    const cfgRep = configRows.find(i => i.clave === 'plan_reparto');
    const reparto = cfgRep ? parseReparto(cfgRep.valor) : REPARTO_DEFAULT;
    const h = repartoHelpers(plan, reparto);
    const plPorSiembraRuc = planchas(h.siembraRucPl);
    const plPorSiembraLec = planchas(h.siembraLecPl);

    // Miércoles (día de siembra) transcurridos este mes, hasta hoy inclusive
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    let diasSiembraTranscurridos = 0;
    for (let d = new Date(inicioMes); d <= hoy; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === DIA_SIEMBRA) diasSiembraTranscurridos++;
    }
    siembraPlanRucPl = plPorSiembraRuc * diasSiembraTranscurridos;
    siembraPlanLecPl = plPorSiembraLec * diasSiembraTranscurridos;

    // Real: lotes sembrados este mes. plantines_iniciales ya está en plantines/cubitos
    // (no en posiciones) tanto para lechuga como para rúcula — el factor CUBPOSRUC es
    // para convertir posiciones de capacidad (Ubicaciones), no para esto; usarlo acá
    // duplicaba la conversión. También se excluyen los lotes derivados de una cosecha
    // parcial (lote_origen no vacío): comparten fecha_siembra con el lote original y ya
    // están contados en su plantines_iniciales, así que sumarlos de nuevo inflaba el total.
    let sumPosRuc = 0, sumPlLec = 0;
    for (const l of lotes) {
      if (l.lote_origen) continue;
      const f = new Date(String(l.fecha_siembra) + 'T12:00:00');
      if (isNaN(f.getTime()) || f.getFullYear() !== hoy.getFullYear() || f.getMonth() !== hoy.getMonth()) continue;
      const cant = Number(l.plantines_iniciales) || 0;
      if (esRuculaV(l.variedad)) sumPosRuc += cant; else sumPlLec += cant;
    }
    siembraRealRucPl = planchas(sumPosRuc / CUB);
    siembraRealLecPl = planchas(sumPlLec / CUB);
  } catch {}

  // ── CICLOS POR MESADA + CAPACIDAD PRODUCTIVA ── (lógica compartida en lib/capacidadProductiva.ts)
  const capProd = calcularCapacidadProductiva(lotes, movimientos, ubicaciones, periodo, naveFilter);
  const { ciclosMesadas, filasCapacidad, kpiPorCultivo, kpiTotalTeorica, kpiTotalReal, kpiTotalRealTotalPeriodo, kpiTotalDifPct, resumenGrupos } = capProd;
  // Negativo = se sub-produjo vs. lo teórico; positivo = se superó.
  function colorDif(dif: number | null): string {
    if (dif === null) return '#9ca3af';
    return dif < -30 ? '#dc2626' : dif < -10 ? '#d97706' : '#059669';
  }
  function fmtDif(dif: number | null): string {
    return dif === null ? '—' : `${dif > 0 ? '+' : ''}${dif}%`;
  }
  const PERIODO_LABEL: Record<PeriodoGlobal, string> = { d30: 'Últimos 30 días', d180: 'Últimos 180 días', anio: 'Año actual', historico: 'Histórico' };

  // Filas de la tabla: un ciclo F2 por cultivo, ordenadas por cultivo y luego nave
  const filasTabla = ciclosMesadas
    .map(m => {
      const esRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      return {
        nombre: m.nombre,
        nave: m.nave,
        cultivo: esRuc ? 'Rúcula' : 'Lechuga',
        cultivoOrden: esRuc ? 1 : 0, // lechuga primero
        f1: esRuc ? 0 : m.lechugaF1,
        f2: esRuc ? m.ruculaF2 : m.lechugaF2,
        total: esRuc ? m.ruculaTotal : m.lechugaTotal,
        plantasPorPaq: esRuc ? m.plantasPaqRucula : m.plantasPaqLechuga,
        peso: esRuc ? m.pesoGrRucula : m.pesoGrLechuga,
        n: esRuc ? m.ruculaN : m.lechugaN,
      };
    })
    .sort((a, b) => a.cultivoOrden - b.cultivoOrden || a.nave - b.nave || a.nombre.localeCompare(b.nombre));

  // Semáforo: compara cada mesada contra el promedio de mesadas del mismo cultivo
  // (ciclo: menos días es mejor · peso: más gramos es mejor)
  function promedioCultivo(cultivo: string, campo: 'f2' | 'peso' | 'total'): number {
    const vals = filasTabla.filter(f => f.cultivo === cultivo && f[campo] > 0).map(f => f[campo]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  const promedios: Record<string, { f2: number; peso: number; total: number }> = {
    Lechuga: { f2: promedioCultivo('Lechuga', 'f2'), peso: promedioCultivo('Lechuga', 'peso'), total: promedioCultivo('Lechuga', 'total') },
    Rúcula: { f2: promedioCultivo('Rúcula', 'f2'), peso: promedioCultivo('Rúcula', 'peso'), total: promedioCultivo('Rúcula', 'total') },
  };
  function semaforo(valor: number, promedio: number, masEsMejor: boolean): string {
    if (valor <= 0 || promedio <= 0) return '#d1d5db';
    const ratio = valor / promedio;
    const mejor = masEsMejor ? ratio >= 1.05 : ratio <= 0.95;
    const peor = masEsMejor ? ratio <= 0.95 : ratio >= 1.05;
    return mejor ? '#059669' : peor ? '#dc2626' : '#d97706';
  }
  const filasConColor = filasTabla.map(f => ({
    ...f,
    colorF2: semaforo(f.f2, promedios[f.cultivo].f2, false),
    colorTotal: semaforo(f.total, promedios[f.cultivo].total, false),
    colorPeso: semaforo(f.peso, promedios[f.cultivo].peso, true),
  }));
  const filasLechuga = filasConColor.filter(f => f.cultivo === 'Lechuga');
  const filasRucula = filasConColor.filter(f => f.cultivo === 'Rúcula');

  // Filas de PROMEDIO por nave y por cultivo total, al pie de cada tabla.
  type FilaCiclo = typeof filasConColor[number];
  function promedioDeFilas(filas: FilaCiclo[], campo: 'f1' | 'f2' | 'total' | 'peso' | 'plantasPorPaq'): number {
    const vals = filas.filter(f => f[campo] > 0).map(f => f[campo]);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }
  function filaPromedio(filas: FilaCiclo[], etiqueta: string) {
    return {
      nombre: etiqueta, nave: 0, esPromedio: true,
      f1: promedioDeFilas(filas, 'f1'), f2: promedioDeFilas(filas, 'f2'), total: promedioDeFilas(filas, 'total'),
      plantasPorPaq: promedioDeFilas(filas, 'plantasPorPaq'), peso: promedioDeFilas(filas, 'peso'),
      n: filas.reduce((a, f) => a + f.n, 0),
    };
  }
  function conPromedios(filas: FilaCiclo[], cultivo: string) {
    const naves = Array.from(new Set(filas.map(f => f.nave))).sort((a, b) => a - b);
    const filasConNave: any[] = [];
    for (const nv of naves) {
      const deNave = filas.filter(f => f.nave === nv);
      filasConNave.push(...deNave);
      if (naves.length > 1) filasConNave.push({ ...filaPromedio(deNave, `N${nv} — Promedio`), nave: nv });
    }
    filasConNave.push(filaPromedio(filas, `Promedio ${cultivo}`));
    return filasConNave;
  }
  const filasLechugaConProm = conPromedios(filasLechuga, 'Lechuga');
  const filasRuculaConProm = conPromedios(filasRucula, 'Rúcula');

  // Capacidad productiva: agrupada cultivo → nave → mesada, para mostrar un resumen
  // abreviado por cultivo/nave y poder expandir cada nave para ver el detalle por mesada.
  type FilaCap = typeof filasCapacidad[number];
  function totalDeFilas(filas: FilaCap[], campo: 'posiciones' | 'produccionTeorica' | 'produccionReal'): number {
    return filas.reduce((a, f) => a + f[campo], 0);
  }
  function totalCap(filas: FilaCap[]) {
    return {
      posiciones: totalDeFilas(filas, 'posiciones'),
      produccionTeorica: totalDeFilas(filas, 'produccionTeorica'),
      produccionReal: totalDeFilas(filas, 'produccionReal'),
      n: filas.reduce((a, f) => a + f.n, 0),
    };
  }
  function agruparCapacidad(filas: FilaCap[]) {
    const cultivos = Array.from(new Set(filas.map(f => f.cultivo)));
    return cultivos.map((cul) => {
      const deCultivo = filas.filter(f => f.cultivo === cul);
      const naves = Array.from(new Set(deCultivo.map(f => f.nave))).sort((a, b) => a - b);
      return {
        cultivo: cul,
        total: totalCap(deCultivo),
        naves: naves.map((nv) => {
          const deNave = deCultivo.filter(f => f.nave === nv);
          return { nave: nv, total: totalCap(deNave), mesadas: deNave };
        }),
      };
    });
  }
  const capacidadAgrupada = agruparCapacidad(filasCapacidad);

  const nombre = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

  // Construye URLs preservando los filtros activos (nave, periodo, ventana de Pérdidas)
  const buildUrl = (overrides: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (naveFilter !== 'todas') p.nave = naveFilter;
    if (periodo !== 'anio') p.periodo = periodo;
    if (perdidasMeses !== 3) p.perdidas = String(perdidasMeses);
    Object.assign(p, overrides);
    if (p.nave === 'todas') delete p.nave;
    if (p.periodo === 'anio') delete p.periodo;
    if (p.perdidas === '3') delete p.perdidas;
    const qs = new URLSearchParams(p).toString();
    return `/estadisticas${qs ? '?' + qs : ''}`;
  };

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:'8px' }}>
          <div>
            <h1 className="page-title">Estadísticas</h1>
            <p className="page-subtitle">{nombre}</p>
          </div>
          <Link href="/estadisticas/mensual" className="btn secondary" style={{ fontSize:'12px' }}>📧 Análisis mensual (para mail) →</Link>
        </div>

        {/* Filtro global de período — aplica a toda la información de abajo */}
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'16px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'12px', fontWeight:700, color:'#6b7280' }}>Período:</span>
          <div style={{ display:'flex', gap:'4px' }}>
            {([['d30','Últimos 30 días'],['d180','Últimos 180 días'],['anio','Año actual'],['historico','Histórico']] as const).map(([v,l]) => (
              <a key={v} href={buildUrl({ periodo:v })}
                style={{ padding:'4px 10px', borderRadius:'5px', fontSize:'12px', fontWeight:periodo===v?700:400, background:periodo===v?'#374151':'#f3f4f6', color:periodo===v?'white':'#6b7280', textDecoration:'none' }}>
                {l}
              </a>
            ))}
          </div>
        </div>

        {/* ══ INDICADORES OPERATIVOS MARCE — KPIs acordados con Marcelo para su rol,
            ver conclusión completa en /produccion/puesto ══ */}
        <div id="indicadores-marce" style={{ background: 'linear-gradient(135deg, #1e293b, #0f172a)', borderRadius: '14px', padding: '22px 22px 24px', marginBottom: '20px', scrollMarginTop: '16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'10px', marginBottom:'18px' }}>
            <div>
              <p style={{ margin:0, fontSize:'11px', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.6px' }}>KPIs de gestión</p>
              <h2 style={{ margin:'2px 0 0', fontSize:'26px', fontWeight:900, color:'white' }}>Indicadores Operativos Marce</h2>
            </div>
            <Link href="/produccion/puesto" style={{ fontSize:'12px', color:'#e2e8f0', textDecoration:'underline', fontWeight:600, whiteSpace:'nowrap' }}>
              Ver descripción completa del puesto →
            </Link>
          </div>

          {/* Uno abajo del otro (antes 3 en fila, quedaban muy apretados) — con el ancho
              completo cada gráfico se lee mejor, y de paso entra la fila de "más detalle"
              (promedio/mejor/peor del período) sin amontonar nada. */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'16px' }}>
            {/* KPI 1 — Ocupación de posiciones */}
            <div className="card" style={{ margin:0 }}>
              <p style={{ margin:'0 0 2px', fontSize:'12.5px', fontWeight:700 }}>1. Ocupación de posiciones</p>
              <p style={{ margin:'0 0 10px', fontSize:'11px', color:'#9ca3af' }}>Objetivo: 95% promedio mensual, por cultivo — promedio del mes, no foto puntual · últimos {ocupacionMensual.length} meses</p>
              <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginBottom:'6px' }}>
                <strong style={{ fontSize:'30px', color: ocupacionUltimoMes?.total.pct !== null && ocupacionUltimoMes?.total.pct !== undefined ? (ocupacionUltimoMes.total.pct >= 95 ? '#059669' : '#d97706') : '#9ca3af' }}>
                  {ocupacionUltimoMes?.total.pct !== null && ocupacionUltimoMes?.total.pct !== undefined ? `${ocupacionUltimoMes.total.pct}%` : '—'}
                </strong>
                <span style={{ fontSize:'11px', color:'#9ca3af' }}>{ocupacionUltimoMes?.label ?? 'sin datos aún'}</span>
              </div>
              {ocupacionUltimoMes && (
                <p style={{ margin:'0 0 10px', fontSize:'11px', color:'#6b7280' }}>
                  Rúcula {ocupacionUltimoMes.rucula.pct ?? '—'}% · Lechuga {ocupacionUltimoMes.lechuga.pct ?? '—'}%
                </p>
              )}
              {evoOcupacionCultivo.series.some((s) => s.puntos.length > 0) ? (
                <>
                  <GraficoEvolucion series={evoOcupacionCultivo.series} labels={evoOcupacionCultivo.labels} hoyIdx={evoOcupacionCultivo.hoyIdx} unidad="%" yMax={Math.min(100, Math.ceil((Math.max(...evoOcupacionCultivo.series.flatMap(s => s.puntos.map(p => p[1]))) + 3) / 5) * 5)} />
                  <p style={{ margin:'6px 0 0', fontSize:'11px', color:'#6b7280' }}>{detalleMinMaxProm(ocupacionMensual.map(m => m.total.pct), '%')}</p>
                </>
              ) : (
                <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'16px' }}>Sin histórico de ocupación todavía.</p>
              )}
              <Link href="/ocupacion" style={{ fontSize:'11px', color:'#2563eb', textDecoration:'none', fontWeight:600, display:'inline-block', marginTop:'8px' }}>Ver detalle en Ocupación →</Link>
            </div>

            {/* KPI 2 — Eficiencia Siembra → Cosecha */}
            <div className="card" style={{ margin:0 }}>
              <p style={{ margin:'0 0 2px', fontSize:'12.5px', fontWeight:700 }}>2. Eficiencia Siembra → Cosecha</p>
              <p style={{ margin:'0 0 10px', fontSize:'11px', color:'#9ca3af' }}>% de plantines que llega vivo a cosecha, según el descarte de las 3 etapas — sin ventas ni cámara. Sin objetivo numérico fijado aún · últimos {eficienciaMensual.length} meses</p>
              <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginBottom:'6px' }}>
                <strong style={{ fontSize:'30px', color:'#111827' }}>
                  {eficienciaUltimoMes ? `${eficienciaUltimoMes.pctGlobal}%` : '—'}
                </strong>
                <span style={{ fontSize:'11px', color:'#9ca3af' }}>{eficienciaUltimoMes?.mes.label ?? 'sin datos aún'}</span>
              </div>
              {eficienciaUltimoMes && (
                <p style={{ margin:'0 0 10px', fontSize:'11px', color:'#6b7280' }}>
                  Rúcula {eficienciaUltimoMes.mes.rucula.pct ?? '—'}% · Crespa {eficienciaUltimoMes.mes.lechuga_crespa.pct ?? '—'}% · Roble {eficienciaUltimoMes.mes.lechuga_roble.pct ?? '—'}%
                </p>
              )}
              {evoEficienciaCultivo.series.some((s) => s.puntos.length > 0) ? (
                <>
                  <GraficoEvolucion series={evoEficienciaCultivo.series} labels={evoEficienciaCultivo.labels} hoyIdx={evoEficienciaCultivo.hoyIdx} unidad="%" />
                  <p style={{ margin:'6px 0 0', fontSize:'11px', color:'#6b7280' }}>{detalleMinMaxProm(eficienciaGlobalMensual, '%')}</p>
                </>
              ) : (
                <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'16px' }}>Sin lotes cosechados en el período.</p>
              )}
              <a href="#descarte-por-fase" style={{ fontSize:'11px', color:'#2563eb', textDecoration:'none', fontWeight:600, display:'inline-block', marginTop:'8px' }}>Ver desglose de descarte por fase ↓</a>
            </div>

            {/* KPI 3 — Productividad (plantas cosechadas / hora-persona) */}
            <div className="card" style={{ margin:0 }}>
              <p style={{ margin:'0 0 2px', fontSize:'12.5px', fontWeight:700 }}>3. Productividad de empleados</p>
              <p style={{ margin:'0 0 10px', fontSize:'11px', color:'#9ca3af' }}>Plantas cosechadas al mes por hora-persona total. En medición — objetivo a fijar con 6-8 mediciones contra el propio baseline · últimos {productividadPlantasMensual.length} meses</p>
              <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginBottom:'10px' }}>
                <strong style={{ fontSize:'30px', color:'#111827' }}>
                  {productividadPlantasUltimoMes ? productividadPlantasUltimoMes.productividad!.toLocaleString('es-AR') : '—'}
                </strong>
                <span style={{ fontSize:'11px', color:'#9ca3af' }}>pl/h · {productividadPlantasUltimoMes?.label ?? 'sin datos aún'}</span>
              </div>
              {evoProductividadPlantas.series[0].puntos.length > 0 ? (
                <>
                  <GraficoEvolucion series={evoProductividadPlantas.series} labels={evoProductividadPlantas.labels} hoyIdx={evoProductividadPlantas.hoyIdx} unidad=" pl/h" />
                  <p style={{ margin:'6px 0 0', fontSize:'11px', color:'#6b7280' }}>{detalleMinMaxProm(productividadPlantasMensual.map(m => m.productividad), ' pl/h')}</p>
                </>
              ) : (
                <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'16px' }}>Sin datos de CrossChex disponibles.</p>
              )}
              <a href="#productividad" style={{ fontSize:'11px', color:'#2563eb', textDecoration:'none', fontWeight:600, display:'inline-block', marginTop:'8px' }}>Ver evolución en paquetes/hora →</a>
            </div>
          </div>
        </div>

        {/* Descarte por fase — columna apilada por mes, un gráfico por cultivo + resumen en %.
            A pedido explícito, va justo debajo de Indicadores Marce (antes quedaba más abajo,
            después de toda la fila de Evolución) y con un gráfico por fila, más grande — antes
            los 3 lado a lado quedaban ilegibles. */}
        <div id="descarte-por-fase" className="card" style={{ marginBottom:'16px', scrollMarginTop:'16px' }}>
          <p className="card-title" style={{ margin:'0 0 2px' }}>Descarte por fase</p>
          <p className="card-sub" style={{ margin:'0 0 12px' }}>Plantín→F1 / F1→F2 / F2→Cosecha (plantas) + Cámara (paquetes, descarte explícito cargado al registrar un ajuste de stock) · últimos 12 meses · indicador fijo, no cambia con el filtro de arriba</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'22px', marginBottom:'16px' }}>
            {(['rucula', 'lechuga_crespa', 'lechuga_roble'] as CultivoDescarte[]).map((cultivo) => (
              <div key={cultivo}>
                <p style={{ margin:'0 0 6px', fontSize:'13px', fontWeight:700, color:'#374151' }}>{CULTIVO_LABEL[cultivo]}</p>
                <GraficoBarrasApiladas labels={labelsDescarteMeses} series={serieDescarte(cultivo)} unidad="" />
              </div>
            ))}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ fontSize:'12px', width:'100%' }}>
              <thead><tr>
                <th style={{ textAlign:'left' }}>Cultivo</th>
                <th style={{ textAlign:'right' }}>Plantín→F1 (pl)</th>
                <th style={{ textAlign:'right' }}>F1→F2 (pl)</th>
                <th style={{ textAlign:'right' }}>F2→Cosecha (pl)</th>
                <th style={{ textAlign:'right' }} title="Descarte explícito cargado al registrar un ajuste de stock en cámara">Cámara (paq)</th>
                <th style={{ textAlign:'right' }}>Total</th>
              </tr></thead>
              <tbody>
                {resumenDescarte.map((r) => (
                  <tr key={r.cultivo} style={{ borderTop:'1px solid #f3f4f6' }}>
                    <td style={{ fontWeight:600, padding:'4px 0' }}>{CULTIVO_LABEL[r.cultivo]}</td>
                    <td style={{ textAlign:'right' }}>{r.plantinF1.toLocaleString('es-AR')} <span style={{ color:'#9ca3af' }}>({r.pctPlantinF1}%)</span></td>
                    <td style={{ textAlign:'right' }}>{r.f1F2.toLocaleString('es-AR')} <span style={{ color:'#9ca3af' }}>({r.pctF1F2}%)</span></td>
                    <td style={{ textAlign:'right' }}>{r.f2Cosecha.toLocaleString('es-AR')} <span style={{ color:'#9ca3af' }}>({r.pctF2Cosecha}%)</span></td>
                    <td style={{ textAlign:'right' }}>{r.camara.toLocaleString('es-AR')} <span style={{ color:'#9ca3af' }}>({r.pctCamara}%)</span></td>
                    <td style={{ textAlign:'right', fontWeight:700 }}>{r.total.toLocaleString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin:'8px 0 0', fontSize:'10px', color:'#9ca3af' }}>El total y el % mezclan plantas (primeras 3 etapas) con paquetes (Cámara) — sirve para ver dónde se concentra el descarte, no es una cantidad física exacta.</p>
            {resumenDescarte.find(r => r.cultivo === 'rucula' && r.plantinF1 === 0) && (
              <p style={{ margin:'8px 0 0', fontSize:'11px', color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'6px', padding:'6px 10px' }}>
                ℹ️ Rúcula sin descarte en Plantín→F1: sí se pide y se calcula igual que en lechuga (mismo formulario de trasplante, misma fórmula, con cartel de confirmación si se deja en 0) — si acá da 0 en todos los meses, es porque los trasplantes cargados vinieron con descarte=0 real, no porque falte medirlo. Vale la pena confirmar con el equipo que estén revisando bien esa etapa en rúcula antes de confirmar "0 pérdida", en vez de tildarlo de memoria.
              </p>
            )}
          </div>
        </div>

        {/* Pérdidas totales — Descarte (SOLO F2→Cosecha) + Faltante de stock + Subocupación */}
        <div id="perdidas-totales" className="card" style={{ marginBottom:'16px', scrollMarginTop:'16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'8px', marginBottom:'2px' }}>
            <p className="card-title" style={{ margin:0 }}>Pérdidas totales</p>
            <div style={{ display:'flex', gap:'4px' }}>
              {([[3,'3 meses'],[6,'6 meses'],[12,'12 meses']] as const).map(([v,l]) => (
                <a key={v} href={buildUrl({ perdidas:String(v) })}
                  style={{ padding:'3px 8px', borderRadius:'5px', fontSize:'11px', fontWeight:perdidasMeses===v?700:400, background:perdidasMeses===v?'#111827':'#f3f4f6', color:perdidasMeses===v?'white':'#374151', textDecoration:'none' }}>
                  {l}
                </a>
              ))}
            </div>
          </div>
          <p className="card-sub" style={{ margin:'0 0 4px' }}>Descarte (solo F2→Cosecha) + Faltante de stock (solo lo que faltó) + Subocupación, todo reconvertido a plantas · últimos {perdidasMeses} meses</p>
          {perdidasUltimoMes && (
            <p style={{ margin:'0 0 12px', fontSize:'12px', color:'#6b7280' }}>
              {perdidasUltimoMes.label}: <strong style={{ color:'#111827' }}>{perdidasUltimoMes.total.toLocaleString('es-AR')} pl</strong> perdidas
              — Descarte {perdidasUltimoMes.descarte.toLocaleString('es-AR')} · Faltante {perdidasUltimoMes.faltanteStock.toLocaleString('es-AR')} · Subocupación {perdidasUltimoMes.subocupacion.toLocaleString('es-AR')}
            </p>
          )}
          <GraficoBarrasApiladas labels={mesesPerdidas.map(m => m.label)} series={seriePerdidas} unidad=" pl" />
          <p style={{ margin:'8px 0 0', fontSize:'10px', color:'#9ca3af' }}>
            Faltante de stock y Subocupación reconvierten paquetes/tubos vacíos a plantas con el mismo factor que el resto de la app
            (rúcula ≈3 plantas/paq, lechuga 1:1) — son aproximaciones para poder compararlas entre sí, no cantidades físicas exactas.
          </p>

          {/* Detalle de cómo se calcula cada componente — a pedido explícito, especialmente
              para dejar clara la cuenta de Subocupación, que es la menos obvia de las 3. */}
          {perdidasDetalleMes && (
            <div style={{ marginTop:'14px', paddingTop:'12px', borderTop:'1px solid #f3f4f6', overflowX:'auto' }}>
              <p style={{ margin:'0 0 8px', fontSize:'11px', fontWeight:700, color:'#6b7280', textTransform:'uppercase' }}>Cómo se calcula cada componente — ejemplo con {perdidasDetalleMes.label}</p>
              <table style={{ fontSize:'12px', width:'100%', minWidth:'640px' }}>
                <thead><tr>
                  <th style={{ textAlign:'left' }}>Componente</th>
                  <th style={{ textAlign:'left' }}>Qué mide</th>
                  <th style={{ textAlign:'left' }}>Cómo se calcula</th>
                  <th style={{ textAlign:'right' }}>{perdidasDetalleMes.label}</th>
                </tr></thead>
                <tbody>
                  <tr style={{ borderTop:'1px solid #f3f4f6' }}>
                    <td style={{ fontWeight:600, padding:'6px 8px 6px 0', color:COLOR_PERDIDA.descarte }}>Descarte</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>Plantas perdidas SOLO entre pasar a Fase 2 y la cosecha (última etapa productiva)</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>Suma de descarte_calculado de los movimientos de cosecha del mes, ya en plantas</td>
                    <td style={{ textAlign:'right', fontWeight:700, padding:'6px 0' }}>{perdidasDetalleMes.descarte.toLocaleString('es-AR')} pl</td>
                  </tr>
                  <tr style={{ borderTop:'1px solid #f3f4f6' }}>
                    <td style={{ fontWeight:600, padding:'6px 8px 6px 0', color:COLOR_PERDIDA.faltanteStock }}>Faltante de stock</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>Solo la parte que FALTÓ al contar físicamente la cámara (un sobrante no cuenta, es la señal contraria)</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>máx(0, −(stock contado − stock teórico esperado)) en cada ajuste del mes, × ~3 pl/paq en rúcula, 1:1 en lechuga</td>
                    <td style={{ textAlign:'right', fontWeight:700, padding:'6px 0' }}>{perdidasDetalleMes.faltanteStock.toLocaleString('es-AR')} pl</td>
                  </tr>
                  <tr style={{ borderTop:'1px solid #f3f4f6' }}>
                    <td style={{ fontWeight:600, padding:'6px 8px 6px 0', color:COLOR_PERDIDA.subocupacion }}>Subocupación</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>Capacidad ociosa: tubos F2 vacíos que podrían haber estado produciendo</td>
                    <td style={{ padding:'6px 8px', color:'#6b7280' }}>
                      Σ (tubos vacíos × posiciones por tubo) cada día del mes, ÷ ciclo F2 real de ese mes — un tubo vacío durante un ciclo completo = una cosecha entera que no se hizo.
                      Ciclo usado en {perdidasDetalleMes.label}: rúcula {cicloDetalleMes.rucula || '—'}d · lechuga {cicloDetalleMes.lechuga || '—'}d.
                    </td>
                    <td style={{ textAlign:'right', fontWeight:700, padding:'6px 0' }}>{perdidasDetalleMes.subocupacion.toLocaleString('es-AR')} pl</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Evolución de ciclos / pesaje / plantas por paquete — 2 por fila */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:'12px', marginBottom:'16px' }}>
          <div className="card" style={{ margin:0 }}>
            <p className="card-title" style={{ margin:'0 0 2px' }}>Evolución de ciclos</p>
            <p className="card-sub" style={{ margin:'0 0 10px' }}>Días F2 promedio · {PERIODO_LABEL[periodo].toLowerCase()}</p>
            <GraficoEvolucion series={evo.series} labels={evo.labels} hoyIdx={evo.hoyIdx} />
          </div>

          <div className="card" style={{ margin:0 }}>
            <p className="card-title">Evolución de pesaje testigo</p>
            <p className="card-sub">Gramos por paquete · base para conversión KG↔paquetes · {PERIODO_LABEL[periodo].toLowerCase()}</p>
            <GraficoPesaje puntos={puntosPesaje} />
          </div>

          <div className="card" style={{ margin:0 }}>
            <p className="card-title">Plantas por paquete — Rúcula</p>
            <p className="card-sub">Promedio · {PERIODO_LABEL[periodo].toLowerCase()}</p>
            <GraficoEvolucion series={evoPlantasPaq.series} labels={evoPlantasPaq.labels} hoyIdx={evoPlantasPaq.hoyIdx} unidad=" pl/paq" yMin={1} yMax={4} />
          </div>

          <div className="card" style={{ margin:0 }}>
            <p className="card-title">Descartes Lechuga</p>
            <p className="card-sub">Plantas de diferencia entre lo estimado y lo cosechado (cualquier fase/plantinera) · {PERIODO_LABEL[periodo].toLowerCase()}</p>
            <GraficoEvolucion series={evoDescarte.series} labels={evoDescarte.labels} hoyIdx={evoDescarte.hoyIdx} unidad=" pl" />
          </div>

          <div id="productividad" className="card" style={{ margin:0, scrollMarginTop:'16px' }}>
            <p className="card-title" style={{ margin:'0 0 2px' }}>Productividad — paquetes / hora-hombre</p>
            <p className="card-sub" style={{ margin:'0 0 10px' }}>Por mes · últimos 12 meses · indicador fijo, no cambia con el filtro de arriba</p>
            {evoProductividadMensual.series[0].puntos.length > 0
              ? <GraficoEvolucion series={evoProductividadMensual.series} labels={evoProductividadMensual.labels} hoyIdx={evoProductividadMensual.hoyIdx} unidad=" paq/h" />
              : <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin datos de CrossChex disponibles para este período.</p>}
          </div>

          <div className="card" style={{ margin:0 }}>
            <p className="card-title" style={{ margin:'0 0 2px' }}>Clima (Rosario) vs. ciclos</p>
            <p className="card-sub" style={{ margin:'0 0 10px' }}>Días F2 promedio (izq.) y temperatura promedio (der.) · por mes · últimos 12 meses · indicador fijo, no cambia con el filtro de arriba</p>
            <GraficoEvolucion series={evoClimaCiclos.series} pesoSeries={evoClimaCiclos.tempSeries} labels={evoClimaCiclos.labels} hoyIdx={evoClimaCiclos.hoyIdx} unidadSecundaria="°C" labelSecundaria="temp →" />
          </div>

          <div className="card" style={{ margin:0 }}>
            <p className="card-title" style={{ margin:'0 0 2px' }}>Kilometraje — Vehículo Partner</p>
            <p className="card-sub" style={{ margin:'0 0 10px' }}>Km recorridos entre lecturas del odómetro (se cargan los viernes) · indicador fijo, no cambia con el filtro de arriba</p>
            {evoKmSemana.series[0].puntos.length > 0
              ? <GraficoEvolucion series={evoKmSemana.series} labels={evoKmSemana.labels} hoyIdx={evoKmSemana.hoyIdx} unidad=" km" />
              : <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Todavía no hay dos lecturas de kilometraje cargadas para calcular la diferencia semanal.</p>}
          </div>
        </div>

        {/* Ciclos por mesada */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px', flexWrap:'wrap', gap:'8px' }}>
            <div>
              <p className="card-title" style={{ margin:'0 0 2px' }}>Ciclos promedio por mesada</p>
              <p className="card-sub" style={{ margin:0 }}>Basado en lotes cosechados · días F2 (sin Fase 1) · {PERIODO_LABEL[periodo].toLowerCase()}</p>
            </div>
            {/* Filtro nave */}
            <div style={{ display:'flex', gap:'4px' }}>
              {([['todas','Ambas'],['1','Nave 1'],['2','Nave 2']] as const).map(([v,l]) => (
                <a key={v} href={buildUrl({ nave:v })}
                  style={{ padding:'3px 8px', borderRadius:'5px', fontSize:'11px', fontWeight:naveFilter===v?700:400, background:naveFilter===v?'#111827':'#f3f4f6', color:naveFilter===v?'white':'#374151', textDecoration:'none' }}>
                  {l}
                </a>
              ))}
            </div>
          </div>

          {ciclosMesadas.length === 0
            ? <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin datos de mesadas para el filtro seleccionado.</p>
            : <GraficoCiclosMesadas datos={ciclosMesadas} />
          }

          {/* Tabla detallada, separada por cultivo */}
          {ciclosMesadas.length > 0 && (
            <div style={{ marginTop:'16px' }}>
              <div style={{ display:'flex', gap:'14px', marginBottom:'12px', fontSize:'11px', color:'#6b7280', flexWrap:'wrap' }}>
                <span>Semáforo vs. promedio del mismo cultivo:</span>
                <span style={{ display:'flex', alignItems:'center', gap:'4px' }}><span style={{ width:8, height:8, borderRadius:'50%', background:'#059669', display:'inline-block' }} />mejor</span>
                <span style={{ display:'flex', alignItems:'center', gap:'4px' }}><span style={{ width:8, height:8, borderRadius:'50%', background:'#d97706', display:'inline-block' }} />similar</span>
                <span style={{ display:'flex', alignItems:'center', gap:'4px' }}><span style={{ width:8, height:8, borderRadius:'50%', background:'#dc2626', display:'inline-block' }} />peor</span>
              </div>
              {[
                { titulo: '🥬 Lechuga', color: '#4d7c0f', filas: filasLechugaConProm, mostrarF1: true },
                { titulo: '🌿 Rúcula', color: '#166534', filas: filasRuculaConProm, mostrarF1: false },
              ].map(({ titulo, color, filas, mostrarF1 }) => filas.length > 0 && (
                <div key={titulo} style={{ marginBottom:'18px', overflowX:'auto' }}>
                  <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700, color }}>{titulo}</p>
                  <table style={{ fontSize:'12px' }}>
                    <thead>
                      <tr>
                        <th>Mesada</th>
                        <th style={{ textAlign:'center' }}>Nave</th>
                        {mostrarF1 && <th style={{ textAlign:'right' }}>F1 prom.</th>}
                        <th style={{ textAlign:'right' }}>Ciclo F2 prom.</th>
                        <th style={{ textAlign:'right' }}>Días totales</th>
                        <th style={{ textAlign:'right' }}>Plantas/paquete</th>
                        <th style={{ textAlign:'right', color:'#ea580c' }}>Peso prom.</th>
                        <th style={{ textAlign:'right', color:'#9ca3af', fontSize:'11px' }}>N cosechas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((m: any, i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6', background: m.esPromedio ? '#f8fafc' : 'transparent' }}>
                          <td style={{ fontWeight: m.esPromedio ? 700 : 500, color: m.esPromedio ? '#374151' : undefined }}>{m.nombre}</td>
                          <td style={{ textAlign:'center' }}>
                            {!m.esPromedio && (
                              <span style={{ background:m.nave===1?'#881337':'#7c3aed', color:'white', padding:'1px 6px', borderRadius:'3px', fontSize:'10px', fontWeight:700 }}>N{m.nave}</span>
                            )}
                          </td>
                          {mostrarF1 && <td style={{ textAlign:'right', color:'#374151', fontWeight: m.esPromedio ? 700 : 400 }}>{m.f1>0?m.f1+'d':'—'}</td>}
                          <td style={{ textAlign:'right', fontWeight:700, color:m.esPromedio?'#374151':m.colorF2 }}>{m.f2>0?m.f2+'d':'—'}</td>
                          <td style={{ textAlign:'right', fontWeight: m.esPromedio ? 700 : 400, color:m.esPromedio?'#374151':m.colorTotal }}>{m.total>0?m.total+'d':'—'}</td>
                          <td style={{ textAlign:'right', color:'#374151', fontWeight: m.esPromedio ? 700 : 400 }}>{m.plantasPorPaq>0?m.plantasPorPaq:'—'}</td>
                          <td style={{ textAlign:'right', fontWeight:700, color:m.esPromedio?'#374151':m.colorPeso }}>{m.peso>0?m.peso+'g':'—'}</td>
                          <td style={{ textAlign:'right', color:'#9ca3af', fontWeight: m.esPromedio ? 700 : 400 }}>{m.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Capacidad productiva mensual */}
        <div className="card">
          <div style={{ marginBottom:'6px' }}>
            <p className="card-title" style={{ margin:'0 0 2px' }}>Capacidad productiva mensual</p>
            <p className="card-sub" style={{ margin:0 }}>
              Producción teórica = posiciones × (30 / ciclo F2 promedio de la nave+cultivo). Producción real = paquetes
              cosechados en el período, mensualizados (÷ meses del período) para ser comparables. Mismo filtro de nave y de período que arriba.
            </p>
          </div>

          {filasCapacidad.length === 0 ? (
            <p style={{ color:'#9ca3af', fontSize:'13px', textAlign:'center', padding:'20px' }}>Sin datos para el filtro seleccionado.</p>
          ) : (
            <>
              {/* KPI: paquetes/mes (promedio) por cultivo — teórica y real lado a lado */}
              <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'14px 0 10px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'7px', padding:'8px 12px' }}>
                <span style={{ fontSize:'16px' }}>ℹ️</span>
                <p style={{ margin:0, fontSize:'12px', fontWeight:700, color:'#1e40af' }}>
                  Todos los números de acá abajo son PROMEDIOS POR MES (no un acumulado) — calculados sobre {PERIODO_LABEL[periodo].toLowerCase()}.
                </p>
              </div>
              <div style={{ display:'grid', gridTemplateColumns: `repeat(${kpiPorCultivo.length}, 1fr) 1fr`, gap:'10px', marginBottom:'18px' }}>
                {kpiPorCultivo.map(k => {
                  const esLechuga = k.cultivo === 'Lechuga';
                  return (
                    <div key={k.cultivo} style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px' }}>
                      <p style={{ margin:'0 0 6px', fontSize:'11px', fontWeight:700, color: esLechuga?'#4d7c0f':'#166534', textTransform:'uppercase' }}>
                        {esLechuga?'🥬':'🌿'} {k.cultivo}
                      </p>
                      <div style={{ display:'flex', gap:'20px' }}>
                        <div>
                          <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Teórica</p>
                          <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:'#111827' }}>{k.teorica.toLocaleString('es-AR')}<span style={{ fontSize:'12px', fontWeight:600, color:'#9ca3af' }}>/mes</span></p>
                        </div>
                        <div>
                          <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Real</p>
                          <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:'#059669' }}>{k.real.toLocaleString('es-AR')}<span style={{ fontSize:'12px', fontWeight:600, color:'#9ca3af' }}>/mes</span></p>
                        </div>
                        <div>
                          <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Dif.</p>
                          <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:colorDif(k.difPct) }}>{fmtDif(k.difPct)}</p>
                        </div>
                      </div>
                      <p style={{ margin:'6px 0 0', fontSize:'11px', color:'#9ca3af' }}>
                        {k.posiciones.toLocaleString('es-AR')} posiciones · {k.realTotalPeriodo.toLocaleString('es-AR')} paq. cosechados EN TOTAL en {PERIODO_LABEL[periodo].toLowerCase()}
                      </p>
                    </div>
                  );
                })}
                <div style={{ background:'#111827', borderRadius:'10px', padding:'14px' }}>
                  <p style={{ margin:'0 0 6px', fontSize:'11px', fontWeight:700, color:'#9ca3af', textTransform:'uppercase' }}>Total</p>
                  <div style={{ display:'flex', gap:'20px' }}>
                    <div>
                      <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Teórica</p>
                      <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:'white' }}>{kpiTotalTeorica.toLocaleString('es-AR')}<span style={{ fontSize:'12px', fontWeight:600, color:'#9ca3af' }}>/mes</span></p>
                    </div>
                    <div>
                      <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Real</p>
                      <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:'#86efac' }}>{kpiTotalReal.toLocaleString('es-AR')}<span style={{ fontSize:'12px', fontWeight:600, color:'#9ca3af' }}>/mes</span></p>
                    </div>
                    <div>
                      <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Dif.</p>
                      <p style={{ margin:0, fontSize:'24px', fontWeight:800, color:colorDif(kpiTotalDifPct) }}>{fmtDif(kpiTotalDifPct)}</p>
                    </div>
                  </div>
                  <p style={{ margin:'6px 0 0', fontSize:'11px', color:'#d1d5db' }}>
                    {kpiTotalRealTotalPeriodo.toLocaleString('es-AR')} paq. cosechados EN TOTAL en {PERIODO_LABEL[periodo].toLowerCase()}
                  </p>
                </div>
              </div>

              {/* Resumen colapsable: cultivo (total siempre visible) → nave (expandible) → mesada (detalle) */}
              {capacidadAgrupada.map((g) => {
                const esLechuga = g.cultivo === 'Lechuga';
                const bg = esLechuga ? '#f0fdf4' : '#ecfdf5';
                const border = esLechuga ? '#bbf7d0' : '#a7f3d0';
                const color = esLechuga ? '#166534' : '#065f46';
                return (
                  <div key={g.cultivo} style={{ marginBottom:'16px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'8px', background:bg, border:`2px solid ${border}`, borderRadius:'8px', padding:'10px 14px', marginBottom:'8px' }}>
                      <span style={{ fontWeight:800, fontSize:'14px', color }}>{esLechuga?'🥬':'🌿'} Total {g.cultivo}</span>
                      <div style={{ display:'flex', gap:'18px', fontSize:'12px', flexWrap:'wrap' }}>
                        <span style={{ color:'#6b7280' }}>Posiciones: <strong style={{ color }}>{g.total.posiciones.toLocaleString('es-AR')}</strong></span>
                        <span style={{ color:'#6b7280' }}>Teórica/mes: <strong style={{ color:'#111827', fontSize:'13px' }}>{g.total.produccionTeorica.toLocaleString('es-AR')}</strong></span>
                        <span style={{ color:'#6b7280' }}>Real/mes: <strong style={{ color:'#059669', fontSize:'13px' }}>{g.total.produccionReal.toLocaleString('es-AR')}</strong></span>
                      </div>
                    </div>

                    {g.naves.map((n) => {
                      const rg = resumenGrupos.find(r => r.nave === n.nave && r.cultivo === g.cultivo);
                      return (
                      <details key={n.nave} style={{ border:'1px solid #e5e7eb', borderRadius:'7px', marginBottom:'6px', overflow:'hidden' }}>
                        <summary style={{ cursor:'pointer', padding:'8px 12px', background:'#f9fafb', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', fontSize:'12px' }}>
                          <span style={{ background:n.nave===1?'#881337':'#7c3aed', color:'white', padding:'1px 7px', borderRadius:'4px', fontSize:'10px', fontWeight:700 }}>N{n.nave}</span>
                          <span style={{ color:'#9ca3af' }}>{n.mesadas.length} mesada{n.mesadas.length!==1?'s':''}</span>
                          <span style={{ marginLeft:'auto', display:'flex', gap:'16px' }}>
                            <span style={{ color:'#6b7280' }}>Posiciones: <strong style={{ color:'#374151' }}>{n.total.posiciones.toLocaleString('es-AR')}</strong></span>
                            <span style={{ color:'#6b7280' }}>Teórica/mes: <strong style={{ color:'#111827' }}>{n.total.produccionTeorica.toLocaleString('es-AR')}</strong></span>
                            <span style={{ color:'#6b7280' }}>Real/mes: <strong style={{ color:'#059669' }}>{n.total.produccionReal.toLocaleString('es-AR')}</strong></span>
                          </span>
                        </summary>
                        {rg && (
                          <p style={{ margin:0, padding:'6px 12px', fontSize:'11px', color:'#92400e', background:'#fffbeb', borderTop:'1px solid #fde68a', borderBottom:'1px solid #fde68a' }}>
                            Cuenta: {n.total.posiciones.toLocaleString('es-AR')} posiciones × {rg.plantasPorPosicion} planta/posición × (30 / {rg.ciclo}d de ciclo){rg.plantasPorPaq !== 1 && <> ÷ {rg.plantasPorPaq} plantas/paquete</>} = <strong>{n.total.produccionTeorica.toLocaleString('es-AR')} paquetes/mes (teórica)</strong>
                          </p>
                        )}
                        <div style={{ overflowX:'auto' }}>
                          <table style={{ fontSize:'12px', width:'100%' }}>
                            <thead>
                              <tr>
                                <th>Mesada</th>
                                <th style={{ textAlign:'right' }}>Ciclo actual</th>
                                <th style={{ textAlign:'right' }}>Posiciones</th>
                                <th style={{ textAlign:'right' }}>Teórica/mes</th>
                                <th style={{ textAlign:'right' }}>Real/mes</th>
                                <th style={{ textAlign:'right' }}>Dif. %</th>
                                <th style={{ textAlign:'right', color:'#9ca3af', fontSize:'11px' }}>N cosechas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {n.mesadas.map((m, i) => (
                                <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                                  <td style={{ fontWeight:500 }}>{m.nombre}</td>
                                  <td style={{ textAlign:'right', fontWeight:700 }}>{m.cicloActual>0 ? m.cicloActual+'d' : '—'}</td>
                                  <td style={{ textAlign:'right', color:'#374151' }}>{m.posiciones>0?m.posiciones.toLocaleString('es-AR'):'—'}</td>
                                  <td style={{ textAlign:'right', fontWeight:700, color:'#111827' }}>{m.produccionTeorica.toLocaleString('es-AR')}</td>
                                  <td style={{ textAlign:'right', fontWeight:700, color:'#059669' }}>{m.produccionReal.toLocaleString('es-AR')}</td>
                                  <td style={{ textAlign:'right', fontWeight:700, color:colorDif(m.difPct) }}>{fmtDif(m.difPct)}</td>
                                  <td style={{ textAlign:'right' }}>
                                    <span style={{ color: m.n <= 1 ? '#dc2626' : '#9ca3af', fontWeight: m.n <= 1 ? 700 : 400 }}>
                                      {m.n <= 1 && '⚠ '}{m.n}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                      );
                    })}
                  </div>
                );
              })}
              <p style={{ margin:'8px 0 0', fontSize:'11px', color:'#9ca3af' }}>⚠ N cosechas ≤ 1: promedio poco confiable, muestra chica. Click en una nave para ver el detalle por mesada.</p>
            </>
          )}
        </div>

        {/* Siembra del mes: real vs. lo que indica el plan */}
        <div className="card">
          <p className="card-title">Siembra — {nombre}</p>
          <p className="card-sub">Planchas sembradas en lo que va del mes vs. lo que el plan de siembra indica a esta altura</p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'12px' }}>
            {[
              { label: 'Rúcula', color: '#166534', real: siembraRealRucPl, plan: siembraPlanRucPl },
              { label: 'Lechuga', color: '#4d7c0f', real: siembraRealLecPl, plan: siembraPlanLecPl },
            ].map(c => {
              const dif = c.plan > 0 ? Math.round(((c.real - c.plan) / c.plan) * 100) : null;
              return (
                <div key={c.label} style={{ background:'white', border:'1px solid #e5e7eb', borderTop:`3px solid ${c.color}`, borderRadius:'8px', padding:'12px 14px' }}>
                  <p style={{ margin:'0 0 8px', fontSize:'12px', fontWeight:700, color:c.color, textTransform:'uppercase' }}>{c.label}</p>
                  <div style={{ display:'flex', gap:'20px' }}>
                    <div>
                      <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Sembrado</p>
                      <p style={{ margin:0, fontSize:'22px', fontWeight:800, color:'#111827' }}>{c.real}</p>
                    </div>
                    <div>
                      <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#9ca3af' }}>Plan indica</p>
                      <p style={{ margin:0, fontSize:'22px', fontWeight:800, color:'#6b7280' }}>{c.plan}</p>
                    </div>
                  </div>
                  {dif !== null ? (
                    <p style={{ margin:'8px 0 0', fontSize:'13px', fontWeight:700, color:dif>=0?'#059669':'#dc2626' }}>
                      {dif>=0?'↑':'↓'} {Math.abs(dif)}% vs. plan
                    </p>
                  ) : (
                    <p style={{ margin:'8px 0 0', fontSize:'11px', color:'#9ca3af' }}>Sin referencia de plan para este mes.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
