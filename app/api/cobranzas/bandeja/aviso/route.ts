import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parsearAvisoPago } from '@/lib/avisosPago';
import { crearItemDesdeAviso } from '@/lib/bandejaMail';
import { readSheet } from '@/lib/sheets';
import { HOJA_ALIAS, proponerCliente, type AliasCobranza } from '@/lib/bandejaCobranzas';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Aviso de pago pegado a mano. Con `soloLeer` no escribe nada: devuelve lo que entendió
// para mostrarlo antes de crear la fila — si el importe salió mal, corregirlo ahí es más
// barato que arreglar una fila que ya existe.
//
// Lo que crea la fila es crearItemDesdeAviso, el mismo que usa el correo reenviado: dos
// caminos distintos hacia la bandeja tendrían que comportarse igual, y la única forma de
// garantizarlo es que sean el mismo código.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cargar avisos de pago.' }, { status: 403 });
  try {
    const body = await req.json();
    const texto = String(body.texto || '').trim();
    if (texto.length < 10) return NextResponse.json({ error: 'Pegá el aviso de pago completo.' }, { status: 400 });

    if (body.soloLeer === true) {
      const leido = parsearAvisoPago(texto);
      const [clientes, aliases] = await Promise.all([
        readSheet<ClienteVenta>('Clientes'),
        readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]),
      ]);
      const cand = proponerCliente(texto, clientes, aliases);
      return NextResponse.json({
        ok: true, leido, cliente: cand,
        importe: leido.importe,
        fecha: leido.fecha || fechaArgentinaHoy(),
      });
    }

    const r = await crearItemDesdeAviso({
      texto,
      origen: 'manual',
      usuario: user.email,
      importeForzado: Number(body.importe) || 0,
      fechaForzada: String(body.fecha || ''),
    });
    if (!r.ok) {
      const msg = r.motivo === 'duplicado'
        ? 'Ese aviso ya está en la bandeja.'
        : 'No se pudo reconocer el importe. Escribilo a mano y volvé a intentar.';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id_item: r.idItem, comprobantes: r.comprobantes, cliente: r.cliente });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
