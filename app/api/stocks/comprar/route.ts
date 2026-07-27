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
    const { id_articulo, anio, mes, cantidad, precio_unitario, medio_pago, fecha } = await req.json();
    if (!id_articulo || !anio || !mes || !medio_pago) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (!MEDIOS_PAGO.includes(medio_pago)) {
      return NextResponse.json({ error: 'medio_pago_invalido' }, { status: 400 });
    }
    const cant = Number(cantidad);
    const precio = Number(precio_unitario);
    if (!isFinite(cant) || cant <= 0) return NextResponse.json({ error: 'cantidad_invalida' }, { status: 400 });
    if (!isFinite(precio) || precio <= 0) return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });

    const [articulos, stocks, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Gasto>('Gastos'),
    ]);
    const art = articulos.find((a) => a.id_articulo === id_articulo);
    if (!art) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });

    const monto = cant * precio;
    const fechaCarga = new Date().toISOString().split('T')[0];
    const fechaGasto = fecha || fechaCarga;

    // 1) Gasto — ya marcado como aplicado, porque se está aplicando al stock acá mismo.
    const maxIdGasto = gastos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    const id_gasto = `GAS-${String(maxIdGasto + 1).padStart(4, '0')}`;
    await appendRowObj('Gastos', {
      id_gasto, fecha: fechaGasto,
      descripcion: `Compra: ${art.articulo}`,
      categoria: 'insumos', monto, medio_pago,
      usuario: user.email, fecha_carga: fechaCarga,
      id_articulo, cantidad: cant, aplicado_stock: 'SI',
    });

    // 2) Stocks — mismo patrón que /api/stocks/gastos-aplicar: suma cantidad a "compras"
    // del mes (no reemplaza), y actualiza el precio unitario como "último precio conocido".
    const existente = stocks.find((s) =>
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
    } else {
      const maxIdStock = stocks
        .map((s) => parseInt(String(s.id_stock).replace('STK-', '') || '0'))
        .filter((n) => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
      const idNuevo = `STK-${String(maxIdStock + 1).padStart(4, '0')}`;
      // Arrastrar el stock final del mes anterior como inicial de este mes.
      let mesPrev = Number(mes) - 1, anioPrev = Number(anio);
      if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
      const stockAnterior = stocks.find((s) =>
        s.id_articulo === id_articulo && String(s.anio) === String(anioPrev) && String(s.mes) === String(mesPrev)
      );
      const iniHeredado = Number(stockAnterior?.stock_final) || 0;
      await appendRowObj('Stocks', {
        id_stock: idNuevo, id_articulo, categoria: art.categoria, articulo: art.articulo, unidad_medida: art.unidad_medida,
        anio, mes, stock_inicial: iniHeredado, compras: cant, stock_final: 0, uso_calculado: iniHeredado + cant,
        precio_unitario: precio, notas: '', usuario: user.email, fecha_carga: fechaCarga,
      });
    }

    return NextResponse.json({ ok: true, id_gasto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
