import { readSheet } from './sheets';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, PrecioVenta, ClienteVenta, VentaHistorica, StockCamara } from './types';
import { tubosPorMesada } from './ocupacion';
import { calcularDiasPorFase } from './lotes';
import { proyeccionCosechaSemanal, ciclosPorSemana, pesoPromedioRango, pesoPromedioMes, mesAnteriorClamp, type PesoPromedioMes } from './estadisticas';
import { calcularCamara, diferenciaAjustesMes } from './camara';
import { evolucionVentaPorArticuloSemanal, resumenMesActual, ventasEnRango, type PuntoArticulo, type VentasRango, type ResumenMesActual } from './estadisticasVentas';

function lunesDe(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
const esRuculaV = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

function cicloMesPromedio(lotes: Lote[], movimientos: Movimiento[], fechaRef: Date): { rucula: number; lechuga: number } {
  const acc = { rucula: [] as number[], lechuga: [] as number[] };
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    const f = new Date(String(l.fecha_cosecha) + 'T12:00:00');
    if (isNaN(f.getTime()) || f.getFullYear() !== fechaRef.getFullYear() || f.getMonth() !== fechaRef.getMonth()) continue;
    let f2 = 0;
    try { f2 = calcularDiasPorFase(l, movimientos).fase_2; } catch { continue; }
    if (f2 <= 0) continue;
    (esRuculaV(l.variedad) ? acc.rucula : acc.lechuga).push(f2);
  }
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  return { rucula: avg(acc.rucula), lechuga: avg(acc.lechuga) };
}

export interface ReporteSemanalData {
  fechaGenerado: string;
  ventasSemana: VentasRango;
  ventasSemanaAnterior: VentasRango;
  ventasMesActual: ResumenMesActual;
  proyeccionProximaSemana: { rucula: number; lechuga: number };
  proyeccionSemanas: { label: string; rucula: number; lechuga: number }[];
  cosechaRealSemanaAnterior: { rucula: number; lechuga: number };
  cicloSemana: { rucula: number; lechuga: number };
  cicloSemanaAnterior: { rucula: number; lechuga: number };
  cicloMesAnterior: { rucula: number; lechuga: number };
  pesoSemana: PesoPromedioMes;
  pesoMesAnterior: PesoPromedioMes;
  ocupacion: { nave: number; pct: number }[];
  mesadasBajas: { nombre: string; nave: number; pct: number }[];
  evolArticuloSemanal: PuntoArticulo[];
  stock: { rucula: number; lechuga: number };
  faltanteMes: { rucula: number; lechuga: number; total: number };
}

