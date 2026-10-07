import { asegurarHoja, readSheet, appendRowObj, updateRow, deleteRow } from './sheets';
import { MEDIOS_PAGO, type MedioPagoGasto, type Gasto } from './types';

import { pagadosEnRango } from './proveedores';
// ── Cobranzas y saldos de cuentas ─────────────────────────────────────────────────────
//
// Con esto la app puede decir cuánta plata hay en cada cuenta y en cada caja, que es lo
// último que faltaba para no tener que ir a mirarlo a Xubio.
//
// La cuenta es siempre la misma, para bancos y para cajas:
//
//   saldo final = saldo inicial + cobranzas − gastos + entradas internas − salidas internas
//
// El saldo inicial de un mes es el saldo final REAL del mes anterior — el mismo mecanismo
// que el stock de insumos. Así el mes arranca de un número contado, no de uno arrastrado:
// si un mes quedó con diferencia, no se propaga a todos los siguientes.
//
// La diferencia entre el saldo calculado y el saldo real del resumen ES la conciliación:
// dice cuánta plata se movió sin quedar registrada. Cero es que está todo cargado.
//
// La cobranza guarda el cliente como OPCIONAL a propósito. Hoy la cuenta corriente por
// cliente vive en Xubio y alcanza con cargar el total cobrado por cuenta; el día que se
// quiera el detalle por cliente se completa el campo y no hay que migrar nada.

export const HOJA_COBRANZAS = 'Cobranzas';
export const HEADERS_COBRANZAS = ['id_cobranza', 'fecha', 'medio_pago', 'monto', 'id_control', 'notas', 'usuario', 'fecha_carga'];

export const HOJA_SALDOS = 'SaldosCuenta';
export const HEADERS_SALDOS = ['id_saldo', 'anio', 'mes', 'medio_pago', 'saldo_real', 'notas', 'usuario', 'fecha_carga'];

export interface Cobranza {
  id_cobranza: string;
  fecha: string;
  medio_pago: string;
  monto: number | string;
  id_control: string;   // cliente — opcional, ver arriba
  notas: string;
  usuario: string;
  fecha_carga: string;
}

