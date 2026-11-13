/** Estado del editor del plano: el plano, la herramienta, la selección y el historial. */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { emptyPlan } from '../../shared/plan/edit'
import { DEFAULT_LAYOUT, type LayoutOptions } from '../../shared/plan/layout'
import type { ObjectShape, Plan, PlanPoint, PlanSelection, SymbolKind, RackPlacement } from '../../shared/plan/types'

/** Una pieza de un rack: los largueros de un nivel (plane = número de viga, de abajo hacia arriba) o los parantes. */
/** Persona parada en el depósito: posición en el plano (mm), hacia dónde mira y cuánto levanta la vista. */
export interface Walk { x: number; y: number; yaw: number; pitch: number }

export type RackPiece = { rack: string; kind: 'beam'; module: number; plane: number } | { rack: string; kind: 'upright'; frame: number }

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

export type PlanTool = 'select' | 'outline' | 'column' | 'wall' | 'door' | 'zone' | 'area' | 'aisle' | 'measure' | 'dim' | 'text' | 'symbol' | 'calibrate' | 'rackdraw' | 'rackpaste' | 'object'

/** Capas del plano que se pueden apagar (como en AutoCAD). */
export type PlanLayer = 'grilla' | 'calco' | 'zonas' | 'areas' | 'pasillos' | 'racks' | 'numeros' | 'columnas' | 'tabiques' | 'portones' | 'textos' | 'simbolos' | 'cotasPropias'

/** Pasos del cotizador de depósitos: primero el lugar, después el rack y su distribución. */
export const FLOW = ['deposito', 'rack', 'carga', 'distribucion', 'resumen'] as const
export type FlowStep = (typeof FLOW)[number]

/** El plano arranca vacío: el depósito se crea escribiendo sus medidas o dibujándolo. */
export const DEFAULT_PLAN = emptyPlan()

/** ¿Es el depósito de ejemplo con el que arrancaba antes (32 × 22 m, sin nada)? */
function isOldSample(p?: Plan): boolean {
  if (!p) return false
  const pts = p.outline?.points ?? []
  const sample = [[0, 0], [32_000, 0], [32_000, 22_000], [0, 22_000]]
  return pts.length === 4 && pts.every((q, i) => q.x === sample[i][0] && q.y === sample[i][1])
    && !p.columns?.length && !p.walls?.length && !p.doors?.length && !p.zones?.length && !p.racks && !p.rackAreas?.length && !p.aisles?.length
}
const HISTORY = 80

/**
 * Si cambian las zonas libres, las zonas de racks o los pasillos, los racks vuelven a ubicarse solos
 * (también si estaban movidos a mano): así nunca quedan racks en una zona libre o fuera de la zona
 * de racks. Ctrl+Z vuelve a como estaba.
 */
function withMarks(_prev: Plan, next: Plan): Plan {
  // Los racks armados a mano (módulo por módulo) ya no se pisan con el llenado automático al marcar
  // una zona o un pasillo: quedan donde están y, si alguno molesta, se avisa en la revisión.
  return next
}

