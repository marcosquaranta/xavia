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
function fmtHoraMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function minDeHora(hhmm: string): number {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

// Quincena 1: días 1-15. Quincena 2: 16 al último día del mes. begin_time/end_time con
// offset -03:00 explícito (Argentina no tiene horario de verano) para que CrossChex
// devuelva exactamente el rango del día en hora local, sin importar la zona del server.
export function rangoQuincena(anio: number, mes: number, quincena: 1 | 2): { desde: string; hasta: string; diasDesde: number; diasHasta: number } {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const diasDesde = quincena === 1 ? 1 : 16;
  const diasHasta = quincena === 1 ? 15 : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    desde: `${anio}-${pad(mes)}-${pad(diasDesde)}T00:00:00-03:00`,
    hasta: `${anio}-${pad(mes)}-${pad(diasHasta)}T23:59:59-03:00`,
    diasDesde, diasHasta,
  };
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

export interface DiaTrabajado {
  fecha: string;
  entrada: string | null;
  salida: string | null;
  horas: number;
  incompleto: boolean;
  tardanzaMin: number;
}

export interface ResumenEmpleado {
  workno: string;
  nombre: string;
  dias: DiaTrabajado[];
  horasReales: number;
  horasTeoricas: number;
  diferenciaHoras: number;
  sueldoHora: number;
  presentismoConfigurado: number;
  presentismoAplicado: number; // 0 si hubo alguna tardanza en la quincena
  sueldoAPagar: number;
  tardanzas: number;
  diasIncompletos: number;
}

// Umbral por debajo del cual un ingreso NO cuenta como tardanza aunque llegue después
// del horario esperado — un fichaje pasadas las 11 de la mañana casi seguro es un día
// raro (franco, medio día, fin de semana) y no una llegada tarde real.
const LIMITE_TARDANZA_MIN = 11 * 60;

// Sueldo a pagar = horas TEÓRICAS (fijas, editables por empleado) × sueldo/hora, más el
// presentismo (monto fijo) SOLO si no hubo ninguna tardanza en la quincena — no las horas
// reales (decisión explícita del usuario).
export function calcularResumenQuincena(
  registros: RegistroCrossChex[], empleados: Empleado[], anio: number, mes: number, quincena: 1 | 2
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

  const todosWorknos = new Set<string>([...porEmpleadoDia.keys(), ...empleados.map((e) => String(e.workno))]);
  const resultados: ResumenEmpleado[] = [];
  for (const workno of todosWorknos) {
    const emp = empleadosPorWorkno.get(workno);
    if (emp && emp.activo !== 'SI') continue;
    const porDia = porEmpleadoDia.get(workno) || new Map<string, string[]>();
    const dias: DiaTrabajado[] = [];
    for (let d = diasDesde; d <= diasHasta; d++) {
      const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const checks = (porDia.get(fecha) || []).map((iso) => partesArg(iso).horaMin).sort((a, b) => a - b);
      if (!checks.length) continue;
      const entradaMin = checks[0];
      const salidaMin = checks.length > 1 ? checks[checks.length - 1] : null;
      const incompleto = salidaMin === null;
      const horas = incompleto ? 0 : Math.max(0, (salidaMin - entradaMin) / 60);
      const esperadaMin = emp?.hora_entrada_esperada ? minDeHora(emp.hora_entrada_esperada) : null;
      const tardanzaMin = esperadaMin !== null && entradaMin <= LIMITE_TARDANZA_MIN ? Math.max(0, entradaMin - esperadaMin) : 0;
      dias.push({
        fecha, entrada: fmtHoraMin(entradaMin), salida: salidaMin !== null ? fmtHoraMin(salidaMin) : null,
        horas: Math.round(horas * 100) / 100, incompleto, tardanzaMin,
      });
    }
    const horasReales = Math.round(dias.reduce((a, d) => a + d.horas, 0) * 100) / 100;
    const horasTeoricas = Number(emp?.horas_teoricas_quincena) || 46;
    const sueldoHora = Number(emp?.sueldo_hora) || 0;
    const tardanzas = dias.filter((d) => d.tardanzaMin > 0).length;
    const presentismoConfigurado = Number(emp?.presentismo) || 0;
    const presentismoAplicado = tardanzas === 0 ? presentismoConfigurado : 0;
    resultados.push({
      workno, nombre: emp?.nombre || nombresCrossChex.get(workno) || workno,
      dias, horasReales, horasTeoricas,
      diferenciaHoras: Math.round((horasReales - horasTeoricas) * 100) / 100,
      sueldoHora, presentismoConfigurado, presentismoAplicado,
      sueldoAPagar: Math.round((horasTeoricas * sueldoHora + presentismoAplicado) * 100) / 100,
      tardanzas,
      diasIncompletos: dias.filter((d) => d.incompleto).length,
    });
  }
  return resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));
}
