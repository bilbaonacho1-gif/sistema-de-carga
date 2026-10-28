/**
 * Geometría de las piezas (en metros), con las proporciones de rack_selectivo.blend.
 * Ejes: X a lo largo de la fila, Y arriba, Z hacia el pasillo (cara frontal en z = 0).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { DESIGN_RULES, VISUAL } from '../../../shared/rack/technicalSpecs'
import type { BeamProfile, PalletType, UprightProfile } from '../../../shared/rack/types'
import { COLORS, m } from '../materials'
import { box, cached, hexNut, merge, paint } from './utils'

const store = new Map<string, THREE.BufferGeometry>()

/* ---------- Bastidor: travesaños + diagonales en zigzag ---------- */
export function bracingGeometry(profile: UprightProfile, heightMm: number, depthMm: number) {
  return cached(store, `brace-${profile.id}-${heightMm}-${depthMm}`, () => {
    const d = m(profile.depth)
    const D = m(depthMm)
    const bw = m(VISUAL.brace.width)
    const bt = m(VISUAL.brace.thickness)
    // los extremos entran 3 cm dentro de la C de cada parante
    const z1 = -(d - 0.03)
    const z2 = -(D - d + 0.03)
    const y0 = 0.15
    const y1 = m(heightMm) - 0.15
    const n = Math.max(2, Math.round((heightMm - 300) / DESIGN_RULES.diagonalPitch))
    const ys = Array.from({ length: n + 1 }, (_, i) => y0 + ((y1 - y0) * i) / n)

    const bar = (za: number, ya: number, zb: number, yb: number) => {
      const dz = zb - za
      const dy = yb - ya
      const len = Math.hypot(dz, dy)
      return box([0, (ya + yb) / 2, (za + zb) / 2], [bw, bt, len], new THREE.Euler(Math.atan2(-dy, dz), 0, 0))
    }
    const parts = [bar(z1, y0, z2, y0), bar(z1, y1, z2, y1)]
    for (let i = 0; i < n; i++)
      parts.push(i % 2 === 0 ? bar(z1, ys[i], z2, ys[i + 1]) : bar(z2, ys[i], z1, ys[i + 1]))
    return merge(parts)
  })
}

/* ---------- Placa base roja con 4 bulones ---------- */
export function basePlateGeometry(profile: UprightProfile) {
  return cached(store, `plate-${profile.id}`, () => {
    const { width, depth, thickness } = VISUAL.basePlate
    const k = profile.faceWidth / 80
    const W = m(width) * k
    const Dp = m(depth) * k
    const T = m(thickness)
    const zc = -m(profile.depth) / 2
    const parts = [paint(box([0, T / 2, zc], [W, T, Dp]), COLORS.red)]
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p: [number, number, number] = [sx * (W / 2 - 0.017), T + 0.004, zc + sz * (Dp / 2 - 0.023)]
        parts.push(paint(hexNut(p, 0.009, 0.008), COLORS.galvanized))
        parts.push(paint(hexNut([p[0], p[1] + 0.006, p[2]], 0.0045, 0.012), COLORS.galvanized))
      }
    return merge(parts)
  })
}

/* ---------- Protector: chapa plegada con punta en V + pestañas abulonadas ---------- */
export function protectorGeometry(profile: UprightProfile) {
  return cached(store, `prot-${profile.id}`, () => {
    const h = m(VISUAL.protector.height)
    const e = m(VISUAL.protector.thickness)
    const xs = m(profile.faceWidth) / 2 + 0.045
    const zBack = -(m(profile.depth) + 0.005)
    const zFold = 0.03
    const zTip = 0.095

    const sheet = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1) + e
      const ang = Math.atan2(z2 - z1, x2 - x1)
      return box([(x1 + x2) / 2, h / 2, (z1 + z2) / 2], [len, h, e], new THREE.Euler(0, -ang, 0))
    }
    const parts: THREE.BufferGeometry[] = []
    for (const s of [-1, 1]) {
      parts.push(paint(sheet(s * xs, zBack, s * xs, zFold), COLORS.red))      // costado
      parts.push(paint(sheet(s * xs, zFold, 0, zTip), COLORS.red))            // cara en V
      const xf = s * (xs + 0.032)
      parts.push(paint(box([xf, 0.004, zBack + 0.03], [0.064, 0.008, 0.06]), COLORS.red))   // pestaña
      for (const z of [zBack + 0.015, zBack + 0.045])
        parts.push(paint(hexNut([xf + s * 0.006, 0.012, z], 0.008, 0.008), COLORS.galvanized))
    }
    return merge(parts)
  })
}

