'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Cruz para sacar una alerta de la pantalla por lo que queda del mes. Optimista: la alerta
// desaparece en el acto y si el guardado falla vuelve con el mensaje de error, porque hacer
// esperar medio segundo para que se vaya un cartel es peor que reintentar en el raro caso
// de que falle.
export default function DescartarAlerta({ clave, anio, mes, color = '#991b1b' }: {
  clave: string; anio: number; mes: number; color?: string;
}) {
  const router = useRouter();
  const [oculta, setOculta] = useState(false);
  const [error, setError] = useState(false);

  async function descartar() {
    setOculta(true); setError(false);
    try {
      const res = await fetch('/api/alertas/descartar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave, anio, mes }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setOculta(false); setError(true);
    }
  }

  if (oculta) return null;
  return (
    <button
      onClick={descartar}
      title={error ? 'No se pudo descartar — probá de nuevo' : 'No mostrar más esta alerta este mes'}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
        color: error ? '#dc2626' : color, opacity: error ? 1 : 0.5, fontSize: '14px',
        lineHeight: 1, flexShrink: 0,
      }}
    >
      {error ? '↻' : '×'}
    </button>
  );
}
