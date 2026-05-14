import { readConfig, updateConfig, readSheet } from './sheets';

export interface LoteIdParts { nave: 1 | 2; cultivo?: 'L' | 'R' | 'A'; mesada?: 1 | 2; correlativo: number; }

export async function generarIdSiembra(nave: 1 | 2): Promise<string> {
  const claveCorrelativo = nave === 1 ? 'proximo_correlativo_n1' : 'proximo_correlativo_n2';
  const correlativo = Number((await readConfig(claveCorrelativo)) || 1);
  const id = `N${nave}-${pad(correlativo)}`;
  await updateConfig(claveCorrelativo, correlativo + 1);
  return id;
}

export function completarIdEnTrasplante(idProvisional: string, cultivo: 'L' | 'R' | 'A', mesada: 1 | 2): string {
  const parts = parsearIdLote(idProvisional);
  if (!parts) throw new Error(`ID inválido: ${idProvisional}`);
  return `N${parts.nave}${cultivo}${mesada}-${pad(parts.correlativo)}`;
}

/**
 * Genera un nuevo ID para un lote que cambia de mesada.
 * Si el ID candidato ya existe en Lotes, prueba con el siguiente correlativo disponible.
 * Si el correlativo ya existe con sufijo B, prueba C, D, etc.
 */
export async function generarIdCambioMesada(
  idActual: string,
  nuevaMesada: 1 | 2,
  lotesExistentes: string[]
): Promise<string> {
  const parts = parsearIdLote(idActual);
  if (!parts || !parts.cultivo) throw new Error(`ID inválido para cambio de mesada: ${idActual}`);

  const { nave, cultivo, correlativo } = parts;
  const idCandidato = `N${nave}${cultivo}${nuevaMesada}-${pad(correlativo)}`;

  // Si el candidato no existe o es el mismo lote, usarlo directo
  if (!lotesExistentes.includes(idCandidato) || idCandidato === idActual) {
    return idCandidato;
  }

  // Si ya existe, probar con sufijos B, C, D...
  const sufijos = ['B', 'C', 'D', 'E', 'F'];
  for (const sufijo of sufijos) {
    const idConSufijo = `N${nave}${cultivo}${nuevaMesada}-${pad(correlativo)}${sufijo}`;
    if (!lotesExistentes.includes(idConSufijo)) {
      return idConSufijo;
    }
  }

  // Último recurso: siguiente correlativo disponible
  const maxCorrelativo = lotesExistentes
    .map((id) => parsearIdLote(id))
    .filter((p): p is LoteIdParts => p !== null && p.nave === nave)
    .reduce((max, p) => Math.max(max, p.correlativo), 0);

  return `N${nave}${cultivo}${nuevaMesada}-${pad(maxCorrelativo + 1)}`;
}

export function parsearIdLote(id: string): LoteIdParts | null {
  // Con sufijo (ej: N2R1-015B)
  const conSufijo = /^N([12])([LRA])([12])-(\d+)[A-Z]$/.exec(id);
  if (conSufijo) return { nave: Number(conSufijo[1]) as 1 | 2, cultivo: conSufijo[2] as 'L' | 'R' | 'A', mesada: Number(conSufijo[3]) as 1 | 2, correlativo: Number(conSufijo[4]) };
  // Completo normal (ej: N2R1-015)
  const completo = /^N([12])([LRA])([12])-(\d+)$/.exec(id);
  if (completo) return { nave: Number(completo[1]) as 1 | 2, cultivo: completo[2] as 'L' | 'R' | 'A', mesada: Number(completo[3]) as 1 | 2, correlativo: Number(completo[4]) };
  // Provisional (ej: N1-007)
  const provisional = /^N([12])-(\d+)$/.exec(id);
  if (provisional) return { nave: Number(provisional[1]) as 1 | 2, correlativo: Number(provisional[2]) };
  return null;
}

export function codigoCultivoDesdeVariedad(variedad: string): 'L' | 'R' | 'A' {
  const v = variedad.toLowerCase();
  if (v.includes('rucula') || v.includes('rúcula')) return 'R';
  if (v.includes('albahaca')) return 'A';
  return 'L';
}

export function numeroMesadaDesdeUbicacion(idUbicacion: string): 1 | 2 | null {
  const match = /M[LR]([12])/.exec(idUbicacion);
  if (!match) return null;
  return Number(match[1]) as 1 | 2;
}

// pad flexible: 3 dígitos mínimo, más si el número lo requiere
function pad(n: number): string {
  return n >= 1000 ? String(n) : String(n).padStart(3, '0');
}
