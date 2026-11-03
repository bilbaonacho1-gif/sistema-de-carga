/** Estado del editor del plano: el plano, la herramienta, la selección y el historial. */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { rectanglePlan } from '../../shared/plan/geometry'
import { packPlan, unpackPlan, type PackedPlan } from '../../shared/plan/racks'
import type { Plan, PlanPoint, PlanSelection } from '../../shared/plan/types'

/**
 * Guardado en el navegador. Mientras se arrastra algo el plano cambia en cada movimiento: se guarda
 * recién cuando se deja de mover (300 ms), así un depósito grande no traba el arrastre.
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const safeStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => {
    clearTimeout(pending.get(k))
    pending.set(k, setTimeout(() => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } }, 300))
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}

export type PlanTool = 'select' | 'rack' | 'outline' | 'column' | 'wall' | 'door' | 'zone'

export const DEFAULT_PLAN = rectanglePlan(32_000, 22_000)
const HISTORY = 80

interface PlanState {
  plan: Plan
  past: Plan[]
  future: Plan[]
  tool: PlanTool
  selection: PlanSelection
  /** Puntos del contorno o de la pared que se está dibujando. */
  draft: PlanPoint[]
  snap: boolean
  view3d: boolean
  /** Qué se está editando en el cotizador: el rack o el plano del depósito. */
  workspace: 'rack' | 'deposito'
  /** Rack del depósito que se está editando en la pestaña Rack (null = el rack suelto del cotizador). */
  editingRackId: string | null
  /** Cambio con historial (deshacer vuelve a como estaba antes). */
  commit(fn: (p: Plan) => Plan): void
  /** Guarda una copia antes de empezar a arrastrar… */
  begin(): void
  /** …y los cambios del arrastre no suman pasos al historial. */
  live(fn: (p: Plan) => Plan): void
  undo(): void
  redo(): void
  setTool(t: PlanTool): void
  select(s: PlanSelection): void
  setDraft(d: PlanPoint[]): void
  setSnap(v: boolean): void
  setView3d(v: boolean): void
  setWorkspace(w: 'rack' | 'deposito'): void
  setEditingRack(id: string | null): void
}

export const usePlan = create<PlanState>()(
  persist(
    (set) => ({
      plan: DEFAULT_PLAN,
      past: [],
      future: [],
      tool: 'select',
      selection: null,
      draft: [],
      snap: true,
      view3d: false,
      workspace: 'rack',
      editingRackId: null,
      commit: (fn) => set((s) => ({ plan: fn(s.plan), past: [...s.past, s.plan].slice(-HISTORY), future: [] })),
      begin: () => set((s) => ({ past: [...s.past, s.plan].slice(-HISTORY), future: [] })),
      live: (fn) => set((s) => ({ plan: fn(s.plan) })),
      undo: () => set((s) => {
        const prev = s.past[s.past.length - 1]
        return prev ? { plan: prev, past: s.past.slice(0, -1), future: [s.plan, ...s.future], selection: null } : s
      }),
      redo: () => set((s) => {
        const next = s.future[0]
        return next ? { plan: next, future: s.future.slice(1), past: [...s.past, s.plan], selection: null } : s
      }),
      setTool: (tool) => set({ tool, draft: [], selection: null }),
      select: (selection) => set({ selection }),
      setDraft: (draft) => set({ draft }),
      setSnap: (snap) => set({ snap }),
      setView3d: (view3d) => set({ view3d }),
      setWorkspace: (workspace) => set({ workspace }),
      setEditingRack: (editingRackId) => set({ editingRackId }),
    }),
    {
      name: 'sdc-plan',
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      // los racks con la misma configuración se guardan una sola vez (depósitos con miles de racks)
      partialize: (s) => ({ plan: packPlan(s.plan) as unknown as Plan, snap: s.snap, workspace: s.workspace, view3d: s.view3d }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlanState>
        return { ...current, ...p, plan: p.plan ? unpackPlan(p.plan as unknown as PackedPlan) : current.plan }
      },
      migrate: (persisted) => persisted as never,
    },
  ),
)
