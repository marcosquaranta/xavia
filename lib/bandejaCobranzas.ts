// ── Bandeja de cobranzas ─────────────────────────────────────────────────────────────
//
// Una sola cola de cobros por confirmar, alimentada por varias fuentes (hoy el resumen
// bancario; más adelante mails y cheques). Cada fila es un movimiento de plata que entró y
// que todavía no se imputó: la app propone de quién es y qué facturas cancela, y una
// persona confirma.
//
// Por qué una bandeja y no imputación automática: el trabajo pesado no es leer el resumen,
// es decidir a qué cliente y a qué facturas corresponde cada movimiento. Eso se propone,
// no se decide solo — un cobro mal imputado ensucia la contabilidad y hay que ir a Xubio a
// borrarlo.

import type { ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';

export const HOJA_BANDEJA = 'CobranzasBandeja';
export const HEADERS_BANDEJA = [
  'id_item', 'fecha_importacion', 'origen', 'fecha', 'importe', 'descripcion',
  'hash', 'id_control', 'cliente', 'comprobantes', 'estado', 'id_cobro', 'usuario', 'nota',
];

// Aliases aprendidos: cómo aparece un cliente en el resumen del banco. El banco muestra la
// razón social o hasta el nombre de una persona, casi nunca el nombre con el que se lo
// conoce puertas adentro. Cada confirmación deja el alias guardado, así el mismo ordenante
// se reconoce solo la próxima vez.
export const HOJA_ALIAS = 'CobranzasAlias';
export const HEADERS_ALIAS = ['alias', 'id_control', 'cliente', 'fecha_aprendido', 'usuario'];

export type EstadoItem = 'pendiente' | 'confirmado' | 'descartado';
export type OrigenItem = 'banco' | 'mail' | 'cheque' | 'manual';

export interface ItemBandeja {
  id_item: string;
  fecha_importacion: string;
  origen: OrigenItem | string;
  fecha: string;          // del movimiento
  importe: number | string;
  descripcion: string;
  hash: string;
  id_control: string;
  cliente: string;
  comprobantes: string;   // separados por coma, cuando se confirma
  estado: EstadoItem | string;
  id_cobro: string;       // el cobro registrado en Xubio, si se confirmó
  usuario: string;
  nota: string;
}

export interface AliasCobranza {
  alias: string;
  id_control: string;
  cliente: string;
  fecha_aprendido: string;
  usuario: string;
}

export const normalizarNombre = (v: any) => String(v ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Palabras que aparecen en casi todos los nombres y en casi todas las descripciones del
// banco: si se las deja, "S.A." matchea con cualquier cosa.
const RUIDO = new Set([
  'SA', 'SRL', 'SAS', 'SACIF', 'SH', 'S', 'A', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y',
  'TRANSFERENCIA', 'TRANSF', 'RECIBIDA', 'PAGO', 'DEPOSITO', 'CREDITO', 'ACREDITACION',
  'CUENTA', 'CTA', 'VARIOS', 'INMEDIATA', 'INTERBANCARIA', 'DESDE', 'POR', 'REF',
]);

// Largo mínimo de una palabra para que sirva como identificador. Tres letras alcanzan
// porque la comparación es por PALABRA COMPLETA: "NAF" encuentra "NAF SRL" y no encuentra
// "NAFTA". Antes el mínimo era cuatro justamente para evitar ese falso positivo, y el
// precio fue no reconocer nunca a los clientes de nombre corto — NAF S.R.L. es Mamina, y
// ningún pago suyo se identificaba.
const LARGO_MINIMO_TOKEN = 3;

function tokensUtiles(nombre: string): string[] {
  return normalizarNombre(nombre).split(' ').filter(t => t.length >= LARGO_MINIMO_TOKEN && !RUIDO.has(t));
}

// Por palabra completa, no por subcadena. `normalizarNombre` ya dejó todo separado por
// espacios simples, así que alcanza con mirar los bordes.
function contienePalabra(texto: string, palabra: string): boolean {
  if (!palabra) return false;
  return ` ${texto} `.includes(` ${palabra} `);
}

export interface Candidato {
  id_control: string;
  cliente: string;
  confianza: 'alias' | 'nombre';
}

// De quién parece ser un movimiento. Dos caminos, en este orden:
//
//   1. Un alias ya aprendido que aparezca en la descripción. Es el que vale: lo confirmó
//      una persona alguna vez para ese mismo texto.
//   2. El nombre del cliente dentro de la descripción, comparando por palabra completa y
//      descartando las que no dicen nada (SA, SRL, TRANSFERENCIA y compañía). Sin eso,
//      cualquier movimiento matchea con cualquier cliente.
//
// Si no hay ninguno, devuelve null: que la pantalla pida elegir a mano es mucho mejor que
// adivinar mal, porque de eso sale un cobro imputado al cliente equivocado.
export function proponerCliente(
  descripcion: string, clientes: ClienteVenta[], aliases: AliasCobranza[],
): Candidato | null {
  const desc = normalizarNombre(descripcion);
  if (!desc) return null;

  // 1. Alias aprendidos, del más largo al más corto: el más específico gana.
  const porLargo = [...aliases]
    .filter(a => normalizarNombre(a.alias).length >= LARGO_MINIMO_TOKEN)
    .sort((a, b) => normalizarNombre(b.alias).length - normalizarNombre(a.alias).length);
  for (const a of porLargo) {
    if (contienePalabra(desc, normalizarNombre(a.alias))) {
      const cli = clientes.find(c => String(c.id_control) === String(a.id_control));
      return { id_control: String(a.id_control), cliente: nombreClienteVisible(cli) || a.cliente, confianza: 'alias' };
    }
  }

  // 2. Nombre del cliente. Gana el que aporta más palabras coincidentes; con empate, el
  //    que tiene la palabra más larga (más específica).
  let mejor: { cli: ClienteVenta; puntos: number; largo: number } | null = null;
  for (const cli of clientes) {
    const nombres = [cli.nombre_xubio, cli.nombre_display, cli.alias].filter(Boolean);
    let puntos = 0, largo = 0;
    for (const nom of nombres) {
      for (const t of tokensUtiles(nom)) {
        if (contienePalabra(desc, t)) { puntos++; largo = Math.max(largo, t.length); }
      }
    }
    if (puntos === 0) continue;
    if (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && largo > mejor.largo)) {
      mejor = { cli, puntos, largo };
    }
  }
  if (mejor) {
    return { id_control: String(mejor.cli.id_control), cliente: nombreClienteVisible(mejor.cli) || mejor.cli.nombre_xubio, confianza: 'nombre' };
  }
  return null;
}

// Palabras propias del correo que NO identifican a nadie. Van aparte del ruido bancario
// porque el problema que resuelven es distinto y más grave.
const RUIDO_MAIL = new Set([
  'ASUNTO', 'AVISO', 'FWD', 'RV', 'REENVIADO', 'MENSAJE', 'ORIGINAL', 'PARA', 'ENVIADO',
  'GMAIL', 'HOTMAIL', 'YAHOO', 'OUTLOOK', 'COM', 'COM AR', 'MAIL', 'CORREO', 'ADJUNTO',
]);

// El texto que conviene guardar como alias cuando alguien confirma a mano de quién era un
// movimiento: las palabras con contenido de la descripción, sin el ruido bancario. Guardar
// la descripción entera no serviría — trae importes, números de operación y fechas que
// cambian en cada transferencia.
//
// Las DIRECCIONES DE CORREO se borran antes que nada, y es la parte importante. Cuando un
// aviso de pago se reenvía desde Gmail, el remitente que llega no es el del cliente sino el
// de quien reenvía. De ahí salió un alias "MARCOS QUARANTA GMAIL COM" apuntando a un
// cliente: el próximo aviso reenviado —de cualquier cliente— habría matcheado con ese alias
// y el cobro se habría propuesto para el cliente equivocado. Un alias aprendido mal no
// falla ruidosamente: acierta cada vez con la respuesta errónea.
export function aliasDesdeDescripcion(descripcion: string): string {
  const sinMails = String(descripcion || '')
    // Direcciones completas, y también las que quedaron con los puntos ya convertidos en
    // espacios por una normalización anterior ("marcos quaranta gmail com").
    .replace(/[\w.+-]+@[\w.-]+/g, ' ')
    // Hasta tres palabras antes del proveedor: "marcos quaranta gmail com" son dos, y con
    // una sola sobrevivía el nombre de pila, que es justo lo que no puede quedar.
    .replace(/\b(?:[\w.+-]+\s+){1,3}(?:gmail|hotmail|yahoo|outlook|live|icloud)\s+com\b/gi, ' ');

  const tokens = normalizarNombre(sinMails).split(' ')
    .filter(t => t.length >= LARGO_MINIMO_TOKEN
      && !RUIDO.has(t) && !RUIDO_MAIL.has(t)
      && !/^\d+$/.test(t));

  const alias = tokens.slice(0, 4).join(' ');
  // Con menos que esto no identifica a nadie: es preferible no aprender nada a aprender un
  // alias que va a matchear con cualquier cosa.
  return alias.replace(/\s/g, '').length >= 4 ? alias : '';
}

export function nuevoIdItem(previos: ItemBandeja[]): string {
  const seq = previos.reduce((a, i) => Math.max(a, parseInt(String(i.id_item).replace(/\D/g, ''), 10) || 0), 0) + 1;
  return `BC-${String(seq).padStart(5, '0')}`;
}
