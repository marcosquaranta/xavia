import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import type { Articulo, StockMes } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { id_articulo, anio, mes, stock_inicial, compras, stock_final, notas, precio_unitario } = body;

    if (!id_articulo || !anio || !mes) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const [articulos, stocks] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
    ]);

    const art = articulos.find((a) => a.id_articulo === id_articulo);
    if (!art) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });

    const ini = Number(stock_inicial) || 0;
    const comp = Number(compras) || 0;
    const fin = Number(stock_final) || 0;
    const uso = ini + comp - fin;
    const precio = Number(precio_unitario) || 0;

    // Verificar si ya existe registro para este artículo/mes/año
    const existente = stocks.find((s) =>
      s.id_articulo === id_articulo &&
      String(s.anio) === String(anio) &&
      String(s.mes) === String(mes)
    );

    const fechaCarga = new Date().toISOString().split('T')[0];

    if (existente) {
      const updates: Record<string, any> = {
        stock_inicial: ini, compras: comp, stock_final: fin,
        uso_calculado: uso, notas: notas || '', usuario: user.email, fecha_carga: fechaCarga,
      };
      // Solo pisa el precio si se cargó uno nuevo — conserva el último precio conocido si se deja vacío.
      if (precio > 0) updates.precio_unitario = precio;
      await updateRow('Stocks', 'id_stock', existente.id_stock, updates);
      return NextResponse.json({ ok: true, accion: 'actualizado' });
    }

    // Generar nuevo ID
    const maxId = stocks
      .map((s) => parseInt(s.id_stock?.replace('STK-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((max, n) => Math.max(max, n), 0);
    const idNuevo = `STK-${String(maxId + 1).padStart(4, '0')}`;

    await appendRowObj('Stocks', {
      id_stock: idNuevo, id_articulo, categoria: art.categoria, articulo: art.articulo, unidad_medida: art.unidad_medida,
      anio, mes, stock_inicial: ini, compras: comp, stock_final: fin, uso_calculado: uso,
      precio_unitario: precio || '', notas: notas || '', usuario: user.email, fecha_carga: fechaCarga,
    });

    return NextResponse.json({ ok: true, accion: 'creado', id_stock: idNuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
