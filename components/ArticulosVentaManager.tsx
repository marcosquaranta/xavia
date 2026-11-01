'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
// La paleta se define acá y no en lib/articulosVenta: ese archivo lee la planilla, o sea
// que importa googleapis, y un componente cliente que lo toque se lleva todo eso al bundle
// del navegador (el build directamente falla pidiendo 'net' y 'fs').
const COLORES_SUGERIDOS = ['#0f766e', '#0e7490', '#7c3aed', '#be185d', '#c2410c', '#4d7c0f', '#1d4ed8', '#9333ea'];

export interface ArticuloUI {
  key: string; label: string; labelLargo: string; xubio: string;
  unidad: 'unidad' | 'kg'; activo: boolean; color: string; seccionAparte: boolean;
  // Los del código no se editan desde acá: cambiarlos es un deploy, y varios consumen
  // plantas de la cámara, que no es un dato que se cargue en una pantalla.
  esDelCodigo: boolean;
}

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };

// Sugiere la clave a partir del nombre. La clave es el nombre de la columna en la planilla y
// no se puede cambiar después, así que se propone una razonable y se deja ver y corregir
// antes de crear, en vez de generarla escondida.
function claveDesde(nombre: string): string {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

export default function ArticulosVentaManager({ articulos }: { articulos: ArticuloUI[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [label, setLabel] = useState('');
  const [labelLargo, setLabelLargo] = useState('');
  const [key, setKey] = useState('');
  const [keyTocada, setKeyTocada] = useState(false);
  const [xubio, setXubio] = useState('');
  const [unidad, setUnidad] = useState<'unidad' | 'kg'>('unidad');
  const [color, setColor] = useState(COLORES_SUGERIDOS[0]);

  const cambiarLabel = (v: string) => {
    setLabel(v);
    if (!keyTocada) setKey(claveDesde(v));
  };

  function limpiar() {
    setLabel(''); setLabelLargo(''); setKey(''); setKeyTocada(false);
    setXubio(''); setUnidad('unidad'); setColor(COLORES_SUGERIDOS[0]);
  }

  async function crear() {
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/articulos-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crear', key, label, label_largo: labelLargo, xubio, unidad, color }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al crear');
      setMsg({ t: 'ok', s: `✓ "${label}" creado. Ya le podés poner precio en Clientes y cargarle ventas.` });
      limpiar(); setAbierto(false);
      router.refresh();
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al crear' });
    }
    setGuardando(false);
  }

  async function cambiarEstado(a: ArticuloUI) {
    const accion = a.activo ? 'baja' : 'alta';
    if (a.activo && !confirm(
      `Dar de baja "${a.label}".\n\nNo se borra nada: desaparece de las pantallas de carga y de precios, y las ventas ya cargadas siguen valiendo lo mismo en estadísticas y facturación.\n\n¿Confirmás?`,
    )) return;
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/articulos-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, key: a.key }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error');
      router.refresh();
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error' });
    }
    setGuardando(false);
  }

  const puedeCrear = !!label.trim() && !!key.trim() && !!xubio.trim() && !guardando;

  return (
    <div>
      {msg && (
        <p style={{
          margin: '0 0 10px', fontSize: '12px', fontWeight: 600, padding: '8px 11px', borderRadius: '7px',
          color: msg.t === 'ok' ? '#065f46' : '#991b1b',
          background: msg.t === 'ok' ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${msg.t === 'ok' ? '#a7f3d0' : '#fecaca'}`,
        }}>{msg.s}</p>
      )}

      {!abierto ? (
        <button onClick={() => setAbierto(true)}
          style={{ fontSize: '12.5px', fontWeight: 700, padding: '7px 15px', background: '#166534', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', marginBottom: '14px' }}>
          + Nuevo artículo de venta
        </button>
      ) : (
        <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: '9px', padding: '13px 15px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#166534' }}>Nuevo artículo de venta</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Nombre corto *</label>
              <input value={label} onChange={(e) => cambiarLabel(e.target.value)} disabled={guardando}
                placeholder="Bandeja 105" style={inputStyle} />
              <span style={{ fontSize: '10px', color: '#6b7280' }}>Va en los encabezados de las tablas, que son angostos.</span>
            </div>
            <div>
              <label style={labelStyle}>Nombre completo</label>
              <input value={labelLargo} onChange={(e) => setLabelLargo(e.target.value)} disabled={guardando}
                placeholder="Bandeja de microgreens 105" style={inputStyle} />
              <span style={{ fontSize: '10px', color: '#6b7280' }}>Para mails e informes. Si lo dejás vacío usa el corto.</span>
            </div>
            <div>
              <label style={{ ...labelStyle, color: '#92400e' }}>Nombre EXACTO en Xubio *</label>
              <input value={xubio} onChange={(e) => setXubio(e.target.value)} disabled={guardando}
                placeholder="Bandeja Microgreens 105" style={{ ...inputStyle, borderColor: xubio.trim() ? undefined : '#fbbf24' }} />
              {/* Es el campo que más silenciosamente rompe: la conexión con Xubio es por
                  nombre, no hay código. Si no coincide, la venta se carga bien, la factura
                  sale sin ese ítem y el cliente paga de menos. */}
              <span style={{ fontSize: '10px', color: '#92400e' }}>
                Copialo tal cual de Xubio. Si no coincide, la venta se carga igual pero la factura sale sin ese ítem.
              </span>
            </div>
            <div>
              <label style={labelStyle}>¿Cómo se vende?</label>
              <select value={unidad} onChange={(e) => setUnidad(e.target.value as 'unidad' | 'kg')} disabled={guardando} style={inputStyle}>
                <option value="unidad">Por unidad</option>
                <option value="kg">Por kilo (se carga en cajones)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Color en los gráficos</label>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', paddingTop: '3px' }}>
                {COLORES_SUGERIDOS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} disabled={guardando}
                    style={{ width: '22px', height: '22px', borderRadius: '5px', background: c, cursor: 'pointer', border: color === c ? '2px solid #111827' : '1px solid #e5e7eb' }} />
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Clave (columna de la planilla)</label>
              <input value={key} onChange={(e) => { setKey(e.target.value); setKeyTocada(true); }} disabled={guardando}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11.5px' }} />
              {/* Se muestra en vez de generarse escondida porque no se puede cambiar
                  después: es el nombre de la columna donde van a quedar las ventas. */}
              <span style={{ fontSize: '10px', color: '#6b7280' }}>Se propone sola. <strong>No se puede cambiar después.</strong></span>
            </div>
          </div>

          <p style={{ margin: '11px 0 0', fontSize: '11px', color: '#166534', background: '#dcfce7', borderRadius: '6px', padding: '7px 9px', lineHeight: 1.5 }}>
            Al crearlo se agregan solas las columnas en <strong>Ventas</strong>, <strong>Precios</strong> y <strong>Pedidos fijos</strong>.
            Después le ponés precio por cliente en <strong>Admin → Clientes</strong>: hasta que tenga precio, no aparece en la pantalla de carga de ese cliente.
          </p>

          <div style={{ display: 'flex', gap: '8px', marginTop: '11px' }}>
            <button onClick={crear} disabled={!puedeCrear}
              style={{ fontSize: '12.5px', fontWeight: 700, padding: '7px 15px', background: puedeCrear ? '#166534' : '#d1d5db', color: 'white', border: 'none', borderRadius: '7px', cursor: puedeCrear ? 'pointer' : 'not-allowed' }}>
              {guardando ? 'Creando…' : 'Crear artículo'}
            </button>
            <button onClick={() => { setAbierto(false); limpiar(); setMsg(null); }} disabled={guardando}
              style={{ fontSize: '12.5px', padding: '7px 15px', background: '#f3f4f6', border: 'none', borderRadius: '7px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead>
          <tr style={{ background: '#fafaf9', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Artículo</th>
            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>En Xubio</th>
            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Unidad</th>
            <th style={{ textAlign: 'right', padding: '7px 10px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {articulos.map((a) => (
            <tr key={a.key} style={{ borderTop: '1px solid #f3f4f6', opacity: a.activo ? 1 : 0.5 }}>
              <td style={{ padding: '7px 10px' }}>
                <span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '3px', background: a.color, marginRight: '7px' }} />
                <strong>{a.label}</strong>
                <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: '10.5px' }}> · {a.key}</span>
              </td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>{a.xubio}</td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>{a.unidad === 'kg' ? 'por kilo' : 'por unidad'}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {a.esDelCodigo ? (
                  <span title="Definido en el código: varios de estos consumen plantas de la cámara, y eso no se cambia desde una pantalla."
                    style={{ fontSize: '10.5px', color: '#9ca3af' }}>
                    {a.activo ? 'activo' : 'de baja'} · fijo
                  </span>
                ) : (
                  <button onClick={() => cambiarEstado(a)} disabled={guardando}
                    style={{ fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '5px', cursor: 'pointer', border: '1px solid #e5e7eb', background: 'white', color: a.activo ? '#b45309' : '#166534' }}>
                    {a.activo ? 'Dar de baja' : 'Reactivar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
