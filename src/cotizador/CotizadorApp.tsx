/**
 * Pantalla del cotizador suelto: encabezado con el logo, el cotizador de depósitos (primero el
 * plano, después los racks que entran) y el pedido de presupuesto. Como no hay servidor, el pedido
 * se arma como un email para la empresa (con el depósito y la lista de materiales) y también se
 * puede copiar o descargar.
 */
import { Compass, LifeBuoy, RotateCcw, Shapes, Warehouse } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '../web/components/Logo'
import { Button } from '../web/components/ui'
import { useDesigner } from '../web/pages/designer/designerStore'
import { usePlan } from '../web/plan/planStore'
import { Assistant } from './Assistant'
import { DepotFlow } from './DepotFlow'
import { Intro, useIntro } from './Intro'
import { PiecesSection } from './PiecesSection'
import { Tour, tourSeen } from './Tour'

export function CotizadorApp() {
  const resetRack = useDesigner((x) => x.reset)
  const resetPlan = usePlan((x) => x.resetAll)
  // dos secciones: el depósito (plano y racks) y el taller de piezas propias
  const section = usePlan((x) => x.section)
  const setSection = usePlan((x) => x.setSection)
  const [intro, closeIntro] = useIntro()
  // recorrido guiado: la primera vez, apenas se cierra la intro; después, con el botón "Recorrido"
  const [tour, setTour] = useState(false)
  const [helper, setHelper] = useState(false)
  const startApp = () => { closeIntro(); if (!tourSeen()) setTimeout(() => setTour(true), 350) }
  const reset = () => {
    if (!window.confirm('¿Empezar de nuevo? Se borran el plano y el rack.')) return
    resetRack()
    resetPlan()
  }
  return (
    <div className="cz">
      <header className="cz-top">
        <Logo size={44} />
        <div className="cz-top__title">
          <span className="cz-top__eyebrow">Sistemas de Carga S.A.</span>
          <h1>Sistema<span className="cz-long"> de depósitos</span></h1>
        </div>
        <nav className="cz-tabs" aria-label="Secciones">
          <button type="button" className={section === 'deposito' ? 'is-on' : ''} aria-current={section === 'deposito' ? 'page' : undefined} onClick={() => setSection('deposito')}><Warehouse size={15} aria-hidden /> Depósito</button>
          <button type="button" className={section === 'piezas' ? 'is-on' : ''} aria-current={section === 'piezas' ? 'page' : undefined} onClick={() => setSection('piezas')}><Shapes size={15} aria-hidden /> Mis piezas</button>
        </nav>
        <div className="cz-top__actions">
          <Button variant={helper ? 'secondary' : 'ghost'} icon={LifeBuoy} onClick={() => setHelper((v) => !v)} aria-pressed={helper}><span className="cz-long">Ayudante</span></Button>
          <Button variant="ghost" icon={Compass} onClick={() => { setSection('deposito'); setTour(true) }}><span className="cz-long">Recorrido</span></Button>
          <Button variant="ghost" icon={RotateCcw} onClick={reset}><span className="cz-long">Empezar de nuevo</span></Button>
        </div>
      </header>
      <main className="cz-main">
        {section === 'piezas' ? <PiecesSection /> : <DepotFlow />}
      </main>
      <Assistant open={helper} onClose={() => setHelper(false)} />
      {intro && <Intro onStart={startApp} />}
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  )
}
