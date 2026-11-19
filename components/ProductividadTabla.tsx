'use client';
import { useState } from 'react';
import type { MesProductividad } from '@/lib/productividadTabla';
import { variacion } from '@/lib/productividadTabla';

// ── La tabla de productividad ────────────────────────────────────────────────────────
//
// Reemplaza al gráfico de plantas/hora. Por qué, y las decisiones que están dentro, en
// lib/productividadTabla.ts. Lo que importa acá es cómo se lee:
//
//  · Los tres meses se cortan en el MISMO día, y eso se dice arriba. Sin esa línea, el que
//    mira supone que noviembre es un mes entero y el número parece malísimo todos los días 1.
//
//  · El combinado va grande y los dos ratios sueltos abajo, en gris. Sumar cosecha y
//    trasplante 1 a 1 es una decisión, no un hecho: los de abajo son los que permiten
//    discutirla con datos.
//
//  · El granel va desglosado. "52.640 plantas" sin decir cuántas salieron en cajón no se
//    puede discutir con nadie.

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtR = (n: number | null) => n === null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Var({ anterior, actual, mejorSiSube = true }: { anterior: number | null; actual: number | null; mejorSiSube?: boolean }) {
  const v = variacion(anterior, actual);
  if (v === null) return <span style={{ color: '#d1d5db' }}>—</span>;
  const bueno = mejorSiSube ? v >= 0 : v <= 0;
  return (
    <span style={{ color: v === 0 ? '#6b7280' : bueno ? '#166534' : '#b45309', fontWeight: 700 }}>
      {v > 0 ? '+' : ''}{v}%
    </span>
  );
}

