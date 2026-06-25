import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readRaw, setRowByHeader } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// Orden EXACTO con el que el append viejo (posicional) escribía las filas de Lotes.
// La planilla tiene 2 columnas más (peso_muestra_paquete_gr, cajones_armados) que ese
// array no contemplaba, por eso desde "usuario_creador" todo quedó corrido 2 columnas
// (y el estado cayó en destino_cosecha, dejando 'estado' vacío).
const OLD_ORDER = [
  'id_lote', 'variedad', 'fecha_siembra', 'plantines_iniciales', 'fase_actual',
  'ubicacion_actual', 'tubos_ocupados_actual', 'plantas_estimadas_actual', 'fecha_ult_movimiento',
  'fecha_f1', 'fecha_f2', 'fecha_cosecha', 'dias_plantinera', 'dias_f1', 'dias_f2', 'dias_total',
  'unidades_cosechadas', 'plantas_por_unidad_real', 'descarte_reportado', 'peso_muestra_kg',
  'peso_total_estimado_kg', 'usuario_creador', 'foto_url', 'lote_origen', 'semilla_id',
  'destino_cosecha', 'notas', 'estado',
];

// Detecta filas corridas (estado vacío + destino_cosecha trae lo que debería ser el estado)
// y las re-alinea reconstruyendo cada campo en su columna correcta. Dry-run; ?apply=1 aplica.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const apply = req.nextUrl.searchParams.get('apply') === '1';
  const raw = await readRaw('Lotes');
  if (raw.length < 2) return new NextResponse('sin datos', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const headers = raw[0];
  const idxEstado = headers.indexOf('estado');
  const idxDestino = headers.indexOf('destino_cosecha');
  const idxId = headers.indexOf('id_lote');

  const fixes: { row: number; id: string; obj: Record<string, any> }[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const estado = String(r[idxEstado] ?? '').trim();
    const destino = String(r[idxDestino] ?? '').trim();
    // firma de fila corrida: estado vacío y el valor que debería ser estado quedó en destino_cosecha
    if (estado === '' && (destino === 'activo' || destino === 'cosechado')) {
      const obj: Record<string, any> = {};
      OLD_ORDER.forEach((f, k) => { obj[f] = r[k] !== undefined ? r[k] : ''; });
      fixes.push({ row: i + 1, id: String(r[idxId] ?? ''), obj });
    }
  }

  if (apply) {
    for (const f of fixes) await setRowByHeader('Lotes', f.row, headers, f.obj);
  }

  const lines = fixes.map(f => `fila ${f.row}: id=${f.id}  →  estado=${f.obj.estado}  usuario=${f.obj.usuario_creador}  origen=${f.obj.lote_origen}  semilla=${f.obj.semilla_id}`);
  const head = apply
    ? `=== RE-ALINEADAS: ${fixes.length} filas ===`
    : `=== A RE-ALINEAR (dry-run · abrí con ?apply=1 para aplicar): ${fixes.length} filas ===`;

  return new NextResponse([head, ...lines].join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
