import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha, limpiarTodo } = await req.json();
    const ventas = await readSheet<VentaDia>('Ventas');
    const aLimpiar = limpiarTodo ? ventas : ventas.filter(v => v.fecha === fecha);
    for (const v of aLimpiar) {
      await updateRow('Ventas', 'id_venta', v.id_venta, {
        rucula: 0, lechuga_crespa: 0, hoja_roble: 0, bandeja_rucula: 0, albahaca: 0,
      });
    }
    return NextResponse.json({ ok: true, limpiados: aLimpiar.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
