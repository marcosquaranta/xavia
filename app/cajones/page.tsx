import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { saldoPorCliente, teoricoPorCliente, alertasCajones, DEFAULT_UNIDADES_POR_CAJON } from '@/lib/cajones';
import type { CajonMovimiento, ClienteVenta, VentaDia } from '@/lib/types';
import Header from '@/components/Header';
import CajonesManager from './CajonesManager';
export const dynamic = 'force-dynamic';

export default async function CajonesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let movimientos: CajonMovimiento[] = [], clientes: ClienteVenta[] = [], ventas: VentaDia[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  try {
    [movimientos, clientes, ventas, configRows] = await Promise.all([
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => []),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<VentaDia>('Ventas').catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
    ]);
  } catch {}

  const cfgItem = configRows.find(i => i.clave === 'cajones_unidades_por_cajon');
  const unidadesPorCajon = cfgItem && Number(cfgItem.valor) > 0 ? Number(cfgItem.valor) : DEFAULT_UNIDADES_POR_CAJON;

  const saldos = saldoPorCliente(movimientos, clientes);
  const teoricoMap = teoricoPorCliente(ventas, unidadesPorCajon);
  const alertas = alertasCajones(saldos, 7);

  const clientesActivos = clientes.filter(c => c.activo === 'SI').sort((a, b) => (a.nombre_display || a.nombre_xubio).localeCompare(b.nombre_display || b.nombre_xubio));

  return (
    <>
      <Header user={user} current="cajones" />
      <div className="container">
        <h1 className="page-title">Cajones</h1>
        <p className="page-subtitle">Cajones plásticos entregados y devueltos por cliente — cuántos quedan en la calle</p>
        <CajonesManager
          saldos={saldos}
          teorico={Object.fromEntries(teoricoMap)}
          alertas={alertas}
          clientes={clientesActivos}
          movimientos={movimientos}
          unidadesPorCajon={unidadesPorCajon}
          esAdmin={user.rol === 'admin'}
        />
      </div>
    </>
  );
}
