'use client';
import Link from 'next/link';
interface Props { idLote: string; faseActual: string; estado: string; esAdmin: boolean; ultimoMovId?: string | number; ultimoMovTipo?: string; ultimoMovFecha?: string; }
export default function AccionesLote({ idLote, faseActual, estado, esAdmin, ultimoMovId, ultimoMovTipo, ultimoMovFecha }: Props) {
  const activo = estado === 'activo';
  const puedeDeshacer = ultimoMovId && ultimoMovTipo && (ultimoMovTipo === 'trasplante' || ultimoMovTipo === 'cosecha');
  function handleDeshacer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirm(`¿Deshacer el último movimiento (${ultimoMovTipo} del ${ultimoMovFecha})?`)) return;
    (e.target as HTMLFormElement).submit();
  }
  function handleBorrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirm(`¿Borrar permanentemente el lote ${idLote}?`)) return;
    (e.target as HTMLFormElement).submit();
  }
  return (
    <div className="card">
      <p className="card-title">Acciones</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {activo && faseActual !== 'fase_2' && <Link href={'/cultivos/' + encodeURIComponent(idLote) + '/trasplantar'} className="btn">Trasplantar</Link>}
        {activo && faseActual === 'fase_2' && <Link href={'/cultivos/' + encodeURIComponent(idLote) + '/cosechar'} className="btn">Cosechar</Link>}
        <Link href={'/cultivos/' + encodeURIComponent(idLote) + '/editar'} className="btn secondary">Editar lote</Link>
        {puedeDeshacer && (
          <form action="/api/lotes/deshacer" method="POST" onSubmit={handleDeshacer} style={{ display: 'inline' }}>
            <input type="hidden" name="id_lote" value={idLote} />
            <input type="hidden" name="id_movimiento" value={String(ultimoMovId)} />
            <button type="submit" className="btn secondary">↶ Deshacer último</button>
          </form>
        )}
        {esAdmin && (
          <form action="/api/lotes/borrar" method="POST" onSubmit={handleBorrar} style={{ display: 'inline' }}>
            <input type="hidden" name="id_lote" value={idLote} />
            <button type="submit" className="btn danger">Borrar lote</button>
          </form>
        )}
      </div>
    </div>
  );
}