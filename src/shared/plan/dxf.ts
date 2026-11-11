/**
 * EXPORTAR A AUTOCAD (DXF): el plano en un archivo que abre AutoCAD (y cualquier CAD), en milímetros,
 * con una capa por tipo de elemento: contorno, tabiques, columnas, zonas, pasillos, racks, textos y cotas.
 * Formato DXF R12 (el más compatible). En el DXF el eje Y va hacia arriba: se da vuelta el plano.
 */
import { dxfBulge, edges } from './geometry'
import { placementRect, type RackModuleSize } from './layout'
import { rackDims } from './racks'
import type { Plan, PlanPoint, RackPlacement } from './types'
import { metros } from '../units'

const LAYERS: [string, number][] = [
  ['CONTORNO', 7], ['TABIQUES', 8], ['COLUMNAS', 8], ['PORTONES', 2], ['ZONAS_LIBRES', 1], ['ZONAS_RACKS', 5],
  ['PASILLOS', 2], ['RACKS', 30], ['BASTIDORES', 30], ['TEXTOS', 7], ['COTAS', 4], ['SIMBOLOS', 3],
]

export function planToDxf(plan: Plan, racks: RackPlacement[] = [], size?: RackModuleSize, names: Map<string, string> = new Map()): string {
  const out: string[] = []
  const w = (...pairs: (string | number)[]) => { for (const v of pairs) out.push(typeof v === 'number' ? fmt(v) : v) }
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3))
  const Y = (y: number) => -y

  const line = (layer: string, a: PlanPoint, b: PlanPoint) => w('0', 'LINE', '8', layer, '10', a.x, '20', Y(a.y), '30', 0, '11', b.x, '21', Y(b.y), '31', 0)
  const poly = (layer: string, pts: { x: number; y: number; bulge?: number }[], closed = true) => {
    w('0', 'POLYLINE', '8', layer, '66', 1, '70', closed ? 1 : 0)
    // el bulge de DXF es positivo en sentido antihorario: al dar vuelta Y cambia de signo
    for (const p of pts) { w('0', 'VERTEX', '8', layer, '10', p.x, '20', Y(p.y), '30', 0); if (p.bulge) w('42', -p.bulge) }
    w('0', 'SEQEND', '8', layer)
  }
  const rect = (layer: string, x: number, y: number, rw: number, rh: number) => poly(layer, [{ x, y }, { x: x + rw, y }, { x: x + rw, y: y + rh }, { x, y: y + rh }])
  const text = (layer: string, p: PlanPoint, h: number, s: string, centered = true) => {
    w('0', 'TEXT', '8', layer, '10', p.x, '20', Y(p.y), '30', 0, '40', h, '1', s.replace(/\n/g, ' '))
    if (centered) w('72', 1, '73', 2, '11', p.x, '21', Y(p.y), '31', 0)
  }

  // encabezado: unidades en milímetros
  w('0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', 4, '9', '$DWGCODEPAGE', '3', 'ANSI_1252', '0', 'ENDSEC')
  w('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', LAYERS.length)
  for (const [name, color] of LAYERS) w('0', 'LAYER', '2', name, '70', 0, '62', color, '6', 'CONTINUOUS')
  w('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES')

  // contorno (paredes rectas o en arco)
  const es = edges(plan.outline)
  if (es.length >= 3) poly('CONTORNO', es.map((e) => ({ x: e.a.x, y: e.a.y, bulge: dxfBulge(e) })))
  for (const t of plan.walls) line('TABIQUES', t.a, t.b)
  for (const c of plan.columns) {
    if (c.shape === 'round') w('0', 'CIRCLE', '8', 'COLUMNAS', '10', c.x, '20', Y(c.y), '30', 0, '40', c.w / 2)
    else rect('COLUMNAS', c.x - c.w / 2, c.y - c.d / 2, c.w, c.d)
  }
  for (const d of plan.doors) {
    const e = es[d.edge]
    if (!e) continue
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1, ux = (e.b.x - e.a.x) / L, uy = (e.b.y - e.a.y) / L
    const cx = e.a.x + (e.b.x - e.a.x) * d.t, cy = e.a.y + (e.b.y - e.a.y) * d.t
    line('PORTONES', { x: cx - ux * d.width / 2, y: cy - uy * d.width / 2 }, { x: cx + ux * d.width / 2, y: cy + uy * d.width / 2 })
    text('PORTONES', { x: cx, y: cy - 600 }, 300, `PORTON ${metros(d.width)}`)
  }
  for (const z of plan.zones) { rect('ZONAS_LIBRES', z.x, z.y, z.w, z.d); text('ZONAS_LIBRES', { x: z.x + z.w / 2, y: z.y + z.d / 2 }, 400, z.name) }
  for (const a of plan.rackAreas ?? []) { rect('ZONAS_RACKS', a.x, a.y, a.w, a.d); text('ZONAS_RACKS', { x: a.x + 300, y: a.y + 600 }, 400, a.name, false) }
  for (const a of plan.aisles ?? []) { rect('PASILLOS', a.x, a.y, a.w, a.d); text('PASILLOS', { x: a.x + a.w / 2, y: a.y + a.d / 2 }, 300, `PASILLO ${metros(Math.min(a.w, a.d))}`) }

  // racks: cada fila como rectángulo, y sus bastidores
  for (const r of racks) {
    const b = placementRect(r)
    const horizontal = r.orientation === 'x'
    const dims = size && rackDims(r, size)
    const D = dims?.depth ?? (r.pair ? r.depth / 2 : r.depth)
    const offsets = r.pair ? [0, r.depth - D] : [0]
    for (const off of offsets) {
      const x = horizontal ? b.x : b.x + off, y = horizontal ? b.y + off : b.y
      const rw = horizontal ? r.length : D, rh = horizontal ? D : r.length
      rect('RACKS', x, y, rw, rh)
      if (dims) for (let k = 0; k <= r.modules; k++) {
        const f = dims.upright / 2 + k * (dims.width + dims.upright)
        line('BASTIDORES', horizontal ? { x: x + f, y } : { x, y: y + f }, horizontal ? { x: x + f, y: y + rh } : { x: x + rw, y: y + f })
      }
    }
    const name = names.get(r.id)
    if (name) text('RACKS', horizontal ? { x: b.x - 600, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y - 600 }, 350, name)
  }

  for (const t of plan.texts ?? []) text('TEXTOS', t, t.size, t.text)
  for (const s of plan.symbols ?? []) { w('0', 'CIRCLE', '8', 'SIMBOLOS', '10', s.x, '20', Y(s.y), '30', 0, '40', 500); text('SIMBOLOS', { x: s.x, y: s.y + 900 }, 250, s.kind.toUpperCase()) }
  for (const d of plan.dims ?? []) {
    const L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) || 1
    const nx = -(d.b.y - d.a.y) / L, ny = (d.b.x - d.a.x) / L
    const A = { x: d.a.x + nx * d.offset, y: d.a.y + ny * d.offset }, B = { x: d.b.x + nx * d.offset, y: d.b.y + ny * d.offset }
    line('COTAS', d.a, A); line('COTAS', d.b, B); line('COTAS', A, B)
    text('COTAS', { x: (A.x + B.x) / 2 + nx * 350, y: (A.y + B.y) / 2 + ny * 350 }, 300, metros(L))
  }
  w('0', 'ENDSEC', '0', 'EOF')
  return out.join('\n') + '\n'
}
