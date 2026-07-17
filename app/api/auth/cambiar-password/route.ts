import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Usuario } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { passwordActual, passwordNueva } = await req.json();
    if (!passwordActual || !passwordNueva) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    if (String(passwordNueva).length < 6) return NextResponse.json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' }, { status: 400 });

    const usuarios = await readSheet<Usuario>('Usuarios');
    const cuenta = usuarios.find((u) => u.email.toLowerCase().trim() === user.email.toLowerCase().trim());
    if (!cuenta || !cuenta.password_hash) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const ok = await bcrypt.compare(passwordActual, cuenta.password_hash);
    if (!ok) return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 400 });

    const nuevoHash = await bcrypt.hash(passwordNueva, 10);
    await updateRow('Usuarios', 'email', cuenta.email, { password_hash: nuevoHash });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
