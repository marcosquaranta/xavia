import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { guardarPrevision } from '@/lib/previsiones';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { anio, mes, despidos, sac, notas } = await req.json();
    const a = Number(anio), m = Number(mes);
    if (!a || !m || m < 1 || m > 12) return NextResponse.json({ error: 'mes_invalido' }, { status: 400 });

    const d = Number(despidos), s = Number(sac);
    if (!isFinite(d) || !isFinite(s) || d < 0 || s < 0) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    await guardarPrevision({ anio: a, mes: m, despidos: d, sac: s, notas: String(notas || ''), usuario: user.email });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
