import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarColumna, readSheet, updateRow } from '@/lib/sheets';
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

    // Un gasto puede traer VARIOS insumos: una factura de Cayi con bolsas de rúcula y de
    // lechuga es un solo gasto y dos artículos. Se acepta `items` y, si no viene, el par
    // suelto de siempre — así sigue andando cualquier llamada vieja.
    const items: { id_articulo: string; cantidad: number; monto?: number }[] = Array.isArray(body.items) && body.items.length
      ? body.items.map((i: any) => ({
          id_articulo: String(i?.id_articulo || ''),
          cantidad: Number(i?.cantidad),
          monto: Number(i?.monto) > 0 ? Number(i.monto) : undefined,
        }))
      : [{ id_articulo: String(id_articulo || ''), cantidad: Number(cantidad), monto: undefined }];

    await asegurarColumna('Gastos', 'aplicado_stock');

    if (descartar) {
      const ok = await updateRow('Gastos', 'id_gasto', String(id_gasto), { aplicado_stock: 'SI' });
      if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
      return NextResponse.json({ ok: true, accion: 'descartado' });
    }

    if (!anio || !mes || !items.length || items.some((i) => !i.id_articulo || !(i.cantidad >= 0))) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (new Set(items.map((i) => i.id_articulo)).size !== items.length) {
      return NextResponse.json({ error: 'articulo_repetido' }, { status: 400 });
    }

    const [articulos, stocks, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Gasto>('Gastos'),
    ]);
    const gasto = gastos.find((g) => String(g.id_gasto) === String(id_gasto));
    const fechaCarga = new Date().toISOString().split('T')[0];
    // Las filas de Stocks se van actualizando dentro del bucle, así que se trabaja sobre una
    // copia viva: dos items del mismo mes podrían tocar filas distintas, pero si alguna vez
    // tocan la misma, la segunda tiene que ver lo que escribió la primera.
    const stocksVivos = [...stocks];

    for (const item of items) {
      const art = articulos.find((a) => a.id_articulo === item.id_articulo);
      if (!art) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });

      const cant = item.cantidad;
      const id_articulo = item.id_articulo;
      // El precio de compra sale del importe de ESTE item. Con un solo artículo es el gasto
      // entero; con varios, lo que se haya indicado para cada uno.
      //
      // Si son varios y no se dijo cuánto corresponde a cada uno, el precio NO se toca: se
      // podría repartir el total en partes iguales, pero eso inventa un precio unitario que
      // después valoriza el stock. Mejor quedarse sin dato que con uno falso.
      const montoBase = items.length === 1 ? (Number(gasto?.monto) || 0) : (item.monto || 0);
      const precioUnitario = cant > 0 && montoBase > 0 ? montoBase / cant : 0;
      const existente = stocksVivos.find((s) =>
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
        (existente as any).compras = nuevaCompras;
      } else {
        const maxId = stocksVivos
          .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
          .filter((n) => !isNaN(n))
          .reduce((m, n) => Math.max(m, n), 0);
        const idNuevo = `STK-${String(maxId + 1).padStart(4, '0')}`;
      // Arrastrar el stock final del mes anterior como inicial de este — antes quedaba
      // siempre en 0, lo que hacía que el "stock actual" del artículo pareciera vacío
      // apenas se confirmaba una compra desde Gastos (ver alertasStockBajo en Panel/Stocks).
        let mesPrev = Number(mes) - 1, anioPrev = Number(anio);
        if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
        const stockAnterior = stocksVivos.find((s) =>
          s.id_articulo === id_articulo && String(s.anio) === String(anioPrev) && String(s.mes) === String(mesPrev)
        );
        const iniHeredado = Number(stockAnterior?.stock_final) || 0;
        const fila = {
          id_stock: idNuevo, id_articulo, categoria: art.categoria, articulo: art.articulo, unidad_medida: art.unidad_medida,
          anio, mes, stock_inicial: iniHeredado, compras: cant, stock_final: 0, uso_calculado: iniHeredado + cant,
          precio_unitario: precioUnitario || '', notas: '', usuario: user.email, fecha_carga: fechaCarga,
        };
        await appendRowObj('Stocks', fila);
        stocksVivos.push(fila as any);
      }
    }

    // El gasto se marca aplicado UNA vez, recién cuando entraron todos los items: si fallara
    // el segundo, el gasto sigue pendiente y se vuelve a ofrecer en vez de desaparecer a
    // medio aplicar.
    await updateRow('Gastos', 'id_gasto', String(id_gasto), { aplicado_stock: 'SI' });
    return NextResponse.json({ ok: true, accion: 'confirmado' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
