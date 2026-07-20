import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
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

    const [articulos, stocks, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Gasto>('Gastos'),
    ]);
    const art = articulos.find((a) => a.id_articulo === id_articulo);
    if (!art) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });

    const cant = Number(cantidad);
    // El precio de este gasto queda como "último precio de compra" del artículo — se usa
    // para valorizar el stock final mientras no haya uno más nuevo.
    const gasto = gastos.find((g) => String(g.id_gasto) === String(id_gasto));
    const precioUnitario = gasto && cant > 0 ? (Number(gasto.monto) || 0) / cant : 0;
    const fechaCarga = new Date().toISOString().split('T')[0];
    const existente = stocks.find((s) =>
      s.id_articulo === id_articulo && String(s.anio) === String(anio) && String(s.mes) === String(mes)
    );

    if (existente) {
      const ini = Number(existente.stock_inicial) || 0;
      const fin = Number(existente.stock_final) || 0;
      const nuevaCompras = (Number(existente.compras) || 0) + cant;
      const updates: Record<string, any> = {
        compras: nuevaCompras, uso_calculado: ini + nuevaCompras - fin,
        usuario: user.email, fecha_carga: fechaCarga,
      };
      if (precioUnitario > 0) updates.precio_unitario = precioUnitario;
      await updateRow('Stocks', 'id_stock', existente.id_stock, updates);
    } else {
      const maxId = stocks
        .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
        .filter((n) => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
      const idNuevo = `STK-${String(maxId + 1).padStart(4, '0')}`;
      // Arrastrar el stock final del mes anterior como inicial de este — antes quedaba
      // siempre en 0, lo que hacía que el "stock actual" del artículo pareciera vacío
      // apenas se confirmaba una compra desde Gastos (ver alertasStockBajo en Panel/Stocks).
      let mesPrev = Number(mes) - 1, anioPrev = Number(anio);
      if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
      const stockAnterior = stocks.find((s) =>
        s.id_articulo === id_articulo && String(s.anio) === String(anioPrev) && String(s.mes) === String(mesPrev)
      );
      const iniHeredado = Number(stockAnterior?.stock_final) || 0;
      await appendRowObj('Stocks', {
        id_stock: idNuevo, id_articulo, categoria: art.categoria, articulo: art.articulo, unidad_medida: art.unidad_medida,
        anio, mes, stock_inicial: iniHeredado, compras: cant, stock_final: 0, uso_calculado: iniHeredado + cant,
        precio_unitario: precioUnitario || '', notas: '', usuario: user.email, fecha_carga: fechaCarga,
      });
    }

    await updateRow('Gastos', 'id_gasto', String(id_gasto), { aplicado_stock: 'SI' });
    return NextResponse.json({ ok: true, accion: 'confirmado' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
