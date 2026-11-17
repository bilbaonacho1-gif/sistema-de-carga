/**
 * VUELO SOBRE EL DEPÓSITO (el 3D visto "desde un helicóptero"): los botones de afuera del lienzo y
 * el teclado le piden a la cámara que se corra, suba, baje o gire. Esto es el puente entre los dos.
 */
export type FlyKey = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'turnLeft' | 'turnRight'

export const flyBridge: {
  /** Mantener apretado (true) o soltar (false) un movimiento. Lo conecta el 3D cuando está a la vista. */
  hold: ((key: FlyKey, on: boolean) => void) | null
  /** Volver a la vista general del depósito. */
  home: (() => void) | null
} = { hold: null, home: null }
