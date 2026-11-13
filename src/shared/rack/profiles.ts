/**
 * CATÁLOGO DE PIEZAS: los perfiles de fábrica (technicalSpecs) más los que crea el usuario
 * ("mis piezas": sus propios tipos de viga y de parante, con nombre, medidas y cuánto aguantan).
 * Las piezas propias viajan dentro de la configuración del rack (config.customProfiles).
 */
import { BEAM_PROFILES, UPRIGHT_PROFILES } from './technicalSpecs'
import { sanitizeShape, sectionSize } from './section'
import { sanitizeObjectShape } from '../plan/edit'
import type { BeamProfile, ObjectType, RackConfiguration, UprightProfile } from './types'

export interface CustomProfiles { uprights: UprightProfile[]; beams: BeamProfile[]; objects?: ObjectType[] }

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback
}
const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : fallback)

/** Límites de las medidas de una pieza propia (mm y kg). */
export const PIECE_LIMITS = {
  beamHeight: { min: 40, max: 300 }, beamDepth: { min: 30, max: 150 }, beamCapacity: { min: 100, max: 20_000 },
  beamSpan: { min: 1200, max: 3600 },
  uprightFace: { min: 50, max: 250 }, uprightDepth: { min: 40, max: 200 }, uprightThickness: { min: 1, max: 8 },
  uprightLoad: { min: 500, max: 80_000 },
}
const P = PIECE_LIMITS

export const beamName = (b: { height: number; depth: number }) => `Viga ${b.height} × ${b.depth}`
export const uprightName = (u: { faceWidth: number; depth: number }) => `Parante ${u.faceWidth} × ${u.depth}`

/** Deja las piezas propias con medidas válidas (y sin repetir ids ni pisar los de fábrica). */
export function sanitizeProfiles(c: Partial<CustomProfiles> | undefined): CustomProfiles {
  const seen = new Set<string>([...UPRIGHT_PROFILES, ...BEAM_PROFILES].map((p) => p.id).concat('auto', ''))
  const fresh = (id: unknown) => { const s = typeof id === 'string' ? id : ''; if (seen.has(s)) return false; seen.add(s); return true }
  const uprights = (Array.isArray(c?.uprights) ? c!.uprights : []).filter((u) => u && fresh(u.id)).slice(0, 40).map((u) => {
    // con forma propia, el frente y el fondo salen del dibujo
    const shape = sanitizeShape(u.shape), size = shape && sectionSize(shape)
    const faceWidth = clamp(size?.w ?? u.faceWidth, P.uprightFace.min, P.uprightFace.max, 100), depth = clamp(size?.h ?? u.depth, P.uprightDepth.min, P.uprightDepth.max, 85)
    return {
      id: u.id, name: text(u.name, uprightName({ faceWidth, depth })), faceWidth, depth,
      thickness: Math.min(P.uprightThickness.max, Math.max(P.uprightThickness.min, Number(shape?.thickness ?? u.thickness) || 2.5)),
      maxFrameLoad: clamp(u.maxFrameLoad, P.uprightLoad.min, P.uprightLoad.max, 10_000),
      ...(shape ? { shape } : {}),
    }
  })
  const beams = (Array.isArray(c?.beams) ? c!.beams : []).filter((b) => b && fresh(b.id)).slice(0, 40).map((b) => {
    // con forma propia, el alto y el ancho salen del dibujo
    const shape = sanitizeShape(b.shape), size = shape && sectionSize(shape)
    const height = clamp(size?.h ?? b.height, P.beamHeight.min, P.beamHeight.max, 100), depth = clamp(size?.w ?? b.depth, P.beamDepth.min, P.beamDepth.max, 50)
    const spans = (Array.isArray(b.capacityBySpan) ? b.capacityBySpan : []).map((s) => ({
      maxSpan: clamp(s?.maxSpan, P.beamSpan.min, P.beamSpan.max, P.beamSpan.max),
      capacity: clamp(s?.capacity, P.beamCapacity.min, P.beamCapacity.max, 2000),
    })).sort((x, y) => x.maxSpan - y.maxSpan)
    return { id: b.id, name: text(b.name, beamName({ height, depth })), height, depth, capacityBySpan: spans.length ? spans : [{ maxSpan: P.beamSpan.max, capacity: 2000 }], ...(shape ? { shape } : {}) }
  })
  const objects = (Array.isArray(c?.objects) ? c!.objects : []).filter((o) => o && fresh(o.id)).slice(0, 60).map((o) => ({ ...sanitizeObjectShape(o), id: o.id }))
  return { uprights, beams, ...(objects.length ? { objects } : {}) }
}

