/**
 * AYUDANTE: sin inteligencia artificial ni servicios externos. Tres cosas, todas con reglas:
 *  - entender un pedido escrito con frases simples ("depósito de 30 por 20 con racks de 6 m"),
 *  - encontrar la respuesta a una pregunta de uso en una lista,
 *  - proponer mejoras mirando el depósito armado.
 */
import { buildDepot, type Depot } from './plan/depot'
import { ROOF_CLEARANCE } from './plan/checks'
import type { LayoutOptions } from './plan/layout'
import { addObject, newId } from './plan/edit'
import type { Plan, SymbolKind } from './plan/types'
import { DESIGN_RULES, OBJECT_COLORS } from './rack/technicalSpecs'
import type { AccessoryConfig, FrameParts, RackConfiguration } from './rack/types'
import { metros } from './units'

const L = DESIGN_RULES.limits

/** Minúsculas, sin acentos ni signos: para comparar sin importar cómo se escribió. */
export const plain = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim()

/* ------------------------------ Pedidos ------------------------------ */

/** Dónde va algo: a tantos mm de la esquina de arriba a la izquierda del depósito, o en un rincón. */
export interface Place { x?: number; y?: number; corner?: 'tl' | 'tr' | 'bl' | 'br' | 'c' }
export type Wall = 'top' | 'right' | 'bottom' | 'left'
/** Algo que se dibuja en el plano. */
export type Shape =
  | { kind: 'zone'; w: number; d: number; at: Place; name: string }
  | { kind: 'area'; w: number; d: number; at: Place; orientation?: 'x' | 'y' }
  | { kind: 'aisle'; w: number; d: number; at: Place }
  | { kind: 'column'; at: Place; size: number }
  | { kind: 'grid'; dx: number; dy: number; size: number }
  | { kind: 'door'; width: number; wall: Wall; at?: number }
  | { kind: 'wall'; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: 'symbol'; what: SymbolKind; at: Place }
  | { kind: 'text'; text: string; at: Place }
  | { kind: 'object'; name: string; shape: 'caja' | 'cilindro'; w: number; d: number; h: number; color: string; at: Place }

export interface Order {
  depot?: { l: number; w: number }
  wallHeight?: number
  height?: number
  levels?: number
  width?: number
  depth?: number
  palletWeight?: number
  floorStorage?: boolean
  aisle?: number
  /** Pasillo de cabecera (contra las paredes). */
  endGap?: number
  /** Llenar el depósito solo. */
  fill?: boolean
  /** Filas dobles (espalda con espalda) o simples. */
  pair?: boolean
  /** Hacia dónde corren las filas: 'x' horizontales, 'y' verticales. */
  orientation?: 'x' | 'y'
  accessories?: Partial<AccessoryConfig>
  /** Lo que se dibuja en el plano: zonas, pasillos, columnas y portones. */
  shapes?: Shape[]
  /** Cantidad de módulos del rack elegido. */
  modules?: number
  /** Altura de una viga: la número `n` (de abajo hacia arriba, desde 1) a `h` mm del piso. */
  beamAt?: { n: number; h: number }[]
  /** Los pórticos: riendas y alto de cada columna. */
  frame?: FrameParts
}

const NUM = '(\\d+(?:[.,]\\d+)?)'
const UNIT = '(?:\\s*(?:m|mts?|metros?)\\b)?'
const SIZE = `${NUM}${UNIT}\\s*(?:x|por)\\s*${NUM}${UNIT}`
/** "en 5, 8" (metros desde la esquina de arriba a la izquierda) o un rincón dicho en palabras. */
const WHERE = `(?:\\s*(?:en\\s*${NUM}${UNIT}\\s*(?:,|\\by\\b)\\s*${NUM}${UNIT}|(arriba a la izquierda|arriba a la derecha|abajo a la izquierda|abajo a la derecha|en el centro|en el medio|al centro|al medio)))?`
const num = (v: string) => parseFloat(v.replace(',', '.'))
/** Un largo escrito en metros (6 · 2,7) o en milímetros (2700): devuelve milímetros. */
const mm = (v: string) => { const n = num(v); return Math.round(n < 100 ? n * 1000 : n) }
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))
const first = (t: string, patterns: string[]): string | undefined => {
  for (const p of patterns) { const hit = new RegExp(p).exec(t); if (hit) return hit[1] }
  return undefined
}
const CORNERS: Record<string, Place['corner']> = {
  'arriba a la izquierda': 'tl', 'arriba a la derecha': 'tr', 'abajo a la izquierda': 'bl', 'abajo a la derecha': 'br',
  'en el centro': 'c', 'en el medio': 'c', 'al centro': 'c', 'al medio': 'c',
}
const place = (x?: string, y?: string, corner?: string): Place => (x !== undefined && y !== undefined ? { x: mm(x), y: mm(y) } : corner ? { corner: CORNERS[corner] } : { corner: 'c' })
const COLORS: [RegExp, AccessoryConfig['beamColor']][] = [[/roj/, 'rojo'], [/naranj/, 'naranja'], [/amarill/, 'amarillo'], [/azul/, 'azul'], [/gris/, 'gris']]
const color = (w: string | undefined) => COLORS.find(([re]) => w && re.test(w))?.[1]
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/**
 * Saca de un renglón lo que se dibuja en el plano (zonas, pasillos marcados, columnas, portones) y
 * devuelve lo que sobra del renglón, para leerle las medidas generales.
 */
