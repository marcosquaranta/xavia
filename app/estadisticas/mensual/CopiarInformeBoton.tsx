'use client';
import { useState } from 'react';

// Convierte un <svg> del informe a una imagen PNG (data URI) dibujándolo en un canvas —
// los clientes de mail (sobre todo Outlook) no renderizan SVG de forma confiable, así
// que hay que pasar los gráficos a imagen antes de mandarlos al portapapeles como HTML.
async function svgAPng(svg: SVGSVGElement, escala = 2): Promise<string> {
  const svgString = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo renderizar un gráfico'));
      img.src = url;
    });
    const viewBox = svg.viewBox?.baseVal;
    const ancho = (viewBox && viewBox.width) || svg.clientWidth || 700;
    const alto = (viewBox && viewBox.height) || svg.clientHeight || 300;
    const canvas = document.createElement('canvas');
    canvas.width = ancho * escala;
    canvas.height = alto * escala;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas no disponible');
    // Los SVG del informe son transparentes — sin esto el gráfico queda con fondo
    // "cuadriculado" (transparente) en la mayoría de los clientes de mail.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Arma una copia del contenido del informe apta para pegar en un mail: convierte cada
// gráfico SVG a imagen y saca los controles interactivos (botones, selects) que no
// tienen sentido en un mail estático — el resto de la maquetación (tablas, colores,
// texto) se copia tal cual, y Gmail/Outlook la interpretan razonablemente bien al pegar.
async function armarHtmlParaMail(contenedorId: string): Promise<{ html: string; texto: string } | null> {
  const original = document.getElementById(contenedorId);
  if (!original) return null;
  const clone = original.cloneNode(true) as HTMLElement;

  const svgsOriginal = Array.from(original.querySelectorAll('svg'));
  const svgsClone = Array.from(clone.querySelectorAll('svg'));
  for (let i = 0; i < svgsOriginal.length; i++) {
    try {
      const png = await svgAPng(svgsOriginal[i] as unknown as SVGSVGElement);
      const img = document.createElement('img');
      img.src = png;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.setAttribute('width', String(Math.round((svgsOriginal[i] as SVGSVGElement).clientWidth || 700)));
      svgsClone[i]?.replaceWith(img);
    } catch {
      // Si un gráfico puntual falla, se saca en vez de romper todo el copiado.
      svgsClone[i]?.remove();
    }
  }

  clone.querySelectorAll('button, select, input, textarea').forEach((el) => el.remove());

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 720px; color: #111827;">${clone.innerHTML}</div>`;
  const texto = original.innerText;
  return { html, texto };
}

export default function CopiarInformeBoton({ contenedorId }: { contenedorId: string }) {
  const [estado, setEstado] = useState<'idle' | 'generando' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function copiar() {
    setEstado('generando'); setError(null);
    try {
      const armado = await armarHtmlParaMail(contenedorId);
      if (!armado) throw new Error('No se encontró el contenido del informe');
      if (!navigator.clipboard || !(window as any).ClipboardItem) {
        throw new Error('Este navegador no soporta copiar HTML enriquecido — probá con Chrome o Edge');
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([armado.html], { type: 'text/html' }),
          'text/plain': new Blob([armado.texto], { type: 'text/plain' }),
        }),
      ]);
      setEstado('ok');
      setTimeout(() => setEstado('idle'), 3500);
    } catch (e: any) {
      setError(e.message || 'No se pudo copiar');
      setEstado('error');
    }
  }

  return (
    <div style={{ margin: '10px 0 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <button onClick={copiar} disabled={estado === 'generando'} className="btn secondary" style={{ fontSize: '12px' }}>
        {estado === 'generando' ? 'Generando…' : '📋 Copiar informe para mail'}
      </button>
      {estado === 'ok' && <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>✓ Copiado — pegalo en el mail con Ctrl+V</span>}
      {estado === 'error' && <span style={{ fontSize: '12px', color: '#dc2626' }}>{error}</span>}
      <span style={{ fontSize: '11px', color: '#9ca3af' }}>Convierte los gráficos a imagen para que se vean bien en Gmail/Outlook</span>
    </div>
  );
}
