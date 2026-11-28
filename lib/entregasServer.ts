// ══ Entregas: lectura y escritura en la planilla ══════════════════════════════════════
//
// Separado de lib/entregas.ts a propósito: ahí vive la lógica pura, que se puede testear
// sin tocar Google. Acá solo está el acceso a la hoja.

import { readSheet, appendRowObj, batchUpdateRows, asegurarHoja } from './sheets';
import { HOJA_ENTREGAS, HEADERS_ENTREGAS, parseEntrega, claveEntrega, type Entrega } from './entregas';

export async function leerEntregas(): Promise<Entrega[]> {
  const filas = await readSheet<any>(HOJA_ENTREGAS).catch(() => [] as any[]);
  return filas.map(parseEntrega).filter((e) => e.fecha && e.id_control);
}

// Guarda una entrega. Si ya existe una para ese cliente, sucursal y día, la pisa en vez de
// agregar otra: confirmar dos veces es corregirse, no entregar dos veces.
//
// `pedido` no se toca nunca en la fila que ya existe — esa es la razón de ser de la hoja.
// Por eso las líneas que se escriben vienen con el pedido de la fila vieja cuando la hay.
export async function guardarEntrega(e: Entrega): Promise<void> {
  await asegurarHoja(HOJA_ENTREGAS, HEADERS_ENTREGAS);
  const filas = await readSheet<any>(HOJA_ENTREGAS).catch(() => [] as any[]);
  const clave = claveEntrega(e.fecha, e.id_control, e.sucursal);
  const existente = filas.find((f) => claveEntrega(f.fecha, f.id_control, f.sucursal) === clave);

  const fila = {
    id_entrega: existente?.id_entrega || e.id_entrega,
    fecha: e.fecha,
    id_control: e.id_control,
    sucursal: e.sucursal,
    estado: e.estado,
    validado_por: e.validado_por,
    validado_en: e.validado_en,
    lineas: JSON.stringify(e.lineas),
    cajones_devueltos: e.cajones_devueltos,
    nota: e.nota,
    comprobante: e.comprobante,
  };

  if (existente) {
    await batchUpdateRows(HOJA_ENTREGAS, 'id_entrega', [{ keyValue: String(existente.id_entrega), updates: fila }]);
  } else {
    await appendRowObj(HOJA_ENTREGAS, fila);
  }
}

// El comprobante que salió de una entrega, una vez emitido. Se escribe aparte porque la
// factura sale DESPUÉS de guardar la entrega: si se guardara junto, una falla de Xubio
// dejaría la entrega sin registrar, que es lo único que no se puede perder.
export async function marcarComprobante(e: Entrega, comprobante: string): Promise<void> {
  if (!comprobante) return;
  const filas = await readSheet<any>(HOJA_ENTREGAS).catch(() => [] as any[]);
  const clave = claveEntrega(e.fecha, e.id_control, e.sucursal);
  const existente = filas.find((f) => claveEntrega(f.fecha, f.id_control, f.sucursal) === clave);
  if (!existente) return;
  await batchUpdateRows(HOJA_ENTREGAS, 'id_entrega', [
    { keyValue: String(existente.id_entrega), updates: { comprobante } },
  ]);
}
