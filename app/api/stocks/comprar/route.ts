import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import { MEDIOS_PAGO, type Articulo, type Gasto, type StockMes } from '@/lib/types';

// Registra una compra de insumo directamente desde Stocks: crea el Gasto correspondiente
// (para que quede en la planilla de Gastos, ya marcado como aplicado) y en el mismo paso
// suma la cantidad a "Compras" del artículo para ese mes — antes había que cargar el gasto
// en Gastos y después ir a Stocks a confirmarlo como sugerencia, en dos pasos separados.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const body = await req.json();
    const { anio, mes, medio_pago, fecha } = body;
    // `items` es la forma nueva; el artículo suelto se sigue aceptando para no romper nada.
    const items: { id_articulo: string; cantidad: number; precio_unitario: number }[] =
      Array.isArray(body.items) && body.items.length
        ? body.items.map((i: any) => ({
            id_articulo: String(i?.id_articulo || ''),
            cantidad: Number(i?.cantidad),
            precio_unitario: Number(i?.precio_unitario),
          }))
        : [{ id_articulo: String(body.id_articulo || ''), cantidad: Number(body.cantidad), precio_unitario: Number(body.precio_unitario) }];

    if (!anio || !mes || !medio_pago || !items.length) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (!MEDIOS_PAGO.includes(medio_pago)) {
      return NextResponse.json({ error: 'medio_pago_invalido' }, { status: 400 });
    }
    // Un insumo sin artículo no entra: entraría al gasto pero no al stock, y el consumo del
    // mes (había + compró − quedó) quedaría mal sin que nada avise.
    if (items.some((i) => !i.id_articulo)) {
      return NextResponse.json({ error: 'Cada renglón tiene que decir qué artículo se compró.' }, { status: 400 });
    }
    if (items.some((i) => !isFinite(i.cantidad) || i.cantidad <= 0)) {
      return NextResponse.json({ error: 'cantidad_invalida' }, { status: 400 });
    }
    if (items.some((i) => !isFinite(i.precio_unitario) || i.precio_unitario <= 0)) {
      return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
    }
    if (new Set(items.map((i) => i.id_articulo)).size !== items.length) {
      return NextResponse.json({ error: 'Hay dos renglones con el mismo artículo.' }, { status: 400 });
    }

    const [articulos, stocks, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Gasto>('Gastos'),
    ]);
    const fechaCarga = new Date().toISOString().split('T')[0];
    const fechaGasto = fecha || fechaCarga;
    // Se trabaja sobre copias vivas: dos renglones de la misma compra pueden tocar el mismo
    // mes, y el segundo tiene que ver lo que escribió el primero.
    const stocksVivos = [...stocks];
    const idsGasto: string[] = [];
    let maxIdGasto = gastos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);

    for (const item of items) {
      const id_articulo = item.id_articulo;
      const cant = item.cantidad;
      const precio = item.precio_unitario;
      const art = articulos.find((a) => a.id_articulo === id_articulo);
      if (!art) return NextResponse.json({ error: `No existe el artículo ${id_articulo}.` }, { status: 404 });

      const monto = cant * precio;

      // 1) Gasto — ya marcado como aplicado, porque se está aplicando al stock acá mismo.
      // Uno por artículo: así cada línea queda con su propio precio y su propia cantidad,
      // que es lo que después valoriza el stock.
      const id_gasto = `GAS-${String(++maxIdGasto).padStart(4, '0')}`;
      idsGasto.push(id_gasto);
      await appendRowObj('Gastos', {
        id_gasto, fecha: fechaGasto,
        descripcion: `Compra: ${art.articulo}`,
        categoria: 'insumos', monto, medio_pago,
        usuario: user.email, fecha_carga: fechaCarga,
        id_articulo, cantidad: cant, aplicado_stock: 'SI',
      });

    // 2) Stocks — mismo patrón que /api/stocks/gastos-aplicar: suma cantidad a "compras"
    // del mes (no reemplaza), y actualiza el precio unitario como "último precio conocido".
      const existente = stocksVivos.find((s) =>
        s.id_articulo === id_articulo && String(s.anio) === String(anio) && String(s.mes) === String(mes)
      );
      if (existente) {
        const ini = Number(existente.stock_inicial) || 0;
        const fin = Number(existente.stock_final) || 0;
        const nuevaCompras = (Number(existente.compras) || 0) + cant;
        await updateRow('Stocks', 'id_stock', existente.id_stock, {
          compras: nuevaCompras, uso_calculado: ini + nuevaCompras - fin,
          precio_unitario: precio, usuario: user.email, fecha_carga: fechaCarga,
        });
        (existente as any).compras = nuevaCompras;
      } else {
        const maxIdStock = stocksVivos
        .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
        .filter((n) => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
        const idNuevo = `STK-${String(maxIdStock + 1).padStart(4, '0')}`;
        // Arrastrar el stock final del mes anterior como inicial de este mes.
        let mesPrev = Number(mes) - 1, anioPrev = Number(anio);
        if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
        const stockAnterior = stocksVivos.find((s) =>
          s.id_articulo === id_articulo && String(s.anio) === String(anioPrev) && String(s.mes) === String(mesPrev)
        );
        const iniHeredado = Number(stockAnterior?.stock_final) || 0;
        const fila = {
          id_stock: idNuevo, id_articulo, categoria: art.categoria, articulo: art.articulo, unidad_medida: art.unidad_medida,
          anio, mes, stock_inicial: iniHeredado, compras: cant, stock_final: 0, uso_calculado: iniHeredado + cant,
          precio_unitario: precio, notas: '', usuario: user.email, fecha_carga: fechaCarga,
        };
        await appendRowObj('Stocks', fila);
        stocksVivos.push(fila as any);
      }
    }

    return NextResponse.json({ ok: true, id_gasto: idsGasto[0], ids_gasto: idsGasto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
