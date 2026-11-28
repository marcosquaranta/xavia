'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ══ Reparto: confirmar qué se entregó ═════════════════════════════════════════════════
//
// Reglas de esta pantalla, que valen para todo lo que se escriba acá:
//
//  · Nunca decir "listo" por algo que no se guardó. Es el único error acá que haría perder
//    un dato que no se puede volver a averiguar: lo que el repartidor vio en la puerta del
//    cliente y ya no está.
//  · Nada de jerga nuestra. Ni "sincronizar", ni "subir", ni "error de red". Qué pasó y qué
//    tiene que hacer.
//  · Todo lo que se toca es grande. Esto se usa con una mano, de pie, con el camión al lado.

interface Linea { id_venta: string; key: string; pedido: number; entregado: number }
interface Entrega {
  clave: string; fecha: string; id_control: string; cliente: string; sucursal: string;
  lineas: Linea[]; yaFacturada: boolean; comprobante: string;
  estado: 'sin_confirmar' | 'validada' | 'auto';
  validado_por: string; validado_en: string; cajones_devueltos: number; cajonesAfuera: number;
}

const LS_PENDIENTES = 'reparto_pendientes_v1';

type Envio = 'guardada' | 'enviando' | 'sin_enviar';

const leerCola = (): Record<string, any> => {
  try { return JSON.parse(localStorage.getItem(LS_PENDIENTES) || '{}') || {}; } catch { return {}; }
};
const escribirCola = (c: Record<string, any>) => {
  try { localStorage.setItem(LS_PENDIENTES, JSON.stringify(c)); } catch { /* modo privado: se pierde al cerrar, pero la pantalla sigue andando */ }
};

