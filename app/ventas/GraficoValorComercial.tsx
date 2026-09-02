'use client';
import { useState } from 'react';
import type { ClientePrecioVolumen } from '@/lib/estadisticasVentas';

// ── Mapa de valor comercial: precio promedio real (X) vs. volumen 30 días (Y) ─────────
//
// No es un scatter decorativo: la lectura es por CUADRANTE y por VALOR COMERCIAL.
//
// Está hecho en SVG a mano y no con la librería de gráficos (como el resto de los de esta
// pantalla) por dos cosas que necesitan control fino: el fondo de bandas de valor y el
// acomodado de las etiquetas para que no se pisen.
//
// Los PUNTOS son todos del mismo color y tamaño a propósito: el color vive en el fondo, y
// pintar además los puntos hacía competir dos codificaciones para lo mismo.

const INK = '#111827';
const INK_SEC = '#52514e';
const INK_MUTED = '#898781';
const PUNTO = '#1f2937';       // gris oscuro, único color de los puntos
const GRID = '#eeede8';

// Rampa pastel de menor a mayor valor comercial. Deliberadamente desaturada: es fondo, no
// tiene que competir con los datos, y un rojo fuerte hacía ver mal a clientes que no lo son.
const RAMPA = ['#f7ece6', '#faf1e4', '#fcf7e5', '#f4f8e6', '#ebf5e8', '#e2f0e6'];
const BANDAS = RAMPA.length;
const CONTRASTE = 1.6;  // cuánto se estira la rampa alrededor del centro (ver `bordes`)

// El eje X arranca en $1.300 salvo que algún cliente pague menos: nunca se recorta un
// punto para ganar escala — el que paga poco es justo el que hay que ver.
const X_MINIMO_PREFERIDO = 1300;

