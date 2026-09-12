// Cobros registrados desde la app hacia Xubio. La hoja no es un duplicado de Xubio: guarda
// el `transaccionid` que devolvió Xubio, que es lo único que permite deshacer un cobro
// cargado por error (DELETE /cobranzaBean/{id}), y deja el rastro de quién lo cargó.
//
// Los cobros que se carguen directo en Xubio no aparecen acá — y está bien: esta hoja
// responde "qué hizo la app", no "cuánto cobramos". Para eso está el saldo, que sale de
// Xubio (ver calcularSaldos en recordatoriosCobro.ts).

export const HOJA_COBROS = 'CobrosRegistrados';
export const HEADERS_COBROS = [
  'id_cobro', 'fecha_registro', 'id_control', 'cliente', 'fecha', 'importe',
  'cuenta_id', 'transaccionid', 'numero_recibo', 'observacion', 'estado', 'usuario',
];

export interface CobroRegistrado {
  id_cobro: string;
  fecha_registro: string;  // ISO — cuándo se cargó desde la app
  id_control: string;
  cliente: string;
  fecha: string;           // YYYY-MM-DD — fecha del cobro en Xubio
  importe: number | string;
  cuenta_id: number | string;
  transaccionid: number | string;
  numero_recibo: string;
  observacion: string;
  estado: 'registrado' | 'anulado' | string;
  usuario: string;
}
