import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');
  const secciones = [
    { href: '/admin/naves', titulo: 'Naves y mesadas', desc: 'Configurar capacidades y ubicaciones' },
    { href: '/admin/semillas', titulo: 'Semillas', desc: 'Stock de semillas y batches' },
    { href: '/admin/usuarios', titulo: 'Usuarios', desc: 'Gestionar accesos y roles' },
    { href: '/admin/clientes-venta', titulo: 'Clientes', desc: 'Facturación, precios y Xubio' },
    { href: '/admin/articulos', titulo: 'Artículos de stock', desc: 'Categorías, unidades y fórmula de uso teórico' },
  ];
  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Administración</h1>
        <p className="page-subtitle">Solo admin · Configuración del sistema</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {secciones.map((s) => (
            <Link key={s.href} href={s.href} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ cursor: 'pointer', transition: 'box-shadow 0.1s' }}>
                <p className="card-title">{s.titulo}</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{s.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}