import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { nombreClienteVisible } from '@/lib/clientes';
import { detallePendientePorDia, enviarPendientePorDia } from '@/lib/facturacionEmitir';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Informe de lo que está pendiente de facturar de un cliente, día por día y con la FECHA
// ORIGINAL de cada entrega — no con la fecha del comprobante, que puede ser muy posterior
// cuando se acumuló atraso. Con { enviar: true } además se lo manda por mail al cliente.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control, enviar } = await req.json();
    if (!id_control) return NextResponse.json({ error: 'id_control requerido' }, { status: 400 });

    const [clientes, precios, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
    ]);
    const cliente = clientes.find(c => String(c.id_control) === String(id_control));
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

    const dias = detallePendientePorDia(ventas, precios, cliente);
    if (!dias.length) return NextResponse.json({ error: 'Ese cliente no tiene ventas pendientes de facturar' }, { status: 400 });

    const nombre = nombreClienteVisible(cliente) || String(id_control);
    if (!enviar) return NextResponse.json({ ok: true, cliente: nombre, dias });

    const email = String(cliente.email || '').trim();
    if (!email) return NextResponse.json({ error: `${nombre} no tiene mail cargado. Cargalo en Clientes o copiá el detalle y mandalo a mano.` }, { status: 400 });

    const ok = await enviarPendientePorDia(email, cliente.nombre_display || nombre, dias);
    if (!ok) return NextResponse.json({ error: 'No se pudo enviar el mail (revisá la configuración de envío)' }, { status: 502 });
    return NextResponse.json({ ok: true, cliente: nombre, dias, enviadoA: email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
