import { readConfig, updateConfig, readSheet } from './sheets';

export interface LoteIdParts {
  nave: 1 | 2;
  cultivo?: 'L' | 'R' | 'A';
  correlativo: number;
  sufijo?: string;
}

export async function generarIdSiembra(nave: 1 | 2): Promise<string> {
  const claveCorrelativo = nave === 1 ? 'proximo_correlativo_n1' : 'proximo_correlativo_n2';
  const correlativo = Number((await readConfig(claveCorrelativo)) || 1);
  const id = `N${nave}-${pad(correlativo)}`;
  await updateConfig(claveCorrelativo, correlativo + 1);
  return id;
}

export function completarIdEnTrasplante(idProvisional: string, cultivo: 'L' | 'R' | 'A'): string {
  const parts = parsearIdLote(idProvisional);
  if (!parts) throw new Error(`ID inválido: ${idProvisional}`);
  return `N${parts.nave}${cultivo}-${pad(parts.correlativo)}`;
}

export async function generarIdDivision(idPadre: string, lotesExistentes: string[]): Promise<string> {
  const parts = parsearIdLote(idPadre);
  if (!parts || !parts.cultivo) throw new Error(`ID inválido para división: ${idPadre}`);
  const { nave, cultivo, correlativo } = parts;
  const base = `N${nave}${cultivo}-${pad(correlativo)}`;
  const sufijos = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (const sufijo of sufijos) {
    const candidato = `${base}${sufijo}`;
    if (!lotesExistentes.includes(candidato)) return candidato;
  }
  const maxCorr = lotesExistentes
    .map(parsearIdLote)
    .filter((p): p is LoteIdParts => p !== null && p.nave === nave)
    .reduce((max, p) => Math.max(max, p.correlativo), 0);
  return `N${nave}${cultivo}-${pad(maxCorr + 1)}`;
}

export function parsearIdLote(id: string): LoteIdParts | null {
  const nuevoSufijo = /^N([12])([LRA])-(\d+)([A-Z])$/.exec(id);
  if (nuevoSufijo) return { nave: Number(nuevoSufijo[1]) as 1 | 2, cultivo: nuevoSufijo[2] as 'L' | 'R' | 'A', correlativo: Number(nuevoSufijo[3]), sufijo: nuevoSufijo[4] };
  const nuevo = /^N([12])([LRA])-(\d+)$/.exec(id);
  if (nuevo) return { nave: Number(nuevo[1]) as 1 | 2, cultivo: nuevo[2] as 'L' | 'R' | 'A', correlativo: Number(nuevo[3]) };
  const viejoSufijo = /^N([12])([LRA])([12])-(\d+)[A-Z]$/.exec(id);
  if (viejoSufijo) return { nave: Number(viejoSufijo[1]) as 1 | 2, cultivo: viejoSufijo[2] as 'L' | 'R' | 'A', correlativo: Number(viejoSufijo[4]) };
  const viejo = /^N([12])([LRA])([12])-(\d+)$/.exec(id);
  if (viejo) return { nave: Number(viejo[1]) as 1 | 2, cultivo: viejo[2] as 'L' | 'R' | 'A', correlativo: Number(viejo[4]) };
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

function pad(n: number): string {
  return n >= 1000 ? String(n) : String(n).padStart(3, '0');
}

export async function generarIdCambioMesada(idActual: string, _nuevaMesada: 1 | 2, _lotesExistentes: string[]): Promise<string> {
  return idActual;
}
