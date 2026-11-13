/**
 * ELEGIR EN QUÉ RACKS VA UNA PIEZA: un plano chico del depósito donde se tocan los racks que la van
 * a llevar (los que ya la tienen vienen marcados). Al aplicar, esos racks pasan a usar la pieza y a
 * los que se desmarcaron se les saca.
 */
import { useMemo, useState } from 'react'
import { buildDepot } from '../shared/plan/depot'
import { planBounds } from '../shared/plan/geometry'
import { placementRect } from '../shared/plan/layout'
import { freezeRacks, mapRacks } from '../shared/plan/racks'
import { Dialog, useToast } from '../web/components/overlays'
import { Button } from '../web/components/ui'
import { plural } from '../web/lib/format'
import { useDesigner } from '../web/pages/designer/designerStore'
import { outlineD } from '../web/plan/PlanEditor'
import { rackNames } from '../web/plan/PlanNotes'
import { usePlan } from '../web/plan/planStore'

export function RackPicker({ id, field, name, preselect, onClose }: {
  id: string; field: 'beamId' | 'uprightId'; name: string; preselect: string[]; onClose(): void
}) {
  const plan = usePlan((s) => s.plan)
  const layout = usePlan((s) => s.layout)
  const config = useDesigner((s) => s.config)
  const toast = useToast()
  const placements = useMemo(() => buildDepot(plan, config, layout).layout.placements, [plan, config, layout])
  const names = useMemo(() => rackNames(placements), [placements])
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([
    ...placements.filter((r) => r[field] === id).map((r) => r.id),
    ...preselect.filter((x) => placements.some((r) => r.id === x)),
  ]))
  const toggle = (rid: string) => setChosen((c) => { const n = new Set(c); if (n.has(rid)) n.delete(rid); else n.add(rid); return n })
  const everywhere = config[field] === id
  const apply = () => {
    usePlan.getState().commit((p) => mapRacks(freezeRacks(p, placements), placements.map((r) => r.id),
      (r) => (chosen.has(r.id) ? { ...r, [field]: id } : r[field] === id ? { ...r, [field]: undefined } : r)))
    toast.ok(chosen.size ? `Listo: ${chosen.size === 1 ? 'un rack usa' : `${chosen.size} racks usan`} "${name}".` : `Listo: ningún rack usa "${name}".`)
    onClose()
  }

  const empty = plan.outline.points.length < 3 || !placements.length
  const b = planBounds(plan)
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04 + 500
  const vw = b.maxX - b.minX + pad * 2
  const px = (n: number) => (n * vw) / 620
  const showNames = placements.length <= 80

  return (
    <Dialog open onClose={onClose} title={`¿En qué racks va "${name}"?`} width={720}
      footer={empty ? <Button onClick={onClose}>Cerrar</Button> : <>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={apply}>Aplicar a {plural(chosen.size, 'rack', 'racks')}</Button>
      </>}>
      {empty ? <p>Todavía no hay racks en el depósito. Dibujá el depósito en la sección "Depósito" y volvé acá.</p> : <>
        <p className="muted small rackpick__help">Tocá los racks que van a llevar esta pieza (en rojo, los elegidos). Los demás siguen como están.</p>
        {everywhere && <p className="note note--blue">Esta pieza ya está puesta para todo el depósito, así que la usan todos los racks. Para que la lleven sólo algunos, primero sacala de "todos los racks".</p>}
        <div className="rackpick__bar">
          <button type="button" className="vp-btn" onClick={() => setChosen(new Set(placements.map((r) => r.id)))}>Todos</button>
          <button type="button" className="vp-btn" onClick={() => setChosen(new Set())}>Ninguno</button>
          <span>{plural(chosen.size, 'rack elegido', 'racks elegidos')} de {placements.length}</span>
        </div>
        <svg className="rackpick__plan" viewBox={`${b.minX - pad} ${b.minY - pad} ${vw} ${b.maxY - b.minY + pad * 2}`} role="group" aria-label="Plano del depósito: tocá los racks">
          <path d={outlineD(plan)} fill="#fff" stroke="#2b2e33" strokeWidth={px(2)} />
          {placements.map((r) => {
            const q = placementRect(r), on = chosen.has(r.id), label = names.get(r.id) ?? 'Rack'
            return (
              <g key={r.id} role="checkbox" aria-checked={on} aria-label={label} tabIndex={0} style={{ cursor: 'pointer' }}
                onClick={() => toggle(r.id)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(r.id) } }}>
                <title>{label}</title>
                <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={on ? '#be1e30' : '#fdebd3'} stroke={on ? '#8e1422' : '#e07b1f'} strokeWidth={px(1.2)} />
                {/* zona de toque más cómoda para racks finitos */}
                <rect x={q.x - px(3)} y={q.y - px(3)} width={q.w + px(6)} height={q.h + px(6)} fill="transparent" />
                {showNames && <text x={q.x + q.w / 2} y={q.y + q.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={px(10)} fontWeight={700}
                  fill={on ? '#fff' : '#8a4a10'} style={{ pointerEvents: 'none', fontFamily: 'var(--f-mono)' }}>{label.replace(/^Fila /, '')}</text>}
              </g>
            )
          })}
        </svg>
      </>}
    </Dialog>
  )
}
