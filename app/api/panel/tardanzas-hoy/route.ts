import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { getRegistrosCrossChex } from '@/lib/crosschex';
import { calcularResumenQuincena, rangoQuincena, tardanzasDeHoy } from '@/lib/personal';
import type { Empleado, PersonalQuincena } from '@/lib/types';

export const dynamic = 'force-dynamic';
// CrossChex limita a 1 pedido cada 15s (ver lib/crosschex.ts) — un token+datos "en frío"
// puede tardar ~15-20s, más que el timeout por defecto de la función serverless.
export const maxDuration = 60;

// Tardanzas DE HOY (no de toda la quincena) para el banner del home — separado del
// render principal del Panel (antes vivía ahí adentro, bloqueando la carga de TODA la
// página ~15-20s por el límite real de CrossChex). El Panel ahora carga instantáneo y
// este dato se trae aparte, desde un componente cliente (ver TardanzasHoyBanner.tsx).
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
      getRegistrosCrossChex(desde, hasta),
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
    // Si CrossChex está caído o tarda, el banner simplemente no aparece — no debe romper
    // nada del resto del home, que ya terminó de renderizar hace rato.
    return NextResponse.json({ tardanzas: [], error: err?.message || 'error' });
  }
}
