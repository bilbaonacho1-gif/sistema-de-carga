/**
 * Parante perforado — misma construcción que rack_selectivo.py (Blender):
 * perfil C con pliegue central en la cara frontal, 2 columnas de ranuras
 * cuadrado-círculo-cuadrado en el frente y 1 columna en cada costado.
 *
 * Ejes locales (metros): cara frontal en z = 0 mirando a +Z, el perfil se mete hacia -Z,
 * x = 0 en el eje del parante, y = 0 en el piso.
 */
import * as THREE from 'three'
import { VISUAL } from '../../../shared/rack/technicalSpecs'
import type { UprightProfile } from '../../../shared/rack/types'
import { m } from '../materials'
import { box, cached, merge } from './utils'

/**
 * Silueta de UNA ranura: cuadrado arriba + círculo al medio + cuadrado abajo,
 * unidos en una sola figura. (cx, cy) = centro del círculo, en metros.
 */
export function slotOutline(cx: number, cy: number): THREE.Vector2[] {
  const a = m(VISUAL.holes.squareSide) / 2
  const R = m(VISUAL.holes.circleRadius)
  const s = m(VISUAL.holes.squareOffset)
  const yb = s - a                       // borde interno de cada cuadrado
  const yt = s + a                       // borde externo
  const xi = Math.sqrt(R * R - yb * yb)  // donde el cuadrado corta al círculo
  const th = Math.atan2(yb, xi)
  const n = 8
  const pts: [number, number][] = [[-a, yt], [a, yt], [a, yb], [xi, yb]]
  for (let k = 1; k < n; k++) { const t = th - (2 * th * k) / n; pts.push([R * Math.cos(t), R * Math.sin(t)]) }
  pts.push([xi, -yb], [a, -yb], [a, -yt], [-a, -yt], [-a, -yb], [-xi, -yb])
  for (let k = 1; k < n; k++) { const t = Math.PI + th - (2 * th * k) / n; pts.push([R * Math.cos(t), R * Math.sin(t)]) }
  pts.push([-xi, yb], [-a, yb])
  return pts.map(([x, y]) => new THREE.Vector2(cx + x, cy + y))
}

/** Alturas (m) de cada ranura a lo largo del parante. */
function slotRows(height: number): number[] {
  const { pitch, startAt, endMargin } = VISUAL.holes
  const rows: number[] = []
  for (let y = startAt; y <= height - endMargin; y += pitch) rows.push(m(y))
  return rows
}

/** Chapa plana (u0..u1 × 0..h) con una columna de ranuras en `holeU`, extruida `t`. */
function perforatedPlate(u0: number, u1: number, h: number, t: number, holeU: number, rows: number[]) {
  const shape = new THREE.Shape([
    new THREE.Vector2(u0, 0), new THREE.Vector2(u1, 0), new THREE.Vector2(u1, h), new THREE.Vector2(u0, h),
  ])
  for (const y of rows) shape.holes.push(new THREE.Path(slotOutline(holeU, y)))
  return new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 })
}

const store = new Map<string, THREE.BufferGeometry>()

export function uprightGeometry(profile: UprightProfile, heightMm: number): THREE.BufferGeometry {
  return cached(store, `${profile.id}-${heightMm}`, () => {
    const H = m(heightMm)
    const w = m(profile.faceWidth) / 2
    const d = m(profile.depth)
    const t = m(profile.thickness)
    const r = m(VISUAL.groove.halfWidth)
    const rd = m(VISUAL.groove.depth)
    const lip = m(profile.faceWidth * VISUAL.lipRatio)
    const col = m(profile.faceWidth * VISUAL.holes.columnOffsetRatio)
    const rows = slotRows(heightMm)

    const parts: THREE.BufferGeometry[] = []

    // cara frontal: dos chapas perforadas a los lados del pliegue central
    for (const side of [-1, 1]) {
      const plate = side > 0
        ? perforatedPlate(r, w, H, t, col, rows)
        : perforatedPlate(-w, -r, H, t, -col, rows)
      plate.translate(0, 0, -t)
      parts.push(plate)
      // paredes del pliegue
      parts.push(box([side * (r + t / 2), H / 2, -(rd + t) / 2], [t, H, rd + t]))
    }
    parts.push(box([0, H / 2, -(rd + t / 2)], [2 * (r + t), H, t]))      // fondo del pliegue

    // costados perforados (una columna de ranuras centrada en la profundidad)
    for (const side of [-1, 1]) {
      const plate = perforatedPlate(0, d, H, t, d / 2, rows)
      plate.rotateY(Math.PI / 2)                     // u → -Z, espesor → +X
      plate.translate(side > 0 ? w - t : -w, 0, 0)
      parts.push(plate)
      // pestaña del fondo de la C
      parts.push(box([side * (w - (lip + t) / 2), H / 2, -d + t / 2], [lip - t, H, t]))
    }

    return merge(parts)
  }, 8)
}
