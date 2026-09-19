import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import { borrarCobranza } from '@/lib/xubio';
import { HOJA_COBROS, registrarCobro, type CobroRegistrado } from '@/lib/cobros';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Carga manual de un cobro. La lógica está en lib/cobros.ts porque la bandeja de cobranzas
// registra por el mismo camino.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede registrar cobros.' }, { status: 403 });
  try {
    const body = await req.json();
    const r = await registrarCobro({
      idControl: String(body.id_control || ''),
      fecha: String(body.fecha || ''),
      importe: Number(body.importe),
      cuentaId: Number(body.cuentaId),
      observacion: String(body.observacion || ''),
      comprobantes: Array.isArray(body.comprobantes) ? body.comprobantes : [],
      usuario: user.email,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 500 });
    return NextResponse.json({ ok: true, id_cobro: r.idCobro, transaccionid: r.transaccionid, numeroRecibo: r.numeroRecibo, circuito: r.circuito });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

// Deshace un cobro cargado por error: lo borra en Xubio y marca la fila como anulada (no
// se borra la fila, para que quede el rastro de que existió y se dio de baja).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede anular cobros.' }, { status: 403 });
  try {
    const { id_cobro } = await req.json();
    if (!id_cobro) return NextResponse.json({ error: 'Falta el cobro.' }, { status: 400 });

    const previos = await readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []);
    const cobro = previos.find((c) => String(c.id_cobro) === String(id_cobro));
    if (!cobro) return NextResponse.json({ error: 'No se encontró el cobro.' }, { status: 404 });
    if (String(cobro.estado) === 'anulado') return NextResponse.json({ error: 'Ese cobro ya está anulado.' }, { status: 400 });

    const tid = Number(cobro.transaccionid);
    if (tid > 0) {
      const r = await borrarCobranza(tid);
      if (!r.ok) return NextResponse.json({ error: `Xubio no pudo borrarlo: ${r.error}` }, { status: 502 });
    }
    await updateRow(HOJA_COBROS, 'id_cobro', String(id_cobro), { estado: 'anulado' });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