function takeShapes(line: string, shapes: Shape[], name?: string): string {
  let t = line
  const each = (re: string, use: (m: RegExpExecArray) => Shape | null) => {
    const rx = new RegExp(re, 'g')
    t = t.replace(rx, (...args) => { const sh = use(args.slice(0, -2) as unknown as RegExpExecArray); if (sh) shapes.push(sh); return sh ? ' ' : args[0] })
  }
  const POINT = `${NUM}${UNIT}\\s*(?:,|\\by\\b)\\s*${NUM}${UNIT}`
  const hex = (w: string | undefined) => OBJECT_COLORS.find((c) => c.id === w)?.hex ?? '#8f969d'
  const TINT = `(?:\\s*\\([^)]*\\))?(?:\\s*(?:de\\s*)?(?:color\\s*)?(${OBJECT_COLORS.map((c) => c.id).join('|')}))?`
  // objetos sueltos: una caja (largo por ancho por alto) o un cilindro (diámetro por alto), con su nombre entre paréntesis
  each(`(?:cajas?|objetos?|mesas?|maquinas?|tarimas?)\\s*(?:de\\s*)?${NUM}${UNIT}\\s*(?:x|por)\\s*${NUM}${UNIT}\\s*(?:x|por)\\s*${NUM}${UNIT}\\s*en\\s*${POINT}${TINT}`,
    (m) => ({ kind: 'object', shape: 'caja', w: mm(m[1]), d: mm(m[2]), h: mm(m[3]), at: { x: mm(m[4]), y: mm(m[5]) }, name: cap(name ?? 'caja'), color: hex(m[6]) }))
  each(`(?:cilindros?|tanques?|tambores?)\\s*(?:de\\s*)?${NUM}${UNIT}\\s*(?:x|por)\\s*${NUM}${UNIT}\\s*en\\s*${POINT}${TINT}`,
    (m) => ({ kind: 'object', shape: 'cilindro', w: mm(m[1]), d: mm(m[1]), h: mm(m[2]), at: { x: mm(m[3]), y: mm(m[4]) }, name: cap(name ?? 'cilindro'), color: hex(m[5]) }))
  each(`tabiques?\\s*(?:de|desde)?\\s*${POINT}\\s*(?:a|hasta)\\s*${POINT}`, (m) => ({ kind: 'wall', a: { x: mm(m[1]), y: mm(m[2]) }, b: { x: mm(m[3]), y: mm(m[4]) } }))
  const SYMBOLS: [string, SymbolKind][] = [['matafuegos?', 'matafuego'], ['hidrantes?', 'hidrante'], ['salidas?(?: de emergencia)?', 'salida'], ['botiquin(?:es)?', 'botiquin'], ['banos?', 'banio'],
    ['tableros?(?: electrico)?', 'tablero'], ['cargador(?:es)?(?: de baterias)?', 'cargador'], ['autoelevador(?:es)?', 'autoelevador'], ['personas?', 'persona'], ['picking', 'picking'], ['anden(?:es)?', 'anden']]
  for (const [word, what] of SYMBOLS) each(`(?:un\\s*|una\\s*)?${word}\\s*en\\s*${POINT}`, (m) => ({ kind: 'symbol', what, at: { x: mm(m[1]), y: mm(m[2]) } }))
  each(`(?:zona libre|zona sin racks|area libre|(oficinas?))\\s*(?:de\\s*)?${SIZE}${WHERE}(?:\\s*\\([^)]*\\))?`, (m) => ({ kind: 'zone', w: mm(m[2]), d: mm(m[3]), at: place(m[4], m[5], m[6]), name: cap(name ?? (m[1] ? 'oficina' : 'zona libre')) }))
  each(`zonas? de racks?\\s*(?:de\\s*)?${SIZE}${WHERE}(?:\\s*(?:con\\s*)?(?:filas\\s*)?(verticales|horizontales))?`, (m) => ({ kind: 'area', w: mm(m[1]), d: mm(m[2]), at: place(m[3], m[4], m[5]), ...(m[6] ? { orientation: m[6] === 'verticales' ? 'y' as const : 'x' as const } : {}) }))
  each(`pasillos?\\s*(?:marcado\\s*)?(?:de\\s*)?${SIZE}${WHERE}`, (m) => ({ kind: 'aisle', w: mm(m[1]), d: mm(m[2]), at: place(m[3], m[4], m[5]) }))
  each(`columnas?\\s*cada\\s*${NUM}${UNIT}(?:\\s*(?:x|por)\\s*${NUM}${UNIT})?(?:\\s*de\\s*${NUM}${UNIT})?`, (m) => ({ kind: 'grid', dx: mm(m[1]), dy: mm(m[2] ?? m[1]), size: m[3] ? mm(m[3]) : 400 }))
  each(`columnas?\\s*(?:de\\s*${NUM}${UNIT}\\s*)?en\\s*${NUM}${UNIT}\\s*(?:,|\\by\\b)\\s*${NUM}${UNIT}`, (m) => ({ kind: 'column', size: m[1] ? mm(m[1]) : 400, at: { x: mm(m[2]), y: mm(m[3]) } }))
  each(`porton(?:es)?\\s*(?:de\\s*${NUM}${UNIT}\\s*)?(?:en|sobre)?\\s*(?:la\\s*)?(?:pared\\s*)?(?:de\\s*)?(?:la\\s*)?(arriba|abajo|izquierda|derecha)(?:\\s*a\\s*${NUM}${UNIT})?`, (m) => ({
    kind: 'door', width: m[1] ? mm(m[1]) : 4000, wall: ({ arriba: 'top', abajo: 'bottom', izquierda: 'left', derecha: 'right' } as Record<string, Wall>)[m[2]], ...(m[3] ? { at: mm(m[3]) } : {}),
  }))
  return t
}

/**
 * Lee un pedido escrito, de una frase o de varios renglones (un "prompt" pegado). Entiende:
 *  - tabiques, símbolos (matafuego, salida, autoelevador, persona…), textos y objetos sueltos (cajas y cilindros);
 *  - el depósito ("30 por 20"), el techo, columnas ("columnas cada 10 por 8"), portones ("portón de 4 en
 *    la pared de abajo a 12"), zonas libres, zonas de racks y pasillos marcados ("… de 8 por 5 en 0, 0");
 *  - el rack: alto, niveles, largo de viga, profundidad, cantidad de módulos, la altura de una viga
 *    ("viga 2 a 3 m"), riendas y alto de cada columna del pórtico, peso del pallet, pallets en el piso;
 *    en metros, centímetros o milímetros;
 *  - la distribución: pasillo, pasillo de cabecera, filas simples o dobles, verticales u horizontales, "llenalo";
 *  - los accesorios y los colores.
 * Las posiciones son en metros desde la esquina de arriba a la izquierda. Lo que no reconoce, lo deja pasar.
 */
