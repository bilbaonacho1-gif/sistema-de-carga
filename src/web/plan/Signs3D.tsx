/**
 * LOS SÍMBOLOS DEL PLANO, EN 3D: cada matafuego, salida, baño, tablero… se ve como un cartel en un
 * poste, con el mismo ícono y el mismo color que en el plano. El cartel siempre mira a la cámara.
 */
import { invalidate } from '@react-three/fiber'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import type { SymbolKind } from '../../shared/plan/types'
import { SYMBOLS } from './PlanAnnotations'

const SIZE = 256
const cache = new Map<string, THREE.CanvasTexture>()

/** El ícono, como dibujo SVG (el mismo componente del plano, armado una vez fuera de la pantalla). */
function iconSvg(kind: SymbolKind): string {
  const def = SYMBOLS[kind] ?? SYMBOLS.matafuego
  const box = document.createElement('div')
  const root = createRoot(box)
  flushSync(() => root.render(createElement(def.icon, { color: def.color, size: 160, strokeWidth: 2.2 })))
  const html = box.innerHTML
  const svg = html.includes('xmlns=') ? html : html.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  root.unmount()
  return svg
}

/** La imagen del cartel: fondo blanco, borde del color del símbolo y su ícono (se arma una vez por tipo). */
function signTexture(kind: SymbolKind, selected: boolean): THREE.CanvasTexture {
  const key = `${kind}|${selected ? 1 : 0}`
  let tex = cache.get(key)
  if (tex) return tex
  const def = SYMBOLS[kind] ?? SYMBOLS.matafuego
  const c = document.createElement('canvas'), ctx = c.getContext('2d')!
  c.width = SIZE; c.height = SIZE
  const edge = selected ? 22 : 14
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = selected ? '#be1e30' : def.color; ctx.lineWidth = edge
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(edge / 2, edge / 2, SIZE - edge, SIZE - edge, 44); else ctx.rect(edge / 2, edge / 2, SIZE - edge, SIZE - edge)
  ctx.fill(); ctx.stroke()
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  // el ícono llega un instante después: se arma fuera del dibujado de la pantalla y se carga como imagen
  const done = tex
  setTimeout(() => {
    try {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, (SIZE - 160) / 2, (SIZE - 160) / 2, 160, 160); done.needsUpdate = true; invalidate() }
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(kind))}`
    } catch { /* queda el cartel sin ícono */ }
  }, 0)
  return tex
}

const POLE = new THREE.MeshStandardMaterial({ color: '#8a9099', roughness: 0.6, metalness: 0.3 })
const POLE_GEO = new THREE.CylinderGeometry(0.03, 0.03, 1, 8)
const FOOT_GEO = new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16)

/** Alto del centro del cartel y su tamaño (m). */
const AT = 2.4, SIDE = 1.1

/** Un símbolo del plano parado en el piso: poste y cartel. Va dentro de un grupo ubicado en su lugar. */
export function SignPost({ kind, selected }: { kind: SymbolKind; selected: boolean }) {
  const tex = signTexture(kind, selected)
  return (
    <>
      <mesh geometry={FOOT_GEO} material={POLE} position={[0, 0.02, 0]} />
      <mesh geometry={POLE_GEO} material={POLE} position={[0, (AT - SIDE / 2) / 2, 0]} scale={[1, AT - SIDE / 2, 1]} castShadow />
      <sprite position={[0, AT, 0]} scale={[SIDE, SIDE, 1]}>
        <spriteMaterial map={tex} transparent />
      </sprite>
    </>
  )
}
