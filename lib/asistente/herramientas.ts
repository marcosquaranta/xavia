import type Anthropic from '@anthropic-ai/sdk';
import { Planillas } from './datos';
import type { Rol } from '../types';
import { MEDIOS_PAGO } from '../types';
import { sumarDias } from '../recordatoriosCobro';
import { calcularEERR, previsionesSugeridas } from '../eerr';
import { calcularValorizacionMes } from '../valorizacionStock';
import { leerPrevisiones, previsionDelMes } from '../previsiones';
import { leerCobranzas, leerSaldos, saldosDelMes, movimientosDeCuenta, type Cobranza, type SaldoCuenta } from '../cuentas';
import {
  HOJA_COBRANZAS_CACHE, HOJA_COMPROBANTES, comprobantesDesdeCache, cobranzasDesdeCache,
  type CobranzaCache, type ComprobanteCache,
} from '../xubioCache';
import { facturasPorCliente } from '../facturasCliente';
import { leerSaldadas, numerosSaldados } from '../facturasSaldadas';
import { leerEdiciones, imputacionesManuales } from '../cobranzasEdit';
import { leerAjustes, ajustesPorFactura } from '../ajusteFactura';
import { claveComprobante } from '../comprobantes';
import { nombreClienteVisible } from '../clientes';
import { HOJA_COBROS, type CobroRegistrado } from '../cobros';
import { calcularCapacidad, diasCicloDefault } from '../planificacionServer';
import { calcularPlan, parseReparto, REPARTO_DEFAULT, tareasDelDia, siembraDelDia, planchasSiembra } from '../planificacion';
import { CATEGORIAS_GASTO } from '../types';

// ── Las herramientas del asistente ────────────────────────────────────────────────────
//
// El asistente NO ve la planilla. Ve estas funciones, y solo puede contestar con lo que
// devuelven. Son las mismas que calculan las pantallas, así que el número del chat y el de
// la pantalla no se pueden contradecir — que es el problema que volvió tres veces en esta
// app: dos caminos distintos para el mismo dato terminan siendo dos verdades.
//
// ── SOBRE LOS PERMISOS, que es lo importante de este archivo ──
//
// `soloAdmin` NO es una sugerencia para el modelo: las herramientas marcadas así se filtran
// ANTES de armar el pedido, así que un usuario que no es admin trabaja con un modelo que no
// sabe que existen. No hay nada que convencer ni ningún prompt que saltearse.
//
// Escribirlo como instrucción en el prompt ("no le muestres sueldos a los operarios") sería
// un cartel, no una puerta: alcanza con que alguien insista para que el modelo lo
// reconsidere. Un control de acceso que depende de que el modelo obedezca no es un control
// de acceso.
//
// Todo lo que toque plata —resultado, sueldos, deuda, saldos, precios, previsiones— es solo
// admin. Lo operativo —tareas, siembra, lotes, cantidades de stock— lo ve todo el mundo,
// porque es lo que necesitan para trabajar.

export interface Herramienta {
  nombre: string;
  descripcion: string;
  schema: Record<string, any>;
  soloAdmin: boolean;
  ejecutar: (args: any, ctx: Contexto) => Promise<any>;
}

