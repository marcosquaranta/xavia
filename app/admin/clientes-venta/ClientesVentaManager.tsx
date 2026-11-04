'use client';
import { PCT_RETENCION_GANANCIAS } from '@/lib/retenciones';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';

import { ARTICULOS_UNIDAD } from '@/lib/articulos';
// Último cambio de cada precio, por "id_control||sucursal||producto". Viene de la hoja
// PreciosHistorico, que se empezó a llenar en septiembre de 2026: un producto sin entrada
// no quiere decir que nunca se le haya tocado el precio, sino que el cambio es anterior a
// que esto existiera. La pantalla lo dice en vez de mostrar un guion sin explicación.
interface CambioPrecioUI {
  fecha: string; anterior: number; nuevo: number; diferencia: number; variacionPct: number; diasDesde: number;
}
interface Props {
  clientes: ClienteVenta[];
  precios: PrecioVenta[];
  cambios: Record<string, CambioPrecioUI>;
  // Los dados de alta desde Admin → Artículos de venta, ya separados por unidad.
  extrasUnidad?: { key: string; label: string }[];
  extrasKg?: { key: string; label: string }[];
}

// Solo los artículos que se venden hoy. Los dados de baja no se editan —no tiene sentido
// ponerle precio nuevo a algo que no se hace más— pero su precio viejo sigue en la planilla
// y se sigue usando para valorizar las ventas de cuando sí se vendía.
const PROD_LABELS = ARTICULOS_UNIDAD.map((a) => ({ key: a.key, label: a.labelLargo }));
// Los artículos dados de alta desde Admin → Artículos de venta se suman a estas listas. Sin
// esto no se les puede poner precio, y sin precio un artículo no aparece nunca en la
// pantalla de carga: quedaría creado y invisible.
export interface EtiquetaArticulo { key: string; label: string }
// lechuga_kg (precio único, legacy) ya no se edita acá — reemplazado por precio propio
// por variedad. El valor viejo se preserva en la planilla pero no se toca desde este form.
const KG_LABELS = [
  { key: 'rucula_kg',         label: 'Rúcula KG' },
  { key: 'lechuga_kg_crespa', label: 'Lechuga Crespa KG' },
  { key: 'lechuga_kg_roble',  label: 'Lechuga Roble KG' },
];

