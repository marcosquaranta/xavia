import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { emitirPendientes } from '@/lib/facturacionEmitir';

export const dynamic = 'force-dynamic';

// Emite a Xubio las ventas acumuladas (PENDIENTE), una factura por cliente.
// Body opcional { idControls: string[] } para facturar solo esos clientes, o
// { pares: [{ id_control, fecha }] } para facturar día por día — una factura por fecha.
// Sirve como reintento manual para lo que no se haya podido emitir automáticamente
// al cargar ventas (ej. cliente no encontrado en Xubio).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    let idControls: string[] | null = null;
    let pares: { id_control: string; fecha: string }[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.idControls)) idControls = body.idControls.map(String);
      if (Array.isArray(body?.pares)) {
        pares = body.pares
          .map((p: any) => ({ id_control: String(p?.id_control || ''), fecha: String(p?.fecha || '') }))
          .filter((p: any) => p.id_control && p.fecha);
      }
    } catch {}

    const { emitidas, errores } = await emitirPendientes(idControls, { pares });
    if (!emitidas.length && !errores.length) {
      return NextResponse.json({ error: 'No hay ventas seleccionadas para facturar' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, emitidas, errores });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
