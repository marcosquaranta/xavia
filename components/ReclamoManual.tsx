'use client';
import { useState } from 'react';

interface ClienteOpt { id_control: string; nombre: string }
interface Factura {
  numero: string; fecha: string; importe: number;
  yaCobrada: boolean; reclamadaEl: string;
  // Las otras tres formas de estar saldada. El endpoint las devolvía desde siempre y esta
  // pantalla las tiraba: una factura dada por saldada a mano, imputada a un cobro de Xubio o
  // cubierta por el reparto automático aparecía acá SIN NINGUNA MARCA, igual que una abierta.
  // O sea que el único lugar desde el que se manda un reclamo a mano era el único que no
  // sabía qué estaba cobrado.
  saldadaManual?: boolean;
  imputadaManual?: boolean;
  cubierta?: boolean;
  // La venta se corrigió después de facturar: `importe` es lo que hay que cobrar y esto es
  // lo que dice el comprobante. Ver lib/ajusteFactura.ts.
  importeFactura?: number;
  ajustada?: boolean;
}

// Una factura está abierta si NINGUNO de los cuatro caminos la da por saldada. Es el mismo
// criterio que usa el resumen de impagas y el que decide a quién se le reclama por mail: si
// acá fuera otro, esta pantalla reclamaría cosas que las otras dan por cobradas.
const estaAbierta = (f: Factura) => !f.yaCobrada && !f.saldadaManual && !f.imputadaManual && !f.cubierta;

const MARCA: { test: (f: Factura) => boolean; texto: string; titulo: string }[] = [
  { test: (f) => !!f.yaCobrada, texto: 'cobrada', titulo: 'Entró en un cobro registrado desde la app' },
  { test: (f) => !!f.imputadaManual, texto: 'imputada', titulo: 'Alguien la relacionó a mano con un cobro de Xubio' },
  { test: (f) => !!f.saldadaManual, texto: 'saldada a mano', titulo: 'Alguien la dio por saldada, sin movimiento en Xubio' },
  { test: (f) => !!f.cubierta, texto: 'cubierta', titulo: 'Nadie lo dijo: la app la da por cubierta repartiendo los cobros del cliente de la más vieja a la más nueva' },
];

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : '—'; };
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const diasDesde = (f: string) => Math.round((Date.now() - new Date(f + 'T12:00:00').getTime()) / 86400000);