export interface Contexto {
  p: Planillas;
  rol: Rol;
  hoy: string;
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const $ = (n: number) => Math.round(n);

// Año y mes por defecto: el último mes CERRADO, igual que la pantalla de cierre. Preguntar
// "cómo venimos" en el mes en curso devuelve un resultado que siempre da mal —ingresos de
// unos días contra gastos fijos del mes entero— y se lee como una alarma.
function mesPorDefecto(hoy: string): { anio: number; mes: number } {
  const [a, m] = hoy.split('-').map(Number);
  return m === 1 ? { anio: a - 1, mes: 12 } : { anio: a, mes: m - 1 };
}

function rangoMes(anio: number, mes: number) {
  const mm = String(mes).padStart(2, '0');
  return {
    desde: `${anio}-${mm}-01`,
    hasta: `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`,
  };
}

const ARGS_MES = {
  type: 'object',
  properties: {
    anio: { type: 'number', description: 'Año. Si no se dice, el último mes cerrado.' },
    mes: { type: 'number', description: 'Mes 1-12. Si no se dice, el último mes cerrado.' },
  },
};

export const HERRAMIENTAS: Herramienta[] = [
  // ── Operativo: lo ve todo el mundo ────────────────────────────────────────────────
  {
    nombre: 'tareas_de_hoy',
    descripcion: 'Las tareas del día: qué cosechar, cuántas planchas sembrar (los miércoles) y de qué cultivo, por nave.',
    schema: { type: 'object', properties: {} },
    soloAdmin: false,
    ejecutar: async (_a, { p, hoy }) => {
      const [ubicaciones, lotes, movimientos, config] = await Promise.all([
        p.ubicaciones(), p.lotes(), p.movimientos(), p.config(),
      ]);
      const plan = calcularPlan(calcularCapacidad(ubicaciones), diasCicloDefault(lotes, movimientos));
      const cfg = config.find((i) => String(i.clave) === 'plan_reparto');
      const reparto = cfg ? parseReparto(cfg.valor) : REPARTO_DEFAULT;
      const jsDay = new Date(hoy + 'T12:00:00').getDay();
      const siembra = siembraDelDia(plan, reparto, jsDay);
      const pl = planchasSiembra(plan);
      return {
        fecha: hoy,
        tareas: tareasDelDia(plan, reparto, jsDay).map((t) => t.txt),
        siembra: siembra
          ? {
            rucula_planchas: siembra.rucPl, lechuga_planchas: siembra.lecPl, albahaca_planchas: siembra.albPl,
            por_nave: { rucula: [pl.rucN1, pl.rucN2], lechuga: [pl.lecN1, pl.lecN2] },
          }
          : 'Hoy no es día de siembra (se siembra los miércoles).',
      };
    },
  },
  {
    nombre: 'lotes_en_curso',
    descripcion: 'Los lotes activos: variedad, fase, ubicación, días desde la siembra y plantas estimadas. Sirve para "qué hay en la nave 2" o "cuántos lotes de rúcula hay en F2".',
    schema: {
      type: 'object',
      properties: {
        cultivo: { type: 'string', description: 'Filtrar por texto de variedad, ej "rucula", "crespa", "roble", "albahaca".' },
        fase: { type: 'string', description: 'Filtrar por fase: plantinera, f1, f2, cosechado.' },
      },
    },
    soloAdmin: false,
    ejecutar: async (a, { p, hoy }) => {
      const lotes = await p.lotes();
      const norm = (x: any) => String(x || '').toLowerCase();
      const dias = (f: string) => f ? Math.round((new Date(hoy + 'T12:00:00').getTime() - new Date(f + 'T12:00:00').getTime()) / 86400000) : null;
      const activos = lotes
        .filter((l) => String(l.estado || '').toLowerCase() !== 'cerrado' && String(l.fase_actual || '').toLowerCase() !== 'cosechado')
        .filter((l) => !a?.cultivo || norm(l.variedad).includes(norm(a.cultivo)))
        .filter((l) => !a?.fase || norm(l.fase_actual) === norm(a.fase))
        .map((l) => ({
          id: l.id_lote, variedad: l.variedad, fase: l.fase_actual, ubicacion: l.ubicacion_actual,
          dias_desde_siembra: dias(String(l.fecha_siembra || '').split('T')[0]),
          plantas: num(l.plantas_estimadas_actual) || num(l.plantines_iniciales),
        }));
      return { total: activos.length, lotes: activos.slice(0, 60) };
    },
  },
  {
    nombre: 'stock_de_insumos',
    descripcion: 'El stock de insumos de un mes: stock inicial, compras, stock final y consumo del mes por artículo. Con el valorizado solo si quien pregunta es admin. Sirve para "cuántos cubos quedan" o "cuánto se consumió de sustrato".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        articulo: { type: 'string', description: 'Filtrar por nombre de artículo o categoría (búsqueda por texto).' },
      },
    },
    soloAdmin: false,
    ejecutar: async (a, { p, rol, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [articulos, stocks] = await Promise.all([p.articulos(), p.stocks()]);
      const norm = (x: any) => String(x || '').toLowerCase();
      const filas = articulos
        .filter((art) => String(art.activo) === 'SI')
        .filter((art) => !a?.articulo || norm(art.articulo).includes(norm(a.articulo)) || norm(art.categoria).includes(norm(a.articulo)))
        .map((art) => {
          const s = stocks.find((x) => String(x.id_articulo) === String(art.id_articulo)
            && String(x.anio) === String(anio) && String(x.mes) === String(mes));
          const ini = num(s?.stock_inicial), comp = num(s?.compras), fin = num(s?.stock_final);
          const base: any = {
            articulo: art.articulo, categoria: art.categoria, unidad: art.unidad_medida,
            stock_inicial: ini, compras: comp, stock_final: fin,
            consumo: ini + comp - fin,
            recuento_cargado: String(s?.stock_final ?? '').trim() !== '',
          };
          if (rol === 'admin') base.precio_unitario = num(s?.precio_unitario) || null;
          return base;
        });
      const out: any = { anio, mes, articulos: filas };
      if (rol === 'admin') {
        const v = calcularValorizacionMes(articulos, stocks, anio, mes);
        out.stock_valorizado_total = $(v.total);
      }
      return out;
    },
  },

