import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, mesAnteriorClamp } from '@/lib/estadisticas';
import { calcularDiasPorFase } from '@/lib/lotes';
import { calcularCapacidad, diasCicloDefault } from '@/lib/planificacionServer';
import { calcularPlan, repartoHelpers, parseReparto, REPARTO_DEFAULT, DIA_SIEMBRA, CUB, planchas } from '@/lib/planificacion';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import GraficoCiclosMesadas from './GraficoCiclosMesadas';
import GraficoPesaje from './GraficoPesaje';
export const dynamic = 'force-dynamic';

export default async function EstadisticasPage({ searchParams }: { searchParams: { nave?: string; periodo?: string; evo?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const naveFilter = searchParams.nave || 'todas';
  const periodoMesada = (searchParams.periodo || 'anio') as 'mes' | 'mes_ant' | 'anio' | 'siempre';
  const evoModo = (searchParams.evo === 'anio' ? 'anio' : 'trimestre') as 'anio' | 'trimestre';

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

  // Puntos de pesaje testigo: lotes cosechados con peso registrado
  const puntosPesaje = lotes
    .filter(l => {
      if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
      return Number(l.peso_muestra_paquete_gr) > 0 || Number(l.peso_muestra_kg) > 0;
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

  let statsActual: any[] = [], statsPasado: any[] = [];
  try { statsActual = estadisticasDelMes(lotes, movimientos, hoy); } catch {}
  try {
    const mesPasado = mesAnteriorClamp(hoy);
    statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado);
  } catch {}

  // ── EVOLUCIÓN DE CICLOS (F2 promedio) ──
  // Una línea de lechuga (promedio de todas las variedades) y una de rúcula.
  // Modo año = buckets por mes (12); modo trimestre = buckets por semana (13).
  const esRuculaV = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
  function curvasEvo(modo: 'anio' | 'trimestre') {
    const ahora = new Date();
    let nBuckets: number, labels: string[], hoyIdx: number;
    let bucketDe: (f: Date) => number;
    if (modo === 'trimestre') {
      nBuckets = 13;
      const start = new Date(ahora); start.setDate(start.getDate() - 7 * (nBuckets - 1)); start.setHours(0, 0, 0, 0);
      bucketDe = (f) => { const idx = Math.floor((f.getTime() - start.getTime()) / (7 * 86400000)); return idx >= 0 && idx < nBuckets ? idx : -1; };
      labels = Array.from({ length: nBuckets }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return `${d.getDate()}/${d.getMonth() + 1}`; });
      hoyIdx = nBuckets - 1;
    } else {
      nBuckets = 12;
      bucketDe = (f) => f.getFullYear() === ahora.getFullYear() ? f.getMonth() : -1;
      labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      hoyIdx = ahora.getMonth();
    }
    const acc = {
      lechuga: Array.from({ length: nBuckets }, () => [] as number[]),
      rucula: Array.from({ length: nBuckets }, () => [] as number[]),
    };
    const accPeso = {
      lechuga: Array.from({ length: nBuckets }, () => [] as number[]),
      rucula: Array.from({ length: nBuckets }, () => [] as number[]),
    };
    for (const l of lotes) {
      if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
      const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
      if (isNaN(f.getTime())) continue;
      const b = bucketDe(f); if (b < 0) continue;
      const esR = esRuculaV(l.variedad);
      let f2 = 0; try { f2 = calcularDiasPorFase(l, movimientos).fase_2; } catch {}
      if (f2 > 0) (esR ? acc.rucula : acc.lechuga)[b].push(f2);
      const gr = Number(l.peso_muestra_paquete_gr) > 0
        ? Number(l.peso_muestra_paquete_gr)
        : Number(l.peso_muestra_kg) > 0 ? Math.round(Number(l.peso_muestra_kg) * 1000) : 0;
      if (gr > 0) (esR ? accPeso.rucula : accPeso.lechuga)[b].push(gr);
    }
    const avgArr = (a: number[][]) => a.map(xs => xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);
    const lech = avgArr(acc.lechuga), ruc = avgArr(acc.rucula);
    const lechP = avgArr(accPeso.lechuga), rucP = avgArr(accPeso.rucula);
    const series = [
      { nombre: 'Lechuga F2', color: '#4d7c0f', puntos: lech.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Rúcula F2', color: '#166534', puntos: ruc.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ];
    const pesoSeries = [
      { nombre: 'Lechuga peso', color: '#4d7c0f', puntos: lechP.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
      { nombre: 'Rúcula peso', color: '#166534', puntos: rucP.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) },
    ];
    return { series, pesoSeries, labels, hoyIdx };
  }
  const evo = curvasEvo(evoModo);

  // ── EVOLUCIÓN MENSUAL DE PLANTAS POR PAQUETE (rúcula) ──
  const MESES_CORTO_ANIO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const anioActual = hoy.getFullYear();
  const accPlantasPaq: number[][] = Array.from({ length: 12 }, () => []);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha || !esRuculaV(l.variedad)) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime()) || f.getFullYear() !== anioActual) continue;
    const ppu = Number(l.plantas_por_unidad_real);
    if (!(ppu > 1)) continue; // 1 = sin dato real cargado
    accPlantasPaq[f.getMonth()].push(ppu);
  }
  const plantasPaqSerie = accPlantasPaq.map(xs => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const evoPlantasPaq = {
    series: [{ nombre: 'Rúcula', color: '#166534', puntos: plantasPaqSerie.map((v, i) => [i, v] as [number, number]).filter(p => p[1] > 0) }],
    labels: MESES_CORTO_ANIO,
    hoyIdx: hoy.getMonth(),
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

  // ── CICLOS POR MESADA ──
  // Para cada mesada: promedio de dias_f1, dias_f2 de cosechados cuyo historial de movimientos
  // incluye esa mesada como ubicacion_destino
  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');

  // Filtro de período para ciclos por mesada
  function cosechadosEnPeriodo(periodo: typeof periodoMesada) {
    const todos = lotes.filter(l => l.estado === 'cosechado');
    if (periodo === 'siempre') return todos;
    const ahora = new Date();
    let desde: Date;
    if (periodo === 'mes') {
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } else if (periodo === 'mes_ant') {
      const mp = mesAnteriorClamp(ahora);
      desde = new Date(mp.getFullYear(), mp.getMonth(), 1);
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      return todos.filter(l => { const f = new Date(String(l.fecha_cosecha)+'T12:00:00'); return f >= desde && f < hasta; });
    } else { // anio
      desde = new Date(ahora.getFullYear(), 0, 1);
    }
    return todos.filter(l => new Date(String(l.fecha_cosecha)+'T12:00:00') >= desde);
  }
  const cosechados = cosechadosEnPeriodo(periodoMesada);

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

  // Peso promedio y plantas/paquete por lote cosechado
  const pesoLoteMap = new Map<string, { gr: number; ppu: number; esRucula: boolean }>();
  for (const l of cosechados) {
    const gr = Number(l.peso_muestra_paquete_gr) > 0
      ? Number(l.peso_muestra_paquete_gr)
      : Number(l.peso_muestra_kg) > 0 ? Math.round(Number(l.peso_muestra_kg) * 1000) : 0;
    const ppu = Number(l.plantas_por_unidad_real) || 0;
    if (gr > 0 || ppu > 0) {
      const v = String(l.variedad || '').toLowerCase();
      pesoLoteMap.set(l.id_lote, { gr, ppu, esRucula: v.includes('rucula') || v.includes('rúcula') });
    }
  }

  // Normaliza nombres de mesada: quita prefijo "Nave X -", acentos, sufijos "(...)", minúsculas
  const normMes = (s: string) => String(s || '')
    .replace(/^Nave\s*\d+\s*-\s*/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const naveDe = (ubic: string) => {
    const m = String(ubic || '').match(/nave\s*(\d+)/i);
    if (m) return Number(m[1]);
    return String(ubic || '').toLowerCase().includes('n1') ? 1 : 2;
  };

  // Ciclos por mesada: usar movimientos de trasplante para saber qué lotes pasaron por cada mesada
  interface CicloMesada {
    nombre: string; nave: number;
    tipo: 'lechuga' | 'rucula' | 'mixta';
    lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number;
    ruculaF2: number; ruculaTotal: number; ruculaN: number;
    pesoGrLechuga: number; pesoGrRucula: number;
    plantasPaqLechuga: number; plantasPaqRucula: number;
  }
  const ciclosMesadas: CicloMesada[] = [];
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

  for (const mes of mesadas) {
    if (naveFilter !== 'todas' && String(mes.nave) !== naveFilter) continue;

    const mesKey = normMes(mes.nombre);
    const mesNave = Number(mes.nave);
    const esRuculaMesada = mesKey.includes('rucula');
    const esLechugaMesada = mesKey.includes('lechuga');
    const tipo: CicloMesada['tipo'] = esRuculaMesada ? 'rucula' : esLechugaMesada ? 'lechuga' : 'mixta';

    // Lotes cosechados que pasaron por esta mesada (matching normalizado: sin acentos/sufijos/prefijo)
    const lotesEnMesada = new Set(
      movimientos
        .filter(m => normMes(m.ubicacion_destino) === mesKey)
        .map(m => m.id_lote)
    );

    const lF1: number[] = [], lF2: number[] = [], rF2: number[] = [];
    const pLech: number[] = [], pRuc: number[] = [];
    const ppLech: number[] = [], ppRuc: number[] = [];

    // Ciclos: via movimientos (lotes que tuvieron destino = esta mesada, misma nave)
    for (const idLote of lotesEnMesada) {
      const d = diasPorLote.get(String(idLote));
      if (!d || d.nave !== mesNave) continue;
      const vNorm = d.variedad.toLowerCase();
      const esR = vNorm.includes('rucula') || vNorm.includes('rúcula');
      if (esR) { if (d.f2 > 0) rF2.push(d.f2); }
      else { if (d.f1 !== null && d.f1 > 0) lF1.push(d.f1); if (d.f2 > 0) lF2.push(d.f2); }
    }

    // Peso y plantas/paquete: via ubicacion_actual (guarda la mesada donde estaba al cosechar), matching normalizado + nave
    for (const l of cosechados) {
      if (normMes(l.ubicacion_actual) !== mesKey) continue;
      if (naveDe(l.ubicacion_actual) !== mesNave) continue;
      const p = pesoLoteMap.get(l.id_lote);
      if (!p) continue;
      if (p.gr > 0) (p.esRucula ? pRuc : pLech).push(p.gr);
      if (p.ppu > 0) (p.esRucula ? ppRuc : ppLech).push(p.ppu);
    }

    ciclosMesadas.push({
      nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
      nave: Number(mes.nave), tipo,
      lechugaF1: avg(lF1), lechugaF2: avg(lF2),
      lechugaTotal: avg(lF1.map((f,i) => f + (lF2[i]||0))),
      lechugaN: Math.max(lF1.length, lF2.length),
      ruculaF2: avg(rF2), ruculaTotal: avg(rF2), ruculaN: rF2.length,
      pesoGrLechuga: avg(pLech), pesoGrRucula: avg(pRuc),
      plantasPaqLechuga: avg(ppLech), plantasPaqRucula: avg(ppRuc),
    });
  }

  // Filas de la tabla: un ciclo F2 por cultivo, ordenadas por cultivo y luego nave
  const filasTabla = ciclosMesadas
    .map(m => {
      const esRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      return {
        nombre: m.nombre,
        nave: m.nave,
        cultivo: esRuc ? 'Rúcula' : 'Lechuga',
        cultivoOrden: esRuc ? 1 : 0, // lechuga primero
        f2: esRuc ? m.ruculaF2 : m.lechugaF2,
        plantasPorPaq: esRuc ? m.plantasPaqRucula : m.plantasPaqLechuga,
        peso: esRuc ? m.pesoGrRucula : m.pesoGrLechuga,
        n: esRuc ? m.ruculaN : m.lechugaN,
      };
    })
    .sort((a, b) => a.cultivoOrden - b.cultivoOrden || a.nave - b.nave || a.nombre.localeCompare(b.nombre));

  // Semáforo: compara cada mesada contra el promedio de mesadas del mismo cultivo
  // (ciclo: menos días es mejor · peso: más gramos es mejor)
  function promedioCultivo(cultivo: string, campo: 'f2' | 'peso'): number {
    const vals = filasTabla.filter(f => f.cultivo === cultivo && f[campo] > 0).map(f => f[campo]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  const promedios: Record<string, { f2: number; peso: number }> = {
    Lechuga: { f2: promedioCultivo('Lechuga', 'f2'), peso: promedioCultivo('Lechuga', 'peso') },
    Rúcula: { f2: promedioCultivo('Rúcula', 'f2'), peso: promedioCultivo('Rúcula', 'peso') },
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
    colorPeso: semaforo(f.peso, promedios[f.cultivo].peso, true),
  }));
  const filasLechuga = filasConColor.filter(f => f.cultivo === 'Lechuga');
  const filasRucula = filasConColor.filter(f => f.cultivo === 'Rúcula');

  const nombre = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

  // Construye URLs preservando los filtros activos (nave, periodo, evo)
  const buildUrl = (overrides: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (naveFilter !== 'todas') p.nave = naveFilter;
    if (periodoMesada !== 'anio') p.periodo = periodoMesada;
    if (evoModo !== 'trimestre') p.evo = evoModo;
    Object.assign(p, overrides);
    if (p.nave === 'todas') delete p.nave;
    if (p.periodo === 'anio') delete p.periodo;
    if (p.evo === 'trimestre') delete p.evo;
    const qs = new URLSearchParams(p).toString();
    return `/estadisticas${qs ? '?' + qs : ''}`;
  };

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">{nombre}</p>

        {/* Evolución de ciclos */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px', flexWrap:'wrap', gap:'8px' }}>
            <div>
              <p className="card-title" style={{ margin:'0 0 2px' }}>Evolución de ciclos</p>
              <p className="card-sub" style={{ margin:0 }}>Días F2 promedio de lechuga y rúcula por {evoModo==='trimestre' ? 'semana (últimas 13)' : 'mes'}.</p>
            </div>
            <div style={{ display:'flex', gap:'4px' }}>
              {([['anio','Año (meses)'],['trimestre','Trimestre (semanas)']] as const).map(([v,l]) => (
                <a key={v} href={buildUrl({ evo:v })}
                  style={{ padding:'3px 10px', borderRadius:'5px', fontSize:'11px', fontWeight:evoModo===v?700:400, background:evoModo===v?'#374151':'#f3f4f6', color:evoModo===v?'white':'#6b7280', textDecoration:'none' }}>
                  {l}
                </a>
              ))}
            </div>
          </div>
          <GraficoEvolucion series={evo.series} pesoSeries={evo.pesoSeries} labels={evo.labels} hoyIdx={evo.hoyIdx} />
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
                    const dU = ant ? s.cosechado - ant.cosechado : null;
                    const dC = ant ? s.ciclo_promedio - ant.ciclo_promedio : null;
                    return (
                      <tr key={s.variedad}>
                        <td>{s.variedad}</td>
                        <td style={{ textAlign:'right', fontWeight:500 }}>{s.cosechado?.toLocaleString?.('es-AR')} paq.</td>
                        <td style={{ textAlign:'right', color:dU===null?'#9ca3af':dU>=0?'#059669':'#dc2626' }}>
                          {dU===null?'—':(dU>=0?'+':'')+dU}
                        </td>
                        <td style={{ textAlign:'right' }}>{s.ciclo_promedio>0?s.ciclo_promedio+'d':'—'}</td>
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

        {/* Plantas por paquete — rúcula */}
        <div className="card">
          <p className="card-title">Evolución de plantas por paquete — Rúcula</p>
          <p className="card-sub">Promedio mensual · {anioActual}</p>
          <GraficoEvolucion series={evoPlantasPaq.series} labels={evoPlantasPaq.labels} hoyIdx={evoPlantasPaq.hoyIdx} unidad=" pl/paq" />
        </div>

        {/* Ciclos por mesada */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px', flexWrap:'wrap', gap:'8px' }}>
            <div>
              <p className="card-title" style={{ margin:'0 0 2px' }}>Ciclos promedio por mesada</p>
              <p className="card-sub" style={{ margin:0 }}>Basado en lotes cosechados · días F1 + F2 sin plantinera</p>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px', alignItems:'flex-end' }}>
              {/* Filtro período */}
              <div style={{ display:'flex', gap:'4px' }}>
                {([['mes','Este mes'],['mes_ant','Mes ant.'],['anio','Este año'],['siempre','Siempre']] as const).map(([v,l]) => (
                  <a key={v} href={buildUrl({ periodo:v })}
                    style={{ padding:'3px 8px', borderRadius:'5px', fontSize:'11px', fontWeight:periodoMesada===v?700:400, background:periodoMesada===v?'#374151':'#f3f4f6', color:periodoMesada===v?'white':'#6b7280', textDecoration:'none' }}>
                    {l}
                  </a>
                ))}
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
                { titulo: '🥬 Lechuga', color: '#4d7c0f', filas: filasLechuga },
                { titulo: '🌿 Rúcula', color: '#166534', filas: filasRucula },
              ].map(({ titulo, color, filas }) => filas.length > 0 && (
                <div key={titulo} style={{ marginBottom:'18px', overflowX:'auto' }}>
                  <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700, color }}>{titulo}</p>
                  <table style={{ fontSize:'12px' }}>
                    <thead>
                      <tr>
                        <th>Mesada</th>
                        <th style={{ textAlign:'center' }}>Nave</th>
                        <th style={{ textAlign:'right' }}>Ciclo F2 prom.</th>
                        <th style={{ textAlign:'right' }}>Plantas/paquete</th>
                        <th style={{ textAlign:'right', color:'#ea580c' }}>Peso prom.</th>
                        <th style={{ textAlign:'right', color:'#9ca3af', fontSize:'11px' }}>N cosechas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((m, i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ fontWeight:500 }}>{m.nombre}</td>
                          <td style={{ textAlign:'center' }}>
                            <span style={{ background:m.nave===1?'#881337':'#7c3aed', color:'white', padding:'1px 6px', borderRadius:'3px', fontSize:'10px', fontWeight:700 }}>N{m.nave}</span>
                          </td>
                          <td style={{ textAlign:'right', fontWeight:700, color:m.colorF2 }}>{m.f2>0?m.f2+'d':'—'}</td>
                          <td style={{ textAlign:'right', color:'#374151' }}>{m.plantasPorPaq>0?m.plantasPorPaq:'—'}</td>
                          <td style={{ textAlign:'right', fontWeight:700, color:m.colorPeso }}>{m.peso>0?m.peso+'g':'—'}</td>
                          <td style={{ textAlign:'right', color:'#9ca3af' }}>{m.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Siembra del mes: real vs. lo que indica el plan */}
        <div className="card">
          <p className="card-title">Siembra — {nombre}</p>
          <p className="card-sub">Planchas sembradas en lo que va del mes vs. lo que el plan de siembra indica a esta altura</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
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
