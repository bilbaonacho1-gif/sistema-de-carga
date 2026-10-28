/** Estado del editor del plano: el plano, la herramienta, la selección y el historial. */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { rectanglePlan } from '../../shared/plan/geometry'
import type { Plan, PlanPoint, PlanSelection } from '../../shared/plan/types'

const safeStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}

export type PlanTool = 'select' | 'outline' | 'column' | 'wall' | 'door' | 'zone'

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
    }),
    {
      name: 'sdc-plan',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ plan: s.plan, snap: s.snap, workspace: s.workspace, view3d: s.view3d }),
    },
  ),
)
