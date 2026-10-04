'use client';
import type { OrigenAplicacion, CausaDiferencia } from '@/lib/origenAplicacion';

// ── A dónde se fue el resultado del mes ──────────────────────────────────────────────
//
// Un resultado positivo y una caja que no creció es la situación normal, no un error, y
// hasta que no se ve el puente entre los dos se vive como "los números no cierran".
//
// Lo que no cierra entre la caja esperada y la real se muestra como tal. No se ajusta contra
// nada: una diferencia visible es un dato —casi siempre falta cargar un saldo o un cobro— y
// una diferencia escondida es un error que nadie va a encontrar.

const fmt = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-AR');

export default function OrigenAplicacionCard({ datos, causas = [], nombreMes }: { datos: OrigenAplicacion; causas?: CausaDiferencia[]; nombreMes: string }) {
  const { resultado, lineas, cajaEsperada, cajaReal, sinExplicar } = datos;

  return (
    <div className="card" style={{ marginBottom: '14px' }}>
      <p className="card-title">A dónde se fue el resultado — {nombreMes}</p>
      <p className="card-sub">
        El resultado del mes casi nunca está en la caja, y eso no es un error: se vendió y todavía no se cobró,
        se compró y todavía no se pagó, o quedó plata inmovilizada en el depósito.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '10px' }}>
        <tbody>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '7px 8px', fontWeight: 700 }}>Resultado del mes</td>
            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: resultado >= 0 ? '#059669' : '#dc2626' }}>
              {fmt(resultado)}
            </td>
          </tr>

          {lineas.map((l) => (
            <tr key={l.label} style={{ borderBottom: '1px solid #f9fafb' }}>
              <td style={{ padding: '5px 8px 5px 20px', color: '#374151' }}>
                {l.label}
                <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af' }}>{l.detalle}</span>
              </td>
              <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.monto >= 0 ? '#059669' : '#b45309' }}>
                {l.monto >= 0 ? '+' : ''}{fmt(l.monto)}
              </td>
            </tr>
          ))}

          <tr style={{ borderTop: '2px solid #e5e7eb' }}>
            <td style={{ padding: '7px 8px', fontWeight: 700 }}>Debería haber quedado en caja</td>
            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(cajaEsperada)}</td>
          </tr>

          {cajaReal === null ? (
            <tr>
              <td colSpan={2} style={{ padding: '7px 8px', fontSize: '12px', color: '#b45309' }}>
                No hay saldos cargados de los dos meses, así que no se puede contrastar contra la caja real.
                Se cargan en el bloque de cobranzas y saldos de más abajo.
              </td>
            </tr>
          ) : (
            <>
              <tr>
                <td style={{ padding: '7px 8px', fontWeight: 700 }}>Lo que de verdad se movió la caja</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(cajaReal)}</td>
              </tr>
              <tr style={{ background: Math.abs(sinExplicar || 0) > 1000 ? '#fffbeb' : '#f0fdf4' }}>
                <td style={{ padding: '7px 8px', fontWeight: 700, color: Math.abs(sinExplicar || 0) > 1000 ? '#92400e' : '#166534' }}>
                  Sin explicar
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: Math.abs(sinExplicar || 0) > 1000 ? '#92400e' : '#166534' }}>
                  {fmt(sinExplicar || 0)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {/* Las causas CALCULADAS, con nombre y monto. Enumerar causas posibles obliga a salir a
          buscar cuál; decir "Caja MQ: faltan $180.000" termina la búsqueda ahí mismo. */}
      {causas.length > 0 && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #f3f4f6', paddingTop: '8px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
            De dónde sale la diferencia
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <tbody>
              {causas.map((c, i) => (
                <tr key={`${c.cuenta}-${c.motivo}-${i}`} style={{ borderTop: '1px solid #f9fafb' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.cuenta}</td>
                  <td style={{ padding: '4px 8px', color: '#6b7280' }}>{c.detalle}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: c.monto === 0 ? '#9ca3af' : c.monto > 0 ? '#059669' : '#dc2626' }}>
                    {c.monto === 0 ? '—' : `${c.monto > 0 ? '+' : ''}${fmt(c.monto)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            const explicado = causas.reduce((a, c) => a + c.monto, 0);
            const resto = Math.round((sinExplicar || 0) - explicado);
            if (Math.abs(resto) < 1000) return null;
            // Lo que ni siquiera las cuentas explican. Casi siempre es un cobro o un gasto
            // que pasó por una caja que no se está siguiendo.
            return (
              <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#92400e' }}>
                Quedan <strong>{fmt(resto)}</strong> que ninguna cuenta explica: suele ser plata que entró o salió
                por un medio que no está en la lista de cuentas seguidas.
              </p>
            );
          })()}
        </div>
      )}

      {cajaReal !== null && Math.abs(sinExplicar || 0) > 1000 && causas.length === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#92400e', lineHeight: 1.5 }}>
          Todas las cuentas cuadran, así que la diferencia no está en los saldos: quedó un cobro o un gasto sin
          registrar, o pasó por un medio de pago que no se está siguiendo.
        </p>
      )}
    </div>
  );
}
