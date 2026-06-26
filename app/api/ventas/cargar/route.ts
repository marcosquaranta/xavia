import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import { enviarResumenPendientes } from '@/lib/resumenFacturacion';
import type { VentaDia } from '@/lib/types';

const QTY_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg'];

// Marca las ventas borrador de una fecha como PENDIENTE (acumuladas para facturar)
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha } = await req.json();
    if (!fecha) return NextResponse.json({ error: 'fecha requerida' }, { status: 400 });

    const ventas = await readSheet<VentaDia>('Ventas');
    const aCargar = ventas.filter(v =>
      v.fecha === fecha &&
      (!v.exportado || v.exportado === '') &&
      QTY_KEYS.some(k => Number((v as any)[k]) > 0)
    );
    if (!aCargar.length) return NextResponse.json({ error: 'No hay ventas para cargar en esa fecha' }, { status: 400 });

    await batchUpdateRows('Ventas', 'id_venta', aCargar.map(v => ({
      keyValue: v.id_venta,
      updates: { exportado: 'PENDIENTE' },
    })));

    // Enviar el resumen de pendientes por mail (no bloquea la respuesta si falla)
    let mail = false;
    try { const r = await enviarResumenPendientes(); mail = !!r.ok && (r.facturas || 0) > 0; } catch {}

    const clientes = new Set(aCargar.map(v => v.id_control)).size;
    return NextResponse.json({ ok: true, lineas: aCargar.length, clientes, mail });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
