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
    const body = await req.json();
    const { transaccionid, cliente, cuenta, importe, oculta, nota, comprobantes } = body;
    if (!String(transaccionid || '').trim()) {
      return NextResponse.json({ error: 'falta_transaccion' }, { status: 400 });
    }
    // Solo se manda lo que vino en el pedido: un campo ausente deja el valor que ya estaba
    // (ver guardarEdicion). Sin esto, "sacar de la lista" —que manda solo `oculta`— borraba
    // la imputación y el cliente corregido.
    await guardarEdicion({
      transaccionid: String(transaccionid),
      ...(cliente !== undefined ? { cliente: String(cliente || '') } : {}),
      ...(cuenta !== undefined ? { cuenta: String(cuenta || '') } : {}),
      ...(importe !== undefined ? { importe: importe ?? '' } : {}),
      ...(oculta !== undefined ? { oculta: oculta === true } : {}),
      ...(nota !== undefined ? { nota: String(nota || '') } : {}),
      ...(Array.isArray(comprobantes) ? { comprobantes: comprobantes.map((x: any) => String(x)) } : {}),
      usuario: user.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
