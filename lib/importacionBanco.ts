// ── Lectura del resumen bancario ─────────────────────────────────────────────────────
//
// Toma la exportación del banco (CSV o Excel) y devuelve los movimientos de ENTRADA de
// plata. Nada de esto decide nada todavía: solo convierte un archivo en filas con fecha,
// importe y descripción, que es lo que después se intenta matchear contra un cliente.
//
// Está escrito para aguantar que el banco cambie el formato, porque va a pasar:
//   · las columnas se buscan por NOMBRE, no por posición;
//   · se aceptan las dos formas de expresar el movimiento — una columna "importe" con
//     signo, o dos columnas separadas de débito y crédito;
//   · los números pueden venir en formato argentino (1.234,56), en inglés (1,234.56) o
//     ya convertidos a número por Excel;
//   · las fechas pueden venir como texto (dd/mm/aaaa o aaaa-mm-dd), como Date o como el
//     número de serie de Excel.
//
// Lo que NO hace: adivinar. Si no encuentra la columna de fecha o la de importe, lo dice
// con un error que nombra las columnas que sí encontró, en vez de devolver una lista vacía
// y dejar pensando que el resumen no tenía movimientos.

export interface MovimientoBanco {
  fecha: string;        // YYYY-MM-DD
  importe: number;      // siempre positivo: son entradas
  descripcion: string;  // lo que dice el banco — de acá sale el nombre del que pagó
  hash: string;         // para no importar dos veces el mismo movimiento
}

export interface ResultadoImportacion {
  movimientos: MovimientoBanco[];
  filasLeidas: number;
  salidas: number;      // débitos: se ignoran, pero se cuentan para poder decirlo
  sinFecha: number;     // filas descartadas por no tener una fecha usable
  columnas: { fecha: string; importe: string; descripcion: string };
}

