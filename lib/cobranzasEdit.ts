import { asegurarHoja, readSheet, updateRow, appendRowObj } from './sheets';

// ── Correcciones a mano de las cobranzas de Xubio ─────────────────────────────────────
//
// "Cobranzas del mes" es un espejo de lo que hay en Xubio, y ese espejo a veces viene
// incompleto: Xubio no siempre devuelve el nombre del cliente, y el medio de cobro puede
// estar cargado mal del otro lado. Poder corregirlo acá sirve aunque no vuelva a Xubio —
// el que mira esta pantalla necesita entender qué entró y de quién.
//
// Las correcciones NO se guardan en la caché, se guardan en una hoja aparte y se aplican
// al leer. Es la única forma de que sobrevivan: la caché se vuelve a escribir entera cada
// vez que se actualiza desde Xubio, así que una corrección hecha ahí duraría hasta la
// próxima actualización y después desaparecería sin dejar rastro — que es peor que no
// poder corregir, porque uno cree que quedó arreglado.
//
// Se corrigen el cliente, el medio de cobro y una nota. El IMPORTE no: esta pantalla vale
// justamente por ser fiel a Xubio —es contra lo que se concilia— y un importe editado a
// mano la convertiría en otra cosa que se parece pero no cuadra.

export const HOJA_COBRANZAS_EDIT = 'XubioCobranzasEdit';
export const HEADERS_COBRANZAS_EDIT = ['transaccionid', 'cliente', 'cuenta', 'nota', 'usuario', 'fecha_edicion'];

export interface CobranzaEdit {
  transaccionid: string | number;
  cliente: string;
  cuenta: string;
  nota: string;
  usuario: string;
  fecha_edicion: string;
}

export async function leerEdiciones(): Promise<CobranzaEdit[]> {
  return readSheet<CobranzaEdit>(HOJA_COBRANZAS_EDIT).catch(() => []);
}

// Las ediciones indexadas por transacción, para aplicarlas de una pasada.
export function indiceEdiciones(filas: CobranzaEdit[]): Map<string, CobranzaEdit> {
  const m = new Map<string, CobranzaEdit>();
  for (const f of filas || []) {
    const id = String(f.transaccionid || '').trim();
    if (id) m.set(id, f);
  }
  return m;
}

// Un campo corregido pisa al de Xubio; uno vacío deja el original. Así se puede corregir
// solo el cliente sin tener que repetir el medio de cobro, y borrar una corrección es
// dejarla en blanco.
export function aplicarEdicion<T extends { transaccionid?: string | number; cliente: string; cuenta: string }>(
  fila: T, ediciones: Map<string, CobranzaEdit>,
): T & { editada: boolean; nota: string } {
  const e = ediciones.get(String(fila.transaccionid ?? '').trim());
  if (!e) return { ...fila, editada: false, nota: '' };
  const cliente = String(e.cliente || '').trim();
  const cuenta = String(e.cuenta || '').trim();
  return {
    ...fila,
    cliente: cliente || fila.cliente,
    cuenta: cuenta || fila.cuenta,
    editada: !!(cliente || cuenta),
    nota: String(e.nota || ''),
  };
}

export async function guardarEdicion(p: {
  transaccionid: string;
  cliente?: string;
  cuenta?: string;
  nota?: string;
  usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_COBRANZAS_EDIT, HEADERS_COBRANZAS_EDIT);
  const id = String(p.transaccionid || '').trim();
  if (!id) throw new Error('Falta la transacción a corregir.');

  const fila = {
    transaccionid: id,
    cliente: String(p.cliente ?? '').trim(),
    cuenta: String(p.cuenta ?? '').trim(),
    nota: String(p.nota ?? '').trim(),
    usuario: p.usuario,
    fecha_edicion: new Date().toISOString(),
  };

  const previas = await leerEdiciones();
  if (previas.some((f) => String(f.transaccionid).trim() === id)) {
    await updateRow(HOJA_COBRANZAS_EDIT, 'transaccionid', id, fila);
  } else {
    await appendRowObj(HOJA_COBRANZAS_EDIT, fila);
  }
}
