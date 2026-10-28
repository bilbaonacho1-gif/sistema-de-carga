import * as THREE from 'three'

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
