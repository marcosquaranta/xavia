'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { sugerirCombinaciones, toleranciaDe, estaImpaga } from '@/lib/conciliacionCobro';
import { cuentasElegibles, cuentaSugerida, cantidadPreferidas, cuentasDeRetencion } from '@/lib/cuentasCobro';
import AjustarFactura from '@/components/AjustarFactura';
import { retencionDesdeImporte, cuentaParaRetencion } from '@/lib/retenciones';
import CobroEnPartes, { chequearPartes, type ParteUI } from '@/components/CobroEnPartes';

interface ClienteOpt {
  id_control: string;
  nombre: string;
  // % que este cliente retiene al pagar (Admin → Clientes de venta). Sirve para proponer
  // la retención sola, igual que en la bandeja.
  retencionPct?: number;
}
interface CobroFila {
  id_cobro: string; cliente: string; fecha: string; importe: number;
  numero_recibo: string; transaccionid: string; estado: string; observacion: string;
  // Cuándo se cargó desde la app, que no es lo mismo que la fecha del cobro: un cobro de
  // ayer se puede registrar hoy, y lo que se quiere ver al terminar es lo cargado HOY.
  fecha_registro?: string;
}

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : '—'; };
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const diasDesde = (f: string) => Math.round((Date.now() - new Date(f + 'T12:00:00').getTime()) / 86400000);

// ── Las CUATRO marcas, no una ───────────────────────────────────────────────────────
//
// Este tipo declaraba solo `yaCobrada`, y el endpoint devuelve cuatro: también `cubierta`
// (los cobros que el cliente tiene en Xubio alcanzan a taparla), `saldadaManual` (se dio por
// saldada a mano) e `imputadaManual`.
//
// Como el tipo no las nombraba, la lista de acá arriba mostraba como ABIERTA una factura
// que el panel de abajo —que sí mira las cuatro— contaba como cobrada. La misma pantalla
// decía dos cosas distintas del mismo cliente.
//
// Los datos siempre llegaron: lo que faltaba era mirarlos. Ahora se usa `estaImpaga`, la
// misma función con la que se decide qué reclamar y qué ofrecer al imputar.
interface FacturaCliente {
  numero: string; fecha: string; importe: number;
  yaCobrada: boolean;
  cubierta?: boolean;
  // El cobro de Xubio al que está imputada, cuando lo está. Permite decir a cuál, que es
  // lo que sigue a "imputada".
  imputadaA?: string;
  saldadaManual?: boolean;
  imputadaManual?: boolean;
}


// Diagnóstico + carga de cobros. El diagnóstico va primero a propósito: hasta no verlo en
// verde no se sabe si las credenciales y las cuentas están bien, y el primer cobro no es
// el momento de descubrirlo.
interface CobroXubio {
  transaccionid: string;
  fecha: string;
  importe: number;
  numero: string;
  // Las facturas que este cobro YA tiene imputadas a mano. Vacío significa que es uno de
  // los que se reparten solos, que es lo que hay que poder corregir.
  imputadas: string[];
}

