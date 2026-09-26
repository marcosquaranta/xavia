'use client';
import { cumplimientoObjetivo, type ObjetivoKpi } from '@/lib/objetivosMarce';

// La línea de cumplimiento de un KPI contra su objetivo.
//
// Va debajo del número grande y no lo reemplaza: el valor del mes y el cumplimiento
// responden preguntas distintas —"cómo venimos" y "llegamos a lo que acordamos"— y en una
// revisión de puesto hace falta ver las dos juntas.
//
// Sin objetivo fijado dice exactamente eso. Los colores son los del resto de la app: verde
// cumplido, ámbar corto, gris sin comparación posible.
export default function CumplimientoObjetivo({ valor, kpi }: { valor: number | null | undefined; kpi: ObjetivoKpi }) {
  const c = cumplimientoObjetivo(valor, kpi);

  if (kpi.objetivo === null) {
    return (
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#9ca3af' }}>
        Sin objetivo fijado{kpi.nota ? ` — ${kpi.nota.replace(/\.$/, '')}` : ''}
      </p>
    );
  }
  if (!c) {
    return (
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#9ca3af' }}>
        Objetivo {kpi.objetivo}{kpi.unidad} — sin dato del mes para comparar
      </p>
    );
  }
  return (
    <p style={{
      margin: '0 0 8px', fontSize: '11.5px', fontWeight: 600,
      color: c.cumple ? '#059669' : '#b45309',
    }}>
      {c.texto}
    </p>
  );
}
