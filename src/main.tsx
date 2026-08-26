import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import {
  bootstrapEmbeddedSession,
  getEmbeddedContext,
  getEmbeddedReopenUrl,
  getEmbeddedSessionState,
  initializeEmbeddedContext,
} from './lib/embeddedSession'
import { isNanafoxEmbedded, isNanafoxStudio, shouldRegisterServiceWorker } from './lib/deploymentFlavor'

function configureServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.PROD && shouldRegisterServiceWorker()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
    return
  }
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations
      .filter((registration) => !import.meta.env.PROD || new URL(registration.scope).pathname.startsWith(import.meta.env.BASE_URL))
      .forEach((registration) => registration.unregister())
  })
}

async function start() {
  if (isNanafoxStudio()) {
    document.title = 'NanaFox Studio'
    configureServiceWorker()
    const { default: StudioApp } = await import('./studio/StudioApp')
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <StudioApp />
      </StrictMode>,
    )
    return
  }

  const embeddedContext = initializeEmbeddedContext()
  if (embeddedContext?.theme !== 'dark' && embeddedContext?.theme !== 'light') {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const syncColorScheme = () => document.documentElement.classList.toggle('dark', colorScheme.matches)
    syncColorScheme()
    colorScheme.addEventListener('change', syncColorScheme)
  }
  installMobileViewportGuards()
  configureServiceWorker()

  if (isNanafoxEmbedded()) {
    await bootstrapEmbeddedSession(null)
    if (!getEmbeddedContext()?.userId) {
      const state = getEmbeddedSessionState()
      const reopen = getEmbeddedReopenUrl()
      createRoot(document.getElementById('root')!).render(
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-white">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-lg font-semibold">图像创作会话不可用</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{state.message ?? '请返回 NanaFox 后重新打开图像创作。'}</p>
            {reopen && <a className="mt-5 inline-flex rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white" href={reopen}>返回 NanaFox</a>}
          </div>
        </main>,
      )
      return
    }
  }

  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
