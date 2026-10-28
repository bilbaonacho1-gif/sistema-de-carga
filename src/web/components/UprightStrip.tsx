/**
 * Franja de parante perforado: la ranura cuadrado-círculo-cuadrado del rack selectivo
 * de Sistemas de Carga, usada como motivo gráfico en la pantalla de ingreso.
 */
export function UprightStrip({ className }: { className?: string }) {
  // una ranura: cuadrado arriba + círculo + cuadrado abajo, en 2 columnas, cada 50 "mm"
  const slot = (cx: number, cy: number) =>
    `M${cx - 4.5} ${cy - 14.5}h9v9h-9z M${cx - 4.5} ${cy + 5.5}h9v9h-9z M${cx} ${cy - 6.5}a6.5 6.5 0 1 0 0.01 0z`
  const path = [22, 58].map((x) => slot(x, 25)).join(' ')
  return (
    <svg className={`upright-strip${className ? ` ${className}` : ''}`} aria-hidden="true" preserveAspectRatio="xMidYMin slice">
      <defs>
        <pattern id="upright-slots" width="80" height="50" patternUnits="userSpaceOnUse">
          <path d={path} fill="#191b1e" />
        </pattern>
        <linearGradient id="upright-metal" x1="0" x2="1">
          <stop offset="0" stopColor="#9aa1a8" />
          <stop offset="0.45" stopColor="#d9dde1" />
          <stop offset="0.5" stopColor="#8d949b" />
          <stop offset="0.55" stopColor="#d3d7db" />
          <stop offset="1" stopColor="#a2a8ae" />
        </linearGradient>
      </defs>
      <rect width="80" height="100%" fill="url(#upright-metal)" />
      <rect width="80" height="100%" fill="url(#upright-slots)" />
    </svg>
  )
}
