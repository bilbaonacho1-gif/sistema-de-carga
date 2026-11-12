/**
 * FORMA DE UNA PIEZA: el corte (la sección) dibujado con puntos, en milímetros. La pieza es esa
 * forma estirada a lo largo: una viga a lo largo del módulo, un parante a lo alto del rack.
 *
 * Coordenadas del corte: x hacia la derecha, y hacia abajo (como en pantalla).
 *  - viga: x = ancho (fondo del rack), y = alto (arriba es y chico).
 *  - parante, visto desde arriba: x = frente, y = fondo (y = 0 es la cara del pasillo).
 *
 * Dos maneras de leer los puntos: "de chapa" (los puntos son la línea de la chapa doblada, con su
 * espesor; puede ser abierta como una C o cerrada como una caja) o "maciza" (los puntos son el
 * contorno, relleno: así entra un perfil dibujado en AutoCAD).
 */
export interface Pt { x: number; y: number }
export interface SectionShape {
  points: Pt[]
  /** El último punto se une con el primero. */
  closed: boolean
  /** Contorno relleno (si no, chapa doblada con espesor). Sólo con forma cerrada. */
  solid: boolean
  /** Espesor de la chapa (mm). */
  thickness: number
}

export const SHAPE_LIMITS = { points: 80, size: 320, thickness: { min: 1, max: 12 } }
const r1 = (n: number) => Math.round(n * 10) / 10

