'use client';
import { useMemo, useState } from 'react';

// ── Las cobranzas del mes ────────────────────────────────────────────────────────────
//
// Hasta acá se podía ver qué falta cobrar, pero no lo que SÍ se cobró: para saber cuánto
// entró en septiembre y por dónde había que abrir Xubio. Esto son las cobranzas tal como
// están en Xubio —todas, no solo las que pasaron por la app— filtrables por medio de cobro
// y por cliente.
//
// Sale de la caché local (ver lib/xubioCache.ts), así que no cuesta nada mostrarlo.

export interface CobranzaUI {
  fecha: string;
  cliente: string;
  importe: number;
  cuenta: string;
  numero: string;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : f; };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function MovimientosCobranza({ cobranzas, anioActual, mesActual }: {
  cobranzas: CobranzaUI[];
  anioActual: number;
  mesActual: number;
}) {
  const [anio, setAnio] = useState(anioActual);
  const [mes, setMes] = useState(mesActual);
  const [cuenta, setCuenta] = useState('');
  const [cliente, setCliente] = useState('');

  const delMes = useMemo(() => {
    const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const finDia = new Date(anio, mes, 0).getDate();
    const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finDia).padStart(2, '0')}`;
    return cobranzas
      .filter((c) => c.fecha >= ini && c.fecha <= fin)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);
  }, [cobranzas, anio, mes]);

  // Las opciones salen de lo que hay EN EL MES, no de una lista fija: así no se ofrece
  // filtrar por una cuenta que ese mes no recibió nada y devuelve vacío sin explicación.
  const cuentas = useMemo(
    () => [...new Set(delMes.map((c) => c.cuenta).filter(Boolean))].sort(),
    [delMes],
  );
  const clientes = useMemo(
    () => [...new Set(delMes.map((c) => c.cliente).filter(Boolean))].sort(),
    [delMes],
  );

  const filtradas = useMemo(
    () => delMes.filter((c) => (!cuenta || c.cuenta === cuenta) && (!cliente || c.cliente === cliente)),
    [delMes, cuenta, cliente],
  );

  const total = filtradas.reduce((a, c) => a + c.importe, 0);

  // El total por cuenta siempre sobre el MES completo, no sobre lo filtrado: es lo que se
  // compara contra el extracto del banco, y filtrado por cliente no serviría para eso.
  const porCuenta = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of delMes) map.set(c.cuenta || 'sin cuenta', (map.get(c.cuenta || 'sin cuenta') || 0) + c.importe);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [delMes]);

  function mover(n: number) {
    let m = mes + n, a = anio;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    if (a > anioActual || (a === anioActual && m > mesActual)) return;
    setMes(m); setAnio(a); setCuenta(''); setCliente('');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(-1)}>← Anterior</button>
        <span style={{ fontWeight: 700, fontSize: '14px' }}>{MESES[mes - 1]} {anio}</span>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(1)}
          disabled={anio === anioActual && mes === mesActual}>Siguiente →</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}>
          <option value="">Todos los medios de cobro</option>
          {cuentas.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={cliente} onChange={(e) => setCliente(e.target.value)}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', maxWidth: '260px' }}>
          <option value="">Todos los clientes</option>
          {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(cuenta || cliente) && (
          <button type="button" onClick={() => { setCuenta(''); setCliente(''); }}
            style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Limpiar filtros</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '13.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {filtradas.length} {filtradas.length === 1 ? 'cobro' : 'cobros'} · {fmt$(total)}
        </span>
      </div>

      {delMes.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          No hay cobranzas de este mes en la copia local de Xubio. Si acabás de cargarlas, traé lo último con el
          botón de arriba.
        </p>
      ) : (
        <>
          {/* El total por cuenta primero: es el número que se compara contra el banco. */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {porCuenta.map(([c, v]) => (
              <button key={c} type="button" onClick={() => setCuenta(cuenta === c ? '' : c)}
                style={{
                  border: cuenta === c ? '2px solid #166534' : '1px solid #e5e7eb',
                  background: cuenta === c ? '#f0fdf4' : 'white',
                  borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                }}>
                <span style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>{c}</span>
                <strong style={{ fontSize: '14px' }}>{fmt$(v)}</strong>
              </button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '520px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11.5px' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Medio de cobro</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Recibo</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c, i) => (
                  <tr key={`${c.numero}-${i}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(c.fecha)}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{c.cliente}</td>
                    <td style={{ padding: '5px 8px', color: c.cuenta ? '#374151' : '#b45309' }}>{c.cuenta || 'sin dato'}</td>
                    <td style={{ padding: '5px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', color: '#9ca3af' }}>{c.numero}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt$(c.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {delMes.some((c) => !c.cuenta) && (
            <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#b45309' }}>
              Las que dicen "sin dato" se guardaron antes de que la copia local empezara a registrar el medio de
              cobro. Se completan solas la próxima vez que se traiga ese mes de Xubio.
            </p>
          )}
        </>
      )}
    </div>
  );
}
