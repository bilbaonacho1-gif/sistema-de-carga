/**
 * El depósito en 3D: piso, paredes (las curvas se arman con tramos cortos), columnas,
 * tabiques, portones, zonas libres y los racks. No es sólo para mirar: tocando cualquier cosa
 * se selecciona y arrastrándola se mueve sobre el piso (columnas, tabiques, zonas, portones a lo
 * largo de su pared, esquinas del contorno y racks). Arrastrar el fondo gira la cámara.
 */
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useMemo, useState } from 'react'
import * as THREE from 'three'
import { edges, nearestOnEdge, outlinePolygon, planBounds, pointOnEdge, tangentOnEdge } from '../../shared/plan/geometry'
import type { PlacedRack } from '../../shared/plan/depot'
import { moveVertex } from '../../shared/plan/edit'
import { placementRect } from '../../shared/plan/layout'
import { freezeRacks, moveRack } from '../../shared/plan/racks'
import type { Plan, PlanPoint, PlanSelection, RackPlacement } from '../../shared/plan/types'
import { RackModel } from '../three/RackModel'
import { usePlan } from './planStore'

const m = (mm: number) => mm / 1000
const RED = '#be1e30'

const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: '#d9dce0', roughness: 0.9, side: THREE.DoubleSide }),
  column: new THREE.MeshStandardMaterial({ color: '#7d838a', roughness: 0.7 }),
  inner: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.9 }),
  door: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5, metalness: 0.2 }),
  floor: new THREE.MeshStandardMaterial({ color: '#f7f7f5', roughness: 1 }),
  zone: new THREE.MeshStandardMaterial({ color: RED, transparent: true, opacity: 0.18 }),
  selected: new THREE.MeshStandardMaterial({ color: RED, roughness: 0.6, emissive: RED, emissiveIntensity: 0.25 }),
  zoneSelected: new THREE.MeshStandardMaterial({ color: RED, transparent: true, opacity: 0.4 }),
  handle: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
  /** Caja invisible para tocar un rack (más liviana que tocar cada pieza). */
  rackHit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  rackSelected: new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.14, depthWrite: false }),
  rackIssue: new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.3, depthWrite: false }),
}

/**
 * Paredes del contorno como UNA pieza continua: cada esquina se corta a inglete (como un marco),
 * así las curvas no muestran uniones ni superposiciones.
 */
function wallRingGeometry(poly: PlanPoint[], height: number, thickness: number): THREE.BufferGeometry {
  const n = poly.length
  const H = m(height), t = m(thickness) / 2
  const normal = (a: PlanPoint, b: PlanPoint) => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (a.y - b.y) / L, y: (b.x - a.x) / L } }
  // desplazamiento a cada lado de la pared en cada esquina (inglete, con tope en esquinas muy agudas)
  const off = poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p), n2 = normal(p, poly[(i + 1) % n])
    let mx = n1.x + n2.x, my = n1.y + n2.y
    const ml = Math.hypot(mx, my) || 1
    mx /= ml; my /= ml
    const k = Math.min(3, 1 / Math.max(0.2, mx * n1.x + my * n1.y))
    return { x: mx * k * t, y: my * k * t }
  })
  const P = (i: number, side: 1 | -1, top: boolean) => [m(poly[i].x) + side * off[i].x, top ? H : 0, m(poly[i].y) + side * off[i].y]
  const pos: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    quad(P(i, 1, false), P(j, 1, false), P(j, 1, true), P(i, 1, true))     // una cara
    quad(P(j, -1, false), P(i, -1, false), P(i, -1, true), P(j, -1, true))  // la otra
    quad(P(i, 1, true), P(j, 1, true), P(j, -1, true), P(i, -1, true))      // arriba
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/* ------------------------------ Arrastrar sobre el piso ------------------------------ */

/** Mueve algo con el puntero: recibe cuánto se corrió (mm del plano) desde que se lo tocó. */
type Apply = (dx: number, dy: number, free: boolean) => void

/**
 * Al tocar un objeto: se lo selecciona, se frena la cámara y, mientras se arrastra, se proyecta
 * el puntero sobre un plano horizontal a la altura donde se lo agarró (así acompaña a la mano).
 */
function useDrag() {
  const { camera, gl, controls } = useThree()
  return (select: PlanSelection, apply?: Apply) => ({
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const s = usePlan.getState()
      s.select(select)
      if (!apply) return
      const ctrl = controls as unknown as { enabled: boolean } | null
      if (ctrl) ctrl.enabled = false
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -e.point.y)
      const start = e.point.clone()
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3()
      let started = false
      const move = (ev: PointerEvent) => {
        const r = gl.domElement.getBoundingClientRect()
        ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
        ray.setFromCamera(ndc, camera)
        if (!ray.ray.intersectPlane(plane, hit)) return
        const dx = (hit.x - start.x) * 1000, dy = (hit.z - start.z) * 1000
        if (!started) { if (Math.hypot(dx, dy) < 30) return; usePlan.getState().begin(); started = true }
        apply(dx, dy, ev.altKey)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (ctrl) ctrl.enabled = true
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); gl.domElement.style.cursor = apply ? 'grab' : 'pointer' },
    onPointerOut: () => { gl.domElement.style.cursor = '' },
  })
}

