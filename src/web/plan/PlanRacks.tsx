/** Racks ubicados en el plano (vista de arriba): cada fila con sus bastidores, como en un plano de AutoCAD. */
import { placementRect, type RackModuleSize, type RackPlacement } from '../../shared/plan/layout'

export function PlanRacks({ racks, size, px }: { racks: RackPlacement[]; size: RackModuleSize; px: (n: number) => number }) {
  return (
    <g pointerEvents="none">
      {racks.map((r) => {
        const b = placementRect(r)
        const horizontal = r.orientation === 'x'
        // filas de este rack: una, o dos (el par espalda con espalda) separadas por su distanciador
        const rows = r.pair ? [0, size.depth + size.backToBackGap] : [0]
        // bastidores a lo largo de la fila
        const frames = Array.from({ length: r.modules + 1 }, (_, k) => size.upright / 2 + k * (size.width + size.upright))
        return (
          <g key={r.id}>
            {rows.map((off) => {
              const x = horizontal ? b.x : b.x + off
              const y = horizontal ? b.y + off : b.y
              const w = horizontal ? r.length : size.depth
              const h = horizontal ? size.depth : r.length
              return (
                <g key={off}>
                  <rect x={x} y={y} width={w} height={h} fill="#fdebd3" stroke="#e07b1f" strokeWidth={px(1.2)} />
                  {frames.map((f) => horizontal
                    ? <line key={f} x1={x + f} y1={y} x2={x + f} y2={y + h} stroke="#c2651a" strokeWidth={Math.max(size.upright, px(1))} />
                    : <line key={f} x1={x} y1={y + f} x2={x + w} y2={y + f} stroke="#c2651a" strokeWidth={Math.max(size.upright, px(1))} />)}
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
