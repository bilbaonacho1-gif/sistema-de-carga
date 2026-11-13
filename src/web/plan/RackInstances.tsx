/**
 * MUCHOS RACKS EN 3D. Para depósitos grandes: en vez de un objeto por pieza (el modelo del cotizador,
 * con todo el detalle), cada tipo de pieza es UN InstancedMesh: una caja que la placa de video repite
 * miles de veces en una sola llamada. Las piezas de cada estructura se calculan una vez y se reusan en
 * todos los racks iguales; por rack sólo cambia su lugar y su giro.
 *
 * El detalle baja solo según el tamaño, para que la vista siga fluida (el plano y la lista de
 * materiales siguen completos):
 *  - completo: parantes, diagonales, vigas, pallets y carga;
 *  - medio: sin diagonales y cada pallet con su carga como una sola caja;
 *  - mínimo: sólo la estructura (parantes y vigas).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PlacedRack } from '../../shared/plan/depot'
import type { RackPlacement } from '../../shared/plan/types'
import type { RackStructure } from '../../shared/rack/types'
import { braceMaterial, MATERIALS, m, paintMaterial } from '../three/materials'
import { loadOf, stackBoxes } from '../../shared/rack/load'

type Kind = 'upright' | 'brace' | 'beam' | 'pallet' | 'load' | 'unit'
const KINDS: Kind[] = ['upright', 'brace', 'beam', 'pallet', 'load', 'unit']
const MAT: Record<Kind, THREE.Material> = {
  upright: MATERIALS.galvanized, brace: MATERIALS.brace, beam: MATERIALS.red, pallet: MATERIALS.wood, load: MATERIALS.cardboard, unit: MATERIALS.cardboard,
}
export type Detail = 'completo' | 'medio' | 'mínimo'
const LEVEL: Record<Detail, Kind[]> = {
  completo: ['upright', 'brace', 'beam', 'pallet', 'load'],
  medio: ['upright', 'beam', 'unit'],
  // aun en el mínimo, cada pallet con su carga queda como una caja (que se vean las cajas)
  mínimo: ['upright', 'beam', 'unit'],
}
/** Piezas a partir de las cuales se baja el detalle. */
const LIMIT_FULL = 90_000
const LIMIT_MEDIUM = 220_000

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const UP = new THREE.Vector3(0, 1, 0)
const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI)

type Parts = Record<Kind, THREE.Matrix4[]>
const partsCache = new WeakMap<RackStructure, Parts>()

