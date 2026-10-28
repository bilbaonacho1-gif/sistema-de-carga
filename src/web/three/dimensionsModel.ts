/**
 * Cotas como DATOS: qué se mide, desde dónde y con qué rótulo.
 * Las líneas las dibuja <Dimensions> en el 3D y los rótulos <DimensionLabels> en HTML.
 */
import * as THREE from 'three'
import type { RackStructure } from '../../shared/rack/types'
import type { CameraView } from './types'
import { m } from './materials'

export type V3 = [number, number, number]

export interface DimSpec {
  id: string
  a: V3
  b: V3
  /** Desplazamiento de la línea de cota respecto de los puntos medidos. */
  offset: V3
  value: number
  caption: string
  arrow: number
  tone: 'main' | 'accent' | 'plain'
}

export const DIM_COLORS = { main: '#1f2328', plain: '#1f2328', accent: '#b82134' } as const

/** Separación de las cotas respecto del rack (m), proporcional a su tamaño. */
export function dimensionGap(s: RackStructure): number {
  const size = Math.max(m(s.totalWidth), m(s.config.height), m(s.totalDepth))
  return THREE.MathUtils.clamp(size * 0.06, 0.45, 2.2)
}

/** Agranda la caja de encuadre para que las cotas entren en pantalla. */
export function expandForDimensions(box: THREE.Box3, s: RackStructure): THREE.Box3 {
  const g = dimensionGap(s)
  const b = box.clone()
  b.min.x -= g * 1.25
  b.max.x += g * 1.25
  b.max.y += g * 0.8
  b.max.z += g * 1.3
  return b
}

/**
 * Cotas que se ocultan según la vista: desde arriba no se lee una altura y de
 * frente no se lee una profundidad (la línea queda apuntando a la cámara).
 */
const HIDDEN_IN: Record<CameraView, (id: string) => boolean> = {
  top: (id) => id.startsWith('height') || id.startsWith('level-'),
  front: (id) => id.startsWith('depth') || id === 'aisle',
  side: (id) => id === 'width' || id === 'module',
  iso: () => false,
  free: () => false,
}

export function computeDimensions(s: RackStructure, view: CameraView = 'iso'): DimSpec[] {
  return allDimensions(s, view).filter((d) => !HIDDEN_IN[view](d.id))
}

function allDimensions(s: RackStructure, view: CameraView): DimSpec[] {
  const { config, rows, totalWidth, totalDepth } = s
  const L = m(totalWidth)
  // la altura se mide en el primer bastidor; los niveles, en el último módulo (cada tramo tiene los suyos)
  const firstFrame = rows[0].frames[0]
  const lastModule = rows[0].modules[rows[0].modules.length - 1]
  const levels = lastModule.levels
  const H = m(firstFrame.height)
  const D = m(config.depth)
  const size = Math.max(L, H, m(totalDepth))
  const arrow = THREE.MathUtils.clamp(size * 0.014, 0.05, 0.22)
  const g = dimensionGap(s)

  const zMin = Math.min(...rows.map((r) => (r.facing === 1 ? r.zFront - config.depth : r.zFront)))
  const zMax = Math.max(...rows.map((r) => (r.facing === 1 ? r.zFront : r.zFront + config.depth)))
  const first = rows[0].modules[0]
  const supports = levels.map((l) => l.elevation)

  const multiRow = rows.length > 1
  const dims: DimSpec[] = [
    { id: 'width', a: [0, 0.002, 0], b: [L, 0.002, 0], offset: [0, 0, g], value: totalWidth, caption: 'ANCHO TOTAL', arrow, tone: 'main' },
    { id: 'height', a: [0, 0, 0], b: [0, H, 0], offset: [-g, 0, 0], value: firstFrame.height, caption: 'ALTURA', arrow, tone: 'main' },
    // con varias filas, la profundidad del bastidor va arriba y la total queda en el piso
    // (vista superior: las dos quedan en el piso, una más afuera que la otra)
    multiRow && view === 'top'
      ? { id: 'depth', a: [L, 0.002, m(zMax)], b: [L, 0.002, m(zMax) - D], offset: [g * 2.4, 0, 0], value: config.depth, caption: 'PROFUNDIDAD', arrow, tone: 'main' }
      : multiRow
      ? { id: 'depth', a: [L, H, m(zMax)], b: [L, H, m(zMax) - D], offset: [0, g * 0.55, 0], value: config.depth, caption: 'PROFUNDIDAD', arrow, tone: 'main' }
      : { id: 'depth', a: [L, 0.002, m(zMax)], b: [L, 0.002, m(zMax) - D], offset: [g, 0, 0], value: config.depth, caption: 'PROFUNDIDAD', arrow, tone: 'main' },
    { id: 'module', a: [m(first.xStart), H, 0], b: [m(first.xEnd), H, 0], offset: [0, g * 0.55, 0], value: first.width, caption: 'ANCHO DE POSICIÓN', arrow, tone: 'accent' },
  ]

  // con tramos de distinta altura, se acota también el bastidor más alto
  const tallest = rows[0].frames.reduce((a, f) => (f.height > a.height ? f : a), firstFrame)
  if (tallest.height !== firstFrame.height)
    dims.push({ id: 'height-max', a: [m(tallest.x), 0, 0], b: [m(tallest.x), m(tallest.height), 0], offset: [0, 0, g], value: tallest.height, caption: 'ALTURA MÁXIMA', arrow, tone: 'main' })

  if (multiRow) {
    dims.push({ id: 'depth-total', a: [L, 0.002, m(zMax)], b: [L, 0.002, m(zMin)], offset: [g, 0, 0], value: totalDepth, caption: 'PROFUNDIDAD TOTAL', arrow, tone: 'main' })
    const { backToBack, aisleWidth } = config.layout
    const aisle = backToBack
      ? (rows[2] ? { from: rows[1].zFront, to: rows[2].zFront } : null)
      : { from: rows[0].zFront - config.depth, to: rows[1].zFront }
    if (aisle)
      dims.push({ id: 'aisle', a: [0, 0.002, m(aisle.from)], b: [0, 0.002, m(aisle.to)], offset: [-g, 0, 0], value: aisleWidth, caption: 'PASILLO', arrow, tone: 'plain' })
  }

  supports.slice(1).forEach((e, i) => {
    dims.push({
      id: `level-${i + 1}`,
      a: [L, m(supports[i]), 0],
      b: [L, m(e), 0],
      offset: [g * 0.7, 0, 0],
      value: e - supports[i],
      caption: `ENTRE NIVELES ${i + 1}–${i + 2}`,
      arrow: arrow * 0.8,
      tone: 'accent',
    })
  })
  return dims
}

/** Punto donde va el rótulo: centro de la línea de cota. */
export function labelAnchor(d: DimSpec): V3 {
  return [
    (d.a[0] + d.b[0]) / 2 + d.offset[0],
    (d.a[1] + d.b[1]) / 2 + d.offset[1],
    (d.a[2] + d.b[2]) / 2 + d.offset[2],
  ]
}
