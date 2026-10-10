import type { Gasto, StockMes, Articulo } from './types';
import { MEDIOS_PAGO } from './types';
import type { EERR } from './eerr';
import type { SaldoMes } from './cuentas';

// ── Checklist del cierre mensual ──────────────────────────────────────────────────────
//
// El problema del cierre no es que sea difícil, es que son doce cosas y siempre falta una.
// Esto las lista y, donde puede, dice sola si está hecha mirando los datos.
//
// Esta es LA instrucción del cierre, y es la única. Hubo tres: una página aparte con los
// pasos explicados, otra con la regla de qué va en la app y qué en Xubio, y este checklist
// con el estado. Nadie mantiene tres listas de lo mismo: las que envejecen son las que no se
// miran todos los meses, y son justamente las que alguien va a leer el día que se olvide cómo
// se hacía algo. Ahora el "cómo" y el "cuánto falta" viven en el mismo renglón —el `ayuda` de
// cada paso— y la regla de trabajo está en la misma pantalla, abajo del checklist.
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
  saldos: SaldoMes[];
  hayPrevision: boolean;
  // La previsión que está guardada y la que saldría hoy de la masa salarial. Se comparan:
  // el automático corre el día 5 con los sueldos que haya entonces, y si después se carga
  // uno que faltaba, lo guardado queda viejo sin que nada avise.
  previsionGuardada?: { despidos: number; sac: number; usuario: string } | null;
  previsionDeHoy?: { despidos: number; sac: number } | null;
  anio: number;
  mes: number;
}): PasoCierre[] {
  const { eerr, gastos, stocks, articulos, saldos, hayPrevision, previsionGuardada, previsionDeHoy, anio, mes } = args;
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

  // ── 1 ──────────────────────────────────────────────────────────────────────────────
  //
  // Un solo paso para los resúmenes, y antes eran tres: bajarlos, cargar los gastos del
  // banco y desglosar la tarjeta. En la práctica es un solo rato de trabajo con los
  // resúmenes abiertos al lado, y partirlo en tres hacía parecer que había tres cosas
  // distintas que hacer en tres momentos distintos.
  //
  // Queda como marcado a mano —nadie puede verificar que los resúmenes se miraron— pero el
  // detalle dice lo que SÍ se puede ver: si ya hay sueldos y consumos de tarjeta cargados.
  // Es el dato útil sin poner un ✓ por adivinanza.
  const haySueldos = eerr.masaSalarial > 0;
  pasos.push({
    id: 'banco_resumenes',
    titulo: 'Conciliar los resúmenes del banco y de la tarjeta',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Bajá Macro, Brubank y el resumen de la tarjeta del mes que estás cerrando, y tenelos abiertos al lado. '
      + 'De ahí sale todo lo que sigue: los gastos que no están en la app (sueldos, nafta, viáticos, impuestos), los '
      + 'consumos con tarjeta y los saldos reales de cada cuenta. '
      + (haySueldos || conTarjeta > 0
        ? `Hasta ahora: ${haySueldos ? `$${Math.round(eerr.masaSalarial).toLocaleString('es-AR')} de sueldos` : 'ningún sueldo'}`
          + ` y ${conTarjeta > 0 ? `${conTarjeta} consumo(s) con VISA` : 'ningún consumo con VISA'} cargados este mes.`
        : 'Todavía no hay sueldos ni consumos con VISA cargados este mes.'),
    ayuda: 'Nada de esto se carga de a uno. El resumen de la tarjeta y los del banco se pegan enteros en "Cargar varios '
      + 'gastos de una" y salen todos los movimientos juntos, cada uno con su fecha y su categoría. '
      + 'Los débitos automáticos sí se resumen: un mes puede tener cincuenta líneas de impuesto al cheque de trescientos '
      + 'pesos — sumalas en el resumen y cargá UNA línea, "Impuesto al cheque — septiembre", categoría Impuestos, con el '
      + 'banco como medio de pago. Lo mismo con comisiones y mantenimiento de cuenta: para el resultado y para el saldo da '
      + 'exactamente igual, y son dos líneas en vez de cincuenta. '
      + 'Cada gasto va con la fecha real en que salió la plata, no con la de hoy, y los consumos de tarjeta con la fecha en '
      + 'que se consumieron aunque sean de un mes anterior: el EERR no se cierra nunca, si cargás algo de agosto estando en '
      + 'septiembre, agosto se recalcula solo. '
      + 'El total cobrado no se carga: sale solo de las cobranzas que la app tiene de Xubio.',
    href: '/gastos',
  });

  // ── 2 ──────────────────────────────────────────────────────────────────────────────
  pasos.push({
    id: 'stock_final',
    titulo: 'Cargar el stock final de todos los artículos (Franco)',
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

  // ── 3 ──────────────────────────────────────────────────────────────────────────────
  //
  // El pago de la tarjeta y las transferencias entre cuentas, juntos: son lo mismo —plata
  // que cambió de cuenta sin ser un gasto— y se cargan en el mismo lugar de la misma forma.
  // Como dos pasos separados, el de la tarjeta se leía como algo aparte y terminaba cargado
  // como gasto, que es justamente el error que hay que evitar.
  const faltaPagoTarjeta = !pagoTarjetaMes && consumoTarjetaMesPasado > 0;
  pasos.push({
    id: 'movimientos_cuentas',
    titulo: 'Marcar el pago de la tarjeta y las transferencias entre cuentas',
    estado: faltaPagoTarjeta || transferenciasMes.length === 0 ? 'pendiente' : 'listo',
    detalle: [
      pagoTarjetaMes
        ? `Pago de la tarjeta cargado: $${Math.round(Number(pagoTarjetaMes.monto) || 0).toLocaleString('es-AR')} de ${pagoTarjetaMes.medio_pago} a VISA.`
        : consumoTarjetaMesPasado > 0
          ? `Falta el pago de la tarjeta: el mes pasado se consumieron $${Math.round(consumoTarjetaMesPasado).toLocaleString('es-AR')} — buscá en el resumen un débito parecido.`
          : 'El mes pasado no hubo consumos con tarjeta: no hay resumen que pagar este mes.',
      transferenciasMes.length > 0
        ? `${transferenciasMes.length} transferencia(s) entre cuentas propias cargada(s).`
        : 'No hay ninguna transferencia entre cuentas cargada: sin eso los saldos de las dos puntas no cierran.',
    ].join(' '),
    ayuda: 'Nada de esto es un gasto: la plata sigue siendo de la empresa, solo cambió de cuenta. Se cargan abajo, en '
      + '"Saldos y movimientos entre cuentas", eligiendo de dónde sale y a dónde entra. Si el pago de la tarjeta se cargara '
      + 'como gasto, cada compra con tarjeta contaría dos veces en el resultado del mes.',
    href: `${hrefCargaRapida}#transferencias`,
  });

  // ── 4 ──────────────────────────────────────────────────────────────────────────────
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

  // ── 5 ──────────────────────────────────────────────────────────────────────────────
  //
  // El saldo real y la conciliación en un solo renglón. Eran dos pasos y el segundo no era
  // una tarea sino el resultado del primero: no hay nada que "hacer" para que la
  // conciliación dé ✓ más que cargar el gasto o el cobro que falta.
  pasos.push({
    id: 'saldos_reales',
    titulo: 'Cargar el saldo real de cada cuenta (bancos y cajas de cada uno)',
    estado: sinSaldoReal > 0 ? 'pendiente' : conDiferencia > 0 ? 'pendiente' : 'listo',
    detalle: sinSaldoReal > 0
      ? `Faltan ${sinSaldoReal} cuenta(s).${sinSaldoInicial > 0 ? ` Además, ${sinSaldoInicial} arrancan sin saldo inicial: cargalo en la columna "Inicial".` : ''}`
      : conDiferencia > 0
        ? `Están todos cargados, pero ${conDiferencia} cuenta(s) no cierran contra el resumen: hay plata que se movió sin quedar registrada.`
        : 'Todas las cuentas tienen su saldo del resumen y ninguna tiene diferencia.',
    ayuda: 'El saldo real es el que dice el resumen al último día del mes. La app ya calculó cuánto debería haber, y la '
      + 'diferencia entre los dos números es la conciliación: si no da ✓, falta cargar un gasto, un cobro o una '
      + 'transferencia. La primera vez las cuentas no tienen saldo inicial —sale del cierre del mes anterior, que todavía no '
      + 'existe—: se carga a mano una sola vez en la columna "Inicial" y de ahí en más se encadena solo.',
    href: `/eerr?anio=${anio}&mes=${mes}#cuentas`,
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────────────
  //
  // Las previsiones ya no son una tarea: se guardan solas una vez por mes (ver
  // /api/cron/previsiones). Queda en la lista porque hay que poder ver que están y
  // corregirlas si el mes tuvo algo que ninguna fórmula sabe.
  pasos.push({
    id: 'previsiones',
    titulo: 'Previsiones del mes — se guardan solas',
    estado: !hayPrevision ? 'pendiente'
      : (previsionGuardada && previsionDeHoy
        && Math.abs((previsionGuardada.despidos + previsionGuardada.sac) - (previsionDeHoy.despidos + previsionDeHoy.sac)) >= 1)
        ? 'pendiente' : 'listo',
    href: `/eerr?anio=${anio}&mes=${mes}#previsiones`,
    detalle: hayPrevision
      ? (() => {
        const g = previsionGuardada, h = previsionDeHoy;
        const desfasada = g && h && Math.abs((g.despidos + g.sac) - (h.despidos + h.sac)) >= 1;
        const quien = g?.usuario === 'automático' ? 'Guardadas solas' : 'Guardadas a mano';
        if (desfasada) {
          return `${quien}, pero quedaron viejas: con los sueldos que hay cargados hoy darían `
            + `$${Math.round(h!.despidos + h!.sac).toLocaleString('es-AR')} en vez de `
            + `$${Math.round(g!.despidos + g!.sac).toLocaleString('es-AR')}. Se cargó un sueldo después de que se guardaron — `
            + 'actualizalas más abajo si el mes todavía no está cerrado.';
        }
        return `${quien} para este mes. Restan del resultado y vuelven en el puente de caja: es plata comprometida que todavía está en la cuenta.`;
      })()
      : 'Todavía no están guardadas. Se guardan solas a partir del día 5 del mes siguiente, cuando ya están los sueldos cargados; '
        + 'si necesitás que estén ahora, guardalas más abajo en esta misma pantalla.',
    ayuda: 'Despidos y SAC salen de la masa salarial del mes (6% y un doceavo) y se guardan automáticamente una vez por mes. '
      + 'Guardarlas es lo que hace que el mes quede fijo: si no, los números del cierre cambiarían solos el día que se '
      + 'corrija un sueldo cargado tarde, y un cierre que se mueve no sirve para comparar. Alquiler y EPE van a mano, y '
      + 'cualquier valor que se edite a mano le gana al automático.',
  });

  // ── 7 ──────────────────────────────────────────────────────────────────────────────
  pasos.push({
    id: 'comparar_excel',
    titulo: 'Comparar contra tu Excel',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Armalo como siempre y contrastá línea por línea. Donde no dé, o falta un dato o está mal el cálculo — encontrar cuál de las dos también es ganancia.',
  });

  // ── 8 ──────────────────────────────────────────────────────────────────────────────
  //
  // Último a propósito: es el que dice que el mes está cerrado. Que sea manual no es una
  // limitación —es una decisión que tiene que tomar una persona mirando los números, no una
  // verificación automática que podría dar ✓ sobre datos cargados a medias.
  pasos.push({
    id: 'cierre_validado',
    titulo: 'Dar el mes por cerrado',
    estado: 'recordatorio',
    manual: true,
    detalle: 'Cuando los pasos de arriba estén y el resultado tenga sentido, marcá acá. A partir de ahí el mes queda como revisado.',
  });

  return pasos;
}

// Cuántos pasos cuentan para el "X de Y".
//
// Cuentan los que la app puede verificar MÁS los que se marcan a mano: los manuales son
// pasos reales del cierre, y dejarlos afuera del total mientras la pantalla los sumaba a los
// hechos daba "8 de 5 · faltan −3" en cuanto se tildaban los tres.
//
// Lo que no cuenta es un paso informativo que no pide nada —"ninguna compra de insumos
// cargada este mes"—: no hay nada que hacer ahí, así que no es algo que falte.
export function resumenChecklist(pasos: PasoCierre[]): { listos: number; pendientes: number; total: number } {
  const cuentan = pasos.filter((p) => p.estado !== 'recordatorio' || p.manual);
  return {
    listos: cuentan.filter((p) => p.estado === 'listo').length,
    pendientes: cuentan.filter((p) => p.estado === 'pendiente').length,
    total: cuentan.length,
  };
}
