import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { HOJA_BANDEJA, type ItemBandeja } from '@/lib/bandejaCobranzas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Devuelve un adjunto del mail que originó un item de la bandeja, para poder MIRARLO desde
// la app cuando la IA no pudo sacar el dato.
//
// No se guarda el archivo: se vuelve a pedir a Resend por el `email_id` de la fila. Una
// imagen no entra en una celda de planilla, y guardarla en base64 sería llenar la hoja de
// texto ilegible que además la haría pesadísima de leer en cada consulta.
//
// La contracara es que depende de que Resend todavía lo tenga. Cuando no está, se dice con
// todas las letras en vez de devolver una imagen rota: la diferencia entre "el mail no traía
// adjunto" y "el adjunto ya no se puede recuperar" cambia qué hace la persona después.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  // Un aviso de pago es información de plata: mismo criterio que el resto de cobranzas.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver esto.' }, { status: 403 });

  const idItem = String(req.nextUrl.searchParams.get('item') || '').trim();
  const n = Number(req.nextUrl.searchParams.get('n') || 0);
  if (!idItem) return NextResponse.json({ error: 'falta el item' }, { status: 400 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 });

  try {
    const filas = await readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]);
    const fila = filas.find((f) => String(f.id_item) === idItem);
    if (!fila) return NextResponse.json({ error: 'No se encontró ese movimiento.' }, { status: 404 });

    const emailId = String((fila as any).email_id || '').trim();
    if (!emailId) {
      return NextResponse.json({ error: 'Este movimiento no vino por mail, o entró antes de que se guardara la referencia al adjunto.' }, { status: 404 });
    }

    const lista = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
    });
    if (!lista.ok) {
      return NextResponse.json({ error: `No se pudieron listar los adjuntos del mail (${lista.status}). Puede que ya no estén disponibles.` }, { status: 502 });
    }
    const j: any = await lista.json();
    const items: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    const adj = items[n];
    if (!adj?.download_url) return NextResponse.json({ error: 'Ese adjunto ya no está disponible.' }, { status: 404 });

    const bin = await fetch(String(adj.download_url), { cache: 'no-store' });
    if (!bin.ok) return NextResponse.json({ error: 'No se pudo bajar el adjunto.' }, { status: 502 });
    const buf = Buffer.from(await bin.arrayBuffer());

    const tipo = String(adj.content_type || '').toLowerCase() || 'application/octet-stream';
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': tipo,
        // inline: la idea es mirarlo en la misma pantalla, no bajarlo para abrirlo aparte.
        'Content-Disposition': `inline; filename="${String(adj.filename || 'adjunto').replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
