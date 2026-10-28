/** Estado del cotizador 3D (se recuerda en este navegador). */
import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { calculateRackStructure } from '../../../shared/rack/calculateRackStructure'
import { DEFAULT_ACCESSORIES, DEFAULT_CONFIGURATION } from '../../../shared/rack/technicalSpecs'
import type { AccessoryConfig, RackConfiguration, RackSection, RackStructure, WarehouseLayout } from '../../../shared/rack/types'
import type { CameraPreset, CameraView } from '../../three/types'

const safeStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}

export const STEPS = ['producto', 'medidas', 'carga', 'estructura', 'accesorios', 'resumen'] as const
export type StepId = (typeof STEPS)[number]

interface DesignerState {
  config: RackConfiguration
  productId: string
  /** 'guiado' = un paso por vez con ayuda; 'todo' = todas las opciones juntas. */
  mode: 'guiado' | 'todo'
  step: StepId
  showDimensions: boolean
  view: CameraView
  viewRequest: number
  update(patch: Partial<RackConfiguration>): void
  updateLayout(patch: Partial<WarehouseLayout>): void
  updateAccessories(patch: Partial<AccessoryConfig>): void
  /** Pasa a tramos (partiendo del rack actual) o vuelve a un rack uniforme. */
  setSections(sections: RackSection[]): void
  updateSection(index: number, patch: Partial<RackSection>): void
  addSection(): void
  duplicateSection(index: number): void
  removeSection(index: number): void
  /** Abre una configuración guardada (por ejemplo, la de un pedido de presupuesto). */
  load(config: RackConfiguration): void
  reset(): void
  setProduct(id: string): void
  setMode(mode: 'guiado' | 'todo'): void
  goTo(step: StepId): void
  setView(v: CameraPreset): void
  releaseView(): void
  toggleDimensions(): void
}

const withSections = (c: RackConfiguration, fn: (s: RackSection[]) => RackSection[]): RackConfiguration =>
  ({ ...c, sections: fn([...(c.sections ?? [])]) })

export const useDesigner = create<DesignerState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIGURATION,
      productId: 'selectivo',
      mode: 'guiado',
      step: 'producto',
      showDimensions: true,
      view: 'iso',
      viewRequest: 0,
      update: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      updateLayout: (patch) => set((s) => ({ config: { ...s.config, layout: { ...s.config.layout, ...patch } } })),
      updateAccessories: (patch) => set((s) => ({ config: { ...s.config, accessories: { ...DEFAULT_ACCESSORIES, ...s.config.accessories, ...patch } } })),
      setSections: (sections) => set((s) => ({ config: { ...s.config, sections } })),
      updateSection: (i, patch) => set((s) => ({ config: withSections(s.config, (list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x))) })),
      addSection: () => set((s) => ({
        config: withSections(s.config, (list) => {
          const last = list[list.length - 1] ?? { modules: 1, width: s.config.width, height: s.config.height, levels: s.config.levels }
          return [...list, { ...last, modules: 1 }]
        }),
      })),
      duplicateSection: (i) => set((s) => ({ config: withSections(s.config, (list) => [...list.slice(0, i + 1), { ...list[i] }, ...list.slice(i + 1)]) })),
      removeSection: (i) => set((s) => ({ config: withSections(s.config, (list) => list.filter((_, j) => j !== i)) })),
      load: (config) => set((s) => ({ config: { ...DEFAULT_CONFIGURATION, ...config }, productId: 'selectivo', step: 'medidas', view: 'iso', viewRequest: s.viewRequest + 1 })),
      reset: () => set((s) => ({ config: DEFAULT_CONFIGURATION, step: 'producto', view: 'iso', viewRequest: s.viewRequest + 1 })),
      setProduct: (productId) => set({ productId }),
      setMode: (mode) => set({ mode }),
      goTo: (step) => set({ step }),
      setView: (view) => set((s) => ({ view, viewRequest: s.viewRequest + 1 })),
      releaseView: () => set((s) => (s.view === 'free' ? s : { view: 'free' })),
      toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
    }),
    {
      name: 'sdc-designer',
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ config: s.config, showDimensions: s.showDimensions, mode: s.mode, step: s.step, productId: s.productId }),
      // versiones anteriores no tenían tramos, accesorios ni pallet a medida
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { config?: Partial<RackConfiguration> }
        return { ...p, config: { ...DEFAULT_CONFIGURATION, ...p.config } } as never
      },
    },
  ),
)

export function useDesignedStructure(): RackStructure {
  const config = useDesigner((s) => s.config)
  return useMemo(() => calculateRackStructure(config), [config])
}
