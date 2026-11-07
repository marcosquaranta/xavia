import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';
import { PROD_KEYS } from '@/lib/articulos';
import { leerArticulosExtra } from '@/lib/articulosVenta';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
    // Plata = solo admin, igual que la pantalla. Cerrar la pantalla y dejar la API abierta
    // no cierra nada: la pantalla es una cortina, la API es la puerta.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver o cambiar esto.' }, { status: 403 });
  try {
    const { fecha, limpiarTodo, soloPendientes, id_exportacion, id_control, id_venta, soloPendientesDelDia } = await req.json();
    const ventas = await readSheet<VentaDia>('Ventas');
    const noExportado = (v: VentaDia) => !v.exportado || v.exportado === '';

    let aLimpiar: VentaDia[];
    if (limpiarTodo) {
      aLimpiar = ventas;
    } else if (id_venta) {
      // Una fila puntual por su id único — para borrar duplicados sueltos sin afectar
      // otras filas que compartan la misma (fecha, cliente, sucursal).
      aLimpiar = ventas.filter(v => v.id_venta === id_venta);
    } else if (id_exportacion) {
      // Una línea puntual ya facturada (por cliente, dentro de esa tanda) — para corregir
      // el registro interno cuando una venta se facturó mal, sin tocar el resto de la tanda.
      aLimpiar = ventas.filter(v => v.exportado === id_exportacion && (!id_control || String(v.id_control) === String(id_control)));
    } else if (soloPendientesDelDia && fecha && id_control) {
      // Lo NO facturado de un cliente en un día puntual. Existe porque la lista de
      // pendientes ahora es una fila por (fecha, cliente): borrar todo el día desde una de
      // esas filas tiraría también la venta pendiente de los demás clientes de esa fecha.
      aLimpiar = ventas.filter(v => v.fecha === fecha && String(v.id_control) === String(id_control) && noExportado(v));
    } else if (soloPendientes) {
      // Todo lo NO facturado, de cualquier fecha.
      aLimpiar = ventas.filter(noExportado);
    } else {
      // Un día puntual, solo lo NO facturado — nunca tocar una fila ya exportada, aunque
      // comparta la misma fecha calendario con ventas todavía pendientes.
      aLimpiar = ventas.filter(v => v.fecha === fecha && noExportado(v));
    }
    // ── También los artículos dados de alta en Admin ────────────────────────────────
    //
    // Esto ponía en cero solo PROD_KEYS, la lista de artículos del código. Un artículo
    // creado desde Admin —microgreens, cualquier alta nueva— conservaba su cantidad, así
    // que la fila seguía teniendo mercadería: el comprobante volvía a aparecer como
    // pendiente y parecía que el borrar no había hecho nada.
    //
    // Es el mismo agujero que tenían el historial y el desglose de ventas del EERR, por el
    // mismo motivo: una lista fija de artículos adentro de un cálculo que corre sobre
    // filas que pueden tener más columnas de las que esa lista conoce.
    const keysExtra = (await leerArticulosExtra().catch(() => []))
      .map((a) => a.key)
      .filter((k) => !PROD_KEYS.includes(k));
    const enCero = Object.fromEntries([...PROD_KEYS, ...keysExtra].map((k) => [k, 0]));

    for (const v of aLimpiar) {
      await updateRow('Ventas', 'id_venta', v.id_venta, {
        ...enCero,
        rucula_kg: 0, lechuga_kg: 0, lechuga_kg_crespa: 0, lechuga_kg_roble: 0,
      });
    }
    return NextResponse.json({ ok: true, limpiados: aLimpiar.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
