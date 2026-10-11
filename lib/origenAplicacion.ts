// ── Origen y aplicación de fondos ────────────────────────────────────────────────────
//
// La pregunta que contesta: "el mes dio un resultado de X, ¿dónde está esa plata?".
//
// Casi nunca está en la caja, y eso no es un error: se vendió y todavía no se cobró, se
// compró y todavía no se pagó, o se compró más insumo del que se consumió. Cada una de esas
// tres cosas separa el resultado de la caja, y hasta que no se ven juntas la diferencia se
// vive como "los números no cierran".
//
// El puente es:
//
//   Resultado del mes
//   − lo que creció la deuda de los clientes   (vendiste y no cobraste)
//   + lo que creció la deuda a proveedores     (compraste y no pagaste)
//   − lo que creció el stock                   (plata que quedó en el depósito)
//   = variación de caja esperada
//
// Y abajo, la variación de caja REAL. Lo que no cierra entre las dos se muestra como tal, en
// vez de ajustarlo contra algo: una diferencia que aparece es un dato —falta cargar algo— y
// una diferencia escondida es un error que nadie va a encontrar.
//
// Y no se enumeran causas posibles: se calculan las reales, con nombre y monto. Decir "puede
// ser un saldo sin cargar" obliga a salir a buscar cuál; decir "Caja MQ: faltan $180.000"
// termina la búsqueda ahí mismo.

import type { Gasto } from './types';
import { estaPagado, fechaDeCaja } from './proveedores';

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export interface LineaFondos {
  label: string;
  monto: number;          // positivo = aporta caja, negativo = consume caja
  detalle: string;
}

export interface OrigenAplicacion {
  resultado: number;
  lineas: LineaFondos[];
  cajaEsperada: number;
  cajaReal: number | null;   // null = no hay saldos cargados para comparar
  sinExplicar: number | null;
  // El "sin explicar", partido en las dos cosas distintas que lo componen. Un solo número
  // junta dos problemas que se arreglan en lugares diferentes, y entonces no se arregla
  // ninguno: hay que saber cuánto es "falta cargar un movimiento" y cuánto es "el puente
  // no llega".
  porCuentasQueNoCierran: number | null;
  porElPuente: number | null;
  movimientoSinConfirmar: number;
  cuentasSinReal: string[];
}

// Cuánto se debía a proveedores al cierre de un día: compras cargadas hasta esa fecha que
// a esa fecha todavía no estaban pagadas.
export function deudaProveedoresAlCierre(gastos: Gasto[], hasta: string): number {
  let total = 0;
  for (const g of gastos || []) {
    const compra = soloFecha(g.fecha);
    if (!compra || compra > hasta) continue;
    // Sin marca de pendiente nunca fue una deuda: se cargó ya pagada.
    const esPendienteHoy = !estaPagado(g);
    const pago = fechaDeCaja(g);
    // Se debía a esa fecha si todavía no se había pagado ENTONCES, aunque hoy ya esté pagada.
    const sePagoDespues = !!pago && pago > hasta;
    if (esPendienteHoy || sePagoDespues) {
      // Solo cuenta como deuda lo que alguna vez se cargó como compra a crédito. Un gasto
      // normal con fecha de pago igual a la de compra no es deuda ni por un día.
      const fuePendiente = esPendienteHoy || String((g as any)?.proveedor || '').trim() !== '';
      if (fuePendiente) total += num(g.monto);
    }
  }
  return total;
}

