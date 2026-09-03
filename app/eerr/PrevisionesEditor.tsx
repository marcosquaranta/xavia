'use client';
import { useState } from 'react';

// Editor de las previsiones del mes. La app propone (6% de la masa salarial para despidos,
// un doceavo para el SAC) pero lo guardado manda: si el mes cerrado se recalculara solo cada
// vez que se corrige un sueldo cargado tarde, no serviría para comparar contra nada.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

export default function PrevisionesEditor({ anio, mes, masaSalarial, sugeridas, guardadas }: {
  anio: number; mes: number; masaSalarial: number;
  sugeridas: { despidos: number; sac: number };
  guardadas: { despidos: number; sac: number; alquiler: number; epe: number; notas: string; fecha: string } | null;
}) {
  const [despidos, setDespidos] = useState(String(Math.round(guardadas?.despidos ?? sugeridas.despidos)));
  const [sac, setSac] = useState(String(Math.round(guardadas?.sac ?? sugeridas.sac)));
  // Sin fórmula: van a mano, igual que en el Excel.
  const [alquiler, setAlquiler] = useState(String(Math.round(guardadas?.alquiler ?? 0)));
  const [epe, setEpe] = useState(String(Math.round(guardadas?.epe ?? 0)));
  const [notas, setNotas] = useState(guardadas?.notas ?? '');
  const [estado, setEstado] = useState<'idle' | 'guardando' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [yaGuardado, setYaGuardado] = useState(!!guardadas);

  const difDespidos = Math.abs(Number(despidos) - sugeridas.despidos) > 1;
  const difSac = Math.abs(Number(sac) - sugeridas.sac) > 1;

  async function guardar() {
    setEstado('guardando'); setError(null);
    try {
      const res = await fetch('/api/previsiones/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, despidos: Number(despidos), sac: Number(sac), alquiler: Number(alquiler), epe: Number(epe), notas }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setEstado('ok'); setYaGuardado(true);
    } catch (e: any) {
      setEstado('error'); setError(e?.message || 'No se pudo guardar');
    }
  }

  const campo = (label: string, valor: string, set: (v: string) => void, sugerido: number, distinto: boolean) => (
    <div style={{ minWidth: '190px' }}>
      <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>{label}</label>
      <input
        type="number" value={valor} min={0} step={1}
        onChange={(e) => { set(e.target.value); setEstado('idle'); }}
        style={{ width: '100%', textAlign: 'right', fontSize: '15px', fontWeight: 700, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      />
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: distinto ? '#b45309' : '#9ca3af' }}>
        {distinto ? `Editado a mano · la fórmula da ${$(sugerido)}` : `Según la fórmula: ${$(sugerido)}`}
        {distinto && (
          <button onClick={() => { set(String(Math.round(sugerido))); setEstado('idle'); }}
            style={{ marginLeft: '6px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: '11px', fontWeight: 600 }}>
            volver
          </button>
        )}
      </p>
    </div>
  );

  // Los que no tienen fórmula: solo se guardan, sin sugerencia que comparar.
  const libre = (label: string, valor: string, set: (v: string) => void) => (
    <div style={{ minWidth: '140px' }}>
      <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>{label}</label>
      <input
        type="number" value={valor} min={0} step={1}
        onChange={(e) => { set(e.target.value); setEstado('idle'); }}
        style={{ width: '100%', textAlign: 'right', fontSize: '15px', fontWeight: 700, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      />
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#9ca3af' }}>Sin fórmula: se carga a mano</p>
    </div>
  );

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6b7280' }}>
        Sobre una masa salarial de <strong>{$(masaSalarial)}</strong> — despidos 6%, SAC un doceavo.
        {masaSalarial === 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> No hay sueldos cargados este mes, así que la fórmula da cero.</span>}
      </p>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {campo('Previsión despidos', despidos, setDespidos, sugeridas.despidos, difDespidos)}
        {campo('Previsión SAC', sac, setSac, sugeridas.sac, difSac)}
        {libre('Alquiler', alquiler, setAlquiler)}
        {libre('EPE', epe, setEpe)}
        <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>Notas</label>
          <input
            type="text" value={notas} placeholder="Por qué se cambió, si se cambió"
            onChange={(e) => { setNotas(e.target.value); setEstado('idle'); }}
            style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
        <button onClick={guardar} className="btn" disabled={estado === 'guardando'} style={{ fontSize: '13px' }}>
          {estado === 'guardando' ? 'Guardando…' : yaGuardado ? 'Actualizar previsiones' : 'Guardar previsiones'}
        </button>
        {estado === 'ok' && <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>✓ Guardado</span>}
        {estado === 'error' && <span style={{ fontSize: '12px', color: '#dc2626' }}>No se guardó: {error}</span>}
        {estado === 'idle' && !yaGuardado && (
          <span style={{ fontSize: '11.5px', color: '#b45309' }}>Todavía sin guardar para este mes — se está mostrando la sugerencia.</span>
        )}
        {estado === 'idle' && yaGuardado && guardadas && (
          <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
            Guardado el {String(guardadas.fecha).split('T')[0].split('-').reverse().join('/')}
          </span>
        )}
      </div>
    </div>
  );
}
