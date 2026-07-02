import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readSheet, appendRowObj } from '@/lib/sheets';
import type { Gasto } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { fecha, descripcion, categoria, monto, medio_pago } = await req.json();
    if (!fecha || !descripcion || !medio_pago || monto === undefined) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    const montoNum = Number(monto);
    if (!isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    const gastos = await readSheet<Gasto>('Gastos');
    const maxId = gastos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    const id_gasto = `GAS-${String(maxId + 1).padStart(4, '0')}`;

    await appendRowObj('Gastos', {
      id_gasto, fecha,
      descripcion: String(descripcion).trim(),
      categoria: categoria === 'insumos' ? 'insumos' : 'gastos_generales',
      monto: montoNum,
      medio_pago,
      usuario: user.email,
      fecha_carga: new Date().toISOString().split('T')[0],
    });

    return NextResponse.json({ ok: true, id_gasto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
