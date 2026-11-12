/**
 * Piezas con FORMA PROPIA: el corte dibujado con puntos (shared/rack/section) se estira a lo largo.
 *  - viga: 1 m sobre X (después se escala al largo real), centrada, como la viga caja.
 *  - parante: de y = 0 al alto, con la cara del pasillo en z = 0 y el perfil hacia -Z.
 */
import * as THREE from 'three'
import { sectionOutline, shapeBounds, type Pt, type SectionShape } from '../../../shared/rack/section'
import { m } from '../materials'
import { cached } from './utils'

const store = new Map<string, THREE.BufferGeometry>()
const keyOf = (s: SectionShape) => `${s.closed ? 'c' : 'o'}${s.solid ? 's' : 't' + s.thickness}:${s.points.map((p) => `${p.x},${p.y}`).join(';')}`

/** El corte como figura de three (en metros), con `map` para acomodar cada punto. */
function toShape(s: SectionShape, map: (p: Pt) => [number, number]): THREE.Shape {
  const { outer, holes } = sectionOutline(s)
  const v = (pts: Pt[]) => pts.map((p) => new THREE.Vector2(...map(p)))
  const shape = new THREE.Shape(v(outer))
  for (const h of holes) shape.holes.push(new THREE.Path(v(h)))
  return shape
}

/** Viga con forma propia: 1 m de largo sobre X, centrada en su alto y su ancho. */
export function customBeamGeometry(s: SectionShape): THREE.BufferGeometry {
  return cached(store, `beam:${keyOf(s)}`, () => {
    const b = shapeBounds(sectionOutline(s).outer)
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    // en el corte, x = ancho (queda sobre Z) e y hacia abajo (queda sobre -Y)
    const g = new THREE.ExtrudeGeometry(toShape(s, (p) => [m(p.x - cx), -m(p.y - cy)]), { depth: 1, bevelEnabled: false, curveSegments: 1 })
    g.rotateY(-Math.PI / 2)   // el largo pasa a X y el ancho a Z
    g.translate(0.5, 0, 0)
    g.computeVertexNormals()
    return g
  })
}

/** Parante con forma propia: el corte visto desde arriba (x = frente, y = fondo) estirado al alto. */
export function customUprightGeometry(s: SectionShape, heightMm: number): THREE.BufferGeometry {
  return cached(store, `up:${heightMm}:${keyOf(s)}`, () => {
    const b = shapeBounds(sectionOutline(s).outer)
    const cx = b.x + b.w / 2
    const g = new THREE.ExtrudeGeometry(toShape(s, (p) => [m(p.x - cx), m(p.y - b.y)]), { depth: m(heightMm), bevelEnabled: false, curveSegments: 1 })
    g.rotateX(-Math.PI / 2)   // el alto pasa a Y y el fondo a -Z
    g.computeVertexNormals()
    return g
  })
}
