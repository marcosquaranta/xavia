'use client';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FacturaCliente } from '@/lib/facturasCliente';

// ── Limpiar facturas viejas que ya no hay que perseguir ──────────────────────────────
//
// Xubio no dice si una factura está paga, así que la app deduce "pendiente" restando
// cobrado de facturado. Esa resta arrastra para siempre lo que se cobró por fuera —un
// cheque, una compensación, un cobro cargado a mano hace dos años— y esas facturas siguen
// apareciendo al imputar y siguen saliendo en los reclamos.
//
// Esta pantalla las da por saldadas SIN tocar la contabilidad. La alternativa fácil sería
// registrar un cobro por el importe para que desaparezcan, y es mucho peor: mete en Xubio
// plata que nunca entró.

export interface ClienteFacturas { id_control: string; nombre: string }

// Cuánto debe cada cliente, calculado en la página a partir de las MISMAS facturas que la
// lista de impagas. Llega como resumen y no como detalle: alcanza para ordenar el
// desplegable y para decir al lado de cada nombre cuánto hay para limpiar.
export interface DeudaCliente { monto: number; cantidad: number; masVieja: string }

// Una línea de la vista previa del barrido masivo (la arma /api/cobranzas/antiguas).
interface ClienteAntiguasUI {
  id_control: string; cliente: string; total: number; masVieja: string;
  quedanAbiertas: number; quedanTotal: number;
  facturas: { numero: string; fecha: string; importe: number; dias: number }[];
}

export interface SaldadaUI {
  numero: string; cliente: string; importe: number;
  fecha_marcado: string; motivo: string; usuario: string;
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

const DIAS_ATAJOS = [30, 60, 90, 120, 180];

export default function FacturasViejas({
  clientes, facturasPorCliente, saldadas, diasVentana = 365, deuda = {},
}: {
  clientes: ClienteFacturas[];
  facturasPorCliente: Record<string, FacturaCliente[]>;
  saldadas: SaldadaUI[];
  diasVentana?: number;
  deuda?: Record<string, DeudaCliente>;
}) {
  const router = useRouter();
  const [idControl, setIdControl] = useState('');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verMarcadas, setVerMarcadas] = useState(false);
  // Por defecto solo lo abierto, que es para lo que existe la pantalla. Pero se puede ver
  // todo: si una factura que se cobró desde la app igual aparece como abierta, lo único que
  // lo delata es verlas juntas con su estado al lado.
  const [verTodas, setVerTodas] = useState(false);
  // Las facturas de los clientes que no vienen precargados se piden al elegirlos.
  //
  // La página precarga solo los clientes con recordatorio prendido, para no mandarle al
  // navegador el detalle de todos. Pero acá hacen falta TODOS: marcar facturas viejas como
  // saldadas es justamente lo que hay que poder hacer con un cliente al que no se le está
  // reclamando. Sin esto, elegir uno de esos decía "no tiene facturas", que era mentira.
  const [traidas, setTraidas] = useState<Record<string, FacturaCliente[]>>({});
  // Lo que se marcó en esta pantalla, encima de lo que vino del servidor: hasta que el
  // servidor se ponga al día, lo recién marcado tiene que verse marcado.
  const [locales, setLocales] = useState<Record<string, FacturaCliente[]>>({});
  const [cargando, setCargando] = useState(false);
  // ── El barrido masivo ──────────────────────────────────────────────────────────
  //
  // Limpiar cliente por cliente eran veinte vueltas de elegir, esperar, tildar y guardar, y
  // por eso no se hacía: la lista de impagas mostraba una deuda que ya no existía. Acá se
  // ve de una sola vez todo lo que tiene más de N días y se marca junto.
  //
  // En dos pasos a propósito: primero se ve qué incluye, recién después se marca. Es
  // plata que se deja de perseguir en veinte cuentas de golpe, y deshacerlo después es de
  // a una.
  const [diasMasivo, setDiasMasivo] = useState(60);
  const [previa, setPrevia] = useState<{ dias: number; hasta: string; clientes: ClienteAntiguasUI[]; totalFacturas: number; totalImporte: number } | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [motivoMasivo, setMotivoMasivo] = useState('');
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [abiertoEnPrevia, setAbiertoEnPrevia] = useState<string | null>(null);
  const [guardandoMasivo, setGuardandoMasivo] = useState(false);

