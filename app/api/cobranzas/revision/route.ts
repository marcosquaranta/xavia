import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { registrarRevision } from '@/lib/revisionCliente';

// Dejar asentado que se controló la cuenta de un cliente. No toca Xubio ni cambia qué se
// reclama: es memoria de control. Lo que se guarda incluye cuántas facturas abiertas había
// y por cuánto, para poder decir después qué cambió desde entonces.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const body = await req.json();
    const id_control = String(body?.id_control || '').trim();
    if (!id_control) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });

    const fila = await registrarRevision({
      id_control,
      cliente: String(body?.cliente || ''),
      usuario: user.email,
      facturasAbiertas: Number(body?.facturasAbiertas) || 0,
      montoAbierto: Number(body?.montoAbierto) || 0,
      notas: String(body?.notas || ''),
    });
    return NextResponse.json({ ok: true, revision: fila, mensaje: `Revisión registrada: ${fila.fecha}.` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo registrar.' }, { status: 500 });
  }
}
