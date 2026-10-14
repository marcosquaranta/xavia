import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { deleteRow, readSheet } from '@/lib/sheets';
import type { Gasto } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto, grupo } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });

    // Borrar la compra en cuotas completa. Una compra de 12 cuotas cargada por error son 12
    // filas: sin esto hay que borrarlas de a una, y basta olvidarse de la última para que
    // quede un gasto suelto en un mes futuro que nadie va a entender.
    if (grupo) {
      const gastos = await readSheet<Gasto>('Gastos').catch(() => [] as Gasto[]);
      const yo = gastos.find((g) => String(g.id_gasto) === String(id_gasto));
      const idGrupo = String(yo?.cuota_grupo || '').trim();
      if (!idGrupo) return NextResponse.json({ error: 'Este gasto no es parte de una compra en cuotas.' }, { status: 400 });
      // De la última a la primera: borrar por fila corre las de abajo, y hacerlo al revés
      // dejaría los índices siguientes apuntando a otra fila.
      const delGrupo = gastos
        .filter((g) => String(g.cuota_grupo || '').trim() === idGrupo)
        .sort((a, b) => Number(b.cuota_nro || 0) - Number(a.cuota_nro || 0));
      let borradas = 0;
      for (const g of delGrupo) {
        if (await deleteRow('Gastos', 'id_gasto', String(g.id_gasto))) borradas++;
      }
      if (borradas === 0) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
      return NextResponse.json({ ok: true, borradas, de: delGrupo.length });
    }

    const ok = await deleteRow('Gastos', 'id_gasto', id_gasto);
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
