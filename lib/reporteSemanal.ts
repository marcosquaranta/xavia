import { readSheet } from './sheets';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, PrecioVenta, ClienteVenta, VentaHistorica, StockCamara } from './types';
import { tubosPorMesada } from './ocupacion';
import { proyeccionCosechaSemanal, ciclosPorSemana, pesoPromedioRango, pesoPromedioMes, mesAnteriorClamp, cicloMesPromedio, type PesoPromedioMes } from './estadisticas';
import { calcularCamara, diferenciaAjustesMes } from './camara';
import { ventasPorCultivoUltimasSemanas, resumenMesActual, ventasEnRango, type PuntoVentaCultivoSemana, type VentasRango, type ResumenMesActual } from './estadisticasVentas';

function lunesDe(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
const esRuculaV = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

export interface ReporteSemanalData {
  fechaGenerado: string;
  ventasSemana: VentasRango;
  ventasSemanaAnterior: VentasRango;
  ventasMesActual: ResumenMesActual;
  ventasMesAnteriorTotal: number;
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
  ventasSemanas: PuntoVentaCultivoSemana[];
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
  const mesPasadoRef = mesAnteriorClamp(hoy);

  // ── Ventas: últimos 7 días vs los 7 días anteriores a esos ──
  const hastaHoy = fmtISO(hoy);
  const desdeSemana = fmtISO(new Date(hoy.getTime() - 6 * 86400000));
  const hastaAnt = fmtISO(new Date(hoy.getTime() - 7 * 86400000));
  const desdeAnt = fmtISO(new Date(hoy.getTime() - 13 * 86400000));
  const ventasSemana = ventasEnRango(ventas, precios, clientes, desdeSemana, hastaHoy);
  const ventasSemanaAnterior = ventasEnRango(ventas, precios, clientes, desdeAnt, hastaAnt);

  // ── Ventas del mes en curso: acumulado a hoy, proyección a fin de mes y total real del mes pasado ──
  const ventasMesActual = resumenMesActual(ventas, precios, clientes, hoy);
  const diasEnMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1, 0).getDate();
  const ventasMesAnteriorTotal = resumenMesActual(ventas, precios, clientes, mesPasadoRef, diasEnMesPasado).unidadesMes;

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

  // ── Ventas por cultivo, últimas 4 semanas calendario completas (lunes a domingo) ──
  const ventasSemanas = ventasPorCultivoUltimasSemanas(ventas, precios, clientes, 4);

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
    ventasSemana, ventasSemanaAnterior, ventasMesActual, ventasMesAnteriorTotal,
    proyeccionProximaSemana, proyeccionSemanas, cosechaRealSemanaAnterior,
    cicloSemana, cicloSemanaAnterior, cicloMesAnterior,
    pesoSemana, pesoMesAnterior,
    ocupacion, mesadasBajas, ventasSemanas,
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
// acumulada a 100%) — para proyección de cosecha. Usa tablas anidadas con una celda
// "espaciadora" arriba de cada barra en vez de flexbox: Outlook (y varios clientes de
// mail más) no soporta display:flex, así que las barras quedaban colgando desde arriba
// en vez de crecer desde una base común abajo. Con tablas, cada <td> apila de forma
// predecible en cualquier cliente.
function graficoBarrasHtml(
  puntos: { label: string; a: number; b: number }[],
  colorA: string, colorB: string, nombreA: string, nombreB: string
): string {
  const max = Math.max(...puntos.flatMap(p => [p.a, p.b]), 1);
  const ALTO = 70;
  const barraHtml = (valor: number, color: string, nombre: string) => {
    const h = Math.max(1, Math.round((valor / max) * ALTO));
    const espacio = Math.max(0, ALTO - h);
    return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="height:${espacio}px;line-height:${espacio}px;font-size:1px">&nbsp;</td>
      </tr><tr>
        <td width="14" style="width:14px;height:${valor > 0 ? h : 0}px;line-height:${valor > 0 ? h : 0}px;background:${color};border-radius:2px 2px 0 0;font-size:1px" title="${nombre} ${valor}">&nbsp;</td>
      </tr></table>`;
  };
  const cols = puntos.map(p => `<td style="text-align:center;vertical-align:bottom;padding:0 6px">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="vertical-align:bottom;padding:0 1px">${barraHtml(p.a, colorA, nombreA)}</td>
        <td style="vertical-align:bottom;padding:0 1px">${barraHtml(p.b, colorB, nombreB)}</td>
      </tr></table>
      <div style="font-size:9px;color:#9ca3af;margin-top:3px;white-space:nowrap">${p.label}</div>
      <div style="font-size:9px;color:${colorA};font-weight:700;white-space:nowrap">${fmtN(p.a)}</div>
      <div style="font-size:9px;color:${colorB};font-weight:700;white-space:nowrap">${fmtN(p.b)}</div>
    </td>`).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cols}</tr></table>
    <p style="font-size:11px;color:#9ca3af;margin:6px 0 0">
      <span style="color:${colorA}">■</span> ${nombreA} · <span style="color:${colorB}">■</span> ${nombreB}
    </p>`;
}

// Gráfico de líneas (SVG inline) con puntos y valores — para la evolución de venta por
// artículo. Gmail (donde se lee este mail) soporta SVG inline en el body.
function graficoLineasHtml(
  puntos: { label: string; a: number; b: number }[],
  colorA: string, colorB: string, nombreA: string, nombreB: string
): string {
  const max = Math.max(...puntos.flatMap(p => [p.a, p.b]), 1);
  const n = puntos.length;
  const W = 600, H = 190, PL = 8, PR = 8, T = 26, B = H - 24;
  const px = (i: number) => n <= 1 ? (PL + (W - PR)) / 2 : PL + (i * (W - PR - PL)) / (n - 1);
  const py = (v: number) => B - (v / max) * (B - T);
  const pathDe = (key: 'a' | 'b') => puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(p[key])}`).join(' ');
  const puntosDe = (key: 'a' | 'b', color: string) => puntos.map((p, i) => `
    <circle cx="${px(i)}" cy="${py(p[key])}" r="4" fill="${color}" />
    <text x="${px(i)}" y="${py(p[key]) - 8}" text-anchor="middle" font-size="10" fill="${color}" font-weight="700">${fmtN(p[key])}</text>
  `).join('');
  const labelsX = puntos.map((p, i) => `<text x="${px(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#9ca3af">${p.label}</text>`).join('');
  return `
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto">
    <path d="${pathDe('a')}" fill="none" stroke="${colorA}" stroke-width="2.5" />
    <path d="${pathDe('b')}" fill="none" stroke="${colorB}" stroke-width="2.5" />
    ${puntosDe('a', colorA)}
    ${puntosDe('b', colorB)}
    ${labelsX}
  </svg>
  <p style="font-size:11px;color:#9ca3af;margin:4px 0 0">
    <span style="color:${colorA}">●</span> ${nombreA} · <span style="color:${colorB}">●</span> ${nombreB}
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

  const ventasSemanasChart = graficoLineasHtml(
    d.ventasSemanas.map(p => ({ label: p.label, a: p.rucula, b: p.lechuga })),
    '#134e4a', '#84cc16', 'Rúcula', 'Lechuga'
  );
  const proyeccionChart = graficoBarrasHtml(
    d.proyeccionSemanas.map(p => ({ label: p.label, a: p.rucula, b: p.lechuga })),
    '#134e4a', '#84cc16', 'Rúcula', 'Lechuga'
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
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280">Ventas por cultivo — últimas 4 semanas (cantidades):</p>
    <div style="margin-bottom:20px">${ventasSemanasChart}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — mes en curso</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">&nbsp;</th><th style="padding:6px 10px;text-align:right">Unidades</th><th style="padding:6px 10px;text-align:right">vs. mes ant.</th></tr></thead>
      <tbody>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">Acumulado al día de hoy</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(d.ventasMesActual.unidadesMes)} u</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">—</td></tr>
        <tr><td style="padding:6px 10px;font-weight:600">Proyectado a fin de mes</td><td style="padding:6px 10px;text-align:right">${fmtN(d.ventasMesActual.proyeccionMes)} u</td><td style="padding:6px 10px;text-align:right">${flechaHtml(pct(d.ventasMesActual.proyeccionMes, d.ventasMesAnteriorTotal), true)}</td></tr>
        <tr><td style="padding:6px 10px;color:#9ca3af;font-size:11px" colspan="3">Mes pasado (total real): ${fmtN(d.ventasMesAnteriorTotal)} u</td></tr>
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
    <div style="margin-bottom:10px">${mesadasBajasHtml}</div>
  </div>`;
}

// ── Versión en texto plano, pensada para copiar y pegar en WhatsApp (que no renderiza
// HTML/tablas) — mismos números que el mail, con emojis y saltos de línea en vez de
// tablas/gráficos. Se genera con los mismos `ReporteSemanalData`, así que nunca se
// desincroniza del HTML: ambos salen de la misma consulta fresca a la planilla.
export function construirTexto(d: ReporteSemanalData): string {
  const p2 = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${n}%`;
  const L: string[] = [];
  L.push(`📋 *Reporte semanal — Xavia*`);
  L.push(d.fechaGenerado);
  L.push('');

  L.push(`🛒 *Ventas — últimos 7 días* (vs. 7 días ant.)`);
  L.push(`Rúcula: ${fmtN(d.ventasSemana.rucula.unidades)} u · ${fmtMoneda(d.ventasSemana.rucula.monto)} (${p2(pct(d.ventasSemana.rucula.unidades, d.ventasSemanaAnterior.rucula.unidades))})`);
  L.push(`Lechuga: ${fmtN(d.ventasSemana.lechuga.unidades)} u · ${fmtMoneda(d.ventasSemana.lechuga.monto)} (${p2(pct(d.ventasSemana.lechuga.unidades, d.ventasSemanaAnterior.lechuga.unidades))})`);
  const totU = d.ventasSemana.rucula.unidades + d.ventasSemana.lechuga.unidades;
  const totM = d.ventasSemana.rucula.monto + d.ventasSemana.lechuga.monto;
  L.push(`Total: ${fmtN(totU)} u · ${fmtMoneda(totM)}`);
  L.push('');
  L.push(`Últimas 4 semanas (u.) — Rúcula / Lechuga:`);
  for (const s of d.ventasSemanas) L.push(`  ${s.label}: ${fmtN(s.rucula)} / ${fmtN(s.lechuga)}`);
  L.push('');

  L.push(`📅 *Ventas — mes en curso*`);
  L.push(`Acumulado a hoy: ${fmtN(d.ventasMesActual.unidadesMes)} u`);
  L.push(`Proyectado a fin de mes: ${fmtN(d.ventasMesActual.proyeccionMes)} u (${p2(pct(d.ventasMesActual.proyeccionMes, d.ventasMesAnteriorTotal))} vs. mes ant.)`);
  L.push(`Mes pasado (total real): ${fmtN(d.ventasMesAnteriorTotal)} u`);
  L.push('');

  L.push(`🌱 *Proyección de cosecha — próxima semana* (vs. real semana pasada)`);
  L.push(`Rúcula: ${fmtN(d.proyeccionProximaSemana.rucula)} est. / ${fmtN(d.cosechaRealSemanaAnterior.rucula)} real`);
  L.push(`Lechuga: ${fmtN(d.proyeccionProximaSemana.lechuga)} est. / ${fmtN(d.cosechaRealSemanaAnterior.lechuga)} real`);
  L.push(`Próximas semanas (est.) — Rúcula / Lechuga:`);
  for (const s of d.proyeccionSemanas) L.push(`  ${s.label}: ${fmtN(s.rucula)} / ${fmtN(s.lechuga)}`);
  L.push('');

  L.push(`🔄 *Ciclos y peso de esta semana*`);
  L.push(`Rúcula: ${d.cicloSemana.rucula > 0 ? d.cicloSemana.rucula + 'd' : '—'} ciclo · ${d.pesoSemana.rucula > 0 ? d.pesoSemana.rucula + 'g' : '—'} peso`);
  L.push(`Lechuga: ${d.cicloSemana.lechuga > 0 ? d.cicloSemana.lechuga + 'd' : '—'} ciclo · ${d.pesoSemana.lechuga > 0 ? d.pesoSemana.lechuga + 'g' : '—'} peso`);
  L.push('');

  L.push(`❄️ *Stock en cámara* (faltante acumulado del mes)`);
  L.push(`Rúcula: ${fmtN(d.stock.rucula)} paq · faltante ${d.faltanteMes.rucula >= 0 ? '+' : ''}${d.faltanteMes.rucula} paq`);
  L.push(`Lechuga: ${fmtN(d.stock.lechuga)} paq · faltante ${d.faltanteMes.lechuga >= 0 ? '+' : ''}${d.faltanteMes.lechuga} paq`);
  L.push('');

  L.push(`🏭 *Ocupación por nave*`);
  for (const o of d.ocupacion) L.push(`  Nave ${o.nave}: ${o.pct}%`);
  if (d.mesadasBajas.length > 0) {
    L.push(`Mesadas F2 por debajo del 90%:`);
    for (const m of d.mesadasBajas) L.push(`  N${m.nave} · ${m.nombre}: ${m.pct}%`);
  } else {
    L.push(`✓ Ninguna mesada F2 por debajo del 90%.`);
  }

  return L.join('\n');
}

export async function enviarReporteSemanal(): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const datos = await obtenerDatosReporteSemanal();
    const html = construirHtml(datos);
    const text = construirTexto(datos);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `Reporte semanal — Xavia — ${datos.fechaGenerado}`,
        html,
        text,
      }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); return { ok: false, error: (err as any).message || `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al generar el reporte' };
  }
}
