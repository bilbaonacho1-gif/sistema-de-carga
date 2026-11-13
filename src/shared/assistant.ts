/**
 * AYUDANTE: sin inteligencia artificial ni servicios externos. Tres cosas, todas con reglas:
 *  - entender un pedido escrito con frases simples ("depósito de 30 por 20 con racks de 6 m"),
 *  - encontrar la respuesta a una pregunta de uso en una lista,
 *  - proponer mejoras mirando el depósito armado.
 */
import { buildDepot, type Depot } from './plan/depot'
import { ROOF_CLEARANCE } from './plan/checks'
import type { LayoutOptions } from './plan/layout'
import type { Plan } from './plan/types'
import { DESIGN_RULES } from './rack/technicalSpecs'
import type { AccessoryConfig, RackConfiguration } from './rack/types'
import { metros } from './units'

const L = DESIGN_RULES.limits

/** Minúsculas, sin acentos ni signos: para comparar sin importar cómo se escribió. */
export const plain = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim()

/* ------------------------------ Pedidos ------------------------------ */

export interface Order {
  depot?: { l: number; w: number }
  wallHeight?: number
  height?: number
  levels?: number
  width?: number
  depth?: number
  palletWeight?: number
  aisle?: number
  /** Llenar el depósito solo. */
  fill?: boolean
  /** Filas dobles (espalda con espalda) o simples. */
  pair?: boolean
  protectors?: 'all' | 'none'
}

const NUM = '(\\d+(?:[.,]\\d+)?)'
const UNIT = '(?:\\s*(?:m|mts?|metros?))?'
const num = (v: string) => parseFloat(v.replace(',', '.'))
/** Un largo escrito en metros (6 · 2,7) o en milímetros (2700): devuelve milímetros. */
const mm = (v: string) => { const n = num(v); return Math.round(n < 100 ? n * 1000 : n) }
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))
const first = (t: string, patterns: string[]): string | undefined => {
  for (const p of patterns) { const hit = new RegExp(p).exec(t); if (hit) return hit[1] }
  return undefined
}

/**
 * Lee un pedido escrito con frases simples. Entiende: medidas del depósito ("30 por 20"), alto del
 * techo, alto de los racks, niveles, largo de viga, profundidad, peso del pallet, pasillo, filas
 * simples o dobles, protectores y "llenalo". Lo que no reconoce, lo deja pasar.
 */
export function parseOrder(text: string): Order {
  const t = plain(text)
  const o: Order = {}

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

  const aisle = first(t, [`pasillos?\\s*(?:de\\s*)?${NUM}`])
  if (aisle) o.aisle = Math.min(6000, Math.max(1200, mm(aisle)))

  if (/espalda con espalda|\bdobles?\b/.test(t)) o.pair = true
  else if (/\bsimples?\b/.test(t)) o.pair = false

  if (/sin protector/.test(t)) o.protectors = 'none'
  else if (/protector/.test(t)) o.protectors = 'all'

  if (/\bllen|\bcomplet|solo\b.*\brack|arma(lo|me|r)?\b|acomod|pone(r|me)? (los )?racks/.test(t)) o.fill = true
  return o
}

export const isEmptyOrder = (o: Order) => Object.keys(o).length === 0

