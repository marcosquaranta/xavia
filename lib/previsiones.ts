import { asegurarHoja, asegurarColumna, readSheet, updateRow, appendRowObj, deleteRow } from './sheets';

// ── Previsiones del mes ───────────────────────────────────────────────────────────────
//
// Despidos y SAC se calculan sobre la masa salarial del mes (6% y un doceavo), pero el
// valor guardado manda siempre: hay meses con ajustes que ninguna fórmula sabe, y la idea
// no es que la app decida sino que proponga y no te haga sacar la cuenta.
//
// Se guarda una fila por mes. Si el valor guardado coincide con la sugerencia, igual queda
// guardado: lo que importa es que el mes cerrado no cambie de números si mañana se corrige
// un sueldo cargado tarde. Un cierre que se mueve solo no sirve para comparar.

export const HOJA_PREVISIONES = 'Previsiones';
export const HEADERS_PREVISIONES = ['id_prevision', 'anio', 'mes', 'despidos', 'sac', 'alquiler', 'epe', 'notas', 'usuario', 'fecha_carga'];

export interface PrevisionMes {
  id_prevision: string;
  anio: number | string;
  mes: number | string;
  despidos: number | string;
  sac: number | string;
  // Alquiler y EPE no tienen fórmula: se ponen a mano, como en el Excel. Están acá para que
  // el bloque de cuenta corriente quede completo en un solo lugar.
  alquiler: number | string;
  epe: number | string;
  notas: string;
  usuario: string;
  fecha_carga: string;
}

export const idPrevision = (anio: number, mes: number) => `PREV-${anio}-${String(mes).padStart(2, '0')}`;

export async function leerPrevisiones(): Promise<PrevisionMes[]> {
  return readSheet<PrevisionMes>(HOJA_PREVISIONES).catch(() => []);
}

export function previsionDelMes(filas: PrevisionMes[], anio: number, mes: number): PrevisionMes | null {
  return filas.find((f) => String(f.id_prevision) === idPrevision(anio, mes)) ?? null;
}

export async function guardarPrevision(args: {
  anio: number; mes: number; despidos: number; sac: number; alquiler: number; epe: number;
  notas?: string; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_PREVISIONES, HEADERS_PREVISIONES);
  // asegurarHoja solo crea la hoja si falta: una planilla que ya venía de antes no tiene
  // estas dos columnas, y updateRow falla si escribe en una columna que no existe.
  await asegurarColumna(HOJA_PREVISIONES, 'alquiler');
  await asegurarColumna(HOJA_PREVISIONES, 'epe');
  const id = idPrevision(args.anio, args.mes);
  const fila = {
    id_prevision: id,
    anio: args.anio,
    mes: args.mes,
    despidos: args.despidos,
    sac: args.sac,
    alquiler: args.alquiler,
    epe: args.epe,
    notas: args.notas || '',
    usuario: args.usuario,
    fecha_carga: new Date().toISOString(),
  };
  // updateRow devuelve false si el mes todavía no existe: recién ahí se agrega.
  const actualizada = await updateRow(HOJA_PREVISIONES, 'id_prevision', id, fila);
  if (!actualizada) await appendRowObj(HOJA_PREVISIONES, fila);
}

// Para deshacer un guardado — por ejemplo, una fila de prueba que no representa una
// decisión real. El checklist del cierre lee "existe la fila" como "guardado este mes", así
// que dejar una fila de prueba hace aparecer un paso como resuelto sin que nadie lo haya hecho.
export async function borrarPrevision(anio: number, mes: number): Promise<boolean> {
  return deleteRow(HOJA_PREVISIONES, 'id_prevision', idPrevision(anio, mes));
}
