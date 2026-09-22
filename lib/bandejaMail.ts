// ── De un mail a un candidato de la bandeja ──────────────────────────────────────────
//
// Lo usan los dos caminos que traen avisos de pago: el que pega el texto a mano y el
// webhook del correo reenviado. Vive acá para que los dos entren EXACTAMENTE igual — si
// se comportaran distinto, la bandeja tendría dos clases de filas y ninguna confiable.
//
// SEGURIDAD: el contenido de un mail es texto que manda un tercero. De acá nunca sale una
// acción: sale un CANDIDATO que una persona confirma. Nada de lo que diga el mail puede
// registrar un cobro en Xubio, elegir un cliente por sí solo ni cambiar una configuración.
// Esa es toda la protección que hace falta y es la razón por la que la bandeja existe.

import { appendRowObj, asegurarHoja, readSheet } from './sheets';
import { parsearAvisoPago } from './avisosPago';
import { extraerAvisoConIA, type PdfAdjunto, type ClienteParaIA } from './extraerAvisoIA';
import { hashMovimiento } from './importacionBanco';
import { fechaArgentinaHoy } from './ocupacion';
import {
  HOJA_BANDEJA, HEADERS_BANDEJA, HOJA_ALIAS,
  proponerCliente, nuevoIdItem, type ItemBandeja, type AliasCobranza,
} from './bandejaCobranzas';
import { nombreClienteVisible } from './clientes';
import type { ClienteVenta } from './types';

// Gmail no reenvía a una dirección nueva hasta que se confirma con un código que manda a
// esa misma dirección. Ese mail cae en el webhook como cualquier otro, y si se lo tratara
// como aviso de pago el código quedaría enterrado en una fila de $0. Se detecta y se
// guarda aparte para poder leerlo desde la pantalla, que es el único lugar donde se lo
// puede ver: nadie tiene acceso a la casilla de Resend.
const PISTAS_CONFIRMACION = [
  'forwarding confirmation', 'confirmacion de reenvio', 'confirmación de reenvío',
  'verify your forwarding', 'reenvío de gmail', 'reenvio de gmail', 'confirm forwarding',
];

const sinAcentos = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function esConfirmacionDeReenvio(asunto: string, texto: string): boolean {
  const t = sinAcentos(`${asunto} ${texto}`);
  return PISTAS_CONFIRMACION.some(p => t.includes(sinAcentos(p)));
}

// El código de confirmación de Gmail son 9 dígitos sueltos.
export function codigoConfirmacion(texto: string): string | null {
  const m = String(texto || '').match(/\b(\d{9})\b/);
  return m ? m[1] : null;
}

// HTML a texto plano, para cuando el mail no trae versión de texto. No pretende ser un
// renderizador: solo tiene que dejar los números y las palabras en el orden en que están.
export function htmlATexto(html: string): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export interface ResultadoItemAviso {
  ok: boolean;
  motivo?: 'duplicado' | 'sin_importe' | 'confirmacion';
  idItem?: string;
  importe?: number | null;
  comprobantes?: string[];
  cliente?: string;
  codigo?: string | null;
  // Cómo se leyó el aviso, para poder decirlo en el acuse: con los patrones de siempre o
  // con la IA. Importa porque la confianza es distinta y el costo también.
  leidoCon?: 'patrones' | 'ia';
  confianza?: 'alta' | 'media' | 'baja';
  comentarioIA?: string;
}

