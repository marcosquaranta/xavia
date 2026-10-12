import { appendRowsObj, asegurarHoja, readSheet } from './sheets';

// ── Qué avisos de cobro contra entrega ya salieron ────────────────────────────────────
//
// El aviso ahora sale desde los DOS caminos por los que se guarda una venta: la carga del
// día y la corrección desde el historial. Eso es lo que hace que no se escape ninguno — pero
// también significa que una misma entrega puede pasar dos veces por acá, porque corregir una
// cantidad vuelve a guardar la fila.
//
// Sin memoria, cada corrección mandaría otro mail con el mismo asunto. Tres mails iguales en
// una mañana es la forma más rápida de que el cuarto no se lea, y el cuarto puede ser el que
// avisa de una entrega nueva.
//
// La clave es cliente + sucursal + fecha de entrega: la entrega es una, aunque la venta se
// toque cinco veces.

export const HOJA_AVISOS_ENTREGA = 'AvisosEntrega';
export const HEADERS_AVISOS_ENTREGA = ['clave', 'cliente', 'sucursal', 'fecha_entrega', 'fecha_aviso'];

export interface AvisoEntregaEnviado {
  clave: string;
  cliente: string;
  sucursal: string;
  fecha_entrega: string;
  fecha_aviso: string;
}

const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const claveAviso = (cliente: string, sucursal: string, fecha: string) =>
  `${norm(cliente)}|${norm(sucursal)}|${String(fecha || '').split(/[T ]/)[0]}`;

export async function avisosYaEnviados(): Promise<Set<string>> {
  const filas = await readSheet<AvisoEntregaEnviado>(HOJA_AVISOS_ENTREGA).catch(() => []);
  return new Set(filas.map((f) => String(f.clave || '').trim()).filter(Boolean));
}

export async function registrarAvisos(entregas: { cliente: string; sucursal: string; fecha: string }[]): Promise<void> {
  if (!entregas.length) return;
  await asegurarHoja(HOJA_AVISOS_ENTREGA, HEADERS_AVISOS_ENTREGA);
  await appendRowsObj(HOJA_AVISOS_ENTREGA, entregas.map((e) => ({
    clave: claveAviso(e.cliente, e.sucursal, e.fecha),
    cliente: e.cliente, sucursal: e.sucursal, fecha_entrega: e.fecha,
    fecha_aviso: new Date().toISOString(),
  })));
}