const norm = (v: any) => String(v ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

// Nombres posibles de cada columna, en orden de preferencia.
const COL_FECHA = ['fecha', 'fecha operacion', 'fecha de operacion', 'fecha valor', 'f. operacion', 'dia'];
const COL_IMPORTE = ['importe', 'monto', 'valor', 'importe ($)', 'importe pesos'];
const COL_CREDITO = ['credito', 'creditos', 'haber', 'ingreso', 'entrada', 'deposito'];
const COL_DEBITO = ['debito', 'debitos', 'debe', 'egreso', 'salida', 'extraccion'];
const COL_DESC = ['descripcion', 'concepto', 'detalle', 'referencia', 'movimiento', 'operacion', 'observaciones'];

function buscarColumna(headers: string[], candidatos: string[]): number {
  // Primero coincidencia exacta, después "contiene": "Fecha de operación" tiene que
  // matchear con "fecha", pero si existe una columna llamada exactamente "Fecha" esa gana.
  for (const c of candidatos) {
    const i = headers.findIndex(h => h === c);
    if (i !== -1) return i;
  }
  for (const c of candidatos) {
    const i = headers.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

// Número en cualquiera de los formatos con los que se puede exportar un resumen.
export function parsearImporte(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v ?? '').trim();
  if (!t) return null;
  const negativoEntreParentesis = /^\(.*\)$/.test(t);
  t = t.replace(/[()]/g, '').replace(/\s/g, '').replace(/^\$|ars|pesos/gi, '');
  if (!t) return null;
  const tieneComa = t.includes(','), tienePunto = t.includes('.');
  if (tieneComa && tienePunto) {
    // El separador decimal es el ÚLTIMO de los dos que aparezca.
    t = t.lastIndexOf(',') > t.lastIndexOf('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(/,/g, '');
  } else if (tieneComa) {
    // Una coma sola: decimal si deja dos dígitos a la derecha, miles si deja tres.
    const dec = t.length - t.lastIndexOf(',') - 1;
    t = dec === 3 ? t.replace(/,/g, '') : t.replace(',', '.');
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negativoEntreParentesis ? -Math.abs(n) : n;
}

// Fecha en cualquiera de las formas en que puede llegar, siempre a YYYY-MM-DD.
export function parsearFecha(v: any): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  // Serial de Excel (mismo epoch que en lib/sheets.ts).
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const t = String(v ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const dia = m[1].padStart(2, '0'), mes = m[2].padStart(2, '0');
    let anio = m[3];
    if (anio.length === 2) anio = `20${anio}`;
    return `${anio}-${mes}-${dia}`;
  }
  return null;
}

// Identidad de un movimiento, para no importarlo dos veces si se sube el mismo resumen
// otra vez (que es lo que va a pasar cuando los períodos se superpongan).
export function hashMovimiento(fecha: string, importe: number, descripcion: string): string {
  const base = `${fecha}|${Math.round(importe * 100)}|${norm(descripcion).replace(/\s+/g, ' ')}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) | 0; }
  return `B${Math.abs(h).toString(36)}`;
}

// El corazón: una matriz de filas (como la devuelve cualquier lector de CSV/Excel) a
// movimientos de entrada. Separado de la lectura del archivo a propósito, para poder
// probarlo con resúmenes de mentira sin depender del formato del archivo.
export function parsearFilasBanco(filas: any[][]): ResultadoImportacion {
  if (!filas?.length) throw new Error('El archivo está vacío.');

  // La fila de encabezado no siempre es la primera: los resúmenes suelen traer arriba el
  // nombre del banco, el período y la cuenta.
  let idxHeader = -1, headers: string[] = [];
  for (let i = 0; i < Math.min(filas.length, 25); i++) {
    const h = (filas[i] || []).map(norm);
    const tieneFecha = buscarColumna(h, COL_FECHA) !== -1;
    const tieneMonto = buscarColumna(h, COL_IMPORTE) !== -1 || buscarColumna(h, COL_CREDITO) !== -1;
    if (tieneFecha && tieneMonto) { idxHeader = i; headers = h; break; }
  }
  if (idxHeader === -1) {
    const muestra = (filas[0] || []).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`No se encontró la fila de encabezados: hace falta una columna de fecha y una de importe (o de crédito). La primera fila del archivo dice: ${muestra || '(vacía)'}`);
  }

  const cFecha = buscarColumna(headers, COL_FECHA);
  const cImporte = buscarColumna(headers, COL_IMPORTE);
  const cCredito = buscarColumna(headers, COL_CREDITO);
  const cDebito = buscarColumna(headers, COL_DEBITO);
  const cDesc = buscarColumna(headers, COL_DESC);

  const movimientos: MovimientoBanco[] = [];
  const vistos = new Set<string>();
  let filasLeidas = 0, salidas = 0, sinFecha = 0;

  for (let i = idxHeader + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    if (!fila.some(c => String(c ?? '').trim())) continue; // fila en blanco
    filasLeidas++;

    const fecha = parsearFecha(fila[cFecha]);
    if (!fecha) { sinFecha++; continue; }

    // El importe sale de la columna de crédito si el resumen tiene columnas separadas; si
    // no, de la columna única, y ahí el signo decide si entró o salió.
    let importe: number | null = null;
    if (cCredito !== -1) {
      const cr = parsearImporte(fila[cCredito]);
      const db = cDebito !== -1 ? parsearImporte(fila[cDebito]) : null;
      if (cr && Math.abs(cr) > 0) importe = Math.abs(cr);
      else if (db && Math.abs(db) > 0) { salidas++; continue; }
    }
    if (importe === null && cImporte !== -1) {
      const n = parsearImporte(fila[cImporte]);
      if (n === null || n === 0) continue;
      if (n < 0) { salidas++; continue; }
      importe = n;
    }
    if (importe === null || !(importe > 0)) continue;

    // La descripción junta todas las columnas de texto que no sean fecha ni importe: los
    // bancos reparten el nombre del ordenante entre "concepto" y "referencia", y con una
    // sola de las dos el nombre del cliente muchas veces no aparece.
    const partes: string[] = [];
    if (cDesc !== -1) partes.push(String(fila[cDesc] ?? '').trim());
    for (let c = 0; c < fila.length; c++) {
      if (c === cFecha || c === cImporte || c === cCredito || c === cDebito || c === cDesc) continue;
      const t = String(fila[c] ?? '').trim();
      if (t && isNaN(Number(t)) && t.length > 2) partes.push(t);
    }
    const descripcion = [...new Set(partes.filter(Boolean))].join(' · ').slice(0, 300);

    const hash = hashMovimiento(fecha, importe, descripcion);
    if (vistos.has(hash)) continue; // repetido dentro del mismo archivo
    vistos.add(hash);
    movimientos.push({ fecha, importe, descripcion, hash });
  }

  movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);
  return {
    movimientos, filasLeidas, salidas, sinFecha,
    columnas: {
      fecha: headers[cFecha] || '?',
      importe: cCredito !== -1 ? headers[cCredito] : (headers[cImporte] || '?'),
      descripcion: cDesc !== -1 ? headers[cDesc] : '(varias columnas)',
    },
  };
}
