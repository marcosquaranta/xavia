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
export const HEADERS_COBRANZAS_EDIT = ['transaccionid', 'cliente', 'cuenta', 'importe', 'oculta', 'nota', 'comprobantes', 'usuario', 'fecha_edicion'];

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
  // Qué facturas paga este cobro.
  //
  // Xubio no lo puede decir: la cobranza entra a la cuenta corriente del cliente como un
  // cobro a cuenta y el bean no tiene dónde nombrar la factura que cancela. Hasta ahora la
  // app lo adivinaba —imputando de la más vieja a la más nueva— y adivinar bien de vez en
  // cuando no alcanza: una factura que el cliente pagó seguía apareciendo para reclamar.
  //
  // Esto es la respuesta: decirlo a mano, una vez, y que quede. Lo que se escribe acá GANA
  // sobre lo que deduzca la app, y la plata de este cobro deja de repartirse sola.
  //
  // Números separados por coma, igual que en CobrosRegistrados.
  comprobantes: string;
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
): T & { editada: boolean; nota: string; oculta: boolean; importeXubio: number; comprobantes: string[] } {
  const e = ediciones.get(String(fila.transaccionid ?? '').trim());
  if (!e) return { ...fila, editada: false, nota: '', oculta: false, importeXubio: fila.importe, comprobantes: [] };
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
    comprobantes: comprobantesDeEdicion(e),
  };
}

// Los comprobantes que esta cobranza paga, tal como se escribieron. Se separan acá y no en
// cada lugar que los use: son la clave con la que se cruza contra las facturas de Xubio y
// un split distinto en cada lado es la forma más fácil de que una imputación se pierda.
export function comprobantesDeEdicion(e: CobranzaEdit | undefined): string[] {
  return String(e?.comprobantes || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// Lo que NO se manda no se toca.
//
// Antes se escribía la fila entera siempre, con lo que cada campo ausente quedaba en
// blanco: sacar una cobranza de la lista —que manda solo `oculta`— borraba de paso el
// cliente y el medio de cobro que alguien había corregido, sin avisar. Con la imputación
// eso pasaba de molesto a grave: guardar cualquier otra corrección habría borrado qué
// facturas paga el cobro, y la app habría vuelto a adivinar como si nadie lo hubiera dicho.
//
// `undefined` significa "no lo mandé, dejalo como está"; mandar vacío sigue borrando, que
// es la única forma de deshacer una corrección.
export async function guardarEdicion(p: {
  transaccionid: string;
  cliente?: string;
  cuenta?: string;
  importe?: number | string;
  oculta?: boolean;
  nota?: string;
  comprobantes?: string[];
  usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_COBRANZAS_EDIT, HEADERS_COBRANZAS_EDIT);
  await asegurarColumnas(HOJA_COBRANZAS_EDIT, ['importe', 'oculta', 'comprobantes']);
  const id = String(p.transaccionid || '').trim();
  if (!id) throw new Error('Falta la transacción a corregir.');

  const previas = await leerEdiciones();
  const previa = previas.find((f) => String(f.transaccionid).trim() === id);

  const imp = Number(p.importe);
  const hayImporte = String(p.importe ?? '').trim() !== '' && Number.isFinite(imp) && imp >= 0;
  const fila = {
    transaccionid: id,
    cliente: p.cliente !== undefined ? String(p.cliente).trim() : String(previa?.cliente ?? ''),
    cuenta: p.cuenta !== undefined ? String(p.cuenta).trim() : String(previa?.cuenta ?? ''),
    // Vacío y no cero: cero es un importe válido y significa otra cosa que "no corregido".
    importe: p.importe !== undefined ? (hayImporte ? imp : '') : (previa?.importe ?? ''),
    oculta: p.oculta !== undefined ? (p.oculta ? 'SI' : '') : String(previa?.oculta ?? ''),
    nota: p.nota !== undefined ? String(p.nota).trim() : String(previa?.nota ?? ''),
    comprobantes: p.comprobantes !== undefined
      ? p.comprobantes.map((x) => String(x).trim()).filter(Boolean).join(', ')
      : String(previa?.comprobantes ?? ''),
    usuario: p.usuario,
    fecha_edicion: new Date().toISOString(),
  };

  if (previa) {
    await updateRow(HOJA_COBRANZAS_EDIT, 'transaccionid', id, fila);
  } else {
    await appendRowObj(HOJA_COBRANZAS_EDIT, fila);
  }
}

// ── Las imputaciones hechas a mano, listas para usar ─────────────────────────────────
//
// Dos cosas salen de acá y las dos hacen falta juntas:
//   · qué facturas están pagas por decisión de la app (por clave, ver comprobantes.ts);
//   · qué cobranzas de Xubio tienen su plata ya asignada.
//
// Lo segundo es lo que evita contar la misma plata dos veces. Si un cobro de $100 se imputa
// a una factura y esos $100 siguen entrando en el total que se reparte solo, el reparto tapa
// otra factura de $100 que nadie pagó: la imputación a mano terminaría ocultando deuda en
// vez de aclararla.
//
// `clave` entra como parámetro para no arrastrar imports: esto lo lee también el formulario
// de la pantalla, que es 'use client'.
export interface ImputacionesManuales {
  porFactura: Map<string, { transaccionid: string }>;
  transaccionesImputadas: Set<string>;
}

export function imputacionesManuales(
  filas: CobranzaEdit[], clave: (n: string) => string,
): ImputacionesManuales {
  const porFactura = new Map<string, { transaccionid: string }>();
  const transaccionesImputadas = new Set<string>();
  for (const f of filas || []) {
    const tid = String(f?.transaccionid || '').trim();
    const nums = comprobantesDeEdicion(f);
    if (!tid || !nums.length) continue;
    transaccionesImputadas.add(tid);
    for (const n of nums) {
      const k = clave(n);
      // La primera gana: imputar la misma factura a dos cobros distintos es un error de
      // carga, y quedarse con la última lo escondería.
      if (k && !porFactura.has(k)) porFactura.set(k, { transaccionid: tid });
    }
  }
  return { porFactura, transaccionesImputadas };
}