export async function obtenerDatosReporteSemanal(): Promise<ReporteSemanalData> {
  const [lotes, movimientos, ubicaciones, variedades, ventas, precios, clientes, historicas, registrosCamara] = await Promise.all([
    readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'), readSheet<VentaDia>('Ventas'), readSheet<PrecioVenta>('Precios'),
    readSheet<ClienteVenta>('Clientes'),
    readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
    readSheet<StockCamara>('StockCamara').catch(() => []),
  ]);
  void historicas; // no se usa en la evolución semanal (los históricos son totales mensuales)

  const hoy = new Date();

  // ── Ventas: últimos 7 días vs los 7 días anteriores a esos ──
  const hastaHoy = fmtISO(hoy);
  const desdeSemana = fmtISO(new Date(hoy.getTime() - 6 * 86400000));
  const hastaAnt = fmtISO(new Date(hoy.getTime() - 7 * 86400000));
  const desdeAnt = fmtISO(new Date(hoy.getTime() - 13 * 86400000));
  const ventasSemana = ventasEnRango(ventas, precios, clientes, desdeSemana, hastaHoy);
  const ventasSemanaAnterior = ventasEnRango(ventas, precios, clientes, desdeAnt, hastaAnt);

  // ── Ventas del mes en curso: acumulado a hoy y proyección a fin de mes ──
  const ventasMesActual = resumenMesActual(ventas, precios, clientes, hoy);

  // ── Proyección de cosecha (calendario, próximas 6 semanas) vs. lo realmente cosechado la semana pasada ──
  const proyeccionRaw = proyeccionCosechaSemanal(lotes, variedades, 6);
  const proyeccionSemanas = proyeccionRaw.map(p => ({ label: p.label, rucula: p.rucula, lechuga: p.lechuga }));
  const proyeccionProximaSemana = proyeccionRaw[1] || { rucula: 0, lechuga: 0 };
  const lunesEstaSemana = lunesDe(hoy);
  const lunesSemanaPasada = new Date(lunesEstaSemana); lunesSemanaPasada.setDate(lunesSemanaPasada.getDate() - 7);
  const domingoSemanaPasada = new Date(lunesEstaSemana); domingoSemanaPasada.setDate(domingoSemanaPasada.getDate() - 1);
  domingoSemanaPasada.setHours(23, 59, 59);
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const cosechaRealSemanaAnterior = { rucula: 0, lechuga: 0 };
  for (const m of movimientos) {
    if (m.tipo !== 'cosecha' || !m.fecha) continue;
    const f = new Date(String(m.fecha) + 'T12:00:00');
    if (isNaN(f.getTime()) || f < lunesSemanaPasada || f > domingoSemanaPasada) continue;
    const lote = lotesMap.get(String(m.id_lote));
    if (!lote) continue;
    const cant = Number(m.unidades_cosechadas) || 0;
    if (cant <= 0) continue;
    if (esRuculaV(lote.variedad)) cosechaRealSemanaAnterior.rucula += cant; else cosechaRealSemanaAnterior.lechuga += cant;
  }

  // ── Ciclos F2: esta semana vs. semana pasada (rolling, mismo criterio que el Panel) y vs. mes pasado ──
  const ciclosSemanas = ciclosPorSemana(lotes, movimientos);
  const ultSem = ciclosSemanas[ciclosSemanas.length - 1] || { rucula: 0, lechugaF2: 0 };
  const antSem = ciclosSemanas[ciclosSemanas.length - 2] || { rucula: 0, lechugaF2: 0 };
  const cicloSemana = { rucula: ultSem.rucula || 0, lechuga: ultSem.lechugaF2 || 0 };
  const cicloSemanaAnterior = { rucula: antSem.rucula || 0, lechuga: antSem.lechugaF2 || 0 };
  const mesPasadoRef = mesAnteriorClamp(hoy);
  const cicloMesAnterior = cicloMesPromedio(lotes, movimientos, mesPasadoRef);

  // ── Peso promedio de esta semana vs. promedio del mes pasado completo ──
  const desde7 = new Date(hoy); desde7.setDate(desde7.getDate() - 7);
  const pesoSemana = pesoPromedioRango(lotes, desde7, hoy);
  const pesoMesAnterior = pesoPromedioMes(lotes, mesPasadoRef);

  // ── Ocupación por nave (F2) + mesadas puntuales por debajo del 90% ──
  const tubosMesadas = tubosPorMesada(ubicaciones, lotes);
  const ocupacion = tubosMesadas.map((n: any) => {
    const f2 = (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round((ocu / tot) * 100) : 0 };
  });
  const mesadasBajas = tubosMesadas.flatMap((n: any) => (n.mesadas || [])
    .filter((m: any) => m.sector_fase !== 'fase_1' && m.tubos_totales > 10 && m.ocupacion_pct < 90)
    .map((m: any) => ({ nombre: String(m.nombre).replace(/^Nave \d+ - /, ''), nave: n.nave, pct: m.ocupacion_pct })))
    .sort((a: any, b: any) => a.pct - b.pct);

  // ── Evolución de venta por artículo, por semana (últimas 6 semanas completas) ──
  const evolArticuloSemanal = evolucionVentaPorArticuloSemanal(ventas, 6);

  // ── Stock en cámara + faltante acumulado por ajustes del mes en curso ──
  const stock = {
    rucula: calcularCamara('rucula', registrosCamara, lotes, ventas).stockActual,
    lechuga: calcularCamara('lechuga', registrosCamara, lotes, ventas).stockActual,
  };
  const ajusteRuc = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventas, hoy);
  const ajusteLec = diferenciaAjustesMes('lechuga', registrosCamara, lotes, ventas, hoy);
  const faltanteMes = { rucula: ajusteRuc.acumulado, lechuga: ajusteLec.acumulado, total: ajusteRuc.acumulado + ajusteLec.acumulado };

  return {
    fechaGenerado: fmtISO(hoy),
    ventasSemana, ventasSemanaAnterior, ventasMesActual,
    proyeccionProximaSemana, proyeccionSemanas, cosechaRealSemanaAnterior,
    cicloSemana, cicloSemanaAnterior, cicloMesAnterior,
    pesoSemana, pesoMesAnterior,
    ocupacion, mesadasBajas, evolArticuloSemanal,
    stock, faltanteMes,
  };
}

// ── Armado del mail y envío (Resend) ──

