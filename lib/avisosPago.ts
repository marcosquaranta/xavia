// ── Avisos de pago ───────────────────────────────────────────────────────────────────
//
// Los clientes avisan que pagaron por mail o por WhatsApp, y ese aviso trae justo lo que
// el resumen del banco NO trae: QUÉ FACTURAS está cancelando el pago. El banco dice
// "transferencia de Dar Supermercados $1.284.000" y nada más; la orden de pago dice
// "A-00002-00000849 y A-00002-00000851, menos retención de IIBB".
//
// Esto lee ese texto —pegado tal cual, con el encabezado del mail y todo— y saca lo que
// sirve: el importe, las facturas y la fecha. No decide nada: arma un candidato para la
// bandeja, igual que una línea del resumen bancario.
//
// Está escrito para texto sucio a propósito. Un aviso de pago real viene con firmas,
// disclaimers legales, CUITs, números de operación y la palabra "total" cinco veces. Lo
// que hace que esto funcione no es entender el mail, es saber qué ignorar.

export interface AvisoPago {
  importe: number | null;
  fecha: string | null;          // YYYY-MM-DD
  comprobantes: string[];
  importesEncontrados: number[]; // todos, por si el elegido no es el correcto
  retencion: number | null;      // si el aviso la menciona aparte
}

