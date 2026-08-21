import { describe, expect, it } from 'vitest'
import {
  getDeploymentBase,
  getDeploymentStorageName,
  isEmbeddedFeatureEnabled,
  isNanafoxEmbedded,
  shouldRegisterServiceWorker,
  stripEmbeddedRemoteCssImports,
} from './deploymentFlavor'

describe('deployment flavor', () => {
  it('keeps the upstream relative base by default', () => {
    expect(isNanafoxEmbedded('')).toBe(false)
    expect(getDeploymentBase('')).toBe('./')
    expect(getDeploymentStorageName('')).toBe('gpt-image-playground')
  })

  it('uses the isolated Nanafox beta base for embedded builds', () => {
    expect(isNanafoxEmbedded('nanafox-embedded')).toBe(true)
    expect(getDeploymentBase('nanafox-embedded')).toBe('/tools/image-playground/')
    expect(getDeploymentStorageName('nanafox-embedded')).toBe('gpt-image-playground-nanafox-embedded')
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
