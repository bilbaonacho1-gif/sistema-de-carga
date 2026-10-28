/** Componentes básicos de la interfaz. Los estilos están en styles/app.css. */
import { Loader2, Search, X, type LucideIcon } from 'lucide-react'
import {
  forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link } from 'react-router'
import { STATUS_META } from '../../shared/orders'
import { STOCK_META } from '../../shared/stock'
import type { OrderStatus, StockStatus } from '../../shared/types'
import { initials } from '../lib/format'

/* ------------------------------ Botones ------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, block, children, className, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={16} aria-hidden /> : Icon && <Icon size={size === 'sm' ? 15 : 17} aria-hidden />}
      {children && <span>{children}</span>}
    </button>
  )
})

export function LinkButton({ to, variant = 'secondary', size = 'md', icon: Icon, children, block }: {
  to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; children: ReactNode; block?: boolean
}) {
  return (
    <Link to={to} className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}`}>
      {Icon && <Icon size={size === 'sm' ? 15 : 17} aria-hidden />}
      <span>{children}</span>
    </Link>
  )
}

export function IconButton({ icon: Icon, label, badge, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; badge?: number }) {
  return (
    <button type="button" className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label} {...rest}>
      <Icon size={20} aria-hidden />
      {!!badge && <span className="icon-btn__badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

/* ------------------------------ Estados ------------------------------ */

export function StatusPill({ status, size = 'md' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status]
  return (
    <span className={`pill pill--${size}`} style={{ color: m.color, background: m.bg }}>
      <span className="pill__dot" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  )
}

export function StockBadge({ status }: { status: StockStatus }) {
  const m = STOCK_META[status]
  return (
    <span className="pill pill--sm" style={{ color: m.color, background: m.bg }}>
      <span className="pill__dot" style={{ background: m.dot }} aria-hidden />
      {m.label}
    </span>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'red' | 'amber' | 'blue' | 'green' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

/** Las tres fases del sistema, siempre con el mismo color. */
export const PHASES = {
  1: { label: 'Pedidos', className: 'phase-1' },
  2: { label: 'Almacén', className: 'phase-2' },
  3: { label: 'Control', className: 'phase-3' },
} as const

export function PhaseTag({ phase }: { phase: 1 | 2 | 3 }) {
  return (
    <span className={`phase-tag ${PHASES[phase].className}`}>
      <b>{phase}</b> {PHASES[phase].label}
    </span>
  )
}

/* ------------------------------ Estructura ------------------------------ */

export function PageHeader({ title, phase, subtitle, actions, back }: {
  title: ReactNode; phase?: 1 | 2 | 3; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {back && <Link to={back.to} className="page-header__back">← {back.label}</Link>}
        {phase && <PhaseTag phase={phase} />}
        <h1>{title}</h1>
        {subtitle && <p className="page-header__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, actions, children, className, padded = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card__body' : undefined}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'red' | 'amber' | 'blue' | 'green'; to?: string }) {
  const body = (
    <>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </>
  )
  return to
    ? <Link to={to} className={`stat stat--link${tone ? ` stat--${tone}` : ''}`}>{body}</Link>
    : <div className={`stat${tone ? ` stat--${tone}` : ''}`}>{body}</div>
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={30} aria-hidden />
      <p className="empty__title">{title}</p>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  )
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={22} aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="error-note" role="alert">{error instanceof Error ? error.message : 'Ocurrió un error.'}</p>
}

/** Envuelve el estado de una consulta: cargando, error o contenido. */
export function Loadable<T>({ query, children }: { query: { data?: T; isLoading: boolean; error: unknown }; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <Spinner />
  if (query.error) return <ErrorNote error={query.error} />
  if (query.data === undefined) return null
  return <>{children(query.data)}</>
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  // color estable por persona, dentro de la paleta
  const hues = ['#be1e30', '#2e6a8e', '#9a6400', '#0f766e', '#6d4fb3', '#353535']
  const h = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % hues.length
  return (
    <span className="avatar" style={{ width: size, height: size, background: hues[h], fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  )
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} className="kv__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Progress({ value, max, tone = 'red' }: { value: number; max: number; tone?: 'red' | 'green' | 'blue' }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`progress progress--${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ------------------------------ Formularios ------------------------------ */

export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; optional?: boolean }) {
  const id = useId()
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={id}>{label}{optional && <em> · opcional</em>}</label>
      {children(id)}
      {error ? <span className="field__error">{error}</span> : hint && <span className="field__hint">{hint}</span>}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} className="input" {...props} />
})

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select">
      <select {...props}>{children}</select>
    </div>
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" rows={3} {...props} />
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…', autoFocus }: { value: string; onChange(v: string): void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Search size={17} aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Borrar búsqueda"><X size={16} /></button>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: NoInfer<T>; label: ReactNode; count?: number }[]; onChange(v: NoInfer<T>): void; label: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`segmented__item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="segmented__count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
