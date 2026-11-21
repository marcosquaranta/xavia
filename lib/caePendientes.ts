import { asegurarHoja, readSheet, updateRow, appendRowObj } from './sheets';
import { clasificar, xubioExponeCae, type PendienteCae } from './caeVerificacion';
import { getComprobantes } from './xubio';

// ── CAEs pendientes: registro + aviso diario acumulado ───────────────────────────────
//
// Al "Cargar ventas" la app emite los comprobantes en Xubio por API, pero el plan actual
// de Xubio no permite pedir el CAE ni enviar la factura por correo desde la API: esos dos
// pasos hay que hacerlos a mano. Antes salía un mail apenas se emitía, así que un día con
// tres cargas eran tres mails; ahora se acumulan y sale uno solo por la mañana.
//
// Cada emisión queda registrada acá, y el aviso marca las filas como avisadas. Con eso:
// una factura entra en exactamente UN mail, y si un día falla el cron no se pierde nada
// (esas filas siguen sin avisar y entran en el aviso siguiente).
//
// ── Ya no se supone: se le pregunta a Xubio ─────────────────────────────────────────
//
// Acá decía que la app no podía saber si el CAE se sacó, y el aviso salía de la hoja: como
// la API no devuelve el CAE al emitir, la fila quedaba vacía para siempre y el aviso la
// reportaba. El CAE se saca DESPUÉS, a mano en Xubio, y la app no se enteraba nunca.
//
// Entonces el mail no decía "falta sacar el CAE". Decía "se emitió y nosotros no vimos el
// CAE", que no es lo mismo y se leía igual. Llegaban avisos de facturas resueltas hacía
// días, y encima imposibles de corregir: pasado un tiempo la numeración correlativa de
// AFIP no deja sacar el CAE de una factura vieja sin tocar las posteriores.
//
// Ahora, antes de avisar, se le piden los comprobantes a Xubio y se mira cuáles tienen CAE
// de verdad (ver lib/caeVerificacion.ts). Las que ya lo tienen se marcan en la hoja y no
// vuelven a aparecer. Las que pasaron el plazo tampoco: pedir algo que no se puede hacer
// es peor que no pedir nada.

export const HOJA_CAE = 'FacturasEmitidas';
export const HEADERS_CAE = ['id_emision', 'fecha_emision', 'fecha_venta', 'cliente', 'numero', 'cae', 'avisado'];

export interface FacturaEmitida {
  id_emision: string;
  fecha_emision: string; // ISO — cuándo se emitió en Xubio
  fecha_venta: string;   // YYYY-MM-DD de la venta facturada
  cliente: string;
  numero: string;
  cae: string;           // vacío = Xubio no lo devolvió (lo normal en este plan)
  avisado: string;       // 'SI' cuando ya salió en un aviso
}

// Registra las facturas recién emitidas. No tira error hacia afuera: si esto falla, la
// venta ya se facturó igual y no tiene sentido romper la carga por el registro del aviso.
export async function registrarEmitidas(
  emitidas: { cliente: string; numero?: string; cae?: string; fechaVenta: string }[],
): Promise<void> {
  if (!emitidas.length) return;
  try {
    await asegurarHoja(HOJA_CAE, HEADERS_CAE);
    const ahora = new Date().toISOString();
    const previas = await readSheet<FacturaEmitida>(HOJA_CAE).catch(() => []);
    let seq = previas.reduce((acc, f) => Math.max(acc, parseInt(String(f.id_emision).replace(/\D/g, ''), 10) || 0), 0);
    for (const e of emitidas) {
      seq++;
      await appendRowObj(HOJA_CAE, {
        id_emision: `EM-${String(seq).padStart(5, '0')}`,
        fecha_emision: ahora,
        fecha_venta: String(e.fechaVenta || '').split(/[T ]/)[0],
        cliente: e.cliente,
        numero: e.numero || '',
        cae: e.cae || '',
        avisado: '',
      });
    }
  } catch (err) {
    console.error('[caePendientes] no se pudo registrar la emisión:', err);
  }
}

function fmtFecha(iso: string): string {
  const [y, m, d] = String(iso || '').split(/[T ]/)[0].split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso || '');
}

export interface ResultadoAvisoCae {
  ok: boolean; error?: string; pendientes?: number; sinAvisar?: number;
  resueltas?: number; fueraDePlazo?: number; noVerificado?: number; motivo?: string;
}

// Hasta cuántos días después de la venta tiene sentido reclamar el CAE. Pasado eso, la
// numeración correlativa de AFIP no deja sacarlo sin tocar los comprobantes posteriores:
// el aviso pediría algo que no se puede hacer, y un pedido imposible enseña a ignorar el
// mail entero.
const DIAS_PARA_SACAR_CAE = 5;

