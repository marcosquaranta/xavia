'use client';
import { useState, useEffect } from 'react';
export default function NumberInput({ value, onChange, min, max, step, required, disabled, placeholder, style, id, name, hideZero = true }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; required?: boolean; disabled?: boolean; placeholder?: string; style?: React.CSSProperties; id?: string; name?: string; hideZero?: boolean; }) {
  const [text, setText] = useState<string>(value === 0 && hideZero ? '' : String(value));
  useEffect(() => { setText(value === 0 && hideZero ? '' : String(value)); }, [value, hideZero]);
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') { setText(''); onChange(0); return; }
    const num = Number(raw); if (isNaN(num)) return;
    setText(raw); onChange(num);
  }
  function handleBlur() {
    if (text === '' || text === '-') { setText(hideZero ? '' : '0'); onChange(0); return; }
    const num = Number(text);
    if (!isNaN(num)) setText(num === 0 && hideZero ? '' : String(num));
  }
  return <input type="number" value={text} onChange={handleChange} onBlur={handleBlur} min={min} max={max} step={step} required={required} disabled={disabled} placeholder={placeholder ?? '0'} style={style} id={id} name={name} />;
}