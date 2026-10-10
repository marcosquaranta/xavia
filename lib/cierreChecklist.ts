import type { Gasto, StockMes, Articulo } from './types';
import { MEDIOS_PAGO } from './types';
import type { EERR } from './eerr';
import type { Cobranza, SaldoMes } from './cuentas';

// ── Checklist del cierre mensual ──────────────────────────────────────────────────────
//
// El problema del cierre no es que sea difícil, es que son doce cosas y siempre falta una.
// Esto las lista y, donde puede, dice sola si está hecha mirando los datos.
//
// Esta es LA instrucción del cierre. Antes había dos: una página aparte con los pasos
// explicados y este checklist con el estado. Nadie mantiene dos listas iguales: una de las
// dos envejece, y la que envejece es la que no se mira todos los meses. Ahora el "cómo" y el
// "cuánto falta" viven en el mismo renglón — el `ayuda` de cada paso trae la explicación que
// antes estaba en la otra página.
//
// Lo único que quedó afuera es qué va en la app y qué en Xubio: eso no es un paso del cierre
// sino una regla de trabajo, y vive en /eerr/instrucciones.
//
// Hay pasos que la app NO puede verificar: si ya conciliaste el resumen del banco, si
// desglosaste la tarjeta. Para esos no invento un estado — quedan como recordatorio. Un
// tilde puesto por adivinanza es peor que ningún tilde, porque das por hecho algo que no
// pasó.

export type EstadoPaso = 'listo' | 'pendiente' | 'recordatorio';

export interface PasoCierre {
  // Identificador estable del paso. No es el índice: si mañana se agrega un paso en el
  // medio, un marcado manual guardado como "paso 4" pasaría a tildar otra cosa.
  id: string;
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
  // El "por qué" del paso: lo que antes vivía en la página de instrucciones aparte. Va
  // separado del `detalle` porque el detalle cambia con el estado del mes y esto no.
  ayuda?: string;
  href?: string;
  // true = la app no puede verificarlo sola, así que se marca a mano. Un tilde puesto por
  // adivinanza es peor que ninguno: das por hecho algo que no pasó.
  manual?: boolean;
}

