import { redirect } from 'next/navigation';

// La regla de trabajo se mudó a la pantalla del cierre, abajo del checklist: una página
// aparte no la entraba a leer nadie, porque el mes se cierra en /eerr.
//
// Queda el redirect y no se borra la ruta: un link viejo —un mail, un favorito— daría 404, y
// un 404 no dice que el contenido se mudó.
export default function InstruccionesCierreRedirect() {
  redirect('/eerr');
}
