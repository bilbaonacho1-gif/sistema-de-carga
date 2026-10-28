/** Formatos en castellano rioplatense. */
const nf = new Intl.NumberFormat('es-AR')
export const fmt = (n: number) => nf.format(n)

const dateF = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const shortDateF = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' })
const timeF = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const longF = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

export const fmtDate = (iso: string | null | undefined) => (iso ? dateF.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—')
export const fmtShortDate = (iso: string) => shortDateF.format(new Date(iso))
export const fmtTime = (iso: string) => timeF.format(new Date(iso))
export const fmtDateTime = (iso: string) => `${fmtShortDate(iso)} ${fmtTime(iso)}`
export const fmtLongDate = (d: Date) => longF.format(d)

/** "hace 5 min", "ayer 14:32", "03/10 09:10" */
export function fmtRelative(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'recién'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `hoy ${fmtTime(iso)}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `ayer ${fmtTime(iso)}`
  return fmtDateTime(iso)
}

/** Día para agrupar listas: "Hoy", "Ayer", "jueves 1 de octubre". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (d.toDateString() === now.toDateString()) return 'Hoy'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Ayer'
  return fmtLongDate(d)
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 6) return 'Buenas noches'
  if (h < 13) return 'Buenos días'
  if (h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`

export const units = (n: number, unit: string) => `${fmt(n)} ${unit === 'u' ? 'u.' : unit}`
