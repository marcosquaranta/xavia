import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readSheet, appendRowsObj, asegurarColumna, asegurarColumnas } from '@/lib/sheets';
import { CATEGORIAS_GASTO, type Gasto } from '@/lib/types';

// Cargar muchos gastos de una, con el mismo medio de pago: el caso es el resumen de la
// tarjeta, que son treinta consumos con la misma forma y distinta categoría.
//
// Una sola escritura para todas las filas. Hacer un POST por consumo son treinta llamadas a
// Sheets en pocos segundos y Google corta por cuota — ya pasó con otra pantalla.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { medio_pago, items } = await req.json();
    if (!medio_pago) return NextResponse.json({ error: 'falta_medio_pago' }, { status: 400 });
    if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: 'sin_items' }, { status: 400 });

    // La carga masiva no tiene dónde elegir el artículo de cada renglón, así que un insumo
    // no puede entrar por acá: entraría al gasto pero no al stock, y el consumo del mes
    // (había + compró − quedó) saldría mal sin que nada avise. Se rechaza la tanda entera
    // nombrando los renglones, para poder arreglarlos y volver a pegar.
    const insumosSinArticulo = items.filter((it: any) => it?.categoria === 'insumos');
    if (insumosSinArticulo.length) {
      return NextResponse.json({
        error: `Hay ${insumosSinArticulo.length} renglón(es) con categoría Insumos: ${insumosSinArticulo.map((i: any) => i?.descripcion || 's/d').slice(0, 5).join(', ')}. `
          + 'Los insumos se cargan desde Stocks → Cargar compra, que pide el artículo y la cantidad. '
          + 'Cambiáles la categoría acá o sacalos de la tanda.',
      }, { status: 400 });
    }

    await asegurarColumna('Gastos', 'medio_pago_destino');
    await asegurarColumnas('Gastos', ['empleado', 'estado_pago', 'proveedor', 'vencimiento', 'fecha_pago']);

    const previos = await readSheet<Gasto>('Gastos');
    let seq = previos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);

    const hoy = new Date().toISOString().split('T')[0];
    const filas: Record<string, any>[] = [];
    const rechazadas: string[] = [];

    for (const it of items) {
      const descripcion = String(it?.descripcion || '').trim();
      const fecha = String(it?.fecha || '').trim();
      const monto = Number(it?.monto);
      if (!descripcion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !isFinite(monto) || monto === 0) {
        rechazadas.push(descripcion || '(sin descripción)');
        continue;
      }
      seq += 1;
      filas.push({
        id_gasto: `GAS-${String(seq).padStart(4, '0')}`,
        fecha,
        descripcion,
        categoria: CATEGORIAS_GASTO.some((c) => c.value === it?.categoria) ? it.categoria : 'gastos_generales',
        monto,
        medio_pago,
        medio_pago_destino: '',
        empleado: '',
        estado_pago: '',
        proveedor: '',
        vencimiento: '',
        fecha_pago: '',
        usuario: user.email,
        fecha_carga: hoy,
        id_articulo: '',
        cantidad: '',
      });
    }

    if (!filas.length) return NextResponse.json({ error: 'nada_valido', rechazadas }, { status: 400 });
    await appendRowsObj('Gastos', filas);

    return NextResponse.json({
      ok: true,
      cargados: filas.length,
      total: filas.reduce((a, f) => a + Number(f.monto), 0),
      rechazadas,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
