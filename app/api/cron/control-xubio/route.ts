import { NextRequest, NextResponse } from 'next/server';
import { readSheet } from '@/lib/sheets';
import { getComprobantes } from '@/lib/xubio';
import { HOJA_CAE, type FacturaEmitida } from '@/lib/caePendientes';
import { controlDiario, DIAS_VENTANA_CONTROL, DIAS_GRACIA_XUBIO } from '@/lib/controlDiarioXubio';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CLAVE_CONFIG = 'email_alertas_plata';
const BASE = 'https://xavia-self.vercel.app';

// ── Control diario: lo que la app emitió contra lo que Xubio tiene ──────────────────
//
// La emisión es el único paso donde la app le cree a Xubio sin volver a preguntar: manda
// la factura, Xubio devuelve un número, y eso se da por hecho. Pero "Xubio contestó" no es
// lo mismo que "Xubio lo guardó" — vienen apareciendo facturas al día siguiente, o no
// apareciendo.
//
// Corre todos los días y manda mail SOLO si hay algo. Una factura emitida hoy o ayer que
// todavía no aparece no dispara nada: esa demora es el comportamiento normal, y avisarla
// sería mandar un mail por día hasta que nadie lo abra.
export async function GET(req: NextRequest) {
  const soloVer = req.nextUrl.searchParams.get('ver') === '1';
  try {
    const hoy = fechaArgentinaHoy();
    // La ventana de Xubio es más ancha que la del control: una factura emitida hace 7 días
    // puede tener fecha de comprobante anterior (ver fechaDeFactura), y buscarla solo en la
    // ventana del control la daría por perdida estando.
    const desdeXubio = new Date(Date.parse(`${hoy}T12:00:00Z`) - (DIAS_VENTANA_CONTROL + 14) * 86_400_000)
      .toISOString().slice(0, 10);

    const [emitidas, comprobantes, config, ventas] = await Promise.all([
      readSheet<FacturaEmitida>(HOJA_CAE).catch(() => [] as FacturaEmitida[]),
      getComprobantes(desdeXubio, hoy).catch(() => null),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      // La segunda prueba de que una factura salió de la app. FacturasEmitidas se escribe
      // en un paso aparte que no rompe la carga si falla; `exportado` se escribe en el
      // mismo movimiento que la emisión. Con las dos, una factura tiene que faltar en las
      // DOS para que el control la trate como cargada a mano.
      readSheet<VentaDia>('Ventas').catch(() => [] as VentaDia[]),
    ]);

    // Sin Xubio no se puede controlar nada, y decir "todo bien" sería peor que no correr.
    if (comprobantes === null) {
      return NextResponse.json({ ok: false, error: 'No se pudo leer Xubio: el control no corrió.' }, { status: 502 });
    }

    const r = controlDiario(
      emitidas.map((e) => ({
        numero: String(e.numero || ''), cliente: String(e.cliente || ''),
        fecha_emision: String(e.fecha_emision || ''), fecha_venta: String(e.fecha_venta || ''),
        cae: String(e.cae || ''),
      })),
      comprobantes, hoy, undefined, undefined,
      ventas.map((v) => String(v.exportado || '').trim()).filter((x) => x && x !== 'PENDIENTE'),
      // Para poder decir si la factura huerfana se corresponde con una venta cargada a la
      // que le falta el numero, que necesita algo muy distinto a una venta que no existe.
      ventas.map((v) => ({
        cliente: String(v.nombre_cliente || ''),
        fecha: String(v.fecha || ''),
        exportado: String(v.exportado || ''),
      })),
    );

    if (soloVer) return NextResponse.json({ ...r, ok: true });
    if (!r.hayProblema) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'todo coincide', revisadas: r.revisadas, demoradas: r.demoradas.length });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });
    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} sin destinatarios` }, { status: 500 });

    const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
    const fmtDia = (f: string) => { const [y, m, d] = String(f).split('-'); return d ? `${d}/${m}` : f; };

    const tabla = (titulo: string, color: string, bajada: string, filas: typeof r.faltantes, conImporte = false) => !filas.length ? '' : `
      <p style="margin:16px 0 4px;font-size:13px;font-weight:800;color:${color}">${titulo}</p>
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280">${bajada}</p>
      <table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:5px 8px;text-align:left">Comprobante</th>
          <th style="padding:5px 8px;text-align:left">Cliente</th>
          <th style="padding:5px 8px;text-align:left">Emitida</th>
          <th style="padding:5px 8px;text-align:right">${conImporte ? 'Importe' : 'Hace'}</th>
        </tr></thead>
        <tbody>${filas.map((f) => `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${f.numero}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${f.cliente || '(sin cliente)'}${
            f.ventaSinNumero
              ? `<div style="font-size:11px;color:#6b7280">hay una venta cargada del ${fmtDia(f.ventaSinNumero.fecha)} sin número de factura${f.ventaSinNumero.dias > 7 ? ` (${f.ventaSinNumero.dias} días antes)` : ''}</div>`
              : ''
          }</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${fmtDia(f.fechaEmision)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:${color}">
            ${conImporte ? fmt$(f.importeXubio || 0) : `${f.diasDesdeEmision} día${f.diasDesdeEmision === 1 ? '' : 's'}`}
          </td>
        </tr>`).join('')}</tbody>
      </table>`;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:680px">
        <h2 style="margin:0 0 4px;font-size:18px;color:#92400e">Control diario app ↔ Xubio</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:#6b7280">
          De las <strong>${r.revisadas}</strong> facturas que la app emitió en los últimos ${DIAS_VENTANA_CONTROL} días,
          <strong>${r.ok}</strong> están en Xubio.
        </p>

        ${tabla('Emitidas y Xubio no las tiene', '#991b1b',
          `La app las dio por emitidas hace más de ${DIAS_GRACIA_XUBIO} día y Xubio no las devuelve. Si no aparecen, hay mercadería entregada y sin facturar.`,
          r.faltantes)}

        ${tabla('En Xubio y la app no las tiene', '#1d4ed8',
          'Ese número no figura de este lado. Si abajo dice que hay una venta cargada sin número, la venta está y lo que falló fue escribir el número de vuelta — no falta plata, falta un dato, y mientras tanto esa venta figura "sin facturar". Si no dice nada, se facturó algo que la app nunca tuvo: no está en el resultado, ni en la deuda del cliente, ni en el reclamo del lunes.',
          r.soloEnXubio, true)}

        ${r.demoradas.length ? `
          <p style="margin:16px 0 0;font-size:12px;color:#6b7280;background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px">
            ${r.demoradas.length} recién emitida(s) todavía no aparecen en Xubio. Es lo normal —suele tardar— y se vuelven
            a revisar mañana. No hace falta hacer nada hoy.
          </p>` : ''}

        <p style="margin:16px 0 0">
          <a href="${BASE}/ventas/historial" style="background:#92400e;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Ver el historial de facturación
          </a>
        </p>
        <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
          Este mail sale solo cuando hay algo. Si no llega, es que todo lo que la app emitió está en Xubio.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Control app ↔ Xubio: ${r.faltantes.length ? `${r.faltantes.length} factura(s) que Xubio no tiene` : `${r.soloEnXubio.length} cargada(s) a mano en Xubio`}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, enviado: true, faltantes: r.faltantes.length, soloEnXubio: r.soloEnXubio.length, demoradas: r.demoradas.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
