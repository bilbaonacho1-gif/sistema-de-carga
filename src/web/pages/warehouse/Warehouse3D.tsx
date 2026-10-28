/**
 * Almacén en 3D: cada rack se arma con la misma geometría del Diseñador (parantes
 * perforados, vigas, conectores, protectores) y cada posición muestra su estado.
 * Tocar un rack o una posición la selecciona (mismo panel que el plano).
 */
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { calculateRackStructure } from '../../../shared/rack/calculateRackStructure'
import type { RackPosition, RackSummary, WarehouseMap } from '../../../shared/types'
import { DESIGN_RULES } from '../../../shared/rack/technicalSpecs'
import {
  basePlateGeometry, beamGeometry, bracingGeometry, connectorGeometry, palletGeometry, protectorGeometry,
} from '../../three/geometry/parts'
import { uprightGeometry } from '../../three/geometry/upright'
import { bindLabel, LabelProjector, type SceneLabel } from '../../three/labels'
import { MATERIALS, m } from '../../three/materials'

const STATUS_MAT = {
  disponible: MATERIALS.cardboard,
  parcial: new THREE.MeshStandardMaterial({ color: '#9cc3e2', roughness: 0.8 }),
  reservado: new THREE.MeshStandardMaterial({ color: '#2f80c0', roughness: 0.7 }),
  libre: new THREE.MeshBasicMaterial({ color: '#2e6a8e', transparent: true, opacity: 0.07, depthWrite: false }),
}
const SELECTED_MAT = new THREE.MeshStandardMaterial({ color: '#ed1b24', emissive: '#7a0d14', roughness: 0.6 })
const RACK_HL = new THREE.MeshBasicMaterial({ color: '#be1e30', transparent: true, opacity: 0.16, depthWrite: false })
const ZONE_MAT = new THREE.MeshBasicMaterial({ color: '#e0a100', transparent: true, opacity: 0.16, depthWrite: false })
const AISLE_MAT = new THREE.MeshBasicMaterial({ color: '#f2c94c', transparent: true, opacity: 0.35, depthWrite: false })
const loadBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)

interface Props {
  map: WarehouseMap
  positions: RackPosition[]
  selectedRack: number | null
  selectedPosition: string | null
  onRack(id: number): void
  onPosition(rackId: number, code: string): void
}

