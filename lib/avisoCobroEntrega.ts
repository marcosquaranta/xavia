import { LABELS_LARGOS } from './articulos';
// ── Aviso: entregas que se cobran en el momento ──────────────────────────────────────
//
// CORRECCIÓN (Marcos, nov-2026): esto NO es cobro contra entrega. Estas sucursales no
// pagan la mercadería que se les está dejando: lo que pasa es que, ya que el camión va
// hasta ahí, se aprovecha para cobrar las facturas viejas que tienen abiertas.
//
// La diferencia no es de redacción. "Pagá lo de hoy" y "tené preparado lo que debés" son
// dos pedidos distintos, y el segundo necesita decir CUÁNTO. Un aviso que dice lo que no
// es se deja de leer, y de paso le pide al repartidor algo que el cliente no va a hacer.
//
// Por eso el aviso ahora sale a dos lados: a Marcos, para que le avise al repartidor, y al
// CLIENTE, para que tenga la plata lista cuando el camión llegue. Pedirlo el día que se
// carga la venta es lo que hace que sirva — pedirlo cuando el camión está en la puerta es
// pedir que lo dejen para la próxima.
//
// (Comentario original, que sigue valiendo para el disparo:)
// Hay sucursales que le pagan al repartidor contra entrega. Si Marcos no se entera de que
// ese día hay un pedido para una de ellas, el repartidor va sin saber que tiene que cobrar
// y la plata queda para la próxima — o se pierde el viaje.
//
// El aviso sale cuando se cargan las ventas del día, que es el momento en que todavía se
// puede llamar al repartidor. Después ya no sirve.

import type { VentaDia, ClienteVenta } from './types';

// Qué combinaciones cliente + sucursal se cobran en la entrega. Se compara sin acentos y
// sin mayúsculas, y por "contiene", porque el nombre de la sucursal en la hoja no siempre
// se escribe igual ("Uriburu", "La Esperanza Uriburu", "uriburu 2500").
export const COBRO_EN_ENTREGA: { cliente: string; sucursales: string[] }[] = [
  { cliente: 'esperanza', sucursales: ['uriburu', 'sur'] },
];

// Las mismas reglas, pero editables sin tocar código.
//
// El aviso se cae en silencio por una sola razón: que la sucursal en la hoja de ventas se
// llame distinto de como está escrita acá. "Zona Sur" matchea con 'sur', pero "Avellaneda" o
// "Quilmes" no, y nadie se entera — no hay error, simplemente no sale el mail, y el
// repartidor va sin saber que tiene que cobrar.
//
// Por eso se pueden agregar alias desde Configuración, con la clave `aviso_entrega_sucursales`
// y el formato `cliente: suc1, suc2 | otrocliente: suc3`. Lo que se cargue ahí se SUMA a lo de
// arriba: agregar un alias no puede romper lo que ya andaba.
export const CONFIG_SUCURSALES_ENTREGA = 'aviso_entrega_sucursales';

export function reglasDeEntrega(config: { clave: string; valor: any }[] = []): { cliente: string; sucursales: string[] }[] {
  const reglas = COBRO_EN_ENTREGA.map((r) => ({ cliente: r.cliente, sucursales: [...r.sucursales] }));
  const fila = config.find((c) => String(c.clave).trim() === CONFIG_SUCURSALES_ENTREGA);
  for (const parte of String(fila?.valor || '').split('|')) {
    const [cli, sucs] = parte.split(':');
    const cliente = norm(cli);
    const lista = String(sucs || '').split(',').map((x) => norm(x)).filter(Boolean);
    if (!cliente || !lista.length) continue;
    const ya = reglas.find((r) => norm(r.cliente) === cliente);
    if (ya) for (const x of lista) { if (!ya.sucursales.some((y) => norm(y) === x)) ya.sucursales.push(x); }
    else reglas.push({ cliente, sucursales: lista });
  }
  return reglas;
}

const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const PROD_LABELS: Record<string, string> = {
  ...LABELS_LARGOS,
  rucula: 'Rúcula', lechuga_crespa: 'Lechuga crespa', hoja_roble: 'Hoja de roble',
  bandeja_rucula: 'Bandeja de rúcula', albahaca: 'Albahaca',
  rucula_kg: 'Rúcula (kg)', lechuga_kg: 'Lechuga (kg)',
  lechuga_kg_crespa: 'Lechuga crespa (kg)', lechuga_kg_roble: 'Lechuga roble (kg)',
};

export interface EntregaConCobro {
  cliente: string;
  sucursal: string;
  fecha: string;
  items: { producto: string; cantidad: number }[];
  // Lo que el cliente tiene abierto HOY. Es el motivo del aviso: sin el número, el pedido
  // al cliente es "traé plata" y el aviso al repartidor es "cobrá algo".
  deuda?: { facturas: number; monto: number; masVieja: string };
  // A quién escribirle del lado del cliente. Vacío = no se le puede pedir nada y el aviso
  // interno lo dice, en vez de que Marcos crea que el pedido salió.
  emailCliente?: string;
  idControl?: string;
}

