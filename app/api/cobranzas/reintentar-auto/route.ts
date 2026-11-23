import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { evaluarBandeja } from '@/lib/autoCobro';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Volver a intentar el registro automático de UN aviso ─────────────────────────────
//
// El automático corre cuando llega el mail y una vez por día. Si en ese momento algo no
// estaba —la factura todavía no había entrado a la foto de Xubio, por ejemplo— el aviso
// quedó en la bandeja con el motivo anotado, y después ese motivo deja de ser cierto sin
// que nadie vuelva a mirarlo.
//
// Esto deja reintentarlo desde la bandeja, en el momento en que alguien se está haciendo
// la pregunta. No fuerza nada: pasa por las mismas verificaciones. Si sigue sin poder,
// devuelve el motivo nuevo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });

  try {
    const { id_item } = await req.json();
    const id = String(id_item || '').trim();
    if (!id) return NextResponse.json({ error: 'Falta el aviso.' }, { status: 400 });

    const r = await evaluarBandeja({ soloItem: id });
    const registrado = r.registrados.find((x: any) => String(x.idItem) === id);
    const rechazado = r.rechazados.find((x: any) => String(x.idItem) === id);
    const error = r.errores.find((x: any) => String(x.idItem) === id);

    if (registrado) return NextResponse.json({ ok: true, registrado: true });
    if (error) return NextResponse.json({ ok: false, motivo: (error as any).error || 'Falló al registrarlo.' });
    if (rechazado) return NextResponse.json({ ok: false, motivo: (rechazado as any).motivo });
    // Ni registrado ni rechazado: el automático no lo miró. Casi siempre porque ya no está
    // pendiente —alguien lo confirmó o lo descartó mientras tanto—.
    return NextResponse.json({ ok: false, motivo: !r.activo
      ? 'El registro automático está apagado en la configuración.'
      : 'El automático no lo evaluó: puede que ya no esté pendiente. Recargá la pantalla.' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
