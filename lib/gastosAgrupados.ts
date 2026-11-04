// ── Agrupar los gastos de una línea del EERR y compararlos con el mes anterior ───────
//
// Abrir un costo fijo mostraba la lista cruda de movimientos. Sirve para auditar, pero no
// para la pregunta que uno trae cuando abre: "¿por qué esta línea subió $760.000?". Con
// trece renglones sueltos, encontrar cuál de ellos cambió es un trabajo manual que la
// pantalla puede hacer sola.
//
// Así que se agrupa por concepto y se compara cada concepto contra el mismo concepto del
// mes anterior. Lo que aparece arriba de todo es lo que más se movió, que es la respuesta.
//
// EL RIESGO de agrupar es juntar cosas que no van juntas. "Sueldo Gustavo" y "Sueldo
// Marce" son dos personas, y si se agruparan por la palabra "sueldo" la comparación
// mentiría. Por eso la normalización saca números y puntuación —lo que cambia entre
// repeticiones del MISMO gasto: fechas, importes, números de factura— pero conserva las
// palabras, que es lo que distingue un gasto de otro.

export interface GastoItem {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  monto: number;
  medio_pago: string;
}

export interface GrupoGasto {
  // Cómo se escribió la primera vez: se muestra eso y no la forma normalizada, que es
  // ilegible. La normalización sirve para agrupar, no para leer.
  label: string;
  monto: number;
  montoPrev: number;
  // null cuando el concepto no existía el mes pasado: no es "subió 100%", es nuevo, y son
  // dos cosas distintas para el que mira.
  dif: number | null;
  esNuevo: boolean;
  items: GastoItem[];
}

// Se agrupan ignorando mayúsculas, acentos, números y signos. Lo que queda son las
// palabras: "FLHORAGRO fact 0012-45" y "Flhoragro factura 0013-02" caen en el mismo grupo,
// y "Sueldo Gustavo" y "Sueldo Marce" NO, que es exactamente lo que se busca.
export function claveConcepto(descripcion: string): string {
  return String(descripcion || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function agruparGastos(items: GastoItem[], itemsPrev: GastoItem[] = []): GrupoGasto[] {
  const prevPorClave = new Map<string, number>();
  for (const g of itemsPrev || []) {
    const k = claveConcepto(g.descripcion);
    prevPorClave.set(k, (prevPorClave.get(k) || 0) + (Number(g.monto) || 0));
  }

  const grupos = new Map<string, GrupoGasto>();
  for (const g of items || []) {
    const k = claveConcepto(g.descripcion);
    const existente = grupos.get(k);
    if (existente) {
      existente.monto += Number(g.monto) || 0;
      existente.items.push(g);
    } else {
      grupos.set(k, {
        label: String(g.descripcion || '').trim() || 'sin detalle',
        monto: Number(g.monto) || 0,
        montoPrev: prevPorClave.get(k) || 0,
        dif: null, esNuevo: false, items: [g],
      });
    }
  }

  const out = [...grupos.entries()].map(([k, grupo]) => {
    const hubo = prevPorClave.has(k);
    return {
      ...grupo,
      montoPrev: prevPorClave.get(k) || 0,
      dif: hubo ? Math.round(grupo.monto - (prevPorClave.get(k) || 0)) : null,
      esNuevo: !hubo,
    };
  });

  // ── Lo que dejó de gastarse también es una respuesta ────────────────────────────────
  //
  // Un concepto que estaba el mes pasado y este mes no aparece es, muchas veces, la causa
  // entera de que la línea baje. Si solo se listaran los gastos de este mes, esa plata
  // desaparecería de la explicación: la línea bajaría y el detalle no diría por qué.
  for (const [k, montoPrev] of prevPorClave) {
    if (grupos.has(k)) continue;
    const ejemplo = (itemsPrev || []).find((g) => claveConcepto(g.descripcion) === k);
    out.push({
      label: String(ejemplo?.descripcion || '').trim() || 'sin detalle',
      monto: 0, montoPrev, dif: -Math.round(montoPrev), esNuevo: false, items: [],
    });
  }

  // Por cuánto se movió, de mayor a menor en valor absoluto: lo que explica el cambio de
  // la línea va primero. Un concepto que no se movió puede ser grande y no importar.
  return out.sort((a, b) => Math.abs(b.dif ?? b.monto) - Math.abs(a.dif ?? a.monto));
}
