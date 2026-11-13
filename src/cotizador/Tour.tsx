/**
 * RECORRIDO GUIADO: la primera vez (después de la intro) va señalando cada parte de la pantalla
 * con una explicación corta. Se oscurece todo menos lo que se explica. Siguiente / Anterior /
 * Saltar, y con el teclado: flechas, Enter y Esc. Se puede volver a ver con el botón "Recorrido".
 * Los pasos cuyo elemento no está en pantalla (por ejemplo el 3D con el plano vacío) se saltean.
 */
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface Step { target: string; title: string; text: string }

export const TOUR: Step[] = [
  { target: '.plan-editor', title: 'El plano del depósito', text: 'Acá se dibuja el depósito. Empezá escribiendo el largo y el ancho, o dibujalo a mano. Todo se mide en metros y cada cuadrito de fondo es 1 m.' },
  { target: '[data-dock-id="pasos"]', title: 'Los 5 pasos', text: 'Depósito, rack (con sus accesorios), carga, distribución y resumen. Podés ir y volver cuando quieras; con Siguiente pasás al que sigue.' },
  { target: '[data-dock-id="herramientas"]', title: 'Herramientas', text: 'Contorno, columnas, tabiques, portones, zonas libres, zonas de racks y pasillos. También medir, poner cotas, textos y símbolos (matafuegos, salidas…).' },
  { target: '.depot-strip', title: 'Cuántos entran', text: 'Posiciones, filas, módulos y capacidad del depósito. Se actualiza solo con cada cambio.' },
  { target: '.plan-stage__bar .segmented', title: 'Plano o 3D', text: 'Pasá del plano al 3D para ver el depósito armado. En los dos se toca cualquier cosa para elegirla y arrastrarla.' },
  { target: '.zoom-btns', title: 'Zoom', text: 'Acercá y alejá con + y − (o con la rueda del mouse). Arrastrando el fondo te movés por el plano.' },
  { target: '.dock__bar', title: 'Paneles a tu gusto', text: 'Cada módulo se achica tocando su nombre. Arrastrándolo de la barra lo llevás a cualquier lugar o a un costado, como en los programas de Adobe.' },
  { target: '.cz-top__actions', title: 'Pedir el presupuesto', text: 'Cuando el depósito esté listo, pedí el presupuesto: se arma con el plano y la lista de materiales. "Empezar de nuevo" borra todo.' },
]

const KEY = 'sdc-recorrido-visto'
export const tourSeen = () => { try { return localStorage.getItem(KEY) === '1' } catch { return true } }
const markSeen = () => { try { localStorage.setItem(KEY, '1') } catch { /* sin memoria */ } }

type Box = { x: number; y: number; w: number; h: number }

/** El elemento a la vista (o null si no está o no se ve). */
function find(sel: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 4 && r.height > 4 ? el : null
}

export function Tour({ onClose }: { onClose(): void }) {
  // sólo los pasos cuyo elemento está en pantalla
  const [steps] = useState(() => TOUR.filter((s) => find(s.target)))
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const step = steps[i]

  const close = () => { markSeen(); onClose() }
  const next = () => (i < steps.length - 1 ? setI(i + 1) : close())
  const prev = () => setI(Math.max(0, i - 1))

  // seguir al elemento (si la página se mueve o cambia de tamaño)
  useEffect(() => {
    if (!step) return
    const el = find(step.target)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    let raf = 0
    const tick = () => {
      const e = find(step.target)
      if (e) { const r = e.getBoundingClientRect(); setBox((b) => (b && b.x === r.left && b.y === r.top && b.w === r.width && b.h === r.height ? b : { x: r.left, y: r.top, w: r.width, h: r.height })) }
      raf = window.setTimeout(tick, 250) as unknown as number
    }
    tick()
    return () => clearTimeout(raf)
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!step || !box) return null
  const pad = 8
  const hole = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  const vw = window.innerWidth, vh = window.innerHeight
  // la tarjeta al lado del elemento: a la derecha si hay lugar, si no a la izquierda, abajo o arriba
  const cw = Math.min(340, vw - 32), ch = 210
  let left: number, top: number
  if (hole.x + hole.w + 16 + cw < vw) { left = hole.x + hole.w + 16; top = hole.y }
  else if (hole.x - 16 - cw > 0) { left = hole.x - 16 - cw; top = hole.y }
  else if (hole.y + hole.h + 16 + ch < vh) { left = hole.x + hole.w / 2 - cw / 2; top = hole.y + hole.h + 16 }
  else { left = hole.x + hole.w / 2 - cw / 2; top = hole.y - 16 - ch }
  left = Math.max(16, Math.min(vw - cw - 16, left)); top = Math.max(16, Math.min(vh - ch - 16, top))

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-t">
      <svg className="tour__shade" width={vw} height={vh} aria-hidden>
        <defs>
          <mask id="tour-hole">
            <rect width={vw} height={vh} fill="#fff" />
            <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={12} fill="#000" />
          </mask>
        </defs>
        <rect width={vw} height={vh} fill="rgba(15, 18, 22, .62)" mask="url(#tour-hole)" />
        <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={12} fill="none" stroke="#be1e30" strokeWidth={3} />
      </svg>
      <div className="tour__card" style={{ left, top, width: cw }}>
        <button type="button" className="tour__x" onClick={close} aria-label="Cerrar el recorrido"><X size={16} aria-hidden /></button>
        <span className="tour__k">{i + 1} de {steps.length}</span>
        <h2 id="tour-t" className="tour__t">{step.title}</h2>
        <p className="tour__p">{step.text}</p>
        <div className="tour__nav">
          <button type="button" className="tour__skip" onClick={close}>Saltar</button>
          <span className="tour__dots" aria-hidden>{steps.map((_, k) => <i key={k} className={k === i ? 'is-on' : ''} />)}</span>
          {i > 0 && <button type="button" className="tour__b" onClick={prev} aria-label="Anterior"><ArrowLeft size={16} aria-hidden /></button>}
          <button type="button" className="tour__b tour__b--go" onClick={next} autoFocus>{i < steps.length - 1 ? <>Siguiente <ArrowRight size={16} aria-hidden /></> : 'Terminar'}</button>
        </div>
      </div>
    </div>
  )
}
