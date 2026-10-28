/** Diálogos de stock: ingresar mercadería, mover entre ubicaciones y alta/edición de productos. */
import { ArrowRightLeft, PackagePlus, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InventoryRow, Location, Product } from '../../../shared/types'
import { useCatalog, useCategories, useSaveProduct, useStockIn, useStockMove } from '../../api/queries'
import { LocationSelect } from '../../components/LocationSelect'
import { Dialog, useToast } from '../../components/overlays'
import { ProductPicker } from '../../components/ProductPicker'
import { Button, ErrorNote, Field, Input, Textarea } from '../../components/ui'
import { fmt } from '../../lib/format'

type Loc = Location & { units: number; products: number }

export function StockInDialog({ product, location, onClose }: { product?: Product | null; location?: Loc | null; onClose(): void }) {
  const catalog = useCatalog()
  const stockIn = useStockIn()
  const toast = useToast()
  const [p, setP] = useState<Product | null>(product ?? null)
  const [loc, setLoc] = useState<Loc | null>(location ?? null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const n = Number(qty)

  return (
    <Dialog
      open onClose={onClose} title="Ingresar stock"
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={PackagePlus} loading={stockIn.isPending} disabled={!p || !loc || !(n > 0)}
          onClick={() => stockIn.mutate({ productId: p!.id, locationId: loc!.id, quantity: n, note }, { onSuccess: () => { toast.ok(`Ingresaron ${fmt(n)} u. de ${p!.name} en ${loc!.code}`); onClose() } })}>
          Ingresar
        </Button></>}
    >
      <Field label="Producto">{() => p
        ? <div className="chosen"><span className="mono">{p.code}</span> <strong>{p.name}</strong>{!product && <button type="button" className="link-btn" onClick={() => setP(null)}>Cambiar</button>}</div>
        : <ProductPicker catalog={catalog.data ?? []} exclude={[]} onPick={setP} />}</Field>
      <Field label="Ubicación">{() => <LocationSelect value={loc} onChange={setLoc} />}</Field>
      <Field label="Cantidad">{(id) => <Input id={id} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder="0" />}</Field>
      <Field label="Nota" optional>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remito, proveedor, motivo…" />}</Field>
      <ErrorNote error={stockIn.error} />
    </Dialog>
  )
}

export function MoveDialog({ row, onClose }: { row: InventoryRow; onClose(): void }) {
  const move = useStockMove()
  const toast = useToast()
  const [to, setTo] = useState<Loc | null>(null)
  const [qty, setQty] = useState(String(row.available))
  const n = Number(qty)
  return (
    <Dialog
      open onClose={onClose} title="Mover stock"
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={ArrowRightLeft} loading={move.isPending} disabled={!to || !(n > 0) || n > row.available}
          onClick={() => move.mutate({ inventoryId: row.id, toLocationId: to!.id, quantity: n }, { onSuccess: () => { toast.ok(`Se movieron ${fmt(n)} u. a ${to!.code}`); onClose() } })}>
          Mover
        </Button></>}
    >
      <p className="confirm-text">
        <strong>{row.productName}</strong> en <span className="mono">{row.locationCode}</span>: {fmt(row.quantity)} u., de las cuales <strong>{fmt(row.available)}</strong> están disponibles para mover
        {row.reserved > 0 && ` (${fmt(row.reserved)} reservadas para pedidos)`}.
      </p>
      <Field label="Llevar a">{() => <LocationSelect value={to} onChange={setTo} />}</Field>
      <Field label="Cantidad" error={n > row.available ? `Máximo ${row.available}` : undefined}>{(id) => <Input id={id} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />}</Field>
      <ErrorNote error={move.error} />
    </Dialog>
  )
}

export function ProductDialog({ product, onClose }: { product: Product | null; onClose(): void }) {
  const save = useSaveProduct()
  const categories = useCategories()
  const toast = useToast()
  const [f, setF] = useState({ code: '', name: '', category: '', unit: 'u', minStock: '0', description: '', active: true })
  useEffect(() => {
    if (product) setF({ code: product.code, name: product.name, category: product.category, unit: product.unit, minStock: String(product.minStock), description: product.description, active: product.active })
  }, [product])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <Dialog
      open onClose={onClose} title={product ? `Editar ${product.code}` : 'Nuevo producto'}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={Save} loading={save.isPending}
          onClick={() => save.mutate({ id: product?.id, ...f, minStock: Number(f.minStock) || 0 }, { onSuccess: (p) => { toast.ok(`${p.name} guardado`); onClose() } })}>
          Guardar
        </Button></>}
    >
      <div className="form-grid">
        <Field label="Código">{(id) => <Input id={id} value={f.code} onChange={set('code')} placeholder="VIG-140-2700" style={{ textTransform: 'uppercase' }} />}</Field>
        <Field label="Unidad">{(id) => <Input id={id} value={f.unit} onChange={set('unit')} placeholder="u, l, caja…" />}</Field>
        <div className="form-grid__full"><Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field></div>
        <Field label="Categoría">{(id) => (
          <>
            <Input id={id} list={`${id}-cats`} value={f.category} onChange={set('category')} />
            <datalist id={`${id}-cats`}>{(categories.data ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          </>
        )}</Field>
        <Field label="Stock mínimo" hint="Debajo de este disponible aparece en Faltantes.">{(id) => <Input id={id} inputMode="numeric" value={f.minStock} onChange={(e) => setF((x) => ({ ...x, minStock: e.target.value.replace(/\D/g, '') }))} />}</Field>
        <div className="form-grid__full"><Field label="Descripción" optional>{(id) => <Textarea id={id} value={f.description} onChange={set('description')} />}</Field></div>
        {product && (
          <label className="check-line form-grid__full">
            <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Producto activo (si lo desactivás, no se puede pedir)
          </label>
        )}
      </div>
      <ErrorNote error={save.error} />
    </Dialog>
  )
}
