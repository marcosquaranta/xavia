// Ventana de antigüedad de los recordatorios de cobro. Vive en su propio archivo, sin
// imports, porque lo necesitan los dos lados: el motor (server, que lee Google Sheets) y
// el formulario de configuración (cliente). Importarlo desde recordatoriosCobro.ts en un
// componente 'use client' arrastraba googleapis al bundle del navegador y rompía el build.

// La corrida es SEMANAL, así que la antigüedad de una factura en cada corrida avanza de 7
// en 7. Para que ninguna se escape, la ventana tiene que cubrir 7 días consecutivos: con
// `hasta - desde >= 6` hay siempre al menos un lunes adentro (verificado simulando 20
// semanas de corridas contra una factura por día: con diferencia 6 entran las 60, con
// diferencia 5 se pierden 9).
export const DIFERENCIA_MINIMA_DIAS = 6;
export const VENTANA_MINIMA_DIAS = DIFERENCIA_MINIMA_DIAS + 1; // días que cubre la ventana

export function ventanaDemasiadoAngosta(desde: number, hasta: number): boolean {
  return hasta - desde < DIFERENCIA_MINIMA_DIAS;
}
