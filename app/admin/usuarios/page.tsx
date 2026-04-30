// app/admin/usuarios/page.tsx
// Gestión de usuarios.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Usuario } from '@/lib/types';
import Header from '@/components/Header';
import UsuariosManager from './UsuariosManager';

export const dynamic = 'force-dynamic';

export default async function AdminUsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const usuarios = await readSheet<Usuario>('Usuarios');

  // No paso los hashes al cliente
  const usuariosSinHash = usuarios.map(({ password_hash, ...rest }) => rest);

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

        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Crear, editar y desactivar usuarios del sistema</p>

        <UsuariosManager usuarios={usuariosSinHash as any} miEmail={user.email} />
      </div>
    </>
  );
}
