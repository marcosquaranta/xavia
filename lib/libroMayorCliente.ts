// ── Libro mayor de un cliente ────────────────────────────────────────────────────────
//
// "Facturas impagas por cliente" contesta cuánto debe. No contesta la pregunta que viene
// después, que es la que se hace cuando el cliente discute: cómo se llegó a ese número.
// Para eso hace falta ver las facturas y los cobros en orden, con el saldo corriendo al
// lado — que es lo que cualquiera entiende por cuenta corriente.
//
// LO QUE ESTE MAYOR NO ES: una segunda fuente de verdad sobre la deuda. Esa sigue siendo
// la lista de facturas abiertas. Acá el saldo se calcula de otra manera —facturado menos
// cobrado, en una ventana de fechas— y las dos cuentas pueden no dar lo mismo. Eso no es
// un error a tapar: es información. Las razones son concretas y están enumeradas en
// `diferencia`, porque un mayor que miente para coincidir con el otro número no sirve
// para discutir nada.
//
// La diferencia más común: Xubio no dice qué factura cancela cada cobranza —entra como
// cobro a cuenta— así que la deuda abierta se reconstruye imputando de la más vieja a la
// más nueva. El mayor no imputa nada: suma y resta. Si el cliente pagó de más, o pagó
// algo de antes de la ventana, los dos números se separan.

export type TipoMovimientoMayor = 'factura' | 'nota_credito' | 'cobro' | 'saldada';

export interface MovimientoMayor {
  fecha: string;              // YYYY-MM-DD
  tipo: TipoMovimientoMayor;
  // El número que permite encontrarlo: de factura, de nota de crédito, de recibo.
  numero: string;
  detalle: string;
  debe: number;               // suma a lo que el cliente debe
  haber: number;              // lo baja
  saldo: number;              // corrido, después de este movimiento
  // Si NO movió plata. Una factura dada por saldada a mano baja el saldo sin que haya
  // entrado un peso, y mostrarla igual que un cobro haría pensar que el cliente pagó.
  esPlata: boolean;
  nota?: string;
}

export interface FacturaMayor {
  numero: string;
  fecha: string;
  importe: number;            // lo que hay que cobrar
  importeFactura?: number;    // lo que dice el comprobante, si se corrigió después
  ajustada?: boolean;
  saldadaManual?: boolean;
}

export interface NotaMayor {
  numero: string;
  fecha: string;
  importe: number;
}

export interface CobroMayor {
  fecha: string;
  importe: number;
  numero?: string;            // número de recibo en Xubio
  cuenta?: string;            // dónde entró la plata
}

export interface LibroMayor {
  movimientos: MovimientoMayor[];
  desde: string;
  hasta: string;
  totalFacturado: number;
  totalNotas: number;
  totalCobrado: number;
  totalSaldadoAMano: number;
  // Facturado − notas − cobrado − saldado a mano. Puede dar negativo: un cliente que pagó
  // más de lo que se le facturó en la ventana tiene saldo a favor, y eso es un dato.
  saldo: number;
  // Lo que dice la lista de facturas abiertas, cuando se pasa para comparar.
  deudaAbierta?: number;
  // Por qué los dos números pueden no coincidir. Vacío cuando coinciden.
  diferencia: string[];
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];
const num = (v: any) => Math.round(Number(v) || 0);

// Dentro del mismo día: primero lo que se facturó, después lo que se cobró. Un cobro que
// aparece antes que la factura que paga deja el saldo en negativo por una línea y se lee
// como un error que no existe.
const ORDEN: Record<TipoMovimientoMayor, number> = {
  factura: 0,
  nota_credito: 1,
  cobro: 2,
  saldada: 3,
};

