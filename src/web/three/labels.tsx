/**
 * Rótulos HTML anclados a puntos del 3D (cotas, contorno del depósito).
 *
 * En vez de crear un root de React por rótulo, los rótulos se dibujan una sola
 * vez en una capa HTML sobre el visor y este proyector, dentro del Canvas,
 * los ubica en pantalla en cada cuadro según la cámara.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { RackStructure } from '../../shared/rack/types'
import type { CameraView } from './types'
import { computeDimensions, labelAnchor, type DimSpec, type V3 } from './dimensionsModel'
import { m } from './materials'

export type SceneLabel =
  | { id: string; kind: 'dim'; position: V3; spec: DimSpec }
  | { id: string; kind: 'warehouse'; position: V3; text: string }

/** Todos los rótulos que corresponde mostrar para esta estructura. */
export function sceneLabels(s: RackStructure, showDimensions: boolean, view: CameraView = 'iso'): SceneLabel[] {
  const labels: SceneLabel[] = showDimensions
    ? computeDimensions(s, view).map((spec) => ({ id: spec.id, kind: 'dim' as const, position: labelAnchor(spec), spec }))
    : []
  const { warehouseLength, warehouseWidth, aisleWidth } = s.config.layout
  if (warehouseLength && warehouseWidth) {
    labels.push({
      id: 'warehouse',
      kind: 'warehouse',
      position: [-0.5 + 0.15, 0.01, m(aisleWidth) - 0.15],
      text: `DEPÓSITO ${warehouseLength.toLocaleString('es-AR')} × ${warehouseWidth.toLocaleString('es-AR')} mm`,
    })
  }
  return labels
}

const elements = new Map<string, HTMLElement>()

/** ref para el elemento HTML del rótulo `id`. */
export const bindLabel = (id: string) => (el: HTMLElement | null) => {
  if (el) elements.set(id, el)
  else elements.delete(id)
}

export function LabelProjector({ labels }: { labels: SceneLabel[] }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    for (const l of labels) {
      const el = elements.get(l.id)
      if (!el) continue
      v.set(...l.position).project(camera)
      const visible = v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3
      el.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) continue
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${l.kind === 'dim' ? '-50%, -50%' : '0, -50%'})`
    }
  })
  return null
}
