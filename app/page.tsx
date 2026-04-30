// app/page.tsx
// Página raíz. Redirige a /panel si está logueado, a /login si no.

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/panel');
  } else {
    redirect('/login');
  }
}
