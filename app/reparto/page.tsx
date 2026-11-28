import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import RepartoManager from './RepartoManager';

export const dynamic = 'force-dynamic';

// ── La pantalla del reparto ──────────────────────────────────────────────────────────
//
// Es lo único que ve el rol `reparto`, y se abre desde el celular en la calle. Por eso no
// lleva el menú de la app: no hay nada más adonde ir, y un menú con ocho links que no
// puede abrir es una forma de confundir a alguien que está apurado en la puerta de un
// cliente.
//
// Los datos NO se cargan acá sino desde el cliente, contra /api/reparto/dia. Es a
// propósito: con mala señal, una pantalla que se renderiza en el servidor tarda o no abre,
// y lo que necesitamos es que abra siempre aunque después tarde en traer la lista.
export default async function RepartoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin' && user.rol !== 'reparto') redirect('/panel');
  return <RepartoManager nombre={user.nombre} esAdmin={user.rol === 'admin'} />;
}
