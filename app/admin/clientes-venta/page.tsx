import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';
import Header from '@/components/Header';
import ClientesVentaManager from './ClientesVentaManager';

export const dynamic = 'force-dynamic';

export default async function ClientesVentaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const [clientes, precios] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
  ]);

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Clientes de ventas</h1>
        <p className="page-subtitle">Facturación y precios por cliente</p>
        <ClientesVentaManager clientes={clientes} precios={precios} />
      </div>
    </>
  );
}
