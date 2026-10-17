'use client';
import { useMemo } from 'react';

// ══ Un cobro que entra en varias fechas ════════════════════════════════════════════════
//
// Un cheque a 30 días, o media entrega ahora y la otra mitad el mes que viene. La factura se
// da por cobrada hoy, pero la plata entra en dos momentos, y con una sola fecha hay que
// elegir cuál de las dos mentir: con la de hoy la cuenta muestra plata que todavía no está;
// con la de la última parte la factura figura impaga hasta entonces y se le sigue reclamando
// al cliente.
//
// El editor vive en un solo lugar —lo usan la carga manual y la bandeja— porque la regla que
// importa es una sola: las partes tienen que sumar exactamente el total. Dos formularios con
// su propia versión de esa validación es la forma más fácil de que una de las dos deje pasar
// un cobro que no cierra.

export interface ParteUI { fecha: string; importe: string }

export interface PartesChequeadas {
  lista: { fecha: string; importe: number }[];
  suma: number;
  falta: number;          // cuánto falta (o sobra, en negativo) para llegar al total
  error: string | null;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export function chequearPartes(total: number, partes: ParteUI[]): PartesChequeadas {
  const lista = (partes || [])
    .map((p) => ({ fecha: String(p.fecha || '').trim(), importe: Math.round((Number(p.importe) || 0) * 100) / 100 }))
    .filter((p) => p.fecha || p.importe > 0);
  const suma = Math.round(lista.reduce((a, p) => a + p.importe, 0) * 100) / 100;
  const objetivo = Math.round((Number(total) || 0) * 100) / 100;
  const falta = Math.round((objetivo - suma) * 100) / 100;

  let error: string | null = null;
  if (lista.length < 2) error = 'Poné al menos dos fechas, o sacá el partido.';
  else if (lista.some((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha))) error = 'Cada parte necesita su fecha.';
  else if (lista.some((p) => !(p.importe > 0))) error = 'Cada parte necesita un importe mayor a 0.';
  else if (Math.abs(falta) > 0.01) {
    error = falta > 0
      ? `Faltan ${fmt$(falta)} para llegar al total del cobro.`
      : `Las partes se pasan ${fmt$(-falta)} del total del cobro.`;
  }
  return { lista, suma, falta, error };
}

export default function CobroEnPartes({ total, partes, onChange, disabled, nota }: {
  total: number;
  partes: ParteUI[];
  onChange: (p: ParteUI[]) => void;
  disabled?: boolean;
  nota?: string;
}) {
  const chequeo = useMemo(() => chequearPartes(total, partes), [total, partes]);

  const cambiar = (i: number, campo: keyof ParteUI, valor: string) =>
    onChange(partes.map((p, j) => j === i ? { ...p, [campo]: valor } : p));
  // La parte nueva arranca con lo que falta para llegar al total: es casi siempre el número
  // que se iba a escribir, y deja el cobro cerrado en vez de abierto.
  const agregar = () => onChange([...partes, { fecha: '', importe: chequeo.falta > 0 ? String(chequeo.falta) : '' }]);
  const sacar = (i: number) => onChange(partes.filter((_, j) => j !== i));

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
      <p style={{ margin: '0 0 7px', fontSize: '11.5px', color: '#334155', fontWeight: 700 }}>
        ¿En cuántas veces entra la plata?
      </p>
      {partes.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '5px' }}>
          <input type="date" value={p.fecha} onChange={(e) => cambiar(i, 'fecha', e.target.value)} disabled={disabled}
            style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: '5px' }} />
          <input type="number" placeholder="Importe" value={p.importe} onChange={(e) => cambiar(i, 'importe', e.target.value)} disabled={disabled}
            style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: '5px', width: '120px', textAlign: 'right' }} />
          {partes.length > 1 && (
            <button type="button" onClick={() => sacar(i)} disabled={disabled}
              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
          )}
        </div>
      ))}
      <button type="button" onClick={agregar} disabled={disabled}
        style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '11.5px', padding: 0, textDecoration: 'underline' }}>
        + Agregar otra fecha
      </button>

      {/* La suma, siempre a la vista: es la única condición que tiene que cumplirse, y el
          error de no cumplirla —una factura cancelada por plata que nadie transfirió— no se
          nota hasta mucho después. */}
      <p style={{ margin: '7px 0 0', paddingTop: '6px', borderTop: '1px solid #e2e8f0', fontSize: '11.5px', color: chequeo.error ? '#b91c1c' : '#166534', fontWeight: 600 }}>
        {chequeo.error
          ? `${chequeo.error} (suman ${fmt$(chequeo.suma)} de ${fmt$(total)})`
          : `✓ Las ${chequeo.lista.length} partes suman ${fmt$(chequeo.suma)}, el total del cobro.`}
      </p>
      <p style={{ margin: '5px 0 0', fontSize: '10.5px', color: '#64748b', lineHeight: 1.45 }}>
        Se registra un cobro por fecha en Xubio, cada uno por su importe, y las facturas quedan
        imputadas desde la primera. {nota || ''}
      </p>
    </div>
  );
}