export interface EntradasFondos {
  resultado: number;
  // Deudores por venta: lo facturado menos lo cobrado DEL MES. Es la variación, no el saldo:
  // la variación se puede calcular exacto con un mes de datos, y el saldo necesitaría toda
  // la historia.
  facturadoMes: number;
  cobradoMes: number;
  deudaProveedoresInicio: number;
  deudaProveedoresFin: number;
  // Lo previsionado del mes (despidos y SAC). Es costo del mes y no salió de la caja, así
  // que separa el resultado de la caja exactamente igual que una compra a crédito.
  previsionesMes: number;
  stockInicio: number | null;
  stockFin: number | null;
  cajaInicio: number | null;
  cajaFin: number | null;
  // ── Gastos que pagaron los socios de su bolsillo ────────────────────────────────
  //
  // 'Aporte socios' figura como un medio de pago más, así que un gasto pagado así entra al
  // resultado como cualquier otro. Y está bien que entre: el costo existió. Pero la plata
  // no salió de ninguna cuenta de la empresa, así que si no se dice, el puente pide que la
  // caja haya bajado por algo que nunca la tocó.
  //
  // Hasta ahora quedaba escondido: 'Aporte socios' se sumaba al total de caja como si fuera
  // un banco, con un saldo enormemente negativo, y el número se compensaba solo sin
  // aparecer en ningún renglón. El total daba igual y la explicación no estaba en ninguna
  // parte — que es la peor forma de tener razón.
  gastosPagadosPorSocios: number;
  // Lo que el resumen del banco dice y la app no registró: la suma de las diferencias de
  // cada cuenta. Es la mitad del "sin explicar" que SÍ tiene nombre y cuenta.
  diferenciaDeCuentas: number;
  // Cuánto movimiento quedó sin confirmar porque esa cuenta no tiene saldo del resumen.
  movimientoSinConfirmar: number;
  cuentasSinReal: string[];
}

export function origenYAplicacion(e: EntradasFondos): OrigenAplicacion {
  const lineas: LineaFondos[] = [];

  const deltaDeudores = Math.round(e.facturadoMes - e.cobradoMes);
  if (deltaDeudores !== 0) {
    lineas.push({
      label: deltaDeudores > 0 ? 'Creció lo que deben los clientes' : 'Bajó lo que deben los clientes',
      // Si los clientes deben más, esa plata no entró: resta caja.
      monto: -deltaDeudores,
      detalle: `Se facturó ${fmt(e.facturadoMes)} y se cobró ${fmt(e.cobradoMes)}`,
    });
  }

  const deltaProveedores = Math.round(e.deudaProveedoresFin - e.deudaProveedoresInicio);
  if (deltaProveedores !== 0) {
    lineas.push({
      label: deltaProveedores > 0 ? 'Creció lo que se debe a proveedores' : 'Bajó lo que se debe a proveedores',
      // Deber más es plata que todavía está en la caja: suma.
      monto: deltaProveedores,
      detalle: `De ${fmt(e.deudaProveedoresInicio)} a ${fmt(e.deudaProveedoresFin)}`,
    });
  }

  if (Math.round(e.previsionesMes) !== 0) {
    lineas.push({
      label: 'Se previsionó para despidos y SAC',
      // Es un costo que restó del resultado y no sacó plata de la caja: la devuelve.
      monto: Math.round(e.previsionesMes),
      detalle: 'Plata comprometida que todavía está en la cuenta',
    });
  }

  if (Math.round(e.gastosPagadosPorSocios) !== 0) {
    lineas.push({
      label: 'Gastos que pagaron los socios',
      // El costo restó del resultado pero la plata no salió de ninguna cuenta de la empresa.
      monto: Math.round(e.gastosPagadosPorSocios),
      detalle: 'Cargados con medio de pago «Aporte socios»: no salieron de la caja',
    });
  }

  const hayStock = e.stockInicio !== null && e.stockFin !== null;
  const deltaStock = hayStock ? Math.round((e.stockFin as number) - (e.stockInicio as number)) : 0;
  if (hayStock && deltaStock !== 0) {
    lineas.push({
      label: deltaStock > 0 ? 'Creció el stock de insumos' : 'Bajó el stock de insumos',
      // Más stock es plata inmovilizada en el depósito: resta caja.
      monto: -deltaStock,
      detalle: `De ${fmt(e.stockInicio as number)} a ${fmt(e.stockFin as number)}`,
    });
  }

  const cajaEsperada = Math.round(e.resultado + lineas.reduce((a, l) => a + l.monto, 0));
  const cajaReal = e.cajaInicio !== null && e.cajaFin !== null
    ? Math.round((e.cajaFin as number) - (e.cajaInicio as number))
    : null;

  const sinExplicar = cajaReal === null ? null : Math.round(cajaReal - cajaEsperada);

  // Las dos mitades del sin explicar.
  //
  //   sinExplicar = (lo que el banco dice y la app no registró) + (lo que el puente no llega
  //                  a explicar aunque todo esté registrado)
  //
  // La primera se arregla cargando el movimiento que falta, y la app ya sabe en qué cuenta
  // está. La segunda no se arregla cargando nada: es que el puente le está errando a algún
  // desfase entre lo devengado y lo pagado. Mezcladas en un solo número, cualquiera de las
  // dos se lee como la otra y se busca donde no está.
  const porCuentasQueNoCierran = cajaReal === null ? null : Math.round(e.diferenciaDeCuentas);
  const porElPuente = sinExplicar === null ? null : Math.round(sinExplicar - (porCuentasQueNoCierran || 0));

  return {
    resultado: Math.round(e.resultado),
    lineas,
    cajaEsperada,
    cajaReal,
    sinExplicar,
    porCuentasQueNoCierran,
    porElPuente,
    movimientoSinConfirmar: Math.round(e.movimientoSinConfirmar),
    cuentasSinReal: e.cuentasSinReal,
  };
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR');
}


