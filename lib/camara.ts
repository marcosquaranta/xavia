import type { Lote, VentaDia, StockCamara } from './types';
import { pesoPromedioRango } from './estadisticas';
import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

import { plantasDeVenta } from './articulos';
import { equivalenciaDeCajones, kgPorCajonDe } from './cosechaCajones';
export type CultivoCamara = 'rucula' | 'lechuga_crespa' | 'lechuga_roble' | 'albahaca';

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).split(/[\sT]/)[0];
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// ── Regla del mediodía ──────────────────────────────────────────────────────────────
// Las entregas de venta salen de 8 a 12hs, y la cosecha del día se hace a la mañana —
// así que una venta o cosecha fechada HOY recién se considera "ya afuera/adentro de
// cámara" a partir del mediodía; antes de esa hora, el pedido/la cosecha de hoy todavía
// no impactó el stock físico real. Eventos de días anteriores siempre cuentan, sin
// importar la hora. Se calcula en huso horario de Argentina explícitamente — new Date().
// getHours() en el server (Vercel) corre en UTC y dispararía la regla 3 horas antes de
// tiempo (mismo problema que ya se corrigió en el recordatorio de "hacer stock" del Panel).
const HORA_CORTE_MEDIODIA = 12;
function horaArgentina(momento: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(momento));
}
// Expuesto para quien consuma calcularCamara() y necesite saber, sin adivinar, si el
// "stockActual" que devuelve ya tiene descontadas las ventas de HOY o todavía no (regla
// del mediodía de arriba) — ej. el cuadro de "Disp. para venta" en Ventas, para no
// restar de nuevo lo que ya está restado (y para poder avisarlo en pantalla).
export function ventasDeHoyYaDescontadas(momentoRef: Date = new Date()): boolean {
  return horaArgentina(momentoRef) >= HORA_CORTE_MEDIODIA;
}
function fechaArgentina(momento: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(momento);
}
function yaConcretado(fechaEvento: any, momentoRef: Date): boolean {
  const str = String(fechaEvento || '').split(/[\sT]/)[0];
  if (!str) return false;
  const diaRef = fechaArgentina(momentoRef);
  if (str < diaRef) return true;
  if (str > diaRef) return false; // fecha futura respecto al momento de referencia — no cuenta
  return horaArgentina(momentoRef) >= HORA_CORTE_MEDIODIA;
}

// Momento REAL en que se cargó un registro de StockCamara — usa momento_carga (ms desde
// epoch) si está disponible; en registros viejos (de antes de este campo) se asume fin
// del día de su fecha, para no alterar retroactivamente cálculos ya hechos con el
// criterio anterior (que siempre contaba el mismo día como ya concretado).
function momentoDeRegistro(r: { momento_carga?: any; fecha_carga?: any; fecha: any }): Date {
  const ms = Number(r.momento_carga);
  if (ms > 0) return new Date(ms);
  const base = String(r.fecha_carga || '').trim() || String(r.fecha || '');
  const str = base.split(/[\sT]/)[0];
  const d = new Date(`${str}T23:59:59-03:00`);
  return isNaN(d.getTime()) ? new Date() : d;
}

function esRucula(variedad: string) {
  const v = String(variedad || '').toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}
function esCrespa(variedad: string) {
  return String(variedad || '').toLowerCase().includes('crespa');
}
function esAlbahaca(variedad: string) {
  return String(variedad || '').toLowerCase().includes('albahaca');
}
// "Roble" es el catch-all de LECHUGA (hoja de roble + cualquier otra variedad de lechuga
// que no sea explícitamente crespa) — así nunca se pierde stock de un lote con una variedad
// rara sin clasificar, igual criterio que ya se usa en lib/usoTeorico.ts. OJO: la albahaca
// se descuenta ANTES de llegar a ese catch-all — si no, toda la cosecha de albahaca se
// sumaba al stock de hoja de roble (no era "una variedad rara de lechuga", es otro cultivo
// con su propio stock y su propia venta).
function matchCultivo(cultivo: CultivoCamara, variedad: string): boolean {
  if (cultivo === 'rucula') return esRucula(variedad);
  if (cultivo === 'albahaca') return esAlbahaca(variedad);
  if (esRucula(variedad) || esAlbahaca(variedad)) return false;
  return cultivo === 'lechuga_crespa' ? esCrespa(variedad) : !esCrespa(variedad);
}

