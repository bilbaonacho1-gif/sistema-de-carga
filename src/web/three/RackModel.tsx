/**
 * Modelo 3D paramétrico. Se arma SOLO a partir de RackStructure:
 * FILA → TRAMO → BASTIDOR | MÓDULO | BASTIDOR … → NIVEL → POSICIÓN → PALLET
 *
 * Cada pieza tiene una key estable: al agregar posiciones o niveles React monta
 * únicamente las piezas nuevas (que entran animadas) y las existentes se reubican.
 * Cada bastidor usa su propia altura y cada módulo su largo de viga, niveles y viga.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { DESIGN_RULES, VISUAL } from '../../shared/rack/technicalSpecs'
import type { FrameLayout, LevelLayout, ModuleLayout, PositionSlot, RackStructure, RowLayout } from '../../shared/rack/types'
import { Animated } from './Animated'
import {
  basePlateGeometry, beamGeometry, bracingGeometry, connectorGeometry, loadGeometry, palletGeometry, protectorGeometry,
} from './geometry/parts'
import { uprightGeometry } from './geometry/upright'
import { MATERIALS, m } from './materials'

interface PrevCounts { rows: number; modules: number; levels: number }
type V3 = [number, number, number]

/** Paso de la cascada al crecer: rápido si se agregan muchos módulos de golpe. */
const cascadeStep = (added: number) => Math.min(0.22, 2.4 / Math.max(1, added))

export function RackModel({ structure }: { structure: RackStructure }) {
  // conteos del render anterior → saber qué piezas son nuevas y escalonar su aparición
  const prev = useRef<PrevCounts>({ rows: 0, modules: 0, levels: 0 })
  const before = prev.current
  useEffect(() => {
    prev.current = { rows: structure.rows.length, modules: structure.modulesPerRow, levels: structure.storageLevels }
  })

  return (
    <group>
      {structure.rows.map((row) => (
        <Row key={row.index} row={row} structure={structure} before={before} />
      ))}
    </group>
  )
}

function Row({ row, structure, before }: { row: RowLayout; structure: RackStructure; before: PrevCounts }) {
  const isNewRow = row.index >= before.rows
  const baseModules = isNewRow ? 0 : before.modules
  const added = Math.max(0, structure.modulesPerRow - baseModules)
  const step = cascadeStep(added)
  const rowDelay = isNewRow ? (row.index - before.rows) * 0.3 : 0
  const rowLength = m(structure.totalWidth)
  const pallets = structure.pallets.filter((p) => p.row === row.index)
  const slots = structure.positions.filter((p) => p.row === row.index)

  return (
    <Animated
      position={[row.facing === 1 ? 0 : rowLength, 0, m(row.zFront)]}
      rotationY={row.facing === 1 ? 0 : Math.PI}
    >
      {row.frames.map((f) => {
        const isNew = isNewRow || f.index > baseModules || (baseModules === 0 && f.index === 0)
        const delay = rowDelay + (f.index === 0 ? 0 : Math.max(0, f.index - 1 - baseModules) * step)
        return <Frame key={f.id} frame={f} row={row} structure={structure} isNew={isNew} delay={delay} />
      })}
      {row.modules.map((mod) => (
        <Module
          key={mod.id}
          mod={mod}
          structure={structure}
          pallets={pallets.filter((p) => p.module === mod.index)}
          slots={slots.filter((p) => p.module === mod.index)}
          isNew={mod.index >= baseModules}
          delay={rowDelay + (mod.index - baseModules) * step + 0.45}
          prevLevels={before.levels}
        />
      ))}
    </Animated>
  )
}

/* ------------------------------ Barra entre dos puntos ------------------------------ */

const AXIS_Z = new THREE.Vector3(0, 0, 1)

