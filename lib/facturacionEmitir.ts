import { readSheet, batchUpdateRows } from './sheets';
import { registrarEmitidas } from './caePendientes';
import { nombreClienteVisible } from './clientes';
import type { ClienteVenta, PrecioVenta, VentaDia } from './types';
import { getClientesXubio, matchClienteXubio, emitirFactura, ultimaFechaPorLetra, PRODUCTO_CODIGO } from './xubio';

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

// ── Informe de lo pendiente, día por día ─────────────────────────────────────────────
//
// Cuando se acumula atraso, la factura sale con fecha de hoy (AFIP no deja ponerle una
// fecha anterior a la del último comprobante emitido). El cliente necesita igual saber de
// qué DÍAS es cada entrega: eso es lo que arma esto, con la fecha original de cada venta.
export interface DiaPendiente {
  fecha: string; // YYYY-MM-DD, la de la venta
  lineas: { nombre: string; sucursal: string; cantidad: number; precio: number; importe: number }[];
  unidades: number;
  total: number;
}

export function detallePendientePorDia(ventas: VentaDia[], precios: PrecioVenta[], cliente: ClienteVenta): DiaPendiente[] {
  const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];
  const porDia = new Map<string, DiaPendiente>();
  for (const v of ventas) {
    if (v.exportado !== 'PENDIENTE') continue;
    if (String(v.id_control) !== String(cliente.id_control)) continue;
    const fecha = soloFecha(v.fecha);
    if (!porDia.has(fecha)) porDia.set(fecha, { fecha, lineas: [], unidades: 0, total: 0 });
    const dia = porDia.get(fecha)!;
    for (const key of PROD_KEYS) {
      const cantidad = Number((v as any)[key]) || 0;
      if (cantidad <= 0) continue;
      const precio = getPrecio(precios, String(cliente.id_control), v.sucursal, key, cliente.sucursales);
      dia.lineas.push({ nombre: NOMBRE_PROD[key] || key, sucursal: v.sucursal || '', cantidad, precio, importe: cantidad * precio });
      dia.unidades += cantidad;
      dia.total += cantidad * precio;
    }
  }
  return [...porDia.values()].filter(d => d.lineas.length).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// El mismo informe, por mail al cliente.
export async function enviarPendientePorDia(email: string, nombreCliente: string, dias: DiaPendiente[]): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) { console.error('[facturacionEmitir] RESEND_API_KEY no configurada'); return false; }
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const fmtDia = (f: string) => { const [y, m, d] = f.split('-'); return d ? `${d}/${m}/${y}` : f; };
  const total = dias.reduce((a, d) => a + d.total, 0);
  const unidades = dias.reduce((a, d) => a + d.unidades, 0);

  const bloques = dias.map(d => `
    <h3 style="margin:18px 0 6px;font-size:15px;color:#111">${fmtDia(d.fecha)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:5px 9px;text-align:left">Producto</th>
        <th style="padding:5px 9px;text-align:left">Sucursal</th>
        <th style="padding:5px 9px;text-align:right">Cant.</th>
        <th style="padding:5px 9px;text-align:right">Precio</th>
        <th style="padding:5px 9px;text-align:right">Importe</th>
      </tr></thead>
      <tbody>${d.lineas.map(l => `
        <tr>
          <td style="padding:5px 9px;border-bottom:1px solid #eee">${l.nombre}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;color:#666">${l.sucursal}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right">${l.cantidad.toLocaleString('es-AR')}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;color:#666">${fmt(l.precio)}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(l.importe)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="4" style="padding:6px 9px;font-weight:600;text-align:right">Total del día</td>
        <td style="padding:6px 9px;text-align:right;font-weight:700">${fmt(d.total)}</td>
      </tr></tfoot>
    </table>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
      <h2 style="margin:0 0 4px">Detalle de entregas pendientes de facturar</h2>
      <p style="margin:0 0 6px;color:#555">Hola${nombreCliente ? ' ' + nombreCliente : ''}, te pasamos el detalle de las entregas que todavía no están facturadas, día por día.</p>
      <p style="margin:0 0 14px;color:#555;font-size:13px">Son ${dias.length} ${dias.length === 1 ? 'día' : 'días'} · ${unidades.toLocaleString('es-AR')} unidades · <strong>${fmt(total)}</strong>.</p>
      ${bloques}
      <p style="margin:20px 0 0;padding-top:12px;border-top:2px solid #ddd;font-size:15px">
        <strong>Total general: ${fmt(total)}</strong>
      </p>
      <p style="margin:14px 0 0;color:#555;font-size:13px">Cualquier diferencia con tus remitos, avisanos antes de que emitamos las facturas.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: [email],
        subject: `Entregas pendientes de facturar — Xavia`,
        html,
      }),
    });
    if (!res.ok) { console.error('[facturacionEmitir] Resend rechazó el detalle pendiente:', await res.json().catch(() => ({}))); }
    return res.ok;
  } catch (e) {
    console.error('[facturacionEmitir] excepción enviando detalle pendiente:', e);
    return false;
  }
}

