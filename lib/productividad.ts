import type { Lote } from './types';
import type { RegistroCrossChex } from './crosschex';
import { horasHombreEnRango, fechaArg } from './personal';

export interface PuntoProductividadSemana {
  semanaLabel: string;
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  paquetes: number;
  horas: number;
  productividad: number | null; // paq/hora-hombre, null si no hay horas registradas esa semana
}

function lunesDeSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISO = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Productividad (paquetes cosechados ÷ horas-hombre reales) por semana calendario (lunes
// a domingo), últimas N semanas incluyendo la actual (parcial, etiquetada "Esta sem.") —
// mismo criterio que ciclosPorSemana en lib/estadisticas.ts, para que el resto de
// gráficos "por semana" de la app se lean con la misma cadencia. `registros` deben
// cubrir todo el rango (un solo fetch a CrossChex desde afuera, no uno por semana).
export function productividadPorSemana(lotes: Lote[], registros: RegistroCrossChex[], nSemanas = 12): PuntoProductividadSemana[] {
  const hoy = new Date();
  const lunesActual = lunesDeSemana(hoy);
  const puntos: PuntoProductividadSemana[] = [];

  for (let i = nSemanas - 1; i >= 0; i--) {
    const inicio = new Date(lunesActual); inicio.setDate(inicio.getDate() - i * 7);
    const fin = new Date(inicio); fin.setDate(fin.getDate() + 6);
    const inicioStr = fmtISO(inicio), finStr = fmtISO(fin);

    let paquetes = 0;
    for (const l of lotes) {
      if (l.estado !== 'cosechado') continue;
      const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
      if (!f || f < inicioStr || f > finStr) continue;
      paquetes += Number(l.unidades_cosechadas) || 0;
    }

    const registrosSemana = registros.filter((r) => {
      const f = fechaArg(r.checktime);
      return f >= inicioStr && f <= finStr;
    });
    const horas = horasHombreEnRango(registrosSemana);

    puntos.push({
      semanaLabel: i === 0 ? 'Esta sem.' : `S-${i}`,
      desde: inicioStr, hasta: finStr, paquetes, horas,
      productividad: horas > 0 ? Math.round((paquetes / horas) * 100) / 100 : null,
    });
  }
  return puntos;
}

export interface PuntoProductividadMes {
  mes: string;   // YYYY-MM
  label: string; // "Ago 26"
  paquetes: number;
  horas: number;
  productividad: number | null;
}

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Productividad de UN mes puntual — separado en su propia función porque el fetch a
// CrossChex de acá afuera se hace mes a mes (ver comentario en productividadPorMeses):
// pedirle a CrossChex un rango ancho de varias semanas/meses de una sola vez no
// devolvía datos completos; en cambio los indicadores que piden de a un mes (~30 días)
// siempre funcionaron bien, así que esa es la granularidad de fetch que hay que respetar.
export function productividadDeMes(lotes: Lote[], registros: RegistroCrossChex[], anio: number, mes: number, diaHasta?: number): PuntoProductividadMes {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = diaHasta ? Math.min(diaHasta, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  let paquetes = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || f < desdeStr || f > hastaStr) continue;
    paquetes += Number(l.unidades_cosechadas) || 0;
  }
  const horas = horasHombreEnRango(registros);
  return {
    mes: `${anio}-${pad(mes)}`, label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    paquetes, horas, productividad: horas > 0 ? Math.round((paquetes / horas) * 100) / 100 : null,
  };
}
