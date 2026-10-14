import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

// ── Cosecha en cajones ────────────────────────────────────────────────────────────────
//
// Antes todo salía en paquetes. Ahora una parte sale en cajones: cantidades fijas de kilos,
// sin armar paquete. Es la misma planta, cosechada de otra forma.
//
// El problema de registrar los cajones como si fueran unidades sueltas es que TODO lo que la
// app mide por unidad deja de significar lo mismo. "Se cosecharon 40 unidades" con 30 paquetes
// y 10 cajones no es comparable con 40 paquetes: los cajones pesan veinte veces más. El stock
// de cámara, el peso promedio, las plantas por paquete y el rendimiento del lote quedarían
// todos corridos, cada uno un poco, y ninguno de forma visible.
//
// La solución es la que planteó Marcos: convertir los cajones a PAQUETES-EQUIVALENTE por peso.
// Un cajón de 5 kg con paquetes de 210 g son ~23,8 paquetes. Esa es la misma conversión que la
// app ya usa para las ventas por kilo (ver GR_PAQ_RUCULA / GR_PAQ_LECHUGA), así que cosecha y
// venta hablan en la misma unidad y el stock de cámara cierra.
//
// Lo que NO se convierte es el pesaje testigo: el peso del paquete se mide en la balanza sobre
// un paquete real. Si saliera del cajón sería circular —se usaría el peso para estimar los
// paquetes y los paquetes para estimar el peso— y el número dejaría de medir nada.

// Los kilos que lleva un cajón de cada cultivo. Fijos, definidos por Marcos.
export const KG_POR_CAJON_RUCULA = 5;
export const KG_POR_CAJON_LECHUGA = 4;

export function kgPorCajonDe(variedad: string): number {
  const v = String(variedad || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return v.includes('rucula') ? KG_POR_CAJON_RUCULA : KG_POR_CAJON_LECHUGA;
}

// El peso de referencia de un paquete de ese cultivo, cuando no hay pesaje de hoy.
export function gramosPorPaqueteDe(variedad: string): number {
  const v = String(variedad || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return v.includes('rucula') ? GR_PAQ_RUCULA : GR_PAQ_LECHUGA;
}

export interface EquivalenciaCajones {
  cajones: number;
  kgPorCajon: number;
  kgTotales: number;
  gramosPorPaquete: number;
  // Cuántos paquetes representan esos cajones. Es lo que se suma a las unidades cosechadas.
  paquetesEquivalentes: number;
  // De dónde salió el gramaje, para poder decirlo en pantalla: un equivalente calculado con
  // el peso de hoy vale mucho más que uno calculado con el default del cultivo.
  origenPeso: 'pesaje de hoy' | 'referencia del cultivo';
}

export function equivalenciaDeCajones(args: {
  variedad: string;
  cajones: number;
  kgPorCajon?: number;
  // El pesaje testigo de ESTA cosecha, si se cargó. Es el mejor dato posible: son las plantas
  // de hoy, no un promedio histórico.
  pesoPaqueteGr?: number;
}): EquivalenciaCajones {
  const cajones = Math.max(0, Number(args.cajones) || 0);
  const kgPorCajon = Number(args.kgPorCajon) > 0 ? Number(args.kgPorCajon) : kgPorCajonDe(args.variedad);
  const dePesaje = Number(args.pesoPaqueteGr) > 0;
  const gramosPorPaquete = dePesaje ? Number(args.pesoPaqueteGr) : gramosPorPaqueteDe(args.variedad);
  const kgTotales = cajones * kgPorCajon;
  // Se redondea a entero: un paquete es una unidad discreta, y el stock de cámara ya trabaja
  // en enteros. Un equivalente con decimales arrastra fracciones de paquete por toda la app.
  const paquetesEquivalentes = gramosPorPaquete > 0 ? Math.round((kgTotales * 1000) / gramosPorPaquete) : 0;
  return {
    cajones, kgPorCajon, kgTotales, gramosPorPaquete, paquetesEquivalentes,
    origenPeso: dePesaje ? 'pesaje de hoy' : 'referencia del cultivo',
  };
}
