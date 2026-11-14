// ── Qué facturas paga un cobro que no dice cuáles paga ───────────────────────────────
//
// El registro automático exige que el aviso nombre las facturas. Cuando las nombra y las
// cuentas cierran, no hay nada que interpretar y se registra solo. Pero muchos avisos no
// las nombran: llega una transferencia por $208.293 y nada más.
//
// Y sin embargo hay casos donde la respuesta es tan verificable como la del aviso que sí
// las nombra: el cliente tiene UNA sola factura abierta de ese importe exacto, o tiene tres
// y suman exactamente eso. Esos no son una suposición, son una identidad aritmética — la
// misma que ya habilita el registro automático cuando el aviso las lista.
//
// LO QUE SÍ ES UNA SUPOSICIÓN, y por eso se frena: que haya DOS combinaciones distintas de
// facturas abiertas que sumen lo mismo. Ahí no hay forma de saber cuál pagó el cliente, y
// elegir una es imputar plata a una factura que quizás sigue impaga mientras otra queda
// cancelada sin que nadie la haya pagado. Ese error es silencioso y aparece meses después.
//
// Entonces: se busca, y solo se contesta cuando la respuesta es única. Cuando no lo es, se
// devuelve por qué, con las opciones encontradas, para que una persona elija en un clic en
// vez de tener que armar la cuenta de cero.

export interface FacturaAbierta {
  numero: string;
  fecha: string;     // YYYY-MM-DD
  importe: number;
}

export type ViaImputacion = 'unica' | 'todas' | 'mas_viejas' | 'combinacion';

export interface ImputacionEncontrada {
  numeros: string[];
  suma: number;
  via: ViaImputacion;
}

export type ResultadoImputacion =
  | { ok: true; imputacion: ImputacionEncontrada }
  | { ok: false; motivo: string; opciones?: string[][] };

// Cuántas facturas abiertas se pueden combinar antes de dejar de buscar. Con 18 ya son
// 262.144 combinaciones; más arriba el tiempo se dispara y además un cliente con treinta
// facturas abiertas tiene tantas combinaciones posibles que ninguna sería única.
export const MAX_FACTURAS_COMBINAR = 18;

// Cuántas soluciones distintas se buscan antes de darse por vencido. Con dos ya alcanza
// para saber que no es única; la tercera no agrega nada.
const MAX_SOLUCIONES = 4;

export const TOLERANCIA_PESOS = 2;

const r = (n: number) => Math.round(Number(n) || 0);

// Todos los subconjuntos que suman el objetivo, hasta MAX_SOLUCIONES. Se recorre con poda:
// las facturas van ordenadas de mayor a menor y se corta en cuanto lo que falta es negativo
// o lo que queda por delante no alcanza.
function subconjuntosQueSuman(
  facturas: FacturaAbierta[], objetivo: number, tolerancia: number,
): number[][] {
  const orden = facturas
    .map((f, i) => ({ i, importe: r(f.importe) }))
    .sort((a, b) => b.importe - a.importe);

  // Lo que queda por sumar desde cada posición hacia adelante: si eso no alcanza para
  // llegar al objetivo, no hay nada que explorar.
  const restante: number[] = new Array(orden.length + 1).fill(0);
  for (let i = orden.length - 1; i >= 0; i--) restante[i] = restante[i + 1] + orden[i].importe;

  const soluciones: number[][] = [];
  const actual: number[] = [];

  const buscar = (pos: number, falta: number) => {
    if (soluciones.length >= MAX_SOLUCIONES) return;
    if (Math.abs(falta) <= tolerancia && actual.length) { soluciones.push([...actual]); return; }
    if (pos >= orden.length) return;
    if (falta < -tolerancia) return;
    if (restante[pos] + tolerancia < falta) return;

    // Con esta factura.
    actual.push(orden[pos].i);
    buscar(pos + 1, falta - orden[pos].importe);
    actual.pop();
    // Sin ella.
    buscar(pos + 1, falta);
  };

  buscar(0, r(objetivo));
  return soluciones;
}

const numerosDe = (facturas: FacturaAbierta[], idx: number[]) =>
  idx.map((i) => facturas[i].numero);

