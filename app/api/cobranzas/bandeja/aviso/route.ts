import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarHoja, readSheet } from '@/lib/sheets';
import { parsearAvisoPago } from '@/lib/avisosPago';
import {
  HOJA_BANDEJA, HEADERS_BANDEJA, HOJA_ALIAS,
  proponerCliente, nuevoIdItem,
  type ItemBandeja, type AliasCobranza,
} from '@/lib/bandejaCobranzas';
import { hashMovimiento } from '@/lib/importacionBanco';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Lee un aviso de pago pegado (mail o WhatsApp) y lo deja en la bandeja como candidato.
//
// Con `soloLeer` no escribe nada: devuelve lo que entendió, para poder mostrarlo antes de
// agregarlo. El que carga tiene que ver qué se interpretó ANTES de que la fila exista —
// si el importe salió mal, corregirlo después es más trabajo que no haberlo creado.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cargar avisos de pago.' }, { status: 403 });
  try {
    const body = await req.json();
    const texto = String(body.texto || '').trim();
    const soloLeer = body.soloLeer === true;
    if (texto.length < 10) return NextResponse.json({ error: 'Pegá el aviso de pago completo.' }, { status: 400 });

    const leido = parsearAvisoPago(texto);
    const clientes = await readSheet<ClienteVenta>('Clientes');
    const aliases = await readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]);
    const cand = proponerCliente(texto, clientes, aliases);

    // El importe puede venir corregido a mano desde la pantalla: si el aviso trae varios
    // números, el que eligió la app no siempre es el bueno.
    const importe = Number(body.importe) > 0 ? Number(body.importe) : leido.importe;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) ? String(body.fecha) : (leido.fecha || fechaArgentinaHoy());

    if (soloLeer) {
      return NextResponse.json({ ok: true, leido, cliente: cand, importe, fecha });
    }

    if (!(Number(importe) > 0)) {
      return NextResponse.json({ error: 'No se pudo reconocer el importe. Escribilo a mano y volvé a intentar.' }, { status: 400 });
    }

    await asegurarHoja(HOJA_BANDEJA, HEADERS_BANDEJA);
    const previos = await readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]);

    // La identidad de un aviso es su fecha + importe + las facturas que menciona. Sin esto,
    // reenviar el mismo mail dos veces crearía dos candidatos por el mismo pago.
    const hash = hashMovimiento(fecha, Number(importe), `aviso ${leido.comprobantes.join(',')}`);
    if (previos.some(p => String(p.hash) === hash)) {
      return NextResponse.json({ error: 'Ese aviso ya está en la bandeja.' }, { status: 400 });
    }

    const descripcion = [
      'Aviso de pago',
      leido.comprobantes.length ? `facturas ${leido.comprobantes.join(', ')}` : '',
      leido.retencion ? `retención ${leido.retencion}` : '',
      texto.replace(/\s+/g, ' ').slice(0, 140),
    ].filter(Boolean).join(' · ');

    const idItem = nuevoIdItem(previos);
    await appendRowObj(HOJA_BANDEJA, {
      id_item: idItem,
      fecha_importacion: fechaArgentinaHoy(),
      origen: 'mail',
      fecha,
      importe: Math.round(Number(importe) * 100) / 100,
      descripcion,
      hash,
      id_control: cand?.id_control || '',
      cliente: cand?.cliente || '',
      // Las facturas del aviso quedan propuestas desde el arranque: es lo que el resumen
      // del banco nunca va a poder decir, y es la mitad del trabajo de imputar.
      comprobantes: leido.comprobantes.join(', '),
      estado: 'pendiente',
      id_cobro: '',
      usuario: user.email,
      nota: cand ? `reconocido por ${cand.confianza}` : 'sin reconocer al cliente',
    });

    return NextResponse.json({ ok: true, id_item: idItem, leido, cliente: cand });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
