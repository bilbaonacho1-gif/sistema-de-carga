/**
 * EDITOR DE LA FORMA DE UNA PIEZA: el corte se dibuja con puntos, como un plano. Cada punto se
 * arrastra o se escribe (en mm), se agregan puntos sobre cualquier lado (+) y se borran. La forma
 * puede ser de chapa (abierta como una C o cerrada como una caja, con su espesor) o maciza.
 * También arranca de una forma hecha (caja, C, U, L, omega, doble T) o de un dibujo de AutoCAD (DXF).
 * Una pieza puede llevar VARIAS formas (dos chapas, una caja con un refuerzo…): se agregan con
 * "Otra forma", se elige una tocándola y se la mueve arrastrándola.
 */
import { Copy, FlipHorizontal2, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  bendAt, developedLength, fromParts, isBend, materialBounds, normalizeShape, partsOf, presetShape, PRESETS, resizeShape, scaleShape, sectionOutlines, sectionSize,
  segmentLengths, setBend, setSegmentLength, shapeBounds, shapeFromDxf, SHAPE_LIMITS, shiftPart, type Pt, type SectionPart, type SectionShape,
} from '../shared/rack/section'
import { NumberStepper, Switch } from '../web/components/fields'
import { Segmented } from '../web/components/ui'

type Kind = 'beam' | 'upright'
interface View { x: number; y: number; w: number; h: number }
const ASPECT = 4 / 3

