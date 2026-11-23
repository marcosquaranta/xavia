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
  // ── Los dos caminos, que NO son lo mismo ──────────────────────────────────────────
  //
  // `app`  = corregir lo que la app reclama. La factura en Xubio sigue como está. Sirve
  //          cuando el comprobante está bien y lo que estaba mal era el registro.
  // `nc`   = emitir una nota de crédito por la diferencia. Sirve cuando hay que cobrarle
  //          menos de verdad: un acuerdo comercial, un reclamo aceptado.
  //
  // Se eligen y no se combinan: hacer las dos sobre la misma factura bajaría la deuda dos
  // veces, y ese error es silencioso. El servidor también revierte el ajuste al emitir la
  // NC, por si quedó uno viejo.
  const [modo, setModo] = useState<'app' | 'nc'>('app');
  const [previa, setPrevia] = useState<{ acreditar: number; porcentaje: number } | null>(null);
  const [resultado, setResultado] = useState<{ numeroNC?: string; importe?: number; porcentaje?: number } | null>(null);

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

  // La previa sale del servidor y no de una cuenta local: es el MISMO reparto que se va a
  // emitir. Si la pantalla prorrateara por su cuenta, podría mostrar un número y emitirse
  // otro, y eso en AFIP no se deshace.
  async function verPrevia(valor: string) {
    const n = Math.round(Number(valor) || 0);
    if (!(n >= 0) || n >= Math.round(importeActual)) { setPrevia(null); return; }
    try {
      const r = await fetch(`/api/ventas/nc-importe?numero=${encodeURIComponent(numero)}&importe_final=${n}`);
      const j = await r.json();
      setPrevia(j?.previa?.ok ? { acreditar: j.previa.acreditar, porcentaje: j.previa.porcentaje } : null);
      if (j?.previa && !j.previa.ok) setErr(j.previa.error);
      else if (!r.ok) setErr(j?.error || null);
    } catch { setPrevia(null); }
  }

  async function emitirNC() {
    if (!(nuevo > 0) || nuevo >= Math.round(importeActual)) {
      setErr('El importe nuevo tiene que ser menor que el de la factura. Una nota de crédito solo baja lo que se cobra.');
      return;
    }
    if (!motivo.trim()) { setErr('Poné por qué se acredita: en tres meses esto va a ser plata que nadie puede explicar.'); return; }
    // Sale en AFIP y no se deshace. Se confirma con los números a la vista, no con un
    // "¿estás seguro?" genérico.
    const texto = `Se va a emitir una NOTA DE CRÉDITO en Xubio para ${cliente}.\n\n`
      + `Factura ${numero}: ${fmt$(importeActual)} → ${fmt$(nuevo)}\n`
      + `Se acreditan ${fmt$(Math.round(importeActual) - nuevo)}${previa ? ` (${previa.porcentaje}% de la factura)` : ''}.\n\n`
      + `Esto se emite en AFIP y no se deshace. ¿Confirmás?`;
    if (!window.confirm(texto)) return;
    setGuardando(true); setErr(null);
    try {
      const r = await fetch('/api/ventas/nc-importe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, importe_final: nuevo, motivo: motivo.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo emitir la nota de crédito');
      setResultado({ numeroNC: j.numeroNC, importe: j.importe, porcentaje: j.porcentaje });
      setGuardando(false);
      // El importe que la factura pasa a valer es el nuevo: se avisa para que la lista de
      // atrás se refresque sin tener que recargar.
      onListo(nuevo);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo emitir la nota de crédito');
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

      {/* Qué se quiere hacer. Son dos cosas distintas y la diferencia es si el cliente
          termina debiendo menos de verdad o si solo se corrige el registro. */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {([
          ['app', 'Corregir solo en la app', 'La factura en Xubio queda como está.'],
          ['nc', 'Emitir nota de crédito', 'Le acredita la diferencia de verdad.'],
        ] as const).map(([v, label, ayuda]) => (
          <button key={v} type="button" onClick={() => { setModo(v); setErr(null); setPrevia(null); if (v === 'nc') verPrevia(nuevoImporte); }}
            disabled={trabajando} title={ayuda}
            style={{
              fontSize: '11px', fontWeight: 700, padding: '5px 11px', borderRadius: '7px', cursor: 'pointer',
              border: `1px solid ${modo === v ? (v === 'nc' ? '#b91c1c' : '#166534') : '#e5e7eb'}`,
              background: modo === v ? (v === 'nc' ? '#fef2f2' : '#f0fdf4') : 'white',
              color: modo === v ? (v === 'nc' ? '#b91c1c' : '#166534') : '#6b7280',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* El atajo del porcentaje, que es como se pide un acuerdo comercial. */}
      {modo === 'nc' && (
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '7px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10.5px', color: '#6b7280' }}>Descuento:</span>
          {[5, 10, 15, 20, 25].map((pct) => (
            <button key={pct} type="button" disabled={trabajando}
              onClick={() => { const v = String(Math.round(importeActual * (1 - pct / 100))); setNuevoImporte(v); verPrevia(v); }}
              style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer' }}>
              {pct}%
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="number" value={nuevoImporte} disabled={trabajando}
          onChange={(e) => { setNuevoImporte(e.target.value); if (modo === 'nc') verPrevia(e.target.value); }}
          placeholder="Importe final" style={{ ...input, width: '130px' }} />
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={trabajando}
          placeholder={modo === 'nc' ? '¿Por qué? (ej: 20% acuerdo comercial)' : '¿Por qué? (ej: 40 rúculas de menos)'}
          style={{ ...input, flex: '1 1 220px', minWidth: '180px' }} />
        <button type="button" onClick={modo === 'nc' ? emitirNC : guardar} disabled={trabajando}
          style={{ fontSize: '11.5px', fontWeight: 700, padding: '5px 12px', background: modo === 'nc' ? '#b91c1c' : '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', opacity: trabajando ? 0.6 : 1 }}>
          {guardando ? (modo === 'nc' ? 'Emitiendo…' : 'Guardando…') : (modo === 'nc' ? 'Emitir nota de crédito' : 'Guardar')}
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

      {/* Qué va a salir, antes de que salga. El reparto lo calcula el servidor —el mismo
          que va a emitir—, así que esto no puede mostrar un número y emitirse otro. */}
      {modo === 'nc' && previa && !resultado && (
        <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '7px 9px', lineHeight: 1.5 }}>
          Se acreditan <strong>{fmt$(previa.acreditar)}</strong> — el <strong>{previa.porcentaje}%</strong> de la factura.
          La nota de crédito lleva los mismos artículos de {numero} con las mismas cantidades, al precio proporcional:
          no se inventa que se entregó de menos.
        </p>
      )}

      {resultado && (
        <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '7px 9px', lineHeight: 1.5 }}>
          ✓ Nota de crédito <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{resultado.numeroNC || '(sin número)'}</strong> emitida
          por <strong>{fmt$(resultado.importe || 0)}</strong>{resultado.porcentaje ? ` (${resultado.porcentaje}%)` : ''}.
          La factura queda en {fmt$(nuevo)}.
        </p>
      )}

      {modo === 'app' ? (
        <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#b45309', lineHeight: 1.45 }}>
          Esto <strong>no cambia la factura en Xubio</strong>: queda registrado del lado de la app, con el motivo y tu
          usuario, y es lo que se usa para la deuda del cliente.
        </p>
      ) : (
        <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#b45309', lineHeight: 1.45 }}>
          Esto <strong>se emite en AFIP y no se deshace</strong>: la nota de crédito no borra la factura, la compensa.
          Las cantidades entregadas no se tocan — cambió lo que se cobra, no lo que salió.
        </p>
      )}
      {/* El otro camino, nombrado. Este formulario sirve para el caso en que solo hay que
          corregir el número; corregir las cantidades y cerrar la factura en Xubio es otra
          cosa y se hace en el historial, donde sale sola la NC o la factura por la
          diferencia. Decir solo "esto no toca Xubio" deja al que leyó sin saber qué sí. */}
      <p style={{ margin: '4px 0 0', fontSize: '10.5px', color: '#6b7280', lineHeight: 1.45 }}>
        Si lo que está mal son las cantidades y hay que cerrarla en Xubio,{' '}
        <a href={`/ventas/historial?factura=${encodeURIComponent(numero)}`} target="_blank" rel="noreferrer"
          style={{ color: '#1d4ed8', fontWeight: 700 }}>
          corregila en el historial
        </a>: ahí se emite sola la nota de crédito, o una factura por la diferencia si sube.
      </p>
    </div>
  );
}