  async function traer(id: string) {
    if (!id || facturasPorCliente[id] || traidas[id]) return;
    setCargando(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(id)}&dias=${diasVentana}`);
      const j = await r.json();
      if (r.ok) setTraidas((p) => ({ ...p, [id]: j.facturas || [] }));
      else setMsg({ ok: false, texto: j?.error || 'No se pudieron traer las facturas.' });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudieron traer las facturas.' });
    } finally {
      setCargando(false);
    }
  }

  async function verPrevia(dias: number) {
    setCargandoPrevia(true); setMsg(null); setPrevia(null); setExcluidos(new Set());
    try {
      const r = await fetch(`/api/cobranzas/antiguas?dias=${dias}`);
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, texto: j?.error || 'No se pudo calcular.' }); return; }
      setPrevia(j);
      if (!j.totalFacturas) setMsg({ ok: true, texto: `No hay ninguna factura abierta de más de ${dias} días.` });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo calcular.' });
    } finally {
      setCargandoPrevia(false);
    }
  }

  // Los clientes que de verdad se van a marcar: la previa viene completa y se puede sacar
  // alguno. Un cliente destildado no entra, aunque tenga facturas viejas.
  const incluidos = (previa?.clientes || []).filter((c) => !excluidos.has(c.id_control));
  const totalMasivo = incluidos.reduce((a, c) => a + c.total, 0);
  const cantMasivo = incluidos.reduce((a, c) => a + c.facturas.length, 0);

  async function marcarMasivo() {
    if (!previa || !cantMasivo || !motivoMasivo.trim()) return;
    const parcial = excluidos.size > 0;
    const texto = `Se van a dar por saldadas ${cantMasivo} facturas de ${incluidos.length} clientes, por ${fmt(totalMasivo)}.\n\n`
      + `Son las emitidas hasta el ${fmtFecha(previa.hasta)} (más de ${previa.dias} días) que siguen abiertas.\n\n`
      + 'No se registra ningún cobro en Xubio: dejan de aparecer al imputar y en los reclamos. Deshacerlo después es de a una factura.\n\n¿Confirmás?';
    if (!window.confirm(texto)) return;
    setGuardandoMasivo(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/saldadas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'saldar_antiguas', dias: previa.dias, motivo: motivoMasivo.trim(),
          // Cuántas esperaba la pantalla. El servidor recalcula y corta si cambió: lo que se
          // confirma acá arriba es ese número, y marcar otro sería confirmar otra cosa.
          esperadas: cantMasivo,
          ...(parcial ? { clientes: incluidos.map((c) => c.id_control) } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, texto: j?.error || 'No se pudo guardar.' }); return; }
      setMsg({ ok: true, texto: j.mensaje });
      setPrevia(null); setMotivoMasivo(''); setExcluidos(new Set());
      // Lo que se marcó recalcula la pantalla entera, y la pantalla lee seis hojas más
      // Xubio: pedirlo en el mismo segundo es lo que hacía saltar el límite de Sheets. Se
      // deja que el usuario recargue cuando quiera; lo guardado ya está guardado.
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally {
      setGuardandoMasivo(false);
    }
  }

  // Solo lo que sigue abierto: lo ya imputado por la app no se ofrece, y lo ya marcado a
  // mano tampoco (se ve abajo, con su motivo). De la más vieja a la más nueva, porque son
  // justamente las viejas las que hay que limpiar.
  const todas = useMemo(() => {
    return (locales[idControl] || facturasPorCliente[idControl] || traidas[idControl] || [])
      .slice()
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [facturasPorCliente, traidas, locales, idControl]);

  const abiertas = useMemo(() => todas.filter((f) => !f.yaCobrada && !f.saldadaManual && !f.cubierta && !f.imputadaManual), [todas]);
  const visibles = verTodas ? todas : abiertas;
  // Solo se puede tildar lo que sigue abierto: marcar como saldada una que ya se cobró no
  // cambia nada y ensucia el registro con una decisión que nadie tomó.
  const todasTildadas = abiertas.length > 0 && abiertas.every((f) => elegidas.has(f.numero));

  const totalElegido = abiertas.filter((f) => elegidas.has(f.numero)).reduce((a, f) => a + f.importe, 0);
  const nombreCliente = clientes.find((c) => String(c.id_control) === idControl)?.nombre || '';
  const listo = elegidas.size > 0 && motivo.trim().length > 0 && !guardando;

  // De mayor a menor deuda. Alfabético obligaba a saber de memoria a quién hay que
  // limpiar: el que arrastra dos millones de facturas viejas puede estar en la N. Los que no
  // deben nada van al final, no se esconden —hay que poder elegirlos igual para revisar—
  // pero dejan de estar delante de los que importan.
  const clientesOrdenados = useMemo(() => clientes.slice().sort((a, b) => {
    const da = deuda[a.id_control]?.monto || 0;
    const db = deuda[b.id_control]?.monto || 0;
    if (da !== db) return db - da;
    return a.nombre.localeCompare(b.nombre);
  }), [clientes, deuda]);

  function alternarTodas() {
    setElegidas(todasTildadas ? new Set() : new Set(abiertas.map((f) => f.numero)));
  }

  // Tildar de una las que pasan cierta antigüedad. Con dieciocho facturas, tildar “las de
  // más de 60 días” a mano es leer dieciocho fechas y no equivocarse en ninguna.
  function tildarPorAntiguedad(dias: number) {
    setElegidas(new Set(abiertas.filter((f) => diasDesde(f.fecha) >= dias).map((f) => f.numero)));
  }

  function alternar(numero: string) {
    setElegidas((prev) => {
      const n = new Set(prev);
      if (n.has(numero)) n.delete(numero);
      else n.add(numero);
      return n;
    });
  }

  async function guardar() {
    if (!listo) return;
    setGuardando(true);
    setMsg(null);
    try {
      const res = await fetch('/api/cobranzas/saldadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo: motivo.trim(),
          facturas: abiertas.filter((f) => elegidas.has(f.numero)).map((f) => ({
            numero: f.numero, id_control: idControl, cliente: nombreCliente,
            fecha: f.fecha, importe: f.importe,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, texto: j?.error || 'No se pudo guardar.' });
        return;
      }
      setMsg({ ok: true, texto: j.mensaje });
      // Se marcan acá mismo, sin esperar a que el servidor rearme la página: la plata ya
      // quedó guardada y lo que falta es que la pantalla lo muestre. El refresh sigue
      // yendo, pero por detrás — si tarda, no se nota.
      const marcadas = new Set(elegidas);
      const marcar = (fs: FacturaCliente[]) => fs.map((f) => marcadas.has(f.numero) ? { ...f, saldadaManual: true } : f);
      setTraidas((p) => (p[idControl] ? { ...p, [idControl]: marcar(p[idControl]) } : p));
      setLocales((p) => ({ ...p, [idControl]: marcar(facturasPorCliente[idControl] || p[idControl] || []) }));
      setElegidas(new Set());
      setMotivo('');
      // Sin router.refresh(): recargar la pantalla de Cobranzas lee seis hojas más Xubio, y
      // pedirlo justo después de escribir dieciocho filas es lo que hacía saltar el límite
      // de consultas por minuto de Sheets. El error aparecía DESPUÉS de haber guardado bien,
      // así que parecía que no se había guardado. Lo de arriba ya dejó la pantalla al día.
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally {
      setGuardando(false);
    }
  }

  async function revertir(numero: string) {
    setGuardando(true);
    setMsg(null);
    try {
      const res = await fetch('/api/cobranzas/saldadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'revertir', numero }),
      });
      const j = await res.json();
      setMsg({ ok: res.ok, texto: res.ok ? j.mensaje : (j?.error || 'No se pudo deshacer.') });
      if (res.ok) {
        const volver = (fs: FacturaCliente[]) => fs.map((f) => f.numero === numero ? { ...f, saldadaManual: false } : f);
        setTraidas((p) => (p[idControl] ? { ...p, [idControl]: volver(p[idControl]) } : p));
        setLocales((p) => ({ ...p, [idControl]: volver(facturasPorCliente[idControl] || p[idControl] || []) }));
        router.refresh();
      }
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo deshacer.' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      {/* ══ Barrido por antigüedad ══
          Va primero porque es el camino para el caso común —limpiar el arrastre viejo de
          todos los clientes— y elegir cliente por cliente es el caso puntual. */}
      <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '8px', padding: '11px 13px', marginBottom: '14px' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
          Limpiar todo lo viejo de una vez
        </p>
        <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>
          Busca en <strong>todos los clientes</strong> las facturas que siguen abiertas y pasaron cierta antigüedad.
          Primero mostrá la lista, después se marcan.
        </p>
        <div style={{ marginTop: '9px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {DIAS_ATAJOS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDiasMasivo(d); verPrevia(d); }}
              disabled={cargandoPrevia || guardandoMasivo}
              style={{
                fontSize: '12px', padding: '5px 11px', borderRadius: '6px', cursor: 'pointer',
                border: diasMasivo === d && previa ? '1px solid #b45309' : '1px solid #fcd34d',
                background: diasMasivo === d && previa ? '#b45309' : 'white',
                color: diasMasivo === d && previa ? 'white' : '#92400e',
                fontWeight: 600,
              }}
            >
              más de {d} días
            </button>
          ))}
          {cargandoPrevia && <span style={{ fontSize: '12px', color: '#92400e' }}>Buscando…</span>}
        </div>

        {previa && previa.totalFacturas > 0 && (
          <div style={{ marginTop: '11px', borderTop: '1px solid #fde68a', paddingTop: '9px' }}>
            <p style={{ margin: 0, fontSize: '12.5px', color: '#78350f' }}>
              <strong>{previa.totalFacturas} facturas</strong> de <strong>{previa.clientes.length} clientes</strong> por{' '}
              <strong>{fmt(previa.totalImporte)}</strong> — emitidas hasta el {fmtFecha(previa.hasta)}.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginTop: '7px' }}>
              <thead>
                <tr style={{ color: '#92400e', fontSize: '11px', textAlign: 'left' }}>
                  <th style={{ padding: '3px 6px', width: '26px' }}></th>
                  <th style={{ padding: '3px 6px' }}>Cliente</th>
                  <th style={{ padding: '3px 6px', textAlign: 'right' }}>Facturas</th>
                  <th style={{ padding: '3px 6px', textAlign: 'right' }}>A saldar</th>
                  <th style={{ padding: '3px 6px' }}>Más vieja</th>
                  <th style={{ padding: '3px 6px', textAlign: 'right' }}>Le queda</th>
                </tr>
              </thead>
              <tbody>
                {previa.clientes.map((c) => {
                  const fuera = excluidos.has(c.id_control);
                  const abierto = abiertoEnPrevia === c.id_control;
                  return (
                  <Fragment key={c.id_control}>
                    <tr style={{ borderTop: '1px solid #fef3c7', opacity: fuera ? 0.45 : 1 }}>
                      <td style={{ padding: '3px 6px' }}>
                        <input
                          type="checkbox"
                          checked={!fuera}
                          onChange={() => setExcluidos((prev) => {
                            const n = new Set(prev);
                            if (n.has(c.id_control)) n.delete(c.id_control); else n.add(c.id_control);
                            return n;
                          })}
                          title="Sacar este cliente del barrido"
                        />
                      </td>
                      <td style={{ padding: '3px 6px' }}>
                        <button
                          type="button"
                          onClick={() => setAbiertoEnPrevia(abierto ? null : c.id_control)}
                          style={{ background: 'none', border: 'none', padding: 0, fontSize: '12.5px', color: '#92400e', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}
                        >
                          {abierto ? '▾' : '▸'} {c.cliente}
                        </button>
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.facturas.length}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.total)}</td>
                      <td style={{ padding: '3px 6px', color: '#b45309' }}>{fmtFecha(c.masVieja)}</td>
                      {/* Lo que NO entra en este corte. Es la pregunta inmediata al ver
                          “12 facturas”: ¿y el resto de lo que debe? */}
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                        {c.quedanAbiertas > 0 ? `${c.quedanAbiertas} · ${fmt(c.quedanTotal)}` : '—'}
                      </td>
                    </tr>
                    {abierto && (
                      <tr style={{ background: '#fffdf5' }}>
                        <td colSpan={6} style={{ padding: '4px 6px 8px 32px' }}>
                          {c.facturas.map((f) => (
                            <div key={f.numero} style={{ display: 'flex', gap: '10px', fontSize: '11.5px', color: '#78350f', padding: '1px 0' }}>
                              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{f.numero}</span>
                              <span>{fmtFecha(f.fecha)} ({f.dias} días)</span>
                              <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(f.importe)}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={motivoMasivo}
                onChange={(e) => setMotivoMasivo(e.target.value)}
                placeholder="Por qué se dan por saldadas (ej: arrastre viejo, cobrado por fuera)"
                style={{ flex: '1 1 300px', padding: '8px 10px', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '13px' }}
              />
              <button
                type="button"
                onClick={marcarMasivo}
                disabled={!cantMasivo || !motivoMasivo.trim() || guardandoMasivo}
                className="btn"
                style={{ fontSize: '13px', background: '#b45309', borderColor: '#b45309', opacity: (!cantMasivo || !motivoMasivo.trim() || guardandoMasivo) ? 0.5 : 1 }}
              >
                {guardandoMasivo ? 'Marcando…' : `Marcar ${cantMasivo} como saldadas`}
              </button>
            </div>
            {excluidos.size > 0 && (
              <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: '#92400e' }}>
                {excluidos.size} {excluidos.size === 1 ? 'cliente queda' : 'clientes quedan'} afuera · se marcan {cantMasivo} facturas por {fmt(totalMasivo)}
              </p>
            )}
          </div>
        )}
      </div>

      <p style={{ margin: '0 0 7px', fontSize: '11.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        O cliente por cliente
      </p>
      <select
        value={idControl}
        onChange={(e) => { setIdControl(e.target.value); setElegidas(new Set()); setMsg(null); traer(e.target.value); }}
        style={{ width: '100%', maxWidth: '320px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
      >
        <option value="">Elegí un cliente…</option>
        {clientesOrdenados.map((c) => {
          const d = deuda[c.id_control];
          return (
            <option key={c.id_control} value={c.id_control}>
              {c.nombre}{d ? ` — ${fmt(d.monto)} · ${d.cantidad} ${d.cantidad === 1 ? 'factura' : 'facturas'}` : ''}
            </option>
          );
        })}
      </select>

      {idControl && cargando && (
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#6b7280' }}>Buscando las facturas del cliente…</p>
      )}

      {idControl && !cargando && (todas.length === 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#6b7280' }}>
          Este cliente no tiene facturas en los últimos {diasVentana} días.
        </p>
      ) : abiertas.length === 0 && !verTodas ? (
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#059669' }}>
          Las {todas.length} facturas de este cliente ya están cobradas o saldadas.{' '}
          <button
            type="button"
            onClick={() => setVerTodas(true)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '13px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
          >
            Verlas igual
          </button>
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              {abiertas.length} {abiertas.length === 1 ? 'abierta' : 'abiertas'}
              {todas.length > abiertas.length ? ` · ${todas.length - abiertas.length} ya cerradas` : ''}
            </p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Tildar por antigüedad en vez de leer dieciocho fechas a ojo. */}
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>Tildar las de</span>
              {DIAS_ATAJOS.map((d) => {
                const cuantas = abiertas.filter((f) => diasDesde(f.fecha) >= d).length;
                if (!cuantas) return null;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => tildarPorAntiguedad(d)}
                    style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', color: '#b45309', cursor: 'pointer', fontWeight: 600 }}
                    title={`${cuantas} ${cuantas === 1 ? 'factura' : 'facturas'} con ${d} días o más`}
                  >
                    +{d}d <span style={{ color: '#9ca3af', fontWeight: 400 }}>({cuantas})</span>
                  </button>
                );
              })}
            </div>
            {todas.length > abiertas.length && (
              <button
                type="button"
                onClick={() => setVerTodas((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
              >
                {verTodas ? 'Ver solo las abiertas' : 'Ver también las cerradas'}
              </button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '6px' }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: '11.5px', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px', width: '28px' }}>
                  <input
                    type="checkbox"
                    checked={todasTildadas}
                    onChange={alternarTodas}
                    disabled={!abiertas.length}
                    title="Seleccionar todas las abiertas"
                  />
                </th>
                <th style={{ padding: '4px 6px' }}>Factura</th>
                <th style={{ padding: '4px 6px' }}>Fecha</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Importe</th>
                <th style={{ padding: '4px 6px' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const dias = diasDesde(f.fecha);
                const cerrada = f.yaCobrada || f.saldadaManual || f.cubierta || f.imputadaManual;
                return (
                  <tr key={f.numero} style={{ borderTop: '1px solid #f3f4f6', opacity: cerrada ? 0.55 : 1 }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="checkbox"
                        checked={elegidas.has(f.numero)}
                        onChange={() => alternar(f.numero)}
                        disabled={cerrada}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}>{f.numero}</td>
                    <td style={{ padding: '4px 6px', color: !cerrada && dias > 60 ? '#b45309' : '#6b7280' }}>
                      {fmtFecha(f.fecha)} <span style={{ fontSize: '11px', color: '#9ca3af' }}>({dias} días)</span>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(f.importe)}</td>
                    <td style={{ padding: '4px 6px', fontSize: '11.5px', color: cerrada ? '#059669' : '#b45309' }}>
                      {f.yaCobrada ? 'cobrada en la app'
                        : f.imputadaManual ? 'imputada a un cobro'
                        : f.saldadaManual ? 'saldada a mano'
                        : f.cubierta ? 'cubierta por cobros de Xubio'
                        : 'abierta'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se dan por saldadas (ej: cobrado con cheque en mano)"
              style={{ flex: '1 1 320px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
            />
            <button onClick={guardar} disabled={!listo} className="btn" style={{ fontSize: '13px', opacity: listo ? 1 : 0.5 }}>
              {guardando ? 'Guardando…' : `Marcar como ${elegidas.size === 1 ? 'saldada' : 'saldadas'}`}
            </button>
          </div>
          {elegidas.size > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6b7280' }}>
              {elegidas.size} {elegidas.size === 1 ? 'factura' : 'facturas'} · {fmt(totalElegido)} — no se registra
              ningún cobro en Xubio, solo dejan de aparecer acá y en los reclamos.
            </p>
          )}
        </>
      ))}

      {msg && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>
          {msg.ok ? '✓ ' : '⚠ '}{msg.texto}
        </p>
      )}

      {/* Lo ya marcado, con el motivo y la vuelta atrás. Sin esto la marca sería una
          decisión invisible: nadie podría revisar qué se dejó de reclamar ni por qué. */}
      {saldadas.length > 0 && (
        <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
          <button
            type="button"
            onClick={() => setVerMarcadas((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
          >
            {verMarcadas ? '▾' : '▸'} Marcadas como saldadas ({saldadas.length})
          </button>
          {verMarcadas && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '8px' }}>
              <tbody>
                {saldadas.map((s) => (
                  <tr key={s.numero} style={{ borderTop: '1px solid #f9fafb', color: '#6b7280' }}>
                    <td style={{ padding: '3px 6px', fontFamily: 'ui-monospace, monospace' }}>{s.numero}</td>
                    <td style={{ padding: '3px 6px' }}>{s.cliente}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.importe)}</td>
                    <td style={{ padding: '3px 6px', color: '#9ca3af' }}>{s.motivo} · {s.usuario}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => revertir(s.numero)}
                        disabled={guardando}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '11.5px', color: '#b45309', cursor: 'pointer' }}
                      >
                        deshacer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
