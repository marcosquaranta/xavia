import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { guardarPrevision, borrarPrevision } from '@/lib/previsiones';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const body = await req.json();
    const { anio, mes, despidos, sac, alquiler, epe, notas } = body;
    const a = Number(anio), m = Number(mes);
    if (!a || !m || m < 1 || m > 12) return NextResponse.json({ error: 'mes_invalido' }, { status: 400 });

    // Deshace un guardado — pensado para sacar una fila de prueba, no para uso normal
    // desde la pantalla: el checklist del cierre lee "existe la fila" como "ya se guardó".
    if (body.accion === 'eliminar') {
      const ok = await borrarPrevision(a, m);
      return NextResponse.json({ ok, error: ok ? undefined : 'no_encontrada' }, { status: ok ? 200 : 404 });
    }

    const montos = { despidos: Number(despidos), sac: Number(sac), alquiler: Number(alquiler || 0), epe: Number(epe || 0) };
    if (Object.values(montos).some((v) => !isFinite(v) || v < 0)) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    await guardarPrevision({ anio: a, mes: m, ...montos, notas: String(notas || ''), usuario: user.email });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
