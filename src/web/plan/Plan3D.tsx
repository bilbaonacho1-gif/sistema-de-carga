/**
 * El depósito en 3D: piso, paredes (las curvas se arman con tramos cortos), columnas,
 * tabiques, portones, zonas libres, zonas de racks, pasillos marcados y los racks. No es sólo para mirar: tocando cualquier cosa
 * se selecciona y arrastrándola se mueve sobre el piso (columnas, tabiques, zonas, portones a lo
 * largo de su pared, esquinas del contorno y racks). Arrastrar el fondo gira la cámara.
 */
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { edges, nearestOnEdge, outlinePolygon, planBounds, pointOnEdge, tangentOnEdge } from '../../shared/plan/geometry'
import type { PlacedRack } from '../../shared/plan/depot'
import { moveVertex, updateRect, newId } from '../../shared/plan/edit'
import { placementRect, type RackModuleSize } from '../../shared/plan/layout'
import { freezeRacks, moveRack, moveRackWithin, rackSelection, selectedRackIds } from '../../shared/plan/racks'
import type { Plan, PlanPoint, PlanSelection, RackPlacement } from '../../shared/plan/types'
import { fmt } from '../lib/format'
import { RackModel, RackPickContext, type PickedPart } from '../three/RackModel'
import { RackInstances, type InstanceStats } from './RackInstances'
import { EYE_HEIGHT, Forklift, Person } from './Figures'
import { usePlan } from './planStore'
import { useDock } from '../components/dock'

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
  area: new THREE.MeshBasicMaterial({ color: '#2f6fb8', transparent: true, opacity: 0.08, depthWrite: false }),
  areaSelected: new THREE.MeshBasicMaterial({ color: '#2f6fb8', transparent: true, opacity: 0.2, depthWrite: false }),
  aisle: new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.6, depthWrite: false }),
  aisleSelected: new THREE.MeshBasicMaterial({ color: '#e0a100', transparent: true, opacity: 0.85, depthWrite: false }),
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
      const s = usePlan.getState()
      // caminando a pie no se agarra ni se mueve nada: sólo se mira
      if (s.walk) return
      e.stopPropagation()
      // Shift / Ctrl + clic en un rack: lo suma o lo saca de la selección (sin moverlo)
      if (select?.kind === 'rack' && (e.shiftKey || e.ctrlKey || e.metaKey || s.multi)) {
        const cur = selectedRackIds(s.selection)
        s.select(rackSelection(cur.includes(select.id) ? cur.filter((x) => x !== select.id) : [...cur, select.id]))
        return
      }
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

/** Redondea al imán elegido (1 m por defecto) si está prendido (Alt mueve libre). */
const snapTo = (v: number, free: boolean) => {
  const { snap, snapStep } = usePlan.getState()
  return snap && !free ? Math.round(v / snapStep) * snapStep : Math.round(v)
}

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

interface Props { plan: Plan; racks?: PlacedRack[]; showLoads?: boolean; issues?: Record<string, string>; size?: RackModuleSize }

/** A partir de esta cantidad de racks se dibujan en lote (InstancedMesh) en vez de pieza por pieza. */
const MANY_RACKS = 30