export function parseOrder(text: string): Order {
  const o: Order = {}
  const shapes: Shape[] = []
  const beamAt: NonNullable<Order['beamAt']> = []
  const frame: FrameParts = {}
  const count = (v: string, max: number) => Math.min(max, Math.max(0, parseInt(v, 10)))
  /** Lo que tiene número propio y se confundiría con otra medida: se lee y se saca del renglón. */
  const takeParts = (line: string) => line
    .replace(new RegExp(`(?:vigas?|nivel|plano)\\s*(?:numero\\s*|n\\s*)?(\\d)\\s*(?:a|en)\\s*${NUM}${UNIT}`, 'g'), (_m, n, h) => { beamAt.push({ n: parseInt(n, 10), h: mm(h) }); return ' ' })
    .replace(/(\d+)\s*riendas? diagonales|(?:riendas? )?diagonales\s*(?:de\s*)?(\d+)/g, (_m, a, b) => { frame.diagonals = count(a ?? b, 60); return ' ' })
    .replace(/(\d+)\s*riendas? horizontales|riendas? horizontales\s*(?:de\s*)?(\d+)/g, (_m, a, b) => { frame.horizontals = count(a ?? b, 20); return ' ' })
    .replace(new RegExp(`columnas? de (adelante|atras)\\s*(?:de|a)?\\s*${NUM}${UNIT}`, 'g'), (_m, side, h) => { frame[side === 'adelante' ? 'frontHeight' : 'backHeight'] = clamp(mm(h), L.height); return ' ' })
  // centímetros y milímetros pasan a metros, que es como se lee todo lo demás
  const metric = (line: string) => line
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:cm|centimetros?)\b/g, (_m, v) => `${num(v) / 100} m`)
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mm|milimetros?)\b/g, (_m, v) => `${num(v) / 1000} m`)
  // los textos se leen antes que nada, tal como se escribieron (con sus mayúsculas)
  text = text.replace(new RegExp(`textos?\\s*["“'«]([^"”'»\\n]{1,40})["”'»]\\s*en\\s*${NUM}\\s*(?:,|\\by\\b)\\s*${NUM}`, 'gi'), (_m, words, x, y) => { shapes.push({ kind: 'text', text: String(words).trim(), at: { x: mm(x), y: mm(y) } }); return ' ' })
  // renglón por renglón: primero lo que se dibuja; con lo que sobra, las medidas generales
  const t = text.split(/\n|;|\.(?=\s|$)/).filter((raw) => plain(raw)).map((raw) => takeShapes(takeParts(metric(plain(raw))), shapes, /\(([^)]{1,40})\)/.exec(raw)?.[1].trim())).join(' , ')
  if (shapes.length) o.shapes = shapes.slice(0, 80)
  if (beamAt.length) o.beamAt = beamAt
  if (Object.keys(frame).length) o.frame = frame
  const modules = first(t, ['(\\d+)\\s*modulos?\\b'])
  if (modules) o.modules = Math.min(120, Math.max(1, parseInt(modules, 10)))

  const dep = new RegExp(`${NUM}${UNIT}\\s*(?:x|por)\\s*${NUM}`).exec(t)
  if (dep) {
    const l = mm(dep[1]), w = mm(dep[2])
    // dos medidas grandes son el depósito (un pallet de 1 x 1,2 no)
    if ((/deposito|galpon|nave|lugar|local/.test(t) || Math.min(l, w) >= 5000) && l >= 2000 && w >= 2000 && l <= 2_000_000 && w <= 2_000_000) o.depot = { l, w }
  }

  const roof = first(t, [`techo\\s*(?:de|a|en)?\\s*${NUM}`, `${NUM}${UNIT}\\s*de\\s*techo`])
  if (roof) o.wallHeight = Math.min(30_000, Math.max(2500, mm(roof)))

  const levels = first(t, ['(\\d+)\\s*niveles', 'niveles?\\s*(\\d+)'])
  if (levels) o.levels = clamp(parseInt(levels, 10), L.levels)

  const height = first(t, [
    `(?:altura|alto|altos)\\s*(?:de\\s*)?${NUM}`, `${NUM}${UNIT}\\s*de\\s*(?:alto|altura)`,
    `racks?\\s*(?:de|a)\\s*${NUM}\\s*(?:m|mts?|metros?)\\b`,
  ])
  if (height) o.height = clamp(mm(height), L.height)

  const width = first(t, [`(?:vigas?|largo de viga|modulos?)\\s*(?:de\\s*)?${NUM}`, `${NUM}${UNIT}\\s*de\\s*viga`])
  if (width) o.width = clamp(mm(width), L.width)

  const depth = first(t, [`(?:profundidad|fondo)\\s*(?:de\\s*)?${NUM}`, `${NUM}${UNIT}\\s*de\\s*(?:fondo|profundidad)`])
  if (depth) o.depth = clamp(mm(depth), L.depth)

  const tons = first(t, [`${NUM}\\s*(?:toneladas?|tn|t)\\b`])
  const kilos = first(t, [`${NUM}\\s*(?:kg|kilos?|kgs)\\b`])
  if (tons) o.palletWeight = clamp(Math.round(num(tons) * 1000), L.palletWeight)
  else if (kilos) o.palletWeight = clamp(Math.round(num(kilos.replace(/\.(\d{3})\b/, '$1'))), L.palletWeight)

  if (/sin pallets? en el piso|piso libre|sin usar el piso/.test(t)) o.floorStorage = false
  else if (/pallets? en el piso|usar el piso|piso como (primer )?nivel/.test(t)) o.floorStorage = true

  const endGap = first(t, [`cabeceras?\\s*(?:de\\s*)?${NUM}`])
  if (endGap) o.endGap = Math.min(8000, Math.max(0, mm(endGap)))
  const aisle = first(t, [`pasillos?\\s*(?:de\\s*)?${NUM}`])
  if (aisle) o.aisle = Math.min(6000, Math.max(1200, mm(aisle)))

  if (/espalda con espalda|\bdobles?\b/.test(t)) o.pair = true
  else if (/\bsimples?\b/.test(t)) o.pair = false
  if (/\bverticales?\b/.test(t)) o.orientation = 'y'
  else if (/\bhorizontales?\b/.test(t)) o.orientation = 'x'

  // accesorios y colores
  const acc: Partial<AccessoryConfig> = {}
  if (/sin protector/.test(t)) acc.protectors = 'none'
  else if (/protector/.test(t)) acc.protectors = /extremo|cabecera|punta/.test(/protector[^,]*/.exec(t)?.[0] ?? '') ? 'ends' : 'all'
  if (/sin malla de fondo/.test(t)) acc.backMesh = false
  else if (/malla de fondo|malla anticaida/.test(t)) acc.backMesh = true
  if (/sin defensa/.test(t)) acc.guardrails = false
  else if (/defensa|baranda/.test(t)) acc.guardrails = true
  if (/carteles? de fila/.test(t)) acc.rowSigns = true
  if (/carteles? de capacidad|carteles? de carga|\bcarteles\b(?! de fila)/.test(t)) acc.capacitySigns = true
  if (/guia (en el |de )?piso|guias? para el auto/.test(t)) acc.floorGuide = true
  if (/travesan/.test(t)) acc.palletSupports = true
  if (/conectores? superior/.test(t)) acc.topTies = true
  if (/cruces|arriostramiento/.test(t)) acc.crossBracing = true
  const deck = /pisos? de (madera|malla|chapa)/.exec(t)?.[1]
  if (deck) acc.decking = deck === 'madera' ? 'wood' : deck === 'malla' ? 'mesh' : 'steel'
  const beamColor = color(/vigas? (?:de color |color |en )?(roj\w*|naranj\w*|amarill\w*|azul\w*|gris\w*)/.exec(t)?.[1])
  if (beamColor) acc.beamColor = beamColor
  const up = /(?:parantes?|columnas?) (?:de color |color |en )?(roj\w*|naranj\w*|amarill\w*|azul\w*|gris\w*|galvaniz\w*)/.exec(t)?.[1]
  if (up) acc.uprightColor = /galvaniz/.test(up) ? 'galvanizado' : color(up)
  const protColor = color(/protector\w* (?:de color |color |en )?(roj\w*|naranj\w*|amarill\w*|azul\w*|gris\w*)/.exec(t)?.[1])
  if (protColor) acc.protectorColor = protColor
  if (Object.keys(acc).length) o.accessories = acc

  if (/\bllen|\bcomplet|solo\b.*\brack|arma(lo|me|r)?\b|acomod|pone(r|me)? (los )?racks/.test(t)) o.fill = true
  return o
}

