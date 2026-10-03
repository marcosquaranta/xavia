import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { enviarInformeFacturacion } from '@/lib/informeFacturacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Control de facturación por mail: lo que salió sin facturar y las diferencias contra
// Xubio. Va aparte del reporte semanal a propósito — ver lib/informeFacturacion.ts.
//
// Lo dispara el cron los lunes, y también se puede pedir a mano desde Facturación.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await enviarInformeFacturacion();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
