/**
 * Editar un rack del depósito con el panel del cotizador: se abre su configuración en la pestaña
 * Rack y, al guardar, vuelve al plano (opcionalmente a todos los racks iguales). El rack suelto
 * que el usuario tenía armado se guarda aparte y se recupera al terminar.
 */
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { configKey } from '../../shared/plan/racks'
import type { RackConfiguration } from '../../shared/rack/types'
import { Button } from '../components/ui'
import { fmt } from '../lib/format'
import { useDesigner } from '../pages/designer/designerStore'
import { usePlan } from './planStore'

let stashed: RackConfiguration | null = null

export function startEditingRack(id: string) {
  const plan = usePlan.getState()
  const rack = plan.plan.racks?.find((r) => r.id === id)
  if (!rack) return
  if (!plan.editingRackId) stashed = useDesigner.getState().config
  useDesigner.getState().load(rack.config)
  plan.setEditingRack(id)
  plan.setWorkspace('rack')
}

function finish() {
  const plan = usePlan.getState()
  if (stashed) useDesigner.getState().load(stashed)
  stashed = null
  plan.setEditingRack(null)
  plan.setWorkspace('deposito')
}

export function EditRackBanner() {
  const { plan, editingRackId, commit, select } = usePlan()
  const [applyAll, setApplyAll] = useState(false)
  const rack = plan.racks?.find((r) => r.id === editingRackId)
  if (!rack) return null
  const n = (plan.racks ?? []).indexOf(rack) + 1
  const key = configKey(rack.config)
  const same = (plan.racks ?? []).filter((r) => r.id !== rack.id && configKey(r.config) === key).length
  const save = () => {
    const config = useDesigner.getState().config
    commit((p) => ({
      ...p,
      racks: (p.racks ?? []).map((r) => (r.id === rack.id || (applyAll && configKey(r.config) === key) ? { ...r, config } : r)),
    }))
    select({ kind: 'rack', id: rack.id })
    finish()
  }
  return (
    <div className="edit-rack-banner" role="status">
      <span>Estás editando el <b>rack R{n}</b> del depósito.</span>
      {same > 0 && (
        <label className="edit-rack-banner__all">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          Aplicar también a los {fmt(same)} racks iguales
        </label>
      )}
      <span className="edit-rack-banner__actions">
        <Button size="sm" variant="ghost" icon={X} onClick={finish}>Cancelar</Button>
        <Button size="sm" variant="primary" icon={Check} onClick={save}>Guardar en el depósito</Button>
      </span>
    </div>
  )
}