export default function Warehouse3D(props: Props) {
  const { map } = props
  const L = m(map.warehouse.lengthMm)
  const W = m(map.warehouse.widthMm)
  const labels = useMemo<SceneLabel[]>(() => [
    ...map.zones.map((z) => ({ id: `zone-${z.code}`, kind: 'warehouse' as const, position: [m(z.x + z.w / 2), 0.05, m(z.y + z.h / 2)] as [number, number, number], text: z.name.toUpperCase() })),
    ...map.aisles.map((a) => {
      const rs = map.racks.filter((r) => r.aisle === a.aisle)
      const x = (Math.min(...rs.map((r) => r.x)) + Math.max(...rs.map((r) => r.x + r.lengthMm))) / 2
      return { id: `aisle-${a.aisle}`, kind: 'warehouse' as const, position: [m(x), 0.05, m(Math.min(...rs.map((r) => r.y)) - 1500)] as [number, number, number], text: `PASILLO ${a.aisle}` }
    }),
  ], [map])

  return (
    <div className="wh3d">
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 400, position: [L * 0.42, 27, W + 9] }}>
        <color attach="background" args={['#f2f3f5']} />
        <hemisphereLight args={['#ffffff', '#d5d8dc', 0.9]} />
        <Sun L={L} W={W} />
        <Environment resolution={256} frames={1}>
          <Lightformer intensity={2.2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
          <Lightformer intensity={1.4} position={[-10, 3, 6]} rotation-y={Math.PI / 2} scale={[16, 4, 1]} />
          <Lightformer intensity={1.4} position={[10, 3, 8]} rotation-y={-Math.PI / 2} scale={[16, 4, 1]} />
        </Environment>

        {/* piso de la nave y zonas */}
        <mesh rotation-x={-Math.PI / 2} position={[L / 2, 0, W / 2]} receiveShadow>
          <planeGeometry args={[L, W]} />
          <meshStandardMaterial color="#e9ebee" roughness={0.95} />
        </mesh>
        <lineSegments position={[L / 2, 0.01, W / 2]} rotation-x={-Math.PI / 2}>
          <edgesGeometry args={[new THREE.PlaneGeometry(L, W)]} />
          <lineBasicMaterial color="#353535" />
        </lineSegments>
        {map.zones.map((z) => (
          <mesh key={z.id} rotation-x={-Math.PI / 2} position={[m(z.x + z.w / 2), 0.012, m(z.y + z.h / 2)]} material={ZONE_MAT}>
            <planeGeometry args={[m(z.w), m(z.h)]} />
          </mesh>
        ))}
        {/* demarcación amarilla de los pasillos */}
        {map.aisles.map((a) => {
          const rs = map.racks.filter((r) => r.aisle === a.aisle)
          const x0 = Math.min(...rs.map((r) => r.x))
          const x1 = Math.max(...rs.map((r) => r.x + r.lengthMm))
          const y = Math.min(...rs.map((r) => r.y))
          return [0.12, 2.88].map((k) => (
            <mesh key={`${a.aisle}-${k}`} rotation-x={-Math.PI / 2} position={[m((x0 + x1) / 2), 0.014, m(y) - 3 + k]} material={AISLE_MAT}>
              <planeGeometry args={[m(x1 - x0), 0.1]} />
            </mesh>
          ))
        })}

        {map.racks.map((r) => (
          <Rack3D key={r.id} rack={r} positions={props.positions.filter((p) => p.rackId === r.id)}
            selected={props.selectedRack === r.id} selectedPosition={props.selectedPosition}
            onRack={props.onRack} onPosition={props.onPosition} />
        ))}

        <OrbitControls makeDefault target={[L / 2, 1.5, W / 2]} maxPolarAngle={Math.PI / 2 - 0.03} minDistance={3} maxDistance={90} enableDamping dampingFactor={0.08} screenSpacePanning={false} />
        <LabelProjector labels={labels} />
      </Canvas>
      <div className="label-layer" aria-hidden="true">
        {labels.map((l) => l.kind === 'warehouse' && <div key={l.id} ref={bindLabel(l.id)} className="warehouse-label warehouse-label--3d">{l.text}</div>)}
      </div>
      <ul className="legend legend--3d" aria-label="Referencias">
        <li><span className="legend__sw" style={{ background: '#bf8f5c' }} />Ocupada</li>
        <li><span className="legend__sw" style={{ background: '#2f80c0' }} />Reservada</li>
        <li><span className="legend__sw" style={{ background: '#9cc3e2' }} />Reserva parcial</li>
        <li><span className="legend__sw legend__sw--free" />Libre</li>
      </ul>
    </div>
  )
}

function Sun({ L, W }: { L: number; W: number }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const l = light.current!
    l.position.set(L / 2 + 8, 26, W / 2 + 12)
    l.target.position.set(L / 2, 0, W / 2)
    scene.add(l.target)
    const cam = l.shadow.camera
    const r = Math.max(L, W) * 0.75
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 90
    cam.updateProjectionMatrix()
    l.shadow.mapSize.set(2048, 2048)
    return () => { scene.remove(l.target) }
  }, [L, W, scene])
  return <directionalLight ref={light} intensity={1.5} castShadow shadow-bias={-0.0004} shadow-normalBias={0.03} />
}