export const isEmptyOrder = (o: Order) => Object.keys(o).length === 0

/** Las alturas de las vigas con las que pide el pedido: sin pasar el tope y sin pisar a las vecinas. */
export function withBeams(elevs: number[], beamAt: NonNullable<Order['beamAt']>, height: number): number[] {
  const arr = [...elevs], GAP = 200, top = height - DESIGN_RULES.topMargin
  for (const { n: k, h } of beamAt) {
    const i = k - 1
    if (i < 0 || i >= arr.length) continue
    arr[i] = Math.max(50 + i * GAP, Math.min(h, top - (arr.length - 1 - i) * GAP))
    for (let j = i + 1; j < arr.length; j++) arr[j] = Math.max(arr[j], arr[j - 1] + GAP)
    for (let j = i - 1; j >= 0; j--) arr[j] = Math.min(arr[j], arr[j + 1] - GAP)
  }
  return arr
}

const SYMBOL_NAME: Record<SymbolKind, string> = {
  matafuego: 'Matafuego', hidrante: 'Hidrante', salida: 'Salida de emergencia', botiquin: 'Botiquín', banio: 'Baño', tablero: 'Tablero eléctrico',
  cargador: 'Cargador de baterías', autoelevador: 'Autoelevador', picking: 'Picking', anden: 'Andén', persona: 'Persona',
}
const WALL_NAME: Record<Wall, string> = { top: 'de arriba', bottom: 'de abajo', left: 'de la izquierda', right: 'de la derecha' }
const CORNER_NAME: Record<NonNullable<Place['corner']>, string> = { tl: 'arriba a la izquierda', tr: 'arriba a la derecha', bl: 'abajo a la izquierda', br: 'abajo a la derecha', c: 'en el centro' }
const where = (at: Place) => (at.corner ? CORNER_NAME[at.corner] : `a ${metros(at.x ?? 0)} y ${metros(at.y ?? 0)} de la esquina`)