export function shapeBounds(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Corre la forma para que arranque en (0, 0). */
export function normalizeShape(s: SectionShape): SectionShape {
  const b = shapeBounds(s.points)
  return { ...s, points: s.points.map((p) => ({ x: r1(p.x - b.x), y: r1(p.y - b.y) })) }
}

/** Deja una forma válida (o undefined si no hay con qué): sin puntos repetidos, dentro del tamaño máximo. */
export function sanitizeShape(s: Partial<SectionShape> | undefined): SectionShape | undefined {
  if (!s || !Array.isArray(s.points)) return undefined
  let pts = s.points.map((p) => ({ x: Number(p?.x), y: Number(p?.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.05).slice(0, SHAPE_LIMITS.points)
  const closed = !!s.closed && pts.length >= 3
  if (pts.length < 2) return undefined
  const b = shapeBounds(pts)
  if (b.w < 1 && b.h < 1) return undefined
  // más grande que lo permitido: se achica entera
  const k = Math.min(1, SHAPE_LIMITS.size / Math.max(b.w, b.h))
  const t = Number(s.thickness)
  return {
    points: pts.map((p) => ({ x: r1((p.x - b.x) * k), y: r1((p.y - b.y) * k) })), closed, solid: closed && !!s.solid,
    thickness: Math.min(SHAPE_LIMITS.thickness.max, Math.max(SHAPE_LIMITS.thickness.min, Number.isFinite(t) && t > 0 ? t : 2.5)),
  }
}

/** Estira o achica la forma para que mida w × h en total. */
export function resizeShape(s: SectionShape, w: number, h: number): SectionShape {
  const b = shapeBounds(s.points)
  const kx = b.w > 0.01 ? w / b.w : 1, ky = b.h > 0.01 ? h / b.h : 1
  return { ...s, points: s.points.map((p) => ({ x: r1((p.x - b.x) * kx), y: r1((p.y - b.y) * ky) })) }
}

/* ------------------------------ Formas para empezar ------------------------------ */

export type PresetId = 'caja' | 'c' | 'u' | 'l' | 'omega' | 'doble-t' | 'macizo'
export const PRESETS: { id: PresetId; name: string }[] = [
  { id: 'caja', name: 'Caja' }, { id: 'c', name: 'C' }, { id: 'u', name: 'U' }, { id: 'l', name: 'L (ángulo)' },
  { id: 'omega', name: 'Omega' }, { id: 'doble-t', name: 'Doble T' }, { id: 'macizo', name: 'Maciza' },
]

export function presetShape(id: PresetId, w: number, h: number, t = 2.5): SectionShape {
  const lip = r1(Math.min(w, h) * 0.2), f = r1(w * 0.22), a = r1(Math.max(t * 1.5, Math.min(w, h) * 0.14))
  const mk = (points: Pt[], closed: boolean, solid = false): SectionShape => ({ points, closed, solid, thickness: t })
  switch (id) {
    case 'caja': return mk([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true)
    case 'c': return mk([{ x: lip, y: h }, { x: 0, y: h }, { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: w - lip, y: h }], false)
    case 'u': return mk([{ x: 0, y: h }, { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }], false)
    case 'l': return mk([{ x: 0, y: 0 }, { x: 0, y: h }, { x: w, y: h }], false)
    case 'omega': return mk([{ x: 0, y: h }, { x: f, y: h }, { x: f, y: 0 }, { x: w - f, y: 0 }, { x: w - f, y: h }, { x: w, y: h }], false)
    case 'doble-t': return mk([
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: a }, { x: w / 2 + a / 2, y: a }, { x: w / 2 + a / 2, y: h - a }, { x: w, y: h - a }, { x: w, y: h },
      { x: 0, y: h }, { x: 0, y: h - a }, { x: w / 2 - a / 2, y: h - a }, { x: w / 2 - a / 2, y: a }, { x: 0, y: a },
    ].map((p) => ({ x: r1(p.x), y: r1(p.y) })), true, true)
    case 'macizo': return mk([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true, true)
  }
}

/* ------------------------------ Contorno (para dibujar y para el 3D) ------------------------------ */

/** Corre una línea `d` hacia su izquierda (esquinas en inglete). */
export function offsetLine(pts: Pt[], closed: boolean, d: number): Pt[] {
  const n = pts.length
  const normal = (a: Pt, b: Pt) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l } }
  return pts.map((p, i) => {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[i - 1], next = closed ? pts[(i + 1) % n] : pts[i + 1]
    const n1 = prev && normal(prev, p), n2 = next && normal(p, next)
    if (n1 && n2) {
      const mx = n1.x + n2.x, my = n1.y + n2.y, len = Math.hypot(mx, my)
      if (len < 1e-6) return { x: p.x + n1.x * d, y: p.y + n1.y * d }
      const ux = mx / len, uy = my / len
      const k = d / Math.max(0.3, ux * n1.x + uy * n1.y)
      return { x: p.x + ux * k, y: p.y + uy * k }
    }
    const nn = (n1 || n2)!
    return { x: p.x + nn.x * d, y: p.y + nn.y * d }
  })
}

const area = (pts: Pt[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p.x * q.y - q.x * p.y) }, 0) / 2

/** El contorno de material de la forma: un polígono exterior y, si es una caja de chapa, su hueco. */
export function sectionOutline(s: SectionShape): { outer: Pt[]; holes: Pt[][] } {
  if (s.closed && s.solid) return { outer: s.points, holes: [] }
  const a = offsetLine(s.points, s.closed, s.thickness / 2), b = offsetLine(s.points, s.closed, -s.thickness / 2)
  if (!s.closed) return { outer: [...a, ...b.reverse()], holes: [] }
  return Math.abs(area(a)) >= Math.abs(area(b)) ? { outer: a, holes: [b] } : { outer: b, holes: [a] }
}

/** Ancho y alto totales del material (con el espesor de la chapa). */
export function sectionSize(s: SectionShape): { w: number; h: number } {
  const b = shapeBounds(sectionOutline(s).outer)
  return { w: Math.round(b.w), h: Math.round(b.h) }
}

/* ------------------------------ Cargar un dibujo de AutoCAD (DXF) ------------------------------ */

interface Path { points: Pt[]; closed: boolean }

/** Une tramos sueltos (líneas y arcos) que se tocan por las puntas. */
function chain(segs: Pt[][], tol: number): Path[] {
  const left = segs.map((s) => [...s])
  const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) <= tol
  const out: Path[] = []
  while (left.length) {
    let cur = left.pop()!
    for (let grown = true; grown;) {
      grown = false
      for (let i = 0; i < left.length; i++) {
        const s = left[i], a = cur[0], b = cur[cur.length - 1]
        if (near(b, s[0])) cur = [...cur, ...s.slice(1)]
        else if (near(b, s[s.length - 1])) cur = [...cur, ...[...s].reverse().slice(1)]
        else if (near(a, s[s.length - 1])) cur = [...s, ...cur.slice(1)]
        else if (near(a, s[0])) cur = [...[...s].reverse(), ...cur.slice(1)]
        else continue
        left.splice(i, 1); grown = true; break
      }
    }
    const closed = cur.length > 3 && near(cur[0], cur[cur.length - 1])
    out.push({ points: closed ? cur.slice(0, -1) : cur, closed })
  }
  return out
}

/**
 * Lee el corte de una pieza de un archivo DXF (texto): polilíneas, líneas y arcos. Se queda con el
 * trazo más grande. Devuelve la forma (cerrada = contorno macizo; abierta = chapa) o null si no hay.
 */
export function shapeFromDxf(text: string): SectionShape | null {
  const lines = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()])
  let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[k - 1]?.[1] === 'SECTION')
  if (i < 0) i = 0
  const paths: Path[] = [], segs: Pt[][] = []
  let poly: Path | null = null
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue }
    const type = pairs[i][1]
    if (type === 'ENDSEC' && paths.length + segs.length > 0) break
    const data: [number, string][] = []
    for (i++; i < pairs.length && pairs[i][0] !== 0; i++) data.push(pairs[i])
    const num = (code: number) => { const d = data.find((x) => x[0] === code); return d ? parseFloat(d[1]) : NaN }
    if (type === 'LWPOLYLINE') {
      const xs = data.filter((d) => d[0] === 10).map((d) => parseFloat(d[1])), ys = data.filter((d) => d[0] === 20).map((d) => parseFloat(d[1]))
      const pts = xs.map((x, k) => ({ x, y: ys[k] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      if (pts.length >= 2) paths.push({ points: pts, closed: (num(70) & 1) === 1 })
    } else if (type === 'POLYLINE') poly = { points: [], closed: (num(70) & 1) === 1 }
    else if (type === 'VERTEX' && poly) { const p = { x: num(10), y: num(20) }; if (Number.isFinite(p.x) && Number.isFinite(p.y)) poly.points.push(p) }
    else if (type === 'SEQEND' && poly) { if (poly.points.length >= 2) paths.push(poly); poly = null }
    else if (type === 'LINE') {
      const a = { x: num(10), y: num(20) }, b = { x: num(11), y: num(21) }
      if ([a.x, a.y, b.x, b.y].every(Number.isFinite)) segs.push([a, b])
    } else if (type === 'ARC') {
      const c = { x: num(10), y: num(20) }, r = num(40)
      let a0 = num(50), a1 = num(51)
      if ([c.x, c.y, r, a0, a1].every(Number.isFinite)) {
        if (a1 < a0) a1 += 360
        const n = Math.max(2, Math.ceil((a1 - a0) / 30))
        segs.push(Array.from({ length: n + 1 }, (_, k) => { const t = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) } }))
      }
    }
  }
  if (segs.length) {
    const all = segs.flat()
    const b = shapeBounds(all)
    paths.push(...chain(segs, Math.max(b.w, b.h) * 0.002 + 1e-6))
  }
  if (!paths.length) return null
  const size = (p: Path) => { const b = shapeBounds(p.points); return b.w * b.h + (b.w + b.h) }
  const best = paths.reduce((a, b) => (size(b) > size(a) ? b : a))
  let pts = best.points
  // demasiados puntos (curvas): se toma uno cada tantos
  if (pts.length > SHAPE_LIMITS.points) { const step = pts.length / SHAPE_LIMITS.points; pts = Array.from({ length: SHAPE_LIMITS.points }, (_, k) => pts[Math.floor(k * step)]) }
  // en AutoCAD la y va hacia arriba: se da vuelta
  return sanitizeShape({ points: pts.map((p) => ({ x: p.x, y: -p.y })), closed: best.closed, solid: best.closed, thickness: 2.5 }) ?? null
}
