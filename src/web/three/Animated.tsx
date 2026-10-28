import { useFrame } from '@react-three/fiber'
import { useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'

export type AppearMode = 'grow-y' | 'grow-x' | 'drop' | 'none'

interface AnimatedProps {
  /** Posición destino: si cambia, el grupo se desliza hasta ella. */
  position: [number, number, number]
  rotationY?: number
  /** Cómo aparece la pieza al montarse. */
  appear?: AppearMode
  /** Segundos de espera antes de aparecer (para escalonar módulos/niveles). */
  delay?: number
  duration?: number
  children: ReactNode
}

/** Con "reducir movimiento" activado en el sistema, las piezas aparecen sin animación. */
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)

/**
 * Grupo animado: aparece con una animación corta y, cuando cambia su posición
 * destino (por ejemplo al modificar el ancho o la altura), se desliza suavemente.
 */
export function Animated({ position, rotationY = 0, appear = 'none', delay = 0, duration = 0.55, children }: AnimatedProps) {
  const ref = useRef<THREE.Group>(null)
  // el delay y el modo sólo importan al montar: se congelan
  const [mount] = useState(() => {
    const mode: AppearMode = reducedMotion ? 'none' : appear
    return { appear: mode, delay, start: -1, done: mode === 'none' }
  })
  const target = useRef(new THREE.Vector3())
  target.current.set(...position)

  useFrame((state, dt) => {
    const g = ref.current
    if (!g) return
    const step = Math.min(dt, 0.05)
    g.position.x = THREE.MathUtils.damp(g.position.x, target.current.x, 9, step)
    g.position.z = THREE.MathUtils.damp(g.position.z, target.current.z, 9, step)

    if (mount.done) {
      g.position.y = THREE.MathUtils.damp(g.position.y, target.current.y, 9, step)
      return
    }
    if (mount.start < 0) mount.start = state.clock.elapsedTime + mount.delay
    const raw = (state.clock.elapsedTime - mount.start) / duration
    const t = Math.min(1, Math.max(0, raw))
    g.visible = raw >= 0
    switch (mount.appear) {
      case 'grow-y':
        g.scale.y = Math.max(0.001, easeOutCubic(t))
        g.position.y = target.current.y
        break
      case 'grow-x':
        g.scale.x = Math.max(0.001, easeOutCubic(t))
        g.position.y = target.current.y
        break
      case 'drop': {
        const k = easeOutBack(t)
        g.position.y = target.current.y + (1 - easeOutCubic(t)) * 0.9
        g.scale.setScalar(0.6 + 0.4 * Math.min(1.08, k))
        break
      }
    }
    if (t >= 1) {
      mount.done = true
      g.scale.set(1, 1, 1)
      g.visible = true
    }
  })

  return (
    <group
      ref={ref}
      position={position}
      rotation-y={rotationY}
      visible={mount.done}
      scale={mount.done ? 1 : mount.appear === 'grow-x' ? [0.001, 1, 1] : mount.appear === 'grow-y' ? [1, 0.001, 1] : 0.6}
    >
      {children}
    </group>
  )
}
