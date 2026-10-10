'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Las cobranzas del mes ────────────────────────────────────────────────────────────
//
// Hasta acá se podía ver qué falta cobrar, pero no lo que SÍ se cobró: para saber cuánto
// entró en septiembre y por dónde había que abrir Xubio. Esto son las cobranzas tal como
// están en Xubio —todas, no solo las que pasaron por la app— filtrables por medio de cobro
// y por cliente.
//
// Sale de la caché local (ver lib/xubioCache.ts), así que no cuesta nada mostrarlo.

export interface CobranzaUI {
  fecha: string;
  cliente: string;
  importe: number;
  cuenta: string;
  numero: string;
  // Hace falta para poder corregirla: es la clave con la que se guarda la corrección.
  transaccionid?: string;
  editada?: boolean;
  nota?: string;
  oculta?: boolean;
  importeXubio?: number;
  // Las facturas que este cobro paga, dichas a mano desde acá. Ver lib/cobranzasEdit.ts.
  comprobantes?: string[];
}

// Un cliente con su id: hace falta para poder pedir sus facturas. El nombre solo no alcanza
// —el de Xubio y el de la app pueden diferir— y sin el id no hay con qué consultar.
export interface ClienteConId { id_control: string; nombre: string; nombreXubio?: string }

interface FacturaOpcion {
  numero: string; fecha: string; importe: number;
  yaCobrada?: boolean; cubierta?: boolean; saldadaManual?: boolean; imputadaManual?: boolean;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const norm = (x: any) => String(x || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : f; };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function MovimientosCobranza({
  cobranzas, anioActual, mesActual, clientesApp = [], cuentasApp = [], clientesConId = [],
}: {
  cobranzas: CobranzaUI[];
  anioActual: number;
  mesActual: number;
  // Para elegir de una lista en vez de escribir a mano: un cliente tipeado distinto cada
  // vez rompe el filtro por cliente, que agrupa por texto exacto.
  clientesApp?: string[];
  cuentasApp?: string[];
  clientesConId?: ClienteConId[];
}) {
  const [anio, setAnio] = useState(anioActual);
  const [mes, setMes] = useState(mesActual);
  const [cuenta, setCuenta] = useState('');
  const [cliente, setCliente] = useState('');

  const delMes = useMemo(() => {
    const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const finDia = new Date(anio, mes, 0).getDate();
    const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finDia).padStart(2, '0')}`;
    return cobranzas
      // Las dadas de baja a mano no se muestran. Siguen en Xubio y en la caché: lo único
      // que se guarda acá es la decisión de no verlas más en esta lista.
      .filter((c) => !c.oculta)
      .filter((c) => c.fecha >= ini && c.fecha <= fin)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);
  }, [cobranzas, anio, mes]);

  // Las opciones salen de lo que hay EN EL MES, no de una lista fija: así no se ofrece
  // filtrar por una cuenta que ese mes no recibió nada y devuelve vacío sin explicación.
  const cuentas = useMemo(
    () => [...new Set(delMes.map((c) => c.cuenta).filter(Boolean))].sort(),
    [delMes],
  );
  const clientes = useMemo(
    () => [...new Set(delMes.map((c) => c.cliente).filter(Boolean))].sort(),
    [delMes],
  );

  const filtradas = useMemo(
    () => delMes.filter((c) => (!cuenta || c.cuenta === cuenta) && (!cliente || c.cliente === cliente)),
    [delMes, cuenta, cliente],
  );

  const total = filtradas.reduce((a, c) => a + c.importe, 0);

  // El total por cuenta siempre sobre el MES completo, no sobre lo filtrado: es lo que se
  // compara contra el extracto del banco, y filtrado por cliente no serviría para eso.
  const porCuenta = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of delMes) map.set(c.cuenta || 'sin cuenta', (map.get(c.cuenta || 'sin cuenta') || 0) + c.importe);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [delMes]);

  const router = useRouter();
  // Qué fila se está corrigiendo y con qué valores.
  const [editando, setEditando] = useState<string | null>(null);
  const [eCliente, setECliente] = useState('');
  const [eCuenta, setECuenta] = useState('');
  const [eNota, setENota] = useState('');
  const [eImporte, setEImporte] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errEdit, setErrEdit] = useState<string | null>(null);
  // Qué facturas se le están marcando a este cobro, y la lista para elegir.
  const [eComprobantes, setEComprobantes] = useState<string[]>([]);
  const [opciones, setOpciones] = useState<FacturaOpcion[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errFact, setErrFact] = useState<string | null>(null);

  // El cliente de la app que corresponde a esta cobranza. Se busca por nombre normalizado
  // contra el nombre de Xubio y el de la app: es el mismo criterio con el que la app reparte
  // los comprobantes, así que si acá no aparece es porque allá tampoco, y eso también hay
  // que poder verlo.
  const porNombre = useMemo(() => {
    const m = new Map<string, ClienteConId>();
    for (const c of clientesConId) {
      for (const n of [c.nombreXubio, c.nombre]) {
        const k = norm(n);
        if (k && !m.has(k)) m.set(k, c);
      }
    }
    return m;
  }, [clientesConId]);

  function clienteDe(c: CobranzaUI): ClienteConId | undefined {
    return porNombre.get(norm(c.cliente));
  }

  function abrirEdicion(c: CobranzaUI) {
    setEditando(String(c.transaccionid || ''));
    setECliente(c.cliente || ''); setECuenta(c.cuenta || ''); setENota(c.nota || '');
    setEImporte(String(Math.round(c.importe)));
    setEComprobantes(c.comprobantes || []);
    setOpciones([]); setErrFact(null);
    setErrEdit(null);
    // Las facturas se piden solas: si hubiera que apretar un botón para verlas, imputar
    // dejaría de ser lo normal y volvería a ser algo que se hace cuando ya hay un lío.
    const cli = clienteDe(c);
    if (cli) traerFacturas(cli.id_control);
  }

  async function traerFacturas(idControl: string) {
    setBuscando(true); setErrFact(null);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(idControl)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudieron traer las facturas');
      setOpciones(j.facturas || []);
    } catch (e: any) {
      setErrFact(e.message || 'No se pudieron traer las facturas');
    }
    setBuscando(false);
  }

  function toggleComprobante(numero: string) {
    setEComprobantes((p) => p.includes(numero) ? p.filter((x) => x !== numero) : [...p, numero]);
  }

  async function guardarEdicion(c: CobranzaUI) {
    setGuardando(true); setErrEdit(null);
    try {
      const r = await fetch('/api/cobranzas/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaccionid: c.transaccionid, cliente: eCliente, cuenta: eCuenta, nota: eNota,
          comprobantes: eComprobantes,
          // Solo se manda si cambió: así una corrección de cliente no congela el importe,
          // que si mañana se corrige en Xubio tiene que poder actualizarse solo.
          importe: Math.round(Number(eImporte)) !== Math.round(c.importeXubio ?? c.importe) ? Number(eImporte) : '',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setEditando(null);
      router.refresh();
    } catch (e: any) {
      setErrEdit(e.message || 'No se pudo guardar');
    }
    setGuardando(false);
  }

  async function ocultar(c: CobranzaUI) {
    if (!window.confirm('Se saca de esta lista. No se borra de Xubio ni de la copia local: deja de mostrarse acá y nada más. ¿Confirmás?')) return;
    setGuardando(true); setErrEdit(null);
    try {
      const r = await fetch('/api/cobranzas/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaccionid: c.transaccionid, oculta: true, nota: eNota || 'sacada de la lista a mano' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setEditando(null);
      router.refresh();
    } catch (e: any) {
      setErrEdit(e.message || 'No se pudo sacar');
    }
    setGuardando(false);
  }

  function mover(n: number) {
    let m = mes + n, a = anio;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    if (a > anioActual || (a === anioActual && m > mesActual)) return;
    setMes(m); setAnio(a); setCuenta(''); setCliente('');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(-1)}>← Anterior</button>
        <span style={{ fontWeight: 700, fontSize: '14px' }}>{MESES[mes - 1]} {anio}</span>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(1)}
          disabled={anio === anioActual && mes === mesActual}>Siguiente →</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}>
          <option value="">Todos los medios de cobro</option>
          {cuentas.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={cliente} onChange={(e) => setCliente(e.target.value)}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', maxWidth: '260px' }}>
          <option value="">Todos los clientes</option>
          {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(cuenta || cliente) && (
          <button type="button" onClick={() => { setCuenta(''); setCliente(''); }}
            style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Limpiar filtros</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '13.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {filtradas.length} {filtradas.length === 1 ? 'cobro' : 'cobros'} · {fmt$(total)}
        </span>
      </div>

      {delMes.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          No hay cobranzas de este mes en la copia local de Xubio. Si acabás de cargarlas, traé lo último con el
          botón de arriba.
        </p>
      ) : (
        <>
          {/* El total por cuenta primero: es el número que se compara contra el banco. */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {porCuenta.map(([c, v]) => (
              <button key={c} type="button" onClick={() => setCuenta(cuenta === c ? '' : c)}
                style={{
                  border: cuenta === c ? '2px solid #166534' : '1px solid #e5e7eb',
                  background: cuenta === c ? '#f0fdf4' : 'white',
                  borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                }}>
                <span style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>{c}</span>
                <strong style={{ fontSize: '14px' }}>{fmt$(v)}</strong>
              </button>
            ))}
          </div>

          <datalist id="clientes-app">{clientesApp.map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="cuentas-app">{cuentasApp.map((c) => <option key={c} value={c} />)}</datalist>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '520px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11.5px' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Medio de cobro</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Recibo</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                  <th style={{ padding: '6px 8px' }} />
                </tr>
              </thead>
              <tbody>
                {filtradas.flatMap((c, i) => [
                  <tr key={`${c.numero}-${i}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(c.fecha)}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>
                      {c.cliente || <span style={{ color: '#b45309', fontWeight: 400 }}>sin cliente</span>}
                      {/* La marca importa: este panel es el espejo de Xubio, y un dato
                          corregido acá NO está así del otro lado. */}
                      {c.editada && <span title={c.nota || 'Corregido a mano en la app'} style={{ fontSize: '9.5px', fontWeight: 700, color: '#b45309', marginLeft: '5px' }}>✎ corregido</span>}
                      {/* Si está imputado, se dice a qué. Es el dato que explica por qué una
                          factura figura cobrada: sin verlo acá, el único lugar donde está
                          esa decisión es la planilla. */}
                      {c.comprobantes && c.comprobantes.length > 0 ? (
                        <span title={c.comprobantes.join(', ')} style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#166534' }}>
                          paga {c.comprobantes.length === 1 ? c.comprobantes[0] : `${c.comprobantes.length} facturas`}
                        </span>
                      ) : (
                        <span style={{ display: 'block', fontSize: '10px', color: '#9ca3af' }}>sin imputar</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', color: c.cuenta ? '#374151' : '#b45309' }}>{c.cuenta || 'sin dato'}</td>
                    <td style={{ padding: '5px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', color: '#9ca3af' }}>{c.numero}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt$(c.importe)}
                      {c.importeXubio !== undefined && Math.round(c.importeXubio) !== Math.round(c.importe) && (
                        <span style={{ display: 'block', fontSize: '9.5px', fontWeight: 400, color: '#b45309' }}>
                          Xubio: {fmt$(c.importeXubio)}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      {c.transaccionid && editando !== String(c.transaccionid) && (
                        <button type="button" onClick={() => abrirEdicion(c)}
                          style={{ background: 'none', border: 'none', fontSize: '11px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
                          corregir / imputar
                        </button>
                      )}
                    </td>
                  </tr>,
                  editando === String(c.transaccionid) ? (
                    <tr key={`${c.numero}-${i}-e`}>
                      <td colSpan={6} style={{ padding: '0 8px 8px' }}>
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '9px 11px' }}>
                          <p style={{ margin: '0 0 7px', fontSize: '11px', color: '#92400e' }}>
                            Se corrige <strong>solo en la app</strong>: Xubio no se toca. Sirve para que esta pantalla se entienda
                            cuando Xubio no manda el cliente o el medio de cobro quedó mal cargado allá.
                            Si cambiás el importe, esta lista deja de cuadrar contra el extracto del banco: la fila queda marcada y
                            abajo del número se muestra el de Xubio, para no perder contra qué se conciliaba.
                          </p>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>CLIENTE</label>
                              <input list="clientes-app" value={eCliente} onChange={(e) => setECliente(e.target.value)} disabled={guardando}
                                style={{ fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', minWidth: '200px' }} />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>MEDIO DE COBRO</label>
                              <input list="cuentas-app" value={eCuenta} onChange={(e) => setECuenta(e.target.value)} disabled={guardando}
                                style={{ fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', minWidth: '150px' }} />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>IMPORTE</label>
                              <input type="number" min={0} value={eImporte} onChange={(e) => setEImporte(e.target.value)} disabled={guardando}
                                style={{ fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '120px' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: '160px' }}>
                              <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>NOTA</label>
                              <input value={eNota} onChange={(e) => setENota(e.target.value)} disabled={guardando} placeholder="por qué se corrigió"
                                style={{ fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%' }} />
                            </div>
                            <button type="button" onClick={() => guardarEdicion(c)} disabled={guardando}
                              style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                              {guardando ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button type="button" onClick={() => setEditando(null)} disabled={guardando}
                              style={{ fontSize: '12px', padding: '6px 10px', background: 'white', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
                              Cancelar
                            </button>
                            <button type="button" onClick={() => ocultar(c)} disabled={guardando}
                              title="La saca de esta lista. No se borra de Xubio."
                              style={{ fontSize: '12px', padding: '6px 10px', background: 'white', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
                              Sacar de la lista
                            </button>
                          </div>
                          {/* ── Qué facturas paga este cobro ────────────────────────── */}
                          {(() => {
                            const cli = clienteDe(c);
                            const elegidas = opciones.filter((f) => eComprobantes.includes(f.numero));
                            // Lo marcado contra lo que entró. No se bloquea si no coincide
                            // —un cobro puede ser parcial o cubrir una retención— pero se
                            // dice: imputar $200 a un cobro de $100 es un error de carga que
                            // después aparece como deuda que no existe.
                            const sumaElegidas = elegidas.reduce((a, f) => a + f.importe, 0);
                            const dif = Math.round(sumaElegidas - c.importe);
                            // Las que no están en la lista traída: una imputación guardada
                            // sobre una factura de hace más de un año, o escrita a mano.
                            const sueltas = eComprobantes.filter((n) => !opciones.some((f) => f.numero === n));
                            return (
                              <div style={{ marginTop: '10px', borderTop: '1px solid #fde68a', paddingTop: '9px' }}>
                                <p style={{ margin: '0 0 6px', fontSize: '11.5px', fontWeight: 700, color: '#92400e' }}>
                                  ¿Qué facturas paga este cobro?
                                  <span style={{ fontWeight: 400, color: '#92400e' }}>
                                    {' '}Lo que marques acá <strong>manda sobre lo que deduzca la app</strong>: esas facturas
                                    quedan cobradas y esta plata deja de repartirse sola entre las más viejas.
                                  </span>
                                </p>
                                {!cli ? (
                                  <p style={{ margin: 0, fontSize: '11.5px', color: '#991b1b' }}>
                                    No hay ningún cliente de la app que se llame "{c.cliente || 'sin cliente'}", así que no
                                    se pueden traer sus facturas. Corregí el cliente acá arriba con el nombre de la lista y
                                    volvé a abrir — o revisá el nombre de Xubio en la ficha del cliente, porque mientras no
                                    coincidan sus facturas tampoco se le están contando.
                                  </p>
                                ) : buscando ? (
                                  <p style={{ margin: 0, fontSize: '11.5px', color: '#92400e' }}>Buscando las facturas de {cli.nombre}…</p>
                                ) : errFact ? (
                                  <p style={{ margin: 0, fontSize: '11.5px', color: '#dc2626' }}>
                                    {errFact}{' '}
                                    <button type="button" onClick={() => traerFacturas(cli.id_control)}
                                      style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, padding: 0 }}>
                                      reintentar
                                    </button>
                                  </p>
                                ) : (
                                  <>
                                    <div style={{ maxHeight: '190px', overflowY: 'auto', background: 'white', border: '1px solid #fde68a', borderRadius: '5px' }}>
                                      {opciones.length === 0 ? (
                                        <p style={{ margin: 0, padding: '7px 9px', fontSize: '11.5px', color: '#9ca3af' }}>
                                          {cli.nombre} no tiene facturas en los últimos 365 días.
                                        </p>
                                      ) : opciones.map((f) => {
                                        const tildada = eComprobantes.includes(f.numero);
                                        return (
                                          <label key={f.numero}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 9px',
                                              borderBottom: '1px solid #f9fafb', cursor: 'pointer', fontSize: '11.5px',
                                              background: tildada ? '#f0fdf4' : undefined,
                                            }}>
                                            <input type="checkbox" checked={tildada} disabled={guardando}
                                              onChange={() => toggleComprobante(f.numero)} />
                                            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10.5px', color: '#1d4ed8', minWidth: '125px' }}>{f.numero}</span>
                                            <span style={{ color: '#6b7280', minWidth: '66px' }}>{fmtDia(f.fecha)}</span>
                                            <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt$(f.importe)}</span>
                                            {/* Por qué la app ya la da por cobrada. Hace falta
                                                para no imputar dos veces la misma, y para ver
                                                cuáles están así solo por deducción. */}
                                            {f.imputadaManual && !tildada && (
                                              <span title="Ya está imputada a otro cobro desde la app" style={{ fontSize: '9px', fontWeight: 700, color: '#166534' }}>imputada</span>
                                            )}
                                            {f.yaCobrada && (
                                              <span title="Entró en un cobro registrado desde la app" style={{ fontSize: '9px', fontWeight: 700, color: '#166534' }}>cobrada</span>
                                            )}
                                            {f.saldadaManual && (
                                              <span title="Alguien la dio por saldada a mano" style={{ fontSize: '9px', fontWeight: 700, color: '#166534' }}>saldada</span>
                                            )}
                                            {f.cubierta && !f.yaCobrada && !f.imputadaManual && !f.saldadaManual && (
                                              <span title="Nadie lo dijo: la app la da por cubierta repartiendo los cobros del cliente de la más vieja a la más nueva. Es exactamente lo que conviene confirmar o corregir acá." style={{ fontSize: '9px', fontWeight: 700, color: '#b45309' }}>deducida</span>
                                            )}
                                          </label>
                                        );
                                      })}
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline', marginTop: '5px' }}>
                                      <span style={{ fontSize: '11.5px', color: '#374151' }}>
                                        {eComprobantes.length === 0 ? 'Ninguna marcada' : `${eComprobantes.length} marcada${eComprobantes.length > 1 ? 's' : ''} · ${fmt$(sumaElegidas)}`}
                                      </span>
                                      {eComprobantes.length > 0 && dif !== 0 && (
                                        <span style={{ fontSize: '11px', color: '#b45309' }}>
                                          {dif > 0
                                            ? `marcaste ${fmt$(dif)} más de lo que entró — revisá que no sobre una factura`
                                            : `faltan ${fmt$(-dif)} para llegar al importe del cobro (puede ser un pago parcial o una retención)`}
                                        </span>
                                      )}
                                      {eComprobantes.length > 0 && (
                                        <button type="button" onClick={() => setEComprobantes([])} disabled={guardando}
                                          style={{ background: 'none', border: 'none', fontSize: '11px', color: '#2563eb', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                                          desmarcar todas
                                        </button>
                                      )}
                                    </div>
                                    {sueltas.length > 0 && (
                                      <p style={{ margin: '4px 0 0', fontSize: '10.5px', color: '#92400e' }}>
                                        Imputado también a {sueltas.join(', ')}, que no está en la lista de arriba (es de hace
                                        más de un año o el número no coincide). Se mantiene al guardar.
                                      </p>
                                    )}
                                    <p style={{ margin: '5px 0 0', fontSize: '10.5px', color: '#92400e' }}>
                                      Guardar con todo desmarcado borra la imputación y la app vuelve a deducirla sola.
                                    </p>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          {errEdit && <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#dc2626' }}>{errEdit}</p>}
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
          </div>

          {delMes.some((c) => !c.cuenta) && (
            <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#b45309' }}>
              Las que dicen "sin dato" se guardaron antes de que la copia local empezara a registrar el medio de
              cobro. Se completan solas la próxima vez que se traiga ese mes de Xubio.
            </p>
          )}
        </>
      )}
    </div>
  );
}
