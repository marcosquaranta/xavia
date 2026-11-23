// ── El PDF del remito ────────────────────────────────────────────────────────────────
//
// Lo arma la app, no Xubio (decisión de Marcos). Es un papel operativo: lo firma el que
// recibe y queda como constancia de la entrega.
//
// Se usa pdf-lib y no un HTML convertido porque no hay navegador del otro lado: esto corre
// en una función de Vercel, y arrastrar un Chrome headless para dibujar una tabla sería
// mucho peso para lo que es.
//
// ── Por qué el layout es austero ──
//
// Un remito se imprime, se firma con una birome y vuelve doblado en un bolsillo. Lo único
// que tiene que resolver es: quién recibe, qué recibió, cuánto, y dónde firma. Todo lo que
// no sea eso le saca lugar a la tabla, que es lo que se controla bulto por bulto.
//
// Las fuentes son las estándar del PDF (Helvetica): no hay que embeberlas, pesan cero y se
// ven igual en cualquier lado. El costo es que no soportan más allá de Latin-1, así que el
// texto se limpia antes de dibujarlo — un carácter fuera de rango hace fallar el
// `drawText` entero, y un remito que no sale por una comilla rara es un remito que no sale.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Remito } from './remitos';
import { totalDe } from './remitos';

// Los datos de Xavia que van en el encabezado.
const EMPRESA = {
  nombre: 'XAVIA LIFE S.R.L.',
  cuit: '30-71840929-9',
  detalle: 'Produccion hidroponica',
};

// Helvetica no puede dibujar lo que no entra en Latin-1 y tira error. Se reemplaza lo que
// aparece de verdad en estos textos —comillas tipográficas, guiones largos— y lo demás cae
// a un signo de pregunta en vez de voltear el PDF.
function limpiar(t: any): string {
  const s = String(t ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ');
  let out = '';
  for (const ch of s) out += ch.charCodeAt(0) <= 0xff ? ch : '?';
  return out;
}

const fmtFecha = (iso: string) => {
  const [y, m, d] = String(iso || '').split('-');
  return d ? `${d}/${m}/${y}` : String(iso || '');
};

const fmtCant = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');

export async function remitoPdf(r: Remito): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4 = [595.28, 841.89] as const;
  const M = 48;                 // margen
  const negro = rgb(0.07, 0.07, 0.07);
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = rgb(0.82, 0.82, 0.82);

  let page = doc.addPage([A4[0], A4[1]]);
  let y = A4[1] - M;

  const texto = (t: any, x: number, yy: number, size = 10, f = font, color = negro) =>
    page.drawText(limpiar(t), { x, y: yy, size, font: f, color });

  // Una hoja nueva cuando se acaba el lugar. Un remito de veinte renglones tiene que
  // seguir en la página 2, no cortarse: lo que no está en el papel no se controla.
  const nuevaPagina = () => {
    page = doc.addPage([A4[0], A4[1]]);
    y = A4[1] - M;
  };
  const espacio = (alto: number) => { if (y - alto < M + 90) nuevaPagina(); };

  // ── Encabezado ──
  texto(EMPRESA.nombre, M, y, 15, bold);
  texto('REMITO', A4[0] - M - 78, y, 17, bold);
  y -= 15;
  texto(`CUIT ${EMPRESA.cuit} - ${EMPRESA.detalle}`, M, y, 8.5, font, gris);
  texto('DOCUMENTO NO VALIDO COMO FACTURA', A4[0] - M - 170, y, 7.5, font, gris);
  y -= 22;

  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: negro });
  y -= 20;

  // ── Quién y cuándo ──
  texto('CLIENTE', M, y, 7.5, bold, gris);
  texto('FECHA DE ENTREGA', A4[0] - M - 150, y, 7.5, bold, gris);
  y -= 13;
  texto(r.cliente, M, y, 12, bold);
  texto(fmtFecha(r.fecha), A4[0] - M - 150, y, 12, bold);
  y -= 16;
  // La factura que acompaña: es lo que ata los dos papeles cuando alguien los revisa
  // juntos, que es como se revisan.
  texto(`Corresponde a la factura ${r.numeroFactura}`, M, y, 9, font, gris);
  y -= 24;

  // ── El detalle, por sucursal ──
  for (const s of r.porSucursal) {
    espacio(60);
    // El nombre de la sucursal solo cuando aporta: si es el mismo del cliente, repetirlo
    // es ruido en el papel que se lee parado en la puerta.
    if (s.sucursal && s.sucursal !== r.cliente) {
      texto(`Entregar en: ${s.sucursal}`, M, y, 10, bold);
      y -= 16;
    }

    const colCant = A4[0] - M - 120;
    const colUni = A4[0] - M - 50;
    texto('DETALLE', M, y, 7.5, bold, gris);
    texto('CANTIDAD', colCant, y, 7.5, bold, gris);
    texto('UNIDAD', colUni, y, 7.5, bold, gris);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.7, color: linea });
    y -= 15;

    for (const l of s.lineas) {
      espacio(20);
      texto(l.articulo, M, y, 11);
      texto(fmtCant(l.cantidad), colCant, y, 11, bold);
      texto(l.unidad === 'kg' ? 'kg' : 'u', colUni, y, 11);
      y -= 7;
      page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: linea });
      y -= 14;
    }
    y -= 10;
  }

  // ── El total en bultos ──
  //
  // Quien recibe cuenta bultos, no renglones. Sin este número hay que sumar a mano para
  // controlar la entrega, que es justo el momento en que nadie tiene ganas de sumar.
  const t = totalDe(r);
  espacio(40);
  const partes = [t.unidades > 0 ? `${t.unidades} unidades` : '', t.kilos > 0 ? `${fmtCant(t.kilos)} kg` : '']
    .filter(Boolean).join('  +  ');
  texto(`TOTAL ENTREGADO:  ${partes || '-'}`, M, y, 11, bold);
  y -= 40;

  // ── Las firmas ──
  espacio(70);
  const anchoFirma = (A4[0] - M * 2 - 40) / 2;
  page.drawLine({ start: { x: M, y }, end: { x: M + anchoFirma, y }, thickness: 0.7, color: negro });
  page.drawLine({ start: { x: M + anchoFirma + 40, y }, end: { x: A4[0] - M, y }, thickness: 0.7, color: negro });
  y -= 12;
  texto('Entrega (Xavia)', M, y, 8, font, gris);
  texto('Recibe - aclaracion y firma', M + anchoFirma + 40, y, 8, font, gris);

  return doc.save();
}

// El nombre del archivo. Lleva el número de factura porque es lo que después se busca
// cuando alguien pregunta por una entrega.
export function nombreArchivo(r: Remito): string {
  const num = String(r.numeroFactura || '').replace(/[^A-Za-z0-9-]/g, '');
  return `Remito-${num || 'sin-numero'}.pdf`;
}