// Las N más viejas, que es como se paga en la práctica y como la app reparte los cobros
// que Xubio no imputa. Si ese prefijo da exacto, es la respuesta más defendible que hay.
function prefijoMasViejo(facturas: FacturaAbierta[], objetivo: number, tolerancia: number): number[] | null {
  const porFecha = facturas
    .map((f, i) => ({ i, fecha: String(f.fecha || ''), importe: r(f.importe) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  let suma = 0;
  const idx: number[] = [];
  for (const x of porFecha) {
    suma += x.importe;
    idx.push(x.i);
    if (Math.abs(suma - r(objetivo)) <= tolerancia) return [...idx];
    if (suma > r(objetivo) + tolerancia) return null;
  }
  return null;
}

export function imputacionExacta(
  abiertas: FacturaAbierta[],
  objetivo: number,
  tolerancia = TOLERANCIA_PESOS,
  maxCombinar = MAX_FACTURAS_COMBINAR,
): ResultadoImputacion {
  const facturas = (abiertas || []).filter((f) => f && f.numero && r(f.importe) > 0);
  const total = r(objetivo);
  if (!facturas.length) return { ok: false, motivo: 'el cliente no tiene facturas abiertas' };
  if (total <= 0) return { ok: false, motivo: 'el importe del cobro no es válido' };

  // ── Todas las abiertas ─────────────────────────────────────────────────────────────
  //
  // Pagó todo lo que debía. Es el único caso donde se puede contestar sin buscar: con
  // todos los importes positivos, no existe otro subconjunto que sume el total más que el
  // conjunto entero. Por eso va antes del tope de cantidad — un cliente con treinta
  // facturas que las paga todas no tiene nada de ambiguo.
  const sumaTodas = facturas.reduce((a, f) => a + r(f.importe), 0);
  if (Math.abs(sumaTodas - total) <= tolerancia) {
    return { ok: true, imputacion: { numeros: facturas.map((f) => f.numero), suma: sumaTodas, via: 'todas' } };
  }

  if (facturas.length > maxCombinar) {
    return { ok: false, motivo: `el cliente tiene ${facturas.length} facturas abiertas: son demasiadas combinaciones para decidir solo` };
  }

  // ── Se busca, y recién después se clasifica ────────────────────────────────────────
  //
  // Acá había un atajo: si UNA factura valía exactamente el importe del cobro, se contestaba
  // esa sin mirar nada más. Parecía el caso más claro de todos y es el más peligroso:
  // teniendo facturas de $30.000, $20.000 y $50.000, un cobro de $50.000 puede ser la de
  // $50.000 o las otras dos juntas. El atajo elegía la primera y nadie se enteraba — una
  // factura quedaba cancelada sin que el cliente la hubiera pagado y otra seguía abierta.
  //
  // Lo encontró un test: la unicidad no se puede suponer por la forma de la respuesta, hay
  // que comprobarla contra TODAS las respuestas posibles. Así que primero se busca todo, y
  // la forma de la solución única solo sirve para nombrarla.
  const soluciones = subconjuntosQueSuman(facturas, total, tolerancia);
  if (!soluciones.length) {
    return { ok: false, motivo: 'ninguna combinación de facturas abiertas suma ese importe' };
  }
  if (soluciones.length === 1) {
    const idx = soluciones[0];
    const viejo = prefijoMasViejo(facturas, total, tolerancia);
    const esPrefijo = !!viejo && viejo.length === idx.length && [...viejo].sort().join() === [...idx].sort().join();
    return {
      ok: true,
      imputacion: {
        numeros: numerosDe(facturas, idx),
        suma: idx.reduce((a, i) => a + r(facturas[i].importe), 0),
        via: idx.length === 1 ? 'unica' : esPrefijo ? 'mas_viejas' : 'combinacion',
      },
    };
  }

  // Varias combinaciones dan lo mismo. No se elige: se devuelven para que una persona
  // decida, que es muchísimo menos trabajo que armar la cuenta desde cero.
  return {
    ok: false,
    motivo: `hay ${soluciones.length >= MAX_SOLUCIONES ? 'varias' : soluciones.length} combinaciones de facturas que suman ese importe`,
    opciones: soluciones.map((idx) => numerosDe(facturas, idx)),
  };
}
