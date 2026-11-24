import type { Empleado } from './types';
import type { RegistroCrossChex } from './crosschex';
import { calcularResumenQuincena, type DiaTrabajado, type PeriodoPago } from './personal';

// ── El detalle de fichajes de un rango cualquiera ───────────────────────────────────
//
// La pantalla de Personal mira SIEMPRE una quincena: es la unidad con la que se liquida.
// Pero las preguntas no vienen en quincenas — "cuántas horas se hicieron ayer", "cuánto
// nos costó la semana del feriado" — y hasta ahora eso no se podía contestar sin abrir la
// pantalla y leer a ojo.
//
// Lo importante acá es lo que NO se hace: no se recalcula nada. Las horas de un día, la
// tardanza, el día incompleto y las horas de más salen de `calcularResumenQuincena`, la
// misma función que liquida los sueldos. Se corren las quincenas que toca el rango y se
// recortan los días pedidos.
//
// Si acá se hiciera la cuenta de nuevo —"horas = salida menos entrada"— el chat y la
// liquidación darían números distintos sobre el mismo día, y el de la liquidación es el
// que se paga. Un día incompleto, por ejemplo, computa las horas ESPERADAS y no las que
// alcanzó a marcar el reloj; eso es una decisión que ya está tomada en un solo lugar.

export interface DiaDeEmpleado extends DiaTrabajado {
  workno: string;
  nombre: string;
}

export interface FichajesDeEmpleado {
  workno: string;
  nombre: string;
  sueldo_hora: number;
  dias: DiaTrabajado[];
  horas: number;
  horas_fichadas: number;
  dias_con_fichaje: number;
  dias_incompletos: number;
}

// Las quincenas que toca un rango. Casi siempre una o dos; el loop está por si alguien
// pregunta por un trimestre.
export function quincenasEnRango(desde: string, hasta: string): { anio: number; mes: number; quincena: PeriodoPago }[] {
  const out: { anio: number; mes: number; quincena: PeriodoPago }[] = [];
  const d = new Date(`${desde}T12:00:00Z`), h = new Date(`${hasta}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(h.getTime()) || d > h) return out;
  let anio = d.getUTCFullYear(), mes = d.getUTCMonth() + 1;
  const finAnio = h.getUTCFullYear(), finMes = h.getUTCMonth() + 1;
  // Tope por las dudas: un rango mal armado no puede dejar esto girando.
  for (let i = 0; i < 48; i++) {
    out.push({ anio, mes, quincena: 1 }, { anio, mes, quincena: 2 });
    if (anio === finAnio && mes === finMes) break;
    mes++;
    if (mes > 12) { mes = 1; anio++; }
  }
  return out;
}

export function fichajesEnRango(
  registros: RegistroCrossChex[],
  empleados: Empleado[],
  desde: string,
  hasta: string,
): FichajesDeEmpleado[] {
  const porWorkno = new Map<string, FichajesDeEmpleado>();
  const vistos = new Set<string>(); // workno__fecha, por si dos quincenas se pisaran

  for (const { anio, mes, quincena } of quincenasEnRango(desde, hasta)) {
    for (const e of calcularResumenQuincena(registros, empleados, anio, mes, quincena)) {
      let acc = porWorkno.get(e.workno);
      if (!acc) {
        acc = {
          workno: e.workno, nombre: e.nombre, sueldo_hora: e.sueldoHora,
          dias: [], horas: 0, horas_fichadas: 0, dias_con_fichaje: 0, dias_incompletos: 0,
        };
        porWorkno.set(e.workno, acc);
      }
      for (const d of e.dias) {
        if (d.fecha < desde || d.fecha > hasta) continue;
        const k = `${e.workno}__${d.fecha}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        acc.dias.push(d);
      }
    }
  }

  for (const acc of porWorkno.values()) {
    acc.dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const d of acc.dias) {
      // Un día sin fichaje no es un día de cero horas: es un día sin dato. Se cuenta
      // aparte para que el total diga de cuántos días sale.
      if (!d.entrada && !d.salida) continue;
      acc.dias_con_fichaje++;
      acc.horas += Number(d.horas) || 0;
      acc.horas_fichadas += Number(d.horasFichadas ?? d.horas) || 0;
      if (d.incompleto) acc.dias_incompletos++;
    }
    acc.horas = Math.round(acc.horas * 100) / 100;
    acc.horas_fichadas = Math.round(acc.horas_fichadas * 100) / 100;
  }

  return [...porWorkno.values()]
    .filter((a) => a.dias.length > 0)
    .sort((a, b) => b.horas - a.horas);
}
