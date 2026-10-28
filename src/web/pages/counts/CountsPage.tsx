/** CONTEO DE INVENTARIO: iniciar por sector → cargar conteo físico → ver diferencias → confirmar. */
import { Ban, Check, CheckCheck, Equal, Play, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { CountLine, InventoryCount, InventoryCountDetail } from '../../../shared/types'
import { useCancelCount, useConfirmCount, useCount, useCountLine, useCounts, useSectors, useStartCount } from '../../api/queries'
import { ConfirmDialog, Dialog, useToast } from '../../components/overlays'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Loadable, PageHeader, Progress, Segmented, Select } from '../../components/ui'
import { fmt, fmtDateTime, plural } from '../../lib/format'
import { useIsMobile } from '../../lib/useMediaQuery'

const ALL = 'Todo el almacén'

const statusBadge = (s: InventoryCount['status']) =>
  s === 'en_curso' ? <Badge tone="amber">En curso</Badge> : s === 'confirmado' ? <Badge tone="green">Confirmado</Badge> : <Badge>Cancelado</Badge>

export function CountsPage() {
  const q = useCounts()
  const [starting, setStarting] = useState(false)
  return (
    <div className="page">
      <PageHeader
        phase={3}
        title="Conteo de inventario"
        subtitle="Contá físicamente un sector y compará con el sistema. Al confirmar, las diferencias se ajustan y quedan en el historial."
        actions={<Button variant="primary" icon={Play} onClick={() => setStarting(true)}>Iniciar conteo</Button>}
      />
      <Loadable query={q}>{(counts) => counts.length ? (
        <ul className="count-list">
          {counts.map((c) => (
            <li key={c.id}>
              <Link to={`/conteo/${c.id}`} className="count-row">
                <span className="count-row__id">#{c.id}</span>
                <span className="count-row__main"><strong>{c.sector}</strong><span className="muted">Iniciado por {c.startedByName} · {fmtDateTime(c.startedAt)}</span></span>
                <span className="count-row__nums">
                  <span>{c.summary.counted}/{c.summary.lines} contadas</span>
                  <span className={c.summary.differences ? 'late' : 'ok'}>{c.summary.differences ? plural(c.summary.differences, 'diferencia', 'diferencias') : 'Sin diferencias'}</span>
                </span>
                {statusBadge(c.status)}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ScanLine} title="Todavía no hay conteos" action={<Button variant="primary" icon={Play} onClick={() => setStarting(true)}>Iniciar el primero</Button>}>
          Elegí un sector, contá lo que hay en cada ubicación y confirmá.
        </EmptyState>
      )}</Loadable>
      {starting && <StartDialog onClose={() => setStarting(false)} />}
    </div>
  )
}

function StartDialog({ onClose }: { onClose(): void }) {
  const sectors = useSectors(1)
  const start = useStartCount()
  const navigate = useNavigate()
  const [sector, setSector] = useState('')
  useEffect(() => { if (!sector && sectors.data?.length) setSector(sectors.data.find((s) => s.startsWith('Pasillo')) ?? sectors.data[0]) }, [sectors.data, sector])
  return (
    <Dialog open onClose={onClose} title="Iniciar conteo"
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={Play} loading={start.isPending} disabled={!sector}
          onClick={() => start.mutate({ warehouseId: 1, sector }, { onSuccess: (c) => navigate(`/conteo/${c.id}`) })}>Iniciar</Button></>}>
      <p className="confirm-text">Se toma una foto del stock del sector: cada ubicación con mercadería pasa a la lista para contar.</p>
      <Field label="Sector">{(id) => (
        <Select id={id} value={sector} onChange={(e) => setSector(e.target.value)}>
          {(sectors.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={ALL}>{ALL}</option>
        </Select>
      )}</Field>
      <ErrorNote error={start.error} />
    </Dialog>
  )
}

export function CountPage() {
  const id = Number(useParams().id)
  const q = useCount(id)
  return <div className="page"><Loadable query={q}>{(c) => <CountView count={c} />}</Loadable></div>
}

function CountView({ count: c }: { count: InventoryCountDetail }) {
  const [filter, setFilter] = useState<'todas' | 'pendientes' | 'diferencias'>('todas')
  const [dialog, setDialog] = useState<'confirm' | 'cancel' | null>(null)
  const confirm = useConfirmCount(c.id)
  const cancel = useCancelCount(c.id)
  const toast = useToast()
  const isMobile = useIsMobile()
  const open = c.status === 'en_curso'
  const s = c.summary
  const diff = (l: CountLine) => (l.countedQty === null ? null : l.countedQty - l.currentQty)
  const lines = c.lines.filter((l) => filter === 'todas' || (filter === 'pendientes' ? l.countedQty === null : (diff(l) ?? 0) !== 0))

  return (
    <>
      <PageHeader
        phase={3}
        back={{ to: '/conteo', label: 'Conteos' }}
        title={<span className="title-row">Conteo #{c.id} · {c.sector} {statusBadge(c.status)}</span>}
        subtitle={<>Iniciado por {c.startedByName} el {fmtDateTime(c.startedAt)}{c.confirmedAt && ` · ${c.status === 'confirmado' ? 'confirmado' : 'cancelado'} por ${c.confirmedByName} el ${fmtDateTime(c.confirmedAt)}`}</>}
        actions={open && <>
          <Button variant="danger" icon={Ban} onClick={() => setDialog('cancel')}>Cancelar conteo</Button>
          <Button variant="primary" icon={CheckCheck} onClick={() => setDialog('confirm')} disabled={!s.counted}>Confirmar inventario</Button>
        </>}
      />

      <div className="count-summary">
        <div><span className="stat__label">Contadas</span><strong className="mono">{s.counted} / {s.lines}</strong><Progress value={s.counted} max={s.lines} tone="blue" /></div>
        <div><span className="stat__label">Diferencias</span><strong className={`mono${s.differences ? ' late' : ''}`}>{s.differences}</strong></div>
        <div><span className="stat__label">Sobrante</span><strong className="mono">+{fmt(s.plus)}</strong></div>
        <div><span className="stat__label">Faltante</span><strong className="mono">−{fmt(s.minus)}</strong></div>
      </div>

      <Segmented label="Filtro" value={filter} onChange={setFilter} options={[
        { value: 'todas', label: 'Todas', count: c.lines.length },
        { value: 'pendientes', label: 'Sin contar', count: c.lines.filter((l) => l.countedQty === null).length },
        { value: 'diferencias', label: 'Con diferencias', count: s.differences },
      ]} />

      <Card padded={false}>
        {isMobile ? (
          <ul className="count-cards">
            {lines.map((l) => <li key={l.id}><CountLineCard countId={c.id} line={l} editable={open} /></li>)}
          </ul>
        ) : (
          <div className="table-wrap table-wrap--flush">
            <table className="table">
              <thead><tr><th>Producto</th><th>Ubicación</th><th className="num">Stock sistema</th><th className="num">Conteo físico</th><th className="num">Diferencia</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={(diff(l) ?? 0) !== 0 ? 'row-diff' : undefined}>
                    <td><strong>{l.productName}</strong><span className="sub mono">{l.productCode}</span></td>
                    <td className="mono">{l.locationCode}</td>
                    <td className="num">{fmt(l.currentQty)}{l.currentQty !== l.systemQty && <span className="sub" title="Cambió desde que empezó el conteo">al iniciar: {fmt(l.systemQty)}</span>}</td>
                    <td className="num"><CountInput countId={c.id} line={l} editable={open} /></td>
                    <td className="num"><Diff value={diff(l)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!lines.length && <EmptyState icon={Check} title="No hay líneas con este filtro" />}
      </Card>

      <ConfirmDialog
        open={dialog === 'confirm'} onClose={() => setDialog(null)} title="¿Confirmar inventario?" confirmLabel="Confirmar inventario"
        loading={confirm.isPending} error={confirm.error?.message}
        onConfirm={() => confirm.mutate(undefined, { onSuccess: () => { setDialog(null); toast.ok(`Conteo #${c.id} confirmado`) } })}
      >
        Se ajusta el stock de <strong>{plural(s.differences, 'ubicación', 'ubicaciones')}</strong> (+{fmt(s.plus)} / −{fmt(s.minus)} unidades).
        {s.counted < s.lines && <> Las <strong>{s.lines - s.counted}</strong> líneas sin contar quedan como están.</>}
        {' '}Si una ubicación queda con menos de lo reservado, los pedidos afectados pasan a tener faltante.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'cancel'} onClose={() => setDialog(null)} title="¿Cancelar el conteo?" tone="danger" confirmLabel="Cancelar conteo"
        loading={cancel.isPending} onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setDialog(null) })}
      >
        No se ajusta nada. Lo cargado queda registrado en el historial.
      </ConfirmDialog>
    </>
  )
}

function Diff({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>
  if (value === 0) return <span className="ok">0</span>
  return <strong className={value < 0 ? 'late' : 'plus'}>{value > 0 ? '+' : '−'}{fmt(Math.abs(value))}</strong>
}

function CountInput({ countId, line: l, editable }: { countId: number; line: CountLine; editable: boolean }) {
  const save = useCountLine(countId)
  const [v, setV] = useState(l.countedQty === null ? '' : String(l.countedQty))
  useEffect(() => setV(l.countedQty === null ? '' : String(l.countedQty)), [l.countedQty])
  if (!editable) return <span className="mono">{l.countedQty === null ? '—' : fmt(l.countedQty)}</span>
  const commit = (raw: string) => {
    const next = raw === '' ? null : Number(raw)
    if (next !== l.countedQty) save.mutate({ lineId: l.id, countedQty: next })
  }
  return (
    <span className="count-input">
      <button type="button" className="count-input__eq" title="Coincide con el sistema" aria-label={`Coincide: ${l.currentQty}`} onClick={() => { setV(String(l.currentQty)); commit(String(l.currentQty)) }}><Equal size={14} /></button>
      <input
        inputMode="numeric" value={v} placeholder="—" aria-label={`Conteo físico de ${l.productName} en ${l.locationCode}`}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
        onBlur={() => commit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={save.isPending ? 'is-saving' : undefined}
      />
    </span>
  )
}

function CountLineCard({ countId, line: l, editable }: { countId: number; line: CountLine; editable: boolean }) {
  const d = l.countedQty === null ? null : l.countedQty - l.currentQty
  return (
    <div className={`count-card${d ? ' is-diff' : ''}`}>
      <div className="count-card__head"><strong>{l.productName}</strong><span className="mono">{l.locationCode}</span></div>
      <dl className="count-card__nums">
        <div><dt>Sistema</dt><dd>{fmt(l.currentQty)}</dd></div>
        <div><dt>Físico</dt><dd><CountInput countId={countId} line={l} editable={editable} /></dd></div>
        <div><dt>Diferencia</dt><dd><Diff value={d} /></dd></div>
      </dl>
    </div>
  )
}
