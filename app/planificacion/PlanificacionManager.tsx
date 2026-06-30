'use client';
import { useEffect, useState } from 'react';

interface Cap {
  ruc: number; rucPerfTot: number; rucPosPerf: number;
  lecF2PerfTot: number; lecPosPerf: number;
  lecF1PerfTot: number; lecF1PosPerf: number;
}
interface Props { naves: { 1: Cap; 2: Cap }; defaults: { rucDias: number; lecF2Dias: number; lecF1Dias: number }; }

type Cultivo = 'lechuga' | 'rucula';
interface Slot { cultivo: Cultivo; dia: number; pct: number } // dia 1=Lun … 6=Sáb

const CUB = 345, POSPAQ = 3, CUBPOSRUC = 2, CUBPLLEC = 1;
const lotesConv = (d: number) => Math.round(d / 7);
const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

const ROCKET = '#ca8a04', LEAF = '#4d7c0f';
const DIAS = [{ n: 1, l: 'Lun', full: 'LUNES' }, { n: 2, l: 'Mar', full: 'MARTES' }, { n: 3, l: 'Mié', full: 'MIÉRCOLES' }, { n: 4, l: 'Jue', full: 'JUEVES' }, { n: 5, l: 'Vie', full: 'VIERNES' }, { n: 6, l: 'Sáb', full: 'SÁBADO' }];
const REPARTO_DEFAULT: Slot[] = [
  { cultivo: 'lechuga', dia: 1, pct: 35 }, { cultivo: 'lechuga', dia: 4, pct: 30 }, { cultivo: 'lechuga', dia: 5, pct: 35 },
  { cultivo: 'rucula', dia: 2, pct: 45 }, { cultivo: 'rucula', dia: 5, pct: 55 },
];
const DIA_SIEMBRA = 3; // miércoles

