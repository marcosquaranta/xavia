// app/admin/page.tsx
// Hub de administración. Cards a las sub-secciones.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';

const SECCIONES = [
  {
    href: '/admin/naves',
    titulo: 'Configuración de naves',
    sub: 'Capacidades, módulos y orificios por mesada',
  },
  {
    href: '/admin/semillas',
    titulo: 'Semillas',
    sub: 'Catálogo de batches por proveedor',
  },
  {
    href: '/admin/usuarios',
    titulo: 'Usuarios',
    sub: 'Crear, editar y desactivar usuarios',
  },
  {
    href: '/admin/clientes',
    titulo: 'Clientes',
    sub: 'Base de clientes (preparada para Ventas en fase 2)',
  },
];

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Administración</h1>
        <p className="page-subtitle">Configuración del sistema</p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '12px',
          }}
        >
          {SECCIONES.map((s) => (
            <Link key={s.href} href={s.href} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ cursor: 'pointer', margin: 0, height: '100%' }}>
                <p className="card-title" style={{ marginBottom: '4px' }}>
                  {s.titulo}
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{s.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
