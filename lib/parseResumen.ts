// ── Pegar un resumen de tarjeta y que salgan los gastos ──────────────────────────────
//
// El resumen llega como texto: una línea por consumo, con fecha, descripción e importe en
// algún orden y con separadores que cambian según de dónde se copie. Cargarlos de a uno son
// treinta formularios por mes.
//
// Esto no intenta ser perfecto: intenta sacar lo que se puede y mostrar el resto para
// corregir a mano. Un parser que adivina de más es peor que uno que deja campos vacíos,
// porque el error entra sin que nadie lo vea.

export interface LineaResumen {
  fecha: string;        // YYYY-MM-DD si se pudo deducir, vacío si no
  descripcion: string;
  monto: number;
  categoria: string;    // sugerida, siempre editable
  // La línea parece un total o un subtotal del resumen, no un consumo. No se descarta sola
  // —un comercio podría llamarse así— pero viene destildada: cargarla duplicaría todo el
  // resumen, y es el error que más caro sale de los que puede cometer este parser.
  esTotal: boolean;
}

const PALABRAS_TOTAL = /\b(total|subtotal|saldo|anterior|pago\s+m[ií]nimo|l[ií]mite|cuota\s+social)\b/i;

// Un importe argentino: 1.234,56 · 1234,56 · 1234.56 · 1,234.56
// Se decide por el ÚLTIMO separador: el que está más cerca del final y deja uno o dos
// dígitos atrás es el decimal, y el resto son miles. Es la única regla que funciona con los
// dos formatos sin preguntar de cuál se trata.
export function parsearImporte(txt: string): number | null {
  const limpio = String(txt || '').replace(/[^\d.,-]/g, '').trim();
  if (!limpio || !/\d/.test(limpio)) return null;

  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  const corte = Math.max(ultimaComa, ultimoPunto);

  let entero = limpio, decimales = '';
  if (corte > -1) {
    const atras = limpio.length - corte - 1;
    // Uno o dos dígitos atrás: es el decimal. Tres: son miles (1.234).
    if (atras === 1 || atras === 2) {
      entero = limpio.slice(0, corte);
      decimales = limpio.slice(corte + 1);
    }
  }
  const n = Number(entero.replace(/[.,]/g, '') + (decimales ? '.' + decimales : ''));
  return Number.isFinite(n) ? n : null;
}

const MESES_TXT: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

// Fecha al principio de la línea: 12/09, 12-09-2026, 12 SEP.
function parsearFecha(txt: string, anioRef: number): { fecha: string; resto: string } {
  const t = txt.trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\s+/);
  if (m) {
    const d = Number(m[1]), mes = Number(m[2]);
    let anio = m[3] ? Number(m[3]) : anioRef;
    if (anio < 100) anio += 2000;
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) {
      return { fecha: `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, resto: t.slice(m[0].length) };
    }
  }
  m = t.match(/^(\d{1,2})[\s-]([A-Za-zÁÉÍÓÚáéíóú]{3})\.?\s+/);
  if (m) {
    const d = Number(m[1]);
    const mes = MESES_TXT[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3)];
    if (mes && d >= 1 && d <= 31) {
      return { fecha: `${anioRef}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, resto: t.slice(m[0].length) };
    }
  }
  return { fecha: '', resto: t };
}

// `categoriaPrevia` sirve para recordar con qué categoría se cargó antes la misma
// descripción: si "SHELL" fue combustible el mes pasado, lo más probable es que lo sea otra
// vez. Es una sugerencia, no una decisión: queda editable como todo lo demás.
export function parsearResumen(
  texto: string, anioRef: number, categoriaPrevia: (descripcion: string) => string | null,
  categoriaPorDefecto = 'gastos_generales',
): LineaResumen[] {
  const out: LineaResumen[] = [];
  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    // El importe es el último número de la línea: en todos los resúmenes va a la derecha.
    const numeros = [...linea.matchAll(/-?[\d][\d.,]*/g)];
    if (!numeros.length) continue;
    const ultimo = numeros[numeros.length - 1];
    const monto = parsearImporte(ultimo[0]);
    if (monto === null || monto === 0) continue;

    const sinImporte = (linea.slice(0, ultimo.index) + linea.slice((ultimo.index || 0) + ultimo[0].length)).trim();
    const { fecha, resto } = parsearFecha(sinImporte, anioRef);
    const descripcion = resto.replace(/\s{2,}/g, ' ').replace(/[|;]+$/, '').trim();
    // Una línea sin texto es casi siempre un subtotal o el total del resumen, no un consumo.
    if (!descripcion) continue;

    out.push({
      fecha,
      descripcion,
      monto: Math.abs(monto),
      categoria: categoriaPrevia(descripcion) || categoriaPorDefecto,
      esTotal: PALABRAS_TOTAL.test(descripcion),
    });
  }
  return out;
}
