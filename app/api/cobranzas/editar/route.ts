import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { guardarEdicion } from '@/lib/cobranzasEdit';

// Corrige a mano una cobranza de Xubio, SOLO del lado de la app (ver lib/cobranzasEdit.ts).
// No toca Xubio: es a propósito y la pantalla lo dice.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { transaccionid, cliente, cuenta, nota } = await req.json();
    if (!String(transaccionid || '').trim()) {
      return NextResponse.json({ error: 'falta_transaccion' }, { status: 400 });
    }
    await guardarEdicion({
      transaccionid: String(transaccionid),
      cliente: String(cliente || ''),
      cuenta: String(cuenta || ''),
      nota: String(nota || ''),
      usuario: user.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
