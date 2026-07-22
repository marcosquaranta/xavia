import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { getRegistrosCrossChex } from '@/lib/crosschex';
import { calcularResumenQuincena, rangoQuincena, type ResumenEmpleado } from '@/lib/personal';
import type { Empleado } from '@/lib/types';
import Header from '@/components/Header';
import PersonalManager from './PersonalManager';

export const dynamic = 'force-dynamic';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default async function PersonalPage({ searchParams }: { searchParams: { anio?: string; mes?: string; q?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const hoy = new Date();
  const anio = Number(searchParams.anio) || hoy.getFullYear();
  const mes = Number(searchParams.mes) || hoy.getMonth() + 1;
  const quincena = (searchParams.q === '2' ? 2 : 1) as 1 | 2;

  let empleados: Empleado[] = [];
  let resumen: ResumenEmpleado[] = [];
  let err: string | null = null;
  try {
    empleados = await readSheet<Empleado>('Empleados').catch(() => []);
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    const registros = await getRegistrosCrossChex(desde, hasta);
    resumen = calcularResumenQuincena(registros, empleados, anio, mes, quincena);
  } catch (e: any) {
    err = e?.message || 'Error consultando CrossChex';
  }

  // Navegación mes/quincena anterior-siguiente, preservando la otra dimensión.
  function url(a: number, m: number, q: 1 | 2) {
    let aa = a, mm = m;
    if (mm < 1) { mm = 12; aa--; }
    if (mm > 12) { mm = 1; aa++; }
    return `/admin/personal?anio=${aa}&mes=${mm}&q=${q}`;
  }
  const mesAnteriorHref = quincena === 1 ? url(anio, mes - 1, 2) : url(anio, mes, 1);
  const mesSiguienteHref = quincena === 2 ? url(anio, mes + 1, 1) : url(anio, mes, 2);

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Control de personal</h1>
        <p className="page-subtitle">Horas, tardanzas y sueldo por quincena — fichajes desde CrossChex</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <Link href={mesAnteriorHref} className="btn secondary" style={{ fontSize: '13px' }}>← Anterior</Link>
          <span style={{ fontWeight: 700, fontSize: '14px' }}>
            {MESES[mes - 1]} {anio} · {quincena === 1 ? '1ra quincena (1-15)' : `2da quincena (16-${new Date(anio, mes, 0).getDate()})`}
          </span>
          <Link href={mesSiguienteHref} className="btn secondary" style={{ fontSize: '13px' }}>Siguiente →</Link>
        </div>

        {err && (
          <div className="alert-box error" style={{ marginBottom: '14px' }}>
            {err}
            {err.includes('CROSSCHEX_API_KEY') && (
              <p style={{ margin: '6px 0 0', fontSize: '12px' }}>Configurá CROSSCHEX_API_KEY y CROSSCHEX_API_SECRET en las variables de entorno de Vercel.</p>
            )}
          </div>
        )}

        {!err && <PersonalManager resumen={resumen} empleados={empleados} />}
      </div>
    </>
  );
}
