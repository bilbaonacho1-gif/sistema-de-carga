/**
 * PANELES COMO EN ADOBE / PHOTOSHOP: el panel se arma con módulos (Pasos, Herramientas, Editando…).
 *  - Cada módulo se achica (queda sólo su barra) tocando su nombre.
 *  - Se arrastra de la barra a cualquier lugar (queda suelto, flotando arriba del plano).
 *  - Arrastrado hacia un costado de la pantalla se marca la zona y, al soltar, queda acoplado en
 *    la columna de la izquierda o de la derecha, en el lugar donde se soltó (arriba o abajo de otro).
 *  - Los sueltos se pegan entre sí y a los bordes cuando se acercan (como en Adobe).
 *  - Los sueltos se agrandan o achican desde la esquina; las columnas, desde su borde.
 * Dónde quedó cada uno se recuerda en el navegador.
 */
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import './dock.css'

export type DockPlace = 'left' | 'right' | 'float'
export interface DockState { place: DockPlace; order: number; collapsed: boolean; x: number; y: number; w: number; h?: number; z: number }
export interface DropHint { side: 'left' | 'right'; index: number }

interface DockStore {
  panels: Record<string, Partial<DockState>>
  top: number
  /** Ancho de las columnas (px). */
  cols: { left: number; right: number }
  /** Mientras se arrastra un módulo hacia un costado: dónde quedaría al soltarlo. */
  hint: DropHint | null
  set(id: string, patch: Partial<DockState>): void
  front(id: string): void
  setHint(h: DropHint | null): void
  setCol(side: 'left' | 'right', w: number): void
  /** Acopla un módulo en una columna, en la posición `index` (entre los que ya están ahí). */
  dockInto(id: string, side: 'left' | 'right', index: number, order: string[]): void
  /** Todos los módulos vuelven a la columna de la izquierda, abiertos y en su orden. */
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
  cols: { left: 350, right: 330 },
  hint: null,
  set: (id, patch) => set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } } })),
  front: (id) => set((s) => ({ top: s.top + 1, panels: { ...s.panels, [id]: { ...s.panels[id], z: s.top + 1 } } })),
  setHint: (hint) => set({ hint }),
  setCol: (side, w) => set((s) => ({ cols: { ...s.cols, [side]: Math.round(Math.max(260, Math.min(560, w))) } })),
  dockInto: (id, side, index, order) => set((s) => {
    // `order`: los módulos que ya están en esa columna, de arriba a abajo (sin el que se acopla)
    const ids = order.filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    const panels = { ...s.panels }
    ids.forEach((x, i) => { panels[x] = { ...panels[x], place: side, order: i } })
    return { panels, hint: null }
  }),
  reset: () => set({ panels: {}, hint: null }),
}), {
  name: 'sdc-paneles', version: 2, storage: safe,
  partialize: (s) => ({ panels: s.panels, top: s.top, cols: s.cols }),
  // v2: "floating" (suelto o no) pasa a "place" (izquierda, derecha o suelto)
  migrate: (persisted) => {
    const p = (persisted ?? {}) as { panels?: Record<string, Partial<DockState> & { floating?: boolean }> }
    const panels: Record<string, Partial<DockState>> = {}
    for (const [k, v] of Object.entries(p.panels ?? {})) { const { floating, ...rest } = v; panels[k] = { ...rest, place: floating ? 'float' : 'left' } }
    return { ...p, panels } as unknown as DockStore
  },
}))

const DEFAULT: DockState = { place: 'left', order: 0, collapsed: false, x: 380, y: 140, w: 340, z: 10 }
export const dockState = (id: string, panels: Record<string, Partial<DockState>>, base?: Partial<DockState>): DockState => ({ ...DEFAULT, ...base, ...panels[id] })
const narrowScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 900px)').matches