// Las ventas de `fecha` que caen en una sucursal de cobro contra entrega.
// `fecha` ya no filtra: es solo el valor por defecto para una fila sin fecha.
//
// Antes se descartaba toda venta cuya fecha no fuera la del día de carga. Una entrega de
// mañana cargada hoy —que es cuando MÁS sirve el aviso, porque todavía se puede llamar al
// repartidor— no disparaba nada. El aviso es "se cargó una venta para una sucursal que cobra
// contra entrega", y eso no depende de para qué día sea la entrega.
export function entregasConCobro(
  ventas: VentaDia[], clientes: ClienteVenta[], fecha: string,
  reglas: { cliente: string; sucursales: string[] }[] = COBRO_EN_ENTREGA,
): EntregaConCobro[] {
  const out: EntregaConCobro[] = [];
  for (const v of ventas) {
    const fechaVenta = String(v.fecha || '').split(/[T ]/)[0] || fecha;
    const cliente = clientes.find(c => String(c.id_control) === String(v.id_control));
    const nombreCliente = norm(cliente?.nombre_xubio || v.nombre_cliente);
    const sucursal = norm(v.sucursal);
    const regla = reglas.find(r =>
      nombreCliente.includes(norm(r.cliente)) && r.sucursales.some(suc => sucursal.includes(norm(suc))));
    if (!regla) continue;

    const items: { producto: string; cantidad: number }[] = [];
    for (const [key, label] of Object.entries(PROD_LABELS)) {
      const qty = Number((v as any)[key]) || 0;
      if (qty > 0) items.push({ producto: label, cantidad: qty });
    }
    if (!items.length) continue;

    // Dos filas de la misma sucursal el mismo día son una sola entrega. De días distintos,
    // no: son dos entregas y el repartidor tiene que cobrar las dos.
    const ya = out.find(e => e.cliente === (cliente?.nombre_xubio || v.nombre_cliente) && e.sucursal === v.sucursal && e.fecha === fechaVenta);
    if (ya) {
      for (const it of items) {
        const prev = ya.items.find(x => x.producto === it.producto);
        if (prev) prev.cantidad += it.cantidad;
        else ya.items.push(it);
      }
    } else {
      out.push({ cliente: cliente?.nombre_xubio || String(v.nombre_cliente || ''), sucursal: v.sucursal, fecha: fechaVenta, items });
    }
  }
  return out;
}

// Mail a administración. No va al cliente ni al repartidor: es para que Marcos avise.
export async function avisarCobroEnEntrega(entregas: EntregaConCobro[], destinatarios: string[]): Promise<boolean> {
  if (!entregas.length || !destinatarios.length) return false;
  if (!process.env.RESEND_API_KEY) { console.error('[avisoCobroEntrega] RESEND_API_KEY no configurada'); return false; }

  const fmtDia = (f: string) => { const [y, m, d] = String(f).split('-'); return d ? `${d}/${m}/${y}` : f; };

  const bloques = entregas.map(e => `
    <div style="margin:0 0 12px;padding:10px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px">
      <p style="margin:0;font-size:15px;font-weight:700;color:#111">${e.cliente} — ${e.sucursal}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#92400e">Entrega del ${fmtDia(e.fecha)}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#111">
        ${e.items.map(i => `<strong>${i.cantidad.toLocaleString('es-AR')}</strong> ${i.producto}`).join(' · ')}
      </p>
      ${e.deuda && e.deuda.monto > 0
        ? `<p style="margin:7px 0 0;font-size:14px;color:#991b1b;font-weight:700">
             Tiene ${e.deuda.facturas} factura(s) abiertas por $${Math.round(e.deuda.monto).toLocaleString('es-AR')}
             <span style="display:block;font-weight:400;font-size:12px;color:#92400e">la más vieja del ${fmtDia(e.deuda.masVieja)}</span>
           </p>`
        : `<p style="margin:7px 0 0;font-size:13px;color:#6b7280">No le figura deuda abierta: no hay nada que cobrar.</p>`}
      ${e.emailCliente
        ? `<p style="margin:5px 0 0;font-size:12px;color:#166534">✓ Al cliente se le pidió el pago por mail (${e.emailCliente}).</p>`
        : `<p style="margin:5px 0 0;font-size:12px;color:#b45309">⚠ Este cliente no tiene mail cargado: el pedido de pago NO salió. Avisale vos.</p>`}
    </div>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px">Vamos a repartir — avisale al repartidor que cobre</h2>
      <p style="margin:0 0 12px;color:#555">
        Se cargó una venta para una sucursal a la que se le cobra aprovechando el viaje. No es contra entrega:
        lo que hay que cobrar son las facturas que ya tiene abiertas.
      </p>
      ${bloques}
      <p style="margin:14px 0 0;color:#555;font-size:13px">Este aviso sale en el momento en que se carga la venta, no al día siguiente: la idea es que todavía se pueda llamar al repartidor.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Cobrar al repartir — ${entregas.map(e => e.sucursal).join(', ')} — ${entregas.map(e => fmtDia(e.fecha)).filter((x, i, arr) => arr.indexOf(x) === i).join(' y ')}`,
        html,
      }),
    });
    if (!res.ok) console.error('[avisoCobroEntrega] Resend rechazó el aviso:', await res.json().catch(() => ({})));
    return res.ok;
  } catch (e) {
    console.error('[avisoCobroEntrega] excepción enviando el aviso:', e);
    return false;
  }
}


