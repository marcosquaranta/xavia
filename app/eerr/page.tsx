import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularEERR, previsionesSugeridas, gastosDeLinea, desgloseVentas } from '@/lib/eerr';
import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import { leerPrevisiones, previsionDelMes } from '@/lib/previsiones';
import PrevisionesEditor from './PrevisionesEditor';
import TablaEERR from './TablaEERR';
import EnviarInforme from './EnviarInforme';
import { leerCobranzas, leerSaldos, saldosDelMes, type Cobranza, type SaldoCuenta } from '@/lib/cuentas';
import { HOJA_COBRANZAS_CACHE, type CobranzaCache } from '@/lib/xubioCache';
import CuentasEditor from './CuentasEditor';
import { nombreClienteVisible } from '@/lib/clientes';
import { pasosDelCierre, resumenChecklist } from '@/lib/cierreChecklist';
import ChecklistCierre from './ChecklistCierre';
import { leerPasosManuales, marcadosDelMes } from '@/lib/cierreManual';
import OrigenAplicacionCard from '@/components/OrigenAplicacion';
import { origenYAplicacion, deudaProveedoresAlCierre, causasDeLaDiferencia } from '@/lib/origenAplicacion';
import { calcularValorizacionMes as valorizacionDelMes } from '@/lib/valorizacionStock';
export const dynamic = 'force-dynamic';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;


