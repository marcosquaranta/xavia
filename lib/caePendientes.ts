import { asegurarHoja, readSheet, updateRow, appendRowObj } from './sheets';

// ── CAEs pendientes: registro + aviso diario acumulado ───────────────────────────────
//
// Al "Cargar ventas" la app emite los comprobantes en Xubio por API, pero el plan actual
// de Xubio no permite pedir el CAE ni enviar la factura por correo desde la API: esos dos
// pasos hay que hacerlos a mano. Antes salía un mail apenas se emitía, así que un día con
// tres cargas eran tres mails; ahora se acumulan y sale uno solo por la mañana.
//
// Cada emisión queda registrada acá, y el aviso marca las filas como avisadas. Con eso:
// una factura entra en exactamente UN mail, y si un día falla el cron no se pierde nada
// (esas filas siguen sin avisar y entran en el aviso siguiente).
//
// LÍMITE CONOCIDO: la app no puede saber si el CAE efectivamente se sacó — Xubio no lo
// expone por API en este plan. "Avisado" quiere decir "ya te lo dijimos", no "ya está
// resuelto". Si Xubio algún día devuelve el CAE al emitir, esas filas ya quedan guardadas
// con su cae y se saltean solas del aviso.

export const HOJA_CAE = 'FacturasEmitidas';
export const HEADERS_CAE = ['id_emision', 'fecha_emision', 'fecha_venta', 'cliente', 'numero', 'cae', 'avisado'];

export interface FacturaEmitida {
  id_emision: string;
  fecha_emision: string; // ISO — cuándo se emitió en Xubio
  fecha_venta: string;   // YYYY-MM-DD de la venta facturada
  cliente: string;
  numero: string;
  cae: string;           // vacío = Xubio no lo devolvió (lo normal en este plan)
  avisado: string;       // 'SI' cuando ya salió en un aviso
}

// Registra las facturas recién emitidas. No tira error hacia afuera: si esto falla, la
// venta ya se facturó igual y no tiene sentido romper la carga por el registro del aviso.
export async function registrarEmitidas(
  emitidas: { cliente: string; numero?: string; cae?: string; fechaVenta: string }[],
): Promise<void> {
  if (!emitidas.length) return;
  try {
    await asegurarHoja(HOJA_CAE, HEADERS_CAE);
    const ahora = new Date().toISOString();
    const previas = await readSheet<FacturaEmitida>(HOJA_CAE).catch(() => []);
    let seq = previas.reduce((acc, f) => Math.max(acc, parseInt(String(f.id_emision).replace(/\D/g, ''), 10) || 0), 0);
    for (const e of emitidas) {
      seq++;
      await appendRowObj(HOJA_CAE, {
        id_emision: `EM-${String(seq).padStart(5, '0')}`,
        fecha_emision: ahora,
        fecha_venta: String(e.fechaVenta || '').split(/[T ]/)[0],
        cliente: e.cliente,
        numero: e.numero || '',
        cae: e.cae || '',
        avisado: '',
      });
    }
  } catch (err) {
    console.error('[caePendientes] no se pudo registrar la emisión:', err);
  }
}

function fmtFecha(iso: string): string {
  const [y, m, d] = String(iso || '').split(/[T ]/)[0].split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso || '');
}

export interface ResultadoAvisoCae { ok: boolean; error?: string; pendientes?: number; sinAvisar?: number }

// Aviso diario con TODO lo emitido que todavía no se avisó. Si no hay nada, no manda
// nada: un mail diario que dice "no hay pendientes" se vuelve ruido y se deja de leer.
export async function enviarAvisoCaeAcumulado(): Promise<ResultadoAvisoCae> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const filas = await readSheet<FacturaEmitida>(HOJA_CAE).catch(() => [] as FacturaEmitida[]);
    // Las que ya tienen CAE no necesitan aviso: no hay nada que hacer a mano con ellas.
    const pendientes = filas.filter((f) => String(f.avisado || '').toUpperCase() !== 'SI' && !String(f.cae || '').trim());
    if (!pendientes.length) return { ok: true, pendientes: 0 };

    // Agrupadas por día de venta: así se lee "de la venta del 27 faltan estas tres".
    const porDia = new Map<string, FacturaEmitida[]>();
    for (const f of pendientes) {
      const k = String(f.fecha_venta || '').split(/[T ]/)[0] || 'sin fecha';
      if (!porDia.has(k)) porDia.set(k, []);
      porDia.get(k)!.push(f);
    }
    const dias = [...porDia.keys()].sort();

    const bloques = dias.map((d) => {
      const filasDia = porDia.get(d)!;
      const rows = filasDia.map((f) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.cliente}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.numero || '—'}</td>
        </tr>`).join('');
      return `
      <p style="margin:16px 0 6px;font-size:13px;font-weight:700">Ventas del ${fmtFecha(d)} <span style="font-weight:400;color:#888">· ${filasDia.length} comprobante(s)</span></p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Cliente</th>
          <th style="padding:6px 10px;text-align:left">Comprobante</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('');

    const hoyFmt = fmtFecha(new Date().toISOString());
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px">
        <h2 style="margin:0 0 4px">CAEs pendientes — ${hoyFmt}</h2>
        <p style="margin:0 0 14px;color:#555">
          Hay <strong>${pendientes.length}</strong> comprobante(s) emitidos en Xubio esperando los dos pasos que
          el plan actual no permite hacer por API. En Xubio → Comprobantes de venta, seleccionalos y:
        </p>
        <ol style="margin:0 0 4px;color:#333">
          <li>Obtener CAE (las Factura A)</li>
          <li>Enviar por correo</li>
        </ol>
        ${bloques}
        <p style="margin:16px 0 0;font-size:11px;color:#999">
          Aviso diario. Cada comprobante aparece una sola vez: si ya lo resolviste, ignoralo.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `CAEs pendientes — ${pendientes.length} comprobante(s) — ${hoyFmt}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Sin marcar: si el mail no salió, tienen que entrar en el aviso siguiente.
      return { ok: false, error: (err as any).message || `HTTP ${res.status}`, sinAvisar: pendientes.length };
    }

    // Marcar recién DESPUÉS de que el mail salió bien.
    for (const f of pendientes) {
      await updateRow(HOJA_CAE, 'id_emision', String(f.id_emision), { avisado: 'SI' });
    }
    return { ok: true, pendientes: pendientes.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al armar el aviso de CAEs' };
  }
}
