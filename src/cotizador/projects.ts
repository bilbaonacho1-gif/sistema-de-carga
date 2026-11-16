/**
 * PROYECTOS de cada usuario: lo que se está armando (plano, racks, distribución y piezas) se guarda
 * en el servidor con un nombre, para dejarlo, empezar otro y después seguir con el mismo. Con un
 * proyecto abierto, los cambios se guardan solos a los pocos segundos.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_LAYOUT } from '../shared/plan/layout'
import type { Plan } from '../shared/plan/types'
import { mergeProfiles } from '../shared/rack/profiles'
import { DEFAULT_CONFIGURATION } from '../shared/rack/technicalSpecs'
import type { RackConfiguration } from '../shared/rack/types'
import { useDesigner } from '../web/pages/designer/designerStore'
import { usePlan } from '../web/plan/planStore'
import { canEdit, CloudError, getProject, openShared, saveProject, useAuth } from './cloud'

interface Snapshot { v: 1; plan: Plan; layout: typeof DEFAULT_LAYOUT; config: RackConfiguration }

interface ProjectState {
  /** El proyecto propio que está abierto (lo que se cambia se guarda en él). */
  current: { id: string; name: string } | null
  /** Se está viendo una copia de un proyecto que compartió otro. */
  shared: { name: string; owner: string } | null
  status: 'saved' | 'dirty' | 'saving' | 'error'
  error: string | null
}
const safe = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}
export const useProject = create<ProjectState>()(persist(() => ({ current: null, shared: null, status: 'saved', error: null } as ProjectState),
  { name: 'sdc-proyecto', storage: createJSONStorage(() => safe), partialize: (s) => ({ current: s.current, shared: s.shared }) }))

/** Lo que se está armando ahora, listo para guardar. */
export function snapshot(): Snapshot {
  const p = usePlan.getState()
  return { v: 1, plan: p.plan, layout: p.layout, config: useDesigner.getState().config }
}
/** ¿Hay algo armado en pantalla? (un depósito dibujado) */
export const hasWork = () => usePlan.getState().plan.outline.points.length >= 3

// lo último que se guardó (o se abrió), para no guardar de más; y un freno mientras se carga un proyecto
let lastSaved = ''
let loading = false
let timer: ReturnType<typeof setTimeout> | undefined

/** Pone en pantalla un proyecto guardado. Devuelve false si los datos no sirven. */
function apply(data: unknown): boolean {
  const d = data as Partial<Snapshot> | null
  if (!d || typeof d !== 'object' || !d.plan || !Array.isArray(d.plan.outline?.points)) return false
  loading = true
  try {
    const base: Partial<Plan> = { wallHeight: 8000, wallThickness: 200, columns: [], walls: [], doors: [], zones: [] }
    const plan = { ...base, ...d.plan } as Plan
    const mine = useDesigner.getState().config.customProfiles
    // las piezas propias de este navegador no se pierden: se suman a las que trae el proyecto
    const pieces = d.config?.customProfiles ? mergeProfiles(mine, { uprights: d.config.customProfiles.uprights ?? [], beams: d.config.customProfiles.beams ?? [], objects: d.config.customProfiles.objects }).profiles : mine
    useDesigner.setState({ config: { ...DEFAULT_CONFIGURATION, ...d.config, customProfiles: pieces } })
    const st = usePlan.getState()
    usePlan.setState({
      plan, layout: { ...DEFAULT_LAYOUT, ...d.layout }, past: [], future: [], selection: null, draft: [], tool: 'select',
      isolate: null, walk: null, piece: null, section: 'deposito', flowStep: plan.outline.points.length >= 3 ? 'distribucion' : 'deposito',
    })
    st.requestFit()
  } finally { loading = false }
  lastSaved = JSON.stringify(snapshot())
  return true
}

const fail = (e: unknown) => (e instanceof CloudError ? e.message : 'No se pudo guardar.')

