'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function BuscadorLote({ baseUrl }: { baseUrl: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) {
        params.set('q', query.trim());
        // Limpiar filtros de fase/nave cuando se busca por ID
        params.delete('filtro');
        params.delete('nave');
      } else {
        params.delete('q');
      }
      router.push(`${baseUrl}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div style={{ position: 'relative', marginBottom: '10px' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por Nro Lote (ej: N1-007, N1L1-007)..."
        style={{ paddingLeft: '32px', background: 'white' }}
      />
      <span style={{
        position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
        fontSize: '14px', color: '#9ca3af', pointerEvents: 'none',
      }}>🔍</span>
      {query && (
        <button
          onClick={() => setQuery('')}
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
