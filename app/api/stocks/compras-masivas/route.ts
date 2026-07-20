import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, readRaw, batchUpdateRows, appendRows } from '@/lib/sheets';
import type { Articulo, StockMes } from '@/lib/types';

// Carga masiva de "Compras" o "Stock final": REEMPLAZA el valor de esa columna del mes
// para cada artículo recibido (no lo suma a lo que hubiera). Conserva el resto de las
// columnas existentes, y recalcula uso_calculado.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { anio, mes, items, campo } = body as { anio: number; mes: number; items: { id_articulo: string; compras: number }[]; campo?: 'compras' | 'stock_final' };
    const columna: 'compras' | 'stock_final' = campo === 'stock_final' ? 'stock_final' : 'compras';
    if (!anio || !mes || !Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const [articulos, stocks, raw] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readRaw('Stocks'),
    ]);
    const headers = raw[0] || [];
    const fechaCarga = new Date().toISOString().split('T')[0];

    let maxId = stocks
      .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);

    let mesPrev = Number(mes) - 1, anioPrev = Number(anio);
    if (mesPrev === 0) { mesPrev = 12; anioPrev--; }

    const actualizaciones: { keyValue: string; updates: Record<string, any> }[] = [];
    const nuevasFilas: any[][] = [];
    let actualizados = 0, creados = 0, saltados = 0;

    for (const item of items) {
      const art = articulos.find((a) => a.id_articulo === item.id_articulo);
      const comp = Number(item.compras);
      if (!art || !isFinite(comp) || comp < 0) { saltados++; continue; }

      const existente = stocks.find((s) =>
        s.id_articulo === item.id_articulo && String(s.anio) === String(anio) && String(s.mes) === String(mes)
      );

      if (existente) {
        const ini = Number(existente.stock_inicial) || 0;
        const otraCompras = columna === 'stock_final' ? Number(existente.compras) || 0 : comp;
        const otroFin = columna === 'stock_final' ? comp : Number(existente.stock_final) || 0;
        actualizaciones.push({
          keyValue: existente.id_stock,
          updates: { [columna]: comp, uso_calculado: ini + otraCompras - otroFin, usuario: user.email, fecha_carga: fechaCarga },
        });
        actualizados++;
      } else {
        maxId++;
        const idNuevo = `STK-${String(maxId).padStart(4, '0')}`;
        // Arrastrar el stock final del mes anterior como inicial — mismo motivo que en
        // gastos-aplicar: dejarlo en 0 hacía que el "stock actual" pareciera vacío.
        const stockAnterior = stocks.find((s) =>
          s.id_articulo === art.id_articulo && String(s.anio) === String(anioPrev) && String(s.mes) === String(mesPrev)
        );
        const iniHeredado = Number(stockAnterior?.stock_final) || 0;
        const obj: Record<string, any> = {
          id_stock: idNuevo, id_articulo: art.id_articulo, categoria: art.categoria, articulo: art.articulo,
          unidad_medida: art.unidad_medida, anio, mes, stock_inicial: iniHeredado, compras: 0, stock_final: 0,
          notas: '', usuario: user.email, fecha_carga: fechaCarga,
        };
        obj[columna] = comp;
        obj.uso_calculado = (Number(obj.stock_inicial) || 0) + (Number(obj.compras) || 0) - (Number(obj.stock_final) || 0);
        nuevasFilas.push(headers.map((h) => (obj[h] !== undefined ? obj[h] : '')));
        creados++;
      }
    }

    if (actualizaciones.length) await batchUpdateRows('Stocks', 'id_stock', actualizaciones);
    if (nuevasFilas.length) await appendRows('Stocks', nuevasFilas);

    return NextResponse.json({ ok: true, actualizados, creados, saltados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
