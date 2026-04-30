// app/api/auth/login/route.ts
// Endpoint de login. Recibe email + password, valida contra el Sheet,
// y si es correcto crea la sesión con cookie firmada.

import { NextRequest, NextResponse } from 'next/server';
import { authenticate, getSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    const user = await authenticate(email, password);
    if (!user) {
      return NextResponse.json({ error: 'invalid' }, { status: 401 });
    }

    const session = await getSession();
    session.email = user.email;
    session.rol = user.rol;
    session.nombre = user.nombre;
    session.loggedIn = true;
    await session.save();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error en login:', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
