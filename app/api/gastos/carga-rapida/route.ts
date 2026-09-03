import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readRaw, asegurarColumna, appendRows } from '@/lib/sheets';
import { CATEGORIAS_GASTO, MEDIOS_PAGO, admiteMontoNegativo, type CategoriaGasto } from '@/lib/types';

// ── Carga rápida de la conciliación bancaria ─────────────────────────────────────────────
//
// Un solo POST que arma varios Gastos a la vez: la grilla de la conciliación (una celda por
// categoría × medio de pago) y las transferencias entre cuentas, incluido el pago de la
// tarjeta. Todo entra por acá para no hacer un POST por celda cargada — con ocho cuentas y
// una docena de rubros, eso son fácilmente treinta pedidos por un solo cierre.
//
// No es un tipo de gasto nuevo: cada celda y cada transferencia terminan siendo una fila más
// en la hoja Gastos, con la misma forma que si se hubieran cargado una por una en /gastos.

interface Celda { categoria: string; medio_pago: string; monto: number }
interface Transferencia { medio_pago: string; medio_pago_destino: string; monto: number; descripcion?: string }

// Categorías que puede llevar una celda de la grilla: todas menos las dos que tienen su
// propio circuito — 'insumos' se aplica desde Stocks, 'movimiento_interno' es la sección de
// transferencias, con dos cuentas y no una.
const CATEGORIAS_GRILLA = CATEGORIAS_GASTO.filter((c) => c.value !== 'insumos' && c.value !== 'movimiento_interno');
const labelCategoria = (v: string) => CATEGORIAS_GASTO.find((c) => c.value === v)?.label || v;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { fecha, celdas, transferencias } = await req.json() as {
      fecha: string; celdas?: Celda[]; transferencias?: Transferencia[];
    };
    if (!fecha) return NextResponse.json({ error: 'falta_fecha' }, { status: 400 });

    const celdasOk = (celdas || []).filter((c) => Number(c.monto) !== 0);
    const transfOk = (transferencias || []).filter((t) => Number(t.monto) !== 0);
    if (!celdasOk.length && !transfOk.length) {
      return NextResponse.json({ error: 'nada_para_guardar' }, { status: 400 });
    }

    for (const c of celdasOk) {
      if (!CATEGORIAS_GRILLA.some((x) => x.value === c.categoria)) {
        return NextResponse.json({ error: `categoria_invalida: ${c.categoria}` }, { status: 400 });
      }
      if (!MEDIOS_PAGO.includes(c.medio_pago as any)) {
        return NextResponse.json({ error: `medio_invalido: ${c.medio_pago}` }, { status: 400 });
      }
      const m = Number(c.monto);
      if (!isFinite(m) || (m < 0 && !admiteMontoNegativo(c.categoria))) {
        return NextResponse.json({ error: `monto_invalido: ${c.categoria}/${c.medio_pago}` }, { status: 400 });
      }
    }
    for (const t of transfOk) {
      if (!MEDIOS_PAGO.includes(t.medio_pago as any) || !MEDIOS_PAGO.includes(t.medio_pago_destino as any)) {
        return NextResponse.json({ error: 'medio_invalido' }, { status: 400 });
      }
      if (t.medio_pago === t.medio_pago_destino) return NextResponse.json({ error: 'destino_igual_origen' }, { status: 400 });
      if (!isFinite(Number(t.monto)) || Number(t.monto) <= 0) return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    await asegurarColumna('Gastos', 'medio_pago_destino');
    const raw = await readRaw('Gastos');
    const headers = raw[0] || [];
    if (!headers.length) throw new Error('No se pudo leer el header de Gastos');
    const idxId = headers.indexOf('id_gasto');
    let seq = 0;
    if (idxId !== -1) {
      for (let i = 1; i < raw.length; i++) {
        const n = parseInt(String(raw[i][idxId] || '').replace('GAS-', ''), 10);
        if (!isNaN(n)) seq = Math.max(seq, n);
      }
    }

    const ahora = new Date().toISOString().split('T')[0];
    const filas: Record<string, any>[] = [];

    for (const c of celdasOk) {
      seq++;
      filas.push({
        id_gasto: `GAS-${String(seq).padStart(4, '0')}`,
        fecha,
        descripcion: `Conciliación bancaria — ${labelCategoria(c.categoria)}`,
        categoria: c.categoria,
        monto: Number(c.monto),
        medio_pago: c.medio_pago,
        medio_pago_destino: '',
        usuario: user.email,
        fecha_carga: ahora,
        aplicado_stock: '',
        id_articulo: '',
        cantidad: '',
      });
    }
    for (const t of transfOk) {
      seq++;
      filas.push({
        id_gasto: `GAS-${String(seq).padStart(4, '0')}`,
        fecha,
        descripcion: t.descripcion?.trim() || `Transferencia — ${t.medio_pago} → ${t.medio_pago_destino}`,
        categoria: 'movimiento_interno' as CategoriaGasto,
        monto: Number(t.monto),
        medio_pago: t.medio_pago,
        medio_pago_destino: t.medio_pago_destino,
        usuario: user.email,
        fecha_carga: ahora,
        aplicado_stock: '',
        id_articulo: '',
        cantidad: '',
      });
    }

    const rows = filas.map((f) => headers.map((h) => (f[h] !== undefined ? f[h] : '')));
    await appendRows('Gastos', rows);

    return NextResponse.json({ ok: true, cargados: filas.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