// Cada factura del resultado viene con sus datos SEPARADOS —cliente, sucursal, fecha— y no
// armados en una sola línea de texto: después de emitir un lote hay que poder revisar de un
// vistazo qué salió y qué no, cliente por cliente y sucursal por sucursal.
// Lo que el que carga necesita verificar: qué producto, cuánto y para qué sucursal. El
// número de comprobante y el importe son para administración, no para él.
export interface ItemFacturado {
  producto: string;
  sucursal: string;   // vacío en clientes sin sucursales
  cantidad: number;
}

export interface FacturaEmitida {
  cliente: string;          // nombre del cliente, sin adornos
  sucursal?: string;        // cuando la factura salió separada por sucursal
  fechaVenta: string;       // la fecha de la entrega
  items: ItemFacturado[];
  numero?: string;
  cae?: string;
  total: number;
  emailCliente?: 'enviado' | 'sin_email' | 'error';
  // Cuando la factura no pudo salir con la fecha de la venta (ver fechaDeFactura).
  fechaAjustada?: { venta: string; factura: string };
}

export interface FacturaConError {
  cliente: string;
  sucursal?: string;
  fechaVenta: string;
  // Lo que NO salió. Va igual que en las emitidas: si hay que reclamar o rehacer algo,
  // lo primero que se necesita es saber qué mercadería quedó sin facturar.
  items: ItemFacturado[];
  total: number;
  error: string;
}

export interface ResultadoEmision {
  emitidas: FacturaEmitida[];
  errores: FacturaConError[];
}

// Con qué fecha se emite la factura.
//
// No siempre puede ser la fecha de la venta. La numeración del punto de venta es correlativa
// y AFIP no acepta que un comprobante con número mayor tenga fecha anterior a uno ya
// emitido. Con ventas viejas sin facturar —y algo más nuevo ya emitido en el medio— Xubio
// rechaza la factura entera:
//   "El documento número A-00002-00000849 tiene fecha mayor a la fecha del documento que
//    desea emitir".
// Eso es exactamente lo que dejó sin facturar a La Esperanza Funes (sept-2026).
//
// Entonces: se usa la fecha MÁS NUEVA de las ventas que entran en la factura, llevada hacia
// adelante hasta la del último comprobante ya emitido en esa letra, y sin pasarse de hoy.
// La fecha de entrega no se pierde: sigue en la hoja Ventas y en el detalle de cada renglón.
export function fechaDeFactura(fechasVenta: string[], ultimaEmitida: string | undefined, hoy: string): string {
  const masNueva = [...fechasVenta].filter(Boolean).sort().pop() || hoy;
  const piso = ultimaEmitida && ultimaEmitida > masNueva ? ultimaEmitida : masNueva;
  return piso > hoy ? hoy : piso;
}

