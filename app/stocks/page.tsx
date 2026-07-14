import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Articulo, StockMes, Lote, VentaDia, StockCamara, PrecioVenta, ClienteVenta, Gasto } from '@/lib/types';
import Header from '@/components/Header';
import StocksManager from './StocksManager';
import StockCamaraCards from '@/components/StockCamaraCards';
import { calcularCamara } from '@/lib/camara';
export const dynamic = 'force-dynamic';

export default async function StocksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let articulos: Articulo[] = [], stocks: StockMes[] = [], lotes: Lote[] = [];
  let ventas: VentaDia[] = [], registrosCamara: StockCamara[] = [];
  let precios: PrecioVenta[] = [], clientes: ClienteVenta[] = [], gastos: Gasto[] = [];
  let err: string | null = null;
  try {
    [articulos, stocks, lotes, ventas, registrosCamara, precios, clientes, gastos] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Lote>('Lotes'),
      readSheet<VentaDia>('Ventas'),
      readSheet<StockCamara>('StockCamara').catch(() => []),
      readSheet<PrecioVenta>('Precios'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<Gasto>('Gastos').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  const camaraRucula  = calcularCamara('rucula',  registrosCamara, lotes, ventas);
  const camaraLechuga = calcularCamara('lechuga', registrosCamara, lotes, ventas);

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

        <StockCamaraCards rucula={camaraRucula} lechuga={camaraLechuga} isAdmin={user.rol === 'admin'} />

        <StocksManager
          articulos={articulos.filter((a) => a.activo === 'SI')}
          stocks={stocks}
          lotes={lotes}
          ventas={ventas}
          precios={precios}
          clientes={clientes}
          gastosSugeridos={gastosSugeridos}
          usuario={user.email}
        />
      </div>
    </>
  );
}
