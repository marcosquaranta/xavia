import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  HOJA_RECORDATORIOS, COL_ACTIVO, COL_EMAIL, CONFIG_DATOS_PAGO, DATOS_PAGO_DEFAULT,
  ANTIGUEDAD_DEFAULT, ANTIGUEDAD_HASTA_DEFAULT, COL_ANTIGUEDAD, COL_ANTIGUEDAD_HASTA, type RecordatorioCobro,
} from '@/lib/recordatoriosCobro';
import { nombreClienteVisible } from '@/lib/clientes';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import { getCuentas, getCobranzas, getComprobantes, type CuentaXubio } from '@/lib/xubio';
import { facturasPorCliente, type FacturaCliente } from '@/lib/facturasCliente';
import { cuentasFaltantes } from '@/lib/cuentasCobro';
import { sugerirCombinaciones } from '@/lib/conciliacionCobro';
import { claveComprobante } from '@/lib/comprobantes';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import { ClientesRecordatorio, DatosPago, type ClienteFila } from '@/components/CobranzasConfig';
import RegistrarCobro from '@/components/RegistrarCobro';
import BandejaCobranzas from '@/components/BandejaCobranzas';
import { HOJA_BANDEJA, HOJA_ALIAS, type ItemBandeja, type AliasCobranza } from '@/lib/bandejaCobranzas';
import ReclamoManual from '@/components/ReclamoManual';
import FacturasViejas from '@/components/FacturasViejas';
import ResumenImpagas from '@/components/ResumenImpagas';
import { leerSaldadas, numerosSaldados, type FacturaSaldada } from '@/lib/facturasSaldadas';

export const dynamic = 'force-dynamic';

// Cuánto para atrás se mira. Es la misma ventana que el recordatorio: lo que se ve en
// pantalla tiene que ser lo mismo que se le reclama al cliente.
const DIAS_PAGINA = 365;

