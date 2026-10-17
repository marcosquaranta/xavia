// Los objetivos del puesto de Marcelo, en un solo lugar.
//
// Antes el 95% de ocupación estaba escrito tres veces —en el texto de la tarjeta, en el
// umbral de color, y en la descripción del puesto— y nada garantizaba que fueran el mismo
// número. El día que se renegocie el objetivo, se cambia acá y cambia en todos lados.
//
// `objetivo: null` es un estado real y esperado, no un dato que falta por descuido: hay
// KPIs que se están midiendo justamente para poder fijarles un número con base. Mostrar
// "sin objetivo" es honesto; inventar uno para que la tarjeta quede completa, no.

export interface ObjetivoKpi {
  nombre: string;
  objetivo: number | null;
  unidad: string;
  // Cómo se lee el número: casi siempre más es mejor, pero si algún día se agrega un KPI
  // de descarte o de días de ciclo, cumplir es quedar POR DEBAJO del objetivo.
  mejor: 'alto' | 'bajo';
  nota?: string;
}

export const OBJETIVOS_MARCE = {
  ocupacion: {
    nombre: 'Ocupación de posiciones',
    objetivo: 95,
    unidad: '%',
    mejor: 'alto',
    nota: 'Promedio mensual, abierto por cultivo. Marcelo lo aceptó condicionado a resolver antes mejoras pendientes en plantinera.',
  },
  eficiencia: {
    nombre: 'Eficiencia siembra → cosecha',
    objetivo: 85,
    unidad: '%',
    mejor: 'alto',
    nota: 'Acordado con Marcos en septiembre de 2026. Mide descarte de las 3 etapas, sin ventas ni cámara.',
  },
  productividad: {
    nombre: 'Productividad de empleados',
    objetivo: null,
    unidad: ' pl/h',
    mejor: 'alto',
    nota: 'En medición.',
  },
} satisfies Record<string, ObjetivoKpi>;

export type ClaveObjetivo = keyof typeof OBJETIVOS_MARCE;

export interface Cumplimiento {
  valor: number;
  objetivo: number;
  pct: number;        // qué parte del objetivo se alcanzó, en %
  brecha: number;     // cuánto falta (negativo) o sobra (positivo), en la unidad del KPI
  cumple: boolean;
  texto: string;      // listo para mostrar
}

// Cumplimiento contra el objetivo. Devuelve null cuando no hay con qué comparar —sin
// objetivo fijado o sin dato del mes— en vez de un 0%, que se leería como "no cumplió".
export function cumplimientoObjetivo(
  valor: number | null | undefined, kpi: ObjetivoKpi,
): Cumplimiento | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  if (kpi.objetivo === null || !kpi.objetivo) return null;
  const objetivo = kpi.objetivo;
  // Con "más es mejor", cumplir es 100% o más. Con "menos es mejor" se invierte la razón,
  // así el 100% sigue significando lo mismo en las dos: se llegó a lo pedido.
  const pct = Math.round((kpi.mejor === 'alto' ? valor / objetivo : objetivo / valor) * 1000) / 10;
  const brecha = Math.round((kpi.mejor === 'alto' ? valor - objetivo : objetivo - valor) * 10) / 10;
  const cumple = brecha >= 0;
  const u = kpi.unidad;
  const signo = brecha > 0 ? '+' : '';
  // Cuando el KPI YA es un porcentaje, "109.9% del objetivo" y "+8.4%" son dos formas de
  // mentir sobre lo mismo: la brecha entre 93.4% y 85% son 8.4 PUNTOS, no un 8.4%, y el
  // "109.9% del objetivo" convierte un mes flojo en un logro. Para esos KPI se dice el
  // valor, el objetivo y la distancia en puntos, que es lo único que significa algo.
  const esPorcentaje = u === '%';
  const texto = esPorcentaje
    ? (cumple
        ? `✓ Objetivo cumplido — ${valor}% vs. ${objetivo}% de objetivo (${Math.abs(brecha)} ${Math.abs(brecha) === 1 ? 'punto' : 'puntos'} ${kpi.mejor === 'alto' ? 'arriba' : 'abajo'})`
        : `${valor}% vs. ${objetivo}% de objetivo — ${Math.abs(brecha)} ${Math.abs(brecha) === 1 ? 'punto' : 'puntos'} ${kpi.mejor === 'alto' ? 'abajo' : 'arriba'}`)
    : (cumple
        ? `✓ Objetivo cumplido — ${pct}% del objetivo (${signo}${brecha}${u} sobre ${objetivo}${u})`
        : `${pct}% del objetivo — faltan ${Math.abs(brecha)}${u} para llegar a ${objetivo}${u}`);
  return { valor, objetivo, pct, brecha, cumple, texto };
}