/* ---------- Viga caja: largo 1 m sobre X (se escala al largo real) ---------- */
export function beamGeometry(beam: BeamProfile) {
  return cached(store, `beam-${beam.id}`, () => {
    const g = new RoundedBoxGeometry(1, m(beam.height), m(beam.depth), 2, 0.006)
    return g
  })
}

/**
 * Conector (escuadra soldada a la punta de la viga). side = +1 extremo derecho, -1 izquierdo.
 * Origen: cara interna del parante, a la cota superior de la viga.
 *  - ala frontal: apoya sobre la cara del parante y tapa la columna de ranuras (ganchos)
 *  - ala lateral: corre por el costado del parante; ahí se suelda la viga
 */
export function connectorGeometry(side: 1 | -1, profile: UprightProfile, beam: BeamProfile) {
  return cached(store, `conn-${side}-${profile.id}-${beam.id}`, () => {
    const e = 0.005
    const H = m(VISUAL.connectorHeight)
    const y0 = 0.02 - H
    const width = m(profile.faceWidth) / 2 - m(VISUAL.groove.halfWidth) - 0.002 + e
    const bd = m(beam.depth)
    const parts = [
      paint(box([side * (width / 2 - e), y0 + H / 2, e / 2], [width, H, e]), COLORS.red),
      paint(box([-side * e / 2, y0 + H / 2, -(bd - e) / 2 + e / 2], [e, H, bd]), COLORS.red),
    ]
    const xc = side * (m(profile.faceWidth) / 2 - m(profile.faceWidth * VISUAL.holes.columnOffsetRatio))
    for (const dy of [-0.03, -0.11, -0.19])
      parts.push(paint(box([xc, dy, e + 0.0004], [0.013, 0.011, 0.001]), COLORS.dark))
    parts.push(paint(hexNut([xc, -0.075, e + 0.003], 0.007, 0.006, 'z'), COLORS.galvanized))
    return merge(parts)
  })
}

/* ---------- Pallet de madera (tablas, largueros y tacos) ---------- */
export function palletGeometry(p: PalletType) {
  return cached(store, `pallet-${p.id}`, () => {
    const F = m(p.front)
    const Dp = m(p.deep)
    const H = m(p.height)
    const e = 0.022
    const parts: THREE.BufferGeometry[] = []
    const zs = [-(Dp / 2 - 0.07), 0, Dp / 2 - 0.07]
    const xs = [-(F / 2 - 0.05), 0, F / 2 - 0.05]
    for (let i = 0; i < 5; i++) parts.push(box([0, H - e / 2, -(Dp / 2 - 0.07) + (i * (Dp - 0.14)) / 4], [F, e, 0.14]))
    for (const x of xs) {
      parts.push(box([x, H - e * 1.5, 0], [0.1, e, Dp]))
      parts.push(box([x, e / 2, 0], [0.1, e, Dp]))
      for (const z of zs) parts.push(box([x, e + (H - 3 * e) / 2, z], [0.1, H - 3 * e, 0.14]))
    }
    return merge(parts)
  })
}

/* ---------- Carga (caja de cartón) ---------- */
export function loadGeometry(p: PalletType, heightMm: number) {
  const h = Math.round(heightMm / 10) * 10
  return cached(store, `load-${p.id}-${h}`, () => {
    const g = new RoundedBoxGeometry(m(p.front) - 0.04, m(h), m(p.deep) - 0.1, 2, 0.012)
    g.translate(0, m(h) / 2, 0)
    return g
  }, 40)
}
