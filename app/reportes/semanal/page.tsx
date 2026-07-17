import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { obtenerDatosReporteSemanal, construirHtml, construirTexto } from '@/lib/reporteSemanal';
import Header from '@/components/Header';
import CopiarReporte from '@/components/CopiarReporte';

export const dynamic = 'force-dynamic';

// Vista previa del mail que manda el cron de los viernes 8am (/api/reportes/semanal) —
// arma exactamente el mismo HTML pero lo muestra en pantalla en vez de enviarlo. Los
// datos se leen frescos de la planilla en cada carga (force-dynamic, sin caché), así
// que nunca queda desactualizada aunque se la deje abierta y se recargue más tarde.
export default async function ReporteSemanalPreviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let html = '';
  let texto = '';
  let err: string | null = null;
  try {
    const datos = await obtenerDatosReporteSemanal();
    html = construirHtml(datos);
    texto = construirTexto(datos);
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
          <>
            <CopiarReporte html={html} texto={texto} />
            <div className="card" style={{ background: 'white' }} dangerouslySetInnerHTML={{ __html: html }} />
          </>
        )}
      </div>
    </>
  );
}
