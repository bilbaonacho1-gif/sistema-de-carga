/**
 * Racks ubicados en el plano (vista de arriba): cada fila con sus bastidores, como en un plano de AutoCAD.
 *
 * Pensado para depósitos grandes: todos los racks se dibujan en pocos trazos (uno para los normales,
 * otro para los que tienen problemas y otro para los bastidores), así con miles de racks el navegador
 * dibuja un puñado de elementos en vez de miles. Los trazos no cambian de grosor con el zoom
 * (vector-effect), y los bastidores aparecen recién al acercarse. El rack elegido va aparte, encima.
 */
import { memo, useMemo } from 'react'
import { placementRect, type RackModuleSize, type RackPlacement } from '../../shared/plan/layout'

interface Props {
  racks: RackPlacement[]
  size: RackModuleSize
  px: (n: number) => number
  /** Racks seleccionados (uno o varios). */
  selected?: Set<string>
  /** Racks con problemas (se pisan, chocan o quedan afuera): van en rojo. */
  issues?: Record<string, string>
  /** Lo que se ve del plano: los pallets se dibujan sólo de los racks a la vista. */
  view?: { x: number; y: number; w: number; h: number }
  /** Si está, los racks se pueden tocar y arrastrar. */
  onDown?: (e: React.PointerEvent, rack: RackPlacement) => void
}

const ORANGE = '#e07b1f', RED = '#be1e30'
const NONE = new Set<string>()

/** Pallets de cada módulo (con su medida real, centrados en su lugar), como en un plano de racks. */
function palletShapes(r: RackPlacement, size: RackModuleSize): string {
  const n = size.pallets ?? 0, pf = size.palletFront ?? 0, pd = size.palletDeep ?? 0
  if (!n || !pf || !pd) return ''
  const b = placementRect(r)
  const horizontal = r.orientation === 'x'
  const offsets = r.pair ? [0, size.depth + size.backToBackGap] : [0]
  const slot = size.width / n
  let out = ''
  for (const off of offsets) for (let k = 0; k < r.modules; k++) for (let i = 0; i < n; i++) {
    const along = size.upright + k * (size.width + size.upright) + i * slot + (slot - pf) / 2
    const across = off + (size.depth - pd) / 2
    const x = Math.round(horizontal ? b.x + along : b.x + across), y = Math.round(horizontal ? b.y + across : b.y + along)
    const w = Math.round(horizontal ? pf : pd), h = Math.round(horizontal ? pd : pf)
    out += `M${x} ${y}h${w}v${h}h${-w}Z`
  }
  return out
}

/** Rectángulos de las filas de un rack y las líneas de sus bastidores (en coordenadas del plano). */
function rackShapes(r: RackPlacement, size: RackModuleSize, withFrames: boolean): { rows: string; frames: string } {
  const b = placementRect(r)
  const horizontal = r.orientation === 'x'
  const offsets = r.pair ? [0, size.depth + size.backToBackGap] : [0]
  let rows = '', frames = ''
  for (const off of offsets) {
    const x = Math.round(horizontal ? b.x : b.x + off), y = Math.round(horizontal ? b.y + off : b.y)
    const w = Math.round(horizontal ? r.length : size.depth), h = Math.round(horizontal ? size.depth : r.length)
    rows += `M${x} ${y}h${w}v${h}h${-w}Z`
    if (withFrames)
      for (let k = 0; k <= r.modules; k++) {
        const f = Math.round(size.upright / 2 + k * (size.width + size.upright))
        frames += horizontal ? `M${x + f} ${y}v${h}` : `M${x} ${y + f}h${w}`
      }
  }
  return { rows, frames }
}

export const PlanRacks = memo(function PlanRacks({ racks, size, px, selected = NONE, issues = {}, onDown, view }: Props) {
  // con más de ~60 mm por pixel los bastidores serían una mancha: se muestran al acercarse
  const detail = px(1) < 60
  // más cerca todavía, cada pallet en su lugar (sólo los racks a la vista)
  const showPallets = px(1) < 28
  const pallets = useMemo(() => {
    if (!showPallets) return ''
    let out = ''
    for (const r of racks) {
      const b = placementRect(r)
      if (view && (b.x > view.x + view.w || b.x + b.w < view.x || b.y > view.y + view.h || b.y + b.h < view.y)) continue
      out += palletShapes(r, size)
    }
    return out
  }, [racks, size, showPallets, view])
  const paths = useMemo(() => {
    let ok = '', bad = '', okFrames = '', badFrames = '', selRows = '', selFrames = ''
    for (const r of racks) {
      const s = rackShapes(r, size, detail || selected.has(r.id))
      if (selected.has(r.id)) { selRows += s.rows; selFrames += s.frames } else if (issues[r.id]) { bad += s.rows; badFrames += s.frames } else { ok += s.rows; okFrames += s.frames }
    }
    return { ok, bad, okFrames, badFrames, selRows, selFrames }
  }, [racks, size, detail, selected, issues])
  // un solo rack elegido: con su recuadro punteado
  const single = selected.size === 1 ? racks.find((r) => selected.has(r.id)) : undefined
  const selBad = single && !!issues[single.id]
  const selBox = single && placementRect(single)

  return (
    <g>
      <g pointerEvents="none">
        {paths.ok && <path d={paths.ok} fill="#fdebd3" stroke={ORANGE} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
        {paths.okFrames && <path d={paths.okFrames} stroke="#c2651a" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {paths.bad && <path d={paths.bad} fill="#f8d4d8" stroke={RED} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {pallets && <path d={pallets} fill="#f3d9b5" fillOpacity={0.55} stroke="#b0702c" strokeWidth={0.8} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
        {paths.badFrames && <path d={paths.badFrames} stroke="#a3192a" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {paths.selRows && <>
          <path d={paths.selRows} fill={selBad ? '#f8d4d8' : '#ffe2c4'} stroke={RED} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          <path d={paths.selFrames} stroke={selBad ? '#a3192a' : '#c2651a'} strokeWidth={Math.max(1.4, size.upright / px(1))} vectorEffect="non-scaling-stroke" />
        </>}
        {selBox && <>
          <rect x={selBox!.x - px(4)} y={selBox!.y - px(4)} width={selBox!.w + px(8)} height={selBox!.h + px(8)} fill="none" stroke={RED} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
        </>}
      </g>
      {/* zonas de toque: un rectángulo transparente por rack (incluye el hueco entre filas del par) */}
      {onDown && racks.map((r) => {
        const b = placementRect(r)
        return <rect key={r.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" style={{ cursor: 'move' }} onPointerDown={(e) => onDown(e, r)} />
      })}
    </g>
  )
})
