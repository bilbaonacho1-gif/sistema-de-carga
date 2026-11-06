/**
 * PANELES COMO EN PHOTOSHOP: el panel de la izquierda se arma con módulos (Pasos, Herramientas,
 * Editando…). Cada módulo se puede achicar (sólo su barra), sacar de la columna y llevar a cualquier
 * lugar arrastrándolo de la barra, y volver a meterlo. Dónde quedó cada uno se recuerda.
 */
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface DockState { floating: boolean; collapsed: boolean; x: number; y: number; w: number; z: number }

interface DockStore {
  panels: Record<string, Partial<DockState>>
  top: number
  set(id: string, patch: Partial<DockState>): void
  /** Lo trae adelante (el último tocado queda encima de los demás). */
  front(id: string): void
  /** Todos los módulos vuelven a la columna, abiertos. */
  reset(): void
}

const safe = createJSONStorage(() => ({
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}))

export const useDock = create<DockStore>()(persist((set) => ({
  panels: {},
  top: 10,
  set: (id, patch) => set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } } })),
  front: (id) => set((s) => ({ top: s.top + 1, panels: { ...s.panels, [id]: { ...s.panels[id], z: s.top + 1 } } })),
  reset: () => set({ panels: {} }),
}), { name: 'sdc-paneles', storage: safe, partialize: (s) => ({ panels: s.panels, top: s.top }) }))

const DEFAULT: DockState = { floating: false, collapsed: false, x: 380, y: 140, w: 340, z: 10 }
export const dockState = (id: string, panels: Record<string, Partial<DockState>>): DockState => ({ ...DEFAULT, ...panels[id] })

/** Un módulo del panel: barra con su nombre, achicar y sacar / meter; el contenido abajo. */
export function DockPanel({ id, title, children, icon }: { id: string; title: string; children: ReactNode; icon?: ReactNode }) {
  // se lee el dato guardado tal cual (referencia estable) y se completa afuera del selector
  const raw = useDock((s) => s.panels[id])
  const saved: DockState = { ...DEFAULT, ...raw }
  // en pantallas angostas (celular) los módulos van siempre en columna
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches
  const st = narrow ? { ...saved, floating: false } : saved
  const { set, front } = useDock.getState()
  const ref = useRef<HTMLElement>(null)
  /** Si la barra se arrastró, el clic que sigue no achica el módulo. */
  const dragged = useRef(false)

  const detach = () => {
    // sale flotando desde donde estaba, corrido un poco para que se note
    const r = ref.current?.getBoundingClientRect()
    set(id, { floating: true, collapsed: false, x: Math.round((r?.left ?? 380) + 24), y: Math.round(Math.max(70, (r?.top ?? 140) + 24)), w: Math.round(r?.width ?? 340) })
    front(id)
  }

  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // se arrastra desde cualquier parte de la barra (también el nombre); el botón de sacar/meter no
    if (!st.floating || (e.target as HTMLElement).closest('.dock__btn')) return
    front(id)
    const bar = e.currentTarget, panel = ref.current!
    bar.setPointerCapture(e.pointerId)
    const sx = e.clientX - st.x, sy = e.clientY - st.y
    let x = st.x, y = st.y
    const ox = e.clientX, oy = e.clientY
    dragged.current = false
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.hypot(ev.clientX - ox, ev.clientY - oy) < 4) return
      dragged.current = true
      x = Math.max(0, Math.min(window.innerWidth - 140, ev.clientX - sx))
      y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy))
      panel.style.left = `${x}px`; panel.style.top = `${y}px`
    }
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); set(id, { x, y }) }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  }

  const box = (
    <section ref={ref} className={`dock${st.floating ? ' dock--float' : ''}${st.collapsed ? ' is-collapsed' : ''}`} aria-label={title}
      style={st.floating ? { left: st.x, top: st.y, width: st.w, zIndex: 60 + st.z, maxHeight: `calc(100dvh - ${st.y}px - 12px)` } : undefined}
      onPointerDown={st.floating ? () => front(id) : undefined}>
      <div className="dock__bar" onPointerDown={onBarDown} title={st.floating ? 'Arrastrá la barra para mover este módulo' : undefined}>
        <button type="button" className="dock__toggle" onClick={() => { if (dragged.current) { dragged.current = false; return } set(id, { collapsed: !st.collapsed }) }} aria-expanded={!st.collapsed}
          title={st.collapsed ? 'Abrir' : 'Achicar'}>
          {st.collapsed ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          {icon}<span>{title}</span>
        </button>
        <button type="button" className="dock__btn" onClick={st.floating ? () => set(id, { floating: false }) : detach}
          title={st.floating ? 'Volver a la columna' : 'Sacar y llevarlo a donde quieras'} aria-label={st.floating ? 'Volver a la columna' : 'Sacar este módulo'}>
          {st.floating ? <PanelLeftOpen size={15} aria-hidden /> : <PanelLeftClose size={15} aria-hidden />}
        </button>
      </div>
      {!st.collapsed && <div className="dock__body">{children}</div>}
    </section>
  )
  // suelto va al cuerpo de la página (así no lo recorta la columna)
  return st.floating ? createPortal(box, document.body) : box
}

/** ¿Queda algún módulo de esta lista en la columna? (si no, la columna se esconde y el plano ocupa todo). */
export function useAnyDocked(ids: string[]): boolean {
  return useDock((s) => ids.some((id) => !dockState(id, s.panels).floating))
}