export default function RegistrarCobro({ clientes, cobros, cuentasIniciales = [], errorCuentas = null, ultimaCuentaPorCliente = {} }: {
  clientes: ClienteOpt[]; cobros: CobroFila[];
  cuentasIniciales?: { id: number; nombre: string }[];
  errorCuentas?: string | null;
  // Dónde entró la plata de cada cliente la última vez, sacado de las cobranzas que ya
  // están en Xubio. La bandeja ya lo usaba; acá había que elegir la cuenta a mano en cada
  // cobro, que es una decisión ya tomada y es justo el campo donde equivocarse manda la
  // plata a la cuenta que no es.
  ultimaCuentaPorCliente?: Record<string, string>;
}) {
  const [diag, setDiag] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [cuentas, setCuentas] = useState<{ id: number; nombre: string }[]>(cuentasIniciales);
  // Solo las cuentas por las que entra plata de verdad (Brubank, Macro, Caja MQ). El
  // resto de las que devuelve Xubio son cuentas viejas o de otro circuito, y tenerlas en
  // la lista solo agrega chances de imputar a la cuenta equivocada.
  const cuentasOrdenadas = useMemo(() => cuentasElegibles(cuentas), [cuentas]);
  const [avisoCuentas, setAvisoCuentas] = useState<string | null>(null);

  const [cliente, setCliente] = useState('');
  // Si la tocaste a mano, no se pisa. Elegir otro cliente después de haber corregido la
  // cuenta volvería a ponerle la de costumbre y te haría corregirla de nuevo.
  const [cuentaTocada, setCuentaTocada] = useState(false);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [importe, setImporte] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [observacion, setObservacion] = useState('');
  // Retención sufrida. Sin esto, un cobro con retención se registraba por el neto y la
  // factura quedaba figurando impaga para siempre por el monto retenido — la deuda se
  // llenaba de saldos de monedas que nadie va a cobrar nunca.
  const [retencion, setRetencion] = useState('');
  const [cuentaRet, setCuentaRet] = useState('');
  // Cobro que entra en varias fechas: un cheque a 30 días, o media entrega ahora y la otra
  // mitad después. `fecha` sigue siendo la del cobro cuando entra de una sola vez.
  const [enPartes, setEnPartes] = useState(false);
  const [partes, setPartes] = useState<ParteUI[]>([]);
  const [verTodasCuentasRet, setVerTodasCuentasRet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [filas, setFilas] = useState(cobros);
  // Lo que se mira después de registrar un cobro es si ESE cobro salió. Los de la semana
  // pasada ya se miraron el día que se cargaron: quedan atrás de un click.
  const [verViejos, setVerViejos] = useState(false);

  // Facturas del cliente elegido, para tildar cuáles cubre el cobro.
  const [facturas, setFacturas] = useState<FacturaCliente[]>([]);
  // Los cobros que este cliente tiene en Xubio. Son los que producen las "cubierta": la app
  // los reparta de la factura más vieja a la más nueva porque Xubio no dice cuál cancela
  // cada uno. Mostrarlos es lo que convierte una deducción en algo revisable.
  const [cobrosXubio, setCobrosXubio] = useState<CobroXubio[]>([]);
  const [verCobros, setVerCobros] = useState(false);
  // Qué cobro se está imputando a mano, y a qué facturas.
  const [imputando, setImputando] = useState<string | null>(null);
  const [imputarA, setImputarA] = useState<string[]>([]);
  const [imputandoMsg, setImputandoMsg] = useState<string | null>(null);
  const [diasVentana, setDiasVentana] = useState(365);
  const [facturasLoading, setFacturasLoading] = useState(false);
  const [facturasError, setFacturasError] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [importeTocado, setImporteTocado] = useState(false);
  // Qué factura se está corrigiendo, si alguna.
  const [ajustando, setAjustando] = useState<string | null>(null);

  // La cuenta a la que ese cliente pagó la última vez, resuelta contra las cuentas reales
  // de Xubio. Mismo criterio que la bandeja: el nombre guardado no es un id, así que hay
  // que mapearlo.
  function cuentaDeCostumbre(id: string): string {
    const nombre = id ? (ultimaCuentaPorCliente[id] || '') : '';
    if (!nombre) return '';
    const c = cuentaSugerida(cuentas, nombre);
    return c ? String(c.id) : '';
  }

  async function cambiarCliente(idControl: string) {
    setCliente(idControl);
    // Se preselecciona la de siempre, pero queda editable y el cartelito de abajo dice de
    // dónde salió: una cuenta que aparece sola y sin explicación se confirma sin mirarla.
    if (!cuentaTocada) {
      const costumbre = cuentaDeCostumbre(idControl);
      if (costumbre) setCuentaId(costumbre);
    }
    setFacturas([]); setElegidas([]); setFacturasError(null); setCobrosXubio([]);
    setImporte(''); setImporteTocado(false);
    // Cada cliente retiene un porcentaje distinto (o ninguno): dejar el número del cliente
    // anterior es peor que dejarlo vacío.
    setRetencion('');
    if (!idControl) return;
    setFacturasLoading(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(idControl)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudieron traer las facturas');
      setFacturas(j.facturas || []);
      setCobrosXubio(j.cobrosXubio || []);
      setVerCobros(false); setImputando(null); setImputarA([]); setImputandoMsg(null);
      setDiasVentana(Number(j.dias) || 365);
      // La ventana la decide la API (365 días). La pantalla decía 120 y era mentira: hacía
      // creer que faltaban facturas por estar fuera de rango cuando el rango era otro.
      if (!(j.facturas || []).length) setFacturasError(`Este cliente no tiene facturas en los últimos ${Number(j.dias) || 365} días.`);
    } catch (e: any) {
      setFacturasError(e.message || 'No se pudieron traer las facturas');
    }
    setFacturasLoading(false);
  }

  // De la factura al cobro: "imputada" sola no dice a cuál, y el id de transacción de
  // Xubio no se lee. Se muestra la fecha y el importe, que es con lo que uno lo reconoce.
  function cobroDe(f: FacturaCliente): string {
    if (!f.imputadaA) return '';
    const c = cobrosXubio.find((x) => x.transaccionid === f.imputadaA);
    return c ? `${fmtDia(c.fecha)} ${fmt$(c.importe)}` : '';
  }

  // Imputar un cobro de Xubio a facturas concretas. No toca Xubio: guarda de este lado QUÉ
  // cancela ese cobro, que es lo que Xubio no puede decir. A partir de ahí esas facturas
  // dejan de depender del reparto automático y figuran como "imputada", que es un hecho.
  async function imputarCobro(c: CobroXubio) {
    if (!imputarA.length) { setImputandoMsg('Tildá al menos una factura.'); return; }
    setImputandoMsg('Guardando…');
    try {
      const r = await fetch('/api/cobranzas/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaccionid: c.transaccionid, comprobantes: imputarA.join(', ') }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar');
      setImputandoMsg('✓ Imputado. Recargá para ver las facturas actualizadas.');
      setImputando(null); setImputarA([]);
      // Se vuelven a pedir las facturas: lo que cambió es justamente cómo quedan marcadas,
      // y dejar la lista vieja en pantalla haría dudar de si el guardado funcionó.
      cambiarCliente(cliente);
    } catch (e: any) {
      setImputandoMsg(e.message || 'No se pudo guardar');
    }
  }

  // Tildar facturas completa el importe solo (la suma de las elegidas), salvo que ya lo
  // hayan escrito a mano: un cobro puede ser parcial o incluir algo que no está en la lista.
  function toggleFactura(numero: string) {
    const nuevas = elegidas.includes(numero) ? elegidas.filter((n) => n !== numero) : [...elegidas, numero];
    setElegidas(nuevas);
    if (!importeTocado) {
      const total = facturas.filter((f) => nuevas.includes(f.numero)).reduce((a, f) => a + f.importe, 0);
      setImporte(total > 0 ? String(Math.round(total)) : '');
    }
  }

  // La cuenta más usada queda elegida de entrada; se puede cambiar, pero el caso normal
  // (entró por Brubank) no obliga a tocar nada.
  useEffect(() => {
    if (!cuentaId && cuentasOrdenadas.length) setCuentaId(String(cuentasOrdenadas[0].id));
  }, [cuentasOrdenadas, cuentaId]);

  // Siempre ganancias, que es la única retención que aplica hoy. El desplegable queda por
  // si alguna vez hay otra, pero en el caso normal no hay que elegir nada.
  const cuentasRet = useMemo(() => cuentasDeRetencion(cuentas), [cuentas]);
  useEffect(() => {
    if (!cuentaRet) {
      const c = cuentaParaRetencion(cuentas);
      if (c) setCuentaRet(String(c.id));
    }
  }, [cuentas, cuentaRet]);

  // Combinaciones de facturas que dan ese importe. Se calculan cuando el importe se escribió
  // a mano — que es el caso real: entró una transferencia y hay que averiguar qué cancela.
  const sugerencias = useMemo(() => {
    const monto = Math.round(Number(importe) || 0);
    if (!importeTocado || !(monto > 0) || !facturas.length) return [];
    return sugerirCombinaciones(facturas, monto);
  }, [importe, importeTocado, facturas]);

  function aplicarSugerencia(numeros: string[]) {
    setElegidas(numeros);
  }

  const pctCliente = Number(clientes.find((c) => c.id_control === cliente)?.retencionPct) || 0;
  const totalElegido = facturas.filter((f) => elegidas.includes(f.numero)).reduce((a, f) => a + f.importe, 0);
  const difImporte = Math.round(Number(importe) || 0) - Math.round(totalElegido);

  async function correrDiagnostico() {
    setDiagLoading(true); setDiag(null);
    try {
      const r = await fetch('/api/cobranzas/diagnostico');
      const j = await r.json();
      setDiag(j);
      if (Array.isArray(j.cuentas)) setCuentas(j.cuentas);
      setAvisoCuentas(j.avisoCuentas || null);
    } catch (e: any) {
      setDiag({ ok: false, pasos: [{ paso: 'Conexión', ok: false, detalle: e.message || 'error' }] });
    }
    setDiagLoading(false);
  }

  async function registrar() {
    if (!cliente || !(Number(importe) > 0) || !cuentaId) {
      setMsg({ t: 'err', s: 'Completá cliente, importe y cuenta.' }); return;
    }
    if (Number(retencion) > 0 && !Number(cuentaRet)) {
      setMsg({ t: 'err', s: 'Elegí a qué cuenta va la retención.' }); return;
    }
    const nombre = clientes.find((c) => c.id_control === cliente)?.nombre || '';
    const cuentaNom = cuentas.find((c) => String(c.id) === cuentaId)?.nombre || '';
    const retTxt = Number(retencion) > 0
      ? `\nRetención: $${Number(retencion).toLocaleString('es-AR')} — cancela $${(Math.round(Number(importe)) + Math.round(Number(retencion))).toLocaleString('es-AR')} de facturas.`
      : '';
    const chk = enPartes ? chequearPartes(Number(importe), partes) : null;
    if (chk?.error) { setMsg({ t: 'err', s: chk.error }); return; }
    const cuandoTxt = chk
      ? `que entra en ${chk.lista.length} veces: ${chk.lista.map((x) => `${fmtDia(x.fecha)} $${x.importe.toLocaleString('es-AR')}`).join(' · ')}`
      : `con fecha ${fmtDia(fecha)}`;
    if (!confirm(`Se va a registrar en Xubio un cobro de $${Number(importe).toLocaleString('es-AR')} de ${nombre}, en ${cuentaNom}, ${cuandoTxt}.${retTxt}\n\nEsto impacta en la contabilidad. ¿Confirmás?`)) return;

    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/cobro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_control: cliente, fecha, importe: Number(importe), cuentaId: Number(cuentaId),
          observacion, comprobantes: elegidas,
          ...(enPartes ? { partes: chequearPartes(Number(importe), partes).lista } : {}),
          retencion: Number(retencion) || 0,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al registrar');
      setMsg({ t: 'ok', s: `✓ Registrado en Xubio${j.partes > 1 ? ` en ${j.partes} partes` : ''}${j.numeroRecibo ? ` — recibo ${j.numeroRecibo}` : ''}. Recargando…` });
      setFilas((p) => [{
        id_cobro: j.id_cobro, cliente: nombre, fecha, importe: Number(importe),
        numero_recibo: j.numeroRecibo || '', transaccionid: String(j.transaccionid || ''),
        estado: 'registrado', observacion,
      }, ...p]);
      setTimeout(() => window.location.reload(), 1800);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al registrar' });
      setLoading(false);
    }
  }

  async function anular(c: CobroFila) {
    if (!confirm(`Se va a BORRAR de Xubio el cobro de ${c.cliente} por $${Number(c.importe).toLocaleString('es-AR')}. ¿Confirmás?`)) return;
    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/cobro', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cobro: c.id_cobro }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al anular');
      setMsg({ t: 'ok', s: '✓ Anulado en Xubio. Recargando…' });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al anular' });
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        <button onClick={correrDiagnostico} disabled={diagLoading}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
          {diagLoading ? 'Probando…' : '🔌 Probar conexión con Xubio'}
        </button>
        <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>No escribe nada — solo lee. Sirve para ver dónde falla si algo no anda.</span>
      </div>

      {diag && (
        <div style={{ marginBottom: '12px', fontSize: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
          {(diag.pasos || []).map((p: any, i: number) => (
            <p key={i} style={{ margin: '0 0 3px', color: p.ok ? '#166534' : '#dc2626' }}>
              {p.ok ? '✓' : '✕'} <strong>{p.paso}</strong> — {p.detalle}
            </p>
          ))}
          {avisoCuentas && (
            <p style={{ margin: '6px 0 0', color: '#92400e', background: '#fffbeb', padding: '6px 8px', borderRadius: '5px', lineHeight: 1.45 }}>
              ⚠ {avisoCuentas}
            </p>
          )}
        </div>
      )}

      {cuentas.length === 0 && (
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#dc2626', background: '#fef2f2', padding: '8px 10px', borderRadius: '6px' }}>
          No se pudieron traer las cuentas de Xubio{errorCuentas ? `: ${errorCuentas}` : ''}. Sin cuentas no se puede imputar un cobro — probá el diagnóstico de arriba para ver dónde falla.
        </p>
      )}

      {cuentas.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Cliente *</label>
              <select value={cliente} onChange={(e) => cambiarCliente(e.target.value)} disabled={loading} style={inputStyle}>
                <option value="">— Elegir —</option>
                {clientes.map((c) => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha del cobro *</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading || enPartes} style={inputStyle} />
              {enPartes && <span style={{ fontSize: '10px', color: '#64748b' }}>La define cada parte</span>}
            </div>
            <div>
              <label style={labelStyle}>Importe *</label>
              <input type="number" min={1} value={importe} onChange={(e) => { setImporte(e.target.value); setImporteTocado(true); }} disabled={loading} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>¿Dónde entró? *</label>
              <select value={cuentaId} onChange={(e) => { setCuentaId(e.target.value); setCuentaTocada(true); }} disabled={loading} style={inputStyle}>
                <option value="">— Elegir cuenta —</option>
                {(() => {
                  // Las de cobro arriba, el resto detrás de un separador: el plan de cuentas
                  // de Xubio trae 78 cuentas y casi todas son de gastos.
                  const nPref = cantidadPreferidas(cuentasOrdenadas);
                  return cuentasOrdenadas.map((c, i) => (
                    <Fragment key={c.id}>
                      {i === nPref && nPref > 0 && <option disabled>──────────</option>}
                      <option value={c.id}>{c.nombre}</option>
                    </Fragment>
                  ));
                })()}
              </select>
              {/* De dónde salió la cuenta que aparece elegida. Una preselección sin
                  explicación se confirma sin mirarla, y acá confirmar la cuenta equivocada
                  manda la plata a otro lado en Xubio. */}
              {cliente && !cuentaTocada && cuentaDeCostumbre(cliente) === cuentaId && cuentaId && (
                <span style={{ fontSize: '10px', color: '#059669', display: 'block', marginTop: '2px' }}>
                  Es donde este cliente pagó la última vez
                </span>
              )}
            </div>
            <div>
              <label style={labelStyle}>Retención sufrida (opcional)</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input type="number" value={retencion} onChange={(e) => setRetencion(e.target.value)} disabled={loading}
                  style={{ ...inputStyle, flex: 1 }} placeholder="0" min="0" />
                {pctCliente > 0 && (
                  <button type="button" disabled={loading || !(Number(importe) > 0)}
                    onClick={() => setRetencion(String(retencionDesdeImporte(Number(importe) || 0, pctCliente)))}
                    title={`${pctCliente}% del importe, según lo configurado para este cliente`}
                    style={{ fontSize: '11px', fontWeight: 700, padding: '0 8px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {pctCliente}%
                  </button>
                )}
              </div>
              {Number(retencion) > 0 && (
                <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#6b7280' }}>
                  Cancela {fmt$(Math.round(Number(importe) || 0) + Math.round(Number(retencion)))} de facturas.
                </p>
              )}
            </div>
            {Number(retencion) > 0 && (
              <div>
                <label style={labelStyle}>
                  Cuenta de la retención{' '}
                  <button type="button" onClick={() => setVerTodasCuentasRet((v) => !v)}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '9.5px', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>
                    {verTodasCuentasRet ? '(solo las de retención)' : '(ver todas)'}
                  </button>
                </label>
                <select value={cuentaRet} onChange={(e) => setCuentaRet(e.target.value)} disabled={loading} style={inputStyle}>
                  <option value="">— elegí la cuenta —</option>
                  {(verTodasCuentasRet ? cuentas : cuentasRet).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Observación (opcional)</label>
              <input value={observacion} onChange={(e) => setObservacion(e.target.value)} disabled={loading} style={inputStyle}
                placeholder="ej: transferencia del 12/09" />
            </div>
          </div>

          {/* Cobro que entra en varias fechas (cheques, pago en partes). Va plegado: es la
              excepción, y una fila de fechas siempre abierta haría dudar de si hay que
              completarla en un cobro normal. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '9px 0 0', fontSize: '11.5px', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={enPartes} disabled={loading}
              onChange={(e) => {
                setEnPartes(e.target.checked);
                setPartes(e.target.checked ? [{ fecha, importe: '' }, { fecha: '', importe: '' }] : []);
              }} />
            La plata entra en varias fechas (cheques, pago en partes)
          </label>
          {enPartes && (
            <div style={{ marginTop: '7px' }}>
              <CobroEnPartes total={Number(importe) || 0} partes={partes} onChange={setPartes} disabled={loading}
                nota={Number(retencion) > 0 ? 'La retención va entera en la primera.' : ''} />
            </div>
          )}

          {/* ── Los cobros que este cliente tiene en Xubio ──────────────────────────────
              "CUBIERTA" no sale de un movimiento que se pueda abrir: la app suma lo que el
              cliente cobró y lo reparte de la factura más vieja a la más nueva, porque
              Xubio no dice qué factura cancela cada cobranza.
              Eso dejaba a quien mira sin nada que revisar. Acá están esos cobros, y de cada
              uno se puede decir QUÉ factura cancela: imputado deja de ser una deducción y
              pasa a ser un hecho. */}
          {cliente && cobrosXubio.length > 0 && (
            <div style={{ marginTop: '12px', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '8px 10px', background: '#fafaf9' }}>
              <button type="button" onClick={() => setVerCobros((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11.5px', fontWeight: 700, color: '#374151' }}>
                {verCobros ? '▾' : '▸'} Cobros de este cliente en Xubio ({cobrosXubio.length}) · {fmt$(cobrosXubio.reduce((a, c) => a + c.importe, 0))}
              </button>
              <p style={{ margin: '3px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
                Son los que hacen que arriba diga <strong>CUBIERTA</strong>. Xubio no dice qué factura
                cancela cada uno, así que la app los reparte de la más vieja a la más nueva. Si el reparto
                no es el correcto, decile a cuál va.
              </p>
              {verCobros && (
                <div style={{ marginTop: '7px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {cobrosXubio.map((c) => (
                    <div key={c.transaccionid} style={{ borderTop: '1px solid #f3f4f6', paddingTop: '4px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '11.5px' }}>
                        <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(c.fecha)}</span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt$(c.importe)}</span>
                        {c.numero && <span style={{ color: '#9ca3af', fontFamily: 'ui-monospace, monospace', fontSize: '10.5px' }}>{c.numero}</span>}
                        {c.imputadas.length > 0 ? (
                          <span style={{ fontSize: '10.5px', color: '#166534' }}>
                            paga {c.imputadas.join(', ')}
                          </span>
                        ) : (
                          <span style={{ fontSize: '10.5px', color: '#b45309' }}>se reparte solo</span>
                        )}
                        <button type="button"
                          onClick={() => {
                            setImputando(imputando === c.transaccionid ? null : c.transaccionid);
                            setImputarA(c.imputadas);
                            setImputandoMsg(null);
                          }}
                          style={{ marginLeft: 'auto', fontSize: '10.5px', padding: '2px 8px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '4px', cursor: 'pointer', color: '#1d4ed8', fontWeight: 600 }}>
                          {imputando === c.transaccionid ? 'Cancelar' : c.imputadas.length ? 'Cambiar' : 'Decir qué paga'}
                        </button>
                      </div>
                      {imputando === c.transaccionid && (
                        <div style={{ margin: '6px 0 4px', padding: '7px 9px', background: 'white', border: '1px solid #dbe4fb', borderRadius: '6px' }}>
                          <p style={{ margin: '0 0 5px', fontSize: '10.5px', color: '#6b7280' }}>
                            Tildá las facturas que cancela este cobro de {fmt$(c.importe)}.
                          </p>
                          <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {facturas.map((f) => (
                              <label key={f.numero} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={imputarA.includes(f.numero)}
                                  onChange={() => setImputarA((p) => p.includes(f.numero) ? p.filter((x) => x !== f.numero) : [...p, f.numero])} />
                                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10.5px' }}>{f.numero}</span>
                                <span style={{ color: '#9ca3af' }}>{fmtDia(f.fecha)}</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt$(f.importe)}</span>
                              </label>
                            ))}
                          </div>
                          {imputarA.length > 0 && (() => {
                            const suma = facturas.filter((f) => imputarA.includes(f.numero)).reduce((a, f) => a + f.importe, 0);
                            const dif = Math.round(suma - c.importe);
                            return (
                              <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: Math.abs(dif) < 1 ? '#166534' : '#b45309' }}>
                                Tildadas: {fmt$(suma)} · cobro: {fmt$(c.importe)}
                                {/* La diferencia se dice, no se bloquea: un pago parcial o uno
                                    con retención no cierran exacto y son legítimos. */}
                                {Math.abs(dif) >= 1 && ` · ${dif > 0 ? 'faltan' : 'sobran'} ${fmt$(Math.abs(dif))} — puede ser un pago parcial o una retención`}
                              </p>
                            );
                          })()}
                          <button type="button" onClick={() => imputarCobro(c)}
                            style={{ marginTop: '7px', fontSize: '11px', padding: '4px 11px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
                            Guardar
                          </button>
                          {imputandoMsg && <span style={{ marginLeft: '8px', fontSize: '10.5px', color: imputandoMsg.startsWith('✓') ? '#166534' : '#b45309' }}>{imputandoMsg}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Facturas del cliente: de la más reciente a la más vieja. Tildarlas completa el
              importe y además deja asentado en el recibo de Xubio qué cubre el cobro —
              imputar de verdad no se puede por API, esto es lo más cerca que llega. */}
          {cliente && (
            <div style={{ marginTop: '12px' }}>
              {facturasLoading && <p style={{ margin: 0, fontSize: '11.5px', color: '#6b7280' }}>Buscando facturas…</p>}
              {facturasError && <p style={{ margin: 0, fontSize: '11.5px', color: '#b45309' }}>{facturasError}</p>}
              {facturas.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151' }}>Facturas del cliente</span>
                    <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>últimos {diasVentana} días · tildá las que cubre este cobro</span>
                    {elegidas.length > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: 700, color: '#166534' }}>
                        {elegidas.length} tildada{elegidas.length > 1 ? 's' : ''} · {fmt$(totalElegido)}
                      </span>
                    )}
                  </div>
                  {sugerencias.length > 0 && (
                    <div style={{ marginBottom: '8px', background: '#f5f8ff', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '7px 9px' }}>
                      <p style={{ margin: '0 0 5px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>
                        Con {fmt$(Math.round(Number(importe) || 0))} podrían estar pagando:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {sugerencias.map((sg, i) => (
                          <button key={i} type="button" onClick={() => aplicarSugerencia(sg.numeros)} disabled={loading}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%',
                              textAlign: 'left', cursor: 'pointer', fontSize: '11.5px', padding: '4px 7px',
                              background: 'white', border: '1px solid #dbe4fb', borderRadius: '5px', color: '#1f2937',
                            }}>
                            <span style={{ fontWeight: 700 }}>{sg.numeros.length === 1 ? '1 factura' : `${sg.numeros.length} facturas`}</span>
                            {sg.masViejas && (
                              <span title="Las facturas más viejas sin cobrar, sumadas hasta acercarse al importe"
                                style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#fef3c7', color: '#92400e' }}>
                                las más viejas
                              </span>
                            )}
                            {sg.consecutivas && (
                              <span title="Comprobantes seguidos del cliente" style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#ede9fe', color: '#5b21b6' }}>
                                seguidas
                              </span>
                            )}
                            <span style={{ fontFamily: 'monospace', fontSize: '10.5px', color: '#1d4ed8' }}>{sg.numeros.join(' + ')}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt$(sg.total)}</span>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px',
                              background: sg.exacta ? '#dcfce7' : '#fef3c7', color: sg.exacta ? '#166534' : '#92400e' }}>
                              {sg.exacta ? 'exacto' : `${sg.diferencia > 0 ? '+' : '−'}${fmt$(Math.abs(sg.diferencia))}`}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p style={{ margin: '5px 0 0', fontSize: '10px', color: '#6b7280', lineHeight: 1.45 }}>
                        Es una sugerencia: tocá una y quedan tildadas. Se admite hasta {fmt$(toleranciaDe(Math.round(Number(importe) || 0)))} de
                        diferencia, por retenciones o redondeos. Las que ya entraron en un cobro no se proponen, y entre
                        dos opciones iguales se propone primero la más nueva.
                      </p>
                    </div>
                  )}
                  <div style={{ maxHeight: '210px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                    {facturas.map((f) => {
                      const tildada = elegidas.includes(f.numero);
                      // Cerrada por cualquiera de las cuatro vías. Una factura cerrada no se
                      // puede tildar: imputarle un cobro a algo que ya está cobrado lo cuenta
                      // dos veces y deja otra factura abierta tapada.
                      const cerrada = !estaImpaga(f as any);
                      // ── Una "cubierta" se puede tildar igual ──────────────────────────
                      //
                      // Las otras tres marcas son hechos: alguien registró el cobro, lo
                      // imputó o la dio por saldada. "Cubierta" no: es una deducción de la
                      // app repartiendo los cobros de Xubio de la más vieja a la más nueva.
                      //
                      // Bloquear por una deducción es lo peor de los dos mundos: si la app
                      // se equivocó, el que sabe la verdad no puede corregirla desde acá y
                      // tiene que ir a buscar otro camino. Se muestra el cartel y se deja
                      // tildar — el aviso alcanza, el candado sobra.
                      const soloDeducida = cerrada && !f.yaCobrada && !f.imputadaManual && !f.saldadaManual;
                      return (
                        <label key={f.numero}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 9px',
                            borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: '12px',
                            background: tildada ? '#f0fdf4' : cerrada ? '#fafafa' : 'white',
                            // La deducida se ve apenas atenuada, no apagada: sigue siendo
                            // una factura con la que se puede operar.
                            opacity: cerrada ? (soloDeducida ? 0.85 : 0.6) : 1,
                          }}>
                          <input type="checkbox" checked={tildada} disabled={loading || (cerrada && !soloDeducida)} onChange={() => toggleFactura(f.numero)} />
                          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1d4ed8', minWidth: '132px' }}>{f.numero}</span>
                          <span style={{ color: '#6b7280', minWidth: '78px' }}>{fmtDia(f.fecha)}</span>
                          <span style={{ color: '#9ca3af', fontSize: '10.5px', minWidth: '52px' }}>{diasDesde(f.fecha)}d</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt$(f.importe)}</span>
                          {/* Corregir el importe sin salir de acá. Es el caso de la factura
                              mal cargada que el cliente pagó bien: mientras el importe esté
                              mal, lo tildado nunca va a coincidir con lo que entró. */}
                          <span
                            role="button"
                            tabIndex={0}
                            title="Corregir el importe de esta factura"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAjustando(ajustando === f.numero ? null : f.numero); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setAjustando(ajustando === f.numero ? null : f.numero); } }}
                            style={{ color: '#9ca3af', fontSize: '11px', cursor: 'pointer', padding: '0 2px' }}
                          >✎</span>
                          {/* Por qué está cerrada, no solo que lo está. “Cubierta” no es lo
                              mismo que “cobrada”: la primera la dedujo la app repartiendo los
                              cobros de Xubio, y es la que conviene poder discutir. */}
                          {cerrada && (
                            <span
                              title={f.yaCobrada ? 'Ya entró en un cobro registrado desde la app'
                                : f.imputadaManual ? `Se imputó a mano al cobro ${cobroDe(f) || 'de Xubio'}`
                                : f.saldadaManual ? 'Se dio por saldada a mano, sin registrar cobro en Xubio'
                                : 'Los cobros que el cliente tiene en Xubio alcanzan a cubrirla. No es un hecho: lo dedujo la app repartiendo de la más vieja a la más nueva. Abrí "Cobros de este cliente en Xubio" para decir a cuál va de verdad.'}
                              style={{ fontSize: '9.5px', background: '#f3f4f6', color: '#6b7280', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {f.yaCobrada ? 'ya cobrada'
                                : f.imputadaManual ? `imputada${cobroDe(f) ? ` · ${cobroDe(f)}` : ''}`
                                : f.saldadaManual ? 'saldada a mano'
                                : 'cubierta'}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {ajustando && (() => {
                    const f = facturas.find((x) => x.numero === ajustando);
                    if (!f) return null;
                    return (
                      <AjustarFactura
                        numero={f.numero}
                        importeActual={f.importe}
                        idControl={cliente}
                        cliente={clientes.find((c) => c.id_control === cliente)?.nombre || ''}
                        deshabilitado={loading}
                        onCancelar={() => setAjustando(null)}
                        onListo={async () => { setAjustando(null); await cambiarCliente(cliente); }}
                      />
                    );
                  })()}
                  {elegidas.length > 0 && difImporte !== 0 && (
                    <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#b45309' }}>
                      ⚠ El importe no coincide con lo tildado ({fmt$(totalElegido)}): {difImporte > 0 ? `hay ${fmt$(difImporte)} de más` : `faltan ${fmt$(-difImporte)}`}.
                      Si es un pago parcial o a cuenta está bien, es solo un aviso.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={registrar} disabled={loading}
              style={{ fontSize: '11.5px', padding: '6px 14px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Registrando…' : 'Registrar cobro en Xubio'}
            </button>
            {msg && <span style={{ fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</span>}
          </div>
        </>
      )}

      {filas.length > 0 && (() => {
        const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        const deHoy = filas.filter((c) => String(c.fecha_registro || c.fecha || '').slice(0, 10) === hoyStr);
        const viejos = filas.filter((c) => !deHoy.includes(c));
        const visibles = verViejos ? filas : deHoy;
        return (
        <div style={{ marginTop: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
              Cobros registrados desde la app {deHoy.length > 0 && !verViejos ? '— hoy' : ''}
            </p>
            {viejos.length > 0 && (
              <button type="button" onClick={() => setVerViejos((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>
                {verViejos ? 'Ver solo los de hoy' : `Ver los ${viejos.length} anteriores`}
              </button>
            )}
          </div>
          {visibles.length === 0 && (
            <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#9ca3af' }}>Hoy no se registró ningún cobro.</p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '520px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Recibo</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.id_cobro} style={{ borderTop: '1px solid #f3f4f6', opacity: c.estado === 'anulado' ? 0.45 : 1 }}>
                  <td style={{ padding: '6px 8px', color: '#6b7280' }}>{fmtDia(c.fecha)}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, textDecoration: c.estado === 'anulado' ? 'line-through' : 'none' }}>{c.cliente}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>${Number(c.importe).toLocaleString('es-AR')}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '11px' }}>
                    {c.numero_recibo || '—'}
                    {/* La observación se escribía y no se veía nunca: iba a la planilla y
                        al recibo de Xubio, pero no a la pantalla donde se la busca. */}
                    {c.observacion && (
                      <span style={{ display: 'block', fontFamily: 'inherit', fontSize: '10.5px', color: '#6b7280', fontStyle: 'italic' }}>
                        {c.observacion}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {c.estado === 'anulado'
                      ? <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>anulado</span>
                      : <button onClick={() => anular(c)} disabled={loading}
                          style={{ fontSize: '10.5px', padding: '3px 9px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
                          Anular
                        </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
