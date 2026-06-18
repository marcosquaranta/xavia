import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, batchUpdateRows, readSheet } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha, lineas, id_exportacion } = await req.json();
    const ventas = await readSheet<VentaDia>('Ventas');
    const fechaCarga = new Date().toISOString().split('T')[0];

    let nextId = ventas
      .map(v => parseInt(v.id_venta?.replace('V-', '') || '0'))
      .filter(n => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0) + 1;

    const toUpdate: Array<{ keyValue: string; updates: Record<string, any> }> = [];

    for (const l of lineas) {
      // Si hay id_exportacion: re-editando una exportación existente → buscar esa fila
      // Si no: sesión nueva → solo buscar filas no exportadas
      const existente = ventas.find(v =>
        v.fecha === fecha &&
        String(v.id_control) === String(l.id_control) &&
        v.sucursal === l.sucursal &&
        (id_exportacion ? v.exportado === id_exportacion : (!v.exportado || v.exportado === ''))
      );
      if (existente) {
        toUpdate.push({
          keyValue: existente.id_venta,
          updates: {
            rucula: l.rucula || 0, lechuga_crespa: l.lechuga_crespa || 0,
            hoja_roble: l.hoja_roble || 0, bandeja_rucula: l.bandeja_rucula || 0,
            albahaca: l.albahaca || 0,
            rucula_kg: l.rucula_kg || 0, lechuga_kg: l.lechuga_kg || 0,
            usuario: user.email, fecha_carga: fechaCarga,
          },
        });
      } else {
        await appendRow('Ventas', [
          `V-${String(nextId++).padStart(5, '0')}`, fecha,
          l.id_control, l.nombre_cliente, l.sucursal,
          l.rucula || 0, l.lechuga_crespa || 0, l.hoja_roble || 0,
          l.bandeja_rucula || 0, l.albahaca || 0,
          l.rucula_kg || 0, l.lechuga_kg || 0,
          '', user.email, fechaCarga,
        ]);
      }
    }

    if (toUpdate.length) {
      await batchUpdateRows('Ventas', 'id_venta', toUpdate);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
