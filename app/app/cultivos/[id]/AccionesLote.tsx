'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  idLote: string;
  faseActual: string;
  estado: string;
  esAdmin: boolean;
  ultimoMovId?: string | number;
  ultimoMovTipo?: string;
  ultimoMovFecha?: string;
}

export default function AccionesLote({
  idLote, faseActual, estado, esAdmin,
  ultimoMovId, ultimoMovTipo, ultimoMovFecha,
}: Props) {
  const router = useRouter();
  const [loadingDeshacer, setLoadingDeshacer] = useState(false);
  const [loadingBorrar, setLoadingBorrar] = useState(false);

  const activo = estado === 'activo';
  const puedeDeshacer = ultimoMovId && (ultimoMovTipo === 'trasplante' || ultimoMovTipo === 'cosecha');

  async function handleDeshacer() {
    if (!confirm(`¿Deshacer el último movimiento (${ultimoMovTipo} del ${ultimoMovFecha})?`)) return;
    setLoadingDeshacer(true);
    try {
      const fd = new FormData();
      fd.append('id_lote', idLote);
      fd.append('id_movimiento', String(ultimoMovId));
      const res = await fetch('/api/lotes/deshacer', { method: 'POST', body: fd });
      if (res.ok || res.redirected) {
        router.push(`/cultivos/${encodeURIComponent(idLote)}`);
        router.refresh();
      }
    } catch (err) {
      alert('Error al deshacer. Intentá de nuevo.');
    } finally {
      setLoadingDeshacer(false);
    }
  }

  async function handleBorrar() {
    if (!confirm(`¿Borrar permanentemente el lote ${idLote} y todos sus movimientos? Esta acción no se puede revertir.`)) return;
    setLoadingBorrar(true);
    try {
      const fd = new FormData();
      fd.append('id_lote', idLote);
      const res = await fetch('/api/lotes/borrar', { method: 'POST', body: fd });
      if (res.ok || res.redirected) {
        router.push('/cultivos');
        router.refresh();
      } else {
        alert('Error al borrar. Verificá que seas admin.');
      }
    } catch (err) {
      alert('Error al borrar. Intentá de nuevo.');
    } finally {
      setLoadingBorrar(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Acciones</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {activo && faseActual !== 'fase_2' && (
          <Link href={`/cultivos/${encodeURIComponent(idLote)}/trasplantar`} className="btn">
            Trasplantar
          </Link>
        )}
        {activo && faseActual === 'fase_2' && (
          <Link href={`/cultivos/${encodeURIComponent(idLote)}/cosechar`} className="btn">
            Cosechar
          </Link>
        )}
        <Link href={`/cultivos/${encodeURIComponent(idLote)}/editar`} className="btn secondary">
          Editar lote
        </Link>
        {puedeDeshacer && (
          <button
            className="btn secondary"
            onClick={handleDeshacer}
            disabled={loadingDeshacer}
          >
            {loadingDeshacer ? 'Deshaciendo…' : '↶ Deshacer último'}
          </button>
        )}
        {esAdmin && (
          <button
            className="btn danger"
            onClick={handleBorrar}
            disabled={loadingBorrar}
          >
            {loadingBorrar ? 'Borrando…' : 'Borrar lote'}
          </button>
        )}
      </div>
    </div>
  );
}
