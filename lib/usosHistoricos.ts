// ── Uso de insumos anterior a la app ──────────────────────────────────────────────────
//
// De abril a agosto de 2026 el consumo se llevaba en el Excel de Marcelo, no en la app. Sin
// estos números el informe comparativo arranca en septiembre y no hay contra qué comparar
// el primer mes cerrado — justo cuando más sirve.
//
// Van en el código y no en una hoja a propósito: son datos de meses cerrados que no van a
// cambiar nunca. En una hoja habría que mantenerlos, se podrían editar por error, y
// costarían una lectura más en cada carga de la pantalla.
//
// A partir de septiembre de 2026 NO se usan: de ahí en adelante el uso sale de la app
// (inicial + compras − final), que es el dato propio y el que se puede auditar.
//
// Los negativos están tal cual los pasó Marcos. No son errores de transcripción: en el
// Excel salen de recuentos que dieron más de lo esperado, y corregirlos acá sería inventar.

export const ULTIMO_MES_HISTORICO = '2026-08';

// Por nombre de artículo y no por id: estos números vienen de un Excel donde los artículos
// no tienen id. Se cruzan con el catálogo por nombre normalizado (ver usoHistorico).
export const USOS_HISTORICOS: { articulo: string; meses: Record<string, number> }[] = [
  { articulo: 'Acido Nitrico 50%',            meses: { '2026-04': 11.2,   '2026-05': 18.23, '2026-06': 13.75, '2026-07': 16.85,  '2026-08': 12 } },
  { articulo: 'Cajones Plasticos',            meses: { '2026-04': 220,    '2026-05': 10,    '2026-06': 61,    '2026-07': -156,   '2026-08': 33 } },
  { articulo: 'Caja Oasis Lechuga',           meses: { '2026-04': -27945, '2026-05': 7245,  '2026-06': 10005, '2026-07': -2760,  '2026-08': 17940 } },
  { articulo: 'Caja Green Up Rucula',         meses: { '2026-04': -45540, '2026-05': 48990, '2026-06': 40710, '2026-07': 48645,  '2026-08': 46575 } },
  { articulo: 'Nitrato de K',                 meses: { '2026-04': 10,     '2026-05': 20.05, '2026-06': 19.4,  '2026-07': 22.45,  '2026-08': -14.35 } },
  { articulo: 'Nitrato de Ca Calcinit',       meses: { '2026-04': 14.9,   '2026-05': 30,    '2026-06': 22,    '2026-07': 45.5,   '2026-08': 15.5 } },
  { articulo: 'Fetrilon Combi2',              meses: { '2026-04': 0.5,    '2026-05': 0.9,   '2026-06': 0.9,   '2026-07': 0.95,   '2026-08': 0.45 } },
  { articulo: 'MKP Van Iperen',               meses: { '2026-04': 2,      '2026-05': 4.15,  '2026-06': 3.75,  '2026-07': 4.65,   '2026-08': 2.35 } },
  { articulo: 'Basafer Plus',                 meses: { '2026-04': 1.05,   '2026-05': 1.65,  '2026-06': 1,     '2026-07': 21.7,   '2026-08': 0.55 } },
  { articulo: 'Sulfato de Mg',                meses: { '2026-04': 10.3,   '2026-05': 20.45, '2026-06': 12,    '2026-07': 27.85,  '2026-08': -40.85 } },
  { articulo: 'MAP Van Iperen',               meses: { '2026-04': 1.2,    '2026-05': 2.45,  '2026-06': 2.75,  '2026-07': 2.45,   '2026-08': 1.55 } },
  { articulo: 'Bolsa Xavia Lechuga Con Marca', meses: { '2026-04': 6500,  '2026-05': 5530,  '2026-06': 5470,  '2026-07': 26630,  '2026-08': 5270 } },
  { articulo: 'Bolsa Xavia Rucula Con Marca',  meses: { '2026-04': 4920,  '2026-05': 4580,  '2026-06': 5200,  '2026-07': 21677,  '2026-08': 5423 } },
  { articulo: 'Semilla Rucula',               meses: { '2026-04': 6264,   '2026-05': 2086,  '2026-06': 2228,  '2026-07': 2358,   '2026-08': 2326 } },
  { articulo: 'Semilla Espinaca',             meses: { '2026-04': 909,    '2026-05': -962,  '2026-06': 54,    '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Semilla Crespa',               meses: { '2026-04': 394,    '2026-05': 132,   '2026-06': 242,   '2026-07': -452,   '2026-08': 168 } },
  { articulo: 'Semilla Hoja de Roble',        meses: { '2026-04': 129,    '2026-05': 106,   '2026-06': 181,   '2026-07': 203,    '2026-08': 186 } },
  { articulo: 'Semilla Albahaca',             meses: { '2026-04': 84,     '2026-05': -86,   '2026-06': 1,     '2026-07': 0,      '2026-08': 70 } },
  { articulo: 'Nativo (Fungicida)',           meses: { '2026-04': 0.75,   '2026-05': -0.7,  '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Bayer Serenade',               meses: { '2026-04': -1.3,   '2026-05': 1.3,   '2026-06': 1.7,   '2026-07': -2.6,   '2026-08': 1.4 } },
  { articulo: 'AntiEscalante',                meses: { '2026-04': 5,      '2026-05': 0.1,   '2026-06': 5.9,   '2026-07': -3.75,  '2026-08': 8.8 } },
  { articulo: 'Agua oxigenada',               meses: { '2026-04': 0,      '2026-05': 0,     '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Alchohol',                     meses: { '2026-04': 0,      '2026-05': 0,     '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Tracer (Insecticida emergencia)', meses: { '2026-04': 0,   '2026-05': 0,     '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Imida (insecticida)',          meses: { '2026-04': 0,      '2026-05': 0,     '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
  { articulo: 'Bacilus Subtillis',            meses: { '2026-04': 0,      '2026-05': 0,     '2026-06': 0,     '2026-07': 0,      '2026-08': 0 } },
];

// ── Emparejar los nombres del Excel con los del catálogo ─────────────────────────────
//
// Los dos nombres son los mismos insumos escritos por personas distintas: "Caja Green Up
// Rucula" acá, "Caja Green-Up Rúcula x 5kg" allá. Comparar el texto entero no los une.
//
// Se comparan las PALABRAS. Si todas las palabras del nombre del Excel aparecen en el del
// catálogo —aunque el catálogo tenga alguna de más— es el mismo insumo. Si no, se pide un
// parecido alto y que no haya empate: dos candidatos igual de buenos significan que la app
// no puede decidir, y elegir uno al azar imputaría el consumo al artículo equivocado.
//
// Lo que la app empareja sola queda a la vista en la pantalla, para poder desconfiar.

const SIN_VALOR = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'x', 'por', 'y']);

const palabras = (s: any): string[] => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter((w) => w && !SIN_VALOR.has(w));

const clave = (s: any) => palabras(s).join('');

// Cuánto se parecen dos nombres, de 0 a 1.
function parecido(a: string, b: string): number {
  const pa = palabras(a), pb = palabras(b);
  if (!pa.length || !pb.length) return 0;
  const sb = new Set(pb);
  const comunes = pa.filter((w) => sb.has(w)).length;
  // Todas las palabras del Excel están en el del catálogo: es el mismo insumo con más
  // detalle del otro lado ("Semilla Crespa" / "Semilla Lechuga Crespa").
  if (comunes === pa.length) return 1;
  return (2 * comunes) / (pa.length + pb.length);
}

export interface Emparejamiento {
  excel: string;
  articulo: string | null;   // nombre en el catálogo, o null si no se pudo
  exacto: boolean;
  parecido: number;
  // Si todos los meses dan cero, no hay nada que comparar. Se guarda igual —el día que ese
  // insumo se use, los ceros son el historial correcto— pero no se reclama que falte el
  // artículo: sería pedir que se cree un artículo para mostrar una fila de ceros.
  tieneConsumo: boolean;
}

const UMBRAL = 0.6;

// Empareja cada nombre del Excel con un artículo del catálogo.
export function emparejarHistoricos(nombresDelCatalogo: string[]): Emparejamiento[] {
  return USOS_HISTORICOS.map((u) => {
    const tieneConsumo = Object.values(u.meses).some((v) => Number(v) !== 0);
    const exacto = nombresDelCatalogo.find((n) => clave(n) === clave(u.articulo));
    if (exacto) return { excel: u.articulo, articulo: exacto, exacto: true, parecido: 1, tieneConsumo };

    const puntajes = nombresDelCatalogo
      .map((n) => ({ n, p: parecido(u.articulo, n) }))
      .sort((a, b) => b.p - a.p);
    const mejor = puntajes[0];
    const segundo = puntajes[1];
    // Empate técnico: la app no puede decidir y elegir al azar imputaría el consumo al
    // artículo equivocado, que es peor que no mostrar la fila.
    const hayEmpate = !!segundo && mejor && Math.abs(mejor.p - segundo.p) < 0.05;
    if (!mejor || mejor.p < UMBRAL || hayEmpate) {
      return { excel: u.articulo, articulo: null, exacto: false, parecido: mejor?.p ?? 0, tieneConsumo };
    }
    return { excel: u.articulo, articulo: mejor.n, exacto: false, parecido: mejor.p, tieneConsumo };
  });
}

// El uso histórico de un artículo del catálogo en un mes, o null si no hay dato.
//
// Devuelve null de septiembre de 2026 en adelante aunque hubiera número: a partir de ahí
// manda la app, que es el dato que se puede auditar contra el stock contado.
export function usoHistoricoDe(
  nombreArticulo: string, anio: number, mes: number, pares: Emparejamiento[],
): number | null {
  const mk = `${anio}-${String(mes).padStart(2, '0')}`;
  if (mk > ULTIMO_MES_HISTORICO) return null;
  const par = pares.find((x) => x.articulo && clave(x.articulo) === clave(nombreArticulo));
  if (!par) return null;
  const fila = USOS_HISTORICOS.find((u) => clave(u.articulo) === clave(par.excel));
  const v = fila?.meses[mk];
  return typeof v === 'number' ? v : null;
}
