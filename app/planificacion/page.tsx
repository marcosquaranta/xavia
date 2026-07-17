import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { parseReparto, REPARTO_DEFAULT, type Slot } from '@/lib/planificacion';
import { calcularCapacidad, diasCicloDefault, trasplantesAgrupados, cosechasAgrupadas, type GrupoLotes } from '@/lib/planificacionServer';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import PlanificacionManager from './PlanificacionManager';

export const dynamic = 'force-dynamic';

export default async function PlanificacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

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
  try {
    gruposTrasplante = trasplantesAgrupados(lotes, movimientos);
    gruposCosecha = cosechasAgrupadas(lotes, movimientos);
  } catch {}

  return (
    <>
      <Header user={user} current="planificacion" />
      <div className="container">
        <h1 className="page-title">Planificación y Producción</h1>
        <p className="page-subtitle">Cuánto sembrar por semana según el ciclo, alimentado por la capacidad real de las naves y el último cultivo cosechado.</p>
        <PlanificacionManager naves={naves} defaults={defaults} repartoInicial={reparto} gruposTrasplante={gruposTrasplante} gruposCosecha={gruposCosecha} />
      </div>
    </>
  );
}
