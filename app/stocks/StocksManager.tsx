'use client';
import React, { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Articulo, StockMes, Lote, VentaDia, PrecioVenta, ClienteVenta, Gasto } from '@/lib/types';
import { MEDIOS_PAGO } from '@/lib/types';
import { calcularDriversMes, calcularUsoReferencia, categoriaSinUsoTeorico, usoTeoricoDeArticulo, DRIVERS } from '@/lib/usoTeorico';
import { analizarDesviosDeUso, UMBRAL_PCT } from '@/lib/destacadosStock';
import { matchArticuloPorTexto } from '@/lib/matchArticulo';

function copiarTSV(filas: (string | number)[][]) {
  const texto = filas.map((f) => f.join('\t')).join('\n');
  if (navigator.clipboard) navigator.clipboard.writeText(texto).catch(() => {});
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Orden fijo de categorías pedido explícitamente (no alfabético) — lo que no está en esta
// lista se muestra al final, alfabético. Comparación sin tildes/mayúsculas para no
// depender de cómo esté tipeada la categoría en la planilla.
const ORDEN_CATEGORIAS = ['Acido','Packaging','Cajones Plasticos','Espuma Fenolica','Fertilizantes','Fletes','Foliares','Semillas','Energia + Agua','Insumos Limpieza','Cultivos de Reventa','Varios'];
function normalizarCategoria(s: string) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
const ORDEN_CATEGORIAS_NORM = ORDEN_CATEGORIAS.map(normalizarCategoria);

interface Props {
  articulos: Articulo[]; stocks: StockMes[]; lotes: Lote[];
  ventas: VentaDia[]; precios: PrecioVenta[]; clientes: ClienteVenta[];
  gastosSugeridos: Gasto[]; usuario: string;
  // El mes en curso lo calcula el servidor: ver el comentario de arriba.
  anioActual: number;
  mesActual: number;
}

function num(v: any) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ══ Carga masiva (Compras o Stock final): pegar filas "Artículo <tab/coma/espacios> Cantidad" ══
function parseNumero(s: string): number {
  let t = String(s || '').trim().replace(/[^\d.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? NaN : n;
}
interface FilaPreview { linea: string; nombreDetectado: string; cantidad: number; id_articulo: string }
function parsearPegado(texto: string, articulos: Articulo[]): FilaPreview[] {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  return lineas.map((linea) => {
    let partes = linea.split('\t').map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = linea.split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = linea.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    let nombreRaw = '', cantidadRaw = '';
    if (partes.length >= 2) {
      cantidadRaw = partes[partes.length - 1];
      nombreRaw = partes.slice(0, -1).join(' ');
    } else {
      const m = /^(.*?)[\s:–-]+([\d.,]+)\s*$/.exec(linea);
      if (m) { nombreRaw = m[1]; cantidadRaw = m[2]; } else { nombreRaw = linea; }
    }
    const cantidad = parseNumero(cantidadRaw);
    const art = matchArticuloPorTexto(nombreRaw, articulos);
    return { linea, nombreDetectado: nombreRaw, cantidad: isNaN(cantidad) ? 0 : cantidad, id_articulo: art?.id_articulo || '' };
  });
}

function fmt(n: number, maxFrac = 3) { return n.toLocaleString('es-AR', { maximumFractionDigits: maxFrac }); }

export default function StocksManager({ articulos, stocks, lotes, ventas, precios, clientes, gastosSugeridos, usuario, anioActual, mesActual }: Props) {
  const router = useRouter();
  const [anio, setAnio] = useState(anioActual);
  const [mes, setMes] = useState(mesActual);
  const [vista, setVista] = useState<'carga' | 'informe'>('carga');
  const [saving, setSaving] = useState<string | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { ini: string; comp: string; fin: string; precio: string; notas: string }>>({});
  const [mostrarUsos, setMostrarUsos] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  function copiarConAviso(filas: (string | number)[][], aviso: string) {
    copiarTSV(filas);
    setCopiado(aviso);
    setTimeout(() => setCopiado(null), 2000);
  }

  // Crear artículo nuevo desde la sugerencia de compra (Gastos), cuando no está en la lista
  const [creandoArticuloPara, setCreandoArticuloPara] = useState<string | null>(null);
  const [nuevoArt, setNuevoArt] = useState({ articulo: '', categoria: '', unidad_medida: '' });
  const [guardandoArt, setGuardandoArt] = useState(false);

  // Carga masiva de compras / stock final
  const [mostrarCarga, setMostrarCarga] = useState(false);
  const [campoCarga, setCampoCarga] = useState<'compras' | 'stock_final'>('compras');
  const [pegado, setPegado] = useState('');
  const [filasCarga, setFilasCarga] = useState<FilaPreview[] | null>(null);
  const [guardandoMasivo, setGuardandoMasivo] = useState(false);
  const [resultadoMasivo, setResultadoMasivo] = useState<string | null>(null);

  function analizarPegado() {
    setFilasCarga(parsearPegado(pegado, artActivos));
    setResultadoMasivo(null);
  }
  function actualizarFilaCarga(i: number, patch: Partial<FilaPreview>) {
    setFilasCarga((prev) => prev ? prev.map((f, j) => j === i ? { ...f, ...patch } : f) : prev);
  }
  function quitarFilaCarga(i: number) {
    setFilasCarga((prev) => prev ? prev.filter((_, j) => j !== i) : prev);
  }
  async function confirmarCargaMasiva() {
    if (!filasCarga) return;
    const items = filasCarga.filter((f) => f.id_articulo && f.cantidad >= 0).map((f) => ({ id_articulo: f.id_articulo, compras: f.cantidad }));
    if (!items.length) return;
    setGuardandoMasivo(true);
    try {
      const res = await fetch('/api/stocks/compras-masivas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, items, campo: campoCarga }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setResultadoMasivo(`✓ ${j.actualizados} actualizados, ${j.creados} nuevos.`);
      setFilasCarga(null); setPegado('');
      router.refresh();
    } catch (err: any) {
      setResultadoMasivo('Error: ' + (err.message || 'no se pudo guardar'));
    } finally {
      setGuardandoMasivo(false);
    }
  }

  // Ingresar compra puntual de un artículo — crea el Gasto (categoría insumos) y suma la
  // cantidad a "Compras" de este mes en un solo paso, pidiendo cantidad, precio unitario
  // y medio de pago (obligatorio: sin medio de pago no deja confirmar). Una sola entrada:
  // el botón "Cargar compra" de arriba de todo, donde se elige el artículo. Antes había
  // además un 🛒 por fila con su propio panel — dos caminos al mismo lugar, y en la fila
  // convivía con un campo "Compras" editable que hacía lo mismo pero SIN medio de pago.
  // Las compras se cargan desde el boton grande de arriba; en la lista solo se ven. Este
  // estado es para corregir a mano lo ya cargado de un articulo en el mes.
  const [editandoCompras, setEditandoCompras] = useState<string | null>(null);
  const [compraGeneral, setCompraGeneral] = useState(false);
  const [compraGeneralArticulo, setCompraGeneralArticulo] = useState('');
  const [compraCantidad, setCompraCantidad] = useState('');
  const [compraPrecio, setCompraPrecio] = useState('');
  const [compraMedioPago, setCompraMedioPago] = useState('');
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  const [errorCompra, setErrorCompra] = useState<string | null>(null);

  function resetFormCompra() {
    setCompraCantidad(''); setCompraPrecio(''); setCompraMedioPago(''); setErrorCompra(null);
  }
  function abrirCompraGeneral() {
    setCompraGeneral(true); setCompraGeneralArticulo(''); setCreandoArticuloPara(null);
    resetFormCompra();
  }
  async function confirmarCompra(id_articulo: string) {
    const cant = Number(compraCantidad), precio = Number(compraPrecio);
    if (!id_articulo) { setErrorCompra('Elegí un artículo.'); return; }
    if (!(cant > 0)) { setErrorCompra('Ingresá una cantidad válida.'); return; }
    if (!(precio > 0)) { setErrorCompra('Ingresá un precio válido.'); return; }
    if (!compraMedioPago) { setErrorCompra('Elegí un medio de pago.'); return; }
    setGuardandoCompra(true); setErrorCompra(null);
    try {
      const res = await fetch('/api/stocks/comprar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_articulo, anio, mes, cantidad: cant, precio_unitario: precio, medio_pago: compraMedioPago }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setCompraGeneral(false);
      router.refresh();
    } catch (err: any) {
      setErrorCompra(err.message || 'No se pudo guardar la compra');
    } finally {
      setGuardandoCompra(false);
    }
  }

  const categorias = useMemo(() => {
    const todas = Array.from(new Set(articulos.map((a) => a.categoria)));
    return todas.sort((a, b) => {
      const ia = ORDEN_CATEGORIAS_NORM.indexOf(normalizarCategoria(a));
      const ib = ORDEN_CATEGORIAS_NORM.indexOf(normalizarCategoria(b));
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [articulos]);

  // Drivers de producción/ventas del mes seleccionado — alimentan el Uso Teórico configurado por artículo.
  const drivers = useMemo(() => calcularDriversMes(lotes, ventas, precios, clientes, anio, mes), [lotes, ventas, precios, clientes, anio, mes]);

  const { anioPrev, mesPrev } = useMemo(() => {
    let m = mes - 1, a = anio;
    if (m === 0) { m = 12; a--; }
    return { anioPrev: a, mesPrev: m };
  }, [anio, mes]);

  // Drivers del mes anterior — sólo se usan para artículos SIN fórmula de uso teórico, como
  // base de comparación de venta ("Uso de referencia": ver calcularUsoReferencia).
  const driversMesAnterior = useMemo(() => calcularDriversMes(lotes, ventas, precios, clientes, anioPrev, mesPrev), [lotes, ventas, precios, clientes, anioPrev, mesPrev]);

  // Stock del mes seleccionado
  const stockMes = useMemo(() =>
    stocks.filter((s) => String(s.anio) === String(anio) && String(s.mes) === String(mes)),
    [stocks, anio, mes]
  );

  function getStock(id_articulo: string) {
    return stockMes.find((s) => s.id_articulo === id_articulo);
  }

  // El stock inicial NO se edita: por definicion es el stock final del mes anterior. Antes
  // era un campo mas y podia quedar desalineado con el cierre del mes previo, que es
  // justamente lo que rompe la cadena de `inicial + compras - final`.
  function stockInicialDe(id: string): string {
    let mesPrev = mes - 1, anioPrev = anio;
    if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
    const sPrev = stocks.find((st) => st.id_articulo === id && String(st.anio) === String(anioPrev) && String(st.mes) === String(mesPrev));
    return sPrev && num(sPrev.stock_final) > 0 ? String(num(sPrev.stock_final)) : '';
  }

  function getEdit(id: string) {
    const ini = stockInicialDe(id);
    const s = getStock(id);
    if (editValues[id]) return { ...editValues[id], ini };
    if (s) return { ini, comp: String(num(s.compras)), fin: String(num(s.stock_final)), precio: num(s.precio_unitario) > 0 ? String(num(s.precio_unitario)) : '', notas: s.notas || '' };
    return { ini, comp: '', fin: '', precio: '', notas: '' };
  }

  // Último precio de compra conocido de un artículo, a la fecha del mes visualizado
  // (o antes) — usa el valor recién tipeado en pantalla si lo hay, si no busca hacia
  // atrás en Stocks el registro más reciente con precio_unitario cargado.
  function precioUltimoConocido(id_articulo: string, precioTipeado?: number): number | null {
    if (precioTipeado && precioTipeado > 0) return precioTipeado;
    const claveActual = anio * 12 + mes;
    const candidatos = stocks.filter((s) =>
      s.id_articulo === id_articulo && num(s.precio_unitario) > 0 && (Number(s.anio) * 12 + Number(s.mes)) <= claveActual
    );
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => (Number(a.anio) * 12 + Number(a.mes)) - (Number(b.anio) * 12 + Number(b.mes)));
    return num(candidatos[candidatos.length - 1].precio_unitario);
  }

  function setField(id: string, field: string, val: string) {
    const cur = getEdit(id);
    setEditValues((prev) => ({ ...prev, [id]: { ...cur, [field]: val } }));
  }

  // Autoguardado: no se espera un click en "✓" — al salir de una celda (blur) se guarda
  // solo, si quedó algo sin guardar. Con un pequeño debounce por artículo para no disparar
  // un guardado por cada campo de la misma fila si el usuario va tabulando rápido entre
  // Stock inicial → Compras → Precio → Stock final.
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function autoguardar(id_articulo: string) {
    if (editValues[id_articulo] === undefined) return; // sin cambios pendientes, nada que guardar
    if (autosaveTimers.current[id_articulo]) clearTimeout(autosaveTimers.current[id_articulo]);
    autosaveTimers.current[id_articulo] = setTimeout(() => {
      const art = artActivos.find((a) => a.id_articulo === id_articulo);
      if (art) guardar(art);
    }, 400);
  }

  async function guardar(art: Articulo) {
    setSaving(art.id_articulo); setErrorGuardado(null);
    const vals = getEdit(art.id_articulo);
    try {
      const res = await fetch('/api/stocks/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_articulo: art.id_articulo, anio, mes,
          stock_inicial: vals.ini, compras: vals.comp,
          stock_final: vals.fin, precio_unitario: vals.precio, notas: vals.notas,
        }),
      });
      const j = await res.json().catch(() => ({}));
      // Antes no se chequeaba res.ok: si el guardado fallaba en el servidor (ej. un error
      // de Sheets), igual se borraba la marca de "sin guardar" acá abajo y quedaba como
      // si hubiera funcionado — el usuario nunca se enteraba de que en realidad no se
      // guardó nada (reportado con "editar el precio de compra no queda guardado").
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setEditValues((prev) => { const n = { ...prev }; delete n[art.id_articulo]; return n; });
      router.refresh();
    } catch (err: any) {
      setErrorGuardado(`${art.articulo}: ${err.message || 'no se pudo guardar'}`);
    } finally {
      setSaving(null);
    }
  }

  // Informe: últimos 6 meses por artículo
  function getMesesAnteriores() {
    const meses: { anio: number; mes: number; label: string }[] = [];
    let a = anio, m = mes;
    for (let i = 0; i < 6; i++) {
      meses.unshift({ anio: a, mes: m, label: MESES[m - 1].slice(0, 3) + ' ' + a });
      m--; if (m === 0) { m = 12; a--; }
    }
    return meses;
  }

  const mesesInforme = getMesesAnteriores();

  function getUso(id_articulo: string, a: number, m: number) {
    const s = stocks.find((s) => s.id_articulo === id_articulo && String(s.anio) === String(a) && String(s.mes) === String(m));
    if (!s) return null;
    return num(s.uso_calculado);
  }

  const artActivos = articulos.filter((a) => a.activo === 'SI');

  // Resumen real/teórico/diferencia por artículo para el mes seleccionado — reutilizado
  // por la tabla principal y por la vista consolidada.
  const resumenArticulos = useMemo(() => {
    return artActivos.map((art) => {
      const vals = getEdit(art.id_articulo);
      const ini = num(vals.ini), comp = num(vals.comp), fin = num(vals.fin);
      const usoReal = ini + comp - fin;
      const usoTeorico = usoTeoricoDeArticulo(art, drivers);
      const diff = usoTeorico !== null ? usoReal - usoTeorico : null;
      const pct = usoTeorico !== null && usoTeorico !== 0 ? (diff! / usoTeorico) * 100 : null;
      // Sin fórmula configurada: en vez de "—", una referencia = uso del mes anterior
      // escalado por la variación de venta total mes vs. mes anterior. No aplica a las
      // categorías excluidas: ahí el uso no sigue a la venta y la referencia sería tan
      // inventada como el teórico (ver categoriaSinUsoTeorico).
      let usoReferencia: number | null = null;
      if (usoTeorico === null && !categoriaSinUsoTeorico(art.categoria)) {
        const usoMesAnterior = getUso(art.id_articulo, anioPrev, mesPrev);
        usoReferencia = calcularUsoReferencia(usoMesAnterior, drivers.paquetes_vendidos_total, driversMesAnterior.paquetes_vendidos_total);
      }
      const esReferencia = usoTeorico === null && usoReferencia !== null;
      const precio = precioUltimoConocido(art.id_articulo, num(vals.precio));
      const valorizado = precio !== null ? fin * precio : null;
      // Uso del mes pasado (real, ya cerrado) — para comparar contra el uso real de este
      // mes y ver de un vistazo si se usó más o menos, sin depender de que haya fórmula
      // de uso teórico configurada.
      const usoMesPasado = getUso(art.id_articulo, anioPrev, mesPrev);
      const pctVsMesPasado = usoMesPasado !== null && usoMesPasado !== 0 ? ((usoReal - usoMesPasado) / Math.abs(usoMesPasado)) * 100 : null;
      // Vacío no es lo mismo que cero: si el recuento de fin de mes no se hizo, no hay uso
      // real que comparar (ver analizarDesviosDeUso).
      const finCargado = String(vals.fin ?? '').trim() !== '';
      return { art, ini, comp, fin, finCargado, usoReal, usoTeorico, diff, pct, usoReferencia, esReferencia, precio, valorizado, usoMesPasado, pctVsMesPasado };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artActivos, editValues, stockMes, drivers, driversMesAnterior, stocks, anio, mes, anioPrev, mesPrev]);

  // Vista consolidada del mes
  const consolidado = useMemo(() => {
    const conFormula = resumenArticulos.filter((r) => r.usoTeorico !== null && (r.ini || r.comp || r.fin));
    const rojos = conFormula.filter((r) => (r.diff ?? 0) > 0);
    const verdes = conFormula.filter((r) => (r.diff ?? 0) <= 0);
    const top = [...conFormula].filter((r) => r.pct !== null).sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!)).slice(0, 3);
    const valorizacionTotal = resumenArticulos.reduce((acc, r) => acc + (r.valorizado ?? 0), 0);
    const sinPrecio = resumenArticulos.filter((r) => r.fin > 0 && r.precio === null).length;
    const porCategoria = Array.from(new Set(resumenArticulos.map((r) => r.art.categoria)))
      .map((cat) => ({ categoria: cat, valorizado: resumenArticulos.filter((r) => r.art.categoria === cat).reduce((acc, r) => acc + (r.valorizado ?? 0), 0) }))
      .filter((c) => c.valorizado > 0)
      .sort((a, b) => b.valorizado - a.valorizado);
    return {
      total: conFormula.length, rojos: rojos.length, verdes: verdes.length, top,
      sinConfigurar: artActivos.filter((a) => !a.formula_uso).length,
      valorizacionTotal, sinPrecio, porCategoria,
    };
  }, [resumenArticulos, artActivos]);

  // Los tres o cuatro artículos que se fueron de línea este mes, para no tener que leer la
  // tabla entera buscándolos. La lógica de qué es "grande" vive en lib/destacadosStock.ts.
  const analisisUso = useMemo(() => analizarDesviosDeUso(resumenArticulos.map((r) => ({
    id: r.art.id_articulo,
    articulo: r.art.articulo,
    unidad: r.art.unidad_medida,
    ini: r.ini, comp: r.comp, fin: r.fin, finCargado: r.finCargado,
    usoReal: r.usoReal,
    usoTeorico: r.usoTeorico,
    usoMesPasado: r.usoMesPasado,
    precio: r.precio,
  }))), [resumenArticulos]);

  // Gastos "insumos" del mes seleccionado, aún no aplicados — sugerencia de compra.
  const [matchOverride, setMatchOverride] = useState<Record<string, string>>({});
  const [cantidadGasto, setCantidadGasto] = useState<Record<string, string>>({});
  const [procesandoGasto, setProcesandoGasto] = useState<string | null>(null);
  const gastosDelMes = useMemo(() => {
    return gastosSugeridos.filter((g) => {
      const f = String(g.fecha || '').split(/[T ]/)[0];
      const [gy, gm] = f.split('-').map(Number);
      return gy === anio && gm === mes;
    });
  }, [gastosSugeridos, anio, mes]);

  async function confirmarGasto(g: Gasto, idArticulo: string, cantidadStr: string) {
    const cant = Number(cantidadStr);
    if (!idArticulo || idArticulo === '__nuevo__' || !(cant > 0)) return;
    setProcesandoGasto(g.id_gasto);
    try {
      await fetch('/api/stocks/gastos-aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: g.id_gasto, id_articulo: idArticulo, anio, mes, cantidad: cant }),
      });
      router.refresh();
    } catch {}
    setProcesandoGasto(null);
  }
  async function descartarGasto(g: Gasto) {
    setProcesandoGasto(g.id_gasto);
    try {
      await fetch('/api/stocks/gastos-aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: g.id_gasto, descartar: true }),
      });
      router.refresh();
    } catch {}
    setProcesandoGasto(null);
  }

  // Alta de artículo nuevo en el momento — reusada desde dos lugares: la sugerencia de
  // compra de Gastos y el panel general de "Cargar compra" de arriba (ambos ofrecen
  // "+ Crear artículo nuevo…" en su desplegable cuando el insumo todavía no existe).
  const [errorCrearArt, setErrorCrearArt] = useState<string | null>(null);
  async function crearArticulo(): Promise<string | null> {
    if (!nuevoArt.articulo.trim() || !nuevoArt.categoria.trim() || !nuevoArt.unidad_medida.trim()) return null;
    setGuardandoArt(true); setErrorCrearArt(null);
    try {
      const res = await fetch('/api/admin/articulos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoArt),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setNuevoArt({ articulo: '', categoria: '', unidad_medida: '' });
      router.refresh();
      return j.id_articulo as string;
    } catch (err: any) {
      setErrorCrearArt(err.message || 'No se pudo crear el artículo');
      return null;
    } finally {
      setGuardandoArt(false);
    }
  }
  async function crearArticuloYAsignar(idGasto: string) {
    const id = await crearArticulo();
    if (!id) return;
    setMatchOverride((p) => ({ ...p, [idGasto]: id }));
    setCreandoArticuloPara(null);
  }
  async function crearArticuloParaCompra() {
    const id = await crearArticulo();
    if (!id) return;
    setCompraGeneralArticulo(id);
    setCreandoArticuloPara(null);
  }

  return (
    <div>
      {/* Selector de mes y vista */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: '90px' }}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ width: '130px' }}>
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setVista('carga')} className={vista === 'carga' ? 'btn' : 'btn secondary'} style={{ fontSize: '12px' }}>
            Carga mensual
          </button>
          <button onClick={() => setVista('informe')} className={vista === 'informe' ? 'btn' : 'btn secondary'} style={{ fontSize: '12px' }}>
            Informe comparativo
          </button>
        </div>
        {vista === 'carga' && (
          <button onClick={() => { setMostrarCarga((v) => !v); setResultadoMasivo(null); }} className="btn secondary" style={{ fontSize: '12px' }}>
            📋 Carga masiva
          </button>
        )}
      </div>

      {/* Botón grande de "Cargar compra" — a pedido explícito, arriba de todo y bien visible,
          para no tener que buscar la fila del artículo dentro de su categoría para el 🛒
          chico. Si el insumo todavía no está dado de alta, se puede crear acá mismo. */}
      {vista === 'carga' && (
        <div style={{ marginBottom: '14px' }}>
          {!compraGeneral ? (
            <button onClick={abrirCompraGeneral} className="btn" style={{ fontSize: '15px', fontWeight: 700, padding: '13px 24px' }}>
              🛒 Cargar compra
            </button>
          ) : (
            <div className="card" style={{ border: '1px solid #93c5fd', background: '#eff6ff' }}>
              <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>
                🛒 Cargar compra — {MESES[mes - 1]} {anio}
              </p>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '240px' }}>
                  <label style={{ fontSize: '10px' }}>Artículo</label>
                  <select
                    value={creandoArticuloPara === '__top__' ? '__nuevo__' : compraGeneralArticulo}
                    onChange={(e) => {
                      if (e.target.value === '__nuevo__') { setCreandoArticuloPara('__top__'); setNuevoArt({ articulo: '', categoria: '', unidad_medida: '' }); setErrorCrearArt(null); }
                      else { setCreandoArticuloPara(null); setCompraGeneralArticulo(e.target.value); }
                    }}
                    disabled={guardandoCompra}
                    style={{ width: '100%', fontSize: '13px', padding: '6px 8px', color: compraGeneralArticulo || creandoArticuloPara === '__top__' ? '#111827' : '#dc2626' }}>
                    <option value="">— elegir artículo —</option>
                    <option value="__nuevo__">+ Crear artículo nuevo…</option>
                    {categorias.map((cat) => (
                      <optgroup key={cat} label={cat}>
                        {artActivos.filter((a) => a.categoria === cat).map((a) => <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {creandoArticuloPara === '__top__' && (
                  <>
                    <div>
                      <label style={{ fontSize: '10px' }}>Nombre</label>
                      <input type="text" value={nuevoArt.articulo} onChange={(e) => setNuevoArt((p) => ({ ...p, articulo: e.target.value }))}
                        style={{ fontSize: '12px', padding: '5px 8px' }} placeholder="Ej: Cubos Oasis" disabled={guardandoArt} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px' }}>Categoría</label>
                      <input type="text" value={nuevoArt.categoria} onChange={(e) => setNuevoArt((p) => ({ ...p, categoria: e.target.value }))}
                        style={{ fontSize: '12px', padding: '5px 8px' }} placeholder="Ej: Sustratos" disabled={guardandoArt} list="categorias-existentes-top" />
                      <datalist id="categorias-existentes-top">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px' }}>Unidad</label>
                      <input type="text" value={nuevoArt.unidad_medida} onChange={(e) => setNuevoArt((p) => ({ ...p, unidad_medida: e.target.value }))}
                        style={{ fontSize: '12px', padding: '5px 8px', width: '80px' }} placeholder="unidad" disabled={guardandoArt} />
                    </div>
                    <button onClick={crearArticuloParaCompra} className="btn" style={{ fontSize: '12px', padding: '6px 14px' }}
                      disabled={guardandoArt || !nuevoArt.articulo.trim() || !nuevoArt.categoria.trim() || !nuevoArt.unidad_medida.trim()}>
                      {guardandoArt ? 'Creando…' : 'Crear y elegir'}
                    </button>
                  </>
                )}

                {compraGeneralArticulo && creandoArticuloPara !== '__top__' && (
                  <>
                    <div>
                      <label style={{ fontSize: '10px' }}>Cantidad ({artActivos.find((a) => a.id_articulo === compraGeneralArticulo)?.unidad_medida})</label>
                      <input type="number" min={0} step={0.001} value={compraCantidad} onChange={(e) => setCompraCantidad(e.target.value)}
                        style={{ width: '110px', fontSize: '12px', padding: '5px 8px' }} disabled={guardandoCompra} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#dc2626', fontWeight: 700 }}>Precio unitario (IVA incluido)</label>
                      <input type="number" min={0} step={0.1} value={compraPrecio} onChange={(e) => setCompraPrecio(e.target.value)}
                        style={{ width: '110px', fontSize: '12px', padding: '5px 8px' }} disabled={guardandoCompra} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px' }}>Medio de pago</label>
                      <select value={compraMedioPago} onChange={(e) => setCompraMedioPago(e.target.value)}
                        style={{ width: '140px', fontSize: '12px', padding: '5px 8px', color: compraMedioPago ? '#111827' : '#dc2626' }} disabled={guardandoCompra}>
                        <option value="">— elegir —</option>
                        {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {Number(compraCantidad) > 0 && Number(compraPrecio) > 0 && (
                      <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
                        Total: <strong>${fmt(Number(compraCantidad) * Number(compraPrecio), 0)}</strong>
                      </p>
                    )}
                    <button onClick={() => confirmarCompra(compraGeneralArticulo)} disabled={guardandoCompra} className="btn" style={{ fontSize: '12px', padding: '6px 14px' }}>
                      {guardandoCompra ? 'Guardando…' : '✓ Confirmar compra'}
                    </button>
                  </>
                )}
                <button onClick={() => { setCompraGeneral(false); setCreandoArticuloPara(null); }} className="btn secondary" style={{ fontSize: '12px', padding: '6px 14px' }} disabled={guardandoCompra}>
                  Cancelar
                </button>
              </div>
              {errorCrearArt && creandoArticuloPara === '__top__' && <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#dc2626' }}>{errorCrearArt}</p>}
              {errorCompra && <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#dc2626' }}>{errorCompra}</p>}
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#6b7280' }}>
                Esto suma la cantidad a "Compras" del mes elegido y crea el gasto correspondiente (categoría Insumos, medio de pago obligatorio) en la planilla de Gastos.
              </p>
            </div>
          )}
        </div>
      )}

      {errorGuardado && (
        <div className="alert-box error" style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span>⚠️ No se guardó: {errorGuardado}</span>
          <button onClick={() => setErrorGuardado(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ===== VISTA: CARGA MENSUAL ===== */}
      {vista === 'carga' && (
        <div>
          {/* Vista consolidada del mes */}
          <div id="resumen-mes" className="card" style={{ marginBottom: '12px', scrollMarginTop: '16px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Resumen del mes — {MESES[mes - 1]} {anio}
            </p>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626' }}>{consolidado.rojos}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>por encima del teórico</span>
              </div>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#059669' }}>{consolidado.verdes}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>en línea o por debajo</span>
              </div>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#111827' }}>${fmt(consolidado.valorizacionTotal, 0)}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>stock final valorizado</span>
              </div>
              {consolidado.sinConfigurar > 0 && (
                <div>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>{consolidado.sinConfigurar} artículo(s) sin fórmula configurada</span>
                </div>
              )}
            </div>
            {/* Lo que se fue de línea: arriba de todo, para no tener que barrer la tabla. */}
            <div style={{ marginTop: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Lo que se fue de línea — {MESES[mes - 1]} {anio}
              </p>
              {analisisUso.destacados.length === 0 ? (
                <p style={{ margin: 0, fontSize: '12px', color: analisisUso.sinStockFinal > 0 ? '#92400e' : '#059669' }}>
                  {analisisUso.sinStockFinal > 0
                    ? `Todavía no se puede comparar: faltan cargar ${analisisUso.sinStockFinal} stock(s) final(es) de este mes.`
                    : `Ningún artículo se desvió más de ${UMBRAL_PCT}% de su referencia este mes.`}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {analisisUso.destacados.map((d) => {
                    const mas = d.desvio > 0;
                    const color = mas ? '#dc2626' : '#059669';
                    return (
                      <div key={d.id} style={{ borderLeft: `3px solid ${color}`, paddingLeft: '10px' }}>
                        <p style={{ margin: 0, fontSize: '13px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 700 }}>{d.articulo}</span>
                          <span style={{ color, fontWeight: 800 }}>
                            {mas ? '+' : '−'}{fmt(Math.abs(d.desvio))} {d.unidad}
                            {d.desvioPct !== null && ` (${mas ? '+' : ''}${fmt(d.desvioPct, 0)}%)`}
                          </span>
                          {d.desvioPesos !== null && (
                            <span style={{ color, fontWeight: 700, fontSize: '12px' }}>
                              ≈ {mas ? '+' : '−'}${fmt(Math.abs(d.desvioPesos), 0)}
                            </span>
                          )}
                        </p>
                        <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#4b5563' }}>
                          Usó <strong>{fmt(d.usoReal)} {d.unidad}</strong> y {d.referencia === 'teorico' ? 'el teórico' : 'el mes pasado'} daba{' '}
                          <strong>{fmt(d.esperado)} {d.unidad}</strong> · <span style={{ color: '#9ca3af' }}>{d.detalle}</span>
                        </p>
                        <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#6b7280' }}>{d.nota}</p>
                      </div>
                    );
                  })}
                  {analisisUso.sinStockFinal > 0 && (
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#92400e' }}>
                      Quedan {analisisUso.sinStockFinal} artículo(s) sin stock final cargado este mes: hasta que se cuenten, su uso no se puede comparar.
                    </p>
                  )}
                </div>
              )}
            </div>
            {consolidado.sinConfigurar > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '6px 10px' }}>
                El "Uso teórico" de cada artículo se calcula con los números de "Usos del sistema" de abajo (planchas sembradas, paquetes vendidos, etc.) — asignale una fórmula y un factor en{' '}
                <Link href="/admin/articulos" style={{ color: '#92400e', fontWeight: 700, textDecoration: 'underline' }}>Admin → Artículos</Link> para tener un target preciso. Mientras tanto, esos artículos muestran un "Uso ref." (≈) estimado a partir del uso del mes anterior ajustado por la venta total — solo orientativo.
              </p>
            )}
            {consolidado.sinPrecio > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>
                {consolidado.sinPrecio} artículo(s) con stock final pero sin precio de compra cargado aún — no entran en la valorización.
              </p>
            )}
            {consolidado.porCategoria.length > 0 && (
              <div style={{ marginTop: '10px', borderTop: '1px solid #f3f4f6', paddingTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' }}>Stock valorizado por categoría — {MESES[mes - 1]} {anio}</p>
                  <button
                    onClick={() => copiarConAviso(
                      [['Categoría', 'Valorizado'], ...consolidado.porCategoria.map((c) => [c.categoria, Math.round(c.valorizado)]),
                        ['TOTAL', Math.round(consolidado.valorizacionTotal)]],
                      'Categorías copiadas — pegalo en Excel'
                    )}
                    className="btn secondary" style={{ fontSize: '11px', padding: '3px 8px' }}
                  >
                    📋 Copiar
                  </button>
                </div>
                <table style={{ fontSize: '12px', width: '100%', maxWidth: '360px' }}>
                  <tbody>
                    {consolidado.porCategoria.map((c) => (
                      <tr key={c.categoria}>
                        <td style={{ color: '#6b7280', padding: '2px 0' }}>{c.categoria}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, padding: '2px 0' }}>${fmt(c.valorizado, 0)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ fontWeight: 700, padding: '4px 0' }}>Total</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, padding: '4px 0' }}>${fmt(consolidado.valorizacionTotal, 0)}</td>
                    </tr>
                  </tbody>
                </table>
                {copiado && <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#059669', fontWeight: 600 }}>✓ {copiado}</p>}
              </div>
            )}
          </div>

          {/* Sugerencias de compra desde Gastos */}
          {gastosDelMes.length > 0 && (
            <div className="card" style={{ marginBottom: '12px', border: '1px solid #fde68a', background: '#fffbeb' }}>
              <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700 }}>Sugerencias de compra desde Gastos — {gastosDelMes.length} pendiente(s)</p>
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Fecha</th>
                    <th style={{ textAlign: 'left' }}>Descripción</th>
                    <th style={{ textAlign: 'right', width: '90px' }}>Monto</th>
                    <th style={{ textAlign: 'left', width: '200px' }}>Artículo</th>
                    <th style={{ textAlign: 'right', width: '100px' }}>Cantidad</th>
                    <th style={{ width: '140px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {gastosDelMes.map((g) => {
                    // Preferir el vínculo directo cargado en Gastos (detalle de insumo); si no
                    // hay, caer al match difuso por descripción como antes.
                    const matchAuto = matchArticuloPorTexto(g.descripcion, artActivos);
                    const idSel = matchOverride[g.id_gasto] ?? (g.id_articulo || matchAuto?.id_articulo || '');
                    const cantidadDefault = cantidadGasto[g.id_gasto] ?? (num(g.cantidad) > 0 ? String(num(g.cantidad)) : '');
                    const creandoAqui = creandoArticuloPara === g.id_gasto;
                    return (
                      <React.Fragment key={g.id_gasto}>
                        <tr key={g.id_gasto}>
                          <td style={{ color: '#6b7280' }}>{String(g.fecha).split(/[T ]/)[0]}</td>
                          <td>{g.descripcion}</td>
                          <td style={{ textAlign: 'right' }}>${fmt(num(g.monto), 0)}</td>
                          <td style={{ padding: '2px 4px' }}>
                            <select value={idSel === '__nuevo__' ? '__nuevo__' : idSel}
                              onChange={(e) => {
                                if (e.target.value === '__nuevo__') { setCreandoArticuloPara(g.id_gasto); setNuevoArt({ articulo: '', categoria: '', unidad_medida: '' }); }
                                else setMatchOverride((p) => ({ ...p, [g.id_gasto]: e.target.value }));
                              }}
                              style={{ width: '100%', fontSize: '12px', color: idSel ? '#111827' : '#dc2626' }}>
                              <option value="">— sin coincidencia —</option>
                              <option value="__nuevo__">+ Crear artículo nuevo…</option>
                              {artActivos.map((a) => <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" min={0} step={0.001} value={cantidadDefault}
                              onChange={(e) => setCantidadGasto((p) => ({ ...p, [g.id_gasto]: e.target.value }))}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px' }} placeholder="cant." />
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={() => confirmarGasto(g, idSel, cantidadDefault)} disabled={procesandoGasto === g.id_gasto || !idSel || idSel === '__nuevo__' || !(Number(cantidadDefault) > 0)}
                              className="btn" style={{ fontSize: '11px', padding: '3px 8px', marginRight: '4px' }}>
                              {procesandoGasto === g.id_gasto ? '…' : 'Confirmar'}
                            </button>
                            <button onClick={() => descartarGasto(g)} disabled={procesandoGasto === g.id_gasto}
                              className="btn secondary" style={{ fontSize: '11px', padding: '3px 8px' }}>
                              Descartar
                            </button>
                          </td>
                        </tr>
                        {creandoAqui && (
                          <tr>
                            <td colSpan={6} style={{ background: '#eff6ff', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div>
                                  <label style={{ fontSize: '10px' }}>Nombre</label>
                                  <input type="text" value={nuevoArt.articulo} onChange={(e) => setNuevoArt((p) => ({ ...p, articulo: e.target.value }))}
                                    style={{ fontSize: '12px', padding: '4px 6px' }} placeholder="Ej: Cubos Oasis" disabled={guardandoArt} />
                                </div>
                                <div>
                                  <label style={{ fontSize: '10px' }}>Categoría</label>
                                  <input type="text" value={nuevoArt.categoria} onChange={(e) => setNuevoArt((p) => ({ ...p, categoria: e.target.value }))}
                                    style={{ fontSize: '12px', padding: '4px 6px' }} placeholder="Ej: Sustratos" disabled={guardandoArt} list="categorias-existentes" />
                                  <datalist id="categorias-existentes">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
                                </div>
                                <div>
                                  <label style={{ fontSize: '10px' }}>Unidad</label>
                                  <input type="text" value={nuevoArt.unidad_medida} onChange={(e) => setNuevoArt((p) => ({ ...p, unidad_medida: e.target.value }))}
                                    style={{ fontSize: '12px', padding: '4px 6px', width: '80px' }} placeholder="unidad" disabled={guardandoArt} />
                                </div>
                                <button onClick={() => crearArticuloYAsignar(g.id_gasto)} className="btn" style={{ fontSize: '11px', padding: '5px 10px' }}
                                  disabled={guardandoArt || !nuevoArt.articulo.trim() || !nuevoArt.categoria.trim() || !nuevoArt.unidad_medida.trim()}>
                                  {guardandoArt ? 'Creando…' : 'Crear y asignar'}
                                </button>
                                <button onClick={() => setCreandoArticuloPara(null)} className="btn secondary" style={{ fontSize: '11px', padding: '5px 10px' }} disabled={guardandoArt}>
                                  Cancelar
                                </button>
                              </div>
                              {errorCrearArt && <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#dc2626' }}>{errorCrearArt}</p>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#92400e' }}>
                Confirmar suma la cantidad indicada a "Compras" del artículo para este mes. Descartar la oculta sin tocar el stock (ej: gastos que no son insumos físicos).
                Si el gasto ya trae artículo y cantidad cargados (Gastos → detalle de insumo), quedan pre-completados acá.
              </p>
            </div>
          )}

          {/* Panel de carga masiva */}
          {mostrarCarga && (
            <div className="card" style={{ marginBottom: '12px', border: '1px solid #93c5fd', background: '#eff6ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Carga masiva — {MESES[mes - 1]} {anio}</p>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => setCampoCarga('compras')} className={campoCarga === 'compras' ? 'btn' : 'btn secondary'} style={{ fontSize: '11px', padding: '3px 10px' }}>Compras</button>
                  <button onClick={() => setCampoCarga('stock_final')} className={campoCarga === 'stock_final' ? 'btn' : 'btn secondary'} style={{ fontSize: '11px', padding: '3px 10px' }}>Stock final</button>
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280' }}>
                Pegá filas de tu remito, conteo o planilla, una por artículo: <code>Nombre del artículo · Cantidad</code> (funciona con tabulaciones, comas o espacios, tal cual se copia de Excel/Sheets). Esto <strong>reemplaza</strong> el valor de {campoCarga === 'compras' ? 'Compras' : 'Stock final'} de ese mes para cada artículo, no lo suma.
              </p>
              {!filasCarga ? (
                <>
                  <textarea rows={6} value={pegado} onChange={(e) => setPegado(e.target.value)}
                    placeholder={'Cubos Oasis\t50\nGreen Up\t20\nBandejas rúcula\t300'}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px', resize: 'vertical' }} />
                  <div style={{ marginTop: '8px' }}>
                    <button onClick={analizarPegado} className="btn" style={{ fontSize: '12px' }} disabled={!pegado.trim()}>Analizar</button>
                  </div>
                </>
              ) : (
                <>
                  <table style={{ fontSize: '12px', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Línea pegada</th>
                        <th style={{ textAlign: 'left', width: '220px' }}>Artículo</th>
                        <th style={{ textAlign: 'right', width: '100px' }}>{campoCarga === 'compras' ? 'Compras' : 'Stock final'}</th>
                        <th style={{ width: '30px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasCarga.map((f, i) => (
                        <tr key={i} style={{ background: f.id_articulo ? 'transparent' : '#fef2f2' }}>
                          <td style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: '11px' }}>{f.linea}</td>
                          <td style={{ padding: '2px 4px' }}>
                            <select value={f.id_articulo} onChange={(e) => actualizarFilaCarga(i, { id_articulo: e.target.value })}
                              style={{ width: '100%', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 4px', color: f.id_articulo ? '#111827' : '#dc2626' }}>
                              <option value="">— sin coincidencia —</option>
                              {artActivos.map((a) => <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={f.cantidad} onChange={(e) => actualizarFilaCarga(i, { cantidad: Number(e.target.value) || 0 })}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => quitarFilaCarga(i)} title="Quitar" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '14px' }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filasCarga.some((f) => !f.id_articulo) && (
                    <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#dc2626' }}>⚠ Las filas en rojo no encontraron artículo — elegilo del desplegable o quitá la fila.</p>
                  )}
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={confirmarCargaMasiva} className="btn" style={{ fontSize: '12px' }}
                      disabled={guardandoMasivo || !filasCarga.some((f) => f.id_articulo)}>
                      {guardandoMasivo ? 'Guardando…' : `Confirmar carga (${filasCarga.filter((f) => f.id_articulo).length})`}
                    </button>
                    <button onClick={() => { setFilasCarga(null); }} className="btn secondary" style={{ fontSize: '12px' }} disabled={guardandoMasivo}>
                      ← Volver a pegar
                    </button>
                  </div>
                </>
              )}
              {resultadoMasivo && <p style={{ margin: '10px 0 0', fontSize: '12px', fontWeight: 600, color: resultadoMasivo.startsWith('Error') ? '#dc2626' : '#059669' }}>{resultadoMasivo}</p>}
            </div>
          )}

          {categorias.map((cat) => {
            const artscat = artActivos.filter((a) => a.categoria === cat);
            const valorizadoCat = artscat.reduce((acc, a) => acc + (resumenArticulos.find((x) => x.art.id_articulo === a.id_articulo)?.valorizado ?? 0), 0);
            return (
              <div key={cat} className="card" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{cat}</p>
                  {valorizadoCat > 0 && (
                    <button
                      onClick={() => copiarConAviso(
                        [['Artículo', 'Stock final', 'Valorizado'],
                          ...artscat.map((a) => {
                            const r = resumenArticulos.find((x) => x.art.id_articulo === a.id_articulo);
                            return [a.articulo, r?.fin ?? 0, Math.round(r?.valorizado ?? 0)];
                          }),
                          ['TOTAL', '', Math.round(valorizadoCat)]],
                        `Detalle de ${cat} copiado — pegalo en Excel`
                      )}
                      className="btn secondary" style={{ fontSize: '11px', padding: '3px 8px' }}
                    >
                      📋 Copiar detalle
                    </button>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: '12px', minWidth: '940px' }}>
                  <thead>
                    <tr>
                      <th>Artículo</th>
                      <th style={{ textAlign: 'center', width: '50px' }}>U.</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>Stock inicial</th>
                      <th style={{ textAlign: 'right', width: '160px' }}>Compras</th>
                      <th style={{ textAlign: 'right', width: '90px' }}>Precio compra</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>Stock final</th>
                      <th style={{ textAlign: 'right', width: '80px', color: '#059669', fontWeight: 700 }}>Uso real</th>
                      <th style={{ textAlign: 'right', width: '100px', fontWeight: 700 }} title="Uso real del mes anterior, ya cerrado — verde si este mes se usó menos, rojo si se usó más">Uso mes pasado</th>
                      <th style={{ textAlign: 'right', width: '80px', color: '#6b7280', fontWeight: 700 }} title="≈ = referencia estimada (sin fórmula configurada), no un target preciso">Uso teórico</th>
                      <th style={{ textAlign: 'right', width: '100px', fontWeight: 700 }}>Dif. real vs teórico</th>
                      <th style={{ textAlign: 'right', width: '100px', fontWeight: 700 }}>Stock final valorizado</th>
                      <th style={{ width: '110px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {artscat.map((art) => {
                      const r = resumenArticulos.find((x) => x.art.id_articulo === art.id_articulo)!;
                      const vals = getEdit(art.id_articulo);
                      const guardado = getStock(art.id_articulo);
                      const modificado = editValues[art.id_articulo] !== undefined;
                      const diffRef = r.esReferencia && r.usoReferencia !== null ? r.usoReal - r.usoReferencia : null;
                      const diffColor = r.diff !== null ? (r.diff > 0 ? '#dc2626' : '#059669') : diffRef !== null ? '#7c6fda' : '#9ca3af';
                      return (
                        <React.Fragment key={art.id_articulo}>
                        <tr style={{ background: modificado ? '#fefce8' : 'transparent' }}>
                          <td style={{ fontWeight: 500 }}>{art.articulo}</td>
                          <td style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>{art.unidad_medida}</td>
                          <td style={{ textAlign: 'right', fontSize: '12px', color: '#6b7280' }}
                            title="No se edita: es el stock final del mes anterior">
                            {vals.ini ? fmt(num(vals.ini)) : '—'}
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                              {editandoCompras === art.id_articulo ? (
                                <input type="number" value={vals.comp} autoFocus
                                  onChange={(e) => setField(art.id_articulo, 'comp', e.target.value)}
                                  onBlur={() => { autoguardar(art.id_articulo); setEditandoCompras(null); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                  style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #2563eb', borderRadius: '4px', padding: '3px 6px' }}
                                  min={0} step={0.001} />
                              ) : (
                                <>
                                  <span style={{ fontSize: '12px', fontWeight: num(vals.comp) > 0 ? 600 : 400, color: num(vals.comp) > 0 ? '#111827' : '#d1d5db' }}>
                                    {num(vals.comp) > 0 ? fmt(num(vals.comp)) : '—'}
                                  </span>
                                  <button onClick={() => setEditandoCompras(art.id_articulo)}
                                    title="Corregir a mano lo comprado de este articulo en este mes. Para registrar una compra nueva con su medio de pago, usa Cargar compra arriba."
                                    className="btn secondary" style={{ fontSize: '10px', padding: '2px 6px', flexShrink: 0 }}>
                                    ✏️
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '12px', color: r.precio !== null ? '#6b7280' : '#d1d5db' }}
                            title="Se carga junto con la compra, no aca">
                            {r.precio !== null ? '$' + fmt(r.precio, 1) : '—'}
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={vals.fin} onChange={(e) => setField(art.id_articulo, 'fin', e.target.value)}
                              onBlur={() => autoguardar(art.id_articulo)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: r.usoReal > 0 ? '#059669' : r.usoReal < 0 ? '#dc2626' : '#9ca3af', fontSize: '13px' }}>
                            {(r.ini || r.comp || r.fin) ? fmt(r.usoReal) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '12px' }}>
                            {r.usoMesPasado !== null ? (
                              <>
                                <span style={{ color: '#6b7280' }}>{fmt(r.usoMesPasado)}</span>
                                {(r.ini || r.comp || r.fin) && r.pctVsMesPasado !== null && (
                                  <span style={{ marginLeft: '4px', fontWeight: 700, color: r.pctVsMesPasado <= 0 ? '#059669' : '#dc2626' }}>
                                    {r.pctVsMesPasado > 0 ? '↑' : r.pctVsMesPasado < 0 ? '↓' : '·'} {fmt(Math.abs(r.pctVsMesPasado), 0)}%
                                  </span>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '13px' }}>
                            {r.usoTeorico !== null ? (
                              fmt(r.usoTeorico)
                            ) : r.esReferencia ? (
                              <span style={{ fontStyle: 'italic', color: '#7c6fda' }} title="Referencia: uso del mes anterior ajustado por la variación de venta total. No hay fórmula configurada, es sólo orientativo.">
                                ≈{fmt(r.usoReferencia!)}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: diffColor, fontSize: '12px' }}>
                            {r.diff !== null && (r.ini || r.comp || r.fin)
                              ? `${r.diff > 0 ? '+' : ''}${fmt(r.diff)}${r.pct !== null ? ` (${r.pct > 0 ? '+' : ''}${fmt(r.pct, 0)}%)` : ''}`
                              : diffRef !== null && (r.ini || r.comp || r.fin)
                                ? <span style={{ fontStyle: 'italic' }} title="Diferencia contra la referencia (no un target preciso).">≈{diffRef > 0 ? '+' : ''}{fmt(diffRef)}</span>
                                : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '12px', color: r.valorizado !== null ? '#111827' : '#d1d5db' }}>
                            {r.valorizado !== null ? `$${fmt(r.valorizado, 0)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {saving === art.id_articulo ? (
                              <span style={{ fontSize: '10px', color: '#6b7280' }}>Guardando…</span>
                            ) : modificado ? (
                              <span style={{ fontSize: '10px', color: '#d97706' }} title="Se guarda solo al salir del campo">● sin guardar</span>
                            ) : guardado ? (
                              <span style={{ fontSize: '10px', color: '#9ca3af' }}>✓ guardado</span>
                            ) : null}
                          </td>
                        </tr>
                        </React.Fragment>
                      );
                    })}
                    {artscat.some((a) => resumenArticulos.find((x) => x.art.id_articulo === a.id_articulo)?.valorizado) && (
                      <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                        <td colSpan={10} style={{ textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 700, padding: '6px 8px' }}>Subtotal valorizado {cat}</td>
                        <td style={{ textAlign: 'right', fontSize: '12px', fontWeight: 800, padding: '6px 8px' }}>
                          ${fmt(artscat.reduce((acc, a) => acc + (resumenArticulos.find((x) => x.art.id_articulo === a.id_articulo)?.valorizado ?? 0), 0), 0)}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}

          {/* Usos del sistema — referencia de los drivers de producción/venta del mes, colapsado */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setMostrarUsos((v) => !v)}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Usos del sistema (referencia) — {MESES[mes - 1]} {anio}
              </p>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{mostrarUsos ? '▲' : '▼'}</span>
            </div>
            {mostrarUsos && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280' }}>
                  Estos son los mismos números que alimentan el "Uso teórico" de cada artículo (asigná fórmula y factor en{' '}
                  <Link href="/admin/articulos" style={{ color: '#2563eb', fontWeight: 600 }}>Admin → Artículos</Link>).
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                {DRIVERS.map((d) => (
                  <div key={d.key} style={{ background: '#f9fafb', borderRadius: '6px', padding: '10px 12px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{d.label}</p>
                    <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>{fmt((drivers as any)[d.key] || 0)}</p>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== VISTA: INFORME COMPARATIVO ===== */}
      {vista === 'informe' && (
        <div className="card">
          <p className="card-title">Uso mensual comparativo — últimos 6 meses</p>
          <p className="card-sub">Uso = Stock inicial + Compras − Stock final</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th style={{ textAlign: 'center', width: '50px' }}>U.</th>
                  {mesesInforme.map((m) => (
                    <th key={m.label} style={{ textAlign: 'right', width: '90px', whiteSpace: 'nowrap' }}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categorias.map((cat) => {
                  const artscat = artActivos.filter((a) => a.categoria === cat);
                  const hayDatos = artscat.some((a) =>
                    mesesInforme.some((m) => getUso(a.id_articulo, m.anio, m.mes) !== null) ||
                    resumenArticulos.find((x) => x.art.id_articulo === a.id_articulo)?.esReferencia
                  );
                  if (!hayDatos) return null;
                  return (
                    <>
                      <tr key={'cat-' + cat} style={{ background: '#f8fafc' }}>
                        <td colSpan={2 + mesesInforme.length} style={{ fontWeight: 700, fontSize: '11px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.3px', padding: '6px 8px' }}>{cat}</td>
                      </tr>
                      {artscat.map((art) => {
                        const usos = mesesInforme.map((m) => getUso(art.id_articulo, m.anio, m.mes));
                        const rActual = resumenArticulos.find((x) => x.art.id_articulo === art.id_articulo);
                        if (usos.every((u) => u === null) && !rActual?.esReferencia) return null;
                        const maxUso = Math.max(...usos.filter((u): u is number => u !== null));
                        const ultimoIdx = mesesInforme.length - 1;
                        return (
                          <tr key={art.id_articulo}>
                            <td style={{ fontWeight: 500 }}>{art.articulo}</td>
                            <td style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>{art.unidad_medida}</td>
                            {usos.map((u, i) => {
                              // Mes actual sin carga todavía + artículo sin fórmula: mostramos la
                              // referencia estimada en vez de un guión, para que sirva como comparación.
                              if (u === null && i === ultimoIdx && rActual?.esReferencia) {
                                return (
                                  <td key={i} style={{ textAlign: 'right', fontStyle: 'italic', color: '#7c6fda' }}
                                    title="Referencia estimada: uso del mes anterior ajustado por variación de venta total.">
                                    ≈{fmt(rActual.usoReferencia!)}
                                  </td>
                                );
                              }
                              return (
                                <td key={i} style={{
                                  textAlign: 'right',
                                  fontWeight: u === maxUso && u > 0 ? 700 : 400,
                                  color: u === null ? '#e5e7eb' : u > 0 ? '#1f2937' : '#dc2626',
                                  background: u !== null && u > 0 && maxUso > 0
                                    ? `rgba(5, 150, 105, ${0.05 + (u / maxUso) * 0.2})`
                                    : 'transparent',
                                }}>
                                  {u === null ? '—' : u.toLocaleString('es-AR', { maximumFractionDigits: 3 })}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
