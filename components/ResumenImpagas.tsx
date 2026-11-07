'use client';
import ReclamoManual from './ReclamoManual';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FacturaCliente } from '@/lib/facturasCliente';

// ── Quién debe qué ───────────────────────────────────────────────────────────────────
//
// Hasta acá la deuda por cliente solo existía adentro del mail de recordatorio: para saber
// cuánto debía alguien había que mandarle el reclamo y leerlo. Esta tabla es el mismo
// cálculo, mirable sin mandar nada.
//
// Importa que sea el MISMO cálculo y no uno parecido: si la pantalla y el mail dieran
// números distintos, no habría forma de saber cuál está bien, y el mail ya salió.

export interface ClienteImpagas {
  id_control: string;
  nombre: string;
  // Dado de baja en Clientes. La deuda no se da de baja con el cliente, así que sigue
  // apareciendo acá: lo que cambia es el motivo por el que no se le reclama, y con él
  // dónde hay que ir a resolverlo.
  inactivo?: boolean;
}

// Dónde se cortó el reparto de los cobros de Xubio, por cliente. Es la explicación del caso
// más desconcertante de esta pantalla: si la factura más vieja no entra entera en lo que el
// cliente cobró sin imputar, el reparto se detiene ahí y TODAS las que siguen quedan
// figurando impagas — el cliente aparece debiendo un año entero. El dato existía en el
// cálculo y no se mostraba, así que el número no tenía ninguna explicación visible.
export interface CorteReparto { numero: string; fecha: string; importe: number; restaba: number }

