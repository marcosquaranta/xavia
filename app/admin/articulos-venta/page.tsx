import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
import { ARTICULOS } from '@/lib/articulos';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import ArticulosVentaManager, { type ArticuloUI } from '@/components/ArticulosVentaManager';

export const dynamic = 'force-dynamic';

export default async function ArticulosVentaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const extras = await leerArticulosExtra();
  const clavesCodigo = new Set(ARTICULOS.map((a) => a.key));
  const articulos: ArticuloUI[] = [...ARTICULOS, ...extras].map((a) => ({
    key: a.key, label: a.label, labelLargo: a.labelLargo, xubio: a.xubio,
    unidad: a.unidad, activo: a.activo, color: a.color,
    seccionAparte: !!a.seccionAparte,
    esDelCodigo: clavesCodigo.has(a.key),
  }));

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Admin</Link>
        <h1 className="page-title">Artículos de venta</h1>
        <p className="page-subtitle">
          Lo que se puede vender y facturar. Un artículo nuevo aparece en la carga de ventas del cliente
          recién cuando tiene precio cargado.
        </p>
        <div className="card">
          <ArticulosVentaManager articulos={articulos} />
        </div>
        <p style={{ margin: '12px 0 0', fontSize: '11.5px', color: '#9ca3af', lineHeight: 1.6 }}>
          Los artículos marcados como <strong>fijos</strong> están definidos en el código y no se editan acá.
          Varios de ellos <strong>consumen plantas de la cámara</strong> —una ensalada se lleva 2,5 plantas de rúcula—
          y eso conecta la venta con el stock: decidirlo mal no da un error, da un stock equivocado durante semanas.
          Los que se crean desde esta pantalla se venden y se facturan, pero no descuentan plantas. Si necesitás uno
          que sí lo haga, pedilo.
        </p>
      </div>
    </>
  );
}