/** El pedido dicho en palabras, renglón por renglón (para confirmar lo que se entendió). */
export function describeOrder(o: Order): string[] {
  const out: string[] = []
  if (o.depot) out.push(`Depósito de ${metros(o.depot.l)} × ${metros(o.depot.w)}`)
  if (o.wallHeight) out.push(`Techo a ${metros(o.wallHeight)}`)
  for (const sh of o.shapes ?? []) {
    if (sh.kind === 'zone') out.push(`${sh.name} de ${metros(sh.w)} × ${metros(sh.d)}, ${where(sh.at)} (ahí no van racks)`)
    else if (sh.kind === 'area') out.push(`Zona de racks de ${metros(sh.w)} × ${metros(sh.d)}, ${where(sh.at)}${sh.orientation ? `, con filas ${sh.orientation === 'y' ? 'verticales' : 'horizontales'}` : ''}`)
    else if (sh.kind === 'aisle') out.push(`Pasillo marcado de ${metros(sh.w)} × ${metros(sh.d)}, ${where(sh.at)}`)
    else if (sh.kind === 'grid') out.push(`Columnas cada ${metros(sh.dx)} × ${metros(sh.dy)}`)
    else if (sh.kind === 'column') out.push(`Columna ${where(sh.at)}`)
    else if (sh.kind === 'wall') out.push(`Tabique de ${metros(Math.round(Math.hypot(sh.b.x - sh.a.x, sh.b.y - sh.a.y)))} de largo`)
    else if (sh.kind === 'symbol') out.push(`${SYMBOL_NAME[sh.what]}, ${where(sh.at)}`)
    else if (sh.kind === 'text') out.push(`Texto "${sh.text}"`)
    else if (sh.kind === 'object') out.push(`${sh.name} (${sh.shape === 'caja' ? `caja de ${metros(sh.w)} × ${metros(sh.d)} × ${metros(sh.h)}` : `cilindro de ${metros(sh.w)} × ${metros(sh.h)} de alto`}), ${where(sh.at)}`)
    else out.push(`Portón de ${metros(sh.width)} en la pared ${WALL_NAME[sh.wall]}${sh.at !== undefined ? `, a ${metros(sh.at)}` : ', en el medio'}`)
  }
  if (o.modules) out.push(`${o.modules} ${o.modules === 1 ? 'módulo' : 'módulos'}`)
  if (o.height) out.push(`Racks de ${metros(o.height)} de alto`)
  if (o.levels) out.push(`${o.levels} niveles`)
  for (const b of o.beamAt ?? []) out.push(`Viga ${b.n} a ${metros(b.h)} del piso`)
  if (o.frame?.diagonals !== undefined) out.push(`${o.frame.diagonals} riendas diagonales por pórtico`)
  if (o.frame?.horizontals !== undefined) out.push(`${o.frame.horizontals} riendas horizontales por pórtico`)
  if (o.frame?.frontHeight) out.push(`Columna de adelante de ${metros(o.frame.frontHeight)}`)
  if (o.frame?.backHeight) out.push(`Columna de atrás de ${metros(o.frame.backHeight)}`)
  if (o.width) out.push(`Vigas de ${metros(o.width)}`)
  if (o.depth) out.push(`Profundidad de ${metros(o.depth)}`)
  if (o.palletWeight) out.push(`Pallets de ${o.palletWeight.toLocaleString('es-AR')} kg`)
  if (o.floorStorage !== undefined) out.push(o.floorStorage ? 'Con pallets en el piso' : 'Sin pallets en el piso')
  if (o.aisle) out.push(`Pasillos de ${metros(o.aisle)}`)
  if (o.endGap !== undefined) out.push(`Pasillo de cabecera de ${metros(o.endGap)}`)
  if (o.pair !== undefined) out.push(o.pair ? 'Filas dobles (espalda con espalda)' : 'Filas simples')
  if (o.orientation) out.push(o.orientation === 'y' ? 'Filas verticales' : 'Filas horizontales')
  const a = o.accessories
  if (a) {
    if (a.protectors) out.push(a.protectors === 'all' ? 'Protectores en todas las columnas' : a.protectors === 'ends' ? 'Protectores en los extremos' : 'Sin protectores')
    if (a.backMesh !== undefined) out.push(a.backMesh ? 'Malla de fondo' : 'Sin malla de fondo')
    if (a.guardrails !== undefined) out.push(a.guardrails ? 'Defensas de cabecera' : 'Sin defensas de cabecera')
    if (a.capacitySigns) out.push('Carteles de capacidad')
    if (a.rowSigns) out.push('Carteles de fila')
    if (a.floorGuide) out.push('Guía en el piso')
    if (a.palletSupports) out.push('Travesaños de apoyo de pallet')
    if (a.topTies) out.push('Conectores superiores')
    if (a.crossBracing) out.push('Cruces de arriostramiento')
    if (a.decking) out.push(`Piso de ${a.decking === 'wood' ? 'madera' : a.decking === 'mesh' ? 'malla' : 'chapa'} en los niveles`)
    if (a.beamColor) out.push(`Vigas color ${a.beamColor}`)
    if (a.uprightColor) out.push(`Parantes color ${a.uprightColor}`)
    if (a.protectorColor) out.push(`Protecciones color ${a.protectorColor}`)
  }
  if (o.fill) out.push('Racks acomodados solos')
  return out
}

/**
 * Dibuja en el plano lo que pide el pedido. Las posiciones se miden desde la esquina de arriba a la
 * izquierda del depósito; lo que se sale, se corre para adentro. Devuelve también lo que no se pudo poner.
 */
export function applyShapes(plan: Plan, shapes: Shape[]): { plan: Plan; notes: string[] } {
  const notes: string[] = []
  if (plan.outline.points.length < 3) return { plan, notes: ['Para dibujar zonas, columnas o portones primero hace falta el depósito.'] }
  const xs = plan.outline.points.map((q) => q.x), ys = plan.outline.points.map((q) => q.y)
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
  const rect = (w: number, d: number, at: Place) => {
    const W = Math.min(w, x1 - x0), D = Math.min(d, y1 - y0)
    const c = at.corner
    const x = c ? (c === 'tl' || c === 'bl' ? x0 : c === 'c' ? (x0 + x1 - W) / 2 : x1 - W) : x0 + (at.x ?? 0)
    const y = c ? (c === 'tl' || c === 'tr' ? y0 : c === 'c' ? (y0 + y1 - D) / 2 : y1 - D) : y0 + (at.y ?? 0)
    return { x: Math.round(Math.min(Math.max(x, x0), x1 - W)), y: Math.round(Math.min(Math.max(y, y0), y1 - D)), w: W, d: D }
  }
  let next: Plan = plan
  const pts = plan.outline.points
  for (const sh of shapes) {
    if (sh.kind === 'zone') next = { ...next, zones: [...next.zones, { id: newId('z'), ...rect(sh.w, sh.d, sh.at), name: sh.name }] }
    else if (sh.kind === 'area') {
      const list = next.rackAreas ?? []
      next = { ...next, rackAreas: [...list, { id: newId('a'), ...rect(sh.w, sh.d, sh.at), name: `Zona ${String.fromCharCode(65 + Math.min(25, list.length))}`, ...(sh.orientation ? { orientation: sh.orientation } : {}) }] }
    } else if (sh.kind === 'aisle') next = { ...next, aisles: [...(next.aisles ?? []), { id: newId('p'), ...rect(sh.w, sh.d, sh.at) }] }
    else if (sh.kind === 'column') {
      const r = rect(sh.size, sh.size, sh.at.corner ? sh.at : { x: (sh.at.x ?? 0) - sh.size / 2, y: (sh.at.y ?? 0) - sh.size / 2 })
      next = { ...next, columns: [...next.columns, { id: newId('c'), x: r.x + sh.size / 2, y: r.y + sh.size / 2, shape: 'rect', w: sh.size, d: sh.size }] }
    } else if (sh.kind === 'wall') {
      const pt = (q: { x: number; y: number }) => ({ x: Math.min(Math.max(x0 + q.x, x0), x1), y: Math.min(Math.max(y0 + q.y, y0), y1) })
      next = { ...next, walls: [...next.walls, { id: newId('w'), a: pt(sh.a), b: pt(sh.b), thickness: 150 }] }
    } else if (sh.kind === 'symbol' || sh.kind === 'text' || sh.kind === 'object') {
      const r = rect(0, 0, sh.at)
      if (sh.kind === 'symbol') next = { ...next, symbols: [...(next.symbols ?? []), { id: newId('s'), x: r.x, y: r.y, kind: sh.what }] }
      else if (sh.kind === 'text') next = { ...next, texts: [...(next.texts ?? []), { id: newId('t'), x: r.x, y: r.y, text: sh.text, size: 600 }] }
      else next = addObject(next, { name: sh.name, shape: sh.shape, w: sh.w, d: sh.d, h: sh.h, color: sh.color }, r).plan
    } else if (sh.kind === 'grid') {
      const cols: Plan['columns'] = []
      for (let x = x0 + sh.dx; x < x1 - 1 && cols.length < 400; x += Math.max(1000, sh.dx))
        for (let y = y0 + sh.dy; y < y1 - 1 && cols.length < 400; y += Math.max(1000, sh.dy)) cols.push({ id: newId('c'), x, y, shape: 'rect', w: sh.size, d: sh.size })
      if (cols.length) next = { ...next, columns: [...next.columns, ...cols] }
      else notes.push(`No entran columnas cada ${metros(sh.dx)} × ${metros(sh.dy)} en este depósito.`)
    } else {
      // la pared de ese lado: un tramo recto del contorno que corre por el borde
      const edge = pts.findIndex((a, i) => {
        const b = pts[(i + 1) % pts.length]
        if (sh.wall === 'top' || sh.wall === 'bottom') return a.y === b.y && a.y === (sh.wall === 'top' ? y0 : y1) && a.x !== b.x
        return a.x === b.x && a.x === (sh.wall === 'left' ? x0 : x1) && a.y !== b.y
      })
      if (edge < 0) { notes.push(`No encontré una pared recta ${WALL_NAME[sh.wall]} para el portón: ponelo a mano con la herramienta "Portón".`); continue }
      const a = pts[edge], b = pts[(edge + 1) % pts.length]
      const horizontal = sh.wall === 'top' || sh.wall === 'bottom'
      const from = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y), len = Math.abs(horizontal ? b.x - a.x : b.y - a.y)
      const width = Math.min(sh.width, len)
      const centre = Math.min(Math.max(sh.at ?? len / 2, width / 2), len - width / 2)
      const target = from + centre, start = horizontal ? a.x : a.y, endp = horizontal ? b.x : b.y
      next = { ...next, doors: [...next.doors, { id: newId('d'), edge, t: (target - start) / (endp - start), width, height: 4500 }] }
    }
  }
  return { plan: next, notes }
}

