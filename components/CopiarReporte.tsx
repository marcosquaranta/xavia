'use client';
import { useState } from 'react';

interface Props { html: string; texto: string }

export default function CopiarReporte({ html, texto }: Props) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(tipo: 'texto' | 'html') {
    try {
      if (tipo === 'texto') {
        await navigator.clipboard.writeText(texto);
      } else if (typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([texto], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      setCopiado(tipo);
      setTimeout(() => setCopiado(null), 2500);
    } catch {
      setCopiado('error');
      setTimeout(() => setCopiado(null), 2500);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
      <button onClick={() => copiar('texto')} className="btn" style={{ fontSize: '12px' }}>
        📋 Copiar para WhatsApp
      </button>
      <button onClick={() => copiar('html')} className="btn secondary" style={{ fontSize: '12px' }}>
        📋 Copiar HTML
      </button>
      {copiado === 'texto' && <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>✓ Copiado — pegalo en WhatsApp</span>}
      {copiado === 'html' && <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>✓ HTML copiado</span>}
      {copiado === 'error' && <span style={{ fontSize: '12px', color: '#dc2626' }}>No se pudo copiar</span>}
    </div>
  );
}
