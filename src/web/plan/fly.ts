/**
 * VUELO SOBRE EL DEPÓSITO (como un dron): así se maneja siempre la vista 3D del depósito. Los botones
 * de afuera del lienzo le piden a la cámara que avance o retroceda hacia donde se mira, o que vuelva
 * a ver todo. Esto es el puente entre los dos.
 */

/**
 * Se vuela siempre, salvo caminando a pie o viendo un rack solo (ahí la vista gira alrededor del
 * rack, para tocar sus piezas).
 */
export const isFlying = (s: { walk: unknown; isolate: string[] | null }) => !s.walk && !s.isolate?.length
export type FlyKey = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'turnLeft' | 'turnRight'

export const flyBridge: {
  /** Mantener apretado (true) o soltar (false) un movimiento. Lo conecta el 3D cuando está a la vista. */
  hold: ((key: FlyKey, on: boolean) => void) | null
  /** Volver a la vista general del depósito. */
  home: (() => void) | null
  /** Un empujón hacia donde se mira (1) o para atrás (-1): lo usan los botones + y −. */
  nudge: ((sign: number) => void) | null
  /** Se está arrastrando algo del depósito (un rack, una columna): el arrastre no es para mirar. */
  moving: boolean
} = { hold: null, home: null, nudge: null, moving: false }
