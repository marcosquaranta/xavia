'use client';
import { useState, useEffect, useRef } from 'react';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';

// Nombres exactos Xubio
const PRODS = [
  { key: 'rucula',         xubio: 'Rucula Hidropónica',                   label: 'Rúcula',       color: '#166534' },
  { key: 'lechuga_crespa', xubio: 'Lechuga Crespa Hidropónica',           label: 'Crespa',       color: '#4d7c0f' },
  { key: 'hoja_roble',     xubio: 'Lechuga Hoja de Roble Verde Hidropónica', label: 'Hoja Roble', color: '#65a30d' },
  { key: 'bandeja_rucula', xubio: 'Rucula Bandeja',                       label: 'Bandeja',      color: '#14532d' },
  { key: 'albahaca',       xubio: 'Albahaca Hidropónica',                 label: 'Albahaca',     color: '#047857' },
] as const;
type ProdKey = typeof PRODS[number]['key'];

interface Fila {
  id_control: string; nombre_cliente: string; sucursal: string;
  nombre_display: string; tipo: string;
}

function buildFilas(clientes: ClienteVenta[]): Fila[] {
  const out: Fila[] = [];
  for (const c of clientes) {
    if (c.activo !== 'SI') continue;
    const sucs = c.sucursales ? c.sucursales.split('|').map(s => s.trim()).filter(Boolean) : [];
    if (!sucs.length) {
      out.push({ id_control: c.id_control, nombre_cliente: c.nombre_xubio, sucursal: c.nombre_xubio, nombre_display: c.nombre_display, tipo: c.tipo_factura });
    } else {
      for (const s of sucs) {
        const sufijo = s.split(' ').slice(-1)[0];
        out.push({ id_control: c.id_control, nombre_cliente: c.nombre_xubio, sucursal: s, nombre_display: `${c.nombre_display} · ${sufijo}`, tipo: c.tipo_factura });
      }
    }
  }
  return out;
}

type Cantidades = Record<string, Record<ProdKey, string>>;
type EstadoCelda = Record<string, Record<ProdKey, 'idle' | 'saving' | 'saved' | 'error'>>;

