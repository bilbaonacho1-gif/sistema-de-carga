/** Racks ubicados en el plano (vista de arriba): cada fila con sus bastidores, como en un plano de AutoCAD. */
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

export function PlanRacks({ racks, size, px, selectedId, issues = {}, onDown }: Props) {
  return (
    <g pointerEvents={onDown ? undefined : 'none'}>
      {racks.map((r) => {
        const b = placementRect(r)
        const horizontal = r.orientation === 'x'
        const sel = r.id === selectedId
        const bad = !!issues[r.id]
        const stroke = sel || bad ? '#be1e30' : '#e07b1f'
        // filas de este rack: una, o dos (el par espalda con espalda) separadas por su distanciador
        const rows = r.pair ? [0, size.depth + size.backToBackGap] : [0]
        // bastidores a lo largo de la fila
        const frames = Array.from({ length: r.modules + 1 }, (_, k) => size.upright / 2 + k * (size.width + size.upright))
        return (
          <g key={r.id} onPointerDown={onDown && ((e) => onDown(e, r))} style={onDown ? { cursor: 'move' } : undefined}>
            {rows.map((off) => {
              const x = horizontal ? b.x : b.x + off
              const y = horizontal ? b.y + off : b.y
              const w = horizontal ? r.length : size.depth
              const h = horizontal ? size.depth : r.length
              return (
                <g key={off}>
                  <rect x={x} y={y} width={w} height={h} fill={bad ? '#f8d4d8' : sel ? '#ffe2c4' : '#fdebd3'} stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.2)} />
                  {frames.map((f) => horizontal
                    ? <line key={f} x1={x + f} y1={y} x2={x + f} y2={y + h} stroke={bad ? '#a3192a' : '#c2651a'} strokeWidth={Math.max(size.upright, px(1))} />
                    : <line key={f} x1={x} y1={y + f} x2={x + w} y2={y + f} stroke={bad ? '#a3192a' : '#c2651a'} strokeWidth={Math.max(size.upright, px(1))} />)}
                </g>
              )
            })}
            {/* el par tiene un hueco entre filas: un rectángulo transparente lo hace tocable entero */}
            {onDown && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />}
            {sel && <rect x={b.x - px(4)} y={b.y - px(4)} width={b.w + px(8)} height={b.h + px(8)} fill="none" stroke="#be1e30" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />}
          </g>
        )
      })}
    </g>
  )
}
