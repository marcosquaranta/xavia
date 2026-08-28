import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { leerFichajesCache } from '@/lib/fichajesCache';
import { calcularResumenQuincena, rangoQuincena, tardanzasDeHoy } from '@/lib/personal';
import type { Empleado, PersonalQuincena } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Tardanzas DE HOY (no de toda la quincena) para el banner del home. Lee la caché local
// de fichajes (hoja FichajesDiarios, que llena el cron diario) — ya NO le pide nada a
// CrossChex, que con su límite de 1 pedido/15s hacía que este endpoint tardara ~60s en
// responder cada vez que se abría el home. La contra es que el banner muestra los
// ingresos hasta la última corrida del cron (10hs), que es justo después del horario de
// entrada, así que a los fines del aviso de tardanzas da igual.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ tardanzas: [] });

  try {
    const hoy = new Date();
    const quincenaActual = (hoy.getDate() <= 15 ? 1 : 2) as 1 | 2;
    const { desde, hasta } = rangoQuincena(hoy.getFullYear(), hoy.getMonth() + 1, quincenaActual);
    const [empleados, registros, ajustes] = await Promise.all([
      readSheet<Empleado>('Empleados').catch(() => []),
      leerFichajesCache(desde.slice(0, 10), hasta.slice(0, 10)),
      readSheet<PersonalQuincena>('PersonalQuincena').catch(() => []),
    ]);
    const ajustesMap: Record<string, { presentismoManual?: 'SI' | 'NO' | '' }> = {};
    for (const a of ajustes) {
      if (String(a.anio) === String(hoy.getFullYear()) && String(a.mes) === String(hoy.getMonth() + 1) && String(a.quincena) === String(quincenaActual)) {
        ajustesMap[String(a.workno)] = { presentismoManual: a.presentismo_manual };
      }
    }
    const resumenPersonal = calcularResumenQuincena(registros, empleados, hoy.getFullYear(), hoy.getMonth() + 1, quincenaActual, ajustesMap);
    const tardanzas = tardanzasDeHoy(resumenPersonal);
    return NextResponse.json({ tardanzas });
  } catch (err: any) {
    // Si la hoja de caché todavía no existe o falla la lectura, el banner simplemente no
    // aparece — no debe romper nada del resto del home.
    return NextResponse.json({ tardanzas: [], error: err?.message || 'error' });
  }
}