export function Plan3D(props: Props) {
  const { plan } = props
  // la cámara se ubica una sola vez: después la maneja el usuario (y no salta al mover cosas)
  const [view] = useState(() => {
    const b = planBounds(plan)
    const center = new THREE.Vector3(m((b.minX + b.maxX) / 2), 0, m((b.minY + b.maxY) / 2))
    return { center, span: Math.max(m(b.maxX - b.minX), m(b.maxY - b.minY), 5) }
  })
  const { center, span } = view
  const [stats, setStats] = useState<InstanceStats | null>(null)
  const zoomRef = useRef<((k: number) => void) | null>(null)
  const many = (props.racks?.length ?? 0) > MANY_RACKS
  const walking = usePlan((s) => !!s.walk)
  useEffect(() => { if (!many) setStats(null) }, [many])
  return (
    <div className="plan3d">
    {/* frameloop "demand": se dibuja sólo cuando algo cambia o se mueve la cámara (depósitos grandes) */}
    <Canvas shadows frameloop="demand" dpr={[1, many ? 1.25 : 2]} camera={{ fov: 40, near: 0.1, far: Math.max(2000, span * 10), position: [center.x + span * 0.7, span * 0.75, center.z + span * 1.05] }}
      onPointerMissed={() => { const s = usePlan.getState(); s.select(null); s.setPiece(null) }}>
      <color attach="background" args={['#eef0f2']} />
      <hemisphereLight args={['#ffffff', '#cfd3d8', 1]} />
      <directionalLight position={[center.x + span, span * 1.5, center.z + span * 0.6]} intensity={1.4} castShadow shadow-bias={-0.0005} shadow-normalBias={0.05}
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
      <Grid position={[0, -0.002, 0]} infiniteGrid cellSize={1} sectionSize={5} cellColor="#dfe2e6" sectionColor="#c9cdd2" fadeDistance={span * 4} />
      <Scene {...props} span={span} onStats={setStats} />
      <OrbitControls makeDefault target={center} enableDamping maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} maxDistance={span * 6} />
      <WalkControls center={center} span={span} />
      <ZoomBridge zoomRef={zoomRef} min={2} max={span * 6} />
      <IsolateCamera racks={props.racks} center={center} span={span} />
    </Canvas>
    {!walking && <div className="zoom-btns" role="group" aria-label="Zoom">
      <button type="button" onClick={() => zoomRef.current?.(1 / 1.4)} aria-label="Acercar" title="Acercar">+</button>
      <button type="button" onClick={() => zoomRef.current?.(1.4)} aria-label="Alejar" title="Alejar">−</button>
    </div>}
    {stats && (
      <div className="plan3d__stats" aria-live="polite">
        {fmt(stats.racks)} racks · {fmt(stats.pieces)} piezas{stats.detail !== 'completo' && <> · vista {stats.detail === 'medio' ? 'simplificada' : 'sólo estructura'} para que no se trabe</>}
      </div>
    )}
    </div>
  )
}

