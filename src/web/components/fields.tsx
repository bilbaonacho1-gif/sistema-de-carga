/** Campos de formulario más elaborados: número con botones y deslizador, interruptor. */
import { Minus, Plus } from 'lucide-react'
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { fmt } from '../lib/format'

export function NumberStepper({ label, value, unit, min, max, step, onChange, hint, slider }: {
  label: string; value: number; unit?: string; min: number; max: number; step: number; onChange(v: number): void; hint?: ReactNode; slider?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (raw: number) => {
    const v = Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw / step) * step)) : value
    setText(String(v))
    if (v !== value) onChange(v)
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="num-field">
        <button type="button" onClick={() => commit(value - step)} disabled={value <= min} aria-label={`Restar ${fmt(step)}`}><Minus size={16} /></button>
        <span className="num-field__input">
          <input
            id={id} inputMode="numeric" value={text}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => commit(Number(text))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(Number(text))
              if (e.key === 'ArrowUp') { e.preventDefault(); commit(value + step) }
              if (e.key === 'ArrowDown') { e.preventDefault(); commit(value - step) }
            }}
          />
          {unit && <small>{unit}</small>}
        </span>
        <button type="button" onClick={() => commit(value + step)} disabled={value >= max} aria-label={`Sumar ${fmt(step)}`}><Plus size={16} /></button>
      </div>
      {slider && (
        <input
          type="range" className="range" min={min} max={max} step={step} value={value} aria-label={`${label} (deslizador)`}
          onChange={(e) => commit(Number(e.target.value))}
          style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        />
      )}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  )
}

export function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label className="switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch__track" aria-hidden><span className="switch__thumb" /></span>
        <span className="switch__label">{label}</span>
      </label>
      {hint && <span className="field__hint switch__hint">{hint}</span>}
    </div>
  )
}