const sumarDiasISO = (fecha: string, dias: number) => {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtFechaHora = (iso: string) => {
  const [f, h] = String(iso || '').split('T');
  const [y, m, d] = (f || '').split('-');
  return d ? `${d}/${m} ${(h || '').slice(0, 5)}` : '—';
};

export default async function CobranzasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let clientes: ClienteVenta[] = [], enviados: RecordatorioCobro[] = [], configRows: { clave: string; valor: any }[] = [];
  let cobros: CobroRegistrado[] = [];
  let bandeja: ItemBandeja[] = [];
  let aliasRows: AliasCobranza[] = [];
  let saldadas: FacturaSaldada[] = [];
  try {
    [clientes, enviados, configRows, cobros, bandeja, aliasRows, saldadas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []),
      // La hoja no existe hasta la primera importación del resumen bancario.
      readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => []),
      readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => []),
      // La hoja no existe hasta que se marca la primera factura a mano.
      leerSaldadas(),
    ]);
  } catch {}

  // Lo pendiente de imputar, de lo más nuevo a lo más viejo.
  const itemsBandeja = bandeja
    .filter((i) => String(i.estado || '').trim() === 'pendiente')
    .map((i) => ({
      id_item: String(i.id_item),
      fecha: String(i.fecha || '').split('T')[0],
      importe: Number(i.importe) || 0,
      descripcion: String(i.descripcion || ''),
      id_control: String(i.id_control || '').trim(),
      cliente: String(i.cliente || ''),
      nota: String(i.nota || ''),
      // Las facturas que el propio aviso dice estar pagando. Las saca la IA del mail o del
      // PDF adjunto y quedan guardadas, pero no se estaban usando para nada: la pantalla
      // las recalculaba por importe, que es adivinar algo que el aviso ya dijo.
      comprobantes: String(i.comprobantes || ''),
      origen: String(i.origen || 'banco'),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);

  // Los alias que la app fue aprendiendo. Se muestran para poder borrar uno aprendido mal:
  // no falla de forma ruidosa, acierta siempre con la respuesta equivocada.
  // Las facturas de TODOS los clientes, en una sola consulta, y la sugerencia ya resuelta
  // para cada movimiento. Antes cada fila pedía las suyas al abrirse: con diez movimientos
  // para imputar eran diez consultas a Xubio de varios segundos cada una, justo cuando la
  // persona está esperando para decidir.
  const saldadasSet = numerosSaldados(saldadas);

  // Las tres consultas a Xubio salen juntas. Antes iban una atrás de otra —cobranzas,
  // después cuentas, después comprobantes— y la página tardaba la suma de las tres aunque
  // ninguna dependiera del resultado de la anterior. En paralelo tarda lo que la más lenta.
  const hoyF = fechaArgentinaHoy();
  let facturasCliente: Record<string, FacturaCliente[]> = {};
  let cuentasXubio: CuentaXubio[] = [];
  let errorCuentas: string | null = null;
  try {
    const [comps, cobs] = await Promise.all([
      // Un año: es la misma ventana que usa el recordatorio, así lo que se ve acá es lo
      // mismo que se le reclama al cliente. Con menos, el resumen mostraba una deuda más
      // chica que la del mail y no había forma de entender la diferencia.
      getComprobantes(sumarDiasISO(hoyF, -DIAS_PAGINA), hoyF).catch(() => [] as any[]),
      getCobranzas(sumarDiasISO(hoyF, -DIAS_PAGINA), hoyF).catch(() => [] as any[]),
    ]);
    facturasCliente = facturasPorCliente(comps, cobros, clientes, saldadasSet);
    cuentasXubio = (await getCuentas(cobs)).cuentas;
    if (!cuentasXubio.length) errorCuentas = 'Xubio no devolvió ninguna cuenta donde imputar el cobro.';
  } catch (e: any) {
    // Si Xubio no responde, la bandeja sigue funcionando: cada fila pide sus facturas al
    // abrirse, que es como funcionaba antes.
    errorCuentas = e?.message || 'No se pudo conectar con Xubio.';
  }

  // Qué queda elegido al abrir la fila. Lo que DICE el aviso gana sobre lo que se deduce
  // del importe: si la orden de pago nombra las facturas, eso no es una hipótesis.
  const sugeridasPorItem: Record<string, string[]> = {};
  for (const item of itemsBandeja) {
    if (!item.id_control) continue;
    const facturas = facturasCliente[item.id_control];
    if (!facturas?.length) continue;

    // Se cruzan contra las facturas reales del cliente para quedarse con el número tal
    // como está en Xubio, y para no elegir una que no existe si la IA leyó mal un dígito.
    const declaradas = item.comprobantes
      .split(/[,;]+/).map((x) => claveComprobante(x)).filter(Boolean);
    if (declaradas.length) {
      const encontradas = facturas
        .filter((f) => declaradas.includes(claveComprobante(f.numero)))
        .map((f) => f.numero);
      if (encontradas.length === declaradas.length) {
        sugeridasPorItem[item.id_item] = encontradas;
        continue;
      }
    }

    const mejor = sugerirCombinaciones(facturas, item.importe)[0];
    if (mejor) sugeridasPorItem[item.id_item] = mejor.numeros;
  }

  const aliasAprendidos = aliasRows
    .filter((a) => String(a.alias || '').trim().length >= 3)
    .map((a) => ({ alias: String(a.alias).trim(), cliente: String(a.cliente || ''), fecha: String(a.fecha_aprendido || '') }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  const filas: ClienteFila[] = clientes
    .filter((c) => String(c.activo || '').toUpperCase() !== 'NO')
    .map((c) => ({
      id_control: c.id_control,
      nombre: nombreClienteVisible(c),
      activo: String((c as any)[COL_ACTIVO] || '').trim().toUpperCase() === 'SI',
      email: String((c as any)[COL_EMAIL] || ''),
      emailGeneral: String(c.email || ''),
      antiguedad: Number((c as any)[COL_ANTIGUEDAD]) > 0 ? Number((c as any)[COL_ANTIGUEDAD]) : ANTIGUEDAD_DEFAULT,
      antiguedadHasta: Number((c as any)[COL_ANTIGUEDAD_HASTA]) > 0 ? Number((c as any)[COL_ANTIGUEDAD_HASTA]) : ANTIGUEDAD_HASTA_DEFAULT,
    }))
    // Los prendidos primero: son los que se miran.
    .sort((a, b) => (a.activo === b.activo ? a.nombre.localeCompare(b.nombre) : a.activo ? -1 : 1));

  const datosPagoFila = configRows.find((r) => String(r.clave).trim() === CONFIG_DATOS_PAGO);
  const datosPago = String(datosPagoFila?.valor || '').trim() || DATOS_PAGO_DEFAULT;

  // Solo la última semana. El historial completo vive en la planilla; acá lo único que se
  // mira es si la corrida del lunes salió bien, y para eso 25 filas viejas son ruido.
  const desdeHistorial = sumarDiasISO(hoyF, -7);
  const historial = [...enviados]
    .filter((r) => String(r.fecha_envio || '').slice(0, 10) >= desdeHistorial)
    .sort((a, b) => String(b.fecha_envio || '').localeCompare(String(a.fecha_envio || '')));
  const prendidos = filas.filter((f) => f.activo).length;

  return (
    <>
      <Header user={user} current="cobranzas" />
      <div className="container">
        <h1 className="page-title">Cobranzas</h1>
        <p className="page-subtitle">
          Registrar cobros en Xubio · recordatorios semanales a los clientes elegidos (salen los lunes a la mañana)
          con todo lo que les figura impago
        </p>

        {/* ══ QUIÉN DEBE QUÉ ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Facturas impagas por cliente</p>
          <p className="card-sub">
            Todo lo facturado en los últimos {DIAS_PAGINA} días que no figura cobrado: ni imputado desde la app
            ni dado por saldado a mano. Es exactamente lo que se le reclama a cada cliente en el recordatorio.
          </p>
          <div style={{ marginTop: '10px' }}>
            <ResumenImpagas
              clientes={clientes
                .map((c) => ({ id_control: String(c.id_control), nombre: nombreClienteVisible(c) }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre))}
              facturasPorCliente={facturasCliente}
              conRecordatorio={filas.filter((f) => f.activo).map((f) => String(f.id_control))}
            />
          </div>
        </div>

        {/* ══ BANDEJA ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Bandeja — cobros por imputar</p>
          <p className="card-sub">
            Subís el resumen del banco y acá quedan los movimientos de entrada, uno por uno, con el cliente
            propuesto y qué facturas podrían ser. Nada se registra en Xubio hasta que lo confirmás.
            Cuando elegís el cliente a mano, la app se guarda cómo aparece ese pagador en el resumen y la
            próxima vez lo reconoce sola.
          </p>
          <div style={{ marginTop: '10px' }}>
            <BandejaCobranzas
              items={itemsBandeja}
              clientes={filas.map((f) => ({ id_control: f.id_control, nombre: f.nombre }))}
              cuentas={cuentasXubio.map((c) => ({ id: c.id, nombre: c.nombre }))}
              cuentasFaltantes={cuentasFaltantes(cuentasXubio)}
              aliases={aliasAprendidos}
              facturasPorCliente={facturasCliente}
              sugeridas={sugeridasPorItem}
            />
          </div>
        </div>

        {/* ══ REGISTRAR UN COBRO ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Registrar un cobro en Xubio</p>
          <p className="card-sub">
            Lo que cargues acá se crea en Xubio como cobranza del cliente. Entra a su cuenta corriente
            como cobro a cuenta: la API de Xubio no permite imputarlo a una factura puntual, eso sigue
            siendo a mano si hace falta. Un cobro mal cargado se puede anular desde acá.
          </p>
          <div style={{ marginTop: '10px' }}>
            <RegistrarCobro
              cuentasIniciales={cuentasXubio}
              errorCuentas={errorCuentas}
              clientes={filas.map((f) => ({ id_control: f.id_control, nombre: f.nombre }))}
              cobros={[...cobros]
                .sort((a, b) => String(b.fecha_registro || '').localeCompare(String(a.fecha_registro || '')))
                .slice(0, 15)
                .map((c) => ({
                  id_cobro: c.id_cobro, cliente: c.cliente, fecha: c.fecha,
                  fecha_registro: String(c.fecha_registro || ''),
                  importe: Number(c.importe) || 0, numero_recibo: String(c.numero_recibo || ''),
                  transaccionid: String(c.transaccionid || ''), estado: String(c.estado || ''),
                  observacion: String(c.observacion || ''),
                }))}
            />
          </div>
        </div>

        {/* ══ LIMPIAR FACTURAS VIEJAS ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Facturas que ya están cobradas pero siguen apareciendo</p>
          <p className="card-sub">
            Para las que se cobraron por fuera de la app —un cheque, una compensación, un cobro cargado
            a mano en Xubio— o las que ya no se van a cobrar. Se dan por saldadas y dejan de aparecer al
            imputar y en los reclamos. <strong>No se registra ningún movimiento en Xubio</strong>, así que
            la contabilidad queda como está. Se puede deshacer.
          </p>
          <div style={{ marginTop: '10px' }}>
            <FacturasViejas
              clientes={clientes
                .map((c) => ({ id_control: String(c.id_control), nombre: nombreClienteVisible(c) }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre))}
              facturasPorCliente={facturasCliente}
              saldadas={saldadas
                .filter((f) => String(f.estado) !== 'revertida')
                .map((f) => ({
                  numero: String(f.numero), cliente: String(f.cliente || ''),
                  importe: Number(f.importe) || 0, fecha_marcado: String(f.fecha_marcado || ''),
                  motivo: String(f.motivo || ''), usuario: String(f.usuario || ''),
                }))}
            />
          </div>
        </div>

        {/* ══ RECLAMO PUNTUAL ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Reclamar facturas a un cliente</p>
          <p className="card-sub">
            Para mandar un reclamo puntual sin tocar la configuración del recordatorio automático.
            Elegís el cliente, marcás desde qué fecha (o tildás las facturas una por una) y se manda.
          </p>
          <div style={{ marginTop: '10px' }}>
            <ReclamoManual clientes={filas.map((f) => ({ id_control: f.id_control, nombre: f.nombre }))} />
          </div>
        </div>

        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Clientes con recordatorio</p>
          <p className="card-sub">{prendidos === 0 ? 'Ninguno prendido todavía' : `${prendidos} prendido${prendidos > 1 ? 's' : ''}`}</p>
          <div style={{ marginTop: '10px' }}>
            <ClientesRecordatorio clientes={filas} />
          </div>
        </div>

        {/* Los datos de pago se editan una vez por año: van plegados. */}
        <details className="card" style={{ marginBottom: '14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: '#374151' }}>
            Datos de pago que se incluyen en cada recordatorio
          </summary>
          <div style={{ marginTop: '10px' }}>
            <DatosPago valor={datosPago} />
          </div>
        </details>

        <div className="card">
          <p className="card-title">Recordatorios enviados — últimos 7 días</p>
          {historial.length === 0 ? (
            <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: '#9ca3af' }}>Ninguno en los últimos 7 días.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '560px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Enviado</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Comprobantes</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((r) => (
                    <tr key={r.id_recordatorio} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 8px', color: '#6b7280' }}>{fmtFechaHora(r.fecha_envio)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.cliente}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{r.comprobantes}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>${Math.round(Number(r.importe) || 0).toLocaleString('es-AR')}</td>
                      <td style={{ padding: '6px 8px', color: String(r.estado) === 'enviado' ? '#059669' : '#dc2626', fontWeight: 600 }}>
                        {String(r.estado) === 'enviado' ? '✓ Enviado' : `✕ ${r.estado}`}
                        {r.detalle && <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {r.detalle}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
