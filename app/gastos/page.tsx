import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Gasto, Articulo, Empleado } from '@/lib/types';
import Header from '@/components/Header';
import GastosManager from './GastosManager';
import DeudaProveedores from '@/components/DeudaProveedores';
import ResumenTarjeta from '@/components/ResumenTarjeta';
import { deudaProveedores } from '@/lib/proveedores';
import { MEDIOS_PAGO } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function GastosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let gastos: Gasto[] = [];
  let articulos: Articulo[] = [];
  let empleados: Empleado[] = [];
  let err: string | null = null;
  try {
    [gastos, articulos, empleados] = await Promise.all([
      readSheet<Gasto>('Gastos'),
      readSheet<Articulo>('Articulos').catch(() => []),
      // Para elegir a quién se le adelantó el sueldo. Si falla, la carga de gastos sigue
      // funcionando: solo no se puede cargar un adelanto.
      readSheet<Empleado>('Empleados').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  // Lo que se compró y todavía no se pagó. Va arriba de la carga porque es lo que hay que
  // mirar primero al entrar: la deuda que vence es más urgente que el gasto que se carga.
  const hoyArg = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const deuda = deudaProveedores(gastos, hoyArg);

  return (
    <>
      <Header user={user} current="gastos" />
      <div className="container">
        <h1 className="page-title">Gastos</h1>
        <p className="page-subtitle">Registro de gastos e insumos · carga y exportación mensual</p>
        {!err && (
          <ResumenTarjeta
            categoriasPrevias={gastos
              .filter((g) => String(g.descripcion || '').trim() && g.categoria)
              .slice(-800)
              .map((g) => ({ descripcion: String(g.descripcion), categoria: String(g.categoria) }))}
            yaCargados={gastos
              .filter((g) => Number(g.monto) > 0)
              .map((g) => ({
                fecha: String(g.fecha || '').split(/[T ]/)[0],
                descripcion: String(g.descripcion || ''),
                monto: Number(g.monto) || 0,
              }))}
          />
        )}

        {!err && deuda.length > 0 && (
          <div className="card" style={{ marginBottom: '14px' }}>
            <p className="card-title">Deuda a proveedores</p>
            <p className="card-sub">Compras cargadas que todavía no se pagaron, de lo que vence antes a lo que vence después.</p>
            <div style={{ marginTop: '10px' }}>
              <DeudaProveedores deuda={deuda} medios={[...MEDIOS_PAGO]} />
            </div>
          </div>
        )}

        {err ? <div className="alert-box error">{err}</div> : <GastosManager gastos={gastos} articulos={articulos.filter((a) => a.activo === 'SI')} usuario={user.email}
          empleados={empleados.filter((e) => e.activo === 'SI').map((e) => ({ workno: String(e.workno), nombre: e.nombre }))} />}
      </div>
    </>
  );
}