// ── El pedido al cliente ────────────────────────────────────────────────────────────
//
// Sale el día que se carga la venta, no cuando el camión está en la puerta: pedir la plata
// con el repartidor esperando es pedir que lo dejen para la próxima.
//
// Se manda SOLO si tiene deuda abierta. Un mail que dice "prepará el pago" a alguien que no
// debe nada es la forma más rápida de que el cliente deje de leer estos mails — y después
// no lee el que sí importa.
//
// Va con copia a administración, siempre. Un mail automático que sale al cliente sin que
// nadie de la casa vea qué decía es un mail que puede estar diciendo cualquier cosa durante
// meses sin que nos enteremos.
export async function pedirPagoAlCliente(
  e: EntregaConCobro, copia: string[],
): Promise<boolean> {
  if (!e.emailCliente || !e.deuda || e.deuda.monto <= 0) return false;
  if (!process.env.RESEND_API_KEY) return false;

  const fmtDia = (f: string) => { const [y, m, d] = String(f).split('-'); return d ? `${d}/${m}/${y}` : f; };
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <p style="font-size:14px">Hola, ¿cómo están?</p>
      <p style="font-size:14px">
        El <strong>${fmtDia(e.fecha)}</strong> vamos a estar entregando en <strong>${e.sucursal}</strong>.
        Aprovechamos para pedirles si nos pueden dejar preparado el pago de los comprobantes que
        tienen pendientes, así lo retira el repartidor en el mismo viaje y nos evitamos pasar aparte.
      </p>
      <div style="margin:12px 0;padding:11px 13px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa">
        <p style="margin:0;font-size:15px;font-weight:700">${e.deuda.facturas} comprobante(s) pendientes — ${$(e.deuda.monto)}</p>
        <p style="margin:3px 0 0;font-size:12.5px;color:#6b7280">El más antiguo es del ${fmtDia(e.deuda.masVieja)}.</p>
      </div>
      <p style="font-size:13px;color:#555">
        Si ya lo abonaron o hay algo que no les cierra, avisennos y lo revisamos antes de pasar.
      </p>
      <p style="font-size:13px;color:#555">¡Gracias!<br />Xavia</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: [e.emailCliente],
        cc: copia,
        subject: `Entrega del ${fmtDia(e.fecha)} en ${e.sucursal} — ¿nos dejan preparado el pago?`,
        html,
      }),
    });
    if (!res.ok) console.error('[avisoCobroEntrega] Resend rechazó el pedido al cliente:', await res.text().catch(() => ''));
    return res.ok;
  } catch (err) {
    console.error('[avisoCobroEntrega] excepción pidiendo el pago al cliente:', err);
    return false;
  }
}