interface PlanState {
  plan: Plan
  past: Plan[]
  future: Plan[]
  tool: PlanTool
  selection: PlanSelection
  /** Puntos del contorno o de la pared que se está dibujando. */
  draft: PlanPoint[]
  snap: boolean
  /** Cada cuánto se acomoda lo que se dibuja o se arrastra (mm): 1 m por defecto. */
  snapStep: number
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
  setSnapStep(v: number): void
  /** Imán a objetos: el clic se pega a esquinas, puntas, medios y centros. */
  osnap: boolean
  setOsnap(v: boolean): void
  /** Capas apagadas. */
  hidden: Partial<Record<PlanLayer, boolean>>
  toggleLayer(l: PlanLayer): void
  /** Entre varios racks elegidos, el que se está editando (se marca en el plano). */
  focusRack: string | null
  setFocusRack(id: string | null): void
  /** "Ver solo este": racks que se miran aislados (los demás quedan apagados). */
  isolate: string[] | null
  setIsolate(ids: string[] | null): void
  /**
   * Vista "a pie" en el 3D (como el muñequito de un mapa): dónde está parada la persona (mm del
   * plano) y hacia dónde mira (radianes). null = vista normal desde arriba.
   */
  walk: Walk | null
  setWalk(w: Walk | null): void
  /** Camina `move` mm hacia donde mira y gira `turn` radianes. */
  walkBy(move: number, turn: number): void
  /** En el 3D, edición bloqueada: se puede girar y elegir, pero nada se mueve arrastrando (así no se corre algo sin querer). */
  lock3d: boolean
  setLock3d(v: boolean): void
  /** Objeto propio que se está poniendo en el depósito (se pone uno con cada clic). */
  placeObject: (ObjectShape & { id?: string }) | null
  setPlaceObject(o: (ObjectShape & { id?: string }) | null): void
  /** Racks copiados (Ctrl+C o "Copiar"), listos para pegar donde se toque el plano. */
  clipRacks: RackPlacement[] | null
  setClipRacks(r: RackPlacement[] | null): void
  /** Sección a la vista: el depósito (plano y racks) o el taller de piezas propias. */
  section: 'deposito' | 'piezas'
  setSection(s: 'deposito' | 'piezas'): void
  /** Pieza de metal tocada en el 3D (de un rack visto solo): una viga (plano de carga) o los parantes. */
  piece: RackPiece | null
  setPiece(p: RackPiece | null): void
  /** Símbolo que pone la herramienta Símbolos. */
  symbolKind: SymbolKind
  /** Dibujar fila de racks: simple o doble (espalda con espalda). */
  rackDrawPair: boolean
  setRackDrawPair(v: boolean): void
  setSymbolKind(k: SymbolKind): void
  /** Modo "elegir varios": tocar un rack lo suma a la selección (como Shift + clic). */
  multi: boolean
  setMulti(v: boolean): void
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
      snapStep: 1000,
      showCotas: true,
      view3d: false,
      workspace: 'rack',
      flowStep: 'deposito',
      layout: DEFAULT_LAYOUT,
      commit: (fn) => set((s) => ({ plan: withMarks(s.plan, fn(s.plan)), past: [...s.past, s.plan].slice(-HISTORY), future: [] })),
      begin: () => set((s) => ({ past: [...s.past, s.plan].slice(-HISTORY), future: [] })),
      live: (fn) => set((s) => ({ plan: withMarks(s.plan, fn(s.plan)) })),
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
      setSnapStep: (snapStep) => set({ snapStep }),
      osnap: true,
      setOsnap: (osnap) => set({ osnap }),
      hidden: {},
      toggleLayer: (l) => set((s) => ({ hidden: { ...s.hidden, [l]: !s.hidden[l] } })),
      focusRack: null,
      setFocusRack: (focusRack) => set({ focusRack }),
      isolate: null,
      setIsolate: (isolate) => set((s) => ({ isolate, piece: isolate ? s.piece : null })),
      piece: null,
      setPiece: (piece) => set({ piece }),
      section: 'deposito',
      setSection: (section) => set({ section }),
      lock3d: true,
      setLock3d: (lock3d) => set({ lock3d }),
      placeObject: null,
      setPlaceObject: (placeObject) => set({ placeObject, tool: placeObject ? 'object' : 'select', draft: [] }),
      clipRacks: null,
      setClipRacks: (clipRacks) => set({ clipRacks }),
      walk: null,
      setWalk: (walk) => set({ walk }),
      walkBy: (move, turn) => set((s) => {
        if (!s.walk) return s
        const yaw = s.walk.yaw + turn
        return { walk: { ...s.walk, yaw, x: Math.round(s.walk.x - Math.sin(yaw) * move), y: Math.round(s.walk.y - Math.cos(yaw) * move) } }
      }),
      symbolKind: 'matafuego',
      rackDrawPair: true,
      setRackDrawPair: (rackDrawPair) => set({ rackDrawPair }),
      setSymbolKind: (symbolKind) => set({ symbolKind, tool: 'symbol', draft: [] }),
      multi: false,
      setMulti: (multi) => set({ multi }),
      setShowCotas: (showCotas) => set({ showCotas }),
      setView3d: (view3d) => set({ view3d }),
      setWorkspace: (workspace) => set({ workspace }),
      setFlowStep: (flowStep) => set({ flowStep }),
      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
      resetAll: () => set({ plan: DEFAULT_PLAN, past: [], future: [], selection: null, draft: [], tool: 'select', flowStep: 'deposito', layout: DEFAULT_LAYOUT, view3d: false }),
    }),
    {
      name: 'sdc-plan',
      version: 3,
      // v2: el plano arranca vacío; si quedó guardado el depósito de ejemplo sin tocar, se vacía
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<PlanState>
        let out = version < 2 && isOldSample(p.plan) ? { ...p, plan: emptyPlan() } : p
        // v3: el pasillo de cabecera pasa a 3 m por defecto (era 1,5 m)
        if (version < 3 && out.layout?.endGap === 1500) out = { ...out, layout: { ...out.layout, endGap: 3000 } }
        return out as PlanState
      },
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ plan: s.plan, lock3d: s.lock3d, snap: s.snap, snapStep: s.snapStep, osnap: s.osnap, hidden: s.hidden, showCotas: s.showCotas, workspace: s.workspace, view3d: s.view3d, flowStep: s.flowStep, layout: s.layout }),
      // estados guardados antes de la distribución no tienen estas opciones
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlanState>
        // el paso "Accesorios" ahora es parte del paso "Rack"
        const flowStep = p.flowStep && (FLOW as readonly string[]).includes(p.flowStep) ? p.flowStep : p.flowStep ? 'rack' : current.flowStep
        return { ...current, ...p, flowStep, layout: { ...DEFAULT_LAYOUT, ...p.layout } }
      },
    },
  ),
)
