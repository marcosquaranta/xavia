import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { MEDIOS_PAGO, type Gasto } from '@/lib/types';
import { LINEAS_VARIABLE, FIJOS } from '@/lib/eerr';
import Header from '@/components/Header';
import CargaRapidaForm from './CargaRapidaForm';

// Las mismas 12 + 8 líneas del EERR, en el mismo orden — no una lista aparte que se pueda
// desalinear. De las 12 de costo variable, 9 se calculan solas desde el consumo de Stocks
// (no tienen `cat`): esas quedan como fila de referencia, sin celda para tipear. Las de
// costos fijos con más de una categoría (Inversión, Otros) escriben en la primera — alguien
// que necesite la segunda puntualmente sigue teniendo el formulario completo en /gastos.
const FILAS_VARIABLE = LINEAS_VARIABLE.map((l) => ({ label: l.label, categoria: l.cat ?? null }));
const FILAS_FIJOS = FIJOS.map((l) => ({ label: l.label, categoria: l.cats[0] }));

// La grilla es solo para los dos bancos: es donde aparecen los débitos y créditos que hay
// que ir a buscar al resumen. Las cajas no tienen resumen que conciliar — lo que entra ahí
// es una cobranza (sección aparte) o un gasto puntual que ya se carga en /gastos como
// siempre. VISA tampoco: sus movimientos van uno por uno, con su fecha real de consumo.
const MEDIOS_GRILLA = MEDIOS_PAGO.filter((m) => m === 'Brubank' || m === 'Macro');

export const dynamic = 'force-dynamic';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export default async function CargaRapidaPage({ searchParams }: { searchParams: { anio?: string; mes?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let gastos: Gasto[] = [];
  let err: string | null = null;
  try { gastos = await readSheet<Gasto>('Gastos'); } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="eerr" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const anio = Number(searchParams.anio) || hoy.getFullYear();
  const mes = Number(searchParams.mes) || (hoy.getMonth() + 1);
  let mesPrev = mes - 1, anioPrev = anio;
  if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
  const nombre = `${MESES[mes - 1]} ${anio}`.replace(/^./, (c) => c.toUpperCase());
  const fechaSugerida = `${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;

  // Cuánto se consumió con la tarjeta el mes pasado: es la referencia de cuánto debería ser
  // el débito del resumen este mes. La app no puede saberlo sola —no lee el resumen— pero sí
  // puede decir "buscá algo cercano a esto".
  const mmPrev = String(mesPrev).padStart(2, '0');
  const desdePrev = `${anioPrev}-${mmPrev}-01`;
  const hastaPrev = `${anioPrev}-${mmPrev}-${String(new Date(anioPrev, mesPrev, 0).getDate()).padStart(2, '0')}`;
  const consumoTarjetaMesPasado = gastos
    .filter((g) => g.medio_pago === 'VISA' && g.categoria !== 'movimiento_interno')
    .filter((g) => { const f = String(g.fecha || '').split(/[T ]/)[0]; return f >= desdePrev && f <= hastaPrev; })
    .reduce((a, g) => a + num(g.monto), 0);

  const yaHayPagoTarjeta = gastos.some((g) => {
    const f = String(g.fecha || '').split(/[T ]/)[0];
    const mm = String(mes).padStart(2, '0');
    return g.categoria === 'movimiento_interno' && g.medio_pago_destino === 'VISA' && f >= `${anio}-${mm}-01` && f <= `${anio}-${mm}-31`;
  });

  return (
    <>
      <Header user={user} current="eerr" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Carga rápida — conciliación bancaria</h1>
            <p className="page-subtitle">{nombre} · una columna por banco, una fila por rubro</p>
          </div>
          <Link href={`/eerr?anio=${anio}&mes=${mes}`} className="btn secondary" style={{ fontSize: '12px' }}>← Volver al cierre</Link>
        </div>

        <div className="alert-box" style={{ margin: '12px 0', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12.5px' }}>
          Pensado para después de bajar los resúmenes de Macro y Brubank. Recorré cada uno y cargá lo que encuentres
          sin registrar todavía — sueldos, impuesto al cheque, comisiones, nafta, lo que sea. Una celda vacía no se
          guarda: solo se cargan las que completes. Las cajas no tienen resumen: lo que entra ahí se carga como
          cobranza (más abajo) o como gasto puntual en <Link href="/gastos" style={{ color: 'inherit', fontWeight: 700 }}>Gastos</Link>, como siempre.
        </div>

        <CargaRapidaForm
          fechaSugerida={fechaSugerida}
          filasVariable={FILAS_VARIABLE}
          filasFijos={FILAS_FIJOS}
          mediosGrilla={MEDIOS_GRILLA}
          medios={MEDIOS_PAGO}
          consumoTarjetaMesPasado={consumoTarjetaMesPasado}
          yaHayPagoTarjeta={yaHayPagoTarjeta}
          nombreMesPrev={`${MESES[mesPrev - 1]} ${anioPrev}`}
        />
      </div>
    </>
  );
}
