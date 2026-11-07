'use client';
import { useState } from 'react';

// Dos cosas distintas que se guardan juntas porque se cargan en el mismo momento:
//
// PREVISIONES (despidos, SAC) son plata que todavía no se debe pero se va a deber, y salen
// de una fórmula sobre la masa salarial del mes. La app las propone; lo guardado manda,
// porque si el mes cerrado se recalculara solo cada vez que se corrige un sueldo cargado
// tarde, no serviría para comparar contra nada.
//
// CUENTAS CORRIENTES (alquiler, EPE) son deuda real con un tercero. No hay fórmula que las
// pueda calcular: van a mano.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const subtitulo: React.CSSProperties = {
  margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.4px',
};

export default function PrevisionesEditor({ anio, mes, masaSalarial, sugeridas, guardadas, acumulado, inicial = null }: {
  anio: number; mes: number; masaSalarial: number;
  sugeridas: { despidos: number; sac: number };
  guardadas: { despidos: number; sac: number; alquiler: number; epe: number; usadoDespidos?: number; usadoSac?: number; notas: string; fecha: string } | null;
  // Lo previsto en meses anteriores y todavía sin usar: es lo que se puede consumir al
  // pagar el aguinaldo sin que el mes muestre un costo que ya se había cargado.
  acumulado: { despidos: number; sac: number };
  // Lo que ya se venía reservando antes de que existiera esta pantalla. null = nunca se
  // cargó, que no es lo mismo que cero: uno es "no hay arrastre", el otro "nadie lo dijo".
  inicial?: { despidos: number; sac: number } | null;
}) {
  // Arranca cerrado. Es un bloque que se toca una vez por mes, y ocupaba media pantalla
  // todos los días arriba del EERR. Cerrado dice lo único que hay que saber de un vistazo:
  // si ya se guardó este mes y por cuánto.
  const [abierto, setAbierto] = useState(false);
  const [despidos, setDespidos] = useState(String(Math.round(guardadas?.despidos ?? sugeridas.despidos)));
  const [sac, setSac] = useState(String(Math.round(guardadas?.sac ?? sugeridas.sac)));
  // Sin fórmula: van a mano, igual que en el Excel.
  const [alquiler, setAlquiler] = useState(String(Math.round(guardadas?.alquiler ?? 0)));
  const [epe, setEpe] = useState(String(Math.round(guardadas?.epe ?? 0)));
  const [notas, setNotas] = useState(guardadas?.notas ?? '');
  const [estado, setEstado] = useState<'idle' | 'guardando' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [yaGuardado, setYaGuardado] = useState(!!guardadas);
  // Lo que se consume de la reserva este mes. Cero salvo que se esté pagando el aguinaldo
  // o una indemnización, que es cuando la previsión deja de ser una reserva y se gasta.
  const [usadoDespidos, setUsadoDespidos] = useState(String(Math.round(guardadas?.usadoDespidos ?? 0)));
  const [usadoSac, setUsadoSac] = useState(String(Math.round(guardadas?.usadoSac ?? 0)));
  const [verInicial, setVerInicial] = useState(false);
  const [iniDespidos, setIniDespidos] = useState(String(Math.round(inicial?.despidos ?? 0)));
  const [iniSac, setIniSac] = useState(String(Math.round(inicial?.sac ?? 0)));
  const [iniMsg, setIniMsg] = useState<string | null>(null);

  // El arrastre se guarda aparte del mes: no pertenece a ningún período, y meterlo en el
  // mismo botón haría que corregirlo obligara a volver a guardar el mes.
  async function guardarInicial() {
    setIniMsg('Guardando…');
    try {
      const res = await fetch('/api/previsiones/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'inicial', despidos: Number(iniDespidos) || 0, sac: Number(iniSac) || 0 }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'No se pudo guardar');
      setIniMsg('✓ Guardado. Recargá para ver el disponible actualizado.');
    } catch (e: any) { setIniMsg(e?.message || 'No se pudo guardar'); }
  }
  const hayUso = Number(usadoDespidos) > 0 || Number(usadoSac) > 0;

  const difDespidos = Math.abs(Number(despidos) - sugeridas.despidos) > 1;
  const difSac = Math.abs(Number(sac) - sugeridas.sac) > 1;

  async function guardar() {
    setEstado('guardando'); setError(null);
    try {
      const res = await fetch('/api/previsiones/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, despidos: Number(despidos), sac: Number(sac), alquiler: Number(alquiler), epe: Number(epe),
          usadoDespidos: Number(usadoDespidos) || 0, usadoSac: Number(usadoSac) || 0, notas }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setEstado('ok'); setYaGuardado(true);
    } catch (e: any) {
      setEstado('error'); setError(e?.message || 'No se pudo guardar');
    }
  }

  const campo = (label: string, valor: string, set: (v: string) => void, sugerido: number, distinto: boolean) => (
    <div style={{ minWidth: '190px' }}>
      <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>{label}</label>
      <input
        type="number" value={valor} min={0} step={1}
        onChange={(e) => { set(e.target.value); setEstado('idle'); }}
        style={{ width: '100%', textAlign: 'right', fontSize: '15px', fontWeight: 700, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      />
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: distinto ? '#b45309' : '#9ca3af' }}>
        {distinto ? `Editado a mano · la fórmula da ${$(sugerido)}` : `Según la fórmula: ${$(sugerido)}`}
        {distinto && (
          <button onClick={() => { set(String(Math.round(sugerido))); setEstado('idle'); }}
            style={{ marginLeft: '6px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: '11px', fontWeight: 600 }}>
            volver
          </button>
        )}
      </p>
    </div>
  );

  // Un campo de uso: cuánto de la reserva se consume este mes, con el disponible al lado.
  const usar = (label: string, valor: string, set: (v: string) => void, disponible: number) => (
    <div style={{ minWidth: '190px' }}>
      <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>{label}</label>
      <input
        type="number" value={valor} min={0} step={1}
        onChange={(e) => { set(e.target.value); setEstado('idle'); }}
        style={{ width: '100%', textAlign: 'right', fontSize: '15px', fontWeight: 700, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      />
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#9ca3af' }}>
        Disponible: {$(disponible)}
        {disponible > 0 && (
          <button onClick={() => { set(String(disponible)); setEstado('idle'); }}
            style={{ marginLeft: '6px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: '11px', fontWeight: 600 }}>
            usar todo
          </button>
        )}
      </p>
    </div>
  );

  // Los que no tienen fórmula: solo se guardan, sin sugerencia que comparar.
  const libre = (label: string, valor: string, set: (v: string) => void) => (
    <div style={{ minWidth: '140px' }}>
      <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>{label}</label>
      <input
        type="number" value={valor} min={0} step={1}
        onChange={(e) => { set(e.target.value); setEstado('idle'); }}
        style={{ width: '100%', textAlign: 'right', fontSize: '15px', fontWeight: 700, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      />
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#9ca3af' }}>Sin fórmula: se carga a mano</p>
    </div>
  );

  const totalMes = Math.round(Number(despidos) + Number(sac));

  if (!abierto) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#374151' }}>
            {yaGuardado
              ? <>✓ <strong>Hecho este mes</strong> · se previeron {$(totalMes)}{hayUso ? ` y se usaron ${$(Number(usadoDespidos) + Number(usadoSac))} de la reserva` : ''}</>
              : <><span style={{ color: '#b45309', fontWeight: 700 }}>⚠ Falta guardarlo este mes</span> · la fórmula sugiere {$(sugeridas.despidos + sugeridas.sac)}</>}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>
            Reserva acumulada sin usar: SAC {$(acumulado.sac)} · despidos {$(acumulado.despidos)}
          </p>
        </div>
        <button type="button" className="btn secondary" style={{ fontSize: '13px' }} onClick={() => setAbierto(true)}>
          {yaGuardado ? 'Ver / cambiar →' : 'Cargar →'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => setAbierto(false)}
          style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Cerrar</button>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6b7280' }}>
        Las previsiones salen de una masa salarial de <strong>{$(masaSalarial)}</strong> — despidos 6%, SAC un doceavo. Las cuentas corrientes van a mano.
        {masaSalarial === 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> No hay sueldos cargados este mes, así que la fórmula da cero.</span>}
      </p>

      <p style={subtitulo}>Previsiones — plata que todavía no se debe pero se va a deber</p>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {campo('Previsión despidos', despidos, setDespidos, sugeridas.despidos, difDespidos)}
        {campo('Previsión SAC', sac, setSac, sugeridas.sac, difSac)}
      </div>

      {/* ── Usar la reserva ────────────────────────────────────────────────────────────
          Llega el momento: se paga el aguinaldo. Ese pago se carga como gasto de sueldos
          igual que siempre, pero NO es costo nuevo de este mes — se venía reservando desde
          hace meses y cada uno ya lo cargó en su resultado.
          Lo que se escribe acá se RESTA de la previsión del mes, así que cancela el gasto
          del pago y el resultado vuelve a mostrar solo lo devengado en el mes. Sin esto,
          junio y diciembre mostraban el costo laboral dos veces. */}
      <p style={{ ...subtitulo, marginTop: '18px' }}>Usar la reserva — cuando se paga el aguinaldo o una indemnización</p>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {usar('Se usó de SAC', usadoSac, setUsadoSac, acumulado.sac)}
        {usar('Se usó de despidos', usadoDespidos, setUsadoDespidos, acumulado.despidos)}
      </div>
      {hayUso && (
        <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#1e3a8a', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '7px 10px', lineHeight: 1.55 }}>
          El pago se carga aparte, como gasto de sueldos. Lo que ponés acá hace que
          <strong> no se cuente dos veces</strong>: ya lo cargaron los meses que lo fueron reservando.
        </p>
      )}

      {/* ── El arrastre de antes de la app ──────────────────────────────────────────
          La reserva no empezó el día que se cargó el primer mes acá: venía de antes. Sin
          forma de decirlo, el disponible arranca en cero y el primer aguinaldo aparece
          como si no se hubiera previsto nada, justo el mes en que más importa.
          Se guarda aparte del mes porque no pertenece a ningún período: corregirlo no
          tiene que obligar a volver a guardar octubre. */}
      <p style={{ ...subtitulo, marginTop: '18px' }}>
        Arrastre — lo que ya venías reservando antes de la app
        <button type="button" onClick={() => setVerInicial((v) => !v)}
          style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: '11px', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
          {verInicial ? 'cerrar' : (inicial ? 'cambiar' : 'cargar')}
        </button>
      </p>
      {!verInicial ? (
        <p style={{ margin: '0 0 4px', fontSize: '11.5px', color: inicial ? '#374151' : '#b45309' }}>
          {inicial
            ? <>Cargado: SAC {$(inicial.sac)} · despidos {$(inicial.despidos)}. Ya está sumado en el disponible.</>
            : <>Sin cargar. Si venías reservando antes de usar la app, el disponible de arriba está incompleto.</>}
        </p>
      ) : (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '9px 11px', marginBottom: '6px' }}>
          <p style={{ margin: '0 0 7px', fontSize: '11px', color: '#6b7280', lineHeight: 1.5 }}>
            El saldo de reserva que ya tenías juntado el día que empezaste a cargar el EERR acá.
            No es de ningún mes: se suma al disponible y se consume igual que el resto.
          </p>
          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>SAC que venía de antes</label>
              <input type="number" value={iniSac} min={0} onChange={(e) => { setIniSac(e.target.value); setIniMsg(null); }}
                style={{ width: '140px', textAlign: 'right', fontSize: '14px', fontWeight: 700, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280', fontWeight: 600 }}>Despidos que venían de antes</label>
              <input type="number" value={iniDespidos} min={0} onChange={(e) => { setIniDespidos(e.target.value); setIniMsg(null); }}
                style={{ width: '140px', textAlign: 'right', fontSize: '14px', fontWeight: 700, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
            </div>
            <button type="button" onClick={guardarInicial}
              style={{ fontSize: '12px', padding: '6px 14px', background: '#374151', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
              Guardar arrastre
            </button>
            {iniMsg && <span style={{ fontSize: '11px', color: iniMsg.startsWith('✓') ? '#059669' : '#b45309' }}>{iniMsg}</span>}
          </div>
        </div>
      )}

      <p style={{ ...subtitulo, marginTop: '18px' }}>Cuentas corrientes — deuda con un tercero</p>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {libre('Alquiler', alquiler, setAlquiler)}
        {libre('EPE', epe, setEpe)}
        <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginBottom: '3px' }}>Notas</label>
          <input
            type="text" value={notas} placeholder="Por qué se cambió, si se cambió"
            onChange={(e) => { setNotas(e.target.value); setEstado('idle'); }}
            style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
        <button onClick={guardar} className="btn" disabled={estado === 'guardando'} style={{ fontSize: '13px' }}>
          {estado === 'guardando' ? 'Guardando…' : yaGuardado ? 'Actualizar previsiones' : 'Guardar previsiones'}
        </button>
        {estado === 'ok' && <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>✓ Guardado</span>}
        {estado === 'error' && <span style={{ fontSize: '12px', color: '#dc2626' }}>No se guardó: {error}</span>}
        {estado === 'idle' && !yaGuardado && (
          <span style={{ fontSize: '11.5px', color: '#b45309' }}>Todavía sin guardar para este mes — se está mostrando la sugerencia.</span>
        )}
        {estado === 'idle' && yaGuardado && guardadas && (
          <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
            Guardado el {String(guardadas.fecha).split('T')[0].split('-').reverse().join('/')}
          </span>
        )}
      </div>
    </div>
  );
}
