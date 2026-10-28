/**
 * Pantalla del cotizador suelto: encabezado con el logo, el cotizador y el pedido de
 * presupuesto. Como no hay servidor, el pedido se arma como un email para la empresa
 * (con la configuración y la lista de materiales) y también se puede copiar o descargar.
 */
import { Calculator, Copy, Download, Mail, Phone, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { rackSummaryText } from '../shared/rack/summary'
import { CONTACT } from '../shared/rack/technicalSpecs'
import type { RackStructure } from '../shared/rack/types'
import { Logo } from '../web/components/Logo'
import { Dialog, useToast } from '../web/components/overlays'
import { Button, Field, Input, Segmented, Textarea } from '../web/components/ui'
import { plural } from '../web/lib/format'
import { CotizadorPanel, MaterialsList, downloadMaterials } from '../web/pages/designer/CotizadorPanel'
import { LoadPlate, Viewport, Warnings } from '../web/pages/designer/CotizadorView'
import { useDesignedStructure, useDesigner } from '../web/pages/designer/designerStore'
import { PlanWorkspace } from '../web/plan/PlanWorkspace'
import { usePlan } from '../web/plan/planStore'

export function CotizadorApp() {
  const s = useDesignedStructure()
  const reset = useDesigner((x) => x.reset)
  const [quote, setQuote] = useState(false)
  const { workspace, setWorkspace } = usePlan()
  return (
    <div className="cz">
      <header className="cz-top">
        <Logo size={44} />
        <div className="cz-top__title">
          <span className="cz-top__eyebrow">Sistemas de Carga S.A.</span>
          <h1>Cotizador 3D<span className="cz-long"> de racks</span></h1>
        </div>
        <Segmented label="Qué editar" value={workspace} onChange={setWorkspace}
          options={[{ value: 'rack', label: 'Rack' }, { value: 'deposito', label: 'Depósito' }]} />
        <div className="cz-top__actions">
          <Button variant="ghost" icon={RotateCcw} onClick={reset}>Empezar de nuevo</Button>
          <Button variant="primary" icon={Calculator} onClick={() => setQuote(true)}><span className="cz-long">Pedir presupuesto</span><span className="cz-short">Presupuesto</span></Button>
        </div>
      </header>
      <main className="cz-main">
        {workspace === 'deposito' ? <PlanWorkspace /> : <div className="designer">
          <CotizadorPanel s={s} actions={{ onQuote: () => setQuote(true), quoteLabel: 'Pedir presupuesto' }} />
          <Viewport s={s} />
          <aside className="designer__side">
            <LoadPlate s={s} />
            <Warnings warnings={s.warnings} />
            <p className="disclaimer">Simulación de referencia: no reemplaza el cálculo estructural. Toda configuración la valida el departamento técnico.</p>
            <div className="cz-contact">
              <strong>{CONTACT.company}</strong>
              <a href={`tel:${CONTACT.phone.replace(/\D/g, '')}`}><Phone size={14} aria-hidden /> {CONTACT.phone}</a>
              <a href={`mailto:${CONTACT.email}`}><Mail size={14} aria-hidden /> {CONTACT.email}</a>
              <span>{CONTACT.address}</span>
            </div>
          </aside>
        </div>}
      </main>
      {quote && <QuoteDialog s={s} onClose={() => setQuote(false)} />}
    </div>
  )
}

/* ------------------------------ Pedido de presupuesto ------------------------------ */

interface Contact { name: string; company: string; email: string; phone: string; comments: string }

function requestText(s: RackStructure, c: Contact) {
  const lines = ['PEDIDO DE PRESUPUESTO', '', `Nombre: ${c.name.trim()}`]
  if (c.company.trim()) lines.push(`Empresa: ${c.company.trim()}`)
  lines.push(`Email: ${c.email.trim()}`)
  if (c.phone.trim()) lines.push(`Teléfono: ${c.phone.trim()}`)
  if (c.comments.trim()) lines.push('', `Comentarios: ${c.comments.trim()}`)
  lines.push('', rackSummaryText(s))
  return lines.join('\n')
}

function QuoteDialog({ s, onClose }: { s: RackStructure; onClose(): void }) {
  const toast = useToast()
  const [c, setC] = useState<Contact>({ name: '', company: '', email: '', phone: '', comments: '' })
  const [tried, setTried] = useState(false)
  const set = (k: keyof Contact) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value })
  const errors = {
    name: !c.name.trim() ? 'Escribí tu nombre.' : undefined,
    email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()) ? 'Escribí un email válido para que te respondan.' : undefined,
  }
  const valid = !errors.name && !errors.email

  const send = () => {
    setTried(true)
    if (!valid) return
    const subject = `Pedido de presupuesto · Rack selectivo de ${s.positionsAvailable} posiciones`
    window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(requestText(s, c))}`
    toast.ok('Se abrió tu correo con el pedido armado. Revisalo y envialo.')
  }
  const copy = async () => {
    setTried(true)
    if (!valid) return
    try {
      await navigator.clipboard.writeText(requestText(s, c))
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
        <LoadPlate s={s} compact />
        <div className="quote-side">
          <Field label="Nombre" error={tried ? errors.name : undefined}>{(id) => <Input id={id} value={c.name} onChange={set('name')} autoComplete="name" />}</Field>
          <Field label="Empresa" optional>{(id) => <Input id={id} value={c.company} onChange={set('company')} autoComplete="organization" />}</Field>
          <Field label="Email" error={tried ? errors.email : undefined}>{(id) => <Input id={id} type="email" value={c.email} onChange={set('email')} autoComplete="email" />}</Field>
          <Field label="Teléfono" optional>{(id) => <Input id={id} type="tel" value={c.phone} onChange={set('phone')} autoComplete="tel" />}</Field>
          <Field label="Comentarios" optional>{(id) => <Textarea id={id} rows={3} value={c.comments} onChange={set('comments')} placeholder="Tipo de mercadería, plazos, si el depósito ya tiene racks…" />}</Field>
          {s.warnings.some((w) => w.level === 'validation') && <p className="note note--amber">La configuración requiere validación técnica: la revisa el departamento técnico al cotizar.</p>}
        </div>
      </div>
      <p className="muted small cz-quote-note">"Enviar por email" abre tu programa de correo con el pedido armado para {CONTACT.email}. También podés copiarlo y mandarlo por donde prefieras.</p>
      <details className="quote-bom">
        <summary>Lista de materiales ({plural(s.materials.length, 'ítem', 'ítems')})</summary>
        <MaterialsList lines={s.materials} />
        <Button size="sm" icon={Download} onClick={() => downloadMaterials(s)}>Descargar (CSV)</Button>
      </details>
    </Dialog>
  )
}
