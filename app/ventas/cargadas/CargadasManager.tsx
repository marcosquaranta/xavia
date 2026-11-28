'use client';
import { useState } from 'react';

interface Grupo {
  clave: string; id_control: string; cliente: string; sucursal: string;
  detalle: string; total: number; cambios: number;
  estado: string; comprobante: string; confirmadoPor: string; confirmadoEn: string;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const fmtDia = (iso: string) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const hora = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const ETIQUETA: Record<string, { txt: string; color: string; fondo: string; borde: string }> = {
  con_remito: { txt: 'Facturada con remito', color: '#166534', fondo: '#f0fdf4', borde: '#bbf7d0' },
  sin_remito: { txt: 'Facturada SIN remito', color: '#92400e', fondo: '#fffbeb', borde: '#fde68a' },
  esperando: { txt: 'Esperando el remito', color: '#1d4ed8', fondo: '#eff6ff', borde: '#bfdbfe' },
};

export default function CargadasManager({ dias }: { dias: { fecha: string; grupos: Grupo[] }[] }) {
  const [trabajando, setTrabajando] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  // ── Facturar sin remito, a mano ────────────────────────────────────────────────────
  //
  // La salida de emergencia: el día que haya que facturar antes de que alguien entregue.
  // Pasa por el MISMO camino que usaba el botón de Ventas (/api/ventas/cargar con
  // soloCliente), así que mantiene el freno de duplicados y el acuse.
  //
  // Pregunta antes porque emite en AFIP y no se deshace: una nota de crédito no borra la
  // factura, la compensa.
  async function facturar(g: Grupo, fecha: string) {
    const ok = window.confirm(
      `Facturar a ${g.cliente}${g.sucursal ? ` (${g.sucursal})` : ''} por ${fmt(g.total)} sin esperar el remito.\n\n`
      + 'Se va a emitir en AFIP con las cantidades que se cargaron. Si después se entregó otra cosa, hay que hacer una nota de crédito.\n\n'
      + '¿Facturar igual?',
    );
    if (!ok) return;
    setTrabajando(g.clave); setMsg(null);
    try {
      const r = await fetch('/api/ventas/cargar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, soloCliente: g.id_control }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo facturar.');
      const err = (j.errores || [])[0];
      setMsg(err
        ? { t: 'err', s: `${g.cliente}: ${err.error}` }
        : { t: 'ok', s: `✓ ${g.cliente} facturada sin remito${(j.emitidas || [])[0]?.numero ? ` — ${(j.emitidas || [])[0].numero}` : ''}. Recargá para verlo.` });
    } catch (e: any) {
      setMsg({ t: 'err', s: e?.message || 'No se pudo facturar.' });
    }
    setTrabajando('');
  }

  if (!dias.length) {
    return <p style={{ fontSize: '13.5px', color: '#6b7280' }}>No hay ventas cargadas en los últimos días.</p>;
  }

  return (
    <>
      {msg && (
        <div className={`alert-box ${msg.t === 'ok' ? 'success' : 'error'}`} style={{ whiteSpace: 'pre-line', marginBottom: '12px' }}>
          {msg.s}
        </div>
      )}

      {dias.map((d) => {
        const sinRemito = d.grupos.filter((g) => g.estado === 'sin_remito').length;
        const esperando = d.grupos.filter((g) => g.estado === 'esperando').length;
        return (
          <div className="card" key={d.fecha} style={{ marginBottom: '14px' }}>
            <p className="card-title">
              {fmtDia(d.fecha)} · {d.grupos.length} {d.grupos.length === 1 ? 'venta' : 'ventas'}
            </p>
            <p className="card-sub">
              {esperando > 0 ? `${esperando} esperando el remito · ` : ''}
              {sinRemito > 0 ? `${sinRemito} facturada(s) sin remito · ` : ''}
              {fmt(d.grupos.reduce((a, g) => a + g.total, 0))}
            </p>
            <div style={{ overflowX: 'auto', marginTop: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '620px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Lo que se factura</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Estado</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {d.grupos.map((g) => {
                    const e = ETIQUETA[g.estado] || ETIQUETA.esperando;
                    return (
                      <tr key={g.clave} style={{ borderTop: '1px solid #f3f4f6', background: g.estado === 'sin_remito' ? '#fffbeb' : undefined }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>
                          {g.cliente}
                          {g.sucursal && <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 400 }}>{g.sucursal}</div>}
                        </td>
                        <td style={{ padding: '8px', color: '#374151' }}>
                          {g.detalle}
                          {g.cambios > 0 && (
                            <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px' }}>
                              {g.cambios === 1 ? 'un artículo' : `${g.cambios} artículos`} distinto(s) de lo cargado
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(g.total)}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            fontSize: '11px', fontWeight: 700, color: e.color, background: e.fondo,
                            border: `1px solid ${e.borde}`, borderRadius: '5px', padding: '2px 7px', whiteSpace: 'nowrap',
                          }}>{e.txt}</span>
                          <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px' }}>
                            {g.comprobante ? `${g.comprobante}` : ''}
                            {g.confirmadoEn ? ` · ${hora(g.confirmadoEn)} ${g.confirmadoPor.split('@')[0]}` : ''}
                            {g.estado === 'sin_remito' ? ' · nadie confirmó qué se entregó' : ''}
                          </div>
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {g.estado === 'esperando' && (
                            <button type="button" onClick={() => facturar(g, d.fecha)} disabled={!!trabajando}
                              style={{
                                background: 'white', border: '1px solid #d1d5db', borderRadius: '6px',
                                padding: '6px 11px', fontSize: '12px', fontWeight: 700, color: '#111827',
                                whiteSpace: 'nowrap', cursor: trabajando ? 'wait' : 'pointer',
                              }}>
                              {trabajando === g.clave ? 'Facturando…' : 'Facturar sin remito'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
