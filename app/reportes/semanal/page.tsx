import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { obtenerDatosReporteSemanal, construirHtml } from '@/lib/reporteSemanal';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

// Vista previa del mail que manda el cron de los viernes 8am (/api/reportes/semanal) —
// arma exactamente el mismo HTML pero lo muestra en pantalla en vez de enviarlo.
export default async function ReporteSemanalPreviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let html = '';
  let err: string | null = null;
  try {
    const datos = await obtenerDatosReporteSemanal();
    html = construirHtml(datos);
  } catch (e: any) {
    err = e?.message || 'Error generando el reporte';
  }

  return (
    <>
      <Header user={user} />
      <div className="container">
        <h1 className="page-title">Vista previa — Reporte semanal</h1>
        <p className="page-subtitle">Así se vería el mail que se manda los viernes a las 8am, calculado con los datos de ahora mismo (no se envía nada).</p>
        {err ? (
          <div className="alert-box error">{err}</div>
        ) : (
          <div className="card" style={{ background: 'white' }} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </>
  );
}
