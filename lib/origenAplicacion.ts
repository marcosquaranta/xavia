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
  stockInicio: number | null;
  stockFin: number | null;
  cajaInicio: number | null;
  cajaFin: number | null;
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

  return {
    resultado: Math.round(e.resultado),
    lineas,
    cajaEsperada,
    cajaReal,
    sinExplicar: cajaReal === null ? null : Math.round(cajaReal - cajaEsperada),
  };
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR');
}
