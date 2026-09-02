// ── Destacados de uso de stock ────────────────────────────────────────────────────────
//
// El cierre mensual obligaba a leer la tabla entera de artículos para encontrar las tres o
// cuatro cosas que se fueron de línea. Esto las busca solo.
//
// Dos decisiones que definen qué es "grande":
//
// 1. El ranking es POR PLATA, no por porcentaje. Un artículo barato que se desvía 300% es
//    ruido; uno caro que se desvía 20% es el que hay que mirar. El porcentaje sigue estando
//    como filtro (abajo de UMBRAL_PCT no entra), pero no decide el orden.
// 2. No hay umbral en pesos. Con la inflación, cualquier número fijo queda viejo en meses y
//    empieza a dejar pasar todo. Se muestran los N más grandes del mes, sean cuales sean.
//
// Y una tercera, aprendida mirando la app con datos reales: si el stock final del mes no
// está cargado, no hay uso que analizar. La cuenta es `inicial + compras − final`, así que
// un final vacío se lee como cero y el "uso" da igual a todo el stock inicial: en el mes en
// curso, antes del recuento, TODOS los artículos aparecían disparados 500%. Un artículo
// entra al análisis solo si su stock final fue cargado.
//
// Contra qué se compara: si el artículo tiene fórmula de uso teórico, contra eso, que es un
// target de verdad. Si no la tiene —fertilizantes, ácido, cajones, varios: ver
// categoriaSinUsoTeorico en usoTeorico.ts— contra el uso del mes pasado, que es un dato
// medido. Cuando existen las dos referencias, la segunda sirve para distinguir un consumo
// que cambió de una fórmula que quedó mal calibrada.

export const UMBRAL_PCT = 15;              // desvío relativo mínimo para entrar
export const UMBRAL_PCT_SIN_PRECIO = 30;   // sin precio no se puede rankear por plata: se exige más desvío
export const MAX_DESTACADOS = 4;

export interface FilaUso {
  id: string;
  articulo: string;
  unidad: string;
  ini: number;
  comp: number;
  fin: number;
  finCargado: boolean;   // si el recuento de fin de mes todavía no se hizo, no hay uso real
  usoReal: number;
  usoTeorico: number | null;
  usoMesPasado: number | null;
  precio: number | null;
}

export interface DestacadoUso {
  id: string;
  articulo: string;
  unidad: string;
  usoReal: number;
  referencia: 'teorico' | 'mes_pasado';
  esperado: number;
  desvio: number;              // usoReal − esperado: positivo = se usó de más
  desvioPct: number | null;    // null cuando el esperado es 0 y no hay porcentaje que calcular
  desvioPesos: number | null;  // null si el artículo no tiene precio cargado
  detalle: string;             // la cuenta de dónde sale el uso real
  nota: string;                // la lectura: consumo que cambió vs. fórmula mal calibrada
}

const fmtN = (n: number) => Math.abs(n) >= 100 ? Math.round(n).toLocaleString('es-AR') : String(Math.round(n * 10) / 10);

export interface AnalisisUso {
  destacados: DestacadoUso[];
  sinStockFinal: number;   // artículos con movimiento en el mes pero sin recuento final cargado
}

