/**
 * RACKS "HORNEADOS": el mismo modelo con todo el detalle, pero dibujado en pocas pasadas.
 *
 * El modelo del cotizador arma un objeto por pieza (miles por depósito) y cada uno es una orden
 * aparte para la placa de video. Acá cada estructura distinta se arma UNA vez, escondida; sus piezas
 * se funden en una malla por material y esa malla se repite (InstancedMesh) en todos los racks que
 * tienen esa misma estructura. Se ve igual y la placa trabaja cientos de veces menos.
 *
 * Lo que cambia respecto del modelo vivo: las piezas no entran animadas (StillModel) y los parantes van
 * livianos (LightModel). Para tocar piezas (un rack visto solo) se sigue usando el modelo vivo.
 */
import { invalidate } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PlacedRack } from '../../shared/plan/depot'
import type { RackPlacement } from '../../shared/plan/types'
import type { RackStructure } from '../../shared/rack/types'
import { LightModel, StillModel } from '../three/Animated'
import { RackModel, RackPickContext } from '../three/RackModel'
import { placementMatrix } from './RackInstances'

interface Baked { geometry: THREE.BufferGeometry; material: THREE.Material; cast: boolean; receive: boolean }

const NO_PICK = { picked: null, onPick: () => {} }
const KEEP = ['position', 'normal', 'uv', 'color']

/** Funde todas las mallas de un grupo en una por material (en las coordenadas del grupo). */
function bake(root: THREE.Group): Baked[] {
  root.updateWorldMatrix(true, true)
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const local = new THREE.Matrix4()
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry || Array.isArray(mesh.material)) return
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name)
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    local.multiplyMatrices(inverse, mesh.matrixWorld)
    g.applyMatrix4(local)
    // una pieza espejada queda con las caras al revés: se dan vuelta
    if (local.determinant() < 0) {
      for (const name of Object.keys(g.attributes)) {
        const a = g.getAttribute(name) as THREE.BufferAttribute, n = a.itemSize, arr = a.array as Float32Array
        for (let i = 0; i + 3 * n <= arr.length; i += 3 * n) for (let k = 0; k < n; k++) { const t = arr[i + n + k]; arr[i + n + k] = arr[i + 2 * n + k]; arr[i + 2 * n + k] = t }
      }
    }
    const key = `${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${Object.keys(g.attributes).sort().join()}`
    let group = groups.get(key)
    if (!group) { group = { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] }; groups.set(key, group) }
    group.parts.push(g)
  })
  const out: Baked[] = []
  for (const g of groups.values()) {
    const geometry = g.parts.length === 1 ? g.parts[0] : mergeGeometries(g.parts, false)
    if (g.parts.length > 1) g.parts.forEach((p) => p.dispose())
    if (!geometry) continue
    geometry.computeBoundingSphere()
    out.push({ geometry, material: g.material, cast: g.cast, receive: g.receive })
  }
  return out
}

/** Arma una estructura escondida, la funde y avisa (después se desmonta). */
function Oven({ structure, onDone }: { structure: RackStructure; onDone(parts: Baked[]): void }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => { if (ref.current) onDone(bake(ref.current)) }, []) // eslint-disable-line react-hooks/exhaustive-deps -- se hornea una vez, al armarse
  return (
    // dispose={null}: al desmontarse no se liberan los materiales compartidos (los sigue usando la malla fundida)
    <group ref={ref} visible={false} dispose={null}>
      <LightModel.Provider value>
        <StillModel.Provider value>
          <RackPickContext.Provider value={NO_PICK}>
            <RackModel structure={structure} />
          </RackPickContext.Provider>
        </StillModel.Provider>
      </LightModel.Provider>
    </group>
  )
}

/** Las mallas fundidas de una estructura, repetidas en el lugar de cada rack que la usa. */
function Copies({ parts, placements }: { parts: Baked[]; placements: RackPlacement[] }) {
  const count = placements.length
  const meshes = useMemo(() => parts.map((p) => {
    const im = new THREE.InstancedMesh(p.geometry, p.material, count)
    im.castShadow = p.cast
    im.receiveShadow = p.receive
    return im
  }), [parts, count])
  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4()
    for (const im of meshes) {
      placements.forEach((p, i) => im.setMatrixAt(i, placementMatrix(p, mtx)))
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
    }
    invalidate()
  }, [meshes, placements])
  // la malla repetida se libera; la geometría fundida es de quien la horneó
  useEffect(() => () => { for (const im of meshes) im.dispose() }, [meshes])
  return <>{meshes.map((im, i) => <primitive key={i} object={im} dispose={null} />)}</>
}

const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => { let id = ids.get(o); if (!id) { id = ++nextId; ids.set(o, id) } return id }
const withoutLoads = new WeakMap<RackStructure, RackStructure>()
/** La estructura sin los pallets (para "Ver pallets" apagado), siempre el mismo objeto. */
function bare(s: RackStructure): RackStructure {
  let b = withoutLoads.get(s)
  if (!b) { b = { ...s, pallets: [] }; withoutLoads.set(s, b) }
  return b
}

/**
 * Todos los racks del depósito con el detalle completo. Los racks con la misma estructura comparten
 * las mallas: mover uno sólo cambia su lugar.
 */
export function BakedRacks({ racks, showLoads }: { racks: PlacedRack[]; showLoads: boolean }) {
  const byStructure = useMemo(() => {
    const map = new Map<RackStructure, RackPlacement[]>()
    for (const r of racks) {
      const s = showLoads ? r.structure : bare(r.structure)
      const list = map.get(s)
      if (list) list.push(r.placement); else map.set(s, [r.placement])
    }
    return map
  }, [racks, showLoads])
  const [baked, setBaked] = useState<Map<RackStructure, Baked[]>>(() => new Map())
  const live = useRef(baked)
  live.current = baked
  // lo horneado de estructuras que ya no están se libera
  useEffect(() => {
    const gone = [...baked.keys()].filter((s) => !byStructure.has(s))
    if (!gone.length) return
    setBaked((prev) => {
      const next = new Map(prev)
      for (const s of gone) { next.get(s)?.forEach((p) => p.geometry.dispose()); next.delete(s) }
      return next
    })
  }, [byStructure, baked])
  useEffect(() => () => { for (const parts of live.current.values()) parts.forEach((p) => p.geometry.dispose()) }, [])

  return (
    <>
      {[...byStructure.keys()].filter((s) => !baked.has(s)).map((s) => (
        <Oven key={`o${idOf(s)}`} structure={s} onDone={(parts) => setBaked((prev) => new Map(prev).set(s, parts))} />
      ))}
      {[...byStructure].map(([s, placements]) => {
        const parts = baked.get(s)
        return parts ? <Copies key={`c${idOf(s)}`} parts={parts} placements={placements} /> : null
      })}
    </>
  )
}
