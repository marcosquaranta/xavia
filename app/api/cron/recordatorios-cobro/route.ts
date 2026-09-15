import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { correrRecordatoriosCobro } from '@/lib/recordatoriosCobro';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Recordatorios de cobro semanales (ver lib/recordatoriosCobro.ts). Lo dispara Vercel Cron
// los lunes a la mañana con las facturas de la semana; un admin también puede correrlo a
// mano desde /cobranzas, y con ?simular=1 ve qué saldría sin que se mande nada.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const admin = await isAdmin();
  if (!esCron && !admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Simular es solo para el admin logueado: el cron nunca simula, manda.
  const params = new URL(req.url).searchParams;
  const soloSimular = admin && params.get('simular') === '1';
  // Envío puntual a un cliente, sin esperar al lunes. Solo para admin logueado: el cron
  // nunca manda a un cliente suelto, manda la corrida completa.
  const soloCliente = admin ? (params.get('cliente') || '') : '';
  // Insistir: re-reclamar facturas que ya se reclamaron. Solo con cliente puntual y admin —
  // el cron nunca insiste, si no repetiría todo a todos cada lunes.
  const reclamarDeNuevo = admin && !!soloCliente && params.get('insistir') === '1';
  const r = await correrRecordatoriosCobro({ soloSimular, soloCliente, reclamarDeNuevo, usuario: admin ? 'admin' : 'cron' });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
