import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

// Soft delete: antes borraba el Lote y todos sus Movimientos de la planilla (irreversible,
// y arrastraba cualquier venta/stock/informe que ya referenciara ese lote). Ahora solo
// marca estado='borrado' — el lote y su historial quedan intactos pero afuera de todos los
// filtros normales (activo/cosechado), así que no vuelve a contar en nada. Restaurable
// desde Mis Cultivos → filtro "Borrados" (ver /api/lotes/restaurar).
export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    if (!idLote) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    await updateRow('Lotes', 'id_lote', idLote, { estado: 'borrado' });
    return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  } catch (err: any) { console.error('Error borrando:', err); return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 }); }
}