import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, appendRowsObj, asegurarHoja, readSheet, updateRow } from '@/lib/sheets';
import { parsearFilasBanco } from '@/lib/importacionBanco';
import {
  HOJA_BANDEJA, HEADERS_BANDEJA, HOJA_ALIAS, HEADERS_ALIAS,
  proponerCliente, aliasDesdeDescripcion, nuevoIdItem, normalizarNombre,
  type ItemBandeja, type AliasCobranza,
} from '@/lib/bandejaCobranzas';
import { registrarCobro } from '@/lib/cobros';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Importar un resumen bancario ─────────────────────────────────────────────────────
//
// Recibe el archivo (CSV o Excel) y deja en la bandeja los movimientos de ENTRADA que
// todavía no estén. No imputa nada: cada fila queda pendiente de que una persona confirme
// de quién es y qué factura cancela.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede importar el resumen.' }, { status: 403 });
  try {
    const form = await req.formData();
    const archivo = form.get('archivo');
    if (!(archivo instanceof File)) return NextResponse.json({ error: 'Falta el archivo del resumen.' }, { status: 400 });

    const buf = Buffer.from(await archivo.arrayBuffer());
    // cellDates: las fechas vuelven como Date en vez del número de serie de Excel, que es
    // más fácil de leer mal. raw: false en las celdas de texto conserva lo que se ve.
    let filas: any[][];
    try {
      const wb = XLSX.read(buf, { cellDates: true });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      if (!hoja) throw new Error('El archivo no tiene ninguna hoja.');
      filas = XLSX.utils.sheet_to_json<any[]>(hoja, { header: 1, blankrows: false, defval: '' });
    } catch (e: any) {
      return NextResponse.json({ error: `No se pudo leer el archivo: ${e?.message || 'formato no reconocido'}. Probá exportando el resumen como CSV o Excel.` }, { status: 400 });
    }

    const parseado = parsearFilasBanco(filas);

    await asegurarHoja(HOJA_BANDEJA, HEADERS_BANDEJA);
    const [previos, clientes, aliases] = await Promise.all([
      readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]),
    ]);

    // Los movimientos que ya están no se vuelven a cargar. Pasa siempre: los períodos que
    // se bajan del banco se superponen, y sin esto cada importación duplicaría la anterior.
    const yaEstan = new Set(previos.map(p => String(p.hash)));
    const nuevos = parseado.movimientos.filter(m => !yaEstan.has(m.hash));

    const hoy = fechaArgentinaHoy();
    const acumulados = [...previos];
    const aInsertar: Record<string, any>[] = [];
    let reconocidos = 0;
    for (const m of nuevos) {
      const cand = proponerCliente(m.descripcion, clientes, aliases);
      if (cand) reconocidos++;
      const id = nuevoIdItem(acumulados);
      const fila: Record<string, any> = {
        id_item: id,
        fecha_importacion: hoy,
        origen: 'banco',
        fecha: m.fecha,
        importe: Math.round(m.importe * 100) / 100,
        descripcion: m.descripcion,
        hash: m.hash,
        id_control: cand?.id_control || '',
        cliente: cand?.cliente || '',
        comprobantes: '',
        estado: 'pendiente',
        id_cobro: '',
        usuario: user.email,
        nota: cand ? `reconocido por ${cand.confianza}` : '',
      };
      aInsertar.push(fila);
      acumulados.push(fila as ItemBandeja);
    }
    // Todas juntas: un resumen son decenas de movimientos, y una escritura por fila se come
    // el límite de consultas por minuto de Sheets y tarda muchísimo más.
    await appendRowsObj(HOJA_BANDEJA, aInsertar);

    return NextResponse.json({
      ok: true,
      nuevos: nuevos.length,
      repetidos: parseado.movimientos.length - nuevos.length,
      reconocidos,
      salidas: parseado.salidas,
      filasLeidas: parseado.filasLeidas,
      columnas: parseado.columnas,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

// ── Confirmar o descartar un item ────────────────────────────────────────────────────
//
// Confirmar registra el cobro en Xubio por el mismo camino que la carga manual y, si el
// cliente se eligió a mano, aprende el alias para que la próxima transferencia del mismo
// ordenante se reconozca sola.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede confirmar cobros.' }, { status: 403 });
  try {
    const body = await req.json();
    const idItem = String(body.id_item || '').trim();
    const accion = String(body.accion || '').trim();
    if (!idItem) return NextResponse.json({ error: 'Falta el item.' }, { status: 400 });

    const items = await readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]);
    const item = items.find(i => String(i.id_item) === idItem);
    if (!item) return NextResponse.json({ error: 'No se encontró ese movimiento en la bandeja.' }, { status: 404 });
    if (String(item.estado) !== 'pendiente') {
      return NextResponse.json({ error: `Ese movimiento ya está ${item.estado}.` }, { status: 400 });
    }

    if (accion === 'descartar') {
      await updateRow(HOJA_BANDEJA, 'id_item', idItem, {
        estado: 'descartado',
        nota: String(body.nota || 'descartado a mano'),
        usuario: user.email,
      });
      return NextResponse.json({ ok: true, estado: 'descartado' });
    }

    // Confirmar.
    const idControl = String(body.id_control || item.id_control || '').trim();
    const cuentaId = Number(body.cuentaId);
    const comprobantes: string[] = Array.isArray(body.comprobantes) ? body.comprobantes.map(String) : [];
    if (!idControl) return NextResponse.json({ error: 'Elegí de qué cliente es este cobro.' }, { status: 400 });

    const r = await registrarCobro({
      idControl,
      fecha: String(item.fecha),
      importe: Number(item.importe),
      cuentaId,
      observacion: `Importado del resumen bancario — ${String(item.descripcion).slice(0, 120)}`,
      comprobantes,
      usuario: user.email,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 500 });

    const clientes = await readSheet<ClienteVenta>('Clientes');
    const cli = clientes.find(c => String(c.id_control) === idControl);
    await updateRow(HOJA_BANDEJA, 'id_item', idItem, {
      estado: 'confirmado',
      id_control: idControl,
      cliente: cli?.nombre_display || cli?.nombre_xubio || '',
      comprobantes: comprobantes.join(', '),
      id_cobro: r.idCobro || '',
      usuario: user.email,
    });

    // Aprender el alias: solo tiene sentido si el ordenante no se reconocía solo. Se guarda
    // el texto que identifica (sin el ruido bancario ni los números de operación), así la
    // próxima transferencia del mismo pagador entra ya reconocida.
    let aliasAprendido = '';
    try {
      const alias = aliasDesdeDescripcion(String(item.descripcion));
      if (alias.length >= 4) {
        await asegurarHoja(HOJA_ALIAS, HEADERS_ALIAS);
        const aliases = await readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]);
        const existe = aliases.some(a =>
          normalizarNombre(a.alias) === normalizarNombre(alias) && String(a.id_control) === idControl);
        if (!existe) {
          await appendRowObj(HOJA_ALIAS, {
            alias, id_control: idControl,
            cliente: cli?.nombre_display || cli?.nombre_xubio || '',
            fecha_aprendido: fechaArgentinaHoy(),
            usuario: user.email,
          });
          aliasAprendido = alias;
        }
      }
    } catch (e) {
      // Que no se pueda guardar el alias no invalida el cobro, que ya está en Xubio.
      console.error('[bandeja] no se pudo aprender el alias:', e);
    }

    return NextResponse.json({ ok: true, estado: 'confirmado', id_cobro: r.idCobro, numeroRecibo: r.numeroRecibo, aliasAprendido });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