export default function VentasManager({ clientes, precios, frecuencias }: {
  clientes: ClienteVenta[]; precios: PrecioVenta[]; frecuencias: Record<string, number>;
}) {
  const hoy = new Date().toISOString().split('T')[0];
  const [fecha, setFecha] = useState(hoy);
  const [fechaFactura, setFechaFactura] = useState(hoy);
  const [fechasCliente, setFechasCliente] = useState<Record<string, string>>({});
  const [cantidades, setCantidades] = useState<Cantidades>({});
  const [estados, setEstados] = useState<EstadoCelda>({});
  const [loadingFecha, setLoadingFecha] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msgExport, setMsgExport] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [editPrecios, setEditPrecios] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const filas: Fila[] = buildFilas(clientes).sort(
    (a, b) => (frecuencias[b.id_control] || 0) - (frecuencias[a.id_control] || 0)
  );

  // Buscar precio por id_control + sucursal
  function getPrecio(id_control: string, sucursal: string, prod: ProdKey): number {
    const row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
    if (!row) return 0;
    return Number((row as any)[prod] || 0);
  }

  useEffect(() => {
    setLoadingFecha(true); setMsgExport(null);
    fetch(`/api/ventas/fecha?fecha=${fecha}`)
      .then(r => r.json())
      .then((data: VentaDia[]) => {
        const c: Cantidades = {};
        for (const v of data) {
          const k = `${v.id_control}__${v.sucursal}`;
          c[k] = {
            rucula:         String(v.rucula         || ''),
            lechuga_crespa: String(v.lechuga_crespa || ''),
            hoja_roble:     String(v.hoja_roble     || ''),
            bandeja_rucula: String(v.bandeja_rucula || ''),
            albahaca:       String(v.albahaca       || ''),
          };
        }
        setCantidades(c); setEstados({});
      }).catch(() => {}).finally(() => setLoadingFecha(false));
  }, [fecha]);

  function getQty(id_control: string, sucursal: string, prod: ProdKey): string {
    return cantidades[`${id_control}__${sucursal}`]?.[prod] || '';
  }
  function getEst(id_control: string, sucursal: string, prod: ProdKey) {
    return estados[`${id_control}__${sucursal}`]?.[prod] || 'idle';
  }
  function setEst(id_control: string, sucursal: string, prod: ProdKey, est: 'idle'|'saving'|'saved'|'error') {
    const k = `${id_control}__${sucursal}`;
    setEstados(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [prod]: est } as any }));
  }

  function handleChange(f: Fila, prod: ProdKey, val: string) {
    const k = `${f.id_control}__${f.sucursal}`;
    setCantidades(prev => ({ ...prev, [k]: { ...(prev[k] || { rucula:'', lechuga_crespa:'', hoja_roble:'', bandeja_rucula:'', albahaca:'' }), [prod]: val } }));
    setEst(f.id_control, f.sucursal, prod, 'idle');
  }

  function handleBlur(f: Fila, prod: ProdKey) {
    const tk = `${f.id_control}__${f.sucursal}__${prod}`;
    clearTimeout(saveTimers.current[tk]);
    saveTimers.current[tk] = setTimeout(() => guardarFila(f, prod), 400);
  }

  async function guardarFila(f: Fila, prod: ProdKey) {
    const qty = getQty(f.id_control, f.sucursal, prod);
    if (qty === '') return;
    setEst(f.id_control, f.sucursal, prod, 'saving');
    try {
      const res = await fetch('/api/ventas/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, lineas: [{
          id_control: f.id_control, nombre_cliente: f.nombre_cliente, sucursal: f.sucursal,
          rucula:         Number(getQty(f.id_control, f.sucursal, 'rucula'))         || 0,
          lechuga_crespa: Number(getQty(f.id_control, f.sucursal, 'lechuga_crespa')) || 0,
          hoja_roble:     Number(getQty(f.id_control, f.sucursal, 'hoja_roble'))     || 0,
          bandeja_rucula: Number(getQty(f.id_control, f.sucursal, 'bandeja_rucula')) || 0,
          albahaca:       Number(getQty(f.id_control, f.sucursal, 'albahaca'))       || 0,
        }] }),
      });
      if (!res.ok) throw new Error();
      setEst(f.id_control, f.sucursal, prod, 'saved');
      setTimeout(() => setEst(f.id_control, f.sucursal, prod, 'idle'), 2000);
    } catch { setEst(f.id_control, f.sucursal, prod, 'error'); }
  }

  function totalFila(f: Fila): number {
    return PRODS.reduce((acc, p) => {
      const q = Number(getQty(f.id_control, f.sucursal, p.key)) || 0;
      return acc + q * getPrecio(f.id_control, f.sucursal, p.key);
    }, 0);
  }

  async function exportar() {
    setExporting(true); setMsgExport(null);
    try {
      const res = await fetch('/api/ventas/exportar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, fechaFactura, fechasCliente }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const bytes = Uint8Array.from(atob(j.file), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = j.filename; a.click();
      URL.revokeObjectURL(url);
      setMsgExport({ type: 'ok', text: `${j.facturas} facturas generadas · A hasta ${j.lastA} · B hasta ${j.lastB}${j.emailOk ? ' · Email enviado ✓' : ''}` });
      setCantidades({}); setEstados({}); setFechasCliente({});
    } catch (e: any) { setMsgExport({ type: 'error', text: e.message }); }
    setExporting(false);
  }

  const hayVentas = Object.values(cantidades).some(c => Object.values(c).some(v => Number(v) > 0));

  return (
    <div>
      {/* Fecha de venta + exportar */}
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Fecha de venta</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ fontSize: '15px', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: '8px', padding: '7px 12px' }} />
        </div>
        <button onClick={exportar} disabled={exporting || !hayVentas}
          style={{ background: hayVentas ? '#1d4ed8' : '#e5e7eb', color: hayVentas ? 'white' : '#9ca3af', border: 'none', borderRadius: '8px', padding: '10px 22px', fontWeight: 700, fontSize: '14px', cursor: hayVentas && !exporting ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '18px' }}>📤</span>{exporting ? 'Generando…' : 'Exportar Xubio'}
        </button>
      </div>

      {/* Fecha de facturación general */}
      <div style={{ background: '#fffbeb', border: '1px solid #fde047', borderRadius: '8px', padding: '9px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>📅 Fecha de facturación</span>
        <input type="date" value={fechaFactura} onChange={e => setFechaFactura(e.target.value)}
          style={{ fontSize: '13px', fontWeight: 600, border: '1px solid #fde047', borderRadius: '6px', padding: '3px 8px', color: '#713f12' }} />
        <span style={{ fontSize: '11px', color: '#92400e' }}>Podés cambiarla por cliente en la tabla ↓</span>
      </div>

      {msgExport && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', background: msgExport.type === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msgExport.type === 'ok' ? '#86efac' : '#fca5a5'}`, color: msgExport.type === 'ok' ? '#166534' : '#dc2626' }}>
          {msgExport.text}
        </div>
      )}

      {loadingFecha ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>Cargando…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', minWidth: '170px' }}>Cliente</th>
                {PRODS.map(p => (
                  <th key={p.key} style={{ textAlign: 'center', padding: '10px 6px', color: p.color, fontWeight: 700, minWidth: '90px' }}>{p.label}</th>
                ))}
                <th style={{ textAlign: 'center', padding: '10px 8px', color: '#9ca3af', minWidth: '100px', fontSize: '11px' }}>Fecha fact.</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', color: '#9ca3af', minWidth: '90px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const total = totalFila(f);
                const tieneAlgo = total > 0 || PRODS.some(p => Number(getQty(f.id_control, f.sucursal, p.key)) > 0);
                return (
                  <tr key={`${f.id_control}__${f.sucursal}`}
                    style={{ background: tieneAlgo ? '#f0fdf4' : (i % 2 === 0 ? 'white' : '#fafafa'), borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 12px' }}>
                      <div style={{ fontWeight: tieneAlgo ? 600 : 400, color: '#111827' }}>{f.nombre_display}</div>
                      <span style={{ fontSize: '10px', background: f.tipo === 'A' ? '#dbeafe' : '#fef9c3', color: f.tipo === 'A' ? '#1e40af' : '#92400e', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>F{f.tipo}</span>
                    </td>
                    {PRODS.map(p => {
                      const est = getEst(f.id_control, f.sucursal, p.key);
                      const val = getQty(f.id_control, f.sucursal, p.key);
                      const precio = getPrecio(f.id_control, f.sucursal, p.key);
                      return (
                        <td key={p.key} style={{ padding: '3px 4px' }}>
                          <input type="number" min={0} value={val} placeholder="—"
                            onChange={e => handleChange(f, p.key, e.target.value)}
                            onBlur={() => handleBlur(f, p.key)}
                            title={precio > 0 ? `$${precio.toLocaleString('es-AR')} c/u` : 'Sin precio'}
                            style={{ width: '100%', textAlign: 'center', fontSize: '15px', fontWeight: 700,
                              border: `2px solid ${est === 'saving' ? '#fbbf24' : est === 'saved' ? '#86efac' : est === 'error' ? '#fca5a5' : Number(val) > 0 ? '#86efac' : '#e5e7eb'}`,
                              borderRadius: '6px', padding: '5px 4px',
                              background: Number(val) > 0 ? '#f0fdf4' : 'white',
                              color: Number(val) > 0 ? '#166534' : '#9ca3af',
                              outline: 'none', transition: 'border-color 0.15s',
                            }} />
                        </td>
                      );
                    })}
                    {/* Fecha individual */}
                    <td style={{ padding: '3px 6px' }}>
                      <input type="date"
                        value={fechasCliente[f.id_control] || fechaFactura}
                        onChange={e => setFechasCliente(prev => ({ ...prev, [f.id_control]: e.target.value }))}
                        style={{ width: '100%', fontSize: '11px',
                          border: `1px solid ${fechasCliente[f.id_control] && fechasCliente[f.id_control] !== fechaFactura ? '#fbbf24' : '#e5e7eb'}`,
                          borderRadius: '5px', padding: '4px 4px',
                          background: fechasCliente[f.id_control] && fechasCliente[f.id_control] !== fechaFactura ? '#fffbeb' : 'white',
                          color: fechasCliente[f.id_control] && fechasCliente[f.id_control] !== fechaFactura ? '#92400e' : '#9ca3af',
                        }} />
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px', fontWeight: 700, color: total > 0 ? '#059669' : '#d1d5db', fontSize: '13px' }}>
                      {total > 0 ? `$${total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Precios vigentes */}
      <div style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
        <button onClick={() => setEditPrecios(!editPrecios)}
          style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer', color: '#6b7280' }}>
          {editPrecios ? '▲ Ocultar precios' : '▼ Ver precios vigentes'}
        </button>
        {editPrecios && (
          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>Para modificar precios, editá la hoja <strong>Precios</strong> en Google Sheets. Se actualizan automáticamente.</p>
            <table style={{ fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ textAlign: 'left', padding: '6px 10px' }}>Cliente / Sucursal</th>
                  {PRODS.map(p => <th key={p.key} style={{ textAlign: 'right', padding: '6px 10px', color: p.color }}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {precios.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>{p.sucursal_obs}</td>
                    {PRODS.map(prod => (
                      <td key={prod.key} style={{ textAlign: 'right', padding: '5px 10px', color: Number((p as any)[prod.key]) > 0 ? '#374151' : '#d1d5db' }}>
                        {Number((p as any)[prod.key]) > 0 ? `$${Number((p as any)[prod.key]).toLocaleString('es-AR')}` : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