const fechaHoy = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function correrDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Aviso diario con TODO lo emitido que todavía no se avisó. Si no hay nada, no manda
// nada: un mail diario que dice "no hay pendientes" se vuelve ruido y se deja de leer.
export async function enviarAvisoCaeAcumulado(): Promise<ResultadoAvisoCae> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const filas = await readSheet<FacturaEmitida>(HOJA_CAE).catch(() => [] as FacturaEmitida[]);
    // Las que ya tienen CAE anotado no necesitan aviso: no hay nada que hacer con ellas.
    const candidatas = filas.filter((f) => String(f.avisado || '').toUpperCase() !== 'SI' && !String(f.cae || '').trim());
    if (!candidatas.length) return { ok: true, pendientes: 0 };

    // ── Preguntarle a Xubio antes de afirmar nada ───────────────────────────────────
    //
    // Se pide el rango que cubre las candidatas, con un margen: la factura puede haberse
    // emitido con la fecha del día anterior (AFIP corre el correlativo) y quedaría fuera.
    const fechas = candidatas.map((f) => String(f.fecha_venta || '').split(/[T ]/)[0]).filter(Boolean).sort();
    const hoyISO = fechaHoy();
    const desde = fechas.length ? correrDias(fechas[0], -3) : correrDias(hoyISO, -30);
    const comprobantes = await getComprobantes(desde, hoyISO).catch(() => null);

    // Xubio no contestó. No se avisa nada: mandar la lista entera "por las dudas" es
    // exactamente el mail que venía llegando, ahora con una verificación que no pasó.
    if (!comprobantes) {
      return { ok: true, pendientes: 0, noVerificado: candidatas.length,
        motivo: 'Xubio no contestó: no se avisa nada hasta poder verificar cuáles tienen CAE.' };
    }

    // El campo no vino en NINGUNO. No es que falten todos: es que el dato no está. Avisar
    // acá sería repetir el error de antes con cara de verificado.
    if (!xubioExponeCae(comprobantes)) {
      return { ok: true, pendientes: 0, noVerificado: candidatas.length,
        motivo: 'Xubio no devuelve el CAE por API en este plan: no se puede saber cuáles faltan, así que no se avisa.' };
    }

    const cls = clasificar(
      candidatas.map((f) => ({
        id_emision: String(f.id_emision), numero: String(f.numero || ''),
        cliente: String(f.cliente || ''), fecha_venta: String(f.fecha_venta || ''),
      })) as PendienteCae[],
      comprobantes, hoyISO, DIAS_PARA_SACAR_CAE,
    );

    // Las que ya tienen CAE: se anota y no vuelven a mirarse. Es el caso que generaba el
    // aviso falso, y ahora se cierra solo.
    for (const r of cls.resueltas) {
      await updateRow(HOJA_CAE, 'id_emision', r.fila.id_emision, { cae: r.cae, avisado: 'SI' }).catch(() => false);
    }
    // Las que ya no se pueden arreglar: se marcan avisadas para que no vuelvan, con el CAE
    // vacío, que es la verdad — no se sacó y ya no se va a sacar.
    for (const f of cls.fueraDePlazo) {
      await updateRow(HOJA_CAE, 'id_emision', f.id_emision, { avisado: 'SI' }).catch(() => false);
    }

    const pendientes = candidatas.filter((f) =>
      cls.faltan.some((x) => x.id_emision === String(f.id_emision))
      || cls.sinRastroEnXubio.some((x) => x.id_emision === String(f.id_emision)));
    if (!pendientes.length) {
      return { ok: true, pendientes: 0,
        resueltas: cls.resueltas.length, fueraDePlazo: cls.fueraDePlazo.length };
    }

    // Agrupadas por día de venta: así se lee "de la venta del 27 faltan estas tres".
    const porDia = new Map<string, FacturaEmitida[]>();
    for (const f of pendientes) {
      const k = String(f.fecha_venta || '').split(/[T ]/)[0] || 'sin fecha';
      if (!porDia.has(k)) porDia.set(k, []);
      porDia.get(k)!.push(f);
    }
    const dias = [...porDia.keys()].sort();

    const bloques = dias.map((d) => {
      const filasDia = porDia.get(d)!;
      const rows = filasDia.map((f) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.cliente}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.numero || '—'}</td>
        </tr>`).join('');
      return `
      <p style="margin:16px 0 6px;font-size:13px;font-weight:700">Ventas del ${fmtFecha(d)} <span style="font-weight:400;color:#888">· ${filasDia.length} comprobante(s)</span></p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Cliente</th>
          <th style="padding:6px 10px;text-align:left">Comprobante</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('');

    const hoyFmt = fmtFecha(new Date().toISOString());
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px">
        <h2 style="margin:0 0 4px">CAEs pendientes — ${hoyFmt}</h2>
        <p style="margin:0 0 14px;color:#555">
          <strong>${pendientes.length}</strong> comprobante(s) que Xubio confirma que <strong>todavía no tienen CAE</strong>
          —no es "no lo vimos": se le preguntó—. En Xubio → Comprobantes de venta, seleccionalos y:
        </p>
        <ol style="margin:0 0 4px;color:#333">
          <li>Obtener CAE (las Factura A)</li>
          <li>Enviar por correo</li>
        </ol>
        ${bloques}
        ${cls.sinRastroEnXubio.length ? `
        <p style="margin:16px 0 0;padding:9px 11px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:12.5px;color:#b91c1c">
          <strong>${cls.sinRastroEnXubio.length} comprobante(s) que la app emitió y Xubio no tiene</strong>
          (${cls.sinRastroEnXubio.map((x) => x.numero).join(', ')}). Eso no es un CAE que falta: es una factura que no está
          del otro lado, y hay que mirarla.
        </p>` : ''}
        ${cls.fueraDePlazo.length ? `
        <p style="margin:12px 0 0;font-size:11.5px;color:#92400e">
          Otros ${cls.fueraDePlazo.length} siguen sin CAE pero ya pasaron los ${DIAS_PARA_SACAR_CAE} días: la numeración
          correlativa no deja sacarlo sin tocar las posteriores, así que no se reclaman más.
        </p>` : ''}
        <p style="margin:16px 0 0;font-size:11px;color:#999">
          Aviso diario. Se le pregunta a Xubio antes de mandarlo: las que ya tienen CAE no aparecen.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `CAEs pendientes — ${pendientes.length} comprobante(s) — ${hoyFmt}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Sin marcar: si el mail no salió, tienen que entrar en el aviso siguiente.
      return { ok: false, error: (err as any).message || `HTTP ${res.status}`, sinAvisar: pendientes.length };
    }

    // Marcar recién DESPUÉS de que el mail salió bien.
    for (const f of pendientes) {
      await updateRow(HOJA_CAE, 'id_emision', String(f.id_emision), { avisado: 'SI' });
    }
    return { ok: true, pendientes: pendientes.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al armar el aviso de CAEs' };
  }
}


// ── Ver qué diría el aviso, sin mandarlo ─────────────────────────────────────────────
//
// Existe por una razón concreta: la verificación nueva depende de que Xubio devuelva el
// CAE por API, y eso no estaba comprobado cuando se escribió — el código anterior daba por
// sentado que NO. Esto deja confirmarlo en treinta segundos y sin mandarle un mail a
// nadie, en vez de esperar a mañana para ver si el aviso vino bien.
//
// Devuelve también `campos_del_primero`: si Xubio no expone el CAE, ahí se ve con qué
// nombre viene cada cosa y se corrige `caeDe` sin adivinar.
export async function diagnosticoCae(): Promise<any> {
  const filas = await readSheet<FacturaEmitida>(HOJA_CAE).catch(() => [] as FacturaEmitida[]);
  const candidatas = filas.filter((f) => String(f.avisado || '').toUpperCase() !== 'SI' && !String(f.cae || '').trim());
  const fechas = candidatas.map((f) => String(f.fecha_venta || '').split(/[T ]/)[0]).filter(Boolean).sort();
  const hoyISO = fechaHoy();
  const desde = fechas.length ? correrDias(fechas[0], -3) : correrDias(hoyISO, -30);
  const comprobantes = await getComprobantes(desde, hoyISO).catch(() => null);

  if (!comprobantes) {
    return { hoy: hoyISO, desde, candidatas: candidatas.length, xubio: 'no contestó', se_avisaria: 0 };
  }
  const expone = xubioExponeCae(comprobantes);
  const cls = clasificar(
    candidatas.map((f) => ({
      id_emision: String(f.id_emision), numero: String(f.numero || ''),
      cliente: String(f.cliente || ''), fecha_venta: String(f.fecha_venta || ''),
    })) as PendienteCae[],
    comprobantes, hoyISO, DIAS_PARA_SACAR_CAE,
  );
  return {
    hoy: hoyISO, desde,
    comprobantes_en_xubio: comprobantes.length,
    xubio_devuelve_cae: expone,
    candidatas: candidatas.length,
    ya_tienen_cae: cls.resueltas.map((r) => ({ numero: r.fila.numero, cae: r.cae })),
    faltan_de_verdad: cls.faltan.map((f) => ({ numero: f.numero, cliente: f.cliente, fecha: f.fecha_venta })),
    fuera_de_plazo: cls.fueraDePlazo.map((f) => ({ numero: f.numero, fecha: f.fecha_venta })),
    sin_rastro_en_xubio: cls.sinRastroEnXubio.map((f) => f.numero),
    se_avisaria: expone ? cls.faltan.length + cls.sinRastroEnXubio.length : 0,
    // Para poder arreglar `caeDe` si el campo viene con otro nombre, sin adivinar.
    campos_del_primero: comprobantes[0] ? Object.keys(comprobantes[0]) : [],
  };
}
