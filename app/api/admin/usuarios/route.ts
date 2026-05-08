// app/api/admin/usuarios/toggle/route.ts
// Activa o desactiva un usuario.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, getCurrentUser } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }
  const me = await getCurrentUser();
  const { email, activo } = await req.json();
  if (!email) return NextResponse.json({ error: 'falta_email' }, { status: 400 });
  if (me?.email === email) {
    return NextResponse.json({ error: 'no_te_podes_desactivar' }, { status: 400 });
  }
  await updateRow('Usuarios', 'email', email, { activo });
  return NextResponse.json({ ok: true });
}