// Reclamo puntual, aparte del automático. La idea es no tener que tocar la configuración
// de las alertas semanales para mandar algo una sola vez: se elige el cliente, se marca
// desde qué fecha (o se tildan las facturas una por una) y se manda.
export default function ReclamoManual({ clientes }: { clientes: ClienteOpt[] }) {
  const [cliente, setCliente] = useState('');
  const [facturas, setFacturas] = useState<Factura[]>([]);
  // Cuánto cobró este cliente en la ventana. Es lo que se reparte de la factura más vieja a
  // la más nueva para decidir cuáles quedan cubiertas: sin verlo, "esta figura cobrada" es
  // un veredicto sin fundamento y no hay con qué discutirlo.
  const [cobrado, setCobrado] = useState(0);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [desde, setDesde] = useState('');
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function cambiarCliente(id: string) {
    setCliente(id); setFacturas([]); setElegidas([]); setDesde(''); setMsg(null);
    if (!id) return;
    setCargando(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudieron traer las facturas');
      setFacturas(j.facturas || []);
      setCobrado(Number(j.cobradoTotal) || 0);
      if (!(j.facturas || []).length) setMsg({ t: 'err', s: 'Ese cliente no tiene facturas en los últimos 365 días.' });
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'No se pudieron traer las facturas' });
    }
    setCargando(false);
  }

  // "Desde esta fecha en adelante": tilda de una todas las facturas de esa fecha o
  // posteriores. Es el caso que se quiere el 90% de las veces; después se puede destildar
  // alguna suelta si hace falta.
  // Tildar en lote agarra SOLO las abiertas. Marcar una saldada se puede, a mano y a
  // propósito; lo que no puede pasar es que entre sola en un reclamo porque alguien apretó
  // "desde esta fecha".
  function aplicarDesde(fecha: string) {
    setDesde(fecha);
    if (!fecha) { setElegidas([]); return; }
    setElegidas(facturas.filter((f) => f.fecha >= fecha && estaAbierta(f)).map((f) => f.numero));
  }

  function toggle(numero: string) {
    setElegidas((p) => p.includes(numero) ? p.filter((n) => n !== numero) : [...p, numero]);
  }

  const seleccionadas = facturas.filter((f) => elegidas.includes(f.numero));
  const total = seleccionadas.reduce((a, f) => a + f.importe, 0);
  const yaReclamadas = seleccionadas.filter((f) => f.reclamadaEl).length;
  // Cualquiera de los cuatro caminos cuenta: reclamarle a un cliente una factura que ya
  // pagó es lo que más rápido quema la confianza en el recordatorio, y da igual por cuál de
  // los cuatro figure saldada.
  const yaCobradas = seleccionadas.filter((f) => !estaAbierta(f)).length;
  const abiertas = facturas.filter(estaAbierta);
  const nombreCliente = clientes.find((c) => c.id_control === cliente)?.nombre || '';

  async function enviar() {
    if (!seleccionadas.length) { setMsg({ t: 'err', s: 'Elegí al menos una factura.' }); return; }
    const aviso = `Se le va a mandar un reclamo a ${nombreCliente} AHORA.\n\n`
      + `${seleccionadas.length} comprobante(s) · ${fmt$(total)}\n`
      + `${seleccionadas.slice(0, 6).map((f) => `  ${f.numero} · ${fmtDia(f.fecha)} · ${fmt$(f.importe)}`).join('\n')}`
      + (seleccionadas.length > 6 ? `\n  …y ${seleccionadas.length - 6} más` : '')
      + (yaCobradas > 0 ? `\n\nOJO: ${yaCobradas} ya figura(n) saldada(s) en la app.` : '')
      + (yaReclamadas > 0 ? `\n\n${yaReclamadas} ya se había(n) reclamado antes.` : '')
      + (seleccionadas.some((f) => f.ajustada)
        ? '\n\nOJO: hay facturas corregidas después de emitidas. Se reclama el importe corregido, que NO es el que dice la factura en Xubio.'
        : '')
      + '\n\nEl mail sale al cliente con copia a administración. ¿Confirmás?';
    if (!confirm(aviso)) return;

    setEnviando(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/reclamo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: cliente, facturas: seleccionadas.map((f) => ({ numero: f.numero, fecha: f.fecha, importe: f.importe })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo enviar');
      setMsg({ t: 'ok', s: `✓ Reclamo enviado a ${j.enviadoA} — ${j.cantidad} comprobante(s) por ${fmt$(j.total || total)}` });
      // Se recargan las facturas para que queden marcadas como reclamadas recién ahora.
      await cambiarCliente(cliente);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'No se pudo enviar' });
    }
    setEnviando(false);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '8px' }}>
        <div>
          <label style={labelStyle}>Cliente *</label>
          <select value={cliente} onChange={(e) => cambiarCliente(e.target.value)} disabled={enviando} style={inputStyle}>
            <option value="">— Elegir —</option>
            {clientes.map((c) => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Reclamar desde esta fecha</label>
          <input type="date" value={desde} onChange={(e) => aplicarDesde(e.target.value)} disabled={enviando || !facturas.length} style={inputStyle} />
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Tilda todas las facturas de esa fecha en adelante</span>
        </div>
      </div>

      {cargando && <p style={{ margin: '10px 0 0', fontSize: '11.5px', color: '#6b7280' }}>Buscando facturas…</p>}

      {facturas.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151' }}>Facturas de {nombreCliente}</span>
            <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
              últimos 365 días · <strong style={{ color: abiertas.length ? '#b45309' : '#059669' }}>{abiertas.length} abierta{abiertas.length === 1 ? '' : 's'}</strong> de {facturas.length}
            </span>
            {cobrado > 0 && (
              <span style={{ fontSize: '10.5px', color: '#9ca3af' }}
                title="Los cobros de este cliente en la ventana se imputan de la factura más vieja a la más nueva: hasta ahí llegan las que figuran cubiertas.">
                · cobró ${Math.round(cobrado).toLocaleString('es-AR')} en el período
              </span>
            )}
            <button onClick={() => { setElegidas(facturas.filter(estaAbierta).map((f) => f.numero)); setDesde(''); }} disabled={enviando}
              style={{ fontSize: '10.5px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
              tildar las abiertas
            </button>
            <button onClick={() => { setElegidas([]); setDesde(''); }} disabled={enviando}
              style={{ fontSize: '10.5px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 0 }}>
              limpiar
            </button>
            {elegidas.length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                {elegidas.length} tildada{elegidas.length > 1 ? 's' : ''} · {fmt$(total)}
              </span>
            )}
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
            {facturas.map((f) => {
              const tildada = elegidas.includes(f.numero);
              return (
                <label key={f.numero}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 9px',
                    borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: '12px',
                    background: tildada ? '#f0fdf4' : 'white',
                    color: estaAbierta(f) ? undefined : '#9ca3af',
                  }}>
                  <input type="checkbox" checked={tildada} disabled={enviando} onChange={() => toggle(f.numero)} />
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1d4ed8', minWidth: '132px' }}>{f.numero}</span>
                  <span style={{ color: '#6b7280', minWidth: '78px' }}>{fmtDia(f.fecha)}</span>
                  <span style={{ color: '#9ca3af', fontSize: '10.5px', minWidth: '46px' }}>{diasDesde(f.fecha)}d</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt$(f.importe)}</span>
                  {f.ajustada && f.importeFactura !== undefined && (
                    <span title={`La venta se corrigió después de facturar. La factura dice ${fmt$(f.importeFactura)} y en Xubio sigue así; lo que se reclama es el importe corregido.`}
                      style={{ fontSize: '9.5px', background: '#fffbeb', color: '#92400e', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      corregida · factura {fmt$(f.importeFactura)}
                    </span>
                  )}
                  {f.reclamadaEl && (
                    <span title={`Se reclamó el ${fmtDia(f.reclamadaEl)}`} style={{ fontSize: '9.5px', background: '#fffbeb', color: '#92400e', padding: '1px 6px', borderRadius: '8px', fontWeight: 700 }}>
                      reclamada {fmtDia(f.reclamadaEl).slice(0, 5)}
                    </span>
                  )}
                  {MARCA.filter((m) => m.test(f)).map((m) => (
                    <span key={m.texto} title={m.titulo}
                      style={{ fontSize: '9.5px', background: '#f0fdf4', color: '#166534', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {m.texto}
                    </span>
                  ))}
                </label>
              );
            })}
          </div>

          {yaCobradas > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>
              ⚠ {yaCobradas} de las tildadas ya figura{yaCobradas === 1 ? '' : 'n'} saldada{yaCobradas === 1 ? '' : 's'} en la app
              (cobrada, imputada, dada por saldada a mano o cubierta por los cobros del cliente). Si mandás el reclamo
              igual, le estás reclamando algo que para la app ya está pago.
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={enviar} disabled={enviando || !elegidas.length}
              style={{
                fontSize: '11.5px', padding: '6px 14px', background: elegidas.length ? '#b45309' : '#e5e7eb',
                color: elegidas.length ? 'white' : '#9ca3af', border: 'none', borderRadius: '5px',
                cursor: elegidas.length ? 'pointer' : 'default', fontWeight: 700,
              }}>
              {enviando ? 'Enviando…' : `Enviar reclamo${elegidas.length ? ` (${elegidas.length})` : ''}`}
            </button>
            <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
              Va al cliente con copia a administración. No toca la configuración del recordatorio automático.
            </span>
          </div>
        </div>
      )}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
    </div>
  );
}
