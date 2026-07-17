import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
import CambiarPasswordForm from './CambiarPasswordForm';
export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <>
      <Header user={user} />
      <div className="container">
        <h1 className="page-title">Mi cuenta</h1>
        <p className="page-subtitle">{user.nombre} · {user.email} · {user.rol}</p>
        <CambiarPasswordForm />
      </div>
    </>
  );
}