const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtEntero = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtMilesDec = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n)}%`;

// Geometría del lienzo (viewBox: escala sola al ancho disponible)
const W = 720, H = 430;
const L = 62, R = 18, T = 26, B = 46;
const X0 = L, X1 = W - R, Y0 = T, Y1 = H - B;

interface Punto extends ClientePrecioVolumen { x: number; y: number }

export default function GraficoValorComercial({ datos, titulo = 'Clientes — precio vs. volumen', subtitulo = 'últimos 30 días' }: {
  datos: ClientePrecioVolumen[]; titulo?: string; subtitulo?: string;
}) {
  const [hover, setHover] = useState<Punto | null>(null);

  if (!datos.length) {
    return (
      <div style={card}>
        <Encabezado titulo={titulo} subtitulo={subtitulo} />
        <p style={{ color: INK_MUTED, fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>
          Sin ventas cargadas en los últimos 30 días — no hay datos para calcular el mapa.
        </p>
      </div>
    );
  }

  // ── Promedios de referencia ────────────────────────────────────────────────────────
  // Promedio simple entre clientes (no ponderado por volumen): la pregunta que responden
  // los cuadrantes es "¿este cliente paga por encima o por debajo de lo que paga el
  // resto?", y ahí cada cliente cuenta como uno. Un promedio ponderado contestaría otra
  // cosa (a qué precio se vendió el mes), y correría la línea hacia los clientes grandes.
  const n = datos.length;
  const precioProm = datos.reduce((a, d) => a + d.precioPromedio, 0) / n;
  const volumenProm = datos.reduce((a, d) => a + d.unidades, 0) / n;

  // ── Escalas ────────────────────────────────────────────────────────────────────────
  const minPrecio = Math.min(...datos.map((d) => d.precioPromedio));
  const maxPrecio = Math.max(...datos.map((d) => d.precioPromedio));
  const maxUnidades = Math.max(...datos.map((d) => d.unidades));
  const xMin = minPrecio >= X_MINIMO_PREFERIDO ? X_MINIMO_PREFERIDO : Math.floor((minPrecio * 0.92) / 100) * 100;
  const xMax = Math.ceil((maxPrecio * 1.1) / 100) * 100;
  const yMin = 0; // el volumen es una magnitud: cortar el eje exageraría las diferencias
  const yMax = Math.max(Math.ceil((maxUnidades * 1.12) / 100) * 100, 10);

  const px = (precio: number) => X0 + ((precio - xMin) / (xMax - xMin || 1)) * (X1 - X0);
  const py = (u: number) => Y1 - ((u - yMin) / (yMax - yMin || 1)) * (Y1 - Y0);

  const puntos: Punto[] = datos.map((d) => ({ ...d, x: px(d.precioPromedio), y: py(d.unidades) }));
  const xProm = px(precioProm), yProm = py(volumenProm);

  // ── Fondo: bandas de valor comercial ───────────────────────────────────────────────
  // El puntaje de cada lugar del plano es el PROMEDIO de la posición relativa en los dos
  // ejes (ver escalaRelativa), así precio y volumen pesan lo mismo y más precio compensa
  // menos volumen. Como el 0,5 de cada eje cae exactamente en su promedio, el cruce de las
  // dos líneas punteadas es el centro de la escala: pasando las dos, el fondo es verde.
  const escP = escalaRelativa(datos.map((d) => d.precioPromedio), precioProm);
  const escV = escalaRelativa(datos.map((d) => d.unidades), volumenProm);

  // Los cortes entre bandas se estiran alrededor del centro (CONTRASTE): comprimir los
  // extremos deja a casi todos amontonados en el medio y la rampa se usaría por la mitad.
  // Estirar el contraste no cambia el orden de nadie ni de qué lado del centro cae: el corte
  // del medio sigue siendo exactamente el cruce de los dos promedios. Los dos extremos van
  // bien afuera de la escala para que el color llegue hasta los bordes del gráfico.
  const bordes = Array.from({ length: BANDAS + 1 }, (_, i) =>
    i === 0 ? -5 : i === BANDAS ? 6 : 0.5 + (i / BANDAS - 0.5) / CONTRASTE);
  const bandas = Array.from({ length: BANDAS }, (_, i) => ({
    d: pathBanda(bordes[i], bordes[i + 1]),
    fill: RAMPA[i],
  }));

  // Borde superior de la zona con puntaje `s`: para cada x, el volumen que la alcanza.
  // Con la escala partida en dos tramos por eje la curva ya no es una recta, así que se
  // muestrea a lo ancho en vez de unir los extremos.
  const acotar = (v: number) => Math.max(Y0 - 4000, Math.min(Y1 + 4000, v));
  function curva(s: number, desdeIzq: boolean): string {
    const PASOS = 32;
    const pts: string[] = [];
    for (let k = 0; k <= PASOS; k++) {
      const i = desdeIzq ? k : PASOS - k;
      const xPix = X0 + ((X1 - X0) * i) / PASOS;
      const precio = xMin + ((xPix - X0) / (X1 - X0)) * (xMax - xMin);
      const ny = 2 * s - escP.pos(precio);
      pts.push(`${xPix.toFixed(1)} ${acotar(py(escV.inv(ny))).toFixed(1)}`);
    }
    return pts.join(' L ');
  }
  function pathBanda(s1: number, s2: number): string {
    return `M ${curva(s2, true)} L ${curva(s1, false)} Z`;
  }

  // ── Ticks ──────────────────────────────────────────────────────────────────────────
  const ticksX = ticks(xMin, xMax, 5);
  const ticksY = ticks(yMin, yMax, 4);

  // ── Etiquetas sin superposición ────────────────────────────────────────────────────
  // Se colocan por orden de facturación (primero los que más pesan). Cada una prueba
  // cuatro posiciones alrededor del punto y se queda con la primera que no pise a otra ya
  // puesta; si ninguna entra, ese cliente no lleva etiqueta fija y se ve al pasar el mouse.
  const colocadas: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const etiquetas: { texto: string; x: number; y: number; anchor: 'start' | 'middle' | 'end' }[] = [];
  const porPeso = [...puntos].sort((a, b) => b.monto - a.monto);
  for (const p of porPeso) {
    const texto = p.nombre.length > 18 ? p.nombre.slice(0, 17) + '…' : p.nombre;
    const ancho = texto.length * 5.4 + 4;
    const opciones: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }[] = [
      { x: p.x, y: p.y - 11, anchor: 'middle' },
      { x: p.x + 9, y: p.y + 3.5, anchor: 'start' },
      { x: p.x - 9, y: p.y + 3.5, anchor: 'end' },
      { x: p.x, y: p.y + 17, anchor: 'middle' },
    ];
    let puesta = false;
    for (const o of opciones) {
      const x1 = o.anchor === 'middle' ? o.x - ancho / 2 : o.anchor === 'start' ? o.x : o.x - ancho;
      const caja = { x1, y1: o.y - 9, x2: x1 + ancho, y2: o.y + 2 };
      if (caja.x1 < X0 - 8 || caja.x2 > X1 + 8 || caja.y1 < Y0 - 4 || caja.y2 > Y1 + 4) continue;
      if (colocadas.some((c) => !(caja.x2 < c.x1 || caja.x1 > c.x2 || caja.y2 < c.y1 || caja.y1 > c.y2))) continue;
      colocadas.push(caja);
      etiquetas.push({ texto, ...o });
      puesta = true;
      break;
    }
    if (!puesta) continue; // sin lugar: queda para el tooltip
  }

  const insights = calcularInsights(datos, precioProm, volumenProm);

  return (
    <div style={card}>
      <Encabezado titulo={titulo} subtitulo={subtitulo} />

      <div>
        {/* ── Gráfico ── */}
        <div style={{ position: 'relative', minWidth: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
              <clipPath id="areaGrafico"><rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} /></clipPath>
            </defs>

            <g clipPath="url(#areaGrafico)">
              {bandas.map((b, i) => <path key={i} d={b.d} fill={b.fill} />)}
            </g>

            {/* Grilla muy sutil */}
            {ticksY.map((v) => (
              <line key={`gy${v}`} x1={X0} x2={X1} y1={py(v)} y2={py(v)} stroke={GRID} strokeWidth={1} />
            ))}
            {ticksX.map((v) => (
              <line key={`gx${v}`} x1={px(v)} x2={px(v)} y1={Y0} y2={Y1} stroke={GRID} strokeWidth={1} />
            ))}

            {/* Cada cuadrante lleva su nombre EN EL MEDIO de su zona, no en la esquina del
                gráfico: con las líneas de promedio descentradas, un cartel en la esquina
                queda lejos de la zona que nombra y hay franjas que parecen no tener nombre. */}
            <TextoCuadrante x={(xProm + X1) / 2} y={(Y0 + yProm) / 2} texto="DEFENDER Y HACER CRECER" />
            <TextoCuadrante x={(X0 + xProm) / 2} y={(Y0 + yProm) / 2} texto="CAPTURAR PRECIO" />
            <TextoCuadrante x={(xProm + X1) / 2} y={(yProm + Y1) / 2} texto="DESARROLLAR VOLUMEN" />
            <TextoCuadrante x={(X0 + xProm) / 2} y={(yProm + Y1) / 2} texto="REVISAR" />

            {/* Líneas de promedio */}
            <line x1={xProm} x2={xProm} y1={Y0} y2={Y1} stroke={INK_SEC} strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
            <line x1={X0} x2={X1} y1={yProm} y2={yProm} stroke={INK_SEC} strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
            <text x={xProm + 4} y={Y0 + 10} fontSize={9.5} fill={INK_SEC} opacity={0.85}>Precio promedio</text>
            <text x={X0 + 4} y={yProm - 4} fontSize={9.5} fill={INK_SEC} opacity={0.85}>Volumen promedio</text>

            {/* Ejes */}
            <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke="#dcdbd5" strokeWidth={1} />
            <line x1={X0} x2={X0} y1={Y0} y2={Y1} stroke="#dcdbd5" strokeWidth={1} />
            {ticksX.map((v) => (
              <text key={`tx${v}`} x={px(v)} y={Y1 + 15} textAnchor="middle" fontSize={10} fill={INK_SEC}>{fmtMoneda(v)}</text>
            ))}
            {ticksY.map((v) => (
              <text key={`ty${v}`} x={X0 - 7} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill={INK_SEC}>{fmtMilesDec(v)}</text>
            ))}
            <text x={(X0 + X1) / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill={INK_MUTED}>Precio promedio de venta x paquete</text>
            <text x={14} y={(Y0 + Y1) / 2} textAnchor="middle" fontSize={10.5} fill={INK_MUTED} transform={`rotate(-90 14 ${(Y0 + Y1) / 2})`}>Unidades (30 días)</text>

            {/* Puntos: todos igual color y tamaño */}
            {puntos.map((p) => (
              <circle
                key={p.id_control} cx={p.x} cy={p.y} r={hover?.id_control === p.id_control ? 7 : 5}
                fill={PUNTO} stroke="#ffffff" strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
              />
            ))}

            {etiquetas.map((e, i) => (
              <text key={i} x={e.x} y={e.y} textAnchor={e.anchor} fontSize={10} fill={INK} fontWeight={600} pointerEvents="none">
                {e.texto}
              </text>
            ))}
          </svg>

          {hover && <Tooltip p={hover} precioProm={precioProm} volumenProm={volumenProm} />}
        </div>

      </div>

      {/* Todo lo que no es el gráfico va detrás de un link: la tarjeta entra al lado de
          otro gráfico sin ocupar media pantalla, y quien quiere el detalle lo abre. */}
      <Desplegable>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '18px', alignItems: 'start' }}>
          <div>
            <p style={subtituloPanel}>Mapa de valor comercial</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {[
                { c: RAMPA[5], t: 'Mayor valor', d: 'Bien arriba del promedio en los dos ejes', a: 'Defender y hacer crecer' },
                { c: RAMPA[3], t: 'Arriba del promedio', d: 'Pasa el cruce de las dos líneas punteadas', a: 'Optimizar el eje más flojo' },
                { c: RAMPA[2], t: 'Abajo del promedio', d: 'No llega al cruce: por precio, por volumen o por los dos', a: 'Hay margen para crecer' },
                { c: RAMPA[0], t: 'Menor valor relativo', d: 'Bien abajo del promedio en los dos ejes', a: 'Revisar condiciones' },
              ].map((x) => (
                <div key={x.t} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: x.c, border: '1px solid #e4e3dd', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '11.5px', fontWeight: 700, color: INK }}>{x.t}</p>
                    <p style={{ margin: 0, fontSize: '11px', color: INK_MUTED, lineHeight: 1.35 }}>{x.d} · {x.a}</p>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: INK_MUTED, lineHeight: 1.45 }}>
              El fondo mide qué tan lejos del promedio está cada cliente en los dos ejes, con el mismo peso,
              así que más precio compensa menos volumen y al revés. El cruce de las líneas punteadas es el
              centro exacto de la escala: <strong>todo lo que pasa las dos líneas cae del lado verde</strong> y
              todo lo que no llega a ninguna cae del lado cálido. Cada mitad se mide contra su propio grupo,
              para que un cliente muy grande no aplaste al resto. El color es <strong>relativo a tus propios
              clientes</strong>: marca posiciones, no una nota absoluta — siempre va a haber alguien más cerca
              de cada extremo.
            </p>
          </div>

          <div>
            <p style={subtituloPanel}>Insights clave</p>
            {insights.length === 0 ? (
              <p style={{ margin: 0, fontSize: '11.5px', color: INK_MUTED }}>
                Con un solo cliente en la ventana no hay con qué comparar.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: '0 0 0 15px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {insights.map((t, i) => (
                  <li key={i} style={{ fontSize: '11.5px', color: INK_SEC, lineHeight: 1.45 }}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <TablaDatos puntos={puntos} precioProm={precioProm} volumenProm={volumenProm} />
      </Desplegable>
    </div>
  );
}

// Un solo link abre leyenda, insights y tabla. Antes la leyenda y los insights estaban
// siempre visibles al costado y la tarjeta ocupaba el ancho entero de la pantalla.
function Desplegable({ children }: { children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginTop: '10px' }}>
      <button onClick={() => setAbierto((v) => !v)} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11.5px', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
        {abierto ? '▾ Ocultar mapa de valor e insights' : '▸ Ver mapa de valor, insights y tabla'}
      </button>
      {abierto && <div style={{ marginTop: '12px' }}>{children}</div>}
    </div>
  );
}

// ── Insights calculados sobre los datos reales ───────────────────────────────────────
// Solo entra lo que los datos confirman: cada bloque se saltea si no hay clientes en esa
// situación. Nada genérico ni escrito de antemano.
function calcularInsights(datos: ClientePrecioVolumen[], precioProm: number, volumenProm: number): string[] {
  if (datos.length < 2) return [];
  const out: string[] = [];
  const pctP = (d: ClientePrecioVolumen) => ((d.precioPromedio - precioProm) / precioProm) * 100;
  const pctV = (d: ClientePrecioVolumen) => ((d.unidades - volumenProm) / volumenProm) * 100;

  const mayorVol = [...datos].sort((a, b) => b.unidades - a.unidades)[0];
  out.push(`${mayorVol.nombre} es el de mayor volumen: ${fmtEntero(mayorVol.unidades)} u (${fmtPct(pctV(mayorVol))} vs. el promedio), a ${fmtMoneda(mayorVol.precioPromedio)}.`);

  const mayorPrecio = [...datos].sort((a, b) => b.precioPromedio - a.precioPromedio)[0];
  if (mayorPrecio.id_control !== mayorVol.id_control) {
    out.push(`${mayorPrecio.nombre} es el que mejor paga: ${fmtMoneda(mayorPrecio.precioPromedio)} (${fmtPct(pctP(mayorPrecio))} vs. el promedio).`);
  }

  // Capturar precio: ya tienen volumen, el precio está abajo del promedio
  const capturar = datos.filter((d) => d.unidades >= volumenProm && d.precioPromedio < precioProm)
    .sort((a, b) => b.unidades - a.unidades);
  if (capturar.length) {
    const nombres = capturar.slice(0, 3).map((d) => d.nombre).join(', ');
    out.push(`${nombres} concentra${capturar.length > 1 ? 'n' : ''} volumen por encima del promedio con un precio por debajo: es donde hay margen para trabajar el precio.`);
  }

  // Desarrollar volumen: pagan bien pero compran poco
  const desarrollar = datos.filter((d) => d.precioPromedio >= precioProm && d.unidades < volumenProm)
    .sort((a, b) => b.precioPromedio - a.precioPromedio);
  if (desarrollar.length) {
    const nombres = desarrollar.slice(0, 3).map((d) => d.nombre).join(', ');
    out.push(`${nombres} paga${desarrollar.length > 1 ? 'n' : ''} por encima del promedio pero compra${desarrollar.length > 1 ? 'n' : ''} poco: conviene ver si hay lugar para crecer en volumen.`);
  }

  // Defender: los dos altos
  const defender = datos.filter((d) => d.precioPromedio >= precioProm && d.unidades >= volumenProm)
    .sort((a, b) => b.monto - a.monto);
  if (defender.length) {
    const facturan = defender.reduce((a, d) => a + d.monto, 0);
    const total = datos.reduce((a, d) => a + d.monto, 0);
    const pct = total > 0 ? Math.round((facturan / total) * 100) : 0;
    out.push(`${defender.slice(0, 3).map((d) => d.nombre).join(', ')} combina${defender.length > 1 ? 'n' : ''} buen precio y buen volumen: ${pct}% de la facturación de la ventana.`);
  }

  // Bajo valor
  const revisar = datos.filter((d) => d.precioPromedio < precioProm && d.unidades < volumenProm)
    .sort((a, b) => a.monto - b.monto);
  if (revisar.length) {
    out.push(`${revisar.length} cliente${revisar.length > 1 ? 's' : ''} con precio y volumen por debajo del promedio (${revisar.slice(0, 3).map((d) => d.nombre).join(', ')}${revisar.length > 3 ? '…' : ''}): revisar condiciones y rentabilidad.`);
  }

  return out;
}

// ── Piezas de UI ─────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '18px' };
const subtituloPanel: React.CSSProperties = { margin: '0 0 8px', fontSize: '11px', fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: '0.4px' };

function Encabezado({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: INK }}>{titulo}</p>
      <p style={{ margin: '2px 0 0', fontSize: '12px', color: INK_MUTED }}>{subtitulo}</p>
    </div>
  );
}

function TextoCuadrante({ x, y, texto }: { x: number; y: number; texto: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={8.5} fill={INK_MUTED} letterSpacing="0.6" opacity={0.6} pointerEvents="none">
      {texto}
    </text>
  );
}

function Tooltip({ p, precioProm, volumenProm }: { p: Punto; precioProm: number; volumenProm: number }) {
  const dP = ((p.precioPromedio - precioProm) / precioProm) * 100;
  const dV = ((p.unidades - volumenProm) / volumenProm) * 100;
  // Posición en % del ancho para que acompañe al SVG cuando escala.
  const izquierda = p.x > W / 2;
  return (
    <div style={{
      position: 'absolute', top: `${(p.y / H) * 100}%`, [izquierda ? 'right' : 'left']: `${((izquierda ? W - p.x : p.x) / W) * 100 + 2}%`,
      transform: 'translateY(-50%)', background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
      padding: '9px 12px', fontSize: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', pointerEvents: 'none', zIndex: 2, minWidth: '190px',
    } as React.CSSProperties}>
      <p style={{ margin: '0 0 5px', fontWeight: 700, color: INK }}>{p.nombre}</p>
      <Fila k="Precio prom. x paquete" v={fmtMoneda(p.precioPromedio)} />
      <Fila k="Unidades (30 días)" v={fmtEntero(p.unidades)} />
      <Fila k="Facturación" v={fmtMoneda(p.monto)} />
      <div style={{ borderTop: '1px solid #f1f0eb', marginTop: '5px', paddingTop: '5px' }}>
        <Fila k="vs. precio promedio" v={fmtPct(dP)} color={dP >= 0 ? '#1b7f4d' : '#b4453f'} />
        <Fila k="vs. volumen promedio" v={fmtPct(dV)} color={dV >= 0 ? '#1b7f4d' : '#b4453f'} />
      </div>
    </div>
  );
}

function Fila({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', color: INK_SEC }}>
      <span>{k}</span><strong style={{ color: color || INK }}>{v}</strong>
    </div>
  );
}

function TablaDatos({ puntos, precioProm, volumenProm }: { puntos: Punto[]; precioProm: number; volumenProm: number }) {
  const orden = [...puntos].sort((a, b) => b.monto - a.monto);
  return (
    <div style={{ marginTop: '16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: '11px', width: '100%', borderCollapse: 'collapse', minWidth: '460px' }}>
            <thead><tr style={{ color: INK_MUTED }}>
              <th style={{ textAlign: 'left', padding: '3px 6px 3px 0' }}>Cliente</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Precio x paq.</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Unidades (30d)</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Facturación</th>
              <th style={{ textAlign: 'right', padding: '3px 0' }}>vs. prom. (precio / vol.)</th>
            </tr></thead>
            <tbody>
              {orden.map((p) => (
                <tr key={p.id_control} style={{ borderTop: '1px solid #f1f0eb' }}>
                  <td style={{ padding: '3px 6px 3px 0' }}>{p.nombre}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px' }}>{fmtMoneda(p.precioPromedio)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px' }}>{fmtEntero(p.unidades)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px' }}>{fmtMoneda(p.monto)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0', color: INK_MUTED }}>
                    {fmtPct(((p.precioPromedio - precioProm) / precioProm) * 100)} / {fmtPct(((p.unidades - volumenProm) / volumenProm) * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: INK_MUTED, lineHeight: 1.5 }}>
            Ventana móvil de 30 días: un cliente que hace más de un mes que no compra no aparece. El precio es el
            promedio real cobrado a ese cliente. A los que compran por kg se les estiman las unidades con el peso
            real de las plantas cosechadas en la misma ventana, para llegar al precio por paquete equivalente.
          </p>
        </div>
    </div>
  );
}

// ── Escala relativa de un eje ────────────────────────────────────────────────────────
// Lleva un valor a una posición 0..1 donde 0,5 es SIEMPRE el promedio y el 1 (o el 0) es el
// promedio de los clientes que están de ese lado. Dos motivos:
//
// 1. Que el 0,5 caiga en el promedio es lo que hace que el fondo y las líneas punteadas
//    cuenten la misma historia. Antes la posición se medía sobre el largo del eje, y el
//    largo del eje lo fija el cliente más grande: había clientes arriba de los dos
//    promedios —o sea, en el cuadrante bueno— a los que igual les tocaba color del medio,
//    porque el eje Y llegaba hasta el volumen del cliente más grande de todos.
// 2. Cada mitad se mide con su propia vara. El volumen entre clientes varía unas 85 veces y
//    el precio apenas 1,5: contra el máximo, un solo cliente enorme aplasta a todo el resto
//    contra el cero.
//
// 3. Los extremos se comprimen (tanh). Sin comprimir, el que paga muy por encima del
//    promedio se lleva el puntaje entero: como el precio varía poco entre clientes, un
//    cliente 20% más caro queda a 2 desvíos y le gana a otro que compra 6 veces más. Con la
//    compresión, despegarse mucho en un eje no alcanza para tapar al otro.
//
// pos() e inv() son inversas exactas porque si no el color del fondo y el puntaje del punto
// que está parado ahí dejarían de coincidir. pos() vive siempre entre 0 y 1, así que las
// seis bandas cubren todo el plano.
function escalaRelativa(valores: number[], prom: number) {
  const promDe = (xs: number[], porDefecto: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : porDefecto);
  const anclaBaja = promDe(valores.filter((v) => v < prom), Math.min(...valores));
  const anclaAlta = promDe(valores.filter((v) => v > prom), Math.max(...valores));
  const spanBajo = prom - anclaBaja || 1;
  const spanAlto = anclaAlta - prom || 1;
  return {
    pos: (v: number) => 0.5 + 0.5 * Math.tanh((v - prom) / (v < prom ? spanBajo : spanAlto)),
    inv: (p: number) => {
      const z = Math.atanh(Math.max(-1 + 1e-12, Math.min(1 - 1e-12, 2 * p - 1)));
      return prom + z * (z < 0 ? spanBajo : spanAlto);
    },
  };
}

// Marcas de eje "redondas" dentro del rango, para no llenar el eje de números raros.
function ticks(min: number, max: number, cantidad: number): number[] {
  const paso = (max - min) / cantidad;
  const mag = Math.pow(10, Math.floor(Math.log10(paso || 1)));
  const pasoRedondo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= paso) || mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / pasoRedondo) * pasoRedondo; v <= max + 0.001; v += pasoRedondo) out.push(Math.round(v));
  return out;
}
