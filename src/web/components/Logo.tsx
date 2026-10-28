/**
 * Logo oficial (archivo provisto, sin redibujar ni alterar).
 * El PNG trae mucho margen blanco: el contenedor sólo lo encuadra.
 */
import SRC from '../assets/brand/logo-sistemas-de-carga.png'

const TRIM = 0.135

export function Logo({ size, className }: { size: number; className?: string }) {
  const full = size / (1 - 2 * TRIM)
  return (
    <span className={`logo${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <img src={SRC} alt="Sistemas de Carga S.A. — Producción" width={full} height={full} style={{ margin: -full * TRIM }} draggable={false} />
    </span>
  )
}
