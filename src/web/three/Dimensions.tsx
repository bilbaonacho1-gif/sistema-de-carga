/**
 * Líneas de cota en el 3D: línea de cota, líneas de referencia y flechas.
 * Los rótulos (texto) van en una capa HTML aparte: ver labels.tsx.
 */
import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { RackStructure } from '../../shared/rack/types'
import type { CameraView } from './types'
import { computeDimensions, DIM_COLORS, type DimSpec } from './dimensionsModel'

const UP = new THREE.Vector3(0, 1, 0)

function Arrow({ at, dir, size, color }: { at: THREE.Vector3; dir: THREE.Vector3; size: number; color: string }) {
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir)
  return (
    <mesh position={at.clone().addScaledVector(dir, -size / 2)} quaternion={quat} renderOrder={10}>
      <coneGeometry args={[size * 0.28, size, 12]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  )
}

function DimensionLine({ spec }: { spec: DimSpec }) {
  const color = DIM_COLORS[spec.tone]
  const { A, B, A2, B2, dir, over, offDir } = useMemo(() => {
    const A = new THREE.Vector3(...spec.a)
    const B = new THREE.Vector3(...spec.b)
    const off = new THREE.Vector3(...spec.offset)
    const offDir = off.clone().normalize()
    const A2 = A.clone().add(off)
    const B2 = B.clone().add(off)
    return { A, B, A2, B2, dir: B2.clone().sub(A2).normalize(), over: offDir.clone().multiplyScalar(spec.arrow * 0.6), offDir }
  }, [spec])
  const start = (p: THREE.Vector3) => p.clone().addScaledVector(offDir, spec.arrow * 0.3)

  return (
    <group>
      <Line points={[start(A), A2.clone().add(over)]} color={color} lineWidth={1} transparent opacity={0.55} depthTest={false} />
      <Line points={[start(B), B2.clone().add(over)]} color={color} lineWidth={1} transparent opacity={0.55} depthTest={false} />
      <Line points={[A2, B2]} color={color} lineWidth={spec.tone === 'main' ? 1.8 : 1.3} depthTest={false} />
      <Arrow at={B2} dir={dir} size={spec.arrow} color={color} />
      <Arrow at={A2} dir={dir.clone().negate()} size={spec.arrow} color={color} />
    </group>
  )
}

export function Dimensions({ structure, view }: { structure: RackStructure; view: CameraView }) {
  const specs = useMemo(() => computeDimensions(structure, view), [structure, view])
  return (
    <group>
      {specs.map((s) => <DimensionLine key={s.id} spec={s} />)}
    </group>
  )
}
