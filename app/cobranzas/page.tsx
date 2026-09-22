import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  HOJA_RECORDATORIOS, COL_ACTIVO, COL_EMAIL, CONFIG_DATOS_PAGO, DATOS_PAGO_DEFAULT,
  MAX_DIAS_ATRAS, ANTIGUEDAD_DEFAULT, ANTIGUEDAD_HASTA_DEFAULT, COL_ANTIGUEDAD, COL_ANTIGUEDAD_HASTA, type RecordatorioCobro,
} from '@/lib/recordatoriosCobro';
import { nombreClienteVisible } from '@/lib/clientes';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import { getCuentas, getCobranzas, getComprobantes, type CuentaXubio } from '@/lib/xubio';
import { facturasPorCliente, type FacturaCliente } from '@/lib/facturasCliente';
import { sugerirCombinaciones } from '@/lib/conciliacionCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import { ClientesRecordatorio, DatosPago, ProbarRecordatorios, type ClienteFila } from '@/components/CobranzasConfig';
import RegistrarCobro from '@/components/RegistrarCobro';
import BandejaCobranzas from '@/components/BandejaCobranzas';
import { HOJA_BANDEJA, HOJA_ALIAS, type ItemBandeja, type AliasCobranza } from '@/lib/bandejaCobranzas';
import ReclamoManual from '@/components/ReclamoManual';

export const dynamic = 'force-dynamic';

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
  try {
    [clientes, enviados, configRows, cobros, bandeja, aliasRows] = await Promise.all([
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []),
      // La hoja no existe hasta la primera importación del resumen bancario.
      readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => []),
      readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => []),
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
      origen: String(i.origen || 'banco'),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);

  // Los alias que la app fue aprendiendo. Se muestran para poder borrar uno aprendido mal:
  // no falla de forma ruidosa, acierta siempre con la respuesta equivocada.
  // Las facturas de TODOS los clientes, en una sola consulta, y la sugerencia ya resuelta
  // para cada movimiento. Antes cada fila pedía las suyas al abrirse: con diez movimientos
  // para imputar eran diez consultas a Xubio de varios segundos cada una, justo cuando la
  // persona está esperando para decidir.
  let facturasCliente: Record<string, FacturaCliente[]> = {};
  try {
    const hoyF = fechaArgentinaHoy();
    const comps = await getComprobantes(sumarDiasISO(hoyF, -120), hoyF);
    facturasCliente = facturasPorCliente(comps, cobros, clientes);
  } catch {
    // Si Xubio no responde, la bandeja sigue funcionando: cada fila pide las suyas al
    // abrirse, que es como funcionaba antes.
  }

  // La combinación que mejor explica cada importe, calculada acá para que al abrir la fila
  // ya esté elegida. Es la misma función que usa la pantalla.
  const sugeridasPorItem: Record<string, string[]> = {};
  for (const item of itemsBandeja) {
    if (!item.id_control) continue;
    const facturas = facturasCliente[item.id_control];
    if (!facturas?.length) continue;
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

  // Las cuentas se traen acá y no cuando el usuario aprieta un botón: el formulario de
  // cobro las necesita para existir, y esconderlo detrás de "probar conexión" hacía que
  // pareciera que la función no estaba. Si Xubio no responde, el formulario avisa y el
  // botón de diagnóstico sigue estando para ver qué pasó.
  let cuentasXubio: CuentaXubio[] = [];
  let errorCuentas: string | null = null;
  try {
    const hoyC = fechaArgentinaHoy();
    const desdeC = sumarDiasISO(hoyC, -60);
    const cobs = await getCobranzas(desdeC, hoyC).catch(() => []);
    cuentasXubio = (await getCuentas(cobs)).cuentas;
    if (!cuentasXubio.length) errorCuentas = 'Xubio no devolvió ninguna cuenta donde imputar el cobro.';
  } catch (e: any) {
    errorCuentas = e?.message || 'No se pudo conectar con Xubio.';
  }

  const datosPagoFila = configRows.find((r) => String(r.clave).trim() === CONFIG_DATOS_PAGO);
  const datosPago = String(datosPagoFila?.valor || '').trim() || DATOS_PAGO_DEFAULT;

  const historial = [...enviados]
    .sort((a, b) => String(b.fecha_envio || '').localeCompare(String(a.fecha_envio || '')))
    .slice(0, 25);
  const prendidos = filas.filter((f) => f.activo).length;

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <h1 className="page-title">Cobranzas</h1>
        <p className="page-subtitle">
          Registrar cobros en Xubio · recordatorios semanales a los clientes elegidos (salen los lunes a la mañana)
        </p>

        {/* Lo que la app NO puede saber, dicho antes de que alguien lo asuma al revés. */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '11px 14px', marginBottom: '14px' }}>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#92400e', lineHeight: 1.5 }}>
            <strong>Xubio no permite saber si una factura puntual está paga</strong> — no existe ese dato en su API.
            Lo que sí hace la app es comparar lo facturado contra lo cobrado de cada cliente (últimos 120 días):
            si el cliente está al día, el recordatorio no sale. Y cada comprobante entra en un solo recordatorio,
            así nunca se reclama dos veces lo mismo.
          </p>
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
                  importe: Number(c.importe) || 0, numero_recibo: String(c.numero_recibo || ''),
                  transaccionid: String(c.transaccionid || ''), estado: String(c.estado || ''),
                  observacion: String(c.observacion || ''),
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '14px', marginBottom: '14px', alignItems: 'start' }}>
          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Datos de pago del mail</p>
            <p className="card-sub">Se incluyen en cada recordatorio, tal cual los escribas acá</p>
            <div style={{ marginTop: '10px' }}>
              <DatosPago valor={datosPago} />
            </div>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Probar</p>
            <p className="card-sub">
              La simulación muestra a quién le llegaría y con qué facturas, sin mandar nada.
              Entran las facturas que ya cumplieron la antigüedad de cada cliente y no se reclamaron todavía,
              hasta {MAX_DIAS_ATRAS} días para atrás.
            </p>
            <div style={{ marginTop: '10px' }}>
              <ProbarRecordatorios />
            </div>
          </div>
        </div>

        <div className="card">
          <p className="card-title">Últimos recordatorios enviados</p>
          {historial.length === 0 ? (
            <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: '#9ca3af' }}>Todavía no se envió ninguno.</p>
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
