/**
 * El depósito en 3D: piso, paredes (las curvas se arman con tramos cortos), columnas,
 * tabiques, portones y zonas libres. Se arma sólo a partir del plano.
 */
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { edges, outlinePolygon, planBounds, pointOnEdge, tangentOnEdge } from '../../shared/plan/geometry'
import type { Plan, PlanPoint } from '../../shared/plan/types'

const m = (mm: number) => mm / 1000

const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: '#d9dce0', roughness: 0.9, side: THREE.DoubleSide }),
  column: new THREE.MeshStandardMaterial({ color: '#7d838a', roughness: 0.7 }),
  inner: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.9 }),
  door: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5, metalness: 0.2 }),
  floor: new THREE.MeshStandardMaterial({ color: '#f7f7f5', roughness: 1 }),
  zone: new THREE.MeshStandardMaterial({ color: '#be1e30', transparent: true, opacity: 0.18 }),
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

/** Una pared recta entre dos puntos del plano, como caja. */
function Segment({ a, b, height, thickness, material }: { a: PlanPoint; b: PlanPoint; height: number; thickness: number; material: THREE.Material }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1) return null
  const angle = -Math.atan2(b.y - a.y, b.x - a.x)
  return (
    <mesh material={material} position={[m((a.x + b.x) / 2), m(height) / 2, m((a.y + b.y) / 2)]} rotation-y={angle} castShadow receiveShadow>
      {/* un poco más larga para que las uniones de las curvas no dejen rendijas */}
      <boxGeometry args={[m(len) + m(thickness) * 0.5, m(height), m(thickness)]} />
    </mesh>
  )
}

export function Plan3D({ plan }: { plan: Plan }) {
  const poly = useMemo(() => outlinePolygon(plan.outline, 300), [plan.outline])
  const b = planBounds(plan)
  const center = new THREE.Vector3(m((b.minX + b.maxX) / 2), 0, m((b.minY + b.maxY) / 2))
  const span = Math.max(m(b.maxX - b.minX), m(b.maxY - b.minY), 5)
  const ring = useMemo(() => wallRingGeometry(poly, plan.wallHeight, plan.wallThickness), [poly, plan.wallHeight, plan.wallThickness])
  const floor = useMemo(() => {
    // la figura se dibuja en XY y se acuesta: (x, y) del plano → (x, -y) para que quede en +z
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(m(p.x), -m(p.y))))
    return new THREE.ShapeGeometry(shape)
  }, [poly])

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 2000, position: [center.x + span * 0.7, span * 0.75, center.z + span * 1.05] }}>
      <color attach="background" args={['#eef0f2']} />
      <hemisphereLight args={['#ffffff', '#cfd3d8', 1]} />
      <directionalLight position={[center.x + span, span * 1.5, center.z + span * 0.6]} intensity={1.4} castShadow shadow-bias={-0.0005} shadow-normalBias={0.05}
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
      <Grid position={[0, -0.002, 0]} infiniteGrid cellSize={1} sectionSize={5} cellColor="#dfe2e6" sectionColor="#c9cdd2" fadeDistance={span * 4} />

      <mesh geometry={floor} material={MAT.floor} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow />

      {/* paredes del contorno */}
      <mesh geometry={ring} material={MAT.wall} castShadow />

      {/* portones: un panel amarillo sobre la pared */}
      {plan.doors.map((d) => {
        const e = edges(plan.outline)[d.edge]
        if (!e) return null
        const c = pointOnEdge(e, d.t)
        const t = tangentOnEdge(e, d.t)
        return (
          <mesh key={d.id} material={MAT.door} position={[m(c.x), m(d.height) / 2, m(c.y)]} rotation-y={-Math.atan2(t.y, t.x)}>
            <boxGeometry args={[m(d.width), m(d.height), m(plan.wallThickness) * 1.4]} />
          </mesh>
        )
      })}

      {/* tabiques */}
      {plan.walls.map((w) => (
        <Segment key={w.id} a={w.a} b={w.b} height={Math.min(plan.wallHeight, 3000)} thickness={w.thickness} material={MAT.inner} />
      ))}

      {/* columnas */}
      {plan.columns.map((c) => (
        <mesh key={c.id} material={MAT.column} position={[m(c.x), m(plan.wallHeight) / 2, m(c.y)]} castShadow>
          {c.shape === 'round'
            ? <cylinderGeometry args={[m(c.w) / 2, m(c.w) / 2, m(plan.wallHeight), 24]} />
            : <boxGeometry args={[m(c.w), m(plan.wallHeight), m(c.d)]} />}
        </mesh>
      ))}

      {/* zonas libres */}
      {plan.zones.map((z) => (
        <mesh key={z.id} material={MAT.zone} rotation-x={-Math.PI / 2} position={[m(z.x + z.w / 2), 0.01, m(z.y + z.d / 2)]}>
          <planeGeometry args={[m(z.w), m(z.d)]} />
        </mesh>
      ))}

      <OrbitControls makeDefault target={center} enableDamping maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} maxDistance={span * 6} />
    </Canvas>
  )
}
