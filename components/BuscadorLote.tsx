'use client';
import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function BuscadorLote({ baseUrl }: { baseUrl: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La navegación (debounced) se dispara solo desde la interacción del usuario (escribir
  // o limpiar), nunca desde un efecto atado al montaje — si no, cuando baseUrl apunta a
  // otra página (ej. el buscador del home apuntando a /cultivos) navegaba solo apenas se
  // cargaba el componente, sin que el usuario tocara nada.
  function actualizar(valor: string) {
    setQuery(valor);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (valor.trim()) {
        params.set('q', valor.trim());
        // Limpiar filtros de fase/nave cuando se busca por ID
        params.delete('filtro');
        params.delete('nave');
      } else {
        params.delete('q');
      }
      router.push(`${baseUrl}?${params.toString()}`);
    }, 300);
  }

  return (
    <div style={{ position: 'relative', marginBottom: '10px' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => actualizar(e.target.value)}
        placeholder="Buscar por Nro Lote (ej: N1-007, N1L1-007)..."
        style={{ paddingLeft: '32px', background: 'white' }}
      />
      <span style={{
        position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
        fontSize: '14px', color: '#9ca3af', pointerEvents: 'none',
      }}>🔍</span>
      {query && (
        <button
          onClick={() => actualizar('')}
          style={{
            position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: '#9ca3af', fontSize: '16px',
            padding: '0', lineHeight: 1, cursor: 'pointer',
          }}
        >×</button>
      )}
    </div>
  );
}
