'use client';
import { useState } from 'react';
import type { HistoricoEERR, FilaHistorico } from '@/lib/eerrHistorico';

// Serie mensual del EERR: una columna por mes, las mismas líneas del cierre.
//
// Dos modos de ver los números, y el segundo no es un adorno:
//
// En pesos, dos meses separados por un año no se pueden comparar de verdad — con la
// inflación de acá, un costo que "subió 60%" puede haber bajado en términos reales. En
// % sobre ventas eso se corrige solo: lo que se compara es cuánto del ingreso se come cada
// línea, y eso sí es comparable entre meses lejanos.
//
// Arranca en pesos porque es lo que se busca cuando se entra ("¿cuánto gastamos en
// alquiler?"), con el aviso de la inflación a la vista.

const $ = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');

const cel: React.CSSProperties = { padding: '5px 10px', fontSize: '12.5px', whiteSpace: 'nowrap' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
// La primera columna queda fija: con doce meses al costado, si el nombre de la línea se va
// de pantalla no se sabe qué fila se está leyendo.
const celLabel = (fondo: string): React.CSSProperties => ({
  ...cel, position: 'sticky', left: 0, background: fondo, zIndex: 1,
  borderRight: '1px solid #e5e7eb', minWidth: '210px',
});

export default function TablaHistorico({ h }: { h: HistoricoEERR }) {
  const [modo, setModo] = useState<'pesos' | 'pct'>('pesos');
  const [abierto, setAbierto] = useState<Record<string, boolean>>({ ventas: false, variable: true, fijos: true });

  const ventasPorMes = h.filas.find((f) => f.label === 'Ventas')?.montos || [];

  const valor = (f: FilaHistorico, i: number): string => {
    const n = f.montos[i] ?? 0;
    if (modo === 'pesos') return Math.round(n) === 0 ? '—' : $(n);
    const v = ventasPorMes[i] ?? 0;
    // Sin ventas en el mes no hay peso que calcular: dividir por cero daría un número
    // cualquiera en una tabla donde todo lo demás es real.
    if (!v) return '—';
    return `${((n / v) * 100).toFixed(1)}%`;
  };

  // Las filas de detalle se pueden plegar por bloque: la tabla completa son más de veinte
  // renglones y lo que casi siempre se mira son los totales.
  const visible = (f: FilaHistorico) =>
    f.nivel === 'total' || f.bloque === 'resultado' || abierto[f.bloque];

  const esResultado = (f: FilaHistorico) => f.bloque === 'resultado';

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {([['pesos', 'En pesos'], ['pct', '% sobre ventas']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setModo(k)}
              style={{
                padding: '5px 11px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer',
                border: '1px solid ' + (modo === k ? '#111827' : '#e5e7eb'),
                background: modo === k ? '#111827' : '#fff', color: modo === k ? '#fff' : '#374151',
                fontWeight: modo === k ? 700 : 400,
              }}>{label}</button>
          ))}
        </div>
        <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
          {modo === 'pesos'
            ? 'Ojo al comparar meses lejanos en pesos: con la inflación, un costo que subió 60% puede haber bajado en términos reales. Para eso está la otra vista.'
            : 'Cuánto del ingreso se come cada línea. Es la vista que sirve para comparar meses lejanos, porque la inflación afecta igual al costo y a la venta.'}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ background: '#fafaf9' }}>
              <th style={{ ...celLabel('#fafaf9'), textAlign: 'left', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Concepto
              </th>
              {h.meses.map((m) => (
                <th key={m.clave} style={{ ...celNum, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {m.label}
                  {/* Un mes sin previsiones confirmadas no está cerrado del todo. En una serie
                      eso importa más que en una pantalla sola: el renglón de abajo explica el
                      punto y así el mes no se lee como definitivo. */}
                  {!m.previsionesConfirmadas && <span title="Previsiones sin confirmar" style={{ color: '#b45309' }}> ·</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {h.filas.filter(visible).map((f) => {
              const total = f.nivel === 'total', res = esResultado(f);
              const fondo = res ? '#fafaf9' : '#fff';
              const plegable = total && !res;
              return (
                <tr key={f.bloque + f.label} style={{ borderTop: total || res ? '1px solid #e5e7eb' : '1px solid #f6f6f4' }}>
                  <td style={{ ...celLabel(fondo), paddingLeft: total || res ? '10px' : '26px' }}>
                    {plegable ? (
                      <button onClick={() => setAbierto((p) => ({ ...p, [f.bloque]: !p[f.bloque] }))}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#9ca3af', fontSize: '10px', width: '9px' }}>{abierto[f.bloque] ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 700, fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{f.label}</span>
                      </button>
                    ) : (
                      <span style={{ fontWeight: res ? 700 : 400 }}>{f.label}</span>
                    )}
                  </td>
                  {h.meses.map((m, i) => {
                    const n = f.montos[i] ?? 0;
                    return (
                      <td key={m.clave} style={{
                        ...celNum, background: fondo,
                        fontWeight: total || res ? 700 : 400,
                        color: res && n < 0 ? '#dc2626' : Math.round(n) === 0 ? '#d1d5db' : '#111827',
                      }}>{valor(f, i)}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ margin: 0, padding: '8px 12px', fontSize: '11px', color: '#9ca3af', borderTop: '1px solid #f3f4f6' }}>
        Del mes más viejo cargado hasta el <strong>último mes cerrado</strong>. El mes en curso no está: siempre tiene
        las ventas de unos días contra gastos fijos pagados enteros, así que aparecería como un derrumbe que no es real.
        Cada mes se recalcula sobre lo que hay cargado, así que si se corrige un gasto viejo, ese mes cambia también acá.
        Un <span style={{ color: '#b45309' }}>·</span> al lado del mes significa que las previsiones de ese mes no están confirmadas.
      </p>
    </div>
  );
}
