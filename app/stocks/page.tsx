import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Articulo, StockMes, Lote, VentaDia, PrecioVenta, ClienteVenta, Gasto } from '@/lib/types';
import Header from '@/components/Header';
import StocksManager from './StocksManager';
import { calcularValorizacionMes } from '@/lib/valorizacionStock';
import { calcularDriversMes } from '@/lib/usoTeorico';
import { alertasStockBajo } from '@/lib/alertasPanel';
import { leerDescartes, sinDescartadas } from '@/lib/alertasDescartadas';
import DescartarAlerta from '@/components/DescartarAlerta';
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

  return (
    <>
      <Header user={user} current="stocks" />
      <div className="container">
        <h1 className="page-title">Stocks</h1>
        <p className="page-subtitle">Control de insumos · carga mensual · informe comparativo</p>

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
