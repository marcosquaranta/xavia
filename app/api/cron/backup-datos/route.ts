import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { enviarBackupPorMail } from '@/lib/backupDatos';

export const dynamic = 'force-dynamic';
// Leer 23 hojas seguidas y armar los adjuntos lleva su tiempo.
export const maxDuration = 300;

// Backup automático de la planilla por mail (ver lib/backupDatos.ts). Lo dispara Vercel
// Cron una vez por semana, y también puede correrlo un admin a mano cuando quiera una
// copia al momento (antes de una migración, de tocar datos a mano, etc.).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await enviarBackupPorMail();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
