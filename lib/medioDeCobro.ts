// ── Con qué nos pagan, y qué cambia según eso ────────────────────────────────────────
//
// Un aviso de pago no vale lo mismo según cómo se cobre, y hasta ahora todos se trataban
// igual: la factura quedaba cubierta hasta la fecha prometida más una semana de gracia, y
// pasada esa fecha volvía a reclamarse. Para una transferencia anunciada está bien — si no
// llegó, no llegó. Para los otros dos medios está mal, cada uno por su lado:
//
//  - CHEQUE. El cheque ya está en nuestra mano. La factura está cobrada desde que lo
//    recibimos, aunque se deposite a 30 días: volver a reclamarle al cliente una factura
//    que nos pagó con un cheque que tenemos guardado es, además de incómodo, decirle que
//    no registramos su pago. Lo que sí queda pendiente no es el cobro: es depositarlo.
//
//  - EFECTIVO. También está cobrado, pero la plata no entró a ninguna cuenta: entró a la
//    caja de alguien. El riesgo no es que el cliente no pague —ya pagó— sino que esa plata
//    no aparezca en ningún lado. Entonces sigue cubriendo la factura, y lo que queda
//    abierto es OTRA cosa: dónde fue a parar.
//
// Por eso acá no se decide "cobrado o no cobrado", se decide qué queda pendiente. Las dos
// pendencias existen y son distintas, y mezclarlas fue lo que hizo que un cobro en efectivo
// terminara contado como una factura impaga.

export type MedioCobro = 'cheque' | 'efectivo' | 'transferencia' | 'desconocido';

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Se mira el origen declarado primero —si alguien cargó la fila como cheque, es un cheque—
// y después el texto. El texto es la fuente menos confiable de las dos, así que las
// palabras tienen que ser inequívocas: "echeq" y "cheque" lo son, "pago" no.
const PALABRAS: { medio: MedioCobro; re: RegExp }[] = [
  { medio: 'cheque', re: /\b(cheque|cheques|echeq|e-?cheq|ech\b)/ },
  { medio: 'efectivo', re: /\b(efectivo|en mano|personalmente|en persona|caja chica)\b/ },
  { medio: 'transferencia', re: /\b(transferencia|transferi|deposito bancario|acreditacion)\b/ },
];

export function medioDeCobro(item: {
  origen?: string; descripcion?: string; texto_mail?: string; nota?: string; cuenta_destino?: string;
}): MedioCobro {
  const origen = norm(item?.origen);
  if (origen === 'cheque') return 'cheque';
  if (origen === 'banco') return 'transferencia';

  const texto = norm([item?.descripcion, item?.texto_mail, item?.nota].filter(Boolean).join(' '));
  if (!texto) return 'desconocido';
  for (const { medio, re } of PALABRAS) if (re.test(texto)) return medio;
  return 'desconocido';
}

export interface PendenciaCobro {
  // La factura sigue cubierta aunque se haya pasado la fecha prometida.
  cubreSiempre: boolean;
  // Lo que queda por hacer, que no es cobrar.
  pendiente: 'depositar' | 'imputar_destino' | null;
  motivo: string;
}

export function pendenciaDe(medio: MedioCobro, cuentaDestino?: string): PendenciaCobro {
  if (medio === 'cheque') {
    return {
      cubreSiempre: true,
      pendiente: 'depositar',
      motivo: 'El cheque ya está en nuestra mano: la factura está cobrada. Lo que falta es depositarlo.',
    };
  }
  if (medio === 'efectivo') {
    const tieneDestino = !!String(cuentaDestino || '').trim();
    return {
      cubreSiempre: true,
      pendiente: tieneDestino ? null : 'imputar_destino',
      motivo: tieneDestino
        ? 'Cobrado en efectivo e imputado a una caja.'
        : 'Cobrado en efectivo, pero no está dicho a qué caja entró esa plata.',
    };
  }
  // Transferencia y lo que no se pudo clasificar siguen con la regla de siempre: cubren
  // hasta la fecha prometida más la gracia, y después vuelven a reclamarse. Si no llegó,
  // no llegó.
  return { cubreSiempre: false, pendiente: null, motivo: '' };
}
