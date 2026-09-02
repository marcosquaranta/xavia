import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { descartarAlerta } from '@/lib/alertasDescartadas';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { clave, anio, mes } = await req.json();
    const a = Number(anio), m = Number(mes);
    if (!clave || !a || !m || m < 1 || m > 12) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    await descartarAlerta(String(clave), a, m, user.email);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
