import { calcularMes, cargarDatosHistorico, MESES_CORTO_EERR, type MesEERR } from './eerrHistorico';
import { LINEAS_VARIABLE, FIJOS } from './eerr';

// ── Informe del cierre mensual, por mail y A PEDIDO ───────────────────────────────────
//
// A pedido y no por cron. El cierre es manual: primero se cargan el resumen de la tarjeta,
// los stocks finales, los saldos reales y las previsiones, y eso lleva varios días del mes
// siguiente. Un mail automático llegaría siempre antes de que esté todo cargado, mostrando
// un mes incompleto como si fuera el cierre — y un informe que miente la mitad de las veces
// deja de leerse entero, incluso las veces que está bien.
//
// Así que lo dispara Marcos cuando terminó de cargar, desde la pantalla del cierre.
//
// El informe es el EERR del mes contra el anterior, con la diferencia en plata Y en
// porcentaje. Las dos, porque no dicen lo mismo: una línea chica que se duplica da +100% y
// son dos mangos, y un 5% de sueldos es mucha plata.

const $ = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');

interface FilaInforme {
  label: string;
  monto: number;
  anterior: number;
  nivel: 'total' | 'detalle' | 'resultado';
  // En las líneas de costo subir es malo; en ventas y resultados es al revés.
  subirEsBueno?: boolean;
}

function filasDelInforme(act: MesEERR, ant: MesEERR): FilaInforme[] {
  const e = act.eerr, a = ant.eerr;
  const linea = (bloque: 'costoVariable' | 'costosFijos', label: string): FilaInforme => ({
    label, nivel: 'detalle',
    monto: e[bloque].lineas.find((l) => l.label === label)?.monto ?? 0,
    anterior: a[bloque].lineas.find((l) => l.label === label)?.monto ?? 0,
  });
  const venta = (label: string): FilaInforme => ({
    label, nivel: 'detalle', subirEsBueno: true,
    monto: e.ventas.porCultivo.find((c) => c.label === label)?.monto ?? 0,
    anterior: a.ventas.porCultivo.find((c) => c.label === label)?.monto ?? 0,
  });

  const filas: FilaInforme[] = [
    { label: 'Ventas', monto: e.ventas.total, anterior: a.ventas.total, nivel: 'total', subirEsBueno: true },
    venta('Rúcula'), venta('Lechuga'), venta('Albahaca'),
    { label: 'Costo variable', monto: e.costoVariable.total, anterior: a.costoVariable.total, nivel: 'total' },
    ...LINEAS_VARIABLE.map((l) => linea('costoVariable', l.label)),
    { label: 'Costos fijos', monto: e.costosFijos.total, anterior: a.costosFijos.total, nivel: 'total' },
    ...FIJOS.map((l) => linea('costosFijos', l.label)),
    linea('costosFijos', 'Previsiones (despidos y SAC)'),
    { label: 'Resultado final', monto: e.resultado, anterior: a.resultado, nivel: 'resultado', subirEsBueno: true },
    { label: 'Resultado sin inversión', monto: e.resultadoSinInversion, anterior: a.resultadoSinInversion, nivel: 'resultado', subirEsBueno: true },
  ];
  // Las líneas de detalle vacías en los dos meses se van; los totales y resultados quedan
  // siempre, porque un bloque en cero es información.
  return filas.filter((f) => f.nivel !== 'detalle' || Math.round(f.monto) !== 0 || Math.round(f.anterior) !== 0);
}

