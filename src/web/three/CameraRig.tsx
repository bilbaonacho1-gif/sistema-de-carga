/**
 * Cámara: vistas predefinidas (frontal, lateral, superior, 3D) encuadradas a la
 * estructura. Cuando la estructura cambia de tamaño, la cámara la acompaña
 * manteniendo el ángulo que eligió el usuario. Si el usuario toma el control,
 * la animación se cancela.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RackStructure } from '../../shared/rack/types'
import type { CameraPreset, CameraView } from './types'
import { expandForDimensions } from './dimensionsModel'
import { m } from './materials'

/** Lo mínimo que usamos de OrbitControls. */
interface ControlsLike {
  target: THREE.Vector3
  update(): void
  addEventListener(type: 'start', fn: () => void): void
  removeEventListener(type: 'start', fn: () => void): void
}

const DIRECTIONS: Record<CameraPreset, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.1, 1).normalize(),
  side: new THREE.Vector3(1, 0.1, 0).normalize(),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  iso: new THREE.Vector3(0.95, 0.6, 1.15).normalize(),
}

/** Caja que envuelve toda la estructura (en metros). */
export function structureBounds(s: RackStructure): THREE.Box3 {
  const zs = s.rows.flatMap((r) => (r.facing === 1 ? [r.zFront, r.zFront - s.config.depth] : [r.zFront, r.zFront + s.config.depth]))
  return new THREE.Box3(
    new THREE.Vector3(-0.2, 0, m(Math.min(...zs)) - 0.15),
    new THREE.Vector3(m(s.totalWidth) + 0.2, m(s.totalHeight), m(Math.max(...zs)) + 0.25),
  )
}

/** Distancia para que la caja entre completa en pantalla mirando desde `dir`. */
function fitDistance(box: THREE.Box3, dir: THREE.Vector3, camera: THREE.PerspectiveCamera, margin: number) {
  const center = box.getCenter(new THREE.Vector3())
  const fwd = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
  right.normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const tanH = tanV * camera.aspect
  let dist = 0
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center)
    const along = p.dot(dir)   // hacia la cámara
    dist = Math.max(dist, along + Math.abs(p.dot(right)) / tanH, along + Math.abs(p.dot(up)) / tanV)
  }
  return dist * margin
}

interface Props {
  structure: RackStructure
  view: CameraView
  viewRequest: number
  /** Margen del encuadre (>1 deja aire alrededor). */
  margin?: number
  /** Si se muestran las cotas, el encuadre las incluye. */
  withDimensions?: boolean
  /** Se llama cuando el usuario mueve la cámara a mano. */
  onUserControl?: () => void
}

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Diferencia angular por el camino más corto (para no dar la vuelta larga). */
const shortest = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function CameraRig({ structure, view, viewRequest, margin = 1.08, withDimensions = false, onUserControl }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const size = useThree((s) => s.size)
  // destino en coordenadas esféricas (distancia, elevación, azimut) alrededor del punto mirado:
  // así la cámara orbita limpio entre vistas en vez de cortar camino por el medio
  const goal = useRef<{ target: THREE.Vector3; sph: THREE.Spherical } | null>(null)
  const box = useMemo(() => {
    const b = structureBounds(structure)
    return withDimensions ? expandForDimensions(b, structure) : b
  }, [structure, withDimensions])
  const first = useRef(true)

  const frame = (dir: THREE.Vector3) => {
    const target = box.getCenter(new THREE.Vector3())
    const dist = fitDistance(box, dir, camera, margin)
    goal.current = { target, sph: new THREE.Spherical().setFromVector3(dir.clone().multiplyScalar(dist)) }
  }

  const jump = () => {
    const g = goal.current
    if (!g || !controls) return
    controls.target.copy(g.target)
    camera.position.copy(g.target).add(new THREE.Vector3().setFromSpherical(g.sph))
    controls.update()
    goal.current = null
  }

  // vista pedida desde la barra de herramientas
  useEffect(() => {
    if (view === 'free') return
    frame(DIRECTIONS[view])
    if ((first.current || reducedMotion) && controls) {
      jump()                    // primera vez (o sin animaciones): ubicar directo
      first.current = false
    }
  }, [viewRequest, controls])

  // la estructura cambió de tamaño: re-encuadrar con el ángulo actual
  useEffect(() => {
    if (!controls || first.current) return
    frame(camera.position.clone().sub(controls.target).normalize())
    if (reducedMotion) jump()
  }, [box, size.width, size.height])

  // si el usuario arrastra o hace zoom, se cancela la animación
  useEffect(() => {
    if (!controls) return
    const cancel = () => {
      goal.current = null
      onUserControl?.()
    }
    controls.addEventListener('start', cancel)
    return () => controls.removeEventListener('start', cancel)
  }, [controls, onUserControl])

  useFrame((_, dt) => {
    const g = goal.current
    if (!g || !controls) return
    const k = 1 - Math.exp(-4.5 * Math.min(dt, 0.05))
    const cur = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
    const dTheta = shortest(g.sph.theta - cur.theta)
    cur.radius += (g.sph.radius - cur.radius) * k
    cur.phi += (g.sph.phi - cur.phi) * k
    cur.theta += dTheta * k
    controls.target.lerp(g.target, k)
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(cur))
    controls.update()
    const done = Math.abs(g.sph.radius - cur.radius) < 0.01 && Math.abs(g.sph.phi - cur.phi) < 0.002
      && Math.abs(dTheta) < 0.002 && controls.target.distanceTo(g.target) < 0.01
    if (done) jump()
  })

  return null
}