export async function crearItemDesdeAviso(args: {
  texto: string;
  asunto?: string;
  remitente?: string;
  origen?: 'mail' | 'manual';
  usuario: string;
  importeForzado?: number;
  fechaForzada?: string;
  pdfs?: PdfAdjunto[];
}): Promise<ResultadoItemAviso> {
  const texto = String(args.texto || '');
  const asunto = String(args.asunto || '');

  await asegurarHoja(HOJA_BANDEJA, HEADERS_BANDEJA);
  const previos = await readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]);
  const hoy = fechaArgentinaHoy();

  // Confirmación de reenvío: se guarda para poder leer el código, no como cobro.
  if (esConfirmacionDeReenvio(asunto, texto)) {
    // El código puede venir en el asunto —Gmail lo pone como "(#123456789)"— y no en el
    // cuerpo, así que se busca en los dos.
    const codigo = codigoConfirmacion(`${asunto} ${texto}`);
    const hash = hashMovimiento(hoy, 0, `confirmacion ${codigo || asunto}`);
    if (previos.some(p => String(p.hash) === hash)) return { ok: false, motivo: 'duplicado', codigo };
    const idItem = nuevoIdItem(previos);
    await appendRowObj(HOJA_BANDEJA, {
      id_item: idItem, fecha_importacion: hoy, origen: 'setup', fecha: hoy, importe: 0,
      descripcion: `${codigo ? `CÓDIGO: ${codigo} — ` : ''}Confirmación de reenvío de Gmail · ${asunto} · ${texto.replace(/\s+/g, ' ').slice(0, 400)}`,
      hash, id_control: '', cliente: '', comprobantes: '', estado: 'pendiente', id_cobro: '',
      usuario: args.usuario, nota: 'confirmación de reenvío',
    });
    return { ok: true, motivo: 'confirmacion', idItem, codigo };
  }

  const leido = parsearAvisoPago(`${asunto}\n${texto}`);

  // Los clientes se leen antes que nada: hacen falta para el matcheo por texto y, si hay
  // que llamar a la IA, para que pueda elegir de la lista.
  const [clientes, aliases] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]),
  ]);

  let comprobantes = leido.comprobantes;
  let retencion = leido.retencion;
  let importe = args.importeForzado && args.importeForzado > 0 ? args.importeForzado : leido.importe;
  let leidoCon: 'patrones' | 'ia' = 'patrones';
  let confianza: 'alta' | 'media' | 'baja' | undefined;
  let comentarioIA = '';
  let pagador = '';
  let fechaIA = '';

  // Matcheo por texto primero: alias aprendidos y nombres. Es gratis y determinístico.
  let cand = proponerCliente(`${args.remitente || ''} ${asunto} ${texto}`, clientes, aliases);

  // Se llama a la IA cuando falta el importe O cuando no se reconoció al cliente. Lo
  // segundo importa tanto como lo primero: el nombre del aviso casi nunca es el que usamos
  // —"NAF S.R.L." es Mamina— y ningún matcheo por texto va a unir esas dos cosas.
  const faltaImporte = !(Number(importe) > 0);
  if (faltaImporte || !cand) {
    const paraIA: ClienteParaIA[] = clientes
      .filter(c => String(c.activo || '').toUpperCase() !== 'NO')
      .map(c => ({
        id: String(c.id_control),
        nombre: nombreClienteVisible(c),
        razonSocial: String(c.nombre_xubio || ''),
        alias: String(c.alias || ''),
        sucursales: String(c.sucursales || ''),
      }));

    const ia = await extraerAvisoConIA({
      texto, asunto, remitente: args.remitente, pdfs: args.pdfs, clientes: paraIA,
    });

    if (ia) {
      comentarioIA = [ia.comentario, ia.razonDelCliente].filter(Boolean).join(' · ');
      if (faltaImporte && Number(ia.importe) > 0) {
        importe = ia.importe;
        if (ia.comprobantes.length) comprobantes = ia.comprobantes;
        if (ia.retencion) retencion = ia.retencion;
        if (ia.fecha) fechaIA = ia.fecha;
        leidoCon = 'ia';
        confianza = ia.confianza;
      }
      pagador = ia.nombrePagador || '';
      // El cliente que eligió la IA solo se usa si el matcheo por texto no encontró nada:
      // un alias confirmado por una persona vale más que una deducción del modelo.
      if (!cand && ia.idCliente) {
        const cli = clientes.find(c => String(c.id_control) === String(ia.idCliente));
        if (cli) {
          cand = { id_control: String(cli.id_control), cliente: nombreClienteVisible(cli), confianza: 'nombre' };
          leidoCon = 'ia';
        }
      }
    }
  }

  if (!(Number(importe) > 0)) return { ok: false, motivo: 'sin_importe', comentarioIA };

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(args.fechaForzada || ''))
    ? String(args.fechaForzada)
    : (leido.fecha || fechaIA || hoy);

  const hash = hashMovimiento(fecha, Number(importe), `aviso ${comprobantes.join(',')}`);
  if (previos.some(p => String(p.hash) === hash)) return { ok: false, motivo: 'duplicado' };

  // Último intento por texto con el nombre que sacó la IA del PDF: cuando el pagador figura
  // solo ahí adentro, es el único lugar donde aparece.
  if (!cand && pagador) cand = proponerCliente(pagador, clientes, aliases);

  const descripcion = [
    args.remitente ? `De ${args.remitente}` : '',
    asunto || 'Aviso de pago',
    comprobantes.length ? `facturas ${comprobantes.join(', ')}` : '',
    retencion ? `retención ${retencion}` : '',
    leidoCon === 'ia' ? `leído con IA (confianza ${confianza})` : '',
    texto.replace(/\s+/g, ' ').slice(0, 140),
  ].filter(Boolean).join(' · ');

  const idItem = nuevoIdItem(previos);
  await appendRowObj(HOJA_BANDEJA, {
    id_item: idItem,
    fecha_importacion: hoy,
    origen: args.origen || 'mail',
    fecha,
    importe: Math.round(Number(importe) * 100) / 100,
    descripcion,
    hash,
    id_control: cand?.id_control || '',
    cliente: cand?.cliente || '',
    comprobantes: comprobantes.join(', '),
    estado: 'pendiente',
    id_cobro: '',
    usuario: args.usuario,
    nota: cand ? `reconocido por ${cand.confianza}${leidoCon === 'ia' ? ' (IA)' : ''}` : 'sin reconocer al cliente',
  });

  return {
    ok: true, idItem, importe: Number(importe),
    comprobantes, cliente: cand?.cliente,
    leidoCon, confianza, comentarioIA,
  };
}
