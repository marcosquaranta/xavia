import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readSheet, appendRowObj, asegurarColumna } from '@/lib/sheets';
import { CATEGORIAS_GASTO, admiteMontoNegativo, type Gasto } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { fecha, descripcion, categoria, monto, medio_pago, medio_pago_destino, id_articulo, cantidad } = await req.json();
    if (!fecha || !descripcion || !medio_pago || monto === undefined) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    // Un movimiento entre cuentas sin destino deja la plata saliendo de un lado y no
    // entrando a ninguno: los saldos no cerrarían nunca.
    if (categoria === 'movimiento_interno') {
      if (!medio_pago_destino) return NextResponse.json({ error: 'falta_destino' }, { status: 400 });
      if (medio_pago_destino === medio_pago) return NextResponse.json({ error: 'destino_igual_origen' }, { status: 400 });
    }
    const montoNum = Number(monto);
    const negativoOk = admiteMontoNegativo(categoria);
    if (!isFinite(montoNum) || montoNum === 0 || (montoNum < 0 && !negativoOk)) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }
    const cantidadNum = Number(cantidad) || 0;

    await asegurarColumna('Gastos', 'medio_pago_destino');
    const gastos = await readSheet<Gasto>('Gastos');
    const maxId = gastos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    const id_gasto = `GAS-${String(maxId + 1).padStart(4, '0')}`;

    await appendRowObj('Gastos', {
      id_gasto, fecha,
      descripcion: String(descripcion).trim(),
      categoria: CATEGORIAS_GASTO.some((c) => c.value === categoria) ? categoria : 'gastos_generales',
      monto: montoNum,
      medio_pago,
      medio_pago_destino: categoria === 'movimiento_interno' ? medio_pago_destino : '',
      usuario: user.email,
      fecha_carga: new Date().toISOString().split('T')[0],
      id_articulo: id_articulo || '',
      cantidad: cantidadNum > 0 ? cantidadNum : '',
    });

    return NextResponse.json({ ok: true, id_gasto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
