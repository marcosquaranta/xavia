import { asegurarHoja, asegurarColumnas, readSheet, updateRow, appendRowObj } from './sheets';

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
// Se corrigen el cliente, el medio de cobro, el importe y una nota, y se puede sacar una
// fila de la lista.
//
// El importe es el delicado: esta pantalla vale por ser fiel a Xubio —es contra lo que se
// concilia el banco— así que cuando se corrige se guarda TAMBIÉN el de Xubio y la pantalla
// muestra los dos. Sin eso, un importe editado convierte la lista en algo que se parece a
// la conciliación pero ya no cuadra con nada, y nadie se entera.
//
// "Sacar de la lista" no borra nada: ni de Xubio ni de la caché. La caché se reescribe sola
// desde Xubio en cada actualización, así que borrar la fila ahí la haría volver a aparecer
// a la siguiente. Lo único que persiste es la decisión de no verla.

export const HOJA_COBRANZAS_EDIT = 'XubioCobranzasEdit';
export const HEADERS_COBRANZAS_EDIT = ['transaccionid', 'cliente', 'cuenta', 'importe', 'oculta', 'nota', 'usuario', 'fecha_edicion'];

export interface CobranzaEdit {
  transaccionid: string | number;
  cliente: string;
  cuenta: string;
  // Vacío = se usa el de Xubio. Con un número, pisa al de Xubio.
  importe: number | string;
  // 'SI' = no se muestra más en la lista. No se borra nada de Xubio ni de la caché: la
  // caché se reescribe sola desde Xubio en cada actualización, así que borrar la fila ahí
  // la haría volver sola a la siguiente. Ocultarla acá es lo único que persiste.
  oculta: string;
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
export function aplicarEdicion<T extends { transaccionid?: string | number; cliente: string; cuenta: string; importe: number }>(
  fila: T, ediciones: Map<string, CobranzaEdit>,
): T & { editada: boolean; nota: string; oculta: boolean; importeXubio: number } {
  const e = ediciones.get(String(fila.transaccionid ?? '').trim());
  if (!e) return { ...fila, editada: false, nota: '', oculta: false, importeXubio: fila.importe };
  const cliente = String(e.cliente || '').trim();
  const cuenta = String(e.cuenta || '').trim();
  const imp = Number(e.importe);
  const hayImporte = String(e.importe ?? '').trim() !== '' && Number.isFinite(imp) && imp >= 0;
  return {
    ...fila,
    cliente: cliente || fila.cliente,
    cuenta: cuenta || fila.cuenta,
    importe: hayImporte ? imp : fila.importe,
    // El de Xubio se conserva aparte: es contra lo que se concilia, y hay que poder ver
    // cuánto decía antes de que alguien lo corrigiera.
    importeXubio: fila.importe,
    editada: !!(cliente || cuenta || hayImporte),
    oculta: String(e.oculta || '').trim().toUpperCase() === 'SI',
    nota: String(e.nota || ''),
  };
}

export async function guardarEdicion(p: {
  transaccionid: string;
  cliente?: string;
  cuenta?: string;
  importe?: number | string;
  oculta?: boolean;
  nota?: string;
  usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_COBRANZAS_EDIT, HEADERS_COBRANZAS_EDIT);
  await asegurarColumnas(HOJA_COBRANZAS_EDIT, ['importe', 'oculta']);
  const id = String(p.transaccionid || '').trim();
  if (!id) throw new Error('Falta la transacción a corregir.');

  const imp = Number(p.importe);
  const fila = {
    transaccionid: id,
    cliente: String(p.cliente ?? '').trim(),
    cuenta: String(p.cuenta ?? '').trim(),
    // Vacío y no cero: cero es un importe válido y significa otra cosa que "no corregido".
    importe: String(p.importe ?? '').trim() !== '' && Number.isFinite(imp) && imp >= 0 ? imp : '',
    oculta: p.oculta ? 'SI' : '',
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