const inp: React.CSSProperties = { width: '80px', textAlign: 'center', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px', outline: 'none' };
const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', marginBottom: '16px' };
const sel: React.CSSProperties = { fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', background: 'white' };

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
  const [reparto, setReparto] = useState<Slot[]>(REPARTO_DEFAULT);

  // Persistir el reparto (el criterio de días/%) en el navegador
  useEffect(() => {
    try { const s = localStorage.getItem('xavia_plan_reparto'); if (s) setReparto(JSON.parse(s)); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('xavia_plan_reparto', JSON.stringify(reparto)); } catch {}
  }, [reparto]);

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

  // ── Reparto de cosecha por día (editable) ──
  const totSemana = (cul: Cultivo) => cul === 'lechuga' ? totLecPlantas : totRucPaq;
  const naveSemana = (cul: Cultivo, nave: 1 | 2) => cul === 'lechuga' ? (nave === 1 ? n1.lote : n2.lote) : (nave === 1 ? n1.rucPaq : n2.rucPaq);
  const pctDia = (cul: Cultivo, dia: number) => reparto.filter(s => s.cultivo === cul && s.dia === dia).reduce((a, s) => a + s.pct, 0);
  const cosDia = (cul: Cultivo, dia: number) => totSemana(cul) * pctDia(cul, dia) / 100;
  const cosNaveDia = (cul: Cultivo, nave: 1 | 2, dia: number) => naveSemana(cul, nave) * pctDia(cul, dia) / 100;
  const sumPct = (cul: Cultivo) => reparto.filter(s => s.cultivo === cul).reduce((a, s) => a + s.pct, 0);
  const cosechaEnDia = (dia: number) => pctDia('lechuga', dia) > 0 || pctDia('rucula', dia) > 0;
  const trasplanteEnDia = (dia: number) => dia === DIA_SIEMBRA || (dia > 1 && cosechaEnDia(dia - 1));
  const siembraRucPl = (n1.rucPos * CUBPOSRUC / CUB + n2.rucPos * CUBPOSRUC / CUB);
  const siembraLecPl = (n1.lote / CUB + n2.lote / CUB);

  const updSlot = (i: number, patch: Partial<Slot>) => setReparto(r => r.map((s, j) => j === i ? { ...s, ...patch } : s));
  const delSlot = (i: number) => setReparto(r => r.filter((_, j) => j !== i));
  const addSlot = () => setReparto(r => [...r, { cultivo: 'lechuga', dia: 1, pct: 0 }]);

  // ── Tareas de hoy ──
  const jsDay = new Date().getDay(); // 0=Dom … 6=Sáb
  const hoyDia = jsDay === 0 ? 0 : jsDay; // 1..6 = Lun..Sáb, 0 = Dom
  const hoyNombre = jsDay === 0 ? 'Domingo' : DIAS[hoyDia - 1].full;
  const hoyFecha = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  const tareasHoy: { icon: string; txt: string; color: string }[] = [];
  if (hoyDia >= 1 && hoyDia <= 6) {
    if (pctDia('lechuga', hoyDia) > 0) tareasHoy.push({ icon: '🥬', color: LEAF, txt: `Cosechar ~${fmt(cosDia('lechuga', hoyDia))} plantas de lechuga — N1 ${fmt(cosNaveDia('lechuga', 1, hoyDia))} · N2 ${fmt(cosNaveDia('lechuga', 2, hoyDia))}` });
    if (pctDia('rucula', hoyDia) > 0) tareasHoy.push({ icon: '🌿', color: ROCKET, txt: `Cosechar ~${fmt(cosDia('rucula', hoyDia))} paquetes de rúcula — N1 ${fmt(cosNaveDia('rucula', 1, hoyDia))} · N2 ${fmt(cosNaveDia('rucula', 2, hoyDia))}` });
    if (hoyDia === DIA_SIEMBRA) tareasHoy.push({ icon: '🌱', color: '#0891b2', txt: `Sembrar ${siembraRucPl.toFixed(0)} planchas de rúcula + ${siembraLecPl.toFixed(1)} de lechuga` });
    if (trasplanteEnDia(hoyDia)) tareasHoy.push({ icon: '🔄', color: '#7c3aed', txt: `Trasplantar a perfiles liberados (F1→F2 lechuga, plantinera→perfil rúcula${hoyDia === DIA_SIEMBRA ? ', plantinera→F1' : ''})` });
    if (cosechaEnDia(hoyDia)) tareasHoy.push({ icon: '🧽', color: '#6b7280', txt: 'Lavar los perfiles cosechados' });
    if (hoyDia === 5 || hoyDia === 6) tareasHoy.push({ icon: '📦', color: '#2563eb', txt: 'Hacer control de stock de rúculas y lechugas' });
  }

  const tabBtn = (id: 'calc' | 'crono', label: string) => (
    <button onClick={() => setTab(id)} style={{ background: tab === id ? '#111827' : '#f3f4f6', color: tab === id ? 'white' : '#374151', border: 'none', borderRadius: '7px', padding: '7px 16px', fontSize: '13px', fontWeight: tab === id ? 700 : 500, cursor: 'pointer' }}>{label}</button>
  );

  const rucPaqN = { 1: Math.round(n1.rucPaq), 2: Math.round(n2.rucPaq) };
  const lecN = { 1: Math.round(n1.lote), 2: Math.round(n2.lote) };

  return (
    <div>
      {/* ── Tareas de hoy ── */}
      <div style={{ ...card, borderColor: '#bfdbfe', background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '4px' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>📋 Tareas de hoy</p>
          <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>{hoyNombre} {hoyFecha}</span>
        </div>
        {tareasHoy.length === 0
          ? <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{hoyDia === 0 ? 'Domingo — sin tareas de producción programadas.' : 'Sin cosecha programada para hoy en el reparto.'}</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {tareasHoy.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '13.5px', lineHeight: 1.4 }}>
                <span style={{ fontSize: '15px' }}>{t.icon}</span><span style={{ color: '#374151' }}>{t.txt}</span>
              </div>
            ))}
          </div>}
        <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#9ca3af' }}>Calculado del reparto semanal y la capacidad real. Ajustá días/% en la pestaña Cronograma.</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>{tabBtn('calc', 'Calculadora')}{tabBtn('crono', 'Cronograma')}</div>

      {tab === 'calc' && <>
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

        <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#fffbeb)', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>Total a sembrar por semana · ambas naves</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
            <Tot v={totRucPl.toFixed(0)} l="PLANCHAS RÚCULA" c={ROCKET} />
            <Tot v={fmt(totRucPaq)} l="PAQUETES/SEM" c={ROCKET} />
            <Tot v={totLecPl.toFixed(0)} l="PLANCHAS LECHUGA" c={LEAF} />
            <Tot v={fmt(totLecPlantas)} l="PLANTAS/SEM" c={LEAF} />
          </div>
        </div>

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
        {/* Reparto editable */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>Reparto de cosecha por día</p>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>Qué cultivo cosechar cada día y qué % del total semanal. Es el criterio que define el cronograma y las tareas del día. Se guarda en tu navegador.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', maxWidth: '520px' }}>
            <thead><tr style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase' }}>{['Cultivo', 'Día', '%', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {reparto.map((s, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 8px' }}>
                    <select value={s.cultivo} onChange={e => updSlot(i, { cultivo: e.target.value as Cultivo })} style={sel}>
                      <option value="lechuga">Lechuga</option><option value="rucula">Rúcula</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <select value={s.dia} onChange={e => updSlot(i, { dia: Number(e.target.value) })} style={sel}>
                      {DIAS.map(d => <option key={d.n} value={d.n}>{d.full[0] + d.full.slice(1).toLowerCase()}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input type="number" value={s.pct} onChange={e => updSlot(i, { pct: Number(e.target.value) || 0 })} style={{ ...inp, width: '64px', padding: '5px' }} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <button onClick={() => delSlot(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px' }} title="Quitar">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
            <button onClick={addSlot} style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' }}>+ Agregar día</button>
            <button onClick={() => setReparto(REPARTO_DEFAULT)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Restaurar criterio default</button>
            {(['lechuga', 'rucula'] as Cultivo[]).map(c => {
              const t = sumPct(c); const ok = t === 100;
              return <span key={c} style={{ fontSize: '12px', fontWeight: 600, color: ok ? '#059669' : '#dc2626' }}>{c === 'lechuga' ? 'Lechuga' : 'Rúcula'}: {t}%{ok ? ' ✓' : ' ⚠ ≠100'}</span>;
            })}
          </div>
        </div>

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

        {/* Cronograma semanal generado del reparto */}
        <div style={card}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>Cronograma semanal de trabajo</p>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>Generado del reparto de arriba. La fila de hoy queda resaltada.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="crono-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '560px' }}>
              <thead><tr style={{ background: '#374151', color: 'white' }}>{['Día', 'Cosecha', 'Lavado', 'Trasplantes', 'Siembra'].map(h => <th key={h} style={{ padding: '8px 7px', textAlign: 'left', border: '1px solid #e5e7eb' }}>{h}</th>)}</tr></thead>
              <tbody>
                {DIAS.map(d => {
                  const hayLec = pctDia('lechuga', d.n) > 0, hayRuc = pctDia('rucula', d.n) > 0;
                  const hayCos = hayLec || hayRuc;
                  const esHoy = d.n === hoyDia;
                  return (
                    <CronoRow key={d.n} dia={d.full} hoy={esHoy}
                      cos={hayCos ? <>
                        {hayLec && <><b style={{ color: LEAF }}>Lechuga {fmt(cosDia('lechuga', d.n))}</b> <span style={{ color: '#9ca3af' }}>(N1 {fmt(cosNaveDia('lechuga', 1, d.n))}·N2 {fmt(cosNaveDia('lechuga', 2, d.n))})</span><br /></>}
                        {hayRuc && <><b style={{ color: ROCKET }}>Rúcula {fmt(cosDia('rucula', d.n))} paq</b> <span style={{ color: '#9ca3af' }}>(N1 {fmt(cosNaveDia('rucula', 1, d.n))}·N2 {fmt(cosNaveDia('rucula', 2, d.n))})</span></>}
                      </> : '—'}
                      lav={hayCos ? 'Lavar perfiles cosechados' : '—'}
                      tras={trasplanteEnDia(d.n) ? <>A perfiles liberados:<br />F1→F2 lechuga{d.n === DIA_SIEMBRA ? <><br />plantinera→F1 + rúcula→perfil</> : ''}</> : '—'}
                      siem={d.n === DIA_SIEMBRA ? <><b>SIEMBRA</b><br />Rúcula {siembraRucPl.toFixed(0)} planchas<br />Lechuga {siembraLecPl.toFixed(1)} planchas</> : '—'} />
                  );
                })}
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
function CronoRow({ dia, cos, lav, tras, siem, hoy }: { dia: string; cos: any; lav: any; tras: any; siem: any; hoy?: boolean }) {
  const bg = hoy ? '#eff6ff' : 'white';
  const td: React.CSSProperties = { padding: '8px 7px', border: '1px solid #e5e7eb', verticalAlign: 'top', lineHeight: 1.4, color: '#374151', background: bg };
  return (
    <tr>
      <td style={{ ...td, background: hoy ? '#bfdbfe' : '#e5e7eb', fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{dia}{hoy && <div style={{ fontSize: '9px', color: '#1d4ed8' }}>HOY</div>}</td>
      <td style={td}>{cos}</td><td style={td}>{lav}</td><td style={td}>{tras}</td><td style={td}>{siem}</td>
    </tr>
  );
}
function TrasRow({ m, a, b }: { m: string; a: string; b: string }) {
  const td: React.CSSProperties = { padding: '8px 10px', border: '1px solid #e5e7eb' };
  return <tr><td style={{ ...td, fontWeight: 600 }}>{m}</td><td style={{ ...td, fontFamily: 'monospace' }}>{a}</td><td style={{ ...td, fontFamily: 'monospace' }}>{b}</td></tr>;
}
