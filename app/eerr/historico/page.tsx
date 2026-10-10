import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
import { cargarDatosHistorico, mesesConDatos, historicoEERR } from '@/lib/eerrHistorico';
import TablaHistorico from './TablaHistorico';

export const dynamic = 'force-dynamic';

// Serie mensual del EERR. Está aparte de la pantalla del cierre porque son dos preguntas
// distintas: el cierre es "cómo dio este mes", esto es "cómo venimos". Y porque calcular
// todos los meses es más caro que calcular uno, así que no tiene que pagarlo quien entra
// solo a cerrar el mes.
export default async function HistoricoEERRPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let err: string | null = null;
  let h: Awaited<ReturnType<typeof cargarDatosHistorico>> | null = null;
  try {
    h = await cargarDatosHistorico();
  } catch (e: any) {
    err = e?.message || 'Error cargando datos';
  }

  const meses = h ? mesesConDatos(h.datos.gastos, h.datos.ventas) : [];
  const historico = h && meses.length ? historicoEERR(h, meses) : null;

  return (
    <>
      <Header user={user} current="eerr" />
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <h1 style={{ margin: 0 }}>Histórico mes a mes</h1>
          <Link href="/eerr" style={{ fontSize: '13px' }}>← Cierre mensual</Link>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
          El EERR de todos los meses en una tabla, con las mismas líneas que el cierre. Lo que se lee acá no es un mes
          sino la tendencia: si una línea viene subiendo tres meses seguidos, si el resultado mejora o fue un buen mes aislado.
        </p>

        {err && <div className="alert-box error">{err}</div>}
        {!err && !historico && (
          <div className="alert-box">
            Todavía no hay meses cerrados para mostrar. Aparecen acá a partir del mes siguiente al primero con gastos o ventas cargados.
          </div>
        )}
        {historico && <TablaHistorico h={historico} />}
      </div>
    </>
  );
}
