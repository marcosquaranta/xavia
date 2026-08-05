import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase } from '@/lib/lotes';
import { calcularCapacidad, diasCicloDefault } from '@/lib/planificacionServer';
import { calcularPlan, repartoHelpers, parseReparto, REPARTO_DEFAULT, DIA_SIEMBRA, CUB, planchas } from '@/lib/planificacion';
import { calcularCapacidadProductiva } from '@/lib/capacidadProductiva';
import { cosechadoEsteMes } from '@/lib/estadisticas';
import { getRegistrosCrossChex } from '@/lib/crosschex';
import { rangoMes, horasHombreEnRango } from '@/lib/personal';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import GraficoCiclosMesadas from './GraficoCiclosMesadas';
import GraficoPesaje from './GraficoPesaje';
export const dynamic = 'force-dynamic';

type PeriodoGlobal = 'd30' | 'd180' | 'anio' | 'historico';

export default async function EstadisticasPage({ searchParams }: { searchParams: { nave?: string; periodo?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const naveFilter = searchParams.nave || 'todas';
  const periodo = (['d30', 'd180', 'anio', 'historico'].includes(searchParams.periodo || '') ? searchParams.periodo : 'anio') as PeriodoGlobal;

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones, configRows] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
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

  // Productividad = paquetes cosechados ÷ horas-hombre reales (CrossChex) — mes en curso
  // (hasta hoy) vs. mes pasado hasta el mismo día del mes, igual criterio que el resto de
  // indicadores "al día" de la app. Es un indicador mensual fijo, independiente del filtro
  // global de período de arriba (igual que "Siembra del mes" más abajo). Si CrossChex
  // falla, queda en null y la tarjeta simplemente no se muestra.
  let productividad: { actual: number | null; pasado: number | null } = { actual: null, pasado: null };
  try {
    const cosechaMes = cosechadoEsteMes(lotes);
    const mesAnteriorRef = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const rangoActualMes = rangoMes(hoy.getFullYear(), hoy.getMonth() + 1, cosechaMes.diaCorte);
    const rangoPasadoMes = rangoMes(mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth() + 1, cosechaMes.diaCorte);
    const [regActual, regPasado] = await Promise.all([
      getRegistrosCrossChex(rangoActualMes.desde, rangoActualMes.hasta),
      getRegistrosCrossChex(rangoPasadoMes.desde, rangoPasadoMes.hasta),
    ]);
    const horasActual = horasHombreEnRango(regActual);
    const horasPasado = horasHombreEnRango(regPasado);
    productividad = {
      actual: horasActual > 0 ? Math.round((cosechaMes.actual / horasActual) * 100) / 100 : null,
      pasado: horasPasado > 0 ? Math.round((cosechaMes.pasado / horasPasado) * 100) / 100 : null,
    };
  } catch {}
  const productividadPct = productividad.actual !== null && productividad.pasado
    ? Math.round(((productividad.actual - productividad.pasado) / productividad.pasado) * 100)
    : null;

  const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const esRuculaV = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
  const esCrespaV = (v: string) => String(v).toLowerCase().includes('crespa');

  // Fecha desde la que arranca el filtro global elegido — null = histórico, sin límite.
  function desdeDePeriodo(p: PeriodoGlobal): Date | null {
    if (p === 'd30') { const d = new Date(hoy); d.setDate(d.getDate() - 30); return d; }
    if (p === 'd180') { const d = new Date(hoy); d.setDate(d.getDate() - 180); return d; }
    if (p === 'anio') return new Date(hoy.getFullYear(), 0, 1);
    return null;
  }
  const desdeFiltro = desdeDePeriodo(periodo);

  // Buckets del eje X compartidos por los 3 gráficos de evolución de abajo, según el
  // filtro global elegido: días (30d), semanas (180d), meses del año actual (Año actual),
  // o meses desde la cosecha más vieja registrada hasta hoy (Histórico).
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
      const nBuckets = 26; // ~180 días en semanas
      const start = new Date(ahora); start.setDate(start.getDate() - 7 * (nBuckets - 1)); start.setHours(0, 0, 0, 0);
      const bucketDe = (f: Date) => { const idx = Math.floor((f.getTime() - start.getTime()) / (7 * 86400000)); return idx >= 0 && idx < nBuckets ? idx : -1; };
      const labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return `${d.getDate()}/${d.getMonth() + 1}`; });
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

  // Construye URLs preservando los filtros activos (nave, periodo)
  const buildUrl = (overrides: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (naveFilter !== 'todas') p.nave = naveFilter;
    if (periodo !== 'anio') p.periodo = periodo;
    Object.assign(p, overrides);
    if (p.nave === 'todas') delete p.nave;
    if (p.periodo === 'anio') delete p.periodo;
    const qs = new URLSearchParams(p).toString();
    return `/estadisticas${qs ? '?' + qs : ''}`;
  };

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">{nombre}</p>

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

        {productividad.actual !== null && (
          <div className="card" style={{ marginBottom:'16px', display:'flex', alignItems:'center', gap:'20px', flexWrap:'wrap' }}>
            <div>
              <p style={{ margin:'0 0 2px', fontSize:'13px', fontWeight:700 }}>Productividad — paquetes / hora-hombre</p>
              <p style={{ margin:0, fontSize:'11px', color:'#9ca3af' }}>Cosecha del mes (paq.) ÷ horas reales trabajadas (CrossChex) · indicador mensual fijo, no cambia con el filtro de arriba</p>
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginLeft:'auto' }}>
              <strong style={{ fontSize:'26px', color:'#111827' }}>{productividad.actual.toLocaleString('es-AR')}</strong>
              <span style={{ fontSize:'12px', color:'#9ca3af' }}>paq/h</span>
              {productividadPct !== null && (
                <span style={{ fontSize:'12px', fontWeight:700, color: productividadPct >= 0 ? '#059669' : '#dc2626' }}>
                  {productividadPct >= 0 ? '↑' : '↓'} {Math.abs(productividadPct)}% vs. mes pasado
                </span>
              )}
            </div>
          </div>
        )}

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
