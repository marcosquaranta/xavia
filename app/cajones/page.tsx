import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { saldoPorCliente, alertasCajones, DEFAULT_UNIDADES_POR_CAJON_RUCULA, DEFAULT_UNIDADES_POR_CAJON_LECHUGA } from '@/lib/cajones';
import type { CajonMovimiento, ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import CajonesManager from './CajonesManager';
export const dynamic = 'force-dynamic';

export default async function CajonesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let movimientos: CajonMovimiento[] = [], clientes: ClienteVenta[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  try {
    [movimientos, clientes, configRows] = await Promise.all([
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => []),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
    ]);
  } catch {}

  const cfgRucula = configRows.find(i => i.clave === 'cajones_unidades_por_cajon_rucula');
  const cfgLechuga = configRows.find(i => i.clave === 'cajones_unidades_por_cajon_lechuga');
  const unidadesPorCajonRucula = cfgRucula && Number(cfgRucula.valor) > 0 ? Number(cfgRucula.valor) : DEFAULT_UNIDADES_POR_CAJON_RUCULA;
  const unidadesPorCajonLechuga = cfgLechuga && Number(cfgLechuga.valor) > 0 ? Number(cfgLechuga.valor) : DEFAULT_UNIDADES_POR_CAJON_LECHUGA;

  // teoricoPorCliente() (ventas ÷ unidades por cajón) se sacó de esta pantalla — a pedido
  // explícito, confundía más de lo que ayudaba. La función sigue en lib/cajones.ts por si
  // se retoma más adelante, solo dejó de usarse acá.
  const saldos = saldoPorCliente(movimientos, clientes);
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
          alertas={alertas}
          clientes={clientesActivos}
          movimientos={movimientos}
          unidadesPorCajonRucula={unidadesPorCajonRucula}
          unidadesPorCajonLechuga={unidadesPorCajonLechuga}
          esAdmin={user.rol === 'admin'}
        />
      </div>
    </>
  );
}
