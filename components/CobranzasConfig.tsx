'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ventanaDemasiadoAngosta, VENTANA_MINIMA_DIAS } from '@/lib/cobranzasVentana';

export interface ClienteFila {
  id_control: string;
  nombre: string;
  activo: boolean;
  email: string;
  emailGeneral: string;
  antiguedad: number;
  antiguedadHasta: number;
}

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};

async function guardar(body: any): Promise<void> {
  const res = await fetch('/api/cobranzas/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Error al guardar');
}

export function ClientesRecordatorio({ clientes }: { clientes: ClienteFila[] }) {
  const [filas, setFilas] = useState(clientes);
  // Por defecto solo los que tienen el recordatorio prendido. La lista completa son todos
  // los clientes activos, y en el 99% de las veces que se entra acá es para tocarle algo a
  // uno que ya está prendido, no para prender uno nuevo.
  const [verTodos, setVerTodos] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  // El resultado de "Enviar ahora" se guarda POR CLIENTE y se muestra debajo de su fila.
  // Antes iba a un mensaje único al pie de la tabla: en letra chica, lejos del botón que se
  // acababa de apretar, y se pisaba al tocar el siguiente cliente. Cuando el motivo es "no
  // corresponde reclamarle", ese mensaje es TODO lo que pasa — no se manda nada ni queda
  // registrado en ningún lado— así que perderlo de vista es perder la respuesta entera.
  const [resultado, setResultado] = useState<Record<string, { t: 'ok' | 'err'; s: string }>>({});
  const router = useRouter();

  async function togglear(c: ClienteFila, activo: boolean) {
    setGuardando(c.id_control); setMsg(null);
    try {
      await guardar({ id_control: c.id_control, activo });
      setFilas((p) => p.map((x) => x.id_control === c.id_control ? { ...x, activo } : x));
      setMsg({ t: 'ok', s: `✓ ${c.nombre}: recordatorio ${activo ? 'activado' : 'desactivado'}` });
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
    setGuardando(null);
  }

  async function guardarAntiguedad(c: ClienteFila, valor: string) {
    const antiguedad = Number(valor);
    if (!(antiguedad > 0) || antiguedad === c.antiguedad) return;
    setGuardando(c.id_control); setMsg(null);
    try {
      await guardar({ id_control: c.id_control, antiguedad });
      setFilas((p) => p.map((x) => x.id_control === c.id_control ? { ...x, antiguedad } : x));
      setMsg({ t: 'ok', s: `✓ ${c.nombre}: se reclaman las facturas de ${antiguedad} días o más` });
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
    setGuardando(null);
  }

  async function guardarAntiguedadHasta(c: ClienteFila, valor: string) {
    const antiguedadHasta = Number(valor);
    if (!(antiguedadHasta > 0) || antiguedadHasta === c.antiguedadHasta) return;
    setGuardando(c.id_control); setMsg(null);
    try {
      await guardar({ id_control: c.id_control, antiguedadHasta });
      setFilas((p) => p.map((x) => x.id_control === c.id_control ? { ...x, antiguedadHasta } : x));
      setMsg({ t: 'ok', s: `✓ ${c.nombre}: plazo actualizado` });
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
    setGuardando(null);
  }

  // Envío puntual, sin esperar al lunes. Primero simula y muestra qué saldría: un
  // recordatorio a un cliente no se puede deshacer, así que se ve antes de mandarlo.
  async function enviarAhora(c: ClienteFila) {
    setGuardando(c.id_control); setMsg(null);
    const decir = (t: 'ok' | 'err', str: string) => setResultado((p) => ({ ...p, [c.id_control]: { t, s: str } }));
    decir('err', '');
    try {
      const sim = await fetch(`/api/cron/recordatorios-cobro?simular=1&cliente=${encodeURIComponent(c.id_control)}`);
      const js = await sim.json();
      if (!sim.ok) throw new Error((js.errores || []).join(' · ') || 'No se pudo calcular');

      let det = (js.detalle || [])[0];
      let insistir = false;

      if (!det) {
        if ((js.sinEmail || []).length > 0) {
          decir('err', 'No se mandó: falta cargarle el mail de cobranzas.');
          setGuardando(null); return;
        }
        const motivo = (js.omitidos || [])[0]?.motivo;
        if (motivo) {
          decir('err', `No se mandó — ${motivo}.`);
          setGuardando(null); return;
        }

        // No hay facturas NUEVAS. Si las que hay ya se reclamaron antes se puede insistir:
        // el control de duplicados protege al envío automático de repetir solo, no a una
        // decisión tomada a propósito. Se vuelve a simular ignorándolo, para poder mostrar
        // exactamente qué se re-reclamaría antes de mandarlo.
        const sim2 = await fetch(`/api/cron/recordatorios-cobro?simular=1&insistir=1&cliente=${encodeURIComponent(c.id_control)}`);
        const js2 = await sim2.json();
        det = (js2.detalle || [])[0];
        if (!det) {
          decir('err', `No se mandó: no le figura ninguna factura impaga de más de ${c.antiguedad} días.`);
          setGuardando(null); return;
        }
        insistir = true;
      }

      const ok = confirm(
        (insistir
          ? `A ${c.nombre} ya se le reclamaron estas facturas antes. Se le van a reclamar DE NUEVO, ahora.\n\n`
          : `Se le va a mandar el recordatorio a ${c.nombre} AHORA.\n\n`)
        + `Comprobantes: ${det.comprobantes}\n`
        + `Total: $${Math.round(det.total).toLocaleString('es-AR')}\n\n`
        + 'El mail sale al cliente con copia a administración. ¿Confirmás?'
      );
      if (!ok) { decir('err', 'Cancelado, no se mandó nada.'); setGuardando(null); return; }

      const env = await fetch(`/api/cron/recordatorios-cobro?cliente=${encodeURIComponent(c.id_control)}${insistir ? '&insistir=1' : ''}`);
      const je = await env.json();
      if (!env.ok || (je.errores || []).length) throw new Error((je.errores || []).join(' · ') || 'Error al enviar');
      decir('ok', `✓ ${insistir ? 'Re-enviado' : 'Enviado'} — ${det.comprobantes}`);
      // Sin esto la tabla de "Recordatorios enviados" sigue mostrando lo de antes: se
      // renderiza en el servidor y el envío pasó acá, en el navegador. El mail salía, pero
      // desde la pantalla parecía que no había pasado nada.
      router.refresh();
    } catch (e: any) {
      decir('err', e.message || 'Error al enviar');
    }
    setGuardando(null);
  }

  async function guardarMail(c: ClienteFila, email: string) {
    if (email === c.email) return;
    setGuardando(c.id_control); setMsg(null);
    try {
      await guardar({ id_control: c.id_control, email });
      setFilas((p) => p.map((x) => x.id_control === c.id_control ? { ...x, email } : x));
      setMsg({ t: 'ok', s: `✓ ${c.nombre}: mail guardado` });
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
    setGuardando(null);
  }

  const visibles = verTodos ? filas : filas.filter((c) => c.activo);
  const apagados = filas.length - filas.filter((c) => c.activo).length;

  return (
    <div>
      {apagados > 0 && (
        <p style={{ margin: '0 0 8px', fontSize: '11.5px' }}>
          <button type="button" onClick={() => setVerTodos((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '11.5px', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>
            {verTodos ? 'Ocultar los que no tienen recordatorio' : `Ver los ${apagados} clientes sin recordatorio`}
          </button>
        </p>
      )}
      {visibles.length === 0 && (
        <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#9ca3af' }}>
          Ningún cliente tiene el recordatorio prendido todavía.
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '520px' }}>
          <thead>
            <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, width: '90px' }}>Recordatorio</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, width: '110px' }}>Plazo<br /><span style={{ fontWeight: 400, fontSize: '10px' }}>no se reclama antes de (días)</span></th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Mail de cobranzas</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {visibles.flatMap((c) => [
              <tr key={c.id_control} style={{ borderTop: '1px solid #f3f4f6', opacity: guardando === c.id_control ? 0.5 : 1 }}>
                <td style={{ padding: '6px 8px', fontWeight: c.activo ? 700 : 400 }}>{c.nombre}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <input type="checkbox" checked={c.activo} disabled={guardando !== null}
                    onChange={(e) => togglear(c, e.target.checked)} />
                </td>
                {/* Solo el piso. El tope de antigüedad se sacó: el recordatorio ahora
                    lista TODO lo que figura impago, no una ventana. */}
                <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <input type="number" min={1} defaultValue={c.antiguedad} disabled={guardando !== null}
                    style={{ ...inputStyle, width: '58px', display: 'inline-block', textAlign: 'right' }}
                    onBlur={(e) => guardarAntiguedad(c, e.target.value)} />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input defaultValue={c.email} disabled={guardando !== null} style={inputStyle}
                    placeholder={c.emailGeneral ? `${c.emailGeneral} (el general)` : 'sin mail cargado'}
                    onBlur={(e) => guardarMail(c, e.target.value.trim())} />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {c.activo && (
                    <button onClick={() => enviarAhora(c)} disabled={guardando !== null}
                      title="Manda el recordatorio a este cliente ahora, sin esperar al lunes. Muestra qué saldría antes de mandarlo."
                      style={{ fontSize: '10.5px', padding: '3px 9px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
                      {guardando === c.id_control ? '…' : 'Enviar ahora'}
                    </button>
                  )}
                </td>
              </tr>,
              resultado[c.id_control]?.s ? (
                <tr key={`${c.id_control}-r`}>
                  <td colSpan={5} style={{ padding: '0 8px 7px' }}>
                    <span style={{
                      display: 'inline-block', fontSize: '11.5px', fontWeight: 600, padding: '4px 8px', borderRadius: '5px',
                      color: resultado[c.id_control].t === 'ok' ? '#166534' : '#991b1b',
                      background: resultado[c.id_control].t === 'ok' ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${resultado[c.id_control].t === 'ok' ? '#bbf7d0' : '#fecaca'}`,
                    }}>{resultado[c.id_control].s}</span>
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
      {msg && <p style={{ margin: '8px 0 0', fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>
        <strong>Antigüedad</strong>: la ventana de días en que se reclama una factura. El <em>desde</em> respeta el plazo de pago
        (a un cliente con 30 días no se le reclama una de anteayer) y el <em>hasta</em> evita reclamar facturas viejas que
        probablemente ya estén pagas — mientras la app no sepa qué se cobró, esa es la única defensa. Como la corrida es
        semanal, la ventana tiene que tener al menos {VENTANA_MINIMA_DIAS} días o hay facturas que no van a entrar nunca.
        Si dejás el mail vacío se usa el mail general del cliente. El recordatorio sale los lunes a la mañana, con copia a administración.
      </p>
    </div>
  );
}

export function DatosPago({ valor }: { valor: string }) {
  const [texto, setTexto] = useState(valor);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function salvar() {
    setLoading(true); setMsg(null);
    try {
      await guardar({ datosPago: texto });
      setMsg({ t: 'ok', s: '✓ Guardado' });
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
    setLoading(false);
  }

  return (
    <div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} disabled={loading} rows={6}
        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={salvar} disabled={loading}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Guardando…' : 'Guardar datos de pago'}
        </button>
        {msg && <span style={{ fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</span>}
      </div>
    </div>
  );
}

// Corre el cron a mano. En modo simulación no se manda nada: sirve para ver exactamente a
// quién le llegaría y con qué facturas antes de dejarlo suelto.
export function ProbarRecordatorios() {
  const [loading, setLoading] = useState<'simular' | 'enviar' | null>(null);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function correr(simular: boolean) {
    if (!simular && !confirm('Esto manda los mails de verdad a los clientes. ¿Seguro?')) return;
    setLoading(simular ? 'simular' : 'enviar'); setRes(null); setErr(null);
    try {
      const r = await fetch(`/api/cron/recordatorios-cobro${simular ? '?simular=1' : ''}`);
      const j = await r.json();
      setRes({ ...j, simulado: simular });
    } catch (e: any) { setErr(e.message || 'Error'); }
    setLoading(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => correr(true)} disabled={loading !== null}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
          {loading === 'simular' ? 'Calculando…' : '👁 Ver qué se mandaría (no manda nada)'}
        </button>
        <button onClick={() => correr(false)} disabled={loading !== null}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#b45309', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
          {loading === 'enviar' ? 'Enviando…' : 'Enviar ahora'}
        </button>
      </div>
      {err && <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#dc2626' }}>{err}</p>}
      {res && (
        <div style={{ marginTop: '10px', fontSize: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>
            {res.simulado ? 'Simulación — no se envió nada' : `Enviados: ${res.enviados}`}
          </p>
          {(res.detalle || []).length === 0 && <p style={{ margin: 0, color: '#6b7280' }}>No hay facturas para recordar.</p>}
          {(res.detalle || []).map((d: any, i: number) => (
            <p key={i} style={{ margin: '0 0 3px', color: '#111827' }}>
              <strong>{d.cliente}</strong> — {d.comprobantes} — ${Math.round(d.total).toLocaleString('es-AR')}
            </p>
          ))}
          {(res.omitidos || []).map((o: any, i: number) => (
            <p key={'o' + i} style={{ margin: '3px 0 0', color: '#6b7280' }}>↷ {o.cliente}: {o.motivo}</p>
          ))}
          {(res.sinEmail || []).length > 0 && (
            <p style={{ margin: '3px 0 0', color: '#b45309' }}>⚠ Prendidos sin mail: {res.sinEmail.join(', ')}</p>
          )}
          {(res.errores || []).map((e: string, i: number) => (
            <p key={'e' + i} style={{ margin: '3px 0 0', color: '#dc2626' }}>✕ {e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
