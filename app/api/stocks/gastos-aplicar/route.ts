import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import type { Articulo, Gasto, StockMes } from '@/lib/types';

// Confirma (o descarta) una sugerencia de compra detectada en Gastos: si se confirma,
// SUMA la cantidad indicada al campo `compras` del artículo para ese mes (a diferencia
// de la carga masiva, acá cada gasto es un evento de compra puntual que se acumula, no
// reemplaza). En ambos casos marca el gasto como aplicado para que no vuelva a sugerirse.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { id_gasto, id_articulo, anio, mes, cantidad, descartar } = body;
    if (!id_gasto) return NextResponse.json({ error: 'falta_id_gasto' }, { status: 400 });

    if (descartar) {
      const ok = await updateRow('Gastos', 'id_gasto', String(id_gasto), { aplicado_stock: 'SI' });
      if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
      return NextResponse.json({ ok: true, accion: 'descartado' });
    }

    if (!id_articulo || !anio || !mes || !(Number(cantidad) >= 0)) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const [articulos, stocks] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
    ]);
    const art = articulos.find((a) => a.id_articulo === id_articulo);
    if (!art) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });

    const cant = Number(cantidad);
    const fechaCarga = new Date().toISOString().split('T')[0];
    const existente = stocks.find((s) =>
      s.id_articulo === id_articulo && String(s.anio) === String(anio) && String(s.mes) === String(mes)
    );

    if (existente) {
      const ini = Number(existente.stock_inicial) || 0;
      const fin = Number(existente.stock_final) || 0;
      const nuevaCompras = (Number(existente.compras) || 0) + cant;
      await updateRow('Stocks', 'id_stock', existente.id_stock, {
        compras: nuevaCompras, uso_calculado: ini + nuevaCompras - fin,
        usuario: user.email, fecha_carga: fechaCarga,
      });
    } else {
      const maxId = stocks
        .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
        .filter((n) => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
      const idNuevo = `STK-${String(maxId + 1).padStart(4, '0')}`;
      await appendRow('Stocks', [
        idNuevo, id_articulo, art.categoria, art.articulo, art.unidad_medida,
        anio, mes, 0, cant, 0, cant, '', user.email, fechaCarga,
      ]);
    }

    await updateRow('Gastos', 'id_gasto', String(id_gasto), { aplicado_stock: 'SI' });
    return NextResponse.json({ ok: true, accion: 'confirmado' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
