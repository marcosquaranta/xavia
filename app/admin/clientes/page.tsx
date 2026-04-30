// app/admin/clientes/page.tsx
// Catálogo de clientes (preparado para fase 2 de Ventas).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Cliente } from '@/lib/types';
import Header from '@/components/Header';
import ClientesManager from './ClientesManager';

export const dynamic = 'force-dynamic';

export default async function AdminClientesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const clientes = await readSheet<Cliente>('Clientes');

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link
          href="/admin"
          style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}
        >
          ← Volver a Admin
        </Link>

        <h1 className="page-title">Clientes</h1>
        <p className="page-subtitle">
          Base de clientes. La pantalla de Ventas (fase 2) los va a usar para asignar
          entregas y trazabilidad de lotes.
        </p>

        <div className="alert-box info" style={{ marginBottom: '14px' }}>
          <strong>Fase 2:</strong> ya podés cargar clientes acá. La pantalla de Ventas
          se construye en una próxima iteración.
        </div>

        <ClientesManager clientes={clientes} />
      </div>
    </>
  );
}
