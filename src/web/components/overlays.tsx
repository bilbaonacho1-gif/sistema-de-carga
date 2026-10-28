/**
 * Diálogos, paneles deslizables y avisos.
 * - Dialog: ventana centrada (confirmaciones, formularios cortos).
 * - Sheet: en el celular sube desde abajo; en la computadora es un panel lateral.
 * Mientras están abiertos, el resto de la app queda inerte (ni foco ni lector de pantalla).
 */
import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Field, Textarea } from './ui'

let openCount = 0
function useModalEffects(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const root = document.getElementById('root')
    const prevFocus = document.activeElement as HTMLElement | null
    openCount++
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    // foco en el primer control (o en el panel)
    requestAnimationFrame(() => {
      const el = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])')
      ;(el ?? panel.current)?.focus()
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      openCount--
      if (openCount === 0) {
        if (root) root.inert = false
        document.body.style.overflow = ''
      }
      prevFocus?.focus?.()
    }
  }, [open])
  return panel
}

export function Dialog({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number
}) {
  const panel = useModalEffects(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="dialog" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={{ maxWidth: width }} tabIndex={-1}>
        <header className="dialog__head">
          <h2>{title}</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Cerrar" data-close><X size={20} /></button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function Sheet({ open, onClose, title, children, footer, eyebrow }: {
  open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; eyebrow?: ReactNode
}) {
  const panel = useModalEffects(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="overlay overlay--sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <span className="sheet__grip" aria-hidden />
        <header className="sheet__head">
          <div>
            {eyebrow && <div className="sheet__eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Cerrar" data-close><X size={20} /></button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

/** Confirmación con texto claro de lo que va a pasar; opcionalmente pide un motivo. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, tone = 'primary', reasonLabel, loading, error }: {
  open: boolean; onClose(): void; onConfirm(reason: string): void; title: string; children: ReactNode
  confirmLabel: string; tone?: 'primary' | 'danger'; reasonLabel?: string; loading?: boolean; error?: string | null
}) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Volver</Button>
          <Button variant={tone} loading={loading} disabled={!!reasonLabel && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-text">{children}</div>
      {reasonLabel && (
        <Field label={reasonLabel}>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}</Field>
      )}
      {error && <p className="error-note" role="alert">{error}</p>}
    </Dialog>
  )
}

/* ------------------------------ Avisos ------------------------------ */

interface Toast { id: number; kind: 'ok' | 'error'; text: string }
const ToastCtx = createContext<{ ok(text: string): void; error(text: string): void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])
  const api = useRef({ ok: (t: string) => push('ok', t), error: (t: string) => push('error', t) })
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      {createPortal(<div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>, document.body)}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast fuera de ToastProvider')
  return ctx
}
