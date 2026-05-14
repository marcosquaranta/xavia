import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';
export default async function AdminUsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');
  let rows: any[] = [];
  try {
    const todos = await readSheet<any>('Usuarios');
    rows = todos.map((u: any) => ({ email: u.email, nombre: u.nombre, rol: u.rol, activo: u.activo, fecha_alta: u.fecha_alta }));
  } catch {}
  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Admin</Link>
        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Accesos y roles · {rows.length} usuarios</p>
        <div className="alert-box info">Para cambiar contraseñas usá el script <code>node scripts/generar-hash.js</code> y pegá el hash en Google Sheets.</div>
        <div className="card">
          {rows.length === 0 ? <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Sin usuarios.</p> : (
            <table>
              <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Activo</th><th>Alta</th></tr></thead>
              <tbody>{rows.map((r: any, i: number) => <tr key={i}><td>{r.email}</td><td>{r.nombre}</td><td>{r.rol}</td><td>{r.activo}</td><td>{r.fecha_alta}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
