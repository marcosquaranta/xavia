// lib/loteId.ts
// Helpers para generar y parsear IDs de lote en formato N1L1-007.
//
// Formato: [Nave][Cultivo][Mesada]-[correlativo]
//   Nave: N1 o N2
//   Cultivo: L (lechuga), R (rucula), A (albahaca) — opcional, se completa en trasplante
//   Mesada: 1 o 2 — opcional, se completa en trasplante
//   Correlativo: 001, 002, ... (3 dígitos con padding cero)
//
// Estados:
//   En siembra:    N1-007        (sin cultivo ni mesada todavía)
//   En trasplante: N1L1-007      (completo)

import { readConfig, updateConfig } from './sheets';

export interface LoteIdParts {
  nave: 1 | 2;
  cultivo?: 'L' | 'R' | 'A';
  mesada?: 1 | 2;
  correlativo: number;
}

/**
 * Genera el próximo ID provisional de lote al sembrar.
 * Solo conoce nave + correlativo. Ejemplo: "N1-007".
 * Incrementa el correlativo en la configuración.
 */
export async function generarIdSiembra(nave: 1 | 2): Promise<string> {
  const claveCorrelativo =
    nave === 1 ? 'proximo_correlativo_n1' : 'proximo_correlativo_n2';
  const correlativo = Number((await readConfig(claveCorrelativo)) || 1);
  const id = `N${nave}-${pad(correlativo)}`;
  await updateConfig(claveCorrelativo, correlativo + 1);
  return id;
}

/**
 * Completa el ID provisional al trasplantar.
 * Recibe el ID provisional ("N1-007"), el cultivo y la mesada, y devuelve
 * el ID completo ("N1L1-007").
 */
export function completarIdEnTrasplante(
  idProvisional: string,
  cultivo: 'L' | 'R' | 'A',
  mesada: 1 | 2
): string {
  const parts = parsearIdLote(idProvisional);
  if (!parts) throw new Error(`ID inválido: ${idProvisional}`);
  return `N${parts.nave}${cultivo}${mesada}-${pad(parts.correlativo)}`;
}

/**
 * Parsea un ID de lote y devuelve sus partes.
 * Devuelve null si el formato es inválido.
 */
export function parsearIdLote(id: string): LoteIdParts | null {
  // Formato completo: N1L1-007 o N2R2-014
  const completo = /^N([12])([LRA])([12])-(\d+)$/.exec(id);
  if (completo) {
    return {
      nave: Number(completo[1]) as 1 | 2,
      cultivo: completo[2] as 'L' | 'R' | 'A',
      mesada: Number(completo[3]) as 1 | 2,
      correlativo: Number(completo[4]),
    };
  }
  // Formato provisional: N1-007
  const provisional = /^N([12])-(\d+)$/.exec(id);
  if (provisional) {
    return {
      nave: Number(provisional[1]) as 1 | 2,
      correlativo: Number(provisional[2]),
    };
  }
  return null;
}

/**
 * Devuelve el código de cultivo (L/R/A) según la variedad.
 */
export function codigoCultivoDesdeVariedad(variedad: string): 'L' | 'R' | 'A' {
  const v = variedad.toLowerCase();
  if (v.includes('lechuga') || v.includes('hoja de roble')) return 'L';
  if (v.includes('rucula') || v.includes('rúcula')) return 'R';
  if (v.includes('albahaca')) return 'A';
  // Fallback: lechuga
  return 'L';
}

/**
 * Devuelve el número de mesada (1 o 2) según el id_ubicacion.
 * Ejemplo: "N1-ML1-F1" → 1, "N2-MR2" → 2.
 */
export function numeroMesadaDesdeUbicacion(idUbicacion: string): 1 | 2 | null {
  const match = /M[LR]([12])/.exec(idUbicacion);
  if (!match) return null;
  return Number(match[1]) as 1 | 2;
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}