/** Redondea a la grilla de 10 cm si el imán está prendido (Alt mueve libre). */
const snapTo = (v: number, free: boolean) => (usePlan.getState().snap && !free ? Math.round(v / 100) * 100 : Math.round(v))

/* ------------------------------ Racks ------------------------------ */

/**
 * Un rack ubicado: el modelo del cotizador arma la fila a lo largo de +X con el frente en z = 0 y
 * la profundidad hacia -z; se corre a su lugar y, si la fila va a lo largo del plano, se gira 90°.
 * Sólo se vuelve a dibujar si cambia su lugar o su estructura.
 */
const PlacedRackModel = memo(function PlacedRackModel({ rack, showLoads }: { rack: PlacedRack; showLoads: boolean }) {
  const { placement: p, structure } = rack
  const s = useMemo(() => (showLoads ? structure : { ...structure, pallets: [] }), [structure, showLoads])
  return p.orientation === 'x'
    ? <group position={[m(p.x), 0, m(p.y + p.depth)]}><RackModel structure={s} /></group>
    : <group position={[m(p.x), 0, m(p.y)]} rotation-y={-Math.PI / 2}><RackModel structure={s} /></group>
}, (a, b) => a.showLoads === b.showLoads && a.rack.structure === b.rack.structure
  && a.rack.placement.x === b.rack.placement.x && a.rack.placement.y === b.rack.placement.y
  && a.rack.placement.orientation === b.rack.placement.orientation && a.rack.placement.depth === b.rack.placement.depth)

/* ------------------------------ Escena ------------------------------ */

interface Props { plan: Plan; racks?: PlacedRack[]; showLoads?: boolean; issues?: Record<string, string> }

export function Plan3D(props: Props) {
  const { plan } = props
  // la cámara se ubica una sola vez: después la maneja el usuario (y no salta al mover cosas)
  const [view] = useState(() => {
    const b = planBounds(plan)
    const center = new THREE.Vector3(m((b.minX + b.maxX) / 2), 0, m((b.minY + b.maxY) / 2))
    return { center, span: Math.max(m(b.maxX - b.minX), m(b.maxY - b.minY), 5) }
  })
  const { center, span } = view
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 2000, position: [center.x + span * 0.7, span * 0.75, center.z + span * 1.05] }}
      onPointerMissed={() => usePlan.getState().select(null)}>
      <color attach="background" args={['#eef0f2']} />
      <hemisphereLight args={['#ffffff', '#cfd3d8', 1]} />
      <directionalLight position={[center.x + span, span * 1.5, center.z + span * 0.6]} intensity={1.4} castShadow shadow-bias={-0.0005} shadow-normalBias={0.05}
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
      <Grid position={[0, -0.002, 0]} infiniteGrid cellSize={1} sectionSize={5} cellColor="#dfe2e6" sectionColor="#c9cdd2" fadeDistance={span * 4} />
      <Scene {...props} span={span} />
      <OrbitControls makeDefault target={center} enableDamping maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} maxDistance={span * 6} />
    </Canvas>
  )
}