/** Todas las piezas que se pueden elegir: las de fábrica y las propias, de la más liviana a la más pesada. */
export function profilesOf(config: Pick<RackConfiguration, 'customProfiles'> | undefined, base: { uprights: UprightProfile[]; beams: BeamProfile[] } = { uprights: UPRIGHT_PROFILES, beams: BEAM_PROFILES }): CustomProfiles {
  const own = config?.customProfiles
  if (!own || (!own.uprights?.length && !own.beams?.length)) return base
  return {
    ...(own.objects?.length ? { objects: own.objects } : {}),
    uprights: [...base.uprights, ...(own.uprights ?? [])].sort((a, b) => a.maxFrameLoad - b.maxFrameLoad),
    beams: [...base.beams, ...(own.beams ?? [])].sort((a, b) => a.height * a.depth - b.height * b.depth),
  }
}

/** ¿Es una pieza creada por el usuario? */
export const isOwnProfile = (config: Pick<RackConfiguration, 'customProfiles'> | undefined, id: string) =>
  !!config?.customProfiles && (config.customProfiles.uprights.some((u) => u.id === id) || config.customProfiles.beams.some((b) => b.id === id))

/* ------------------------------ Pasar las piezas a otra computadora ------------------------------ */

const FILE_KIND = 'sistema-de-depositos/mis-piezas'

/** El texto del archivo con todas las piezas propias (para bajarlo y cargarlo en otra computadora). */
export function piecesFile(own: Partial<CustomProfiles> | undefined): string {
  const clean = sanitizeProfiles(own)
  return JSON.stringify({ archivo: FILE_KIND, version: 1, vigas: clean.beams, parantes: clean.uprights, objetos: clean.objects ?? [] }, null, 1)
}

/** Lee un archivo de piezas. Devuelve null si no es uno (otro archivo, o roto). */
export function readPiecesFile(text: string): CustomProfiles | null {
  try {
    const d = JSON.parse(text) as { archivo?: string; vigas?: unknown; parantes?: unknown; objetos?: unknown }
    if (!d || d.archivo !== FILE_KIND) return null
    return sanitizeProfiles({ beams: d.vigas as BeamProfile[], uprights: d.parantes as UprightProfile[], objects: d.objetos as ObjectType[] })
  } catch { return null }
}

/**
 * Suma las piezas de un archivo a las propias. Una pieza que ya estaba (la misma, por su id) se
 * actualiza con la del archivo; las demás se agregan. Devuelve cuántas entraron de cada modo.
 */
export function mergeProfiles(own: Partial<CustomProfiles> | undefined, incoming: CustomProfiles): { profiles: CustomProfiles; added: number; updated: number } {
  const base = sanitizeProfiles(own)
  let added = 0, updated = 0
  const join = <T extends { id: string }>(mine: T[], theirs: T[]): T[] => {
    const out = [...mine]
    for (const t of theirs) {
      const i = out.findIndex((x) => x.id === t.id)
      if (i >= 0) { out[i] = t; updated++ } else { out.push(t); added++ }
    }
    return out
  }
  const profiles = sanitizeProfiles({
    uprights: join(base.uprights, incoming.uprights), beams: join(base.beams, incoming.beams), objects: join(base.objects ?? [], incoming.objects ?? []),
  })
  return { profiles, added, updated }
}
