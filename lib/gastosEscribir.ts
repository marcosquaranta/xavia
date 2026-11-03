// ── Escribir un gasto simple ─────────────────────────────────────────────────────────
//
// El caso de una sola fila: sin cuotas, sin pendiente de pago, sin artículo de stock. Vive
// acá y no adentro de una ruta porque ahora lo cargan dos puertas —la pantalla y el bot de
// Telegram— y una de las dos no tiene sesión del navegador.
//
// Dos caminos armando la fila por su cuenta terminan, tarde o temprano, escribiendo
// columnas distintas: uno se olvida de `fecha_carga`, el otro numera el id de otra forma, y
// la diferencia aparece meses después en un total que no cierra.
//
// Lo que NO hace, a propósito: cuotas, deuda a proveedor y compras de insumo. Cada una de
// esas necesita datos o efectos que el caso simple no tiene (un plan de vencimientos, el
// artículo y la cantidad que entran al stock), y meterlas acá convertiría esto en una
// segunda copia de la ruta en vez de una pieza compartida.

import { appendRowObj, asegurarColumna, asegurarColumnas, readSheet } from './sheets';
import { CATEGORIAS_GASTO, type Gasto } from './types';

export interface GastoSimple {
  fecha: string;
  descripcion: string;
  categoria: string;
  monto: number;
  medio_pago: string;
  proveedor?: string;
  // Solo para adelanto_sueldo: el workno. Sin esto el adelanto no se le descuenta a nadie.
  empleado?: string;
  usuario: string;
}

export async function escribirGastoSimple(g: GastoSimple): Promise<{ id_gasto: string }> {
  await asegurarColumna('Gastos', 'medio_pago_destino');
  await asegurarColumna('Gastos', 'empleado');
  await asegurarColumnas('Gastos', ['estado_pago', 'proveedor', 'vencimiento']);

  const gastos = await readSheet<Gasto>('Gastos');
  const maxId = gastos
    .map((x) => parseInt(String(x.id_gasto).replace('GAS-', '') || '0'))
    .filter((n) => !isNaN(n))
    .reduce((m, n) => Math.max(m, n), 0);
  const id_gasto = `GAS-${String(maxId + 1).padStart(4, '0')}`;

  // Una categoría que no existe cae a gastos_generales en vez de escribirse tal cual: una
  // categoría inventada no da error, solo deja de sumar en el rubro que le corresponde.
  const categoria = CATEGORIAS_GASTO.some((c) => c.value === g.categoria) ? g.categoria : 'gastos_generales';

  await appendRowObj('Gastos', {
    id_gasto,
    fecha: g.fecha,
    descripcion: String(g.descripcion || '').trim(),
    monto: g.monto,
    categoria,
    medio_pago: g.medio_pago,
    medio_pago_destino: '',
    empleado: categoria === 'adelanto_sueldo' ? String(g.empleado || '').trim() : '',
    usuario: g.usuario,
    fecha_carga: new Date().toISOString().split('T')[0],
    estado_pago: '',
    proveedor: String(g.proveedor || '').trim(),
    vencimiento: '',
    id_articulo: '',
    cantidad: '',
  });

  return { id_gasto };
}
