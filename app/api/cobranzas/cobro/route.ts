import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import { borrarCobranza } from '@/lib/xubio';
import { HOJA_COBROS, registrarCobro, registrarCobroEnPartes, type CobroRegistrado, type ParteCobro } from '@/lib/cobros';

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

    // Cobro en varias fechas (un cheque a 30 días, media entrega ahora y media después).
    // La suma la valida el servidor y no el formulario: si las partes no dan el total, la
    // factura queda cancelada por un monto que nadie transfirió nunca.
    const partes: ParteCobro[] = Array.isArray(body.partes) ? body.partes : [];
    if (partes.length > 1) {
      const total = Math.round(Number(body.importe) * 100) / 100;
      const suma = Math.round(partes.reduce((a, x) => a + (Number(x?.importe) || 0), 0) * 100) / 100;
      if (Math.abs(suma - total) > 0.01) {
        return NextResponse.json({ error: `Las partes suman $${suma.toLocaleString('es-AR')} y el cobro es de $${total.toLocaleString('es-AR')}. Tienen que dar lo mismo.` }, { status: 400 });
      }
      const rp = await registrarCobroEnPartes({
        idControl: String(body.id_control || ''),
        cuentaId: Number(body.cuentaId),
        observacion: String(body.observacion || ''),
        comprobantes: Array.isArray(body.comprobantes) ? body.comprobantes : [],
        retencion: Number(body.retencion) || 0,
        usuario: user.email,
      }, partes);
      if (!rp.ok) return NextResponse.json({ error: rp.error, partesHechas: rp.partes.filter((x) => x.ok).length }, { status: rp.status || 500 });
      return NextResponse.json({
        ok: true, partes: rp.partes.length,
        id_cobro: rp.partes[0].idCobro,
        numeroRecibo: rp.partes.map((x) => x.numeroRecibo).filter(Boolean).join(', '),
      });
    }

    const r = await registrarCobro({
      idControl: String(body.id_control || ''),
      fecha: String(body.fecha || ''),
      importe: Number(body.importe),
      cuentaId: Number(body.cuentaId),
      observacion: String(body.observacion || ''),
      comprobantes: Array.isArray(body.comprobantes) ? body.comprobantes : [],
      retencion: Number(body.retencion) || 0,
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
