/** Selector de ubicación con búsqueda (posiciones de rack y zonas). */
import { MapPin } from 'lucide-react'
import { useDeferredValue, useId, useState } from 'react'
import type { Location } from '../../shared/types'
import { useLocations } from '../api/queries'
import { fmt } from '../lib/format'

type Loc = Location & { units: number; products: number }

export function LocationSelect({ value, onChange, freeOnly, label = 'Buscar ubicación (A-01-02-03, Recepción…)' }: {
  value: Loc | null; onChange(l: Loc): void; freeOnly?: boolean; label?: string
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const deferred = useDeferredValue(text.trim())
  const q = useLocations(deferred, freeOnly, open)
  const listId = useId()

  return (
    <div className="picker">
      <div className="search">
        <MapPin size={17} aria-hidden />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          placeholder={value ? `${value.code} · ${value.name}` : label}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {value && !open && (
        <p className="picker__chosen">
          <span className="mono">{value.code}</span> · {value.kind === 'zona' ? value.name : value.sector}
          {value.units > 0 ? ` · ya tiene ${fmt(value.units)} u.` : ' · libre'}
        </p>
      )}
      {open && (
        <ul className="picker__list" id={listId} role="listbox">
          {(q.data ?? []).slice(0, 12).map((l) => (
            <li key={l.id} role="option" aria-selected={value?.id === l.id}>
              <button type="button" className="picker__item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(l); setText(''); setOpen(false) }}>
                <span className="picker__code">{l.code}</span>
                <span className="picker__name">{l.kind === 'zona' ? l.name : l.sector}<small>{l.kind === 'zona' ? 'Zona de piso' : 'Posición de rack'}</small></span>
                <span className={`picker__stock${l.units ? '' : ' is-free'}`}>{l.units ? `${fmt(l.units)} u.` : 'Libre'}</span>
              </button>
            </li>
          ))}
          {q.data && !q.data.length && <li className="picker__empty">No hay ubicaciones que coincidan.</li>}
        </ul>
      )}
    </div>
  )
}
