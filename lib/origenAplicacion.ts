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
  // Sospechosos del residuo, con monto. No lo descomponen: ayudan a descartar.
  pistas: PistaResiduo[];
  // El "sin explicar", partido en las dos cosas distintas que lo componen. Un solo número
  // junta dos problemas que se arreglan en lugares diferentes, y entonces no se arregla
  // ninguno: hay que saber cuánto es "falta cargar un movimiento" y cuánto es "el puente
  // no llega".
  porCuentasQueNoCierran: number | null;
  porElPuente: number | null;
  movimientoSinConfirmar: number;
  cuentasSinReal: string[];
}

// Una pista sobre el residuo: algo medible que PODRÍA estar adentro.
export interface PistaResiduo { titulo: string; monto: number; detalle: string }

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
  // Lo que se dio por saldado a mano en el mes. NO entra en la cuenta del puente —ver el
  // comentario en origenYAplicacion— pero se muestra: es plata que se dejó de perseguir.
  saldadasMes?: number;
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
  // ── Para explicar el residuo ──────────────────────────────────────────────────────
  //
  // Datos que no entran en el puente pero que son los sospechosos habituales de que no
  // cierre. Opcionales: sin ellos el residuo se informa igual, solo que sin pistas.
  retencionesMes?: number;
  // Movimientos entre cuentas sin punta de entrada: la plata sale de una cuenta y no entra
  // a ninguna. Es el que más veces explica un residuo.
  internosSinDestino?: { cantidad: number; monto: number };
  // Compras de meses anteriores pagadas en este: el costo fue antes y la plata salió ahora.
  pagosDeComprasViejas?: number;
}

export function origenYAplicacion(e: EntradasFondos): OrigenAplicacion {
  const lineas: LineaFondos[] = [];

  // ── Por qué esto NO resta las facturas dadas por saldadas a mano ──────────────────
  //
  // Dar una factura por saldada baja lo que el cliente debe sin que entre plata, así que
  // parece que falta restarla acá. No falta, y es importante entender por qué antes de
  // "arreglarlo": el resultado TAMPOCO la resta como pérdida. Los dos olvidos se cancelan
  // exactamente y el puente cierra.
  //
  //   real:  Δcaja = (resultado − incobrable) − (facturado − cobrado − incobrable) + …
  //   acá:   Δcaja =  resultado              − (facturado − cobrado)               + …
  //
  // Son la misma cuenta. El riesgo está en tocar un solo lado: si algún día los incobrables
  // pasan a restar del resultado (que es lo correcto contablemente), hay que restarlos
  // también de esta línea el mismo día, o el puente se rompe por ese monto.
  //
  // Lo que sí falta es VERLOS: se da por perdida plata real y no aparece en ningún lado.
  // Por eso van abajo como línea informativa, con monto 0 en el puente.
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

  // Las facturas que se dieron por saldadas este mes. Va con monto 0 porque no mueve el
  // puente (ver arriba), pero tiene que estar a la vista: es plata que se dejó de perseguir
  // y hoy no figura en ningún número del cierre. Un mes con medio millón acá no se puede
  // leer igual que uno con cero.
  if (Math.round(e.saldadasMes || 0) !== 0) {
    lineas.push({
      label: 'Facturas dadas por saldadas a mano',
      monto: 0,
      detalle: `${fmt(e.saldadasMes || 0)} que se dejaron de reclamar este mes. No mueven la caja ni el resultado: el cliente deja de deberlas y no entró plata. Si no se van a cobrar nunca, son una pérdida que todavía no está en el resultado.`,
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

  // ── Qué puede haber adentro del residuo ─────────────────────────────────────────
  //
  // El residuo es, por definición, lo que el puente no nombra. Decirlo y nada más deja a
  // quien lo lee sin nada que hacer: no se puede buscar algo que no tiene nombre.
  //
  // Esto no lo descompone —si se pudiera, serían renglones del puente y no residuo—. Lista
  // los sospechosos habituales CON su monto, para poder descartarlos de a uno. Ordenados
  // por plata, que es por donde conviene empezar.
  const pistas: PistaResiduo[] = [];
  if (Math.abs(Math.round(e.retencionesMes || 0)) >= 1) {
    pistas.push({
      titulo: 'Retenciones sufridas del mes',
      monto: Math.round(e.retencionesMes || 0),
      detalle: 'El cliente retuvo y pagó neto. Si la factura entró completa y el cobro vino con la retención descontada, esa diferencia aparece acá.',
    });
  }
  if ((e.internosSinDestino?.cantidad || 0) > 0) {
    pistas.push({
      titulo: `${e.internosSinDestino!.cantidad} movimiento(s) entre cuentas sin cuenta de destino`,
      monto: Math.round(e.internosSinDestino!.monto),
      detalle: 'La plata salió de una cuenta y no entró a ninguna. Es el que más veces explica un residuo, y se arregla editando el movimiento en Gastos.',
    });
  }
  if (Math.abs(Math.round(e.pagosDeComprasViejas || 0)) >= 1) {
    pistas.push({
      titulo: 'Compras de meses anteriores pagadas este mes',
      monto: Math.round(e.pagosDeComprasViejas || 0),
      detalle: 'El costo fue en otro mes y la plata salió en este. Si la deuda a proveedores del mes anterior no quedó cargada, el puente no tiene de dónde restarlo.',
    });
  }
  if (e.cuentasSinReal.length) {
    pistas.push({
      titulo: `${e.cuentasSinReal.length} cuenta(s) sin saldo del resumen`,
      monto: Math.round(e.movimientoSinConfirmar),
      detalle: `${e.cuentasSinReal.join(', ')}. Mientras no tengan saldo real, su movimiento entero está sin confirmar y puede estar adentro de este número.`,
    });
  }
  pistas.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));

  return {
    pistas,
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
      // ── Una tarjeta se lee al revés que una caja ─────────────────────────────────
      //
      // En una caja, un saldo más chico que el calculado es plata que falta. En una
      // TARJETA el saldo es deuda: más negativo significa que se debe MÁS, no menos.
      //
      // Escrito como "el resumen dice $-4.400.000 y la app calculó $-3.706.509 → −$693.491"
      // el renglón es ilegible: hay que acordarse del signo de la cuenta para saber si eso
      // es bueno o malo, y es exactamente donde uno se equivoca. Para las cuentas que se
      // mueven en negativo se dice en deuda, con todas las letras.
      const esDeuda = (s.real ?? 0) <= 0 && (s.calculado ?? 0) <= 0;
      const dif = Math.round(s.diferencia || 0);
      const detalle = esDeuda
        ? (dif < 0
            ? `Debés ${fmt(Math.abs(dif))} MÁS de lo que la app tiene registrado: el resumen dice ${fmt(s.real)} y la app ${fmt(s.calculado)}. Falta cargar consumos.`
            : `Debés ${fmt(Math.abs(dif))} MENOS de lo que la app tiene registrado: el resumen dice ${fmt(s.real)} y la app ${fmt(s.calculado)}. Puede haber un pago no registrado, o un consumo cargado de más.`)
        : `El resumen dice ${fmt(s.real)} y la app calculó ${fmt(s.calculado)}`;
      out.push({
        cuenta: s.medio,
        monto: dif,
        motivo: 'descuadre',
        detalle,
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
