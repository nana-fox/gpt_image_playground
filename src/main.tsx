import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { initializeEmbeddedContext } from './lib/embeddedSession'
import { shouldRegisterServiceWorker } from './lib/deploymentFlavor'

initializeEmbeddedContext()
installMobileViewportGuards()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD && shouldRegisterServiceWorker()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations
        .filter((registration) => !import.meta.env.PROD || new URL(registration.scope).pathname.startsWith(import.meta.env.BASE_URL))
        .forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
