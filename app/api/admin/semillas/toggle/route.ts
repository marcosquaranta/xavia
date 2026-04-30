// app/api/admin/semillas/toggle/route.ts
// Activa o desactiva una semilla.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }
  const { id_semilla, activo } = await req.json();
  if (!id_semilla || !activo) {
    return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
  }
  await updateRow('Semillas', 'id_semilla', id_semilla, { activo });
  return NextResponse.json({ ok: true });
}
