import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Caja con centro y tamaño en metros, opcionalmente rotada. */
export function box(
  center: [number, number, number],
  size: [number, number, number],
  rotation?: THREE.Euler,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(...size)
  if (rotation) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation))
  g.translate(...center)
  return g
}

/** Cabeza hexagonal de bulón. axis: eje del bulón. */
export function hexNut(center: [number, number, number], radius: number, height: number, axis: 'y' | 'z' = 'y') {
  const g = new THREE.CylinderGeometry(radius, radius, height, 6)
  if (axis === 'z') g.rotateX(Math.PI / 2)
  g.translate(...center)
  return g
}

/** Pinta toda la geometría con un color (atributo de color por vértice). */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color)
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Fusiona geometrías heterogéneas (indexadas o no) en una sola. */
export function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geoms.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g
    for (const name of Object.keys(ng.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(name)) ng.deleteAttribute(name)
    return ng
  })
  const hasColor = prepared.some((g) => g.getAttribute('color'))
  if (hasColor) for (const g of prepared) if (!g.getAttribute('color')) paint(g, '#ffffff')
  const out = mergeGeometries(prepared, false)
  if (!out) throw new Error('No se pudieron fusionar las geometrías')
  out.computeBoundingSphere()
  return out
}

/**
 * Caché: misma clave → misma geometría (se comparte entre todas las piezas iguales).
 * Guarda las últimas `max` variantes; las más viejas se liberan de la GPU
 * (si se vuelven a usar, three.js las vuelve a subir sola).
 */
export function cached<T extends THREE.BufferGeometry>(store: Map<string, T>, key: string, build: () => T, max = 24): T {
  let g = store.get(key)
  if (g) {
    store.delete(key)          // la movemos al final (más reciente)
    store.set(key, g)
    return g
  }
  g = build()
  store.set(key, g)
  if (store.size > max) {
    const [oldKey, old] = store.entries().next().value as [string, T]
    store.delete(oldKey)
    old.dispose()
  }
  return g
}