// ── El disparo completo, para los dos caminos de guardado ─────────────────────────────
//
// Antes esto vivía suelto adentro de /api/ventas/cargar, así que la corrección desde el
// historial —que es el otro camino por el que una venta llega a la planilla— no avisaba nada.
// Una venta cargada mal y corregida después nunca disparaba el aviso.
//
// Acá adentro: lee las reglas (las fijas más los alias de Configuración), arma las entregas,
// saltea las que ya se avisaron y manda una sola vez.
export async function avisarEntregasNuevas(
  ventas: VentaDia[], fecha: string, destinatarios: string[],
): Promise<{ avisadas: { cliente: string; sucursal: string; fecha: string }[]; yaAvisadas: number }> {
  const { readSheet } = await import('./sheets');
  const { avisosYaEnviados, registrarAvisos, claveAviso } = await import('./avisoEntregaEnviado');

  const [clientes, config] = await Promise.all([
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => [] as { clave: string; valor: any }[]),
  ]);

  const entregas = entregasConCobro(ventas, clientes, fecha, reglasDeEntrega(config));
  if (!entregas.length) return { avisadas: [], yaAvisadas: 0 };

  const ya = await avisosYaEnviados();
  const nuevas = entregas.filter((e) => !ya.has(claveAviso(e.cliente, e.sucursal, e.fecha)));
  if (!nuevas.length) return { avisadas: [], yaAvisadas: entregas.length };

  // ── Cuánto debe cada uno, y a quién escribirle ──────────────────────────────────
  //
  // El aviso sin el monto no sirve: "cobrale" no le dice al repartidor cuánto pedir, y
  // "prepará el pago" no le dice al cliente de qué. Se calcula acá, con el mismo criterio
  // que el resto de la app —cobrado desde la app, imputado a mano o dado por saldado no es
  // deuda— para que el número que ve el cliente sea el mismo que el de Cobranzas.
  //
  // Todo adentro de su propio try: la venta ya se cargó y las facturas ya se emitieron. Si
  // no se puede calcular la deuda, el aviso sale igual sin ella, que es mejor que no salir.
  try {
    const { facturasPorCliente } = await import('./facturasCliente');
    const { comprobantesParaMirar } = await import('./xubioLectura');
    const { leerSaldadas, numerosSaldados } = await import('./facturasSaldadas');
    const { leerEdiciones, imputacionesManuales } = await import('./cobranzasEdit');
    const { claveComprobante } = await import('./comprobantes');
    const { HOJA_COBROS } = await import('./cobros');

    const hoyISO = new Date().toISOString().slice(0, 10);
    const desde = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    // Las mismas fuentes que usa Cobranzas: lo cobrado desde la app, lo imputado a mano y
    // lo dado por saldado. Con menos de eso, el cliente recibiría un pedido de pago por
    // facturas que ya pagó, que es el peor mail que le podemos mandar.
    const [comprobantes, cobros, saldadasFilas, edicionesRaw] = await Promise.all([
      comprobantesParaMirar(desde, hoyISO).catch(() => [] as any[]),
      readSheet<any>(HOJA_COBROS).catch(() => [] as any[]),
      leerSaldadas().catch(() => [] as any[]),
      leerEdiciones().catch(() => [] as any[]),
    ]);
    const porCliente = facturasPorCliente(
      comprobantes, cobros, clientes,
      numerosSaldados(saldadasFilas), undefined,
      imputacionesManuales(edicionesRaw, claveComprobante),
    );

    for (const e of nuevas) {
      const cli = clientes.find((c) => norm(c.nombre_xubio || '') === norm(e.cliente) || norm(String(c.nombre_display || '')) === norm(e.cliente));
      if (!cli) continue;
      e.idControl = String(cli.id_control);
      // El mail general, y si no hay, el de cobranzas: para pedir un pago, el de cobranzas
      // es incluso el más indicado.
      const mail = String((cli as any).email_cobranza || '').includes('@')
        ? String((cli as any).email_cobranza)
        : String(cli.email || '');
      e.emailCliente = mail.split(/[,;]+/).map((x) => x.trim()).find((x) => x.includes('@')) || '';

      const abiertas = (porCliente[String(cli.id_control)] || [])
        .filter((f: any) => !f.yaCobrada && !f.saldadaManual && !f.imputadaManual && !f.cubierta);
      if (abiertas.length) {
        e.deuda = {
          facturas: abiertas.length,
          monto: abiertas.reduce((a: number, f: any) => a + (Number(f.importe) || 0), 0),
          masVieja: abiertas.map((f: any) => String(f.fecha)).sort()[0] || '',
        };
      }
    }
  } catch (err) {
    console.error('[avisoCobroEntrega] no se pudo calcular la deuda:', err);
  }

  // El pedido al cliente sale ANTES del aviso interno, para que el interno pueda decir si
  // salió o no. Al revés, Marcos leería "se le pidió" sin que fuera cierto.
  for (const e of nuevas) {
    if (!e.emailCliente || !e.deuda) continue;
    const salio = await pedirPagoAlCliente(e, destinatarios);
    if (!salio) e.emailCliente = '';   // no se le pudo pedir: que el interno lo diga
  }

  const ok = await avisarCobroEnEntrega(nuevas, destinatarios);
  // Solo se anota lo que de verdad salió: si el mail falló, el próximo guardado tiene que
  // volver a intentarlo. Anotarlo igual convertiría un mail perdido en un mail que nunca
  // más se manda.
  if (ok) await registrarAvisos(nuevas.map((e) => ({ cliente: e.cliente, sucursal: e.sucursal, fecha: e.fecha })));
  return {
    avisadas: ok ? nuevas.map((e) => ({ cliente: e.cliente, sucursal: e.sucursal, fecha: e.fecha })) : [],
    yaAvisadas: entregas.length - nuevas.length,
  };
}
