// ══ Compras en cuotas ══════════════════════════════════════════════════════════════════
//
// Una compra en cuotas no es un gasto que se paga de a poco: son N gastos, uno por mes, cada
// uno con su fecha y su medio de pago. Por eso se escriben las N filas en el momento de
// cargarla, no una por mes con una tarea que corre después.
//
// Esa decisión es a propósito. Una tarea mensual que va creando la cuota que toca falla en
// silencio: si un mes no corre, la cuota no existe y nadie se entera hasta que el EERR de ese
// mes cierra de menos. Con las N filas escritas de entrada, la compra entera está a la vista
// el día que se carga —se puede revisar, corregir o borrar— y el resultado de cada mes y el
// saldo de cada cuenta ya la tienen contada desde el principio, incluso para los meses que
// todavía no llegaron. Que es justo lo que se quiere saber al comprar en cuotas.
//
// La contrapartida es que las cuotas futuras existen antes de haberse pagado. Para una compra
// con tarjeta eso es exactamente la realidad —la tarjeta se debita una cuota por mes— y es
// como se venían cargando los gastos de tarjeta.

export const MAX_CUOTAS = 36;

export interface Cuota {
  nro: number;        // 1..total
  total: number;      // cuántas cuotas tiene la compra
  fecha: string;      // YYYY-MM-DD — el mismo día del mes, corrido N meses
  monto: number;      // la parte de esta cuota
  descripcion: string;
}

// El día `dia` del mes `mes` (0-11) de `anio`, recortado al último día si ese mes no llega:
// una compra del 31 de enero en 3 cuotas vence el 28 de febrero, no el 3 de marzo.
function fechaDeCuota(anio: number, mes: number, dia: number): string {
  // `mes` puede venir fuera de 0-11 (una compra de noviembre en 3 cuotas pide el mes 12), así
  // que el año y el mes se normalizan con un Date en vez de armarse a mano: hacerlo a mano
  // escribía "2026-13-15" y esa fecha no cae en ningún mes.
  const norm = new Date(anio, mes, 1);
  const a = norm.getFullYear(), m = norm.getMonth();
  const ultimoDiaDelMes = new Date(a, m + 1, 0).getDate();
  const d = Math.min(dia, ultimoDiaDelMes);
  return `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface PlanCuotasInput {
  fecha: string;        // fecha de la compra — la primera cuota cae acá
  descripcion: string;
  montoTotal: number;   // el precio de la compra, NO el de la cuota
  cuotas: number;
}

// El reparto del monto total en cuotas, en centavos, de forma que la suma dé EXACTAMENTE el
// total. $100.000 en 3 no son tres de $33.333,33: son dos de $33.333,34 y una de $33.333,32,
// o alguna combinación que cierre. Repartir el resto en las primeras cuotas (como hacen las
// tarjetas) y no arrastrar el redondeo es lo que evita que el gasto cargado y la suma de sus
// cuotas difieran por unos pesos — una diferencia chica que después aparece como un descuadre
// inexplicable en el EERR o en el saldo de la tarjeta.
export function planDeCuotas({ fecha, descripcion, montoTotal, cuotas }: PlanCuotasInput): Cuota[] {
  const n = Math.floor(Number(cuotas) || 0);
  if (n < 2 || n > MAX_CUOTAS) return [];
  const [anio, mes, dia] = String(fecha).split('-').map(Number);
  if (!anio || !mes || !dia) return [];

  const signo = montoTotal < 0 ? -1 : 1;
  const totalCent = Math.round(Math.abs(Number(montoTotal) || 0) * 100);
  const base = Math.floor(totalCent / n);
  const resto = totalCent - base * n; // cuántas cuotas llevan un centavo más

  const out: Cuota[] = [];
  for (let i = 0; i < n; i++) {
    const cent = base + (i < resto ? 1 : 0);
    out.push({
      nro: i + 1,
      total: n,
      fecha: fechaDeCuota(anio, mes - 1 + i, dia),
      monto: (signo * cent) / 100,
      descripcion: `${String(descripcion).trim()} (cuota ${i + 1}/${n})`,
    });
  }
  return out;
}

// Las categorías que no pueden ir en cuotas, con el motivo que se le muestra a quien carga.
// No es una restricción de forma: en cada uno de estos casos partir el monto rompe otra cosa.
export function motivoSinCuotas(categoria: string): string | null {
  if (categoria === 'movimiento_interno') {
    return 'Un movimiento entre cuentas es plata que ya se movió de una punta a la otra: no tiene cuotas. Si lo que estás pagando en cuotas es una compra, elegí la categoría de esa compra.';
  }
  if (categoria === 'adelanto_sueldo') {
    return 'Un adelanto de sueldo es plata que ya se entregó. Si se devuelve en varias veces, eso se descuenta del sueldo, no se carga como cuotas de un gasto.';
  }
  return null;
}
