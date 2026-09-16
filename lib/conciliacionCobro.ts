// ── Qué facturas puede estar pagando un importe ───────────────────────────────────────
//
// Cuando entra una transferencia, lo que se sabe es el monto y el cliente: qué facturas
// cancela hay que deducirlo. Esto busca combinaciones de facturas pendientes cuya suma dé
// ese importe (o se le acerque) y las ordena por cuál es más probable.
//
// No decide nada: propone, y el que carga el cobro tilda. Dos motivos para que sea una
// sugerencia y no un automatismo: un mismo importe puede salir de varias combinaciones
// distintas, y un pago puede ser parcial o incluir algo que no está en la lista.

export interface FacturaCandidata {
  numero: string;
  fecha: string;      // YYYY-MM-DD
  importe: number;
  yaCobrada?: boolean;
}

export interface Combinacion {
  numeros: string[];
  total: number;
  diferencia: number;   // total − objetivo (negativo = falta plata para llegar)
  exacta: boolean;
  consecutivas: boolean; // comprobantes seguidos del cliente (ver corridas más abajo)
}

// Cuánto se permite que una combinación se aleje del importe cobrado. Existe porque en la
// práctica los pagos vienen con retenciones, redondeos o alguna nota de crédito chica: pedir
// coincidencia al peso dejaría afuera justo los casos reales.
export const TOLERANCIA_PCT = 2;
export const TOLERANCIA_MIN = 1000; // en pesos, para que en importes chicos el % no sea nada

export function toleranciaDe(objetivo: number): number {
  return Math.max(TOLERANCIA_MIN, Math.round((Math.abs(objetivo) * TOLERANCIA_PCT) / 100));
}

// Límites para que esto no se vuelva eterno ni cuelgue el navegador: el problema es una
// suma de subconjuntos, que crece 2^n. Con las facturas ordenadas de mayor a menor y podando
// por lo que queda por sumar, en la práctica se resuelve enseguida, pero igual hay un techo
// duro de pasos por si un cliente tiene muchas facturas parecidas.
const MAX_FACTURAS = 22;
const MAX_POR_COMBINACION = 6;
const MAX_PASOS = 200_000;
const MAX_RESULTADOS = 6;
// Se juntan más de las que se muestran y recién al final se ordenan y se cortan: si se
// cortara durante la búsqueda, la primera que aparece taparía a una exacta que estaba más
// abajo en el recorrido.
const MAX_ACUMULADAS = 60;

// Cuántos comprobantes seguidos se prueban como "corrida". Más de cuatro de una ya no es un
// pago suelto, es una cuenta corriente al día.
const MAX_CORRIDA = 4;

