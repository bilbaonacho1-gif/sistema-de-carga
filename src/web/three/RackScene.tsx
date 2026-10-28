import { Environment, Grid, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RackStructure } from '../../shared/rack/types'
import type { CameraView } from './types'
import { CameraRig, structureBounds } from './CameraRig'
import { Dimensions } from './Dimensions'
import { LabelProjector, sceneLabels } from './labels'
import { m } from './materials'
import { RackModel } from './RackModel'

const BG = '#f2f3f5'

interface Props {
  structure: RackStructure
  showDimensions?: boolean
  view?: CameraView
  viewRequest?: number
  /** false = vista de presentación (pantalla inicial): gira sola, sin zoom ni paneo. */
  interactive?: boolean
  /** Se llama cuando el usuario mueve la cámara a mano. */
  onUserControl?: () => void
}

export function RackScene({ structure, showDimensions = false, view = 'iso', viewRequest = 0, interactive = true, onUserControl }: Props) {
  const labels = useMemo(() => sceneLabels(structure, showDimensions, view), [structure, showDimensions, view])
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 35, near: 0.05, far: 800, position: [10, 7, 12] }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[BG]} />
      <hemisphereLight args={['#ffffff', '#d5d8dc', 0.85]} />
      <KeyLight structure={structure} />
      {/* reflejos del galvanizado: entorno armado con paneles de luz (no descarga HDRI) */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2.2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer intensity={1.2} position={[-8, 2, 4]} rotation-y={Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer intensity={1.6} position={[8, 3, 6]} rotation-y={-Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer intensity={0.6} color="#ffe9e9" position={[0, 1, -10]} scale={[20, 3, 1]} />
      </Environment>

      <Floor />
      <WarehouseOutline structure={structure} />
      <RackModel structure={structure} />
      {showDimensions && <Dimensions structure={structure} view={view} />}
      <LabelProjector labels={labels} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2 - 0.01}
        minDistance={1.2}
        maxDistance={250}
        screenSpacePanning
        autoRotate={!interactive}
        autoRotateSpeed={0.5}
        enableZoom={interactive}
        enablePan={interactive}
        enableRotate={interactive}
      />
      <CameraRig structure={structure} view={view} viewRequest={viewRequest} withDimensions={showDimensions} onUserControl={onUserControl} />
    </Canvas>
  )
}

/** Luz principal con sombras, ajustada al tamaño de la estructura. */
function KeyLight({ structure }: { structure: RackStructure }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  const box = useMemo(() => structureBounds(structure), [structure])

  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2 + 1
    l.position.copy(center).add(new THREE.Vector3(0.25, 1, 0.35).normalize().multiplyScalar(radius * 2))
    l.target.position.copy(center)
    scene.add(l.target)
    const cam = l.shadow.camera
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius
    cam.near = 0.1; cam.far = radius * 4
    cam.updateProjectionMatrix()
    l.shadow.mapSize.set(radius > 25 ? 4096 : 2048, radius > 25 ? 4096 : 2048)
    l.shadow.map?.dispose()
    l.shadow.map = null
    return () => { scene.remove(l.target) }
  }, [box, scene])

  return <directionalLight ref={light} intensity={1.6} castShadow shadow-bias={-0.0004} shadow-normalBias={0.02} />
}

function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <shadowMaterial transparent opacity={0.09} />
      </mesh>
      <Grid
        position={[0, 0.001, 0]}
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor="#dfe2e6"
        sectionColor="#c9cdd2"
        fadeDistance={70}
        fadeStrength={1.5}
      />
    </group>
  )
}

/** Contorno del depósito (si el usuario cargó sus medidas). */
function WarehouseOutline({ structure }: { structure: RackStructure }) {
  const { warehouseLength, warehouseWidth, aisleWidth } = structure.config.layout
  if (!warehouseLength || !warehouseWidth) return null
  const x0 = -0.5
  const z0 = m(aisleWidth)
  const L = m(warehouseLength)
  const W = m(warehouseWidth)
  const pts: [number, number, number][] = [[x0, 0.01, z0], [x0 + L, 0.01, z0], [x0 + L, 0.01, z0 - W], [x0, 0.01, z0 - W], [x0, 0.01, z0]]
  // el rótulo "DEPÓSITO …" lo dibuja la capa HTML (ver labels.tsx)
  return <Line points={pts} color="#b82134" lineWidth={1.5} dashed dashSize={0.4} gapSize={0.25} />

}