// La última vez que se controló la cuenta de cada cliente, con la foto de lo que había.
export interface RevisionUI {
  id_control: string;
  fecha: string;
  usuario: string;
  facturas_abiertas: number;
  monto_abierto: number;
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}/${String(y).slice(2)}` : '—';
};
const diasDesde = (f: string) => {
  const t = new Date(String(f) + 'T12:00:00').getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400000) : 0;
};

export default function ResumenImpagas({
  clientes, facturasPorCliente, conRecordatorio = [], revisiones = {}, diasRevisionVieja = 30, cortes = {}, saldadasPorCliente = {},
}: {
  clientes: ClienteImpagas[];
  facturasPorCliente: Record<string, FacturaCliente[]>;
  // Los que tienen el recordatorio prendido. Se marcan porque cambia qué hacer con la
  // deuda: si el cliente no recibe recordatorio, esa plata no se está reclamando sola.
  conRecordatorio?: string[];
  revisiones?: Record<string, RevisionUI>;
  diasRevisionVieja?: number;
  // Dónde se cortó el reparto de cada cliente (ver CorteReparto).
  cortes?: Record<string, CorteReparto>;
  // Cuántas facturas de cada cliente ya están dadas por saldadas a mano.
  saldadasPorCliente?: Record<string, { cantidad: number; monto: number }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  // El reclamo abierto dentro de la fila. Se cierra al cambiar de cliente: dejarlo abierto
  // mostraría el reclamo de uno adentro de la fila de otro.
  const [reclamando, setReclamando] = useState(false);
  // La cuenta corriente del cliente, accionable. Hasta ahora el detalle se podía mirar y
  // nada más: para dar una factura por cobrada había que irse a otra pantalla, buscarla de
  // nuevo y volver, y por eso en la práctica quedaban figurando impagas para siempre.
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevoImporte, setNuevoImporte] = useState('');
  const [motivoAjuste, setMotivoAjuste] = useState('');

  const alternar = (n: string) => setElegidas((p) => p.includes(n) ? p.filter((x) => x !== n) : [...p, n]);

  // Dar por cobradas las elegidas. No genera ningún movimiento en Xubio: es exactamente la
  // misma marca que la pantalla de facturas saldadas, así que no hay dos formas distintas
  // de que una factura quede fuera de los reclamos.
  async function marcarCobradas(idControl: string, nombre: string, impagas: FacturaCliente[]) {
    if (!elegidas.length) return;
    if (!motivo.trim()) { setMsg('Escribí por qué se dan por cobradas.'); return; }
    const total = impagas.filter((f) => elegidas.includes(f.numero)).reduce((a, f) => a + (Number(f.importe) || 0), 0);
    if (!window.confirm(`Dar por cobradas ${elegidas.length} factura(s) de ${nombre} por ${fmt(total)}.\n\nNo se registra ningún movimiento en Xubio: salen de los reclamos y de las opciones al imputar.\n\n¿Confirmás?`)) return;
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/saldadas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo: motivo.trim(),
          facturas: impagas.filter((f) => elegidas.includes(f.numero)).map((f) => ({
            numero: f.numero, id_control: idControl, cliente: nombre, fecha: f.fecha, importe: f.importe,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar');
      setMsg(`✓ ${j.mensaje || 'Listo.'}`);
      setElegidas([]); setMotivo('');
      router.refresh();
    } catch (e: any) {
      setMsg(e.message || 'No se pudo guardar');
    }
    setGuardando(false);
  }

  // Corregir el importe, con el mismo ajuste que usa la bandeja: una sola forma de que una
  // factura valga algo distinto de lo que dice Xubio.
  async function ajustar(idControl: string, nombre: string, f: FacturaCliente) {
    const nuevo = Math.round(Number(nuevoImporte));
    if (!isFinite(nuevo) || nuevo < 0) { setMsg('El importe tiene que ser un número.'); return; }
    if (!motivoAjuste.trim()) { setMsg('Poné por qué se ajusta.'); return; }
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/ajuste-factura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: f.numero, id_control: idControl, cliente: nombre,
          importeXubio: f.importeFactura ?? f.importe, importeApp: nuevo, motivo: motivoAjuste.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo ajustar');
      setMsg(`✓ ${f.numero} queda en ${fmt(nuevo)}.`);
      setEditando(null); setNuevoImporte(''); setMotivoAjuste('');
      router.refresh();
    } catch (e: any) {
      setMsg(e.message || 'No se pudo ajustar');
    }
    setGuardando(false);
  }
  const [marcando, setMarcando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Dejar asentado que se controló esta cuenta. Guarda además cuántas facturas abiertas
  // había y por cuánto: sin esa foto, el sello solo dice cuándo alguien afirmó que estaba
  // bien, y no hay forma de ver qué cambió después.
  async function marcarRevisado(id: string, nombre: string, facturas: number, monto: number) {
    setMarcando(id); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/revision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: id, cliente: nombre, facturasAbiertas: facturas, montoAbierto: monto }),
      });
      const j = await r.json();
      setMsg(r.ok ? `✓ ${nombre}: revisión registrada.` : (j?.error || 'No se pudo registrar.'));
      if (r.ok) router.refresh();
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo registrar.');
    } finally {
      setMarcando(null);
    }
  }

  const prendidos = useMemo(() => new Set(conRecordatorio.map(String)), [conRecordatorio]);

  const filas = useMemo(() => {
    return clientes
      .map((c) => {
        const impagas = (facturasPorCliente[c.id_control] || [])
          // Mismo criterio que el de la página y el del mail: lo que la app ya dio por
          // cobrado —imputado desde un cobro, imputado a mano sobre un cobro de Xubio, o
          // dado por saldado— no es deuda. Un criterio distinto acá y la tabla contradice
          // al reclamo que sale por mail, sin forma de saber cuál está bien.
          .filter((f) => !f.yaCobrada && !f.saldadaManual && !f.cubierta && !f.imputadaManual)
          .slice()
          .sort((a, b) => a.fecha.localeCompare(b.fecha));
        const total = impagas.reduce((a, f) => a + f.importe, 0);
        const rev = revisiones[String(c.id_control)];
        return {
          ...c,
          impagas,
          total,
          masVieja: impagas[0]?.fecha || '',
          reclama: prendidos.has(String(c.id_control)),
          inactivo: !!c.inactivo,
          rev,
          diasRev: rev ? diasDesde(rev.fecha) : null,
        };
      })
      .filter((f) => f.impagas.length > 0)
      .sort((a, b) => b.total - a.total);
  }, [clientes, facturasPorCliente, prendidos, revisiones]);

  const totalGeneral = filas.reduce((a, f) => a + f.total, 0);
  const sinReclamo = filas.filter((f) => !f.reclama);
  const totalSinReclamo = sinReclamo.reduce((a, f) => a + f.total, 0);

  if (!filas.length) {
    return <p style={{ margin: 0, fontSize: '13px', color: '#059669' }}>No hay facturas impagas.</p>;
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '460px' }}>
          <thead>
            <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11.5px' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Facturas</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Total</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>La más vieja</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Revisado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const dias = diasDesde(f.masVieja);
              const esta = abierto === f.id_control;
              return (
                <tr key={f.id_control} style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer', background: esta ? '#f8fafc' : undefined }}
                  onClick={() => { setReclamando(false); setAbierto(esta ? null : f.id_control); }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    <span style={{ color: '#9ca3af', fontSize: '10px', marginRight: '5px' }}>{esta ? '▾' : '▸'}</span>
                    {f.nombre}
                    {/* El motivo exacto, no "no se reclama" a secas. Un cliente dado de
                        baja y uno con el aviso apagado se arreglan distinto, y decir
                        "sin recordatorio" de uno dado de baja mandaba a buscarlo a una
                        lista donde no estaba. */}
                    {f.inactivo ? (
                      <span title="Este cliente está dado de baja. La deuda sigue existiendo y no se reclama sola."
                        style={{ marginLeft: '6px', fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b' }}>
                        dado de baja
                      </span>
                    ) : !f.reclama && (
                      <span title="Este cliente no tiene el recordatorio prendido: esta deuda no se reclama sola"
                        style={{ marginLeft: '6px', fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#fef3c7', color: '#92400e' }}>
                        sin recordatorio
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{f.impagas.length}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(f.total)}</td>
                  <td style={{ padding: '6px 8px', color: dias > 60 ? '#b45309' : '#6b7280' }}>
                    {fmtFecha(f.masVieja)} <span style={{ fontSize: '11px', color: '#9ca3af' }}>({dias} días)</span>
                  </td>
                  {/* Hace cuánto que nadie controla esta cuenta. En ámbar pasado el plazo y
                      en rojo al doble: una cuenta sin revisar hace dos meses es donde se
                      esconden los errores de imputación. */}
                  <td style={{ padding: '6px 8px', fontSize: '12px' }}>
                    {f.diasRev === null ? (
                      <span style={{ color: '#b45309' }}>nunca</span>
                    ) : (
                      <span style={{ color: f.diasRev > diasRevisionVieja * 2 ? '#dc2626' : f.diasRev > diasRevisionVieja ? '#b45309' : '#059669' }}>
                        hace {f.diasRev} {f.diasRev === 1 ? 'día' : 'días'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid #e5e7eb' }}>
              <td style={{ padding: '8px', fontWeight: 800 }}>Total</td>
              <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>
                {filas.reduce((a, f) => a + f.impagas.length, 0)}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalGeneral)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* El detalle del cliente abierto, abajo de la tabla: dentro de la fila rompía el
          ancho de las columnas y se leía peor. */}
      {abierto && (() => {
        const f = filas.find((x) => x.id_control === abierto);
        if (!f) return null;
        return (
          <div style={{ marginTop: '10px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700 }}>{f.nombre} — {f.impagas.length} impagas</p>
              <button
                type="button"
                onClick={() => marcarRevisado(f.id_control, f.nombre, f.impagas.length, f.total)}
                disabled={marcando === f.id_control}
                style={{ fontSize: '11.5px', fontWeight: 700, padding: '4px 12px', borderRadius: '6px', border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
              >
                {marcando === f.id_control ? 'Guardando…' : '✓ Marcar como revisado'}
              </button>
            </div>
            {/* Qué cambió desde la última revisión. Es lo que convierte el sello en algo
                verificable: sin esto solo dice cuándo alguien dijo que estaba bien. */}
            {f.rev && (
              <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280', background: '#f8fafc', borderRadius: '6px', padding: '5px 8px' }}>
                Revisado el {fmtFecha(f.rev.fecha)} por {f.rev.usuario}: en ese momento {f.rev.facturas_abiertas} impagas
                por {fmt(f.rev.monto_abierto)}.
                {(f.impagas.length !== f.rev.facturas_abiertas || Math.round(f.total) !== Math.round(f.rev.monto_abierto)) && (
                  <strong style={{ color: '#b45309' }}>
                    {' '}Desde entonces: {f.impagas.length - f.rev.facturas_abiertas >= 0 ? '+' : ''}
                    {f.impagas.length - f.rev.facturas_abiertas} facturas, {Math.round(f.total - f.rev.monto_abierto) >= 0 ? '+' : '−'}
                    {fmt(Math.abs(f.total - f.rev.monto_abierto))}.
                  </strong>
                )}
              </p>
            )}
            {/* El corte del reparto. Sin esto, un cliente con un cobro grande en Xubio que
                no alcanza para cubrir entera la factura más vieja aparece debiendo TODO el
                año, y no hay nada en pantalla que lo explique. */}
            {cortes[f.id_control] && (() => {
              const c = cortes[f.id_control];
              return (
                <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 10px', lineHeight: 1.5 }}>
                  <strong>Ojo con este número.</strong> El reparto de los cobros que este cliente tiene en Xubio se cortó
                  en <span style={{ fontFamily: 'ui-monospace, monospace' }}>{c.numero}</span> ({fmtFecha(c.fecha)}, {fmt(c.importe)}):
                  quedaban {fmt(c.restaba)} sin asignar, que no alcanzan para cubrirla entera. Desde ahí para adelante
                  todas figuran impagas, aunque el cliente pueda haberlas pagado. Si es así, imputá ese cobro a las
                  facturas que correspondan, o dalas por cobradas acá abajo.
                </p>
              );
            })()}
            {/* Las que ya se dieron por saldadas. Contesta de una la pregunta "¿no las
                había marcado ya?": si dice 0, la marca nunca se guardó. */}
            <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#6b7280' }}>
              {saldadasPorCliente[f.id_control]?.cantidad
                ? <>Este cliente ya tiene <strong>{saldadasPorCliente[f.id_control].cantidad}</strong> factura(s) dadas por saldadas
                    a mano ({fmt(saldadasPorCliente[f.id_control].monto)}), que no se cuentan en esta lista.</>
                : <>Este cliente <strong>no tiene ninguna factura dada por saldada a mano</strong>. Si creías que sí, la marca no se
                    guardó: tildalas abajo y dalas por cobradas.</>}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {f.impagas.map((x) => (
                  <tr key={x.numero} style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={{ padding: '3px 6px', width: '22px' }}>
                      <input type="checkbox" checked={elegidas.includes(x.numero)}
                        onChange={() => alternar(x.numero)} disabled={guardando}
                        title="Elegir para dar por cobrada" />
                    </td>
                    <td style={{ padding: '3px 6px', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>{x.numero}</td>
                    <td style={{ padding: '3px 6px', color: '#6b7280' }}>{fmtFecha(x.fecha)}</td>
                    <td style={{ padding: '3px 6px', color: '#9ca3af' }}>{diasDesde(x.fecha)} días</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(x.importe)}
                      {/* Si la venta se corrigió después de facturar, se cobra otra cosa que
                          lo que dice el comprobante. Hay que ver los dos: el de la factura
                          es con el que el cliente va a discutir. */}
                      {x.ajustada && x.importeFactura !== undefined && (
                        <span title="La venta se corrigió después de facturar: la factura dice otra cosa y en Xubio sigue igual."
                          style={{ display: 'block', fontSize: '10px', fontWeight: 400, color: '#b45309' }}>
                          factura {fmt(x.importeFactura)}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', width: '24px' }}>
                      <button type="button" title="Corregir el importe de esta factura"
                        onClick={() => {
                          setEditando(editando === x.numero ? null : x.numero);
                          setNuevoImporte(String(Math.round(x.importe)));
                          setMotivoAjuste(''); setMsg(null);
                        }}
                        disabled={guardando}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '12px', padding: 0 }}>✎</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Editar el importe, acá mismo. Mismo ajuste que usa la bandeja. */}
            {editando && f.impagas.some((x) => x.numero === editando) && (() => {
              const x = f.impagas.find((y) => y.numero === editando)!;
              return (
                <div style={{ marginTop: '8px', padding: '9px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px' }}>
                  <p style={{ margin: '0 0 7px', fontSize: '11.5px', fontWeight: 700, color: '#92400e' }}>
                    Corregir <span style={{ fontFamily: 'ui-monospace, monospace' }}>{x.numero}</span> — hoy figura {fmt(x.importe)}
                  </p>
                  <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                    <input type="number" value={nuevoImporte} onChange={(e) => setNuevoImporte(e.target.value)} disabled={guardando}
                      placeholder="Importe real" style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '6px', width: '130px' }} />
                    <input type="text" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} disabled={guardando}
                      placeholder="¿Por qué? (ej: 40 rúculas de menos)" style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '6px', flex: '1 1 200px' }} />
                    <button type="button" onClick={() => ajustar(f.id_control, f.nombre, x)} disabled={guardando}
                      style={{ fontSize: '11.5px', fontWeight: 700, padding: '5px 12px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Guardar</button>
                    <button type="button" onClick={() => setEditando(null)} disabled={guardando}
                      style={{ fontSize: '11.5px', padding: '5px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#b45309' }}>
                    No cambia la factura en Xubio: queda del lado de la app, con el motivo y tu usuario.
                  </p>
                </div>
              );
            })()}

            {/* Dar por cobradas. Es lo que faltaba para que esto sea la cuenta corriente y
                no una lista para mirar: la mitad de lo que figura impago está cobrado y
                nadie lo marca porque había que irse a otra pantalla. */}
            {elegidas.length > 0 && (
              <div style={{ marginTop: '9px', padding: '10px 11px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 7px', fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                  {elegidas.length} factura(s) elegida(s) ·{' '}
                  {fmt(f.impagas.filter((x) => elegidas.includes(x.numero)).reduce((a, x) => a + (Number(x.importe) || 0), 0))}
                </p>
                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                  <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={guardando}
                    placeholder="¿Por qué se dan por cobradas? (ej: pagó en efectivo, no se cargó)"
                    style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '6px', flex: '1 1 260px' }} />
                  <button type="button" onClick={() => marcarCobradas(f.id_control, f.nombre, f.impagas)} disabled={guardando || !motivo.trim()}
                    style={{ fontSize: '12px', fontWeight: 700, padding: '6px 14px', background: motivo.trim() ? '#166534' : '#d1d5db', color: 'white', border: 'none', borderRadius: '6px', cursor: motivo.trim() ? 'pointer' : 'not-allowed' }}>
                    {guardando ? 'Guardando…' : 'Dar por cobradas'}
                  </button>
                  <button type="button" onClick={() => { setElegidas([]); setMotivo(''); }} disabled={guardando}
                    style={{ fontSize: '12px', padding: '6px 11px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}>
                    Deseleccionar
                  </button>
                </div>
                {/* Qué hace y qué no, antes de apretar: no es lo mismo que registrar un
                    cobro, y confundirlos deja plata sin entrar a ninguna cuenta. */}
                <p style={{ margin: '7px 0 0', fontSize: '10.5px', color: '#15803d', lineHeight: 1.45 }}>
                  No registra ningún cobro en Xubio ni suma plata a ninguna cuenta: solo deja de reclamarlas.
                  Si la plata entró de verdad, lo que corresponde es registrar el cobro desde la bandeja.
                </p>
              </div>
            )}

            {/* ── Reclamar, acá mismo ─────────────────────────────────────────────────
                "Facturas impagas por cliente" y "Reclamar facturas a un cliente" eran dos
                pantallas que listaban lo mismo: la deuda abierta de un cliente. Mantener
                dos listas que tienen que coincidir es cómo terminan diciendo cosas
                distintas —y ya pasó— además de obligar a elegir el cliente dos veces.
                Ahora se ve la deuda y se reclama en el mismo lugar. La lista de facturas
                no se duplica: el reclamo pide las suyas a la misma API. */}
            <div style={{ marginTop: '10px', borderTop: '1px solid #f3f4f6', paddingTop: '9px' }}>
              {!reclamando ? (
                <button type="button" onClick={() => setReclamando(true)}
                  style={{ fontSize: '12px', fontWeight: 700, padding: '6px 13px', background: 'white', border: '1px solid #ddd6fe', color: '#6d28d9', borderRadius: '6px', cursor: 'pointer' }}>
                  ✉️ Reclamarle estas facturas a {f.nombre}
                </button>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#6d28d9' }}>Reclamo a {f.nombre}</p>
                    <button type="button" onClick={() => setReclamando(false)}
                      style={{ background: 'none', border: 'none', fontSize: '11.5px', color: '#2563eb', cursor: 'pointer' }}>Cerrar</button>
                  </div>
                  <ReclamoManual clientes={[{ id_control: f.id_control, nombre: f.nombre }]} clienteInicial={f.id_control} sinSelector />
                </>
              )}
            </div>
          </div>
        );
      })()}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: msg.startsWith('✓') ? '#059669' : '#dc2626' }}>{msg}</p>}

      {sinReclamo.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#92400e' }}>
          {fmt(totalSinReclamo)} de {sinReclamo.length === 1 ? 'un cliente' : `${sinReclamo.length} clientes`} sin
          recordatorio prendido: esa plata no se reclama sola.
        </p>
      )}
    </div>
  );
}