function Scene({ plan, racks = [], showLoads = true, issues = {}, span }: Props & { span: number }) {
  const selection = usePlan((s) => s.selection)
  const drag = useDrag()
  const live = usePlan((s) => s.live)
  const poly = useMemo(() => outlinePolygon(plan.outline, 300), [plan.outline])
  const ring = useMemo(() => wallRingGeometry(poly, plan.wallHeight, plan.wallThickness), [poly, plan.wallHeight, plan.wallThickness])
  const floor = useMemo(() => {
    // la figura se dibuja en XY y se acuesta: (x, y) del plano → (x, -y) para que quede en +z
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(m(p.x), -m(p.y))))
    return new THREE.ShapeGeometry(shape)
  }, [poly])
  const placements: RackPlacement[] = useMemo(() => racks.map((r) => r.placement), [racks])
  const isSel = (kind: string, id: string | number) => !!selection && selection.kind === kind && ('id' in selection ? selection.id : selection.index) === id
  const es = edges(plan.outline)
  const handle = Math.max(0.18, span * 0.006)

  return (
    <>
      <mesh geometry={floor} material={MAT.floor} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow />

      {/* paredes del contorno */}
      <mesh geometry={ring} material={MAT.wall} castShadow />

      {/* esquinas del contorno: se arrastran para cambiar la forma del depósito */}
      {plan.outline.points.map((p, i) => (
        <mesh key={`v${i}`} position={[m(p.x), m(plan.wallHeight) + handle * 0.6, m(p.y)]} material={isSel('vertex', i) ? MAT.selected : MAT.handle}
          {...drag({ kind: 'vertex', index: i }, (dx, dy, free) => live((pl) => moveVertex(pl, i, { x: snapTo(p.x + dx, free), y: snapTo(p.y + dy, free) })))}>
          <cylinderGeometry args={[handle, handle, handle * 1.2, 20]} />
        </mesh>
      ))}

      {/* portones: un panel amarillo sobre la pared; se corren a lo largo de ella */}
      {plan.doors.map((d) => {
        const e = es[d.edge]
        if (!e) return null
        const c = pointOnEdge(e, d.t)
        const t = tangentOnEdge(e, d.t)
        return (
          <mesh key={d.id} material={isSel('door', d.id) ? MAT.selected : MAT.door} position={[m(c.x), m(d.height) / 2, m(c.y)]} rotation-y={-Math.atan2(t.y, t.x)}
            {...drag({ kind: 'door', id: d.id }, (dx, dy) => live((pl) => ({
              ...pl, doors: pl.doors.map((x) => (x.id === d.id ? { ...x, t: nearestOnEdge(edges(pl.outline)[x.edge], { x: c.x + dx, y: c.y + dy }).t } : x)),
            })))}>
            <boxGeometry args={[m(d.width), m(d.height), m(plan.wallThickness) * 1.4]} />
          </mesh>
        )
      })}

      {/* tabiques */}
      {plan.walls.map((w) => {
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
        if (len < 1) return null
        const h = Math.min(plan.wallHeight, 3000)
        return (
          <mesh key={w.id} material={isSel('wall', w.id) ? MAT.selected : MAT.inner} position={[m((w.a.x + w.b.x) / 2), m(h) / 2, m((w.a.y + w.b.y) / 2)]}
            rotation-y={-Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x)} castShadow receiveShadow
            {...drag({ kind: 'wall', id: w.id }, (dx, dy, free) => live((pl) => ({
              ...pl, walls: pl.walls.map((x) => {
                if (x.id !== w.id) return x
                const ax = snapTo(w.a.x + dx, free), ay = snapTo(w.a.y + dy, free)
                return { ...x, a: { x: ax, y: ay }, b: { x: w.b.x + ax - w.a.x, y: w.b.y + ay - w.a.y } }
              }),
            })))}>
            <boxGeometry args={[m(len) + m(w.thickness) * 0.5, m(h), m(w.thickness)]} />
          </mesh>
        )
      })}

      {/* columnas */}
      {plan.columns.map((c) => (
        <mesh key={c.id} material={isSel('column', c.id) ? MAT.selected : MAT.column} position={[m(c.x), m(plan.wallHeight) / 2, m(c.y)]} castShadow
          {...drag({ kind: 'column', id: c.id }, (dx, dy, free) => live((pl) => ({
            ...pl, columns: pl.columns.map((x) => (x.id === c.id ? { ...x, x: snapTo(c.x + dx, free), y: snapTo(c.y + dy, free) } : x)),
          })))}>
          {c.shape === 'round'
            ? <cylinderGeometry args={[m(c.w) / 2, m(c.w) / 2, m(plan.wallHeight), 24]} />
            : <boxGeometry args={[m(c.w), m(plan.wallHeight), m(c.d)]} />}
        </mesh>
      ))}

      {/* zonas libres */}
      {plan.zones.map((z) => (
        <mesh key={z.id} material={isSel('zone', z.id) ? MAT.zoneSelected : MAT.zone} rotation-x={-Math.PI / 2} position={[m(z.x + z.w / 2), 0.01, m(z.y + z.d / 2)]}
          {...drag({ kind: 'zone', id: z.id }, (dx, dy, free) => live((pl) => ({
            ...pl, zones: pl.zones.map((x) => (x.id === z.id ? { ...x, x: snapTo(z.x + dx, free), y: snapTo(z.y + dy, free) } : x)),
          })))}>
          <planeGeometry args={[m(z.w), m(z.d)]} />
        </mesh>
      ))}

      {/* racks: el modelo y, encima, una caja invisible para tocarlo y arrastrarlo */}
      {racks.map((r) => <PlacedRackModel key={r.placement.id} rack={r} showLoads={showLoads} />)}
      {racks.map(({ placement: p, structure }) => {
        const b = placementRect(p)
        const H = m(structure.config.height) + 0.02
        const mat = isSel('rack', p.id) ? MAT.rackSelected : issues[p.id] ? MAT.rackIssue : MAT.rackHit
        return (
          <mesh key={`hit-${p.id}`} material={mat} position={[m(b.x + b.w / 2), H / 2, m(b.y + b.h / 2)]}
            {...drag({ kind: 'rack', id: p.id }, (dx, dy, free) => live((pl) => moveRack(freezeRacks(pl, placements), p.id, snapTo(p.x + dx, free), snapTo(p.y + dy, free))))}>
            <boxGeometry args={[m(b.w) + 0.04, H, m(b.h) + 0.04]} />
          </mesh>
        )
      })}
    </>
  )
}