// Paquetes cosechados de `cultivo` con fecha posterior a `desde` y ya concretados
// (regla del mediodía) respecto a `momentoRef`.
function cosechadoEntre(cultivo: CultivoCamara, lotes: Lote[], desde: Date, momentoRef: Date): number {
  return lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const fechaCosecha = l.fecha_cosecha || l.fecha_ult_movimiento;
      const f = parseDate(fechaCosecha);
      if (!f || !(f > desde)) return false;
      return yaConcretado(fechaCosecha, momentoRef);
    })
    .reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);
}

// Gramos por paquete a usar para convertir ventas en KG a paquetes-equivalente, para
// clientes que compran por kg (ej. Select Food) — usa el peso REAL promedio de lo
// cosechado de este cultivo en la ÚLTIMA SEMANA respecto a `momentoRef` (pesoPromedioRango,
// misma fuente que ya usan el Panel/reporte semanal para "Peso promedio"), así el
// descuento de stock se ajusta solo si las plantas están saliendo más chicas o más
// grandes que el histórico — a pedido explícito, en vez de un gramaje fijo. Si esa semana
// no hubo ninguna cosecha de este cultivo para sacar un promedio, cae al valor fijo de
// siempre (mismo fallback que el resto de la app: GR_PAQ_RUCULA/GR_PAQ_LECHUGA).
function gramosPorPaqueteUltimaSemana(cultivo: CultivoCamara, lotes: Lote[], momentoRef: Date): number {
  const desde = new Date(momentoRef);
  desde.setDate(desde.getDate() - 7);
  const prom = pesoPromedioRango(lotes, desde, momentoRef);
  // Albahaca no se vende por kg (no existe un campo albahaca_kg en Ventas), así que este
  // gramaje nunca llega a usarse para ese cultivo — se deja el fallback de lechuga solo
  // para no devolver 0 y arriesgar una división por cero si algún día se agrega.
  const gr = cultivo === 'rucula' ? prom.rucula
    : cultivo === 'lechuga_crespa' ? prom.lechugaCrespa
    : cultivo === 'lechuga_roble' ? prom.lechugaRoble
    : 0;
  return gr > 0 ? gr : (cultivo === 'rucula' ? GR_PAQ_RUCULA : GR_PAQ_LECHUGA);
}

// Paquetes vendidos (exportados a Xubio) de `cultivo` con fecha posterior a `desde` y ya
// concretados (regla del mediodía) respecto a `momentoRef`. El export marca `exportado`
// con el id de exportación (ej. "EXP-20260619-1430"), NO con el literal 'SI'. Por eso se
// descuenta cualquier venta con exportado no vacío. lechuga_crespa/hoja_roble ya son
// campos separados en Ventas — no hace falta clasificar por texto de variedad como con
// las cosechas. Ventas en KG (rucula_kg/lechuga_kg_crespa/lechuga_kg_roble, + el legado
// lechuga_kg sin split que cae en "roble" como catch-all, mismo criterio que
// matchCultivo) se reconvierten a paquetes-equivalente con el peso promedio de la
// semana — antes NO se descontaban del stock de cámara en absoluto (un cliente por kg
// podía vaciar la cámara entera sin que el stock se moviera un solo paquete).
// Los CAJONES vendidos en el período: la venta por kilo sale de la cámara en cajones, no en
// paquetes. Es la misma plata y la misma planta, pero el bulto que se saca de la cámara es
// distinto, y por eso se cuentan en pilas separadas (ver calcularCamara).
function cajonesVendidosEntre(cultivo: CultivoCamara, ventas: VentaDia[], desde: Date, momentoRef: Date): number {
  const kgPorCajon = kgPorCajonDe(cultivo === 'rucula' ? 'rucula' : 'lechuga');
  if (!(kgPorCajon > 0)) return 0;
  const kg = ventas
    .filter((v) => {
      if (!v.exportado || String(v.exportado).trim() === '') return false;
      const f = parseDate(v.fecha);
      if (!f || !(f > desde)) return false;
      return yaConcretado(v.fecha, momentoRef);
    })
    .reduce((acc, v) => {
      if (cultivo === 'rucula') return acc + (Number(v.rucula_kg) || 0);
      if (cultivo === 'lechuga_crespa') return acc + (Number(v.lechuga_kg_crespa) || 0);
      if (cultivo === 'albahaca') return acc;
      return acc + (Number(v.lechuga_kg_roble) || 0) + (Number(v.lechuga_kg) || 0);
    }, 0);
  return kg / kgPorCajon;
}

