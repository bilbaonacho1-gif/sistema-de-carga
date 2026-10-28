/**
 * COTIZADOR 3D: el configurador de racks dentro de la app (panel guiado en CotizadorPanel).
 * Desde acá un rack diseñado se puede agregar al almacén (pasa a ser posiciones
 * reales del mapa) o mandarse como pedido de presupuesto.
 */
import { Calculator, PlusSquare, RotateCcw, Send, Warehouse } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { RackStructure } from '../../../shared/rack/types'
import { useCreateQuote, useCreateRack, useWarehouseMap } from '../../api/queries'
import { useAuth, useMe } from '../../auth/AuthContext'
import { Dialog, useToast } from '../../components/overlays'
import { Button, ErrorNote, Field, KeyValue, PageHeader, Select, Textarea } from '../../components/ui'
import { fmt, plural } from '../../lib/format'
import { CotizadorPanel, MaterialsList } from './CotizadorPanel'
import { LoadPlate, Viewport, Warnings } from './CotizadorView'
import { useDesignedStructure, useDesigner } from './designerStore'

export default function DesignerPage() {
  const { can } = useAuth()
  const s = useDesignedStructure()
  const reset = useDesigner((x) => x.reset)
  const [dialog, setDialog] = useState<'warehouse' | 'quote' | null>(null)
  const multi = s.sections.length > 1

  return (
    <div className="page page--wide designer-page">
      <PageHeader
        title="Cotizador 3D"
        subtitle="Armá el sistema paso a paso y miralo en 3D con sus medidas. Cada cambio rearma la estructura y la lista de materiales."
        actions={<>
          <Button variant="ghost" icon={RotateCcw} onClick={reset}>Empezar de nuevo</Button>
          <Button icon={Calculator} onClick={() => setDialog('quote')}>Solicitar presupuesto</Button>
          {can('almacen.editar') && <Button variant="primary" icon={Warehouse} onClick={() => setDialog('warehouse')} disabled={multi}
            title={multi ? 'Por ahora el almacén acepta racks de un solo tramo' : undefined}>Agregar al almacén</Button>}
        </>}
      />
      <div className="designer">
        <CotizadorPanel s={s} actions={{ onQuote: () => setDialog('quote'), onWarehouse: can('almacen.editar') ? () => setDialog('warehouse') : undefined }} />
        <Viewport s={s} />
        <aside className="designer__side">
          <LoadPlate s={s} />
          <Warnings warnings={s.warnings} />
          <p className="disclaimer">Simulación de referencia: no reemplaza el cálculo estructural. Toda configuración la valida el departamento técnico.</p>
        </aside>
      </div>
      {dialog === 'warehouse' && <AddToWarehouseDialog s={s} onClose={() => setDialog(null)} />}
      {dialog === 'quote' && <QuoteDialog s={s} onClose={() => setDialog(null)} />}
    </div>
  )
}

/* ------------------------------ Agregar al almacén ------------------------------ */

function AddToWarehouseDialog({ s, onClose }: { s: RackStructure; onClose(): void }) {
  const map = useWarehouseMap(1)
  const create = useCreateRack()
  const toast = useToast()
  const navigate = useNavigate()
  const aisles = (map.data?.aisles ?? []).map((a) => a.aisle)
  const nextAisle = String.fromCharCode(Math.max(64, ...aisles.map((a) => a.charCodeAt(0))) + 1)
  const [aisle, setAisle] = useState('')
  useEffect(() => { if (!aisle && map.data) setAisle(nextAisle) }, [map.data, aisle, nextAisle])
  const nextNumber = (map.data?.racks.filter((r) => r.aisle === aisle).reduce((n, r) => Math.max(n, r.number), 0) ?? 0) + 1
  const code = `${aisle}-${String(nextNumber).padStart(2, '0')}`
  const perRow = s.modulesPerRow * s.palletsPerModule * s.storageLevels

  return (
    <Dialog open onClose={onClose} title="Agregar al almacén"
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={PlusSquare} loading={create.isPending} disabled={!aisle}
          onClick={() => create.mutate({ warehouseId: 1, aisle, config: s.config }, {
            onSuccess: (r) => { toast.ok(`Rack ${r.code} agregado con ${r.positions} posiciones`); navigate(`/almacen?rack=${r.id}`) },
          })}>Agregar rack {code}</Button></>}>
      <p className="confirm-text">
        El rack pasa a formar parte del mapa del almacén: cada posición se convierte en una ubicación con su código
        ({code}-01-01, {code}-01-02…) donde se puede guardar stock.
      </p>
      <KeyValue items={[
        ['Estructura', `${s.modulesPerRow} módulos × ${s.storageLevels} niveles`],
        ['Posiciones', fmt(perRow)],
        ['Medidas', `${fmt(s.totalWidth)} × ${fmt(s.config.depth)} × ${fmt(s.config.height)} mm`],
      ]} />
      {s.rows.length > 1 && <p className="note note--amber">El diseño tiene {s.rows.length} filas: se agrega una. Para sumar las otras, repetí la operación en otro pasillo.</p>}
      <Field label="Pasillo" hint="Se ubica al final del pasillo elegido; un pasillo nuevo se ubica debajo de los existentes.">{(id) => (
        <Select id={id} value={aisle} onChange={(e) => setAisle(e.target.value)}>
          {aisles.map((a) => <option key={a} value={a}>Pasillo {a} (existente)</option>)}
          {map.data && <option value={nextAisle}>Pasillo {nextAisle} (nuevo)</option>}
        </Select>
      )}</Field>
      <ErrorNote error={create.error} />
    </Dialog>
  )
}

/* ------------------------------ Presupuesto ------------------------------ */

function QuoteDialog({ s, onClose }: { s: RackStructure; onClose(): void }) {
  const me = useMe()
  const toast = useToast()
  const create = useCreateQuote()
  const [comments, setComments] = useState('')
  // el servidor vuelve a calcular la estructura y arma el resumen que queda guardado
  const send = () => create.mutate({ config: s.config, comments }, {
    onSuccess: () => { toast.ok('Pedido de presupuesto enviado. Te contactamos a la brevedad.'); onClose() },
  })
  return (
    <Dialog open onClose={onClose} title="Solicitar presupuesto" width={620}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button><Button variant="primary" icon={Send} loading={create.isPending} onClick={send}>Enviar consulta</Button></>}>
      <div className="quote-grid">
        <LoadPlate s={s} compact />
        <div className="quote-side">
          <KeyValue items={[['Empresa', me.companyName], ['Nombre', me.name], ['Email', me.email]]} />
          <Field label="Comentarios" optional>{(id) => <Textarea id={id} rows={5} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Tipo de mercadería, plazos, si el depósito ya tiene racks…" />}</Field>
          {s.warnings.some((w) => w.level === 'validation') && <p className="note note--amber">La configuración requiere validación técnica: lo revisa el departamento técnico al cotizar.</p>}
          <ErrorNote error={create.error} />
        </div>
      </div>
      <details className="quote-bom">
        <summary>Lista de materiales ({plural(s.materials.length, 'ítem', 'ítems')})</summary>
        <MaterialsList lines={s.materials} />
      </details>
    </Dialog>
  )
}
