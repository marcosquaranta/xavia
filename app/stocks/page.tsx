import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Articulo, StockMes, Lote } from '@/lib/types';
import Header from '@/components/Header';
import StocksManager from './StocksManager';
export const dynamic = 'force-dynamic';

export default async function StocksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let articulos: Articulo[] = [], stocks: StockMes[] = [], lotes: Lote[] = [];
  let err: string | null = null;
  try {
    [articulos, stocks, lotes] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Lote>('Lotes'),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return (
    <>
      <Header user={user} current="stocks" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  // Usos automáticos del sistema
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();
  const inicioMes = new Date(anioActual, hoy.getMonth(), 1);

  const lotesEsteMes = lotes.filter((l) => {
    const f = l.fecha_siembra ? new Date(String(l.fecha_siembra).split(/[\sT]/)[0]) : null;
    return f && f >= inicioMes;
  });

  const planchasSembradas = Math.round(
    lotesEsteMes.reduce((acc, l) => acc + (Number(l.plantines_iniciales) || 0), 0) / 345
  );

  const cosechasEsteMes = lotes.filter((l) => {
    if (l.estado !== 'cosechado') return false;
    const f = l.fecha_cosecha ? new Date(String(l.fecha_cosecha).split(/[\sT]/)[0]) : null;
    return f && f >= inicioMes;
  });

  const paquetesRucula = cosechasEsteMes
    .filter((l) => String(l.variedad || '').toLowerCase().includes('rucula'))
    .reduce((acc, l) => acc + (Number(l.unidades_cosechadas) || 0), 0);

  const plantasLechuga = cosechasEsteMes
    .filter((l) => !String(l.variedad || '').toLowerCase().includes('rucula'))
    .reduce((acc, l) => acc + (Number(l.unidades_cosechadas) || 0), 0);

  return (
    <>
      <Header user={user} current="stocks" />
      <div className="container">
        <h1 className="page-title">Stocks</h1>
        <p className="page-subtitle">Control de insumos · carga mensual · informe comparativo</p>

        <StocksManager
          articulos={articulos.filter((a) => a.activo === 'SI')}
          stocks={stocks}
          lotes={lotes}
          usuario={user.email}
        />
      </div>
    </>
  );
}
