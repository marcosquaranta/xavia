import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { enviarReclamoManual, type FacturaPendiente } from '@/lib/recordatoriosCobro';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Reclamo puntual: el admin elige cliente y facturas a mano y se manda. No pasa por la
// ventana de antigüedad, el saldo ni el registro de duplicados — esas defensas existen
// para el envío automático; acá hay alguien mirando la lista y eligiendo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede mandar un reclamo.' }, { status: 403 });
  try {
    const body = await req.json();
    const idControl = String(body.id_control || '').trim();
    if (!idControl) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });

    const facturas: FacturaPendiente[] = (Array.isArray(body.facturas) ? body.facturas : [])
      .map((f: any) => ({
        numero: String(f?.numero || '').trim(),
        fecha: String(f?.fecha || '').split(/[T ]/)[0],
        importe: Number(f?.importe) || 0,
      }))
      .filter((f: FacturaPendiente) => f.numero && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha));
    if (!facturas.length) return NextResponse.json({ error: 'Elegí al menos una factura.' }, { status: 400 });

    const r = await enviarReclamoManual({ idControl, facturas, usuario: user.email });
    if (!r.ok) return NextResponse.json({ error: r.error || 'No se pudo enviar' }, { status: 502 });
    return NextResponse.json({ ok: true, enviadoA: r.enviadoA, total: r.total, cantidad: facturas.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
