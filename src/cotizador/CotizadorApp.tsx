/**
 * Pantalla del cotizador suelto: encabezado con el logo, el cotizador de depósitos (primero el
 * plano, después los racks que entran) y el pedido de presupuesto. Como no hay servidor, el pedido
 * se arma como un email para la empresa (con el depósito y la lista de materiales) y también se
 * puede copiar o descargar.
 */
import { Calculator, Copy, Download, Mail, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { depotSummaryText, type Depot } from '../shared/plan/depot'
import { planArea } from '../shared/plan/geometry'
import { CONTACT } from '../shared/rack/technicalSpecs'
import { Logo } from '../web/components/Logo'
import { Dialog, useToast } from '../web/components/overlays'
import { Button, Field, Input, Textarea } from '../web/components/ui'
import { plural } from '../web/lib/format'
import { MaterialsList, downloadMaterials } from '../web/pages/designer/CotizadorPanel'
import { useDesigner } from '../web/pages/designer/designerStore'
import { usePlan } from '../web/plan/planStore'
import { DepotFlow, DepotPlate, useDepot } from './DepotFlow'

export function CotizadorApp() {
  const resetRack = useDesigner((x) => x.reset)
  const resetPlan = usePlan((x) => x.resetAll)
  const [quote, setQuote] = useState(false)
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
          <h1>Cotizador 3D<span className="cz-long"> de depósitos</span></h1>
        </div>
        <div className="cz-top__actions">
          <Button variant="ghost" icon={RotateCcw} onClick={reset}><span className="cz-long">Empezar de nuevo</span></Button>
          <Button variant="primary" icon={Calculator} onClick={() => setQuote(true)}><span className="cz-long">Pedir presupuesto</span><span className="cz-short">Presupuesto</span></Button>
        </div>
      </header>
      <main className="cz-main">
        <DepotFlow onQuote={() => setQuote(true)} />
      </main>
      {quote && <QuoteDialog onClose={() => setQuote(false)} />}
    </div>
  )
}

/* ------------------------------ Pedido de presupuesto ------------------------------ */

interface Contact { name: string; company: string; email: string; phone: string; comments: string }

function requestText(summary: string, c: Contact) {
  const lines = ['PEDIDO DE PRESUPUESTO', '', `Nombre: ${c.name.trim()}`]
  if (c.company.trim()) lines.push(`Empresa: ${c.company.trim()}`)
  lines.push(`Email: ${c.email.trim()}`)
  if (c.phone.trim()) lines.push(`Teléfono: ${c.phone.trim()}`)
  if (c.comments.trim()) lines.push('', `Comentarios: ${c.comments.trim()}`)
  lines.push('', summary)
  return lines.join('\n')
}

function QuoteDialog({ onClose }: { onClose(): void }) {
  const toast = useToast()
  const { plan, layout } = usePlan()
  const { depot } = useDepot()
  const [c, setC] = useState<Contact>({ name: '', company: '', email: '', phone: '', comments: '' })
  const [tried, setTried] = useState(false)
  const set = (k: keyof Contact) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value })
  const errors = {
    name: !c.name.trim() ? 'Escribí tu nombre.' : undefined,
    email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()) ? 'Escribí un email válido para que te respondan.' : undefined,
  }
  const valid = !errors.name && !errors.email
  const text = () => requestText(depotSummaryText(plan, depot, layout), c)

  const send = () => {
    setTried(true)
    if (!valid) return
    const subject = `Pedido de presupuesto · Depósito con ${depot.positions} posiciones de rack selectivo`
    window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text())}`
    toast.ok('Se abrió tu correo con el pedido armado. Revisalo y envialo.')
  }
  const copy = async () => {
    setTried(true)
    if (!valid) return
    try {
      await navigator.clipboard.writeText(text())
      toast.ok('Pedido copiado: pegalo en un email o en WhatsApp.')
    } catch {
      toast.error('No se pudo copiar. Usá "Enviar por email".')
    }
  }

  return (
    <Dialog open onClose={onClose} title="Pedir presupuesto" width={680}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button icon={Copy} onClick={copy}>Copiar pedido</Button>
        <Button variant="primary" icon={Mail} onClick={send}>Enviar por email</Button>
      </>}>
      <div className="quote-grid">
        <DepotPlate depot={depot} area={planArea(plan.outline)} compact />
        <div className="quote-side">
          <Field label="Nombre" error={tried ? errors.name : undefined}>{(id) => <Input id={id} value={c.name} onChange={set('name')} autoComplete="name" />}</Field>
          <Field label="Empresa" optional>{(id) => <Input id={id} value={c.company} onChange={set('company')} autoComplete="organization" />}</Field>
          <Field label="Email" error={tried ? errors.email : undefined}>{(id) => <Input id={id} type="email" value={c.email} onChange={set('email')} autoComplete="email" />}</Field>
          <Field label="Teléfono" optional>{(id) => <Input id={id} type="tel" value={c.phone} onChange={set('phone')} autoComplete="tel" />}</Field>
          <Field label="Comentarios" optional>{(id) => <Textarea id={id} rows={3} value={c.comments} onChange={set('comments')} placeholder="Tipo de mercadería, plazos, si el depósito ya tiene racks…" />}</Field>
          <QuoteNotes depot={depot} />
        </div>
      </div>
      <p className="muted small cz-quote-note">"Enviar por email" abre tu programa de correo con el pedido armado para {CONTACT.email}. También podés copiarlo y mandarlo por donde prefieras.</p>
      <details className="quote-bom">
        <summary>Lista de materiales ({plural(depot.materials.length, 'ítem', 'ítems')})</summary>
        <MaterialsList lines={depot.materials} />
        <Button size="sm" icon={Download} onClick={() => downloadMaterials(depot.materials, `materiales-deposito-${depot.positions}-posiciones`)}>Descargar (CSV)</Button>
      </details>
    </Dialog>
  )
}

function QuoteNotes({ depot }: { depot: Depot }) {
  if (!depot.layout.placements.length) return <p className="note note--amber">Todavía no entra ningún rack en el depósito: revisá el plano o la distribución antes de pedir.</p>
  if (depot.sample.warnings.some((w) => w.level === 'validation')) return <p className="note note--amber">La configuración requiere validación técnica: la revisa el departamento técnico al cotizar.</p>
  return null
}
