import type { RegistroCrossChex } from './crosschex';
import type { Empleado } from './types';

// Todo en hora de Argentina (fija, sin horario de verano) sin importar en qué huso
// horario corra el servidor — CrossChex devuelve los fichajes en ISO con offset UTC.
const TZ = 'America/Argentina/Buenos_Aires';
const fmtArg = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function partesArg(iso: string): { fecha: string; horaMin: number } {
  const d = new Date(iso);
  const parts = fmtArg.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, horaMin: Number(get('hour')) * 60 + Number(get('minute')) };
}
// Fecha de "hoy" en Argentina, para el aviso del home (solo tardanzas del día, no de toda
// la quincena).
export function hoyArg(): string {
  return partesArg(new Date().toISOString()).fecha;
}
// Fecha (YYYY-MM-DD) en Argentina de un fichaje puntual — para agrupar fichajes por
// semana/día fuera de este archivo (ver lib/productividad.ts) sin duplicar el parseo TZ.
export function fechaArg(iso: string): string {
  return partesArg(iso).fecha;
}
function fmtHoraMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function minDeHora(hhmm: string): number {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

// Período 0: el mes entero (es el que se usa desde que se paga por mes). Quincena 1:
// días 1-15. Quincena 2: 16 al último día. begin_time/end_time con offset -03:00 explícito
// (Argentina no tiene horario de verano) para que CrossChex devuelva exactamente el rango
// del día en hora local, sin importar la zona del server.
//
// Se mantienen las quincenas y no se borran: los meses ya liquidados así están guardados
// con su número de quincena, y una liquidación vieja tiene que poder volver a mirarse tal
// como se pagó.
export type PeriodoPago = 0 | 1 | 2;
export function rangoQuincena(anio: number, mes: number, quincena: PeriodoPago): { desde: string; hasta: string; diasDesde: number; diasHasta: number } {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const diasDesde = quincena === 2 ? 16 : 1;
  const diasHasta = quincena === 1 ? 15 : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    desde: `${anio}-${pad(mes)}-${pad(diasDesde)}T00:00:00-03:00`,
    hasta: `${anio}-${pad(mes)}-${pad(diasHasta)}T23:59:59-03:00`,
    diasDesde, diasHasta,
  };
}

// Rango desde el día 1 de un mes hasta un día de corte puntual (o el último día del mes
// si no se pasa uno), mismo formato -03:00 que rangoQuincena — para el indicador de
// productividad (paquetes/hora-hombre), que compara "mes en curso hasta hoy" contra
// "mes pasado hasta el mismo día del mes" (mismo criterio que cosechadoEsteMes).
export function rangoMes(anio: number, mes: number, diaHastaOverride?: number): { desde: string; hasta: string } {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const diaHasta = diaHastaOverride ? Math.min(diaHastaOverride, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    desde: `${anio}-${pad(mes)}-01T00:00:00-03:00`,
    hasta: `${anio}-${pad(mes)}-${pad(diaHasta)}T23:59:59-03:00`,
  };
}

// Horas teóricas de la quincena calculadas solas a partir del calendario real (cuántos
// lunes-a-viernes y cuántos sábados caen en ese rango puntual), en vez de un número fijo
// tipeado a mano — así no hay que corregir a mano cuando una quincena tiene, por ejemplo,
// un sábado de más que otra.
export function horasTeoricasAuto(anio: number, mes: number, diasDesde: number, diasHasta: number, horasLV: number, horasSabado: number): number {
  let total = 0;
  for (let d = diasDesde; d <= diasHasta; d++) {
    const dow = new Date(anio, mes - 1, d).getDay(); // 0=domingo .. 6=sábado
    if (dow >= 1 && dow <= 5) total += horasLV;
    else if (dow === 6) total += horasSabado;
  }
  return Math.round(total * 100) / 100;
}

// Agrupa fichajes por empleado (workno) y por día (fecha en hora Argentina). CrossChex
// no distingue de forma confiable entrada/salida vía "checktype" (es más bien el método
// de verificación) — el criterio acá es: primer fichaje del día = entrada, último =
// salida. Un solo fichaje ese día queda marcado "incompleto" (no se puede calcular horas).
function agruparPorEmpleadoYDia(registros: RegistroCrossChex[]): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const r of registros) {
    const workno = String(r.employee?.workno || '');
    if (!workno) continue;
    const { fecha } = partesArg(r.checktime);
    if (!out.has(workno)) out.set(workno, new Map());
    const porDia = out.get(workno)!;
    if (!porDia.has(fecha)) porDia.set(fecha, []);
    porDia.get(fecha)!.push(r.checktime);
  }
  return out;
}

