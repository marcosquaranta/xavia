import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  const fecha = req.nextUrl.searchParams.get('fecha') || '';
  const ventas = await readSheet<VentaDia>('Ventas');
  return NextResponse.json(ventas.filter(v => v.fecha === fecha));
}
