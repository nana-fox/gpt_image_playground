import { readRuntimeEnv } from './runtimeEnv'

export const NANAFOX_EMBEDDED_FLAVOR = 'nanafox-embedded'
export const NANAFOX_STUDIO_FLAVOR = 'nanafox-studio'

let embeddedStorageUserId = ''

export type EmbeddedFeature = 'agent' | 'settings' | 'support-prompt' | 'config-transfer' | 'pwa' | 'version-check'
export type DeploymentSurface = 'default' | 'embedded-frame' | 'embedded-standalone'

export function isNanafoxEmbedded(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return readRuntimeEnv(flavor) === NANAFOX_EMBEDDED_FLAVOR
}

export function isNanafoxStudio(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return readRuntimeEnv(flavor) === NANAFOX_STUDIO_FLAVOR
}

export function getDeploymentBase(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  if (isNanafoxEmbedded(flavor)) return '/tools/image-playground/'
  return isNanafoxStudio(flavor) ? '/' : './'
}

export function getDeploymentStorageName(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  if (isNanafoxStudio(flavor)) return 'nanafox-studio'
  if (!isNanafoxEmbedded(flavor)) return 'gpt-image-playground'
  if (!embeddedStorageUserId) throw new Error('嵌入存储缺少可信用户')
  return `gpt-image-playground-nanafox-embedded-u-${embeddedStorageUserId}`
}

export function setEmbeddedStorageUserId(userId: string) {
  const normalized = userId.trim()
  if (!/^[1-9]\d*$/.test(normalized)) throw new Error('嵌入存储用户无效')
  embeddedStorageUserId = normalized
}

export function clearEmbeddedStorageUserId() {
  embeddedStorageUserId = ''
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
