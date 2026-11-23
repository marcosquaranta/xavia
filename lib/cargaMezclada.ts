// ── El mismo cultivo cargado en unidades Y en cajones ────────────────────────────────
//
// Un cliente SÍ puede llevar unidades y cajones a la vez: rúcula en cajón y albahaca en
// paquete es una venta normal. Lo que no pasa es el mismo cultivo de las dos formas — la
// rúcula se vende en cajón o en paquete, no en los dos al mismo tiempo.
//
// Por eso el aviso es por CULTIVO y no por sucursal. Avisar cada vez que hay unidades y
// kilos juntos marcaría ventas correctas, y un aviso que salta sobre lo normal se aprende
// a ignorar — con lo cual el día que marca algo de verdad tampoco se mira.
//
// Y marca algo de verdad: esta combinación fue la que hizo perder los cajones de Mamina
// Funes. La línea llevaba las dos cosas, los cajones salieron mal en cero y, como las
// unidades no eran cero, la línea se guardó igual y los pisó.

// Qué clave por kilo le corresponde a cada clave por unidad. `lechuga_kg` es la vieja, sin
// distinguir variedad: choca con las dos lechugas, porque una venta cargada ahí es lechuga
// a granel igual.
const MISMO_CULTIVO: Record<string, string[]> = {
  rucula: ['rucula_kg'],
  bandeja_rucula: ['rucula_kg'],
  lechuga_crespa: ['lechuga_kg_crespa', 'lechuga_kg'],
  hoja_roble: ['lechuga_kg_roble', 'lechuga_kg'],
};

export interface ChoqueCultivo {
  // La clave por unidad y la clave por kilo que chocan, con sus cantidades.
  keyUnidad: string;
  keyKg: string;
  cantidadUnidad: number;
  cantidadKg: number;
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Los cultivos que vienen cargados de las dos formas en la misma fila.
export function choquesDeCarga(fila: Record<string, any>): ChoqueCultivo[] {
  const out: ChoqueCultivo[] = [];
  for (const [keyUnidad, keysKg] of Object.entries(MISMO_CULTIVO)) {
    const cu = num(fila?.[keyUnidad]);
    if (cu <= 0) continue;
    for (const keyKg of keysKg) {
      const ck = num(fila?.[keyKg]);
      if (ck <= 0) continue;
      out.push({ keyUnidad, keyKg, cantidadUnidad: cu, cantidadKg: ck });
    }
  }
  return out;
}

export function hayChoque(fila: Record<string, any>): boolean {
  return choquesDeCarga(fila).length > 0;
}

// Cómo se lee el choque, con los nombres que ve el que carga.
export function textoChoque(c: ChoqueCultivo, label: (k: string) => string): string {
  return `${label(c.keyUnidad)} (${c.cantidadUnidad} en unidades) y ${label(c.keyKg)} (en cajones)`;
}
