import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Saca una factura de la cola de facturación: las ventas del cliente vuelven a borrador
// (exportado = ''), así no se emiten. Body: { id_control }
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control } = await req.json();
    if (!id_control) return NextResponse.json({ error: 'id_control requerido' }, { status: 400 });

    const ventas = await readSheet<VentaDia>('Ventas');
    const aQuitar = ventas.filter(v => v.exportado === 'PENDIENTE' && String(v.id_control) === String(id_control));
    if (!aQuitar.length) return NextResponse.json({ error: 'No hay ventas pendientes de ese cliente' }, { status: 400 });

    await batchUpdateRows('Ventas', 'id_venta', aQuitar.map(v => ({
      keyValue: v.id_venta,
      updates: { exportado: '' },
    })));
    return NextResponse.json({ ok: true, lineas: aQuitar.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
