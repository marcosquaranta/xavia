import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import Header from '@/components/Header';
import UsuariosManager from './UsuariosManager';
export const dynamic = 'force-dynamic';

export default async function AdminUsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');
  const usuarios = await readSheet<any>('Usuarios');
  const lista = usuarios.map((u: any) => ({
    email: u.email,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    fecha_alta: u.fecha_alta,
  }));
  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Admin</Link>
        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Gestión de accesos · {lista.filter((u: any) => u.activo === 'SI').length} activos</p>
        <UsuariosManager usuarios={lista} />
      </div>
    </>
  );
}
