'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RestaurarLoteButton({ idLote, small = false }: { idLote: string; small?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRestaurar() {
    if (!confirm(`¿Restaurar el lote ${idLote}? Vuelve a aparecer en Mis Cultivos con su historial intacto.`)) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('id_lote', idLote);
      const res = await fetch('/api/lotes/restaurar', { method: 'POST', body: fd });
      if (res.ok || res.redirected) router.refresh();
      else alert('Error al restaurar. Verificá que seas admin.');
    } catch {
      alert('Error al restaurar. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={small ? 'btn secondary small' : 'btn secondary'}
      onClick={handleRestaurar}
      disabled={loading}
      style={{ color: '#166534', borderColor: '#166534' }}
    >
      {loading ? 'Restaurando…' : '↺ Restaurar'}
    </button>
  );
}
