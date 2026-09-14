// Ventana de antigüedad de los recordatorios de cobro. Vive en su propio archivo, sin
// imports, porque lo necesitan los dos lados: el motor (server, que lee Google Sheets) y
// el formulario de configuración (cliente). Importarlo desde recordatoriosCobro.ts en un
// componente 'use client' arrastraba googleapis al bundle del navegador y rompía el build.

// La corrida es SEMANAL. Si la ventana es más angosta que 7 días, hay facturas que ningún
// lunes van a caer adentro y no se reclaman nunca. No se bloquea (puede ser a propósito),
// pero se avisa donde se configura.
export const VENTANA_MINIMA_DIAS = 7;

export function ventanaDemasiadoAngosta(desde: number, hasta: number): boolean {
  return hasta - desde < VENTANA_MINIMA_DIAS;
}
