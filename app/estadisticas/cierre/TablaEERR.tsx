'use client';
import { useState } from 'react';
import type { EERR } from '@/lib/eerr';

// Tabla del EERR con las mismas líneas que el Excel, en el mismo orden y aunque el mes no
// tenga movimiento — si las líneas aparecen y desaparecen según el mes no se puede comparar
// una columna con la otra.
//
// La columna que importa no es cuánto cambió el monto sino cuánto cambió su PESO SOBRE LAS
// VENTAS. Si las ventas suben 30% y semillas sube 25%, el monto de semillas creció pero el
// negocio mejoró: pesa menos que antes. Por eso el delta está en puntos porcentuales sobre
// ventas y no en variación de plata. En las líneas de costo, bajar es bueno (verde); en las
// de resultado es al revés.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pesoPct = (monto: number, ventas: number) => (ventas > 0 ? (monto / ventas) * 100 : null);
const fmtPeso = (p: number | null) => (p === null ? '—' : `${p.toFixed(1)}%`);
const fmtPP = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} p.p.`;

const cel: React.CSSProperties = { padding: '5px 10px', fontSize: '13px' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function TablaEERR({ act, ant, nombre, nombrePrev }: {
  act: EERR; ant: EERR; nombre: string; nombrePrev: string;
}) {
  const [abierto, setAbierto] = useState<Record<string, boolean>>({ variable: true, fijos: true, ventas: false });
  const toggle = (k: string) => setAbierto((p) => ({ ...p, [k]: !p[k] }));

  const montoAnt = (label: string, lineas: { label: string; monto: number }[]) =>
    lineas.find((l) => l.label === label)?.monto ?? 0;

  // Delta en puntos porcentuales sobre ventas. Sin ventas en alguno de los dos meses no hay
  // peso que comparar y se muestra vacío en vez de un número inventado.
  function delta(monto: number, anterior: number): number | null {
    const a = pesoPct(monto, act.ventas.total), b = pesoPct(anterior, ant.ventas.total);
    return a === null || b === null ? null : a - b;
  }

  function Delta({ monto, anterior, invertido = false }: { monto: number; anterior: number; invertido?: boolean }) {
    const d = delta(monto, anterior);
    if (d === null) return <span style={{ color: '#d1d5db' }}>—</span>;
    const bueno = invertido ? d > 0 : d < 0;
    const neutro = Math.abs(d) < 0.05;
    return (
      <span style={{ color: neutro ? '#9ca3af' : bueno ? '#059669' : '#dc2626', fontWeight: neutro ? 400 : 700 }}>
        {neutro ? '·' : fmtPP(d)}
      </span>
    );
  }

  function Fila({ label, monto, anterior, nivel, invertido, seccion, cantidad }: {
    label: string; monto: number; anterior: number;
    nivel: 'total' | 'detalle' | 'resultado'; invertido?: boolean; seccion?: string; cantidad?: string;
  }) {
    const esTotal = nivel === 'total', esRes = nivel === 'resultado';
    const clickeable = !!seccion;
    return (
      <tr style={{ borderTop: esTotal || esRes ? '1px solid #e5e7eb' : '1px solid #f6f6f4' }}>
        <td style={{ ...cel, paddingLeft: esTotal || esRes ? '10px' : '30px' }}>
          {clickeable ? (
            <button onClick={() => toggle(seccion!)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '10px', width: '9px' }}>{abierto[seccion!] ? '▾' : '▸'}</span>
              <span style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</span>
            </button>
          ) : (
            <span style={{
              fontWeight: esRes ? 700 : 400,
              fontSize: esRes ? '14px' : '13px',
            }}>
              {label}
              {cantidad && <span style={{ color: '#9ca3af', fontSize: '11.5px' }}> · {cantidad}</span>}
            </span>
          )}
        </td>
        <td style={{ ...celNum, fontWeight: esTotal || esRes ? 800 : 500, fontSize: esRes ? '15px' : '13px', color: esRes && monto < 0 ? '#dc2626' : '#111827' }}>
          {$(monto)}
        </td>
        <td style={{ ...celNum, fontSize: '12px', color: '#6b7280' }}>{fmtPeso(pesoPct(monto, act.ventas.total))}</td>
        <td style={{ ...celNum, fontSize: '12px', color: '#9ca3af' }}>{$(anterior)}</td>
        <td style={{ ...celNum, fontSize: '12px' }}><Delta monto={monto} anterior={anterior} invertido={invertido} /></td>
      </tr>
    );
  }

  const varVentas = ant.ventas.total > 0 ? ((act.ventas.total - ant.ventas.total) / ant.ventas.total) * 100 : null;

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
        <thead>
          <tr style={{ background: '#fafaf9' }}>
            {['Concepto', nombre, '% s/ventas', nombrePrev, 'Δ p.p. s/ventas'].map((h, i) => (
              <th key={h} style={{
                ...cel, textAlign: i === 0 ? 'left' : 'right', fontSize: '11px',
                color: i === 3 || i === 4 ? '#9ca3af' : '#6b7280',
                textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Ventas: acá el delta en puntos sobre sí mismas siempre daría cero, así que la
              última columna muestra cuánto cambió la venta en plata. */}
          <tr style={{ borderTop: '1px solid #e5e7eb' }}>
            <td style={cel}>
              <button onClick={() => toggle('ventas')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#9ca3af', fontSize: '10px', width: '9px' }}>{abierto.ventas ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Ventas</span>
              </button>
            </td>
            <td style={{ ...celNum, fontWeight: 800 }}>{$(act.ventas.total)}</td>
            <td style={{ ...celNum, fontSize: '12px', color: '#6b7280' }}>100,0%</td>
            <td style={{ ...celNum, fontSize: '12px', color: '#9ca3af' }}>{$(ant.ventas.total)}</td>
            <td style={{ ...celNum, fontSize: '12px', fontWeight: 700, color: varVentas === null ? '#d1d5db' : varVentas >= 0 ? '#059669' : '#dc2626' }}>
              {varVentas === null ? '—' : `${varVentas > 0 ? '+' : ''}${Math.round(varVentas)}%`}
            </td>
          </tr>
          {abierto.ventas && act.ventas.porCultivo.map((c) => (
            <Fila key={c.label} label={c.label} monto={c.monto} anterior={montoAnt(c.label, ant.ventas.porCultivo)}
              nivel="detalle" invertido cantidad={`${Math.round(c.unidades).toLocaleString('es-AR')} u`} />
          ))}

          <Fila label="Costo variable" monto={act.costoVariable.total} anterior={ant.costoVariable.total} nivel="total" seccion="variable" />
          {abierto.variable && act.costoVariable.lineas.map((l) => (
            <Fila key={l.label} label={l.label} monto={l.monto} anterior={montoAnt(l.label, ant.costoVariable.lineas)} nivel="detalle" />
          ))}

          <Fila label="Costos fijos" monto={act.costosFijos.total} anterior={ant.costosFijos.total} nivel="total" seccion="fijos" />
          {abierto.fijos && act.costosFijos.lineas.map((l) => (
            <Fila key={l.label} label={l.label} monto={l.monto} anterior={montoAnt(l.label, ant.costosFijos.lineas)} nivel="detalle" />
          ))}

          <Fila label="Resultado final" monto={act.resultado} anterior={ant.resultado} nivel="resultado" invertido />
          <Fila label="Resultado sin inversión" monto={act.resultadoSinInversion} anterior={ant.resultadoSinInversion} nivel="resultado" invertido />
        </tbody>
      </table>
      <p style={{ margin: 0, padding: '8px 10px', fontSize: '11px', color: '#9ca3af', borderTop: '1px solid #f3f4f6' }}>
        La última columna es cuánto cambió el <strong>peso sobre las ventas</strong>, en puntos porcentuales: si semillas pesaba 5% y ahora pesa 4%, dice −1,0 p.p. en verde.
        En Ventas muestra la variación en plata. El <strong>resultado sin inversión</strong> es el resultado devolviéndole lo gastado en equipamiento ({$(act.inversion)} este mes).
      </p>
    </div>
  );
}
