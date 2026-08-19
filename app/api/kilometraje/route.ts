import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarHoja, deleteRow, readSheet } from '@/lib/sheets';
import { VEHICULO_PARTNER, ultimaLectura } from '@/lib/kilometraje';
import type { KilometrajeVehiculo } from '@/lib/types';

const HEADERS = ['id_km', 'fecha', 'vehiculo', 'km_acumulado', 'notas', 'usuario'];

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha, km_acumulado, notas } = await req.json();
    const km = Number(km_acumulado);
    if (!fecha || !(km > 0)) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    await asegurarHoja('Kilometraje', HEADERS);
    const registros = await readSheet<KilometrajeVehiculo>('Kilometraje');

    // El odómetro no retrocede — si cargan un valor menor al último conocido, seguro es
    // un error de tipeo (ej. faltó un dígito), así que se avisa en vez de guardarlo mudo.
    const ultima = ultimaLectura(registros, VEHICULO_PARTNER);
    if (ultima && km < Number(ultima.km_acumulado)) {
      return NextResponse.json({ error: `El último kilometraje cargado (${Number(ultima.km_acumulado).toLocaleString('es-AR')} km, ${ultima.fecha}) es mayor. Revisá el valor.` }, { status: 400 });
    }

    const maxId = registros.reduce((acc, r) => Math.max(acc, parseInt(String(r.id_km).replace('KM-', '')) || 0), 0);
    const idNuevo = `KM-${String(maxId + 1).padStart(4, '0')}`;
    await appendRowObj('Kilometraje', {
      id_km: idNuevo, fecha, vehiculo: VEHICULO_PARTNER, km_acumulado: km,
      notas: notas || '', usuario: user.email,
    });
    return NextResponse.json({ ok: true, id_km: idNuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

// Corrige un error de tipeo en la ÚLTIMA carga (ej. faltó un dígito) — borra esa lectura
// para poder volver a cargar el número correcto sin chocar con la validación de "el
// odómetro no retrocede" de arriba. Por seguridad solo deja borrar la lectura MÁS
// RECIENTE del vehículo (no cualquier registro histórico): evita que se pueda voltear
// datos viejos desde acá, y de paso es justo el caso de uso real (recién cargaste mal).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_km } = await req.json();
    if (!id_km) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    const registros = await readSheet<KilometrajeVehiculo>('Kilometraje');
    const ultima = ultimaLectura(registros, VEHICULO_PARTNER);
    if (!ultima || String(ultima.id_km) !== String(id_km)) {
      return NextResponse.json({ error: 'Solo se puede borrar la última carga registrada.' }, { status: 400 });
    }

    await deleteRow('Kilometraje', 'id_km', String(id_km));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
