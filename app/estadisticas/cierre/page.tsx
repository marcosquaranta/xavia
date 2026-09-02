import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularEERR, previsionesSugeridas } from '@/lib/eerr';
import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import { leerPrevisiones, previsionDelMes } from '@/lib/previsiones';
import PrevisionesEditor from './PrevisionesEditor';
export const dynamic = 'force-dynamic';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pct = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n)}%`;
// Una variación contra una base casi nula no informa nada: "+1.178.671%" ocupa lugar y no
// dice más que "el mes pasado no hubo". Se corta en 999%.
const variacion = (act: number, ant: number): number | null => (ant === 0 ? null : ((act - ant) / Math.abs(ant)) * 100);
const pctVar = (v: number) => (Math.abs(v) > 999 ? (v > 0 ? '> +999%' : '< −999%') : pct(v));

// Las categorías de artículo vienen del texto libre de la planilla, muchas en mayúsculas.
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const cell: React.CSSProperties = { padding: '5px 10px', fontSize: '13px' };
const cellNum: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const cellDetalle: React.CSSProperties = { ...cell, paddingLeft: '26px', color: '#4b5563' };

export default async function CierreMensualPage({ searchParams }: { searchParams: { anio?: string; mes?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let articulos: Articulo[] = [], stocks: StockMes[] = [], gastos: Gasto[] = [];
  let ventas: VentaDia[] = [], precios: PrecioVenta[] = [], clientes: ClienteVenta[] = [];
  let previsiones: Awaited<ReturnType<typeof leerPrevisiones>> = [];
  let err: string | null = null;
  try {
    [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
      readSheet<Articulo>('Articulos'), readSheet<StockMes>('Stocks'), readSheet<Gasto>('Gastos'),
      readSheet<VentaDia>('Ventas'), readSheet<PrecioVenta>('Precios').catch(() => []),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      leerPrevisiones(),
    ]);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const anio = Number(searchParams.anio) || hoy.getFullYear();
  const mes = Number(searchParams.mes) || (hoy.getMonth() + 1);
  let mesPrev = mes - 1, anioPrev = anio;
  if (mesPrev === 0) { mesPrev = 12; anioPrev--; }

  const datos = { articulos, stocks, gastos, ventas, precios, clientes };
  const act = calcularEERR(datos, anio, mes);
  const ant = calcularEERR(datos, anioPrev, mesPrev);
  const prev = previsionesSugeridas(act.masaSalarial);
  const guardada = previsionDelMes(previsiones, anio, mes);

  const esMesActual = anio === hoy.getFullYear() && mes === (hoy.getMonth() + 1);
  const hrefMes = (a: number, m: number) => `/estadisticas/cierre?anio=${a}&mes=${m}`;
  let mesSig = mes + 1, anioSig = anio;
  if (mesSig === 13) { mesSig = 1; anioSig++; }
  const haySiguiente = anioSig < hoy.getFullYear() || (anioSig === hoy.getFullYear() && mesSig <= hoy.getMonth() + 1);
  const nombre = `${MESES[mes - 1]} ${anio}`.replace(/^./, (c) => c.toUpperCase());
  const nombrePrev = `${MESES[mesPrev - 1].slice(0, 3)} ${String(anioPrev).slice(2)}`;

  // Cada línea del bloque anterior, para poder comparar aunque una categoría exista en un
  // mes y no en el otro.
  const montoAnterior = (label: string, lineas: { label: string; monto: number }[]) =>
    lineas.find((l) => l.label === label)?.monto ?? 0;

  const Fila = ({ label, monto, antMonto, nivel = 'detalle' }: { label: string; monto: number; antMonto: number; nivel?: 'total' | 'detalle' | 'resultado' }) => {
    const v = variacion(monto, antMonto);
    const esTotal = nivel === 'total', esRes = nivel === 'resultado';
    return (
      <tr style={{ borderTop: esTotal || esRes ? '1px solid #e5e7eb' : '1px solid #f6f6f4' }}>
        <td style={{
          ...(esTotal || esRes ? cell : cellDetalle),
          fontWeight: esTotal || esRes ? 700 : 400,
          textTransform: esTotal ? 'uppercase' : 'none',
          letterSpacing: esTotal ? '0.3px' : 0,
          fontSize: esRes ? '14px' : esTotal ? '12px' : '13px',
        }}>{label}</td>
        <td style={{ ...cellNum, fontWeight: esTotal || esRes ? 800 : 500, fontSize: esRes ? '15px' : '13px', color: esRes && monto < 0 ? '#dc2626' : '#111827' }}>
          {$(monto)}
        </td>
        <td style={{ ...cellNum, color: '#9ca3af', fontSize: '12px' }}>{$(antMonto)}</td>
        <td style={{ ...cellNum, fontSize: '12px', color: v === null ? '#d1d5db' : v > 0 ? '#b45309' : '#059669' }}>
          {v === null ? '—' : pctVar(v)}
        </td>
      </tr>
    );
  };

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Cierre mensual</h1>
            <p className="page-subtitle">Estado de resultados — se calcula solo con lo que está cargado en la app</p>
          </div>
          <Link href="/estadisticas" className="btn secondary" style={{ fontSize: '12px' }}>← Volver a Estadísticas</Link>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0 14px', flexWrap: 'wrap' }}>
          <Link href={hrefMes(anioPrev, mesPrev)} className="btn secondary" style={{ fontSize: '12px' }}>‹ Mes anterior</Link>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>{nombre}</span>
          {haySiguiente
            ? <Link href={hrefMes(anioSig, mesSig)} className="btn secondary" style={{ fontSize: '12px' }}>Mes siguiente ›</Link>
            : <span className="btn secondary" style={{ fontSize: '12px', opacity: 0.4, pointerEvents: 'none' }}>Mes siguiente ›</span>}
        </div>

        {esMesActual && (
          <div className="alert-box" style={{ marginBottom: '12px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12.5px' }}>
            El mes está en curso: los números van a seguir cambiando hasta que termine y se cargue el stock final.
          </div>
        )}

        {act.avisos.length > 0 && (
          <div className="alert-box" style={{ marginBottom: '12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12.5px' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Datos que faltan y hacen que el resultado no cierre</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {act.avisos.map((a, i) => <li key={i} style={{ marginBottom: '2px' }}>{a}</li>)}
            </ul>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead>
              <tr style={{ background: '#fafaf9' }}>
                <th style={{ ...cell, textAlign: 'left', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Concepto</th>
                <th style={{ ...cellNum, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{nombre}</th>
                <th style={{ ...cellNum, fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{nombrePrev}</th>
                <th style={{ ...cellNum, fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Var.</th>
              </tr>
            </thead>
            <tbody>
              <Fila label="Ventas" monto={act.ventas.total} antMonto={ant.ventas.total} nivel="total" />
              {act.ventas.porCultivo.filter((c) => c.monto > 0 || montoAnterior(c.label, ant.ventas.porCultivo) > 0).map((c) => (
                <tr key={c.label} style={{ borderTop: '1px solid #f6f6f4' }}>
                  <td style={cellDetalle}>{c.label} <span style={{ color: '#9ca3af', fontSize: '11.5px' }}>· {Math.round(c.unidades).toLocaleString('es-AR')} u</span></td>
                  <td style={{ ...cellNum, fontWeight: 500 }}>{$(c.monto)}</td>
                  <td style={{ ...cellNum, color: '#9ca3af', fontSize: '12px' }}>{$(montoAnterior(c.label, ant.ventas.porCultivo))}</td>
                  <td style={{ ...cellNum, fontSize: '12px', color: '#d1d5db' }}></td>
                </tr>
              ))}

              <Fila label="Costo variable" monto={act.costoVariable.total} antMonto={ant.costoVariable.total} nivel="total" />
              {act.costoVariable.lineas.map((l) => (
                <Fila key={l.label} label={l.fuente === 'stock' ? capitalizar(l.label) : l.label} monto={l.monto} antMonto={montoAnterior(l.label, ant.costoVariable.lineas)} />
              ))}

              <Fila label="Costos fijos" monto={act.costosFijos.total} antMonto={ant.costosFijos.total} nivel="total" />
              {act.costosFijos.lineas.map((l) => (
                <Fila key={l.label} label={l.label} monto={l.monto} antMonto={montoAnterior(l.label, ant.costosFijos.lineas)} />
              ))}

              {(act.otrosIngresos !== 0 || ant.otrosIngresos !== 0) && (
                <Fila label="Otros ingresos" monto={act.otrosIngresos} antMonto={ant.otrosIngresos} nivel="total" />
              )}

              <Fila label="Resultado final" monto={act.resultado} antMonto={ant.resultado} nivel="resultado" />
              <Fila label="Resultado sin inversión" monto={act.resultadoSinInversion} antMonto={ant.resultadoSinInversion} nivel="resultado" />
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginTop: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Previsiones — {nombre}
          </p>
          <PrevisionesEditor
            anio={anio} mes={mes} masaSalarial={act.masaSalarial} sugeridas={prev}
            guardadas={guardada ? {
              despidos: Number(guardada.despidos) || 0,
              sac: Number(guardada.sac) || 0,
              notas: String(guardada.notas || ''),
              fecha: String(guardada.fecha_carga || ''),
            } : null}
          />
        </div>

        <div className="card" style={{ marginTop: '12px', background: '#fafaf9' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>De dónde sale cada número</p>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#4b5563', lineHeight: 1.6 }}>
            <li><strong>Ventas:</strong> las ventas cargadas del mes, a los precios de cada cliente. Los kg se convierten a unidades con el peso real de las plantas cosechadas.</li>
            <li><strong>Costo variable de insumos:</strong> lo que se <em>consumió</em>, no lo que se compró — <span style={{ fontFamily: 'monospace' }}>inicial + compras − final</span> de Stocks, valorizado al último precio conocido, agrupado por categoría de artículo.</li>
            <li><strong>Fletes, energía y cultivos de reventa:</strong> son costo variable pero no pasan por Stocks, así que salen de Gastos.</li>
            <li><strong>Costos fijos:</strong> los gastos del mes agrupados por categoría.</li>
            <li><strong>Los gastos de «Insumos» no se suman aparte:</strong> ya están contados dentro del consumo de Stocks. Si alguno quedó sin aplicar a stock, aparece arriba como aviso.</li>
            <li><strong>Quedan afuera del resultado:</strong> los movimientos entre medios de pago (pagar el resumen de la tarjeta no es un gasto nuevo) y los aportes de socios, que son financiamiento.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