// Un día suelto de un cliente. Sirve para facturar el atraso día por día en vez de juntar
// todo en un comprobante: cuando quedaron ventas de varias fechas sin facturar, una factura
// por día es lo que después se puede conciliar contra los remitos del cliente.
export interface ParFechaCliente { id_control: string; fecha: string }

// Emite a Xubio las ventas PENDIENTE, una factura por cliente. Si idControls se pasa,
// solo emite esos clientes (los demás PENDIENTE quedan intactos). Las que fallan (ej.
// cliente no encontrado en Xubio) quedan como PENDIENTE para reintentar/arreglar desde
// la sección Facturación. Reutilizado por /api/facturacion/emitir y por la carga
// directa de ventas (/api/ventas/cargar).
//
// Con `pares` se factura día por día: solo esas combinaciones cliente+fecha, y cada fecha
// sale como su propia factura.
export async function emitirPendientes(
  idControls?: string[] | null, opciones: { pares?: ParFechaCliente[]; porFecha?: boolean } = {},
): Promise<ResultadoEmision> {
  const [clientes, precios, ventas] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    readSheet<VentaDia>('Ventas'),
  ]);
  const idSet = idControls ? new Set(idControls) : null;
  // Una factura por FECHA de venta, no una sola con todo junto. En el día a día no cambia
  // nada (hay una sola fecha pendiente por cliente), pero cuando se acumuló atraso cada día
  // sale en su propio comprobante y se puede conciliar contra los remitos del cliente.
  const porFecha = opciones.porFecha !== false;
  // El filtro por días puntuales depende de que VENGAN días puntuales, no de porFecha.
  // Cuando esto colgaba de porFecha —que ahora es true por defecto— la carga diaria de
  // ventas, que llama sin `pares`, reventaba con "Cannot read properties of undefined
  // (reading 'map')". El `!` de TypeScript tapó justamente el caso que rompía.
  const parSet = opciones.pares?.length
    ? new Set(opciones.pares.map(p => `${p.id_control}||${p.fecha}`))
    : null;
  const pendientes = ventas.filter(v =>
    v.exportado === 'PENDIENTE'
    && (!idSet || idSet.has(String(v.id_control)))
    && (!parSet || parSet.has(`${String(v.id_control)}||${String(v.fecha || '').split(/[T ]/)[0]}`)));
  if (!pendientes.length) return { emitidas: [], errores: [] };

  const clientesXubio = await getClientesXubio();
  const clientesMap = new Map(clientes.map(c => [c.id_control, c]));
  // Una sola consulta para todo el lote: la fecha del último comprobante de cada letra.
  // Si falla, se sigue igual con la fecha de la venta — que es el comportamiento de antes.
  const ultimaFecha = await ultimaFechaPorLetra().catch((e) => {
    console.error('[facturacionEmitir] no se pudo leer la última fecha por letra:', e);
    return {} as Record<string, string>;
  });
  const hoyAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // Agrupa por cliente para armar UNA factura combinada — salvo que el cliente tenga
  // facturar_por_sucursal='SI' (misma razón social, pero pide un comprobante A XUBIO
  // SEPARADO por cada sucursal, ej. "La Esperanza"): ahí la clave de agrupación suma la
  // sucursal, así cada una sale como su propia factura en vez de mezclarse en una sola.
  interface Grupo { idControl: string; sucursal: string | null; fecha: string | null; lineas: VentaDia[] }
  const grupos = new Map<string, Grupo>();
  for (const v of pendientes) {
    const cliente = clientesMap.get(v.id_control);
    const porSucursal = cliente?.facturar_por_sucursal === 'SI';
    const sucursal = porSucursal ? (v.sucursal || '(sin sucursal)') : null;
    const fecha = porFecha ? String(v.fecha || '').split(/[T ]/)[0] : null;
    const key = [v.id_control, sucursal ?? '', fecha ?? ''].join('||');
    if (!grupos.has(key)) grupos.set(key, { idControl: v.id_control, sucursal, fecha, lineas: [] });
    grupos.get(key)!.lineas.push(v);
  }
  // De la fecha más vieja a la más nueva: la numeración del punto de venta avanza con las
  // fechas, así que emitir al revés obligaría a empujar todo a la fecha más nueva (ver
  // fechaDeFactura). Sin esto, facturar el atraso día por día terminaría con todos los
  // comprobantes en la misma fecha.
  const ordenados = [...grupos.values()].sort((a, b) =>
    String(a.lineas[0]?.fecha || '').localeCompare(String(b.lineas[0]?.fecha || '')));

  const emitidas: ResultadoEmision['emitidas'] = [];
  const errores: FacturaConError[] = [];
  const paraRegistrar: { cliente: string; numero?: string; cae?: string; fechaVenta: string }[] = [];

  for (const { idControl, sucursal, fecha, lineas } of ordenados) {
    const cliente = clientesMap.get(idControl);
    // Nombre que se muestra en emitidas/errores — con la sucursal entre paréntesis
    // cuando la factura salió separada, para poder distinguir cuál es cuál de un vistazo.
    const nombre = (cliente?.nombre_xubio || idControl) + (sucursal ? ` (${sucursal})` : '') + (fecha ? ` — ${fecha}` : '');
    const fechaLinea = String(lineas[0]?.fecha || '').split(/[T ]/)[0];
    const datos: { cliente: string; sucursal?: string; fechaVenta: string; items: ItemFacturado[]; total: number } = {
      cliente: cliente?.nombre_xubio || nombreClienteVisible(cliente) || idControl,
      sucursal: sucursal || undefined, fechaVenta: fechaLinea, items: [], total: 0,
    };
    if (!cliente) { errores.push({ ...datos, error: 'cliente no encontrado en la base local' }); continue; }


    // Se calcula antes de armar los renglones porque la descripción de cada uno lleva la
    // fecha de entrega cuando la factura no puede salir con esa fecha (ver fechaDeFactura):
    // el comprobante dice hoy, pero el cliente tiene que poder ver de qué día es cada cosa.
    const esA_ = cliente.tipo_factura === 'A';
    const fechaVenta = [...lineas.map(l => String(l.fecha || ''))].filter(Boolean).sort().pop() || hoyAR;
    const fechaFactura = fechaDeFactura(lineas.map(l => String(l.fecha || '')), ultimaFecha[esA_ ? 'A' : 'B'], hoyAR);
    const mostrarFecha = fechaFactura !== fechaVenta;
    const ddmm = (f: string) => { const [, m, d] = String(f).split('-'); return d ? `${d}/${m}` : f; };

    const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
    const detalle: { nombre: string; cantidad: number; precio: number; importe: number }[] = [];
    const itemsVerificacion: ItemFacturado[] = [];
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
        // La descripción ARRANCA por lo que distingue al renglón — la sucursal, y si hace
        // falta la fecha de entrega. En la grilla de Xubio se ve solo el principio del
        // campo: con "Sucursal Funes — Rúcula" todos los renglones empezaban igual
        // ("Sucursal…") y no se podía distinguir nada al momento de facturar.
        const prefijo = [l.sucursal || '', mostrarFecha ? ddmm(String(l.fecha || '')) : '']
          .filter(Boolean).join(' ');
        const descripcion = prefijo ? `${prefijo} — ${nombreProd}` : nombreProd;
        items.push({ codigo: PRODUCTO_CODIGO[key], cantidad: qty, precio, descripcion });
        detalle.push({ nombre: l.sucursal ? `${nombreProd} (${l.sucursal})` : nombreProd, cantidad: qty, precio, importe: qty * precio });
        // Se acumula por producto+sucursal: dos renglones del mismo producto a la misma
        // sucursal son una sola cosa para el que controló la carga del camión.
        const ya = itemsVerificacion.find(it => it.producto === nombreProd && it.sucursal === (l.sucursal || ''));
        if (ya) ya.cantidad += qty;
        else itemsVerificacion.push({ producto: nombreProd, sucursal: l.sucursal || '', cantidad: qty });
      }
    }
    if (!items.length) {
      // No debería pasar (ya se filtró por cantidad>0 antes de marcar PENDIENTE), pero
      // si pasa no lo dejamos en silencio: sin esto, el cliente quedaba PENDIENTE para
      // siempre sin ningún rastro de error ni de éxito.
      errores.push({ ...datos, error: 'sin productos con cantidad > 0 (revisar la carga de esta venta)' });
      continue;
    }

    const totalFactura = Math.round(detalle.reduce((a, d) => a + d.importe, 0));
    datos.items = itemsVerificacion;
    datos.total = totalFactura;

    // El cliente de Xubio se busca recién acá, con los renglones ya armados: es el error
    // más común de todos, y sin los items el aviso no diría qué mercadería quedó sin
    // facturar, que es lo primero que hay que saber para resolverlo.
    const clienteId = matchClienteXubio(cliente.nombre_xubio, clientesXubio);
    if (!clienteId) { errores.push({ ...datos, error: 'no se encontró el cliente en Xubio (revisá que el nombre coincida)' }); continue; }
    const esA = esA_;
    let res;
    try {
      res = await emitirFactura({ clienteId, esA, fecha: fechaFactura, items });
    } catch (e: any) {
      console.error(`[facturacionEmitir] excepción emitiendo factura para ${nombre}:`, e);
      errores.push({ ...datos, total: totalFactura, error: e?.message || 'excepción al emitir' });
      continue;
    }

    if (res.ok) {
      const emitida: FacturaEmitida = { ...datos, total: totalFactura, numero: res.numeroDocumento, cae: res.cae };
      if (fechaFactura !== fechaVenta) emitida.fechaAjustada = { venta: fechaVenta, factura: fechaFactura };
      // La numeración avanzó: la próxima factura de este lote no puede ir más atrás.
      if (fechaFactura > (ultimaFecha[esA ? 'A' : 'B'] || '')) ultimaFecha[esA ? 'A' : 'B'] = fechaFactura;

      // Factura B (sin CAE, no se informa a AFIP): el cliente no recibe nada de Xubio,
      // así que le mandamos nosotros el detalle de la venta por mail.
      if (cliente.tipo_factura === 'B') {
        const email = String(cliente.email || '').trim();
        if (!email) {
          emitida.emailCliente = 'sin_email';
        } else {
          const total = detalle.reduce((a, d) => a + d.importe, 0);
          const ok = await enviarDetalleVentaCliente(email, cliente.nombre_display || cliente.nombre_xubio, fechaVenta, detalle, total);
          emitida.emailCliente = ok ? 'enviado' : 'error';
        }
      }

      emitidas.push(emitida);
      paraRegistrar.push({ cliente: nombre, numero: res.numeroDocumento, cae: res.cae, fechaVenta });
      await batchUpdateRows('Ventas', 'id_venta', lineas.map(l => ({
        keyValue: l.id_venta,
        updates: { exportado: res.numeroDocumento || 'FACTURADO' },
      })));
    } else {
      console.error(`[facturacionEmitir] Xubio rechazó la factura de ${nombre}:`, res.error);
      errores.push({ ...datos, total: totalFactura, error: res.error || 'Error desconocido' });
    }
  }

  // Queda registrado para el aviso diario de CAEs (ver lib/caePendientes.ts). Antes el
  // mail salía acá mismo, uno por cada carga de ventas.
  await registrarEmitidas(paraRegistrar);
  return { emitidas, errores };
}
