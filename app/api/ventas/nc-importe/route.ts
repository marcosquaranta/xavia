import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { lineasDeFactura, emitirNCPorImporte } from '@/lib/ncComercial';
import { lineasParaCredito } from '@/lib/ncPorImporte';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Nota de crédito por un importe acordado ──────────────────────────────────────────
//
// El caso: un cliente reclama un porcentaje sobre una factura por acuerdo comercial. Las
// cantidades están bien, lo que cambia es lo que se cobra. Ver lib/ncComercial.ts.
//
// GET  = la previa: cuánto dice la factura y cómo quedaría la NC. No emite nada.
// POST = emite. Sale en AFIP y no se deshace.

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede emitir notas de crédito.' }, { status: 403 });

  const url = new URL(req.url);
  const numero = String(url.searchParams.get('numero') || '').trim();
  const base = await lineasDeFactura(numero);
  if (!base.ok) return NextResponse.json({ ok: false, error: base.error }, { status: 400 });

  // Con `importe_final` se devuelve además cómo quedaría la NC, para poder mostrarlo antes
  // de emitir. Es el mismo cálculo que hace el POST: si acá se repartiera distinto, la
  // previa mostraría una cosa y se emitiría otra.
  const finalPedido = url.searchParams.get('importe_final');
  let previa = null as any;
  if (finalPedido !== null) {
    const aCreditar = Math.round((base.total - (Number(finalPedido) || 0)) * 100) / 100;
    const rep = lineasParaCredito(base.lineas, aCreditar);
    previa = rep.ok
      ? { ok: true, acreditar: rep.importe, porcentaje: rep.porcentaje, renglones: rep.lineas.length }
      : { ok: false, error: rep.error };
  }

  return NextResponse.json({
    ok: true,
    numero,
    importeFactura: Math.round(base.total),
    cliente: base.cliente?.nombre_display || base.cliente?.nombre_xubio || '',
    renglones: base.lineas.length,
    previa,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede emitir notas de crédito.' }, { status: 403 });

  try {
    const { numero, importe_final, motivo } = await req.json();
    const r = await emitirNCPorImporte({
      numeroFactura: String(numero || ''),
      importeFinal: Number(importe_final),
      motivo: String(motivo || ''),
      usuario: user.email,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
