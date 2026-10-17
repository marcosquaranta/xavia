import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import Header from '@/components/Header';
import AvisosMailConfig from '@/components/AvisosMailConfig';
import { AVISOS } from '@/lib/avisosConfig';

export const dynamic = 'force-dynamic';

// A quién le llega cada aviso automático.
//
// Vive en Admin porque se toca cuando cambia quién sigue algo —un par de veces por año— y
// porque es lo único que hace falta para que un aviso que ya funciona le llegue a otra
// persona. Antes había que editar la planilla a mano, que es donde nadie va a buscarlo.
export default async function AvisosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let config: { clave: string; valor: any }[] = [];
  try {
    config = await readSheet<{ clave: string; valor: any }>('Configuracion');
  } catch { /* la hoja puede no existir todavía: se usan los defaults */ }

  const avisos = AVISOS.map((a) => {
    const valorActual = String(config.find((c) => String(c.clave).trim() === a.clave)?.valor || '').trim();
    return { ...a, valorActual, usandoDefault: !valorActual };
  });

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Admin</Link>
        <h1 className="page-title">Avisos por mail</h1>
        <p className="page-subtitle">
          A quién le llega cada aviso automático. Se puede poner más de una dirección, separadas por coma.
        </p>
        <div className="card">
          <AvisosMailConfig avisos={avisos} />
        </div>
      </div>
    </>
  );
}
