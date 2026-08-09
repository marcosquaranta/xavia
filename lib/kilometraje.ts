import type { KilometrajeVehiculo } from './types';

// Único vehículo por ahora — queda como constante (y el campo "vehiculo" en la hoja) para
// no tener que migrar nada el día que se sume otro.
export const VEHICULO_PARTNER = 'Partner';

function num(v: any) { const n = Number(v); return isNaN(n) ? 0 : n; }
const fmtISO = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Sábado más reciente (hoy incluido si hoy es sábado) — punto de referencia de "esta
// semana" para el recordatorio: se pide el kilometraje los sábados, y como no hay que
// sacarlo hasta que se cargue, sigue apuntando al mismo sábado (o al que venga después,
// si pasan varias semanas sin cargarlo) hasta que haya una lectura posterior.
function sabadoDeReferencia(hoy: Date): Date {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dow = d.getDay(); // 0=domingo..6=sábado
  const diff = (dow - 6 + 7) % 7; // días desde el último sábado (0 si hoy es sábado)
  d.setDate(d.getDate() - diff);
  return d;
}

// True si todavía no se cargó ninguna lectura desde el último sábado — el recordatorio en
// el Panel se muestra mientras esto sea true, cualquier día de la semana, no solo sábados.
export function faltaCargarEstaSemana(registros: KilometrajeVehiculo[], vehiculo: string, hoy: Date = new Date()): boolean {
  const sabStr = fmtISO(sabadoDeReferencia(hoy));
  return !registros.some((r) => r.vehiculo === vehiculo && String(r.fecha || '').slice(0, 10) >= sabStr);
}

// Última lectura conocida (para mostrar de referencia en el formulario y validar que la
// nueva no sea menor — el odómetro no puede retroceder).
export function ultimaLectura(registros: KilometrajeVehiculo[], vehiculo: string): KilometrajeVehiculo | null {
  const propias = registros.filter((r) => r.vehiculo === vehiculo && String(r.fecha || ''));
  if (!propias.length) return null;
  return [...propias].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))[propias.length - 1];
}

export interface PuntoKmSemana {
  fecha: string;   // YYYY-MM-DD de la lectura
  label: string;   // dd/mm para el eje del gráfico
  kmAcumulado: number;
  kmSemana: number | null; // diferencia vs. la lectura anterior — null en la primera lectura de la serie
}

// Km recorridos "por semana" = diferencia entre lecturas de odómetro consecutivas — no se
// fuerza a semanas calendario porque la carga es manual y puede saltearse alguna semana;
// mostrar la diferencia real entre lecturas (con su fecha) es más honesto que inventar un
// promedio por semanas vacías. Devuelve las últimas `ultimasN` lecturas.
export function kmPorSemana(registros: KilometrajeVehiculo[], vehiculo: string, ultimasN = 12): PuntoKmSemana[] {
  const ordenados = registros
    .filter((r) => r.vehiculo === vehiculo)
    .map((r) => ({ fecha: String(r.fecha || '').slice(0, 10), km: num(r.km_acumulado) }))
    .filter((r) => r.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const puntos: PuntoKmSemana[] = ordenados.map((r, i) => {
    const [y, m, d] = r.fecha.split('-');
    return {
      fecha: r.fecha, label: `${d}/${m}`, kmAcumulado: r.km,
      kmSemana: i === 0 ? null : Math.max(0, r.km - ordenados[i - 1].km),
    };
  });
  return puntos.slice(-ultimasN);
}
