// ── Importes imposibles ──────────────────────────────────────────────────────────────
//
// Aparecieron compras de $383.000.000 cargadas sin querer. Un número así no se detecta
// mirando: en una tabla de montos con separadores de miles, uno de nueve dígitos se parece
// bastante a uno de seis, y una vez adentro arrastra el total del mes, el EERR y el costo
// por kilo sin que nada avise.
//
// No se BLOQUEA, se pregunta. Un tope fijo siempre termina siendo chico el día que hay una
// compra grande de verdad, y lo que se gana con bloquear se pierde cuando alguien no puede
// cargar algo real. Preguntar frena el error de tipeo y deja pasar lo legítimo.
//
// El umbral sale de la propia historia: cinco veces el gasto más grande que se cargó en el
// último año. Así se adapta solo a medida que el negocio crece, en vez de quedar viejo.

const PISO = 2_000_000;      // mientras no haya historia suficiente
const FACTOR = 5;

export function umbralSospecha(montosHistoricos: number[]): number {
  const maximo = (montosHistoricos || []).reduce((a, m) => Math.max(a, Math.abs(Number(m) || 0)), 0);
  return Math.max(PISO, Math.round(maximo * FACTOR));
}

// Devuelve el texto de la advertencia, o null si el monto es plausible.
export function avisoMontoSospechoso(monto: number, montosHistoricos: number[]): string | null {
  const m = Math.abs(Number(monto) || 0);
  if (!m) return null;
  const umbral = umbralSospecha(montosHistoricos);
  if (m <= umbral) return null;

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const maximo = (montosHistoricos || []).reduce((a, x) => Math.max(a, Math.abs(Number(x) || 0)), 0);
  return [
    `${fmt(m)} es mucho más grande que cualquier gasto del último año`,
    maximo > 0 ? ` (el mayor fue ${fmt(maximo)})` : '',
    '.\n\n¿Está bien el número? Si te sobraron ceros, cancelá y corregilo.',
  ].join('');
}

// Una línea de costo que supera las ventas del mes no puede ser real: significaría que cada
// peso vendido costó más de un peso solo en ese renglón. Casi siempre es un gasto cargado
// con ceros de más, y hasta que alguien lo nota el resultado del mes está mal.
export function lineasImposibles(
  lineas: { label: string; monto: number }[], totalVentas: number,
): { label: string; monto: number }[] {
  if (!(totalVentas > 0)) return [];
  return (lineas || []).filter((l) => Math.abs(l.monto) > totalVentas);
}
