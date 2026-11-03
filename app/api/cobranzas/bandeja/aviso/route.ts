import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parsearAvisoPago } from '@/lib/avisosPago';
import { crearItemDesdeAviso } from '@/lib/bandejaMail';
import { extraerAvisoConIA, clientesParaIA, type AdjuntoIA } from '@/lib/extraerAvisoIA';
import { nombreClienteVisible } from '@/lib/clientes';
import { readSheet } from '@/lib/sheets';
import { HOJA_ALIAS, proponerCliente, type AliasCobranza } from '@/lib/bandejaCobranzas';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';

// ── Las imágenes que se pegan a mano ─────────────────────────────────────────────────
//
// La mitad de los avisos no son texto: son una captura de la transferencia o una foto de la
// orden de pago. El lector con IA ya sabía leerlas —lo hace con los adjuntos del correo
// reenviado desde el principio—, pero por esta puerta no había forma de entregárselas, así
// que al pegar una foto había que transcribir el importe a mano.
//
// Se acota acá y no solo en la pantalla: el navegador se puede saltear. Cinco adjuntos es lo
// mismo que lee el camino del correo, y 4 MB es el techo real del cuerpo de un pedido en
// Vercel — más que eso falla con un error de red que no explica nada.
const MAX_ADJUNTOS = 5;
const MAX_BYTES = 4 * 1024 * 1024;

function adjuntosDelPedido(crudo: any): { adjuntos: AdjuntoIA[]; error?: string } {
  if (!Array.isArray(crudo) || crudo.length === 0) return { adjuntos: [] };
  if (crudo.length > MAX_ADJUNTOS) return { adjuntos: [], error: `Máximo ${MAX_ADJUNTOS} imágenes por aviso.` };
  const adjuntos: AdjuntoIA[] = [];
  let bytes = 0;
  for (const a of crudo) {
    const tipo = String(a?.tipo || '').toLowerCase();
    const base64 = String(a?.base64 || '');
    if (!base64) continue;
    // Solo lo que el modelo sabe leer. Un .docx o un .zip acá no daría un error claro: daría
    // una lectura vacía, que es peor porque parece que el aviso no decía nada.
    if (!tipo.startsWith('image/') && !tipo.includes('pdf')) {
      return { adjuntos: [], error: `"${a?.nombre || 'el archivo'}" no es una imagen ni un PDF.` };
    }
    bytes += Math.ceil(base64.length * 0.75);
    if (bytes > MAX_BYTES) return { adjuntos: [], error: 'Las imágenes pesan demasiado juntas. Probá con una por vez.' };
    adjuntos.push({ nombre: String(a?.nombre || 'adjunto'), base64, tipo });
  }
  return { adjuntos };
}

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
    const { adjuntos, error: errAdj } = adjuntosDelPedido(body.adjuntos);
    if (errAdj) return NextResponse.json({ error: errAdj }, { status: 400 });
    // Una imagen sola es un aviso completo: la captura de la transferencia dice el importe,
    // la fecha y a veces las facturas. Exigir texto además sería pedir que se transcriba lo
    // que justamente se quiere no transcribir.
    if (texto.length < 10 && adjuntos.length === 0) {
      return NextResponse.json({ error: 'Pegá el aviso de pago completo, o una imagen del comprobante.' }, { status: 400 });
    }

    if (body.soloLeer === true) {
      const porPatrones = parsearAvisoPago(texto);
      const [clientes, aliases] = await Promise.all([
        readSheet<ClienteVenta>('Clientes'),
        readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]),
      ]);
      let cand = proponerCliente(texto, clientes, aliases);
      let leido = porPatrones;

      // ── Con imagen, lee la IA ──────────────────────────────────────────────────────
      //
      // Los patrones trabajan sobre texto, y acá puede no haber ninguno: una captura es un
      // archivo, no palabras. Se llama a la MISMA función que usa el correo reenviado, así
      // que lo que se ve en la vista previa es lo que va a entender después el camino que
      // escribe la fila. El importe que salga de acá viaja como `importe` al confirmar, de
      // modo que lo que la pantalla muestra es exactamente lo que se guarda.
      if (adjuntos.length > 0) {
        const ia = await extraerAvisoConIA({
          texto, pdfs: adjuntos, clientes: clientesParaIA(clientes),
        });
        if (ia) {
          leido = {
            // Lo de la IA gana solo donde los patrones no encontraron nada: si el texto
            // pegado traía el importe, ese ya está confirmado por dos lecturas.
            importe: porPatrones.importe ?? ia.importe,
            fecha: porPatrones.fecha ?? ia.fecha,
            comprobantes: porPatrones.comprobantes.length ? porPatrones.comprobantes : ia.comprobantes,
            importesEncontrados: porPatrones.importesEncontrados,
            retencion: porPatrones.retencion ?? ia.retencion,
          };
          if (!cand && ia.idCliente) {
            const cli = clientes.find(c => String(c.id_control) === String(ia.idCliente));
            if (cli) cand = { id_control: String(cli.id_control), cliente: nombreClienteVisible(cli), confianza: 'nombre' };
          }
        }
      }

      return NextResponse.json({
        ok: true, leido, cliente: cand,
        importe: leido.importe,
        fecha: leido.fecha || fechaArgentinaHoy(),
        // La pantalla avisa si la imagen no se pudo leer, en vez de mostrar todo en cero
        // como si el comprobante no dijera nada.
        leyoImagen: adjuntos.length > 0,
      });
    }

    const r = await crearItemDesdeAviso({
      texto,
      origen: 'manual',
      usuario: user.email,
      importeForzado: Number(body.importe) || 0,
      fechaForzada: String(body.fecha || ''),
      pdfs: adjuntos,
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
