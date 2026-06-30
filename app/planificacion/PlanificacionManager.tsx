'use client';
import { useState } from 'react';

interface Cap {
  ruc: number; rucPerfTot: number; rucPosPerf: number;
  lecF2PerfTot: number; lecPosPerf: number;
  lecF1PerfTot: number; lecF1PosPerf: number;
}
interface Props { naves: { 1: Cap; 2: Cap }; defaults: { rucDias: number; lecF2Dias: number; lecF1Dias: number }; }

const CUB = 345, POSPAQ = 3, CUBPOSRUC = 2, CUBPLLEC = 1;
const lotesConv = (d: number) => Math.round(d / 7);
const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

const ROCKET = '#ca8a04', LEAF = '#4d7c0f';
const inp: React.CSSProperties = { width: '80px', textAlign: 'center', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px', outline: 'none' };
const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', marginBottom: '16px' };

export default function PlanificacionManager({ naves, defaults }: Props) {
  const [tab, setTab] = useState<'calc' | 'crono'>('calc');
  const [rucDias, setRucDias] = useState(defaults.rucDias);
  const [lecF2Dias, setLecF2Dias] = useState(defaults.lecF2Dias);
  const [lecF1Dias, setLecF1Dias] = useState(defaults.lecF1Dias);
  const [personas, setPersonas] = useState(3);
  const [horas, setHoras] = useState(4);
  const [diasCos, setDiasCos] = useState(5);
  const [ritmoRuc, setRitmoRuc] = useState(150);
  const [ritmoLec, setRitmoLec] = useState(150);

  const rl = lotesConv(rucDias), f2l = lotesConv(lecF2Dias), f1l = lotesConv(lecF1Dias);

  function calcNave(n: 1 | 2) {
    const c = naves[n];
    const rucPos = c.ruc / Math.max(1, rl);
    const rucPaq = rucPos / POSPAQ;
    const rucPl = rucPos * CUBPOSRUC / CUB;
    const lote = (c.lecF2PerfTot / Math.max(1, f2l)) * c.lecPosPerf; // plantas/lote
    const lecPl = lote * CUBPLLEC / CUB;
    const f1PerfNec = Math.ceil(lote / Math.max(1, c.lecF1PosPerf) * f1l);
    const f1OK = c.lecF1PerfTot - f1PerfNec;
    const rucTrasp = Math.ceil(rucPos / Math.max(1, c.rucPosPerf));
    const f1Trasp = Math.ceil(lote / Math.max(1, c.lecF1PosPerf));
    const f2Trasp = Math.ceil(lote / Math.max(1, c.lecPosPerf));
    return { c, rucPos, rucPaq, rucPl, lote, lecPl, f1PerfNec, f1OK, rucTrasp, f1Trasp, f2Trasp };
  }
  const n1 = calcNave(1), n2 = calcNave(2);

  const totRucPaq = n1.rucPaq + n2.rucPaq;
  const totRucPl = n1.rucPl + n2.rucPl;
  const totLecPlantas = n1.lote + n2.lote;
  const totLecPl = n1.lecPl + n2.lecPl;

  // Mano de obra
  const hRuc = totRucPaq / Math.max(1, ritmoRuc / 2);
  const hLec = totLecPlantas / Math.max(1, ritmoLec / 2);
  const hNec = hRuc + hLec;
  const hDisp = personas * horas * diasCos;
  const alcanza = hNec <= hDisp;

  // Cronograma — reparto por día (criterio de Marcelo)
  const rucPaqN = { 1: Math.round(n1.rucPaq), 2: Math.round(n2.rucPaq) };
  const lecN = { 1: Math.round(n1.lote), 2: Math.round(n2.lote) };
  const rucPaqTot = rucPaqN[1] + rucPaqN[2];
  const lecTot = lecN[1] + lecN[2];
  const lecLun = Math.round(lecTot * 0.35), lecJue = Math.round(lecTot * 0.30), lecVie = lecTot - lecLun - lecJue;
  const rucMar = Math.round(rucPaqTot * 0.45), rucVie = rucPaqTot - rucMar;
  const byNave = (tot: number, a: number, b: number) => `N1 ${a + b ? Math.round(tot * a / (a + b)) : 0} · N2 ${a + b ? Math.round(tot * b / (a + b)) : 0}`;
  const siembraRucPl = (n1.rucPos * CUBPOSRUC / CUB + n2.rucPos * CUBPOSRUC / CUB);
  const siembraLecPl = (lecN[1] / CUB + lecN[2] / CUB);

  const tabBtn = (id: 'calc' | 'crono', label: string) => (
    <button onClick={() => setTab(id)} style={{ background: tab === id ? '#111827' : '#f3f4f6', color: tab === id ? 'white' : '#374151', border: 'none', borderRadius: '7px', padding: '7px 16px', fontSize: '13px', fontWeight: tab === id ? 700 : 500, cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>{tabBtn('calc', 'Calculadora')}{tabBtn('crono', 'Cronograma')}</div>

      {tab === 'calc' && <>
        {/* Días de ciclo */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>Días de ciclo en perfil</p>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#6b7280' }}>Default = promedio real de tus cosechas (editá para simular). Los lotes que conviven = días ÷ 7 (la planta ocupa el perfil los 7 días).</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: ROCKET, textTransform: 'uppercase' }}>● Rúcula</p>
              <Field label="Días en perfil" hint="hasta cosecha" value={rucDias} onChange={setRucDias} />
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#92400e' }}>{rl} lotes conviviendo ({rucDias}d ÷ 7)</p>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: LEAF, textTransform: 'uppercase' }}>● Lechuga</p>
              <Field label="Días en Fase 2" value={lecF2Dias} onChange={setLecF2Dias} />
              <div style={{ height: '6px' }} />
              <Field label="Días en Fase 1" value={lecF1Dias} onChange={setLecF1Dias} />
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#166534' }}>F2: {f2l} lotes · F1: {f1l} lotes</p>
            </div>
          </div>
        </div>

        {/* Naves */}
        {([[1, n1], [2, n2]] as const).map(([n, d]) => (
          <div key={n} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
              <p style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>Nave {n}</p>
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#9ca3af' }}>rúcula {fmt(d.c.ruc)} pos · lechuga F2 {d.c.lecF2PerfTot} perf</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '14px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: ROCKET, textTransform: 'uppercase' }}>● Rúcula</p>
                <p style={{ margin: 0, fontSize: '34px', fontWeight: 900, color: ROCKET, lineHeight: 1 }}>{d.rucPl.toFixed(1)}<span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 400, display: 'block' }}>planchas / semana</span></p>
                <div style={{ marginTop: '12px', borderTop: '1px dashed #e5e7eb', paddingTop: '10px', fontSize: '12px', color: '#6b7280' }}>
                  <Row k="Lote semanal" v={`${fmt(d.rucPos)} pos`} />
                  <Row k="Paquetes/sem" v={fmt(d.rucPaq)} />
                  <Row k={`Perfiles (${rl} lotes)`} v={`${d.c.rucPerfTot}`} />
                </div>
              </div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '14px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: LEAF, textTransform: 'uppercase' }}>● Lechuga · F2 marca el ritmo</p>
                <p style={{ margin: 0, fontSize: '34px', fontWeight: 900, color: LEAF, lineHeight: 1 }}>{d.lecPl.toFixed(1)}<span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 400, display: 'block' }}>planchas / semana</span></p>
                <div style={{ marginTop: '12px', borderTop: '1px dashed #e5e7eb', paddingTop: '10px', fontSize: '12px', color: '#6b7280' }}>
                  <Row k="Lote semanal" v={`${fmt(d.lote)} pl`} />
                  <Row k={`Perfiles F2 (${f2l} lotes)`} v={`${d.c.lecF2PerfTot}`} />
                  <Row k={`Perfiles F1 (${f1l} lotes)`} v={`${d.f1PerfNec} / ${d.c.lecF1PerfTot}`} />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '11.5px', fontWeight: 600, color: d.f1OK >= -2 ? '#059669' : '#dc2626' }}>
                  F1: {d.f1OK >= -2 ? `✓ alcanza${d.f1OK > 2 ? ` (sobran ${d.f1OK})` : ''}` : `⚠ faltan ${-d.f1OK} perfiles`}
                </p>
              </div>
            </div>
          </div>
        ))}

        {/* Totales */}
        <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#fffbeb)', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>Total a sembrar por semana · ambas naves</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
            <Tot v={totRucPl.toFixed(0)} l="PLANCHAS RÚCULA" c={ROCKET} />
            <Tot v={fmt(totRucPaq)} l="PAQUETES/SEM" c={ROCKET} />
            <Tot v={totLecPl.toFixed(0)} l="PLANCHAS LECHUGA" c={LEAF} />
            <Tot v={fmt(totLecPlantas)} l="PLANTAS/SEM" c={LEAF} />
          </div>
        </div>

        {/* Mano de obra */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>¿Alcanza la mano de obra?</p>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#6b7280' }}>Solo cosecha (los trasplantes consumen horas aparte). Las tasas son de a dos personas — ajustalas con tu medición real.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '14px' }}>
            <Field label="Personas" value={personas} onChange={setPersonas} />
            <Field label="Horas/día c/u" value={horas} onChange={setHoras} />
            <Field label="Días cosecha/sem" value={diasCos} onChange={setDiasCos} />
            <Field label="Rúcula paq/h" hint="de a 2" value={ritmoRuc} onChange={setRitmoRuc} />
            <Field label="Lechuga u/h" hint="de a 2" value={ritmoLec} onChange={setRitmoLec} />
          </div>
          <div style={{ borderRadius: '8px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.5, background: alcanza ? '#f0fdf4' : '#fef2f2', border: `1px solid ${alcanza ? '#86efac' : '#fca5a5'}`, color: alcanza ? '#166534' : '#dc2626' }}>
            {alcanza
              ? <><strong>✓ Alcanza.</strong> La cosecha necesita <strong>{hNec.toFixed(0)} h-persona/sem</strong> ({hRuc.toFixed(0)} rúcula + {hLec.toFixed(0)} lechuga) y tenés <strong>{hDisp}</strong>. Sobran {(hDisp - hNec).toFixed(0)} h para trasplantes y siembra.</>
              : <><strong>✗ No alcanza solo con cosecha.</strong> Necesitás <strong>{hNec.toFixed(0)} h-persona/sem</strong> ({hRuc.toFixed(0)} rúcula + {hLec.toFixed(0)} lechuga) pero tenés <strong>{hDisp}</strong>. Faltan {(hNec - hDisp).toFixed(0)} h ≈ {Math.ceil((hNec - hDisp) / Math.max(1, horas * diasCos))} persona(s) más. Y ojo: esto es SOLO cosecha.</>}
          </div>
        </div>
      </>}

      {tab === 'crono' && <>
        {/* Cadena por nave */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>Cadena completa por nave</p>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#6b7280' }}>Lo que se mueve por semana. Cambiá los días en la Calculadora y se recalcula.</p>
          {([[1, n1], [2, n2]] as const).map(([n, d]) => (
            <div key={n} style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 800 }}>Nave {n}</p>
              <Cadena color={ROCKET} titulo={`RÚCULA · ${rl} lotes (${rucDias}d)`} pasos={[['Siembra', d.rucPl.toFixed(1), 'planchas/sem'], ['Plantinera→perfil', String(d.rucTrasp), 'perfiles/sem'], ['Cosecha', fmt(d.rucPaq), 'paquetes/sem']]} />
              <div style={{ height: '8px' }} />
              <Cadena color={LEAF} titulo={`LECHUGA · F1 ${f1l} lotes (${lecF1Dias}d) · F2 ${f2l} lotes (${lecF2Dias}d)`} pasos={[['Siembra', d.lecPl.toFixed(1), 'planchas/sem'], ['Plantinera→F1', String(d.f1Trasp), 'perfiles/sem'], ['F1→F2', String(d.f2Trasp), 'perfiles/sem'], ['Cosecha', fmt(d.lote), 'plantas/sem']]} />
            </div>
          ))}
        </div>

        {/* Cronograma semanal */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>Cronograma semanal de trabajo</p>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>Cosecha semanal: {fmt(rucPaqTot)} paq rúcula + {fmt(lecTot)} lechugas. La asignación de días es criterio (lechuga lun/jue fresca, rúcula mar/vie a cámara).</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="crono-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '560px' }}>
              <thead><tr style={{ background: '#374151', color: 'white' }}>{['Día', 'Cosecha', 'Lavado', 'Trasplantes', 'Siembra'].map(h => <th key={h} style={{ padding: '8px 7px', textAlign: 'left', border: '1px solid #e5e7eb' }}>{h}</th>)}</tr></thead>
              <tbody>
                <CronoRow dia="LUNES" cos={<><b>Cosecha LECHUGA</b><br />{fmt(lecLun)} plantas<br />{byNave(lecLun, lecN[1], lecN[2])}</>} lav="Lavar perfiles cosechados" tras="—" siem="—" />
                <CronoRow dia="MARTES" bg="#f0fdf4" cos={<><b>Cosecha RÚCULA</b><br />{fmt(rucMar)} paq<br />{byNave(rucMar, rucPaqN[1], rucPaqN[2])}</>} lav="Lavar perfiles cosechados" tras={<>F1→F2 lechuga<br />(cosechado lunes)</>} siem="—" />
                <CronoRow dia="MIÉRCOLES" bg="#fffbeb" cos="— día de plantinera" lav="—" tras={<>• Plantinera→F1 lechuga<br />• Plantinera→perfil rúcula<br />• F1→F2 (cosechado martes)</>} siem={<><b>SIEMBRA</b><br />Rúcula {siembraRucPl.toFixed(0)} planchas<br />Lechuga {siembraLecPl.toFixed(1)} planchas</>} />
                <CronoRow dia="JUEVES" cos={<><b>Cosecha LECHUGA</b><br />{fmt(lecJue)} plantas<br />{byNave(lecJue, lecN[1], lecN[2])}</>} lav="Lavar perfiles cosechados" tras="—" siem="—" />
                <CronoRow dia="VIERNES" bg="#f0fdf4" cos={<><b>Cosecha FUERTE</b><br />Rúcula {fmt(rucVie)} paq<br />Lechuga {fmt(lecVie)}<br />(góndola + cámara)</>} lav="Lavar perfiles cosechados" tras={<>F1→F2 lechuga<br />(cosechado jueves)</>} siem="—" />
                <CronoRow dia="SÁBADO" bg="#f0fdf4" cos="—" lav="—" tras={<>Trasplantes (cosechado viernes):<br />Rúcula→perfil + Lechuga F1→F2</>} siem="—" />
              </tbody>
            </table>
          </div>
        </div>

        {/* Trasplantes por semana */}
        <div style={card}>
          <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>Trasplantes por semana (lote completo)</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="crono-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#374151', color: 'white' }}>{['Movimiento', 'Nave 1', 'Nave 2'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>{h}</th>)}</tr></thead>
              <tbody>
                <TrasRow m="Rúcula: plantinera → perfil" a={`${n1.rucTrasp} perfiles`} b={`${n2.rucTrasp} perfiles`} />
                <TrasRow m="Lechuga: plantinera → F1" a={`${n1.f1Trasp} perfiles`} b={`${n2.f1Trasp} perfiles`} />
                <TrasRow m="Lechuga: F1 → F2" a={`${n1.f2Trasp} perfiles`} b={`${n2.f2Trasp} perfiles`} />
              </tbody>
            </table>
          </div>
        </div>
      </>}

      <p style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginTop: '12px' }}>
        1 plancha = {CUB} cubitos · rúcula {CUBPOSRUC} cubitos/posición, {POSPAQ} posiciones/paquete · lechuga {CUBPLLEC} cubito/planta · posición = planta
      </p>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
      <label style={{ fontSize: '13px', color: '#6b7280' }}>{label}{hint && <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '4px' }}>{hint}</span>}</label>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value) || 0)} style={inp} />
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>{k}</span><b style={{ color: '#111827', fontFamily: 'monospace', fontWeight: 600 }}>{v}</b></div>;
}
function Tot({ v, l, c }: { v: string; l: string; c: string }) {
  return <div style={{ textAlign: 'center' }}><p style={{ margin: 0, fontSize: '28px', fontWeight: 900, color: c, lineHeight: 1 }}>{v}</p><p style={{ margin: '6px 0 0', fontSize: '10px', color: '#6b7280', fontFamily: 'monospace' }}>{l}</p></div>;
}
function Cadena({ color, titulo, pasos }: { color: string; titulo: string; pasos: [string, string, string][] }) {
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color }}>● {titulo}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'stretch' }}>
        {pasos.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '8px 11px', minWidth: '110px' }}>
              <p style={{ margin: '0 0 3px', fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', color: '#9ca3af' }}>{p[0]}</p>
              <p style={{ margin: 0, fontWeight: 900, fontSize: '19px', color }}>{p[1]}</p>
              <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ca3af' }}>{p[2]}</p>
            </div>
            {i < pasos.length - 1 && <span style={{ color: '#9ca3af', fontSize: '16px' }}>→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
function CronoRow({ dia, cos, lav, tras, siem, bg }: { dia: string; cos: any; lav: any; tras: any; siem: any; bg?: string }) {
  const td: React.CSSProperties = { padding: '8px 7px', border: '1px solid #e5e7eb', verticalAlign: 'top', lineHeight: 1.4, color: '#374151', background: bg || 'white' };
  return (
    <tr>
      <td style={{ ...td, background: '#e5e7eb', fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{dia}</td>
      <td style={td}>{cos}</td><td style={td}>{lav}</td><td style={td}>{tras}</td><td style={td}>{siem}</td>
    </tr>
  );
}
function TrasRow({ m, a, b }: { m: string; a: string; b: string }) {
  const td: React.CSSProperties = { padding: '8px 10px', border: '1px solid #e5e7eb' };
  return <tr><td style={{ ...td, fontWeight: 600 }}>{m}</td><td style={{ ...td, fontFamily: 'monospace' }}>{a}</td><td style={{ ...td, fontFamily: 'monospace' }}>{b}</td></tr>;
}
