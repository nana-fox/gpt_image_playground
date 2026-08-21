import { describe, expect, it } from 'vitest'
import { getDeploymentBase, isNanafoxEmbedded } from './deploymentFlavor'

describe('deployment flavor', () => {
  it('keeps the upstream relative base by default', () => {
    expect(isNanafoxEmbedded('')).toBe(false)
    expect(getDeploymentBase('')).toBe('./')
  })

  it('uses the isolated Nanafox beta base for embedded builds', () => {
    expect(isNanafoxEmbedded('nanafox-embedded')).toBe(true)
    expect(getDeploymentBase('nanafox-embedded')).toBe('/tools/image-playground/')
  })
})
