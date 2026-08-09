// Temperatura de Rosario — API pública de Open-Meteo (sin API key), para correlacionar
// clima con los ciclos de cultivo por mes en Estadísticas. Si el servicio falla, quien
// llame debe capturarlo (no hay fallback local de clima).
const LAT_ROSARIO = -32.9468;
const LON_ROSARIO = -60.6393;

export interface TemperaturaDia { fecha: string; tempMedia: number }

export async function obtenerTemperaturasRosario(desde: string, hasta: string): Promise<TemperaturaDia[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT_ROSARIO}&longitude=${LON_ROSARIO}&start_date=${desde}&end_date=${hasta}&daily=temperature_2m_mean&timezone=America%2FArgentina%2FBuenos_Aires`;
  // revalidate 12h — el clima histórico no cambia dentro del día, no hace falta pedirlo
  // en cada visita a la página.
  const res = await fetch(url, { next: { revalidate: 43200 } });
  if (!res.ok) throw new Error('No se pudo obtener la temperatura de Rosario');
  const json = await res.json();
  const fechas: string[] = json?.daily?.time || [];
  const temps: number[] = json?.daily?.temperature_2m_mean || [];
  return fechas.map((fecha, i) => ({ fecha, tempMedia: temps[i] })).filter(d => d.tempMedia !== null && d.tempMedia !== undefined);
}

// Promedio mensual (clave "YYYY-MM") a partir de una serie diaria.
export function temperaturaPromedioPorMes(dias: TemperaturaDia[]): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const d of dias) {
    const mk = d.fecha.slice(0, 7);
    if (!acc.has(mk)) acc.set(mk, []);
    acc.get(mk)!.push(d.tempMedia);
  }
  const out = new Map<string, number>();
  for (const [mk, vals] of acc) out.set(mk, Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10);
  return out;
}