/** Guarda ya el proyecto abierto (si cambió algo). */
export async function saveNow(): Promise<boolean> {
  clearTimeout(timer)
  const { current } = useProject.getState()
  if (!current || !canEdit(useAuth.getState().user)) return false
  const snap = snapshot(), text = JSON.stringify(snap)
  if (text === lastSaved) { useProject.setState({ status: 'saved', error: null }); return true }
  useProject.setState({ status: 'saving', error: null })
  try {
    await saveProject(current.id, '', snap)
    lastSaved = text
    // si mientras se guardaba hubo más cambios, queda pendiente otra guardada
    useProject.setState({ status: JSON.stringify(snapshot()) === lastSaved ? 'saved' : 'dirty' })
    return true
  } catch (e) {
    useProject.setState({ status: 'error', error: fail(e) })
    return false
  }
}

/** Guarda lo que hay en pantalla como un proyecto nuevo y lo deja abierto. */
export async function saveAsNew(name: string): Promise<void> {
  const snap = snapshot()
  const r = await saveProject(null, name, snap)
  lastSaved = JSON.stringify(snap)
  useProject.setState({ current: { id: r.id, name: name.trim() }, shared: null, status: 'saved', error: null })
}

/** Deja todo en blanco (plano y rack) sin tocar ningún proyecto guardado. */
export function clearWork() {
  loading = true
  try { useDesigner.getState().reset(); usePlan.getState().resetAll() } finally { loading = false }
  lastSaved = ''
  useProject.setState({ current: null, shared: null, status: 'saved', error: null })
}

/** Empieza un proyecto vacío con ese nombre. */
export async function startNew(name: string): Promise<void> {
  clearWork()
  await saveAsNew(name)
}

/** Abre un proyecto propio. */
export async function openProject(id: string): Promise<void> {
  const p = await getProject(id)
  if (!apply(p.data)) throw new CloudError('dato', 'Ese proyecto está dañado y no se puede abrir.')
  useProject.setState({ current: { id: p.id, name: p.name }, shared: null, status: 'saved', error: null })
}

/** Abre con su código un proyecto que compartió otro (queda como copia: no cambia el original). */
export async function openByCode(code: string): Promise<{ name: string; owner: string; mine: boolean }> {
  const p = await openShared(code)
  if (!apply(p.data)) throw new CloudError('dato', 'Ese proyecto está dañado y no se puede abrir.')
  if (p.mine && p.id) useProject.setState({ current: { id: p.id, name: p.name }, shared: null, status: 'saved', error: null })
  else useProject.setState({ current: null, shared: { name: p.name, owner: p.owner }, status: 'saved', error: null })
  return { name: p.name, owner: p.owner, mine: p.mine }
}

export const closeProject = () => useProject.setState({ current: null, shared: null, status: 'saved', error: null })

/** Con un proyecto abierto, cada cambio se guarda solo a los pocos segundos. Va montado una sola vez. */
export function useAutosave() {
  useEffect(() => {
    const touch = () => {
      if (loading) return
      const { current, status } = useProject.getState()
      if (!current || !canEdit(useAuth.getState().user)) return
      if (status !== 'dirty') useProject.setState({ status: 'dirty' })
      clearTimeout(timer)
      timer = setTimeout(() => void saveNow(), 2500)
    }
    const a = usePlan.subscribe((s, prev) => { if (s.plan !== prev.plan || s.layout !== prev.layout) touch() })
    const b = useDesigner.subscribe((s, prev) => { if (s.config !== prev.config) touch() })
    // al cerrar la pestaña con cambios sin guardar, el navegador avisa
    const leave = (e: BeforeUnloadEvent) => { const st = useProject.getState().status; if (useProject.getState().current && (st === 'dirty' || st === 'saving')) e.preventDefault() }
    window.addEventListener('beforeunload', leave)
    // un proyecto abierto en otra sesión: se toma lo que hay en pantalla como lo último guardado
    if (useProject.getState().current && !lastSaved) lastSaved = JSON.stringify(snapshot())
    return () => { a(); b(); window.removeEventListener('beforeunload', leave); clearTimeout(timer) }
  }, [])
}
