'use client';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sugerirCombinaciones, toleranciaDe } from '@/lib/conciliacionCobro';
import { cuentasElegibles, cuentaSugerida, cantidadPreferidas, cuentasDeRetencion } from '@/lib/cuentasCobro';
import { retencionDesdeImporte, cuentaParaRetencion } from '@/lib/retenciones';
import CobroEnPartes, { chequearPartes, type ParteUI } from '@/components/CobroEnPartes';
import { parsearImporte } from '@/lib/parseResumen';
import { claveComprobante } from '@/lib/comprobantes';
import AjustarFactura from '@/components/AjustarFactura';

interface ItemUI {
  id_item: string;
  // Desempata filas con el mismo id_item: hubo avisos con varios pagos que generaron dos
  // filas con el mismo id y la segunda no se podía descartar.
  hash?: string;
  fecha: string;
  importe: number;
  descripcion: string;
  id_control: string;
  cliente: string;
  nota: string;
  origen: string;  // banco | mail | manual | setup
  comprobantes?: string; // las facturas que el propio aviso dice pagar (las lee la IA)
  // El aviso como llegó: el cuerpo completo del mail y los nombres de los adjuntos. Sirve
  // para resolver a mano lo que la IA no pudo leer, sin ir a abrir la casilla de correo.
  texto_mail?: string;
  adjuntos?: string;
}
interface ClienteOpt {
  id_control: string;
  nombre: string;
  // % que este cliente retiene al pagar. Se configura en Admin → Clientes de venta.
  retencionPct?: number;
}
interface FacturaCliente { numero: string; fecha: string; importe: number; yaCobrada: boolean; saldadaManual?: boolean; cubierta?: boolean; imputadaManual?: boolean }

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };

// Una fila de la bandeja: un movimiento que entró y todavía no se imputó. Se resuelve
// entera acá adentro —cliente, facturas, cuenta— sin salir a otra pantalla, porque el
// trabajo real es ir una por una y cualquier salto extra se paga por cada movimiento.
function Fila({ item, clientes, cuentas, onListo, facturasPrecargadas, sugeridasIniciales, ultimaCuentaPorCliente }: {
  item: ItemUI; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
  onListo: (msg: string) => void;
  facturasPrecargadas?: Record<string, FacturaCliente[]>;
  sugeridasIniciales?: string[];
  // Dónde entró la plata de este cliente la última vez, por id_control. Un cliente paga
  // casi siempre a la misma cuenta.
  ultimaCuentaPorCliente?: Record<string, string>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [idControl, setIdControl] = useState(item.id_control || '');
  // Las tres cuentas reales, y la que sugiere el propio aviso: si dice "transferencia a
  // Banco Macro", tiene que quedar Macro elegido y no la de siempre.
  const cuentasOk = useMemo(() => cuentasElegibles(cuentas), [cuentas]);
  const cuentaDeCostumbre = (id: string) => {
    const nombre = id ? (ultimaCuentaPorCliente?.[id] || '') : '';
    if (!nombre) return '';
    const c = cuentaSugerida(cuentas, nombre);
    return c ? String(c.id) : '';
  };
  const [cuentaId, setCuentaId] = useState(() => {
    const sug = cuentaSugerida(cuentas, `${item.descripcion} ${item.cliente}`);
    if (sug) return String(sug.id);
    const costumbre = cuentaDeCostumbre(item.id_control || '');
    if (costumbre) return costumbre;
    return cuentas.length ? String(cuentas[0].id) : '';
  });
  // Cuando el aviso no dice dónde entró, elegir el cliente alcanza para saberlo.
  const [cuentaTocada, setCuentaTocada] = useState(false);
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
  // La retención que el cliente le descontó al pago. Viene propuesta de lo que la IA leyó
  // del aviso: sin ella, la factura queda figurando impaga por el monto retenido para
  // siempre, porque a la cuenta entró menos de lo que decía la factura.
  const [retencion, setRetencion] = useState<string>(() => {
    // Primero lo que dijo el aviso: si el comprobante trae el número, ese manda sobre
    // cualquier cuenta — puede haber un mínimo, un tope o un ajuste que el % no sabe.
    const m = String(item.descripcion || '').match(/retenci[oó]n\s+([\d.,]+)/i);
    if (m) {
      const n = parsearImporte(m[1]);
      if (n !== null && n > 0) return String(Math.round(n));
    }
    // Si no, se calcula con el % del cliente sobre lo que ENTRÓ.
    const pct = clientes.find((c) => c.id_control === (item.id_control || ''))?.retencionPct || 0;
    const calc = retencionDesdeImporte(item.importe, pct);
    return calc > 0 ? String(calc) : '';
  });
  const cuentasRet = useMemo(() => cuentasDeRetencion(cuentas), [cuentas]);
  // Siempre ganancias: es la única retención que aplica hoy. El desplegable sigue estando
  // por si algún cliente retiene otra cosa, pero no hay que elegir nada en el caso normal.
  const [cuentaRet, setCuentaRet] = useState(() => String(cuentaParaRetencion(cuentas)?.id || ''));
  // El importe también se edita. Lo lee la IA del mail y a veces lee cualquier cosa: agarra
  // un número suelto del cuerpo —un total parcial, un número de comprobante— en vez del
  // monto transferido. Cuando eso pasa, TODO lo demás de la fila queda al pedo: las
  // sugerencias buscan combinaciones por un número equivocado y no hay ninguna que cierre.
  // Antes la única salida era descartar el movimiento y cargarlo a mano en otra pantalla.
  const [importeEditado, setImporteEditado] = useState(String(Math.round(item.importe)));
  // La fecha del COBRO, que no es la del aviso: avisar un cheque a 30 días es hoy, pero la
  // plata entra el mes que viene. Con la fecha del aviso la cuenta muestra plata que no está.
  const [fechaCobro, setFechaCobro] = useState(String(item.fecha || '').split(/[T ]/)[0]);
  // Y cuando entra en varias veces, una fila por fecha. Vacío = entra todo junto.
  // ── El cuerpo del mail arranca plegado, incluso con adjunto ──────────────────────
  //
  // Antes se abría solo cuando había adjunto, con el argumento de que el comprobante es
  // donde está el dato. Era cierto y no alcanzaba: abierto, el mail reenviado ocupa media
  // pantalla de encabezados de Gmail y empuja hacia abajo lo único que hay que tocar —el
  // cliente, la cuenta y las facturas—. Lo que la fila necesita mostrar de entrada ya está
  // arriba: importe, cliente y las facturas que el aviso nombra.
  //
  // Que haya adjunto se dice en el botón de abrirlo, que es más barato que abrirlo solo.
  const [verMail, setVerMail] = useState(false);
  // Corregir el importe de una factura sin salir de acá. El caso es siempre el mismo: el
  // aviso dice $X, la factura figura por $Y y la diferencia es un error de carga. Había que
  // irse a la pantalla de comprobantes y volver, perdiendo todo lo ya tildado.
  const [editando, setEditando] = useState<string | null>(null);

  // Abrir el editor de una factura. Una sola función porque ahora se entra desde dos
  // lados —el número de la sugerencia y el lápiz de la lista a mano— y dos copias del
  // mismo gesto terminan abriendo el editor con el importe de otra factura.
  function abrirAjuste(numero: string) {
    setEditando(editando === numero ? null : numero);
    setErr(null);
  }
  const [enPartes, setEnPartes] = useState(false);
  const [partes, setPartes] = useState<ParteUI[]>([]);
  const importeNum = Math.round(Number(importeEditado)) || 0;
  const importeCambiado = importeNum !== Math.round(item.importe);
  // La lista completa para tildar de a una. Las sugerencias resuelven el caso normal, pero
  // cuando ninguna cierra —un pago parcial, una factura de hace seis meses, dos cobros que
  // cancelan la misma— la única salida era marcar "a cuenta" y perder el detalle.
  const [verTodas, setVerTodas] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Cuando Xubio rechaza la cuenta de la retención, se ofrece registrar igual dejando la
  // retención anotada solo acá. No se hace solo: cambia lo que va a quedar en la
  // contabilidad, así que lo tiene que decidir una persona.
  const [verTodasCuentasRet, setVerTodasCuentasRet] = useState(false);

  function alternarFactura(numero: string) {
    setACuenta(false);
    setElegidas((prev) => prev.includes(numero) ? prev.filter((n) => n !== numero) : [...prev, numero]);
  }

  // Al cambiar de cliente se recalcula la retención: cada uno retiene un porcentaje distinto
  // (o ninguno), y dejar el número del cliente anterior es peor que dejarlo vacío.
  function recalcularRetencion(id: string) {
    const yaLaDijoElAviso = /retenci[oó]n\s+[\d.,]+/i.test(String(item.descripcion || ''));
    if (yaLaDijoElAviso) return;
    const pct = clientes.find((c) => c.id_control === id)?.retencionPct || 0;
    const calc = retencionDesdeImporte(item.importe, pct);
    setRetencion(calc > 0 ? String(calc) : '');
  }

  async function traerFacturas(id: string) {
    setFacturas([]); setElegidas([]); setACuenta(false);
    recalcularRetencion(id);
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
  // El objetivo NO es lo que entró al banco: es lo que entró MÁS lo retenido. El cliente
  // canceló facturas por la suma de las dos cosas, y buscar combinaciones por el neto hace
  // que la combinación correcta quede fuera de tolerancia justo cuando hay retención.
  const objetivo = importeNum + (Math.round(Number(retencion)) || 0);

  const sugerencias = useMemo(() => {
    if (!facturas.length) return [];
    const base = sugerirCombinaciones(facturas, objetivo);

    // Lo que dice el aviso va primero y va siempre. Antes solo se mostraba como texto
    // ("El aviso dice que paga: …") y para aplicarlo había que tildar las facturas a mano,
    // aunque es el dato más confiable que hay: no lo adivinó nadie, lo dice el cliente.
    const declaradas = String(item.comprobantes || '')
      .split(/[,;]+/).map((x) => claveComprobante(x)).filter(Boolean);
    if (!declaradas.length) return base;
    const numeros = facturas
      .filter((f) => declaradas.includes(claveComprobante(f.numero)))
      .map((f) => f.numero);
    if (!numeros.length) return base;

    const clave = [...numeros].sort().join('|');
    const yaEstaba = base.find((c) => [...c.numeros].sort().join('|') === clave);
    if (yaEstaba) {
      yaEstaba.delAviso = true;
      const i = base.indexOf(yaEstaba);
      if (i > 0) { base.splice(i, 1); base.unshift(yaEstaba); }
      return base;
    }
    const total = facturas.filter((f) => numeros.includes(f.numero)).reduce((a, f) => a + f.importe, 0);
    base.unshift({
      numeros, total, diferencia: Math.round(total) - objetivo,
      exacta: Math.round(total) === objetivo, consecutivas: false, delAviso: true,
    });
    return base;
  }, [facturas, objetivo, item.comprobantes]);

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
      if (!(importeNum > 0)) { setErr('El importe del cobro tiene que ser mayor a 0.'); return; }
      const avisoImporte = importeCambiado
        ? `\n\nOJO: el importe se corrigió a mano. El mail decía ${fmt$(item.importe)}.`
        : '';
      const retNum = Number(retencion) || 0;
      // Lo que se va a registrar, dicho antes de hacerlo: en Xubio la factura se cancela por
      // el total y acá la retención se carga como gasto de esa misma cuenta. Es un solo
      // camino, así que el aviso también es uno solo.
      const avisoRet = retNum > 0
        ? `\n\nEn Xubio se cancela por ${fmt$(importeNum + retNum)} (el total de la factura) y acá se carga un gasto de ${fmt$(retNum)} por la retención, así la cuenta queda con los ${fmt$(importeNum)} que entraron de verdad.`
        : '';
      const chk = enPartes ? chequearPartes(importeNum, partes) : null;
      if (chk?.error) { setErr(chk.error); return; }
      const detalleFechas = chk
        ? `\n\nEntra en ${chk.lista.length} veces: ${chk.lista.map((x) => `${fmtDia(x.fecha)} ${fmt$(x.importe)}`).join(' · ')}.`
        : `\n\nCon fecha ${fmtDia(fechaCobro)}.`;
      if (!window.confirm(`Se va a registrar en Xubio un cobro de ${fmt$(importeNum)} de ${nombre}.${detalleFechas}${avisoImporte}${avisoRet}\n\nEsto impacta en la contabilidad. ¿Confirmás?`)) return;
    } else {
      if (!window.confirm('Se va a descartar este movimiento: no se registra ningún cobro y no vuelve a aparecer en la bandeja. ¿Confirmás?')) return;
    }
    setTrabajando(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_item: item.id_item, hash: item.hash || '', accion,
          id_control: idControl, cuentaId: Number(cuentaId), comprobantes: elegidas,
          importe: importeNum,
          fecha: fechaCobro,
          ...(enPartes ? { partes: chequearPartes(importeNum, partes).lista } : {}),
          retencion: Number(retencion) || 0,
        }),
      });
      const j = await r.json();
      // Ya lo había tomado otro (la pantalla estaba abierta desde antes, o lo registró el
      // automático). No es un error que haya que resolver: simplemente ya no está.
      if (r.status === 409 && j?.yaResuelto) {
        onListo(`Ese movimiento ya estaba ${j.estado}. Lo saco de la bandeja.`);
        router.refresh();
        return;
      }
      if (!r.ok) throw new Error(j.error || 'Error');
      onListo(accion === 'confirmar'
        ? `✓ Cobro registrado${j.numeroRecibo ? ` — recibo ${j.numeroRecibo}` : ''}${j.aliasAprendido ? `. Aprendí que "${j.aliasAprendido}" es ese cliente.` : ''}`
        : '✓ Movimiento descartado.');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
      setTrabajando(false);
    }
  }

  // Descarte rápido desde el encabezado. Pregunta una sola vez y con los datos a la vista:
  // es reversible solo volviendo a cargar el aviso a mano, así que vale el confirm, pero no
  // vale obligar a abrir la fila entera.
  async function descartarRapido() {
    if (!window.confirm(`Descartar ${fmt$(item.importe)} del ${fmtDia(item.fecha)}${item.cliente ? ` — ${item.cliente}` : ''}.\n\nNo se registra ningún cobro y no vuelve a aparecer en la bandeja.\n\n¿Confirmás?`)) return;
    setTrabajando(true); setErr(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_item: item.id_item, hash: item.hash || '', accion: 'descartar' }),
      });
      const j = await r.json();
      if (r.status === 409 && j?.yaResuelto) {
        onListo(`Ese movimiento ya estaba ${j.estado}. Lo saco de la bandeja.`);
        router.refresh();
        return;
      }
      if (!r.ok) throw new Error(j.error || 'Error');
      onListo('✓ Movimiento descartado.');
      router.refresh();
    } catch (e: any) {
      setErr(e.message); setTrabajando(false);
    }
  }

  // Guarda el ajuste y refresca las facturas, para que la suma de abajo y las sugerencias
  // se recalculen con el valor nuevo: ajustar y seguir viendo el número viejo sería peor
  // que no poder ajustar.

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
        {/* Descartar sin abrir la fila. La mayoría de lo que entra de más —un resumen de
            banco que no es un cobro, un aviso repetido— se reconoce de un vistazo, y para
            sacarlo había que abrir la fila, bajar hasta el final y leer un confirm. */}
        {/* Con la palabra, no solo la cruz. Una × gris clarita al final de una fila larga
            no se lee como "descartar": se lee como decoración, y la función existía desde
            hace rato sin que nadie la usara. */}
        <button
          onClick={(e) => { e.stopPropagation(); descartarRapido(); }}
          disabled={trabajando}
          title="No es un cobro — descartar sin abrir"
          style={{
            background: 'white', border: '1px solid #fecaca', borderRadius: '5px',
            cursor: trabajando ? 'default' : 'pointer', color: '#b91c1c',
            fontSize: '11px', fontWeight: 700, lineHeight: 1, padding: '4px 9px', whiteSpace: 'nowrap',
          }}
        >× Descartar</button>
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
                onChange={e => {
                  const id = e.target.value;
                  setIdControl(id); traerFacturas(id);
                  if (!cuentaTocada) {
                    const costumbre = cuentaDeCostumbre(id);
                    if (costumbre) setCuentaId(costumbre);
                  }
                }}>
                <option value="">— Elegir —</option>
                {clientes.map(c => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>¿Dónde entró?</label>
              <select value={cuentaId} onChange={e => { setCuentaId(e.target.value); setCuentaTocada(true); }} disabled={trabajando} style={inputStyle}>
                <option value="">— Elegir cuenta —</option>
                {(() => {
                  // Las de cobro arriba, el resto detrás de un separador: el plan de cuentas
                  // de Xubio trae 78 cuentas y casi todas son de gastos.
                  const nPref = cantidadPreferidas(cuentasOk);
                  return cuentasOk.map((c, i) => (
                    <Fragment key={c.id}>
                      {i === nPref && nPref > 0 && <option disabled>──────────</option>}
                      <option value={c.id}>{c.nombre}</option>
                    </Fragment>
                  ));
                })()}
              </select>
            </div>
          </div>

          {cargandoFacturas && (
            <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: '#6b7280', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '6px 9px' }}>
              Buscando las facturas del cliente… el cobro no se puede confirmar hasta que terminen de cargar.
            </p>
          )}

          {/* Retención: lo que el cliente descontó del pago. La factura se cancela por la
              suma de lo que entró más lo retenido, así que sin esto queda impaga la
              diferencia. */}
          {cuentasRet.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>IMPORTE DEL COBRO</label>
                <input type="number" min={0} value={importeEditado} onChange={(e) => setImporteEditado(e.target.value)} disabled={trabajando}
                  style={{ ...inputStyle, width: '130px', ...(importeCambiado ? { borderColor: '#b45309', fontWeight: 700 } : {}) }} />
                {importeCambiado && (
                  <span style={{ display: 'block', fontSize: '9.5px', color: '#b45309', fontWeight: 700 }}>
                    el mail decía {fmt$(item.importe)}
                  </span>
                )}
              </div>
              {/* Cuándo entra la plata. Por defecto la del aviso, porque es lo normal, pero
                  editable: un cheque o un pago diferido se avisan hoy y entran después. */}
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>FECHA DEL COBRO</label>
                <input type="date" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} disabled={trabajando || enPartes}
                  style={{ ...inputStyle, width: '140px', ...(fechaCobro !== String(item.fecha || '').split('T')[0] ? { borderColor: '#b45309', fontWeight: 700 } : {}) }} />
                {fechaCobro !== String(item.fecha || '').split('T')[0] && !enPartes && (
                  <span style={{ display: 'block', fontSize: '9.5px', color: '#b45309', fontWeight: 700 }}>
                    el aviso decía {fmtDia(item.fecha)}
                  </span>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>RETENCIÓN</label>
                <input type="number" min={0} value={retencion} onChange={(e) => setRetencion(e.target.value)} disabled={trabajando}
                  placeholder="0" style={{ ...inputStyle, width: '110px' }} />
              </div>
              {Number(retencion) > 0 && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>
                      ¿DE QUÉ?{' '}
                      <button type="button" onClick={() => setVerTodasCuentasRet((v) => !v)}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '9.5px', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>
                        {verTodasCuentasRet ? '(solo las de retención)' : '(ver todas)'}
                      </button>
                    </label>
                    <select value={cuentaRet} onChange={(e) => setCuentaRet(e.target.value)} disabled={trabajando} style={{ ...inputStyle, width: 'auto' }}>
                      {(verTodasCuentasRet ? cuentas : cuentasRet).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <span style={{ fontSize: '11px', color: '#166534', paddingBottom: '6px' }}>
                    Cancela {fmt$(item.importe + (Number(retencion) || 0))} de factura
                    {(() => {
                      // De dónde salió el número, para poder desconfiar: no es lo mismo que
                      // lo diga el comprobante que que lo haya calculado la app.
                      const pct = clientes.find((c) => c.id_control === idControl)?.retencionPct || 0;
                      const delAviso = /retenci[oó]n\s+[\d.,]+/i.test(String(item.descripcion || ''));
                      if (delAviso) return <span style={{ color: '#9ca3af' }}> · del aviso</span>;
                      if (pct > 0) return <span style={{ color: '#9ca3af' }}> · calculada al {pct}%</span>;
                      return null;
                    })()}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Cobro que entra en varias veces (cheques, pago en dos partes). Va plegado:
              es la excepción, y una fila de fechas abierta siempre haría dudar de si hay
              que completarla en un cobro normal. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 8px', fontSize: '11.5px', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={enPartes} disabled={trabajando}
              onChange={(e) => {
                setEnPartes(e.target.checked);
                // Arranca con la fecha que ya estaba elegida: es la primera parte, y así no
                // hay que volver a escribirla.
                setPartes(e.target.checked ? [{ fecha: fechaCobro, importe: '' }, { fecha: '', importe: '' }] : []);
              }} />
            La plata entra en varias fechas (cheques, pago en partes)
          </label>
          {enPartes && (
            <div style={{ marginBottom: '8px' }}>
              <CobroEnPartes total={importeNum} partes={partes} onChange={setPartes} disabled={trabajando}
                nota={Number(retencion) > 0 ? 'La retención va entera en la primera.' : ''} />
            </div>
          )}

          {/* El aviso crudo. La descripción de arriba son 140 caracteres: alcanzan para
              reconocer el mail, no para entenderlo. Cuando la IA no sacó el importe o las
              facturas, esto es lo que evita tener que ir a abrir la casilla de correo. */}
          {(!!(item as any).texto_mail || !!(item as any).adjuntos) && (
            <div style={{ marginBottom: '8px' }}>
              <button type="button" onClick={() => setVerMail((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11.5px', color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
                {verMail ? '▾ Ocultar el mail' : '▸ Ver el mail como llegó'}
                {!!(item as any).adjuntos && <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {String((item as any).adjuntos).split(',').filter(Boolean).length} adjunto(s)</span>}
              </button>
              {verMail && (
                <div style={{ marginTop: '6px', background: '#fafaf9', border: '1px solid #f1f0eb', borderRadius: '7px', padding: '9px 11px' }}>
                  {!!(item as any).texto_mail && (
                    <pre style={{ margin: 0, maxHeight: '280px', overflow: 'auto', fontSize: '11.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#374151' }}>
                      {String((item as any).texto_mail)}
                    </pre>
                  )}
                  {String((item as any).adjuntos || '').split(',').map((x) => x.trim()).filter(Boolean).map((nombre, i) => (
                    <div key={i} style={{ marginTop: '9px', paddingTop: '9px', borderTop: '1px solid #f1f0eb' }}>
                      <p style={{ margin: '0 0 5px', fontSize: '11px', color: '#6b7280' }}>
                        📎 {nombre}{' '}
                        <a href={`/api/cobranzas/adjunto?item=${encodeURIComponent(item.id_item)}&n=${i}`} target="_blank" rel="noreferrer"
                          style={{ color: '#2563eb' }}>abrir aparte</a>
                      </p>
                      {/* El adjunto se vuelve a pedir al mail en el momento de mirarlo. Si ya
                          no está, se ve el mensaje del alt y no una imagen rota: saber que
                          se perdió es distinto de pensar que no había nada. */}
                      <img src={`/api/cobranzas/adjunto?item=${encodeURIComponent(item.id_item)}&n=${i}`}
                        alt={`No se pudo traer "${nombre}" — puede que el mail ya no lo tenga disponible. Probá "abrir aparte".`}
                        style={{ maxWidth: '100%', maxHeight: '420px', borderRadius: '6px', border: '1px solid #e5e7eb', display: 'block' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!item.comprobantes && (
            <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#155e75', background: '#ecfeff', border: '1px solid #cffafe', borderRadius: '5px', padding: '4px 7px' }}>
              El aviso dice que paga: <strong style={{ fontFamily: 'monospace' }}>{item.comprobantes}</strong>
            </p>
          )}

          {sugerencias.length > 0 && (
            <div style={{ background: '#f5f8ff', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '7px 9px', marginBottom: '8px' }}>
              <p style={{ margin: '0 0 5px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>
                Este importe podría estar pagando:
              </p>
              {sugerencias.map((sg, i) => {
                // Cuál está elegida. Antes las tres se veían iguales aunque una estuviera
                // aplicada, así que no había forma de saber cuál se iba a registrar salvo
                // leer la línea de "Cancela" y compararla a ojo.
                const activa = sg.numeros.length === elegidas.length
                  && sg.numeros.every((n) => elegidas.includes(n));
                return (
                <button key={i} type="button" onClick={() => { setElegidas(sg.numeros); setACuenta(false); }} disabled={trabajando}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%', textAlign: 'left',
                    cursor: 'pointer', fontSize: '11.5px', padding: '4px 7px', marginBottom: '4px',
                    background: activa ? '#eef6ff' : sg.delAviso ? '#f0fdf4' : sg.masViejas ? '#fffbeb' : 'white',
                    border: activa ? '2px solid #2563eb' : sg.delAviso ? '2px solid #86efac' : sg.masViejas ? '2px solid #fcd34d' : '1px solid #dbe4fb', borderRadius: '5px' }}>
                  <span style={{ fontSize: '11px', color: activa ? '#1d4ed8' : '#cbd5e1' }}>{activa ? '\u25c9' : '\u25cb'}</span>
                  <span style={{ fontWeight: 700 }}>{sg.numeros.length === 1 ? '1 factura' : `${sg.numeros.length} facturas`}</span>
                  {sg.delAviso && (
                    <span title="Las facturas que el propio aviso de pago dice estar cancelando. Es el dato más confiable: no lo dedujo la app, lo dice el cliente."
                      style={{ fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '8px', background: '#166534', color: '#fff' }}>
                      ✉️ LO DICE EL AVISO
                    </span>
                  )}
                  {sg.masViejas && (
                    <span title="Las facturas más viejas sin cobrar, sumadas hasta acercarse al importe. Casi siempre es esta: el que paga, paga lo más viejo que debe."
                      style={{ fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '8px', background: '#b45309', color: '#fff' }}>
                      ⏳ LAS MÁS VIEJAS · suele ser esta
                    </span>
                  )}
                  {sg.consecutivas && <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#ede9fe', color: '#5b21b6' }}>seguidas</span>}
                  {/* ── Cada número abre el editor de ESA factura ───────────────────────
                      El caso que trababa todo: el cliente pagó bien y la factura quedó mal
                      cargada, así que ninguna combinación cierra y la sugerencia dice
                      “faltan $12.400” para siempre. Corregir el importe era salir de la
                      bandeja, perder lo tildado y volver.
                      Van como <span> y no como <button> porque esto ya está adentro del
                      botón de la sugerencia, y un botón dentro de otro no es HTML válido. */}
                  <span style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {sg.numeros.map((n) => (
                      <span
                        key={n}
                        role="button"
                        tabIndex={0}
                        title="Corregir el importe de esta factura"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); abrirAjuste(n); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); abrirAjuste(n); } }}
                        style={{
                          fontFamily: 'monospace', fontSize: '10.5px', color: '#1d4ed8', cursor: 'pointer',
                          borderBottom: '1px dashed #93c5fd', padding: '0 1px',
                        }}
                      >
                        {n} ✎
                      </span>
                    ))}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px',
                    background: sg.exacta ? '#dcfce7' : '#fef3c7', color: sg.exacta ? '#166534' : '#92400e' }}>
                    {/* La diferencia es (lo que suman las facturas − lo que entró). En
                        positivo significa que las facturas valen MÁS: están pagando de
                        menos. Un "+$85.637" sin eso se lee como lo contrario. */}
                    {sg.exacta ? 'exacto'
                      : sg.diferencia > 0 ? `faltan ${fmt$(sg.diferencia)}`
                      : `sobran ${fmt$(Math.abs(sg.diferencia))}`}
                  </span>
                </button>
                );
              })}
              <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#6b7280' }}>
                Se buscan facturas por {fmt$(objetivo)}{Number(retencion) > 0 ? ` (${fmt$(item.importe)} que entraron + ${fmt$(Number(retencion))} retenidos)` : ''}, con una tolerancia de {fmt$(toleranciaDe(objetivo))}.
              </p>
            </div>
          )}

          {/* Elegir a mano. Es la salida para todo lo que las sugerencias no pueden
              resolver: pagos parciales, facturas viejas, o cuando el aviso nombra una que
              por importe no cierra. */}
          {!!facturas.length && (
            <div style={{ marginBottom: '8px' }}>
              <button type="button" onClick={() => setVerTodas((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>
                {verTodas ? '▾ Ocultar la lista de facturas' : '▸ Elegir las facturas a mano'}
              </button>
              {verTodas && (
                <div style={{ marginTop: '5px', maxHeight: '190px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 6px' }}>
                  {facturas.map((f) => {
                    const cerrada = f.yaCobrada || f.saldadaManual || f.cubierta || f.imputadaManual;
                    return (
                      <label key={f.numero}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', padding: '2px 0', cursor: 'pointer', opacity: cerrada ? 0.5 : 1 }}>
                        <input type="checkbox" checked={elegidas.includes(f.numero)}
                          onChange={() => alternarFactura(f.numero)} disabled={trabajando} />
                        <span style={{ fontFamily: 'monospace', fontSize: '10.5px' }}>{f.numero}</span>
                        <span style={{ color: '#9ca3af' }}>{fmtDia(f.fecha)}</span>
                        <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt$(f.importe)}</span>
                        {cerrada && <span style={{ fontSize: '9.5px', color: '#166534' }}>ya cobrada</span>}
                        {/* Corregir el importe sin salir de la bandeja. No toca Xubio: es el
                            mismo ajuste de la pantalla de comprobantes. */}
                        <button type="button" title="Corregir el importe de esta factura"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); abrirAjuste(f.numero); }}
                          disabled={trabajando}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '11px', padding: '0 2px' }}>✎</button>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* El editor vive afuera de la lista plegada: ahora se abre también desde los
              números de la sugerencia, y adentro del bloque solo aparecía con la lista
              desplegada —se apretaba el lápiz y no pasaba nada visible. */}
          {editando && (() => {
            const f = facturas.find((x) => x.numero === editando);
            if (!f) return null;
            return (
              <AjustarFactura
                numero={f.numero}
                importeActual={f.importe}
                idControl={idControl}
                cliente={clientes.find((c) => c.id_control === idControl)?.nombre || ''}
                deshabilitado={trabajando}
                onCancelar={() => { setEditando(null); setErr(null); }}
                onListo={async () => {
                  setEditando(null);
                  // Volver a traer las facturas: el importe cambió y de él dependen las
                  // combinaciones que se sugieren. Dejarlas como estaban mostraría
                  // “faltan $12.400” justo después de haber corregido esos $12.400.
                  await traerFacturas(idControl);
                  router.refresh();
                }}
              />
            );
          })()}

          {idControl && !cargandoFacturas && !facturas.length && (
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#b45309' }}>
              Ese cliente no tiene facturas de los últimos 120 días. Se puede registrar igual: entra como cobro a cuenta.
            </p>
          )}

          {elegidas.length > 0 && (() => {
            // Cuánto suma lo elegido contra lo que entró: con selección a mano ya no hay
            // ninguna garantía de que cierre, así que la diferencia se muestra siempre.
            const suma = facturas.filter((f) => elegidas.includes(f.numero)).reduce((a, f) => a + f.importe, 0);
            const dif = Math.round(suma) - objetivo;
            const ok = Math.abs(dif) <= toleranciaDe(objetivo);
            return (
              <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: ok ? '#166534' : '#b45309', fontWeight: 600 }}>
                Cancela: {elegidas.join(', ')}
                {suma > 0 && <span style={{ fontWeight: 400 }}>{' '}— suma {fmt$(suma)}</span>}
                {/* En palabras y no como "+$85.637": el signo solo obliga a reconstruir
                    cada vez de qué lado está la diferencia, y se lee al revés. */}
                {suma > 0 && dif !== 0 && (
                  <span style={{ display: 'block', fontWeight: 700, marginTop: '2px' }}>
                    {dif > 0
                      ? `Te están pagando ${fmt$(dif)} de menos: esa factura queda con saldo.`
                      : `Entraron ${fmt$(Math.abs(dif))} de más de lo que suman esas facturas: falta alguna, o parte va a cuenta.`}
                  </span>
                )}
                {suma > 0 && dif === 0 && <span style={{ fontWeight: 400 }}> (exacto)</span>}
              </p>
            );
          })()}

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
  items, clientes, cuentas, aliases = [], facturasPorCliente = {}, sugeridas = {}, cuentasFaltantes = [],
  ultimaCuentaPorCliente = {},
}: {
  items: ItemUI[]; clientes: ClienteOpt[]; cuentas: { id: number; nombre: string }[];
  aliases?: AliasUI[];
  facturasPorCliente?: Record<string, FacturaCliente[]>;
  sugeridas?: Record<string, string[]>;
  ultimaCuentaPorCliente?: Record<string, string>;
  // Las cuentas esperadas que Xubio no devolvió. Se avisa una vez arriba y no en cada fila:
  // que falte una es un problema de configuración de Xubio, no de este cobro.
  cuentasFaltantes?: string[];
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
  // ── Las imágenes del aviso ──────────────────────────────────────────────────────────
  //
  // Muchos avisos no son texto: son la captura de la transferencia que manda el cliente por
  // WhatsApp, o la foto de la orden de pago. Antes había que mirar la imagen y transcribir
  // el importe a mano, que es justo lo que la app sabe hacer sola — el mismo lector ya lee
  // los adjuntos del correo reenviado desde el principio.
  const [imagenes, setImagenes] = useState<{ nombre: string; tipo: string; base64: string; url: string }[]>([]);
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

  // Un archivo a base64. El `split(',')` saca el prefijo "data:image/png;base64," que el
  // navegador agrega y la API no quiere; la `url` entera sí se usa, para la miniatura.
  function sumarArchivos(files: File[]) {
    const buenos = files.filter(f => f.type.startsWith('image/') || f.type.includes('pdf'));
    if (!buenos.length) return;
    setErr(null);
    for (const f of buenos.slice(0, 5)) {
      const lector = new FileReader();
      lector.onload = () => {
        const url = String(lector.result || '');
        const base64 = url.split(',')[1] || '';
        if (!base64) return;
        setImagenes(prev => prev.length >= 5 ? prev : [...prev, { nombre: f.name || 'captura', tipo: f.type, base64, url }]);
      };
      lector.readAsDataURL(f);
    }
  }

  // Ctrl+V sobre el recuadro. Una captura va al portapapeles como archivo sin nombre, así
  // que este es el camino natural y el que no obliga a guardarla antes en el disco.
  function pegar(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); sumarArchivos(files); }
  }

  async function leerAviso() {
    setLeyendo(true); setErr(null); setMsg(null); setLeido(null);
    try {
      const r = await fetch('/api/cobranzas/bandeja/aviso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoAviso, soloLeer: true, adjuntos: imagenes.map(({ nombre, tipo, base64 }) => ({ nombre, tipo, base64 })) }),
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
        body: JSON.stringify({
          texto: textoAviso, importe: Number(importeManual) || 0, fecha: leido?.fecha,
          adjuntos: imagenes.map(({ nombre, tipo, base64 }) => ({ nombre, tipo, base64 })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setMsg('✓ Aviso agregado a la bandeja, con las facturas que menciona ya propuestas.');
      setAvisoAbierto(false); setTextoAviso(''); setLeido(null); setImagenes([]);
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
        <label style={{ fontSize: '11px', padding: '4px 10px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: importando ? 'default' : 'pointer', fontWeight: 600, opacity: importando ? 0.6 : 1 }}>
          {importando ? 'Leyendo…' : '📄 Subir resumen bancario'}
          <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={importar} disabled={importando} style={{ display: 'none' }} />
        </label>
        <button type="button" onClick={() => { setAvisoAbierto(v => !v); setLeido(null); }}
          style={{ fontSize: '11px', padding: '4px 10px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
          ✉️ Pegar aviso de pago
        </button>
        <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
          Los avisos que llegan a cobros@ entran solos. Esto es para cargar algo a mano.
        </span>
      </div>

      {avisoAbierto && (
        <div onPaste={pegar}
          style={{ border: '1px solid #bfdbfe', background: '#f5f8ff', borderRadius: '8px', padding: '11px 13px', marginBottom: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#1e3a8a', lineHeight: 1.5 }}>
            Pegá el mail o el mensaje tal cual, con el encabezado y todo —o pegá directamente la
            captura del comprobante con Ctrl+V. La app saca el importe, las facturas que menciona
            y la fecha.
          </p>
          <textarea value={textoAviso} onChange={e => setTextoAviso(e.target.value)} rows={6}
            placeholder="Pegá acá el aviso de pago, o la imagen del comprobante…"
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />

          {imagenes.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              {imagenes.map((img, i) => (
                <div key={i} style={{ position: 'relative', border: '1px solid #dbe4fb', borderRadius: '6px', background: 'white', padding: '4px' }}>
                  {img.tipo.startsWith('image/')
                    ? <img src={img.url} alt={img.nombre} style={{ display: 'block', maxWidth: '110px', maxHeight: '90px', borderRadius: '3px' }} />
                    : <div style={{ width: '110px', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '4px' }}>📄 {img.nombre}</div>}
                  <button type="button" title="Sacar esta imagen"
                    onClick={() => setImagenes(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: '-7px', right: '-7px', width: '19px', height: '19px', lineHeight: '17px', borderRadius: '50%', border: '1px solid #e5e7eb', background: 'white', color: '#991b1b', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: 0 }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={leerAviso} disabled={leyendo || (textoAviso.trim().length < 10 && imagenes.length === 0)}
              style={{ fontSize: '11.5px', padding: '5px 13px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
              {leyendo ? 'Leyendo…' : 'Leer'}
            </button>
            {/* El selector de archivo existe para la foto que ya está guardada en el teléfono
                o en el escritorio: ésa no pasa por el portapapeles. */}
            <label style={{ fontSize: '11.5px', padding: '5px 12px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
              📎 Elegir imagen
              <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
                onChange={e => { sumarArchivos(Array.from(e.target.files || [])); e.target.value = ''; }} />
            </label>
            <button onClick={() => { setAvisoAbierto(false); setTextoAviso(''); setLeido(null); setImagenes([]); }} disabled={leyendo}
              style={{ fontSize: '11.5px', padding: '5px 12px', background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>

          {leido && (
            <div style={{ marginTop: '10px', background: 'white', border: '1px solid #dbe4fb', borderRadius: '6px', padding: '9px 11px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a' }}>Esto entendí:</p>
              {/* Una imagen ilegible devuelve todo en cero, que desde afuera es idéntico a un
                  comprobante que no dice nada. Decirlo evita que se confirme una fila vacía. */}
              {leido.leyoImagen && !leido.importe && (
                <p style={{ margin: '0 0 7px', fontSize: '11px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '5px', padding: '6px 8px' }}>
                  No pude sacar el importe de la imagen. Puede estar cortada o muy borrosa —
                  escribilo a mano acá abajo y el resto sigue igual.
                </p>
              )}
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

      {/* Si una cuenta esperada no está en Xubio, se dice acá y no se deja que se viva como
          "la app no me deja elegirla": lo que hay que hacer es crearla allá. */}
      {cuentasFaltantes.length > 0 && (
        <p style={{ margin: '0 0 10px', fontSize: '11.5px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '7px 10px' }}>
          No están en el plan de cuentas de Xubio: <strong>{cuentasFaltantes.join(', ')}</strong>.
          Hasta que se creen allá, no se puede imputar un cobro a esas cuentas.
        </p>
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
              ultimaCuentaPorCliente={ultimaCuentaPorCliente}
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