// ── De dónde sale la diferencia ──────────────────────────────────────────────────────
//
// Cada cuenta ya trae su propia diferencia entre lo que dice el resumen y lo que la app
// calculó. Sumadas, explican la mayor parte del "sin explicar", y nombradas lo explican del
// todo: la diferencia deja de ser un número para ser una tarea.

export interface CausaDiferencia {
  cuenta: string;
  monto: number;       // lo que esa cuenta aporta a la diferencia
  motivo: 'descuadre' | 'sin_real' | 'sin_inicial';
  detalle: string;
}

export interface SaldoParaCausas {
  medio: string;
  inicial: number;
  hayInicial: boolean;
  calculado: number;
  real: number | null;
  diferencia: number | null;
}

export function causasDeLaDiferencia(saldos: SaldoParaCausas[]): CausaDiferencia[] {
  const out: CausaDiferencia[] = [];
  for (const s of saldos || []) {
    // Falta el saldo del mes anterior: la variación de esta cuenta arranca de cero y por eso
    // la variación de caja del mes queda mal, aunque la cuenta cierre perfecto este mes. Se
    // avisa ANTES de descartar las que cuadran, que es justo donde se escapaba.
    if (!s.hayInicial && (s.real !== null || Math.abs(s.calculado) >= 1)) {
      out.push({
        cuenta: s.medio,
        monto: 0,
        motivo: 'sin_inicial',
        detalle: 'No hay saldo del mes anterior, así que la variación de esta cuenta arranca de cero',
      });
    }

    // La cuenta cuadra al peso: no hay nada más que explicar.
    if (s.real !== null && Math.abs(s.diferencia || 0) < 1) continue;

    if (s.real !== null) {
      out.push({
        cuenta: s.medio,
        monto: Math.round(s.diferencia || 0),
        motivo: 'descuadre',
        detalle: `El resumen dice ${fmt(s.real)} y la app calculó ${fmt(s.calculado)}`,
      });
    } else if (Math.abs(s.calculado) >= 1 || s.hayInicial) {
      // Sin saldo real no se puede saber si cuadra: su movimiento entero queda sin confirmar.
      out.push({
        cuenta: s.medio,
        monto: 0,
        motivo: 'sin_real',
        detalle: `Sin saldo del resumen cargado. La app calculó ${fmt(s.calculado)} y no hay contra qué compararlo`,
      });
    }
  }
  // Lo que más pesa primero; los avisos sin monto, al final.
  return out.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));
}
