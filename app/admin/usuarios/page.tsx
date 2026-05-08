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
  try { rows = await readSheet('Usuarios'); } catch {}
  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }>← Admin</Link>
        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Accesos y roles del sistema · {rows.length} registros</p>
        <div className="alert-box info">Gestión de usuarios disponible. Edición directa en Google Sheets recomendada para cambios de estructura.</div>
        <div className="card">
          {rows.length === 0 ? <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Sin registros cargados.</p> : (
            <table>
              <thead><tr>{Object.keys(rows[0] || {}).slice(0, 6).map((k) => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 20).map((r, i) => <tr key={i}>{Object.values(r).slice(0, 6).map((v: any, j) => <td key={j}>{String(v ?? '')}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}