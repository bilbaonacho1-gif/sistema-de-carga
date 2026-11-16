/**
 * MÓDULOS DEL PROYECTO (A, B, C…). Un proyecto puede tener varios tipos de módulo, cada uno con sus
 * medidas, sus vigas, sus perfiles y sus pórticos. Se crean una vez, quedan guardados en el proyecto
 * y después, en la distribución, se elige cuál va en cada lugar. Cambiar un módulo cambia todos los
 * racks armados con él.
 *
 * Cómo se guarda: los campos de siempre de la configuración (width, height, levels…) son el módulo
 * que se está editando (`moduleId`); los demás esperan en `moduleTypes`. Un rack sin tipo usa el
 * primer módulo. Los accesorios, los colores, el pallet y la carga también son de cada módulo.
 */
import type { RackConfiguration } from './types'

/** Lo del pallet y la carga, que también es de cada módulo. */
export const LOAD_KEYS = ['palletTypeId', 'customPallet', 'palletWeight', 'palletsPerModule', 'load'] as const
export const SPEC_KEYS = ['width', 'depth', 'height', 'levels', 'floorStorage', 'beamElevations', 'uprightId', 'beamId', 'frameDefault', 'accessories', ...LOAD_KEYS] as const
export type ModuleSpec = NonNullable<RackConfiguration['moduleTypes']>[number]['spec']
export interface ModuleType { id: string; name: string; spec: ModuleSpec }

export const MAX_MODULES = 12
/** A, B, C… (después de la Z: A2, B2…). */
export const moduleLetter = (n: number) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26) + 1) : '')

/** Lo que define a un módulo, sacado de una configuración. */
export function specOf(c: RackConfiguration): ModuleSpec {
  return {
    width: c.width, depth: c.depth, height: c.height, levels: c.levels, floorStorage: c.floorStorage,
    beamElevations: c.beamElevations, uprightId: c.uprightId, beamId: c.beamId, frameDefault: c.frameDefault,
    // los accesorios y los colores también son de cada módulo
    accessories: c.accessories,
    // y también el pallet y la carga
    palletTypeId: c.palletTypeId, customPallet: c.customPallet, palletWeight: c.palletWeight, palletsPerModule: c.palletsPerModule, load: c.load,
  }
}

/**
 * Un módulo guardado antes de que la carga fuera de cada uno no la trae: usa la del que se está
 * editando. Esto se la deja escrita, para que no cambie cuando después se toca la de otro módulo.
 */
export function withOwnLoads(c: RackConfiguration): RackConfiguration {
  if (!c.moduleTypes?.some((m) => m.spec.palletWeight === undefined)) return c
  const mine = { palletTypeId: c.palletTypeId, customPallet: c.customPallet, palletWeight: c.palletWeight, palletsPerModule: c.palletsPerModule, load: c.load }
  return { ...c, moduleTypes: c.moduleTypes.map((m) => (m.spec.palletWeight === undefined ? { ...m, spec: { ...mine, ...m.spec } } : m)) }
}

/** El módulo que se está editando (sus datos son los campos de siempre de la configuración). */
export const activeModuleId = (c: RackConfiguration): string => c.moduleId ?? c.moduleTypes?.[0]?.id ?? 'A'

/** Todos los módulos del proyecto, en orden. Sin ninguno creado, hay uno solo: el A. */
export function moduleList(c: RackConfiguration): ModuleType[] {
  const active = activeModuleId(c)
  if (!c.moduleTypes?.length) return [{ id: active, name: 'A', spec: specOf(c) }]
  return c.moduleTypes.map((m) => (m.id === active ? { ...m, spec: specOf(c) } : m))
}
/** El módulo de los racks que no dicen cuál usan (el primero). */
export const defaultModuleId = (c: RackConfiguration): string => c.moduleTypes?.[0]?.id ?? activeModuleId(c)
export const moduleName = (c: RackConfiguration, id: string | undefined): string => moduleList(c).find((m) => m.id === (id ?? defaultModuleId(c)))?.name ?? moduleList(c)[0].name

/**
 * La configuración con lo de un módulo encima. Lo opcional que el módulo no trae queda vacío (no se
 * hereda del que se está editando): al guardarse, lo vacío no viaja. Las dos excepciones son los
 * accesorios y la carga de un módulo guardado antes de que fueran de cada uno: usa los del que se edita.
 */
