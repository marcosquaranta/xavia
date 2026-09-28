import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { marcarSaldadas, revertirSaldada } from '@/lib/facturasSaldadas';

// Marcar facturas como saldadas sin generar ningún movimiento en Xubio, y deshacerlo.
//
// Es admin y nada más: dar una factura por cobrada la saca de los reclamos y de las
// opciones al imputar, así que no es una preferencia de pantalla, es una decisión sobre
// plata que se deja de perseguir.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const body = await req.json();

    if (body?.accion === 'revertir') {
      const numero = String(body?.numero || '').trim();
      if (!numero) return NextResponse.json({ error: 'Falta el número de factura.' }, { status: 400 });
      await revertirSaldada(numero, user.email);
      return NextResponse.json({ ok: true, mensaje: `${numero} vuelve a la lista de pendientes.` });
    }

    const facturas = Array.isArray(body?.facturas) ? body.facturas : [];
    if (!facturas.length) return NextResponse.json({ error: 'No se eligió ninguna factura.' }, { status: 400 });
    // El motivo es obligatorio a propósito: dentro de seis meses, "por qué esta factura no
    // se reclama más" no se puede reconstruir de ningún otro lado.
    const motivo = String(body?.motivo || '').trim();
    if (!motivo) return NextResponse.json({ error: 'Escribí por qué se dan por saldadas.' }, { status: 400 });

    const r = await marcarSaldadas({ facturas, motivo, usuario: user.email });
    const partes = [`${r.marcadas} ${r.marcadas === 1 ? 'factura marcada' : 'facturas marcadas'} como saldadas`];
    if (r.yaEstaban) partes.push(`${r.yaEstaban} ya estaban`);
    return NextResponse.json({ ok: true, ...r, mensaje: `${partes.join(' · ')}. No se registró ningún movimiento en Xubio.` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo guardar.' }, { status: 500 });
  }
}
