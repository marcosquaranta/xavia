// Los cultivos que se cuentan en cámara.
//
// Vive acá y no en el componente de la cámara a propósito: el componente es 'use client', y
// una página de servidor que importe un valor de un módulo cliente no recibe el valor sino
// una referencia — recorrerla con .map() tira una excepción de servidor y se cae la página
// entera. Las constantes compartidas entre servidor y cliente van en lib.
export const CULTIVOS_DESCARTE = [
  { key: 'rucula', label: 'Rúcula' },
  { key: 'lechuga_crespa', label: 'Lechuga Crespa' },
  { key: 'lechuga_roble', label: 'Lechuga Hoja de Roble' },
  { key: 'albahaca', label: 'Albahaca' },
] as const;
