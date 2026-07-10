import { readSheet } from './sheets';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, PrecioVenta, ClienteVenta, VentaHistorica } from './types';
import { tubosPorMesada } from './ocupacion';
import { calcularCapacidad, diasCicloDefault } from './planificacionServer';
import { calcularPlan, repartoHelpers, parseReparto, REPARTO_DEFAULT, DIA_SIEMBRA, CUB, CUBPOSRUC, planchas } from './planificacion';
import { proyeccionCosechaSemanal, cicloRealPorVariedad, ciclosPorSemana, pesoPromedioRango, pesoPromedioMes, mesAnteriorClamp, type PesoPromedioMes } from './estadisticas';
import { generarAlertas, type Alerta } from './alertasPanel';
import { evolucionVentaPorArticulo, ventasEnRango, type PuntoArticulo, type VentasRango } from './estadisticasVentas';

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
  proyeccionProximaSemana: { rucula: number; lechuga: number };
  cosechaRealSemanaAnterior: { rucula: number; lechuga: number };
  cicloSemana: { rucula: number; lechuga: number };
  cicloSemanaAnterior: { rucula: number; lechuga: number };
  pesoSemana: PesoPromedioMes;
  pesoMesAnterior: PesoPromedioMes;
  ocupacion: { nave: number; pct: number }[];
  siembra: { rucula: { real: number; plan: number }; lechuga: { real: number; plan: number } };
  alertas: Alerta[];
  evolArticulo: PuntoArticulo[];
}

