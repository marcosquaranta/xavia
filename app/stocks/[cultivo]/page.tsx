import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, VentaDia, StockCamara } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

function parseD(s: any): Date | null {
  if (!s) return null;
  const str = String(s).split(/[\sT]/)[0];
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}
const num = (x: any) => Number(x) || 0;
const fmtN = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

export default async function StockDetallePage({ params, searchParams }: { params: { cultivo: string }; searchParams: { mes?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const cultivo = params.cultivo === 'lechuga_crespa' ? 'lechuga_crespa' : params.cultivo === 'lechuga_roble' ? 'lechuga_roble' : 'rucula';
  const isRucula = cultivo === 'rucula';
  const isCrespa = cultivo === 'lechuga_crespa';
  const label = isRucula ? 'Rúcula' : isCrespa ? 'Lechuga Crespa' : 'Lechuga Hoja de Roble';
  const accent = isRucula ? '#134e4a' : isCrespa ? '#84cc16' : '#4d7c0f';

  let lotes: Lote[] = [], ventas: VentaDia[] = [], registros: StockCamara[] = [];
  try {
    [lotes, ventas, registros] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<VentaDia>('Ventas'), readSheet<StockCamara>('StockCamara'),
    ]);
  } catch {}

  // "Roble" es catch-all de cualquier lechuga no-crespa (mismo criterio que lib/camara.ts)
  // — así nunca se pierde stock de una variedad sin clasificar explícitamente.
  const matchVar = (v: string) => {
    const x = String(v).toLowerCase();
    const r = x.includes('rucula') || x.includes('rúcula');
    if (isRucula) return r;
    if (r) return false;
    return isCrespa ? x.includes('crespa') : !x.includes('crespa');
  };
  const ventaQty = (v: VentaDia) => isRucula
    ? num(v.rucula) + num(v.bandeja_rucula)
    : isCrespa ? num(v.lechuga_crespa) : num(v.hoja_roble);

  // Mes (default: actual). ?mes=YYYY-MM
  const hoy = new Date();
  let year = hoy.getFullYear(), month = hoy.getMonth();
  if (searchParams.mes && /^\d{4}-\d{2}$/.test(searchParams.mes)) {
    const [y, m] = searchParams.mes.split('-').map(Number);
    year = y; month = m - 1;
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthStart = new Date(year, month, 1, 12);
  const inMonth = (d: Date) => d.getFullYear() === year && d.getMonth() === month;
  const nombreMes = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  // Cosechas y ventas por día del mes
  const cosechaDia = new Array(lastDay + 1).fill(0);
  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !matchVar(l.variedad)) continue;
    const f = parseD(l.fecha_cosecha);
    if (f && inMonth(f)) cosechaDia[f.getDate()] += num(l.unidades_cosechadas);
  }
  const ventaDia = new Array(lastDay + 1).fill(0);
  for (const v of ventas) {
    const f = parseD(v.fecha);
    if (f && inMonth(f)) ventaDia[f.getDate()] += ventaQty(v);
  }
  // Controles de stock (conteos físicos) por día del mes. cantidad_paq YA es el stock
  // contado (absoluto), no un delta — de ahí sale el sobrante/faltante, no al revés.
  const ajusteDia: Record<number, { cant: number; descarte: number; notas: string }> = {};
  for (const s of registros) {
    if (s.cultivo !== cultivo) continue;
    const f = parseD(s.fecha);
    if (f && inMonth(f)) ajusteDia[f.getDate()] = { cant: num(s.cantidad_paq), descarte: num(s.descarte_paq), notas: String(s.notas || '') };
  }

  // Stock inicial del mes = teórico al arranque del día 1
  // = última base/ajuste anterior al mes + cosechas - ventas hasta el inicio del mes
  let inicial = 0;
  const basesPrev = registros
    .filter(s => s.cultivo === cultivo && parseD(s.fecha) && parseD(s.fecha)! < monthStart)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  if (basesPrev.length) {
    const base = basesPrev[basesPrev.length - 1];
    const bd = parseD(base.fecha)!;
    let bal = num(base.cantidad_paq);
    for (const l of lotes) {
      if (l.estado !== 'cosechado' || !matchVar(l.variedad)) continue;
      const f = parseD(l.fecha_cosecha);
      if (f && f > bd && f < monthStart) bal += num(l.unidades_cosechadas);
    }
    for (const v of ventas) {
      const f = parseD(v.fecha);
      if (f && f > bd && f < monthStart) bal -= ventaQty(v);
    }
    inicial = bal;
  }

  // Serie diaria. En días con control de stock, "stockActual" es lo CONTADO físicamente
  // (dato de entrada) y "sobraFalta" sale de compararlo contra lo esperado (teórico
  // acumulado + cosecha − ventas del día) — nunca al revés. El teórico se resetea al
  // valor contado para seguir de ahí.
  let teorico = inicial;
  const filas: { dia: number; cos: number; ven: number; stockActual: number | null; sobraFalta: number | null; descarte: number; notas: string; teorico: number }[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const cos = cosechaDia[d], ven = ventaDia[d];
    const aj = ajusteDia[d];
    const esperado = teorico + cos - ven;
    let sobraFalta: number | null = null;
    if (aj) { sobraFalta = Math.round((aj.cant - esperado) * 100) / 100; teorico = aj.cant; }
    else teorico = esperado;
    filas.push({ dia: d, cos, ven, stockActual: aj ? aj.cant : null, sobraFalta, descarte: aj?.descarte || 0, notas: aj?.notas || '', teorico });
  }
  const totales = filas.reduce((acc, f) => ({
    cos: acc.cos + f.cos, ven: acc.ven + f.ven,
    sobraFalta: acc.sobraFalta + (f.sobraFalta || 0), descarte: acc.descarte + f.descarte,
  }), { cos: 0, ven: 0, sobraFalta: 0, descarte: 0 });

  const prevMes = `${month === 0 ? year - 1 : year}-${String(month === 0 ? 12 : month).padStart(2, '0')}`;
  const nextMes = `${month === 11 ? year + 1 : year}-${String(month === 11 ? 1 : month + 2).padStart(2, '0')}`;
  const hoyDia = inMonth(hoy) ? hoy.getDate() : -1;

  return (
    <>
      <Header user={user} current="stocks" />
      <div className="container">
        <Link href="/stocks" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '10px' }}>← Volver a Stocks</Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '6px' }}>
          <h1 className="page-title" style={{ margin: 0, color: accent }}>Stock {label}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link href={`/stocks/${cultivo}?mes=${prevMes}`} className="btn secondary" style={{ fontSize: '12px', padding: '4px 10px' }}>←</Link>
            <span style={{ fontSize: '13px', fontWeight: 600, textTransform: 'capitalize', minWidth: '120px', textAlign: 'center' }}>{nombreMes}</span>
            <Link href={`/stocks/${cultivo}?mes=${nextMes}`} className="btn secondary" style={{ fontSize: '12px', padding: '4px 10px' }}>→</Link>
          </div>
        </div>
        <p className="page-subtitle">Stock teórico día a día. Las ventas se imputan por su <strong>fecha de venta</strong>. Los días con control de stock (resaltados) muestran lo <strong>contado físicamente</strong>; el sobrante/faltante sale de comparar ese conteo contra lo esperado.</p>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Día</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#059669' }}>Cosecha +</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#dc2626' }}>Ventas −</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#2563eb' }}>Stock actual (contado)</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Sobra/Falta</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#9333ea' }}>Descarte cámara</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700 }}>Stock teórico</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                <td colSpan={6} style={{ padding: '7px 12px', fontWeight: 600, color: '#6b7280' }}>Inicial del mes</td>
                <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 800 }}>{fmtN(inicial)}</td>
              </tr>
              {filas.map(f => {
                const esAjuste = f.stockActual !== null;
                const esHoy = f.dia === hoyDia;
                return (
                  <tr key={f.dia} style={{ borderBottom: '1px solid #f3f4f6', background: esAjuste ? '#eff6ff' : esHoy ? '#fffbeb' : 'white' }}>
                    <td style={{ padding: '6px 12px', fontWeight: esHoy ? 700 : 400 }}>{String(f.dia).padStart(2, '0')}{esHoy ? ' · hoy' : ''}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: f.cos > 0 ? '#059669' : '#d1d5db' }}>{f.cos > 0 ? '+' + fmtN(f.cos) : '·'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: f.ven > 0 ? '#dc2626' : '#d1d5db' }}>{f.ven > 0 ? '−' + fmtN(f.ven) : '·'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: '#2563eb', fontWeight: 700 }} title={f.notas}>{esAjuste ? fmtN(f.stockActual!) : '·'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: f.sobraFalta === null || f.sobraFalta === 0 ? '#9ca3af' : f.sobraFalta > 0 ? '#059669' : '#dc2626' }}>
                      {f.sobraFalta === null ? '·' : `${f.sobraFalta > 0 ? '+' : ''}${fmtN(f.sobraFalta)}`}
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: f.descarte > 0 ? '#9333ea' : '#d1d5db' }}>{f.descarte > 0 ? fmtN(f.descarte) : '·'}</td>
                    <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 700, color: f.teorico < 0 ? '#dc2626' : '#111827' }}>{fmtN(f.teorico)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                <td style={{ padding: '7px 12px', fontWeight: 800, color: '#111827' }}>Total del mes</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>+{fmtN(totales.cos)}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>−{fmtN(totales.ven)}</td>
                <td style={{ padding: '7px 12px' }} />
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: totales.sobraFalta === 0 ? '#9ca3af' : totales.sobraFalta > 0 ? '#059669' : '#dc2626' }}>
                  {totales.sobraFalta > 0 ? '+' : ''}{fmtN(totales.sobraFalta)}
                </td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: totales.descarte > 0 ? '#9333ea' : '#9ca3af' }}>{fmtN(totales.descarte)}</td>
                <td style={{ padding: '7px 14px' }} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '10px' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#eff6ff', border: '1px solid #2563eb', borderRadius: 2, marginRight: 4 }} /> día con control de stock (conteo físico) ·
          sobra/falta = contado − esperado (verde si sobra, rojo si falta) · descarte cámara es lo que se tiró ese conteo, no se confunde con la diferencia ·
          agrupa {isRucula ? 'rúcula + bandeja' : isCrespa ? 'solo lechuga crespa' : 'hoja de roble + otras variedades de lechuga'}
        </p>
      </div>
    </>
  );
}