/** Un rack del almacén: estructura estática + una caja por posición. */
function Rack3D({ rack, positions, selected, selectedPosition, onRack, onPosition }: {
  rack: RackSummary; positions: RackPosition[]; selected: boolean; selectedPosition: string | null
  onRack(id: number): void; onPosition(rackId: number, code: string): void
}) {
  const s = useMemo(() => calculateRackStructure(rack.config), [rack.config])
  const row = s.rows[0]
  const D = m(s.config.depth)
  const W = m(s.config.width)
  const bh = m(s.beam.height)
  const bd = m(s.beam.depth)
  const geo = useMemo(() => ({
    upright: uprightGeometry(s.upright, s.config.height),
    brace: bracingGeometry(s.upright, s.config.height, s.config.depth),
    plate: basePlateGeometry(s.upright),
    protector: protectorGeometry(s.upright),
    beam: beamGeometry(s.beam),
    left: connectorGeometry(-1, s.upright, s.beam),
    right: connectorGeometry(1, s.upright, s.beam),
    pallet: palletGeometry(s.pallet),
  }), [s])
  const byKey = useMemo(() => new Map(positions.map((p) => [`${p.module}-${p.level}-${p.slot}`, p])), [positions])
  const isClick = (e: ThreeEvent<MouseEvent>) => e.delta < 6

  // el frente del rack mira al pasillo (hacia -Z en el plano): se gira 180° y se corre su largo
  return (
    <group
      position={[m(rack.x + rack.lengthMm), 0, m(rack.y)]}
      rotation-y={Math.PI}
      onClick={(e) => { if (!isClick(e)) return; e.stopPropagation(); onRack(rack.id) }}
    >
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[m(rack.lengthMm) / 2, 0.02, -D / 2]} material={RACK_HL}>
          <planeGeometry args={[m(rack.lengthMm) + 0.5, D + 0.5]} />
        </mesh>
      )}
      {row.frames.map((f) => (
        <group key={f.id} position={[m(f.x), 0, 0]}>
          <mesh geometry={geo.upright} material={MATERIALS.galvanized} castShadow />
          <mesh geometry={geo.upright} material={MATERIALS.galvanized} position={[0, 0, -D]} rotation-y={Math.PI} castShadow />
          <mesh geometry={geo.brace} material={MATERIALS.brace} />
          <mesh geometry={geo.plate} material={MATERIALS.painted} />
          <mesh geometry={geo.plate} material={MATERIALS.painted} position={[0, 0, -D]} rotation-y={Math.PI} />
          {DESIGN_RULES.protectorRule !== 'none' && <mesh geometry={geo.protector} material={MATERIALS.painted} />}
        </group>
      ))}
      {row.modules.map((mod) => s.levels.filter((lv) => lv.hasBeam).map((lv) => (
        <group key={`${mod.id}-${lv.index}`} position={[m(mod.xStart), m(lv.elevation), 0]}>
          <mesh geometry={geo.beam} material={MATERIALS.red} position={[W / 2, -bh / 2, -(bd / 2 - 0.005)]} scale={[W - 0.01, 1, 1]} castShadow />
          <mesh geometry={geo.beam} material={MATERIALS.red} position={[W / 2, -bh / 2, -D + (bd / 2 - 0.005)]} scale={[W - 0.01, 1, 1]} castShadow />
          <mesh geometry={geo.left} material={MATERIALS.painted} />
          <mesh geometry={geo.right} material={MATERIALS.painted} position={[W, 0, 0]} />
          <mesh geometry={geo.right} material={MATERIALS.painted} position={[0, 0, -D]} rotation-y={Math.PI} />
          <mesh geometry={geo.left} material={MATERIALS.painted} position={[W, 0, -D]} rotation-y={Math.PI} />
        </group>
      )))}
      {s.positions.filter((p) => p.row === 0).map((p) => {
        const pos = byKey.get(`${p.module + 1}-${p.level + 1}-${p.slot + 1}`)
        if (!pos) return null
        const lv = s.levels[p.level]
        const h = m(Math.max(lv.loadHeight, 400))
        const isSel = selectedPosition === pos.code
        const mat = isSel ? SELECTED_MAT : STATUS_MAT[pos.status]
        const click = (e: ThreeEvent<MouseEvent>) => { if (!isClick(e)) return; e.stopPropagation(); onPosition(rack.id, pos.code) }
        return (
          <group key={pos.id} position={[m(p.x), m(p.elevation), -D / 2]}>
            {pos.status !== 'libre' && <mesh geometry={geo.pallet} material={MATERIALS.wood} castShadow />}
            <mesh
              geometry={loadBox}
              material={mat}
              position={[0, pos.status === 'libre' ? 0.02 : m(s.pallet.height), 0]}
              scale={[m(s.pallet.front) - 0.04, pos.status === 'libre' ? h * 0.85 : h, m(s.pallet.deep) - 0.1]}
              castShadow={pos.status !== 'libre'}
              onClick={click}
              onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { document.body.style.cursor = '' }}
            />
          </group>
        )
      })}
    </group>
  )
}
