import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { RegistroProtocolo, ConfigItem } from '@/lib/types';
import {
  HOJA_REGISTROS, leerConfigProtocolo, tareasVencidas, tareaPorId,
  alarmaOsmosis, fueraDeRangoFoliar, evaluarDosis, evaluarInstrumental,
  resumenMedicion, sumarDias, CONDICIONES_TXT,
} from '@/lib/protocoloTareas';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Protocolo y aplicaciones, los viernes ────────────────────────────────────────────
//
// Lo que había: las tareas sin registrar salían como un renglón del reporte semanal, y las
// mediciones fuera de rango como una alerta suelta el día que pasaban. Nada juntaba la
// semana entera — qué se aplicó, con qué dosis, en qué condiciones y qué dio cada control.
//
// Eso importa por dos motivos distintos. Uno es de gestión: si el pH del agua viene subiendo
// tres semanas seguidas, eso no se ve mirando cada día por separado. El otro es de
// respaldo: una aplicación foliar es un producto fitosanitario sobre algo que se come, y el
// registro de qué se aplicó y en qué condiciones es lo que queda si alguien pregunta.
//
// Va los VIERNES: la semana ya pasó entera y todavía hay un día hábil para corregir lo que
// quedó sin hacer.
const CLAVE_CONFIG = 'email_protocolo_semanal';
const URL_PROTOCOLO = 'https://xavia-self.vercel.app/protocolo';

