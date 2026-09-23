'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sugerirCombinaciones, toleranciaDe } from '@/lib/conciliacionCobro';
import { cuentasElegibles, cuentaSugerida } from '@/lib/cuentasCobro';

interface ItemUI {
  id_item: string;
  fecha: string;
  importe: number;
  descripcion: string;
  id_control: string;
  cliente: string;
  nota: string;
  origen: string;  // banco | mail | manual | setup
}
interface ClienteOpt { id_control: string; nombre: string }
interface FacturaCliente { numero: string; fecha: string; importe: number; yaCobrada: boolean }

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };

// Una fila de la bandeja: un movimiento que entró y todavía no se imputó. Se resuelve
// entera acá adentro —cliente, facturas, cuenta— sin salir a otra pantalla, porque el
// trabajo real es ir una por una y cualquier salto extra se paga por cada movimiento.
function Fila({ item, clientes, cuentas, onListo, facturasPrecargadas, sugeridasIniciales }: {
  item: ItemUI; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
  onListo: (msg: string) => void;
  facturasPrecargadas?: Record<string, FacturaCliente[]>;
  sugeridasIniciales?: string[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [idControl, setIdControl] = useState(item.id_control || '');
  // Las tres cuentas reales, y la que sugiere el propio aviso: si dice "transferencia a
  // Banco Macro", tiene que quedar Macro elegido y no la de siempre.
  const cuentasOk = useMemo(() => cuentasElegibles(cuentas), [cuentas]);
  const [cuentaId, setCuentaId] = useState(() => {
    const sug = cuentaSugerida(cuentas, `${item.descripcion} ${item.cliente}`);
    return sug ? String(sug.id) : (cuentas.length ? String(cuentas[0].id) : '');
  });
  // Las facturas ya vienen con la página: abrir la fila no dispara ninguna consulta.
  const [facturas, setFacturas] = useState<FacturaCliente[]>(
    () => (item.id_control && facturasPrecargadas?.[item.id_control]) || [],
  );
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  // Y la sugerencia ya viene elegida: en el caso normal solo hay que confirmar.
  const [elegidas, setElegidas] = useState<string[]>(() => sugeridasIniciales || []);
  // Decidir qué facturas cubre el cobro es la mitad del trabajo de imputar, y es lo que se
  // saltea cuando uno va rápido. Hasta que no haya una decisión —facturas elegidas, o
  // "a cuenta" dicho explícitamente— el botón de confirmar no se habilita.
  const [aCuenta, setACuenta] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function traerFacturas(id: string) {
    setFacturas([]); setElegidas([]); setACuenta(false);
    if (!id) return;
    // Si el cliente ya vino precargado, no hay nada que pedir.
    const ya = facturasPrecargadas?.[id];
    if (ya?.length) { setFacturas(ya); return; }
    setCargandoFacturas(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (r.ok) setFacturas(j.facturas || []);
    } catch { /* si no se pueden traer, se confirma igual sin marcar facturas */ }
    setCargandoFacturas(false);
  }

  async function abrir() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    // Solo se pide si no vino precargado — con las facturas de la página abrir es instantáneo.
    if (nuevo && idControl && !facturas.length) await traerFacturas(idControl);
  }

  // Qué facturas dan ese importe. Es el mismo motor que la carga manual de cobros: acá el
  // importe ya está fijo (lo dice el banco), así que la pregunta es solo qué cancela.
  const sugerencias = useMemo(
    () => (facturas.length ? sugerirCombinaciones(facturas, item.importe) : []),
    [facturas, item.importe],
  );

  async function accion(accion: 'confirmar' | 'descartar') {
    if (accion === 'confirmar') {
      if (!idControl) { setErr('Elegí de qué cliente es.'); return; }
      if (!cuentaId) { setErr('Elegí en qué cuenta entró.'); return; }
      if (cargandoFacturas) { setErr('Esperá a que terminen de cargar las facturas del cliente.'); return; }
      if (!elegidas.length && !aCuenta) {
        setErr('Decidí qué facturas cubre este cobro, o marcá "no asignar" si va a cuenta.');
        return;
      }
      const nombre = clientes.find(c => c.id_control === idControl)?.nombre || '';
      if (!window.confirm(`Se va a registrar en Xubio un cobro de ${fmt$(item.importe)} de ${nombre}, con fecha ${fmtDia(item.fecha)}.\n\nEsto impacta en la contabilidad. ¿Confirmás?`)) return;
    } else {
      if (!window.confirm('Se va a descartar este movimiento: no se registra ningún cobro y no vuelve a aparecer en la bandeja. ¿Confirmás?')) return;
    }
    setTrabajando(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_item: item.id_item, accion,
          id_control: idControl, cuentaId: Number(cuentaId), comprobantes: elegidas,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      onListo(accion === 'confirmar'
        ? `✓ Cobro registrado${j.numeroRecibo ? ` — recibo ${j.numeroRecibo}` : ''}${j.aliasAprendido ? `. Aprendí que "${j.aliasAprendido}" es ese cliente.` : ''}`
        : '✓ Movimiento descartado.');
      router.refresh();
    } catch (e: any) { setErr(e.message); setTrabajando(false); }
  }

  const reconocido = !!item.id_control;
  const ORIGEN: Record<string, { txt: string; bg: string; fg: string }> = {
    banco: { txt: 'banco', bg: '#eef2ff', fg: '#3730a3' },
    mail: { txt: 'mail', bg: '#ecfeff', fg: '#155e75' },
    manual: { txt: 'pegado', bg: '#f5f3ff', fg: '#5b21b6' },
    setup: { txt: 'configuración', bg: '#fffbeb', fg: '#92400e' },
  };
  const org = ORIGEN[item.origen] || ORIGEN.banco;

  // La confirmación de reenvío de Gmail no es un cobro: es el código que hay que copiar
  // para terminar de conectar la casilla. Se muestra entero y sin nada que confirmar.
  if (item.origen === 'setup') {
    return (
      <div style={{ border: '1px solid #fde68a', borderLeft: '4px solid #d97706', background: '#fffbeb', borderRadius: '7px', marginBottom: '7px', padding: '9px 11px' }}>
        <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
          Confirmación de reenvío de Gmail — copiá el código y pegalo en Gmail
        </p>
        <p style={{ margin: '0 0 7px', fontSize: '11.5px', color: '#78350f', lineHeight: 1.5, wordBreak: 'break-word' }}>
          {item.descripcion}
        </p>
        <button onClick={() => accion('descartar')} disabled={trabajando}
          style={{ fontSize: '11px', padding: '4px 10px', background: 'white', color: '#92400e', border: '1px solid #fde68a', borderRadius: '5px', cursor: 'pointer' }}>
          Listo, sacar de la bandeja
        </button>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderLeft: `4px solid ${reconocido ? '#16a34a' : '#d97706'}`, borderRadius: '7px', marginBottom: '7px', background: 'white' }}>
      <div onClick={abrir} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 11px', cursor: 'pointer' }}>
        <span style={{ fontSize: '12px', color: '#6b7280', minWidth: '42px', fontVariantNumeric: 'tabular-nums' }}>{fmtDia(item.fecha)}</span>
        <span style={{ fontSize: '15px', fontWeight: 800, minWidth: '110px' }}>{fmt$(item.importe)}</span>
        <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: org.bg, color: org.fg }}>
          {org.txt}
        </span>
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: reconocido ? '#166534' : '#b45309' }}>
          {reconocido ? item.cliente : 'sin reconocer'}
        </span>
        <span style={{ fontSize: '11px', color: '#9ca3af', flex: 1, minWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.descripcion}
        </span>
        <span style={{ fontSize: '11px', color: '#9ca3af' }}>{abierto ? '▲' : '▼'}</span>
      </div>

      {abierto && (
        <div style={{ padding: '0 11px 11px', borderTop: '1px solid #f3f4f6' }}>
          <p style={{ margin: '8px 0 6px', fontSize: '11px', color: '#6b7280', lineHeight: 1.5 }}>
            <strong>{item.origen === 'banco' ? 'Dice el banco:' : 'Dice el aviso:'}</strong> {item.descripcion}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>¿De qué cliente es?</label>
              <select value={idControl} disabled={trabajando} style={inputStyle}
                onChange={e => { setIdControl(e.target.value); traerFacturas(e.target.value); }}>
                <option value="">— Elegir —</option>
                {clientes.map(c => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>¿Dónde entró?</label>
              <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} disabled={trabajando} style={inputStyle}>
                <option value="">— Elegir cuenta —</option>
                {cuentasOk.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>

          {cargandoFacturas && (
            <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#6b7280', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '6px 9px' }}>
              Buscando las facturas del cliente… el cobro no se puede confirmar hasta que terminen de cargar.
            </p>
          )}

          {sugerencias.length > 0 && (
            <div style={{ background: '#f5f8ff', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '7px 9px', marginBottom: '8px' }}>
              <p style={{ margin: '0 0 5px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>
                Este importe podría estar pagando:
              </p>
              {sugerencias.map((sg, i) => (
                <button key={i} type="button" onClick={() => { setElegidas(sg.numeros); setACuenta(false); }} disabled={trabajando}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%', textAlign: 'left',
                    cursor: 'pointer', fontSize: '11.5px', padding: '4px 7px', marginBottom: '4px',
                    background: 'white', border: '1px solid #dbe4fb', borderRadius: '5px' }}>
                  <span style={{ fontWeight: 700 }}>{sg.numeros.length === 1 ? '1 factura' : `${sg.numeros.length} facturas`}</span>
                  {sg.masViejas && (
                    <span title="Las facturas más viejas sin cobrar, sumadas hasta acercarse al importe"
                      style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#fef3c7', color: '#92400e' }}>
                      las más viejas
                    </span>
                  )}
                  {sg.consecutivas && <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#ede9fe', color: '#5b21b6' }}>seguidas</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: '10.5px', color: '#1d4ed8' }}>{sg.numeros.join(' + ')}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px',
                    background: sg.exacta ? '#dcfce7' : '#fef3c7', color: sg.exacta ? '#166534' : '#92400e' }}>
                    {sg.exacta ? 'exacto' : `${sg.diferencia > 0 ? '+' : '−'}${fmt$(Math.abs(sg.diferencia))}`}
                  </span>
                </button>
              ))}
              <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#6b7280' }}>
                Tolerancia {fmt$(toleranciaDe(item.importe))}, por retenciones o redondeos.
              </p>
            </div>
          )}

          {idControl && !cargandoFacturas && !facturas.length && (
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#b45309' }}>
              Ese cliente no tiene facturas de los últimos 120 días. Se puede registrar igual: entra como cobro a cuenta.
            </p>
          )}

          {elegidas.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>
              Cancela: {elegidas.join(', ')}
            </p>
          )}

          {/* La decisión tiene que ser explícita. Un cobro sin facturas asignadas puede ser
              correcto —un pago a cuenta lo es— pero tiene que decirse, no pasar por omisión. */}
          {!cargandoFacturas && !elegidas.length && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', margin: '0 0 8px', fontSize: '11.5px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '7px 9px', cursor: 'pointer' }}>
              <input type="checkbox" checked={aCuenta} onChange={e => setACuenta(e.target.checked)} disabled={trabajando} style={{ marginTop: '2px' }} />
              <span>
                <strong>No asignar a ninguna factura</strong> — entra como cobro a cuenta del cliente.
                Marcalo solo si de verdad no se sabe qué cancela: después no queda registro de a qué correspondía.
              </span>
            </label>
          )}

          {err && <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#dc2626' }}>{err}</p>}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(() => {
              const listo = !trabajando && !cargandoFacturas && !!idControl && !!cuentaId && (elegidas.length > 0 || aCuenta);
              return (
                <button onClick={() => accion('confirmar')} disabled={!listo}
                  title={listo ? '' : 'Falta elegir cliente, cuenta y qué facturas cubre'}
                  style={{ fontSize: '11.5px', padding: '6px 14px', background: listo ? '#166534' : '#d1d5db', color: 'white', border: 'none', borderRadius: '5px', cursor: listo ? 'pointer' : 'not-allowed', fontWeight: 700 }}>
                  {trabajando ? 'Registrando…' : 'Confirmar y registrar en Xubio'}
                </button>
              );
            })()}
            <button onClick={() => accion('descartar')} disabled={trabajando}
              style={{ fontSize: '11.5px', padding: '6px 12px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
              No es un cobro — descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AliasUI { alias: string; cliente: string; fecha: string }

export default function BandejaCobranzas({
  items, clientes, cuentas, aliases = [], facturasPorCliente = {}, sugeridas = {},
}: {
  items: ItemUI[]; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
  aliases?: AliasUI[];
  facturasPorCliente?: Record<string, FacturaCliente[]>;
  sugeridas?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Lector de avisos de pago: el texto pegado y lo que la app entendió, que se muestra
  // ANTES de crear la fila — si el importe salió mal, corregirlo después es más trabajo.
  const [avisoAbierto, setAvisoAbierto] = useState(false);
  const [textoAviso, setTextoAviso] = useState('');
  const [leido, setLeido] = useState<any>(null);
  const [importeManual, setImporteManual] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [probando, setProbando] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const [verAliases, setVerAliases] = useState(false);
  const [borrandoAlias, setBorrandoAlias] = useState<string | null>(null);

  async function importar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a subir el mismo archivo si hizo falta corregirlo
    if (!file) return;
    setImportando(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const r = await fetch('/api/cobranzas/bandeja', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error al importar');
      const partes = [`${j.nuevos} ${j.nuevos === 1 ? 'movimiento nuevo' : 'movimientos nuevos'}`];
      if (j.reconocidos) partes.push(`${j.reconocidos} con cliente reconocido`);
      if (j.repetidos) partes.push(`${j.repetidos} ya estaban`);
      if (j.salidas) partes.push(`${j.salidas} salidas ignoradas`);
      setMsg(`✓ ${partes.join(' · ')}.`);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setImportando(false); }
  }

  // "No me llega el mail" tiene media docena de causas que se ven igual desde afuera: la
  // clave de envío, el dominio del remitente, la casilla de destino, el spam. Esto las
  // separa en un click, en vez de tener que reenviar un aviso y esperar a ver qué pasa.
  async function probarAcuse() {
    setProbando(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/probar-acuse', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setMsg(`✓ Correo de prueba enviado a ${(j.destinatarios || []).join(', ')}. Si no aparece en unos minutos, revisá el spam — el problema está en la recepción, no en el envío.`);
    } catch (e: any) { setErr(e.message); }
    finally { setProbando(false); }
  }

  // El aviso diario sale a las 10:30. Si algo entra después —una importación del banco al
  // mediodía, un aviso reenviado a la tarde— no hay novedad hasta el día siguiente. Este
  // botón manda el mismo resumen al momento.
  async function avisarAhora() {
    setAvisando(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/cron/bandeja-pendiente');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setMsg(j.enviado
        ? `✓ Resumen enviado: ${j.pendientes} ${j.pendientes === 1 ? 'cobro' : 'cobros'} por imputar.`
        : 'No hay nada para imputar, así que no se mandó ningún correo.');
    } catch (e: any) { setErr(e.message); }
    finally { setAvisando(false); }
  }

  async function leerAviso() {
    setLeyendo(true); setErr(null); setMsg(null); setLeido(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja/aviso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoAviso, soloLeer: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setLeido(j);
      setImporteManual(j.importe ? String(Math.round(j.importe)) : '');
    } catch (e: any) { setErr(e.message); }
    finally { setLeyendo(false); }
  }

  async function agregarAviso() {
    setLeyendo(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja/aviso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoAviso, importe: Number(importeManual) || 0, fecha: leido?.fecha }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setMsg('✓ Aviso agregado a la bandeja, con las facturas que menciona ya propuestas.');
      setAvisoAbierto(false); setTextoAviso(''); setLeido(null);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setLeyendo(false); }
  }

  async function borrarAlias(alias: string) {
    if (!window.confirm(`Se va a borrar el alias "${alias}". Los movimientos que lo contengan van a dejar de reconocerse solos. ¿Confirmás?`)) return;
    setBorrandoAlias(alias); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/alias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setMsg(`✓ Alias "${alias}" borrado.`);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBorrandoAlias(null); }
  }

  const total = items.reduce((a, i) => a + i.importe, 0);
  const sinReconocer = items.filter(i => !i.id_control).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <label style={{ fontSize: '11.5px', padding: '6px 14px', background: '#1e40af', color: 'white', borderRadius: '5px', cursor: importando ? 'default' : 'pointer', fontWeight: 700, opacity: importando ? 0.6 : 1 }}>
          {importando ? 'Leyendo…' : '📄 Subir resumen bancario'}
          <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={importar} disabled={importando} style={{ display: 'none' }} />
        </label>
        <button type="button" onClick={() => { setAvisoAbierto(v => !v); setLeido(null); }}
          style={{ fontSize: '11.5px', padding: '6px 14px', background: 'white', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
          ✉️ Pegar aviso de pago
        </button>
        <button type="button" onClick={probarAcuse} disabled={probando}
          title="Manda un correo de prueba a administración para ver si los acuses llegan"
          style={{ fontSize: '11px', padding: '6px 11px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
          {probando ? 'Enviando…' : '🔔 Probar acuse'}
        </button>
        <button type="button" onClick={avisarAhora} disabled={avisando}
          title="Manda ahora el resumen de cobros por imputar, sin esperar al de la mañana"
          style={{ fontSize: '11px', padding: '6px 11px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
          {avisando ? 'Enviando…' : '📨 Avisarme ahora'}
        </button>
        <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
          El CSV del banco dice cuánto entró; el aviso del cliente dice qué facturas paga.
        </span>
      </div>

      {avisoAbierto && (
        <div style={{ border: '1px solid #bfdbfe', background: '#f5f8ff', borderRadius: '8px', padding: '11px 13px', marginBottom: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#1e3a8a', lineHeight: 1.5 }}>
            Pegá el mail o el mensaje tal cual, con el encabezado y todo. La app saca el importe,
            las facturas que menciona y la fecha.
          </p>
          <textarea value={textoAviso} onChange={e => setTextoAviso(e.target.value)} rows={6}
            placeholder="Pegá acá el aviso de pago…"
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '7px', flexWrap: 'wrap' }}>
            <button onClick={leerAviso} disabled={leyendo || textoAviso.trim().length < 10}
              style={{ fontSize: '11.5px', padding: '5px 13px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
              {leyendo ? 'Leyendo…' : 'Leer'}
            </button>
            <button onClick={() => { setAvisoAbierto(false); setTextoAviso(''); setLeido(null); }} disabled={leyendo}
              style={{ fontSize: '11.5px', padding: '5px 12px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>

          {leido && (
            <div style={{ marginTop: '10px', background: 'white', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '9px 11px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>Esto entendí:</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '8px', marginBottom: '7px' }}>
                <div>
                  <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>Importe</label>
                  <input type="number" value={importeManual} onChange={e => setImporteManual(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>Fecha</label>
                  <input value={leido.fecha || ''} readOnly style={{ ...inputStyle, background: '#fafafa' }} />
                </div>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: '11.5px' }}>
                <strong>Cliente:</strong>{' '}
                {leido.cliente
                  ? <span style={{ color: '#166534' }}>{leido.cliente.cliente}</span>
                  : <span style={{ color: '#b45309' }}>no lo reconocí — lo elegís al confirmar</span>}
              </p>
              <p style={{ margin: '0 0 4px', fontSize: '11.5px' }}>
                <strong>Facturas:</strong>{' '}
                {leido.leido?.comprobantes?.length
                  ? <span style={{ fontFamily: 'monospace', color: '#1d4ed8' }}>{leido.leido.comprobantes.join(' · ')}</span>
                  : <span style={{ color: '#9ca3af' }}>ninguna mencionada</span>}
              </p>
              {leido.leido?.retencion ? (
                <p style={{ margin: '0 0 4px', fontSize: '11.5px', color: '#b45309' }}>
                  <strong>Retención:</strong> {fmt$(leido.leido.retencion)} — el importe de arriba es el neto que entra al banco.
                </p>
              ) : null}
              {leido.leido?.importesEncontrados?.length > 1 && (
                <p style={{ margin: '0 0 6px', fontSize: '10.5px', color: '#6b7280' }}>
                  Otros importes en el aviso: {leido.leido.importesEncontrados.map((n: number) => fmt$(n)).join(' · ')}.
                  Si elegí mal, corregilo arriba.
                </p>
              )}
              <button onClick={agregarAviso} disabled={leyendo || !(Number(importeManual) > 0)}
                style={{ fontSize: '11.5px', padding: '5px 13px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
                {leyendo ? 'Agregando…' : 'Agregar a la bandeja'}
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '7px 10px' }}>{msg}</p>}
      {err && <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '7px 10px' }}>{err}</p>}

      {items.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '13px', padding: '18px', textAlign: 'center' }}>
          No hay movimientos pendientes de imputar. Subí el resumen del banco para empezar.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#374151' }}>
            <strong>{items.length}</strong> {items.length === 1 ? 'movimiento' : 'movimientos'} sin imputar por <strong>{fmt$(total)}</strong>
            {sinReconocer > 0 && <span style={{ color: '#b45309' }}> · {sinReconocer} sin reconocer al cliente</span>}
          </p>
          {items.map(i => (
            <Fila key={i.id_item} item={i} clientes={clientes} cuentas={cuentas}
              facturasPrecargadas={facturasPorCliente} sugeridasIniciales={sugeridas[i.id_item]}
              onListo={(m) => { setMsg(m); setErr(null); }} />
          ))}
        </>
      )}

      {/* Los alias aprendidos, para poder revisarlos y borrar uno que esté mal. Van al
          final y plegados: se miran cuando algo se reconoce raro, no todos los días. */}
      {aliases.length > 0 && (
        <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
          <button type="button" onClick={() => setVerAliases(v => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11.5px', color: '#6b7280', fontWeight: 600 }}>
            {verAliases ? '▾' : '▸'} Alias aprendidos ({aliases.length})
          </button>
          {verAliases && (
            <div style={{ marginTop: '7px' }}>
              <p style={{ margin: '0 0 7px', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
                Cómo aparece cada cliente en el resumen del banco o en los avisos. Si alguno está mal,
                borralo: un alias equivocado no falla de forma visible — hace que los cobros se propongan
                para el cliente equivocado, ya reconocidos en verde.
              </p>
              {aliases.map(a => (
                <div key={a.alias} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11.5px', padding: '4px 7px', borderTop: '1px solid #f9fafb' }}>
                  <span style={{ fontFamily: 'monospace', color: '#374151' }}>{a.alias}</span>
                  <span style={{ color: '#9ca3af' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{a.cliente}</span>
                  <span style={{ color: '#d1d5db', fontSize: '10px' }}>{a.fecha}</span>
                  <button onClick={() => borrarAlias(a.alias)} disabled={borrandoAlias === a.alias}
                    style={{ marginLeft: 'auto', background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '4px', padding: '1px 7px', fontSize: '10.5px', cursor: 'pointer' }}>
                    {borrandoAlias === a.alias ? '…' : '✕ borrar'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
