import { readSheet, batchUpdateRows } from './sheets';
import { registrarEmitidas } from './caePendientes';
import type { ClienteVenta, PrecioVenta, VentaDia } from './types';
import { getClientesXubio, matchClienteXubio, emitirFactura, PRODUCTO_CODIGO } from './xubio';

// lechuga_kg queda para no perder ventas por kg cargadas antes del split crespa/roble.
const PROD_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;

const NOMBRE_PROD: Record<string, string> = {
  rucula: 'Rúcula (paquetes)',
  lechuga_crespa: 'Lechuga Crespa',
  hoja_roble: 'Lechuga Hoja de Roble',
  bandeja_rucula: 'Rúcula en bandeja',
  albahaca: 'Albahaca',
  rucula_kg: 'Rúcula (kg)',
  lechuga_kg: 'Lechuga (kg)',
  lechuga_kg_crespa: 'Lechuga Crespa (kg)',
  lechuga_kg_roble: 'Lechuga Hoja de Roble (kg)',
};

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map(s => s.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

// Manda al cliente (Factura B, sin CAE) el detalle de su compra por mail — no es un
// comprobante fiscal, es simplemente el detalle de lo que se le vendió.
async function enviarDetalleVentaCliente(
  email: string, nombreCliente: string, fecha: string,
  detalle: { nombre: string; cantidad: number; precio: number; importe: number }[], total: number
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) { console.error('[facturacionEmitir] RESEND_API_KEY no configurada, no se envía detalle al cliente'); return false; }
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const rows = detalle.map(d => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${d.nombre}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${d.cantidad.toLocaleString('es-AR')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(d.precio)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(d.importe)}</td>
    </tr>`).join('');
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px">Detalle de tu compra — ${fecha}</h2>
      <p style="margin:0 0 14px;color:#555">Hola${nombreCliente ? ' ' + nombreCliente : ''}, este es el detalle de tu compra del ${fecha}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Producto</th>
          <th style="padding:6px 10px;text-align:right">Cantidad</th>
          <th style="padding:6px 10px;text-align:right">Precio unit.</th>
          <th style="padding:6px 10px;text-align:right">Importe</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="3" style="padding:8px 10px;font-weight:700;border-top:2px solid #ddd">Total</td>
          <td style="padding:8px 10px;text-align:right;font-weight:800;border-top:2px solid #ddd">${fmt(total)}</td>
        </tr></tfoot>
      </table>
      <p style="margin:16px 0 0;color:#555;font-size:13px">Gracias por tu compra.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: [email],
        subject: `Detalle de tu compra — Xavia — ${fecha}`,
        html,
      }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error(`[facturacionEmitir] Resend rechazó el mail a ${email}:`, err); }
    return res.ok;
  } catch (e: any) {
    console.error(`[facturacionEmitir] excepción enviando detalle a ${email}:`, e);
    return false;
  }
}

export interface ResultadoEmision {
  emitidas: { cliente: string; numero?: string; cae?: string; emailCliente?: 'enviado' | 'sin_email' | 'error' }[];
  errores: { cliente: string; error: string }[];
}

// Emite a Xubio las ventas PENDIENTE, una factura por cliente. Si idControls se pasa,
// solo emite esos clientes (los demás PENDIENTE quedan intactos). Las que fallan (ej.
// cliente no encontrado en Xubio) quedan como PENDIENTE para reintentar/arreglar desde
// la sección Facturación. Reutilizado por /api/facturacion/emitir y por la carga
// directa de ventas (/api/ventas/cargar).
export async function emitirPendientes(idControls?: string[] | null): Promise<ResultadoEmision> {
  const [clientes, precios, ventas] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    readSheet<VentaDia>('Ventas'),
  ]);
  const idSet = idControls ? new Set(idControls) : null;
  const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE' && (!idSet || idSet.has(String(v.id_control))));
  if (!pendientes.length) return { emitidas: [], errores: [] };

  const clientesXubio = await getClientesXubio();
  const clientesMap = new Map(clientes.map(c => [c.id_control, c]));

  // Agrupa por cliente para armar UNA factura combinada — salvo que el cliente tenga
  // facturar_por_sucursal='SI' (misma razón social, pero pide un comprobante A XUBIO
  // SEPARADO por cada sucursal, ej. "La Esperanza"): ahí la clave de agrupación suma la
  // sucursal, así cada una sale como su propia factura en vez de mezclarse en una sola.
  interface Grupo { idControl: string; sucursal: string | null; lineas: VentaDia[] }
  const grupos = new Map<string, Grupo>();
  for (const v of pendientes) {
    const cliente = clientesMap.get(v.id_control);
    const porSucursal = cliente?.facturar_por_sucursal === 'SI';
    const sucursal = porSucursal ? (v.sucursal || '(sin sucursal)') : null;
    const key = porSucursal ? `${v.id_control}||${sucursal}` : v.id_control;
    if (!grupos.has(key)) grupos.set(key, { idControl: v.id_control, sucursal, lineas: [] });
    grupos.get(key)!.lineas.push(v);
  }

  const emitidas: ResultadoEmision['emitidas'] = [];
  const errores: { cliente: string; error: string }[] = [];
  const paraRegistrar: { cliente: string; numero?: string; cae?: string; fechaVenta: string }[] = [];

  for (const { idControl, sucursal, lineas } of grupos.values()) {
    const cliente = clientesMap.get(idControl);
    // Nombre que se muestra en emitidas/errores — con la sucursal entre paréntesis
    // cuando la factura salió separada, para poder distinguir cuál es cuál de un vistazo.
    const nombre = (cliente?.nombre_xubio || idControl) + (sucursal ? ` (${sucursal})` : '');
    if (!cliente) { errores.push({ cliente: nombre, error: 'cliente no encontrado en la base local' }); continue; }

    const clienteId = matchClienteXubio(cliente.nombre_xubio, clientesXubio);
    if (!clienteId) { errores.push({ cliente: nombre, error: 'no se encontró el cliente en Xubio (revisá que el nombre coincida)' }); continue; }

    const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
    const detalle: { nombre: string; cantidad: number; precio: number; importe: number }[] = [];
    for (const l of lineas) {
      for (const key of PROD_KEYS) {
        const qty = Number((l as any)[key]) || 0;
        if (qty <= 0) continue;
        const precio = getPrecio(precios, idControl, l.sucursal, key, cliente.sucursales);
        // Si la venta tiene sucursal real cargada, va SIEMPRE al frente de la descripción
        // de cada renglón — para que quede clarísimo a qué sucursal corresponde el
        // pedido, esté la factura separada por sucursal o combinada con otras. Clientes
        // sin sucursales (l.sucursal vacío) mantienen la descripción simple de siempre —
        // no tiene sentido inventarles una "sucursal" con su propio nombre.
        const nombreProd = NOMBRE_PROD[key] || key;
        const descripcion = l.sucursal ? `Sucursal ${l.sucursal} — ${nombreProd}` : nombreProd;
        items.push({ codigo: PRODUCTO_CODIGO[key], cantidad: qty, precio, descripcion });
        detalle.push({ nombre: l.sucursal ? `${nombreProd} (${l.sucursal})` : nombreProd, cantidad: qty, precio, importe: qty * precio });
      }
    }
    if (!items.length) {
      // No debería pasar (ya se filtró por cantidad>0 antes de marcar PENDIENTE), pero
      // si pasa no lo dejamos en silencio: sin esto, el cliente quedaba PENDIENTE para
      // siempre sin ningún rastro de error ni de éxito.
      errores.push({ cliente: nombre, error: 'sin productos con cantidad > 0 (revisar la carga de esta venta)' });
      continue;
    }

    const esA = cliente.tipo_factura === 'A';
    let res;
    try {
      res = await emitirFactura({ clienteId, esA, fecha: lineas[0].fecha, items });
    } catch (e: any) {
      console.error(`[facturacionEmitir] excepción emitiendo factura para ${nombre}:`, e);
      errores.push({ cliente: nombre, error: e?.message || 'excepción al emitir' });
      continue;
    }

    if (res.ok) {
      const emitida: ResultadoEmision['emitidas'][number] = { cliente: nombre, numero: res.numeroDocumento, cae: res.cae };

      // Factura B (sin CAE, no se informa a AFIP): el cliente no recibe nada de Xubio,
      // así que le mandamos nosotros el detalle de la venta por mail.
      if (cliente.tipo_factura === 'B') {
        const email = String(cliente.email || '').trim();
        if (!email) {
          emitida.emailCliente = 'sin_email';
        } else {
          const total = detalle.reduce((a, d) => a + d.importe, 0);
          const ok = await enviarDetalleVentaCliente(email, cliente.nombre_display || cliente.nombre_xubio, lineas[0].fecha, detalle, total);
          emitida.emailCliente = ok ? 'enviado' : 'error';
        }
      }

      emitidas.push(emitida);
      paraRegistrar.push({ cliente: nombre, numero: res.numeroDocumento, cae: res.cae, fechaVenta: lineas[0].fecha });
      await batchUpdateRows('Ventas', 'id_venta', lineas.map(l => ({
        keyValue: l.id_venta,
        updates: { exportado: res.numeroDocumento || 'FACTURADO' },
      })));
    } else {
      console.error(`[facturacionEmitir] Xubio rechazó la factura de ${nombre}:`, res.error);
      errores.push({ cliente: nombre, error: res.error || 'Error desconocido' });
    }
  }

  // Queda registrado para el aviso diario de CAEs (ver lib/caePendientes.ts). Antes el
  // mail salía acá mismo, uno por cada carga de ventas.
  await registrarEmitidas(paraRegistrar);
  return { emitidas, errores };
}