function withSpec(c: RackConfiguration, spec: ModuleSpec): RackConfiguration {
  const own = spec.palletWeight !== undefined
  return {
    ...c, beamElevations: undefined, uprightId: undefined, beamId: undefined, frameDefault: undefined,
    ...(own ? { customPallet: undefined, load: undefined } : {}),
    ...spec, accessories: spec.accessories ?? c.accessories,
  }
}

const resolved = new WeakMap<RackConfiguration, Map<string, RackConfiguration>>()
/**
 * La configuración con las medidas de ESE módulo (para calcular un rack armado con él). Devuelve
 * siempre el mismo objeto para la misma configuración y el mismo módulo, así lo calculado se reusa.
 */
export function configFor(c: RackConfiguration, id?: string): RackConfiguration {
  const active = activeModuleId(c)
  const want = id && c.moduleTypes?.some((m) => m.id === id) ? id : defaultModuleId(c)
  if (want === active) return c
  let by = resolved.get(c)
  if (!by) { by = new Map(); resolved.set(c, by) }
  let out = by.get(want)
  if (!out) {
    const spec = c.moduleTypes!.find((m) => m.id === want)!.spec
    out = withSpec(c, spec)
    by.set(want, out)
  }
  return out
}

/** La lista con el módulo que se estaba editando guardado en su lugar. */
function stored(c: RackConfiguration): ModuleType[] {
  return moduleList(withOwnLoads(c)).map((m) => ({ ...m, spec: { ...m.spec } }))
}

/** Pasa a editar otro módulo: el actual queda guardado en la lista y el elegido sube a los campos de siempre. */
export function selectModule(c: RackConfiguration, id: string): RackConfiguration {
  const list = stored(c)
  const next = list.find((m) => m.id === id)
  if (!next || id === activeModuleId(c) && c.moduleTypes?.length) return c
  return { ...withSpec(c, next.spec), moduleTypes: list, moduleId: id }
}

/** Crea un módulo nuevo, copia del que se está editando, y pasa a editarlo. */
export function addModule(c: RackConfiguration): RackConfiguration {
  const list = stored(c)
  if (list.length >= MAX_MODULES) return c
  const used = new Set(list.map((m) => m.name))
  let n = list.length
  while (used.has(moduleLetter(n))) n++
  const ids = new Set(list.map((m) => m.id))
  let id = moduleLetter(n)
  for (let k = 2; ids.has(id); k++) id = `${moduleLetter(n)}-${k}`
  const spec = specOf(c)
  return { ...c, moduleTypes: [...list, { id, name: moduleLetter(n), spec: { ...spec } }], moduleId: id }
}

/** Borra un módulo (siempre queda al menos uno). Si era el que se editaba, se pasa al primero. */
export function removeModule(c: RackConfiguration, id: string): RackConfiguration {
  const list = stored(c)
  if (list.length < 2 || !list.some((m) => m.id === id)) return c
  const rest = list.filter((m) => m.id !== id)
  const active = activeModuleId(c) === id ? rest[0] : rest.find((m) => m.id === activeModuleId(c))!
  return { ...withSpec(c, active.spec), moduleTypes: rest, moduleId: active.id }
}

export function renameModule(c: RackConfiguration, id: string, name: string): RackConfiguration {
  const clean = name.trim().slice(0, 24)
  if (!clean) return c
  return { ...c, moduleTypes: stored(c).map((m) => (m.id === id ? { ...m, name: clean } : m)), moduleId: activeModuleId(c) }
}

/** Un color para cada módulo, para distinguirlos en el plano (relleno y borde). */
export const MODULE_COLORS: { fill: string; stroke: string }[] = [
  { fill: '#fde3c8', stroke: '#e07b1a' }, { fill: '#cfe3f7', stroke: '#2f6fb8' }, { fill: '#d5eed8', stroke: '#2e8b57' }, { fill: '#e6dafa', stroke: '#7b4fc4' },
  { fill: '#fbd5dc', stroke: '#c2415b' }, { fill: '#fff0b8', stroke: '#b98a00' }, { fill: '#cdeeee', stroke: '#1c8a8a' }, { fill: '#e4e4e4', stroke: '#666c73' },
]
export const moduleColor = (index: number) => MODULE_COLORS[Math.max(0, index) % MODULE_COLORS.length]
