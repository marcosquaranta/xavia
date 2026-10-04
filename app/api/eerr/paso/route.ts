import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { marcarPaso } from '@/lib/cierreManual';

// Marcar o desmarcar un paso del cierre que la app no puede verificar sola.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { anio, mes, paso, hecho } = await req.json();
    if (!anio || !mes || !String(paso || '').trim()) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    await marcarPaso({
      anio: Number(anio), mes: Number(mes), paso: String(paso).trim(),
      hecho: !!hecho, usuario: user.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