  // ── Plata: solo admin ─────────────────────────────────────────────────────────────
  {
    nombre: 'resultado_del_mes',
    descripcion: 'El estado de resultados de un mes: ventas, costo variable por línea, costos fijos por línea y resultado. Es lo mismo que muestra la pantalla de Cierre mensual.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(), leerPrevisiones(),
      ]);
      const g = previsionDelMes(previsiones, anio, mes);
      const e = calcularEERR({
        articulos, stocks, gastos, ventas, precios, clientes,
        previsiones: g ? { despidos: num(g.despidos), sac: num(g.sac) } : null,
      }, anio, mes);
      return {
        anio, mes,
        ventas: $(e.ventas.total),
        costo_variable: { total: $(e.costoVariable.total), lineas: e.costoVariable.lineas.map((l) => ({ linea: l.label, monto: $(l.monto) })) },
        costos_fijos: { total: $(e.costosFijos.total), lineas: e.costosFijos.lineas.map((l) => ({ linea: l.label, monto: $(l.monto) })) },
        inversion: $(e.inversion),
        resultado: $(e.resultado),
        masa_salarial: $(e.masaSalarial),
        avisos: e.avisos,
      };
    },
  },
  {
    nombre: 'previsiones_del_mes',
    descripcion: 'Las previsiones guardadas de un mes (despidos y SAC sobre la masa salarial, más alquiler y EPE si se cargaron) y las que saldrían hoy. Dice si quedaron viejas.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(), leerPrevisiones(),
      ]);
      const base = calcularEERR({ articulos, stocks, gastos, ventas, precios, clientes }, anio, mes);
      const sug = previsionesSugeridas(base.masaSalarial);
      const g = previsionDelMes(previsiones, anio, mes);
      return {
        anio, mes,
        masa_salarial: $(base.masaSalarial),
        guardadas: g
          ? {
            despidos: $(num(g.despidos)), sac: $(num(g.sac)),
            alquiler: $(num(g.alquiler)), epe: $(num(g.epe)),
            usuario: String(g.usuario || ''), fecha: String(g.fecha_carga || '').split('T')[0],
          }
          : null,
        las_que_darian_hoy: { despidos: $(sug.despidos), sac: $(sug.sac) },
        nota: g
          ? 'Lo guardado es lo que fija el mes y no se recalcula solo. Si no coincide con "las que darían hoy", se cargó un sueldo después de guardarlas.'
          : 'Todavía no están guardadas. Se guardan solas a partir del día 5 del mes siguiente.',
      };
    },
  },
  {
    nombre: 'saldos_de_cuentas',
    descripcion: 'Los saldos de bancos y cajas de un mes: inicial, cobrado, gastos, movimientos entre cuentas, saldo teórico, saldo real del resumen y la diferencia. Sirve para "cuánta plata hay en Macro" o "qué cuenta no cierra".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        cuenta: { type: 'string', description: `Una cuenta puntual: ${MEDIOS_PAGO.join(', ')}. Si se pide una sola, se devuelve además el detalle de sus movimientos.` },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [gastos, cobranzas, saldosGuardados, cacheCob] = await Promise.all([
        p.gastos(), leerCobranzas(), leerSaldos(), p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
      ]);
      const saldos = saldosDelMes(gastos, cobranzas as Cobranza[], saldosGuardados as SaldoCuenta[], anio, mes, cacheCob);
      const pedida = String(a?.cuenta || '').trim();
      const out: any = {
        anio, mes,
        cuentas: saldos.map((s) => ({
          cuenta: s.medio, inicial: $(s.inicial), hay_saldo_inicial: s.hayInicial,
          cobrado: $(s.cobranzas), gastos: $(s.gastos), entre_cuentas: $(s.entradas - s.salidas),
          saldo_teorico: $(s.calculado), saldo_real_del_resumen: s.real === null ? null : $(s.real),
          diferencia: s.diferencia === null ? null : $(s.diferencia),
        })),
        nota: '«Aporte socios» no es una cuenta de caja: es lo que los socios pagaron de su bolsillo, así que su saldo va en negativo y no se suma a la plata disponible. El saldo de VISA es una deuda y va en negativo.',
      };
      const elegida = saldos.find((s) => s.medio.toLowerCase() === pedida.toLowerCase());
      if (elegida) {
        out.detalle = movimientosDeCuenta(elegida.medio, gastos, cobranzas as Cobranza[], anio, mes, cacheCob)
          .map((m) => ({ fecha: m.fecha, descripcion: m.descripcion, monto: $(m.monto), tipo: m.tipo }));
      }
      return out;
    },
  },
  {
    nombre: 'cuenta_corriente_clientes',
    descripcion: 'Qué debe cada cliente: facturas impagas, monto y la más vieja. Con el nombre de un cliente, el detalle de sus facturas abiertas. Es el mismo criterio con el que se le reclama por mail.',
    schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente (búsqueda por texto). Vacío = todos.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      // La misma ventana que usa la pantalla de Cobranzas. No es un detalle: lo que se da
      // por cubierto se calcula repartiendo los cobros del cliente dentro de la ventana, así
      // que con otra ventana la MISMA factura figura cobrada acá y abierta allá.
      const desde = sumarDias(hoy, -365);
      const [compsRaw, cobsRaw, cobros, clientes, saldadasFilas, edic, ajustesRaw] = await Promise.all([
        p.hoja<ComprobanteCache>(HOJA_COMPROBANTES),
        p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
        p.hoja<CobroRegistrado>(HOJA_COBROS),
        p.clientes(), leerSaldadas(), leerEdiciones(), leerAjustes(),
      ]);
      // La caché guarda los comprobantes con otro nombre de campo que el bean de Xubio.
      const comprobantes = comprobantesDesdeCache(compsRaw, desde, hoy);
      const cobranzasXubio = cobranzasDesdeCache(cobsRaw, desde, hoy);
      const todas = facturasPorCliente(
        comprobantes, cobros, clientes, numerosSaldados(saldadasFilas), cobranzasXubio,
        imputacionesManuales(edic, claveComprobante), ajustesPorFactura(ajustesRaw),
      );
      const norm = (x: any) => String(x || '').toLowerCase();
      const filtro = norm(a?.cliente);
      const filas = clientes
        .map((c) => {
          const abiertas = (todas[String(c.id_control)] || [])
            .filter((f) => !f.yaCobrada && !f.saldadaManual && !f.imputadaManual && !f.cubierta)
            .sort((x, y) => x.fecha.localeCompare(y.fecha));
          return { cliente: nombreClienteVisible(c), id: String(c.id_control), abiertas };
        })
        .filter((x) => x.abiertas.length > 0)
        .filter((x) => !filtro || norm(x.cliente).includes(filtro))
        .sort((x, y) => y.abiertas.reduce((s, f) => s + f.importe, 0) - x.abiertas.reduce((s, f) => s + f.importe, 0));
      return {
        total_adeudado: $(filas.reduce((s, x) => s + x.abiertas.reduce((t, f) => t + f.importe, 0), 0)),
        clientes: filas.map((x) => ({
          cliente: x.cliente,
          facturas: x.abiertas.length,
          debe: $(x.abiertas.reduce((s, f) => s + f.importe, 0)),
          mas_vieja: x.abiertas[0]?.fecha || null,
          // El detalle solo cuando se preguntó por un cliente: con todos sería una pared de
          // números que no se puede leer ni resumir bien.
          detalle: filtro ? x.abiertas.map((f) => ({ numero: f.numero, fecha: f.fecha, importe: $(f.importe), corregida: !!f.ajustada })) : undefined,
        })),
        nota: 'Sale de los comprobantes de Xubio menos lo cobrado, lo imputado y lo dado por saldado a mano. No incluye cobros que todavía no llegaron a la copia local.',
      };
    },
  },
  {
    nombre: 'gastos_del_mes',
    descripcion: 'Los gastos de un mes agrupados por categoría, y el detalle de una categoría si se pide. Sirve para "cuánto gastamos en nafta" o "en qué se fue la plata este mes".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        categoria: { type: 'string', description: `Una categoría puntual: ${CATEGORIAS_GASTO.map((c) => c.value).join(', ')}.` },
        buscar: { type: 'string', description: 'Texto a buscar en la descripción del gasto.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const { desde, hasta } = rangoMes(anio, mes);
      const gastos = await p.gastos();
      const norm = (x: any) => String(x || '').toLowerCase();
      const delMes = gastos.filter((g) => {
        const f = String(g.fecha || '').split(/[T ]/)[0];
        return f >= desde && f <= hasta && g.categoria !== 'movimiento_interno';
      });
      const porCat = new Map<string, number>();
      for (const g of delMes) porCat.set(String(g.categoria), (porCat.get(String(g.categoria)) || 0) + num(g.monto));
      const detalle = (a?.categoria || a?.buscar)
        ? delMes
          .filter((g) => !a?.categoria || String(g.categoria) === String(a.categoria))
          .filter((g) => !a?.buscar || norm(g.descripcion).includes(norm(a.buscar)))
          .sort((x, y) => num(y.monto) - num(x.monto))
          .slice(0, 50)
          .map((g) => ({ fecha: String(g.fecha).split('T')[0], descripcion: g.descripcion, categoria: g.categoria, monto: $(num(g.monto)), medio_pago: g.medio_pago }))
        : undefined;
      return {
        anio, mes,
        total: $(delMes.reduce((s, g) => s + num(g.monto), 0)),
        por_categoria: [...porCat.entries()].sort((x, y) => y[1] - x[1]).map(([cat, monto]) => ({ categoria: cat, monto: $(monto) })),
        detalle,
        nota: 'Por fecha de compra (criterio devengado), que es el del resultado. Los movimientos entre cuentas no son gastos y no están.',
      };
    },
  },
  {
    nombre: 'ventas_del_periodo',
    descripcion: 'Lo vendido en un rango de fechas, por cliente y por artículo, valorizado a los precios de cada cliente.',
    schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        cliente: { type: 'string', description: 'Filtrar por nombre de cliente.' },
      },
      required: ['desde', 'hasta'],
    },
    soloAdmin: true,
    ejecutar: async (a, { p }) => {
      const [ventas, precios, clientes] = await Promise.all([p.ventas(), p.precios(), p.clientes()]);
      const { valorDeVenta } = await import('../controlFacturacion');
      const { PROD_KEYS } = await import('../articulos');
      const norm = (x: any) => String(x || '').toLowerCase();
      const desde = String(a.desde), hasta = String(a.hasta);
      const porCliente = new Map<string, { monto: number; unidades: number }>();
      const porArticulo = new Map<string, number>();
      let total = 0;
      for (const v of ventas) {
        const f = String(v.fecha || '').split(/[T ]/)[0];
        if (f < desde || f > hasta) continue;
        const cli = clientes.find((c) => String(c.id_control) === String(v.id_control));
        const nombre = nombreClienteVisible(cli) || String(v.nombre_cliente || '');
        if (a?.cliente && !norm(nombre).includes(norm(a.cliente))) continue;
        const monto = valorDeVenta(v, precios, clientes);
        let unidades = 0;
        for (const k of PROD_KEYS) {
          const q = num((v as any)[k]);
          if (q > 0) { unidades += q; porArticulo.set(k, (porArticulo.get(k) || 0) + q); }
        }
        total += monto;
        const prev = porCliente.get(nombre) || { monto: 0, unidades: 0 };
        porCliente.set(nombre, { monto: prev.monto + monto, unidades: prev.unidades + unidades });
      }
      return {
        desde, hasta, total: $(total),
        por_cliente: [...porCliente.entries()].sort((x, y) => y[1].monto - x[1].monto)
          .map(([cliente, v]) => ({ cliente, monto: $(v.monto), unidades: Math.round(v.unidades) })),
        por_articulo: [...porArticulo.entries()].sort((x, y) => y[1] - x[1])
          .map(([articulo, unidades]) => ({ articulo, unidades: Math.round(unidades) })),
      };
    },
  },
  {
    nombre: 'estado_del_cierre',
    descripcion: 'En qué está el cierre de un mes: qué pasos del checklist están hechos y cuáles faltan, con el detalle de cada uno.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const { pasosDelCierre } = await import('../cierreChecklist');
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones, cobranzas, saldosGuardados, cacheCob] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(),
        leerPrevisiones(), leerCobranzas(), leerSaldos(), p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
      ]);
      const g = previsionDelMes(previsiones, anio, mes);
      const e = calcularEERR({
        articulos, stocks, gastos, ventas, precios, clientes,
        previsiones: g ? { despidos: num(g.despidos), sac: num(g.sac) } : null,
      }, anio, mes);
      const base = calcularEERR({ articulos, stocks, gastos, ventas, precios, clientes }, anio, mes);
      const saldos = saldosDelMes(gastos, cobranzas as Cobranza[], saldosGuardados as SaldoCuenta[], anio, mes, cacheCob);
      const pasos = pasosDelCierre({
        eerr: e, gastos, stocks, articulos, saldos, hayPrevision: !!g, anio, mes,
        previsionGuardada: g ? { despidos: num(g.despidos), sac: num(g.sac), usuario: String(g.usuario || '') } : null,
        previsionDeHoy: previsionesSugeridas(base.masaSalarial),
      });
      return {
        anio, mes,
        pasos: pasos.map((x) => ({ paso: x.titulo, estado: x.estado, detalle: x.detalle, se_marca_a_mano: !!x.manual })),
      };
    },
  },
];

// Las herramientas que puede usar este rol. Se filtran acá, antes de armar el pedido: el
// modelo de un usuario que no es admin no sabe que las otras existen.
export function herramientasPara(rol: Rol): Herramienta[] {
  return HERRAMIENTAS.filter((h) => !h.soloAdmin || rol === 'admin');
}

export function schemasPara(rol: Rol): Anthropic.Tool[] {
  return herramientasPara(rol).map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: h.schema as any,
  }));
}
