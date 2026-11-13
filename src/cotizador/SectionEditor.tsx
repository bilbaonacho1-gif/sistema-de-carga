/**
 * EDITOR DE LA FORMA DE UNA PIEZA: el corte se dibuja con puntos, como un plano. Cada punto se
 * arrastra o se escribe (en mm), se agregan puntos sobre cualquier lado (+) y se borran. La forma
 * puede ser de chapa (abierta como una C o cerrada como una caja, con su espesor) o maciza.
 * También arranca de una forma hecha (caja, C, U, L, omega, doble T) o de un dibujo de AutoCAD (DXF).
 */
import { FlipHorizontal2, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  bendAt, developedLength, isBend, normalizeShape, presetShape, PRESETS, resizeShape, sectionOutline, sectionSize, segmentLengths, setBend, setSegmentLength,
  shapeBounds, shapeFromDxf, SHAPE_LIMITS, type Pt, type SectionShape,
} from '../shared/rack/section'
import { NumberStepper, Switch } from '../web/components/fields'
import { Segmented } from '../web/components/ui'

type Kind = 'beam' | 'upright'
interface View { x: number; y: number; w: number; h: number }
const ASPECT = 4 / 3

/** La vista que encuadra la forma con margen (proporción fija). */
function fitView(s: SectionShape): View {
  const b = shapeBounds(sectionOutline(s).outer)
  const pad = Math.max(18, Math.max(b.w, b.h) * 0.3)
  let w = b.w + pad * 2, h = b.h + pad * 2
  if (w / h > ASPECT) h = w / ASPECT; else w = h * ASPECT
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }
}
const pathOf = (pts: Pt[]) => `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`
const fmtMm = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

