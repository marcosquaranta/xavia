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