/* ------------------------------ Preguntas de uso ------------------------------ */

export interface Faq {
  id: string
  /** La pregunta, como se muestra. */
  q: string
  /** Palabras (o pedazos de palabra) que la delatan. */
  keys: string[]
  /** La respuesta, paso por paso. */
  steps: string[]
}

export const FAQS: Faq[] = [
  { id: 'copiar', q: '¿Cómo copio un rack?', keys: ['copi', 'pegar', 'pego', 'duplic', 'repet', 'control c', 'ctrl'],
    steps: ['Tocá el rack en el plano o en 3D.', 'Tocá "Copiar" en la barra negra (o Ctrl+C).', 'Apretá Ctrl+V y hacé clic donde va la copia. Podés pegar varias veces.', 'Esc para terminar. Si la copia queda a continuación de otro rack, se une a él y comparten el pórtico.'] },
  { id: 'viga', q: '¿Cómo saco una viga para que pase el autoelevador?', keys: ['saco una viga', 'sacar una viga', 'viga', 'borrar una viga', 'paso libre', 'pasar el auto', 'camioncito', 'cochecito', 'tunel'],
    steps: ['Tocá el rack y después "Editar".', 'En "Piezas de este rack" elegí el módulo (Módulo 1, 2…).', 'Al lado de cada viga hay un tacho: tocalo para sacarla.', 'Para dejar libre abajo, prendé "Paso libre abajo" en ese módulo.'] },
  { id: 'modulos', q: '¿Cómo agrego módulos a un rack?', keys: ['agreg', 'sumar modul', 'mas modul', 'modulo', 'alargar', 'mas largo', 'adicional'],
    steps: ['Tocá el rack en el plano.', 'Tocá el "+" que aparece en cada punta del rack, o usá los botones + y − de "módulos" en la barra negra.', 'El módulo nuevo comparte el pórtico con el anterior.'] },
  { id: 'inicial', q: '¿Cómo pongo el módulo inicial?', keys: ['modulo inicial', 'primer rack', 'poner un rack', 'pongo un rack', 'empezar los racks', 'inicial'],
    steps: ['Armá el módulo en el paso 2 (Rack): medidas, vigas, pórticos y accesorios.', 'Andá al paso 4 (Distribución) y elegí "Lo armo yo".', 'Tocá "Poner un módulo inicial" y después hacé clic en el plano donde va.', 'Después lo alargás con el "+" o lo copiás con Ctrl+C y Ctrl+V.'] },
  { id: 'partir', q: '¿Cómo parto o uno filas de racks?', keys: ['partir', 'parto', 'cortar', 'dividir', 'tijera', 'unir', 'uno dos', 'juntar'],
    steps: ['Para partir: tocá el rack y la tijera de la barra negra lo corta al medio. En "Editar" podés elegir en qué módulo cortarlo.', 'Para unir: elegí varios racks con Shift + clic y tocá "Unir en uno".'] },
  { id: 'rojo', q: '¿Por qué hay racks en rojo?', keys: ['rojo', 'roja', 'colorad', 'mal ubicad', 'problema', 'error'],
    steps: ['Un rack se pone rojo cuando está mal ubicado: pisa una zona libre o un pasillo, choca con una columna o un tabique, se pisa con otro rack o queda fuera del depósito.', 'En 3D, arriba de cada rack rojo hay un cartel con el motivo.', 'Se arregla moviendo el rack, o cambiando la zona si la marcaste de más.', 'Pedime "Revisar mi depósito" y te los muestro uno por uno.'] },
  { id: 'zonas', q: '¿Cómo marco dónde van los racks, los pasillos y las zonas libres?', keys: ['zona', 'pasillo', 'marcar', 'marco', 'libre', 'oficina', 'donde van'],
    steps: ['Zona de racks (azul) y Pasillo (amarillo): paso 4 (Distribución), panel "Dónde van los racks". Elegís la herramienta y arrastrás un rectángulo en el plano.', 'Zona libre (roja, donde NO van racks): panel "Herramientas", botón "Zona libre", y clic en el plano.', 'Si no marcás ninguna zona de racks, se usa todo el depósito.'] },
  { id: 'llenar', q: '¿Cómo hago para que se llene solo?', keys: ['llen', 'solo', 'automatic', 'cuantos entran', 'cuantos racks'],
    steps: ['Andá al paso 4 (Distribución).', 'En "¿Cómo armás los racks?" elegí "Se llena solo".', 'El sistema acomoda filas y pasillos esquivando columnas, portones y zonas libres.', 'Con "Lo armo yo" después podés mover o cambiar cualquier rack.'] },
  { id: '3d', q: '¿Cómo lo veo en 3D o caminando?', keys: ['3d', 'tres d', 'caminar', 'a pie', 'recorrer', 'ver el deposito', 'persona', 'autoelevador', 'escala'],
    steps: ['Arriba del plano tocá "3D". Arrastrás para girar y con la rueda te acercás.', '"A pie" te deja caminar adentro: clic en el piso para ir hasta ahí.', 'Los botones de la persona y el autoelevador ponen figuras para ver el tamaño real.', 'Con el candado en "Bloqueado" no movés nada sin querer; tocalo para editar en 3D.'] },
  { id: 'bloquear', q: '¿Cómo hago para no mover cosas sin querer en 3D?', keys: ['bloque', 'candado', 'sin querer', 'se mueve', 'desbloque'],
    steps: ['Arriba del 3D está el candado. En "Bloqueado" podés girar la vista y elegir cosas, pero nada se mueve.', 'Tocalo y pasa a "Editando": ahí sí arrastrás racks, zonas y objetos.'] },
  { id: 'compartir', q: '¿Cómo paso mis piezas a otra computadora?', keys: ['otra computadora', 'otra compu', 'compartir', 'pasar mis piezas', 'pasarle', 'guardar mis piezas', 'archivo de piezas', 'importar', 'llevar'],
    steps: ['Abrí "Mis piezas".', 'Abajo de la lista tocá "Guardar en un archivo": baja un archivo con todas tus vigas, parantes y objetos.', 'Mandá ese archivo (por mail o WhatsApp).', 'En la otra computadora: "Mis piezas", "Cargar de un archivo", y se suman a las que ya había.'] },
  { id: 'piezas', q: '¿Cómo creo mis propias piezas (vigas, parantes, objetos)?', keys: ['pieza', 'fierr', 'perfil', 'dibujar', 'forma', 'parante', 'objeto', 'caja', 'dxf', 'autocad', 'doblar', 'chapa'],
    steps: ['Tocá "Mis piezas" arriba.', '"Nueva viga", "Nuevo parante" o "Nuevo objeto".', 'Poné las medidas o tocá "Dibujar la forma con puntos". Con "Otra forma" una pieza puede tener varias chapas. También se carga un dibujo de AutoCAD (DXF).', 'Para usarla: "Usar en todos los racks" o "Elegir los racks…". Los objetos se ponen con "Poner en el depósito".'] },
  { id: 'porticos', q: '¿Cómo cambio las riendas, las bases o el alto de una columna?', keys: ['rienda', 'base', 'portico', 'columna', 'arriostr', 'mas alta', 'bastidor'],
    steps: ['Para todos los pórticos: paso 2 (Rack), grupo "Pórticos".', 'Para uno solo: tocá el rack en el plano, "Editar", y en "Piezas de este rack" elegí el pórtico (Pórtico 1, 2…).', 'Ahí cambiás las riendas diagonales y horizontales, el alto de cada columna y si lleva cada base.'] },
  { id: 'medidas', q: '¿Cómo cambio el alto, los niveles o el largo de viga?', keys: ['alto', 'altura', 'nivel', 'largo de viga', 'ancho', 'profundidad', 'medida', 'mas ancho', 'mas alto'],
    steps: ['Para todos los racks: paso 2 (Rack). Ahí están el largo de viga, la profundidad, la altura, los niveles y cada viga.', 'Para un rack solo: tocalo en el plano, "Editar", y abrí "Todo este rack".', 'También me lo podés escribir: "racks de 7 metros con 4 niveles".'] },
  { id: 'accesorios', q: '¿Dónde están los accesorios y los colores?', keys: ['accesorio', 'protector', 'defensa', 'malla', 'piso', 'color', 'cartel', 'guia'],
    steps: ['En el paso 2 (Rack), panel "Accesorios".', 'Hay cinco grupos: Protección, Pisos y niveles, Refuerzos, Señalización y Colores.', 'Lo que elijas va en todos los racks y se ve al momento en el 3D.'] },
  { id: 'materiales', q: '¿Dónde veo la lista de materiales?', keys: ['material', 'lista', 'presupuesto', 'cotiz', 'piezas en total', 'descargar', 'resumen', 'precio'],
    steps: ['En el paso 5 (Resumen) está el depósito completo con todas las piezas.', '"Descargar lista (CSV)" baja la lista en un archivo que se abre con Excel.', 'Para pasarle todo a otra persona: esa lista y la lámina en PDF del panel "Exportar".'] },
  { id: 'exportar', q: '¿Cómo saco el plano en PDF o para AutoCAD?', keys: ['pdf', 'imprimir', 'exportar', 'lamina', 'guardar el plano', 'dwg'],
    steps: ['Abrí el panel "Exportar" (pasos Depósito, Distribución y Resumen).', '"Lámina para PDF / imprimir" abre el cuadro de impresión: elegí "Guardar como PDF".', '"Archivo para AutoCAD (DXF)" baja el plano con una capa por cosa.'] },
  { id: 'deshacer', q: '¿Cómo deshago algo?', keys: ['deshac', 'volver atras', 'me equivoque', 'ctrl z', 'control z', 'borre sin querer'],
    steps: ['Ctrl+Z deshace lo último que hiciste en el plano. Ctrl+Y lo vuelve a hacer.', 'Para borrar algo: tocalo y apretá Supr, o usá el tacho de la barra negra.', '"Empezar de nuevo" (arriba) borra todo el plano y el rack.'] },
  { id: 'deposito', q: '¿Cómo dibujo el depósito?', keys: ['dibujar el deposito', 'crear el deposito', 'hago un deposito', 'hacer un deposito', 'deposito', 'contorno', 'pared', 'porton', 'columna del deposito', 'galpon', 'forma en l'],
    steps: ['Paso 1 (Depósito): escribí el largo y el ancho y tocá "Crear depósito".', 'Si no es un rectángulo: "Dibujarlo a mano" y hacés clic en cada esquina.', 'En "Herramientas" agregás columnas, tabiques, portones y zonas libres.', 'También me lo podés escribir: "depósito de 30 por 20".'] },
]

