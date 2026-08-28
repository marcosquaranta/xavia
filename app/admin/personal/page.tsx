import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { leerFichajesCache, diasEnCache } from '@/lib/fichajesCache';
import { calcularResumenQuincena, rangoQuincena, hoyArg, type AjusteQuincena, type ResumenEmpleado } from '@/lib/personal';
import type { Empleado, PersonalQuincena } from '@/lib/types';
import Header from '@/components/Header';
import PersonalManager from './PersonalManager';
import SincronizarFichajes from './SincronizarFichajes';

export const dynamic = 'force-dynamic';
// Pide fichajes de la quincena a CrossChex en vivo — con el límite real de CrossChex
// (1 pedido/15s, ver lib/crosschex.ts) un token+datos "en frío" puede tardar ~15-20s.
export const maxDuration = 60;

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
  const diasSinSincronizar: string[] = [];
  try {
    const [empleadosData, ajustesData] = await Promise.all([
      readSheet<Empleado>('Empleados').catch(() => []),
      readSheet<PersonalQuincena>('PersonalQuincena').catch(() => []),
    ]);
    empleados = empleadosData;
    const ajustesDeEstaQuincena = ajustesData.filter((a) => String(a.anio) === String(anio) && String(a.mes) === String(mes) && String(a.quincena) === String(quincena));
    const ajustes: Record<string, AjusteQuincena> = {};
    for (const a of ajustesDeEstaQuincena) {
      ajustes[String(a.workno)] = { presentismoManual: a.presentismo_manual, extras: Number(a.extras) || 0, horasExtras: Number(a.horas_extras) || 0 };
    }
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    // Lee la caché local de fichajes (hoja FichajesDiarios) en vez de pedirle a CrossChex,
    // que con su límite de 1 pedido/15s hacía que esta página tardara ~60-75s en abrir.
    // La caché la llena el cron diario (/api/cron/crosschex-diario), que también acepta un
    // rango a mano para sincronizar una quincena vieja que todavía no esté guardada.
    const desdeDia = desde.slice(0, 10), hastaDia = hasta.slice(0, 10);
    const registros = await leerFichajesCache(desdeDia, hastaDia);
    resumen = calcularResumenQuincena(registros, empleados, anio, mes, quincena, ajustes);
    // Días de la quincena (hasta hoy) que todavía no tienen ningún fichaje guardado — para
    // avisar en pantalla en vez de mostrar una quincena en cero como si nadie hubiera venido.
    const cacheados = await diasEnCache();
    const hoyDia = hoyArg();
    for (let d = new Date(desdeDia + 'T12:00:00'); d <= new Date(hastaDia + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
      const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (f > hoyDia) break;
      if (!cacheados.has(f)) diasSinSincronizar.push(f);
    }
  } catch (e: any) {
    err = e?.message || 'Error leyendo los fichajes guardados';
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

        {!err && diasSinSincronizar.length > 0 && (
          <SincronizarFichajes desde={diasSinSincronizar[0]} hasta={diasSinSincronizar[diasSinSincronizar.length - 1]} dias={diasSinSincronizar} />
        )}

        {!err && <PersonalManager resumen={resumen} empleados={empleados} anio={anio} mes={mes} quincena={quincena} />}
      </div>
    </>
  );
}