const fmtDia = (iso: string) => { const [, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}` : iso; };
const hora = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

export default function RepartoManager({ nombre, esAdmin }: { nombre: string; esAdmin: boolean }) {
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [etiquetas, setEtiquetas] = useState<Record<string, string>>({});
  const [fecha, setFecha] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, number>>({});
  const [cajones, setCajones] = useState(0);
  const [envios, setEnvios] = useState<Record<string, Envio>>({});
  const [exito, setExito] = useState<{ clave: string; cliente: string; comprobante: string; diferencias: number } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/reparto/dia', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo abrir la lista.');
      setEntregas(j.entregas || []);
      setEtiquetas(j.etiquetas || {});
      setFecha(j.fecha || '');
    } catch (e: any) {
      setError(e?.message || 'No se pudo abrir la lista. Fijate que tengas señal y volvé a probar.');
    } finally {
      setCargando(false);
    }
  }, []);

  // ── La cola de lo que todavía no llegó a la app ────────────────────────────────────
  //
  // Se guarda primero en el celular y después se manda. Si falla, queda acá y se reintenta
  // al volver la señal y cada vez que se abre la pantalla. Nada se da por guardado hasta
  // que el servidor contesta que sí.
  const enviar = useCallback(async (clave: string, payload: any) => {
    setEnvios((p) => ({ ...p, [clave]: 'enviando' }));
    try {
      const r = await fetch('/api/reparto/confirmar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo confirmar.');
      const cola = leerCola(); delete cola[clave]; escribirCola(cola);
      setEnvios((p) => { const n = { ...p }; delete n[clave]; return n; });
      return j;
    } catch {
      setEnvios((p) => ({ ...p, [clave]: 'sin_enviar' }));
      return null;
    }
  }, []);

  const reintentar = useCallback(async () => {
    const cola = leerCola();
    for (const [clave, payload] of Object.entries(cola)) await enviar(clave, payload);
    if (Object.keys(cola).length) cargar();
  }, [enviar, cargar]);

  useEffect(() => {
    cargar();
    const cola = leerCola();
    if (Object.keys(cola).length) {
      setEnvios(Object.fromEntries(Object.keys(cola).map((k) => [k, 'sin_enviar' as Envio])));
      reintentar();
    }
    window.addEventListener('online', reintentar);
    return () => window.removeEventListener('online', reintentar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sinEnviar = Object.values(envios).filter((e) => e === 'sin_enviar').length;
  const confirmadas = entregas.filter((e) => e.estado !== 'sin_confirmar').length;

  const abrir = (e: Entrega) => {
    setBorrador(Object.fromEntries(e.lineas.map((l) => [`${l.id_venta}||${l.key}`, l.entregado])));
    setCajones(e.cajones_devueltos || 0);
    setAbierta(e.clave);
    setExito(null);
  };

  const confirmar = async (e: Entrega) => {
    const lineas = e.lineas.map((l) => ({
      id_venta: l.id_venta, key: l.key,
      entregado: borrador[`${l.id_venta}||${l.key}`] ?? l.pedido,
    }));
    const payload = {
      fecha: e.fecha, id_control: e.id_control, sucursal: e.sucursal,
      lineas, cajones_devueltos: cajones, nota: '',
    };
    // Primero al celular, después al servidor. Si el orden fuera al revés, una entrega
    // confirmada sin señal se perdería sin que nadie se entere.
    const cola = leerCola(); cola[e.clave] = payload; escribirCola(cola);
    setAbierta(null);
    const difs = lineas.filter((l, i) => l.entregado !== e.lineas[i].pedido).length;
    setExito({ clave: e.clave, cliente: e.cliente, comprobante: '', diferencias: difs });
    setEntregas((prev) => prev.map((x) => x.clave === e.clave
      ? { ...x, estado: 'validada', validado_por: nombre, validado_en: new Date().toISOString(), cajones_devueltos: cajones, lineas: x.lineas.map((l, i) => ({ ...l, entregado: lineas[i].entregado })) }
      : x));
    const j = await enviar(e.clave, payload);
    if (j) setExito({ clave: e.clave, cliente: e.cliente, comprobante: j.comprobante || '', diferencias: difs });
  };

  const detalle = useMemo(() => entregas.find((e) => e.clave === abierta) || null, [entregas, abierta]);

  // ══ Una entrega ═══════════════════════════════════════════════════════════════════
  if (detalle) {
    const resumen = detalle.lineas
      .map((l) => `${borrador[`${l.id_venta}||${l.key}`] ?? l.pedido} ${etiquetas[l.key] || l.key}`)
      .join(' · ');
    return (
      <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
        <div style={{ background: '#111827', color: 'white', padding: '14px 16px' }}>
          <button type="button" onClick={() => setAbierta(null)}
            style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', padding: 0, marginBottom: '8px' }}>
            ‹ Entregas de hoy
          </button>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>{detalle.cliente}</h1>
          <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '3px' }}>
            {detalle.sucursal ? `${detalle.sucursal} · ` : ''}{fmtDia(detalle.fecha)}
          </div>
        </div>

        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
          <p style={{ margin: 0, fontSize: '13.5px', color: '#374151', lineHeight: 1.45 }}>
            Esto es lo que se cargó. <strong>Tocá solo lo que dejaste distinto.</strong>
          </p>

          {detalle.lineas.map((l) => {
            const k = `${l.id_venta}||${l.key}`;
            const val = borrador[k] ?? l.pedido;
            const cambiado = val !== l.pedido;
            return (
              <div key={k} style={{
                background: cambiado ? '#fffbeb' : 'white',
                border: cambiado ? '2px solid #fcd34d' : '1px solid #e5e7eb',
                borderRadius: '12px', padding: '11px 13px', display: 'flex', alignItems: 'center', gap: '10px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15.5px', fontWeight: 700, color: '#111827' }}>{etiquetas[l.key] || l.key}</div>
                  <div style={{ fontSize: '12px', color: cambiado ? '#b45309' : '#9ca3af', marginTop: '2px', fontWeight: cambiado ? 600 : 400 }}>
                    {cambiado ? `se habían cargado ${l.pedido}` : 'tal como se cargó'}
                  </div>
                </div>
                <button type="button" aria-label={`Menos ${etiquetas[l.key] || l.key}`}
                  onClick={() => setBorrador((b) => ({ ...b, [k]: Math.max(0, (b[k] ?? l.pedido) - 1) }))}
                  style={botonPaso}>−</button>
                <span style={{ minWidth: '42px', textAlign: 'center', fontSize: '24px', fontWeight: 800, color: cambiado ? '#b45309' : '#111827' }}>{val}</span>
                <button type="button" aria-label={`Más ${etiquetas[l.key] || l.key}`}
                  onClick={() => setBorrador((b) => ({ ...b, [k]: (b[k] ?? l.pedido) + 1 }))}
                  style={botonPaso}>+</button>
              </div>
            );
          })}

          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '11px 13px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15.5px', fontWeight: 700, color: '#111827' }}>Cajones que me devolvieron</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                {detalle.cajonesAfuera > 0 ? `tienen ${detalle.cajonesAfuera} afuera` : 'no figuran con cajones afuera'}
              </div>
            </div>
            <button type="button" aria-label="Menos cajones" onClick={() => setCajones((c) => Math.max(0, c - 1))} style={botonPaso}>−</button>
            <span style={{ minWidth: '42px', textAlign: 'center', fontSize: '24px', fontWeight: 800, color: '#111827' }}>{cajones}</span>
            <button type="button" aria-label="Más cajones" onClick={() => setCajones((c) => c + 1)} style={botonPaso}>+</button>
          </div>

          {detalle.yaFacturada && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '11px 13px', fontSize: '12.5px', color: '#1e3a8a', lineHeight: 1.5 }}>
              A este cliente ya se le hizo la factura {detalle.comprobante}. Confirmá igual lo que dejaste:
              queda anotada la diferencia para que administración la corrija.
            </div>
          )}
        </div>

        <div style={{ padding: '12px 14px 24px' }}>
          <button type="button" onClick={() => confirmar(detalle)}
            style={{ width: '100%', background: '#166534', color: 'white', border: 'none', fontSize: '16.5px', fontWeight: 800, padding: '16px', borderRadius: '12px' }}>
            Confirmar la entrega
          </button>
          <p style={{ margin: '9px 0 0', fontSize: '12px', color: '#6b7280', textAlign: 'center', lineHeight: 1.45 }}>
            Se va a facturar <strong style={{ color: '#374151' }}>{resumen}</strong>
          </p>
        </div>
      </div>
    );
  }

  // ══ La lista del día ══════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <div style={{ background: '#111827', color: 'white', padding: '18px 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 800 }}>Entregas de hoy</h1>
          <span style={{ fontSize: '13px', color: '#d1d5db' }}>{fmtDia(fecha)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <div style={{ flex: 1, height: '8px', borderRadius: '99px', background: '#374151', overflow: 'hidden' }}>
            <div style={{ width: `${entregas.length ? Math.round((confirmadas / entregas.length) * 100) : 0}%`, height: '8px', background: '#22c55e' }} />
          </div>
          <span style={{ fontSize: '13px', color: '#e5e7eb', whiteSpace: 'nowrap' }}>{confirmadas} de {entregas.length}</span>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: '#9ca3af', lineHeight: 1.45 }}>
          Hola {nombre}. Confirmá lo que dejaste en cada cliente: eso es lo que se le factura.
        </p>
      </div>

      {sinEnviar > 0 && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1, fontSize: '13px', color: '#92400e', lineHeight: 1.4 }}>
            <strong>{sinEnviar} {sinEnviar === 1 ? 'entrega guardada' : 'entregas guardadas'} en el celular</strong> — todavía no {sinEnviar === 1 ? 'llegó' : 'llegaron'} a la app.
          </div>
          <button type="button" onClick={reintentar}
            style={{ background: 'white', border: '1px solid #fcd34d', color: '#92400e', fontWeight: 700, fontSize: '13px', padding: '9px 13px', borderRadius: '8px' }}>
            Probar de nuevo
          </button>
        </div>
      )}

      {exito && (
        <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '12px 16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: '#166534' }}>✓ {exito.cliente} confirmada</div>
          <div style={{ fontSize: '12.5px', color: '#15803d', marginTop: '3px', lineHeight: 1.45 }}>
            {envios[exito.clave] === 'sin_enviar'
              ? 'Guardada en el celular — todavía no llegó a la app.'
              : exito.comprobante
                ? `Se hizo la factura ${exito.comprobante}.`
                : 'Administración la va a facturar.'}
            {exito.diferencias > 0 ? ' Avisamos de la diferencia.' : ''}
          </div>
        </div>
      )}

      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {cargando && <p style={{ margin: 0, fontSize: '13.5px', color: '#6b7280' }}>Buscando las entregas del día…</p>}

        {!cargando && error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '13px 15px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#b91c1c', marginBottom: '4px' }}>No se pudo abrir la lista</div>
            <div style={{ fontSize: '13px', color: '#7f1d1d', lineHeight: 1.5, marginBottom: '10px' }}>{error}</div>
            <button type="button" onClick={cargar} style={{ background: 'white', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 700, fontSize: '13.5px', padding: '10px 14px', borderRadius: '8px' }}>
              Probar de nuevo
            </button>
          </div>
        )}

        {!cargando && !error && entregas.length === 0 && (
          <p style={{ margin: 0, fontSize: '13.5px', color: '#6b7280', lineHeight: 1.5 }}>
            Todavía no hay entregas cargadas para hoy. Volvé a entrar más tarde.
          </p>
        )}

        {entregas.map((e) => {
          const confirmada = e.estado !== 'sin_confirmar';
          const cambios = e.lineas.filter((l) => l.entregado !== l.pedido).length;
          const enCola = envios[e.clave];
          return (
            <button key={e.clave} type="button" onClick={() => abrir(e)} style={{
              textAlign: 'left', background: 'white', borderRadius: '12px', padding: '13px 15px', width: '100%',
              border: confirmada ? '1px solid #e5e7eb' : '2px solid #166534',
              opacity: confirmada ? 0.8 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '5px' }}>
                <span style={{ fontSize: '16px', fontWeight: 800, color: '#111827' }}>{e.cliente}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', color: enCola === 'sin_enviar' ? '#92400e' : confirmada ? (cambios ? '#b45309' : '#166534') : '#166534' }}>
                  {enCola === 'enviando' ? 'Guardando…'
                    : enCola === 'sin_enviar' ? '⏱ en el celular'
                    : confirmada ? (cambios ? '✓ con cambios' : '✓ tal cual')
                    : 'Confirmar'}
                </span>
              </div>
              {e.sucursal && <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '7px' }}>{e.sucursal}{confirmada && e.validado_en ? ` · ${hora(e.validado_en)}` : ''}</div>}
              <div style={{ fontSize: '13.5px', color: '#374151', lineHeight: 1.5 }}>
                {e.lineas.map((l) => `${l.entregado} ${etiquetas[l.key] || l.key}`).join(' · ')}
              </div>
            </button>
          );
        })}

        {esAdmin && !cargando && (
          <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#9ca3af', lineHeight: 1.5 }}>
            Estás viendo esto como administrador. Lo que confirmes acá vale igual que si lo hiciera el reparto.
          </p>
        )}
      </div>
    </div>
  );
}

const botonPaso: React.CSSProperties = {
  width: '46px', height: '46px', borderRadius: '10px', border: '1px solid #d1d5db',
  background: 'white', fontSize: '22px', color: '#374151', lineHeight: 1, flexShrink: 0,
};