/** La pregunta de la lista que más se parece a lo que se escribió (o null si ninguna se parece). */
export function findFaq(text: string): Faq | null {
  const t = plain(text)
  let best: Faq | null = null, score = 0
  for (const f of FAQS) {
    // las claves largas (o de varias palabras) valen más: son más específicas
    const s = f.keys.reduce((n, k) => (t.includes(k) ? n + (k.includes(' ') ? 3 : k.length >= 6 ? 2 : 1) : n), 0)
    if (s > score) { best = f; score = s }
  }
  return score >= 1 ? best : null
}

export type Intent = 'revisar' | 'sugerir' | 'pregunta' | 'pedido' | 'nada'

/** Qué se está pidiendo: revisar, sugerir, una pregunta de uso o un pedido para armar. */
export function intentOf(text: string): Intent {
  const t = plain(text)
  if (!t) return 'nada'
  // un pedido con el depósito o con cosas para dibujar (un "prompt" pegado) es un pedido, diga lo que diga
  const o = parseOrder(text)
  if ((o.depot || o.shapes?.length) && !/^(como|donde|por que|porque|puedo|se puede)\b/.test(t)) return 'pedido'
  if (/\brevis|que esta mal|esta bien|chequea|control(a|ar)\b/.test(t)) return 'revisar'
  if (/suger|mejor(a|ar|as)\b|consej|optimi|aprovech|entran mas/.test(t)) return 'sugerir'
  const asks = /^(como|donde|por que|porque|que |cual|puedo|se puede|para que)\b/.test(t) || text.includes('?')
  if (asks) return findFaq(t) ? 'pregunta' : isEmptyOrder(o) ? 'nada' : 'pedido'
  if (!isEmptyOrder(o)) return 'pedido'
  return findFaq(t) ? 'pregunta' : 'nada'
}

