'use client';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Remitos from './Remitos';
import Link from 'next/link';
import type { VentaDia } from '@/lib/types';

import { ARTICULOS } from '@/lib/articulos';
interface EntradaExpCliente {
  id_exportacion: string; fecha: string; fecha_exportacion: string; cliente: string; id_control: string;
  sucursales?: string[];
  rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
  // Todo lo que no son las cuatro columnas fijas: albahaca, ensaladas, microgreens y lo que
  // se dé de alta desde la app. Viene como {clave: cantidad} y solo con lo que tiene algo.
  otros?: Record<string, number>;
}
interface EntradaPend {
  fecha: string; filas: number; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
  id_control: string; cliente: string; sucursales?: string[];
  otros?: Record<string, number>;
  // Lo que SÍ se facturó a ese cliente ese mismo día. Casi siempre explica el pendiente:
  // el cliente se facturó en otra tanda y lo que quedó suelto es una fila repetida.
  facturadoMismoDia?: { id_exportacion: string; fecha_exportacion: string }[];
  // Marcada para facturar pero Xubio no la emitió.
  marcada?: boolean;
}
interface ArticuloCol { key: string; label: string }

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtKg = (n: number) => n > 0 ? `${n.toFixed(1)} kg` : '—';

// Acá van TODOS, también los dados de baja: es una pantalla que mira hacia atrás y una
// venta de bandeja de rúcula del año pasado tiene que poder verse y corregirse.
const CAMPOS = [
  ...ARTICULOS.filter((a) => !a.legacy).map((a) => ({ key: a.key, label: a.label })),
] as const;

