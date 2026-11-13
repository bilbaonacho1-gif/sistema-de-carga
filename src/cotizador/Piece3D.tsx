/**
 * LA PIEZA SOLA EN 3D: un tramo de 1 m de la viga o del parante, para girarlo y mirarlo de todos
 * lados (arrastrar gira, la rueda acerca). Es la misma pieza que después se ve en los racks.
 */
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ObjectShape } from '../shared/plan/types'
import type { BeamProfile, UprightProfile } from '../shared/rack/types'
import { beamGeometry } from '../web/three/geometry/parts'
import { uprightGeometry } from '../web/three/geometry/upright'
import { MATERIALS } from '../web/three/materials'

export function Piece3D({ beam, upright }: { beam?: BeamProfile; upright?: UprightProfile }) {
  const geo = useMemo(() => (beam ? beamGeometry(beam) : upright ? uprightGeometry(upright, 1000) : null), [beam, upright])
  if (!geo) return null
  // la viga va acostada (1 m sobre X); el parante parado (1 m de alto)
  const size = beam ? Math.max(beam.height, beam.depth) / 1000 : Math.max(upright!.faceWidth, upright!.depth) / 1000
  const lift = beam ? beam.height / 2000 + 0.002 : 0
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 35, near: 0.01, far: 50, position: beam ? [1.25, 0.8, 1.55] : [1.5, 1.35, 1.9] }}>
      <color attach="background" args={['#f2f3f5']} />
      <hemisphereLight args={['#ffffff', '#c9cdd2', 1.1]} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} castShadow />
      <directionalLight position={[-2, 1.5, -1.5]} intensity={0.5} />
      <Grid position={[0, 0, 0]} infiniteGrid cellSize={0.1} sectionSize={0.5} cellColor="#dfe2e6" sectionColor="#c9cdd2" fadeDistance={8} />
      {beam
        ? <mesh geometry={geo} material={MATERIALS.red} position={[0, lift, 0]} castShadow />
        : <mesh geometry={geo} material={MATERIALS.galvanized} position={[0, 0, upright!.depth / 2000]} castShadow />}
      <OrbitControls makeDefault enableDamping target={beam ? [0, lift, 0] : [0, 0.5, 0]} minDistance={Math.max(0.15, size * 1.5)} maxDistance={6} />
    </Canvas>
  )
}

/** Un objeto propio (caja o cilindro) solo, para girarlo y ver cómo queda. */
export function Object3D({ o }: { o: ObjectShape }) {
  const w = o.w / 1000, d = (o.shape === 'cilindro' ? o.w : o.d) / 1000, h = o.h / 1000
  const size = Math.max(w, d, h)
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.7, metalness: 0.1 }), [o.color])
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 35, near: 0.01, far: 500, position: [size * 1.5, size * 1.2 + h / 2, size * 1.9] }} key={Math.round(size * 2)}>
      <color attach="background" args={['#f2f3f5']} />
      <hemisphereLight args={['#ffffff', '#c9cdd2', 1.1]} />
      <directionalLight position={[size * 2, size * 3, size * 2]} intensity={1.6} castShadow />
      <Grid position={[0, 0, 0]} infiniteGrid cellSize={size > 4 ? 1 : 0.1} sectionSize={size > 4 ? 5 : 0.5} cellColor="#dfe2e6" sectionColor="#c9cdd2" fadeDistance={size * 12} />
      <mesh material={mat} position={[0, h / 2, 0]} castShadow>
        {o.shape === 'cilindro' ? <cylinderGeometry args={[w / 2, w / 2, h, 40]} /> : <boxGeometry args={[w, h, d]} />}
      </mesh>
      <OrbitControls makeDefault enableDamping target={[0, h / 2, 0]} minDistance={size * 0.6} maxDistance={size * 8} />
    </Canvas>
  )
}