/** Los módulos de la columna `side` como están en pantalla, de arriba a abajo. */
function columnIds(side: 'left' | 'right', except?: string): { id: string; mid: number }[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-dock-col="${side}"] [data-dock-id]`)]
    .filter((el) => el.dataset.dockId !== except)
    .map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.dockId!, mid: r.top + r.height / 2 } })
}

/** Si el puntero está cerca de un costado, dónde se acoplaría el módulo. */
function edgeHint(x: number, y: number, self: string): DropHint | null {
  const stage = document.querySelector('.depot .plan-stage, .depot .designer__view')?.getBoundingClientRect()
  const left = stage?.left ?? 0, right = stage?.right ?? window.innerWidth
  const side = x < left + 70 ? 'left' : x > right - 70 ? 'right' : null
  if (!side) return null
  return { side, index: columnIds(side, self).filter((c) => c.mid < y).length }
}

/** Pega el módulo suelto a los bordes de la ventana y de los otros sueltos cuando están cerca. */
function magnet(id: string, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const T = 14
  const xs = [0, window.innerWidth - w], ys = [0, window.innerHeight - h]
  for (const el of document.querySelectorAll<HTMLElement>('.dock--float[data-dock-id]')) {
    if (el.dataset.dockId === id) continue
    const r = el.getBoundingClientRect()
    xs.push(r.right, r.left - w, r.left, r.right - w)
    ys.push(r.bottom, r.top - h, r.top, r.bottom - h)
  }
  const pick = (v: number, cands: number[]) => cands.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), Infinity)
  const sx = pick(x, xs), sy = pick(y, ys)
  return { x: Math.abs(sx - x) < T ? sx : x, y: Math.abs(sy - y) < T ? sy : y }
}

/** Un módulo: barra con su nombre (tocar: achicar / abrir; arrastrar: mover) y el contenido. */
export function DockPanel({ id, title, children, icon, defaultCollapsed = false }: { id: string; title: string; children: ReactNode; icon?: ReactNode; defaultCollapsed?: boolean }) {
  // se lee el dato guardado tal cual (referencia estable) y se completa afuera del selector
  const raw = useDock((s) => s.panels[id])
  const saved: DockState = { ...DEFAULT, collapsed: defaultCollapsed, ...raw }
  // en pantallas angostas (celular) los módulos van siempre en columna
  const st = narrowScreen() ? { ...saved, place: 'left' as const } : saved
  const ref = useRef<HTMLElement>(null)
  /** Si la barra se arrastró, el clic que sigue no achica el módulo. */
  const dragged = useRef(false)
  const floating = st.place === 'float'

  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || narrowScreen() || (e.target as HTMLElement).closest('.dock__btn')) return
    const { set, front, setHint, dockInto } = useDock.getState()
    const rect = ref.current!.getBoundingClientRect()
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top
    const ox = e.clientX, oy = e.clientY
    dragged.current = false
    if (floating) front(id)
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.hypot(ev.clientX - ox, ev.clientY - oy) < 6) return
      if (!dragged.current) { dragged.current = true; front(id); document.body.classList.add('dock-dragging') }
      // al empezar a arrastrar uno acoplado, sale de la columna y queda suelto bajo el puntero
      const w = Math.round(rect.width), h = Math.round(Math.min(rect.height, window.innerHeight * 0.8))
      const p = magnet(id, ev.clientX - offX, ev.clientY - offY, w, h)
      set(id, { place: 'float', x: Math.round(Math.max(0, Math.min(window.innerWidth - 140, p.x))), y: Math.round(Math.max(0, Math.min(window.innerHeight - 40, p.y))), w })
      setHint(edgeHint(ev.clientX, ev.clientY, id))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dock-dragging')
      const hint = useDock.getState().hint
      if (dragged.current && hint) dockInto(id, hint.side, hint.index, columnIds(hint.side, id).map((c) => c.id))
      else setHint(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Esquina de abajo a la derecha de un suelto: cambia ancho y alto. */
  const onResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    const { set } = useDock.getState()
    const rect = ref.current!.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY
    const move = (ev: PointerEvent) => set(id, {
      w: Math.round(Math.max(240, Math.min(640, rect.width + ev.clientX - sx))),
      h: Math.round(Math.max(90, Math.min(window.innerHeight - rect.top - 8, rect.height + ev.clientY - sy))),
    })
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const { set, dockInto } = useDock.getState()
  const toSide = (side: 'left' | 'right') => dockInto(id, side, 999, columnIds(side, id).map((c) => c.id))
  const box = (
    <section ref={ref} data-dock-id={id} className={`dock${floating ? ' dock--float' : ''}${st.collapsed ? ' is-collapsed' : ''}`} aria-label={title}
      style={floating ? { left: st.x, top: st.y, width: st.w, zIndex: 60 + st.z, maxHeight: st.h ?? `calc(100dvh - ${st.y}px - 12px)`, height: st.h && !st.collapsed ? st.h : undefined } : undefined}
      onPointerDown={floating ? () => useDock.getState().front(id) : undefined}>
      <div className="dock__bar" onPointerDown={onBarDown} title="Arrastrá la barra para moverlo o llevarlo a un costado">
        <button type="button" className="dock__toggle" onClick={() => { if (dragged.current) { dragged.current = false; return } set(id, { collapsed: !st.collapsed }) }} aria-expanded={!st.collapsed}
          title={st.collapsed ? 'Abrir' : 'Achicar'}>
          {st.collapsed ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          {icon}<span>{title}</span>
        </button>
        {floating ? <>
          <button type="button" className="dock__btn" onClick={() => toSide('left')} title="Fijar en la columna de la izquierda" aria-label="Fijar a la izquierda"><PanelLeftOpen size={15} aria-hidden /></button>
          <button type="button" className="dock__btn" onClick={() => toSide('right')} title="Fijar en la columna de la derecha" aria-label="Fijar a la derecha"><PanelRightOpen size={15} aria-hidden /></button>
        </> : <>
          <button type="button" className="dock__btn" onClick={() => toSide(st.place === 'left' ? 'right' : 'left')}
            title={st.place === 'left' ? 'Pasarlo a la columna de la derecha' : 'Pasarlo a la columna de la izquierda'} aria-label="Pasarlo al otro costado">
            {st.place === 'left' ? <PanelRightOpen size={15} aria-hidden /> : <PanelLeftOpen size={15} aria-hidden />}
          </button>
          <button type="button" className="dock__btn" onClick={() => {
            const r = ref.current?.getBoundingClientRect()
            set(id, { place: 'float', collapsed: false, x: Math.round((r?.left ?? 380) + 24), y: Math.round(Math.max(70, (r?.top ?? 140) + 24)), w: Math.round(r?.width ?? 340) })
            useDock.getState().front(id)
          }} title="Sacarlo y dejarlo suelto" aria-label="Sacar este módulo"><PanelLeftClose size={15} aria-hidden /></button>
        </>}
      </div>
      {!st.collapsed && <div className="dock__body">{children}</div>}
      {floating && !st.collapsed && <div className="dock__resize" onPointerDown={onResize} title="Arrastrá para cambiar el tamaño" aria-hidden />}
    </section>
  )
  // suelto va al cuerpo de la página (así no lo recorta la columna)
  return floating ? createPortal(box, document.body) : box
}

/** En qué columna (o suelto) va cada módulo, en orden. `defaults`: dónde arranca cada uno. */
export function useDockLayout(ids: string[]): { left: string[]; right: string[]; float: string[] } {
  const panels = useDock((s) => s.panels)
  const narrow = narrowScreen()
  const all = ids.map((id, i) => ({ id, i, st: dockState(id, panels, { order: i }) }))
  const col = (side: DockPlace) => all.filter((a) => (narrow ? side === 'left' : a.st.place === side))
    .sort((a, b) => a.st.order - b.st.order || a.i - b.i).map((a) => a.id)
  return { left: col('left'), right: col('right'), float: narrow ? [] : col('float') }
}

/** Borde de una columna para cambiarle el ancho. */
export function ColumnResizer({ side }: { side: 'left' | 'right' }) {
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = e.clientX, w0 = useDock.getState().cols[side]
    const move = (ev: PointerEvent) => useDock.getState().setCol(side, w0 + (side === 'left' ? ev.clientX - start : start - ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('dock-dragging') }
    document.body.classList.add('dock-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className={`dock-resizer dock-resizer--${side}`} onPointerDown={onDown} title="Arrastrá para cambiar el ancho de la columna" aria-hidden />
}

/** Mientras se arrastra un módulo hacia un costado: la zona donde va a quedar acoplado. */
export function DropZones() {
  const hint = useDock((s) => s.hint)
  if (!hint) return null
  return (
    <div className={`dock-drop dock-drop--${hint.side}`} aria-hidden>
      <span>Soltá para fijarlo a la {hint.side === 'left' ? 'izquierda' : 'derecha'}</span>
    </div>
  )
}
