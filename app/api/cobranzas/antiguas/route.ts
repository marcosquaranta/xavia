import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { facturasAntiguas } from '@/lib/saldarAntiguas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Qué incluiría "marcar todas las de más de N días" ────────────────────────────────
//
// Solo lectura: devuelve la vista previa. Existe separado de la marcación porque una acción
// masiva sobre la deuda del año no se dispara a ciegas — primero se ve cuántas son, de qué
// clientes y por cuánta plata, y recién después se confirma.
//
// El detalle de cada factura va incluido para poder mostrarlo al abrir un cliente, pero NO
// es lo que se escribe: el POST que marca vuelve a calcular del lado del servidor, así que
// una lista modificada en el navegador no puede dar por saldada una factura que no entra.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const dias = Math.min(365, Math.max(0, Number(new URL(req.url).searchParams.get('dias')) || 60));
  try {
    return NextResponse.json(await facturasAntiguas(dias));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo calcular.' }, { status: 500 });
  }
}
