import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha, limpiarTodo, soloPendientes, id_exportacion, id_control, id_venta } = await req.json();
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
    } else if (soloPendientes) {
      // Todo lo NO facturado, de cualquier fecha.
      aLimpiar = ventas.filter(noExportado);
    } else {
      // Un día puntual, solo lo NO facturado — nunca tocar una fila ya exportada, aunque
      // comparta la misma fecha calendario con ventas todavía pendientes.
      aLimpiar = ventas.filter(v => v.fecha === fecha && noExportado(v));
    }
    for (const v of aLimpiar) {
      await updateRow('Ventas', 'id_venta', v.id_venta, {
        rucula: 0, lechuga_crespa: 0, hoja_roble: 0, bandeja_rucula: 0, albahaca: 0,
        rucula_kg: 0, lechuga_kg: 0, lechuga_kg_crespa: 0, lechuga_kg_roble: 0,
      });
    }
    return NextResponse.json({ ok: true, limpiados: aLimpiar.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
