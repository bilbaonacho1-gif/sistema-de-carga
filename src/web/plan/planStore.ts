/** Estado del editor del plano: el plano, la herramienta, la selección y el historial. */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { rectanglePlan } from '../../shared/plan/geometry'
import { DEFAULT_LAYOUT, type LayoutOptions } from '../../shared/plan/layout'
import type { Plan, PlanPoint, PlanSelection } from '../../shared/plan/types'

const safeStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}

export type PlanTool = 'select' | 'outline' | 'column' | 'wall' | 'door' | 'zone'

/** Pasos del cotizador de depósitos: primero el lugar, después el rack y su distribución. */
export const FLOW = ['deposito', 'rack', 'carga', 'distribucion', 'accesorios', 'resumen'] as const
export type FlowStep = (typeof FLOW)[number]

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
  /** Cotas del plano (como en AutoCAD) a la vista. */
  showCotas: boolean
  view3d: boolean
  /** Qué se está editando en el cotizador: el rack o el plano del depósito. */
  workspace: 'rack' | 'deposito'
  /** Paso actual del cotizador de depósitos. */
  flowStep: FlowStep
  /** Opciones de la distribución automática (pasillos, orientación…). */
  layout: LayoutOptions
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
  setShowCotas(v: boolean): void
  setView3d(v: boolean): void
  setWorkspace(w: 'rack' | 'deposito'): void
  setFlowStep(s: FlowStep): void
  setLayout(patch: Partial<LayoutOptions>): void
  /** Vuelve a empezar: depósito inicial, primer paso y opciones de fábrica. */
  resetAll(): void
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
      showCotas: true,
      view3d: false,
      workspace: 'rack',
      flowStep: 'deposito',
      layout: DEFAULT_LAYOUT,
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
      setShowCotas: (showCotas) => set({ showCotas }),
      setView3d: (view3d) => set({ view3d }),
      setWorkspace: (workspace) => set({ workspace }),
      setFlowStep: (flowStep) => set({ flowStep }),
      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
      resetAll: () => set({ plan: DEFAULT_PLAN, past: [], future: [], selection: null, draft: [], tool: 'select', flowStep: 'deposito', layout: DEFAULT_LAYOUT, view3d: false }),
    }),
    {
      name: 'sdc-plan',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ plan: s.plan, snap: s.snap, showCotas: s.showCotas, workspace: s.workspace, view3d: s.view3d, flowStep: s.flowStep, layout: s.layout }),
      // estados guardados antes de la distribución no tienen estas opciones
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlanState>
        return { ...current, ...p, layout: { ...DEFAULT_LAYOUT, ...p.layout } }
      },
    },
  ),
)