export function analizarDesviosDeUso(filas: FilaUso[], max = MAX_DESTACADOS): AnalisisUso {
  const candidatos: DestacadoUso[] = [];
  let sinStockFinal = 0;

  for (const f of filas) {
    // Sin nada cargado este mes no hay uso que comparar (y "0 − 0" no es un desvío).
    if (!f.ini && !f.comp && !f.fin) continue;

    // Mes todavía sin cerrar: el uso daría igual a todo el stock inicial. No es un desvío,
    // es un dato que falta — y decirlo sirve más que inventar una alerta.
    if (!f.finCargado) { sinStockFinal++; continue; }

    const tieneTeorico = f.usoTeorico !== null && f.usoTeorico > 0;
    const tieneMesPasado = f.usoMesPasado !== null && f.usoMesPasado > 0;
    if (!tieneTeorico && !tieneMesPasado) continue;

    const referencia: 'teorico' | 'mes_pasado' = tieneTeorico ? 'teorico' : 'mes_pasado';
    const esperado = (tieneTeorico ? f.usoTeorico : f.usoMesPasado) as number;
    const desvio = f.usoReal - esperado;
    const desvioPct = esperado > 0 ? (desvio / esperado) * 100 : null;
    if (desvioPct !== null && Math.abs(desvioPct) < UMBRAL_PCT) continue;

    const desvioPesos = f.precio !== null ? desvio * f.precio : null;
    if (desvioPesos === null && (desvioPct === null || Math.abs(desvioPct) < UMBRAL_PCT_SIN_PRECIO)) continue;

    candidatos.push({
      id: f.id,
      articulo: f.articulo,
      unidad: f.unidad,
      usoReal: f.usoReal,
      referencia,
      esperado,
      desvio,
      desvioPct,
      desvioPesos,
      detalle: `inicial ${fmtN(f.ini)} + compras ${fmtN(f.comp)} − final ${fmtN(f.fin)}`,
      nota: leerDesvio(f, referencia, desvio),
    });
  }

  // Primero los que se pueden medir en plata, ordenados por cuánta mueven; después los que
  // no tienen precio, por desvío relativo. Así el que no tiene precio cargado no desaparece,
  // pero tampoco le gana a uno que sí se puede cuantificar.
  const conPlata = candidatos.filter((c) => c.desvioPesos !== null)
    .sort((a, b) => Math.abs(b.desvioPesos!) - Math.abs(a.desvioPesos!));
  const sinPlata = candidatos.filter((c) => c.desvioPesos === null)
    .sort((a, b) => Math.abs(b.desvioPct ?? 0) - Math.abs(a.desvioPct ?? 0));
  return { destacados: [...conPlata, ...sinPlata].slice(0, max), sinStockFinal };
}

// La app no puede saber POR QUÉ se desvió — eso lo sabe quien estuvo en el galpón. Lo que sí
// puede hacer es cruzar las dos referencias, que es la pregunta previa: ¿cambió el consumo, o
// está mal la fórmula? Si el mes pasado se usó parecido a lo que se usó ahora, el que quedó
// raro es el teórico. Si los dos dicen lo mismo, el consumo cambió de verdad.
function leerDesvio(f: FilaUso, referencia: 'teorico' | 'mes_pasado', desvio: number): string {
  const mas = desvio > 0;
  if (referencia === 'mes_pasado') {
    return `Sin fórmula de uso teórico: se compara contra el mes pasado. Se usó ${mas ? 'más' : 'menos'} que entonces.`;
  }
  if (f.usoMesPasado === null || f.usoMesPasado <= 0) {
    return `No hay uso del mes pasado para contrastar, así que la única referencia es el teórico.`;
  }
  const desvioMesPasado = f.usoReal - f.usoMesPasado;
  const pctMesPasado = (desvioMesPasado / f.usoMesPasado) * 100;
  if (Math.abs(pctMesPasado) < UMBRAL_PCT) {
    return `El mes pasado se usó casi lo mismo (${fmtN(f.usoMesPasado)} ${f.unidad}): parece que está desviada la fórmula, no el consumo.`;
  }
  if ((desvioMesPasado > 0) === mas) {
    return `También está ${Math.abs(Math.round(pctMesPasado))}% ${mas ? 'arriba' : 'abajo'} del mes pasado (${fmtN(f.usoMesPasado)} ${f.unidad}): el consumo cambió de verdad.`;
  }
  return `Contra el mes pasado va al revés (${fmtN(f.usoMesPasado)} ${f.unidad}): conviene revisar la carga de stock antes que el consumo.`;
}
