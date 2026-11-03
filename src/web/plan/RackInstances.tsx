/**
 * TODOS LOS RACKS DEL DEPÓSITO EN 3D, pensado para miles de racks.
 *
 * En vez de un objeto por pieza (como el rack suelto del cotizador, que tiene todo el detalle),
 * acá cada tipo de pieza es UN InstancedMesh: una caja que la placa de video repite miles de veces
 * en una sola llamada. Las piezas de cada configuración se calculan una vez y se reusan en todos
 * los racks iguales; por rack sólo se multiplica su posición y giro.
 *
 * Según el tamaño se elige el nivel de detalle, para que la vista siga fluida (el plano y la lista
 * de materiales siguen completos):
 *  - completo: parantes, diagonales, vigas, pallets y carga;
 *  - medio (depósitos grandes): sin diagonales y cada pallet con su carga como una sola caja;
 *  - mínimo (enormes): sólo la estructura (parantes y vigas).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { configKey, structureFor } from '../../shared/plan/racks'
import type { PlanRack } from '../../shared/plan/types'
import type { RackConfiguration } from '../../shared/rack/types'
import { MATERIALS, m } from '../three/materials'

type Kind = 'upright' | 'brace' | 'beam' | 'pallet' | 'load' | 'unit'
const KINDS: Kind[] = ['upright', 'brace', 'beam', 'pallet', 'load', 'unit']
const MAT: Record<Kind, THREE.Material> = {
  upright: MATERIALS.galvanized, brace: MATERIALS.brace, beam: MATERIALS.red, pallet: MATERIALS.wood, load: MATERIALS.cardboard, unit: MATERIALS.cardboard,
}
export type Detail = 'completo' | 'medio' | 'mínimo'
const LEVEL: Record<Detail, Kind[]> = {
  completo: ['upright', 'brace', 'beam', 'pallet', 'load'],
  medio: ['upright', 'beam', 'unit'],
  mínimo: ['upright', 'beam'],
}
/** Piezas a partir de las cuales se baja el detalle. */
const LIMIT_FULL = 90_000
const LIMIT_MEDIUM = 220_000

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const tmpM = new THREE.Matrix4()
const tmpW = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpV = new THREE.Vector3()
const tmpS = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** Matrices locales (en metros, coordenadas del rack) de cada pieza de una configuración. */
type Parts = Record<Kind, THREE.Matrix4[]>
const partsCache = new Map<string, Parts>()

function partsFor(config: RackConfiguration): Parts {
  const key = configKey(config)
  const hit = partsCache.get(key)
  if (hit) return hit
  const s = structureFor(config)
  const parts: Parts = { upright: [], brace: [], beam: [], pallet: [], load: [], unit: [] }
  const D = m(s.config.depth)
  const uw = m(s.upright.faceWidth), ud = m(s.upright.depth)
  const rowLength = m(s.totalWidth)

  for (const row of s.rows) {
    // de las coordenadas de la fila (como RackModel) a las del rack
    const flip = row.facing === -1
    const z0 = m(row.zFront)
    const put = (kind: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number, q?: THREE.Quaternion) => {
      const X = flip ? rowLength - x : x
      const Z = flip ? z0 - z : z0 + z
      const quat = q ? q.clone() : new THREE.Quaternion()
      if (flip) quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI))
      parts[kind].push(new THREE.Matrix4().compose(new THREE.Vector3(X, y, Z), quat, new THREE.Vector3(sx, sy, sz)))
    }

    for (const f of row.frames) {
      const H = m(f.height), x = m(f.x)
      put('upright', x, H / 2, -ud / 2, uw, H, ud)
      put('upright', x, H / 2, -D + ud / 2, uw, H, ud)
      // diagonales en zigzag entre el parante de adelante y el de atrás
      const n = Math.max(2, Math.round((f.height - 300) / 650))
      const y0 = 0.15, y1 = H - 0.15
      for (let i = 0; i < n; i++) {
        const ya = y0 + ((y1 - y0) * i) / n, yb = y0 + ((y1 - y0) * (i + 1)) / n
        const za = i % 2 === 0 ? -ud : -D + ud, zb = i % 2 === 0 ? -D + ud : -ud
        const len = Math.hypot(yb - ya, zb - za)
        tmpV.set(0, yb - ya, zb - za).normalize()
        put('brace', x, (ya + yb) / 2, (za + zb) / 2, 0.03, len, 0.02, new THREE.Quaternion().setFromUnitVectors(UP, tmpV))
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
    for (const p of s.pallets) {
      if (p.row !== row.index) continue
      const mod = row.modules[p.module]
      const lv = mod?.levels[p.level]
      if (!lv) continue
      const y = m(p.elevation)
      put('pallet', m(p.x), y + m(pal.height) / 2, -D / 2, m(pal.front), m(pal.height), m(pal.deep))
      if (lv.loadHeight > 0)
        put('load', m(p.x), y + m(pal.height) + m(lv.loadHeight) / 2, -D / 2, m(pal.front) * 0.96, m(lv.loadHeight), m(pal.deep) * 0.96)
      const h = m(pal.height) + m(lv.loadHeight)
      put('unit', m(p.x), y + h / 2, -D / 2, m(pal.front), h, m(pal.deep))
    }
  }
  partsCache.set(key, parts)
  if (partsCache.size > 200) partsCache.delete(partsCache.keys().next().value!)
  return parts
}

export interface InstanceStats { racks: number; instances: number; detail: Detail }

export function RackInstances({ racks, onStats }: { racks: PlanRack[]; onStats?: (s: InstanceStats) => void }) {
  const { meshes, stats } = useMemo(() => {
    const perRack = racks.map((r) => partsFor(r.config))
    const count = (k: Kind) => perRack.reduce((n, p) => n + p[k].length, 0)
    const counts = Object.fromEntries(KINDS.map((k) => [k, count(k)])) as Record<Kind, number>
    const sum = (d: Detail) => LEVEL[d].reduce((n, k) => n + counts[k], 0)
    const detail: Detail = sum('completo') <= LIMIT_FULL ? 'completo' : sum('medio') <= LIMIT_MEDIUM ? 'medio' : 'mínimo'
    const use = new Set(LEVEL[detail])
    const shadows = sum(detail) < 40_000

    const meshes: THREE.InstancedMesh[] = []
    for (const k of KINDS) {
      if (!use.has(k) || !counts[k]) continue
      const mesh = new THREE.InstancedMesh(unitBox, MAT[k], counts[k])
      mesh.castShadow = shadows && k !== 'brace'
      mesh.receiveShadow = false
      let i = 0
      racks.forEach((r, ri) => {
        // posición y giro del rack en el depósito (mm del plano → metros del 3D)
        tmpQ.setFromAxisAngle(UP, -(r.rotation * Math.PI) / 180)
        tmpM.compose(tmpV.set(m(r.x), 0, m(r.y)), tmpQ, tmpS.set(1, 1, 1))
        for (const local of perRack[ri][k]) {
          mesh.setMatrixAt(i++, tmpW.multiplyMatrices(tmpM, local))
        }
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      meshes.push(mesh)
    }
    return { meshes, stats: { racks: racks.length, instances: sum(detail), detail } satisfies InstanceStats }
  }, [racks])

  useEffect(() => { onStats?.(stats) }, [stats, onStats])
  // cada vez que cambian los racks se arman mallas nuevas: las anteriores se liberan
  useEffect(() => () => meshes.forEach((x) => x.dispose()), [meshes])

  return <>{meshes.map((x, i) => <primitive key={i} object={x} />)}</>
}