// Palabras que suelen estar pegadas al importe que de verdad se pagó.
const CLAVES_TOTAL = [
  'neto a pagar', 'total a pagar', 'importe a pagar', 'neto', 'total pagado',
  'importe transferido', 'monto transferido', 'total', 'importe',
];
const CLAVES_RETENCION = ['retencion', 'retención', 'iibb', 'ingresos brutos', 'ganancias', 'sufrida'];

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Un número en formato argentino ($ 1.284.000,00) o inglés. Devuelve null si el texto no
// es un importe plausible.
export function importeDeTexto(t: string): number | null {
  const limpio = String(t || '').replace(/[$\s]/g, '');
  if (!limpio || !/[\d]/.test(limpio)) return null;
  const tieneComa = limpio.includes(','), tienePunto = limpio.includes('.');
  let norm = limpio;
  if (tieneComa && tienePunto) {
    norm = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '');
  } else if (tieneComa) {
    const dec = limpio.length - limpio.lastIndexOf(',') - 1;
    norm = dec === 3 ? limpio.replace(/,/g, '') : limpio.replace(',', '.');
  } else if (tienePunto) {
    // Un punto solo: si deja 3 dígitos a la derecha es separador de miles (1.284.000).
    const dec = limpio.length - limpio.lastIndexOf('.') - 1;
    if (dec === 3) norm = limpio.replace(/\./g, '');
  }
  // Sin separadores queda tal cual: "500000" es 500000.
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Números de comprobante en cualquiera de las formas en que se escriben: A-0002-00000849,
// A 00002 00000849, 0002-00000849. Se normalizan todos a la forma larga con letra, que es
// como los devuelve Xubio, para que después matcheen contra las facturas del cliente.
export function comprobantesDeTexto(texto: string): string[] {
  const out = new Set<string>();
  const re = /\b([ABCEM])?[\s-]?(\d{4,5})[\s-](\d{6,8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const letra = (m[1] || 'A').toUpperCase();
    const pv = m[2].padStart(5, '0');
    const nro = m[3].padStart(8, '0');
    out.add(`${letra}-${pv}-${nro}`);
  }
  return [...out];
}

function fechaDeTexto(texto: string): string | null {
  const iso = texto.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = texto.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);
  if (dmy) {
    let anio = dmy[3];
    if (anio.length === 2) anio = `20${anio}`;
    return `${anio}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

// Palabras que, cerca de un número pelado, lo convierten en un importe. Hacen falta porque
// un número sin separadores ni decimales no se distingue de cualquier otro número: es el
// contexto el que dice que 500000 es plata y no un número de operación.
const CLAVES_IMPORTE = [
  'importe', 'monto', 'total', 'neto', 'pago', 'pagamos', 'abonamos', 'abonado', 'pagado',
  'transferi', 'transferimos', 'transferencia', 'deposito', 'depositamos', 'acreditado',
  'por un valor de', 'la suma de', 'valor',
  // Las retenciones también son importes: hay que reconocerlas para poder DESCARTARLAS
  // después. Si no se capturan, no se las puede distinguir del neto.
  'retencion', 'iibb', 'ingresos brutos', 'ganancias',
];

// Un importe pelado tiene que tener al menos esta magnitud para que se lo considere plata.
// Por debajo, un número suelto es casi siempre otra cosa (una cantidad, un piso, una hora).
const MINIMO_IMPORTE_PELADO = 1000;

// Todos los importes del texto, con la porción de línea que los precede — que es lo que
// permite distinguir el neto a pagar de una retención o del total de una factura suelta.
function importesConContexto(texto: string): { valor: number; contexto: string; idx: number }[] {
  const out: { valor: number; contexto: string; idx: number }[] = [];
  const agregar = (crudo: string, idx: number) => {
    const valor = importeDeTexto(crudo);
    if (valor === null) return;
    if (out.some(o => o.idx === idx)) return; // ya lo tomó el patrón anterior
    // El contexto es la FRASE en la que está el número, no los 60 caracteres anteriores:
    // en "Retención 34680. Total transferido 1249320" la ventana ancha metía "retención"
    // dentro del contexto del neto y lo hacía descartar el número correcto.
    const desde = Math.max(0, idx - 60);
    const bruto = texto.slice(desde, idx);
    const corte = Math.max(bruto.lastIndexOf('. '), bruto.lastIndexOf('\n'), bruto.lastIndexOf(';'));
    const contexto = corte >= 0 ? bruto.slice(corte + 1) : bruto;
    out.push({ valor, contexto: sinAcentos(contexto), idx });
  };

  // 1. Con separadores de miles o decimales: 1.284.000,00 · 1,284,000.00 · 450000,50
  const conFormato = /(\$\s?)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = conFormato.exec(texto)) !== null) agregar(m[0], m.index);

  // 2. Número PELADO con el signo pesos adelante: "$500000". Sin el $ no se puede saber que
  //    es plata, con el $ no hay duda.
  const conPeso = /\$\s?(\d{4,12})\b/g;
  while ((m = conPeso.exec(texto)) !== null) agregar(m[0], m.index);

  // 3. Número pelado cerca de una palabra que hable de plata: "te transferí 500000",
  //    "importe 1699320". Es el caso de los avisos escritos a mano, que son la mitad.
  const plano = sinAcentos(texto);
  const pelado = /\b(\d{4,12})\b/g;
  while ((m = pelado.exec(texto)) !== null) {
    const valor = Number(m[1]);
    if (!(valor >= MINIMO_IMPORTE_PELADO)) continue;
    const ctx = plano.slice(Math.max(0, m.index - 40), m.index);
    if (!CLAVES_IMPORTE.some(k => ctx.includes(sinAcentos(k)))) continue;
    agregar(m[1], m.index);
  }

  return out.sort((a, b) => a.idx - b.idx);
}

export function parsearAvisoPago(texto: string): AvisoPago {
  const t = String(texto || '');
  const comprobantes = comprobantesDeTexto(t);

  // Los números de comprobante tienen forma de importe si se los mira de reojo. Se saca de
  // la búsqueda de importes cualquier número que sea parte de un comprobante detectado.
  let limpio = t;
  for (const c of comprobantes) {
    const [, pv, nro] = c.split('-');
    limpio = limpio.replace(new RegExp(`\\b[ABCEM]?[\\s-]?0*${Number(pv)}[\\s-]0*${Number(nro)}\\b`, 'g'), ' ');
  }
  // Los CUIT también: 30-71840929-9 no es un importe.
  limpio = limpio.replace(/\b\d{2}-?\d{8}-?\d\b/g, ' ');

  const candidatos = importesConContexto(limpio);
  const importesEncontrados = [...new Set(candidatos.map(c => c.valor))].sort((a, b) => b - a);

  const esRetencion = (ctx: string) => CLAVES_RETENCION.some(k => ctx.includes(sinAcentos(k)));
  const retencionC = candidatos.find(c => esRetencion(c.contexto));

  // El importe pagado: primero el que esté pegado a una palabra de "neto/total a pagar"
  // (sin ser una retención), y si ninguno lo está, el más grande que no sea retención. El
  // más grande funciona porque el neto de una orden de pago es casi siempre el número
  // mayor del aviso; por eso igual se devuelven todos, para poder corregir.
  let elegido: number | null = null;
  for (const clave of CLAVES_TOTAL) {
    const k = sinAcentos(clave);
    const hit = candidatos.find(c => c.contexto.includes(k) && !esRetencion(c.contexto));
    if (hit) { elegido = hit.valor; break; }
  }
  if (elegido === null) {
    const sinRet = candidatos.filter(c => !esRetencion(c.contexto));
    elegido = sinRet.length ? Math.max(...sinRet.map(c => c.valor)) : null;
  }

  return {
    importe: elegido,
    fecha: fechaDeTexto(t),
    comprobantes,
    importesEncontrados,
    retencion: retencionC ? retencionC.valor : null,
  };
}
