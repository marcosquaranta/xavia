import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';
import Header from '@/components/Header';
import ClientesVentaManager from './ClientesVentaManager';
import { HOJA_PRECIOS_HIST, cambiosPorProductoRecord, type CambioPrecio } from '@/lib/preciosHistorico';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import { leerArticulosExtra } from '@/lib/articulosVenta';

export const dynamic = 'force-dynamic';

export default async function ClientesVentaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const [clientes, precios, historial] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    // La hoja puede no existir todavía: el historial arranca recién con el primer cambio
    // de precio guardado desde la app.
    readSheet<CambioPrecio>(HOJA_PRECIOS_HIST).catch(() => [] as CambioPrecio[]),
  ]);

  // Los artículos de alta propia también necesitan su casilla de precio: sin precio cargado
  // no aparecen en la pantalla de carga de ese cliente, así que quedarían creados e
  // invisibles.
  const extras = await leerArticulosExtra();
  const extrasUnidad = extras.filter((a) => a.activo && a.unidad === 'unidad').map((a) => ({ key: a.key, label: a.labelLargo }));
  const extrasKg = extras.filter((a) => a.activo && a.unidad === 'kg').map((a) => ({ key: a.key, label: a.labelLargo }));
  const cambios = cambiosPorProductoRecord(historial, fechaArgentinaHoy());

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Clientes de ventas</h1>
        <p className="page-subtitle">Facturación y precios por cliente</p>
        <ClientesVentaManager clientes={clientes} precios={precios} cambios={cambios}
          extrasUnidad={extrasUnidad} extrasKg={extrasKg} />
      </div>
    </>
  );
}