export function libroMayorCliente({
  facturas = [],
  notas = [],
  cobros = [],
  desde = '',
  hasta = '',
  deudaAbierta,
}: {
  facturas?: FacturaMayor[];
  notas?: NotaMayor[];
  cobros?: CobroMayor[];
  desde?: string;
  hasta?: string;
  deudaAbierta?: number;
}): LibroMayor {
  const dentro = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);

  const movimientos: MovimientoMayor[] = [];

  for (const f of facturas) {
    const fecha = soloFecha(f.fecha);
    if (!dentro(fecha)) continue;
    const importe = num(f.importe);
    movimientos.push({
      fecha,
      tipo: 'factura',
      numero: f.numero,
      detalle: `Factura ${f.numero}`,
      debe: importe,
      haber: 0,
      saldo: 0,
      esPlata: true,
      // Si la venta se corrigió después de emitir, el mayor usa lo que hay que cobrar y
      // deja dicho de dónde salió: el número de la factura ya no es el que se reclama.
      nota: f.ajustada && f.importeFactura !== undefined && num(f.importeFactura) !== importe
        ? `corregida: el comprobante dice ${num(f.importeFactura).toLocaleString('es-AR')}`
        : undefined,
    });

    // Dada por saldada a mano: baja el saldo pero NO es plata. Va como movimiento propio y
    // con la misma fecha de la factura, porque la marca no guarda fecha propia.
    if (f.saldadaManual) {
      movimientos.push({
        fecha,
        tipo: 'saldada',
        numero: f.numero,
        detalle: `Dada por saldada a mano — ${f.numero}`,
        debe: 0,
        haber: importe,
        saldo: 0,
        esPlata: false,
        nota: 'no entró plata: alguien decidió que esta factura ya estaba',
      });
    }
  }

  for (const n of notas) {
    const fecha = soloFecha(n.fecha);
    if (!dentro(fecha)) continue;
    movimientos.push({
      fecha,
      tipo: 'nota_credito',
      numero: n.numero,
      detalle: `Nota de crédito ${n.numero}`,
      debe: 0,
      haber: num(n.importe),
      saldo: 0,
      esPlata: false,
      nota: 'baja la deuda sin que entre plata',
    });
  }

  for (const c of cobros) {
    const fecha = soloFecha(c.fecha);
    if (!dentro(fecha)) continue;
    movimientos.push({
      fecha,
      tipo: 'cobro',
      numero: String(c.numero || ''),
      detalle: c.numero ? `Cobro ${c.numero}` : 'Cobro',
      debe: 0,
      haber: num(c.importe),
      saldo: 0,
      esPlata: true,
      nota: c.cuenta ? `entró en ${c.cuenta}` : undefined,
    });
  }

  movimientos.sort((a, b) =>
    a.fecha.localeCompare(b.fecha)
    || ORDEN[a.tipo] - ORDEN[b.tipo]
    || String(a.numero).localeCompare(String(b.numero)));

  let saldo = 0;
  for (const m of movimientos) {
    saldo += m.debe - m.haber;
    m.saldo = saldo;
  }

  const sumar = (filas: MovimientoMayor[], campo: 'debe' | 'haber') =>
    filas.reduce((a, m) => a + m[campo], 0);

  const totalFacturado = sumar(movimientos.filter((m) => m.tipo === 'factura'), 'debe');
  const totalNotas = sumar(movimientos.filter((m) => m.tipo === 'nota_credito'), 'haber');
  const totalCobrado = sumar(movimientos.filter((m) => m.tipo === 'cobro'), 'haber');
  const totalSaldadoAMano = sumar(movimientos.filter((m) => m.tipo === 'saldada'), 'haber');

  // ── Por qué puede no coincidir con la deuda abierta ────────────────────────────────
  //
  // Se dicen las razones posibles, no se elige una: desde acá no se puede saber cuál
  // aplica. Pero cada una se revisa en un minuto, y sin la lista el que mira solo ve dos
  // números distintos y ninguna pista.
  const diferencia: string[] = [];
  if (deudaAbierta !== undefined && Math.abs(saldo - num(deudaAbierta)) >= 1) {
    if (saldo < num(deudaAbierta)) {
      diferencia.push('Hay cobros en la ventana que todavía no se imputaron a ninguna factura: bajan el saldo del mayor pero no cierran facturas, así que siguen figurando abiertas.');
    } else {
      diferencia.push('Puede haber facturas abiertas anteriores a esta ventana: cuentan en la deuda pero no aparecen acá.');
    }
    diferencia.push('Un cobro de antes de la ventana que pagó facturas de adentro también separa los dos números.');
    diferencia.push('La deuda abierta imputa de la factura más vieja a la más nueva, porque Xubio no dice qué cancela cada cobranza. El mayor no imputa: suma y resta.');
  }

  return {
    movimientos,
    desde,
    hasta,
    totalFacturado,
    totalNotas,
    totalCobrado,
    totalSaldadoAMano,
    saldo,
    deudaAbierta: deudaAbierta === undefined ? undefined : num(deudaAbierta),
    diferencia,
  };
}
