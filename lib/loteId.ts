import { readConfig, updateConfig } from './sheets';

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

export function parsearIdLote(id: string): LoteIdParts | null {
  const completo = /^N([12])([LRA])([12])-(\d+)$/.exec(id);
  if (completo) return { nave: Number(completo[1]) as 1 | 2, cultivo: completo[2] as 'L' | 'R' | 'A', mesada: Number(completo[3]) as 1 | 2, correlativo: Number(completo[4]) };
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

function pad(n: number): string { return String(n).padStart(3, '0'); }