function Scene({ plan, racks = [], showLoads = true, issues = {}, size, span, onStats }: Props & { span: number; onStats(s: InstanceStats): void }) {
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
  // "ver solo este": se dibujan sólo los racks aislados (los cambios se siguen haciendo sobre todos)
  const isolate = usePlan((s) => s.isolate)
  const shown = useMemo(() => {
    if (!isolate) return racks
    const ids = new Set(isolate)
    const only = racks.filter((r) => ids.has(r.placement.id))
    return only.length ? only : racks
  }, [racks, isolate])
  const shownPlacements = useMemo(() => shown.map((r) => r.placement), [shown])
  const isSel = (kind: string, id: string | number) => !!selection && selection.kind === kind && ('id' in selection ? selection.id : 'index' in selection ? selection.index : undefined) === id
  const selRacks = useMemo(() => new Set(selectedRackIds(selection)), [selection])
  const isRackSel = (id: string) => selRacks.has(id)
  const es = edges(plan.outline)
  const handle = Math.max(0.18, span * 0.006)

  return (
    <>
      <mesh geometry={floor} material={MAT.floor} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow
        onClick={(e) => {
          // un clic (sin arrastrar) en el piso: a pie, caminar hasta ahí; con la herramienta de figuras, poner una
          if (e.delta > 4) return
          const s = usePlan.getState()
          const at = { x: Math.round(e.point.x * 1000), y: Math.round(e.point.z * 1000) }
          if (s.walk) { e.stopPropagation(); s.setWalk({ ...s.walk, ...at }) }
          else if (s.tool === 'symbol' && (s.symbolKind === 'persona' || s.symbolKind === 'autoelevador')) {
            e.stopPropagation()
            s.commit((pl) => ({ ...pl, symbols: [...(pl.symbols ?? []), { id: newId('s'), ...at, kind: s.symbolKind }] }))
            s.setTool('select')
          }
        }} />

      {/* figuras para ver la escala: personas y autoelevadores puestos en el plano */}
      {(plan.symbols ?? []).filter((f) => f.kind === 'persona' || f.kind === 'autoelevador').map((f) => (
        <group key={f.id} position={[m(f.x), 0, m(f.y)]}
          {...drag({ kind: 'symbol', id: f.id }, (dx, dy, free) => live((pl) => ({ ...pl, symbols: pl.symbols?.map((q) => (q.id === f.id ? { ...q, x: snapTo(f.x + dx, free), y: snapTo(f.y + dy, free) } : q)) })))}>
          {f.kind === 'persona' ? <Person selected={isSel('symbol', f.id)} /> : <Forklift selected={isSel('symbol', f.id)} />}
        </group>
      ))}

      {/* paredes del contorno (viendo un rack solo, no están: taparían el rack) */}
      {shown === racks && <mesh geometry={ring} material={MAT.wall} castShadow />}

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

      {/* zonas de racks (tinte azul) y pasillos marcados (amarillo) sobre el piso */}
      {(plan.rackAreas ?? []).map((a) => (
        <mesh key={a.id} material={isSel('area', a.id) ? MAT.areaSelected : MAT.area} rotation-x={-Math.PI / 2} position={[m(a.x + a.w / 2), 0.004, m(a.y + a.d / 2)]}
          {...drag({ kind: 'area', id: a.id }, (dx, dy, free) => live((pl) => updateRect(pl, 'area', a.id, () => ({ x: snapTo(a.x + dx, free), y: snapTo(a.y + dy, free) }))))}>
          <planeGeometry args={[m(a.w), m(a.d)]} />
        </mesh>
      ))}
      {(plan.aisles ?? []).map((a) => (
        <mesh key={a.id} renderOrder={2} material={isSel('aisle', a.id) ? MAT.aisleSelected : MAT.aisle} rotation-x={-Math.PI / 2} position={[m(a.x + a.w / 2), 0.007, m(a.y + a.d / 2)]}
          {...drag({ kind: 'aisle', id: a.id }, (dx, dy, free) => live((pl) => updateRect(pl, 'aisle', a.id, () => ({ x: snapTo(a.x + dx, free), y: snapTo(a.y + dy, free) }))))}>
          <planeGeometry args={[m(a.w), m(a.d)]} />
        </mesh>
      ))}

      {/* muchos racks: en lote, con una sola malla invisible para tocarlos y arrastrarlos */}
      {shown.length > MANY_RACKS && <>
        <RackInstances racks={shown} showLoads={showLoads} onStats={onStats} />
        <RackHitInstances racks={shown} placements={shownPlacements}
          onDown={(e, p) => drag({ kind: 'rack', id: p.id }, (dx, dy, free) => live((pl) => (size ? moveRackWithin(freezeRacks(pl, placements), p.id, snapTo(p.x + dx, free), snapTo(p.y + dy, free), size) : moveRack(freezeRacks(pl, placements), p.id, snapTo(p.x + dx, free), snapTo(p.y + dy, free))))).onPointerDown(e)} />
        {shown.filter(({ placement: p }) => isRackSel(p.id) || issues[p.id]).map(({ placement: p, structure }) => {
          const b = placementRect(p)
          const H = m(structure.config.height) + 0.02
          return (
            <mesh key={`mark-${p.id}`} material={isRackSel(p.id) ? MAT.rackSelected : MAT.rackIssue} position={[m(b.x + b.w / 2), H / 2, m(b.y + b.h / 2)]} raycast={() => null}>
              <boxGeometry args={[m(b.w) + 0.04, H, m(b.h) + 0.04]} />
            </mesh>
          )
        })}
      </>}

      {/* pocos racks: el modelo con todo el detalle y, encima, una caja invisible para tocarlo y arrastrarlo */}
      {shown.length <= MANY_RACKS && shown.map((r) => (shown !== racks
        ? <PickableRack key={r.placement.id} rack={r} showLoads={showLoads} />
        : <PlacedRackModel key={r.placement.id} rack={r} showLoads={showLoads} />))}
      {/* viendo un rack solo no hay caja para agarrarlo: se tocan sus piezas (vigas y parantes) */}
      {shown.length <= MANY_RACKS && shown === racks && shown.map(({ placement: p, structure }) => {
        const b = placementRect(p)
        const H = m(structure.config.height) + 0.02
        const mat = isRackSel(p.id) ? MAT.rackSelected : issues[p.id] ? MAT.rackIssue : MAT.rackHit
        return (
          <mesh key={`hit-${p.id}`} material={mat} position={[m(b.x + b.w / 2), H / 2, m(b.y + b.h / 2)]}
            {...drag({ kind: 'rack', id: p.id }, (dx, dy, free) => live((pl) => (size ? moveRackWithin(freezeRacks(pl, placements), p.id, snapTo(p.x + dx, free), snapTo(p.y + dy, free), size) : moveRack(freezeRacks(pl, placements), p.id, snapTo(p.x + dx, free), snapTo(p.y + dy, free)))))}>
            <boxGeometry args={[m(b.w) + 0.04, H, m(b.h) + 0.04]} />
          </mesh>
        )
      })}
    </>
  )
}

