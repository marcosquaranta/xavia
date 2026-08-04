import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { parseReparto, REPARTO_DEFAULT, type Slot } from '@/lib/planificacion';
import { calcularCapacidad, diasCicloDefault, trasplantesAgrupados, cosechasAgrupadas, cosechaRealUltimasSemanas, ciclosRealesRecientes, type GrupoLotes } from '@/lib/planificacionServer';
import { tubosPorMesada } from '@/lib/ocupacion';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import PlanificacionManager from './PlanificacionManager';

export const dynamic = 'force-dynamic';

export default async function PlanificacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let reparto: Slot[] = REPARTO_DEFAULT;
  let err: string | null = null;
  try {
    const [l, m, u, cfg] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
    ]);
    lotes = l; movimientos = m; ubicaciones = u;
    const item = cfg.find(i => i.clave === 'plan_reparto');
    if (item) reparto = parseReparto(item.valor);
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return (<><Header user={user} current="planificacion" /><div className="container"><div className="alert-box error">{err}</div></div></>);

  const naves = calcularCapacidad(ubicaciones);
  const defaults = diasCicloDefault(lotes, movimientos);
  let gruposTrasplante: GrupoLotes[] = [];
  let gruposCosecha: GrupoLotes[] = [];
  let cosechaReal: ReturnType<typeof cosechaRealUltimasSemanas> = [];
  let ciclosReales: ReturnType<typeof ciclosRealesRecientes> = { rucula: { dias: 0, muestras: 0 }, lechuga: { fase1: 0, fase2: 0, muestras: 0 } };
  let ocupacionF2Real = 0;
  try {
    gruposTrasplante = trasplantesAgrupados(lotes, movimientos);
    gruposCosecha = cosechasAgrupadas(lotes, movimientos);
    cosechaReal = cosechaRealUltimasSemanas(lotes, movimientos);
    ciclosReales = ciclosRealesRecientes(lotes, movimientos);
    const tubosMesadas = tubosPorMesada(ubicaciones, lotes);
    const mesadasF2 = tubosMesadas.flatMap((n: any) => (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1'));
    ocupacionF2Real = mesadasF2.length > 0
      ? Math.round(mesadasF2.reduce((a: number, m: any) => a + m.tubos_ocupados, 0) / Math.max(1, mesadasF2.reduce((a: number, m: any) => a + m.tubos_totales, 0)) * 100)
      : 0;
  } catch {}

  return (
    <>
      <Header user={user} current="planificacion" />
      <div className="container">
        <h1 className="page-title">Planificación y Producción</h1>
        <p className="page-subtitle">Cuánto sembrar por semana según el ciclo, alimentado por la capacidad real de las naves y el último cultivo cosechado.</p>
        <PlanificacionManager naves={naves} defaults={defaults} repartoInicial={reparto} gruposTrasplante={gruposTrasplante} gruposCosecha={gruposCosecha}
          cosechaReal={cosechaReal} ciclosReales={ciclosReales} ocupacionF2Real={ocupacionF2Real} />
      </div>
    </>
  );
}
