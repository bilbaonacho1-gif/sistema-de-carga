/**
 * Al empezar un depósito, el sistema que lo usa puede pedir además el nombre del proyecto (para
 * guardarlo desde el primer momento). Si nadie lo provee, la tarjeta de inicio pide sólo las medidas.
 */
import { createContext } from 'react'

export interface StartProject {
  name: string
  setName(v: string): void
  /** Se llama apenas se crea el depósito (o se empieza a dibujarlo). */
  onStart(): void
  /** Ir a abrir un proyecto ya guardado. */
  openSaved(): void
}
export const StartProjectContext = createContext<StartProject | null>(null)
