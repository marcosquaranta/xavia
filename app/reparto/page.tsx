import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import RepartoManager from './RepartoManager';

export const dynamic = 'force-dynamic';

// ── La pantalla del reparto ──────────────────────────────────────────────────────────
//
// Se abre desde el celular, en la calle, y es lo único que el que entrega necesita. Por eso no
// lleva el menú de la app: no hay nada más adonde ir, y un menú con ocho links que no
// puede abrir es una forma de confundir a alguien que está apurado en la puerta de un
// cliente.
//
// Los datos NO se cargan acá sino desde el cliente, contra /api/reparto/dia. Es a
// propósito: con mala señal, una pantalla que se renderiza en el servidor tarda o no abre,
// y lo que necesitamos es que abra siempre aunque después tarde en traer la lista.
// ── Quién puede entrar ───────────────────────────────────────────────
//
// Cualquiera que tenga usuario. Decisión de Marcos (28-nov-2026): los repartidores ya
// tenían cuenta y arrancar cambiándole el rol a cada uno frenaba el lanzamiento por un
// trámite.
//
// Lo que eso implica, dicho para que no se pierda: confirmar una entrega EMITE UNA FACTURA
// en AFIP, así que esto es lo único que un rol `usuario` puede hacer que mueve plata. El
// resto de la plata sigue siendo solo de admin. El día que se quiera cerrar, se vuelve a
// pedir el rol `reparto` acá y en los dos endpoints, y nada más cambia.
export default async function RepartoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <RepartoManager nombre={user.nombre} esAdmin={user.rol === 'admin'} />;
}
