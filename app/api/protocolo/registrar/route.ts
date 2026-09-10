import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarHoja, readSheet, updateRow } from '@/lib/sheets';
import {
  validarRegistro, calcularFueraDeRango, alarmaOsmosis, tareaPorId,
  ALARMA_CONDUCTIVIDAD, ALARMA_PH, HOJA_REGISTROS, HEADERS_REGISTROS, type DatosRegistro,
} from '@/lib/protocoloTareas';
import type { RegistroProtocolo } from '@/lib/types';

// Destinatarios de la alarma de agua de ósmosis. Editable desde la planilla
// (Configuracion → protocolo_alarma_emails, separados por coma) para no tener que tocar
// código cuando cambie quién tiene que enterarse.
const CONFIG_EMAILS = 'protocolo_alarma_emails';
const EMAILS_DEFAULT = ['administracion@xavia.com.ar'];

async function destinatariosAlarma(): Promise<string[]> {
  try {
    const filas = await readSheet<{ clave: string; valor: any }>('Configuracion');
    const fila = filas.find((f) => String(f.clave).trim() === CONFIG_EMAILS);
    const lista = String(fila?.valor || '').split(',').map((s) => s.trim()).filter((s) => s.includes('@'));
    return lista.length ? lista : EMAILS_DEFAULT;
  } catch {
    return EMAILS_DEFAULT;
  }
}

// La alarma no puede quedar solo en la pantalla del que cargó la medición: el sentido es
// que Marcelo y Marcos se enteren aunque no estén mirando la app. Si el mail falla, el
// registro se guarda igual y la respuesta lo dice — perder el dato sería peor.
async function avisarAlarmaOsmosis(datos: DatosRegistro, motivos: string[], usuario: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const to = await destinatariosAlarma();
  const detalle = motivos.map((m) => `<li>${m}</li>`).join('');
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 6px;color:#dc2626">Alarma — agua de ósmosis inversa</h2>
      <p style="margin:0 0 14px;color:#6b7280;font-size:13px">Medición del ${datos.fecha} a las ${datos.hora} · ${datos.responsable}</p>
      <ul style="font-size:14px;color:#111">${detalle}</ul>
      <p style="font-size:13px;color:#374151">Límites del protocolo: conductividad ${ALARMA_CONDUCTIVIDAD} mS/cm · pH ${ALARMA_PH}.</p>
      ${datos.notas ? `<p style="font-size:13px;color:#374151">Notas: ${datos.notas}</p>` : ''}
      <p style="font-size:12px;color:#9ca3af">Cargado por ${usuario} desde XaviaApp.</p>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to,
        subject: `⚠ Agua de ósmosis fuera de rango — ${datos.fecha}`,
        html,
        text: `Alarma agua de ósmosis (${datos.fecha} ${datos.hora}, ${datos.responsable}): ${motivos.join(' · ')}. Límites: conductividad ${ALARMA_CONDUCTIVIDAD} mS/cm, pH ${ALARMA_PH}.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const datos: DatosRegistro = {
      id_tarea: String(body.id_tarea || ''),
      tipo_registro: body.tipo_registro === 'decision' ? 'decision' : 'ejecucion',
      fecha: String(body.fecha || ''),
      hora: body.hora ? String(body.hora) : '',
      responsable: body.responsable ? String(body.responsable) : '',
      estado: body.estado === 'no_aplica' ? 'no_aplica' : 'hecha',
      producto: body.producto ? String(body.producto) : '',
      dosis: body.dosis ? String(body.dosis) : '',
      temperatura: body.temperatura ?? '',
      humedad: body.humedad ?? '',
      ph: body.ph ?? '',
      conductividad: body.conductividad ?? '',
      notas: body.notas ? String(body.notas) : '',
    };

    const tarea = tareaPorId(datos.id_tarea);
    if (!tarea) return NextResponse.json({ error: 'La tarea no existe.' }, { status: 400 });

    // La aplicación del sábado la define Marcelo, no el operario: la decisión queda
    // restringida a admin. Ejecutarla, en cambio, la puede registrar cualquiera.
    if (datos.tipo_registro === 'decision' && user.rol !== 'admin') {
      return NextResponse.json({ error: 'Solo un administrador puede definir la aplicación del sábado.' }, { status: 403 });
    }

    const faltan = validarRegistro(datos);
    if (faltan.length) {
      return NextResponse.json({ error: `Falta completar: ${faltan.join(', ')}.`, faltan }, { status: 400 });
    }

    await asegurarHoja(HOJA_REGISTROS, HEADERS_REGISTROS);
    const previos = await readSheet<RegistroProtocolo>(HOJA_REGISTROS).catch(() => [] as RegistroProtocolo[]);

    const fueraDeRango = calcularFueraDeRango(datos);
    const fila = {
      id_tarea: datos.id_tarea,
      tipo_registro: datos.tipo_registro,
      fecha: datos.fecha,
      hora: datos.hora || '',
      responsable: datos.responsable || '',
      estado: datos.estado || 'hecha',
      producto: datos.producto || tarea.producto || '',
      dosis: datos.dosis || '',
      temperatura: datos.temperatura ?? '',
      humedad: datos.humedad ?? '',
      ph: datos.ph ?? '',
      conductividad: datos.conductividad ?? '',
      fuera_de_rango: fueraDeRango ? 'SI' : 'NO',
      notas: datos.notas || '',
      usuario: user.email,
      creado: new Date().toISOString(),
    };

    // Una tarea tiene un solo registro por día: si ya existe (se corrige un dato, o se
    // cambia la decisión del sábado), se pisa la fila en vez de sumar una segunda, que
    // dejaría el cumplimiento contando dos veces lo mismo.
    const existente = previos.find(
      (r) => r.id_tarea === datos.id_tarea
        && String(r.tipo_registro) === datos.tipo_registro
        && String(r.fecha || '').split(/[T ]/)[0] === datos.fecha,
    );

    let id_registro: string;
    if (existente) {
      id_registro = String(existente.id_registro);
      await updateRow(HOJA_REGISTROS, 'id_registro', id_registro, fila);
    } else {
      const maxId = previos.reduce((acc, r) => Math.max(acc, parseInt(String(r.id_registro).replace('PR-', '')) || 0), 0);
      id_registro = `PR-${String(maxId + 1).padStart(5, '0')}`;
      await appendRowObj(HOJA_REGISTROS, { id_registro, ...fila });
    }

    // Alarma del agua de ósmosis: se avisa por mail además de quedar marcada en la fila.
    let alarmaEnviada: boolean | null = null;
    let motivosAlarma: string[] = [];
    if (datos.id_tarea === 'control_osmosis' && datos.estado !== 'no_aplica') {
      const { alarma, motivos } = alarmaOsmosis(datos.conductividad, datos.ph);
      if (alarma) {
        motivosAlarma = motivos;
        alarmaEnviada = await avisarAlarmaOsmosis(datos, motivos, user.nombre || user.email);
      }
    }

    return NextResponse.json({
      ok: true, id_registro, fuera_de_rango: fueraDeRango,
      alarma: motivosAlarma.length > 0, motivos: motivosAlarma, alarmaEnviada,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