const fmtN = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
function pct(actual: number, ref: number): number | null { return ref ? Math.round(((actual - ref) / ref) * 100) : null; }
function flechaHtml(p: number | null, mejorSiSube: boolean): string {
  if (p === null) return '<span style="color:#9ca3af">—</span>';
  const bueno = mejorSiSube ? p > 0 : p < 0;
  const color = p === 0 ? '#9ca3af' : bueno ? '#059669' : '#dc2626';
  const flecha = p > 0 ? '↑' : p < 0 ? '↓' : '·';
  return `<span style="color:${color};font-weight:700">${flecha} ${Math.abs(p)}%</span>`;
}
// Igual que flechaHtml pero en paquetes en vez de %, para valores que pueden cruzar cero
// (un % ahí no dice nada útil — ej. pasar de -10 a +3 no es "-130%").
function flechaPaqHtml(delta: number, mejorSiSube: boolean): string {
  const bueno = mejorSiSube ? delta > 0 : delta < 0;
  const color = delta === 0 ? '#9ca3af' : bueno ? '#059669' : '#dc2626';
  const flecha = delta > 0 ? '↑' : delta < 0 ? '↓' : '·';
  return `<span style="color:${color};font-weight:700">${flecha} ${Math.abs(delta)} paq</span>`;
}