// Lo vendido en PAQUETES. Lo que sale por kilo ya no entra acá: se cuenta como cajones.
function vendidoEntre(cultivo: CultivoCamara, ventas: VentaDia[], lotes: Lote[], desde: Date, momentoRef: Date): number {
  return ventas
    .filter(v => {
      if (!v.exportado || String(v.exportado).trim() === '') return false;
      const f = parseDate(v.fecha);
      if (!f || !(f > desde)) return false;
      return yaConcretado(v.fecha, momentoRef);
    })
    .reduce((acc, v) => {
      if (cultivo === 'rucula') {
        const directo = (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0);
        // Las ensaladas consumen plantas de la cámara igual que un paquete, solo que varias
        // por unidad vendida. Sin esto, vender ensaladas vaciaba la cámara sin que el stock
        // lo reflejara nunca.
        const ensaladas = plantasDeVenta(v, 'rucula') - directo;
        return acc + directo + Math.max(0, ensaladas);
      }
      if (cultivo === 'albahaca') {
        // Solo por unidad: no hay venta de albahaca por kg.
        return acc + (Number(v.albahaca) || 0);
      }
      if (cultivo === 'lechuga_crespa') {
        // Incluye las plantas de crespa que se van en ensaladas: salen de la misma cámara.
        return acc + plantasDeVenta(v, 'lechuga', 'crespa');
      }
      return acc + (Number(v.hoja_roble) || 0);
    }, 0);
}

export interface ResultadoCamara {
  cultivo: CultivoCamara;
  stockActual: number;
  diasPromedio: number;
  // ── Lo más viejo que queda en cámara ──────────────────────────────────────────────
  //
  // El promedio esconde justo lo que importa. Un cultivo con 500 paquetes de ayer y 40 de
  // hace ocho días da un promedio de un día y medio: parece fresco, y hay 40 paquetes a
  // punto de tirarse. Lo que decide si hay que sacar algo hoy es la punta vieja de la cola,
  // no el centro.
  diasMasViejo: number;
  cantidadMasVieja: number;
  base: StockCamara | null;
  // ── La pila de cajones ────────────────────────────────────────────────────────────
  //
  // Un cajón no es un paquete: es otro bulto, se arma distinto y se vende a otro cliente. En
  // la cámara ocupan lugares distintos y se sacan por separado, así que se cuentan por
  // separado — con las mismas reglas: entra lo cosechado, sale lo vendido por kilo, se
  // descuenta FIFO y lo más viejo avisa a los mismos días.
  //
  // Mezclarlos en una sola pila convertida a paquetes daba un número que no se podía contar
  // contra nada: nadie cuenta "paquetes equivalentes" en la cámara, se cuentan cajones.
  cajones: {
    stockActual: number;
    diasPromedio: number;
    diasMasViejo: number;
    cantidadMasVieja: number;
  };
}

// A partir de acá un lote de cámara deja de ser stock y pasa a ser un problema. Cinco días,
// definido por Marcos.
export const DIAS_CAMARA_ALERTA = 5;

