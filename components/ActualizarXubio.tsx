'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Traer ahora lo último de Xubio, sin esperar al cron de la mañana.
//
// Las pantallas leen una foto local porque pedirle a Xubio en vivo tarda muchísimo: corta
// en 100 resultados por consulta y un año se resuelve con decenas de llamadas encadenadas.
// Pero una foto sin forma de refrescarla a mano es una trampa: el día que alguien carga una
// factura en Xubio y no la ve acá, no tiene nada que hacer más que esperar y desconfiar.
//
// Por eso el botón dice cuándo se actualizó por última vez, y avisa que puede tardar: una
// espera anunciada se tolera, una espera sin explicación parece que se colgó.
export default function ActualizarXubio({ actualizado }: { actualizado?: string }) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function actualizar() {
    setTrabajando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cron/xubio-diario');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo actualizar.');
      const c = j.comprobantes || {}, co = j.cobranzas || {};
      setMsg(`✓ Actualizado: ${c.nuevos || 0} comprobantes nuevos, ${co.nuevos || 0} cobranzas nuevas.`);
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo actualizar.');
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
      <button
        type="button"
        onClick={actualizar}
        disabled={trabajando}
        className="btn secondary"
        style={{ fontSize: '12.5px' }}
      >
        {trabajando ? 'Trayendo de Xubio…' : '↻ Traer lo último de Xubio'}
      </button>
      <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
        {actualizado
          ? `Datos de Xubio al ${actualizado}. Se actualizan solos todas las mañanas.`
          : 'Todavía no se trajo nada de Xubio: apretá el botón una vez para llenar la caché.'}
        {trabajando && ' · Puede tardar un minuto.'}
      </span>
      {msg && (
        <span style={{ fontSize: '12px', fontWeight: 600, color: msg.startsWith('✓') ? '#059669' : '#dc2626' }}>{msg}</span>
      )}
    </div>
  );
}
