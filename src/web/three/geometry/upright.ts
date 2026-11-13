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
import { customUprightGeometry } from './custom'
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

/* ------------------------------ Parante liviano ------------------------------ */

/** Ancho (mm) de la franja de chapa que cubre la imagen de la ranura, centrada en la columna de agujeros. */
const STRIP = 25
let slotTex: THREE.CanvasTexture | null = null
/**
 * La ranura como imagen: blanco = chapa, negro = agujero. Un mosaico de un paso de alto, que se repite
 * hacia arriba. Se usa como recorte (alphaMap) para no modelar cada agujero.
 */
export function slotTexture(): THREE.CanvasTexture {
  if (slotTex) return slotTex
  const W = 64, H = 128
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  ctx.beginPath()
  slotOutline(0, 0).forEach((p, i) => {
    const x = W / 2 + (p.x * 1000 / STRIP) * W, y = H / 2 - (p.y * 1000 / VISUAL.holes.pitch) * H
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fill()
  slotTex = new THREE.CanvasTexture(c)
  slotTex.wrapS = THREE.ClampToEdgeWrapping
  slotTex.wrapT = THREE.RepeatWrapping
  slotTex.anisotropy = 8
  return slotTex
}

const lightStore = new Map<string, { body: THREE.BufferGeometry; plates: THREE.BufferGeometry }>()
/**
 * El mismo parante, liviano: las cuatro chapas perforadas son planos (con la ranura como imagen) y
 * el resto (pliegue y pestañas) son las mismas cajas. Unas 100 caras en vez de decenas de miles.
 * `plates` va con el material perforado (ver perforatedMaterial) y `body` con el material común.
 */
export function lightUprightGeometry(profile: UprightProfile, heightMm: number): { body: THREE.BufferGeometry; plates: THREE.BufferGeometry } {
  const key = `${profile.id}:${profile.faceWidth}x${profile.depth}x${profile.thickness}-${heightMm}`
  const hit = lightStore.get(key)
  if (hit) return hit
  const H = m(heightMm)
  const w = m(profile.faceWidth) / 2
  const d = m(profile.depth)
  const t = m(profile.thickness)
  const r = m(VISUAL.groove.halfWidth)
  const rd = m(VISUAL.groove.depth)
  const lip = m(profile.faceWidth * VISUAL.lipRatio)
  const col = m(profile.faceWidth * VISUAL.holes.columnOffsetRatio)
  const rows = slotRows(heightMm)
  const { pitch, startAt } = VISUAL.holes
  // de dónde a dónde hay ranuras (medio paso antes de la primera y después de la última)
  const yA = Math.min(H, m(startAt - pitch / 2)), yB = rows.length ? Math.min(H, rows[rows.length - 1] + m(pitch / 2)) : yA

  const pos: number[] = [], nor: number[] = [], uv: number[] = []
  /** Una chapa: u de u0 a u1 (m), con la columna de ranuras en holeU; `at` la ubica en el espacio. */
  const plate = (u0: number, u1: number, holeU: number, at: (u: number, y: number) => [number, number, number], normal: [number, number, number], flip: boolean) => {
    const U = (u: number) => ((u - holeU) * 1000) / STRIP + 0.5
    const quad = (y0: number, y1: number, holes: boolean) => {
      if (y1 - y0 < 1e-6) return
      const V = (y: number) => ((y - yA) * 1000) / pitch
      const c: [number, number, number, number][] = [[u0, y0, 0, 0], [u1, y0, 0, 0], [u1, y1, 0, 0], [u0, y1, 0, 0]]
      const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]
      for (const i of order) {
        const [u, y] = c[i]
        pos.push(...at(u, y)); nor.push(...normal)
        // sin ranuras: todo el plano toma el borde de la imagen, que es chapa
        uv.push(holes ? U(u) : 0, holes ? V(y) : 0)
      }
    }
    quad(0, yA, false); quad(yA, yB, true); quad(yB, H, false)
  }
  // cada chapa son dos planos, la cara de afuera y la de adentro, separados por el espesor: así, mirada
  // de costado, la ranura se va cerrando como en la chapa de verdad
  for (const k of [0, t]) {
    plate(r, w, col, (u, y) => [u, y, -k], [0, 0, 1], false)            // frente, a la derecha del pliegue
    plate(-w, -r, -col, (u, y) => [u, y, -k], [0, 0, 1], false)         // frente, a la izquierda
    plate(0, d, d / 2, (u, y) => [w - k, y, -u], [1, 0, 0], false)      // costado derecho
    plate(0, d, d / 2, (u, y) => [-w + k, y, -u], [-1, 0, 0], true)     // costado izquierdo
  }
  const plates = new THREE.BufferGeometry()
  plates.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  plates.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  plates.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  plates.computeBoundingSphere()

  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    parts.push(box([side * (r + t / 2), H / 2, -(rd + t) / 2], [t, H, rd + t]))                  // paredes del pliegue
    parts.push(box([side * (w - (lip + t) / 2), H / 2, -d + t / 2], [lip - t, H, t]))           // pestaña del fondo de la C
  }
  parts.push(box([0, H / 2, -(rd + t / 2)], [2 * (r + t), H, t]))                                // fondo del pliegue
  const out = { body: merge(parts), plates }
  lightStore.set(key, out)
  if (lightStore.size > 40) {
    const [oldKey, old] = lightStore.entries().next().value as [string, typeof out]
    lightStore.delete(oldKey)
    old.body.dispose(); old.plates.dispose()
  }
  return out
}

export function uprightGeometry(profile: UprightProfile, heightMm: number): THREE.BufferGeometry {
  if (profile.shape) return customUprightGeometry(profile.shape, heightMm)
  return cached(store, `${profile.id}:${profile.faceWidth}x${profile.depth}x${profile.thickness}-${heightMm}`, () => {
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
