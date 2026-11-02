'use client';
import { useState } from 'react';

// ── Corregir cuánto vale una factura, desde donde se la está mirando ─────────────────
//
// El caso: la factura salió mal cargada y el cliente pagó lo correcto. Mientras el importe
// de la factura esté mal, ninguna combinación cierra, la sugerencia dice "faltan $12.400"
// para siempre y el cliente queda figurando deudor por una diferencia que no existe.
//
// Esto estaba escrito dos veces —en la bandeja y en el resumen de impagas— y cada copia con
// sus propios textos. El formulario es uno solo: lo que se escribe acá cambia cuánto debe un
// cliente, y dos versiones del mismo formulario son dos oportunidades de que una explique mal
// lo que hace.
//
// Lo que NO hace, y por eso está dicho en pantalla y no solo acá: no toca Xubio. La factura
// emitida sigue como está; esto es un ajuste del lado de la app, con motivo y usuario.
// Creer que corrige la factura allá sería peor que no tenerlo.

export default function AjustarFactura({
  numero, importeActual, idControl, cliente, onListo, onCancelar, deshabilitado = false,
}: {
  numero: string;
  // Lo que la factura dice hoy. Va al backend como `importeXubio` para dejar asentado desde
  // qué número se ajustó: sin eso, el ajuste es un importe suelto sin contra qué compararlo.
  importeActual: number;
  idControl: string;
  cliente: string;
  onListo: (nuevo: number) => void;
  onCancelar: () => void;
  deshabilitado?: boolean;
}) {
  const [nuevoImporte, setNuevoImporte] = useState(String(Math.round(importeActual)));
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const nuevo = Math.round(Number(nuevoImporte) || 0);
  const dif = nuevo - Math.round(importeActual);
  const trabajando = guardando || deshabilitado;

  async function guardar() {
    if (!isFinite(nuevo) || nuevo < 0) { setErr('El importe tiene que ser un número.'); return; }
    if (!motivo.trim()) { setErr('Poné por qué se ajusta.'); return; }
    setGuardando(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/ajuste-factura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero, id_control: idControl, cliente,
          importeXubio: Math.round(importeActual), importeApp: nuevo, motivo: motivo.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo ajustar');
      onListo(nuevo);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo ajustar');
      setGuardando(false);
    }
  }

  const input: React.CSSProperties = {
    fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px',
  };

  return (
    <div style={{ marginTop: '7px', padding: '9px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px' }}>
      <p style={{ margin: '0 0 7px', fontSize: '11.5px', fontWeight: 700, color: '#92400e' }}>
        Corregir <span style={{ fontFamily: 'ui-monospace, monospace' }}>{numero}</span> — hoy figura {fmt$(importeActual)}
      </p>
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="number" value={nuevoImporte} onChange={(e) => setNuevoImporte(e.target.value)} disabled={trabajando}
          placeholder="Importe real" style={{ ...input, width: '130px' }} />
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={trabajando}
          placeholder="¿Por qué? (ej: 40 rúculas de menos)" style={{ ...input, flex: '1 1 220px', minWidth: '180px' }} />
        <button type="button" onClick={guardar} disabled={trabajando}
          style={{ fontSize: '11.5px', fontWeight: 700, padding: '5px 12px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', opacity: trabajando ? 0.6 : 1 }}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancelar} disabled={trabajando}
          style={{ fontSize: '11.5px', padding: '5px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>
      {dif !== 0 && (
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#92400e' }}>
          {dif > 0 ? 'Sube' : 'Baja'} {fmt$(Math.abs(dif))} respecto de lo emitido.
        </p>
      )}
      {err && <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>⚠ {err}</p>}
      <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#b45309', lineHeight: 1.45 }}>
        Esto <strong>no cambia la factura en Xubio</strong>: queda registrado del lado de la app, con el motivo y tu
        usuario, y es lo que se usa para la deuda del cliente. Si hay que corregirla de verdad, va una nota de crédito
        desde Comprobantes.
      </p>
    </div>
  );
}