export async function obtenerDatosReporteSemanal(): Promise<ReporteSemanalData> {
  const [lotes, movimientos, ubicaciones, variedades, ventas, precios, clientes, historicas, configRows] = await Promise.all([
    readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'), readSheet<VentaDia>('Ventas'), readSheet<PrecioVenta>('Precios'),
    readSheet<ClienteVenta>('Clientes'),
    readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
    readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
  ]);

  const hoy = new Date();

  // ── Ventas: últimos 7 días vs los 7 días anteriores a esos ──
  const hastaHoy = fmtISO(hoy);
  const desdeSemana = fmtISO(new Date(hoy.getTime() - 6 * 86400000));
  const hastaAnt = fmtISO(new Date(hoy.getTime() - 7 * 86400000));
  const desdeAnt = fmtISO(new Date(hoy.getTime() - 13 * 86400000));
  const ventasSemana = ventasEnRango(ventas, precios, clientes, desdeSemana, hastaHoy);
  const ventasSemanaAnterior = ventasEnRango(ventas, precios, clientes, desdeAnt, hastaAnt);

  // ── Proyección de cosecha próxima semana (calendario) vs. lo realmente cosechado la semana pasada ──
  const proyeccion = proyeccionCosechaSemanal(lotes, variedades, 2);
  const proyeccionProximaSemana = proyeccion[1] || { rucula: 0, lechuga: 0 };
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

  // ── Ciclos F2 de la semana (rolling, mismo criterio que el Panel) ──
  const ciclosSemanas = ciclosPorSemana(lotes, movimientos);
  const ultSem = ciclosSemanas[ciclosSemanas.length - 1] || { rucula: 0, lechugaF2: 0 };
  const antSem = ciclosSemanas[ciclosSemanas.length - 2] || { rucula: 0, lechugaF2: 0 };
  const cicloSemana = { rucula: ultSem.rucula || 0, lechuga: ultSem.lechugaF2 || 0 };
  const cicloSemanaAnterior = { rucula: antSem.rucula || 0, lechuga: antSem.lechugaF2 || 0 };

  // ── Peso promedio de esta semana vs. promedio del mes pasado completo ──
  const desde7 = new Date(hoy); desde7.setDate(desde7.getDate() - 7);
  const pesoSemana = pesoPromedioRango(lotes, desde7, hoy);
  const pesoMesAnterior = pesoPromedioMes(lotes, mesAnteriorClamp(hoy));

  // ── Ocupación por nave (F2, mismo criterio que el Panel) ──
  const tubosMesadas = tubosPorMesada(ubicaciones, lotes);
  const ocupacion = tubosMesadas.map((n: any) => {
    const f2 = (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round((ocu / tot) * 100) : 0 };
  });
  const mesadasF2 = tubosMesadas.flatMap((n: any) => (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1'));
  const ocGlobal = mesadasF2.length > 0
    ? Math.round(mesadasF2.reduce((a: number, m: any) => a + m.tubos_ocupados, 0) /
      Math.max(1, mesadasF2.reduce((a: number, m: any) => a + m.tubos_totales, 0)) * 100)
    : 0;

  // ── Siembra de esta semana (lunes a hoy) vs. lo que el plan indica ──
  const siembra = { rucula: { real: 0, plan: 0 }, lechuga: { real: 0, plan: 0 } };
  try {
    const naves = calcularCapacidad(ubicaciones);
    const plan = calcularPlan(naves, diasCicloDefault(lotes, movimientos));
    const cfgRep = configRows.find(i => i.clave === 'plan_reparto');
    const reparto = cfgRep ? parseReparto(cfgRep.valor) : REPARTO_DEFAULT;
    const h = repartoHelpers(plan, reparto);
    const plRuc = planchas(h.siembraRucPl), plLec = planchas(h.siembraLecPl);
    let huboMiercoles = false;
    for (let d = new Date(lunesEstaSemana); d <= hoy; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === DIA_SIEMBRA) { huboMiercoles = true; break; }
    }
    siembra.rucula.plan = huboMiercoles ? plRuc : 0;
    siembra.lechuga.plan = huboMiercoles ? plLec : 0;

    let sumPosRuc = 0, sumPlLec = 0;
    for (const l of lotes) {
      const f = new Date(String(l.fecha_siembra) + 'T12:00:00');
      if (isNaN(f.getTime()) || f < lunesEstaSemana || f > hoy) continue;
      const cant = Number(l.plantines_iniciales) || 0;
      if (esRuculaV(l.variedad)) sumPosRuc += cant; else sumPlLec += cant;
    }
    siembra.rucula.real = planchas((sumPosRuc * CUBPOSRUC) / CUB);
    siembra.lechuga.real = planchas(sumPlLec / CUB);
  } catch {}

  // ── Alertas activas (mismas que el Panel) ──
  const ciclosRealesMap = cicloRealPorVariedad(lotes, [], 5);
  const alertas = generarAlertas(lotes, tubosMesadas, ciclosRealesMap, ocGlobal);

  // ── Evolución de venta por artículo (últimos 6 meses) ──
  const evolArticulo = evolucionVentaPorArticulo(ventas, 6, historicas);

  return {
    fechaGenerado: fmtISO(hoy),
    ventasSemana, ventasSemanaAnterior,
    proyeccionProximaSemana, cosechaRealSemanaAnterior,
    cicloSemana, cicloSemanaAnterior,
    pesoSemana, pesoMesAnterior,
    ocupacion, siembra, alertas, evolArticulo,
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

function filaVentas(label: string, actual: { unidades: number; monto: number }, ref: { unidades: number; monto: number }): string {
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(actual.unidades)} u</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtMoneda(actual.monto)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(actual.unidades, ref.unidades), true)}</td>
  </tr>`;
}

function construirHtml(d: ReporteSemanalData): string {
  const ventasFilas = filaVentas('Rúcula', d.ventasSemana.rucula, d.ventasSemanaAnterior.rucula)
    + filaVentas('Lechuga', d.ventasSemana.lechuga, d.ventasSemanaAnterior.lechuga);

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
    const ciclo = d.cicloSemana[c], cicloAnt = d.cicloSemanaAnterior[c];
    const peso = d.pesoSemana[c], pesoAnt = d.pesoMesAnterior[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${ciclo > 0 ? ciclo + 'd' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(ciclo, cicloAnt), false)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${peso > 0 ? peso + 'g' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(peso, pesoAnt), true)}</td>
    </tr>`;
  }).join('');

  const siembraFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const s = d.siembra[c];
    const difPct = s.plan > 0 ? Math.round(((s.real - s.plan) / s.plan) * 100) : null;
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${s.real} planchas</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${s.plan} planchas</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${difPct !== null ? flechaHtml(difPct, true) : '<span style="color:#9ca3af">sin ref.</span>'}</td>
    </tr>`;
  }).join('');

  const ocupacionHtml = d.ocupacion.map(o =>
    `<div style="display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 16px;margin-right:10px">
      <div style="font-size:11px;color:#6b7280">NAVE ${o.nave}</div>
      <div style="font-size:20px;font-weight:800;color:#111827">${o.pct}%</div>
    </div>`
  ).join('');

  const alertasHtml = d.alertas.length === 0
    ? '<p style="color:#059669;font-size:13px">✓ Sin alertas activas.</p>'
    : `<ul style="margin:0;padding-left:18px;font-size:13px;color:#374151">${d.alertas.slice(0, 15).map(a =>
        `<li style="margin-bottom:4px">${a.tipo === 'error' ? '🔴' : a.tipo === 'warn' ? '🟡' : '🔵'} ${a.msg}</li>`
      ).join('')}</ul>`;

  const maxArticulo = Math.max(...d.evolArticulo.flatMap(p => [p.rucula, p.lechuga, p.albahaca]), 1);
  const evolArticuloHtml = d.evolArticulo.map(p => `
    <tr>
      <td style="padding:4px 8px;font-size:12px;color:#6b7280;white-space:nowrap">${p.label}</td>
      <td style="padding:4px 8px;width:100%">
        <div style="display:flex;gap:2px;height:14px">
          <div style="width:${Math.round((p.rucula / maxArticulo) * 100)}%;background:#166534;border-radius:2px" title="Rúcula ${p.rucula}"></div>
          <div style="width:${Math.round((p.lechuga / maxArticulo) * 100)}%;background:#4d7c0f;border-radius:2px" title="Lechuga ${p.lechuga}"></div>
          <div style="width:${Math.round((p.albahaca / maxArticulo) * 100)}%;background:#eda100;border-radius:2px" title="Albahaca ${p.albahaca}"></div>
        </div>
      </td>
      <td style="padding:4px 8px;font-size:11px;color:#9ca3af;white-space:nowrap">R:${fmtN(p.rucula)} · L:${fmtN(p.lechuga)}${p.albahaca > 0 ? ` · A:${fmtN(p.albahaca)}` : ''}</td>
    </tr>`).join('');

  return `
  <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
    <h2 style="margin:0 0 4px">Reporte semanal — Xavia</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px">${d.fechaGenerado}</p>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — últimos 7 días <span style="font-weight:400;color:#9ca3af">(vs. 7 días anteriores)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Unidades</th><th style="padding:6px 10px;text-align:right">Total $</th><th style="padding:6px 10px;text-align:right">vs. semana ant.</th></tr></thead>
      <tbody>${ventasFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Proyección de cosecha — próxima semana <span style="font-weight:400;color:#9ca3af">(vs. real cosechado semana pasada)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Próx. semana (est.)</th><th style="padding:6px 10px;text-align:right">Semana pasada (real)</th><th style="padding:6px 10px;text-align:right">Var.</th></tr></thead>
      <tbody>${cosechaFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ciclos y peso de esta semana</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Ciclo F2</th><th style="padding:6px 10px;text-align:right">vs. sem. ant.</th><th style="padding:6px 10px;text-align:right">Peso prom.</th><th style="padding:6px 10px;text-align:right">vs. mes ant.</th></tr></thead>
      <tbody>${ciclosPesoFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ocupación por nave</h3>
    <div style="margin-bottom:20px">${ocupacionHtml}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Siembra de esta semana <span style="font-weight:400;color:#9ca3af">(vs. lo que indica el plan)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Sembrado</th><th style="padding:6px 10px;text-align:right">Plan indica</th><th style="padding:6px 10px;text-align:right">Var.</th></tr></thead>
      <tbody>${siembraFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Alertas activas</h3>
    <div style="margin-bottom:20px">${alertasHtml}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Evolución de venta por artículo <span style="font-weight:400;color:#9ca3af">(últimos 6 meses)</span></h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:10px">${evolArticuloHtml}</table>
    <p style="font-size:11px;color:#9ca3af">
      <span style="color:#166534">■</span> Rúcula ·
      <span style="color:#4d7c0f">■</span> Lechuga ·
      <span style="color:#eda100">■</span> Albahaca
    </p>
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
