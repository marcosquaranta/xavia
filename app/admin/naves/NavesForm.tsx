// app/admin/naves/NavesForm.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Ubicacion } from '@/lib/types';

interface UbicacionEditable extends Ubicacion {
  modulos_edit: number;
  perfiles_por_modulo_edit: number;
  orificios_por_perfil_edit: number;
}

export default function NavesForm({ ubicaciones }: { ubicaciones: Ubicacion[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [items, setItems] = useState<UbicacionEditable[]>(
    ubicaciones.map((u) => ({
      ...u,
      modulos_edit: Number(u.modulos) || 0,
      perfiles_por_modulo_edit: Number(u.perfiles_por_modulo) || 0,
      orificios_por_perfil_edit: Number(u.orificios_por_perfil) || 0,
    }))
  );

  function actualizar(idx: number, campo: keyof UbicacionEditable, valor: number) {
    setItems((prev) => {
      const nuevo = [...prev];
      nuevo[idx] = { ...nuevo[idx], [campo]: valor };
      return nuevo;
    });
  }

  function capacidadCalculada(item: UbicacionEditable): number {
    return (
      item.modulos_edit *
      item.perfiles_por_modulo_edit *
      item.orificios_por_perfil_edit
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMensaje(null);
    try {
      const cambios = items.map((u) => ({
        id_ubicacion: u.id_ubicacion,
        modulos: u.modulos_edit,
        perfiles_por_modulo: u.perfiles_por_modulo_edit,
        orificios_por_perfil: u.orificios_por_perfil_edit,
        capacidad_calculada: capacidadCalculada(u),
      }));
      const res = await fetch('/api/admin/naves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ubicaciones: cambios }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al guardar');
      }
      setMensaje('Cambios guardados correctamente');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  }

  // Agrupar por nave
  const itemsPorNave: Record<number, UbicacionEditable[]> = {};
  for (const u of items) {
    const nave = Number(u.nave);
    if (!itemsPorNave[nave]) itemsPorNave[nave] = [];
    itemsPorNave[nave].push(u);
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="alert-box error" style={{ marginBottom: '14px' }}>
          {error}
        </div>
      )}
      {mensaje && (
        <div className="alert-box success" style={{ marginBottom: '14px' }}>
          {mensaje}
        </div>
      )}

      {Object.entries(itemsPorNave).map(([nave, items]) => {
        const totalNave = items.reduce((acc, u) => acc + capacidadCalculada(u), 0);
        const m2 = Number(items[0]?.metros_cuadrados) || 0;
        return (
          <div key={nave} className="card">
            <p className="card-title">
              Nave {nave} ({m2} m²)
            </p>
            <p className="card-sub">
              Capacidad calculada: <strong>{totalNave.toLocaleString('es-AR')}</strong>{' '}
              posiciones · Densidad máx:{' '}
              {m2 > 0 ? Math.round((totalNave / m2) * 10) / 10 : 0} pl/m²
            </p>

            <table>
              <thead>
                <tr>
                  <th>Ubicación</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Módulos</th>
                  <th style={{ textAlign: 'right' }}>Perfiles/mód</th>
                  <th style={{ textAlign: 'right' }}>Orif/perfil</th>
                  <th style={{ textAlign: 'right' }}>Capacidad</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u, i) => {
                  const idx = items.indexOf(u);
                  const realIdx = items.findIndex(
                    (x) => x.id_ubicacion === u.id_ubicacion
                  );
                  // El idx que necesitamos para actualizar está en el array general
                  const indexEnTodos = (() => {
                    const flat: UbicacionEditable[] = [];
                    for (const arr of Object.values(itemsPorNave)) flat.push(...arr);
                    return flat.findIndex((x) => x.id_ubicacion === u.id_ubicacion);
                  })();
                  return (
                    <tr key={u.id_ubicacion}>
                      <td>{u.nombre}</td>
                      <td style={{ color: '#6b7280', fontSize: '11px' }}>
                        {u.tipo === 'plantinera'
                          ? 'plantinera'
                          : u.sector_fase === 'fase_1'
                          ? 'F1'
                          : u.sector_fase === 'fase_2'
                          ? 'F2'
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          value={u.modulos_edit}
                          onChange={(e) =>
                            actualizar(
                              indexEnTodos,
                              'modulos_edit',
                              Number(e.target.value)
                            )
                          }
                          min={0}
                          disabled={loading}
                          style={{ width: '60px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          value={u.perfiles_por_modulo_edit}
                          onChange={(e) =>
                            actualizar(
                              indexEnTodos,
                              'perfiles_por_modulo_edit',
                              Number(e.target.value)
                            )
                          }
                          min={0}
                          disabled={loading}
                          style={{ width: '70px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          value={u.orificios_por_perfil_edit}
                          onChange={(e) =>
                            actualizar(
                              indexEnTodos,
                              'orificios_por_perfil_edit',
                              Number(e.target.value)
                            )
                          }
                          min={0}
                          disabled={loading}
                          style={{ width: '70px', textAlign: 'right' }}
                        />
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 500,
                          color: '#059669',
                        }}
                      >
                        {Math.round(capacidadCalculada(u)).toLocaleString('es-AR')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => router.push('/admin')}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
