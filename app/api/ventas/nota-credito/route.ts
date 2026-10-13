import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { emitirNCDeFactura } from '@/lib/notaCredito';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Emite una nota de crédito en Xubio sobre una factura ya emitida, y corrige las cantidades
// de la venta. Solo admin: es un comprobante fiscal, no una corrección interna.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede emitir notas de crédito.' }, { status: 403 });
  }
  try {
    const { numeroFactura, lineas } = await req.json();
    const r = await emitirNCDeFactura({
      numeroFactura: String(numeroFactura || ''),
      lineas: Array.isArray(lineas) ? lineas : [],
      usuario: user.email,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, numeroNC: r.numeroNC, cae: r.cae, importe: r.importe });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
