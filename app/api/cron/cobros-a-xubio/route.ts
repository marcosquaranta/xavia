import { NextRequest, NextResponse } from 'next/server';
import { readSheet, updateRow, asegurarColumnas } from '@/lib/sheets';
import { HOJA_COBROS, registrarCobro, type CobroRegistrado } from '@/lib/cobros';
import { cobrosEsperando, resumenEspera, ESTADO_PENDIENTE } from '@/lib/cobrosDiferidos';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CLAVE_CONFIG = 'email_alertas_plata';
const BASE = 'https://xavia-self.vercel.app';

// ── La tanda diaria: los cobros de la app van a Xubio ────────────────────────────────
//
// Imputar un cobro tardaba una eternidad porque antes de poder escribir en Xubio hay que
// leerle tres o cuatro cosas: el circuito contable, la moneda, el instrumento, los
// clientes. Ahora el cobro se registra en la app en el acto y esto lo manda después.
//
// Se procesan de a uno y en orden de registro. No en paralelo: cada cobranza que se crea
// cambia lo que Xubio devuelve la próxima vez (de ahí se deduce el circuito), y dos
// pedidos simultáneos pueden tomar números de recibo que choquen.
//
// Un cobro que falla NO frena a los demás ni se reintenta en loop: se le guarda el error
// de Xubio y queda pendiente. Lo va a reintentar mañana, y mientras tanto el error se ve
// en la pantalla de Cobranzas y en el mail de abajo — un cobro que no llega a la
// contabilidad y nadie mira es plata cobrada que termina sin asentar.
export async function GET(req: NextRequest) {
  const soloVer = req.nextUrl.searchParams.get('ver') === '1';
  try {
    await asegurarColumnas(HOJA_COBROS, ['error_xubio']).catch(() => null);
    const hoy = fechaArgentinaHoy();
    const cobros = await readSheet<CobroRegistrado & { error_xubio?: string }>(HOJA_COBROS).catch(() => []);
    const esperando = cobrosEsperando(cobros, hoy);

    if (soloVer) return NextResponse.json({ ok: true, ...resumenEspera(esperando), esperando });
    if (!esperando.length) return NextResponse.json({ ok: true, enviados: 0, motivo: 'no hay cobros esperando' });

    const porId = new Map(cobros.map((c) => [String(c.id_cobro), c]));
    const enviados: { id_cobro: string; numero_recibo: string }[] = [];
    const fallados: { id_cobro: string; cliente: string; importe: number; error: string }[] = [];

    for (const e of esperando) {
      const c = porId.get(e.id_cobro);
      if (!c) continue;
      // `diferido` no va: acá sí queremos el camino completo contra Xubio.
      const r = await registrarCobro({
        idControl: String(c.id_control || ''),
        fecha: String(c.fecha || '').split(/[T ]/)[0],
        importe: Number(c.importe) || 0,
        cuentaId: Number(c.cuenta_id) || 0,
        observacion: String(c.observacion || ''),
        comprobantes: String(c.comprobantes || '').split(',').map((x) => x.trim()).filter(Boolean),
        retencion: Number(c.retencion) || 0,
        usuario: String(c.usuario || ''),
      }).catch((err: any) => ({ ok: false, error: err?.message || 'error' } as any));

      if (r.ok) {
        // La fila nueva que escribió registrarCobro es la buena: tiene el transaccionid y el
        // recibo. Esta queda anulada y apuntando a aquella, en vez de borrarse — así el
        // historial muestra que el cobro se registró cuando se registró, no cuando se mandó.
        await updateRow(HOJA_COBROS, 'id_cobro', e.id_cobro, {
          estado: 'anulado',
          error_xubio: '',
          observacion: `${String(c.observacion || '')}${c.observacion ? ' — ' : ''}Enviado a Xubio el ${hoy} como ${r.idCobro || ''}`.trim(),
        }).catch(() => null);
        enviados.push({ id_cobro: e.id_cobro, numero_recibo: String(r.numeroRecibo || '') });
      } else {
        // Se guarda el error y sigue pendiente: mañana se reintenta.
        await updateRow(HOJA_COBROS, 'id_cobro', e.id_cobro, {
          error_xubio: String(r.error || 'Xubio no aceptó el cobro').slice(0, 300),
        }).catch(() => null);
        fallados.push({ id_cobro: e.id_cobro, cliente: e.cliente, importe: e.importe, error: String(r.error || '') });
      }
    }

    if (!fallados.length) {
      return NextResponse.json({ ok: true, enviados: enviados.length, fallados: 0 });
    }

    // Solo se avisa de lo que falló. Si salió todo, no hace falta decir nada: el que carga
    // el cobro ya vio que quedó registrado.
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: true, enviados: enviados.length, fallados: fallados.length, aviso: 'RESEND_API_KEY no configurada' });
    }
    const config = await readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []);
    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) {
      return NextResponse.json({ ok: true, enviados: enviados.length, fallados: fallados.length, aviso: 'sin destinatarios' });
    }

    const $ = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:680px">
        <h2 style="margin:0 0 4px;font-size:18px;color:#991b1b">Cobros que no pudieron entrar a Xubio</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:#6b7280;line-height:1.55">
          Están registrados en la app —la factura figura cobrada y no se reclama— pero el comprobante no existe del otro
          lado. Se reintentan mañana solos. Si el error se repite, hay que resolverlo: un cobro que nunca llega a la
          contabilidad es plata cobrada sin asentar.
          ${enviados.length ? `<br>Los otros <strong>${enviados.length}</strong> sí entraron.` : ''}
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:12.5px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:5px 8px;text-align:left">Cobro</th>
            <th style="padding:5px 8px;text-align:left">Cliente</th>
            <th style="padding:5px 8px;text-align:right">Importe</th>
            <th style="padding:5px 8px;text-align:left">Qué dijo Xubio</th>
          </tr></thead>
          <tbody>${fallados.map((f) => `<tr>
            <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${f.id_cobro}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${f.cliente}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700">${$(f.importe)}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:#991b1b;font-size:11.5px">${f.error}</td>
          </tr>`).join('')}</tbody>
        </table>
        <p style="margin:16px 0 0">
          <a href="${BASE}/cobranzas" style="background:#991b1b;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Ver Cobranzas
          </a>
        </p>
      </div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `${fallados.length} cobro(s) no entraron a Xubio`,
        html,
      }),
    }).catch(() => null);

    return NextResponse.json({ ok: true, enviados: enviados.length, fallados: fallados.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
