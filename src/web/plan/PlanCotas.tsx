/**
 * COTAS del plano, como en un plano de AutoCAD:
 *  - cada pared recta: línea de cota por afuera, con líneas de referencia y marcas a 45°;
 *  - paredes curvas: largo del arco y radio;
 *  - medidas totales del depósito (largo y ancho), más afuera;
 *  - columna seleccionada: luz libre hasta la cara interna de la pared en las 4 direcciones.
 * Todo se dibuja en mm del plano; `px` convierte pixeles de pantalla a mm (tamaño constante al hacer zoom).
 */
import { apex, arcOf, edgeLength, edges, outlinePolygon, outwardNormal, rayToPolygon } from '../../shared/plan/geometry'
import type { Plan, PlanColumn, PlanPoint } from '../../shared/plan/types'

const INK = '#1f5f8b'
const meters = (mm: number) => `${(Math.round(mm / 10) / 100 + 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m`

interface Props { plan: Plan; px: (n: number) => number; column?: PlanColumn | null }

/** Una cota entre a y b, desplazada `off` mm según la normal n, con su texto. */
function Dim({ a, b, n, off, text, px, k, color = INK }: {
  a: PlanPoint; b: PlanPoint; n: PlanPoint; off: number; text: string; px: (v: number) => number; k: string; color?: string
}) {
  const A = { x: a.x + n.x * off, y: a.y + n.y * off }
  const B = { x: b.x + n.x * off, y: b.y + n.y * off }
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1
  const t = { x: (B.x - A.x) / L, y: (B.y - A.y) / L }
  // marca a 45° (como en arquitectura)
  const tick = (p: PlanPoint) => {
    const d = { x: (t.x + n.x) * px(5), y: (t.y + n.y) * px(5) }
    return <line x1={p.x - d.x} y1={p.y - d.y} x2={p.x + d.x} y2={p.y + d.y} stroke={color} strokeWidth={px(1.6)} />
  }
  const gap = px(3), over = px(6)
  let ang = (Math.atan2(t.y, t.x) * 180) / Math.PI
  if (ang > 90) ang -= 180
  if (ang < -90) ang += 180
  const mid = { x: (A.x + B.x) / 2 + n.x * px(9), y: (A.y + B.y) / 2 + n.y * px(9) }
  return (
    <g key={k} pointerEvents="none">
      <line x1={a.x + n.x * gap} y1={a.y + n.y * gap} x2={A.x + n.x * over} y2={A.y + n.y * over} stroke={color} strokeWidth={px(0.8)} />
      <line x1={b.x + n.x * gap} y1={b.y + n.y * gap} x2={B.x + n.x * over} y2={B.y + n.y * over} stroke={color} strokeWidth={px(0.8)} />
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={px(1)} />
      {tick(A)}{tick(B)}
      <text x={mid.x} y={mid.y} fontSize={px(11.5)} textAnchor="middle" dominantBaseline="middle" fill={color}
        stroke="#fff" strokeWidth={px(4)} transform={`rotate(${ang} ${mid.x} ${mid.y})`}
        style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>{text}</text>
    </g>
  )
}

export function PlanCotas({ plan, px, column }: Props) {
  if (plan.outline.points.length < 3) return null
  const poly = outlinePolygon(plan.outline, 100)
  const es = edges(plan.outline)
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  const halfWall = plan.wallThickness / 2

  return (
    <g>
      {/* paredes */}
      {es.map((e) => {
        const n = outwardNormal(e, poly)
        const arc = arcOf(e)
        if (arc) {
          const m = apex(e)
          const at = { x: m.x + n.x * px(22), y: m.y + n.y * px(22) }
          return (
            <text key={`c${e.index}`} x={at.x} y={at.y} fontSize={px(11.5)} textAnchor="middle" dominantBaseline="middle" fill={INK}
              stroke="#fff" strokeWidth={px(4)} pointerEvents="none" style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>
              {`arco ${meters(edgeLength(e))} · R ${meters(arc.radius)}`}
            </text>
          )
        }
        return <Dim key={`c${e.index}`} k={`c${e.index}`} a={e.a} b={e.b} n={n} off={px(26)} text={meters(edgeLength(e))} px={px} />
      })}

      {/* medidas totales */}
      <Dim k="total-x" a={{ x: box.minX, y: box.maxY }} b={{ x: box.maxX, y: box.maxY }} n={{ x: 0, y: 1 }} off={px(62)}
        text={`TOTAL ${meters(box.maxX - box.minX)}`} px={px} color="#1f2328" />
      <Dim k="total-y" a={{ x: box.minX, y: box.minY }} b={{ x: box.minX, y: box.maxY }} n={{ x: -1, y: 0 }} off={px(62)}
        text={`TOTAL ${meters(box.maxY - box.minY)}`} px={px} color="#1f2328" />

      {/* columna seleccionada: luz libre hasta cada pared */}
      {column && ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => {
        const d = rayToPolygon(column, { x: dx, y: dy }, poly)
        if (d === null) return null
        const face = dx ? column.w / 2 : column.d / 2
        const from = { x: column.x + dx * face, y: column.y + dy * face }
        const to = { x: column.x + dx * (d - halfWall), y: column.y + dy * (d - halfWall) }
        const clear = d - halfWall - face
        if (clear <= 0) return null
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
        return (
          <g key={`col${dx}${dy}`} pointerEvents="none">
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#be1e30" strokeWidth={px(1.2)} strokeDasharray={`${px(5)} ${px(3)}`} />
            <circle cx={to.x} cy={to.y} r={px(2.5)} fill="#be1e30" />
            <text x={mid.x + (dy ? px(8) : 0)} y={mid.y - (dx ? px(8) : 0)} fontSize={px(11)} textAnchor={dy ? 'start' : 'middle'} dominantBaseline="middle"
              fill="#be1e30" stroke="#fff" strokeWidth={px(4)} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>{meters(clear)}</text>
          </g>
        )
      })}
    </g>
  )
}