export default function ProductividadTabla({ meses, compacto = false }: { meses: MesProductividad[]; compacto?: boolean }) {
  const [verComo, setVerComo] = useState(false);
  if (!meses.length) return <p style={{ color: '#9ca3af', fontSize: '12px' }}>Sin datos de fichajes todavía.</p>;

  const ultimo = meses[meses.length - 1];
  const previo = meses.length > 1 ? meses[meses.length - 2] : null;
  const parciales = meses.filter((m) => m.parcial);

  const th: React.CSSProperties = {
    padding: '6px 8px', fontSize: '10px', fontWeight: 700, color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb',
  };
  const td: React.CSSProperties = {
    padding: compacto ? '7px 8px' : '9px 8px', borderBottom: '1px solid #f3f4f6',
    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  };
  const tdSub: React.CSSProperties = { ...td, padding: '5px 8px', color: '#6b7280', fontSize: '11px' };

  return (
    <div>
      {/* El número de hoy, con contra qué se compara. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <strong style={{ fontSize: compacto ? '26px' : '30px', color: '#111827', lineHeight: 1 }}>
          {fmtR(ultimo.plantasPorHora)}
        </strong>
        <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
          plantas movidas / hora · {ultimo.label}
        </span>
        {previo && ultimo.plantasPorHora !== null && previo.plantasPorHora !== null && (
          <span style={{ fontSize: '11.5px', fontWeight: 800, background: '#f3f4f6', padding: '2px 7px', borderRadius: '999px' }}>
            <Var anterior={previo.plantasPorHora} actual={ultimo.plantasPorHora} /> <span style={{ color: '#6b7280', fontWeight: 600 }}>vs {previo.label}</span>
          </span>
        )}
      </div>

      {/* La línea que hace comparable la tabla. Va arriba y no en una nota al pie: es la
          diferencia entre leer bien el número y leerlo mal. */}
      <p style={{ margin: '0 0 9px', fontSize: '11px', color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '6px 9px', lineHeight: 1.5 }}>
        Los tres meses van <strong>hasta el día {ultimo.diaCorte}</strong>, para que se puedan comparar. Comparar un mes a
        medias contra uno entero es lo que hacía bajar el indicador todos los días 1.
      </p>

      {parciales.length > 0 && (
        <p style={{ margin: '0 0 9px', fontSize: '11px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '6px 9px', lineHeight: 1.5 }}>
          <strong>Faltan fichajes.</strong> {parciales.map((m) => `${m.label}: ${m.diasConDatos} de ${m.diasDelRango} días`).join(' · ')}.
          El número sale solo con los días que tienen horas cargadas —la cosecha y el trasplante se recortan a esos
          mismos días—, así que es correcto sobre menos días, no sobre el mes.
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: compacto ? '11.5px' : '12.5px' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ ...th, textAlign: 'left' }}>&nbsp;</th>
            {meses.map((m) => (
              <th key={m.mes} style={{ ...th, textAlign: 'right' }}>{m.label}</th>
            ))}
            <th style={{ ...th, textAlign: 'right' }}>Var</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: '#111827' }}>Plantas cosechadas</td>
            {meses.map((m) => <td key={m.mes} style={td}>{fmt(m.plantasCosechadas)}</td>)}
            <td style={td}><Var anterior={previo?.plantasCosechadas ?? null} actual={ultimo.plantasCosechadas} /></td>
          </tr>
          <tr>
            <td style={{ ...tdSub, textAlign: 'left', paddingLeft: '18px' }}>de las cuales, a granel</td>
            {meses.map((m) => (
              <td key={m.mes} style={tdSub}>
                {m.plantasGranel > 0 ? fmt(m.plantasGranel) : '—'}
              </td>
            ))}
            <td style={{ ...tdSub, color: '#9ca3af' }}>
              {ultimo.plantasCosechadas > 0 ? `${Math.round((ultimo.plantasGranel / ultimo.plantasCosechadas) * 100)}% del total` : ''}
            </td>
          </tr>
          <tr>
            <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: '#111827' }}>Plantas trasplantadas</td>
            {meses.map((m) => <td key={m.mes} style={td}>{fmt(m.plantasTrasplantadas)}</td>)}
            <td style={td}><Var anterior={previo?.plantasTrasplantadas ?? null} actual={ultimo.plantasTrasplantadas} /></td>
          </tr>
          <tr>
            <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: '#111827', borderBottom: '2px solid #e5e7eb' }}>Horas-hombre</td>
            {meses.map((m) => <td key={m.mes} style={{ ...td, borderBottom: '2px solid #e5e7eb' }}>{fmt(m.horas)}</td>)}
            {/* Más horas no es peor ni mejor por sí solo: lo que importa es contra cuánto
                trabajo. Por eso acá no se pinta de verde ni de naranja. */}
            <td style={{ ...td, borderBottom: '2px solid #e5e7eb' }}>
              {(() => { const v = variacion(previo?.horas ?? null, ultimo.horas); return v === null ? <span style={{ color: '#d1d5db' }}>—</span> : <span style={{ color: '#6b7280', fontWeight: 700 }}>{v > 0 ? '+' : ''}{v}%</span>; })()}
            </td>
          </tr>
          <tr style={{ background: '#f9fafb' }}>
            <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: '#111827', borderBottom: 'none' }}>Plantas movidas / hora</td>
            {meses.map((m) => (
              <td key={m.mes} style={{ ...td, borderBottom: 'none', fontWeight: m.mes === ultimo.mes ? 800 : 600, fontSize: m.mes === ultimo.mes ? '13.5px' : undefined }}>
                {fmtR(m.plantasPorHora)}
              </td>
            ))}
            <td style={{ ...td, borderBottom: 'none' }}><Var anterior={previo?.plantasPorHora ?? null} actual={ultimo.plantasPorHora} /></td>
          </tr>
          <tr>
            <td style={{ ...tdSub, textAlign: 'left', paddingLeft: '18px' }}>solo cosecha / hora</td>
            {meses.map((m) => <td key={m.mes} style={tdSub}>{fmtR(m.cosechaPorHora)}</td>)}
            <td style={tdSub}><Var anterior={previo?.cosechaPorHora ?? null} actual={ultimo.cosechaPorHora} /></td>
          </tr>
          <tr>
            <td style={{ ...tdSub, textAlign: 'left', paddingLeft: '18px', borderBottom: 'none' }}>solo trasplante / hora</td>
            {meses.map((m) => <td key={m.mes} style={{ ...tdSub, borderBottom: 'none' }}>{fmtR(m.trasplantePorHora)}</td>)}
            <td style={{ ...tdSub, borderBottom: 'none' }}><Var anterior={previo?.trasplantePorHora ?? null} actual={ultimo.trasplantePorHora} /></td>
          </tr>
        </tbody>
      </table>

      {/* Qué cuenta cada número. Plegado: estorba todos los días menos el día que alguien
          discute un número, y ese día es el que importa. */}
      <button type="button" onClick={() => setVerComo((v) => !v)}
        style={{ marginTop: '8px', fontSize: '11px', background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
        {verComo ? 'Ocultar' : 'Qué cuenta cada número'}
      </button>
      {verComo && (
        <ul style={{ margin: '6px 0 0', paddingLeft: '16px', fontSize: '11px', color: '#4b5563', lineHeight: 1.6 }}>
          <li><strong>Cosechadas</strong>: todo lo que salió de la mesada, en paquete o a granel. El granel se cuenta por peso y no por cajón — un cajón son muchas plantas, no una. La rúcula se cosecha en paquetes y se pasa a plantas con el factor del lote.</li>
          <li><strong>Trasplantadas</strong>: las plantas que se movieron de fase. Es trabajo que antes no contaba y hacía ver flojo a un mes de mucho trasplante.</li>
          <li><strong>Plantas movidas</strong>: cosechadas + trasplantadas, contadas igual. Que una trasplantada cueste lo mismo que una cosechada es una decisión, no un hecho — por eso están los dos ratios por separado: si el número se mueve, dicen por cuál de los dos lados se movió.</li>
          <li><strong>Horas</strong>: todas las fichadas, de producción y de administración. Solo entran los días con fichaje cargado, y la cosecha y el trasplante se recortan a esos mismos días.</li>
        </ul>
      )}
    </div>
  );
}