/** Cajas invisibles de todos los racks en una sola malla: el toque dice qué rack es (instanceId). */
function RackHitInstances({ racks, placements, onDown }: {
  racks: PlacedRack[]; placements: RackPlacement[]; onDown(e: ThreeEvent<PointerEvent>, p: RackPlacement): void
}) {
  const gl = useThree((s) => s.gl)
  const mesh = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    const im = new THREE.InstancedMesh(g, MAT.rackHit, racks.length)
    const mtx = new THREE.Matrix4()
    racks.forEach(({ placement: p, structure }, i) => {
      const b = placementRect(p)
      const H = m(structure.config.height) + 0.02
      im.setMatrixAt(i, mtx.compose(new THREE.Vector3(m(b.x + b.w / 2), H / 2, m(b.y + b.h / 2)), new THREE.Quaternion(), new THREE.Vector3(m(b.w) + 0.04, H, m(b.h) + 0.04)))
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    return im
  }, [racks])
  useEffect(() => () => { mesh.geometry.dispose(); mesh.dispose() }, [mesh])
  return (
    <primitive object={mesh}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => { const p = e.instanceId !== undefined ? placements[e.instanceId] : undefined; if (p) onDown(e, p) }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); gl.domElement.style.cursor = 'grab' }}
      onPointerOut={() => { gl.domElement.style.cursor = '' }} />
  )
}

/** Conecta los botones + y − (fuera del lienzo) con la cámara: la acerca o aleja hacia donde mira. */
function ZoomBridge({ zoomRef, min, max }: { zoomRef: MutableRefObject<((k: number) => void) | null>; min: number; max: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    zoomRef.current = (k) => {
      if (!controls) return
      const off = camera.position.clone().sub(controls.target)
      const d = Math.min(max, Math.max(min, off.length() * k))
      camera.position.copy(controls.target).add(off.setLength(d))
      controls.update()
      invalidate()
    }
    return () => { zoomRef.current = null }
  }, [camera, controls, invalidate, zoomRef, min, max])
  return null
}

/** "Ver solo este": la cámara va a los racks aislados; al volver a ver todos, vuelve a la vista general. */
function IsolateCamera({ racks = [], center, span }: { racks?: PlacedRack[]; center: THREE.Vector3; span: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((s) => s.invalidate)
  const isolate = usePlan((s) => s.isolate)
  const key = isolate?.join(',') ?? ''
  const first = useRef(true)
  useEffect(() => {
    if (!controls) return
    const ids = new Set(isolate ?? [])
    const only = racks.filter((r) => ids.has(r.placement.id))
    // al abrir el 3D sin nada aislado, la cámara queda donde arranca
    if (!only.length && first.current) { first.current = false; return }
    first.current = false
    let target: THREE.Vector3, dist: number
    if (only.length) {
      const bs = only.map((r) => placementRect(r.placement))
      const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y))
      const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h))
      const h = Math.max(...only.map((r) => m(r.structure.config.height)))
      target = new THREE.Vector3(m((x0 + x1) / 2), h / 3, m((y0 + y1) / 2))
      dist = Math.max(m(x1 - x0), m(y1 - y0), h * 2) * 1.15 + 4
    } else {
      target = center.clone()
      dist = new THREE.Vector3(span * 0.7, span * 0.75, span * 1.05).length()
    }
    const dir = new THREE.Vector3(0.7, 0.75, 1.05).normalize()
    controls.target.copy(target)
    camera.position.copy(target).add(dir.multiplyScalar(dist))
    controls.update()
    invalidate()
  }, [key, controls]) // eslint-disable-line react-hooks/exhaustive-deps -- sólo al aislar o volver
  return null
}

