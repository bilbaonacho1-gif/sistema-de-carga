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
  selectedId?: string
  /** Racks con problemas (se pisan, chocan o quedan afuera): van en rojo. */
  issues?: Record<string, string>
  /** Si está, los racks se pueden tocar y arrastrar. */
  onDown?: (e: React.PointerEvent, rack: RackPlacement) => void
}

const ORANGE = '#e07b1f', RED = '#be1e30'

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

export const PlanRacks = memo(function PlanRacks({ racks, size, px, selectedId, issues = {}, onDown }: Props) {
  // con más de ~60 mm por pixel los bastidores serían una mancha: se muestran al acercarse
  const detail = px(1) < 60
  const paths = useMemo(() => {
    let ok = '', bad = '', okFrames = '', badFrames = ''
    for (const r of racks) {
      if (r.id === selectedId) continue
      const s = rackShapes(r, size, detail)
      if (issues[r.id]) { bad += s.rows; badFrames += s.frames } else { ok += s.rows; okFrames += s.frames }
    }
    return { ok, bad, okFrames, badFrames }
  }, [racks, size, detail, selectedId, issues])
  const selected = racks.find((r) => r.id === selectedId)
  const sel = selected && rackShapes(selected, size, true)
  const selBad = selected && !!issues[selected.id]
  const selBox = selected && placementRect(selected)

  return (
    <g>
      <g pointerEvents="none">
        {paths.ok && <path d={paths.ok} fill="#fdebd3" stroke={ORANGE} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
        {paths.okFrames && <path d={paths.okFrames} stroke="#c2651a" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {paths.bad && <path d={paths.bad} fill="#f8d4d8" stroke={RED} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {paths.badFrames && <path d={paths.badFrames} stroke="#a3192a" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {sel && <>
          <path d={sel.rows} fill={selBad ? '#f8d4d8' : '#ffe2c4'} stroke={RED} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          <path d={sel.frames} stroke={selBad ? '#a3192a' : '#c2651a'} strokeWidth={Math.max(1.4, size.upright / px(1))} vectorEffect="non-scaling-stroke" />
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