// Editor inline de una venta puntual ya facturada — corrige el registro interno de Xavia
// (no anula la factura real ya emitida en Xubio) sin salir de esta página.
function EditorFacturadoDetalle({ idExportacion, idControl, fecha, camposExtra = [], onGuardado, onFilaEliminada, onCerrar }: {
  idExportacion: string; idControl: string; fecha: string;
  // Los articulos dados de alta desde la app. Llegan del servidor porque no estan en el
  // codigo del navegador, y tienen que entrar al editor como cualquier otro: ver el
  // comentario de `campos` abajo.
  camposExtra?: { key: string; label: string }[];
  onGuardado: () => void; onFilaEliminada: () => void; onCerrar: () => void;
}) {
  // ── Todos los articulos, no una lista escrita a mano ────────────────────────────
  //
  // Guardar escribia SOLO las claves que este archivo nombraba una por una, y el servidor
  // completa con 0 lo que no viene. Resultado: corregir la rucula de una factura que tambien
  // llevaba ensaladas o microgreens las borraba, sin aviso y sin que apareciera en ningun
  // lado hasta mirar la planilla.
  //
  // Por eso ahora es una sola lista y todo lo que la usa la recorre: el formulario, el
  // guardado y la nota de credito. Agregar un articulo no deberia obligar a acordarse de
  // tres lugares.
  const campos = [...CAMPOS, ...camposExtra.filter((e) => !CAMPOS.some((c) => c.key === e.key))];
  const [loading, setLoading] = useState(true);
  const [filas, setFilas] = useState<VentaDia[]>([]);
  // Ojo: puede haber varias filas con la misma (fecha, cliente, sucursal) — filas
  // repetidas por error de carga — así que el estado se indexa por id_venta (único por
  // fila real), nunca por sucursal, o editar/borrar una repetida movería a todas juntas.
  const [valores, setValores] = useState<Record<string, Record<string, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const [eliminandoFila, setEliminandoFila] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState<{ numero: string; de: number; a: number; manual?: boolean; notaCredito?: string; importeNC?: number; facturaExtra?: string; importeExtra?: number }[]>([]);
  // Las notas de crédito que no se pudieron emitir. La corrección quedó guardada igual,
  // pero la factura no se cerró y quien la hizo tiene que enterarse ahora, no en el mail
  // de mañana.
  const [notasFallidas, setNotasFallidas] = useState<{ numero: string; error: string }[]>([]);
  // Importe a cobrar puesto a mano. Vacío = se calcula de las cantidades, que es lo normal.
  const [importeManual, setImporteManual] = useState('');
  // ── Cómo se corrige esta factura ────────────────────────────────────────────────
  //
  // Las dos formas son EXCLUYENTES y por eso se eligen, no se combinan. Con la nota de
  // crédito la deuda baja en Xubio; con el ajuste baja solo del lado de la app. Hacer las
  // dos sobre la misma factura la bajaría dos veces, y ese error es silencioso.
  // `importe` es el tercer camino, y es otra cosa que los dos anteriores: no se corrige
  // nada, se acredita plata. El caso que lo pidió: un cliente reclama un 20% por acuerdo
  // comercial. Las cantidades están bien —se entregó lo que dice la factura— y aun así hay
  // que cobrarle menos. Con la NC por cantidades habría que inventar que se entregó de
  // menos, y la factura pasaría a decir algo que no pasó.
  const [modo, setModo] = useState<'app' | 'nc' | 'importe'>('app');
  const [impFinal, setImpFinal] = useState('');
  const [impMotivo, setImpMotivo] = useState('');
  const [impBase, setImpBase] = useState<{ importe: number } | null>(null);
  const [impPrevia, setImpPrevia] = useState<{ acreditar: number; porcentaje: number } | null>(null);
  const [impErr, setImpErr] = useState<string | null>(null);

  // Cuánto dice la factura, según los mismos precios con los que se facturó. Se pide al
  // servidor y no se calcula acá: es el mismo número que va a usar el prorrateo al emitir.
  async function cargarBaseImporte(numero: string) {
    setImpErr(null); setImpBase(null); setImpPrevia(null);
    try {
      const r = await fetch(`/api/ventas/nc-importe?numero=${encodeURIComponent(numero)}`);
      const j = await r.json();
      if (!r.ok || !j.ok) { setImpErr(j?.error || 'No se pudo leer la factura.'); return; }
      setImpBase({ importe: j.importeFactura });
      setImpFinal(String(j.importeFactura));
    } catch { setImpErr('No se pudo leer la factura.'); }
  }

  async function previaImporte(numero: string, valor: string) {
    const n = Math.round(Number(valor) || 0);
    if (!impBase || !(n >= 0) || n >= impBase.importe) { setImpPrevia(null); return; }
    try {
      const r = await fetch(`/api/ventas/nc-importe?numero=${encodeURIComponent(numero)}&importe_final=${n}`);
      const j = await r.json();
      if (j?.previa?.ok) { setImpPrevia({ acreditar: j.previa.acreditar, porcentaje: j.previa.porcentaje }); setImpErr(null); }
      else { setImpPrevia(null); if (j?.previa?.error) setImpErr(j.previa.error); }
    } catch { setImpPrevia(null); }
  }

  async function emitirNCImporte(numero: string) {
    if (!impBase) return;
    const n = Math.round(Number(impFinal) || 0);
    if (!(n >= 0) || n >= impBase.importe) { setImpErr('El importe nuevo tiene que ser menor que el de la factura.'); return; }
    if (!impMotivo.trim()) { setImpErr('Escribí por qué se acredita.'); return; }
    const fmt = (x: number) => '$' + Math.round(x).toLocaleString('es-AR');
    if (!window.confirm(
      `Se va a emitir una NOTA DE CRÉDITO en Xubio sobre ${numero}.\n\n`
      + `${fmt(impBase.importe)} → ${fmt(n)}\n`
      + `Se acreditan ${fmt(impBase.importe - n)}${impPrevia ? ` (${impPrevia.porcentaje}%)` : ''}.\n\n`
      + 'Se emite en AFIP y no se deshace. ¿Confirmás?')) return;
    setEmitiendo(true); setImpErr(null);
    try {
      const r = await fetch('/api/ventas/nc-importe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, importe_final: n, motivo: impMotivo.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo emitir');
      setResultadoNC({ numeroNC: j.numeroNC, cae: j.cae, importe: j.importe, sinAsociar: j.sinAsociar });
      setImpPrevia(null);
    } catch (e: any) { setImpErr(e?.message || 'No se pudo emitir'); }
    setEmitiendo(false);
  }
  // ── Qué va a pasar en Xubio si guardo esto ──────────────────────────────────────
  //
  // Corregir cantidades de una factura emitida dispara un comprobante — nota de crédito
  // si baja, factura nueva si sube — y eso se emite en AFIP y no se deshace. No puede ser
  // una sorpresa al apretar Guardar: se calcula mientras se tipea y se muestra antes.
  const [previa, setPrevia] = useState<any[] | null>(null);
  const [calculando, setCalculando] = useState(false);
  // La excepción: corregir solo lo que la app reclama y no tocar Xubio.
  const [sinXubio, setSinXubio] = useState(false);
  // Cuánto acreditar de cada (fila, artículo).
  const [aAcreditar, setAAcreditar] = useState<Record<string, string>>({});
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultadoNC, setResultadoNC] = useState<{ numeroNC?: string; cae?: string; importe?: number; sinAsociar?: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/ventas/fecha?id_exportacion=${idExportacion}`).then(r => r.json()).then((data: VentaDia[]) => {
      const propias = data.filter(v => String(v.id_control) === String(idControl));
      setFilas(propias);
      const v0: Record<string, Record<string, string>> = {};
      for (const f of propias) {
        v0[f.id_venta] = {};
        for (const c of campos) v0[f.id_venta][c.key] = String(Number((f as any)[c.key]) || '');
      }
      setValores(v0);
    }).catch(() => setError('No se pudo cargar el detalle.')).finally(() => setLoading(false));
  }, [idExportacion, idControl]);

  function setVal(id_venta: string, key: string, val: string) {
    setValores(prev => ({ ...prev, [id_venta]: { ...prev[id_venta], [key]: val } }));
  }

  // Las líneas tal como quedarían, que es lo que se manda tanto a la previa como al
  // guardado. Una sola definición: si la previa armara su propia lista, podría mostrar
  // una cosa y guardarse otra.
  function armarLineas() {
    return filas.map(f => {
      const v = valores[f.id_venta] || {};
      const g = (k: string) => Number(v[k]) || 0;
      return {
        id_venta: f.id_venta, id_control: idControl, nombre_cliente: f.nombre_cliente, sucursal: f.sucursal,
        ...Object.fromEntries(campos.map((c) => [c.key, g(c.key)])),
      };
    });
  }

  // Se recalcula sola, con una espera corta para no pedirla en cada tecla.
  useEffect(() => {
    if (modo !== 'app') { setPrevia(null); return; }
    const t = setTimeout(async () => {
      setCalculando(true);
      try {
        const r = await fetch('/api/ventas/correccion-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineas: armarLineas(), importeManual: Number(importeManual) || 0 }),
        });
        const j = await r.json().catch(() => ({}));
        setPrevia(r.ok && Array.isArray(j.facturas) ? j.facturas.filter((x: any) => x.bajas.length || x.altas.length) : null);
      } catch { setPrevia(null); }
      setCalculando(false);
    }, 600);
    return () => clearTimeout(t);
  }, [valores, importeManual, modo]);

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      const lineas = filas.map(f => {
        const v = valores[f.id_venta] || {};
        const g = (k: string) => Number(v[k]) || 0;
        return {
          id_venta: f.id_venta, id_control: idControl, nombre_cliente: f.nombre_cliente, sucursal: f.sucursal,
          // Por clave y no una por una: lo que falte en este objeto el servidor lo guarda
          // como 0, asi que una clave olvidada aca borra esa venta en silencio.
          ...Object.fromEntries(campos.map((c) => [c.key, g(c.key)])),
        };
      });
      const r = await fetch('/api/ventas/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, id_exportacion: idExportacion, lineas, importeManual: Number(importeManual) || 0, sinXubio }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error');
      // Lo que cambió el monto a cobrar. Se dice acá y no se deja para que alguien lo
      // descubra en Cobranzas: corregir una venta ya facturada mueve la deuda del cliente, y
      // eso tiene que verse en el momento en que se decide, no tres pantallas después.
      setAjustes(Array.isArray(j.ajustes) ? j.ajustes : []);
      setNotasFallidas(Array.isArray(j.notasFallidas) ? j.notasFallidas : []);
      onGuardado();
    } catch (e: any) { setError(e.message); }
    setGuardando(false);
  }

  async function eliminarFila(id_venta: string) {
    if (!confirm('¿Eliminar esta fila? Esto no se puede deshacer.')) return;
    setEliminandoFila(id_venta); setError(null);
    try {
      const r = await fetch('/api/ventas/limpiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_venta }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setFilas(prev => prev.filter(f => f.id_venta !== id_venta));
      onFilaEliminada();
    } catch (e: any) { setError(e.message); }
    setEliminandoFila(null);
  }

  // El número de la factura que cubre estas filas. Si hay más de uno, no se puede emitir una
  // NC desde acá: habría que elegir cuál se corrige, y adivinar sería emitir contra la
  // equivocada.
  const numerosFactura = Array.from(new Set(
    filas.map((f) => String((f as any).exportado || '').trim()).filter((x) => x && x !== 'PENDIENTE'),
  ));
  const numeroFactura = numerosFactura.length === 1 ? numerosFactura[0] : '';

  async function emitirNC() {
    const lineas = filas.flatMap((f) => campos
      .map((c) => ({ id_venta: f.id_venta, key: c.key, cantidad: Number(aAcreditar[`${f.id_venta}__${c.key}`]) || 0 }))
      .filter((l) => l.cantidad > 0));
    if (!lineas.length) { setError('Poné qué cantidad acreditar en al menos un producto.'); return; }
    const total = lineas.reduce((a, l) => a + l.cantidad, 0);
    if (!confirm(`Se va a emitir una NOTA DE CRÉDITO en Xubio sobre la factura ${numeroFactura}, por ${total} unidad(es) en total.\n\n`
      + 'Es un comprobante fiscal: una vez emitido no se deshace desde la app.\n\n¿Confirmás?')) return;
    setEmitiendo(true); setError(null); setResultadoNC(null);
    try {
      const r = await fetch('/api/ventas/nota-credito', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroFactura, lineas }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo emitir');
      setResultadoNC({ numeroNC: j.numeroNC, cae: j.cae, importe: j.importe, sinAsociar: j.sinAsociar });
      setAAcreditar({});
      onGuardado();
    } catch (e: any) { setError(e.message); }
    setEmitiendo(false);
  }

  if (loading) return <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0' }}>Cargando detalle…</p>;
  if (filas.length === 0) return <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0' }}>No se encontraron filas para editar.</p>;

  return (
    <div style={{ padding: '10px 12px', background: 'white', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
      {error && <p style={{ color: '#dc2626', fontSize: '12px', margin: '0 0 8px' }}>{error}</p>}

      {/* ── Cómo se corrige esta factura ──────────────────────────────────────────────
          Se elige, no se combina. Con la nota de crédito la deuda baja en Xubio; con la
          corrección interna baja solo del lado de la app. Hacer las dos sobre la misma
          factura la bajaría DOS VECES, y ese error no se ve: aparece como un cliente que
          debe de menos, meses después. */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '9px', flexWrap: 'wrap' }}>
        {([
          { k: 'app' as const, t: 'Corregir sin Xubio', d: 'Cambia lo que la app reclama. La factura sigue diciendo lo que dice.' },
          { k: 'nc' as const, t: 'NC por cantidades', d: 'Se entregó de menos: se acredita producto por producto y las cantidades de la venta bajan solas.' },
          { k: 'importe' as const, t: 'NC por importe', d: 'Un acuerdo comercial o un descuento: las cantidades están bien y hay que cobrar menos.' },
        ]).map((o) => (
          <button key={o.k} type="button" onClick={() => { setModo(o.k); setError(null); if (o.k === 'importe' && numeroFactura) cargarBaseImporte(numeroFactura); }} title={o.d}
            style={{
              fontSize: '12px', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700,
              border: `1px solid ${modo === o.k ? '#2563eb' : '#e5e7eb'}`,
              background: modo === o.k ? '#eff6ff' : 'white',
              color: modo === o.k ? '#1d4ed8' : '#6b7280',
            }}>
            {o.t}
          </button>
        ))}
        <span style={{ fontSize: '11px', color: '#9ca3af', alignSelf: 'center', flex: 1, minWidth: '220px' }}>
          {modo === 'nc'
            ? 'Poné cuánto acreditar de cada producto. Las cantidades de la venta bajan solas al emitir.'
            : modo === 'importe'
              ? 'Poné el importe final que tiene que quedar. Las cantidades no se tocan: se entregó lo que dice la factura.'
              : 'Corregí las cantidades, o escribí abajo el importe a cobrar.'}
        </span>
      </div>

      {resultadoNC && (
        <div style={{ margin: '0 0 9px', padding: '9px 11px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '12.5px', color: '#166534' }}>
          <strong>Nota de crédito emitida: {resultadoNC.numeroNC}</strong>
          {resultadoNC.importe ? ` · $${Math.round(resultadoNC.importe).toLocaleString('es-AR')}` : ''}
          {resultadoNC.cae ? ` · CAE ${resultadoNC.cae}` : ''}
          <span style={{ display: 'block', fontSize: '11.5px', color: '#15803d', marginTop: '3px' }}>
            Las cantidades de la venta ya quedaron corregidas y, si había una corrección interna sobre esta factura, se anuló
            para no descontar dos veces.
          </span>
          {/* Lo único de este cuadro que pide una acción: sin el comprobante asociado, ARCA
              no deja presentar la nota. La NC existe y la deuda ya bajó — falta vincularla. */}
          {resultadoNC.sinAsociar && (
            <span style={{ display: 'block', marginTop: '7px', padding: '7px 9px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '5px', color: '#92400e', fontSize: '11.5px' }}>
              <strong>Falta vincularla a la factura en Xubio.</strong> No se encontró la factura original entre
              las que Xubio ofrece para asociar, así que la nota salió sin el comprobante asociado y ARCA no la
              va a dejar presentar. Entrá a la nota en Xubio y elegí la factura.
            </span>
          )}
        </div>
      )}

      {ajustes.length > 0 && (
        <div style={{ margin: '0 0 8px', padding: '8px 10px', background: ajustes.every((a) => a.notaCredito || a.facturaExtra) ? '#f0fdf4' : '#fffbeb', border: `1px solid ${ajustes.every((a) => a.notaCredito || a.facturaExtra) ? '#bbf7d0' : '#fde68a'}`, borderRadius: '6px', fontSize: '12px', color: ajustes.every((a) => a.notaCredito || a.facturaExtra) ? '#166534' : '#92400e' }}>
          <strong>Cambió lo que hay que cobrar.</strong>{' '}
          {/* Con la NC emitida la factura quedó corregida en Xubio también. Sin ella, solo
              cambia lo que la app reclama y el comprobante sigue diciendo lo de antes: son
              dos situaciones distintas y el cartel tiene que decir cuál es. */}
          {ajustes.every((a) => a.notaCredito || a.facturaExtra)
            ? 'Xubio quedó corregido: lo que bajó salió por nota de crédito y lo que subió por una factura nueva.'
            : 'Donde no salió el comprobante, la factura en Xubio sigue diciendo el importe original y la app reclama el corregido.'}
          <ul style={{ margin: '5px 0 0', paddingLeft: '18px' }}>
            {ajustes.map((a) => (
              <li key={a.numero}>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.numero}</span>: ${Math.round(a.de).toLocaleString('es-AR')} → <strong>${Math.round(a.a).toLocaleString('es-AR')}</strong>
                {a.manual && <span style={{ color: '#92400e' }}> (importe puesto a mano)</span>}
                {a.notaCredito && (
                  <span style={{ color: '#166534' }}>
                    {' '}— NC <span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.notaCredito}</span>
                    {a.importeNC ? ` por $${Math.round(a.importeNC).toLocaleString('es-AR')}` : ''}
                  </span>
                )}
                {/* La corrección sumó: la diferencia salió en una factura nueva, no en una
                    nota de débito. Se nombra el comprobante para poder ubicarlo en Xubio. */}
                {a.facturaExtra && (
                  <span style={{ color: '#1e40af' }}>
                    {' '}— se facturó la diferencia aparte en <span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.facturaExtra}</span>
                    {a.importeExtra ? ` por $${Math.round(a.importeExtra).toLocaleString('es-AR')}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notasFallidas.length > 0 && (
        <div style={{ margin: '0 0 8px', padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', color: '#7f1d1d' }}>
          <strong>La corrección se guardó, pero la nota de crédito no se pudo emitir.</strong> La factura en Xubio sigue
          diciendo el importe original. Se puede emitir a mano desde acá mismo, o va a salir en el aviso diario de facturas
          corregidas hasta que se cierre.
          <ul style={{ margin: '5px 0 0', paddingLeft: '18px' }}>
            {notasFallidas.map((n) => (
              <li key={n.numero}>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n.numero}</span>: {n.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '12px', width: '100%' }}>
          <thead><tr>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Sucursal</th>
            {campos.map(c => <th key={c.key} style={{ textAlign: 'center', padding: '4px 6px' }}>{c.label}</th>)}
            <th style={{ padding: '4px 6px' }}></th>
          </tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id_venta}>
                <td style={{ padding: '4px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>{f.sucursal}</td>
                {campos.map(c => {
                  const facturado = Number(valores[f.id_venta]?.[c.key]) || 0;
                  if (modo !== 'nc') return (
                    <td key={c.key} style={{ padding: '3px 4px' }}>
                      <input type="number" min={0} step="any" value={valores[f.id_venta]?.[c.key] ?? ''}
                        onChange={ev => setVal(f.id_venta, c.key, ev.target.value)}
                        style={{ width: '72px', textAlign: 'center', fontSize: '12px', padding: '4px' }} />
                    </td>
                  );
                  // En modo NC lo facturado NO se edita: se muestra, y abajo se pone cuánto
                  // acreditar. Editar las dos cosas a la vez permitiría emitir una NC por más
                  // de lo que dice la factura.
                  const k = `${f.id_venta}__${c.key}`;
                  const cred = Number(aAcreditar[k]) || 0;
                  return (
                    <td key={c.key} style={{ padding: '3px 4px', textAlign: 'center' }}>
                      <span style={{ display: 'block', fontSize: '11px', color: facturado > 0 ? '#374151' : '#d1d5db' }}>
                        {facturado > 0 ? facturado : '—'}
                      </span>
                      {facturado > 0 && (
                        <input type="number" min={0} max={facturado} step="any" value={aAcreditar[k] ?? ''} placeholder="0"
                          onChange={ev => setAAcreditar(p => ({ ...p, [k]: ev.target.value }))}
                          title={`Cuánto acreditar de ${c.label}. Máximo ${facturado}.`}
                          style={{
                            width: '72px', textAlign: 'center', fontSize: '12px', padding: '4px', marginTop: '2px',
                            border: `1px solid ${cred > facturado ? '#dc2626' : cred > 0 ? '#fbbf24' : '#e5e7eb'}`,
                            borderRadius: '4px',
                            background: cred > 0 ? '#fffbeb' : 'white',
                          }} />
                      )}
                    </td>
                  );
                })}
                <td style={{ padding: '3px 4px' }}>
                  <button onClick={() => eliminarFila(f.id_venta)} disabled={eliminandoFila === f.id_venta}
                    title="Eliminar esta fila (ej. venta duplicada)"
                    style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: '#dc2626', whiteSpace: 'nowrap' }}>
                    {eliminandoFila === f.id_venta ? '…' : '🗑'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modo === 'importe' ? (
        <div style={{ marginTop: '10px' }}>
          {!numeroFactura ? (
            <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>
              {numerosFactura.length > 1
                ? `Estas filas están en más de una factura (${numerosFactura.join(', ')}). Una nota de crédito va sobre una sola.`
                : 'Estas ventas todavía no tienen factura emitida, así que no hay nada que acreditar.'}
            </p>
          ) : !impBase ? (
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{impErr || 'Leyendo la factura…'}</p>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
                La factura <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#111827' }}>{numeroFactura}</strong> vale{' '}
                <strong style={{ color: '#111827' }}>${impBase.importe.toLocaleString('es-AR')}</strong>.
              </p>
              {/* Un acuerdo comercial se pide en porcentaje. Hacer la cuenta a mano es donde
                  se cuela el error, y acá el error se emite en AFIP. */}
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11.5px', color: '#6b7280' }}>Descuento:</span>
                {[5, 10, 15, 20, 25].map((pct) => (
                  <button key={pct} type="button" disabled={emitiendo}
                    onClick={() => { const v = String(Math.round(impBase.importe * (1 - pct / 100))); setImpFinal(v); previaImporte(numeroFactura, v); }}
                    style={{ fontSize: '11.5px', fontWeight: 700, padding: '4px 11px', borderRadius: '999px', border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer' }}>
                    {pct}%
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ fontSize: '11.5px', color: '#374151' }}>
                  Importe final
                  <input type="number" value={impFinal} disabled={emitiendo}
                    onChange={(e) => { setImpFinal(e.target.value); previaImporte(numeroFactura, e.target.value); }}
                    style={{ marginLeft: '6px', fontSize: '13px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', width: '130px' }} />
                </label>
                <input type="text" value={impMotivo} disabled={emitiendo}
                  onChange={(e) => setImpMotivo(e.target.value)}
                  placeholder="¿Por qué? (ej: 20% acuerdo comercial)"
                  style={{ flex: '1 1 240px', minWidth: '200px', fontSize: '13px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px' }} />
              </div>
              {impPrevia && (
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.5 }}>
                  Se acreditan <strong>${impPrevia.acreditar.toLocaleString('es-AR')}</strong> — el <strong>{impPrevia.porcentaje}%</strong> de la factura.
                  La NC lleva los mismos artículos de {numeroFactura}, con las mismas cantidades, al precio proporcional:
                  no se inventa que se entregó de menos, y las cantidades de la venta no se tocan.
                </p>
              )}
              {impErr && <p style={{ margin: '7px 0 0', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>⚠ {impErr}</p>}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '9px' }}>
                <button onClick={() => emitirNCImporte(numeroFactura)} disabled={emitiendo || !impPrevia} className="btn"
                  style={{ fontSize: '12px', padding: '6px 14px', background: impPrevia ? '#b91c1c' : '#e5e7eb', color: impPrevia ? 'white' : '#9ca3af' }}>
                  {emitiendo ? 'Emitiendo…' : 'Emitir nota de crédito'}
                </button>
                <button onClick={onCerrar} className="btn secondary" style={{ fontSize: '12px', padding: '6px 14px' }} disabled={emitiendo}>Cerrar</button>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  Es un comprobante fiscal: una vez emitido no se deshace desde la app.
                </span>
              </div>
            </>
          )}
        </div>
      ) : modo === 'nc' ? (
        <div style={{ marginTop: '10px' }}>
          {!numeroFactura ? (
            <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>
              {numerosFactura.length > 1
                ? `Estas filas están en más de una factura (${numerosFactura.join(', ')}). Para emitir una NC hay que hacerlo sobre una sola: elegí la fecha de esa factura en el historial.`
                : 'Estas ventas todavía no tienen factura emitida, así que no hay nada que acreditar. Corregí las cantidades directamente.'}
            </p>
          ) : (
            <>
              <p style={{ margin: '0 0 7px', fontSize: '12px', color: '#6b7280' }}>
                Nota de crédito sobre la factura <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#111827' }}>{numeroFactura}</strong>.
                Sale por el mismo punto de venta que la factura y al mismo precio con el que se facturó.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={emitirNC} disabled={emitiendo} className="btn" style={{ fontSize: '12px', padding: '6px 14px', background: '#b45309' }}>
                  {emitiendo ? 'Emitiendo…' : 'Emitir nota de crédito'}
                </button>
                <button onClick={onCerrar} className="btn secondary" style={{ fontSize: '12px', padding: '6px 14px' }} disabled={emitiendo}>Cerrar</button>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  Es un comprobante fiscal: una vez emitido no se deshace desde la app.
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
      <>
      {/* ── El precio, cuando no son las cantidades lo que cambió ────────────────────
          Corregir cantidades revaloriza al precio del catálogo. Si lo que se acordó fue otro
          precio —una bonificación, un precio pactado por única vez— el catálogo no lo sabe.
          Acá se escribe directamente lo que hay que cobrar: es un número decidido por una
          persona y le gana a cualquier cálculo. */}
      {/* ── Lo que va a pasar en Xubio ────────────────────────────────────────────────
          Corregir cantidades de una factura emitida dispara un comprobante, y eso se emite
          en AFIP y no se deshace. Se calcula mientras se tipea y se dice acá, ANTES de
          guardar: qué baja, qué sube, cuánto da y qué comprobante sale. */}
      {modo === 'app' && previa && previa.length > 0 && (
        <div style={{ margin: '10px 0', padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12.5px', color: '#1e3a8a' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 800 }}>Si guardás así{calculando ? '…' : ':'}</p>
          {previa.map((f: any) => (
            <div key={f.numero} style={{ marginBottom: '7px', paddingBottom: '7px', borderBottom: '1px solid #dbeafe' }}>
              <p style={{ margin: 0 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{f.numero}</span>
                {' · $'}{Math.round(f.montoXubio).toLocaleString('es-AR')} → <strong>${Math.round(f.montoNuevo).toLocaleString('es-AR')}</strong>
              </p>
              {f.bajas.length > 0 && (
                <p style={{ margin: '2px 0 0', color: '#92400e' }}>
                  Baja: {f.bajas.map((x: any) => `${x.cantidad} ${x.label}${x.sinPrecio ? ' (sin precio)' : ` = $${x.importe.toLocaleString('es-AR')}`}`).join(' · ')}
                </p>
              )}
              {f.altas.length > 0 && (
                <p style={{ margin: '2px 0 0', color: '#15803d' }}>
                  Sube: {f.altas.map((x: any) => `${x.cantidad} ${x.label}${x.sinPrecio ? ' (sin precio)' : ` = $${x.importe.toLocaleString('es-AR')}`}`).join(' · ')}
                </p>
              )}
              <p style={{ margin: '3px 0 0', fontWeight: 700 }}>
                {sinXubio
                  ? '→ No se toca Xubio: solo cambia lo que la app reclama.'
                  : f.accion === 'nota_credito'
                    ? `→ Se emite una NOTA DE CRÉDITO en Xubio por $${Math.round(f.importeComprobante).toLocaleString('es-AR')}`
                    : f.accion === 'factura_extra'
                      ? `→ Se emite una FACTURA NUEVA por la diferencia: $${Math.round(f.importeComprobante).toLocaleString('es-AR')}`
                      : `→ No sale ningún comprobante. ${f.motivo}`}
              </p>
              {f.sinPrecio && (
                <p style={{ margin: '3px 0 0', color: '#b45309' }}>
                  Hay un artículo sin precio cargado: ese renglón iría en $0.
                </p>
              )}
            </div>
          ))}
          {/* La excepción va acá y no como un modo aparte: es lo raro, no lo normal. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', cursor: 'pointer', marginTop: '4px' }}>
            <input type="checkbox" checked={sinXubio} onChange={(e) => setSinXubio(e.target.checked)} />
            No tocar Xubio — corregir solo lo que la app reclama
          </label>
        </div>
      )}

      <div style={{ marginTop: '10px', padding: '8px 10px', background: '#fafaf9', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '3px' }}>
          Importe a cobrar, si no es el que sale de las cantidades
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min={0} step={1} value={importeManual} placeholder="dejalo vacío para calcularlo"
            onChange={(e) => setImporteManual(e.target.value)} disabled={guardando}
            style={{ width: '200px', fontSize: '13px', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '5px' }} />
          <span style={{ fontSize: '11px', color: '#6b7280', flex: 1, minWidth: '240px', lineHeight: 1.45 }}>
            Para una bonificación o un precio pactado por única vez. No toca Xubio —la factura sigue diciendo lo que
            dice— ni el precio de catálogo del cliente: el próximo pedido se valoriza como siempre.
          </span>
        </div>
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button onClick={guardar} disabled={guardando} className="btn" style={{ fontSize: '12px', padding: '6px 14px' }}>
          {guardando ? 'Guardando…' : '✓ Guardar cambios'}
        </button>
        <button onClick={onCerrar} className="btn secondary" style={{ fontSize: '12px', padding: '6px 14px' }}>Cerrar</button>
      </div>
      </>
      )}
    </div>
  );
}

export default function HistorialManager() {
  const [loading, setLoading] = useState(true);
  const [exportaciones, setExportaciones] = useState<EntradaExpCliente[]>([]);
  const [pendientes, setPendientes] = useState<EntradaPend[]>([]);
  // Las columnas de los demás artículos las manda el servidor con su etiqueta: los
  // artículos dados de alta desde la app no están en el código del navegador.
  const [articulos, setArticulos] = useState<ArticuloCol[]>([]);
  const [filtro, setFiltro] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [limpiando, setLimpiando] = useState(false);
  const [eliminandoTodosPend, setEliminandoTodosPend] = useState(false);
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Las que quedaron sueltas de un cliente que ese mismo día SÍ se facturó. No se muestran
  // en la lista: casi siempre son la misma venta guardada dos veces, y tenerlas mezcladas con
  // lo que de verdad falta facturar es lo que hacía que la lista no sirviera.
  const [verRemitos, setVerRemitos] = useState(false);
  // ── 20 por página ────────────────────────────────────────────────────────────────
  //
  // La tabla traía las 407 líneas de una. Scrollear cuatrocientas filas para llegar a la
  // de anteayer no es mirar un historial, es buscar a ojo. Veinte entran en una pantalla.
  //
  // La página vuelve a 1 cuando cambia cualquier filtro: quedarse en la página 9 de una
  // lista que ahora tiene 3 resultados muestra una tabla vacía y parece que no hay nada.
  const POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);
  const [verRepetidas, setVerRepetidas] = useState(false);
  const [borrandoRepetidas, setBorrandoRepetidas] = useState(false);

  // ── Llegar directo a una factura por su número ──────────────────────────────────────
  //
  // `?factura=B-00001-00000655` abre esa factura ya expandida y lista para corregir. Se
  // entra así desde la lista de facturas de Cobranzas, que es donde se mira cuánto debe un
  // cliente y donde aparece que una factura está mal: tener que anotarse el número, venir
  // acá y buscarla a mano es el trabajo que esto saca.
  //
  // El editor se abre por (id_exportacion, id_control), no por número, así que el servidor
  // traduce. Si no se puede, se dice por qué y la pantalla sigue siendo usable: una factura
  // sin venta detrás no es un error, es un caso.
  const params = useSearchParams();
  const facturaPedida = String(params?.get('factura') || '').trim();
  const [avisoFactura, setAvisoFactura] = useState<string | null>(null);
  const [buscandoFactura, setBuscandoFactura] = useState(false);

  function cargar() {
    setLoading(true);
    fetch('/api/ventas/historial').then(r => r.json()).then(j => {
      setExportaciones(j.exportaciones || []);
      setPendientes(j.pendientes || []);
      setArticulos(j.articulos || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { cargar(); }, []);
  useEffect(() => { setPagina(1); }, [filtro, filtroCliente, filtroSucursal]);

  useEffect(() => {
    if (!facturaPedida) return;
    setBuscandoFactura(true);
    setAvisoFactura(null);
    fetch(`/api/ventas/por-numero?numero=${encodeURIComponent(facturaPedida)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.encontrada) {
          // Se filtra además de abrir: la tabla tiene cientos de filas y abrir una en el
          // medio deja al que llegó buscándola igual que antes.
          setFiltro(j.id_exportacion);
          setEditando(`${j.id_exportacion}__${j.id_control}`);
        } else {
          setAvisoFactura(j?.motivo || j?.error || 'No se pudo encontrar esa factura.');
        }
      })
      .catch(() => setAvisoFactura('No se pudo buscar esa factura.'))
      .finally(() => setBuscandoFactura(false));
  }, [facturaPedida]);

  // Devuelve lo que el servidor dice que hizo. Antes no se miraba: si borraba cero filas,
  // la pantalla recargaba igual y todo quedaba como estaba, sin una palabra. "No pasa nada
  // al apretar" es el peor resultado posible, porque no se sabe si falló o si no había nada.
  async function limpiar(body: Record<string, any>): Promise<{ limpiados?: number; intentados?: number; sinBorrar?: number }> {
    const r = await fetch('/api/ventas/limpiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Error');
    return j;
  }

  // Solo las de ESE cliente en esa fecha. Antes borraba todo lo pendiente del día: con la
  // tabla agrupada solo por fecha daba igual, pero ahora cada fila es un cliente y borrar de
  // más sería tirar la venta de otro.
  async function eliminarPendiente(fecha: string, idControl: string, cliente: string) {
    if (!confirm(`¿Eliminar las ventas no facturadas de ${cliente} del ${fecha}? Esto no se puede deshacer.`)) return;
    setEliminando(`${fecha}__${idControl}__`); setMsg(null);
    try {
      const j = await limpiar({ fecha, id_control: idControl, soloPendientesDelDia: true });
      setMsg(j.sinBorrar ? `Quedaron ${j.sinBorrar} sin borrar — probá de nuevo.` : `✓ Borrado (${j.limpiados ?? 0}).`);
      cargar();
    }
    catch (e: any) { setMsg(e.message); }
    setEliminando(null);
  }

  async function eliminarTodosPendientes() {
    if (!confirm('¿Eliminar TODAS las ventas no facturadas (de cualquier fecha)? Esto no se puede deshacer.')) return;
    setEliminandoTodosPend(true); setMsg(null);
    try {
      const j = await limpiar({ soloPendientes: true });
      setMsg(j.sinBorrar
        ? `Se borraron ${j.limpiados} de ${j.intentados}. ${j.sinBorrar} no se pudieron borrar — probá de nuevo; si persiste, avisá.`
        : `✓ Se borraron ${j.limpiados ?? 0} venta(s) no facturadas.`);
      cargar();
    }
    catch (e: any) { setMsg(e.message); }
    setEliminandoTodosPend(false);
  }

  async function eliminarRepetidas() {
    if (!confirm('¿Borrar las cargas repetidas? Son ventas sin facturar de clientes a los que ese mismo día ya se les emitió la factura. Lo facturado no se toca.')) return;
    setBorrandoRepetidas(true); setMsg(null);
    try {
      const j = await limpiar({ soloRepetidas: true });
      setMsg(j.sinBorrar
        ? `Se borraron ${j.limpiados} de ${j.intentados}. ${j.sinBorrar} no se pudieron borrar — probá de nuevo.`
        : `✓ Se borraron ${j.limpiados ?? 0} carga(s) repetida(s).`);
      cargar();
    }
    catch (e: any) { setMsg(e.message); }
    setBorrandoRepetidas(false);
  }

  async function eliminarFacturado(id_exportacion: string, id_control: string, cliente: string) {
    if (!confirm(`¿Eliminar la venta de ${cliente} en la exportación ${id_exportacion}? Esto corrige solo el registro interno de Xavia — no anula la factura ya emitida en Xubio.`)) return;
    setEliminando(`${id_exportacion}__${id_control}`); setMsg(null);
    try { await limpiar({ id_exportacion, id_control }); cargar(); }
    catch (e: any) { setMsg(e.message); }
    setEliminando(null);
  }

  async function limpiarTodo() {
    if (!confirm('¿Limpiar TODAS las ventas de la hoja? Esto no se puede deshacer.')) return;
    setLimpiando(true); setMsg(null);
    try {
      await limpiar({ limpiarTodo: true });
      setMsg('Hoja limpiada.');
      cargar();
    } catch (e: any) { setMsg(e.message); }
    setLimpiando(false);
  }

  // Una columna por artículo que aparezca EN LO QUE SE ESTÁ VIENDO, no una por artículo del
  // catálogo. Con veinte artículos entre microgreens y ensaladas, dibujarlos todos deja una
  // tabla de veinticinco columnas con dieciocho vacías y la hace ilegible justo para los
  // clientes que solo compran rúcula.
  function colsCon(filas: { otros?: Record<string, number> }[]): ArticuloCol[] {
    const conAlgo = new Set<string>();
    for (const f of filas) for (const [k, n] of Object.entries(f.otros || {})) if (Number(n) > 0) conAlgo.add(k);
    return articulos.filter((a) => conAlgo.has(a.key));
  }
  const celdaOtro = (f: { otros?: Record<string, number> }, k: string) => {
    const n = Number(f.otros?.[k]) || 0;
    return n > 0 ? fmt(n) : '—';
  };

  const q = filtro.trim().toLowerCase();
  // Las opciones salen de lo que hay cargado, no de una lista fija: un cliente dado de baja
  // sigue teniendo facturas viejas que hay que poder buscar.
  const clientesOpts = Array.from(new Set(exportaciones.map(e => e.cliente))).sort((a, b) => a.localeCompare(b));
  const sucursalesOpts = Array.from(new Set(exportaciones.flatMap(e => e.sucursales || []))).sort((a, b) => a.localeCompare(b));
  const expFiltradas = exportaciones.filter(e => {
    if (filtroCliente && e.cliente !== filtroCliente) return false;
    if (filtroSucursal && !(e.sucursales || []).includes(filtroSucursal)) return false;
    if (!q) return true;
    return e.cliente.toLowerCase().includes(q)
      || e.fecha.includes(q)
      || e.id_exportacion.toLowerCase().includes(q)
      || (e.sucursales || []).some(su => su.toLowerCase().includes(q));
  });
  const hayFiltro = !!(q || filtroCliente || filtroSucursal);
  const totalPaginas = Math.max(1, Math.ceil(expFiltradas.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const expPagina = expFiltradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  // Cada tabla dibuja solo los artículos que aparecen en SUS filas: lo facturado y lo
  // pendiente casi nunca tienen los mismos, y compartir columnas dejaba la mitad vacías.
  const colsExp = colsCon(expFiltradas);
  const esRepetida = (p: EntradaPend) => !p.marcada && (p.facturadoMismoDia || []).length > 0;
  const repetidas = pendientes.filter(esRepetida);
  const pendVisibles = verRepetidas ? pendientes : pendientes.filter((p) => !esRepetida(p));
  const colsPend = colsCon(pendVisibles);

  if (loading) return <p style={{ color: '#9ca3af', fontSize: '13px' }}>Cargando…</p>;

  return (
    <div>
      {/* Se llegó buscando una factura puntual. Decirlo, y decir si se encontró: sin esto,
          el que viene de Cobranzas no sabe si la pantalla le hizo caso o lo dejó en el
          historial entero. */}
      {facturaPedida && (buscandoFactura || avisoFactura) && (
        <div style={{ margin: '0 0 14px', padding: '9px 12px', borderRadius: '7px', fontSize: '12.5px',
          background: avisoFactura ? '#fffbeb' : '#eff6ff',
          border: `1px solid ${avisoFactura ? '#fde68a' : '#bfdbfe'}`,
          color: avisoFactura ? '#92400e' : '#1e40af' }}>
          {buscandoFactura
            ? <>Buscando la factura <span style={{ fontFamily: 'ui-monospace, monospace' }}>{facturaPedida}</span>…</>
            : <><strong>{facturaPedida}</strong> — {avisoFactura}</>}
        </div>
      )}

      {/* ── No facturado ── */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '2px' }}>
          <p className="card-title" style={{ margin: 0 }}>🕓 No facturado</p>
          {pendientes.length > 0 && (
            <button onClick={eliminarTodosPendientes} disabled={eliminandoTodosPend}
              style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
              {eliminandoTodosPend ? 'Eliminando…' : '🗑 Eliminar todos'}
            </button>
          )}
        </div>
        <p className="card-sub">Cargado en Ventas pero todavía sin enviar a Xubio</p>
        {/* El resultado de borrar va ACÁ, al lado del botón. Antes salía al pie de la página,
            debajo de cientos de líneas facturadas: se apretaba "Eliminar todos" y no se veía
            que hubiera pasado nada. */}
        {msg && (
          <p style={{ fontSize: '12.5px', color: '#374151', margin: '0 0 8px', padding: '7px 10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>{msg}</p>
        )}
        {repetidas.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px', padding: '7px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '12px', color: '#1e40af' }}>
            <span style={{ flex: 1, minWidth: '220px' }}>
              {verRepetidas ? 'Se están mostrando' : 'No se muestran'} <strong>{repetidas.length}</strong> carga(s) de clientes que ese mismo día ya
              tienen factura emitida: casi siempre es la misma venta guardada dos veces.
            </span>
            <button onClick={() => setVerRepetidas((v) => !v)}
              style={{ background: 'white', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#1e40af' }}>
              {verRepetidas ? 'Ocultar' : 'Ver'}
            </button>
            <button onClick={eliminarRepetidas} disabled={borrandoRepetidas}
              style={{ background: 'white', border: '1px solid #fca5a5', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
              {borrandoRepetidas ? 'Borrando…' : '🗑 Borrar repetidas'}
            </button>
          </div>
        )}
        {pendVisibles.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>No hay nada pendiente de facturar.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '13px', width: '100%' }}>
              <thead><tr style={{ background: '#fefce8', borderBottom: '1px solid #fde68a' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Cliente</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula kg</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga kg</th>
                {colsPend.map(a => <th key={a.key} style={{ textAlign: 'right', padding: '6px 10px' }}>{a.label}</th>)}
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>¿Se facturó ese día?</th>
                <th style={{ padding: '6px 10px' }}></th>
              </tr></thead>
              <tbody>
                {pendVisibles.map(h => {
                  const kp = `${h.fecha}__${h.id_control}__${h.marcada ? 'M' : ''}`;
                  return (
                  <tr key={kp} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.fecha}</td>
                    <td style={{ padding: '7px 10px', color: '#374151' }}>
                      {h.cliente}
                      {(h.sucursales || []).length > 0 && (
                        <span style={{ display: 'block', fontSize: '10.5px', color: '#9ca3af' }}>{(h.sucursales || []).join(' · ')}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#166534' }}>{h.rucula > 0 ? fmt(h.rucula) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#4d7c0f' }}>{h.lechuga > 0 ? fmt(h.lechuga) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#92400e' }}>{fmtKg(h.rucula_kg)}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#b45309' }}>{fmtKg(h.lechuga_kg)}</td>
                    {colsPend.map(a => (
                      <td key={a.key} style={{ textAlign: 'right', padding: '7px 10px', color: '#0f766e' }}>{celdaOtro(h, a.key)}</td>
                    ))}
                    {/* La respuesta a \"¿esto quedó sin facturar o ya se facturó en otra
                        carga?\". Si ese día salieron facturas a ESE cliente, lo más probable
                        es que esta fila sea una carga repetida y haya que borrarla, no
                        facturarla de nuevo. */}
                    <td style={{ padding: '7px 10px', fontSize: '11.5px' }}>
                      {h.marcada ? (
                        <span style={{ color: '#b91c1c', fontWeight: 600 }}>
                          No — se mandó a facturar y Xubio no la emitió
                        </span>
                      ) : (h.facturadoMismoDia || []).length === 0 ? (
                        <span style={{ color: '#b45309', fontWeight: 600 }}>No — falta facturar</span>
                      ) : (
                        <span style={{ color: '#1e40af' }}>
                          Sí: {(h.facturadoMismoDia || []).map(x => x.id_exportacion).join(', ')}
                          <span style={{ display: 'block', color: '#9ca3af', fontSize: '10.5px' }}>
                            puede ser una carga repetida
                          </span>
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      {h.marcada ? (
                        <Link href="/facturacion" className="btn secondary small">Reintentar en Facturación →</Link>
                      ) : (<>
                      <Link href={`/ventas?fecha=${h.fecha}`} className="btn secondary small">Ir a cargar →</Link>
                      <button onClick={() => eliminarPendiente(h.fecha, h.id_control, h.cliente)} disabled={eliminando === kp}
                        style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
                        {eliminando === kp ? 'Eliminando…' : '🗑 Eliminar'}
                      </button>
                      </>)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Facturado ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <p className="card-title" style={{ margin: 0 }}>📤 Facturado</p>
            {/* El remito sale DESPUÉS de facturar, así que el lugar es este: la lista de
                lo ya emitido. */}
            <button type="button" onClick={() => setVerRemitos((v) => !v)}
              style={{ fontSize: '12px', fontWeight: 700, padding: '4px 11px', borderRadius: '7px', cursor: 'pointer', border: '1px solid #0f766e', background: verRemitos ? '#f0fdfa' : 'white', color: '#0f766e' }}>
              📄 Generar remitos
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filtroCliente} onChange={ev => setFiltroCliente(ev.target.value)}
              style={{ fontSize: '12px', padding: '5px 8px', maxWidth: '200px' }}>
              <option value="">Todos los clientes</option>
              {clientesOpts.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {sucursalesOpts.length > 0 && (
              <select value={filtroSucursal} onChange={ev => setFiltroSucursal(ev.target.value)}
                style={{ fontSize: '12px', padding: '5px 8px', maxWidth: '200px' }}>
                <option value="">Todas las sucursales</option>
                {sucursalesOpts.map(su => <option key={su} value={su}>{su}</option>)}
              </select>
            )}
            <input type="text" value={filtro} onChange={ev => setFiltro(ev.target.value)} placeholder="Buscar por fecha o N° de exportación…"
              style={{ fontSize: '12px', padding: '5px 10px', maxWidth: '240px' }} />
            {hayFiltro && (
              <button onClick={() => { setFiltro(''); setFiltroCliente(''); setFiltroSucursal(''); }}
                style={{ fontSize: '11px', padding: '4px 9px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', color: '#6b7280' }}>
                Limpiar
              </button>
            )}
          </div>
        </div>
        <p className="card-sub">
          Ya enviado a Xubio · más reciente primero ·{' '}
          {hayFiltro ? `${expFiltradas.length} de ${exportaciones.length} líneas` : `${exportaciones.length} líneas`}
          {/* Qué se está viendo de todo lo que hay. Sin esto, veinte filas de cuatrocientas
              se leen como si fueran todas. */}
          {expFiltradas.length > POR_PAGINA && ` · mostrando ${(paginaActual - 1) * POR_PAGINA + 1}-${Math.min(paginaActual * POR_PAGINA, expFiltradas.length)}`}
        </p>

        {verRemitos && <Remitos onCerrar={() => setVerRemitos(false)} />}
        {expFiltradas.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>{hayFiltro ? 'Sin resultados para ese filtro.' : 'Todavía no se facturó nada.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '13px', width: '100%' }}>
              <thead><tr style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>N° exportación</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Cliente</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula kg</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga kg</th>
                {colsExp.map(a => <th key={a.key} style={{ textAlign: 'right', padding: '6px 10px' }}>{a.label}</th>)}
                <th style={{ padding: '6px 10px' }}></th>
              </tr></thead>
              <tbody>
                {expPagina.map(h => {
                  const key = `${h.id_exportacion}__${h.id_control}`;
                  const abierto = editando === key;
                  return (
                  <Fragment key={key}>
                    <tr style={{ borderBottom: abierto ? 'none' : '1px solid #f3f4f6', background: abierto ? '#eff6ff' : undefined }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.fecha}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#1e40af', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.id_exportacion}</td>
                      <td style={{ padding: '7px 10px', color: '#374151' }}>
                        {h.cliente}
                        {(h.sucursales || []).length > 0 && (
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#9ca3af' }}>
                            {(h.sucursales || []).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#166534' }}>{h.rucula > 0 ? fmt(h.rucula) : '—'}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#4d7c0f' }}>{h.lechuga > 0 ? fmt(h.lechuga) : '—'}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#92400e' }}>{fmtKg(h.rucula_kg)}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#b45309' }}>{fmtKg(h.lechuga_kg)}</td>
                      {colsExp.map(a => (
                        <td key={a.key} style={{ textAlign: 'right', padding: '7px 10px', color: '#0f766e' }}>{celdaOtro(h, a.key)}</td>
                      ))}
                      <td style={{ padding: '7px 10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditando(abierto ? null : key)} className="btn secondary small">
                          {abierto ? '▲ Cerrar' : '✏️ Editar'}
                        </button>
                        <button onClick={() => eliminarFacturado(h.id_exportacion, h.id_control, h.cliente)} disabled={eliminando === key}
                          style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
                          {eliminando === key ? 'Eliminando…' : '🗑 Eliminar'}
                        </button>
                      </td>
                    </tr>
                    {abierto && (
                      <tr style={{ borderBottom: '1px solid #f3f4f6', background: '#eff6ff' }}>
                        <td colSpan={8 + colsExp.length} style={{ padding: '0 10px 12px' }}>
                          <EditorFacturadoDetalle idExportacion={h.id_exportacion} idControl={h.id_control} fecha={h.fecha} camposExtra={articulos}
                            onGuardado={() => { setEditando(null); cargar(); }} onFilaEliminada={cargar} onCerrar={() => setEditando(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Las páginas ───────────────────────────────────────────────────────────
            Números y no solo "siguiente": el historial se mira para encontrar algo de
            una fecha, y saltar de a una página hasta la 14 no es buscar, es resignarse. */}
        {expFiltradas.length > POR_PAGINA && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
            <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaActual <= 1}
              style={{ fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: '1px solid #e5e7eb', background: 'white', color: paginaActual <= 1 ? '#d1d5db' : '#374151', cursor: paginaActual <= 1 ? 'not-allowed' : 'pointer' }}>
              ← Anterior
            </button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1)
              // Con muchas páginas se muestran las cercanas más la primera y la última: una
              // fila de treinta números es tan difícil de usar como ninguno.
              .filter((n) => n === 1 || n === totalPaginas || Math.abs(n - paginaActual) <= 2)
              .map((n, idx, arr) => (
                <span key={n} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ color: '#d1d5db', fontSize: '12px' }}>…</span>}
                  <button type="button" onClick={() => setPagina(n)}
                    style={{
                      fontSize: '12px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: n === paginaActual ? 800 : 500,
                      border: `1px solid ${n === paginaActual ? '#2563eb' : '#e5e7eb'}`,
                      background: n === paginaActual ? '#eff6ff' : 'white',
                      color: n === paginaActual ? '#1d4ed8' : '#6b7280',
                    }}>
                    {n}
                  </button>
                </span>
              ))}
            <button type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaActual >= totalPaginas}
              style={{ fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: '1px solid #e5e7eb', background: 'white', color: paginaActual >= totalPaginas ? '#d1d5db' : '#374151', cursor: paginaActual >= totalPaginas ? 'not-allowed' : 'pointer' }}>
              Siguiente →
            </button>
            <span style={{ fontSize: '11.5px', color: '#9ca3af', marginLeft: '4px' }}>
              {expFiltradas.length} líneas en {totalPaginas} páginas
            </span>
          </div>
        )}
      </div>

      {/* ── Zona de riesgo ── */}
      <div style={{ marginTop: '28px', borderTop: '1px solid #f3f4f6', paddingTop: '14px', textAlign: 'right' }}>
        <button onClick={limpiarTodo} disabled={limpiando}
          style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
          🗑 Limpiar toda la hoja de Ventas
        </button>
      </div>
    </div>
  );
}