// Suma las horas trabajadas de un día emparejando los fichajes de a pares consecutivos
// (1º-2º = una entrada/salida, 3º-4º = otra, etc.) en vez de tomar solo el primer y el
// último fichaje del día — así un empleado que entra y sale dos veces en el mismo día
// (ej. corte de almuerzo, salida y vuelta) no queda contado como si hubiera trabajado
// de punta a punta, incluyendo el hueco de en medio como si fuera trabajo. Si sobra un
// fichaje sin pareja (se olvidó marcar la vuelta), se cuentan igual los pares completos
// y el día queda marcado incompleto (no se puede saber cuánto duró esa última vuelta).
// ── Dos marcas del mismo momento son una sola ────────────────────────────────────────
//
// Pasa seguido: el reloj no suena, o no se ve la luz verde, y la persona vuelve a apoyar
// el dedo. Quedan dos fichajes separados por segundos.
//
// Para el emparejamiento eso es destructivo, no cosmético: con 3 marcas (07:00, 07:01,
// 15:00) el primer par es un turno de UN MINUTO y la salida real se queda sin pareja, así
// que el día computa casi cero horas y encima queda "incompleto". Nadie lo mira como un
// error de lectura — se lee como que esa persona no vino.
//
// Nadie entra y sale de verdad en menos de este rato, así que colapsarlas no puede tapar
// un turno real: el corte de almuerzo más corto dura más que esto.
const MINUTOS_MISMA_MARCA = 5;

function sinMarcasRepetidas(checksMin: number[]): number[] {
  const out: number[] = [];
  for (const m of checksMin) {
    if (out.length && m - out[out.length - 1] <= MINUTOS_MISMA_MARCA) continue;
    out.push(m);
  }
  return out;
}

function sumarHorasPares(checksRaw: number[]): { horas: number; entrada: number; salidaFinal: number | null; incompleto: boolean } {
  const checksMin = sinMarcasRepetidas(checksRaw);
  const entrada = checksMin[0];
  if (checksMin.length < 2) return { horas: 0, entrada, salidaFinal: null, incompleto: true };
  let horas = 0;
  const pares = Math.floor(checksMin.length / 2);
  for (let i = 0; i < pares; i++) horas += Math.max(0, (checksMin[i * 2 + 1] - checksMin[i * 2]) / 60);
  const impar = checksMin.length % 2 === 1;
  return { horas, entrada, salidaFinal: impar ? null : checksMin[checksMin.length - 1], incompleto: impar };
}

// Total de horas-hombre reales trabajadas (todos los empleados, todos los días) en un
// conjunto de fichajes ya traído de CrossChex para el rango que corresponda — para el
// indicador de productividad (paquetes cosechados ÷ horas-hombre). Mismo criterio de
// emparejamiento que calcularResumenQuincena (ver sumarHorasPares); un solo fichaje ese
// día queda "incompleto" y no aporta horas (no se puede calcular).
export function horasHombreEnRango(registros: RegistroCrossChex[]): number {
  const porEmpleadoDia = agruparPorEmpleadoYDia(registros);
  let total = 0;
  for (const porDia of porEmpleadoDia.values()) {
    for (const isos of porDia.values()) {
      const checks = isos.map((iso) => partesArg(iso).horaMin).sort((a, b) => a - b);
      total += sumarHorasPares(checks).horas;
    }
  }
  return Math.round(total * 100) / 100;
}