/** Rack visto solo: sus vigas y parantes se tocan para editarlos (se marcan en amarillo). */
function PickableRack({ rack, showLoads }: { rack: PlacedRack; showLoads: boolean }) {
  const id = rack.placement.id
  const piece = usePlan((s) => (s.piece?.rack === id ? s.piece : null))
  const key = piece ? (piece.kind === 'beam' ? `b${piece.module}-${piece.plane}` : `u${piece.frame}`) : ''
  const value = useMemo(() => ({
    picked: piece ? (piece.kind === 'beam' ? { kind: 'beam' as const, module: piece.module, plane: piece.plane } : { kind: 'upright' as const, frame: piece.frame }) : null,
    onPick: (p: PickedPart) => {
      const s = usePlan.getState()
      s.select({ kind: 'rack', id })
      s.setPiece({ rack: id, ...p })
      useDock.getState().set('editar', { collapsed: false })
    },
  }), [key, id]) // eslint-disable-line react-hooks/exhaustive-deps -- piece se compara por su clave
  return <RackPickContext.Provider value={value}><PlacedRackModel rack={rack} showLoads={showLoads} /></RackPickContext.Provider>
}

/**
 * VISTA A PIE (como soltar el muñequito en un mapa): la cámara va a la altura de los ojos de una
 * persona parada en el depósito. Arrastrar gira la vista, las flechas o WASD caminan, la rueda
 * avanza o retrocede y un clic en el piso lleva hasta ahí. Al salir, vuelve la vista de antes.
 */
function WalkControls({ center, span }: { center: THREE.Vector3; span: number }) {
  const walk = usePlan((s) => s.walk)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean; target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((s) => s.invalidate)
  const active = !!walk

  // al entrar se guarda la vista de arriba; al salir se la devuelve
  useEffect(() => {
    if (!active || !controls) return
    const saved = { pos: camera.position.clone(), target: controls.target.clone() }
    controls.enabled = false
    camera.fov = 62; camera.near = 0.05; camera.updateProjectionMatrix()
    return () => {
      // si el 3D se abrió ya caminando no hay vista de arriba guardada: se vuelve a la general
      const fromAbove = saved.pos.y > EYE_HEIGHT + 1
      camera.position.copy(fromAbove ? saved.pos : new THREE.Vector3(center.x + span * 0.7, span * 0.75, center.z + span * 1.05))
      camera.fov = 40; camera.near = 0.1; camera.updateProjectionMatrix()
      controls.target.copy(fromAbove ? saved.target : center); controls.enabled = true; controls.update()
      invalidate()
    }
  }, [active, controls, camera, invalidate, center, span])

  // la cámara sigue a la persona
  useEffect(() => {
    if (!walk) return
    camera.position.set(m(walk.x), EYE_HEIGHT, m(walk.y))
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ')
    invalidate()
  }, [walk, camera, invalidate])

  // mirar arrastrando, caminar con el teclado y la rueda
  useEffect(() => {
    if (!active) return
    const el = gl.domElement
    let last: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => { if (e.button === 0) last = { x: e.clientX, y: e.clientY } }
    const move = (e: PointerEvent) => {
      if (!last) return
      const s = usePlan.getState()
      if (!s.walk) return
      const dx = e.clientX - last.x, dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      s.setWalk({ ...s.walk, yaw: s.walk.yaw + dx * 0.005, pitch: Math.max(-1.2, Math.min(1.2, s.walk.pitch + dy * 0.005)) })
    }
    const up = () => { last = null }
    const wheel = (e: WheelEvent) => { e.preventDefault(); usePlan.getState().walkBy(e.deltaY < 0 ? 1000 : -1000, 0) }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const s = usePlan.getState(), k = e.key.toLowerCase()
      const step = e.shiftKey ? 1500 : 500, turn = Math.PI / 12
      if (k === 'arrowup' || k === 'w') s.walkBy(step, 0)
      else if (k === 'arrowdown' || k === 's') s.walkBy(-step, 0)
      else if (k === 'arrowleft' || k === 'a') s.walkBy(0, turn)
      else if (k === 'arrowright' || k === 'd') s.walkBy(0, -turn)
      else if (k === 'escape') s.setWalk(null)
      else return
      e.preventDefault(); e.stopPropagation()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key, true)
    }
  }, [active, gl])
  return null
}
