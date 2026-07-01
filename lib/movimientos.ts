import { readSheet } from './sheets';
import type { Movimiento } from './types';

export async function proximoIdMovimiento(): Promise<number> {
  const movimientos = await readSheet<Movimiento>('Movimientos');
  if (movimientos.length === 0) return 1;
  return movimientos.reduce((acc, m) => Math.max(acc, Number(m.id_movimiento) || 0), 0) + 1;
}
