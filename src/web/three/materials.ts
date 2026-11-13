import * as THREE from 'three'
import { GALVANIZED, PAINT_COLORS } from '../../shared/rack/technicalSpecs'

/** mm → metros (la escena 3D trabaja en metros). */
export const m = (mm: number) => mm / 1000

/** Colores del modelo rack_selectivo.blend. */
export const COLORS = {
  galvanized: '#c3c8cd',
  brace: '#a9afb5',
  red: '#c3241f',
  dark: '#151515',
  wood: '#c9a273',
  cardboard: '#bf8f5c',
  yellow: '#f2c230',
  mesh: '#8d949b',
} as const

/** Materiales compartidos: una sola instancia para todas las piezas. */
export const MATERIALS = {
  galvanized: new THREE.MeshStandardMaterial({ color: COLORS.galvanized, metalness: 0.75, roughness: 0.38 }),
  brace: new THREE.MeshStandardMaterial({ color: COLORS.brace, metalness: 0.7, roughness: 0.42 }),
  red: new THREE.MeshStandardMaterial({ color: COLORS.red, metalness: 0.15, roughness: 0.42 }),
  /** Piezas de varios colores fusionadas (color por vértice: rojo + bulones + ventanas). */
  painted: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.42 }),
  wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.85 }),
  cardboard: new THREE.MeshStandardMaterial({ color: COLORS.cardboard, roughness: 0.9 }),
  yellow: new THREE.MeshStandardMaterial({ color: COLORS.yellow, metalness: 0.15, roughness: 0.45 }),
  mesh: new THREE.MeshStandardMaterial({ color: COLORS.mesh, metalness: 0.6, roughness: 0.5, wireframe: true }),
  plate: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
}

/* ---------- Colores de pintura (vigas, parantes y protecciones) ---------- */

const paintCache = new Map<string, THREE.Material>()
/** Tono de un color de pintura (o del galvanizado). */
export const paintHex = (id: string): string => (id === 'galvanizado' ? GALVANIZED.hex : PAINT_COLORS.find((c) => c.id === id)?.hex ?? COLORS.red)
/** Material de una pieza pintada de ese color; 'galvanizado' y 'rojo' son los de siempre. */
export function paintMaterial(id: string): THREE.Material {
  if (id === 'galvanizado') return MATERIALS.galvanized
  if (id === 'rojo') return MATERIALS.red
  let mat = paintCache.get(id)
  if (!mat) { mat = new THREE.MeshStandardMaterial({ color: paintHex(id), metalness: 0.15, roughness: 0.42 }); paintCache.set(id, mat) }
  return mat
}
/** Diagonales y travesaños del bastidor: galvanizados, o del color del parante si va pintado. */
export const braceMaterial = (uprightColor: string): THREE.Material => (uprightColor === 'galvanizado' ? MATERIALS.brace : paintMaterial(uprightColor))
const perforatedCache = new Map<THREE.Material, THREE.Material>()
/**
 * El mismo material con los agujeros recortados por una imagen (para las chapas del parante liviano):
 * se ve de los dos lados y los agujeros dejan pasar la vista y la sombra.
 */
export function perforatedMaterial(base: THREE.Material, holes: THREE.Texture): THREE.Material {
  let mat = perforatedCache.get(base)
  if (!mat) {
    mat = base.clone()
    Object.assign(mat, { alphaMap: holes, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: true })
    perforatedCache.set(base, mat)
  }
  return mat
}
/** Chapa gris de los pisos de nivel. */
export const STEEL_DECK = new THREE.MeshStandardMaterial({ color: '#8f969d', metalness: 0.55, roughness: 0.5 })
/** Para marcar la pieza tocada cuando lo amarillo no se distingue (vigas amarillas). */
export const PICK_BLUE = new THREE.MeshStandardMaterial({ color: '#2f8fff', metalness: 0.1, roughness: 0.45 })
