import { readRuntimeEnv } from './runtimeEnv'

export const NANAFOX_EMBEDDED_FLAVOR = 'nanafox-embedded'

export type EmbeddedFeature = 'agent' | 'settings' | 'support-prompt' | 'config-transfer' | 'pwa' | 'version-check'
export type DeploymentSurface = 'default' | 'embedded-frame' | 'embedded-standalone'

export function isNanafoxEmbedded(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return readRuntimeEnv(flavor) === NANAFOX_EMBEDDED_FLAVOR
}

export function getDeploymentBase(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return isNanafoxEmbedded(flavor) ? '/tools/image-playground/' : './'
}

export function getDeploymentStorageName(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return isNanafoxEmbedded(flavor) ? 'gpt-image-playground-nanafox-embedded' : 'gpt-image-playground'
}

export function getDeploymentSurface(
  embedded = isNanafoxEmbedded(),
  framed = typeof window !== 'undefined' && window.self !== window.top,
): DeploymentSurface {
  if (!embedded) return 'default'
  return framed ? 'embedded-frame' : 'embedded-standalone'
}

export function isEmbeddedFeatureEnabled(_feature: EmbeddedFeature, embedded = isNanafoxEmbedded()) {
  return !embedded
}

export function shouldRegisterServiceWorker(embedded = isNanafoxEmbedded()) {
  return !embedded
}

export function stripEmbeddedRemoteCssImports(css: string, embedded = isNanafoxEmbedded()) {
  if (!embedded) return css
  return css
    .replace(/^@import\s+url\(\s*(['"])https?:\/\/.*?\1\s*\)\s*;\s*\r?\n?/gim, '')
    .replace(/^@import\s+(['"])https?:\/\/.*?\1\s*;\s*\r?\n?/gim, '')
}
