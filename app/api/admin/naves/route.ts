// app/api/admin/naves/route.ts
// Actualiza configuración de ubicaciones (módulos, perfiles, orificios).

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const { ubicaciones } = await req.json();
    if (!Array.isArray(ubicaciones)) {
      return NextResponse.json({ error: 'datos_invalidos' }, { status: 400 });
    }

    for (const u of ubicaciones) {
      await updateRow('Ubicaciones', 'id_ubicacion', u.id_ubicacion, {
        modulos: u.modulos,
        perfiles_por_modulo: u.perfiles_por_modulo,
        orificios_por_perfil: u.orificios_por_perfil,
        capacidad_calculada: Math.round(u.capacidad_calculada),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error guardando naves:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
