import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { enviarInformeCierre } from '@/lib/informeCierre';

// Manda el informe del cierre de un mes por mail. Lo dispara Marcos desde la pantalla del
// cierre cuando terminó de cargar todo — no hay cron: ver el comentario de lib/informeCierre.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { anio, mes } = await req.json();
    const a = Number(anio), m = Number(mes);
    if (!a || !m || m < 1 || m > 12) return NextResponse.json({ error: 'mes_invalido' }, { status: 400 });

    const r = await enviarInformeCierre(a, m);
    if (!r.ok) return NextResponse.json({ error: r.error || 'no_se_pudo_enviar' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
