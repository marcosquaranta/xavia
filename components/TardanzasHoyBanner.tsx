'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// Se trae aparte (no bloquea el render del Panel) porque depende de CrossChex, que limita
// a 1 pedido cada 15s (ver lib/crosschex.ts) — un token+datos "en frío" puede tardar
// ~15-20s. El resto del home ya se ve al toque; este banner aparece unos segundos después
// si hubo alguna tardanza hoy, o no aparece nunca si no hubo ninguna.
export default function TardanzasHoyBanner() {
  const [tardanzas, setTardanzas] = useState<{ nombre: string; hora: string }[]>([]);

  useEffect(() => {
    fetch('/api/panel/tardanzas-hoy').then(r => r.json()).then(j => setTardanzas(j.tardanzas || [])).catch(() => {});
  }, []);

  if (tardanzas.length === 0) return null;
  return (
    <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '28px', lineHeight: 1 }}>⏰</span>
      <div style={{ flex: 1, minWidth: '260px' }}>
        <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 800, color: '#991b1b' }}>Hoy hubo tardanzas</p>
        <p style={{ margin: 0, fontSize: '12.5px', color: '#7f1d1d' }}>
          {tardanzas.map((t, i) => (<span key={t.nombre}>{i > 0 && ' · '}<strong>{t.nombre}</strong> llegó a las {t.hora}</span>))}
        </p>
      </div>
      <Link href="/admin/personal" className="btn secondary" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>Ver Control de personal →</Link>
    </div>
  );
}
