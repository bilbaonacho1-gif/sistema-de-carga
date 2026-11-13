/**
 * INTRO DE ENTRADA: una pantalla sencilla al abrir el cotizador. Logo, título, qué se puede hacer
 * en 3 pasos y "Empezar". Un rack se dibuja solo de fondo (SVG, sin 3D: carga al instante).
 * Se muestra una vez por visita (al cerrar la pestaña y volver, aparece de nuevo).
 */
import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '../web/components/Logo'

const KEY = 'sdc-intro-vista'

export function useIntro(): [boolean, () => void] {
  const [show, setShow] = useState(() => { try { return sessionStorage.getItem(KEY) !== '1' } catch { return true } })
  const close = () => { setShow(false); try { sessionStorage.setItem(KEY, '1') } catch { /* sin memoria */ } }
  return [show, close]
}

/** Rack selectivo de frente: pórticos, vigas y pallets que se dibujan en orden. */
function RackDrawing() {
  const xs = [20, 120, 220, 320]
  const levels = [150, 95, 40]
  return (
    <svg className="intro__rack" viewBox="0 0 340 190" aria-hidden>
      {xs.map((x, i) => <line key={`u${i}`} className="intro__line intro__upright" x1={x} y1={185} x2={x} y2={20} style={{ animationDelay: `${i * 0.12}s` }} />)}
      {levels.map((y, j) => xs.slice(0, -1).map((x, i) => (
        <line key={`b${j}${i}`} className="intro__line intro__beam" x1={x} y1={y} x2={x + 100} y2={y} style={{ animationDelay: `${0.5 + j * 0.15 + i * 0.05}s` }} />
      )))}
      {levels.map((y, j) => xs.slice(0, -1).map((x, i) => [0, 1].map((k) => (
        <rect key={`p${j}${i}${k}`} className="intro__box" x={x + 8 + k * 46} y={y - 34} width={38} height={30} rx={2}
          style={{ animationDelay: `${1.1 + j * 0.18 + i * 0.08 + k * 0.04}s` }} />
      ))))}
    </svg>
  )
}

export function Intro({ onStart }: { onStart(): void }) {
  // Enter o Esc también entran
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') onStart() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-t">
      <div className="intro__card">
        <div className="intro__brand"><Logo size={52} /><span>Sistemas de Carga S.A.</span></div>
        <h1 id="intro-t" className="intro__t">Sistema de depósitos</h1>
        <p className="intro__p">Dibujá tu depósito y mirá cuántos racks entran, en 3D, con la lista de materiales.</p>
        <RackDrawing />
        <ol className="intro__steps">
          <li><b>1</b>Escribí las medidas del depósito</li>
          <li><b>2</b>Elegí el rack y la carga</li>
          <li><b>3</b>Mirá la distribución y bajá la lista de materiales</li>
        </ol>
        <button type="button" className="intro__go" onClick={onStart} autoFocus>Empezar <ArrowRight size={18} aria-hidden /></button>
      </div>
    </div>
  )
}
