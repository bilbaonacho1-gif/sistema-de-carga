/**
 * ANOTACIONES DEL PLANO: textos sueltos, símbolos (matafuegos, salidas, baños…) y cotas puestas a
 * mano. Se dibujan en el plano (SVG en mm) y se tocan para elegirlas y arrastrarlas.
 */
import { Ambulance, BatteryCharging, Droplets, FireExtinguisher, Forklift, LogOut, PackageSearch, Toilet, Truck, Zap, type LucideIcon, PersonStanding } from 'lucide-react'
import type { PlanDim, PlanSymbol, PlanText, SymbolKind } from '../../shared/plan/types'
import { metros } from '../../shared/units'

export const SYMBOLS: Record<SymbolKind, { label: string; icon: LucideIcon; color: string }> = {
  matafuego: { label: 'Matafuego', icon: FireExtinguisher, color: '#d0202f' },
  hidrante: { label: 'Hidrante', icon: Droplets, color: '#d0202f' },
  salida: { label: 'Salida de emergencia', icon: LogOut, color: '#14823a' },
  botiquin: { label: 'Primeros auxilios', icon: Ambulance, color: '#14823a' },
  banio: { label: 'Baño', icon: Toilet, color: '#2f6fb8' },
  tablero: { label: 'Tablero eléctrico', icon: Zap, color: '#c98a00' },
  cargador: { label: 'Carga de autoelevadores', icon: BatteryCharging, color: '#7a3fb8' },
  autoelevador: { label: 'Autoelevador', icon: Forklift, color: '#e07b1f' },
  picking: { label: 'Puesto de picking', icon: PackageSearch, color: '#0f8a8a' },
  anden: { label: 'Dársena / andén', icon: Truck, color: '#7a5230' },
  persona: { label: 'Persona (para ver la escala)', icon: PersonStanding, color: '#2f6fb8' },
}
export const SYMBOL_KINDS = Object.keys(SYMBOLS) as SymbolKind[]

/** Tamaño real de un símbolo en el plano (mm): 1,2 m, pero nunca menos de 26 px en pantalla. */
export const symbolSize = (px: (n: number) => number) => Math.max(1200, px(26))

/** Geometría de una cota: extremos corridos, el texto y su ángulo. */
export function dimGeometry(d: PlanDim) {
  const L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) || 1
  const nx = -(d.b.y - d.a.y) / L, ny = (d.b.x - d.a.x) / L
  const A = { x: d.a.x + nx * d.offset, y: d.a.y + ny * d.offset }, B = { x: d.b.x + nx * d.offset, y: d.b.y + ny * d.offset }
  let ang = (Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180) / Math.PI
  if (ang > 90) ang -= 180
  if (ang < -90) ang += 180
  return { L, nx, ny, A, B, ang, mid: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } }
}

const DIM = '#1f5f8b', RED = '#be1e30'

interface Props {
  texts: PlanText[]
  symbols: PlanSymbol[]
  dims: PlanDim[]
  px: (n: number) => number
  selectedId?: string
  showTexts: boolean
  showSymbols: boolean
  showDims: boolean
  /** Si está, se pueden tocar y arrastrar. */
  onDown?: (e: React.PointerEvent, kind: 'text' | 'symbol' | 'dim', id: string) => void
}

export function PlanAnnotations({ texts, symbols, dims, px, selectedId, showTexts, showSymbols, showDims, onDown }: Props) {
  const S = symbolSize(px)
  const grab = (kind: 'text' | 'symbol' | 'dim', id: string) => (onDown ? (e: React.PointerEvent) => onDown(e, kind, id) : undefined)
  const cursor = onDown ? 'move' : undefined
  return (
    <g>
      {showDims && dims.map((d) => {
        const g = dimGeometry(d)
        const sel = d.id === selectedId, color = sel ? RED : DIM
        const tick = (p: { x: number; y: number }) => {
          const tx = (d.b.x - d.a.x) / g.L, ty = (d.b.y - d.a.y) / g.L
          const k = px(5)
          return <line x1={p.x - (tx + g.nx) * k} y1={p.y - (ty + g.ny) * k} x2={p.x + (tx + g.nx) * k} y2={p.y + (ty + g.ny) * k} stroke={color} strokeWidth={px(1.6)} />
        }
        const t = { x: g.mid.x + g.nx * px(10), y: g.mid.y + g.ny * px(10) }
        return (
          <g key={d.id} style={{ cursor }} onPointerDown={grab('dim', d.id)}>
            <line x1={d.a.x} y1={d.a.y} x2={g.A.x} y2={g.A.y} stroke={color} strokeWidth={px(0.8)} />
            <line x1={d.b.x} y1={d.b.y} x2={g.B.x} y2={g.B.y} stroke={color} strokeWidth={px(0.8)} />
            <line x1={g.A.x} y1={g.A.y} x2={g.B.x} y2={g.B.y} stroke={color} strokeWidth={px(sel ? 2 : 1.2)} />
            {/* zona de toque más ancha que la línea */}
            {onDown && <line x1={g.A.x} y1={g.A.y} x2={g.B.x} y2={g.B.y} stroke="transparent" strokeWidth={px(12)} />}
            {tick(g.A)}{tick(g.B)}
            <text x={t.x} y={t.y} fontSize={px(12)} textAnchor="middle" dominantBaseline="middle" fill={color} stroke="#fff" strokeWidth={px(4)}
              transform={`rotate(${g.ang} ${t.x} ${t.y})`} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 700 }}>{metros(g.L)}</text>
          </g>
        )
      })}
      {showTexts && texts.map((t) => {
        const sel = t.id === selectedId
        return (
          <text key={t.id} x={t.x} y={t.y} fontSize={Math.max(t.size, px(11))} textAnchor="middle" dominantBaseline="middle"
            fill={sel ? RED : '#1f2328'} stroke="#fff" strokeWidth={Math.max(t.size, px(11)) * 0.28} onPointerDown={grab('text', t.id)}
            style={{ paintOrder: 'stroke', fontFamily: 'var(--f-body)', fontWeight: 700, cursor, textDecoration: sel ? 'underline' : undefined }}>{t.text}</text>
        )
      })}
      {showSymbols && symbols.map((s) => {
        const def = SYMBOLS[s.kind] ?? SYMBOLS.matafuego
        const sel = s.id === selectedId
        const Icon = def.icon
        return (
          <g key={s.id} style={{ cursor }} onPointerDown={grab('symbol', s.id)}>
            <rect x={s.x - S / 2} y={s.y - S / 2} width={S} height={S} rx={S * 0.18} fill="#fff" stroke={sel ? RED : def.color} strokeWidth={S * (sel ? 0.1 : 0.07)} />
            <Icon x={s.x - S * 0.34} y={s.y - S * 0.34} width={S * 0.68} height={S * 0.68} color={def.color} strokeWidth={2.2} />
            {px(1) < 45 && <text x={s.x} y={s.y + S / 2 + px(9)} fontSize={px(10)} textAnchor="middle" dominantBaseline="middle" fill={def.color}
              stroke="#fff" strokeWidth={px(3)} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-body)', fontWeight: 700, pointerEvents: 'none' }}>{def.label}</text>}
          </g>
        )
      })}
    </g>
  )
}
