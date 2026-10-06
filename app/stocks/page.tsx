import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Articulo, StockMes, Lote, VentaDia, PrecioVenta, ClienteVenta, Gasto } from '@/lib/types';
import Header from '@/components/Header';
import StocksManager from './StocksManager';
import CargarDescarteCamara, { CULTIVOS_DESCARTE } from '@/components/CargarDescarteCamara';
import { calcularValorizacionMes } from '@/lib/valorizacionStock';
import { calcularDriversMes } from '@/lib/usoTeorico';
import { alertasStockBajo } from '@/lib/alertasPanel';
import { leerDescartes, sinDescartadas } from '@/lib/alertasDescartadas';
import DescartarAlerta from '@/components/DescartarAlerta';
import ComprasDelMes from '@/components/ComprasDelMes';
export const dynamic = 'force-dynamic';

export default async function StocksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let articulos: Articulo[] = [], stocks: StockMes[] = [], lotes: Lote[] = [];
  let ventas: VentaDia[] = [];
  let precios: PrecioVenta[] = [], clientes: ClienteVenta[] = [], gastos: Gasto[] = [];
  let err: string | null = null;
  try {
    [articulos, stocks, lotes, ventas, precios, clientes, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Lote>('Lotes'),
      readSheet<VentaDia>('Ventas'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<Gasto>('Gastos').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  const hoy = new Date();
  const valorizacionActual = calcularValorizacionMes(articulos, stocks, hoy.getFullYear(), hoy.getMonth() + 1);

  // Alertas de stock bajo (< 15 días de uso) — antes vivían en el Panel, se movieron acá
  // por pedido: "que las alertas de stock queden en la sección de Stocks, no en la home".
  let mesPrevAlertas = hoy.getMonth(), anioPrevAlertas = hoy.getFullYear();
  if (mesPrevAlertas === 0) { mesPrevAlertas = 12; anioPrevAlertas--; }
  const diasEnMesPrevAlertas = new Date(anioPrevAlertas, mesPrevAlertas, 0).getDate();
  const driversStockActual = calcularDriversMes(lotes, ventas, precios, clientes, hoy.getFullYear(), hoy.getMonth() + 1);
  const driversStockMesAnterior = calcularDriversMes(lotes, ventas, precios, clientes, anioPrevAlertas, mesPrevAlertas);
  const alertasStockTodas = alertasStockBajo(articulos, stocks, driversStockActual, driversStockMesAnterior, hoy.getFullYear(), hoy.getMonth() + 1, diasEnMesPrevAlertas, 15);
  const descartes = await leerDescartes();
  const alertasStock = sinDescartadas(alertasStockTodas, descartes, hoy.getFullYear(), hoy.getMonth() + 1);

  if (err) return (
    <>
      <Header user={user} current="stocks" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  // Gastos de categoría "insumos" aún no aplicados a Stocks — se ofrecen como sugerencia
  // de compra en el panel de carga (el usuario confirma la cantidad real o descarta).
  const gastosSugeridos = gastos.filter((g) => g.categoria === 'insumos' && g.aplicado_stock !== 'SI');

  // Las compras del mes: los gastos que tienen un artículo asociado. No se filtra por
  // categoría —una compra de insumos puede estar cargada como "gastos generales" si quien
  // la cargó eligió mal— porque el artículo es el dato que de verdad la define como compra.
  // El movimiento de stock por mes, para poder mostrar la cuenta del consumo abierta:
  // había + compró − quedó. Vacío NO es cero: sin recuento final el consumo no se puede
  // calcular, y decir 0 sería afirmar que se consumió todo.
  const movimientosStock: Record<string, { id_articulo: string; inicial: number; compras: number; final: number; tieneFinal: boolean }[]> = {};
  for (const st of stocks) {
    const clave = `${st.anio}-${Number(st.mes)}`;
    const crudo = String((st as any).stock_final ?? '').trim();
    (movimientosStock[clave] ||= []).push({
      id_articulo: String(st.id_articulo),
      inicial: Number(st.stock_inicial) || 0,
      compras: Number(st.compras) || 0,
      final: Number(st.stock_final) || 0,
      tieneFinal: crudo !== '' && !isNaN(Number(crudo)),
    });
  }

  const nombreArt = new Map(articulos.map((a) => [String(a.id_articulo), a]));
  const compras = gastos
    .filter((g) => String(g.id_articulo || '').trim())
    .map((g) => {
      const art = nombreArt.get(String(g.id_articulo).trim());
      return {
        id_gasto: String(g.id_gasto),
        fecha: String(g.fecha || '').split(/[T ]/)[0],
        descripcion: String(g.descripcion || ''),
        id_articulo: String(g.id_articulo || ''),
        articuloNombre: art?.articulo || String(g.id_articulo || ''),
        unidad: art?.unidad_medida || '',
        cantidad: Number(g.cantidad) || 0,
        monto: Number(g.monto) || 0,
        medio_pago: String(g.medio_pago || ''),
        categoria: String(g.categoria || 'insumos'),
      };
    });

  return (
    <>
      <Header user={user} current="stocks" />
      <div className="container">
        <h1 className="page-title">Stocks</h1>
        <p className="page-subtitle">Control de insumos · carga mensual · informe comparativo</p>

        {/* El descarte de cámara no tiene nada que ver con los insumos de esta pantalla,
            pero "Stocks" es el primer lugar donde uno lo busca. Va arriba, los cuatro
            cultivos juntos, para no tener que entrar al detalle de cada uno. */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Descarte de cámara
          </p>
          <p style={{ margin: '0 0 9px', fontSize: '11.5px', color: '#6b7280' }}>
            Producto ya empaquetado que se tiró. Sale del stock de cámara y cuenta en los indicadores de descarte.
            No es lo mismo que el faltante de un ajuste de stock, que es producto que no se sabe dónde está.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {CULTIVOS_DESCARTE.map((c) => (
              <CargarDescarteCamara key={c.key} cultivo={c.key} label={c.label} compacto />
            ))}
          </div>
        </div>

        {alertasStock.length > 0 && (
          <div className="card" style={{ marginBottom: '14px', background: '#fef2f2', border: '1px solid #fecaca' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ⚠️ Stock estimado por debajo de 15 días de uso
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {alertasStock.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d', flex: 1 }}>{a.msg}</p>
                  {a.clave && <DescartarAlerta clave={a.clave} anio={hoy.getFullYear()} mes={hoy.getMonth() + 1} />}
                </div>
              ))}
            </div>
          </div>
        )}

        <ComprasDelMes
          compras={compras}
          movimientos={movimientosStock}
          anioActual={hoy.getFullYear()}
          mesActual={hoy.getMonth() + 1}
        />

        <StocksManager
          articulos={articulos.filter((a) => a.activo === 'SI')}
          stocks={stocks}
          lotes={lotes}
          ventas={ventas}
          precios={precios}
          clientes={clientes}
          gastosSugeridos={gastosSugeridos}
          usuario={user.email}
          anioActual={hoy.getFullYear()}
          mesActual={hoy.getMonth() + 1}
        />
      </div>
    </>
  );
}