/** Matrices de cada pieza en las coordenadas del modelo del cotizador (fila a lo largo de +X, frente en z = 0). */
function partsFor(s: RackStructure): Parts {
  const hit = partsCache.get(s)
  if (hit) return hit
  const parts: Parts = { upright: [], brace: [], beam: [], pallet: [], load: [], unit: [] }
  const D = m(s.config.depth)
  const uw = m(s.upright.faceWidth), ud = m(s.upright.depth)
  const rowLength = m(s.totalWidth)
  const dir = new THREE.Vector3()

  for (const row of s.rows) {
    // de las coordenadas de la fila a las del rack (como RackModel: la fila de atrás va girada)
    const flip = row.facing === -1
    const z0 = m(row.zFront)
    const put = (kind: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number, q?: THREE.Quaternion) => {
      const quat = q ? q.clone() : new THREE.Quaternion()
      if (flip) quat.premultiply(HALF_TURN)
      parts[kind].push(new THREE.Matrix4().compose(new THREE.Vector3(flip ? rowLength - x : x, y, flip ? z0 - z : z0 + z), quat, new THREE.Vector3(sx, sy, sz)))
    }
    for (const f of row.frames) {
      const H = m(f.height), x = m(f.x)
      put('upright', x, H / 2, -ud / 2, uw, H, ud)
      put('upright', x, H / 2, -D + ud / 2, uw, H, ud)
      const n = f.diagonals
      const y0 = 0.15, y1 = H - 0.15
      for (let i = 0; i < n; i++) {
        const ya = y0 + ((y1 - y0) * i) / n, yb = y0 + ((y1 - y0) * (i + 1)) / n
        const za = i % 2 === 0 ? -ud : -D + ud, zb = i % 2 === 0 ? -D + ud : -ud
        dir.set(0, yb - ya, zb - za)
        const len = dir.length()
        put('brace', x, (ya + yb) / 2, (za + zb) / 2, 0.03, len, 0.02, new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
      }
    }
    for (const mod of row.modules) {
      const W = m(mod.width), x0 = m(mod.xStart)
      const bh = m(mod.beam.height), bd = m(mod.beam.depth)
      for (const lv of mod.levels) {
        if (!lv.hasBeam) continue
        const y = m(lv.elevation) - bh / 2
        put('beam', x0 + W / 2, y, -bd / 2, W, bh, bd)
        put('beam', x0 + W / 2, y, -D + bd / 2, W, bh, bd)
      }
    }
    const pal = s.pallet
    // con la carga armada con cajas, el bloque tiene el alto de las capas que entran en el nivel
    const load = loadOf(s.config)
    const stack = load.mode === 'boxes' ? stackBoxes(pal, load) : null
    const loadH = (free: number) => (stack ? Math.min(stack.layers, Math.floor(free / Math.max(1, load.boxH))) * load.boxH * (stack.perLayer > 0 ? 1 : 0) : free)
    for (const p of s.pallets) {
      if (p.row !== row.index) continue
      const lv = row.modules[p.module]?.levels[p.level]
      if (!lv) continue
      const y = m(p.elevation)
      const lh = loadH(lv.loadHeight)
      put('pallet', m(p.x), y + m(pal.height) / 2, -D / 2, m(pal.front), m(pal.height), m(pal.deep))
      if (lh > 0) put('load', m(p.x), y + m(pal.height) + m(lh) / 2, -D / 2, m(pal.front) * 0.96, m(lh), m(pal.deep) * 0.96)
      const h = m(pal.height) + m(lh)
      put('unit', m(p.x), y + h / 2, -D / 2, m(pal.front), h, m(pal.deep))
    }
  }
  partsCache.set(s, parts)
  return parts
}

/** Lugar y giro de un rack ubicado (igual que PlacedRackModel). */
export function placementMatrix(p: RackPlacement, out = new THREE.Matrix4()): THREE.Matrix4 {
  return p.orientation === 'x'
    ? out.makeTranslation(m(p.x), 0, m(p.y + p.depth))
    : out.makeRotationY(-Math.PI / 2).setPosition(m(p.x), 0, m(p.y))
}

export interface InstanceStats { racks: number; pieces: number; detail: Detail }

export function RackInstances({ racks, showLoads = true, onStats }: { racks: PlacedRack[]; showLoads?: boolean; onStats?: (s: InstanceStats) => void }) {
  const { meshes, stats } = useMemo(() => {
    const perRack = racks.map((r) => partsFor(r.structure))
    const counts = Object.fromEntries(KINDS.map((k) => [k, perRack.reduce((n, p) => n + p[k].length, 0)])) as Record<Kind, number>
    const visible = (k: Kind) => showLoads || !['pallet', 'load', 'unit'].includes(k)
    const sum = (d: Detail) => LEVEL[d].filter(visible).reduce((n, k) => n + counts[k], 0)
    const detail: Detail = sum('completo') <= LIMIT_FULL ? 'completo' : sum('medio') <= LIMIT_MEDIUM ? 'medio' : 'mínimo'
    const use = LEVEL[detail].filter(visible)
    const shadows = sum(detail) < 40_000
    const place = new THREE.Matrix4(), world = new THREE.Matrix4()
    // los colores de pintura son los mismos en todo el depósito (los del rack elegido)
    const acc = racks[0]?.structure.accessories
    const mat = (k: Kind) => (!acc ? MAT[k] : k === 'beam' ? paintMaterial(acc.beamColor) : k === 'upright' ? paintMaterial(acc.uprightColor) : k === 'brace' ? braceMaterial(acc.uprightColor) : MAT[k])
    const meshes = use.filter((k) => counts[k] > 0).map((k) => {
      const mesh = new THREE.InstancedMesh(unitBox, mat(k), counts[k])
      mesh.castShadow = shadows && k !== 'brace'
      let i = 0
      racks.forEach((r, ri) => {
        placementMatrix(r.placement, place)
        for (const local of perRack[ri][k]) mesh.setMatrixAt(i++, world.multiplyMatrices(place, local))
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      return mesh
    })
    return { meshes, stats: { racks: racks.length, pieces: sum(detail), detail } satisfies InstanceStats }
  }, [racks, showLoads])

  useEffect(() => { onStats?.(stats) }, [stats, onStats])
  // cada vez que cambian los racks se arman mallas nuevas: las anteriores se liberan
  useEffect(() => () => meshes.forEach((x) => x.dispose()), [meshes])
  return <>{meshes.map((x, i) => <primitive key={i} object={x} />)}</>
}