function Bar({ a, b, size = 0.04, material }: { a: V3; b: V3; size?: number; material: THREE.Material }) {
  const key = `${a.join()}|${b.join()}`
  const { position, quaternion, length } = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const len = dir.length()
    return { position: va.add(vb).multiplyScalar(0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(AXIS_Z, dir.normalize()), length: len }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- a y b se comparan por valor
  return (
    <mesh position={position} quaternion={quaternion} material={material} castShadow>
      <boxGeometry args={[size, size, length]} />
    </mesh>
  )
}

/* ------------------------------ BASTIDOR ------------------------------ */

function Frame({ frame, row, structure, isNew, delay }: {
  frame: FrameLayout; row: RowLayout; structure: RackStructure; isNew: boolean; delay: number
}) {
  const { config, upright, accessories: acc } = structure
  const D = m(config.depth)
  const H = m(frame.height)
  const upGeo = uprightGeometry(upright, frame.height)
  const braceGeo = bracingGeometry(upright, frame.height, config.depth)
  const plateGeo = basePlateGeometry(upright)
  const last = row.frames.length - 1
  const isEnd = frame.index === 0 || frame.index === last
  const hasProtector = acc.protectors === 'all' || (acc.protectors === 'ends' && isEnd)
  const { backToBack, aisleWidth } = config.layout
  const pairedBehind = backToBack && row.facing === 1 && row.index + 1 < structure.rows.length
  const gap = m(DESIGN_RULES.backToBackGap)
  // conectores superiores: unen el par espalda con espalda, o cruzan el pasillo hasta la fila siguiente
  const tieAcross = acc.topTies && !backToBack && row.index + 1 < structure.rows.length
  const tieY = H - 0.12
  // guardarraíl de cabecera: uno por bloque (el par espalda con espalda comparte uno)
  const guard = acc.guardrails && isEnd && row.facing === 1
  const guardDepth = D + (pairedBehind ? D + gap : 0)
  const gOff = m(VISUAL.guardrail.offset) * (frame.index === 0 ? -1 : 1)

  return (
    <Animated position={[m(frame.x), 0, 0]} appear={isNew ? 'grow-y' : 'none'} delay={delay} duration={0.6}>
      <mesh geometry={upGeo} material={MATERIALS.galvanized} castShadow />
      <mesh geometry={upGeo} material={MATERIALS.galvanized} position={[0, 0, -D]} rotation-y={Math.PI} castShadow />
      <mesh geometry={braceGeo} material={MATERIALS.brace} castShadow />
      <mesh geometry={plateGeo} material={MATERIALS.painted} />
      <mesh geometry={plateGeo} material={MATERIALS.painted} position={[0, 0, -D]} rotation-y={Math.PI} />
      {hasProtector && <mesh geometry={protectorGeometry(upright)} material={MATERIALS.painted} castShadow />}
      {pairedBehind && [0.35, 0.7].map((k) => (
        <mesh key={k} material={MATERIALS.brace} position={[0, H * k, -D - gap / 2]}>
          <boxGeometry args={[0.04, 0.04, gap + 0.06]} />
        </mesh>
      ))}
      {acc.topTies && pairedBehind && <Bar a={[0, tieY, -D + 0.03]} b={[0, tieY, -D - gap - 0.03]} size={0.05} material={MATERIALS.red} />}
      {tieAcross && <Bar a={[0, tieY, -D + 0.03]} b={[0, tieY, -D - m(aisleWidth) - 0.03]} size={0.05} material={MATERIALS.red} />}
      {guard && <Guardrail x={gOff} depth={guardDepth} />}
    </Animated>
  )
}

/** Guardarraíl: dos postes y una baranda que cubre la cabecera de la fila. */
function Guardrail({ x, depth }: { x: number; depth: number }) {
  const h = m(VISUAL.guardrail.height)
  const rh = m(VISUAL.guardrail.railHeight)
  const len = depth + 0.2
  const zc = -depth / 2
  return (
    <group position={[x, 0, 0]}>
      {[0.08, -depth - 0.08].map((z) => (
        <mesh key={z} material={MATERIALS.yellow} position={[0, h / 2, z]} castShadow>
          <boxGeometry args={[0.08, h, 0.08]} />
        </mesh>
      ))}
      <mesh material={MATERIALS.yellow} position={[0, h - rh / 2 - 0.03, zc]} castShadow>
        <boxGeometry args={[0.05, rh, len]} />
      </mesh>
    </group>
  )
}

/* ------------------------------ MÓDULO ------------------------------ */

function Module({ mod, structure, pallets, slots, isNew, delay, prevLevels }: {
  mod: ModuleLayout; structure: RackStructure; pallets: PositionSlot[]; slots: PositionSlot[]; isNew: boolean; delay: number; prevLevels: number
}) {
  // ¿es el primer render del módulo? (sus niveles entran con él, no por separado)
  const firstRender = useRef(true)
  useEffect(() => { firstRender.current = false }, [])
  const mounting = firstRender.current
  const { config, accessories: acc, pallet } = structure
  const W = m(mod.width)
  const D = m(config.depth)
  const levelDelay = (lv: LevelLayout) => (mounting ? 0 : Math.max(0, lv.index - prevLevels) * 0.15)
  const beamLevels = mod.levels.filter((lv) => lv.hasBeam)
  const cross = acc.crossBracing && mod.index % DESIGN_RULES.modulesPerCrossBrace === 0
  const H = m(mod.height)

  return (
    <Animated position={[m(mod.xStart), 0, 0]}>
      {/* las vigas crecen de izquierda a derecha cuando el módulo es nuevo */}
      <Animated position={[0, 0, 0]} appear={isNew ? 'grow-x' : 'none'} delay={delay} duration={0.5}>
        {beamLevels.map((lv) => (
          <Animated key={lv.index} position={[0, m(lv.elevation), 0]} appear={mounting ? 'none' : 'drop'} delay={levelDelay(lv)}>
            <BeamLevel structure={structure} mod={mod} />
            {acc.decking !== 'none' && (
              <mesh material={acc.decking === 'wood' ? MATERIALS.wood : MATERIALS.mesh} position={[W / 2, m(VISUAL.deck.thickness) / 2, -D / 2]} receiveShadow>
                <boxGeometry args={[W - 0.02, m(VISUAL.deck.thickness), D - 0.02]} />
              </mesh>
            )}
            {acc.palletSupports && slots.filter((p) => p.level === lv.index).flatMap((p) =>
              [-1, 1].map((k) => (
                <mesh key={`${p.id}-${k}`} material={MATERIALS.galvanized} position={[m(p.x - mod.xStart) + k * m(pallet.front) / 3, 0.015, -D / 2]}>
                  <boxGeometry args={[0.04, 0.03, D]} />
                </mesh>
              )))}
          </Animated>
        ))}
      </Animated>

      {cross && <>
        <Bar a={[0.03, 0.25, -D - 0.02]} b={[W - 0.03, H - 0.2, -D - 0.02]} size={0.025} material={MATERIALS.brace} />
        <Bar a={[W - 0.03, 0.25, -D - 0.02]} b={[0.03, H - 0.2, -D - 0.02]} size={0.025} material={MATERIALS.brace} />
      </>}

      {acc.capacitySigns && (
        <group position={[W / 2, m(VISUAL.sign.elevation), 0.03]}>
          <mesh material={MATERIALS.plate}><boxGeometry args={[m(VISUAL.sign.width), m(VISUAL.sign.height), 0.006]} /></mesh>
          <mesh material={MATERIALS.yellow} position={[0, m(VISUAL.sign.height) / 2 - 0.025, 0.004]}><boxGeometry args={[m(VISUAL.sign.width), 0.05, 0.004]} /></mesh>
          <mesh material={MATERIALS.red} position={[0, -0.03, 0.004]}><boxGeometry args={[m(VISUAL.sign.width) * 0.7, 0.03, 0.003]} /></mesh>
        </group>
      )}

      {pallets.map((p) => {
        const lv = mod.levels[p.level]
        const d = mounting
          ? delay + 0.4 + p.level * 0.08 + p.slot * 0.05
          : p.level >= prevLevels ? (p.level - prevLevels) * 0.15 + 0.3 : 0.05 + p.slot * 0.05
        const deckLift = lv.hasBeam && acc.decking !== 'none' ? m(VISUAL.deck.thickness) : 0
        return (
          <Animated key={p.id} position={[m(p.x - mod.xStart), m(p.elevation) + deckLift, -D / 2]} appear="drop" delay={d} duration={0.45}>
            <PalletLoad structure={structure} loadHeight={lv.loadHeight} />
          </Animated>
        )
      })}
    </Animated>
  )
}

/** Un plano de carga: viga frontal + viga trasera con sus 4 conectores. */
function BeamLevel({ structure, mod }: { structure: RackStructure; mod: ModuleLayout }) {
  const { config, upright } = structure
  const beam = mod.beam
  const W = m(mod.width)
  const D = m(config.depth)
  const bh = m(beam.height)
  const bd = m(beam.depth)
  const geo = beamGeometry(beam)
  const left = connectorGeometry(-1, upright, beam)
  const right = connectorGeometry(1, upright, beam)
  const zFront = -(bd / 2 - 0.005)
  const zBack = -D + (bd / 2 - 0.005)

  return (
    <group>
      <mesh geometry={geo} material={MATERIALS.red} position={[W / 2, -bh / 2, zFront]} scale={[W - 0.01, 1, 1]} castShadow />
      <mesh geometry={geo} material={MATERIALS.red} position={[W / 2, -bh / 2, zBack]} scale={[W - 0.01, 1, 1]} castShadow />
      <mesh geometry={left} material={MATERIALS.painted} />
      <mesh geometry={right} material={MATERIALS.painted} position={[W, 0, 0]} />
      {/* atrás: la pieza del lado opuesto girada 180° */}
      <mesh geometry={right} material={MATERIALS.painted} position={[0, 0, -D]} rotation-y={Math.PI} />
      <mesh geometry={left} material={MATERIALS.painted} position={[W, 0, -D]} rotation-y={Math.PI} />
    </group>
  )
}

function PalletLoad({ structure, loadHeight }: { structure: RackStructure; loadHeight: number }) {
  const { pallet } = structure
  return (
    <group>
      <mesh geometry={palletGeometry(pallet)} material={MATERIALS.wood} castShadow />
      {loadHeight > 0 && (
        <mesh geometry={loadGeometry(pallet, loadHeight)} material={MATERIALS.cardboard} position={[0, m(pallet.height), 0]} castShadow />
      )}
    </group>
  )
}