export function calcularCamara(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[]
): ResultadoCamara {
  const hoy = new Date();

  // Último registro base para este cultivo — si dos registros caen en la MISMA fecha
  // (ej. dos ajustes cargados el mismo día), hay que quedarse con el que se cargó
  // DESPUÉS, no con cualquiera de los dos al azar. Array.sort es estable, así que un
  // sort descendente por fecha con .find(() => true) (= tomar el primero) en realidad
  // devolvía el más VIEJO de ese empate (el que apareció primero en la hoja, no el
  // último cargado) — un segundo ajuste el mismo día quedaba "invisible": la carga se
  // guardaba bien pero el stock mostrado no cambiaba, como si el click no hubiera hecho
  // nada. Se desempata explícitamente por índice original (el cargado después gana).
  const base = registros
    .map((r, i) => ({ r, i }))
    // Una baja por descarte NO es un recuento: su cantidad_paq va en cero. Si entrara acá
    // como base, el stock del cultivo se derrumbaría a cero apenas se cargue un descarte.
    .filter(({ r }) => r.cultivo === cultivo && r.tipo !== 'descarte')
    .sort((a, b) => {
      const cmp = String(b.r.fecha).localeCompare(String(a.r.fecha));
      return cmp !== 0 ? cmp : b.i - a.i;
    })[0]?.r ?? null;

  if (!base) return { cultivo, stockActual: 0, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0, base: null, cajones: { stockActual: 0, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0 } };

  const fechaBase = parseDate(base.fecha);
  if (!fechaBase) return { cultivo, stockActual: 0, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0, base, cajones: { stockActual: 0, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0 } };

  const cantidadBase = Number(base.cantidad_paq) || 0;
  // La EDAD de lo contado, que no es lo mismo que la fecha del conteo. Si quien contó dijo de
  // cuándo es lo más viejo, la pila arranca con esa fecha; si no, con la del conteo (que es
  // lo que se venía haciendo, y lo que hacía que contar reiniciara la alerta de antigüedad).
  // El CORTE —desde cuándo suman las cosechas y restan las ventas— sigue siendo `fechaBase`:
  // mezclar las dos cosas volvería a contar cosechas que ya estaban adentro del recuento.
  const fechaEdadBase = parseDate((base as any).fecha_origen) || fechaBase;

  // Cosechas desde fechaBase (exclusive: solo posteriores a la base), con la regla del
  // mediodía aplicada respecto a "ahora" — antes esto no tenía límite superior alguno,
  // así que una cosecha de HOY a la mañana ya sumaba al stock aunque el conteo se
  // estuviera haciendo antes de que termine la jornada de cosecha.
  const cosechas = lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const fechaCosecha = l.fecha_cosecha || l.fecha_ult_movimiento;
      const f = parseDate(fechaCosecha);
      if (!f || !(f > fechaBase)) return false;
      return yaConcretado(fechaCosecha, hoy);
    })
    .map((l) => {
      // `unidades_cosechadas` trae el TOTAL en paquetes-equivalente, cajones incluidos (ver
      // lib/cosechaCajones.ts). Para la pila de paquetes hay que sacarle esa parte: si no, lo
      // que salió en cajones estaría contado en las dos pilas.
      const cajones = Number(l.cajones_armados) || 0;
      const eq = cajones > 0
        ? equivalenciaDeCajones({
            variedad: String(l.variedad || ''),
            cajones,
            pesoPaqueteGr: Number(l.peso_muestra_paquete_gr) || 0,
          }).paquetesEquivalentes
        : 0;
      return {
        fecha: parseDate(l.fecha_cosecha || l.fecha_ult_movimiento)!,
        cantidad: Math.max(0, (Number(l.unidades_cosechadas) || 0) - eq),
        cajones,
      };
    })
    .filter(e => e.cantidad > 0 || e.cajones > 0);

  const totalVendido = vendidoEntre(cultivo, ventas, lotes, fechaBase, hoy);
  const totalCosechado = cosechas.reduce((a, c) => a + c.cantidad, 0);
  const totalCajonesCosechados = cosechas.reduce((a, c) => a + c.cajones, 0);
  // Lo que se tiró desde el último recuento. Sale del stock igual que una venta: el
  // producto ya no está. Sin esto, cada descarte reaparecería como un faltante inexplicable
  // en el próximo conteo — que es justo el número que se usa para detectar problemas.
  //
  // Solo las filas tipo 'descarte'. El `descarte_paq` que se carga junto a un AJUSTE ya
  // está contemplado en el recuento absoluto de ese ajuste: restarlo otra vez sería
  // descontar dos veces el mismo producto.
  const momentoBase = Number((base as any).momento_carga) || 0;
  const totalDescartado = registros
    .filter((r) => {
      if (r.cultivo !== cultivo || r.tipo !== 'descarte') return false;
      const f = parseDate(r.fecha);
      if (!f) return false;
      if (f > fechaBase) return true;
      // Mismo día que el recuento: cuenta solo si se cargó DESPUÉS. Un descarte anotado a
      // la mañana y un recuento al mediodía ya lo tiene adentro.
      return f.getTime() === fechaBase.getTime() && (Number((r as any).momento_carga) || 0) > momentoBase;
    })
    .reduce((a, r) => a + (Number(r.descarte_paq) || 0), 0);
  // Redondeado: un paquete es una unidad discreta, y desde que vendidoEntre() convierte
  // ventas en kg a paquetes-equivalente (kg*1000/gramosPorPaquete) el resultado casi
  // nunca da un número entero exacto. Sin este redondeo, un stock de p.ej. 483.51 paquetes
  // se mostraba tal cual con toLocaleString('es-AR') — que usa la COMA como separador
  // decimal — y salía en pantalla como "483,51" pero interpretado a simple vista como
  // "483.514" con la coma de miles invertida (formato de EEUU), un salto disparatado que
  // no era ningún error de cálculo real, solo de formato.
  const stockActual = Math.round(Math.max(0, cantidadBase + totalCosechado - totalVendido - totalDescartado));

  // FIFO para días promedio
  // Cola: base primero, luego cosechas ordenadas por fecha ASC
  const cola: { fecha: Date; cantidad: number }[] = [
    { fecha: fechaEdadBase, cantidad: cantidadBase },
    ...cosechas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
  ];

  // Descontar ventas empezando por lo más antiguo
  let porDescontar = totalVendido;
  for (const entrada of cola) {
    if (porDescontar <= 0) break;
    const desc = Math.min(entrada.cantidad, porDescontar);
    entrada.cantidad -= desc;
    porDescontar -= desc;
  }

  // Calcular días promedio ponderado de lo que queda
  const restantes = cola.filter(e => e.cantidad > 0);
  const totalRestante = restantes.reduce((a, e) => a + e.cantidad, 0);
  if (totalRestante === 0) {
    return {
      cultivo, stockActual, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0, base,
      cajones: pilaDeCajones(cultivo, base, fechaBase, cosechas, totalCajonesCosechados, ventas, hoy),
    };
  }

  const diasProm = restantes.reduce((acc, e) => {
    const dias = Math.round((hoy.getTime() - e.fecha.getTime()) / 86400000);
    return acc + dias * e.cantidad;
  }, 0) / totalRestante;

  // La entrada más vieja que todavía tiene unidades. La cola ya está en orden FIFO y las
  // ventas se descontaron desde el principio, así que la primera que sobrevivió es la más
  // vieja que queda en la cámara.
  //
  // Se informa junto con su cantidad y no sola: "hace 8 días" no dice si hay que correr o
  // no — con 12 paquetes se resuelve regalándolos, con 600 hay que llamar a un cliente hoy.
  //
  // El stock se redondea arriba (`stockActual`) pero la cola trabaja con el crudo, así que
  // la cantidad más vieja se acota al stock real: sin eso, con un stock de 0 por redondeo
  // podría informar 0,4 unidades de hace ocho días.
  const masVieja = restantes[0];
  const diasMasViejo = Math.round((hoy.getTime() - masVieja.fecha.getTime()) / 86400000);
  const cantidadMasVieja = Math.min(Math.round(masVieja.cantidad), stockActual);

  return {
    cultivo, stockActual, diasPromedio: Math.round(diasProm), diasMasViejo, cantidadMasVieja, base,
    cajones: pilaDeCajones(cultivo, base, fechaBase, cosechas, totalCajonesCosechados, ventas, hoy),
  };
}

