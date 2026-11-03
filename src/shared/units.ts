/**
 * UNIDADES. Por dentro todo se guarda en milímetros (enteros, sin errores de redondeo);
 * al usuario siempre se le muestra y se le pide en metros.
 */
// sin ceros de más: 3000 → "3", 2700 → "2,7", 75 → "0,075"
const mf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

/** 2700 → "2,7 m" · 3000 → "3 m" · 75 → "0,075 m" */
export const metros = (mm: number) => `${mf.format(Math.round(mm) / 1000)} m`

/** El número sin la unidad: 2700 → "2,7" */
export const metrosNum = (mm: number) => mf.format(Math.round(mm) / 1000)

/** Lee lo que escribe el usuario en metros ("2,7", "2.70", "12") y lo pasa a mm. NaN si no es un número. */
export function parseMetros(text: string): number {
  const t = text.trim().replace(/\s/g, '')
  if (!t) return NaN
  // "1.250,5" (miles con punto) o "2,7" / "2.7" (decimal con coma o punto)
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const v = Number(normalized)
  return Number.isFinite(v) ? Math.round(v * 1000) : NaN
}