/* ------------------------------ Sugerencias ------------------------------ */

export type SuggestionAction =
  | { kind: 'layout'; patch: Partial<LayoutOptions> }
  | { kind: 'config'; patch: Partial<RackConfiguration> }
  | { kind: 'accessories'; patch: Partial<AccessoryConfig> }
  | { kind: 'fill' }

export interface Suggestion { text: string; label?: string; action?: SuggestionAction }

const n = (v: number) => v.toLocaleString('es-AR')

/** Mejoras posibles para este depósito, de la que más rinde a la que menos. */
export function suggestions(plan: Plan, config: RackConfiguration, layout: LayoutOptions, depot: Depot): Suggestion[] {
  const out: Suggestion[] = []
  if (plan.outline.points.length < 3) return [{ text: 'Todavía no hay depósito. Creá uno en el paso 1 o escribime, por ejemplo, "depósito de 30 por 20".' }]
  const racks = depot.layout.placements.length

  if (!racks) out.push({ text: 'Todavía no hay racks en el depósito. Los puedo acomodar solos para ver cuántos entran.', label: 'Llenarlo solo', action: { kind: 'fill' } })

  // con los racks acomodados solos se pueden probar otras distribuciones y comparar
  const auto = { ...plan, racks: undefined }
  const tryLayout = (patch: Partial<LayoutOptions>) => buildDepot(auto, config, { ...layout, ...patch }).positions
  if (racks && !depot.manual) {
    const turned = tryLayout({ orientation: layout.orientation === 'x' ? 'y' : 'x' })
    if (turned > depot.positions) out.push({ text: `Girando las filas entran ${n(turned - depot.positions)} posiciones más (${n(turned)} en total).`, label: 'Girar las filas', action: { kind: 'layout', patch: { orientation: layout.orientation === 'x' ? 'y' : 'x' } } })
    if (!layout.backToBack) {
      const pair = tryLayout({ backToBack: true })
      if (pair > depot.positions) out.push({ text: `Con filas dobles (espalda con espalda) entran ${n(pair - depot.positions)} posiciones más.`, label: 'Poner filas dobles', action: { kind: 'layout', patch: { backToBack: true } } })
    }
    if (layout.aisle > 3200) {
      const tight = tryLayout({ aisle: 3000 })
      if (tight > depot.positions) out.push({ text: `Los pasillos son de ${metros(layout.aisle)}. Con 3 m (lo habitual) entran ${n(tight - depot.positions)} posiciones más.`, label: 'Pasillos de 3 m', action: { kind: 'layout', patch: { aisle: 3000 } } })
    }
  } else if (racks) {
    const best = Math.max(tryLayout({}), tryLayout({ orientation: layout.orientation === 'x' ? 'y' : 'x' }))
    if (best > depot.positions * 1.1) out.push({ text: `Armándolo a mano tenés ${n(depot.positions)} posiciones. Si lo acomoda el sistema entran hasta ${n(best)}. Podés probarlo en el paso 4 con "Se llena solo" (Ctrl+Z vuelve atrás).` })
  }

  // lugar que sobra para arriba
  const room = plan.wallHeight - ROOF_CLEARANCE - config.height
  if (racks && room >= 1500 && config.levels < L.levels.max && config.height < L.height.max) {
    const height = Math.min(L.height.max, Math.floor((plan.wallHeight - ROOF_CLEARANCE) / 100) * 100)
    out.push({
      text: `El techo está a ${metros(plan.wallHeight)} y los racks miden ${metros(config.height)}: sobran ${metros(room)}. Subiéndolos a ${metros(height)} entra un nivel más.`,
      label: `Subir a ${metros(height)} con ${config.levels + 1} niveles`, action: { kind: 'config', patch: { height, levels: config.levels + 1 } },
    })
  }

  const a = depot.sample.accessories
  if (racks && a.protectors === 'none') out.push({ text: 'Los racks no tienen protectores de columna. Donde circulan autoelevadores conviene ponerlos, al menos en los extremos.', label: 'Poner protectores en los extremos', action: { kind: 'accessories', patch: { protectors: 'ends' } } })
  if (racks && !a.capacitySigns) out.push({ text: 'Faltan los carteles de capacidad: dicen cuánto peso aguanta cada nivel.', label: 'Agregar carteles de capacidad', action: { kind: 'accessories', patch: { capacitySigns: true } } })
  if (racks && !a.guardrails && depot.layout.rows >= 4) out.push({ text: 'Las cabeceras de las filas no tienen defensas. Son las que más golpes reciben.', label: 'Agregar defensas de cabecera', action: { kind: 'accessories', patch: { guardrails: true } } })

  return out
}
