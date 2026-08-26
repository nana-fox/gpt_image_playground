import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActualValueBadge } from './paramDisplay'

describe('ActualValueBadge', () => {
  it('keeps compact output focused on the actual value', () => {
    const html = renderToStaticMarkup(
      <ActualValueBadge value="1122x1402" requestedValue="3840x2160" />,
    )

    expect(html).toContain('1122x1402')
    expect(html).not.toContain('3840x2160 → 1122x1402')
  })
})
