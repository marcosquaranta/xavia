'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FacturaCliente } from '@/lib/facturasCliente';

// ── Limpiar facturas viejas que ya no hay que perseguir ──────────────────────────────
//
// Xubio no dice si una factura está paga, así que la app deduce "pendiente" restando
// cobrado de facturado. Esa resta arrastra para siempre lo que se cobró por fuera —un
// cheque, una compensación, un cobro cargado a mano hace dos años— y esas facturas siguen
// apareciendo al imputar y siguen saliendo en los reclamos.
//
// Esta pantalla las da por saldadas SIN tocar la contabilidad. La alternativa fácil sería
// registrar un cobro por el importe para que desaparezcan, y es mucho peor: mete en Xubio
// plata que nunca entró.

export interface ClienteFacturas { id_control: string; nombre: string }

export interface SaldadaUI {
  numero: string; cliente: string; importe: number;
  fecha_marcado: string; motivo: string; usuario: string;
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}/${String(y).slice(2)}` : '—';
};
const diasDesde = (f: string) => {
  const t = new Date(String(f) + 'T12:00:00').getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400000) : 0;
};

export default function FacturasViejas({
  clientes, facturasPorCliente, saldadas,
}: {
  clientes: ClienteFacturas[];
  facturasPorCliente: Record<string, FacturaCliente[]>;
  saldadas: SaldadaUI[];
}) {
  const router = useRouter();
  const [idControl, setIdControl] = useState('');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verMarcadas, setVerMarcadas] = useState(false);
  // Por defecto solo lo abierto, que es para lo que existe la pantalla. Pero se puede ver
  // todo: si una factura que se cobró desde la app igual aparece como abierta, lo único que
  // lo delata es verlas juntas con su estado al lado.
  const [verTodas, setVerTodas] = useState(false);

  // Solo lo que sigue abierto: lo ya imputado por la app no se ofrece, y lo ya marcado a
  // mano tampoco (se ve abajo, con su motivo). De la más vieja a la más nueva, porque son
  // justamente las viejas las que hay que limpiar.
  const todas = useMemo(() => {
    return (facturasPorCliente[idControl] || [])
      .slice()
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [facturasPorCliente, idControl]);

  const abiertas = useMemo(() => todas.filter((f) => !f.yaCobrada && !f.saldadaManual && !f.cubierta), [todas]);
  const visibles = verTodas ? todas : abiertas;
  // Solo se puede tildar lo que sigue abierto: marcar como saldada una que ya se cobró no
  // cambia nada y ensucia el registro con una decisión que nadie tomó.
  const todasTildadas = abiertas.length > 0 && abiertas.every((f) => elegidas.has(f.numero));

  const totalElegido = abiertas.filter((f) => elegidas.has(f.numero)).reduce((a, f) => a + f.importe, 0);
  const nombreCliente = clientes.find((c) => String(c.id_control) === idControl)?.nombre || '';
  const listo = elegidas.size > 0 && motivo.trim().length > 0 && !guardando;

  function alternarTodas() {
    setElegidas(todasTildadas ? new Set() : new Set(abiertas.map((f) => f.numero)));
  }

  function alternar(numero: string) {
    setElegidas((prev) => {
      const n = new Set(prev);
      if (n.has(numero)) n.delete(numero);
      else n.add(numero);
      return n;
    });
  }

  async function guardar() {
    if (!listo) return;
    setGuardando(true);
    setMsg(null);
    try {
      const res = await fetch('/api/cobranzas/saldadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo: motivo.trim(),
          facturas: abiertas.filter((f) => elegidas.has(f.numero)).map((f) => ({
            numero: f.numero, id_control: idControl, cliente: nombreCliente,
            fecha: f.fecha, importe: f.importe,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, texto: j?.error || 'No se pudo guardar.' });
        return;
      }
      setMsg({ ok: true, texto: j.mensaje });
      setElegidas(new Set());
      setMotivo('');
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally {
      setGuardando(false);
    }
  }

  async function revertir(numero: string) {
    setGuardando(true);
    setMsg(null);
    try {
      const res = await fetch('/api/cobranzas/saldadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'revertir', numero }),
      });
      const j = await res.json();
      setMsg({ ok: res.ok, texto: res.ok ? j.mensaje : (j?.error || 'No se pudo deshacer.') });
      if (res.ok) router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo deshacer.' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <select
        value={idControl}
        onChange={(e) => { setIdControl(e.target.value); setElegidas(new Set()); setMsg(null); }}
        style={{ width: '100%', maxWidth: '320px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
      >
        <option value="">Elegí un cliente…</option>
        {clientes.map((c) => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
      </select>

      {idControl && (todas.length === 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#6b7280' }}>
          Este cliente no tiene facturas en los últimos 120 días.
        </p>
      ) : abiertas.length === 0 && !verTodas ? (
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#059669' }}>
          Las {todas.length} facturas de este cliente ya están cobradas o saldadas.{' '}
          <button
            type="button"
            onClick={() => setVerTodas(true)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '13px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
          >
            Verlas igual
          </button>
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              {abiertas.length} {abiertas.length === 1 ? 'abierta' : 'abiertas'}
              {todas.length > abiertas.length ? ` · ${todas.length - abiertas.length} ya cerradas` : ''}
            </p>
            {todas.length > abiertas.length && (
              <button
                type="button"
                onClick={() => setVerTodas((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
              >
                {verTodas ? 'Ver solo las abiertas' : 'Ver también las cerradas'}
              </button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '6px' }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: '11.5px', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px', width: '28px' }}>
                  <input
                    type="checkbox"
                    checked={todasTildadas}
                    onChange={alternarTodas}
                    disabled={!abiertas.length}
                    title="Seleccionar todas las abiertas"
                  />
                </th>
                <th style={{ padding: '4px 6px' }}>Factura</th>
                <th style={{ padding: '4px 6px' }}>Fecha</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Importe</th>
                <th style={{ padding: '4px 6px' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const dias = diasDesde(f.fecha);
                const cerrada = f.yaCobrada || f.saldadaManual || f.cubierta;
                return (
                  <tr key={f.numero} style={{ borderTop: '1px solid #f3f4f6', opacity: cerrada ? 0.55 : 1 }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="checkbox"
                        checked={elegidas.has(f.numero)}
                        onChange={() => alternar(f.numero)}
                        disabled={cerrada}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}>{f.numero}</td>
                    <td style={{ padding: '4px 6px', color: !cerrada && dias > 60 ? '#b45309' : '#6b7280' }}>
                      {fmtFecha(f.fecha)} <span style={{ fontSize: '11px', color: '#9ca3af' }}>({dias} días)</span>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(f.importe)}</td>
                    <td style={{ padding: '4px 6px', fontSize: '11.5px', color: cerrada ? '#059669' : '#b45309' }}>
                      {f.yaCobrada ? 'cobrada en la app'
                        : f.saldadaManual ? 'saldada a mano'
                        : f.cubierta ? 'cubierta por cobros de Xubio'
                        : 'abierta'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se dan por saldadas (ej: cobrado con cheque en mano)"
              style={{ flex: '1 1 320px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
            />
            <button onClick={guardar} disabled={!listo} className="btn" style={{ fontSize: '13px', opacity: listo ? 1 : 0.5 }}>
              {guardando ? 'Guardando…' : `Marcar como ${elegidas.size === 1 ? 'saldada' : 'saldadas'}`}
            </button>
          </div>
          {elegidas.size > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6b7280' }}>
              {elegidas.size} {elegidas.size === 1 ? 'factura' : 'facturas'} · {fmt(totalElegido)} — no se registra
              ningún cobro en Xubio, solo dejan de aparecer acá y en los reclamos.
            </p>
          )}
        </>
      ))}

      {msg && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>
          {msg.ok ? '✓ ' : '⚠ '}{msg.texto}
        </p>
      )}

      {/* Lo ya marcado, con el motivo y la vuelta atrás. Sin esto la marca sería una
          decisión invisible: nadie podría revisar qué se dejó de reclamar ni por qué. */}
      {saldadas.length > 0 && (
        <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
          <button
            type="button"
            onClick={() => setVerMarcadas((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
          >
            {verMarcadas ? '▾' : '▸'} Marcadas como saldadas ({saldadas.length})
          </button>
          {verMarcadas && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '8px' }}>
              <tbody>
                {saldadas.map((s) => (
                  <tr key={s.numero} style={{ borderTop: '1px solid #f9fafb', color: '#6b7280' }}>
                    <td style={{ padding: '3px 6px', fontFamily: 'ui-monospace, monospace' }}>{s.numero}</td>
                    <td style={{ padding: '3px 6px' }}>{s.cliente}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.importe)}</td>
                    <td style={{ padding: '3px 6px', color: '#9ca3af' }}>{s.motivo} · {s.usuario}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => revertir(s.numero)}
                        disabled={guardando}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '11.5px', color: '#b45309', cursor: 'pointer' }}
                      >
                        deshacer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