const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };
const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [registros, configRows] = await Promise.all([
      readSheet<RegistroProtocolo>(HOJA_REGISTROS).catch(() => [] as RegistroProtocolo[]),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const hoy = fechaArgentinaHoy();
    const desde = sumarDias(hoy, -6);   // los últimos 7 días, hoy incluido
    const cfg = leerConfigProtocolo(configRows as any);

    // Lo que se registró en la semana, de lo más nuevo a lo más viejo.
    const dela = registros
      .filter((r) => {
        const f = String(r.fecha || '').split(/[T ]/)[0];
        return f >= desde && f <= hoy;
      })
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.hora || '').localeCompare(String(a.hora || '')));

    const ejecuciones = dela.filter((r) => String(r.tipo_registro) !== 'decision');

    // ── Lo que quedó sin hacer ──
    //
    // Misma función que la pantalla: si acá se calculara con otro criterio, el mail y la
    // pantalla dirían cosas distintas sobre la misma semana.
    const vencidas = tareasVencidas(cfg, registros, hoy, 14);

    // ── Las alertas de la semana ──
    //
    // Tres cosas distintas, que se arreglan distinto y por eso van separadas:
    //  · el agua de ósmosis fuera de límite (conductividad o pH);
    //  · una foliar aplicada con temperatura o humedad fuera de rango;
    //  · una dosis que no es la que corresponde.
    const alertas: { fecha: string; tarea: string; tipo: string; detalle: string; grave: boolean }[] = [];
    for (const r of ejecuciones) {
      const t = tareaPorId(String(r.id_tarea));
      const nombre = t?.nombre || String(r.id_tarea);
      const fecha = String(r.fecha || '').split(/[T ]/)[0];

      const os = alarmaOsmosis((r as any).conductividad, (r as any).ph);
      if (os.alarma) alertas.push({ fecha, tarea: nombre, tipo: 'Agua de ósmosis', detalle: os.motivos.join(' · '), grave: true });

      if (t?.condicionesFoliares && fueraDeRangoFoliar((r as any).temperatura, (r as any).humedad)) {
        alertas.push({
          fecha, tarea: nombre, tipo: 'Condiciones de aplicación',
          detalle: `se aplicó con ${n((r as any).temperatura) ?? '?'} °C y ${n((r as any).humedad) ?? '?'}% de humedad`,
          grave: true,
        });
      }

      if (t?.producto) {
        const d = evaluarDosis(t.producto, n((r as any).litros) || 0, n((r as any).dosis) || 0);
        if (d && d.estado !== 'ok') {
          alertas.push({
            fecha, tarea: nombre, tipo: 'Dosis',
            detalle: `se cargó ${(r as any).dosis} y correspondían ${d.esperada} ${d.unidad} (${d.desvioPct > 0 ? '+' : ''}${d.desvioPct}%)`,
            grave: d.estado === 'sobre',
          });
        }
      }

      // El chequeo devuelve { hayQueCalibrar, motivos }. Lo tenía escrito contra campos
      // que no existen (`ok`, `motivo`) y el `as any` lo dejaba compilar: la alerta de
      // calibración no se habría disparado nunca y nadie se habría enterado de que faltaba.
      const inst = evaluarInstrumental({ ph4: (r as any).ph4, ph7: (r as any).ph7, conductividad_patron: (r as any).conductividad_patron });
      if (inst.hayQueCalibrar) {
        alertas.push({
          fecha, tarea: nombre, tipo: 'Calibración',
          detalle: inst.motivos.join(' · ') || 'el instrumental quedó fuera de tolerancia',
          grave: false,
        });
      }
    }

    if (new URL(req.url).searchParams.get('ver') === '1') {
      return NextResponse.json({ hoy, desde, ejecuciones: ejecuciones.length, vencidas: vencidas.length, alertas });
    }

    // Sin nada que contar —ni una aplicación, ni un vencimiento, ni una alerta— no se
    // manda: pasa en una semana de parate, y un mail vacío todas las semanas se archiva
    // sin abrir.
    if (!ejecuciones.length && !vencidas.length && !alertas.length) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'no hubo actividad de protocolo esta semana' });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, configRows);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const filasReg = ejecuciones.map((r) => {
      const t = tareaPorId(String(r.id_tarea));
      const med = resumenMedicion(r);
      return `<tr>
        <td style="padding:7px 9px;border-bottom:1px solid #f0f0f0;white-space:nowrap;font-size:12px">
          ${fmtDia(String(r.fecha))}${r.hora ? `<br><span style="color:#9ca3af;font-size:10.5px">${r.hora}</span>` : ''}
        </td>
        <td style="padding:7px 9px;border-bottom:1px solid #f0f0f0;font-size:12.5px">
          <strong>${t?.nombre || r.id_tarea}</strong>
          ${(r as any).producto ? `<br><span style="color:#6b7280;font-size:11px">${(r as any).producto}${(r as any).dosis ? ` · dosis ${(r as any).dosis}` : ''}${(r as any).litros ? ` · ${(r as any).litros} L` : ''}</span>` : ''}
        </td>
        <td style="padding:7px 9px;border-bottom:1px solid #f0f0f0;font-size:11.5px;color:#374151">${med || '—'}</td>
        <td style="padding:7px 9px;border-bottom:1px solid #f0f0f0;font-size:11.5px;color:#6b7280;white-space:nowrap">${r.responsable || '—'}</td>
      </tr>`;
    }).join('');

    const filasAlerta = alertas.map((a) => `<tr>
      <td style="padding:6px 9px;border-bottom:1px solid #fee2e2;white-space:nowrap;font-size:11.5px;color:${a.grave ? '#b91c1c' : '#92400e'}">${fmtDia(a.fecha)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #fee2e2;font-size:11.5px;font-weight:700;color:${a.grave ? '#b91c1c' : '#92400e'}">${a.tipo}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #fee2e2;font-size:11.5px;color:#374151">${a.tarea} — ${a.detalle}</td>
    </tr>`).join('');

    const filasVenc = vencidas.slice(0, 12).map((v) => `<li style="margin-bottom:3px">
      <strong>${v.tarea.nombre}</strong> — correspondía el ${fmtDia(v.fecha)}${v.venciaEl ? ` (vencía el ${fmtDia(v.venciaEl)})` : ''}
    </li>`).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:720px">
        <h2 style="margin:0 0 4px">Protocolo y aplicaciones — semana del ${fmtDia(desde)} al ${fmtDia(hoy)}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          ${ejecuciones.length} ${ejecuciones.length === 1 ? 'registro' : 'registros'} en la semana${alertas.length ? ` · <strong style="color:#b91c1c">${alertas.length} ${alertas.length === 1 ? 'alerta' : 'alertas'}</strong>` : ''}${vencidas.length ? ` · ${vencidas.length} sin registrar` : ''}.
        </p>

        ${alertas.length ? `
        <h3 style="margin:0 0 6px;font-size:14px;color:#b91c1c">Para mirar</h3>
        <table style="border-collapse:collapse;width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:7px">
          <tbody>${filasAlerta}</tbody>
        </table>` : `
        <p style="margin:0 0 14px;font-size:13px;color:#166534">✓ Ninguna medición quedó fuera de rango esta semana.</p>`}

        ${vencidas.length ? `
        <h3 style="margin:22px 0 6px;font-size:14px;color:#92400e">Quedó sin registrar</h3>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#78350f">${filasVenc}</ul>
        ${vencidas.length > 12 ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af">y ${vencidas.length - 12} más.</p>` : ''}
        <p style="margin:6px 0 0;font-size:11.5px;color:#9ca3af">
          Sin registro no se puede verificar si se aplicó ni en qué condiciones. Si se hizo, se carga con la fecha real.
        </p>` : ''}

        <h3 style="margin:22px 0 6px;font-size:14px">Lo que se hizo</h3>
        ${ejecuciones.length ? `
        <table style="border-collapse:collapse;width:100%">
          <thead><tr style="background:#f9fafb;color:#6b7280;font-size:10.5px;text-transform:uppercase">
            <th style="padding:5px 9px;text-align:left">Cuándo</th>
            <th style="padding:5px 9px;text-align:left">Tarea</th>
            <th style="padding:5px 9px;text-align:left">Mediciones</th>
            <th style="padding:5px 9px;text-align:left">Responsable</th>
          </tr></thead>
          <tbody>${filasReg}</tbody>
        </table>` : '<p style="margin:0;font-size:12.5px;color:#9ca3af">No se registró ninguna aplicación ni control esta semana.</p>'}

        <p style="margin:18px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
          <strong>Condiciones para foliares:</strong> ${CONDICIONES_TXT}
          <br>Este informe es también el respaldo de qué se aplicó y en qué condiciones: una foliar es un producto
          sobre algo que se come, y el registro es lo que queda si alguien pregunta.
        </p>

        <p style="margin:18px 0 0">
          <a href="${URL_PROTOCOLO}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir Protocolo
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: alertas.length
          ? `Protocolo — ${alertas.length} ${alertas.length === 1 ? 'alerta' : 'alertas'} esta semana`
          : `Protocolo — ${ejecuciones.length} ${ejecuciones.length === 1 ? 'registro' : 'registros'}${vencidas.length ? ` y ${vencidas.length} sin registrar` : ''}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, hoy, registros: ejecuciones.length, alertas: alertas.length, vencidas: vencidas.length, destinatarios });
  } catch (err: any) {
    console.error('[cron/protocolo-semanal] error:', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
