/**
 * COTIZADOR 3D SUELTO: sólo el cotizador, sin login, pedidos ni almacén.
 * Usa el mismo motor, el mismo 3D y el mismo panel que la app de gestión.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '../web/components/overlays'
import '../web/styles/app.css'
import '../web/styles/pages.css'
import './cotizador.css'
import { CotizadorApp } from './CotizadorApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <CotizadorApp />
    </ToastProvider>
  </StrictMode>,
)