// La pila de cajones, con las mismas reglas que la de paquetes: base contada + cosechado −
// vendido, FIFO de lo más viejo a lo más nuevo, y la punta vieja informada aparte del
// promedio.
//
// La base sale de `cantidad_cajones` del último recuento. Mientras nadie haya contado cajones
// nunca, arranca en cero y lo que se ve es lo cosechado menos lo vendido — que es exactamente
// lo que pasa con los paquetes antes del primer conteo.
function pilaDeCajones(
  cultivo: CultivoCamara,
  base: StockCamara,
  fechaBase: Date,
  cosechas: { fecha: Date; cajones: number }[],
  totalCosechado: number,
  ventas: VentaDia[],
  hoy: Date,
): ResultadoCamara['cajones'] {
  const cantidadBase = Number((base as any).cantidad_cajones) || 0;
  const fechaEdadBase = parseDate((base as any).fecha_origen) || fechaBase;
  const vendidos = cajonesVendidosEntre(cultivo, ventas, fechaBase, hoy);
  const stockActual = Math.round(Math.max(0, cantidadBase + totalCosechado - vendidos));

  const cola: { fecha: Date; cantidad: number }[] = [
    { fecha: fechaEdadBase, cantidad: cantidadBase },
    ...cosechas.filter((c) => c.cajones > 0).map((c) => ({ fecha: c.fecha, cantidad: c.cajones }))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
  ];
  let porDescontar = vendidos;
  for (const e of cola) {
    if (porDescontar <= 0) break;
    const desc = Math.min(e.cantidad, porDescontar);
    e.cantidad -= desc;
    porDescontar -= desc;
  }
  const restantes = cola.filter((e) => e.cantidad > 0);
  const total = restantes.reduce((a, e) => a + e.cantidad, 0);
  if (total === 0 || stockActual === 0) return { stockActual, diasPromedio: 0, diasMasViejo: 0, cantidadMasVieja: 0 };

  const diasProm = restantes.reduce((acc, e) => {
    const dias = Math.round((hoy.getTime() - e.fecha.getTime()) / 86400000);
    return acc + dias * e.cantidad;
  }, 0) / total;
  const masVieja = restantes[0];
  return {
    stockActual,
    diasPromedio: Math.round(diasProm),
    diasMasViejo: Math.round((hoy.getTime() - masVieja.fecha.getTime()) / 86400000),
    cantidadMasVieja: Math.min(Math.round(masVieja.cantidad), stockActual),
  };
}

