'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CULTIVOS_DESCARTE } from '@/lib/cultivosCamara';

// ── Cargar descarte de cámara ─────────────────────────────────────────────────────────
//
// Producto ya empaquetado que se tiró: podrido, pasado, golpeado, una devolución.
//
// Es su propio formulario y no un campo del ajuste de stock, porque son dos cosas
// distintas: el faltante de un ajuste es producto que NO SE SABE dónde está; el descarte es
// producto que alguien decidió tirar y sabe por qué. Y porque para anotar 20 paquetes
// podridos no tiene que hacer falta recontar la cámara entera — obligar a eso era garantía
// de que el descarte no se cargara nunca.
//
// Vive acá, compartido, para poder estar en los tres lugares donde uno se acuerda de
// cargarlo: el panel, el detalle de stock de cada cultivo y la pantalla de stocks. Un
// formulario copiado tres veces se arregla en uno solo y queda roto en los otros dos.

export { CULTIVOS_DESCARTE } from '@/lib/cultivosCamara';

const MOTIVOS = ['Podrido', 'Pasado / amarillo', 'Golpeado', 'Devolución de cliente', 'Otro'];

export default function CargarDescarteCamara({ cultivo, label, compacto = false, onSaved }: {
  // Con `cultivo` fijo no se puede equivocar de cultivo; sin él, se elige en el formulario
  // (es el caso del panel, donde la tarjeta cubre los cuatro).
  cultivo?: string;
  label?: string;
  compacto?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cultivoSel, setCultivoSel] = useState(cultivo || 'rucula');
  const [paquetes, setPaquetes] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  function cerrar() {
    setAbierto(false); setPaquetes(''); setMotivo(''); setNotas(''); setMsg(null);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(paquetes) > 0)) { setMsg({ t: 'err', s: 'Poné cuántos paquetes se tiraron.' }); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/stocks/camara/descarte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cultivo: cultivo || cultivoSel,
          fecha,
          descarte_paq: Number(paquetes),
          notas: [motivo, notas].filter(Boolean).join(' — '),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg({ t: 'ok', s: `Registrado: ${Number(paquetes)} paq de descarte.` });
      setPaquetes(''); setMotivo(''); setNotas('');
      // La pantalla se arma en el servidor y esto pasó en el navegador: sin refrescar, el
      // stock sigue mostrando el de antes y parece que el click no hizo nada.
      router.refresh();
      onSaved?.();
    } catch (err: any) {
      setMsg({ t: 'err', s: err.message || 'No se pudo guardar' });
    } finally {
      setLoading(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        style={{
          fontSize: compacto ? '11px' : '12px', fontWeight: 700, padding: compacto ? '4px 10px' : '6px 12px',
          background: '#fff', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}>
        🗑️ Cargar descarte{label ? ` · ${label}` : ''}
      </button>
    );
  }

  return (
    <form onSubmit={guardar} style={{
      border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '8px',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '240px',
    }}>
      <div>
        <p style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#991b1b' }}>
          Descarte de cámara{cultivo && label ? ` · ${label}` : ''}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#9ca3af' }}>
          Producto que se tiró. Sale del stock y cuenta como descarte. No hace falta recontar nada.
        </p>
      </div>

      {!cultivo && (
        <div>
          <label style={{ fontSize: '11px' }}>Cultivo</label>
          <select value={cultivoSel} onChange={(e) => setCultivoSel(e.target.value)} disabled={loading}>
            {CULTIVOS_DESCARTE.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(105px,1fr))', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '11px' }}>Paquetes tirados</label>
          <input type="number" value={paquetes} onChange={(e) => setPaquetes(e.target.value)}
            min="1" step="any" disabled={loading} autoFocus />
        </div>
        <div>
          <label style={{ fontSize: '11px' }}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading} />
        </div>
      </div>

      <div>
        <label style={{ fontSize: '11px' }}>Motivo</label>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={loading}>
          <option value="">Sin especificar</option>
          {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div>
        <label style={{ fontSize: '11px' }}>Notas</label>
        <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
          disabled={loading} placeholder="Opcional" />
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#166534' : '#dc2626' }}>
          {msg.s}
        </p>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" disabled={loading}
          style={{ flex: 1, fontSize: '12px', fontWeight: 700, padding: '5px 12px', background: '#991b1b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          {loading ? 'Guardando…' : 'Registrar descarte'}
        </button>
        <button type="button" onClick={cerrar} disabled={loading}
          style={{ fontSize: '12px', padding: '5px 12px', background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}>
          Cerrar
        </button>
      </div>
    </form>
  );
}
