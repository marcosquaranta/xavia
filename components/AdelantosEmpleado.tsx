'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdelantoDetalle } from '@/lib/adelantos';
import { CATEGORIA_ADELANTO } from '@/lib/adelantos';

// ── Los adelantos de un empleado, desde la pantalla de sueldos ───────────────────────
//
// Antes acá se veía "− $120.000" y nada más. Cuando el número no era el esperado no había
// forma de saber de qué se componía, y corregir un adelanto significaba ir a Gastos, buscar
// la fila entre cientos y volver.
//
// Lo que se carga o se corrige acá se escribe sobre el GASTO, no sobre un número aparte.
// Un adelanto es plata que salió de una caja: si el sueldo lo descontara desde un campo
// propio y la caja no se enterara, el resultado del mes y el saldo de la caja dirían cosas
// distintas sobre la misma plata. Por eso hay un solo lugar donde vive, y es Gastos.

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };

const inp: React.CSSProperties = {
  fontSize: '11.5px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px',
};

export default function AdelantosEmpleado({
  workno, nombre, adelantos, medios, hasta, adelantoManual = 0, onAdelantoManual, onListo,
}: {
  workno: string;
  nombre: string;
  adelantos: AdelantoDetalle[];
  medios: string[];
  // El último día del período que se está mirando: un adelanto que se carga con fecha
  // posterior no se descuenta de este sueldo y parecería que no se guardó.
  hasta: string;
  // El adelanto cargado a mano, sin gasto detrás. Decisión de Marcos: ver el comentario
  // de `adelantoManual` en lib/personal.ts.
  adelantoManual?: number;
  onAdelantoManual?: (monto: number) => void;
  // ── Qué pasa después de guardar ────────────────────────────────────────────────
  //
  // El panel se cierra y la confirmación se muestra arriba de la lista, no acá adentro.
  // Dejarlo abierto con un “✓ guardado” dentro obligaba a cerrarlo a mano para volver a
  // ver las horas y el sueldo, que es justamente el número que cambió y lo que se vino a
  // mirar. Y un panel que queda abierto después de cargar invita a cargar dos veces.
  onListo?: (mensaje: string) => void;
}) {
  const router = useRouter();
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState(hasta);
  const [nuevoMedio, setNuevoMedio] = useState(medios[0] || '');
  const [editando, setEditando] = useState<string | null>(null);
  const [edMonto, setEdMonto] = useState('');
  const [edFecha, setEdFecha] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const total = adelantos.reduce((a, x) => a + x.monto, 0);
  const [manual, setManual] = useState(String(Math.round(adelantoManual) || ''));

  async function agregar() {
    const monto = Math.round(Number(nuevoMonto));
    if (!isFinite(monto) || monto <= 0) { setMsg({ ok: false, texto: 'El monto tiene que ser mayor a 0.' }); return; }
    if (!nuevoMedio) { setMsg({ ok: false, texto: 'Elegí de dónde sale la plata.' }); return; }
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/nuevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: nuevaFecha,
          descripcion: `Adelanto de sueldo — ${nombre}`,
          categoria: CATEGORIA_ADELANTO,
          monto,
          medio_pago: nuevoMedio,
          empleado: workno,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error === 'falta_empleado' ? 'Faltó decir de qué empleado es.' : (j?.error || 'No se pudo cargar.'));
      setNuevoMonto('');
      router.refresh();
      // El refresh es por detrás; cerrar no espera a que termine. Lo guardado ya está
      // guardado y la lista se va a actualizar sola.
      if (onListo) onListo(`✓ Adelanto de ${fmt$(monto)} cargado a ${nombre}. También queda como gasto del mes.`);
      else setMsg({ ok: true, texto: '✓ Adelanto cargado. También queda como gasto del mes.' });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo cargar.' });
    } finally { setTrabajando(false); }
  }

  async function guardar(a: AdelantoDetalle) {
    const monto = Math.round(Number(edMonto));
    if (!isFinite(monto) || monto <= 0) { setMsg({ ok: false, texto: 'El monto tiene que ser mayor a 0.' }); return; }
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_gasto: a.id_gasto, fecha: edFecha, descripcion: a.descripcion,
          categoria: CATEGORIA_ADELANTO, monto, medio_pago: a.medio_pago,
          // Va explícito para no perderlo: el endpoint solo escribe el empleado si viene, y
          // un adelanto sin empleado deja de descontarse de cualquier sueldo.
          empleado: workno,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'No se pudo guardar.');
      setEditando(null);
      router.refresh();
      if (onListo) onListo(`✓ Adelanto de ${nombre} corregido a ${fmt$(monto)}.`);
      else setMsg({ ok: true, texto: '✓ Adelanto corregido.' });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally { setTrabajando(false); }
  }

  async function borrar(a: AdelantoDetalle) {
    if (!confirm(`¿Borrar el adelanto de ${fmt$(a.monto)} del ${fmtDia(a.fecha)}?\n\nSe borra también de Gastos: la plata vuelve a figurar como no salida.`)) return;
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/borrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: a.id_gasto }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'No se pudo borrar.');
      router.refresh();
      if (onListo) onListo(`✓ Se borró el adelanto de ${fmt$(a.monto)} de ${nombre}.`);
      else setMsg({ ok: true, texto: '✓ Adelanto borrado.' });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo borrar.' });
    } finally { setTrabajando(false); }
  }

  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', padding: '9px 11px' }}>
      <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
        Adelantos de {nombre} en este período {total > 0 && <span style={{ fontWeight: 800 }}>· {fmt$(total)}</span>}
      </p>

      {adelantos.length === 0 ? (
        <p style={{ margin: '0 0 7px', fontSize: '11.5px', color: '#92400e' }}>Todavía no se le adelantó nada.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', marginBottom: '7px' }}>
          <tbody>
            {adelantos.map((a) => (
              <tr key={a.id_gasto} style={{ borderTop: '1px solid #fef3c7' }}>
                {editando === a.id_gasto ? (
                  <>
                    <td style={{ padding: '3px 4px' }}>
                      <input type="date" value={edFecha} onChange={(e) => setEdFecha(e.target.value)} disabled={trabajando} style={inp} />
                    </td>
                    <td style={{ padding: '3px 4px' }}>
                      <input type="number" value={edMonto} onChange={(e) => setEdMonto(e.target.value)} disabled={trabajando} style={{ ...inp, width: '110px' }} />
                    </td>
                    <td style={{ padding: '3px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn" style={{ fontSize: '10.5px', padding: '2px 9px' }}
                        onClick={() => guardar(a)} disabled={trabajando}>{trabajando ? '…' : 'Guardar'}</button>
                      <button type="button" onClick={() => setEditando(null)} disabled={trabajando}
                        style={{ background: 'none', border: 'none', fontSize: '10.5px', color: '#6b7280', cursor: 'pointer', marginLeft: '4px' }}>✕</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '3px 4px', color: '#78350f', whiteSpace: 'nowrap' }}>{fmtDia(a.fecha)}</td>
                    <td style={{ padding: '3px 4px', fontWeight: 700, color: '#92400e' }}>{fmt$(a.monto)}</td>
                    <td style={{ padding: '3px 4px', color: '#b45309', fontSize: '10.5px' }}>{a.medio_pago}</td>
                    <td style={{ padding: '3px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" title="Corregir"
                        onClick={() => { setEditando(a.id_gasto); setEdMonto(String(Math.round(a.monto))); setEdFecha(a.fecha); setMsg(null); }}
                        disabled={trabajando}
                        style={{ background: 'none', border: 'none', fontSize: '11px', color: '#92400e', cursor: 'pointer' }}>✎</button>
                      <button type="button" title="Borrar" onClick={() => borrar(a)} disabled={trabajando}
                        style={{ background: 'none', border: 'none', fontSize: '11px', color: '#dc2626', cursor: 'pointer', marginLeft: '4px' }}>🗑</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #fde68a', paddingTop: '7px' }}>
        <input type="number" value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)} disabled={trabajando}
          placeholder="Monto" style={{ ...inp, width: '110px' }} />
        <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} disabled={trabajando} style={inp}
          title="Cuándo se le entregó. Si queda fuera del período, no se descuenta de este sueldo." />
        <select value={nuevoMedio} onChange={(e) => setNuevoMedio(e.target.value)} disabled={trabajando} style={inp}
          title="De dónde sale la plata">
          {medios.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="button" className="btn" style={{ fontSize: '11px', padding: '4px 11px' }}
          onClick={agregar} disabled={trabajando}>
          {trabajando ? 'Guardando…' : '+ Adelanto'}
        </button>
      </div>

      {msg && (
        <p style={{ margin: '6px 0 0', fontSize: '11px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>{msg.texto}</p>
      )}

      {/* ── Descuento a mano, sin gasto ──────────────────────────────────────
          Va aparte y con otro color a propósito, no sumado al número de arriba. Los de
          arriba son gastos: se puede ir a Gastos y ver el movimiento. Éste no existe en
          ningún lado más que acá, así que la caja no se entera. Mezclarlos en un solo total
          haría imposible saber cuánto de ese descuento tiene respaldo. */}
      {onAdelantoManual && (
        <div style={{ marginTop: '8px', borderTop: '1px dashed #fcd34d', paddingTop: '7px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: '#78350f' }}>
            Descuento a mano <span style={{ fontWeight: 400 }}>— sin gasto detrás</span>
          </p>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="number" value={manual} onChange={(e) => setManual(e.target.value)} disabled={trabajando}
              placeholder="0" style={{ ...inp, width: '110px' }} />
            <button type="button" disabled={trabajando}
              onClick={() => { setTrabajando(true); onAdelantoManual(Math.round(Number(manual) || 0)); }}
              style={{ fontSize: '11px', padding: '4px 11px', background: '#b45309', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
              Guardar descuento
            </button>
            {adelantoManual > 0 && (
              <span style={{ fontSize: '11px', color: '#b45309' }}>hoy descuenta {fmt$(adelantoManual)}</span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#92400e', lineHeight: 1.5 }}>
            Se descuenta del sueldo a pagar y <strong>no se registra como gasto</strong>: la plata no figura salida
            en ninguna caja ni en el resultado del mes. Para lo que se dio por fuera y no se quiere contabilizar.
            Si tenés que verlo en la caja, cargalo arriba como adelanto normal.
          </p>
        </div>
      )}

      {/* Qué pasa con la plata. Es la confusión esperable de cargar un adelanto desde la
          pantalla de sueldos: parece una anotación interna y es un gasto real. */}
      <p style={{ margin: '6px 0 0', fontSize: '10px', color: '#b45309', lineHeight: 1.5 }}>
        Un adelanto se registra como <strong>gasto</strong> con la fecha en que se entregó —la plata salió de una caja—
        y además se descuenta de lo que queda por pagar. Es el mismo registro: cargarlo acá o en Gastos es lo mismo.
      </p>
    </div>
  );
}
