import { readRuntimeEnv } from './runtimeEnv'

export const NANAFOX_EMBEDDED_FLAVOR = 'nanafox-embedded'

export function isNanafoxEmbedded(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return readRuntimeEnv(flavor) === NANAFOX_EMBEDDED_FLAVOR
}

export function getDeploymentBase(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return isNanafoxEmbedded(flavor) ? '/tools/image-playground/' : './'
}

export function getDeploymentStorageName(flavor = readRuntimeEnv(import.meta.env?.VITE_DEPLOYMENT_FLAVOR)) {
  return isNanafoxEmbedded(flavor) ? 'gpt-image-playground-nanafox-embedded' : 'gpt-image-playground'
}
