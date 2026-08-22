import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave, tubosPorMesada } from '@/lib/ocupacion';
import { plantasPorCultivo, proyeccionCosechaSemanal, ciclosPorSemana, cicloRealPorVariedad, pesoPromedioMes, mesAnteriorClamp, cicloMesPromedio } from '@/lib/estadisticas';
import { codigoCultivo } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, ClienteVenta, PrecioVenta, VentaHistorica, StockCamara, CajonMovimiento, KilometrajeVehiculo, ProductividadDiaria } from '@/lib/types';
import { calcularPlan, tareasDelDia, siembraDelDia, parseReparto, REPARTO_DEFAULT, type SiembraHoy } from '@/lib/planificacion';
import { calcularCapacidad, diasCicloDefault, trasplantesAgrupados, cosechasAgrupadas, type GrupoLotes } from '@/lib/planificacionServer';
import { evolucionVentaPorArticulo, resumenMesActual } from '@/lib/estadisticasVentas';
import { generarAlertas, motivoAlertaCosecha, type MotivoAlertaCosecha } from '@/lib/alertasPanel';
import { calcularCamara, diferenciaAjustesMes } from '@/lib/camara';
import { saldoPorCliente, alertasCajones } from '@/lib/cajones';
import { descartePorFaseMes } from '@/lib/descarte';
import { germinacionYSupervivenciaMes } from '@/lib/germinacion';
import { faltaCargarEstaSemana, ultimaLectura, kmEnRango, VEHICULO_PARTNER } from '@/lib/kilometraje';
import { productividadDeMes } from '@/lib/productividad';
import Header from '@/components/Header';
import GraficoCiclosSemanas from '@/components/GraficoCiclosSemanas';
import GraficoDistribucionMesadas from '@/components/GraficoDistribucionMesadas';
import BuscadorLote from '@/components/BuscadorLote';
import GruposLotes from '@/components/GruposLotes';
import AjusteStockCard from '@/components/AjusteStockCard';
import KilometrajeReminder from '@/components/KilometrajeReminder';
import TardanzasHoyBanner from '@/components/TardanzasHoyBanner';
import { GraficoVentaPorArticulo } from '@/app/ventas/VentasEvolucionCharts';

export const dynamic = 'force-dynamic';
// Ya no le pide nada a CrossChex acá adentro (ver TardanzasHoyBanner.tsx) — se deja el
// timeout generoso igual, de margen, por si alguna de las hojas de Sheets tarda.
export const maxDuration = 60;

const TIPO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  siembra:    { label: 'Siembra',    color: '#92400e', bg: '#fef9c3' },
  trasplante: { label: 'Trasplante', color: '#1e40af', bg: '#dbeafe' },
  cosecha:    { label: 'Cosecha',    color: '#166534', bg: '#dcfce7' },
  descarte:   { label: 'Descarte',   color: '#6b7280', bg: '#f3f4f6' },
  division:   { label: 'División',   color: '#7c3aed', bg: '#ede9fe' },
};

function fmtFecha(s: any) {
  const str = String(s||'').split(/[\sT]/)[0];
  if (!str || str === 'undefined') return '—';
  const [y,m,d] = str.split('-'); return `${d}/${m}`;
}
function diasAtras(s: any) {
  try { const diff = Math.round((Date.now() - new Date(String(s||'').split(/[\sT]/)[0]+'T12:00:00').getTime())/86400000); if (diff===0) return 'Hoy'; if (diff===1) return 'Ayer'; return `Hace ${diff}d`; } catch { return ''; }
}
function fmtISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const MESES_CORTO_PANEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
// Suma la proyección semanal (paquetes esperados por semana) en totales por mes calendario
// — cada semana se atribuye al mes de su lunes (mismo criterio que el resto de la app para
// "semana → mes"). Para el panel de datos al lado del gráfico de Proyección de cosecha.
function proyeccionPorMes(datos: { semana: string; rucula: number; lechuga: number }[]) {
  const map = new Map<string, { label: string; rucula: number; lechuga: number }>();
  for (const d of datos) {
    const mk = d.semana.slice(0, 7); // YYYY-MM
    if (!map.has(mk)) {
      const [y, m] = mk.split('-').map(Number);
      map.set(mk, { label: `${MESES_CORTO_PANEL[m - 1]} ${String(y).slice(2)}`, rucula: 0, lechuga: 0 });
    }
    const e = map.get(mk)!;
    e.rucula += d.rucula; e.lechuga += d.lechuga;
  }
  return [...map.keys()].sort().map((k) => map.get(k)!);
}
// Plantas cosechadas (reconvertidas — rúcula en paquetes × plantas_por_unidad_real, resto
// ya en plantas) en un rango de fechas puntual — mismo criterio que productividadPlantasDeMes
// (lib/productividad.ts) pero por rango en vez de mes calendario completo, para poder
// comparar "mes en curso hasta hoy" contra "mes pasado hasta el mismo día".
function plantasCosechadasEnRango(lotes: Lote[], desde: string, hasta: string): number {
  let plantas = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    const v = String(l.variedad || '').toLowerCase();
    const esRucula = v.includes('rucula') || v.includes('rúcula');
    plantas += esRucula ? (Number(l.unidades_cosechadas) || 0) * (Number(l.plantas_por_unidad_real) || 3) : (Number(l.unidades_cosechadas) || 0);
  }
  return plantas;
}

interface ItemIndicador { label: string; valor: string; pct: number | null; mejorSiSube: boolean; detalle?: string }