export interface SaldoCuenta {
  id_saldo: string;
  anio: number | string;
  mes: number | string;
  medio_pago: string;
  saldo_real: number | string;
  notas: string;
  usuario: string;
  fecha_carga: string;
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const dia = (s: any) => String(s || '').split(/[T ]/)[0];
export const idSaldo = (anio: number, mes: number, medio: string) =>
  `SALDO-${anio}-${String(mes).padStart(2, '0')}-${medio.replace(/\s+/g, '_')}`;

export async function leerCobranzas(): Promise<Cobranza[]> {
  return readSheet<Cobranza>(HOJA_COBRANZAS).catch(() => []);
}
export async function leerSaldos(): Promise<SaldoCuenta[]> {
  return readSheet<SaldoCuenta>(HOJA_SALDOS).catch(() => []);
}

export async function guardarCobranza(c: {
  fecha: string; medio_pago: string; monto: number; id_control?: string; notas?: string; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_COBRANZAS, HEADERS_COBRANZAS);
  const previas = await leerCobranzas();
  const seq = previas.reduce((acc, f) => Math.max(acc, parseInt(String(f.id_cobranza).replace(/\D/g, ''), 10) || 0), 0) + 1;
  await appendRowObj(HOJA_COBRANZAS, {
    id_cobranza: `COB-${String(seq).padStart(5, '0')}`,
    fecha: dia(c.fecha),
    medio_pago: c.medio_pago,
    monto: c.monto,
    id_control: c.id_control || '',
    notas: c.notas || '',
    usuario: c.usuario,
    fecha_carga: new Date().toISOString(),
  });
}

export async function borrarCobranza(id: string): Promise<boolean> {
  return deleteRow(HOJA_COBRANZAS, 'id_cobranza', id);
}

export async function guardarSaldoReal(args: {
  anio: number; mes: number; medio_pago: string; saldo_real: number; notas?: string; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_SALDOS, HEADERS_SALDOS);
  const id = idSaldo(args.anio, args.mes, args.medio_pago);
  const fila = {
    id_saldo: id, anio: args.anio, mes: args.mes, medio_pago: args.medio_pago,
    saldo_real: args.saldo_real, notas: args.notas || '', usuario: args.usuario,
    fecha_carga: new Date().toISOString(),
  };
  const actualizada = await updateRow(HOJA_SALDOS, 'id_saldo', id, fila);
  if (!actualizada) await appendRowObj(HOJA_SALDOS, fila);
}

// Para comparar el nombre de una cuenta entre Xubio y la app: "CAJA MQ" y "Caja MQ" son la
// misma, y una comparación literal no las une.
const claveCuenta = (x: any) => String(x || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// ── Saldo de cada cuenta en un mes ────────────────────────────────────────────────────

export interface SaldoMes {
  medio: string;
  inicial: number;          // saldo real del mes anterior (0 si nunca se cargó)
  hayInicial: boolean;
  cobranzas: number;        // total cobrado: lo de Xubio más lo cargado a mano
  cobradoXubio: number;
  cobradoManual: number;
  gastos: number;
  entradas: number;         // movimientos internos que entran a esta cuenta
  salidas: number;          // movimientos internos que salen de esta cuenta
  calculado: number;
  real: number | null;      // lo que dice el resumen, si se cargó
  diferencia: number | null;
}

export function saldosDelMes(
  gastos: Gasto[], cobranzas: Cobranza[], saldos: SaldoCuenta[], anio: number, mes: number,
  // Las cobranzas que ya están en Xubio, de la copia local. Traen la cuenta donde entró la
  // plata, así que son el registro real de lo cobrado: sin esto la columna daba cero aunque
  // el mes estuviera lleno de cobros, porque solo miraba las líneas cargadas a mano.
  cobranzasXubio: { fecha: any; cuenta: any; importe: any }[] = [],
): SaldoMes[] {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  let mesPrev = mes - 1, anioPrev = anio;
  if (mesPrev === 0) { mesPrev = 12; anioPrev--; }

  const delMes = <T extends { fecha: any }>(xs: T[]) => xs.filter((x) => { const f = dia(x.fecha); return f >= desde && f <= hasta; });
  // Por fecha de PAGO, no de compra: un saldo de caja no se mueve cuando se compra sino
  // cuando sale la plata. Lo pendiente no mueve nada todavía.
  const gastosMes = pagadosEnRango(gastos, desde, hasta);
  const cobranzasMes = delMes(cobranzas);
  const xubioMes = (cobranzasXubio || []).filter((c) => { const f = dia(c.fecha); return f >= desde && f <= hasta; });

  return MEDIOS_PAGO.map((medio: MedioPagoGasto) => {
    const filaPrev = saldos.find((s) => String(s.id_saldo) === idSaldo(anioPrev, mesPrev, medio));
    const filaAct = saldos.find((s) => String(s.id_saldo) === idSaldo(anio, mes, medio));

    const cobradoManual = cobranzasMes.filter((c) => c.medio_pago === medio).reduce((a, c) => a + num(c.monto), 0);
    // Por clave y no por texto: en Xubio la cuenta se llama "CAJA MQ" y acá "Caja MQ", y una
    // comparación literal no las une. Una cobranza con dos instrumentos trae los dos nombres
    // juntos, así que se busca el nombre adentro del texto.
    const kMedio = claveCuenta(medio);
    const cobradoXubio = xubioMes
      .filter((c) => claveCuenta(c.cuenta).includes(kMedio))
      .reduce((a, c) => a + num(c.importe), 0);
    const cobrado = cobradoManual + cobradoXubio;
    // Un movimiento entre cuentas no es un gasto: sale de una punta y entra en la otra, así
    // que se cuenta como salida de su origen y como entrada de su destino, nunca como costo.
    const salidaGastos = gastosMes
      .filter((g) => g.medio_pago === medio && g.categoria !== 'movimiento_interno')
      .reduce((a, g) => a + num(g.monto), 0);
    const salidas = gastosMes
      .filter((g) => g.medio_pago === medio && g.categoria === 'movimiento_interno')
      .reduce((a, g) => a + num(g.monto), 0);
    const entradas = gastosMes
      .filter((g) => g.categoria === 'movimiento_interno' && g.medio_pago_destino === medio)
      .reduce((a, g) => a + num(g.monto), 0);

    const hayPrev = !!filaPrev && String(filaPrev.saldo_real ?? '').trim() !== '';
    const inicial = hayPrev ? num(filaPrev!.saldo_real) : 0;
    const calculado = inicial + cobrado - salidaGastos + entradas - salidas;
    const real = filaAct && String(filaAct.saldo_real ?? '').trim() !== '' ? num(filaAct.saldo_real) : null;

    return {
      medio, inicial, hayInicial: hayPrev,
      cobranzas: cobrado, cobradoXubio, cobradoManual, gastos: salidaGastos,
      entradas, salidas, calculado, real,
      diferencia: real === null ? null : real - calculado,
    };
  });
}