function filaVentas(label: string, actual: { unidades: number; monto: number }, ref: { unidades: number; monto: number }): string {
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(actual.unidades)} u</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtMoneda(actual.monto)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(actual.unidades, ref.unidades), true)}</td>
  </tr>`;
}

// Gráfico de barras "email-safe": dos series por columna, con altura real (no
// acumulada a 100%) — para venta por artículo semanal y proyección de cosecha.
function graficoBarrasHtml(
  puntos: { label: string; a: number; b: number }[],
  colorA: string, colorB: string, nombreA: string, nombreB: string
): string {
  const max = Math.max(...puntos.flatMap(p => [p.a, p.b]), 1);
  const ALTO = 70;
  const cols = puntos.map(p => {
    const hA = Math.max(1, Math.round((p.a / max) * ALTO));
    const hB = Math.max(1, Math.round((p.b / max) * ALTO));
    return `<td style="text-align:center;vertical-align:bottom;padding:0 6px">
      <div style="display:flex;gap:3px;align-items:flex-end;justify-content:center;height:${ALTO}px">
        <div style="width:14px;height:${p.a > 0 ? hA : 0}px;background:${colorA};border-radius:2px 2px 0 0" title="${nombreA} ${p.a}"></div>
        <div style="width:14px;height:${p.b > 0 ? hB : 0}px;background:${colorB};border-radius:2px 2px 0 0" title="${nombreB} ${p.b}"></div>
      </div>
      <div style="font-size:9px;color:#9ca3af;margin-top:3px;white-space:nowrap">${p.label}</div>
    </td>`;
  }).join('');
  return `<table style="border-collapse:collapse"><tr>${cols}</tr></table>
    <p style="font-size:11px;color:#9ca3af;margin:6px 0 0">
      <span style="color:${colorA}">■</span> ${nombreA} · <span style="color:${colorB}">■</span> ${nombreB}
    </p>`;
}

export function construirHtml(d: ReporteSemanalData): string {
  const totalActual = {
    unidades: d.ventasSemana.rucula.unidades + d.ventasSemana.lechuga.unidades,
    monto: d.ventasSemana.rucula.monto + d.ventasSemana.lechuga.monto,
  };
  const totalAnterior = {
    unidades: d.ventasSemanaAnterior.rucula.unidades + d.ventasSemanaAnterior.lechuga.unidades,
    monto: d.ventasSemanaAnterior.rucula.monto + d.ventasSemanaAnterior.lechuga.monto,
  };
  const ventasFilas = filaVentas('Rúcula', d.ventasSemana.rucula, d.ventasSemanaAnterior.rucula)
    + filaVentas('Lechuga', d.ventasSemana.lechuga, d.ventasSemanaAnterior.lechuga)
    + `<tr style="background:#fafafa"><td style="padding:6px 10px;font-weight:800">Total</td>
        <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtN(totalActual.unidades)} u</td>
        <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtMoneda(totalActual.monto)}</td>
        <td style="padding:6px 10px;text-align:right">${flechaHtml(pct(totalActual.unidades, totalAnterior.unidades), true)}</td>
      </tr>`;

  const cosechaFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const proy = d.proyeccionProximaSemana[c];
    const real = d.cosechaRealSemanaAnterior[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(proy)} paq/u</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(real)} paq/u</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(proy, real), true)}</td>
    </tr>`;
  }).join('');

  const ciclosPesoFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const ciclo = d.cicloSemana[c], cicloAntSem = d.cicloSemanaAnterior[c], cicloAntMes = d.cicloMesAnterior[c];
    const peso = d.pesoSemana[c], pesoAnt = d.pesoMesAnterior[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${ciclo > 0 ? ciclo + 'd' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(ciclo, cicloAntSem), false)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(ciclo, cicloAntMes), false)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${peso > 0 ? peso + 'g' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(peso, pesoAnt), true)}</td>
    </tr>`;
  }).join('');

  const stockFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const falt = d.faltanteMes[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(d.stock[c])} paq</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${falt >= 0 ? '+' : ''}${falt} paq</td>
    </tr>`;
  }).join('');
  const stockTotalRow = `<tr style="background:#fafafa">
    <td style="padding:6px 10px;font-weight:800">Total</td>
    <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtN(d.stock.rucula + d.stock.lechuga)} paq</td>
    <td style="padding:6px 10px;text-align:right;font-weight:800">${d.faltanteMes.total >= 0 ? '+' : ''}${d.faltanteMes.total} paq</td>
  </tr>`;

  const ocupacionHtml = d.ocupacion.map(o =>
    `<div style="display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 16px;margin-right:10px">
      <div style="font-size:11px;color:#6b7280">NAVE ${o.nave}</div>
      <div style="font-size:20px;font-weight:800;color:#111827">${o.pct}%</div>
    </div>`
  ).join('');
  const mesadasBajasHtml = d.mesadasBajas.length === 0
    ? '<p style="color:#059669;font-size:13px;margin:10px 0 0">✓ Ninguna mesada F2 por debajo del 90%.</p>'
    : `<ul style="margin:10px 0 0;padding-left:18px;font-size:13px;color:#374151">${d.mesadasBajas.map(m =>
        `<li style="margin-bottom:4px">N${m.nave} · ${m.nombre}: <strong style="color:${m.pct < 70 ? '#dc2626' : '#d97706'}">${m.pct}%</strong></li>`
      ).join('')}</ul>`;

  const evolArticuloChart = graficoBarrasHtml(
    d.evolArticuloSemanal.map(p => ({ label: p.label, a: p.rucula, b: p.lechuga })),
    '#166534', '#4d7c0f', 'Rúcula', 'Lechuga'
  );
  const proyeccionChart = graficoBarrasHtml(
    d.proyeccionSemanas.map(p => ({ label: p.label, a: p.rucula, b: p.lechuga })),
    '#166534', '#4d7c0f', 'Rúcula', 'Lechuga'
  );

  return `
  <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
    <h2 style="margin:0 0 4px">Reporte semanal — Xavia</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px">${d.fechaGenerado}</p>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — últimos 7 días <span style="font-weight:400;color:#9ca3af">(vs. 7 días anteriores)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Unidades</th><th style="padding:6px 10px;text-align:right">Total $</th><th style="padding:6px 10px;text-align:right">vs. semana ant.</th></tr></thead>
      <tbody>${ventasFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — mes en curso</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">&nbsp;</th><th style="padding:6px 10px;text-align:right">Unidades</th></tr></thead>
      <tbody>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">Acumulado al día de hoy</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(d.ventasMesActual.unidadesMes)} u</td></tr>
        <tr><td style="padding:6px 10px;font-weight:600">Proyectado a fin de mes</td><td style="padding:6px 10px;text-align:right">${fmtN(d.ventasMesActual.proyeccionMes)} u</td></tr>
      </tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Proyección de cosecha — próxima semana <span style="font-weight:400;color:#9ca3af">(vs. real cosechado semana pasada)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:14px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Próx. semana (est.)</th><th style="padding:6px 10px;text-align:right">Semana pasada (real)</th><th style="padding:6px 10px;text-align:right">Var.</th></tr></thead>
      <tbody>${cosechaFilas}</tbody>
    </table>
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280">Proyección de las próximas semanas:</p>
    <div style="margin-bottom:20px">${proyeccionChart}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Ciclos y peso de esta semana</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Ciclo F2</th><th style="padding:6px 10px;text-align:right">vs. sem. ant.</th><th style="padding:6px 10px;text-align:right">vs. mes ant.</th><th style="padding:6px 10px;text-align:right">Peso prom.</th><th style="padding:6px 10px;text-align:right">vs. mes ant.</th></tr></thead>
      <tbody>${ciclosPesoFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Stock en cámara <span style="font-weight:400;color:#9ca3af">(faltante acumulado por ajustes este mes)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Stock actual</th><th style="padding:6px 10px;text-align:right">Faltante mes</th></tr></thead>
      <tbody>${stockFilas}${stockTotalRow}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ocupación por nave</h3>
    <div style="margin-bottom:6px">${ocupacionHtml}</div>
    <p style="margin:10px 0 0;font-size:12px;color:#6b7280">Mesadas F2 por debajo del 90%:</p>
    <div style="margin-bottom:20px">${mesadasBajasHtml}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Evolución de venta por artículo <span style="font-weight:400;color:#9ca3af">(últimas 6 semanas)</span></h3>
    <div style="margin-bottom:10px">${evolArticuloChart}</div>
  </div>`;
}

export async function enviarReporteSemanal(): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const datos = await obtenerDatosReporteSemanal();
    const html = construirHtml(datos);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `Reporte semanal — Xavia — ${datos.fechaGenerado}`,
        html,
      }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); return { ok: false, error: (err as any).message || `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al generar el reporte' };
  }
}