// Tarjeta chica por métrica: valor grande destacado + delta color-coded (verde/rojo
// según si subir es bueno o malo para esa métrica en particular) — reemplaza la fila
// de lista plana anterior para que los números "salten" más a la vista. `detalle`
// opcional agrega una línea chica debajo (ej. desglose por fase de Descartes).
function TileIndicador({ label, valor, pct, mejorSiSube, detalle }: ItemIndicador) {
  const bueno = pct === null ? null : mejorSiSube ? pct > 0 : pct < 0;
  return (
    <div style={{ background:'#fafafa', border:'1px solid #f1f0eb', borderRadius:'8px', padding:'9px 11px', display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
      <span style={{ fontSize:'10.5px', color:'#6b7280', fontWeight:600, lineHeight:1.25 }}>{label}</span>
      <div style={{ display:'flex', alignItems:'baseline', gap:'6px', flexWrap:'wrap' }}>
        <strong style={{ fontSize:'18px', color:'#111827', fontWeight:800, lineHeight:1 }}>{valor}</strong>
        {pct !== null && (
          <span style={{ fontSize:'10.5px', fontWeight:700, color: bueno===null?'#9ca3af':bueno?'#059669':'#dc2626' }}>
            {pct > 0 ? '↑' : pct < 0 ? '↓' : '·'} {Math.abs(pct)}%
          </span>
        )}
      </div>
      {detalle && <span style={{ fontSize:'9.5px', color:'#9ca3af', lineHeight:1.3 }}>{detalle}</span>}
    </div>
  );
}

// Grupo de indicadores relacionados (Ventas / Ciclos / Pesos / Ocupación), cada uno
// en su propia tarjeta con header con ícono — más moderno que la lista única de antes.
// `link` opcional agrega un "Ver detalle →" en el header, para grupos que tienen su
// propia página con más profundidad (ej. Ocupación → /ocupacion) sin duplicar esa
// información en una tarjeta aparte en el home.
function GrupoIndicadores({ titulo, icono, color, items, link }: { titulo: string; icono: string; color: string; items: ItemIndicador[]; link?: { href: string; texto: string } }) {
  return (
    <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px', marginBottom:'9px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <span style={{ fontSize:'14px' }}>{icono}</span>
          <p style={{ margin:0, fontSize:'11px', fontWeight:800, color, textTransform:'uppercase', letterSpacing:'0.4px' }}>{titulo}</p>
        </div>
        {link && <Link href={link.href} style={{ fontSize:'10.5px', color:'#9ca3af', textDecoration:'none', fontWeight:600 }}>{link.texto}</Link>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
        {items.map(it => <TileIndicador key={it.label} {...it} />)}
      </div>
    </div>
  );
}

export default async function PanelPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  let ventasPanel: VentaDia[] = [], clientesPanel: ClienteVenta[] = [], preciosPanel: PrecioVenta[] = [], historicasPanel: VentaHistorica[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  let registrosCamara: StockCamara[] = [];
  let movimientosCajones: CajonMovimiento[] = [];
  let registrosKm: KilometrajeVehiculo[] = [];
  try {
    [lotes, movimientos, ubicaciones, variedades, ventasPanel, clientesPanel, preciosPanel, historicasPanel, configRows, registrosCamara, movimientosCajones, registrosKm] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<PrecioVenta>('Precios').catch(() => []),
      readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<StockCamara>('StockCamara').catch(() => []),
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => []),
      readSheet<KilometrajeVehiculo>('Kilometraje').catch(() => []),
    ]);
  } catch {}

  // ── Tareas de hoy (planificación) ──
  let tareasHoy: { icon: string; txt: string; color: string; href?: string }[] = [];
  let gruposTrasplante: GrupoLotes[] = [];
  let gruposCosecha: GrupoLotes[] = [];
  let siembraHoy: SiembraHoy | null = null;
  try {
    const naves = calcularCapacidad(ubicaciones);
    const plan = calcularPlan(naves, diasCicloDefault(lotes, movimientos));
    const cfgRep = configRows.find(i => i.clave === 'plan_reparto');
    const reparto = cfgRep ? parseReparto(cfgRep.valor) : REPARTO_DEFAULT;
    const diaSemana = new Date().getDay();
    // "Cosechar ~X plantas" (🥬/🌿) es una ESTIMACIÓN teórica del reparto semanal
    // configurado (cuánto tocaría cosechar hoy según el plan), mientras que el cuadro
    // "🌾 Cosechar" de abajo (gruposCosecha) son los LOTES REALES que ya están listos —
    // dos cosas distintas que no tienen por qué coincidir en cantidad ni en lotes. En el
    // home mostrar las dos juntas confundía ("por qué habla de lotes distintos"), así que
    // acá solo queda la estimación teórica si no es de cosecha (ej. el aviso de stock de
    // los sábados); el detalle de la estimación semanal completa sigue en Planificación.
    tareasHoy = tareasDelDia(plan, reparto, diaSemana).filter(t => t.icon !== '🥬' && t.icon !== '🌿');
    siembraHoy = siembraDelDia(plan, reparto, diaSemana);
    if (diaSemana >= 1 && diaSemana <= 6) {
      gruposTrasplante = trasplantesAgrupados(lotes, movimientos);
      gruposCosecha = cosechasAgrupadas(lotes, movimientos);
    }
  } catch {}

  // Datos del panel
  let navesOcup: any[] = [], tubosMesadas: any[] = [];
  let resumen = { lechuga: { plantinera:0,fase_1:0,fase_2:0,total:0 }, rucula: { plantinera:0,fase_1:0,fase_2:0,total:0 }, albahaca: { plantinera:0,fase_1:0,fase_2:0,total:0 } };
  let proyeccionCosecha: any[] = [];
  let ciclosSemanas: any[] = [];
  let ciclosRealesMap = new Map<string,number>();

  try {
    navesOcup     = ocupacionPorNave(ubicaciones, lotes);
    tubosMesadas  = tubosPorMesada(ubicaciones, lotes);
    resumen       = plantasPorCultivo(lotes);
    proyeccionCosecha = proyeccionCosechaSemanal(lotes, variedades, 8);
    ciclosSemanas  = ciclosPorSemana(lotes, movimientos);
    ciclosRealesMap = cicloRealPorVariedad(lotes, [], 5);
  } catch {}

  // ── Evolución de venta por artículo + indicadores del mes (mismo cálculo que Ventas) ──
  const evolArticuloPanel = evolucionVentaPorArticulo(ventasPanel, 12, historicasPanel);
  const ahora = new Date();
  const mesPasadoRef = mesAnteriorClamp(ahora);
  const resumenMesPanel = resumenMesActual(ventasPanel, preciosPanel, clientesPanel, ahora);
  // Mes pasado completo, para comparar contra la proyección (que estima un mes entero).
  // OJO: sin el diaCorte explícito acá, resumenMesActual usa mesPasadoRef.getDate() como
  // corte (el mismo día que hoy) en vez del mes completo — quedaba idéntico al
  // "comparable" de abajo e inflaba la variación de la proyección.
  const diasEnMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1, 0).getDate();
  const resumenMesPasadoCompleto = resumenMesActual(ventasPanel, preciosPanel, clientesPanel, mesPasadoRef, diasEnMesPasado);
  // Referencia para "venta al día": el RITMO de todo el mes pasado (total real / días del mes),
  // prorrateado a los días que ya pasaron este mes — NO el total real de "mes pasado, mismos
  // primeros N días", que quedaba a merced de en qué día cayó algún pedido grande de un
  // cliente (un pedido grande cayendo del lado equivocado del corte disparaba el % de forma
  // errática, igual que ya pasaba con las ventas por kg — ver KEYS_EXCLUIDAS_UNIDADES).
  const corteHoy = ahora.getDate();
  const ventaEsperadaAlDia = diasEnMesPasado > 0 ? resumenMesPasadoCompleto.unidadesMes * (corteHoy / diasEnMesPasado) : 0;
  const pesoMesPanel = pesoPromedioMes(lotes, ahora);
  const pesoMesPasadoPanel = pesoPromedioMes(lotes, mesPasadoRef, ahora.getDate());

  // ── Stock en cámara + diferencia acumulada de ajustes del mes ──
  const camaraRucula = calcularCamara('rucula', registrosCamara, lotes, ventasPanel);
  const camaraLechugaCrespa = calcularCamara('lechuga_crespa', registrosCamara, lotes, ventasPanel);
  const camaraLechugaRoble = calcularCamara('lechuga_roble', registrosCamara, lotes, ventasPanel);
  const ajusteMesRucula = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventasPanel, ahora);
  const ajusteMesLechugaCrespa = diferenciaAjustesMes('lechuga_crespa', registrosCamara, lotes, ventasPanel, ahora);
  const ajusteMesLechugaRoble = diferenciaAjustesMes('lechuga_roble', registrosCamara, lotes, ventasPanel, ahora);

  const ocupNaves = tubosMesadas.map((n: any) => {
    const f2 = (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round(ocu / tot * 100) : 0 };
  });
  // % de variación vs. la referencia de "mes pasado" que corresponda a cada indicador.
  function pctVs(actual: number, ref: number): number | null {
    if (!ref) return null;
    return Math.round(((actual - ref) / ref) * 100);
  }

  // Ocupación solo F2
  const mesadasF2 = tubosMesadas.flatMap((n:any) => (n.mesadas||[]).filter((m:any) => m.sector_fase !== 'fase_1'));
  const ocGlobal = mesadasF2.length > 0
    ? Math.round(mesadasF2.reduce((a:number,m:any)=>a+m.tubos_ocupados,0) /
      Math.max(1, mesadasF2.reduce((a:number,m:any)=>a+m.tubos_totales,0)) * 100)
    : 0;

  // ── ALERTAS ──
  const hoy = new Date();
  // Las alertas de stock de insumos (alertasStockBajo) se movieron a la sección Stocks
  // — se apoyan en datos de Uso Teórico que todavía dan cifras raras para algunos
  // artículos (stock_inicial arrastrado en 0 en filas creadas desde Gastos), así que por
  // ahora quedan afuera de las Alertas del Panel hasta confirmar que están bien.
  // En el home se excluyen las alertas de atraso puntual de trasplante/cosecha — ese
  // detalle ya se ve más abajo en "Cosechar"/"Trasplantar", con su propio color por
  // tiempo transcurrido. El resto (mesadas vacías, sin siembras recientes, ocupación, etc.)
  // sí se muestra acá.
  let alertas = generarAlertas(lotes, tubosMesadas, ciclosRealesMap, ocGlobal).filter(a => a.categoria !== 'lote_atraso');
  // Cajones que un cliente debe hace más de 7 días sin registrar movimiento — pedido
  // explícito para que salte en las Alertas del home, no solo en la sección Cajones.
  try {
    const saldosCajones = saldoPorCliente(movimientosCajones, clientesPanel, hoy);
    const alertasCajonesPanel = alertasCajones(saldosCajones, 7);
    alertas = [
      ...alertas,
      ...alertasCajonesPanel.map(a => ({
        tipo: 'warn' as const,
        msg: `${a.nombre} debe ${a.saldo} cajones — sin movimiento hace ${a.diasSinMovimiento}d`,
        categoria: 'general' as const,
      })),
    ];
  } catch {}

  // Tardanzas de hoy: se movió a TardanzasHoyBanner (cliente, fetch a
  // /api/panel/tardanzas-hoy) — depende de CrossChex, que ahora respeta su límite real de
  // 1 pedido/15s (ver lib/crosschex.ts), y calcularlo acá adentro bloqueaba la carga de
  // TODA la página ~15-20s. Con esto el Panel renderiza al toque y el banner aparece
  // aparte unos segundos después si hubo alguna tardanza.

  // Productividad, Descarte del mes y Plantas/km — arman el bloque "Producción" de
  // Indicadores (home, solo admin).
  const mesAnteriorRef = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const desdeActualStr = fmtISODate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const hastaActualStr = fmtISODate(hoy);
  const desdePasadoStr = fmtISODate(new Date(mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth(), 1));
  // Solo para Plantas/km más abajo (comparación día a día tiene sentido ahí, no es un
  // análisis de horas de personal) — Productividad usa el mes pasado COMPLETO, ver abajo.
  const hastaPasadoStr = fmtISODate(new Date(mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth(), hoy.getDate()));

  // Productividad = paquetes cosechados ÷ horas-hombre reales, SIEMPRE acumulado del mes
  // (nunca un día suelto) — sumadas desde la caché diaria ProductividadDiaria (ver
  // lib/types.ts) en vez de pedirle a CrossChex en vivo. "Mes en curso" = acumulado hasta
  // hoy (parcial, crece día a día a medida que el cron suma jornadas); "mes pasado" = el
  // mes calendario ANTERIOR COMPLETO (no truncado al mismo día — es un análisis mensual de
  // personal, no un comparativo día a día). productividadDeMes ya restringe la cosecha a
  // los mismos días que la caché de horas cubre, así que el número no se dispara mientras
  // la caché todavía esté incompleta (ver lib/productividad.ts). Sin try/catch porque ya
  // no depende de una API externa que pueda fallar — a lo sumo readSheet devuelve [].
  let productividad: { actual: number | null; pasado: number | null } = { actual: null, pasado: null };
  if (user.rol === 'admin') {
    const productividadCache = await readSheet<ProductividadDiaria>('ProductividadDiaria').catch(() => []);
    const puntoActual = productividadDeMes(lotes, productividadCache, hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate());
    const puntoPasado = productividadDeMes(lotes, productividadCache, mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth() + 1);
    productividad = { actual: puntoActual.productividad, pasado: puntoPasado.productividad };
  }

  // Descarte del mes (plantas, 3 etapas Plantín→F1 / F1→F2 / F2→Cosecha, sin cámara —
  // mismo criterio que "Eficiencia Siembra → Cosecha", cámara queda afuera por acuerdo con
  // Marcelo). Meses calendario completos — actual = mes en curso hasta ahora, pasado = mes
  // calendario anterior completo. Guarda también el desglose por fase (sumado entre
  // cultivos) para mostrarlo en letra chica debajo del número total.
  let descarteMes: { actual: number | null; pasado: number | null; porFase: { plantinF1: number; f1F2: number; f2Cosecha: number } | null } = { actual: null, pasado: null, porFase: null };
  if (user.rol === 'admin') {
    try {
      const [mesPasadoDF, mesActualDF] = descartePorFaseMes(lotes, movimientos, registrosCamara, 2);
      const sumaFases = (m: typeof mesActualDF) => (['rucula', 'lechuga_crespa', 'lechuga_roble'] as const)
        .reduce((a, c) => a + m[c].plantinF1 + m[c].f1F2 + m[c].f2Cosecha, 0);
      const cultivosDF = ['rucula', 'lechuga_crespa', 'lechuga_roble'] as const;
      const porFase = {
        plantinF1: Math.round(cultivosDF.reduce((a, c) => a + mesActualDF[c].plantinF1, 0)),
        f1F2: Math.round(cultivosDF.reduce((a, c) => a + mesActualDF[c].f1F2, 0)),
        f2Cosecha: Math.round(cultivosDF.reduce((a, c) => a + mesActualDF[c].f2Cosecha, 0)),
      };
      descarteMes = { actual: Math.round(sumaFases(mesActualDF)), pasado: Math.round(sumaFases(mesPasadoDF)), porFase };
    } catch {}
  }

  // Plantas cosechadas ÷ km recorridos por el vehículo de reparto — mismo rango "hasta
  // hoy vs. hasta el mismo día del mes pasado" que productividad, para que sea comparable.
  // Si todavía no hay 2 cargas de kilometraje, kmEnRango da 0 y el indicador queda en null
  // (no hay con qué calcular la diferencia de odómetro) — no es un error, es esperable
  // hasta que haya más de una lectura cargada.
  let plantasPorKm: { actual: number | null; pasado: number | null } = { actual: null, pasado: null };
  if (user.rol === 'admin') {
    try {
      const plantasActual = plantasCosechadasEnRango(lotes, desdeActualStr, hastaActualStr);
      const plantasPasado = plantasCosechadasEnRango(lotes, desdePasadoStr, hastaPasadoStr);
      const kmActual = kmEnRango(registrosKm, VEHICULO_PARTNER, desdeActualStr, hastaActualStr);
      const kmPasado = kmEnRango(registrosKm, VEHICULO_PARTNER, desdePasadoStr, hastaPasadoStr);
      plantasPorKm = {
        actual: kmActual > 0 ? Math.round((plantasActual / kmActual) * 10) / 10 : null,
        pasado: kmPasado > 0 ? Math.round((plantasPasado / kmPasado) * 10) / 10 : null,
      };
    } catch {}
  }

  // Germinación (proxy: % que llega vivo al primer trasplante Plantín→F1 — no es
  // germinación pura, mezcla semillas que no germinaron con plantines perdidos en
  // plantinera antes del trasplante, pero es el dato más cercano sin sumar un paso de
  // carga nuevo) y Supervivencia post-trasplante (esto sí preciso: % que entra a F1 y
  // llega vivo a cosecha, sumando F1→F2 + F2→Cosecha) — mes en curso vs. mes pasado.
  let germinacionMes: { actual: number | null; pasado: number | null } = { actual: null, pasado: null };
  let supervivenciaMes: { actual: number | null; pasado: number | null } = { actual: null, pasado: null };
  if (user.rol === 'admin') {
    try {
      const gActual = germinacionYSupervivenciaMes(lotes, movimientos, hoy);
      const gPasado = germinacionYSupervivenciaMes(lotes, movimientos, mesAnteriorRef);
      germinacionMes = { actual: gActual.pctGerminacion, pasado: gPasado.pctGerminacion };
      supervivenciaMes = { actual: gActual.pctSupervivenciaPostTrasplante, pasado: gPasado.pctSupervivenciaPostTrasplante };
    } catch {}
  }

  // ── ÚLTIMOS MOVIMIENTOS, separados por tipo (definido acá arriba porque también
  // hace falta para clasificar cultivo en "Desvíos de cosecha", justo abajo) ──
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));

  // Desvíos de cosecha (antes en la sección "Alertas" propia, ahora solo en el home) —
  // solo admin, últimos 30 días, sin revisar primero. Además del desvío de cantidad
  // (nivel_alerta ya calculado en /api/lotes/cosecha), suma dos alertas de calidad
  // puntuales pedidas explícitamente: descarte de lechuga > 10% de la cosecha del lote
  // (descarte_calculado / plantas_estimadas, mismo % que se usa en el formulario de
  // cosecha), y rúcula armada con más de 3 plantas por paquete (paquetes más chicos).
  // Ventana de 3 días y orden estrictamente por fecha (más reciente primero) — antes eran
  // 30 días agrupados por revisada/nivel, pero eso alejaba lo más reciente de la vista.
  const DIAS_ALERTA_COSECHA = 3;
  const cosechasConAlerta: { mov: Movimiento; motivo: MotivoAlertaCosecha }[] = movimientos
    .filter((m) => m.tipo === 'cosecha')
    .map((m) => {
      const esR = codigoCultivo(lotesMap.get(String(m.id_lote || ''))?.variedad) === 'R';
      const motivo = motivoAlertaCosecha(m, esR);
      return motivo ? { mov: m, motivo } : null;
    })
    .filter((x): x is { mov: Movimiento; motivo: MotivoAlertaCosecha } => x !== null)
    .filter(({ mov }) => { try { const f = new Date(String(mov.fecha)); return (hoy.getTime() - f.getTime()) / 86400000 <= DIAS_ALERTA_COSECHA; } catch { return true; } })
    .sort((a, b) => String(b.mov.fecha || '').localeCompare(String(a.mov.fecha || '')));
  const movsOrdenados = [...movimientos]
    .filter(m => m.fecha)
    .sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||'')));
  const ultimasCosechas = movsOrdenados.filter(m => m.tipo === 'cosecha').slice(0, 4);
  const ultimosTrasplantes = movsOrdenados.filter(m => m.tipo === 'trasplante').slice(0, 4);
  const ultimasSiembras = movsOrdenados.filter(m => m.tipo === 'siembra').slice(0, 4);

  function filaMov(m: Movimiento) {
    const lote = lotesMap.get(String(m.id_lote||''));
    const t = TIPO_LABEL[String(m.tipo||'')] || TIPO_LABEL.descarte;
    const varNorm = String(lote?.variedad||'').toLowerCase();
    const esR = varNorm.includes('rucula')||varNorm.includes('rúcula');
    const cantU = Number(m.unidades_cosechadas||0);
    const cantP = Number(m.plantas_estimadas||0);
    const unidadesStr = m.tipo==='cosecha' && esR && cantU>0
      ? `${cantU.toLocaleString('es-AR')} paq. (${cantP.toLocaleString('es-AR')} pl)`
      : m.tipo==='cosecha' && cantU>0 ? `${cantU.toLocaleString('es-AR')} pl`
      : cantP>0 ? `${cantP.toLocaleString('es-AR')} pl` : '';
    return (
      <div key={m.id_movimiento} style={{ display:'flex', alignItems:'center', gap:'7px', padding:'6px 8px', background:'#fafafa', borderRadius:'6px', borderLeft:`3px solid ${t.color}` }}>
        <span style={{ background:t.bg, color:t.color, fontSize:'9px', fontWeight:700, padding:'1px 5px', borderRadius:'3px', minWidth:'65px', textAlign:'center' }}>{t.label}</span>
        <Link href={`/cultivos/${encodeURIComponent(String(m.id_lote||''))}`} style={{ textDecoration:'none' }}>
          <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:'11px', color:'#111827' }}>{m.id_lote}</span>
        </Link>
        {lote?.variedad && (
          <span style={{ fontSize:'11px', color:esR?'#166534':'#4d7c0f', fontWeight:500 }}>
            {String(lote.variedad).split(' ')[0]}
          </span>
        )}
        {unidadesStr && <span style={{ fontSize:'11px', color:'#6b7280', marginLeft:'auto' }}>{unidadesStr}</span>}
        <span style={{ fontSize:'10px', color:'#9ca3af', whiteSpace:'nowrap' }}>{diasAtras(m.fecha)}</span>
      </div>
    );
  }

  // ── KPIs F2 — rúcula y lechuga desglosada en Crespa/Roble (cada una con su propia
  // última semana con datos, no una sola pareja compartida) ──
  function varPctSem(a:number,b:number){if(!b||!a)return null;return Math.round(((a-b)/b)*100);}
  function ultimoYAnterior(campo: 'rucula'|'lechugaCrespaF2'|'lechugaRobleF2') {
    const conDato = ciclosSemanas.filter((s:any) => s[campo] > 0);
    return { ult: conDato.slice(-1)[0], ant: conDato.slice(-2,-1)[0] };
  }
  const { ult: ultSemRucula, ant: antSemRucula } = ultimoYAnterior('rucula');
  const { ult: ultSemCrespa, ant: antSemCrespa } = ultimoYAnterior('lechugaCrespaF2');
  const { ult: ultSemRoble, ant: antSemRoble } = ultimoYAnterior('lechugaRobleF2');
  // Respaldo cuando no hay comparación semana a semana (0 cosechas esa semana puntual —
  // muy común en lechuga, que tiene un ciclo mucho más largo que rúcula): comparar contra
  // el promedio del mes pasado en vez de dejar el indicador sin ningún %.
  const cicloMesPasado = cicloMesPromedio(lotes, movimientos, mesPasadoRef);

  const hoyStr = new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  // Recordatorio de stock físico en cámara (paquetes) — todos los días, después del
  // mediodía. Se calcula la hora en huso de Argentina explícitamente (no new Date().
  // getHours(), que en el server corre en UTC y dispararía 3 horas antes de tiempo).
  const horaArg = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(new Date()));
  const esDiaStockCamara = horaArg >= 12;

  // Recordatorio de kilometraje del Partner — se pide los sábados, y queda pendiente
  // (se sigue mostrando) todos los días de la semana hasta que se cargue una lectura.
  const faltaKm = faltaCargarEstaSemana(registrosKm, VEHICULO_PARTNER, hoy);
  const ultimaLecturaKm = ultimaLectura(registrosKm, VEHICULO_PARTNER);

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">{hoyStr.charAt(0).toUpperCase()+hoyStr.slice(1)} · Bienvenido, {user.nombre}</p>

        <BuscadorLote baseUrl="/cultivos" />

        {user.rol === 'admin' && <TardanzasHoyBanner />}

        {esDiaStockCamara && (
          <div style={{ background:'#fef3c7', border:'2px solid #f59e0b', borderRadius:'10px', padding:'16px 18px', marginBottom:'14px', display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap' }}>
            <span style={{ fontSize:'28px', lineHeight:1 }}>📦</span>
            <div style={{ flex:1, minWidth:'260px' }}>
              <p style={{ margin:'0 0 4px', fontSize:'15px', fontWeight:800, color:'#92400e' }}>Recordá hacer el stock de paquetes en cámara</p>
              <p style={{ margin:0, fontSize:'12.5px', color:'#78350f' }}>
                Hacelo <strong>una vez que ya se cargaron las cosechas/ventas del día</strong> — nunca a la mitad, porque el conteo queda comparado contra un stock esperado a medio actualizar.
              </p>
            </div>
            <a href="#stock-camara" className="btn secondary" style={{ fontSize:'12px', whiteSpace:'nowrap' }}>Ir a Stock en cámara ↓</a>
          </div>
        )}

        <KilometrajeReminder
          ultimoKm={ultimaLecturaKm ? Number(ultimaLecturaKm.km_acumulado) : null}
          ultimaFecha={ultimaLecturaKm ? ultimaLecturaKm.fecha : null}
          ultimoIdKm={ultimaLecturaKm ? String(ultimaLecturaKm.id_km) : null}
          faltaCargar={faltaKm}
        />

        {/* ══ TAREAS DE HOY ══ */}
        <div style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)', border:'1px solid #bfdbfe', borderRadius:'10px', padding:'14px', marginBottom:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'8px', flexWrap:'wrap', gap:'4px' }}>
              <p style={{ margin:0, fontSize:'14px', fontWeight:800 }}>📋 Tareas de hoy</p>
              <Link href="/planificacion" style={{ fontSize:'11px', color:'#6b7280', textDecoration:'none' }}>Planificación →</Link>
            </div>
            <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', marginBottom:'10px' }}>
                <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700 }}>⚠️ Alertas</p>
                {alertas.length === 0 ? (
                  <p style={{ margin:0, color:'#059669', fontSize:'12px', fontWeight:600 }}>✓ Sin alertas activas</p>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'180px', overflowY:'auto' }}>
                    {alertas.map((a,i) => (
                      <div key={i} style={{ fontSize:'11px', padding:'5px 8px', borderRadius:'5px', background:a.tipo==='error'?'#fef2f2':a.tipo==='warn'?'#fffbeb':'#eff6ff', color:a.tipo==='error'?'#dc2626':a.tipo==='warn'?'#92400e':'#1d4ed8', display:'flex', alignItems:'center', gap:'5px' }}>
                        {a.tipo==='error'?'🔴':a.tipo==='warn'?'🟡':'🔵'}
                        {a.lote ? (
                          <Link href={`/cultivos/${encodeURIComponent(a.lote)}`} style={{ textDecoration:'none', color:'inherit', fontWeight:600 }}>{a.msg}</Link>
                        ) : a.msg}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop:'10px', paddingTop:'8px', borderTop:'1px solid #f3f4f6', fontSize:'11px', color:'#6b7280' }}>
                  Ocup. global (F2): <strong>{ocGlobal}%</strong>
                  {tubosMesadas.map((n:any) => { const f2=(n.mesadas||[]).filter((m:any)=>m.sector_fase!=='fase_1'); const tot=f2.reduce((s:number,m:any)=>s+m.tubos_totales,0); const ocu=f2.reduce((s:number,m:any)=>s+m.tubos_ocupados,0); const pct=tot>0?Math.round(ocu/tot*100):0; return <span key={n.nave}> · N{n.nave}: <strong>{pct}%</strong></span>; })}
                </div>
            </div>
            {siembraHoy && (
              <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', marginBottom:'10px' }}>
                <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700 }}>🌱 Sembrar hoy</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:'10px' }}>
                  <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'7px', padding:'8px 12px', textAlign:'center' }}>
                    <p style={{ margin:0, fontSize:'26px', fontWeight:900, color:'#ca8a04', lineHeight:1 }}>{siembraHoy.rucPl}</p>
                    <p style={{ margin:'2px 0 0', fontSize:'10px', color:'#92400e', fontWeight:600, textTransform:'uppercase' }}>planchas rúcula</p>
                  </div>
                  <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'7px', padding:'8px 12px', textAlign:'center' }}>
                    <p style={{ margin:0, fontSize:'26px', fontWeight:900, color:'#4d7c0f', lineHeight:1 }}>{siembraHoy.lecPl}</p>
                    <p style={{ margin:'2px 0 0', fontSize:'10px', color:'#166534', fontWeight:600, textTransform:'uppercase' }}>planchas lechuga</p>
                  </div>
                </div>
              </div>
            )}
            {tareasHoy.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:'7px', marginBottom: (gruposTrasplante.length > 0 || gruposCosecha.length > 0) ? '10px' : 0 }}>
                {tareasHoy.map((t,i) => {
                  const contenido = (<><span style={{ fontSize:'14px' }}>{t.icon}</span><span style={{ color:'#374151' }}>{t.txt}</span></>);
                  const estilo: React.CSSProperties = { display:'flex', gap:'8px', alignItems:'flex-start', fontSize:'12.5px', lineHeight:1.4, background:'white', borderRadius:'7px', padding:'7px 10px', border:'1px solid #e5e7eb' };
                  return t.href
                    ? <Link key={i} href={t.href} style={{ ...estilo, textDecoration:'none' }}>{contenido}</Link>
                    : <div key={i} style={estilo}>{contenido}</div>;
                })}
              </div>
            )}
            {(gruposCosecha.length > 0 || gruposTrasplante.length > 0 || (user.rol === 'admin' && cosechasConAlerta.length > 0)) && (
              <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', display:'flex', flexDirection:'column', gap:'14px' }}>
                {gruposCosecha.length > 0 && <GruposLotes grupos={gruposCosecha} icono="🌾" etiqueta="Cosechar" />}
                {user.rol === 'admin' && cosechasConAlerta.length > 0 && (
                  <div>
                    <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700, display:'flex', alignItems:'center', gap:'6px' }}>⚠️ Desvíos y calidad de cosecha <span style={{ fontWeight:400, fontSize:'11px', color:'#9ca3af' }}>({DIAS_ALERTA_COSECHA} días)</span></p>
                    <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'220px', overflowY:'auto' }}>
                      {cosechasConAlerta.map(({ mov: m, motivo }) => {
                        const esRoja = motivo === 'descarte' || m.nivel_alerta === 'rojo';
                        const esRev = m.alerta_revisada === 'SI';
                        const descartePct = Number(m.plantas_estimadas) > 0 ? Math.round((Number(m.descarte_calculado) / Number(m.plantas_estimadas)) * 100) : 0;
                        const badgeTxt = motivo === 'descarte' ? `${descartePct}% desc.`
                          : motivo === 'densidad' ? `${Number(m.plantas_por_unidad_real)||0} pl/paq`
                          : `+${Math.round(Number(m.desvio_porcentaje) || 0)}%`;
                        const detalleTxt = motivo === 'descarte' ? `descarte del ${descartePct}% (>10%)`
                          : motivo === 'densidad' ? `rúcula con más de 3 plantas/paquete`
                          : `${Number(m.descarte_calculado)||0} s/id`;
                        return (
                          <div key={m.id_movimiento} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 8px', borderRadius:'6px', background: esRev ? '#f9fafb' : esRoja ? '#fef2f2' : '#fffbeb', opacity: esRev ? 0.7 : 1 }}>
                            <span style={{ background: esRev ? '#e5e7eb' : esRoja ? '#dc2626' : '#d97706', color: esRev ? '#6b7280' : 'white', padding:'1px 7px', borderRadius:'8px', fontSize:'10px', fontWeight:700, flexShrink:0 }}>
                              {badgeTxt}
                            </span>
                            <Link href={`/cultivos/${encodeURIComponent(String(m.id_lote||''))}`} style={{ textDecoration:'none', fontFamily:'monospace', fontWeight:700, fontSize:'11px', color:'#111827' }}>
                              {m.id_lote}
                            </Link>
                            <span style={{ fontSize:'11px', color:'#6b7280', flex:1 }}>
                              {fmtFecha(String(m.fecha||''))} · {Number(m.unidades_cosechadas)||0}u · {detalleTxt}
                              {esRev && <span style={{ color:'#059669', marginLeft:'6px' }}>✓ Revisada</span>}
                            </span>
                            {!esRev && <Link href={`/cultivos/${encodeURIComponent(String(m.id_lote||''))}`} className="btn secondary small" style={{ flexShrink:0 }}>Revisar</Link>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {gruposTrasplante.length > 0 && <GruposLotes grupos={gruposTrasplante} icono="🔄" etiqueta="Trasplantar" />}
              </div>
            )}
        </div>

        {/* ══ FILA 1: VENTAS (+ STOCK EN CÁMARA) + INDICADORES ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:'12px', marginBottom:'14px', alignItems:'start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <GraficoVentaPorArticulo datos={evolArticuloPanel} />
            <div id="stock-camara">
              <AjusteStockCard
                rucula={{ actual: camaraRucula.stockActual, ajusteMes: ajusteMesRucula.acumulado }}
                lechugaCrespa={{ actual: camaraLechugaCrespa.stockActual, ajusteMes: ajusteMesLechugaCrespa.acumulado }}
                lechugaRoble={{ actual: camaraLechugaRoble.stockActual, ajusteMes: ajusteMesLechugaRoble.acumulado }}
              />
            </div>
          </div>
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))', gap:'10px' }}>
              <GrupoIndicadores titulo="Ventas" icono="💰" color="#059669" items={[
                { label: 'Total mes al día', valor: `${resumenMesPanel.unidadesMes.toLocaleString('es-AR')} u`,
                  pct: pctVs(resumenMesPanel.unidadesMes, ventaEsperadaAlDia), mejorSiSube: true },
                { label: 'Total mes proyectada', valor: `${resumenMesPanel.proyeccionMes.toLocaleString('es-AR')} u`,
                  pct: pctVs(resumenMesPanel.proyeccionMes, resumenMesPasadoCompleto.unidadesMes), mejorSiSube: true },
                { label: 'Precio promedio', valor: `$${Math.round(resumenMesPanel.precioPromedioMes).toLocaleString('es-AR')}`,
                  pct: pctVs(resumenMesPanel.precioPromedioMes, resumenMesPasadoCompleto.precioPromedioMes), mejorSiSube: true },
              ]} />
              <GrupoIndicadores titulo="Ciclos" icono="🔄" color="#2563eb" items={[
                { label: 'Rúcula', valor: ultSemRucula?.rucula ? `${ultSemRucula.rucula}d` : '—',
                  pct: varPctSem(ultSemRucula?.rucula, antSemRucula?.rucula) ?? varPctSem(ultSemRucula?.rucula, cicloMesPasado.rucula), mejorSiSube: false },
                { label: 'Lechuga crespa', valor: ultSemCrespa?.lechugaCrespaF2 ? `${ultSemCrespa.lechugaCrespaF2}d` : '—',
                  pct: varPctSem(ultSemCrespa?.lechugaCrespaF2, antSemCrespa?.lechugaCrespaF2) ?? varPctSem(ultSemCrespa?.lechugaCrespaF2, cicloMesPasado.lechugaCrespa), mejorSiSube: false },
                { label: 'Lechuga hoja de roble', valor: ultSemRoble?.lechugaRobleF2 ? `${ultSemRoble.lechugaRobleF2}d` : '—',
                  pct: varPctSem(ultSemRoble?.lechugaRobleF2, antSemRoble?.lechugaRobleF2) ?? varPctSem(ultSemRoble?.lechugaRobleF2, cicloMesPasado.lechugaRoble), mejorSiSube: false },
              ]} />
              <GrupoIndicadores titulo="Pesos" icono="⚖️" color="#d97706" items={[
                { label: 'Rúcula (paq)', valor: pesoMesPanel.rucula > 0 ? `${pesoMesPanel.rucula}g` : '—',
                  pct: pctVs(pesoMesPanel.rucula, pesoMesPasadoPanel.rucula), mejorSiSube: true },
                { label: 'Lechuga crespa (paq)', valor: pesoMesPanel.lechugaCrespa > 0 ? `${pesoMesPanel.lechugaCrespa}g` : '—',
                  pct: pctVs(pesoMesPanel.lechugaCrespa, pesoMesPasadoPanel.lechugaCrespa), mejorSiSube: true },
                { label: 'Lechuga hoja de roble (paq)', valor: pesoMesPanel.lechugaRoble > 0 ? `${pesoMesPanel.lechugaRoble}g` : '—',
                  pct: pctVs(pesoMesPanel.lechugaRoble, pesoMesPasadoPanel.lechugaRoble), mejorSiSube: true },
              ]} />
              <GrupoIndicadores titulo="Ocupación" icono="🏠" color="#7c3aed" link={{ href: '/ocupacion', texto: 'Ver por mesada →' }} items={[
                { label: 'Nave 1', valor: `${ocupNaves.find((n:any)=>n.nave===1)?.pct ?? 0}%`, pct: null, mejorSiSube: true },
                { label: 'Nave 2', valor: `${ocupNaves.find((n:any)=>n.nave===2)?.pct ?? 0}%`, pct: null, mejorSiSube: true },
              ]} />
              {user.rol === 'admin' && (
                <GrupoIndicadores titulo="Producción" icono="📊" color="#0f766e" items={[
                  ...(productividad.actual !== null ? [{
                    label: 'Productividad (paq/hs hombre)', valor: `${productividad.actual.toLocaleString('es-AR')} paq/h`,
                    pct: productividad.pasado !== null ? pctVs(productividad.actual, productividad.pasado) : null, mejorSiSube: true,
                  }] : []),
                  ...(descarteMes.actual !== null ? [{
                    label: 'Descartes (mes)', valor: `${descarteMes.actual.toLocaleString('es-AR')} pl`,
                    pct: descarteMes.pasado !== null ? pctVs(descarteMes.actual, descarteMes.pasado) : null, mejorSiSube: false,
                    detalle: descarteMes.porFase
                      ? `Plantín→F1 ${descarteMes.porFase.plantinF1.toLocaleString('es-AR')} · F1→F2 ${descarteMes.porFase.f1F2.toLocaleString('es-AR')} · F2→Cosecha ${descarteMes.porFase.f2Cosecha.toLocaleString('es-AR')}`
                      : undefined,
                  }] : []),
                  ...(plantasPorKm.actual !== null ? [{
                    label: 'Plantas cosechadas / km', valor: `${plantasPorKm.actual.toLocaleString('es-AR')} pl/km`,
                    pct: plantasPorKm.pasado !== null ? pctVs(plantasPorKm.actual, plantasPorKm.pasado) : null, mejorSiSube: true,
                  }] : []),
                  ...(germinacionMes.actual !== null ? [{
                    label: 'Germinación (proxy)', valor: `${germinacionMes.actual}%`,
                    pct: germinacionMes.pasado !== null ? pctVs(germinacionMes.actual, germinacionMes.pasado) : null, mejorSiSube: true,
                    detalle: '% que llega vivo al primer trasplante — mezcla no-germinó + pérdida temprana en plantinera',
                  }] : []),
                  ...(supervivenciaMes.actual !== null ? [{
                    label: 'Supervivencia post-trasplante', valor: `${supervivenciaMes.actual}%`,
                    pct: supervivenciaMes.pasado !== null ? pctVs(supervivenciaMes.actual, supervivenciaMes.pasado) : null, mejorSiSube: true,
                    detalle: '% que entra a F1 y llega vivo a cosecha (F1→F2 + F2→Cosecha)',
                  }] : []),
                ]} />
              )}
            </div>
            <p style={{ margin:'8px 0 0', fontSize:'10px', color:'#9ca3af' }}>% vs. mes pasado (ocupación: sin histórico para comparar · descartes y producción: hasta hoy vs. hasta el mismo día del mes pasado)</p>
          </div>
        </div>

        {/* ══ FILA 2: CICLOS + ACTIVIDAD ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:'12px', marginBottom:'14px', alignItems:'start' }}>
            <div className="card" style={{ margin:0 }}>
              <p className="card-title">Ciclos en mesadas — 8 semanas</p>
              <p className="card-sub">Días promedio F2 por semana · sin plantinera</p>
              <GraficoCiclosSemanas datos={ciclosSemanas} />
              {(() => {
                const semanaActual = ciclosSemanas[ciclosSemanas.length - 1];
                // Cada serie usa su propia "última semana con cosecha" (no una compartida) —
                // el % solo se muestra si esa última cosecha fue justo esta semana; si es de
                // una semana más vieja, se avisa en vez de mostrar un % que compararía dos
                // semanas salteadas entre sí.
                const crespaPct = ultSemCrespa === semanaActual ? (varPctSem(ultSemCrespa?.lechugaCrespaF2, antSemCrespa?.lechugaCrespaF2) ?? varPctSem(ultSemCrespa?.lechugaCrespaF2, cicloMesPasado.lechugaCrespa)) : null;
                const roblePct = ultSemRoble === semanaActual ? (varPctSem(ultSemRoble?.lechugaRobleF2, antSemRoble?.lechugaRobleF2) ?? varPctSem(ultSemRoble?.lechugaRobleF2, cicloMesPasado.lechugaRoble)) : null;
                const ruculaPct = ultSemRucula === semanaActual ? (varPctSem(ultSemRucula?.rucula, antSemRucula?.rucula) ?? varPctSem(ultSemRucula?.rucula, cicloMesPasado.rucula)) : null;
                const badges = [
                  { key: 'crespa', label: 'Lechuga Crespa F2', val: ultSemCrespa?.lechugaCrespaF2 ?? 0, pct: crespaPct, bg: '#f7fee7', color: '#4d7c0f' },
                  { key: 'roble', label: 'Lechuga Roble F2', val: ultSemRoble?.lechugaRobleF2 ?? 0, pct: roblePct, bg: '#f0fdf4', color: '#166534' },
                  { key: 'rucula', label: 'Rúcula F2', val: ultSemRucula?.rucula ?? 0, pct: ruculaPct, bg: '#ecfdf5', color: '#065f46' },
                ].filter(b => b.val > 0);
                if (!badges.length) return null;
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:'8px', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #f3f4f6' }}>
                    {badges.map(b => (
                      <div key={b.key} style={{ textAlign:'center', padding:'8px', background:b.bg, borderRadius:'7px' }}>
                        <p style={{ margin:'0 0 1px', fontSize:'10px', color:b.color, fontWeight:700 }}>{b.label}</p>
                        <p style={{ margin:'0 0 1px', fontSize:'22px', fontWeight:800, color:'#14532d' }}>{b.val}d</p>
                        {b.pct !== null ? (
                          <p style={{ margin:0, fontSize:'10px', fontWeight:600, color:b.pct<=0?'#059669':'#dc2626' }}>
                            {b.pct<=0?'↓':'↑'} {Math.abs(b.pct)}%
                          </p>
                        ) : (
                          <p style={{ margin:0, fontSize:'10px', color:'#9ca3af' }}>sin cosecha esta sem.</p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

          {/* Últimos movimientos, por tipo */}
          <div className="card" style={{ margin:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <p className="card-title" style={{ margin:0 }}>Últimos movimientos</p>
              <Link href="/movimientos" style={{ fontSize:'11px', color:'#6b7280', textDecoration:'none' }}>Ver todos →</Link>
            </div>
            {ultimasCosechas.length===0 && ultimosTrasplantes.length===0 && ultimasSiembras.length===0 ? (
              <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'20px' }}>Sin movimientos</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {[
                  { titulo: '🌾 Últimas cosechas', movs: ultimasCosechas },
                  { titulo: '🔄 Últimos trasplantes', movs: ultimosTrasplantes },
                  { titulo: '🌱 Últimas siembras', movs: ultimasSiembras },
                ].map(({ titulo, movs }) => movs.length > 0 && (
                  <div key={titulo}>
                    <p style={{ margin:'0 0 5px', fontSize:'10px', color:'#6b7280', fontWeight:700, textTransform:'uppercase' }}>{titulo}</p>
                    <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                      {movs.map(filaMov)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ══ FILA 3: PROYECCIÓN DE COSECHA SEMANAL — gráfico angosto + datos al lado
            (antes ocupaba todo el ancho, quedaba enorme) ══ */}
        <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px', marginBottom:'14px' }}>
          <p style={{ margin:'0 0 3px', fontSize:'11px', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.3px' }}>Proyección de cosecha semanal</p>
          <p style={{ margin:'0 0 10px', fontSize:'10px', color:'#9ca3af' }}>Paquetes esperados por semana · rúcula vs. lechuga</p>
          <div style={{ display:'grid', gridTemplateColumns:'minmax(280px,420px) 1fr', gap:'20px', alignItems:'start' }}>
            <GraficoDistribucionMesadas datos={proyeccionCosecha} />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'16px' }}>
              <div>
                <p style={{ margin:'0 0 6px', fontSize:'10px', color:'#9ca3af', fontWeight:700, textTransform:'uppercase' }}>Por semana</p>
                <table style={{ fontSize:'11px', width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr style={{ color:'#9ca3af' }}>
                    <th style={{ textAlign:'left', padding:'2px 4px', fontWeight:600 }}>Sem.</th>
                    <th style={{ textAlign:'right', padding:'2px 4px', fontWeight:600, color:'#134e4a' }}>Rúc.</th>
                    <th style={{ textAlign:'right', padding:'2px 4px', fontWeight:600, color:'#84cc16' }}>Lech.</th>
                  </tr></thead>
                  <tbody>
                    {proyeccionCosecha.map((d: any, i: number) => (
                      <tr key={d.semana} style={{ borderTop:'1px solid #f3f4f6', fontWeight:i===0?700:400, color:i===0?'#111827':'#374151' }}>
                        <td style={{ padding:'3px 4px' }}>{d.label}</td>
                        <td style={{ textAlign:'right', padding:'3px 4px' }}>{d.rucula > 0 ? d.rucula.toLocaleString('es-AR') : '—'}</td>
                        <td style={{ textAlign:'right', padding:'3px 4px' }}>{d.lechuga > 0 ? d.lechuga.toLocaleString('es-AR') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p style={{ margin:'0 0 6px', fontSize:'10px', color:'#9ca3af', fontWeight:700, textTransform:'uppercase' }}>Total acumulado por mes</p>
                <table style={{ fontSize:'11px', width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr style={{ color:'#9ca3af' }}>
                    <th style={{ textAlign:'left', padding:'2px 4px', fontWeight:600 }}>Mes</th>
                    <th style={{ textAlign:'right', padding:'2px 4px', fontWeight:600, color:'#134e4a' }}>Rúc.</th>
                    <th style={{ textAlign:'right', padding:'2px 4px', fontWeight:600, color:'#84cc16' }}>Lech.</th>
                  </tr></thead>
                  <tbody>
                    {proyeccionPorMes(proyeccionCosecha).map((m) => (
                      <tr key={m.label} style={{ borderTop:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'3px 4px', fontWeight:600 }}>{m.label}</td>
                        <td style={{ textAlign:'right', padding:'3px 4px' }}>{Math.round(m.rucula).toLocaleString('es-AR')}</td>
                        <td style={{ textAlign:'right', padding:'3px 4px' }}>{Math.round(m.lechuga).toLocaleString('es-AR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* ══ NUEVO LOTE ══ — Ocupación, Actividad y Estadísticas ya tienen su propio
            "Ver detalle →"/"Ver todos →" en las tarjetas de arriba. */}
        <div className="card" style={{ marginBottom:'14px' }}>
          <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
        </div>

      </div>
    </>
  );
}
