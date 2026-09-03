import type { Gasto, StockMes, Articulo } from './types';
import { MEDIOS_PAGO } from './types';
import type { EERR } from './eerr';
import type { Cobranza, SaldoMes } from './cuentas';

// ── Checklist del cierre mensual ──────────────────────────────────────────────────────
//
// El problema del cierre no es que sea difícil, es que son doce cosas y siempre falta una.
// Esto las lista y, donde puede, dice sola si está hecha mirando los datos.
//
// Hay pasos que la app NO puede verificar: si ya conciliaste el resumen del banco, si
// desglosaste la tarjeta. Para esos no invento un estado — quedan como recordatorio. Un
// tilde puesto por adivinanza es peor que ningún tilde, porque das por hecho algo que no
// pasó.

export type EstadoPaso = 'listo' | 'pendiente' | 'recordatorio';

export interface PasoCierre {
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
  href?: string;
}

export function pasosDelCierre(args: {
  eerr: EERR;
  gastos: Gasto[];
  stocks: StockMes[];
  articulos: Articulo[];
  cobranzas: Cobranza[];
  saldos: SaldoMes[];
  hayPrevision: boolean;
  anio: number;
  mes: number;
}): PasoCierre[] {
  const { eerr, gastos, stocks, articulos, cobranzas, saldos, hayPrevision, anio, mes } = args;
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const gastosMes = gastos.filter((g) => { const f = String(g.fecha || '').split(/[T ]/)[0]; return f >= desde && f <= hasta; });

  // Stock final: cuántos artículos activos con movimiento en el mes quedaron sin contar.
  const activos = articulos.filter((a) => a.activo === 'SI');
  let sinContar = 0;
  for (const art of activos) {
    const s = stocks.find((st) => String(st.id_articulo) === String(art.id_articulo)
      && String(st.anio) === String(anio) && String(st.mes) === String(mes));
    if (!s) continue;
    const hayMovimiento = Number(s.stock_inicial) || Number(s.compras) || Number(s.stock_final);
    if (hayMovimiento && String(s.stock_final ?? '').trim() === '') sinContar++;
  }

  const insumosSinAplicar = gastosMes.filter((g) => g.categoria === 'insumos' && g.aplicado_stock !== 'SI').length;
  const conTarjeta = gastosMes.filter((g) => g.medio_pago === 'VISA' && g.categoria !== 'movimiento_interno').length;
  const sinSaldoReal = saldos.filter((s) => s.real === null).length;
  const conDiferencia = saldos.filter((s) => s.diferencia !== null && Math.abs(s.diferencia) >= 1).length;
  const sinSaldoInicial = saldos.filter((s) => !s.hayInicial).length;
  const transferenciasMes = gastosMes.filter((g) => g.categoria === 'movimiento_interno');
  const pagoTarjetaMes = transferenciasMes.find((g) => g.medio_pago_destino === 'VISA');

  // Cuánto se consumió con la tarjeta el mes pasado: referencia de cuánto debería rondar el
  // débito del resumen este mes. La app no lee el resumen, así que no puede afirmar el monto
  // exacto — solo decir "buscá algo parecido a esto".
  let mesPrevNum = mes - 1, anioPrevNum = anio;
  if (mesPrevNum === 0) { mesPrevNum = 12; anioPrevNum--; }
  const mmPrev = String(mesPrevNum).padStart(2, '0');
  const desdePrev = `${anioPrevNum}-${mmPrev}-01`;
  const hastaPrev = `${anioPrevNum}-${mmPrev}-${String(new Date(anioPrevNum, mesPrevNum, 0).getDate()).padStart(2, '0')}`;
  const consumoTarjetaMesPasado = gastos
    .filter((g) => g.medio_pago === 'VISA' && g.categoria !== 'movimiento_interno')
    .filter((g) => { const f = String(g.fecha || '').split(/[T ]/)[0]; return f >= desdePrev && f <= hastaPrev; })
    .reduce((a, g) => a + (Number(g.monto) || 0), 0);

  const hrefCargaRapida = `/eerr/carga-rapida?anio=${anio}&mes=${mes}`;

  const pasos: PasoCierre[] = [];

  pasos.push({
    titulo: 'Conciliar los resúmenes del banco',
    estado: 'recordatorio',
    detalle: 'Bajá Macro y Brubank. De ahí salen los tres pasos que siguen: los gastos que faltan, el total cobrado y los saldos reales.',
  });

  pasos.push({
    titulo: 'Cargar el stock final de todos los artículos',
    estado: sinContar > 0 ? 'pendiente' : 'listo',
    detalle: sinContar > 0
      ? `Faltan ${sinContar} artículo(s) por contar. Sin el recuento no hay costo variable: el consumo daría igual a todo el stock inicial.`
      : 'Todos los artículos con movimiento tienen su recuento cargado.',
    href: '/stocks',
  });

  pasos.push({
    titulo: 'Aplicar a Stocks las compras de insumos',
    estado: insumosSinAplicar > 0 ? 'pendiente' : 'listo',
    detalle: insumosSinAplicar > 0
      ? `${insumosSinAplicar} gasto(s) de insumos sin aplicar: esa compra no está en el costo de ningún lado.`
      : 'No quedan gastos de insumos sin aplicar.',
    href: '/stocks',
  });

  pasos.push({
    titulo: 'Conciliación bancaria: cargar sueldos, impuestos y demás',
    estado: eerr.masaSalarial > 0 ? 'listo' : 'pendiente',
    detalle: eerr.masaSalarial > 0
      ? `Masa salarial del mes: $${Math.round(eerr.masaSalarial).toLocaleString('es-AR')} — es la base de las previsiones. Revisá igual que no falte ningún otro débito del resumen (impuestos bancarios, comisiones, nafta).`
      : 'Hacé la conciliación de Macro y Brubank y sacá de ahí los gastos que todavía no pasaste a la app y que ahí figuran — sueldos, impuestos bancarios, comisiones, nafta. Cargalos todos juntos: una columna por cuenta, una fila por rubro.',
    href: hrefCargaRapida,
  });

  pasos.push({
    titulo: 'Desglosar el resumen de la tarjeta',
    estado: conTarjeta > 0 ? 'listo' : 'recordatorio',
    detalle: conTarjeta > 0
      ? `${conTarjeta} consumo(s) con VISA cargados este mes. El pago del resumen va aparte, como transferencia entre cuentas.`
      : 'No hay ningún consumo con VISA cargado este mes. Cada línea va con su fecha real de consumo; el pago del resumen no es un gasto nuevo.',
    href: '/gastos',
  });

  pasos.push({
    titulo: 'Cargar los movimientos entre cuentas',
    estado: transferenciasMes.length > 0 ? 'listo' : 'pendiente',
    detalle: transferenciasMes.length > 0
      ? `${transferenciasMes.length} transferencia(s) cargada(s) este mes entre cuentas propias.`
      : 'Plata que pasó de un banco a otro, o de un banco a una caja, todavía no está cargada. Sin esto los saldos de las dos puntas no van a cerrar.',
    href: `${hrefCargaRapida}#transferencias`,
  });

  pasos.push({
    titulo: 'Registrar el pago de la tarjeta del mes anterior',
    // Sin consumo el mes pasado no hay nada que pagar este mes: marcarlo pendiente ahí sería
    // un falso positivo que nadie puede resolver.
    estado: pagoTarjetaMes ? 'listo' : consumoTarjetaMesPasado > 0 ? 'pendiente' : 'listo',
    detalle: pagoTarjetaMes
      ? `Cargado: $${Math.round(Number(pagoTarjetaMes.monto) || 0).toLocaleString('es-AR')} de ${pagoTarjetaMes.medio_pago} a VISA.`
      : consumoTarjetaMesPasado > 0
        ? `El mes pasado se consumieron $${Math.round(consumoTarjetaMesPasado).toLocaleString('es-AR')} con la tarjeta — buscá en el resumen un débito parecido a ese monto y cargalo como transferencia al banco → VISA.`
        : 'El mes pasado no hubo consumos con tarjeta: no hay resumen que pagar este mes.',
    href: `${hrefCargaRapida}#transferencias`,
  });

  pasos.push({
    titulo: 'Cargar el total cobrado por banco',
    estado: cobranzas.length > 0 ? 'listo' : 'pendiente',
    detalle: cobranzas.length > 0
      ? `${cobranzas.length} cobranza(s) cargadas por $${Math.round(cobranzas.reduce((a, c) => a + (Number(c.monto) || 0), 0)).toLocaleString('es-AR')}.`
      : 'Del resumen sacás cuánto entró a cada banco; de las cajas, lo que te pasaron los socios. Sin esto los saldos de bancos y cajas no pueden dar bien.',
  });

  pasos.push({
    titulo: 'Cargar el saldo real de cada cuenta',
    estado: sinSaldoReal === 0 ? 'listo' : sinSaldoReal === MEDIOS_PAGO.length ? 'pendiente' : 'pendiente',
    detalle: sinSaldoReal === 0
      ? 'Todas las cuentas tienen su saldo del resumen cargado.'
      : `Faltan ${sinSaldoReal} cuenta(s).${sinSaldoInicial > 0 ? ` Además, ${sinSaldoInicial} arrancan sin saldo inicial: cargalo en la columna "Inicial".` : ''}`,
  });

  pasos.push({
    titulo: 'Que la conciliación dé ✓ en todas las cuentas',
    estado: sinSaldoReal > 0 ? 'recordatorio' : conDiferencia > 0 ? 'pendiente' : 'listo',
    detalle: sinSaldoReal > 0
      ? 'Se puede revisar recién cuando estén todos los saldos cargados.'
      : conDiferencia > 0
        ? `${conDiferencia} cuenta(s) con diferencia: hay plata que se movió sin quedar registrada.`
        : 'Ninguna cuenta tiene diferencia contra el resumen.',
  });

  pasos.push({
    titulo: 'Guardar previsiones y cuentas corrientes',
    estado: hayPrevision ? 'listo' : 'pendiente',
    detalle: hayPrevision
      ? 'Guardadas para este mes.'
      : 'Despidos y SAC se calculan solos sobre la masa salarial, pero hay que guardarlos para que el mes quede fijo.',
  });

  pasos.push({
    titulo: 'Comparar contra tu Excel',
    estado: 'recordatorio',
    detalle: 'Armalo como siempre y contrastá línea por línea. Donde no dé, o falta un dato o está mal el cálculo — las dos cosas sirven.',
  });

  return pasos;
}

export function resumenChecklist(pasos: PasoCierre[]): { listos: number; pendientes: number; total: number } {
  const verificables = pasos.filter((p) => p.estado !== 'recordatorio');
  return {
    listos: verificables.filter((p) => p.estado === 'listo').length,
    pendientes: verificables.filter((p) => p.estado === 'pendiente').length,
    total: verificables.length,
  };
}
