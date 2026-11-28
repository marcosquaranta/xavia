import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet, batchUpdateRows, filaDe } from '@/lib/sheets';
import { leerVentasConIdsUnicos } from '@/lib/ventasIds';
import type { ClienteVenta, PrecioVenta, ConfigItem, VentaDia } from '@/lib/types';
import { clavesDeVenta } from '@/lib/clavesVenta';
import { sinConfirmarAlCierre, diferenciasDe, patronesPedidoViejo, soloDia, type Entrega } from '@/lib/entregas';
import { leerEntregas } from '@/lib/entregasServer';
import { emitirPendientes } from '@/lib/facturacionEmitir';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import { destinatariosDe } from '@/lib/avisosConfig';
import { precioFinal } from '@/lib/estadisticasVentas';
import { LABELS_LARGOS } from '@/lib/articulos';
import { nombreClienteVisible } from '@/lib/clientes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = 'https://xavia-self.vercel.app';

// ══ Las 16 h: se cierra el día ════════════════════════════════════════════════════════
//
// Dos cosas, en este orden:
//
//  1. Se factura todo lo que se cargó y nadie confirmó, con las cantidades que se cargaron.
//     Esto es lo que hace que la herramienta no pueda romper nada: el día que el reparto no
//     use el celular, la facturación del día sale igual, como salía antes de que esto
//     existiera. El único costo es que esas facturas salen a las 16 y no a la mañana.
//
//  2. Sale el mail de diferencias.
//
// Se manda lo que se CONFIRMÓ en las últimas 24 h, no lo que tiene fecha de hoy. Así una
// entrega que se confirma tarde (al volver al depósito, o a la mañana siguiente) aparece
// exactamente una vez, y no se repite todos los días hasta que alguien la mire.
const VENTANA_HORAS = 24;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // `ver=1` muestra qué haría sin facturar ni mandar nada. Es la única forma de probar esto
  // sin emitir comprobantes en AFIP.
  const soloVer = new URL(req.url).searchParams.get('ver') === '1';

  try {
    const hoy = fechaArgentinaHoy();
    const [ventas, clientes, precios, entregas, claves, config] = await Promise.all([
      leerVentasConIdsUnicos(),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      leerEntregas(),
      clavesDeVenta(),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    // ── 1. Facturar lo que nadie confirmó ──
    const pendientes = sinConfirmarAlCierre(ventas, entregas, hoy);
    let emitidas: any[] = [];
    let errores: any[] = [];
    if (pendientes.length && !soloVer) {
      // Pasan a la cola igual que cuando se factura desde Ventas: emitirPendientes solo
      // mira las filas en 'PENDIENTE'.
      const claveSet = new Set(pendientes.map((p) => `${p.id_control}||${p.sucursal}`));
      const filas = new Map(ventas.map((v) => [String(v.id_venta), v]));
      const updates = ventas
        .filter((v) => soloDia(v.fecha) === hoy && !String(v.exportado || '').trim()
          && claveSet.has(`${String(v.id_control)}||${String(v.sucursal || '')}`))
        .map((v) => ({ keyValue: String(v.id_venta), fila: filaDe(filas.get(String(v.id_venta))), updates: { exportado: 'PENDIENTE' } }));
      if (updates.length) await batchUpdateRows('Ventas', 'id_venta', updates);
      const r = await emitirPendientes(null, { pares: pendientes.map((p) => ({ id_control: p.id_control, fecha: p.fecha })) });
      emitidas = r.emitidas; errores = r.errores;
    }

    // ── 2. El mail de diferencias ──
    const corte = Date.now() - VENTANA_HORAS * 3600 * 1000;
    const recientes = entregas.filter((e) => {
      const t = Date.parse(e.validado_en || '');
      return Number.isFinite(t) && t >= corte && diferenciasDe(e.lineas).length > 0;
    });

    const nombreDe = new Map(clientes.map((c) => [String(c.id_control), nombreClienteVisible(c)]));
    const clientePorId = new Map(clientes.map((c) => [String(c.id_control), c]));
    const etiqueta = (k: string) => LABELS_LARGOS[k] || k;

    // Valorizado con el precio real de cada cliente y con el IVA adentro (precioFinal), que
    // es lo que efectivamente se le facturó de más o de menos. Se usa el mismo cálculo que
    // la pantalla de ventas: si acá se recalculara con otro criterio, el mail y la factura
    // dirían cosas distintas del mismo día.
    let totalPlata = 0;
    const filas: { cliente: string; sucursal: string; fecha: string; articulo: string; pedido: number; entregado: number; delta: number; plata: number }[] = [];
    for (const e of recientes) {
      const c = clientePorId.get(e.id_control);
      for (const d of diferenciasDe(e.lineas)) {
        const precio = Number(precioFinal(precios, e.id_control, e.sucursal, d.key, c)) || 0;
        const plata = Math.round(d.delta * precio);
        totalPlata += plata;
        filas.push({
          cliente: nombreDe.get(e.id_control) || e.id_control,
          sucursal: e.sucursal, fecha: e.fecha, articulo: etiqueta(d.key),
          pedido: d.pedido, entregado: d.entregado, delta: d.delta, plata,
        });
      }
    }
    filas.sort((a, b) => Math.abs(b.plata) - Math.abs(a.plata));

    const patrones = patronesPedidoViejo(entregas).map((p) => ({
      ...p, cliente: nombreDe.get(p.id_control) || p.id_control, articulo: etiqueta(p.key),
    }));

    const autosHoy = soloVer ? pendientes : emitidas.map((x: any) => ({ id_control: String(x.id_control || ''), cliente: x.cliente || '', fecha: hoy }));

    const resumen = {
      hoy,
      sinConfirmar: pendientes.length,
      emitidas: emitidas.length,
      errores: errores.map((e: any) => `${e.cliente || e.id_control}: ${e.error}`),
      conDiferencia: recientes.length,
      diferencias: filas,
      patrones,
      totalPlata,
    };
    if (soloVer) return NextResponse.json({ ok: true, simulacion: true, ...resumen });

    // Sin diferencias no sale mail. Uno diario que dice "todo bien" se archiva sin abrir y
    // se lleva puesto el día que trae algo.
    if (!filas.length) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'no hubo diferencias', ...resumen });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada', ...resumen }, { status: 500 });

    const destinatarios = destinatariosDe('email_diferencias_entrega', config as any);
    const fmt = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString('es-AR')}`;
    const signo = (n: number) => (n > 0 ? '+' : '−');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:720px">
        <h2 style="margin:0 0 4px;font-size:20px">Entregas del ${hoy} — ${recientes.length} ${recientes.length === 1 ? 'cliente recibió' : 'clientes recibieron'} algo distinto</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          Lo que el reparto confirmó en las últimas 24 horas. ${autosHoy.length} ${autosHoy.length === 1 ? 'entrega se facturó sola' : 'entregas se facturaron solas'} a las 16 porque nadie las confirmó.
        </p>

        <div style="background:${totalPlata < 0 ? '#fef2f2' : '#f0fdf4'};border:1px solid ${totalPlata < 0 ? '#fecaca' : '#bbf7d0'};border-radius:8px;padding:13px 15px;margin-bottom:18px">
          <div style="font-size:15px;font-weight:800;color:${totalPlata < 0 ? '#b91c1c' : '#166534'}">
            Se facturaron ${fmt(totalPlata)} ${totalPlata < 0 ? 'menos' : 'más'} de lo que se había cargado
          </div>
          <div style="font-size:12.5px;color:#6b7280;line-height:1.5;margin-top:4px">
            Valorizado con el precio de cada cliente, con IVA incluido: es lo que se facturó de más o de menos.
          </div>
        </div>

        <table style="border-collapse:collapse;width:100%;font-size:12.5px;margin-bottom:20px">
          <thead><tr style="background:#f9fafb;color:#6b7280">
            <th style="padding:7px 9px;text-align:left">Cliente</th>
            <th style="padding:7px 9px;text-align:left">Producto</th>
            <th style="padding:7px 9px;text-align:right">Cargado</th>
            <th style="padding:7px 9px;text-align:right">Entregado</th>
            <th style="padding:7px 9px;text-align:right">Dif.</th>
            <th style="padding:7px 9px;text-align:right">$</th>
          </tr></thead>
          <tbody>
            ${filas.map((f) => `<tr>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6"><strong>${f.cliente}</strong>${f.sucursal ? `<br><span style="color:#9ca3af;font-size:11px">${f.sucursal}</span>` : ''}</td>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6">${f.articulo}</td>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6;text-align:right;color:#9ca3af">${f.pedido}</td>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700">${f.entregado}</td>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:${f.delta < 0 ? '#b91c1c' : '#166534'}">${signo(f.delta)}${Math.abs(f.delta)}</td>
              <td style="padding:8px 9px;border-bottom:1px solid #f3f4f6;text-align:right;color:${f.plata < 0 ? '#b91c1c' : '#166534'}">${signo(f.plata)}${fmt(f.plata)}</td>
            </tr>`).join('')}
          </tbody>
        </table>

        ${patrones.length ? `
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:13px 15px;margin-bottom:18px">
          <div style="font-size:14px;font-weight:800;color:#92400e;margin-bottom:6px">Estos pedidos fijos quedaron viejos</div>
          <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#78350f;line-height:1.6">
            ${patrones.slice(0, 6).map((p) => `<li>
              <strong>${p.cliente}${p.sucursal ? ` (${p.sucursal})` : ''}</strong> · ${p.articulo}: le cargamos ${p.promedioPedido} y recibe ${p.promedioEntregado} en promedio
              (${p.veces} de las últimas ${p.de} entregas).
            </li>`).join('')}
          </ul>
          <div style="font-size:12px;color:#a16207;margin-top:8px">
            No es un error del reparto: corrigiendo el pedido fijo deja de pasar.
            <a href="${BASE}/admin/pedidos-fijos" style="color:#92400e;font-weight:700">Abrir pedidos fijos</a>
          </div>
        </div>` : ''}

        <p style="margin:0;font-size:11.5px;color:#9ca3af;line-height:1.55">
          Lo que se entregó ya quedó en la venta y en la factura: esta lista es para ver si hay algo que corregir
          hacia atrás, no una tarea pendiente.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Entregas ${hoy} — ${recientes.length} con diferencias (${fmt(totalPlata)} ${totalPlata < 0 ? 'menos' : 'más'})`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}`, ...resumen }, { status: 500 });
    }
    return NextResponse.json({ ok: true, enviado: true, destinatarios, ...resumen });
  } catch (err: any) {
    console.error('[cron/cierre-entregas]', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
