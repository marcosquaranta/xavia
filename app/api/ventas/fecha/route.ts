import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  const fecha = req.nextUrl.searchParams.get('fecha') || '';
  const idExp = req.nextUrl.searchParams.get('id_exportacion') || '';
  const ventas = await readSheet<VentaDia>('Ventas');
  if (idExp) {
    // Cargar una exportación específica para re-editar
    return NextResponse.json(ventas.filter(v => v.exportado === idExp));
  }
  // Solo filas no exportadas (sesión actual)
  return NextResponse.json(ventas.filter(v => v.fecha === fecha && (!v.exportado || v.exportado === '')));
}