export function SectionEditor({ kind, shape, onChange, onRemove, onError, aside }: {
  kind: Kind; shape: SectionShape; onChange(s: SectionShape): void; onRemove(): void; onError(text: string): void
  /** Lo que va al lado del dibujo (la vista 3D de la pieza). */
  aside?: ReactNode
}) {
  const svg = useRef<SVGSVGElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [view, setView] = useState<View>(() => fitView(shape))
  const drag = useRef<{ i: number } | null>(null)
  const latest = useRef(shape)
  latest.current = shape
  // la vista sigue a la forma, salvo mientras se arrastra un punto (para que no se mueva el fondo)
  useEffect(() => { if (!drag.current) setView(fitView(shape)) }, [shape])
  useEffect(() => { if (sel !== null && sel >= shape.points.length) setSel(null) }, [sel, shape.points.length])

  const px = (n: number) => (n * view.w) / 420
  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const m = svg.current!.getScreenCTM()!.inverse()
    return { x: m.a * e.clientX + m.c * e.clientY + m.e, y: m.b * e.clientX + m.d * e.clientY + m.f }
  }
  const pts = shape.points
  const setPoints = (points: Pt[], normalize = true) => onChange(normalize ? normalizeShape({ ...shape, points }) : { ...shape, points })

  const down = (e: React.PointerEvent, i: number) => {
    e.preventDefault(); e.stopPropagation()
    setSel(i)
    drag.current = { i }
    svg.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(e)
    // de a 1 mm (con Shift, de a 5 mm)
    const g = e.shiftKey ? 5 : 1
    const next = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
    const cur = latest.current.points[d.i]
    if (cur && (cur.x !== next.x || cur.y !== next.y)) setPoints(latest.current.points.map((q, k) => (k === d.i ? { ...q, ...next } : q)), false)
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    onChange(normalizeShape(latest.current))
  }

  const minPoints = shape.closed ? 3 : 2
  const removePoint = (i: number) => { if (pts.length > minPoints) { setPoints(pts.filter((_, k) => k !== i)); setSel(null) } }
  const addAfter = (i: number) => {
    if (pts.length >= SHAPE_LIMITS.points) return
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }
    setPoints([...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)], false)
    setSel(i + 1)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (sel === null || (e.target as HTMLElement).closest('input')) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePoint(sel) }
    const step = e.shiftKey ? 5 : 1
    const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null
    if (d) { e.preventDefault(); setPoints(pts.map((q, k) => (k === sel ? { ...q, x: q.x + d[0], y: q.y + d[1] } : q))) }
  }

  const outline = sectionOutline(shape)
  const size = sectionSize(shape)
  const b = shapeBounds(pts)
  const segs = pts.map((p, i) => ({ a: p, b: pts[(i + 1) % pts.length], i })).filter((s) => shape.closed || s.i < pts.length - 1)
  const color = kind === 'beam' ? '#be1e30' : '#6b7480'
  const grid = view.w > 400 ? 50 : 10
  const gx0 = Math.floor(view.x / grid) * grid, gy0 = Math.floor(view.y / grid) * grid
  const loadFile = async (f: File | undefined) => {
    if (!f) return
    const s = shapeFromDxf(await f.text())
    if (!s) { onError('No encontré ningún dibujo en ese archivo. Guardalo como DXF (texto) con el corte dibujado con líneas o una polilínea.'); return }
    // el dibujo se acomoda a un tamaño lógico para esta pieza; después se ajusta con "Medida total"
    const bb = shapeBounds(s.points), max = kind === 'beam' ? 200 : 160
    onChange(Math.max(bb.w, bb.h) > max || Math.max(bb.w, bb.h) < 20 ? resizeShape(s, (bb.w / Math.max(bb.w, bb.h)) * 100, (bb.h / Math.max(bb.w, bb.h)) * 100) : s)
    setSel(null)
  }
  const p = sel !== null ? pts[sel] : null
  const bend = sel !== null ? bendAt(shape, sel) : null
  const lens = segmentLengths(shape)
  const baseRadius = shape.radius ?? 0

  return (
    <div className="sect" onKeyDown={onKey}>
      <div className="sect__top">
      <div className="sect__canvas">
        <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} tabIndex={0} role="application" aria-label="Forma de la pieza: arrastrá los puntos"
          onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSel(null)}>
          {/* cuadrícula */}
          <g stroke="#e3e6ea" strokeWidth={px(1)}>
            {Array.from({ length: Math.ceil(view.w / grid) + 2 }, (_, k) => <line key={`x${k}`} x1={gx0 + k * grid} y1={view.y} x2={gx0 + k * grid} y2={view.y + view.h} />)}
            {Array.from({ length: Math.ceil(view.h / grid) + 2 }, (_, k) => <line key={`y${k}`} x1={view.x} y1={gy0 + k * grid} x2={view.x + view.w} y2={gy0 + k * grid} />)}
          </g>
          {/* el material */}
          <path d={[pathOf(outline.outer), ...outline.holes.map(pathOf)].join(' ')} fill={color} fillOpacity={0.9} fillRule="evenodd" />
          {/* la línea de los puntos */}
          <path d={`M ${pts.map((q) => `${q.x} ${q.y}`).join(' L ')}${shape.closed ? ' Z' : ''}`} fill="none" stroke="#fff" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} opacity={shape.solid ? 0 : 0.8} />
          {/* medidas totales */}
          <g fill="#2f6fb8" fontSize={px(12)} fontFamily="var(--f-mono)" fontWeight={700}>
            <text x={b.x + b.w / 2} y={b.y + b.h + px(34)} textAnchor="middle">{size.w} mm</text>
            <text x={b.x - px(22)} y={b.y + b.h / 2} textAnchor="end" dominantBaseline="middle">{size.h} mm</text>
          </g>
          <text x={view.x + px(8)} y={view.y + px(16)} fontSize={px(11)} fill="#8a9099" fontFamily="var(--f-body)">{kind === 'beam' ? '↑ arriba' : '↑ pasillo (frente del parante)'}</text>
          {/* + para agregar un punto en el medio de cada lado */}
          {segs.map((s) => (
            <g key={`m${s.i}`} style={{ cursor: 'copy' }} onPointerDown={(e) => { e.stopPropagation(); addAfter(s.i) }}>
              <circle cx={(s.a.x + s.b.x) / 2} cy={(s.a.y + s.b.y) / 2} r={px(7)} fill="#fff" stroke="#2f6fb8" strokeWidth={px(1.2)} opacity={0.9} />
              <path d={`M ${(s.a.x + s.b.x) / 2 - px(3.5)} ${(s.a.y + s.b.y) / 2} h ${px(7)} M ${(s.a.x + s.b.x) / 2} ${(s.a.y + s.b.y) / 2 - px(3.5)} v ${px(7)}`} stroke="#2f6fb8" strokeWidth={px(1.5)} />
            </g>
          ))}
          {/* los puntos */}
          {pts.map((q, i) => (
            <circle key={i} cx={q.x} cy={q.y} r={px(sel === i ? 8 : 6.5)} fill={sel === i ? '#be1e30' : '#fff'} stroke="#be1e30" strokeWidth={px(2)}
              style={{ cursor: 'grab' }} onPointerDown={(e) => down(e, i)} />
          ))}
        </svg>
        <p className="sect__tip">Arrastrá un punto · <b>+</b> agrega uno · Supr lo borra · flechas lo mueven de a 1 mm</p>
      </div>
      {aside}
      </div>

      {p && sel !== null && (
        <div className="sect__point">
          <strong>Punto {sel + 1} de {pts.length}</strong>
          <NumberStepper label="Hacia la derecha" unit="mm" value={p.x} min={-SHAPE_LIMITS.size} max={SHAPE_LIMITS.size} step={1} typedStep={0.5}
            onChange={(x) => setPoints(pts.map((q, k) => (k === sel ? { ...q, x } : q)))} />
          <NumberStepper label="Hacia abajo" unit="mm" value={p.y} min={-SHAPE_LIMITS.size} max={SHAPE_LIMITS.size} step={1} typedStep={0.5}
            onChange={(y) => setPoints(pts.map((q, k) => (k === sel ? { ...q, y } : q)))} />
          {/* el doblez de este punto: ángulo (como en una plegadora) y radio */}
          {bend && <>
            <NumberStepper label="Ángulo del doblez" unit="°" value={bend.angle} min={5} max={180} step={5} typedStep={0.5}
              onChange={(a) => onChange(normalizeShape(setBend(shape, sel, a)))} hint={bend.side === 0 ? 'Ahora está derecha (180°): bajá el ángulo para doblarla' : '90° = a escuadra · 180° = derecha'} />
            <NumberStepper label="Radio de este doblez" unit="mm" value={p.r ?? baseRadius} min={SHAPE_LIMITS.radius.min} max={SHAPE_LIMITS.radius.max} step={1} typedStep={0.5}
              onChange={(r) => setPoints(pts.map((q, k) => (k === sel ? { ...q, r: r === baseRadius ? undefined : r } : q)))}
              hint={p.r === undefined ? 'Como el resto' : 'Propio de este doblez'} />
          </>}
          <div className="sect__point-actions">
            {bend && bend.side !== 0 && <button type="button" className="vp-btn" onClick={() => onChange(normalizeShape(setBend(shape, sel, bend.angle, bend.side === 1 ? -1 : 1)))}><FlipHorizontal2 size={14} aria-hidden /> Doblar para el otro lado</button>}
            <button type="button" className="vp-btn" disabled={pts.length <= minPoints} onClick={() => removePoint(sel)}><Trash2 size={14} aria-hidden /> Borrar punto</button>
          </div>
        </div>
      )}

      <div className="sect__opts">
        <Segmented label="Cómo es" value={shape.solid ? 'maciza' : 'chapa'} onChange={(v) => onChange({ ...shape, solid: v === 'maciza', closed: v === 'maciza' ? true : shape.closed })}
          options={[{ value: 'chapa', label: 'De chapa doblada' }, { value: 'maciza', label: 'Maciza (contorno)' }]} />
        {!shape.solid && <div className="cot-inline">
          <NumberStepper label="Espesor de la chapa" unit="mm" value={shape.thickness} min={SHAPE_LIMITS.thickness.min} max={SHAPE_LIMITS.thickness.max} step={0.5}
            onChange={(thickness) => onChange({ ...shape, thickness })} />
          <NumberStepper label="Radio de los dobleces" unit="mm" value={baseRadius} min={SHAPE_LIMITS.radius.min} max={SHAPE_LIMITS.radius.max} step={1} typedStep={0.5}
            onChange={(radius) => onChange({ ...shape, radius })} hint="Por dentro de la chapa · 0 = esquina viva" />
          <Switch label="Cerrada" checked={shape.closed} onChange={(closed) => pts.length >= 3 && onChange({ ...shape, closed })} hint="Une el último punto con el primero" />
        </div>}
        <div className="cot-inline">
          <NumberStepper label="Medida total · ancho" unit="mm" value={Math.round(b.w)} min={5} max={SHAPE_LIMITS.size} step={5} typedStep={1} onChange={(w) => onChange(resizeShape(shape, w, b.h))} />
          <NumberStepper label="Medida total · alto" unit="mm" value={Math.round(b.h)} min={5} max={SHAPE_LIMITS.size} step={5} typedStep={1} onChange={(h) => onChange(resizeShape(shape, b.w, h))} />
        </div>
        <p className="muted small">El material mide {size.w} × {size.h} mm{shape.solid ? '' : ` (con la chapa de ${fmtMm(shape.thickness)} mm)`}.</p>
        {/* la chapa como la ve la plegadora: el largo de cada tramo y el ángulo de cada doblez */}
        <details className="plan-more sect__table">
          <summary>Tabla de dobleces (largos y ángulos)</summary>
          <p className="muted small">De una punta a la otra. Al cambiar un largo o un ángulo, el resto de la chapa se acomoda sola.</p>
          {lens.map((len, i) => {
            const next = (i + 1) % pts.length, nb = isBend(shape, next) && (shape.closed || i < lens.length - 1) ? bendAt(shape, next) : null
            return (
              <div key={i} className="sect__row">
                <div onFocusCapture={() => setSel(i)}>
                  <NumberStepper label={`Tramo ${i + 1}`} unit="mm" value={Math.round(len * 10) / 10} min={1} max={SHAPE_LIMITS.size} step={5} typedStep={0.5}
                    onChange={(l) => onChange(normalizeShape(setSegmentLength(shape, i, l)))} />
                </div>
                {nb && <div onFocusCapture={() => setSel(next)}>
                  <NumberStepper label={`Doblez ${i + 1}`} unit="°" value={nb.angle} min={5} max={180} step={5} typedStep={0.5}
                    onChange={(a) => onChange(normalizeShape(setBend(shape, next, a)))} />
                </div>}
              </div>
            )
          })}
          {!shape.solid && <p className="sect__dev">Desarrollo de la chapa (ancho antes de doblarla): <b>{developedLength(shape)} mm</b></p>}
        </details>
        <div className="sect__presets">
          <span>Empezar de:</span>
          {PRESETS.map((x) => <button key={x.id} type="button" className="vp-btn" onClick={() => { onChange(presetShape(x.id, Math.max(20, Math.round(b.w)), Math.max(20, Math.round(b.h)), shape.thickness)); setSel(null) }}>{x.name}</button>)}
        </div>
        <div className="sect__presets">
          <button type="button" className="vp-btn" onClick={() => file.current?.click()}><Upload size={14} aria-hidden /> Cargar dibujo de AutoCAD (DXF)</button>
          <input ref={file} type="file" accept=".dxf" hidden onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" className="link-btn" onClick={onRemove}>Volver a la forma de siempre</button>
        </div>
      </div>
    </div>
  )
}
