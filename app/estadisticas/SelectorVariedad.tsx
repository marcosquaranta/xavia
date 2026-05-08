'use client';
import { useRouter } from 'next/navigation';
export default function SelectorVariedad({ variedades, seleccionada }: { variedades: string[]; seleccionada: string }) {
  const router = useRouter();
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Variedad:</span>
      <select value={seleccionada} onChange={(e) => router.push('/estadisticas?variedad=' + encodeURIComponent(e.target.value))} style={{ padding: '5px 8px', fontSize: '12px', maxWidth: '220px' }}>
        {variedades.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}