export interface DiaTrabajado {
  fecha: string;
  diaSemana: string; // 'lun'..'dom', para mostrar de un vistazo qué día de la semana es
  esDomingo: boolean; // domingo nunca es día programado — cualquier hora trabajada es "de más"
  entrada: string | null;
  salida: string | null;
  // Las horas que se le computan. Si el día quedó incompleto —fichó la entrada y no la
  // salida— son las esperadas de ese día y no las que alcanzó a marcar el reloj: vino, lo
  // que falta es el dato de la salida. Ver el comentario en el cálculo.
  horas: number;
  // Lo que de verdad marcó el reloj, para poder mostrar el dato crudo al lado del computado.
  horasFichadas?: number;
  horasEsperadas: number | null; // según horas_lv/horas_sabado del empleado; null = sin horario configurado (no se puede comparar, salvo domingo)
  incompleto: boolean;
  tardanzaMin: number; // minutos de atraso reales (aunque no llegue al umbral de tardanza)
  esTardanza: boolean; // ya con el umbral de 15 min aplicado
  horasDeMas: number; // por encima de lo esperado ese día (o de 8hs si no hay horario configurado); solo cuenta si supera 1 hora, redondeado a entero
  horasDeMenos: number; // por debajo de lo esperado ese día; redondeado a entero
  // Día posterior al último con fichajes cargados: todavía no hay información, no es una
  // falta. Pasa siempre que se mira la quincena antes de que termine (o cuando se liquida
  // unos días antes para pagar). Sin esta distinción esos días descontaban horas Y hacían
  // perder el presentismo, que es lo caro.
  sinDatosAun: boolean;
}

// Ajustes manuales por empleado + quincena puntual (no son atributos permanentes del
// empleado, cambian mes a mes): si cumplió presentismo, un extra $ y horas extra.
export interface AjusteQuincena {
  presentismoManual?: 'SI' | 'NO' | '';
  extras?: number;
  horasExtras?: number;
  // Si las horas extra se pagan en este período. Por defecto NO.
  pagarExtras?: 'SI' | 'NO' | '';
  // ── Adelanto cargado a mano, sin gasto detrás ────────────────────────────────────
  //
  // Decisión de Marcos, tomada sabiendo lo que implica: los adelantos normales son gastos
  // (la plata salió de una caja y figura en el resultado). Éste no: es solo un descuento
  // del sueldo a pagar.
  //
  // Sirve para lo que se dio por fuera del circuito y no se quiere registrar como gasto.
  // El costo es que la caja no se entera, así que se muestra marcado y aparte del otro,
  // nunca mezclado en un solo número: un descuento que no se puede rastrear hasta un
  // movimiento tiene que verse como lo que es.
  adelantoManual?: number;
}

export interface ResumenEmpleado {
  workno: string;
  nombre: string;
  dias: DiaTrabajado[];
  horasReales: number;
  horasTeoricas: number;
  diferenciaHoras: number;
  horasDeMasTotal: number; // suma de excedentes diarios sobre lo esperado (informativo)
  horasDeMenosTotal: number; // suma de déficits diarios respecto a lo esperado (informativo)
  sueldoHora: number;
  presentismoConfigurado: number;
  presentismoAplicado: number;
  presentismoManual: 'SI' | 'NO' | ''; // '' = automático (según tardanzas)
  extras: number;
  horasExtras: number;         // las que se pagan (la manual si se cargó, si no la calculada)
  horasExtrasCalculadas: number; // horas trabajadas por encima de la teoría de los días CON datos
  horasExtrasManual: boolean;  // true = el número lo puso alguien a mano y pisa al calculado
  pagarExtras: boolean;        // si las horas extra de este período se liquidan
  sueldoTeorico: number;       // horas teóricas × sueldo/hora + presentismo
  sueldoExtras: number;        // extras $ + (horas extra × sueldo/hora, solo si se pagan)
  horasExtrasImporte: number;  // lo que valdrían las horas extra, se paguen o no
  adelantos: number;           // total descontado: los que son gasto + el cargado a mano
  adelantoGastos?: number;     // los que tienen un gasto detrás (la plata salió de una caja)
  adelantoManual?: number;     // el cargado a mano en esta pantalla, sin gasto detrás
  sueldoAPagar: number;        // teórico + extras, ANTES de descontar adelantos
  sueldoFinal: number;         // lo que queda por pagar: sueldoAPagar − adelantos
  diasSinDatos: number;
  tardanzas: number;
  diasIncompletos: number;
  faltas: number; // días programados sin fichaje de él Y con fichajes de otros: eso sí es falta suya
  diasCerrados?: number;      // días programados en los que no fichó nadie (feriado, campo cerrado)
  horasNoDebidas?: number;    // las horas teóricas de esos días, que no se le descuentan
  horasTeoricasAuto: boolean; // true = se calculó sola del calendario (horas_lv configurado), false = número manual
}

