/**
 * AYUDANTE: una ventanita de chat, sin IA ni servicios externos (todo corre acá, gratis).
 * Revisa el depósito, explica cómo se usa, sugiere mejoras y arma cosas con pedidos simples
 * ("depósito de 30 por 20 con racks de 6 m"). La lógica está en shared/assistant.
 */
import { LifeBuoy, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { applyShapes, describeOrder, FAQS, findFaq, intentOf, parseOrder, plain, suggestions, withBeams, type Order, type SuggestionAction } from '../shared/assistant'
import { planChecks } from '../shared/plan/checks'
import { buildDepot, moduleSize } from '../shared/plan/depot'
import { emptyPlan } from '../shared/plan/edit'
import { rectanglePlan } from '../shared/plan/geometry'
import { fitPlacement, freezeRacks, mapRacks, rackSelection, selectedRackIds } from '../shared/plan/racks'
import type { RackConfiguration, RackStructure } from '../shared/rack/types'
import type { PlanSelection } from '../shared/plan/types'
import { fmt, plural } from '../web/lib/format'
import { useDesigner } from '../web/pages/designer/designerStore'
import { usePlan, type FlowStep } from '../web/plan/planStore'

interface Act { label: string; run(): string | void }
interface Item { level?: 'error' | 'aviso' | 'consejo'; text: string; acts?: Act[] }
interface Msg { id: number; from: 'yo' | 'ayu'; text?: string; steps?: string[]; items?: Item[]; acts?: Act[] }

let seq = 0
const say = (m: Omit<Msg, 'id' | 'from'>): Msg => ({ id: ++seq, from: 'ayu', ...m })

/** El depósito tal como está ahora mismo (después de un cambio, los datos de la pantalla todavía son los viejos). */
function now() {
  const { plan, layout } = usePlan.getState()
  const config = useDesigner.getState().config
  return { plan, layout, config, depot: buildDepot(plan, config, layout) }
}
const total = () => {
  const { depot } = now()
  const bad = Object.keys(depot.issues).length
  if (!depot.layout.placements.length) return 'Todavía no hay racks en el depósito.'
  return `Ahora hay ${plural(depot.layout.rows, 'fila', 'filas')} y ${fmt(depot.positions)} posiciones de pallet${bad ? `, con ${plural(bad, 'rack', 'racks')} en rojo` : ''}.`
}

/** Lleva a la pantalla donde se ve lo que se cambió. */
function goTo(step: FlowStep) {
  const s = usePlan.getState()
  s.setSection('deposito')
  s.setFlowStep(step)
}
function show(target: PlanSelection) {
  const s = usePlan.getState()
  s.setSection('deposito')
  if (s.flowStep === 'rack' || s.flowStep === 'carga') s.setFlowStep('distribucion')
  s.select(target)
}

/* ------------------------------ Lo que sabe hacer ------------------------------ */

function review(): Msg {
  const { plan, layout, depot } = now()
  if (plan.outline.points.length < 3) return say({ text: 'Todavía no hay depósito para revisar. Crealo en el paso 1, o escribime por ejemplo "depósito de 30 por 20".' })
  const items: Item[] = []
  const bad = Object.entries(depot.issues)
  for (const [id, why] of bad.slice(0, 5)) items.push({ level: 'error', text: `Un rack en rojo: ${why.toLowerCase()}.`, acts: [{ label: 'Mostrármelo', run: () => show({ kind: 'rack', id }) }] })
  if (bad.length > 5) items.push({ level: 'error', text: `Y ${plural(bad.length - 5, 'rack más', 'racks más')} en rojo.` })
  const checks = planChecks(plan, { racks: depot.racks.map((r) => ({ placement: r.placement, height: r.structure.config.height })), issues: {}, aisle: layout.aisle })
  for (const c of checks) items.push({ level: c.level, text: c.text, acts: c.target ? [{ label: 'Mostrármelo', run: () => show(c.target!) }] : undefined })
  for (const w of depot.sample.warnings.filter((x) => x.code !== 'free-positions')) items.push({ level: 'aviso', text: w.message })
  if (!items.length) return say({ text: `Revisé el depósito y no encontré problemas. ${total()}` })
  const serious = items.filter((i) => i.level === 'error').length
  return say({
    text: serious ? `Encontré ${plural(serious, 'cosa para arreglar', 'cosas para arreglar')}${items.length > serious ? ` y ${plural(items.length - serious, 'aviso', 'avisos')}` : ''}:` : `Nada grave. ${plural(items.length, 'aviso', 'avisos')}:`,
    items,
    acts: bad.length ? [{
      label: `Sacar ${bad.length === 1 ? 'el rack en rojo' : `los ${bad.length} racks en rojo`}`,
      run: () => {
        const ids = new Set(bad.map(([id]) => id))
        const s = usePlan.getState()
        s.commit((pl) => { const f = freezeRacks(pl, now().depot.layout.placements); return { ...f, racks: (f.racks ?? []).filter((r) => !ids.has(r.id)) } })
        s.select(null)
        return `Listo, los saqué (Ctrl+Z los devuelve). ${total()}`
      },
    }] : undefined,
  })
}

function applySuggestion(a: SuggestionAction): string {
  const s = usePlan.getState(), d = useDesigner.getState()
  if (a.kind === 'layout') { s.setLayout(a.patch); goTo('distribucion') }
  else if (a.kind === 'config') { d.update({ ...a.patch, beamElevations: undefined }) }
  else if (a.kind === 'accessories') d.updateAccessories(a.patch)
  else { s.commit((pl) => ({ ...pl, racks: undefined })); goTo('distribucion') }
  return `Listo. ${total()}`
}

function suggest(): Msg {
  const { plan, layout, config, depot } = now()
  const list = suggestions(plan, config, layout, depot)
  if (!list.length) return say({ text: `No encontré nada para mejorar: está bien aprovechado. ${total()}` })
  return say({
    text: list.length === 1 ? 'Tengo una sugerencia:' : `Tengo ${list.length} sugerencias:`,
    items: list.map((x) => ({ level: 'consejo' as const, text: x.text, acts: x.action && x.label ? [{ label: x.label, run: () => applySuggestion(x.action!) }] : undefined })),
  })
}

/** Las medidas que son de un rack (y no del depósito): se pueden cambiar en uno solo. */
const hasRackChange = (o: Order) => !!(o.height || o.levels || o.width || o.depth || o.modules || o.beamAt || o.pair !== undefined)
const beamsOf = (st: RackStructure) => (st.rows[0]?.modules[0]?.levels ?? []).filter((l) => l.hasBeam).map((l) => l.elevation)

/** Hace lo que dice el pedido y cuenta cómo quedó. */
function applyOrder(o: Order, text = ''): string {
  const s = usePlan.getState(), d = useDesigner.getState()
  const hadDepot = s.plan.outline.points.length >= 3
  const notes: string[] = []
  if (o.depot) {
    s.commit(() => rectanglePlan(o.depot!.l, o.depot!.w, { ...emptyPlan(), ...(o.wallHeight ? { wallHeight: o.wallHeight } : {}) }))
    s.select(null)
  } else if (o.wallHeight) s.commit((pl) => ({ ...pl, wallHeight: o.wallHeight! }))
  if (o.shapes?.length) usePlan.getState().commit((pl) => { const r = applyShapes(pl, o.shapes!); notes.push(...r.notes); return r.plan })

  // con un rack elegido en el plano, las medidas son para ese rack (salvo que diga "todos")
  const sel = o.depot ? [] : selectedRackIds(usePlan.getState().selection)
  const one = sel.length > 0 && hasRackChange(o) && !/\btodos\b|todo el deposito|modulo inicial|en general/.test(plain(text))
  if (one) {
    const { depot, config } = now()
    const size = moduleSize(config).size
    usePlan.getState().commit((pl) => mapRacks(freezeRacks(pl, depot.layout.placements), sel, (r) => {
      const st = depot.racks.find((x) => x.placement.id === r.id)?.structure
      const next = {
        ...r, ...(o.height ? { height: o.height } : {}), ...(o.levels ? { levels: o.levels } : {}), ...(o.width ? { beamLength: o.width } : {}),
        ...(o.depth ? { frameDepth: o.depth } : {}), ...(o.modules ? { modules: o.modules } : {}), ...(o.pair !== undefined ? { pair: o.pair } : {}),
      }
      if (o.beamAt && st && !o.levels) next.beamElevations = withBeams(beamsOf(st), o.beamAt, next.height ?? config.height)
      return fitPlacement(next, size)
    }))
  } else {
    if (o.modules) notes.push('Para cambiar la cantidad de módulos, primero tocá el rack en el plano y volvé a pedírmelo.')
    const rack: Partial<RackConfiguration> = {
      ...(o.height ? { height: o.height, beamElevations: undefined } : {}), ...(o.levels ? { levels: o.levels, beamElevations: undefined } : {}),
      ...(o.width ? { width: o.width } : {}), ...(o.depth ? { depth: o.depth } : {}),
    }
    if (Object.keys(rack).length) d.update(rack)
    if (o.beamAt) {
      const c = useDesigner.getState().config
      d.update({ beamElevations: withBeams(beamsOf(moduleSize(c).sample), o.beamAt, c.height) })
    }
    if (o.pair !== undefined) s.setLayout({ backToBack: o.pair })
  }
  const general: Partial<RackConfiguration> = {
    ...(o.palletWeight ? { palletWeight: o.palletWeight } : {}), ...(o.floorStorage !== undefined ? { floorStorage: o.floorStorage } : {}),
    ...(o.frame ? { frameDefault: { ...useDesigner.getState().config.frameDefault, ...o.frame } } : {}),
  }
  if (Object.keys(general).length) d.update(general)
  if (o.aisle || o.endGap !== undefined || o.orientation) s.setLayout({ ...(o.aisle ? { aisle: o.aisle } : {}), ...(o.endGap !== undefined ? { endGap: o.endGap } : {}), ...(o.orientation ? { orientation: o.orientation } : {}) })
  if (o.accessories) d.updateAccessories(o.accessories)
  const canFill = o.fill && (o.depot || hadDepot)
  if (canFill) usePlan.getState().commit((pl) => ({ ...pl, racks: undefined }))
  // se va a la pantalla donde se ve el cambio
  const inPlan = canFill || one || o.aisle || o.endGap !== undefined || o.orientation || o.pair !== undefined
  const inRack = hasRackChange(o) || o.frame || o.accessories || o.floorStorage !== undefined || o.palletWeight
  goTo(inPlan ? 'distribucion' : o.depot || o.shapes?.length || !inRack ? 'deposito' : 'rack')
  if (one) usePlan.getState().select(rackSelection(sel))
  usePlan.getState().requestFit()
  if (o.fill && !canFill) notes.push('Para acomodar los racks falta el depósito: decime las medidas, por ejemplo "30 por 20".')
  const scope = !hasRackChange(o) ? '' : one ? ` Lo cambié en ${sel.length === 1 ? 'el rack elegido' : `los ${sel.length} racks elegidos`} (decime "todos" para cambiarlos todos).` : ' Vale para todos los racks.'
  return `Listo.${scope} ${o.depot || hadDepot ? total() : 'Cuando tengas el depósito, los racks salen con estas medidas.'}${notes.length ? ` ${notes.join(' ')}` : ''}`
}

function order(text: string): Msg {
  const o = parseOrder(text)
  const lines = describeOrder(o)
  const hasDepot = usePlan.getState().plan.outline.points.length >= 3
  if (o.depot && hasDepot) {
    const rest: Order = { ...o }
    delete rest.depot
    return say({
      text: `Ya hay un depósito armado. ¿Lo cambio por uno de ${lines[0].replace('Depósito de ', '')}? Se borra lo que hay ahora (con Ctrl+Z vuelve).`,
      acts: [
        { label: 'Sí, cambiarlo', run: () => applyOrder(o, text) },
        ...(lines.length > 1 ? [{ label: 'No, dejar el depósito y hacer lo demás', run: () => applyOrder(rest, text) }] : []),
      ],
    })
  }
  const done = applyOrder(o, text)
  return say({ text: 'Entendí esto y ya lo hice:', steps: lines, items: [{ text: done }] })
}

const HELP: Msg = say({
  text: 'Soy el ayudante del sistema. No soy una inteligencia artificial: funciono con reglas, gratis y sin mandar nada afuera. Puedo:',
  steps: [
    'Revisar el depósito y mostrarte qué está mal.',
    'Sugerirte mejoras para que entren más pallets.',
    'Explicarte cómo se hace algo: "¿cómo copio un rack?"',
    'Armar o cambiar cosas si me las escribís simple: "depósito de 30 por 20 con racks de 6 metros, 4 niveles, y llenalo". También un texto largo pegado, con un renglón por cosa.',
    'Cambiar las medidas de un rack: tocalo en el plano y escribime "altura 7,5", "vigas de 2,3", "6 módulos" o "viga 2 a 3 m". Si no hay ninguno elegido, cambia todos.',
  ],
})

function answer(text: string): Msg {
  switch (intentOf(text)) {
    case 'revisar': return review()
    case 'sugerir': return suggest()
    case 'pedido': return order(text)
    case 'pregunta': { const f = findFaq(text)!; return say({ text: f.q, steps: f.steps }) }
    default: return say({
      text: 'Eso no lo entendí. Entiendo pedidos simples (medidas del depósito y de los racks, columnas, portones, zonas, pasillos, accesorios, "llenalo") y las preguntas de esta lista:',
      acts: FAQS.slice(0, 6).map((f) => ({ label: f.q, run: () => f.steps.map((x, i) => `${i + 1}. ${x}`).join('\n') })),
    })
  }
}

/* ------------------------------ La ventanita ------------------------------ */

/** Preguntas a mano según el paso en el que se está. */
const BY_STEP: Record<FlowStep, string[]> = {
  deposito: ['deposito', 'zonas'], rack: ['medidas', 'porticos'], carga: ['medidas', 'accesorios'],
  distribucion: ['copiar', 'viga'], resumen: ['materiales', 'exportar'],
}

export function Assistant({ open, onClose }: { open: boolean; onClose(): void }) {
  const [msgs, setMsgs] = useState<Msg[]>([HELP])
  const [text, setText] = useState('')
  const [used, setUsed] = useState<Set<string>>(new Set())
  const flowStep = usePlan((s) => s.flowStep)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'end' }) }, [msgs, open])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  if (!open) return null

  const push = (...m: Msg[]) => setMsgs((list) => [...list, ...m].slice(-60))
  const send = (t: string) => {
    const clean = t.trim()
    if (!clean) return
    setText('')
    push({ id: ++seq, from: 'yo', text: clean }, answer(clean))
  }
  const runAct = (key: string, a: Act) => {
    setUsed((u) => new Set(u).add(key))
    const out = a.run()
    if (out) push(say({ text: out }))
  }
  const quick = BY_STEP[flowStep].map((id) => FAQS.find((f) => f.id === id)!).filter(Boolean)

  return (
    <aside className="ayu" aria-label="Ayudante">
      <header className="ayu__top">
        <LifeBuoy size={18} aria-hidden />
        <strong>Ayudante</strong>
        <button type="button" className="ayu__x" onClick={onClose} aria-label="Cerrar el ayudante"><X size={18} aria-hidden /></button>
      </header>
      <div className="ayu__list" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`ayu__msg ayu__msg--${m.from}`}>
            {m.text && <p>{m.text}</p>}
            {m.steps && <ol>{m.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>}
            {m.items?.map((it, i) => (
              <div key={i} className={`ayu__item${it.level ? ` ayu__item--${it.level}` : ''}`}>
                <span>{it.text}</span>
                {it.acts?.map((a, j) => { const k = `${m.id}-${i}-${j}`; return <button key={j} type="button" className="ayu__act" disabled={used.has(k) && a.label !== 'Mostrármelo'} onClick={() => runAct(k, a)}>{a.label}</button> })}
              </div>
            ))}
            {m.acts && <div className="ayu__acts">{m.acts.map((a, j) => { const k = `${m.id}-a-${j}`; return <button key={j} type="button" className="ayu__act" disabled={used.has(k)} onClick={() => runAct(k, a)}>{a.label}</button> })}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="ayu__quick">
        <button type="button" onClick={() => send('Revisar mi depósito')}>Revisar mi depósito</button>
        <button type="button" onClick={() => send('Sugerirme mejoras')}>Sugerirme mejoras</button>
        {quick.map((f) => <button key={f.id} type="button" onClick={() => send(f.q)}>{f.q}</button>)}
      </div>
      <form className="ayu__form" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <textarea ref={input} value={text} rows={Math.min(7, Math.max(1, text.split('\n').length))} maxLength={4000} aria-label="Escribile al ayudante"
          placeholder='Escribí o pegá acá. Ej.: "racks de 7 m con 4 niveles"' onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
        <button type="submit" disabled={!text.trim()} aria-label="Enviar"><Send size={16} aria-hidden /></button>
      </form>
    </aside>
  )
}
