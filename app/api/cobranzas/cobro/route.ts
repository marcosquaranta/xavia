import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarHoja, readSheet, updateRow } from '@/lib/sheets';
import { crearCobranza, borrarCobranza, getClientesXubio, matchClienteXubio } from '@/lib/xubio';
import { HOJA_COBROS, HEADERS_COBROS, type CobroRegistrado } from '@/lib/cobros';
import type { ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Registra un cobro en Xubio (POST cobranzaBean) y lo deja anotado acá con el
// transaccionid que devolvió, que es lo que permite deshacerlo después. El orden importa:
// primero Xubio, después el registro local. Si Xubio falla no queda una fila mintiendo que
// se registró; si falla el registro local, el cobro igual está en Xubio y se ve en el
// listado de Xubio (peor sería al revés).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede registrar cobros.' }, { status: 403 });
  try {
    const body = await req.json();
    const idControl = String(body.id_control || '').trim();
    const fecha = String(body.fecha || '').trim();
    const importe = Number(body.importe);
    const cuentaId = Number(body.cuentaId);
    const observacion = String(body.observacion || '').trim();

    if (!idControl) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: 'La fecha tiene que ser válida.' }, { status: 400 });
    if (!(importe > 0)) return NextResponse.json({ error: 'El importe tiene que ser mayor a 0.' }, { status: 400 });
    if (!(cuentaId > 0)) return NextResponse.json({ error: 'Elegí en qué cuenta entró la plata.' }, { status: 400 });

    const clientes = await readSheet<ClienteVenta>('Clientes');
    const cli = clientes.find((c) => String(c.id_control) === idControl);
    if (!cli) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 });

    const clientesXubio = await getClientesXubio();
    const clienteId = matchClienteXubio(cli.nombre_xubio || cli.nombre_display, clientesXubio);
    if (!clienteId) return NextResponse.json({ error: `No se pudo encontrar "${cli.nombre_xubio}" en Xubio.` }, { status: 400 });

    const r = await crearCobranza({ clienteId, fecha, importe, cuentaId, observacion });
    if (!r.ok) return NextResponse.json({ error: `Xubio rechazó el cobro: ${r.error}` }, { status: 502 });

    await asegurarHoja(HOJA_COBROS, HEADERS_COBROS);
    const previos = await readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []);
    const seq = previos.reduce((a, c) => Math.max(a, parseInt(String(c.id_cobro).replace(/\D/g, ''), 10) || 0), 0) + 1;
    const idCobro = `CO-${String(seq).padStart(5, '0')}`;
    await appendRowObj(HOJA_COBROS, {
      id_cobro: idCobro,
      fecha_registro: new Date().toISOString(),
      id_control: idControl,
      cliente: cli.nombre_display || cli.nombre_xubio,
      fecha: fecha,
      importe: Math.round(importe),
      cuenta_id: cuentaId,
      transaccionid: r.transaccionid || '',
      numero_recibo: r.numeroRecibo || '',
      observacion,
      estado: 'registrado',
      usuario: user.email,
    });
    return NextResponse.json({ ok: true, id_cobro: idCobro, transaccionid: r.transaccionid, numeroRecibo: r.numeroRecibo });
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