// Umbral por debajo del cual un ingreso NO cuenta como tardanza aunque llegue después
// del horario esperado — un fichaje pasadas las 11 de la mañana casi seguro es un día
// raro (franco, medio día, fin de semana) y no una llegada tarde real.
const LIMITE_ENTRADA_RARA_MIN = 11 * 60;
// Margen de tolerancia: hasta 15 minutos tarde no cuenta como tardanza.
const TOLERANCIA_TARDANZA_MIN = 15;
const HORAS_TURNO = 8;
const DOW_LABEL = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// Sueldo a pagar = horas TEÓRICAS × sueldo/hora, + presentismo (si corresponde: manual si
// se cargó, si no automático según tardanzas), + extras $ sueltos, + horas extra × sueldo/hora.
export function calcularResumenQuincena(
  registros: RegistroCrossChex[], empleados: Empleado[], anio: number, mes: number, quincena: PeriodoPago,
  ajustes: Record<string, AjusteQuincena> = {}, // key: workno
  adelantosPorWorkno: Record<string, number> = {},
): ResumenEmpleado[] {
  const { diasDesde, diasHasta } = rangoQuincena(anio, mes, quincena);
  const porEmpleadoDia = agruparPorEmpleadoYDia(registros);
  const empleadosPorWorkno = new Map(empleados.map((e) => [String(e.workno), e]));
  const nombresCrossChex = new Map<string, string>();
  for (const r of registros) {
    const wn = String(r.employee?.workno || '');
    if (!wn || nombresCrossChex.has(wn)) continue;
    nombresCrossChex.set(wn, `${r.employee.first_name || ''} ${r.employee.last_name || ''}`.trim());
  }

  // Último día de la quincena con ALGÚN fichaje cargado, de cualquier empleado. Los días
  // posteriores a ese todavía no tienen información: no son faltas ni horas perdidas.
  // Se mira el global y no el del empleado a propósito — si ese día vino gente y él no,
  // sí es una falta de él.
  let ultimoDiaConDatos = '';
  for (const porDia of porEmpleadoDia.values()) {
    for (const fecha of porDia.keys()) if (fecha > ultimoDiaConDatos) ultimoDiaConDatos = fecha;
  }

  // ── Los días en que fichó alguien ──────────────────────────────────────────────────
  //
  // Un día programado sin fichajes no siempre es una falta. Si no vino NADIE, lo normal es
  // que no se haya trabajado: un feriado, un paro, el campo cerrado. Contarlo como falta de
  // cada empleado hacía que todos perdieran el presentismo todos los meses — que es
  // exactamente lo que se veía en pantalla: cinco empleados, cinco “presentismo perdido”.
  //
  // Falta es cuando el resto trabajó y él no. Eso sí es de él.
  const diasConAlgunFichaje = new Set<string>();
  for (const porDia of porEmpleadoDia.values()) {
    for (const fecha of porDia.keys()) diasConAlgunFichaje.add(fecha);
  }

  const todosWorknos = new Set<string>([...porEmpleadoDia.keys(), ...empleados.map((e) => String(e.workno))]);
  const resultados: ResumenEmpleado[] = [];
  for (const workno of todosWorknos) {
    const emp = empleadosPorWorkno.get(workno);
    if (emp && emp.activo !== 'SI') continue;
    const porDia = porEmpleadoDia.get(workno) || new Map<string, string[]>();
    const horasSabEmp = Number(emp?.horas_sabado) || 0;
    const horasLVEmp = Number(emp?.horas_lv) || 0;
    const esAuto = horasLVEmp > 0;
    const dias: DiaTrabajado[] = [];
    let faltas = 0;
    // Los días programados en los que no fichó nadie (feriado, paro, campo cerrado) y los
    // que sí fueron falta de él. Se separan porque pesan distinto: los primeros no se le
    // descuentan, los segundos sí.
    const diasCerrados: string[] = [];
    const diasFalta: string[] = [];
    for (let d = diasDesde; d <= diasHasta; d++) {
      const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(anio, mes - 1, d).getDay(); // 0=domingo..6=sábado
      const diaSemana = DOW_LABEL[dow];
      const esDomingo = dow === 0;
      // Horas esperadas ese día: domingo nunca está programado (0), aunque no haya
      // horario configurado; lunes-a-viernes/sábado solo se conocen si el empleado
      // tiene horas_lv cargado — si no, queda null (no se puede comparar ese día).
      const horasEsperadas = esDomingo ? 0 : esAuto ? (dow >= 1 && dow <= 5 ? horasLVEmp : horasSabEmp) : null;
      const checks = (porDia.get(fecha) || []).map((iso) => partesArg(iso).horaMin).sort((a, b) => a - b);
      const diaProgramado = (dow >= 1 && dow <= 5) || (dow === 6 && horasSabEmp > 0);
      // Todavía no hay datos de este día (se está mirando la quincena antes de que termine,
      // o se liquida unos días antes para pagar): no es falta ni horas de menos. Se deja
      // anotado para poder mostrarlo distinto y para no contarlo al comparar horas.
      if (!checks.length && ultimoDiaConDatos && fecha > ultimoDiaConDatos) {
        if (diaProgramado) {
          dias.push({
            fecha, diaSemana, esDomingo, entrada: null, salida: null, horas: 0,
            horasEsperadas, incompleto: false, tardanzaMin: 0, esTardanza: false,
            horasDeMas: 0, horasDeMenos: 0, sinDatosAun: true,
          });
        }
        continue;
      }
      if (!checks.length) {
        // Falta = día programado sin ningún fichaje de ÉL, Y con fichajes de alguien más.
        // Si no fichó nadie ese día no se trabajó, y no es falta de nadie: se trata como
        // día no programado, igual que un domingo. Sin esto, cada feriado era una falta
        // para todo el plantel y el presentismo se perdía siempre.
        if (diaProgramado && diasConAlgunFichaje.has(fecha)) {
          faltas++;
          diasFalta.push(fecha);
        } else if (diaProgramado) {
          // Se anota para no contarlo al comparar horas: si nadie trabajó, esas horas
          // teóricas no se debían.
          diasCerrados.push(fecha);
        }
        continue;
      }
      const { horas, entrada: entradaMin, salidaFinal: salidaMin, incompleto } = sumarHorasPares(checks);
      // Los sábados se entra más tarde que de lunes a viernes, así que la hora esperada
      // de ese día es propia (hora_entrada_esperada_sabado). Si está vacía se usa la de
      // lunes a viernes, que es como venía funcionando hasta ahora — sin ese campo
      // cargado, los sábados marcaban tardanza a todo el mundo.
      const horaEsperadaDia = (dow === 6 && emp?.hora_entrada_esperada_sabado)
        ? emp.hora_entrada_esperada_sabado
        : emp?.hora_entrada_esperada;
      const esperadaMin = horaEsperadaDia ? minDeHora(horaEsperadaDia) : null;
      const tardanzaMin = esperadaMin !== null && entradaMin <= LIMITE_ENTRADA_RARA_MIN ? Math.max(0, entradaMin - esperadaMin) : 0;
      // De más/de menos: contra lo esperado ese día (o contra un turno de 8hs si no hay
      // horario configurado, salvo domingo que siempre compara contra 0). "De más" solo
      // cuenta si supera 1 hora entera; ambos se redondean a horas enteras (los minutos
      // de tardanza NO se redondean, quedan como están). Si el día quedó incompleto (sin
      // salida) no se puede saber cuánto trabajó de verdad, así que no se marca "de menos"
      // — sería un falso "le faltaron N horas" cuando en realidad falta el dato, no el trabajo.
      const baseEsperada = horasEsperadas !== null ? horasEsperadas : HORAS_TURNO;
      // ── Un día incompleto se paga como un día normal ──────────────────────────────
      //
      // Incompleto = fichó la entrada y no la salida (se olvidó, el reloj no lo tomó).
      // Antes se sumaban las horas que el par incompleto dejaba, casi siempre pocas o cero,
      // y el empleado aparecía con 80 horas de menos en el mes. No es que no trabajó: es
      // que falta el dato de la salida.
      //
      // Como vino —hay fichaje de entrada— se le computan las horas esperadas de ese día.
      // Es la hipótesis correcta por defecto: lo que hay que probar es la ausencia, y de la
      // ausencia ya se ocupa el conteo de faltas de arriba.
      const horasComputadas = incompleto ? baseEsperada : horas;
      const masCruda = incompleto ? 0 : Math.max(0, horas - baseEsperada);
      const menosCruda = incompleto ? 0 : Math.max(0, baseEsperada - horas);
      dias.push({
        fecha, diaSemana, esDomingo,
        entrada: fmtHoraMin(entradaMin), salida: salidaMin !== null ? fmtHoraMin(salidaMin) : null,
        horas: Math.round(horasComputadas * 100) / 100, horasEsperadas, incompleto, tardanzaMin,
        esTardanza: tardanzaMin > TOLERANCIA_TARDANZA_MIN,
        horasDeMas: masCruda > 1 ? Math.round(masCruda) : 0,
        horasDeMenos: Math.round(menosCruda),
        sinDatosAun: false,
        // Lo que de verdad marcó el reloj, para poder mostrarlo al abrir el día. `horas` ya
        // es lo que se computa (ver arriba); sin esto no habría cómo ver el dato crudo y
        // la corrección sería invisible.
        horasFichadas: Math.round(horas * 100) / 100,
      });
    }
    const horasReales = Math.round(dias.reduce((a, d) => a + d.horas, 0) * 100) / 100;
    // ── El número manual es POR QUINCENA, aunque ahora se liquide por mes ──────────────
    //
    // `horas_teoricas_quincena` se cargó cuando se pagaba cada quince días: los 46 de
    // default, y los valores que hay guardados, son medio mes. Usarlos tal cual para un
    // período mensual paga la mitad del sueldo, y es un error que no se nota —el número sale
    // plausible, solo que chico—.
    //
    // Se escala por dos cuando el período es el mes entero, en vez de reinterpretar el campo:
    // reinterpretarlo cambiaría en silencio lo que significan los valores ya cargados, y
    // volver a mirar un mes viejo liquidado por quincena daría otro número del que se pagó.
    //
    // Al empleado con "horas por día" configuradas no le afecta: a ese se le calculan solas
    // del calendario real del período, que ya sale bien para un mes.
    const horasManualPeriodo = (Number(emp?.horas_teoricas_quincena) || 46) * (quincena === 0 ? 2 : 1);
    const horasTeoricas = esAuto
      ? horasTeoricasAuto(anio, mes, diasDesde, diasHasta, horasLVEmp, horasSabEmp)
      : horasManualPeriodo;
    const sueldoHora = Number(emp?.sueldo_hora) || 0;
    const tardanzas = dias.filter((d) => d.esTardanza).length;
    const presentismoConfigurado = Number(emp?.presentismo) || 0;
    const ajuste = ajustes[workno] || {};
    const presentismoManual = ajuste.presentismoManual || '';
    // El presentismo se pierde por tener alguna falta, o por acumular 2 o más tardanzas
    // en la quincena (1 tardanza sola no lo hace perder).
    const cumplioPresentismo = presentismoManual === 'SI' ? true : presentismoManual === 'NO' ? false : (tardanzas < 2 && faltas === 0);
    const presentismoAplicado = cumplioPresentismo ? presentismoConfigurado : 0;
    const extras = Number(ajuste.extras) || 0;

    // Horas extra: las que se trabajaron POR ENCIMA de la teoría. Se comparan solo contra
    // los días que ya tienen datos — si no, los días de la quincena que todavía no se
    // cargaron aparecerían como si el empleado hubiera trabajado de menos y se comerían
    // las extras reales.
    // Los días en que no fichó nadie no se debían: no entran ni como horas teóricas ni
    // como horas de menos. Igual que los que todavía no tienen datos.
    const horasCerradas = esAuto
      ? diasCerrados.reduce((a, f) => {
          const dow = new Date(f + 'T12:00:00').getDay();
          return a + (dow === 0 ? 0 : dow === 6 ? horasSabEmp : horasLVEmp);
        }, 0)
      : 0;
    const horasTeoricasCubiertas = esAuto
      ? dias.filter((d) => !d.sinDatosAun).reduce((a, d) => a + (d.horasEsperadas ?? 0), 0)
      : horasTeoricas;
    const horasExtrasCalculadas = Math.max(0, Math.round(horasReales - horasTeoricasCubiertas));
    // El número manual PISA al calculado (no se suman): si alguien se tomó el trabajo de
    // escribirlo, es porque sabe algo que la cuenta no.
    const horasExtrasManual = Number(ajuste.horasExtras) > 0;
    const horasExtras = horasExtrasManual ? Number(ajuste.horasExtras) : horasExtrasCalculadas;

    // Las horas extra NO se pagan salvo que alguien lo diga para ese período. Antes entraban
    // solas al sueldo, así que una semana con mucho movimiento se liquidaba sin que nadie lo
    // hubiera decidido. Se siguen calculando y mostrando: la información está, lo que cambió
    // es que pagarlas es una decisión.
    const pagarExtras = ajuste.pagarExtras === 'SI';
    const horasExtrasImporte = Math.round(horasExtras * sueldoHora * 100) / 100;
    const importeExtrasPagado = pagarExtras ? horasExtrasImporte : 0;
    const adelantos = Math.round((Number(adelantosPorWorkno[workno]) || 0) * 100) / 100;
    // El adelanto cargado a mano, que no tiene gasto detrás. Se suma al descuento pero se
    // lleva aparte en el resultado para poder mostrarlos separados (ver AjusteQuincena).
    const adelantoManual = Math.round((Number(ajuste.adelantoManual) || 0) * 100) / 100;
    const adelantoTotal = Math.round((adelantos + adelantoManual) * 100) / 100;
    const sueldoAPagar = Math.round((horasTeoricas * sueldoHora + presentismoAplicado + extras + importeExtrasPagado) * 100) / 100;
    resultados.push({
      workno, nombre: emp?.nombre || nombresCrossChex.get(workno) || workno,
      dias, horasReales, horasTeoricas,
      diferenciaHoras: Math.round((horasReales - horasTeoricas) * 100) / 100,
      horasDeMasTotal: dias.reduce((a, d) => a + d.horasDeMas, 0),
      horasDeMenosTotal: dias.reduce((a, d) => a + d.horasDeMenos, 0),
      sueldoHora, presentismoConfigurado, presentismoAplicado, presentismoManual,
      extras, horasExtras, horasExtrasCalculadas, horasExtrasManual,
      // El sueldo se muestra partido: lo teórico (lo que cobra por su horario) y lo extra
      // (lo que se suma por encima). Antes era un solo número y no se veía de dónde salía.
      pagarExtras,
      sueldoTeorico: Math.round((horasTeoricas * sueldoHora + presentismoAplicado) * 100) / 100,
      sueldoExtras: Math.round((extras + importeExtrasPagado) * 100) / 100,
      horasExtrasImporte,
      adelantos: adelantoTotal,
      sueldoAPagar,
      // Lo que falta pagar. Un adelanto ya salió de la caja: volver a pagarlo entero a fin
      // de mes es pagar dos veces.
      sueldoFinal: Math.round((sueldoAPagar - adelantoTotal) * 100) / 100,
      diasSinDatos: dias.filter((d) => d.sinDatosAun).length,
      tardanzas,
      diasIncompletos: dias.filter((d) => d.incompleto).length,
      faltas,
      // Los días programados en los que no fichó NADIE. No son faltas de él y no se le
      // descuentan, pero tienen que poder verse: si son muchos, o el reloj dejó de
      // sincronizar o hubo feriados, y las dos cosas cambian cómo se lee el mes.
      diasCerrados: diasCerrados.length,
      horasNoDebidas: Math.round(horasCerradas * 100) / 100,
      adelantoManual,
      adelantoGastos: adelantos,
      horasTeoricasAuto: esAuto,
    });
  }
  return resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Para el aviso del home: tardanzas puntuales DEL DÍA de hoy (no de toda la quincena).
export function tardanzasDeHoy(resumen: ResumenEmpleado[]): { nombre: string; hora: string }[] {
  const hoy = hoyArg();
  const out: { nombre: string; hora: string }[] = [];
  for (const r of resumen) {
    const dia = r.dias.find((d) => d.fecha === hoy && d.esTardanza);
    if (dia) out.push({ nombre: r.nombre, hora: dia.entrada || '' });
  }
  return out;
}

// ── El recibo que se manda por WhatsApp ──────────────────────────────────────────────
//
// Hasta acá el detalle de un sueldo existía solo en esta pantalla, que ve una sola
// persona. El empleado recibía un número y nada más, y cada diferencia respecto de lo que
// esperaba —un adelanto que no recordaba, unas horas de menos, el presentismo que no
// entró— se resolvía discutiendo de memoria.
//
// Esto arma el mismo detalle en texto plano. No calcula NADA: todos los números salen del
// resumen que ya se mostró en pantalla, así que el mensaje y la fila no pueden decir cosas
// distintas. Si algo está mal, está mal en los dos lados y se corrige en un solo lugar.
//
// Se escribe en el lenguaje del que lo recibe, no en el nuestro: "horas trabajadas" y no
// "horas teóricas", "te descontamos" y no "adelantos". Un recibo que hay que traducir no
// sirve para lo que se hizo.
export function reciboWhatsApp(r: ResumenEmpleado, periodo: string): string {
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const hs = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
  const L: string[] = [];

  L.push(`*${r.nombre}* — ${periodo}`);
  L.push('');
  L.push(`Horas: ${hs(r.horasTeoricas)} hs x ${$(r.sueldoHora)} = ${$(r.horasTeoricas * r.sueldoHora)}`);
  if (r.presentismoAplicado > 0) L.push(`Presentismo: ${$(r.presentismoAplicado)}`);
  // Decir por qué NO está es más útil que omitirlo: es la diferencia que el otro va a notar.
  else if (r.presentismoConfigurado > 0) L.push(`Presentismo: no corresponde este mes`);
  if (r.pagarExtras && r.horasExtras > 0) L.push(`Horas extra: ${hs(r.horasExtras)} hs = ${$(r.horasExtrasImporte)}`);
  if (r.extras > 0) L.push(`Otros: ${$(r.extras)}`);

  L.push(`Subtotal: ${$(r.sueldoAPagar)}`);
  if (r.adelantos > 0) L.push(`Adelantos ya cobrados: -${$(r.adelantos)}`);
  L.push('');
  L.push(`*A cobrar: ${$(r.sueldoFinal)}*`);

  // Lo que explica el número sin estar en la suma. Va al final y solo si existe: un recibo
  // que dice "0 tardanzas" todos los meses deja de leerse.
  const notas: string[] = [];
  if (r.tardanzas > 0) notas.push(`${r.tardanzas} ${r.tardanzas === 1 ? 'llegada tarde' : 'llegadas tarde'}`);
  if (r.faltas > 0) notas.push(`${r.faltas} ${r.faltas === 1 ? 'falta' : 'faltas'}`);
  if (r.pagarExtras === false && r.horasExtras > 0) notas.push(`${hs(r.horasExtras)} hs extra registradas, no se liquidan este mes`);
  if (notas.length) { L.push(''); L.push(notas.join(' · ')); }

  return L.join('\n');
}

// ── El resumen de todo lo que hay que pagar ──────────────────────────────────────────
//
// El recibo individual explica un sueldo; esto responde otra pregunta, la del que paga:
// cuánto sale la quincena y cuánto le toca a cada uno. Son dos mensajes distintos y
// mandarle a Marce seis recibos no es lo mismo que mandarle la lista.
//
// Igual que el recibo, no calcula nada propio: los números son los de la pantalla.
export function resumenSueldosWhatsApp(resumenes: ResumenEmpleado[], periodo: string): string {
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  // Los que no tienen nada que cobrar no entran: un empleado sin configurar aparece en la
  // pantalla en $0 porque falta su $/hora, y en una lista de pagos eso se lee como "a
  // éste no le debemos nada", que es lo contrario de lo que pasa.
  const pagar = resumenes.filter(r => r.sueldoFinal > 0).sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (!pagar.length) return `No hay sueldos para pagar en ${periodo}.`;

  const L: string[] = [`*Sueldos a pagar — ${periodo}*`, ''];
  for (const r of pagar) {
    // El adelanto se nombra en la misma línea: es la diferencia entre lo que el empleado
    // cree que cobra y lo que se le entrega, y es la pregunta que vuelve siempre.
    L.push(`${r.nombre}: *${$(r.sueldoFinal)}*${r.adelantos > 0 ? `  (ya cobró ${$(r.adelantos)} de adelanto)` : ''}`);
  }
  L.push('');
  L.push(`*Total: ${$(pagar.reduce((a, r) => a + r.sueldoFinal, 0))}*`);

  // Los que quedaron afuera, dichos. Una lista de pagos a la que le falta alguien en
  // silencio es la peor forma de enterarse de que faltaba configurarlo.
  const afuera = resumenes.filter(r => r.sueldoFinal <= 0);
  if (afuera.length) {
    L.push('');
    L.push(`No incluidos (sin sueldo calculado): ${afuera.map(r => r.nombre).join(', ')}`);
  }
  return L.join('\n');
}
