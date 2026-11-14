'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import RestaurarLoteButton from '@/components/RestaurarLoteButton';

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
  const [loadingDescartar, setLoadingDescartar] = useState(false);

  const activo = estado === 'activo';
  const esBorrado = estado === 'borrado';
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

  // Se pide el motivo en el mismo paso: un lote descartado sin explicación es un agujero
  // en las estadísticas que nadie va a poder interpretar dentro de tres meses.
  async function handleDescartar() {
    const motivo = window.prompt(
      `Descartar el lote ${idLote} entero.\n\n`
      + 'Las plantas que quedan se registran como descarte y la mesada queda libre. '
      + 'No es lo mismo que "Borrar lote": esto es una pérdida real y se ve en las estadísticas.\n\n'
      + '¿Por qué se descarta?',
    );
    if (motivo === null) return;
    if (!motivo.trim()) { alert('Hace falta el motivo para descartar el lote.'); return; }
    setLoadingDescartar(true);
    try {
      const res = await fetch('/api/lotes/descartar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_lote: idLote, motivo: motivo.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'No se pudo descartar');
      alert(j?.mensaje || 'Lote descartado.');
      router.push('/cultivos');
      router.refresh();
    } catch (err: any) {
      alert(err?.message || 'Error al descartar. Intentá de nuevo.');
    } finally {
      setLoadingDescartar(false);
    }
  }

  async function handleBorrar() {
    if (!confirm(`¿Borrar el lote ${idLote}? Deja de aparecer en Mis Cultivos y en los cálculos, pero se puede restaurar después desde el filtro "Borrados".`)) return;
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

  if (esBorrado) {
    return (
      <div className="card">
        <p className="card-title">Acciones</p>
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#b91c1c' }}>Este lote está borrado — no aparece en Mis Cultivos ni en ningún cálculo.</p>
        {esAdmin && <RestaurarLoteButton idLote={idLote} />}
      </div>
    );
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
        {/* ── Descartar el lote entero ──────────────────────────────────────────────
            No es "Borrar lote": borrar es para una carga equivocada y saca al lote de
            todos los cálculos. Esto es para una pérdida real —se pasó de ciclo, se
            enfermó— y tiene que verse en las estadísticas. Libera la mesada y deja el
            descarte registrado, que son las dos cosas que antes había que hacer por
            separado y terminaban a medias: el lote seguía figurando en la mesada. */}
        {activo && (
          <button className="btn secondary" style={{ borderColor: '#fecaca', color: '#b91c1c' }}
            onClick={handleDescartar} disabled={loadingDescartar}>
            {loadingDescartar ? 'Descartando…' : '🗑 Descartar lote'}
          </button>
        )}
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