export function pasosDelCierre(args: {
  eerr: EERR;
  gastos: Gasto[];
  stocks: StockMes[];
  articulos: Articulo[];
  cobranzas: Cobranza[];
  // Lo cobrado del mes, contando las cobranzas que ya están en Xubio. No alcanza con las
  // cargadas a mano: desde que los cobros se imputan por la bandeja, esa hoja queda vacía.
  cobradoMes: number;
  saldos: SaldoMes[];
  hayPrevision: boolean;
  anio: number;
  mes: number;
}): PasoCierre[] {
  const { eerr, gastos, stocks, articulos, cobranzas, cobradoMes, saldos, hayPrevision, anio, mes } = args;
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const gastosMes = gastos.filter((g) => { const f = String(g.fecha || '').split(/[T ]/)[0]; return f >= desde && f <= hasta; });

  // Stock final: cuántos artículos activos con movimiento en el mes quedaron sin contar.
  // Ojo con el mes recién empezado: si todavía no hay NINGÚN registro de Stocks para este
  // mes, "sinContar" da 0 por ausencia total de datos, no porque se haya contado algo — un
  // ✓ ahí sería mentira. Se distingue "sin cargar nada" de "cargado y completo".
  const activos = articulos.filter((a) => a.activo === 'SI');
  let sinContar = 0;
  let hayAlgunStockDelMes = false;
  for (const art of activos) {
    const s = stocks.find((st) => String(st.id_articulo) === String(art.id_articulo)
      && String(st.anio) === String(anio) && String(st.mes) === String(mes));
    if (!s) continue;
    hayAlgunStockDelMes = true;
    const hayMovimiento = Number(s.stock_inicial) || Number(s.compras) || Number(s.stock_final);
    if (hayMovimiento && String(s.stock_final ?? '').trim() === '') sinContar++;
  }

  const insumosDelMes = gastosMes.filter((g) => g.categoria === 'insumos');
  const insumosSinAplicar = insumosDelMes.filter((g) => g.aplicado_stock !== 'SI').length;
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
    id: 'banco_resumenes',
    titulo: 'Conciliar los resúmenes del banco',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Bajá los resúmenes de Macro y Brubank del mes que estás cerrando y tenelos abiertos al lado: de ahí salen '
      + 'los gastos que faltan, el total cobrado y los saldos reales. No hace falta reformatearlos ni compararlos contra nada '
      + 'todavía; acá se usan solo para leer.',
  });

  pasos.push({
    id: 'stock_final',
    titulo: 'Cargar el stock final de todos los artículos',
    estado: !hayAlgunStockDelMes ? 'pendiente' : sinContar > 0 ? 'pendiente' : 'listo',
    detalle: !hayAlgunStockDelMes
      ? 'Todavía no cargaste stock de ningún artículo este mes.'
      : sinContar > 0
        ? `Faltan ${sinContar} artículo(s) por contar. Sin el recuento no hay costo variable: el consumo daría igual a todo el stock inicial.`
        : 'Todos los artículos con movimiento tienen su recuento cargado.',
    ayuda: 'El costo variable sale de contar: inicial + compras − final. Un final vacío no es cero — haría que el consumo '
      + 'dé igual a todo el stock inicial y el costo del mes se dispare.',
    href: '/stocks',
  });

  pasos.push({
    id: 'insumos_stock',
    titulo: 'Aplicar a Stocks las compras de insumos',
    estado: insumosDelMes.length === 0 ? 'recordatorio' : insumosSinAplicar > 0 ? 'pendiente' : 'listo',
    detalle: insumosDelMes.length === 0
      ? 'Ninguna compra de insumos cargada este mes todavía. Cuando cargues una, va a aparecer acá para aplicarla a Stocks.'
      : insumosSinAplicar > 0
        ? `${insumosSinAplicar} gasto(s) de insumos sin aplicar: esa compra no está en el costo de ningún lado.`
        : 'No quedan gastos de insumos sin aplicar.',
    ayuda: 'Un gasto de insumos que no se aplica a Stocks no entra al costo por ningún lado: no está en el gasto del mes '
      + '(los insumos salen de Stocks) ni en el consumo (porque nunca se cargó la compra).',
    href: '/stocks',
  });

  pasos.push({
    id: 'gastos_banco',
    titulo: 'Conciliación bancaria: cargar sueldos, impuestos y demás',
    estado: eerr.masaSalarial > 0 ? 'listo' : 'pendiente',
    detalle: eerr.masaSalarial > 0
      ? `Masa salarial del mes: $${Math.round(eerr.masaSalarial).toLocaleString('es-AR')} — es la base de las previsiones. Revisá igual que no falte ningún otro débito del resumen (impuestos bancarios, comisiones, nafta).`
      : 'Sacá del resumen los gastos que todavía no están en la app: sueldos, nafta, viáticos, impuestos bancarios, comisiones. '
        + 'Van con la fecha real en que salió la plata, no con la de hoy.',
    ayuda: 'Los débitos automáticos no se cargan de a uno. Un mes puede tener cincuenta líneas de impuesto al cheque de '
      + 'trescientos pesos: sumá en el resumen todo lo que es impuesto al cheque y cargá UNA línea — "Impuesto al cheque — '
      + 'septiembre", categoría Impuestos, con el banco como medio de pago. Lo mismo con comisiones. Para el resultado y para el '
      + 'saldo da exactamente igual, y son dos líneas en vez de cincuenta.',
    href: hrefCargaRapida,
  });

  pasos.push({
    id: 'tarjeta_desglose',
    titulo: 'Desglosar el resumen de la tarjeta',
    estado: conTarjeta > 0 ? 'listo' : 'recordatorio',
    detalle: conTarjeta > 0
      ? `${conTarjeta} consumo(s) con VISA cargados este mes. El pago del resumen va aparte, como transferencia entre cuentas.`
      : 'Pegá el resumen entero en "Cargar varios gastos de una" y salen todos los consumos juntos, cada uno con su fecha y su categoría.',
    ayuda: 'Cada consumo va con la fecha en que se consumió, aunque sea de un mes anterior: el EERR no se cierra nunca, si '
      + 'cargás algo de agosto estando en septiembre, agosto se recalcula solo. Y el pago del resumen NO es un gasto: cuando la '
      + 'tarjeta se debita del banco va como movimiento entre cuentas. Cargado como gasto, cada compra con tarjeta contaría dos '
      + 'veces en el resultado.',
    href: '/gastos',
  });

  pasos.push({
    id: 'movimientos_cuentas',
    titulo: 'Cargar los movimientos entre cuentas',
    estado: transferenciasMes.length > 0 ? 'listo' : 'pendiente',
    detalle: transferenciasMes.length > 0
      ? `${transferenciasMes.length} transferencia(s) cargada(s) este mes entre cuentas propias.`
      : 'Plata que pasó de un banco a otro, o de un banco a una caja, todavía no está cargada. Sin esto los saldos de las dos puntas no van a cerrar.',
    ayuda: 'No es un gasto: la plata sigue siendo de la empresa, solo cambió de cuenta. Se cargan abajo, en "Saldos y '
      + 'movimientos entre cuentas", eligiendo de dónde sale y a dónde entra.',
    href: `${hrefCargaRapida}#transferencias`,
  });

  pasos.push({
    id: 'pago_tarjeta',
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
    id: 'cobrado_banco',
    titulo: 'Revisar que estén todos los cobros del mes',
    estado: cobradoMes > 0 ? 'listo' : 'pendiente',
    detalle: cobradoMes > 0
      ? `$${Math.round(cobradoMes).toLocaleString('es-AR')} cobrados en el mes, según las cobranzas de Xubio.`
      : 'No figura ningún cobro este mes. Los cobros se imputan desde Cobranzas y de ahí salen solos; si falta alguno, los saldos de bancos y cajas no van a dar.',
    ayuda: 'Ya no hay que cargar el total cobrado a mano: sale de las cobranzas que están en Xubio, que se actualizan solas '
      + 'todas las mañanas y se pueden refrescar con el botón de Cobranzas.',
    href: '/cobranzas',
  });

  pasos.push({
    id: 'saldos_reales',
    titulo: 'Cargar el saldo real de cada cuenta',
    estado: sinSaldoReal === 0 ? 'listo' : sinSaldoReal === MEDIOS_PAGO.length ? 'pendiente' : 'pendiente',
    detalle: sinSaldoReal === 0
      ? 'Todas las cuentas tienen su saldo del resumen cargado.'
      : `Faltan ${sinSaldoReal} cuenta(s).${sinSaldoInicial > 0 ? ` Además, ${sinSaldoInicial} arrancan sin saldo inicial: cargalo en la columna "Inicial".` : ''}`,
  });

  pasos.push({
    id: 'conciliacion_ok',
    titulo: 'Que la conciliación dé ✓ en todas las cuentas',
    estado: sinSaldoReal > 0 ? 'recordatorio' : conDiferencia > 0 ? 'pendiente' : 'listo',
    detalle: sinSaldoReal > 0
      ? 'Se puede revisar recién cuando estén todos los saldos cargados.'
      : conDiferencia > 0
        ? `${conDiferencia} cuenta(s) con diferencia: hay plata que se movió sin quedar registrada.`
        : 'Ninguna cuenta tiene diferencia contra el resumen.',
  });

  pasos.push({
    id: 'previsiones',
    titulo: 'Guardar previsiones y cuentas corrientes',
    estado: hayPrevision ? 'listo' : 'pendiente',
    href: `/eerr?anio=${anio}&mes=${mes}#previsiones`,
    detalle: hayPrevision
      ? 'Guardadas para este mes. Restan del resultado y vuelven en el puente de caja: es plata comprometida que todavía está en la cuenta.'
      : 'Despidos y SAC se calculan solos sobre la masa salarial, pero hay que GUARDARLOS para que el mes quede fijo: hasta que no se guardan no restan del resultado. Se cargan más abajo, en esta misma pantalla.',
  });

  pasos.push({
    id: 'comparar_excel',
    titulo: 'Comparar contra tu Excel',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Armalo como siempre y contrastá línea por línea. Donde no dé, o falta un dato o está mal el cálculo — las dos cosas sirven.',
  });

  // Último paso a propósito: es el que dice que el mes está cerrado. Que sea manual no es
  // una limitación —es una decisión que tiene que tomar una persona mirando los números, no
  // una verificación automática que podría dar ✓ sobre datos cargados a medias.
  pasos.push({
    id: 'cierre_validado',
    titulo: 'Dar el mes por cerrado',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Cuando los pasos de arriba estén y el resultado tenga sentido, marcá acá. A partir de ahí el mes queda como revisado.',
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
