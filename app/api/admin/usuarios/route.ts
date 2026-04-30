// app/api/admin/usuarios/route.ts
// Crear nuevo usuario (admin only).

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, hashPassword } from '@/lib/auth';
import { appendRow, readSheet } from '@/lib/sheets';
import type { Usuario } from '@/lib/types';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { email, nombre, rol, password, fecha_alta } = body;

    if (!email || !nombre || !rol || !password) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'contraseña_muy_corta' },
        { status: 400 }
      );
    }

    // Verificar que no exista ya
    const usuarios = await readSheet<Usuario>('Usuarios');
    if (usuarios.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json(
        { error: 'email_ya_existe' },
        { status: 400 }
      );
    }

    const hash = await hashPassword(password);

    // Orden Usuarios: email, password_hash, rol, nombre, activo, fecha_alta
    await appendRow('Usuarios', [
      email,
      hash,
      rol,
      nombre,
      'SI',
      fecha_alta || new Date().toISOString().split('T')[0],
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error creando usuario:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