// Comprobantes SEGUIDOS del cliente. Es el patrón más común después del pago de una sola
// factura: se junta lo emitido en un período y se paga todo junto. "Seguidos" se mide sobre
// la lista del cliente ordenada por fecha —no por número de comprobante— porque entre dos
// facturas a un mismo cliente hay facturas a todos los demás, así que la numeración salta.
function corridas(facturas: FacturaCandidata[]): string[][] {
  const orden = [...facturas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const out: string[][] = [];
  for (let largo = 2; largo <= MAX_CORRIDA; largo++) {
    for (let i = 0; i + largo <= orden.length; i++) {
      out.push(orden.slice(i, i + largo).map((f) => f.numero));
    }
  }
  return out;
}

// Combinaciones de facturas que suman `objetivo` (± tolerancia), de la más probable a la
// menos. Criterio de "más probable", en orden:
//   1. la que da exacto,
//   2. la que usa menos facturas — un pago suele cancelar una o dos, no seis,
//   3. la de comprobantes seguidos, que es como se paga cuando se junta más de una,
//   4. la que incluye las facturas MÁS NUEVAS: las viejas, si siguen en la lista, lo más
//      probable es que ya se hayan pagado y todavía no esté registrado.
export function sugerirCombinaciones(
  facturas: FacturaCandidata[], objetivo: number, opciones: { incluirYaCobradas?: boolean } = {},
): Combinacion[] {
  const obj = Math.round(objetivo);
  if (!(obj > 0)) return [];
  const tol = toleranciaDe(obj);

  // Las ya cobradas quedan afuera por defecto: si el cobro anterior las canceló, volver a
  // proponerlas es justamente el error que se quiere evitar.
  const candidatas = facturas
    .filter((f) => (opciones.incluirYaCobradas ? true : !f.yaCobrada) && Math.round(f.importe) > 0)
    .sort((a, b) => b.importe - a.importe)
    .slice(0, MAX_FACTURAS);
  if (!candidatas.length) return [];

  const imp = candidatas.map((f) => Math.round(f.importe));
  // Suma de lo que queda de cada posición en adelante, para poder podar: si con TODO lo que
  // queda no se llega ni al piso de la tolerancia, no tiene sentido seguir por esa rama.
  const restante: number[] = new Array(imp.length + 1).fill(0);
  for (let i = imp.length - 1; i >= 0; i--) restante[i] = restante[i + 1] + imp[i];

  const out: Combinacion[] = [];
  let pasos = 0;

  const dfs = (i: number, suma: number, elegidas: number[]) => {
    if (out.length >= MAX_ACUMULADAS || pasos > MAX_PASOS) return;
    pasos++;
    if (elegidas.length) {
      const dif = suma - obj;
      if (Math.abs(dif) <= tol) {
        out.push({
          numeros: elegidas.map((k) => candidatas[k].numero),
          total: suma,
          diferencia: dif,
          exacta: dif === 0,
          consecutivas: false, // se marca abajo, cuando están todas juntas
        });
        // Si ya se llegó o se pasó, sumar otra factura solo aleja. Pero si todavía falta
        // plata (dif < 0), puede haber una factura chica que la deje exacta: se sigue.
        if (dif >= 0) return;
      }
    }
    if (i >= imp.length || elegidas.length >= MAX_POR_COMBINACION) return;
    if (suma - obj > tol) return;                    // ya se pasó: sumar más empeora
    if (suma + restante[i] < obj - tol) return;      // ni con todo lo que queda se llega
    for (let k = i; k < imp.length; k++) {
      dfs(k + 1, suma + imp[k], [...elegidas, k]);
      if (out.length >= MAX_ACUMULADAS || pasos > MAX_PASOS) return;
    }
  };
  dfs(0, 0, []);

  // Las corridas se agregan aparte de la búsqueda general. La búsqueda recorre las facturas
  // de mayor a menor importe y tiene tope de pasos: una corrida de tres comprobantes chicos
  // podía quedar sin explorar. Probarlas explícitamente es barato y garantiza que estén.
  const impDe = new Map(candidatas.map((f) => [f.numero, Math.round(f.importe)]));
  const yaEsta = new Set(out.map((c) => [...c.numeros].sort().join('|')));
  for (const grupo of corridas(candidatas)) {
    const total = grupo.reduce((a, n) => a + (impDe.get(n) || 0), 0);
    const dif = total - obj;
    if (Math.abs(dif) > tol) continue;
    const clave = [...grupo].sort().join('|');
    if (yaEsta.has(clave)) continue;
    yaEsta.add(clave);
    out.push({ numeros: grupo, total, diferencia: dif, exacta: dif === 0, consecutivas: true });
  }

  // Marcar como consecutivas las que la búsqueda general ya había encontrado.
  const clavesCorridas = new Set(corridas(candidatas).map((g) => [...g].sort().join('|')));
  for (const c of out) {
    if (c.numeros.length > 1 && clavesCorridas.has([...c.numeros].sort().join('|'))) c.consecutivas = true;
  }

  // Fecha promedio de cada combinación, para el desempate: se prefiere la MÁS NUEVA.
  const fechaDe = new Map(candidatas.map((f) => [f.numero, f.fecha]));
  const reciente = (c: Combinacion) =>
    c.numeros.reduce((a, n) => a + (fechaDe.get(n) ? Number(String(fechaDe.get(n)).replace(/-/g, '')) : 0), 0) / c.numeros.length;

  // Dentro de la lista final, las combinaciones quedan ordenadas por fecha descendente para
  // que al tildarlas se vea primero lo último emitido.
  for (const c of out) c.numeros.sort((a, b) => String(fechaDe.get(b) || '').localeCompare(String(fechaDe.get(a) || '')));

  return out
    .sort((a, b) =>
      (a.exacta === b.exacta ? 0 : a.exacta ? -1 : 1) ||
      a.numeros.length - b.numeros.length ||
      (a.consecutivas === b.consecutivas ? 0 : a.consecutivas ? -1 : 1) ||
      Math.abs(a.diferencia) - Math.abs(b.diferencia) ||
      reciente(b) - reciente(a))
    .slice(0, MAX_RESULTADOS);
}
