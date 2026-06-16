import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha, lineas } = await req.json();
    const ventas = await readSheet<VentaDia>('Ventas');
    const fechaCarga = new Date().toISOString().split('T')[0];

    for (const l of lineas) {
      const existente = ventas.find(v =>
        v.fecha === fecha && String(v.id_control) === String(l.id_control) && v.sucursal === l.sucursal
      );
      if (existente) {
        await updateRow('Ventas', 'id_venta', existente.id_venta, {
          rucula: l.rucula || 0, lechuga_crespa: l.lechuga_crespa || 0,
          hoja_roble: l.hoja_roble || 0, bandeja_rucula: l.bandeja_rucula || 0,
          albahaca: l.albahaca || 0,
          rucula_kg: l.rucula_kg || 0, lechuga_kg: l.lechuga_kg || 0,
          usuario: user.email, fecha_carga: fechaCarga,
        });
      } else {
        const maxId = ventas.map(v => parseInt(v.id_venta?.replace('V-','') || '0')).filter(n => !isNaN(n)).reduce((m,n) => Math.max(m,n), 0);
        await appendRow('Ventas', [
          `V-${String(maxId+1).padStart(5,'0')}`, fecha,
          l.id_control, l.nombre_cliente, l.sucursal,
          l.rucula || 0, l.lechuga_crespa || 0, l.hoja_roble || 0,
          l.bandeja_rucula || 0, l.albahaca || 0,
          l.rucula_kg || 0, l.lechuga_kg || 0,
          '', user.email, fechaCarga,
        ]);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