// Diferencia entre una cantidad nueva (contada a mano) y lo que el sistema esperaba
// tener en cámara a esa fecha (stock teórico según la última base + movimientos desde
// entonces). Sirve tanto para avisar al cargar un ajuste como para el acumulado mensual.
export function diferenciaAjuste(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  cantidadNueva: number,
  fecha: Date = new Date()
): number {
  const anteriores = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha), _m: momentoDeRegistro(r) }))
    .filter((r): r is StockCamara & { _f: Date; _m: Date } => !!r._f && r._m <= fecha)
    .sort((a, b) => a._m.getTime() - b._m.getTime());
  const prev = anteriores[anteriores.length - 1];
  if (!prev) return 0; // sin base previa, no hay con qué comparar

  const cosechado = cosechadoEntre(cultivo, lotes, prev._f, fecha);
  const vendido = vendidoEntre(cultivo, ventas, lotes, prev._f, fecha);
  const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
  return Math.round(cantidadNueva - teorico);
}

export interface DiferenciaAjustesMes { acumulado: number; cantidadAjustes: number }

// Suma las diferencias reveladas por cada ajuste de tipo "ajuste" cuya fecha de negocio
// cae en [desde, hasta] (ambos inclusive) — "cuánto se corrigió" acumulado en ese rango.
// La secuencia prev→curr y el corte de cosechado/vendido usan el momento REAL de carga
// de cada registro (momento_carga), no solo su fecha de negocio — así un ajuste cargado
// a la mañana (antes del mediodía) no se compara contra las ventas del día como si ya
// hubieran salido, igual criterio que calcularCamara(). Base de diferenciaAjustesMes()
// (rango = el mes) y de cualquier otro rango puntual (ej. la semana del reporte semanal).
export function diferenciaAjustesRango(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  desde: Date,
  hasta: Date
): DiferenciaAjustesMes {
  const ordenados = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha), _m: momentoDeRegistro(r) }))
    .filter((r): r is StockCamara & { _f: Date; _m: Date } => !!r._f)
    .sort((a, b) => a._m.getTime() - b._m.getTime());

  let acumulado = 0, cantidadAjustes = 0;
  for (let i = 1; i < ordenados.length; i++) {
    const curr = ordenados[i];
    if (curr.tipo !== 'ajuste') continue;
    if (curr._f < desde || curr._f > hasta) continue;
    const prev = ordenados[i - 1];
    const cosechado = cosechadoEntre(cultivo, lotes, prev._f, curr._m);
    const vendido = vendidoEntre(cultivo, ventas, lotes, prev._f, curr._m);
    const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
    acumulado += Number(curr.cantidad_paq) - teorico;
    cantidadAjustes++;
  }
  return { acumulado: Math.round(acumulado), cantidadAjustes };
}

// Suma las diferencias del mes de `fechaRef` (por defecto el mes en curso).
export function diferenciaAjustesMes(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  fechaRef: Date = new Date()
): DiferenciaAjustesMes {
  const desde = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1);
  const hasta = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0, 23, 59, 59);
  return diferenciaAjustesRango(cultivo, registros, lotes, ventas, desde, hasta);
}