function filaHtml(f: FilaInforme): string {
  const dif = Math.round(f.monto) - Math.round(f.anterior);
  const hayRef = Math.round(f.anterior) !== 0;
  const pct = hayRef ? Math.round((dif / Math.abs(Math.round(f.anterior))) * 100) : null;
  // Sin mes anterior la plata SÍ se puede decir —es plata que salió— pero el % no: una línea
  // nueva daría siempre "+100%", que no significa nada.
  const bueno = dif === 0 ? null : f.subirEsBueno ? dif > 0 : dif < 0;
  const color = bueno === null ? '#9ca3af' : bueno ? '#059669' : '#dc2626';
  const esTotal = f.nivel === 'total', esRes = f.nivel === 'resultado';
  const peso = esTotal || esRes ? 800 : 400;
  const bd = 'border-bottom:1px solid #eee';
  const fondo = esRes ? 'background:#fafaf9;' : '';
  const sangria = f.nivel === 'detalle' ? 'padding-left:26px' : '';
  return `<tr>
    <td style="padding:6px 10px;${bd};${fondo}font-weight:${peso};${sangria}">${f.label}</td>
    <td style="padding:6px 10px;${bd};${fondo}text-align:right;font-weight:${esTotal || esRes ? 800 : 600};${esRes && f.monto < 0 ? 'color:#dc2626' : ''}">${$(f.monto)}</td>
    <td style="padding:6px 10px;${bd};${fondo}text-align:right;color:#9ca3af">${$(f.anterior)}</td>
    <td style="padding:6px 10px;${bd};${fondo}text-align:right;color:${color};font-weight:700">${dif === 0 ? '·' : `${dif > 0 ? '+' : '−'}${$(Math.abs(dif))}`}</td>
    <td style="padding:6px 10px;${bd};${fondo}text-align:right;color:${color};font-weight:700">${pct === null ? '—' : pct === 0 ? '·' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`}</td>
  </tr>`;
}

export function construirHtmlCierre(act: MesEERR, ant: MesEERR): string {
  const filas = filasDelInforme(act, ant);
  const e = act.eerr;
  const margen = e.ventas.total > 0 ? Math.round((e.resultado / e.ventas.total) * 1000) / 10 : null;
  const margenAnt = ant.eerr.ventas.total > 0 ? Math.round((ant.eerr.resultado / ant.eerr.ventas.total) * 1000) / 10 : null;

  const avisos = [
    ...e.avisos,
    // Un mes sin previsiones confirmadas no está cerrado, y en un informe que se manda por
    // mail eso no se puede dejar implícito: el resultado se lee como definitivo.
    ...(act.previsionesConfirmadas ? [] : ['Las previsiones de despidos y SAC no están confirmadas: el resultado no las incluye.']),
  ];

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;color:#111">
    <h2 style="margin:0 0 2px;font-size:20px">Cierre de ${MESES_CORTO_EERR[act.mes - 1]} ${act.anio}</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280">Comparado contra ${ant.label}.</p>

    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:10px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:6px 10px;text-align:left">Concepto</th>
        <th style="padding:6px 10px;text-align:right">${act.label}</th>
        <th style="padding:6px 10px;text-align:right">${ant.label}</th>
        <th style="padding:6px 10px;text-align:right">Dif. $</th>
        <th style="padding:6px 10px;text-align:right">Dif. %</th>
      </tr></thead>
      <tbody>${filas.map(filaHtml).join('')}</tbody>
    </table>

    <p style="margin:0 0 16px;font-size:12px;color:#6b7280">
      Margen sobre ventas: <strong>${margen === null ? '—' : margen + '%'}</strong>
      ${margenAnt === null ? '' : ` <span style="color:#9ca3af">(${margenAnt}% en ${ant.label})</span>`}
      · Inversión en equipamiento del mes: <strong>${$(e.inversion)}</strong>
    </p>

    <p style="margin:0 0 16px;font-size:11px;color:#9ca3af">
      En rojo lo que empeoró: un costo que subió o un resultado que bajó. Van el % y la plata porque no dicen lo mismo —
      una línea chica que se duplica da +100% y son dos mangos, y un 5% de sueldos es mucha plata. Una línea que no existía
      el mes anterior muestra la plata y deja el % vacío, porque ahí el porcentaje no está definido.
    </p>

    ${avisos.length === 0 ? '' : `
    <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:10px 12px;font-size:12.5px">
      <strong>Para revisar antes de dar el mes por cerrado:</strong>
      <ul style="margin:6px 0 0;padding-left:18px">${avisos.map((a) => `<li style="margin:2px 0">${a}</li>`).join('')}</ul>
    </div>`}
  </div>`;
}

export function construirTextoCierre(act: MesEERR, ant: MesEERR): string {
  const L: string[] = [`*Cierre de ${act.label}* (vs. ${ant.label})`, ''];
  for (const f of filasDelInforme(act, ant)) {
    if (f.nivel === 'detalle') continue;  // en texto, solo los totales y los resultados
    const dif = Math.round(f.monto) - Math.round(f.anterior);
    const pct = Math.round(f.anterior) ? Math.round((dif / Math.abs(Math.round(f.anterior))) * 100) : null;
    // Sin cambio no se escribe "(+$0)": es ruido en una lista que se lee de un vistazo.
    if (dif === 0) { L.push(`${f.label}: ${$(f.monto)} (igual)`); continue; }
    L.push(`${f.label}: ${$(f.monto)} (${dif > 0 ? '+' : '−'}${$(Math.abs(dif))}${pct === null ? '' : `, ${pct > 0 ? '↑' : '↓'}${Math.abs(pct)}%`})`);
  }
  if (!act.previsionesConfirmadas) L.push('', '⚠️ Previsiones sin confirmar: el resultado no las incluye.');
  return L.join('\n');
}

// Manda el informe de un mes puntual. Devuelve el error en vez de tirarlo, para que la
// pantalla pueda decir qué pasó y no un "algo falló".
export async function enviarInformeCierre(anio: number, mes: number, destino?: string): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const d = await cargarDatosHistorico();
    const act = calcularMes(d, anio, mes);
    let mesPrev = mes - 1, anioPrev = anio;
    if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
    const ant = calcularMes(d, anioPrev, mesPrev);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: [destino || 'administracion@xavia.com.ar'],
        subject: `Cierre ${act.label} — Xavia`,
        html: construirHtmlCierre(act, ant),
        text: construirTextoCierre(act, ant),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al armar el informe' };
  }
}
