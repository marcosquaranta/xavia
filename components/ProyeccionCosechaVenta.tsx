import type { ProyeccionSemana } from '@/lib/proyeccionStock';

// ── Vamos a estar largos o cortos la semana que viene ─────────────────────────────────
//
// Para JP: si lo que va a salir de las naves no se va a poder vender, la diferencia termina
// en la cámara y de ahí a la basura. Cuando eso se ve en el stock acumulado ya es tarde — la
// planta ya está en el tubo. Esto lo adelanta una semana, que es el tiempo que hace falta
// para mover un pedido o frenar algo.
//
// Se muestran los tres números y no solo la diferencia: sobrar 2.000 unidades significa algo
// muy distinto si se venden 3.000 o si se venden 20.000.

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

// Hasta acá es ruido de estimación. Por debajo de ±10% no se pinta nada: dos proyecciones
// que difieren un 6% están diciendo lo mismo, y marcarlo en rojo todas las semanas hace que
// el rojo deje de significar algo.
const UMBRAL_PCT = 10;

function color(pct: number | null): { fondo: string; borde: string; texto: string } {
  if (pct === null || Math.abs(pct) < UMBRAL_PCT) return { fondo: '#fafaf9', borde: '#e5e7eb', texto: '#374151' };
  if (pct > 30) return { fondo: '#fef2f2', borde: '#fecaca', texto: '#b91c1c' };
  if (pct > 0) return { fondo: '#fffbeb', borde: '#fde68a', texto: '#b45309' };
  return { fondo: '#eff6ff', borde: '#bfdbfe', texto: '#1d4ed8' };
}

function veredicto(pct: number | null, dif: number): string {
  if (pct === null) return 'no hay ventas de referencia';
  if (Math.abs(pct) < UMBRAL_PCT) return 'va a dar justo';
  if (pct > 0) return `van a sobrar ${fmt(dif)}`;
  return `van a faltar ${fmt(-dif)}`;
}

export default function ProyeccionCosechaVenta({ p }: { p: ProyeccionSemana }) {
  const conDesvio = p.cultivos.filter((c) => c.pct !== null && Math.abs(c.pct) >= UMBRAL_PCT);

  return (
    <div className="card" style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Semana que viene · cosecha vs venta
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9ca3af' }}> · {p.semanaLabel}</span>
        </p>
        {conDesvio.length === 0 && p.hayVentas && (
          <span style={{ fontSize: '11.5px', color: '#059669', fontWeight: 600 }}>Los tres cultivos dan parejos</span>
        )}
      </div>

      {!p.hayVentas ? (
        <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: '#b45309' }}>
          No hay ventas cargadas en las dos semanas anteriores, así que no hay con qué comparar la cosecha. Sin eso,
          cualquier cosecha parecería sobrar entera.
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '9px', marginTop: '9px' }}>
            {p.cultivos.map((c) => {
              const col = color(c.pct);
              return (
                <div key={c.cultivo} style={{ background: col.fondo, border: `1px solid ${col.borde}`, borderRadius: '8px', padding: '10px 12px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: '#111827' }}>{c.label}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280' }}>
                    <span>Se cosecha</span>
                    <strong style={{ color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.cosechaProyectada)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    <span>Se vende</span>
                    <strong style={{ color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.ventaPromedio)}</strong>
                  </div>
                  <p style={{ margin: '7px 0 0', fontSize: '13px', fontWeight: 800, color: col.texto }}>
                    {veredicto(c.pct, c.diferencia)}
                    {c.pct !== null && Math.abs(c.pct) >= UMBRAL_PCT && (
                      <span style={{ fontWeight: 600 }}> ({c.pct > 0 ? '+' : ''}{c.pct}%)</span>
                    )}
                  </p>
                  {/* Las dos semanas por separado: promediar 1.000 y 9.000 da 5.000, que no
                      pasó nunca. Con los dos números a la vista se ve cuándo el promedio no
                      representa nada. */}
                  <p style={{ margin: '4px 0 0', fontSize: '10.5px', color: '#9ca3af' }}>
                    {c.ventaSemanas.map((s) => `${s.label}: ${fmt(s.unidades)}`).join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>

          <p style={{ margin: '9px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
            <strong>Las dos son estimaciones, ninguna es un dato.</strong> La venta es el promedio de las dos últimas
            semanas completas ({p.desdeVenta.slice(8, 10)}/{p.desdeVenta.slice(5, 7)} al {p.hastaVenta.slice(8, 10)}/{p.hastaVenta.slice(5, 7)}),
            con los kilos convertidos a paquetes; la semana en curso no entra porque va por la mitad. La cosecha sale de
            proyectar cada lote con el ciclo real de su variedad. Sirve para anticiparse, no para cerrar un número.
          </p>
        </>
      )}
    </div>
  );
}