const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y.slice(2)}` : f; };
const fmtPesos = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('es-AR');

function PreciosSucursal({ idControl, nombreCliente, sucursalObs, precioActual, esKg, onSaved, cambios, extrasUnidad = [], extrasKg = [] }: {
  idControl: string; nombreCliente: string; sucursalObs: string;
  precioActual: PrecioVenta | undefined; esKg: boolean; onSaved: () => void;
  cambios: Record<string, CambioPrecioUI>;
  extrasUnidad?: EtiquetaArticulo[]; extrasKg?: EtiquetaArticulo[];
}) {
  // ── Los dos grupos, siempre ──────────────────────────────────────────────────────────
  //
  // Antes el cliente marcado como "kg" veía SOLO las casillas por cajón y el resto solo las
  // de unidad. Pero hay clientes que llevan rúcula por cajón y además ensaladas, albahaca,
  // berro o microgreens por unidad, y a esos no había forma de cargarles el precio de la
  // otra mitad. Sin precio, el artículo no aparece nunca en la pantalla de carga: la venta
  // quedaba sin poder cargarse y no había nada que indicara por qué.
  //
  // Ahora están los dos grupos y `esKg` solo decide cuál va primero. Las casillas que no
  // se usan quedan vacías, que es exactamente lo que significan.
  const camposUnidad = [...PROD_LABELS, ...extrasUnidad];
  const camposKg = [...KG_LABELS, ...extrasKg];
  const grupos = esKg
    ? [{ titulo: 'Por cajón', campos: camposKg }, { titulo: 'Por unidad', campos: camposUnidad }]
    : [{ titulo: 'Por unidad', campos: camposUnidad }, { titulo: 'Por cajón', campos: camposKg }];
  const campos = [...camposUnidad, ...camposKg];
  const [vals, setVals] = useState<Record<string,string>>(() =>
    Object.fromEntries(campos.map(p => [p.key, precioActual ? String((precioActual as any)[p.key] || '') : '']))
  );
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function guardar() {
    setSaving(true); setOk(false); setErr(null);
    try {
      const res = await fetch('/api/admin/precios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: idControl, nombre_cliente: nombreCliente, sucursal_obs: sucursalObs,
          ...Object.fromEntries(campos.map(p => [p.key, Number(vals[p.key]) || 0])) }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setOk(true); setTimeout(() => setOk(false), 2000);
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: esKg ? '#fffbeb' : '#f9fafb', border: `1px solid ${esKg ? '#fde68a' : '#f3f4f6'}`, borderRadius: '6px', padding: '10px 12px', marginBottom: '8px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: esKg ? '#92400e' : '#374151' }}>
        {sucursalObs}{esKg && <span style={{ marginLeft: '6px', fontWeight: 400, fontSize: '10px' }}>· compra por cajón</span>}
      </p>
      {grupos.filter((g) => g.campos.length > 0).map((g) => (
      <div key={g.titulo} style={{ marginBottom: '10px' }}>
      <p style={{ margin: '0 0 4px', fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {g.titulo}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(g.campos.length, 5)}, 1fr)`, gap: '6px' }}>
        {g.campos.map(p => {
          const ult = cambios[`${idControl}||${sucursalObs}||${p.key}`];
          const subio = ult ? ult.diferencia > 0 : false;
          return (
          <div key={p.key}>
            <label style={{ fontSize: '10px' }}>{p.label}</label>
            <input type="number" value={vals[p.key]} onChange={e => setVals(v => ({ ...v, [p.key]: e.target.value }))}
              min="0" style={{ padding: '4px 6px', fontSize: '12px' }} disabled={saving} />
            {/* Último movimiento de ESTE precio, para no tener que acordarse de cuándo fue. */}
            {ult ? (
              <p style={{ margin: '2px 0 0', fontSize: '9.5px', lineHeight: 1.35, color: subio ? '#166534' : '#b45309' }}
                title={`De ${fmtPesos(ult.anterior)} a ${fmtPesos(ult.nuevo)} el ${fmtDia(ult.fecha)}`}>
                {subio ? '▲' : '▼'} {fmtPesos(ult.diferencia)}
                {ult.variacionPct ? ` (${ult.variacionPct > 0 ? '+' : ''}${ult.variacionPct}%)` : ''}
                <br />
                <span style={{ color: '#9ca3af' }}>{fmtDia(ult.fecha)} · hace {ult.diasDesde}d</span>
              </p>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: '9.5px', color: '#c7c6c2' }}>sin cambios registrados</p>
            )}
          </div>
          );
        })}
      </div>
      </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button className="btn" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={guardar} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar precios'}
        </button>
        {ok && <span style={{ fontSize: '11px', color: '#059669' }}>✓ Guardado</span>}
        {err && <span style={{ fontSize: '11px', color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  );
}

function ClienteRow({ c, precios, cambios, onSaved, extrasUnidad = [], extrasKg = [] }: { c: ClienteVenta; precios: PrecioVenta[]; cambios: Record<string, CambioPrecioUI>; onSaved: () => void; extrasUnidad?: EtiquetaArticulo[]; extrasKg?: EtiquetaArticulo[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [fields, setFields] = useState({
    nombre_xubio: c.nombre_xubio,
    nombre_display: c.nombre_display || '',
    alias: c.alias || '',
    tipo_factura: c.tipo_factura,
    punto_venta: String(c.punto_venta || ''),
    sucursales: c.sucursales || '',
    unidad: String(c.unidad || 'paq'),
    orden: String(c.orden || ''),
    facturar_por_sucursal: c.facturar_por_sucursal === 'SI' ? 'SI' : 'NO',
    // Datos de cobranza. Estaban solo en la pantalla de Cobranzas y acá es donde alguien va
    // a buscarlos cuando quiere saber "qué sé de este cliente".
    email: String((c as any).email || ''),
    email_cobranza: String((c as any).email_cobranza || ''),
    recordatorio_cobro: (c as any).recordatorio_cobro === 'SI' ? 'SI' : 'NO',
    retencion_ganancias_pct: String((c as any).retencion_ganancias_pct || ''),
  });

  const sucursalesArr = fields.sucursales ? fields.sucursales.split('|').map(s => s.trim()).filter(Boolean) : [];
  const sucursalObs = sucursalesArr.length === 0 ? c.nombre_xubio : null;

  async function guardarCliente() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/admin/clientes-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: c.id_control, ...fields }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActivo() {
    setSaving(true);
    try {
      await fetch('/api/admin/clientes-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: c.id_control, activo: c.activo === 'SI' ? 'NO' : 'SI' }),
      });
      onSaved();
    } catch {}
    finally { setSaving(false); }
  }

  const pFirst = precios.find(p => String(p.id_control) === String(c.id_control));

  return (
    <>
      <tr style={{ opacity: c.activo === 'NO' ? 0.5 : 1, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#6b7280', fontSize: '11px' }}>{c.id_control}</td>
        <td style={{ fontWeight: 500 }}>{c.nombre_xubio}</td>
        <td style={{ color: '#6b7280', fontSize: '12px' }}>{c.alias || c.nombre_display}</td>
        <td style={{ fontSize: '11px', color: '#6b7280' }}>{c.sucursales || '—'}</td>
        <td style={{ textAlign: 'center', fontSize: '12px', color: c.orden ? '#111827' : '#d1d5db' }}>{c.orden || '—'}</td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ background: c.tipo_factura === 'A' ? '#dbeafe' : '#f3f4f6', color: c.tipo_factura === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
            {c.tipo_factura}
          </span>
        </td>
        <td style={{ textAlign: 'right', fontSize: '12px' }}>{pFirst ? `$${Number(pFirst.rucula).toLocaleString('es-AR')}` : '—'}</td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#6b7280' }}>{open ? '▲' : '▼'}</span>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} style={{ padding: '0 0 12px', background: '#fafafa' }}>
            <div style={{ padding: '14px', borderTop: '1px solid #f3f4f6' }}>

              {/* Datos del cliente */}
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Datos del cliente</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px' }}>Nombre en Xubio</label>
                  <input type="text" value={fields.nombre_xubio} onChange={e => setFields(f => ({ ...f, nombre_xubio: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Nombre display</label>
                  <input type="text" value={fields.nombre_display} onChange={e => setFields(f => ({ ...f, nombre_display: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Alias</label>
                  <input type="text" value={fields.alias} onChange={e => setFields(f => ({ ...f, alias: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Tipo factura</label>
                  <select value={fields.tipo_factura} onChange={e => setFields(f => ({ ...f, tipo_factura: e.target.value }))} disabled={saving}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Punto de venta</label>
                  <input type="number" value={fields.punto_venta} onChange={e => setFields(f => ({ ...f, punto_venta: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Sucursales (separadas por |)</label>
                  <input type="text" value={fields.sucursales} onChange={e => setFields(f => ({ ...f, sucursales: e.target.value }))} disabled={saving} placeholder="Ej: Norte|Sur|Centro" />
                </div>
                {sucursalesArr.length > 0 && (
                  <div>
                    <label style={{ fontSize: '11px' }} title="Emite una factura A Xubio separada por cada sucursal en vez de una sola combinada — misma razón social, comprobantes distintos. Cada renglón de la factura también aclara la sucursal.">
                      Facturación por sucursal
                    </label>
                    <select value={fields.facturar_por_sucursal} onChange={e => setFields(f => ({ ...f, facturar_por_sucursal: e.target.value }))} disabled={saving}>
                      <option value="NO">Una factura combinada (todas las sucursales)</option>
                      <option value="SI">Una factura separada por sucursal</option>
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: '11px' }}>Unidad de venta</label>
                  <select value={fields.unidad} onChange={e => setFields(f => ({ ...f, unidad: e.target.value }))} disabled={saving}>
                    <option value="paq">Paquetes</option>
                    <option value="kg">KG (cajón) — ej. Select Food</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Orden en carga de Ventas</label>
                  <input type="number" value={fields.orden} onChange={e => setFields(f => ({ ...f, orden: e.target.value }))} disabled={saving} placeholder="sin fijar = por frecuencia" />
                </div>
              </div>

              {/* ── Cobranza ──
                  El mail al que se le reclama vive acá, con el resto de los datos del
                  cliente, y no en una pantalla aparte: cuando hay que actualizar un
                  contacto, el lugar donde se lo busca es la ficha del cliente. Se sigue
                  pudiendo editar desde Cobranzas — es la misma columna de la misma hoja. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '8px', marginBottom: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px' }}>Mail general</label>
                  <input type="email" value={fields.email} onChange={e => setFields(f => ({ ...f, email: e.target.value }))} disabled={saving} placeholder="contacto@cliente.com" />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Mail de cobranzas</label>
                  <input type="email" value={fields.email_cobranza} onChange={e => setFields(f => ({ ...f, email_cobranza: e.target.value }))} disabled={saving}
                    placeholder={fields.email ? `${fields.email} (el general)` : 'administracion@cliente.com'} />
                  <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ca3af' }}>Si está vacío se usa el general.</p>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Retención de ganancias</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: saving ? 'default' : 'pointer', fontSize: '12.5px', padding: '6px 0' }}>
                    <input type="checkbox" disabled={saving}
                      checked={Number(fields.retencion_ganancias_pct) > 0}
                      onChange={e => setFields(f => ({ ...f, retencion_ganancias_pct: e.target.checked ? String(PCT_RETENCION_GANANCIAS) : '' }))}
                      style={{ width: '16px', height: '16px' }} />
                    Me retiene ganancias ({Number(fields.retencion_ganancias_pct) > 0 ? fields.retencion_ganancias_pct : PCT_RETENCION_GANANCIAS}%)
                  </label>
                  <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>
                    {Number(fields.retencion_ganancias_pct) > 0 && Number(fields.retencion_ganancias_pct) !== PCT_RETENCION_GANANCIAS
                      ? `Tiene cargado ${fields.retencion_ganancias_pct}%, distinto del 2% general. Se respeta.`
                      : 'La alícuota la fija la ley (RG 830) y es 2% para todos. Acá solo se marca si este cliente es agente de retención. El monto siempre se puede editar al cargar el cobro.'}
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Recordatorio de cobranza</label>
                  <select value={fields.recordatorio_cobro} onChange={e => setFields(f => ({ ...f, recordatorio_cobro: e.target.value }))} disabled={saving}>
                    <option value="NO">No le mandamos</option>
                    <option value="SI">Sí, todos los lunes</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
                <button className="btn" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={guardarCliente} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar datos'}
                </button>
                <button className="btn secondary" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={toggleActivo} disabled={saving}>
                  {c.activo === 'SI' ? 'Desactivar' : 'Activar'}
                </button>
                {err && <span style={{ fontSize: '11px', color: '#dc2626' }}>{err}</span>}
              </div>

              {/* Precios por sucursal */}
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Precios</p>
              {sucursalesArr.length > 0
                ? sucursalesArr.map(suc => (
                    <PreciosSucursal key={suc}
                      idControl={String(c.id_control)} nombreCliente={c.nombre_xubio} sucursalObs={suc}
                      precioActual={precios.find(p => String(p.id_control) === String(c.id_control) && p.sucursal_obs === suc)}
                      esKg={c.unidad === 'kg'} onSaved={onSaved} cambios={cambios} extrasUnidad={extrasUnidad} extrasKg={extrasKg} />
                  ))
                : <PreciosSucursal
                    idControl={String(c.id_control)} nombreCliente={c.nombre_xubio} sucursalObs={c.nombre_xubio}
                    precioActual={precios.find(p => String(p.id_control) === String(c.id_control))}
                    esKg={c.unidad === 'kg'} onSaved={onSaved} cambios={cambios} extrasUnidad={extrasUnidad} extrasKg={extrasKg} />
              }
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClientesVentaManager({ clientes, precios, cambios, extrasUnidad = [], extrasKg = [] }: Props) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [ok, setOk] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [nombreXubio, setNombreXubio] = useState('');
  const [alias, setAlias] = useState('');
  const [tipoFactura, setTipoFactura] = useState('A');
  const [puntoVenta, setPuntoVenta] = useState('2');
  const [sucursales, setSucursales] = useState('');

  function reset() { setNombreXubio(''); setAlias(''); setTipoFactura('A'); setPuntoVenta('2'); setSucursales(''); setError(null); setOk(false); }

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null); setOk(false);
    try {
      const res = await fetch('/api/admin/clientes-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_xubio: nombreXubio.trim(), alias: alias.trim(), tipo_factura: tipoFactura, punto_venta: puntoVenta, sucursales: sucursales.trim() }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setOk(true); setMostrarForm(false); reset(); router.refresh();
    } catch (err: any) { setError(err.message || 'Error al crear'); }
    finally { setLoading(false); }
  }

  const activos = clientes.filter(c => c.activo === 'SI');
  const inactivos = clientes.filter(c => c.activo === 'NO');

  // ── Los mails de los clientes activos ────────────────────────────────────────────
  //
  // Un cliente puede tener varias direcciones en el mismo campo (separadas por coma o
  // punto y coma), así que se parten y se juntan todas. Se deduplican ignorando
  // mayúsculas: el mismo contacto cargado en dos clientes es una sola persona, y Gmail
  // muestra el destinatario repetido a todos los demás.
  //
  // Es el `email` general y no el de cobranzas: esto es para avisos comerciales —una
  // lista de precios, un cambio de horario—, no para reclamar una factura.
  const mailsActivos = (() => {
    const vistos = new Map<string, string>();
    for (const c of activos) {
      for (const m of String((c as any).email || '').split(/[,;]+/)) {
        const dir = m.trim();
        if (!dir.includes('@')) continue;
        const k = dir.toLowerCase();
        if (!vistos.has(k)) vistos.set(k, dir);
      }
    }
    return [...vistos.values()];
  })();

  const sinMail = activos
    .filter((c) => !String((c as any).email || '').includes('@'))
    .map((c) => String((c as any).alias || (c as any).nombre_xubio || c.id_control));

  async function copiarMails() {
    // Coma y espacio: es lo que Gmail corta en destinatarios al pegar. Con punto y coma
    // algunos clientes de correo pegan todo junto en una sola dirección inválida.
    const texto = mailsActivos.join(', ');
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError('No pude copiar solo. Copiá esto a mano:\n\n' + texto);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{activos.length} activos · {inactivos.length} inactivos</p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Los mails de los activos, listos para pegar en el Para: de Gmail. */}
          <button type="button" onClick={copiarMails}
            title="Copiar los mails de los clientes activos, separados por coma"
            style={{ fontSize: '12.5px', padding: '6px 12px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>
            {copiado ? `✓ ${mailsActivos.length} mails copiados` : '✉️ Copiar mails de activos'}
          </button>
          {!mostrarForm && <button type="button" className="btn" onClick={() => { reset(); setMostrarForm(true); }}>+ Nuevo cliente</button>}
        </div>
      </div>

      {/* Quiénes quedaron afuera. Un cliente activo sin mail cargado desaparece de la lista
          sin decir nada, y el mail sale creyendo que fue a todos: el que falta no se entera
          de nada y nadie se entera de que no se enteró. */}
      {sinMail.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: '11.5px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '7px 10px', lineHeight: 1.55 }}>
          <strong>{sinMail.length} cliente(s) activos no tienen mail cargado</strong> y no entran en la lista: {sinMail.join(' · ')}.
        </p>
      )}

      {ok && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#166534' }}>✓ Cliente creado</div>}

      {mostrarForm && (
        <form onSubmit={crear} className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Nuevo cliente</p>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Nombre en Xubio *</label>
              <input type="text" value={nombreXubio} onChange={e => setNombreXubio(e.target.value)} required disabled={loading} />
            </div>
            <div><label>Alias</label><input type="text" value={alias} onChange={e => setAlias(e.target.value)} disabled={loading} /></div>
            <div><label>Tipo factura</label>
              <select value={tipoFactura} onChange={e => setTipoFactura(e.target.value)} disabled={loading}>
                <option value="A">A</option><option value="B">B</option>
              </select>
            </div>
            <div><label>Punto de venta</label><input type="number" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} required disabled={loading} /></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Sucursales (separadas por |) — dejar vacío si es un solo punto</label>
              <input type="text" value={sucursales} onChange={e => setSucursales(e.target.value)} disabled={loading} placeholder="Ej: Norte|Sur|Centro" />
            </div>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280' }}>Los precios se cargan después desde el panel de edición del cliente.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Crear cliente'}</button>
            <button type="button" className="btn secondary" onClick={() => { setMostrarForm(false); reset(); }} disabled={loading}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <p className="card-title">Clientes · click para editar</p>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'center', width: '40px' }}>ID</th>
              <th>Nombre Xubio</th>
              <th>Alias / Display</th>
              <th>Sucursales</th>
              <th style={{ textAlign: 'center', width: '55px' }} title="Orden en la carga de Ventas">Orden</th>
              <th style={{ textAlign: 'center' }}>Fact.</th>
              <th style={{ textAlign: 'right' }}>Rúcula</th>
              <th style={{ width: '30px' }}></th>
            </tr>
          </thead>
          <tbody>
            {activos.map(c => <ClienteRow key={c.id_control} c={c} precios={precios} cambios={cambios} onSaved={() => router.refresh()} extrasUnidad={extrasUnidad} extrasKg={extrasKg} />)}
            {inactivos.length > 0 && (
              <>
                <tr><td colSpan={8} style={{ padding: '8px 6px 4px', fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Inactivos</td></tr>
                {inactivos.map(c => <ClienteRow key={c.id_control} c={c} precios={precios} cambios={cambios} onSaved={() => router.refresh()} extrasUnidad={extrasUnidad} extrasKg={extrasKg} />)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
