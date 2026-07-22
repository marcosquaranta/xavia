import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PedidoFijo } from '@/lib/types';
import Header from '@/components/Header';
import PedidosFijosManager from './PedidosFijosManager';

export const dynamic = 'force-dynamic';

export default async function PedidosFijosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const [clientes, pedidos] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PedidoFijo>('PedidosFijos').catch(() => []),
  ]);

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Pedidos fijos</h1>
        <p className="page-subtitle">Pedidos recurrentes por día de la semana — se pre-cargan solos en Ventas</p>
        <PedidosFijosManager clientes={clientes} pedidos={pedidos} />
      </div>
    </>
  );
}
