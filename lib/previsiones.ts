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
export const HEADERS_PREVISIONES = ['id_prevision', 'anio', 'mes', 'despidos', 'sac', 'alquiler', 'epe', 'usado_despidos', 'usado_sac', 'notas', 'usuario', 'fecha_carga'];

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
  // ── Lo que se USÓ de la previsión este mes ─────────────────────────────────────────
  //
  // Una previsión se acumula mes a mes y en algún momento se gasta: el aguinaldo se paga en
  // junio y en diciembre, una indemnización el mes que toca. Ese pago entra como gasto de
  // sueldos, pero NO es costo nuevo de ese mes — se venía reservando desde hace meses, y
  // cada uno de esos meses ya lo cargó en su resultado.
  //
  // Sin esto, el mes del aguinaldo mostraba el pago entero COMO SI fuera costo de ese mes,
  // además de su propia previsión. El costo laboral aparecía dos veces: una repartido a lo
  // largo del año y otra de golpe, y junio y diciembre quedaban rotos.
  //
  // Lo que se usa se resta de la previsión del mes (ver lib/eerr.ts), así que el resultado
  // del mes del pago vuelve a mostrar solo lo que de verdad se devengó ese mes.
  usado_despidos: number | string;
  usado_sac: number | string;
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
  usadoDespidos?: number; usadoSac?: number;
  notas?: string; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_PREVISIONES, HEADERS_PREVISIONES);
  // asegurarHoja solo crea la hoja si falta: una planilla que ya venía de antes no tiene
  // estas dos columnas, y updateRow falla si escribe en una columna que no existe.
  await asegurarColumna(HOJA_PREVISIONES, 'alquiler');
  await asegurarColumna(HOJA_PREVISIONES, 'epe');
  await asegurarColumna(HOJA_PREVISIONES, 'usado_despidos');
  await asegurarColumna(HOJA_PREVISIONES, 'usado_sac');
  const id = idPrevision(args.anio, args.mes);
  const fila = {
    id_prevision: id,
    anio: args.anio,
    mes: args.mes,
    despidos: args.despidos,
    sac: args.sac,
    alquiler: args.alquiler,
    epe: args.epe,
    usado_despidos: Math.max(0, Math.round(args.usadoDespidos || 0)),
    usado_sac: Math.max(0, Math.round(args.usadoSac || 0)),
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

const numPrev = (v: any) => Number(v) || 0;

// ── Cuánta previsión hay guardada sin usar ───────────────────────────────────────────
//
// El saldo que viene de ARRASTRE: todo lo previsto en meses anteriores menos todo lo que ya
// se usó. Es el número que hay que ver al pagar el aguinaldo, porque es lo que se puede
// consumir sin que el mes muestre un costo que ya se había cargado antes.
//
// No incluye el mes que se está mirando: ese todavía se está decidiendo, y ofrecer como
// disponible una previsión que no se guardó sería ofrecer plata que no se reservó.
export function acumuladoPrevisiones(
  filas: PrevisionMes[], anio: number, mes: number,
): { despidos: number; sac: number } {
  let despidos = 0, sac = 0;
  for (const f of filas || []) {
    const a = Number(f.anio), m = Number(f.mes);
    if (!a || !m) continue;
    if (a * 12 + m >= anio * 12 + mes) continue;  // solo meses anteriores
    despidos += numPrev(f.despidos) - numPrev(f.usado_despidos);
    sac += numPrev(f.sac) - numPrev(f.usado_sac);
  }
  // Un acumulado negativo significaría que se usó más de lo que se previó. Puede pasar
  // —el primer aguinaldo después de empezar a prever— y no es un error: es que la reserva
  // no alcanzaba. Se muestra en cero porque como "disponible" no hay nada.
  return { despidos: Math.max(0, Math.round(despidos)), sac: Math.max(0, Math.round(sac)) };
}
