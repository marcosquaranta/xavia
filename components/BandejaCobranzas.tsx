'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sugerirCombinaciones, toleranciaDe } from '@/lib/conciliacionCobro';

interface ItemUI {
  id_item: string;
  fecha: string;
  importe: number;
  descripcion: string;
  id_control: string;
  cliente: string;
  nota: string;
}
interface ClienteOpt { id_control: string; nombre: string }
interface FacturaCliente { numero: string; fecha: string; importe: number; yaCobrada: boolean }

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };

// Una fila de la bandeja: un movimiento que entró y todavía no se imputó. Se resuelve
// entera acá adentro —cliente, facturas, cuenta— sin salir a otra pantalla, porque el
// trabajo real es ir una por una y cualquier salto extra se paga por cada movimiento.
function Fila({ item, clientes, cuentas, onListo }: {
  item: ItemUI; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
  onListo: (msg: string) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [idControl, setIdControl] = useState(item.id_control || '');
  const [cuentaId, setCuentaId] = useState(cuentas.length ? String(cuentas[0].id) : '');
  const [facturas, setFacturas] = useState<FacturaCliente[]>([]);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function traerFacturas(id: string) {
    setFacturas([]); setElegidas([]);
    if (!id) return;
    setCargandoFacturas(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (r.ok) setFacturas(j.facturas || []);
    } catch { /* si no se pueden traer, se confirma igual sin marcar facturas */ }
    setCargandoFacturas(false);
  }

  async function abrir() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && idControl && !facturas.length) await traerFacturas(idControl);
  }

  // Qué facturas dan ese importe. Es el mismo motor que la carga manual de cobros: acá el
  // importe ya está fijo (lo dice el banco), así que la pregunta es solo qué cancela.
  const sugerencias = useMemo(
    () => (facturas.length ? sugerirCombinaciones(facturas, item.importe) : []),
    [facturas, item.importe],
  );

  async function accion(accion: 'confirmar' | 'descartar') {
    if (accion === 'confirmar') {
      if (!idControl) { setErr('Elegí de qué cliente es.'); return; }
      if (!cuentaId) { setErr('Elegí en qué cuenta entró.'); return; }
      const nombre = clientes.find(c => c.id_control === idControl)?.nombre || '';
      if (!window.confirm(`Se va a registrar en Xubio un cobro de ${fmt$(item.importe)} de ${nombre}, con fecha ${fmtDia(item.fecha)}.\n\nEsto impacta en la contabilidad. ¿Confirmás?`)) return;
    } else {
      if (!window.confirm('Se va a descartar este movimiento: no se registra ningún cobro y no vuelve a aparecer en la bandeja. ¿Confirmás?')) return;
    }
    setTrabajando(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_item: item.id_item, accion,
          id_control: idControl, cuentaId: Number(cuentaId), comprobantes: elegidas,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      onListo(accion === 'confirmar'
        ? `✓ Cobro registrado${j.numeroRecibo ? ` — recibo ${j.numeroRecibo}` : ''}${j.aliasAprendido ? `. Aprendí que "${j.aliasAprendido}" es ese cliente.` : ''}`
        : '✓ Movimiento descartado.');
      router.refresh();
    } catch (e: any) { setErr(e.message); setTrabajando(false); }
  }

  const reconocido = !!item.id_control;
  return (
    <div style={{ border: '1px solid #e5e7eb', borderLeft: `4px solid ${reconocido ? '#16a34a' : '#d97706'}`, borderRadius: '7px', marginBottom: '7px', background: 'white' }}>
      <div onClick={abrir} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 11px', cursor: 'pointer' }}>
        <span style={{ fontSize: '12px', color: '#6b7280', minWidth: '42px', fontVariantNumeric: 'tabular-nums' }}>{fmtDia(item.fecha)}</span>
        <span style={{ fontSize: '15px', fontWeight: 800, minWidth: '110px' }}>{fmt$(item.importe)}</span>
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: reconocido ? '#166534' : '#b45309' }}>
          {reconocido ? item.cliente : 'sin reconocer'}
        </span>
        <span style={{ fontSize: '11px', color: '#9ca3af', flex: 1, minWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.descripcion}
        </span>
        <span style={{ fontSize: '11px', color: '#9ca3af' }}>{abierto ? '▲' : '▼'}</span>
      </div>

      {abierto && (
        <div style={{ padding: '0 11px 11px', borderTop: '1px solid #f3f4f6' }}>
          <p style={{ margin: '8px 0 6px', fontSize: '11px', color: '#6b7280', lineHeight: 1.5 }}>
            <strong>Dice el banco:</strong> {item.descripcion}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>¿De qué cliente es?</label>
              <select value={idControl} disabled={trabajando} style={inputStyle}
                onChange={e => { setIdControl(e.target.value); traerFacturas(e.target.value); }}>
                <option value="">— Elegir —</option>
                {clientes.map(c => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>¿Dónde entró?</label>
              <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} disabled={trabajando} style={inputStyle}>
                <option value="">— Elegir cuenta —</option>
                {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>

          {cargandoFacturas && <p style={{ margin: 0, fontSize: '11.5px', color: '#6b7280' }}>Buscando facturas…</p>}

          {sugerencias.length > 0 && (
            <div style={{ background: '#f5f8ff', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '7px 9px', marginBottom: '8px' }}>
              <p style={{ margin: '0 0 5px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>
                Este importe podría estar pagando:
              </p>
              {sugerencias.map((sg, i) => (
                <button key={i} type="button" onClick={() => setElegidas(sg.numeros)} disabled={trabajando}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%', textAlign: 'left',
                    cursor: 'pointer', fontSize: '11.5px', padding: '4px 7px', marginBottom: '4px',
                    background: 'white', border: '1px solid #dbe4fb', borderRadius: '5px' }}>
                  <span style={{ fontWeight: 700 }}>{sg.numeros.length === 1 ? '1 factura' : `${sg.numeros.length} facturas`}</span>
                  {sg.consecutivas && <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#ede9fe', color: '#5b21b6' }}>seguidas</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: '10.5px', color: '#1d4ed8' }}>{sg.numeros.join(' + ')}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px',
                    background: sg.exacta ? '#dcfce7' : '#fef3c7', color: sg.exacta ? '#166534' : '#92400e' }}>
                    {sg.exacta ? 'exacto' : `${sg.diferencia > 0 ? '+' : '−'}${fmt$(Math.abs(sg.diferencia))}`}
                  </span>
                </button>
              ))}
              <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#6b7280' }}>
                Tolerancia {fmt$(toleranciaDe(item.importe))}, por retenciones o redondeos.
              </p>
            </div>
          )}

          {idControl && !cargandoFacturas && !facturas.length && (
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#b45309' }}>
              Ese cliente no tiene facturas de los últimos 120 días. Se puede registrar igual: entra como cobro a cuenta.
            </p>
          )}

          {elegidas.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>
              Cancela: {elegidas.join(', ')}
            </p>
          )}

          {err && <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#dc2626' }}>{err}</p>}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => accion('confirmar')} disabled={trabajando}
              style={{ fontSize: '11.5px', padding: '6px 14px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
              {trabajando ? 'Registrando…' : 'Confirmar y registrar en Xubio'}
            </button>
            <button onClick={() => accion('descartar')} disabled={trabajando}
              style={{ fontSize: '11.5px', padding: '6px 12px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
              No es un cobro — descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BandejaCobranzas({ items, clientes, cuentas }: {
  items: ItemUI[]; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
}) {
  const router = useRouter();
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function importar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a subir el mismo archivo si hizo falta corregirlo
    if (!file) return;
    setImportando(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const r = await fetch('/api/cobranzas/bandeja', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error al importar');
      const partes = [`${j.nuevos} ${j.nuevos === 1 ? 'movimiento nuevo' : 'movimientos nuevos'}`];
      if (j.reconocidos) partes.push(`${j.reconocidos} con cliente reconocido`);
      if (j.repetidos) partes.push(`${j.repetidos} ya estaban`);
      if (j.salidas) partes.push(`${j.salidas} salidas ignoradas`);
      setMsg(`✓ ${partes.join(' · ')}.`);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setImportando(false); }
  }

  const total = items.reduce((a, i) => a + i.importe, 0);
  const sinReconocer = items.filter(i => !i.id_control).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <label style={{ fontSize: '11.5px', padding: '6px 14px', background: '#1e40af', color: 'white', borderRadius: '5px', cursor: importando ? 'default' : 'pointer', fontWeight: 700, opacity: importando ? 0.6 : 1 }}>
          {importando ? 'Leyendo…' : '📄 Subir resumen bancario'}
          <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={importar} disabled={importando} style={{ display: 'none' }} />
        </label>
        <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
          CSV o Excel. Solo lee: deja los movimientos de entrada acá para confirmar uno por uno.
        </span>
      </div>

      {msg && <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '7px 10px' }}>{msg}</p>}
      {err && <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '7px 10px' }}>{err}</p>}

      {items.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '13px', padding: '18px', textAlign: 'center' }}>
          No hay movimientos pendientes de imputar. Subí el resumen del banco para empezar.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#374151' }}>
            <strong>{items.length}</strong> {items.length === 1 ? 'movimiento' : 'movimientos'} sin imputar por <strong>{fmt$(total)}</strong>
            {sinReconocer > 0 && <span style={{ color: '#b45309' }}> · {sinReconocer} sin reconocer al cliente</span>}
          </p>
          {items.map(i => (
            <Fila key={i.id_item} item={i} clientes={clientes} cuentas={cuentas}
              onListo={(m) => { setMsg(m); setErr(null); }} />
          ))}
        </>
      )}
    </div>
  );
}