/** La vista que encuadra la forma con margen (proporción fija). */
function fitView(s: SectionShape): View {
  const b = materialBounds(s)
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
  // la forma que se está tocando (una pieza puede tener varias)
  const [partSel, setPartSel] = useState(0)
  const [view, setView] = useState<View>(() => fitView(shape))
  const drag = useRef<{ i: number } | { from: Pt; orig: Pt[] } | null>(null)
  const latest = useRef(shape)
  latest.current = shape
  const parts = partsOf(shape)
  const pi = Math.min(partSel, parts.length - 1)
  const cur = parts[pi]
  // la vista sigue a la forma, salvo mientras se arrastra (para que no se mueva el fondo)
  useEffect(() => { if (!drag.current) setView(fitView(shape)) }, [shape])
  useEffect(() => { if (sel !== null && sel >= cur.points.length) setSel(null) }, [sel, cur.points.length])
  useEffect(() => { if (partSel > parts.length - 1) setPartSel(parts.length - 1) }, [partSel, parts.length])

  const px = (n: number) => (n * view.w) / 420
  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const m = svg.current!.getScreenCTM()!.inverse()
    return { x: m.a * e.clientX + m.c * e.clientY + m.e, y: m.b * e.clientX + m.d * e.clientY + m.f }
  }
  const pts = cur.points
  /** Cambia la forma que se está tocando (las demás quedan como están). */
  const apply = (next: SectionPart, normalize = true, base: SectionShape = shape) => {
    const full = fromParts(partsOf(base).map((q, k) => (k === pi ? next : q)))
    onChange(normalize ? normalizeShape(full) : full)
  }
  const setPoints = (points: Pt[], normalize = true) => apply({ ...cur, points }, normalize)
  const pickPart = (k: number) => { setPartSel(k); setSel(null) }

  const down = (e: React.PointerEvent, i: number) => {
    e.preventDefault(); e.stopPropagation()
    setSel(i)
    drag.current = { i }
    svg.current!.setPointerCapture(e.pointerId)
  }
  /** Agarra una forma entera para moverla (sólo si la pieza tiene más de una). */
  const downPart = (e: React.PointerEvent, k: number) => {
    if (parts.length < 2) return
    e.preventDefault(); e.stopPropagation()
    pickPart(k)
    drag.current = { from: toMm(e), orig: parts[k].points }
    svg.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(e)
    // de a 1 mm (con Shift, de a 5 mm)
    const g = e.shiftKey ? 5 : 1
    const now = partsOf(latest.current)[pi]
    if (!now) return
    if ('orig' in d) {
      const dx = Math.round((p.x - d.from.x) / g) * g, dy = Math.round((p.y - d.from.y) / g) * g
      const first = d.orig[0], at = now.points[0]
      if (at.x !== first.x + dx || at.y !== first.y + dy) apply({ ...now, points: d.orig.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) }, false, latest.current)
      return
    }
    const next = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
    const at = now.points[d.i]
    if (at && (at.x !== next.x || at.y !== next.y)) apply({ ...now, points: now.points.map((q, k) => (k === d.i ? { ...q, ...next } : q)) }, false, latest.current)
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    onChange(normalizeShape(latest.current))
  }

  const minPoints = cur.closed ? 3 : 2
  const removePoint = (i: number) => { if (pts.length > minPoints) { setPoints(pts.filter((_, k) => k !== i)); setSel(null) } }
  const addAfter = (i: number) => {
    if (pts.length >= SHAPE_LIMITS.points) return
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }
    setPoints([...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)], false)
    setSel(i + 1)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input')) return
    const step = e.shiftKey ? 5 : 1
    const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null
    // sin un punto elegido, las flechas mueven la forma entera (si hay más de una)
    if (sel === null) { if (d && parts.length > 1) { e.preventDefault(); apply(shiftPart(cur, d[0], d[1])) } return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePoint(sel) }
    if (d) { e.preventDefault(); setPoints(pts.map((q, k) => (k === sel ? { ...q, x: q.x + d[0], y: q.y + d[1] } : q))) }
  }

  /* ---- varias formas en la misma pieza ---- */
  const canAdd = parts.length < SHAPE_LIMITS.parts
  const putNew = (np: SectionPart) => { onChange(normalizeShape(fromParts([...parts, np]))); setPartSel(parts.length); setSel(null) }
  /** Otra forma: una caja de la mitad del tamaño, al lado de lo que ya hay (después se cambia). */
  const addPart = () => {
    const all = shapeBounds(parts.flatMap((q) => q.points))
    putNew(shiftPart(presetShape('caja', Math.max(20, Math.round(all.w / 2)), Math.max(20, Math.round(all.h / 2)), cur.thickness), all.x + all.w + 15, all.y))
  }
  const copyPart = () => {
    const all = shapeBounds(parts.flatMap((q) => q.points)), own = shapeBounds(pts)
    putNew(shiftPart(cur, all.x + all.w + 15 - own.x, 0))
  }
  const removePart = () => {
    if (parts.length < 2) return
    onChange(normalizeShape(fromParts(parts.filter((_, k) => k !== pi)))); setPartSel(0); setSel(null)
  }

  const outlines = sectionOutlines(shape)
  const size = sectionSize(shape)
  const b = shapeBounds(pts)
  const all = materialBounds(shape)
  const segs = pts.map((p, i) => ({ a: p, b: pts[(i + 1) % pts.length], i })).filter((s) => cur.closed || s.i < pts.length - 1)
  const color = kind === 'beam' ? '#be1e30' : '#6b7480'
  const grid = view.w > 400 ? 50 : 10
  const gx0 = Math.floor(view.x / grid) * grid, gy0 = Math.floor(view.y / grid) * grid
  const loadFile = async (f: File | undefined) => {
    if (!f) return
    const s = shapeFromDxf(await f.text())
    if (!s) { onError('No encontré ningún dibujo en ese archivo. Guardalo como DXF (texto) con el corte dibujado con líneas o una polilínea.'); return }
    // el dibujo se acomoda a un tamaño lógico para esta pieza; después se ajusta con "Medida total"
    const bb = materialBounds(s), big = Math.max(bb.w, bb.h), max = kind === 'beam' ? 200 : 160
    onChange(big > max || big < 20 ? scaleShape(s, 100 / big) : s)
    pickPart(0)
  }
  const p = sel !== null ? pts[sel] : null
  const bend = sel !== null ? bendAt(cur, sel) : null
  const lens = segmentLengths(cur)
  const baseRadius = cur.radius ?? 0
  const many = parts.length > 1

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
          {/* el material: cada forma de la pieza (la que se está tocando, más fuerte) */}
          {outlines.map((o, k) => (
            <path key={k} d={[pathOf(o.outer), ...o.holes.map(pathOf)].join(' ')} fill={color} fillOpacity={k === pi ? 0.9 : 0.5} fillRule="evenodd"
              stroke={many && k === pi ? '#2f6fb8' : 'none'} strokeWidth={px(1)} pointerEvents="none" />
          ))}
          {/* de dónde se agarra cada forma para moverla: toda su línea, bien ancha, y su interior si es cerrada */}
          {many && parts.map((q, k) => (
            <path key={`h${k}`} d={`M ${q.points.map((t) => `${t.x} ${t.y}`).join(' L ')}${q.closed ? ' Z' : ''}`} fill={q.closed ? 'transparent' : 'none'} stroke="transparent" strokeWidth={px(16)}
              strokeLinejoin="round" strokeLinecap="round" style={{ cursor: 'move' }} onPointerDown={(e) => downPart(e, k)} />
          ))}
          {/* la línea de los puntos */}
          <path d={`M ${pts.map((q) => `${q.x} ${q.y}`).join(' L ')}${cur.closed ? ' Z' : ''}`} fill="none" stroke="#fff" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} opacity={cur.solid ? 0 : 0.8} pointerEvents="none" />
          {/* medidas totales de la pieza */}
          <g fill="#2f6fb8" fontSize={px(12)} fontFamily="var(--f-mono)" fontWeight={700} pointerEvents="none">
            <text x={all.x + all.w / 2} y={all.y + all.h + px(30)} textAnchor="middle">{size.w} mm</text>
            <text x={all.x - px(18)} y={all.y + all.h / 2} textAnchor="end" dominantBaseline="middle">{size.h} mm</text>
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
        <p className="sect__tip">Arrastrá un punto · <b>+</b> agrega uno · Supr lo borra · flechas lo mueven de a 1 mm{many ? ' · arrastrá una forma para moverla entera' : ''}</p>
      </div>
      {aside}
      </div>

      {/* las formas de la pieza: se puede dibujar más de una */}
      <div className="sect__parts">
        <span>{many ? 'Formas de esta pieza:' : 'Una sola forma.'}</span>
        {many && parts.map((_, k) => (
          <button key={k} type="button" className={`sect__part${k === pi ? ' is-on' : ''}`} aria-pressed={k === pi} onClick={() => pickPart(k)}>Forma {k + 1}</button>
        ))}
        <button type="button" className="vp-btn" disabled={!canAdd} onClick={addPart}><Plus size={14} aria-hidden /> Otra forma</button>
        {many && <>
          <button type="button" className="vp-btn" disabled={!canAdd} onClick={copyPart}><Copy size={14} aria-hidden /> Duplicar esta</button>
          <button type="button" className="vp-btn" onClick={removePart}><Trash2 size={14} aria-hidden /> Borrar esta</button>
        </>}
      </div>
      {many && (
        <div className="cot-inline sect__pos">
          <NumberStepper label={`Forma ${pi + 1} · corrida a la derecha`} unit="mm" value={Math.round(b.x)} min={-SHAPE_LIMITS.size} max={SHAPE_LIMITS.size} step={5} typedStep={0.5}
            onChange={(x) => apply(shiftPart(cur, x - b.x, 0))} />
          <NumberStepper label={`Forma ${pi + 1} · corrida hacia abajo`} unit="mm" value={Math.round(b.y)} min={-SHAPE_LIMITS.size} max={SHAPE_LIMITS.size} step={5} typedStep={0.5}
            onChange={(y) => apply(shiftPart(cur, 0, y - b.y))} />
        </div>
      )}

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
              onChange={(a) => apply(setBend(cur, sel, a))} hint={bend.side === 0 ? 'Ahora está derecha (180°): bajá el ángulo para doblarla' : '90° = a escuadra · 180° = derecha'} />
            <NumberStepper label="Radio de este doblez" unit="mm" value={p.r ?? baseRadius} min={SHAPE_LIMITS.radius.min} max={SHAPE_LIMITS.radius.max} step={1} typedStep={0.5}
              onChange={(r) => setPoints(pts.map((q, k) => (k === sel ? { ...q, r: r === baseRadius ? undefined : r } : q)))}
              hint={p.r === undefined ? 'Como el resto' : 'Propio de este doblez'} />
          </>}
          <div className="sect__point-actions">
            {bend && bend.side !== 0 && <button type="button" className="vp-btn" onClick={() => apply(setBend(cur, sel, bend.angle, bend.side === 1 ? -1 : 1))}><FlipHorizontal2 size={14} aria-hidden /> Doblar para el otro lado</button>}
            <button type="button" className="vp-btn" disabled={pts.length <= minPoints} onClick={() => removePoint(sel)}><Trash2 size={14} aria-hidden /> Borrar punto</button>
          </div>
        </div>
      )}

      <div className="sect__opts">
        <Segmented label={many ? `Cómo es la forma ${pi + 1}` : 'Cómo es'} value={cur.solid ? 'maciza' : 'chapa'} onChange={(v) => apply({ ...cur, solid: v === 'maciza', closed: v === 'maciza' ? true : cur.closed }, false)}
          options={[{ value: 'chapa', label: 'De chapa doblada' }, { value: 'maciza', label: 'Maciza (contorno)' }]} />
        {!cur.solid && <div className="cot-inline">
          <NumberStepper label="Espesor de la chapa" unit="mm" value={cur.thickness} min={SHAPE_LIMITS.thickness.min} max={SHAPE_LIMITS.thickness.max} step={0.5}
            onChange={(thickness) => apply({ ...cur, thickness }, false)} />
          <NumberStepper label="Radio de los dobleces" unit="mm" value={baseRadius} min={SHAPE_LIMITS.radius.min} max={SHAPE_LIMITS.radius.max} step={1} typedStep={0.5}
            onChange={(radius) => apply({ ...cur, radius }, false)} hint="Por dentro de la chapa · 0 = esquina viva" />
          <Switch label="Cerrada" checked={cur.closed} onChange={(closed) => pts.length >= 3 && apply({ ...cur, closed }, false)} hint="Une el último punto con el primero" />
        </div>}
        <div className="cot-inline">
          <NumberStepper label={many ? `Forma ${pi + 1} · ancho` : 'Medida total · ancho'} unit="mm" value={Math.round(b.w)} min={5} max={SHAPE_LIMITS.size} step={5} typedStep={1} onChange={(w) => apply(resizeShape(cur, w, b.h))} />
          <NumberStepper label={many ? `Forma ${pi + 1} · alto` : 'Medida total · alto'} unit="mm" value={Math.round(b.h)} min={5} max={SHAPE_LIMITS.size} step={5} typedStep={1} onChange={(h) => apply(resizeShape(cur, b.w, h))} />
        </div>
        <p className="muted small">{many ? `La pieza entera (las ${parts.length} formas juntas) mide ${size.w} × ${size.h} mm.` : `El material mide ${size.w} × ${size.h} mm${cur.solid ? '' : ` (con la chapa de ${fmtMm(cur.thickness)} mm)`}.`}</p>
        {/* la chapa como la ve la plegadora: el largo de cada tramo y el ángulo de cada doblez */}
        <details className="plan-more sect__table">
          <summary>Tabla de dobleces (largos y ángulos){many ? ` de la forma ${pi + 1}` : ''}</summary>
          <p className="muted small">De una punta a la otra. Al cambiar un largo o un ángulo, el resto de la chapa se acomoda sola.</p>
          {lens.map((len, i) => {
            const next = (i + 1) % pts.length, nb = isBend(cur, next) && (cur.closed || i < lens.length - 1) ? bendAt(cur, next) : null
            return (
              <div key={i} className="sect__row">
                <div onFocusCapture={() => setSel(i)}>
                  <NumberStepper label={`Tramo ${i + 1}`} unit="mm" value={Math.round(len * 10) / 10} min={1} max={SHAPE_LIMITS.size} step={5} typedStep={0.5}
                    onChange={(l) => apply(setSegmentLength(cur, i, l))} />
                </div>
                {nb && <div onFocusCapture={() => setSel(next)}>
                  <NumberStepper label={`Doblez ${i + 1}`} unit="°" value={nb.angle} min={5} max={180} step={5} typedStep={0.5}
                    onChange={(a) => apply(setBend(cur, next, a))} />
                </div>}
              </div>
            )
          })}
          {!cur.solid && <p className="sect__dev">Desarrollo de la chapa (ancho antes de doblarla): <b>{developedLength(cur)} mm</b></p>}
        </details>
        <div className="sect__presets">
          <span>{many ? `Cambiar la forma ${pi + 1} por:` : 'Empezar de:'}</span>
          {PRESETS.map((x) => <button key={x.id} type="button" className="vp-btn" onClick={() => { apply(shiftPart(presetShape(x.id, Math.max(20, Math.round(b.w)), Math.max(20, Math.round(b.h)), cur.thickness), b.x, b.y)); setSel(null) }}>{x.name}</button>)}
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
