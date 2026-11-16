/**
 * SISTEMA DE DEPÓSITOS: el ingreso y el sistema; o, con un link de cliente, el proyecto sólo para mirar.
 * Usa el mismo motor, el mismo 3D y el mismo panel que la app de gestión.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '../web/components/overlays'
import '../web/styles/app.css'
import '../web/styles/pages.css'
import './cotizador.css'
import { CotizadorApp } from './CotizadorApp'
import { ClientView, enterViewMode, viewCode } from './ClientView'

// un link de cliente (…?ver=CÓDIGO) abre el proyecto sólo para mirar, sin pasar por el ingreso
const code = viewCode()
if (code) enterViewMode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      {code ? <ClientView code={code} /> : <CotizadorApp />}
    </ToastProvider>
  </StrictMode>,
)
