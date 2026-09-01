import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { enviarAvisoCaeAcumulado } from '@/lib/caePendientes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Aviso diario de CAEs pendientes, con todo lo emitido que todavía no se avisó (ver
// lib/caePendientes.ts). Lo dispara Vercel Cron a las 8 de la mañana; un admin también
// puede correrlo a mano si quiere el listado al momento.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await enviarAvisoCaeAcumulado();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
