// components/NumberInput.tsx
// Input numérico que:
//  - No muestra ceros a la izquierda
//  - Permite borrar el campo (vacío) sin convertirlo en 0
//  - Devuelve siempre un número (0 si está vacío) en onChange

'use client';

import { useState, useEffect } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  id?: string;
  name?: string;
}

export default function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  required,
  disabled,
  placeholder,
  style,
  id,
  name,
}: NumberInputProps) {
  // Mantenemos el valor como string interno para poder mostrar "" cuando es 0
  const [text, setText] = useState<string>(value === 0 ? '' : String(value));

  // Si el value de afuera cambia (porque otro estado lo modifica), sincronizamos
  useEffect(() => {
    setText(value === 0 ? '' : String(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Permitir vacío
    if (raw === '') {
      setText('');
      onChange(0);
      return;
    }
    // Validar que sea un número
    const num = Number(raw);
    if (isNaN(num)) return;
    setText(raw);
    onChange(num);
  }

  function handleBlur() {
    // Al salir del campo, si quedó algo raro lo normalizamos
    if (text === '' || text === '-') {
      setText('');
      onChange(0);
      return;
    }
    const num = Number(text);
    if (!isNaN(num)) {
      // Quitar ceros a la izquierda mostrando como número limpio
      setText(num === 0 ? '' : String(num));
    }
  }

  return (
    <input
      type="number"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      min={min}
      max={max}
      step={step}
      required={required}
      disabled={disabled}
      placeholder={placeholder ?? '0'}
      style={style}
      id={id}
      name={name}
    />
  );
}
