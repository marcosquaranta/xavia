'use client';
import { useState } from 'react';
import DeudaProveedores from './DeudaProveedores';
import type { DeudaProveedor } from '@/lib/proveedores';

// ── La deuda a proveedores, cerrada por defecto ──────────────────────────────────────
//
// Ocupaba media pantalla arriba de todo, todos los días, con el mismo contenido. Lo que
// hay que mirar a diario no es el detalle de cada compra: es si hay algo vencido. Eso
// entra en un renglón, y el detalle se abre cuando hace falta.
//
// Cerrada NO quiere decir escondida: el renglón dice cuánto se debe y, si hay algo
// vencido, lo dice en rojo. Una deuda vencida que haya que abrir un panel para enterarse
// es una deuda que nadie ve.
export default function DeudaProveedoresCard({ deuda, medios }: { deuda: DeudaProveedor[]; medios: string[] }) {
  const [abierto, setAbierto] = useState(false);
  if (!deuda.length) return null;

  const total = deuda.reduce((a, d) => a + d.total, 0);
  const vencido = deuda.reduce((a, d) => a + d.vencido, 0);
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const proveedores = deuda.length === 1 ? deuda[0].proveedor : `${deuda.length} proveedores`;

  if (!abierto) {
    return (
      <div className="card" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>
            Deuda a proveedores · <strong>{$(total)}</strong>
          </p>
          <p className="card-sub" style={{ margin: '2px 0 0' }}>
            {proveedores} · compras cargadas que todavía no se pagaron.
            {vencido > 0
              ? <span style={{ color: '#b91c1c', fontWeight: 700 }}> {$(vencido)} ya vencido.</span>
              : ' Nada vencido todavía.'}
          </p>
        </div>
        <button type="button" className="btn secondary" style={{ fontSize: '13px' }} onClick={() => setAbierto(true)}>Ver →</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <p className="card-title" style={{ margin: 0 }}>Deuda a proveedores · {$(total)}</p>
        <button type="button" onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Cerrar</button>
      </div>
      <p className="card-sub">Compras cargadas que todavía no se pagaron, de lo que vence antes a lo que vence después.</p>
      <div style={{ marginTop: '10px' }}>
        <DeudaProveedores deuda={deuda} medios={medios} />
      </div>
    </div>
  );
}