export default async function CierreMensualPage({ searchParams }: { searchParams: { anio?: string; mes?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let articulos: Articulo[] = [], stocks: StockMes[] = [], gastos: Gasto[] = [];
  let ventas: VentaDia[] = [], precios: PrecioVenta[] = [], clientes: ClienteVenta[] = [];
  let previsiones: Awaited<ReturnType<typeof leerPrevisiones>> = [];
  let cobranzas: Cobranza[] = [], saldosGuardados: SaldoCuenta[] = [];
  let cobranzasXubio: CobranzaCache[] = [];
  let err: string | null = null;
  try {
    [articulos, stocks, gastos, ventas, precios, clientes, previsiones, cobranzas, saldosGuardados, cobranzasXubio] = await Promise.all([
      readSheet<Articulo>('Articulos'), readSheet<StockMes>('Stocks'), readSheet<Gasto>('Gastos'),
      readSheet<VentaDia>('Ventas'), readSheet<PrecioVenta>('Precios').catch(() => []),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      leerPrevisiones(), leerCobranzas(), leerSaldos(),
      // Las cobranzas que ya están en Xubio: de ahí sale cuánto entró en cada cuenta.
      readSheet<CobranzaCache>(HOJA_COBRANZAS_CACHE).catch(() => [] as CobranzaCache[]),
    ]);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  // Por defecto, el ÚLTIMO MES CERRADO y no el actual.
  //
  // Un EERR del mes en curso siempre está mal y de la peor manera: muestra ingresos de
  // media docena de días contra gastos fijos que ya se pagaron enteros, así que el
  // resultado da negativo y parece una alarma. Cada vez que alguien entra a mirar "cómo
  // venimos" lo primero que ve es un número que no significa nada.
  //
  // El mes en curso se sigue pudiendo ver: está a un click del botón de siguiente.
  const cerrado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const anio = Number(searchParams.anio) || cerrado.getFullYear();
  const mes = Number(searchParams.mes) || (cerrado.getMonth() + 1);
  let mesPrev = mes - 1, anioPrev = anio;
  if (mesPrev === 0) { mesPrev = 12; anioPrev--; }

  const datos = { articulos, stocks, gastos, ventas, precios, clientes };
  // Dos pasadas: la primera para conocer la masa salarial —que es la base de las
  // previsiones— y la segunda ya con las previsiones adentro del resultado. Sin la primera
  // habría que elegir entre no previsionar o previsionar sobre un número que todavía no se
  // calculó.
  const base = calcularEERR(datos, anio, mes);
  const guardada = previsionDelMes(previsiones, anio, mes);
  const prev = previsionesSugeridas(base.masaSalarial);
  // Manda lo guardado. La sugerencia solo se usa mientras nadie la confirmó: un mes cerrado
  // no puede cambiar de números porque mañana se corrija un sueldo cargado tarde.
  const previsionesDelMes = guardada
    ? { despidos: Number(guardada.despidos) || 0, sac: Number(guardada.sac) || 0 }
    : null;
  const act = calcularEERR({ ...datos, previsiones: previsionesDelMes }, anio, mes);

  const guardadaPrev = previsionDelMes(previsiones, anioPrev, mesPrev);
  const ant = calcularEERR({
    ...datos,
    previsiones: guardadaPrev
      ? { despidos: Number(guardadaPrev.despidos) || 0, sac: Number(guardadaPrev.sac) || 0 }
      : null,
  }, anioPrev, mesPrev);

  const mm = String(mes).padStart(2, '0');
  const desdeMes = `${anio}-${mm}-01`;
  const hastaMes = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const cobranzasMes = cobranzas
    .filter((c) => { const f = String(c.fecha || '').split(/[T ]/)[0]; return f >= desdeMes && f <= hastaMes; })
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const saldos = saldosDelMes(gastos, cobranzas, saldosGuardados, anio, mes, cobranzasXubio);
  const cobradoMesTotal =
    cobranzasMes.reduce((a, c) => a + (Number(c.monto) || 0), 0)
    + cobranzasXubio
      .filter((c) => { const f = String(c.fecha || '').split(/[T ]/)[0]; return f >= desdeMes && f <= hastaMes; })
      .reduce((a, c) => a + (Number(c.importe) || 0), 0);
  const pasos = pasosDelCierre({ eerr: act, gastos, stocks, articulos, cobranzas: cobranzasMes, cobradoMes: cobradoMesTotal, saldos, hayPrevision: !!guardada, anio, mes });
  const resumenPasos = resumenChecklist(pasos);
  // Los pasos que alguien marcó a mano. La hoja no existe hasta el primer marcado.
  const marcados = marcadosDelMes(await leerPasosManuales(), anio, mes);

  // ── Origen y aplicación de fondos ──
  //
  // El puente entre el resultado y la caja. Cada pieza se calcula con el dato que ya existe:
  // la variación de deudores sale de lo facturado menos lo cobrado DEL MES (exacto con un
  // mes de datos, a diferencia del saldo, que necesitaría toda la historia), la de
  // proveedores de las compras que al cierre de cada mes todavía no estaban pagadas, y la de
  // stock de la valorización que ya se calcula para el EERR.
  const mmPrev = String(mesPrev).padStart(2, '0');
  const finMesPrev = `${anioPrev}-${mmPrev}-${String(new Date(anioPrev, mesPrev, 0).getDate()).padStart(2, '0')}`;
  const valorAct = valorizacionDelMes(articulos, stocks, anio, mes);
  const valorPrev = valorizacionDelMes(articulos, stocks, anioPrev, mesPrev);
  const sumaSaldos = (xs: typeof saldos, campo: 'inicial' | 'calculado') =>
    xs.reduce((a, x) => a + (campo === 'inicial' ? x.inicial : (x.real ?? x.calculado)), 0);
  // Solo se compara contra la caja si hay saldos reales cargados: con los calculados, la
  // diferencia daría cero siempre y el bloque diría que todo cierra cuando no se sabe.
  const hayCajaReal = saldos.some((x) => x.real !== null) && saldos.some((x) => x.hayInicial);

  const fondos = origenYAplicacion({
    resultado: act.resultado,
    facturadoMes: act.ventas.total,
    cobradoMes: cobradoMesTotal,
    deudaProveedoresInicio: deudaProveedoresAlCierre(gastos, finMesPrev),
    deudaProveedoresFin: deudaProveedoresAlCierre(gastos, hastaMes),
    previsionesMes: (previsionesDelMes?.despidos || 0) + (previsionesDelMes?.sac || 0),
    stockInicio: valorPrev.total ?? null,
    stockFin: valorAct.total ?? null,
    cajaInicio: hayCajaReal ? sumaSaldos(saldos, 'inicial') : null,
    cajaFin: hayCajaReal ? sumaSaldos(saldos, 'calculado') : null,
  });

  const esMesActual = anio === hoy.getFullYear() && mes === (hoy.getMonth() + 1);
  const hrefMes = (a: number, m: number) => `/eerr?anio=${a}&mes=${m}`;
  let mesSig = mes + 1, anioSig = anio;
  if (mesSig === 13) { mesSig = 1; anioSig++; }
  const haySiguiente = anioSig < hoy.getFullYear() || (anioSig === hoy.getFullYear() && mesSig <= hoy.getMonth() + 1);
  const nombre = `${MESES[mes - 1]} ${anio}`.replace(/^./, (c) => c.toUpperCase());
  const nombrePrev = `${MESES[mesPrev - 1].slice(0, 3)} ${String(anioPrev).slice(2)}`;

  // Cada línea del bloque anterior, para poder comparar aunque una categoría exista en un
  // mes y no en el otro.
  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Cierre mensual</h1>
            <p className="page-subtitle">Estado de resultados — se calcula solo con lo que está cargado en la app</p>
          </div>
          {/* El histórico responde otra pregunta ("cómo venimos", no "cómo dio este mes") y
              cuesta más de calcular, así que es otra pantalla y no un bloque más de esta. */}
          <Link href="/eerr/historico" className="btn secondary" style={{ fontSize: '12px' }}>Histórico mes a mes ›</Link>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0 14px', flexWrap: 'wrap' }}>
          <Link href={hrefMes(anioPrev, mesPrev)} className="btn secondary" style={{ fontSize: '12px' }}>‹ Mes anterior</Link>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>{nombre}</span>
          {haySiguiente
            ? <Link href={hrefMes(anioSig, mesSig)} className="btn secondary" style={{ fontSize: '12px' }}>Mes siguiente ›</Link>
            : <span className="btn secondary" style={{ fontSize: '12px', opacity: 0.4, pointerEvents: 'none' }}>Mes siguiente ›</span>}
        </div>

        {esMesActual && (
          <div className="alert-box" style={{ marginBottom: '12px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12.5px' }}>
            El mes está en curso: los números van a seguir cambiando hasta que termine y se cargue el stock final.
          </div>
        )}

        {act.avisos.length > 0 && (
          <div className="alert-box" style={{ marginBottom: '12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12.5px' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Datos que faltan y hacen que el resultado no cierre</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {act.avisos.map((a, i) => <li key={i} style={{ marginBottom: '2px' }}>{a}</li>)}
            </ul>
          </div>
        )}

        <ChecklistCierre pasos={pasos} {...resumenPasos} anio={anio} mes={mes} marcados={[...marcados]} />

        <TablaEERR act={act} ant={ant} nombre={nombre} nombrePrev={nombrePrev}
          desglose={desgloseVentas(datos, anio, mes)}
          detalle={Object.fromEntries(
            [...act.costoVariable.lineas, ...act.costosFijos.lineas].map((l) => [
              l.label, gastosDeLinea(gastos, articulos, l.label, anio, mes),
            ]),
          )} />

        {/* El mail del cierre se manda acá, a mano, cuando el mes ya está cargado. No hay
            cron: un informe automático llegaría siempre antes de que estén el resumen de la
            tarjeta, los stocks finales y las previsiones, o sea mostrando un mes a medias
            como si fuera el cierre. En el mes en curso no se ofrece por lo mismo. */}
        {!esMesActual && (
          <div style={{ marginTop: '10px' }}>
            <EnviarInforme anio={anio} mes={mes} label={nombre} />
          </div>
        )}

        <div className="card" style={{ marginTop: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Previsiones y cuentas corrientes — {nombre}
          </p>
          <PrevisionesEditor
            anio={anio} mes={mes} masaSalarial={act.masaSalarial} sugeridas={prev}
            guardadas={guardada ? {
              despidos: Number(guardada.despidos) || 0,
              sac: Number(guardada.sac) || 0,
              alquiler: Number(guardada.alquiler) || 0,
              epe: Number(guardada.epe) || 0,
              notas: String(guardada.notas || ''),
              fecha: String(guardada.fecha_carga || ''),
            } : null}
          />
        </div>

        <OrigenAplicacionCard datos={fondos} causas={causasDeLaDiferencia(saldos)} nombreMes={nombre} />

        <div className="card" style={{ marginTop: '12px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Saldos y movimientos entre cuentas — {nombre}
          </p>
          <CuentasEditor anio={anio} mes={mes} saldos={saldos}
            movimientos={gastos
              .filter((g) => g.categoria === 'movimiento_interno')
              .filter((g) => {
                const f = String(g.fecha || '').split(/[T ]/)[0];
                const mm = String(mes).padStart(2, '0');
                return f >= `${anio}-${mm}-01` && f <= `${anio}-${mm}-31`;
              })
              .map((g) => ({
                id_gasto: String(g.id_gasto),
                fecha: String(g.fecha || '').split(/[T ]/)[0],
                descripcion: String(g.descripcion || ''),
                monto: Number(g.monto) || 0,
                origen: String(g.medio_pago || ''),
                destino: String(g.medio_pago_destino || ''),
              }))
              .sort((a, b) => a.fecha.localeCompare(b.fecha))} />
        </div>

        <div className="card" style={{ marginTop: '12px', background: '#fafaf9' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>De dónde sale cada número</p>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#4b5563', lineHeight: 1.6 }}>
            <li><strong>Ventas:</strong> las ventas cargadas del mes, a los precios de cada cliente. Los kg se convierten a unidades con el peso real de las plantas cosechadas.</li>
            <li><strong>Costo variable de insumos:</strong> lo que se <em>consumió</em>, no lo que se compró — <span style={{ fontFamily: 'monospace' }}>inicial + compras − final</span> de Stocks, valorizado al último precio conocido, agrupado por categoría de artículo.</li>
            <li><strong>Fletes y energía:</strong> son costo variable pero no pasan por Stocks, así que salen de Gastos.</li>
            <li><strong>Cultivos de reventa:</strong> es un rubro de insumos, así que sale de Stocks como los demás: el costo es el consumo, no lo comprado en el mes.</li>
            <li><strong>Costos fijos:</strong> los gastos del mes agrupados por categoría.</li>
            <li><strong>Los gastos de «Insumos» no se suman aparte:</strong> ya están contados dentro del consumo de Stocks. Si alguno quedó sin aplicar a stock, aparece arriba como aviso.</li>
            <li><strong>Quedan afuera del resultado:</strong> los movimientos entre medios de pago (pagar el resumen de la tarjeta no es un gasto nuevo) y los aportes de socios, que son financiamiento.</li>
          </ul>
          <p style={{ margin: '10px 0 0', fontSize: '12.5px' }}>
            <Link href="/eerr/instrucciones" style={{ color: '#2563eb', fontWeight: 600 }}>Qué va en la app y qué queda en Xubio →</Link>
          </p>
        </div>
      </div>
    </>
  );
}
