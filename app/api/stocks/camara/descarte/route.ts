import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarColumna, readSheet } from '@/lib/sheets';
import type { StockCamara } from '@/lib/types';

// ── Descarte en cámara ────────────────────────────────────────────────────────────────
//
// Producto ya cosechado y empaquetado que se tira: se pudrió, se golpeó, quedó pasado.
//
// Va por acá y no por "registrar ajuste" porque son dos cosas distintas. Un ajuste es un
// RECUENTO: se cuenta todo lo que hay y la app deduce la diferencia contra lo que esperaba.
// Para anotar que se tiraron 20 paquetes no hace falta contar la cámara entera, y obligar a
// hacerlo era garantía de que no se anotara nunca.
//
// La fila queda con tipo 'descarte' y cantidad_paq en 0: no es un recuento, es una baja.
// Eso también la saca de la selección de base en calcularCamara, que si no tomaría el cero
// como "la cámara está vacía".
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { cultivo, fecha, descarte_paq, notas } = await req.json();
    const cantidad = Number(descarte_paq) || 0;
    if (!cultivo || !fecha) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    if (cantidad <= 0) return NextResponse.json({ error: 'cantidad_invalida' }, { status: 400 });

    const registros = await readSheet<StockCamara>('StockCamara').catch(() => []);
    const maxId = registros.reduce((acc, r) => Math.max(acc, Number(String(r.id_registro).replace('CAM-', '')) || 0), 0);
    const id = `CAM-${String(maxId + 1).padStart(4, '0')}`;

    for (const col of ['momento_carga', 'descarte_paq']) await asegurarColumna('StockCamara', col);

    await appendRowObj('StockCamara', {
      id_registro: id,
      cultivo,
      fecha,
      tipo: 'descarte',
      cantidad_paq: 0,
      notas: notas || '',
      usuario: user.email,
      fecha_carga: new Date().toISOString().split('T')[0],
      // Entero de milisegundos y no texto ISO: Sheets convertiría un "...T14:32:10Z" en un
      // serial de fecha y se perdería la hora, que es lo que desempata un descarte y un
      // recuento cargados el mismo día.
      momento_carga: Date.now(),
      descarte_paq: cantidad,
    });

    return NextResponse.json({ ok: true, id_registro: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
