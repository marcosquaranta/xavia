import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { generarIdSiembra, completarIdEnTrasplante } from '@/lib/loteId';
import { proximoIdMovimiento, codigoCultivo } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';

function diasEntre(desde: string, hasta: string): number {
  if (!desde || !hasta) return 0;
  try {
    const d1 = new Date(desde); const d2 = new Date(hasta);
    return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
  } catch { return 0; }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { id_lote, fecha, ubicacion_destino_id, tubos_ocupados, plantas_trasplantadas, plantas_quedan, descarte, fase_destino } = body;

    const [lotes, ubicaciones, movimientos] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<Movimiento>('Movimientos'),
    ]);

    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });

    const ubicDestino = ubicaciones.find((u) => u.id_ubicacion === ubicacion_destino_id);
    if (!ubicDestino) return NextResponse.json({ error: 'ubicacion_no_encontrada' }, { status: 400 });

    const cultivo = codigoCultivo(lote.variedad);
    const esRucula = cultivo === 'R';
    const factorPlantines = esRucula ? 2 : 1;
    const plantasReales = Math.round(plantas_trasplantadas / factorPlantines);
    const plantasQuedanReales = Math.round((plantas_quedan || 0) / factorPlantines);
    const seDivide = plantas_quedan > 0 && plantas_trasplantadas > 0;

    const matchMesada = /M[LR]([12])/.exec(ubicDestino.id_ubicacion);
    const numMesada = matchMesada ? Number(matchMesada[1]) as 1 | 2 : 1;

    // Fechas previas para calcular días
    const movsLote = movimientos
      .filter((m) => m.id_lote === id_lote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    const movSiembra = movsLote.find((m) => m.tipo === 'siembra');
    const movF1 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1