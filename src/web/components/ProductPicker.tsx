/** Buscador de productos para agregar a un pedido (teclado: ↑ ↓ Enter). */
import { Plus, Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { Product } from '../../shared/types'
import { fmt } from '../lib/format'

type CatalogItem = Product & { available: number }

export function ProductPicker({ catalog, exclude, onPick }: { catalog: CatalogItem[]; exclude: number[]; onPick(p: CatalogItem): void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const results = useMemo(() => {
    const t = text.trim().toLowerCase()
    return catalog
      .filter((p) => !exclude.includes(p.id))
      .filter((p) => !t || `${p.code} ${p.name} ${p.category}`.toLowerCase().includes(t))
      .slice(0, 8)
  }, [catalog, exclude, text])

  const pick = (p: CatalogItem) => {
    onPick(p)
    setText('')
    setActive(0)
    setOpen(false)
  }

  return (
    <div className="picker">
      <div className="search">
        <Search size={17} aria-hidden />
        <input
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Buscar producto para agregar"
          placeholder="Buscar producto por nombre o código"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active]) }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      {open && results.length > 0 && (
        <ul className="picker__list" id={listId} role="listbox">
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" className={`picker__item${i === active ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setActive(i)}>
                <span className="picker__code">{p.code}</span>
                <span className="picker__name">{p.name}<small>{p.category}</small></span>
                <span className={`picker__stock${p.available > 0 ? '' : ' is-out'}`}>{p.available > 0 ? `Disp. ${fmt(p.available)} ${p.unit === 'u' ? 'u.' : p.unit}` : 'Sin stock'}</span>
                <Plus size={17} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