/** El pedido dicho en palabras, renglón por renglón (para confirmar lo que se entendió). */
export function describeOrder(o: Order): string[] {
  const out: string[] = []
  if (o.depot) out.push(`Depósito de ${metros(o.depot.l)} × ${metros(o.depot.w)}`)
  if (o.wallHeight) out.push(`Techo a ${metros(o.wallHeight)}`)
  if (o.height) out.push(`Racks de ${metros(o.height)} de alto`)
  if (o.levels) out.push(`${o.levels} niveles`)
  if (o.width) out.push(`Vigas de ${metros(o.width)}`)
  if (o.depth) out.push(`Profundidad de ${metros(o.depth)}`)
  if (o.palletWeight) out.push(`Pallets de ${o.palletWeight.toLocaleString('es-AR')} kg`)
  if (o.aisle) out.push(`Pasillos de ${metros(o.aisle)}`)
  if (o.pair !== undefined) out.push(o.pair ? 'Filas dobles (espalda con espalda)' : 'Filas simples')
  if (o.protectors) out.push(o.protectors === 'all' ? 'Con protectores en todas las columnas' : 'Sin protectores')
  if (o.fill) out.push('Racks acomodados solos')
  return out
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
  { id: 'piezas', q: '¿Cómo creo mis propias piezas (vigas, parantes, objetos)?', keys: ['pieza', 'fierr', 'perfil', 'dibujar', 'forma', 'parante', 'objeto', 'caja', 'dxf', 'autocad', 'doblar', 'chapa'],
    steps: ['Tocá "Mis piezas" arriba.', '"Nueva viga", "Nuevo parante" o "Nuevo objeto".', 'Poné las medidas o tocá "Dibujar la forma con puntos". Con "Otra forma" una pieza puede tener varias chapas. También se carga un dibujo de AutoCAD (DXF).', 'Para usarla: "Usar en todos los racks" o "Elegir los racks…". Los objetos se ponen con "Poner en el depósito".'] },
  { id: 'porticos', q: '¿Cómo cambio las riendas, las bases o el alto de una columna?', keys: ['rienda', 'base', 'portico', 'columna', 'arriostr', 'mas alta', 'bastidor'],
    steps: ['Para todos los pórticos: paso 2 (Rack), grupo "Pórticos".', 'Para uno solo: tocá el rack en el plano, "Editar", y en "Piezas de este rack" elegí el pórtico (Pórtico 1, 2…).', 'Ahí cambiás las riendas diagonales y horizontales, el alto de cada columna y si lleva cada base.'] },
  { id: 'medidas', q: '¿Cómo cambio el alto, los niveles o el largo de viga?', keys: ['alto', 'altura', 'nivel', 'largo de viga', 'ancho', 'profundidad', 'medida', 'mas ancho', 'mas alto'],
    steps: ['Para todos los racks: paso 2 (Rack). Ahí están el largo de viga, la profundidad, la altura, los niveles y cada viga.', 'Para un rack solo: tocalo en el plano, "Editar", y abrí "Todo este rack".', 'También me lo podés escribir: "racks de 7 metros con 4 niveles".'] },
  { id: 'accesorios', q: '¿Dónde están los accesorios y los colores?', keys: ['accesorio', 'protector', 'defensa', 'malla', 'piso', 'color', 'cartel', 'guia'],
    steps: ['En el paso 2 (Rack), panel "Accesorios".', 'Hay cinco grupos: Protección, Pisos y niveles, Refuerzos, Señalización y Colores.', 'Lo que elijas va en todos los racks y se ve al momento en el 3D.'] },
  { id: 'materiales', q: '¿Dónde veo la lista de materiales y pido el presupuesto?', keys: ['material', 'lista', 'presupuesto', 'cotiz', 'piezas en total', 'descargar', 'resumen', 'precio'],
    steps: ['En el paso 5 (Resumen) está el depósito completo con todas las piezas.', '"Descargar lista (CSV)" baja la lista en un archivo que se abre con Excel.', 'Con "Pedir presupuesto" (arriba a la derecha) se arma el pedido para mandar por mail o copiar.'] },
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
  if (/\brevis|que esta mal|esta bien|chequea|control(a|ar)\b/.test(t)) return 'revisar'
  if (/suger|mejor(a|ar|as)\b|consej|optimi|aprovech|entran mas/.test(t)) return 'sugerir'
  const asks = /^(como|donde|por que|porque|que |cual|puedo|se puede|para que)\b/.test(t) || text.includes('?')
  if (asks) return findFaq(t) ? 'pregunta' : isEmptyOrder(parseOrder(t)) ? 'nada' : 'pedido'
  if (!isEmptyOrder(parseOrder(t))) return 'pedido'
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
