'use client';

// ── El acuse de lo que se acaba de facturar ──────────────────────────────────────────
//
// Antes la carga terminaba en un renglón verde: "✓ Facturas cargadas OK". Eso confirma que
// la app hizo el pedido, no que Xubio lo tenga con la mercadería correcta — y es justo la
// diferencia que hizo perder una mañana cuando los artículos de Admin no entraban en la
// factura y nadie se enteró.
//
// Por eso esto ocupa la pantalla y hay que cerrarlo a propósito: lo que informa es
// irreversible del lado de AFIP, y un mensajito al pie no se mira.

import { useEffect } from 'react';

export interface ItemAcuse { producto: string; cantidad: number; sucursal?: string }
export interface FacturaAcuse {
  cliente: string; sucursal?: string; numero?: string; cae?: string;
  total: number; items: ItemAcuse[];
  enXubio: 'confirmada' | 'no_encontrada' | 'difiere' | 'sin_verificar';
  totalXubio?: number;
}
export interface GrupoAntes { cliente: string; comprobantes: string[]; items: ItemAcuse[] }
export interface Acuse {
  fecha: string;
  emitidas: FacturaAcuse[];
  errores: { cliente: string; error: string; items?: ItemAcuse[]; total?: number }[];
  antes: GrupoAntes[];
}

const $ = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : f; };

const ESTADO: Record<FacturaAcuse['enXubio'], { txt: string; color: string; fondo: string; borde: string }> = {
  confirmada:     { txt: '✓ Xubio la tiene',        color: '#166534', fondo: '#f0fdf4', borde: '#bbf7d0' },
  no_encontrada:  { txt: '✕ Xubio NO la tiene',     color: '#991b1b', fondo: '#fef2f2', borde: '#fecaca' },
  difiere:        { txt: '⚠ Xubio tiene otro total', color: '#92400e', fondo: '#fffbeb', borde: '#fde68a' },
  sin_verificar:  { txt: '· sin verificar',          color: '#6b7280', fondo: '#fafafa', borde: '#e5e7eb' },
};

export default function AcuseFacturacion({ acuse, onCerrar }: { acuse: Acuse; onCerrar: () => void }) {
  // Escape cierra. Es un modal de confirmación, no una trampa.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);

  const problemas = acuse.emitidas.filter((f) => f.enXubio !== 'confirmada').length + acuse.errores.length;
  const totalEmitido = acuse.emitidas.reduce((a, f) => a + (f.total || 0), 0);

  const listaItems = (items: ItemAcuse[]) => (
    <ul style={{ margin: '3px 0 0', paddingLeft: '16px', fontSize: '12px', color: '#374151' }}>
      {items.map((i, k) => (
        <li key={k}>
          <strong>{Math.round(i.cantidad).toLocaleString('es-AR')}</strong> · {i.producto}
          {i.sucursal ? <span style={{ color: '#9ca3af' }}> · {i.sucursal}</span> : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '18px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: '12px', maxWidth: '680px', width: '100%', padding: '18px 20px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: problemas ? '#92400e' : '#166534' }}>
              {problemas
                ? `Se facturó, pero hay ${problemas} cosa(s) para mirar`
                : `✓ Facturado y confirmado en Xubio`}
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#6b7280' }}>
              Entrega del {fmtDia(acuse.fecha)} · {acuse.emitidas.length} factura(s) · {$(totalEmitido)}
            </p>
          </div>
          <button type="button" onClick={onCerrar}
            style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* ── Lo que se acaba de mandar ── */}
        <p style={{ margin: '16px 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Recién facturado
        </p>
        {acuse.emitidas.length === 0 && (
          <p style={{ margin: 0, fontSize: '12.5px', color: '#9ca3af' }}>No salió ninguna factura.</p>
        )}
        {acuse.emitidas.map((f, i) => {
          const e = ESTADO[f.enXubio];
          return (
            <div key={i} style={{ border: `1px solid ${e.borde}`, background: e.fondo, borderRadius: '8px', padding: '9px 11px', marginBottom: '7px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ fontSize: '13.5px' }}>
                  {f.cliente}{f.sucursal ? <span style={{ fontWeight: 400, color: '#6b7280' }}> · {f.sucursal}</span> : null}
                </strong>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: e.color }}>{e.txt}</span>
              </div>
              {listaItems(f.items)}
              <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#6b7280', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {f.numero && <span style={{ fontFamily: 'ui-monospace,monospace' }}>{f.numero}</span>}
                {f.cae && <span>CAE {f.cae}</span>}
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#111' }}>{$(f.total)}</span>
              </div>
              {/* Decir el número de Xubio al lado del nuestro: la diferencia se ve sola y no
                  hay que ir a buscarla a la otra pantalla. */}
              {f.enXubio === 'difiere' && (
                <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: '#92400e' }}>
                  Nosotros mandamos {$(f.total)} y Xubio guardó {$(f.totalXubio || 0)}. Revisá la factura allá antes de entregarla.
                </p>
              )}
              {f.enXubio === 'no_encontrada' && (
                <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: '#991b1b' }}>
                  La app la dio por emitida pero Xubio no la devuelve. Puede ser demora de Xubio: recargá en un minuto.
                  Si sigue sin aparecer, <strong>hay mercadería entregada y sin facturar</strong>.
                </p>
              )}
            </div>
          );
        })}

        {/* ── Lo que no salió ── */}
        {acuse.errores.length > 0 && (
          <>
            <p style={{ margin: '14px 0 6px', fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              No se pudo facturar
            </p>
            {acuse.errores.map((e, i) => (
              <div key={i} style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '8px', padding: '9px 11px', marginBottom: '7px' }}>
                <strong style={{ fontSize: '13.5px' }}>{e.cliente}</strong>
                {e.items?.length ? listaItems(e.items) : null}
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#991b1b' }}>{e.error}</p>
              </div>
            ))}
          </>
        )}

        {/* ── Lo que ya estaba facturado de ese día ──
            El error más caro de esta pantalla es facturar dos veces el mismo día. Hasta
            ahora para darse cuenta había que ir al historial; acá está al lado de lo que se
            acaba de mandar, que es el único momento en que se puede frenar a tiempo. */}
        {acuse.antes.length > 0 && (
          <>
            <p style={{ margin: '16px 0 6px', fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Facturado antes para el {fmtDia(acuse.fecha)}
            </p>
            <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280' }}>
              Ya se había facturado esto para la misma entrega. Si alguno coincide con lo de arriba, es una carga repetida.
            </p>
            {acuse.antes.map((g, i) => (
              <div key={i} style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '8px', padding: '9px 11px', marginBottom: '7px' }}>
                <strong style={{ fontSize: '13px' }}>{g.cliente}</strong>
                <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '6px', fontFamily: 'ui-monospace,monospace' }}>{g.comprobantes.join(' · ')}</span>
                {listaItems(g.items)}
              </div>
            ))}
          </>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button type="button" onClick={onCerrar}
            style={{ fontSize: '13px', padding: '8px 18px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>
            Entendido
          </button>
          <a href="/ventas/historial" style={{ fontSize: '12.5px', padding: '8px 14px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#374151', textDecoration: 'none' }}>
            Ver historial de facturación →
          </a>
        </div>
      </div>
    </div>
  );
}
