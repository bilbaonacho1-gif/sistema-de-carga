/**
 * CALCAR UN PLANO: se sube la foto o imagen del plano del cliente, queda de fondo semitransparente y
 * se dibuja encima. Para que quede a escala se marcan dos puntos de la imagen y se escribe cuánto mide
 * esa distancia en la realidad. Se guarda aparte del plano (no entra en deshacer/rehacer).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PlanPoint } from '../../shared/plan/types'

export interface Calco {
  src: string
  /** Esquina superior izquierda y tamaño en mm del plano. */
  x: number
  y: number
  w: number
  h: number
  opacity: number
  /** Si está en true, arrastrando sobre la imagen se la mueve (en vez de moverse por el plano). */
  moving: boolean
}

interface CalcoStore {
  calco: Calco | null
  set(c: Calco | null): void
  patch(p: Partial<Calco>): void
}

export const useCalco = create<CalcoStore>()(persist((set) => ({
  calco: null,
  set: (calco) => set({ calco }),
  patch: (p) => set((s) => ({ calco: s.calco ? { ...s.calco, ...p } : s.calco })),
}), {
  name: 'sdc-calco',
  storage: createJSONStorage(() => ({
    getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
    setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* la imagen no entra en la memoria del navegador: queda sólo por esta visita */ } },
    removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
  })),
}))

/** Lee la imagen elegida y la achica (lado mayor 2400 px, JPEG) para que pese poco. */
export function loadImage(file: File): Promise<{ src: string; ratio: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('El archivo no es una imagen (usá JPG o PNG)'))
      img.onload = () => {
        const k = Math.min(1, 2400 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        const g = c.getContext('2d')!
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
        g.drawImage(img, 0, 0, c.width, c.height)
        resolve({ src: c.toDataURL('image/jpeg', 0.85), ratio: img.height / img.width })
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Escala el calco para que la distancia entre a y b (marcados sobre la imagen) mida `real` mm. El
 * punto a queda quieto: así la imagen no "salta" y lo marcado sigue en su lugar.
 */
export function scaleCalco(c: Calco, a: PlanPoint, b: PlanPoint, real: number): Calco {
  const measured = Math.hypot(b.x - a.x, b.y - a.y)
  if (measured < 1 || real <= 0) return c
  const k = real / measured
  return { ...c, x: a.x - (a.x - c.x) * k, y: a.y - (a.y - c.y) * k, w: c.w * k, h: c.h * k }
}
