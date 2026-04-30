// app/api/admin/semillas/route.ts
// Crear nueva semilla.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      variedad,
      proveedor,
      batch,
      fecha_recepcion,
      cantidad_recibida,
      precio_total,
      notas,
    } = body;

    if (!variedad || !proveedor || !batch || !fecha_recepcion) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const idSemilla = `SEM-${batch}`;

    // Orden columnas Semillas:
    // id_semilla, batch, variedad, proveedor, fecha_recepcion, cantidad_recibida,
    // unidad, precio_total, stock_estimado, activo, notas
    await appendRow('Semillas', [
      idSemilla,
      batch,
      variedad,
      proveedor,
      fecha_recepcion,
      cantidad_recibida || 0,
      'semillas',
      precio_total || 0,
      'normal',
      'SI',
      notas || '',
    ]);

    return NextResponse.json({ ok: true, id_semilla: idSemilla });
  } catch (err: any) {
    console.error('Error creando semilla:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
