/**
 * Etiqueta de ubicación, como las que se pegan en las vigas del rack:
 * código grande, desglose (pasillo · rack · nivel · posición) y código de barras Code 39.
 */
import { ArrowDown, ArrowUp } from 'lucide-react'

/* Code 39: 9 elementos por carácter (barra, espacio, barra…), 3 anchos. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw',
  C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn',
  I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
}

export function Barcode({ value, height = 44 }: { value: string; height?: number }) {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z.\- ]/g, '')}*`
  const NARROW = 1
  const WIDE = 2.6
  const bars: { x: number; w: number }[] = []
  let x = 0
  for (const ch of text) {
    const pattern = CODE39[ch]
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === 'w' ? WIDE : NARROW
      if (i % 2 === 0) bars.push({ x, w })
      x += w
    }
    x += NARROW // separación entre caracteres
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${x} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Código de barras ${value}`}>
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} />)}
    </svg>
  )
}

/** "A-04-03-02" → pasillo A, rack 04, nivel 03, posición 02. */
export function parseLocationCode(code: string) {
  const m = /^([A-Z])-(\d{2})-(\d{2})-(\d{2})$/.exec(code)
  return m ? { aisle: m[1], rack: m[2], level: m[3], position: m[4] } : null
}

export function LocationLabel({ code, name, compact }: { code: string; name?: string; compact?: boolean }) {
  const parts = parseLocationCode(code)
  const Arrow = parts && Number(parts.level) === 1 ? ArrowDown : ArrowUp
  return (
    <div className={`loc-label${compact ? ' loc-label--compact' : ''}`}>
      <div className="loc-label__top">
        <span className="loc-label__arrow" aria-hidden><Arrow size={compact ? 18 : 24} strokeWidth={3} /></span>
        <span className="loc-label__code">{code}</span>
      </div>
      {parts ? (
        <div className="loc-label__parts">
          <span><small>Pasillo</small>{parts.aisle}</span>
          <span><small>Rack</small>{parts.rack}</span>
          <span><small>Nivel</small>{parts.level}</span>
          <span><small>Posición</small>{parts.position}</span>
        </div>
      ) : name ? <div className="loc-label__name">{name}</div> : null}
      {!compact && <Barcode value={code} />}
    </div>
  )
}
