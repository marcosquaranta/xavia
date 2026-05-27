import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow, readSheet } from '@/lib/sheets';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { email, nombre, password, rol } = await req.json();
    if (!email || !nombre || !password || !rol) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    // Verificar que no exista
    const usuarios = await readSheet<any>('Usuarios');
    if (usuarios.some((u: any) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'El email ya está registrado' }, { status: 400 });
    }
    const hash = await bcrypt.hash(password, 10);
    const fecha = new Date().toISOString().split('T')[0];
    await appendRow('Usuarios', [email, hash, rol, nombre, 'SI', fecha]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
