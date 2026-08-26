import { describe, expect, it } from 'vitest'
import {
  getDeploymentBase,
  getDeploymentSurface,
  getDeploymentStorageName,
  isEmbeddedFeatureEnabled,
  isNanafoxEmbedded,
  isNanafoxStudio,
  shouldRegisterServiceWorker,
  setEmbeddedStorageUserId,
  stripEmbeddedRemoteCssImports,
} from './deploymentFlavor'

describe('deployment flavor', () => {
  it('keeps the upstream relative base by default', () => {
    expect(isNanafoxEmbedded('')).toBe(false)
    expect(isNanafoxStudio('')).toBe(false)
    expect(getDeploymentBase('')).toBe('./')
    expect(getDeploymentStorageName('')).toBe('gpt-image-playground')
  })

  it('selects Studio without changing the embedded deployment', () => {
    expect(isNanafoxStudio('nanafox-studio')).toBe(true)
    expect(isNanafoxEmbedded('nanafox-studio')).toBe(false)
    expect(getDeploymentBase('nanafox-studio')).toBe('/')
    expect(getDeploymentStorageName('nanafox-studio')).toBe('nanafox-studio')
  })

  it('requires a trusted user before selecting embedded persistence', () => {
    expect(isNanafoxEmbedded('nanafox-embedded')).toBe(true)
    expect(getDeploymentBase('nanafox-embedded')).toBe('/tools/image-playground/')
    expect(() => getDeploymentStorageName('nanafox-embedded')).toThrow('可信用户')

    setEmbeddedStorageUserId('9')
    expect(getDeploymentStorageName('nanafox-embedded')).toBe('gpt-image-playground-nanafox-embedded-u-9')

    setEmbeddedStorageUserId('10')
    expect(getDeploymentStorageName('nanafox-embedded')).toBe('gpt-image-playground-nanafox-embedded-u-10')
  })

  it('distinguishes the embedded iframe from a standalone new tab', () => {
    expect(getDeploymentSurface(false, false)).toBe('default')
    expect(getDeploymentSurface(false, true)).toBe('default')
    expect(getDeploymentSurface(true, true)).toBe('embedded-frame')
    expect(getDeploymentSurface(true, false)).toBe('embedded-standalone')
  })

  it('disables unsupported UI capabilities and PWA behavior only in embedded builds', () => {
    expect(isEmbeddedFeatureEnabled('agent', true)).toBe(false)
    expect(isEmbeddedFeatureEnabled('settings', true)).toBe(false)
    expect(isEmbeddedFeatureEnabled('support-prompt', true)).toBe(false)
    expect(isEmbeddedFeatureEnabled('config-transfer', true)).toBe(false)
    expect(isEmbeddedFeatureEnabled('version-check', true)).toBe(false)
    expect(isEmbeddedFeatureEnabled('agent', false)).toBe(true)
    expect(shouldRegisterServiceWorker(true)).toBe(false)
    expect(shouldRegisterServiceWorker(false)).toBe(true)
  })

  it('removes remote font imports only from embedded CSS', () => {
    const css = "@import url('https://fonts.example/a.css');\n@import './local.css';\nbody { color: black; }\n"

    expect(stripEmbeddedRemoteCssImports(css, true)).toBe("@import './local.css';\nbody { color: black; }\n")
    expect(stripEmbeddedRemoteCssImports(css, false)).toBe(css)
  })
})
