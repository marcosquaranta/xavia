import { LABELS_LARGOS } from './articulos';
// ── Aviso: entregas que se cobran en el momento ──────────────────────────────────────
//
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
    </div>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px">Hay que avisarle al repartidor que cobre</h2>
      <p style="margin:0 0 12px;color:#555">Se acaba de cargar una venta para una sucursal que paga contra entrega.</p>
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
        subject: `Cobrar en la entrega — ${entregas.map(e => e.sucursal).join(', ')} — ${entregas.map(e => fmtDia(e.fecha)).filter((x, i, arr) => arr.indexOf(x) === i).join(' y ')}`,
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
