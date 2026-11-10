import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow, asegurarColumna, asegurarColumnas, readSheet, updateRow, appendRowObj } from '@/lib/sheets';
import type { ClienteVenta } from '@/lib/types';

import { asegurarColumnasArticulos } from '@/lib/articulosSheets';
import { PROD_KEYS } from '@/lib/articulos';
// ── El CUIT es la identidad del cliente ──────────────────────────────────────────────
//
// Dos fichas del mismo cliente no dan error: las dos funcionan y las dos muestran deuda.
// Lo que rompen es todo lo que agrupa por cliente —la deuda aparece partida, el
// recordatorio sale dos veces o ninguna, el ranking miente—. Y el nombre no alcanza para
// detectarlo: "Forno Viena" y "Heroica Alto" son la misma empresa y no se parecen en nada.
//
// El CUIT sí: es el único dato que no depende de cómo se le haya ocurrido escribirlo a
// quien cargó la ficha. Por eso se valida al crear Y al editar, y en el servidor —la
// pantalla es una cortina, la API es la puerta.
const soloDigitos = (v: any) => String(v || '').replace(/\D/g, '');

function cuitRepetido(cuit: string, clientes: ClienteVenta[], exceptoId?: string): ClienteVenta | null {
  const k = soloDigitos(cuit);
  // Sin CUIT cargado no se valida nada: la mayoría de las fichas viejas no lo tienen, y
  // tratarlas como "todas repetidas entre sí" haría imposible editar ninguna.
  if (k.length < 11) return null;
  return clientes.find((c) =>
    soloDigitos((c as any).cuit) === k && String(c.id_control) !== String(exceptoId || ''),
  ) || null;
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control, ...fields } = await req.json();
    if (!id_control) return NextResponse.json({ error: 'id_control requerido' }, { status: 400 });
    // Campos nuevos — se agregan solo a la hoja si todavía no existen, para no romper el
    // guardado la primera vez que se usan.
    if ('cuit' in fields) {
      await asegurarColumna('Clientes', 'cuit');
      const todos = await readSheet<ClienteVenta>('Clientes');
      const otro = cuitRepetido(fields.cuit, todos, String(id_control));
      if (otro) {
        return NextResponse.json({
          error: `Ese CUIT ya es de "${otro.alias || otro.nombre_display || otro.nombre_xubio}". Un CUIT es un cliente: si son el mismo, usá esa ficha y dá de baja ésta.`,
        }, { status: 409 });
      }
    }
    if ('orden' in fields) await asegurarColumna('Clientes', 'orden');
    if ('facturar_por_sucursal' in fields) await asegurarColumna('Clientes', 'facturar_por_sucursal');
    // Datos de cobranza, editables desde la ficha del cliente además de desde Cobranzas: es
    // la misma columna de la misma hoja, así que no hay dos verdades posibles.
    const columnasCobranza = ['email', 'email_cobranza', 'recordatorio_cobro', 'retencion_ganancias_pct'].filter((k) => k in fields);
    if (columnasCobranza.length) await asegurarColumnas('Clientes', columnasCobranza);
    const updated = await updateRow('Clientes', 'id_control', String(id_control), fields);
    if (!updated) return NextResponse.json({ error: 'cliente_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { nombre_xubio, nombre_display, alias, tipo_factura, punto_venta, sucursales, precios, cuit } = body;

    if (!nombre_xubio || !tipo_factura || !punto_venta) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const clientes = await readSheet<ClienteVenta>('Clientes');
    // Se frena ACÁ, antes de crear: una ficha duplicada que ya existe hay que ir a
    // buscarla y borrarla, y para entonces puede tener ventas cargadas encima.
    const repetido = cuitRepetido(cuit, clientes);
    if (repetido) {
      return NextResponse.json({
        error: `Ya existe un cliente con ese CUIT: "${repetido.alias || repetido.nombre_display || repetido.nombre_xubio}". Si es el mismo, cargá la sucursal nueva en esa ficha en vez de crear otra.`,
      }, { status: 409 });
    }
    if (cuit) await asegurarColumna('Clientes', 'cuit');
    const maxId = clientes.reduce((acc, c) => Math.max(acc, Number(c.id_control) || 0), 0);
    const idControl = String(maxId + 1);

    // Por nombre de columna: con appendRow por posición, agregar `cuit` al final de la
    // hoja habría metido el CUIT en la columna que estuviera en ese lugar.
    await appendRowObj('Clientes', {
      id_control: idControl,
      nombre_xubio,
      nombre_display: nombre_display || nombre_xubio,
      alias: alias || '',
      tipo_factura,
      punto_venta,
      sucursales: sucursales || '',
      activo: 'SI',
      ...(cuit ? { cuit: soloDigitos(cuit) } : {}),
    });

    // Por nombre de columna y no por posición: con appendRow había que acertarle al orden
    // exacto del header, y cada artículo nuevo corría todo lo que venía después.
    if (precios) {
      await asegurarColumnasArticulos();
      await appendRowObj('Precios', {
        id_control: idControl,
        nombre_cliente: nombre_xubio,
        sucursal_obs: nombre_display || nombre_xubio,
        ...Object.fromEntries(PROD_KEYS.map((k: string) => [k, precios[k] || 0])),
      });
    }

    return NextResponse.json({ ok: true, id_control: idControl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

// ── Borrar un cliente ────────────────────────────────────────────────────────────────
//
// Existe para el caso que lo pidió: una ficha duplicada que hay que sacar de en medio. No
// para dar de baja a un cliente que dejó de comprar — para eso está `activo`, que conserva
// su historia.
//
// La diferencia importa porque borrar NO es reversible y, sobre todo, porque las ventas y
// los cobros apuntan al cliente por `id_control`. Borrar una ficha con movimientos deja
// esas filas apuntando a un cliente que no existe: la venta sigue en la planilla, sigue
// sumando al resultado, y no se puede saber de quién era. Por eso se frena y se dice
// cuántos movimientos tiene, que es lo que hay que resolver primero.
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control } = await req.json();
    const id = String(id_control || '').trim();
    if (!id) return NextResponse.json({ error: 'id_control requerido' }, { status: 400 });

    const { deleteRow } = await import('@/lib/sheets');
    const [clientes, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<{ id_control: any; exportado: any }>('Ventas').catch(() => []),
    ]);

    const cli = clientes.find((c) => String(c.id_control) === id);
    if (!cli) return NextResponse.json({ error: 'cliente_no_encontrado' }, { status: 404 });

    const suyas = ventas.filter((v) => String(v.id_control) === id);
    const facturadas = suyas.filter((v) => String(v.exportado || '').trim()).length;
    if (suyas.length) {
      return NextResponse.json({
        error: `No se puede borrar: tiene ${suyas.length} venta(s) cargadas`
          + (facturadas ? `, ${facturadas} de ellas ya facturadas` : '')
          + `. Borrar la ficha dejaría esas ventas apuntando a un cliente que no existe —seguirían sumando al resultado sin saber de quién son—. `
          + `Si es un duplicado, primero hay que pasar esas ventas al otro cliente; si ya no compra, dalo de baja en vez de borrarlo.`,
        ventas: suyas.length, facturadas,
      }, { status: 409 });
    }

    const borrado = await deleteRow('Clientes', 'id_control', id);
    if (!borrado) return NextResponse.json({ error: 'no_se_pudo_borrar' }, { status: 500 });
    // La fila de Precios queda huérfana si no se saca, y al crear un cliente nuevo el
    // id_control se reusa: heredaría los precios del cliente borrado.
    await deleteRow('Precios', 'id_control', id).catch(() => false);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
