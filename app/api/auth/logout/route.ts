// app/api/auth/logout/route.ts
// Endpoint de logout. Borra la sesión y redirige al login.

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await getSession();
  session.destroy();
  // Redirect a /login usando la URL del request actual (funciona en localhost y prod)
  const url = new URL('/login', req.url);
  return NextResponse.redirect(url, { status: 303 });
}
