import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Los productos que puede tener una venta. La lista está acá explícita —y no se acepta
// cualquier nombre de columna— para que este endpoint no sirva para escribir en cualquier
// campo de la hoja Ventas.
const PROD_KEYS = [
  'rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca',
  'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble',
];

// Corrige un renglón de una venta PENDIENTE: cambia la cantidad de un producto, o la borra
// mandando 0. Solo toca ventas pendientes de facturar — una vez emitida la factura, esto ya
// no puede cambiar nada (habría que hacer una nota de crédito en Xubio).
//
// Body: { id_venta, campo, cantidad }
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_venta, campo, cantidad } = await req.json();
    if (!id_venta || !campo) return NextResponse.json({ error: 'id_venta y campo son obligatorios' }, { status: 400 });
    if (!PROD_KEYS.includes(String(campo))) return NextResponse.json({ error: `Producto desconocido: ${campo}` }, { status: 400 });

    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant < 0) return NextResponse.json({ error: 'La cantidad tiene que ser un número de 0 o más' }, { status: 400 });

    const ventas = await readSheet<VentaDia>('Ventas');
    const venta = ventas.find(v => String(v.id_venta) === String(id_venta));
    if (!venta) return NextResponse.json({ error: 'No se encontró esa venta' }, { status: 404 });
    if (venta.exportado !== 'PENDIENTE') {
      return NextResponse.json({ error: 'Esa venta ya no está pendiente: si la factura salió, la corrección va por nota de crédito en Xubio.' }, { status: 400 });
    }

    // Si al cambiar esto la venta se queda sin ningún producto, no tiene sentido dejarla en
    // la cola: vuelve a borrador, igual que cuando se la saca a mano desde la pantalla.
    const quedaVacia = PROD_KEYS.every(k => {
      const valor = k === String(campo) ? cant : Number((venta as any)[k]) || 0;
      return valor <= 0;
    });

    const updates: Record<string, any> = { [String(campo)]: cant > 0 ? cant : '' };
    if (quedaVacia) updates.exportado = '';

    const ok = await updateRow('Ventas', 'id_venta', String(id_venta), updates);
    if (!ok) return NextResponse.json({ error: 'No se pudo actualizar la fila' }, { status: 500 });

    return NextResponse.json({ ok: true, vaciaYQuitada: quedaVacia });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
